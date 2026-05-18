// ============================================
// NPC Store - NPC 数据存储层
// ============================================
// 纯数据模块，负责 NPC 数据的存储、业务逻辑和事件通知
// UI 层 (npcPanelUI) 订阅事件并响应式更新

class NpcStore {
  // ==========================================
  // 数据存储
  // ==========================================

  constructor() {
    // 已登场（encountered）的 NPC 数据 (key: npcId, value: npcData)
    // 只有 encountered=true 的角色会在此，参与 UI 展示、选择、排序、审批
    this._npcs = {};

    // 未登场角色池（预定义 + update_new_characters 生成）
    // key: charId, value: { ...charData }（保留原始 character_database 格式）
    // NEW_PREDEFINED 触发时从此池取出、跑 AnalyzerManager 覆盖、放入 _npcs
    this._predefinedPool = {};

    // 来源标记 (key: charId, value: 'predefined' | 'expanded')
    // 仅用于统计 / 存档自洽；encountered 后不再变更，runtime NEW 角色不进此 map
    this._charOrigin = {};

    // 角色关系规则 (key: charId, value: { default: {}, ... })
    // 预定义 + update_new_characters 写入，与角色池并列
    this._relationshipRules = {};

    // 已删除的 NPC ID 记录 (防止重新渲染历史消息时恢复)
    // 格式: { npcId: deletedAtUID }
    this._deletedIds = {};

    // 已拒绝的更新记录 (防止刷新/加载后重复出现审批)
    // 格式: { npcId: { field: { value: rejectedValue, turn: turn, uid: uid } } }
    this._rejectedUpdates = {};

    // NPC 排序顺序 (npcId 数组，仅 encountered)
    this._order = [];

    // 待审批的更新 (key: npcId, value: { changes: { field: { old, new, turn, uid } } })
    this._pendingUpdates = {};

    // 自动审批开关；true 时 queueUpdate 入队后立即 approveField
    this._autoApprove = false;

    // 选中状态 (默认全选中，未选中的 ID 存入此 Set)
    this._unselectedIds = new Set();

    // 当前轮次 (用于外部查询)
    this.currentTurn = 0;
  }

  // ==========================================
  // 初始化（新游戏 / 切换世界卡）
  // ==========================================

  /**
   * 从世界卡的预定义数据初始化
   * @param {Object} characterDB - snapshot.character_database
   * @param {Object} [relationshipRules] - snapshot.relationship_rules
   */
  initialize(characterDB, relationshipRules) {
    this.clear();

    if (characterDB && typeof characterDB === 'object') {
      for (const [id, data] of Object.entries(characterDB)) {
        if (!id || id.startsWith('_') || !data || typeof data !== 'object') continue;
        this._predefinedPool[id] = this._deepClone(data);
        this._charOrigin[id] = 'predefined';
      }
    }

    if (relationshipRules && typeof relationshipRules === 'object') {
      for (const [id, rules] of Object.entries(relationshipRules)) {
        if (!id || id.startsWith('_')) continue;
        this._relationshipRules[id] = this._deepClone(rules);
      }
    }

    console.log(
      `[npcStore] 初始化: ${Object.keys(this._predefinedPool).length} 个预定义角色, ${Object.keys(this._relationshipRules).length} 条关系规则`
    );
  }

