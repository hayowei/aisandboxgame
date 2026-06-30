// cardSchemaVersion — 世界卡 schema 格式判定（V1/V2/V3…）
//
// 两层格式号设计（学 Word .docx 容器/内容解耦）：
//   manifest.schema_version   信封格式号（极少变；当前 2）
//   snapshot._schema_version  内容 schema 格式（V1/V2/V3 判定的唯一依据）
//
// 判定规则：
//   snapshot._schema_version === 2 → V2
//   缺失 / < 2 → V1（玩家手里所有老卡都没 _schema_version 字段）
//
// 完整规范见 内部设计文档。

(function () {
  'use strict';

  const CURRENT_VERSION = 2;

  function _readSnapshotVersion(card) {
    if (!card || typeof card !== 'object') return null;
    const snap = card.snapshot;
    if (!snap || typeof snap !== 'object') return null;
    const v = snap._schema_version;
    return typeof v === 'number' && v > 0 ? v : null;
  }

  function _readOriginVersion(card) {
    if (!card || typeof card !== 'object') return null;
    const snap = card.snapshot;
    if (!snap || typeof snap !== 'object') return null;
    const v = snap._origin_schema_version;
    return typeof v === 'number' && v > 0 ? v : null;
  }

  const cardSchemaVersion = {
    CURRENT: CURRENT_VERSION,

    // 返回卡的当前内存形态格式号（≥1）。已被 migrate 过的卡：_schema_version 是当前形态（2）。
    // 缺失 / 不合法 / 玩家老 V1 卡（没经过 migrate 时） → 1。
    getSchemaVersion(card) {
      const v = _readSnapshotVersion(card);
      return v === null ? 1 : v;
    },

    // 返回卡的原始格式（migrate 前）。migrate 时会写 _origin_schema_version；
    // V2 原生卡不需要 migrate → _origin_schema_version 缺失 → 回退到 _schema_version。
    // 用于编辑 gate / 显示警告：判断"这张卡是不是 V1 老卡"。
    getOriginSchemaVersion(card) {
      const origin = _readOriginVersion(card);
      if (origin !== null) return origin;
      return this.getSchemaVersion(card);
    },

    // 当前形态判定
    isV1(card) { return this.getSchemaVersion(card) === 1; },
    isV2(card) { return this.getSchemaVersion(card) === 2; },

    // 原始格式判定（gate 编辑用 —— migrate 后 _schema_version 不能再用）
    isOriginallyV1(card) { return this.getOriginSchemaVersion(card) === 1; },

    // 用于"未来格式卡"检测：格式号高于当前 reader 能识别的最大值
    isFuture(card) { return this.getSchemaVersion(card) > CURRENT_VERSION; },
  };

  if (typeof window !== 'undefined') {
    window.cardSchemaVersion = cardSchemaVersion;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = cardSchemaVersion;
  }
})();
