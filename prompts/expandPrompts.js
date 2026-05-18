/**
 * expandPrompts.js
 * 游戏中世界扩展工具的 prompt 模板
 *
 * 基于 designmode.js 的 PHASE2_STAGE_PROMPTS[0] 和 [2] 改造，
 * 用于在游玩过程中生成新的世界实体和角色。
 *
 * 关键差异：
 * - 接受现有实体/角色列表作为上下文（避免重复/矛盾）
 * - 接受 AI 的扩展请求 context
 * - 明确指示"只生成新内容"
 */

// ============================================
// 辅助：从运行时 step3_fields 构建术语约束对象
// ============================================

function _buildS3FromRuntimeStep3Fields(step3Fields) {
  if (!step3Fields) return { statusText: '', eraName: '', currencyName: '' };

  const statusLines = ['## 游戏状态栏字段配置（世界术语参考）', ''];
  let eraName = '';
  let currencyName = '';

  for (const group of step3Fields.panel_status || []) {
    const typeTag = group.type === 'array' ? ', 数组' : '';
    statusLines.push(`### ${group.label} (${group.key}${typeTag})`);
    for (const f of group.fields || []) {
      const nullable = f.nullable ? ', 可空' : '';
      statusLines.push(`- ${f.key} → ${f.label} (${f.type || 'string'}${nullable})`);
    }
    if (group._era) {
      statusLines.push(`- _纪年名称：${group._era}`);
      if (!eraName) eraName = group._era;
    }
    if (group._precision) statusLines.push(`- _时间精度：${group._precision}`);
    if (Array.isArray(group._time_segments) && group._time_segments.length > 0) {
      statusLines.push(`- _时段名称：${group._time_segments.join('/')}`);
    }
    if (group._currency) {
      statusLines.push(`- _货币名称：${group._currency}`);
      if (!currencyName) currencyName = group._currency;
    }
    statusLines.push('');
  }

  // NPC 面板字段（用于 update_new_characters 的角色模板）
  const fixedNpcKeys = new Set([
    'trigger_type', 'id', 'name', 'gender', 'origin', 'birthday',
    'relationships', 'status', 'default_cognitive_state', 'msg_reply_tone',
  ]);
  const aiDefinedFields = (step3Fields.panel_npc || []).filter(f => !fixedNpcKeys.has(f.key));

  let charDbExtraEntries = '';
  let charDbExtraFieldsText = '';
  if (aiDefinedFields.length > 0) {
    const escJson = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    charDbExtraEntries = aiDefinedFields
      .map(f => {
        const enumHint =
          Array.isArray(f.enum) && f.enum.length > 0
            ? `（枚举：${f.enum.map(v => `"${escJson(String(v))}"`).join('、')}）`
            : '';
        const desc = f.desc ? `（${escJson(f.desc)}）` : '';
        return `    "${f.key}": "${escJson(f.label)}${desc}${enumHint}"`;
      })
      .join(',\n');

    const docLines = [
      '',
      '## CHARACTER_DATABASE 面板字段',
      '',
      '本世界的角色对象中应包含以下面板追踪字段：',
    ];
    for (const f of aiDefinedFields) {
      const enumTag =
        Array.isArray(f.enum) && f.enum.length > 0 ? ` [枚举: ${f.enum.map(v => `"${v}"`).join(' | ')}]` : '';
      const desc = f.desc ? `：${f.desc}` : '';
      docLines.push(`- ${f.key}${desc} (${f.type || 'string'})${enumTag}`);
    }
    docLines.push('', '请为每个角色填入符合其设定的值。有 enum 约束的字段必须从枚举值中选择。');
    charDbExtraFieldsText = docLines.join('\n');
  }

  return {
    statusText: statusLines.join('\n'),
    eraName,
    currencyName,
    charDbExtraEntries,
    charDbExtraFieldsText,
  };
}

// ============================================
// 辅助：从运行时 snapshot 合成 p1Output
// ============================================

