// ============================================
// World Card UI - 世界卡管理界面（左栏）
// ============================================
// 集成在存档管理面板左栏，提供世界卡的浏览/切换/导出/删除/导入

'use strict';

// ————— 内部状态 —————
let _pendingDeleteCardId = null;
let _worldCardCompactMediaBound = false;
let _worldCardCompactPreviewId = null;
const _DESIGN_DRAFT_CARD_ID = '__design_draft__';

function _worldCardUiText(zh, en) {
  return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? en : zh;
}

function _worldCardUiBilingualText(zh, en) {
  if (typeof window.i18nService?.formatBilingualText === 'function') {
    return window.i18nService.formatBilingualText(zh, en);
  }
  // 单语回退：i18nService 未就绪时也只显示当前语言（不再拼括号双显）
  return _worldCardUiText(zh, en);
}

// 格式徽章（内部设计文档 · 卡名前缀「v1」/「v2」）
// V1 灰色 = 老卡仅供游玩；V2 彩色 = 当前主格式（未来 V3 / V4 同样走彩色 modifier）。
// 草稿 / 未知格式不显示徽章。
function _buildSchemaVersionBadge(version) {
  if (typeof version !== 'number' || version < 1) return '';
  const modifier = version === 1 ? 'v1' : 'vCurrent';
  return `<span class="wc-version-badge wc-version-badge--${modifier}" aria-label="schema version ${version}">「v${version}」</span>`;
}

// V1 老卡警告 modal（内部设计文档 · D4 / D2）
// 用于：编辑入口 / 存档行编辑入口 / 导入入口 检测到 V1 卡时统一弹一个提示。
// 文案：红字「仅提供剧情游玩」+ 单按钮「我知道了」。
function _showV1CardWarningModal(onDismiss) {
  const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  const title = isEn ? 'Legacy v1 World Card' : 'V1 格式世界卡';
  const phraseRed = isEn ? 'playback only' : '仅提供剧情游玩';

  // 拼 descriptionHtml：红字突出「仅提供剧情游玩」（沿用 .confirm-irreversible-line 类视觉风格）
  let html;
  if (isEn) {
    html =
      'This world card is a legacy v1 format — ' +
      `<span style="color: var(--status-danger); font-weight: bold;">${_escapeHtml(phraseRed)}</span> ` /* ui-lint-allow: V1 卡警告红字，复用 _renderIrreversibleHtml token */ +
      'is supported. Editing in design mode is no longer available for this card.' +
      '<br><br>' +
      'Note: world cards created on or after 2026-06-01 are v2 or newer and have full support.';
  } else {
    html =
      '检测到该世界卡为 V1 格式世界卡，' +
      `<span style="color: var(--status-danger); font-weight: bold;">${_escapeHtml(phraseRed)}</span>` /* ui-lint-allow: V1 卡警告红字，复用 _renderIrreversibleHtml token */ +
      '支持，不再支持导回设计模式进行二次编辑。' +
      '<br><br>' +
      '注：2026 年 06 月 01 日之后创建的世界卡均为 V2 格式或更新，可提供完整支持。';
  }

  if (typeof showConfirmModal === 'function') {
    showConfirmModal(title, '', () => {
      if (typeof onDismiss === 'function') onDismiss();
    }, undefined, {
      icon: 'lock',
      descriptionHtml: html,
      hideCancel: true,
      confirmLabel: isEn ? 'Got it' : '我知道了',
    });
  } else {
    // 极端兜底：showConfirmModal 未就绪时纯文本 alert
    alert(isEn
      ? 'Legacy v1 world card — playback only, design editing is not supported.'
      : '旧格式世界卡，仅提供剧情游玩，不再支持设计模式编辑。');
    if (typeof onDismiss === 'function') onDismiss();
  }
}

function _setWorldCardHeaderIndicator(text = '') {
  const indicator = document.getElementById('world-card-position-indicator');
  if (!indicator) return;
  indicator.textContent = String(text || '').trim();
}

function _isCompactWorldCardLayout() {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(max-width: 900px)').matches;
  }
  return window.innerWidth <= 900;
}

function _getSaveManagerPreviewWorldCardId(fallbackId = null) {
  return (
    (typeof window.getSaveManagerPanelWorldId === 'function'
      ? window.getSaveManagerPanelWorldId()
      : fallbackId) || fallbackId
  );
}

function _getSaveManagerLockedWorldCardId() {
  return null;
}

function _hasMeaningfulDraftP1State(p1State) {
  if (!p1State || typeof p1State !== 'object') return false;
  if (Number.isFinite(p1State.round) && p1State.round > 0) return true;
  if (typeof p1State.mode === 'string' && p1State.mode.trim()) return true;
  if (typeof p1State.style === 'string' && p1State.style.trim()) return true;
  const evidence = p1State.dimensionEvidence;
  if (!evidence || typeof evidence !== 'object') return false;
  return Object.values(evidence).some(entry => {
    if (!entry || typeof entry !== 'object') return false;
    if (Number.isFinite(entry.rounds) && entry.rounds > 0) return true;
    return Array.isArray(entry.snippets) && entry.snippets.length > 0;
  });
}

function _hasMeaningfulDraftHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  return history.some((msg, index) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.sender === 'user') return true;
    if (msg.frameworkReady || msg.isError) return true;
    if (msg.p1FlowState || Array.isArray(msg.p1Questions)) return true;
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    return index > 0 && text.length > 0;
  });
}

function _getDesignDraft() {
  if (typeof window.getStoredDesignDraftSnapshot === 'function') {
    const snapshot = window.getStoredDesignDraftSnapshot();
    return snapshot?.exists ? snapshot.meta : null;
  }
  try {
    const metaStr = localStorage.getItem('design_mode_meta');
    const configStr = localStorage.getItem('design_mode_config');
    if (!metaStr || !configStr) return null;

    const meta = JSON.parse(metaStr);
    const config = JSON.parse(configStr);
    const history = JSON.parse(localStorage.getItem('design_mode_chat_history') || '[]');
    const hasConfigContent =
      !!config && typeof config === 'object' && !Array.isArray(config) && Object.keys(config).length > 0;
    const hasProgress =
      meta?.hasDraft === true ||
      (meta?.hasDraft !== false &&
        (meta?.p1Output ||
          (Number.isFinite(meta?.p2Stage) && meta.p2Stage > 0) ||
          hasConfigContent ||
          _hasMeaningfulDraftP1State(meta?.p1State) ||
          _hasMeaningfulDraftHistory(history)));

    if (!hasProgress) return null;
    if (meta?.phase === 'done' && meta?.hasDraft !== true) return null;

    return {
      ...meta,
      _isDraft: true,
      id: _DESIGN_DRAFT_CARD_ID,
    };
  } catch (e) {
    console.warn('[WorldCardUI] 读取设计草稿失败:', e);
    return null;
  }
}

function _getDraftPhaseLabel(meta) {
  const phase = meta?.phase || 'p1';
  if (phase === 'p1') {
    const round = Math.max(1, Number.parseInt(meta?.p1State?.round, 10) || 1);
    return _worldCardUiText(`P1 · 对话第${round}轮`, `P1 · Round ${round}`);
  }
  if (phase === 'p2') {
    const stage = Math.max(0, Number.parseInt(meta?.p2Stage, 10) || 0);
    return _worldCardUiText(`P2 · ${stage}/4`, `P2 · ${stage}/4`);
  }
  if (phase === 'p3' || phase === 'done') {
    return _worldCardUiText('P3 · 待重设计', 'P3 · Pending Rewrite');
  }
  return 'P1';
}

