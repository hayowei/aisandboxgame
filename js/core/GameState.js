// js/core/GameState.js
// 核心游戏状态 - 集中管理
// 标量值（boolean/string/null）通过 Object.defineProperty 代理，赋值自动触发事件
// 引用值（数组）仅集中存储，不触发变更事件（因为 push/splice 不经过 setter）

const GameState = {
  // ===== 标量状态（可观察，setter 自动触发 state:xxx:changed 事件）=====
  _scalars: {
    currentSlotId: null, // 当前存档槽位 ID
    currentSaveBindingWorldCardId: null, // 当前会话绑定的存档归属世界卡 ID
    currentSessionOriginType: 'unsaved', // 当前会话来源: manual | unsaved
    currentSessionOriginWorldCardId: null, // 当前会话来源世界卡 ID
    currentSessionOriginSlotId: null, // 当前会话来源槽位 ID
    isSending: false, // 是否正在发送消息
    isDesignMode: false, // 世界卡状态
  },

  // ===== 引用状态（不可观察，仅集中管理）=====
  _refs: {
    chatHistory: [], // 聊天历史
    designChatHistory: [], // 世界卡聊天历史
  },

  get(key) {
    if (key in this._scalars) return this._scalars[key];
    if (key in this._refs) return this._refs[key];
  },

  set(key, value) {
    if (key in this._scalars) {
      const old = this._scalars[key];
      if (old === value) return;
      this._scalars[key] = value;
      if (window.eventBus) {
        eventBus.emit(`state:${key}:changed`, { key, old, value });
      }
    } else if (key in this._refs) {
      this._refs[key] = value;
    }
  },
};

// 标量值：Object.defineProperty 代理（setter 自动触发事件）
for (const key of Object.keys(GameState._scalars)) {
  Object.defineProperty(window, key, {
    get() {
      return GameState._scalars[key];
    },
    set(v) {
      GameState.set(key, v);
    },
    configurable: true,
  });
}

// 引用值（数组）：Object.defineProperty 代理（仅集中存储，整体赋值有效）
for (const key of Object.keys(GameState._refs)) {
  Object.defineProperty(window, key, {
    get() {
      return GameState._refs[key];
    },
    set(v) {
      GameState._refs[key] = v;
    },
    configurable: true,
  });
}

window.GameState = GameState;

console.log('[GameState] Initialized');
