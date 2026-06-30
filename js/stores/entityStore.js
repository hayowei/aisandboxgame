// ============================================
// EntityStore — 世界实体统一 Store
// ============================================
// 管理所有世界实体（国家/势力/地区等），包含：
//   - 预定义实体（来自世界卡 snapshot.world_setting.settings）
//   - 扩展实体（来自 update_new_world tool 生成）
//
// 设计要点：
//   - 每个实体有 origin 标记（'predefined' | 'expanded'）
//   - 统一查询接口：不区分来源
//   - 参与 ServiceRegistry 存档生命周期（存档含预定义副本）
//   - 提供 displayName 解析 / canonical key 规范化（供地图、位置比较使用）
// ============================================

class EntityStore {
  constructor() {
    this._data = this._emptyData();
  }

  _emptyData() {
    return {
      entities: {},                 // entity_id → { value, origin, _renderedText? }
      narrativeCoreCharacters: {},  // entity_id → ["人名1", ...]
      characterDatabase: {},        // snapshot.character_database（V2 ncc ID→姓名 解析用）
      summary: '',                  // 世界概述文本
    };
  }

  // entry.value 可为 string（V1 markdown）或 object（V2 结构化 entity）。
  _isV2Value(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
  }

  // 接收预定义/扩展 entity 的输入值（string/object），存为 entry 对象。
  // V2 对象还会把内嵌的 narrative_core_characters 合并到顶层缓存。
  _storeEntity(id, value, origin) {
    if (this._isV2Value(value)) {
      this._data.entities[id] = { value, origin };
      const chars = Array.isArray(value.narrative_core_characters)
        ? value.narrative_core_characters.filter(s => typeof s === 'string' && s.trim())
        : null;
      if (chars && chars.length > 0) {
        this._data.narrativeCoreCharacters[id] = chars.slice();
      }
      return true;
    }
    if (typeof value === 'string') {
      this._data.entities[id] = { value, origin };
      return true;
    }
    return false;
  }

  // ========================================
  // 初始化（从世界卡快照加载预定义数据）
  // ========================================

  /**
   * 从 snapshot.world_setting 初始化（新游戏 / 切换世界卡）
   * @param {object} worldSetting - snapshot.world_setting
   */
  initialize(worldSetting, characterDatabase) {
    this._data = this._emptyData();
    // 缓存 character_database：V2 实体 narrative_core_characters 是角色 ID，渲染 markdown 时靠它解析回姓名。
    if (characterDatabase && typeof characterDatabase === 'object') {
      this._data.characterDatabase = characterDatabase;
    }
    if (!worldSetting || typeof worldSetting !== 'object') return;

    const settings = worldSetting.settings || {};
    for (const [id, value] of Object.entries(settings)) {
      if (!id || id.startsWith('_')) continue;
      this._storeEntity(id, value, 'predefined');
    }

    // 老卡顶层 _narrativeCoreCharacters 仍作 V1 兼容来源；V2 entity 自带的字段优先于此。
    if (worldSetting._narrativeCoreCharacters && typeof worldSetting._narrativeCoreCharacters === 'object') {
      for (const [id, chars] of Object.entries(worldSetting._narrativeCoreCharacters)) {
        if (id.startsWith('_') || !Array.isArray(chars)) continue;
        if (this._data.narrativeCoreCharacters[id]) continue; // V2 已写入则不覆盖
        this._data.narrativeCoreCharacters[id] = chars.slice();
      }
    }

    this._data.summary = typeof worldSetting._summary === 'string' ? worldSetting._summary : '';
  }

  // ========================================
  // 写入接口
  // ========================================