function _formatTimeAgo(timestamp) {
  const savedAt = Number(timestamp);
  if (!Number.isFinite(savedAt) || savedAt <= 0) return '';
  const diff = Date.now() - savedAt;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return _worldCardUiText('刚刚', 'Just now');
  if (mins < 60) return _worldCardUiText(`${mins}分钟前`, `${mins}m ago`);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return _worldCardUiText(`${hours}小时前`, `${hours}h ago`);
  const days = Math.floor(hours / 24);
  return _worldCardUiText(`${days}天前`, `${days}d ago`);
}

function _createDraftCardElement(meta) {
  const phaseLabel = _getDraftPhaseLabel(meta);
  const timeAgo = _formatTimeAgo(meta?.savedAt);

  const el = document.createElement('div');
  el.className = 'btn-secondary btn-wide is-draft';
  el.dataset.cardId = _DESIGN_DRAFT_CARD_ID;
  el.innerHTML = `
        <div class="wc-header">
            <span class="wc-name">${_worldCardUiText('世界卡草稿', 'World Card Draft')}</span>
            <div class="wc-actions">
                <button class="btn-danger btn-icon btn-sm" data-action="wc-draft-discard-btn" title="${_worldCardUiText('丢弃草稿', 'Discard Draft')}" type="button">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>
        </div>
        <div class="wc-badges">
            <span class="wc-draft-badge">
                <span class="material-symbols-outlined">edit_note</span>
                ${_worldCardUiText('设计草稿', 'Draft')}
            </span>
            <span class="wc-draft-phase">${_escapeHtml(phaseLabel)}</span>
            ${timeAgo ? `<span class="wc-draft-time">${_escapeHtml(timeAgo)}</span>` : ''}
        </div>
        <div class="wc-desc">${_worldCardUiText('点击继续设计', 'Click to continue designing')}</div>
    `;
  return el;
}

function _getRenderableWorldCards(cards, compactLayout = false, draftMeta = null) {
  const renderableCards = Array.isArray(cards) ? [...cards] : [];
  if (draftMeta) {
    renderableCards.unshift({
      id: _DESIGN_DRAFT_CARD_ID,
      _isDraft: true,
      _draftMeta: draftMeta,
    });
  }
  return renderableCards;
}

function _updateWorldCardHeaderIndicator(renderableCards, { previewId, compactLayout }) {
  if (!compactLayout || !Array.isArray(renderableCards) || renderableCards.length === 0) {
    _setWorldCardHeaderIndicator('');
    return;
  }

  const resolvedPreviewId = String(previewId || '').trim();
  const rawIndex = renderableCards.findIndex(card => card.id === resolvedPreviewId);
  const currentIndex = rawIndex >= 0 ? rawIndex : 0;
  _setWorldCardHeaderIndicator(`${currentIndex + 1}/${renderableCards.length}`);
}

function _getWorldCardMarkup(card, { isActive = false, isPreview = false } = {}) {
  const isEnglish = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  const activeBadge = isActive
    ? `<span class="wc-active-badge">
                 <span class="material-symbols-outlined">check_circle</span>
                 ${_worldCardUiBilingualText('当前', 'Current')}
               </span>`
    : '';
  const previewBadge = isPreview
    ? `<span class="wc-preview-badge">
                 <span class="material-symbols-outlined">visibility</span>
                 ${_worldCardUiBilingualText('预览', 'Preview')}
               </span>`
    : '';

  // V1 老卡的编辑按钮灰显（内部设计文档 · D2 编辑边界）
  // V1 卡兼容承诺 = 「可以继续玩，但不能再编辑」，所以编辑按钮 disabled + 提示文案。
  const isV1Card = typeof card.schemaVersion === 'number' && card.schemaVersion < 2;
  const editBtnTitle = isV1Card
    ? (isEnglish ? 'Legacy card — playback only' : '旧格式世界卡，仅提供剧情游玩')
    : (isEnglish ? 'Edit in Design Mode' : '在设计模式中编辑');
  const editBtnAttrs = isV1Card
    ? `class="btn-secondary btn-icon btn-sm is-disabled" data-action="wc-edit-design-btn" data-id="${card.id}" data-v1-locked="1" title="${editBtnTitle}" type="button" aria-disabled="true"`
    : `class="btn-secondary btn-icon btn-sm" data-action="wc-edit-design-btn" data-id="${card.id}" title="${editBtnTitle}" type="button"`;

  const actionsHtml =
    card.isBuiltIn === true
      ? ''
      : `<div class="wc-actions">
                <button ${editBtnAttrs}>
                    <span class="material-symbols-outlined">edit_note</span>
                </button>
                <button class="btn-secondary btn-icon btn-sm" data-id="${card.id}" data-wc-action="export" title="${isEnglish ? 'Export' : '导出'}" type="button">
                    <span class="material-symbols-outlined">download</span>
                </button>
                <button class="btn-danger btn-icon btn-sm" data-id="${card.id}" data-wc-action="delete" title="${isEnglish ? 'Delete' : '删除'}" type="button">
                    <span class="material-symbols-outlined">delete</span>
                </button>
            </div>`;

  const versionBadge = _buildSchemaVersionBadge(card.schemaVersion);

  return `
        <div class="wc-header">
            <span class="wc-name">${versionBadge}${_escapeHtml(card.name)}</span>
            ${actionsHtml}
        </div>
        <div class="wc-badges">
            ${activeBadge}
            ${previewBadge}
        </div>
        <div class="wc-desc">${_escapeHtml(card.description || '')}</div>
    `;
}

function _createWorldCardElement(card, { activeId, previewId }) {
  if (card?._isDraft || card?.id === _DESIGN_DRAFT_CARD_ID) {
    return _createDraftCardElement(card?._draftMeta || card);
  }

  const isActive = card.id === activeId;
  const isPreview = previewId !== activeId && card.id === previewId;

  const el = document.createElement('div');
  el.className =
    `btn-secondary btn-wide ${isActive ? 'is-active' : ''} ${isPreview ? 'is-preview' : ''}`.trim();
  el.dataset.cardId = card.id;
  el.innerHTML = _getWorldCardMarkup(card, { isActive, isPreview });
  return el;
}

