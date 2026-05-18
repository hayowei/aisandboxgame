/**
 * design/reviewAdapters.js
 * Phase 2 卡牌审阅 — Stage 适配器注册表
 *
 * 通用 review 框架（在 ui.js / p2.js）通过 window.getReviewAdapter(stage)
 * 拿到对应 stage 的特化逻辑（数据访问、卡身体渲染、prompt 构建、hooks）。
 *
 * 加载顺序：在 designService.js 之后加载即可（adapter 不依赖 service 实例方法）。
 */

const REVIEW_ADAPTERS = Object.create(null);

function registerReviewAdapter(stage, adapter) {
  REVIEW_ADAPTERS[stage] = adapter;
}
function getReviewAdapter(stage) {
  return REVIEW_ADAPTERS[stage] || null;
}
function hasReviewAdapter(stage) {
  return REVIEW_ADAPTERS[stage] != null;
}
function getAllReviewStages() {
  return Object.keys(REVIEW_ADAPTERS).map(Number).sort((a, b) => a - b);
}

window.getReviewAdapter = getReviewAdapter;
window.hasReviewAdapter = hasReviewAdapter;
window.getAllReviewStages = getAllReviewStages;
window.registerReviewAdapter = registerReviewAdapter;

// ============================================================
// Stage 3 — character_database adapter
// ============================================================

const CHARACTER_FIELD_LABELS = {
  id: 'ID',
  name: '名字',
  gender: '性别',
  personality: '性格',
  origin: '来历',
  birthday: '生日',
  appearance: '外貌',
  clothing: '衣着',
  cognitive_state: '认知',
  default_cognitive_state: '初始认知',
  msg_reply_tone: '语气',
  role: '角色定位',
  faction: '所属势力',
  current_goal: '当前目标',
  default_site: '常驻地点',
  common_spots: '常去地点',
  routine: '日常作息',
};
function _charFieldLabel(key) {
  if (CHARACTER_FIELD_LABELS[key]) return CHARACTER_FIELD_LABELS[key];
  // 非标准字段（用户/AI 自定义）：snake_case → Title Case，让单词之间能自然断行
  // combat_skill → Combat Skill；magic_affinity → Magic Affinity；relationship → Relationship
  if (typeof key !== 'string') return String(key);
  return key
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const CHAR_FIELD_ORDER = {
  // header pills 字段
  pills: ['role', 'faction'],
  // body 默认显示字段
  visible: ['personality', 'appearance', 'current_goal', 'routine'],
  // collapsible "更多字段"
  collapsible: [
    'gender',
    'birthday',
    'origin',
    'clothing',
    'default_site',
    'common_spots',
    'default_cognitive_state',
    'msg_reply_tone',
  ],
};

const CHAR_TEXTAREA_FIELDS = new Set([
  'personality',
  'appearance',
  'clothing',
  'origin',
  'routine',
  'current_goal',
  'msg_reply_tone',
  'default_cognitive_state',
]);

function _isLongCharField(key, value) {
  if (CHAR_TEXTAREA_FIELDS.has(key)) return true;
  if (typeof value === 'string' && (value.length > 40 || value.includes('\n'))) return true;
  return false;
}

function _formatCharFieldDisplay(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('、');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_e) {
      return String(value);
    }
  }
  return String(value);
}

