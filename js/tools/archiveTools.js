// ============================================
// Archive Tools — 档案查询类工具（动态注册）
// ============================================
// search_world, get_rule
// 依赖世界卡数据，每次 API 请求前通过 refreshArchiveTools() 动态注册/更新
// ============================================

/**
 * 文本截断
 */
function _truncateArchiveToolText(text, maxLength = 1200) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 5) + '其余略。';
}

/**
 * 文本规范化
 */
function _normalizeArchiveToolText(text, maxLength = 120) {
  if (typeof text !== 'string') return '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, maxLength - 1) + '…';
}

/**
 * Query 分词：按空白和中英文标点切，过滤短 token，去重
 * 整词作单 token——"失窃货物" 不再二次拆字
 */
function _tokenizeQuery(rawQuery) {
  if (typeof rawQuery !== 'string') return [];
  const normalized = rawQuery.trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized
    .split(/[\s,，、;；]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
  return Array.from(new Set(tokens));
}

/**
 * 抽取 NPC 可搜索文本（仅 value，不含字段名）
 * primary: name+title（命中加权 +2）
 * body: 其余可搜字段（命中 +1）
 */
function _buildNpcSearchableText(npc) {
  if (!npc || typeof npc !== 'object') return { primary: '', body: '' };
  const partsPrimary = [];
  const partsBody = [];
  const pushPrimary = v => { if (typeof v === 'string' && v) partsPrimary.push(v); };
  const pushBody = v => {
    if (typeof v === 'string' && v) partsBody.push(v);
    else if (Array.isArray(v)) v.forEach(item => { if (typeof item === 'string' && item) partsBody.push(item); });
  };
  // 兼容视图：嵌套 {card,state} 或老平铺
  const view = (npc.card && typeof npc.card === 'object') ? npc.card : npc;
  pushPrimary(view.name);
  pushPrimary(view.title);
  pushBody(view.role);
  pushBody(view.default_site);
  pushBody(view.location);
  pushBody(view.personality);
  pushBody(view.appearance);
  pushBody(view.cognitive_state);
  pushBody(view.default_cognitive_state);
  pushBody(view.routine);
  pushBody(view.common_spots);
  pushBody(view.faction);
  pushBody(view.origin);
  pushBody(view.clothing);
  pushBody(view.msg_reply_tone);
  pushBody(view.birthday);
  return {
    primary: partsPrimary.join(' ').toLowerCase(),
    body: partsBody.join(' ').toLowerCase(),
  };
}

/**
 * 抽取 timeline event 可搜索文本
 * primary: characters + location（核心标识，命中加权 +2）
 * body: time/day/content/description（事件正文，命中 +1）
 */
function _buildEventSearchableText(event) {
  if (!event || typeof event !== 'object') return { primary: '', body: '' };
  const partsPrimary = [];
  const partsBody = [];
  const pushPrimary = v => {
    if (typeof v === 'string' && v) partsPrimary.push(v);
    else if (Array.isArray(v)) v.forEach(item => { if (typeof item === 'string' && item) partsPrimary.push(item); });
  };
  const pushBody = v => {
    if (typeof v === 'string' && v) partsBody.push(v);
  };
  pushPrimary(event.characters);
  pushPrimary(event.location);
  pushBody(event.time);
  pushBody(event.time_str);
  pushBody(event.day);
  pushBody(event.content);
  pushBody(event.description);
  return {
    primary: partsPrimary.join(' ').toLowerCase(),
    body: partsBody.join(' ').toLowerCase(),
  };
}

/**
 * OR 匹配 + 打分（任一 token 命中即累加）
 * 每个 token 命中 primary +2，命中 body +1，多字段命中取最高
 * 全部 token 都未命中时 total=0，调用方过滤 score>0
 *
 * 设计取舍：选 OR 而非 AND，因 LLM 习惯撒一把关键词探测
 * （e.g. "铁匠 铁匠铺 维修 铁构件"），这些词常分散在多条 doc 里。
 * AND 严格匹配会让 LLM 看不到任何相关信息；OR + 排序让命中
 * 越多的条目越靠前，LLM 自己拼出答案。
 */
function _scoreMatch(tokens, primaryText, bodyText) {
  if (!tokens || tokens.length === 0) return 0;
  const primary = primaryText || '';
  const body = bodyText || '';
  let total = 0;
  for (const tok of tokens) {
    if (primary && primary.includes(tok)) total += 2;
    else if (body && body.includes(tok)) total += 1;
  }
  return total;
}

/**
 * 刷新档案类工具的动态注册
 * 根据当前世界卡状态注册/更新 archive 工具到 toolRegistry
 * 应在每次 API 请求前调用
 */
function refreshArchiveTools() {
  const registry = window.toolRegistry;
  if (!registry) return;

  const arch = typeof archiveService !== 'undefined' ? archiveService : null;
  if (!arch) return;

  // 清除上一次的动态注册（toolRegistry + promptRegistry）
  registry.unregisterBySource('archive');
  if (window.promptRegistry) {
    window.promptRegistry.unregisterByPrefix('tool.search_world.');
    window.promptRegistry.unregisterByPrefix('tool.get_rule.');
  }

  // 双写 helper：promptRegistry + toolRegistry
  const register =
    window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // ── 1. search_world — 全局跨数据源搜索 ──

  register('search_world', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '跨所有数据源全局搜索——NPC档案、地点设定、时间线事件、规则模块、历史剧情原文。支持单关键词或多关键词（空格/逗号分隔），按命中数和字段权重排序，部分命中也会返回。',
    when_to_call:
      '不确定信息在哪里时；需要发现相关NPC、地点或事件时；开始新场景需要了解背景时。先 search_world 再用 get_npc_card/get_rule 精读。',
    avoid_when:
      '已经知道具体NPC ID或规则模块ID时，直接用 get_npc_card/get_rule 更高效。',
    input_focus:
      '关键词可以是 1-4 个，按空格或逗号分隔。多关键词不要求都命中，但命中越多排越前。建议把相关概念都列出（如"铁匠 维修 铁件"），系统会把含其中任意词的条目按相关度排好。避免传字段名（如"name"、"role"、"appearance"），那不是数据内容。',
    expected_output:
      '按数据源分组的搜索结果摘要（每源最多 5 条，按相关度排序），标注来源类型（NPC/地点/时间线/规则/剧情/玩家行动）。结果可能只覆盖部分关键词——LLM 应自己拼出完整答案。如需精读某回合原文，用 get_raw_narrative。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索关键词。单词如"铁匠"、"失窃货物"、"桥梁修缮"；多词如"Owen 西段弯道 货车"——按命中数排序，部分命中也会返回。',
        },
      },
      required: ['query'],
    },
    execute(args) {
      // 类型防御：LLM 偶尔传 number/object 导致 .toLowerCase() 崩
      const rawQuery = args && args.query;
      const tokens = _tokenizeQuery(rawQuery);
      if (tokens.length === 0) {
        return '[错误] 请提供搜索关键词（每个词至少 2 个字符）';
      }

      // 每次执行都读最新 entityStore（登场世界扩展后实时可搜）
      const entityIds = window.entityStore?.list?.() || [];

      const TOP_K_PER_SOURCE = 5;
      const sections = [];

      const collectTopK = (scored, formatter) => {
        if (scored.length === 0) return [];
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, TOP_K_PER_SOURCE).map(formatter);
      };

      // 搜索 NPC 档案
      const npcStore = window.npcStore;
      if (npcStore) {
        // 防御方法不存在的情况 (压缩后报 _HEX[_HEX(...)] is not a function 那条 bug 就是这里)
        const allNpcs = (typeof npcStore.getAllMap === 'function' ? npcStore.getAllMap() : null) || {};
        const scored = [];
        for (const [npcId, npc] of Object.entries(allNpcs)) {
          const { primary, body } = _buildNpcSearchableText(npc);
          const score = _scoreMatch(tokens, primary, body);
          if (score > 0) scored.push({ npcId, npc, score });
        }
        sections.push(...collectTopK(scored, ({ npcId, npc }) => {
          // 兼容视图：嵌套 {card,state} 或老平铺
          const v = (npc.card && typeof npc.card === 'object') ? npc.card : npc;
          const name = v.name || npcId;
          const role = v.role || v.title || '';
          const site = v.default_site || v.location || '';
          return `[NPC] ${name} (${npcId}) — ${role}${site ? '，常在' + site : ''}`;
        }));
      }

      // 搜索地点/世界实体（entityId 作 primary，全文作 body）
      {
        const scored = [];
        for (const entityId of entityIds) {
          if (typeof entityId !== 'string' || !entityId) continue;
          const fullText = (typeof arch.getWorldEntity === 'function' ? arch.getWorldEntity(entityId) : '') || '';
          if (typeof fullText !== 'string' || !fullText) continue;
          const score = _scoreMatch(tokens, entityId.toLowerCase(), fullText.toLowerCase());
          if (score > 0) scored.push({ entityId, fullText, score });
        }
        sections.push(...collectTopK(scored, ({ entityId, fullText }) => {
          const snippet = fullText.replace(/\s+/g, ' ').trim().slice(0, 80);
          return `[地点] ${entityId} — ${snippet}…`;
        }));
      }

      // 搜索时间线事件
      {
        const timelineEvents = arch._getTimelineEvents?.() || [];
        const scored = [];
        for (const event of timelineEvents) {
          const { primary, body } = _buildEventSearchableText(event);
          const score = _scoreMatch(tokens, primary, body);
          if (score > 0) scored.push({ event, score });
        }
        sections.push(...collectTopK(scored, ({ event }) => {
          const time = event.time || event.time_str || '';
          const content = (event.content || event.description || '').slice(0, 60);
          const rawChars = event.characters;
          const chars = (Array.isArray(rawChars) ? rawChars : typeof rawChars === 'string' ? rawChars.split(/[、,，]/) : []).join('、');
          return `[时间线] ${time} — ${content}${chars ? '（相关人物：' + chars + '）' : ''}`;
        }));
      }

      // 搜索规则模块（moduleId 作 primary）
      {
        const moduleIds = window.worldMeta?.listRuleModules?.() || [];
        const scored = [];
        for (const moduleId of moduleIds) {
          if (typeof moduleId !== 'string' || !moduleId) continue;
          const moduleText = arch.getPromptModuleDirect?.(moduleId) || '';
          if (typeof moduleText !== 'string' || !moduleText) continue;
          const score = _scoreMatch(tokens, moduleId.toLowerCase(), moduleText.toLowerCase());
          if (score > 0) scored.push({ moduleId, moduleText, score });
        }
        sections.push(...collectTopK(scored, ({ moduleId, moduleText }) => {
          const snippet = moduleText.replace(/\s+/g, ' ').trim().slice(0, 60);
          return `[规则] ${moduleId} — ${snippet}…`;
        }));
      }

      // 搜索传闻（时间线候选事件）
      const gm = window.gmCodeEngine;
      if (gm) {
        try {
          const ts = typeof timelineService !== 'undefined' ? timelineService : null;
          const currentTime = ts?.getCurrentDate?.() || null;
          const candidates = gm._getTimelineCandidates?.(currentTime, null) || [];
          const scored = [];
          for (const c of candidates) {
            if (!c || !c.event) continue;
            const clueText = gm._buildClueText?.(c.event) || '';
            if (typeof clueText !== 'string' || !clueText) continue;
            const score = _scoreMatch(tokens, null, clueText.toLowerCase());
            if (score > 0) scored.push({ clueText, score });
          }
          sections.push(...collectTopK(scored, ({ clueText }) => `[传闻] ${clueText.slice(0, 80)}`));
        } catch (e) {
          // 传闻搜索失败不影响其他结果
        }
      }

      // 搜索历史剧情原文（chatHistory）
      if (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory)) {
        const _parseTurn = typeof parseTurnFromUID === 'function' ? parseTurnFromUID : null;
        const scored = [];

        for (let i = 0; i < chatHistory.length; i++) {
          const msg = chatHistory[i];
          if (!msg || !msg.text || typeof msg.text !== 'string') continue;
          if (msg.isError || msg.isCancelled) continue;

          const lowerText = msg.text.toLowerCase();
          const score = _scoreMatch(tokens, null, lowerText);
          if (score === 0) continue;

          // 回合号反推：AI 消息从 uid 提取；user 消息往后找最近 AI 消息
          let turnNum = null;
          if (msg.sender === 'ai' && msg.uid && _parseTurn) {
            turnNum = _parseTurn(msg.uid);
          } else if (msg.sender === 'user' && _parseTurn) {
            for (let j = i + 1; j < chatHistory.length; j++) {
              const next = chatHistory[j];
              if (next && next.sender === 'ai' && next.uid) {
                turnNum = _parseTurn(next.uid);
                break;
              }
            }
          }
          if (turnNum === null || turnNum === 0) continue;

          // snippet 锚点：用第一个命中 token 的位置
          let anchorIdx = -1;
          for (const tok of tokens) {
            const idx = lowerText.indexOf(tok);
            if (idx >= 0) { anchorIdx = idx; break; }
          }
          if (anchorIdx < 0) anchorIdx = 0;
          const start = Math.max(0, anchorIdx - 30);
          const end = Math.min(msg.text.length, anchorIdx + 80);
          let snippet = msg.text.slice(start, end).replace(/\s+/g, ' ');
          if (start > 0) snippet = '…' + snippet;
          if (end < msg.text.length) snippet = snippet + '…';

          scored.push({ msg, turnNum, snippet, score });
        }

        const chatLines = collectTopK(scored, ({ msg, turnNum, snippet }) => {
          if (msg.sender === 'ai') {
            return `[剧情] T${turnNum}: ${snippet}`;
          }
          // user 消息走 promptRegistry 模板（回退到默认格式）
          const builder = window.promptRegistry?.get?.('react.format.archiveSearchResult')?.builder;
          if (typeof builder === 'function') {
            return builder({ turnNum, snippet });
          }
          return `[玩家行动] T${turnNum}: ${snippet}`;
        });
        sections.push(...chatLines);
        if (chatLines.length > 0) {
          sections.push(
            '（以上 [剧情]/[玩家行动] 为约 80 字摘要片段——需还原对话原文、精确语气、细节描写时，' +
            '用 get_raw_narrative({turn_number: N}) 看 N 回合完整原文）'
          );
        }
      }

      if (sections.length === 0) {
        return `[无结果] 未找到与 "${rawQuery}" 相关的内容`;
      }

      console.log(`[search_world] tokens=${JSON.stringify(tokens)}: ${sections.length} 条结果`);
      return sections.join('\n');
    },
    source: 'archive',
  });

  // ── 2. get_rule — 获取规则模块 ──
  // 模块速览和调用建议由 system 动态块注入（见 aiService._buildRuleModulePreviewText），
  // tool description 保持稳定以利 prompt caching

  const allModuleIds = window.worldMeta?.listRuleModules?.() || [];
  const callableModuleIds = allModuleIds.filter(
    id => typeof id === 'string' && id && id !== 'core_world_mechanics' && id !== 'narrative_base'
  );
  const uniqueModuleIds = Array.from(new Set(callableModuleIds));

  const moduleIdProperty = {
    type: 'string',
    description: uniqueModuleIds.length > 0
      ? '规则模块 ID（可用模块速览与调用建议见 system 动态块）。'
      : '当前无可用规则模块。',
  };
  if (uniqueModuleIds.length > 0) {
    moduleIdProperty.enum = uniqueModuleIds;
  }

  register('get_rule', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description: '获取当前世界的规则模块全文。',
    when_to_call:
      '叙事涉及世界规则系统时——经济交易需要定价规则、时间推进需要时间协议、NPC生成需要角色规则等。',
    avoid_when:
      '纯社交对话或叙事推进不涉及规则机制时；刚查询过同一模块且内容未变时。',
    input_focus:
      'module_id 从 enum 中选择；各模块用途和调用建议见 system 动态块的"规则模块速览"。',
    expected_output:
      '规则模块的完整文本内容。',
    parameters: {
      type: 'object',
      properties: {
        module_id: moduleIdProperty,
      },
      required: ['module_id'],
    },
    execute(args) {
      const available = arch._listCallableRuleModules();
      if (!available.includes(args.module_id)) {
        const availableText = available.length > 0 ? available.join(', ') : '无';
        return `[数据不可用] 规则模块不可用: ${args.module_id}；可用模块: ${availableText}`;
      }
      return arch.getPromptModuleDirect(args.module_id);
    },
    source: 'archive',
  });

  console.log(`[archiveTools] 已刷新: search_world + get_rule (${uniqueModuleIds.length} 个可用模块)`);
}

