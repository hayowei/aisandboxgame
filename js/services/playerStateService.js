// ============================================
// Player State Service - 玩家状态服务
// ============================================
// 存储玩家目标和上一个 Turn 的状态
// 注：货币已迁移到 inventoryStore（作为物品栏一项）；money 字段不再由本 service 管理

class PlayerStateService {
  constructor() {
    // 当前玩家状态
    this.currentObjective = null;

    // 上一个 Turn 结束时的状态（用于手动编辑时的跳跃计算）
    this.previousTurnDate = null; // { year, month, day, timeStr }
    this.previousTurnLocation = null; // { country, site, spot }
  }

  // ==========================================
  // 当前状态的 Getter/Setter
  // ==========================================

  /**
   * 设置当前目标
   * @param {string|null} value - 目标文本
   */
  setObjective(value) {
    this.currentObjective = value || null;
    console.log('[PlayerStateService] 目标已更新:', this.currentObjective);
  }

  /**
   * 获取当前目标
   * @returns {string|null}
   */
  getObjective() {
    return this.currentObjective;
  }

  // ==========================================
  // 上一个 Turn 状态管理
  // ==========================================

  /**
   * 设置上一个 Turn 的状态（在 AI 回复完成后调用）
   * @param {Object} date - { year, month, day, timeStr }
   * @param {Object} location - { country, site, spot }
   */
  setPreviousTurnState(date, location) {
    this.previousTurnDate = date ? { ...date } : null;
    this.previousTurnLocation = location ? { ...location } : null;
    console.log('[PlayerStateService] previousTurn 状态已更新:', {
      date: this.previousTurnDate,
      location: this.previousTurnLocation,
    });
  }

  /**
   * 获取上一个 Turn 的日期
   * @returns {Object|null}
   */
  getPreviousTurnDate() {
    return this.previousTurnDate;
  }

  /**
   * 获取上一个 Turn 的地点
   * @returns {Object|null}
   */
  getPreviousTurnLocation() {
    return this.previousTurnLocation;
  }

  // ==========================================
  // 从 AI 回复同步状态
  // ==========================================

  /**
   * 从 AI 回复的 panel_status 同步状态
   * @param {Object} panelStatus - AI 返回的 panel_status 对象
   */
  syncFromAIResponse(panelStatus) {
    if (!panelStatus) return;

    // 同步目标：新结构 objective.text 优先，旧结构 player_state.current_objective 兜底
    if (panelStatus.objective && panelStatus.objective.text !== undefined) {
      this.currentObjective = panelStatus.objective.text || null;
    } else if (
      panelStatus.player_state &&
      panelStatus.player_state.current_objective !== undefined
    ) {
      this.currentObjective = panelStatus.player_state.current_objective || null;
    }

    console.log('[PlayerStateService] 从 AI 回复同步状态:', {
      objective: this.currentObjective,
    });
  }

  // ==========================================
  // 存档/恢复
  // ==========================================

  /**
   * 获取存档数据
   * @returns {Object}
   */
  getSaveData() {
    return {
      currentObjective: this.currentObjective,
      previousTurnDate: this.previousTurnDate ? { ...this.previousTurnDate } : null,
      previousTurnLocation: this.previousTurnLocation ? { ...this.previousTurnLocation } : null,
    };
  }

  /**
   * 从存档恢复数据
   * @param {Object} data - 存档数据
   */
  restore(data) {
    if (!data) return;

    this.currentObjective = data.currentObjective || null;
    this.previousTurnDate = data.previousTurnDate ? { ...data.previousTurnDate } : null;
    this.previousTurnLocation = data.previousTurnLocation ? { ...data.previousTurnLocation } : null;

    console.log('[PlayerStateService] 从存档恢复:', this.getSaveData());
  }

  /**
   * 清空状态（重置游戏时调用）
   */
  clear() {
    this.currentObjective = null;
    this.previousTurnDate = null;
    this.previousTurnLocation = null;
    console.log('[PlayerStateService] 状态已清空');
  }
}

// 创建全局实例
const playerStateService = new PlayerStateService();

// 注册到服务中心
ServiceRegistry.register('playerStateData', playerStateService);
