// js/core/sessionManager.js
// 统一管理新游戏、读档、存档流程
/* global currentSessionOriginType, currentSessionOriginWorldCardId, currentSessionOriginSlotId */

const SESSION_AUTO_SAVE_ERROR_TOAST_WINDOW_MS = 5000;
const _sessionLastAutoSaveFailure = { reason: null, timestamp: 0 };
const _transitionLockState = { locked: false, source: null, timestamp: 0 };

const TRANSITION_SAVE_STATUS = Object.freeze({
  SAVED: 'saved',
  SKIPPED_NO_CONTEXT: 'skipped_no_context',
  SKIPPED_EMPTY_SESSION: 'skipped_empty_session',
  SKIPPED_ALREADY_SAVED: 'skipped_already_saved',
  FAILED: 'failed',
});

const SESSION_ORIGIN = Object.freeze({
  MANUAL: 'manual',
  UNSAVED: 'unsaved',
});

const _SESSION_ERROR_LABELS = {
  summaries: '总结',
  location: '位置',
  npcData: 'NPC',
  smsData: '短信',
  gameTime: '时间',
  characterStates: '角色状态',
  mapData: '地图',
  playerStateData: '玩家状态',
  inventoryData: '物品栏',
  gmData: 'GM引擎',
  customStatusData: '自定义状态',
  worldCard: '世界卡',
};

function _normalizeWorldCardId(worldCardId) {
  const id = typeof worldCardId === 'string' ? worldCardId.trim() : '';
  return id || null;
}

function _getActiveWorldCardIdForSession() {
  const mgr = window.worldCardManager;
  return mgr?.getActiveCardId?.() || null;
}

function _normalizeSessionOriginType(originType) {
  const normalized = typeof originType === 'string' ? originType.trim().toLowerCase() : '';
  if (Object.values(SESSION_ORIGIN).includes(normalized)) return normalized;
  return SESSION_ORIGIN.UNSAVED;
}

function _setSessionOrigin(originType, worldCardId = null, slotId = null) {
  currentSessionOriginType = _normalizeSessionOriginType(originType);
  currentSessionOriginWorldCardId = _normalizeWorldCardId(worldCardId);
  currentSessionOriginSlotId = typeof slotId === 'string' && slotId.trim() ? slotId.trim() : null;
}

function _getCurrentLiveSaveRef() {
  const boundWorldId = _normalizeWorldCardId(currentSaveBindingWorldCardId);
  const boundSlotId = typeof currentSlotId === 'string' && currentSlotId.trim() ? currentSlotId.trim() : null;
  if (boundWorldId && boundSlotId) {
    return {
      worldCardId: boundWorldId,
      slotId: boundSlotId,
    };
  }

  const originType = _normalizeSessionOriginType(currentSessionOriginType);
  const originWorldId = _normalizeWorldCardId(currentSessionOriginWorldCardId);
  const originSlotId =
    typeof currentSessionOriginSlotId === 'string' && currentSessionOriginSlotId.trim()
      ? currentSessionOriginSlotId.trim()
      : null;
  if (
    originType === SESSION_ORIGIN.MANUAL &&
    originWorldId &&
    originSlotId
  ) {
    return {
      worldCardId: originWorldId,
      slotId: originSlotId,
    };
  }

  return null;
}

function _getCurrentSessionWorldCardId() {
  const currentLiveSave = _getCurrentLiveSaveRef();
  return currentLiveSave?.worldCardId || _normalizeWorldCardId(currentSessionOriginWorldCardId) || _getActiveWorldCardIdForSession();
}

function _isCurrentSessionBinding(worldCardId, slotId) {
  const normalizedWorldId = _normalizeWorldCardId(worldCardId);
  const normalizedSlotId = typeof slotId === 'string' && slotId.trim() ? slotId.trim() : null;
  if (!normalizedWorldId || !normalizedSlotId) return false;
  return (
    currentSlotId === normalizedSlotId &&
    _normalizeWorldCardId(currentSaveBindingWorldCardId) === normalizedWorldId
  );
}

function _clearDesignDraftStorage() {
  try {
    localStorage.removeItem('design_mode_config');
    localStorage.removeItem('design_mode_meta');
    localStorage.removeItem('design_mode_chat_history');
  } catch (error) {
    console.warn('[SessionManager] 清理设计草稿失败:', error);
  }
}

function _getGameHistoryForSave() {
  if (typeof isDesignMode !== 'undefined' && isDesignMode && window._gameChatHistory) {
    return window._gameChatHistory;
  }
  return chatHistory;
}

async function _resolveSaveTarget(options = {}) {
  const { allowCreateSlot = false, preferredSlotId = null, preferredWorldCardId = null } = options;

  const preferredWorldId = _normalizeWorldCardId(preferredWorldCardId);
  const currentLiveSave = _getCurrentLiveSaveRef();
  const activeWorldId = _getActiveWorldCardIdForSession();
  const fallbackWorldId = preferredWorldId || currentLiveSave?.worldCardId || activeWorldId;
  if (!fallbackWorldId) return null;

  if (preferredSlotId) {
    return {
      worldCardId: fallbackWorldId,
      slotId: preferredSlotId,
    };
  }

  if (currentLiveSave && fallbackWorldId === currentLiveSave.worldCardId) {
    return {
      worldCardId: currentLiveSave.worldCardId,
      slotId: currentLiveSave.slotId,
    };
  }

  if (!allowCreateSlot || typeof saveManager === 'undefined') return null;

  const slotId = await saveManager.findFirstEmptySlot(fallbackWorldId);
  if (!slotId) return null;
  return { worldCardId: fallbackWorldId, slotId };
}

function _toErrorLabel(error) {
  const service = error?.service;
  if (error?.label) return error.label;
  if (service && _SESSION_ERROR_LABELS[service]) return _SESSION_ERROR_LABELS[service];
  return service || '未知模块';
}

function _dedupeErrorLabels(errors = []) {
  const labels = errors.map(_toErrorLabel).filter(Boolean);
  return Array.from(new Set(labels));
}

function _formatAutoSaveFailureReason(reason) {
  const isEnglish = window.i18nService?.getResolvedLanguage?.() === 'en';
  const translatedReason =
    typeof window.i18nService?.translateLegacyText === 'function'
      ? window.i18nService.translateLegacyText(reason || '')
      : reason || '';
  if (reason === '存储空间不足') {
    return isEnglish
      ? 'Auto-save failed: local storage is full. Clear some space and try again.'
      : '自动存档失败：本地存储空间不足，请清理后重试。';
  }
  return isEnglish
    ? `Auto-save failed: ${translatedReason || 'Unknown error'}`
    : `自动存档失败：${translatedReason || '未知错误'}`;
}