/**
 * 构建规则模块速览 + 调用建议文本（供 system 动态块使用）
 * 从 worldMeta.getPromptConfig().module_meta 提取
 * @returns {string|null} 格式化文本，无可用模块返回 null
 */
function _buildRuleModulePreviewText() {
  const allModuleIds = window.worldMeta?.listRuleModules?.() || [];
  const callableModuleIds = allModuleIds.filter(
    id => typeof id === 'string' && id && id !== 'core_world_mechanics' && id !== 'narrative_base'
  );
  const uniqueModuleIds = Array.from(new Set(callableModuleIds));
  if (uniqueModuleIds.length === 0) return null;

  const promptConfig = window.worldMeta?.getPromptConfig?.();
  const moduleMetaMap =
    promptConfig?.module_meta && typeof promptConfig.module_meta === 'object'
      ? promptConfig.module_meta
      : {};

  const previewLimit = 10;
  const guidanceLimit = 8;
  const preview = [];
  const guidance = [];

  for (let i = 0; i < uniqueModuleIds.length; i++) {
    const moduleId = uniqueModuleIds[i];
    const meta =
      moduleMetaMap[moduleId] && typeof moduleMetaMap[moduleId] === 'object'
        ? moduleMetaMap[moduleId]
        : {};
    if (i < previewLimit) {
      const desc = _normalizeArchiveToolText(meta.description, 36) || '未提供用途说明';
      preview.push(`${moduleId} -> ${desc}`);
    }
    if (i < guidanceLimit) {
      const whenToCall =
        _normalizeArchiveToolText(meta.when_to_call, 48) || '按该模块主题相关需求调用';
      const avoidWhen = _normalizeArchiveToolText(meta.avoid_when, 36);
      guidance.push(
        avoidWhen
          ? `${moduleId}: ${whenToCall}（避免：${avoidWhen}）`
          : `${moduleId}: ${whenToCall}`
      );
    }
  }

  if (uniqueModuleIds.length > previewLimit) {
    preview.push(`其余 ${uniqueModuleIds.length - previewLimit} 个模块略`);
  }
  if (uniqueModuleIds.length > guidanceLimit) {
    guidance.push(`其余 ${uniqueModuleIds.length - guidanceLimit} 个模块略`);
  }

  const parts = [];
  if (preview.length > 0) parts.push(`模块速览（ID -> 用途）：${preview.join('；')}`);
  if (guidance.length > 0) parts.push(`调用建议：${guidance.join('；')}`);
  return parts.length > 0 ? parts.join('\n') : null;
}

// 暴露到全局供 aiService 调用
window.refreshArchiveTools = refreshArchiveTools;
window._buildRuleModulePreviewText = _buildRuleModulePreviewText;
