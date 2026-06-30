// ============================================
// npcIntroAudit Prompt Bootstrap（代号 him）
// ============================================
// 注册 channel='npcIntroAudit' 下的 5 个 prompt block，供 npcIntroAuditSubagent
// 通过 promptRegistry.assembleChannel('npcIntroAudit', ctx) 装配。
//
// 角色：回合叙事定稿后接力一次 API call，让模型看完最终全叙事 + 当前 NPC 名单 +
// 预定义池，判断是否有**重要新角色**在叙事中登场却没进角色档案；如有则调
// new_npc / load_predefined_npc 建卡（走现有 processNpcPanel 落地）。
//
// 与 npcCardSync 解耦：npcCardSync 管已存在 NPC 身份层字段（数据源=reaction），
// 本 subagent 只管"漏建卡的新角色"（数据源=最终叙事），不碰 update_npc / update_item。
// ============================================

(function registerNpcIntroAuditPrompts() {
  const reg = window.promptRegistry;
  if (!reg) {
    console.warn('[npcIntroAudit] promptRegistry 未加载，跳过注册');
    return;
  }

  reg.register('npcIntroAudit.role', {
    channel: 'npcIntroAudit',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'npcIntroAudit 角色与任务定义',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.role' },
    builder: () =>
      [
        '## 角色',
        '你是 NPC 登场审计员。本回合叙事已经定稿。',
        '你的任务：审视本回合最终叙事，判断是否有**重要新角色**在叙事中登场了，却还没有进入角色档案；如有，调用 `new_npc` 或 `load_predefined_npc` 把缺失的角色建卡（变更经现有落地流程，玩家可见）。',
        '',
        '你**只**负责"漏建卡的新角色"。已存在角色的身份层字段更新、物品栏变化都不归你管，**不要**调 `update_npc` / `update_item`。',
      ].join('\n'),
    order: 10,
  });

  reg.register('npcIntroAudit.summaryDigest', {
    channel: 'npcIntroAudit',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '之前剧情滚动摘要（判角色是否早有铺垫/跨回合反复出现）',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.summaryDigest' },
    builder: ctx => {
      const digest = (ctx && typeof ctx.summaryDigest === 'string' ? ctx.summaryDigest : '').trim();
      if (!digest) return '';
      return ['## 之前剧情摘要（压缩骨架——据此判角色是否早就反复出现）', digest].join('\n');
    },
    order: 15,
  });

  reg.register('npcIntroAudit.recentTurns', {
    channel: 'npcIntroAudit',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '最近若干回合原文（摘要压缩掉的近文细节）',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.recentTurns' },
    builder: ctx => {
      const recent = (ctx && typeof ctx.recentTurns === 'string' ? ctx.recentTurns : '').trim();
      if (!recent) return '';
      return ['## 最近若干回合原文（追踪角色连续出现）', recent].join('\n');
    },
    order: 17,
  });

  reg.register('npcIntroAudit.narrative', {
    channel: 'npcIntroAudit',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '本回合最终全叙事',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.narrative' },
    builder: ctx => {
      const narrative = (ctx && typeof ctx.narrative === 'string' ? ctx.narrative : '').trim();
      return ['## 本回合最终叙事', narrative || '（无叙事文本）'].join('\n');
    },
    order: 20,
  });

  reg.register('npcIntroAudit.currentRoster', {
    channel: 'npcIntroAudit',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '当前已登场/已选中 NPC 名单（这些不要重复建卡）',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.currentRoster' },
    builder: ctx => {
      const roster = Array.isArray(ctx?.roster) ? ctx.roster : [];
      if (roster.length === 0) {
        return ['## 当前已登场角色', '（当前没有任何已登场角色）'].join('\n');
      }
      const lines = roster.map(r => `- ${r.name || r.id}（id: ${r.id}）`);
      return [
        '## 当前已登场角色（**这些已在档案里，绝对不要再为他们建卡**）',
        ...lines,
      ].join('\n');
    },
    order: 30,
  });

  reg.register('npcIntroAudit.predefinedPool', {
    channel: 'npcIntroAudit',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    description: '世界卡预定义池中尚未登场的角色（命中则用 load_predefined_npc）',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.predefinedPool' },
    builder: ctx => {
      const pool = Array.isArray(ctx?.predefinedPool) ? ctx.predefinedPool : [];
      if (pool.length === 0) {
        return ['## 世界卡预定义角色池', '（无预定义池，新角色一律用 new_npc 原创建卡）'].join('\n');
      }
      const lines = pool.map(p => `- ${p.name || p.id}（id: ${p.id}）`);
      return [
        '## 世界卡预定义角色池（尚未登场）',
        '若叙事中登场的新角色命中下表，**必须**用 `load_predefined_npc(id)`，不要用 new_npc 另造同名原创：',
        ...lines,
      ].join('\n');
    },
    order: 40,
  });

  reg.register('npcIntroAudit.callRules', {
    channel: 'npcIntroAudit',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'npcIntroAudit 调用规则（重要性闸 + 去重）',
    origin: { file: 'js/services/ai/npcIntroAuditPromptBootstrap.js', symbol: 'npcIntroAudit.callRules' },
    builder: () =>
      [
        '## 调用规则',
        '1. **零调用合法、且应是多数回合的常态**：只为**反复出现 / 与玩家或他人有对话 / 推动剧情**的角色建卡。路过提一嘴的龙套、群众、店小二甲、抽象群体（"士兵们""村民"）**一律不建**。宁可不建，也不要刷屏角色面板。判"反复出现"时**结合上方剧情摘要与最近回合原文**看该角色是否跨回合多次登场/早有铺垫——不要只看本回合戏份大小（一个前几回合一直在、本回合戏份小的关键角色，仍应补卡）。',
        '2. **命中预定义池 → `load_predefined_npc(id)`**；纯原创新角色 → `new_npc(id, name, 完整字段)`。',
        '3. **已在"当前已登场角色"名单里的，一律不调**——避免与主循环本回合刚建的重复。',
        '4. **不调 `update_npc` / `update_item`**：那不在你的职责范围。',
        '5. 每个需要建卡的角色单独调一次工具。',
      ].join('\n'),
    order: 50,
  });

  console.log('[npcIntroAudit] 已注册 5 个 prompt blocks');
})();
