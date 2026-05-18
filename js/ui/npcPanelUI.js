// ============================================
// NPC Panel UI - 左侧 NPC 角色面板 UI
// ============================================
// 纯 UI 模块，负责渲染和事件处理
// 数据存储和业务逻辑由 npcStore 负责

const npcPanelUI = {
  // ==========================================
  // Tab 状态（v1：全局单变量，所有 NPC 卡共享当前 tab；刷新页面回到默认）
  // ==========================================
  _activeTab: 'profile', // 'profile' | 'state'

  _applyTabToCard(cardWrapper) {
    if (!cardWrapper) return;
    cardWrapper.dataset.activeTab = this._activeTab;
    const buttons = cardWrapper.querySelectorAll('.npc-card-tab[data-tab-target]');
    buttons.forEach(btn => {
      const isActive = btn.dataset.tabTarget === this._activeTab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  },

  _applyTabToAllCards() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;
    container.querySelectorAll('.npc-card-wrapper').forEach(w => this._applyTabToCard(w));
  },

  setActiveTab(tab) {
    if (tab !== 'profile' && tab !== 'state') return;
    if (this._activeTab === tab) return;
    this._activeTab = tab;
    this._applyTabToAllCards();
  },

  // 翻面卡的 ResizeObserver（按 wrapper 存，避免重复挂）
  _flipRO: typeof WeakMap !== 'undefined' ? new WeakMap() : null,

  /**
   * 翻面时按当前面内容自适应卡高（平滑过渡）。
   * 关键：背面内容裹在 .npc-back-inner（自然高、不被 inset:0 约束），
   * 用它的 offsetHeight 当真高；并挂 ResizeObserver —— 字体/编辑/换行任何
   * 重排后自动校正高度，杜绝"一次性测量太早算少 → foot 被裁"。
   */
  _setFlipHeight(wrapper) {
    if (!wrapper) return;
    const flip = wrapper.querySelector('.npc-card-flip');
    if (!flip) return;
    const front = flip.querySelector('.npc-card-front');
    const back = flip.querySelector('.npc-card-back');
    if (!front || !back) return;
    const inner = back.querySelector('.npc-back-inner') || back;

    const measure = el => {
      // 子节点自然堆叠高（不受父定高压缩）+ 自身 padding，与 scrollHeight 取大
      let h = 0;
      for (const c of el.children) h += c.offsetHeight;
      const cs = getComputedStyle(el);
      h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      return Math.max(el.scrollHeight, h, 0);
    };

    const apply = () => {
      if (!flip.isConnected) return;
      const flipped = wrapper.classList.contains('is-flipped');
      // 背面：用不受约束的 inner 自然总高；正面在常规流里，scrollHeight 即真高
      const target = (flipped ? measure(inner) : front.scrollHeight) + 2;
      // 已是目标高就不写 —— 让高度稳定收敛，杜绝 RO 反复触发的 loop 警告
      const cur = parseFloat(flip.style.height);
      if (Number.isFinite(cur) && Math.abs(cur - target) <= 1) return;
      flip.style.height = `${target}px`;
    };

    const flipped = wrapper.classList.contains('is-flipped');

    // 移除上一次遗留的"收回后清高度"监听 —— 否则它会在下一次（翻到背面的）
    // 高度过渡结束时误触发，把背面高度清成正面高度（"翻面只显示一半"根因）
    if (flip._npcHeightClear) {
      flip.removeEventListener('transitionend', flip._npcHeightClear);
      flip._npcHeightClear = null;
    }

    // ResizeObserver：翻到背面时持续盯 inner，任何重排（字体/编辑/内容）后自动校正。
    // 回调里的 DOM 写延到下一帧（rAF），把写操作移出 RO 投递周期，
    // 否则同步改高会让浏览器报 "ResizeObserver loop completed..."。
    if (this._flipRO && typeof ResizeObserver !== 'undefined') {
      let ro = this._flipRO.get(wrapper);
      if (ro) ro.disconnect();
      if (flipped) {
        let roPending = false;
        ro = new ResizeObserver(() => {
          if (roPending) return;
          roPending = true;
          requestAnimationFrame(() => {
            roPending = false;
            if (wrapper.classList.contains('is-flipped')) apply();
          });
        });
        ro.observe(inner);
        this._flipRO.set(wrapper, ro);
      }
    }

    // 双 rAF 先量一次（动画起点），ResizeObserver 随后兜底校正
    requestAnimationFrame(() => requestAnimationFrame(() => {
      apply();
      if (!flipped) {
        const onEnd = ev => {
          if (ev.target !== flip || ev.propertyName !== 'height') return;
          flip.removeEventListener('transitionend', onEnd);
          if (flip._npcHeightClear === onEnd) flip._npcHeightClear = null;
          // 关键：过渡结束时若已被翻回背面，绝不清高度（清了背面就塌成正面高）
          if (wrapper.classList.contains('is-flipped')) return;
          flip.style.height = '';
        };
        flip._npcHeightClear = onEnd;
        flip.addEventListener('transitionend', onEnd);
      }
    }));
  },

  /**
   * 局部刷新某 NPC 卡的「动态」pane（state 字段变更时调用，避免整卡重建）
   */
  refreshStatePane(npcId) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;
    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;
    const npcData = npcStore.get(npcId);
    if (!npcData) return;
    // v3 卡：局部刷新正面状态区，保留翻面态、不重建整卡
    const front = cardWrapper.querySelector('.npc-front-state');
    if (front) {
      front.innerHTML = npcCardRenderer._renderFrontState(npcData);
      return;
    }
    // 兼容旧版（如有残留）
    const pane = cardWrapper.querySelector('.npc-tab-pane[data-tab="state"]');
    if (!pane) return;
    pane.innerHTML = npcCardRenderer._renderStatePane(npcData);
  },

  // ==========================================
  // 工具方法
  // ==========================================

  /**
   * 转义 HTML 属性值 - 防止 XSS 攻击
   */
  escapeAttr(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  _formatPendingValue(value) {
    return value === null || value === undefined || value === '' ? '(空)' : String(value);
  },

  _getPendingHeaderText(pendingInfo) {
    const changes = pendingInfo?.changes || {};
    const turns = [
      ...new Set(
        Object.values(changes)
          .map(change => Number(change?.turn))
          .filter(turn => Number.isFinite(turn) && turn > 0)
      ),
    ].sort((a, b) => a - b);

    if (turns.length === 1) {
      return `AI 请求更新 (T${turns[0]})`;
    }
    if (turns.length > 1) {
      return 'AI 请求更新 (多轮更新)';
    }
    return 'AI 请求更新';
  },

  _getCardBadgeState(npcId) {
    const container = document.getElementById('npc-card-container');
    if (!container) return null;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    const badge = cardWrapper?.querySelector('.npc-badge');
    if (!badge) return null;

    const badgeType =
      ['new', 'update', 'approved', 'restore'].find(type => badge.classList.contains(type)) ||
      'new';
    const turnMatch = badge.textContent?.match(/T(\d+)/);

    return {
      badgeType,
      turn: turnMatch ? Number(turnMatch[1]) : 0,
      uid: badge.dataset.uid || null,
    };
  },

  refreshCard(npcId, options = {}) {
    const npcData = npcStore.get(npcId);
    if (!npcData) return;

    const currentBadge = this._getCardBadgeState(npcId);
    const badgeType = options.badgeType || currentBadge?.badgeType || 'new';
    const turn = options.turn ?? currentBadge?.turn ?? npcData._lastTurn ?? 0;
    const uid = options.uid ?? currentBadge?.uid ?? npcData._lastUID ?? null;
    const pendingInfo = npcStore.getPending(npcId);

    this.renderCard(npcId, npcData, turn, uid, false, badgeType, !!options.insertAtEnd);
    if (pendingInfo) {
      this.showPendingUI(npcId, pendingInfo);
    }
  },

  // ==========================================
  // 渲染方法
  // ==========================================

  /**
   * 渲染单个 NPC 卡片
   * @param {string} npcId - NPC ID
   * @param {Object} npcData - NPC 数据
   * @param {number} turn - 轮次
   * @param {string} uid - UID
   * @param {boolean} isUpdate - 是否为更新
   * @param {string} badgeType - 徽章类型 ('new', 'update', 'approved', 'restore')
   * @param {boolean} insertAtEnd - 是否插入到末尾（用于恢复时保持顺序）
   */
  renderCard(
    npcId,
    npcData,
    turn = 0,
    uid = null,
    _isUpdate = false,
    badgeType = 'new',
    insertAtEnd = false
  ) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    // 清除空状态提示
    const emptyMsg = container.querySelector('.npc-empty');
    if (emptyMsg) emptyMsg.remove();

    // 确保主角卡在顶部（幂等；首个 NPC 登场时一并带出主角）
    this._ensureProtagonist(container);

    // 生成卡片 HTML
    let cardHtml = npcCardRenderer.render(npcData);

    // 添加徽章
    const uidAttr = uid ? ` data-uid="${this.escapeAttr(uid)}"` : '';
    const badgeLabels = {
      new: 'NEW',
      update: 'UPDATE',
      approved: 'APPROVED',
      restore: 'RESTORE',
    };
    const badgeLabel = badgeLabels[badgeType] || 'NEW';
    const badgeHtml = `<span class="npc-badge ${badgeType}"${uidAttr}>${badgeLabel}: T${turn}</span>`;

    cardHtml = cardHtml.replace(
      '<div class="npc-card-header">',
      '<div class="npc-card-header">' + badgeHtml
    );

    const safeId = this.escapeAttr(npcId);
    const existingCard = container.querySelector(`[data-npc-id="${safeId}"]`);
    const isSelected = npcStore.isSelected(npcId);

    if (existingCard) {
      // 更新现有卡片
      existingCard.outerHTML = `<div class="npc-card-wrapper${isSelected ? '' : ' unselected'}" data-npc-id="${safeId}" draggable="true">${cardHtml}</div>`;

      // 更新选中按键状态
      if (!isSelected) {
        const updatedCard = container.querySelector(`[data-npc-id="${safeId}"]`);
        const selectBtn = updatedCard?.querySelector('[data-action~="npc-select-btn"]');
        if (selectBtn) {
          selectBtn.classList.remove('selected');
          selectBtn.textContent = '⬜';
          selectBtn.title = '未选中 - 点击选中';
        }
      }
    } else {
      // 添加新卡片
      const wrapper = document.createElement('div');
      wrapper.className = `npc-card-wrapper${isSelected ? '' : ' unselected'}`;
      wrapper.dataset.npcId = npcId;
      wrapper.draggable = true;
      wrapper.innerHTML = cardHtml;

      // insertAtEnd 用于恢复时保持顺序，否则插入到顶部（但永远在主角卡之下）
      if (insertAtEnd) {
        container.appendChild(wrapper);
      } else {
        const firstNpc = container.querySelector(
          '.npc-card-wrapper:not(.npc-protagonist)'
        );
        const anchor =
          container.querySelector('.npc-protagonist')?.nextSibling || container.firstChild;
        container.insertBefore(wrapper, firstNpc || anchor);
      }

      // 如果未选中，更新按键状态（npcCardRenderer 默认是选中状态）
      if (!isSelected) {
        const selectBtn = wrapper.querySelector('[data-action~="npc-select-btn"]');
        if (selectBtn) {
          selectBtn.classList.remove('selected');
          selectBtn.textContent = '⬜';
          selectBtn.title = '未选中 - 点击选中';
        }
      }
    }

    // 应用当前 active tab（profile / state）到这张卡
    const finalWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (finalWrapper) this._applyTabToCard(finalWrapper);
  },

  /**
   * 移除卡片
   * @param {string} npcId - NPC ID
   * @param {boolean} animate - 是否动画
   */
  removeCard(npcId, animate = true) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;

    if (animate) {
      cardWrapper.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      cardWrapper.style.opacity = '0';
      cardWrapper.style.transform = 'scale(0.9)';

      setTimeout(() => {
        cardWrapper.remove();
        this._checkEmpty(container);
      }, 300);
    } else {
      cardWrapper.remove();
      this._checkEmpty(container);
    }
  },

  /**
   * 显示待审批 UI
   * @param {string} npcId - NPC ID
   * @param {Object} pendingInfo - 待审批信息
   */
  showPendingUI(npcId, pendingInfo) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;

    // 移除已有的待审批 UI
    const existingUI = cardWrapper.querySelector('.npc-pending-update');
    if (existingUI) existingUI.remove();

    if (!pendingInfo || !pendingInfo.changes) {
      cardWrapper.classList.remove('has-pending-update');
      return;
    }

    const pendingFields = Object.keys(pendingInfo.changes);
    if (pendingFields.length === 0) {
      cardWrapper.classList.remove('has-pending-update');
      return;
    }

    // 生成变更列表 HTML
    let changesHtml = '';
    for (const field of pendingFields) {
      const change = pendingInfo.changes[field];
      const oldVal = this._formatPendingValue(change.old);
      const newVal = this._formatPendingValue(change.new);
      const safeField = this.escapeAttr(field);
      changesHtml += `<div class="pending-change-item" data-field="${safeField}">
                <div class="pending-change-info">
                    <span class="pending-field">${safeField}:</span>
                    <span class="pending-old">${this.escapeAttr(oldVal)}</span>
                    <span class="pending-arrow">-></span>
                    <span class="pending-new">${this.escapeAttr(newVal)}</span>
                </div>
                <div class="pending-field-actions">
                    <button class="btn-ghost btn-icon btn-sm" data-action="approve-pending-field" data-npc-id="${safeId}" data-field="${safeField}" title="接受此项"><span class="material-symbols-outlined">check</span></button>
                    <button class="btn-danger btn-icon btn-sm" data-action="reject-pending-field" data-npc-id="${safeId}" data-field="${safeField}" title="拒绝此项"><span class="material-symbols-outlined">close</span></button>
                </div>
            </div>`;
    }

    // 创建待审批 UI
    const pendingUI = document.createElement('div');
    pendingUI.className = 'npc-pending-update';
    pendingUI.innerHTML = `
            <div class="pending-header">
                <span class="pending-icon">⚠️</span>
                <span class="pending-title">${this._getPendingHeaderText(pendingInfo)}</span>
                <span class="pending-count">${pendingFields.length} 项待审</span>
            </div>
            <div class="pending-changes">${changesHtml}</div>
        `;

    cardWrapper.appendChild(pendingUI);
    cardWrapper.classList.add('has-pending-update');
    // 有待审批：自动翻到背面（审批字段多在身份层），审批 diff 段已接在卡下方
    cardWrapper.classList.add('is-flipped');
    this._setFlipHeight(cardWrapper);
  },

  /**
   * 移除待审批 UI
   * @param {string} npcId - NPC ID
   */
  removePendingUI(npcId) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (cardWrapper) {
      const pendingUI = cardWrapper.querySelector('.npc-pending-update');
      if (pendingUI) pendingUI.remove();
      cardWrapper.classList.remove('has-pending-update');
    }
  },

  /**
   * 更新卡片选中状态样式
   * @param {string} npcId - NPC ID
   * @param {boolean} selected - 是否选中
   */
  updateCardSelection(npcId, selected) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;

    cardWrapper.classList.toggle('unselected', !selected);

    const selectBtn = cardWrapper.querySelector('[data-action~="npc-select-btn"]');
    if (selectBtn) {
      selectBtn.classList.toggle('selected', selected);
      const emoji = selected ? '✅' : '⬜';
      // v3 卡按钮带文字标签；旧内联卡保持纯 emoji
      if (selectBtn.classList.contains('npc-back-btn')) {
        const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
        const label = selected ? (isEn ? 'Selected' : '选中') : (isEn ? 'Select' : '选择');
        selectBtn.textContent = `${emoji} ${label}`;
      } else {
        selectBtn.textContent = emoji;
      }
      selectBtn.title = selected ? '已选中 - 点击取消' : '未选中 - 点击选中';
    }
  },

  /**
   * 清空面板 UI
   */
  clearUI() {
    const container = document.getElementById('npc-card-container');
    if (container) {
      const emptyText = window.i18nService?.t?.('sidebar.npcEmpty') || '暂无角色信息';
      container.innerHTML = `<div class="npc-empty">${emptyText}</div>`;
    }
  },

  /**
   * 确保主角传说卡置于列表顶部（幂等）。无主角数据则跳过。
   */
  _ensureProtagonist(container) {
    container = container || document.getElementById('npc-card-container');
    if (!container) return;
    if (container.querySelector('.npc-protagonist')) return;

    let hero = null;
    try {
      hero = npcStore.getProtagonist?.();
    } catch (_) {
      hero = null;
    }
    if (!hero || !hero.card) return;

    let cardHtml;
    try {
      cardHtml = npcCardRenderer.render({ card: hero.card, state: hero.state }, { isHero: true });
    } catch (_) {
      return;
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'npc-card-wrapper npc-protagonist';
    wrapper.innerHTML = cardHtml;

    const emptyMsg = container.querySelector('.npc-empty');
    if (emptyMsg) emptyMsg.remove();
    container.insertBefore(wrapper, container.firstChild);
  },

  /**
   * 从存档恢复 UI (根据 store 数据重新渲染)
   */
  restoreUI() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    container.innerHTML = '';
    this._ensureProtagonist(container);

    const order = npcStore.getOrder();
    if (order.length === 0) {
      if (!container.querySelector('.npc-card-wrapper')) {
        const emptyText = window.i18nService?.t?.('sidebar.npcEmpty') || '暂无角色信息';
        container.innerHTML = `<div class="npc-empty">${emptyText}</div>`;
      }
      return;
    }

    for (const npcId of order) {
      const npcData = npcStore.get(npcId);
      if (!npcData) continue;

      const turn = npcData._lastTurn || 0;
      const uid = npcData._lastUID || null;

      // insertAtEnd=true 保持存档中的顺序
      this.renderCard(npcId, npcData, turn, uid, false, 'restore', true);
    }
  },

  /**
   * 检查是否为空并显示提示
   */
  _checkEmpty(container) {
    if (!container.querySelector('.npc-card-wrapper')) {
      const emptyText = window.i18nService?.t?.('sidebar.npcEmpty') || '暂无角色信息';
      container.innerHTML = `<div class="npc-empty">${emptyText}</div>`;
    }
  },

  /**
   * 从 DOM 更新排序到 store
   */
  _updateOrderFromDOM() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const cards = container.querySelectorAll('.npc-card-wrapper');
    const newOrder = Array.from(cards)
      .map(card => card.dataset.npcId)
      .filter(id => id);
    npcStore.reorder(newOrder);
  },

  // ==========================================
  // 初始化
  // ==========================================

  /**
   * 初始化 - 绑定事件和订阅 store
   */
  init() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    // ========================================
    // 通过 EventBus 订阅 NPC 事件
    // ========================================

    eventBus.on(GameEvents.NPC_ADDED, ({ npcId, data, turn, uid, isUpdate }) => {
      this.renderCard(npcId, data, turn, uid, isUpdate, isUpdate ? 'update' : 'new');
    });

    eventBus.on(GameEvents.NPC_DELETED, ({ npcId, npcName }) => {
      this.removeCard(npcId, true);
      if (npcName && typeof showToast === 'function') {
        showToast(`已删除角色: ${npcName}`);
      }
    });

    eventBus.on(GameEvents.NPC_PENDING, ({ npcId, pendingInfo }) => {
      this.showPendingUI(npcId, pendingInfo);
    });

    eventBus.on(GameEvents.NPC_PENDING_CLEARED, ({ npcId }) => {
      this.removePendingUI(npcId);
    });

    eventBus.on(GameEvents.NPC_APPROVED, ({ npcId, turn, uid }) => {
      if (npcStore.get(npcId)) {
        this.refreshCard(npcId, { badgeType: 'approved', turn, uid });
      }
    });

    eventBus.on(GameEvents.NPC_SELECTED, ({ npcId, selected }) => {
      this.updateCardSelection(npcId, selected);
    });

    eventBus.on(GameEvents.NPC_CLEARED, () => {
      this.clearUI();
    });

    eventBus.on(GameEvents.NPC_RESTORED, () => {
      this.restoreUI();
    });

    // state 层更新（NPC reaction 落地）：只刷该 NPC 卡的「动态」pane，不重建整卡
    if (GameEvents.NPC_STATE_UPDATED) {
      eventBus.on(GameEvents.NPC_STATE_UPDATED, ({ npcId }) => {
        this.refreshStatePane(npcId);
      });
    }

    // Tab 切换（事件委托）：点击任一卡上的 tab，所有卡同步切换（旧版兼容，v3 卡无 tab）
    container.addEventListener('click', e => {
      const tabBtn = e.target.closest('.npc-card-tab[data-tab-target]');
      if (!tabBtn) return;
      const target = tabBtn.dataset.tabTarget;
      this.setActiveTab(target);
    });

    // v3 卡：点击翻面（排除可编辑/按钮/审批段/折叠 details）
    container.addEventListener('click', e => {
      if (e.target.closest('button, [data-action], a, summary, details, .npc-pending-update')) {
        return;
      }
      const wrapper = e.target.closest('.npc-card-wrapper');
      if (!wrapper || !wrapper.querySelector('.npc-card--v3')) return;
      // 编辑态：卡片锁定在反面，点任何非按钮处都不翻
      if (wrapper.classList.contains('is-editing')) return;
      // 非编辑态：点任意处（含字段文字）都翻面
      wrapper.classList.toggle('is-flipped');
      this._setFlipHeight(wrapper);
    });

    // ========================================
    // 事件委托: 编辑/保存 切换（仅 v3 卡背面）
    // ========================================

    container.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-action~="npc-edit-toggle"]');
      if (!editBtn) return;

      const cardWrapper = editBtn.closest('.npc-card-wrapper');
      if (!cardWrapper) return;

      const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
      const fields = cardWrapper.querySelectorAll('.npc-card-back .npc-editable');

      if (cardWrapper.classList.contains('is-editing')) {
        // 保存：先提交当前聚焦字段（focusout 先于本 click 已触发提交），再退出编辑态
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        cardWrapper.classList.remove('is-editing');
        fields.forEach(el => el.setAttribute('contenteditable', 'false'));
        editBtn.classList.remove('is-saving');
        editBtn.textContent = `✎ ${isEn ? 'Edit' : '编辑'}`;
        editBtn.title = isEn ? 'Edit' : '编辑';
      } else {
        cardWrapper.classList.add('is-editing');
        fields.forEach(el => el.setAttribute('contenteditable', 'true'));
        editBtn.classList.add('is-saving');
        editBtn.textContent = `✓ ${isEn ? 'Save' : '保存'}`; // ui-lint-allow: 编辑保存按钮装饰勾
        editBtn.title = isEn ? 'Save' : '保存';
        if (fields[0]) fields[0].focus();
      }
    });

    // ========================================
    // 事件委托: 删除按键
    // ========================================

    container.addEventListener('click', e => {
      const deleteBtn = e.target.closest('[data-action~="npc-btn-danger"]');
      if (!deleteBtn) return;

      const cardWrapper = deleteBtn.closest('.npc-card-wrapper');
      if (!cardWrapper) return;
      const npcId = cardWrapper.dataset.npcId;
      if (!npcId) return;

      const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
      const npcData = npcStore.get(npcId);
      const npcName = npcData?.card?.name || npcData?.name || npcId;
      const doDelete = () => npcStore.delete(npcId);

      if (typeof window.showConfirmModal === 'function') {
        const title = isEn ? 'Delete character' : '删除角色';
        const desc = isEn
          ? `Delete “${npcName}”? This action cannot be undone.`
          : `确定删除「${npcName}」？此操作不可撤销。`;
        window.showConfirmModal(title, desc, doDelete, null, {
          icon: '🗑️',
          confirmTone: 'danger',
          confirmLabel: isEn ? 'Delete' : '删除',
          cancelLabel: isEn ? 'Cancel' : '取消',
        });
      } else {
        doDelete();
      }
    });

    // ========================================
    // 事件委托: 选中按键
    // ========================================

    container.addEventListener('click', e => {
      const selectBtn = e.target.closest('[data-action~="npc-select-btn"]');
      if (!selectBtn) return;

      const cardWrapper = selectBtn.closest('.npc-card-wrapper');
      if (cardWrapper) {
        const npcId = cardWrapper.dataset.npcId;
        if (npcId) {
          npcStore.toggleSelected(npcId);
        }
      }
    });

    // ========================================
    // 事件委托: 可编辑字段
    // ========================================

    container.addEventListener('focusout', e => {
      const editableField = e.target;
      if (!editableField || !editableField.classList.contains('npc-editable')) return;

      const cardWrapper = editableField.closest('.npc-card-wrapper');
      if (!cardWrapper) return;

      const npcId = cardWrapper.dataset.npcId;
      const fieldName = editableField.dataset.field;
      let newValue = editableField.textContent.trim();

      // 处理 cognitive_state 前缀
      if (fieldName === 'cognitive_state') {
        newValue = newValue.replace(/^⚜\s*/, '');
      }

      // 校验统一由 npcStore.updateField() 处理（integer / enum）

      // 更新到 store
      if (npcId && fieldName) {
        const updated = npcStore.updateField(npcId, fieldName, newValue);
        if (!updated) {
          // 校验失败：恢复旧值到 DOM + toast 提示
          const restoreValue = npcStore.getFieldValue(npcId, fieldName);
          editableField.textContent = restoreValue == null ? '' : String(restoreValue);
          const npcFields = window.worldMeta?.getStep3Fields?.()?.panel_npc;
          const fieldDef = Array.isArray(npcFields) && npcFields.find(f => f.key === fieldName);
          if (typeof showToast === 'function') {
            showToast(`${fieldDef?.label || fieldName} 输入无效`);
          }
          return;
        }

        // 编辑成功：回写规范化后的值（如 "001" → "1"）
        const savedValue = npcStore.getFieldValue(npcId, fieldName);
        const displayValue = savedValue == null ? '' : String(savedValue);
        if (editableField.textContent !== displayValue) {
          editableField.textContent = displayValue;
        }

        if (fieldName === 'birthday' || fieldName === 'cognitive_state') {
          this.refreshCard(npcId);
        } else {
          // 更新宽度类名（CSS Grid 自动重排相邻字段）
          const itemEl = editableField.closest('.npc-item');
          if (itemEl) {
            const label = npcCardRenderer._getFieldLabel(fieldName);
            const widthClass = npcCardRenderer.getFieldWidthClass(label, displayValue);
            itemEl.classList.remove('half', 'full');
            itemEl.classList.add(widthClass);
          }
        }
      }
    });

    // 防止回车换行
    container.addEventListener('keydown', e => {
      const editableField = e.target;
      if (!editableField || !editableField.classList.contains('npc-editable')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        editableField.blur();
      }
    });

    // ========================================
    // 事件委托: 审批按键
    // ========================================

    container.addEventListener('click', e => {
      // 单字段批准
      const fieldApproveBtn = e.target.closest('[data-action="approve-pending-field"]');
      if (fieldApproveBtn) {
        const npcId = fieldApproveBtn.dataset.npcId;
        const field = fieldApproveBtn.dataset.field;
        if (npcId && field) {
          npcStore.approveField(npcId, field);
        }
        return;
      }

      // 单字段拒绝
      const fieldRejectBtn = e.target.closest('[data-action="reject-pending-field"]');
      if (fieldRejectBtn) {
        const npcId = fieldRejectBtn.dataset.npcId;
        const field = fieldRejectBtn.dataset.field;
        if (npcId && field) {
          npcStore.rejectField(npcId, field);
        }
        return;
      }
    });

    // ========================================
    // 拖拽排序
    // ========================================

    this._initDragAndDrop(container);
  },

  /**
   * 初始化拖拽排序
   */
  _initDragAndDrop(container) {
    let draggedItem = null;
    let placeholder = null;

    const createPlaceholder = () => {
      const el = document.createElement('div');
      el.className = 'npc-card-placeholder';
      return el;
    };

    container.addEventListener('dragstart', e => {
      const cardWrapper = e.target.closest('.npc-card-wrapper');
      if (!cardWrapper) return;

      if (e.target.closest('.npc-editable') || e.target.closest('button')) {
        e.preventDefault();
        return;
      }

      draggedItem = cardWrapper;
      draggedItem.classList.add('dragging');

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cardWrapper.dataset.npcId);

      setTimeout(() => {
        if (draggedItem) {
          draggedItem.style.opacity = '0.5';
        }
      }, 0);
    });

    container.addEventListener('dragend', () => {
      if (!draggedItem) return;

      draggedItem.classList.remove('dragging');
      draggedItem.style.opacity = '';

      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }
      placeholder = null;

      // 更新排序到 store
      this._updateOrderFromDOM();

      draggedItem = null;
    });

    container.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (!draggedItem) return;

      // 拖拽期间若后端推送 NPC 变更触发 refreshCard/outerHTML 替换，或玩家的
      // draggedItem 被删除，原 DOM 节点会脱离 container。继续 insertBefore 会
      // 导致 "Cannot read properties of null" 或把 placeholder 插到孤儿节点旁。
      // 这里统一校验：draggedItem / placeholder / afterElement 必须仍是 container
      // 的直接子节点，否则放弃本次操作并清掉过期引用。
      if (draggedItem.parentNode !== container) {
        draggedItem = null;
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;
        return;
      }

      // 若 placeholder 被外部（如 refreshCard 重绘）从 DOM 摘除，重置引用
      if (placeholder && placeholder.parentNode !== container) {
        placeholder = null;
      }

      const afterElement = this._getDragAfterElement(container, e.clientY);

      const ensurePlaceholder = () => {
        if (!placeholder) {
          placeholder = createPlaceholder();
          placeholder.style.height = `${draggedItem.offsetHeight}px`;
        }
        return placeholder;
      };

      if (afterElement === null || afterElement === undefined) {
        if (
          container.lastElementChild !== placeholder &&
          container.lastElementChild !== draggedItem
        ) {
          container.appendChild(ensurePlaceholder());
        }
      } else if (
        afterElement !== draggedItem &&
        afterElement !== placeholder &&
        afterElement.parentNode === container
      ) {
        container.insertBefore(ensurePlaceholder(), afterElement);
      }
    });

    container.addEventListener('drop', e => {
      e.preventDefault();

      if (!draggedItem || !placeholder) return;

      // 同步校验 placeholder 仍挂在 container 上（异步刷新可能摘除）
      if (placeholder.parentNode === container && draggedItem.parentNode) {
        placeholder.parentNode.insertBefore(draggedItem, placeholder);
        placeholder.parentNode.removeChild(placeholder);
      }
      placeholder = null;
    });

    container.addEventListener('dragleave', e => {
      if (e.target === container && !container.contains(e.relatedTarget)) {
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
          placeholder = null;
        }
      }
    });
  },

  /**
   * 获取拖拽后插入位置
   */
  _getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.npc-card-wrapper:not(.dragging)')];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  },
};

// 暴露到全局
window.npcPanelUI = npcPanelUI;

// 页面加载后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => npcPanelUI.init());
} else {
  queueMicrotask(() => npcPanelUI.init());
}
