// ============================================
// Step 3 Schema Builder
// ============================================
// 从 step3_fields 字段定义自动生成 Step 3 JSON Schema
// 所有世界统一使用此 builder

const STEP3_SCHEMA_BUILDER_CHOICE_RULES =
  typeof window !== 'undefined' && window.STEP3_CHOICE_RULES
    ? window.STEP3_CHOICE_RULES
    : Object.freeze({
        typeValues: Object.freeze(['explore', 'trade', 'travel', 'work', 'talk', 'action']),
      });

/**
 * 默认的 panel_status 字段定义
 * 当自定义世界卡没有 step3_fields 时使用
 */
const DEFAULT_STATUS_FIELDS = [
  {
    key: 'datetime',
    label: '时间',
    icon: '📅',
    _template: 'time',
    _precision: 'time',
    fields: [
      { key: 'year', label: '年份', type: 'integer' },
      { key: 'month', label: '月份', type: 'integer' },
      { key: 'day', label: '日期', type: 'integer' },
      { key: 'hour', label: '时', type: 'integer' },
      { key: 'minute', label: '分', type: 'integer' },
    ],
  },
  {
    key: 'location',
    label: '地点',
    icon: '📍',
    fields: [
      { key: 'country', label: '国家/区域', type: 'string' },
      { key: 'site', label: '地点', type: 'string' },
      { key: 'spot', label: '具体位置', type: 'string' },
    ],
  },
  // 注：money group 已移除——货币已迁移到物品栏（inventoryStore），通过 update_item 工具变更。
  // 货币名通过 step3_fields._worldTermsSource.currency_name 配置。
  {
    key: 'objective',
    label: '目标',
    icon: '🎯',
    _template: 'objective',
    fields: [{ key: 'text', label: '当前目标', type: 'string', nullable: true }],
  },
];

/**
 * 默认的 panel_npc 字段定义
 */
