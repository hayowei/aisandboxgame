// ============================================
// SMS Service - 短信服务
// ============================================

// 依赖: aiService (来自 aiService.js), [Fixed]sms_prompt.js, character_database.js

class SMSService {
  constructor() {
    // 每个联系人的短信历史
    // 格式: { contactId: [{role: 'user'|'assistant', content: string, timestamp: number}] }
    this.conversations = {};

    // 未读消息计数 { contactId: number }
    this.unreadCounts = {};
  }

  // 获取所有联系人(预定义角色 + 临时角色)
  getContacts() {
    // 使用 getAllContacts() 获取所有联系人(来自 [Fixed]sms_prompt.js)
    const allContacts = getAllContacts();

    return allContacts.map(contact => ({
      ...contact,
      lastMessage: this.getLastMessage(contact.id),
      messageCount: (this.conversations[contact.id] || []).length,
      unreadCount: this.unreadCounts[contact.id] || 0,
    }));
  }

  // 获取总未读消息数
  getTotalUnreadCount() {
    return Object.values(this.unreadCounts).reduce((sum, count) => sum + count, 0);
  }

  // 标记某个联系人的消息为已读
  markAsRead(contactId) {
    if (this.unreadCounts[contactId]) {
      this.unreadCounts[contactId] = 0;
      this.updateBadge();
    }
  }

  // 更新红点显示(通过 EventBus 通知 UI)
  updateBadge() {
    const total = this.getTotalUnreadCount();

    // 发射全局 EventBus 事件，让 phoneUI 统一处理徽章更新
    if (window.eventBus && window.GameEvents) {
      window.eventBus.emit(window.GameEvents.SMS_UNREAD_UPDATED, { count: total });
    }
  }

  // 获取某个联系人的最后一条消息
  getLastMessage(contactId) {
    const history = this.conversations[contactId];
    if (!history || history.length === 0) {
      return null;
    }
    return history[history.length - 1];
  }

  // 获取某个联系人的短信历史
  getConversation(contactId) {
    return this.conversations[contactId] || [];
  }

  // 获取当前主聊天的 UID（用于回滚追踪）
  _getCurrentTurnUID() {
    if (typeof chatHistory !== 'undefined') {
      const lastAi = [...chatHistory].reverse().find(m => m.sender === 'ai');
      return lastAi?.uid || null;
    }
    return null;
  }

  // 发送短信并获取回复
  async sendMessage(contactId, message) {
    // 初始化对话历史
    if (!this.conversations[contactId]) {
      this.conversations[contactId] = [];
    }

    // 获取当前 UID（用于回滚追踪）
    const currentUID = this._getCurrentTurnUID();

    // 添加用户消息
    const userMsg = {
      role: 'user',
      content: message,
      timestamp: Date.now(),
      gameTime: this._getCurrentGameTime(), // 保存发送时的游戏时间
      injectionStatus: 'new', // 新消息状态，等待注入主聊天
      createdAtUID: currentUID, // 记录创建时的主聊天 UID（用于回滚）
    };
    this.conversations[contactId].push(userMsg);

    try {
      // 获取历史记录(用于 API 调用，包含时间和关系信息)
      const historyForAPI = this.conversations[contactId]
        .slice(0, -1) // 排除刚添加的消息
        .map(m => ({
          role: m.role,
          content: m.content,
          gameTime: m.gameTime,
          relationship: m.relationship,
        }));

      // 调用 AI 生成回复(现在返回对象 {location, cognitive_state, relationship, message, raw})
      const reply = await aiService.generateSMSReply(contactId, message, historyForAPI);

      // 临时角色的认知状态强制从 NPC 档案同步
      const finalCognitiveState = this._getForcedCognitiveState(contactId) || reply.cognitive_state;

      // 添加 AI 回复
      const assistantMsg = {
        role: 'assistant',
        content: reply.message, // 只显示短信内容
        timestamp: Date.now(),
        gameTime: this._getCurrentGameTime(),
        // 保存 AI 推断的额外信息(用于调试和存档)
        location: reply.location,
        cognitive_state: finalCognitiveState, // 临时角色强制同步 NPC 档案
        relationship: reply.relationship, // 保存当前关系
        raw: reply.raw,
        injectionStatus: 'new', // 新消息状态，等待注入主聊天
        createdAtUID: currentUID, // 记录创建时的主聊天 UID（用于回滚）
      };
      this.conversations[contactId].push(assistantMsg);

      // 增加未读计数(如果用户不在当前聊天界面)
      if (!window.phoneUI || window.phoneUI.currentContact !== contactId) {
        this.unreadCounts[contactId] = (this.unreadCounts[contactId] || 0) + 1;
        this.updateBadge();
      }

      return assistantMsg;
    } catch (error) {
      console.error('SMS reply generation failed:', error);
      // 回滚:移除发送失败的用户消息
      const history = this.conversations[contactId];
      if (history && history.length > 0) {
        const lastMsg = history[history.length - 1];
        if (lastMsg && lastMsg.role === 'user' && lastMsg.content === message) {
          history.pop();
        }
      }
      throw error;
    }
  }

