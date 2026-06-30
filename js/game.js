// ============================================
// AI Adventure Game - Main Entry Point
// ============================================

// 全局错误处理：只负责 toast 用户反馈。
// 错误的结构化遥测由 analyticsService 的 error.uncaught/error.rejection listener 处理
// （含完整 stack/url/line/col）；DevTools 由浏览器原生输出处理（onerror return false
// 不抑制 console 输出）。这里再 console.error 一次属于纯冗余，且经 console.error wrap
// 后会变成无意义的 "[object Object]" 噪声事件。
window.onerror = (msg, url, lineNo, columnNo, error) => {
  let errorDetail = error?.message || msg;
  if (url && lineNo) {
    const fileName = url.split('/').pop();
    errorDetail += ` (${fileName}:${lineNo})`;
  }

  if (typeof showToast === 'function') {
    showToast('发生错误:' + errorDetail);
  }
  return false;
};

window.addEventListener('unhandledrejection', event => {
  // 把 stack 打到 console，方便定位（console.error 不会被 build 期 strip）
  console.error('[unhandledrejection]', event.reason?.stack || event.reason);
  const message = event.reason?.message || '';
  // 存储/缓存类错误（设备空间满、浏览器存储损坏 → caches.open / IndexedDB 抛）不该把原始英文
  // 直接刷给用户：① 用户对单条无能为力 ② 后台预缓存会逐个 bucket 触发、刷一长串吓人的 toast。
  // 根因已在 installController 的悬挂 cache-put promise 处修掉；这里是兜底（拦其它来源），
  // 合并成每分钟最多一条友好提示，并阻止默认的"请求失败"toast。
  if (/CacheStorage|QuotaExceeded|exceeded the quota|storage is full/i.test(message)) {
    event.preventDefault();
    const now = Date.now();
    if (typeof showToast === 'function' && now - (window.__lastStorageWarnAt || 0) > 60000) {
      window.__lastStorageWarnAt = now;
      showToast('浏览器存储空间不足或损坏，部分缓存暂时失效，但不影响继续游玩；建议清理设备存储空间。');
    }
    return;
  }
  if (typeof showToast === 'function') {
    showToast('请求失败:' + (message || '未知错误'));
  }
});

// 初始问候语常量
const INITIAL_GREETING_ZH = `\ 全新的故事正等待揭开。在开始前，请告诉我两件事:

**1. 时间** - 你想从哪个年代或事件开始？
    - 具体时间 
    - 历史节点 

**2. 地点** - 你想从哪里开始？
    - 具体地点 
    - 边境/荒野/海上/其他

可一次性说明，或直接说"随机开始" / "以推荐剧情开始"。`;
const INITIAL_GREETING_EN = `\ A new story is waiting to unfold. Before we begin, tell me two things:

**1. Time** - When do you want to begin?
    - A specific date or time
    - A known historical moment

**2. Location** - Where do you want to start?
    - A specific place
    - A border, wilderness, at sea, or somewhere else

You can answer both at once, or simply say "Random Start" / "Start with the Recommended Opening".`;
const INITIAL_GREETING = INITIAL_GREETING_ZH;
window.INITIAL_GREETING = INITIAL_GREETING;
window.INITIAL_GREETING_EN = INITIAL_GREETING_EN;
function getLauncherThemeHintMeta(choice = window._launcherIntroThemeChoice) {
  return window.getLauncherWorldChoiceMeta?.(choice) || null;
}
function _getInlineActionLabel(zhText, enText) {
  return window.i18nService?.getResolvedLanguage?.() === 'en' ? enText : zhText;
}
function getGameInlineSettingsActionHTML() {
  return `<a class="chat-inline-action-settings" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">settings</span><span class="chat-inline-action-label">${_getInlineActionLabel('设置', 'Settings')}</span></a>`;
}
function getGameInlineResetActionHTML() {
  return `<a class="chat-inline-action-reset" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">restart_alt</span><span class="chat-inline-action-label">${_getInlineActionLabel('重置', 'Reset')}</span></a>`;
}
function getGameInlineSaveManagerActionHTML() {
  return `<a class="chat-inline-action-save-manager" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">save</span><span class="chat-inline-action-label">${_getInlineActionLabel('存档', 'Saves')}</span></a>`;
}
function getGameInlineDefaultWorldActionHTML() {
  return `<a class="chat-inline-action-default-world" data-action="chat-inline-action-btn" href="#"><span class="chat-inline-action-label">${_getInlineActionLabel('默认世界卡', 'Default World')}</span></a>`;
}

// 新手引导词（点"开始新旅程"时显示，纯静态文本，不需要 AI）
const ONBOARDING_GREETING = `\
<h2 class="onboarding-main-title">旅人，欢迎来到这片尚未书写的世界。</h2>

我是这个沙盒游戏的叙事引擎——一个由 AI 驱动的游戏主持人。这里没有预设的剧本，更没有任何世界观的限制。你不仅是玩家，更是创世者，只要你能想象，我们就能将它具象化。

你可以：
- 设定任意的世界背景：无论是赛博朋克的霓虹深渊、剑与魔法的奇幻大陆，还是深邃浩瀚的星际帝国；
- 搭建完整的社会生态：从底层的物理/魔法法则，到错综复杂的国家政权、种族势力与风土人情；
- 展开绝对自由的冒险：在你自己构建的舞台上探索未知、卷入阴谋，或是仅仅经营你理想中的生活。

但在冒险开始之前，你需要完成两件准备：

---

### 🔑 第一步：配置你的 AI 钥匙

点击顶部工具栏的 ${getGameInlineSettingsActionHTML()} 按键，在「通用设置」中填入你的 API Key。这是驱动我（你的 AI 游戏主持人）运转的能量来源——没有它，我将无法为你讲述任何故事。

请放心，作为纯本地运行的项目，你的 API Key 将完全保存在当前设备的浏览器中。你的设备会直接与 AI 供应商（如 DeepSeek）进行通讯，本游戏没有任何后台服务器。

---

### 🗺️ 第二步：获取一张世界卡

如果你熟悉 SillyTavern（酒馆），可以把世界卡理解为一种更宏大的「角色卡」——但它不只是定义一个角色的对话风格，而是构建一整个世界：

- **世界观与场景** — 地理、阵营、科技水平、风土人情
- **规则系统** — 经济体系、战斗机制、时间流转
- **角色群像** — 多个 NPC 各自有人格、立场、关系网络和认知状态
- **历史时间线** — 从远古到当下的大事件，影响着每个角色的命运
- **角色状态线** — 每个 NPC 随时间变化的认知、关系与处境

你可以通过以下方式获取世界卡：
- 点击顶部的「**沙盒 / 世界卡**」切换到 **世界卡**，与 AI 一起从零创建你的专属世界
- 或者导入一张已有的世界卡文件（通过 ${getGameInlineSaveManagerActionHTML()} 中的「导入世界卡」）

> 📌 启程指南：如果你刚才已经在欢迎界面选好了内置世界卡，直接开始就可以进入那张卡。若你只是想先看一个现成示例，${getGameInlineDefaultWorldActionHTML()} 仍然会打开轻奇幻默认世界卡。

---

当一切就绪后，点击顶部的 ${getGameInlineResetActionHTML()} 按键刷新界面——你的冒险便正式开始。`;
window.ONBOARDING_GREETING = ONBOARDING_GREETING;

