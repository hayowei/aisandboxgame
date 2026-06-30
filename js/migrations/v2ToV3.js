// migrations/v2ToV3 — V2 → V3 翻译器占位
//
// V3 schema 尚未定。等 V3 来时在此实现 v2ToV3(card) 函数（同 v1ToV2 的 in-place 写入风格），
// 然后在 migrations/index.js 的 CHAIN 里加一段路由即可。
//
// 翻译链的设计意图：每次升级格式只新增一个 v{N-1}ToV{N}.js，旧文件永不修改。
// 老卡进游戏时按格式号链式跑全部翻译（V1 → V2 → V3 …）直到当前 reader 支持的格式。
// 详 内部设计文档 + 内部设计文档。

(function () {
  'use strict';

  function v2ToV3(card) {
    // 未实现 —— V3 schema 未定。
    return card;
  }

  const api = { v2ToV3 };

  if (typeof window !== 'undefined') {
    window.migrationsV2ToV3 = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