  // 清空某个联系人的对话
  clearConversation(contactId) {
    this.conversations[contactId] = [];
  }

  // 清空所有对话和未读计数
  clearAll() {
    this.conversations = {};
    this.unreadCounts = {};
    this.updateBadge();
  }

  // 获取所有对话数据(用于存档)，清洗掉仅调试用的字段(raw/location/cognitive_state)
  getSaveData() {
    const cleanedConversations = {};
    for (const contactId in this.conversations) {
      cleanedConversations[contactId] = this.conversations[contactId].map(msg => {
        const cleaned = {
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          gameTime: msg.gameTime,
        };
        if (msg.relationship) cleaned.relationship = msg.relationship;
        if (msg.injectionStatus) cleaned.injectionStatus = msg.injectionStatus;
        if (msg.createdAtUID) cleaned.createdAtUID = msg.createdAtUID;
        if (msg.isEventDriven) cleaned.isEventDriven = true;
        return cleaned;
      });
    }
    return {
      conversations: cleanedConversations,
      unreadCounts: this.unreadCounts,
    };
  }

  // 从存档恢复
  restore(saveData) {
    this.clearAll();

    const source = saveData && typeof saveData === 'object' ? saveData : null;
    if (!source) {
      return;
    }

    if (source.conversations && typeof source.conversations === 'object') {
      const restoredConversations = {};
      for (const [contactId, messages] of Object.entries(source.conversations)) {
        restoredConversations[contactId] = Array.isArray(messages)
          ? messages.map(msg => ({ ...msg }))
          : [];
      }
      this.conversations = restoredConversations;
    }

    if (source.unreadCounts && typeof source.unreadCounts === 'object') {
      this.unreadCounts = { ...source.unreadCounts };
    }

    this.updateBadge();
  }

  // ============================================
  // 消息操作方法(封装内部数据操作)
  // ============================================

  // 删除指定消息
  deleteMessage(contactId, index) {
    const history = this.conversations[contactId];
    if (history && index >= 0 && index < history.length) {
      history.splice(index, 1);
      return true;
    }
    return false;
  }

  // 更新指定消息内容
  updateMessage(contactId, index, newContent) {
    const history = this.conversations[contactId];
    if (history && index >= 0 && index < history.length) {
      history[index].content = newContent;
      // 如果消息已被注入，重置为 new 让主聊天能看到修改后的内容
      if (history[index].injectionStatus === 'injected') {
        history[index].injectionStatus = 'new';
        delete history[index].injectedAtTurn;
      }
      return true;
    }
    return false;
  }

  // 截断对话(从指定位置删除到末尾)
  truncateConversation(contactId, fromIndex) {
    const history = this.conversations[contactId];
    if (history && fromIndex >= 0 && fromIndex <= history.length) {
      history.splice(fromIndex);
      return true;
    }
    return false;
  }

  // 删除整个对话(包括未读计数)
  deleteConversation(contactId) {
    this.conversations[contactId] = [];
    this.unreadCounts[contactId] = 0;
    this.updateBadge();
  }