  /**
   * 添加或更新一个实体
   * @param {string} id
   * @param {string|object} value - V1 markdown 字符串 或 V2 结构化对象
   * @param {'predefined'|'expanded'} origin
   * @param {string[]} [narrativeCoreChars] - 该实体的叙事核心角色名列表（V1 用；V2 优先读对象自带字段）
   */
  add(id, value, origin = 'expanded', narrativeCoreChars = null) {
    if (!id || typeof id !== 'string' || id.startsWith('_')) return false;
    if (!this._storeEntity(id, value, origin)) return false;
    if (!this._isV2Value(value) && Array.isArray(narrativeCoreChars) && narrativeCoreChars.length > 0) {
      this._data.narrativeCoreCharacters[id] = narrativeCoreChars.slice();
    }
    return true;
  }

  /**
   * 批量添加扩展实体
   * @param {Object} newSettings - { entity_id: <string|object>, ... }
   * @param {Object} [narrativeCoreChars] - { entity_id: ["人名", ...], ... }
   * @returns {{ added: string[] }}
   */
  addBatch(newSettings, narrativeCoreChars = null) {
    if (!newSettings || typeof newSettings !== 'object') return { added: [] };
    const added = [];
    for (const [id, value] of Object.entries(newSettings)) {
      if (id.startsWith('_')) continue;
      if (this._storeEntity(id, value, 'expanded')) added.push(id);
    }
    if (narrativeCoreChars && typeof narrativeCoreChars === 'object') {
      for (const [id, chars] of Object.entries(narrativeCoreChars)) {
        if (id.startsWith('_') || !Array.isArray(chars)) continue;
        // V2 entity 自身字段优先；只在没写入时填顶层缓存（兼容 V1 batch）
        if (this._data.narrativeCoreCharacters[id]) continue;
        this._data.narrativeCoreCharacters[id] = chars.slice();
      }
    }
    return { added };
  }

  // ========================================
  // 查询接口
  // ========================================

  /** 列出所有实体 ID */
  list() {
    return Object.keys(this._data.entities);
  }

  /**
   * 获取单个实体的 markdown 原文（V1 直接返字符串，V2 走 renderV2EntityMarkdown 派生，结果缓存到 entry）。
   * 下游 search_world / expandPrompts 等期望整段 markdown 的调用者直接走此接口，不需要感知 schema 差异。
   */
  get(id) {
    if (typeof id !== 'string' || !id) return null;
    const entry = this._data.entities[id];
    if (!entry) return null;
    if (this._isV2Value(entry.value)) {
      if (typeof entry._renderedText !== 'string') {
        entry._renderedText = (typeof window.renderV2EntityMarkdown === 'function')
          ? window.renderV2EntityMarkdown(entry.value, this._data.characterDatabase)
          : '';
      }
      return entry._renderedText;
    }
    return typeof entry.value === 'string' ? entry.value : null;
  }

  /** 取实体的原始结构化值（V2 返对象、V1 返字符串）。审核 UI 用此。 */
  getRaw(id) {
    if (typeof id !== 'string' || !id) return null;
    const entry = this._data.entities[id];
    return entry ? entry.value : null;
  }

  /** 取 schema 格式（'v1'|'v2'）。 */
  getSchemaVersion(id) {
    if (typeof id !== 'string' || !id) return null;
    const entry = this._data.entities[id];
    if (!entry) return null;
    return this._isV2Value(entry.value) ? 'v2' : 'v1';
  }

  /** 是否存在某实体 */
  has(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(this._data.entities, id);
  }

  /** 获取实体来源 */
  getOrigin(id) {
    const entry = this._data.entities[id];
    return entry ? entry.origin : null;
  }

  getSummary() {
    return this._data.summary || '';
  }

  getNarrativeCoreCharacters() {
    return this._deepClone(this._data.narrativeCoreCharacters);
  }

  // ========================================
  // 显示名解析 / canonical key
  // ========================================

