// js/core/ServiceRegistry.js
// 服务注册中心 - 统一管理参与存档循环的服务的生命周期
// 要求注册的服务实现: getSaveData(), restore(data), clear()
// restore(data) 必须在旧状态非空时也安全调用，恢复结果只能由 data 决定，不能依赖残留状态。

const ServiceRegistry = {
  _services: new Map(),

  /**
   * 注册服务
   * @param {string} name - 注册 key（必须与 collectSaveData 的存档 key 一致）
   * @param {object} instance - 服务实例
   */
  register(name, instance) {
    this._services.set(name, instance);
  },

  /**
   * 获取已注册的服务实例
   * @param {string} name - 注册 key
   * @returns {object|undefined}
   */
  get(name) {
    return this._services.get(name);
  },

  /**
   * 收集所有服务的存档数据
   * @returns {{ data: object, errors: Array<object> }} { data: { key: saveData, ... }, errors: [...] }
   */
  collectSaveData() {
    const data = {};
    const errors = [];
    for (const [name, svc] of this._services) {
      if (typeof svc.getSaveData === 'function') {
        try {
          data[name] = svc.getSaveData();
        } catch (error) {
          const message = error?.message || String(error);
          errors.push({ service: name, stage: 'collect', message });
          console.error(`[ServiceRegistry] collect failed: ${name}`, error);
        }
      }
    }
    return { data, errors };
  },

  /**
   * 从存档恢复所有服务（无数据时调用 clear）
   * restore(data) 的契约：可重复调用、安全覆盖旧状态，不能依赖先前内存状态。
   * @param {object} data - 存档数据对象
   * @returns {{ errors: Array<object> }}
   */
  restoreAll(data) {
    const errors = [];
    const hasDataObject = Boolean(data && typeof data === 'object');
    for (const [name, svc] of this._services) {
      if (typeof svc.restore !== 'function') continue;
      try {
        const hasOwnField = hasDataObject && Object.prototype.hasOwnProperty.call(data, name);
        const hasUsableData = hasOwnField && data[name] !== null && data[name] !== undefined;
        if (hasUsableData) {
          svc.restore(data[name]);
        } else if (typeof svc.clear === 'function') {
          svc.clear();
        }
      } catch (error) {
        const message = error?.message || String(error);
        errors.push({ service: name, stage: 'restore', message });
        console.error(`[ServiceRegistry] restore failed: ${name}`, error);
      }
    }
    return { errors };
  },

  /**
   * 清空所有服务状态
   * @returns {{ errors: Array<object> }}
   */
  clearAll() {
    const errors = [];
    for (const [name, svc] of this._services) {
      if (typeof svc.clear === 'function') {
        try {
          svc.clear();
        } catch (error) {
          const message = error?.message || String(error);
          errors.push({ service: name, stage: 'clear', message });
          console.error(`[ServiceRegistry] clear failed: ${name}`, error);
        }
      }
    }
    return { errors };
  },
};

window.ServiceRegistry = ServiceRegistry;

console.log('[ServiceRegistry] Initialized');