  // 重新生成 AI 回复(不重复添加用户消息)
  // @param {string} contactId - 联系人ID
  // @param {string} userMessage - 用户消息内容
  // @returns {Promise<object>} AI 回复消息对象
  async regenerateReply(contactId, userMessage) {
    // 确保对话存在
    if (!this.conversations[contactId]) {
      this.conversations[contactId] = [];
    }

    // 获取当前 UID（用于回滚追踪）
    const currentUID = this._getCurrentTurnUID();

    try {
      // 获取当前历史记录用于 API 调用
      const historyForAPI = this.conversations[contactId].map(m => ({
        role: m.role,
        content: m.content,
        gameTime: m.gameTime,
        relationship: m.relationship,
      }));

      // 调用 AI 生成回复(现在返回对象 {location, cognitive_state, relationship, message, raw})
      const reply = await aiService.generateSMSReply(contactId, userMessage, historyForAPI);

      // 临时角色的认知状态强制从 NPC 档案同步
      const finalCognitiveState = this._getForcedCognitiveState(contactId) || reply.cognitive_state;

      // 添加 AI 回复
      const assistantMsg = {
        role: 'assistant',
        content: reply.message, // 只显示短信内容
        timestamp: Date.now(),
        gameTime: this._getCurrentGameTime(),
        // 保存 AI 推断的额外信息(用于调试和存档)
        location: reply.location,
        cognitive_state: finalCognitiveState, // 临时角色强制同步 NPC 档案
        relationship: reply.relationship, // 保存当前关系
        raw: reply.raw,
        injectionStatus: 'new', // 新消息状态，等待注入主聊天
        createdAtUID: currentUID, // 记录创建时的主聊天 UID（用于回滚）
      };
      this.conversations[contactId].push(assistantMsg);

      // 增加未读计数(如果用户不在当前聊天界面)
      if (!window.phoneUI || window.phoneUI.currentContact !== contactId) {
        this.unreadCounts[contactId] = (this.unreadCounts[contactId] || 0) + 1;
        this.updateBadge();
      }

      return assistantMsg;
    } catch (error) {
      console.error('SMS regenerate failed:', error);
      throw error;
    }
  }

  // 获取当前游戏时间(直接使用 timelineService)
  _getCurrentGameTime() {
    if (typeof timelineService !== 'undefined') {
      return timelineService.getCurrentDate();
    }
    return null;
  }

  // 获取临时角色的强制认知状态(从 NPC 档案同步)
  // 如果是临时角色，返回 NPC 档案的 cognitive_state;否则返回 null(使用 AI 的判断)
  _getForcedCognitiveState(contactId) {
    // 预定义角色不强制(由 AI 根据时间线判断)
    if (typeof AnalyzerManager !== 'undefined' && AnalyzerManager.hasCharacter(contactId)) {
      return null;
    }

    // 临时角色:强制使用 NPC 档案的 cognitive_state（card 域）
    if (typeof npcStore !== 'undefined') {
      const v = npcStore.getFieldValue?.(contactId, 'cognitive_state');
      if (v != null) return v || '未知';
    }

    return null;
  }

  // ============================================
  // 主聊天注入相关方法
  // ============================================

  /**
   * 获取所有 new 状态的消息(用于注入主聊天)
   * @returns {Object} 按联系人分组的新消息 { contactId: [{ role, content, contactName, ... }] }
   */
  getNewMessages() {
    const result = {};

    for (const contactId in this.conversations) {
      const history = this.conversations[contactId];
      const newMessages = history.filter(msg => msg.injectionStatus === 'new');

      if (newMessages.length > 0) {
        // 获取联系人名称
        const contact = getContactInfo(contactId);
        const contactName = contact?.name || contactId;

        result[contactId] = newMessages.map(msg => ({
          ...msg,
          contactName: contactName,
        }));
      }
    }

    return result;
  }

  /**
   * 将所有 new 状态的消息标记为 injected
   * 在主聊天成功注入后调用
   * @param {string|number} turnRef - 当前主聊天的 UID 或 turn number，用于回滚时精确控制
   */
  markAllNewAsInjected(turnRef = null) {
    let count = 0;

    // 检测参数类型：字符串为 UID，数字为 turn number
    const isUID = typeof turnRef === 'string' && turnRef.startsWith('turn_');

    for (const contactId in this.conversations) {
      const history = this.conversations[contactId];
      for (const msg of history) {
        if (msg.injectionStatus === 'new') {
          msg.injectionStatus = 'injected';
          // 根据参数类型存储不同的字段
          if (turnRef !== null) {
            if (isUID) {
              msg.injectedAtUID = turnRef;
            } else {
              msg.injectedAtTurn = turnRef; // 兼容旧调用方式
            }
          }
          count++;
        }
      }
    }

    if (count > 0) {
      const label = isUID ? `UID: ${turnRef}` : `Turn ${turnRef}`;
      console.log(`[SMSService] 已将 ${count} 条消息标记为 injected (${label})`);
    }

    return count;
  }