  _normalizeCanonicalToken(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\s+/g, ' ').toLowerCase();
  }

  _extractDisplayNameFromText(text, entityId = '') {
    if (typeof text !== 'string') return '';
    const raw = text.trim();
    if (!raw) return '';

    const headerMatch = raw.match(
      /^\s*##\s*(?:实体设定|实体|Entity(?:\s+Setting)?)\s*--\s*([^\n（(]+?)(?:\s*[（(][^\n）)]+[）)])?\s*(?:\n|$)/im
    );
    if (headerMatch && headerMatch[1]?.trim()) {
      return headerMatch[1].trim();
    }

    // 世界卡章节特征：缺少标准首行时不回退到首句截断
    if (
      /###\s*(?:第[一二三四五六七八九十\d]+[章节]|Chapter\s+\d+)|^\s*\[(?:Geopolitics|History_Culture|Political_System|Economic_System|Social_Culture|Religion_Belief|Military_Security|Setting|Social_Fabric|Order|World_Law|Rhythm|Narrative_Core)\]/im.test(
        raw
      )
    ) {
      return '';
    }

    const firstLine = raw
      .split('\n')
      .map(line => line.trim())
      .find(Boolean);
    const source = (firstLine || raw)
      .replace(/^#{1,6}\s*/, '')
      .replace(/^(?:实体设定|实体|Entity(?:\s+Setting)?)\s*--\s*/i, '');
    const candidate = source.split(/(?:——+|—+|--+|:|：|\n)/)[0].trim();

    if (!candidate || candidate === '实体设定' || /^entity(?:\s+setting)?$/i.test(candidate))
      return '';
    if (entityId && candidate === entityId.trim()) return '';
    return candidate;
  }

  /** 遍历所有实体构建 displayName 缓存（被 designService 也使用） */
  inspectDisplayNames(settingsOverride = null) {
    let entries;
    if (settingsOverride && typeof settingsOverride === 'object') {
      entries = Object.entries(settingsOverride);
    } else {
      entries = Object.entries(this._data.entities).map(([id, entry]) => [id, entry.value]);
    }

    const records = [];
    const displayIndex = new Map();

    for (const [entityId, value] of entries) {
      if (!entityId || entityId.startsWith('_')) continue;
      let parsedDisplayName;
      let textForRecord;
      if (this._isV2Value(value)) {
        parsedDisplayName = typeof value.display_name === 'string' ? value.display_name.trim() : '';
        textForRecord = (typeof window.renderV2EntityMarkdown === 'function')
          ? window.renderV2EntityMarkdown(value, this._data.characterDatabase)
          : '';
      } else {
        parsedDisplayName = this._extractDisplayNameFromText(value, entityId);
        textForRecord = typeof value === 'string' ? value : '';
      }
      const displayName = parsedDisplayName || entityId;
      const canonicalDisplay = this._normalizeCanonicalToken(parsedDisplayName);
      const record = {
        entityId,
        text: textForRecord,
        parsedDisplayName,
        displayName,
        canonicalDisplay,
      };
      records.push(record);

      if (!canonicalDisplay) continue;
      if (!displayIndex.has(canonicalDisplay)) {
        displayIndex.set(canonicalDisplay, []);
      }
      displayIndex.get(canonicalDisplay).push(record);
    }

    const conflicts = [];
    for (const group of displayIndex.values()) {
      if (group.length > 1) conflicts.push(group.map(item => ({ ...item })));
    }

    const parseFailures = records
      .filter(record => !record.parsedDisplayName)
      .map(record => ({ entityId: record.entityId }));

    return {
      records,
      conflicts,
      parseFailures,
      canUseDisplayNames:
        records.length > 0 && conflicts.length === 0 && parseFailures.length === 0,
    };
  }

  getDisplayName(entityId) {
    if (typeof entityId !== 'string' || !entityId.trim()) return '';
    const trimmedId = entityId.trim();
    const raw = this.getRaw(trimmedId);
    if (this._isV2Value(raw)) {
      const name = typeof raw.display_name === 'string' ? raw.display_name.trim() : '';
      return name || trimmedId;
    }
    const parsed = this._extractDisplayNameFromText(raw, trimmedId);
    return parsed || trimmedId;
  }

  listDisplayNames() {
    return this.inspectDisplayNames().records.map(r => r.displayName);
  }

  /**
   * 将输入值解析为规范 canonical key
   * - 若匹配实体 ID 或唯一显示名 → "entity:ID"
   * - 否则 → "raw:normalized_value"
   */
  resolveCanonicalKey(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    const trimmed = value.trim();

    if (this.has(trimmed)) {
      return `entity:${trimmed}`;
    }

    const normalized = this._normalizeCanonicalToken(trimmed);
    if (!normalized) return '';

    const inspection = this.inspectDisplayNames();
    const matched = inspection.records.filter(record => record.canonicalDisplay === normalized);
    if (matched.length === 1) {
      return `entity:${matched[0].entityId}`;
    }

    return `raw:${normalized}`;
  }

  /** 将任意输入解析为展示名 */
  resolveDisplayName(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';

    const canonical = this.resolveCanonicalKey(trimmed);
    if (canonical.startsWith('entity:')) {
      return this.getDisplayName(canonical.slice('entity:'.length));
    }
    return trimmed;
  }

  /** 位置对象规范化（country/site/spot 三层） */
  normalizeLocationForCompare(location) {
    if (!location || typeof location !== 'object') {
      return { country: '', site: '', spot: '' };
    }
    // '未知' 是地点哨兵（通配）：canonical 化后必须为空 —— 否则 resolveCanonicalKey 会把它变成 'raw:未知'，
    // 让 triadMatch 的 known() 当成真值，未知段不再当通配（两个未知假同处、已知 vs 未知假不同处）。
    const seg = v => (typeof v === 'string' && v.trim() === '未知') ? '' : this.resolveCanonicalKey(v || '');
    return {
      country: seg(location.country),
      site: seg(location.site),
      spot: seg(location.spot),
    };
  }

  // ========================================
  // ServiceRegistry 存档生命周期
  // ========================================

  getSaveData() {
    if (Object.keys(this._data.entities).length === 0) return null;
    // 不存 _renderedText 缓存（派生数据，restore 时按需重算）
    const entities = {};
    for (const [id, entry] of Object.entries(this._data.entities)) {
      entities[id] = { value: entry.value, origin: entry.origin };
    }
    return {
      entities: this._deepClone(entities),
      narrativeCoreCharacters: this._deepClone(this._data.narrativeCoreCharacters),
      summary: this._data.summary,
    };
  }

  restore(savedData) {
    this._data = this._emptyData();
    if (!savedData || typeof savedData !== 'object') return;
    if (savedData.entities && typeof savedData.entities === 'object') {
      for (const [id, entry] of Object.entries(savedData.entities)) {
        if (!id || id.startsWith('_') || !entry || typeof entry !== 'object') continue;
        const origin = entry.origin === 'expanded' ? 'expanded' : 'predefined';
        // 新格式：entry.value 为 string 或 object；老格式：entry.text 为 string
        const value = entry.value !== undefined ? entry.value : entry.text;
        this._storeEntity(id, value, origin);
      }
    }
    if (savedData.narrativeCoreCharacters && typeof savedData.narrativeCoreCharacters === 'object') {
      for (const [id, chars] of Object.entries(savedData.narrativeCoreCharacters)) {
        if (id.startsWith('_') || !Array.isArray(chars)) continue;
        this._data.narrativeCoreCharacters[id] = chars.slice();
      }
    }
    if (typeof savedData.summary === 'string') {
      this._data.summary = savedData.summary;
    }
  }

  clear() {
    this._data = this._emptyData();
  }

  // ========================================
  // 内部辅助
  // ========================================

  _deepClone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return value;
    }
  }
}

const entityStore = new EntityStore();
window.entityStore = entityStore;

if (typeof ServiceRegistry !== 'undefined') {
  ServiceRegistry.register('entities', entityStore);
}

console.log('[EntityStore] 初始化完成');
