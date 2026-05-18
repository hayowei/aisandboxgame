// ============================================
// Save Manager - 存档管理服务
// 存档主库：IndexedDB（window.saveStore）
// 兜底：IDB 不可用时回退 localStorage（保持旧行为）
// ============================================

class SaveManager {
  constructor() {
    this.SLOT_KEY_PREFIX = 'ai_adventure_save_world_';
    this.LEGACY_BACKUP_KEY_PREFIX = 'ai_adventure_save_backup_';
    this.BACKUP_CLEANUP_FLAG = 'ai_adventure_backup_cleanup_v1';
    this.INIT_FLAG = 'ai_adventure_save_v4_initialized';
    this.CURRENT_SLOTS_BY_WORLD_KEY = 'ai_adventure_current_slots_by_world';
    this.IDB_MIGRATION_FLAG = 'idb_migrated_v1';
    this.CURRENT_SLOTS_META_KEY = 'current_slots_by_world';
    this.MAX_SLOTS = 5;
    this.SCHEMA_VERSION = 5;
    this.SCHEMA_LINEAGE = 'flinders-c8';
    this._initPromise = null;
    this._useIDB = false;
    // IDB 初始化失败标记：用于禁用自动存档并提示用户，
    // 避免静默退回 localStorage 后碰到配额限制反复刷屏。
    this._idbUnavailable = false;
    // 每个 slot 一条 promise 链，避免同一 slot 并发写入竞态
    this._slotWriteQueues = new Map();
    this._quotaToastState = { last: 0 };
    this._idbUnavailableToastState = { shown: false };
    // 同步存档名缓存：worldCardId → Map<slotId, name>
    // 供 chat 渲染用 user label 时同步查询，避免渲染异步化
    this._nameCache = new Map();
  }

  _setSlotNameCache(worldCardId, slotId, name) {
    const wid = typeof worldCardId === 'string' ? worldCardId.trim() : '';
    const sid = typeof slotId === 'string' ? slotId.trim() : '';
    if (!wid || !sid) return;
    let inner = this._nameCache.get(wid);
    if (!inner) {
      inner = new Map();
      this._nameCache.set(wid, inner);
    }
    if (typeof name === 'string' && name.trim()) {
      inner.set(sid, name);
    } else {
      inner.delete(sid);
    }
  }

  _clearSlotNameCache(worldCardId, slotId) {
    const wid = typeof worldCardId === 'string' ? worldCardId.trim() : '';
    if (!wid) return;
    const inner = this._nameCache.get(wid);
    if (!inner) return;
    if (slotId == null) {
      this._nameCache.delete(wid);
    } else {
      inner.delete(typeof slotId === 'string' ? slotId.trim() : slotId);
    }
  }

  getSlotNameSync(worldCardId, slotId) {
    const wid = typeof worldCardId === 'string' ? worldCardId.trim() : '';
    const sid = typeof slotId === 'string' ? slotId.trim() : '';
    if (!wid || !sid) return '';
    const inner = this._nameCache.get(wid);
    if (!inner) return '';
    const name = inner.get(sid);
    return typeof name === 'string' ? name : '';
  }

  _normalizeSaveSource(source) {
    const normalized = typeof source === 'string' ? source.trim().toLowerCase() : '';
    if (['manual', 'live', 'auto_transition', 'auto_runtime', 'repair'].includes(normalized)) {
      return normalized;
    }
    return 'unknown';
  }

  _normalizeWorldCardId(worldCardId) {
    const raw = typeof worldCardId === 'string' ? worldCardId.trim() : '';
    if (raw) return raw;
    const activeId = window.worldCardManager?.getActiveCardId?.();
    return typeof activeId === 'string' && activeId.trim() ? activeId : '';
  }

  _slotKey(worldCardId, slotId) {
    const worldId = this._normalizeWorldCardId(worldCardId);
    return `${this.SLOT_KEY_PREFIX}${worldId}_${slotId}`;
  }

  _safeParse(raw, fallback = null) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  ready() {
    return this._ensureInitialized();
  }