function getOnboardingGreeting() {
  const themeHintMeta = getLauncherThemeHintMeta();
  const themeHint = themeHintMeta
    ? window.i18nService?.getResolvedLanguage?.() === 'en'
      ? themeHintMeta.hintEn
      : themeHintMeta.hint
    : '';
  if (window.i18nService?.getResolvedLanguage?.() === 'en') {
    return `\
<h2 class="onboarding-main-title">Traveler, welcome to a world that has not been written yet.</h2>

I am the narrative engine of this sandbox game, an AI-driven game master. There is no fixed script here, and there is no hard limit on the kind of world you can build.

You can:
- define any world background you want
- build a full social and rule structure
- explore freely, follow clues, or simply live inside a world you designed

${themeHint ? `> ${themeHint}\n` : ''}

Before the adventure begins, complete two steps:

---

### Step 1: Configure your AI key

Click ${getGameInlineSettingsActionHTML()} in the top toolbar and enter your API key in General settings. This is the power source that lets me run as your AI game master.

This project runs locally. Your API key stays in this browser and your device talks to the model provider directly.

---

### Step 2: Get a world card

Think of a world card as a large-scale setting card:
- world and locations
- rules and economy
- NPC cast and relationships
- timeline and history
- evolving character states

You can:
- switch to Design Mode and build a world from scratch with AI
- or import an existing world card through ${getGameInlineSaveManagerActionHTML()}

If you already picked a built-in world in the welcome flow, you can start there directly. If you only want a ready-made example, ${getGameInlineDefaultWorldActionHTML()} still opens the light-fantasy default world.

---

When everything is ready, click ${getGameInlineResetActionHTML()} and your adventure begins.`;
  }
  return `\
<h2 class="onboarding-main-title">旅人，欢迎来到这片尚未书写的世界。</h2>

我是这个沙盒游戏的叙事引擎——一个由 AI 驱动的游戏主持人。这里没有预设的剧本，更没有任何世界观的限制。你不仅是玩家，更是创世者，只要你能想象，我们就能将它具象化。

你可以：
- 设定任意的世界背景：无论是赛博朋克的霓虹深渊、剑与魔法的奇幻大陆，还是深邃浩瀚的星际帝国；
- 搭建完整的社会生态：从底层的物理/魔法法则，到错综复杂的国家政权、种族势力与风土人情；
- 展开绝对自由的冒险：在你自己构建的舞台上探索未知、卷入阴谋，或是仅仅经营你理想中的生活。

${themeHint ? `> ${themeHint}\n` : ''}

但在冒险开始之前，你需要完成两件准备：

---

### 🔑 第一步：配置你的 AI 钥匙

点击顶部工具栏的 ${getGameInlineSettingsActionHTML()} 按键，在「通用设置」中填入你的 API Key。这是驱动我（你的 AI 游戏主持人）运转的能量来源——没有它，我将无法为你讲述任何故事。

请放心，作为纯本地运行的项目，你的 API Key 将完全保存在当前设备的浏览器中。你的设备会直接与 AI 供应商（如 DeepSeek）进行通讯，本游戏没有任何后台服务器。

---

### 🗺️ 第二步：获取一张世界卡

如果你熟悉 SillyTavern（酒馆），可以把世界卡理解为一种更宏大的「角色卡」——但它不只是定义一个角色的对话风格，而是构建一整个世界：

- **世界观与场景** — 地理、阵营、科技水平、风土人情
- **规则系统** — 经济体系、战斗机制、时间流转
- **角色群像** — 多个 NPC 各自有人格、立场、关系网络和认知状态
- **历史时间线** — 从远古到当下的大事件，影响着每个角色的命运
- **角色状态线** — 每个 NPC 随时间变化的认知、关系与处境

你可以通过以下方式获取世界卡：
- 点击顶部的「**沙盒 / 世界卡**」切换到 **世界卡**，与 AI 一起从零创建你的专属世界
- 或者导入一张已有的世界卡文件（通过 ${getGameInlineSaveManagerActionHTML()} 中的「导入世界卡」）

> 📌 启程指南：面对无限的可能，不知从何下手？没关系。我为你准备了一份${getGameInlineDefaultWorldActionHTML()}，建议先踏入这个现成的世界四处看看。等你熟悉了这里的法则，再去构筑自己的天地也不迟。

---

当一切就绪后，点击顶部的 ${getGameInlineResetActionHTML()} 按键刷新界面——你的冒险便正式开始。`;
}

if (typeof window._showOnboarding !== 'boolean') {
  window._showOnboarding = false;
}

function getMissingApiKeyHint() {
  let worldName = '未知世界';
  if (typeof worldCardManager !== 'undefined') {
    const card = worldCardManager.getActiveCard?.();
    if (card && card.name) worldName = card.name;
  }
  if (window.i18nService?.getResolvedLanguage?.() === 'en') {
    return `Welcome to ${worldName}.\n\nClick ${getGameInlineSettingsActionHTML()} in the top-right corner to configure your AI API key.\n\nAfter that, type "Start" to begin the adventure.`;
  }
  return `欢迎来到${worldName}。\n\n请先点击右上角 ${getGameInlineSettingsActionHTML()} 配置您的 AI API Key。\n\n配置完成后，输入"开始"启动冒险。`;
}
function getPwaUpdatePromptTitle() {
  return window.i18nService?.getResolvedLanguage?.() === 'en' ? 'Update Ready' : '发现新版本';
}
function getPwaUpdatePromptDescription() {
  return window.i18nService?.getResolvedLanguage?.() === 'en'
    ? 'Download complete. Refresh to enter the latest version.'
    : '已下载完成，刷新页面进入最新版';
}
function getPwaUpdateHintLine() {
  return window.i18nService?.getResolvedLanguage?.() === 'en'
    ? 'Past changelogs are available via the version number in the bottom-left corner.'
    : '往期更新日志可点击左下角版本号查看';
}
const PWA_UPDATE_IDLE_CHECK_MS = 800;
const PWA_RELOAD_FALLBACK_MS = 5000;
const pwaUpdatePromptState = {
  pending: false,
  suppressedForSession: false,
  isModalOpen: false,
  idleTimerId: null,
  reloadFallbackTimerId: null,
};

function _isPwaBusyForUpdate() {
  if (isSending) return true;
  // PZWC 建造进行中也算忙（建造是 fire-and-forget，isSending 此时为 false）——
  // 别让 PWA 自动更新在建造中途重载页面把对话弄丢。
  if (window.pzwcDesignController?.isBuilding?.()) return true;
  const ds = window.designService;
  if (ds && ds.isAutoGenerating) return true;
  return false;
}

function _isLauncherActive() {
  if (window._launcherVisible === true) return true;
  const el = document.getElementById('launcher-overlay');
  return !!(el && !el.classList.contains('launcher--hidden'));
}

function _clearPwaUpdateIdleTimer() {
  if (pwaUpdatePromptState.idleTimerId !== null) {
    clearInterval(pwaUpdatePromptState.idleTimerId);
    pwaUpdatePromptState.idleTimerId = null;
  }
}

function _scheduleReloadFallback() {
  if (pwaUpdatePromptState.reloadFallbackTimerId !== null) return;
  pwaUpdatePromptState.reloadFallbackTimerId = setTimeout(() => {
    pwaUpdatePromptState.reloadFallbackTimerId = null;
    window.location.reload();
  }, PWA_RELOAD_FALLBACK_MS);
}

function _applyPwaUpdateNow() {
  const service = window.pwaUpdateService;
  if (!service || typeof service.applyUpdate !== 'function') {
    window.location.reload();
    return false;
  }

  const sent = service.applyUpdate();
  if (!sent) {
    window.location.reload();
    return false;
  }

  _scheduleReloadFallback();
  return true;
}

function _buildUpdateChangelogHtml(entry) {
  const header = `v${entry.version}${entry.date ? ' — ' + entry.date : ''}`;
  // changelog 条目可能内嵌富文本（如 v3.7 的「跳动代码」彩蛋 span）。该彩蛋
  // 仅在专门的 changelog 弹窗（launcher.js 走 innerHTML）生效；此处 PWA 更新
  // 提示走 escapeHTML 安全网，先剥标签降级为可读纯文本，避免转义成标签乱码。
  const items = (entry.changes || [])
    .map(
      c =>
        `<li>${escapeHTML(
          String(c)
            .replace(/<[^>]*>/g, '')
            .replace(/^[\s•·.]+/, '')
        )}</li>`
    )
    .join('');
  return `<h4 class="modal-changelog__title">${escapeHTML(header)}</h4><ul class="modal-changelog__list">${items}</ul>`;
}

