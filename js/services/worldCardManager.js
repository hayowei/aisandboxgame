// ============================================
// World Card Manager - 世界卡管理器
// ============================================
// 目标：
// 1) 将世界设定数据从引擎框架中剥离，封装为独立的"世界卡"
// 2) 提供统一的读取接口，支持多世界卡管理
// 3) 所有世界卡（包括预装的泰瑞亚大陆）使用统一的 CRUD 路径
// ============================================
// localStorage keys:
//   world_card_index  — 所有卡 ID 有序列表 (string[])
//   world_card_{id}   — 完整卡片数据 (object)
//   world_card_active — 当前激活卡 ID (string|null)
// ============================================

const BUILTIN_INTERNAL_WRITE_GUARD = Symbol('world_card_builtin_internal_write_guard');
const BUILTIN_DEFAULT_CARD_ID = 'wc_builtin_default';
const BUILTIN_CYBERPUNK_CARD_ID = 'wc_builtin_cyberpunk';
const BUILTIN_CULTIVATION_CARD_ID = 'wc_builtin_cultivation';
const BUILTIN_CARD_SPECS = Object.freeze([
  Object.freeze({
    id: BUILTIN_DEFAULT_CARD_ID,
    jsonPath: '/prompts/defaultworldcard.json',
    embeddedKey: '__BUILTIN_DEFAULT_WORLD_CARD__',
    displayName: '默认世界卡',
    fallbackName: '默认世界',
    fallbackDescription: '内置默认世界卡（兜底）',
    fallbackWorldText: '这是内置默认世界卡的兜底内容。你可以导入或新建自己的世界卡。',
    englishName: 'Default World',
    englishDescription: 'Built-in fallback world card.',
    englishWorldText:
      'This is the built-in fallback world card. You can import or create your own world card.',
    fallbackProfile: Object.freeze({
      zhStart: '故事从一座陌生城镇开始。',
      zhTone: '先观察、再行动的轻探索开局。',
      enStart: 'The story begins in an unfamiliar town.',
      enTone: 'A light exploratory opening focused on observation first, action second.',
      zhTraveler: '旅行者',
      enTraveler: 'Traveler',
      zhCognitive: '初到陌生城镇的旅行者',
      enCognitive: 'A traveler newly arrived in an unfamiliar town',
      zhLocation: '陌生城镇',
      enLocation: 'Unknown Town',
      zhPersonality: '谨慎，先观察再行动',
      enPersonality: 'Careful, observes before acting',
      zhBackground: '刚进入这个世界，正在收集信息。',
      enBackground: 'New to this world and still collecting information.',
    }),
  }),
  Object.freeze({
    id: BUILTIN_CYBERPUNK_CARD_ID,
    jsonPath: '/prompts/cyberpunkworldcard.json',
    embeddedKey: '__BUILTIN_CYBERPUNK_WORLD_CARD__',
    displayName: '赛博朋克世界卡',
    fallbackName: '赛博朋克世界',
    fallbackDescription: '内置赛博朋克世界卡（兜底）',
    fallbackWorldText: '这是内置赛博朋克世界卡的兜底内容。你可以刷新重试，或暂时切换到其他世界卡。',
    englishName: 'Cyberpunk World',
    englishDescription: 'Built-in fallback cyberpunk world card.',
    englishWorldText:
      'This is the built-in cyberpunk fallback world card. Refresh and try again, or switch to another world card for now.',
    fallbackProfile: Object.freeze({
      zhStart: '故事从一座分层赛博都市的下层街区开始。',
      zhTone: '压抑、紧张、带一点潜入和调查感的开局。',
      enStart: 'The story begins in the lower districts of a layered cyberpunk city.',
      enTone: 'A tense cyberpunk opening focused on survival, infiltration, and investigation.',
      zhTraveler: '流亡者',
      enTraveler: 'Drifter',
      zhCognitive: '在下层街区醒来的失忆流亡者',
      enCognitive: 'An amnesiac drifter who woke up in the lower districts',
      zhLocation: '下层街区',
      enLocation: 'Lower District',
      zhPersonality: '谨慎、适应快、警觉',
      enPersonality: 'Cautious, adaptive, alert',
      zhBackground: '一个试图搞清楚自己处境的幸存者。',
      enBackground:
        'A lone survivor trying to understand what happened in a hostile cyberpunk city.',
    }),
  }),
  Object.freeze({
    id: BUILTIN_CULTIVATION_CARD_ID,
    jsonPath: '/prompts/cultivationworldcard.json',
    embeddedKey: '__BUILTIN_CULTIVATION_WORLD_CARD__',
    displayName: '修仙世界卡',
    fallbackName: '修仙世界',
    fallbackDescription: '内置修仙世界卡（兜底）',
    fallbackWorldText: '这是内置修仙世界卡的兜底内容。你可以刷新重试，或暂时切换到其他世界卡。',
    englishName: 'Cultivation World',
    englishDescription: 'Built-in fallback cultivation world card.',
    englishWorldText:
      'This is the built-in cultivation fallback world card. Refresh and try again, or switch to another world card for now.',
    fallbackProfile: Object.freeze({
      zhStart: '故事从一处宗门边缘地带或险地外围开始。',
      zhTone: '底层求生、资源匮乏、一步走错就可能送命的修仙开局。',
      enStart: 'The story begins at the edge of a sect territory or a dangerous frontier.',
      enTone:
        'A cultivation opening built around scarce resources, bottom-tier survival, and constant danger.',
      zhTraveler: '底层修士',
      enTraveler: 'Low-tier Cultivator',
      zhCognitive: '刚踏入修真泥潭的底层修士',
      enCognitive: 'A low-tier cultivator newly dragged into the brutal world of cultivation',
      zhLocation: '宗门边缘地带',
      enLocation: 'Sect Frontier',
      zhPersonality: '谨慎求生/不敢露财',
      enPersonality: 'Cautious, resource-starved, unwilling to expose valuables',
      zhBackground: '资质平庸，资源匮乏，只能在弱肉强食的修真界里小心求活。',
      enBackground:
        'Born with poor aptitude and almost no resources, forced to survive carefully in a ruthless cultivation world.',
    }),
  }),
]);
const VALID_WORLD_CARD_LOCALES = new Set(['zh-CN', 'en']);

class WorldCardManager {
  constructor() {
    this.INDEX_KEY = 'world_card_index';
    this.ACTIVE_KEY = 'world_card_active';
    this.CARD_KEY_PREFIX = 'world_card_';
    this.BUILTIN_CARD_ID = BUILTIN_DEFAULT_CARD_ID;
    this.BUILTIN_CARD_SPECS = BUILTIN_CARD_SPECS;
    this._pendingActivationId = null;
    this._ready = false;
    this._readyPromise = this._initializeBuiltInCards();
  }