function _renderCompactWorldCards(container, renderableCards, { activeId, previewId }) {
  const currentIndex = Math.max(
    0,
    renderableCards.findIndex(card => card.id === previewId)
  );
  const currentCard = renderableCards[currentIndex] || renderableCards[0];
  if (!currentCard) return;

  const showNav = renderableCards.length > 1;
  const wrapper = document.createElement('div');
  wrapper.className = `world-card-carousel ${showNav ? 'has-nav' : 'is-static'}`;

  if (showNav) {
    const prevBtn = document.createElement('button');
    prevBtn.className = 'btn-ghost btn-icon';
    prevBtn.type = 'button';
    prevBtn.dataset.wcNav = 'prev';
    prevBtn.dataset.direction = '-1';
    prevBtn.title = _worldCardUiText('上一个世界卡', 'Previous World Card');
    prevBtn.disabled = currentIndex === 0;
    prevBtn.innerHTML = '<span class="material-symbols-outlined">chevron_left</span>';
    wrapper.appendChild(prevBtn);
  }

  const cardHost = document.createElement('div');
  cardHost.className = 'btn-secondary btn-wide';
  cardHost.appendChild(_createWorldCardElement(currentCard, { activeId, previewId }));
  wrapper.appendChild(cardHost);

  if (showNav) {
    const nextBtn = document.createElement('button');
    nextBtn.className = 'btn-ghost btn-icon';
    nextBtn.type = 'button';
    nextBtn.dataset.wcNav = 'next';
    nextBtn.dataset.direction = '1';
    nextBtn.title = _worldCardUiText('下一个世界卡', 'Next World Card');
    nextBtn.disabled = currentIndex === renderableCards.length - 1;
    nextBtn.innerHTML = '<span class="material-symbols-outlined">chevron_right</span>';
    wrapper.appendChild(nextBtn);
  }

  container.appendChild(wrapper);
}

function _getCompactWorldCardPreviewId(renderableCards, activeId, draftMeta = null) {
  if (!Array.isArray(renderableCards) || renderableCards.length === 0) return null;

  if (
    _worldCardCompactPreviewId &&
    renderableCards.some(card => card.id === _worldCardCompactPreviewId)
  ) {
    return _worldCardCompactPreviewId;
  }
  _worldCardCompactPreviewId = null;

  if (draftMeta) {
    return _DESIGN_DRAFT_CARD_ID;
  }

  const previewId = _getSaveManagerPreviewWorldCardId(activeId);
  if (renderableCards.some(card => card.id === previewId)) {
    return previewId;
  }
  return renderableCards[0]?.id || null;
}

function _bindWorldCardEvents(container) {
  container.querySelectorAll('[data-card-id]').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.cardId === _DESIGN_DRAFT_CARD_ID) {
        _handleResumeDraft();
        return;
      }
      _handlePreview(item.dataset.cardId);
    });
  });
  container.querySelectorAll('[data-action~="wc-draft-discard-btn"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _handleDiscardDraft();
    });
  });
  container.querySelectorAll('[data-wc-action="export"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _handleExport(btn.dataset.id);
    });
  });
  container.querySelectorAll('[data-wc-action="delete"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _handleDeleteRequest(btn.dataset.id);
    });
  });
  container.querySelectorAll('[data-action~="wc-edit-design-btn"]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      // V1 灰显按钮 → 弹统一警告（不进 _handleEditInDesignMode）
      if (btn.dataset.v1Locked === '1') {
        _showV1CardWarningModal();
        return;
      }
      _handleEditInDesignMode(btn.dataset.id);
    });
  });
  container.querySelectorAll('[data-wc-nav]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      _handleCompactWorldCardStep(Number(btn.dataset.direction || '0'));
    });
  });
}

function _handleCompactWorldCardStep(direction) {
  if (!direction || !window.worldCardManager) return;

  const draftMeta = _getDesignDraft();
  const cards = _getRenderableWorldCards(window.worldCardManager.list(), true, draftMeta);
  if (cards.length <= 1) return;

  const activeId = window.worldCardManager.getActiveCardId();
  const previewId = _getCompactWorldCardPreviewId(cards, activeId, draftMeta);
  const currentIndex = Math.max(
    0,
    cards.findIndex(card => card.id === previewId)
  );
  const nextIndex = Math.min(cards.length - 1, Math.max(0, currentIndex + direction));
  if (nextIndex === currentIndex) return;

  const targetCard = cards[nextIndex];
  if (!targetCard) return;

  _worldCardCompactPreviewId = targetCard.id;
  if (targetCard.id === _DESIGN_DRAFT_CARD_ID) {
    renderWorldCards();
    return;
  }

  if (typeof window.setSaveManagerPanelWorldId === 'function') {
    window.setSaveManagerPanelWorldId(targetCard.id, { clearSelected: true, render: true });
    return;
  }

  _handlePreview(targetCard.id);
}

function _bindWorldCardCompactMedia() {
  if (
    _worldCardCompactMediaBound ||
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return;
  }

  const mediaQuery = window.matchMedia('(max-width: 900px)');
  const rerender = () => {
    // saves 现在是 stage 而非 modal——saves stage 激活时才有意义重渲世界卡列表
    if (window.stageRouter?.getState?.()?.stage !== 'saves') return;
    renderWorldCards();
  };

  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', rerender);
  } else if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(rerender);
  }

  _worldCardCompactMediaBound = true;
}

// ————— 初始化 —————

function setupWorldCardUI() {
  // 导入世界卡按键（v3.5 起 button 已从 saves stage 移除；保留 file input change 监听让
  // 任何程序化 .click() 触发的导入流程仍能工作）
  const importBtn = document.getElementById('import-world-card-btn');
  const importInput = document.getElementById('import-world-card-input');
  if (importInput) {
    importInput.addEventListener('change', _handleImportFile);
  }
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
  }

  _bindWorldCardCompactMedia();
}

// ————— 渲染 —————

function renderWorldCards() {
  const container = document.getElementById('world-card-list');
  if (!container || !window.worldCardManager) {
    _setWorldCardHeaderIndicator('');
    return;
  }

  const cards = window.worldCardManager.list();
  const draftMeta = _getDesignDraft();
  const activeId = window.worldCardManager.getActiveCardId();
  const compactLayout = _isCompactWorldCardLayout();
  const renderableCards = _getRenderableWorldCards(cards, compactLayout, draftMeta);
  const previewId = compactLayout
    ? _getCompactWorldCardPreviewId(renderableCards, activeId, draftMeta)
    : _getSaveManagerPreviewWorldCardId(activeId);

  container.innerHTML = '';
  container.classList.toggle('wc-compact-mode', compactLayout);
  if (!compactLayout) {
    _worldCardCompactPreviewId = null;
  }
  _updateWorldCardHeaderIndicator(renderableCards, { previewId, compactLayout });

  // 空状态
  if (renderableCards.length === 0) {
    container.innerHTML = `<div class="wc-empty-state">
            <p class="wc-empty-hint">${_worldCardUiText('尚无世界卡', 'No world cards yet')}</p>
            <p class="wc-empty-sub">${_worldCardUiText('请导入世界卡文件，或点击上方「新建世界」开始设计', 'Import a world card, or click "New World" above to start designing one')}</p>
        </div>`;
    return;
  }

  if (compactLayout) {
    _renderCompactWorldCards(container, renderableCards, { activeId, previewId });
  } else {
    renderableCards.forEach(card => {
      container.appendChild(_createWorldCardElement(card, { activeId, previewId }));
    });
  }

  // 绑定事件：点击卡片本身只预览，不立即切换
  _bindWorldCardEvents(container);
}