async function _showPwaUpdatePrompt() {
  if (pwaUpdatePromptState.suppressedForSession || pwaUpdatePromptState.isModalOpen) return;
  const modal = document.getElementById('confirm-modal');
  if (modal && !modal.classList.contains('hidden')) {
    pwaUpdatePromptState.pending = true;
    _schedulePwaUpdatePromptWhenIdle();
    return;
  }

  pwaUpdatePromptState.pending = false;
  pwaUpdatePromptState.isModalOpen = true;

  let changelogHtml = '';
  try {
    if (window.changelogService) {
      const data = await window.changelogService.loadChangelog({ fresh: true, timeoutMs: 1500 });
      const locale = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
      const entry = window.changelogService.getEntriesForLocale(data, locale)[0];
      if (entry) changelogHtml = _buildUpdateChangelogHtml(entry);
    }
  } catch (e) {
    console.warn('[PWA] Failed to load fresh changelog:', e);
  }

  const baseDesc = getPwaUpdatePromptDescription();
  const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
  const inLauncher = _isLauncherActive();
  const labelReady = isEn ? 'Update Now' : '立即更新';
  const labelDownloading = (pct) =>
    isEn ? `Update Now (downloading ${pct}%)` : `立即更新（下载中 ${pct}%）`;
  const labelRetry = isEn ? 'Update Now (retry)' : '立即更新（重试）';

  // 顶部进度条标记
  const progressHtml =
    '<div class="pwa-update-progress-track"><div class="pwa-update-progress-bar" style="width:0%"></div></div>';

  const modalOptions = {
    confirmLabel: labelDownloading(0),
    hideCancel: inLauncher,
  };
  if (!inLauncher) {
    modalOptions.cancelLabel = isEn ? 'Update on next refresh' : '下次刷新时更新';
  }
  modalOptions.descriptionHtml =
    progressHtml +
    `<p class="modal-description__lead">${escapeHTML(baseDesc)}</p>` +
    `<p class="pwa-update-hint">${escapeHTML(getPwaUpdateHintLine())}</p>` +
    (changelogHtml || '');

  // 下载完成前禁用主按钮；点击 callback 在 disabled 状态下不会触发
  let downloadComplete = false;
  let retryMode = false;

  const onConfirm = () => {
    if (!downloadComplete && !retryMode) return;
    if (retryMode) {
      retryMode = false;
      downloadComplete = false;
      startDownload();
      return;
    }
    pwaUpdatePromptState.isModalOpen = false;
    pwaUpdatePromptState.suppressedForSession = true;
    _clearPwaUpdateIdleTimer();
    _applyPwaUpdateNow();
  };

  const onCancel = inLauncher
    ? null
    : () => {
        pwaUpdatePromptState.isModalOpen = false;
        _clearPwaUpdateIdleTimer();
        // 中止正在进行的下载（保留已下载部分到新桶，下次接着下）
        try { window.installController?.abortUpdate?.(); } catch (_) {}
      };

  showConfirmModal(
    getPwaUpdatePromptTitle(),
    baseDesc,
    onConfirm,
    onCancel,
    modalOptions
  );

  // 模态展示后，找 DOM 元素并启动下载
  const confirmBtn = document.getElementById('confirm-ok-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.classList.add('is-loading');
  }
  const progressBar = document.querySelector('.pwa-update-progress-bar');

  const updateProgress = (percent) => {
    const p = Math.max(0, Math.min(100, percent));
    if (progressBar) progressBar.style.width = p + '%';
    if (confirmBtn) confirmBtn.textContent = labelDownloading(Math.floor(p));
  };

  const onComplete = () => {
    downloadComplete = true;
    retryMode = false;
    if (progressBar) progressBar.style.width = '100%';
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('is-loading');
      confirmBtn.textContent = labelReady;
    }
  };

  const onError = (file, err) => {
    console.warn('[PWA] Update prefetch error:', file, err);
    retryMode = true;
    downloadComplete = false;
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.classList.remove('is-loading');
      confirmBtn.textContent = labelRetry;
    }
  };

  const startDownload = async () => {
    if (progressBar) progressBar.style.width = '0%';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.classList.add('is-loading');
      confirmBtn.textContent = labelDownloading(0);
    }

    let newManifest = null;
    try {
      newManifest = await window.pwaUpdateService?.getNewManifest?.();
    } catch (_) {}

    // installController 不可用 / 没新 manifest → 直接放开按钮（走老的 SKIP_WAITING 流程）
    if (!newManifest || !window.installController?.prefetchUpdate) {
      onComplete();
      return;
    }

    try {
      await window.installController.prefetchUpdate(newManifest, {
        onProgress: ({ percent }) => updateProgress(percent),
        onComplete,
        onError,
      });
    } catch (err) {
      onError(null, err);
    }
  };

  startDownload();
}

function _schedulePwaUpdatePromptWhenIdle() {
  if (pwaUpdatePromptState.idleTimerId !== null) return;

  pwaUpdatePromptState.idleTimerId = setInterval(() => {
    if (pwaUpdatePromptState.suppressedForSession || !pwaUpdatePromptState.pending) {
      _clearPwaUpdateIdleTimer();
      return;
    }

    const modal = document.getElementById('confirm-modal');
    const modalBusy = modal && !modal.classList.contains('hidden');
    if (!_isPwaBusyForUpdate() && !modalBusy) {
      _clearPwaUpdateIdleTimer();
      _showPwaUpdatePrompt();
    }
  }, PWA_UPDATE_IDLE_CHECK_MS);
}

function _handlePwaUpdateAvailable() {
  if (pwaUpdatePromptState.suppressedForSession) return;

  if (_isPwaBusyForUpdate()) {
    pwaUpdatePromptState.pending = true;
    _schedulePwaUpdatePromptWhenIdle();
    return;
  }

  _showPwaUpdatePrompt();
}

function setupPwaUpdateFlow() {
  const protocol = window.location.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') {
    console.info('[PWA] Skip update service on unsupported protocol:', protocol);
    return;
  }

  const service = window.pwaUpdateService;
  if (!service || typeof service.init !== 'function') {
    console.warn('[PWA] pwaUpdateService unavailable');
    return;
  }

  window.addEventListener('pwa:update-available', _handlePwaUpdateAvailable);
  window.addEventListener('pwa:update-error', event => {
    const stage = event?.detail?.stage || 'unknown';
    const error = event?.detail?.error;
    console.warn('[PWA] Update check failed:', stage, error || '');
  });

  service.init().catch(error => {
    console.error('[PWA] Failed to initialize update service:', error);
  });
}

/**
 * 获取有效的开场白（优先使用当前世界卡格式）
 */
function getEffectiveGreeting() {
  const runtimeGreeting = getRuntimeWorldGreeting();
  if (runtimeGreeting) {
    return runtimeGreeting;
  }
  return window.i18nService?.getResolvedLanguage?.() === 'en'
    ? INITIAL_GREETING_EN
    : INITIAL_GREETING_ZH;
}

/**
 * 获取运行时世界卡开场白（仅返回有效非空字符串）
 * @returns {string|null}
 */
function getRuntimeWorldGreeting() {
  const runtimeGreeting = window.worldMeta?.getOpeningGreeting?.();
  if (typeof runtimeGreeting === 'string' && runtimeGreeting.trim()) {
    return runtimeGreeting.trim();
  }
  return null;
}

/**
 * 判断文本是否为默认开场白
 * 兼容早期默认文案前缀
 * @param {string} text
 * @returns {boolean}
 */
function isDefaultOpeningGreeting(text) {
  if (typeof text !== 'string') return false;
  const normalized = text.trim();
  if (!normalized) return false;
  if (normalized === INITIAL_GREETING_ZH.trim() || normalized === INITIAL_GREETING_EN.trim())
    return true;
  return (
    normalized.startsWith('全新的故事正等待揭开') ||
    normalized.startsWith('A new story is waiting to unfold')
  );
}

/**
 * 加载存档后同步开场白：
 * 仅当第一条 AI 消息是默认开场白时，替换为当前世界卡开场白
 * @param {Array<object>} history
 * @returns {{ changed: boolean, reason?: string }}
 */
function syncLoadedOpeningGreeting(history) {
  if (!Array.isArray(history)) {
    return { changed: false, reason: 'invalid_history' };
  }

  const worldGreeting = getRuntimeWorldGreeting();
  if (!worldGreeting) {
    return { changed: false, reason: 'empty_world_greeting' };
  }

  const firstAiIndex = history.findIndex(msg => msg && msg.sender === 'ai');
  if (firstAiIndex === -1) {
    return { changed: false, reason: 'missing_ai_message' };
  }

  const firstAiMsg = history[firstAiIndex];
  if (!isDefaultOpeningGreeting(firstAiMsg.text)) {
    return { changed: false, reason: 'first_ai_not_default_greeting' };
  }

  firstAiMsg.text = worldGreeting;
  if (!firstAiMsg.uid) {
    firstAiMsg.uid = typeof generateTurnUID === 'function' ? generateTurnUID(0) : 'turn_0_initial';
  }
  return { changed: true };
}
window.syncLoadedOpeningGreeting = syncLoadedOpeningGreeting;

/**
 * 进入沙盒时的空历史兜底
 * @returns {{ needsApiKeyHint: boolean }}
 */
