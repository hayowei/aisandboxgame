// ============================================
// Panel Field Defaults — single source of truth
// ============================================
// 提供 panel_status / panel_npc 字段的默认定义（zh-CN + en 两套）。
// panelSchemaBuilder.js（schema 生成）和 worldCardManager.js（fallback）都从此处取。
//
// Canonical 形态（Wave 3A 决议，2026-05-26）：
//   - datetime 子字段 = year / month / day / time_str（time_str 是 "HH:MM" 字符串）
//   - panel_status 含 datetime / location / money / objective 四组
//   - location 三段式（country / site / spot）
//
// 任何想加新模板（_template 类型）只改本文件。

const _DEFAULT_STATUS_FIELDS_ZH = [
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
      { key: 'time_str', label: '时间', type: 'string' },
    ],
  },
  {
    key: 'location',
    label: '地点',
    icon: '📍',
    _template: 'location',
    _format: '3-segment',
    fields: [
      { key: 'country', label: '国家/区域', type: 'string' },
      { key: 'site', label: '地点', type: 'string' },
      { key: 'spot', label: '具体位置', type: 'string' },
    ],
  },
  {
    key: 'money',
    label: '金钱',
    icon: '💰',
    _template: 'money',
    fields: [{ key: 'amount', label: '银币', type: 'integer' }],
  },
  {
    key: 'objective',
    label: '目标',
    icon: '🎯',
    _template: 'objective',
    fields: [{ key: 'text', label: '当前目标', type: 'string', nullable: true }],
  },
];

const _DEFAULT_STATUS_FIELDS_EN = [
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
      { key: 'time_str', label: 'Time', type: 'string' },
    ],
  },
  {
    key: 'location',
    label: 'Location',
    icon: '📍',
    _template: 'location',
    _format: '3-segment',
    fields: [
      { key: 'country', label: 'Region', type: 'string' },
      { key: 'site', label: 'Place', type: 'string' },
      { key: 'spot', label: 'Spot', type: 'string' },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    icon: '💰',
    _template: 'money',
    fields: [{ key: 'amount', label: 'Silver', type: 'integer' }],
  },
  {
    key: 'objective',
    label: 'Objective',
    icon: '🎯',
    _template: 'objective',
    fields: [{ key: 'text', label: 'Current Objective', type: 'string', nullable: true }],
  },
];

// 引擎统一硬字段（panel_npc.system_fields）
// V2 字段：dialogue_tone + dialogue_examples（代替 V1 的 msg_reply_tone）
// + cognitive_state + initial_status（代替 V1 的 default_cognitive_state / status）
// Wave 2B: trigger_type 不在此处——它是 GM 工具调用协议字段（NEW / UPDATE / NEW_PREDEFINED 指令），
// 不是角色属性。归 js/tools/npcTools.js 工具协议层。panel_npc 旧表里有 trigger_type 的，
// migration / inspection 会自动过滤掉。
const _NPC_DISPLAY_CORE_FIELDS_ZH = [
  {
    key: 'id',
    label: '标识符',
    desc: '唯一标识，同一角色在不同事件中保持一致',
    type: 'string',
    fixed: true,
    runtimeRequired: true,
  },
  {
    key: 'name',
    label: '角色名',
    desc: '角色的显示名称',
    type: 'string',
    fixed: true,
    runtimeRequired: true,
  },
  {
    key: 'is_protagonist',
    label: '是主角',
    desc: '布尔标志；true = 此 NPC 是玩家主角。整张卡至多 1 个。系统字段，不在卡面展示。',
    type: 'boolean',
    fixed: true,
    runtimeRequired: false,
  },
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
    label: '此刻自我认知',
    desc: '角色在 frozen_moment 这一刻认为自己是谁（与 frozen_moment.label 自洽）',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'initial_status',
    label: '此刻状态',
    desc: '此刻具体可见状态：身体/情绪/在场位置/正在做什么（与 frozen_moment.label 自洽）',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'dialogue_tone',
    label: '对话基调',
    desc: '稳定说话风格 + 性格底色；含面对面 / 短信场合表达习惯差异',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'dialogue_examples',
    label: '说话示例',
    desc: 'few-shot 示例对话；in_person ≥6 / sms ≥4；in_person 含 *动作*+对白，sms 禁 *动作*',
    type: 'object',
    fixed: true,
    runtimeRequired: false,
  },
];