function _synthesizeP1OutputFromSnapshot(snapshot) {
  const p1 = {};

  const ws = snapshot.world_setting;
  if (ws && ws.settings && typeof ws.settings === 'object') {
    const parts = [];
    if (ws._summary) parts.push(ws._summary);
    for (const [key, val] of Object.entries(ws.settings)) {
      if (key.startsWith('_')) continue;
      const text = typeof val === 'string' ? val.slice(0, 300) : '';
      if (text) parts.push(`[${key}] ${text}`);
    }
    p1.context_world = parts.join('\n\n') || '（无世界设定）';
  } else {
    p1.context_world = '（无世界设定数据）';
  }

  const pm = snapshot.prompt_modules;
  if (pm && pm.modules && typeof pm.modules === 'object') {
    const parts = [];
    if (pm._summary) parts.push(pm._summary);
    for (const [id, content] of Object.entries(pm.modules)) {
      if (id.startsWith('_')) continue;
      const text = typeof content === 'string' ? content.slice(0, 200) : '';
      if (text) parts.push(`[${id}] ${text}`);
    }
    p1.context_rules = parts.join('\n\n') || '（无规则数据）';
  } else {
    p1.context_rules = '（无规则数据）';
  }

  const cd = snapshot.character_database;
  if (cd && typeof cd === 'object') {
    const charDescs = Object.entries(cd)
      .filter(([k]) => !k.startsWith('_'))
      .map(([id, c]) => {
        if (!c || typeof c !== 'object') return null;
        return `${c.name || id}: ${c.origin || ''} ${c.personality || ''}`.trim();
      })
      .filter(Boolean)
      .join('; ');
    p1.context_chars = charDescs || '（无角色数据）';
  } else {
    p1.context_chars = '（无角色数据）';
  }

  const narrativeBaseText = snapshot.prompt_modules?.modules?.narrative_base || '';
  p1.style_guide = narrativeBaseText
    ? `（从世界卡 narrative_base 恢复的风格基调）\n${narrativeBaseText}`
    : '（无风格指南）';

  return p1;
}

// ============================================
// 1. update_new_world prompt
// ============================================

/**
 * @param {Object} params
 * @param {string} params.context - AI 描述需要什么（如"玩家穿越大洋，到达西部荒野"）
 * @param {Object} params.p1Output - Phase 1 框架（从 designMeta 或合成）
 * @param {Object} params.existingSettings - 当前已有的 world_setting.settings
 * @param {Object} params.s3 - step3 术语约束对象
 * @returns {string} system prompt
 */
