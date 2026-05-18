// ============================================
// 移动端抽屉面板 UI + 桌面端右侧栏 tab 切换
// ============================================

(function () {
  'use strict';

  const SIDEBAR_TAB_KEY = 'sidebar_active_tab_v1';
  const VALID_TABS = ['summary', 'character', 'npc'];
  const DEFAULT_TAB = 'character';

  function isDrawerViewport() {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 1150px)').matches;
    }
    return window.innerWidth <= 1150;
  }

  function activateTab(tabName) {
    const container = document.getElementById('game-sidebar-tabs');
    if (!container) return;
    if (!VALID_TABS.includes(tabName)) return;

    container.querySelectorAll('.tab[data-tab]').forEach(btn => {
      const on = btn.dataset.tab === tabName;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    container.querySelectorAll('.tab-panel[data-tab]').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.tab === tabName);
    });

    // 切到总结 tab 时清除红点（视为已查看）—— 老 ID + stage-nav 章节总结 sub-tab 上的镜像都清
    if (tabName === 'summary') {
      ['summary-btn-badge', 'stage-summary-badge'].forEach(id => {
        const badge = document.getElementById(id);
        if (badge) badge.classList.add('hidden');
      });
    }

    try {
      localStorage.setItem(SIDEBAR_TAB_KEY, tabName);
    } catch (e) {
      // 私密浏览或写入失败不影响切换
    }
  }

  function initSidebarTabs() {
    const container = document.getElementById('game-sidebar-tabs');
    if (!container) return;

    let saved = null;
    try {
      saved = localStorage.getItem(SIDEBAR_TAB_KEY);
    } catch (e) {
      saved = null;
    }
    const initial = VALID_TABS.includes(saved) ? saved : DEFAULT_TAB;
    activateTab(initial);

    container.addEventListener('click', e => {
      const tab = e.target.closest('.tab[data-tab]');
      if (!tab || !container.contains(tab)) return;
      activateTab(tab.dataset.tab);
    });
  }

  function initDrawers() {
    const infoPanelBtn = document.getElementById('info-tile-btn');
    const worldcardPanelBtn = document.getElementById('worldcard-tile-btn');
    const sidebarTabs = document.getElementById('game-sidebar-tabs');
    const worldcardPanel = document.getElementById('worldcard-info-tile');
    const overlay = document.getElementById('drawer-overlay');

    if (!infoPanelBtn || !sidebarTabs) {
      console.log('[DrawerUI] Buttons not found');
      return;
    }

    console.log('[DrawerUI] Initializing...');

    // 动态计算抽屉顶部偏移（对齐聊天消息区域顶部，跳过 header / sticky bar / design header）
    function updateDrawerTop() {
      const chatArea = document.querySelector('.chat-messages-area');
      if (chatArea) {
        const top = chatArea.getBoundingClientRect().top;
        document.documentElement.style.setProperty('--drawer-top', Math.max(0, top) + 'px');
        return;
      }
      const header = document.querySelector('header');
      if (header) {
        document.documentElement.style.setProperty('--drawer-top', header.offsetHeight + 'px');
      }
    }

    function syncDrawerViewportState() {
      if (!isDrawerViewport()) {
        closeDrawers();
      }
    }

    updateDrawerTop();
    syncDrawerViewportState();
    window.addEventListener('resize', function () {
      updateDrawerTop();
      syncDrawerViewportState();
    });
    window.addEventListener('orientationchange', function () {
      setTimeout(function () {
        updateDrawerTop();
        syncDrawerViewportState();
      }, 100);
    });

    function closeDrawers() {
      console.log('[DrawerUI] Closing drawers');
      if (sidebarTabs) sidebarTabs.classList.remove('drawer-open');
      if (worldcardPanel) worldcardPanel.classList.remove('drawer-open');
      if (overlay) overlay.classList.remove('active');
    }

    // 沙盒：打开统一的"信息"抽屉（内部 tab 由 localStorage 记忆，已在 initSidebarTabs 中恢复）
    infoPanelBtn.onclick = function (e) {
      if (!isDrawerViewport()) return;
      e.preventDefault();
      e.stopPropagation();
      console.log('[DrawerUI] Info button clicked');
      updateDrawerTop();
      closeDrawers();
      sidebarTabs.classList.add('drawer-open');
      if (overlay) overlay.classList.add('active');
    };

    // 世界卡信息面板（世界卡专用，不在 tab 容器里）
    if (worldcardPanelBtn) {
      worldcardPanelBtn.onclick = function (e) {
        if (!isDrawerViewport()) return;
        e.preventDefault();
        e.stopPropagation();
        console.log('[DrawerUI] Worldcard button clicked');
        updateDrawerTop();
        closeDrawers();
        if (worldcardPanel) {
          worldcardPanel.classList.add('drawer-open');
          if (window.worldCardInfoUI) window.worldCardInfoUI.refresh();
        }
        if (overlay) overlay.classList.add('active');
      };
    }

    // 抽屉面板内部点击/触摸不应关闭抽屉
    const stopPanelEvent = function (e) {
      e.stopPropagation();
    };
    if (sidebarTabs) {
      sidebarTabs.addEventListener('click', stopPanelEvent);
      sidebarTabs.addEventListener('touchstart', stopPanelEvent);
    }
    if (worldcardPanel) {
      worldcardPanel.addEventListener('click', stopPanelEvent);
      worldcardPanel.addEventListener('touchstart', stopPanelEvent);
    }

    if (overlay) {
      overlay.onclick = function () {
        if (isDrawerViewport()) closeDrawers();
      };
    }

    document.addEventListener('keydown', function (e) {
      if (!isDrawerViewport()) return;
      if (e.key === 'Escape') {
        const isOpen =
          (sidebarTabs && sidebarTabs.classList.contains('drawer-open')) ||
          (worldcardPanel && worldcardPanel.classList.contains('drawer-open'));
        if (isOpen) closeDrawers();
      }
    });

    console.log('[DrawerUI] Setup complete');
  }

  // stage-router 下用户走 sub-tab 路径进章节总结，不触发 activateTab；这里补一个事件监听
  // 让进入 story/summary 时也清红点（与 activateTab('summary') 行为一致）
  function hookStageSubstageBadgeClear() {
    if (!window.eventBus || typeof window.eventBus.on !== 'function') return;
    window.eventBus.on('stage:substage-changed', payload => {
      if (payload && payload.stage === 'story' && payload.substage === 'summary') {
        ['summary-btn-badge', 'stage-summary-badge'].forEach(id => {
          const badge = document.getElementById(id);
          if (badge) badge.classList.add('hidden');
        });
      }
    });
  }

  function init() {
    initSidebarTabs();
    initDrawers();
    hookStageSubstageBadgeClear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }
})();