const NPC_DISPLAY_CORE_FIELDS = [
  {
    key: 'trigger_type',
    label: '触发类型',
    desc: 'NEW=新角色首次登场 / UPDATE=运行时状态变化（禁止改 gender/origin/birthday） / NEW_PREDEFINED=预定义角色首次登场（只需id）',
    type: 'string',
    enum: ['NEW', 'UPDATE', 'NEW_PREDEFINED'],
    fixed: true,
    runtimeRequired: true,
  },
  { key: 'id', label: '标识符', desc: '唯一标识，同一角色在不同事件中保持一致', type: 'string', fixed: true, runtimeRequired: true },
  { key: 'name', label: '角色名', desc: '角色的显示名称', type: 'string', fixed: true, runtimeRequired: true },
  {
    key: 'gender',
    label: '性别',
    desc: '如：女/男/未知',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'origin',
    label: '来历',
    desc: '一句话说明出身或来源',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'birthday',
    label: '生日',
    desc: '纯时间值，格式必须符合当前世界历法',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
    nullable: true,
  },
  {
    key: 'cognitive_state',
    label: '认知状态',
    desc: '角色当前认为自己是谁（最多10字）',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'msg_reply_tone',
    label: '说话语气',
    desc: '稳定说话风格，不写当前情绪',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
];

const NPC_RUNTIME_REQUIRED_KEYS = ['trigger_type', 'id', 'name'];
const NPC_RUNTIME_LOCKED_UPDATE_KEYS = [
  'trigger_type',
  'id',
  'name',
  'gender',
  'origin',
  'birthday',
  'age',
];
const NPC_RUNTIME_MUTABLE_UPDATE_HINT_KEYS = [
  'clothing',
  'msg_reply_tone',
  'role',
  'faction',
  'appearance',
];

// v2 字段分拣表（card.* / state.* 两层命名空间）
// 详见 内部设计文档

// state 子对象 6 字段（NPC reaction 自己写、不审批、不入工具 schema 暴露面）
const NPC_STATE_KEYS = [
  'current_location',
  'current_mood',
  'intent_toward_player',
  'current_social_target',
  'recent_thoughts',
  'last_woken_turn',
];

// 从 schema 暴露面 / 存档 / 工具入参全删（不进 npc.card 也不进 npc.state）
// 注意：cognitive_state 保留在 card.*（DM 写），不在此列
const NPC_DROP_KEYS = [
  // v1.5 野字段（已废）
  'current_goal',
  'attitude_towards_player',
  'relationships',
  // 路由 transport（不挂 NPC 对象，processNpcPanel 消费即丢）
  'trigger_type',
  // 历史字段
  'age',
];

// 私有运行时元数据：顶层挂、存档 drop、不入 schema、不入 card/state
// 由 npcStore._sanitizePersistentNpcData 在序列化前剥离
const NPC_RUNTIME_PRIVATE_KEYS = ['_lastTurn', '_lastUID'];

// v1.5 兼容别名（外部引用者可能仍读 NPC_OWNED_BY_NPC_KEYS，指向 state keys 即可）
const NPC_OWNED_BY_NPC_KEYS = NPC_STATE_KEYS;

const DEFAULT_NPC_FIELDS = [
  ...NPC_DISPLAY_CORE_FIELDS.map(field => ({ ...field })),
  { key: 'personality', label: '性格标签', desc: '如：强势/沉稳/温和', type: 'string' },
  { key: 'appearance', label: '外貌特征', desc: '如：黑长直/金发碧眼', type: 'string' },
  { key: 'clothing', label: '当前衣着', desc: '当前具体衣着', type: 'string' },
];

function _deepCloneDefaultFields(fields) {
  return JSON.parse(JSON.stringify(fields));
}

function _resolveDefaultFieldLocale(locale = null) {
  if (locale === 'en' || locale === 'zh-CN') return locale;
  return window.i18nService?.getResolvedLanguage?.() === 'en' ? 'en' : 'zh-CN';
}

function getDefaultStatusFields(locale = null) {
  const resolvedLocale = _resolveDefaultFieldLocale(locale);
  if (resolvedLocale !== 'en') {
    return _deepCloneDefaultFields(DEFAULT_STATUS_FIELDS);
  }

  return _deepCloneDefaultFields([
    {
      key: 'datetime',
      label: 'Time',
      icon: '📅',
      _template: 'time',
      _precision: 'time',
      _era: 'Common Era',
      fields: [
        { key: 'year', label: 'Year', type: 'integer' },
        { key: 'month', label: 'Month', type: 'integer' },
        { key: 'day', label: 'Day', type: 'integer' },
        { key: 'hour', label: 'Hour', type: 'integer' },
        { key: 'minute', label: 'Minute', type: 'integer' },
      ],
    },
    {
      key: 'location',
      label: 'Location',
      icon: '📍',
      fields: [
        { key: 'country', label: 'Region', type: 'string' },
        { key: 'site', label: 'Place', type: 'string' },
        { key: 'spot', label: 'Spot', type: 'string' },
      ],
    },
    // 注：money group 已移除——货币已迁移到物品栏（inventoryStore）。
    {
      key: 'objective',
      label: 'Objective',
      icon: '🎯',
      _template: 'objective',
      fields: [{ key: 'text', label: 'Current Objective', type: 'string', nullable: true }],
    },
  ]);
}

function getDefaultNpcFields(locale = null) {
  const resolvedLocale = _resolveDefaultFieldLocale(locale);
  if (resolvedLocale !== 'en') {
    return _deepCloneDefaultFields(DEFAULT_NPC_FIELDS);
  }

  return _deepCloneDefaultFields([
    {
      key: 'trigger_type',
      label: 'Trigger Type',
      desc: 'NEW=first appearance (full card) / UPDATE=card field change (only changed fields) / NEW_PREDEFINED=first predefined appearance (id only, omit card)',
      type: 'string',
      enum: ['NEW', 'UPDATE', 'NEW_PREDEFINED'],
      fixed: true,
      runtimeRequired: true,
    },
    { key: 'id', label: 'Identifier', desc: 'Unique ID, consistent across events for the same character', type: 'string', fixed: true, runtimeRequired: true },
    { key: 'name', label: 'Name', desc: 'Display name of the character', type: 'string', fixed: true, runtimeRequired: true },
    {
      key: 'gender',
      label: 'Gender',
      desc: 'For example: Female / Male / Unknown',
      type: 'string',
      fixed: true,
      runtimeRequired: false,
    },
    {
      key: 'origin',
      label: 'Origin',
      desc: 'One-line source or background',
      type: 'string',
      fixed: true,
      runtimeRequired: false,
    },
    {
      key: 'birthday',
      label: 'Birthday',
      desc: 'Pure time value following the current world calendar',
      type: 'string',
      fixed: true,
      runtimeRequired: false,
      nullable: true,
    },
    {
      key: 'cognitive_state',
      label: 'Cognitive State',
      desc: 'Who the character currently believes they are (max 10 words)',
      type: 'string',
      fixed: true,
      runtimeRequired: false,
    },
    {
      key: 'msg_reply_tone',
      label: 'Reply Tone',
      desc: 'Stable speaking style, not temporary mood',
      type: 'string',
      fixed: true,
      runtimeRequired: false,
    },
    {
      key: 'personality',
      label: 'Personality',
      desc: 'For example: forceful / calm / gentle',
      type: 'string',
    },
    {
      key: 'appearance',
      label: 'Appearance',
      desc: 'For example: dark long hair / blond blue eyes',
      type: 'string',
    },
    { key: 'clothing', label: 'Clothing', desc: 'Current outfit', type: 'string' },
  ]);
}

function _isPanelNpcFieldRequired(field) {
  if (!field || typeof field !== 'object') return false;
  if (field.runtimeRequired === true) return true;
  if (field.runtimeRequired === false) return false;
  return field.fixed === true;
}

/**
 * 从字段定义生成完整的 Step 3 JSON Schema
 * @param {Object} fields - step3_fields 对象 { panel_status, panel_npc }
 * @param {string[]} locationEnumValues - 自定义世界 location.country 的枚举值
 * @returns {Object} 完整的 JSON Schema
 */
function buildStep3SchemaFromFields(fields, locationEnumValues = [], options = {}) {
  const statusFields = fields.panel_status || getDefaultStatusFields();
  const npcFields = fields.panel_npc || getDefaultNpcFields();

  const properties = {
    panel_npc: _buildPanelNpcSchema(npcFields),
    panel_status: _buildPanelStatusSchema(statusFields, locationEnumValues, options),
    choices: _buildChoicesSchema(),
  };
  const required = ['panel_npc', 'panel_status', 'choices'];

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * 从字段定义生成状态提取专用 Step 3 JSON Schema
 * @param {Object} fields - step3_fields 对象 { panel_status, panel_npc }
 * @param {string[]} locationEnumValues - 自定义世界 location.country 的枚举值
 * @returns {Object} 状态提取 JSON Schema
 */
function buildStep3StateSchemaFromFields(fields, locationEnumValues = [], options = {}) {
  const statusFields = fields.panel_status || getDefaultStatusFields();
  const npcFields = fields.panel_npc || getDefaultNpcFields();

  return {
    type: 'object',
    properties: {
      panel_npc: _buildPanelNpcSchema(npcFields),
      panel_status: _buildPanelStatusSchema(statusFields, locationEnumValues, options),
    },
    required: ['panel_npc', 'panel_status'],
    additionalProperties: false,
  };
}

/**
 * 构建单个 panel_npc 字段的 JSON schema 片段
 */
function _buildSingleNpcFieldProp(field) {
  let description = field.label;
  if (field.desc) description += `（${field.desc}）`;

  const nonNullProp = { type: field.type || 'string' };
  // enum 必须在 spread 之前应用到 nonNullProp——非 nullable 路径用 spread 浅拷贝，
  // 一旦 spread 之后再修改 nonNullProp.enum 不会反映到最终 prop（老 bug，本次顺手修）
  if (Array.isArray(field.enum) && field.enum.length > 0) {
    nonNullProp.enum = [...field.enum];
    if (field.key === 'trigger_type' && !nonNullProp.enum.includes('NEW_PREDEFINED')) {
      nonNullProp.enum.push('NEW_PREDEFINED');
    }
  }

  const prop = field.nullable
    ? { description, anyOf: [{ type: 'null' }, nonNullProp] }
    : { ...nonNullProp, description };

  if (field.key === 'trigger_type' && !prop.description.includes('NEW_PREDEFINED')) {
    prop.description =
      '触发类型（NEW=新角色首次登场 / UPDATE=card 内字段发生变化 / NEW_PREDEFINED=预定义角色首次登场，省略 card）';
  }
  return prop;
}

/**
 * 构建 panel_npc schema（嵌套结构 v2）
 * 顶层只有 trigger_type / id / name / card；其他字段塞进 card.properties
 * NPC_DROP_KEYS 命中的字段直接跳过——过滤 worldcard JSON 里残留的 v1.5 野字段
 */
function _buildPanelNpcSchema(npcFields) {
  // trigger_type / id / name 放顶层；其他 panel_npc 字段放进 card 子对象；
  // NPC_DROP_KEYS 命中的字段直接跳过（v1.5 野字段过滤）
  const TOP_LEVEL_KEYS = new Set(['trigger_type', 'id', 'name']);
  const DROP = new Set(NPC_DROP_KEYS);

  const topProps = {};
  const cardProps = {};
  const topRequired = [];
  const cardRequired = [];

  for (const field of npcFields) {
    if (!field || !field.key) continue;
    if (DROP.has(field.key)) continue;

    const prop = _buildSingleNpcFieldProp(field);
    if (TOP_LEVEL_KEYS.has(field.key)) {
      topProps[field.key] = prop;
      if (_isPanelNpcFieldRequired(field)) topRequired.push(field.key);
    } else {
      cardProps[field.key] = prop;
      if (_isPanelNpcFieldRequired(field)) cardRequired.push(field.key);
    }
  }

  topProps.card = {
    type: 'object',
    description:
      'NPC 身份/档案字段（DM 写、审批可改）。NEW_PREDEFINED 时省略整块；UPDATE 时只放变化字段。',
    properties: cardProps,
    required: cardRequired,
    additionalProperties: false,
  };

  return {
    description:
      '新登场或状态变化的角色。NEW=新角色首次登场；UPDATE=card 内字段发生变化；NEW_PREDEFINED=预定义角色首次登场（顶层 trigger_type+id+name，省略 card）；null=无上述。UPDATE 仅允许修改 card 内运行时字段（clothing/msg_reply_tone/role/faction/appearance/cognitive_state 等），禁止修改 id/name/gender/origin/birthday。state.* 字段归 NPC 自治、不在此 schema 暴露。',
    anyOf: [
      { type: 'null' },
      {
        type: 'array',
        items: {
          type: 'object',
          description: 'NPC档案。所有字段值必须极简：标签式，最多3词，用/分隔',
          properties: topProps,
          required: topRequired,
          additionalProperties: false,
        },
      },
    ],
  };
}

/**
 * 构建 panel_status schema
 */
function _buildPanelStatusSchema(statusFields, locationEnumValues, options = {}) {
  const properties = {};
  const required = [];
  const omittedStatusKeys = new Set(
    Array.isArray(options.omitStatusKeys)
      ? options.omitStatusKeys
          .filter(key => typeof key === 'string' && key.trim())
          .map(key => key.trim())
      : []
  );

  let hasMoveToGroup = false;
  for (const group of statusFields) {
    if (!group || omittedStatusKeys.has(group.key)) continue;
    if (group._template === 'move_to') {
      // move_to 坐标组
      hasMoveToGroup = true;
      properties[group.key] = _buildMoveToSchema(group);
    } else if (group.type === 'array') {
      // 数组类型
      properties[group.key] = _buildArrayGroupSchema(group);
    } else {
      // 普通对象类型（如 datetime, location, player_state）
      properties[group.key] = _buildObjectGroupSchema(group, locationEnumValues);
    }
    required.push(group.key);
  }

  // 无 move_to 组时：追加 null
  if (!hasMoveToGroup) {
    properties.move_to = {
      description: '本世界不使用地图坐标系统，始终为null',
      type: 'null',
    };
    required.push('move_to');
  }

  return {
    type: 'object',
    description: '游戏状态面板',
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * 获取 group 中指定 key 的字段定义
 */
function _getFieldByKey(group, key) {
  if (!group || !Array.isArray(group.fields)) return null;
  return group.fields.find(f => f && f.key === key) || null;
}

/**
 * 从年份字段标签推断纪年名（如 "星历年" -> "星历"）
 */
function _extractEraFromYearLabel(label) {
  if (typeof label !== 'string') return '';
  const raw = label.trim();
  if (!raw || raw === '年份' || raw === '年') return '';
  if (raw.endsWith('年')) return raw.slice(0, -1).trim();
  return '';
}

/**
 * 归一化时间单位标签
 */
function _normalizeTimeUnitLabel(label, fallback) {
  if (typeof label !== 'string' || !label.trim()) return fallback;
  const raw = label.trim();
  if (raw === '年份') return '年';
  if (raw === '月份') return '月';
  if (raw === '日期') return '日';
  return raw;
}

/**
 * 判断货币字段标签是否有效（过滤通用占位词）
 */
function _isValidCurrencyLabel(label) {
  if (typeof label !== 'string' || !label.trim()) return false;
  const value = label.trim().toLowerCase();
  const invalid = new Set(['金钱', 'money', '金额', '货币', '货币单位']);
  return !invalid.has(value);
}

/**
 * 从 group 中解析货币单位（兼容 money 模板与 player_state.money）
 */
function getCurrencyLabelFromGroup(group) {
  if (!group || typeof group !== 'object') return '';

  if (typeof group._currency === 'string' && group._currency.trim()) {
    return group._currency.trim();
  }

  if (group._template === 'money') {
    const label = _getFieldByKey(group, 'amount')?.label || group.fields?.[0]?.label;
    return _isValidCurrencyLabel(label) ? label.trim() : '';
  }

  if (group.key === 'player_state') {
    const moneyLabel = _getFieldByKey(group, 'money')?.label;
    return _isValidCurrencyLabel(moneyLabel) ? moneyLabel.trim() : '';
  }

  return '';
}

/**
 * 从时间组中提取纪年与单位信息
 */
function getTimeTermsFromGroup(group) {
  const isTimeGroup = !!group && (group._template === 'time' || group.key === 'datetime');
  if (!isTimeGroup) return null;

  const yearField = _getFieldByKey(group, 'year');
  const monthField = _getFieldByKey(group, 'month');
  const dayField = _getFieldByKey(group, 'day');
  const hourField = _getFieldByKey(group, 'hour');
  const minuteField = _getFieldByKey(group, 'minute');

  let precision = 'year';
  if (group && typeof group._precision === 'string' && group._precision.trim()) {
    precision = group._precision.trim();
  } else {
    const keys = Array.isArray(group.fields) ? group.fields.map(f => f?.key) : [];
    if (keys.includes('hour') || keys.includes('minute') || keys.includes('time_str')) precision = 'time';
    else if (keys.includes('day')) precision = 'day';
    else if (keys.includes('month')) precision = 'month';
  }

  let era = '';
  if (typeof group._era === 'string' && group._era.trim()) {
    era = group._era.trim();
  } else {
    era = _extractEraFromYearLabel(yearField?.label);
  }

  // 兼容旧结构：calendar_era 被直接写到 year 字段 label（如 "星历"）
  const rawYearLabel = typeof yearField?.label === 'string' ? yearField.label.trim() : '';
  const rawMonthLabel = typeof monthField?.label === 'string' ? monthField.label.trim() : '';
  const rawDayLabel = typeof dayField?.label === 'string' ? dayField.label.trim() : '';
  const monthIsGeneric = !rawMonthLabel || rawMonthLabel === '月份' || rawMonthLabel === '月';
  const dayIsGeneric = !rawDayLabel || rawDayLabel === '日期' || rawDayLabel === '日';
  let yearUnit = _normalizeTimeUnitLabel(yearField?.label, '年');
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
    precision,
    labels: {
      year: yearUnit,
      month: _normalizeTimeUnitLabel(monthField?.label, '月'),
      day: _normalizeTimeUnitLabel(dayField?.label, '日'),
      hour: _normalizeTimeUnitLabel(hourField?.label, '时'),
      minute: _normalizeTimeUnitLabel(minuteField?.label, '分'),
    },
  };
}

/**
 * 使用时间组配置格式化时间文本
 */
function formatTimeValueFromGroup(data, group) {
  const terms = getTimeTermsFromGroup(group);
  if (!terms || !data || data.year === null || data.year === undefined || data.year === '')
    return '';

  const year = data.year;
  const month = data.month;
  const day = data.day;
  const hour = Number.parseInt(data.hour, 10);
  const minute = Number.parseInt(data.minute, 10);
  const legacyTimeStr = typeof data.time_str === 'string' ? data.time_str.trim() : '';

  let text = '';
  if (terms.era) text += `${terms.era} `;
  text += `${year}${terms.labels.year || '年'}`;

  if (
    ['month', 'day', 'time'].includes(terms.precision) &&
    month !== null &&
    month !== undefined &&
    month !== ''
  ) {
    text += `${month}${terms.labels.month || '月'}`;
  }
  if (
    ['day', 'time'].includes(terms.precision) &&
    day !== null &&
    day !== undefined &&
    day !== ''
  ) {
    text += `${day}${terms.labels.day || '日'}`;
  }
  if (terms.precision === 'time') {
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      text += ` ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } else if (legacyTimeStr) {
      text += ` ${legacyTimeStr}`;
    }
  }

  return text.trim();
}

/**
 * 构建 move_to 坐标组 schema（anyOf: null | object{q, r}）
 */
function _buildMoveToSchema(group) {
  const objProperties = {};
  const objRequired = [];
  for (const field of group.fields || []) {
    objProperties[field.key] = {
      type: field.type || 'integer',
      description: field.desc || field.label,
    };
    objRequired.push(field.key);
  }
  return {
    description:
      group._schemaDescription || '移动目标坐标。仅当叙事中玩家发生位置移动时填写。无移动则null',
    anyOf: [
      { type: 'null' },
      {
        type: 'object',
        properties: objProperties,
        required: objRequired,
        additionalProperties: false,
      },
    ],
  };
}

/**
 * 构建对象类型的组 schema（如 datetime, location, player_state）
 */
function _buildObjectGroupSchema(group, locationEnumValues) {
  const properties = {};
  const required = [];

  for (const field of group.fields || []) {
    const resolvedEnum = _resolveFieldEnum(field, locationEnumValues, group?.key);
    const isDisplayNameConstrainedLocation =
      group?.key === 'location' && field?.key === 'country' && resolvedEnum.length > 0;
    const baseDescription = field.desc || field.label;
    const fieldDescription = isDisplayNameConstrainedLocation
      ? `${baseDescription}（使用世界设定显示名，禁止输出 entity ID）`
      : baseDescription;
    if (resolvedEnum.length > 0) {
      properties[field.key] = {
        type: field.type || 'string',
        enum: resolvedEnum,
        description: fieldDescription,
      };
    } else if (field.nullable) {
      properties[field.key] = {
        description: field.label + '，无则null',
        anyOf: [{ type: 'null' }, { type: field.type || 'string' }],
      };
    } else {
      properties[field.key] = {
        type: field.type || 'string',
        description: fieldDescription,
      };
    }
    required.push(field.key);
  }

  // 货币字段：增强描述以约束叙事中的货币名称
  let desc = group.label;
  const currency = getCurrencyLabelFromGroup(group);
  if (currency) {
    desc = `${group.label}（世界唯一货币单位：${currency}，严禁使用其他货币名称）`;
  }

  return {
    type: 'object',
    description: desc,
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * 归一化枚举值列表：去空、去重、保持原顺序
 */
function _normalizeEnumValues(values) {
  if (!Array.isArray(values)) return [];
  const seen = new Set();
  const normalized = [];
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

/**
 * 解析字段的枚举约束（统一规则）
 * 优先级：
 * 1) 字段自带 enum（最高优先级）
 * 2) panel_status.location.country 回退到调用方提供的地点枚举值
 * 3) 其余字段无枚举约束
 */
function _resolveFieldEnum(field, locationEnumValues = [], groupKey = '') {
  const fieldEnum = _normalizeEnumValues(field?.enum);
  if (fieldEnum.length > 0) return fieldEnum;

  // 只对 location.country 做回退，避免影响其它同名字段
  if (groupKey === 'location' && field?.key === 'country') {
    return _normalizeEnumValues(locationEnumValues);
  }
  return [];
}

function _formatLocationDisplayValue(value) {
  if (value === null || value === undefined || value === '') return value;
  const eStore = window.entityStore;
  if (!eStore || typeof eStore.resolveDisplayName !== 'function') {
    return value;
  }
  const displayValue = eStore.resolveDisplayName(String(value));
  return displayValue || value;
}

/**
 * 构建数组类型的组 schema
 */
function _buildArrayGroupSchema(group) {
  const itemProperties = {};
  const itemRequired = [];

  for (const field of group.fields || []) {
    itemProperties[field.key] = {
      type: field.type || 'string',
      description: field.label,
    };
    itemRequired.push(field.key);
  }

  return {
    type: 'array',
    description: group.label,
    items: {
      type: 'object',
      properties: itemProperties,
      required: itemRequired,
      additionalProperties: false,
    },
  };
}

/**
 * 构建 choices schema（固定结构）
 */
function _buildChoicesSchema() {
  return {
    type: 'array',
    description:
      '解析叙事生成的 3 个选项，结构化输出。将纯文本选项视作普通文本，重新分配 type_tag 和 cost_hint',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string', enum: ['A', 'B', 'C'], description: '选项ID' },
        type_tag: {
          type: 'string',
          enum: STEP3_SCHEMA_BUILDER_CHOICE_RULES.typeValues,
          description: '选项类型，6选1。按主要目的判断：travel / trade / talk / work / explore / action',
        },
        short_text: { type: 'string', description: '选项简述（核心行动）' },
        detail_text: { type: 'string', description: '选项详情（如有，无则为空字符串）' },
        cost_hint: { type: 'string', description: '代价提示，按 type_tag 规范生成' },
        effect_days: {
          type: 'integer',
          description: '天数变化量，仅 travel/work 大于0，其他类型固定为0',
        },
        effect_money: {
          type: 'integer',
          description: '金钱变化量，非 trade/work 时固定为0',
        },
      },
      required: [
        'id',
        'type_tag',
        'short_text',
        'detail_text',
        'cost_hint',
        'effect_days',
        'effect_money',
      ],
      additionalProperties: false,
    },
    minItems: 3,
    maxItems: 3,
  };
}

/**
 * 从 panel_status 数据和字段定义构建纯文本摘要（用于 lastGameState）
 * @param {Object} status - panel_status 数据
 * @param {Array} statusFields - panel_status 字段定义
 * @returns {string} 纯文本摘要
 */
function buildLastGameStateText(status, statusFields) {
  const lines = [];
  for (const group of statusFields) {
    const data = status[group.key];
    if (!data) continue;

    if (group.type === 'array' && Array.isArray(data)) {
      // 数组类型：列出所有项
      const items = data
        .map(item => {
          return (group.fields || [])
            .map(f => item[f.key])
            .filter(v => v !== null && v !== undefined && v !== '')
            .join('/');
        })
        .filter(Boolean);
      if (items.length > 0) {
        lines.push(`* ${group.label}: ${items.join(', ')}`);
      }
    } else if (typeof data === 'object') {
      const timeText = formatTimeValueFromGroup(data, group);
      if (timeText) {
        lines.push(`* ${group.label}: ${timeText}`);
        continue;
      }

      const currency = getCurrencyLabelFromGroup(group);
      if (
        group.key === 'player_state' &&
        data.money !== null &&
        data.money !== undefined &&
        data.money !== ''
      ) {
        const psParts = [currency ? `${data.money} ${currency}` : `${data.money}`];
        if (data.current_objective) psParts.push(data.current_objective);
        lines.push(`* ${group.label}: ${psParts.join(' ')}`);
        continue;
      }
      if (
        group._template === 'money' &&
        data.amount !== null &&
        data.amount !== undefined &&
        data.amount !== ''
      ) {
        lines.push(`* ${group.label}: ${data.amount}${currency ? ` ${currency}` : ''}`);
        continue;
      }

      // 对象类型：列出所有子字段值
      const parts = [];
      for (const field of group.fields || []) {
        const val = data[field.key];
        if (val !== null && val !== undefined && val !== '') {
          const displayValue = group.key === 'location' ? _formatLocationDisplayValue(val) : val;
          parts.push(displayValue);
        }
      }
      if (parts.length > 0) {
        let line = `* ${group.label}: ${parts.join(' ')}`;
        // 货币字段：追加单位名称（如 "1500" → "1500 信用点"）
        if (currency && group.key !== 'datetime') {
          line += ` ${currency}`;
        }
        lines.push(line);
      }
    }
  }
  return lines.length > 0 ? lines.join('\n') : '';
}

/**
 * 把 panel_npc 字段列表渲染成嵌套 JSON 模板文本（顶层 trigger_type/id/name + card 子对象）
 * NPC_DROP_KEYS 命中的字段跳过——过滤 worldcard JSON 里残留的 v1.5 野字段（current_goal 等）
 */
function _appendPanelNpcTextLines(lines, npcFields, I, trailingComma) {
  const TOP_LEVEL_KEYS = new Set(['trigger_type', 'id', 'name']);
  const DROP = new Set(NPC_DROP_KEYS);

  const topFields = [];
  const cardFields = [];
  for (const f of npcFields) {
    if (!f || !f.key) continue;
    if (DROP.has(f.key)) continue;
    if (TOP_LEVEL_KEYS.has(f.key)) topFields.push(f);
    else cardFields.push(f);
  }

  const renderField = (f, indent, isLast) => {
    const t = f.type || 'string';
    const typeText = f.nullable ? `${t} | null` : t;
    const comma = isLast ? '' : ',';
    if (f.key === 'trigger_type') {
      lines.push(`${indent}"trigger_type": "NEW|UPDATE|NEW_PREDEFINED"${comma}`);
      return;
    }
    const enumTag = Array.isArray(f.enum) && f.enum.length > 0
      ? ` [${f.enum.map(v => `"${v}"`).join(' | ')}]`
      : '';
    const hintBase = f.desc ? `${f.label}（${f.desc}）` : f.label;
    const hint = f.nullable ? `${hintBase}；未知时写 null` : hintBase;
    lines.push(`${indent}"${f.key}": "${typeText} // ${hint}${enumTag}"${comma}`);
  };

  lines.push(`${I}"panel_npc": [`);
  lines.push(`${I}${I}{`);
  // 顶层字段
  for (let i = 0; i < topFields.length; i++) {
    renderField(topFields[i], `${I}${I}${I}`, /* isLast */ false);
  }
  // card 嵌套
  lines.push(`${I}${I}${I}"card": {`);
  for (let i = 0; i < cardFields.length; i++) {
    renderField(cardFields[i], `${I}${I}${I}${I}`, /* isLast */ i === cardFields.length - 1);
  }
  lines.push(`${I}${I}${I}}`);
  lines.push(`${I}${I}}`);
  lines.push(`${I}]${trailingComma ? ',' : ''}`);
  lines.push(
    `${I}// ⚠ trigger_type=NEW_PREDEFINED 时省略 card（只输出 trigger_type+id+name）；UPDATE 时 card 只放变化字段`
  );
}

/**
 * 生成可嵌入 prompt 的 JSON 模板文本（用于非 Schema provider）
 * 手工拼行以支持 "type // label" 注释风格
 * @param {{ panel_status: Array, panel_npc: Array }} fields
 * @param {string[]} locationEnumValues - 当前世界 location.country 的枚举值
 * @returns {string} JSON 模板字符串
 */
function buildSchemaTextGuide(fields, locationEnumValues = []) {
  const statusFields = fields.panel_status || getDefaultStatusFields();
  const npcFields = fields.panel_npc || getDefaultNpcFields();
  const I = '  '; // 缩进单位

  const lines = ['{'];

  // ---- panel_npc（嵌套结构 v2：顶层 trigger_type/id/name + card 子对象）----
  _appendPanelNpcTextLines(lines, npcFields, I, /* trailingComma */ true);

  // ---- panel_status ----
  lines.push(`${I}"panel_status": {`);
  const statusEntries = [];
  for (const group of statusFields) {
    const entry = [];
    if (group._template === 'move_to') {
      // move_to 坐标组：显示为 null | {q, r}
      entry.push(`${I}${I}"${group.key}": {`);
      const gf = group.fields || [];
      for (let i = 0; i < gf.length; i++) {
        const f = gf[i];
        const comma = i < gf.length - 1 ? ',' : '';
        entry.push(
          `${I}${I}${I}"${f.key}": "${f.type || 'integer'} // ${f.desc || f.label}"${comma}`
        );
      }
      entry.push(`${I}${I}} | null`);
    } else if (group.type === 'array') {
      // 数组 group
      entry.push(`${I}${I}"${group.key}": [`);
      entry.push(`${I}${I}${I}{`);
      const gf = group.fields || [];
      for (let i = 0; i < gf.length; i++) {
        const f = gf[i];
        const comma = i < gf.length - 1 ? ',' : '';
        entry.push(`${I}${I}${I}${I}"${f.key}": "${f.type || 'string'} // ${f.label}"${comma}`);
      }
      entry.push(`${I}${I}${I}}`);
      entry.push(`${I}${I}]`);
    } else {
      // 对象 group
      entry.push(`${I}${I}"${group.key}": {`);
      const gf = group.fields || [];
      for (let i = 0; i < gf.length; i++) {
        const f = gf[i];
        const comma = i < gf.length - 1 ? ',' : '';
        const enumValues = _resolveFieldEnum(f, locationEnumValues, group?.key);
        const enumTag = enumValues.length > 0 ? ` [枚举: ${enumValues.join('/')}]` : '';
        const locationNote =
          group?.key === 'location' && f.key === 'country' && enumValues.length > 0
            ? ' [仅显示名，禁止 entity ID]'
            : '';
        entry.push(
          `${I}${I}${I}"${f.key}": "${f.type || 'string'} // ${f.label}${enumTag}${locationNote}"${comma}`
        );
      }
      entry.push(`${I}${I}}`);
    }
    statusEntries.push(entry.join('\n'));
  }
  // move_to：如果 statusFields 中没有 move_to 组，追加 null
  const hasMoveToInFields = statusFields.some(g => g._template === 'move_to');
  if (!hasMoveToInFields) {
    statusEntries.push(`${I}${I}"move_to": null`);
  }
  lines.push(statusEntries.join(',\n'));
  lines.push(`${I}},`);

  // ---- choices（固定结构）----
  lines.push(`${I}"choices": [`);
  lines.push(
    `${I}${I}{ "id": "A", "type_tag": "explore|trade|travel|work|talk|action", "short_text": "...", "detail_text": "...", "cost_hint": "...", "effect_days": 0, "effect_money": 0 },`
  );
  lines.push(`${I}${I}{ "id": "B", ... },`);
  lines.push(`${I}${I}{ "id": "C", ... }`);
  lines.push(`${I}],`);

  lines.push('}');
  return lines.join('\n');
}

/**
 * 生成状态提取专用的 JSON 模板文本（用于非 Schema provider）
 * @param {{ panel_status: Array, panel_npc: Array }} fields
 * @param {string[]} locationEnumValues - 当前世界 location.country 的枚举值
 * @returns {string} JSON 模板字符串
 */
function buildStep3StateTextGuide(fields, locationEnumValues = []) {
  const statusFields = (fields.panel_status || getDefaultStatusFields()).filter(
    group => group && group.key !== 'datetime' && group.key !== 'money'
  );
  const npcFields = fields.panel_npc || getDefaultNpcFields();
  const I = '  ';

  const lines = ['{'];

  // ---- panel_npc（嵌套结构 v2）----
  _appendPanelNpcTextLines(lines, npcFields, I, /* trailingComma */ true);

  lines.push(`${I}"panel_status": {`);
  const statusEntries = [];
  for (const group of statusFields) {
    const entry = [];
    if (group._template === 'move_to') {
      entry.push(`${I}${I}"${group.key}": {`);
      const gf = group.fields || [];
      for (let i = 0; i < gf.length; i++) {
        const f = gf[i];
        const comma = i < gf.length - 1 ? ',' : '';
        entry.push(
          `${I}${I}${I}"${f.key}": "${f.type || 'integer'} // ${f.desc || f.label}"${comma}`
        );
      }
      entry.push(`${I}${I}} | null`);
    } else if (group.type === 'array') {
      entry.push(`${I}${I}"${group.key}": [`);
      entry.push(`${I}${I}${I}{`);
      const gf = group.fields || [];
      for (let i = 0; i < gf.length; i++) {
        const f = gf[i];
        const comma = i < gf.length - 1 ? ',' : '';
        entry.push(`${I}${I}${I}${I}"${f.key}": "${f.type || 'string'} // ${f.label}"${comma}`);
      }
      entry.push(`${I}${I}${I}}`);
      entry.push(`${I}${I}]`);
    } else {
      entry.push(`${I}${I}"${group.key}": {`);
      const gf = group.fields || [];
      for (let i = 0; i < gf.length; i++) {
        const f = gf[i];
        const comma = i < gf.length - 1 ? ',' : '';
        const enumValues = _resolveFieldEnum(f, locationEnumValues, group?.key);
        const enumTag = enumValues.length > 0 ? ` [枚举: ${enumValues.join('/')}]` : '';
        const locationNote =
          group?.key === 'location' && f.key === 'country' && enumValues.length > 0
            ? ' [仅显示名，禁止 entity ID]'
            : '';
        entry.push(
          `${I}${I}${I}"${f.key}": "${f.type || 'string'} // ${f.label}${enumTag}${locationNote}"${comma}`
        );
      }
      entry.push(`${I}${I}}`);
    }
    statusEntries.push(entry.join('\n'));
  }
  const hasMoveToInFields = statusFields.some(g => g._template === 'move_to');
  if (!hasMoveToInFields) {
    statusEntries.push(`${I}${I}"move_to": null`);
  }
  lines.push(statusEntries.join(',\n'));
  lines.push(`${I}}`);

  lines.push('}');
  return lines.join('\n');
}

// 暴露到全局
window.step3SchemaBuilder = {
  buildStep3SchemaFromFields,
  buildStep3StateSchemaFromFields,
  buildLastGameStateText,
  buildSchemaTextGuide,
  buildStep3StateTextGuide,
  getDefaultStatusFields,
  getDefaultNpcFields,
  getTimeTermsFromGroup,
  formatTimeValueFromGroup,
  getCurrencyLabelFromGroup,
  NPC_DISPLAY_CORE_FIELDS,
  NPC_RUNTIME_REQUIRED_KEYS,
  NPC_RUNTIME_LOCKED_UPDATE_KEYS,
  NPC_RUNTIME_MUTABLE_UPDATE_HINT_KEYS,
  NPC_OWNED_BY_NPC_KEYS,
  NPC_STATE_KEYS,
  NPC_DROP_KEYS,
  NPC_RUNTIME_PRIVATE_KEYS,
  DEFAULT_STATUS_FIELDS,
  DEFAULT_NPC_FIELDS,
};
