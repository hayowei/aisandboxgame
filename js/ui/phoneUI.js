// js/ui/phoneUI.js
// 短信 / SMS —— 薄 shim（渲染层迁为 React 岛）。
//
// 视图渲染由 UI/sms 的 React 岛负责（dist/ui-islands/sms.js，挂在 #sms-root）。
// 本文件只保留：① root.render 挂载 ② 注入给岛的 bridge（data getter + actions）——
//   smsService / getContactInfo / getAllContacts 是 global lexical（不在 window），岛碰不到，
//   由本 shim（在 bundle 内可裸名访问）代理 ③ window.phoneUI.currentContact 镜像（smsService 同步读
//   判未读归属，见 smsService.js:131/304）④ SMS_UNREAD_UPDATED → 外部角标（stage-nav + 手机底栏）
//   ⑤ _liveRefresh 外部契约。
// 数据/语言/stage 切换的重渲染由岛内自身订阅（window.eventBus 真在 window）驱动，shim 不重复刷。

(function () {
  'use strict';

  const HOST_ID = 'sms-root';

  // ════════ React 岛挂载（单一持久 root）════════
  let _root = null;
  function ensureRoot() {
    const host = document.getElementById(HOST_ID);
    if (!host) return null;
    if (!window.ReactDOM || !window.ReactDOM.createRoot || !window.SMSUIIsland) return null;
    if (!_root || _root.__hostNode !== host) {
      _root = window.ReactDOM.createRoot(host);
      _root.__hostNode = host;
    }
    return _root;
  }
  function renderSms() {
    const root = ensureRoot();
    if (!root) return;
    root.render(window.SMSUIIsland.mount({ bridge: BRIDGE }));
  }

  // ════════ 副作用 ════════

  // 确认弹窗（危险操作统一）→ Promise<bool 已执行>
  function confirmDanger(copy, onOk) {
    const c = copy || {};
    return new Promise((resolve) => {
      const done = () => { try { onOk && onOk(); } catch (e) { console.error(e); } resolve(true); };
      if (typeof window.showConfirmModal === 'function') {
        window.showConfirmModal(c.title, c.text, done, () => resolve(false),
          { confirmTone: 'danger', confirmLabel: c.confirmLabel, cancelLabel: c.cancelLabel });
      } else { done(); }
    });
  }

  // 复制（临时 textarea + execCommand，与原 copyMessage 一致）
  function copyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text == null ? '' : String(text);
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  // 重生成的同步准备：定位用户消息 + 修 injectionStatus + 截断（与原 regenerateMessage 同步段一致）
  function prepareRegenerate(contactId, index) {
    const history = smsService.getConversation(contactId);
    if (index >= history.length) return { error: 'noUserMessage' };
    const msg = history[index];
    let userMessage, truncateFrom;
    if (msg.role === 'assistant') {
      let ui = index - 1;
      while (ui >= 0 && history[ui].role !== 'user') ui--;
      if (ui < 0) return { error: 'noUserMessage' };
      userMessage = history[ui].content;
      if (history[ui].injectionStatus === 'injected') { history[ui].injectionStatus = 'new'; delete history[ui].injectedAtTurn; }
      truncateFrom = index;
    } else {
      userMessage = msg.content;
      if (msg.injectionStatus === 'injected') { msg.injectionStatus = 'new'; delete msg.injectedAtTurn; }
      truncateFrom = index + 1;
    }
    smsService.truncateConversation(contactId, truncateFrom);
    return { userMessage };
  }

  // ════════ 注入给岛的 bridge ════════
  const BRIDGE = {
    data: {
      getContacts: () => (typeof smsService !== 'undefined' ? smsService.getContacts() : []) || [],
      getConversation: (id) => (typeof smsService !== 'undefined' ? smsService.getConversation(id) : []) || [],
      getContactInfo: (id) => (typeof getContactInfo === 'function' ? getContactInfo(id) : null),
      getAllContacts: () => (typeof getAllContacts === 'function' ? getAllContacts() : []) || [],
      getTotalUnread: () => (typeof smsService !== 'undefined' ? smsService.getTotalUnreadCount() : 0),
    },
    actions: {
      sendMessage: (cid, text) => smsService.sendMessage(cid, text),
      prepareRegenerate,
      regenerateReply: (cid, userMessage) => smsService.regenerateReply(cid, userMessage),
      editSave: (cid, index, value) => { smsService.updateMessage(cid, index, value); },
      copyMessage: (cid, index) => {
        const h = smsService.getConversation(cid) || [];
        if (index >= h.length) return false;
        return copyText(h[index].content);
      },
      deleteMessage: (cid, index, copy) => confirmDanger(copy, () => { smsService.deleteMessage(cid, index); }),
      deleteConversation: (cid, copy) => confirmDanger(copy, () => { smsService.deleteConversation(cid); }),
      clearHistory: (cid, copy) => confirmDanger(copy, () => { smsService.clearConversation(cid); }),
      markAsRead: (cid) => { if (typeof smsService !== 'undefined') smsService.markAsRead(cid); },
      setCurrentContact: (id) => { window.phoneUI.currentContact = id; },
      openDebug: () => { if (typeof window.openDebugModal === 'function') window.openDebugModal('sms'); },
      hasDebug: () => typeof window.openDebugModal === 'function',
      toast: (text) => { if (typeof showToast === 'function') showToast(text); },
    },
  };

  // ════════ 外部未读角标（stage-nav + 手机底栏）════════
  // 岛内 DOM 之外的角标，留在 shim 命令式更新；岛自身订阅 SMS_UNREAD_UPDATED 自刷列表/聊天。
  function handleSmsUnreadUpdate({ count }) {
    const badgeText = count > 99 ? '99+' : count;
    [
      document.getElementById('stage-nav-sms-badge'),
      document.querySelector('.stage-mobile-bar .stage-nav-btn[data-stage-target="sms"] .header-badge'),
    ].forEach((node) => {
      if (!node) return;
      if (count > 0) { node.textContent = badgeText; node.classList.remove('hidden'); }
      else { node.classList.add('hidden'); }
    });
  }

  // ════════ 外部契约：currentContact（smsService 同步读）+ _liveRefresh ════════
  window.phoneUI = {
    currentContact: null,
    _liveRefresh: () => renderSms(),
  };

  function init() {
    if (!document.getElementById(HOST_ID)) return;
    renderSms();
    if (window.eventBus && window.GameEvents && window.GameEvents.SMS_UNREAD_UPDATED) {
      window.eventBus.on(window.GameEvents.SMS_UNREAD_UPDATED, handleSmsUnreadUpdate);
      console.log('[PhoneUI] EventBus SMS_UNREAD_UPDATED 监听器已注册');
    }
    if (typeof smsService !== 'undefined') {
      handleSmsUnreadUpdate({ count: smsService.getTotalUnreadCount() });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }

  console.log('[PhoneUI] Initialized (React island shim)');
})();