function buildExpandWorldSettingPrompt({ context, p1Output, existingSettings, s3 }) {
  const existingList = existingSettings
    ? Object.entries(existingSettings)
        .filter(([k]) => !k.startsWith('_'))
        .map(([id, text]) => `- ${id}: ${typeof text === 'string' ? text.slice(0, 200) : ''}...`)
        .join('\n')
    : '（无）';

  const existingIds = existingSettings
    ? Object.keys(existingSettings).filter(k => !k.startsWith('_'))
    : [];

  return `你是一个游戏世界观设计师。游戏正在进行中，玩家的行动触及了世界卡尚未定义的区域。请根据现有世界观，**扩展**生成新的世界实体。

## 扩展请求
${context}

## 现有世界框架
${p1Output.context_world}

## 风格基调
${p1Output.style_guide}

## 已有的世界实体（不要重复生成这些）
${existingList}

## 要求
- **只生成新实体**，不要重新生成已有的实体（${existingIds.join(', ')}）
- 新实体必须与现有世界观保持一致（风格、术语、设定逻辑）
- 新实体数量通常 1-3 个，根据扩展请求的实际需要决定
- 每个实体的设定文本**必须**使用以下固定的 5 章 Markdown 格式（与引擎兼容）：

\`\`\`markdown
## 实体设定 -- 实体名称 (英文名/别称)

### 第一章：基础地缘与世界定位 [Geopolitics]
（国家/势力识别、地理位置、核心城市、世界格局中的角色、外交关系...）

### 第二章：历史起源与文化基调 [History_Culture]
（建国/起源、历史进程、文化与信仰、禁忌、冲突根源...）

### 第三章：社会治理与军事体系 [System_Hierarchy]
（统治逻辑、政体结构、社会阶层、军事形式...）

### 第四章：经济生态与环境场景 [Economy_Environment]
（经济模式、核心资源、场景与氛围描写、具体地点...）

### 第五章：核心人物与当前局势 [Narrative_Core]
（关键人物速写、当前政治局势、潜在冲突与剧情钩子...）
\`\`\`

每章内容要丰富有深度，总计至少 500 字。
严格遵循风格基调的要求。

## 输出格式（纯 JSON）
\`\`\`json
{
  "settings": {
    "new_entity_id": "完整的 5 章 Markdown 设定文本"
  },
  "_narrativeCoreCharacters": {
    "new_entity_id": ["人名1", "人名2"]
  },
  "_summary": "简要说明新增了什么实体（1-2句话）"
}
\`\`\`

settings 的每个 key 是实体 ID（snake_case），value 是完整的设定文本字符串。

## 重要
- 直接输出 JSON，不要输出任何非 JSON 内容
- **JSON 转义安全**：当 value 是 Markdown 长文本时，字符串内部双引号必须转义为 \`\\"\`；字符串中的换行必须写成 \`\\n\`，不能在字符串里直接换行
- 只输出合法 JSON，禁止在 JSON 前后追加解释文本、前缀或后缀
- 不要提问，直接生成
- 新实体要与现有世界产生内在联系（贸易、外交、历史渊源等）
- settings 中的实体 ID 必须全局唯一（不可与已有 ID 重名），只能包含小写英文字母和下划线，长度 4-20 字符
- **\`_narrativeCoreCharacters\` 必须填写**：从每个新实体第五章中提取人物角色名

## 游戏 UI 字段参考（术语约束）
${s3?.statusText || '（使用默认配置）'}

请确保世界设定中的术语与上述字段一致：
- 货币描述使用字段中标注的货币名称
- 纪年描述使用字段中标注的时间体系
- 地理层级使用字段中标注的地点称谓`;
}

// ============================================
// 2. update_new_characters prompt
// ============================================

/**
 * @param {Object} params
 * @param {string} params.context - AI 描述需要什么角色
 * @param {Object} params.p1Output - Phase 1 框架
 * @param {Object} params.existingChars - 当前已有的 character_database
 * @param {Object} params.worldSetting - 当前 world_setting
 * @param {Object} params.promptModules - 当前 prompt_modules
 * @param {Object} params.s3 - step3 术语约束对象
 * @returns {string} system prompt
 */
