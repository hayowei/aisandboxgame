/**
 * design/constants.js
 * 世界卡通用常量（Stage2/Phase2/P1 长度上限/草稿来源类型）
 *
 * 加载顺序：必须在 stateMachines.js / utils.js / designService.js 之前加载
 * 顶层 const 在 classic <script> 中位于全局 LexicalEnvironment，跨脚本可按名访问
 */

const STAGE2_META_FIELDS = [
  'description',
  'when_to_call',
  'avoid_when',
  'input_focus',
  'expected_output',
];
const STAGE2_MODULE_MIN_LENGTH = 120;
const STAGE2_OPENING_GREETING_MIN_LENGTH = 20;
const STAGE2_MODULE_ID_RE = /^[a-z][a-z0-9_]*$/;
const STAGE2_PLACEHOLDER_RE = /\b(?:TODO|TBD)\b|待补充|示例略|lorem ipsum|占位(?![符物])|待完善/i;
const PHASE2_STAGE_KEYS = [
  'world_setting',
  'prompt_modules',
  'character_database',
  'timeline',       // Stage 4 now also writes character_timelines + relationship_rules
];
const PHASE2_TOTAL_STAGES = 4;
const DESIGN_REQUIRED_KEY_PROVIDERS = new Set([
  'gemini',
  'deepseek',
  'openai',
  'grok',
  'anthropic',
  'siliconflow',
]);
const DESIGN_CHAT_HISTORY_LIMIT = 120;
const P1_PROMPT_TEXT_MAX_LEN = 400;
const P1_THINKING_PREVIEW_MAX_LEN = 400;
const P1_FRAMEWORK_MIN_FIELD_LEN = 80;
const P1_FLOW_ANSWER_TEXT_MAX_LEN = 10000;
const P1_FLOW_OPTION_TEXT_MAX_LEN = 120;
const P1_FLOW_CUSTOM_TEXT_MAX_LEN = 10000;
const P1_FLOW_SKIP_ANSWER_TEXT = '跳过（请按保守默认值继续）';
const DESIGN_DRAFT_SOURCE_NEW_WORLD = 'new_world';
const DESIGN_DRAFT_SOURCE_CARD_EDIT = 'card_edit';