function ensureGameModeSeedMessage() {
  if (!Array.isArray(chatHistory) || chatHistory.length > 0) {
    return { needsApiKeyHint: false };
  }

  // 防护：世界卡下 chatHistory 可能是 designChatHistory 的别名，
  // 此时绝不能 push 游戏开场白进去（详见司机案例：游戏开场词污染 designChatHistory）
  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    console.warn(
      '[ensureGameModeSeedMessage] 跳过：当前处于世界卡，避免污染 designChatHistory'
    );
    return { needsApiKeyHint: false };
  }

  const reactApiKey =
    typeof aiService !== 'undefined' && typeof aiService.getApiKeyForModule === 'function'
      ? aiService.getApiKeyForModule('react')
      : null;
  if (!reactApiKey) {
    return { needsApiKeyHint: true };
  }

  const turn0UID = typeof generateTurnUID === 'function' ? generateTurnUID(0) : 'turn_0_initial';
  const greeting = getEffectiveGreeting();
  if (greeting && greeting.trim()) {
    chatHistory.push({ sender: 'ai', text: greeting, uid: turn0UID });
  }

  return { needsApiKeyHint: false };
}

// 全局状态变量定义在 js/core/GameState.js
// chatHistory, currentSlotId, isSending

// --- GAME STATE ---

// 旧函数名保留 1 个版本：统一转发到 sessionManager
function saveGame(options = {}) {
  if (window.sessionManager && typeof window.sessionManager.saveGame === 'function') {
    return window.sessionManager.saveGame(options);
  }
  return {
    ok: false,
    worldCardId: null,
    slotId: null,
    saveName: null,
    reason: 'sessionManager 未加载',
    errors: [],
  };
}
window.saveGame = saveGame;

function autoSaveGame() {
  if (window.sessionManager && typeof window.sessionManager.autoSaveGame === 'function') {
    return window.sessionManager.autoSaveGame();
  }
  return {
    ok: false,
    worldCardId: null,
    slotId: null,
    saveName: null,
    reason: 'sessionManager 未加载',
    errors: [],
  };
}
window.autoSaveGame = autoSaveGame;

// 关闭 / 切到后台时兜底存。游戏模式原本没有离场自动存（设计模式另有，见 designService），
// 而 autoSaveGame 只在回合结束后触发 → "玩家已发消息、AI 还没回完"这段途中关页/崩溃会整段丢失。
// visibilitychange→hidden 是移动端 / PWA 被冻结或杀进程前最可靠的存盘时机；pagehide 覆盖真正导航离开。
// autoSaveGame 自带 requiresSave / 无槽位守卫，重复触发是廉价空操作；仅游戏模式触发（设计模式有自己的
// 离场保存，避免双写）。IndexedDB 写是异步、关页时只能尽力——但严格优于此前的"什么都不存"。
(function bindGameUnloadAutoSave() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const saveOnLeave = () => {
    if (window.isDesignMode) return;
    try {
      autoSaveGame();
    } catch (_) {
      /* 兜底存永不打断页面卸载 */
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveOnLeave();
  });
  window.addEventListener('pagehide', saveOnLeave);
})();

/**
 * 恢复世界卡（按传入的归属世界卡 ID）
 * @param {string|null} worldCardId
 * @param {{ silent?: boolean }} [options]
 * @returns {{ ok: boolean, worldCardId: string|null, reason: string|null }}
 */
function restoreWorldCard(worldCardId, options = {}) {
  const mgr = window.worldCardManager;
  const { silent = false } = options;

  function _fail(reason) {
    if (!silent && typeof showToast === 'function') {
      showToast(reason);
    }
    return { ok: false, worldCardId: null, reason };
  }

  if (!mgr) {
    return _fail('worldCardManager 未就绪，无法恢复世界卡');
  }

  // 统一路径：null/空值 → 当前激活卡
  const targetId = worldCardId || mgr?.getActiveCardId?.() || null;

  if (!targetId) {
    console.warn('[restoreWorldCard] 无可用世界卡');
    return _fail('请先导入或创建世界卡');
  }

  const card = mgr.get(targetId);
  if (!card) {
    console.warn('[restoreWorldCard] 世界卡不存在:', targetId);
    if (worldCardId) {
      return _fail('此存档关联的世界卡不存在，请先导入对应世界卡');
    }
    return _fail('世界卡不存在');
  }

  // 所有世界卡统一路径
  const activateResult = mgr.setActiveCard(card.id);
  if (!activateResult || activateResult.ok === false) {
    const reason = activateResult?.reason || '未知错误';
    console.warn('[restoreWorldCard] 世界卡激活失败:', card.id, reason);
    return _fail(`世界卡激活失败：${reason}`);
  }
  // 信息隔离不变式：激活卡游玩不触碰设计态（designConfig / designChatHistory / phase）。
  // 设计态只属于设计会话——写入方仅限 PZWC 建造、loadCardIntoDesignMode 显式编辑入口、P3 patch 引擎。
  // （历史上这里把 card.snapshot 镜像进 designService 并落盘，导致空设计会话显示游玩中的卡，
  //   且载档会覆盖未完成的设计草稿，2026-06-12 拆除。）
  return { ok: true, worldCardId: card.id, reason: null };
}
window.restoreWorldCard = restoreWorldCard;

function clearAIServiceCaches() {
  if (window.sessionManager && typeof window.sessionManager.clearAIServiceCaches === 'function') {
    return window.sessionManager.clearAIServiceCaches();
  }
  return undefined;
}
window.clearAIServiceCaches = clearAIServiceCaches;

function loadGame(worldCardId = null, slotId = null) {
  if (window.sessionManager && typeof window.sessionManager.loadGame === 'function') {
    if (worldCardId && typeof worldCardId === 'object') {
      return window.sessionManager.loadGame(worldCardId);
    }
    return window.sessionManager.loadGame({ worldCardId, slotId });
  }
  return {
    ok: false,
    worldCardId: null,
    slotId: null,
    saveName: null,
    reason: 'sessionManager 未加载',
    errors: [],
  };
}
window.loadGame = loadGame;

function resetGame(options = {}) {
  if (window.sessionManager && typeof window.sessionManager.startNewGame === 'function') {
    if (options && typeof options === 'object') {
      return window.sessionManager.startNewGame(options);
    }
    return window.sessionManager.startNewGame({});
  }
  return {
    ok: false,
    worldCardId: null,
    slotId: null,
    saveName: null,
    reason: 'sessionManager 未加载',
    errors: [],
  };
}
window.resetGame = resetGame;

function resolveResetTargetWorldCardId() {
  const sessionWorldId = window.sessionManager?.getSessionSaveState?.()?.worldCardId || null;
  if (typeof sessionWorldId === 'string' && sessionWorldId.trim()) {
    return sessionWorldId.trim();
  }

  const activeWorldId = window.worldCardManager?.getActiveCardId?.() || null;
  if (typeof activeWorldId === 'string' && activeWorldId.trim()) {
    return activeWorldId.trim();
  }

  return null;
}

// --- TOAST ---
function showToast(message, type = '', duration = 3000) {
  if (typeof type === 'number') { duration = type; type = ''; }
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const typeMap = { info: 'info', success: 'success', warning: 'warning', danger: 'danger', error: 'danger' };
  const variantClass = typeMap[type] ? ` toast-${typeMap[type]}` : '';
  toast.className = `toast${variantClass}`;
  const translated = window.i18nService?.translateLegacyText?.(message) || message;
  toast.textContent = translated;
  container.appendChild(toast);

  // 移除 toast
  setTimeout(() => {
    toast.remove();
  }, duration);
}

// --- MODALS ---
let _confirmCallback = null;
let _confirmCancelCallback = null;

function _confirmEscapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "此操作不可撤销。" 类不可逆警告：统一抽成红字、另起一行。
// 在 confirm-modal 集中处理，所有走 showConfirmModal 的弹窗自动生效。
const _IRREVERSIBLE_PHRASES = [
  '此操作不可撤销。',
  'This action cannot be undone.',
  'This cannot be undone.',
];
function _renderIrreversibleHtml(text) {
  const raw = String(text ?? '');
  for (const phrase of _IRREVERSIBLE_PHRASES) {
    const idx = raw.indexOf(phrase);
    if (idx === -1) continue;
    const before = raw.slice(0, idx);
    const after = raw.slice(idx + phrase.length);
    return (
      `${_confirmEscapeHtml(before)}` +
      `<div class="confirm-irreversible-line">` +
      `<span style="color: var(--status-danger);">${_confirmEscapeHtml(phrase)}</span>` /* ui-lint-allow: 不可逆警告红字，token 化，项目内部规范 钦定 _renderIrreversibleHtml 模式 */ +
      `${_confirmEscapeHtml(after)}</div>`
    );
  }
  return null;
}

