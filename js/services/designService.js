/**
 * designService.js
 * 世界卡核心服务 - V2 三阶段架构
 *
 * Phase 1 (The Architect):  对话式世界框架采集
 * Phase 2 (The Builders):   串行4次API调用生成结构化JSON（World → Rules → Chars+Relations → Timeline+CharTimelines）
 * Phase 3 (Review & Edit):  审阅编辑
 *
 * 职责：
 * 1. 管理三阶段状态机（p1 → p2 → p3）
 * 2. Phase 1: 与 AI 对话收集世界框架
 * 3. Phase 2: 串行生成5个JSON数据块（World → Rules → Chars → Timeline → CharTimelines）
 * 4. Phase 3: 无状态快照编辑模式
 * 5. 预览面板更新
 * 6. 配置导出和应用到游戏
 */

class DesignService {
  constructor() {
    this.designConfig = this._loadDesignConfig();
    this.phase = 'p1'; // 'p1' | 'p2' | 'p3'
    this.p2Stage = 0; // Phase 2 当前阶段 (0=未开始, 1-4=执行中)
    this.p2ReviewStage = null; // Phase 2 卡牌审阅暂停点（null=无暂停, 3=Stage 3 完成等待审阅）
    this.p1Output = null; // Phase 1 输出的5个框架文本
    this._designQnaPending = null; // P1→P2 转换时构建好的 design_qna 模块 ({ text, meta })，stage 2 commit 后写入 prompt_modules
    this.worldCardName = ''; // 世界卡名称（用户可编辑）
    this.worldCardDescription = ''; // 世界卡描述（用户可编辑）
    this.completionFingerprint = null; // 最近一次“已完成”基线
    this.forceCreateNewOnNextApply = false; // 下一次应用是否强制新建世界卡
    this._draftSourceType = DESIGN_DRAFT_SOURCE_NEW_WORLD;
    this.isProcessing = false;
    this.isAutoGenerating = false;
    this.designRequestAbortController = null;
    this.phase2RunToken = 0;
    this.activePhase2RunToken = null;
    this.phase2AbortController = null;
    this.pendingOperations = []; // P3 待用户确认的编辑操作（旧，保留兼容）
    this.p3Session = {
      sm: new P3SessionStateMachine(),
      enrichedOps: [],
      p3History: [],  // P3 对话记忆：[{role, content, appliedSummary}]
      sessionSnapshot: null,   // abort 恢复用（整个 session 快照）
      lastError: null,
    };
    this._p3AbortController = null;
    this.stageValidationReports = {}; // Stage 质量报告（用于预览与调试）
    this._reimportSourceCardId = null; // 重新导入编辑时的源世界卡ID
    this._allowOverwriteFromCardEdit = false; // 仅“在世界卡中编辑”入口允许覆盖
    this.pendingGameBootstrap = null; // 新世界应用成功后，切回沙盒时的一次性引导标记
    this._lastRejectedFramework = null; // 最近一次被验证拒绝的框架（用于 force completion 参考）
    this.p1State = null; // P1 状态机（在 _restoreState 中初始化）
    this._saveDebounceTimer = null;
    this._saveIndicatorTimer = null;
    this._lifecycleEventsBound = false;
    // 复杂度信息（从持久化 config 恢复或默认）
    this.designTargetStages = this.designConfig._targetStages || PHASE2_TOTAL_STAGES;
    this._restoreState();
    this._initPreviewPanel();
    this._bindLifecycleEvents();
  }

  /**
   * 后向兼容：将旧三级复杂度映射为新二级（lite/full）
   */
  _normalizeComplexity(raw) {
    if (raw === 'lite' || raw === 'full') return raw;
    if (raw === 'character_driven') return 'lite';
    if (raw === 'story_driven' || raw === 'world_driven') return 'full';
    return null; // 未选择模式时返回 null，等待用户在 Phase 1 第二轮选择
  }

  // ========================================
  // 状态持久化
  // ========================================

  _loadDesignConfig() {
    try {
      const saved = localStorage.getItem('design_mode_config');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn('[DesignService] 加载配置失败:', e);
    }
    return {};
  }

  _restoreState() {
    try {
      const meta = localStorage.getItem('design_mode_meta');
      if (meta) {
        const parsed = JSON.parse(meta);
        const restoredPhase = parsed.phase || 'p1';
        this.phase = restoredPhase === 'done' ? 'p3' : restoredPhase;
        this.p2Stage = parsed.p2Stage || 0;
        this.p2ReviewStage =
          typeof parsed.p2ReviewStage === 'number' && parsed.p2ReviewStage > 0
            ? parsed.p2ReviewStage
            : null;
        this.p1Output = parsed.p1Output || null;
        this._designQnaPending =
          parsed._designQnaPending && typeof parsed._designQnaPending === 'object'
            ? parsed._designQnaPending
            : null;
        this.worldCardName = parsed.worldCardName || '';
        this.worldCardDescription = parsed.worldCardDescription || '';
        this.completionFingerprint = parsed.completionFingerprint || null;
        this._draftSourceType = parsed.draftSourceType || DESIGN_DRAFT_SOURCE_NEW_WORLD;
        // P1 状态机恢复
        if (parsed.p1State && typeof parsed.p1State === 'object') {
          this.p1State = P1StateMachine.deserialize(parsed.p1State);
        } else if (parsed.dimensionCoverage && typeof parsed.dimensionCoverage === 'object') {
          // 旧格式迁移
          this.p1State = this._migrateOldStateToP1StateMachine(parsed);
        }
      }
    } catch (e) {
      console.warn('[DesignService] 恢复状态失败:', e);
    }
    // 确保 p1State 总是存在
    if (!this.p1State) {
      this.p1State = new P1StateMachine();
    }
    // 覆盖上下文仅在当前会话有效，不做持久化恢复
    this._reimportSourceCardId = null;
    this._allowOverwriteFromCardEdit = false;
    this.forceCreateNewOnNextApply = false;
    this.pendingGameBootstrap = null;
    if (!this._draftSourceType) {
      this._draftSourceType = DESIGN_DRAFT_SOURCE_NEW_WORLD;
    }
  }

  /**
   * 旧 dimensionCoverage 格式迁移到 P1StateMachine
   */
  _migrateOldStateToP1StateMachine(savedMeta) {
    const sm = new P1StateMachine();
    const complexity = this._normalizeComplexity(savedMeta._complexity || this.designConfig._complexity);
    if (complexity) {
      sm.mode = complexity;
    }
    const oldCoverage = savedMeta.dimensionCoverage || {};
    for (const [key, count] of Object.entries(oldCoverage)) {
      if (count > 0 && sm.dimensionEvidence[key]) {
        sm.dimensionEvidence[key].rounds = count;
        sm.dimensionEvidence[key].confidence = count >= 2 ? 'sufficient' : 'partial';
      }
    }
    const total = Object.values(oldCoverage).reduce((a, b) => a + b, 0);
    if (!sm.mode && total === 0) {
      sm.state = P1_STATES.INIT;
    } else if (!sm.mode) {
      sm.state = P1_STATES.R1_ANSWERED;
      sm.round = 1;
    } else {
      sm.state = P1_STATES.RN_PENDING;
      sm.round = total + 2;
    }
    return sm;
  }

  _getUiText(zh, en) {
    return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? en : zh;
  }

  _isCardEditSession() {
    return this._draftSourceType === DESIGN_DRAFT_SOURCE_CARD_EDIT;
  }