function _escapeHtml(text) {
  if (text === null || text === undefined || text === '') return '';
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

// Helper: build a single field row (label + value div with [data-edit-field])
function _buildCharFieldRow(key, value) {
  const row = document.createElement('div');
  row.className = 'character-review-field';
  const label = document.createElement('div');
  label.className = 'character-review-field-label';
  label.textContent = _charFieldLabel(key);
  const valEl = document.createElement('div');
  valEl.className = 'character-review-field-value';
  valEl.dataset.editField = key;
  valEl.textContent = _formatCharFieldDisplay(value);
  if (!valEl.textContent) {
    valEl.classList.add('character-review-field-value--empty');
    valEl.textContent = '（空）';
  }
  row.appendChild(label);
  row.appendChild(valEl);
  return row;
}

// 编辑态字段：构造 input/textarea 替代 view 态的字段值
function _buildCharFieldEditor(key, raw) {
  const isArray = Array.isArray(raw);
  const isObject = !isArray && raw !== null && typeof raw === 'object';
  const stringValue =
    raw == null
      ? ''
      : isArray
        ? raw.join('、')
        : isObject
          ? JSON.stringify(raw)
          : String(raw);
  const useTextarea = _isLongCharField(key, stringValue);
  const editor = document.createElement(useTextarea ? 'textarea' : 'input');
  if (!useTextarea) editor.type = 'text';
  editor.value = stringValue;
  editor.dataset.editField = key;
  editor.dataset.editingOrigKind = isArray ? 'array' : isObject ? 'object' : 'string';
  editor.className = 'character-review-edit-input';
  if (useTextarea) editor.rows = 1; // 由 framework 的 _autoGrowTextarea 计算
  return editor;
}

// 给 string 编辑器（input/textarea）按字段类型还原成原 schema
function _coerceFieldValue(rawString, origKind) {
  if (origKind === 'array') {
    return rawString
      .split(/[、,，]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (origKind === 'object') {
    try {
      return JSON.parse(rawString);
    } catch (_e) {
      return rawString;
    }
  }
  return rawString;
}

const characterAdapter = {
  stage: 3,
  configKey: 'character_database',
  natEditTargetConstraint: 'character_database',

  // ==== 数据访问 ====
  getEntities(designConfig) {
    const cdb = designConfig?.character_database || {};
    return Object.entries(cdb).filter(
      ([k, v]) => !k.startsWith('_') && v && typeof v === 'object'
    );
  },
  getEntity(designConfig, id) {
    return designConfig?.character_database?.[id] || null;
  },
  hasEntity(designConfig, id) {
    return !!designConfig?.character_database?.[id];
  },
  countEntities(designConfig) {
    return this.getEntities(designConfig).length;
  },
  getDisplayName(id, obj) {
    return (obj && obj.name) || id;
  },
  // 直接写：用于 reroll 全替换（merge 走 P3 op）
  setEntity(designService, id, newObj) {
    if (!designService.designConfig.character_database) {
      designService.designConfig.character_database = {};
    }
    designService.designConfig.character_database[id] = newObj;
  },
  // 生成下一个未占用 id
  nextEntityId(designConfig) {
    const cdb = designConfig?.character_database || {};
    let i = 1;
    while (cdb[`new_char_${i}`] !== undefined) i++;
    return `new_char_${i}`;
  },
  // 空白卡：复制一个现有角色的字段集（清空值），保证字段齐全
  newBlankEntity(designConfig, id) {
    const cdb = designConfig?.character_database || {};
    const existing = Object.values(cdb).find(v => v && typeof v === 'object');
    const tmpl = existing
      ? Object.fromEntries(
          Object.keys(existing)
            .filter(k => !k.startsWith('_'))
            .map(k => {
              const v = existing[k];
              if (Array.isArray(v)) return [k, []];
              if (v && typeof v === 'object') return [k, {}];
              return [k, ''];
            })
        )
      : {};
    return { ...tmpl, id, name: '' };
  },
  // 强制 id 不变 + 防御性 shape
  ensureEntityShape(obj, fallbackId) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const out = { ...obj, id: fallbackId };
    if (!out.name || typeof out.name !== 'string') out.name = fallbackId;
    return out;
  },

  // ==== 头部信息 ====
  getHeaderPills(id, obj) {
    // 仅在有值时显示 pill；编辑模式由 framework 单独处理 placeholder
    const pills = [];
    if (obj && obj.role) {
      pills.push({ field: 'role', value: obj.role, accent: 'primary' });
    }
    if (obj && obj.faction) {
      pills.push({ field: 'faction', value: obj.faction, accent: 'faction' });
    }
    return pills;
  },
  // 编辑模式下，head 必须显示哪些 input（即使原值为空）
  getHeaderEditableFields() {
    return [
      { field: 'role', placeholder: '角色定位', accent: 'primary' },
      { field: 'faction', placeholder: '所属势力', accent: 'faction' },
    ];
  },

  // ==== 卡身体（view 态） ====
  buildCardBody(id, obj) {
    const body = document.createElement('div');
    body.className = 'character-review-card-body';
    for (const key of CHAR_FIELD_ORDER.visible) {
      if (obj[key] === undefined || obj[key] === null) continue;
      body.appendChild(_buildCharFieldRow(key, obj[key]));
    }
    return body;
  },
  // 折叠区"更多字段"：返回 [(key, value), ...] 给 framework 包装 <details>
  getCollapsibleFields(id, obj) {
    const collapsibleKeys = CHAR_FIELD_ORDER.collapsible.filter(
      k => obj[k] !== undefined && obj[k] !== null
    );
    const knownKeys = new Set([
      'id',
      'name',
      ...CHAR_FIELD_ORDER.pills,
      ...CHAR_FIELD_ORDER.visible,
      ...CHAR_FIELD_ORDER.collapsible,
    ]);
    const extraKeys = Object.keys(obj).filter(
      k => !k.startsWith('_') && !knownKeys.has(k)
    );
    const all = [...collapsibleKeys, ...extraKeys];
    return all.map(key => ({ key, value: obj[key], rowEl: _buildCharFieldRow(key, obj[key]) }));
  },

  // ==== 编辑态：把 view 态的所有 [data-edit-field] 转成 editor，由 framework 替换 ====
  buildEditableField(key, raw) {
    return _buildCharFieldEditor(key, raw);
  },
  // 头部 name 编辑器（特殊样式）
  buildHeaderNameEditor(currentName) {
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.value = currentName || '';
    editor.placeholder = '角色名';
    editor.dataset.editField = 'name';
    editor.dataset.editingOrigKind = 'string';
    editor.className =
      'character-review-edit-input character-review-edit-input--head-name';
    return editor;
  },
  // 头部 pill 编辑器（短 input）
  buildHeaderPillEditor(field, currentValue, accent) {
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.value = currentValue || '';
    const placeholders = { role: '角色定位', faction: '所属势力' };
    editor.placeholder = placeholders[field] || field;
    editor.dataset.editField = field;
    editor.dataset.editingOrigKind = 'string';
    editor.className =
      'character-review-edit-input character-review-edit-input--head-pill' +
      (accent === 'faction' ? ' character-review-edit-input--faction' : '');
    return editor;
  },
  // 字段值的"原 schema 类型"：用于 collectEditValues 做类型还原
  getFieldOrigKind(key, currentValue) {
    if (Array.isArray(currentValue)) return 'array';
    if (currentValue && typeof currentValue === 'object') return 'object';
    return 'string';
  },
  coerceFieldValue: _coerceFieldValue,

  // ==== 提交编辑：合并多字段 → 单个 P3 update op（character_database 的 entity-level update 在 P3 op 执行器里有 merge 特殊处理） ====
  commitEdit(designService, id, oldObj, collected) {
    const valueObj = {};
    let changed = false;
    for (const [key, newValue] of Object.entries(collected)) {
      const before = oldObj[key];
      // 用 framework 的 _charFieldEqual 做深比较
      if (!designService._charFieldEqual(before, newValue)) {
        valueObj[key] = newValue;
        changed = true;
      }
    }
    if (!changed) return { changed: false };
    try {
      designService._applyP3Operations([
        { target: 'character_database', action: 'update', path: id, value: valueObj },
      ]);
    } catch (err) {
      console.warn('[characterAdapter] commitEdit via P3 op failed, fallback direct:', err);
      Object.assign(designService.designConfig.character_database[id], valueObj);
    }
    const oldName = oldObj.name || '';
    const newName = designService.designConfig.character_database[id]?.name || '';
    return {
      changed: true,
      oldName,
      newName,
      nameChanged: oldName !== newName,
    };
  },

  // ==== 拖拽到输入框 ====
  getDragText(id, obj) {
    const dispName = (obj && obj.name) || id;
    return `[角色 > ${id} (${dispName})] 请修改这个角色，具体要求：\n`;
  },

  // ==== AI reroll prompt ====
  buildSingleEntityContext(designService, excludeId) {
    const lines = [];
    if (designService.p1Output && typeof designService.p1Output === 'object') {
      lines.push('## 世界框架（P1 输出）');
      for (const [k, v] of Object.entries(designService.p1Output)) {
        if (typeof v === 'string' && v.trim()) {
          lines.push(`### ${k}\n${v.slice(0, 800)}`);
        }
      }
    }
    const cdb = designService.designConfig?.character_database || {};
    const others = Object.entries(cdb).filter(
      ([k, v]) =>
        !k.startsWith('_') && k !== excludeId && v && typeof v === 'object'
    );
    if (others.length > 0) {
      lines.push('\n## 已有的其他角色（仅供参考，避免重复）');
      for (const [oid, c] of others) {
        const summary = [c.name, c.role, c.faction, c.personality]
          .filter(Boolean)
          .join(' / ');
        lines.push(`- ${oid}: ${summary}`);
      }
    }
    return lines.join('\n');
  },
  // ==== 解析 AI 响应（reroll / addByAI 共用）：character_database 需要 JSON 对象 ====
  async parseAIResponse(designService, response, fallbackId) {
    const extract = designService._extractJSON(response, { includeMeta: true, silent: true });
    let parsed = extract.parsed;
    if (!parsed) {
      const repaired = await designService._repairJSON(response, '角色 reroll/add', {});
      parsed = repaired?.parsed;
    }
    return this.ensureEntityShape(parsed, fallbackId);
  },

  buildRerollPrompts(designService, id, oldObj, hint) {
    const ctx = this.buildSingleEntityContext(designService, id);
    const oldJson = JSON.stringify(oldObj, null, 2);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的角色生成助手。\n' +
      '任务：根据世界设定和用户调整方向，重新生成一个角色对象（JSON）。\n' +
      '约束：\n' +
      '- 只输出**单个 JSON 对象**，不要外层包装、不要 markdown 代码块标记。\n' +
      '- 保留原角色的 id 不变（id 必须是 "' +
      id +
      '"）。\n' +
      '- 字段集尽量保持与原对象一致（字段名、字段类型）。\n' +
      '- 风格符合世界框架。\n\n' +
      ctx;
    const userMessage =
      '## 原角色对象\n```json\n' +
      oldJson +
      '\n```\n\n## 用户调整方向\n' +
      (hint || '（无特别要求，请基于世界框架自由发挥，但保持核心定位）') +
      '\n\n请直接输出新的 JSON 对象。';
    return { systemPrompt, userMessage };
  },
  buildAddPrompts(designService, newId, hint) {
    const ctx = this.buildSingleEntityContext(designService, null);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的角色生成助手。\n' +
      '任务：基于世界设定，新增一个角色对象（JSON）。\n' +
      '约束：\n' +
      '- 只输出**单个 JSON 对象**，不要外层包装、不要 markdown 代码块标记。\n' +
      '- id 字段必须是 "' +
      newId +
      '"。\n' +
      '- 字段集与世界中现有角色保持一致（同样的字段名）。\n' +
      '- 与现有角色形成互补、避免重复。\n\n' +
      ctx;
    const userMessage = `## 用户希望新增的角色\n${hint}\n\n请直接输出 JSON。`;
    return { systemPrompt, userMessage };
  },

  // ==== 文案 ====
  panelIcon: 'groups',
  panelTitle: '角色审阅',
  panelSubtitle: 'Stage 3 / 4',
  buildCountText(n) {
    return `${n} 张卡`;
  },
  addButtonLabel: '新增角色',
  addPromptTitle: '新增角色',
  addPromptMessage:
    '输入提示词让 AI 生成（如"年迈的港口巫医"），或留空只创建空白卡。',
  rerollPromptTitle(id, obj) {
    const name = (obj && obj.name) || id;
    return `重抽角色「${name}」`;
  },
  rerollPromptMessage:
    '（可选）输入调整方向，例如"再寒冷一点"、"换成女性"、"年龄改大"。留空让 AI 自由发挥。',
  deleteConfirmTitle: '删除角色',
  deleteConfirmMessage(id, obj) {
    const name = (obj && obj.name) || id;
    return `确认删除角色「${name}」（<code>${_escapeHtml(id)}</code>）？此操作不可撤销。`;
  },
  rerollFailMessage(err) {
    return `重抽失败：${err?.message || err}`;
  },
  addFailMessage(err) {
    return `新增失败：${err?.message || err}`;
  },
  parseFailMessage: 'AI 输出无法解析为对象，请重试',
  busyMessage: '请等待当前任务完成',
  editTooltip: '编辑这张卡',
  rerollTooltip: 'AI 重抽这张卡',
  deleteTooltip: '删除这张卡',
  dragHandleTooltip: '拖拽到下方输入框做定向编辑',

  buildPausedChatMessage(designConfig) {
    return (
      `**🃏 角色生成完成，请审阅**\n\n第 3 阶段（角色与关系）已完成，请检查后继续。你可以：\n` +
      `- 新建/删除某个角色；\n` +
      `- 编辑某个角色的具体字段；\n` +
      `- 拖动卡片到下方输入框做定向修改；\n\n` +
      `检查完成后，点 panel 顶部的「**确认 → Stage 4**」按钮继续生成时间线。`
    );
  },
  buildRestoreHintMessage() {
    return (
      '**🃏 角色审阅未完成**\n\n' +
      '上次会话停在 Stage 3 角色审阅环节。下方 panel 里每张卡都可以点 ✏️ 编辑、点 ⟳ 重抽、点 ✕ 删除；' +
      '也可以拖卡到输入框做定向修改，或在输入框直接描述改动。\n\n' +
      '检查完成后点「**确认 → Stage 4**」继续生成时间线。'
    );
  },

  // ==== Hooks ====
  // 自然语言改写或操作完成后被框架调用：roster 变化时清 relationship_rules
  onAfterRosterChange(designService, action, _id) {
    const rr = designService.designConfig?.relationship_rules;
    if (!rr || typeof rr !== 'object' || Object.keys(rr).length === 0) return;
    delete designService.designConfig.relationship_rules;
    console.info(
      `[DesignMode] relationship_rules cleared due to roster change (action=${action})`
    );
  },
  // name 变化检测：扫 prompt_modules 找旧名引用，弹 confirm 让用户决定替换
  async onAfterNameChange(designService, oldName, newName, id) {
    if (!oldName || !newName || oldName === newName) return;
    if (typeof designService._findCharacterNameReferences !== 'function') return;
    const hits = designService._findCharacterNameReferences(oldName);
    if (hits.length === 0) return;
    if (typeof window.showDesignConfirm !== 'function') return;
    const moduleSummary =
      hits.length <= 5 ? hits.join('、') : `${hits.slice(0, 5).join('、')} 等 ${hits.length} 个`;
    const ok = await window.showDesignConfirm(
      '同步更新 prompt 模块？',
      `角色「<b>${id}</b>」的名字从「<b>${oldName}</b>」改成了「<b>${newName}</b>」。<br><br>` +
        `检测到 <b>${hits.length}</b> 个 prompt 模块（${moduleSummary}）里仍然提到旧名字「${oldName}」。<br><br>` +
        `是否把这些模块里的「${oldName}」整体替换为「${newName}」？<br><br>` +
        `<small>取消 = 不替换，保留旧名字。可稍后在 P3 阶段手动处理。</small>`
    );
    if (!ok) return;
    const pm = designService.designConfig.prompt_modules.modules;
    for (const moduleId of hits) {
      if (typeof pm[moduleId] === 'string') {
        pm[moduleId] = pm[moduleId].split(oldName).join(newName);
      }
    }
    designService._saveDesignConfig();
    designService._updatePreviewPanel();
  },
};

registerReviewAdapter(3, characterAdapter);

// ============================================================
// Stage 1 — world_setting adapter
// 数据：designConfig.world_setting.settings = { entity_id: markdown_string }
// 卡形态：每个 entity 一段长 markdown 文本（不是多字段对象）
// ============================================================

const WS_CONTENT_FIELD = '__content__'; // 伪 key：整段 markdown

const worldSettingAdapter = {
  stage: 1,
  configKey: 'world_setting',
  natEditTargetConstraint: 'world_setting',
  suppressIdPill: true, // displayName 已经是 entity_id，不再额外重复 #pill

  // ==== 数据访问 ====
  getEntities(designConfig) {
    const settings = designConfig?.world_setting?.settings || {};
    return Object.entries(settings).filter(
      ([k, v]) => !k.startsWith('_') && typeof v === 'string'
    );
  },
  getEntity(designConfig, id) {
    const v = designConfig?.world_setting?.settings?.[id];
    return typeof v === 'string' ? v : null;
  },
  hasEntity(designConfig, id) {
    return typeof designConfig?.world_setting?.settings?.[id] === 'string';
  },
  countEntities(designConfig) {
    return this.getEntities(designConfig).length;
  },
  getDisplayName(id, _obj) {
    return id; // 用户选了「显示 entity_id 即可」
  },
  setEntity(designService, id, newText) {
    if (!designService.designConfig.world_setting) {
      designService.designConfig.world_setting = { settings: {} };
    }
    if (!designService.designConfig.world_setting.settings) {
      designService.designConfig.world_setting.settings = {};
    }
    designService.designConfig.world_setting.settings[id] =
      typeof newText === 'string' ? newText : '';
  },
  nextEntityId(designConfig) {
    const settings = designConfig?.world_setting?.settings || {};
    let i = 1;
    while (settings[`new_setting_${i}`] !== undefined) i++;
    return `new_setting_${i}`;
  },
  newBlankEntity(_designConfig, _id) {
    return ''; // 空白 entity 就是空 markdown 字符串
  },
  ensureEntityShape(parsed, _fallbackId) {
    if (typeof parsed === 'string' && parsed.trim().length > 0) return parsed;
    if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
      return parsed.text;
    }
    return null;
  },

  // ==== Head 信息 ====
  getHeaderPills(_id, _obj) {
    return []; // Stage 1 没有 role/faction 之类的副字段
  },
  getHeaderEditableFields() {
    return []; // 编辑模式下 head 也不出现 input
  },
  // 不提供 buildHeaderNameEditor → entity_id 是 immutable

  // ==== 卡身体（view 态：折叠预览 + 完整 markdown） ====
  buildCardBody(_id, markdownText) {
    const text = typeof markdownText === 'string' ? markdownText : '';
    const previewLines = text
      .split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .slice(0, 3);
    const previewText =
      previewLines.length > 0
        ? previewLines.join(' ').slice(0, 120) + (previewLines.join(' ').length > 120 ? '…' : '')
        : '（空）';

    const body = document.createElement('div');
    body.className = 'character-review-card-body world-setting-card-body';

    const details = document.createElement('details');
    details.className = 'world-setting-md-details';
    const summary = document.createElement('summary');
    summary.className = 'world-setting-md-summary';
    summary.textContent = previewText;
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'character-review-field-value world-setting-md-content';
    content.dataset.editField = WS_CONTENT_FIELD;
    // 用项目自带的 markdown 渲染（formatMessageContent 是 chatCore 全局函数，回退到原文）
    if (typeof window.formatMessageContent === 'function' && text) {
      content.innerHTML = window.formatMessageContent(text);
    } else {
      content.textContent = text;
    }
    details.appendChild(content);

    body.appendChild(details);
    return body;
  },
  // 不需要"更多字段"折叠区
  getCollapsibleFields(_id, _obj) {
    return [];
  },

  // ==== 编辑态 ====
  // framework 进入编辑模式时通过 [data-edit-field] 替换；返回 raw 用 entity 整段
  getEditableRaw(key, obj) {
    if (key === WS_CONTENT_FIELD) return obj; // obj 在 Stage 1 就是 markdown string
    return obj?.[key];
  },
  buildEditableField(key, raw) {
    if (key !== WS_CONTENT_FIELD) {
      // 不该走到这里
      const input = document.createElement('input');
      input.type = 'text';
      input.value = raw == null ? '' : String(raw);
      input.dataset.editField = key;
      input.dataset.editingOrigKind = 'string';
      input.className = 'character-review-edit-input';
      return input;
    }
    const editor = document.createElement('textarea');
    editor.value = typeof raw === 'string' ? raw : '';
    editor.dataset.editField = WS_CONTENT_FIELD;
    editor.dataset.editingOrigKind = 'string';
    editor.className =
      'character-review-edit-input world-setting-md-editor';
    editor.placeholder = '在此填写完整的 5 章 markdown 设定文本…';
    editor.rows = 1; // 由 _autoGrowTextarea 计算
    return editor;
  },
  coerceFieldValue(rawString, _origKind) {
    return rawString; // Stage 1 整段 markdown 始终是 string
  },

  // ==== 提交编辑（adapter 自己控制 P3 op 路径） ====
  commitEdit(designService, id, oldText, collected) {
    const newText =
      typeof collected[WS_CONTENT_FIELD] === 'string'
        ? collected[WS_CONTENT_FIELD]
        : '';
    const oldStr = typeof oldText === 'string' ? oldText : '';
    if (newText === oldStr) return { changed: false };
    try {
      designService._applyP3Operations([
        {
          target: 'world_setting',
          action: 'update',
          path: `settings.${id}`,
          value: newText,
        },
      ]);
    } catch (err) {
      console.warn('[worldSettingAdapter] commitEdit via P3 op failed, fallback direct:', err);
      this.setEntity(designService, id, newText);
    }
    return { changed: true, nameChanged: false };
  },

  // ==== 拖拽到输入框 ====
  getDragText(id, _obj) {
    return `[世界设定 > ${id}] 请修改这个世界实体，具体要求：\n`;
  },

  // ==== AI prompt ====
  buildSingleEntityContext(designService, excludeId) {
    const lines = [];
    if (designService.p1Output && typeof designService.p1Output === 'object') {
      lines.push('## 世界框架（P1 输出）');
      for (const [k, v] of Object.entries(designService.p1Output)) {
        if (typeof v === 'string' && v.trim()) {
          lines.push(`### ${k}\n${v.slice(0, 800)}`);
        }
      }
    }
    const settings = designService.designConfig?.world_setting?.settings || {};
    const others = Object.entries(settings).filter(
      ([k, v]) => !k.startsWith('_') && k !== excludeId && typeof v === 'string'
    );
    if (others.length > 0) {
      lines.push('\n## 已有的其他世界实体（仅供参考、避免重复）');
      for (const [oid, txt] of others) {
        const firstLine = (txt.split('\n')[0] || '').slice(0, 100);
        lines.push(`- ${oid}: ${firstLine}`);
      }
    }
    return lines.join('\n');
  },
  // ==== 解析 AI 响应：world_setting 需要纯 markdown 文本（不是 JSON） ====
  async parseAIResponse(_designService, response, _fallbackId) {
    if (typeof response !== 'string') return null;
    let text = response.trim();
    // 容错：AI 可能仍然包了一层 JSON `{ "settings": { id: "md..." } }` 或 `{ "text": "md..." }`
    // 先试 JSON parse；失败再当 markdown 处理
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') return parsed.trim();
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.text === 'string') return parsed.text.trim();
        if (typeof parsed.markdown === 'string') return parsed.markdown.trim();
        if (parsed.settings && typeof parsed.settings === 'object') {
          const vals = Object.values(parsed.settings).filter(v => typeof v === 'string');
          if (vals.length > 0) return vals[0].trim();
        }
      }
    } catch (_e) {
      /* 不是 JSON，按纯 markdown 处理 */
    }
    // 剥离 ```markdown / ``` / ```md 围栏（AI 可能违反约束加上）
    text = text.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    if (text.length === 0) return null;
    return text;
  },

  // ==== 章节缺失检测（Stage 1 特有） ====
  // 检查 markdown 是否含全部 5 章。优先匹配"第N章"中文标题（最可靠），
  // fallback 用英文 tag 模糊匹配（容忍下划线/空格/方括号变体）。
  detectMissingChapters(markdownText) {
    if (typeof markdownText !== 'string' || markdownText.trim().length === 0) {
      return [1, 2, 3, 4, 5];
    }
    // 中文章节标题（最可靠）：第一章 / 第1章 / 第 1 章 都认
    const chapterCN = [
      /第\s*[一1]\s*章/,
      /第\s*[二2]\s*章/,
      /第\s*[三3]\s*章/,
      /第\s*[四4]\s*章/,
      /第\s*[五5]\s*章/,
    ];
    // 英文 tag fallback：方括号可有可无，下划线/空格容忍，大小写无关
    const tagEN = [
      /Geo[\s_-]?politics/i,
      /History[\s_-]?Culture/i,
      /System[\s_-]?Hierarchy/i,
      /Economy[\s_-]?Environment/i,
      /Narrative[\s_-]?Core/i,
    ];
    const missing = [];
    for (let i = 0; i < 5; i++) {
      if (!chapterCN[i].test(markdownText) && !tagEN[i].test(markdownText)) {
        missing.push(i + 1);
      }
    }
    return missing;
  },

  // framework 钩子：单卡 warning（缺章时返回提示文案，否则 null）
  getEntityWarning(_id, markdownText) {
    const missing = this.detectMissingChapters(markdownText);
    if (missing.length === 0) return null;
    return {
      severity: 'warning',
      label: `缺第 ${missing.join(',')} 章`,
      tooltip: `这个实体的 markdown 缺少 ${missing.length} 个章节，建议点重抽或使用顶部「批量修复缺章」按钮`,
    };
  },

  // framework 钩子：返回需要批量 reroll 的 entity id 列表（缺章的）
  findEntitiesNeedingReroll(designConfig) {
    const entries = this.getEntities(designConfig);
    const ids = [];
    for (const [id, text] of entries) {
      if (this.detectMissingChapters(text).length > 0) ids.push(id);
    }
    return ids;
  },

  // 5 章结构模板——与 PHASE2_STAGE_PROMPTS[0] 完全一致（避免章节名漂移导致 AI 跳章）
  fiveChapterTemplate:
    '## 实体设定 -- 实体名称 (英文名/别称)\n\n' +
    '### 第一章：基础地缘与世界定位 [Geopolitics]\n' +
    '（国家/势力识别、地理位置、核心城市、世界格局中的角色、外交关系...）\n\n' +
    '### 第二章：历史起源与文化基调 [History_Culture]\n' +
    '（建国/起源、历史进程、文化与信仰、禁忌、冲突根源...）\n\n' +
    '### 第三章：社会治理与军事体系 [System_Hierarchy]\n' +
    '（统治逻辑、政体结构、社会阶层、军事形式...）\n\n' +
    '### 第四章：经济生态与环境场景 [Economy_Environment]\n' +
    '（经济模式、核心资源、场景与氛围描写、具体地点...）\n\n' +
    '### 第五章：核心人物与当前局势 [Narrative_Core]\n' +
    '（关键人物速写、当前政治局势、潜在冲突与剧情钩子...）',

  buildRerollPrompts(designService, id, oldText, hint) {
    const ctx = this.buildSingleEntityContext(designService, id);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的世界设定生成助手。\n' +
      '任务：根据世界框架和用户调整方向，重写一个世界实体（地点/势力/文化等）的设定文本。\n\n' +
      '## 输出格式（必须严格遵守）\n' +
      '只输出 **markdown 文本**，不要 JSON 包装、不要 ``` 代码块围栏。\n\n' +
      '## 章节结构（五章必须全部出现，缺一不可）\n\n' +
      this.fiveChapterTemplate +
      '\n\n' +
      '**[!CRITICAL] 第二、三、四章绝不能省略**——AI 常见的偷懒模式是只输出第一章和第五章，跳过中间三章。本任务必须输出全部五章。每章内容要丰富有深度，**总计至少 500 字**。\n\n' +
      '## 其他约束\n' +
      '- entity_id 隐含为「' +
      id +
      '」（不要在文本里改 id；id 由系统外部维护）。\n' +
      '- 风格严格符合世界框架。\n\n' +
      ctx;
    const userMessage =
      '## 原 markdown\n```markdown\n' +
      (oldText || '') +
      '\n```\n\n## 用户调整方向\n' +
      (hint || '（无特别要求，请基于世界框架自由发挥，但保持核心定位）') +
      '\n\n请直接输出新的 markdown 文本，**五章必须全部出现，缺一不可**。';
    return { systemPrompt, userMessage };
  },
  buildAddPrompts(designService, newId, hint) {
    const ctx = this.buildSingleEntityContext(designService, null);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的世界设定生成助手。\n' +
      '任务：基于已有世界设定，新增一个世界实体（地点/势力/文化等）的设定文本。\n\n' +
      '## 输出格式（必须严格遵守）\n' +
      '只输出 **markdown 文本**，不要 JSON 包装、不要 ``` 代码块围栏。\n\n' +
      '## 章节结构（五章必须全部出现，缺一不可）\n\n' +
      this.fiveChapterTemplate +
      '\n\n' +
      '**[!CRITICAL] 第二、三、四章绝不能省略**——AI 常见的偷懒模式是只输出第一章和第五章，跳过中间三章。本任务必须输出全部五章。每章内容要丰富有深度，**总计至少 500 字**。\n\n' +
      '## 其他约束\n' +
      '- entity_id 隐含为「' +
      newId +
      '」（不要在文本里写 id，id 由系统外部维护）。\n' +
      '- 与已有实体形成互补、避免重复。\n\n' +
      ctx;
    const userMessage = `## 用户希望新增的世界实体\n${hint}\n\n请直接输出 markdown，**五章必须全部出现，缺一不可**。`;
    return { systemPrompt, userMessage };
  },

  // ==== 文案 ====
  panelIcon: 'public',
  panelTitle: '世界设定审阅',
  panelSubtitle: 'Stage 1 / 4',
  buildCountText(n) {
    return `${n} 个实体`;
  },
  addButtonLabel: '新增世界实体',
  addPromptTitle: '新增世界实体',
  addPromptMessage:
    '输入提示词让 AI 生成（如"一个边境港口城镇"），或留空只创建空白卡。',
  rerollPromptTitle(id, _obj) {
    return `重抽世界实体「${id}」`;
  },
  rerollPromptMessage:
    '（可选）输入调整方向，例如"扩展第三章关于经济的描述"或"改成更阴森的氛围"。留空让 AI 自由发挥。',
  deleteConfirmTitle: '删除世界实体',
  deleteConfirmMessage(id, _obj) {
    return `确认删除世界实体「<code>${_escapeHtml(id)}</code>」？此操作不可撤销，且其他 stage（角色 / 时间线）中对该实体的引用可能失效。`;
  },
  rerollFailMessage(err) {
    return `重抽失败：${err?.message || err}`;
  },
  addFailMessage(err) {
    return `新增失败：${err?.message || err}`;
  },
  parseFailMessage: 'AI 输出无法解析为 markdown 文本，请重试',
  busyMessage: '请等待当前任务完成',
  editTooltip: '编辑这段设定',
  rerollTooltip: 'AI 重抽这段设定',
  deleteTooltip: '删除这个世界实体',
  dragHandleTooltip: '拖拽到下方输入框做定向编辑',

  buildPausedChatMessage(_designConfig) {
    return (
      `**🌍 世界设定生成完成，请审阅**\n\n第 1 阶段（世界设定）已完成，请检查后继续。你可以：\n` +
      `- 新建/删除某个世界实体；\n` +
      `- 编辑某段实体的 markdown 设定；\n` +
      `- 拖动卡片到下方输入框做定向修改；\n\n` +
      `检查完成后，点 panel 顶部的「**确认 → Stage 2**」按钮继续生成规则系统。`
    );
  },
  buildRestoreHintMessage() {
    return (
      '**🌍 世界设定审阅未完成**\n\n' +
      '上次会话停在 Stage 1 世界设定审阅环节。下方 panel 里每个实体卡都可以点 ✏️ 编辑、点 ⟳ 重抽、点 ✕ 删除；' +
      '也可以拖卡到输入框做定向修改，或在输入框直接描述改动。\n\n' +
      '检查完成后点「**确认 → Stage 2**」继续生成规则系统。'
    );
  },

  // 不加 onAfterRosterChange / onAfterNameChange：Stage 1 entity 增删/改名对其他 stage 的影响很复杂（init module + timeline 都引用），先不自动处理，下游有问题靠 P3 阶段修。
};

