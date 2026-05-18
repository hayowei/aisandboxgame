// ============================================
// Relationship Analyzer - 关系分析器
// ============================================
// 职责：管理角色间的关系网络
// 数据来源：relationship_rules.js + 玩家覆盖 + AI 动态识别
// 优先级: 玩家覆盖 > 规则推算
//
// 与其他 Analyzer 的区别：
//   - cognitive_state = 角色自身属性
//   - relationships = 角色与其他角色的关系网络
// ============================================

class RelationshipAnalyzer {
  constructor() {
    // 玩家存档中的关系覆盖
    // 格式: { characterId: { relations: { targetId: relation, ... }, uid: "turn_5_xxx" }, ... }
    this.playerOverrides = {};
  }

  /**
   * 获取当前主聊天的 UID
   */
  _getCurrentUID() {
    if (typeof chatHistory !== 'undefined') {
      const lastAi = [...chatHistory].reverse().find(m => m.sender === 'ai');
      return lastAi?.uid || null;
    }
    return null;
  }

  /**
   * 获取角色的覆盖关系（兼容新旧格式）
   */
  _getOverrideRelations(characterId) {
    const override = this.playerOverrides[characterId];
    if (!override) return {};
    // 兼容新格式 { relations, uid } 和旧格式 { targetId: relation, ... }
    if (override.relations) {
      return override.relations;
    }
    // 旧格式：整个对象就是关系映射（不含 relations/uid 键）
    const { uid: _uid, ...relations } = override;
    if (Object.keys(relations).length > 0) {
      return relations;
    }
    return override;
  }

  // ============================================
  // 核心接口
  // ============================================

  /**
   * 获取角色的关系网络（返回对象）
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间 { year, month, day }
   * @returns {object} { targetId: relation, ... }
   */
  getRelationships(characterId, currentTime) {
    // 1. 从规则推算基础关系
    const baseRelations = this.calculateFromRules(characterId, currentTime);

    // 2. 合并玩家覆盖
    const overrides = this._getOverrideRelations(characterId);

    return { ...baseRelations, ...overrides };
  }

  /**
   * 获取格式化的关系字符串（供 AI 使用）
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间
   * @returns {string|null} 格式化字符串，无关系时返回 null
   */
  getRelationshipsFormatted(characterId, currentTime) {
    const relations = this.getRelationships(characterId, currentTime);

    if (!relations || Object.keys(relations).length === 0) {
      return null;
    }

    // 构建名称映射（使用公共工具）
    const idToName = AnalyzerUtils.buildIdToNameMap();

    // 格式化为 "- Name: relation" 列表
    const lines = [];
    for (const [targetId, relation] of Object.entries(relations)) {
      const name = idToName[targetId] || targetId;
      lines.push(`- ${name}: ${relation}`);
    }

    return lines.join('\n');
  }

  /**
   * 更新单个关系（AI 叙事中发现关系变化时调用）
   * @param {string} characterId - 角色ID
   * @param {string} targetId - 目标角色ID
   * @param {string} relation - 新关系描述
   */
  updateRelationship(characterId, targetId, relation) {
    const currentUID = this._getCurrentUID();
    const existing = this._getOverrideRelations(characterId);

    this.playerOverrides[characterId] = {
      relations: { ...existing, [targetId]: relation },
      uid: currentUID,
    };
    console.log(
      `[RelationshipAnalyzer] 关系更新: ${characterId} -> ${targetId}: ${relation} (UID: ${currentUID})`
    );
  }

  /**
   * 批量更新关系
   * @param {string} characterId - 角色ID
   * @param {object} relations - { targetId: relation, ... }
   */
  updateRelationships(characterId, relations) {
    const currentUID = this._getCurrentUID();
    const existing = this._getOverrideRelations(characterId);

    this.playerOverrides[characterId] = {
      relations: { ...existing, ...relations },
      uid: currentUID,
    };
    console.log(
      `[RelationshipAnalyzer] 批量关系更新: ${characterId} (UID: ${currentUID})`,
      relations
    );
  }

