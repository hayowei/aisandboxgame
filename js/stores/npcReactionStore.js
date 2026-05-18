// ============================================
// NPC Reaction Store - NPC 自主决策数据存储层
// ============================================
// 按轮次存储每个 NPC 的独立决策（结构化 decision + 文本 fallback）
// 遵循 ServiceRegistry 约定：getSaveData() / restore(data) / clear()

const npcReactionStore = {
  // { turnUID: { npcId: { name: string, text: string, decision: Object|null } } }
  _reactions: {},

  // turnUID 顺序数组（用于按轮查询和回滚截断）
  _turnOrder: [],

  /**
   * 存储单个 NPC 的反应/决策
   * @param {string} turnUID
   * @param {string} npcId
   * @param {string} name
   * @param {string} text
   * @param {Object|null} [decision] - 结构化决策对象
   */
  addReaction(turnUID, npcId, name, text, decision) {
    if (!this._reactions[turnUID]) {
      this._reactions[turnUID] = {};
      this._turnOrder.push(turnUID);
    }
    const entry = { name, text };
    if (decision) entry.decision = decision;
    this._reactions[turnUID][npcId] = entry;
  },

  /**
   * 获取某轮所有 NPC 的反应
   */
  getReactions(turnUID) {
    return this._reactions[turnUID] || null;
  },

  /**
   * 获取最近 N 轮的所有反应（按时间顺序，旧→新）
   * @returns {Array<{ turnUID: string, reactions: { [npcId]: { name, text } } }>}
   */
  getRecentReactions(nTurns = 4) {
    const recent = this._turnOrder.slice(-nTurns);
    return recent.map(uid => ({
      turnUID: uid,
      reactions: this._reactions[uid] || {},
    }));
  },

  /**
   * 回滚：删除 targetUID 之后的所有反应
   * 使用 isUIDAfter 做时间序比较，与其他服务保持一致
   * 完成后增发 NPC_REACTIONS_ROLLED_BACK 事件，让 npcStore 重建 state 层
   */
  rollbackAfterUID(targetUID) {
    if (!targetUID) {
      const count = this._turnOrder.length;
      if (count > 0) {
        this.clear();
        console.log(`[npcReactionStore] 回滚: targetUID 为空，清除全部 ${count} 轮反应`);
      }
      this._emitRolledBack(targetUID);
      return;
    }

    const toRemove = [];
    const toKeep = [];
    for (const uid of this._turnOrder) {
      if (typeof isUIDAfter === 'function' && isUIDAfter(uid, targetUID)) {
        toRemove.push(uid);
      } else {
        toKeep.push(uid);
      }
    }

    if (toRemove.length > 0) {
      this._turnOrder = toKeep;
      for (const uid of toRemove) {
        delete this._reactions[uid];
      }
      console.log(`[npcReactionStore] 回滚: 移除 ${toRemove.length} 轮反应`);
    }
    this._emitRolledBack(targetUID);
  },

  _emitRolledBack(targetUID) {
    if (window.eventBus && window.GameEvents?.NPC_REACTIONS_ROLLED_BACK) {
      window.eventBus.emit(window.GameEvents.NPC_REACTIONS_ROLLED_BACK, { targetUID });
    }
  },

  /**
   * 获取全部 reactions（按 turnUID 时间顺序，旧→新）
   * 供 npcStore.rebuildStateFromReactions 使用
   */
  getAllReactions() {
    return this._turnOrder.map(uid => ({
      turnUID: uid,
      reactions: this._reactions[uid] || {},
    }));
  },

  // ==========================================
  // ServiceRegistry 接口
  // ==========================================

  getSaveData() {
    return {
      reactions: this._reactions,
      turnOrder: this._turnOrder,
    };
  },

  restore(data) {
    if (!data || typeof data !== 'object') {
      this.clear();
      return;
    }
    this._reactions =
      data.reactions && typeof data.reactions === 'object' ? { ...data.reactions } : {};
    this._turnOrder = Array.isArray(data.turnOrder)
      ? [...data.turnOrder]
      : Object.keys(this._reactions);
  },

  clear() {
    this._reactions = {};
    this._turnOrder = [];
  },
};

// 注册到服务中心
ServiceRegistry.register('npcReactionData', npcReactionStore);

window.npcReactionStore = npcReactionStore;

// EventBus 监听：回滚事件
if (window.eventBus && window.GameEvents) {
  window.eventBus.on(window.GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
    npcReactionStore.rollbackAfterUID(targetUID);
  });
  console.log('[npcReactionStore] EventBus 监听器已注册');
}
