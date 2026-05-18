// ============================================
// WorldMeta — 世界卡元数据访问器
// ============================================
// 职责：提供运行时对世界卡元数据的只读访问
//   - step3_fields（面板字段定义）
//   - prompt_modules（规则模块、开场白、prompt 配置）
//   - character_timelines（角色统一时间线，供 Analyzer 使用）
//   - random_opening（随机开局配置）
//   - custom_terrains / custom_territories（自定义地形/领土）
//   - contentLocale（内容语言）
//   - 衍生术语读取：getActiveTimeTerms / getActiveCurrencyTerms
//
// 设计要点：
//   - 不参与 ServiceRegistry 存档生命周期（始终从世界卡读取最新值）
//   - 用户编辑世界卡规则后，旧存档加载时也能获得最新规则
//   - 初始化由 worldCardManager / sessionManager 在世界卡激活时驱动
// ============================================

class WorldMeta {
  constructor() {
    this._step3Fields = null;
    this._promptModules = null;
    this._characterTimelines = null;
    this._randomOpening = null;
    this._customTerrains = null;
    this._customTerritories = null;
    this._contentLocale = 'zh-CN';
  }

  // ========================================
  // 初始化 / 重置
  // ========================================

  /**
   * 从世界卡快照初始化元数据
   * @param {object} snapshot - 世界卡快照（原始，未处理过）
   * @param {string} [contentLocale='zh-CN']
   */
  initialize(snapshot, contentLocale = 'zh-CN') {
    if (!snapshot || typeof snapshot !== 'object') {
      this.clear();
      return;
    }

    this._step3Fields = this._normalizeStep3Fields(snapshot.step3_fields || null);

    if (snapshot.prompt_modules && typeof snapshot.prompt_modules === 'object') {
      const modules =
        snapshot.prompt_modules.modules && typeof snapshot.prompt_modules.modules === 'object'
          ? this._deepClone(snapshot.prompt_modules.modules)
          : {};
      const moduleMeta =
        snapshot.prompt_modules.module_meta &&
        typeof snapshot.prompt_modules.module_meta === 'object'
          ? this._deepClone(snapshot.prompt_modules.module_meta)
          : {};
      const openingGreeting =
        typeof snapshot.prompt_modules.opening_greeting === 'string'
          ? snapshot.prompt_modules.opening_greeting
          : '';
      this._promptModules = {
        modules,
        module_meta: moduleMeta,
        opening_greeting: openingGreeting,
        _summary: snapshot.prompt_modules._summary || '',
      };
    } else {
      this._promptModules = null;
    }

    this._characterTimelines =
      snapshot.character_timelines && typeof snapshot.character_timelines === 'object'
        ? this._deepClone(snapshot.character_timelines)
        : null;

    this._randomOpening =
      snapshot.random_opening && typeof snapshot.random_opening === 'object'
        ? this._deepClone(snapshot.random_opening)
        : null;

    this._customTerrains = Array.isArray(snapshot.custom_terrains)
      ? this._deepClone(snapshot.custom_terrains)
      : null;
    this._customTerritories = Array.isArray(snapshot.custom_territories)
      ? this._deepClone(snapshot.custom_territories)
      : null;

    this._contentLocale =
      typeof contentLocale === 'string' && contentLocale.trim() ? contentLocale.trim() : 'zh-CN';
  }

  clear() {
    this._step3Fields = null;
    this._promptModules = null;
    this._characterTimelines = null;
    this._randomOpening = null;
    this._customTerrains = null;
    this._customTerritories = null;
    this._contentLocale = 'zh-CN';
  }

  // ========================================
  // 基础读取接口
  // ========================================

  getStep3Fields() {
    return this._step3Fields || null;
  }

  getPromptConfig() {
    return this._promptModules || null;
  }

  listRuleModules() {
    return Object.keys(this._promptModules?.modules || {});
  }

  getRuleModule(moduleId) {
    const modules = this._promptModules?.modules || {};
    return Object.prototype.hasOwnProperty.call(modules, moduleId) ? modules[moduleId] : null;
  }

  getOpeningGreeting() {
    const greeting = this._promptModules?.opening_greeting;
    return typeof greeting === 'string' ? greeting : null;
  }

  getCharacterTimelines() {
    return this._characterTimelines ? this._deepClone(this._characterTimelines) : null;
  }

  getCharacterTimeline(characterId) {
    if (!this._characterTimelines || !characterId) return null;
    return Object.prototype.hasOwnProperty.call(this._characterTimelines, characterId)
      ? this._deepClone(this._characterTimelines[characterId])
      : null;
  }

