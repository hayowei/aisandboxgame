// ============================================
// Cognitive Analyzer - 认知状态分析器
// ============================================
// 合并功能：
// 1. 认知状态存储与查询
// 2. Timeline 规则推算（从 CHARACTER_DATABASE 读取）
// 3. 叙事文本分析 → 自动识别认知状态变化
// 优先级: 玩家存档覆盖 > timeline推算 > 默认值
// ============================================

class CognitiveAnalyzer {
  constructor() {
    // 玩家存档中的认知状态覆盖（玩家剧情导致的变化）
    // 格式: { characterId: { state: "新认知状态", uid: "turn_5_xxx" } }
    this.playerOverrides = {};
  }

  // ============================================
  // 核心接口
  // ============================================

  /**
   * 获取角色认知状态（供各模块调用）
   * @param {string} characterId - 角色ID（如 "A_101_Alice"）
   * @param {object} currentTime - 当前游戏时间 { year, month, day }
   * @returns {string} 认知状态字符串
   */
  getCognitiveState(characterId, currentTime) {
    // 1. 优先检查玩家存档覆盖
    const override = this.playerOverrides[characterId];
    if (override) {
      // 兼容新格式 { state, uid } 和旧格式 string
      return typeof override === 'object' ? override.state : override;
    }

    // 2. 从 timeline 规则推算
    return this.calculateFromTimeline(characterId, currentTime);
  }