const _NPC_DISPLAY_CORE_FIELDS_EN = [
  // Wave 2B: trigger_type 移出（见 zh 注释）
  {
    key: 'id',
    label: 'Identifier',
    desc: 'Unique ID, consistent across events for the same character',
    type: 'string',
    fixed: true,
    runtimeRequired: true,
  },
  {
    key: 'name',
    label: 'Name',
    desc: 'Display name of the character',
    type: 'string',
    fixed: true,
    runtimeRequired: true,
  },
  {
    key: 'is_protagonist',
    label: 'Is Protagonist',
    desc: 'Boolean flag; true = this NPC is the player protagonist. At most 1 per card. System field, not shown on the card face.',
    type: 'boolean',
    fixed: true,
    runtimeRequired: false,
  },
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
    desc: 'Who they believe they are AT the frozen_moment (consistent with frozen_moment.label)',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'initial_status',
    label: 'Initial Status',
    desc: 'Concrete visible state at frozen_moment: body / emotion / location / current action',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'dialogue_tone',
    label: 'Dialogue Tone',
    desc: 'Stable speaking style + personality undertones; cover in-person vs SMS habits',
    type: 'string',
    fixed: true,
    runtimeRequired: false,
  },
  {
    key: 'dialogue_examples',
    label: 'Dialogue Examples',
    desc: 'Few-shot examples; in_person ≥6 / sms ≥4; in_person requires *action*+dialogue, sms forbids *action*',
    type: 'object',
    fixed: true,
    runtimeRequired: false,
  },
];

// 默认 panel_npc 列表 = 核心硬字段 + 几个常见自定义字段（personality / appearance / clothing）
// 作者通过 Stage 2 注入的 npc_fields 会追加到此基础上
const _DEFAULT_NPC_FIELDS_ZH = [
  ..._NPC_DISPLAY_CORE_FIELDS_ZH,
  { key: 'personality', label: '性格标签', desc: '如：强势/沉稳/温和', type: 'string' },
  { key: 'appearance', label: '外貌特征', desc: '如：黑长直/金发碧眼', type: 'string' },
  { key: 'clothing', label: '当前衣着', desc: '当前具体衣着', type: 'string' },
];

const _DEFAULT_NPC_FIELDS_EN = [
  ..._NPC_DISPLAY_CORE_FIELDS_EN,
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
];

function _deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function _resolveLocale(locale) {
  if (locale === 'en' || locale === 'zh-CN') return locale;
  return typeof window !== 'undefined' && window.i18nService?.getResolvedLanguage?.() === 'en'
    ? 'en'
    : 'zh-CN';
}

function getDefaultStatusFields(locale = null) {
  return _deepClone(
    _resolveLocale(locale) === 'en' ? _DEFAULT_STATUS_FIELDS_EN : _DEFAULT_STATUS_FIELDS_ZH
  );
}

function getDefaultNpcFields(locale = null) {
  return _deepClone(
    _resolveLocale(locale) === 'en' ? _DEFAULT_NPC_FIELDS_EN : _DEFAULT_NPC_FIELDS_ZH
  );
}

function getNpcDisplayCoreFields(locale = null) {
  return _deepClone(
    _resolveLocale(locale) === 'en'
      ? _NPC_DISPLAY_CORE_FIELDS_EN
      : _NPC_DISPLAY_CORE_FIELDS_ZH
  );
}

if (typeof window !== 'undefined') {
  window.panelFieldDefaults = {
    getDefaultStatusFields,
    getDefaultNpcFields,
    getNpcDisplayCoreFields,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getDefaultStatusFields, getDefaultNpcFields, getNpcDisplayCoreFields };
}