  async _ensureInitialized() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      try {
        const store = window.saveStore;
        const idbReady = !!(
          store &&
          typeof store.isAvailable === 'function' &&
          store.isAvailable() &&
          (await store.probe())
        );
        this._useIDB = idbReady;
        this._idbUnavailable = !idbReady;

        if (idbReady) {
          try {
            await this._migrateLegacyToIDB();
          } catch (e) {
            console.error(
              '[SaveManager] 迁移到 IDB 失败，继续以 IDB 模式运行（未搬运项保留在 localStorage）:',
              e
            );
          }
        } else {
          // IDB 不可用时不再静默回落 localStorage——旧兜底会在配额爆掉时
          // 反复刷屏。改为显式禁用自动存档并通过弹窗告知用户，只保留手动导出。
          console.error('[SaveManager] IndexedDB 不可用，自动存档已禁用');
        }

        this._cleanupLegacyBackupKeys();
        this._cleanupAutoSaveKeys();
        try {
          localStorage.setItem(this.INIT_FLAG, '1');
        } catch (e) {
          console.warn('[SaveManager] 写入初始化标记失败:', e);
        }
      } catch (e) {
        // 兜底：任何意料外异常都不污染 _initPromise，按 IDB 不可用处理。
        this._useIDB = false;
        this._idbUnavailable = true;
        console.error('[SaveManager] 初始化遭遇未预期异常，自动存档已禁用:', e);
      }
    })();
    return this._initPromise;
  }

  _notifyIdbUnavailable() {
    if (this._idbUnavailableToastState.shown) return;
    this._idbUnavailableToastState.shown = true;
    const isEnglish =
      typeof window !== 'undefined' &&
      window.i18nService?.getResolvedLanguage?.() === 'en';
    const msg = isEnglish
      ? 'Browser storage is unavailable (private mode, permission blocked, or disk full). Auto-save is disabled; please export your save manually.'
      : '浏览器存储不可用（可能是隐私模式、权限被禁用、或磁盘已满），自动存档已禁用，请使用"导出存档"手动备份。';
    if (typeof showToast === 'function') {
      try { showToast(msg, 'warning', 8000); } catch (_) { /* ignore */ }
    }
    // 同步到控制台便于用户截图反馈
    console.warn('[SaveManager]', msg);
  }

  async _migrateLegacyToIDB() {
    const store = window.saveStore;
    if (!store) return;

    const flag = await store.getMeta(this.IDB_MIGRATION_FLAG);
    if (flag) return; // 幂等

    const migratedKeys = [];
    const failedKeys = [];
    const candidateKeys = [];
    const slotKeyRegex = /^ai_adventure_save_world_.+_slot_\d+$/;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && slotKeyRegex.test(key)) {
        candidateKeys.push(key);
      }
    }

    for (const key of candidateKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = this._safeParse(raw, null);
      if (!parsed || typeof parsed !== 'object') {
        failedKeys.push(key);
        continue;
      }
      try {
        await store.putSave(key, parsed);
        const echo = await store.getSave(key);
        if (echo && typeof echo === 'object' && echo.id === parsed.id) {
          migratedKeys.push(key);
        } else {
          failedKeys.push(key);
        }
      } catch (e) {
        console.warn('[SaveManager] 迁移失败:', key, e);
        failedKeys.push(key);
      }
    }

    // 迁移 current_slots_by_world
    try {
      const rawCurrent = localStorage.getItem(this.CURRENT_SLOTS_BY_WORLD_KEY);
      if (rawCurrent) {
        const parsedCurrent = this._safeParse(rawCurrent, null);
        if (parsedCurrent && typeof parsedCurrent === 'object' && !Array.isArray(parsedCurrent)) {
          await store.putMeta(this.CURRENT_SLOTS_META_KEY, parsedCurrent);
        }
      }
    } catch (e) {
      console.warn('[SaveManager] 迁移 current_slots_by_world 失败:', e);
    }

    await store.putMeta(this.IDB_MIGRATION_FLAG, {
      at: new Date().toISOString(),
      migratedCount: migratedKeys.length,
      failedCount: failedKeys.length,
    });

    // 校验通过后再删 localStorage（关键顺序）
    for (const key of migratedKeys) {
      try {
        localStorage.removeItem(key);
      } catch (_) { /* ignore */ }
    }
    if (migratedKeys.length > 0) {
      try {
        localStorage.removeItem(this.CURRENT_SLOTS_BY_WORLD_KEY);
      } catch (_) { /* ignore */ }
    }

    if (migratedKeys.length > 0 || failedKeys.length > 0) {
      console.log(
        `[SaveManager] 迁移完成：成功 ${migratedKeys.length} 项，失败 ${failedKeys.length} 项`
      );
    }
  }

  _cleanupLegacyBackupKeys() {
    if (localStorage.getItem(this.BACKUP_CLEANUP_FLAG)) return;

    try {
      const keysToDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.LEGACY_BACKUP_KEY_PREFIX)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      console.warn('[SaveManager] 清理旧备份键失败:', e);
    }

    try {
      localStorage.setItem(this.BACKUP_CLEANUP_FLAG, '1');
    } catch (e) {
      console.warn('[SaveManager] 写入备份清理标记失败:', e);
    }
  }

  _cleanupAutoSaveKeys() {
    try {
      const keysToDelete = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('ai_adventure_autosave_world_')) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => localStorage.removeItem(key));
    } catch (e) {
      console.warn('[SaveManager] 清理旧自动存档键失败:', e);
    }
  }

  async _getCurrentSlotsMap() {
    await this._ensureInitialized();
    if (this._useIDB) {
      try {
        const stored = await window.saveStore.getMeta(this.CURRENT_SLOTS_META_KEY);
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) return { ...stored };
      } catch (e) {
        console.warn('[SaveManager] 读取 current_slots meta 失败，回退 localStorage:', e);
      }
    }
    const parsed = this._safeParse(localStorage.getItem(this.CURRENT_SLOTS_BY_WORLD_KEY), null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  }

  async _setCurrentSlotsMap(map) {
    await this._ensureInitialized();
    const empty = !map || typeof map !== 'object' || Object.keys(map).length === 0;
    if (this._useIDB) {
      try {
        if (empty) {
          await window.saveStore.deleteMeta(this.CURRENT_SLOTS_META_KEY);
        } else {
          await window.saveStore.putMeta(this.CURRENT_SLOTS_META_KEY, map);
        }
        // 镜像清理 localStorage 老键（若尚未清）
        try { localStorage.removeItem(this.CURRENT_SLOTS_BY_WORLD_KEY); } catch (_) {}
        return;
      } catch (e) {
        console.warn('[SaveManager] 写入 current_slots meta 失败，回退 localStorage:', e);
      }
    }
    try {
      if (empty) {
        localStorage.removeItem(this.CURRENT_SLOTS_BY_WORLD_KEY);
      } else {
        localStorage.setItem(this.CURRENT_SLOTS_BY_WORLD_KEY, JSON.stringify(map));
      }
    } catch (e) {
      console.warn('[SaveManager] 写入 current_slots localStorage 失败:', e);
    }
  }

  _cleanHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
      .map(msg => {
        // OOC 问答消息（meta:'ooc_qa'）走独立分支：没有 text 字段，靠 question/answer 渲染
        if (msg && msg.meta === 'ooc_qa') {
          const oocCleaned = {
            sender: msg.sender || 'ai',
            meta: 'ooc_qa',
            kind: msg.kind || 'question',
            question: typeof msg.question === 'string' ? msg.question : '',
          };
          if (msg.oocId) oocCleaned.oocId = msg.oocId;
          if (typeof msg.answer === 'string') oocCleaned.answer = msg.answer;
          if (msg.skipped === true) oocCleaned.skipped = true;
          // pending=true 不持久化（重启后视为已完成/跳过，不再有 resolver）
          return oocCleaned;
        }
        const cleaned = { sender: msg.sender, text: msg.text };
        if (msg.uid) cleaned.uid = msg.uid;
        if (typeof msg.modelLabel === 'string' && msg.modelLabel.trim()) {
          cleaned.modelLabel = msg.modelLabel;
        }
        if (typeof msg.providerKey === 'string' && msg.providerKey.trim()) {
          const providerKey = msg.providerKey.trim().toLowerCase();
          if (
            [
              'gemini',
              'deepseek',
              'openai',
              'grok',
              'anthropic',
              'siliconflow',
            ].includes(providerKey)
          ) {
            cleaned.providerKey = providerKey;
          }
        }
        if (Array.isArray(msg.functionCalls) && msg.functionCalls.length > 0) {
          // 序列化时截断工具结果文本，控制存档大小
          cleaned.functionCalls = msg.functionCalls.map(group => {
            if (!group.calls) return group;
            return {
              ...group,
              calls: group.calls.map(c => {
                if (typeof c.result === 'string' && c.result.length > 500) {
                  return { ...c, result: c.result.slice(0, 500) + '\u2026(truncated)' };
                }
                return c;
              }),
            };
          });
        }
        if (Array.isArray(msg.reasoningContents) && msg.reasoningContents.length > 0) {
          cleaned.reasoningContents = msg.reasoningContents;
        }
        if (typeof msg.step2Choices === 'string' && msg.step2Choices.trim()) {
          cleaned.step2Choices = msg.step2Choices;
        }
        if (
          msg.npcReactions &&
          typeof msg.npcReactions === 'object' &&
          Object.keys(msg.npcReactions).length > 0
        ) {
          cleaned.npcReactions = msg.npcReactions;
        }
        if (msg.metrics && typeof msg.metrics === 'object') {
          cleaned.metrics = msg.metrics;
        }
        // reactSegments: text 段安全截断，tool 段只含索引（轻量）
        if (Array.isArray(msg.reactSegments) && msg.reactSegments.length > 0) {
          cleaned.reactSegments = msg.reactSegments.map(seg => {
            if (seg.type === 'text' && typeof seg.text === 'string' && seg.text.length > 3000) {
              return { ...seg, text: seg.text.slice(0, 3000) + '\u2026' };
            }
            return seg;
          });
        }
        // gameData: 结构化 panel_status/choices/panel_narrative，用于读档后恢复状态栏和选项
        if (msg.gameData && typeof msg.gameData === 'object') {
          const gd = {};
          if (msg.gameData.panel_status && typeof msg.gameData.panel_status === 'object') {
            gd.panel_status = msg.gameData.panel_status;
          }
          if (Array.isArray(msg.gameData.choices) && msg.gameData.choices.length > 0) {
            gd.choices = msg.gameData.choices;
          }
          if (typeof msg.gameData.panel_narrative === 'string' && msg.gameData.panel_narrative) {
            gd.panel_narrative = msg.gameData.panel_narrative;
          }
          if (Object.keys(gd).length > 0) cleaned.gameData = gd;
        }
        // OOC 写作准则：贴在 AI 消息上，regenerate 时短路 subagent 复用
        if (msg.ooc && typeof msg.ooc === 'object' && typeof msg.ooc.normalized === 'string' && msg.ooc.normalized) {
          cleaned.ooc = {
            normalized: msg.ooc.normalized,
            raw: Array.isArray(msg.ooc.raw) ? msg.ooc.raw.slice() : [],
          };
        }
        return cleaned;
      })
      .filter(msg => {
        if (!msg || !msg.sender) return false;
        // OOC 问答消息没有 text 字段，靠 question 字段渲染
        if (msg.meta === 'ooc_qa') return typeof msg.question === 'string';
        return msg.text !== undefined && msg.text !== null;
      });
  }

  _getFirstEmptySlotIdFromSaves(saves) {
    for (let i = 1; i <= this.MAX_SLOTS; i++) {
      const slotId = `slot_${i}`;
      if (!saves[slotId]) return slotId;
    }
    return null;
  }

  async _getRegularSaveList(worldCardId, options = {}) {
    const { allowRepair = true } = options;
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const slotIds = [];
    for (let i = 1; i <= this.MAX_SLOTS; i++) slotIds.push(`slot_${i}`);
    const results = await Promise.all(
      slotIds.map(slotId =>
        this._readSlot(normalizedWorldId, slotId, {
          allowRepair,
          setCurrent: false,
          quiet: true,
        })
      )
    );
    const saves = {};
    slotIds.forEach((slotId, idx) => {
      if (results[idx]) {
        saves[slotId] = results[idx];
        this._populateNameCacheFromSave(normalizedWorldId, slotId, results[idx]);
      } else {
        this._clearSlotNameCache(normalizedWorldId, slotId);
      }
    });
    return saves;
  }

  _normalizeSaveData(worldCardId, slotId, data = {}, options = {}) {
    const now = new Date().toISOString();
    const existing = options.existing || null;
    const preserveTimestamps = options.preserveTimestamps || false;
    const preserveExistingExtras = options.preserveExistingExtras || false;
    const sourceData = data && typeof data === 'object' ? data : {};
    const sourceExisting = existing && typeof existing === 'object' ? existing : {};
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    const ownerWorldCardId = this._normalizeWorldCardId(
      sourceData.ownerWorldCardId || sourceExisting.ownerWorldCardId || worldCardId
    );
    const activeWorldCardId = this._normalizeWorldCardId(
      sourceData.activeWorldCardId || sourceExisting.activeWorldCardId || ownerWorldCardId
    );

    const createdAt = preserveTimestamps
      ? sourceData.createdAt || sourceExisting.createdAt || now
      : sourceExisting.createdAt || now;
    const updatedAt = preserveTimestamps
      ? sourceData.updatedAt || sourceData.createdAt || sourceExisting.updatedAt || now
      : now;
    const progressUpdatedAt = preserveTimestamps
      ? sourceData.progressUpdatedAt ||
        sourceData.updatedAt ||
        sourceData.createdAt ||
        sourceExisting.progressUpdatedAt ||
        sourceExisting.updatedAt ||
        createdAt
      : sourceData.progressUpdatedAt || sourceExisting.progressUpdatedAt || updatedAt;

    const name =
      sourceData.name || sourceExisting.name || `存档 ${String(slotId).replace('slot_', '')}`;
    const saveSource = this._normalizeSaveSource(
      sourceData.saveSource ?? sourceExisting.saveSource ?? 'unknown'
    );

    const _pickNullable = key => {
      if (hasOwn(sourceData, key)) return sourceData[key] ?? null;
      if (hasOwn(sourceExisting, key)) return sourceExisting[key] ?? null;
      return null;
    };

    const fixedKeys = new Set([
      'id',
      'ownerWorldCardId',
      'name',
      'createdAt',
      'updatedAt',
      'progressUpdatedAt',
      'schemaVersion',
      'history',
      'summaries',
      'location',
      'npcData',
      'smsData',
      'gameTime',
      'characterStates',
      'mapData',
      'playerStateData',
      'gmData',
      'activeWorldCardId',
      'saveSource',
      // 三 Store 统一架构
      'entities',
      'timelineEvents',
      'inventoryData',
      'collectErrorsGuard',
      '__repaired',
      '__migrated',
    ]);

    const extraFields = {};
    const appendExtraFields = source => {
      if (!source || typeof source !== 'object') return;
      for (const [key, value] of Object.entries(source)) {
        if (fixedKeys.has(key)) continue;
        extraFields[key] = value;
      }
    };
    if (preserveExistingExtras) {
      appendExtraFields(sourceExisting);
    }
    appendExtraFields(sourceData);

    const rawHistory = hasOwn(sourceData, 'history')
      ? sourceData.history
      : hasOwn(sourceExisting, 'history')
        ? sourceExisting.history
        : [];

    return {
      id: slotId,
      ownerWorldCardId,
      name,
      createdAt,
      updatedAt,
      progressUpdatedAt,
      schemaVersion: this.SCHEMA_VERSION,
      history: this._cleanHistory(rawHistory),
      summaries: _pickNullable('summaries'),
      location: _pickNullable('location'),
      npcData: _pickNullable('npcData'),
      smsData: _pickNullable('smsData'),
      gameTime: _pickNullable('gameTime'),
      characterStates: _pickNullable('characterStates'),
      mapData: _pickNullable('mapData'),
      playerStateData: _pickNullable('playerStateData'),
      gmData: _pickNullable('gmData'),
      activeWorldCardId,
      saveSource,
      // 三 Store 统一架构
      entities: _pickNullable('entities'),
      timelineEvents: _pickNullable('timelineEvents'),
      inventoryData: _pickNullable('inventoryData'),
      collectErrorsGuard: _pickNullable('collectErrorsGuard'),
      ...extraFields,
    };
  }

  _validateSaveData(saveData) {
    const issues = [];
    if (!saveData || typeof saveData !== 'object') {
      issues.push('invalid_object');
      return issues;
    }
    if (!Array.isArray(saveData.history)) {
      issues.push('history');
    }
    if (!saveData.ownerWorldCardId || typeof saveData.ownerWorldCardId !== 'string') {
      issues.push('ownerWorldCardId');
    }
    if (saveData.summaries && !Array.isArray(saveData.summaries)) {
      issues.push('summaries');
    }
    if (saveData.smsData && typeof saveData.smsData !== 'object') {
      issues.push('smsData');
    }
    return issues;
  }

  async _readStoredSave(rawOrObject, normalizedWorldId, slotId, options = {}) {
    const { allowRepair = true, setCurrent = false, quiet = false, writeBack = null } = options;
    if (rawOrObject === null || rawOrObject === undefined) return null;

    // IDB 返回对象，localStorage 返回字符串
    let saveData =
      typeof rawOrObject === 'string' ? this._safeParse(rawOrObject, null) : rawOrObject;
    if (!saveData || typeof saveData !== 'object') {
      return null;
    }

    const issues = this._validateSaveData(saveData);
    if (issues.length > 0) {
      if (!allowRepair) return null;

      saveData = this._normalizeSaveData(normalizedWorldId, slotId, saveData, {
        preserveTimestamps: true,
        preserveExistingExtras: true,
      });
      saveData.__repaired = true;
      try {
        if (typeof writeBack === 'function') {
          await writeBack(saveData);
        }
      } catch (e) {
        console.warn('[SaveManager] 存档修复写入失败:', e);
      }
      if (!quiet && typeof showToast === 'function') {
        showToast('检测到存档异常，已自动修复');
      }
    }

    if (!saveData.schemaVersion || saveData.schemaVersion < this.SCHEMA_VERSION) {
      // V4→V5 迁移：playerStateData.money 改为物品栏中的货币 item
      if (
        (!saveData.schemaVersion || saveData.schemaVersion < 5) &&
        saveData.playerStateData &&
        Number.isFinite(Number(saveData.playerStateData.money))
      ) {
        const legacyMoney = parseInt(saveData.playerStateData.money) || 0;
        if (legacyMoney > 0) {
          const resolvedLabel = window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel;
          const label = resolvedLabel || '银币';
          if (!resolvedLabel) {
            console.warn(
              `[SaveManager] V4→V5 迁移: worldMeta 未就绪，货币名 fallback 到「银币」（如果该存档属于修仙/赛博朋克世界，加载后请手动重命名物品名）。worldCardId=${saveData.ownerWorldCardId || saveData.activeWorldCardId || '?'}`
            );
          }
          if (!saveData.inventoryData || typeof saveData.inventoryData !== 'object') {
            saveData.inventoryData = { items: [], pendingChanges: [], pendingSeq: 0, currentTurn: 0 };
          }
          if (!Array.isArray(saveData.inventoryData.items)) {
            saveData.inventoryData.items = [];
          }
          if (!saveData.inventoryData.items.find(it => it && it.name === label)) {
            saveData.inventoryData.items.push({ name: label, count: legacyMoney, desc: '通用流通货币' });
          }
          console.log(`[SaveManager] V4→V5 迁移: 货币 ${legacyMoney} → 物品「${label}」`);
        }
        delete saveData.playerStateData.money;
      }

      saveData = this._normalizeSaveData(normalizedWorldId, slotId, saveData, {
        preserveTimestamps: true,
        preserveExistingExtras: true,
      });
      saveData.__migrated = true;
      try {
        if (typeof writeBack === 'function') {
          await writeBack(saveData);
        }
      } catch (e) {
        console.warn('[SaveManager] 存档升级写入失败:', e);
      }
    }

    if (setCurrent) await this.setCurrentSlot(normalizedWorldId, slotId);
    return saveData;
  }

  async _readSlot(worldCardId, slotId, options = {}) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const key = this._slotKey(normalizedWorldId, slotId);
    let rawOrObject = null;
    if (this._useIDB) {
      try {
        rawOrObject = await window.saveStore.getSave(key);
      } catch (e) {
        console.warn('[SaveManager] IDB 读取失败，尝试 localStorage 兜底:', e);
      }
    }
    if (rawOrObject === null || rawOrObject === undefined) {
      // 兜底：迁移未覆盖、或 IDB 不可用
      rawOrObject = localStorage.getItem(key);
    }
    return this._readStoredSave(rawOrObject, normalizedWorldId, slotId, {
      ...options,
      writeBack: async saveData => this._writeSlot(normalizedWorldId, slotId, saveData),
    });
  }

  async _writeSlot(worldCardId, slotId, saveData) {
    await this._ensureInitialized();
    const key = this._slotKey(worldCardId, slotId);
    // 串行化同一 slot 的写入
    const prev = this._slotWriteQueues.get(key) || Promise.resolve();
    const next = prev.then(() => this._doWrite(key, saveData)).catch(err => {
      // 记录但不传播，避免后续写入因前一次失败而被阻断
      throw err;
    });
    // 链尾更新；若已失败则新的写仍基于 prev（已 resolved/rejected），不会死锁
    const guarded = next.catch(() => {});
    this._slotWriteQueues.set(key, guarded);
    // 写完后清理条目，释放 saveData 闭包引用（仅当没有新的写接续时）
    guarded.finally(() => {
      if (this._slotWriteQueues.get(key) === guarded) {
        this._slotWriteQueues.delete(key);
      }
    });
    await next; // 把错误往上抛给调用者
    return true;
  }

  async _doWrite(key, saveData) {
    if (this._useIDB) {
      await window.saveStore.putSave(key, saveData);
      // IDB 写成功后，清理可能残留的 localStorage 副本
      try { localStorage.removeItem(key); } catch (_) {}
      return;
    }
    if (this._idbUnavailable) {
      // IDB 不可用时不再写 localStorage，避免反复触发 QuotaExceededError。
      // 抛一个可识别的错误，调用层负责弹窗告知用户。
      const err = new Error('IndexedDB 不可用，自动存档已禁用');
      err.code = 'IDB_UNAVAILABLE';
      throw err;
    }
    localStorage.setItem(key, JSON.stringify(saveData));
  }

  _populateNameCacheFromSave(worldCardId, slotId, saveData) {
    if (!saveData || typeof saveData !== 'object') return;
    const name = typeof saveData.name === 'string' ? saveData.name : '';
    if (name) this._setSlotNameCache(worldCardId, slotId, name);
  }

  async _deleteSlotKey(worldCardId, slotId) {
    await this._ensureInitialized();
    const key = this._slotKey(worldCardId, slotId);
    if (this._useIDB) {
      try {
        await window.saveStore.deleteSave(key);
      } catch (e) {
        console.warn('[SaveManager] IDB 删除失败:', e);
      }
    }
    try { localStorage.removeItem(key); } catch (_) {}
  }

  _hasNonEmptyText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  _hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return this._hasNonEmptyText(value);
    if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
    if (typeof value === 'boolean') return value === true;
    if (Array.isArray(value)) return value.some(item => this._hasMeaningfulValue(item));
    if (typeof value === 'object') {
      return Object.values(value).some(item => this._hasMeaningfulValue(item));
    }
    return false;
  }

  _hasMeaningfulSmsData(smsData) {
    if (!smsData || typeof smsData !== 'object') return false;
    const conversations = smsData.conversations;
    if (conversations && typeof conversations === 'object') {
      for (const messages of Object.values(conversations)) {
        if (Array.isArray(messages) && messages.length > 0) return true;
      }
    }
    const unreadCounts = smsData.unreadCounts;
    if (unreadCounts && typeof unreadCounts === 'object') {
      for (const count of Object.values(unreadCounts)) {
        const parsed = Number(count);
        if (Number.isFinite(parsed) && parsed > 0) return true;
      }
    }
    return false;
  }

  _hasMeaningfulLocationData(locationData) {
    if (!locationData || typeof locationData !== 'object') return false;
    const hasValidLocationPoint = source => {
      if (!source || typeof source !== 'object') return false;
      if (
        this._hasNonEmptyText(source.country) ||
        this._hasNonEmptyText(source.site) ||
        this._hasNonEmptyText(source.spot)
      ) {
        return true;
      }
      return this._hasMeaningfulValue(source);
    };
    if (Object.prototype.hasOwnProperty.call(locationData, 'current')) {
      return hasValidLocationPoint(locationData.current);
    }
    return hasValidLocationPoint(locationData);
  }

  _hasMeaningfulPlayerStateData(playerStateData) {
    if (!playerStateData || typeof playerStateData !== 'object') return false;
    if (this._hasNonEmptyText(playerStateData.currentObjective)) return true;
    if (this._hasMeaningfulValue(playerStateData.previousTurnDate)) return true;
    if (this._hasMeaningfulLocationData(playerStateData.previousTurnLocation)) return true;
    return false;
  }

  _hasMeaningfulInventoryData(inventoryData) {
    if (!inventoryData || typeof inventoryData !== 'object') return false;
    if (Array.isArray(inventoryData.items) && inventoryData.items.length > 0) return true;
    if (Array.isArray(inventoryData.pendingChanges) && inventoryData.pendingChanges.length > 0)
      return true;
    return false;
  }

  _hasMeaningfulGameTimeData(gameTimeData) {
    if (!gameTimeData || typeof gameTimeData !== 'object') return false;
    const triggeredEventIds = gameTimeData.triggeredEventIds;
    if (Array.isArray(triggeredEventIds)) return triggeredEventIds.length > 0;
    if (triggeredEventIds && typeof triggeredEventIds === 'object') {
      return Object.keys(triggeredEventIds).length > 0;
    }
    return false;
  }

  _hasCollectErrorsGuard(saveData) {
    if (!saveData || typeof saveData !== 'object') return false;
    const guard = saveData.collectErrorsGuard;
    if (!guard || typeof guard !== 'object') return false;
    if (guard.hasCollectErrors === true) return true;
    const count = Number(guard.count);
    return Number.isFinite(count) && count > 0;
  }

  _hasMeaningfulCoreSaveData(saveData) {
    if (!saveData || typeof saveData !== 'object') return false;
    if (this._hasCollectErrorsGuard(saveData)) return true;
    if (Array.isArray(saveData.summaries) && saveData.summaries.length > 0) return true;
    if (this._hasMeaningfulSmsData(saveData.smsData)) return true;
    if (this._hasMeaningfulPlayerStateData(saveData.playerStateData)) return true;
    if (this._hasMeaningfulInventoryData(saveData.inventoryData)) return true;
    if (this._hasMeaningfulLocationData(saveData.location)) return true;
    if (this._hasMeaningfulGameTimeData(saveData.gameTime)) return true;
    if (this._hasMeaningfulValue(saveData.npcData)) return true;
    if (this._hasMeaningfulValue(saveData.characterStates)) return true;
    if (this._hasMeaningfulValue(saveData.mapData)) return true;
    if (this._hasMeaningfulValue(saveData.gmData)) return true;
    if (this._hasMeaningfulValue(saveData.customStatusData)) return true;
    return false;
  }

  isEmptySaveData(saveData) {
    if (!saveData || typeof saveData !== 'object') return false;
    const history = Array.isArray(saveData.history) ? saveData.history : [];
    const userMessageCount = history.filter(
      msg => msg?.sender === 'user' && typeof msg?.text === 'string' && msg.text.trim()
    ).length;
    if (userMessageCount > 0) return false;
    const aiMessageCount = history.filter(
      msg => msg?.sender === 'ai' && typeof msg?.text === 'string' && msg.text.trim()
    ).length;
    if (aiMessageCount > 1) return false;
    const hasMeaningfulServiceData = this._hasMeaningfulCoreSaveData(saveData);
    return !hasMeaningfulServiceData;
  }

  async getSaveList(worldCardId, options = {}) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const { allowRepair = true } = options;
    return this._getRegularSaveList(normalizedWorldId, { allowRepair });
  }

  async findFirstEmptySlot(worldCardId) {
    const saves = await this.getSaveList(worldCardId);
    return this._getFirstEmptySlotIdFromSaves(saves);
  }

  async getCurrentSlot(worldCardId) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const map = await this._getCurrentSlotsMap();
    const slotId = map[normalizedWorldId];
    return typeof slotId === 'string' ? slotId : null;
  }

  async setCurrentSlot(worldCardId, slotId) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const map = await this._getCurrentSlotsMap();
    if (slotId) {
      map[normalizedWorldId] = slotId;
    } else {
      delete map[normalizedWorldId];
    }
    await this._setCurrentSlotsMap(map);
  }

  _notifyQuotaExceeded(err) {
    const now = Date.now();
    if (now - this._quotaToastState.last < 5000) return;
    this._quotaToastState.last = now;
    if (typeof showToast !== 'function') return;
    const isEnglish =
      typeof window !== 'undefined' &&
      window.i18nService?.getResolvedLanguage?.() === 'en';
    const msg = isEnglish
      ? 'Storage is full: recent progress was not saved. Delete some saves and try again.'
      : '存储空间已满：最近一次进度未能保存。请删除一些存档后重试。';
    try { showToast(msg); } catch (_) { /* ignore */ }
  }

  _isQuotaError(e) {
    if (!e) return false;
    if (e.name === 'QuotaExceededError') return true;
    if (typeof e.code === 'number' && e.code === 22) return true;
    const msg = typeof e.message === 'string' ? e.message : '';
    return /quota/i.test(msg);
  }

  async save(worldCardId, slotId, name, data = {}, options = {}) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const {
      setCurrent = true,
      touchProgress = true,
      preserveTimestamps = false,
      preserveExistingExtras = false,
    } = options;
    const existing = await this._readSlot(normalizedWorldId, slotId, {
      allowRepair: false,
      setCurrent: false,
      quiet: true,
    });
    const progressUpdatedAt =
      touchProgress === false
        ? data?.progressUpdatedAt ||
          existing?.progressUpdatedAt ||
          existing?.updatedAt ||
          existing?.createdAt ||
          null
        : data?.progressUpdatedAt || new Date().toISOString();
    const nextData = this._normalizeSaveData(
      normalizedWorldId,
      slotId,
      {
        name: name || existing?.name || `存档 ${String(slotId).replace('slot_', '')}`,
        ...data,
        progressUpdatedAt,
        ownerWorldCardId: normalizedWorldId,
      },
      { existing, preserveTimestamps, preserveExistingExtras }
    );

    try {
      await this._writeSlot(normalizedWorldId, slotId, nextData);
    } catch (e) {
      if (e?.code === 'IDB_UNAVAILABLE') {
        this._notifyIdbUnavailable();
      } else if (this._isQuotaError(e)) {
        console.error('[SaveManager] 存储空间不足:', e);
        this._notifyQuotaExceeded(e);
      } else {
        console.error('[SaveManager] 存档写入失败:', e);
      }
      return null;
    }

    this._populateNameCacheFromSave(normalizedWorldId, slotId, nextData);

    if (setCurrent) {
      await this.setCurrentSlot(normalizedWorldId, slotId);
    }
    return nextData;
  }

  async load(worldCardId, slotId) {
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const saveData = await this._readSlot(normalizedWorldId, slotId, {
      allowRepair: true,
      setCurrent: true,
      quiet: false,
    });
    if (saveData) this._populateNameCacheFromSave(normalizedWorldId, slotId, saveData);
    return saveData || null;
  }

  async delete(worldCardId, slotId) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const key = this._slotKey(normalizedWorldId, slotId);
    console.log('[SaveManager] delete: worldCardId=%s, slotId=%s, key=%s',
      normalizedWorldId, slotId, key);
    await this._deleteSlotKey(normalizedWorldId, slotId);
    this._clearSlotNameCache(normalizedWorldId, slotId);
    if ((await this.getCurrentSlot(normalizedWorldId)) === slotId) {
      await this.setCurrentSlot(normalizedWorldId, null);
    }
  }

  async deleteAllForWorld(worldCardId) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    for (let i = 1; i <= this.MAX_SLOTS; i++) {
      const slotId = `slot_${i}`;
      await this._deleteSlotKey(normalizedWorldId, slotId);
    }
    this._clearSlotNameCache(normalizedWorldId, null);
    await this.setCurrentSlot(normalizedWorldId, null);
  }

  async rename(worldCardId, slotId, newName) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const saveData = await this._readSlot(normalizedWorldId, slotId, {
      allowRepair: true,
      setCurrent: false,
      quiet: true,
    });
    if (!saveData) return;

    saveData.name = newName;
    saveData.updatedAt = new Date().toISOString();
    try {
      await this._writeSlot(normalizedWorldId, slotId, saveData);
      this._setSlotNameCache(normalizedWorldId, slotId, newName);
    } catch (e) {
      if (e?.code === 'IDB_UNAVAILABLE') {
        this._notifyIdbUnavailable();
      } else if (this._isQuotaError(e)) {
        this._notifyQuotaExceeded(e);
      }
      console.error('[SaveManager] 重命名保存失败:', e);
    }
  }

  getProgressTimestamp(saveData) {
    const timestamp = Date.parse(
      saveData?.progressUpdatedAt || saveData?.updatedAt || saveData?.createdAt || ''
    );
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  async exportSave(worldCardId, slotId) {
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const saveData = await this._readSlot(normalizedWorldId, slotId, {
      allowRepair: true,
      setCurrent: false,
      quiet: true,
    });
    if (!saveData) return;

    const data = JSON.stringify(saveData, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeWorld = normalizedWorldId.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    a.href = url;
    a.download = `adventure_save_${safeWorld}_${saveData.name}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async importSave(jsonData, targetWorldCardId, targetSlotId, options = {}) {
    await this._ensureInitialized();
    try {
      const { allowEmptyImport = false } = options;
      const saveData = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
      if (!saveData.history || !Array.isArray(saveData.history)) {
        throw new Error('无效的存档格式: 缺少 history 数组');
      }
      if (saveData.history.length > 0) {
        const first = saveData.history[0];
        if (!first.sender || !first.text) {
          throw new Error('无效的存档格式: history 消息缺少 sender 或 text');
        }
      }
      if (saveData.summaries && !Array.isArray(saveData.summaries)) {
        throw new Error('无效的存档格式: summaries 应为数组');
      }
      if (saveData.smsData && typeof saveData.smsData !== 'object') {
        throw new Error('无效的存档格式: smsData 应为对象');
      }

      const normalizedWorldId = this._normalizeWorldCardId(targetWorldCardId);
      const normalized = this._normalizeSaveData(
        normalizedWorldId,
        targetSlotId,
        {
          ...saveData,
          name: saveData.name || '导入的存档',
          ownerWorldCardId: normalizedWorldId,
          activeWorldCardId: normalizedWorldId,
          saveSource: saveData.saveSource || 'manual',
        },
        { preserveTimestamps: false }
      );

      if (!allowEmptyImport && this.isEmptySaveData(normalized)) {
        throw new Error('空存档默认不允许导入');
      }

      await this._writeSlot(normalizedWorldId, targetSlotId, normalized);
      return normalized;
    } catch (e) {
      if (e?.code === 'IDB_UNAVAILABLE') {
        this._notifyIdbUnavailable();
      } else if (this._isQuotaError(e)) {
        this._notifyQuotaExceeded(e);
      }
      console.error('Import failed:', e);
      return null;
    }
  }

  async getSaveSlotSizeBytes(worldCardId, slotId) {
    await this._ensureInitialized();
    const normalizedWorldId = this._normalizeWorldCardId(worldCardId);
    const key = this._slotKey(normalizedWorldId, slotId);
    if (this._useIDB) {
      try {
        const obj = await window.saveStore.getSave(key);
        if (obj && typeof obj === 'object') {
          return new Blob([JSON.stringify(obj)]).size;
        }
      } catch (_) { /* fall through to localStorage */ }
    }
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    return new Blob([raw]).size;
  }

  getTurnCount(saveData) {
    if (!saveData || !Array.isArray(saveData.history)) return 0;
    return saveData.history.filter(msg =>
      msg && msg.sender === 'ai' && !(typeof msg.uid === 'string' && msg.uid.startsWith('turn_0_'))
    ).length;
  }

  formatSize(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  formatDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleDateString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// 创建全局实例
const saveManager = new SaveManager();
window.saveManager = saveManager;
// 预热初始化（非阻塞）：让首次用户交互前迁移尽可能已经跑完
saveManager.ready().catch(e => console.error('[SaveManager] ready() 初始化失败:', e));
