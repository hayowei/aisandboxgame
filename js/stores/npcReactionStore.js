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