function _handleResumeDraft() {
  if (typeof closeSaveManager === 'function') {
    closeSaveManager();
  }

  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    if (typeof initDesignService === 'function') initDesignService();
    if (typeof chatHistory !== 'undefined' && typeof designChatHistory !== 'undefined') {
      chatHistory = designChatHistory;
    }
    if (typeof refreshChatUI === 'function') refreshChatUI({ scrollMode: 'bottom' });
    if (window.worldCardInfoUI) window.worldCardInfoUI.refresh();
  } else {
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle && !modeToggle.classList.contains('design-mode')) {
      modeToggle.click();
    }
  }

  // DEFAULT_STAGE.design 是 'saves'，从 saves stage 触发后需要显式落到 'design' stage
  // 才能让用户看到设计聊天/P1 表单。对齐 _doLoadCardIntoDesignMode 的模式。
  if (typeof window.stageRouter?.setStage === 'function') {
    window.stageRouter.setStage('design');
  }
}

function _handleDiscardDraft() {
  const title = _worldCardUiText('丢弃设计草稿', 'Discard Design Draft');
  const message = _worldCardUiText(
    '确定丢弃此设计草稿？此操作不可撤销。',
    'Discard this design draft? This cannot be undone.'
  );

  const discard = () => {
    // resetDesignConfig 内部已经做完整重置：
    //   - 清 designChatHistory（in-place length=0，保持 array 身份/别名）
    //   - 设计模式下 push P1 引导问候语 + 直接 append chat DOM
    //   - 设计模式下 updateExecuteButtonState('p1')
    //   - _updatePreviewPanel
    // 所以这里只要：(1) 调它 (2) 清 localStorage (3) 刷新两个 stage 列表 + 侧栏。
    // 不能再做 `designChatHistory = []` —— 那会创建新数组、破坏别名、并把刚 push 的
    // greeting 丢掉，导致设计模式 chat 区一片空白（线上 bug 现场）。
    if (window.designService && typeof window.designService.resetDesignConfig === 'function') {
      window.designService.resetDesignConfig();
    }
    if (typeof window.clearStoredDesignDraft === 'function') {
      window.clearStoredDesignDraft();
    } else {
      localStorage.removeItem('design_mode_config');
      localStorage.removeItem('design_mode_meta');
      localStorage.removeItem('design_mode_chat_history');
      localStorage.removeItem('design_mode_pzwc_residual'); // PZWC 建造残卡与草稿同生命周期
    }
    // 侧栏世界卡信息面板（design mode 用，game mode 下也存在但隐藏）——强制刷新让它清空
    if (window.worldCardInfoUI && typeof window.worldCardInfoUI.refresh === 'function') {
      window.worldCardInfoUI.refresh();
    }
    renderWorldCards();
    if (typeof window.renderSaveSlots === 'function') window.renderSaveSlots();
  };

  showConfirmModal(title, message, discard, null, {
    icon: 'delete',
    confirmTone: 'danger',
  });
}

function _handlePreview(id) {
  const mgr = window.worldCardManager;
  if (!mgr) return;

  const card = mgr.get(id);
  if (!card) {
    showToast(_worldCardUiText('世界卡不存在', 'World card not found.'));
    return;
  }

  if (typeof window.setSaveManagerPanelWorldId === 'function') {
    window.setSaveManagerPanelWorldId(id, { clearSelected: true, render: true });
    return;
  }
}

// ————— 处理器 —————

/**
 * 切换激活世界卡
 */
async function _handleActivate(id) {
  if (typeof isSending !== 'undefined' && isSending) {
    showToast(
      _worldCardUiText(
        '请等待回复完成后再切换世界',
        'Wait for the current reply before switching worlds.'
      )
    );
    return;
  }

  const mgr = window.worldCardManager;
  if (!mgr) return;

  const card = mgr.get(id);
  if (!card) {
    showToast(_worldCardUiText('世界卡不存在', 'World card not found.'));
    return;
  }

  await _doActivate(id, card.name);
}

function _syncWorldPanelsAfterActivate() {
  if (typeof window.syncSaveManagerPanelWorldIdWithActiveWorld === 'function') {
    window.syncSaveManagerPanelWorldIdWithActiveWorld({ clearSelected: true });
  }
  renderWorldCards();
  if (typeof renderSaveSlots === 'function') renderSaveSlots();
}

function _doActivateInDesignMode(id, cardName) {
  const mgr = window.worldCardManager;
  const result = mgr.setActiveCard(id);

  if (!result || !result.ok) {
    const reason = result?.reason || '未知错误';
    if (typeof showToast === 'function')
      showToast(_worldCardUiText(`切换失败：${reason}`, `Switch failed: ${reason}`));
    return;
  }

  _syncWorldPanelsAfterActivate();

  // 清空 AI 缓存，防止上个世界的状态泄漏
  if (typeof clearAIServiceCaches === 'function') {
    clearAIServiceCaches();
  }

  // P2-A: 切换世界后清理时间线触发去重状态
  if (
    typeof timelineService !== 'undefined' &&
    typeof timelineService.clearTriggeredEvents === 'function'
  ) {
    timelineService.clearTriggeredEvents();
  }

  // 信息隔离不变式：激活 = 仅切换游玩激活卡，不把卡灌进设计会话（designConfig /
  // designChatHistory 原样保留——草稿继续是草稿，空会话继续是空）。要编辑卡走
  // 「编辑」入口 _doLoadCardIntoDesignMode（带草稿闸 + _editDraft）。
  // （历史上这里调 _restoreDesignServiceFromCard 把卡镜像进设计态，2026-06-12 拆除。）

  // 世界卡下切换世界后：刷新右栏信息 tile（显示草稿或空态）
  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    if (window.worldCardInfoUI && worldCardInfoUI.refresh) worldCardInfoUI.refresh();
  }

  // 沙盒下切换世界后：若历史为空则补种子消息，避免主界面空白
  if (
    typeof isDesignMode !== 'undefined' &&
    !isDesignMode &&
    Array.isArray(chatHistory) &&
    chatHistory.length === 0 &&
    typeof ensureGameModeSeedMessage === 'function'
  ) {
    const { needsApiKeyHint } = ensureGameModeSeedMessage();
    if (needsApiKeyHint) {
      const hasRenderedMessages = Boolean(
        document.querySelector('.chat-messages-area .chat-message')
      );
      if (
        !hasRenderedMessages &&
        typeof addMessage === 'function' &&
        typeof getMissingApiKeyHint === 'function'
      ) {
        addMessage(getMissingApiKeyHint(), 'AI', 'ai');
      }
    } else if (typeof refreshChatUI === 'function') {
      refreshChatUI({ scrollMode: 'bottom' });
    }
  }

  showToast(_worldCardUiText(`已切换到「${cardName}」`, `Switched to "${cardName}".`));
}

async function _doActivateInGameMode(id, cardName, options = {}) {
  const { skipAutoSaveGuard = false, successMessage = `已切换到「${cardName}」` } = options;

  const runStart = async () => {
    if (!window.sessionManager || typeof window.sessionManager.startNewGame !== 'function') {
      showToast(
        _worldCardUiText(
          '切换失败：sessionManager 不可用',
          'Switch failed: sessionManager unavailable.'
        )
      );
      return false;
    }

    const startResult = await window.sessionManager.startNewGame({
      worldCardId: id,
      silent: true,
    });
    if (!startResult || !startResult.ok) {
      showToast(
        _worldCardUiText(
          `切换失败：${startResult?.reason || '未知错误'}`,
          `Switch failed: ${startResult?.reason || 'Unknown error'}`
        )
      );
      return false;
    }

    _syncWorldPanelsAfterActivate();
    showToast(successMessage);
    return true;
  };

  if (skipAutoSaveGuard || typeof window.runTransitionAutoSaveGuard !== 'function') {
    return await runStart();
  }

  return await window.runTransitionAutoSaveGuard({
    lockSource: `world-card-switch:${id}`,
    onReady: runStart,
    failurePrefix: '切换世界失败',
  });
}

