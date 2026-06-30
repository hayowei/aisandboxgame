/**
 * designService.js
 * 世界卡核心服务（2026-06-10 起：PZWC 建造 + P3 编辑两阶段）
 *
 * phase = 'pzwc'：新建卡 = PZWC 引擎建造（编排在 js/services/pzwcDesignController.js，
 *                 引擎 = dist/pzwc-engine.js 岛；老 P1/P2 流水线已整体拆除）
 * phase = 'p3' ：JSON Patch 审阅编辑（js/services/p3/）
 *
 * 职责：
 * 1. 设计会话状态（phase / designConfig / p1Output 框架 / 名称描述）+ 持久化恢复
 * 2. loadCardIntoDesignMode：卡 → 设计态（PZWC finish 交接 / 已有卡二次编辑共用）
 * 3. 预览面板更新（design/ui.js mixin）+ 快照校验修复（design/snapshotInfra.js mixin）
 * 6. 配置导出和应用到游戏
 */

class DesignService {
  constructor() {
    this.designConfig = this._loadDesignConfig();
    // phase 反应式：任何 this.phase = X 都自动同步 body[data-design-phase] 给 CSS 作用域用
    // （composer pill / commentary 等只在 P1 设计模式生效）。
    let _phase = 'pzwc';
    Object.defineProperty(this, 'phase', {
      get() { return _phase; },
      set: v => {
        _phase = v;
        this._syncDesignPhaseBodyAttr();
      },
      enumerable: true,
      configurable: false,
    });
    this.phase = 'pzwc'; // 走 setter，触发首次同步（如果 body 还没就位则 try-catch 跳过，等 mode toggle 兜底）。'pzwc' = PZWC 引擎建造阶段（替代老 P1/P2）
    this.p2Stage = 0; // Phase 2 当前阶段 (0=未开始, 1-4=执行中)
    this.p2ReviewStage = null; // Phase 2 卡牌审阅暂停点（null=无暂停, 3=Stage 3 完成等待审阅）
    this.p1Output = null; // 框架（frozen_moment/player_anchor/world_terms 等；PZWC 产卡自带、P3/apply 消费）
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
    this.stageValidationReports = {}; // Stage 质量报告（用于预览与调试）
    this._reimportSourceCardId = null; // 重新导入编辑时的源世界卡ID
    this._allowOverwriteFromCardEdit = false; // 仅“在世界卡中编辑”入口允许覆盖
    this.pendingGameBootstrap = null; // 新世界应用成功后，切回沙盒时的一次性引导标记
    this._lastRejectedFramework = null; // 最近一次被验证拒绝的框架（历史字段，保留避免读取处 undefined）
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

  // body[data-design-phase] 同步：仅当 "P1 + 在设计模式" 时打 attr，其余清掉。
  // composer pill / commentary 等 V9 CSS 作用域靠它命中。
  // P3 重构后：body[data-design-phase='p3'] 给 #design-chat-header 上的 P3 工具
  // 按钮（撤销 / 清空对话）做 CSS 显隐 hook。
  _syncDesignPhaseBodyAttr() {
    try {
      if (typeof document === 'undefined' || !document.body) return;
      const gameScreen = document.getElementById('game-screen');
      const inDesignMode = gameScreen?.classList.contains('design-mode-active') ?? false;
      if (this.phase === 'p1' && inDesignMode) {
        document.body.dataset.designPhase = 'p1';
      } else if (this.phase === 'p3' && inDesignMode) {
        document.body.dataset.designPhase = 'p3';
      } else if (document.body.dataset.designPhase) {
        delete document.body.dataset.designPhase;
      }
      // P3 service 接入：phase=p3 + 在 design mode 时调 openPanel——内部做 V1 gate
      // + designConfig identity 检查（切卡自动 reset）。openPanel 已经是 no-op stub
      // (P3 集成进主聊天后)，但 V1 banner / 切卡 reset 仍依赖它跑。
      if (this.phase === 'p3' && inDesignMode && window.p3Service) {
        try { window.p3Service.openPanel(); } catch (_) {}
      } else if (window.p3Service?.isOpen?.()) {
        try { window.p3Service.closePanel(); } catch (_) {}
      }
    } catch (_) { /* noop */ }
  }

  // ========================================
  // P3 stub（旧 P3 已拆，新 P3 服务正在重写中——见 内部设计文档）
  //
  // 仅保留 sendP3Message 的兼容 shim，让 P2 卡牌审阅模式（_reviewModeNaturalEdit）
  // 调用时拿到 graceful failure 而非 ReferenceError。新 P3 上线后该 stub 可删除
  // 或重定向到新的 p3Service.sendMessage。
  // ========================================

  async sendP3Message(_userText, _options = {}) {
    return {
      text: 'Phase 3 自然语言编辑暂时不可用（P3 正在重新设计）。',
      operations: [],
      enrichedOps: [],
      hasPendingOps: false,
      hadPendingOps: 0,
      aborted: false,
    };
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
        let restoredPhase = parsed.phase || 'pzwc';
        if (restoredPhase === 'done') restoredPhase = 'p3';
        // 老 P1/P2 中途草稿无法在 PZWC 流程里续跑（FSM 已退役）——映射回 pzwc 重新开始；
        // p3 草稿照常恢复。
        if (restoredPhase === 'p1' || restoredPhase === 'p2') restoredPhase = 'pzwc';
        this.phase = restoredPhase;
        this.p2Stage = parsed.p2Stage || 0;
        this.p2ReviewStage =
          typeof parsed.p2ReviewStage === 'number' && parsed.p2ReviewStage > 0
            ? parsed.p2ReviewStage
            : null;
        this.p1Output = parsed.p1Output || null;
        this.worldCardName = parsed.worldCardName || '';
        this.worldCardDescription = parsed.worldCardDescription || '';
        this.completionFingerprint = parsed.completionFingerprint || null;
        this._draftSourceType = parsed.draftSourceType || DESIGN_DRAFT_SOURCE_NEW_WORLD;
        // （P1 状态机已随老 P1/P2 流程退役——老草稿的 p1State/dimensionCoverage 字段静默忽略）
      }
    } catch (e) {
      console.warn('[DesignService] 恢复状态失败:', e);
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

  // P1 状态机已退役——“有意义的早期进展”只剩老草稿的 p1Draft 标记可判。
  _hasMeaningfulP1Progress() {
    return !!(this.designConfig && this.designConfig.p1Draft === true);
  }

  _hasMeaningfulDraft(chatHistoryRef = this._getPersistableChatHistoryRef()) {
    if (this._isCardEditSession()) return false;
    if (this.phase === 'p2') return true;

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
            worldCardName: this.worldCardName,
            worldCardDescription: this.worldCardDescription,
            completionFingerprint: this.completionFingerprint || null,
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

    // 切到「卡片/代码」预览 substage 时重渲染预览面板。code 面板在隐藏期间会跳过重建
    // （_renderPreviewContent 早退、设 _needsRefresh 但无人消费），不重渲染就会显示过期 JSON，
    // 基于过期 JSON 保存会回滚卡片视图期间的较新编辑。rAF 确保 stageEmbed 已 reparent + 去掉 inline display:none。
    if (window.eventBus?.on) {
      const _rerenderPreviewOnSubstage = data => {
        const sub = (data && (data.substage || data.sideSubstage)) || '';
        if (sub === 'card' || sub === 'code') {
          requestAnimationFrame(() => {
            try { this._updatePreviewPanel?.(); } catch (_) {}
          });
        }
      };
      window.eventBus.on('stage:substage-changed', _rerenderPreviewOnSubstage);
      window.eventBus.on('stage:side-substage-changed', _rerenderPreviewOnSubstage);

      // 防御性兜底：切回 preview stage 时若正停在 code/card substage，重渲染一次，
      // 清掉「在 design 对话里改好、但 code 面板当时 display:none 被 _renderPreviewContent 早退
      // 没重建」留下的过期报错。主舞台返回 preview 时 setStage 会把 substage 重置为默认（worldcard），
      // 用户再点 code/card tab 由上面的 substage 监听负责清理；这条 stage 监听额外覆盖
      // 「返回即停在 code/card」的路径（典型是侧栏 preview——sideSubstage 持久化）。
      // rAF 等 stageEmbed reparent 完、清掉 inline display:none 后再渲染。
      const _rerenderPreviewOnStage = () => {
        const st = (window.stageRouter?.getState?.()) || {};
        const onPreview = st.stage === 'preview' || st.sideStage === 'preview';
        const sub = st.substage || st.sideSubstage || '';
        if (onPreview && (sub === 'card' || sub === 'code')) {
          requestAnimationFrame(() => {
            try { this._updatePreviewPanel?.(); } catch (_) {}
          });
        }
      };
      window.eventBus.on('stage:changed', _rerenderPreviewOnStage);
    }
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
    this.phase = 'pzwc'; // 走 setter，自动同步 body attr。新建卡 = PZWC 引擎建造阶段
    this.p2Stage = 0;
    this.p2ReviewStage = null;
    this.p1Output = null;
    this.worldCardName = '';
    this.worldCardDescription = '';
    this.stageValidationReports = {};
    // 编辑草稿态收尾：若这是「从卡编辑」会话，重置前把那张卡退回正式态（清 _editDraft），
    // 否则卡会静默卡在草稿态——卡库永远显示「编辑中」、开新游戏被 gate 拒（resetDesignConfig
    // 只清内存标志、不碰卡上的 _editDraft，是 bug1）。
    if (this._isCardEditSession() && this._reimportSourceCardId) {
      try {
        window.worldCardManager?.update(this._reimportSourceCardId, { _editDraft: null, p3ChatHistory: [] });
      } catch (_) { /* defensive */ }
    }
    this._reimportSourceCardId = null;
    this._allowOverwriteFromCardEdit = false;
    this._pzwcFreshDraftCardId = null;
    // 编辑会话显式收尾：清「正在编辑哪张卡」指针（上面已把卡退回正式态，指针本会自愈失效，
    // 这里同步清掉避免残留）
    try { localStorage.removeItem('design_mode_editing_card_id'); } catch (_) { /* noop */ }
    this.completionFingerprint = null;
    this.forceCreateNewOnNextApply = false;
    this._draftSourceType = DESIGN_DRAFT_SOURCE_NEW_WORLD;
    this.pendingGameBootstrap = null;
    this._lastRejectedFramework = null;
    this.clearPersistedDraft();

    // finding #4：P3 编辑历史是独立 channel（不在 design_mode_* 草稿里），clearPersistedDraft
    // 清不到它。discard/reset 时若不一并清空，下一次设计会话 openPanel 会从残留的
    // window.p3ChatHistory 回填，把上一张卡的 P3 对话串进新会话。这里清三处：模块级数组 +
    // localStorage（design_mode_p3_history）+ p3Service 内存态（reloadFromCard 丢掉 in-memory
    // chatHistory / undo 栈 / UI，并置 _historyRestored=false 让下次从已清空的数组重新回填）。
    try {
      if (Array.isArray(window.p3ChatHistory)) window.p3ChatHistory.length = 0;
    } catch (_) { /* defensive */ }
    this.clearP3ChatHistory();
    try { window.p3Service?.reloadFromCard?.(); } catch (_) { /* p3Service 未加载时忽略 */ }


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
      // greeting 是 reset 后第一条 AI msg（chatHistory.push 在下面），turn = 当前 AI 数 + 1
      const _greetingTurn =
        (Array.isArray(chatHistory) ? chatHistory.filter(m => m && m.sender === 'ai').length : 0) + 1;
      const assistantLabel =
        typeof window.formatDesignAssistantLabel === 'function'
          ? window.formatDesignAssistantLabel(modelLabel, null, _greetingTurn)
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
        const isWorkshopOpening =
          typeof renderDesignQuickStartButtonsHtml === 'function' && chatHistory.length === 1;
        const rendered =
          typeof formatMessageContent === 'function' ? formatMessageContent(greeting) : greeting;
        // 工坊开场：editorial frame 完全替代 greeting 文本（避免重复念）；普通消息走默认渲染。
        const innerHtml = isWorkshopOpening
          ? renderDesignQuickStartButtonsHtml()
          : rendered;
        if (isWorkshopOpening) msgEl.classList.add('dcv-opening');
        msgEl.innerHTML = `
                    <div class="chat-user-label">${safeAssistantLabel}</div>
                    <div class="chat-message-content">${innerHtml}</div>
                `;
        if (typeof window.applyAiProviderDataset === 'function') {
          window.applyAiProviderDataset(msgEl, providerKey);
        }
        chatMessagesArea.appendChild(msgEl);
        // greeting 是直推到 DOM 的（未走 refreshChatUI），所以这里手动重建一遍 turn marker：
        // header 不再放 msgEl 内部，挂在外置 .design-turn-marker 上、浮在前一条玩家消息之上。
        if (typeof window._rebuildDesignTurnMarkers === 'function') {
          window._rebuildDesignTurnMarkers();
        }
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

  // frozen_moment 归一化（原 p1.js 活体，2026-06-10 P1/P2 拆除时移入——
  // 唯一存活调用方是下方 loadCardIntoDesignMode 的中间卡迁移防御）。
  _normalizeFrozenMoment(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const datetime = typeof raw.datetime === 'string' ? raw.datetime.trim() : '';
    if (!datetime) return null;
    const fullFmtRe =
      /^[^\d]+\d{1,4}\.(0?[1-9]|1[0-2])\.(0?[1-9]|[12]\d|3[01])\s+([01]?\d|2[0-3])[:：][0-5]\d$/;
    if (!fullFmtRe.test(datetime)) return null;
    const VALID_SOURCES = ['explicit', 'inferred', 'defaulted'];
    const source = VALID_SOURCES.includes(raw.source) ? raw.source : 'defaulted';
    const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 60) : '';
    const world_tense = this._normalizeWorldTense(raw.world_tense, label);
    return { datetime, label, source, world_tense };
  }

  // frozen_moment 缺失兜底：从 world_timeline 最后一条事件反推开局"此刻" datetime（"纪年YYY.MM.DD HH:MM"）。
  // 事件按时序作者编排，最后一条 ≈ 开局此刻；event.time（日期）+ event.time_str（钟点）拼出合法 datetime。
  // 仅给绕过 PZWC finish 闸门产出的老卡/导入卡用（当前 PZWC 建卡 checkLoadability 强制 frozen_moment）。
  // 双源 world_timeline || timeline（V1 红线）。找不到合法事件 → 返回 null（不强造）。
  _inferFrozenMomentDatetimeFromTimeline(snapshot) {
    try {
      const tl = snapshot && (snapshot.world_timeline || snapshot.timeline);
      const events = tl && Array.isArray(tl.events) ? tl.events : [];
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        const date = e && typeof e.time === 'string' ? e.time.trim() : '';
        const clock =
          e && typeof e.time_str === 'string' && e.time_str.trim()
            ? e.time_str.trim()
            : e && typeof e.clock === 'string'
              ? e.clock.trim()
              : '';
        // ① 事件已自带完整 datetime（datetime / time 字段本身就是「纪年YYY.MM.DD HH:MM」）→ 直接用
        for (const cand of [e && e.datetime, date]) {
          const c = typeof cand === 'string' ? cand.trim() : '';
          if (c && this._normalizeFrozenMoment({ datetime: c })) return c;
        }
        // ② date + clock 拼合
        if (date && clock) {
          const dt = `${date} ${clock}`;
          if (this._normalizeFrozenMoment({ datetime: dt })) return dt;
        }
      }
    } catch (_) {}
    return null;
  }

