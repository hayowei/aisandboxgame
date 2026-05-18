/**
 * installController.js
 *
 * 首次访问下载控制器 + 回访增量更新调度器。
 *
 * 设计要点（详见 内部设计文档）：
 * - 仅在 release 版加载（HTML 中由 build 注入，dev HTML 不引用）
 * - 在 bundle.js 之前以 classic <script> 形式同步加载
 * - 通过 <meta name="manifest-version"> 识别当前 HTML 对应的 build 版本
 * - 拉取 /install-manifest.json，按 bucket 分阶段下载
 * - critical bucket 流式下载（response.body.tee()）展示真进度
 * - critical 完成后动态注入 bundle script tag → 浏览器从 cache 秒读
 * - 监听 launcher:ready 后隐藏 overlay
 * - deferred bucket 通过 requestIdleCallback 静默拉
 * - 暴露 window.installController.prefetchUpdate / abortUpdate 给 game.js
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────
  // 配置
  // ─────────────────────────────────────────────────────────────────────

  const MANIFEST_URL = '/install-manifest.json';
  const BUCKET_NAME_PREFIX = 'asg-';
  // 跟 sw.js 保持一致：哪些桶是 fixed-name（永驻），哪些是 versioned。
  const FIXED_BUCKETS = ['media', 'fonts', 'runtime'];

  // 文件下载超时（ms）：底数 30s + 按大小动态延长（假设 50KB/s 2G 速度）
  const TIMEOUT_FLOOR_MS = 30_000;
  const TIMEOUT_BYTES_PER_SECOND = 50_000;
  // 重试：指数退避
  const RETRY_DELAYS_MS = [1_000, 3_000];
  // critical 并发上限
  const CRITICAL_CONCURRENCY = 3;
  // deferred 并发上限
  const DEFERRED_CONCURRENCY = 2;
  // 全局超时：60 秒还没 critical-ready 视为彻底卡住
  const GLOBAL_TIMEOUT_MS = 60_000;

  // ─────────────────────────────────────────────────────────────────────
  // 状态
  // ─────────────────────────────────────────────────────────────────────

  let manifestVersion = null;
  let manifest = null;
  let totalCriticalBytes = 0;
  let loadedCriticalBytes = 0;
  let prefetchAbortController = null;
  let globalTimeoutId = null;

  window.__criticalReady = false;

  // ─────────────────────────────────────────────────────────────────────
  // 工具函数
  // ─────────────────────────────────────────────────────────────────────

  function readManifestVersionFromHtml() {
    const meta = document.querySelector('meta[name="manifest-version"]');
    return meta ? meta.getAttribute('content') : null;
  }

  function bucketCacheName(bucketKey) {
    if (FIXED_BUCKETS.includes(bucketKey)) return BUCKET_NAME_PREFIX + bucketKey;
    return BUCKET_NAME_PREFIX + bucketKey + '-v' + manifestVersion;
  }

  function computeTimeoutMs(sizeBytes) {
    const byteBased = Math.ceil((sizeBytes / TIMEOUT_BYTES_PER_SECOND) * 1000);
    return Math.max(TIMEOUT_FLOOR_MS, byteBased);
  }

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
    });
  }

  function updateOverlayProgress(percent) {
    const bar = document.getElementById('loading-progress-bar');
    const text = document.getElementById('loading-percentage');
    if (bar) bar.style.width = Math.min(100, percent) + '%';
    if (text) text.textContent = Math.min(100, Math.floor(percent)) + '%';
  }

  function updateOverlayStatus(message) {
    const status = document.querySelector('.initial-loading-status');
    if (status) status.textContent = message;
  }

  // ─────────────────────────────────────────────────────────────────────
  // 流式下载 + 缓存写入
  // ─────────────────────────────────────────────────────────────────────

  /**
   * 下载单个文件，流式更新进度，写入指定 bucket cache。
   * onChunk(bytes) 每次读到 chunk 时调用，外部累加进度。
   */
  async function downloadAndCache(url, sizeBytes, bucketKey, onChunk, parentSignal) {
    const timeoutMs = computeTimeoutMs(sizeBytes);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    // 联动父级 abort
    let parentAbortListener = null;
    if (parentSignal) {
      if (parentSignal.aborted) ctrl.abort();
      parentAbortListener = () => ctrl.abort();
      parentSignal.addEventListener('abort', parentAbortListener);
    }

    try {
      const response = await fetch(url, { signal: ctrl.signal });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status + ' for ' + url);
      }

      // 用 tee 拆两路：一路读字节计进度，另一路直接给 cache.put（零拷贝）
      if (!response.body) {
        // 老浏览器无 ReadableStream body —— 退化为先读完再 put（无流式进度）
        const blob = await response.blob();
        onChunk(blob.size);
        const cache = await caches.open(bucketCacheName(bucketKey));
        await cache.put(url, new Response(blob, { headers: response.headers }));
        return;
      }

      const [streamA, streamB] = response.body.tee();

      // 用 streamB 做 cache.put
      const cachePutPromise = (async () => {
        const cache = await caches.open(bucketCacheName(bucketKey));
        await cache.put(url, new Response(streamB, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        }));
      })();

      // 用 streamA 读进度
      const reader = streamA.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length) onChunk(value.length);
      }

      await cachePutPromise;
    } finally {
      clearTimeout(timer);
      if (parentSignal && parentAbortListener) {
        parentSignal.removeEventListener('abort', parentAbortListener);
      }
    }
  }

  /**
   * 带重试的下载。最多 1 + retries 次尝试。
   * 返回 { ok: true } 或 { ok: false, error }
   */
  async function downloadWithRetry(url, sizeBytes, bucketKey, onChunk, parentSignal) {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        if (attempt > 0) {
          await sleep(RETRY_DELAYS_MS[attempt - 1], parentSignal);
        }
        // 重试时重置该文件已计入的进度：把之前累计的 chunk 倒回去
        let attemptBytes = 0;
        const wrappedOnChunk = (n) => {
          attemptBytes += n;
          onChunk(n);
        };
        await downloadAndCache(url, sizeBytes, bucketKey, wrappedOnChunk, parentSignal);
        return { ok: true };
      } catch (err) {
        lastError = err;
        // 若是因为外部 abort，直接抛出，不再重试
        if (parentSignal && parentSignal.aborted) throw err;
        if (err && err.name === 'AbortError') {
          // 仅可能是 timeout 触发的本地 abort —— 走重试
        }
      }
    }
    return { ok: false, error: lastError };
  }

  // ─────────────────────────────────────────────────────────────────────
  // 并发限流（worker pool）
  // ─────────────────────────────────────────────────────────────────────

  async function runWithConcurrency(items, concurrency, worker) {
    const queue = items.slice();
    const results = [];
    const runners = [];
    for (let i = 0; i < concurrency; i++) {
      runners.push((async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          const result = await worker(item);
          results.push({ item, result });
        }
      })());
    }
    await Promise.all(runners);
    return results;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Critical bucket 下载（首次访问主流程）
  // ─────────────────────────────────────────────────────────────────────

  async function fetchManifest() {
    // 加 ?nocache= 让任何中间缓存层都 miss
    const url = MANIFEST_URL + '?nocache=' + Date.now();
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('manifest fetch failed: HTTP ' + response.status);
    }
    return response.json();
  }

  async function readCachedManifest() {
    if (!manifestVersion) return null;
    try {
      const cache = await caches.open(bucketCacheName('shell'));
      const resp = await cache.match(MANIFEST_URL);
      if (!resp) return null;
      return await resp.json();
    } catch (_) {
      return null;
    }
  }

  async function storeManifestInShell(manifestObj) {
    const cache = await caches.open(bucketCacheName('shell'));
    const body = JSON.stringify(manifestObj);
    await cache.put(
      MANIFEST_URL,
      new Response(body, { headers: { 'content-type': 'application/json' } })
    );
  }

  /**
   * 判定 critical entries 是否在缓存中全部存在。
   * 全部命中 → 视为已就绪（回访场景）。
   */
  async function isCriticalCached(manifestObj) {
    const entries = manifestObj.critical || [];
    for (const entry of entries) {
      const cache = await caches.open(bucketCacheName(entry.bucket));
      const match = await cache.match(entry.path);
      if (!match) return false;
    }
    return true;
  }

  async function downloadCriticalBucket(manifestObj) {
    const allEntries = (manifestObj.critical || []).slice();

    totalCriticalBytes = allEntries.reduce((s, e) => s + e.size, 0);
    loadedCriticalBytes = 0;
    updateOverlayProgress(0);
    updateOverlayStatus('Downloading resources...');

    // 字节进度封顶 90%——剩余 10% 留给字体注入 + bundle 解析 + launcher init，
    // 由 index.html 的 checkAndHide 在 launcher:ready 时一次性跳到 100。
    const onChunk = (bytes) => {
      loadedCriticalBytes += bytes;
      const percent = (loadedCriticalBytes / totalCriticalBytes) * 90;
      updateOverlayProgress(percent);
    };

    // 检查已缓存的，跳过它们（断点续传场景：玩家中途刷新过）
    const todo = [];
    for (const entry of allEntries) {
      const cache = await caches.open(bucketCacheName(entry.bucket));
      const match = await cache.match(entry.path);
      if (match) {
        loadedCriticalBytes += entry.size;
      } else {
        todo.push(entry);
      }
    }
    updateOverlayProgress((loadedCriticalBytes / totalCriticalBytes) * 90);

    const failures = [];
    await runWithConcurrency(todo, CRITICAL_CONCURRENCY, async (entry) => {
      const result = await downloadWithRetry(entry.path, entry.size, entry.bucket, onChunk);
      if (!result.ok) {
        failures.push({ entry, error: result.error });
      }
      return result;
    });

    if (failures.length > 0) {
      throw Object.assign(new Error('critical bucket download failed'), { failures });
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Deferred bucket（critical-ready 后 idle 拉）
  // ─────────────────────────────────────────────────────────────────────

  async function downloadDeferredBuckets(manifestObj) {
    const entries = (manifestObj.deferred || []).slice();

    // 过滤掉已经缓存的
    const todo = [];
    for (const entry of entries) {
      try {
        const cache = await caches.open(bucketCacheName(entry.bucket));
        const match = await cache.match(entry.path);
        if (!match) todo.push(entry);
      } catch (_) { todo.push(entry); }
    }

    await runWithConcurrency(todo, DEFERRED_CONCURRENCY, async (entry) => {
      try {
        await downloadWithRetry(entry.path, entry.size, entry.bucket, () => {});
      } catch (_) { /* deferred 失败静默 */ }
    });
  }

  function scheduleDeferredDownload(manifestObj) {
    const trigger = () => downloadDeferredBuckets(manifestObj).catch(() => {});
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(trigger, { timeout: 5_000 });
    } else {
      setTimeout(trigger, 500);
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 字体延后注入
  // ─────────────────────────────────────────────────────────────────────

  function injectDeferredFonts() {
    const links = document.querySelectorAll('link[data-deferred="true"][data-href]');
    for (const link of links) {
      const href = link.getAttribute('data-href');
      if (href) {
        link.setAttribute('href', href);
        link.removeAttribute('data-deferred');
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Bundle script tag 注入
  // ─────────────────────────────────────────────────────────────────────

  function findBundleUrl(manifestObj) {
    const all = (manifestObj.critical || []).concat(manifestObj.deferred || []);
    const bundleEntry = all.find(e =>
      e.bucket === 'code' && /\/dist\/bundle\.[a-f0-9]+\.js$/.test(e.path)
    );
    return bundleEntry ? bundleEntry.path : null;
  }

  function injectBundleScript(bundleUrl) {
    const script = document.createElement('script');
    script.src = bundleUrl;
    script.async = false;
    script.onerror = (err) => {
      console.error('[installController] bundle script load failed:', bundleUrl, err);
      showFailureModal(
        'Loading failed. Please refresh the page.',
        {
          buttons: [
            { label: 'Refresh', primary: true, action: () => location.reload() },
          ],
        }
      );
    };
    document.body.appendChild(script);
  }

  // ─────────────────────────────────────────────────────────────────────
  // 失败 UI（不依赖 game.js）
  // ─────────────────────────────────────────────────────────────────────

  function showFailureModal(message, options) {
    options = options || {};
    const existing = document.getElementById('install-failure-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'install-failure-modal';
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:9999',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.6)', // ui-lint-allow: pre-CSS boot failure modal
      'font-family:system-ui,-apple-system,sans-serif',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'max-width:480px',
      'background:#fff',
      'border-radius:12px',
      'padding:24px',
      'box-shadow:0 12px 48px rgba(0,0,0,0.3)', // ui-lint-allow: pre-CSS boot failure modal
      'text-align:center',
      'color:#222', // ui-lint-allow: pre-CSS boot failure modal
    ].join(';');

    const text = document.createElement('p');
    text.textContent = message;
    text.style.cssText = 'margin:0 0 20px;font-size:15px;line-height:1.5';
    box.appendChild(text);

    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = 'display:flex;gap:12px;justify-content:center';

    (options.buttons || [{ label: 'Refresh', action: () => location.reload() }]).forEach(btn => {
      const el = document.createElement('button');
      el.textContent = btn.label;
      el.style.cssText = [
        'padding:10px 20px',
        'border:none',
        'border-radius:8px',
        'background:' + (btn.primary === false ? '#e5e7eb' : '#2563eb'), // ui-lint-allow: pre-CSS boot failure modal
        'color:' + (btn.primary === false ? '#222' : '#fff'), // ui-lint-allow: pre-CSS boot failure modal
        'font-size:14px',
        'font-weight:500',
        'cursor:pointer',
      ].join(';');
      el.addEventListener('click', () => {
        modal.remove();
        try { btn.action(); } catch (_) {}
      });
      buttonRow.appendChild(el);
    });

    box.appendChild(buttonRow);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  // ─────────────────────────────────────────────────────────────────────
  // prefetchUpdate / abortUpdate（供 game.js 调）
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @param {Object} newManifest - 新版本 manifest
   * @param {Object} callbacks - { onProgress, onComplete, onError }
   *   onProgress: ({ loaded, total, percent, currentFile })
   *   onComplete: ()
   *   onError: (file, error)
   */
  async function prefetchUpdate(newManifest, callbacks) {
    callbacks = callbacks || {};

    // 中止上一次（如果有）
    if (prefetchAbortController) {
      prefetchAbortController.abort();
    }
    prefetchAbortController = new AbortController();
    const signal = prefetchAbortController.signal;

    const newVersion = newManifest.manifestVersion;
    const updateBucketCacheName = (bucketKey) => {
      if (FIXED_BUCKETS.includes(bucketKey)) return BUCKET_NAME_PREFIX + bucketKey;
      return BUCKET_NAME_PREFIX + bucketKey + '-v' + newVersion;
    };

    // 计算 delta：critical + deferred 中所有 entries 里，未缓存的
    const allEntries = (newManifest.critical || []).concat(newManifest.deferred || []);
    const delta = [];
    for (const entry of allEntries) {
      const cacheName = updateBucketCacheName(entry.bucket);
      const newCache = await caches.open(cacheName);
      const existing = await newCache.match(entry.path);
      if (!existing) {
        delta.push({ ...entry, _newCacheName: cacheName });
      }
    }

    if (delta.length === 0) {
      if (callbacks.onComplete) callbacks.onComplete();
      return;
    }

    const totalBytes = delta.reduce((s, e) => s + e.size, 0);
    let loadedBytes = 0;

    const onChunk = (bytes, entry) => {
      loadedBytes += bytes;
      if (callbacks.onProgress) {
        callbacks.onProgress({
          loaded: loadedBytes,
          total: totalBytes,
          percent: (loadedBytes / totalBytes) * 100,
          currentFile: entry.path,
        });
      }
    };

    const failures = [];
    try {
      await runWithConcurrency(delta, CRITICAL_CONCURRENCY, async (entry) => {
        // 用临时 downloadAndCache，但写到 new version 桶
        try {
          const timeoutMs = computeTimeoutMs(entry.size);
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          const parentListener = () => ctrl.abort();
          if (signal.aborted) ctrl.abort();
          signal.addEventListener('abort', parentListener);

          let attemptBytes = 0;
          let lastError = null;
          let success = false;
          for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length && !success; attempt++) {
            try {
              if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1], signal);
              const response = await fetch(entry.path, { signal: ctrl.signal });
              if (!response.ok) throw new Error('HTTP ' + response.status);
              if (!response.body) {
                const blob = await response.blob();
                onChunk(blob.size, entry);
                const cache = await caches.open(entry._newCacheName);
                await cache.put(entry.path, new Response(blob, { headers: response.headers }));
                success = true;
                break;
              }
              const [sA, sB] = response.body.tee();
              const putPromise = (async () => {
                const cache = await caches.open(entry._newCacheName);
                await cache.put(entry.path, new Response(sB, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                }));
              })();
              const reader = sA.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length) onChunk(value.length, entry);
              }
              await putPromise;
              success = true;
            } catch (err) {
              lastError = err;
              if (signal.aborted) throw err;
            }
          }
          clearTimeout(timer);
          signal.removeEventListener('abort', parentListener);
          if (!success) {
            failures.push({ entry, error: lastError });
            if (callbacks.onError) callbacks.onError(entry.path, lastError);
          }
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            failures.push({ entry, error: err });
            if (callbacks.onError) callbacks.onError(entry.path, err);
          }
        }
      });
    } catch (err) {
      if (callbacks.onError) callbacks.onError(null, err);
      return;
    }

    if (failures.length === 0 && callbacks.onComplete) {
      callbacks.onComplete();
    }
  }

  function abortUpdate() {
    if (prefetchAbortController) {
      prefetchAbortController.abort();
      prefetchAbortController = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // 主流程
  // ─────────────────────────────────────────────────────────────────────

  async function main() {
    manifestVersion = readManifestVersionFromHtml();
    if (!manifestVersion) {
      // 没有 meta tag —— 视为 dev 环境，installController 不该被加载（错配）
      console.warn('[installController] no manifest-version meta, aborting');
      return;
    }

    // 全局 60s 卡死兜底
    globalTimeoutId = setTimeout(() => {
      if (!window.__criticalReady) {
        showFailureModal(
          'Loading is taking longer than expected. The network may be unstable.',
          {
            buttons: [
              { label: 'Retry', primary: true, action: () => location.reload() },
            ],
          }
        );
      }
    }, GLOBAL_TIMEOUT_MS);

    // SW 注册由 pwaUpdateService 在 bundle 加载后接手；installController 阶段直写 Cache Storage。

    try {
      // 拉 manifest
      manifest = await fetchManifest();
      await storeManifestInShell(manifest);

      // 判断首次/回访
      const cached = await readCachedManifest();
      const isReturnVisit = cached && await isCriticalCached(manifest);

      // 首次访问 / 大版本更新场景：critical 下载阶段超过 15 秒还没完，
      // 给玩家解释「为什么慢」+「下次会快」的预期管理。
      // critical-ready 后 __criticalReady=true，回调里短路掉。
      if (!isReturnVisit) {
        setTimeout(() => {
          if (window.__criticalReady) return;
          updateOverlayStatus('首次加载，正在下载资源…下次访问会快很多');
        }, 15000);
        await downloadCriticalBucket(manifest);
      } else {
        updateOverlayProgress(90);
      }

      // critical-ready
      window.__criticalReady = true;
      window.dispatchEvent(new Event('install-controller:critical-ready'));
      updateOverlayStatus('Almost ready...');

      // 注入延后字体（让 CSS 开始加载）
      injectDeferredFonts();

      // 注入 bundle script
      const bundleUrl = findBundleUrl(manifest);
      if (!bundleUrl) {
        throw new Error('bundle URL not found in manifest');
      }
      injectBundleScript(bundleUrl);

      // 后台拉 deferred bucket（不阻塞）
      scheduleDeferredDownload(manifest);

      // 60s 全局兜底解除
      if (globalTimeoutId) clearTimeout(globalTimeoutId);
    } catch (err) {
      console.error('[installController] critical download failed:', err);
      const failures = err && err.failures ? err.failures : [];
      if (failures.length > 0) {
        const firstFile = failures[0].entry.path.split('/').pop();
        showFailureModal(
          'The network seems unstable. File "' + firstFile + '" failed to download.',
          {
            buttons: [
              { label: 'Refresh', primary: true, action: () => location.reload() },
              { label: 'Skip', primary: false, action: () => {
                // 强制 critical-ready，让玩家进入（部分功能可能缺失）
                window.__criticalReady = true;
                window.dispatchEvent(new Event('install-controller:critical-ready'));
                const bundleUrl = findBundleUrl(manifest);
                if (bundleUrl) injectBundleScript(bundleUrl);
                injectDeferredFonts();
              }},
            ],
          }
        );
      } else {
        showFailureModal(
          'Failed to load. Please refresh the page.',
          {
            buttons: [
              { label: 'Refresh', primary: true, action: () => location.reload() },
            ],
          }
        );
      }
    }
  }

  // 暴露 API
  window.installController = {
    prefetchUpdate,
    abortUpdate,
    getManifest: () => manifest,
  };

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
