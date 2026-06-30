// migrations/index — 世界卡 schema 翻译链路由
//
// 设计意图（内部设计文档 · D5）：
//   - 卡在加载时跑一次 migrateInMemory(card)，返回内存里"当前格式形态"的对象。
//   - 不写回原卡文件——玩家硬盘上 V1 json 始终是 V1，只有内存中被翻译。
//   - 链式翻译：V1 → V2 → V3 ... 每升一代只新增一个 v{N-1}ToV{N}.js，旧文件永不修改。
//   - 永远保留所有历代翻译代码——V5 时代仍要能读 V1 卡。这是兼容承诺的核心。
//
// V1 兼容承诺 = 「可以继续玩，但不能再编辑」。编辑入口由 cardSchemaVersion.isV1 / isV2 在 UI 层 gate。

(function () {
  'use strict';

  // 当前 reader 能识别的最大格式。每升级一代要同步 +1。
  const CURRENT_VERSION = 2;

  // 把"未知字段保留传递"的责任放在 JSON.parse 与 deep-copy 实现里：
  // reader 永远先拿完整原对象，做 schema-aware 处理时只读已知字段、不删除任何未知字段。
  // 序列化时直接 JSON.stringify 原对象（不重构），未来 V3 加的字段在 V2 reader 里原样回写。
  function _deepCopy(card) {
    try {
      return JSON.parse(JSON.stringify(card));
    } catch (_) {
      return card; // 极端情况下（循环引用等）退化为引用——但卡应该是纯数据
    }
  }

  function _runChain(card) {
    const getVer = (typeof window !== 'undefined' && window.cardSchemaVersion)
      ? window.cardSchemaVersion.getSchemaVersion.bind(window.cardSchemaVersion)
      : ((typeof require === 'function')
        ? require('../utils/cardSchemaVersion.js').getSchemaVersion
        : function (c) {
          const v = c && c.snapshot && c.snapshot._schema_version;
          return typeof v === 'number' && v > 0 ? v : 1;
        });

    // 防御：链长有上限避免环
    for (let step = 0; step < 8; step++) {
      const ver = getVer(card);
      if (ver >= CURRENT_VERSION) return card;
      if (ver === 1) {
        const v1ToV2 = (typeof window !== 'undefined' && window.migrationsV1ToV2)
          ? window.migrationsV1ToV2.v1ToV2
          : require('./v1ToV2.js').v1ToV2;
        card = v1ToV2(card);
        continue;
      }
      // 未来 v{N}ToV{N+1} 在此追加 case
      // if (ver === 2) { card = window.migrationsV2ToV3.v2ToV3(card); continue; }
      break;
    }
    return card;
  }

  // ──────────────────────────────────────────
  // 公开入口：返回深拷贝后的内存翻译格式。原始 card 对象不被修改。
  // ──────────────────────────────────────────
  function migrateInMemory(card) {
    if (!card || typeof card !== 'object') return card;
    const copy = _deepCopy(card);
    return _runChain(copy);
  }

  const api = { migrateInMemory, CURRENT_VERSION };

  if (typeof window !== 'undefined') {
    window.cardMigrations = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
