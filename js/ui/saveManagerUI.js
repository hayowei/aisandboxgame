// ============================================
// Save Manager UI - 存档管理界面
// ============================================

// 依赖: saveManager, chat, chatHistory, currentSlotId, currentSaveBindingWorldCardId (来自其他模块)

// 模块内部状态变量(避免全局污染)
let _pendingSaveSlot = null; // { slotId, panelWorldId }
let _pendingRenameSlot = null; // { slotId, panelWorldId }
let _pendingDeleteSlot = null; // { slotId, panelWorldId }
let _saveNameMode = 'save';
let _selectedLoadTarget = null; // { worldId, slotId }
let _panelWorldId = null; // 当前面板预览世界卡 ID
let _saveManagerOpenSource = 'normal'; // normal | launcher-continue | boot-resume
const _saveSlotsScrollTopByWorld = new Map();
let _saveManagerMode = 'default';
let _transitionAutosaveModalContext = null; // { onOverwrite, onSkip, onCancel }
let _saveManagerLanguageSyncBound = false;

// ── V2 手风琴 saves stage 状态 ──
let _savesAccordionOpenId = null;
let _savesAccordionUserSet = false;   // 用户是否显式 toggle 过 accordion（区分初始 vs 主动 collapse）
let _savesSortMode = (() => {
  try {
    const v = localStorage.getItem('saveManager.sortMode');
    return v === 'name' ? 'name' : 'recent';
  } catch (_e) { return 'recent'; }
})();
let _savesActiveFilter = 'all';
let _savesHeadBound = false;

function _savesSetSortMode(mode) {
  _savesSortMode = mode === 'name' ? 'name' : 'recent';
  try { localStorage.setItem('saveManager.sortMode', _savesSortMode); } catch (_e) { /* noop */ }
}

function _savesGetCoverChar(name) {
  const raw = String(name || '').trim();
  if (!raw) return '·';
  const ch = [...raw][0] || '·';
  return ch;
}

