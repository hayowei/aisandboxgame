// ============================================
// react prompt bootstrap — extracted from react.js
// ============================================
// 注册 react / summary / chapterSummary / sms / expand 通道 + 14+ react.directive + react.format
// 三个消费者（浏览器 / build-prompt-index / promptviewer）共享，无 mirror。
//
// 注：localized() helper 在 headless 时 window.aiService 不存在，会 fallback 到全局常量
// （SUMMARY_PROMPT / CHAPTER_SUMMARY_PROMPT / SMS_PROMPT 由 prompts/[Fixed]*_prompt.js 提供）。
// ============================================

// ============================================
// promptRegistry 注册：summary / chapterSummary / sms 三个 subagent 通道
// 这些通道的 prompt 来自全局常量（prompts/[Fixed]*_prompt.js），通过 i18n helper 切语言
// ============================================
(function bootstrapSubagentCorePrompts() {
  if (!window.promptRegistry) {
    console.warn('[promptRegistry] bootstrap 失败：promptRegistry 未加载');
    return;
  }
  const reg = window.promptRegistry;

  // 通过 aiService 实例访问 i18n helper（builder 调用时 aiService 已就绪）
  const localized = (key, fallbackGlobal) => {
    const ai = window.aiService;
    if (!ai) return fallbackGlobal || '';
    try {
      const locale = ai._getGamePromptLanguage?.() || 'zh-CN';
      return ai._getLocalizedGlobalPromptValue?.(key, locale) || fallbackGlobal || '';
    } catch (e) {
      return fallbackGlobal || '';
    }
  };

  reg.register('summary.corePrompt', {
    channel: 'summary',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: 'Turn summary 子 agent 系统提示（一句话总结协议）',
    origin: { file: 'prompts/[Fixed]summary_prompt.js', symbol: 'SUMMARY_PROMPT' },
    builder: () =>
      localized('SUMMARY_PROMPT', typeof SUMMARY_PROMPT !== 'undefined' ? SUMMARY_PROMPT : ''),
  });

  reg.register('chapterSummary.corePrompt', {
    channel: 'chapterSummary',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: 'Chapter summary 子 agent 系统提示（章节压缩协议）',
    origin: { file: 'prompts/[Fixed]summary_prompt.js', symbol: 'CHAPTER_SUMMARY_PROMPT' },
    builder: () =>
      localized(
        'CHAPTER_SUMMARY_PROMPT',
        typeof CHAPTER_SUMMARY_PROMPT !== 'undefined' ? CHAPTER_SUMMARY_PROMPT : ''
      ),
  });

  reg.register('sms.corePrompt', {
    channel: 'sms',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: 'SMS 短信回复子 agent 系统提示（角色模拟协议）',
    origin: { file: 'prompts/[Fixed]sms_prompt.js', symbol: 'SMS_PROMPT' },
    builder: () =>
      localized('SMS_PROMPT', typeof SMS_PROMPT !== 'undefined' ? SMS_PROMPT : ''),
  });

  // ============================================
  // ReAct 主回路 inline 指令（user message，直接拼到消息流）
  // 这些短句不在 systemParts 中，但每个都精确决定 AI 下一轮工具调用走向，
  // 注册到 react 通道 category='directive'，inspector 可见
  // ============================================

  // ── tool 错误回灌（也是一种 micro-prompt：AI 看到后切换工具）──
  reg.register('react.directive.npcRedirectToLoadPredefined', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'new_npc 命中预定义角色时回灌的错误消息：引导 AI 改用 load_predefined_npc',
    origin: { file: 'js/tools/npcTools.js', symbol: 'new_npc 预检 1' },
    builder: ctx => {
      const lookup = ctx?.lookup || '<lookup>';
      const predefinedId = ctx?.predefinedId || '<id>';
      return `[错误] "${lookup}" 属于预定义角色 (${predefinedId})，请改用 load_predefined_npc 激活，不要用 new_npc 自创。`;
    },
  });

  reg.register('react.directive.npcRedirectToUpdate', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'new_npc 重复创建已登场角色时回灌的错误消息：引导 AI 改用 update_npc',
    origin: { file: 'js/tools/npcTools.js', symbol: 'new_npc 预检 2' },
    builder: ctx => {
      const id = ctx?.id || '<id>';
      return `[错误] 角色 "${id}" 已登场，请改用 update_npc 更新其字段。`;
    },
  });

  reg.register('react.directive.npcLoadPredefinedNotFound', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'load_predefined_npc 找不到目标 id 时回灌的错误消息（已登场或非预定义）',
    origin: { file: 'js/tools/npcTools.js', symbol: 'load_predefined_npc 预检' },
    builder: ctx => {
      const id = ctx?.id || '<id>';
      return `[错误] "${id}" 不在未登场预定义池中，可能已登场或非预定义角色。`;
    },
  });

  // ── 重复 / 越权 tool 调用回灌（来自 prompt-gm.js _executeToolCalls）──
  reg.register('react.directive.duplicateNarrative', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'update_narrative 重复调用（同一文本已记录）时回灌的错误消息',
    origin: { file: 'js/services/ai/prompt-gm.js', symbol: 'duplicate request narrative' },
    builder: () => '[重复：该段叙事已记录，请继续写新内容或结束回合]',
  });

  reg.register('react.directive.duplicateQuery', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: '只读查询 tool 重复调用时回灌的错误消息',
    origin: { file: 'js/services/ai/prompt-gm.js', symbol: 'duplicate request query' },
    builder: () => '[已查询，结果见上文]',
  });

  reg.register('react.directive.dispatcherManagedRejected', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'AI 错误调用 dispatcher-managed tool（如 update_panel）时的拒绝消息',
    origin: { file: 'js/services/ai/prompt-gm.js', symbol: 'dispatcher-managed rejected' },
    builder: ctx => {
      const toolName = ctx?.toolName || '<toolName>';
      return `${toolName} 由系统在结算阶段自动处理，无需手动调用。请继续叙事或调用 update_choices 结束回合。`;
    },
  });

  // ============================================
  // Branch B 轮次 coda（iter2 / iter3 / iter4 各一份）
  // CORE_PROMPT_ITER2 共享 system 给了角色 + 工具 + 策略；轮次 coda 在 Branch B
  // loop 里每轮注入一段 user-role 信息块，告诉模型"你在第 N/3 轮"以及本轮焦点
  // （规划 / 深入 / 终止）。**纯信息陈述**，不与 system 任何指令冲突，与之前删掉的
  // stage 2 user-role 禁令型 directive 性质不同。
  // ============================================
  reg.register('react.directive.iter2_4Round1', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'Branch B 第 1 轮（iter2）轮次 coda——首轮规划提示',
    origin: { file: 'js/services/ai/react.js', symbol: 'Branch B loop iter2 coda' },
    builder: ctx => {
      const isEn = ctx?.isEn === true;
      return isEn
        ? '[Branch B · round 1/3 (2 rounds remain)] Plan from scratch. Based on the opening directive / predefined character roster / rule module preview shown in the system blocks above, choose the queries most useful for the main thread. Multiple read tools can be called in parallel.'
        : '本轮是 Branch B 第 1/3 轮（还剩 2 轮）。从零规划：基于上方系统块给的开场指令 / 角色名单 / 规则模块清单，选择对主线最有用的查询发起。可同时调多个工具。';
    },
  });

  reg.register('react.directive.iter2_4Round2', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'Branch B 第 2 轮（iter3）轮次 coda——基于上轮结果深入或换角度',
    origin: { file: 'js/services/ai/react.js', symbol: 'Branch B loop iter3 coda' },
    builder: ctx => {
      const isEn = ctx?.isEn === true;
      return isEn
        ? '[Branch B · round 2/3 (1 round remains)] Round 1 tool results are in the conversation history above. This round should either dig deeper based on round 1 findings (any unresolved threads), or branch to a different angle to fill gaps. If round 1 already gave you enough, return zero tool calls immediately to terminate.'
        : '本轮是 Branch B 第 2/3 轮（还剩 1 轮）。第 1 轮的工具结果已在上方对话历史里。本轮应基于第 1 轮发现深入（未解开的线索）或换角度补缺。如果第 1 轮已经够，立刻返回零 tool call 终止。';
    },
  });

  reg.register('react.directive.iter2_4Round3', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: 'Branch B 第 3 轮（iter4）轮次 coda——最后一轮，强偏向终止',
    origin: { file: 'js/services/ai/react.js', symbol: 'Branch B loop iter4 coda' },
    builder: ctx => {
      const isEn = ctx?.isEn === true;
      return isEn
        ? '[Branch B · round 3/3] This is the **final round** — there is no round 4. **By default you should return zero tool calls to terminate**. Only issue queries this round if there is a specific, concrete fact unfound in rounds 1-2 that the main thread genuinely needs.'
        : '本轮是 Branch B 第 3/3 轮——chain 的**最后一轮**，之后没有第 4 轮。**默认应当返回零 tool call 终止**。仅当存在前两轮未能查到的、对主线确实重要的具体事实时，才发起本轮查询。';
    },
  });

  reg.register('react.directive.settlementSummaryWrapper', {
    channel: 'react',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: '硬停 force payload 之前注入的结算摘要包装（"[系统结算摘要]\\n..."），让 AI 看到最新状态',
    origin: { file: 'js/services/ai/react.js', symbol: 'settlement summary 注入' },
    builder: ctx => {
      const summaryText = ctx?.summaryText || '<summaryText>';
      return `[系统结算摘要]\n${summaryText}`;
    },
  });

  // expand 工具的 user trigger
  reg.register('expand.triggerMessage', {
    channel: 'expand.worldSetting',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user 触发消息，不进 system prompt
    description: 'Expand 工具（worldSetting + characters 共用）的 user 触发消息',
    origin: { file: 'js/tools/expandTools.js', symbol: '_generateAndExtract user trigger' },
    builder: () => '请直接生成。',
  });

  reg.register('react.format.archiveSearchResult', {
    channel: 'react',
    category: 'messageFormat',
    source: 'static-file',
    cacheable: false,
    description: 'search_history tool 返回给 AI 的搜索结果格式（"[玩家行动] T123: 摘要片段"）',
    origin: { file: 'js/tools/archiveTools.js', symbol: 'search_history result format' },
    builder: ctx => {
      const turnNum = ctx?.turnNum ?? '<turn>';
      const snippet = ctx?.snippet || '<snippet>';
      return `[玩家行动] T${turnNum}: ${snippet}`;
    },
  });

  console.log('[promptRegistry] 已注册 summary/chapterSummary/sms core prompts + react directives (settlementSummaryWrapper/npc redirects/duplicate guards/dispatcherManaged) + 3 Branch B round coda + expand trigger + archive search format');
})();
