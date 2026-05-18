// ============================================
// Design Mode + Expand prompt bootstrap
// ============================================
// 把 prompts/designmode.js 与 prompts/expandPrompts.js 中的硬编码 prompt 全部注册到 promptRegistry，
// 让 promptviewer / debugUI Inspector 能看到 Design Mode（P1/P2/P3/Inspection/Repair）和 Expand 工具的完整 prompt。
//
// 加载顺序：必须在 promptRegistry.js 之后、且在 prompts/designmode.js / prompts/i18n_prompts.js / prompts/expandPrompts.js
// 三者全部加载之后（这样这里能取到 globalThis 上的常量）。
//
// 设计要点：
//   - PHASE1/PHASE3/INSPECTION 是字符串 → 单 block 注册
//   - PHASE2_STAGE_PROMPTS 是 4 个 builder 函数（动态拼接 p1Output/s3 等）→ 4 个独立 block
//   - 每个 block 都用 _getDesignPromptValue 路由 zh/en（与运行时一致）
//   - expand 是 builder 函数 → 单 block，ctx 透传
// ============================================

(function bootstrapDesignAndExpandPrompts() {
  if (!window.promptRegistry) {
    console.warn('[promptRegistry] design/expand bootstrap 失败：promptRegistry 未加载');
    return;
  }
  const reg = window.promptRegistry;

  // _getDesignPromptValue 在 design/utils.js 中定义；此文件在其之后加载，已可用
  const designLocalized = (name, fallbackVal) => {
    if (typeof _getDesignPromptValue === 'function') {
      return _getDesignPromptValue(name, fallbackVal);
    }
    return fallbackVal;
  };

  // ─── Design Phase 1（架构师）───
  reg.register('design.phase1.systemPrompt', {
    channel: 'design.phase1',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: '世界卡设计 P1：World Framework Architect 系统 prompt（架构师角色定义 + 输出契约）',
    origin: { file: 'prompts/designmode.js', symbol: 'PHASE1_SYSTEM_PROMPT' },
    builder: () =>
      designLocalized(
        'PHASE1_SYSTEM_PROMPT',
        typeof globalThis.PHASE1_SYSTEM_PROMPT === 'string' ? globalThis.PHASE1_SYSTEM_PROMPT : ''
      ),
  });

  reg.register('design.phase1.greeting', {
    channel: 'design.phase1',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    description: '世界卡启动后展示给用户的欢迎语（首条 assistant 消息，影响后续 P1 对话基调）',
    origin: { file: 'prompts/designmode.js', symbol: 'PHASE1_GREETING' },
    builder: () =>
      designLocalized(
        'PHASE1_GREETING',
        typeof globalThis.PHASE1_GREETING === 'string' ? globalThis.PHASE1_GREETING : ''
      ),
  });

  // ─── Design Phase 2（4 阶段世界生成）───
  // PHASE2_STAGE_PROMPTS 是数组，每项是 (p1Output, ...) => string 的 builder
  // 注册时 ctx 透传 p1Output / worldSetting / promptModules / characterDatabase / s3 等，让 inspector 显示运行时 prompt
  for (let i = 0; i < 4; i++) {
    const stageIdx = i;
    reg.register(`design.phase2.stage${stageIdx}`, {
      channel: 'design.phase2',
      category: 'core',
      source: 'static-file',
      cacheable: false, // 含 p1Output 等动态字段，不可缓存
      order: stageIdx,
      description: `世界卡设计 P2 第 ${stageIdx + 1} 阶段的 prompt（动态接收 p1Output / worldSetting / s3 等）`,
      origin: { file: 'prompts/designmode.js', symbol: `PHASE2_STAGE_PROMPTS[${stageIdx}]` },
      builder: ctx => {
        const stages = designLocalized(
          'PHASE2_STAGE_PROMPTS',
          typeof globalThis.PHASE2_STAGE_PROMPTS !== 'undefined'
            ? globalThis.PHASE2_STAGE_PROMPTS
            : null
        );
        if (!Array.isArray(stages)) return '';
        const fn = stages[stageIdx];
        if (typeof fn !== 'function') return '';
        try {
          return fn(
            ctx?.p1Output || '<p1Output>',
            ctx?.worldSetting || '<worldSetting>',
            ctx?.promptModules || null,
            ctx?.characterDatabase || null,
            ctx?.s3 || null
          ) || '';
        } catch (e) {
          return `<builder error: ${e?.message || e}>`;
        }
      },
    });
  }

  reg.register('design.phase2.triggerMessage', {
    channel: 'design.phase2',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user 触发消息，不进 system prompt
    description: 'P2 各阶段调用 LLM 时的 user 触发消息（"请直接生成。"）',
    origin: { file: 'js/services/design/p2.js', symbol: 'P2 stage user trigger' },
    builder: () => '请直接生成。',
  });

  // ─── Design Phase 3（一致性守护者）───
  reg.register('design.phase3.systemPrompt', {
    channel: 'design.phase3',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: '世界卡设计 P3：Editor & Consistency Guardian 系统 prompt',
    origin: { file: 'prompts/designmode.js', symbol: 'PHASE3_SYSTEM_PROMPT' },
    builder: () =>
      designLocalized(
        'PHASE3_SYSTEM_PROMPT',
        typeof globalThis.PHASE3_SYSTEM_PROMPT === 'string' ? globalThis.PHASE3_SYSTEM_PROMPT : ''
      ),
  });

  // ─── Design Inspection Triage（质量修正员）───
  reg.register('design.inspectionTriage.systemPrompt', {
    channel: 'design.inspectionTriage',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: '世界卡质量修正员 prompt（接收检测失败项列表 + 完整世界卡数据）',
    origin: { file: 'prompts/designmode.js', symbol: 'INSPECTION_TRIAGE_PROMPT' },
    builder: () =>
      designLocalized(
        'INSPECTION_TRIAGE_PROMPT',
        typeof globalThis.INSPECTION_TRIAGE_PROMPT === 'string'
          ? globalThis.INSPECTION_TRIAGE_PROMPT
          : ''
      ),
  });

  // ─── JSON 修复器（P3 内部 utility LLM 调用）───
  reg.register('design.repair.systemPrompt', {
    channel: 'design.repair',
    category: 'core',
    source: 'static-file',
    cacheable: false,
    description: 'P3 流式解析失败后的 JSON 修复器 prompt（极简，只输出合法 JSON）',
    origin: { file: 'js/services/design/repair.js', symbol: 'JSON 修复器 systemPrompt' },
    builder: () => '你是一个 JSON 修复工具。只输出合法 JSON。',
  });

  // ─── Expand 工具（运行时扩展世界卡：worldSetting + characters）───
  reg.register('expand.worldSetting.prompt', {
    channel: 'expand.worldSetting',
    category: 'core',
    source: 'static-file',
    cacheable: false,
    description: 'expand_world_setting 工具：基于现有世界卡 + 玩家上下文动态构造的扩展 prompt',
    origin: { file: 'prompts/expandPrompts.js', symbol: 'buildExpandWorldSettingPrompt' },
    builder: ctx => {
      if (!window.expandPrompts?.buildExpandWorldSettingPrompt) return '';
      try {
        return window.expandPrompts.buildExpandWorldSettingPrompt({
          context: ctx?.context || '<context>',
          p1Output: ctx?.p1Output || '<p1Output>',
          existingSettings: ctx?.existingSettings || null,
          s3: ctx?.s3 || null,
        }) || '';
      } catch (e) {
        return `<builder error: ${e?.message || e}>`;
      }
    },
  });

  reg.register('expand.characters.prompt', {
    channel: 'expand.characters',
    category: 'core',
    source: 'static-file',
    cacheable: false,
    description: 'expand_characters 工具：基于现有角色库 + 世界卡上下文动态构造的扩展 prompt',
    origin: { file: 'prompts/expandPrompts.js', symbol: 'buildExpandCharactersPrompt' },
    builder: ctx => {
      if (!window.expandPrompts?.buildExpandCharactersPrompt) return '';
      try {
        return window.expandPrompts.buildExpandCharactersPrompt({
          context: ctx?.context || '<context>',
          p1Output: ctx?.p1Output || '<p1Output>',
          existingChars: ctx?.existingChars || null,
          worldSetting: ctx?.worldSetting || '<worldSetting>',
          promptModules: ctx?.promptModules || null,
          s3: ctx?.s3 || null,
        }) || '';
      } catch (e) {
        return `<builder error: ${e?.message || e}>`;
      }
    },
  });

  console.log(
    '[promptRegistry] 已注册 design.phase1/2/3/inspectionTriage/repair + expand.worldSetting/characters'
  );
})();
