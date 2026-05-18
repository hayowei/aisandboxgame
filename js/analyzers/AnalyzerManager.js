// ============================================
// Analyzer Manager - 分析器统一管理器
// ============================================
// 职责：统一管理四个 Analyzer 的生命周期
// 包括：存档、恢复、清除、EventBus 注册
// 必须在所有 Analyzer 之后加载
// ============================================

class AnalyzerManagerClass {
  constructor() {
    this.analyzers = {};
    this._initialized = false;
  }

  /**
   * 初始化：注册所有 analyzer
   * 在所有 analyzer 加载完成后自动调用
   */
  init() {
    if (this._initialized) {
      console.warn('[AnalyzerManager] 已初始化，跳过重复初始化');
      return;
    }

    this.analyzers = {
      status: typeof statusAnalyzer !== 'undefined' ? statusAnalyzer : null,
      cognitive: typeof cognitiveAnalyzer !== 'undefined' ? cognitiveAnalyzer : null,
      sexHistory: typeof sexHistoryAnalyzer !== 'undefined' ? sexHistoryAnalyzer : null,
      relationships: typeof relationshipAnalyzer !== 'undefined' ? relationshipAnalyzer : null,
    };

    this._registerEventListeners();
    this._initialized = true;

    const count = Object.values(this.analyzers).filter(Boolean).length;
    console.log(`[AnalyzerManager] 已初始化，管理 ${count} 个 analyzer`);
  }

  // ============================================
  // 存档/恢复/清除 - 统一接口
  // ============================================

  /**
   * 获取所有 analyzer 的存档数据
   * @returns {object} { status, cognitive, sexHistory, relationships }
   */
  getSaveData() {
    const data = {};
    for (const [key, analyzer] of Object.entries(this.analyzers)) {
      data[key] = analyzer?.getSaveData() ?? null;
    }
    return data;
  }

  /**
   * 从存档恢复所有 analyzer 的状态
   * @param {object} data - 存档数据
   */
  restore(data) {
    if (!data) {
      this.clear();
      return;
    }

    const source = data && typeof data === 'object' ? data : {};
    for (const [key, analyzer] of Object.entries(this.analyzers)) {
      if (!analyzer) continue;

      if (typeof analyzer.clear === 'function') {
        analyzer.clear();
      }

      const hasOwnField = Object.prototype.hasOwnProperty.call(source, key);
      const hasUsableData = hasOwnField && source[key] !== null && source[key] !== undefined;
      if (hasUsableData && typeof analyzer.restore === 'function') {
        analyzer.restore(source[key]);
      }
    }

    console.log('[AnalyzerManager] 已从存档恢复所有 analyzer 状态');
  }

  /**
   * 清除所有 analyzer 的状态
   */
  clear() {
    for (const analyzer of Object.values(this.analyzers)) {
      analyzer?.clear();
    }

    console.log('[AnalyzerManager] 已清除所有 analyzer 状态');
  }

  // ============================================
  // EventBus 统一监听
  // ============================================

  _registerEventListeners() {
    if (!window.eventBus || !window.GameEvents) {
      console.warn('[AnalyzerManager] EventBus 未加载，跳过监听器注册');
      return;
    }

    // 监听 AI 响应完成事件
    eventBus.on(GameEvents.AI_RESPONSE_COMPLETE, payload => {
      const { narrativeText, narrative } = payload;

      if (!narrative) return;

      // 仅保留不会绕过审批的叙事分析器
      const analyzeOrder = ['sexHistory'];

      for (const key of analyzeOrder) {
        const analyzer = this.analyzers[key];
        if (analyzer?.analyzeNarrative) {
          try {
            analyzer.analyzeNarrative(narrativeText, narrative);
          } catch (e) {
            console.error(`[AnalyzerManager] ${key}.analyzeNarrative 执行失败:`, e);
          }
        }
      }
    });

    // 已生效字段更新后再同步 analyzer，避免未审批数据提前生效
    eventBus.on(GameEvents.NPC_UPDATED, ({ npcId, field, value, uid }) => {
      this._syncNpcFieldToAnalyzers(npcId, field, value, uid);
    });

    eventBus.on(GameEvents.NPC_APPROVED, ({ npcId, field, newValue, uid }) => {
      this._syncNpcFieldToAnalyzers(npcId, field, newValue, uid);
    });

    // 监听回滚事件
    eventBus.on(GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
      let totalRolledBack = 0;
      for (const [key, analyzer] of Object.entries(this.analyzers)) {
        if (analyzer?.rollbackAfterUID) {
          try {
            analyzer.rollbackAfterUID(targetUID);
            totalRolledBack++;
          } catch (e) {
            console.error(`[AnalyzerManager] ${key}.rollbackAfterUID 执行失败:`, e);
          }
        }
      }
      console.log(`[AnalyzerManager] 所有分析器已回滚 (${totalRolledBack} 个)`);
    });

    console.log('[AnalyzerManager] EventBus 监听器已注册');
  }

  _syncNpcFieldToAnalyzers(npcId, field, value, uid = null) {
    if (!npcId || !field || typeof value === 'undefined') return;
    if (!this.hasCharacter(npcId)) return;

    if (field === 'cognitive_state' && this.analyzers.cognitive?.updateCognitiveState) {
      this.analyzers.cognitive.updateCognitiveState(npcId, value, uid);
    }

    if (this.analyzers.status?.syncFromSourceField) {
      this.analyzers.status.syncFromSourceField(npcId, field, value, uid);
    }
  }

  // ============================================
  // 便捷方法
  // ============================================

  getCharacterState(characterId, currentTime) {
    return this.analyzers.status?.getCharacterWithStatus(characterId, currentTime) ?? null;
  }

  getAllCharacterStates(currentTime) {
    return this.analyzers.status?.getAllCharactersWithStatus(currentTime) ?? [];
  }

  getAnalyzer(name) {
    return this.analyzers[name] ?? null;
  }

  getCognitiveState(characterId, currentTime) {
    const time =
      currentTime ||
      (typeof AnalyzerUtils !== 'undefined' ? AnalyzerUtils.getCurrentGameTime() : null);
    return this.analyzers.cognitive?.getCognitiveState(characterId, time) ?? '未知';
  }

  hasCharacter(characterId) {
    if (typeof AnalyzerUtils === 'undefined') return false;
    const db = AnalyzerUtils.getCharacterDatabase();
    return !!db[characterId];
  }
}

// 创建全局实例并初始化
const AnalyzerManager = new AnalyzerManagerClass();
AnalyzerManager.init();

// 注册到服务中心
ServiceRegistry.register('characterStates', AnalyzerManager);