function _savesGetCoverIdx(cardId) {
  const s = String(cardId || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 6;
}

function _formatSaveManagerBilingualText(zhText, enText) {
  const i18n = window.i18nService;
  if (typeof i18n?.formatBilingualText === 'function') {
    return i18n.formatBilingualText(zhText, enText);
  }
  // 单语回退：i18nService 未就绪时也只显示当前语言（不再拼括号双显）
  return (i18n?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? enText : zhText;
}

function _setSaveManagerBilingualText(target, zhText, enText) {
  const i18n = window.i18nService;
  if (typeof i18n?.setBilingualText === 'function') {
    i18n.setBilingualText(target, zhText, enText);
    return;
  }
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  if (!node) return;
  node.textContent = _formatSaveManagerBilingualText(zhText, enText);
}

function _getSaveManagerLanguage() {
  return window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
}

function _saveManagerText(zhText, enText) {
  return _getSaveManagerLanguage() === 'en' ? enText : zhText;
}

function _translateSaveManagerDetail(text) {
  const rawText = String(text || '').trim();
  if (!rawText) return '';
  if (typeof window.i18nService?.translateLegacyText === 'function') {
    return window.i18nService.translateLegacyText(rawText);
  }
  return rawText;
}

function _getSaveManagerReason(reason, fallbackZh = '未知错误', fallbackEn = 'Unknown error') {
  const rawReason = String(reason || '').trim();
  if (!rawReason) return _saveManagerText(fallbackZh, fallbackEn);
  return _translateSaveManagerDetail(rawReason);
}

function _isManualSlotId(slotId) {
  return /^slot_\d+$/.test(String(slotId || '').trim());
}

function _getSlotNumberLabel(slotId, fallback = '1') {
  const label = String(slotId || '')
    .replace('slot_', '')
    .trim();
  return label || fallback;
}

function _getNewSaveName(slotId) {
  const slotLabel = _getSlotNumberLabel(slotId);
  return _saveManagerText(`新存档 ${slotLabel}`, `New Save ${slotLabel}`);
}

function _getSaveLabel(slotId) {
  const slotLabel = _getSlotNumberLabel(slotId);
  return _saveManagerText(`存档 ${slotLabel}`, `Save ${slotLabel}`);
}

function _getSaveNameModalConfig(mode = 'save') {
  if (mode === 'rename') {
    return {
      title: _saveManagerText('重命名存档', 'Rename Save'),
      confirmText: _saveManagerText('重命名', 'Rename'),
    };
  }
  return {
    title: _saveManagerText('新建存档', 'Create Save'),
    confirmText: _saveManagerText('创建', 'Create'),
  };
}

function _isSaveManagerOpen() {
  // saves 现在是 stage 而非 modal——"打开"= 当前主舞台 stage 是 saves
  const stage = window.stageRouter?.getState?.()?.stage;
  return stage === 'saves';
}

function _captureSaveSlotsScroll(worldId) {
  const container = document.getElementById('save-slots-container');
  const normalizedWorldId = String(worldId || '').trim();
  if (!container || !normalizedWorldId) return;
  _saveSlotsScrollTopByWorld.set(normalizedWorldId, Math.max(0, container.scrollTop || 0));
}

function _getNearestSlotTop(container, desiredTop) {
  if (!container) return 0;
  const slots = Array.from(container.querySelectorAll('.save-slot'));
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const target = Math.max(0, Math.min(desiredTop || 0, maxTop));
  if (slots.length === 0) return target;

  let nearestTop = 0;
  let minDiff = Math.abs(target);
  slots.forEach(slot => {
    const top = Math.max(0, Math.min(slot.offsetTop, maxTop));
    const diff = Math.abs(top - target);
    if (diff < minDiff) {
      minDiff = diff;
      nearestTop = top;
    }
  });
  return nearestTop;
}

function _restoreSaveSlotsScroll(worldId) {
  const container = document.getElementById('save-slots-container');
  const normalizedWorldId = String(worldId || '').trim();
  if (!container || !normalizedWorldId) return;

  const savedTop = _saveSlotsScrollTopByWorld.get(normalizedWorldId);
  if (typeof savedTop !== 'number' || Number.isNaN(savedTop)) {
    container.scrollTop = 0;
    return;
  }

  const snappedTop = _getNearestSlotTop(container, savedTop);
  container.scrollTop = snappedTop;
  _saveSlotsScrollTopByWorld.set(normalizedWorldId, snappedTop);
}

function _getCurrentActiveWorldCardId() {
  const mgr = window.worldCardManager;
  return mgr?.getActiveCardId?.() || null;
}

function _getActiveWorldCardIdForPanel() {
  const normalizedPanelId = String(_panelWorldId || '').trim();
  if (normalizedPanelId) {
    if (_worldCardExists(normalizedPanelId)) return normalizedPanelId;
    _panelWorldId = null;
  }
  return _getCurrentActiveWorldCardId();
}

function _worldCardExists(worldCardId) {
  const mgr = window.worldCardManager;
  if (!mgr) return false;
  const normalized = String(worldCardId || '').trim();
  if (!normalized) return false;
  return Boolean(mgr.get(normalized));
}

function _isTransitionOverwriteMode() {
  return false;
}

function _getLockedWorldCardId() {
  return null;
}

function _normalizeProtectedSlotIds(slotIds = []) {
  const rawList = Array.isArray(slotIds) ? slotIds : [slotIds];
  return Array.from(new Set(rawList.map(slotId => String(slotId || '').trim()).filter(Boolean)));
}

function _getProtectedSlotIds() {
  return [];
}

function _isProtectedOverwriteSlot(slotId) {
  const normalizedSlotId = String(slotId || '').trim();
  if (!normalizedSlotId) return false;
  return _getProtectedSlotIds().includes(normalizedSlotId);
}

async function runTransitionAutoSaveGuard(options = {}) {
  const {
    lockSource = 'transition-guard',
    onReady = null,
    failurePrefix = _saveManagerText('流程切换失败', 'Flow switch failed'),
  } = options;

  const manager = window.sessionManager;
  const releaseLock = () => {
    if (!manager || typeof manager.releaseTransitionLock !== 'function') return;
    manager.releaseTransitionLock(lockSource);
  };
  const finish = async callback => {
    try {
      return typeof callback === 'function' ? await callback() : true;
    } finally {
      releaseLock();
    }
  };

  if (
    !manager ||
    typeof manager.acquireTransitionLock !== 'function' ||
    typeof manager.tryAutoSaveForTransition !== 'function'
  ) {
    return finish(onReady);
  }

  const lockResult = manager.acquireTransitionLock(lockSource);
  if (!lockResult || lockResult.ok === false) {
    showToast(
      _saveManagerText(
        lockResult?.reason ? `请先完成当前流程（${lockResult.reason}）` : '请先完成当前流程',
        lockResult?.reason
          ? `Finish the current flow first (${_translateSaveManagerDetail(lockResult.reason)})`
          : 'Finish the current flow first.'
      )
    );
    return false;
  }

  const saveResult = await manager.tryAutoSaveForTransition({ source: 'auto_transition' });
  const canContinue =
    typeof manager._canContinueAfterTransitionSave === 'function'
      ? manager._canContinueAfterTransitionSave(saveResult)
      : Boolean(saveResult && saveResult.ok);

  if (canContinue) {
    return finish(onReady);
  }

  showToast(
    _saveManagerText(
      `${failurePrefix}：${_getSaveManagerReason(saveResult?.reason)}`,
      `${failurePrefix}: ${_getSaveManagerReason(saveResult?.reason)}`
    )
  );
  releaseLock();
  return false;
}

function closeTransitionAutosaveModal() {
  document.getElementById('transition-autosave-modal')?.classList.add('hidden');
  _transitionAutosaveModalContext = null;
}

function _handleTransitionAutosaveChoice(choice) {
  const context = _transitionAutosaveModalContext;
  closeTransitionAutosaveModal();
  if (!context) return;
  if (choice === 'overwrite' && typeof context.onOverwrite === 'function') {
    context.onOverwrite();
    return;
  }
  if (choice === 'skip' && typeof context.onSkip === 'function') {
    context.onSkip();
    return;
  }
  if (typeof context.onCancel === 'function') {
    context.onCancel();
  }
}

function _getTransitionAutosaveModalDefaults() {
  const isEnglish = window.i18nService?.getResolvedLanguage?.() === 'en';
  return isEnglish
    ? {
        title: 'Auto-save Conflict',
        text: 'Automatic save failed because the current world has no empty slot. Choose how to continue.',
        overwriteText: 'Choose a Slot to Overwrite',
        skipText: 'Skip Save and Continue',
        cancelText: 'Cancel',
      }
    : {
        title: '自动保存冲突',
        text: '自动保存失败：当前世界没有空槽位，请手动选择要覆盖的存档槽位。',
        overwriteText: '手动选槽位覆盖',
        skipText: '跳过保存继续',
        cancelText: '取消',
      };
}

function _applyTransitionAutosaveButton(button, options = {}) {
  if (!button) return;

  const { text = '', hidden = false, tone = 'secondary', order = null } = options;

  button.hidden = Boolean(hidden);
  button.textContent = text;
  button.classList.toggle('btn-primary', tone === 'primary');
  button.classList.toggle('btn-secondary', tone !== 'primary');
  button.style.order = Number.isFinite(order) ? String(order) : '';
}

function openTransitionAutosaveModal(options = {}) {
  const modal = document.getElementById('transition-autosave-modal');
  if (!modal) return false;
  const titleEl = document.getElementById('transition-autosave-title');
  const textEl = document.getElementById('transition-autosave-text');
  const overwriteBtn = document.getElementById('transition-autosave-overwrite-btn');
  const skipBtn = document.getElementById('transition-autosave-skip-btn');
  const cancelBtn = document.getElementById('transition-autosave-cancel-btn');
  const defaults = _getTransitionAutosaveModalDefaults();
  const title = String(options.title || defaults.title).trim();
  const text = String(options.text || defaults.text).trim();
  const titleIconClass =
    typeof options.titleIconClass === 'string' ? options.titleIconClass.trim() : 'icon icon-save';

  if (titleEl) {
    titleEl.innerHTML = '';
    if (titleIconClass) {
      const iconEl = document.createElement('span');
      iconEl.className = titleIconClass;
      titleEl.append(iconEl, document.createTextNode(' '));
    }
    titleEl.append(document.createTextNode(title));
  }
  if (textEl) {
    textEl.textContent = text;
  }

  _applyTransitionAutosaveButton(overwriteBtn, {
    text: String(options.overwriteText || defaults.overwriteText).trim(),
    hidden: options.showOverwrite === false,
    tone: options.overwriteTone || 'primary',
    order: options.overwriteOrder,
  });
  _applyTransitionAutosaveButton(skipBtn, {
    text: String(options.skipText || defaults.skipText).trim(),
    hidden: options.showSkip === false,
    tone: options.skipTone || 'secondary',
    order: options.skipOrder,
  });
  _applyTransitionAutosaveButton(cancelBtn, {
    text: String(options.cancelText || defaults.cancelText).trim(),
    hidden: options.showCancel === false,
    tone: options.cancelTone || 'secondary',
    order: options.cancelOrder,
  });

  _transitionAutosaveModalContext = {
    onOverwrite: typeof options.onOverwrite === 'function' ? options.onOverwrite : null,
    onSkip: typeof options.onSkip === 'function' ? options.onSkip : null,
    onCancel: typeof options.onCancel === 'function' ? options.onCancel : null,
  };
  modal.classList.remove('hidden');
  return true;
}

function _collectSessionErrorLabels(errors = []) {
  return Array.from(
    new Set(
      (errors || []).map(err =>
        _translateSaveManagerDetail(
          err?.label || err?.service || _saveManagerText('未知模块', 'Unknown module')
        )
      )
    )
  );
}

function _showSaveActionResult(result, options = {}) {
  const { isEmptySlot = false, fallbackName = _saveManagerText('未命名存档', 'Untitled Save') } =
    options;
  if (result && result.ok) {
    renderSaveSlots();
    const errorLabels = _collectSessionErrorLabels(result.errors || []);
    const doneName = result.saveName || fallbackName;
    if (isEmptySlot) {
      if (errorLabels.length > 0) {
        showToast(
          _saveManagerText(
            `已创建新存档"${doneName}"（${errorLabels.join('、')}保存失败）`,
            `Created new save "${doneName}" (${errorLabels.join(', ')} failed to save).`
          )
        );
      } else {
        showToast(_saveManagerText(`已创建新存档"${doneName}"`, `Created new save "${doneName}".`));
      }
    } else if (errorLabels.length > 0) {
      showToast(
        _saveManagerText(
          `已保存到"${doneName}"（${errorLabels.join('、')}保存失败）`,
          `Saved to "${doneName}" (${errorLabels.join(', ')} failed to save).`
        )
      );
    } else {
      showToast(_saveManagerText(`已保存到"${doneName}"`, `Saved to "${doneName}".`));
    }
    return true;
  }

  const reason = _getSaveManagerReason(result?.reason, '存储空间不足', 'Storage is full');
  showToast(
    _saveManagerText(
      `${isEmptySlot ? '创建新存档失败' : '存档失败'}：${reason}`,
      `${isEmptySlot ? 'Failed to create new save' : 'Save failed'}: ${reason}`
    )
  );
  return false;
}

function _getDefaultWorldCardId() {
  const configuredId = String(
    window.worldCardManager?.getDefaultBuiltInCardId?.() ||
      window.worldCardManager?.BUILTIN_CARD_ID ||
      ''
  ).trim();
  return configuredId || 'wc_builtin_default';
}

function startDefaultWorldCardFlow() {
  if (typeof isSending !== 'undefined' && isSending) {
    showToast(
      _saveManagerText(
        '请等待回复完成后再进入默认世界',
        'Wait for the current reply to finish before entering the default world.'
      )
    );
    return false;
  }

  const mgr = window.worldCardManager;
  if (!mgr || typeof mgr.get !== 'function') {
    showToast(
      _saveManagerText(
        '默认世界卡按钮不可用：worldCardManager 未就绪',
        'Default world card unavailable: worldCardManager is not ready.'
      )
    );
    return false;
  }
  if (!window.sessionManager || typeof window.sessionManager.startNewGame !== 'function') {
    showToast(
      _saveManagerText(
        '默认世界卡按钮不可用：sessionManager 未就绪',
        'Default world card unavailable: sessionManager is not ready.'
      )
    );
    return false;
  }

  const worldCardId = _getDefaultWorldCardId();
  const card = mgr.get(worldCardId);
  if (!card) {
    showToast(
      _saveManagerText(
        '默认世界卡不可用，请刷新重试',
        'The default world card is unavailable. Refresh and try again.'
      )
    );
    return false;
  }

  return runTransitionAutoSaveGuard({
    lockSource: 'default-world-inline',
    onReady: async () => {
      const startResult = await window.sessionManager.startNewGame({
        worldCardId,
        silent: true,
      });
      if (!startResult || !startResult.ok) {
        showToast(
          _saveManagerText(
            `进入默认世界失败：${_getSaveManagerReason(startResult?.reason)}`,
            `Failed to enter the default world: ${_getSaveManagerReason(startResult?.reason)}`
          )
        );
        return false;
      }
      if (_isSaveManagerOpen()) closeSaveManager();
      // 进入默认世界后导航到沙盒 mode（旧代码靠 closeSaveManager 关 modal 露出游戏）
      const _dwModeToggle = document.getElementById('mode-toggle');
      if (_dwModeToggle && _dwModeToggle.classList.contains('design-mode')) {
        _dwModeToggle.click();
      } else if (window.stageRouter && typeof window.stageRouter.setMode === 'function') {
        window.stageRouter.setMode('game');
      }
      showToast(
        _saveManagerText(
          `已进入默认世界「${card.name || _getWorldCardName(worldCardId)}」`,
          `Entered default world "${card.name || _getWorldCardName(worldCardId)}".`
        )
      );
      return true;
    },
    failurePrefix: _saveManagerText('进入默认世界失败', 'Failed to enter the default world'),
  });
}

async function _runCreateNewSaveFlow(options = {}) {
  const { targetWorldCardId, targetSlotId, finalName, allowEmptySave = false } = options;

  if (
    !window.sessionManager ||
    typeof window.sessionManager.createNewSaveAtEmptySlot !== 'function'
  ) {
    showToast(
      _saveManagerText(
        '创建新存档失败：sessionManager 不可用',
        'Failed to create a new save: sessionManager unavailable.'
      )
    );
    return null;
  }

  const result = await window.sessionManager.createNewSaveAtEmptySlot({
    targetWorldCardId,
    targetSlotId,
    saveName: finalName,
    silent: true,
    allowEmptySave,
  });
  _showSaveActionResult(result, { isEmptySlot: true, fallbackName: finalName });
  return result;
}

function _applySaveManagerModeUI() {
  const confirmBtn = document.getElementById('save-manager-confirm-btn');
  const cancelBtn = document.getElementById('save-manager-cancel-btn');
  if (!confirmBtn || !cancelBtn) return;
  _setSaveManagerBilingualText(confirmBtn, '读取', 'Load');
  _setSaveManagerBilingualText(cancelBtn, '取消', 'Cancel');
}

function _resetSaveManagerMode() {
  _saveManagerMode = 'default';
  _applySaveManagerModeUI();
}

function _renderSessionBindingHint(panelWorldId) {
  const bindingTextEl = document.getElementById('save-world-binding-text');
  if (!bindingTextEl) return;

  const sessionOrigin =
    typeof window.sessionManager?.getSessionOrigin === 'function'
      ? window.sessionManager.getSessionOrigin()
      : {
          type: currentSlotId && currentSaveBindingWorldCardId ? 'manual' : 'unsaved',
          worldCardId: currentSaveBindingWorldCardId || _getCurrentActiveWorldCardId(),
          slotId: currentSlotId,
        };
  const panelWorldName = _getWorldCardName(panelWorldId);
  const sessionWorldId = String(sessionOrigin?.worldCardId || '').trim();
  const sessionWorldName = _getWorldCardName(sessionWorldId);
  const sameWorld = sessionWorldId && panelWorldId === sessionWorldId;

  if (!sessionWorldId) {
    bindingTextEl.textContent = _saveManagerText(
      `关联：${panelWorldName} · 未绑定会话`,
      `Linked: ${panelWorldName} · No session bound`
    );
    return;
  }

  if (sessionOrigin?.type === 'manual' && sessionOrigin?.slotId) {
    const slotName =
      (typeof saveManager?.getSlotNameSync === 'function'
        ? saveManager.getSlotNameSync(sessionWorldId, sessionOrigin.slotId)
        : '') || sessionOrigin.slotId;
    bindingTextEl.textContent = sameWorld
      ? _saveManagerText(
          `关联：${panelWorldName} · 当前存档 ${slotName}`,
          `Linked: ${panelWorldName} · Current save ${slotName}`
        )
      : _saveManagerText(
          `关联：${panelWorldName} · 当前游玩来自 ${sessionWorldName}/${sessionOrigin.slotId}`,
          `Linked: ${panelWorldName} · Current play session from ${sessionWorldName}/${sessionOrigin.slotId}`
        );
    return;
  }



  bindingTextEl.textContent = sameWorld
    ? _saveManagerText(
        `关联：${panelWorldName} · 当前没有活动存档`,
        `Linked: ${panelWorldName} · No active save`
      )
    : _saveManagerText(
        `关联：${panelWorldName} · 当前游玩位于 ${sessionWorldName}`,
        `Linked: ${panelWorldName} · Current play session in ${sessionWorldName}`
      );
}

function _setSaveNameModalContent(mode) {
  const titleEl = document.getElementById('save-name-modal-title');
  const confirmBtn = document.getElementById('save-name-confirm-btn');
  const cancelBtn = document.getElementById('save-name-cancel-btn');
  const labelEl = document.querySelector('label[for="save-name-input"]');
  const cfg = _getSaveNameModalConfig(mode);
  if (titleEl) titleEl.innerHTML = `<span class="icon icon-save"></span> ${cfg.title}`;
  if (confirmBtn) confirmBtn.textContent = cfg.confirmText;
  if (cancelBtn) cancelBtn.textContent = _saveManagerText('取消', 'Cancel');
  if (labelEl) labelEl.textContent = _saveManagerText('存档名称', 'Save Name');
}

function _resetSaveNameFlowState() {
  _pendingSaveSlot = null;
  _pendingRenameSlot = null;
  _saveNameMode = 'save';
  _setSaveNameModalContent('save');
}

function _clearSelectedLoadTarget() {
  _selectedLoadTarget = null;
}

function _clearPanelWorldId() {
  _panelWorldId = null;
}

function _setSelectedLoadTarget(worldId, slotId) {
  const normalizedWorldId = String(worldId || '').trim();
  const normalizedSlotId = String(slotId || '').trim();
  if (!normalizedWorldId || !_isManualSlotId(normalizedSlotId)) return;
  _selectedLoadTarget = {
    worldId: normalizedWorldId,
    slotId: normalizedSlotId,
  };
}

function _isSelectedLoadSlot(worldId, slotId) {
  return Boolean(
    _selectedLoadTarget &&
    _selectedLoadTarget.worldId === worldId &&
    _selectedLoadTarget.slotId === slotId
  );
}

function getSaveManagerPanelWorldId() {
  return _getActiveWorldCardIdForPanel();
}

function setSaveManagerPanelWorldId(worldId, options = {}) {
  const normalizedWorldId = String(worldId || '').trim();
  if (!normalizedWorldId || !_worldCardExists(normalizedWorldId)) {
    return false;
  }

  _panelWorldId = normalizedWorldId;
  if (options.clearSelected !== false) {
    _clearSelectedLoadTarget();
  }

  if (options.render !== false) {
    renderSaveSlots();
    if (typeof renderWorldCards === 'function') renderWorldCards();
  }
  return true;
}

function syncSaveManagerPanelWorldIdWithActiveWorld(options = {}) {
  const activeId = _getCurrentActiveWorldCardId();
  if (!activeId || !_worldCardExists(activeId)) {
    _clearPanelWorldId();
    if (options.clearSelected !== false) {
      _clearSelectedLoadTarget();
    }
    if (options.render) {
      renderSaveSlots();
      if (typeof renderWorldCards === 'function') renderWorldCards();
    }
    return null;
  }

  _panelWorldId = activeId;
  if (options.clearSelected !== false) {
    _clearSelectedLoadTarget();
  }
  if (options.render) {
    renderSaveSlots();
    if (typeof renderWorldCards === 'function') renderWorldCards();
  }
  return activeId;
}

function getSaveManagerMode() {
  return 'default';
}

function getSaveManagerLockedWorldId() {
  return null;
}

window.getSaveManagerPanelWorldId = getSaveManagerPanelWorldId;
window.setSaveManagerPanelWorldId = setSaveManagerPanelWorldId;
window.syncSaveManagerPanelWorldIdWithActiveWorld = syncSaveManagerPanelWorldIdWithActiveWorld;
window.getSaveManagerMode = getSaveManagerMode;
window.getSaveManagerLockedWorldId = getSaveManagerLockedWorldId;
window.openTransitionAutosaveModal = openTransitionAutosaveModal;
window.closeTransitionAutosaveModal = closeTransitionAutosaveModal;
window.startDefaultWorldCardFlow = startDefaultWorldCardFlow;
window.runTransitionAutoSaveGuard = runTransitionAutoSaveGuard;

function setupSaveManagerUI() {
  document.getElementById('save-manager-btn').addEventListener('click', openSaveManager);
  document
    .getElementById('close-save-manager-btn')
    ?.addEventListener('click', handleSaveManagerCancel);
  document
    .getElementById('save-manager-cancel-btn')
    ?.addEventListener('click', handleSaveManagerCancel);
  document
    .getElementById('save-manager-confirm-btn')
    ?.addEventListener('click', handleSaveManagerConfirm);
  document.getElementById('import-save-btn')?.addEventListener('click', triggerImport);
  document.getElementById('import-file-input')?.addEventListener('change', handleImportFile);

  // Save name modal
  document.getElementById('save-name-confirm-btn').addEventListener('click', confirmSave);
  document.getElementById('save-name-cancel-btn').addEventListener('click', cancelSave);
  document.getElementById('save-name-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') confirmSave();
    if (e.key === 'Escape') cancelSave();
  });

  // Game save delete confirm modal
  document.getElementById('delete-confirm-btn').addEventListener('click', confirmDelete);
  document.getElementById('delete-cancel-btn').addEventListener('click', cancelDelete);

  // World card delete confirm modal
  document.getElementById('wc-delete-confirm-btn')?.addEventListener('click', () => {
    if (typeof _confirmDeleteCard === 'function') _confirmDeleteCard();
  });
  document.getElementById('wc-delete-cancel-btn')?.addEventListener('click', () => {
    if (typeof _cancelDeleteCard === 'function') _cancelDeleteCard();
  });
  document.getElementById('transition-autosave-overwrite-btn')?.addEventListener('click', () => {
    _handleTransitionAutosaveChoice('overwrite');
  });
  document.getElementById('transition-autosave-skip-btn')?.addEventListener('click', () => {
    _handleTransitionAutosaveChoice('skip');
  });
  document.getElementById('transition-autosave-cancel-btn')?.addEventListener('click', () => {
    _handleTransitionAutosaveChoice('cancel');
  });

  const saveSlotsContainer = document.getElementById('save-slots-container');
  if (saveSlotsContainer && !saveSlotsContainer.dataset.scrollTrackingBound) {
    saveSlotsContainer.addEventListener(
      'scroll',
      () => {
        const worldId = saveSlotsContainer.dataset.renderWorldId || _getActiveWorldCardIdForPanel();
        _captureSaveSlotsScroll(worldId);
      },
      { passive: true }
    );
    saveSlotsContainer.dataset.scrollTrackingBound = '1';
  }

  if (!_saveManagerLanguageSyncBound) {
    window.addEventListener('ui-language-changed', () => {
      _applySaveManagerModeUI();
      _setSaveNameModalContent(_saveNameMode);
      if (!_isSaveManagerOpen()) return;
      renderSaveSlots();
      if (typeof renderWorldCards === 'function') renderWorldCards();
    });
    _saveManagerLanguageSyncBound = true;
  }

  // World card import
  if (typeof setupWorldCardUI === 'function') setupWorldCardUI();

  // saves 是常驻 stage，stage:changed 切到 saves 时拉新数据重渲
  if (window.eventBus && typeof window.eventBus.on === 'function') {
    window.eventBus.on('stage:changed', evt => {
      if (evt && evt.stage === 'saves') {
        syncSaveManagerPanelWorldIdWithActiveWorld({ clearSelected: false });
        renderSaveSlots();
      }
    });
  }

  // 首屏可能就在 saves stage（boot-resume / 直接刷新世界卡 mode）——渲一次保证可见
  requestAnimationFrame(() => {
    if (_isSaveManagerOpen()) renderSaveSlots();
  });
}