function _notifyAutoSaveFailure(reason) {
  if (typeof showToast !== 'function') return;
  const now = Date.now();
  const sameReason = _sessionLastAutoSaveFailure.reason === reason;
  const withinWindow =
    now - _sessionLastAutoSaveFailure.timestamp < SESSION_AUTO_SAVE_ERROR_TOAST_WINDOW_MS;
  if (sameReason && withinWindow) return;
  _sessionLastAutoSaveFailure.reason = reason;
  _sessionLastAutoSaveFailure.timestamp = now;
  showToast(_formatAutoSaveFailureReason(reason));
}

function _normalizeSaveSource(source) {
  const normalized = typeof source === 'string' ? source.trim().toLowerCase() : '';
  if (['manual', 'live', 'auto_transition', 'auto_runtime', 'repair'].includes(normalized)) {
    return normalized;
  }
  return 'manual';
}

function _hasNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function _hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return _hasNonEmptyText(value);
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (typeof value === 'boolean') return value === true;
  if (Array.isArray(value)) return value.some(_hasMeaningfulValue);
  if (typeof value === 'object') {
    return Object.values(value).some(_hasMeaningfulValue);
  }
  return false;
}

function _hasMeaningfulSmsData(smsData) {
  if (!smsData || typeof smsData !== 'object') return false;
  const conversations = smsData.conversations;
  if (conversations && typeof conversations === 'object') {
    for (const messages of Object.values(conversations)) {
      if (Array.isArray(messages) && messages.length > 0) return true;
    }
  }
  const unreadCounts = smsData.unreadCounts;
  if (unreadCounts && typeof unreadCounts === 'object') {
    for (const count of Object.values(unreadCounts)) {
      const parsed = Number(count);
      if (Number.isFinite(parsed) && parsed > 0) return true;
    }
  }
  return false;
}

function _hasMeaningfulLocationData(locationData) {
  if (!locationData || typeof locationData !== 'object') return false;
  const hasValidLocationPoint = source => {
    if (!source || typeof source !== 'object') return false;
    if (
      _hasNonEmptyText(source.country) ||
      _hasNonEmptyText(source.site) ||
      _hasNonEmptyText(source.spot)
    ) {
      return true;
    }
    return _hasMeaningfulValue(source);
  };
  if (Object.prototype.hasOwnProperty.call(locationData, 'current')) {
    return hasValidLocationPoint(locationData.current);
  }
  return hasValidLocationPoint(locationData);
}

function _hasMeaningfulPlayerStateData(playerStateData) {
  if (!playerStateData || typeof playerStateData !== 'object') return false;
  if (_hasNonEmptyText(playerStateData.currentObjective)) return true;
  if (_hasMeaningfulValue(playerStateData.previousTurnDate)) return true;
  if (_hasMeaningfulLocationData(playerStateData.previousTurnLocation)) return true;
  return false;
}

function _hasMeaningfulInventoryData(inventoryData) {
  if (!inventoryData || typeof inventoryData !== 'object') return false;
  if (Array.isArray(inventoryData.items) && inventoryData.items.length > 0) return true;
  if (Array.isArray(inventoryData.pendingChanges) && inventoryData.pendingChanges.length > 0)
    return true;
  return false;
}

function _hasMeaningfulGameTimeData(gameTimeData) {
  if (!gameTimeData || typeof gameTimeData !== 'object') return false;
  const triggeredEventIds = gameTimeData.triggeredEventIds;
  if (Array.isArray(triggeredEventIds)) return triggeredEventIds.length > 0;
  if (triggeredEventIds && typeof triggeredEventIds === 'object') {
    return Object.keys(triggeredEventIds).length > 0;
  }
  return false;
}

function _hasMeaningfulSessionServiceData(services) {
  if (!services || typeof services !== 'object') return false;
  if (Array.isArray(services.summaries) && services.summaries.length > 0) return true;
  if (_hasMeaningfulSmsData(services.smsData)) return true;
  if (_hasMeaningfulPlayerStateData(services.playerStateData)) return true;
  if (_hasMeaningfulInventoryData(services.inventoryData)) return true;
  if (_hasMeaningfulLocationData(services.location)) return true;
  if (_hasMeaningfulGameTimeData(services.gameTime)) return true;
  if (_hasMeaningfulValue(services.npcData)) return true;
  if (_hasMeaningfulValue(services.characterStates)) return true;
  if (_hasMeaningfulValue(services.mapData)) return true;
  if (_hasMeaningfulValue(services.gmData)) return true;
  if (_hasMeaningfulValue(services.customStatusData)) return true;
  return false;
}