async function _doActivate(id, cardName, options = {}) {
  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    return _doActivateInDesignMode(id, cardName);
  }
  return await _doActivateInGameMode(id, cardName, options);
}

/**
 * 导出世界卡
 */
function _handleExport(id) {
  const mgr = window.worldCardManager;
  if (!mgr) {
    showToast(_worldCardUiText('导出失败：世界卡服务未就绪，请刷新后重试', 'Export failed: world card service not ready, please refresh and retry.'));
    return;
  }
  if (typeof mgr.isBuiltInCard === 'function' && mgr.isBuiltInCard(id)) {
    showToast(_worldCardUiText('内置世界卡不可导出', 'Built-in world cards cannot be exported.'));
    return;
  }
  const ok = mgr.exportCard(id) !== false;
  try {
    window.analyticsService?.track?.(
      ok ? 'feature.world_card_exported' : 'feature.world_card_export_failed',
      {
        card_id: id,
        source: 'world_card_list',
      }
    );
  } catch (_) { /* noop */ }
}

/**
 * 请求删除世界卡（弹出确认框）
 */
function _handleDeleteRequest(id) {
  const mgr = window.worldCardManager;
  if (!mgr) return;
  if (typeof mgr.isBuiltInCard === 'function' && mgr.isBuiltInCard(id)) {
    showToast(_worldCardUiText('内置世界卡不可删除', 'Built-in world cards cannot be deleted.'));
    return;
  }
  const card = mgr.list().find(c => c.id === id);
  if (!card) return;
  const isActive = mgr.getActiveCardId() === id;
  const isBound = currentSaveBindingWorldCardId === id;

  _pendingDeleteCardId = id;

  // 复用全局 delete-confirm-modal（saveManagerUI 也在用）
  const modal = document.getElementById('wc-delete-confirm-modal');
  if (modal) {
    const safeName = _escapeHtml(card.name);
    const warningParts = [
      _worldCardUiText(
        `确定要删除世界卡「${safeName}」吗？`,
        `Delete the world card "${safeName}"?`
      ),
      _worldCardUiText(
        '该世界下的全部存档也会被删除。',
        'All save files under this world will also be deleted.'
      ),
      isActive || isBound
        ? _worldCardUiText(
          '当前正在游玩的存档进度也会丢失。',
          'The progress of the currently active save will also be lost.'
        )
        : '',
    ].filter(Boolean);
    const irreversible = _worldCardUiText('此操作不可撤销。', 'This action cannot be undone.');
    modal.querySelector('#wc-delete-confirm-text').innerHTML =
      `${warningParts.join('')}<div class="confirm-irreversible-line">` +
      `<span style="color: var(--status-danger);">${irreversible}</span></div>`; // ui-lint-allow: 不可逆警告红字，token 化，复用 .confirm-irreversible-line
    modal.classList.remove('hidden');
  }
}

async function _confirmDeleteCard() {
  if (!_pendingDeleteCardId) return;
  const mgr = window.worldCardManager;
  if (mgr) {
    if (typeof mgr.isBuiltInCard === 'function' && mgr.isBuiltInCard(_pendingDeleteCardId)) {
      showToast(_worldCardUiText('内置世界卡不可删除', 'Built-in world cards cannot be deleted.'));
      _pendingDeleteCardId = null;
      document.getElementById('wc-delete-confirm-modal')?.classList.add('hidden');
      return;
    }
    const card = mgr.list().find(c => c.id === _pendingDeleteCardId);
    const wasActive = mgr.getActiveCardId() === _pendingDeleteCardId;
    const wasBound = currentSaveBindingWorldCardId === _pendingDeleteCardId;
    const designModeActive = typeof isDesignMode !== 'undefined' && isDesignMode;
    if (typeof saveManager !== 'undefined' && typeof saveManager.deleteAllForWorld === 'function') {
      // fire-and-forget：删除卡片后续逻辑不需要等待 IDB 写完
      saveManager.deleteAllForWorld(_pendingDeleteCardId).catch(err => {
        console.warn('[WorldCardUI] deleteAllForWorld 失败:', err);
      });
    }
    if (wasBound) {
      if (
        window.sessionManager &&
        typeof window.sessionManager.detachCurrentSaveBinding === 'function'
      ) {
        window.sessionManager.detachCurrentSaveBinding({ invalidateBaseline: true });
      } else {
        currentSaveBindingWorldCardId = null;
        currentSlotId = null;
      }
    }
    const deletedCardId = _pendingDeleteCardId;
    const deleted = mgr.delete(_pendingDeleteCardId);
    if (deleted === false) {
      _pendingDeleteCardId = null;
      document.getElementById('wc-delete-confirm-modal')?.classList.add('hidden');
      renderWorldCards();
      if (typeof renderSaveSlots === 'function') renderSaveSlots();
      return;
    }
    try {
      window.analyticsService?.track?.('feature.world_card_deleted', {
        card_id: deletedCardId,
        source: 'world_card_list',
      });
    } catch (_) { /* noop */ }
    if (wasActive) {
      const remaining = mgr.list();
      if (remaining.length > 0) {
        if (designModeActive) {
          _doActivateInDesignMode(remaining[0].id, remaining[0].name);
          showToast(
            _worldCardUiText(
              '世界卡已删除，已切换到其他世界',
              'World card deleted. Switched to another world.'
            )
          );
        } else {
          await _doActivateInGameMode(remaining[0].id, remaining[0].name, {
            skipAutoSaveGuard: true,
            successMessage: _worldCardUiText(
              '世界卡已删除，已切换到其他世界',
              'World card deleted. Switched to another world.'
            ),
          });
        }
      } else {
        if (
          !designModeActive &&
          window.sessionManager &&
          typeof window.sessionManager.resetSessionState === 'function'
        ) {
          window.sessionManager.resetSessionState({ silent: true, seedGameGreeting: false });
        }
        showToast(
          _worldCardUiText(
            '世界卡已删除，请导入或创建新世界卡',
            'World card deleted. Import or create a new world card.'
          )
        );
      }
    } else if (card) {
      const suffix = wasBound
        ? _worldCardUiText(
          '，当前存档绑定已清除，请重新读取或新建存档',
          '. The current save binding was cleared. Load or create a save again.'
        )
        : '';
      showToast(
        _worldCardUiText(`已删除「${card.name}」${suffix}`, `Deleted "${card.name}"${suffix}`)
      );
    }
  }
  _pendingDeleteCardId = null;
  document.getElementById('wc-delete-confirm-modal')?.classList.add('hidden');
  renderWorldCards();
  // 同步刷新右栏存档（世界卡名可能变为『已删除的世界』）
  if (typeof renderSaveSlots === 'function') renderSaveSlots();
}

function _cancelDeleteCard() {
  _pendingDeleteCardId = null;
  document.getElementById('wc-delete-confirm-modal')?.classList.add('hidden');
}

/**
 * 将世界卡载入世界卡 P3 进行二次编辑
 */
