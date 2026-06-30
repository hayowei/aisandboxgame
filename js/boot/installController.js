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
  // bundle 注入后等 launcher:ready 的兜底窗口。超时＝app 起不来（多见 iOS Safari 静默抛错/卡住）。
  // 取 25s：宽于慢机解析 ~6MB bundle 的耗时，又早于内联 60s 兜底 → 由 installController 接管这类卡死的 UI。
  const APP_INIT_TIMEOUT_MS = 25_000;

  // ─────────────────────────────────────────────────────────────────────
  // 状态
  // ─────────────────────────────────────────────────────────────────────

  let manifestVersion = null;
  let manifest = null;
  let totalCriticalBytes = 0;
  let loadedCriticalBytes = 0;
  // 首屏下载明细（已下/总 + 网速）的网速采样状态
  let _speedT0 = 0;          // 上次采样时刻
  let _speedBytes0 = 0;      // 上次采样时已下字节
  let _speedEma = 0;         // 平滑后的字节/秒
  let _lastDetailPaint = 0;  // DOM 刷新限流时刻
  let prefetchAbortController = null;
  let globalTimeoutId = null;
  // 幂等护栏：bundle 注入只许一次（正常流程 / 精简模式逃生 / 失败兜底可能多路调用 injectBundleScript，
  // 任意双注入 = 整包跑两遍 = Maximum call stack / 状态错乱）。directBooted 防逃生口被重复触发。
  let _bundleInjected = false;
  let _directBooted = false;

  window.__criticalReady = false;

  // ── 启动期全局 JS 错误捕获 ───────────────────────────────────────────
  // bundle 注入后，若 launcher.js 在某些设备（多见 iOS Safari）解析/执行时静默抛错，
  // launcher:ready 永不派发 → 永久卡在「Almost ready…」。bundle 内的遥测此刻尚未起来，
  // 这两个监听是这类卡死唯一的根因线索（同源 bundle → 拿得到真实 message + 文件:行）。只记第一条，避免刷屏。
  let _firstBootError = null;
  function _captureBootError(where, detail) {
    if (_firstBootError) return;
    _firstBootError = (where ? where + ': ' : '') + String(detail == null ? '' : detail).slice(0, 300);
    bb('boot.runtime_error', { ms: bootElapsed(), where: where, err: _firstBootError });
  }
  try {
    window.addEventListener('error', (e) => {
      // 冒泡相（默认）只收未捕获 JS 异常；资源（img/script）404 仅在捕获相到达 window → 不会混入 logo 404 噪声。
      const msg = (e && (e.message || (e.error && e.error.message))) || 'error';
      const at = (e && e.filename) ? (' @' + String(e.filename).split('/').pop() + ':' + (e.lineno || '')) : '';
      _captureBootError('window.error', msg + at);
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason;
      _captureBootError('unhandledrejection', (r && (r.message || r)) || 'rejection');
    });
  } catch (_) { /* 探针绝不影响 boot */ }

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

  // ── 首屏下载明细：已下 / 总 大小 + 实时网速 ──────────────────────
  // 数值全来自 critical 桶真实字节进度；仅生产首次下载路径调用（回访/精简模式/dev 不触发，
  // 明细行 CSS 默认隐藏，paintDetail 加 .is-visible 才显，故那些路径上自然不出现）。

  function _initSpeedTracking() {
    _speedT0 = Date.now();
    _speedBytes0 = loadedCriticalBytes;
    _speedEma = 0;
    _lastDetailPaint = 0;
  }

  function _formatMB(bytes) {
    return (bytes / 1048576).toFixed(2) + ' MB';
  }

  function _formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '';
    if (bytesPerSec >= 1048576) return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
    return Math.max(1, Math.round(bytesPerSec / 1024)) + ' KB/s';
  }

  function paintDetail() {
    const wrap = document.getElementById('loading-detail');
    if (!wrap) return;
    wrap.classList.add('is-visible');
    const bytesEl = document.getElementById('loading-bytes');
    const speedEl = document.getElementById('loading-speed');
    if (bytesEl) bytesEl.textContent = _formatMB(loadedCriticalBytes) + ' / ' + _formatMB(totalCriticalBytes);
    if (speedEl) speedEl.textContent = _formatSpeed(_speedEma);
  }

  // 在每个 chunk 回调里调：按 ~600ms 时间窗采样网速（EMA 平滑去抖），并把 DOM 刷新限到 ~250ms。
  function tickDetail() {
    const now = Date.now();
    const dt = now - _speedT0;
    if (dt >= 600) {
      const inst = ((loadedCriticalBytes - _speedBytes0) / dt) * 1000; // bytes/s
      _speedEma = _speedEma ? (_speedEma * 0.6 + inst * 0.4) : inst;
      _speedT0 = now;
      _speedBytes0 = loadedCriticalBytes;
    }
    if (now - _lastDetailPaint < 250) return;
    _lastDetailPaint = now;
    paintDetail();
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

      // 用 streamB 做 cache.put。
      // ⚠️ cachePutPromise 在下面的"读进度"循环（含多次 await reader.read()）期间一直处于
      // "已发起但尚未被 await"的悬挂态。设备存储满/坏时 caches.open 会立刻 reject，而此刻还没
      // 人接它 → 浏览器在读循环的微任务检查点上判定为"未处理的 Promise 拒绝"→ 触发
      // window.unhandledrejection → game.js 弹「请求失败:Failed to execute 'open' on 'CacheStorage'…」。
      // 后台预缓存逐个 bucket 跑 → 一条接一条刷（玩家反馈"一直弹但不影响玩"正是此处）。
      // 解决：把错误吞进变量，让这个 promise 永远 resolve（绝不悬挂拒绝），读完后再统一抛出，
      // 重试/静默语义与原来完全一致。
      let cachePutError = null;
      const cachePutPromise = (async () => {
        try {
          const cache = await caches.open(bucketCacheName(bucketKey));
          await cache.put(url, new Response(streamB, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }));
        } catch (err) {
          cachePutError = err;
        }
      })();

      // 用 streamA 读进度
      const reader = streamA.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.length) onChunk(value.length);
      }

      await cachePutPromise;
      if (cachePutError) throw cachePutError;
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
    // 立刻亮出「0.00 MB / 总大小」，让用户第一眼就知道要下多少。
    _initSpeedTracking();
    paintDetail();

    // 字节进度封顶 90%——剩余 10% 留给字体注入 + bundle 解析 + launcher init，
    // 由 index.html 的 checkAndHide 在 launcher:ready 时一次性跳到 100。
    const onChunk = (bytes) => {
      loadedCriticalBytes += bytes;
      const percent = (loadedCriticalBytes / totalCriticalBytes) * 90;
      updateOverlayProgress(percent);
      tickDetail();
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
    // 已缓存部分会让 loadedCriticalBytes 一次性跳高（断点续传场景）——重置网速基线，
    // 避免把"瞬间跳到 X MB"算成无穷大网速；同时把含缓存的已下/总刷出来。
    _initSpeedTracking();
    paintDetail();

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
    if (_bundleInjected) return;   // 幂等：多路兜底都可能调到这，只许注入一次
    _bundleInjected = true;
    const script = document.createElement('script');
    script.src = bundleUrl;
    script.async = false;
    script.onerror = (err) => {
      console.error('[installController] bundle script load failed:', bundleUrl, err);
      bb('boot.bundle_error', { url: bundleUrl, ms: bootElapsed() });
      // bundle 本体没下来——精简模式也救不了（它也是注入这个 bundle），只给刷新。
      bootFailureModal('加载失败，请刷新页面重试。', 'Loading failed. Please refresh the page.', {});
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

    // 关键：加载遮罩 #initial-loading-overlay 是不透明的、z-index 999999。失败弹窗若只到 9999 会被它
    // 盖死——逃生口/内置浏览器引导全看不见点不到。出失败弹窗时 boot 已失败，遮罩使命结束：直接隐藏它，
    // 让弹窗露出来、能点。（成功路径仍由 inline forceHideOverlay 收尾；directBoot/刷新与遮罩状态无关。）
    try {
      const ov = document.getElementById('initial-loading-overlay');
      if (ov) { ov.style.display = 'none'; ov.style.pointerEvents = 'none'; }
    } catch (_) { /* 兜底 UI 绝不因此崩 */ }

    const modal = document.createElement('div');
    modal.id = 'install-failure-modal';
    modal.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:1000000', /* 高于 #initial-loading-overlay 的 999999，双保险 */
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.6)', /* ui-lint-allow */ // pre-CSS boot failure modal
      'font-family:system-ui,-apple-system,sans-serif',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'max-width:480px',
      'background:#fff',
      'border-radius:12px',
      'padding:24px',
      'box-shadow:0 12px 48px rgba(0,0,0,0.3)', /* ui-lint-allow */ // pre-CSS boot failure modal
      'text-align:center',
      'color:#222', /* ui-lint-allow */ // pre-CSS boot failure modal
    ].join(';');

    const text = document.createElement('p');
    text.textContent = message;
    // white-space:pre-line 让内置浏览器引导文案里的换行（\n\n）正常显示
    text.style.cssText = 'margin:0 0 20px;font-size:15px;line-height:1.5;white-space:pre-line';
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
        'background:' + (btn.primary === false ? '#e5e7eb' : '#2563eb'), /* ui-lint-allow */ // pre-CSS boot failure modal
        'color:' + (btn.primary === false ? '#222' : '#fff'), /* ui-lint-allow */ // pre-CSS boot failure modal
        'font-size:14px',
        'font-weight:500',
        'cursor:pointer',
      ].join(';');
      el.addEventListener('click', () => {
        // keepOpen 的按钮（如「复制链接」）点完不关弹窗——用户复制后还要按引导去「在浏览器中打开」。
        if (!btn.keepOpen) modal.remove();
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
              // 同 downloadAndCache：错误吞进变量，避免悬挂的 putPromise 在读循环期间触发
              // window.unhandledrejection（存储满/坏时 caches.open 立刻 reject）。
              let putError = null;
              const putPromise = (async () => {
                try {
                  const cache = await caches.open(entry._newCacheName);
                  await cache.put(entry.path, new Response(sB, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                  }));
                } catch (e) {
                  putError = e;
                }
              })();
              const reader = sA.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value && value.length) onChunk(value.length, entry);
              }
              await putPromise;
              if (putError) throw putError;
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

  // 门口探针快捷封装（A1）：window.__bootBeacon 由 index.html 内联定义；本文件随时可能在
  // 它之前/之后跑，做空值兜底，且自身绝不抛错。elapsed() 给所有失败/成功事件统一耗时口径。
  function bb(type, payload) {
    try { if (window.__bootBeacon) window.__bootBeacon(type, payload); } catch (_) { /* 探针绝不影响 boot */ }
  }
  function bootElapsed() {
    try { return Date.now() - (window.__bootT0 || Date.now()); } catch (_) { return null; }
  }

  // ── 失败兜底文案 + 逃生口（A4） + 内置浏览器引导（A6）——全自包含，不依赖 CSS/bundle ──
  function bootLangIsEn() {
    try { return (document.documentElement.lang || '').toLowerCase().indexOf('en') === 0; } catch (_) { return false; }
  }
  // 仅匹配会改写/限制页面的国产内置浏览器（白名单）。绝不匹配裸 Mobile/Android/MIUI，
  // 否则正常 Chrome/系统浏览器也被误打扰。
  function isInAppWebview() {
    try { return /MicroMessenger|MQQBrowser|UCBrowser|Quark|\bQQ\//i.test(navigator.userAgent || ''); } catch (_) { return false; }
  }
  function copyPageUrl() {
    const url = location.href;
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch (_) { /* 内置浏览器常禁剪贴板，尽力而为 */ }
    };
    try {
      // clipboard.writeText 在内置 webview 里常 reject——必须 catch 到 reject 再走 execCommand 兜底，
      // 不能"看到 API 存在就 return"（否则它一拒绝就什么都没复制）。
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).catch(fallback);
        return;
      }
    } catch (_) { /* 同步抛 → 落到下面兜底 */ }
    fallback();
  }
  // 精简模式：跳过整段 critical 预下载，直接拉 manifest → 注入 bundle → 放人进游戏。
  // 失去离线预存，但能打开。是失败/卡死时的逃生口；唯一注入路仍走幂等的 injectBundleScript。
  async function directBoot(reason) {
    if (_directBooted || window.__criticalReady) return;
    _directBooted = true;
    bb('boot.direct_boot', { ms: bootElapsed(), reason: reason || 'flag' });
    try {
      if (!manifest) { try { manifest = await fetchManifest(); } catch (_) { } }
      const bundleUrl = manifest ? findBundleUrl(manifest) : null;
      if (globalTimeoutId) { clearTimeout(globalTimeoutId); globalTimeoutId = null; }
      if (!bundleUrl) {
        bb('boot.direct_boot_fail', { ms: bootElapsed() });
        bootFailureModal('加载失败，请刷新页面重试。', 'Failed to load. Please refresh.', {});
        return;
      }
      window.__criticalReady = true;
      window.dispatchEvent(new Event('install-controller:critical-ready'));
      injectDeferredFonts();
      injectBundleScript(bundleUrl);
      scheduleDeferredDownload(manifest);
      // 精简模式同样可能 bundle 起不来 → 挂 app-init 兜底，别让逃生者又卡死在「Almost ready…」。
      armAppInitWatchdog();
    } catch (e) {
      bb('boot.direct_boot_fail', { ms: bootElapsed(), err: String((e && e.message) || e) });
    }
  }
  // 清掉本站所有 Cache Storage + 注销 SW 再 reload。用于「app 起不来 / 疑似缓存损坏」逃生：
  // iOS Safari 有时把缓存/SW 进了坏态，普通硬刷新不一定换掉 bundle，清缓存 + 注销 SW 才能拿干净的从头来。
  async function clearCachesAndReload() {
    try {
      if (window.caches && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (_) { /* 尽力而为，下面照样 reload */ }
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
    } catch (_) { /* 尽力而为 */ }
    try { location.reload(); } catch (_) { location.href = location.pathname; }
  }

  // 统一失败弹窗：中文优先 + 内置浏览器引导 + 可选「精简模式」/「清缓存重试」逃生口。复用 showFailureModal 的按钮 API。
  function bootFailureModal(zhMsg, enMsg, opts) {
    opts = opts || {};
    const en = bootLangIsEn();
    let msg = en ? enMsg : zhMsg;
    const buttons = [];
    if (isInAppWebview()) {
      msg = (en
        ? 'You appear to be inside an app (WeChat/QQ/UC/Quark) that may block loading. Tap the menu (top-right) and choose "Open in browser".\n\n'
        : '检测到你在 微信/QQ/UC/夸克 等应用内打开，可能无法正常加载。请点右上角「···」选择「在浏览器中打开」。\n\n') + msg;
      buttons.push({ label: en ? 'Copy link' : '复制链接', primary: false, keepOpen: true, action: copyPageUrl });
    }
    if (opts.allowEscape) {
      buttons.push({ label: en ? 'Lite load' : '精简模式加载', primary: true, action: () => directBoot('user_escape') });
    }
    if (opts.clearCacheRetry) {
      // app 起不来这一类：精简模式没用（__criticalReady 已 true，directBoot 直接 no-op），清缓存重来才有效。
      buttons.push({ label: en ? 'Clear cache & retry' : '清缓存重试', primary: true, keepOpen: true, action: clearCachesAndReload });
    }
    buttons.push({ label: en ? 'Refresh' : '刷新重试', primary: !opts.allowEscape && !opts.clearCacheRetry, action: () => location.reload() });
    showFailureModal(msg, { buttons });
  }

  // bundle 注入后等 launcher:ready；超时则判定 app 起不来 → 发探针 + 弹「清缓存重试」逃生口。
  // 关键：此前 bundle 注入后就清掉了 60s 全局兜底，而 injectBundleScript.onerror 只在「加载/解析失败」触发、
  // 不覆盖「bundle 加载成功但 launcher 运行时抛错/卡住」——那一类此前无人兜底、永久卡死（见 2026-06-17 iOS 反馈）。
  // launcher:ready 迟到（慢机）→ onReady 会撤掉误报弹窗（自愈），故 25s 窗口不怕慢机假阳。
  function armAppInitWatchdog() {
    let settled = false;
    let wd = null;
    const onReady = () => {
      settled = true;
      if (wd) clearTimeout(wd);
      const m = document.getElementById('install-failure-modal');
      if (m) m.remove();   // 误报自愈：app 迟到 ready → 撤掉「卡住」弹窗，露出已就绪的页面
    };
    window.addEventListener('launcher:ready', onReady, { once: true });
    wd = setTimeout(() => {
      if (settled) return;
      bb('boot.app_init_timeout', {
        ms: bootElapsed(),
        err: _firstBootError || null,
        env: (window.__bootEnv ? window.__bootEnv() : {}),
      });
      bootFailureModal(
        '页面就快好了却卡住了，可能是浏览器兼容或缓存问题。请点「清缓存重试」；若仍打不开，建议换 Safari / Chrome 或系统浏览器打开。',
        'Almost loaded but stuck — likely a browser-compat or cache issue. Tap "Clear cache & retry"; if it still fails, try Safari / Chrome or your system browser.',
        { clearCacheRetry: true }
      );
    }, APP_INIT_TIMEOUT_MS);
  }

  // Cache API 健康探针。iOS Safari 隐私模式 / 存储压力 / WebKit 已知 bug 下 caches.open/match 抛
  // "Unexpected internal error" —— 此前整条 boot（storeManifestInShell→downloadCriticalBucket 全靠 cache.put）
  // 直接死在下载门，清缓存也救不了（API 本身坏了，没缓存可清）。探到坏 → 走纯网络直启，别碰 Cache。
  async function cacheApiUsable() {
    try {
      if (!window.caches || !caches.open) return false;
      const c = await caches.open('asg-cacheprobe');
      try { await c.match('/__probe__'); } catch (_) { return false; } // 有些设备 open 过、match 才抛
      caches.delete('asg-cacheprobe').catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  // Cache API 坏 + 有旧 SW 在控制本页时：旧 SW 的 fetch 处理器同样靠 caches.match（也抛错）→ 把 bundle 请求弄挂，
  // 连"精简模式"也救不了（见 2026-06-17 玩家反馈）。注销旧 SW + reload 一次，让本页脱离 SW、纯网络直启。
  // 防循环：① reload 后 controller 变 null，本分支不再进；② sessionStorage 标记兜底（拿不到就当已做过、不 reload）。
  async function resetStaleSwAndReload() {
    try {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return false;
      let already = false;
      try { already = !!sessionStorage.getItem('asg_sw_reset'); } catch (_) { already = true; }
      if (already) return false;
      const regs = await navigator.serviceWorker.getRegistrations();
      if (!regs || !regs.length) return false;
      await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
      try { sessionStorage.setItem('asg_sw_reset', '1'); } catch (_) { /* 隐私模式可能抛，忽略 */ }
      bb('boot.sw_reset_reload', { ms: bootElapsed() });
      location.reload();
      return true;
    } catch (_) {
      return false;
    }
  }

  async function main() {
    manifestVersion = readManifestVersionFromHtml();
    if (!manifestVersion) {
      // 没有 meta tag —— 视为 dev 环境，installController 不该被加载（错配）
      console.warn('[installController] no manifest-version meta, aborting');
      return;
    }

    // 告诉 index.html 内联 60s 兜底：installController 在世、会自己处理失败（带「精简模式」逃生口）。
    // 内联兜底据此让位，不再用不透明 overlay 盖住更好用的失败弹窗（仅当本文件压根没跑起来时才接管）。
    window.__bootHandledByController = true;

    // installController 真正开始干活（page_open 减 gate_start = installController 被墙/被代理吞没）。
    bb('boot.gate_start', (window.__bootEnv ? window.__bootEnv() : {}));

    // 全局 60s 卡死兜底
    globalTimeoutId = setTimeout(() => {
      if (!window.__criticalReady) {
        bb('boot.gate_timeout', {
          ms: bootElapsed(),
          loadedBytes: loadedCriticalBytes,
          totalBytes: totalCriticalBytes,
        });
        bootFailureModal(
          '加载时间比预期长，可能是网络不稳定。可点「精简模式加载」直接进入（更省流量），或刷新重试。',
          'Loading is taking longer than expected — the network may be unstable. Try "Lite load" to enter directly, or refresh.',
          { allowEscape: true }
        );
      }
    }, GLOBAL_TIMEOUT_MS);

    // SW 注册由 pwaUpdateService 在 bundle 加载后接手；installController 阶段直写 Cache Storage。

    try {
      // 拉 manifest
      manifest = await fetchManifest();

      // Cache API 不可用（多见 iOS Safari 隐私模式 / 存储压力 / WebKit "Unexpected internal error"）→
      // 整条缓存预下载都会死、清缓存也救不了。直接脱离 Cache：先注销可能在作梗的旧 SW（reload 一次），
      // 否则纯网络直启（directBoot），无离线缓存但能打开。
      if (!(await cacheApiUsable())) {
        bb('boot.cache_unavailable', { ms: bootElapsed() });
        if (await resetStaleSwAndReload()) return;   // 触发了 reload，本次到此为止
        await directBoot('cache_unavailable');
        return;
      }

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

      // 若用户已通过「精简模式」逃生口提前进门，后台残留的 critical 下载这才迟到完成——
      // 不再重复 gate_ready / 派发 / 注入 / 调度 deferred（否则把逃生者多算一次开门成功、且重复调度）。
      // 正常路径此处 __criticalReady 仍为 false（下一行才置 true），守卫是无害空操作。
      if (window.__criticalReady) return;

      // critical-ready —— 进门成功。gate_ready ÷ gate_start = 开门成功率（A 组上线后应上升）。
      bb('boot.gate_ready', {
        ms: bootElapsed(),
        returnVisit: !!isReturnVisit,
        bytes: loadedCriticalBytes,
      });
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

      // 下载门 60s 兜底解除，改挂「app-init 兜底」：bundle 已注入，但 launcher 可能静默抛错/卡住、
      // 永不派发 launcher:ready（此前这种情况无人兜底，永久卡在「Almost ready…」——见 2026-06-17 iOS 卡死反馈）。
      if (globalTimeoutId) { clearTimeout(globalTimeoutId); globalTimeoutId = null; }
      armAppInitWatchdog();
    } catch (err) {
      console.error('[installController] critical download failed:', err);
      // 失败已即时弹框，撤掉 60s 全局兜底，否则它稍后还会再发一次 gate_timeout + 再弹一个框。
      if (globalTimeoutId) { clearTimeout(globalTimeoutId); globalTimeoutId = null; }
      // 若已经通过精简模式逃生口（或正常流程）进门，这是后台残留下载的迟到失败——
      // 绝不在能玩的页面上再弹失败框。
      if (window.__criticalReady) return;
      const failures = err && err.failures ? err.failures : [];
      if (failures.length > 0) {
        const firstFile = failures[0].entry.path.split('/').pop();
        bb('boot.gate_fail', {
          ms: bootElapsed(), lastFile: firstFile,
          loadedBytes: loadedCriticalBytes, totalBytes: totalCriticalBytes,
          failures: failures.length, err: String((err && err.message) || ''),
        });
        // 「精简模式加载」= 旧 Skip 行为（跳过预下载直接进），统一走 directBoot。
        bootFailureModal(
          '网络似乎不稳定，文件「' + firstFile + '」没下完。可点「精简模式加载」直接进入，或刷新重试。',
          'The network seems unstable; "' + firstFile + '" failed to download. Try "Lite load" to enter directly, or refresh.',
          { allowEscape: true }
        );
      } else {
        bb('boot.gate_fail', {
          ms: bootElapsed(), reason: 'no_failures_list',
          loadedBytes: loadedCriticalBytes, err: String((err && err.message) || err),
        });
        bootFailureModal(
          '加载失败。可点「精简模式加载」直接进入，或刷新页面重试。',
          'Failed to load. Try "Lite load" to enter directly, or refresh the page.',
          { allowEscape: true }
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