  // 张力时态：calm（平静）/ imminent（将临）/ aftermath（事后）—— 决定开场白基调。
  // 缺失（老卡 / AI 漏产）时从 label 文字启发式兜底，最终默认 imminent。
  _normalizeWorldTense(raw, label) {
    const VALID = ['calm', 'imminent', 'aftermath'];
    if (VALID.includes(raw)) return raw;
    const t = typeof label === 'string' ? label : '';
    if (/翌日|事后|过后|劫后|战后|废墟|余波|残骸|遗址|尘埃落定|落幕|结束后|醒来|苏醒|睁眼|睁开眼/.test(t)) return 'aftermath';
    if (/前夕|前夜|将至|将临|临近|下达|集结|征召|来临前|前一刻|山雨欲来|在即/.test(t)) return 'imminent';
    if (/日常|寻常|平静|安宁|太平|如常|岁月静好|风平浪静/.test(t)) return 'calm';
    return 'imminent';
  }

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

    // V1 卡屏蔽（防御性，UI 层 worldCardUI._handleEditInDesignMode 已先拦一道）
    // 详 内部设计文档 / 内部设计文档 · D2。
    // 只在卡片级 V1（_origin_schema_version === 1，migrate 不影响）这条线屏蔽——那是「老卡只读」的真正边界。
    // 不再因 per-entity V1（V2 卡里夹杂的个别 V1 markdown 实体）整张拒绝：审核 UI 会把它渲染成只读锁定卡，
    // 玩家可删除后重建，不该锁死整张可编辑的 V2 卡。
    if (typeof window !== 'undefined' && window.cardSchemaVersion
      && window.cardSchemaVersion.isOriginallyV1(card)) {
      return {
        ok: false,
        reason: '旧格式世界卡仅提供剧情游玩，不支持设计模式编辑',
      };
    }

