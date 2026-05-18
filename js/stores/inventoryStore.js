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
// _changeLog：每次 approve push 一条 { uid, turn, name, prevCount, prevDesc, prevIcon, prevExisted, delta }
//   用于 rollbackAfterUID 倒序 replay 还原（支持多回合 + 同回合多次变更）
// 不复用 npcStore 的 _rejectedUpdates 拒绝记忆
// 遵循 ServiceRegistry 约定：getSaveData() / restore(data) / clear()

const inventoryStore = {
  _items: new Map(),                  // Map<name, { name, count, desc, icon }>，含 count=0 tombstone
  _pendingChanges: [],                // PendingChange[]，按 AI 调用顺序
  _pendingSeq: 0,                     // pending id 自增计数
  _autoApprove: false,                // 自动审批开关；true 时 queueChange 后立即 approve
  _changeLog: [],                     // 审批落地的逆向日志，rollbackAfterUID 倒序 replay
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
   * 成功则 push _changeLog 一条逆向条目，供 rollbackAfterUID 还原
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
    // 入 _changeLog（rollback 倒序 replay 用）
    this._changeLog.push({
      uid: p.uid || null,
      turn: Number.isFinite(p.turn) ? p.turn : 0,
      name: p.name,
      prevCount: existing?.count ?? 0,
      prevDesc: existing?.desc ?? '',
      prevIcon: existing?.icon ?? null,
      prevExisted: !!existing,
      delta: p.delta,
    });
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
  // 回滚（按 turnNumber 倒序 replay _changeLog；并清 pending）
  // ==========================================

  /**
   * 回滚：把 _changeLog 中 turn > targetTurn 的条目倒序撤销
   *   delta-based undo：newCount = currentCount - entry.delta
   *   （等价于"撤回这次 +delta/-delta 的影响"，乱序 approve 也能正确）
   *   - newCount === 0 且 prevExisted=false → 该物品本来就不该存在，delete
   *   - 否则 set count=newCount，desc/icon 沿用当前（无完整 desc/icon 历史，不强行还原）
   *   - turn 字段缺失（污染条目）则跳过
   * pending 队列一律清空（pending 没落地不影响 items；回滚意味着重做）
   * @param {string|null} _targetUID - 兼容老接口；实际用 turnNumber 决策
   * @param {number|null} turnNumber - 截断后保留的最末 AI 回合号；> 它的 entry 都要撤销
   */
  rollbackAfterUID(_targetUID, turnNumber) {
    const targetTurn = Number.isFinite(Number(turnNumber)) ? Number(turnNumber) : null;
    let undoneCount = 0;
    if (targetTurn !== null) {
      // 倒序遍历，splice 高 index 先做避免索引偏移；newCount 计算用当时的 cur（前一条已撤销过）
      for (let i = this._changeLog.length - 1; i >= 0; i--) {
        const entry = this._changeLog[i];
        if (!Number.isFinite(entry.turn) || entry.turn <= targetTurn) continue;
        const cur = this._items.get(entry.name);
        if (!cur) {
          // 物品已不在（例如别处清理过）—— 直接清掉这条 log
          this._changeLog.splice(i, 1);
          undoneCount++;
          continue;
        }
        const delta = Number.isInteger(entry.delta) ? entry.delta : 0;
        const newCount = cur.count - delta;
        if (newCount < 0) {
          // 不应该发生：log 与 items 失同步
          console.warn(
            `[inventoryStore] rollback newCount<0 异常: ${entry.name} cur=${cur.count} delta=${delta}`
          );
          this._changeLog.splice(i, 1);
          undoneCount++;
          continue;
        }
        if (newCount === 0 && !entry.prevExisted) {
          // 撤销的是一次创建，归零 → 该物品本就不该存在
          this._items.delete(entry.name);
        } else {
          this._items.set(entry.name, {
            name: entry.name,
            count: newCount,
            desc: cur.desc,
            icon: cur.icon,
          });
        }
        this._changeLog.splice(i, 1);
        undoneCount++;
      }
    }
    const pendingCount = this._pendingChanges.length;
    this._pendingChanges = [];
    if (undoneCount > 0 || pendingCount > 0) {
      console.log(
        `[inventoryStore] 回滚: 撤销 ${undoneCount} 条已落地变更（targetTurn=${targetTurn}），清空 ${pendingCount} 条 pending`
      );
    }
    if (undoneCount > 0) this._emit('changed');
    this._emit('pending');
  },

  // ==========================================
  // ServiceRegistry 接口
  // ==========================================

  getSaveData() {
    return {
      items: Array.from(this._items.values()),
      pendingChanges: [...this._pendingChanges],
      pendingSeq: this._pendingSeq,
      currentTurn: this.currentTurn,
      changeLog: [...this._changeLog],
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
    // changeLog 仅接收形态合法的条目，prevCount 必须是非负整数
    this._changeLog = Array.isArray(data.changeLog)
      ? data.changeLog
          .filter(
            e =>
              e &&
              typeof e.name === 'string' &&
              Number.isInteger(e.prevCount) &&
              e.prevCount >= 0 &&
              Number.isInteger(e.delta) &&
              typeof e.prevExisted === 'boolean'
          )
          .map(e => ({
            uid: typeof e.uid === 'string' ? e.uid : null,
            turn: Number.isFinite(Number(e.turn)) ? Number(e.turn) : 0,
            name: e.name,
            prevCount: e.prevCount,
            prevDesc: typeof e.prevDesc === 'string' ? e.prevDesc : '',
            prevIcon: typeof e.prevIcon === 'string' && e.prevIcon.trim() ? e.prevIcon.trim() : null,
            prevExisted: e.prevExisted,
            delta: e.delta,
          }))
      : [];
    this._emit('restored');
  },

  clear() {
    this._items = new Map();
    this._pendingChanges = [];
    this._pendingSeq = 0;
    this._changeLog = [];
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

// EventBus 监听：回滚事件
if (window.eventBus && window.GameEvents?.ROLLBACK_TO_TURN) {
  window.eventBus.on(window.GameEvents.ROLLBACK_TO_TURN, ({ targetUID, turnNumber }) => {
    inventoryStore.rollbackAfterUID(targetUID, turnNumber);
  });
}

console.log('[inventoryStore] Initialized');
