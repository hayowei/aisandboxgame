// js/ui/oocInputRow.js
// 「场外」输入行：打 /ooc 时主输入框自动分两行——上面这条收场外发言、下面 #chat-input 留给剧情动作。
// 回车一次两行一起发（发送逻辑在 chatCore.handleSendMessage 同时读两行）。仿 directorTagsUI 的自包含模块。
// 关键不变式：
//   · 只在剧情（游戏）模式触发；设计模式不分行（activate / 检测都 gate 掉）。
//   · 场外行是 .chat-input-area 内的一行（width:100% 占首行），不进 .chat-messages-area，不碰滚动锁。
//   · 触发两条路：① 斜杠菜单选 /ooc（slashCommandMenuUI 直接调 activate('')）② 手打 "/ooc " 前缀（本模块检测）。
//   · 场外内容只活在这条输入框里；发送时 chatCore 读 getValue() 作 OOC，发完 reset() 收回单行。
(function () {
  'use strict';

  const ROW_SELECTOR = '.ooc-input-row';
  const FIELD_SELECTOR = '.ooc-input-field';
  const INPUT_SELECTOR = '#chat-input';

  let _row = null, _field = null, _discard = null, _input = null, _inited = false;

  function _isDesignMode() {
    return typeof window.isDesignMode !== 'undefined' && window.isDesignMode === true;
  }
  function _isEn() { return window.i18nService?.getResolvedLanguage?.() === 'en'; }

  function isActive() {
    return !!_row && !_row.classList.contains('hidden');
  }
  function getValue() {
    return _field ? _field.value : '';
  }

  function _setPlaceholder() {
    if (!_field) return;
    _field.placeholder = _isEn() ? 'Out-of-character note to the AI…' : '对 AI 说一句场外话…';
    _field.setAttribute('aria-label', _isEn() ? 'Out-of-character note' : '场外发言');
  }

  // 显示场外行：text 预填；清空 #chat-input（把 "/ooc" 那截抹掉，留给剧情）；聚焦场外字段。
  function activate(text) {
    if (!_row || !_field || _isDesignMode()) return;
    _row.classList.remove('hidden');
    _field.value = text || '';
    if (_input) {
      _input.value = '';
      _input.dispatchEvent(new Event('input', { bubbles: true })); // 触发 autoresize + 收起斜杠菜单
    }
    _field.focus({ preventScroll: true });
    const end = _field.value.length;
    try { _field.setSelectionRange(end, end); } catch (_) { /* 某些环境不支持 */ }
  }

  // 收回单行：清空场外字段、隐藏行。
  function reset() {
    if (!_row || !_field) return;
    _field.value = '';
    _row.classList.add('hidden');
  }

  // 手打路径：#chat-input 变成 "/ooc <内容>"（带空格才算进参数）时自动分行。
  function _onChatInput(e) {
    if (e && e.isComposing) return; // 输入法 composing 中不触发
    if (!_input || _isDesignMode() || isActive()) return;
    const m = _input.value.match(/^\/ooc(\s)([\s\S]*)$/i);
    if (!m) return;
    activate((m[2] || '').replace(/^\s+/, ''));
  }

  function _onFieldKeydown(e) {
    if (e.isComposing || e.keyCode === 229) return; // 让输入法
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.querySelector('[data-action~="chat-send-btn"]')?.click(); // 回车=发送（两行一起）
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      _input?.focus({ preventScroll: true }); // Tab：跳到剧情行（跳过 × 按钮）
    } else if (e.key === 'Escape') {
      e.preventDefault();
      reset();
      _input?.focus({ preventScroll: true });
    }
  }

  function _onFieldInput(e) {
    if (e && e.isComposing) return; // 输入法 composing 中不收回（中文选字过程会短暂空）
    // 删空 → 自动收回单行，焦点回剧情行。
    if (_field && _field.value === '') {
      reset();
      _input?.focus({ preventScroll: true });
    }
  }

  function init() {
    if (_inited) return;
    _row = document.querySelector(ROW_SELECTOR);
    _field = _row ? _row.querySelector(FIELD_SELECTOR) : null;
    _discard = _row ? _row.querySelector('.ooc-input-discard') : null;
    _input = document.querySelector(INPUT_SELECTOR);
    if (!_row || !_field || !_input) {
      console.warn('[oocInputRow] DOM 未就位');
      return;
    }
    _inited = true;

    reset(); // 初始隐藏
    _setPlaceholder();

    _input.addEventListener('input', _onChatInput);
    _field.addEventListener('keydown', _onFieldKeydown);
    _field.addEventListener('input', _onFieldInput);
    _discard?.addEventListener('click', () => { reset(); _input?.focus({ preventScroll: true }); });
    window.addEventListener('ui-language-changed', _setPlaceholder);
    // 切 mode（游戏↔设计）时收回场外行——两 mode 共用同一输入区，不收会残留 stale 场外污染下条发送。
    window.eventBus?.on?.('mode-toggled', reset);
  }

  window.oocInputRow = { init, activate, getValue, isActive, reset };
})();
