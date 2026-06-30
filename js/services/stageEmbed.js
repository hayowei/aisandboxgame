// js/services/stageEmbed.js
// 把现有 modal/overlay 和侧栏 tile "借住"到对应 stage-pane（主舞台或侧栏舞台）。
// 主舞台容器：.stage-pane[data-stage-pane="X"]（在 #main-stage 内）
// 侧栏容器：.stage-pane-side[data-stage-pane-side="X"]（在 #side-panel 内）
//
// 类型：
//   - type='modal'：reparent + 调 open/close
//   - type='tile' ：reparent target + chip
//
// 双 pane 约束：modal/tile DOM 是单例，同一 stage 不能同时挂在主+侧——
// router 允许 sideStage === mainStage 后，_syncFromState 内 wantSide === wantMain
// 时主动把 wantSide 置 null，主赢、侧空。

(function () {
  'use strict';

  const EMBEDS = [
    // ============ Modals ============
    // 注：saves stage 已从 modal 借住改为 stage 原生 DOM（v3.5+），不再在此列表
    // 注：sms stage 已重做为 Claude Design 原生 stage（#sms-root，由 js/ui/phoneUI.js
    //     直接渲染，不 reparent 任何 modal），与 saves 同属原生 stage，不在此列表
    // 注：map / square 两个 stage 仍处于 coming-soon 状态——
    //     不在此 reparent 真 modal，stage-pane 内的 .stage-coming-soon 蒙版独占
    // ============ Native hosts (reparent-able) ============
    // account / saves：DOM 是 [data-stage-pane="X"] 的子 host，
    // 接入 tile 复用 reparent 机制 → 主+侧任一槽可显示。
    // account 的 owner-gate 留在主 pane 不动（locked 用户主路径仍被遮罩）。
    {
      type: 'tile',
      stage: 'account',
      targetId: 'account-stage-host',
    },
    {
      type: 'tile',
      stage: 'saves',
      targetId: 'saves-stage-root',
    },
    // ============ Sidebar tiles ============
    {
      type: 'tile',
      stage: 'cast',
      targetId: 'npc-tile',
      chipId: 'auto-approve-npc-toggle',
    },
    {
      type: 'tile',
      stage: 'inventory',
      targetId: 'character-tile',
      chipId: 'auto-approve-inventory-toggle',
    },
    // story / summary sub-tab：把 summary-tile 借住到主 pane
    {
      type: 'tile',
      stage: 'story',
      substage: 'summary',
      targetId: 'summary-tile',
    },
    // preview 3 sub-tab：worldcard / card / code
    {
      type: 'tile',
      stage: 'preview',
      substage: 'worldcard',
      targetId: 'worldcard-info-tile',
    },
    {
      type: 'tile',
      stage: 'preview',
      substage: 'card',
      targetId: 'design-card-panel',
    },
    {
      type: 'tile',
      stage: 'preview',
      substage: 'code',
      targetId: 'design-code-panel',
    },
  ];

  // 找到 (stage, substage) 匹配的 entry；substage 没指定的 entry 兜底匹配
  function _findEmbed(stage, substage) {
    if (!stage) return null;
    let exact = EMBEDS.find(function (e) { return e.stage === stage && e.substage === substage; });
    if (exact) return exact;
    return EMBEDS.find(function (e) { return e.stage === stage && !e.substage; }) || null;
  }

  // 双槽：主 + 侧
  const attachedByPane = { main: null, side: null };

  // 选目标容器：主舞台 .stage-pane[data-stage-pane=X] / 侧栏 .stage-pane-side[data-stage-pane-side=X]
  function _getPaneEl(stage, pane) {
    if (pane === 'side') {
      return document.querySelector('.stage-pane-side[data-stage-pane-side="' + stage + '"]');
    }
    return document.querySelector('.stage-pane[data-stage-pane="' + stage + '"]');
  }

  function _rememberOrigin(el) {
    if (!el) return;
    if (el._stageOriginalParent) return;
    el._stageOriginalParent = el.parentElement;
    el._stageOriginalNextSibling = el.nextElementSibling || null;
  }

  function _restoreToOrigin(el) {
    if (!el || !el._stageOriginalParent) return;
    if (el._stageOriginalNextSibling && el._stageOriginalNextSibling.parentElement === el._stageOriginalParent) {
      el._stageOriginalParent.insertBefore(el, el._stageOriginalNextSibling);
    } else {
      el._stageOriginalParent.appendChild(el);
    }
  }

  function _attachModal(embed, paneEl) {
    const modal = document.getElementById(embed.targetId);
    if (!modal) return;
    _rememberOrigin(modal);
    paneEl.appendChild(modal);
    modal.classList.add('stage-embedded');
    modal.classList.remove('hidden');
    try { embed.open && embed.open(); } catch (e) { console.error('[stageEmbed] open error', e); }
  }

  function _detachModal(embed) {
    const modal = document.getElementById(embed.targetId);
    if (!modal) return;
    try { embed.close && embed.close(); } catch (e) { console.error('[stageEmbed] close error', e); }
    modal.classList.remove('stage-embedded');
    _restoreToOrigin(modal);
    modal.classList.add('hidden');
  }

  function _attachTile(embed, paneEl) {
    const tile = document.getElementById(embed.targetId);
    if (!tile) return;
    _rememberOrigin(tile);
    if (tile._stageOriginalDisplay === undefined) {
      tile._stageOriginalDisplay = tile.style.display || '';
    }
    if (tile.style.display === 'none') {
      tile.style.removeProperty('display');
    }
    let chip = null;
    if (embed.chipId) {
      chip = document.getElementById(embed.chipId);
      if (chip) _rememberOrigin(chip);
    }
    if (chip) {
      const chipWrap = document.createElement('div');
      chipWrap.className = 'stage-chip-wrap stage-attached';
      chipWrap._stageGeneratedFor = embed.stage;
      chipWrap.appendChild(chip);
      paneEl.appendChild(chipWrap);
    }
    paneEl.appendChild(tile);
    tile.classList.add('stage-attached');
    tile.classList.add('is-active');
  }

  function _detachTile(embed) {
    const tile = document.getElementById(embed.targetId);
    if (tile) {
      tile.classList.remove('stage-attached');
      _restoreToOrigin(tile);
      if (tile._stageOriginalDisplay !== undefined) {
        if (tile._stageOriginalDisplay) {
          tile.style.display = tile._stageOriginalDisplay;
        } else {
          tile.style.removeProperty('display');
        }
        delete tile._stageOriginalDisplay;
      }
    }
    if (embed.chipId) {
      const chip = document.getElementById(embed.chipId);
      if (chip) {
        const wrap = chip.parentElement;
        _restoreToOrigin(chip);
        if (wrap && wrap.classList.contains('stage-chip-wrap')) {
          wrap.parentElement && wrap.parentElement.removeChild(wrap);
        }
      }
    }
    if (tile) {
      tile.classList.remove('is-active');
      const activeBtn = document.querySelector('#game-sidebar-tabs .tab.is-active');
      const activeTabId = activeBtn && activeBtn.getAttribute('data-tab');
      if (activeTabId && tile.getAttribute('data-tab') === activeTabId) {
        tile.classList.add('is-active');
      }
    }
  }

  function _attach(embed, pane) {
    const paneEl = _getPaneEl(embed.stage, pane);
    if (!paneEl) {
      console.warn('[stageEmbed] missing', pane, 'pane for', embed.stage);
      return;
    }
    if (embed.type === 'tile') {
      _attachTile(embed, paneEl);
    } else {
      _attachModal(embed, paneEl);
    }
    attachedByPane[pane] = embed;
  }

  function _detach(embed, pane) {
    if (embed.type === 'tile') {
      _detachTile(embed);
    } else {
      _detachModal(embed);
    }
    if (attachedByPane[pane] === embed) attachedByPane[pane] = null;
  }

  function _isDesktopWide() {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(min-width: 1151px)').matches;
    }
    return window.innerWidth > 1150;
  }

  // 双 pane 同步：必须「两侧先全 detach，再两侧全 attach」，不能按槽串行 attach→detach。
  // 原因：tile/chip DOM 是单例、_detach/_attach 按 id 操作；同一个 embed 对象会同时被
  // 主+侧两槽引用。若先 _attach(主) 再 _detach(旧侧)，当 inventory 从侧栏挪到主舞台时，
  // 第二步会按 id 把刚 attach 进主舞台的 tile/chip 又恢复回 origin → 主舞台空白、
  // 物品自动审批 chip 消失。先 detach 把单例归还 origin、再 attach 重新抓即无此竞争。
  // 主+侧选了同一 stage（单例 tile/host 只能挂一处）时，在侧栏 pane 里塞一个占位卡片
  // ——告诉用户"内容正在主面板显示"，避免侧栏整块空白
  let _collisionStage = null;

  function _renderCollisionPlaceholder(stage) {
    if (_collisionStage === stage) return;
    _clearCollisionPlaceholder();
    const pane = document.querySelector(
      '.stage-pane-side[data-stage-pane-side="' + stage + '"]'
    );
    if (!pane) return;
    const ph = document.createElement('div');
    ph.className = 'side-stage-placeholder side-stage-placeholder--collision';
    // 借用 .stage-coming-soon-art / -icon / -title 的视觉骨架（跟"广场正在制作中"一致）
    ph.innerHTML =
      '<div class="stage-coming-soon-art">' +
        '<span class="material-symbols-outlined stage-coming-soon-icon">layers</span>' +
      '</div>' +
      '<p class="stage-coming-soon-title">' +
        '<span class="ui-label-cn">正在主面板显示</span>' +
        '<span class="ui-label-en">Showing in main pane</span>' +
      '</p>';
    pane.appendChild(ph);
    _collisionStage = stage;
  }

  function _clearCollisionPlaceholder() {
    if (!_collisionStage) return;
    const pane = document.querySelector(
      '.stage-pane-side[data-stage-pane-side="' + _collisionStage + '"]'
    );
    if (pane) {
      const ph = pane.querySelector('.side-stage-placeholder--collision');
      if (ph) ph.remove();
    }
    _collisionStage = null;
  }

  function _syncFromState() {
    const router = window.stageRouter;
    if (!router || !router.isEnabled()) return;
    const s = router.getState();
    const wantMain = s.stage ? _findEmbed(s.stage, s.substage) : null;
    // 侧栏仅 >1150px 桌面才挂内容；窄屏 wantSide=null，下面 Phase 1 会把它 detach 清空
    let wantSide = (_isDesktopWide() && s.sideStage)
      ? _findEmbed(s.sideStage, s.sideSubstage)
      : null;
    // 主+侧指向同一份 reparent 单例（router 已允许 sideStage === mainStage）：
    // 同一个 DOM 节点不能两处 parent —— 主赢，侧渲染"正在主面板显示"占位
    const collided = !!(wantSide && wantSide === wantMain);
    if (collided) wantSide = null;
    // Phase 1：两侧先 detach（任一要变的槽），把单例 tile/chip 全部归还 origin
    if (attachedByPane.main && attachedByPane.main !== wantMain) _detach(attachedByPane.main, 'main');
    if (attachedByPane.side && attachedByPane.side !== wantSide) _detach(attachedByPane.side, 'side');
    // Phase 2：两侧再 attach（从 origin 重新抓，不会和对侧抢同一份单例）
    if (wantMain && attachedByPane.main !== wantMain) _attach(wantMain, 'main');
    if (wantSide && attachedByPane.side !== wantSide) _attach(wantSide, 'side');
    // Phase 3：占位维护（必须在 detach 之后，避免对应 pane 在 detach 时把占位带走）
    if (collided && _isDesktopWide() && s.sideStage) {
      _renderCollisionPlaceholder(s.sideStage);
    } else {
      _clearCollisionPlaceholder();
    }
  }

  function _onStageChanged() {
    _syncFromState();
  }

  function _boot() {
    if (!window.eventBus || !window.stageRouter) return;
    if (!window.stageRouter.isEnabled()) return;
    window.eventBus.on('stage:changed', _onStageChanged);
    window.eventBus.on('stage:mode-changed', _onStageChanged);
    window.eventBus.on('stage:substage-changed', _onStageChanged);
    window.eventBus.on('stage:side-changed', _onStageChanged);
    window.eventBus.on('stage:side-substage-changed', _onStageChanged);
    // 响应式：跨 1150 断点时重新同步
    window.addEventListener('resize', _onStageChanged);
    _syncFromState();
    console.log('[stageEmbed] booted (dual-pane)');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    setTimeout(_boot, 0);
  }

  window.stageEmbed = {
    refresh: _syncFromState,
    EMBEDS: EMBEDS,
    attachedByPane: attachedByPane, // 调试用
  };
})();