  // ========================================
  // 内部工具方法
  // ========================================

  _deepClone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return value;
    }
  }

  _normalizeContentLocale(value, fallback = 'zh-CN') {
    return VALID_WORLD_CARD_LOCALES.has(value) ? value : fallback;
  }

  _normalizeLocalizedCardEntry(entry, fallbackLocale = 'zh-CN') {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!entry.snapshot || typeof entry.snapshot !== 'object' || Array.isArray(entry.snapshot)) {
      return null;
    }

    return {
      name: typeof entry.name === 'string' ? entry.name : '',
      description: typeof entry.description === 'string' ? entry.description : '',
      snapshot: this._deepClone(entry.snapshot),
      contentLocale: this._normalizeContentLocale(entry.contentLocale, fallbackLocale),
    };
  }

  _normalizeCardLocalizations(localizations = {}) {
    if (!localizations || typeof localizations !== 'object' || Array.isArray(localizations)) {
      return {};
    }
    const normalized = {};
    Object.entries(localizations).forEach(([locale, entry]) => {
      const normalizedLocale = this._normalizeContentLocale(locale, '');
      if (!normalizedLocale) return;
      const normalizedEntry = this._normalizeLocalizedCardEntry(entry, normalizedLocale);
      if (!normalizedEntry) return;
      normalized[normalizedLocale] = normalizedEntry;
    });
    return normalized;
  }

  _resolveRequestedLocale(locale = null) {
    if (VALID_WORLD_CARD_LOCALES.has(locale)) return locale;
    const i18n = typeof window !== 'undefined' ? window.i18nService : null;
    if (i18n && typeof i18n.getResolvedLanguage === 'function') {
      return this._normalizeContentLocale(i18n.getResolvedLanguage(), 'zh-CN');
    }
    return 'zh-CN';
  }

  _buildLocalizedCardView(rawCard, locale = null) {
    if (!rawCard || typeof rawCard !== 'object') return null;
    const requestedLocale = this._resolveRequestedLocale(locale);
    const baseContentLocale = this._normalizeContentLocale(rawCard.contentLocale, 'zh-CN');
    const localizations = this._normalizeCardLocalizations(rawCard.localizations);
    const localizedEntry = localizations[requestedLocale] || null;

    const name = localizedEntry?.name || rawCard.name || '';
    const description = localizedEntry?.description || rawCard.description || '';
    const snapshot = localizedEntry?.snapshot || rawCard.snapshot || {};
    const resolvedLocale = localizedEntry?.contentLocale || baseContentLocale;

    return {
      ...this._deepClone(rawCard),
      name,
      description,
      snapshot: this._deepClone(snapshot),
      contentLocale: resolvedLocale,
      baseContentLocale,
      localizations,
      resolvedLocale,
    };
  }

  _updateCardContentForLocale(card, snapshot, locale, metadata = {}) {
    const targetLocale = this._normalizeContentLocale(locale, 'zh-CN');
    const clonedSnapshot = this._deepClone(snapshot);
    const baseLocale = this._normalizeContentLocale(card.contentLocale, 'zh-CN');

    if (targetLocale === baseLocale) {
      card.snapshot = clonedSnapshot;
      if (metadata.name !== undefined) card.name = metadata.name;
      if (metadata.description !== undefined) card.description = metadata.description;
      return;
    }

    if (
      !card.localizations ||
      typeof card.localizations !== 'object' ||
      Array.isArray(card.localizations)
    ) {
      card.localizations = {};
    }

    const existing = card.localizations[targetLocale];
    card.localizations[targetLocale] = {
      name: metadata.name !== undefined ? metadata.name : existing?.name || '',
      description:
        metadata.description !== undefined ? metadata.description : existing?.description || '',
      snapshot: clonedSnapshot,
      contentLocale: targetLocale,
    };
  }

  _generateId() {
    return 'wc_custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  _loadIndex() {
    try {
      const raw = localStorage.getItem(this.INDEX_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch (_e) {
      void _e;
    }
    return [];
  }

  _saveIndex(ids) {
    localStorage.setItem(this.INDEX_KEY, JSON.stringify(ids));
  }

  _loadCard(id) {
    try {
      const raw = localStorage.getItem(this.CARD_KEY_PREFIX + id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error(`[WorldCardManager] 卡片 ${id} 数据损坏:`, e);
      return null;
    }
  }

  _saveCard(card) {
    localStorage.setItem(this.CARD_KEY_PREFIX + card.id, JSON.stringify(card));
  }

  _removeCard(id) {
    localStorage.removeItem(this.CARD_KEY_PREFIX + id);
  }

  _isValidIsoString(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed);
  }

  _buildDefaultStatusFields() {
    const isEnglish = this._resolveRequestedLocale() === 'en';
    const builder = globalThis?.step3SchemaBuilder;
    if (typeof builder?.getDefaultStatusFields === 'function') {
      return this._deepClone(builder.getDefaultStatusFields(isEnglish ? 'en' : 'zh-CN'));
    }
    return [
      {
        key: 'datetime',
        label: isEnglish ? 'Time' : '时间',
        icon: '📅',
        _template: 'time',
        _precision: 'time',
        fields: [
          { key: 'year', label: isEnglish ? 'Year' : '年份', type: 'integer' },
          { key: 'month', label: isEnglish ? 'Month' : '月份', type: 'integer' },
          { key: 'day', label: isEnglish ? 'Day' : '日期', type: 'integer' },
          { key: 'hour', label: isEnglish ? 'Hour' : '时', type: 'integer' },
          { key: 'minute', label: isEnglish ? 'Minute' : '分', type: 'integer' },
        ],
      },
      {
        key: 'location',
        label: isEnglish ? 'Location' : '地点',
        icon: '📍',
        fields: [
          { key: 'country', label: isEnglish ? 'Region' : '国家/区域', type: 'string' },
          { key: 'site', label: isEnglish ? 'Place' : '地点', type: 'string' },
          { key: 'spot', label: isEnglish ? 'Spot' : '具体位置', type: 'string' },
        ],
      },
      {
        key: 'money',
        label: isEnglish ? 'Money' : '金钱',
        icon: '💰',
        _template: 'money',
        fields: [{ key: 'amount', label: isEnglish ? 'Silver' : '银币', type: 'integer' }],
      },
      {
        key: 'objective',
        label: isEnglish ? 'Objective' : '目标',
        icon: '🎯',
        _template: 'objective',
        fields: [
          {
            key: 'text',
            label: isEnglish ? 'Current Objective' : '当前目标',
            type: 'string',
            nullable: true,
          },
        ],
      },
    ];
  }

  _buildDefaultNpcFields() {
    const isEnglish = this._resolveRequestedLocale() === 'en';
    const builder = globalThis?.step3SchemaBuilder;
    if (typeof builder?.getDefaultNpcFields === 'function') {
      return this._deepClone(builder.getDefaultNpcFields(isEnglish ? 'en' : 'zh-CN'));
    }
    if (Array.isArray(builder?.DEFAULT_NPC_FIELDS) && builder.DEFAULT_NPC_FIELDS.length > 0) {
      return this._deepClone(builder.DEFAULT_NPC_FIELDS);
    }
    return [
      {
        key: 'trigger_type',
        label: isEnglish ? 'Trigger Type' : '触发类型',
        desc: isEnglish
          ? 'NEW=first appearance / UPDATE=status change / NEW_PREDEFINED=first predefined appearance (id only)'
          : 'NEW=新角色首次登场 / UPDATE=状态变化 / NEW_PREDEFINED=预定义角色首次登场（只需id）',
        type: 'string',
        enum: ['NEW', 'UPDATE', 'NEW_PREDEFINED'],
        fixed: true,
        runtimeRequired: true,
      },
      {
        key: 'id',
        label: isEnglish ? 'Identifier' : '标识符',
        type: 'string',
        fixed: true,
        runtimeRequired: true,
      },
      {
        key: 'name',
        label: isEnglish ? 'Name' : '角色名',
        type: 'string',
        fixed: true,
        runtimeRequired: true,
      },
      {
        key: 'gender',
        label: isEnglish ? 'Gender' : '性别',
        desc: isEnglish ? 'For example: Female / Male / Unknown' : '如：女/男/未知',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'origin',
        label: isEnglish ? 'Origin' : '来历',
        desc: isEnglish ? 'One-line source or background' : '一句话说明出身或来源',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'birthday',
        label: isEnglish ? 'Birthday' : '生日',
        desc: isEnglish
          ? 'Pure time value following the current world calendar'
          : '纯时间值，格式必须符合当前世界历法',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
        nullable: true,
      },
      {
        key: 'cognitive_state',
        label: isEnglish ? 'Cognitive State' : '认知状态',
        desc: isEnglish ? 'Who the character currently believes they are' : '角色当前认为自己是谁',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'msg_reply_tone',
        label: isEnglish ? 'Reply Tone' : '说话语气',
        desc: isEnglish
          ? 'Stable speaking style, not temporary mood'
          : '稳定说话风格，不写当前情绪',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'personality',
        label: isEnglish ? 'Personality' : '性格标签',
        desc: isEnglish ? 'For example: forceful / calm / gentle' : '如：强势/沉稳/温和',
        type: 'string',
      },
      {
        key: 'appearance',
        label: isEnglish ? 'Appearance' : '外貌特征',
        desc: isEnglish ? 'For example: dark long hair / blond blue eyes' : '如：黑长直/金发碧眼',
        type: 'string',
      },
      {
        key: 'clothing',
        label: isEnglish ? 'Clothing' : '当前衣着',
        desc: isEnglish ? 'Current outfit' : '当前具体衣着',
        type: 'string',
      },
    ];
  }

  getDefaultBuiltInCardId() {
    return this.BUILTIN_CARD_ID;
  }

  _getBuiltInSpec(id = this.BUILTIN_CARD_ID) {
    return (
      this.BUILTIN_CARD_SPECS.find(spec => spec.id === id) || this.BUILTIN_CARD_SPECS[0] || null
    );
  }

  _buildFallbackBuiltInCard(spec = this._getBuiltInSpec()) {
    const now = new Date().toISOString();
    const fallbackProfile =
      spec?.fallbackProfile || this.BUILTIN_CARD_SPECS[0]?.fallbackProfile || {};
    const zhStart = fallbackProfile.zhStart || '故事从一座陌生城镇开始。';
    const zhTone = fallbackProfile.zhTone || '先观察、再行动的轻探索开局。';
    const enStart = fallbackProfile.enStart || 'The story begins in an unfamiliar town.';
    const enTone =
      fallbackProfile.enTone ||
      'A light exploratory opening focused on observation first, action second.';
    const zhTraveler = fallbackProfile.zhTraveler || '旅行者';
    const enTraveler = fallbackProfile.enTraveler || 'Traveler';
    const zhCognitive = fallbackProfile.zhCognitive || '初到陌生城镇的旅行者';
    const enCognitive =
      fallbackProfile.enCognitive || 'A traveler newly arrived in an unfamiliar town';
    const zhLocation = fallbackProfile.zhLocation || '陌生城镇';
    const enLocation = fallbackProfile.enLocation || 'Unknown Town';
    const zhPersonality = fallbackProfile.zhPersonality || '谨慎，先观察再行动';
    const enPersonality = fallbackProfile.enPersonality || 'Careful, observes before acting';
    const zhBackground = fallbackProfile.zhBackground || '刚进入这个世界，正在收集信息。';
    const enBackground =
      fallbackProfile.enBackground || 'New to this world and still collecting information.';

    return {
      id: spec.id,
      name: spec.fallbackName,
      description: spec.fallbackDescription,
      createdAt: now,
      updatedAt: now,
      isBuiltIn: true,
      isEmpty: false,
      contentLocale: 'zh-CN',
      localizations: {
        en: {
          name: spec.englishName,
          description: spec.englishDescription,
          contentLocale: 'en',
          snapshot: {
            world_setting: {
              settings: {
                World: spec.englishWorldText,
                Starting_Point: enStart,
                Tone: enTone,
              },
              _summary: 'Built-in fallback world',
            },
            prompt_modules: {
              modules: {
                core_world_mechanics:
                  'Advance the scene strictly from the world-card data. Prioritize consistency in time, location, character state, relationships, and timeline events. If the world card does not define a rule, fill it with restrained, reasonable inference instead of inventing a large system.',
              },
              module_meta: {},
              opening_greeting:
                'You wake up with no clear answers yet. Confirm the time, the place, and the immediate danger before you decide your first move.',
              _summary: 'Default rules',
            },
            character_database: {
              [enTraveler]: {
                name: enTraveler,
                role: 'Protagonist',
                gender: 'Unknown',
                origin: 'Unknown',
                birthday: null,
                personality: enPersonality,
                background: enBackground,
                default_cognitive_state: enCognitive,
                msg_reply_tone: 'Brief, checks the situation before making a judgment',
              },
              _summary: '1 default character',
            },
            timeline: {
              events: [
                {
                  id: 'event_001',
                  time: '1.1.1',
                  location: enLocation,
                  characters: enTraveler,
                  content: `The ${enTraveler.toLowerCase()} wakes up in ${enLocation} and begins by confirming the time, the place, and the situation.`,
                },
              ],
              _summary: '1 default event',
            },
            relationship_rules: {
              [enTraveler]: {
                default: {},
                timeline: [],
              },
            },
            character_timelines: {
              [enTraveler]: {
                cognitive: [
                  {
                    year: 1,
                    month: 1,
                    day: 1,
                    state: enCognitive,
                  },
                ],
                relationships: [
                  {
                    year: 1,
                    month: 1,
                    day: 1,
                    relations: {},
                  },
                ],
                status: [
                  {
                    year: 1,
                    month: 1,
                    day: 1,
                    status: 'Independent',
                  },
                ],
              },
              _summary: '1 character timeline',
            },
            step3_fields: {
              panel_status: this._buildDefaultStatusFields(),
              panel_npc: this._buildDefaultNpcFields(),
            },
          },
        },
      },
      snapshot: {
        world_setting: {
          settings: {
            世界: spec.fallbackWorldText,
            起点: zhStart,
            基调: zhTone,
          },
          _summary: '默认内置世界',
        },
        prompt_modules: {
          modules: {
            core_world_mechanics:
              '请严格基于世界卡数据推进剧情，优先保持时间、地点、角色状态、关系和时间线事件一致。若世界卡没有明确规则，不要凭空补出复杂系统。',
          },
          module_meta: {},
          opening_greeting:
            '你醒来时还没有任何清晰答案。先确认时间、地点和眼前局势，再决定第一步。',
          _summary: '默认规则',
        },
        character_database: {
          [zhTraveler]: {
            name: zhTraveler,
            role: '主角',
            gender: '未知',
            origin: '未知',
            birthday: null,
            personality: zhPersonality,
            background: zhBackground,
            default_cognitive_state: zhCognitive,
            msg_reply_tone: '简洁，先确认情况，再表达判断',
          },
          _summary: '1 个默认角色',
        },
        timeline: {
          events: [
            {
              id: 'event_001',
              time: '1.1.1',
              location: zhLocation,
              characters: zhTraveler,
              content: `${zhTraveler}在${zhLocation}醒来，开始观察周围环境，准备先确认时间、地点和局势。`,
            },
          ],
          _summary: '1 个默认事件',
        },
        relationship_rules: {
          [zhTraveler]: {
            default: {},
            timeline: [],
          },
        },
        character_timelines: {
          [zhTraveler]: {
            cognitive: [
              {
                year: 1,
                month: 1,
                day: 1,
                state: zhCognitive,
              },
            ],
            relationships: [
              {
                year: 1,
                month: 1,
                day: 1,
                relations: {},
              },
            ],
            status: [
              {
                year: 1,
                month: 1,
                day: 1,
                status: '独立',
              },
            ],
          },
          _summary: '1 个角色时间线',
        },
        step3_fields: {
          panel_status: this._buildDefaultStatusFields(),
          panel_npc: this._buildDefaultNpcFields(),
        },
      },
      designChatHistory: [],
      designMeta: null,
    };
  }

  _readEmbeddedBuiltInCard(spec = this._getBuiltInSpec()) {
    const globalScope = typeof globalThis !== 'undefined' ? globalThis : null;
    const embedded = globalScope?.[spec?.embeddedKey];
    if (!embedded) return null;

    const cardData = embedded?.card || embedded;
    const normalized = this._normalizeBuiltInCardData(cardData, spec);
    if (!normalized) {
      console.warn(
        `[WorldCardManager] ${spec?.displayName || '内置世界卡'}内嵌数据无效，改用 JSON`
      );
      return null;
    }
    return normalized;
  }

  _isFallbackBuiltInSnapshot(snapshot, spec = this._getBuiltInSpec()) {
    const settings = snapshot?.world_setting?.settings;
    if (!settings || typeof settings !== 'object') return false;
    return settings.世界 === spec?.fallbackWorldText;
  }

  _isFallbackBuiltInCard(card, spec = this._getBuiltInSpec(card?.id)) {
    if (!card || !spec || card.id !== spec.id) return false;
    if (card.name === spec.fallbackName && card.description === spec.fallbackDescription) {
      return true;
    }
    return this._isFallbackBuiltInSnapshot(card.snapshot, spec);
  }

  _normalizeBuiltInCardData(rawCard = {}, spec = this._getBuiltInSpec()) {
    if (!spec || !rawCard || typeof rawCard !== 'object') return null;
    if (!rawCard.snapshot || typeof rawCard.snapshot !== 'object') return null;
    if (!this._hasSubstantialContent(rawCard.snapshot)) return null;

    const now = new Date().toISOString();
    const existing = this._loadCard(spec.id);
    const createdAt = this._isValidIsoString(rawCard.createdAt)
      ? rawCard.createdAt
      : this._isValidIsoString(existing?.createdAt)
        ? existing.createdAt
        : now;
    const updatedAt = this._isValidIsoString(rawCard.updatedAt) ? rawCard.updatedAt : now;

    return {
      id: spec.id,
      name:
        typeof rawCard.name === 'string' && rawCard.name.trim()
          ? rawCard.name.trim()
          : spec.fallbackName,
      description: typeof rawCard.description === 'string' ? rawCard.description : '',
      createdAt,
      updatedAt,
      isBuiltIn: true,
      isEmpty: false,
      contentLocale: this._normalizeContentLocale(rawCard.contentLocale, 'zh-CN'),
      localizations: this._normalizeCardLocalizations(rawCard.localizations),
      snapshot: this._deepClone(rawCard.snapshot),
      designChatHistory: Array.isArray(rawCard.designChatHistory)
        ? this._deepClone(rawCard.designChatHistory)
        : [],
      designMeta: rawCard.designMeta ?? null,
    };
  }

  _upsertBuiltInCardInternal(rawCardData = {}, spec = this._getBuiltInSpec(), guard = null) {
    if (guard !== BUILTIN_INTERNAL_WRITE_GUARD) {
      console.warn('[WorldCardManager] 拒绝外部调用内置卡写入方法');
      return null;
    }
    const normalized = this._normalizeBuiltInCardData(rawCardData, spec);
    if (!normalized) return null;
    this._saveCard(normalized);
    this._ensureInIndex(spec.id);
    return this._deepClone(normalized);
  }

  async _loadBuiltInCardFromJson(spec = this._getBuiltInSpec()) {
    const candidates = [spec.jsonPath, spec.jsonPath.replace(/^\//, '')];
    let lastError = null;

    for (const path of candidates) {
      try {
        const response = await fetch(path, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`读取失败(${response.status})`);
        }
        const data = await response.json();
        const cardData = data?.card || data;
        const normalized = this._normalizeBuiltInCardData(cardData, spec);
        if (!normalized) {
          throw new Error('JSON 结构无效或内容为空');
        }
        return normalized;
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) {
      throw lastError;
    }
    throw new Error(`未找到内置世界卡 JSON: ${spec.jsonPath}`);
  }

  _collectValidIndexIds() {
    const index = this._loadIndex();
    const valid = [];
    let changed = false;

    for (const id of index) {
      if (id && this._loadCard(id)) {
        valid.push(id);
      } else {
        changed = true;
      }
    }

    if (changed) {
      this._saveIndex(valid);
    }
    return valid;
  }

  _ensureBuiltInActiveWhenNeeded() {
    try {
      const stored = localStorage.getItem(this.ACTIVE_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (parsed && this._loadCard(parsed)) {
        if (this.isBuiltInCard(parsed)) {
          this.setActiveCard(parsed);
        }
        return;
      }
    } catch (_e) {
      void _e;
    }

    const candidates = [this.BUILTIN_CARD_ID];
    this.BUILTIN_CARD_SPECS.forEach(spec => {
      if (spec.id !== this.BUILTIN_CARD_ID && !candidates.includes(spec.id)) {
        candidates.push(spec.id);
      }
    });
    this._collectValidIndexIds().forEach(id => {
      if (!candidates.includes(id)) {
        candidates.push(id);
      }
    });

    for (const id of candidates) {
      const activateResult = this.setActiveCard(id);
      if (activateResult?.ok) {
        return;
      }
    }

    localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(null));
  }

  _flushPendingActivation() {
    const pendingId = this._pendingActivationId;
    if (!pendingId) return false;

    if (!this._runtimeStoresReady()) return false;

    const card = this._loadCard(pendingId);
    if (!card) {
      this._pendingActivationId = null;
      return false;
    }

    const localized = this._buildLocalizedCardView(card);
    const result = this._activateRuntime(localized.snapshot, localized.contentLocale);
    if (result && !result.ok) {
      console.warn('[WorldCardManager] 延迟 runtime 激活失败:', result.reason);
      return false;
    }

    // 世界卡切换后清除 NPC 渲染器的 Schema 缓存
    if (typeof npcCardRenderer !== 'undefined') {
      npcCardRenderer.invalidateCache();
    }

    this._pendingActivationId = null;
    return true;
  }

  /**
   * 检查三 store + worldMeta 是否就绪
   */
  _runtimeStoresReady() {
    return (
      typeof window.worldMeta !== 'undefined' &&
      typeof window.entityStore !== 'undefined' &&
      typeof window.timelineStore !== 'undefined' &&
      typeof window.npcStore !== 'undefined' &&
      typeof window.npcStore.initialize === 'function'
    );
  }

  /**
   * 激活世界卡数据到 worldMeta + 三个 store
   * @param {Object} snapshot - 世界卡快照（已本地化）
   * @param {string} contentLocale
   * @returns {{ ok: boolean, reason?: string }}
   */
  _activateRuntime(snapshot, contentLocale = 'zh-CN') {
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, reason: '数据为空，无法激活' };
    }
    if (
      !snapshot.world_setting &&
      !snapshot.prompt_modules &&
      !snapshot.character_database &&
      !snapshot.timeline &&
      !snapshot.character_timelines
    ) {
      return { ok: false, reason: '数据为空，无法激活' };
    }

    // 1) 元数据
    window.worldMeta.initialize(snapshot, contentLocale);

    // 2) 实体
    window.entityStore.initialize(snapshot.world_setting || null);

    // 3) 角色 + 关系规则
    window.npcStore.initialize(
      snapshot.character_database || null,
      snapshot.relationship_rules || null
    );

    // 4) 时间线
    window.timelineStore.initialize(snapshot.timeline || null);

    // 5) 自定义地形 / 领土注册（从 runtimeWorldStore._applyCustomTerrains 迁移）
    if (typeof resetCustomTerrains === 'function') resetCustomTerrains();
    if (typeof resetCustomTerritories === 'function') resetCustomTerritories();
    if (Array.isArray(snapshot.custom_terrains) && typeof registerTerrains === 'function') {
      registerTerrains(snapshot.custom_terrains);
    }
    if (Array.isArray(snapshot.custom_territories) && typeof registerTerritories === 'function') {
      registerTerritories(snapshot.custom_territories);
    }

    return { ok: true };
  }

  /** 清空运行时：无激活卡时调用 */
  _clearRuntime() {
    if (window.worldMeta?.clear) window.worldMeta.clear();
    if (window.entityStore?.clear) window.entityStore.clear();
    if (window.timelineStore?.clear) window.timelineStore.clear();
    if (window.npcStore?.clear) window.npcStore.clear();
    if (typeof resetCustomTerrains === 'function') resetCustomTerrains();
    if (typeof resetCustomTerritories === 'function') resetCustomTerritories();
    // 清理旧版 localStorage 残留
    try {
      localStorage.removeItem('runtime_world_store_v1');
    } catch (_e) {
      /* ignore */
    }
  }

  async _initializeSingleBuiltInCard(spec = this._getBuiltInSpec()) {
    let source = null;
    try {
      let loaded = this._readEmbeddedBuiltInCard(spec);
      if (loaded) {
        source = 'embedded';
      } else {
        loaded = await this._loadBuiltInCardFromJson(spec);
        source = 'json';
      }
      this._upsertBuiltInCardInternal(loaded, spec, BUILTIN_INTERNAL_WRITE_GUARD);
    } catch (error) {
      console.warn(
        `[WorldCardManager] ${spec?.displayName || '内置世界卡'}加载失败，尝试使用本地兜底流程:`,
        error
      );
      const existing = this._loadCard(spec.id);
      if (
        existing &&
        this._hasSubstantialContent(existing.snapshot) &&
        !this._isFallbackBuiltInCard(existing, spec)
      ) {
        this._ensureInIndex(spec.id);
      } else {
        this._upsertBuiltInCardInternal(
          this._buildFallbackBuiltInCard(spec),
          spec,
          BUILTIN_INTERNAL_WRITE_GUARD
        );
      }
    }
    return source;
  }

  async _initializeBuiltInCards() {
    const sourceMap = {};
    for (const spec of this.BUILTIN_CARD_SPECS) {
      const source = await this._initializeSingleBuiltInCard(spec);
      if (source) {
        sourceMap[spec.id] = source;
      }
    }
    this._ensureBuiltInActiveWhenNeeded();
    this._ready = true;
    Object.entries(sourceMap).forEach(([id, source]) => {
      console.log(`[WorldCardManager] 内置世界卡 ${id} 加载来源: ${source}`);
    });
  }

  /**
   * 判断 snapshot 是否有实质内容（至少一个模块有非空内容）
   * 用于导入校验和存档双写保护
   */
  _hasSubstantialContent(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const settings = snapshot.world_setting?.settings;
    if (
      settings &&
      typeof settings === 'object' &&
      Object.values(settings).some(value => this._hasMeaningfulValue(value))
    ) {
      return true;
    }
    const modules = snapshot.prompt_modules?.modules;
    if (
      modules &&
      typeof modules === 'object' &&
      Object.values(modules).some(value => typeof value === 'string' && value.trim())
    ) {
      return true;
    }
    const chars = snapshot.character_database;
    if (
      chars &&
      typeof chars === 'object' &&
      Object.entries(chars).some(
        ([key, value]) => !key.startsWith('_') && this._hasMeaningfulValue(value)
      )
    ) {
      return true;
    }
    const ct = snapshot.character_timelines;
    if (
      ct &&
      typeof ct === 'object' &&
      Object.entries(ct).some(
        ([key, value]) => !key.startsWith('_') && this._hasMeaningfulCharacterTimeline(value)
      )
    ) {
      return true;
    }
    // 时间线事件
    const events = snapshot.timeline?.events;
    if (
      Array.isArray(events) &&
      events.some(event => event && typeof event === 'object' && !Array.isArray(event))
    ) {
      return true;
    }
    // 关系规则
    const rules = snapshot.relationship_rules;
    if (
      rules &&
      typeof rules === 'object' &&
      Object.entries(rules).some(
        ([key, value]) => !key.startsWith('_') && this._hasMeaningfulRelationshipRule(value)
      )
    ) {
      return true;
    }
    return false;
  }

  _hasMeaningfulValue(value) {
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some(item => this._hasMeaningfulValue(item));
    if (value && typeof value === 'object') {
      return Object.entries(value).some(
        ([key, nested]) => !String(key).startsWith('_') && this._hasMeaningfulValue(nested)
      );
    }
    return false;
  }

  _hasMeaningfulCharacterTimeline(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const groups = ['cognitive', 'relationships', 'status'];
    return groups.some(groupKey => {
      const group = value[groupKey];
      if (Array.isArray(group)) return group.some(entry => this._hasMeaningfulValue(entry));
      return this._hasMeaningfulValue(group);
    });
  }

  _hasMeaningfulRelationshipRule(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const defaultRelations = value.default;
    const timeline = value.timeline;
    if (this._hasMeaningfulValue(defaultRelations)) return true;
    if (Array.isArray(timeline) && timeline.some(entry => this._hasMeaningfulValue(entry)))
      return true;
    return this._hasMeaningfulValue(value);
  }

  _normalizeImportedSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
    const normalized = this._deepClone(snapshot);
    const promptModules = normalized.prompt_modules;
    if (promptModules && typeof promptModules === 'object' && !Array.isArray(promptModules)) {
      if (
        !promptModules.module_meta ||
        typeof promptModules.module_meta !== 'object' ||
        Array.isArray(promptModules.module_meta)
      ) {
        promptModules.module_meta = {};
      }
    }
    return normalized;
  }

  _buildShareCardExportData(card) {
    if (!card || typeof card !== 'object') return null;
    const snapshot = this._normalizeImportedSnapshot(card.snapshot);
    if (!snapshot) return null;

    if (
      snapshot.step3_fields &&
      typeof snapshot.step3_fields === 'object' &&
      !Array.isArray(snapshot.step3_fields)
    ) {
      delete snapshot.step3_fields._source;
    }

    const localizations = this._normalizeCardLocalizations(card.localizations);
    Object.keys(localizations).forEach(locale => {
      const normalizedLocalizedSnapshot = this._normalizeImportedSnapshot(
        localizations[locale].snapshot
      );
      if (!normalizedLocalizedSnapshot) {
        delete localizations[locale];
        return;
      }
      if (
        normalizedLocalizedSnapshot.step3_fields &&
        typeof normalizedLocalizedSnapshot.step3_fields === 'object' &&
        !Array.isArray(normalizedLocalizedSnapshot.step3_fields)
      ) {
        delete normalizedLocalizedSnapshot.step3_fields._source;
      }
      localizations[locale].snapshot = normalizedLocalizedSnapshot;
    });

    return {
      name: typeof card.name === 'string' && card.name.trim() ? card.name.trim() : '未命名世界',
      description: typeof card.description === 'string' ? card.description : '',
      contentLocale: this._normalizeContentLocale(card.contentLocale, 'zh-CN'),
      localizations,
      snapshot,
    };
  }

  hasSubstantialContent(snapshot) {
    return this._hasSubstantialContent(snapshot);
  }

  prepareImportedCard(jsonData) {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    const cardData = data?.card || data;
    if (!cardData || typeof cardData !== 'object' || Array.isArray(cardData)) {
      throw new Error('缺少有效的世界卡数据');
    }

    const snapshot = this._normalizeImportedSnapshot(cardData.snapshot);
    if (!snapshot) {
      throw new Error('缺少有效的 snapshot');
    }
    if (!this._hasSubstantialContent(snapshot)) {
      throw new Error('世界卡内容为空，无法导入');
    }

    return {
      id: typeof cardData.id === 'string' && cardData.id.trim() ? cardData.id.trim() : null,
      name:
        typeof cardData.name === 'string' && cardData.name.trim()
          ? cardData.name.trim()
          : '导入的世界',
      description: typeof cardData.description === 'string' ? cardData.description : '',
      contentLocale: this._normalizeContentLocale(cardData.contentLocale, 'zh-CN'),
      localizations: this._normalizeCardLocalizations(cardData.localizations),
      snapshot,
      designChatHistory: Array.isArray(cardData.designChatHistory)
        ? this._deepClone(cardData.designChatHistory)
        : [],
      designMeta:
        cardData.designMeta === null || cardData.designMeta === undefined
          ? null
          : this._deepClone(cardData.designMeta),
      isBuiltIn: false,
    };
  }

  importPreparedCard(preparedCard) {
    if (!preparedCard || typeof preparedCard !== 'object') return null;
    if (!preparedCard.snapshot || typeof preparedCard.snapshot !== 'object') return null;
    // 旧版导出文件的 designChatHistory 可能含错误消息或游戏开场白污染——
    // 通过 DesignService 软调用过滤一遍；服务未注册时降级为不过滤
    const ds = typeof window !== 'undefined' ? window.designService : null;
    const filterFn =
      ds && typeof ds._filterPersistableHistory === 'function'
        ? h => ds._filterPersistableHistory(h)
        : h => (Array.isArray(h) ? h : []);
    return this.create(
      preparedCard.name || '导入的世界',
      preparedCard.snapshot,
      preparedCard.description || '',
      {
        contentLocale: preparedCard.contentLocale,
        localizations: preparedCard.localizations,
        designChatHistory: Array.isArray(preparedCard.designChatHistory)
          ? this._deepClone(filterFn(preparedCard.designChatHistory))
          : [],
        designMeta:
          preparedCard.designMeta === null || preparedCard.designMeta === undefined
            ? null
            : this._deepClone(preparedCard.designMeta),
      }
    );
  }

  ensureReady() {
    return this._readyPromise || Promise.resolve();
  }

  isReady() {
    return this._ready === true;
  }

  isBuiltInCard(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return false;
    if (normalizedId === this.BUILTIN_CARD_ID) return true;
    const card = this._loadCard(normalizedId);
    return card?.isBuiltIn === true;
  }

  /**
   * 确保指定 ID 在 index 中
   */
  _ensureInIndex(id) {
    const index = this._loadIndex();
    if (!index.includes(id)) {
      index.push(id);
      this._saveIndex(index);
    }
  }

  _isReusableBlankCard(card) {
    if (!card || typeof card !== 'object') return false;
    if (card.isEmpty !== true) return false;
    if (this._hasSubstantialContent(card.snapshot)) return false;
    const hasDesignHistory =
      Array.isArray(card.designChatHistory) && card.designChatHistory.length > 0;
    if (hasDesignHistory) return false;
    if (card.designMeta !== null && card.designMeta !== undefined) return false;
    return true;
  }

  // ========================================
  // 读取接口
  // ========================================

  /**
   * 获取完整世界卡（含 snapshot）
   * @param {string} id - 世界卡 ID
   * @returns {object|null}
   */
  get(id) {
    const card = this._loadCard(id);
    return card ? this._deepClone(card) : null;
  }

  getLocalizedCard(id, locale = null) {
    const card = this._loadCard(id);
    return card ? this._buildLocalizedCardView(card, locale) : null;
  }

  /**
   * 获取所有世界卡的元数据列表（不含 snapshot，轻量）
   * @returns {Array<object>}
   */
  list() {
    const result = [];
    const locale = this._resolveRequestedLocale();
    for (const id of this._loadIndex()) {
      const card = this._loadCard(id);
      if (card) {
        const view = this._buildLocalizedCardView(card, locale) || card;
        result.push({
          id: card.id,
          name: view.name,
          description: view.description || '',
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          isBuiltIn: card.isBuiltIn === true,
          contentLocale: view.contentLocale || this._normalizeContentLocale(card.contentLocale),
        });
      }
    }
    return result;
  }

  /**
   * 获取当前激活的世界卡 ID
   * @returns {string}
   */
  getActiveCardId() {
    try {
      const stored = localStorage.getItem(this.ACTIVE_KEY);
      if (stored) {
        const id = JSON.parse(stored);
        if (id && this._loadCard(id)) {
          return id;
        }
        if (id) {
          console.warn(`[WorldCardManager] 已存储的激活卡 ${id} 不存在，回退`);
        }
      }
    } catch (_e) {
      void _e;
    }
    // 回退到 index 中第一张有效卡，无卡返回 null
    const validIndex = this._collectValidIndexIds();
    return validIndex.length > 0 ? validIndex[0] : null;
  }

  /**
   * 获取当前激活的完整世界卡
   * @returns {object}
   */
  getActiveCard() {
    return this.getLocalizedCard(this.getActiveCardId());
  }

  getActiveCardRaw() {
    return this.get(this.getActiveCardId());
  }

  getActiveContentLocale() {
    const card = this.getActiveCard();
    return card?.contentLocale || 'zh-CN';
  }

  // ========================================
  // CRUD
  // ========================================

  /**
   * 创建空白世界卡（用于新建世界设计流程）
   * 带 isEmpty: true 标志，设计完成后由 designService 清除该标志
   * @returns {object|null}
   */
  createBlank() {
    const id = this._generateId();
    const now = new Date().toISOString();
    const isEnglish = this._resolveRequestedLocale() === 'en';
    const card = {
      id,
      name: isEnglish ? 'New World' : '新世界',
      description: '',
      createdAt: now,
      updatedAt: now,
      isBuiltIn: false,
      isEmpty: true,
      contentLocale: this._resolveRequestedLocale(),
      localizations: {},
      snapshot: {},
      designChatHistory: [],
      designMeta: null,
    };
    try {
      this._saveCard(card);
      const index = this._loadIndex();
      index.push(id);
      this._saveIndex(index);
    } catch (e) {
      try {
        this._removeCard(id);
      } catch (_) {
        void _;
      }
      console.error('[WorldCardManager] 创建空白卡失败（存储空间不足）:', e);
      return null;
    }
    return this._deepClone(card);
  }

  /**
   * 复用可用的空白世界卡（优先最新）
   * @returns {object|null}
   */
  findReusableBlankCard() {
    const index = this._loadIndex().slice().reverse();
    for (const id of index) {
      const card = this._loadCard(id);
      if (!this._isReusableBlankCard(card)) continue;
      return this._deepClone(card);
    }
    return null;
  }

  /**
   * 创建自定义世界卡
   * @param {string} name - 世界卡名称
   * @param {object} snapshot - 世界数据快照
   * @param {string} [description=''] - 描述
   * @param {object} [options={}] - 可选项 { designChatHistory?, designMeta?, allowEmptySnapshot? }
   * @returns {object|null} 创建的卡片（失败返回 null）
   */
  create(name, snapshot, description = '', options = {}) {
    const normalizedSnapshot = this._deepClone(snapshot);
    const allowEmptySnapshot = options.allowEmptySnapshot === true;
    if (!allowEmptySnapshot && !this._hasSubstantialContent(normalizedSnapshot)) {
      if (typeof showToast === 'function') {
        showToast('创建世界卡失败：内容为空');
      }
      return null;
    }
    const id = this._generateId();
    const now = new Date().toISOString();
    const card = {
      id,
      name: name || '未命名世界',
      description: description || '',
      createdAt: now,
      updatedAt: now,
      isBuiltIn: false,
      contentLocale: this._normalizeContentLocale(
        options.contentLocale,
        this._resolveRequestedLocale()
      ),
      localizations: this._normalizeCardLocalizations(options.localizations),
      snapshot: normalizedSnapshot,
      designChatHistory: Array.isArray(options.designChatHistory) ? options.designChatHistory : [],
      designMeta: options.designMeta || null,
    };

    try {
      this._saveCard(card);
      const index = this._loadIndex();
      index.push(id);
      this._saveIndex(index);
    } catch (e) {
      try {
        this._removeCard(id);
      } catch (_) {
        void _;
      }
      console.error('[WorldCardManager] 创建失败（存储空间不足）:', e);
      if (typeof showToast === 'function') {
        showToast('创建世界卡失败：存储空间不足');
      }
      return null;
    }
    return this._deepClone(card);
  }

  /**
   * 更新世界卡（包括预装卡）
   * @param {string} id - 世界卡 ID
   * @param {object} updates - 要更新的字段 { name?, description?, snapshot?, designChatHistory?, designMeta? }
   * @param {object} [options={}] - 可选项 { allowEmptySnapshot?: boolean, suppressRuntimeActivation?: boolean }
   * @returns {object|null} 更新后的卡片
   */
  update(id, updates, options = {}) {
    const card = this._loadCard(id);
    if (!card) return null;
    if (this.isBuiltInCard(id)) {
      if (typeof showToast === 'function') {
        showToast('内置世界卡不可修改');
      }
      return null;
    }

    if (updates.name !== undefined) card.name = updates.name;
    if (updates.description !== undefined) card.description = updates.description;
    if (updates.contentLocale !== undefined) {
      card.contentLocale = this._normalizeContentLocale(updates.contentLocale, card.contentLocale);
    }
    if (updates.localizations !== undefined) {
      card.localizations = this._normalizeCardLocalizations(updates.localizations);
    }
    if (updates.snapshot !== undefined) {
      const nextSnapshot = this._deepClone(updates.snapshot);
      const hasSubstantialContent = this._hasSubstantialContent(nextSnapshot);
      const allowEmptySnapshot = options.allowEmptySnapshot === true;
      if (!allowEmptySnapshot && !hasSubstantialContent) {
        if (typeof showToast === 'function') {
          showToast('更新世界卡失败：内容为空');
        }
        return null;
      }
      const targetLocale = this._normalizeContentLocale(
        updates.localizedContentLocale,
        card.contentLocale
      );
      this._updateCardContentForLocale(card, nextSnapshot, targetLocale, {
        name: updates.localizedName,
        description: updates.localizedDescription,
      });
      card.isEmpty = !hasSubstantialContent;
    }
    if (updates.designChatHistory !== undefined)
      card.designChatHistory = Array.isArray(updates.designChatHistory)
        ? updates.designChatHistory
        : [];
    if (updates.designMeta !== undefined) card.designMeta = updates.designMeta;
    card.updatedAt = new Date().toISOString();

    try {
      this._saveCard(card);
    } catch (e) {
      console.error('[WorldCardManager] 更新失败（存储空间不足）:', e);
      return null;
    }

    // 如果是当前激活卡且更新了 snapshot，热更新三个 store + worldMeta
    if (
      updates.snapshot &&
      this.getActiveCardId() === id &&
      options.suppressRuntimeActivation !== true
    ) {
      if (this._runtimeStoresReady()) {
        const localized = this._buildLocalizedCardView(card);
        this._activateRuntime(localized.snapshot, localized.contentLocale);
        if (typeof npcCardRenderer !== 'undefined') {
          npcCardRenderer.invalidateCache();
        }
      }
    }
    return this._deepClone(card);
  }

  /**
   * 删除世界卡
   * @param {string} id - 世界卡 ID
   * @returns {boolean}
   */
  delete(id) {
    if (this.isBuiltInCard(id)) {
      if (typeof showToast === 'function') {
        showToast('内置世界卡不可删除');
      }
      return false;
    }
    // 如果删除的是激活卡，先切换到其他卡
    if (this.getActiveCardId() === id) {
      const index = this._loadIndex().filter(i => i !== id);
      if (index.length > 0) {
        this.setActiveCard(index[0]);
      } else {
        // 无其他卡：先清空激活状态，种子化后再激活
        localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(null));
      }
    }
    this._removeCard(id);
    const index = this._loadIndex().filter(i => i !== id);
    this._saveIndex(index);

    // 删除后无卡：清空激活状态和运行时缓存
    if (index.length === 0) {
      localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(null));
      this._clearRuntime();
    }
    return true;
  }

  // ========================================
  // 激活管理
  // ========================================

  /**
   * 设置激活的世界卡
   * @param {string|null} id - 世界卡 ID，null 切换到第一张可用卡
   * @returns {{ ok: boolean, reason?: string }}
   */
  setActiveCard(id) {
    // null → 取 index 中第一张卡，无卡则清空激活并返回
    if (!id) {
      const index = this._loadIndex();
      id = index.length > 0 ? index[0] : null;
      if (!id) {
        this._pendingActivationId = null;
        localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(null));
        return { ok: true };
      }
    }
    const card = this._loadCard(id);
    if (!card) {
      console.warn('[WorldCardManager] 卡片不存在:', id);
      return { ok: false, reason: '卡片不存在' };
    }
    // 空白卡允许被激活：仅切换当前卡，并清空 runtime 快照
    const isEmptyCard = card.isEmpty === true || !this._hasSubstantialContent(card.snapshot);
    if (isEmptyCard) {
      this._pendingActivationId = null;
      localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(id));
      this._clearRuntime();
      return { ok: true };
    }
    // 激活 runtime（worldMeta + entityStore + npcStore + timelineStore）
    if (!this._runtimeStoresReady()) {
      this._pendingActivationId = id;
      localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(id));
      return { ok: true };
    }

    const localized = this._buildLocalizedCardView(card);
    const result = this._activateRuntime(localized.snapshot, localized.contentLocale);
    if (result && !result.ok) {
      console.warn('[WorldCardManager] runtime 激活失败:', result.reason);
      return { ok: false, reason: result.reason || 'runtime 激活失败' };
    }
    // 世界卡切换后清除 NPC 渲染器的 Schema 缓存
    if (typeof npcCardRenderer !== 'undefined') {
      npcCardRenderer.invalidateCache();
    }
    this._pendingActivationId = null;
    localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(id));
    return { ok: true };
  }

  // ========================================
  // 导出 / 导入
  // ========================================

  /**
   * 导出世界卡为 JSON 文件（分享版）
   * @param {string} id - 世界卡 ID
   */
  exportCard(id) {
    if (this.isBuiltInCard(id)) {
      if (typeof showToast === 'function') {
        showToast('内置世界卡不可导出');
      }
      return;
    }
    const card = this.get(id);
    if (!card) {
      console.warn('[WorldCardManager] 导出失败：卡片不存在');
      return;
    }
    const shareCard = this._buildShareCardExportData(card);
    if (!shareCard) {
      console.warn('[WorldCardManager] 导出失败：世界卡数据无效');
      if (typeof showToast === 'function') {
        showToast('导出失败：世界卡数据无效');
      }
      return;
    }
    const blob = new Blob([JSON.stringify(shareCard, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (card.name || 'world').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    a.download = `worldcard_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 导入世界卡（从 JSON 数据）
   * @param {string|object} jsonData - JSON 字符串或已解析对象
   * @returns {object|null} 导入创建的卡片
   */
  importCard(jsonData) {
    try {
      const preparedCard = this.prepareImportedCard(jsonData);
      return this.importPreparedCard(preparedCard);
    } catch (e) {
      console.error('[WorldCardManager] 导入失败:', e);
      if (typeof showToast === 'function') {
        showToast('导入世界卡失败: ' + e.message);
      }
      return null;
    }
  }
}

window.worldCardManager = new WorldCardManager();
console.log(
  '[WorldCardManager] 初始化完成, activeCard=',
  window.worldCardManager.getActiveCardId()
);
