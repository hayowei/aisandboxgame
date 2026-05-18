// ============================================
// Custom Status Store
// ============================================
// 自定义世界的状态栏字段通用存储
// 用于保存 AI 返回的 panel_status 中非标准字段的数据
// 以及处理用户手动编辑的自定义字段

class CustomStatusStore {
  constructor() {
    /** @type {Object|null} 当前完整的 panel_status 数据 */
    this._status = null;
  }

  /**
   * 从 AI 响应同步完整的 panel_status
   * @param {Object} panelStatus - AI 返回的 panel_status 对象
   */
  syncFromAIResponse(panelStatus) {
    if (panelStatus && typeof panelStatus === 'object') {
      this._status = JSON.parse(JSON.stringify(panelStatus));
    }
  }

  /**
   * 更新单个字段（用户手动编辑）
   * @param {string} path - 字段路径，如 "health.hp" 或 "reputation.0.faction"
   * @param {*} value - 新值
   */
  updateField(path, value) {
    if (!this._status) this._status = {};

    const parts = path.split('.');
    let obj = this._status;

    for (let i = 0; i < parts.length - 1; i++) {
      const key = isNaN(parts[i]) ? parts[i] : parseInt(parts[i]);
      if (obj[key] === null || obj[key] === undefined || typeof obj[key] !== 'object') {
        obj[key] = isNaN(parts[i + 1]) ? {} : [];
      }
      obj = obj[key];
    }

    const lastKey = parts[parts.length - 1];
    obj[isNaN(lastKey) ? lastKey : parseInt(lastKey)] = value;
  }

  /**
   * 获取当前完整状态
   * @returns {Object|null}
   */
  getStatus() {
    return this._status;
  }

  /**
   * 获取存档数据
   */
  getSaveData() {
    return this._status ? JSON.parse(JSON.stringify(this._status)) : null;
  }

  /**
   * 从存档恢复
   * @param {Object|null} data
   */
  restore(data) {
    this._status = data ? JSON.parse(JSON.stringify(data)) : null;
  }

  /**
   * 重置/清空
   */
  clear() {
    this._status = null;
  }

  // 保留旧方法名以兼容现有调用
  reset() {
    this.clear();
  }
}

const customStatusStore = new CustomStatusStore();
window.customStatusStore = customStatusStore;

// 注册到服务中心
ServiceRegistry.register('customStatusData', customStatusStore);