function buildExpandCharactersPrompt({ context, p1Output, existingChars, worldSetting, promptModules, s3 }) {
  const wsummary = worldSetting?._summary || '（未提供）';
  const rsummary = promptModules?._summary || '（未提供）';

  const existingCharList = existingChars
    ? Object.entries(existingChars)
        .filter(([k]) => !k.startsWith('_'))
        .map(([id, c]) => `- ${id}: ${c?.name || '?'} (${c?.gender || '?'}) — ${c?.origin || '未知'}`)
        .join('\n')
    : '（无）';

  const existingCharIds = existingChars
    ? Object.keys(existingChars).filter(k => !k.startsWith('_'))
    : [];

  const entityIds = worldSetting?.settings
    ? Object.keys(worldSetting.settings).filter(k => !k.startsWith('_'))
    : [];
  const entityIdList = entityIds.length > 0 ? entityIds.map(id => `- ${id}`).join('\n') : '（无）';

  const panelFieldEntries = s3?.charDbExtraEntries ? `,\n${s3.charDbExtraEntries}` : '';
  const panelFieldDocs = s3?.charDbExtraFieldsText || '';

  return `你是一个游戏角色设计师。游戏正在进行中，剧情需要引入有深度的新角色。请根据现有世界观和角色体系，**扩展**生成新的角色。

## 扩展请求
${context}

## 现有世界框架
${p1Output.context_world}

## 风格基调
${p1Output.style_guide}

## 世界设定概要
${wsummary}

## 规则系统概要
${rsummary}

## 已有角色（不要重复生成这些）
${existingCharList}

## 要求
- **只生成新角色**，不要重新生成已有角色（${existingCharIds.join(', ')}）
- 新角色必须与现有世界观和角色体系保持一致
- 新角色数量根据扩展请求的实际需要决定（通常 1-5 个）
- 新角色之间以及与已有角色之间要有合理的关联
- 角色的头衔、能力、装备必须符合世界设定和规则系统
- **角色 ID 必须使用以下已定义的实体 ID 作为前缀**：
${entityIdList}
    格式：\`实体id_序号_英文小写名\`（如 \`${entityIds[0] || 'iron'}_101_elena\`）
- 女性序号 1xx，男性序号 2xx
- 序号不要与已有角色的序号冲突

## 输出格式（纯 JSON）

输出包含两个顶层对象：**character_database**（角色数据库）和 **relationship_rules**（角色初始关系规则），加一个 _summary 字段：

\`\`\`json
{
  "character_database": {
    "entity_101_name": {
      "id": "entity_101_name",
      "name": "角色名",
      "gender": "女/男",
      "origin": "来历背景",
      "birthday": "${s3?.eraName || '纪年'}900.03.15 | null",
      "relationships": null,
      "status": null,
      "default_cognitive_state": "角色初始自我认定",
      "msg_reply_tone": "说话语气描述"${panelFieldEntries}
    }
  },
  "relationship_rules": {
    "entity_101_name": {
      "default": { "entity_201_other": "关系描述" }
    },
    "entity_201_other": {
      "default": { "entity_101_name": "关系描述（从对方视角）" }
    }
  },
  "_summary": "简要说明创建了哪些角色（1-2句话）"
}
\`\`\`

### 内部固定字段说明（每个角色必须包含）
- id: 唯一标识符
- name: 角色名
- gender: 性别（女/男）
- origin: 来历背景
- birthday: 已知时写 ${s3?.eraName || '{纪年名}'}年份.月份.日期，未知时写 null
- birthday 代表真实出生日期，必须显著早于角色 origin 中描述的关键事件
- relationships: 关系（初始为 null）
- status: 状态（初始为 null）
- default_cognitive_state: 角色初始自我认定（回答"我是谁"）
- msg_reply_tone: 说话语气
${panelFieldDocs}

## relationship_rules 要求
- 新角色之间以及新角色与已有角色之间的关系都要生成
- 关系必须双向（A→B 和 B→A 都要有）
- 关系描述从各自视角出发
- **注意**：只需输出涉及新角色的关系规则，不要重复输出已有角色之间的既有关系

## 重要
- 直接输出 JSON，不要输出任何非 JSON 内容
- 禁止输出 Markdown 代码围栏、解释文字、前缀或后缀
- 角色 ID 编号规则：女性 1xx，男性 2xx
- 角色 ID 必须全小写
- 面板字段中有 enum 约束的字段，值必须从枚举中选择
- relationship_rules 对称性自检：提交前逐对检查双向关系完整性

## 游戏 UI 时间系统字段
${s3?.statusText || '（使用默认配置）'}

birthday 字段的纪年名必须与上述时间系统中的纪年名称完全一致。`;
}

// ============================================
// 导出到全局
// ============================================

window.expandPrompts = {
  buildExpandWorldSettingPrompt,
  buildExpandCharactersPrompt,
  _buildS3FromRuntimeStep3Fields,
  _synthesizeP1OutputFromSnapshot,
};
