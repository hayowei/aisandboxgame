// ============================================
// Narrative Tools — 叙事输出类工具
// ============================================
// update_narrative, update_choices

(function registerNarrativeTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[narrativeTools] toolRegistry 未加载，跳过注册');
    return;
  }
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // ----------------------------------------
  // update_narrative — 输出叙事文本
  // ----------------------------------------
  register('update_narrative', {
    phase: 'narrative',
    required: true,
    trigger: null,
    triggerHint: null,
    signal: 'narrative:complete',
    description:
      '向玩家输出一段叙事文本。每次调用必须先签"叙事段契约"（checkpoint 字段）：声明这段叙事是纯铺陈/承接结果，还是写到一个未决结果之前。可多次调用，每次 text 只写本段**新增内容**——严禁复述/重抄前面调用已经写过的文字（系统按调用顺序自动拼接前后段）。',
    when_to_call:
      '准备好向玩家展示叙事内容时。可分多次调用，中途穿插查询；遇承诺点（撬锁/还价/伏击/掷骰等未决结果前）写到 stop_before 即停。',
    avoid_when:
      '仍在收集信息、尚未形成叙事内容时；想一次写完含未决结果的整段动作时（应在结果前停笔）。',
    input_focus:
      'text 是要展示给玩家的叙事文本，沉浸式故事叙述、不含元信息。checkpoint 是写给自己看的元思考（玩家看不到），强迫你想清楚这段叙事的"未决边界"。',
    expected_output:
      '确认叙事已展示，返回当前累积叙事的总字数。',
    parameters: {
      type: 'object',
      properties: {
        checkpoint: {
          type: 'object',
          description:
            '本段叙事的契约声明（玩家看不到）。在写 text 之前必须想清楚：这段有没有未决结果？如果有，是什么类型？停在哪里？应该用什么工具解决？',
          properties: {
            type: {
              type: 'string',
              enum: [
                'none',
                'item_check',
                'hidden_state',
              ],
              description:
                '【判断顺序】先扫一遍你即将写的 text：里面有"物品/货币是否足够""隐藏世界状态查询"这两类不确定性吗？有 → type **不能**是 none，必须从 2 类里挑；没有（纯环境描写、纯对话引子、或承接上一轮 checkpoint 关闭后的结果叙事）→ none。【2 类不确定性】item_check = 物品/货币是否足够；hidden_state = 隐藏世界状态查询（房间里有什么、墙后有没有人、NPC 当前的真实位置/态度等"AI 不知道的事实"）。【none 是特例不是 default】不要把"动作 + 结果"一段写完然后填 none——那是越权钦定结果。【其他类不确定性怎么办】玩家能力检定（撬锁/潜行）、战斗结算、随机事件、NPC 自由意志（接受/拒绝/起疑）这些类型**暂未支持**（依赖未实装的骰子或 sync 反应工具）——遇到时直接用 type=none 写完整段即可，等支持工具实装后再加回。',
            },
            question: {
              type: 'string',
              description:
                '本段要解决的不确定问题，一句话。type=none 时填空字符串。例："这一枪是否命中？" / "商人接不接受 50 金币的还价？"',
            },
            stop_before: {
              type: 'string',
              description:
                '本段叙事绝不能写到哪些结果。用具体词汇而非抽象描述（不要写"任何结果"，要写"命中、闪避、受伤、死亡、没打中等结果"这种具体禁区）。type=none 时填空字符串。',
            },
            next_tool: {
              type: 'string',
              enum: [
                'none',
                'get_state',
                'update_item',
                'search_world',
                'get_rule',
                'get_npc_reaction',
              ],
              description:
                '本段结束后应当调用哪个工具来解决 question。type=none 时填 "none"（哨兵值，表示不打开 latch）。可选值（schema 强制 enum）：get_state / update_item / search_world / get_rule / get_npc_reaction。【语义】item_check 类不确定性应配 update_item（直接尝试扣减并由 runtime 判定库存是否足够）；hidden_state 类不确定性应配 4 个读类工具之一（先查再叙）。【Phase 2 latch】声明非-none type 后系统会打开 latch——下一轮工具调用必须包含你声明的 next_tool 才能关闭，否则后续 update_narrative / update_choices 会被拒绝。',
            },
          },
          required: ['type', 'question', 'stop_before', 'next_tool'],
        },
        text: { type: 'string', description: '叙事文本内容' },
      },
      required: ['checkpoint', 'text'],
      additionalProperties: false,
    },
    execute(args) {
      const text = args.text || '';
      console.log(`[update_narrative] ${text.length} 字`);
      // 实际展示逻辑由 aiService 循环体处理（通过事件或回调）
      // checkpoint 元数据由 ReAct 循环（react.js）记录到 reactIterationSegments 并 console.log
      return JSON.stringify({
        displayed: true,
        char_count: text.length,
      });
    },
  });

  // ----------------------------------------
  // update_choices — 展示玩家选项 + 结束回合
  // ----------------------------------------
  register('update_choices', {
    phase: 'closing',
    required: true,
    trigger: null,
    triggerHint: null,
    signal: 'closing:complete',
    description:
      '向玩家展示本回合 2-4 个行动选项并结束当前回合。每回合必须调用一次。',
    when_to_call:
      '叙事和结算全部完成后，给玩家提供可选行动。',
    avoid_when:
      '叙事尚未输出时（先调用 update_narrative）。',
    input_focus:
      'choices 数组 2-4 个选项；每个选项的字段约束见 parameters schema 各字段 description。',
    expected_output:
      '确认选项已展示并回合结束。',
    parameters: {
      type: 'object',
      properties: {
        choices: {
          type: 'array',
          description: '选项列表，2-4个。',
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: '选项编号（A/B/C/D）',
              },
              type_tag: {
                type: 'string',
                enum: ['explore', 'trade', 'travel', 'work', 'talk', 'action'],
                description: '选项类型标签',
              },
              short_text: {
                type: 'string',
                description: '选项简述（核心行动，简短动作短语，不超过10字，必须用平白易读的中文）',
              },
              detail_text: {
                type: 'string',
                description: '选项的完整叙述版本（必填非空）。用1-2句简洁平白的中文描述这个行动，是 short_text 的展开形式，不超过60字。【重要】无论玩家的输入文风多么晦涩或先锋，选项描述必须始终保持清晰易读，禁止模仿玩家写作风格。例如 short_text="去铁匠铺看看" → detail_text="前往镇东的铁匠铺，看看铁匠有没有活需要帮忙"。',
              },
              cost_hint: {
                type: 'string',
                description:
                  '代价提示，简短自由文本，≤20字。可写"+3天"、"-30 银币"、"风险中等"、"通宵"、"小心被发现"等任何形式，仅作 UI 显示。',
              },
              effect_days: {
                type: 'integer',
                description: '仅 travel/work 必填正整数（=本回合时间推进天数）；其他类型可省略或填 0',
              },
            },
            required: [
              'id',
              'type_tag',
              'short_text',
              'detail_text',
              'cost_hint',
            ],
          },
        },
      },
      required: ['choices'],
    },
    execute(args) {
      const choices = args.choices || [];

      console.log(
        `[update_choices] ${choices.length} 个选项:`,
        choices.map(c => `${c.id}. [${c.type_tag}] ${c.short_text || c.text || ''} (${c.cost_hint || ''})`).join(' | ')
      );

      return JSON.stringify({
        rendered: true,
        count: choices.length,
        turn_completed: true,
      });
    },
  });

  console.log('[narrativeTools] 已注册 2 个叙事工具');
})();
