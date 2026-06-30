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
 * MANIFEST_VERSION 由 内部构建脚本 Phase 3.5 注入。
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
      try {
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
      } catch (_) { /* Cache API 不可用：跳过清理，绝不阻断 activate */ }
      try { await self.clients.claim(); } catch (_) { /* 尽力而为 */ }
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
// Cache API 兜底：iOS Safari 隐私模式 / 存储压力 / WebKit "Unexpected internal error" 下
// caches.* 会抛错。任何 caches 抛错都绝不能把 fetch 弄挂——退化成"缓存未命中、走网络"即可。
//（此前 handleBucket 的 `await caches.match` 未兜底 → 抛错 → respondWith 拒绝 → bundle 请求挂掉 →
//  整个 app 打不开，连"精简模式"也救不了。见 2026-06-17 玩家反馈。）
// ─────────────────────────────────────────────────────────────────────
async function safeCacheMatch(req) {
  try {
    if (!self.caches) return undefined;
    return await caches.match(req);
  } catch (_) {
    return undefined;
  }
}
function safeCachePut(bucketName, request, response) {
  try {
    if (!self.caches) return;
    caches.open(bucketName).then(cache => cache.put(request, response)).catch(() => {});
  } catch (_) { /* Cache API 不可用：跳过写缓存，纯网络运行 */ }
}

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

  // /_/ 前缀保留给宿主路由，实时数据不缓存。
  if (url.pathname.startsWith('/_/')) return;

  // 视频（如 launcher 动态壁纸）：不经 SW，交浏览器原生处理 Range/206。
  // cache-first 桶无法 cache.put 206 部分响应，介入会导致视频在 iOS Safari 放不出来；
  // 浏览器自带 HTTP 缓存已能处理重复播放，无需 SW 缓存。
  if (/\.(mp4|webm|mov)$/i.test(url.pathname)) return;

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
    safeCachePut(SHELL_CACHE, request, response.clone());
    return response;
  } catch (_) {
    const cached = await safeCacheMatch(request);
    if (cached) return cached;
    const offline = await safeCacheMatch('/offline.html');
    if (offline) return offline;
    return Response.error();
  }
}

async function handleManifest(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) {
      safeCachePut(SHELL_CACHE, MANIFEST_PATH, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await safeCacheMatch(MANIFEST_PATH);
    if (cached) return cached;
    return Response.error();
  }
}

async function handleBucket(request, bucketName) {
  const cached = await safeCacheMatch(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      safeCachePut(bucketName, request, response.clone());
    }
    return response;
  } catch (_) {
    return Response.error();
  }
}

async function handleRuntime(request) {
  const cached = await safeCacheMatch(request);
  const networkFetch = fetch(request)
    .then(response => {
      if (response && response.ok) {
        safeCachePut(RUNTIME_CACHE, request, response.clone());
      }
      return response;
    })
    .catch(() => Response.error());

  if (cached) return cached;
  return networkFetch;
}