function _handleEditInDesignMode(cardId) {
  const mgr = window.worldCardManager;
  if (!mgr) return;
  if (typeof mgr.isBuiltInCard === 'function' && mgr.isBuiltInCard(cardId)) {
    showToast(_worldCardUiText('内置世界卡不可编辑', 'Built-in world cards cannot be edited.'));
    return;
  }

  if (typeof initDesignService === 'function') initDesignService();
  const ds = window.designService;

  const card = mgr.get(cardId);
  if (!card) {
    showToast(_worldCardUiText('世界卡不存在', 'World card not found.'));
    return;
  }
  if (!card.snapshot || typeof card.snapshot !== 'object') {
    showToast(
      _worldCardUiText(
        '该世界卡没有有效数据，无法编辑',
        'This world card has no valid data and cannot be edited.'
      )
    );
    return;
  }
  const hasSubstantialCardContent =
    typeof mgr.hasSubstantialContent === 'function'
      ? mgr.hasSubstantialContent(card.snapshot)
      : mgr._hasSubstantialContent
        ? mgr._hasSubstantialContent(card.snapshot)
        : false;
  if (!hasSubstantialCardContent) {
    showToast(
      _worldCardUiText(
        '该世界卡内容为空，无法编辑',
        'This world card is empty and cannot be edited.'
      )
    );
    return;
  }

  // 卡级 V1 屏蔽（内部设计文档 · D2 编辑边界）
  // 用 isOriginallyV1 而不是 isV1：mgr.get(id) 返回的是已 migrate 的内存形态，
  // _schema_version 已被改写为 2；只有 _origin_schema_version === 1 才说明原盘卡是 V1。
  const cardSchemaUtil = window.cardSchemaVersion;
  if (cardSchemaUtil && cardSchemaUtil.isOriginallyV1(card)) {
    _showV1CardWarningModal();
    return;
  }

  // 注意：不再因「某个 entity 是 V1 markdown 字符串」就整张卡拒绝进入设计模式。
  // 卡片级 V1（上面的 isOriginallyV1，看 _origin_schema_version）才是「老卡只读」的真正边界。
  // 一张原生 V2 卡里若夹着个别字符串实体（历史遗留写入口的产物），审核 UI 会把它渲染成只读
  // 「锁定卡」（见 reviewAdapters.buildCardBody），玩家可删除后重建，不该因此锁死整张可编辑的 V2 卡。
  // 详 内部设计文档。

  // 检查当前世界卡是否有未完成的工作
  const hasStoredDraft =
    typeof window.hasStoredDesignDraft === 'function' && window.hasStoredDesignDraft();
  const hasCurrentDraft =
    ds && typeof ds.hasUnfinishedWork === 'function' && ds.hasUnfinishedWork();
  if (hasStoredDraft || hasCurrentDraft) {
    const title = _worldCardUiText('请先处理当前草稿', 'Finish Current Draft First');
    const text = _worldCardUiText(
      '当前已有一个未完成的世界卡草稿。请先完成或丢弃该草稿后，再编辑其他世界卡。',
      'There is already an unfinished world card draft. Finish or discard it before editing another world card.'
    );
    if (typeof showConfirmModal === 'function') {
      showConfirmModal(title, text, () => undefined);
    } else {
      showToast(text);
    }
    return;
  }
  _doLoadCardIntoDesignMode(card);
}

/**
 * 核心编排：将世界卡数据载入世界卡 P3
 */
function _doLoadCardIntoDesignMode(card) {
  // 0. API Key 前置检查——避免用户载入卡进入 P3 后才在第一次发消息时报错
  if (
    typeof aiService !== 'undefined' &&
    typeof aiService.getApiKeyForModule === 'function' &&
    !aiService.getApiKeyForModule('p1')
  ) {
    const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
    showToast(
      isEn
        ? 'World Cards requires an API key. Opening Settings…'
        : '世界卡需要先配置 API Key，已为你打开设置…'
    );
    if (typeof openSettings === 'function') openSettings('api');
    return;
  }

  // 1. 关闭存档管理面板
  if (typeof closeSaveManager === 'function') closeSaveManager();

  // 2. 确保 designService 已初始化
  if (typeof initDesignService === 'function') initDesignService();
  const ds = window.designService;
  if (!ds) {
    showToast(_worldCardUiText('设计服务未初始化', 'Design service is not ready.'));
    return;
  }

  // 3. 载入数据到 P3
  const result = ds.loadCardIntoDesignMode(card);
  if (!result.ok) {
    showToast(_worldCardUiText(`载入失败：${result.reason}`, `Load failed: ${result.reason}`));
    return;
  }
  // 只有“在世界卡中编辑”入口才允许后续覆盖该源卡
  ds._reimportSourceCardId = card.id || null;
  ds._allowOverwriteFromCardEdit = !!card.id;
  ds.forceCreateNewOnNextApply = !card.id;

  // 进入编辑即转「草稿态」：写 _editDraft 初值（仅当还没草稿，避免覆盖续编内容）。
  // presence 即草稿态 → 卡库随即显示「编辑中」、该卡「开新游戏」被挡（进行中存档不受影响）。
  // 不带 snapshot，故不会触发 worldCardManager 对 activeCard 的运行时热更新。
  if (card.id && !card._editDraft) {
    try { window.worldCardManager?.update(card.id, { _editDraft: card.snapshot }); } catch (_) { }
  }
  // 进编辑后刷新卡库，让侧栏 saves（双 pane）显示「编辑中」徽章 + 空槽锁住（bug3：进编辑路径
  // 此前漏了重渲，而放弃路径有；setStage('design') 的 stage:changed 不含 sideStage，saves 监听
  // 不会自动重渲，侧栏空槽会残留可点 → 走到迟到拒绝）。
  if (card.id && typeof renderSaveSlots === 'function') renderSaveSlots();

  // 4. 设置聊天历史
  //
  // 新设计（plan: P3 对话独立持久化）：
  //   - "从世界卡进入编辑" 直接跳 P3 编辑工作流，不走 P1/P2 创作 pipeline
  //   - card.designChatHistory（P1/P2 历史）**不再读回** —— 已成型世界卡跟创作期对话无关
  //   - card.p3ChatHistory 是 P3 chat 的真源，灌进模块级 p3ChatHistory 让 p3Service 能回填
  if (typeof designChatHistory !== 'undefined') {
    designChatHistory.length = 0; // 清空——世界卡入口不走 P1/P2
  }
  if (Array.isArray(window.p3ChatHistory)) {
    window.p3ChatHistory.length = 0;
    const cardP3 = Array.isArray(card.p3ChatHistory) ? card.p3ChatHistory : [];
    for (const m of cardP3) window.p3ChatHistory.push(m);
  }
  // 让 designService 直接跳 P3 phase（"从世界卡编辑"入口的语义就是精修，跳过 P1/P2）
  ds.phase = 'p3';
  // 通知 P3 服务：切到了新卡——清 in-memory chatHistory，下次 openPanel 从模块级
  // p3ChatHistory（刚灌的新卡内容）重新回填。如果是空白卡，bootstrap 会发开场建议。
  try {
    window.p3Service?.reloadFromCard?.();
    // 注意：P3 内容渲染（bootstrap）必须延后到 refreshChatUI / setStage 之后再调，见下方说明。
  } catch (e) {
    console.warn('[worldCardUI] P3 service reload failed:', e);
  }

  // 6. 切换到世界卡
  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    // 已在世界卡：重新绑定 chatHistory 引用并刷新 UI
    if (typeof chatHistory !== 'undefined' && typeof designChatHistory !== 'undefined') {
      chatHistory = designChatHistory;
    }
    if (typeof refreshChatUI === 'function') refreshChatUI({ scrollMode: 'bottom' });
    if (window.worldCardInfoUI) window.worldCardInfoUI.refresh();
  } else {
    // 从沙盒切换：模拟点击 tab-strip
    // 守卫与 _handleResumeDraft / launcher.activateDesignMode 对齐——避免在已经
    // 处于 design-mode class 但 isDesignMode==false 的 desync 场景下再切回去
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle && !modeToggle.classList.contains('design-mode')) modeToggle.click();
  }

  // 显式落到 design stage（DEFAULT_STAGE.design 是 saves，wc-edit 入口期望直接进编辑）
  if (typeof window.stageRouter?.setStage === 'function') {
    window.stageRouter.setStage('design');
  }

  // P3 渲染必须放在 refreshChatUI（innerHTML='' 重建主聊天区）+ 切 stage 之后——否则
  // bootstrap append 进 .chat-messages-area 的 P3 骨架/历史会被随后的 refreshChatUI 清掉，
  // 导致主聊天区空白（新 P3 渲染进共用的主聊天区，老 P3 用独立面板才不受影响 → P3 重写后的 regression）。
  // 空白卡 bootstrap 内发开场建议；非空卡 openPanel 回填历史（chatHistory.length 检查会跳过开场）。
  try {
    if (typeof window.p3Service?.bootstrap === 'function') {
      window.p3Service.bootstrap(card.snapshot);
    }
  } catch (e) {
    console.warn('[worldCardUI] P3 bootstrap failed:', e);
  }

  // 7. 提示
  showToast(
    _worldCardUiText(
      `已载入「${card.name || '世界卡'}」到设计模式`,
      `Loaded "${card.name || 'World Card'}" into Design Mode.`
    )
  );
}