function _stableSerializeForSession(value) {
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(item => _stableSerializeForSession(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const entries = keys.map(
      key => `${JSON.stringify(key)}:${_stableSerializeForSession(value[key])}`
    );
    return `{${entries.join(',')}}`;
  }
  return 'null';
}

function _hashSessionText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function _normalizeHistoryForSessionFingerprint(history) {
  if (!Array.isArray(history)) return [];
  return history.map(msg => {
    const cleaned = {
      sender: msg?.sender || '',
      text: typeof msg?.text === 'string' ? msg.text : '',
    };
    if (msg?.uid) cleaned.uid = msg.uid;
    return cleaned;
  });
}

function _isEmptySessionData(history, collectedData, collectErrors = []) {
  // 策略A（保守）：只要本轮有采集错误，就按“非空会话”处理，避免因异常导致误判并清理有效自动存档。
  if (Array.isArray(collectErrors) && collectErrors.length > 0) return false;
  const normalizedHistory = Array.isArray(history) ? history : [];
  const userMessageCount = normalizedHistory.filter(
    msg => msg?.sender === 'user' && typeof msg?.text === 'string' && msg.text.trim()
  ).length;
  if (userMessageCount > 0) return false;
  const aiMessageCount = normalizedHistory.filter(
    msg => msg?.sender === 'ai' && typeof msg?.text === 'string' && msg.text.trim()
  ).length;
  if (aiMessageCount > 1) return false;
  const services = collectedData && typeof collectedData === 'object' ? collectedData : {};
  const hasMeaningfulServiceData = _hasMeaningfulSessionServiceData(services);
  return !hasMeaningfulServiceData;
}

function _toTransitionResult({
  ok,
  status,
  reason = null,
  worldCardId = null,
  slotId = null,
  saveName = null,
  errors = [],
}) {
  return {
    ok: Boolean(ok),
    status,
    reason,
    worldCardId,
    slotId,
    saveName,
    errors: Array.isArray(errors) ? errors : [],
  };
}

function _canContinueAfterTransitionSave(saveResult, STATUS = TRANSITION_SAVE_STATUS) {
  const status = saveResult?.status;
  return Boolean(
    status === STATUS.SAVED ||
    status === STATUS.SKIPPED_NO_CONTEXT ||
    status === STATUS.SKIPPED_EMPTY_SESSION ||
    status === STATUS.SKIPPED_ALREADY_SAVED ||
    (saveResult && saveResult.ok && !status)
  );
}

const sessionManager = {
  TRANSITION_SAVE_STATUS,
  SESSION_ORIGIN,
  _lastPersistedFingerprint: null,
  _lastLoadedFingerprint: null,
  _lastNewGameBaselineFingerprint: null,

  detachCurrentSaveBinding(options = {}) {
    const { invalidateBaseline = false } = options;
    const sessionWorldId = _getCurrentSessionWorldCardId();

    currentSlotId = null;
    currentSaveBindingWorldCardId = null;
    if (_normalizeSessionOriginType(currentSessionOriginType) === SESSION_ORIGIN.MANUAL) {
      _setSessionOrigin(SESSION_ORIGIN.UNSAVED, sessionWorldId, null);
    }

    if (invalidateBaseline) {
      this._setFingerprintCheckpoints(null, {
        persisted: true,
        loaded: true,
        newGameBaseline: true,
      });
    }

    return { ok: true };
  },

  getSessionOrigin() {
    return {
      type: _normalizeSessionOriginType(currentSessionOriginType),
      worldCardId: _normalizeWorldCardId(currentSessionOriginWorldCardId),
      slotId: typeof currentSessionOriginSlotId === 'string' ? currentSessionOriginSlotId : null,
    };
  },

  getCurrentSaveBindingWorldCardId() {
    return _normalizeWorldCardId(currentSaveBindingWorldCardId);
  },

  clearAIServiceCaches() {
    if (typeof aiService !== 'undefined') {
      aiService._gmStaticCache = null;
      aiService._gmDirectiveHistory = [];
      aiService._eventsDeliveredThisScene = [];
      aiService._lastSceneLocation = null;
    }
  },

  acquireTransitionLock(source = 'unknown') {
    const normalizedSource =
      typeof source === 'string' && source.trim() ? source.trim() : 'unknown';
    if (_transitionLockState.locked) {
      return {
        ok: false,
        reason: `已有流程进行中（${_transitionLockState.source || 'unknown'}）`,
        source: _transitionLockState.source || null,
      };
    }
    _transitionLockState.locked = true;
    _transitionLockState.source = normalizedSource;
    _transitionLockState.timestamp = Date.now();
    return { ok: true, reason: null, source: normalizedSource };
  },

  releaseTransitionLock(source = 'unknown') {
    if (!_transitionLockState.locked) {
      return { ok: true };
    }

    const normalizedSource =
      typeof source === 'string' && source.trim() ? source.trim() : 'unknown';
    if (_transitionLockState.source && normalizedSource !== _transitionLockState.source) {
      console.warn(
        '[SessionManager] 忽略非持有者解锁请求:',
        normalizedSource,
        'current=',
        _transitionLockState.source
      );
      return {
        ok: false,
        reason: `当前锁由 ${_transitionLockState.source} 持有`,
        source: _transitionLockState.source,
      };
    }

    _transitionLockState.locked = false;
    _transitionLockState.source = null;
    _transitionLockState.timestamp = 0;
    return { ok: true };
  },

  isTransitionLocked() {
    return _transitionLockState.locked;
  },

  _canContinueAfterTransitionSave(saveResult) {
    return _canContinueAfterTransitionSave(saveResult, this.TRANSITION_SAVE_STATUS);
  },

  _buildSessionPayload() {
    const collectResult =
      typeof ServiceRegistry !== 'undefined' &&
      typeof ServiceRegistry.collectSaveData === 'function'
        ? ServiceRegistry.collectSaveData()
        : { data: {}, errors: [] };
    const collectedData = collectResult?.data || {};
    const collectErrors = Array.isArray(collectResult?.errors) ? collectResult.errors : [];
    const gameHistory = Array.isArray(_getGameHistoryForSave()) ? _getGameHistoryForSave() : [];
    const normalizedHistory = _normalizeHistoryForSessionFingerprint(gameHistory);
    return {
      gameHistory,
      normalizedHistory,
      collectedData,
      collectErrors,
    };
  },

  _computeSessionFingerprint(payload) {
    const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
    const serialized = _stableSerializeForSession(normalizedPayload);
    return `v1:${_hashSessionText(serialized)}:${serialized.length}`;
  },

  _setFingerprintCheckpoints(fingerprint, options = {}) {
    const normalizedFingerprint =
      typeof fingerprint === 'string' && fingerprint ? fingerprint : null;
    if (options.persisted) this._lastPersistedFingerprint = normalizedFingerprint;
    if (options.loaded) this._lastLoadedFingerprint = normalizedFingerprint;
    if (options.newGameBaseline) this._lastNewGameBaselineFingerprint = normalizedFingerprint;
  },

  getSessionSaveState(options = {}) {
    const { preferredWorldCardId = null, sessionPayload = null } = options;

    const preferredWorldId = _normalizeWorldCardId(preferredWorldCardId);
    const currentLiveSave = _getCurrentLiveSaveRef();
    const sessionOriginWorldId = _normalizeWorldCardId(currentSessionOriginWorldCardId);
    const activeWorldId = _getActiveWorldCardIdForSession();
    const boundWorldId =
      preferredWorldId ||
      currentLiveSave?.worldCardId ||
      sessionOriginWorldId ||
      null;
    const sessionWorldId = boundWorldId || activeWorldId || null;
    const hasContext = Boolean(boundWorldId);

    const payload = sessionPayload || this._buildSessionPayload();
    const fingerprintPayload = {
      history: payload.normalizedHistory || [],
      services: payload.collectedData || {},
      activeWorldCardId: activeWorldId || null,
    };
    const fingerprint = this._computeSessionFingerprint(fingerprintPayload);
    const isEmptySession = _isEmptySessionData(
      payload.normalizedHistory,
      payload.collectedData,
      payload.collectErrors
    );
    const baselineFingerprint =
      this._lastPersistedFingerprint ||
      this._lastLoadedFingerprint ||
      this._lastNewGameBaselineFingerprint ||
      null;

    let isDirty = false;
    if (hasContext) {
      if (!baselineFingerprint) {
        isDirty = !isEmptySession;
      } else {
        isDirty = fingerprint !== baselineFingerprint;
      }
    }

    const requiresSave = hasContext && !isEmptySession && isDirty;
    let reason = 'dirty';
    if (!hasContext) {
      reason = 'no_context';
    } else if (isEmptySession) {
      reason = 'empty_session';
    } else if (!isDirty) {
      reason = 'already_saved';
    }

    return {
      hasContext,
      isEmptySession,
      isDirty,
      requiresSave,
      reason,
      fingerprint,
      worldCardId: sessionWorldId,
      collectErrors: payload.collectErrors || [],
      sessionPayload: payload,
    };
  },

  _resetSessionState(options = {}) {
    const inferredPreserveDesignDraft =
      typeof window !== 'undefined' &&
      typeof window.hasStoredDesignDraft === 'function' &&
      window.hasStoredDesignDraft();
    const {
      worldCardId = null,
      silent = true,
      seedGameGreeting = true,
      preserveSlotBinding = false,
      preserveDesignDraft = inferredPreserveDesignDraft,
    } = options;

    const requestedWorldId = _normalizeWorldCardId(worldCardId);
    const activeWorldBefore = _getActiveWorldCardIdForSession();

    // 保留 slot binding（用于"在同一槽位重置"场景）
    const savedSlotId = preserveSlotBinding ? currentSlotId : null;
    const savedBindingWorldId = preserveSlotBinding ? _normalizeWorldCardId(currentSaveBindingWorldCardId) : null;

    if (requestedWorldId) {
      if (!window.worldCardManager || typeof window.worldCardManager.setActiveCard !== 'function') {
        return {
          ok: false,
          worldCardId: activeWorldBefore,
          slotId: null,
          saveName: null,
          reason: 'worldCardManager 未就绪，无法激活指定世界卡',
          errors: [],
        };
      }
      const activateResult = window.worldCardManager.setActiveCard(requestedWorldId);
      if (!activateResult || activateResult.ok === false) {
        return {
          ok: false,
          worldCardId: _getActiveWorldCardIdForSession(),
          slotId: null,
          saveName: null,
          reason: `指定世界卡激活失败：${activateResult?.reason || '未知错误'}`,
          errors: [],
        };
      }
    }

    chatHistory = [];
    this.detachCurrentSaveBinding();
    _setSessionOrigin(
      SESSION_ORIGIN.UNSAVED,
      _normalizeWorldCardId(requestedWorldId) || _getActiveWorldCardIdForSession(),
      null
    );

    if (typeof clearChatHistory === 'function') {
      clearChatHistory();
    }

    let clearErrors = [];
    if (typeof ServiceRegistry !== 'undefined' && typeof ServiceRegistry.clearAll === 'function') {
      const clearResult = ServiceRegistry.clearAll();
      clearErrors = Array.isArray(clearResult?.errors) ? clearResult.errors : [];
    }

    this.clearAIServiceCaches();
    delete window._pendingWorldCard;
    if (!preserveDesignDraft) {
      _clearDesignDraftStorage();
    }

    // clearAll 会清空 npcStore 等 store 的运行时状态（包括 _predefinedPool），
    // 必须在清空后重新激活世界卡，把 character_database 重新灌入各 store
    const _finalWorldId =
      requestedWorldId ||
      activeWorldBefore ||
      window.worldCardManager?.getDefaultBuiltInCardId?.() ||
      window.worldCardManager?.BUILTIN_CARD_ID ||
      null;

    if (
      _finalWorldId &&
      window.worldCardManager &&
      typeof window.worldCardManager.setActiveCard === 'function'
    ) {
      window.worldCardManager.setActiveCard(_finalWorldId);
    }

    const activeWorldId = _getActiveWorldCardIdForSession();
    _setSessionOrigin(SESSION_ORIGIN.UNSAVED, activeWorldId, null);

    if (window.designService && !preserveDesignDraft) {
      window.designService.stageValidationReports = {};
      window.designService.designConfig = {};
      window.designService.phase = 'p1';
      window.designService.p2Stage = 0;
      window.designService.p1Output = null;
      window.designService.worldCardName = '';
      window.designService.worldCardDescription = '';
      window.designService.pendingOperations = [];
      window.designService._reimportSourceCardId = null;
      window.designService._allowOverwriteFromCardEdit = false;
      window.designService.completionFingerprint = null;
      window.designService.forceCreateNewOnNextApply = false;
      window.designService.isAutoGenerating = false;
      window.designService.isProcessing = false;
      if (typeof window.designService._saveDesignConfig === 'function') {
        window.designService._saveDesignConfig();
      }
    }

    if (!preserveDesignDraft) {
      designChatHistory = [];
    }
    window._gameChatHistory = [];

    if (seedGameGreeting) {
      const turn0UID =
        typeof generateTurnUID === 'function' ? generateTurnUID(0) : 'turn_0_initial';
      const greeting = typeof getEffectiveGreeting === 'function' ? getEffectiveGreeting() : '';
      if (greeting && greeting.trim()) {
        chatHistory.push({ sender: 'ai', text: greeting, uid: turn0UID });
      }
    }

    if (typeof refreshChatUI === 'function') {
      refreshChatUI({ scrollMode: 'bottom' });
    }

    if (!silent && clearErrors.length > 0 && typeof showToast === 'function') {
      const labels = _dedupeErrorLabels(clearErrors);
      showToast(`已重置当前流程（${labels.join('、')}重置失败）`);
    }

    this._setFingerprintCheckpoints(null, {
      persisted: true,
      loaded: true,
      newGameBaseline: true,
    });

    // 恢复 slot binding：重置内容但继续保存在同一槽位
    if (savedSlotId && savedBindingWorldId) {
      currentSlotId = savedSlotId;
      currentSaveBindingWorldCardId = savedBindingWorldId;
      _setSessionOrigin(SESSION_ORIGIN.MANUAL, savedBindingWorldId, savedSlotId);
    }

    return {
      ok: true,
      worldCardId: activeWorldId,
      slotId: savedSlotId || null,
      saveName: null,
      reason: null,
      errors: clearErrors,
    };
  },

  resetSessionState(options = {}) {
    return this._resetSessionState(options);
  },

  async startNewGame(options = {}) {
    const { worldCardId = null, preferredSlotId = null, saveName = null, silent = true } = options;

    if (typeof saveManager === 'undefined') {
      return {
        ok: false,
        worldCardId: null,
        slotId: null,
        saveName: null,
        reason: 'saveManager 未加载',
        errors: [],
      };
    }

    const requestedWorldId = _normalizeWorldCardId(worldCardId);
    const activeWorldId = _getActiveWorldCardIdForSession();
    const targetWorldId =
      requestedWorldId ||
      activeWorldId ||
      window.worldCardManager?.getDefaultBuiltInCardId?.() ||
      window.worldCardManager?.BUILTIN_CARD_ID ||
      null;

    if (!targetWorldId) {
      return {
        ok: false,
        worldCardId: null,
        slotId: null,
        saveName: null,
        reason: '未找到可用世界卡',
        errors: [],
      };
    }

    if (
      window.worldCardManager &&
      typeof window.worldCardManager.get === 'function' &&
      !window.worldCardManager.get(targetWorldId)
    ) {
      return {
        ok: false,
        worldCardId: activeWorldId,
        slotId: null,
        saveName: null,
        reason: '目标世界卡不存在',
        errors: [],
      };
    }

    const normalizedPreferredSlotId =
      typeof preferredSlotId === 'string' && preferredSlotId.trim() ? preferredSlotId.trim() : null;
    const saves = await saveManager.getSaveList(targetWorldId);
    if (normalizedPreferredSlotId && saves[normalizedPreferredSlotId]) {
      return {
        ok: false,
        worldCardId: targetWorldId,
        slotId: normalizedPreferredSlotId,
        saveName: saves[normalizedPreferredSlotId]?.name || null,
        reason: '目标槽位不是空槽位',
        errors: [],
      };
    }

    const targetSlotId = normalizedPreferredSlotId || (await saveManager.findFirstEmptySlot(targetWorldId));
    if (!targetSlotId) {
      return {
        ok: false,
        worldCardId: targetWorldId,
        slotId: null,
        saveName: null,
        reason: '当前世界没有空槽位，请先删除一个存档',
        errors: [],
      };
    }

    const sourceLiveSave = _getCurrentLiveSaveRef();

    const resetResult = this._resetSessionState({
      worldCardId: targetWorldId,
      silent,
      seedGameGreeting: true,
    });
    if (!resetResult || !resetResult.ok) {
      return resetResult;
    }

    const finalSaveName = saveName || `存档 ${String(targetSlotId).replace('slot_', '')}`;
    const createResult = await this.saveGame({
      preferredWorldCardId: targetWorldId,
      preferredSlotId: targetSlotId,
      saveName: finalSaveName,
      defaultName: finalSaveName,
      silent: true,
      allowEmptySave: true,
      saveSource: 'live',
    });
    if (!createResult || !createResult.ok) {
      let rollbackResult = null;
      if (sourceLiveSave?.worldCardId && sourceLiveSave?.slotId) {
        rollbackResult = await this.loadGame({
          worldCardId: sourceLiveSave.worldCardId,
          slotId: sourceLiveSave.slotId,
          silent: true,
        });
      }
      return {
        ok: false,
        worldCardId: targetWorldId,
        slotId: targetSlotId,
        saveName: finalSaveName,
        reason:
          rollbackResult && rollbackResult.ok === false
            ? `${createResult?.reason || '新存档写入失败'}；回滚原存档失败：${rollbackResult.reason || '未知错误'}`
            : createResult?.reason || '新存档写入失败',
        errors: [...(resetResult.errors || []), ...(createResult?.errors || [])],
      };
    }

    try {
      const wcm = window.worldCardManager;
      const isBuiltIn = typeof wcm?.isBuiltInCard === 'function' ? !!wcm.isBuiltInCard(targetWorldId) : false;
      window.analyticsService?.noteWorldTouched?.(targetWorldId);
      window.analyticsService?.trackOnce?.('funnel.world_selected',
        { world_card_id: targetWorldId, is_builtin: isBuiltIn, source: 'new_game' },
        'funnel.world_selected:' + targetWorldId);
    } catch (_) { /* ignore */ }

    return {
      ...createResult,
      errors: [...(resetResult.errors || []), ...(createResult.errors || [])],
    };
  },

  async loadGame(options = {}) {
    const { worldCardId = null, slotId = null, silent = true } = options;

    if (typeof saveManager === 'undefined') {
      return {
        ok: false,
        worldCardId: null,
        slotId: null,
        saveName: null,
        reason: 'saveManager 未加载',
        errors: [],
      };
    }

    const targetWorldId = _normalizeWorldCardId(worldCardId) || _getActiveWorldCardIdForSession();
    let targetSlotId = slotId || null;

    if (!targetSlotId) {
      targetSlotId = await saveManager.getCurrentSlot(targetWorldId);
    }

    if (!targetSlotId) {
      return {
        ok: false,
        worldCardId: targetWorldId,
        slotId: null,
        saveName: null,
        reason: '未找到可加载的存档',
        errors: [],
      };
    }

    const saveData = await saveManager.load(targetWorldId, targetSlotId);
    if (!saveData) {
      await saveManager.setCurrentSlot(targetWorldId, null);
      if (_isCurrentSessionBinding(targetWorldId, targetSlotId)) {
        this.detachCurrentSaveBinding();
      }
      return {
        ok: false,
        worldCardId: targetWorldId,
        slotId: targetSlotId,
        saveName: null,
        reason: '存档不存在或已损坏',
        errors: [],
      };
    }

    const restoreResult = await this._restoreSessionFromSaveData(saveData, {
      targetWorldId,
      slotId: targetSlotId,
      silent,
      originType: SESSION_ORIGIN.MANUAL,
    });
    if (restoreResult && restoreResult.ok) {
      try {
        const rWid = restoreResult.worldCardId || targetWorldId;
        const wcm = window.worldCardManager;
        const isBuiltIn = typeof wcm?.isBuiltInCard === 'function' ? !!wcm.isBuiltInCard(rWid) : false;
        window.analyticsService?.noteWorldTouched?.(rWid);
        window.analyticsService?.trackOnce?.('funnel.world_selected',
          { world_card_id: rWid, is_builtin: isBuiltIn, source: 'load_save' },
          'funnel.world_selected:' + rWid);
        const sizeBytes = (() => { try { return JSON.stringify(saveData).length; } catch (_) { return null; } })();
        window.analyticsService?.track?.('feature.save_loaded', {
          slot: targetSlotId,
          world_card_id: rWid,
          size_bytes: sizeBytes,
        });
      } catch (_) { /* ignore */ }
    }
    return restoreResult;
  },

  async _restoreSessionFromSaveData(saveData, options = {}) {
    const {
      targetWorldId = null,
      slotId = null,
      silent = true,
      originType = SESSION_ORIGIN.MANUAL,
    } = options;

    const errors = [];
    const loadWorldId = saveData?.ownerWorldCardId || targetWorldId;
    let restoreWorldResult = { ok: true, worldCardId: loadWorldId, reason: null };
    if (typeof restoreWorldCard === 'function') {
      try {
        restoreWorldResult = restoreWorldCard(loadWorldId, { silent: true });
      } catch (error) {
        const message = error?.message || String(error);
        restoreWorldResult = { ok: false, worldCardId: null, reason: message };
      }
    } else {
      restoreWorldResult = { ok: false, worldCardId: null, reason: 'restoreWorldCard 不可用' };
    }

    if (!restoreWorldResult || restoreWorldResult.ok === false) {
      if (targetWorldId) {
        await saveManager.setCurrentSlot(targetWorldId, null);
      }
      const reason = `世界卡恢复失败：${restoreWorldResult?.reason || '未知错误'}`;
      if (!silent && typeof showToast === 'function') {
        showToast(reason);
      }
      return {
        ok: false,
        worldCardId: null,
        slotId: slotId || null,
        saveName: saveData?.name || null,
        reason,
        errors: [],
      };
    }

    const restoredWorldId = restoreWorldResult.worldCardId || loadWorldId || targetWorldId;
    currentSlotId = slotId;
    currentSaveBindingWorldCardId = restoredWorldId;
    _setSessionOrigin(SESSION_ORIGIN.MANUAL, restoredWorldId, slotId);

    if (typeof isDesignMode !== 'undefined' && isDesignMode) {
      window._gameChatHistory = saveData.history || [];
    } else {
      chatHistory = saveData.history || [];
    }

    // OOC 反问气泡：刷新/中断打断的 pending 必须在历史注入后立即修正，
    // 否则重载后会留下永远等不到 resolver 的输入框。
    if (typeof window.sanitizeOocPendingOnLoad === 'function') {
      try { window.sanitizeOocPendingOnLoad(); } catch (_) {}
    }

    if (
      typeof ServiceRegistry !== 'undefined' &&
      typeof ServiceRegistry.restoreAll === 'function'
    ) {
      // 旧存档兼容：三个新 store（entities / timelineEvents / 以及 npcData 的新字段）
      // 可能缺失。restoreWorldCard 已由 worldCardManager 初始化三 store 为世界卡默认值；
      // 在 ServiceRegistry.restoreAll 前为缺失键注入当前 store 状态作为占位，
      // 避免 ServiceRegistry 将其 clear() 擦除已初始化的数据。
      if (saveData && typeof saveData === 'object') {
        const _injectIfMissing = (key, svc) => {
          if (!svc || typeof svc.getSaveData !== 'function') return;
          if (!Object.prototype.hasOwnProperty.call(saveData, key)) {
            try {
              const current = svc.getSaveData();
              if (current) saveData[key] = current;
            } catch (_e) {
              /* ignore */
            }
          }
        };
        _injectIfMissing('entities', window.entityStore);
        _injectIfMissing('timelineEvents', window.timelineStore);
      }
      const restoreResult = ServiceRegistry.restoreAll(saveData);
      if (Array.isArray(restoreResult?.errors)) {
        errors.push(...restoreResult.errors);
      }
    }

    // 旧存档兼容：老版本 saveManager 未持久化 gameData，
    // 从 functionCalls 抽选项、从 runtime store 重建最后一轮状态栏，
    // 让读档后状态栏/选项能立即渲染。
    try {
      const activeHistory =
        typeof isDesignMode !== 'undefined' && isDesignMode
          ? window._gameChatHistory
          : chatHistory;
      if (Array.isArray(activeHistory) && activeHistory.length > 0) {
        let lastAiIdx = -1;
        for (let i = activeHistory.length - 1; i >= 0; i--) {
          if (activeHistory[i]?.sender === 'ai') {
            lastAiIdx = i;
            break;
          }
        }
        for (let i = 0; i < activeHistory.length; i++) {
          const msg = activeHistory[i];
          if (!msg || msg.sender !== 'ai') continue;
          if (msg.gameData && typeof msg.gameData === 'object') continue;

          let choicesFromFc = null;
          const fc = msg.functionCalls;
          if (Array.isArray(fc)) {
            outer: for (const group of fc) {
              const calls = Array.isArray(group?.calls) ? group.calls : [];
              for (const call of calls) {
                if (call?.name === 'update_choices' && Array.isArray(call?.args?.choices)) {
                  choicesFromFc = call.args.choices;
                  break outer;
                }
              }
            }
          }

          let panelStatus = null;
          if (i === lastAiIdx && typeof window.buildTurnResult === 'function') {
            try {
              const snap = window.buildTurnResult();
              if (snap && snap.panel_status) panelStatus = snap.panel_status;
            } catch (e) {
              console.warn('[SessionManager] buildTurnResult 回填失败:', e);
            }
          }

          if (panelStatus || (choicesFromFc && choicesFromFc.length > 0)) {
            const gd = {};
            if (panelStatus) gd.panel_status = panelStatus;
            if (choicesFromFc && choicesFromFc.length > 0) gd.choices = choicesFromFc;
            if (typeof msg.text === 'string' && msg.text) gd.panel_narrative = msg.text;
            msg.gameData = gd;
          }
        }
      }
    } catch (error) {
      console.warn('[SessionManager] gameData 回填异常:', error);
    }

    try {
      if (typeof syncLoadedOpeningGreeting === 'function') {
        if (typeof isDesignMode !== 'undefined' && isDesignMode) {
          syncLoadedOpeningGreeting(window._gameChatHistory);
        } else {
          syncLoadedOpeningGreeting(chatHistory);
        }
      }
      if (typeof isDesignMode !== 'undefined' && isDesignMode) {
        chatHistory = designChatHistory;
      }
    } catch (error) {
      const message = error?.message || String(error);
      errors.push({
        service: 'syncLoadedOpeningGreeting',
        stage: 'restore',
        message,
        label: '开场白同步',
      });
      console.error('[SessionManager] 开场白同步失败:', error);
    }

    this.clearAIServiceCaches();

    if (typeof refreshChatUI === 'function') {
      refreshChatUI({ scrollMode: 'bottom' });
    }

    if (!silent && errors.length > 0 && typeof showToast === 'function') {
      const labels = _dedupeErrorLabels(errors);
      showToast(`读取完成（${labels.join('、')}恢复失败）`);
    }

    const saveState = this.getSessionSaveState({
      preferredWorldCardId: restoredWorldId,
    });
    this._setFingerprintCheckpoints(saveState.fingerprint, {
      persisted: true,
      loaded: true,
      newGameBaseline: true,
    });

    return {
      ok: true,
      worldCardId: restoredWorldId,
      slotId: slotId || null,
      saveName: saveData.name || null,
      reason: null,
      errors,
    };
  },

  async saveGame(options = {}) {
    const {
      allowCreateSlot = false,
      preferredSlotId = null,
      preferredWorldCardId = null,
      defaultName = '手动存档',
      saveName = null,
      source = null,
      saveSource = 'live',
      silent = true,
      allowEmptySave = false,
      _sessionPayload = null,
      _sessionSaveState = null,
    } = options;

    if (typeof saveManager === 'undefined') {
      if (!silent && typeof showToast === 'function') {
        showToast('saveManager 未加载');
      }
      return {
        ok: false,
        worldCardId: null,
        slotId: null,
        saveName: null,
        reason: 'saveManager 未加载',
        errors: [],
      };
    }

    const preferredWorldId = _normalizeWorldCardId(preferredWorldCardId);
    const sessionWorldId = preferredWorldId || _getCurrentSessionWorldCardId();
    const hasWorldContext = Boolean(sessionWorldId);

    if (!hasWorldContext) {
      const reason = '当前未激活世界卡，无法保存';
      if (!silent && typeof showToast === 'function') {
        showToast(reason);
      }
      return { ok: false, worldCardId: null, slotId: null, saveName: null, reason, errors: [] };
    }

    const sessionPayload = _sessionPayload || this._buildSessionPayload();
    const sessionState =
      _sessionSaveState ||
      this.getSessionSaveState({
        preferredWorldCardId,
        sessionPayload,
      });
    if (sessionState.isEmptySession && allowEmptySave !== true) {
      const reason = '当前会话为空，默认不保存空存档';
      if (!silent && typeof showToast === 'function') {
        showToast(reason);
      }
      return {
        ok: false,
        worldCardId: sessionState.worldCardId,
        slotId: null,
        saveName: null,
        reason,
        errors: sessionState.collectErrors || [],
      };
    }

    const target = await _resolveSaveTarget({ allowCreateSlot, preferredSlotId, preferredWorldCardId });
    if (!target) {
      const reason = allowCreateSlot ? '当前世界没有空槽位' : '未选择存档槽位';
      if (!silent && typeof showToast === 'function') {
        showToast(reason);
      }
      return { ok: false, worldCardId: null, slotId: null, saveName: null, reason, errors: [] };
    }

    const saves = await saveManager.getSaveList(target.worldCardId);
    const existingSave = saves[target.slotId];
    const isCurrentSessionSlot = Boolean(
      currentSlotId &&
      currentSaveBindingWorldCardId &&
      currentSlotId === target.slotId &&
      currentSaveBindingWorldCardId === target.worldCardId
    );
    if (existingSave && !isCurrentSessionSlot) {
      const reason = '请先读取该存档再保存';
      if (!silent && typeof showToast === 'function') {
        showToast(reason);
      }
      return {
        ok: false,
        worldCardId: target.worldCardId,
        slotId: target.slotId,
        saveName: existingSave?.name || saveName || defaultName,
        reason,
        errors: [],
      };
    }
    const finalSaveName = saveName || existingSave?.name || defaultName;
    const normalizedSaveSource = _normalizeSaveSource(saveSource || source || 'live');

    const collectedData = sessionPayload.collectedData || {};
    const collectErrors = Array.isArray(sessionPayload.collectErrors)
      ? sessionPayload.collectErrors
      : [];
    const gameHistory = Array.isArray(sessionPayload.gameHistory) ? sessionPayload.gameHistory : [];
    const saved = await saveManager.save(target.worldCardId, target.slotId, finalSaveName, {
      history: gameHistory,
      ...collectedData,
      activeWorldCardId: _getActiveWorldCardIdForSession(),
      saveSource: normalizedSaveSource,
      collectErrorsGuard:
        collectErrors.length > 0
          ? {
              hasCollectErrors: true,
              count: collectErrors.length,
              updatedAt: new Date().toISOString(),
            }
          : null,
    });

    if (!saved) {
      return {
        ok: false,
        worldCardId: target.worldCardId,
        slotId: target.slotId,
        saveName: finalSaveName,
        reason: '存储空间不足',
        errors: collectErrors,
      };
    }

    currentSlotId = target.slotId;
    currentSaveBindingWorldCardId = saved.ownerWorldCardId || target.worldCardId;
    _setSessionOrigin(SESSION_ORIGIN.MANUAL, currentSaveBindingWorldCardId, target.slotId);
    this._setFingerprintCheckpoints(sessionState.fingerprint, { persisted: true });

    if (!silent && collectErrors.length > 0 && typeof showToast === 'function') {
      const labels = _dedupeErrorLabels(collectErrors);
      showToast(`已保存，但${labels.join('、')}保存失败`);
    }

    if (allowEmptySave !== true) {
      try {
        window.analyticsService?.trackOnce?.('funnel.first_save', {
          slot: target.slotId,
          world_card_id: currentSaveBindingWorldCardId,
        }, 'funnel.first_save');
      } catch (_) { /* ignore */ }
    }
    try {
      const sizeBytes = (() => { try { return JSON.stringify(saved).length; } catch (_) { return null; } })();
      window.analyticsService?.track?.('feature.save_created', {
        slot: target.slotId,
        world_card_id: currentSaveBindingWorldCardId,
        size_bytes: sizeBytes,
        auto: allowEmptySave === true,
      });
    } catch (_) { /* ignore */ }

    return {
      ok: true,
      worldCardId: currentSaveBindingWorldCardId,
      slotId: target.slotId,
      saveName: saved.name || finalSaveName,
      reason: null,
      errors: collectErrors,
    };
  },

  async tryAutoSaveForTransition(options = {}) {
    const { source = 'live' } = options;

    const saveState = this.getSessionSaveState();
    const activeWorldId = saveState.worldCardId || _getActiveWorldCardIdForSession();

    if (!saveState.hasContext) {
      return _toTransitionResult({
        ok: true,
        status: TRANSITION_SAVE_STATUS.SKIPPED_NO_CONTEXT,
        worldCardId: null,
      });
    }

    if (saveState.isEmptySession) {
      return _toTransitionResult({
        ok: true,
        status: TRANSITION_SAVE_STATUS.SKIPPED_EMPTY_SESSION,
        worldCardId: activeWorldId,
      });
    }

    if (!saveState.requiresSave) {
      return _toTransitionResult({
        ok: true,
        status: TRANSITION_SAVE_STATUS.SKIPPED_ALREADY_SAVED,
        worldCardId: activeWorldId,
      });
    }

    const result = await this.saveGame({
      saveSource: source,
      silent: true,
      allowEmptySave: true,
      _sessionPayload: saveState.sessionPayload,
      _sessionSaveState: saveState,
    });
    if (result?.ok) {
      return _toTransitionResult({
        ok: true,
        status: TRANSITION_SAVE_STATUS.SAVED,
        reason: null,
        worldCardId: result.worldCardId,
        slotId: result.slotId,
        saveName: result.saveName,
        errors: result.errors || [],
      });
    }

    // 无 live save binding 的 unsaved session（如 reset 后）没有可写入的槽位，
    // auto-save 失败是预期行为——静默跳过，不阻塞 transition
    if (!_getCurrentLiveSaveRef()) {
      return _toTransitionResult({
        ok: true,
        status: TRANSITION_SAVE_STATUS.SKIPPED_NO_CONTEXT,
        worldCardId: activeWorldId,
      });
    }

    return _toTransitionResult({
      ok: false,
      status: TRANSITION_SAVE_STATUS.FAILED,
      reason: result?.reason || '未知错误',
      worldCardId: result?.worldCardId || activeWorldId,
      slotId: result?.slotId || null,
      saveName: result?.saveName || null,
      errors: result?.errors || [],
    });
  },

  async createNewSaveAtEmptySlot(options = {}) {
    const {
      targetWorldCardId = null,
      targetSlotId = null,
      saveName = null,
      silent = true,
      allowEmptySave = true,
      lockSource = null,
      skipTransitionGuard = false,
    } = options;

    if (typeof saveManager === 'undefined') {
      return { ok: false, reason: 'saveManager 未加载', errors: [] };
    }

    const worldCardId = _normalizeWorldCardId(targetWorldCardId);
    const slotId = typeof targetSlotId === 'string' ? targetSlotId.trim() : '';
    const sourceLiveSave = _getCurrentLiveSaveRef();
    const sourceSessionOrigin = this.getSessionOrigin();

    if (!worldCardId) {
      return { ok: false, reason: '目标世界卡无效', errors: [] };
    }
    if (!slotId) {
      return { ok: false, reason: '目标槽位无效', errors: [] };
    }

    if (
      !window.worldCardManager ||
      typeof window.worldCardManager.get !== 'function' ||
      !window.worldCardManager.get(worldCardId)
    ) {
      return { ok: false, reason: '目标世界卡不存在', errors: [] };
    }

    const beforeSaves = await saveManager.getSaveList(worldCardId);
    if (beforeSaves[slotId]) {
      return { ok: false, reason: '目标槽位不是空槽位', errors: [] };
    }

    if (!skipTransitionGuard) {
      const normalizedLockSource = lockSource || `create-new-save:${worldCardId}:${slotId}`;
      const lockResult = this.acquireTransitionLock(normalizedLockSource);
      if (!lockResult || lockResult.ok === false) {
        return {
          ok: false,
          reason: lockResult?.reason || '请先完成当前流程',
          errors: [],
        };
      }

      try {
        const guardResult = await this.tryAutoSaveForTransition({ source: 'auto_transition' });
        if (!_canContinueAfterTransitionSave(guardResult, this.TRANSITION_SAVE_STATUS)) {
          const reason = guardResult?.reason || '未知错误';
          return {
            ok: false,
            status: guardResult?.status || TRANSITION_SAVE_STATUS.FAILED,
            reason: `自动保存当前进度失败：${reason}`,
            errors: guardResult?.errors || [],
          };
        }

        return await this.createNewSaveAtEmptySlot({
          targetWorldCardId: worldCardId,
          targetSlotId: slotId,
          saveName,
          silent,
          allowEmptySave,
          lockSource: normalizedLockSource,
          skipTransitionGuard: true,
        });
      } finally {
        this.releaseTransitionLock(normalizedLockSource);
      }
    }

    // 保护并发/竞态：自动保存后再次校验目标槽位仍为空
    const afterGuardSaves = await saveManager.getSaveList(worldCardId);
    if (afterGuardSaves[slotId]) {
      return { ok: false, reason: '目标槽位不是空槽位', errors: [] };
    }

    const defaultName = saveName || `存档 ${slotId.replace('slot_', '')}`;
    const startResult = await this.startNewGame({
      worldCardId,
      preferredSlotId: slotId,
      saveName: defaultName,
      silent: true,
    });
    if (!startResult || !startResult.ok) {
      let rollbackResult = null;
      const sourceWorldId =
        _normalizeWorldCardId(sourceSessionOrigin?.worldCardId) || sourceLiveSave?.worldCardId;

      if (sourceLiveSave) {
        rollbackResult = await this.loadGame({
          worldCardId: sourceLiveSave.worldCardId,
          slotId: sourceLiveSave.slotId,
          silent: true,
        });
      }

      if (
        (!rollbackResult || rollbackResult.ok === false) &&
        sourceWorldId &&
        typeof this.resetCurrentSession === 'function'
      ) {
        rollbackResult = this.resetCurrentSession({
          worldCardId: sourceWorldId,
          silent: true,
        });
      }

      return {
        ok: false,
        reason:
          rollbackResult && rollbackResult.ok === false
            ? `${startResult?.reason || '开始目标世界新流程失败'}；恢复原流程失败：${rollbackResult.reason || '未知错误'}`
            : startResult?.reason || '开始目标世界新流程失败',
        errors: startResult?.errors || [],
      };
    }

    if (!silent && typeof showToast === 'function') {
      showToast(`已创建新存档"${startResult.saveName || defaultName}"`);
    }

    return {
      ok: true,
      worldCardId: startResult.worldCardId,
      slotId: startResult.slotId,
      saveName: startResult.saveName || defaultName,
      reason: null,
      errors: startResult.errors || [],
    };
  },

  resetCurrentSession(options = {}) {
    const { worldCardId = null, silent = true } = options;
    const targetWorldId = _normalizeWorldCardId(worldCardId) || _getCurrentSessionWorldCardId();
    return this._resetSessionState({ worldCardId: targetWorldId, silent, seedGameGreeting: true });
  },

  markCurrentSessionUnsaved(options = {}) {
    const { worldCardId = null } = options;
    const targetWorldId = _normalizeWorldCardId(worldCardId) || _getCurrentSessionWorldCardId();
    currentSlotId = null;
    currentSaveBindingWorldCardId = null;
    _setSessionOrigin(SESSION_ORIGIN.UNSAVED, targetWorldId, null);
    return { ok: true, worldCardId: targetWorldId };
  },

  deleteCurrentSaveAndReset(options = {}) {
    const { worldCardId = null, slotId = null } = options;
    const targetWorldId =
      _normalizeWorldCardId(worldCardId) || _normalizeWorldCardId(currentSaveBindingWorldCardId);
    const targetSlotId =
      typeof slotId === 'string' && slotId.trim() ? slotId.trim() : currentSlotId;
    return {
      ok: false,
      worldCardId: targetWorldId,
      slotId: targetSlotId || null,
      saveName: null,
      reason: '当前正在游玩的存档不可直接删除，请先切换到其他存档',
      errors: [],
    };
  },

  async autoSaveGame() {
    try {
      const saveState = this.getSessionSaveState();
      if (!saveState.requiresSave) {
        let status = TRANSITION_SAVE_STATUS.SKIPPED_ALREADY_SAVED;
        if (!saveState.hasContext) {
          status = TRANSITION_SAVE_STATUS.SKIPPED_NO_CONTEXT;
        } else if (saveState.isEmptySession) {
          status = TRANSITION_SAVE_STATUS.SKIPPED_EMPTY_SESSION;
        }
        return {
          ok: true,
          status,
          worldCardId: saveState.worldCardId,
          reason: saveState.reason,
        };
      }

      const result = await this.saveGame({
        saveSource: 'live',
        silent: true,
        allowEmptySave: true,
        _sessionPayload: saveState.sessionPayload,
        _sessionSaveState: saveState,
      });
      if (!result.ok) {
        // 无 live save binding 时（如 reset 后的 unsaved session）无槽位可写，静默跳过
        if (!_getCurrentLiveSaveRef()) {
          return {
            ok: true,
            status: TRANSITION_SAVE_STATUS.SKIPPED_NO_CONTEXT,
            worldCardId: saveState.worldCardId,
            reason: 'no_slot',
          };
        }
        _notifyAutoSaveFailure(result.reason);
      }
      return result;
    } catch (e) {
      // fire-and-forget 调用点不等待返回值；内部吞异常避免未处理 rejection 污染 console
      console.error('[SessionManager] autoSaveGame 异常:', e);
      return { ok: false, status: TRANSITION_SAVE_STATUS.FAILED, reason: e?.message || '未知错误', errors: [] };
    }
  },
};

window.sessionManager = sessionManager;

console.log('[SessionManager] Initialized');
