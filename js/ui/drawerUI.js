// ============================================
// 章节总结红点清除 hook
// ============================================
// 原"移动端侧栏抽屉 + 桌面端 tab 切换"已随 stage-router 永久启用而废弃：
//   - 抽屉触发器（#info-tile-btn / #worldcard-tile-btn）在 body.stage-router-on 下全屏隐藏，点不到
//   - #game-sidebar-tabs / #worldcard-info-tile 的磁贴改由 stageEmbed reparent 进 stage-pane
//   - 手机端入口改走底部 .stage-mobile-bar 的 stage-nav 按钮
// 对应的抽屉 CSS（app.css）与逻辑已整体移除。本文件仅保留下面这一个仍在用的补丁：
//   stage-nav 路径进入「章节总结」时清掉总结红点（与旧 tab 切换的清红点行为一致）。

(function () {
  'use strict';

  // stage-router 下用户走 sub-tab 路径进章节总结，进入 story/summary 时清红点
  // （老 ID #summary-btn-badge + stage-nav 章节总结 sub-tab 上的镜像 #stage-summary-badge 都清）
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
    hookStageSubstageBadgeClear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }
})();