  _deepClone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return value;
    }
  }

  // ==========================================
  // 状态层（state）—— v1
  // ==========================================
  // 状态层归 NPC 自己写，与身份层物理隔开。
  // 写入路径：npc-ooc.js 跑完 NPC reaction → chatCore 收到 decision → 调用 applyReactionToState
  // 不走 _pendingUpdates 审批队列（用户决议：状态层 NPC 自治）
  // Rollback：监听 NPC_REACTIONS_ROLLED_BACK，从 reactionStore 重放全部 reaction 重建 state
  // recent_thoughts cap = 5（v1 硬编码，后续如需可参数化）

  _buildEmptyState() {
    return {
      current_location: null,
      current_mood: null,
      intent_toward_player: null,
      current_social_target: null,
      recent_thoughts: [],
      last_woken_turn: null,
    };
  }

  _ensureShape(npcData) {
    if (!npcData || typeof npcData !== 'object') return;
    // 确保 card 存在
    if (!npcData.card || typeof npcData.card !== 'object' || Array.isArray(npcData.card)) {
      npcData.card = {};
    }
    // 确保 state 存在并补默认字段
    const empty = this._buildEmptyState();
    if (!npcData.state || typeof npcData.state !== 'object' || Array.isArray(npcData.state)) {
      npcData.state = empty;
    } else {
      for (const key of Object.keys(empty)) {
        if (!(key in npcData.state)) {
          npcData.state[key] = empty[key];
        }
      }
      if (!Array.isArray(npcData.state.recent_thoughts)) {
        npcData.state.recent_thoughts = [];
      }
    }
  }

  // 向后兼容老调用名
  _ensureState(npcData) {
    this._ensureShape(npcData);
  }

  /**
   * 老平铺 NPC 数据迁移为新嵌套结构 { card, state, _lastTurn?, _lastUID? }
   * - 已是新结构（顶层有 card 子对象）：直接 ensure 默认并返回
   * - 老平铺：按 NPC_STATE_KEYS / NPC_DROP_KEYS / NPC_RUNTIME_PRIVATE_KEYS 分流
   * 幂等：新结构进来短路返回
   */
  _migrateLegacyNpc(legacy) {
    if (!legacy || typeof legacy !== 'object') return legacy;
    if (legacy.card && typeof legacy.card === 'object' && !Array.isArray(legacy.card)) {
      this._ensureShape(legacy);
      return legacy;
    }
    const STATE_KEYS = new Set(window.step3SchemaBuilder?.NPC_STATE_KEYS || []);
    const DROP = new Set(window.step3SchemaBuilder?.NPC_DROP_KEYS || []);
    const PRIVATE = new Set(window.step3SchemaBuilder?.NPC_RUNTIME_PRIVATE_KEYS || []);

    const card = {};
    const state = (legacy.state && typeof legacy.state === 'object' && !Array.isArray(legacy.state))
      ? { ...legacy.state }
      : this._buildEmptyState();
    const out = { card, state };

    for (const [k, v] of Object.entries(legacy)) {
      if (k === 'state' || k === 'card') continue;
      if (DROP.has(k)) continue;
      if (PRIVATE.has(k)) { out[k] = v; continue; }   // _lastTurn / _lastUID 挂顶层
      if (STATE_KEYS.has(k)) { state[k] = v; continue; }
      card[k] = v;
    }
    // attitude_towards_player legacy → state.intent_toward_player 初值（仅当 state 还未有该值）
    if (legacy.attitude_towards_player && !state.intent_toward_player) {
      state.intent_toward_player = legacy.attitude_towards_player;
    }
    // ensure 默认 state 字段
    this._ensureShape(out);
    return out;
  }

  /**
   * facade：按字段名取值，自动路由到 card.* / state.*
   * 外部消费者（phoneUI / smsService / archive 等）调它，不感知嵌套结构
   */
  getFieldValue(npcId, field) {
    const npc = this._npcs[npcId];
    if (!npc) return undefined;
    const STATE = window.step3SchemaBuilder?.NPC_STATE_KEYS || [];
    if (STATE.includes(field)) return npc.state?.[field];
    return npc.card?.[field];
  }

  /**
   * 从预定义池条目 + analyzer 动态状态装配新嵌套结构 { card, state }
   * 白名单显式取字段，避免 analyzer / predefined 偷渡野字段（v1.5 教训）
   * 供 processNpcPanel(NEW_PREDEFINED) 和 npcTools.load_predefined_npc 共享
   * @param {string} charId
   * @param {Object} predefined - 预定义池条目（平铺老结构，来自 worldcard character_database）
   * @returns {{card: Object, state: Object}}
   */
  _buildPredefinedComposed(charId, predefined) {
    if (!predefined || typeof predefined !== 'object') {
      return { card: { id: charId }, state: this._buildEmptyState() };
    }

    // 1. card 域白名单：baseline 字段 + worldcard panel_npc 扩展字段，剔除 drop / state / 顶层主键
    const baselineKeys = (window.step3SchemaBuilder?.getDefaultNpcFields?.() || [])
      .map(f => f?.key)
      .filter(k => k && k !== 'trigger_type');
    const panelNpcKeys = (window.worldMeta?.getStep3Fields?.()?.panel_npc || [])
      .map(f => f?.key)
      .filter(k => k && k !== 'trigger_type');
    const cardWhitelist = new Set([...baselineKeys, ...panelNpcKeys]);
    const DROP = new Set(window.step3SchemaBuilder?.NPC_DROP_KEYS || []);
    for (const k of DROP) cardWhitelist.delete(k);
    const STATE_KEYS = new Set(window.step3SchemaBuilder?.NPC_STATE_KEYS || []);
    for (const k of STATE_KEYS) cardWhitelist.delete(k);
    cardWhitelist.delete('id');
    cardWhitelist.delete('name');

    // 2. analyzer 动态时间线状态（priority: analyzer > predefined）
    const _currentTime =
      typeof aiService !== 'undefined' ? aiService._getCurrentGameTime?.() : null;
    const _fullState =
      typeof AnalyzerManager !== 'undefined'
        ? AnalyzerManager.getCharacterState(charId, _currentTime) || {}
        : {};

    // 3. 装 card：白名单内字段，野字段（如 _fullState.relationships）自然丢弃
    const card = { id: charId, name: predefined.name };
    for (const key of cardWhitelist) {
      if (_fullState[key] !== undefined && _fullState[key] !== null) {
        card[key] = _fullState[key];
      } else if (predefined[key] !== undefined && predefined[key] !== null) {
        card[key] = predefined[key];
      }
    }
    // cognitive_state fallback：character_database 的 default_cognitive_state 初值约定
    if (!card.cognitive_state) {
      card.cognitive_state =
        predefined.default_cognitive_state || _fullState.cognitive_state || '未知';
    }

    // 4. state 默认值：从 predefined 取首次登场位置/态度，避免第一次 reaction 之前全 null
    const state = this._buildEmptyState();
    state.current_location =
      predefined.current_location ||
      predefined.default_site ||
      predefined.location ||
      null;
    if (!state.current_location) {
      const _lt = typeof locationTracker !== 'undefined' ? locationTracker : null;
      const _playerLoc = _lt?.getLocation?.() || null;
      state.current_location = _playerLoc?.spot || _playerLoc?.site || null;
    }
    state.intent_toward_player = predefined.attitude_towards_player || null;

    return { card, state };
  }

  /**
   * NPC 自主决策落地到 state 层
   * @param {string} npcId
   * @param {Object} decision - npc-ooc.js _parseNpcDecisionJson 的结果
   * @param {string} turnUID
   */
  applyReactionToState(npcId, decision, turnUID) {
    if (!npcId || !decision || typeof decision !== 'object') return;
    const npc = this._npcs[npcId];
    if (!npc) return;

    this._ensureShape(npc);
    const state = npc.state;

    if (typeof decision.location === 'string' && decision.location.trim()) {
      state.current_location = decision.location.trim();
    }
    if (typeof decision.mood === 'string' && decision.mood.trim()) {
      state.current_mood = decision.mood.trim();
    }
    if (typeof decision.intent_toward_player === 'string' && decision.intent_toward_player.trim()) {
      state.intent_toward_player = decision.intent_toward_player.trim();
    } else if (decision.intent_toward_player === null) {
      // 显式 null：保守起见维持上次值（如未来想清空，把下一行改成 state.intent_toward_player = null）
    }
    if (typeof decision.social_target === 'string' && decision.social_target.trim()) {
      state.current_social_target = decision.social_target.trim();
    } else if (decision.social_target === null) {
      state.current_social_target = null;
    }
    if (typeof decision.inner_thought === 'string' && decision.inner_thought.trim()) {
      state.recent_thoughts.push({
        thought: decision.inner_thought.trim(),
        turnUID: turnUID || null,
        ts: Date.now(),
      });
      while (state.recent_thoughts.length > 5) {
        state.recent_thoughts.shift();
      }
    }

    // last_woken_turn：优先从 turnUID 提取数字（格式 turn_N_xxx），不行就退回 currentTurn
    let turnNum = null;
    if (typeof turnUID === 'string') {
      const m = turnUID.match(/turn_(\d+)/i);
      if (m) turnNum = Number(m[1]);
    }
    if (turnNum == null || !Number.isFinite(turnNum)) {
      turnNum = Number(this.currentTurn) || null;
    }
    state.last_woken_turn = turnNum;

    // v2：state.* 6 字段是 NPC reaction 的唯一写入面。
    // v1.5 旧版本里 cognitive_state / current_goal / attitude_towards_player / relationships
    // 会被 reaction 写到 npc 顶层——已废弃。cognitive_state 现在归 card.*（DM 写），
    // current_goal / attitude_towards_player / relationships 全删（schema 不暴露给 LLM）。

    eventBus.emit(GameEvents.NPC_STATE_UPDATED, { npcId, state: { ...state } });
  }

  /**
   * 监听 NPC_REACTIONS_ROLLED_BACK 时调用：清空所有 NPC 的 state，按 reactionStore 全部记录重放
   */
  rebuildStateFromReactions() {
    if (typeof window === 'undefined' || !window.npcReactionStore) return;

    // 1. 清空所有 NPC 的 state
    for (const npcId of Object.keys(this._npcs)) {
      this._npcs[npcId].state = this._buildEmptyState();
    }

    // 2. 拿全部剩余 reaction，按时间顺序重放
    const all =
      typeof window.npcReactionStore.getAllReactions === 'function'
        ? window.npcReactionStore.getAllReactions()
        : window.npcReactionStore.getRecentReactions(999);

    let replayed = 0;
    for (const { turnUID, reactions } of all) {
      if (!reactions || typeof reactions !== 'object') continue;
      for (const [npcId, r] of Object.entries(reactions)) {
        if (r && r.decision) {
          this.applyReactionToState(npcId, r.decision, turnUID);
          replayed++;
        }
      }
    }
    console.log(`[npcStore] state 层已从 reactionStore 重建: ${replayed} 条 decision 回放`);
  }

  /**
   * 添加新角色（供 update_new_characters / 外部调用）
   * 若 origin='expanded' 默认未登场，存入 _predefinedPool
   * @param {string} charId
   * @param {Object} charData
   * @param {'expanded'|'predefined'} [origin='expanded']
   * @param {Object} [charRelationships] - 该角色的关系规则 (可选)
   */
  addCharacter(charId, charData, origin = 'expanded', charRelationships = null) {
    if (!charId || typeof charId !== 'string' || charId.startsWith('_')) return false;
    if (!charData || typeof charData !== 'object') return false;
    this._predefinedPool[charId] = this._deepClone(charData);
    this._charOrigin[charId] = origin === 'predefined' ? 'predefined' : 'expanded';
    if (charRelationships && typeof charRelationships === 'object') {
      this._relationshipRules[charId] = this._deepClone(charRelationships);
    }
    return true;
  }

  // ==========================================
  // 字段类型基础设施
  // ==========================================

  /**
   * 获取指定字段的定义
   * @param {string} fieldKey - 字段名
   * @returns {Object|null} - 字段定义 { key, type, enum, ... } 或 null
   */
  _getFieldDef(fieldKey) {
    const npcFields = window.worldMeta?.getStep3Fields?.()?.panel_npc;
    if (!Array.isArray(npcFields)) return null;
    return npcFields.find(f => f && f.key === fieldKey) || null;
  }

  /**
   * 判断值是否为合法整数字符串（整串匹配）
   * @param {any} value - 待校验的值
   * @returns {boolean}
   */
  _isValidInteger(value) {
    if (typeof value === 'number') return Number.isInteger(value);
    return /^-?\d+$/.test(String(value).trim());
  }

  /**
   * 类型回转 + 校验（手动编辑用）
   * @param {string} fieldKey - 字段名
   * @param {any} rawValue - 用户输入的原始值
   * @returns {{ ok: boolean, value: any, reason?: string }}
   */
  _coerceFieldValue(fieldKey, rawValue) {
    const fieldDef = this._getFieldDef(fieldKey);
    if (!fieldDef) return { ok: true, value: rawValue };

    // enum 校验（支持复合枚举值的子部分匹配，如 "冷静" 匹配 "冷静/理性"）
    if (Array.isArray(fieldDef.enum) && fieldDef.enum.length > 0) {
      const strValue = String(rawValue).trim();
      const allowed = new Set();
      for (const ev of fieldDef.enum) {
        allowed.add(ev);
        if (typeof ev === 'string' && ev.includes('/')) {
          for (const part of ev.split('/').map(s => s.trim()).filter(Boolean)) {
            allowed.add(part);
          }
        }
      }
      if (!allowed.has(strValue)) {
        return {
          ok: false,
          value: rawValue,
          reason: `"${strValue}" 不在枚举 [${fieldDef.enum.join(', ')}] 中`,
        };
      }
      return { ok: true, value: strValue };
    }

    // integer 校验
    if (fieldDef.type === 'integer') {
      const strValue = String(rawValue).trim();
      if (!this._isValidInteger(strValue)) {
        return {
          ok: false,
          value: rawValue,
          reason: `"${strValue}" 不是合法整数`,
        };
      }
      return { ok: true, value: Number(strValue) };
    }

    return { ok: true, value: rawValue };
  }

  /**
   * 批量修复 NPC 数据中的字段类型（存档恢复 / 预定义角色加载用）
   * 非破坏性策略：只修能修的，不合法的保留原值
   * @param {Object} npcData - NPC 数据
   * @returns {Object} - 修复后的数据
   */
  _coerceAllFields(npcData) {
    if (!npcData || typeof npcData !== 'object') return npcData;
    const npcFields = window.worldMeta?.getStep3Fields?.()?.panel_npc;
    if (!Array.isArray(npcFields)) return npcData;

    const result = { ...npcData };
    for (const fieldDef of npcFields) {
      if (!fieldDef || !fieldDef.key) continue;
      const key = fieldDef.key;
      if (!(key in result)) continue;
      const currentValue = result[key];

      // integer：可转为整数的字符串 → Number
      if (fieldDef.type === 'integer' && typeof currentValue === 'string') {
        if (this._isValidInteger(currentValue)) {
          result[key] = Number(currentValue);
        }
        // 不合法的保留原值
      }
      // enum：不做强制修复（保留原值，避免存档丢数据）
    }
    return result;
  }

  /**
   * 类型安全的字段值比较
   * @param {string} fieldKey - 字段名
   * @param {any} a - 值 A
   * @param {any} b - 值 B
   * @returns {boolean}
   */
  _isFieldValueEqual(fieldKey, a, b) {
    const fieldDef = this._getFieldDef(fieldKey);
    if (fieldDef && fieldDef.type === 'integer') {
      // 双方都是合法整数时用数字比较
      if (this._isValidInteger(a) && this._isValidInteger(b)) {
        return Number(a) === Number(b);
      }
    }
    return a === b;
  }

  /**
   * 校验并修正 NPC 所有带 enum 约束的字段
   * @param {Object} npcData - NPC 数据对象
   * @returns {Object} - 修正后的 NPC 数据
   */
  _validateNpcFields(npcData) {
    if (!npcData || typeof npcData !== 'object') return npcData;

    const npcFields = window.worldMeta?.getStep3Fields?.()?.panel_npc;
    if (!Array.isArray(npcFields)) return npcData;

    let result = { ...npcData };
    for (const fieldDef of npcFields) {
      if (!fieldDef || !fieldDef.key) continue;
      const key = fieldDef.key;
      // enum 元素一律 normalize 成非空 string（schema 里可能混入数字等）
      const validList = Array.isArray(fieldDef.enum)
        ? fieldDef.enum
            .map(v => (v === null || v === undefined ? '' : String(v).trim()))
            .filter(Boolean)
        : null;
      if (!validList || validList.length === 0) continue;
      if (!(key in result) || result[key] === null || result[key] === undefined) continue;

      const rawValue = String(result[key]).trim();
      if (!rawValue) continue;

      if (validList.includes(rawValue)) continue;

      // 尝试模糊匹配（normalize 后 validList 元素一定是 string）
      const fuzzyMatch = validList.find(p => rawValue.includes(p) || p.includes(rawValue));
      if (fuzzyMatch) {
        console.warn(`[npcStore] ${key} 修正: "${rawValue}" -> "${fuzzyMatch}"`);
        result[key] = fuzzyMatch;
        continue;
      }

      // 无法匹配，随机选择
      const randomValue = validList[Math.floor(Math.random() * validList.length)];
      console.warn(`[npcStore] ${key} 无效: "${rawValue}" -> 随机分配: "${randomValue}"`);
      result[key] = randomValue;
    }
    return result;
  }

  _sanitizePersistentNpcData(npcData) {
    if (!npcData || typeof npcData !== 'object') return npcData;
    const sanitized = { ...npcData };
    // 1) schema-drop：v1.5 野字段 + transport + 历史字段（如果意外残留在顶层）
    const DROP = Array.isArray(window.step3SchemaBuilder?.NPC_DROP_KEYS)
      ? window.step3SchemaBuilder.NPC_DROP_KEYS
      : ['current_goal', 'attitude_towards_player', 'relationships', 'trigger_type', 'age'];
    for (const k of DROP) delete sanitized[k];
    // 2) card 内同样剥掉（防御 LLM 在 card 里塞了 drop 字段）
    if (sanitized.card && typeof sanitized.card === 'object' && !Array.isArray(sanitized.card)) {
      const cleanCard = { ...sanitized.card };
      for (const k of DROP) delete cleanCard[k];
      sanitized.card = cleanCard;
    }
    return sanitized;
  }

  _getRuntimeLockedUpdateFieldSet() {
    // 身份层永不可改（创建后锁定）
    const locked = Array.isArray(window.step3SchemaBuilder?.NPC_RUNTIME_LOCKED_UPDATE_KEYS)
      ? window.step3SchemaBuilder.NPC_RUNTIME_LOCKED_UPDATE_KEYS
      : ['trigger_type', 'id', 'name', 'gender', 'origin', 'birthday', 'age'];
    // v2 设计：NPC 自治字段（NPC_STATE_KEYS）不再由 DM 经 update_npc 写——schema 层
    // 就不暴露它们；store 内部 queueUpdate 输入归一化时也不会把 state 字段进入 card 差异
    // 流程。所以这里**不需要**再二道合并 STATE keys。
    return new Set(locked);
  }

  _sanitizePendingChange(change, fallbackTurn = 0, fallbackUid = null) {
    if (!change || typeof change !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(change, 'new')) return null;

    const rawTurn = change.turn ?? fallbackTurn ?? 0;
    const parsedTurn = Number(rawTurn);

    return {
      old: Object.prototype.hasOwnProperty.call(change, 'old') ? change.old : null,
      new: change.new,
      turn: Number.isFinite(parsedTurn) ? parsedTurn : 0,
      uid: change.uid ?? fallbackUid ?? null,
    };
  }

  _sanitizePendingInfo(pendingInfo) {
    if (!pendingInfo || typeof pendingInfo !== 'object') return null;
    const lockedFields = this._getRuntimeLockedUpdateFieldSet();
    const nextChanges = {};
    const rawChanges =
      pendingInfo.changes && typeof pendingInfo.changes === 'object' ? pendingInfo.changes : {};

    for (const [field, change] of Object.entries(rawChanges)) {
      if (lockedFields.has(field)) continue;
      const nextChange = this._sanitizePendingChange(change, pendingInfo.turn, pendingInfo.uid);
      if (!nextChange) continue;
      nextChanges[field] = nextChange;
    }

    if (Object.keys(nextChanges).length === 0) return null;

    return {
      changes: nextChanges,
    };
  }

  _emitPendingState(npcId, pendingInfo) {
    const nextPending = this._sanitizePendingInfo(pendingInfo);
    if (!nextPending) {
      delete this._pendingUpdates[npcId];
      eventBus.emit(GameEvents.NPC_PENDING_CLEARED, { npcId });
      return null;
    }

    this._pendingUpdates[npcId] = nextPending;
    eventBus.emit(GameEvents.NPC_PENDING, { npcId, pendingInfo: nextPending });
    return nextPending;
  }

  _shouldReplaceRuntimeMeta(currentTurn, currentUid, nextTurn, nextUid) {
    const safeCurrentTurn = Number.isFinite(Number(currentTurn)) ? Number(currentTurn) : 0;
    const safeNextTurn = Number.isFinite(Number(nextTurn)) ? Number(nextTurn) : 0;

    if (currentUid && nextUid && typeof isUIDAfter === 'function') {
      if (isUIDAfter(nextUid, currentUid)) return true;
      if (isUIDAfter(currentUid, nextUid)) return false;
    }

    if (safeNextTurn !== safeCurrentTurn) {
      return safeNextTurn > safeCurrentTurn;
    }

    return !currentUid && !!nextUid;
  }

  _applyRuntimeMeta(targetData, turn = 0, uid = null) {
    if (!targetData || (!turn && !uid)) return;

    const currentTurn = targetData._lastTurn || 0;
    const currentUid = targetData._lastUID || null;

    if (this._shouldReplaceRuntimeMeta(currentTurn, currentUid, turn, uid)) {
      targetData._lastTurn = Number.isFinite(Number(turn)) ? Number(turn) : currentTurn;
      targetData._lastUID = uid ?? currentUid;
      return;
    }

    if (!targetData._lastUID && uid) {
      targetData._lastUID = uid;
    }
    if (!targetData._lastTurn && turn) {
      targetData._lastTurn = Number(turn) || 0;
    }
  }

  _sanitizeRejectedUpdates(rejectedUpdates) {
    if (!rejectedUpdates || typeof rejectedUpdates !== 'object') return {};
    const lockedFields = this._getRuntimeLockedUpdateFieldSet();
    const sanitized = {};

    for (const [npcId, fields] of Object.entries(rejectedUpdates)) {
      if (!fields || typeof fields !== 'object') continue;
      const nextFields = {};
      for (const [field, info] of Object.entries(fields)) {
        if (lockedFields.has(field)) continue;
        nextFields[field] = info;
      }
      if (Object.keys(nextFields).length > 0) {
        sanitized[npcId] = nextFields;
      }
    }

    return sanitized;
  }

  _sanitizePendingUpdates(pendingUpdates) {
    if (!pendingUpdates || typeof pendingUpdates !== 'object') return {};
    const sanitized = {};
    for (const [npcId, pendingInfo] of Object.entries(pendingUpdates)) {
      const nextPending = this._sanitizePendingInfo(pendingInfo);
      if (nextPending) {
        sanitized[npcId] = nextPending;
      }
    }
    return sanitized;
  }

  // ==========================================
  // ID 解析逻辑
  // ==========================================

  /**
   * 解析 NPC ID
   * @param {Object} npcData - NPC 数据
   * @returns {{ npcId: string, npcData: Object }} - ID 和数据
   */
  _resolveId(npcData) {
    const npcId = npcData.id || npcData.card?.id || npcData.name || npcData.card?.name;
    return { npcId, npcData };
  }

  /**
   * 按名字查找现有 NPC 的 ID
   * @param {string} name - NPC 名字
   * @returns {string|null} - 找到的 ID 或 null
   */
  _findIdByName(name) {
    if (!name) return null;

    // 从现有数据查找（card 子对象内的 name 是权威）
    const entry = Object.entries(this._npcs).find(([_id, data]) => {
      const npcName = data?.card?.name;
      return npcName && npcName.toLowerCase() === name.toLowerCase();
    });
    return entry ? entry[0] : null;
  }

  // ==========================================
  // 统一入口 (合并 renderer 中的重复逻辑)
  // ==========================================

  /**
   * 处理 panel_npc 数据 (统一入口)
   * @param {Array|Object} panelNpc - AI 返回的 panel_npc 数据
   * @param {number} turn - 轮次
   * @param {string} uid - UID
   */
  processNpcPanel(panelNpc, turn = 0, uid = null) {
    if (!panelNpc) return;

    const items = Array.isArray(panelNpc) ? panelNpc : [panelNpc];

    for (const npcItem of items) {
      if (!npcItem) continue;

      // 安全网：如果 AI 对未登场角色错误使用了非 NEW_PREDEFINED 类型，自动修正
      // 匹配条件：角色存在于 _predefinedPool 中（预定义或 expanded 尚未登场）
      if (npcItem.trigger_type !== 'NEW_PREDEFINED' && (npcItem.name || npcItem.id)) {
        const _shouldConvert =
          npcItem.trigger_type === 'NEW' ||
          (npcItem.trigger_type === 'UPDATE' && !this._npcs[npcItem.id]);
        if (_shouldConvert) {
          const _pool = {};
          for (const [cid, char] of Object.entries(this._predefinedPool)) {
            if (!cid.startsWith('_')) _pool[cid] = char;
          }
          // 仅在保守匹配类型下自动转换，避免把全新角色误判为预定义
          const _SAFE_KINDS = new Set(['exact_id', 'normalized_id', 'exact_name']);
          const _tryLookups = [npcItem.name, npcItem.id].filter(Boolean);
          for (const _lookup of _tryLookups) {
            const _m = window.resolvePredefinedMatch?.(_lookup, _pool);
            if (_m && !_m.ambiguous && _SAFE_KINDS.has(_m.matchKind)) {
              console.warn(
                `[npcStore] 安全网: AI 对未登场角色 "${_lookup}" 使用了 ${npcItem.trigger_type}，自动修正为 NEW_PREDEFINED (${_m.id}, ${_m.matchKind})`
              );
              npcItem.trigger_type = 'NEW_PREDEFINED';
              npcItem.id = _m.id;
              break;
            }
          }
        }
      }

      // 预定义角色登场：从 _predefinedPool 取出 → _buildPredefinedComposed 白名单装配 → 加入 _npcs
      if (npcItem.trigger_type === 'NEW_PREDEFINED') {
        const charId = npcItem.id;
        if (!charId) continue;
        const predefined = this._predefinedPool[charId];
        if (!predefined) {
          console.warn(`[npcStore] NEW_PREDEFINED: 找不到未登场角色 ${charId}`);
          continue;
        }
        const composed = this._buildPredefinedComposed(charId, predefined);
        setTimeout(() => {
          if (this._npcs[charId] || this.isDeleted(charId)) return;
          // 传嵌套结构给 add；trigger_type=NEW 让 add 走"首次登场"分支
          this.add(
            { trigger_type: 'NEW', id: charId, card: composed.card, state: composed.state },
            turn,
            uid
          );
          delete this._predefinedPool[charId];
          console.log(`[npcStore] 预定义角色已加载: ${composed.card.name || predefined.name} (${charId})`);
        }, 0);
        continue;
      }

      // 扁平化结构：npcItem 直接包含所有字段
      if (!npcItem.name && !npcItem.id) continue;

      const isNew = npcItem.trigger_type === 'NEW';
      const npcData = npcItem;

      // 使用 setTimeout 确保在当前渲染周期后执行
      setTimeout(() => {
        // 检查 NPC 是否已存在（通过 ID 或名字查找）
        const npcId = npcData.id || npcData.name;
        let npcExists = !!this._npcs[npcId];

        // 如果直接 ID 找不到，尝试按名字查找
        if (!npcExists && npcData.name) {
          const foundId = this._findIdByName(npcData.name);
          npcExists = !!foundId && !!this._npcs[foundId];
        }

        if (isNew && !npcExists) {
          // 真正的新角色：trigger_type 是 NEW 且 NPC 不存在
          this.add(npcData, turn, uid);
        } else if (npcExists) {
          // NPC 已存在：无论 trigger_type 是 NEW 还是 UPDATE，都走审批流程
          // 这修复了 AI 错误返回 NEW 时绕过审批的问题
          const result = this.queueUpdate(npcData, turn, uid);
          // result 可能是:
          // - 'queued': 已加入审批队列
          // - 'no_changes': 无实际变更，不需要处理
          // - 'deleted': NPC 已被删除，不处理
          // - 'not_found': NPC 不存在（不应该发生，因为我们已检查 npcExists）
          if (result === 'not_found') {
            // 极端情况：在检查和执行之间 NPC 被删除/清理
            this.add(npcData, turn, uid);
          }
          // 'queued' 和 'no_changes' 不需要额外处理
        } else {
          // trigger_type 是 UPDATE 但 NPC 不存在，当作 NEW 处理
          this.add(npcData, turn, uid);
        }
      }, 0);
    }
  }

  // ==========================================
  // 核心方法
  // ==========================================

  /**
   * 新增或更新 NPC
   * @param {Object} npcData - NPC 数据
   * @param {number} turn - 轮次
   * @param {string} uid - UID
   * @returns {boolean} - 是否成功
   */
  add(npcData, turn = 0, uid = null) {
    // 1) 校验 + 清理（_validateNpcFields/_coerceAllFields 仍按 worldcard panel_npc 字段走；
    //    新嵌套结构下 card 子对象会被校验逻辑识别，因为我们在校验前归一化）
    //    输入可能是：(a) 新嵌套 {trigger_type, id, name, card, state}，
    //                (b) 老平铺 {gender, msg_reply_tone, ...}，
    //                (c) NEW_PREDEFINED 装配出的 {trigger_type, id, name, card, state}。
    npcData = this._sanitizePersistentNpcData(npcData);
    npcData = this._migrateLegacyNpc(npcData);
    // 校验 card 子对象内的 enum / integer
    if (npcData.card) {
      npcData.card = this._validateNpcFields(npcData.card);
      npcData.card = this._coerceAllFields(npcData.card);
    }

    // 2) 解析 ID（兼容三种来源：顶层 id（NEW_PREDEFINED 传入）、card.id（新嵌套）、card.name fallback）
    const npcId = npcData.id || npcData.card?.id || npcData.card?.name;
    if (!npcId) {
      console.warn('[npcStore] add: 无法解析 NPC ID', npcData);
      return false;
    }

    // 检查是否已被删除
    if (npcId in this._deletedIds) {
      console.log(`[npcStore] 跳过已删除的 NPC: ${npcId}`);
      return false;
    }

    // 3) 合并策略：已存在则保留现有数据，仅补充缺失字段
    const existingData = this._npcs[npcId];
    const npcAlreadyExists = !!existingData && !!existingData.card;
    let mergedData;
    if (npcAlreadyExists) {
      // card 合并：incoming 优先（同字段覆盖现有），existing 补充
      const mergedCard = { ...existingData.card, ...(npcData.card || {}) };
      // state 不被 add 覆盖（NEW_PREDEFINED 例外，由 _ensureShape 装配；UPDATE/NEW 时丢弃 incoming.state）
      const mergedState = existingData.state || npcData.state || this._buildEmptyState();
      mergedData = { card: mergedCard, state: mergedState };
      // 保留私有元数据
      if (existingData._lastTurn != null) mergedData._lastTurn = existingData._lastTurn;
      if (existingData._lastUID) mergedData._lastUID = existingData._lastUID;
    } else {
      mergedData = {
        card: { ...(npcData.card || {}) },
        state: npcData.state || this._buildEmptyState(),
      };
    }
    // 确保 card 内的 id/name（card 子对象单独传递时仍含权威信息）
    if (!mergedData.card.id) mergedData.card.id = npcId;
    if (!mergedData.card.name && npcData.name) mergedData.card.name = npcData.name;

    // 4) 更新私有运行时元数据
    const existingTurn = mergedData._lastTurn || 0;
    const shouldUpdateMeta = !npcAlreadyExists || turn > existingTurn;
    mergedData._lastTurn = shouldUpdateMeta ? turn : existingTurn;
    if (shouldUpdateMeta && uid) mergedData._lastUID = uid;

    // 5) ensure 形状
    this._ensureShape(mergedData);

    // 保存数据
    this._npcs[npcId] = mergedData;

    // 更新排序
    if (!this._order.includes(npcId)) {
      this._order.unshift(npcId);
    }

    // 触发事件（npcPanelUI 通过 EventBus 订阅）
    eventBus.emit(GameEvents.NPC_ADDED, {
      npcId,
      data: mergedData,
      turn,
      uid,
      isUpdate: npcAlreadyExists,
    });

    console.log(`[npcStore] ${npcAlreadyExists ? '更新' : '新增'} NPC: ${npcId}`);
    return true;
  }

  /**
   * 将更新加入待审批队列
   * @param {Object} npcData - 新数据
   * @param {number} turn - 轮次
   * @param {string} uid - UID
   * @returns {string} - 结果状态: 'queued' | 'no_changes' | 'deleted' | 'not_found'
   */
  queueUpdate(npcData, turn = 0, uid = null) {
    // 归一化输入：可能是 {id, card:{...}} 嵌套 或 老平铺 {gender,clothing,...}
    npcData = this._sanitizePersistentNpcData(npcData);
    npcData = this._migrateLegacyNpc(npcData);
    // queueUpdate 永远不接受 incoming state（state 归 NPC 自治）
    if (npcData.state) {
      const next = { ...npcData, state: undefined };
      delete next.state;
      npcData = next;
    }
    // card 内的字段校验
    if (npcData.card) {
      npcData.card = this._validateNpcFields(npcData.card);
      npcData.card = this._coerceAllFields(npcData.card);
    }

    const npcId = npcData.id || npcData.card?.id || npcData.card?.name;

    // 检查是否已被删除
    if (npcId in this._deletedIds) {
      console.log(`[npcStore] 跳过已删除 NPC 的更新: ${npcId}`);
      return 'deleted';
    }

    let existingData = this._npcs[npcId];
    let actualNpcId = npcId;

    // 尝试按名字查找
    if (!existingData && npcData.card?.name) {
      const foundId = this._findIdByName(npcData.card.name);
      if (foundId) {
        actualNpcId = foundId;
        existingData = this._npcs[actualNpcId];
        console.log(`[npcStore] 从名字纠正 ID: ${npcId} -> ${actualNpcId}`);
      }

      // 再次检查删除列表
      if (existingData && actualNpcId in this._deletedIds) {
        console.log(`[npcStore] 跳过已删除 NPC 的更新: ${actualNpcId}`);
        return 'deleted';
      }
    }

    // NPC 不存在
    if (!existingData) {
      console.warn(`[npcStore] 无法队列更新: NPC ${npcId} 不存在`);
      return 'not_found';
    }

    // 确保 existingData 是新结构（兼容存量数据）
    this._ensureShape(existingData);

    const lockedFields = this._getRuntimeLockedUpdateFieldSet();
    const rejectedForNpc = this._rejectedUpdates[actualNpcId] || {};
    const ignoredLockedFields = [];

    const existingPending = this._sanitizePendingInfo(this._pendingUpdates[actualNpcId]);
    if (existingPending) {
      this._pendingUpdates[actualNpcId] = existingPending;
    } else {
      delete this._pendingUpdates[actualNpcId];
    }

    const mergedChanges = existingPending ? { ...existingPending.changes } : {};
    let pendingChanged = false;
    let hasIncomingPendingChange = false;

    // 遍历 incoming card 字段（扁平 key）
    const incomingCard = npcData.card || {};
    for (const key in incomingCard) {
      const nextValue = incomingCard[key];
      if (lockedFields.has(key)) {
        if (nextValue !== existingData.card[key]) ignoredLockedFields.push(key);
        continue;
      }

      if (this._isFieldValueEqual(key, nextValue, existingData.card[key])) {
        if (Object.prototype.hasOwnProperty.call(mergedChanges, key)) {
          delete mergedChanges[key];
          pendingChanged = true;
        }
        continue;
      }

      const rejected = rejectedForNpc[key];
      if (rejected && this._isFieldValueEqual(key, rejected.value, nextValue)) {
        console.log(`[npcStore] 跳过已拒绝的更新: ${actualNpcId}.${key}`);
        continue;
      }

      hasIncomingPendingChange = true;
      const nextChange = {
        old: existingData.card[key],
        new: nextValue,
        turn,
        uid,
      };
      const prevChange = mergedChanges[key];
      if (
        !prevChange ||
        prevChange.old !== nextChange.old ||
        prevChange.new !== nextChange.new ||
        prevChange.turn !== nextChange.turn ||
        prevChange.uid !== nextChange.uid
      ) {
        pendingChanged = true;
      }
      mergedChanges[key] = nextChange;
    }

    if (Object.keys(mergedChanges).length === 0) {
      if (existingPending) {
        delete this._pendingUpdates[actualNpcId];
        eventBus.emit(GameEvents.NPC_PENDING_CLEARED, { npcId: actualNpcId });
      }
      if (ignoredLockedFields.length > 0) {
        console.log(
          `[npcStore] UPDATE 已忽略锁定字段变更: ${actualNpcId} -> ${ignoredLockedFields.join(', ')}`
        );
      }
      console.log(`[npcStore] UPDATE 无实际变更: ${actualNpcId}`);
      return 'no_changes';
    }

    if (!pendingChanged) {
      if (ignoredLockedFields.length > 0) {
        console.log(
          `[npcStore] UPDATE 已忽略锁定字段变更: ${actualNpcId} -> ${ignoredLockedFields.join(', ')}`
        );
      }
      console.log(`[npcStore] UPDATE 无实际变更: ${actualNpcId}`);
      return 'no_changes';
    }

    const nextPending = this._emitPendingState(actualNpcId, { changes: mergedChanges });
    console.log(
      `[npcStore] UPDATE ${hasIncomingPendingChange ? '已加入待审批队列' : '已刷新待审批队列'}: ${actualNpcId}`,
      nextPending?.changes || mergedChanges
    );

    if (this._autoApprove) {
      // 自动审批：把刚入队的所有字段立即 approve（保留 rejected 黑名单已在前面跳过）
      for (const field of Object.keys(mergedChanges)) {
        this.approveField(actualNpcId, field);
      }
    }

    return 'queued';
  }

  // ==========================================
  // 自动审批开关
  // ==========================================

  /**
   * 切换自动审批模式
   * @param {boolean} enabled - true: 自动通过；false: 维持手动
   */
  setAutoApprove(enabled) {
    this._autoApprove = !!enabled;
    if (!this._autoApprove) return;
    // 自动态：把存量 pending 全部 approve（也用于存档恢复后的二次 flush）
    const snapshot = Object.entries(this._pendingUpdates).map(([npcId, pending]) => ({
      npcId,
      fields: pending && pending.changes ? Object.keys(pending.changes) : [],
    }));
    for (const { npcId, fields } of snapshot) {
      for (const field of fields) {
        this.approveField(npcId, field);
      }
    }
  }

  isAutoApprove() {
    return this._autoApprove;
  }

  /**
   * 批准单个字段的更新
   * @param {string} npcId - NPC ID
   * @param {string} field - 字段名
   */
  approveField(npcId, field) {
    const pending = this._sanitizePendingInfo(this._pendingUpdates[npcId]);
    if (pending) {
      this._pendingUpdates[npcId] = pending;
    } else {
      delete this._pendingUpdates[npcId];
      eventBus.emit(GameEvents.NPC_PENDING_CLEARED, { npcId });
      this._triggerSave();
      return;
    }
    if (!pending || !pending.changes[field]) return;

    const fieldChange = pending.changes[field];

    if (this._getRuntimeLockedUpdateFieldSet().has(field)) {
      delete pending.changes[field];
      this._emitPendingState(npcId, pending);
      this._triggerSave();
      return;
    }

    let newValue = fieldChange.new;

    // 类型回转（防御历史遗留 pending 数据类型不一致）
    const coerced = this._coerceFieldValue(field, newValue);
    if (coerced.ok) newValue = coerced.value;

    // 应用更新到 card 域（pending 字段都属于 card.*）
    if (this._npcs[npcId]) {
      this._ensureShape(this._npcs[npcId]);
      this._npcs[npcId].card[field] = newValue;
      this._applyRuntimeMeta(this._npcs[npcId], fieldChange.turn, fieldChange.uid);
    }

    // 移除该字段
    delete pending.changes[field];

    console.log(`[npcStore] 字段已批准: ${npcId}.${field} = "${newValue}"`);

    // 触发事件（npcPanelUI 通过 EventBus 订阅）
    eventBus.emit(GameEvents.NPC_APPROVED, {
      npcId,
      field,
      newValue,
      turn: fieldChange.turn,
      uid: fieldChange.uid,
    });

    this._emitPendingState(npcId, pending);

    // 触发保存
    this._triggerSave();
  }

  /**
   * 拒绝单个字段的更新
   * @param {string} npcId - NPC ID
   * @param {string} field - 字段名
   */
  rejectField(npcId, field) {
    const pending = this._sanitizePendingInfo(this._pendingUpdates[npcId]);
    if (pending) {
      this._pendingUpdates[npcId] = pending;
    } else {
      delete this._pendingUpdates[npcId];
      eventBus.emit(GameEvents.NPC_PENDING_CLEARED, { npcId });
      this._triggerSave();
      return;
    }
    if (!pending || !pending.changes[field]) return;

    const fieldChange = pending.changes[field];
    const rejectedValue = fieldChange.new;

    // 记录拒绝
    if (!this._rejectedUpdates[npcId]) {
      this._rejectedUpdates[npcId] = {};
    }
    this._rejectedUpdates[npcId][field] = {
      value: rejectedValue,
      turn: fieldChange.turn,
      uid: fieldChange.uid,
    };

    // 移除该字段
    delete pending.changes[field];

    console.log(`[npcStore] 字段已拒绝: ${npcId}.${field} = "${rejectedValue}"`);

    // 触发事件
    eventBus.emit(GameEvents.NPC_REJECTED, { npcId, field, rejectedValue });

    this._emitPendingState(npcId, pending);

    // 触发保存
    this._triggerSave();
  }

  /**
   * 获取当前主聊天的 UID（用于回滚追踪）
   * @returns {string|null}
   */
  _getCurrentUID() {
    if (typeof chatHistory !== 'undefined') {
      const lastAi = [...chatHistory].reverse().find(m => m.sender === 'ai');
      return lastAi?.uid || null;
    }
    return null;
  }

  /**
   * 删除 NPC
   * @param {string} npcId - NPC ID
   */
  delete(npcId) {
    const npcData = this._npcs[npcId];
    if (!npcData) return;

    const npcName = npcData.card?.name || npcData.name || npcId;

    // 记录删除时的 UID（用于回滚时恢复）
    const currentUID = this._getCurrentUID();
    this._deletedIds[npcId] = currentUID;

    // 删除数据
    delete this._npcs[npcId];

    // 从排序中移除
    this._order = this._order.filter(id => id !== npcId);

    // 清除待审批
    delete this._pendingUpdates[npcId];

    // 清除选中状态
    this._unselectedIds.delete(npcId);

    console.log(`[npcStore] 已删除 NPC: ${npcId} (UID: ${currentUID})`);

    // 触发事件（npcPanelUI 通过 EventBus 订阅）
    eventBus.emit(GameEvents.NPC_DELETED, { npcId, npcName });

    // 触发保存
    this._triggerSave();
  }

  /**
   * 更新单个字段
   * @param {string} npcId - NPC ID
   * @param {string} field - 字段名
   * @param {any} value - 新值
   * @returns {boolean} - 是否成功
   */
  updateField(npcId, field, value) {
    if (!this._npcs[npcId]) return false;

    // 类型回转 + 校验（integer / enum）
    const coerced = this._coerceFieldValue(field, value);
    if (!coerced.ok) {
      console.warn(`[npcStore] 字段校验失败: ${npcId}.${field} — ${coerced.reason}`);
      return false;
    }
    value = coerced.value;

    // 动态 tab 只读决定：updateField 只服务 card 域。state 字段不允许手动编辑。
    this._ensureShape(this._npcs[npcId]);
    const oldValue = this._npcs[npcId].card[field];
    this._npcs[npcId].card[field] = value;
    const currentUid = this._getCurrentUID();

    console.log(`[npcStore] 已更新 ${npcId}.${field}: "${oldValue}" -> "${value}"`);

    // 触发事件（npcPanelUI 通过 EventBus 订阅）
    eventBus.emit(GameEvents.NPC_UPDATED, {
      npcId,
      field,
      value,
      oldValue,
      uid: currentUid,
    });

    // 触发保存
    this._triggerSave();

    return true;
  }

  /**
   * 设置选中状态
   * @param {string} npcId - NPC ID
   * @param {boolean} selected - 是否选中
   */
  setSelected(npcId, selected) {
    if (selected) {
      this._unselectedIds.delete(npcId);
    } else {
      this._unselectedIds.add(npcId);
    }

    // 触发事件
    eventBus.emit(GameEvents.NPC_SELECTED, { npcId, selected });

    // 触发保存
    this._triggerSave();
  }

  /**
   * 切换选中状态
   * @param {string} npcId - NPC ID
   * @returns {boolean} - 切换后的状态
   */
  toggleSelected(npcId) {
    const newState = this._unselectedIds.has(npcId);
    this.setSelected(npcId, newState);
    return newState;
  }

  /**
   * 更新排序
   * @param {string[]} newOrder - 新的排序数组
   */
  reorder(newOrder) {
    this._order = newOrder;

    // 触发事件
    eventBus.emit(GameEvents.NPC_REORDERED, { newOrder });

    // 触发保存
    this._triggerSave();
  }

  /**
   * 回滚到指定轮次
   * @param {number} targetTurn - 目标轮次
   */
  rollbackToTurn(targetTurn) {
    const toDelete = [];

    for (const npcId in this._npcs) {
      if (this._npcs[npcId]._lastTurn >= targetTurn) {
        toDelete.push(npcId);
      }
    }

    for (const npcId of toDelete) {
      delete this._npcs[npcId];
      this._order = this._order.filter(id => id !== npcId);
      eventBus.emit(GameEvents.NPC_DELETED, { npcId, npcName: null });
    }

    if (toDelete.length > 0) {
      console.log(`[npcStore] 已回滚 ${toDelete.length} 个 NPC (Turn >= ${targetTurn})`);
    }
  }

  // ==========================================
  // 查询接口
  // ==========================================

  /**
   * 获取单个 NPC
   * @param {string} npcId - NPC ID
   * @returns {Object|null} - NPC 数据
   */
  get(npcId) {
    return this._npcs[npcId] || null;
  }

  /**
   * 主角最小模型：从预定义池里找 role==='主角' 的条目，复用 _buildPredefinedComposed
   * 装出 card（身份层），state 强制空壳（用户决议：主角不接 AI 状态管道）。
   * 不进 _npcs / _order，不参与路由/审批/拖拽，仅供角色 stage 顶部传说卡渲染。
   * @returns {{id: string, card: Object, state: Object}|null}
   */
  getProtagonist() {
    const pool = this._predefinedPool || {};
    for (const id of Object.keys(pool)) {
      const entry = pool[id];
      const role = entry && typeof entry === 'object' ? String(entry.role || '') : '';
      if (role === '主角' || role.toLowerCase() === 'protagonist') {
        const composed = this._buildPredefinedComposed(id, entry);
        return { id, card: composed.card, state: this._buildEmptyState() };
      }
    }
    return null;
  }

  /**
   * 获取所有 NPC (按排序)
   * @returns {Object[]} - NPC 数据数组
   */
  getAll() {
    return this._order.filter(id => this._npcs[id]).map(id => this._npcs[id]);
  }

  /**
   * 获取所有 NPC 的 Map
   * @returns {Object} - { npcId: npcData }
   */
  getAllMap() {
    return { ...this._npcs };
  }

  /**
   * 获取选中的 NPC
   * @returns {Object[]} - 选中的 NPC 数据数组
   */
  getSelected() {
    return this._order
      .filter(id => this._npcs[id] && !this._unselectedIds.has(id))
      .map(id => this._npcs[id]);
  }

  /**
   * 获取选中 NPC 的 JSON 字符串（剥掉 _ 开头的私有运行时元数据，避免污染 LLM prompt）
   * @returns {string} - JSON 字符串
   */
  getSelectedJSON() {
    const selected = this.getSelected();
    if (selected.length === 0) return '';
    const replacer = (key, value) => (typeof key === 'string' && key.startsWith('_')) ? undefined : value;
    return selected.map(npc => JSON.stringify(npc, replacer, 2)).join('\n\n');
  }

  /**
   * 查询是否选中
   * @param {string} npcId - NPC ID
   * @returns {boolean} - 是否选中
   */
  isSelected(npcId) {
    return !this._unselectedIds.has(npcId);
  }

  /**
   * 获取待审批信息
   * @param {string} npcId - NPC ID
   * @returns {Object|null} - 待审批信息
   */
  getPending(npcId) {
    return this._pendingUpdates[npcId] || null;
  }

  /**
   * 获取所有待审批
   * @returns {Object} - { npcId: pendingInfo }
   */
  getAllPending() {
    return { ...this._pendingUpdates };
  }

  /**
   * 获取排序顺序
   * @returns {string[]} - NPC ID 数组
   */
  getOrder() {
    return [...this._order];
  }

  /**
   * 检查 NPC 是否存在
   * @param {string} npcId - NPC ID
   * @returns {boolean}
   */
  has(npcId) {
    return !!this._npcs[npcId];
  }

  /**
   * 检查 NPC 是否已被删除
   * @param {string} npcId - NPC ID
   * @returns {boolean}
   */
  isDeleted(npcId) {
    return npcId in this._deletedIds;
  }

  // ==========================================
  // 全量角色查询（含未登场的预定义 + 扩展角色）
  // 供 search_world / prompt 组装 / analyzer 等使用
  // ==========================================

  /**
   * 返回 character_database 格式的全部角色数据
   * 合并未登场池 + 已登场 NPC，以 pool 为基础、已登场为覆盖
   * 已登场 NPC 是新嵌套结构 {card, state}——这里展平 card.* 到顶层以维持
   * character_database 平铺契约，方便下游 analyzer / timelineService / expandTools 等消费
   * @returns {Object|null} { charId: charData, ... }
   */
  getCharacterDatabase() {
    const result = {};
    for (const [id, data] of Object.entries(this._predefinedPool)) {
      result[id] = this._deepClone(data);
    }
    for (const [id, data] of Object.entries(this._npcs)) {
      // 已登场 NPC：card.* 平铺到顶层；保留 state 子对象（reactionStore 派生）
      const cloned = this._deepClone(data);
      const card = cloned.card || {};
      const flattened = { ...card };
      if (cloned.state) flattened.state = cloned.state;
      // 保留 id（card.id 已含，但为安全冗余）
      if (!flattened.id) flattened.id = id;
      result[id] = flattened;
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  /** 别名：getAllCharacters — 含未遇到的角色 */
  getAllCharacters() {
    return this.getCharacterDatabase();
  }

  hasCharacterDatabase() {
    return (
      Object.keys(this._predefinedPool).length > 0 || Object.keys(this._npcs).length > 0
    );
  }

  /** 获取全部关系规则 */
  getRelationshipRules() {
    return Object.keys(this._relationshipRules).length > 0
      ? this._deepClone(this._relationshipRules)
      : null;
  }

  /** 获取指定角色的关系规则 */
  getCharacterRelationships(characterId) {
    if (!characterId) return null;
    const rules = this._relationshipRules[characterId];
    return rules ? this._deepClone(rules) : null;
  }

  /** 获取未登场角色池（诊断用） */
  getPredefinedPool() {
    return this._deepClone(this._predefinedPool);
  }

  /** 获取角色来源标记 */
  getCharacterOrigin(charId) {
    return this._charOrigin[charId] || null;
  }

  // ==========================================
  // 持久化
  // ==========================================

  /**
   * 导出存档数据
   * @returns {Object} - 存档数据
   */
  getData() {
    return {
      npcData: { ...this._npcs },
      deletedIds: { ...this._deletedIds }, // 改为对象（包含 UID）
      rejectedUpdates: { ...this._rejectedUpdates },
      npcOrder: [...this._order],
      unselectedIds: Array.from(this._unselectedIds),
      pendingUpdates: { ...this._pendingUpdates },
      currentTurn: this.currentTurn,
      // 统一存档：包含未登场池 + 关系规则 + 来源标记（自洽，加载不依赖世界卡）
      predefinedPool: this._deepClone(this._predefinedPool),
      charOrigin: { ...this._charOrigin },
      relationshipRules: this._deepClone(this._relationshipRules),
    };
  }

  /**
   * 从存档恢复
   * @param {Object} savedData - 存档数据
   */
  restore(savedData) {
    if (!savedData) return;

    const npcData = savedData.npcData || {};
    const deletedIds = savedData.deletedIds || {};
    const rejectedUpdates = savedData.rejectedUpdates || {};
    const savedOrder = savedData.npcOrder || [];
    const unselectedIds = savedData.unselectedIds || [];

    // 未登场角色池 + 关系规则 + 来源标记
    // 契约：
    //   - 若存档有对应字段 → 完全替换（新存档自洽）
    //   - 若字段缺失（旧存档兼容）→ 保留调用 restore 之前已由 initialize() 填入的内容
    //     sessionManager 的加载流程会先 setActiveCard (触发 initialize)，再 restoreAll
    if (Object.prototype.hasOwnProperty.call(savedData, 'predefinedPool')) {
      this._predefinedPool = {};
      if (savedData.predefinedPool && typeof savedData.predefinedPool === 'object') {
        for (const [id, data] of Object.entries(savedData.predefinedPool)) {
          if (!id || id.startsWith('_') || !data || typeof data !== 'object') continue;
          this._predefinedPool[id] = this._deepClone(data);
        }
      }
      // 旧存档里已登场的 NPC 可能还在预定义池中 —— 从池里移除避免重复
      // 注意：此时 this._npcs 尚未恢复，使用 npcData（存档数据）做检查
      for (const id of Object.keys(npcData)) {
        if (id in this._predefinedPool) delete this._predefinedPool[id];
      }
    } else {
      // 旧存档兼容：initialize 已填入完整预定义池，需要从池里移除"已登场"的角色
      for (const id of Object.keys(npcData)) {
        if (id in this._predefinedPool) delete this._predefinedPool[id];
      }
    }

    if (Object.prototype.hasOwnProperty.call(savedData, 'charOrigin')) {
      this._charOrigin = {};
      if (savedData.charOrigin && typeof savedData.charOrigin === 'object') {
        for (const [id, origin] of Object.entries(savedData.charOrigin)) {
          if (!id || id.startsWith('_')) continue;
          this._charOrigin[id] = origin === 'expanded' ? 'expanded' : 'predefined';
        }
      }
    }
    // 旧存档兼容：charOrigin 缺失 → 保留 initialize() 填入的

    if (Object.prototype.hasOwnProperty.call(savedData, 'relationshipRules')) {
      this._relationshipRules = {};
      if (savedData.relationshipRules && typeof savedData.relationshipRules === 'object') {
        for (const [id, rules] of Object.entries(savedData.relationshipRules)) {
          if (!id || id.startsWith('_')) continue;
          this._relationshipRules[id] = this._deepClone(rules);
        }
      }
    }
    // 旧存档兼容：relationshipRules 缺失 → 保留 initialize() 填入的

    // 恢复删除列表（兼容旧格式数组和新格式对象）
    if (Array.isArray(deletedIds)) {
      // 旧格式：数组 -> 转换为对象，UID 设为 null
      this._deletedIds = {};
      for (const id of deletedIds) {
        this._deletedIds[id] = null;
      }
    } else {
      this._deletedIds = { ...deletedIds };
    }

    // 恢复拒绝记录
    this._rejectedUpdates = this._sanitizeRejectedUpdates(rejectedUpdates);

    // 恢复待审批更新和当前轮次
    this._pendingUpdates = this._sanitizePendingUpdates(savedData.pendingUpdates || {});
    this.currentTurn = savedData.currentTurn || 0;

    // 恢复数据（清理 drop 字段 → 老平铺迁移为嵌套 → 校验 card 内 enum/类型 → 补默认形状）
    this._npcs = {};
    for (const npcId in npcData) {
      let npc = this._sanitizePersistentNpcData(npcData[npcId]);
      npc = this._migrateLegacyNpc(npc);
      // card 内字段校验
      if (npc.card) {
        npc.card = this._validateNpcFields(npc.card);
        npc.card = this._coerceAllFields(npc.card);
      }
      this._ensureShape(npc);
      this._npcs[npcId] = npc;
    }

    // 恢复排序
    const allNpcIds = Object.keys(this._npcs);
    this._order = [
      ...savedOrder.filter(id => allNpcIds.includes(id)),
      ...allNpcIds.filter(id => !savedOrder.includes(id)),
    ];

    // 恢复选中状态
    this._unselectedIds = new Set(unselectedIds.filter(id => allNpcIds.includes(id)));

    const deletedCount = Object.keys(this._deletedIds).length;
    const rejectedCount = Object.values(this._rejectedUpdates).reduce(
      (sum, fields) => sum + Object.keys(fields).length,
      0
    );
    const pendingCount = Object.keys(this._pendingUpdates).length;

    console.log(
      `[npcStore] 已恢复 ${allNpcIds.length} 个 NPC，${deletedCount} 个已删除，${rejectedCount} 条拒绝记录，${pendingCount} 个待审批`
    );

    // 触发恢复事件（UI 会重建所有卡片）
    eventBus.emit(GameEvents.NPC_RESTORED, { npcs: this._npcs, order: this._order });

    // 恢复待审批 UI（需要在 restore 之后触发，因为 showPendingUI 依赖卡片 DOM 已存在）
    for (const npcId in this._pendingUpdates) {
      eventBus.emit(GameEvents.NPC_PENDING, { npcId, pendingInfo: this._pendingUpdates[npcId] });
    }
  }

  /**
   * 清空所有数据
   */
  clear() {
    this._npcs = {};
    this._predefinedPool = {};
    this._charOrigin = {};
    this._relationshipRules = {};
    this._deletedIds = {};
    this._rejectedUpdates = {};
    this._order = [];
    this._pendingUpdates = {};
    this._unselectedIds = new Set();
    this.currentTurn = 0;

    // 触发事件
    eventBus.emit(GameEvents.NPC_CLEARED);

    console.log('[npcStore] 已清空所有数据');
  }

  /**
   * 基于 UID 回滚（删除 targetUID 之后的所有数据）
   * @param {string} targetUID - 目标 UID
   */
  rollbackAfterUID(targetUID) {
    let deletedNpcCount = 0;
    let restoredDeletedCount = 0;
    let clearedRejectedCount = 0;
    let clearedPendingCount = 0;

    // 1. 删除 _lastUID > targetUID 的 NPC
    const toDelete = [];
    for (const npcId in this._npcs) {
      const npcUID = this._npcs[npcId]._lastUID;
      if (npcUID && typeof isUIDAfter === 'function' && isUIDAfter(npcUID, targetUID)) {
        toDelete.push(npcId);
      }
    }
    for (const npcId of toDelete) {
      delete this._npcs[npcId];
      this._order = this._order.filter(id => id !== npcId);
      eventBus.emit(GameEvents.NPC_DELETED, { npcId, npcName: null });
      deletedNpcCount++;
    }

    // 2. 恢复 deletedAtUID > targetUID 的已删除 NPC（只移除删除标记）
    for (const npcId in this._deletedIds) {
      const deletedUID = this._deletedIds[npcId];
      if (deletedUID && typeof isUIDAfter === 'function' && isUIDAfter(deletedUID, targetUID)) {
        delete this._deletedIds[npcId];
        restoredDeletedCount++;
      }
    }

    // 3. 清除 uid > targetUID 的拒绝记录
    for (const npcId in this._rejectedUpdates) {
      const fields = this._rejectedUpdates[npcId];
      for (const field in fields) {
        const rejectUID = fields[field].uid;
        if (rejectUID && typeof isUIDAfter === 'function' && isUIDAfter(rejectUID, targetUID)) {
          delete fields[field];
          clearedRejectedCount++;
        }
      }
      if (Object.keys(fields).length === 0) {
        delete this._rejectedUpdates[npcId];
      }
    }

    // 4. 清除 uid > targetUID 的待审批字段
    for (const npcId in this._pendingUpdates) {
      const pending = this._sanitizePendingInfo(this._pendingUpdates[npcId]);
      if (!pending) {
        delete this._pendingUpdates[npcId];
        eventBus.emit(GameEvents.NPC_PENDING_CLEARED, { npcId });
        continue;
      }

      let changed = false;
      for (const field in pending.changes) {
        const pendingUID = pending.changes[field].uid;
        if (pendingUID && typeof isUIDAfter === 'function' && isUIDAfter(pendingUID, targetUID)) {
          delete pending.changes[field];
          clearedPendingCount++;
          changed = true;
        }
      }

      if (changed) {
        this._emitPendingState(npcId, pending);
      }
    }

    if (deletedNpcCount + restoredDeletedCount + clearedRejectedCount + clearedPendingCount > 0) {
      console.log(
        `[npcStore] 回滚完成: 删除${deletedNpcCount}个NPC, 恢复${restoredDeletedCount}个删除标记, 清除${clearedRejectedCount}条拒绝, ${clearedPendingCount}个待审批`
      );
    }
  }

  /**
   * 触发保存 (手动保存模式下不再自动调用)
   */
  _triggerSave() {
    // 已改为手动保存模式，此方法保留但不执行任何操作
  }
}

const npcStore = new NpcStore();

// 暴露到全局
window.npcStore = npcStore;

// ========================================
// EventBus 监听器
// 监听 AI_RESPONSE_COMPLETE 事件，自动处理 NPC 数据
// ========================================
if (window.eventBus && window.GameEvents) {
  // 监听 AI 响应完成事件
  eventBus.on(GameEvents.AI_RESPONSE_COMPLETE, payload => {
    const { gameData, turnNumber, uid } = payload;

    // 如果本轮已通过 update_npc tool 处理过 NPC，跳过 JSON 里的 panel_npc
    if (window._npcToolCalledThisTurn) {
      window._npcToolCalledThisTurn = false;
      return;
    }

    // 从 gameData 中提取 NPC 面板数据
    if (gameData && gameData.panel_npc) {
      npcStore.processNpcPanel(gameData.panel_npc, turnNumber, uid);
    }
  });

  // 监听回滚事件
  eventBus.on(GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
    npcStore.rollbackAfterUID(targetUID);
  });

  // npcReactionStore 完成 rollback 后通知此 store 重建 state 层
  // 顺序保证：npcReactionStore 在自己的 rollbackAfterUID 末尾增发该事件，所以 reactionStore 此时已是回滚后的最终状态
  if (GameEvents.NPC_REACTIONS_ROLLED_BACK) {
    eventBus.on(GameEvents.NPC_REACTIONS_ROLLED_BACK, () => {
      npcStore.rebuildStateFromReactions();
      // 重建后通知 UI 刷所有卡片的「动态」tab
      for (const npcId of Object.keys(npcStore._npcs)) {
        eventBus.emit(GameEvents.NPC_STATE_UPDATED, {
          npcId,
          state: { ...npcStore._npcs[npcId].state },
        });
      }
    });
  }

  console.log('[NpcStore] EventBus 监听器已注册');
}

// 生命周期别名（供 ServiceRegistry 统一调用）
npcStore.getSaveData = npcStore.getData.bind(npcStore);

// 注册到服务中心
ServiceRegistry.register('npcData', npcStore);

// npcStore 是三 Store 架构的最后一块拼图 —— 此时 worldMeta/entityStore/timelineStore
// 都已加载，通知 worldCardManager 可以处理早期排队的激活请求
// （从旧 runtimeWorldStore.js 的尾部 flush 迁移过来）
window.worldCardManager?._flushPendingActivation?.();
