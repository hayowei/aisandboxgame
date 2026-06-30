// ============================================
// Director Tags UI（主对话「导演指令」tag 栏）
// ============================================
// 发言框上方的折叠条「Tags ▲」+ 向上弹出的浮层。浮层里 6 组单选 chip（来自
// js/config/directorTagSentinels.js 单一真源）。点 chip → 把句首那条内联 OOC 括号
// `【导演：加快 · 紧张】` 同步进发言框；发送即清。详见 内部设计文档。
//
// 关键不变式：
//   · 只在【剧情模式】可见——bar 挂 data-stage="story"，CSS 在设计模式隐藏；不渲染额外 gate。
//   · 浮层是 .director-tags-bar 的子元素（position:absolute 向上盖对话），【绝不进 .chat-messages-area】，
//     不碰滚动锁。
//   · 选中态只在本模块内存里；不写发言框。发送时 chatCore 调 getActiveCandidate() 读「导演：…」正文，
//     作为本回合 OOC 候选注入 → 不进历史/存档/缓存。发送后 chatCore 调 resetSelection() 清空。
(function () {
  const BAR_SELECTOR = '.director-tags-bar';
  const POPOVER_SELECTOR = '.director-tags-popover';

  // selection = { groupKey: optionValue }，每组至多一个；空 = 不指定该维。
  let selection = {};
  let _inited = false;

  function _cfg() { return (typeof window !== 'undefined' && window.DIRECTOR_TAG_SENTINELS) || null; }
  function _lang() { return window.i18nService?.getResolvedLanguage?.() || 'zh-CN'; }
  function _bar() { return document.querySelector(BAR_SELECTOR); }
  function _popover() { return document.querySelector(POPOVER_SELECTOR); }

  // ────── 折叠条开合（仿 avatarDropdown：.is-open + 外部点击 + ESC）──────
  function isOpen() { return _bar()?.classList.contains('is-open') === true; }
  function open() {
    const bar = _bar();
    if (!bar) return;
    bar.classList.add('is-open');
    _popover()?.setAttribute('aria-hidden', 'false');
    bar.querySelector('.director-tags-toggle')?.setAttribute('aria-expanded', 'true');
  }
  function close() {
    const bar = _bar();
    if (!bar) return;
    bar.classList.remove('is-open');
    _popover()?.setAttribute('aria-hidden', 'true');
    bar.querySelector('.director-tags-toggle')?.setAttribute('aria-expanded', 'false');
  }
  function toggle() { if (isOpen()) close(); else open(); }

  // ────── 渲染浮层内容（从 config，按当前语言）──────
  function render() {
    const cfg = _cfg();
    const pop = _popover();
    if (!cfg || !pop) return;
    const lang = _lang();
    const groupsHtml = cfg.groups.map(g => {
      const chips = g.options.map(o => {
        const active = selection[g.key] === o.value ? ' is-active' : '';
        const sel = selection[g.key] === o.value ? 'true' : 'false';
        return `<span class="tab director-tag-chip${active}" role="button" tabindex="0"`
          + ` data-group="${g.key}" data-value="${o.value}" aria-pressed="${sel}">`
          + `${_esc(cfg.pickLabel(o.label, lang))}</span>`;
      }).join('');
      return `<div class="director-group" data-group="${g.key}">`
        + `<span class="director-group-label">${_esc(cfg.pickLabel(g.label, lang))}</span>`
        + `<div class="tab-strip director-group-chips">${chips}</div>`
        + `</div>`;
    }).join('');
    pop.innerHTML = `<div class="director-tags-popover-inner">${groupsHtml}</div>`;
    _applyChrome(lang);
    _refreshToggleCount();
  }

  // 折叠条 / 浮层的非 chip 文案（标题、aria）按语言设置——chip 文案走 config，这里只管这几处外壳串。
  function _applyChrome(lang) {
    const bar = _bar();
    if (!bar) return;
    const lbl = lang === 'en' ? 'Director tags' : '导演指令';
    const t = bar.querySelector('.director-tags-toggle');
    if (t) { t.setAttribute('title', lbl); t.setAttribute('aria-label', lbl); }
    _popover()?.setAttribute('aria-label', lbl);
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // 折叠条上显示当前已选数量（让玩家收起时也知道有几条生效）。
  function _refreshToggleCount() {
    const bar = _bar();
    if (!bar) return;
    const n = Object.values(selection).filter(Boolean).length;
    const badge = bar.querySelector('.director-tags-count');
    if (badge) {
      badge.textContent = n > 0 ? String(n) : '';
      badge.classList.toggle('is-hidden', n === 0);
    }
    bar.classList.toggle('has-selection', n > 0);
  }

  // ────── 选中态 → 本回合 OOC 候选 ──────
  // chatCore 发送时调用：当前导演选择 → 「导演：加快 · 紧张」正文（无选择则空串）。
  // 不再往发言框写括号；这条会作为本回合 OOC 候选注入 oocCandidates。
  function getActiveCandidate() {
    const cfg = _cfg();
    if (!cfg || typeof cfg.buildDirectorBody !== 'function') return '';
    return cfg.buildDirectorBody(selection, _lang()) || '';
  }

  // ────── 点 chip：同组互斥 / 再点取消 ──────
  function onChipActivate(group, value) {
    if (!group || !value) return;
    if (selection[group] === value) delete selection[group]; // 再点取消，该组留空
    else selection[group] = value;
    render(); // 选中态只更新 UI（含计数徽标）；正文在发送时由 chatCore 取
  }

  // ────── 发送后清空（chatCore 在清输入框时调用）──────
  function resetSelection() {
    if (!Object.keys(selection).length) { _refreshToggleCount(); return; }
    selection = {};
    render();
    // 发言框此刻已被 chatCore 清空，无需再动；只重置 UI 选中态。
  }

  // ────── 初始化 ──────
  function init() {
    if (_inited) return;
    const bar = _bar();
    if (!bar) return; // DOM 不在（理论上 index.html 已静态放好）
    _inited = true;
    render();

    // 折叠条点击：toggle 浮层
    bar.addEventListener('click', e => {
      const toggleBtn = e.target.closest('.director-tags-toggle');
      if (toggleBtn) { e.stopPropagation(); toggle(); return; }
      const chip = e.target.closest('.director-tag-chip');
      if (chip) {
        e.stopPropagation();
        onChipActivate(chip.dataset.group, chip.dataset.value);
      }
    });
    // chip 键盘可达（Enter / Space）
    bar.addEventListener('keydown', e => {
      const chip = e.target.closest('.director-tag-chip');
      if (chip && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onChipActivate(chip.dataset.group, chip.dataset.value);
      }
    });

    // 点外部关闭
    document.addEventListener('click', e => {
      if (!isOpen()) return;
      if (bar.contains(e.target)) return;
      close();
    });
    // ESC 关闭
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen()) close();
    });
    // 语言切换重渲染 chip 文案
    window.addEventListener('ui-language-changed', render);

    console.log('[DirectorTagsUI] Initialized');
  }

  if (typeof window !== 'undefined') {
    window.directorTagsUI = { init, resetSelection, getActiveCandidate, isOpen, close };
  }
})();