  _getPersistableChatHistoryRef() {
    if (typeof designChatHistory !== 'undefined' && Array.isArray(designChatHistory)) {
      if (typeof isDesignMode === 'undefined' || !isDesignMode) {
        return designChatHistory;
      }
    }
    if (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory)) {
      return chatHistory;
    }
    if (typeof designChatHistory !== 'undefined' && Array.isArray(designChatHistory)) {
      return designChatHistory;
    }
    return null;
  }

  _hasMeaningfulP1Progress(p1State = this.p1State) {
    if (!p1State || typeof p1State !== 'object') return false;
    if (typeof p1State.getRound === 'function' && p1State.getRound() > 0) return true;
    if (typeof p1State.round === 'number' && p1State.round > 0) return true;
    if (typeof p1State.getMode === 'function' && p1State.getMode()) return true;
    if (typeof p1State.mode === 'string' && p1State.mode.trim()) return true;
    if (typeof p1State.getStyle === 'function' && p1State.getStyle()) return true;
    if (typeof p1State.style === 'string' && p1State.style.trim()) return true;
    const evidence =
      typeof p1State.getDimensionEvidence === 'function'
        ? p1State.getDimensionEvidence()
        : p1State.dimensionEvidence;
    if (!evidence || typeof evidence !== 'object') return false;
    return Object.values(evidence).some(entry => {
      if (!entry || typeof entry !== 'object') return false;
      if (Number.isFinite(entry.rounds) && entry.rounds > 0) return true;
      return Array.isArray(entry.snippets) && entry.snippets.length > 0;
    });
  }

  _hasMeaningfulDraft(chatHistoryRef = this._getPersistableChatHistoryRef()) {
    if (this._isCardEditSession()) return false;
    if (this.phase === 'p2') return true;
    if (Array.isArray(this.pendingOperations) && this.pendingOperations.length > 0) return true;

    const hasConfigContent =
      !!this.designConfig &&
      typeof this.designConfig === 'object' &&
      Object.keys(this.designConfig).length > 0;

    if (hasConfigContent) {
      if (this.completionFingerprint) {
        const currentFingerprint = this.computeConfigFingerprint(this.designConfig);
        if (
          currentFingerprint === this.completionFingerprint &&
          (this.phase === 'p3' || this.phase === 'done')
        ) {
          return false;
        }
        if (currentFingerprint !== this.completionFingerprint) {
          return true;
        }
      } else {
        return true;
      }
    }

    if (this.phase === 'p3' || this.phase === 'done') {
      return false;
    }

    if (this.p1Output) return true;

    if (this._hasMeaningfulP1Progress()) {
      return true;
    }

    if (!Array.isArray(chatHistoryRef) || chatHistoryRef.length === 0) {
      return false;
    }

    return chatHistoryRef.some((msg, index) => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.sender === 'user') return true;
      if (msg.frameworkReady || msg.isError) return true;
      if (msg.p1FlowState || Array.isArray(msg.p1Questions)) return true;
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      return index > 0 && text.length > 0;
    });
  }

  _shouldPersistDesignDraft(chatHistoryRef = this._getPersistableChatHistoryRef()) {
    return !this._isCardEditSession() && this._hasMeaningfulDraft(chatHistoryRef);
  }

  clearPersistedDraft() {
    _clearStoredDesignDraft();
  }

  _saveDesignConfig(options = {}) {
    const {
      skipRefresh = false,
      skipIndicator = false,
      chatHistoryRef = null,
      forcePersist = false,
    } = options || {};
    const historyRef = Array.isArray(chatHistoryRef) ? chatHistoryRef : this._getPersistableChatHistoryRef();
    const shouldPersist = forcePersist || this._shouldPersistDesignDraft(historyRef);
    try {
      if (shouldPersist) {
        localStorage.setItem('design_mode_config', JSON.stringify(this.designConfig));
        localStorage.setItem(
          'design_mode_meta',
          JSON.stringify({
            phase: this.phase,
            p2Stage: this.p2Stage,
            p2ReviewStage: this.p2ReviewStage,
            p1Output: this.p1Output,
            _designQnaPending: this._designQnaPending,
            worldCardName: this.worldCardName,
            worldCardDescription: this.worldCardDescription,
            completionFingerprint: this.completionFingerprint || null,
            p1State: this.p1State ? this.p1State.serialize() : null,
            draftSourceType: this._draftSourceType,
            hasDraft: true,
            savedAt: Date.now(),
          })
        );
      }
      // 刷新世界卡右侧栏世界卡信息（仅在世界卡且磁贴可见时）
      if (
        !skipRefresh &&
        window.worldCardInfoUI &&
        typeof isDesignMode !== 'undefined' &&
        isDesignMode
      ) {
        window.worldCardInfoUI.refresh();
      }
      if (!skipIndicator && shouldPersist) {
        this._updateSaveIndicator('saved');
      }
    } catch (e) {
      console.warn('[DesignService] 保存配置失败:', e);
      if (!skipIndicator && shouldPersist) {
        this._updateSaveIndicator('error');
      }
    }
  }

  _fullSave(chatHistoryRef = null, options = {}) {
    const historyRef = Array.isArray(chatHistoryRef) ? chatHistoryRef : this._getPersistableChatHistoryRef();
    this._saveDesignConfig({ ...options, chatHistoryRef: historyRef });
    if (Array.isArray(historyRef)) {
      this.saveChatHistory(historyRef);
    }
  }

  /**
   * D11: debounced save 用于 undo/redo 频繁触发场景
   */
  _saveDesignConfigDebounced() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
    }
    this._saveDebounceTimer = setTimeout(() => {
      this._saveDesignConfig();
    }, 500);
  }

  flushAllPendingSaves() {
    if (this._saveDebounceTimer) {
      clearTimeout(this._saveDebounceTimer);
      this._saveDebounceTimer = null;
    }
    try {
      this._fullSave(this._getPersistableChatHistoryRef(), { skipRefresh: true });
    } catch (e) {
      console.warn('[DesignAutoSave] 紧急保存失败:', e);
      this._updateSaveIndicator('error');
    }
  }

  _bindLifecycleEvents() {
    if (this._lifecycleEventsBound) return;

    const isActiveDesignSession = () => typeof isDesignMode !== 'undefined' && isDesignMode;

    this._lifecycleEventsBound = true;

    window.addEventListener('beforeunload', () => {
      if (!isActiveDesignSession()) return;
      this.flushAllPendingSaves();
    });

    document.addEventListener('freeze', () => {
      if (isActiveDesignSession()) {
        this.flushAllPendingSaves();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isActiveDesignSession()) {
        this.flushAllPendingSaves();
      }
    });

    window.addEventListener('pagehide', () => {
      if (isActiveDesignSession()) {
        this.flushAllPendingSaves();
      }
    });
  }

  _updateSaveIndicator(state) {
    const indicator = document.getElementById('design-autosave-indicator');
    if (!indicator) return;

    const iconEl = indicator.querySelector('.das-icon');
    const textEl = indicator.querySelector('.das-text');
    if (!iconEl || !textEl) return;

    indicator.classList.remove('das-idle', 'das-saved', 'das-error');
    if (this._saveIndicatorTimer) {
      clearTimeout(this._saveIndicatorTimer);
      this._saveIndicatorTimer = null;
    }

    if (state === 'error') {
      iconEl.textContent = 'error_outline';
      textEl.textContent = this._getUiText('保存失败', 'Save failed');
      indicator.classList.add('das-error');
      return;
    }

    iconEl.textContent = 'cloud_done';
    textEl.textContent = this._getUiText('已保存', 'Saved');
    indicator.classList.add('das-saved');
    this._saveIndicatorTimer = setTimeout(() => {
      indicator.classList.remove('das-saved', 'das-error');
      indicator.classList.add('das-idle');
      this._saveIndicatorTimer = null;
    }, 3000);
  }

  getDesignConfig() {
    return { ...this.designConfig };
  }

  // 向后兼容：dimensionCoverage 计算属性（从 p1State.dimensionEvidence 派生）
  get dimensionCoverage() {
    if (!this.p1State) return this._defaultDimensionCoverage();
    const evidence = this.p1State.getDimensionEvidence();
    const result = {};
    for (const [key, entry] of Object.entries(evidence)) {
      result[key] = entry.rounds;
    }
    return result;
  }

  // 向后兼容：designComplexity 代理到 p1State.getMode()
  get designComplexity() {
    return this.p1State ? this.p1State.getMode() : null;
  }
  set designComplexity(val) {
    if (this.p1State && (val === 'lite' || val === 'full')) {
      this.p1State.onModeSelected(val);
    }
  }

  _defaultDimensionCoverage() {
    return {
      context_world: 0,
      context_rules: 0,
      context_chars: 0,
      context_timeline: 0,
      style_guide: 0,
    };
  }

  // 旧接口保留为空操作（向后兼容），实际逻辑已移入 _extractAndRecordEvidence
  _updateDimensionCoverage(_questions) { /* no-op: replaced by p1State evidence tracking */ }

  /**
   * @deprecated 由 P1StateMachine 的 onModeSelected/onUpgradeDecision 替代。
   * 保留空方法以兼容可能的外部调用。
   */
  _detectModeFromHistory(_history) {
    // no-op: 模式检测已由 _extractAndRecordEvidence 中的状态机转换处理
  }

  _buildDimensionCoverageNote() {
    const labels = {
      context_world: '世界设定',
      context_rules: '规则系统',
      context_chars: '角色概念',
      context_timeline: '时间线',
      style_guide: '风格基调',
    };
    const complexity = this.designComplexity || this.designConfig?._complexity;
    const totalRounds = Object.values(this.dimensionCoverage).reduce((a, b) => a + b, 0);

    // 判断当前流程阶段
    const modeChosen = complexity === 'lite' || complexity === 'full';
    const isLite = complexity === 'lite';
    const optionalDimensions = isLite
      ? ['context_world', 'context_rules', 'context_timeline']
      : [];

    const lines = Object.entries(this.dimensionCoverage).map(([key, count]) => {
      const label = labels[key] || key;
      const isOptional = optionalDimensions.includes(key);
      if (count > 0) {
        return `- ${label}(${key}): 已讨论${count}轮`;
      }
      return isOptional
        ? `- ${label}(${key}): 尚未讨论（可选，当前模式不强制要求）`
        : `- ${label}(${key}): 尚未讨论`;
    });
    let note = `\n## 当前维度采集进度（系统自动统计）\n${lines.join('\n')}`;

    // 流程阶段提醒
    if (!modeChosen && totalRounds === 0) {
      note += '\n\n### 流程阶段：第一轮（题材深化）';
      note += '\n当前是第一轮对话，专注于理解和深化用户的创意。不要问模式选择，不要问叙事风格。';
    } else if (!modeChosen) {
      note += '\n\n### 流程阶段：第二轮（模式选择 + 风格）';
      note += '\n请在本轮同时完成：1) 让用户选择快速模式/深度定制（target: _mode）；2) 叙事风格选择（target: style_guide）。';
    } else {
      note += `\n\n### 当前模式：${isLite ? '快速模式（lite）' : '深度定制（full）'}`;
      if (isLite) {
        note += '\n快速模式只需详细收集角色概念和风格基调，其余维度自动补全。';
        note += '\n当角色和风格信息充足时，请使用升级提示（target: _upgrade）让用户决定是直接生成还是切换到深度定制。';
      }
    }

    const reminders = [];
    if (this.dimensionCoverage.context_chars < 2 && !optionalDimensions.includes('context_chars')) {
      reminders.push(
        '- 角色档案字段：确认角色需要哪些自定义追踪属性（如势力/境界/种族/职业等级），影响 extra_char_fields 输出'
      );
    }
    if (modeChosen && reminders.length > 0) {
      note += '\n\n### 关键子话题提醒\n' + reminders.join('\n');
    }

    if (modeChosen) {
      note += '\n请优先补充尚未讨论的维度和未确认的子话题。';
    }
    return note;
  }

  /**
   * 构建状态感知的 Phase 1 系统提示词
   * 替代旧的 PHASE1_SYSTEM_PROMPT + coverageNote 拼接
   */
  _buildP1SystemPrompt() {
    const basePrompt = _getDesignPromptValue('PHASE1_SYSTEM_PROMPT', PHASE1_SYSTEM_PROMPT);
    if (!this.p1State) {
      // 降级：无状态机时使用旧逻辑
      return basePrompt + this._buildDimensionCoverageNote();
    }

    const ctx = this.p1State.getRequiredPromptContext();
    const sections = [basePrompt];
    sections.push(this._buildP1StateInstructionSection(ctx));
    sections.push(this._buildP1EvidenceSection(ctx));
    return sections.filter(Boolean).join('\n\n');
  }

  /**
   * 根据状态机状态生成当前轮次的指令注入
   */
  _buildP1StateInstructionSection(ctx) {
    const { state, round, mode, isBacktrackR2, previousMode, previousStyle } = ctx;
    const dimLabels = {
      context_world: '世界设定', context_rules: '规则系统',
      context_chars: '角色概念', context_timeline: '时间线', style_guide: '风格基调',
    };

    if (state === P1_STATES.INIT) {
      return `## 当前轮次上下文
轮次: 1（题材深化）
你的任务: 理解用户的核心创意概念
- 用 1-2 句话复述你对用户创意的理解
- 根据用户描述的侧重点，提 1-2 个深化问题
- 不要问模式选择，不要问叙事风格
- question target 限定为: context_world, context_rules, context_chars, context_timeline`;
    }

    if (state === P1_STATES.R1_ANSWERED) {
      if (isBacktrackR2) {
        return `## 当前轮次上下文
轮次: ${round + 1}（重新选择 — 用户要求修改模式/风格）

⚠️ 注意：聊天历史中包含之前 Round 3+ 的讨论内容，那些信息仍然有效。
用户之前选择了「${previousMode === 'lite' ? '快速模式' : '深度定制'}」模式${previousStyle ? `和「${previousStyle}」风格` : ''}，现在想重新选择。

请重新提出模式选择和风格选择问题。
- Q1 (target: _mode): 选项为「🚀 快速模式 — 聚焦角色和故事风格，世界规则由我自动补全，几轮就能开始」和「🔧 深度定制 — 从世界观、规则、势力、时间线到角色全面定制，打造完整世界」
- Q2 (target: style_guide): 根据题材动态生成 3 个最匹配的风格选项`;
      }
      return `## 当前轮次上下文
轮次: 2（模式选择 + 风格）
你的任务: 让用户选择创建模式和叙事风格
- 用 2-3 句话总结你目前理解的创意方向
- Q1 (target: _mode): 模式选择，两个选项的文案固定为：
  - 选项 A：「🚀 快速模式 — 聚焦角色和故事风格，世界规则由我自动补全，几轮就能开始」
  - 选项 B：「🔧 深度定制 — 从世界观、规则、势力、时间线到角色全面定制，打造完整世界」
- Q2 (target: style_guide): 根据当前题材动态生成 3 个最匹配且有明显区别的文风选项
  - 选项必须是具体可感的风格描述，不要用抽象词汇`;
    }

    if (state === P1_STATES.R2_ANSWERED || state === P1_STATES.RN_ANSWERED) {
      const modeLabel = mode === 'lite' ? '快速模式（lite）' : '深度定制（full）';
      const evidenceLines = Object.entries(ctx.evidence).map(([key, entry]) => {
        const label = dimLabels[key] || key;
        const snippetPreview = entry.snippets.length > 0
          ? entry.snippets.slice(-2).map(s => s.slice(0, 80)).join('; ')
          : '';
        return `- ${label}(${key}): [${entry.confidence}]${snippetPreview ? ` “${snippetPreview}”` : ''}`;
      });

      // 确定优先关注的维度
      const allowed = this.p1State.getAllowedTargets().filter(t => !t.startsWith('_'));
      const priorityDims = allowed
        .filter(t => ctx.evidence[t] && ctx.evidence[t].confidence !== 'sufficient')
        .sort((a, b) => (ctx.evidence[a]?.rounds || 0) - (ctx.evidence[b]?.rounds || 0));
      const priorityHint = priorityDims.length > 0
        ? `\n优先关注: ${priorityDims.map(d => `${dimLabels[d] || d}`).join(', ')}（信息不足）`
        : '';

      let modeHint = '';
      if (mode === 'lite') {
        modeHint = '\n快速模式：只需详细收集角色概念和风格基调，其余维度自动补全。';
        modeHint += '\n当角色和风格信息充足时，使用 target: _upgrade 让用户决定是直接生成还是切换到深度定制。';
      } else {
        modeHint += '\n所有维度达到 sufficient 时输出 FRAMEWORK_READY。';
      }

      return `## 当前轮次上下文
轮次: ${round + 1}（维度收集 - ${modeLabel}）
已收集证据:
${evidenceLines.join('\n')}
${priorityHint}${modeHint}`;
    }

    if (state === P1_STATES.UPGRADE_ANSWERED) {
      return `## 当前轮次上下文
轮次: ${round + 1}（用户已做出升级决策）
用户选择了切换到深度定制模式。之前在快速模式下收集的角色和风格信息保留不变。
现在按深度定制模式继续收集剩余维度：世界设定 → 规则系统 → 时间线。`;
    }

    if (state === P1_STATES.RANDOM_SHORTCUT) {
      return `## 当前轮次上下文
用户要求随机生成。不要反问，直接在差异化题材中随机挑选一个，输出完整且题材一致的 FRAMEWORK_READY（complexity 设为 “full”）。`;
    }

    if (state === P1_STATES.FORCE_COMPLETING) {
      return `## 当前轮次上下文
用户已决定开始生成。请立即整理对话中的全部信息，输出完整的 FRAMEWORK_READY JSON 框架。
对于尚未讨论到的维度，根据已有内容的风格和逻辑用合理默认值自行补全，不要再提问。`;
    }

    // 默认降级
    return this._buildDimensionCoverageNote();
  }

  /**
   * 构建证据摘要注入段（独立于状态指令）
   */
  _buildP1EvidenceSection(ctx) {
    const dimLabels = {
      context_world: '世界设定', context_rules: '规则系统',
      context_chars: '角色概念', context_timeline: '时间线', style_guide: '风格基调',
    };

    // 仅在 R3+ 及之后的状态注入证据摘要
    const needsEvidence = [
      P1_STATES.R2_ANSWERED, P1_STATES.RN_ANSWERED,
      P1_STATES.UPGRADE_ANSWERED, P1_STATES.FORCE_COMPLETING,
    ];
    if (!needsEvidence.includes(ctx.state)) return '';

    const charsEvidence = ctx.evidence.context_chars;
    if (charsEvidence && charsEvidence.confidence !== 'sufficient') {
      return `### 关键子话题提醒
- 角色档案字段：确认角色需要哪些自定义追踪属性（如势力/境界/种族/职业等级），影响 extra_char_fields 输出`;
    }
    return '';
  }

  /**
   * 读取并清空一次性”切回游戏后自动新开局”标记
   * @returns {{ worldCardId: string, createdAt: string }|null}
   */
  consumePendingGameBootstrap() {
    const pending = this.pendingGameBootstrap || null;
    this.pendingGameBootstrap = null;
    return pending;
  }

  _stableSerialize(value) {
    if (value === null) return 'null';
    if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return `[${value.map(v => this._stableSerialize(v)).join(',')}]`;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value).sort();
      const entries = keys.map(k => `${JSON.stringify(k)}:${this._stableSerialize(value[k])}`);
      return `{${entries.join(',')}}`;
    }
    return 'null';
  }

  _hashString(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  computeConfigFingerprint(config = this.designConfig) {
    const serialized = this._stableSerialize(config || {});
    return `v1:${this._hashString(serialized)}:${serialized.length}`;
  }

  markCompletionBaseline() {
    if (!this.designConfig || Object.keys(this.designConfig).length === 0) {
      this.completionFingerprint = null;
      return;
    }
    this.completionFingerprint = this.computeConfigFingerprint(this.designConfig);
  }

  hasUnfinishedWork() {
    return this._hasMeaningfulDraft();
  }

  resetDesignConfig(options = {}) {
    const preservePendingGameBootstrap = options?.preservePendingGameBootstrap === true;
    const preservedBootstrap = preservePendingGameBootstrap ? this.pendingGameBootstrap : null;

    // 先停止任何正在进行的异步操作，防止脏数据写入
    this.isAutoGenerating = false;
    this.isProcessing = false;

    this.designConfig = {};
    this.phase = 'p1';
    this.p2Stage = 0;
    this.p2ReviewStage = null;
    this.p1Output = null;
    this._designQnaPending = null;
    this.worldCardName = '';
    this.worldCardDescription = '';
    this.pendingOperations = []; // 清除 P3 待应用操作
    this.p3Session = {
      sm: new P3SessionStateMachine(),
      enrichedOps: [],
      p3History: [],
      sessionSnapshot: null,
      lastError: null,
    };
    this._p3AbortController = null;
    this.stageValidationReports = {};
    this._reimportSourceCardId = null;
    this._allowOverwriteFromCardEdit = false;
    this.completionFingerprint = null;
    this.forceCreateNewOnNextApply = false;
    this._draftSourceType = DESIGN_DRAFT_SOURCE_NEW_WORLD;
    this.pendingGameBootstrap = null;
    this.p1State = new P1StateMachine();
    this._lastRejectedFramework = null;
    this.clearPersistedDraft();

    // 重置后同步按键状态到 P1（仅在世界卡下）
    if (typeof isDesignMode !== 'undefined' && isDesignMode) {
      if (typeof updateExecuteButtonState === 'function') {
        updateExecuteButtonState('p1');
      }
    }

    // 无论当前模式，始终清空内存中的设计聊天历史
    if (typeof designChatHistory !== 'undefined') {
      designChatHistory.length = 0;
    }
    // 仅在世界卡下更新 UI
    if (typeof isDesignMode !== 'undefined' && isDesignMode) {
      if (typeof chatHistory !== 'undefined') {
        chatHistory.length = 0;
      }
      if (typeof clearChatHistory === 'function') {
        clearChatHistory();
      }
      // 重新显示 Phase 1 问候语
      const greeting = this.getGreeting();
      const providerKey =
        typeof window.resolveDesignProviderKey === 'function'
          ? window.resolveDesignProviderKey()
          : null;
      const modelLabel =
        typeof window.resolveDesignModelLabel === 'function'
          ? window.resolveDesignModelLabel()
          : typeof aiService !== 'undefined' && typeof aiService.getModelForModule === 'function'
            ? (aiService.getModelForModule('p1') || '').trim() || '模型'
            : '模型';
      const assistantLabel =
        typeof window.formatDesignAssistantLabel === 'function'
          ? window.formatDesignAssistantLabel(modelLabel)
          : '设计助手';
      const safeAssistantLabel = String(assistantLabel)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
      const greetingMessage = { sender: 'ai', text: greeting };
      if (providerKey) {
        greetingMessage.providerKey = providerKey;
      }
      if (modelLabel) {
        greetingMessage.modelLabel = modelLabel;
      }
      chatHistory.push(greetingMessage);
      if (typeof chatMessagesArea !== 'undefined' && chatMessagesArea) {
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message ai-message design-mode-msg';
        msgEl.dataset.originalIndex = 0;
        const rendered =
          typeof formatMessageContent === 'function' ? formatMessageContent(greeting) : greeting;
        const designBtns =
          typeof renderDesignQuickStartButtonsHtml === 'function' && chatHistory.length === 1
            ? renderDesignQuickStartButtonsHtml()
            : '';
        msgEl.innerHTML = `
                    <div class="chat-user-label">${safeAssistantLabel}</div>
                    <div class="chat-message-content">${rendered}${designBtns}</div>
                `;
        if (typeof window.applyAiProviderDataset === 'function') {
          window.applyAiProviderDataset(msgEl, providerKey);
        }
        chatMessagesArea.appendChild(msgEl);
      }
    }

    if (preservePendingGameBootstrap) {
      this.pendingGameBootstrap = preservedBootstrap;
    }

    this._updatePreviewPanel();
  }

  // ========================================
  // 重新导入世界卡到世界卡
  // ========================================

  /**
   * 将已有世界卡载入世界卡 Phase 3 进行二次编辑。
   * 跳过 P1/P2，直接进入审阅编辑阶段。
   * @param {object} card - 完整世界卡对象（含 snapshot, designChatHistory, designMeta）
   * @returns {{ ok: boolean, reason?: string }}
   */
  loadCardIntoDesignMode(card) {
    if (!card || !card.snapshot || typeof card.snapshot !== 'object') {
      return { ok: false, reason: '世界卡缺少有效的 snapshot 数据' };
    }

    // 停止任何正在进行的操作
    this.isAutoGenerating = false;
    this.isProcessing = false;

    // 深拷贝 snapshot 到 designConfig
    this.designConfig = JSON.parse(JSON.stringify(card.snapshot));

    // 直接进入 P3
    this.phase = 'p3';
    this._draftSourceType = DESIGN_DRAFT_SOURCE_CARD_EDIT;
    this.resetP3History();
    this.p2Stage = PHASE2_TOTAL_STAGES;

    // 恢复或合成 p1Output
    if (card.designMeta?.p1Output) {
      this.p1Output = card.designMeta.p1Output;
    } else {
      this.p1Output = this._synthesizeP1OutputFromSnapshot(card.snapshot);
    }

    // 设置名称和描述
    this.worldCardName = card.name || '';
    this.worldCardDescription = card.description || '';

    // 记录源卡ID（用于应用时覆盖原卡）
    this._reimportSourceCardId = card.id || null;
    this._allowOverwriteFromCardEdit = false;
    // 导入临时卡（无 ID）时，下一次应用必须新建，避免覆盖当前激活卡
    this.forceCreateNewOnNextApply = !card.id;

    // 清空待执行操作和验证报告
    this.pendingOperations = [];
    this.stageValidationReports = {};
    this.markCompletionBaseline();

    // 持久化 & 刷新预览
    this.clearPersistedDraft();
    this._saveDesignConfig({ skipIndicator: true });
    this._updatePreviewPanel();

    console.log(
      '[DesignService] 已载入世界卡到设计模式 P3:',
      card.name || card.id,
      '源卡ID:',
      this._reimportSourceCardId
    );
    return { ok: true };
  }

  /**
   * 当 designMeta.p1Output 不可用时，从 snapshot 中合成最小可用的 p1Output。
   * 用于保证 P3 编辑时 AI 调用能获得基本上下文。
   */
  _synthesizeP1OutputFromSnapshot(snapshot) {
    const p1 = {};

    // context_world: 从 world_setting 提取
    const ws = snapshot.world_setting;
    if (ws && ws.settings && typeof ws.settings === 'object') {
      const parts = [];
      if (ws._summary) parts.push(ws._summary);
      for (const [key, val] of Object.entries(ws.settings)) {
        if (key.startsWith('_')) continue;
        const text = typeof val === 'string' ? val.slice(0, 300) : '';
        if (text) parts.push(`[${key}] ${text}`);
      }
      p1.context_world = parts.join('\n\n') || '（从快照恢复）';
    } else {
      p1.context_world = '（无世界设定数据）';
    }

    // context_rules: 从 prompt_modules 提取
    const pm = snapshot.prompt_modules;
    if (pm && pm.modules && typeof pm.modules === 'object') {
      const parts = [];
      if (pm._summary) parts.push(pm._summary);
      for (const [id, content] of Object.entries(pm.modules)) {
        if (id.startsWith('_')) continue;
        const text = typeof content === 'string' ? content.slice(0, 200) : '';
        if (text) parts.push(`[${id}] ${text}`);
      }
      p1.context_rules = parts.join('\n\n') || '（从快照恢复）';
    } else {
      p1.context_rules = '（无规则数据）';
    }

    // context_chars: 从 character_database 提取
    const cd = snapshot.character_database;
    if (cd && typeof cd === 'object') {
      const charDescs = Object.entries(cd)
        .filter(([k]) => !k.startsWith('_'))
        .map(([id, c]) => {
          if (!c || typeof c !== 'object') return null;
          return `${c.name || id}: ${c.title || ''} ${c.personality || ''}`.trim();
        })
        .filter(Boolean)
        .join('; ');
      p1.context_chars = charDescs || '（从快照恢复）';
    } else {
      p1.context_chars = '（无角色数据）';
    }

    // context_timeline: 从 timeline 提取
    const tl = snapshot.timeline;
    if (tl?.events && Array.isArray(tl.events) && tl.events.length > 0) {
      const eventDescs = tl.events
        .slice(0, 10)
        .map(e => `${e.year || '?'}年: ${e.title || e.description || '事件'}`)
        .join('; ');
      p1.context_timeline = eventDescs;
    } else {
      p1.context_timeline = '（无时间线数据）';
    }

    // style_guide: 尝试从 narrative_base 模块推断风格基调
    const narrativeBaseText = snapshot.prompt_modules?.modules?.narrative_base || '';
    if (narrativeBaseText) {
      p1.style_guide = `（从世界卡 narrative_base 模块恢复的风格基调）\n${narrativeBaseText}`;
    } else {
      p1.style_guide = '（从世界卡快照恢复，原始风格指南不可用——建议在 Phase 2 重新生成前手动补充文风偏好）';
    }

    // world_terms
    p1.world_terms = snapshot.step3_fields?._worldTermsSource || {};

    return p1;
  }

  // ========================================
  // 聊天历史持久化
  // ========================================

  saveChatHistory(history) {
    if (!this._shouldPersistDesignDraft(history)) {
      this.clearChatHistory();
      return;
    }
    // 仅写入本地设计草稿；世界卡内容只在“应用到游戏”时提交
    const compact = this._compactDesignChatHistory(history);
    try {
      localStorage.setItem('design_mode_chat_history', JSON.stringify(compact));
    } catch (e) {
      try {
        const fallback = compact.slice(-40).map(msg => {
          const trimmed = { ...msg };
          if (typeof trimmed.text === 'string' && trimmed.text.length > 1200) {
            trimmed.text = `${trimmed.text.slice(0, 1200)}…`;
          }
          if (typeof trimmed.promptText === 'string' && trimmed.promptText.length > 300) {
            trimmed.promptText = `${trimmed.promptText.slice(0, 300)}…`;
          }
          return trimmed;
        });
        localStorage.setItem('design_mode_chat_history', JSON.stringify(fallback));
        if (typeof showToast === 'function') {
          showToast('设计草稿较大，已自动精简保存最近内容');
        }
      } catch (fallbackErr) {
        console.warn('[DesignService] 保存聊天历史失败:', e, fallbackErr);
        if (typeof showToast === 'function') {
          showToast('设计草稿保存失败：本地存储空间不足');
        }
      }
    }
  }

  static loadChatHistory() {
    try {
      const saved = localStorage.getItem('design_mode_chat_history');
      const parsed = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.slice(-DESIGN_CHAT_HISTORY_LIMIT).map(msg => {
        if (!msg || typeof msg !== 'object') return msg;
        const restored = { ...msg };
        delete restored.p1ThinkingFull;
        if (
          typeof restored.promptText === 'string' &&
          restored.promptText.length > P1_PROMPT_TEXT_MAX_LEN
        ) {
          restored.promptText = restored.promptText.slice(0, P1_PROMPT_TEXT_MAX_LEN);
        }
        if (
          typeof restored.p1ThinkingPreview === 'string' &&
          restored.p1ThinkingPreview.length > P1_THINKING_PREVIEW_MAX_LEN
        ) {
          restored.p1ThinkingPreview = restored.p1ThinkingPreview.slice(
            0,
            P1_THINKING_PREVIEW_MAX_LEN
          );
        }
        if (Array.isArray(restored.p1Questions)) {
          restored.p1Questions = restored.p1Questions
            .slice(0, 2)
            .map((q, idx) => {
              const options = Array.isArray(q?.options)
                ? q.options
                    .slice(0, 3)
                    .map((opt, optIdx) => {
                      const text =
                        typeof opt === 'string'
                          ? opt.trim()
                          : typeof opt?.text === 'string'
                            ? opt.text.trim()
                            : '';
                      if (!text) return null;
                      return {
                        id:
                          typeof opt?.id === 'string' && opt.id.trim()
                            ? opt.id.trim()
                            : String.fromCharCode(97 + optIdx),
                        text: text.slice(0, 120),
                      };
                    })
                    .filter(Boolean)
                : [];
              return {
                id: typeof q?.id === 'string' && q.id.trim() ? q.id.trim() : `q${idx + 1}`,
                text: typeof q?.text === 'string' ? q.text.trim().slice(0, 220) : '',
                target: typeof q?.target === 'string' ? q.target.trim() : '',
                required: q?.required !== false,
                options,
              };
            })
            .filter(q => q.text);
        }
        if (restored.p1FlowState && typeof restored.p1FlowState === 'object') {
          restored.p1FlowState = _sanitizeStoredP1FlowState(restored.p1FlowState);
        }
        return restored;
      });
    } catch (e) {
      console.warn('[DesignService] 加载聊天历史失败:', e);
      return [];
    }
  }

  clearChatHistory() {
    localStorage.removeItem('design_mode_chat_history');
  }

  /**
   * 过滤不应持久化到世界卡聊天历史的消息：
   *   - 错误占位消息（isError）：用户瞬时看到的网络/API 错误，不应进入卡的对话历史
   *   - 沙盒默认开场白（isDefaultOpeningGreeting）：来自游戏 chat 的污染，
   *     世界卡 chat 不应包含游戏开场词（详见司机案例）
   * 同时保留 isError 出现在当前会话内存中的能力（仅 save/persist 时过滤）。
   */
  _filterPersistableHistory(history) {
    if (!Array.isArray(history)) return [];
    return history.filter(msg => {
      if (!msg || typeof msg !== 'object') return false;
      if (msg.isError === true) return false;
      if (
        typeof msg.text === 'string' &&
        typeof isDefaultOpeningGreeting === 'function' &&
        isDefaultOpeningGreeting(msg.text)
      ) {
        return false;
      }
      return true;
    });
  }

  _compactDesignChatHistory(history) {
    if (!Array.isArray(history)) return [];
    const filtered = this._filterPersistableHistory(history);
    const recent = filtered.slice(-DESIGN_CHAT_HISTORY_LIMIT);
    return recent.map(msg => {
      const compact = { ...msg };
      // 完整思考只用于当前会话显示，不做持久化
      delete compact.p1ThinkingFull;

      if (typeof compact.text === 'string' && compact.text.length > 10000) {
        compact.text = `${compact.text.slice(0, 10000)}…`;
      }
      if (typeof compact.displayText === 'string' && compact.displayText.length > 2000) {
        compact.displayText = `${compact.displayText.slice(0, 2000)}…`;
      }
      if (
        typeof compact.promptText === 'string' &&
        compact.promptText.length > P1_PROMPT_TEXT_MAX_LEN
      ) {
        compact.promptText = compact.promptText.slice(0, P1_PROMPT_TEXT_MAX_LEN);
      }
      if (
        typeof compact.p1ThinkingPreview === 'string' &&
        compact.p1ThinkingPreview.length > P1_THINKING_PREVIEW_MAX_LEN
      ) {
        compact.p1ThinkingPreview = compact.p1ThinkingPreview.slice(0, P1_THINKING_PREVIEW_MAX_LEN);
      }
      if (Array.isArray(compact.p1Questions)) {
        compact.p1Questions = compact.p1Questions
          .slice(0, 2)
          .map((q, idx) => {
            const options = Array.isArray(q?.options)
              ? q.options
                  .slice(0, 5)
                  .map((opt, optIdx) => {
                    const text =
                      typeof opt === 'string'
                        ? opt.trim()
                        : typeof opt?.text === 'string'
                          ? opt.text.trim()
                          : '';
                    if (!text) return null;
                    return {
                      id:
                        typeof opt?.id === 'string' && opt.id.trim()
                          ? opt.id.trim()
                          : String.fromCharCode(97 + optIdx),
                      text: text.slice(0, 120),
                    };
                  })
                  .filter(Boolean)
              : [];
            return {
              id: typeof q?.id === 'string' && q.id.trim() ? q.id.trim() : `q${idx + 1}`,
              text: typeof q?.text === 'string' ? q.text.trim().slice(0, 220) : '',
              target: typeof q?.target === 'string' ? q.target.trim() : '',
              required: q?.required !== false,
              options,
            };
          })
          .filter(q => q.text);
      }
      if (compact.p1FlowState && typeof compact.p1FlowState === 'object') {
        compact.p1FlowState = _sanitizeStoredP1FlowState(compact.p1FlowState);
      }
      if (compact.errorMeta && typeof compact.errorMeta === 'object') {
        compact.errorMeta = {
          errorInfo: compact.errorMeta.errorInfo || null,
          traceId: compact.errorMeta.traceId || null,
          failedPhase: compact.errorMeta.failedPhase || null,
        };
      }
      return compact;
    });
  }

  /**
   * 世界卡统一前置检查：内置 provider 必须配置 API Key
   * 仅对内置 provider 生效，自定义 provider 保持现有行为
   */
  _assertDesignApiKeyConfigured() {
    if (typeof aiService === 'undefined') return;
    if (
      typeof aiService.getProviderForModule !== 'function' ||
      typeof aiService.getApiKeyForModule !== 'function'
    ) {
      return;
    }

    const rawProvider = aiService.getProviderForModule('p1');
    const provider = typeof rawProvider === 'string' ? rawProvider.trim() : '';
    if (!DESIGN_REQUIRED_KEY_PROVIDERS.has(provider)) return;

    const rawApiKey = aiService.getApiKeyForModule('p1');
    const apiKey = typeof rawApiKey === 'string' ? rawApiKey.trim() : '';
    if (apiKey) return;

    const error = new Error('设计模式 API Key 未设置，请先在设置中填写并保存后重试。');
    error.code = 'DESIGN_API_KEY_MISSING';
    error.designErrorInfo = { module: 'design', provider };
    throw error;
  }

  // ========================================
  // 通用工具方法
  // ========================================

  /**
   * 格式化聊天历史为 AI API 格式
   * AI 消息使用 <<<P1_THINKING>>> / <<<P1_QUESTIONS>>> 分隔符重建，
   * 让模型在历史中看到正确格式，通过 in-context learning 提高格式遵循率
   */
  _formatMessages(history) {
    const recent = history.slice(-30);
    return recent.map(msg => {
      const role = msg.sender === 'user' ? 'user' : 'assistant';
      if (role === 'user') {
        return { role, content: msg.text || '' };
      }
      // AI 消息：用正确的分隔符格式重建 thinking 和 questions
      const text = msg.text || '';
      const thinking =
        typeof msg.p1ThinkingFull === 'string' && msg.p1ThinkingFull.trim()
          ? msg.p1ThinkingFull.trim()
          : typeof msg.p1ThinkingPreview === 'string' && msg.p1ThinkingPreview.trim()
            ? msg.p1ThinkingPreview.trim()
            : '';
      let content = text;
      if (thinking) {
        content += `\n\n<<<P1_THINKING>>>\n${thinking}\n<<<END_P1_THINKING>>>`;
      }
      if (Array.isArray(msg.p1Questions) && msg.p1Questions.length > 0) {
        const qBlock = JSON.stringify({
          round: 0,
          goal: msg.p1QuestionGoal || '',
          questions: msg.p1Questions,
          allow_skip: true,
          skip_policy: 'conservative_default',
        }, null, 2);
        content += `\n\n<<<P1_QUESTIONS>>>\n${qBlock}\n<<<END_P1_QUESTIONS>>>`;
      }
      return { role, content };
    });
  }

  /**
   * 从 AI 响应中提取 JSON 对象
   * 流水线：候选提取 → 原文解析 → 轻量修复后解析
   */
  _extractJSON(response, options = {}) {
    const includeMeta = options.includeMeta === true;
    const silent = options.silent === true;
    const text = typeof response === 'string' ? response : '';
    const result = {
      parsed: null,
      failureKind: 'non_json_content',
      errorMessage: null,
      responseLength: text.length,
      responseTail: text ? text.slice(-200) : '',
    };

    if (!text.trim()) {
      if (!silent) {
        console.warn('[DesignService] JSON 提取失败:', {
          failureKind: result.failureKind,
          responseLength: result.responseLength,
          responseTail: result.responseTail,
        });
      }
      return includeMeta ? result : null;
    }

    const candidates = this._collectJSONCandidates(text);
    const parseResult = this._tryParseJSONCandidates(candidates);
    if (parseResult.parsed) {
      result.parsed = parseResult.parsed;
      result.failureKind = null;
      return includeMeta ? result : result.parsed;
    }

    result.errorMessage = parseResult.lastErrorMessage || null;
    result.failureKind = this._detectJSONFailureKind(text, parseResult.lastErrorMessage);

    if (!silent) {
      console.warn('[DesignService] JSON 提取失败:', {
        failureKind: result.failureKind,
        errorMessage: result.errorMessage,
        candidateCount: candidates.length,
        responseLength: result.responseLength,
        responseTail: result.responseTail,
      });
    }
    return includeMeta ? result : null;
  }

  _collectJSONCandidates(text) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = value => {
      if (typeof value !== 'string') return;
      const normalized = value.trim();
      if (!normalized) return;
      if (seen.has(normalized)) return;
      seen.add(normalized);
      candidates.push(normalized);
    };

    const jsonFencePattern = /```json\s*([\s\S]*?)```/gi;
    let match = null;
    while ((match = jsonFencePattern.exec(text)) !== null) {
      addCandidate(match[1]);
    }

    const genericFencePattern = /```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)```/g;
    while ((match = genericFencePattern.exec(text)) !== null) {
      addCandidate(match[1]);
    }

    const balancedObject = this._extractFirstBalancedJSONObject(text);
    addCandidate(balancedObject);

    addCandidate(text);
    return candidates;
  }

  _tryParseJSONCandidates(candidates) {
    let lastErrorMessage = null;

    for (const candidate of candidates) {
      try {
        return { parsed: JSON.parse(candidate), lastErrorMessage: null };
      } catch (e) {
        lastErrorMessage = e?.message || String(e);
      }

      const sanitized = this._sanitizeJSONCandidate(candidate);
      if (!sanitized || sanitized === candidate) {
        continue;
      }

      try {
        return { parsed: JSON.parse(sanitized), lastErrorMessage: null };
      } catch (e) {
        lastErrorMessage = e?.message || String(e);
      }
    }

    return { parsed: null, lastErrorMessage };
  }

  _sanitizeJSONCandidate(candidate) {
    if (typeof candidate !== 'string') return '';
    let text = candidate.replace(/^\uFEFF/, '').trim();
    text = this._stripCodeFence(text);
    text = this._normalizeLikelyJSONSmartQuotes(text);
    // Stage 2 \u65F6\u6A21\u578B\u5076\u5C14\u4F1A\u585E JS \u98CE\u683C\u6CE8\u91CA / \u5355\u5F15\u53F7\u5B57\u7B26\u4E32 / \u4E0D\u5E26\u5F15\u53F7\u7684 key,
    // \u8DD1\u539F\u751F JSON.parse \u76F4\u63A5\u5931\u8D25\u3002\u5728 balanced extraction \u4E4B\u524D\u5148\u5265\u5E38\u89C1 JS-isms,
    // \u63D0\u9AD8\u89E3\u6790\u6210\u529F\u7387, \u662F bug-0008 / bug-0003 \u540C\u7C7B\u95EE\u9898\u7684\u515C\u5E95\u3002
    text = this._stripJsStyleComments(text);

    const balancedObject = this._extractFirstBalancedJSONObject(text);
    if (balancedObject) {
      text = balancedObject;
    }

    text = this._removeTrailingCommas(text);
    text = this._escapeBareControlsInStrings(text);
    text = this._quoteBareJsonKeys(text);
    return text.trim();
  }

  // \u5265 // \u884C\u6CE8\u91CA + /* */ \u5757\u6CE8\u91CA\u3002\u7B80\u5316\u5904\u7406: \u4E0D\u533A\u5206\u662F\u5426\u5728\u5B57\u7B26\u4E32\u5185,
  // \u56E0\u4E3A JSON \u5B57\u7B26\u4E32\u91CC\u51FA\u73B0 // \u6216 /* \u6781\u5C11\u89C1 (\u5408\u6CD5 JSON \u4E5F\u5141\u8BB8\u5B57\u7B26\u4E32\u4E2D\u542B\u8FD9\u4E9B\u5B57\u7B26,
  // \u8FD9\u662F false positive \u98CE\u9669\u70B9)\u3002\u4F46 AI \u8F93\u51FA\u7684\u5B57\u7B26\u4E32\u5185\u542B // \u7684\u6982\u7387\u8FDC\u4F4E\u4E8E
  // AI \u5199\u9519\u4E86\u5728 JSON \u5916\u52A0\u6CE8\u91CA\u7684\u6982\u7387, \u6240\u4EE5\u6536\u76CA > \u98CE\u9669\u3002
  _stripJsStyleComments(text) {
    if (typeof text !== 'string') return '';
    let out = '';
    let i = 0;
    let inString = false;
    let stringChar = '"';
    while (i < text.length) {
      const c = text[i];
      const next = text[i + 1];
      if (inString) {
        out += c;
        if (c === '\\' && i + 1 < text.length) {
          out += text[i + 1];
          i += 2;
          continue;
        }
        if (c === stringChar) inString = false;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        stringChar = c;
        out += c;
        i++;
        continue;
      }
      if (c === '/' && next === '/') {
        // \u8DF3\u5230\u884C\u5C3E
        while (i < text.length && text[i] !== '\n') i++;
        continue;
      }
      if (c === '/' && next === '*') {
        // \u8DF3\u5230 */
        i += 2;
        while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  // \u7ED9\u88F8 key \u52A0\u53CC\u5F15\u53F7 (e.g. `{ name: "x" }` \u2192 `{ "name": "x" }`)\u3002
  // \u53EA\u5339\u914D { \u6216 , \u540E\u9762\u7D27\u8DDF unquoted-id \u7D27\u8DDF : \u7684\u6A21\u5F0F, \u907F\u514D\u8BEF\u4F24\u5B57\u7B26\u4E32\u5185\u5BB9\u3002
  _quoteBareJsonKeys(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/([{,]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)/g, '$1"$2"$3');
  }

  _normalizeLikelyJSONSmartQuotes(text) {
    if (typeof text !== 'string' || !text) return '';
    let normalized = text;
    normalized = normalized.replace(/([{\[,]\s*)[“”]([^“”\r\n]+?)[“”](\s*:)/g, '$1"$2"$3');
    normalized = normalized.replace(/(:\s*)[“”]([\s\S]*?)[“”](\s*[,}\]])/g, '$1"$2"$3');
    normalized = normalized.replace(/([\[,]\s*)[“”]([\s\S]*?)[“”](\s*[,}\]])/g, '$1"$2"$3');
    return normalized;
  }

  _stripCodeFence(text) {
    if (typeof text !== 'string') return '';
    const trimmed = text.trim();
    const match = trimmed.match(/^```(?:json|javascript|js|typescript|ts)?\s*([\s\S]*?)\s*```$/i);
    if (match) return match[1];
    return trimmed;
  }

  _extractFirstBalancedJSONObject(text) {
    if (typeof text !== 'string' || !text) return null;

    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        if (depth === 0) {
          start = i;
        }
        depth += 1;
        continue;
      }

      if (ch === '}' && depth > 0) {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          return text.slice(start, i + 1);
        }
      }
    }

    return null;
  }

  _removeTrailingCommas(text) {
    if (typeof text !== 'string' || !text) return text;

    let output = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        output += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        output += ch;
        continue;
      }

      if (ch === ',') {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) {
          j += 1;
        }
        if (j < text.length && (text[j] === '}' || text[j] === ']')) {
          continue;
        }
      }

      output += ch;
    }

    return output;
  }

  _escapeBareControlsInStrings(text) {
    if (typeof text !== 'string' || !text) return text;

    let output = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          output += ch;
          escaped = false;
          continue;
        }

        if (ch === '\\') {
          output += ch;
          escaped = true;
          continue;
        }

        if (ch === '"') {
          output += ch;
          inString = false;
          continue;
        }

        if (ch === '\r') {
          output += '\\n';
          if (text[i + 1] === '\n') {
            i += 1;
          }
          continue;
        }

        if (ch === '\n') {
          output += '\\n';
          continue;
        }

        if (ch === '\t') {
          output += '\\t';
          continue;
        }

        const code = ch.charCodeAt(0);
        if (code < 0x20) {
          const hex = code.toString(16).padStart(4, '0');
          output += `\\u${hex}`;
          continue;
        }

        output += ch;
        continue;
      }

      const code = ch.charCodeAt(0);
      if (code < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t') {
        continue;
      }

      if (ch === '"') {
        inString = true;
      }
      output += ch;
    }

    return output;
  }

  _scanJSONStringStructure(text) {
    let braceDepth = 0;
    let inString = false;
    let escaped = false;
    let hasPrematureClose = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{') {
        braceDepth += 1;
        continue;
      }

      if (ch === '}') {
        if (braceDepth === 0) {
          hasPrematureClose = true;
        } else {
          braceDepth -= 1;
        }
      }
    }

    return { braceDepth, inString, escaped, hasPrematureClose };
  }

  _detectJSONFailureKind(text, errorMessage = '') {
    if (typeof text !== 'string' || !text.trim()) {
      return 'non_json_content';
    }

    const trimmed = text.trim();
    const hasOpenBrace = trimmed.includes('{');
    const hasCloseBrace = trimmed.includes('}');
    if (!hasOpenBrace && !hasCloseBrace) {
      return 'non_json_content';
    }

    const structure = this._scanJSONStringStructure(trimmed);
    if (
      structure.hasPrematureClose ||
      structure.braceDepth > 0 ||
      structure.inString ||
      /\\$/.test(trimmed)
    ) {
      return 'truncated_or_unclosed';
    }

    const normalizedError = String(errorMessage || '').toLowerCase();
    if (
      normalizedError.includes('unexpected end') ||
      normalizedError.includes('end of json input') ||
      normalizedError.includes('unterminated')
    ) {
      return 'truncated_or_unclosed';
    }

    if (
      normalizedError.includes('bad escaped') ||
      normalizedError.includes('invalid escape') ||
      normalizedError.includes('control character')
    ) {
      return 'invalid_escape_or_control';
    }

    return hasOpenBrace ? 'invalid_escape_or_control' : 'non_json_content';
  }

  _formatJSONFailureReason(failureKind) {
    switch (failureKind) {
      case 'truncated_or_unclosed':
        return '输出疑似被截断或 JSON 未闭合（可能是达到模型最大输出上限）';
      case 'invalid_escape_or_control':
        return 'JSON 包含非法转义或控制字符（可能是模型输出不规范）';
      case 'non_json_content':
        return '输出不是合法 JSON（可能是模型输出不规范）';
      default:
        return 'AI未遵守格式要求';
    }
  }

}

