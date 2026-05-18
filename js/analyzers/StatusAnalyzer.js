// ============================================
// Status Analyzer - 角色状态分析器
// ============================================
// 职责：仅负责 status 字段（独立/死亡/失踪/受控）
// 其他动态字段由各自的 Analyzer 处理：
//   - cognitive_state → cognitiveAnalyzer
//   - relationships → relationshipAnalyzer.js
//   - clothing → 静态字段，无需 Analyzer
//
// 状态类型: "独立" / "死亡" / "失踪" / "受控【上级：XXX】"
// 优先级: 玩家存档 > timeline推算
//
// 关键词规则来源（按优先级）：
//   1. step3_fields._status_keywords（世界卡显式定义）
//   2. 通用默认规则（仅死亡/失踪，当世界含 cognitive_state 时）
//   3. 无 cognitive_state 字段 → 跳过关键词推断
// ============================================

// 通用状态关键词（无自定义规则时的 fallback，仅覆盖死亡/失踪等通用概念）
const UNIVERSAL_STATUS_KEYWORDS = {
  source: 'cognitive_state',
  rules: [
    { match: ['死亡', '身亡', '已死'], status: '死亡' },
    { match: ['失踪', '下落不明'], status: '失踪' },
  ],
};

class StatusAnalyzer {
  constructor() {
    // 玩家存档中的状态覆盖（玩家剧情导致的状态变化）
    // 格式: { characterId: { status: "受控【上级：玩家】", uid: "turn_5_xxx" } }
    this.playerOverrides = {};

    // 状态变化规则表（从 timeline 分析得出）
    // 格式: { characterId: [{ time: {year, month, day}, status: "..." }, ...] }
    // 按时间升序排列
    this.stateChangeRules = this._buildStateChangeRules();
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

  // ============================================
  // 核心接口
  // ============================================

  /**
   * 获取角色状态（供 agent 调用）
   * @param {string} characterId - 角色ID（如 "A_101_Alice"）
   * @param {object} currentTime - 当前游戏时间 { year, month, day }
   * @returns {string} 状态字符串
   */
  getStatus(characterId, currentTime) {
    // 1. 优先检查玩家存档覆盖
    const override = this.playerOverrides[characterId];
    if (override) {
      // 兼容新格式 { status, uid } 和旧格式 string
      return typeof override === 'object' ? override.status : override;
    }

    // 2. 从 timeline 规则推算
    return this.calculateFromTimeline(characterId, currentTime);
  }

  /**
   * 获取角色完整信息（整合各 Analyzer 的数据）
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间
   * @returns {object|null} 完整角色信息
   */
  getCharacterWithStatus(characterId, currentTime) {
    const db = AnalyzerUtils.getCharacterDatabase();
    if (AnalyzerUtils.getValidCharacterIds().length === 0) {
      console.warn('[StatusAnalyzer] 角色数据库为空');
      return null;
    }

    const character = db[characterId];
    if (!character) return null;

    // status - 本 Analyzer 负责
    const status = this.getStatus(characterId, currentTime);

    // cognitive_state - 从 cognitiveAnalyzer 获取
    let cognitiveState = character.cognitive_state;
    if (typeof cognitiveAnalyzer !== 'undefined') {
      cognitiveState =
        cognitiveAnalyzer.getCognitiveState(characterId, currentTime) ?? cognitiveState;
    }

    // relationships - 从 relationshipAnalyzer 获取
    let relationships = character.relationships;
    if (
      typeof relationshipAnalyzer !== 'undefined' &&
      typeof relationshipAnalyzer.getRelationships === 'function'
    ) {
      relationships =
        relationshipAnalyzer.getRelationships(characterId, currentTime) ?? relationships;
    }

    // clothing - 静态字段，直接使用
    const clothing = character.clothing;

    // age - 运行时动态计算，不再回退到持久化字段
    const age = AnalyzerUtils.calculateAge(characterId, currentTime);

    // 合并所有数据
    return {
      ...character,
      status: status,
      cognitive_state: cognitiveState,
      relationships: relationships,
      clothing: clothing,
      age: age,
    };
  }

  /**
   * 更新角色状态（AI 叙事中发现状态变化时调用）
   * @param {string} characterId - 角色ID
   * @param {string} newStatus - 新状态
   */
  updateStatus(characterId, newStatus, explicitUID = null) {
    const currentUID = explicitUID ?? this._getCurrentUID();
    this.playerOverrides[characterId] = {
      status: newStatus,
      uid: currentUID,
    };
    console.log(`[StatusAnalyzer] 状态更新: ${characterId} -> ${newStatus} (UID: ${currentUID})`);
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
      console.log(`[StatusAnalyzer] 回滚: 删除 ${toDelete.length} 条覆盖`);
    }
  }

  // ============================================
  // Timeline 推算逻辑
  // ============================================

