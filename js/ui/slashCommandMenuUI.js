// js/ui/slashCommandMenuUI.js
// 斜杠命令弹出菜单：玩家在主聊天输入框打 `/` → 输入框上方弹出可选命令列表。
// 数据来自 window.slashCommands（注册表）。本文件只管「显示 + 键盘 + 定位」，不含命令逻辑。
// 弹层范式抄 avatarDropdownUI.js（挂 body 逃 stacking context、智能定位、点外/Esc 关）。
// 由 chatCore.initChatSystem() 调用 init()（确保在发送 keydown 绑定之后注册，键盘不打架）。
// 设计见 内部设计文档

(function () {
  'use strict';

  const MENU_ID = 'slash-command-menu';

  let _menu = null;      // 菜单 DOM
  let _input = null;     // #chat-input
  let _open = false;
  let _items = [];       // 当前过滤出的命令列表
  let _activeIndex = 0;
  let _inited = false;

  function isOpen() {
    return _open === true;
  }

  function _isDesignMode() {
    return typeof window.isDesignMode !== 'undefined' && window.isDesignMode === true;
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
    if (!_menu) return;
    const sc = window.slashCommands;
    if (!sc) return;
    _menu.innerHTML = _items
      .map((cmd, i) => {
        const active = i === _activeIndex ? ' is-active' : '';
        const name = escapeHtml(sc.label(cmd));
        const d = escapeHtml(sc.desc(cmd));
        return `
          <div class="slash-command-item${active}" role="option" data-index="${i}"
               aria-selected="${i === _activeIndex ? 'true' : 'false'}">
            <span class="material-symbols-outlined slash-command-icon">${escapeHtml(cmd.icon)}</span>
            <span class="slash-command-text">
              <span class="slash-command-name">${name}</span>
              ${d ? `<span class="slash-command-desc">${d}</span>` : ''}
            </span>
          </div>`;
      })
      .join('');
  }

  // ────── 定位（锚在输入框上方）──────
  function position() {
    if (!_menu || !_input) return;
    const r = _input.getBoundingClientRect();
    // 菜单从输入框上沿向上长。封顶到"输入框上方可用空间"（菜单自带 overflow-y 滚动），
    // 防止条目太多时顶部跑出屏幕外、够不到（短屏 / 横屏 / 键盘弹起时尤甚）。
    const spaceAbove = Math.max(120, Math.round(r.top - 8));
    _menu.style.left = `${Math.round(r.left)}px`;
    _menu.style.width = `${Math.round(r.width)}px`;
    _menu.style.maxHeight = `${Math.min(320, spaceAbove)}px`;
    _menu.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
    _menu.style.top = 'auto';
  }

  // ────── 开 / 关 ──────
  function show() {
    if (!_menu) return;
    _open = true;
    render();
    position();
    _menu.classList.add('is-open');
    _menu.setAttribute('aria-hidden', 'false');
  }

  function hide() {
    if (!_menu) return;
    _open = false;
    _menu.classList.remove('is-open');
    _menu.setAttribute('aria-hidden', 'true');
  }

  // ────── 输入监听：决定是否显示 + 过滤 ──────
  function _onInput() {
    if (!_input) return;
    if (_isDesignMode()) { hide(); return; }
    const value = _input.value;
    // 斜杠 + 命令 token（尚未打空格进参数）：/^\/(\S*)$/
    const m = value.match(/^\/(\S*)$/);
    if (!m) { hide(); return; }
    const token = m[1];
    const matches = window.slashCommands?.match?.(token) || [];
    if (!matches.length) { hide(); return; }
    _items = matches;
    _activeIndex = 0;
    show();
  }

  // ────── 键盘（菜单开时接管 ↑↓ / Enter / Tab / Esc）──────
  function _onKeydown(e) {
    if (!_open) return;
    // 输入法 composing 期间让路（与 chatCore 发送 keydown 一致）：不抢 IME 的方向键/回车
    if (e.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        _activeIndex = (_activeIndex + 1) % _items.length;
        render();
        _scrollActiveIntoView();
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        _activeIndex = (_activeIndex - 1 + _items.length) % _items.length;
        render();
        _scrollActiveIntoView();
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        _select(_activeIndex);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation(); // 完全吃掉这次 Esc，不连带触发其它文档级 Esc 监听
        hide();
        break;
      default:
        break;
    }
  }

  function _scrollActiveIntoView() {
    const el = _menu?.querySelector('.slash-command-item.is-active');
    // 菜单自身是独立滚动容器（非 .chat-messages-area），不违反主聊天区滚动锁
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }

  // ────── 选中一条命令 ──────
  function _select(index) {
    const cmd = _items[index];
    if (!cmd || !_input) return;
    hide();
    // /ooc 特例：不往输入框插 "/ooc "，而是直接把输入框分两行（上场外、下剧情）。
    // 避免插入文本后再被 oocInputRow 检测/抢焦点。
    if (cmd.trigger === 'ooc' && window.oocInputRow?.activate) {
      // 已经分行了就保留已输入的场外内容，别用 '' 把它清掉（在剧情行重新选 /ooc 时）
      const keep = window.oocInputRow.isActive?.() ? (window.oocInputRow.getValue?.() || '') : '';
      window.oocInputRow.activate(keep);
      return;
    }
    // 带参命令，或既不带参也不自动执行的命令：只把命令补全进输入框，等玩家继续打/发送
    if (cmd.takesArgs || !cmd.runOnSelect) {
      _input.value = `/${cmd.trigger} `;
      _input.dispatchEvent(new Event('input', { bubbles: true })); // 触发自动高度 + 本菜单 _onInput（含空格→收起）
      _input.focus({ preventScroll: true });
      // 光标移到末尾
      const end = _input.value.length;
      try { _input.setSelectionRange(end, end); } catch (_) { /* 某些环境不支持 */ }
      return;
    }
    // runOnSelect 无参命令（meta）：清空输入框（含残留选项 payload，避免污染下一条）后直接执行
    _input.value = '';
    if (_input.dataset) {
      delete _input.dataset.designP1Display;
      delete _input.dataset.selectedChoicePayload;
      delete _input.dataset.selectedChoiceText;
    }
    _input.dispatchEvent(new Event('input', { bubbles: true }));
    try { cmd.run('', {}); } catch (err) { console.warn('[slashCommandMenu] run 出错:', cmd.trigger, err); }
  }

  // ────── 初始化（由 chatCore.initChatSystem 调用）──────
  function init() {
    if (_inited) return;
    _input = document.getElementById('chat-input') || document.querySelector('.chat-input-textbox');
    if (!_input) {
      console.warn('[slashCommandMenu] 未找到 #chat-input');
      return;
    }

    // 建菜单 DOM，挂 body 末尾逃出输入区的 stacking / overflow
    _menu = document.getElementById(MENU_ID);
    if (!_menu) {
      _menu = document.createElement('div');
      _menu.id = MENU_ID;
      _menu.className = 'slash-command-menu';
      _menu.setAttribute('role', 'listbox');
      _menu.setAttribute('aria-hidden', 'true');
      document.body.appendChild(_menu);
    }

    _input.addEventListener('input', _onInput);
    // keydown 在 chatCore 的发送 keydown 之后注册（init 调用点保证顺序）：
    // 发送 handler 顶部有 `if (slashCommandMenu.isOpen()) return`，菜单开时让路，本 handler 接管。
    _input.addEventListener('keydown', _onKeydown);

    // 菜单内点击：用 mousedown + preventDefault 留住输入框焦点，再 _select
    _menu.addEventListener('mousedown', e => {
      const item = e.target.closest('.slash-command-item');
      if (!item) return;
      e.preventDefault();
      const idx = parseInt(item.getAttribute('data-index'), 10);
      if (!Number.isNaN(idx)) _select(idx);
    });

    // 点击输入框 / 菜单之外 → 关闭
    document.addEventListener('mousedown', e => {
      if (!_open) return;
      const t = e.target;
      if (t === _input || (_menu && _menu.contains(t))) return;
      hide();
    });

    // 视口变化时重定位
    window.addEventListener('resize', () => { if (_open) position(); });
    window.addEventListener('scroll', () => { if (_open) position(); }, true);
    // 软键盘弹起/收起会改变 visualViewport 和输入框位置——跟着重定位 + 重新封顶高度
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => { if (_open) position(); });
      window.visualViewport.addEventListener('scroll', () => { if (_open) position(); });
    }

    // 语言切换：开着就重渲染（标签 zh/en 随之变）
    window.addEventListener('ui-language-changed', () => { if (_open) render(); });

    _inited = true;
  }

  window.slashCommandMenu = { init, isOpen, hide };
})();