// openSaveManager 在 v3.5 之后语义变成"导航到世界卡 mode + saves stage"。
// saves 是 stage 而非 modal——任何调用方（launcher 继续/boot-resume/header zombie/老的 worldCardUI hook）
// 触发它都是"切到 saves 舞台"。
async function openSaveManager(options = {}) {
  const preferredWorldCardId = String(options?.preferredWorldCardId || '').trim();
  _saveManagerOpenSource = 'normal';
  _resetSaveManagerMode();
  _clearSelectedLoadTarget();
  if (preferredWorldCardId && _worldCardExists(preferredWorldCardId)) {
    _panelWorldId = preferredWorldCardId;
  } else {
    syncSaveManagerPanelWorldIdWithActiveWorld({ clearSelected: false });
  }
  // 导航：通过 mode-toggle.click() 切到世界卡 mode，保证 #mode-toggle 顶部 tab 的
  // is-active 类与 stage-router 状态一起同步（直接 setMode 会漏掉这步）
  const router = window.stageRouter;
  const currentMode = router?.getState?.()?.mode;
  if (currentMode === 'design') {
    // 已在世界卡 mode：兜底切 saves stage（如果当前不在 saves）
    if (router?.getState?.()?.stage !== 'saves' && typeof router?.setStage === 'function') {
      router.setStage('saves');
    }
  } else {
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle && !modeToggle.classList.contains('design-mode')) {
      modeToggle.click();
      // mode-toggle handler 异步派发 mode-toggled → stage-router 切到 design + 默认 stage(saves)。
      // 我们的 stage:changed listener 会自动 renderSaveSlots，这里下面那次 render 是兜底。
    } else if (router && typeof router.setMode === 'function') {
      // 终极兜底：toggle 不在就走 setMode（接受 mode-toggle UI 不同步的代价）
      router.setMode('design');
    }
  }
  if (typeof renderWorldCards === 'function') renderWorldCards();
  await renderSaveSlots();
  return true;
}