function showConfirmModal(title, description, callback, cancelCallback = null, options = {}) {
  const modal = document.getElementById('confirm-modal');
  const translatedTitle = window.i18nService?.translateLegacyText?.(title) || title;
  const translatedDescription =
    window.i18nService?.translateLegacyText?.(description) || description;
  const iconEl = modal.querySelector('#confirm-modal-icon');
  const titleEl = modal.querySelector('#confirm-modal-title-text');
  const confirmBtn = document.getElementById('confirm-ok-btn');
  const descEl = modal.querySelector('.modal-description');
  const iconName = String(options?.icon || 'help').trim() || 'help';

  if (iconEl) iconEl.textContent = iconName;
  if (titleEl) titleEl.textContent = translatedTitle;

  const irreversibleHtml = options?.descriptionHtml
    ? null
    : _renderIrreversibleHtml(translatedDescription);
  const hasRichDescription = !!options?.descriptionHtml;
  if (descEl) {
    // 仅 descriptionHtml 用 --rich（左对齐+滚动）；不可逆自动包装保持普通居中确认样式
    descEl.classList.toggle('modal-description--rich', hasRichDescription);
    if (options?.descriptionHtml) {
      descEl.innerHTML = options.descriptionHtml;
    } else if (irreversibleHtml) {
      descEl.innerHTML = irreversibleHtml;
    } else {
      descEl.textContent = translatedDescription;
    }
  }

  if (confirmBtn) {
    confirmBtn.classList.toggle('btn-danger', options?.confirmTone === 'danger');
    if (!confirmBtn.dataset.defaultLabel) {
      confirmBtn.dataset.defaultLabel = confirmBtn.textContent;
    }
    confirmBtn.textContent = options?.confirmLabel || confirmBtn.dataset.defaultLabel;
  }
  const cancelBtn = modal.querySelector('#confirm-cancel-btn');
  if (cancelBtn) {
    const hideCancel = !!options?.hideCancel;
    cancelBtn.classList.toggle('hidden', hideCancel);
    cancelBtn.style.display = hideCancel ? 'none' : '';
    if (!cancelBtn.dataset.defaultLabel) {
      cancelBtn.dataset.defaultLabel = cancelBtn.textContent;
    }
    cancelBtn.textContent = options?.cancelLabel || cancelBtn.dataset.defaultLabel;
  }
  _confirmCallback = callback;
  _confirmCancelCallback = typeof cancelCallback === 'function' ? cancelCallback : null;
  modal.classList.remove('hidden');
}
window.showConfirmModal = showConfirmModal;

function showAlertModal(title, description, callback = null, options = {}) {
  showConfirmModal(title, description, () => {
    if (typeof callback === 'function') callback();
  }, null, {
    icon: 'info',
    confirmLabel: '好',
    ...options,
    hideCancel: true,
  });
}
window.showAlertModal = showAlertModal;

function returnToLauncherOverlay() {
  if (typeof window.showLauncherOverlay === 'function') {
    window.showLauncherOverlay();
    return;
  }

  const launcherEl = document.getElementById('launcher-overlay');
  if (!launcherEl) {
    showToast('返回失败：开始界面未加载');
    return;
  }

  launcherEl.classList.remove('launcher--turnstile-exit');
  launcherEl.classList.remove('launcher--hidden');
  window._launcherVisible = true;
}

function _releaseTransitionLockForHome(source = 'return-home') {
  const mgr = window.sessionManager;
  if (!mgr || typeof mgr.releaseTransitionLock !== 'function') return;
  mgr.releaseTransitionLock(source);
}

function _acquireTransitionLockForHome(source = 'return-home') {
  const mgr = window.sessionManager;
  if (!mgr || typeof mgr.acquireTransitionLock !== 'function') {
    return { ok: true, reason: null };
  }
  return mgr.acquireTransitionLock(source);
}

function _resolveBlockedWorldCardIdForHome(saveResult) {
  const fromResult = String(saveResult?.blockedWorldCardId || saveResult?.worldCardId || '').trim();
  if (fromResult) return fromResult;
  return window.worldCardManager?.getActiveCardId?.() || null;
}

function _runReturnHomeAfterAutoSave(lockSource = 'return-home') {
  if (typeof window.runTransitionAutoSaveGuard === 'function') {
    window.runTransitionAutoSaveGuard({
      lockSource,
      onReady: () => {
        returnToLauncherOverlay();
        return true;
      },
      failurePrefix: '返回失败',
    });
    return;
  }

  returnToLauncherOverlay();
  _releaseTransitionLockForHome(lockSource);
}

function handleLogoReturnHomeRequest() {
  if (isSending) {
    showToast('请等待回复完成后再返回开始界面');
    return;
  }

  showConfirmModal('返回开始界面', '确定后将自动保存当前进度，并回到开始界面。', () =>
    _runReturnHomeAfterAutoSave('return-home')
  );
}

function setupHeaderLogoReturnHome() {
  const logoTrigger = document.getElementById('home-logo-trigger');
  if (!logoTrigger || logoTrigger.dataset.returnHomeBound === '1') return;

  logoTrigger.addEventListener('click', () => {
    handleLogoReturnHomeRequest();
  });

  logoTrigger.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
    event.preventDefault();
    handleLogoReturnHomeRequest();
  });

  logoTrigger.dataset.returnHomeBound = '1';
}

function setupTitleTips() {
  try { localStorage.removeItem('header-toolbar-collapsed'); } catch (_) {}

  const trigger = document.getElementById('title-tips-trigger');
  if (!trigger || trigger.dataset.tipsSetup === '1') return;
  trigger.dataset.tipsSetup = '1';

  function bindHandlers() {
    if (trigger.dataset.tipsBound === '1') return;

    function handleTipsClick() {
      if (typeof getRandomTip !== 'function') return;
      trigger.classList.remove('title-tips-bounce');
      void trigger.offsetWidth;
      trigger.classList.add('title-tips-bounce');
      showToast(getRandomTip());
    }

    trigger.addEventListener('click', handleTipsClick);
    trigger.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
      event.preventDefault();
      handleTipsClick();
    });
    trigger.addEventListener('animationend', () => {
      trigger.classList.remove('title-tips-bounce');
    });

    trigger.dataset.tipsBound = '1';
  }

  // trigger 在 ≤900px 被 CSS 隐藏；跨断点 resize 到桌面端时再绑（once）
  const mq = window.matchMedia('(min-width: 901px)');
  if (mq.matches) bindHandlers();
  const onMqChange = e => { if (e.matches) bindHandlers(); };
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onMqChange);
  } else if (typeof mq.addListener === 'function') {
    mq.addListener(onMqChange);
  }
}

