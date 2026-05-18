// js/ui/characterPanelUI.js
// 主角 sidebar tile: 物品栏（active items + 待审批 + 曾持有 tombstone）
// 数据源：window.inventoryStore；通过 EventBus INVENTORY_* 事件刷新

(function () {
  'use strict';

  const TILE_ID = 'character-tile';
  const LIST_ID = 'character-list';

  function isEnglish() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  }

  function getCopy() {
    const en = isEnglish();
    return {
      pendingApproveAll: en ? 'Approve all' : '全接受',
      pendingRejectAll: en ? 'Reject all' : '全拒绝',
      pendingSummary: n => (en ? `${n} pending` : `${n} 项待审`),
      tombstoneTitle: n => (en ? `Previously held (${n})` : `曾持有 (${n})`),
      inventoryEmpty: en ? 'Inventory is empty' : '背包是空的',
      activeEmpty: en ? 'Nothing on you right now' : '身上暂无物品',
      cardApprove: en ? 'Approve' : '批准',
      cardConsume: en ? 'Consume' : '消耗',
      cardDiscard: en ? 'Discard' : '丢弃',
      pendingDelta: delta => {
        const sign = delta >= 0 ? '+' : '';
        return `${sign}${delta}`;
      },
      iconChangeHint: name => (en ? `Change icon for ${name}` : `换图标：${name}`),
    };
  }

  function resolveItemGlyph(item) {
    const api = window.ItemGlyphs;
    if (api?.resolveItemGlyph) return api.resolveItemGlyph(item);
    return 'inventory_2';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ────── 渲染 ──────

  // 跨 render 保留每张卡片是否处于"展开 desc"状态
  const _expandedNames = new Set();

  function renderActiveCard(item, copy, pendingForName) {
    // 常态化显示——任何 count 值都直接渲染，包括 1 / 0.1 / -1 / 壹 / "1/2" 等
    const rawCount = item.count == null ? '' : String(item.count);
    const countHtml = `<span class="character-inv-count">×${escapeHtml(rawCount)}</span>`; /* ui-lint-allow: 物品计数乘号 */

    const desc = item.desc || '';
    const expanded = _expandedNames.has(item.name);
    const descHtml = desc
      ? `<p class="character-inv-desc"${expanded ? '' : ' data-clamped="true"'}>${escapeHtml(desc)}</p>`
      : '';

    const pending = pendingForName || null;
    const deltaHtml = pending
      ? `<span class="character-inv-pending-delta">${escapeHtml(copy.pendingDelta(pending.delta))}</span>`
      : '';
    const approveBtnHtml = pending
      ? `<button class="btn-primary character-inv-action-btn character-inv-action-btn--pending" data-action="item-approve" data-pending-id="${escapeHtml(pending.id)}">${escapeHtml(copy.cardApprove)}</button>`
      : '';
    const consumeDiscardDisabled = pending ? ' disabled aria-disabled="true"' : '';

    const glyph = resolveItemGlyph(item);
    const iconTitle = escapeHtml(copy.iconChangeHint(item.name));

    return `
      <li class="character-inv-card"
          data-item-name="${escapeHtml(item.name)}"
          data-has-pending="${pending ? '1' : '0'}"
          data-expanded="${expanded ? '1' : '0'}">
        <!-- Row 1: 操作条 -->
        <div class="character-inv-card-actionbar">
          ${countHtml}
          <span class="character-inv-actionbar-mid">
            ${deltaHtml}
            ${approveBtnHtml}
          </span>
          <span class="character-inv-actionbar-right">
            <button class="btn-primary character-inv-action-btn" data-action="item-consume"${consumeDiscardDisabled}>${escapeHtml(copy.cardConsume)}</button>
            <button class="btn-primary character-inv-action-btn" data-action="item-discard"${consumeDiscardDisabled}>${escapeHtml(copy.cardDiscard)}</button>
          </span>
        </div>
        <!-- Row 2: icon + name 焦点行 -->
        <div class="character-inv-card-focus">
          <button class="character-inv-icon" data-action="item-icon-pick" title="${iconTitle}" aria-label="${iconTitle}">
            <span class="character-inv-item-glyph">${escapeHtml(glyph)}</span>
          </button>
          <span class="character-inv-name" data-action="card-toggle">${escapeHtml(item.name)}</span>
        </div>
        <!-- Row 3: desc -->
        ${descHtml}
      </li>`;
  }

  function renderTombstoneRow(item) {
    return `
      <li class="inventory-tombstone-row" title="${escapeHtml(item.desc || '')}">
        <span class="inventory-tombstone-name">${escapeHtml(item.name)}</span>
        <span class="inventory-tombstone-count">×0</span><!-- ui-lint-allow: 物品计数乘号 -->
      </li>`;
  }

  // 跨 render 保留 tombstone 折叠展开状态
  let _tombstoneOpen = false;

  function render() {
    const list = document.getElementById(LIST_ID);
    if (!list) return;
    const copy = getCopy();
    const store = window.inventoryStore;

    // 重建前抓取当前 tombstone 区开合状态（如果存在）
    const existingDetails = list.querySelector('.inventory-tombstone-section');
    if (existingDetails) {
      _tombstoneOpen = existingDetails.open === true;
    }

    const active = store?.getActiveItems?.() || [];
    const tombstones = store?.getTombstoneItems?.() || [];
    const pending = store?.getPending?.() || [];

    const isEmpty = active.length === 0 && tombstones.length === 0 && pending.length === 0;
    if (isEmpty) {
      list.innerHTML = `<div class="character-inv-empty">${escapeHtml(copy.inventoryEmpty)}</div>`;
      return;
    }

    const pendingHtml =
      pending.length > 0
        ? `
        <div class="inventory-pending-bar">
          <span class="inventory-pending-summary">${escapeHtml(copy.pendingSummary(pending.length))}</span>
          <button class="inventory-pending-bar-btn" data-action="inv-approve-all">${escapeHtml(copy.pendingApproveAll)}</button>
          <button class="inventory-pending-bar-btn" data-action="inv-reject-all">${escapeHtml(copy.pendingRejectAll)}</button>
        </div>`
        : '';

    // 用 name 索引 pending（仅取首个；多 pending 同名物品的批量处理走顶部"全接受"）
    const pendingByName = new Map();
    for (const p of pending) {
      if (!pendingByName.has(p.name)) pendingByName.set(p.name, p);
    }

    // 把 pending 中"全新待创建物品"（active 里没有，countAfter > 0）合成为虚边框卡片
    const activeNames = new Set(active.map(it => it.name));
    // tombstone 中的 icon 是玩家手动选过的，复活时（pending 把 count 拉回 >0）应沿用，
    // 不要让 heuristic 重新分配一个不熟的图标
    const tombstoneByName = new Map(tombstones.map(t => [t.name, t]));
    const synthesizedPendingItems = [];
    for (const p of pending) {
      if (activeNames.has(p.name)) continue;
      if (!(p.countAfter > 0)) continue;
      // 同名 pending 多条只合成一张卡片（取首条）
      if (synthesizedPendingItems.some(it => it.name === p.name)) continue;
      synthesizedPendingItems.push({
        name: p.name,
        count: p.countAfter,
        desc: p.descAfter || '',
        icon: tombstoneByName.get(p.name)?.icon || null,
      });
    }

    const unifiedItems = [...synthesizedPendingItems, ...active];

    // 清理过期的展开状态
    const aliveNames = new Set(unifiedItems.map(it => it.name));
    for (const name of [..._expandedNames]) {
      if (!aliveNames.has(name)) _expandedNames.delete(name);
    }

    const activeHtml =
      unifiedItems.length > 0
        ? `<ul class="character-inv-list">${unifiedItems.map(it => renderActiveCard(it, copy, pendingByName.get(it.name))).join('')}</ul>`
        : (tombstones.length > 0
            ? `<div class="character-inv-empty">${escapeHtml(copy.activeEmpty)}</div>`
            : '');

    const tombstoneHtml =
      tombstones.length > 0
        ? `
        <details class="inventory-tombstone-section"${_tombstoneOpen ? ' open' : ''}>
          <summary class="inventory-tombstone-summary">${escapeHtml(copy.tombstoneTitle(tombstones.length))}</summary>
          <ul class="inventory-tombstone-list">${tombstones.map(renderTombstoneRow).join('')}</ul>
        </details>`
        : '';

    list.innerHTML = pendingHtml + activeHtml + tombstoneHtml;
  }

  // ────── 事件委托（一次性绑定）──────

  function consumeOrDiscardItem(verb, itemName) {
    const store = window.inventoryStore;
    const ai = window.aiService;
    if (!store || !itemName) return;
    const turn = store.currentTurn || 0;
    const pending = store.queueChange({ name: itemName, delta: -1 }, turn, null);
    // queueChange 三种返回：pending / null（非法）/ { error: 'insufficient', ... }（库存不足）
    if (!pending || pending.error) return;
    store.approveChange(pending.id);
    if (typeof ai?.appendPlayerItemActionContext === 'function') {
      ai.appendPlayerItemActionContext({ verb, itemName, count: 1 });
    }
  }

  function bindClickDelegation() {
    const list = document.getElementById(LIST_ID);
    if (!list || list.dataset.invDelegated === '1') return;
    list.dataset.invDelegated = '1';
    list.addEventListener('click', e => {
      const store = window.inventoryStore;
      if (!store) return;
      const target = e.target;

      // ───── 卡片三按钮 ─────
      const cardEl = target.closest('.character-inv-card');
      const itemName = cardEl ? cardEl.getAttribute('data-item-name') : null;

      const approveItemBtn = target.closest('[data-action="item-approve"]');
      if (approveItemBtn) {
        const pid = approveItemBtn.getAttribute('data-pending-id');
        if (pid) store.approveChange(pid);
        return;
      }
      if (target.closest('[data-action="item-consume"]')) {
        consumeOrDiscardItem('消耗', itemName);
        return;
      }
      if (target.closest('[data-action="item-discard"]')) {
        consumeOrDiscardItem('随意丢弃', itemName);
        return;
      }

      // ───── 点 icon → 打开 picker ─────
      if (target.closest('[data-action="item-icon-pick"]')) {
        if (itemName && window.inventoryIconPicker?.open) {
          window.inventoryIconPicker.open(itemName);
        }
        return;
      }

      // ───── 点物品名 → 切换 desc 展开 ─────
      const toggleEl = target.closest('[data-action="card-toggle"]');
      if (toggleEl && cardEl && itemName) {
        if (_expandedNames.has(itemName)) _expandedNames.delete(itemName);
        else _expandedNames.add(itemName);
        const expanded = _expandedNames.has(itemName);
        cardEl.setAttribute('data-expanded', expanded ? '1' : '0');
        const descEl = cardEl.querySelector('.character-inv-desc');
        if (descEl) {
          if (expanded) descEl.removeAttribute('data-clamped');
          else descEl.setAttribute('data-clamped', 'true');
        }
        return;
      }

      // ───── 顶部 pending bar 批量按钮 ─────
      if (target.closest('[data-action="inv-approve-all"]')) {
        store.approveAll();
        return;
      }
      if (target.closest('[data-action="inv-reject-all"]')) {
        store.rejectAll();
        return;
      }
    });
    // 跨 render 持久化 tombstone 折叠状态
    list.addEventListener('toggle', e => {
      const target = e.target;
      if (target && target.classList && target.classList.contains('inventory-tombstone-section')) {
        _tombstoneOpen = target.open === true;
      }
    }, true);
  }

  // ────── 公共接口 ──────

  function init() {
    if (!document.getElementById(TILE_ID)) return;
    bindClickDelegation();
    render();

    // EventBus 订阅
    const bus = window.eventBus;
    const events = window.GameEvents;
    if (bus && events) {
      if (events.INVENTORY_CHANGED) bus.on(events.INVENTORY_CHANGED, render);
      if (events.INVENTORY_PENDING) bus.on(events.INVENTORY_PENDING, render);
      if (events.INVENTORY_RESTORED) bus.on(events.INVENTORY_RESTORED, render);
    }
    window.addEventListener('ui-language-changed', render);
  }

  window.characterPanelUI = {
    render,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }

  console.log('[CharacterPanelUI] Initialized');
})();