  /**
   * 回滚注入状态:将指定 Turn 及之后注入的消息重置为 new
   * 在主聊天重新生成时调用（兼容旧版 turnNumber）
   * @param {number} turnNumber - 从该轮次开始回滚
   */
  rollbackInjectionStatus(turnNumber) {
    let count = 0;

    for (const contactId in this.conversations) {
      const history = this.conversations[contactId];
      for (const msg of history) {
        // 兼容旧版 injectedAtTurn
        if (
          msg.injectionStatus === 'injected' &&
          msg.injectedAtTurn !== undefined &&
          msg.injectedAtTurn >= turnNumber
        ) {
          msg.injectionStatus = 'new';
          delete msg.injectedAtTurn;
          count++;
        }
      }
    }

    if (count > 0) {
      console.log(`[SMSService] 已回滚 ${count} 条消息到 new 状态 (从 Turn ${turnNumber} 开始)`);
    }

    return count;
  }

  /**
   * 基于 UID 完整回滚（删除 targetUID 之后创建的消息 + 重置注入状态）
   * @param {string} targetUID - 目标 UID
   */
  rollbackAfterUID(targetUID) {
    let deletedCount = 0;
    let resetCount = 0;
    const affectedContacts = new Set(); // 记录受影响的联系人

    for (const contactId in this.conversations) {
      const history = this.conversations[contactId];

      // 从后往前遍历，删除 createdAtUID > targetUID 的消息
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];

        // 删除在 targetUID 之后创建的消息
        if (
          msg.createdAtUID &&
          typeof isUIDAfter === 'function' &&
          isUIDAfter(msg.createdAtUID, targetUID)
        ) {
          history.splice(i, 1);
          deletedCount++;
          affectedContacts.add(contactId); // 标记受影响
        } else if (msg.injectionStatus === 'injected') {
          // 重置在 targetUID 之后注入的消息
          if (
            msg.injectedAtUID &&
            typeof isUIDAfter === 'function' &&
            isUIDAfter(msg.injectedAtUID, targetUID)
          ) {
            msg.injectionStatus = 'new';
            delete msg.injectedAtUID;
            resetCount++;
          }
          // 兼容旧版 injectedAtTurn
          else if (msg.injectedAtTurn !== undefined) {
            const targetTurn =
              typeof parseTurnFromUID === 'function' ? parseTurnFromUID(targetUID) : null;
            if (targetTurn !== null && msg.injectedAtTurn > targetTurn) {
              msg.injectionStatus = 'new';
              delete msg.injectedAtTurn;
              resetCount++;
            }
          }
        }
      }
    }

    // 修复 unreadCounts 残留：重新计算受影响联系人的未读数
    for (const contactId of affectedContacts) {
      // 简单处理：如果删除了消息，将该联系人未读数归零
      // （因为回滚意味着这些未读消息已不存在）
      if (this.unreadCounts[contactId]) {
        this.unreadCounts[contactId] = 0;
      }
    }

    this.updateBadge();

    if (deletedCount + resetCount > 0) {
      console.log(
        `[SMSService] 回滚完成: 删除 ${deletedCount} 条消息, 重置 ${resetCount} 条注入状态`
      );
    }
  }

  /**
   * 检查是否有待注入的新消息
   * @returns {boolean}
   */
  hasNewMessages() {
    for (const contactId in this.conversations) {
      const history = this.conversations[contactId];
      if (history.some(msg => msg.injectionStatus === 'new')) {
        return true;
      }
    }
    return false;
  }

  // ============================================
  // 事件驱动短信(角色主动发送)
  // ============================================

  /**
   * 检查玩家是否曾经给某个角色发过短信
   * @param {string} contactId - 联系人ID
   * @returns {boolean} 是否有玩家发送的消息
   */
  hasPlayerSentMessage(contactId) {
    const history = this.conversations[contactId];
    if (!history || history.length === 0) {
      return false;
    }
    // 检查是否有 role: 'user' 的消息
    return history.some(msg => msg.role === 'user');
  }

  /**
   * 接收事件驱动的短信(角色主动发送给玩家)
   * @param {string} contactId - 联系人ID
   * @param {object} reply - AI 生成的回复 { location, cognitive_state, message }
   * @param {object|null} eventGameTime - 事件发生的游戏时间 { year, month, day, timeStr }
   */
  async receiveEventSMS(contactId, reply, eventGameTime = null) {
    // 初始化对话历史
    if (!this.conversations[contactId]) {
      this.conversations[contactId] = [];
    }

    // 临时角色的认知状态强制从 NPC 档案同步
    const finalCognitiveState = this._getForcedCognitiveState(contactId) || reply.cognitive_state;

    // 获取当前 UID（用于回滚追踪）
    const currentUID = this._getCurrentTurnUID();

    // 添加角色主动发送的消息(使用事件的实际日期，而非当前日期)
    const eventMsg = {
      role: 'assistant',
      content: reply.message,
      timestamp: Date.now(),
      gameTime: eventGameTime || this._getCurrentGameTime(), // 优先使用事件日期
      isEventDriven: true, // 标记为事件驱动的消息
      location: reply.location,
      cognitive_state: finalCognitiveState, // 临时角色强制同步 NPC 档案
      relationship: reply.relationship, // 保存当前关系
      injectionStatus: 'new', // 新消息状态，等待注入主聊天
      createdAtUID: currentUID, // 记录创建时的主聊天 UID（用于回滚）
    };
    this.conversations[contactId].push(eventMsg);

    // 增加未读计数
    this.unreadCounts[contactId] = (this.unreadCounts[contactId] || 0) + 1;
    this.updateBadge();

    const dateStr = eventMsg.gameTime
      ? `${eventMsg.gameTime.month}月${eventMsg.gameTime.day}日`
      : '未知';
    console.log(
      `[SMSService] 收到事件短信: ${contactId} (${dateStr}) - "${reply.message.substring(0, 30)}..."`
    );

    return eventMsg;
  }

  /**
   * 接收系统提示消息(用于通知玩家某角色的动态，但不是角色本人发的)
   * @param {string} contactId - 联系人ID
   * @param {string} systemMessage - 系统提示内容
   * @param {object|null} eventGameTime - 事件发生的游戏时间
   */
  async receiveSystemNotification(contactId, systemMessage, eventGameTime = null) {
    // 初始化对话历史
    if (!this.conversations[contactId]) {
      this.conversations[contactId] = [];
    }

    // 获取当前 UID（用于回滚追踪）
    const currentUID = this._getCurrentTurnUID();

    // 添加系统提示消息
    const systemMsg = {
      role: 'system', // 特殊角色标记
      content: systemMessage,
      timestamp: Date.now(),
      gameTime: eventGameTime || this._getCurrentGameTime(),
      isSystemNotification: true, // 标记为系统通知
      injectionStatus: 'new', // 新消息状态，等待注入主聊天
      createdAtUID: currentUID, // 记录创建时的主聊天 UID（用于回滚）
    };
    this.conversations[contactId].push(systemMsg);

    // 增加未读计数
    this.unreadCounts[contactId] = (this.unreadCounts[contactId] || 0) + 1;
    this.updateBadge();

    const dateStr = systemMsg.gameTime
      ? `${systemMsg.gameTime.month}月${systemMsg.gameTime.day}日`
      : '未知';
    console.log(
      `[SMSService] 系统通知: ${contactId} (${dateStr}) - "${systemMessage.substring(0, 50)}..."`
    );

    return systemMsg;
  }
}

// 创建全局实例
const smsService = new SMSService();

// ========================================
// EventBus 监听器
// ========================================
if (window.eventBus && window.GameEvents) {
  // 监听回滚事件
  eventBus.on(GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
    smsService.rollbackAfterUID(targetUID);
  });

  console.log('[SMSService] EventBus 监听器已注册');
}

// 生命周期别名（供 ServiceRegistry 统一调用）
smsService.clear = smsService.clearAll.bind(smsService);

// 注册到服务中心
ServiceRegistry.register('smsData', smsService);