    // 停止任何正在进行的操作
    this.isAutoGenerating = false;
    this.isProcessing = false;

    // 清 PZWC 卡语言标记（防止上一次 PZWC 建卡的 zh-CN 残留误标这次载入的卡；
    // PZWC 交接路径会在本方法返回后由控制器重新设置）。
    this._pzwcCardLocale = null;
    // 清 PZWC 新建草稿卡标记（一次性，仅 finish 交接后第一次 apply 覆盖时消费——
    // 让「应用」对刚建成的卡保持老语义：退出设计模式自动开新局。任何后续编辑会话不沿用）。
    this._pzwcFreshDraftCardId = null;

    // 深拷贝到 designConfig：有未应用的编辑草稿（_editDraft）则续编它，否则用正式 snapshot。
    // _editDraft 是 worldCardManager 上的草稿态字段（presence 即草稿态），见 内部设计文档。
    // 注意：下方 p1Output 合成 / frozen_moment 迁移仍读 card.snapshot（与 designConfig 解耦，不受草稿影响）。
    // TODO(v3 migration): _editDraft 不过 schema 迁移链。引入 v2ToV3 等更高格式迁移前，须在此校验/迁移
    //   草稿格式，或新格式上线时对存量草稿态卡强制清 _editDraft——否则 snapshot 升 V3、_editDraft 留 V2，
    //   续编会把未迁移的 V2 草稿当 V3 喂下去（当前 CURRENT_VERSION=2，零触发面）。
    const _editDraft = card._editDraft;
    const _useDraft =
      _editDraft && typeof _editDraft === 'object' && !Array.isArray(_editDraft)
      && Object.keys(_editDraft).length > 0;
    this.designConfig = JSON.parse(JSON.stringify(_useDraft ? _editDraft : card.snapshot));

