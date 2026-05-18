// js/ui/avatarDropdownUI.js
// 账户菜单 dropdown：账户中心 + 系统设置 + Debug + 重置 + 退出
// trigger：设计 mode header / 手机底栏 stage-nav 最右那个 .avatar-trigger 按钮（v3.5）。
// 系统设置/Debug/重置 通过对隐藏按钮 .click() 触发既有 handler。

(function () {
  'use strict';

  const TRIGGER_SELECTOR = '.avatar-trigger';
  const DROPDOWN_ID = 'avatar-dropdown';

  // 当前打开 dropdown 的 trigger 引用——positionDropdown 据此定位
  let _activeTrigger = null;

  function isEnglish() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  }

  function getCopy() {
    const en = isEnglish();
    return {
      accountCenter: en ? 'Account Center' : '账户中心',
      notSignedIn: en ? 'Not signed in' : '未登录',
      systemSettings: en ? 'Settings' : '系统设置',
      debug: 'Debug',
      reset: en ? 'Reset' : '重置',
      signOut: en ? 'Sign Out' : '退出登录',
      signOutSuccess: en ? 'Signed out' : '已退出登录',
      signedInLabel: en ? 'Signed In' : '已登录',
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

  function getState() {
    return window.accountStore?.getSnapshot?.() || { authStatus: 'guest' };
  }

  function isGuest() {
    return window.accountStore?.isGuest?.() !== false;
  }

  // ────── 渲染 ──────
  function render() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) return;
    const copy = getCopy();
    const state = getState();
    const guest = isGuest();

    // 顶部 header 可点击：guest → 跳账户中心引导登录；登录后 → 跳账户中心管理
    const headerHtml = '';

    const settingsItem = `
      <button class="avatar-dropdown-item" data-action="open-settings" role="menuitem">
        <span class="material-symbols-outlined avatar-dropdown-icon">settings</span>
        <span>${escapeHtml(copy.systemSettings)}</span>
      </button>`;

    const debugItem = `
      <button class="avatar-dropdown-item" data-action="open-debug" role="menuitem">
        <span class="material-symbols-outlined avatar-dropdown-icon">bug_report</span>
        <span>${escapeHtml(copy.debug)}</span>
      </button>`;

    // 重置项：触发 header 工具区已隐藏的 #reset-btn click，复用 game.js 的 confirm 流程
    // icon 套老 .header-tile-icon--reset 的 status-danger 红，跟原 header 那个重置按钮一致
    const resetItem = `
      <button class="avatar-dropdown-item" data-action="open-reset" role="menuitem">
        <span class="material-symbols-outlined avatar-dropdown-icon header-tile-icon--reset">restart_alt</span>
        <span>${escapeHtml(copy.reset)}</span>
      </button>`;

    const signOutItem = guest
      ? ''
      : `
        <hr class="avatar-dropdown-divider" />
        <button class="avatar-dropdown-item avatar-dropdown-item--danger" data-action="sign-out" role="menuitem">
          <span class="material-symbols-outlined avatar-dropdown-icon">logout</span>
          <span>${escapeHtml(copy.signOut)}</span>
        </button>`;

    dropdown.innerHTML = `
      ${settingsItem}
      ${debugItem}
      ${resetItem}
      ${signOutItem}
    `;

    // 绑定 dropdown 内部按钮
    dropdown.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        handleAction(action);
      });
    });
  }

  // ────── 操作分发 ──────
  function handleAction(action) {
    closeDropdown();
    switch (action) {
      case 'open-account':
        window.accountCenterUI?.open?.();
        break;
      case 'open-settings':
        // 通过既有按钮 click 触发 game.js 中已绑定的 openSettings handler
        document.getElementById('settings-btn')?.click();
        break;
      case 'open-debug':
        document.getElementById('debug-btn')?.click();
        break;
      case 'open-reset':
        // 触发 header 工具区（CSS 隐藏的）#reset-btn click，复用 game.js 既有 confirm + reset 流程
        document.getElementById('reset-btn')?.click();
        break;
      case 'sign-out':
        // 真实退出：调用 relay /api/user/logout 并清本地缓存
        Promise.resolve(window.accountStore?.signOut?.())
          .catch(() => { /* 即使 relay 报错，本地状态已被 reset */ })
          .finally(() => showToast(getCopy().signOutSuccess));
        break;
    }
  }

  // ────── Toast（简易，未来可换 toastUI） ──────
  function showToast(message) {
    const existing = document.getElementById('avatar-dropdown-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = 'avatar-dropdown-toast';
    toast.className = 'avatar-dropdown-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 240);
    }, 1800);
  }

  // ────── 开关 ──────
  function isOpen() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    return dropdown?.classList.contains('is-open') === true;
  }

  function _getVisibleTrigger() {
    // 多个 .avatar-trigger（桌面 header + 手机底栏）同时存在，挑当前可见那个作为定位锚
    const triggers = document.querySelectorAll(TRIGGER_SELECTOR);
    for (const t of triggers) {
      const rect = t.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return t;
    }
    return triggers[0] || null;
  }

  function openDropdown(trigger) {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) return;
    _activeTrigger = trigger || _getVisibleTrigger();
    if (!_activeTrigger) return;
    render();
    positionDropdown();
    dropdown.classList.add('is-open');
    dropdown.setAttribute('aria-hidden', 'false');
    _activeTrigger.setAttribute('aria-expanded', 'true');
  }

  function closeDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) return;
    dropdown.classList.remove('is-open');
    dropdown.setAttribute('aria-hidden', 'true');
    document.querySelectorAll(TRIGGER_SELECTOR).forEach(t => t.setAttribute('aria-expanded', 'false'));
    _activeTrigger = null;
  }

  function toggleDropdown(trigger) {
    if (isOpen()) closeDropdown();
    else openDropdown(trigger);
  }

  // 智能定位：trigger 在 viewport 下半（如手机底栏）时 dropdown 往上弹，避免跑屏外
  function positionDropdown() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    const btn = _activeTrigger || _getVisibleTrigger();
    if (!dropdown || !btn) return;
    const rect = btn.getBoundingClientRect();
    const dh = dropdown.offsetHeight || 280;
    const flipUp = window.innerHeight - rect.bottom < dh + 16;
    if (flipUp) {
      dropdown.style.top = 'auto';
      dropdown.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      dropdown.style.top = `${rect.bottom + 6}px`;
      dropdown.style.bottom = 'auto';
    }
    dropdown.style.right = `${window.innerWidth - rect.right}px`;
    dropdown.style.left = 'auto';
  }

  // ────── 初始化 ──────
  function init() {
    const dropdown = document.getElementById(DROPDOWN_ID);
    if (!dropdown) {
      console.log('[AvatarDropdownUI] dropdown DOM not found');
      return;
    }

    // 把 dropdown 从 header 内部挪到 body 末尾，逃出 header 的 stacking context
    if (dropdown.parentElement && dropdown.parentElement !== document.body) {
      document.body.appendChild(dropdown);
    }

    render();

    // 事件委托：所有 .avatar-trigger 共享同一个 dropdown，谁被点谁锚定
    document.body.addEventListener('click', e => {
      const trigger = e.target && e.target.closest && e.target.closest(TRIGGER_SELECTOR);
      if (!trigger) return;
      e.stopPropagation();
      toggleDropdown(trigger);
    });

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
    window.addEventListener('scroll', () => { if (isOpen()) positionDropdown(); });

    // 订阅账户变化
    if (window.eventBus) {
      window.eventBus.on('account:changed', render);
    }

    // 语言切换重渲染
    window.addEventListener('ui-language-changed', render);

    console.log('[AvatarDropdownUI] Initialized');
  }

  window.avatarDropdownUI = {
    open: openDropdown,
    close: closeDropdown,
    toggle: toggleDropdown,
    render,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }
})();
