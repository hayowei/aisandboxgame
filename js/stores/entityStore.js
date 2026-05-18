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
      entities: {},                 // entity_id → { text, origin }
      narrativeCoreCharacters: {},  // entity_id → ["人名1", ...]
      summary: '',                  // 世界概述文本
    };
  }

  // ========================================
  // 初始化（从世界卡快照加载预定义数据）
  // ========================================

  /**
   * 从 snapshot.world_setting 初始化（新游戏 / 切换世界卡）
   * @param {object} worldSetting - snapshot.world_setting
   */
  initialize(worldSetting) {
    this._data = this._emptyData();
    if (!worldSetting || typeof worldSetting !== 'object') return;

    const settings = worldSetting.settings || {};
    for (const [id, text] of Object.entries(settings)) {
      if (!id || id.startsWith('_') || typeof text !== 'string') continue;
      this._data.entities[id] = { text, origin: 'predefined' };
    }

    this._data.summary = typeof worldSetting._summary === 'string' ? worldSetting._summary : '';
  }

  // ========================================
  // 写入接口
  // ========================================

  /**
   * 添加或更新一个实体
   * @param {string} id
   * @param {string} text - 5 章 Markdown 设定文本
   * @param {'predefined'|'expanded'} origin
   * @param {string[]} [narrativeCoreChars] - 该实体的叙事核心角色名列表
   */
  add(id, text, origin = 'expanded', narrativeCoreChars = null) {
    if (!id || typeof id !== 'string' || id.startsWith('_')) return false;
    if (typeof text !== 'string') return false;
    this._data.entities[id] = { text, origin };
    if (Array.isArray(narrativeCoreChars) && narrativeCoreChars.length > 0) {
      this._data.narrativeCoreCharacters[id] = narrativeCoreChars.slice();
    }
    return true;
  }

  /**
   * 批量添加扩展实体
   * @param {Object} newSettings - { entity_id: "text", ... }
   * @param {Object} [narrativeCoreChars] - { entity_id: ["人名", ...], ... }
   * @returns {{ added: string[] }}
   */
  addBatch(newSettings, narrativeCoreChars = null) {
    if (!newSettings || typeof newSettings !== 'object') return { added: [] };
    const added = [];
    for (const [id, text] of Object.entries(newSettings)) {
      if (id.startsWith('_') || typeof text !== 'string') continue;
      this._data.entities[id] = { text, origin: 'expanded' };
      added.push(id);
    }
    if (narrativeCoreChars && typeof narrativeCoreChars === 'object') {
      for (const [id, chars] of Object.entries(narrativeCoreChars)) {
        if (id.startsWith('_') || !Array.isArray(chars)) continue;
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

  /** 获取单个实体的原文 */
  get(id) {
    if (typeof id !== 'string' || !id) return null;
    const entry = this._data.entities[id];
    return entry ? entry.text : null;
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
      /###\s*(?:第[一二三四五六七八九十\d]+[章节]|Chapter\s+\d+)|^\s*\[(?:Geopolitics|History_Culture|Political_System|Economic_System|Social_Culture|Religion_Belief|Military_Security)\]/im.test(
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
      entries = Object.entries(this._data.entities).map(([id, entry]) => [id, entry.text]);
    }

    const records = [];
    const displayIndex = new Map();

    for (const [entityId, text] of entries) {
      if (!entityId || entityId.startsWith('_')) continue;
      const parsedDisplayName = this._extractDisplayNameFromText(text, entityId);
      const displayName = parsedDisplayName || entityId;
      const canonicalDisplay = this._normalizeCanonicalToken(parsedDisplayName);
      const record = {
        entityId,
        text,
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
    const text = this.get(trimmedId);
    const parsed = this._extractDisplayNameFromText(text, trimmedId);
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
    return {
      country: this.resolveCanonicalKey(location.country || ''),
      site: this.resolveCanonicalKey(location.site || ''),
      spot: this.resolveCanonicalKey(location.spot || ''),
    };
  }

  // ========================================
  // ServiceRegistry 存档生命周期
  // ========================================

  getSaveData() {
    if (Object.keys(this._data.entities).length === 0) return null;
    return this._deepClone(this._data);
  }

  restore(savedData) {
    this._data = this._emptyData();
    if (!savedData || typeof savedData !== 'object') return;
    if (savedData.entities && typeof savedData.entities === 'object') {
      for (const [id, entry] of Object.entries(savedData.entities)) {
        if (!id || id.startsWith('_') || !entry || typeof entry !== 'object') continue;
        if (typeof entry.text !== 'string') continue;
        this._data.entities[id] = {
          text: entry.text,
          origin: entry.origin === 'expanded' ? 'expanded' : 'predefined',
        };
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
