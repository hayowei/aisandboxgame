// ============================================
// npc-ooc prompt bootstrap — extracted from npc-ooc.js
// ============================================
// 注册 npcReaction / oocRound1 / oocRound2 三个 subagent 通道的 core prompt + trigger 模板。
// 三个消费者（浏览器 / build-prompt-index / promptviewer）共享，无 mirror。
// ============================================

(function bootstrapNpcOocCorePrompts() {
  if (!window.promptRegistry) {
    console.warn('[promptRegistry] npc-ooc bootstrap 失败：promptRegistry 未加载');
    return;
  }
  const reg = window.promptRegistry;

  reg.register('core.npcReaction', {
    channel: 'npcReaction',
    category: 'core',
    source: 'static-file',
    cacheable: false, // NPC reaction 走并行 Promise.all，cacheable 标记反而白付溢价
    description: 'NPC 自主反应子 agent 的角色定义与决策协议（Part 1）',
    origin: { file: 'js/services/ai/npc-ooc.js', symbol: 'CORE_PROMPT_NPC_REACTION' },
    builder: () =>
      typeof globalThis.CORE_PROMPT_NPC_REACTION === 'string'
        ? globalThis.CORE_PROMPT_NPC_REACTION
        : '',
  });

  // ooc R1 和 R2 共用 core.ooc——通过别名引用
  reg.register('core.ooc', {
    channel: 'oocRound1',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: 'OOC 候选片段过滤 / 编辑指令规范化的核心 prompt（R1+R2 共用）',
    origin: { file: 'js/services/ai/npc-ooc.js', symbol: 'CORE_PROMPT_OOC' },
    builder: () =>
      typeof globalThis.CORE_PROMPT_OOC === 'string' ? globalThis.CORE_PROMPT_OOC : '',
  });

  // 同一文本注册到 oocRound2 通道（R2 也需要同样的 core prompt）
  reg.register('core.ooc.r2', {
    channel: 'oocRound2',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: 'OOC Round 2（禁 ask）的核心 prompt（与 R1 共用同一全局常量）',
    origin: { file: 'js/services/ai/npc-ooc.js', symbol: 'CORE_PROMPT_OOC' },
    builder: () =>
      typeof globalThis.CORE_PROMPT_OOC === 'string' ? globalThis.CORE_PROMPT_OOC : '',
  });

  // ── OOC trigger 模板（user message，非 system prompt）──
  reg.register('oocRound1.triggerTemplate', {
    channel: 'oocRound1',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user message 模板，不进 system prompt
    description: 'OOC Round 1 的 user message 模板（候选括号 + 输出契约提醒，中英双版）',
    origin: { file: 'js/services/ai/npc-ooc.js', symbol: 'triggerText (round 1)' },
    builder: ctx => {
      const isEn = ctx?.isEn === true;
      const joined = Array.isArray(ctx?.candidates)
        ? ctx.candidates.map(c => `- ${c}`).join('\n')
        : '<candidates>';
      return isEn
        ? `This is round 1.\nCandidate bracket contents:\n${joined}\n\nOutput a single JSON object per the contract.`
        : `当前是 round 1。\n候选括号内容：\n${joined}\n\n按契约输出一个 JSON 对象。`;
    },
  });

  reg.register('oocRound2.triggerTemplate', {
    channel: 'oocRound2',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user message 模板，不进 system prompt
    description: 'OOC Round 2 的 user message 模板（候选 + Q&A 上下文 + 禁 ask 约束，中英双版）',
    origin: { file: 'js/services/ai/npc-ooc.js', symbol: 'triggerText (round 2)' },
    builder: ctx => {
      const isEn = ctx?.isEn === true;
      const joined = Array.isArray(ctx?.candidates)
        ? ctx.candidates.map(c => `- ${c}`).join('\n')
        : '<candidates>';
      const q = ctx?.askedQuestion || '';
      const ans = typeof ctx?.userAnswer === 'string' ? ctx.userAnswer : '';
      return isEn
        ? `This is round 2.\nCandidate bracket contents:\n${joined}\n\nIn round 1 you asked: "${q}"\nThe player answered: "${ans}"\n\nYou must output either {"mode":"commit","directive":"..."} or {"mode":"continue"}. "ask" is forbidden.`
        : `当前是 round 2。\n候选括号内容：\n${joined}\n\n你在 round 1 问了："${q}"\n玩家回答："${ans}"\n\n必须输出 {"mode":"commit","directive":"..."} 或 {"mode":"continue"}，禁止再 "ask"。`;
    },
  });

  console.log('[promptRegistry] 已注册 npcReaction / oocRound1 / oocRound2 core prompts + trigger templates');
})();
