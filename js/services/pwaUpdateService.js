// ============================================
// PWA Update Service - Service Worker 更新管理
// ============================================

(function () {
  const VISIBLE_POLL_INTERVAL_MS = 5 * 60 * 1000;

  let registration = null;
  let isInitialized = false;
  let pollTimerId = null;
  let hasReloaded = false;
  let lastNotifiedWaitingWorker = null;

  function dispatchUpdateEvent(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  function clearPollTimer() {
    if (pollTimerId !== null) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
  }

  function notifyUpdateAvailable(source = 'unknown') {
    const waitingWorker = registration?.waiting;
    if (!waitingWorker) return false;
    if (lastNotifiedWaitingWorker === waitingWorker) return true;

    lastNotifiedWaitingWorker = waitingWorker;
    dispatchUpdateEvent('pwa:update-available', {
      source,
      scriptURL: waitingWorker.scriptURL || null,
    });
    return true;
  }

  function bindInstallingWorker(worker, source = 'updatefound') {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        notifyUpdateAvailable(source);
      }
    });
  }

  async function checkForUpdate() {
    if (!registration) return false;
    await registration.update();
    return notifyUpdateAvailable('check');
  }

  function applyUpdate() {
    const waitingWorker = registration?.waiting;
    if (!waitingWorker) return false;
    waitingWorker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  function startVisiblePoll() {
    clearPollTimer();
    pollTimerId = setInterval(() => {
      checkForUpdate().catch(error => {
        console.warn('[PWAUpdateService] Periodic update check failed:', error);
        dispatchUpdateEvent('pwa:update-error', {
          stage: 'periodic-check',
          error,
        });
      });
    }, VISIBLE_POLL_INTERVAL_MS);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      checkForUpdate().catch(error => {
        console.warn('[PWAUpdateService] Foreground update check failed:', error);
        dispatchUpdateEvent('pwa:update-error', {
          stage: 'visibility-check',
          error,
        });
      });
      startVisiblePoll();
      return;
    }
    clearPollTimer();
  }

  async function init() {
    if (isInitialized) return;
    isInitialized = true;

    if (!('serviceWorker' in navigator)) {
      console.warn('[PWAUpdateService] Service Worker is not supported in this browser');
      return;
    }

    // Dev 模式跳过 SW 注册（npm run dev 不该有 SW 干扰开发热更新）
    // 顺手 unregister 之前测试残留的 SW，避免老 SW 缓存干扰本地开发
    const hostname = window.location.hostname;
    const isDev = hostname === 'localhost' || hostname === '127.0.0.1';
    if (isDev) {
      console.info('[PWAUpdateService] Dev mode: skipping SW registration');
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
      } catch (_) { /* noop */ }
      return;
    }

    try {
      registration = await navigator.serviceWorker.register(
        new URL('sw.js', window.location.href),
        { updateViaCache: 'none' }
      );
    } catch (error) {
      dispatchUpdateEvent('pwa:update-error', {
        stage: 'register',
        error,
      });
      throw error;
    }

    registration.addEventListener('updatefound', () => {
      bindInstallingWorker(registration.installing, 'updatefound');
    });
    bindInstallingWorker(registration.installing, 'init-installing');

    // 首次访问时 navigator.serviceWorker.controller 为 null；
    // SW activate + claim 后 controllerchange 触发，但这是"安装"不是"更新"，不该 reload。
    const priorController = navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hasReloaded) return;
      if (priorController === null) {
        // 首次安装的 claim，跳过 reload，让玩家继续使用已经加载好的页面
        return;
      }
      hasReloaded = true;
      dispatchUpdateEvent('pwa:update-applied');
      window.location.reload();
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);

    try {
      await checkForUpdate();
    } catch (error) {
      console.warn('[PWAUpdateService] Initial update check failed:', error);
      dispatchUpdateEvent('pwa:update-error', {
        stage: 'initial-check',
        error,
      });
    }

    if (document.visibilityState === 'visible') {
      startVisiblePoll();
    }
  }

  /**
   * 拉取新版 install-manifest（用于"发现新版本"modal 算增量）。
   * 跳过任何缓存层，每次直奔网络。
   */
  async function getNewManifest() {
    try {
      const response = await fetch(
        '/install-manifest.json?nocache=' + Date.now(),
        { cache: 'reload' }
      );
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.warn('[PWAUpdateService] getNewManifest failed:', err);
      return null;
    }
  }

  window.pwaUpdateService = {
    init,
    checkForUpdate,
    applyUpdate,
    getNewManifest,
    getVisiblePollInterval() {
      return VISIBLE_POLL_INTERVAL_MS;
    },
  };
})();
