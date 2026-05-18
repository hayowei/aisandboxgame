// js/ui/inventoryIconPicker.js
// 玩家点物品 icon → 弹出 picker → 选一个 glyph 永久覆盖默认启发式
// glyph 列表来自 window.ItemGlyphs.LIST（与子集字体 allowlist 同步）
// 写入 inventoryStore.setItemIcon(name, glyph|null)

(function () {
  'use strict';

  const PICKER_ID = 'inv-icon-picker';
  let _dialog = null;
  let _currentItemName = null;

  function isEnglish() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  }

  function getCopy() {
    const en = isEnglish();
    return {
      title: name => (en ? `Choose icon — ${name}` : `选择图标 — ${name}`),
      reset: en ? 'Default' : '默认',
      close: en ? 'Close' : '关闭',
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildDialog() {
    if (_dialog) return _dialog;
    _dialog = document.createElement('dialog');
    _dialog.id = PICKER_ID;
    _dialog.className = 'inv-icon-picker';
    document.body.appendChild(_dialog);

    // 委托一次性绑定
    _dialog.addEventListener('click', e => {
      const cell = e.target.closest('[data-action="picker-cell"]');
      if (cell) {
        const glyph = cell.getAttribute('data-glyph') || null;
        applyGlyph(glyph);
        return;
      }
      const close = e.target.closest('[data-action="picker-close"]');
      if (close) {
        _dialog.close();
        return;
      }
      // 点 backdrop（dialog 自身但不在内容区）→ 关闭
      if (e.target === _dialog) {
        _dialog.close();
      }
    });

    _dialog.addEventListener('close', () => {
      _currentItemName = null;
    });

    return _dialog;
  }

  function applyGlyph(glyph) {
    if (!_currentItemName) return;
    const store = window.inventoryStore;
    if (!store?.setItemIcon) {
      console.warn('[inventoryIconPicker] inventoryStore.setItemIcon 不可用');
      return;
    }
    store.setItemIcon(_currentItemName, glyph);
    _dialog.close();
  }

  function renderGrid(currentGlyph) {
    const list = window.ItemGlyphs?.LIST || [];
    const copy = getCopy();
    const cells = [];

    // 第一格 = 恢复默认（清掉 icon 覆盖）
    cells.push(`
      <button class="inv-icon-picker-cell inv-icon-picker-cell--reset"
              data-action="picker-cell"
              data-glyph=""
              aria-label="${escapeHtml(copy.reset)}"
              title="${escapeHtml(copy.reset)}">
        <span class="material-symbols-outlined">restart_alt</span>
        <span class="inv-icon-picker-label">${escapeHtml(copy.reset)}</span>
      </button>`);

    for (const item of list) {
      const isSelected = currentGlyph && currentGlyph === item.glyph;
      cells.push(`
        <button class="inv-icon-picker-cell${isSelected ? ' is-selected' : ''}"
                data-action="picker-cell"
                data-glyph="${escapeHtml(item.glyph)}"
                aria-label="${escapeHtml(item.label)}"
                title="${escapeHtml(item.label)}">
          <span class="character-inv-item-glyph">${escapeHtml(item.glyph)}</span>
          <span class="inv-icon-picker-label">${escapeHtml(item.label)}</span>
        </button>`);
    }

    return cells.join('');
  }

  function open(itemName) {
    if (!itemName) return;
    const store = window.inventoryStore;
    if (!store) return;

    _currentItemName = itemName;
    const dialog = buildDialog();
    const copy = getCopy();
    const item = store.getItem(itemName);
    const currentGlyph = item?.icon || null;

    dialog.innerHTML = `
      <div class="inv-icon-picker-card">
        <header class="inv-icon-picker-header">
          <span class="inv-icon-picker-title">${escapeHtml(copy.title(itemName))}</span>
          <button class="inv-icon-picker-close" data-action="picker-close" aria-label="${escapeHtml(copy.close)}">
            <span class="material-symbols-outlined">close</span>
          </button>
        </header>
        <div class="inv-icon-picker-grid">
          ${renderGrid(currentGlyph)}
        </div>
      </div>`;

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      // 兜底：浏览器不支持 dialog 时
      dialog.setAttribute('open', '');
    }
  }

  window.inventoryIconPicker = { open };

  console.log('[InventoryIconPicker] Initialized');
})();
