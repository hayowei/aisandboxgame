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
  // 注：dialogue_examples 信息密度过大不进 card view，仅显示 dialogue_tone
  _defaultFields: [
    'gender',
    'origin',
    'birthday',
    'cognitive_state',
    'initial_status',
    'dialogue_tone',
    'personality',
    'appearance',
    'clothing',
  ],

  // Header 区固定字段（不在 Body 渲染）— 动态获取
  get _headerFields() {
    const header = ['name', 'id'];
    // 只有当前世界定义了 cognitive_state 字段时才加入 header
    const panelFields = window.worldMeta?.getPanelFields?.();
    const npcFields = panelFields?.panel_npc;
    if (Array.isArray(npcFields) && npcFields.some(f => f.key === 'cognitive_state')) {
      header.push('cognitive_state');
    }
    return header;
  },

  // 元数据字段（不渲染）—— is_protagonist 是系统标志位，只用于 hero 判定，不在卡面展示
  _metaFields: ['trigger_type', 'is_protagonist'],

  // 中文标签映射（fallback，Schema description 不可用时使用）
  _defaultLabels: {
    gender: '性别',
    personality: '性格',
    origin: '来历',
    birthday: '生日',
    appearance: '外貌',
    clothing: '衣着',
    cognitive_state: '此刻认知',
    default_cognitive_state: '初始认知（旧）',
    initial_status: '此刻状态',
    dialogue_tone: '对话基调',
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
   * 属性安全转义 - 额外转义引号，用于 HTML 属性值（escapeHtml 不转引号，属性上下文会被击穿）
   */
  escapeAttr(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
    const panelFields = window.worldMeta?.getPanelFields?.();
    if (panelFields && panelFields.panel_npc) {
      const props = {};
      for (const f of panelFields.panel_npc) {
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
    return `<span class="${className} npc-editable" contenteditable="${editable ? 'true' : 'false'}" data-field="${this.escapeAttr(fieldName)}">${e(value)}</span>`;
  },


  // ========== v3 卡（角色 stage 用）：性别渐变 + 翻面 ==========

  // 背面固定 6 槽（cognitive_state 上了正面副标题，gender 在 banner，故均不在此）
  // dialogue_tone 读取走 characterDialogue helper（老卡兜底到 msg_reply_tone）
  // initial_status 进固定槽（frozen_moment 锁后这是核心可见信息）
  _backFixedKeys: ['origin', 'birthday', 'initial_status', 'personality', 'clothing', 'dialogue_tone'],

  // 非身份/非展示字段（既不进固定槽也不进溢出区）
  // msg_reply_tone 已被 dialogue_tone 替代显示，不再单独出现在溢出区
  // default_cognitive_state 是 V1 老字段，不显示（V2 cognitive_state 在 banner 副标题）
  // dialogue_examples 信息密度过大，不进 card 视图
  _backExcludeKeys: ['name', 'id', 'cognitive_state', 'default_cognitive_state', 'gender', 'trigger_type', 'age', 'state', 'card', '__isHero', 'msg_reply_tone', 'dialogue_examples'],

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

  /** 主角卡正面「位置」的真源：玩家本人不跑 NPC 反应、引擎投影也跳过主角，所以 state.current_location
   *  只是建卡时种下的死种子、永不前进。这里改读状态栏的 location（与顶部 📍 同一份数据），把实体 id
   *  解析成可读名后拼成一行（与状态栏一致的 country - site - spot，空段省略）。只读——绝不回写主角 state。
   *  空（开局尚未定位）返回 '' → 调用方回退显示 '—'。每回合随 AI_STATE_PANEL_UPDATED 刷新。 */
  _formatHeroLocation() {
    const loc = window.customStatusStore?.getStatus?.()?.location;
    if (!loc || typeof loc !== 'object') return '';
    const resolve = v => {
      if (v === null || v === undefined || v === '') return '';
      const name = window.entityStore?.resolveDisplayName?.(String(v));
      return name || String(v);
    };
    return [resolve(loc.country), resolve(loc.site), resolve(loc.spot)]
      .filter(Boolean)
      .join(' - ');
  },

  /** 主角卡正面「同伴」= 本回合在场的非主角 NPC 派生列表（方案 A：在场即同伴）。主角自己的
   *  current_social_target 永远空（主角不跑反应、引擎投影跳过主角），原是死壳。在场真值复用每回合
   *  算好的 npcStore.isPresentNow；随 presence 变化由 refreshHeroFrontState 每回合重渲跟刷。
   *  无人在场返回 '' → 调用方回退 '—'。 */
  _formatHeroCompanions(en) {
    const store = window.npcStore;
    if (!store || typeof store.getAll !== 'function') return '';
    const names = [];
    for (const npc of store.getAll()) {
      const id = npc?.card?.id;
      if (!id || npc.card?.is_protagonist === true) continue;
      if (typeof store.isPresentNow === 'function' && !store.isPresentNow(id)) continue;
      names.push(npc.card?.name || npc.name || id);
    }
    return names.join(en ? ', ' : '、');
  },

  /** 「复核」小键：让 AI 根据当前剧情重判该字段（值来自 AI 调用，非玩家手写 → 不破状态层红线）。
   *  点击由 npcPanelUI 委托（data-action=npc-field-recheck）处理：位置（data-field=current_location）
   *  分流到即时写路径，身份字段走 queueUpdate 待审批。单色线性刷新图标（无 emoji；feedback_no_emoji_monochrome_icons）。 */
  _renderRecheckBtn(field, en) {
    const title = en ? 'Recheck with AI (re-judge from the story)' : '让 AI 根据剧情重判此字段';
    const label = en ? 'Recheck' : '复核';
    const icon =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    return `<button type="button" class="npc-recheck-btn" data-action="npc-field-recheck" data-field="${this.escapeAttr(field)}" title="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">${icon}<span class="npc-recheck-label">${this.escapeHtml(label)}</span></button>`;
  },

  /**
   * 正面状态区（位置/同伴条 + 近念引用 + 心情/意图页脚）
   * npcPanelUI.refreshStatePane 局部刷新此块
   */
  _renderFrontState(json, isHero = false) {
    const e = t => this.escapeHtml(t);
    const state = (json && typeof json.state === 'object' && json.state) || {};
    const en = this._i18nIsEn();
    const L = en
      ? { loc: 'AT', with: 'WITH', mood: 'MOOD', intent: 'INTENT', none: '—', noThought: 'Has not stirred yet.' }
      : { loc: '位置', with: '同伴', mood: '心情', intent: '意图', none: '—', noThought: '尚未有念头。' };

    // 此函数被两种形态调用：① render() 内 flatten 后的 view（json.id / json.is_protagonist 在顶层）；
    // ② refreshStatePane 直传 npcStore.get() 的原始 {card,state}（id/is_protagonist 在 json.card 下）。
    // 故 id / isHero 都按"顶层 → card 层"双取，两路都对（局部刷新不丢徽章）。
    const id = (json && (json.id || (json.card && json.card.id))) || null;
    isHero = isHero || json?.__isHero === true || json?.is_protagonist === true || json?.card?.is_protagonist === true;

    // 活世界（PZGM，非主角）：正面显示「在场/离场」徽章；主角=玩家本人无在场概念、react 老局无此概念，都不显。
    const isPzgm = !!(window.StoryEngineFlag && window.StoryEngineFlag.isPzgm && window.StoryEngineFlag.isPzgm());
    const showPresence = isPzgm && !isHero;
    let presenceHtml = '';
    if (showPresence) {
      // 手动覆盖（玩家意图）叠在 AI 判定（引擎结果）之上：强制在场/离场即时生效，auto 才看引擎判定。
      const manual = (window.npcStore && typeof window.npcStore.getPresenceMode === 'function')
        ? window.npcStore.getPresenceMode(id) : 'auto';
      const present = manual === 'present' ? true
        : manual === 'absent' ? false
        : !!(window.npcStore && typeof window.npcStore.isPresentNow === 'function' && window.npcStore.isPresentNow(id));
      presenceHtml = this._renderPresenceBadge(present, manual !== 'auto', en);
    }

    // 主角读状态栏真源（活值）；非主角读自治 state 层位置——三段对象走 formatTriad 显示（旧串/空兜底）。
    const _ncl = state.current_location;
    const loc = isHero
      ? (this._formatHeroLocation() || L.none)
      : (_ncl
          ? (window.locationTriad
              ? window.locationTriad.formatTriad(_ncl)
              : (typeof _ncl === 'string' ? _ncl : (_ncl.spot || _ncl.site || _ncl.country || L.none)))
          : L.none);
    const rawSocial = state.current_social_target;
    // PZGM：同伴=玩家时白显（在场徽章已表达「与你同处」）、空也不显；只在同伴是别人时保留（离场卡的活世界引力）。
    // react 老局/主角卡：维持原行为（始终显示，含 '—'）。
    const showSocial = showPresence ? (!!rawSocial && rawSocial !== 'player') : true;
    // 主角「同伴」= 本回合在场的非主角 NPC 派生列表（方案 A）；非主角仍读各自 current_social_target。
    const social = isHero ? (this._formatHeroCompanions(en) || L.none) : this._resolveSocialTarget(rawSocial);
    const thoughts = Array.isArray(state.recent_thoughts) ? state.recent_thoughts : [];
    let latest = '';
    for (let i = thoughts.length - 1; i >= 0; i--) {
      const t = thoughts[i];
      if (t && typeof t.thought === 'string' && t.thought.trim()) { latest = t.thought.trim(); break; }
    }
    const mood = state.current_mood || L.none;
    const intent = state.intent_toward_player;

    let html = '';
    html += '<div class="npc-where">';
    html += `<span class="npc-where-k">${e(L.loc)}</span><span class="npc-where-v">${e(loc)}</span>`;
    // 位置复核键（仅非主角 NPC）：主角位置是状态栏只读镜像、不可复核；NPC 位置可让 AI 据剧情重判（即时写）。
    if (!isHero) html += this._renderRecheckBtn('current_location', en);
    if (showSocial) {
      html += `<span class="npc-where-sep">·</span><span class="npc-where-k">${e(L.with)}</span><span class="npc-where-v">${e(social)}</span>`;
    }
    html += presenceHtml; // 在场徽章靠右（CSS margin-left:auto）
    html += '</div>';
    html += '<div class="npc-thought-quote">';
    html += latest
      ? `<span class="npc-thought-text">${e(latest)}</span>`
      : `<span class="npc-thought-text npc-thought-empty">${e(L.noThought)}</span>`;
    // 念头复核键（仅非主角 NPC）：让 AI 据当前剧情重算一条当前念头、替换累积旧念头（即时写 + 清残留）。
    // 主角念头不在此处自治（主角=玩家本人），不给。
    if (!isHero) html += this._renderRecheckBtn('recent_thoughts', en);
    html += '</div>';
    html += '<div class="npc-state-foot">';
    html += `<span class="npc-foot-item"><span class="npc-foot-k">${e(L.mood)}</span><span class="npc-foot-v">${e(mood)}</span></span>`;
    if (intent != null && String(intent).trim() && String(intent).trim() !== '—') {
      html += `<span class="npc-foot-item"><span class="npc-foot-k">${e(L.intent)}</span><span class="npc-foot-v npc-foot-v--intent">${e(String(intent).trim())}</span></span>`;
    }
    html += '</div>';
    return html;
  },

  /** 正面「在场/离场」徽章（活世界 §2，PZGM 非主角）。只读状态读数——和卡背三档（设置/意图）正交。
   *  pinned（玩家手动强制 present/absent）时附一个单色线性锁 icon（无 emoji；feedback_no_emoji_monochrome_icons）。
   *  pill 整圈边框、非彩色侧边强调条（feedback_no_accent_border_ai_design）。 */
  _renderPresenceBadge(present, pinned, en) {
    const e = t => this.escapeHtml(t);
    const cls = present ? 'is-present' : 'is-absent';
    const label = present ? (en ? 'Here' : '在场') : (en ? 'Away' : '离场');
    const lock = pinned
      ? '<svg class="npc-presence-lock" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>'
      : '';
    const title = pinned
      ? (en ? 'Presence locked by you — change on the card back' : '你已手动锁定在场状态——在卡背修改')
      : (en ? 'Presence decided by the AI this turn' : '本回合由 AI 判定的在场状态');
    return `<span class="npc-presence-badge ${cls}" title="${e(title)}">${lock}${e(label)}</span>`;
  },

  /**
   * 翻面背面（身份层）：6 固定槽 + 「其他」溢出折叠区
   */
  _renderCardBack(json, isHero = false) {
    const e = t => this.escapeHtml(t);
    const en = this._i18nIsEn();
    const fixed = this._backFixedKeys;

    // 主角成长可编辑白名单（cognitive_state/role）：背面置顶为可编辑行，其余身份字段对主角只读。
    // 与 npcStore.queueUpdate/updateField 共读同一常量（单一真源）。
    const heroEditableKeys = isHero
      ? (window.panelSchemaBuilder?.NPC_PROTAGONIST_UPDATABLE_KEYS || ['cognitive_state', 'role'])
      : [];
    const heroEditableSet = new Set(heroEditableKeys);

    // 溢出键 = (schema body 字段 ∪ card 上实有键) − 固定 − 排除 − DROP 死字段 − 内部 _ 字段
    const overflow = [];
    const dropKeys = window.panelSchemaBuilder?.NPC_DROP_KEYS || [];
    // 含 _metaFields（is_protagonist / trigger_type）：与正面 grid 共用同一排除源，
    // 否则系统标志位会作为溢出字段渲到背面（如 "是主角: true"）。
    // 主角额外排除白名单键（cognitive_state/role），避免与下方置顶的可编辑行重复。
    const seen = new Set([...fixed, ...this._backExcludeKeys, ...this._metaFields, ...dropKeys, ...heroEditableKeys]);
    const candidates = [...this._getBodyFields(), ...Object.keys(json || {})];
    for (const k of candidates) {
      if (!k || k.startsWith('_') || seen.has(k)) continue;
      seen.add(k);
      overflow.push(k);
    }

    const fmt = v => (v === null || v === undefined || v === '' || v === '{{DYNAMIC}}' ? '—' : String(v));
    // 复核键 gate 用的锁死字段集（与 npcStore._getRuntimeLockedUpdateFieldSet 同源；queueUpdate 也据此挡）。
    const recheckLockedSet = new Set(
      Array.isArray(window.panelSchemaBuilder?.NPC_RUNTIME_LOCKED_UPDATE_KEYS)
        ? window.panelSchemaBuilder.NPC_RUNTIME_LOCKED_UPDATE_KEYS
        : ['trigger_type', 'id', 'name', 'gender', 'origin', 'birthday', 'age', 'is_protagonist', 'initial_status']
    );
    const row = key => {
      const label = this._getFieldLabel(key);
      let val = json[key];
      // dialogue_tone 兜底到老卡 msg_reply_tone
      if (key === 'dialogue_tone' && (val === null || val === undefined || val === '') && window.characterDialogue) {
        val = window.characterDialogue.readTone(json);
      }
      // cognitive_state 兜底到老卡 default_cognitive_state
      if (key === 'cognitive_state' && (val === null || val === undefined || val === '') && window.characterFields) {
        val = window.characterFields.readCognitiveState(json);
      }
      // 主角：仅白名单字段渲为可编辑（contenteditable 由编辑键切换）；其余身份字段只读展示。
      const valHtml = (!isHero || heroEditableSet.has(key))
        ? this.renderEditable(key, fmt(val), 'npc-back-v', false)
        : `<span class="npc-back-v">${e(fmt(val))}</span>`;
      // 复核键（一直显示）：跟「可编辑性」走——主角仅白名单字段，普通 NPC 排除锁死字段（origin/birthday/initial_status…）。
      const recheckable = isHero ? heroEditableSet.has(key) : !recheckLockedSet.has(key);
      // 有复核键时：字段名 + 复核键包成左列竖叠（复核键落在字段名正下方）；无则保持裸 label。
      const kcol = recheckable
        ? `<div class="npc-back-kcol"><span class="npc-back-k">${e(label)}</span>${this._renderRecheckBtn(key, en)}</div>`
        : `<span class="npc-back-k">${e(label)}</span>`;
      return `<div class="npc-back-row">${kcol}${valHtml}</div>`;
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
    // 主角：成长可编辑字段（自我认知 / 职业）置顶；cognitive_state 正面副标题也镜像同值。
    if (isHero && heroEditableKeys.length) html += heroEditableKeys.map(row).join('');
    html += fixed.map(row).join('');
    if (overflow.length) {
      // 默认展开、不可折叠；保留 .npc-back-more 的虚线分割线
      html += `<div class="npc-back-more"><div class="npc-back-more-body">${overflow.map(row).join('')}</div></div>`;
    }
    // 主角：状态栏数值字段（境界/义体/衣着/势力…）只读镜像；唯一真源是状态栏，主角卡不维护第二套。
    if (isHero) html += this._renderHeroStatusMirror();
    html += '</div>';

    const hint = `<span class="npc-back-hint">${e(en ? 'Tap again to return' : '再点一次回正面')}</span>`;
    html += '<div class="npc-back-foot">';
    if (isHero) {
      // 主角：仅放编辑键（可改 cognitive_state/role，走 npcStore 白名单）。
      // 无删除/选中/在场——主角不入在场/离场名单、不可删（活世界 §3）。
      html += '<div class="npc-back-actions">';
      html += `<button type="button" data-action="npc-edit-toggle" class="npc-back-btn" title="${e(en ? 'Edit' : '编辑')}">✎ ${e(en ? 'Edit' : '编辑')}</button>`;
      html += '</div>';
    } else {
      html += '<div class="npc-back-actions">';
      html += `<button type="button" data-action="npc-edit-toggle" class="npc-back-btn" title="${e(en ? 'Edit' : '编辑')}">✎ ${e(en ? 'Edit' : '编辑')}</button>`;
      // 活世界（PZGM）：「选中」概念已弃用，换成「是否在玩家身边」三档；react 老局仍显示选中键。
      const isPzgm = !!(window.StoryEngineFlag && window.StoryEngineFlag.isPzgm && window.StoryEngineFlag.isPzgm());
      if (isPzgm) {
        const pmode = (window.npcStore && typeof window.npcStore.getPresenceMode === 'function')
          ? window.npcStore.getPresenceMode(json.id)
          : 'auto';
        html += this._renderPresenceControl(pmode, en);
      } else {
        html += `<button type="button" data-action="npc-select-btn" class="npc-back-btn selected" title="${e(en ? 'Toggle selection' : '切换选中状态')}">✅ ${e(en ? 'Selected' : '选中')}</button>`;
      }
      html += `<button type="button" data-action="npc-btn-danger" class="npc-back-btn" title="${e(en ? 'Delete this card' : '删除此角色卡')}">🗑️ ${e(en ? 'Delete' : '删除')}</button>`;
      html += '</div>';
      // 在场三档下方的「在场」说明面板（默认折叠，点三档尾随的 ? 展开）。仅 PZGM 显示在场控件时渲染。
      if (isPzgm) html += this._renderPresenceHelp(en);
    }
    html += hint;
    html += '</div>';
    html += '</div>'; // .npc-back-inner
    return html;
  },

  /** 「是否在玩家身边」三档控件（活世界 §2，PZGM）：强制在场=present / AI决定=auto / 强制离场=absent。
   *  点击 data-action="npc-presence-set" data-presence-mode 由 npcPanelUI 委托处理。
   *  尾随「?」触发 data-action="npc-presence-help"，展开同卡的 .npc-presence-help 说明面板。 */
  _renderPresenceControl(mode, en) {
    const e = text => this.escapeHtml(text);
    const m = mode === 'present' || mode === 'absent' ? mode : 'auto';
    const opts = [
      { v: 'present', label: en ? 'Always here' : '强制在场' },
      { v: 'auto', label: en ? 'AI decides' : 'AI决定' },
      { v: 'absent', label: en ? 'Always away' : '强制离场' },
    ];
    const title = en
      ? 'Is this character in your perception/interaction loop right now? (AI = let the AI decide each turn)'
      : '这个角色此刻是否在你的感知/互动回路里（AI = 每回合交给 AI 判断）';
    let h = `<span class="npc-presence-seg" role="group" title="${e(title)}">`;
    for (const o of opts) {
      const active = m === o.v ? ' is-active' : '';
      h += `<button type="button" class="npc-presence-opt${active}" data-action="npc-presence-set" data-presence-mode="${o.v}" aria-pressed="${m === o.v ? 'true' : 'false'}">${e(o.label)}</button>`;
    }
    h += '</span>';
    const helpTitle = en ? 'What does “present” mean?' : '什么是「在场」？';
    h += `<button type="button" class="npc-presence-help-btn" data-action="npc-presence-help" aria-expanded="false" aria-label="${e(helpTitle)}" title="${e(helpTitle)}">?</button>`;
    return h;
  },

  /** 「在场」说明面板（默认折叠，点尾随的「?」展开）。文案对齐引擎在场判定的真实口径
   *  （npcEngine.classifyPresence：在场 = 处在玩家的感知/互动回路里，与物理距离无关；仅被提名不算）。
   *  纯静态作者文案、无动态插值 → 直接含 markup，不经 escapeHtml。 */
  _renderPresenceHelp(en) {
    const body = en
      ? `<p class="npc-presence-help-lead"><strong>“Present”</strong> = this character is in your <strong>perception / interaction loop</strong> right now: they know what you're doing, or are doing something together with you — <strong>regardless of physical distance</strong> (waiting next door ≠ present; a distant ally you call in = present; merely being mentioned doesn't count).</p>
         <ul class="npc-presence-help-list">
           <li><strong>Always here</strong> — pulled into the current scene every turn; never dropped by the per-turn cap.</li>
           <li><strong>AI decides</strong> (default) — each turn the AI judges presence by who is actually following your current action.</li>
           <li><strong>Always away</strong> — kept out of the scene every turn, even if they are right beside you.</li>
         </ul>`
      : `<p class="npc-presence-help-lead"><strong>「在场」</strong>= 这个角色此刻在你的<strong>感知 / 互动回路</strong>里：TA 知道你正在做什么，或正和你一起做一件事——<strong>与物理距离无关</strong>（隔壁干等 ≠ 在场；远端被你呼叫接入 = 在场；仅被提到名字也不算）。</p>
         <ul class="npc-presence-help-list">
           <li><strong>强制在场</strong>——每回合都把 TA 拉进当前场景参与，不会被人数上限挤掉。</li>
           <li><strong>AI决定</strong>（默认）——每回合由 AI 按「谁在跟进你此刻的动作」判断 TA 在不在场。</li>
           <li><strong>强制离场</strong>——每回合都把 TA 排除在外，哪怕 TA 就在你旁边。</li>
         </ul>`;
    return `<div class="npc-presence-help" hidden>${body}</div>`;
  },

  /** 主角卡专用：状态栏自定义数值字段（境界/义体/衣着/势力…）的只读镜像。
   *  唯一真源 = customStatusStore.getStatus()（每回合由 projectTurn 覆盖）；主角卡只展示、不写回。
   *  字段 label 复用 panelSchemaBuilder.buildCustomStatusToolProperties（其 description 即字段标签），
   *  与状态栏渲染共用同一"自定义组判定 + 标签"口径，避免重复一套核心组判定逻辑。
   *  无数据 / 无自定义组时返回空串（不渲染该段）。 */
  _renderHeroStatusMirror() {
    const e = t => this.escapeHtml(t);
    const status = window.customStatusStore?.getStatus?.();
    if (!status || typeof status !== 'object') return '';
    const panelStatus = window.worldMeta?.getPanelFields?.()?.panel_status;
    if (!Array.isArray(panelStatus)) return '';
    const props =
      window.panelSchemaBuilder?.buildCustomStatusToolProperties?.(panelStatus) || {};

    const rows = [];
    for (const groupKey of Object.keys(props)) {
      const data = status[groupKey];
      if (!data || typeof data !== 'object' || Array.isArray(data)) continue; // 紧凑镜像只取对象组
      const fieldProps = props[groupKey]?.properties || {};
      for (const fieldKey of Object.keys(fieldProps)) {
        const val = data[fieldKey];
        if (val === null || val === undefined || val === '') continue;
        const label = fieldProps[fieldKey]?.description || fieldKey;
        rows.push(
          `<div class="npc-back-row"><span class="npc-back-k">${e(label)}</span><span class="npc-back-v">${e(String(val))}</span></div>`
        );
      }
    }
    if (!rows.length) return '';
    const title = this._i18nIsEn() ? 'STATUS (mirrors status bar)' : '当前状态（镜像自状态栏）';
    return `<div class="npc-back-more npc-hero-mirror"><div class="npc-back-kicker">${e(title)}</div><div class="npc-back-more-body">${rows.join('')}</div></div>`;
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

    const isHero =
      !!opts.isHero ||
      !!json?.__isHero ||
      json?.card?.is_protagonist === true ||
      json?.is_protagonist === true;

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
      // V2 cognitive_state 优先；V1 老卡 default_cognitive_state 兜底
      let csVal = json.cognitive_state;
      if ((csVal === null || csVal === undefined || csVal === '') && window.characterFields) {
        csVal = window.characterFields.readCognitiveState(json);
      }
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
      html += `<div class="npc-front-state">${this._renderFrontState(json, isHero)}</div>`;
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
      let csValue = json.cognitive_state;
      if ((csValue === null || csValue === undefined || csValue === '') && window.characterFields) {
        csValue = window.characterFields.readCognitiveState(json);
      }
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