// saves 不再是 modal——closeSaveManager 不再控制可见性，只清理选中状态。
// 保留函数以兼容 worldCardUI 等老调用点。
function closeSaveManager() {
  _clearSelectedLoadTarget();
  _clearPanelWorldId();
  _resetSaveManagerMode();
  _saveManagerOpenSource = 'normal';
}

// zombie #save-manager-cancel-btn 仍可能被 setupSaveManagerUI 绑定 listener；
// 老语义"取消回 launcher"已废弃，留这个 handler 让点击事件落空不报错。
function handleSaveManagerCancel() {
  closeSaveManager();
}

async function handleSaveManagerConfirm() {
  const btn = document.getElementById('save-manager-confirm-btn');
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const panelWorldId = _getActiveWorldCardIdForPanel();
    const selected = _selectedLoadTarget;
    if (!selected || selected.worldId !== panelWorldId || !selected.slotId) {
      showToast(_saveManagerText('请先选择或新建一个存档', 'Choose or create a save first.'));
      return;
    }

    const saves = await saveManager.getSaveList(panelWorldId);
    if (!saves[selected.slotId]) {
      showToast(_saveManagerText('请先选择或新建一个存档', 'Choose or create a save first.'));
      return;
    }

    await handleLoad(selected.slotId);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _getCurrentSessionOrigin() {
  if (typeof window.sessionManager?.getSessionOrigin === 'function') {
    return window.sessionManager.getSessionOrigin();
  }
  return {
    type: currentSlotId && currentSaveBindingWorldCardId ? 'manual' : 'unsaved',
    worldCardId: currentSaveBindingWorldCardId || _getCurrentActiveWorldCardId(),
    slotId: currentSlotId,
  };
}

function _isCurrentManualSave(worldId, slotId) {
  const origin = _getCurrentSessionOrigin();
  return (
    origin?.type === 'manual' &&
    currentSlotId === slotId &&
      currentSaveBindingWorldCardId === worldId
  );
}

function _getSaveProgressIso(save) {
  return save?.progressUpdatedAt || save?.updatedAt || save?.createdAt || '';
}

// ── V2 手风琴渲染 ──
const _SAVES_DESIGN_DRAFT_CARD_ID = '__design_draft__';

function _getSavesDesignDraftMeta() {
  if (typeof window.getStoredDesignDraftSnapshot !== 'function') return null;
  try {
    const snap = window.getStoredDesignDraftSnapshot();
    if (!snap || !snap.exists) return null;
    return snap.meta || null;
  } catch (_e) {
    return null;
  }
}

function _savesGetDraftPhaseLabel(meta) {
  const phase = meta?.phase || 'p1';
  if (phase === 'p1') {
    const round = Math.max(1, Number.parseInt(meta?.p1State?.round, 10) || 1);
    return _saveManagerText(`P1 · 对话第${round}轮`, `P1 · Round ${round}`);
  }
  if (phase === 'p2') {
    const stage = Math.max(0, Number.parseInt(meta?.p2Stage, 10) || 0);
    return _saveManagerText(`P2 · ${stage}/4`, `P2 · ${stage}/4`);
  }
  if (phase === 'p3' || phase === 'done') {
    return _saveManagerText('P3 · 审阅编辑', 'P3 · Review');
  }
  return 'P1';
}

function _savesFormatDraftTimeAgo(timestamp) {
  const savedAt = Number(timestamp);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return '';
  const diff = Date.now() - savedAt;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return _saveManagerText('刚刚', 'Just now');
  if (mins < 60) return _saveManagerText(`${mins}分钟前`, `${mins}m ago`);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return _saveManagerText(`${hours}小时前`, `${hours}h ago`);
  const days = Math.floor(hours / 24);
  return _saveManagerText(`${days}天前`, `${days}d ago`);
}

function _buildSavesDraftEntry(draftMeta) {
  return {
    card: {
      id: _SAVES_DESIGN_DRAFT_CARD_ID,
      _isDraft: true,
      _draftMeta: draftMeta,
      name: _saveManagerText('世界卡草稿', 'World Card Draft'),
    },
    slots: {},
    sizeBytesMap: {},
    lastIso: '',
    usedCount: 0,
    hasCurrent: false,
  };
}

async function _savesCollectWorlds() {
  const mgr = window.worldCardManager;
  const out = [];

  if (mgr && typeof mgr.list === 'function') {
    const rawCards = mgr.list() || [];
    const cards = rawCards
      .map(c => (typeof mgr.getLocalizedCard === 'function' ? mgr.getLocalizedCard(c.id) || c : c))
      .filter(c => c && c.id);

    const slotIds = Array.from({ length: saveManager.MAX_SLOTS }, (_, i) => `slot_${i + 1}`);
    const collected = await Promise.all(cards.map(async card => {
      const slots = await saveManager.getSaveList(card.id);
      const sizeBytesArr = await Promise.all(slotIds.map(slotId =>
        slots[slotId]
          ? saveManager.getSaveSlotSizeBytes(card.id, slotId).catch(() => 0)
          : Promise.resolve(0)
      ));
      const sizeBytesMap = {};
      let lastIso = '';
      let usedCount = 0;
      let hasCurrent = false;
      slotIds.forEach((slotId, idx) => {
        sizeBytesMap[slotId] = sizeBytesArr[idx];
        const s = slots[slotId];
        if (s) {
          usedCount++;
          const iso = _getSaveProgressIso(s);
          if (iso > lastIso) lastIso = iso;
          if (_isCurrentManualSave(card.id, slotId)) hasCurrent = true;
        }
      });
      return { card, slots, sizeBytesMap, lastIso, usedCount, hasCurrent };
    }));
    out.push(...collected);
  }

  const draftMeta = _getSavesDesignDraftMeta();
  if (draftMeta) out.unshift(_buildSavesDraftEntry(draftMeta));

  return out;
}

function _savesSortWorlds(worlds) {
  // 草稿永远置顶，不参与排序
  const drafts = worlds.filter(w => w.card?._isDraft);
  const cards = worlds.filter(w => !w.card?._isDraft);
  if (_savesSortMode === 'name') {
    cards.sort((a, b) =>
      String(a.card.name || '').localeCompare(String(b.card.name || ''), 'zh-Hans-CN')
    );
  } else {
    cards.sort((a, b) => {
      const ai = a.lastIso || '';
      const bi = b.lastIso || '';
      if (ai === bi) {
        return String(a.card.name || '').localeCompare(String(b.card.name || ''), 'zh-Hans-CN');
      }
      return bi.localeCompare(ai);
    });
  }
  return [...drafts, ...cards];
}

function _savesFilterWorlds(worlds, filter) {
  return worlds.filter(w => {
    const card = w.card || {};
    if (card._isDraft) {
      // 草稿仅在「全部」「本地」可见，「已购买」/「内置」隐藏
      return !filter || filter === 'all' || filter === 'local';
    }
    if (!filter || filter === 'all') return true;
    const isBuiltIn = card.isBuiltIn === true;
    if (filter === 'builtin') return isBuiltIn;
    if (filter === 'local') return !isBuiltIn && card.isPurchased !== true;
    if (filter === 'purchased') return card.isPurchased === true;
    return true;
  });
}

function _savesGetEmptyStateText(filter, hasAnyWorlds) {
  if (!hasAnyWorlds) {
    return {
      text: _saveManagerText('尚无世界卡', 'No world cards yet'),
      sub: _saveManagerText('请导入世界卡文件，或在世界卡模式新建', 'Import a world card, or create one in World Card mode'),
    };
  }
  // 总共有卡，但当前 filter 过滤后为空
  const filterLabels = {
    purchased: _saveManagerText('已购买', 'Purchased'),
    local: _saveManagerText('本地', 'Local'),
    builtin: _saveManagerText('内置', 'Built-in'),
  };
  const label = filterLabels[filter] || _saveManagerText('此分类', 'this category');
  return {
    text: _saveManagerText(`「${label}」下没有世界卡`, `No "${label}" world cards`),
    sub: _saveManagerText('切换上方分类查看其它', 'Switch the tab above to see others'),
  };
}

function _savesResolveOpenId(worlds) {
  // 草稿行没有手风琴 body，不能被选为 open 项
  const candidates = worlds.filter(w => !w.card?._isDraft);
  if (!candidates.length) return null;
  // 用户已经显式 toggle 过 → 严格尊重用户的状态（包括"全收起"= null）
  if (_savesAccordionUserSet) {
    if (_savesAccordionOpenId === null) return null;
    if (candidates.some(w => w.card.id === _savesAccordionOpenId)) {
      return _savesAccordionOpenId;
    }
    // 选中的卡片已不在过滤结果里：回落到 null（保持全收起，不要替用户重开）
    return null;
  }
  // 首次进 saves 页（未交互过）：自动展开"当前正在玩的世界卡"
  const curWorld = candidates.find(w => w.hasCurrent);
  if (curWorld) return curWorld.card.id;
  // 兜底：上次 panel 关联的卡 / 第一个有存档的卡 / 第一个卡
  const panelId = _getActiveWorldCardIdForPanel();
  if (panelId && candidates.some(w => w.card.id === panelId)) return panelId;
  const used = candidates.find(w => w.usedCount > 0);
  return (used || candidates[0]).card.id;
}

function _savesGetSortLabel() {
  return _savesSortMode === 'name'
    ? _saveManagerText('按首字母顺序', 'Sort: A–Z')
    : _saveManagerText('按最近游玩', 'Sort: Recent');
}

function _savesRenderHead(root, worlds) {
  const counterEl = root.querySelector('#saves-head-counter');
  if (counterEl) {
    const totalSlots = worlds.reduce((n, w) => n + w.usedCount, 0);
    counterEl.textContent = _formatSaveManagerBilingualText(
      `${worlds.length} 张世界卡 · ${totalSlots} 个存档`,
      `${worlds.length} worlds · ${totalSlots} saves`
    );
  }
  const sortLabel = root.querySelector('.saves-sort-label');
  if (sortLabel) sortLabel.textContent = _savesGetSortLabel();
  const tabs = root.querySelectorAll('.saves-filter-tab');
  tabs.forEach(tab => {
    const isActive = tab.dataset.savesFilter === _savesActiveFilter;
    tab.classList.toggle('is-active', isActive);
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

function _savesRenderDots(slots) {
  const slotIds = Array.from({ length: saveManager.MAX_SLOTS }, (_, i) => `slot_${i + 1}`);
  return slotIds.map(sid => {
    const s = slots[sid];
    let cls = 'saves-dot';
    if (!s) cls += ' is-empty';
    else if (_isCurrentManualSave(slots._worldId, sid)) cls += ' is-current';
    else cls += ' is-filled';
    return `<span class="${cls}" aria-hidden="true"></span>`;
  }).join('');
}

function _savesRenderSlotRow(world, slotId, slotNumber) {
  const save = world.slots[slotId];
  const cardId = world.card.id;
  if (!save) {
    const slotLabel = `${_saveManagerText('SLOT', 'SLOT')} ${String(slotNumber).padStart(2, '0')}`;
    return `
      <div class="saves-slot-row is-empty" data-world-id="${saveManager.escapeHtml(cardId)}" data-slot="${slotId}" data-slot-empty="1" tabindex="0" role="button">
        <div class="saves-slot-index is-empty"><span class="material-symbols-outlined">add</span></div>
        <div class="saves-slot-info">
          <div class="saves-slot-name is-empty">${slotLabel} · ${_saveManagerText('新游戏', 'New Game')}</div>
          <div class="saves-slot-sub">${_saveManagerText('用此世界卡开启新的分支', 'Start a new branch on this world card')}</div>
        </div>
      </div>
    `;
  }
  const isCurrent = _isCurrentManualSave(cardId, slotId);
  const safeName = saveManager.escapeHtml(save.name || _saveManagerText('未命名存档', 'Untitled Save'));
  const turnCount = saveManager.getTurnCount(save);
  const turnLabel = turnCount > 0
    ? `T${turnCount}`
    : _saveManagerText('未开始', 'Not started');
  const sizeBytes = world.sizeBytesMap[slotId] ?? 0;
  const sizeLabel = saveManager.formatSize(sizeBytes);
  // 中文习惯：5月1日 18:35（不带年）；英文：May 1, 18:35
  const whenIso = _getSaveProgressIso(save);
  const whenLabel = saveManager.escapeHtml(_saveManagerText(
    _savesFormatLastPlayedZh(whenIso),
    _savesFormatLastPlayedEn(whenIso)
  ));
  const isSelected = _isSelectedLoadSlot(cardId, slotId);
  // 5 按钮规则（决策 14）：保存仅 current 可点；载入仅 selected 可点
  const saveEnabled = isCurrent;
  const loadEnabled = isSelected;
  const deleteDisabled = isCurrent;
  const saveTitle = saveEnabled
    ? _saveManagerText('保存当前进度', 'Save current progress')
    : _saveManagerText('只能保存到正在玩的存档', 'Save only writes to the active slot');
  const loadTitle = loadEnabled
    ? _saveManagerText('载入此存档', 'Load this save')
    : _saveManagerText('请先点击此行选中再载入', 'Click the row to select first');
  const deleteTitle = deleteDisabled
    ? _saveManagerText('当前正在游玩的存档不能直接删除', 'The active save cannot be deleted directly')
    : _saveManagerText('删除', 'Delete');
  const currentChip = isCurrent
    ? `<span class="saves-chip saves-chip-accent saves-slot-current-chip">${_saveManagerText('当前', 'Current')}</span>`
    : '';
  const rowClasses = [
    'saves-slot-row',
    isCurrent ? 'is-current' : '',
    isSelected ? 'is-selected' : '',
  ].filter(Boolean).join(' ');
  const cardIdAttr = saveManager.escapeHtml(cardId);
  return `
    <div class="${rowClasses}" data-world-id="${cardIdAttr}" data-slot="${slotId}">
      <div class="saves-slot-index ${isCurrent ? 'is-current' : ''}">${slotNumber}</div>
      <div class="saves-slot-info">
        <div class="saves-slot-name-row">
          <span class="saves-slot-name">${safeName}</span>
          ${currentChip}
          <span class="saves-slot-size">${saveManager.escapeHtml(sizeLabel)}</span>
        </div>
      </div>
      <div class="saves-slot-meta">
        <span class="saves-slot-when">${whenLabel}</span>
        <span class="saves-slot-turn">${turnLabel}</span>
      </div>
      <div class="saves-slot-actions">
        <button type="button" class="saves-slot-btn" data-saves-slot-action="rename" data-world-id="${cardIdAttr}" data-slot="${slotId}" title="${_saveManagerText('重命名', 'Rename')}">
          <span class="material-symbols-outlined">edit</span><span class="saves-slot-btn-label">${_saveManagerText('重命名', 'Rename')}</span>
        </button>
        <button type="button" class="saves-slot-btn" data-saves-slot-action="export" data-world-id="${cardIdAttr}" data-slot="${slotId}" title="${_saveManagerText('导出', 'Export')}">
          <span class="material-symbols-outlined">download</span><span class="saves-slot-btn-label">${_saveManagerText('导出', 'Export')}</span>
        </button>
        <button type="button" class="saves-slot-btn is-danger" data-saves-slot-action="delete" data-world-id="${cardIdAttr}" data-slot="${slotId}" title="${deleteTitle}" ${deleteDisabled ? 'disabled' : ''}>
          <span class="material-symbols-outlined">delete</span><span class="saves-slot-btn-label">${_saveManagerText('删除', 'Delete')}</span>
        </button>
        <button type="button" class="saves-slot-btn is-primary" data-saves-slot-action="save" data-world-id="${cardIdAttr}" data-slot="${slotId}" title="${saveTitle}" ${saveEnabled ? '' : 'disabled'}>
          <span class="material-symbols-outlined">save</span><span class="saves-slot-btn-label">${_saveManagerText('保存', 'Save')}</span>
        </button>
        <button type="button" class="saves-slot-btn is-primary" data-saves-slot-action="load" data-world-id="${cardIdAttr}" data-slot="${slotId}" title="${loadTitle}" ${loadEnabled ? '' : 'disabled'}>
          <span class="material-symbols-outlined">play_arrow</span><span class="saves-slot-btn-label">${_saveManagerText('载入', 'Load')}</span>
        </button>
      </div>
    </div>
  `;
}

function _savesRenderDraftRow(world) {
  const meta = world.card?._draftMeta || {};
  const phaseLabel = saveManager.escapeHtml(_savesGetDraftPhaseLabel(meta));
  const timeAgo = _savesFormatDraftTimeAgo(meta?.savedAt);
  const timeAgoHtml = timeAgo
    ? `<span class="saves-draft-time">${saveManager.escapeHtml(timeAgo)}</span>`
    : '';
  const nameLabel = saveManager.escapeHtml(world.card.name || _saveManagerText('世界卡草稿', 'World Card Draft'));
  const badgeLabel = _saveManagerText('设计草稿', 'Draft');
  const resumeLabel = _saveManagerText('继续编辑', 'Continue');
  const discardLabel = _saveManagerText('删除', 'Delete');
  const discardTitle = _saveManagerText('丢弃草稿', 'Discard Draft');
  return `
    <div class="saves-draft-row btn-wide is-draft" data-card-id="${_SAVES_DESIGN_DRAFT_CARD_ID}">
      <div class="saves-draft-head">
        <span class="saves-draft-name">${nameLabel}</span>
        <span class="saves-draft-badge">
          <span class="material-symbols-outlined">edit_note</span>
          <span>${badgeLabel}</span>
        </span>
        <span class="saves-draft-phase">${phaseLabel}</span>
        ${timeAgoHtml}
      </div>
      <div class="saves-draft-actions" data-no-toggle="1">
        <button type="button" class="saves-wc-btn" data-action="saves-draft-resume" title="${resumeLabel}">
          <span class="material-symbols-outlined">edit_note</span><span class="saves-wc-btn-label">${resumeLabel}</span>
        </button>
        <button type="button" class="saves-wc-btn is-danger" data-action="saves-draft-discard" title="${discardTitle}" aria-label="${discardTitle}">
          <span class="material-symbols-outlined">delete</span><span class="saves-wc-btn-label">${discardLabel}</span>
        </button>
      </div>
    </div>
  `;
}

// 中文习惯日期：5月3日 08:27（不带年份；saveManager.formatDate 的 zh-CN 输出是斜线式 5/3 08:27，不够本地化）
function _savesFormatLastPlayedZh(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${month}月${day}日 ${hh}:${mm}`;
}

// 英文：May 3, 08:27
function _savesFormatLastPlayedEn(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function _savesRenderAccordionItem(world, isOpen) {
  if (world?.card?._isDraft) {
    return _savesRenderDraftRow(world);
  }
  const cardId = world.card.id;
  const cardIdAttr = saveManager.escapeHtml(cardId);
  const safeName = saveManager.escapeHtml(world.card.name || '');
  const coverChar = saveManager.escapeHtml(_savesGetCoverChar(world.card.name));
  const coverIdx = _savesGetCoverIdx(cardId);
  const descRaw = typeof world.card.description === 'string' ? world.card.description.trim() : '';
  const descHtml = descRaw
    ? `<div class="saves-accordion-desc" title="${saveManager.escapeHtml(descRaw)}">${saveManager.escapeHtml(descRaw)}</div>`
    : '';
  const dotsSlots = { ...world.slots, _worldId: cardId };
  const slotsHtml = isOpen
    ? Array.from({ length: saveManager.MAX_SLOTS }, (_, i) =>
        _savesRenderSlotRow(world, `slot_${i + 1}`, i + 1)
      ).join('')
    : '';
  // built-in 卡不能改自身（不能 edit-design / export / delete），但导入存档是塞数据进槽位、对内置卡也合法
  const isBuiltIn = world.card.isBuiltIn === true;
  const editBtnHtml = isBuiltIn ? '' : `
    <button type="button" class="saves-wc-btn" data-wc-action="edit-design" data-id="${cardIdAttr}" title="${_saveManagerText('在世界卡模式中编辑', 'Edit in World Card mode')}">
      <span class="material-symbols-outlined">edit_note</span><span class="saves-wc-btn-label">${_saveManagerText('编辑', 'Edit')}</span>
    </button>
  `;
  const importSaveBtnHtml = `
    <button type="button" class="saves-wc-btn" data-wc-action="import-save" data-id="${cardIdAttr}" title="${_saveManagerText('导入存档到此卡', 'Import save into this card')}">
      <span class="material-symbols-outlined">upload</span><span class="saves-wc-btn-label">${_saveManagerText('导入存档', 'Import Save')}</span>
    </button>
  `;
  const exportDeleteBtnsHtml = isBuiltIn ? '' : `
    <button type="button" class="saves-wc-btn" data-wc-action="export" data-id="${cardIdAttr}" title="${_saveManagerText('下载世界卡', 'Download World Card')}">
      <span class="material-symbols-outlined">download</span><span class="saves-wc-btn-label">${_saveManagerText('下载世界卡', 'Download World Card')}</span>
    </button>
    <button type="button" class="saves-wc-btn is-danger" data-wc-action="delete" data-id="${cardIdAttr}" title="${_saveManagerText('删除', 'Delete')}">
      <span class="material-symbols-outlined">delete</span><span class="saves-wc-btn-label">${_saveManagerText('删除', 'Delete')}</span>
    </button>
  `;
  // ≤480px 折叠成「…」单按钮（CSS 控制显隐，DOM 双轨并存）。点击触发 savesRowMenuUI dropdown。
  // 把"最后游玩时间"格式化好挂到 trigger 上，dropdown 顶部展示
  const moreBtnTitle = _saveManagerText('更多操作', 'More actions');
  const moreBtnWhen = world.lastIso
    ? saveManager.escapeHtml(_saveManagerText(
        `最后游玩时间：${_savesFormatLastPlayedZh(world.lastIso)}`,
        `Last played: ${_savesFormatLastPlayedEn(world.lastIso)}`
      ))
    : _saveManagerText('最后游玩时间：暂无存档', 'Last played: never');
  const moreBtnHtml = `
    <button type="button" class="saves-wc-btn saves-wc-btn--menu" data-saves-row-menu-trigger="${cardIdAttr}" data-saves-row-menu-builtin="${isBuiltIn ? '1' : '0'}" data-saves-row-menu-when="${moreBtnWhen}" title="${moreBtnTitle}" aria-label="${moreBtnTitle}" aria-haspopup="menu" aria-expanded="false">
      <span class="material-symbols-outlined">more_horiz</span>
    </button>
  `;
  const wcActionsHtml = `
    <div class="saves-accordion-wc-actions" data-no-toggle="1">
      ${editBtnHtml}${importSaveBtnHtml}${exportDeleteBtnsHtml}${moreBtnHtml}
    </div>
  `;
  return `
    <article class="saves-accordion-item ${isOpen ? 'is-open' : ''}" data-world-id="${cardIdAttr}">
      <div class="saves-accordion-head" data-saves-accordion-toggle data-world-id="${cardIdAttr}" role="button" tabindex="0" aria-expanded="${isOpen ? 'true' : 'false'}">
        <div class="saves-cover saves-accordion-cover" data-cover="${coverIdx}">${coverChar}</div>
        <div class="saves-accordion-info">
          <div class="saves-accordion-name-row">
            <span class="saves-accordion-name">${safeName}</span>
          </div>
          ${descHtml}
        </div>
        <div class="saves-accordion-dots" aria-hidden="true">${_savesRenderDots(dotsSlots)}</div>
        ${wcActionsHtml}
        <span class="saves-accordion-chev material-symbols-outlined" aria-hidden="true">${isOpen ? 'expand_less' : 'expand_more'}</span>
      </div>
      ${isOpen ? `<div class="saves-accordion-body">${slotsHtml}</div>` : ''}
    </article>
  `;
}

function _savesBindHeadEvents(root) {
  if (_savesHeadBound) return;
  _savesHeadBound = true;

  root.addEventListener('click', evt => {
    const sortBtn = evt.target.closest('[data-saves-sort]');
    if (sortBtn) {
      _savesSetSortMode(_savesSortMode === 'recent' ? 'name' : 'recent');
      renderSaveSlots();
      return;
    }
    const filterBtn = evt.target.closest('[data-saves-filter]');
    if (filterBtn) {
      const nextFilter = filterBtn.dataset.savesFilter || 'all';
      if (nextFilter === _savesActiveFilter) return;
      _savesActiveFilter = nextFilter;
      // 切 filter 视为重新进入：清除"用户已 toggle accordion"标记，让新过滤后的视图重新自动展开
      _savesAccordionUserSet = false;
      renderSaveSlots();
    }
  });
}

async function renderSaveSlots() {
  // 兼容：旧调用点仍可触发本函数。新 UI 落在 #saves-accordion-list；
  // 若 DOM 缺失（早于 index.html 加载完成等极端情况），静默 noop。
  const root = document.getElementById('saves-stage-root');
  const listEl = document.getElementById('saves-accordion-list');
  if (!root || !listEl) return;

  _savesBindHeadEvents(root);

  const worlds = await _savesCollectWorlds();
  const sortedAll = _savesSortWorlds(worlds);
  const filteredWorlds = _savesFilterWorlds(sortedAll, _savesActiveFilter);
  const openId = _savesResolveOpenId(filteredWorlds);
  _savesAccordionOpenId = openId;

  // 同步 _panelWorldId 到打开的世界卡，让 handleRename/handleExport/... 等基于 panelWorldId 的 action 走对的卡
  if (openId) _panelWorldId = openId;

  // 维护 _selectedLoadTarget 不越界（按过滤后的可见列表判断）
  if (_selectedLoadTarget && !filteredWorlds.some(w => w.card.id === _selectedLoadTarget.worldId)) {
    _clearSelectedLoadTarget();
  }

  // 更新 head（计数 + sort label + filter active 状态，按过滤后的可见列表）
  _savesRenderHead(root, filteredWorlds);

  // 渲染手风琴
  if (filteredWorlds.length === 0) {
    const empty = _savesGetEmptyStateText(_savesActiveFilter, sortedAll.length > 0);
    listEl.innerHTML = `
      <div class="saves-empty-state">
        <div class="saves-empty-text">${empty.text}</div>
        <div class="saves-empty-sub">${empty.sub}</div>
      </div>
    `;
  } else {
    listEl.innerHTML = filteredWorlds
      .map(w => _savesRenderAccordionItem(w, w.card.id === openId))
      .join('');
  }

  _savesRenderSessionBindingHintLegacy(openId);
  _savesBindBodyEvents(root);
}

function _savesRenderSessionBindingHintLegacy(panelWorldId) {
  // 旧 zombie #save-world-binding-text 仍在 DOM，让现有逻辑能写入；新 UI 不显示这段
  if (typeof _renderSessionBindingHint === 'function') {
    try { _renderSessionBindingHint(panelWorldId); } catch (_e) { /* noop */ }
  }
}

// 导入存档前置检查：目标世界 5 槽是否已满。满了先弹 confirm，避免用户白选一遍文件再被失败 toast 拦下。
// 启发式：只看用户点的那张卡（panelWorldId）。文件实际若属另一张卡，handleImportFile 的 _resolveImportTargetWorld 会重路由，
// 兜底失败 toast 仍在那里。
async function _maybeConfirmFullThenImport(wcId) {
  let firstEmpty = null;
  let checkFailed = false;
  try {
    firstEmpty = await saveManager.findFirstEmptySlot(wcId);
  } catch (_e) {
    checkFailed = true;
  }
  if (firstEmpty || checkFailed) {
    // 有空槽 or 检查异常都直接走 picker；异常分支由 handleImportFile 内部 toast 兜底（避免误报"全满"）
    triggerImport();
    return;
  }
  if (typeof showConfirmModal !== 'function') {
    // 没 modal 系统就维持旧行为，让 handleImportFile 内部 toast 兜底
    triggerImport();
    return;
  }
  const worldName = _getWorldCardName(wcId);
  const title = _saveManagerText('5 槽已满', 'All Slots Full');
  const text = _saveManagerText(
    `「${worldName}」的 5 个存档槽已被占满，直接导入会失败。建议先删除一个再来。\n仍然继续选择文件吗？`,
    `All 5 save slots of "${worldName}" are occupied — importing will fail. Delete one first, or pick a file anyway?`
  );
  showConfirmModal(title, text, () => triggerImport());
}

// wc-action 派发：抽出来给本文件 body handler + savesRowMenuUI dropdown 共用。
// 视图层（按钮 vs dropdown 菜单项）双入口，业务实现同一份。
function _savesDispatchWcAction(wcAction, wcId) {
  if (!wcAction || !wcId) return;
  if (wcAction === 'edit-design' && typeof window._handleWorldCardEditInDesign === 'function') {
    window._handleWorldCardEditInDesign(wcId);
  } else if (wcAction === 'export' && typeof window._handleWorldCardExport === 'function') {
    window._handleWorldCardExport(wcId);
  } else if (wcAction === 'delete' && typeof window._handleWorldCardDelete === 'function') {
    window._handleWorldCardDelete(wcId);
  } else if (wcAction === 'import-save') {
    _panelWorldId = wcId;
    _maybeConfirmFullThenImport(wcId);
  }
}
window._savesDispatchWcAction = _savesDispatchWcAction;

let _savesBodyBound = false;
function _savesBindBodyEvents(root) {
  if (_savesBodyBound) return;
  _savesBodyBound = true;

  // accordion head toggle
  root.addEventListener('click', evt => {
    // 草稿行的"继续编辑 / 删除"按钮先判断，避免被下方逻辑误吞
    const draftResumeBtn = evt.target.closest('[data-action="saves-draft-resume"]');
    if (draftResumeBtn) {
      evt.stopPropagation();
      if (typeof window._handleResumeDraft === 'function') window._handleResumeDraft();
      return;
    }
    const draftDiscardBtn = evt.target.closest('[data-action="saves-draft-discard"]');
    if (draftDiscardBtn) {
      evt.stopPropagation();
      // discard callback 内部会调 renderWorldCards() + renderSaveSlots()
      if (typeof window._handleDiscardDraft === 'function') window._handleDiscardDraft();
      return;
    }
    // ≤480px「…」菜单 trigger 必须先于 wc-action 判断（自己没 data-wc-action 属性，但要先拦下避免冒泡到 accordion toggle）
    const menuTrigger = evt.target.closest('[data-saves-row-menu-trigger]');
    if (menuTrigger) {
      evt.stopPropagation();
      if (window.savesRowMenuUI && typeof window.savesRowMenuUI.toggle === 'function') {
        window.savesRowMenuUI.toggle(menuTrigger);
      }
      return;
    }
    // wc-action（世界卡级：编辑/导出/删除）必须先于 toggle 判断，避免点按钮误触手风琴展开
    const wcBtn = evt.target.closest('[data-wc-action]');
    if (wcBtn) {
      evt.stopPropagation();
      const wcAction = wcBtn.dataset.wcAction;
      const wcId = wcBtn.dataset.id;
      if (!wcAction || !wcId) return;
      _savesDispatchWcAction(wcAction, wcId);
      return;
    }
    const toggle = evt.target.closest('[data-saves-accordion-toggle]');
    if (toggle) {
      const wid = toggle.dataset.worldId;
      if (!wid) return;
      _savesAccordionOpenId = (_savesAccordionOpenId === wid) ? null : wid;
      _savesAccordionUserSet = true;     // 标记用户已显式交互
      if (_savesAccordionOpenId) _panelWorldId = _savesAccordionOpenId;
      renderSaveSlots();
      return;
    }
    const actionBtn = evt.target.closest('[data-saves-slot-action]');
    if (actionBtn) {
      if (actionBtn.disabled) return;
      evt.stopPropagation();
      const action = actionBtn.dataset.savesSlotAction;
      const wid = actionBtn.dataset.worldId;
      const sid = actionBtn.dataset.slot;
      if (!wid || !sid || !action) return;
      _panelWorldId = wid;
      if (action === 'rename') handleRename(sid);
      else if (action === 'export') handleExport(sid);
      else if (action === 'delete') handleDelete(sid);
      else if (action === 'save') _performOverwriteSave(sid);
      else if (action === 'load') handleLoad(sid);
      return;
    }
    const emptyRow = evt.target.closest('[data-slot-empty="1"]');
    if (emptyRow) {
      const wid = emptyRow.dataset.worldId;
      const sid = emptyRow.dataset.slot;
      if (!wid || !sid) return;
      _panelWorldId = wid;
      handleSave(sid);
      return;
    }
    const hasDataRow = evt.target.closest('.saves-slot-row:not(.is-empty)');
    if (hasDataRow && !evt.target.closest('[data-saves-slot-action]')) {
      const wid = hasDataRow.dataset.worldId;
      const sid = hasDataRow.dataset.slot;
      if (!wid || !sid) return;
      _panelWorldId = wid;
      // 行 click 只选中、不载入；载入由右侧「载入」按钮触发
      _setSelectedLoadTarget(wid, sid);
      renderSaveSlots();
    }
  });
}

async function _performLoad(panelWorldId, slotId) {
  if (!window.sessionManager || typeof window.sessionManager.loadGame !== 'function') {
    showToast(
      _saveManagerText(
        '加载存档失败：sessionManager 不可用',
        'Load failed: sessionManager unavailable.'
      )
    );
    return false;
  }

  const result = await window.sessionManager.loadGame({
    worldCardId: panelWorldId,
    slotId,
    silent: true,
  });

  if (!result || !result.ok) {
    const reason = result?.reason ? `: ${_getSaveManagerReason(result.reason)}` : '';
    showToast(
      _saveManagerText(
        `加载存档失败${result?.reason ? `：${_getSaveManagerReason(result.reason)}` : ''}`,
        `Load failed${reason}`
      )
    );
    return false;
  }

  closeSaveManager();
  // saves 是 stage 后，载入完成必须主动把用户带回沙盒 + 剧情舞台
  // （旧代码靠 closeSaveManager 关 modal 来"露出"底下的游戏，现在没 modal）
  // 走 mode-toggle.click() 而非 setMode 直接调，保证顶部 tab 的 is-active 类同步
  const _loadModeToggle = document.getElementById('mode-toggle');
  if (_loadModeToggle && _loadModeToggle.classList.contains('design-mode')) {
    _loadModeToggle.click();
  } else if (window.stageRouter && typeof window.stageRouter.setMode === 'function') {
    window.stageRouter.setMode('game');
  }
  const saveName = result.saveName || _getSaveLabel(slotId);
  const errorLabels = Array.from(
    new Set(
      (result.errors || []).map(err =>
        _translateSaveManagerDetail(
          err?.label || err?.service || _saveManagerText('未知模块', 'Unknown module')
        )
      )
    )
  );
  if (errorLabels.length > 0) {
    showToast(
      _saveManagerText(
        `已加载存档"${saveName}"（${errorLabels.join('、')}恢复失败）`,
        `Loaded save "${saveName}" (${errorLabels.join(', ')} failed to restore).`
      )
    );
  } else {
    showToast(_saveManagerText(`已加载存档"${saveName}"`, `Loaded save "${saveName}".`));
  }
  return true;
}

function _showDesignLoadBlockedNotice() {
  const title = _saveManagerText('暂时无法读取存档', 'Save cannot be loaded right now');
  const text = _saveManagerText(
    '当前设计还未保存成世界卡。请先点击“应用到游戏”完成保存后再读取存档，或刷新页面放弃当前设计。',
    'The current design has not been saved as a world card yet. Click "Apply to Game" first, or refresh the page to discard the current design.'
  );
  if (typeof showConfirmModal === 'function') {
    showConfirmModal(title, text, () => undefined);
    return;
  }
  showToast(
    _saveManagerText(
      '请先点击“应用到游戏”保存当前设计',
      'Click "Apply to Game" to save the current design first.'
    )
  );
}

function handleLoad(slotId) {
  if (typeof isSending !== 'undefined' && isSending) {
    showToast(
      _saveManagerText(
        '请等待回复完成后再读取存档',
        'Wait for the current reply to finish before loading a save.'
      )
    );
    return false;
  }

  const panelWorldId = _getActiveWorldCardIdForPanel();
  return runTransitionAutoSaveGuard({
    lockSource: `load-save:${panelWorldId}:${slotId}`,
    onReady: async () => _performLoad(panelWorldId, slotId),
    failurePrefix: _saveManagerText('加载存档失败', 'Load failed'),
  });
}

async function _performOverwriteSave(slotId) {
  if (!window.sessionManager || typeof window.sessionManager.saveGame !== 'function') {
    showToast(_saveManagerText('保存失败：sessionManager 不可用', 'Save failed: sessionManager unavailable.'));
    return;
  }
  const result = await window.sessionManager.saveGame({ saveSource: 'manual' });
  if (result?.ok) {
    await renderSaveSlots();
    showToast(_saveManagerText(
      '已手动保存。本游戏有完善的自动保存系统，手动保存仅作二次确认。',
      'Saved. This game auto-saves regularly — manual save is just a double-check.'
    ));
  } else {
    showToast(_saveManagerText(`保存失败：${result?.reason || '未知错误'}`, `Save failed: ${result?.reason || 'unknown error'}`));
  }
}

async function handleSave(slotId) {
  const panelWorldId = _getActiveWorldCardIdForPanel();
  const saves = await saveManager.getSaveList(panelWorldId);
  if (saves[slotId]) {
    showToast(
      _saveManagerText(
        '该槽位已有存档。新建存档请先选择空槽位。',
        'This slot already has a save. Choose an empty slot to create a fresh save.'
      )
    );
    return;
  }
  const defaultName = _getNewSaveName(slotId);

  // Use custom modal instead of prompt()
  const nameInput = document.getElementById('save-name-input');
  const modal = document.getElementById('save-name-modal');
  _saveNameMode = 'save';
  _pendingRenameSlot = null;
  _pendingSaveSlot = { slotId, panelWorldId };
  _setSaveNameModalContent('save');

  if (nameInput && modal) {
    nameInput.value = defaultName;
    modal.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();
  }
}

async function handleRename(slotId) {
  const panelWorldId = _getActiveWorldCardIdForPanel();
  const saves = await saveManager.getSaveList(panelWorldId);
  const save = saves[slotId];
  if (!save) return;

  const nameInput = document.getElementById('save-name-input');
  const modal = document.getElementById('save-name-modal');
  _saveNameMode = 'rename';
  _pendingSaveSlot = null;
  _pendingRenameSlot = { slotId, panelWorldId };
  _setSaveNameModalContent('rename');

  if (nameInput && modal) {
    nameInput.value = save.name || '';
    modal.classList.remove('hidden');
    nameInput.focus();
    nameInput.select();
  }
}

async function confirmSave() {
  const btn = document.getElementById('save-name-confirm-btn');
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;
  try {
    const inputEl = document.getElementById('save-name-input');
    const name = (inputEl?.value || '').trim();
    const modal = document.getElementById('save-name-modal');

    if (_saveNameMode === 'rename') {
      if (!_pendingRenameSlot) return;
      const slotId = typeof _pendingRenameSlot === 'string'
        ? _pendingRenameSlot
        : _pendingRenameSlot.slotId;
      const panelWorldId = (typeof _pendingRenameSlot === 'object' && _pendingRenameSlot.panelWorldId)
        ? _pendingRenameSlot.panelWorldId
        : _getActiveWorldCardIdForPanel();

      if (!slotId) return;
      if (!name) {
        showToast(_saveManagerText('名称不能为空', 'Name cannot be empty.'));
        return;
      }
      const isCurrentSlot =
        currentSlotId === slotId && currentSaveBindingWorldCardId === panelWorldId;
      if (modal) modal.classList.add('hidden');
      await saveManager.rename(panelWorldId, slotId, name);
      await renderSaveSlots();
      if (isCurrentSlot && typeof refreshChatUI === 'function') {
        refreshChatUI({ scrollMode: 'bottom' });
      }
      showToast(_saveManagerText(`已重命名为"${name}"`, `Renamed to "${name}".`));
      _resetSaveNameFlowState();
      return;
    }

    if (!_pendingSaveSlot) return;
    const slotId = typeof _pendingSaveSlot === 'string'
      ? _pendingSaveSlot
      : _pendingSaveSlot.slotId;
    const panelWorldId = (typeof _pendingSaveSlot === 'object' && _pendingSaveSlot.panelWorldId)
      ? _pendingSaveSlot.panelWorldId
      : _getActiveWorldCardIdForPanel();

    if (!slotId) return;

    const finalName = name || _saveManagerText('未命名存档', 'Untitled Save');
    if (modal) modal.classList.add('hidden');
    if (!window.sessionManager || typeof window.sessionManager.createNewSaveAtEmptySlot !== 'function') {
      showToast(
        _saveManagerText(
          '创建新存档失败：sessionManager 不可用',
          'Failed to create a new save: sessionManager unavailable.'
        )
      );
      _resetSaveNameFlowState();
      return;
    }

    const saves = await saveManager.getSaveList(panelWorldId);
    const isEmptySlot = !saves[slotId];
    if (!isEmptySlot) {
      showToast(
        _saveManagerText(
          '该槽位已有存档。新建存档请先选择空槽位。',
          'This slot already has a save. Choose an empty slot to create a fresh save.'
        )
      );
      _resetSaveNameFlowState();
      return;
    }

    await _runCreateNewSaveFlow({
      targetWorldCardId: panelWorldId,
      targetSlotId: slotId,
      finalName,
      allowEmptySave: true,
    });
    _resetSaveNameFlowState();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function cancelSave() {
  document.getElementById('save-name-modal').classList.add('hidden');
  _resetSaveNameFlowState();
}

async function handleExport(slotId) {
  const panelWorldId = _getActiveWorldCardIdForPanel();
  await saveManager.exportSave(panelWorldId, slotId);
}

async function handleDelete(slotId) {
  const panelWorldId = _getActiveWorldCardIdForPanel();
  const saves = await saveManager.getSaveList(panelWorldId);
  const save = saves[slotId];
  if (!save) return;
  const isCurrentSlot = currentSlotId === slotId && currentSaveBindingWorldCardId === panelWorldId;
  if (isCurrentSlot) {
    showToast(
      _saveManagerText(
        '当前正在游玩的存档不能直接删除，请先切换到其他存档。',
        'The active save cannot be deleted directly. Load another save first.'
      )
    );
    return;
  }

  // Use custom modal instead of confirm()
  document.getElementById('delete-confirm-text').textContent = _saveManagerText(
    `确定删除存档"${save.name}"吗？`,
    `Delete save "${save.name}"?`
  );
  document.getElementById('delete-confirm-modal').classList.remove('hidden');

  // Store slot ID AND panelWorldId for callback — panelWorldId must be captured now
  // to avoid re-evaluation returning a different world card ID at confirm time
  _pendingDeleteSlot = { slotId, panelWorldId };
}

async function confirmDelete() {
  const btn = document.getElementById('delete-confirm-btn');
  if (btn?.disabled) return;
  if (!_pendingDeleteSlot) return;
  if (btn) btn.disabled = true;
  try {
    // Support both old format (string) and new format ({ slotId, panelWorldId })
    const slotId = typeof _pendingDeleteSlot === 'string'
      ? _pendingDeleteSlot
      : _pendingDeleteSlot.slotId;
    const panelWorldId = (typeof _pendingDeleteSlot === 'object' && _pendingDeleteSlot.panelWorldId)
      ? _pendingDeleteSlot.panelWorldId
      : _getActiveWorldCardIdForPanel();

    if (!slotId) {
      _pendingDeleteSlot = null;
      return;
    }

    document.getElementById('delete-confirm-modal').classList.add('hidden');

    const isCurrentSlot = currentSlotId === slotId && currentSaveBindingWorldCardId === panelWorldId;
    if (isCurrentSlot) {
      showToast(
        _saveManagerText(
          '当前正在游玩的存档不能直接删除，请先切换到其他存档。',
          'The active save cannot be deleted directly. Load another save first.'
        )
      );
      _pendingDeleteSlot = null;
      return;
    }

    console.log('[SaveManagerUI] confirmDelete: worldId=%s, slotId=%s, key=%s',
      panelWorldId, slotId, `ai_adventure_save_world_${panelWorldId}_${slotId}`);

    await saveManager.delete(panelWorldId, slotId);
    if (_isSelectedLoadSlot(panelWorldId, slotId)) {
      _clearSelectedLoadTarget();
    }
    await renderSaveSlots();
    showToast(_saveManagerText('已删除存档', 'Deleted save.'));
    try {
      window.analyticsService?.track?.('feature.save_deleted', {
        slot: slotId,
        world_card_id: panelWorldId || null,
      });
    } catch (_) { /* noop */ }
    _pendingDeleteSlot = null;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function cancelDelete() {
  document.getElementById('delete-confirm-modal').classList.add('hidden');
  _pendingDeleteSlot = null;
}

function triggerImport() {
  document.getElementById('import-file-input').click();
}

function _resolveImportTargetWorld(parsedSave, panelWorldId) {
  const requestedWorldId = String(
    parsedSave?.ownerWorldCardId || parsedSave?.worldCardId || parsedSave?.activeWorldCardId || ''
  ).trim();

  if (!requestedWorldId) return panelWorldId;
  if (_worldCardExists(requestedWorldId)) {
    // 存档原属另一张已存在的卡：路由到原卡（避免 snapshot 错配），但要告诉用户去向不是他点的那张
    if (panelWorldId && requestedWorldId !== panelWorldId && typeof showToast === 'function') {
      const requestedName = _getWorldCardName(requestedWorldId);
      const panelName = _getWorldCardName(panelWorldId);
      showToast(
        _saveManagerText(
          `此存档原属于「${requestedName}」，已导入到该世界卡（不是你点击的「${panelName}」）`,
          `This save originates from "${requestedName}". Imported there instead of the world card you clicked ("${panelName}").`
        )
      );
    }
    return requestedWorldId;
  }

  if (typeof showToast === 'function') {
    showToast(
      _saveManagerText(
        `导入存档引用的世界卡不存在，已回退导入到当前世界「${_getWorldCardName(panelWorldId)}」`,
        `The imported save references a missing world card. It was imported into the current world "${_getWorldCardName(panelWorldId)}" instead.`
      )
    );
  }
  return panelWorldId;
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const importBtn = document.getElementById('import-save-btn');
  if (importBtn?.disabled) {
    e.target.value = '';
    return;
  }
  if (importBtn) importBtn.disabled = true;
  const releaseBtn = () => {
    if (importBtn) importBtn.disabled = false;
  };

  const reader = new FileReader();
  reader.onerror = releaseBtn;
  reader.onload = async event => {
    // 非空存档直接导入路径 —— 完成后释放按钮
    // 空存档走 showConfirmModal 异步路径 —— 立即释放按钮（modal 自己负责阻挡交互）
    let releasedInModalBranch = false;
    try {
      const panelWorldId = _getActiveWorldCardIdForPanel();

      let parsedSave = null;
      try {
        parsedSave = JSON.parse(event.target.result);
      } catch (_err) {
        showToast(_saveManagerText('导入失败：无效的存档文件', 'Import failed: invalid save file.'));
        return;
      }

      const targetWorldId = _resolveImportTargetWorld(parsedSave, panelWorldId);
      const targetSlot = await saveManager.findFirstEmptySlot(targetWorldId);
      if (!targetSlot) {
        showToast(
          _saveManagerText(
            `导入失败：目标世界「${_getWorldCardName(targetWorldId)}」没有空槽位，请先删除一个存档`,
            `Import failed: the target world "${_getWorldCardName(targetWorldId)}" has no empty slots. Delete one save first.`
          )
        );
        return;
      }

      const runImport = async (allowEmptyImport = false) => {
        const result = await saveManager.importSave(parsedSave, targetWorldId, targetSlot, {
          allowEmptyImport,
        });
        if (result) {
          await renderSaveSlots();
          const targetWorldName = _getWorldCardName(targetWorldId);
          showToast(
            _saveManagerText(
              `已导入存档"${result.name}"到「${targetWorldName}」/${targetSlot}`,
              `Imported save "${result.name}" into "${targetWorldName}" / ${targetSlot}.`
            )
          );
        } else {
          showToast(
            _saveManagerText('导入失败：无效的存档文件', 'Import failed: invalid save file.')
          );
        }
      };

      const isEmptyImport =
        typeof saveManager.isEmptySaveData === 'function'
          ? saveManager.isEmptySaveData(parsedSave)
          : false;
      if (isEmptyImport) {
        const confirmTitle = _saveManagerText('确认导入空存档', 'Confirm Empty Save Import');
        const confirmText = _saveManagerText(
          '该存档没有有效内容。确认后将导入空存档。',
          'This save has no valid content. Confirm to import it as an empty save.'
        );
        // showConfirmModal 是 fire-and-forget；modal 自身阻挡背景交互，这里提前释放按钮即可
        releasedInModalBranch = true;
        releaseBtn();
        showConfirmModal(confirmTitle, confirmText, () => runImport(true));
        return;
      }

      await runImport(false);
    } finally {
      if (!releasedInModalBranch) releaseBtn();
    }
  };
  reader.readAsText(file);
  e.target.value = ''; // Reset for re-import
}

/**
 * 根据 worldCardId 获取世界卡名称（用于存档卡片展示）
 */
function _getWorldCardName(worldCardId) {
  const mgr = window.worldCardManager;
  const isEnglish = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  if (!mgr) return isEnglish ? 'Unknown World' : '未知世界';
  const normalized = String(worldCardId || '').trim();
  if (!normalized) {
    // 无 ID 时取激活卡名
    const activeCard = mgr.getActiveCard?.();
    return activeCard?.name || (isEnglish ? 'Unknown World' : '未知世界');
  }
  const card =
    typeof mgr.getLocalizedCard === 'function'
      ? mgr.getLocalizedCard(normalized)
      : mgr.get(normalized);
  return card ? card.name : isEnglish ? 'Deleted World' : '已删除的世界';
}

window.setupSaveManagerUI = setupSaveManagerUI;
window.openSaveManager = openSaveManager;
window.closeSaveManager = closeSaveManager;
window.renderSaveSlots = renderSaveSlots;