function setupModals() {
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('cancel-settings-btn').addEventListener('click', closeSettings);
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);

  document.getElementById('reset-btn').addEventListener('click', () => {
    const resetTitle = _getInlineActionLabel('全部重置', 'Reset All');
    const resetDescription = _getInlineActionLabel(
      '确定要重置吗？聊天记录和设计配置将被清除（存档和设置不受影响）。',
      'Reset now? Chat history and design settings will be cleared. Saves and app settings will stay intact.'
    );
    const resetDoneToast = _getInlineActionLabel('已全部重置', 'Everything was reset.');
    showConfirmModal(
      resetTitle,
      resetDescription,
      () => {
        // 设计模式下重置不能 seed 游戏开场词——会和 P1 工坊问候语撞屏，且 sessionManager
        // 把 chatHistory/designChatHistory 各自重置为新数组又破坏了 mode-toggle 的 alias，
        // 在 AI streaming 期间按 reset 时（_shouldDeferChatRefresh=true）容易出现"游戏开场
        // 词残留 + 设计 chip 同屏"的 bug（2026-05-25 修复）。
        const inDesignMode = typeof isDesignMode !== 'undefined' && isDesignMode;
        const resetResult =
          window.sessionManager && typeof window.sessionManager.resetSessionState === 'function'
            ? window.sessionManager.resetSessionState({
                worldCardId: resolveResetTargetWorldCardId(),
                silent: true,
                seedGameGreeting: !inDesignMode,
                preserveSlotBinding: true,
              })
            : null;
        if (!resetResult || resetResult.ok === false) {
          showToast(
            _getInlineActionLabel(
              `重置失败：${resetResult?.reason || 'sessionManager 未加载'}`,
              `Reset failed: ${resetResult?.reason || 'sessionManager unavailable'}`
            )
          );
          return;
        }
        if (window.designService) {
          window.designService.resetDesignConfig();
        }
        // sessionManager 把两个数组各重置为新对象、破坏了 mode-toggle 的 alias。
        // 设计模式下重建 alias：把 resetDesignConfig push 的 P1 问候语合并进 designChatHistory，
        // 再让 chatHistory 指回同一份。否则下次 mode toggle 会读到错位的旧引用。
        if (
          inDesignMode &&
          typeof chatHistory !== 'undefined' &&
          typeof designChatHistory !== 'undefined' &&
          chatHistory !== designChatHistory
        ) {
          designChatHistory.length = 0;
          for (const m of chatHistory) designChatHistory.push(m);
          chatHistory = designChatHistory;
        }
        // 强制刷新一次，覆盖 _shouldDeferChatRefresh 推迟期间可能残留的旧 DOM（含 AI streaming
        // 期间按 reset 的现场）
        if (typeof refreshChatUI === 'function') {
          refreshChatUI({ scrollMode: 'bottom' });
        }
        showToast(resetDoneToast);
      },
      null,
      { icon: 'restart_alt', confirmTone: 'danger' }
    );
  });
  document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-ok-btn')?.classList.remove('btn-danger');
    if (_confirmCancelCallback) {
      _confirmCancelCallback();
    }
    _confirmCallback = null;
    _confirmCancelCallback = null;
  });
  document.getElementById('confirm-ok-btn').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    document.getElementById('confirm-ok-btn')?.classList.remove('btn-danger');
    if (_confirmCallback) {
      _confirmCallback();
    }
    _confirmCallback = null;
    _confirmCancelCallback = null;
  });

  // 聊天消息删除确认弹窗
  document
    .getElementById('chat-delete-confirm-btn')
    .addEventListener('click', confirmDeleteChatMessage);
  document
    .getElementById('chat-delete-cancel-btn')
    .addEventListener('click', cancelDeleteChatMessage);
}

// 输入框自动调整高度 - 现在由 chatCore.js 处理

async function _ensureWorldCardsReadyForBoot() {
  const mgr = window.worldCardManager;
  if (!mgr || typeof mgr.ensureReady !== 'function') return;
  try {
    await mgr.ensureReady();
  } catch (error) {
    console.error('[Game] 等待 worldCardManager 就绪失败:', error);
  }
}

function _getBootWorldCardIds() {
  const mgr = window.worldCardManager;
  if (!mgr || typeof mgr.list !== 'function') return [];
  return mgr
    .list()
    .map(card => (typeof card?.id === 'string' ? card.id.trim() : ''))
    .filter(Boolean);
}

async function _worldHasBootProgress(worldId) {
  const normalizedWorldId = typeof worldId === 'string' ? worldId.trim() : '';
  if (!normalizedWorldId || typeof saveManager === 'undefined') return false;
  const saves =
    typeof saveManager.getSaveList === 'function'
      ? await saveManager.getSaveList(normalizedWorldId, { allowRepair: false })
      : {};
  return Boolean(saves && Object.keys(saves).length > 0);
}

async function _getBootPreferredWorldCardId() {
  if (typeof saveManager === 'undefined') return null;
  const activeWorldId = window.worldCardManager?.getActiveCardId?.() || null;
  const worldIds = _getBootWorldCardIds();

  if (activeWorldId && (await _worldHasBootProgress(activeWorldId))) return activeWorldId;
  for (const worldId of worldIds) {
    if (await _worldHasBootProgress(worldId)) return worldId;
  }
  return null;
}

