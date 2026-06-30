// ============================================
// Analyzer Utils - 分析器公共工具模块
// ============================================
// 提供各 Analyzer 共享的工具方法，避免代码重复
// 必须在其他 Analyzer 之前加载
// ============================================

const AnalyzerUtils = {
  /**
   * 获取当前激活世界的角色数据库
   * custom 模式 strict custom-only：缺失即空对象
   */
  getCharacterDatabase() {
    const store = typeof window !== 'undefined' ? window.npcStore : null;
    const db = store?.getCharacterDatabase?.();
    if (db && typeof db === 'object') return db;
    return {};
  },

  /**
   * 枚举有效角色条目（过滤 _summary 等元字段）
   * @param {object} options
   * @param {boolean} options.requireName - 是否要求角色必须有非空 name 字段
   * @returns {Array<[string, object]>} [id, character] 列表
   */
  getValidCharacterEntries(options = {}) {
    const { requireName = false } = options;
    const db = this.getCharacterDatabase();
    const entries = [];
    for (const [id, char] of Object.entries(db)) {
      if (id.startsWith('_')) continue;
      if (!char || typeof char !== 'object' || Array.isArray(char)) continue;
      if (requireName && !(typeof char.name === 'string' && char.name.trim())) continue;
      entries.push([id, char]);
    }
    return entries;
  },

  /**
   * 获取有效角色 ID 列表（过滤元字段）
   * @param {object} options
   * @param {boolean} options.requireName - 是否要求角色必须有非空 name 字段
   * @returns {Array<string>} 角色 ID 列表
   */
  getValidCharacterIds(options = {}) {
    return this.getValidCharacterEntries(options).map(([id]) => id);
  },

  // ============================================
  // 日期转换（统一使用 dateToValue 方法）
  // ============================================

  /**
   * 将日期转换为可比较的数值
   * 使用 year * 10000 + month * 100 + day 格式
   * @param {object} date - { year, month, day }
   * @returns {number} 可比较的数值
   */
  dateToValue(date) {
    if (!date || date.year === undefined) return 0;
    return date.year * 10000 + (date.month || 1) * 100 + (date.day || 1);
  },

  // ============================================
  // 角色名称/ID 映射
  // ============================================

  /**
   * 构建角色名到ID的映射
   * @returns {object} { name: id, ... }
   */
  buildNameToIdMap() {
    const map = {};
    for (const [id, char] of this.getValidCharacterEntries({ requireName: true })) {
      map[char.name] = char.id || id;
    }
    return map;
  },

  /**
   * 构建ID到角色名的映射
   * @returns {object} { id: name, ... }
   */
  buildIdToNameMap() {
    const map = {};
    for (const [id, char] of this.getValidCharacterEntries({ requireName: true })) {
      map[id] = char.name;
    }
    return map;
  },

  // ============================================
  // AI 响应解析
  // ============================================

  /**
   * 从 AI 响应中解析 panel_npc 数组
   * @param {string} aiResponse - AI 响应文本（含 JSON）
   * @returns {Array} NPC data 数组
   */
  extractPanelNpc(aiResponse) {
    if (!aiResponse) return [];
    try {
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[1]);
        if (json.panel_npc && Array.isArray(json.panel_npc)) {
          // 扁平化结构：npc 直接包含所有字段
          return json.panel_npc.filter(npc => npc && npc.name);
        }
      }
    } catch (e) {
      console.warn('[AnalyzerUtils] 解析 panel_npc 失败:', e);
    }
    return [];
  },

  // ============================================
  // 游戏时间获取
  // ============================================

  /**
   * 获取当前游戏时间
   * @returns {object} { year, month, day }
   */
  getCurrentGameTime() {
    if (typeof timelineService !== 'undefined' && timelineService.getCurrentDate) {
      return timelineService.getCurrentDate();
    }
    // 默认值
    return { year: 118, month: 1, day: 1 };
  },

  getCurrentWorldTimePrecision() {
    const store = typeof window !== 'undefined' ? window.worldMeta : null;
    const rawPrecision = store?.getActiveTimeTerms?.()?.precision;
    if (typeof rawPrecision !== 'string') return 'day';
    const normalized = rawPrecision.trim().toLowerCase();
    return ['year', 'month', 'day', 'time'].includes(normalized) ? normalized : 'day';
  },

  // ============================================
  // 年龄计算
  // ============================================

  /**
   * 解析 birthday 字符串为日期对象
   * 支持格式: "UE104", "UE104.06", "UE104.06.01", "星历900.03.15" 等
   * @param {string} birthday - 生日字符串
   * @returns {object|null} { year, month, day, precision } 或 null（无法解析）
   */
  parseBirthday(birthday) {
    if (!birthday || typeof birthday !== 'string') return null;

    // 匹配任意纪元前缀 + 年(.月)(.日) 格式（纪元无关化）
    const match = birthday.match(/(\d+)(?:[\.。](\d+))?(?:[\.。](\d+))?/);
    if (match) {
      const month = match[2] ? parseInt(match[2], 10) : null;
      const day = match[3] ? parseInt(match[3], 10) : null;
      return {
        year: parseInt(match[1], 10),
        month,
        day,
        precision: day !== null ? 'day' : month !== null ? 'month' : 'year',
      };
    }

    // 无法解析（如 "不详"、"远古" 等）
    return null;
  },

  _getAgePrecisionRank(precision) {
    const normalized = precision === 'time' ? 'day' : precision;
    if (normalized === 'year') return 1;
    if (normalized === 'month') return 2;
    return 3;
  },

  calculateAgeFromBirthday(birthday, currentTime, worldPrecision = null) {
    const birthDate = this.parseBirthday(birthday);
    if (!birthDate || !currentTime) return null;

    const currentYear = Number.parseInt(currentTime.year, 10);
    if (!Number.isFinite(currentYear)) return null;

    const normalizedWorldPrecision =
      typeof worldPrecision === 'string' && worldPrecision.trim()
        ? worldPrecision.trim().toLowerCase()
        : this.getCurrentWorldTimePrecision();
    const effectiveRank = Math.min(
      this._getAgePrecisionRank(normalizedWorldPrecision),
      this._getAgePrecisionRank(birthDate.precision)
    );

    let age = currentYear - birthDate.year;
    if (age < 0) return null;

    if (effectiveRank >= 2 && Number.isFinite(birthDate.month)) {
      const currentMonth = Number.parseInt(currentTime.month, 10);
      if (Number.isFinite(currentMonth) && currentMonth < birthDate.month) {
        age -= 1;
      }
      if (
        effectiveRank >= 3 &&
        Number.isFinite(currentMonth) &&
        currentMonth === birthDate.month &&
        Number.isFinite(birthDate.day)
      ) {
        const currentDay = Number.parseInt(currentTime.day, 10);
        if (Number.isFinite(currentDay) && currentDay < birthDate.day) {
          age -= 1;
        }
      }
    }

    if (age < 0) return null;
    return `${age}岁`;
  },

  /**
   * 计算角色当前年龄
   * @param {string} characterId - 角色ID
   * @param {object} currentTime - 当前游戏时间 { year, month, day }
   * @returns {string|null} 年龄字符串（如 "14岁"）或 null
   */
  calculateAge(characterId, currentTime) {
    const db = this.getCharacterDatabase();
    const char = db[characterId];
    if (!char) return null;

    return this.calculateAgeFromBirthday(char.birthday, currentTime);
  },
};

// 冻结对象防止意外修改
Object.freeze(AnalyzerUtils);

console.log('[AnalyzerUtils] 公共工具模块已加载');