  /**
   * 从 timeline 规则推算状态
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间 { year, month, day }
   * @returns {string} 推算的状态
   */
  calculateFromTimeline(characterId, currentTime) {
    // 优先使用统一 character_timelines（自定义世界）
    const ct = window.worldMeta?.getCharacterTimeline?.(characterId);
    if (ct?.status && Array.isArray(ct.status) && ct.status.length > 0) {
      return this._findApplicableStatus(ct.status, currentTime);
    }

    // 回退到硬编码规则表（default_world）
    const rules = this.stateChangeRules[characterId];
    if (!rules || rules.length === 0) {
      return '独立';
    }

    return this._findApplicableStatusLegacy(rules, currentTime);
  }

  /**
   * 从统一格式的 status 数组中查找适用的状态
   * @param {Array} statusTimeline - [{ year, month, day, status }, ...]
   * @param {object} currentTime
   * @returns {string}
   */
  _findApplicableStatus(statusTimeline, currentTime) {
    if (!currentTime || !currentTime.year) return '独立';
    const currentValue = AnalyzerUtils.dateToValue(currentTime);
    for (let i = statusTimeline.length - 1; i >= 0; i--) {
      const entry = statusTimeline[i];
      const entryValue = AnalyzerUtils.dateToValue(entry);
      if (entryValue <= currentValue) {
        return entry.status;
      }
    }
    return '独立';
  }

