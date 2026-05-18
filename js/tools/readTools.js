// ============================================
// Read Tools — 信息查询类工具（get_* 前缀）
// ============================================
// get_npc_card, get_state, get_story_summary, get_npc_reaction, get_sms_history

(function registerReadTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[readTools] toolRegistry 未加载，跳过注册');
    return;
  }
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // ----------------------------------------
  // get_npc_card — 查询 NPC 当前完整档案
  // ----------------------------------------
  register('get_npc_card', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '查询指定NPC的当前完整状态（外貌、心理、关系、位置等）。**支持名字模糊匹配**：不知道 id 时可直接传入名字尝试匹配。',
    when_to_call:
      '叙事中需要描写某个已知NPC但不确定其当前状态时；需要确认NPC的关系、位置或心理状态以保持叙事一致性时。',
    avoid_when:
      '该NPC信息已在当前上下文中且无需确认时；描写路人或无名角色时。',
    input_focus:
      'npc_id 优先传 id；如果只知道名字，传入名字也可（自动尝试 id/normalized id/exact name 多层模糊匹配）。',
    expected_output:
      'NPC的完整状态JSON——name、title、appearance、personality、cognitive_state、relationship、location等字段。',
    parameters: {
      type: 'object',
      properties: {
        npc_id: { type: 'string', description: 'NPC的唯一标识' },
      },
      required: ['npc_id'],
    },
    execute(args) {
      const store = window.npcStore;
      if (!store) return '[错误] npcStore 未加载';

      const npc = store.get(args.npc_id);
      if (!npc) {
        const all = store.getAllMap();
        const byName = Object.entries(all).find(
          ([, data]) => data.name === args.npc_id
        );
        if (byName) {
          return JSON.stringify(byName[1], null, 2);
        }
        return `[未找到] 没有ID或名字为 "${args.npc_id}" 的活跃NPC`;
      }
      return JSON.stringify(npc, null, 2);
    },
  });

  // ----------------------------------------
  // get_state — 玩家当前状态快照
  // ----------------------------------------
  register('get_state', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '获取玩家当前完整状态快照（金钱、位置、时间、目标、自定义状态）。',
    when_to_call:
      '需要确认金钱、位置、时间等具体数值时。注意：基本状态已注入上下文，仅在需要精确数值确认时调用。',
    avoid_when:
      '上下文中已有足够状态信息时；纯叙事不涉及状态判断时。',
    input_focus: '无参数。',
    expected_output:
      '返回金钱、位置（country>site>spot）、游戏时间、当前目标、自定义状态字段的完整快照JSON。',
    parameters: { type: 'object', properties: {} },
    execute() {
      const ps = typeof playerStateService !== 'undefined' ? playerStateService : null;
      const lt = typeof locationTracker !== 'undefined' ? locationTracker : null;
      const ts = typeof timelineService !== 'undefined' ? timelineService : null;
      const cs = window.customStatusStore || null;

      return JSON.stringify({
        money: window.inventoryStore?.getMoney?.() ?? null,
        location: lt?.currentLocation ?? null,
        time: ts?.getCurrentDate?.() ?? null,
        objective: ps?.getObjective?.() ?? null,
        custom_status: cs?.getStatus?.() ?? null,
      });
    },
  });

  // ----------------------------------------
  // get_story_summary — 获取剧情摘要
  // ----------------------------------------
  register('get_story_summary', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '获取近期剧情摘要和章节总结。',
    when_to_call:
      '需要回顾之前发生的事件以避免叙事矛盾时；玩家提及过去的事件需要确认细节时；长时间未回顾需要刷新记忆时。',
    avoid_when:
      '当前回合的事件你已经完全知道时；纯即时对话不涉及历史事件时。',
    input_focus:
      'depth 参数：recent（默认）返回最近5回合摘要；full 返回章节摘要+近期回合。from_turn/to_turn 可指定回合范围精确回溯（此时忽略 depth）。',
    expected_output:
      '按时间排序的摘要文本。',
    parameters: {
      type: 'object',
      properties: {
        depth: {
          type: 'string',
          enum: ['recent', 'full'],
          description: '摘要深度。recent=最近几回合，full=含章节压缩。默认 recent。指定 from_turn/to_turn 时忽略此参数',
        },
        from_turn: {
          type: 'number',
          description: '起始回合号（含），与 to_turn 配合精确查询某段剧情',
        },
        to_turn: {
          type: 'number',
          description: '结束回合号（含），与 from_turn 配合精确查询某段剧情',
        },
      },
    },
    execute(args) {
      const service = window.summaryService;
      if (!service) return '[错误] summaryService 未加载';

      const summaries = service.summaries || [];
      if (summaries.length === 0) return '[无摘要] 目前没有任何剧情摘要';

      // 指定回合范围时，精确筛选
      if (args.from_turn != null || args.to_turn != null) {
        const from = args.from_turn ?? 0;
        const to = args.to_turn ?? Infinity;
        const matched = summaries.filter(
          s => s.type === 'turn' && s.text && s.turnNumber >= from && s.turnNumber <= to
        );
        if (matched.length === 0) return `[无摘要] 回合 ${from}-${to} 范围内没有摘要`;
        return matched.map(s => `T${s.turnNumber}: ${s.text}`).join('\n');
      }

      const depth = args.depth || 'recent';

      if (depth === 'recent') {
        const recentTurns = summaries
          .filter(s => s.type === 'turn' && s.text)
          .slice(-5);
        if (recentTurns.length === 0) return '[无摘要] 没有有效的回合摘要';
        return recentTurns.map(s => `T${s.turnNumber}: ${s.text}`).join('\n');
      }

      const chapters = summaries.filter(s => s.type === 'chapter' && s.text);
      const recentTurns = summaries
        .filter(s => s.type === 'turn' && s.text)
        .slice(-5);

      const parts = [];
      if (chapters.length > 0) {
        parts.push('=== 章节摘要 ===');
        chapters.forEach((c, i) => parts.push(`第${i + 1}章: ${c.text}`));
      }
      if (recentTurns.length > 0) {
        parts.push('=== 近期回合 ===');
        recentTurns.forEach(s => parts.push(`T${s.turnNumber}: ${s.text}`));
      }
      return parts.join('\n') || '[无摘要] 没有有效的摘要数据';
    },
  });

  // ----------------------------------------
  // get_npc_reaction — 查询 NPC 最近的自主决策
  // ----------------------------------------
  register('get_npc_reaction', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '查询某个NPC的历史自主行动决策。注意：当前回合的NPC决策已注入上下文，此工具用于查询更早的历史记录。',
    when_to_call:
      '需要回溯NPC过去几轮的行动轨迹时；需要了解NPC的行为趋势或模式时。',
    avoid_when:
      'NPC刚登场尚无历史决策时；只需要NPC的静态档案信息时（用 get_npc_card）。',
    input_focus:
      'npc_id 是NPC的唯一标识；turns 可选，查询最近几轮的决策（默认1）。',
    expected_output:
      '返回NPC最近的自主决策列表，每条含 action、location、mood、inner_thought。',
    parameters: {
      type: 'object',
      properties: {
        npc_id: { type: 'string', description: 'NPC的唯一标识' },
        turns: { type: 'number', description: '查询最近几轮的决策，默认1' },
      },
      required: ['npc_id'],
    },
    execute(args) {
      const store = typeof npcReactionStore !== 'undefined' ? npcReactionStore : null;
      if (!store) return JSON.stringify({ error: 'npcReactionStore 未加载' });

      const turns = args.turns || 1;
      const recent = store.getRecentReactions(turns);

      const reactions = [];
      for (const turn of recent) {
        const r = turn.reactions[args.npc_id];
        if (r) {
          reactions.push({
            turn_uid: turn.turnUID,
            name: r.name,
            action: r.decision?.action || r.text || null,
            location: r.decision?.location || null,
            social_target: r.decision?.social_target || null,
            mood: r.decision?.mood || null,
            inner_thought: r.decision?.inner_thought || null,
          });
        }
      }

      if (reactions.length === 0) {
        return JSON.stringify({
          npc_id: args.npc_id,
          reactions: [],
          note: '该NPC没有近期自主决策记录',
        });
      }

      console.log(`[get_npc_reaction] ${args.npc_id}: 返回 ${reactions.length} 条决策`);

      return JSON.stringify({ npc_id: args.npc_id, reactions });
    },
  });

  // ----------------------------------------
  // get_sms_history — 查询短信聊天记录
  // ----------------------------------------
  register('get_sms_history', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '查询与某个NPC的短信聊天记录。',
    when_to_call:
      '需要回顾与NPC过往短信交流时；NPC发来新消息需了解上下文时。',
    avoid_when:
      '短信内容与当前场景无关时。',
    input_focus:
      'contact_id 是NPC的标识符；limit 可选，默认返回最近10条；offset 可选，从最新往前跳过N条实现翻页（如 offset=10,limit=10 看更早的记录）。',
    expected_output:
      '按时间排序的短信列表，包含发送方、内容、游戏时间。',
    parameters: {
      type: 'object',
      properties: {
        contact_id: { type: 'string', description: '联系人NPC ID' },
        limit: { type: 'number', description: '返回条数，默认10' },
        offset: { type: 'number', description: '从最新消息往前跳过几条（翻页用），默认0。例如 offset=10,limit=10 返回第11-20条旧消息' },
      },
      required: ['contact_id'],
    },
    execute(args) {
      const sms = typeof smsService !== 'undefined' ? smsService : null;
      if (!sms) return JSON.stringify({ error: 'smsService 未加载' });

      const conv = sms.conversations[args.contact_id];
      if (!conv || conv.length === 0) {
        return JSON.stringify({ contact_id: args.contact_id, messages: [], note: '无聊天记录' });
      }

      const limit = args.limit || 10;
      const offset = args.offset || 0;
      const recent = conv.slice(-(offset + limit), offset > 0 ? -offset : undefined).map(m => ({
        role: m.role === 'assistant' ? 'npc' : 'player',
        content: m.content,
        game_time: m.gameTime || null,
      }));

      console.log(`[get_sms_history] ${args.contact_id}: 返回 ${recent.length} 条记录`);

      return JSON.stringify({ contact_id: args.contact_id, messages: recent });
    },
  });

  // ----------------------------------------
  // get_raw_narrative — 获取指定回合的原始叙事全文
  // ----------------------------------------
  register('get_raw_narrative', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '获取指定回合的原始叙事全文（非压缩摘要）。用于在 search_world 发现某回合提到关键词后，精读该回合的完整叙事内容。',
    when_to_call:
      'search_world 返回了 [剧情] 或 [玩家行动] TN 结果，需要阅读该回合的完整原文以确认细节时。',
    avoid_when:
      '只需要摘要概览时（用 get_story_summary）；不知道具体回合号时（先用 search_world 搜索）。',
    input_focus:
      'turn_number 是回合号（如 search_world 返回的 T2 则传入 2）。可用 turn_numbers 批量获取（最多3个）。',
    expected_output:
      '指定回合的玩家输入 + AI 完整原始回复。',
    parameters: {
      type: 'object',
      properties: {
        turn_number: {
          type: 'number',
          description: '要获取原文的回合号',
        },
        turn_numbers: {
          type: 'array',
          items: { type: 'number' },
          description: '批量获取多个回合号的原文（可选，与 turn_number 二选一，最多3个）',
        },
      },
    },
    execute(args) {
      if (typeof chatHistory === 'undefined' || !Array.isArray(chatHistory)) {
        return '[错误] chatHistory 不可用';
      }
      const _parseTurn = typeof parseTurnFromUID === 'function' ? parseTurnFromUID : null;
      if (!_parseTurn) return '[错误] parseTurnFromUID 不可用';

      // 确定要获取的回合列表
      let turns = [];
      if (Array.isArray(args.turn_numbers) && args.turn_numbers.length > 0) {
        turns = args.turn_numbers.slice(0, 3);
      } else if (args.turn_number != null) {
        turns = [args.turn_number];
      } else {
        return '[错误] 请提供 turn_number 或 turn_numbers';
      }

      const results = [];

      for (const turnNum of turns) {
        // 找该回合的 AI 消息
        const aiMsg = chatHistory.find(m => {
          if (m.sender !== 'ai' || !m.uid) return false;
          if (m.isError || m.isCancelled) return false;
          return _parseTurn(m.uid) === turnNum;
        });

        if (!aiMsg) {
          results.push(`=== T${turnNum} ===\n[未找到] 没有该回合的聊天记录`);
          continue;
        }

        // 找该 AI 消息前一条 user 消息
        const aiIdx = chatHistory.indexOf(aiMsg);
        let playerInput = null;
        if (aiIdx > 0) {
          const prevMsg = chatHistory[aiIdx - 1];
          if (prevMsg && prevMsg.sender === 'user') {
            playerInput = prevMsg.text;
          }
        }

        let entry = `=== T${turnNum} ===`;
        if (playerInput) entry += `\n[玩家] ${playerInput}`;
        entry += `\n[AI] ${aiMsg.text}`;
        results.push(entry);
      }

      console.log(`[get_raw_narrative] 返回 ${turns.length} 个回合的原文`);
      return results.join('\n\n');
    },
  });

  console.log('[readTools] 已注册 6 个信息查询工具');
})();
