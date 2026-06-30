// ============================================
// Inventory Store - 玩家物品栏数据存储层
// ============================================
// schema：{ name, count, desc, icon? }，name 为唯一键
//   - count 必须为非负整数（>= 0）；count === 0 视为 tombstone
//   - icon 是可选的 Material Symbols Items glyph 名（如 "medication"），仅由玩家通过
//     UI picker 设置；AI 工具与 prompt 不接触此字段
// AI 提议 → pending 队列 → 玩家审批 → 落地 _items
//   - AI 通过 update_item 提议整数 delta；queueChange 算 countBefore 时叠加同名前序 pending 的 delta
//     （F：让同回合 +5/-3 这种组合不会被错拒），countAfter < 0 时直接返回 insufficient 错误，不入队
// 审批 = delta-based：approveChange 用 currentCount + delta 计算落地值，再做一次 < 0 校验
//   （pending.countAfter 仅作 UI 预览；乱序 approve 也能拿到正确终值）
// 不复用 npcStore 的 _rejectedUpdates 拒绝记忆
// 遵循 ServiceRegistry 约定：getSaveData() / restore(data) / clear()

const inventoryStore = {
  _items: new Map(),                  // Map<name, { name, count, desc, icon }>，含 count=0 tombstone
  _pendingChanges: [],                // PendingChange[]，按 AI 调用顺序
  _pendingSeq: 0,                     // pending id 自增计数
  _autoApprove: false,                // 自动审批开关；true 时 queueChange 后立即 approve
  currentTurn: 0,

  // ==========================================
  // 货币读取（统一入口）
  // ==========================================

  getCurrencyLabel() {
    return window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel || '银币';
  },

  getMoney() {
    const label = this.getCurrencyLabel();
    return this._items.get(label)?.count ?? 0;
  },

  /**
   * 货币改名迁移：作者改了世界卡货币名后，旧存档余额仍以旧名作 key，getMoney() 按新名查不到 → 显示 0。
   * 把旧 key 的条目整体搬到新 key（不动金额、不动 desc/icon）。新 key 已有条目则跳过（保守，不合并语义）。
   * @returns {boolean} 是否实际迁移
   */
  migrateCurrencyKey(oldKey, newKey) {
    const a = typeof oldKey === 'string' ? oldKey.trim() : '';
    const b = typeof newKey === 'string' ? newKey.trim() : '';
    if (!a || !b || a === b) return false;
    const old = this._items.get(a);
    if (!old) return false;
    if (this._items.has(b)) return false;
    this._items.set(b, { ...old, name: b });
    this._items.delete(a);
    this._emit('changed');
    return true;
  },

  // ==========================================
  // 外部 API（被 itemTools.execute 调）
  // ==========================================

  /**
   * 提议物品变更，入 pending 队列
   * @param {{ name: string, desc?: string, delta: number }} args
   * @param {number} turn
   * @param {string|null} uid
   * @returns {object|null} 成功时返回 PendingChange；
   *   入参非法返回 null；库存不足返回 { error: 'insufficient', countBefore, requestedDelta }
   */
  queueChange(args, turn, uid) {
    const name = String(args?.name ?? '').trim();
    const delta = parseInt(args?.delta);
    if (!name || !Number.isInteger(delta) || delta === 0) {
      console.warn('[inventoryStore] queueChange invalid args', args);
      return null;
    }

    const existing = this._items.get(name) || null;
    // 已落地 count 必须是非负整数；其他值（不应出现）按 0 兜底
    const baseCount =
      Number.isInteger(existing?.count) && existing.count >= 0 ? existing.count : 0;
    // F：同回合先入账后扣减不应错拒，把同名前序 pending 的 delta 累加到 countBefore
    const priorDelta = this._pendingChanges
      .filter(p => p.name === name)
      .reduce((sum, p) => sum + (Number.isInteger(p.delta) ? p.delta : 0), 0);
    const countBefore = baseCount + priorDelta;
    const countAfter = countBefore + delta;
    if (countAfter < 0) {
      // 库存不足：调用方决定如何把失败信号回报给 AI / UI；不入队、不 emit
      return { error: 'insufficient', countBefore, requestedDelta: delta };
    }
    const descBefore = existing?.desc ?? null;

    const trimmedDesc = typeof args.desc === 'string' ? args.desc.trim() : '';
    const descAfter = trimmedDesc ? trimmedDesc : descBefore;

    this._pendingSeq += 1;
    const id = `pc_${turn || 0}_${this._pendingSeq}`;
    const pending = {
      id,
      name,
      delta,
      descBefore,
      descAfter,
      countBefore,
      countAfter,
      turn: turn || 0,
      uid: uid || null,
    };
    this._pendingChanges.push(pending);
    if (this._autoApprove) {
      // 自动模式：直接 approve，approveChange 内部会 emit 'changed' + 'pending'，
      // 不再多发一次冗余 'pending'（手动模式才需要）
      this.approveChange(id);
    } else {
      this._emit('pending');
    }
    return pending;
  },

  // ==========================================
  // 自动审批开关
  // ==========================================

  setAutoApprove(enabled) {
    this._autoApprove = !!enabled;
    if (this._autoApprove && this._pendingChanges.length > 0) {
      this.approveAll();
    }
  },

  isAutoApprove() {
    return this._autoApprove;
  },

  // ==========================================
  // 审批 API
  // ==========================================

  /**
   * delta-based 落地一条 pending：count = current + delta，先校验非负
   * 失败（如乱序 approve 后 current 不够扣）则丢弃 pending 但 items 不动
   * @returns {boolean} true=落地，false=校验失败
   */
  _applyPending(p) {
    const existing = this._items.get(p.name) || null;
    const baseCount =
      Number.isInteger(existing?.count) && existing.count >= 0 ? existing.count : 0;
    const newCount = baseCount + p.delta;
    if (newCount < 0) {
      console.warn(
        `[inventoryStore] approve 失败：「${p.name}」当前 ${baseCount}，delta ${p.delta} 会让 count<0；丢弃 pending 但 items 不动`
      );
      return false;
    }
    // 落地：保留玩家手动设置的 icon；descAfter 为空则继承现有 desc
    this._items.set(p.name, {
      name: p.name,
      count: newCount,
      desc: p.descAfter || existing?.desc || '',
      icon: existing?.icon || null,
    });
    return true;
  },

  approveChange(pendingId) {
    const idx = this._pendingChanges.findIndex(p => p.id === pendingId);
    if (idx < 0) return false;
    const p = this._pendingChanges[idx];
    const ok = this._applyPending(p);
    this._pendingChanges.splice(idx, 1);
    if (ok) this._emit('changed');
    this._emit('pending');
    return ok;
  },

  rejectChange(pendingId) {
    const idx = this._pendingChanges.findIndex(p => p.id === pendingId);
    if (idx < 0) return false;
    this._pendingChanges.splice(idx, 1);
    this._emit('pending');
    return true;
  },

  approveAll() {
    if (this._pendingChanges.length === 0) return 0;
    // 按 push 顺序 delta-based 累加；某条失败仅跳过（不阻断后续）
    const queue = [...this._pendingChanges];
    this._pendingChanges = [];
    let appliedCount = 0;
    for (const p of queue) {
      if (this._applyPending(p)) appliedCount++;
    }
    if (appliedCount > 0) this._emit('changed');
    this._emit('pending');
    return appliedCount;
  },

  rejectAll() {
    if (this._pendingChanges.length === 0) return 0;
    const n = this._pendingChanges.length;
    this._pendingChanges = [];
    this._emit('pending');
    return n;
  },

  // ==========================================
  // 查询 API
  // ==========================================

  getItems() {
    return Array.from(this._items.values());
  },

  getActiveItems() {
    return Array.from(this._items.values()).filter(it => it.count > 0);
  },

  getTombstoneItems() {
    return Array.from(this._items.values()).filter(it => it.count === 0);
  },

  getItem(name) {
    if (!name) return null;
    return this._items.get(String(name).trim()) || null;
  },

  getPending() {
    return [...this._pendingChanges];
  },

  // ==========================================
  // 玩家手动设置 icon（picker 入口）
  // ==========================================

  setItemIcon(name, glyph) {
    const trimmedName = String(name || '').trim();
    if (!trimmedName) return false;
    const existing = this._items.get(trimmedName);
    if (!existing) return false;
    const nextIcon = typeof glyph === 'string' && glyph.trim() ? glyph.trim() : null;
    if (existing.icon === nextIcon) return false;
    this._items.set(trimmedName, { ...existing, icon: nextIcon });
    this._emit('changed');
    return true;
  },


  // ==========================================
  // ServiceRegistry 接口
  // ==========================================

  getSaveData() {
    return {
      // （历史：曾有 _changeLog 逆向日志供回滚 replay；回滚改为「还原上一份完整存档」后整体移除。
      //   老存档里残留的 changeLog 字段 restore 不再读取、静默丢弃。）
      items: Array.from(this._items.values()),
      pendingChanges: [...this._pendingChanges],
      pendingSeq: this._pendingSeq,
      currentTurn: this.currentTurn,
      // 记下存档时的货币名（= 余额 Map 的实际 key）。读回时若世界卡货币已被作者改名，
      // restore 据此把旧 key 余额迁到新名，避免「改了货币名→余额显示 0」。
      currencyLabel: this.getCurrencyLabel(),
    };
  },

  restore(data) {
    if (!data || typeof data !== 'object') {
      this.clear();
      this._emit('restored');
      return;
    }
    this._items = new Map();
    if (Array.isArray(data.items)) {
      for (const it of data.items) {
        if (!it || typeof it.name !== 'string') continue;
        const name = it.name.trim();
        if (!name) continue;
        // count 必须是非负整数；其他一律视为 0（tombstone）
        const count = Number.isInteger(it.count) && it.count >= 0 ? it.count : 0;
        const desc = typeof it.desc === 'string' ? it.desc : '';
        const icon = typeof it.icon === 'string' && it.icon.trim() ? it.icon.trim() : null;
        this._items.set(name, { name, count, desc, icon });
      }
    }
    this._pendingChanges = Array.isArray(data.pendingChanges) ? [...data.pendingChanges] : [];
    this._pendingSeq = Number.isFinite(Number(data.pendingSeq)) ? parseInt(data.pendingSeq) : 0;
    this.currentTurn = Number.isFinite(Number(data.currentTurn)) ? parseInt(data.currentTurn) : 0;
    // 货币改名自愈：此刻 worldMeta 已是（可能改过名的）当前世界卡。若存档记的货币名与现名不同，
    // 把旧 key 的余额迁到新名（migrateCurrencyKey 内部已保证：旧 key 有值且新 key 缺失才迁）。
    // 关键：新名取「原始货币名」（不带兜底默认），仅当其非空时才迁——避免读档瞬间 worldMeta 尚未就绪、
    // getCurrencyLabel() 回落到兜底「银币」时，把本来正常的余额误迁坏。
    const savedCurrencyLabel = typeof data.currencyLabel === 'string' ? data.currencyLabel.trim() : '';
    const newCurrencyLabel = (
      window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel || ''
    ).trim();
    if (savedCurrencyLabel && newCurrencyLabel && savedCurrencyLabel !== newCurrencyLabel) {
      try {
        this.migrateCurrencyKey(savedCurrencyLabel, newCurrencyLabel);
      } catch (_e) { /* 迁移失败不致命，余额按原 key 保留 */ }
    }
    this._emit('restored');
  },

  clear() {
    this._items = new Map();
    this._pendingChanges = [];
    this._pendingSeq = 0;
    this.currentTurn = 0;
  },

  // ==========================================
  // 内部：事件广播
  // ==========================================

  _emit(kind) {
    const bus = window.eventBus;
    const events = window.GameEvents;
    if (!bus || !events) return;
    if (kind === 'changed') bus.emit(events.INVENTORY_CHANGED, { items: this.getItems() });
    else if (kind === 'pending') bus.emit(events.INVENTORY_PENDING, { pending: this.getPending() });
    else if (kind === 'restored') bus.emit(events.INVENTORY_RESTORED, { items: this.getItems() });
  },
};

// ServiceRegistry 注册
if (typeof ServiceRegistry !== 'undefined') {
  ServiceRegistry.register('inventoryData', inventoryStore);
}

window.inventoryStore = inventoryStore;

console.log('[inventoryStore] Initialized');