/**
 * 导入世界卡（从文件）
 */
function _handleImportFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => {
    showToast(_worldCardUiText('文件读取失败，请重试', 'File read failed. Please try again.'));
  };
  reader.onload = ev => {
    const mgr = window.worldCardManager;
    if (!mgr) return;

    // 先解析 JSON 并校验
    let data;
    try {
      data = typeof ev.target.result === 'string' ? JSON.parse(ev.target.result) : ev.target.result;
    } catch (parseErr) {
      showToast(
        _worldCardUiText(
          'JSON 解析失败: ' + parseErr.message,
          'JSON parse failed: ' + parseErr.message
        )
      );
      return;
    }

    let preparedCard;
    try {
      preparedCard =
        typeof mgr.prepareImportedCard === 'function' ? mgr.prepareImportedCard(data) : null;
    } catch (importErr) {
      showToast(
        _worldCardUiText(
          '导入世界卡失败: ' + importErr.message,
          'World-card import failed: ' + importErr.message
        )
      );
      return;
    }
    if (!preparedCard) {
      showToast(
        _worldCardUiText(
          '导入世界卡失败: 文件结构无效',
          'World-card import failed: invalid file structure.'
        )
      );
      return;
    }

    // V1 老卡导入警告（内部设计文档 · D4）
    // 检测到 V1 卡 → 弹「仅提供剧情游玩」提示 → 玩家点确认后直接导入到列表（不走 choice modal——
    // 那个 modal 含"导入并编辑设计模式"选项，跟 V1 不可编辑的承诺冲突，会让玩家困惑）。
    const isImportingV1 = window.cardSchemaVersion && window.cardSchemaVersion.isOriginallyV1(preparedCard);
    if (isImportingV1) {
      _showV1CardWarningModal(() => _importPreparedToList(data, preparedCard, mgr, 'v1_warning'));
      return;
    }
    // UCID 去重闸：文件 ucid 命中库里某张卡 = "再导入同一张卡"。抢在 list/编辑器选择弹窗之前问，
    // 两条导入入口（列表导入 / 载入设计模式编辑）都被它接住；未命中才落原选择流程。
    const dedupeUcid =
      preparedCard && typeof preparedCard.ucid === 'string' && preparedCard.ucid.trim()
        ? preparedCard.ucid.trim()
        : null;
    const existingByUcid =
      dedupeUcid && typeof mgr.get === 'function' && !mgr.isBuiltInCard(dedupeUcid)
        ? mgr.get(dedupeUcid)
        : null;
    if (existingByUcid) {
      _showImportDedupeModal(existingByUcid, data, preparedCard, mgr);
      return;
    }
    _continueImportAfterV1Check(data, preparedCard, mgr);
  };

  // UCID 去重弹窗：文件与库里某张卡 UCID 相同 → 复用 reimport-apply-modal 的 import-dedupe 文案档
  //（_showReimportApplyModal 是 designService 私有方法，跨模块调）。更新=就地升级保 id；另存为=强制新铸。
  function _showImportDedupeModal(existingCard, data, preparedCard, mgr) {
    const onUpdate = () => {
      const result =
        typeof mgr.importPreparedCard === 'function'
          ? mgr.importPreparedCard(preparedCard) // → 升级同一张（保 id、不动 manifest）
          : mgr.importCard(data);
      if (!result) return;
      try {
        window.analyticsService?.track?.('feature.world_card_imported', {
          card_id: result.id,
          source: 'world_card_upgrade',
        });
      } catch (_) { /* noop */ }
      renderWorldCards();
      showToast(
        _worldCardUiText(`已更新世界卡「${result.name}」`, `Updated world card "${result.name}".`)
      );
    };
    const onCreateNew = () =>
      _importPreparedToList(data, preparedCard, mgr, 'world_card_list', { forceNew: true });
    const ds = window.designService;
    if (ds && typeof ds._showReimportApplyModal === 'function') {
      ds._showReimportApplyModal(existingCard.name || '', onUpdate, onCreateNew, {
        mode: 'import-dedupe',
      });
    } else {
      // 兜底：无弹窗能力 → 默认另存为新卡（绝不静默覆盖用户已有的卡）。
      onCreateNew();
    }
  }

  // 把"导入到世界卡列表"那条尾巴抽成独立函数：V1 警告 dismiss 后直接走这条，
  // 普通 V2 卡走 _continueImportAfterV1Check 内部 fallback / choice modal 的 list 分支也调它。
  function _importPreparedToList(data, preparedCard, mgr, trackingSource, options = {}) {
    const result =
      typeof mgr.importPreparedCard === 'function'
        ? mgr.importPreparedCard(preparedCard, options.forceNew ? { forceNew: true } : {})
        : mgr.importCard(data);
    if (!result) return;
    try {
      window.analyticsService?.track?.('feature.world_card_imported', {
        card_id: result.id,
        source: trackingSource || 'world_card_list',
      });
    } catch (_) { /* noop */ }
    renderWorldCards();
    if (typeof showConfirmModal === 'function') {
      showConfirmModal(
        _worldCardUiText('导入成功', 'Import Successful'),
        _worldCardUiText(
          `「${result.name}」已导入。是否立即切换到此世界？`,
          `"${result.name}" was imported. Switch to this world now?`
        ),
        () => _handleActivate(result.id)
      );
    } else {
      showToast(
        _worldCardUiText(
          `已导入世界卡「${result.name}」`,
          `Imported world card "${result.name}".`
        )
      );
    }
  }

  // 把导入流程的"选择导入方式 + 落地"段抽出来，便于 V1 警告 modal 用 dismiss 回调串接。
  function _continueImportAfterV1Check(data, preparedCard, mgr) {
    // 弹出导入方式选择
    const choiceModal = document.getElementById('reimport-choice-modal');
    const listBtn = document.getElementById('reimport-choice-list-btn');
    const designBtn = document.getElementById('reimport-choice-design-btn');

    if (!choiceModal || !listBtn || !designBtn) {
      // fallback：无弹窗 DOM，走原有导入流程
      const result =
        typeof mgr.importPreparedCard === 'function'
          ? mgr.importPreparedCard(preparedCard)
          : mgr.importCard(data);
      if (result) {
        try {
          window.analyticsService?.track?.('feature.world_card_imported', {
            card_id: result.id,
            source: 'fallback',
          });
        } catch (_) { /* noop */ }
        renderWorldCards();
        if (typeof showConfirmModal === 'function') {
          showConfirmModal(
            _worldCardUiText('导入成功', 'Import Successful'),
            _worldCardUiText(
              `「${result.name}」已导入。是否立即切换到此世界？`,
              `"${result.name}" was imported. Switch to this world now?`
            ),
            () => _handleActivate(result.id)
          );
        } else {
          showToast(
            _worldCardUiText(
              `已导入世界卡「${result.name}」`,
              `Imported world card "${result.name}".`
            )
          );
        }
      }
      return;
    }

    choiceModal.classList.remove('hidden');

    // 清理旧监听器
    const newListBtn = listBtn.cloneNode(true);
    listBtn.parentNode.replaceChild(newListBtn, listBtn);
    const newDesignBtn = designBtn.cloneNode(true);
    designBtn.parentNode.replaceChild(newDesignBtn, designBtn);

    const closeChoice = () => choiceModal.classList.add('hidden');

    // 导入到世界卡列表
    newListBtn.addEventListener('click', () => {
      closeChoice();
      const result =
        typeof mgr.importPreparedCard === 'function'
          ? mgr.importPreparedCard(preparedCard)
          : mgr.importCard(data);
      if (result) {
        try {
          window.analyticsService?.track?.('feature.world_card_imported', {
            card_id: result.id,
            source: 'world_card_list',
          });
        } catch (_) { /* noop */ }
        renderWorldCards();
        if (typeof showConfirmModal === 'function') {
          showConfirmModal(
            _worldCardUiText('导入成功', 'Import Successful'),
            _worldCardUiText(
              `「${result.name}」已导入。是否立即切换到此世界？`,
              `"${result.name}" was imported. Switch to this world now?`
            ),
            () => _handleActivate(result.id)
          );
        } else {
          showToast(
            _worldCardUiText(
              `已导入世界卡「${result.name}」`,
              `Imported world card "${result.name}".`
            )
          );
        }
      }
    });

    // 载入到世界卡编辑
    newDesignBtn.addEventListener('click', () => {
      closeChoice();
      const tempCard = {
        id: null,
        name: preparedCard.name || '导入的世界',
        description: preparedCard.description || '',
        snapshot: preparedCard.snapshot,
        designChatHistory: Array.isArray(preparedCard.designChatHistory)
          ? preparedCard.designChatHistory
          : [],
        designMeta: preparedCard.designMeta || null,
        isBuiltIn: false,
      };
      _doLoadCardIntoDesignMode(tempCard);
    });
  };
  reader.readAsText(file);
  // 清空 input，允许重复导入同一文件
  e.target.value = '';
}

