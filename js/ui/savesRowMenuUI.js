// js/ui/savesRowMenuUI.js
// 世界卡行操作 dropdown 菜单：≤480px 替代原 4 个 .saves-wc-btn 的「…」按钮 → 弹窗
// 视觉/定位/交互与 avatarDropdownUI 同款（复用 .themed-dropdown / .avatar-dropdown-item 等样式）。
// trigger：accordion head 内带 data-saves-row-menu-trigger="<cardId>" 的按钮（每张卡一个，dropdown 单例）。
// menu item → 直接调用 window._savesDispatchWcAction(action, id)，复用 saveManagerUI 既有派发逻辑。

(function () {
  'use strict';

  const TRIGGER_SELECTOR = '[data-saves-row-menu-trigger]';
  const DROPDOWN_ID = 'saves-row-menu';

  let _activeTrigger = null;
  let _activeCardId = null;
  let _activeIsBuiltIn = false;
  let _activeWhenLabel = '';

  function isEnglish() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  }

  function _t(zh, en) {
    return isEnglish() ? en : zh;
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
  function render() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) return;
    if (!_activeCardId) {
      dropdown.innerHTML = '';
      return;
    }
    const idAttr = escapeHtml(_activeCardId);
    const items = [];

    // 顶部"最后游玩时间"——saveManagerUI 已经把 formatDate 结果挂到 trigger 上，这里只负责展示
    if (_activeWhenLabel) {
      items.push(`<div class="saves-row-menu-when">${escapeHtml(_activeWhenLabel)}</div>`);
      items.push('<hr class="avatar-dropdown-divider" />');
    }

    // 内置卡不可编辑/导出/删除——只暴露"导入存档"。与 saveManagerUI._savesRenderAccordionItem 中的可见性条件保持一致。
    if (!_activeIsBuiltIn) {
      items.push(`
        <button class="avatar-dropdown-item" type="button" role="menuitem" data-wc-action="edit-design" data-id="${idAttr}">
          <span class="material-symbols-outlined avatar-dropdown-icon">edit_note</span>
          <span>${escapeHtml(_t('编辑', 'Edit'))}</span>
        </button>`);
    }

    items.push(`
      <button class="avatar-dropdown-item" type="button" role="menuitem" data-wc-action="import-save" data-id="${idAttr}">
        <span class="material-symbols-outlined avatar-dropdown-icon">upload</span>
        <span>${escapeHtml(_t('导入存档', 'Import Save'))}</span>
      </button>`);

    if (!_activeIsBuiltIn) {
      items.push(`
        <button class="avatar-dropdown-item" type="button" role="menuitem" data-wc-action="export" data-id="${idAttr}">
          <span class="material-symbols-outlined avatar-dropdown-icon">download</span>
          <span>${escapeHtml(_t('下载世界卡', 'Download World Card'))}</span>
        </button>`);
      items.push(`
        <button class="avatar-dropdown-item avatar-dropdown-item--danger" type="button" role="menuitem" data-wc-action="delete" data-id="${idAttr}">
          <span class="material-symbols-outlined avatar-dropdown-icon">delete</span>
          <span>${escapeHtml(_t('删除', 'Delete'))}</span>
        </button>`);
    }

    dropdown.innerHTML = items.join('');

    dropdown.querySelectorAll('[data-wc-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.getAttribute('data-wc-action');
        const id = btn.getAttribute('data-id');
        closeDropdown();
        if (typeof window._savesDispatchWcAction === 'function' && action && id) {
          window._savesDispatchWcAction(action, id);
        }
      });
    });
  }

  // ────── 开关 ──────
  function isOpen() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    return dropdown?.classList.contains('is-open') === true;
  }

  function openDropdown(trigger) {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown || !trigger) return;
    _activeTrigger = trigger;
    _activeCardId = trigger.getAttribute('data-saves-row-menu-trigger') || null;
    _activeIsBuiltIn = trigger.getAttribute('data-saves-row-menu-builtin') === '1';
    _activeWhenLabel = trigger.getAttribute('data-saves-row-menu-when') || '';
    if (!_activeCardId) return;
    render();
    positionDropdown();
    dropdown.classList.add('is-open');
    dropdown.setAttribute('aria-hidden', 'false');
    trigger.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) return;
    dropdown.classList.remove('is-open');
    dropdown.setAttribute('aria-hidden', 'true');
    document.querySelectorAll(TRIGGER_SELECTOR).forEach(t => t.setAttribute('aria-expanded', 'false'));
    _activeTrigger = null;
    _activeCardId = null;
    _activeIsBuiltIn = false;
    _activeWhenLabel = '';
  }

  function toggleDropdown(trigger) {
    if (isOpen()) {
      // 点同一 trigger → 关；点另一张卡的 trigger → 关旧开新（reanchor）
      if (_activeTrigger === trigger) {
        closeDropdown();
      } else {
        closeDropdown();
        openDropdown(trigger);
      }
    } else {
      openDropdown(trigger);
    }
  }

  // 智能定位：trigger 在 viewport 下半 → dropdown 往上弹，避免跑屏外
  // 水平：默认右对齐 trigger 右边；若 dropdown 左边会越过 viewport（窄屏触发）则改为左对齐 viewport + 边距
  function positionDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    const btn = _activeTrigger;
    if (!dropdown || !btn) return;
    const rect = btn.getBoundingClientRect();
    const dh = dropdown.offsetHeight || 200;
    const dw = dropdown.offsetWidth || 168;
    const margin = 8;

    const flipUp = window.innerHeight - rect.bottom < dh + 16;
    if (flipUp) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.bottom = 'auto';
    }

    const desiredRight = window.innerWidth - rect.right;
    const projectedLeft = window.innerWidth - desiredRight - dw;
    if (projectedLeft < margin) {
      // 右对齐会越过左边——左对齐贴 viewport
      dropdown.style.left = `${margin}px`;
      dropdown.style.right = 'auto';
    } else {
      dropdown.style.right = `${desiredRight}px`;
      dropdown.style.left = 'auto';
    }
  }

  // ────── 初始化 ──────
  function init() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) {
      console.log('[SavesRowMenuUI] dropdown DOM not found');
      return;
    }

    // 挪到 body 末尾，逃出任何 header/stage 的 stacking context
    if (dropdown.parentElement && dropdown.parentElement !== document.body) {
      document.body.appendChild(dropdown);
    }

    // 点击外部关闭
    document.addEventListener('click', e => {
      if (!isOpen()) return;
      const target = e.target;
      if (target.closest && target.closest(TRIGGER_SELECTOR)) return;
      if (target === dropdown || dropdown.contains(target)) return;
      closeDropdown();
    });

    // Esc 关闭
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) {
        closeDropdown();
      }
    });

    // 窗口尺寸/滚动变化时重定位
    window.addEventListener('resize', () => { if (isOpen()) positionDropdown(); });
    window.addEventListener('scroll', () => { if (isOpen()) positionDropdown(); }, true);

    // 语言切换重渲染
    window.addEventListener('ui-language-changed', () => { if (isOpen()) render(); });

    console.log('[SavesRowMenuUI] Initialized');
  }

  window.savesRowMenuUI = {
    open: openDropdown,
    close: closeDropdown,
    toggle: toggleDropdown,
    isOpen,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }
})();
