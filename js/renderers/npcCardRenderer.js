// ============================================
// NPC Card Renderer - NPC 档案卡渲染器
// ============================================
// 字段驱动：从 worldMeta 动态读取字段列表
// Header：id + name + cognitive_state + age(stamp) + 操作按键
// Body：其余字段按定义渲染为 2 列网格

const npcCardRenderer = {
  name: 'npc',
  priority: 10, // 高优先级

  // 必需字段（canRender 判定用）
  requiredFields: ['name'],

  // 默认 NPC 特征字段（fallback，Schema 不可用时使用）
  _defaultFields: [
    'gender',
    'origin',
    'birthday',
    'cognitive_state',
    'msg_reply_tone',
    'personality',
    'appearance',
    'clothing',
  ],

  // Header 区固定字段（不在 Body 渲染）— 动态获取
  get _headerFields() {
    const header = ['name', 'id'];
    // 只有当前世界定义了 cognitive_state 字段时才加入 header
    const step3Fields = window.worldMeta?.getStep3Fields?.();
    const npcFields = step3Fields?.panel_npc;
    if (Array.isArray(npcFields) && npcFields.some(f => f.key === 'cognitive_state')) {
      header.push('cognitive_state');
    }
    return header;
  },

  // 元数据字段（不渲染）
  _metaFields: ['trigger_type'],

  // 中文标签映射（fallback，Schema description 不可用时使用）
  _defaultLabels: {
    gender: '性别',
    personality: '性格',
    origin: '来历',
    birthday: '生日',
    appearance: '外貌',
    clothing: '衣着',
    cognitive_state: '认知',
    msg_reply_tone: '语气',
  },

  // Schema 字段缓存
  _cachedSchemaFields: null,
  _cachedSchemaLabels: null,

  /**
   * HTML 转义函数 - 防止 XSS 攻击
   */
  escapeHtml(text) {
    if (text === null || text === undefined || text === '') return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  },

  /**
   * 判定字段宽度类名（半宽 / 全宽）
   * @param {string} label - 字段标签
   * @param {string} value - 字段显示值
   * @returns {'half'|'full'} 宽度类名
   */
  getFieldWidthClass(label, value) {
    const v = String(value ?? '').trim();

    // 空值占位视为短值
    if (v === '' || v === '—') return 'half';

    // 包含换行 → 全宽
    if (v.includes('\n')) return 'full';

    // 包含句子标点 → 全宽
    if (/[，。；：！？,.;:!?]/.test(v)) return 'full';

    // 按显示长度估算
    const estimateWidth = str => {
      let w = 0;
      for (const ch of str) {
        const code = ch.codePointAt(0);
        if (ch === ' ' || ch === '/') {
          w += 0.5;
        } else if (code > 0x7f) {
          // 中文 / 全角
          w += 2;
        } else {
          // 英文字母、数字、其他 ASCII
          w += 1;
        }
      }
      return w;
    };

    const total = estimateWidth(String(label ?? '')) + estimateWidth(v);
    return total <= 22 ? 'half' : 'full';
  },

  /**
   * 从 Schema 动态获取 panel_npc 的字段列表
   * @returns {string[]} 字段名数组
   */
  _getSchemaFields() {
    if (this._cachedSchemaFields) return this._cachedSchemaFields;

    const schema = this._getNpcSchema();
    if (!schema) {
      this._cachedSchemaFields = this._defaultFields;
      return this._cachedSchemaFields;
    }

    this._cachedSchemaFields = Object.keys(schema);
    return this._cachedSchemaFields;
  },

  /**
   * 获取 NPC Schema 的 properties 对象
   * @returns {Object|null} panel_npc items properties
   */
  _getNpcSchema() {
    const step3Fields = window.worldMeta?.getStep3Fields?.();
    if (step3Fields && step3Fields.panel_npc) {
      const props = {};
      for (const f of step3Fields.panel_npc) {
        if (!f.key) continue;
        props[f.key] = { type: f.type || 'string', description: f.label };
      }
      return props;
    }
    return null;
  },

  /**
   * 从 Schema description 提取字段的中文标签
   * 取 description 的第一个句号/逗号/句号前的内容
   * @param {string} fieldName - 字段名
   * @returns {string} 中文标签
   */
  _getFieldLabel(fieldName) {
    // 先查缓存
    if (this._cachedSchemaLabels && this._cachedSchemaLabels[fieldName]) {
      return this._cachedSchemaLabels[fieldName];
    }

    // 尝试从 Schema description 提取
    const schema = this._getNpcSchema();
    if (schema && schema[fieldName] && schema[fieldName].description) {
      const desc = schema[fieldName].description;
      // 取第一个标点前的内容作为标签，最多取 6 个字符
      const match = desc.match(/^(.{1,6}?)(?:[。，,.：:（(]|$)/);
      if (match && match[1]) {
        const label = match[1].trim();
        // 缓存
        if (!this._cachedSchemaLabels) this._cachedSchemaLabels = {};
        this._cachedSchemaLabels[fieldName] = label;
        return label;
      }
    }

    // fallback 到默认映射
    return this._defaultLabels[fieldName] || fieldName;
  },

  /**
   * 获取 Body 区需要渲染的字段列表（排除 Header/Meta）
   * @returns {string[]} body 字段名数组
   */
  _getBodyFields() {
    const allFields = this._getSchemaFields();
    const excludes = new Set([...this._headerFields, ...this._metaFields]);
    return allFields.filter(f => !excludes.has(f));
  },

  /**
   * 判断 JSON 是否为 NPC 档案
   */
  canRender(json) {
    const hasRequired = this.requiredFields.every(f => json[f]);
    const evidenceFields = this._getSchemaFields().filter(
      field => !['trigger_type', 'id', 'name'].includes(field)
    );
    const matchedFields = evidenceFields.filter(field => field in json).length;
    return hasRequired && ('trigger_type' in json || matchedFields >= 3);
  },

  _getCurrentGameTime() {
    if (
      typeof AnalyzerUtils !== 'undefined' &&
      typeof AnalyzerUtils.getCurrentGameTime === 'function'
    ) {
      return AnalyzerUtils.getCurrentGameTime();
    }
    if (
      typeof timelineService !== 'undefined' &&
      typeof timelineService.getCurrentDate === 'function'
    ) {
      return timelineService.getCurrentDate();
    }
    return null;
  },

  _getComputedAgeDisplay(json) {
    if (
      typeof AnalyzerUtils === 'undefined' ||
      typeof AnalyzerUtils.calculateAgeFromBirthday !== 'function'
    ) {
      return '—';
    }
    const age = AnalyzerUtils.calculateAgeFromBirthday(json?.birthday, this._getCurrentGameTime());
    return age || '—';
  },

  _renderAgeStamp(json) {
    const displayValue = this._getComputedAgeDisplay(json);
    return `<span class="npc-stamp">${this.escapeHtml(displayValue)}</span>`;
  },

  /**
   * 渲染可编辑字段
   * @param {string} fieldName - 字段名称(用于 data-field 属性)
   * @param {string} value - 字段值
   * @param {string} className - CSS 类名
   * @param {boolean} editable - 是否默认可编辑（v3 卡传 false：默认只读，进编辑态再开）
   */
  renderEditable(fieldName, value, className = 'npc-value', editable = true) {
    const e = text => this.escapeHtml(text);
    return `<span class="${className} npc-editable" contenteditable="${editable ? 'true' : 'false'}" data-field="${fieldName}">${e(value)}</span>`;
  },

  /**
   * 渲染状态层（动态 tab）—— v1
   * 5 行固定布局：location / mood / intent / social_target / recent_thoughts
   * null 字段显示"—"占位，不隐藏行，保持 layout 稳定
   * @param {Object} json - NPC 数据
   * @returns {string} html
   */
  _renderStatePane(json) {
    const e = text => this.escapeHtml(text);
    const state = (json && typeof json.state === 'object' && json.state) || {};

    const fmt = v => {
      if (v === null || v === undefined || v === '') return '—';
      return String(v);
    };

    const resolveSocialTarget = id => {
      if (!id) return '—';
      if (id === 'player') {
        return window.i18nService?.getResolvedLanguage?.() === 'en' ? 'Player' : '玩家';
      }
      const target = window.npcStore?.get?.(id);
      const name = target?.name;
      return name ? `${name}` : id;
    };

    const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
    const labels = isEn
      ? {
          location: 'Location',
          mood: 'Mood',
          intent: 'Toward you',
          social: 'Talking with',
          thoughts: 'Recent thoughts',
          empty: 'Has not stirred yet.',
          wakeMeta: turn => (turn != null ? `Last woken: turn #${turn}` : 'Never woken.'),
        }
      : {
          location: '当前位置',
          mood: '当前心境',
          intent: '对你的态度',
          social: '当前互动对象',
          thoughts: '最近想法',
          empty: '暂无',
          wakeMeta: turn => (turn != null ? `最近一次苏醒：回合 #${turn}` : '尚未苏醒'),
        };

    // 最近想法（FIFO 内部 旧→新；UI 倒序 新→旧）
    let thoughtsHtml = '';
    const thoughts = Array.isArray(state.recent_thoughts) ? state.recent_thoughts : [];
    if (thoughts.length === 0) {
      thoughtsHtml = `<div class="npc-state-thought npc-state-thought--empty">${e(labels.empty)}</div>`;
    } else {
      const items = thoughts
        .slice()
        .reverse()
        .map(t => {
          const text = t && typeof t.thought === 'string' ? t.thought : '';
          if (!text) return '';
          return `<div class="npc-state-thought">· ${e(text)}</div>`;
        })
        .filter(Boolean)
        .join('');
      thoughtsHtml = items || `<div class="npc-state-thought npc-state-thought--empty">${e(labels.empty)}</div>`;
    }

    const wakeMeta = labels.wakeMeta(state.last_woken_turn);

    return [
      `<div class="npc-state-row"><span class="npc-state-label">📍 ${e(labels.location)}</span><span class="npc-state-value">${e(fmt(state.current_location))}</span></div>`,
      `<div class="npc-state-row"><span class="npc-state-label">💭 ${e(labels.mood)}</span><span class="npc-state-value">${e(fmt(state.current_mood))}</span></div>`,
      `<div class="npc-state-row"><span class="npc-state-label">🎯 ${e(labels.intent)}</span><span class="npc-state-value">${e(fmt(state.intent_toward_player))}</span></div>`,
      `<div class="npc-state-row"><span class="npc-state-label">👥 ${e(labels.social)}</span><span class="npc-state-value">${e(resolveSocialTarget(state.current_social_target))}</span></div>`,
      `<div class="npc-state-row npc-state-row--block"><span class="npc-state-label">📝 ${e(labels.thoughts)}</span><div class="npc-state-thoughts">${thoughtsHtml}</div></div>`,
      `<div class="npc-state-meta">${e(wakeMeta)}</div>`,
    ].join('');
  },

  // ========== v3 卡（角色 stage 用）：性别渐变 + 翻面 ==========

  // 背面固定 6 槽（cognitive_state 上了正面副标题，gender 在 banner，故均不在此）
  _backFixedKeys: ['origin', 'birthday', 'personality', 'appearance', 'clothing', 'msg_reply_tone'],

  // 非身份/非展示字段（既不进固定槽也不进溢出区）
  _backExcludeKeys: ['name', 'id', 'cognitive_state', 'gender', 'trigger_type', 'age', 'state', 'card', '__isHero'],

  /**
   * 性别 → CSS 修饰类 + 符号（颜色在 CSS 里按类定义，JS 不碰 hex）
   */
  _genderProfile(genderRaw) {
    const g = String(genderRaw == null ? '' : genderRaw).trim().toLowerCase();
    const isMale = /男|♂|乾|阳/.test(g) || /\b(male|man|boy|m)\b/.test(g) || g === 'male';
    const isFemale = /女|♀|坤|阴/.test(g) || /\b(female|woman|girl|f)\b/.test(g) || g === 'female';
    if (isMale) return { cls: 'npc-gender-male', sym: '♂' };
    if (isFemale) return { cls: 'npc-gender-female', sym: '♀' };
    return { cls: 'npc-gender-other', sym: '⚲' };
  },

  _i18nIsEn() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  },

  _resolveSocialTarget(id) {
    if (!id) return '—';
    if (id === 'player') return this._i18nIsEn() ? 'You' : '玩家';
    const target = window.npcStore?.get?.(id);
    return target?.card?.name || target?.name || id;
  },

  /**
   * 正面状态区（位置/同伴条 + 近念引用 + 心情/意图页脚）
   * npcPanelUI.refreshStatePane 局部刷新此块
   */
  _renderFrontState(json) {
    const e = t => this.escapeHtml(t);
    const state = (json && typeof json.state === 'object' && json.state) || {};
    const en = this._i18nIsEn();
    const L = en
      ? { loc: 'AT', with: 'WITH', mood: 'MOOD', intent: 'INTENT', none: '—', noThought: 'Has not stirred yet.' }
      : { loc: '位置', with: '同伴', mood: '心情', intent: '意图', none: '—', noThought: '尚未有念头。' };

    const loc = state.current_location || L.none;
    const social = this._resolveSocialTarget(state.current_social_target);
    const thoughts = Array.isArray(state.recent_thoughts) ? state.recent_thoughts : [];
    let latest = '';
    for (let i = thoughts.length - 1; i >= 0; i--) {
      const t = thoughts[i];
      if (t && typeof t.thought === 'string' && t.thought.trim()) { latest = t.thought.trim(); break; }
    }
    const mood = state.current_mood || L.none;
    const intent = state.intent_toward_player;

    let html = '';
    html += `<div class="npc-where"><span class="npc-where-k">${e(L.loc)}</span><span class="npc-where-v">${e(loc)}</span><span class="npc-where-sep">·</span><span class="npc-where-k">${e(L.with)}</span><span class="npc-where-v">${e(social)}</span></div>`;
    html += '<div class="npc-thought-quote">';
    html += latest
      ? `<span class="npc-thought-text">${e(latest)}</span>`
      : `<span class="npc-thought-text npc-thought-empty">${e(L.noThought)}</span>`;
    html += '</div>';
    html += '<div class="npc-state-foot">';
    html += `<span class="npc-foot-item"><span class="npc-foot-k">${e(L.mood)}</span><span class="npc-foot-v">${e(mood)}</span></span>`;
    if (intent != null && String(intent).trim() && String(intent).trim() !== '—') {
      html += `<span class="npc-foot-item"><span class="npc-foot-k">${e(L.intent)}</span><span class="npc-foot-v npc-foot-v--intent">${e(String(intent).trim())}</span></span>`;
    }
    html += '</div>';
    return html;
  },

  /**
   * 翻面背面（身份层）：6 固定槽 + 「其他」溢出折叠区
   */
  _renderCardBack(json, isHero = false) {
    const e = t => this.escapeHtml(t);
    const en = this._i18nIsEn();
    const fixed = this._backFixedKeys;

    // 溢出键 = (schema body 字段 ∪ card 上实有键) − 固定 − 排除 − DROP 死字段 − 内部 _ 字段
    const overflow = [];
    const dropKeys = window.step3SchemaBuilder?.NPC_DROP_KEYS || [];
    const seen = new Set([...fixed, ...this._backExcludeKeys, ...dropKeys]);
    const candidates = [...this._getBodyFields(), ...Object.keys(json || {})];
    for (const k of candidates) {
      if (!k || k.startsWith('_') || seen.has(k)) continue;
      seen.add(k);
      overflow.push(k);
    }

    const fmt = v => (v === null || v === undefined || v === '' || v === '{{DYNAMIC}}' ? '—' : String(v));
    const row = key => {
      const label = this._getFieldLabel(key);
      return `<div class="npc-back-row"><span class="npc-back-k">${e(label)}</span>${this.renderEditable(key, fmt(json[key]), 'npc-back-v', false)}</div>`;
    };

    // 内容统一裹在 .npc-back-inner（自然高度、不被 inset:0 约束）——
    // 翻面撑高用它量，杜绝"定高盒子上量 scrollHeight 失真"
    let html = '<div class="npc-back-inner">';
    html += '<div class="npc-back-head">';
    html += '<span class="npc-back-seal">档</span>';
    html += '<div class="npc-back-title">';
    html += `<span class="npc-back-kicker">${e(en ? 'IDENTITY' : '身份')}</span>`;
    html += `<span class="npc-back-name">${e(json.name || '')}</span>`;
    html += `<span class="npc-back-code">${e(json.id || '')}</span>`;
    html += '</div>';
    html += '</div>';

    html += '<div class="npc-back-body">';
    html += fixed.map(row).join('');
    if (overflow.length) {
      // 默认展开、不可折叠；保留 .npc-back-more 的虚线分割线
      html += `<div class="npc-back-more"><div class="npc-back-more-body">${overflow.map(row).join('')}</div></div>`;
    }
    html += '</div>';

    const hint = `<span class="npc-back-hint">${e(en ? 'Tap again to return' : '再点一次回正面')}</span>`;
    html += '<div class="npc-back-foot">';
    if (!isHero) {
      // 主角卡不入 store / 不可删选 / 编辑不持久 → 不渲染操作键
      html += '<div class="npc-back-actions">';
      html += `<button type="button" data-action="npc-edit-toggle" class="npc-back-btn" title="${e(en ? 'Edit' : '编辑')}">✎ ${e(en ? 'Edit' : '编辑')}</button>`;
      html += `<button type="button" data-action="npc-select-btn" class="npc-back-btn selected" title="${e(en ? 'Toggle selection' : '切换选中状态')}">✅ ${e(en ? 'Selected' : '选中')}</button>`;
      html += `<button type="button" data-action="npc-btn-danger" class="npc-back-btn" title="${e(en ? 'Delete this card' : '删除此角色卡')}">🗑️ ${e(en ? 'Delete' : '删除')}</button>`;
      html += '</div>';
    }
    html += hint;
    html += '</div>';
    html += '</div>'; // .npc-back-inner
    return html;
  },

  /**
   * 渲染单个 Body 字段
   * 已知字段使用特殊视觉样式，未知字段使用通用网格项
   * @param {string} field - 字段名
   * @param {Object} json - NPC 数据
   * @returns {{ html: string, section: string }} html 和所属区段
   */
  _renderBodyField(field, json) {
    const e = text => this.escapeHtml(text);
    const rawValue = json[field];
    const isDynamic = rawValue === '{{DYNAMIC}}';
    const isEmpty = rawValue === null || rawValue === undefined || rawValue === '' || isDynamic;
    const displayValue = isEmpty ? '—' : String(rawValue);
    const label = this._getFieldLabel(field);
    const widthClass = this.getFieldWidthClass(label, displayValue);

    // ---- 通用网格字段（personality、appearance 等全部走此路径） ----
    return {
      html: `<div class="npc-item ${widthClass}"><span class="npc-label">${e(label)}</span>${this.renderEditable(field, displayValue)}</div>`,
      section: 'grid',
    };
  },

  /**
   * 渲染 NPC 卡片
   * 字段驱动：字段列表从 worldMeta 动态读取
   */
  render(json, opts = {}) {
    const e = text => this.escapeHtml(text);

    const isHero = !!opts.isHero || !!json?.__isHero;

    // 兼容视图：新嵌套 {card, state} 或老平铺 {gender, ...}
    // 渲染逻辑统一用 view 引用，view.X 自动从 card / 顶层 fallback
    const card = (json?.card && typeof json.card === 'object' && !Array.isArray(json.card))
      ? json.card
      : json;
    const stateObj = (json?.state && typeof json.state === 'object') ? json.state : null;
    const view = { ...card };
    if (stateObj) view.state = stateObj;
    // id/name 兜底：嵌套结构下 card.id/card.name 是权威；老平铺时 json.id/json.name 已被展开到 view
    if (!view.id && json.id) view.id = json.id;
    if (!view.name && json.name) view.name = json.name;
    json = view;

    // 获取 Body 字段列表
    const bodyFields = this._getBodyFields();

    // 预渲染所有 Body 字段，按 section 分组
    const sections = { grid: '' };
    for (const field of bodyFields) {
      const result = this._renderBodyField(field, json);
      if (result.html) {
        sections[result.section] = (sections[result.section] || '') + result.html;
      }
    }

    // 只有当 json 带 state 子对象时（来自 npcStore 的"活的" NPC）才走 v3 翻面卡。
    // 聊天消息里 inline 渲染的 NPC JSON 没有 state，沿用旧版直接 grid 渲染（不变）。
    const hasState = json && typeof json.state === 'object' && json.state !== null;

    // ========== v3 卡（角色 stage）：性别渐变 banner + 点击翻面 ==========
    if (hasState) {
      const g = this._genderProfile(json.gender);
      const ageDisp = this._getComputedAgeDisplay(json);
      const csVal = json.cognitive_state;
      const csDisplay =
        csVal === null || csVal === undefined || csVal === '' || csVal === '{{DYNAMIC}}'
          ? '—'
          : csVal;
      const glyph = String(json.name || json.id || '?').trim().charAt(0) || '?';

      let html = `<div class="npc-card npc-card--v3 ${g.cls}${isHero ? ' npc-card--hero' : ''}">`;
      html += '<div class="npc-card-flip">';

      // ---- 正面 ----
      html += '<div class="npc-card-face npc-card-front">';
      // header：保留字面 .npc-card-header 供 npcPanelUI 注入 .npc-badge（CSS 渲为左上角带）
      // 操作键已移到背面 foot；正面 header 仅承载角带 + 主角条
      html += '<div class="npc-card-header">';
      if (isHero) {
        html += `<span class="npc-hero-strip">${this._i18nIsEn() ? 'YOU' : '主角'}</span>`;
      }
      html += '</div>';
      // banner（性别渐变背景）
      html += '<div class="npc-banner">';
      html += `<span class="npc-banner-glyph" aria-hidden="true">${e(glyph)}</span>`;
      html += `<span class="npc-banner-id">${e(json.id || '')}</span>`;
      if (isHero) html += '<span class="npc-hero-star" aria-hidden="true">★</span>';
      html += '<div class="npc-banner-main">';
      html += `<div class="npc-banner-line"><span class="npc-name">${e(json.name)}</span><span class="npc-banner-gender"><span class="npc-gender-sym">${e(g.sym)}</span>${ageDisp && ageDisp !== '—' ? ' ' + e(ageDisp) : ''}</span></div>`;
      html += `<div class="npc-banner-sub"><span class="npc-cognitive-text">${e(csDisplay)}</span></div>`;
      html += '</div>';
      html += '</div>';
      // 状态区（refreshStatePane 局部刷新此容器）
      html += `<div class="npc-front-state">${this._renderFrontState(json)}</div>`;
      html += `<div class="npc-flip-hint" aria-hidden="true">${this._i18nIsEn() ? 'Flip' : '点击翻面'}</div>`;
      html += '</div>';

      // ---- 背面（身份层） ----
      html += `<div class="npc-card-face npc-card-back">${this._renderCardBack(json, isHero)}</div>`;

      html += '</div></div>';
      return html;
    }

    // ========== Inline 渲染（chat 消息里）—— 旧版不变：header + body grid ==========
    let html = '<div class="npc-card">';
    html += '<div class="npc-card-header">';
    html += '<div class="npc-header-actions">';
    html += '<button class="" data-action="npc-btn-danger" title="删除此角色卡">🗑️</button>';
    html += '<button class="selected" data-action="npc-select-btn" title="切换选中状态">✅</button>';
    html += '</div>';
    html += this._renderAgeStamp(json);
    html += `<span class="npc-id">${e(json.id || '')}</span>`;
    html += `<div class="npc-name npc-editable" contenteditable="true" data-field="name">${e(json.name)}</div>`;
    const schemaFields = this._getSchemaFields();
    if (schemaFields.includes('cognitive_state')) {
      const csValue = json.cognitive_state;
      const isDynamicCS = csValue === '{{DYNAMIC}}';
      if (!isDynamicCS) {
        const csDisplay =
          csValue === null || csValue === undefined || csValue === '' ? '—' : csValue;
        html += `<div class="npc-cognitive"><span class="npc-tag tag-state npc-editable" contenteditable="true" data-field="cognitive_state">⚜ ${e(csDisplay)}</span></div>`;
      }
    }
    html += '</div>';
    if (sections.grid) {
      html += '<div class="npc-card-body">';
      html += '<div class="npc-grid">';
      html += sections.grid;
      html += '</div></div>';
    }
    html += '</div>';
    return html;
  },

  /**
   * 清除 Schema 缓存（Schema 变更时调用）
   */
  invalidateCache() {
    this._cachedSchemaFields = null;
    this._cachedSchemaLabels = null;
  },
};

// 注册到核心渲染器
jsonRenderer.register(npcCardRenderer);