  /**
   * 更新角色认知状态（AI 叙事中发现变化时调用）
   * @param {string} characterId - 角色ID
   * @param {string} newState - 新认知状态
   */
  updateCognitiveState(characterId, newState, explicitUID = null) {
    const currentUID = explicitUID ?? this._getCurrentUID();
    this.playerOverrides[characterId] = {
      state: newState,
      uid: currentUID,
    };
    console.log(
      `[CognitiveAnalyzer] 认知状态更新: ${characterId} -> ${newState} (UID: ${currentUID})`
    );
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
   * 清除角色的玩家覆盖状态（恢复为 timeline 推算）
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
      const overrideUID = typeof override === 'object' ? override.uid : null;
      if (overrideUID && typeof isUIDAfter === 'function' && isUIDAfter(overrideUID, targetUID)) {
        toDelete.push(charId);
      }
    }
    for (const charId of toDelete) {
      delete this.playerOverrides[charId];
    }
    if (toDelete.length > 0) {
      console.log(`[CognitiveAnalyzer] 回滚: 删除 ${toDelete.length} 条覆盖`);
    }
  }

  // ============================================
  // Timeline 推算逻辑
  // ============================================

  /**
   * 从 CHARACTER_DATABASE 的 timeline 规则推算认知状态
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间 { year, month, day }
   * @returns {string} 推算的认知状态
   */
  calculateFromTimeline(characterId, currentTime) {
    const db = AnalyzerUtils.getCharacterDatabase();
    if (AnalyzerUtils.getValidCharacterIds().length === 0) {
      console.warn('[CognitiveAnalyzer] 角色数据库为空');
      return '未知';
    }

    const char = db[characterId];
    if (!char) {
      return '未知';
    }

    // 优先使用统一 character_timelines（自定义世界），再回退到旧格式（default_world）
    const ct = window.worldMeta?.getCharacterTimeline?.(characterId);
    const timeline =
      ct?.cognitive && Array.isArray(ct.cognitive) && ct.cognitive.length > 0
        ? ct.cognitive
        : char.cognitive_state_timeline;

    // 没有时间线，返回默认认知状态
    if (!timeline || timeline.length === 0) {
      return char.default_cognitive_state || '未知';
    }

    // 没有当前时间，返回默认认知状态
    if (!currentTime || !currentTime.year) {
      return char.default_cognitive_state || '未知';
    }

    // 使用公共工具进行日期转换
    const currentValue = AnalyzerUtils.dateToValue(currentTime);

    // 从后往前找到第一个早于或等于当前时间的状态变化
    let applicableState = null;
    for (let i = timeline.length - 1; i >= 0; i--) {
      const statePoint = timeline[i];
      const stateValue = AnalyzerUtils.dateToValue(statePoint);

      if (stateValue <= currentValue) {
        applicableState = statePoint.state;
        break;
      }
    }

    // 返回找到的状态，或默认状态
    return applicableState || char.default_cognitive_state || '未知';
  }

  // ============================================
  // 叙事分析功能
  // ============================================

  /**
   * 分析 AI 响应中的 panel_npc，提取 cognitive_state 变化
   * @param {string} narrativeText - 纯叙事文本（暂未使用，保留接口）
   * @param {string} aiResponse - Step 3 完整响应（含 JSON）
   * @returns {Array} 检测到的认知状态变化
   */
  analyzeNarrative(narrativeText, aiResponse) {
    if (!aiResponse) return [];

    const changes = [];
    const nameToId = AnalyzerUtils.buildNameToIdMap();

    // 从 aiResponse 解析 panel_npc（使用公共工具）
    const npcList = AnalyzerUtils.extractPanelNpc(aiResponse);

    for (const npc of npcList) {
      const name = npc.name;
      // 新嵌套结构 panel_npc：cognitive_state 在 card.*；fallback 兼容老平铺
      const cognitiveState = npc.card?.cognitive_state ?? npc.cognitive_state;

      // 跳过未知角色或无认知状态
      if (!name || !nameToId[name] || !cognitiveState) continue;

      const characterId = nameToId[name];

      // 获取当前存储的认知状态（可能是对象 {state, uid} 或旧格式字符串）
      const currentStateData = this.playerOverrides[characterId];
      const currentState =
        typeof currentStateData === 'object' ? currentStateData.state : currentStateData;

      // 如果有变化，记录并更新
      if (cognitiveState !== currentState) {
        changes.push({
          characterId,
          oldState: currentState || '(无覆盖)',
          newState: cognitiveState,
        });

        // 更新覆盖
        this.updateCognitiveState(characterId, cognitiveState);
      }
    }

    if (changes.length > 0) {
      console.log(`[CognitiveAnalyzer] 从叙事中检测到 ${changes.length} 个认知状态变化`);
    }

    return changes;
  }

  // ============================================
  // 批量操作
  // ============================================

  /**
   * 获取所有角色的认知状态
   * @param {object} currentTime - 当前游戏时间
   * @returns {Object} { characterId: cognitiveState }
   */
  getAllCognitiveStates(currentTime) {
    const characterIds = AnalyzerUtils.getValidCharacterIds();
    if (characterIds.length === 0) {
      return {};
    }

    const result = {};
    for (const id of characterIds) {
      result[id] = this.getCognitiveState(id, currentTime);
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
      playerOverrides: { ...this.playerOverrides },
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
    this.playerOverrides = hasOverrides ? { ...data.playerOverrides } : {};
    console.log(
      `[CognitiveAnalyzer] 从存档恢复 ${Object.keys(this.playerOverrides).length} 个认知状态覆盖`
    );
  }

  /**
   * 清除所有状态（重置游戏时调用）
   */
  clear() {
    this.playerOverrides = {};
    console.log('[CognitiveAnalyzer] 已清除所有认知状态覆盖');
  }

  // ============================================
  // 调试工具
  // ============================================

  /**
   * 打印所有角色当前认知状态（调试用）
   * @param {object} currentTime - 当前游戏时间
   */
  debugPrintAllStates(currentTime) {
    console.log('[CognitiveAnalyzer] === 认知状态调试信息 ===');
    console.log('当前时间:', currentTime);
    console.log('玩家覆盖数:', Object.keys(this.playerOverrides).length);

    const states = this.getAllCognitiveStates(currentTime);
    const db = AnalyzerUtils.getCharacterDatabase();
    for (const id in states) {
      const override = this.playerOverrides[id];
      const isOverride = override ? '[覆盖]' : '[推算]';
      const char = db[id];
      console.log(`  ${char?.name || id}: ${states[id]} ${isOverride}`);
    }

    console.log('[CognitiveAnalyzer] === 调试结束 ===');
  }
}

// 创建全局实例
const cognitiveAnalyzer = new CognitiveAnalyzer();
window.cognitiveAnalyzer = cognitiveAnalyzer;

// ========================================
// EventBus 监听器已移至 AnalyzerManager 统一管理
// ========================================
