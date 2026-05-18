// ============================================
// TimelineStore — 时间线事件统一 Store
// ============================================
// 管理所有时间线事件（世界历史事件），包含：
//   - 预定义事件（来自世界卡 snapshot.timeline.events）
//   - 扩展事件（未来动态生成 —— 预留接口）
//
// 设计要点：
//   - 参与 ServiceRegistry 存档生命周期
//   - 每个事件保留 origin 标记
//   - 提供与旧 runtimeWorldStore.getTimelineEvents() 等价的读取接口
// ============================================

class TimelineStore {
  constructor() {
    this._data = this._emptyData();
  }

  _emptyData() {
    return {
      events: [],       // [{ ...原始字段, origin }]
      summary: '',      // 时间线概述
    };
  }

  // ========================================
  // 初始化
  // ========================================

  initialize(timeline) {
    this._data = this._emptyData();
    if (!timeline || typeof timeline !== 'object') return;

    if (Array.isArray(timeline.events)) {
      for (const ev of timeline.events) {
        if (!ev || typeof ev !== 'object') continue;
        this._data.events.push({ ...this._deepClone(ev), origin: 'predefined' });
      }
    }
    this._data.summary = typeof timeline._summary === 'string' ? timeline._summary : '';
  }

  // ========================================
  // 写入接口
  // ========================================

  /** 添加一个新事件 */
  add(event, origin = 'expanded') {
    if (!event || typeof event !== 'object') return false;
    this._data.events.push({ ...this._deepClone(event), origin });
    return true;
  }

  // ========================================
  // 查询接口
  // ========================================

  getEvents() {
    return this._deepClone(this._data.events);
  }

  hasEvents() {
    return this._data.events.length > 0;
  }

  getSummary() {
    return this._data.summary || '';
  }

  // ========================================
  // ServiceRegistry 存档生命周期
  // ========================================

  getSaveData() {
    if (this._data.events.length === 0 && !this._data.summary) return null;
    return this._deepClone(this._data);
  }

  restore(savedData) {
    this._data = this._emptyData();
    if (!savedData || typeof savedData !== 'object') return;
    if (Array.isArray(savedData.events)) {
      for (const ev of savedData.events) {
        if (!ev || typeof ev !== 'object') continue;
        this._data.events.push({
          ...this._deepClone(ev),
          origin: ev.origin === 'expanded' ? 'expanded' : 'predefined',
        });
      }
    }
    if (typeof savedData.summary === 'string') {
      this._data.summary = savedData.summary;
    }
  }

  clear() {
    this._data = this._emptyData();
  }

  // ========================================
  // 内部辅助
  // ========================================

  _deepClone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return value;
    }
  }
}

const timelineStore = new TimelineStore();
window.timelineStore = timelineStore;

if (typeof ServiceRegistry !== 'undefined') {
  ServiceRegistry.register('timelineEvents', timelineStore);
}

console.log('[TimelineStore] 初始化完成');
