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

  // ─── Design 欢迎语（老 P1/P2 prompt 注册已随 PZWC 替换拆除；PZWC 引擎的提示词在 内部内核，不走 promptRegistry）───
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



  // ─── Design Phase 3（JSON Patch 编辑助手）───
  reg.register('design.phase3.systemPrompt', {
    channel: 'design.phase3',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: '世界卡设计 P3：JSON Patch 编辑助手系统 prompt（base 部分，不含 schema doc）',
    origin: { file: 'prompts/p3SystemPrompt.js', symbol: '__skd_init' },
    builder: () =>
      designLocalized(
        '__skd_init',
        typeof globalThis.__skd_init === 'string' ? globalThis.__skd_init : ''
      ),
  });

  // ─── Design Phase 3 schema doc（V2 schema 教学文档）───
  reg.register('design.phase3.schemaDoc', {
    channel: 'design.phase3',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    description: '世界卡设计 P3：V2 schema 文档（从 内部设计文档 构建）',
    origin: { file: 'prompts/p3SchemaDoc.js', symbol: '__rfb_data' },
    builder: () =>
      typeof globalThis.__rfb_data === 'string' ? globalThis.__rfb_data : '',
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
    '[promptRegistry] 已注册 design.phase1/2/3 + design.phase3.schemaDoc + expand.worldSetting/characters'
  );
})();