registerReviewAdapter(1, worldSettingAdapter);

// ============================================================
// Stage 2 — prompt_modules adapter
// 数据：
//   designConfig.prompt_modules.modules = { id: contentString }
//   designConfig.prompt_modules.module_meta = { id: { description, when_to_call, ... } }
// 卡形态：每个 module 一张卡，含 5 个 meta 字段（label+value 表）+ 折叠的 content markdown
// ============================================================

const PROMPT_MODULES_NECESSARY = new Set([
  'core_world_mechanics',
  'init',
  'narrative_base',
  'npc_gen',
]);
const PROMPT_MODULES_SYSTEM = new Set(['design_qna']);
const PROMPT_MODULES_META_FIELDS = [
  'description',
  'when_to_call',
  'avoid_when',
  'input_focus',
  'expected_output',
];
const PROMPT_MODULES_META_LABELS = {
  description: '说明',
  when_to_call: '调用时机',
  avoid_when: '避免使用',
  input_focus: '输入关注',
  expected_output: '期望输出',
};
const PROMPT_MODULES_LONG_META = new Set(['description', 'when_to_call', 'avoid_when']);

const promptModulesAdapter = {
  stage: 2,
  configKey: 'prompt_modules',
  natEditTargetConstraint: 'prompt_modules',
  suppressIdPill: true,

  // ==== 数据访问（entity 是合成对象 { id, content, meta }） ====
  _composeEntity(designConfig, id) {
    const pm = designConfig?.prompt_modules || {};
    return {
      id,
      content: pm.modules?.[id] || '',
      meta: pm.module_meta?.[id] || {},
    };
  },
  getEntities(designConfig) {
    const pm = designConfig?.prompt_modules;
    if (!pm || !pm.modules || typeof pm.modules !== 'object') return [];
    return Object.keys(pm.modules)
      .filter(k => !k.startsWith('_') && typeof pm.modules[k] === 'string')
      .map(id => [id, this._composeEntity(designConfig, id)]);
  },
  getEntity(designConfig, id) {
    const v = designConfig?.prompt_modules?.modules?.[id];
    if (typeof v !== 'string') return null;
    return this._composeEntity(designConfig, id);
  },
  hasEntity(designConfig, id) {
    return typeof designConfig?.prompt_modules?.modules?.[id] === 'string';
  },
  countEntities(designConfig) {
    return this.getEntities(designConfig).length;
  },
  getDisplayName(id, _entity) {
    return id;
  },
  setEntity(designService, id, newEntity) {
    if (!designService.designConfig.prompt_modules) {
      designService.designConfig.prompt_modules = { modules: {}, module_meta: {} };
    }
    const pm = designService.designConfig.prompt_modules;
    if (!pm.modules) pm.modules = {};
    if (!pm.module_meta) pm.module_meta = {};
    pm.modules[id] = typeof newEntity?.content === 'string' ? newEntity.content : '';
    pm.module_meta[id] =
      newEntity?.meta && typeof newEntity.meta === 'object' ? newEntity.meta : {};
  },
  nextEntityId(designConfig) {
    const pm = designConfig?.prompt_modules?.modules || {};
    let i = 1;
    while (pm[`new_module_${i}`] !== undefined) i++;
    return `new_module_${i}`;
  },
  newBlankEntity(_designConfig, _id) {
    return {
      content: '',
      meta: Object.fromEntries(PROMPT_MODULES_META_FIELDS.map(f => [f, ''])),
    };
  },
  ensureEntityShape(parsed, fallbackId) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out = { id: fallbackId };
    out.content = typeof parsed.content === 'string' ? parsed.content : '';
    out.meta =
      parsed.meta && typeof parsed.meta === 'object' && !Array.isArray(parsed.meta)
        ? parsed.meta
        : {};
    if (!out.content) return null;
    return out;
  },

  // ==== Head ====
  getHeaderPills(id, _entity) {
    const pills = [];
    if (PROMPT_MODULES_NECESSARY.has(id)) {
      pills.push({ field: '_necessary', value: '核心', accent: 'warning' });
    }
    if (PROMPT_MODULES_SYSTEM.has(id)) {
      pills.push({ field: '_system', value: '系统生成', accent: 'system' });
    }
    return pills;
  },
  getHeaderEditableFields() {
    return []; // head 上只有 badge，不可编辑
  },
  // 不提供 buildHeaderNameEditor → id immutable

  // ==== Body：Stage 3 风格的 meta 字段表 + 折叠 content ====
  buildCardBody(_id, entity) {
    const body = document.createElement('div');
    body.className = 'character-review-card-body';
    const meta = entity.meta || {};
    for (const field of PROMPT_MODULES_META_FIELDS) {
      const value = meta[field];
      const row = document.createElement('div');
      row.className = 'character-review-field';
      const label = document.createElement('div');
      label.className = 'character-review-field-label';
      label.textContent = PROMPT_MODULES_META_LABELS[field];
      const valEl = document.createElement('div');
      valEl.className = 'character-review-field-value';
      valEl.dataset.editField = `meta.${field}`;
      const display = typeof value === 'string' ? value : '';
      valEl.textContent = display || '（空）';
      if (!display) valEl.classList.add('character-review-field-value--empty');
      row.appendChild(label);
      row.appendChild(valEl);
      body.appendChild(row);
    }
    // content 折叠区
    const contentText = entity.content || '';
    const previewLines = contentText
      .split('\n')
      .filter(line => line.trim() && !line.trim().startsWith('#'))
      .slice(0, 2);
    const previewBase = previewLines.join(' ').slice(0, 100);
    const previewText = previewLines.length > 0
      ? `内容预览：${previewBase}${previewLines.join(' ').length > 100 ? '…' : ''}`
      : '内容（空）';

    const details = document.createElement('details');
    details.className = 'world-setting-md-details prompt-modules-content-details';
    const summary = document.createElement('summary');
    summary.className = 'world-setting-md-summary';
    summary.textContent = previewText;
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'character-review-field-value world-setting-md-content';
    content.dataset.editField = '__content__';
    if (typeof window.formatMessageContent === 'function' && contentText) {
      content.innerHTML = window.formatMessageContent(contentText);
    } else {
      content.textContent = contentText || '（空）';
    }
    details.appendChild(content);
    body.appendChild(details);
    return body;
  },
  getCollapsibleFields() {
    return []; // 没有"更多字段"折叠区，meta 都在 body 主体里
  },

  // ==== 编辑模式 ====
  getEditableRaw(key, entity) {
    if (key === '__content__') return entity.content;
    if (key.startsWith('meta.')) return entity.meta?.[key.slice(5)];
    return null;
  },
  buildEditableField(key, raw) {
    if (key === '__content__') {
      const editor = document.createElement('textarea');
      editor.value = typeof raw === 'string' ? raw : '';
      editor.dataset.editField = key;
      editor.dataset.editingOrigKind = 'string';
      editor.className =
        'character-review-edit-input world-setting-md-editor';
      editor.placeholder = '模块内容（markdown / 规则文本，至少 120 字）';
      editor.rows = 1;
      return editor;
    }
    if (key.startsWith('meta.')) {
      const fieldName = key.slice(5);
      const isLong = PROMPT_MODULES_LONG_META.has(fieldName);
      const editor = document.createElement(isLong ? 'textarea' : 'input');
      if (!isLong) editor.type = 'text';
      editor.value = typeof raw === 'string' ? raw : '';
      editor.dataset.editField = key;
      editor.dataset.editingOrigKind = 'string';
      // meta 字段编辑器：用专用 class 给到稍高的 min-height，避免单行 + 短滚动条
      editor.className =
        'character-review-edit-input character-review-edit-input--meta';
      editor.placeholder = PROMPT_MODULES_META_LABELS[fieldName] || fieldName;
      if (isLong) editor.rows = 1;
      return editor;
    }
    // fallback
    const editor = document.createElement('input');
    editor.type = 'text';
    editor.value = String(raw == null ? '' : raw);
    editor.dataset.editField = key;
    editor.dataset.editingOrigKind = 'string';
    editor.className = 'character-review-edit-input';
    return editor;
  },
  coerceFieldValue(rawString, _origKind) {
    return rawString;
  },

  // ==== 提交编辑 ====
  commitEdit(designService, id, oldEntity, collected) {
    let newContent = oldEntity.content || '';
    const newMeta = { ...(oldEntity.meta || {}) };
    let contentChanged = false;
    let metaChanged = false;

    for (const [key, val] of Object.entries(collected)) {
      if (key === '__content__') {
        if (val !== oldEntity.content) {
          newContent = val;
          contentChanged = true;
        }
      } else if (key.startsWith('meta.')) {
        const f = key.slice(5);
        if (val !== oldEntity.meta?.[f]) {
          newMeta[f] = val;
          metaChanged = true;
        }
      }
    }
    if (!contentChanged && !metaChanged) return { changed: false };

    try {
      const ops = [];
      if (contentChanged) {
        ops.push({
          target: 'prompt_modules',
          action: 'update',
          path: `modules.${id}`,
          value: newContent,
        });
      }
      if (metaChanged) {
        ops.push({
          target: 'prompt_modules',
          action: 'update',
          path: `module_meta.${id}`,
          value: newMeta,
        });
      }
      designService._applyP3Operations(ops);
    } catch (err) {
      console.warn('[promptModulesAdapter] commitEdit via P3 op failed, fallback direct:', err);
      this.setEntity(designService, id, { content: newContent, meta: newMeta });
    }
    return { changed: true, nameChanged: false };
  },

  // ==== 拖拽 ====
  getDragText(id, _entity) {
    return `[规则模块 > ${id}] 请修改这个模块，具体要求：\n`;
  },

  // ==== AI prompts ====
  buildSingleEntityContext(designService, excludeId) {
    const lines = [];
    if (designService.p1Output && typeof designService.p1Output === 'object') {
      lines.push('## 世界框架（P1 输出）');
      for (const [k, v] of Object.entries(designService.p1Output)) {
        if (typeof v === 'string' && v.trim()) {
          lines.push(`### ${k}\n${v.slice(0, 600)}`);
        }
      }
    }
    const pm = designService.designConfig?.prompt_modules?.modules || {};
    const others = Object.entries(pm).filter(
      ([k, v]) => !k.startsWith('_') && k !== excludeId && typeof v === 'string'
    );
    if (others.length > 0) {
      lines.push('\n## 已有的其他规则模块（仅供参考、避免重复）');
      for (const [oid, txt] of others) {
        lines.push(`- ${oid}: ${(txt.split('\n')[0] || '').slice(0, 80)}`);
      }
    }
    return lines.join('\n');
  },

  buildRerollPrompts(designService, id, oldEntity, hint) {
    const ctx = this.buildSingleEntityContext(designService, id);
    const isNecessary = PROMPT_MODULES_NECESSARY.has(id);
    const necessaryNote = isNecessary
      ? `\n**[!CRITICAL]** 此模块「${id}」是 4 个必须核心模块之一（被运行时强依赖），结构和功能不能改变，只能优化内容质量、改进表达方式。\n`
      : '';
    const oldJson = JSON.stringify(oldEntity, null, 2);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的规则模块生成助手。\n' +
      `任务：根据世界框架和用户调整方向，重写规则模块「${id}」的 content 和 meta。\n\n` +
      '## 输出格式（必须严格遵守 JSON）\n' +
      '只输出 JSON 对象，不要外层 markdown 围栏，结构必须是：\n\n' +
      '```\n' +
      '{\n' +
      '  "content": "模块的完整 markdown / 规则文本（至少 120 字）",\n' +
      '  "meta": {\n' +
      '    "description": "一句话描述这个模块",\n' +
      '    "when_to_call": "什么时候应用这个模块",\n' +
      '    "avoid_when": "什么时候避免",\n' +
      '    "input_focus": "AI 调用此模块时关注什么输入",\n' +
      '    "expected_output": "期望产出什么"\n' +
      '  }\n' +
      '}\n' +
      '```\n' +
      necessaryNote +
      '\n## 其他约束\n' +
      `- module id 必须保持「${id}」（不要改 id）\n` +
      '- content 至少 120 字，是可执行规则而不是提纲\n' +
      '- 风格符合世界框架\n\n' +
      ctx;
    const userMessage =
      '## 原模块\n```json\n' +
      oldJson +
      '\n```\n\n## 用户调整方向\n' +
      (hint || '（无特别要求，请基于世界框架自由发挥，但保持模块核心功能）') +
      '\n\n请直接输出新的 JSON 对象。';
    return { systemPrompt, userMessage };
  },
  buildAddPrompts(designService, newId, hint) {
    const ctx = this.buildSingleEntityContext(designService, null);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的规则模块生成助手。\n' +
      `任务：基于已有规则系统，新增一个规则模块（id: ${newId}）。\n\n` +
      '## 输出格式（必须严格遵守 JSON）\n' +
      '只输出 JSON 对象，不要外层 markdown 围栏，结构必须是：\n\n' +
      '```\n' +
      '{\n' +
      '  "content": "模块的完整 markdown / 规则文本（至少 120 字，可执行规则）",\n' +
      '  "meta": { "description": "...", "when_to_call": "...", "avoid_when": "...", "input_focus": "...", "expected_output": "..." }\n' +
      '}\n' +
      '```\n\n' +
      `- module id 必须是「${newId}」（不要改 id）\n` +
      '- 与已有模块形成互补，避免重复\n\n' +
      ctx;
    const userMessage = `## 用户希望新增的规则模块\n${hint}\n\n请直接输出 JSON。`;
    return { systemPrompt, userMessage };
  },

  // 解析 AI 响应：JSON
  async parseAIResponse(designService, response, fallbackId) {
    const extract = designService._extractJSON(response, { includeMeta: true, silent: true });
    let parsed = extract.parsed;
    if (!parsed) {
      const repaired = await designService._repairJSON(response, '模块 reroll/add', {});
      parsed = repaired?.parsed;
    }
    return this.ensureEntityShape(parsed, fallbackId);
  },

  // ==== 缺字段 / 内容问题检测（warning chip + batch reroll） ====
  detectModuleIssues(_id, entity) {
    const issues = [];
    const content = entity?.content || '';
    if (!content || content.length < 120) {
      issues.push(`内容太短（${content.length}/120）`);
    }
    if (content && /\b(?:TODO|TBD)\b|待补充|示例略|占位(?![符物])|待完善/i.test(content)) {
      issues.push('含占位符');
    }
    const meta = entity?.meta || {};
    const missingMeta = ['description', 'when_to_call'].filter(
      f => typeof meta[f] !== 'string' || meta[f].trim().length < 5
    );
    if (missingMeta.length > 0) {
      issues.push(`meta 缺：${missingMeta.join(',')}`);
    }
    return issues;
  },
  getEntityWarning(id, entity) {
    const issues = this.detectModuleIssues(id, entity);
    if (issues.length === 0) return null;
    return {
      severity: 'warning',
      label: issues[0], // 第一个最严重
      tooltip: issues.join('；'),
    };
  },
  findEntitiesNeedingReroll(designConfig) {
    return this.getEntities(designConfig)
      .filter(
        ([id, entity]) =>
          // design_qna 是 P1 对话历史快照，没法 / 不该 reroll，从批量列表里排除
          !PROMPT_MODULES_SYSTEM.has(id) &&
          this.detectModuleIssues(id, entity).length > 0
      )
      .map(([id]) => id);
  },

  // framework 钩子：单卡是否允许 reroll
  // design_qna 不允许（系统生成的 P1 Q&A 历史快照，没有"重新生成"语义）
  canReroll(id, _entity) {
    return !PROMPT_MODULES_SYSTEM.has(id);
  },

  // ==== 文案 ====
  panelIcon: 'rule',
  panelTitle: '规则模块审阅',
  panelSubtitle: 'Stage 2 / 4',
  buildCountText(n) {
    return `${n} 个模块`;
  },
  addButtonLabel: '新增规则模块',
  addPromptTitle: '新增规则模块',
  addPromptMessage:
    '输入提示词让 AI 生成（如"魔法体系规则"或"战斗判定流程"），或留空只创建空白模块。',
  rerollPromptTitle(id, _entity) {
    return `重抽模块「${id}」`;
  },
  rerollPromptMessage:
    '（可选）输入调整方向，例如"内容更简洁"或"加上对禁忌的描述"。留空让 AI 自由发挥（保持模块核心功能不变）。',
  deleteConfirmTitle: '删除规则模块',
  deleteConfirmMessage(id, _entity) {
    if (PROMPT_MODULES_NECESSARY.has(id)) {
      return (
        `<b>⚠ 警告：「<code>${_escapeHtml(id)}</code>」是 4 个核心模块之一</b>，被运行时强依赖。<br>` +
        `删除后游戏可能无法启动或叙事质量大幅下降。<br><br>` +
        `如果是误操作，请取消。如果你<b>真的</b>要删除，请确认你已经理解后果。`
      );
    }
    if (PROMPT_MODULES_SYSTEM.has(id)) {
      return (
        `「<code>${_escapeHtml(id)}</code>」是 P1→P2 衔接时系统自动生成的<b>设计上下文模块</b>。<br>` +
        `删除后会丢失"创作者最终确认的 5 维度框架"参考，AI 后续编辑时缺少这层意图记录。<br><br>` +
        `确认删除？`
      );
    }
    return `确认删除模块「<code>${_escapeHtml(id)}</code>」？此操作不可撤销。`;
  },
  rerollFailMessage(err) {
    return `重抽失败：${err?.message || err}`;
  },
  addFailMessage(err) {
    return `新增失败：${err?.message || err}`;
  },
  parseFailMessage: 'AI 输出无法解析为 { content, meta } 对象，请重试',
  busyMessage: '请等待当前任务完成',
  editTooltip: '编辑这个模块',
  rerollTooltip: 'AI 重抽这个模块',
  deleteTooltip: '删除这个模块',
  dragHandleTooltip: '拖拽到下方输入框做定向编辑',

  buildPausedChatMessage(_designConfig) {
    return (
      `**⚙️ 规则模块生成完成，请审阅**\n\n第 2 阶段（规则系统）已完成，请检查后继续。你可以：\n` +
      `- 新建/删除某个模块（核心模块和系统模块带 ⚠ 标记，删除有警告）；\n` +
      `- 编辑模块的元信息（说明、调用时机等）和内容文本；\n` +
      `- 拖动卡片到下方输入框做定向修改；\n\n` +
      `检查完成后，点 panel 顶部的「**确认 → Stage 3**」按钮继续生成角色数据库。`
    );
  },
  buildRestoreHintMessage() {
    return (
      '**⚙️ 规则模块审阅未完成**\n\n' +
      '上次会话停在 Stage 2 规则系统审阅环节。下方 panel 里每个模块卡都可以点 ✏️ 编辑、点 ⟳ 重抽、点 ✕ 删除（核心 / 系统模块带警告）；' +
      '也可以拖卡到输入框做定向修改，或在输入框直接描述改动。\n\n' +
      '检查完成后点「**确认 → Stage 3**」继续生成角色数据库。'
    );
  },

  // 不加 hooks（Stage 2 没有 roster / name change 联动）
};

