// ============================================
// Expand Tools — 游戏中动态扩展世界设定和角色
// ============================================
// 复用世界卡 Phase 2 的生成能力（Stage 1 / Stage 3），
// 包装为 ReAct tool 供游戏 AI 自主调用。
// 内部通过 _callSummaryAPI 发起独立 AI 调用生成结构化 JSON。
// ============================================

(function registerExpandTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[expandTools] toolRegistry 未就绪，跳过注册');
    return;
  }
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // ========================================
  // 辅助函数
  // ========================================

  /**
   * 获取当前运行时的 p1Output（优先从世界卡 designMeta 获取，否则合成）
   */
  function _getP1Output() {
    const ep = window.expandPrompts;
    if (!ep) return null;

    // 尝试从激活的世界卡获取 designMeta
    if (window.worldCardManager) {
      const activeCard = window.worldCardManager.getActiveCard?.();
      if (activeCard?.designMeta?.p1Output) {
        return activeCard.designMeta.p1Output;
      }
    }

    // 回退：从当前三个 store 合成一个"snapshot-like"对象给 prompt 组装使用
    const synthSnapshot = _buildSynthSnapshot();
    if (synthSnapshot && ep._synthesizeP1OutputFromSnapshot) {
      return ep._synthesizeP1OutputFromSnapshot(synthSnapshot);
    }
    return null;
  }

  /**
   * 组装当前运行时快照（供需要 snapshot-like 结构的 prompt 组装使用）
   * 合并了 base + expansion 的效果 —— 直接从三个 store 读取
   */
  function _buildSynthSnapshot() {
    const snap = {};
    const settings = {};
    if (window.entityStore) {
      for (const id of window.entityStore.list()) {
        settings[id] = window.entityStore.get(id);
      }
      snap.world_setting = { settings, _summary: window.entityStore.getSummary() };
    }
    if (window.npcStore?.getCharacterDatabase) {
      snap.character_database = window.npcStore.getCharacterDatabase() || {};
    }
    if (window.npcStore?.getRelationshipRules) {
      const rules = window.npcStore.getRelationshipRules();
      if (rules) snap.relationship_rules = rules;
    }
    if (window.worldMeta?.getPromptConfig) {
      const pc = window.worldMeta.getPromptConfig();
      if (pc) snap.prompt_modules = pc;
    }
    if (window.timelineStore?.getEvents) {
      snap.timeline = {
        events: window.timelineStore.getEvents(),
        _summary: window.timelineStore.getSummary(),
      };
    }
    return Object.keys(snap).length > 0 ? snap : null;
  }

  /**
   * 获取术语约束对象 s3
   */
  function _getS3() {
    const ep = window.expandPrompts;
    if (!ep) return {};
    const step3Fields = window.worldMeta?.getStep3Fields();
    return ep._buildS3FromRuntimeStep3Fields(step3Fields);
  }

  /**
   * 获取现有世界设定 settings（从 entityStore 统一读取，含预定义 + 扩展）
   */
  function _getExistingSettings() {
    const result = {};
    if (window.entityStore) {
      for (const id of window.entityStore.list()) {
        result[id] = window.entityStore.get(id);
      }
    }
    return result;
  }

  /**
   * 获取现有角色数据库（从 npcStore 统一读取，含预定义 + 已登场 + 扩展）
   */
  function _getExistingChars() {
    return window.npcStore?.getCharacterDatabase?.() || {};
  }

  /**
   * 调用 AI 生成并提取 JSON
   * @returns {{ parsed: Object|null, error: string|null }}
   */
  async function _generateAndExtract(systemPrompt) {
    const aiService = window.aiService;
    if (!aiService) return { parsed: null, error: 'aiService 不可用' };

    let response;
    try {
      const messages = [{
        role: 'user',
        content: window.promptRegistry.get('expand.triggerMessage').builder({}),
      }];
      response = await aiService._callSummaryAPI(messages, systemPrompt, 'summary');
    } catch (e) {
      console.error('[expandTools] API 调用失败:', e);
      return { parsed: null, error: `API 调用失败: ${e.message}` };
    }

    if (!response || typeof response !== 'string') {
      return { parsed: null, error: '未收到有效响应' };
    }

    // 使用 designService 的 _extractJSON（纯函数，无副作用）
    const ds = window.designService;
    if (ds && typeof ds._extractJSON === 'function') {
      const result = ds._extractJSON(response, { includeMeta: true, silent: true });
      if (result.parsed) return { parsed: result.parsed, error: null };
      return { parsed: null, error: `JSON 提取失败: ${result.failureKind || '未知原因'}` };
    }

    // 兜底：直接 JSON.parse
    try {
      const match = response.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = match ? match[1].trim() : response.trim();
      return { parsed: JSON.parse(jsonStr), error: null };
    } catch (e) {
      return { parsed: null, error: `JSON 解析失败: ${e.message}` };
    }
  }

  // ========================================
  // Tool 1: update_new_world
  // ========================================

  register('update_new_world', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description: '扩展世界设定：为世界卡尚未定义的区域生成完整的新实体设定（国家/势力/地区等）。调用后会发起独立 AI 生成请求，耗时约 20-30 秒。',
    when_to_call: '当玩家即将前往或到达世界卡中不存在的区域时，需要为该区域生成规范的世界设定。',
    avoid_when: '玩家仍在已有实体的区域活动，不需要新区域设定时。不要用于修改已有实体。',
    input_focus: 'context 应描述需要什么样的新区域：地理特征、文化风格、与现有世界的关系等。',
    expected_output: '返回新增实体的摘要（ID 和简要描述），或错误信息。',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: '描述需要扩展什么：新区域的地理、文化特征、与现有世界的关系等',
        },
      },
      required: ['context'],
      additionalProperties: false,
    },
    async execute(args) {
      const ep = window.expandPrompts;
      if (!ep) return '[错误] expandPrompts 未加载';

      const store = window.entityStore;
      if (!store) return '[错误] entityStore 未加载';

      const p1Output = _getP1Output();
      if (!p1Output) return '[错误] 无法获取世界框架上下文';

      // 发布开始事件
      window.eventBus?.emit?.('WORLD_EXPANSION_START', { type: 'world_setting' });

      const systemPrompt = ep.buildExpandWorldSettingPrompt({
        context: args.context,
        p1Output,
        existingSettings: _getExistingSettings(),
        s3: _getS3(),
      });

      const { parsed, error } = await _generateAndExtract(systemPrompt);

      if (!parsed) {
        window.eventBus?.emit?.('WORLD_EXPANSION_COMPLETE', { type: 'world_setting', ok: false });
        return `[错误] 世界扩展生成失败: ${error}`;
      }

      // 提取 settings
      const newSettings = parsed.settings;
      if (!newSettings || typeof newSettings !== 'object' || Object.keys(newSettings).filter(k => !k.startsWith('_')).length === 0) {
        window.eventBus?.emit?.('WORLD_EXPANSION_COMPLETE', { type: 'world_setting', ok: false });
        return '[错误] 生成结果中未包含有效的实体设定';
      }

      // 写入 entityStore（origin='expanded'）
      const result = store.addBatch(newSettings, parsed._narrativeCoreCharacters);

      console.log('[update_new_world] 新增实体:', result.added);
      window.eventBus?.emit?.('WORLD_EXPANSION_COMPLETE', {
        type: 'world_setting',
        ok: true,
        added: result.added,
      });

      // 构建摘要返回给游戏 AI
      const summary = parsed._summary || result.added.join(', ');
      const entityDetails = result.added.map(id => {
        const text = newSettings[id];
        const preview = typeof text === 'string' ? text.slice(0, 150) : '';
        return `- ${id}: ${preview}...`;
      }).join('\n');

      return `[世界扩展成功] ${summary}\n新增实体:\n${entityDetails}`;
    },
    source: 'static',
  });

  // ========================================
  // Tool 2: update_new_characters
  // ========================================

  register('update_new_characters', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description: '扩展角色数据库：生成完整角色档案（性格、关系网络、认知状态等），写入 character_database。调用后发起独立 AI 请求，耗时约 20-30 秒。',
    when_to_call: '剧情需要引入有完整背景设定的新角色（含关系网络、认知模型），且该角色会持续出现。',
    avoid_when: '已有角色状态更新用 update_npc；临时出场的配角/路人用 new_npc 即可。',
    input_focus: 'context 应描述需要什么角色：身份、与现有角色/势力的关系、在剧情中的作用等。',
    expected_output: '返回新增角色的摘要（ID、名字、简介），或错误信息。',
    parameters: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: '描述需要什么角色：身份背景、与现有角色的关系、在剧情中的作用等',
        },
      },
      required: ['context'],
      additionalProperties: false,
    },
    async execute(args) {
      const ep = window.expandPrompts;
      if (!ep) return '[错误] expandPrompts 未加载';

      const store = window.npcStore;
      if (!store || typeof store.addCharacter !== 'function') {
        return '[错误] npcStore 未加载或不支持 addCharacter';
      }

      const p1Output = _getP1Output();
      if (!p1Output) return '[错误] 无法获取世界框架上下文';

      // 发布开始事件
      window.eventBus?.emit?.('WORLD_EXPANSION_START', { type: 'characters' });

      // 构造当前的世界设定 / prompt_modules 视图（从三个 store 合成）
      const mergedWorldSetting = {
        settings: _getExistingSettings(),
        _summary: window.entityStore?.getSummary?.() || '',
      };
      const promptModules = window.worldMeta?.getPromptConfig?.() || null;

      const systemPrompt = ep.buildExpandCharactersPrompt({
        context: args.context,
        p1Output,
        existingChars: _getExistingChars(),
        worldSetting: mergedWorldSetting,
        promptModules,
        s3: _getS3(),
      });

      const { parsed, error } = await _generateAndExtract(systemPrompt);

      if (!parsed) {
        window.eventBus?.emit?.('WORLD_EXPANSION_COMPLETE', { type: 'characters', ok: false });
        return `[错误] 角色扩展生成失败: ${error}`;
      }

      // 提取 character_database
      const newChars = parsed.character_database;
      if (!newChars || typeof newChars !== 'object' || Object.keys(newChars).filter(k => !k.startsWith('_')).length === 0) {
        window.eventBus?.emit?.('WORLD_EXPANSION_COMPLETE', { type: 'characters', ok: false });
        return '[错误] 生成结果中未包含有效的角色数据';
      }

      // 批量写入 npcStore（origin='expanded'，未登场）
      const added = [];
      const newRules = (parsed.relationship_rules && typeof parsed.relationship_rules === 'object')
        ? parsed.relationship_rules
        : {};
      for (const [charId, charData] of Object.entries(newChars)) {
        if (charId.startsWith('_') || !charData || typeof charData !== 'object') continue;
        const ok = store.addCharacter(charId, charData, 'expanded', newRules[charId] || null);
        if (ok) added.push(charId);
      }
      const result = { added };

      console.log('[update_new_characters] 新增角色:', result.added);
      window.eventBus?.emit?.('WORLD_EXPANSION_COMPLETE', {
        type: 'characters',
        ok: true,
        added: result.added,
      });

      // 构建摘要
      const summary = parsed._summary || result.added.join(', ');
      const charDetails = result.added.map(id => {
        const c = newChars[id];
        return `- ${id}: ${c?.name || '?'} (${c?.gender || '?'}) — ${c?.origin || '未知背景'}`;
      }).join('\n');

      return `[角色扩展成功] ${summary}\n新增角色:\n${charDetails}`;
    },
    source: 'static',
  });

  console.log('[expandTools] 已注册 update_new_world, update_new_characters');
})();