  getRandomOpeningConfig() {
    return this._randomOpening ? this._deepClone(this._randomOpening) : null;
  }

  getCustomTerrains() {
    return this._customTerrains ? this._deepClone(this._customTerrains) : null;
  }

  getCustomTerritories() {
    return this._customTerritories ? this._deepClone(this._customTerritories) : null;
  }

  getActiveContentLocale() {
    return typeof this._contentLocale === 'string' && this._contentLocale.trim()
      ? this._contentLocale
      : 'zh-CN';
  }

  // ========================================
  // 术语读取（纪年 / 货币）
  // ========================================

  _getStatusGroups() {
    const groups = this._step3Fields?.panel_status;
    return Array.isArray(groups) ? groups : [];
  }

  _getFieldByKey(group, key) {
    if (!group || !Array.isArray(group.fields)) return null;
    return group.fields.find(f => f && f.key === key) || null;
  }

  _extractEraFromYearLabel(label) {
    if (typeof label !== 'string') return '';
    const raw = label.trim();
    if (!raw || raw === '年份' || raw === '年') return '';
    if (raw.endsWith('年')) return raw.slice(0, -1).trim();
    return '';
  }

  _inferTimePrecision(group) {
    if (group && typeof group._precision === 'string' && group._precision.trim()) {
      return group._precision.trim();
    }
    const keys = Array.isArray(group?.fields) ? group.fields.map(f => f?.key) : [];
    if (keys.includes('hour') || keys.includes('minute') || keys.includes('time_str')) return 'time';
    if (keys.includes('day')) return 'day';
    if (keys.includes('month')) return 'month';
    return 'year';
  }

  _normalizeTimeUnitLabel(label, fallback) {
    if (typeof label !== 'string' || !label.trim()) return fallback;
    const raw = label.trim();
    if (raw === '年份') return '年';
    if (raw === '月份') return '月';
    if (raw === '日期') return '日';
    return raw;
  }

  _isValidCurrencyLabel(label) {
    if (typeof label !== 'string' || !label.trim()) return false;
    const value = label.trim().toLowerCase();
    const invalid = new Set(['金钱', 'money', '金额', '货币', '货币单位']);
    return !invalid.has(value);
  }

  getActiveTimeTerms() {
    const groups = this._getStatusGroups();
    const timeGroup = groups.find(g => g && (g._template === 'time' || g.key === 'datetime'));
    if (!timeGroup) {
      return {
        era: '',
        precision: 'time',
        timeSegments: [],
        labels: { year: '年', month: '月', day: '日', hour: '时', minute: '分' },
      };
    }

    const yearField = this._getFieldByKey(timeGroup, 'year');
    const monthField = this._getFieldByKey(timeGroup, 'month');
    const dayField = this._getFieldByKey(timeGroup, 'day');
    const hourField = this._getFieldByKey(timeGroup, 'hour');
    const minuteField = this._getFieldByKey(timeGroup, 'minute');

    let era = '';
    if (typeof timeGroup._era === 'string' && timeGroup._era.trim()) {
      era = timeGroup._era.trim();
    } else {
      era = this._extractEraFromYearLabel(yearField?.label);
    }

    // 兼容旧结构：calendar_era 直接写入 year 字段 label（如 "星历"）
    const rawYearLabel = typeof yearField?.label === 'string' ? yearField.label.trim() : '';
    const rawMonthLabel = typeof monthField?.label === 'string' ? monthField.label.trim() : '';
    const rawDayLabel = typeof dayField?.label === 'string' ? dayField.label.trim() : '';
    const monthIsGeneric = !rawMonthLabel || rawMonthLabel === '月份' || rawMonthLabel === '月';
    const dayIsGeneric = !rawDayLabel || rawDayLabel === '日期' || rawDayLabel === '日';
    let yearUnit = this._normalizeTimeUnitLabel(yearField?.label, '年');
    if (
      !era &&
      rawYearLabel &&
      !rawYearLabel.endsWith('年') &&
      rawYearLabel !== '年份' &&
      monthIsGeneric &&
      dayIsGeneric
    ) {
      era = rawYearLabel;
      yearUnit = '年';
    }

    return {
      era,
      precision: this._inferTimePrecision(timeGroup),
      timeSegments:
        Array.isArray(timeGroup?._time_segments) && timeGroup._time_segments.length > 0
          ? timeGroup._time_segments
              .filter(seg => typeof seg === 'string')
              .map(seg => seg.trim())
              .filter(Boolean)
          : [],
      labels: {
        year: yearUnit,
        month: this._normalizeTimeUnitLabel(monthField?.label, '月'),
        day: this._normalizeTimeUnitLabel(dayField?.label, '日'),
        hour: this._normalizeTimeUnitLabel(hourField?.label, '时'),
        minute: this._normalizeTimeUnitLabel(minuteField?.label, '分'),
      },
    };
  }