    // 老卡兜底：2026-06-15 前 PZWC 生成的卡 prompt_modules 没有 _summary（引擎当时没指示 AI 写它）。
    // 该字段会注入运行时 NPC OOC 世界背景的"规则："行（js/services/ai/npc-ooc.js），也是 Stage2 预览提示
    // 与体检 C14 的检查项。进编辑会话时确定性补一句 stub（由模块名/描述派生、不调 AI、只补已有模块、
    // 不碰只播放的卡）——老卡重新编辑时这条 warning 消失、运行时也有内容。新卡由引擎正常写入、不进此分支。
    try {
      const _pm = this.designConfig?.prompt_modules;
      const _mods = _pm && typeof _pm === 'object' ? _pm.modules : null;
      const _hasSummary = _pm && typeof _pm._summary === 'string' && _pm._summary.trim();
      if (_pm && _mods && typeof _mods === 'object' && !Array.isArray(_mods) && !_hasSummary) {
        const _ids = Object.keys(_mods).filter(k => !k.startsWith('_'));
        if (_ids.length > 0) {
          const _meta =
            _pm.module_meta && typeof _pm.module_meta === 'object' ? _pm.module_meta : {};
          const _names = _ids.map(id => {
            const d =
              _meta[id] && typeof _meta[id].description === 'string'
                ? _meta[id].description.trim()
                : '';
            return d ? `${id}（${d.slice(0, 20)}）` : id;
          });
          _pm._summary = `本世界含 ${_ids.length} 个规则模块：${_names.join('、')}。`;
        }
      }
    } catch (_e) {
      /* 防御性：兜底失败不阻塞进设计模式 */
    }

