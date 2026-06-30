// js/services/stageRouter.js
// 主舞台路由器 —— 管理"模式 + 舞台 + 侧栏舞台"双 pane 状态。
//
// 启用：永久开启（v3.4 P7 起 stage-router 是唯一布局）。
//
// 状态写入 #game-screen 上的 data-* 属性，CSS 据此切换 active pane：
//   data-active-mode:           game | design
//   data-active-stage:          主舞台当前 stage（mode 范围内 5 选 1）
//   data-active-substage:       主舞台当前 substage（仅 story / preview 有）
//   data-active-side-stage:     侧栏当前 stage（仅 >1150px 桌面，跟主 stage 不能相等）
//   data-active-side-substage:  侧栏当前 substage（独立于主舞台 substage）
//
// 事件（通过 window.eventBus.emit）：
//   stage:mode-changed        — mode 切换完成
//   stage:changed             — stage 切换完成（含 mode 切换时的连带）
//   stage:substage-changed    — 主 substage 切换
//   stage:side-changed        — 侧栏 sideStage 切换
//   stage:side-substage-changed — 侧栏 sideSubstage 切换

(function () {
  'use strict';

  const STAGES = Object.freeze({
    game: Object.freeze(['story', 'sms', 'cast', 'inventory', 'map']),
    // design mode 4 个 stage
    design: Object.freeze(['design', 'preview', 'saves', 'square']),
  });

  const DEFAULT_STAGE = Object.freeze({
    game: 'story',
    design: 'saves',
  });

  // 侧栏每个 mode 的默认 stage（plan 决策：游戏=物品 / 设计=预览）
  const DEFAULT_SIDE_STAGE = Object.freeze({
    game: 'inventory',
    design: 'preview',
  });

  // Sub-stages by stage（story 有 dialog/summary，preview 有 worldcard/card/code）
  const SUBSTAGES = Object.freeze({
    story: Object.freeze(['dialog', 'summary']),
    preview: Object.freeze(['worldcard', 'card', 'code']),
  });

  const DEFAULT_SUBSTAGE = Object.freeze({
    story: 'dialog',
    preview: 'worldcard',
  });

  // 侧栏专用 substage 默认（覆盖全局 DEFAULT_SUBSTAGE）：
  // story 在侧栏只能看 summary —— dialog（chat）是单例 DOM，已被主舞台占着，不能复制到侧栏
  const DEFAULT_SIDE_SUBSTAGE = Object.freeze({
    story: 'summary',
    preview: 'worldcard',
  });

  // localStorage 键
  const LS_SIDE_STAGE_PREFIX = 'stageRouter.sideStage.';      // .game / .design
  const LS_SIDE_SUBSTAGE_PREFIX = 'stageRouter.sideSubstage.'; // .story / .preview（侧栏视角）

  // 工具：找 target 属于哪个 mode（target 不在任何 mode 时返回 null）
  function _ownerModeOf(target) {
    for (const m of Object.keys(STAGES)) {
      if (STAGES[m].indexOf(target) !== -1) return m;
    }
    return null;
  }

  // 侧栏不允许的 stage（没有侧栏 tab 入口 / 没有 side pane 容器）：
  //   - game.story：侧栏只能显示 summary，tab 已从 side-stage-tabs--game 移除，残留 LS 值需忽略
  //   - design.design：剧情/设计对话依赖 .chat-messages-area 单例，没有 data-stage-pane-side="design"
  //     容器、也没有 EMBEDS 条目（finding #9）。残留 LS 'design' 会让侧栏指向一个渲染不出的 stage。
  const SIDE_STAGE_BLACKLIST = Object.freeze({ game: ['story'], design: ['design'] });

  // 访客提示（accountGate）未解锁时，#account-gate 仍在 DOM（解锁后 accountGate.reveal
  // 会 remove 它）。返回 true = 仍锁着。
  function _ownerGateLocked() {
    try { return !!document.getElementById('account-gate'); } catch (_) { return false; }
  }

  // 某 stage 能否进侧栏：静态黑名单 + account 动态门（finding #8）。
  // account 软门未解锁时不许进侧栏——否则 stageEmbed 把 #account-stage-host reparent 到侧栏后，
  // 主 pane 的 .stage-coming-soon 遮罩盖不到侧栏，未解锁用户能从侧栏看到真实账户内容、绕过软门。
  // 解锁后（gate 已 remove）恢复允许，保留 v3.7.10 的双 pane 账户特性。
  function _sideStageBlocked(mode, target) {
    if ((SIDE_STAGE_BLACKLIST[mode] || []).indexOf(target) !== -1) return true;
    if (target === 'account' && _ownerGateLocked()) return true;
    return false;
  }

  // localStorage 读写
  function _loadSideStage(mode) {
    try {
      const v = window.localStorage.getItem(LS_SIDE_STAGE_PREFIX + mode);
      if (!v || STAGES[mode].indexOf(v) === -1) return null;
      if (_sideStageBlocked(mode, v)) return null;
      return v;
    } catch (_) { return null; }
  }
  function _saveSideStage(mode, stage) {
    try { window.localStorage.setItem(LS_SIDE_STAGE_PREFIX + mode, stage); } catch (_) { /* noop */ }
  }
  function _loadSideSubstage(stage) {
    try {
      const v = window.localStorage.getItem(LS_SIDE_SUBSTAGE_PREFIX + stage);
      const allowed = SUBSTAGES[stage] || [];
      return v && allowed.indexOf(v) !== -1 ? v : null;
    } catch (_) { return null; }
  }
  function _saveSideSubstage(stage, substage) {
    try { window.localStorage.setItem(LS_SIDE_SUBSTAGE_PREFIX + stage, substage); } catch (_) { /* noop */ }
  }

  // 返回侧栏该 mode 该用的 stage（与主 stage 完全独立，可以相同——若是同一 reparent 单例
  // tile/host，由 stageEmbed 的去重守卫决定 main 赢、side 空）。
  // 优先级：localStorage 用户上次值 → mode 默认 → STAGES[mode][0]
  function _pickSideStageFor(mode) {
    const saved = _loadSideStage(mode); // 已过滤 blocked
    if (saved) return saved;
    const def = DEFAULT_SIDE_STAGE[mode];
    if (def && !_sideStageBlocked(mode, def)) return def;
    // 默认值被挡（理论上不会，DEFAULT_SIDE_STAGE 不指向 blocked stage）——退到第一个未被挡的
    for (const s of (STAGES[mode] || [])) {
      if (!_sideStageBlocked(mode, s)) return s;
    }
    return null;
  }

  // 给定 stage，返回侧栏 substage 默认值（localStorage > 侧栏专用默认 > 全局默认 > 第一个）
  function _pickSideSubstageFor(stage) {
    const allowed = SUBSTAGES[stage];
    if (!allowed || allowed.length === 0) return null;
    const saved = _loadSideSubstage(stage);
    if (saved) return saved;
    return DEFAULT_SIDE_SUBSTAGE[stage] || DEFAULT_SUBSTAGE[stage] || allowed[0];
  }

  // 永久启用（v3.4 P7 起）。disable() 仅作运行时调试用，不再有 URL/storage 回退。
  const state = {
    enabled: true,
    mode: 'game',
    stage: DEFAULT_STAGE.game,
    substage: DEFAULT_SUBSTAGE[DEFAULT_STAGE.game] || null,
    sideStage: null,    // 在 _bootHooks 里依据 mode 初始化
    sideSubstage: null, // 同上
  };

  // 兼容老 dev 痕迹：如果 localStorage 里残留 stageRouter.enabled='0' 强制 disable，清掉
  try {
    if (window.localStorage.getItem('stageRouter.enabled') === '0') {
      window.localStorage.removeItem('stageRouter.enabled');
    }
  } catch (_) { /* noop */ }

  function _emit(event, payload) {
    const bus = window.eventBus;
    if (bus && typeof bus.emit === 'function') bus.emit(event, payload);
  }

  function _apply() {
    if (!state.enabled) return;
    const root = document.getElementById('game-screen');
    if (root) {
      root.setAttribute('data-active-mode', state.mode);
      root.setAttribute('data-active-stage', state.stage);
      if (state.substage) root.setAttribute('data-active-substage', state.substage);
      else root.removeAttribute('data-active-substage');
      if (state.sideStage) root.setAttribute('data-active-side-stage', state.sideStage);
      else root.removeAttribute('data-active-side-stage');
      if (state.sideSubstage) root.setAttribute('data-active-side-substage', state.sideSubstage);
      else root.removeAttribute('data-active-side-substage');
    }
    if (document.body) {
      document.body.classList.add('stage-router-on');
      // 同步给 body —— 此前 system.css 里 ~54 条 `body[data-active-stage='design']`
      // 的 V9 composer pill / settled row / skeleton 样式因为 attr 写在 #game-screen 上
      // 一直没生效；这里同步过去激活它们（也方便后续 CSS 直接写 body 作用域）。
      document.body.dataset.activeMode = state.mode;
      document.body.dataset.activeStage = state.stage;
    }
    _updateNavActiveState();
    _updateSubstageNavActiveState();
  }

  function _updateNavActiveState() {
    // 主舞台 stage-nav 按钮（header + mobile-bar）：is-active = 主舞台当前
    const buttons = document.querySelectorAll('.stage-nav-btn[data-stage-target]');
    buttons.forEach(function (btn) {
      const target = btn.getAttribute('data-stage-target');
      btn.classList.toggle('is-active', target === state.stage);
      btn.setAttribute('aria-selected', target === state.stage ? 'true' : 'false');
    });
    // 侧栏 stage tab：is-active = sideStage。侧栏与主舞台独立，全格始终显示。
    const sideTabs = document.querySelectorAll('.side-stage-tab[data-side-stage-target]');
    sideTabs.forEach(function (tab) {
      const target = tab.getAttribute('data-side-stage-target');
      tab.classList.toggle('is-active', target === state.sideStage);
      tab.setAttribute('aria-selected', target === state.sideStage ? 'true' : 'false');
    });
  }

  function _updateSubstageNavActiveState() {
    // 主 substage nav
    document.querySelectorAll('[data-substage-target]').forEach(function (btn) {
      const isActive = btn.getAttribute('data-substage-target') === state.substage;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    // 侧栏 substage nav
    document.querySelectorAll('[data-side-substage-target]').forEach(function (btn) {
      const isActive = btn.getAttribute('data-side-substage-target') === state.sideSubstage;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function _log() {
    if (!state.enabled) return;
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[stageRouter]');
    console.log.apply(console, args);
  }

  function setMode(mode, options) {
    options = options || {};
    if (mode !== 'game' && mode !== 'design') return;
    if (state.mode === mode && !options.force) return;
    const prevMode = state.mode;
    const prevStage = state.stage;
    const prevSubstage = state.substage;
    const prevSideStage = state.sideStage;
    const prevSideSubstage = state.sideSubstage;
    state.mode = mode;
    state.stage = DEFAULT_STAGE[mode];
    state.substage = DEFAULT_SUBSTAGE[state.stage] || null;
    // 切 mode 时侧栏读取该 mode 的 localStorage 值（完全独立，不避开主 stage）
    state.sideStage = _pickSideStageFor(mode);
    state.sideSubstage = state.sideStage ? _pickSideSubstageFor(state.sideStage) : null;
    _log('mode:', prevMode, '→', mode, '| stage:', prevStage, '→', state.stage, '| sideStage:', prevSideStage, '→', state.sideStage);
    _apply();
    _emit('stage:mode-changed', { mode: state.mode, stage: state.stage, substage: state.substage });
    _emit('stage:changed', {
      mode: state.mode,
      stage: state.stage,
      substage: state.substage,
      prev: { mode: prevMode, stage: prevStage, substage: prevSubstage },
    });
    if (state.sideStage !== prevSideStage) {
      _emit('stage:side-changed', {
        mode: state.mode, sideStage: state.sideStage, sideSubstage: state.sideSubstage,
        prev: { sideStage: prevSideStage, sideSubstage: prevSideSubstage },
      });
    }
  }

  function setStage(stage, options) {
    options = options || {};
    const allowed = STAGES[state.mode] || [];
    if (allowed.indexOf(stage) === -1) {
      console.warn('[stageRouter] invalid stage', stage, 'for mode', state.mode);
      return;
    }
    if (state.stage === stage && !options.force) return;
    const prevStage = state.stage;
    const prevSubstage = state.substage;
    state.stage = stage;
    state.substage = DEFAULT_SUBSTAGE[stage] || null;
    // 侧栏与主舞台完全独立——不再因主切换而自动改 sideStage
    _log('stage:', prevStage, '→', stage);
    _apply();
    _emit('stage:changed', {
      mode: state.mode,
      stage: state.stage,
      substage: state.substage,
      prev: { mode: state.mode, stage: prevStage, substage: prevSubstage },
    });
  }

  function setSubstage(substage, options) {
    options = options || {};
    const allowed = SUBSTAGES[state.stage] || [];
    if (allowed.indexOf(substage) === -1) {
      console.warn('[stageRouter] invalid substage', substage, 'for stage', state.stage);
      return;
    }
    if (state.substage === substage && !options.force) return;
    const prev = state.substage;
    state.substage = substage;
    _log('substage:', prev, '→', substage);
    _apply();
    _emit('stage:substage-changed', { mode: state.mode, stage: state.stage, substage: state.substage, prevSubstage: prev });
  }

  // 设置侧栏 stage。返回 { ok, reason }：
  //   ok: true  → 切换成功（state 已更新）
  //   ok: false, reason: 'cross-mode' → target 不属于当前 mode（调用方决定是否 toast）
  //   ok: false, reason: 'invalid' / 'noop'
  //
  // 侧栏与主舞台完全独立，允许 sideStage === mainStage。若两槽都指向同一个
  // reparent 单例 tile/host，由 stageEmbed 去重守卫：main 赢、side 留空。
  function setSideStage(target, options) {
    options = options || {};
    if (!target) return { ok: false, reason: 'invalid' };
    const ownerMode = _ownerModeOf(target);
    if (ownerMode !== state.mode) return { ok: false, reason: 'cross-mode', ownerMode: ownerMode };
    // 黑名单 / account 软门：没有 side pane 容器的 stage（design）或未解锁的 account 一律拒进侧栏
    if (_sideStageBlocked(state.mode, target)) return { ok: false, reason: 'blocked' };
    if (state.sideStage === target && !options.force) return { ok: false, reason: 'noop' };
    const prevSide = state.sideStage;
    const prevSideSub = state.sideSubstage;
    state.sideStage = target;
    state.sideSubstage = _pickSideSubstageFor(target);
    _saveSideStage(state.mode, target);
    if (state.sideSubstage) _saveSideSubstage(target, state.sideSubstage);
    _log('sideStage:', prevSide, '→', target);
    _apply();
    _emit('stage:side-changed', {
      mode: state.mode, sideStage: state.sideStage, sideSubstage: state.sideSubstage,
      prev: { sideStage: prevSide, sideSubstage: prevSideSub },
    });
    return { ok: true };
  }

  function setSideSubstage(substage, options) {
    options = options || {};
    if (!state.sideStage) return;
    const allowed = SUBSTAGES[state.sideStage] || [];
    if (allowed.indexOf(substage) === -1) {
      console.warn('[stageRouter] invalid side substage', substage, 'for sideStage', state.sideStage);
      return;
    }
    if (state.sideSubstage === substage && !options.force) return;
    const prev = state.sideSubstage;
    state.sideSubstage = substage;
    _saveSideSubstage(state.sideStage, substage);
    _log('sideSubstage:', prev, '→', substage);
    _apply();
    _emit('stage:side-substage-changed', {
      mode: state.mode, sideStage: state.sideStage, sideSubstage: state.sideSubstage, prevSubstage: prev,
    });
  }

  function getState() {
    return {
      enabled: state.enabled,
      mode: state.mode,
      stage: state.stage,
      substage: state.substage,
      sideStage: state.sideStage,
      sideSubstage: state.sideSubstage,
    };
  }

  function isEnabled() { return state.enabled; }

  // P7: enable/disable 仅作运行时 dev 调试用（disable() 后页面刷新就回到 enabled）
  function enable() {
    if (state.enabled) return;
    state.enabled = true;
    _bootHooks();
  }

  function disable() {
    state.enabled = false;
    if (document.body) {
      document.body.classList.remove('stage-router-on');
      delete document.body.dataset.activeMode;
      delete document.body.dataset.activeStage;
    }
    const root = document.getElementById('game-screen');
    if (root) {
      root.removeAttribute('data-active-mode');
      root.removeAttribute('data-active-stage');
      root.removeAttribute('data-active-substage');
      root.removeAttribute('data-active-side-stage');
      root.removeAttribute('data-active-side-substage');
    }
  }

  // 跨 mode 时记录"等 mode 切完后再切的 stage"——靠 game.js 派发的 'mode-toggled' 事件消化
  let _pendingStageAfterMode = null;

  function _hookModeToggle() {
    const toggle = document.getElementById('mode-toggle');
    if (!toggle) return;
    const current = toggle.classList.contains('design-mode') ? 'design' : 'game';
    state.mode = current;
    state.stage = DEFAULT_STAGE[current];
    // 初始化 sideStage：读 localStorage（缺则 mode 默认）。与主舞台独立。
    state.sideStage = _pickSideStageFor(current);
    state.sideSubstage = state.sideStage ? _pickSideSubstageFor(state.sideStage) : null;

    // 事件驱动：监听 game.js 在 mode 真正切换完成时派发的 'mode-toggled'
    if (window.eventBus && typeof window.eventBus.on === 'function') {
      window.eventBus.on('mode-toggled', function (data) {
        const newMode = data && data.mode;
        if (newMode !== 'game' && newMode !== 'design') return;
        setMode(newMode);
        // mode 切换成功——消化跨 mode click 时记下的 pending stage target
        if (_pendingStageAfterMode) {
          const target = _pendingStageAfterMode;
          _pendingStageAfterMode = null;
          setStage(target);
        }
      });
    }
  }

  // 进入特定 stage 前的鉴权拦截：返回 false 表示拦截（不切 mode、不切 stage）
  // 当前所有 stage 都直接放行——square 在 stage 内部用 "coming soon" 蒙版替代登录提示
  function _gateStageEntry(_target) {
    return true;
  }

  function _hookStageNav() {
    // 用事件委托挂在 document.body：覆盖 header 那份 + body 末尾的 mobile-bar 那份
    document.body.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest && ev.target.closest('.stage-nav-btn[data-stage-target]');
      if (!btn) return;
      const target = btn.getAttribute('data-stage-target');
      if (!target) return;
      // 鉴权拦截（必须在 mode 切换之前——否则即使没进 stage 也已经把 mode 翻了）
      if (!_gateStageEntry(target)) return;
      // 自动判断 mode：如果 target 不属于当前 mode，先切 mode 再 setStage
      const owningMode = _ownerModeOf(target);
      if (owningMode && owningMode !== state.mode) {
        // 跨 mode 切换：把 stage target 记到 pending，由 'mode-toggled' 事件回调消化。
        // 如果 game.js 的 anti-pingpong 闸门拦下了这次 click，事件不会派发 → pending 也不消化 →
        // 静默放弃比错切 stage 安全。
        const toggle = document.getElementById('mode-toggle');
        if (toggle) {
          _pendingStageAfterMode = target;
          toggle.click();
          return;
        }
        // toggle 找不到时退路：直接 setMode + setStage
        setMode(owningMode);
      }
      setStage(target);
    });
  }

  function _hookSubstageNav() {
    // 主舞台 substage：[data-substage-target]
    // 侧栏 substage：[data-side-substage-target]（独立 path 避免冲突）
    document.body.addEventListener('click', function (ev) {
      const main = ev.target && ev.target.closest && ev.target.closest('[data-substage-target]');
      if (main) {
        const target = main.getAttribute('data-substage-target');
        if (target) setSubstage(target);
        return;
      }
      const side = ev.target && ev.target.closest && ev.target.closest('[data-side-substage-target]');
      if (side) {
        const target = side.getAttribute('data-side-substage-target');
        if (target) setSideSubstage(target);
      }
    });
  }

  function _hookSideStageNav() {
    // 侧栏顶部 tab strip 的 stage 切换：[data-side-stage-target] click → setSideStage
    document.body.addEventListener('click', function (ev) {
      const tab = ev.target && ev.target.closest && ev.target.closest('.side-stage-tab[data-side-stage-target]');
      if (!tab) return;
      const target = tab.getAttribute('data-side-stage-target');
      if (!target) return;
      setSideStage(target);
    });
  }

  function _bootHooks() {
    _hookModeToggle();
    _hookStageNav();
    _hookSubstageNav();
    _hookSideStageNav();
    _apply();
    _log('boot. mode =', state.mode, 'stage =', state.stage, 'substage =', state.substage,
         '| sideStage =', state.sideStage, 'sideSubstage =', state.sideSubstage);
  }

  function boot() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _bootHooks);
    } else {
      queueMicrotask(_bootHooks);
    }
  }

  if (state.enabled) boot();

  window.stageRouter = {
    setMode: setMode,
    setStage: setStage,
    setSubstage: setSubstage,
    setSideStage: setSideStage,
    setSideSubstage: setSideSubstage,
    getState: getState,
    isEnabled: isEnabled,
    enable: enable,
    disable: disable,
    STAGES: STAGES,
    DEFAULT_STAGE: DEFAULT_STAGE,
    DEFAULT_SIDE_STAGE: DEFAULT_SIDE_STAGE,
    SUBSTAGES: SUBSTAGES,
  };
})();
