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
// 辅助：从运行时 panel_fields 构建术语约束对象
// ============================================

function _buildS3FromRuntimePanelFields(panelFields) {
  if (!panelFields) return { statusText: '', eraName: '', currencyName: '' };

  const statusLines = ['## 游戏状态栏字段配置（世界术语参考）', ''];
  let eraName = '';
  let currencyName = '';

  for (const group of panelFields.panel_status || []) {
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
    'relationships', 'cognitive_state', 'initial_status',
    'dialogue_tone', 'dialogue_examples',
  ]);
  const aiDefinedFields = (panelFields.panel_npc || []).filter(f => !fixedNpcKeys.has(f.key));

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
  // existing 预览：V2 对象渲染 display_name + 顶层 atmosphere；V1 字符串切前 200 字
  const existingList = existingSettings
    ? Object.entries(existingSettings)
        .filter(([k]) => !k.startsWith('_'))
        .map(([id, val]) => {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            const dn = val.display_name || id;
            const atmo = typeof val.atmosphere === 'string' ? val.atmosphere.slice(0, 120) : '';
            return `- ${id}（${dn}）: ${atmo}`;
          }
          return `- ${id}: ${typeof val === 'string' ? val.slice(0, 200) : ''}...`;
        })
        .join('\n')
    : '（无）';

  const existingIds = existingSettings
    ? Object.keys(existingSettings).filter(k => !k.startsWith('_'))
    : [];

  return `你是一个游戏世界观设计师。游戏正在进行中，玩家的行动触及了世界卡尚未定义的区域。请根据现有世界观，**扩展**生成新的世界实体（V2 结构化对象）。

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
- **每个 entity 必须是地点类**（国家 / 大区 / 城邦 / 重要地理实体）。势力/家族/门派/帮派不能作为独立 entity，应内嵌到地点 entity 的 \`chapters.social_fabric\`

## 输出格式（V2 结构化 JSON 对象）

\`\`\`json
{
  "settings": {
    "<new_entity_id>": {
      "display_name": "<中文显示名 = 三段式 country 段>",
      "atmosphere": "<30-80 字此地基础感官底色>",
      "chapters": {
        "here_now": ["事实点1", "事实点2"],
        "social_fabric": ["事实点"],
        "order": ["事实点"],
        "world_law": ["事实点"],
        "rhythm": ["事实点"],
        "narrative_core": ["张力/钩子事实点（不放人物名）"]
      },
      "sites": [
        { "site": "中区地点名", "spot": "具体位置名", "atmosphere": "可选" }
      ],
      "narrative_core_characters": ["真实人名"]
    }
  },
  "_summary": "简要说明新增了什么实体（1-2 句话）"
}
\`\`\`

## 字段约束（与 Stage 1 一致）

- chapters 六个 key 必填；每个数组至少一条事实点；存在性未定时整数组 = \`["{?Unknown?}"]\`
- sites 至少 3 个；site / spot 真实可识别地名（不能 \`{?Unknown?}\`）；三段式对齐 = display_name / site / spot
- narrative_core_characters 只放真实人名（禁地名/组织名/概念）
- atmosphere 不写人名 / 历史 / 大事件

## 填充法（取代"必须写满"）

- **实**：能写出该实体特有、题材常识猜不到的具体事实 → 写
- **半实**：存在性被题材蕴含但细节未定 → 写一条存在性事实点 + \`{?Unknown?}\` 标
- **\`{?Unknown?}\`**：连存在性都未定 → 整数组 \`["{?Unknown?}"]\`，正确且免费、不要硬填

## 重要

- 直接输出 JSON，不要输出任何非 JSON 内容（不要 \`\`\` 代码块围栏）
- JSON 字符串内部双引号 \\"、换行 \\n
- 不要提问、不要追加解释文字
- entity_id（key）必须全局唯一 snake_case，长度 4-20 字符
- 新实体要与现有世界产生内在联系（贸易、外交、历史渊源等）

## 游戏 UI 字段参考（术语约束）
${s3?.statusText || '（使用默认配置）'}

请确保术语与上述字段一致：
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

输出 **character_database**（角色数据库）顶层对象，加一个 _summary 字段。关系字段 \`relationships\` 直接写在每个角色对象内（与设计期 Stage 3 schema 一致，不再有顶层 \`relationship_rules\`）：

\`\`\`json
{
  "character_database": {
    "entity_101_name": {
      "id": "entity_101_name",
      "name": "角色名",
      "gender": "女/男",
      "origin": "来历背景（不写未来命运预言）",
      "birthday": "${s3?.eraName || '纪年'}900.03.15 | null",
      "relationships": {
        "entity_201_other": "对方姓名 + 关系描述（自然带姓名，可在文本里夹叙时间维度）"
      },
      "cognitive_state": "角色当前自我认定",
      "initial_status": "（可选，运行时新增角色可空）当前可见状态：身体/情绪/在场/动作",
      "dialogue_tone": "稳定说话风格 + 性格底色（面对面 / 短信场合差异简述）",
      "dialogue_examples": { "in_person": [], "sms": [] }${panelFieldEntries}
    },
    "entity_201_other": {
      "id": "entity_201_other",
      "name": "对方角色名",
      "...其余字段同上...": "...",
      "relationships": {
        "entity_101_name": "对方姓名 + 关系描述（从对方视角；与上方对偶）"
      }
    }
  },
  "_summary": "简要说明创建了哪些角色（1-2句话）"
}
\`\`\`

### 内部固定字段说明（每个角色必须包含）
- id: 唯一标识符
- name: 角色名
- gender: 性别（女/男）
- origin: 来历背景；**禁未来命运预言**（"将来他会…"/"命中注定…"），未来路径由玩家创造
- birthday: 已知时写 ${s3?.eraName || '{纪年名}'}年份.月份.日期，未知时写 null
- **relationships**: 角色与其他角色的关系字典——key 是**目标角色 ID**（必须是 character_database 中已存在或本次新建的 ID），value 是一段文本（自然带对方姓名 + 时间维度自然语言夹叙）。例：\`{ "entity_201_li_si": "李四，新结识的同行" }\`。无任何关系的孤立新角色可输出 \`{}\`。
- cognitive_state: 角色当前自我认定（回答"我是谁"）
- initial_status: 角色当前可见状态（身体/情绪/在场/动作）。**运行时新生成角色允许为空字符串**（设计期 Stage 3 必填，扩展场景下保证生成不卡顿）。
- dialogue_tone: 稳定说话风格 + 性格底色暗示；含面对面 / 短信表达习惯差异。
- dialogue_examples: \`{ in_person: [], sms: [] }\` 双桶 few-shot 示例。**运行时新生成角色允许两桶为空数组**（设计期审核会要求补足；运行时优先保证生成不卡顿）。如果有把握编写也欢迎，规则：in_person 每条 line 必须含 \`*动作*\` + 对白；sms 每条 line 禁止 \`*动作*\`、用 \`\\n\` 分条体现 SMS 节奏。
${panelFieldDocs}

## relationships 字段要求
- **[!CRITICAL] 双向写**：若 A.relationships 中有对 B 的描述，则 B.relationships 中也必须有对 A 的描述。两边可镜像或侧重不同视角
- key 使用**目标角色 ID**（必须存在于 character_database：本次新建或已有）
- value 文本中**自然带对方姓名**便于阅读
- 时间维度自然语言夹叙——不拆 current/past 子字段
- **只需输出涉及新角色的关系**——已有角色之间的既有关系不重复写
- 已有角色的 relationships 字段**不要在输出里重写**（只在新角色的 relationships 中加对已有角色的引用即可；引擎会按角色 ID 合并新增关系）

## 重要
- 禁止输出 \`status\`、\`default_cognitive_state\`、\`msg_reply_tone\` 字段（V1 旧字段已弃用）；状态用 \`initial_status\`、认知用 \`cognitive_state\`、说话风格用 \`dialogue_tone\` + \`dialogue_examples\`
- 禁止输出顶层 \`relationship_rules\` 字段（V1 旧字段已弃用；关系写进 \`character_database.{id}.relationships\`）
- 直接输出 JSON，不要输出任何非 JSON 内容
- 禁止输出 Markdown 代码围栏、解释文字、前缀或后缀
- 角色 ID 编号规则：女性 1xx，男性 2xx
- 角色 ID 必须全小写
- 面板字段中有 enum 约束的字段，值必须从枚举中选择
- **relationships 双向一致性自检**：提交前逐对检查双向关系完整性（A→B 写了，B→A 必须也写）

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
  _buildS3FromRuntimePanelFields,
  _synthesizeP1OutputFromSnapshot,
};
