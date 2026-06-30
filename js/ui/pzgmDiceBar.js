// PZGM 骰子条 —— 剧情模式三档骰子设置 + 🎲 显式检定入口。
//
// 只在 StoryEngineFlag.isPzgm() 为真（灰度开 + 引擎岛/控制器已加载）时注入进 .chat-input-area；
// flag 关时不存在 → 默认 UI 零变化。三档写 localStorage 'pzgm_dice_mode'（控制器 readDiceMode 读同键）：
//   always=每回合必掷 · ai=AI 决定（默认）· never=无骰（🎲 隐藏）。
// 🎲「这回合掷一次」→ pzgmStoryController.requestCheckNextTurn()（置位，下回合 options.playerRequestedCheck）。
//
// ≤768px 折叠样式：输入框左侧加 casino 开关（.pzgm-dice-toggle），骰子栏默认折叠（带高度过渡）；
//   展开/折叠态写 localStorage 'pzgm_dice_expanded'（默认折叠）。>768px 无开关、骰子栏恒显（CSS 媒体查询门控）。
//
// 顶层只暴露 window.PzgmDice 单一对象。颜色全走 design token（无硬编码）。

(function () {
  'use strict';
  const KEY = 'pzgm_dice_mode';
  const EXP_KEY = 'pzgm_dice_expanded'; // 骰子栏展开/折叠态（≤768px 折叠样式用；默认折叠）
  const MODES = [
    { id: 'always', zh: '每回合必掷', en: 'Always roll' },
    { id: 'ai', zh: 'AI 决定', en: 'AI decides' },
    { id: 'never', zh: '无骰', en: 'No dice' },
  ];

  function getMode() {
    try {
      const v = localStorage.getItem(KEY);
      return MODES.some((m) => m.id === v) ? v : 'ai';
    } catch (_) {
      return 'ai';
    }
  }
  function setMode(v) {
    try {
      if (MODES.some((m) => m.id === v)) localStorage.setItem(KEY, v);
    } catch (_) {}
    render();
  }
  // 展开/折叠态（持久化）：默认折叠（false）。仅 ≤768px 有视觉效果，>768px CSS 强制常显。
  function getExpanded() {
    try {
      return localStorage.getItem(EXP_KEY) === 'open';
    } catch (_) {
      return false;
    }
  }
  function setExpanded(v) {
    try {
      localStorage.setItem(EXP_KEY, v ? 'open' : 'closed');
    } catch (_) {}
  }
  function requestCheck() {
    try {
      window.pzgmStoryController?.requestCheckNextTurn?.();
    } catch (_) {}
  }

  function L(zh, en) {
    try {
      const lang = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
      return String(lang).startsWith('en') ? en : zh;
    } catch (_) {
      return zh;
    }
  }

  function injectStyleOnce() {
    if (document.getElementById('pzgm-dice-bar-style')) return;
    const s = document.createElement('style');
    s.id = 'pzgm-dice-bar-style';
    // 仅 var() token，无硬编码颜色
    s.textContent =
      '.pzgm-dice-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
      'padding:6px 10px;margin-bottom:6px;border:1px solid var(--border-soft);' +
      'border-radius:10px;background:var(--surface-elevated);font-size:12px;color:var(--text-soft);' +
      'overflow:hidden;transition:max-height .25s ease,opacity .2s ease,margin-bottom .25s ease,border-width .25s ease}' +
      '.pzgm-dice-bar .pdb-label{display:inline-flex;align-items:center;gap:4px}' +
      '.pzgm-dice-bar .pdb-chevron{display:none}' +
      '.pzgm-dice-seg{display:inline-flex;border:1px solid var(--border-soft);border-radius:8px;overflow:hidden}' +
      '.pzgm-dice-seg button{appearance:none;border:0;background:transparent;color:var(--text-soft);' +
      'padding:3px 10px;font-size:12px;cursor:pointer;transition:background .15s,color .15s}' +
      '.pzgm-dice-seg button[aria-pressed="true"]{background:var(--brand-primary);color:var(--text-invert)}' +
      '.pzgm-dice-roll{appearance:none;border:1px solid var(--border-medium);border-radius:8px;' +
      'background:transparent;color:var(--text-main);padding:3px 10px;font-size:12px;cursor:pointer}' +
      '.pzgm-dice-roll[aria-pressed="true"]{background:var(--brand-accent);color:var(--text-invert);border-color:var(--brand-accent)}' +
      // casino 折叠开关：输入框左侧的图标按钮，仅 ≤768px 显示（默认 display:none → >768px 不出现）。
      '.pzgm-dice-toggle{display:none;align-items:center;justify-content:center;flex:0 0 auto;' +
      'width:44px;min-height:44px;padding:0;border:1px solid var(--border-soft);border-radius:10px;' +
      'background:transparent;color:var(--text-soft);cursor:pointer;' +
      'transition:background .15s,color .15s,border-color .15s}' +
      '.pzgm-dice-toggle .material-symbols-outlined{font-size:22px}' +
      '.pzgm-dice-toggle.pdb-toggle-on{background:var(--brand-primary);color:var(--text-invert);border-color:transparent}' +
      // 设计模式（与剧情共用同一 .chat-input-area）任何宽度都不显示骰子栏/开关——骰子栏只属剧情(game)模式。
      // 与 render() 的 inDesign 守卫双保险：CSS 在 body[data-active-mode] 一变即生效，消除切模式时 setTimeout 重渲前的闪现。
      'body[data-active-mode="design"] .pzgm-dice-bar,' +
      'body[data-active-mode="design"] .pzgm-dice-toggle{display:none!important}' +
      // 桌面端（>768px）可折叠：标签「🎲 骰子」即开关，折叠时只剩它一颗 pill，seg + 「这回合掷一次」向右滑出收起；
      // chevron 指示展开方向（折叠 → 指右，展开 → 旋 180° 指左）。移动端（≤768px）不进此块，维持原 casino 开关 + 整条竖折叠。
      '@media (min-width:769px){' +
      '.pzgm-dice-bar .pdb-label{cursor:pointer}' +
      '.pzgm-dice-bar .pdb-label:hover{color:var(--text-main)}' +
      '.pzgm-dice-bar .pdb-chevron{display:inline-flex;font-size:16px;transition:transform .25s ease}' +
      '.pzgm-dice-bar:not(.pdb-collapsed) .pdb-chevron{transform:rotate(180deg)}' +
      '.pzgm-dice-bar .pzgm-dice-seg,.pzgm-dice-bar .pzgm-dice-roll{max-width:280px;opacity:1;overflow:hidden;white-space:nowrap;' +
      'transition:max-width .25s ease,opacity .2s ease,margin .2s ease,padding .2s ease,border-width .2s ease}' +
      '.pzgm-dice-bar.pdb-collapsed{gap:0;flex-wrap:nowrap}' +
      '.pzgm-dice-bar.pdb-collapsed .pzgm-dice-seg,.pzgm-dice-bar.pdb-collapsed .pzgm-dice-roll{' +
      'max-width:0;opacity:0;margin:0;padding:0;border-width:0}' +
      '}' +
      // ≤768px（项目手机断点）：骰子栏整条 width:100% 压在输入栏上方；casino 开关现身；骰子栏可折叠。
      // 折叠 = max-height/opacity/margin/border 过渡到 0（border-box，width:100% 不溢出）；
      // 过渡结束后 JS 补 pdb-hidden → display:none，彻底不占 flex 行（消除残留 row-gap）。
      // >768px 不进此块 → 无 max-height、无折叠、开关隐藏，骰子栏恒显（pdb-collapsed/pdb-hidden 无对应规则即失效）。
      '@media (max-width:768px){' +
      '.pzgm-dice-toggle{display:inline-flex}' +
      '.pzgm-dice-bar{width:100%;max-height:120px}' +
      '.pzgm-dice-bar.pdb-collapsed{max-height:0;margin-bottom:0;border-width:0;opacity:0}' +
      '.pzgm-dice-bar.pdb-hidden{display:none}' +
      '}' +
      // 481–768px：一排布局，tab 栏一律 flex:1 拉伸填满整行（ai 档 seg 撑开把 roll 顶到右端；非 ai 档铺到右边缘）。
      // 下界取 481 与 ≤480 的拆两行互斥——≤480 ai 档靠 width:100% 强制 seg 换行，不能被这里的 flex-basis:0 干扰到换行判定。
      '@media (min-width:481px) and (max-width:768px){' +
      '.pzgm-dice-seg{flex:1}' +
      '.pzgm-dice-seg button{flex:1}' +
      '}' +
      // ≤480px（项目最常用手机断点）：
      //   非 ai 档（无 roll 按钮）：一排，tab 栏 flex:1 拉伸到右边缘、与标签同处一行；
      //   ai 档（有 roll 按钮）：拆两行 → 行1 标签 + 掷一次(margin-left:auto 靠右)、行2 tab 栏 width:100% 铺满。
      '@media (max-width:480px){' +
      '.pzgm-dice-bar.pdb-no-roll .pzgm-dice-seg{flex:1}' +
      '.pzgm-dice-bar.pdb-no-roll .pzgm-dice-seg button{flex:1}' +
      '.pzgm-dice-bar:not(.pdb-no-roll) .pdb-label{order:1}' +
      '.pzgm-dice-bar:not(.pdb-no-roll) .pzgm-dice-roll{order:2;margin-left:auto}' +
      '.pzgm-dice-bar:not(.pdb-no-roll) .pzgm-dice-seg{order:3;width:100%}' +
      '.pzgm-dice-bar:not(.pdb-no-roll) .pzgm-dice-seg button{flex:1}' +
      '}';
    document.head.appendChild(s);
  }

  let _armed = false; // 🎲 已置位（视觉高亮，下回合消费）

  function buildBar() {
    injectStyleOnce();
    const bar = document.createElement('div');
    bar.className = 'pzgm-dice-bar';
    bar.id = 'pzgm-dice-bar';
    // 折叠动画结束后彻底隐藏，避免折叠态仍占一条 flex 行（残留 row-gap）。展开时由 toggleExpanded 先除 pdb-hidden。
    // e.target===bar 防子按钮 background/color 过渡冒泡误触；仅 max-height 收尾且仍处折叠态才隐藏（防快速来回切）。
    bar.addEventListener('transitionend', (e) => {
      if (e.target === bar && e.propertyName === 'max-height' && bar.classList.contains('pdb-collapsed')) {
        bar.classList.add('pdb-hidden');
      }
    });

    const label = document.createElement('span');
    label.className = 'pdb-label';
    label.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px">casino</span>' + L('骰子', 'Dice') + '<span class="material-symbols-outlined pdb-chevron">chevron_right</span>';
    // 桌面端（>768px）标签即折叠开关；移动端（≤768px）走左侧 casino 开关，标签不响应。
    label.addEventListener('click', () => {
      if (window.innerWidth <= 768) return;
      toggleExpanded();
    });
    bar.appendChild(label);

    const seg = document.createElement('div');
    seg.className = 'pzgm-dice-seg';
    for (const m of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.mode = m.id;
      b.textContent = L(m.zh, m.en);
      b.addEventListener('click', () => setMode(m.id));
      seg.appendChild(b);
    }
    bar.appendChild(seg);

    const roll = document.createElement('button');
    roll.type = 'button';
    roll.className = 'pzgm-dice-roll';
    roll.id = 'pzgm-dice-roll-btn';
    roll.innerHTML = '🎲 ' + L('这回合掷一次', 'Roll this turn');
    roll.addEventListener('click', () => {
      _armed = !_armed;
      try {
        window.pzgmStoryController?.requestCheckNextTurn?.(_armed);
      } catch (_) {}
      updateArmed();
    });
    bar.appendChild(roll);

    return bar;
  }

  // casino 折叠开关按钮（输入框左侧）。
  function buildToggle() {
    injectStyleOnce();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pzgm-dice-toggle';
    btn.id = 'pzgm-dice-toggle';
    btn.setAttribute('aria-label', L('骰子设置', 'Dice settings'));
    btn.innerHTML = '<span class="material-symbols-outlined">casino</span>';
    btn.addEventListener('click', toggleExpanded);
    return btn;
  }

  // 展开/折叠骰子栏（带高度过渡）。
  //   展开：先除 pdb-hidden 复位 display → 强制回流 → 除 pdb-collapsed 触发 0→max 过渡；
  //   折叠：加 pdb-collapsed 触发 max→0 过渡，结束后由 buildBar 的 transitionend 补 pdb-hidden。
  function toggleExpanded() {
    const next = !getExpanded();
    setExpanded(next);
    const toggle = document.getElementById('pzgm-dice-toggle');
    if (toggle) {
      toggle.classList.toggle('pdb-toggle-on', next);
      toggle.setAttribute('aria-pressed', next ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', next ? 'true' : 'false');
    }
    const bar = document.getElementById('pzgm-dice-bar');
    if (!bar) return;
    if (next) {
      bar.classList.remove('pdb-hidden');
      void bar.offsetHeight; // 强制回流，让随后的 0→max-height 过渡生效
      bar.classList.remove('pdb-collapsed');
    } else {
      bar.classList.add('pdb-collapsed');
    }
  }

  function updateArmed() {
    const roll = document.getElementById('pzgm-dice-roll-btn');
    if (roll) roll.setAttribute('aria-pressed', _armed ? 'true' : 'false');
  }

  function render() {
    // 骰子栏只属剧情（game）模式；设计模式共用同一 .chat-input-area，任何宽度都不该出现 → 当作未开，移除。
    const inDesign = document.body.dataset.activeMode === 'design';
    const on = !inDesign && !!window.StoryEngineFlag?.isPzgm?.();
    const existing = document.getElementById('pzgm-dice-bar');
    const existingToggle = document.getElementById('pzgm-dice-toggle');
    if (!on) {
      if (existing) existing.remove();
      if (existingToggle) existingToggle.remove();
      return;
    }
    const area = document.querySelector('.chat-input-area');
    if (!area) return;
    let bar = existing;
    if (!bar) {
      bar = buildBar();
      area.insertBefore(bar, area.firstChild);
    }
    // casino 折叠开关（输入框左侧，插在 textarea 之前）
    let toggle = existingToggle;
    if (!toggle) {
      toggle = buildToggle();
      const tb = area.querySelector('.chat-input-textbox');
      if (tb) area.insertBefore(toggle, tb);
      else area.appendChild(toggle);
    }
    // 同步展开/折叠态（非动画路径：初次加载 / 事件重渲直接落定，与持久化态一致，不触发过渡）
    const expanded = getExpanded();
    bar.classList.toggle('pdb-collapsed', !expanded);
    bar.classList.toggle('pdb-hidden', !expanded);
    toggle.classList.toggle('pdb-toggle-on', expanded);
    toggle.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    // 同步分档高亮
    const mode = getMode();
    bar.querySelectorAll('.pzgm-dice-seg button').forEach((b) => {
      b.setAttribute('aria-pressed', b.dataset.mode === mode ? 'true' : 'false');
    });
    // 「这回合掷一次」🎲 仅 ai 档显示（always 必掷=多余、never 无骰=无意义，任何宽度都隐藏）；
    // 非 ai 档标记 pdb-no-roll → 不拆行 + ≤768px 下 tab 栏 flex:1 拉伸填满（标签后铺到右边缘）
    const roll = bar.querySelector('#pzgm-dice-roll-btn');
    const showRoll = mode === 'ai';
    if (roll) roll.style.display = showRoll ? '' : 'none';
    bar.classList.toggle('pdb-no-roll', !showRoll);
    updateArmed();
  }

  // 进剧情/设计 stage 或翻 flag 后重渲；DOM 就绪后挂监听
  function hook() {
    try {
      window.eventBus?.on?.('mode-toggled', () => setTimeout(render, 100));
      window.eventBus?.on?.('stage:changed', () => setTimeout(render, 100));
      // 开新游戏 / 读档切换大脑 → StoryEngineFlag.set 派发 'story-engine:changed'。
      // 缺这条监听时：开局已把 flag 置 pzgm、isPzgm()=true，但无 mode/stage 事件触发 → render 永不调 → 骰子栏不出现。
      // 延迟 100ms 让 enterGame 先把游戏屏/剧情 stage 切上来再 render（与上面两条同款节流）。
      window.eventBus?.on?.('story-engine:changed', () => setTimeout(render, 100));
    } catch (_) {}
    render();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hook, { once: true });
  } else {
    hook();
  }

  window.PzgmDice = { getMode, setMode, requestCheck, render, getExpanded, setExpanded, toggleExpanded };
})();
