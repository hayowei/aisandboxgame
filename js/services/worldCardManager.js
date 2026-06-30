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
    // IDB meta 迁移标记键（存在 worldCardStore 的 meta store，不落 localStorage）
    this.MIGRATION_FLAG_KEY = 'worldcard_idb_migrated_v1';
    this.BUILTIN_CARD_ID = BUILTIN_DEFAULT_CARD_ID;
    this.BUILTIN_CARD_SPECS = BUILTIN_CARD_SPECS;
    this._pendingActivationId = null;
    this._ready = false;
    // 内存缓存（单一读源）：所有公开方法的读从这里同步返回，写同步更新这里 + 异步落后端。
    this._cardCache = new Map(); // id → 原始卡对象（权威内存副本）
    this._index = []; // 有序卡 id 列表
    this._activeId = null; // 当前激活卡 id（或 null）
    this._useIDB = false; // probe 成功后置 true：写 IDB 主库；否则只走 localStorage 后备
    // 同步从 localStorage 预热缓存：构造后立即有同步 getActiveCardId 调用（见文件末尾），
    // 此时 _readyPromise 尚未 resolve，IDB 也未装载——预热保证此刻同步读与迁移前行为持平。
    this._prewarmFromLocalStorage();
    this._readyPromise = this._initializeBuiltInCards();
  }

  // 同步从 localStorage 装载 index / 所有卡 / active 进内存缓存（构造期，无异步）。
  // 扫描所有 world_card_* 卡片键（含不在 index 里的孤儿），匹配旧 _loadCard 的可达性。
  _prewarmFromLocalStorage() {
    try {
      const rawIndex = localStorage.getItem(this.INDEX_KEY);
      const ids = rawIndex ? JSON.parse(rawIndex) : [];
      this._index = Array.isArray(ids) ? ids.slice() : [];
    } catch (_e) {
      this._index = [];
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(this.CARD_KEY_PREFIX)) continue;
        // INDEX_KEY / ACTIVE_KEY 也以 world_card_ 开头，必须排除，否则会被当成卡
        if (key === this.INDEX_KEY || key === this.ACTIVE_KEY) continue;
        const id = key.slice(this.CARD_KEY_PREFIX.length);
        try {
          const raw = localStorage.getItem(key);
          if (raw) this._cardCache.set(id, JSON.parse(raw));
        } catch (e) {
          console.error(`[WorldCardManager] 预热卡片 ${id} 数据损坏:`, e);
        }
      }
    } catch (_e) {
      void _e;
    }
    try {
      const rawActive = localStorage.getItem(this.ACTIVE_KEY);
      this._activeId = rawActive ? JSON.parse(rawActive) : null;
    } catch (_e) {
      this._activeId = null;
    }
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

  _buildLocalizedCardView(rawCard, locale = null, opts = null) {
    if (!rawCard || typeof rawCard !== 'object') return null;
    const requestedLocale = this._resolveRequestedLocale(locale);
    const baseContentLocale = this._normalizeContentLocale(rawCard.contentLocale, 'zh-CN');
    const localizations = this._normalizeCardLocalizations(rawCard.localizations);
    const localizedEntry = localizations[requestedLocale] || null;

    const name = localizedEntry?.name || rawCard.name || '';
    const description = localizedEntry?.description || rawCard.description || '';
    const snapshot = localizedEntry?.snapshot || rawCard.snapshot || {};
    const resolvedLocale = localizedEntry?.contentLocale || baseContentLocale;

    const view = {
      ...this._deepClone(rawCard),
      name,
      description,
      snapshot: this._deepClone(snapshot),
      contentLocale: resolvedLocale,
      baseContentLocale,
      localizations,
      resolvedLocale,
    };
    // 走翻译链（V1 → V2 → …）保证 runtime / worldMeta / UI 等下游 consumer 只看到当前形态。
    // 详 内部设计文档 · D3 集中适配器。
    // opts.skipMigrate 给 list() 这种"只读 name/desc/locale 不读 snapshot"的轻量调用方用，省一次 migrate 开销。
    if (opts && opts.skipMigrate) return view;
    return this._maybeMigrate(view);
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
    // UCID 随机段：10 位 base36。拼两次 Math.random 再切，保证恒满 10 位
    //（单次 .slice(2,12) 偶尔因尾零截断而不足 10 位）。老卡的旧 6 位 id 不受影响、永不改。
    return (
      'wc_custom_' +
      Date.now() +
      '_' +
      (Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 10)
    );
  }

  /**
   * V2 manifest 块生成。详见 内部设计文档
   * @param {object} opts
   * @param {string} opts.cardId - 卡 ID，写入 manifest.card_id（与 card.id 镜像）
   * @param {'builtin'|'user_created'|'imported'|'marketplace'} opts.source
   * @param {string} [opts.createdAt] - ISO 8601 UTC；省略时取当前时间
   * @param {string} [opts.authorDisplayName] - 省略时尝试读 accountStore；未登录回落空字符串
   * @param {string|null} [opts.authorUid] - 省略时尝试读 accountStore；未登录回落 null
   */
  _buildManifest(opts = {}) {
    const cardId = typeof opts.cardId === 'string' ? opts.cardId : '';
    const source = opts.source || 'user_created';
    const createdAt = this._isValidIsoString(opts.createdAt)
      ? opts.createdAt
      : new Date().toISOString();
    let authorDisplayName = '';
    let authorUid = null;
    if (typeof opts.authorDisplayName === 'string') {
      authorDisplayName = opts.authorDisplayName;
    } else {
      try {
        const accountStore = typeof window !== 'undefined' ? window.accountStore : null;
        const state = accountStore?.getState?.();
        if (state && typeof state.displayName === 'string') {
          authorDisplayName = state.displayName;
        }
      } catch (_) {
        void _;
      }
    }
    if (opts.authorUid !== undefined) {
      authorUid = opts.authorUid;
    } else {
      try {
        const accountStore = typeof window !== 'undefined' ? window.accountStore : null;
        const state = accountStore?.getState?.();
        if (state && state.userId != null) {
          const u5id = typeof window !== 'undefined' ? window.U5ID : null;
          const encoded = u5id?.encode ? u5id.encode(state.userId) : null;
          authorUid = encoded || String(state.userId);
        }
      } catch (_) {
        void _;
      }
    }
    return {
      card_id: cardId,
      schema_version: 2,
      source,
      created_at: createdAt,
      author_display_name: authorDisplayName,
      author_uid: authorUid,
    };
  }

  /**
   * 容错读取已存在卡的 manifest。
   * 用于导入时沿用原作者署名（author_display_name / author_uid）。
   * V1 老卡返回 null（无 manifest 字段）。
   */
  _extractIncomingManifest(rawCard) {
    if (!rawCard || typeof rawCard !== 'object') return null;
    const m = rawCard.manifest;
    if (!m || typeof m !== 'object') return null;
    return m;
  }

  // ---- 存储原语：读从内存缓存同步返回，写同步更新缓存 + fire-and-forget 异步落后端 ----
  // 缓存是单一读源，所以公开方法的同步性不变；后端（IDB 主库 + localStorage 影子）由 _persist* 处理。

  _loadIndex() {
    // 返回副本：旧实现每次 JSON.parse 出新数组，调用方不依赖 live 引用
    return Array.isArray(this._index) ? this._index.slice() : [];
  }

  _saveIndex(ids) {
    this._index = Array.isArray(ids) ? ids.slice() : [];
    this._persistIndex();
  }

  _loadCard(id) {
    // 要点 A：读时克隆。旧实现返回 JSON.parse 的新对象，多处依赖"拿到独立副本后原地 mutate 再 _saveCard"
    // （update / _backfillMissingSchemaVersionStamp）。返回共享引用会在落盘前污染缓存且写失败无法回滚。
    const card = this._cardCache.get(id);
    return card ? this._deepClone(card) : null;
  }

  _saveCard(card) {
    if (!card || !card.id) return;
    // 要点 A：写时克隆，切断外部对缓存内对象的后续引用
    this._cardCache.set(card.id, this._deepClone(card));
    this._persistCard(card.id);
  }

  _removeCard(id) {
    this._cardCache.delete(id);
    this._persistRemoveCard(id);
  }

  _loadActiveId() {
    return this._activeId != null ? this._activeId : null;
  }

  _saveActiveId(id) {
    this._activeId = id != null ? id : null;
    this._persistActiveId();
  }

  // ---- 持久化助手：localStorage 影子始终写（IDB 不可用后备 + 回滚保险），IDB 可用时另写主库 ----

  _persistCard(id) {
    const card = this._cardCache.get(id) || null;
    if (!card) return;
    try {
      localStorage.setItem(this.CARD_KEY_PREFIX + id, JSON.stringify(card));
    } catch (e) {
      // 存储被禁 / 配额满 → 影子写失败不致命（IDB 已是主库）；不让 boot 初始化抛错
      console.warn('[WorldCardManager] 影子写卡失败（不致命）:', id, e);
    }
    if (this._useIDB && window.worldCardStore) {
      window.worldCardStore
        .putCard(id, card)
        .catch(e => console.warn('[WorldCardManager] IDB putCard 失败:', id, e));
    }
  }

  _persistRemoveCard(id) {
    try {
      localStorage.removeItem(this.CARD_KEY_PREFIX + id);
    } catch (_e) {
      void _e;
    }
    if (this._useIDB && window.worldCardStore) {
      window.worldCardStore
        .deleteCard(id)
        .catch(e => console.warn('[WorldCardManager] IDB deleteCard 失败:', id, e));
    }
  }

  _persistIndex() {
    try {
      localStorage.setItem(this.INDEX_KEY, JSON.stringify(this._index));
    } catch (e) {
      console.warn('[WorldCardManager] 影子写 index 失败（不致命）:', e);
    }
    if (this._useIDB && window.worldCardStore) {
      window.worldCardStore
        .putMeta('index', this._index.slice())
        .catch(e => console.warn('[WorldCardManager] IDB putMeta(index) 失败:', e));
    }
  }

  _persistActiveId() {
    try {
      localStorage.setItem(this.ACTIVE_KEY, JSON.stringify(this._activeId));
    } catch (e) {
      console.warn('[WorldCardManager] 影子写 active 失败（不致命）:', e);
    }
    if (this._useIDB && window.worldCardStore) {
      window.worldCardStore
        .putMeta('active', this._activeId)
        .catch(e => console.warn('[WorldCardManager] IDB putMeta(active) 失败:', e));
    }
  }

  // ---- IDB 接入：probe → 一次性迁移（localStorage→IDB）→ 从 IDB 装载覆盖内存缓存 ----

  async _initStorageBackend() {
    const store = window.worldCardStore;
    let idbReady = false;
    try {
      idbReady = !!(
        store &&
        typeof store.isAvailable === 'function' &&
        store.isAvailable() &&
        (await store.probe())
      );
    } catch (_e) {
      idbReady = false;
    }
    this._useIDB = idbReady;
    if (!idbReady) {
      // 降级：缓存就用构造时 localStorage 预热值，写入只走 localStorage（世界卡文字小，后备完整可用）
      console.warn('[WorldCardManager] IndexedDB 不可用，世界卡回退 localStorage 模式');
      return;
    }
    try {
      await this._migrateLocalStorageToIDB();
      await this._loadAllFromIDB();
    } catch (e) {
      console.error('[WorldCardManager] IDB 装载/迁移失败，继续以已预热的内存缓存运行:', e);
    }
  }

  // 一次性把预热进缓存的（来自 localStorage 的）所有卡 + index + active 写进 IDB。
  // 抄存档迁移纪律：写 → 读回校验 → 写 flag。但"只写不删"——localStorage 老键全部保留作影子+后备。
  async _migrateLocalStorageToIDB() {
    const store = window.worldCardStore;
    const flag = await store.getMeta(this.MIGRATION_FLAG_KEY);
    if (flag) return; // 幂等：迁过就不再扫
    let migrated = 0;
    let failed = 0;
    for (const [id, card] of this._cardCache.entries()) {
      if (!card) continue;
      try {
        await store.putCard(id, card);
        const echo = await store.getCard(id);
        if (echo && echo.id === card.id) migrated++;
        else failed++;
      } catch (e) {
        console.warn('[WorldCardManager] 迁移卡片失败:', id, e);
        failed++;
      }
    }
    try {
      await store.putMeta('index', this._index.slice());
      await store.putMeta('active', this._activeId);
    } catch (e) {
      console.warn('[WorldCardManager] 迁移 index/active 失败:', e);
    }
    // flag 最后才写：中途崩溃则下次重跑（因只写不删，重跑幂等无损）
    await store.putMeta(this.MIGRATION_FLAG_KEY, {
      at: new Date().toISOString(),
      migrated,
      failed,
    });
    console.log(`[WorldCardManager] localStorage→IDB 迁移完成: ${migrated} 张，失败 ${failed}`);
  }

  // 从 IDB 整体装载 index + 所有卡 + active，覆盖内存缓存（IDB 为权威源）
  async _loadAllFromIDB() {
    const store = window.worldCardStore;
    const cards = await store.getAllCards();
    const idxMeta = await store.getMeta('index');
    const activeMeta = await store.getMeta('active');
    const nextCache = new Map();
    for (const card of cards) {
      if (card && card.id) nextCache.set(card.id, card);
    }
    this._cardCache = nextCache;
    if (Array.isArray(idxMeta)) this._index = idxMeta.slice();
    if (activeMeta !== null && activeMeta !== undefined) this._activeId = activeMeta;
  }

  _isValidIsoString(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed);
  }

  _buildDefaultStatusFields() {
    const locale = this._resolveRequestedLocale() === 'en' ? 'en' : 'zh-CN';
    // panelFieldDefaults.js loads before this file in index.html
    if (globalThis?.panelFieldDefaults?.getDefaultStatusFields) {
      return globalThis.panelFieldDefaults.getDefaultStatusFields(locale);
    }
    // Defensive fallback (should not hit in normal page load)
    return [];
  }

  _buildDefaultNpcFields() {
    const locale = this._resolveRequestedLocale() === 'en' ? 'en' : 'zh-CN';
    if (globalThis?.panelFieldDefaults?.getDefaultNpcFields) {
      return globalThis.panelFieldDefaults.getDefaultNpcFields(locale);
    }
    // Defensive fallback (should not hit in normal page load)
    return [];
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
            world_timeline: {
              events: [
                {
                  id: 'event_001',
                  time: '1.1.1',
                  location: enLocation,
                  characters: enTraveler,
                  content: `The ${enTraveler.toLowerCase()} wakes up in ${enLocation} and begins by confirming the time, the place, and the situation.`,
                  entity_refs: [],
                  character_refs: [],
                },
              ],
              _summary: '1 default event',
            },
            panel_fields: {
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
        world_timeline: {
          events: [
            {
              id: 'event_001',
              time: '1.1.1',
              location: zhLocation,
              characters: zhTraveler,
              content: `${zhTraveler}在${zhLocation}醒来，开始观察周围环境，准备先确认时间、地点和局势。`,
              entity_refs: [],
              character_refs: [],
            },
          ],
          _summary: '1 个默认事件',
        },
        panel_fields: {
          panel_status: this._buildDefaultStatusFields(),
          panel_npc: this._buildDefaultNpcFields(),
        },
      },
      designChatHistory: [],
      p3ChatHistory: [],
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

    // V2 manifest：优先用 JSON 里写好的 manifest；缺失时按 spec 数据兜底
    const rawManifest = this._extractIncomingManifest(rawCard);
    const manifest = this._buildManifest({
      cardId: spec.id,
      source: 'builtin',
      createdAt:
        rawManifest && this._isValidIsoString(rawManifest.created_at)
          ? rawManifest.created_at
          : createdAt,
      authorDisplayName:
        rawManifest && typeof rawManifest.author_display_name === 'string'
          ? rawManifest.author_display_name
          : '官方',
      authorUid:
        rawManifest && rawManifest.author_uid !== undefined ? rawManifest.author_uid : 'official',
    });

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
      p3ChatHistory: Array.isArray(rawCard.p3ChatHistory)
        ? this._deepClone(rawCard.p3ChatHistory)
        : [],
      designMeta: rawCard.designMeta ?? null,
      manifest,
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

  // v3.9 修复追溯：v3.9 上线到"设计产出盖 _schema_version 戳"修复部署之间，设计模式
  // 新建的卡落盘时缺格式戳，读回被当成 V1 锁住编辑（见 _validateSnapshotBeforePersist 的盖戳）。
  // 这里在 init 时一次性给这些卡补戳并写回硬盘。判据严格限定 manifest.source === 'user_created'
  // （= 本机设计模式建的、产出必为原生 V2）：
  //   - 导入的真 V1 老卡 source='imported' → 不碰，保持 V1 锁定（兼容承诺）
  //   - 更老的无 manifest 老卡 → manifest 缺失，跳过
  //   - 内置卡不在用户 index 里，且本就带戳
  // 幂等：补过的卡下次已带戳，自动跳过。
  _backfillMissingSchemaVersionStamp() {
    let healed = 0;
    try {
      const stampVersion =
        (typeof window !== 'undefined' && window.cardSchemaVersion?.CURRENT) || 2;
      for (const id of this._loadIndex()) {
        const card = this._loadCard(id);
        if (!card || card.isBuiltIn === true) continue;
        if (!card.manifest || card.manifest.source !== 'user_created') continue;
        const snap = card.snapshot;
        if (!snap || typeof snap !== 'object') continue;
        if (typeof snap._schema_version === 'number' && snap._schema_version >= 2) continue;
        // 带 _origin_schema_version 的说明它真被判过 V1（迁移不写回硬盘，理论上盘上不会有）——
        // 保险起见不碰，避免误把真 V1 卡解锁。
        if (typeof snap._origin_schema_version === 'number') continue;
        snap._schema_version = stampVersion;
        try {
          this._saveCard(card);
          healed++;
        } catch (e) {
          console.warn(`[WorldCardManager] 补 V2 格式戳写回失败 ${id}:`, e);
        }
      }
    } catch (e) {
      console.warn('[WorldCardManager] _backfillMissingSchemaVersionStamp 扫描失败:', e);
    }
    if (healed > 0) {
      console.log(
        `[WorldCardManager] 已为 ${healed} 张缺格式戳的本机世界卡补上 V2 标记（v3.9 修复追溯）`
      );
    }
  }

  _ensureBuiltInActiveWhenNeeded() {
    const parsed = this._loadActiveId();
    if (parsed && this._loadCard(parsed)) {
      if (this.isBuiltInCard(parsed)) {
        this.setActiveCard(parsed);
      }
      return;
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

    this._saveActiveId(null);
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
    // localized 已跑过 migrate，p1Output 走 localized 的（V1 卡的 player_anchor / frozen_moment
    // 已被翻译进 designMeta.p1Output），而不是 raw card 的 designMeta.p1Output（V1 卡可能为空）。
    const result = this._activateRuntime(
      localized.snapshot,
      localized.contentLocale,
      localized?.designMeta?.p1Output || null
    );
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
   * @param {Object} [p1Output=null] - Phase 1 创作者框架（card.designMeta.p1Output），供 worldMeta.getFrozenMoment 等读取
   * @returns {{ ok: boolean, reason?: string }}
   */
  _activateRuntime(snapshot, contentLocale = 'zh-CN', p1Output = null) {
    if (!snapshot || typeof snapshot !== 'object') {
      return { ok: false, reason: '数据为空，无法激活' };
    }
    if (
      !snapshot.world_setting &&
      !snapshot.prompt_modules &&
      !snapshot.character_database &&
      !snapshot.world_timeline &&
      !snapshot.timeline &&
      !snapshot.character_timelines
    ) {
      return { ok: false, reason: '数据为空，无法激活' };
    }

    // 1) 元数据
    window.worldMeta.initialize(snapshot, contentLocale, p1Output);

    // 2) 实体（传 character_database：V2 实体 narrative_core_characters 是角色 ID，渲染 markdown 时解析回姓名）
    window.entityStore.initialize(snapshot.world_setting || null, snapshot.character_database || null);

    // 3) 角色 + 关系规则（relationship_rules 仅老卡兼容）
    window.npcStore.initialize(
      snapshot.character_database || null,
      snapshot.relationship_rules || null
    );

    // 4) 世界时间线（优先新字段 world_timeline；老卡 timeline 兜底）
    window.timelineStore.initialize(snapshot.world_timeline || snapshot.timeline || null);

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

  /**
   * 原局热更新世界卡专用：_activateRuntime 的「保会话」包装。
   *
   * 背景：_activateRuntime 对 npc/entity/timeline 三个 ServiceRegistry store 全调
   * initialize() = 全清后按新 snapshot 重种。读档/开新游戏/切卡走这条是对的
   * （之后跟 ServiceRegistry.restoreAll，或本就该空）。但「原局改世界卡」这条路
   * 之后不经过 restoreAll，紧跟的 design_apply autosave 会把空状态写回存档，
   * 玩家本局积累（已登场 NPC / update_new_world 扩展实体 / 时间线积累）永久丢失。
   *
   * 对称化：重建前快照三个 store，重建后整份 restore 回去 —— 语义等价于
   * 「改完世界卡 = 重读了一次本局存档」（预定义内容改动本局不回溯生效，
   * 只保本局积累与世界一致性；prompt 规则模块等仍经 worldMeta 取新值）。
   * 仅当本局确有积累（已登场 NPC / expanded 实体 / expanded 时间线事件或概述）
   * 时回填；否则（尚未开局就改卡）让新 snapshot 正常种入，不被旧内容盖回。
   */
  _activateRuntimePreservingSession(snapshot, contentLocale = 'zh-CN', p1Output = null) {
    let snapNpc = null;
    let snapEnt = null;
    let snapTl = null;
    try {
      snapNpc = window.npcStore?.getData?.() || null;
    } catch (_e) {
      snapNpc = null;
    }
    try {
      snapEnt = window.entityStore?.getSaveData?.() || null;
    } catch (_e) {
      snapEnt = null;
    }
    try {
      snapTl = window.timelineStore?.getSaveData?.() || null;
    } catch (_e) {
      snapTl = null;
    }

    const inProgress =
      (!!snapNpc && Object.keys(snapNpc.npcData || {}).length > 0) ||
      (!!snapEnt &&
        Object.values(snapEnt.entities || {}).some(e => e && e.origin === 'expanded')) ||
      (!!snapTl &&
        ((Array.isArray(snapTl.events) &&
          snapTl.events.some(e => e && e.origin === 'expanded')) ||
          (typeof snapTl.summary === 'string' && snapTl.summary.trim() !== '')));

    // 改世界卡前先记下旧货币名（此刻 worldMeta 仍是旧卡）；_activateRuntime 后比对新名，把本局余额
    // 从旧 key 迁到新名，避免「作者改了货币名 → 正在玩的存档余额显示 0」。inventory 不在 npc/entity/
    // timeline 的快照回填之列——它本就不被 _activateRuntime 清空，原 key 余额仍在内存。
    let oldCurrencyLabel = null;
    try {
      oldCurrencyLabel = window.inventoryStore?.getCurrencyLabel?.() || null;
    } catch (_e) {
      oldCurrencyLabel = null;
    }

    const result = this._activateRuntime(snapshot, contentLocale, p1Output);

    try {
      const newCurrencyLabel = window.inventoryStore?.getCurrencyLabel?.() || null;
      if (oldCurrencyLabel && newCurrencyLabel && oldCurrencyLabel !== newCurrencyLabel) {
        window.inventoryStore?.migrateCurrencyKey?.(oldCurrencyLabel, newCurrencyLabel);
      }
    } catch (e) {
      console.warn('[worldCardManager] 货币改名迁移失败（不致命）:', e);
    }

    if (inProgress) {
      try {
        if (snapNpc && window.npcStore?.restore) window.npcStore.restore(snapNpc);
        if (snapEnt && window.entityStore?.restore) window.entityStore.restore(snapEnt);
        if (snapTl && window.timelineStore?.restore) window.timelineStore.restore(snapTl);
      } catch (e) {
        console.error('[worldCardManager] 改世界卡后本局运行时回填失败:', e);
      }
    }
    return result;
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
    // 先接入存储后端：probe IDB → 一次性迁移 localStorage→IDB → 从 IDB 装载覆盖内存缓存。
    // 必须在 upsert 内置卡之前完成，否则内置卡会写进尚未装载的缓存、被随后的 IDB 装载覆盖丢失。
    await this._initStorageBackend();
    const sourceMap = {};
    for (const spec of this.BUILTIN_CARD_SPECS) {
      const source = await this._initializeSingleBuiltInCard(spec);
      if (source) {
        sourceMap[spec.id] = source;
      }
    }
    this._backfillMissingSchemaVersionStamp();
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
    // 时间线事件（新字段 world_timeline 优先；老卡 timeline 兜底）
    const events = snapshot.world_timeline?.events || snapshot.timeline?.events;
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
      snapshot.panel_fields &&
      typeof snapshot.panel_fields === 'object' &&
      !Array.isArray(snapshot.panel_fields)
    ) {
      delete snapshot.panel_fields._source;
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
        normalizedLocalizedSnapshot.panel_fields &&
        typeof normalizedLocalizedSnapshot.panel_fields === 'object' &&
        !Array.isArray(normalizedLocalizedSnapshot.panel_fields)
      ) {
        delete normalizedLocalizedSnapshot.panel_fields._source;
      }
      localizations[locale].snapshot = normalizedLocalizedSnapshot;
    });

    // V2 manifest：导出时保留 author 信息（让接收方知道原作者），但不导出 card_id /
    // created_at（这两个是本地实例属性，接收方导入时会重置）。详见 manifest spec §4.3。
    const exportManifest =
      card.manifest && typeof card.manifest === 'object'
        ? {
            schema_version: card.manifest.schema_version || 2,
            source: card.manifest.source || 'user_created',
            author_display_name:
              typeof card.manifest.author_display_name === 'string'
                ? card.manifest.author_display_name
                : '',
            author_uid:
              card.manifest.author_uid === undefined ? null : card.manifest.author_uid,
          }
        : undefined;

    return {
      // UCID：随卡走的终身唯一 id（= 本地 card.id），供接收方导入时识别"同一张卡 → 升级"。
      // 这是文件级字段，非 manifest 字段、非 snapshot 字段。内置卡导出已被 exportCard 提前拦掉。
      ...(typeof card.id === 'string' && card.id.trim() ? { ucid: card.id.trim() } : {}),
      name: typeof card.name === 'string' && card.name.trim() ? card.name.trim() : '未命名世界',
      description: typeof card.description === 'string' ? card.description : '',
      contentLocale: this._normalizeContentLocale(card.contentLocale, 'zh-CN'),
      localizations,
      snapshot,
      ...(exportManifest ? { manifest: exportManifest } : {}),
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

    // V2 manifest：导入时强制 source='imported'，沿用原作者署名（若有）。
    // card_id / created_at 会在 create() 里基于新生成的本地 id 和当前时间重置。
    const incomingManifest = this._extractIncomingManifest(cardData);
    const manifestForImport = {
      source: 'imported',
      author_display_name:
        incomingManifest && typeof incomingManifest.author_display_name === 'string'
          ? incomingManifest.author_display_name
          : '',
      author_uid:
        incomingManifest && incomingManifest.author_uid !== undefined
          ? incomingManifest.author_uid
          : null,
    };

    return {
      id: typeof cardData.id === 'string' && cardData.id.trim() ? cardData.id.trim() : null,
      // UCID：随卡走的终身唯一 id。优先顶层 ucid（Phase 2 导出字段）→ cardData.ucid → 旧版 cardData.id 兜底；都没有则 null。
      ucid:
        (typeof data?.ucid === 'string' && data.ucid.trim()) ||
        (typeof cardData.ucid === 'string' && cardData.ucid.trim()) ||
        (typeof cardData.id === 'string' && cardData.id.trim()) ||
        null,
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
      p3ChatHistory: Array.isArray(cardData.p3ChatHistory)
        ? this._deepClone(cardData.p3ChatHistory)
        : [],
      designMeta:
        cardData.designMeta === null || cardData.designMeta === undefined
          ? null
          : this._deepClone(cardData.designMeta),
      isBuiltIn: false,
      manifest: manifestForImport,
    };
  }

  importPreparedCard(preparedCard, options = {}) {
    if (!preparedCard || typeof preparedCard !== 'object') return null;
    if (!preparedCard.snapshot || typeof preparedCard.snapshot !== 'object') return null;
    // 旧版导出文件的 designChatHistory 可能含错误消息或游戏开场白污染——
    // 通过 DesignService 软调用过滤一遍；服务未注册时降级为不过滤
    const ds = typeof window !== 'undefined' ? window.designService : null;
    const filterFn =
      ds && typeof ds._filterPersistableHistory === 'function'
        ? h => ds._filterPersistableHistory(h)
        : h => (Array.isArray(h) ? h : []);
    const designChatHistory = Array.isArray(preparedCard.designChatHistory)
      ? this._deepClone(filterFn(preparedCard.designChatHistory))
      : [];
    const p3ChatHistory = Array.isArray(preparedCard.p3ChatHistory)
      ? this._deepClone(preparedCard.p3ChatHistory)
      : [];
    const designMeta =
      preparedCard.designMeta === null || preparedCard.designMeta === undefined
        ? null
        : this._deepClone(preparedCard.designMeta);

    // UCID 识别：随卡走的 ucid 决定这次导入是「升级同一张」/「保留 id 收新卡」/「新铸」。
    // 内置 id 不可被冒充——撞上即视作无可用 ucid（退回新铸）。options.forceNew=true 强制新铸（"另存为新卡"）。
    const rawUcid =
      typeof preparedCard.ucid === 'string' && preparedCard.ucid.trim()
        ? preparedCard.ucid.trim()
        : null;
    const usableUcid = rawUcid && !this.isBuiltInCard(rawUcid) ? rawUcid : null;

    // 1) 本地已有这张卡 → 就地升级：保 id、不动 manifest（同一张卡保留原作者/created_at）。payload 镜像
    //    _doApplyToGame 覆盖路径——把 contentLocale 对齐到导入卡后，snapshot 即落为主体（见 _updateCardContentForLocale）。
    if (!options.forceNew && usableUcid && this.get(usableUcid)) {
      return this.update(usableUcid, {
        name: preparedCard.name || '导入的世界',
        description: preparedCard.description || '',
        contentLocale: preparedCard.contentLocale,
        localizations: preparedCard.localizations,
        snapshot: preparedCard.snapshot,
        designChatHistory,
        p3ChatHistory,
        designMeta,
      });
    }

    // 2) 有可用 ucid 但本地没有 → 保留它新建（让"再导入"认得出同一张）。3) 其余（无 ucid / 撞内置 / forceNew）→ 新铸。
    const explicitId = !options.forceNew && usableUcid ? usableUcid : undefined;
    return this.create(
      preparedCard.name || '导入的世界',
      preparedCard.snapshot,
      preparedCard.description || '',
      {
        contentLocale: preparedCard.contentLocale,
        localizations: preparedCard.localizations,
        designChatHistory,
        p3ChatHistory,
        designMeta,
        manifest: preparedCard.manifest || null,
        ...(explicitId ? { explicitId } : {}),
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
    if (!card) return null;
    const cloned = this._deepClone(card);
    return this._maybeMigrate(cloned);
  }

  getLocalizedCard(id, locale = null) {
    const card = this._loadCard(id);
    if (!card) return null;
    // migrate 已在 _buildLocalizedCardView 末尾跑过——不重复跑。
    return this._buildLocalizedCardView(card, locale);
  }

  // 把内存里读出的卡跑一遍翻译链（V1 → V2 → …），保证下游 consumer 只看到当前格式形态。
  // 详 内部设计文档 · D3 集中适配器 · D5 翻译链。注意：只翻译内存副本，
  // 永远不写回原卡文件——save-back 路径直接走 _loadCard 拿原始 V1 形态。
  _maybeMigrate(card) {
    if (!card) return card;
    try {
      if (typeof window !== 'undefined' && window.cardMigrations?.migrateInMemory) {
        return window.cardMigrations.migrateInMemory(card);
      }
    } catch (e) {
      console.warn('[WorldCardManager] migrateInMemory failed, returning raw card:', e);
    }
    return card;
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
        // list() 只读 name/desc/locale，不读 snapshot → 跳过 migrate 省开销
        const view = this._buildLocalizedCardView(card, locale, { skipMigrate: true }) || card;
        result.push({
          id: card.id,
          name: view.name,
          description: view.description || '',
          createdAt: card.createdAt,
          updatedAt: card.updatedAt,
          isBuiltIn: card.isBuiltIn === true,
          contentLocale: view.contentLocale || this._normalizeContentLocale(card.contentLocale),
          schemaVersion: (typeof window !== 'undefined' && window.cardSchemaVersion)
            ? window.cardSchemaVersion.getSchemaVersion(card)
            : ((card.snapshot && typeof card.snapshot._schema_version === 'number' && card.snapshot._schema_version > 0)
              ? card.snapshot._schema_version
              : 1),
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
    const id = this._loadActiveId();
    if (id && this._loadCard(id)) {
      return id;
    }
    if (id) {
      console.warn(`[WorldCardManager] 已存储的激活卡 ${id} 不存在，回退`);
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
      p3ChatHistory: [],
      designMeta: null,
      manifest: this._buildManifest({ cardId: id, source: 'user_created', createdAt: now }),
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
    // UCID：导入路径可经 options.explicitId 保留原文件 UCID（让"再导入"认得出同一张卡）。三守卫——
    // 非空 + 非内置 id + 本地尚不存在——任一不满足都退回新铸（杜绝冒充内置 / 覆盖既有 / 重复入索引）。
    const explicitId = typeof options.explicitId === 'string' ? options.explicitId.trim() : '';
    const id =
      explicitId && !this.isBuiltInCard(explicitId) && !this._loadCard(explicitId)
        ? explicitId
        : this._generateId();
    const now = new Date().toISOString();
    // manifest 默认按 user_created 生成；options.manifest 用于导入路径沿用原作者署名 +
    // 强制 source（如 'imported'）。card_id 永远以新生成的本地 id 为准。
    const manifestOverride =
      options.manifest && typeof options.manifest === 'object' ? options.manifest : null;
    const manifest = manifestOverride
      ? this._buildManifest({
          cardId: id,
          source:
            manifestOverride.source === 'imported' ||
            manifestOverride.source === 'user_created' ||
            manifestOverride.source === 'marketplace'
              ? manifestOverride.source
              : 'user_created',
          createdAt: now,
          authorDisplayName:
            typeof manifestOverride.author_display_name === 'string'
              ? manifestOverride.author_display_name
              : undefined,
          authorUid:
            manifestOverride.author_uid === undefined ? undefined : manifestOverride.author_uid,
        })
      : this._buildManifest({ cardId: id, source: 'user_created', createdAt: now });
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
      p3ChatHistory: Array.isArray(options.p3ChatHistory) ? options.p3ChatHistory : [],
      designMeta: options.designMeta || null,
      manifest,
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
    if (updates.p3ChatHistory !== undefined)
      card.p3ChatHistory = Array.isArray(updates.p3ChatHistory)
        ? updates.p3ChatHistory
        : [];
    if (updates.designMeta !== undefined) card.designMeta = updates.designMeta;
    // 编辑草稿态：_editDraft 存在 = 草稿态（卡内容编辑中、未应用），内含编辑中的 designConfig。
    // presence 即状态——了结（应用到游戏 / 放弃编辑）时显式传 null 清掉，转回正式态。
    if (updates._editDraft !== undefined)
      card._editDraft = updates._editDraft === null ? null : this._deepClone(updates._editDraft);
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
        // 原局热更新世界卡：这条路之后不经过 ServiceRegistry.restoreAll，
        // 紧跟 design_apply autosave 会把 _activateRuntime 清空的本局积累写回存档。
        // 走「保会话」包装：重建前后对称备份/回填 npc+entity+timeline，杜绝数据丢失。
        const localized = this._buildLocalizedCardView(card);
        // localized 已 migrate；用 localized.designMeta.p1Output（V1 卡的字段已被翻译进来）
        this._activateRuntimePreservingSession(
          localized.snapshot,
          localized.contentLocale,
          localized?.designMeta?.p1Output || null
        );
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
        this._saveActiveId(null);
      }
    }
    this._removeCard(id);
    const index = this._loadIndex().filter(i => i !== id);
    this._saveIndex(index);

    // 删除后无卡：清空激活状态和运行时缓存
    if (index.length === 0) {
      this._saveActiveId(null);
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
        this._saveActiveId(null);
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
      this._saveActiveId(id);
      this._clearRuntime();
      return { ok: true };
    }
    // 激活 runtime（worldMeta + entityStore + npcStore + timelineStore）
    if (!this._runtimeStoresReady()) {
      this._pendingActivationId = id;
      this._saveActiveId(id);
      return { ok: true };
    }

    const localized = this._buildLocalizedCardView(card);
    // localized 已 migrate；用 localized.designMeta.p1Output（V1 卡的字段已被翻译进来）
    const result = this._activateRuntime(
      localized.snapshot,
      localized.contentLocale,
      localized?.designMeta?.p1Output || null
    );
    if (result && !result.ok) {
      console.warn('[WorldCardManager] runtime 激活失败:', result.reason);
      return { ok: false, reason: result.reason || 'runtime 激活失败' };
    }
    // 世界卡切换后清除 NPC 渲染器的 Schema 缓存
    if (typeof npcCardRenderer !== 'undefined') {
      npcCardRenderer.invalidateCache();
    }
    this._pendingActivationId = null;
    // 激活已在内存生效；_saveActiveId 内部各自处理影子/IDB 写失败（存储被禁/配额满仅 warn）
    this._saveActiveId(id);
    return { ok: true };
  }

  // ========================================
  // 导出 / 导入
  // ========================================

  /**
   * 导出世界卡为 JSON 文件（分享版）
   * @param {string} id - 世界卡 ID
   * @returns {boolean} 是否真的触发了下载（false 表示导出失败，调用方据此埋点/反馈）
   */
  exportCard(id) {
    if (this.isBuiltInCard(id)) {
      if (typeof showToast === 'function') {
        showToast('内置世界卡不可导出');
      }
      return false;
    }
    // 导出走 _loadCard（未 migrate）→ V1 卡原样导出，符合 plan D4 承诺。
    // 不用 this.get(id) 那一路——那条会跑 migrate，把 V1 卡导成 V2 形态。
    const raw = this._loadCard(id);
    const card = raw ? this._deepClone(raw) : null;
    if (!card) {
      console.warn('[WorldCardManager] 导出失败：卡片不存在');
      if (typeof showToast === 'function') {
        showToast('导出失败：世界卡不存在或已被删除');
      }
      return false;
    }
    const shareCard = this._buildShareCardExportData(card);
    if (!shareCard) {
      console.warn('[WorldCardManager] 导出失败：世界卡数据无效');
      if (typeof showToast === 'function') {
        showToast('导出失败：世界卡数据无效');
      }
      return false;
    }
    const blob = new Blob([JSON.stringify(shareCard, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (card.name || 'world').replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    a.download = `worldcard_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    // \u5ef6\u8fdf\u6e05\u7406\uff0c\u8ba9\u6d4f\u89c8\u5668\u5148\u5904\u7406\u4e0b\u8f7d\uff08\u79fb\u52a8\u7aef/Firefox \u4e0a\u540c\u6b65 revoke \u4f1a\u5bfc\u81f4\u4e0b\u8f7d\u6ca1\u53cd\u5e94\uff09
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
    return true;
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
