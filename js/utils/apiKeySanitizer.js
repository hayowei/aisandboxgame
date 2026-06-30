/**
 * apiKeySanitizer.js — API Key 非 ASCII 字符防御
 *
 * 玩家粘贴 API Key 时常混入中文标点 / 全角空格 / emoji，直接写入 HTTP
 * Authorization header 会触发 fetch 编码错误：
 *   TypeError: String contains non ISO-N-1 code point
 *
 * 所有主流 AI provider 的真实 key 均为 [A-Za-z0-9_\-]+ 范围内 ASCII，
 * 不存在合法 key 含非 ASCII 字符的场景，静默剥离零风险。
 *
 * 提供两层防御：
 *   1. 输入处（settingsUI 粘贴/输入）静默清理 + Toast 提示
 *   2. header 构造处（provider.js / aiAdapters.js）兜底，防止旧存档绕过
 */
(function () {
  'use strict';

  function sanitize(raw) {
    if (raw == null) return '';
    return String(raw).replace(/[^\x20-\x7E]/g, '').trim();
  }

  function countStripped(rawTrimmed, cleaned) {
    const original = String(rawTrimmed ?? '').trim();
    return Math.max(0, original.length - cleaned.length);
  }

  window.apiKeySanitizer = {
    sanitize,
    countStripped,
  };
})();