  /**
   * 清除角色的玩家覆盖
   * @param {string} characterId - 角色ID
   */
  clearOverride(characterId) {
    delete this.playerOverrides[characterId];
  }

  /**
   * 基于 UID 回滚（删除 targetUID 之后的覆盖）
   * @param {string} targetUID - 目标 UID
   */
  rollbackAfterUID(targetUID) {
    const toDelete = [];
    for (const charId in this.playerOverrides) {
      const override = this.playerOverrides[charId];
      const overrideUID = override?.uid || null;
      if (overrideUID && typeof isUIDAfter === 'function' && isUIDAfter(overrideUID, targetUID)) {
        toDelete.push(charId);
      }
    }
    for (const charId of toDelete) {
      delete this.playerOverrides[charId];
    }
    if (toDelete.length > 0) {
      console.log(`[RelationshipAnalyzer] 回滚: 删除 ${toDelete.length} 条覆盖`);
    }
  }

  // ============================================
  // 规则推算逻辑
  // ============================================

  /**
   * 从关系规则推算关系（优先从 worldMeta/npcStore 读取，fallback 到全局常量）
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间
   * @returns {object} { targetId: relation, ... }
   */
  calculateFromRules(characterId, currentTime) {
    // 优先尝试统一 character_timelines（自定义世界）
    const ct = window.worldMeta?.getCharacterTimeline?.(characterId);
    const ctRel = ct?.relationships;
    if (ctRel && Array.isArray(ctRel) && ctRel.length > 0) {
      return this._findApplicableRelations(ctRel, currentTime);
    }

    // 回退到旧格式 RELATIONSHIP_RULES（default_world）
    const allRules = window.npcStore?.getRelationshipRules?.() || null;
    if (!allRules) {
      return {};
    }

    const rules = allRules[characterId];
    if (!rules) {
      return {};
    }

    const timeline = rules.timeline;
    const defaultRelations = rules.default || {};

    // 没有时间线，返回默认关系
    if (!timeline || timeline.length === 0) {
      return { ...defaultRelations };
    }

    // 没有当前时间，返回默认关系
    if (!currentTime || !currentTime.year) {
      return { ...defaultRelations };
    }

    const currentValue = AnalyzerUtils.dateToValue(currentTime);

    // 从后往前找到第一个早于或等于当前时间的快照
    for (let i = timeline.length - 1; i >= 0; i--) {
      const snapshot = timeline[i];
      const snapshotValue = AnalyzerUtils.dateToValue(snapshot.time);

      if (snapshotValue <= currentValue) {
        return { ...snapshot.relations };
      }
    }

    // 当前时间早于所有快照，返回默认关系
    return { ...defaultRelations };
  }

  /**
   * 从统一格式的 relationships 数组中查找适用的关系快照
   * @param {Array} relTimeline - [{ year, month, day, relations: {...} }, ...]
   * @param {object} currentTime - 当前游戏时间
   * @returns {object} { targetId: relation, ... }
   */
  _findApplicableRelations(relTimeline, currentTime) {
    if (!currentTime || !currentTime.year) {
      return {};
    }
    const currentValue = AnalyzerUtils.dateToValue(currentTime);
    for (let i = relTimeline.length - 1; i >= 0; i--) {
      const snapshot = relTimeline[i];
      const snapshotValue = AnalyzerUtils.dateToValue(snapshot);
      if (snapshotValue <= currentValue) {
        return { ...(snapshot.relations || {}) };
      }
    }
    return {};
  }

  // ============================================
  // 叙事分析功能
  // ============================================

  /**
   * 分析 AI 响应，提取关系变化
   * 注意：这是一个简化实现，实际可能需要更复杂的 NLP
   * @param {string} narrativeText - 纯叙事文本
   * @param {string} aiResponse - Step 3 完整响应（含 JSON）
   * @returns {Array} 检测到的关系变化
   */
  analyzeNarrative(_narrativeText, _aiResponse) {
    // 暂时不自动解析，保留接口
    // 关系变化需要明确的事件触发，不适合自动推断
    return [];
  }