    // 直接进入 P3（phase setter 自动同步 body attr）
    this.phase = 'p3';
    this._draftSourceType = DESIGN_DRAFT_SOURCE_CARD_EDIT;
    this.p2Stage = PHASE2_TOTAL_STAGES;

    // 恢复或合成 p1Output
    if (card.designMeta?.p1Output) {
      this.p1Output = card.designMeta.p1Output;
    } else {
      this.p1Output = this._synthesizeP1OutputFromSnapshot(card.snapshot);
    }

    // 中间卡 frozen_moment 迁移（2026-05-21 ~ 2026-05-24 间产的卡）：
    // 老 schema 把 frozen_moment 落在 snapshot.prompt_modules.frozen_moment，新 schema 落 p1Output.frozen_moment。
    // 用户重抽 Stage 2 时 designConfig.prompt_modules 会被整段覆盖（design2.js:443）→ 老字段丢 → wizard 失活。
    // 进设计模式时主动迁到 p1Output，下次 _saveDesignConfig + designMeta apply 时随 p1Output 持久化，prompt_modules 那边失而不痛。
    // 用 _normalizeFrozenMoment 校验老值格式（防迁污数据）；合法才迁，source 标 'inferred'（继承自老 schema）。
    if (this.p1Output && !this.p1Output.frozen_moment) {
      // ① 中间卡 snapshot.prompt_modules.frozen_moment（2026-05-21~24）② 最老顶层 snapshot.frozen_moment
      // ③ 都无 → 从 world_timeline 最后一条事件反推（绕过 PZWC finish 闸门产出的老卡/导入卡兜底）。
      // 都标 source:'inferred'（非作者本次手填）；下次 apply 随 p1Output 持久化进 designMeta → 运行时也能读到。
      const legacyFrozen =
        card.snapshot?.prompt_modules?.frozen_moment || card.snapshot?.frozen_moment || null;
      let normalized = this._normalizeFrozenMoment(legacyFrozen);
      let via = legacyFrozen ? '老 schema 迁移' : null;
      if (!normalized) {
        const dt = this._inferFrozenMomentDatetimeFromTimeline(card.snapshot);
        if (dt) {
          normalized = this._normalizeFrozenMoment({ datetime: dt });
          via = 'timeline 反推';
        }
      }
      if (normalized) {
        this.p1Output.frozen_moment = { ...normalized, source: 'inferred' };
        console.log(
          `[DesignService] frozen_moment 缺失，已${via}（inferred）:`,
          this.p1Output.frozen_moment.datetime
        );
      }
    }

    // 设置名称和描述
    this.worldCardName = card.name || '';
    this.worldCardDescription = card.description || '';

    // 记录源卡ID（用于应用时覆盖原卡）
    this._reimportSourceCardId = card.id || null;
    this._allowOverwriteFromCardEdit = false;
    // 导入临时卡（无 ID）时，下一次应用必须新建，避免覆盖当前激活卡
    this.forceCreateNewOnNextApply = !card.id;
    // 「正在编辑哪张卡」指针：刷新后进设计模式自动接回编辑会话（game.js
    // _readPendingCardEditResumeId 消费）。读取端校验卡仍在草稿态（_editDraft presence）
    // 才生效——应用/放弃/删卡后指针自然失效并被自愈清除。
    try {
      if (card.id) localStorage.setItem('design_mode_editing_card_id', card.id);
      else localStorage.removeItem('design_mode_editing_card_id');
    } catch (_) { /* quota 满等不致命——丢的只是刷新自动接回的便利 */ }