// --- INITIALIZATION ---
const _initGame = async () => {
  // 检测启动器是否可见（由 launcher.js 设置）
  const launcherEl = document.getElementById('launcher-overlay');
  const launcherVisible = launcherEl && !launcherEl.classList.contains('launcher--hidden');
  let shouldOpenSaveManagerOnBoot = false;
  let bootPreferredWorldCardId = null;

  // 如果没有启动器，按原始流程加载游戏
  if (!launcherVisible) {
    await _ensureWorldCardsReadyForBoot();
    bootPreferredWorldCardId = await _getBootPreferredWorldCardId();
    shouldOpenSaveManagerOnBoot = Boolean(bootPreferredWorldCardId);
    if (!shouldOpenSaveManagerOnBoot) {
      await loadGame();
    }
  }

  // 这些设置调用是安全的，只绑定事件监听器
  setupSettingsUI();
  setupModals();
  setupHeaderLogoReturnHome();
  setupTitleTips();
  setupPwaUpdateFlow();
  setupSaveManagerUI();
  setupDebugUI();
  // 移动端侧栏抽屉机制已随 stage-router 永久启用而移除（见 js/ui/drawerUI.js 头注释）

  // 🔧 请求通知权限（iOS 后台通知支持）
  // 延迟执行，确保 Capacitor 完全加载
  setTimeout(() => {
    if (window.backgroundService) {
      console.log('[Game] Requesting notification permission...');
      window.backgroundService.requestNotificationPermission();
    }
  }, 1000);

  // 延迟初始化聊天内容的逻辑（启动器隐藏后由 launcher.js 调用）
  window._launcherGameInit = function () {
    const runInit = () =>
      setTimeout(() => {
        if (window._skipLauncherGameSeedOnce === true) {
          window._skipLauncherGameSeedOnce = false;
          return;
        }
        const shouldShowLegacyOnboarding = window._showOnboarding === true;
        if (window._showOnboarding) {
          chatHistory = [];
          const turn0UID =
            typeof generateTurnUID === 'function' ? generateTurnUID(0) : 'turn_0_initial';
          chatHistory.push({
            sender: 'ai',
            text: getOnboardingGreeting(),
            uid: turn0UID,
            isOnboarding: true,
          });
          if (typeof refreshChatUI === 'function') {
            refreshChatUI({ scrollMode: 'bottom' });
          }
          window._launcherIntroThemeChoice = null;
          window._launcherIntroThemeChoiceLabel = '';
          window._showOnboarding = false;
        }

        // 检查主要模块(react)的 API Key 是否已配置
        const reactApiKey = aiService.getApiKeyForModule('react');
        if (!reactApiKey) {
          // 没有 API Key，显示提示
          if (!shouldShowLegacyOnboarding && typeof addMessage === 'function') {
            addMessage(getMissingApiKeyHint(), 'AI', 'ai');
          }
          openSettings('api');
        } else if (!shouldShowLegacyOnboarding && chatHistory.length === 0) {
          // 新游戏，显示初始问候语
          const turn0UID =
            typeof generateTurnUID === 'function' ? generateTurnUID(0) : 'turn_0_initial';
          const greeting = getEffectiveGreeting();
          if (greeting && greeting.trim()) {
            chatHistory.push({ sender: 'ai', text: greeting, uid: turn0UID });
          }
          if (typeof refreshChatUI === 'function') {
            refreshChatUI({ scrollMode: 'bottom' });
          }
        }
        // 注意:如果有存档，在 loadGame() 中已经调用过 refreshChatUI()，这里不需要重复调用
      }, 100);

    const mgr = window.worldCardManager;
    if (mgr && typeof mgr.ensureReady === 'function') {
      mgr
        .ensureReady()
        .catch(error => {
          console.error('[Game] _launcherGameInit 等待 worldCardManager 失败:', error);
        })
        .finally(runInit);
      return;
    }
    runInit();
  };

  // 如果没有启动器，立即执行游戏初始化
  if (!launcherVisible) {
    if (shouldOpenSaveManagerOnBoot && typeof openSaveManager === 'function') {
      // saves 现在是 stage，openSaveManager 内部走 stageRouter 导航
      openSaveManager(
        bootPreferredWorldCardId ? { preferredWorldCardId: bootPreferredWorldCardId } : {}
      );
    } else {
      window._launcherGameInit();
    }
  }

  function _readDesignDraftMetaForRestore() {
    if (typeof window.getStoredDesignDraftSnapshot === 'function') {
      return window.getStoredDesignDraftSnapshot().meta || null;
    }
    try {
      const metaStr = localStorage.getItem('design_mode_meta');
      return metaStr ? JSON.parse(metaStr) : null;
    } catch (e) {
      console.warn('[Game] 读取设计草稿元数据失败:', e);
      return null;
    }
  }

  function _getDesignRestorePhaseLabel(meta) {
    const phase = meta?.phase || 'pzwc';
    if (phase === 'p3' || phase === 'done') {
      return '编辑精修';
    }
    if (phase === 'p1' || phase === 'p2') {
      return '旧版草稿（将重新开始）';
    }
    return '世界建造';
  }

  // 「正在编辑哪张卡」指针（design_mode_editing_card_id，designService.loadCardIntoDesignMode 写）。
  // 卡编辑会话（含 PZWC 建完落库的草稿卡）不落盘 design_mode_* 草稿键——内容的家在卡上的
  // _editDraft。刷新后内存会话蒸发，但指针 + 草稿卡都在：进设计模式时凭它自动接回。
  // 指针只在卡仍处草稿态时有效（应用/放弃/删卡后自愈失效并清除）；设计会话不干净
  // （内存已有卡编辑会话 / 存有 pzwc·新建草稿待恢复）时不抢，交给既有恢复路径。
  function _readPendingCardEditResumeId() {
    try {
      const id = localStorage.getItem('design_mode_editing_card_id');
      if (!id) return null;
      const mgr = window.worldCardManager;
      const card = mgr && typeof mgr.get === 'function' ? mgr.get(id) : null;
      const draft = card ? card._editDraft : null;
      const draftValid =
        draft && typeof draft === 'object' && !Array.isArray(draft) && Object.keys(draft).length > 0;
      if (!draftValid) {
        try { localStorage.removeItem('design_mode_editing_card_id'); } catch (_) { /* noop */ }
        return null;
      }
      const ds = window.designService;
      if (ds && typeof ds._isCardEditSession === 'function' && ds._isCardEditSession()) return null;
      if (typeof window.hasStoredDesignDraft === 'function' && window.hasStoredDesignDraft()) return null;
      if (ds && typeof ds.hasUnfinishedWork === 'function' && ds.hasUnfinishedWork()) return null;
      return id;
    } catch (e) {
      console.warn('[Game] 读取编辑会话指针失败:', e);
      return null;
    }
  }

  // 模式切换滑块
  const modeToggle = document.getElementById('mode-toggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', async (event) => {
      // 防止在发送消息时切换
      if (isSending) {
        showToast('请等待回复完成后再切换模式');
        return;
      }

      // PZWC 建造进行中禁止切换模式：建造是 fire-and-forget（此刻 isSending 已为 false），
      // 若放行，控制器会继续向已指向游戏存档的全局 chatHistory push 建造叙述、并把游戏历史
      // 写进设计草稿键，造成跨库污染。建造期唯一出口是发送键的「暂停」。
      if (
        window.designService?.phase === 'pzwc' &&
        window.pzwcDesignController?.isBuilding?.()
      ) {
        showToast('引擎正在建造中——先点「暂停」再切换模式');
        return;
      }

      // ─────── Anti-pingpong shield ───────
      // 线上反馈"输入时界面抖动 + 读档后设计/游戏反复切换 + 刷新坏档"。
      // Analytics 显示某 power user 33s 内被触发 14 次 mode_toggled——肉眼手点
      // 不出来这种节奏，必然是某段代码自动调 .click()。三道闸：
      //   (a) DOM class 与全局 isDesignMode desync → 强制 resync 后 abort
      //   (b) 300ms 内的二次切换 → 节流（带堆栈，定位调用方）
      //   (c) handler 仍在执行 → 拒绝 reentry（handler 内含 await）
      const _domDesign = modeToggle.classList.contains('design-mode');
      const _stateDesign = typeof isDesignMode !== 'undefined' && !!isDesignMode;
      if (_domDesign !== _stateDesign) {
        modeToggle.classList.toggle('design-mode', _stateDesign);
        const _g = modeToggle.querySelector('.tab[data-mode="game"]');
        const _d = modeToggle.querySelector('.tab[data-mode="design"]');
        _g?.classList.toggle('is-active', !_stateDesign);
        _d?.classList.toggle('is-active', _stateDesign);
        const _ml = document.getElementById('game-screen');
        if (_ml) _ml.classList.toggle('design-mode-active', _stateDesign);
        console.warn('[mode-toggle] desync — DOM class != isDesignMode, force resync, abort');
        try {
          window.analyticsService?.track?.('feature.mode_toggle_blocked', {
            reason: 'desync',
            state: _stateDesign,
            dom: _domDesign,
            trusted: !!(event && event.isTrusted),
          });
        } catch (_) { /* noop */ }
        return;
      }
      const _now = Date.now();
      const _gap = _now - (window._lastModeToggleAt || 0);
      if (window._lastModeToggleAt && _gap < 300) {
        console.warn('[mode-toggle] throttled gap=' + _gap + 'ms', new Error('mode-toggle-throttle').stack);
        try {
          window.analyticsService?.track?.('feature.mode_toggle_blocked', {
            reason: 'throttle',
            gap_ms: _gap,
            trusted: !!(event && event.isTrusted),
          });
        } catch (_) { /* noop */ }
        return;
      }
      if (window._modeToggleBusy) {
        console.warn('[mode-toggle] busy — reject reentry');
        try {
          window.analyticsService?.track?.('feature.mode_toggle_blocked', {
            reason: 'busy',
            trusted: !!(event && event.isTrusted),
          });
        } catch (_) { /* noop */ }
        return;
      }
      if (event && event.isTrusted === false) {
        // 程序触发——上报 trace，下次发版后能从 Analytics 看到调用方
        console.warn('[mode-toggle] programmatic trigger', new Error('mode-toggle-programmatic').stack);
        try {
          window.analyticsService?.track?.('feature.mode_toggle_programmatic', {
            to: _stateDesign ? 'game' : 'design',
          });
        } catch (_) { /* noop */ }
      }
      window._lastModeToggleAt = _now;
      window._modeToggleBusy = true;
      // ─────── /Anti-pingpong shield ───────

      let needsApiKeyHint = false;

      try {
      // 切到世界卡前 hint：API Key 没配也允许进，仅在 chat 操作时才阻塞——
      // 这样 stage-router 下 user 切到设计 stage 能看到预览/存档/广场/账户/设计 UI，
      // 不被强行拦在沙盒（plan §1.10：返回结构扁平、stage-nav 切换由顶部 toggle 完成）
      const switchingIntoDesign = !modeToggle.classList.contains('design-mode');
      if (
        switchingIntoDesign &&
        typeof aiService !== 'undefined' &&
        typeof aiService.getApiKeyForModule === 'function' &&
        !aiService.getApiKeyForModule('p1')
      ) {
        const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
        showToast(
          isEn
            ? 'World Cards opened — set an API key in Settings to start a chat.'
            : '世界卡已打开——在设置里配置 API Key 才能开始对话。'
        );
        // 不再 return；让 mode 真切，UI 立即响应
      }

      const isDesign = modeToggle.classList.toggle('design-mode');
      const gameLabel = modeToggle.querySelector('.tab[data-mode="game"]');
      const designLabel = modeToggle.querySelector('.tab[data-mode="design"]');
      gameLabel?.classList.toggle('is-active', !isDesign);
      designLabel?.classList.toggle('is-active', isDesign);
      console.log('[Mode] Switched to:', isDesign ? 'Design' : 'Game');

      // 更新全局模式标记
      isDesignMode = isDesign;

      try {
        window.analyticsService?.track?.('feature.mode_toggled', {
          to: isDesign ? 'design' : 'game',
        });
      } catch (_) { /* noop */ }

      // 更新移动端按键可见性（通过 CSS class 控制）
      // 必须在栏状态切换之前执行：CSS 默认隐藏规则依赖 #game-screen.design-mode-active
      const mainLayout = document.getElementById('game-screen');
      if (mainLayout) mainLayout.classList.toggle('design-mode-active', isDesign);

      // 同步 body[data-design-phase]（V9 composer pill / commentary 等 CSS 作用域命中）。
      // 状态权威源在 designService 一侧；这里在 design-mode-active class 改完后让它重新计算。
      window.designService?._syncDesignPhaseBodyAttr?.();

      // mode toggle 清 textarea：避免沙盒输入半句残留到设计模式（反之亦然）。
      // 两边共用同一个 .chat-input-textbox DOM，不清会让用户在另一 mode 看到上半句。
      const _textboxForToggle = document.querySelector('.chat-input-area .chat-input-textbox');
      if (_textboxForToggle) {
        _textboxForToggle.value = '';
        if (_textboxForToggle.dataset) {
          delete _textboxForToggle.dataset.designP1Display;
          delete _textboxForToggle.dataset.selectedChoicePayload;
          delete _textboxForToggle.dataset.selectedChoiceText;
        }
        // 分模式占位符：游戏带"输入 / 查看命令"提示，设计中性（设计模式下斜杠命令是关的）。
        // 显式传入新模式——此刻 window.isDesignMode 可能还没翻到位。
        window.updateChatInputPlaceholder?.(isDesign);
      }

      // 世界卡：隐藏沙盒 tab 容器（剧情总结/主角/角色档案），显示左侧 design header
      const gameSidebarTabs = document.getElementById('game-sidebar-tabs');
      if (gameSidebarTabs) gameSidebarTabs.style.display = isDesign ? 'none' : '';
      // 世界卡：显示世界卡信息磁贴
      const worldcardTile = document.getElementById('worldcard-info-tile');
      if (worldcardTile) worldcardTile.style.display = isDesign ? '' : 'none';
      const designHeader = document.getElementById('design-chat-header');
      if (designHeader) designHeader.style.display = isDesign ? '' : 'none';

      // 退出世界卡时：恢复聊天区可见性，隐藏预览面板
      if (!isDesign) {
        const chatArea = document.querySelector('.chat-messages-area');
        const cardPanel = document.getElementById('design-card-panel');
        const codePanel = document.getElementById('design-code-panel');
        const inputArea = document.querySelector('.chat-input-area');
        if (chatArea) chatArea.style.display = '';
        if (cardPanel) cardPanel.style.display = 'none';
        if (codePanel) codePanel.style.display = 'none';
        if (inputArea) inputArea.style.display = '';
      }

      // 切换聊天历史
      if (isDesign) {
        const shouldAnnounceDraftRestore =
          Array.isArray(designChatHistory) &&
          designChatHistory.length === 0 &&
          typeof window.hasStoredDesignDraft === 'function' &&
          window.hasStoredDesignDraft();
        const restoredDraftMeta = shouldAnnounceDraftRestore
          ? _readDesignDraftMetaForRestore()
          : null;

        // 进入世界卡：保存游戏历史，加载设计历史
        // 失忆 loop 防御：若 chatHistory 已经是 designChatHistory 的别名（异常 reentry 场景），
        // 不能用它覆盖 _gameChatHistory——否则游戏历史会被设计历史顶掉，丢档+开局失忆 loop
        if (chatHistory !== designChatHistory) {
          window._gameChatHistory = chatHistory;
        } else {
          console.warn('[mode-toggle] chatHistory already aliased to designChatHistory — preserve _gameChatHistory');
        }
        chatHistory = designChatHistory;
        // 初始化设计服务
        if (typeof initDesignService === 'function') {
          initDesignService();
        }
        // 刷新世界卡信息（必须在 initDesignService 之后）
        if (window.worldCardInfoUI) window.worldCardInfoUI.refresh();
        if (
          restoredDraftMeta &&
          window.designService &&
          Array.isArray(chatHistory) &&
          chatHistory.length > 0 &&
          typeof window.designService.hasUnfinishedWork === 'function' &&
          window.designService.hasUnfinishedWork() &&
          typeof showToast === 'function'
        ) {
          showToast(`已恢复设计草稿（${_getDesignRestorePhaseLabel(restoredDraftMeta)}）`);
        }
        // 刷新后自动接回未完成的卡编辑会话（含 PZWC 建完未应用的草稿卡）：卡内容一直安全地
        // 在卡库挂「编辑中」，但设计会话内存态刷新即空——不接回的话这里是空白新建态，玩家会
        // 以为编辑/建造成果全丢了。defer 到本次 toggle 全部收尾后再走「继续编辑」同一条入口
        // （_handleWorldCardEditInDesign），refreshChatUI/setStage/bootstrap 顺序与手动点按钮一致。
        const pendingCardEditResumeId = _readPendingCardEditResumeId();
        if (pendingCardEditResumeId) {
          setTimeout(() => {
            try {
              window._handleWorldCardEditInDesign?.(pendingCardEditResumeId);
            } catch (e) {
              console.warn('[Game] 自动接回编辑会话失败:', e);
            }
          }, 0);
        }
        // 首次进入世界卡时，显示引导问候语（即将自动接回编辑会话时跳过，避免闪一帧又被清）
        if (chatHistory.length === 0 && !pendingCardEditResumeId) {
          const greeting = window.designService
            ? window.designService.getGuidedGreeting()
            : '欢迎来到设计模式。';
          const providerKey =
            typeof window.resolveDesignProviderKey === 'function'
              ? window.resolveDesignProviderKey()
              : null;
          const designModelLabel =
            typeof window.resolveDesignModelLabel === 'function'
              ? window.resolveDesignModelLabel()
              : typeof aiService !== 'undefined' &&
                  typeof aiService.getModelForModule === 'function'
                ? (aiService.getModelForModule('p1') || '').trim()
                : '';
          const greetingMsg = { sender: 'ai', text: greeting };
          if (providerKey) {
            greetingMsg.providerKey = providerKey;
          }
          if (designModelLabel) {
            greetingMsg.modelLabel = designModelLabel;
          }
          chatHistory.push(greetingMsg);
        }
        // （执行按键已随老 P1/P2 流程退役——PZWC 建造与 P3 编辑都没有"一键生成"概念）
      } else {
        // 返回沙盒：保存设计历史到 localStorage，恢复游戏历史
        designChatHistory = chatHistory;
        if (window.designService) {
          window.designService.saveChatHistory(designChatHistory);
          // 仅非「从卡编辑」会话才清覆盖意图：card-edit 会话切出后用户可能再切回继续编辑，
          // 清掉 _reimportSourceCardId 会让回来 apply 落到「新建卡」分支——默默新建重复卡 +
          // 源卡永久卡在草稿态（_editDraft 不清）。card-edit 会话保留链接，由 apply/discard/reset 收尾。
          if (!window.designService._isCardEditSession?.()) {
            window.designService._reimportSourceCardId = null;
            window.designService._allowOverwriteFromCardEdit = false;
          }
        }
        let consumedPendingBootstrap = false;
        const pendingBootstrap =
          window.designService &&
          typeof window.designService.consumePendingGameBootstrap === 'function'
            ? window.designService.consumePendingGameBootstrap()
            : null;

        const pendingWorldId =
          pendingBootstrap &&
          typeof pendingBootstrap.worldCardId === 'string' &&
          pendingBootstrap.worldCardId.trim()
            ? pendingBootstrap.worldCardId.trim()
            : null;

        if (pendingWorldId) {
          const activeWorldId = window.worldCardManager?.getActiveCardId?.() || null;
          if (!activeWorldId || activeWorldId !== pendingWorldId) {
            showToast('已取消自动新开局：你已切换到其他世界卡');
          } else if (
            !window.sessionManager ||
            typeof window.sessionManager.startNewGame !== 'function'
          ) {
            showToast('自动新开局失败：sessionManager 未加载');
          } else {
            let startResult = null;
            try {
              startResult = await window.sessionManager.startNewGame({
                worldCardId: pendingWorldId,
                silent: true,
              });
            } catch (e) {
              startResult = { ok: false, reason: e?.message || '未知错误' };
            }
            if (!startResult || !startResult.ok) {
              showToast(`自动新开局失败：${startResult?.reason || '未知错误'}`);
            } else {
              consumedPendingBootstrap = true;
            }
          }
        }

        if (!consumedPendingBootstrap) {
          chatHistory = window._gameChatHistory || [];
          ({ needsApiKeyHint } = ensureGameModeSeedMessage());
        }
      }

      // 刷新聊天界面
      if (typeof refreshChatUI === 'function') {
        refreshChatUI({ scrollMode: 'bottom' });
      }
      if (!isDesign && needsApiKeyHint && typeof addMessage === 'function') {
        addMessage(getMissingApiKeyHint(), 'AI', 'ai');
      }

      // 通知 stage-router 等订阅方：mode 切换完成。stage-router 据此消化 pending stage target，
      // 避免依赖 setTimeout 死等 300ms throttle 后的 .click 静默失败
      try {
        window.eventBus?.emit?.('mode-toggled', { mode: isDesign ? 'design' : 'game' });
      } catch (_) { /* noop */ }
      } finally {
        window._modeToggleBusy = false;
      }
    });
  }

};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initGame);
} else {
  // bundle 被 installController 在 DCL 之后动态注入：DCL 已 fire，但 bundle 内
  // 后续文件（如 settingsUI.js 的 `let settingsDraftThemeMode`）还没解析到。
  // queueMicrotask 让 _initGame 在整个 bundle 解析完后再跑，避免 TDZ。
  queueMicrotask(_initGame);
}