  // ============================================
  // 批量操作
  // ============================================

  /**
   * 获取所有角色的关系
   * @param {object} currentTime - 当前游戏时间
   * @returns {Object} { characterId: { targetId: relation, ... }, ... }
   */
  getAllRelationships(currentTime) {
    const characterIds = new Set();

    // 收集旧格式 RELATIONSHIP_RULES 中的角色 ID
    const allRules = window.npcStore?.getRelationshipRules?.() || null;
    if (allRules) {
      for (const id in allRules) {
        characterIds.add(id);
      }
    }

    // 收集统一 character_timelines 中有 relationships 的角色 ID
    const allCt = window.worldMeta?.getCharacterTimelines?.() || null;
    if (allCt) {
      for (const id in allCt) {
        if (id.startsWith('_')) continue;
        if (allCt[id]?.relationships) {
          characterIds.add(id);
        }
      }
    }

    const result = {};
    for (const id of characterIds) {
      result[id] = this.getRelationships(id, currentTime);
    }
    return result;
  }

  // ============================================
  // 存档/读档
  // ============================================

  /**
   * 获取存档数据
   */
  getSaveData() {
    return {
      playerOverrides: JSON.parse(JSON.stringify(this.playerOverrides)),
    };
  }

  /**
   * 从存档恢复数据
   */
  restore(data) {
    const hasOverrides =
      data &&
      typeof data === 'object' &&
      data.playerOverrides &&
      typeof data.playerOverrides === 'object' &&
      !Array.isArray(data.playerOverrides);
    this.playerOverrides = hasOverrides ? JSON.parse(JSON.stringify(data.playerOverrides)) : {};
    console.log(
      `[RelationshipAnalyzer] 从存档恢复 ${Object.keys(this.playerOverrides).length} 个角色的关系覆盖`
    );
  }

  /**
   * 清除所有状态
   */
  clear() {
    this.playerOverrides = {};
    console.log('[RelationshipAnalyzer] 已清除所有关系覆盖');
  }

  // ============================================
  // 调试工具
  // ============================================

  /**
   * 打印角色当前关系（调试用）
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间
   */
  debugPrintRelationships(characterId, currentTime) {
    console.log(`[RelationshipAnalyzer] === ${characterId} 的关系 ===`);
    console.log('当前时间:', currentTime);

    const relations = this.getRelationships(characterId, currentTime);
    const formatted = this.getRelationshipsFormatted(characterId, currentTime);

    console.log('关系对象:', relations);
    console.log('格式化输出:\n' + (formatted || '(无关系)'));

    const hasOverride = !!this.playerOverrides[characterId];
    console.log('有玩家覆盖:', hasOverride);

    console.log('[RelationshipAnalyzer] === 调试结束 ===');
  }

  /**
   * 打印所有角色关系（调试用）
   * @param {object} currentTime - 当前游戏时间
   */
  debugPrintAllRelationships(currentTime) {
    console.log('[RelationshipAnalyzer] === 所有角色关系 ===');
    console.log('当前时间:', currentTime);

    const all = this.getAllRelationships(currentTime);
    const idToName = AnalyzerUtils.buildIdToNameMap();

    for (const [id, relations] of Object.entries(all)) {
      const name = idToName[id] || id;
      const count = Object.keys(relations).length;
      console.log(`  ${name}: ${count} 个关系`);
    }

    console.log('[RelationshipAnalyzer] === 调试结束 ===');
  }
}

// 创建全局实例
const relationshipAnalyzer = new RelationshipAnalyzer();
window.relationshipAnalyzer = relationshipAnalyzer;

// ========================================
// EventBus 监听器已移至 AnalyzerManager 统一管理
// 注意：relationshipAnalyzer.analyzeNarrative() 当前返回空数组，
// 关系变化需要明确事件触发，不适合自动推断
// ========================================