registerReviewAdapter(2, promptModulesAdapter);

// ============================================================
// Stage 4-events — timeline.events adapter
// 数据：designConfig.timeline.events 是 array<{ id, time, day, time_str, location, characters, content }>
// 区别于其他 stage：entity 存储是数组（不是 ID→object map），需要按 id 查 index 操作
// 注意：本 adapter 仅作用于 timeline.events，不动 character_timelines（用户明确不做）
// ============================================================

const TIMELINE_EVENT_FIELDS = ['time', 'day', 'time_str', 'location', 'characters', 'content'];
const TIMELINE_EVENT_LABELS = {
  time: '年/月',
  day: '日',
  time_str: '时刻',
  location: '地点',
  characters: '涉及角色',
  content: '事件描述',
};
const TIMELINE_EVENT_LONG_FIELDS = new Set(['content']);

const timelineEventsAdapter = {
  stage: 4,
  configKey: 'timeline',
  natEditTargetConstraint: 'timeline',
  suppressIdPill: true,

  // ==== 数组 ↔ entity 转换 helpers ====
  _getEventsArray(designConfig) {
    const arr = designConfig?.timeline?.events;
    return Array.isArray(arr) ? arr : [];
  },
  _findEventIndex(designConfig, id) {
    const arr = this._getEventsArray(designConfig);
    return arr.findIndex(e => e && e.id === id);
  },

  // ==== 数据访问 ====
  getEntities(designConfig) {
    const arr = this._getEventsArray(designConfig);
    return arr.filter(e => e && e.id).map(e => [e.id, e]);
  },
  getEntity(designConfig, id) {
    const idx = this._findEventIndex(designConfig, id);
    return idx >= 0 ? this._getEventsArray(designConfig)[idx] : null;
  },
  hasEntity(designConfig, id) {
    return this._findEventIndex(designConfig, id) >= 0;
  },
  countEntities(designConfig) {
    return this._getEventsArray(designConfig).length;
  },
  getDisplayName(id, _entity) {
    return id;
  },
  setEntity(designService, id, newEntity) {
    if (!designService.designConfig.timeline) designService.designConfig.timeline = { events: [] };
    if (!Array.isArray(designService.designConfig.timeline.events)) {
      designService.designConfig.timeline.events = [];
    }
    const arr = designService.designConfig.timeline.events;
    const idx = arr.findIndex(e => e && e.id === id);
    // 强制 id 不变
    const safe = { ...newEntity, id };
    if (idx >= 0) arr[idx] = safe;
    else arr.push(safe);
    if (typeof timelineService !== 'undefined' && timelineService.sortEventsByDate) {
      timelineService.sortEventsByDate(arr);
    }
  },
  nextEntityId(designConfig) {
    const arr = this._getEventsArray(designConfig);
    const taken = new Set(arr.map(e => e?.id).filter(Boolean));
    let i = 1;
    while (taken.has(`evt_new_${i}`)) i++;
    return `evt_new_${i}`;
  },
  newBlankEntity(designConfig, id) {
    // 复制现有任一事件的字段集，值置空
    const arr = this._getEventsArray(designConfig);
    const sample = arr.find(e => e && typeof e === 'object');
    const tmpl = sample
      ? Object.fromEntries(
          Object.keys(sample)
            .filter(k => !k.startsWith('_') && k !== 'id')
            .map(k => [k, ''])
        )
      : Object.fromEntries(TIMELINE_EVENT_FIELDS.map(f => [f, '']));
    return { id, ...tmpl };
  },
  ensureEntityShape(parsed, fallbackId) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out = { ...parsed, id: fallbackId };
    if (!out.content || typeof out.content !== 'string') return null;
    return out;
  },

  // ==== Head ====
  getHeaderPills(_id, entity) {
    const pills = [];
    // 时间摘要 pill：time + day + time_str（任意一个有值就显示）
    const timeParts = [entity.time, entity.day, entity.time_str].filter(
      v => typeof v === 'string' && v.trim()
    );
    if (timeParts.length > 0) {
      pills.push({ field: '_time', value: timeParts.join(' '), accent: 'primary' });
    }
    if (typeof entity.location === 'string' && entity.location.trim()) {
      pills.push({ field: '_location', value: entity.location, accent: 'faction' });
    }
    return pills;
  },
  getHeaderEditableFields() {
    return []; // head pills 仅展示，编辑在 body 里
  },

  // ==== Body：字段表（仿 Stage 3） ====
  buildCardBody(_id, entity) {
    const body = document.createElement('div');
    body.className = 'character-review-card-body';
    for (const field of TIMELINE_EVENT_FIELDS) {
      const value = entity[field];
      const row = document.createElement('div');
      row.className = 'character-review-field';
      const label = document.createElement('div');
      label.className = 'character-review-field-label';
      label.textContent = TIMELINE_EVENT_LABELS[field];
      const valEl = document.createElement('div');
      valEl.className = 'character-review-field-value';
      valEl.dataset.editField = field;
      const display = typeof value === 'string' ? value : '';
      valEl.textContent = display || '（空）';
      if (!display) valEl.classList.add('character-review-field-value--empty');
      row.appendChild(label);
      row.appendChild(valEl);
      body.appendChild(row);
    }
    return body;
  },
  getCollapsibleFields() {
    return [];
  },

  // ==== 编辑模式 ====
  getEditableRaw(key, entity) {
    return entity?.[key];
  },
  buildEditableField(key, raw) {
    const isLong = TIMELINE_EVENT_LONG_FIELDS.has(key);
    const editor = document.createElement(isLong ? 'textarea' : 'input');
    if (!isLong) editor.type = 'text';
    editor.value = typeof raw === 'string' ? raw : '';
    editor.dataset.editField = key;
    editor.dataset.editingOrigKind = 'string';
    editor.className = 'character-review-edit-input';
    editor.placeholder = TIMELINE_EVENT_LABELS[key] || key;
    if (isLong) editor.rows = 1;
    return editor;
  },
  coerceFieldValue(rawString, _origKind) {
    return rawString;
  },

  // ==== 提交编辑（数组 in-place 更新） ====
  commitEdit(designService, id, oldEntity, collected) {
    const arr = this._getEventsArray(designService.designConfig);
    const idx = arr.findIndex(e => e && e.id === id);
    if (idx < 0) return { changed: false };
    let changed = false;
    const updated = { ...oldEntity };
    for (const [key, val] of Object.entries(collected)) {
      if (val !== oldEntity[key]) {
        updated[key] = val;
        changed = true;
      }
    }
    if (!changed) return { changed: false };
    updated.id = id; // 强制 id 不变
    arr[idx] = updated;
    return { changed: true, nameChanged: false };
  },

  // ==== 删除：array splice（不走 P3 op，因为 path 是 events[N] 跟 id-based 模式不匹配） ====
  commitDelete(designService, id) {
    const arr = this._getEventsArray(designService.designConfig);
    const idx = arr.findIndex(e => e && e.id === id);
    if (idx >= 0) arr.splice(idx, 1);
  },

  // ==== 拖拽 ====
  getDragText(id, entity) {
    const tag =
      [entity?.time, entity?.day].filter(Boolean).join('') ||
      entity?.location ||
      '';
    return `[时间线 > ${id}${tag ? ` (${tag})` : ''}] 请修改这个事件，具体要求：\n`;
  },

  // ==== AI prompts ====
  buildSingleEntityContext(designService, excludeId) {
    const lines = [];
    if (designService.p1Output && typeof designService.p1Output === 'object') {
      lines.push('## 世界框架（P1 输出）');
      for (const [k, v] of Object.entries(designService.p1Output)) {
        if (typeof v === 'string' && v.trim()) {
          lines.push(`### ${k}\n${v.slice(0, 600)}`);
        }
      }
    }
    // 角色摘要（事件涉及的角色名必须来自 character_database）
    const cdb = designService.designConfig?.character_database || {};
    const charLines = Object.entries(cdb)
      .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')
      .slice(0, 30)
      .map(([cid, c]) => `- ${cid}: ${c.name || cid} (${c.role || c.faction || '?'})`);
    if (charLines.length > 0) {
      lines.push('\n## 已有角色（事件中涉及的角色名必须来自这里）');
      lines.push(...charLines);
    }
    // 其他事件摘要（避免重复）
    const arr = this._getEventsArray(designService.designConfig);
    const others = arr.filter(e => e && e.id && e.id !== excludeId).slice(0, 30);
    if (others.length > 0) {
      lines.push('\n## 已有的其他事件（仅供参考、避免冲突）');
      for (const e of others) {
        const tag = [e.time, e.day].filter(Boolean).join(' ');
        const snippet = (e.content || '').slice(0, 80);
        lines.push(`- ${e.id} (${tag} ${e.location || ''}): ${snippet}`);
      }
    }
    return lines.join('\n');
  },
  buildRerollPrompts(designService, id, oldEvent, hint) {
    const ctx = this.buildSingleEntityContext(designService, id);
    const oldJson = JSON.stringify(oldEvent, null, 2);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的历史编年官。\n' +
      `任务：根据世界框架和用户调整方向，重写时间线事件「${id}」。\n\n` +
      '## 输出格式（必须严格遵守 JSON）\n' +
      '只输出 JSON 对象，不要外层 markdown 围栏，结构必须是：\n\n' +
      '```\n' +
      '{\n' +
      `  "id": "${id}",\n` +
      '  "time": "纪年名+年.月（如 星历1042.06）",\n' +
      '  "day": "数字+日（如 15日）",\n' +
      '  "time_str": "HH:MM（如 14:20）",\n' +
      '  "location": "事件发生地点",\n' +
      '  "characters": "涉及角色名（用 / 分隔，必须是 character_database 中的真实角色名）",\n' +
      '  "content": "事件描述（2-5 句话，叙事性，不是干巴巴要点）"\n' +
      '}\n' +
      '```\n\n' +
      '## 其他约束\n' +
      `- id 必须保持「${id}」（不要改 id）\n` +
      '- time / day / time_str 字段中禁止出现括号说明、注释或额外解释文本\n' +
      '- characters 中提到的角色名必须存在于上面的角色列表中\n' +
      '- 风格符合世界框架\n\n' +
      ctx;
    const userMessage =
      '## 原事件\n```json\n' +
      oldJson +
      '\n```\n\n## 用户调整方向\n' +
      (hint || '（无特别要求，请基于世界框架自由发挥，但保持事件的叙事位置）') +
      '\n\n请直接输出新的 JSON 对象。';
    return { systemPrompt, userMessage };
  },
  buildAddPrompts(designService, newId, hint) {
    const ctx = this.buildSingleEntityContext(designService, null);
    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的历史编年官。\n' +
      `任务：基于已有时间线，新增一个事件（id: ${newId}）。\n\n` +
      '## 输出格式（必须严格遵守 JSON）\n' +
      '只输出 JSON 对象，不要外层 markdown 围栏，结构必须是：\n\n' +
      '```\n' +
      '{\n' +
      `  "id": "${newId}",\n` +
      '  "time": "纪年名+年.月", "day": "数字+日", "time_str": "HH:MM",\n' +
      '  "location": "...", "characters": "...", "content": "事件描述（2-5 句话）"\n' +
      '}\n' +
      '```\n\n' +
      `- id 必须是「${newId}」（不要改 id）\n` +
      '- characters 中角色名必须来自已有角色列表\n' +
      '- 与已有事件形成因果链，避免重复\n\n' +
      ctx;
    const userMessage = `## 用户希望新增的事件\n${hint}\n\n请直接输出 JSON。`;
    return { systemPrompt, userMessage };
  },
  async parseAIResponse(designService, response, fallbackId) {
    const extract = designService._extractJSON(response, { includeMeta: true, silent: true });
    let parsed = extract.parsed;
    if (!parsed) {
      const repaired = await designService._repairJSON(response, '事件 reroll/add', {});
      parsed = repaired?.parsed;
    }
    return this.ensureEntityShape(parsed, fallbackId);
  },

  // ==== 缺字段检测 ====
  detectEventIssues(_id, event) {
    const issues = [];
    const required = ['time', 'location', 'content'];
    const missing = required.filter(
      f => typeof event?.[f] !== 'string' || event[f].trim().length === 0
    );
    if (missing.length > 0) {
      issues.push(`缺：${missing.join(',')}`);
    }
    if (typeof event?.content === 'string' && event.content.trim().length < 20) {
      issues.push('内容太短');
    }
    return issues;
  },
  getEntityWarning(id, event) {
    const issues = this.detectEventIssues(id, event);
    if (issues.length === 0) return null;
    return {
      severity: 'warning',
      label: issues[0],
      tooltip: issues.join('；'),
    };
  },
  findEntitiesNeedingReroll(designConfig) {
    return this.getEntities(designConfig)
      .filter(([id, e]) => this.detectEventIssues(id, e).length > 0)
      .map(([id]) => id);
  },

  // ==== 文案 ====
  panelIcon: 'timeline',
  panelTitle: '时间线审阅',
  panelSubtitle: 'Stage 4 / 4',
  buildCountText(n) {
    return `${n} 个事件`;
  },
  addButtonLabel: '新增事件',
  addPromptTitle: '新增时间线事件',
  addPromptMessage: '输入提示词让 AI 生成（如"主角与某 NPC 的初次相遇"），或留空只创建空白事件。',
  rerollPromptTitle(id, _entity) {
    return `重抽事件「${id}」`;
  },
  rerollPromptMessage:
    '（可选）输入调整方向，例如"加一些悬疑氛围"或"换个地点"。留空让 AI 自由发挥（保持时间和叙事位置不变）。',
  deleteConfirmTitle: '删除时间线事件',
  deleteConfirmMessage(id, event) {
    const tag = [event?.time, event?.day, event?.location].filter(Boolean).join(' / ');
    return (
      `确认删除事件「<code>${_escapeHtml(id)}</code>」${tag ? `（${_escapeHtml(tag)}）` : ''}？<br>` +
      `此操作不可撤销。如果该事件被 init 模块或 character_timelines 引用，删除后引用会失效。`
    );
  },
  rerollFailMessage(err) {
    return `重抽失败：${err?.message || err}`;
  },
  addFailMessage(err) {
    return `新增失败：${err?.message || err}`;
  },
  parseFailMessage: 'AI 输出无法解析为事件对象，请重试',
  busyMessage: '请等待当前任务完成',
  editTooltip: '编辑这个事件',
  rerollTooltip: 'AI 重抽这个事件',
  deleteTooltip: '删除这个事件',
  dragHandleTooltip: '拖拽到下方输入框做定向编辑',

  buildPausedChatMessage(_designConfig) {
    return (
      `**📜 时间线生成完成，请审阅**\n\n第 4 阶段（时间线）已完成，请检查后继续。你可以：\n` +
      `- 新建/删除某个事件；\n` +
      `- 编辑事件的时间、地点、涉及角色和描述；\n` +
      `- 拖动卡片到下方输入框做定向修改；\n\n` +
      `检查完成后，点「**确认完成**」按钮——系统会基于你最终确认的事件**自动重新生成 \`character_timelines\`**，确保角色个人时间线跟事件保持一致。`
    );
  },
  buildRestoreHintMessage() {
    return (
      '**📜 时间线审阅未完成**\n\n' +
      '上次会话停在 Stage 4 时间线审阅环节。下方 panel 里每个事件卡都可以点 ✏️ 编辑、点 ⟳ 重抽、点 ✕ 删除；' +
      '也可以拖卡到输入框做定向修改，或在输入框直接描述改动。\n\n' +
      '检查完成后点「**确认完成**」——系统会基于最终事件重生成 character_timelines。'
    );
  },

  // ==== onFinalize：用户点"确认完成"后，pipeline 后处理调用本 hook，
  // 让 character_timelines 跟用户最终确认的 events 保持一致 ====
  async onFinalize(designService, hooks = {}) {
    const onProgress =
      typeof hooks.onProgressUpdate === 'function' ? hooks.onProgressUpdate : () => {};

    const events = this._getEventsArray(designService.designConfig);
    const cdb = designService.designConfig?.character_database || {};
    const charEntries = Object.entries(cdb).filter(
      ([k, v]) => !k.startsWith('_') && v && typeof v === 'object' && v.name
    );

    if (events.length === 0 || charEntries.length === 0) {
      onProgress('事件或角色为空，跳过角色时间线重生成');
      return;
    }

    onProgress('正在根据修改后的事件重新生成角色时间线…');

    const charSummary = charEntries
      .map(
        ([id, c]) =>
          `- ${id}: ${c.name} (${c.gender || '?'}) | 来历: ${c.origin || '未知'} | 初始认知: ${c.default_cognitive_state || '未知'}`
      )
      .join('\n');
    const eventsList = events
      .filter(e => e && e.id)
      .map(e => {
        const tag = [e.time, e.day, e.time_str].filter(Boolean).join(' ');
        const snippet = (e.content || '').slice(0, 120);
        return `- ${e.id} (${tag} @ ${e.location || '?'}): ${snippet}`;
      })
      .join('\n');

    const styleGuide = designService.p1Output?.style_guide || '';

    const systemPrompt =
      '你是一个 AI 冒险游戏世界卡的角色时间线编写者。\n' +
      '任务：根据用户最终确认的世界事件（events）和角色数据库，重新生成 character_timelines（每个角色的 cognitive / relationships / status 三种时序）。\n\n' +
      '## 输出格式（必须严格 JSON）\n' +
      '只输出 JSON 对象，不要外层 markdown 围栏：\n\n' +
      '```\n' +
      '{\n' +
      '  "character_timelines": {\n' +
      '    "角色ID": {\n' +
      '      "cognitive": [ { "year": 数字, "month": 数字, "day": 数字, "state": "身份/立场" } ],\n' +
      '      "relationships": [ { "year": 数字, "month": 数字, "day": 数字, "relations": { "目标角色ID": "关系描述" } } ],\n' +
      '      "status": [ { "year": 数字, "month": 数字, "day": 数字, "status": "死亡/流亡" } ]\n' +
      '    }\n' +
      '  }\n' +
      '}\n' +
      '```\n\n' +
      '## 约束\n' +
      '- 只输出 character_timelines 对象（不要 events、不要 _summary、不要其他字段）\n' +
      '- 角色 ID 必须与下面的角色数据库 ID 完全一致\n' +
      '- 使用**快照模式**：每条记录是该时间点的完整状态，不是增量\n' +
      '- cognitive.state 仅"身份/立场/自我定位"，不写情绪、调查进展、推理结论或对玩家态度\n' +
      '- relationships 双向定义；relations 中目标 ID 必须是已有角色 ID\n' +
      '- 没有变化的字段可以是空数组 []\n' +
      '- year/month/day 数值应能从 events 的 time/day 字段对应（如 "星历1042.06.15日" → year=1042, month=6, day=15）\n' +
      '- 必须**严格基于下方提供的事件**生成时序，不要引用不存在的事件时间点\n' +
      (styleGuide ? `\n## 风格基调\n${styleGuide}\n` : '') +
      '\n## 已有角色\n' +
      charSummary +
      '\n\n## 用户最终确认的事件（按时间顺序）\n' +
      eventsList;
    const userMessage =
      '请基于上述事件和角色，重新生成 character_timelines。直接输出 JSON。';

    let response;
    try {
      response = await aiService._callSummaryAPI(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        'p2',
        {}
      );
    } catch (err) {
      console.warn('[timelineEventsAdapter] onFinalize API call failed:', err);
      onProgress('角色时间线重生成失败（API 错误），保留原数据');
      return;
    }

    const extract = designService._extractJSON(response, { includeMeta: true, silent: true });
    let parsed = extract.parsed;
    if (!parsed) {
      const repaired = await designService._repairJSON(response, '角色时间线重生成', {});
      parsed = repaired?.parsed;
    }

    let newCharTimelines = null;
    if (parsed?.character_timelines && typeof parsed.character_timelines === 'object') {
      newCharTimelines = parsed.character_timelines;
    } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 容错：AI 可能直接输出 { 角色ID: {...} } 而不是包了一层 character_timelines
      const looksLikeCharTimelines = Object.values(parsed).every(
        v => v && typeof v === 'object' && ('cognitive' in v || 'relationships' in v || 'status' in v)
      );
      if (looksLikeCharTimelines) newCharTimelines = parsed;
    }

    if (!newCharTimelines) {
      console.warn('[timelineEventsAdapter] onFinalize parse failed, keeping old character_timelines');
      onProgress('角色时间线解析失败，保留原数据');
      return;
    }

    designService.designConfig.character_timelines = newCharTimelines;
    designService._saveDesignConfig();
    onProgress('角色时间线重生成完成');
  },
};

registerReviewAdapter(4, timelineEventsAdapter);
