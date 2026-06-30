// ============================================
// WorldMeta — 世界卡元数据访问器
// ============================================
// 职责：提供运行时对世界卡元数据的只读访问
//   - panel_fields（面板字段定义）
//   - prompt_modules（规则模块、开场白、prompt 配置）
//   - p1Output（Phase 1 创作者框架，含 frozen_moment / player_anchor / world_terms 等；从 card.designMeta.p1Output 注入）
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
    this._panelFields = null;
    this._promptModules = null;
    this._p1Output = null;
    this._characterTimelines = null;
    this._randomOpening = null;
    this._customTerrains = null;
    this._customTerritories = null;
    this._topLevelFrozenMoment = null;
    this._contentLocale = 'zh-CN';
  }

  // ========================================
  // 初始化 / 重置
  // ========================================

  /**
   * 从世界卡快照初始化元数据
   * @param {object} snapshot - 世界卡快照（原始，未处理过）
   * @param {string} [contentLocale='zh-CN']
   * @param {object} [p1Output=null] - Phase 1 创作者框架（来自 card.designMeta.p1Output），含 frozen_moment / player_anchor / world_terms 等
   */
  initialize(snapshot, contentLocale = 'zh-CN', p1Output = null) {
    if (!snapshot || typeof snapshot !== 'object') {
      this.clear();
      return;
    }

    this._panelFields = this._normalizePanelFields(snapshot.panel_fields || null);

    // V1 最老形态 frozen_moment 在 snapshot 顶层。正常 load 路径已被 v1ToV2 migrate 翻译进 p1Output，
    // 这里再额外存一份作为 worldMeta 自身的兜底——任何绕过 migrate 的调用方传入的 V1 raw snapshot 仍能读出。
    // 详 内部设计文档 · D3 + 步骤 5。
    this._topLevelFrozenMoment =
      snapshot.frozen_moment && typeof snapshot.frozen_moment === 'object'
        ? this._deepClone(snapshot.frozen_moment)
        : null;

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
      // Wave 1C: opening_greeting 上移到 snapshot 顶层。读取双源回退：
      // ① snapshot.opening_greeting (新位置) ② snapshot.prompt_modules.opening_greeting (老位置，保留兜底)
      const openingGreeting =
        typeof snapshot.opening_greeting === 'string' && snapshot.opening_greeting.trim()
          ? snapshot.opening_greeting
          : typeof snapshot.prompt_modules.opening_greeting === 'string'
            ? snapshot.prompt_modules.opening_greeting
            : '';
      // 兼容老 schema：2026-05-21 ~ 本次重构之间产的中间卡仍把 frozen_moment 落在 prompt_modules.frozen_moment。
      // 本次起新卡 frozen_moment 落 p1Output.frozen_moment；getFrozenMoment 双源回退见下方。
      const legacyFrozen =
        snapshot.prompt_modules.frozen_moment && typeof snapshot.prompt_modules.frozen_moment === 'object'
          ? this._deepClone(snapshot.prompt_modules.frozen_moment)
          : null;
      this._promptModules = {
        modules,
        module_meta: moduleMeta,
        opening_greeting: openingGreeting,
        frozen_moment: legacyFrozen,
        _summary: snapshot.prompt_modules._summary || '',
      };
    } else {
      this._promptModules = null;
    }

    // Wave 1C: 顶层 opening_greeting 即使没有 prompt_modules 也要单独读出来
    // （保证 getOpeningGreeting() 不依赖 prompt_modules 是否存在）
    this._topLevelOpeningGreeting =
      typeof snapshot.opening_greeting === 'string' ? snapshot.opening_greeting : null;

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

    this._p1Output =
      p1Output && typeof p1Output === 'object' ? this._deepClone(p1Output) : null;

    this._contentLocale =
      typeof contentLocale === 'string' && contentLocale.trim() ? contentLocale.trim() : 'zh-CN';
  }

  clear() {
    this._panelFields = null;
    this._promptModules = null;
    this._p1Output = null;
    this._characterTimelines = null;
    this._randomOpening = null;
    this._customTerrains = null;
    this._customTerritories = null;
    this._topLevelFrozenMoment = null;
    this._topLevelOpeningGreeting = null;
    this._contentLocale = 'zh-CN';
  }

  // ========================================
  // 基础读取接口
  // ========================================

  getPanelFields() {
    return this._panelFields || null;
  }

  // ====== Wave 2A 新形态访问器（status / npc 拆 system + custom）======
  // 现在的数据形态：panel_fields 同时存了老形态（panel_status / panel_npc 数组）和新形态（status / npc 拆开）
  // 新代码用这组访问器；老代码继续读 panel_status / panel_npc 数组也兼容。
  // 详 内部设计文档 Wave 2A。

  /** 返回 status.system_fields。新 V2 卡可能没经过 migration，lazy 派生自老 panel_status 数组。 */
  getStatusSystemFields() {
    if (this._panelFields?.status?.system_fields) return this._panelFields.status.system_fields;
    const arr = this._panelFields?.panel_status;
    if (!Array.isArray(arr)) return [];
    const SYSTEM_TEMPLATES = new Set(['time', 'location', 'money', 'objective']);
    return arr.filter(g => g && SYSTEM_TEMPLATES.has(g._template));
  }

  /** 返回 status.custom_fields。新 V2 卡 lazy 派生自老 panel_status 数组（非系统模板的）。 */
  getStatusCustomFields() {
    if (this._panelFields?.status?.custom_fields) return this._panelFields.status.custom_fields;
    const arr = this._panelFields?.panel_status;
    if (!Array.isArray(arr)) return [];
    const SYSTEM_TEMPLATES = new Set(['time', 'location', 'money', 'objective']);
    return arr.filter(g => g && !SYSTEM_TEMPLATES.has(g._template));
  }

  /** 返回 npc.system_fields（引擎硬字段）。新 V2 卡 lazy 派生自老 panel_npc 数组（过滤 trigger_type）。 */
  getNpcSystemFields() {
    if (this._panelFields?.npc?.system_fields) return this._panelFields.npc.system_fields;
    const arr = this._panelFields?.panel_npc;
    if (!Array.isArray(arr)) return [];
    const ENGINE_HARD = new Set([
      'id', 'name', 'gender', 'origin', 'birthday',
      'cognitive_state', 'initial_status',
      'dialogue_tone', 'dialogue_examples',
      'role', 'role_marker',
    ]);
    return arr.filter(f => f && f.key && f.key !== 'trigger_type' && ENGINE_HARD.has(f.key));
  }

  /** 返回 npc.custom_fields。新 V2 卡 lazy 派生自老 panel_npc 数组（非硬字段 + 过滤 trigger_type）。 */
  getNpcCustomFields() {
    if (this._panelFields?.npc?.custom_fields) return this._panelFields.npc.custom_fields;
    const arr = this._panelFields?.panel_npc;
    if (!Array.isArray(arr)) return [];
    const ENGINE_HARD = new Set([
      'id', 'name', 'gender', 'origin', 'birthday',
      'cognitive_state', 'initial_status',
      'dialogue_tone', 'dialogue_examples',
      'role', 'role_marker',
    ]);
    return arr.filter(f => f && f.key && f.key !== 'trigger_type' && !ENGINE_HARD.has(f.key));
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
    // Wave 1C: 优先顶层 snapshot.opening_greeting，回退 prompt_modules.opening_greeting（V1 老卡兼容）
    if (typeof this._topLevelOpeningGreeting === 'string' && this._topLevelOpeningGreeting.trim()) {
      return this._topLevelOpeningGreeting;
    }
    const greeting = this._promptModules?.opening_greeting;
    return typeof greeting === 'string' ? greeting : null;
  }

  // frozen_moment 锁定此刻（datetime + 可选 label + source）。地点改由开局问答 wizard 决定。
  // 三源回退（内部设计文档 · 步骤 5）：
  //   ① P1（card.designMeta.p1Output.frozen_moment）—— 当前 V2 主路径，正常 migrate 完都落在这里；
  //   ② Stage 2（card.snapshot.prompt_modules.frozen_moment）—— 兼容 2026-05-21 到 2026-05-24 间产的中间卡；
  //   ③ snapshot 顶层（V1 最老形态）—— 防御层，正常 load 路径 migrate 会把它搬进 ①，但绕过 migrate
  //      的调用方传入 raw V1 snapshot 仍能读出。
  //   都没有 → 返回 null（老卡走原"问玩家选时间"开局，零回归）。
  getFrozenMoment() {
    const fmP1 = this._p1Output?.frozen_moment;
    if (fmP1 && typeof fmP1 === 'object' && typeof fmP1.datetime === 'string' && fmP1.datetime.trim()) {
      return fmP1;
    }
    const fmS2 = this._promptModules?.frozen_moment;
    if (fmS2 && typeof fmS2 === 'object' && typeof fmS2.datetime === 'string' && fmS2.datetime.trim()) {
      return fmS2;
    }
    const fmV1 = this._topLevelFrozenMoment;
    if (fmV1 && typeof fmV1 === 'object' && typeof fmV1.datetime === 'string' && fmV1.datetime.trim()) {
      return fmV1;
    }
    return null;
  }

  /** Phase 1 玩家施力点 player_anchor：{ allowed_modes[], compliance, recommended_role }。开场选择按钮读 recommended_role。 */
  getPlayerAnchor() {
    const pa = this._p1Output?.player_anchor;
    return pa && typeof pa === 'object' ? pa : null;
  }

  /**
   * 作者在起名步骤刻意"留空"的实体（naming_registry 里值为 {?Unknown?} 的项）。
   * 运行时 GM 据此在该实体首次有意义出场时即兴起名、之后一致使用（红线 C：兑现"留空运行时再起名"承诺）。
   * 返回 [{label, count}]；count>1 = 批量（如"12 圣女"）。无 p1Output / 无留空项 → 空数组。
   */
  getUnnamedEntities() {
    const reg = this._p1Output?.naming_registry;
    if (!reg || typeof reg !== 'object') return [];
    const out = [];
    for (const [key, value] of Object.entries(reg)) {
      const label = key.replace(/_batch$/, '');
      if (value === '{?Unknown?}') {
        out.push({ label, count: 1 });
      } else if (value && typeof value === 'object' && value.type === 'batch' && value.value === '{?Unknown?}') {
        out.push({ label, count: Number.isFinite(value.count) && value.count > 0 ? Math.floor(value.count) : 1 });
      }
    }
    return out;
  }

  /**
   * @deprecated character_timelines 顶层字段已于 2026 Stage 4 重做废弃。
   * 三轴时间线（cognitive/relationships/status）已并入 Stage 3 角色 schema：
   *   cognitive → character.cognitive_state
   *   status → character.initial_status + runtime panel_npc 推断
   *   relationships → character.relationships
   * 这两个 API 仅作为老卡兼容读取层保留，仅 Analyzer fallback 链调用，新代码勿用。
   */
  getCharacterTimelines() {
    return this._characterTimelines ? this._deepClone(this._characterTimelines) : null;
  }

  /** @deprecated 见 getCharacterTimelines */
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
    const groups = this._panelFields?.panel_status;
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

    // Wave 3B: 优先 p1Output.world_terms.currency_name（单一真源）
    // 回退 panel_fields._worldTermsSource（V1 老卡兼容）
    const p1Terms = this._p1Output?.world_terms;
    if (p1Terms && typeof p1Terms === 'object' && typeof p1Terms.currency_name === 'string' && p1Terms.currency_name.trim()) {
      currency = p1Terms.currency_name.trim();
    }
    const tws = this._panelFields?._worldTermsSource;
    if (!currency && tws && typeof tws === 'object') {
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

  _normalizePanelFields(panelFields) {
    if (!panelFields || typeof panelFields !== 'object') return null;
    const normalized = this._deepClone(panelFields);
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