    // 清空验证报告
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
          return `${c.name || id}: ${c.role || c.title || ''} ${c.personality || ''}`.trim();
        })
        .filter(Boolean)
        .join('; ');
      p1.context_chars = charDescs || '（从快照恢复）';
    } else {
      p1.context_chars = '（无角色数据）';
    }

    // context_timeline: 从 world_timeline 提取（老卡 timeline 兜底）
    const tl = snapshot.world_timeline || snapshot.timeline;
    if (tl?.events && Array.isArray(tl.events) && tl.events.length > 0) {
      const eventDescs = tl.events
        .slice(0, 10)
        .map(e => `${e.time || e.year || '?'}: ${e.content || e.title || e.description || '事件'}`)
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
    p1.world_terms = snapshot.panel_fields?._worldTermsSource || {};

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

  // ========================================
  // P3 聊天历史持久化（独立 channel，跟 designChatHistory 解耦）
  //
  // 设计语义（plan: P3 对话独立持久化）：
  //   - P3 chat 跟 P1/P2 designChatHistory 完全独立
  //   - localStorage key: design_mode_p3_history
  //   - 跟着草稿生命周期：草稿期写本地、applyToGame 时清空
  //   - 编辑成型卡时跟着 card.p3ChatHistory 走（持续 sync）
  // ========================================

  saveP3ChatHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
      this.clearP3ChatHistory();
      return;
    }
    try {
      // 复用 P1/P2 的精简逻辑（过滤错误消息、截最近 N 条）
      const compact = this._compactDesignChatHistory(history);
      localStorage.setItem('design_mode_p3_history', JSON.stringify(compact));
    } catch (e) {
      try {
        const fallback = history.slice(-40);
        localStorage.setItem('design_mode_p3_history', JSON.stringify(fallback));
      } catch (e2) {
        console.warn('[DesignService] 保存 P3 聊天历史失败:', e, e2);
      }
    }
  }

  static loadP3ChatHistory() {
    try {
      const saved = localStorage.getItem('design_mode_p3_history');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('[DesignService] 加载 P3 聊天历史失败:', e);
      return [];
    }
  }

  clearP3ChatHistory() {
    localStorage.removeItem('design_mode_p3_history');
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
      // 失败/校验未过 状态的 stage 气泡不持久化（决策 #12）：
      // 用户重进后只剩一个 "未完成" 的占位 stage（由 designService.p2Stage 推断），点重试即可。
      if (
        msg._isStageBubble === true &&
        (msg.stageStatus === 'failed' || msg.stageStatus === 'validation_failed')
      ) {
        return false;
      }
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
      // Phase 2 stage 气泡：errorMeta 是临时诊断信息（重进时错误状态已被 filter 排除）；
      // _stagePanelMounted 是 runtime 渲染 flag，不进存档。
      delete compact.errorMeta;
      delete compact._stagePanelMounted;
      // streaming 状态的 stage 气泡 落盘时按 aborted 处理（防御性兜底：
      // beforeunload 应该已经翻过，但 cron 自动 save 时可能 streaming 仍在进行——
      // 仅修改 compact 副本，原 histMsg 仍保持 streaming 让 live render 不被打断）
      if (compact._isStageBubble === true && compact.stageStatus === 'streaming') {
        compact.stageStatus = 'aborted';
      }
      // 流式原始文本可能很大（10KB+），完成态留 8K 截断够回顾，aborted 态留以利重看
      if (compact._isStageBubble === true && typeof compact.rawStreamText === 'string' && compact.rawStreamText.length > 8000) {
        compact.rawStreamText = `${compact.rawStreamText.slice(0, 8000)}…`;
      }

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
                  .slice(0, 6)
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
      // p1Confirm.framework（~30KB）跟 p1Output 一致——持久化只保留 UI 渲染必需的 anchor / frozen_moment / naming，
      // 把 framework / _rejectedFramework 剥掉防 chatHistory 膨胀。p1Output 才是 framework 单一权威源（design_mode_meta 独立持久化）。
      // 回放路径：renderDesignP1Panel 渲染 confirm 卡时若 framework 缺失，会用草稿 p1Output 现拼回填（chatCore.js confirmData refill）；
      // commit 也从草稿现拼（_tryClientCommitFramework / commitP1FrameworkFromDraft，不读快照）。
      // 注：旧注释曾说"丢 framework 后走 AI fallback"，那是 06+07 合并前的实现，已不成立。
      if (compact.p1Confirm && typeof compact.p1Confirm === 'object') {
        compact.p1Confirm = {
          anchor: compact.p1Confirm.anchor,
          frozen_moment: compact.p1Confirm.frozen_moment,
          naming: compact.p1Confirm.naming,
          // Part 2·A1+B：手写态标记要留住——否则 reload 后手写确认卡退化成普通确认卡（卡不展开、无提示）。
          ...(compact.p1Confirm.manualWrite === true ? { manualWrite: true } : {}),
        };
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
   * AI 往轮的结构化产出（施力点/方向题/字段/起名/框架）用**中性标签**（[我上一轮…]）重建，
   * 让模型看到自己之前给过什么（防重复问题、知道已设的锚点等）。
   * **绝不用 \`<<<P1_*>>>\` marker 包裹**——stepified 流程每步产出的是干净 JSON / 工具调用，历史里若把它们
   * 包成 marker 块，会通过 in-context learning **教坏弱模型**去吐 marker、无视当前 step 的干净输出格式
   * （2026-06-01 trace 实证的第二个污染源；system prompt 已换干净 base，历史这层也必须一起去 marker）。
   * 详见 内部设计文档（Part 3）。
   */
  _formatMessages(history) {
    const recent = history.slice(-30);
    const out = [];
    for (const msg of recent) {
      const role = msg.sender === 'user' ? 'user' : 'assistant';
      if (role === 'user') {
        // Part 2：「重新生成」/「我自己写」是 UI 动作 marker（不是对话内容），不喂给 AI——否则
        // step3a 会看到一条尾随 user turn。其它 【…】 marker 是真实提交、照常保留。
        if (typeof msg.text === 'string' && (msg.text.startsWith('【重新生成】') || msg.text.startsWith('【自己写】'))) continue;
        out.push({ role, content: msg.text || '' });
        continue;
      }
      // === step2 单气泡多轮：展开 step2Timeline 成多个 assistant + user turn ===
      // 让 AI 看到自己每轮 ask_more_questions 的产出 + 用户答案 + 当前最新一轮
      if (msg.step2Mode === true && Array.isArray(msg.step2Timeline) && msg.step2Timeline.length > 0) {
        for (const round of msg.step2Timeline) {
          if (!round || !Array.isArray(round.questions) || round.questions.length === 0) continue;
          // assistant turn：当轮问题（中性标签重建，不用 marker——见 _formatMessages 头注释）
          const qBlock = JSON.stringify({
            round: round.round || 0,
            questions: round.questions,
          });
          out.push({ role: 'assistant', content: `[我上一轮问的方向题]\n${qBlock}` });
          // user turn：当轮答案（若 locked = 有答案，inline 进 Q&A 包；否则不 emit user turn）
          if (round.locked && Array.isArray(round.answers) && round.answers.length > 0) {
            const lines = ['【回答当前轮问题】'];
            round.questions.forEach((q, idx) => {
              const a = round.answers[idx];
              const aText = a && typeof a.answerText === 'string' && a.answerText.trim()
                ? a.answerText.trim()
                : '跳过（请按保守默认值继续）';
              lines.push(`Q${idx + 1}：${q.text || ''}`);
              lines.push(`A${idx + 1}：${aText}`);
            });
            out.push({ role: 'user', content: lines.join('\n') });
          }
        }
        // step2 message 本身的其他字段不需要再处理（已展开）；跳到下一条 msg
        continue;
      }

      // 普通 AI 消息：用**中性标签**重建往轮产出（不用 <<<P1_*>>> marker——见 _formatMessages 头注释）
      const text = msg.text || '';
      const thinking =
        typeof msg.p1ThinkingFull === 'string' && msg.p1ThinkingFull.trim()
          ? msg.p1ThinkingFull.trim()
          : typeof msg.p1ThinkingPreview === 'string' && msg.p1ThinkingPreview.trim()
            ? msg.p1ThinkingPreview.trim()
            : '';
      let content = text;
      if (thinking) {
        content += `\n\n[我上一轮的思考]\n${thinking}`;
      }
      if (Array.isArray(msg.p1Questions) && msg.p1Questions.length > 0) {
        const qBlock = JSON.stringify({
          round: 0,
          goal: msg.p1QuestionGoal || '',
          questions: msg.p1Questions,
          allow_skip: true,
          skip_policy: 'conservative_default',
        }, null, 2);
        content += `\n\n[我上一轮问的方向题]\n${qBlock}`;
      }
      if (msg.p1Anchor && typeof msg.p1Anchor === 'object') {
        content += `\n\n[我已问的施力点题]\n${JSON.stringify(msg.p1Anchor)}`;
      }
      if (msg.p1Fields && typeof msg.p1Fields === 'object') {
        content += `\n\n[我给的状态栏/字段候选]\n${JSON.stringify(msg.p1Fields)}`;
      }
      if (msg.p1Naming && Array.isArray(msg.p1Naming.entities) && msg.p1Naming.entities.length > 0) {
        content += `\n\n[我给的起名候选]\n${JSON.stringify(msg.p1Naming)}`;
      }
      if (msg.p1Confirm && typeof msg.p1Confirm === 'object') {
        const serialized = msg.p1Confirm.framework
          ? { framework: msg.p1Confirm.framework }
          : {
              anchor: msg.p1Confirm.anchor,
              frozen_moment: msg.p1Confirm.frozen_moment,
              naming: msg.p1Confirm.naming,
            };
        content += `\n\n[我产出的世界框架]\n${JSON.stringify(serialized)}`;
      }
      // 审计修复（高）：内容为空的 AI 卡（synthesis_failed / framework-notice 等只靠 marker 字段表意、
      // 但本身 text='' 且无 marker）不能进 prompt——空字符串 assistant turn 会被 Anthropic / Gemini 直接 400，
      // 把 step3a 重试 / step3→step4 调用打挂。对模型无损（这些卡没有模型可用的文本）。
      if (role === 'assistant' && !content.trim()) continue;
      out.push({ role, content });
    }
    return out;
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

// 一次性清理存量「游玩镜像」假草稿（2026-06-12 信息隔离修复随附）。
// 老格式载档/激活卡游玩时会把卡 snapshot 镜像进设计态并落盘（completionFingerprint
// = 该 snapshot 的指纹）。判据可证无损：config 指纹仍 === completionFingerprint ⇒
// 草稿内容与某张卡快照逐字节一致、零用户增量，丢弃不损失任何创作。
// 真 PZWC 新建草稿 completionFingerprint 为 null、卡编辑会话不落盘草稿键，均不会命中。
// 必须在模块加载时清（而非 initDesignService）：saves stage 的「继续草稿」chip 直接读
// localStorage，等首次进设计模式才清的话，chip 会先显示出假草稿。
(function _purgeMirroredDraftArtifact() {
  try {
    const metaRaw = localStorage.getItem('design_mode_meta');
    const cfgRaw = localStorage.getItem('design_mode_config');
    if (!metaRaw || !cfgRaw) return;
    const meta = JSON.parse(metaRaw);
    if (!meta || !meta.completionFingerprint) return;
    if (meta.draftSourceType === DESIGN_DRAFT_SOURCE_CARD_EDIT) return;
    const cfg = JSON.parse(cfgRaw);
    if (!cfg || typeof cfg !== 'object' || Object.keys(cfg).length === 0) return;
    // computeConfigFingerprint / _stableSerialize / _hashString 都是纯函数，借 prototype 调用
    const probe = Object.create(DesignService.prototype);
    if (probe.computeConfigFingerprint(cfg) !== meta.completionFingerprint) return;
    localStorage.removeItem('design_mode_config');
    localStorage.removeItem('design_mode_meta');
    localStorage.removeItem('design_mode_chat_history');
    console.log('[DesignService] 已清理旧版「游玩镜像」残留草稿（内容与卡快照零增量）');
  } catch (_e) { /* 解析失败等同没命中，留给常规草稿恢复路径处理 */ }
})();

function initDesignService() {
  if (!window.designService) {
    // 如果无 localStorage 草稿，清理旧数据防止构造函数读到旧草稿
    // （游玩激活卡不再镜像进设计态，原"待恢复卡 _pendingWorldCard"机制已随之拆除）
    const hasLocalDraft =
      typeof window.hasStoredDesignDraft === 'function' ? window.hasStoredDesignDraft() : false;
    if (!hasLocalDraft) {
      localStorage.removeItem('design_mode_meta');
      localStorage.removeItem('design_mode_chat_history');
      localStorage.removeItem('design_mode_config');
      // 注意：design_mode_pzwc_residual 故意不在此清——硬崩溃（无 beforeunload）时
      // 草稿键可能全缺、hasLocalDraft=false，但残卡正是那场崩溃唯一的幸存物，
      // 必须活到控制器的找回 offer。残卡的过期治理走显式生命周期点
      // （落地成功 / 放弃 chip / clearStoredDesignDraft 一族）。
    }

    window.designService = new DesignService();
    window.designService._bindLifecycleEvents();

    // 从 localStorage 恢复世界卡草稿历史
    // （存量「游玩镜像」假草稿已在模块加载时清理，见上方 _purgeMirroredDraftArtifact）
    const savedHistory = DesignService.loadChatHistory();
    if (savedHistory.length > 0) {
      designChatHistory = savedHistory;
    }
    // P3 chat 独立通道：从 localStorage 恢复模块级 p3ChatHistory
    const savedP3 = DesignService.loadP3ChatHistory();
    if (savedP3.length > 0 && Array.isArray(window.p3ChatHistory)) {
      window.p3ChatHistory.length = 0;
      for (const m of savedP3) window.p3ChatHistory.push(m);
    }

    if (isDesignMode) {
      chatHistory = designChatHistory;
    }
    // 卡牌审阅恢复提示 _reviewRestoreHint：已废弃。新模型下每个 stage 都有独立 stage 气泡，
    // 重进时该 stage 气泡（含 panel）会自动重放挂载，"上次停在哪"由气泡本身表达，不需要额外提示。
    // 老草稿仍可能持有 _reviewRestoreHint 消息，老的渲染路径会原样显示，不影响。
    console.log('[DesignService] 初始化完成（PZWC 建造 + P3 编辑）');
  }
  return window.designService;
}
window.initDesignService = initDesignService;
