// ============================================
// Changelog Service - 拉取 / 缓存更新日志数据
// ============================================

(function () {
  'use strict';

  let cached = null;
  let inflight = null;

  async function loadChangelog({ fresh = false, timeoutMs = 0 } = {}) {
    if (cached && !fresh) return cached;
    if (inflight && !fresh) return inflight;

    // 非 fresh 路径按 app 版本号带 cache-buster：同版本内 URL 稳定（仍可被
    // nginx 的 immutable 长缓存命中、省流量），跨版本 URL 变化 → 自动取新。
    // 与全站 JS/CSS 的 ?v=<build> 失效约定一致。修复 changelog 弹窗被一年期
    // immutable 缓存冻结、长期停在旧版本的问题。
    let appVer = '0';
    try {
      const m = document.querySelector('meta[name="app-version"]');
      if (m && m.content) appVer = m.content.trim();
    } catch (_) { /* no document/meta — keep fallback */ }
    const url = fresh
      ? `prompts/changelog.json?_=${Date.now()}`
      : `prompts/changelog.json?v=${encodeURIComponent(appVer)}`;
    const fetchOpts = fresh ? { cache: 'no-store' } : { cache: 'default' };

    const fetchPromise = fetch(url, fetchOpts)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(data => {
        cached = data;
        inflight = null;
        return data;
      })
      .catch(err => {
        inflight = null;
        throw err;
      });

    if (!fresh) inflight = fetchPromise;

    if (timeoutMs > 0) {
      return Promise.race([
        fetchPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('changelog fetch timeout')), timeoutMs)
        ),
      ]);
    }
    return fetchPromise;
  }

  function getEntriesForLocale(data, locale) {
    const key = locale === 'en' ? 'en' : 'zh-CN';
    return (data && data[key]) || (data && data['zh-CN']) || [];
  }

  // Synchronous read from the in-memory cache. Returns the latest changelog
  // entry (`{ version, ... }`) or `null` if `loadChangelog()` has not yet
  // resolved. Used by analyticsService to stamp `app_version` on events.
  function getLatest() {
    if (!cached) return null;
    const arr = (cached['zh-CN']) || (cached['en']) || [];
    return arr[0] || null;
  }

  window.changelogService = { loadChangelog, getEntriesForLocale, getLatest };
})();