// ————— 工具函数 —————

function _escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

window.setupWorldCardUI = setupWorldCardUI;
// 放弃编辑（删除草稿）：只丢弃未应用的编辑改动 + P3 对话，世界卡本身保留、回正式态可玩。
// 入口=卡库草稿态卡的「放弃编辑」按钮（saveManagerUI 的 discard-edit → window._handleWorldCardDiscardEdit）。
function _handleDiscardCardEditRequest(id) {
  const mgr = window.worldCardManager;
  if (!mgr || !id) return;
  const card = typeof mgr.get === 'function' ? mgr.get(id) : null;
  const refresh = () => {
    renderWorldCards();
    if (typeof renderSaveSlots === 'function') renderSaveSlots();
  };
  if (!card || !card._editDraft) {
    refresh(); // 没有未应用编辑，无需放弃
    return;
  }
  const safeName = card.name || _worldCardUiText('该世界卡', 'this world card');
  const title = _worldCardUiText('放弃编辑？', 'Discard edits?');
  const desc = _worldCardUiText(
    `将丢弃「${safeName}」未应用的编辑改动，世界卡本身保留、回到上次已应用的版本。此操作不可撤销。`,
    `Discard the unsaved edits to "${safeName}". The world card itself is kept and reverts to the last applied version. This cannot be undone.`
  );
  const doDiscard = () => {
    try { mgr.update(id, { _editDraft: null, p3ChatHistory: [] }); } catch (_) { }
    // 若正处于编辑这张卡的设计模式：清 P3 内存 + **回滚 designConfig/标志/预览面板**，并切回卡库。
    // 否则内存 designConfig 仍是废稿——回设计页点「应用到游戏」会拿废稿默默新建一张卡（bug2）。
    try {
      const ds = window.designService;
      if (ds && ds._reimportSourceCardId === id) {
        window.p3Service?.resetForApply?.();      // 清 P3 对话/内存/UI
        ds.resetDesignConfig?.();                  // 清 designConfig + 会话标志 + 预览面板（含 _reimportSourceCardId 复位）
        try { window.stageRouter?.setStage?.('saves'); } catch (_) { } // 切回卡库，别停在已清空的设计页看废稿
      }
    } catch (_) { /* defensive */ }
    refresh();
    if (typeof showToast === 'function') showToast(_worldCardUiText('已放弃未应用的编辑', 'Unsaved edits discarded.'));
  };
  if (typeof window.showConfirmModal === 'function') {
    window.showConfirmModal(title, desc, doDiscard, null, {
      icon: 'cancel',
      confirmTone: 'danger',
      confirmLabel: _worldCardUiText('放弃编辑', 'Discard'),
    });
  } else {
    doDiscard();
  }
}
window._handleWorldCardDiscardEdit = _handleDiscardCardEditRequest;

window.renderWorldCards = renderWorldCards;
window._confirmDeleteCard = _confirmDeleteCard;
window._cancelDeleteCard = _cancelDeleteCard;
// 给 saves stage accordion head 的 wc-action 按钮复用（外部调用入口）
window._handleWorldCardExport = _handleExport;
window._handleWorldCardDelete = _handleDeleteRequest;
window._handleWorldCardEditInDesign = _handleEditInDesignMode;
// 给 saves stage 草稿行的"继续编辑 / 删除"按钮复用
window._handleResumeDraft = _handleResumeDraft;
window._handleDiscardDraft = _handleDiscardDraft;