// 暴露 class 引用，供后续 prototype 扩展文件使用
window.DesignService = DesignService;

// 全局实例（延迟初始化）
window.designService = null;

function initDesignService() {
  if (!window.designService) {
    const _mgr = window.worldCardManager;
    const _activeId = _mgr?.getActiveCardId?.();

    // 判断是否有待恢复的世界卡数据
    const _hasPendingCard = !!window._pendingWorldCard;

    // 如果没有待恢复卡且无 localStorage 草稿，清理旧数据防止构造函数读到旧草稿
    if (!_hasPendingCard) {
      const hasLocalDraft =
        typeof window.hasStoredDesignDraft === 'function' ? window.hasStoredDesignDraft() : false;
      if (!hasLocalDraft) {
        localStorage.removeItem('design_mode_meta');
        localStorage.removeItem('design_mode_chat_history');
        localStorage.removeItem('design_mode_config');
      }
    }

    window.designService = new DesignService();
    window.designService._bindLifecycleEvents();

    // 优先从存档恢复世界卡数据（如果有待恢复的卡片）
    if (window._pendingWorldCard) {
      // 统一路径：所有世界卡（包括预装卡）都可恢复到世界卡
      _restoreDesignServiceFromCard(window._pendingWorldCard);
      designChatHistory = window._pendingWorldCard.designChatHistory || [];
      delete window._pendingWorldCard;
    } else {
      // 向后兼容：从 localStorage 恢复世界卡草稿历史
      const savedHistory = DesignService.loadChatHistory();
      if (savedHistory.length > 0) {
        designChatHistory = savedHistory;
      }
    }

    if (isDesignMode) {
      chatHistory = designChatHistory;
    }
    // 卡牌审阅状态恢复：如果用户上次关闭浏览器时停在 review 状态，
    // 在 chat 历史末尾补一条引导消息（adapter 提供文案），否则用户重新进来会困惑突然出现一堆卡。
    try {
      const stage = window.designService?.p2ReviewStage;
      const adapter =
        stage != null && window.getReviewAdapter ? window.getReviewAdapter(stage) : null;
      if (adapter && Array.isArray(designChatHistory)) {
        const alreadyHinted = designChatHistory.some(m => m && m._reviewRestoreHint === true);
        if (!alreadyHinted) {
          const hintText =
            typeof adapter.buildRestoreHintMessage === 'function'
              ? adapter.buildRestoreHintMessage()
              : `**审阅未完成**\n\n上次停在 Stage ${stage} 审阅环节。`;
          designChatHistory.push({
            sender: 'ai',
            text: hintText,
            _reviewRestoreHint: true,
            _isReviewPanelMessage: true,
            _reviewStage: stage,
          });
          if (typeof window.designService.saveChatHistory === 'function') {
            window.designService.saveChatHistory(designChatHistory);
          }
        }
      }
    } catch (e) {
      console.warn('[DesignService] review restore hint append failed:', e);
    }
    console.log('[DesignService] 初始化完成（V2 三阶段架构）');
  }
  return window.designService;
}
window.initDesignService = initDesignService;
