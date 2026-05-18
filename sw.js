/**
 * Service Worker — bucket-based cache 策略
 *
 * 见 内部设计文档。
 *
 * 重点：
 *   - cache 按变化频率分桶：versioned（每发版换名）+ fixed（永驻）
 *   - 主线程 installController 负责下载 + 写入（cache.put），SW 只负责路由
 *   - install 不预缓存，只拉 manifest
 *   - 老 ai-sandbox-* 缓存一次性迁移清理
 *
 * MANIFEST_VERSION 由 build-web-release.mjs Phase 3.5 注入。
 */

const MANIFEST_VERSION = '__MANIFEST_VERSION__';

const BUCKET_PREFIX = 'asg-';
// Versioned buckets：每发版换名，activate 删旧版
const SHELL_CACHE = BUCKET_PREFIX + 'shell-v' + MANIFEST_VERSION;
const CODE_CACHE = BUCKET_PREFIX + 'code-v' + MANIFEST_VERSION;
const DATA_CACHE = BUCKET_PREFIX + 'data-v' + MANIFEST_VERSION;
// Fixed-name buckets：内容靠 URL ?v= 自然失效 + LRU 淘汰
const MEDIA_CACHE = 'asg-media';
const FONTS_CACHE = 'asg-fonts';
const RUNTIME_CACHE = 'asg-runtime';

const VERSIONED_PREFIXES = ['asg-shell-v', 'asg-code-v', 'asg-data-v'];
const FIXED_CACHE_NAMES = [MEDIA_CACHE, FONTS_CACHE, RUNTIME_CACHE];
const ACTIVE_VERSIONED = [SHELL_CACHE, CODE_CACHE, DATA_CACHE];

const MANIFEST_PATH = '/install-manifest.json';

// ─────────────────────────────────────────────────────────────────────
// install：只拉 manifest，存进 shell 桶。不预缓存其他任何资源。
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      try {
        const response = await fetch(MANIFEST_PATH + '?nocache=' + Date.now(), { cache: 'no-store' });
        if (response && response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(MANIFEST_PATH, response.clone());
        }
      } catch (err) {
        console.warn('[SW] install: manifest fetch failed', err);
      }
    })()
  );
});

// ─────────────────────────────────────────────────────────────────────
// activate：
//   - 删除老 ai-sandbox-* 前缀的缓存（一次性迁移）
//   - 删除非当前版本的 versioned 桶
//   - 保留所有 fixed 桶（media/fonts/runtime）
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const toDelete = [];
      for (const key of keys) {
        if (key.startsWith('ai-sandbox-')) {
          toDelete.push(key);
          continue;
        }
        // Versioned bucket：只保留当前版本
        const isVersioned = VERSIONED_PREFIXES.some(p => key.startsWith(p));
        if (isVersioned && !ACTIVE_VERSIONED.includes(key)) {
          toDelete.push(key);
        }
        // Fixed 桶不删
      }
      await Promise.all(toDelete.map(k => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// ─────────────────────────────────────────────────────────────────────
// message handler
// ─────────────────────────────────────────────────────────────────────

self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ─────────────────────────────────────────────────────────────────────
// fetch handler：bucket 路由
// ─────────────────────────────────────────────────────────────────────

/**
 * 给定一个同源 URL pathname，返回对应桶 cache name；找不到匹配返回 null。
 */
function routeToBucket(pathname) {
  // shell：manifest 本身（特殊路径在主 fetch handler 单独处理）
  if (pathname === MANIFEST_PATH) return SHELL_CACHE;

  // code：bundle + 所有 CSS
  if (/^\/dist\/bundle\.[a-f0-9]+\.js$/.test(pathname)) return CODE_CACHE;
  if (/^\/css\/.+\.css$/.test(pathname)) return CODE_CACHE;

  // data：changelog + 默认 worldcards + Fixed prompts
  if (pathname === '/prompts/changelog.json') return DATA_CACHE;
  if (/^\/prompts\/\[Fixed\].+\.js$/.test(pathname)) return DATA_CACHE;
  if (/^\/prompts\/(default|cyberpunk|cultivation)worldcard.+$/.test(pathname)) return DATA_CACHE;

  // media（fixed）：图片、PWA icon、launcher cover、PWA manifest
  if (pathname === '/assets/pwa/manifest.webmanifest') return MEDIA_CACHE;
  if (/^\/assets\/pwa\//.test(pathname)) return MEDIA_CACHE;
  if (/^\/assets\/launcher\//.test(pathname)) return MEDIA_CACHE;
  if (/^\/assets\/logos\//.test(pathname)) return MEDIA_CACHE;
  if (/^\/assets\/icons\//.test(pathname)) return MEDIA_CACHE;
  if (/^\/assets\/textures\//.test(pathname)) return MEDIA_CACHE;

  // fonts（fixed）：所有字体
  if (/^\/assets\/fonts\//.test(pathname)) return FONTS_CACHE;

  return null;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (url.origin !== self.location.origin) return;

  // 1. 导航请求：network-first → shell
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(request));
    return;
  }

  // 2. manifest：强制 network-first
  if (url.pathname === MANIFEST_PATH) {
    event.respondWith(handleManifest(request));
    return;
  }

  // 3. 同源资源：按 pathname 路由到桶 → cache-first
  const bucketName = routeToBucket(url.pathname);
  if (bucketName) {
    event.respondWith(handleBucket(request, bucketName));
    return;
  }

  // 4. 其他同源 GET：runtime SWR
  event.respondWith(handleRuntime(request));
});

async function handleNavigate(request) {
  try {
    const response = await fetch(request);
    const clone = response.clone();
    caches.open(SHELL_CACHE).then(cache => cache.put(request, clone)).catch(() => {});
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    return Response.error();
  }
}

async function handleManifest(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(SHELL_CACHE).then(cache => cache.put(MANIFEST_PATH, clone)).catch(() => {});
    }
    return response;
  } catch (_) {
    const cached = await caches.match(MANIFEST_PATH);
    if (cached) return cached;
    return Response.error();
  }
}

async function handleBucket(request, bucketName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const clone = response.clone();
      caches.open(bucketName).then(cache => cache.put(request, clone)).catch(() => {});
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

async function handleRuntime(request) {
  const cached = await caches.match(request);
  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.ok) {
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone)).catch(() => {});
      }
      return response;
    })
    .catch(() => Response.error());

  if (cached) return cached;
  return networkFetch;
}
