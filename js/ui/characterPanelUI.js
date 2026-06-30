// js/ui/characterPanelUI.js
// 物品栏 —— 薄 shim（渲染层迁为 React 岛）。
//
// 视图渲染由 UI/inventory 的 React 岛负责（dist/ui-islands/inventory.js，挂在 #character-list）。
// 本文件只保留：① 把岛 root.render 进 host 的挂载逻辑 ② 注入给岛调用的 ACTIONS（真实副作用）
// ③ 公开 API characterPanelUI.render（兼容旧调用方，实为重渲染岛）。
//
// 数据/语言更新由岛内 useSyncExternalStore 监听 INVENTORY_CHANGED/PENDING/RESTORED + ui-language-changed
// 自动驱动，shim 不再订阅事件。数据源 = window.inventoryStore；图标 picker = window.inventoryIconPicker。

(function () {
  'use strict';

  const TILE_ID = 'character-tile';
  const LIST_ID = 'character-list';

  // ════════════════════════════════════════════════
  // React 岛挂载（单一持久 root，跨 stageEmbed reparent 存活）
  // ════════════════════════════════════════════════
  let _root = null;
  function ensureRoot() {
    const host = document.getElementById(LIST_ID);
    if (!host) return null;
    if (!window.ReactDOM || !window.ReactDOM.createRoot || !window.InventoryUIIsland) return null;
    // host 经 stageEmbed appendChild 在主/侧 pane 间"移动"而非重建 → root 跟节点活，一次创建复用。
    if (!_root || _root.__hostNode !== host) {
      _root = window.ReactDOM.createRoot(host);
      _root.__hostNode = host;
    }
    return _root;
  }
  function renderInventory() {
    const root = ensureRoot();
    if (!root) return;
    root.render(window.InventoryUIIsland.mount({ actions: ACTIONS }));
  }

  // ════════════════════════════════════════════════
  // 副作用（留在 shim，岛通过 ACTIONS 代理调用）
  // ════════════════════════════════════════════════

  // 消耗 / 丢弃：queueChange(-1) → 立即 approve → 给 AI 追加叙事上下文（与原 consumeOrDiscardItem 一致）
  function consumeOrDiscardItem(verb, itemName) {
    const store = window.inventoryStore;
    const ai = window.aiService;
    if (!store || !itemName) return;
    const turn = store.currentTurn || 0;
    const pending = store.queueChange({ name: itemName, delta: -1 }, turn, null);
    // queueChange 三种返回：pending / null（非法）/ { error: 'insufficient', ... }（库存不足）
    if (!pending || pending.error) return;
    store.approveChange(pending.id);
    if (typeof ai?.appendPlayerItemActionContext === 'function') {
      ai.appendPlayerItemActionContext({ verb, itemName, count: 1 });
    }
  }

  const ACTIONS = {
    consume: (name) => consumeOrDiscardItem('消耗', name),
    discard: (name) => consumeOrDiscardItem('随意丢弃', name),
    approveItem: (pid) => { if (pid && window.inventoryStore?.approveChange) window.inventoryStore.approveChange(pid); },
    approveAll: () => { window.inventoryStore?.approveAll?.(); },
    rejectAll: () => { window.inventoryStore?.rejectAll?.(); },
    openIconPicker: (name) => { if (name && window.inventoryIconPicker?.open) window.inventoryIconPicker.open(name); },
  };

  // ────── Init ──────
  function init() {
    if (!document.getElementById(TILE_ID)) return;
    renderInventory();
    // 数据/语言更新由岛内 useSyncExternalStore 自动驱动，shim 无需再订阅 INVENTORY_* / ui-language-changed。
  }

  // 公开 API（兼容旧 characterPanelUI.render 调用方；现等价于重渲染岛）
  window.characterPanelUI = { render: renderInventory };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    queueMicrotask(init);
  }

  console.log('[CharacterPanelUI] Initialized (React island shim)');
})();