  /**
   * 从旧格式 stateChangeRules 中查找适用的状态
   * @param {Array} rules - [{ time: { year, month, day }, status }, ...]
   * @param {object} currentTime
   * @returns {string}
   */
  _findApplicableStatusLegacy(rules, currentTime) {
    if (!currentTime || !currentTime.year) return '独立';
    const currentValue = AnalyzerUtils.dateToValue(currentTime);
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i];
      const ruleValue = AnalyzerUtils.dateToValue(rule.time);
      if (ruleValue <= currentValue) {
        return rule.status;
      }
    }
    return '独立';
  }

  // ============================================
  // 关键词规则加载
  // ============================================

  /**
   * 获取当前世界的状态关键词规则
   * 优先级：step3_fields._status_keywords > 通用默认（需有 cognitive_state）> null（跳过）
   * @returns {{ source: string, rules: Array }|null}
   */
  _getStatusKeywords() {
    const step3Fields = window.worldMeta?.getStep3Fields?.();

    // 1. 世界卡显式定义了 _status_keywords → 直接使用
    const custom = step3Fields?._status_keywords;
    if (custom && Array.isArray(custom.rules) && custom.rules.length > 0) {
      return custom;
    }

    // 2. 检查当前世界是否定义了 cognitive_state 字段
    const npcFields = step3Fields?.panel_npc;
    const hasCogState =
      Array.isArray(npcFields) && npcFields.some(f => f.key === 'cognitive_state');
    if (!hasCogState) return null; // 该世界无此字段 → 跳过推断

    // 3. 通用默认规则（死亡/失踪）
    return UNIVERSAL_STATUS_KEYWORDS;
  }

  _resolveStatusFromSourceValue(sourceValue, keywords) {
    if (!sourceValue || !keywords) return null;

    for (const rule of keywords.rules) {
      if (!Array.isArray(rule.match) || !rule.match.some(kw => sourceValue.includes(kw))) {
        continue;
      }
      if (
        Array.isArray(rule.require_owner) &&
        !rule.require_owner.some(p => sourceValue.includes(p))
      ) {
        continue;
      }
      return rule.status;
    }

    return null;
  }

  syncFromSourceField(characterId, field, value, explicitUID = null) {
    const keywords = this._getStatusKeywords();
    if (!keywords || field !== keywords.source) return false;

    const sourceValue = value === null || value === undefined ? '' : String(value);
    if (!sourceValue) return false;

    const newStatus = this._resolveStatusFromSourceValue(sourceValue, keywords);
    if (!newStatus) return false;

    this.updateStatus(characterId, newStatus, explicitUID);
    console.log(
      `[StatusAnalyzer] 从已生效字段检测到变化: ${characterId} → ${newStatus} (${keywords.source}: "${sourceValue}")`
    );
    return true;
  }

  // ============================================
  // 叙事分析功能
  // ============================================

  /**
   * 分析 AI 响应中的 panel_npc，从源字段（通常是 cognitive_state）识别 status 变化
   *
   * 职责说明：
   * - statusAnalyzer 仅负责 status 字段（独立/死亡/失踪/受控等）
   * - cognitive_state 的存储由 cognitiveAnalyzer 负责
   * - 本方法仅从源字段中"读取"关键词来推断 status，不会修改源字段
   * - 关键词规则从 step3_fields._status_keywords 动态加载，支持每个世界自定义
   *
   * @param {string} narrativeText - 纯叙事文本（暂未使用，保留接口）
   * @param {string} aiResponse - Step 3 完整响应（含 JSON）
   * @returns {Array} 检测到的状态变化
   */
  analyzeNarrative(narrativeText, aiResponse) {
    if (!aiResponse) return [];

    // 加载当前世界的关键词规则
    const keywords = this._getStatusKeywords();
    if (!keywords) return []; // 世界无关键词规则 → 跳过

    const changes = [];
    const nameToId = AnalyzerUtils.buildNameToIdMap();
    const npcList = AnalyzerUtils.extractPanelNpc(aiResponse);

    for (const npc of npcList) {
      const name = npc.name;
      if (!name || !nameToId[name]) continue;
      const characterId = nameToId[name];

      // 从源字段读取值（通常是 cognitive_state）
      // 新嵌套 panel_npc 结构：source 字段在 npc.card 里；fallback 兼容老平铺
      const sourceValue = npc.card?.[keywords.source] ?? npc[keywords.source] ?? '';
      if (!sourceValue) continue;

      const newStatus = this._resolveStatusFromSourceValue(sourceValue, keywords);

      if (newStatus && !changes.find(c => c.characterId === characterId)) {
        changes.push({ characterId, newStatus, sourceValue });
      }
    }

    // 应用状态变化
    for (const change of changes) {
      this.updateStatus(change.characterId, change.newStatus);
      console.log(
        `[StatusAnalyzer] 从 ${keywords.source} 检测到变化: ${change.characterId} → ${change.newStatus} (${keywords.source}: "${change.sourceValue}")`
      );
    }

    return changes;
  }

  // ============================================
  // 状态变化规则表（从 timeline.js 分析得出）
  // ============================================

  /**
   * 构建状态变化规则表
   * 这些规则是从 timeline.js 中分析得出的关键事件
   * 如果玩家行动改变了这些事件，应通过 updateStatus 覆盖
   */
  _buildStateChangeRules() {
    // 状态变化规则由各世界卡的 character_timelines 数据驱动
    // 不再硬编码任何世界特定的角色规则
    return {};
  }

  // ============================================
  // 批量操作
  // ============================================

  /**
   * 获取所有角色及其当前状态
   * @param {object} currentTime - 当前游戏时间
   * @returns {Array} 带状态的角色数组
   */
  getAllCharactersWithStatus(currentTime) {
    const characterIds = AnalyzerUtils.getValidCharacterIds();
    if (characterIds.length === 0) {
      console.warn('[StatusAnalyzer] 角色数据库为空');
      return [];
    }

    // 使用 getCharacterWithStatus 来确保包含所有动态字段
    return characterIds.map(id => this.getCharacterWithStatus(id, currentTime)).filter(Boolean);
  }

  /**
   * 按状态筛选角色
   * @param {string} status - 状态（支持部分匹配，如"受控"）
   * @param {object} currentTime - 当前游戏时间
   * @returns {Array} 符合条件的角色数组
   */
  getCharactersByStatus(status, currentTime) {
    return this.getAllCharactersWithStatus(currentTime).filter(char =>
      char.status.includes(status)
    );
  }

  // ============================================
  // 存档/读档
  // ============================================

  /**
   * 获取存档数据
   * 注意：仅保存 status 相关数据，其他动态字段由各自 Analyzer 负责存档
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
      `[StatusAnalyzer] 从存档恢复 ${Object.keys(this.playerOverrides).length} 个状态覆盖`
    );
    // 兼容旧存档：忽略 dynamicFieldOverrides（已移除）
  }

  /**
   * 清除所有状态（重置游戏时调用）
   * 注意：仅清除 status 相关数据，其他动态字段由各自 Analyzer 负责
   */
  clear() {
    this.playerOverrides = {};
    console.log('[StatusAnalyzer] 已清除所有状态覆盖');
  }

  // ============================================
  // 调试工具
  // ============================================

  /**
   * 打印所有角色当前状态（调试用）
   * @param {object} currentTime - 当前游戏时间
   */
  debugPrintAllStatus(currentTime) {
    console.log('[StatusAnalyzer] === 角色状态调试信息 ===');
    console.log('当前时间:', currentTime);
    console.log('玩家覆盖数:', Object.keys(this.playerOverrides).length);

    const chars = this.getAllCharactersWithStatus(currentTime);
    // 注意：isOverride 检查需要兼容新旧格式
    chars.forEach(char => {
      const isOverride = this.playerOverrides[char.id] ? '[覆盖]' : '[推算]';
      console.log(`  ${char.name} (${char.id}): ${char.status} ${isOverride}`);
    });

    console.log('[StatusAnalyzer] === 调试结束 ===');
  }
}

// 创建全局实例
const statusAnalyzer = new StatusAnalyzer();
window.statusAnalyzer = statusAnalyzer;

// ========================================
// EventBus 监听器已移至 AnalyzerManager 统一管理
// ========================================