  getActiveCurrencyTerms() {
    let currency = '';
    let currencyShort = '';

    // 优先：从 step3_fields._worldTermsSource.currency_name 读（卡设计本意，不依赖 panel_status 的 money group）
    const tws = this._step3Fields?._worldTermsSource;
    if (tws && typeof tws === 'object') {
      if (typeof tws.currency_name === 'string' && tws.currency_name.trim()) {
        currency = tws.currency_name.trim();
      }
      if (typeof tws.currency_short === 'string' && tws.currency_short.trim()) {
        currencyShort = tws.currency_short.trim();
      }
    }

    // 兼容老世界卡：从 panel_status 的 money group 推断（如果还在的话）
    if (!currency) {
      const groups = this._getStatusGroups();
      const moneyTemplateGroup = groups.find(g => g && g._template === 'money');
      if (moneyTemplateGroup) {
        if (typeof moneyTemplateGroup._currency === 'string' && moneyTemplateGroup._currency.trim()) {
          currency = moneyTemplateGroup._currency.trim();
        }
        if (
          !currencyShort &&
          typeof moneyTemplateGroup._currencyShort === 'string' &&
          moneyTemplateGroup._currencyShort.trim()
        ) {
          currencyShort = moneyTemplateGroup._currencyShort.trim();
        }
        if (!currency) {
          const fieldLabel =
            this._getFieldByKey(moneyTemplateGroup, 'amount')?.label ||
            moneyTemplateGroup.fields?.[0]?.label;
          if (this._isValidCurrencyLabel(fieldLabel)) currency = fieldLabel.trim();
        }
      }
    }

    if (!currency) {
      const groups = this._getStatusGroups();
      const playerStateGroup = groups.find(g => g && g.key === 'player_state');
      const moneyLabel = this._getFieldByKey(playerStateGroup, 'money')?.label;
      if (this._isValidCurrencyLabel(moneyLabel)) currency = moneyLabel.trim();
      if (!currencyShort && playerStateGroup) {
        if (
          typeof playerStateGroup._currencyShort === 'string' &&
          playerStateGroup._currencyShort.trim()
        ) {
          currencyShort = playerStateGroup._currencyShort.trim();
        }
      }
    }

    return {
      currencyLabel: currency || '',
      currencyShort: currencyShort || currency || '',
    };
  }

  /** getCurrencyLabel — 快捷读取货币主标签 */
  getCurrencyLabel() {
    return this.getActiveCurrencyTerms().currencyLabel;
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

  _normalizeStep3Fields(step3Fields) {
    if (!step3Fields || typeof step3Fields !== 'object') return null;
    const normalized = this._deepClone(step3Fields);
    if (!Array.isArray(normalized.panel_status)) return normalized;
    normalized.panel_status = normalized.panel_status.map(group => {
      if (!group || (group._template !== 'time' && group.key !== 'datetime')) return group;
      const fields = Array.isArray(group.fields) ? group.fields.filter(Boolean) : [];
      const normalizedPrecision =
        typeof group._precision === 'string' && group._precision.trim()
          ? group._precision.trim()
          : fields.some(
                field => field?.key === 'time_str' || field?.key === 'hour' || field?.key === 'minute'
              )
            ? 'time'
            : 'day';
      if (normalizedPrecision !== 'time') {
        return group;
      }
      const hasHour = fields.some(field => field?.key === 'hour');
      const hasMinute = fields.some(field => field?.key === 'minute');
      const timeField = fields.find(field => field?.key === 'time_str');
      const isEnglish = /time/i.test(timeField?.label || '');
      const nextFields = fields.filter(field => field?.key !== 'time_str');
      if (!hasHour) {
        nextFields.push({ key: 'hour', label: isEnglish ? 'Hour' : '时', type: 'integer' });
      }
      if (!hasMinute) {
        nextFields.push({ key: 'minute', label: isEnglish ? 'Minute' : '分', type: 'integer' });
      }
      return {
        ...group,
        _precision: 'time',
        fields: nextFields,
      };
    });
    return normalized;
  }
}

window.worldMeta = window.worldMeta || new WorldMeta();
console.log('[WorldMeta] 初始化完成');
