// ============================================
// npcCardSync Prompt Bootstrap
// ============================================
// 注册 channel='npcCardSync' 下的 5 个 prompt block，供 npcCardSyncSubagent
// 通过 promptRegistry.assembleChannel('npcCardSync', ctx) 装配。
//
// 角色：在 N 个 NPC reaction 跑完之后接力一次 API call，让模型看完所有 reaction
// 输出，决定哪些 NPC 的身份层字段需要调 update_npc 持久化（走审批队列）。
//
// 字段范围：仅 update_npc 当前 schema 暴露的字段（已剔除 lockedKeys 和 NPC 自治字段）。
// NPC 自治字段（attitude / relationships / cognitive_state / current_goal / state.*）
// 由 reaction 本体经 applyReactionToState 自行落地，本 subagent 不动。
// ============================================

(function registerNpcCardSyncPrompts() {
  const reg = window.promptRegistry;
  if (!reg) {
    console.warn('[npcCardSync] promptRegistry 未加载，跳过注册');
    return;
  }

  reg.register('npcCardSync.role', {
    channel: 'npcCardSync',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'npcCardSync 角色与任务定义',
    origin: { file: 'js/services/ai/npcCardSyncPromptBootstrap.js', symbol: 'npcCardSync.role' },
    builder: () =>
      [
        '## 角色',
        '你是 NPC 卡片同步代理。本回合 NPC reaction 子代理刚刚跑完，每个 NPC 输出了自己的行动决策与自由心声。',
        '你的任务：审视所有 reaction 输出，判断**身份层持久字段**是否需要同步更新；如需，调用 `update_npc` 工具落地（变更将进入玩家审批队列）。',
        '',
        '心理 / 关系 / 立场 / 位置 / 心情 等"自治字段"由 reaction 本体写完了，**不在本工具暴露的字段集内**。你只处理 reaction 文本里隐含的**持久身份变化**（如：衣物状态、外貌持久演变、阵营归属、性格塑造、修真境界、赛博义体等）。',
      ].join('\n'),
    order: 10,
  });

  reg.register('npcCardSync.reactionDigest', {
    channel: 'npcCardSync',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '本回合各 NPC 的 reaction 输出摘要',
    origin: { file: 'js/services/ai/npcCardSyncPromptBootstrap.js', symbol: 'npcCardSync.reactionDigest' },
    builder: ctx => {
      const reactions = Array.isArray(ctx?.reactions) ? ctx.reactions : [];
      if (reactions.length === 0) return '## 本回合 reaction\n\n（无）';
      const blocks = reactions.map(r => {
        const lines = [`### ${r.name || r.id}（id: ${r.id}）`];
        if (r.decision && typeof r.decision === 'object') {
          const d = r.decision;
          if (d.action) lines.push(`- 行动: ${d.action}`);
          if (d.location) lines.push(`- 位置: ${d.location}`);
          if (d.social_target) lines.push(`- 互动对象: ${d.social_target}`);
          if (d.mood) lines.push(`- 情绪: ${d.mood}`);
          if (d.intent_toward_player) lines.push(`- 对玩家意图: ${d.intent_toward_player}`);
          if (d.inner_thought) lines.push(`- 内心: ${d.inner_thought}`);
        }
        const text = (r.text || '').trim();
        if (text) {
          const snippet = text.length > 400 ? text.slice(0, 400) + '…' : text;
          lines.push(`- 自由文本: ${snippet}`);
        }
        return lines.join('\n');
      });
      return ['## 本回合 NPC reaction 输出', ...blocks].join('\n\n');
    },
    order: 20,
  });

  reg.register('npcCardSync.currentCardsSnapshot', {
    channel: 'npcCardSync',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '当前各登场 NPC 的可改字段快照（与 update_npc schema 对齐）',
    origin: { file: 'js/services/ai/npcCardSyncPromptBootstrap.js', symbol: 'npcCardSync.currentCardsSnapshot' },
    builder: ctx => {
      const reactions = Array.isArray(ctx?.reactions) ? ctx.reactions : [];
      if (reactions.length === 0) return '';
      const blocks = reactions.map(r => {
        const card = r.currentCard || {};
        const keys = Object.keys(card);
        if (keys.length === 0) {
          return `### ${r.name || r.id}（id: ${r.id}）\n（无已填字段）`;
        }
        const lines = keys.map(k => {
          const v = card[k];
          const display = typeof v === 'string'
            ? v
            : JSON.stringify(v);
          return `- ${k}: ${display}`;
        });
        return [`### ${r.name || r.id}（id: ${r.id}）`, ...lines].join('\n');
      });
      return ['## 当前 NPC 卡片快照（仅显示可改字段）', ...blocks].join('\n\n');
    },
    order: 30,
  });

  reg.register('npcCardSync.editableFields', {
    channel: 'npcCardSync',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: 'update_npc 工具暴露的可改字段说明（与 schema 对齐）',
    origin: { file: 'js/services/ai/npcCardSyncPromptBootstrap.js', symbol: 'npcCardSync.editableFields' },
    builder: ctx => {
      const fields = Array.isArray(ctx?.editableFields) ? ctx.editableFields : [];
      if (fields.length === 0) return '## 可改字段\n\n（update_npc 当前无可改字段，本回合应零调用）';
      const lines = fields.map(f => {
        const desc = f.description || f.key;
        const enumHint = Array.isArray(f.enum) && f.enum.length
          ? `（枚举: ${f.enum.join(' / ')}）`
          : '';
        return `- \`${f.key}\` (${f.type || 'string'}): ${desc}${enumHint}`;
      });
      return ['## 可改字段（update_npc 工具暴露）', ...lines].join('\n');
    },
    order: 40,
  });

  reg.register('npcCardSync.callRules', {
    channel: 'npcCardSync',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'npcCardSync 调用规则',
    origin: { file: 'js/services/ai/npcCardSyncPromptBootstrap.js', symbol: 'npcCardSync.callRules' },
    builder: () =>
      [
        '## 调用规则',
        '1. **零调用合法**：reaction 文本里没有明示身份层持久变化时，**不要**调 update_npc。绝大多数回合应是 0 调用。不要"为了改而改"。',
        '2. **每个 NPC 一次调用**：每个需要更新的 NPC 单独调一次 update_npc，args 只传 `id` + 实际变化的字段（不要把现状字段塞进来——审批粒度是字段级，未变的字段被填会被当作"重申现状"产生空审批）。',
        '3. **标签式 ≤3 词**：字段值用标签式短语，不要写长句叙述。',
        '4. **可改字段集自动屏蔽自治字段**：update_npc 已经把 NPC 自治字段（态度、关系、认知、目标、位置、心情等）从 schema 里剔除了。你看到的 properties 就是允许修改的全集。',
        '5. **看重 reaction 自由文本**：structured decision 通常只覆盖位置/心情/目标等运行时状态；身份层变化（衣物破损、外貌演变、阵营加入、修真突破）多半藏在自由文本里。务必通读 reaction 文本再判断。',
        '6. **不要重写整段**：字段是审批粒度，一次只改有变化的子字段。例如 personality 由 "稳重 / 多疑" 变成 "稳重 / 多疑 / 决绝"，传新值；不要因为 "多了一个标签" 就把整段重写成不相关的内容。',
        '7. **变更进审批队列**：你调用 update_npc 后系统返回 `pending_review`，**不是**立即生效。这正常，玩家会逐字段批准。',
      ].join('\n'),
    order: 50,
  });

  console.log('[npcCardSync] 已注册 5 个 prompt blocks');
})();
