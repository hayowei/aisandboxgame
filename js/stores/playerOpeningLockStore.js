// ============================================
// Player Opening Lock Store
// ============================================
// 开局问答 wizard 锁定值（仅新卡=有 frozen_moment 时由 wizard 写入）
// 结构：{ mode: 'assigned'|'any_role'|'director', player_role: string|'__RANDOM__'|null, location_site: string|'__RANDOM__' }
// 注：mode 由 player_anchor.allowed_modes 多选时 wizard Step 1 选出；
//     player_role: A 模式默认 recommended_role / B 模式玩家描述 / 写"随机"=sentinel / C 模式=null
//     location_site: wizard Step 3 从 entity.sites 三段路径中选/抽出（格式"country / site / spot"或 sentinel __RANDOM__）
// 老卡（无 frozen_moment）→ wizard 不触发 → lock 永远为 null，走老开局流程零回归

class PlayerOpeningLockStore {
  constructor() {
    /** @type {Object|null} */
    this._lock = null;
  }

  /**
   * 写入完整的 lock 对象（wizard 完成时调）
   * @param {Object|null} lock
   */
  set(lock) {
    if (!lock || typeof lock !== 'object') {
      this._lock = null;
      return;
    }
    this._lock = {
      mode: typeof lock.mode === 'string' ? lock.mode : null,
      player_role:
        lock.player_role === null || lock.player_role === undefined
          ? null
          : String(lock.player_role),
      location_site:
        typeof lock.location_site === 'string' ? lock.location_site : null,
    };
  }

  /**
   * 读 lock；未写入返回 null
   * @returns {Object|null}
   */
  get() {
    return this._lock ? { ...this._lock } : null;
  }

  /**
   * 存档收集
   */
  getSaveData() {
    return this._lock ? { ...this._lock } : null;
  }

  /**
   * 存档恢复
   * @param {Object|null} data
   */
  restore(data) {
    if (!data || typeof data !== 'object') {
      this._lock = null;
      return;
    }
    this.set(data);
  }

  /**
   * 重置
   */
  clear() {
    this._lock = null;
  }

  reset() {
    this.clear();
  }
}

const playerOpeningLockStore = new PlayerOpeningLockStore();
window.playerOpeningLockStore = playerOpeningLockStore;

// 注册到服务中心（key 必须与 saveManager fixedKeys 中字段名一致）
ServiceRegistry.register('player_opening_lock', playerOpeningLockStore);
