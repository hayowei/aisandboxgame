// js/core/EventBus.js
// 事件总线 - 用于模块间解耦通信

class EventBus {
  constructor() {
    this._handlers = {};
  }

  /**
   * 订阅事件
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   * @param {Object} options - 选项 { once: boolean }
   * @returns {Function} 取消订阅函数
   */
  on(event, handler, options = {}) {
    if (!this._handlers[event]) {
      this._handlers[event] = [];
    }
    this._handlers[event].push({ handler, once: options.once });
    // 返回取消订阅函数
    return () => this.off(event, handler);
  }

  /**
   * 订阅一次性事件
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   * @returns {Function} 取消订阅函数
   */
  once(event, handler) {
    return this.on(event, handler, { once: true });
  }

  /**
   * 取消订阅事件
   * @param {string} event - 事件名称
   * @param {Function} handler - 事件处理函数
   */
  off(event, handler) {
    const handlers = this._handlers[event];
    if (handlers) {
      const idx = handlers.findIndex(h => h.handler === handler);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  }

  /**
   * 发射事件
   * @param {string} event - 事件名称
   * @param {*} payload - 事件数据
   */
  emit(event, payload) {
    const handlers = this._handlers[event] || [];
    const toRemove = [];
    handlers.forEach(({ handler, once }, idx) => {
      try {
        handler(payload);
      } catch (e) {
        console.error(`[EventBus] Error in handler for ${event}:`, e);
      }
      if (once) toRemove.push(idx);
    });
    // 移除一次性监听器
    toRemove.reverse().forEach(idx => handlers.splice(idx, 1));
  }

  /**
   * 清空所有事件监听器（用于测试或重置）
   */
  clear() {
    this._handlers = {};
  }

  /**
   * 获取事件监听器数量（用于调试）
   * @param {string} event - 事件名称
   * @returns {number}
   */
  listenerCount(event) {
    return (this._handlers[event] || []).length;
  }
}

// 全局单例
window.eventBus = new EventBus();

// 预定义事件类型（精简版 - 仅用于一对多广播）
window.GameEvents = {
  // AI 流程 - Step 级别事件
  AI_REACT_COMPLETE: 'ai:react:complete', // ReAct 完成（含 functionCalls）
  AI_NARRATIVE_DISPLAY: 'ai:narrative:display', // 叙事内容准备好显示（同步点）
  AI_NARRATIVE_STREAM: 'ai:narrative:stream', // 叙事文本流式增量（来自 tool args 流式解析）
  AI_NARRATIVE_COMPLETE: 'ai:narrative:complete', // 叙事完成信号
  AI_STEP3_COMPLETE: 'ai:step3:complete', // Step 3 完成（含 jsonData, narrativeText）
  AI_FIRST_CONTENT_DISPLAY: 'ai:first:content:display', // 叙事首次内容显示（用于用户等待计时器）
  AI_REACT_TOOL_CALL: 'ai:react:tool:call', // ReAct 循环中工具调用完成（含结果，实时广播）
  AI_STATE_PANEL_UPDATED: 'ai:state:panel:updated', // update_panel 工具执行后，面板字段变更广播
  TOOL_EXECUTED: 'tool:executed', // 任一工具成功执行后广播（含 name/args/result/phase/turnNumber）
  NARRATIVE_COMPLETE: 'narrative:complete', // update_narrative 专属完成 signal
  PANEL_COMPLETE: 'panel:complete', // update_panel 专属完成 signal
  CLOSING_COMPLETE: 'closing:complete', // update_choices 专属完成 signal
  AI_REACT_ITERATION_STREAM: 'ai:react:iteration:stream', // ReAct 迭代内流式 chunk（高频）
  AI_REACT_ITERATION_TEXT: 'ai:react:iteration:text', // ReAct 迭代完成的最终文本段

  // Settlement Skill Dispatcher 事件
  SETTLEMENT_DISPATCH_START: 'settlement:dispatch:start', // payload: { skills: [...] }
  SETTLEMENT_SKILL_COMPLETE: 'settlement:skill:complete', // payload: { skillName, result, duration }
  SETTLEMENT_DISPATCH_COMPLETE: 'settlement:dispatch:complete', // payload: { skills, completedTools, failedSkills, totalDuration }

  // AI 流程 - 整体事件
  AI_RESPONSE_COMPLETE: 'ai:response:complete', // 响应完成，4 个模块订阅
  AI_ERROR: 'ai:error', // 错误广播

  // SMS 事件
  SMS_UNREAD_UPDATED: 'sms:unread:updated', // 未读消息数变化

  // 游戏通知事件
  GAME_NOTIFICATION: 'game:notification', // payload: { type, text, timestamp }

  // 回滚事件
  ROLLBACK_TO_TURN: 'game:rollback:turn', // 重新生成时回滚到指定轮次

  // NPC 事件（从 npcStore._emit 迁移，共 11 个）
  NPC_ADDED: 'npc:added', // payload: { npcId, data, turn, uid, isUpdate }
  NPC_DELETED: 'npc:deleted', // payload: { npcId, npcName }
  NPC_UPDATED: 'npc:updated', // payload: { npcId, field, value, oldValue }
  NPC_REORDERED: 'npc:reordered', // payload: { newOrder }
  NPC_PENDING: 'npc:pending', // payload: { npcId, pendingInfo }
  NPC_PENDING_CLEARED: 'npc:pending:cleared', // payload: { npcId }
  NPC_APPROVED: 'npc:approved', // payload: { npcId, field, newValue, turn, uid }
  NPC_REJECTED: 'npc:rejected', // payload: { npcId, field, rejectedValue }
  NPC_SELECTED: 'npc:selected', // payload: { npcId, selected }
  NPC_CLEARED: 'npc:cleared', // payload: (none)
  NPC_RESTORED: 'npc:restored', // payload: { npcs, order }

  // NPC Reaction 事件
  AI_NPC_REACTIONS_COMPLETE: 'ai:npc_reactions:complete', // payload: { reactions }
  NPC_REACTIONS_ROLLED_BACK: 'npc:reactions:rolledback', // payload: { targetUID } —— npcReactionStore 完成 rollback 后发，npcStore 据此重建 state 层
  NPC_STATE_UPDATED: 'npc:state:updated', // payload: { npcId, state } —— state 层字段变更后通知 UI 刷新「动态」tab

  // 物品栏事件
  INVENTORY_CHANGED: 'inventory:changed', // payload: { items } - active+tombstone 落地变化
  INVENTORY_PENDING: 'inventory:pending', // payload: { pending } - pending 队列变化
  INVENTORY_RESTORED: 'inventory:restored', // payload: { items }

  // 地图事件
  MAP_PLAYER_MOVED: 'map:player:moved', // payload: { row, col, terrain, landmark, landmarkId, layer, source }
  MAP_ENTERED_LOCAL: 'map:entered:local', // payload: { landmarkId, siteName, source }
  MAP_RETURNED_WORLD: 'map:returned:world', // payload: { source }
  MAP_CROSSED_BORDER: 'map:crossed:border', // payload: { fromCountryId, toCountryId, countryName, source }
};

console.log('[EventBus] Initialized');
