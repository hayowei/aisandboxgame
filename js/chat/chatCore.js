// ============================================
// Chat Core - 原生聊天系统(无外部依赖)
// ============================================

// 依赖: aiService, saveManager, chatHistory (来自 game.js)

// 折叠配置(与章节总结周期一致:每 20 个 turn 折叠一次)
const TURNS_FOLD_SIZE = 20; // 按 turn 数(AI 回复数)计算，不是按消息条数

// 发送状态锁 - 防止重复发送
// isSending 定义在 js/core/GameState.js

// AI 取消模式标志
let _aiCancelMode = false;

// 折叠状态 - 存储每个折叠组的消息数据
let foldedGroups = []; // [{ startIndex, endIndex, messages: [] }, ...]

// DOM 缓存
let chatMessagesArea = null;
let chatInputTextbox = null;
let chatSendBtn = null;

let _inlineActionEventsBound = false;
function _getInlineActionLabel(zhText, enText) {
  return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? enText : zhText;
}

// 从玩家输入中抽取 OOC（out-of-character）候选内容（【...】中文模式 / [...] 英文模式）。
// 用于 Phase 1 的 OOC Subagent：候选内容会被送去二次判定（真指令 vs 误判），
// 同时把括号从正文剥离，避免 NPC/ActionClassifier/ReAct 叙事把它们误当成角色对话或动作素材。
function extractOocCandidates(rawText, gameLang) {
  if (!rawText) return { cleanedText: '', candidates: [] };
  const isEn = gameLang === 'en';
  const re = isEn ? /\[([^\[\]\n]+?)\]/g : /【([^【】\n]+?)】/g;
  const candidates = [];
  const cleanedText = rawText
    .replace(re, (_, inner) => {
      const trimmed = inner.trim();
      if (trimmed) candidates.push(trimmed);
      return '';
    })
    .replace(/\s+/g, ' ')
    .trim();
  return { cleanedText, candidates };
}

// 把玩家消息 safe HTML 中的 OOC 候选括号高亮为蓝色斜体。
// 先 escapeHTML 再做替换是安全的——【】[] 不是 HTML 特殊字符。
function highlightOocCandidates(safeHtml, gameLang) {
  if (!safeHtml) return safeHtml;
  const isEn = gameLang === 'en';
  const re = isEn ? /\[([^\[\]\n]+?)\]/g : /【([^【】\n]+?)】/g;
  const open = isEn ? '[' : '【';
  const close = isEn ? ']' : '】';
  return safeHtml.replace(re, (_, inner) =>
    `<span class="ooc-marker">${open}${inner}${close}</span>`
  );
}

// ============================================
// OOC Q&A：subagent 反问环节（玩家自由文本回答 / 跳过）
// ============================================
// 消息形态（存入 chatHistory）：
//   question: { sender:'ai', meta:'ooc_qa', kind:'question', oocId, question, pending, skipped, answer }
//   answer:   { sender:'user', meta:'ooc_qa', kind:'answer', oocId, text }
// 渲染时根据 message.meta 走 OOC 气泡分支；发给 AI 的 history 在 aiService 入口处过滤。
const _oocResolvers = new Map(); // id → { resolve, questionMsg }

function _newOocId() {
  return `ooc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _oocLabels() {
  const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  return isEn
    ? {
        header: 'OOC · Clarification',
        submit: 'Submit',
        skip: 'Skip',
        placeholder: 'Your answer…',
        skipped: '(skipped)',
        disabledPlaceholder: 'Please answer the OOC question first…',
      }
    : {
        header: 'OOC · 澄清问题',
        submit: '提交',
        skip: '跳过',
        placeholder: '你的回答…',
        skipped: '（已跳过）',
        disabledPlaceholder: '请先回答 OOC 问题…',
      };
}

function _buildOocQaBubbleHtml(msg) {
  const L = _oocLabels();
  const safeQ = escapeHTML(msg.question || '');
  const id = msg.oocId || '';
  let body = '';
  if (msg.pending) {
    body = `
      <div class="ooc-qa-form" data-ooc-id="${id}">
        <input type="text" class="ooc-qa-input" placeholder="${escapeHTML(L.placeholder)}" autocomplete="off" />
        <button type="button" class="ooc-qa-submit" data-action="ooc-qa-btn" data-ooc-action="submit" data-ooc-id="${id}">${escapeHTML(L.submit)}</button>
        <button type="button" class="ooc-qa-skip" data-action="ooc-qa-btn" data-ooc-action="skip" data-ooc-id="${id}">${escapeHTML(L.skip)}</button>
      </div>
    `;
  } else if (msg.skipped) {
    body = `<div class="ooc-qa-answer">${escapeHTML(L.skipped)}</div>`;
  } else if (typeof msg.answer === 'string' && msg.answer) {
    const safeA = escapeHTML(msg.answer).replace(/\n/g, '<br>');
    body = `<div class="ooc-qa-answer">${safeA}</div>`;
  }
  return `
    <div class="chat-message-content ooc-qa-content">
      <div class="ooc-qa-row">
        <span class="ooc-qa-tag">${escapeHTML(L.header)}</span>
        <span class="ooc-qa-question-body">${safeQ}</span>
      </div>
      ${body}
    </div>
  `;
}

// 把一个空 msgEl 填为 OOC 气泡（合并 question + answer，单气泡渲染）
function _applyOocQaBubble(msgEl, msg) {
  if (!msgEl || !msg) return false;
  msgEl.className = `chat-message ooc-qa-bubble`;
  if (msg.oocId) msgEl.dataset.oocId = msg.oocId;
  msgEl.innerHTML = _buildOocQaBubbleHtml(msg);
  return true;
}

// 把当前 turn 内的 OOC q&a 拼成 prefix HTML，渲染到 AI 气泡 content 头部。
// 向前扫描直到上一条非 OOC 消息为止；只取 question-kind（answer-kind 已并入）。
function _buildAdjacentOocPrefixHtml(aiOriginalIndex) {
  if (!Array.isArray(chatHistory) || aiOriginalIndex == null || aiOriginalIndex <= 0) return '';
  const collected = [];
  for (let i = aiOriginalIndex - 1; i >= 0; i--) {
    const m = chatHistory[i];
    if (!m) continue;
    if (m.meta === 'ooc_qa') {
      if (m.kind === 'question') collected.unshift(m);
      continue;
    }
    break;
  }
  if (!collected.length) return '';
  return collected
    .map(m => `<div class="ooc-qa-bubble ooc-qa-inline">${_buildOocQaBubbleHtml(m)}</div>`)
    .join('');
}

function _setMainInputDisabledForOoc(disabled) {
  const L = _oocLabels();
  const area = document.querySelector('.chat-input-area');
  if (area) area.classList.toggle('chat-input-disabled', disabled);
  if (chatInputTextbox) {
    if (disabled) {
      if (chatInputTextbox.dataset.oocPrevPlaceholder === undefined) {
        chatInputTextbox.dataset.oocPrevPlaceholder = chatInputTextbox.placeholder || '';
      }
      chatInputTextbox.placeholder = L.disabledPlaceholder;
      chatInputTextbox.disabled = true;
    } else {
      if (chatInputTextbox.dataset.oocPrevPlaceholder !== undefined) {
        chatInputTextbox.placeholder = chatInputTextbox.dataset.oocPrevPlaceholder;
        delete chatInputTextbox.dataset.oocPrevPlaceholder;
      }
      // 发送主流程仍在跑时不启用 textarea，让 handleSendMessage 的 finally 统一管复位。
      // 否则 OOC 答完会过早启用 textarea，期间 AI 主流程还在响应。
      if (!isSending) {
        chatInputTextbox.disabled = false;
      }
    }
  }
}

function _refreshOocBubbleDom(id) {
  const el = document.querySelector(`.chat-message[data-ooc-id="${id}"]`);
  if (!el) return;
  const msg = chatHistory.find(m => m?.meta === 'ooc_qa' && m.kind === 'question' && m.oocId === id);
  if (!msg) return;
  _applyOocQaBubble(el, msg);
}

// subagent 反问环节入口：chatCore 向 aiService 注册此函数
async function handleOocQuestion(question, ctx = {}) {
  const id = _newOocId();
  const questionMsg = {
    sender: 'ai',
    meta: 'ooc_qa',
    kind: 'question',
    oocId: id,
    question,
    answer: null,
    pending: true,
    skipped: false,
  };
  chatHistory.push(questionMsg);
  const msgEl = document.createElement('div');
  _applyOocQaBubble(msgEl, questionMsg);
  const streamingContent = chatMessagesArea?.querySelector(
    '.chat-message.ai-message.streaming-state .chat-message-content.streaming-content'
  );
  if (streamingContent) {
    msgEl.classList.add('ooc-qa-inline');
    streamingContent.prepend(msgEl);
  } else if (chatMessagesArea) {
    chatMessagesArea.appendChild(msgEl);
  }
  _setMainInputDisabledForOoc(true);
  requestAnimationFrame(() => {
    msgEl.querySelector('.ooc-qa-input')?.focus({ preventScroll: true });
  });

  return new Promise(resolve => {
    let abortListener = null;
    const finalize = payload => {
      _oocResolvers.delete(id);
      if (abortListener && ctx?.abortSignal) {
        try { ctx.abortSignal.removeEventListener('abort', abortListener); } catch (_) {}
      }
      _setMainInputDisabledForOoc(false);
      resolve(payload);
    };

    if (ctx?.abortSignal) {
      abortListener = () => {
        questionMsg.pending = false;
        questionMsg.skipped = true;
        _refreshOocBubbleDom(id);
        try { if (typeof window.autoSaveGame === 'function') window.autoSaveGame(); } catch (_) {}
        finalize({ skipped: true });
      };
      if (ctx.abortSignal.aborted) {
        abortListener();
        return;
      }
      ctx.abortSignal.addEventListener('abort', abortListener);
    }

    _oocResolvers.set(id, { resolve: finalize, questionMsg });
  });
}

function _handleOocBubbleClick(e) {
  const btn = e.target.closest('[data-ooc-action]');
  if (!btn) return;
  const id = btn.dataset.oocId;
  if (!id) return;
  const resolver = _oocResolvers.get(id);
  if (!resolver) return;
  e.preventDefault();
  e.stopPropagation();
  const action = btn.dataset.oocAction;
  const { questionMsg } = resolver;

  if (action === 'skip') {
    questionMsg.pending = false;
    questionMsg.skipped = true;
    _refreshOocBubbleDom(id);
    try { if (typeof window.autoSaveGame === 'function') window.autoSaveGame(); } catch (_) {}
    resolver.resolve({ skipped: true });
    return;
  }

  if (action === 'submit') {
    const form = btn.closest('.ooc-qa-form');
    const input = form?.querySelector('.ooc-qa-input');
    const value = (input?.value || '').trim();
    if (!value) {
      input?.focus({ preventScroll: true });
      if (input) {
        input.classList.add('ooc-qa-input-shake');
        setTimeout(() => input.classList.remove('ooc-qa-input-shake'), 350);
      }
      return;
    }
    questionMsg.pending = false;
    questionMsg.skipped = false;
    questionMsg.answer = value;
    _refreshOocBubbleDom(id);
    try { if (typeof window.autoSaveGame === 'function') window.autoSaveGame(); } catch (_) {}
    resolver.resolve({ answer: value });
  }
}

function _handleOocInputKeydown(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  if (e.isComposing || e.keyCode === 229) return;
  const input = e.target.closest('.ooc-qa-input');
  if (!input) return;
  const form = input.closest('.ooc-qa-form');
  const submitBtn = form?.querySelector('[data-ooc-action="submit"]');
  if (submitBtn) {
    e.preventDefault();
    submitBtn.click();
  }
}

// 存档/刷新恢复时：残留 pending 一律修正为 skipped，避免 UI 出现无人接管的输入框
function sanitizeOocPendingOnLoad() {
  if (!Array.isArray(chatHistory)) return;
  for (const m of chatHistory) {
    if (m?.meta === 'ooc_qa' && m.kind === 'question' && m.pending) {
      m.pending = false;
      m.skipped = true;
    }
  }
}
window.sanitizeOocPendingOnLoad = sanitizeOocPendingOnLoad;
function getChatInlineSettingsActionHtml() {
  return `<a class="chat-inline-action-settings" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">settings</span><span class="chat-inline-action-label">${_getInlineActionLabel('设置', 'Settings')}</span></a>`;
}
function getChatInlineExecuteActionHtml() {
  return `<a class="chat-inline-action-execute" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">check_circle</span><span class="chat-inline-action-label">${_getInlineActionLabel('执行', 'Execute')}</span></a>`;
}
function getChatInlineApplyActionHtml() {
  return `<a class="chat-inline-action-apply" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">play_arrow</span><span class="chat-inline-action-label">${_getInlineActionLabel('应用到游戏', 'Apply to Game')}</span></a>`;
}
function getChatInlineAutoReviewActionHtml() {
  return `<a class="chat-inline-action-auto-review" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">rate_review</span><span class="chat-inline-action-label">${_getInlineActionLabel('自动审查', 'Auto Review')}</span></a>`;
}
const CHAT_INLINE_RETRY_ICON_ACTION_HTML =
  '<a class="chat-inline-action-retry chat-inline-icon-action" data-action="chat-inline-action-btn" href="#"><span class="icon icon-regenerate chat-inline-retry-icon"></span></a>';

// --- Quick-start buttons (one-time, below opening greeting) ---

function shouldShowQuickStartButtons() {
  if (isDesignMode) return false;
  if (!Array.isArray(chatHistory) || chatHistory.length !== 1) return false;
  const msg = chatHistory[0];
  if (!msg || msg.sender !== 'ai') return false;
  if (msg.isOnboarding === true) return false;
  return true;
}

function renderQuickStartButtonsHtml() {
  const randomLabel = window.i18nService?.getOpeningModeKeyword?.('random') || '随机开始';
  const recommendedLabel =
    window.i18nService?.getOpeningModeKeyword?.('recommended') || '以推荐剧情开始';
  return `<div class="quick-start-buttons-container">
    <a class="btn-secondary chat-quick-start-random" data-action="chat-quick-start-btn" href="#">${randomLabel}</a>
    <a class="btn-secondary chat-quick-start-recommended" data-action="chat-quick-start-btn" href="#">${recommendedLabel}</a>
  </div>`;
}

function shouldShowDesignQuickStartButtons() {
  if (!isDesignMode) return false;
  if (!Array.isArray(chatHistory) || chatHistory.length !== 1) return false;
  const msg = chatHistory[0];
  if (!msg || msg.sender !== 'ai') return false;
  return true;
}

function renderDesignQuickStartButtonsHtml() {
  const themeLabel = _getInlineActionLabel('先选择题材', 'Choose Theme First');
  const characterLabel = _getInlineActionLabel('先选择人物', 'Choose Character First');
  return `<div class="quick-start-buttons-container">
    <a class="btn-secondary chat-quick-start-design-theme" data-action="chat-quick-start-btn" href="#">${themeLabel}</a>
    <a class="btn-secondary chat-quick-start-design-character" data-action="chat-quick-start-btn" href="#">${characterLabel}</a>
  </div>`;
}

window.renderDesignQuickStartButtonsHtml = renderDesignQuickStartButtonsHtml;

function removeQuickStartButtons() {
  document.querySelectorAll('.quick-start-buttons-container').forEach(el => el.remove());
}

// 用户等待计时器状态
const userWaitTimer = {
  intervalId: null, // interval ID
  startTime: null, // 发送时间戳 (performance.now())
  timerElement: null, // 计时器 DOM 元素
};

// 生成唯一的对话轮次 UID
function generateTurnUID(turnNumber = 0) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `turn_${turnNumber}_${timestamp}_${random}`;
}

// 从 UID 解析 turnNumber
function parseTurnFromUID(uid) {
  if (!uid) return null;
  const match = uid.match(/^turn_(\d+)_/);
  return match ? parseInt(match[1], 10) : null;
}

// 比较两个 UID 的先后（返回 true 如果 uid1 > uid2，即 uid1 更新/更晚）
function isUIDAfter(uid1, uid2) {
  const turn1 = parseTurnFromUID(uid1);
  const turn2 = parseTurnFromUID(uid2);
  if (turn1 === null || turn2 === null) return false;
  return turn1 > turn2;
}

function _normalizeMessageIndex(rawIndex) {
  if (typeof rawIndex === 'number' && Number.isInteger(rawIndex)) return rawIndex;
  if (typeof rawIndex === 'string' && rawIndex.trim()) {
    const parsed = Number.parseInt(rawIndex, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return NaN;
}

function _isApiKeySystemHintMessage(text) {
  if (typeof text !== 'string') return false;
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.includes('请先点击右上角') && normalized.includes('配置您的 AI API Key')) {
    return true;
  }
  if (normalized.includes('top-right corner') && normalized.includes('configure your AI API key')) {
    return true;
  }
  if (normalized.includes('连接错误：没有 API Key')) {
    return true;
  }
  if (normalized.includes('Connection error: no API key')) {
    return true;
  }
  return false;
}

function _containsMissingApiKeyKeyword(text) {
  if (typeof text !== 'string') return false;
  const normalized = text.toLowerCase();
  return (
    normalized.includes('api key 未设置') ||
    normalized.includes('没有 api key') ||
    normalized.includes('missing api key') ||
    normalized.includes('api key missing') ||
    normalized.includes('please use api key') ||
    normalized.includes('unregistered callers') ||
    normalized.includes('api key not valid')
  );
}

function _shouldShowSettingsActionInErrorBanner(error, info = null) {
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : '';
  if (code.includes('API_KEY_MISSING') || code === 'DESIGN_API_KEY_MISSING') {
    return true;
  }

  const messages = [
    error?.message,
    info?.message,
    info?.rootCause,
    error?.unifiedErrorInfo?.message,
    error?.apiErrorInfo?.message,
  ];
  return messages.some(_containsMissingApiKeyKeyword);
}

function resolveMessageActionPolicy(msgIndex) {
  const index = _normalizeMessageIndex(msgIndex);
  if (!Number.isInteger(index)) {
    return { showActions: false, reason: 'invalid_index' };
  }
  if (!Array.isArray(chatHistory) || index < 0 || index >= chatHistory.length) {
    return { showActions: false, reason: 'out_of_history' };
  }

  const msg = chatHistory[index];
  if (!msg || typeof msg !== 'object') {
    return { showActions: false, reason: 'invalid_message' };
  }

  const isErrorMessage = msg.isError === true || Boolean(msg.errorMeta);
  if (isErrorMessage) {
    return { showActions: true, reason: 'error_message' };
  }

  const sender = msg.sender;
  if (isDesignMode && sender === 'ai') {
    return { showActions: false, reason: 'design_ai_message' };
  }

  if (!isDesignMode && sender === 'ai') {
    const parsedTurn = typeof msg.uid === 'string' ? parseTurnFromUID(msg.uid) : null;
    if (parsedTurn === 0) {
      return { showActions: false, reason: 'opening_turn0_uid' };
    }
    if (index === 0) {
      return { showActions: false, reason: 'opening_legacy_first_ai' };
    }
    if (_isApiKeySystemHintMessage(msg.text)) {
      return { showActions: false, reason: 'api_key_system_hint' };
    }
  }

  return { showActions: true, reason: 'default_allow' };
}

function renderMessageActionsHtml(msgIndex) {
  const index = _normalizeMessageIndex(msgIndex);
  const policy = resolveMessageActionPolicy(index);
  if (!policy.showActions || !Number.isInteger(index)) {
    return '';
  }
  return `
                <div class="message-actions" data-msg-index="${index}">
                    <button class="copy-action" data-action="msg-action-btn" title="复制">
                        <span class="icon icon-copy"></span>
                    </button>
                    <button class="regenerate-action" data-action="msg-action-btn" title="重新生成">
                        <span class="icon icon-regenerate"></span>
                    </button>
                    <button class="delete-action" data-action="msg-action-btn" title="删除">
                        <span class="icon icon-delete"></span>
                    </button>
                    <button class="edit-action" data-action="msg-action-btn" title="编辑">
                        <span class="icon icon-edit"></span>
                    </button>
                </div>
            `;
}

// 暴露必要的函数到全局
window.generateTurnUID = generateTurnUID;
window.parseTurnFromUID = parseTurnFromUID;
window.isUIDAfter = isUIDAfter;
window.resolveMessageActionPolicy = resolveMessageActionPolicy;
window.renderMessageActionsHtml = renderMessageActionsHtml;

// ============================================
// 原生聊天系统 - 核心功能
// ============================================

// 初始化聊天系统
function initChatSystem() {
  chatMessagesArea = document.querySelector('.chat-messages-area');
  chatInputTextbox = document.querySelector('.chat-input-textbox');
  chatSendBtn = document.querySelector('[data-action~="chat-send-btn"]');

  if (!chatMessagesArea || !chatInputTextbox || !chatSendBtn) {
    console.error('Chat elements not found');
    return;
  }

  // 绑定发送按键
  chatSendBtn.addEventListener('click', handleSendMessage);

  // 绑定执行按键（世界卡专用）
  const executeBtn = document.getElementById('design-execute-btn');
  if (executeBtn) {
    executeBtn.addEventListener('click', handleDesignModeExecute);
  }

  // 回车只换行，不发送（发送需点击按键）

  // 输入框自动调整高度
  chatInputTextbox.addEventListener('input', autoResizeTextarea);

  // 初始化用户等待计时器事件监听
  initUserWaitTimerEvents();

  // 初始化置顶状态栏
  initStickyStatusBar();

  // 滚到顶部时浮现 subtab nav（手机端 CSS 控制可见性）
  setupSubtabScrollReveal();

  // 初始化卡片拖拽注入
  initCardDragDrop();
  bindInlineActionEvents();

  // OOC Q&A：委派点击 + Enter 键提交 + 启动时修正残留 pending
  document.addEventListener('click', _handleOocBubbleClick);
  document.addEventListener('keydown', _handleOocInputKeydown);

  // 错误卡片整体可点击 → 打开"错误诊断"对话框
  document.addEventListener('click', _handleErrorBannerClick);
  sanitizeOocPendingOnLoad();
  if (typeof aiService !== 'undefined' && typeof aiService.registerOocAnswerHandler === 'function') {
    aiService.registerOocAnswerHandler(handleOocQuestion);
  }
}

// chat-messages-area 滚到顶部时浮现 subtab nav（CSS 控制最终可见性，仅手机端 media query 启用）。
// 桌面端 CSS 不读 .is-chat-at-top，subtab 持续可见，所以这里始终切换 class 没副作用。
// 只读 scrollTop（不写），符合 CLAUDE.md 主聊天区滚动条规矩。
function setupSubtabScrollReveal() {
  if (!chatMessagesArea) return;
  const SCROLL_AT_TOP_THRESHOLD = 20;
  let ticking = false;
  const measureSubtabSpace = () => {
    // 当前 subtab 实际占的垂直高度（hidden 时 max-height:0 → offsetHeight ≈ 0）
    const el = document.querySelector(
      '.stage-pane[data-stage-pane="story"] > .stage-substage-nav'
    );
    if (!el) return 0;
    const style = getComputedStyle(el);
    const marginV = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    return el.offsetHeight + marginV;
  };
  const update = () => {
    ticking = false;
    const wasAtTop = document.body.classList.contains('is-chat-at-top');
    const atTopByScroll = chatMessagesArea.scrollTop <= SCROLL_AT_TOP_THRESHOLD;
    // 预测"subtab 隐藏态"的 overflow：当前 visible 则要把 subtab 占的高度补回 chat-area。
    const subtabSpace = wasAtTop ? measureSubtabSpace() : 0;
    const overflowWhenHidden =
      chatMessagesArea.scrollHeight - chatMessagesArea.clientHeight - subtabSpace;
    // 如果隐藏 subtab 后 chat 内容也撑不出能"待住"在 >20 处的滚动余量，浏览器会把
    // scrollTop clamp 回 0，立刻又触发 is-at-top=true，造成 subtab 反复进出 → 抖动。
    // 这种情况强制保留 subtab 可见。
    const insufficientScroll = overflowWhenHidden <= SCROLL_AT_TOP_THRESHOLD;
    document.body.classList.toggle('is-chat-at-top', atTopByScroll || insufficientScroll);
  };
  // 初始判断（首次渲染应该在顶部）
  update();
  chatMessagesArea.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
}

/**
 * 初始化卡片预览 → 输入框 拖拽注入功能
 * 当用户从世界卡卡片预览拖拽子项到输入框时，
 * 将子项的定向编辑指令文本追加到输入框内容末尾。
 */
function initCardDragDrop() {
  if (!chatInputTextbox) return;

  chatInputTextbox.addEventListener('dragover', e => {
    // 只处理来自卡片子项的拖拽（text/plain 类型）
    if (e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      chatInputTextbox.classList.add('drag-over');
    }
  });

  chatInputTextbox.addEventListener('dragleave', e => {
    // 确认焦点真的离开了输入框（有时子元素会触发 dragleave）
    if (!chatInputTextbox.contains(e.relatedTarget)) {
      chatInputTextbox.classList.remove('drag-over');
    }
  });

  chatInputTextbox.addEventListener('drop', e => {
    e.preventDefault();
    chatInputTextbox.classList.remove('drag-over');

    const dragText = e.dataTransfer.getData('text/plain');
    if (!dragText) return;

    // 追加到输入框内容末尾（先换行隔开已有内容）
    const currentVal = chatInputTextbox.value;
    const separator = currentVal && !currentVal.endsWith('\n') ? '\n' : '';
    chatInputTextbox.value = currentVal + separator + dragText;

    // 把光标移到末尾
    chatInputTextbox.focus({ preventScroll: true });
    chatInputTextbox.setSelectionRange(
      chatInputTextbox.value.length,
      chatInputTextbox.value.length
    );

    // 触发高度自适应
    autoResizeTextarea();
  });
}

function bindInlineActionEvents() {
  if (_inlineActionEventsBound) return;
  document.addEventListener('click', e => {
    const inlineBtn = e.target.closest(
      '.chat-inline-action-settings, .chat-inline-action-reset, .chat-inline-action-save-manager, .chat-inline-action-default-world, .chat-inline-action-execute, .chat-inline-action-apply, .chat-inline-action-auto-review, .chat-inline-action-retry, .chat-quick-start-random, .chat-quick-start-recommended, .chat-quick-start-design-theme, .chat-quick-start-design-character'
    );
    if (!inlineBtn) return;

    const inChatMessage = inlineBtn.closest('.chat-message .chat-message-content');
    if (!inChatMessage) return;

    e.preventDefault();
    e.stopPropagation();

    if (inlineBtn.classList.contains('chat-inline-action-settings')) {
      const settingsBtn = document.getElementById('settings-btn');
      if (settingsBtn && typeof settingsBtn.click === 'function') {
        settingsBtn.click();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('设置按钮不可用');
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-reset')) {
      const resetBtn = document.getElementById('reset-btn');
      if (resetBtn && typeof resetBtn.click === 'function') {
        resetBtn.click();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('重置按钮不可用');
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-save-manager')) {
      const saveManagerBtn = document.getElementById('save-manager-btn');
      if (saveManagerBtn && typeof saveManagerBtn.click === 'function') {
        saveManagerBtn.click();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('存档按钮不可用');
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-default-world')) {
      const startDefaultWorldBtn = window.startDefaultWorldCardFlow;
      if (typeof startDefaultWorldBtn === 'function') {
        startDefaultWorldBtn();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('默认世界卡按钮不可用');
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-execute')) {
      const executeBtn = document.getElementById('design-execute-btn');
      if (executeBtn && typeof executeBtn.click === 'function') {
        executeBtn.click();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('执行按钮不可用');
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-apply')) {
      const applyBtn = document.getElementById('design-apply-btn');
      if (applyBtn && typeof applyBtn.click === 'function') {
        applyBtn.click();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('应用到游戏按钮不可用');
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-auto-review')) {
      e.preventDefault();
      chatInputTextbox.value = '请帮我自动审查整张世界卡，给出修改建议';
      handleSendMessage();
      return;
    }

    if (inlineBtn.classList.contains('chat-inline-action-retry')) {
      const chatMessage = inlineBtn.closest('.chat-message');
      const regenerateBtn = chatMessage?.querySelector('.message-actions .regenerate-action');
      if (regenerateBtn && typeof regenerateBtn.click === 'function') {
        regenerateBtn.click();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('再试一次按键不可用');
      }
    }

    if (
      inlineBtn.classList.contains('chat-quick-start-random') ||
      inlineBtn.classList.contains('chat-quick-start-recommended')
    ) {
      const text = inlineBtn.classList.contains('chat-quick-start-random')
        ? window.i18nService?.getOpeningModeKeyword?.('random') || '随机开始'
        : window.i18nService?.getOpeningModeKeyword?.('recommended') || '以推荐剧情开始';
      removeQuickStartButtons();
      if (chatInputTextbox) {
        chatInputTextbox.value = text;
        handleSendMessage();
      }
      return;
    }

    if (
      inlineBtn.classList.contains('chat-quick-start-design-theme') ||
      inlineBtn.classList.contains('chat-quick-start-design-character')
    ) {
      const text = inlineBtn.classList.contains('chat-quick-start-design-theme')
        ? _getInlineActionLabel('先选择题材', 'Choose Theme First')
        : _getInlineActionLabel('先选择人物', 'Choose Character First');
      removeQuickStartButtons();
      if (chatInputTextbox) {
        chatInputTextbox.value = text;
        handleSendMessage();
      }
      return;
    }
  });
  _inlineActionEventsBound = true;
}

// 自动调整输入框高度
function autoResizeTextarea() {
  const textarea = chatInputTextbox;
  if (!textarea) return;

  textarea.style.height = 'auto';
  textarea.style.overflow = 'hidden';

  const viewportH = window.visualViewport?.height ?? window.innerHeight;
  const maxHeight = viewportH * 0.5;
  const scrollHeight = textarea.scrollHeight;

  if (scrollHeight > maxHeight) {
    textarea.style.height = maxHeight + 'px';
    textarea.style.overflow = 'auto';
  } else {
    textarea.style.height = scrollHeight + 'px';
  }
}

// 重置输入框高度
function resetTextareaHeight() {
  if (chatInputTextbox) {
    chatInputTextbox.style.height = 'auto';
    chatInputTextbox.style.overflow = 'hidden';
  }
}

/**
 * HTML 转义（防止 XSS）
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * 获取 ReAct 当前配置模型（用于标签 fallback）
 */
function getConfiguredReactModelLabel() {
  if (typeof aiService !== 'undefined' && typeof aiService.getModelForModule === 'function') {
    const model = aiService.getModelForModule('react');
    if (typeof model === 'string' && model.trim()) return model.trim();
  }
  return '模型';
}

/**
 * 获取 Design 当前配置模型（用于标签 fallback）
 */
function getConfiguredDesignModelLabel() {
  if (typeof aiService !== 'undefined' && typeof aiService.getModelForModule === 'function') {
    const model = aiService.getModelForModule('p1');
    if (typeof model === 'string' && model.trim()) return model.trim();
  }
  return '模型';
}

// 推荐模式识别（重渲染口径）。streamVisualizer 优先读 per-request 冻结的
// requestPresentationConfig，但那是流式可视化器的瞬态，不落盘；历史重渲染只能用
// live aiService.getEffectiveApiSettingsMode()——与 streamVisualizer 的兜底分支
// 同源，未切模式时一致，切了模式两边都会一起改标（行为本就如此）。
function isRecommendedModeView() {
  return (
    typeof aiService !== 'undefined' &&
    typeof aiService.getEffectiveApiSettingsMode === 'function' &&
    aiService.getEffectiveApiSettingsMode() === 'recommended'
  );
}

/**
 * 解析 AI 标签显示模型名（优先历史持久化，保证跨回合切模型不串标）
 * 优先级:
 * 0) 推荐模式 → 'deepseek-v4-沙盒' 门面（隐藏底层多 iter 切换，与 streamVisualizer 一致）
 * 1) msg.modelLabel
 * 2) metrics.models.react
 * 3) aiService.getModelForModule('react')
 * 4) '模型'
 */
function resolveReactModelLabel(msg = null, metrics = null) {
  // 推荐模式门面必须最先判：落盘的 msg.modelLabel / metrics 存的是真实底层模型
  // （deepseek-v4-pro/flash），不挡掉会泄漏沙盒门面刻意隐藏的底层切换。
  if (isRecommendedModeView()) return 'deepseek-v4-沙盒';
  if (msg && typeof msg.modelLabel === 'string' && msg.modelLabel.trim()) {
    return msg.modelLabel.trim();
  }
  const sourceMetrics = metrics || (msg && msg.metrics) || null;
  const modelFromMetrics = sourceMetrics?.models?.react || sourceMetrics?.models?.step2;
  if (typeof modelFromMetrics === 'string' && modelFromMetrics.trim()) {
    return modelFromMetrics.trim();
  }
  return getConfiguredReactModelLabel();
}

const DEEPSEEK_THINKING_LEVELS_VIEW = ['off', 'high', 'max'];

function resolveReactThinkingLevel(msg = null, metrics = null) {
  // 推荐模式 façade-only 档位：底层实际由 aiService 按 iter 在 off/high/max 间切，
  // 标签统一显示「思考：自动」，与 streamVisualizer._resolveReactThinkingLevel 一致。
  if (isRecommendedModeView()) return 'auto';
  const sourceMetrics = metrics || (msg && msg.metrics) || null;
  const fromMetrics = sourceMetrics?.thinking?.react;
  if (typeof fromMetrics === 'string' && DEEPSEEK_THINKING_LEVELS_VIEW.includes(fromMetrics)) {
    return fromMetrics;
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getModuleThinking === 'function') {
    const live = aiService.getModuleThinking('react');
    if (DEEPSEEK_THINKING_LEVELS_VIEW.includes(live)) return live;
  }
  return null;
}

function formatThinkingMarker(level) {
  if (level === 'auto') return '「思考：自动」';
  if (!DEEPSEEK_THINKING_LEVELS_VIEW.includes(level)) return '';
  const display = level[0].toUpperCase() + level.slice(1);
  return `「思考：${display}」`;
}

// 思考徽章只对「官方 DeepSeek 服务商」显示。与 streamVisualizer._isReactOfficialDeepSeek
// 同一口径：**严格相等** `=== 'deepseek'`，绝不用 inferProviderKeyFromModelLabel /
// normalizeProviderKey 的 `.includes('deepseek')` 松散匹配，否则用户把自定义服务商
// 命名/模型名带 "deepseek" 会被误判。优先 metrics.providers.react（react.js 存的是
// adapter label 小写原文，未归一），无 metrics 再退当前配置 provider 原值（custom
// provider 按架构约束 id 不能等于 'deepseek'）。**不读 msg.providerKey**——它在落盘时
// 已被 resolveReactProviderKey→normalizeProviderKey 松散归一过，对自定义命名不可信。
function strictIsDeepSeekProvider(raw) {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'deepseek';
}

function isReactOfficialDeepSeek(msg = null, metrics = null) {
  if (isRecommendedModeView()) return true; // 推荐模式底层即官方 DeepSeek，显示「思考：自动」
  const sourceMetrics = metrics || (msg && msg.metrics) || null;
  const fromMetrics = sourceMetrics?.providers?.react || sourceMetrics?.providers?.step2;
  if (typeof fromMetrics === 'string' && fromMetrics.trim()) {
    return strictIsDeepSeekProvider(fromMetrics);
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getProviderForModule === 'function') {
    return strictIsDeepSeekProvider(aiService.getProviderForModule('react'));
  }
  return false;
}

/**
 * 解析 Design 标签显示模型名（优先历史持久化）
 * 优先级:
 * 1) msg.modelLabel
 * 2) aiService.getModelForModule('design')
 * 3) '模型'
 */
function resolveDesignModelLabel(msg = null) {
  if (msg && typeof msg.modelLabel === 'string' && msg.modelLabel.trim()) {
    return msg.modelLabel.trim();
  }
  return getConfiguredDesignModelLabel();
}
window.resolveDesignModelLabel = resolveDesignModelLabel;

function _normalizeUserLabelText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function _getCurrentUserSessionOrigin() {
  if (typeof window.sessionManager?.getSessionOrigin === 'function') {
    const origin = window.sessionManager.getSessionOrigin();
    if (origin && typeof origin === 'object') {
      return origin;
    }
  }

  const fallbackWorldId =
    typeof currentSaveBindingWorldCardId === 'string' ? currentSaveBindingWorldCardId.trim() : '';
  const fallbackSlotId = typeof currentSlotId === 'string' ? currentSlotId.trim() : '';
  if (fallbackWorldId && fallbackSlotId) {
    return {
      type: 'manual',
      worldCardId: fallbackWorldId,
      slotId: fallbackSlotId,
    };
  }

  return {
    type: 'unsaved',
    worldCardId: fallbackWorldId || null,
    slotId: null,
  };
}

function _getCurrentManualSaveNameForLabel(worldCardId, slotId) {
  const normalizedWorldId = _normalizeUserLabelText(worldCardId);
  const normalizedSlotId = _normalizeUserLabelText(slotId);
  if (!normalizedWorldId || !normalizedSlotId || typeof saveManager === 'undefined') {
    return '';
  }

  try {
    if (typeof saveManager.getSlotNameSync === 'function') {
      return _normalizeUserLabelText(
        saveManager.getSlotNameSync(normalizedWorldId, normalizedSlotId)
      );
    }
    return '';
  } catch (error) {
    console.warn('[getUserLabel] 读取当前存档名失败:', error);
    return '';
  }
}

function _getLocalizedUserLabelBase() {
  return `「${_getInlineActionLabel('你', 'You')}」`;
}

/**
 * 格式化用户标签（附带当前世界卡名称与当前实时存档名称）
 * 例如：你【泰瑞亚大陆｜存档 1】
 */
function getUserLabel() {
  const baseLabel = _getLocalizedUserLabelBase();

  // 世界卡与 worldCardManager 的 active card 没有结构绑定，
  // 不附带世界卡名/存档名，只显示「你」。
  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    return baseLabel;
  }

  const mgr = window.worldCardManager;
  const worldName = _normalizeUserLabelText(mgr?.getActiveCard?.()?.name);
  if (!worldName) {
    return baseLabel;
  }

  const sessionOrigin = _getCurrentUserSessionOrigin();
  if (sessionOrigin?.type === 'manual') {
    const saveName = _getCurrentManualSaveNameForLabel(
      sessionOrigin.worldCardId,
      sessionOrigin.slotId
    );
    if (saveName) {
      return `${baseLabel}【${worldName}｜${saveName}】`;
    }
  }

  return `${baseLabel}【${worldName}】`;
}

/**
 * 格式化主聊天 AI 标签
 */
function formatAiLabel(modelLabel, turn, thinkingLevel = null, isOfficialDeepSeek = false /* , uid 已迁出，改用 streamVisualizer.appendTurnUidBadge 悬浮显示 */) {
  const normalizedModel =
    typeof modelLabel === 'string' && modelLabel.trim() ? modelLabel.trim() : '模型';
  const normalizedTurn = Number.isFinite(turn) ? turn : '?';
  const thinkingPart = isOfficialDeepSeek ? formatThinkingMarker(thinkingLevel) : '';
  return `「${normalizedModel}」${thinkingPart}【Turn ${normalizedTurn}】`;
}

/**
 * 格式化世界卡助手标签
 */
function formatDesignAssistantLabel(modelLabel, stageName = null) {
  const normalizedModel =
    typeof modelLabel === 'string' && modelLabel.trim() ? modelLabel.trim() : '模型';
  const baseLabel = `设计助手：「${normalizedModel}」`;
  if (typeof stageName === 'string' && stageName.trim()) {
    return `${baseLabel} · ${stageName.trim()}`;
  }
  return baseLabel;
}
window.formatDesignAssistantLabel = formatDesignAssistantLabel;

const SUPPORTED_AI_PROVIDERS = new Set([
  'gemini',
  'deepseek',
  'openai',
  'grok',
  'anthropic',
  'siliconflow',
]);

function normalizeProviderKey(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim().toLowerCase();

  if (SUPPORTED_AI_PROVIDERS.has(value)) return value;
  if (value === 'chatgpt' || value === 'x.ai' || value === 'xai' || value === 'claude') {
    if (value === 'chatgpt') return 'openai';
    if (value === 'claude') return 'anthropic';
    return 'grok';
  }

  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('siliconflow')) return 'siliconflow';
  if (value.includes('openai') || value.includes('chatgpt') || value.includes('gpt'))
    return 'openai';
  if (value.includes('grok') || value.includes('xai') || value.includes('x.ai')) return 'grok';
  if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';

  return null;
}

function inferProviderKeyFromModelLabel(modelLabel) {
  if (typeof modelLabel !== 'string' || !modelLabel.trim()) return null;
  const value = modelLabel.trim().toLowerCase();

  if (value.includes('deepseek')) return 'deepseek';
  if (value.includes('gemini')) return 'gemini';
  if (value.includes('siliconflow')) return 'siliconflow';
  if (value.includes('claude') || value.includes('anthropic')) return 'anthropic';
  if (value.includes('grok') || value.includes('xai') || value.includes('x.ai')) return 'grok';
  if (value.includes('gpt') || value.includes('openai') || value.includes('chatgpt'))
    return 'openai';

  return null;
}

function getConfiguredReactProviderKey() {
  if (typeof aiService !== 'undefined' && typeof aiService.getProviderForModule === 'function') {
    const provider = aiService.getProviderForModule('react');
    return normalizeProviderKey(provider);
  }
  return null;
}

function getConfiguredDesignProviderKey() {
  if (typeof aiService !== 'undefined' && typeof aiService.getProviderForModule === 'function') {
    const provider = aiService.getProviderForModule('p1');
    return normalizeProviderKey(provider);
  }
  return null;
}

/**
 * 解析 ReAct provider（用于头像 logo）
 * 优先级:
 * 1) msg.providerKey
 * 2) metrics.providers.react
 * 3) modelLabel 推断
 * 4) aiService.getProviderForModule('react')
 * 5) null
 */
function resolveReactProviderKey(msg = null, metrics = null, modelLabel = null) {
  if (msg && typeof msg.providerKey === 'string' && msg.providerKey.trim()) {
    return normalizeProviderKey(msg.providerKey);
  }

  const sourceMetrics = metrics || (msg && msg.metrics) || null;
  const rawProviderFromMetrics = sourceMetrics?.providers?.react || sourceMetrics?.providers?.step2;
  if (typeof rawProviderFromMetrics === 'string' && rawProviderFromMetrics.trim()) {
    const normalized = normalizeProviderKey(rawProviderFromMetrics);
    return normalized || null;
  }

  const inferredModel = modelLabel || (msg ? resolveReactModelLabel(msg, sourceMetrics) : null);
  const inferredProvider = inferProviderKeyFromModelLabel(inferredModel);
  if (inferredProvider) return inferredProvider;

  return getConfiguredReactProviderKey();
}

/**
 * 解析 Design provider（用于世界卡头像 logo）
 * 优先级:
 * 1) msg.providerKey
 * 2) msg.modelLabel 推断
 * 3) aiService.getProviderForModule('design')
 * 4) null
 */
function resolveDesignProviderKey(msg = null) {
  if (msg && typeof msg.providerKey === 'string' && msg.providerKey.trim()) {
    return normalizeProviderKey(msg.providerKey);
  }
  if (msg && typeof msg.modelLabel === 'string' && msg.modelLabel.trim()) {
    const inferred = inferProviderKeyFromModelLabel(msg.modelLabel);
    if (inferred) return inferred;
  }
  return getConfiguredDesignProviderKey();
}
window.resolveDesignProviderKey = resolveDesignProviderKey;

function applyAiProviderDataset(msgEl, providerKey) {
  if (!msgEl) return;
  const normalized = normalizeProviderKey(providerKey);
  if (normalized) {
    msgEl.dataset.aiProvider = normalized;
  } else {
    delete msgEl.dataset.aiProvider;
  }
}
window.applyAiProviderDataset = applyAiProviderDataset;

// 把用户气泡头像标签算成 T<n>（n = 该用户消息之前已存在的 AI 消息数；与对应 AI 回复的 turnNumber 对齐）
function applyUserTurnLabel(msgEl, originalIndex) {
  if (!msgEl) return;
  const labelEl = msgEl.querySelector('.chat-user-label');
  if (!labelEl) return;
  const hist = Array.isArray(chatHistory) ? chatHistory : [];
  const idx = Number.isFinite(originalIndex) ? originalIndex : hist.length;
  const aiBefore = hist.slice(0, idx).filter(m => m && m.sender === 'ai').length;
  labelEl.dataset.turnLabel = `T${aiBefore}`;
}

// ============================================
// 用户等待计时器
// ============================================

/**
 * 启动用户等待计时器
 * @param {HTMLElement} userMsgEl - 用户消息元素
 * @param {number} startTime - 发送时间戳 (performance.now())
 */
function startUserWaitTimer(userMsgEl, startTime) {
  // 清理之前的计时器（如果有），但不重置 startTime
  if (userWaitTimer.intervalId !== null) {
    clearInterval(userWaitTimer.intervalId);
    userWaitTimer.intervalId = null;
  }

  const timerEl = userMsgEl?.querySelector('.user-wait-timer');
  if (!timerEl) return;

  // 设置状态
  userWaitTimer.startTime = startTime;
  userWaitTimer.timerElement = timerEl;
  const timerValueEl = timerEl.querySelector('.timer-value');

  // 每 100ms 更新一次显示
  userWaitTimer.intervalId = setInterval(() => {
    if (!userWaitTimer.startTime || !timerValueEl) return;
    const elapsed = (performance.now() - userWaitTimer.startTime) / 1000;
    timerValueEl.textContent = `${elapsed.toFixed(2)}s`;
  }, 100);
}

/**
 * 更新最近用户消息的诊断图标
 * 在 AI_RESPONSE_COMPLETE 事件后调用，此时 lastRequestMetrics 已有数据
 */
function updateTimingDiagnosis() {
  if (typeof aiService === 'undefined') return;

  const analysis = aiService.analyzeTiming();
  if (!analysis) return;

  // 找到最近的用户消息的诊断图标
  const userMessages = document.querySelectorAll('.user-message');
  if (userMessages.length === 0) return;

  const lastUserMsg = userMessages[userMessages.length - 1];
  const diagnosisGroup = lastUserMsg.querySelector('.metric-group-diagnosis');

  if (diagnosisGroup) {
    diagnosisGroup.style.display = 'inline-flex';
    diagnosisGroup.classList.add(`diagnosis-${analysis.level}`);

    // 更新 tooltip 内容
    const tooltipEl = diagnosisGroup.querySelector('.diagnosis-tooltip');
    if (tooltipEl) {
      tooltipEl.innerHTML = formatDiagnosisTooltipHtml(analysis);
    }

    console.log('[Timing] 诊断结果:', analysis.diagnosis, '| Level:', analysis.level);
  }
}

/**
 * 智能格式化时间：< 1s 用毫秒，>= 1s 用秒
 * @param {number} ms - 毫秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatTimeMs(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '-';
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 格式化诊断结果为 tooltip HTML
 * @param {Object} analysis - aiService.analyzeTiming() 返回的诊断结果
 * @returns {string} tooltip HTML
 */
function formatDiagnosisTooltipHtml(analysis) {
  if (!analysis) return '';

  let html = `<div class="tooltip-header diagnosis-header-${analysis.level}">`;
  html += `<span class="tooltip-title">${analysis.diagnosis}</span>`;
  html += `<span class="tooltip-total">${formatTimeMs(analysis.totalTime)}</span>`;
  html += `</div>`;

  // 显示所有 steps 的详细 timing
  for (const step of analysis.details) {
    const ttfbStr = formatTimeMs(step.ttfb);
    const downloadStr = formatTimeMs(step.downloadTime);
    const totalStr = formatTimeMs(step.totalTime);

    const ttfbClass = step.isTtfbSlow ? 'tooltip-value-warn' : '';
    const downloadClass = step.isDownloadSlow ? 'tooltip-value-warn' : '';

    html += `<div class="tooltip-step-header">${step.phaseName}</div>`;
    html += `<div class="tooltip-row"><span class="tooltip-label">TTFB</span><span class="tooltip-value ${ttfbClass}">${ttfbStr}</span></div>`;
    html += `<div class="tooltip-row"><span class="tooltip-label">下载</span><span class="tooltip-value ${downloadClass}">${downloadStr}</span></div>`;
    html += `<div class="tooltip-row"><span class="tooltip-label">总计</span><span class="tooltip-value">${totalStr}</span></div>`;
  }

  return html;
}

/**
 * 停止用户等待计时器并显示最终时间
 * @param {boolean} success - 是否成功（失败则显示"已取消"）
 */
function stopUserWaitTimer(success = true) {
  // 清除 interval
  if (userWaitTimer.intervalId !== null) {
    clearInterval(userWaitTimer.intervalId);
    userWaitTimer.intervalId = null;
  }

  // 更新 UI
  const timerEl = userWaitTimer.timerElement;
  if (timerEl && userWaitTimer.startTime) {
    const timerIconEl = timerEl.querySelector('.timer-icon');
    const timerValueEl = timerEl.querySelector('.timer-value');

    if (success) {
      // 计算最终等待时间
      const elapsed = (performance.now() - userWaitTimer.startTime) / 1000;
      if (timerIconEl) timerIconEl.textContent = '⏱️';
      if (timerValueEl) timerValueEl.textContent = `${elapsed.toFixed(2)}s`;
      timerEl.classList.add('completed');
      // 注意：诊断图标在 AI_RESPONSE_COMPLETE 事件中更新，因为此时 lastRequestMetrics 才有数据
    } else {
      // 请求失败
      if (timerIconEl) timerIconEl.textContent = '❌';
      if (timerValueEl) timerValueEl.textContent = '已取消';
      timerEl.classList.add('failed');
    }
  }

  // 重置状态
  userWaitTimer.startTime = null;
  userWaitTimer.timerElement = null;
}

/**
 * 初始化用户等待计时器事件监听
 */
function initUserWaitTimerEvents() {
  if (!window.eventBus || !window.GameEvents) return;

  // 监听首次内容显示事件 - 停止计时器
  window.eventBus.on(window.GameEvents.AI_FIRST_CONTENT_DISPLAY, () => {
    stopUserWaitTimer(true);
  });

  // 监听错误事件 - 停止计时器并标记失败
  window.eventBus.on(window.GameEvents.AI_ERROR, () => {
    stopUserWaitTimer(false);
  });

  // 兜底：响应完成时确保计时器已停止
  window.eventBus.on(window.GameEvents.AI_RESPONSE_COMPLETE, () => {
    if (userWaitTimer.intervalId !== null) {
      stopUserWaitTimer(true);
    }
  });

  // 响应完成后更新诊断图标（此时 lastRequestMetrics 已有数据）
  window.eventBus.on(window.GameEvents.AI_RESPONSE_COMPLETE, () => {
    updateTimingDiagnosis();
  });

  console.log('[ChatCore] User wait timer events initialized');
}

// 添加消息到界面
function addMessage(text, senderName, senderType = 'user', originalIndex = null, options = {}) {
  if (!chatMessagesArea) return null;

  const msgEl = document.createElement('div');
  msgEl.className = `chat-message ${senderType === 'user' ? 'user-message' : 'ai-message'}`;
  const safeSenderName = escapeHTML(senderName ?? '');

  // 如果提供了 originalIndex，存储它;否则使用 chatHistory.length 作为即将添加的索引
  const indexToUse =
    originalIndex !== null
      ? originalIndex
      : typeof chatHistory !== 'undefined'
        ? chatHistory.length
        : 0;
  msgEl.dataset.originalIndex = indexToUse;

  // OOC Q&A 元消息：走专用气泡，短路普通渲染
  if (options?.message?.meta === 'ooc_qa') {
    if (options.message.kind === 'answer') return null;
    _applyOocQaBubble(msgEl, options.message);
    chatMessagesArea.appendChild(msgEl);
    return msgEl;
  }

  // XSS 防护：根据消息类型生成安全 HTML
  const rawSafeContent =
    senderType === 'user'
      ? window.htmlSecurity
        ? window.htmlSecurity.plainTextToSafeHtml(text)
        : escapeHTML(text).replace(/\n/g, '<br>')
      : formatMessageContent(text);
  const safeContent =
    senderType === 'user' && !isDesignMode
      ? highlightOocCandidates(
          rawSafeContent,
          window.i18nService?.getResolvedLanguage?.() || 'zh-CN'
        )
      : rawSafeContent;

  // 用户消息：添加等待计时器 UI（放在 message-footer 中，与操作按键同行）
  if (senderType === 'user' && options.showWaitTimer) {
    const actionsHtml = renderMessageActionsHtml(indexToUse);
    msgEl.innerHTML = `
            <div class="chat-user-label">${safeSenderName}</div>
            <div class="chat-message-content">${safeContent}</div>
            <div class="message-footer">
                <div class="metrics-placeholder">
                    <div class="user-wait-timer">
                        <span class="timer-icon">⏳</span>
                        <span class="timer-value">0.00s</span>
                    </div>
                    <span class="metric-group metric-group-diagnosis" style="display:none">
                        <span class="metric-item metric-diagnosis">🔍</span>
                        <div class="metrics-tooltip diagnosis-tooltip"></div>
                    </span>
                </div>
                ${actionsHtml}
            </div>
        `;
  } else {
    const oocPrefixHtml = senderType !== 'user' ? _buildAdjacentOocPrefixHtml(indexToUse) : '';
    msgEl.innerHTML = `
            <div class="chat-user-label">${safeSenderName}</div>
            <div class="chat-message-content">
                ${senderType !== 'user' ? '<span class="material-symbols-outlined metro-watermark">auto_stories</span>' : ''}
                ${oocPrefixHtml}${safeContent}
            </div>
        `;
    // AI 气泡接管：移除当前 chatMessagesArea 末尾还浮着的 OOC q&a 独立气泡
    if (senderType !== 'user' && oocPrefixHtml && chatMessagesArea) {
      chatMessagesArea.querySelectorAll('.ooc-qa-bubble.chat-message').forEach(el => el.remove());
    }
  }

  if (senderType === 'user') {
    applyUserTurnLabel(msgEl, indexToUse);
  }

  if (senderType !== 'user') {
    let resolvedProviderKey = normalizeProviderKey(options.providerKey);
    if (!resolvedProviderKey) {
      if (isDesignMode) {
        resolvedProviderKey = resolveDesignProviderKey(options.message || null);
      } else {
        const sender = typeof senderName === 'string' ? senderName : '';
        const isDesignAssistant = sender.includes('设计助手');
        if (!isDesignAssistant) {
          resolvedProviderKey = resolveReactProviderKey(
            null,
            options.metrics || null,
            options.modelLabel || senderName
          );
        }
      }
    }
    applyAiProviderDataset(msgEl, resolvedProviderKey);
  }

  chatMessagesArea.appendChild(msgEl);
  return msgEl;
}
window.addMessage = addMessage;

// 清空聊天历史
function clearChatHistory() {
  if (chatMessagesArea) {
    chatMessagesArea.innerHTML = '';
  }
}
window.clearChatHistory = clearChatHistory;

/**
 * 处理 AI 响应的公共逻辑
 * @param {string} aiResponse - AI 的原始响应
 * @returns {{ turnNumber: number, turnUID: string }}
 */
function processAIResponse(aiResponse) {
  const functionCalls = aiService.getLastFunctionCalls();
  const reasoningContents = aiService.getLastReasoningContents();
  const requestMetrics = aiService.getLastRequestMetrics();
  const narrativeText = aiService.getLastNarrativeText();
  const step2Choices = aiService.getLastStep2Choices();
  const reactSegments = aiService.getLastReactSegments?.() || [];
  const persistedReasoningContents =
    reasoningContents && reasoningContents.length > 0 ? reasoningContents : null;

  const aiCount = chatHistory.filter(m => m.sender === 'ai').length;
  const turnNumber = aiCount;
  const turnUID = generateTurnUID(turnNumber);
  const modelLabel = resolveReactModelLabel(null, requestMetrics);
  const providerKey = resolveReactProviderKey(null, requestMetrics, modelLabel);

  const aiMessage = {
    sender: 'ai',
    text: aiResponse,
    uid: turnUID,
    modelLabel: modelLabel,
    functionCalls: functionCalls || [],
    reasoningContents: persistedReasoningContents,
    metrics: requestMetrics || null,
    step2Choices: step2Choices || null,
    reactSegments: reactSegments.length > 0 ? reactSegments : undefined,
  };
  if (providerKey) {
    aiMessage.providerKey = providerKey;
  }

  // NPC 反应/决策持久化
  const lastNpcReactions = typeof aiService !== 'undefined' ? aiService.lastNpcReactions : null;
  if (lastNpcReactions && lastNpcReactions.length > 0) {
    aiMessage.npcReactions = {};
    for (const r of lastNpcReactions) {
      const entry = { name: r.name, text: r.text };
      if (r.decision) entry.decision = r.decision;
      aiMessage.npcReactions[r.npcId] = entry;
      if (typeof npcReactionStore !== 'undefined') {
        npcReactionStore.addReaction(turnUID, r.npcId, r.name, r.text, r.decision || null);
      }
      // 把 decision 同步落到 npcStore 的 state 层（v1）：reactionStore 是回合日志，state 是当前快照
      if (r.decision && typeof npcStore !== 'undefined' && typeof npcStore.applyReactionToState === 'function') {
        npcStore.applyReactionToState(r.npcId, r.decision, turnUID);
      }

    }
  }

  // OOC 写作准则持久化：贴到 AI 消息上，让 regenerate 可以无缝复用
  const usedOoc =
    typeof aiService !== 'undefined' && typeof aiService.getPendingOoc === 'function'
      ? aiService.getPendingOoc()
      : null;
  if (usedOoc?.normalized) {
    aiMessage.ooc = {
      normalized: usedOoc.normalized,
      raw: Array.isArray(usedOoc.raw) ? usedOoc.raw.slice() : [],
    };
  }

  chatHistory.push(aiMessage);

  if (typeof npcStore !== 'undefined') {
    npcStore.currentTurn = turnNumber;
  }
  if (window.inventoryStore && Number.isFinite(turnNumber)) {
    window.inventoryStore.currentTurn = turnNumber;
  }

  // 解析 aiResponse 中的 JSON，提取 gameData 对象
  let gameData = null;
  try {
    const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      gameData = JSON.parse(jsonMatch[1]);
    }
  } catch (e) {
    console.warn('[processAIResponse] 解析 gameData JSON 失败:', e);
  }

  // 处理 panel_status 中的业务逻辑（从 UI 渲染层移到这里）
  if (gameData && gameData.panel_status) {
    const status = gameData.panel_status;

    // 0. 在更新当前状态之前，保存当前状态作为 previousTurn（供下次手动编辑时使用）
    if (typeof playerStateService !== 'undefined') {
      const prevDate =
        typeof timelineService !== 'undefined' ? timelineService.getCurrentDate() : null;
      const prevLocation =
        typeof locationTracker !== 'undefined' ? locationTracker.getLocation() : null;
      playerStateService.setPreviousTurnState(prevDate, prevLocation);
    }

    // 1. 更新时间线服务
    if (status.datetime && typeof timelineService !== 'undefined') {
      const dt = status.datetime;
      const hour = Number.parseInt(dt.hour, 10);
      const minute = Number.parseInt(dt.minute, 10);
      const clockInput =
        Number.isFinite(hour) && Number.isFinite(minute)
          ? hour
          : typeof dt.time_str === 'string'
            ? dt.time_str
            : dt.timeStr || null;
      timelineService.setCurrentDate(
        dt.year,
        dt.month,
        dt.day,
        clockInput,
        Number.isFinite(hour) && Number.isFinite(minute) ? minute : null
      );
    }

    // 2. 更新位置追踪器（传入日期用于检测日期变化）
    if (status.location && typeof locationTracker !== 'undefined') {
      locationTracker.updateFromResponse(status.location, turnNumber, status.datetime);
    }

    // 3. 同步 playerStateService（金钱、目标）
    if (typeof playerStateService !== 'undefined') {
      playerStateService.syncFromAIResponse(status);
    }

    // 5. 自定义世界：将完整 panel_status 存入 customStatusStore
    if (window.worldMeta?.getStep3Fields?.() && typeof customStatusStore !== 'undefined') {
      customStatusStore.syncFromAIResponse(status);
    }
  }

  // 若 AI 返回纯文本（无 JSON 块），从已同步的 runtime services 组装 gameData
  if (!gameData && typeof buildTurnResult === 'function') {
    gameData = buildTurnResult();
  }

  // ReAct 模式：choices 来自 update_choices 工具调用，注入到 gameData 供渲染
  if (gameData && typeof aiService !== 'undefined' && aiService.lastChoicesData && !gameData.choices) {
    gameData.choices = aiService.lastChoicesData;
  }

  // ReAct 模式：叙事文本来自 update_narrative 工具调用累积，注入到 gameData 供持久化
  if (gameData && narrativeText && !gameData.panel_narrative) {
    gameData.panel_narrative = narrativeText;
  }

  // 将 gameData 持久化到 chatHistory 消息上
  if (gameData) {
    aiMessage.gameData = gameData;
  }

  window.eventBus.emit(window.GameEvents.AI_RESPONSE_COMPLETE, {
    narrative: aiResponse,
    narrativeText: narrativeText,
    gameData: gameData,
    uid: turnUID,
    turnNumber: turnNumber,
    metrics: requestMetrics,
    functionCalls: functionCalls,
    reasoningContents: persistedReasoningContents,
  });

  return { turnNumber, turnUID };
}
window.processAIResponse = processAIResponse;

function flushDeferredAiUiWork() {
  if (typeof aiService !== 'undefined' && typeof aiService.flushDeferredWorldCardActivation === 'function') {
    aiService.flushDeferredWorldCardActivation();
  }
  if (typeof window.flushPendingChatRefresh === 'function') {
    window.flushPendingChatRefresh();
  }
}
window.flushDeferredAiUiWork = flushDeferredAiUiWork;

// ============================================
// 世界卡 - 执行按键
// ============================================

/**
 * 更新执行按键的显示状态
 * @param {'hidden'|'p1'|'p2'|'p2_running'|'p2_retry'|'p3_idle'|'p3_pending'} state
 */
function updateExecuteButtonState(state) {
  const btn = document.getElementById('design-execute-btn');
  if (!btn) return;

  // 清除所有状态
  btn.style.display = '';
  btn.disabled = false;
  btn.classList.remove('has-pending');

  switch (state) {
    case 'hidden':
      btn.style.display = 'none';
      break;
    case 'p1':
      // 可点击，提示用户可开始生成
      break;
    case 'p2':
    case 'p2_running':
      // Phase 2 运行中，禁用
      btn.disabled = true;
      break;
    case 'p2_retry':
      // Phase 2 中断后可重试
      break;
    case 'p3_idle':
      // P3 无待应用操作
      break;
    case 'p3_pending':
      // P3 有待应用操作，高亮
      btn.classList.add('has-pending');
      break;
  }
}
window.updateExecuteButtonState = updateExecuteButtonState;

/**
 * 自定义确认弹窗（替代 window.confirm）
 * @param {string} title  标题
 * @param {string} message 正文
 * @returns {Promise<boolean>}
 */
/**
 * 世界卡自定义文本输入弹窗（替代 window.prompt）
 * @param {string} title  标题
 * @param {string} message 正文（可含 HTML）
 * @param {string} [defaultValue] 默认填入值
 * @returns {Promise<string|null>} 用户输入；取消返回 null
 */
function showDesignPrompt(title, message, defaultValue = '') {
  return new Promise(resolve => {
    const modal = document.getElementById('design-prompt-modal');
    if (!modal) {
      // markup 缺失视作取消（不应发生）
      resolve(null);
      return;
    }
    document.getElementById('design-prompt-title').textContent = title;
    document.getElementById('design-prompt-msg').innerHTML = message || '';
    const input = document.getElementById('design-prompt-input');
    input.value = defaultValue || '';
    modal.classList.remove('hidden');
    setTimeout(() => {
      input.focus({ preventScroll: true });
      input.select();
    }, 50);

    function cleanup() {
      modal.classList.add('hidden');
      document.getElementById('design-prompt-ok-btn').removeEventListener('click', onOk);
      document.getElementById('design-prompt-cancel-btn').removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onOverlay);
    }
    function onOk() {
      const v = input.value;
      cleanup();
      resolve(v);
    }
    function onCancel() {
      cleanup();
      resolve(null);
    }
    function onOverlay(e) {
      if (e.target === modal) {
        cleanup();
        resolve(null);
      }
    }
    function onKey(e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onOk();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    }

    document.getElementById('design-prompt-ok-btn').addEventListener('click', onOk);
    document.getElementById('design-prompt-cancel-btn').addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
    modal.addEventListener('click', onOverlay);
  });
}
window.showDesignPrompt = showDesignPrompt;

function showDesignConfirm(title, message, options = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('design-exec-confirm-modal');
    const content = modal.querySelector('.modal-content');
    // align: 'left' 时把内容区改为左对齐（默认 modal-center-text 居中适合短句，长说明左对齐更易读）
    if (options.align === 'left') {
      content?.classList.remove('modal-center-text');
      content?.classList.add('modal-content--left-text');
    } else {
      content?.classList.remove('modal-content--left-text');
      content?.classList.add('modal-center-text');
    }
    document.getElementById('design-exec-confirm-title').textContent = title;
    document.getElementById('design-exec-confirm-msg').innerHTML = message;
    modal.classList.remove('hidden');

    function onOk() {
      cleanup();
      resolve(true);
    }
    function onCancel() {
      cleanup();
      resolve(false);
    }
    function onOverlay(e) {
      if (e.target === modal) {
        cleanup();
        resolve(false);
      }
    }

    function cleanup() {
      modal.classList.add('hidden');
      document.getElementById('design-exec-ok-btn').removeEventListener('click', onOk);
      document.getElementById('design-exec-cancel-btn').removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
    }

    document.getElementById('design-exec-ok-btn').addEventListener('click', onOk);
    document.getElementById('design-exec-cancel-btn').addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
  });
}
window.showDesignConfirm = showDesignConfirm;

function normalizePhase2Stage(stage) {
  const parsed = Number.parseInt(stage, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 4) return null;
  return parsed;
}

let isDesignP2RetryPromptOpen = false;

function canRetryDesignPhase2Now(showFeedback = false) {
  if (!window.designService) {
    if (showFeedback) showToast('设计服务未初始化，请重新进入设计模式');
    return false;
  }
  if (designService.phase !== 'p2') {
    if (showFeedback) showToast('当前不在自动生成阶段');
    return false;
  }
  if (isSending || designService.isAutoGenerating) {
    if (showFeedback) showToast('请等待当前自动生成任务完成');
    return false;
  }
  return true;
}

async function retryDesignPhase2FromPoint(options = {}) {
  if (!canRetryDesignPhase2Now(true)) {
    return false;
  }
  // 卡牌审阅状态下不允许 retry——会覆盖用户的 review 修改且 UX 混乱
  if (window.designService && window.designService.p2ReviewStage != null) {
    showToast('当前在角色卡牌审阅状态，请使用「确认 → Stage 4」按钮继续');
    return false;
  }
  if (isDesignP2RetryPromptOpen) {
    showToast('重试确认进行中，请先完成当前确认');
    return false;
  }
  isDesignP2RetryPromptOpen = true;

  try {
    const stageNames =
      (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en'
        ? ['World Setting', 'Rules', 'Characters & Relations', 'Timeline & Evolution']
        : ['世界设定', '规则系统', '角色与关系', '时间线与演变'];
    const preferredStage = normalizePhase2Stage(options.preferredStage);
    const resolvedStartStage =
      preferredStage ||
      normalizePhase2Stage(
        typeof designService.getPhase2StartStage === 'function'
          ? designService.getPhase2StartStage()
          : designService.p2Stage
      ) ||
      1;
    const source = typeof options.source === 'string' ? options.source : 'unknown';

    const continueConfirmed = await showDesignConfirm(
      '继续自动生成？',
      `将从 ${stageNames[resolvedStartStage - 1]}（第 ${resolvedStartStage} 阶段）继续生成。`
    );
    if (continueConfirmed) {
      if (!canRetryDesignPhase2Now(true)) {
        updateExecuteButtonState('p2_retry');
        return false;
      }
      if (typeof designService.clearPhase2FromStage === 'function') {
        designService.clearPhase2FromStage(resolvedStartStage);
      }
      if (typeof designService.setPhase2Stage === 'function') {
        designService.setPhase2Stage(resolvedStartStage);
      } else {
        designService.p2Stage = resolvedStartStage;
      }
      console.log(
        `[DesignMode][P2] retry continue from source=${source}, stage=${resolvedStartStage}`
      );
      const started = await handleDesignModePhase2();
      if (!started) {
        updateExecuteButtonState('p2_retry');
        showToast('未能启动自动生成，请稍后重试');
        return false;
      }
      return true;
    }

    const restartConfirmed = await showDesignConfirm(
      '从头重跑自动生成？',
      '将清空已生成的 Phase 2 数据，并从第 1 阶段重新生成。'
    );
    if (!restartConfirmed) return false;

    if (!canRetryDesignPhase2Now(true)) {
      updateExecuteButtonState('p2_retry');
      return false;
    }

    if (typeof designService.resetPhase2ForRestart === 'function') {
      designService.resetPhase2ForRestart();
    } else {
      designService.p2Stage = 0;
    }
    console.log(`[DesignMode][P2] retry restart from source=${source}`);
    const started = await handleDesignModePhase2();
    if (!started) {
      updateExecuteButtonState('p2_retry');
      showToast('未能启动自动生成，请稍后重试');
      return false;
    }
    return true;
  } finally {
    isDesignP2RetryPromptOpen = false;
  }
}
window.retryDesignPhase2FromPoint = retryDesignPhase2FromPoint;

/**
 * 卡牌审阅暂停状态下，用户点击"确认 → Stage 4"按钮时调用。
 * 转入 resume 状态并重新进入 Phase 2 管线（从 Stage 4 起跑）。
 * @returns {Promise<boolean>}
 */
async function resumeDesignPhase2FromReview() {
  if (!window.designService) {
    showToast('设计服务未初始化');
    return false;
  }
  if (designService.p2ReviewStage == null) {
    showToast('当前不在卡牌审阅状态');
    return false;
  }
  if (isSending || designService.isAutoGenerating) {
    showToast('请等待当前任务完成');
    return false;
  }
  // 不传 fromStage：让 requestResumePhase2 自己根据 p2ReviewStage 推算下一个 stage
  const ok = typeof designService.requestResumePhase2 === 'function'
    ? designService.requestResumePhase2()
    : false;
  if (!ok) {
    showToast('恢复失败：状态不一致');
    return false;
  }
  return await handleDesignModePhase2();
}
window.resumeDesignPhase2FromReview = resumeDesignPhase2FromReview;

/**
 * 世界卡 - 执行按键点击处理
 * P1: 弹窗确认 → forceP1Completion → transitionToPhase2 → handleDesignModePhase2
 * P3: 弹窗确认 → executePendingOperations
 */
async function handleDesignModeExecute() {
  if (!window.designService) return;
  const phase = designService.phase;

  if (phase === 'p1') {
    // 框架已就绪：直接确认进入 Phase 2
    if (designService.p1Output) {
      const confirmed = await showDesignConfirm(
        '确认使用当前框架开始生成？',
        '将基于预览中的框架内容生成世界卡。建议在开始前切换至「推理模型」，或启用「推荐设置」（一键采用我们调好的最优配置）以获得最佳质量。'
      );
      if (!confirmed) return;
      if (isSending) return;
      isSending = true;
      updateExecuteButtonState('p2_running');
      designService.transitionToPhase2(chatHistory);
      setTimeout(() => {
        isSending = false;
        handleDesignModePhase2();
      }, 300);
      if (window.designService) {
        designService._fullSave(chatHistory);
      }
      return;
    }

    // 框架未就绪：forceP1Completion 强制整理
    const confirmed = await showDesignConfirm(
      '开始自动生成世界？',
      '<div style="text-align: left; line-height: 1.6;">' +
      '如果对话还未结束，AI 会根据已有内容自动补全缺失的设定。<br><br>' +
      '<span style="opacity: 0.85; font-size: 0.95em;"> 建议在开始前切换至「推理模型」，或启用「推荐设置」以获得最佳质量</span>' +
      '</div>'
    );
    if (!confirmed) return;
    if (isSending) return;

    isSending = true;
    updateExecuteButtonState('p2_running');
    const designProviderKey = resolveDesignProviderKey();
    const designModelLabel = resolveDesignModelLabel();
    const designAssistantLabel = escapeHTML(formatDesignAssistantLabel(designModelLabel));

    // 显示加载提示
    const loadingEl = document.createElement('div');
    loadingEl.className = 'chat-message ai-message design-mode-msg design-loading';
    loadingEl.innerHTML = `
            <div class="chat-user-label">${designAssistantLabel}</div>
            <div class="chat-message-content">
                <div class="design-thinking-indicator">
                    <span class="design-dot"></span>
                    <span class="design-dot"></span>
                    <span class="design-dot"></span>
                </div>
                <div class="design-auto-progress">正在整理世界框架...</div>
            </div>
        `;
    applyAiProviderDataset(loadingEl, designProviderKey);
    chatMessagesArea.appendChild(loadingEl);

    try {
      const result = await designService.forceP1Completion(chatHistory);
      loadingEl.remove();

      if (!result.frameworkReady) {
        const frameworkIssueSummary =
          typeof result.frameworkIssueSummary === 'string'
            ? result.frameworkIssueSummary.trim()
            : '';
        if (frameworkIssueSummary) {
          console.debug('[DesignMode] forceP1Completion rejected framework:', {
            issues: Array.isArray(result.frameworkIssues) ? result.frameworkIssues : [],
          });
          showToast(`框架提取失败：${frameworkIssueSummary}`);
        } else {
          showToast('框架提取失败，请重试');
        }
        updateExecuteButtonState('p1');
        isSending = false;
        return;
      }

      // 显示框架就绪消息 + 预览
      const readyText = result.text + `\n\n---\n\n✅ 世界框架已整理完毕。点击输入栏的${getChatInlineExecuteActionHtml()}按键开始自动生成。`;
      const aiIndex = chatHistory.length;
      const readyMessage = { sender: 'ai', text: readyText, modelLabel: designModelLabel, frameworkReady: true };
      if (designProviderKey) {
        readyMessage.providerKey = designProviderKey;
      }
      chatHistory.push(readyMessage);
      const aiMsgEl = document.createElement('div');
      aiMsgEl.className = 'chat-message ai-message design-mode-msg';
      aiMsgEl.dataset.originalIndex = aiIndex;
      aiMsgEl.innerHTML = `
                <div class="chat-user-label">${designAssistantLabel}</div>
                <div class="chat-message-content">${formatMessageContent(readyText)}</div>
            `;
      applyAiProviderDataset(aiMsgEl, designProviderKey);
      chatMessagesArea.appendChild(aiMsgEl);
      // 禁用之前的框架预览（只有最新可交互）
      chatMessagesArea.querySelectorAll('.design-p1-framework-preview:not(.is-disabled)').forEach(el => {
        el.classList.add('is-disabled');
        el.querySelectorAll('button, textarea, input').forEach(ctrl => { ctrl.disabled = true; });
      });
      // 渲染框架预览卡片
      renderDesignP1FrameworkPreview(aiMsgEl, true);
      setTimeout(enhanceMessages, 10);

      // 不自动进入 Phase 2，等待用户确认预览后再次点击执行
      updateExecuteButtonState('p1');
      isSending = false;
    } catch (error) {
      loadingEl.remove();
      console.error('[DesignMode] forceP1Completion error:', error);
      const translated = _translateDesignErrorForUser(error);
      showToast('框架提取失败: ' + translated.detail);
      updateExecuteButtonState('p1');
      isSending = false;
    }
    if (window.designService) {
      designService._fullSave(chatHistory);
    }
  } else if (phase === 'p2') {
    // 卡牌审阅状态：执行按钮 = 确认 → 进 Stage 4，不要走 retry 对话框
    if (designService.p2ReviewStage != null) {
      if (typeof window.resumeDesignPhase2FromReview === 'function') {
        await window.resumeDesignPhase2FromReview();
      }
      return;
    }
    if (isSending) {
      showToast('请等待当前自动生成任务完成');
      return;
    }
    await retryDesignPhase2FromPoint({ source: 'execute-btn' });
  } else if (phase === 'p3') {
    // 优先使用新 Cursor 化流程
    const enrichedOps = designService.p3Session.enrichedOps;
    if (enrichedOps.length > 0) {
      const acceptedCount = enrichedOps.filter(op => op.status === 'accepted').length;
      if (!acceptedCount) {
        showToast('没有已接受的修改（请在差异面板中选择要应用的操作）');
        return;
      }
      const confirmed = await showDesignConfirm(
        `确认应用 ${acceptedCount} 项修改？`,
        '修改将写入世界配置，可在预览面板中查看结果。'
      );
      if (!confirmed) return;
      const { applied } = designService.applySelectedOperations();
      showToast(`已应用 ${applied} 项修改`);
      // 刷新 diff panel
      const lastPlanPanel = chatMessagesArea.querySelector('[data-plan-panel]:last-of-type');
      if (lastPlanPanel) {
        const aiMsgEl = lastPlanPanel.closest('.chat-message');
        if (aiMsgEl) _refreshPlanPanel(aiMsgEl);
      }
      updateExecuteButtonState('p3_idle');
    } else {
      // 旧路径兜底
      const pendingCount = designService.pendingOperations.length;
      if (!pendingCount) {
        showToast('没有待应用的修改');
        return;
      }
      const confirmed = await showDesignConfirm(
        `确认应用 ${pendingCount} 项修改？`,
        '修改将写入世界配置，可在预览面板中查看结果。'
      );
      if (!confirmed) return;
      const { applied } = designService.executePendingOperations();
      showToast(`已应用 ${applied} 项修改`);
      updateExecuteButtonState('p3_idle');
    }
  }
}

/**
 * 切换发送按钮为取消模式（AI 生成期间）
 */
function setSendBtnCancelMode(enable) {
  _aiCancelMode = !!enable;
  if (!chatSendBtn) return;
  const iconEl = chatSendBtn.querySelector('.material-symbols-outlined');
  if (enable) {
    chatSendBtn.classList.add('cancel-mode');
    chatSendBtn.title = '取消';
    if (iconEl) iconEl.textContent = 'pause';
  } else {
    chatSendBtn.classList.remove('cancel-mode');
    chatSendBtn.title = '发送';
    if (iconEl) iconEl.textContent = 'send';
  }
}
window.setSendBtnCancelMode = setSendBtnCancelMode;

/**
 * 执行取消操作：根据当前模式调用不同的取消方法
 */
function _executeCancelAction() {
  if (isDesignMode && window.designService) {
    const phase = designService.phase;
    if (phase === 'p3') {
      designService.cancelP3Request();
    } else if (phase === 'p1') {
      designService.cancelP1Request();
    }
  } else {
    // 沙盒
    if (window.aiService) aiService.cancelRequest();
  }
}

// 处理发送消息
async function handleSendMessage() {
  // AI 取消模式：点击即取消，不走正常发送流程
  if (_aiCancelMode) {
    _executeCancelAction();
    setSendBtnCancelMode(false);
    return;
  }

  const message = chatInputTextbox.value.trim();
  if (!message) return;
  const selectedChoicePayload =
    typeof chatInputTextbox?.dataset?.selectedChoicePayload === 'string'
      ? chatInputTextbox.dataset.selectedChoicePayload
      : '';
  const selectedChoiceText =
    typeof chatInputTextbox?.dataset?.selectedChoiceText === 'string'
      ? chatInputTextbox.dataset.selectedChoiceText.trim()
      : '';
  const stagedDesignDisplay =
    typeof chatInputTextbox?.dataset?.designP1Display === 'string'
      ? chatInputTextbox.dataset.designP1Display.trim()
      : '';

  // 🔧 在用户交互时预初始化音频（iOS 后台运行支持）
  if (window.backgroundService) {
    window.backgroundService.prepareAudio();
  }

  // 防止重复发送
  if (isSending) {
    showToast('请等待 AI 回复完成');
    return;
  }
  isSending = true;
  if (chatInputTextbox) chatInputTextbox.disabled = true;

  // try/finally 必须从 isSending=true 之后立即开始包围——任何同步代码（OOC
  // 提取 / DOM 清空 / 埋点）抛错都得能跑 finally 复位 isSending + textarea.disabled，
  // 否则 textarea 卡禁用 = 永久不可输入。
  try {
    // 沙盒下抽取/剥离 OOC 候选（【...】或 [...]）。
    // 世界卡跳过，保留世界卡内容中的字面括号。
    const isDesign = typeof isDesignMode !== 'undefined' && isDesignMode;
    const gameLang = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
    let oocCandidates = [];
    let fullMessage = message;
    if (!isDesign) {
      const extracted = extractOocCandidates(message, gameLang);
      oocCandidates = extracted.candidates;
      // 只在剥离后仍有正文内容时才替换；否则保留原文避免发空消息。
      if (extracted.candidates.length > 0 && extracted.cleanedText) {
        fullMessage = extracted.cleanedText;
      }
    }
    const displayMessage = stagedDesignDisplay || message;

    // 清空输入框
    chatInputTextbox.value = '';
    if (chatInputTextbox?.dataset) {
      delete chatInputTextbox.dataset.designP1Display;
      delete chatInputTextbox.dataset.selectedChoicePayload;
      delete chatInputTextbox.dataset.selectedChoiceText;
    }
    resetTextareaHeight();

    if (!isDesignMode) {
      try {
        const sessionStart = window.analyticsService?._sessionStartedAt || 0;
        const msSince = sessionStart ? (Date.now() - sessionStart) : null;
        window.analyticsService?.noteTurn?.();
        window.analyticsService?.trackOnce?.('funnel.first_turn',
          { ms_since_session_start: msSince }, 'funnel.first_turn');
      } catch (_) { /* ignore */ }
    }

    // 主线模式处理（传入 UI 展示文本和实际发送文本）
    await handleMainlineSendMessage(fullMessage, displayMessage, {
      actionInputText: fullMessage,
      selectedChoicePayload,
      selectedChoiceText,
      oocCandidates,
    });
  } finally {
    isSending = false;
    if (chatInputTextbox) chatInputTextbox.disabled = false;

    if (!isDesignMode) {
      requestAnimationFrame(() => {
        if (window.isDesignMode) return;
        // streaming-state class 切换 + choices stale 折叠会变化尺寸。交给
        // scrollController 受控：pinned 焊底 / 非 pinned 钉住阅读位
        // （取代旧手写 anchor 兜底，Safari 18 原生 anchoring 失效问题归 controller）。
        if (window.scrollController && typeof window.scrollController.runScoped === 'function') {
          window.scrollController.runScoped(() => window._markStaleChoices?.());
        } else {
          window._markStaleChoices?.();
        }
      });
    }
  }

  // 世界卡下发送消息后自动切回对话视图
  if (
    isDesignMode &&
    window.designService &&
    typeof window.designService._switchDesignView === 'function'
  ) {
    const header = document.getElementById('design-chat-header');
    if (header) {
      const tabs = header.querySelectorAll('.tab');
      const slider = header.querySelector('.design-chat-tabs-slider');
      tabs.forEach(t => t.classList.remove('is-active'));
      if (tabs[0]) tabs[0].classList.add('is-active');
      if (slider) slider.style.transform = 'translateX(0)';
    }
    window.designService._switchDesignView('chat');
  }
}

function _extractAIFailureMeta(error) {
  const info =
    error?.unifiedErrorInfo || error?.errorInfo || error?._aiErrorMeta?.errorInfo || null;

  return {
    errorInfo: info,
    traceId: error?.traceId || error?._aiErrorMeta?.traceId || info?.traceId || null,
    failedPhase: error?.failedPhase || error?._aiErrorMeta?.failedPhase || info?.phase || null,
  };
}

function _formatAIFailureMessage(error) {
  const { errorInfo, failedPhase } = _extractAIFailureMeta(error);
  const phaseMap = {
    react: 'ReAct',
    gm_decision: 'GM',
    summary: 'Summary',
    chapter: 'Chapter',
    sms: 'SMS',
    design: 'Design',
  };
  const providerMap = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    anthropic: 'Anthropic',
    grok: 'Grok',
    siliconflow: 'SiliconFlow (CN)',
    custom: 'Custom',
    tool_engine: 'ToolEngine',
    codeengine: 'CodeEngine',
  };

  const phase = phaseMap[failedPhase || errorInfo?.phase] || '未知阶段';
  const providerRaw = errorInfo?.provider || '';
  const provider = providerMap[String(providerRaw).toLowerCase()] || providerRaw;
  const status = errorInfo?.httpStatus
    ? `HTTP ${errorInfo.httpStatus}`
    : errorInfo?.errorType || '';
  const reason = errorInfo?.rootCause || errorInfo?.message || error?.message || '未知错误';
  const details = [phase, provider, status].filter(Boolean).join(' / ');
  return `⚠️ 生成失败（${details}）：${reason}`;
}

/**
 * 从 provider 原始响应体中抽取服务端错误文本。
 * 覆盖常见 schema：{error}/{error.message}/{message}/{detail}/{detail[].msg}。
 * 抽不出时返回 null，调用方据此决定是否渲染。
 */
function _extractServerErrorText(responseBody) {
  if (responseBody == null) return null;
  let body = responseBody;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch { return body.length > 200 ? body.slice(0, 200) + '…' : body; }
  }
  if (typeof body !== 'object') return String(body);
  if (typeof body.error === 'string') return body.error;
  if (body.error && typeof body.error.message === 'string') return body.error.message;
  if (typeof body.message === 'string') return body.message;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) {
    const msgs = body.detail.map(d => d?.msg || d?.message).filter(Boolean);
    if (msgs.length) return msgs.join('; ');
  }
  try {
    const s = JSON.stringify(body);
    return s.length > 200 ? s.slice(0, 200) + '…' : s;
  } catch { return null; }
}

/**
 * 根据 errorInfo 生成"错误诊断"对话框正文 HTML。
 * 按优先级匹配 errorType + httpStatus，给玩家一段人话说明大概率原因。
 */
function _buildDiagnosisHtml(errorInfo, error, msgIdx) {
  const info = errorInfo || {};
  // upstream_failure 类型 (commentary-empty 分支) 的 httpStatus 自身是 null（emptyTextError
  // 不带 apiErrorInfo），但我们在分类时把上游真错误的 httpStatus 挂到 upstreamStatus 字段。
  // 把它当 status 用，让 402/429/500 等已有分支自动接住——避免重复写文案。
  const status = info.httpStatus ?? info.upstreamStatus;
  const type = info.errorType;
  const elapsed = info.elapsedMs || info.stageElapsedMs;
  const elapsedSec = elapsed ? (elapsed / 1000).toFixed(1) : null;

  let body = '';

  // upstream_failure 路径优先按 ReAct 的 upstreamKind 分类（已经做过 message 强信号识别），
  // 不能让 raw status 抢先误导——比如中转站把"余额不足"用 403 返回，按 status 会走"权限被限制"，
  // 但 upstreamKind='balance' 是对的。kind === 'unknown' 时 fall-through 到下面 status 路由 / 最终兜底。
  // 完整错误码语义见 docs/API_ERROR_CODES.md
  if (type === 'upstream_failure' && info.upstreamKind && info.upstreamKind !== 'unknown') {
    const kind = info.upstreamKind;
    const rawMsg = info.upstreamRawMessage || info.message || '';
    const esc = window.htmlSecurity?.escapeText || (s => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const escapedMsg = esc(rawMsg);
    const upstreamStatus = info.upstreamStatus;
    if (kind === 'safety_filtered') {
      const safetyReason = esc(info.safetyReason || '');
      const safetyStage = info.safetyStage;
      body = safetyStage === 'prompt'
        ? `<strong>你的输入触发了 Gemini 的内容审查</strong>（${safetyReason || '未知原因'}），整个请求被拒。常见触发位置：最近的对话内容、自定义世界卡、或 system prompt。试试<strong>调整一下输入内容</strong>，或在「设置」里换一个模型再试。`
        : `<strong>Gemini 在生成过程中被自家内容审查切断</strong>（${safetyReason || '未知原因'}）。可以先<strong>重试一次</strong>看看；反复出现可以在「设置」里调短 narrative 长度（短一些不容易触发），或者换一个模型再试。`;
    } else if (kind === 'balance') {
      body = `<strong>账户余额不足</strong>，服务商拒绝继续提供服务。原始错误：<code>${escapedMsg}</code>。去服务商的官网/控制台充点钱再试。`;
    } else if (kind === 'billing_disabled') {
      body = `<strong>账户没开通计费</strong>——你的服务商账户需要先启用付费功能才能用这个模型，或者你所在的地区不支持免费层。原始错误：<code>${escapedMsg}</code>。去服务商控制台开通付费即可。`;
    } else if (kind === 'auth') {
      body = `服务商拒绝了鉴权——多半是 <strong>API 密钥不对</strong>或权限不够。原始错误：<code>${escapedMsg}</code>。去「设置」检查一下 API key。`;
    } else if (kind === 'rate_or_quota') {
      body = `服务商启动了<strong>限流保护</strong>——可能短时间请求太快或者 quota 用完了。原始错误：<code>${escapedMsg}</code>。<strong>等几分钟再试</strong>就行。`;
    } else if (kind === 'network') {
      body = `<strong>没连上服务商</strong>，请求根本没送到。最常见原因（按概率从高到低）：<br>1. <strong>URL 拼错了</strong>——核对上面"请求地址"那一行，特别注意域名拼写、是否带 <code>/v1</code><br>2. 网络断了 / VPN 抖了一下<br>3. 该服务商不允许浏览器跨域调用（CORS 问题，建议换其他服务商）<br>原始错误：<code>${escapedMsg}</code>`;
    } else if (kind === 'payload_too_large') {
      body = `<strong>请求内容超出服务商的大小限制</strong>（Anthropic 是 32MB）——通常是历史聊天记录太长、或图片太大。可以试着<strong>清掉早期的对话历史</strong>或在「设置」里调小 narrative 长度。原始错误：<code>${escapedMsg}</code>`;
    } else if (kind === 'provider_5xx') {
      // Anthropic 529 是 API 全局过载，跟玩家自己的账户/请求都没关系；其他 5xx 是单家服务器问题
      const is529 = upstreamStatus === 529;
      body = is529
        ? `<strong>服务商整体过载</strong>（status 529——所有用户都在排队）。这跟你的账户或请求都没关系，<strong>稍等几分钟再试</strong>就行。原始错误：<code>${escapedMsg}</code>`
        : `服务商自己的服务器出问题了，跟你没关系。原始错误：<code>${escapedMsg}</code>。一般是临时性的，<strong>稍等几分钟再试</strong>多半就好；反复失败可以去服务商状态页确认。`;
    } else if (kind === 'forced_tool_thinking_incompat') {
      // Kimi-2.5 / DeepSeek-reasoner / 部分推理后端：thinking 启用时拒绝 forced tool_choice。
      // 我们对 deepseek 已自动降级 thinking，但 'custom' provider 走第三方代理时无法预判后端默认。
      // 游戏主流程依赖 forced tool_choice 做硬保证，所以引导用户关 thinking 而不是降工具调用。
      body = `当前模型/后端不支持「同时启用 <strong>thinking</strong> 和强制工具调用」。我们的游戏主流程依赖强制工具调用做硬保证，所以建议<strong>关闭 thinking</strong>——在「设置 → API 设置 → 思考模式」里调整，或换一个稳定支持工具调用的模型试试。原始错误：<code>${escapedMsg}</code><button class="" data-action="error-diagnosis-open-settings-btn">打开设置</button>`;
    }
  }
  if (body) {
    // upstream_failure 已命中 kind 分支，跳过下面的 status / type 路由
  } else if (type === 'safety_filtered') {
    // 直接 errorType（path B）：通常是世界卡等不走 ReAct 包装的路径直调 Gemini 撞审查
    const esc = window.htmlSecurity?.escapeText || (s => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const safetyReason = esc(info.safetyReason || '');
    const safetyStage = info.safetyStage;
    body = safetyStage === 'prompt'
      ? `<strong>你的输入触发了 Gemini 的内容审查</strong>（${safetyReason || '未知原因'}），整个请求被拒。常见触发位置：最近的对话内容、自定义世界卡、或 system prompt。试试<strong>调整一下输入内容</strong>，或在「设置」里换一个模型再试。`
      : `<strong>Gemini 在生成过程中被自家内容审查切断</strong>（${safetyReason || '未知原因'}）。可以先<strong>重试一次</strong>看看；反复出现可以在「设置」里调短 narrative 长度，或者换一个模型再试。`;
  } else if (type === 'network') {
    body = '<strong>没连上服务商</strong>，请求根本没送到。最常见原因（按概率从高到低）：<br>1. <strong>URL 拼错了</strong>——核对上面"请求地址"那一行，特别注意域名拼写、是否带 <code>/v1</code><br>2. 网络断了 / VPN 抖了一下<br>3. 该服务商不允许浏览器跨域调用（CORS 问题，建议换其他服务商）';
  } else if (type === 'timeout') {
    const elapsedNote = elapsedSec ? `等了 ${elapsedSec} 秒` : '等了挺久';
    body = `${elapsedNote}还没等到服务器回应，看起来是<strong>网络中断</strong>了。这种情况下数据卡在了路上，并不是你或者服务器哪里出问题，先<strong>重试一次</strong>试试就行。`;
  } else if (status === 400) {
    // Gemini 用 400 包装了三种语义不同的错（不是 401 / 不是 402），需要分开诊断：
    //  a) API key 错 → INVALID_ARGUMENT + API_KEY_INVALID/API_KEY_EXPIRED → auth 文案
    //  b) 账户没开 billing / 地区不支持免费层 → FAILED_PRECONDITION → billing_disabled 文案
    //  c) 真的请求字段错 → 默认文案
    const rawMsg = info.upstreamRawMessage || info.message || error?.message || '';
    if (/API[_\s]?KEY[_\s]?(INVALID|EXPIRED)|api.{0,5}key.{0,5}(invalid|expired|not[_\s]?valid)/i.test(rawMsg)) {
      body = '服务商没认出你的身份，多半是 <strong>API 密钥不对</strong>——可能没填、填错了、或者已经过期。去「设置」里把对应服务商的 API key 重新检查一下吧。';
    } else if (/FAILED_PRECONDITION|billing[\s_]?account|billing.{0,10}(not[\s_]?(enabled|configured)|required|disabled)/i.test(rawMsg)) {
      body = '<strong>账户没开通计费</strong>——你的服务商账户需要先启用付费功能才能用这个模型，或者你所在的地区不支持免费层。去服务商控制台开通付费即可。';
    } else {
      body = '你这次发出去的请求里有服务商不认识的字段或格式，所以被它拒掉了。具体是哪个字段，看上面卡片里"服务端返回"那一行就能看到。一般调整一下设置就好。';
    }
  } else if (status === 401 || status === 403) {
    // 中转站常用 401/403 包装"余额不足"——message 关键词比 status 准（relay 之类把"用户额度不足"用 403 返回）；
    // 同样的优先级在 ReAct 包装路径里已经体现在 classifyUpstreamErrorStep，这里给非 ReAct 路径（世界卡等直调）也用上
    const rawMsg = info.upstreamRawMessage || info.message || error?.message || '';
    if (/余额|额度|insufficient[\s_]?balance|out of credit/i.test(rawMsg)) {
      body = '你的<strong>账户余额不足</strong>，服务商拒绝继续提供服务。去服务商的官网/控制台充点钱，回来再试就能恢复。';
    } else if (status === 401) {
      body = '服务商没认出你的身份，多半是 <strong>API 密钥不对</strong>——可能没填、填错了、或者已经过期。去「设置」里把对应服务商的 API key 重新检查一下吧。';
    } else {
      body = '你能登录，但服务商不允许你访问这个具体的资源——可能这个模型对你的 key 没开放，也可能 key 的权限被限制了。回服务商后台检查一下 key 的权限设置。';
    }
  } else if (status === 402) {
    body = '你的<strong>账户余额不足</strong>，服务商拒绝继续提供服务。去服务商的官网/控制台充点钱，回来再试就能恢复。';
  } else if (status === 404) {
    body = '服务商找不到你请求的东西，通常是「设置」里这个服务商的 <strong>base URL 没填对</strong>，或者模型名拼错了。回去把这两个字段对一下。';
  } else if (status === 413) {
    body = '<strong>请求内容超出服务商的大小限制</strong>（Anthropic 是 32MB）——通常是历史聊天记录太长、或图片太大。可以试着<strong>清掉早期的对话历史</strong>或在「设置」里调小 narrative 长度。';
  } else if (status === 422) {
    body = '请求格式没问题，但其中某个参数的取值不被服务商接受（比如数字超出了允许范围）。卡片里"服务端返回"会指出是哪个参数，调一下再试。';
  } else if (status === 429) {
    // OpenAI 把"账户余额耗尽"也用 429 + code 'insufficient_quota'/'billing_hard_limit_reached' 返回——区分两者，
    // 前者要充钱不是等。path A (ReAct) 已在 classifyUpstreamErrorStep 里处理；这里给 path B 同等待遇。
    const code = info.providerErrorCode;
    const rawMsg = info.upstreamRawMessage || info.message || error?.message || '';
    if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached'
        || /insufficient[\s_]?quota|billing[\s_]?hard[\s_]?limit/i.test(rawMsg)) {
      body = '你的<strong>账户余额不足</strong>，服务商拒绝继续提供服务。去服务商的官网/控制台充点钱，回来再试就能恢复。';
    } else {
      body = '短时间内请求发太快了，服务商启动了<strong>限流保护</strong>——这是它那边的配额机制，跟你账户没问题。<strong>等几分钟再试</strong>就行。';
    }
  } else if (status === 500) {
    body = '服务商自己的服务器出问题了，跟你没关系。一般是临时性的，<strong>稍等几分钟再试</strong>多半就好；如果一直失败，可以去服务商的状态页确认一下是不是在维护。';
  } else if (status === 503) {
    body = '服务商现在用的人太多，<strong>服务器过载</strong>处理不过来了。<strong>稍等一会儿再试</strong>就行，通常几分钟就能恢复。';
  } else if (status === 529) {
    // Anthropic 自定义状态码：API 全局过载（不是单家服务器挂了）
    body = '<strong>服务商整体过载</strong>（status 529——所有用户都在排队），跟你的账户或请求都没关系。<strong>稍等几分钟再试</strong>就行，通常很快恢复。';
  } else if (typeof status === 'number' && status >= 500) {
    body = '服务商那边的服务器出了点问题，跟你的请求没关系。一般是临时的，<strong>重试一次</strong>就行。';
  } else if (typeof status === 'number' && status >= 400) {
    body = '请求被服务商拒掉了。具体原因看上面卡片里的 HTTP 状态和"服务端返回"，那两行会指出问题。';
  } else if (type === 'parse') {
    body = '服务器倒是给了响应，但返回的内容不是合法的 JSON，看起来是服务商那边出了点临时故障。这种情况<strong>重试一次</strong>一般就好。';
  } else if (type === 'upstream_failure') {
    // 已识别的 upstreamKind（balance/auth/rate_or_quota/network/provider_5xx）已在函数顶部
    // short-circuit 提前处理，走到这里说明 kind === 'unknown' 或缺失——老实把原 message 显示出来
    const rawMsg = info.upstreamRawMessage || info.message || '';
    const esc = window.htmlSecurity?.escapeText || (s => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const escapedMsg = esc(rawMsg);
    body = rawMsg
      ? `服务商报错：<code>${escapedMsg}</code>。先<strong>重试一次</strong>看看，反复出现可以去服务商状态页确认或反馈给开发者。`
      : '上游 API 调用失败，但具体原因没有更多信息。先<strong>重试一次</strong>试试，反复出现可以反馈给开发者。';
  } else if (type === 'narrative_skipped') {
    // 4a9a8b66 类问题: 模型 fc 协议会用 (调了其他工具) 但被 named tool_choice
    // 强制要求调 update_narrative 时不调，典型 Gemini gemini-3.1-flash-lite
    // 抽风行为。不引导换模型 (语义不对)，只让用户重试。
    body = '模型这次没生成叙事——它执行了其他工具，但跳过了关键的"叙事生成"工具。这通常是模型对工具调用的<strong>遵守不够稳定</strong>（一种偶发抽风），<strong>重试一次</strong>多半就好。如果反复出现，可以在「设置 → API 设置」里换一个工具调用更稳定的模型试试。';
  } else if (type === 'no_function_calling') {
    const esc = window.htmlSecurity?.escapeText || (s => String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    const providerLabel = esc(info.provider || '');
    const modelLabel = esc(info.model || '');
    const modelDesc = providerLabel || modelLabel
      ? `当前模型「<strong>${providerLabel}${providerLabel && modelLabel ? ' · ' : ''}${modelLabel}</strong>」`
      : '当前模型';
    body = `${modelDesc}没有按工具调用协议返回内容——游戏主流程要求模型能调用 update_narrative 等工具，<strong>这个模型可能不支持工具调用</strong>。请到「设置 → API 设置」<strong>切换到支持工具调用的模型</strong>，或<strong>启用「推荐设置」</strong>（一键采用我们调好的最优配置）。<button class="" data-action="error-diagnosis-open-settings-btn">打开设置</button>`;
  } else if (type === 'unexpected_format') {
    body = '服务商给了响应，但内容缺了我们期望的某些字段——大概率是模型这一次没按要求输出。<strong>重试一次</strong>，多半就正常了。';
  } else if (type === 'validation' || error?.code === 'DESIGN_VALIDATION_FAILED') {
    body = '模型这次生成的内容没通过校验——可能缺了必填字段，也可能某个字段格式不对。这是模型偶发"开小差"，<strong>重试一次</strong>通常就能拿到合规的版本。';
  } else if (type === 'runtime') {
    body = '这次失败不是网络或服务端的问题，是<strong>程序自己出了 bug</strong>。这种比较少见，麻烦点击下面的"复制错误信息"把 trace 发给开发者，我会去修。';
  } else {
    body = '暂时没识别出这是哪种类型的错误。先<strong>重试一次</strong>试试；如果反复出现同样的问题，点击下面的"复制错误信息"反馈给开发者就行。';
  }

  // 把 "重试一次" 这四个字替换为可点击按钮（仅当能定位到原始消息时）
  if (msgIdx != null && msgIdx !== '') {
    body = body.replace(/重试一次/g,
      `<button class="" data-action="error-diagnosis-retry-btn" data-msg-idx="${msgIdx}">重试一次</button>`);
  }

  return `
    <div class="error-diagnosis-disclaimer">
      <span class="material-symbols-outlined">shield</span>
      <span>这个对话框只在你的浏览器里打开，内容<strong>不会进入游戏上下文</strong>，不会影响 AI 后续生成，请放心查看。</span>
    </div>
    <p class="error-diagnosis-lead">根据上述错误的提示，您遇到的问题大概率是因为：</p>
    <p class="error-diagnosis-body">${body}</p>
  `;
}

/**
 * 错误卡片点击委托：从 chatHistory 反查 error 对象并触发诊断对话框。
 */
function _handleErrorBannerClick(e) {
  // 诊断对话框内"重试一次"按钮：关闭对话框并触发原消息的 retry
  const retryBtn = e.target.closest('[data-action~="error-diagnosis-retry-btn"]');
  if (retryBtn) {
    e.preventDefault();
    e.stopPropagation();
    const idx = parseInt(retryBtn.dataset.msgIdx, 10);
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    if (Number.isNaN(idx)) return;
    const targetMsgEl = document.querySelector(`.chat-message[data-original-index="${idx}"]`);
    const regenerateBtn = targetMsgEl?.querySelector('.message-actions .regenerate-action');
    if (regenerateBtn && typeof regenerateBtn.click === 'function') {
      regenerateBtn.click();
    } else if (typeof showToast === 'function') {
      showToast('重试按钮不可用，请用消息下方的重试图标');
    }
    return;
  }

  // "打开设置"按钮（no_function_calling 分支）：关闭诊断对话框 + 跳到 API 设置 tab
  const openSettingsBtn = e.target.closest('[data-action~="error-diagnosis-open-settings-btn"]');
  if (openSettingsBtn) {
    e.preventDefault();
    e.stopPropagation();
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
    if (typeof window.openSettings === 'function') {
      window.openSettings('api');
    } else if (typeof showToast === 'function') {
      showToast('设置入口不可用，请从右上角菜单打开设置');
    }
    return;
  }

  // 排除卡片内"操作"按钮（设置入口、链接等）的点击
  if (e.target.closest('.chat-inline-action')) return;
  if (e.target.closest('a, button')) return;
  const banner = e.target.closest('.chat-error-banner');
  if (!banner) return;
  const msgEl = banner.closest('.chat-message[data-original-index]');
  if (!msgEl) return;
  const idx = parseInt(msgEl.dataset.originalIndex, 10);
  if (Number.isNaN(idx)) return;
  const histMsg = Array.isArray(chatHistory) ? chatHistory[idx] : null;
  if (!histMsg?.errorMeta?.error) return;
  _openErrorDiagnosisDialog(histMsg.errorMeta.error, msgEl);
}

/**
 * 复制当前 error 关联的 trace JSON 到剪贴板。
 * 优先按 failedPhase 找到对应的 lastPayload，调用 buildTraceDebugPayload 转 trace；
 * 没有匹配 payload 则兜底复制 errorMeta 摘要。
 *
 * 改为同步函数 + .then() 链：调用方（showConfirmModal cancel 回调）已是同步入口；
 * 历史 async/await 写法在 iOS Safari 下 user activation 跨 microtask 不稳定，
 * 改为同步触发 navigator.clipboard.writeText 让浏览器在调用瞬间识别到 user gesture。
 */
function _copyErrorTrace(error) {
  const { errorInfo, traceId, failedPhase } = _extractAIFailureMeta(error);
  const phase = failedPhase || errorInfo?.phase || '';
  const ai = window.aiService;

  let payload = null;
  if (ai) {
    if (phase === 'gm_decision') payload = ai.lastGMPayload;
    else if (phase === 'summary' || phase === 'chapter') payload = ai.lastSummaryPayload;
    else if (phase === 'sms') payload = ai.lastSMSPayload;
    else if (phase === 'design' || /^(design|p1|p2|p3|repair)/i.test(phase)) payload = ai.lastDesignPayload;
    else payload = ai.lastPayload;
  }

  let textToCopy;
  if (payload && typeof window.buildTraceDebugPayload === 'function') {
    try {
      textToCopy = JSON.stringify(window.buildTraceDebugPayload(payload), null, 2);
    } catch (e) {
      console.warn('[ErrorDiagnosis] trace 构建失败，回退到摘要:', e);
    }
  }
  if (!textToCopy) {
    textToCopy = JSON.stringify({ traceId, failedPhase: phase, errorInfo }, null, 2);
  }

  const tryExecCommandFallback = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = textToCopy;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      if (typeof showToast === 'function') showToast('复制成功');
    } catch (e) {
      console.error('[ErrorDiagnosis] 复制失败:', e);
      if (typeof showToast === 'function') showToast('复制失败');
    }
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard
      .writeText(textToCopy)
      .then(() => {
        if (typeof showToast === 'function') showToast('复制成功');
      })
      .catch(e => {
        console.warn('[ErrorDiagnosis] clipboard API 失败，尝试 execCommand 兜底:', e);
        tryExecCommandFallback();
      });
    return;
  }

  tryExecCommandFallback();
}

/**
 * 打开"错误诊断"对话框（基于 showConfirmModal）
 */
function _openErrorDiagnosisDialog(error, msgEl) {
  const { errorInfo } = _extractAIFailureMeta(error);
  if (typeof showConfirmModal !== 'function') return;
  const msgIdx = msgEl?.dataset?.originalIndex ?? '';
  showConfirmModal(
    '错误诊断',
    '',
    () => {},
    () => { _copyErrorTrace(error); },
    {
      icon: 'psychology_alt',
      descriptionHtml: _buildDiagnosisHtml(errorInfo, error, msgIdx),
      confirmLabel: '我知道了',
      cancelLabel: '复制错误信息',
    }
  );
}
window._openErrorDiagnosisDialog = _openErrorDiagnosisDialog;

/**
 * 渲染结构化错误 Banner HTML（镜像 debugUI.js 的 renderDesignErrorBanner）
 * 不带红色背景，直接嵌入聊天气泡
 */
function _renderErrorBannerHTML(error) {
  const { errorInfo, failedPhase } = _extractAIFailureMeta(error);
  const info = errorInfo || {};

  // 也尝试从 designFailure 中获取信息
  const df = error?.designFailure;

  const lines = [];
  const isValidationError =
    info.errorType === 'validation' || error?.code === 'DESIGN_VALIDATION_FAILED';
  lines.push(
    `<div class="chat-error-title"><span class="chat-error-title-text">${isValidationError ? '❌ 字段校验失败' : '❌ API 调用失败'}</span><span class="chat-error-help-badge" title="点击查看错误诊断"><span class="material-symbols-outlined">help</span></span></div>`
  );

  const phaseText = info.phase || failedPhase || df?.phase || '';
  const stageText = df?.stageName || info.stageName || '';
  const moduleText = info.module || '';
  const providerText = info.provider || df?.provider || '';
  const modelText = info.model || '';

  const mergedPhase = (phaseText && moduleText && phaseText !== moduleText)
    ? `${phaseText} / ${moduleText}`
    : (phaseText || moduleText);
  const stageDisplay = stageText && mergedPhase
    ? `${stageText} (${mergedPhase})`
    : (stageText || mergedPhase);
  if (stageDisplay) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">阶段</span>${escapeHTML(stageDisplay)}</div>`
    );
  }
  if (providerText) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">服务商</span>${escapeHTML(providerText)}</div>`
    );
  }
  if (modelText) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">模型</span>${escapeHTML(modelText)}</div>`
    );
  }
  if (info.httpStatus) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">HTTP 状态</span>${info.httpStatus} ${escapeHTML(info.httpStatusText || '')}</div>`
    );
  }
  const serverErrorText = _extractServerErrorText(info.responseBody);
  if (serverErrorText) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">服务端返回</span>${escapeHTML(serverErrorText)}</div>`
    );
  }
  if (info.errorType && info.errorType !== 'http') {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">错误类型</span>${escapeHTML(info.errorType)}</div>`
    );
  }
  const rawMsg = info.message || error?.message || '';
  const msgIsHttpRestate = info.httpStatus && /^HTTP\s*\d+/i.test(rawMsg);
  if (rawMsg && !msgIsHttpRestate) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">错误消息</span>${escapeHTML(rawMsg)}</div>`
    );
  }
  if (info.stageElapsedMs !== null && info.stageElapsedMs !== undefined) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">耗时</span>${(info.stageElapsedMs / 1000).toFixed(1)}s</div>`
    );
  } else if (info.elapsedMs !== null && info.elapsedMs !== undefined) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">耗时</span>${(info.elapsedMs / 1000).toFixed(1)}s</div>`
    );
  }
  if (info.url) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">请求地址</span>${escapeHTML(info.url)}</div>`
    );
  }
  if (_shouldShowSettingsActionInErrorBanner(error, info)) {
    lines.push(
      `<div class="chat-error-row"><span class="chat-error-label">操作</span>${getChatInlineSettingsActionHtml()}</div>`
    );
  }

  return `<div class="chat-error-banner">${lines.join('')}</div>`;
}
window._renderErrorBannerHTML = _renderErrorBannerHTML;

/**
 * 处理主线消息发送
 * @param {string} message - 发送给 AI 的完整消息（含文档内容）
 * @param {string} [displayMessage] - 在 UI 中展示的消息（不含文档全文）
 */
async function handleMainlineSendMessage(message, displayMessage, options = {}) {
  removeQuickStartButtons();

  // 世界卡走独立处理流程
  if (isDesignMode) {
    return handleDesignModeSendMessage(message, displayMessage);
  }

  const reactApiKey =
    typeof aiService?.getApiKeyForModule === 'function'
      ? aiService.getApiKeyForModule('react')
      : null;
  if (!reactApiKey) {
    const shownMessage = displayMessage || message;
    const noApiError =
      window.i18nService?.getResolvedLanguage?.() === 'en'
        ? `⚠️ Connection error: no API key. Click ${getChatInlineSettingsActionHtml()} before sending.`
        : `⚠️ 连接错误：没有 API Key。请先点击${getChatInlineSettingsActionHtml()}配置后再发送。`;

    addMessage(shownMessage, getUserLabel(), 'user');
    setTimeout(enhanceMessages, 10);
    chatHistory.push({
      sender: 'user',
      text: message,
      displayText: displayMessage && displayMessage !== message ? displayMessage : undefined,
    });

    addMessage(noApiError, 'AI', 'ai');
    chatHistory.push({ sender: 'ai', text: noApiError });
    if (typeof window.autoSaveGame === 'function') {
      window.autoSaveGame();
    }
    if (typeof showToast === 'function') {
      showToast('连接错误：没有 API Key');
    }
    if (typeof aiService?.clearPendingPlayerActionContext === 'function') {
      aiService.clearPendingPlayerActionContext();
    }
    return;
  }

  // 记录发送时间戳
  const sendTime = performance.now();

  // 显示用户消息（带等待计时器）— 使用 displayMessage 避免显示文档全文
  const userMsgEl = addMessage(displayMessage || message, getUserLabel(), 'user', null, {
    showWaitTimer: true,
  });
  setTimeout(enhanceMessages, 10);
  // text 保存完整消息（含文档内容，用于发给 AI），displayText 保存 UI 展示文本
  chatHistory.push({
    sender: 'user',
    text: message,
    displayText: displayMessage && displayMessage !== message ? displayMessage : undefined,
  });

  // 启动等待计时器（传入发送时间戳）
  startUserWaitTimer(userMsgEl, sendTime);

  // 检查是否使用流式输出
  const useStreaming = aiService.getConfig().useStreaming;

  // 统一使用 streamVisualizer 创建骨架屏
  let liveRendererStarted = false;
  if (typeof streamVisualizer !== 'undefined') {
    try {
      liveRendererStarted = streamVisualizer.start(useStreaming) === true;
    } catch (streamVisualizerStartError) {
      console.warn(
        '[ChatCore] streamVisualizer.start() failed; AI reply will fall back to refreshChatUI on success.',
        streamVisualizerStartError
      );
    }
  }

  // 发送置顶：骨架屏已 append，把刚发的用户消息滚到视口顶（ChatGPT 式，
  // 回答在其下方流式生成、保持置顶不跟底）。仅 live 流式路径；fallback
  // 走 refreshChatUI 不置顶。详见 plan「发送置顶」。
  if (liveRendererStarted && userMsgEl && window.scrollController
      && typeof window.scrollController.scrollNewTurnToTop === 'function') {
    window.scrollController.scrollNewTurnToTop(userMsgEl);
  }

  // 启用取消按钮
  setSendBtnCancelMode(true);

  try {
    // 流式数据通过回调直接传递给 streamVisualizer（高频）
    // Step 完成通知通过 EventBus 广播，不再使用回调
    const onChunk = (text, reasoning) => {
      if (typeof streamVisualizer !== 'undefined' && streamVisualizer.isStreaming()) {
        streamVisualizer.update(text, reasoning);
      }
    };
    // 动作分类参数透传给 generateResponse，与 ReAct 并行执行
    const aiResponse = await aiService.generateResponse(chatHistory, onChunk, {
      actionClassification: {
        actionInputText: options.actionInputText || '',
        selectedChoicePayload: options.selectedChoicePayload || '',
        selectedChoiceText: options.selectedChoiceText || '',
      },
      ooc: {
        candidates: Array.isArray(options.oocCandidates) ? options.oocCandidates : [],
      },
    });
    setSendBtnCancelMode(false);
    processAIResponse(aiResponse);
    window.autoSaveGame();
    if (!liveRendererStarted && typeof refreshChatUI === 'function') {
      if (typeof aiService !== 'undefined' && typeof aiService.flushDeferredWorldCardActivation === 'function') {
        aiService.flushDeferredWorldCardActivation();
      }
      console.warn(
        '[ChatCore] Live AI renderer was unavailable or failed to start; rendering reply via refreshChatUI fallback.'
      );
      refreshChatUI();
    } else {
      flushDeferredAiUiWork();
    }
  } catch (error) {
    setSendBtnCancelMode(false);

    // 用户主动取消：保留已输出的部分文本
    if (error.name === 'AbortError') {
      let partialText = '';
      if (typeof streamVisualizer !== 'undefined' && streamVisualizer.isStreaming()) {
        partialText = streamVisualizer.getCurrentText?.() || '';
        streamVisualizer.abort();
      }
      window.scrollController?.clearTurnSpacer?.(); // 取消：撤销发送置顶
      stopUserWaitTimer(false);
      chatHistory.push({
        sender: 'ai',
        text: partialText ? partialText + '\n\n（已取消）' : '（已取消）',
        isCancelled: true,
      });
      window.autoSaveGame();
      flushDeferredAiUiWork();
      return;
    }

    console.error(error);
    const { errorInfo, traceId, failedPhase } = _extractAIFailureMeta(error);

    // EventBus 单轨模式：通过事件通知错误
    window.eventBus.emit(window.GameEvents.AI_ERROR, { error, errorInfo, traceId, failedPhase });

    chatHistory.push({
      sender: 'ai',
      text: _formatAIFailureMessage(error),
      isError: true,
      errorMeta: { error, errorInfo, traceId, failedPhase },
    });
    window.autoSaveGame();
    if (typeof aiService !== 'undefined' && typeof aiService.flushDeferredWorldCardActivation === 'function') {
      aiService.flushDeferredWorldCardActivation();
    }
    refreshChatUI();
  }
}

/**
 * P3 内联编辑器（简单字段）— 支持 Enter 保存、Escape 取消
 */
function _showP3InlineEditor(aiMsgEl, op) {
  const card = aiMsgEl.querySelector(`.p3-diff-op-card[data-op-id="${op.id}"]`);
  if (!card) return;

  const body = card.querySelector('.p3-diff-op-body');
  if (!body) return;

  // 已有编辑器则忽略
  if (body.querySelector('.p3-inline-editor')) return;

  const editorEl = document.createElement('div');
  editorEl.className = 'p3-inline-editor';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = typeof op.value === 'string' ? op.value : String(op.value ?? '');
  editorEl.appendChild(input);

  const doSave = () => {
    let newValue = input.value;
    // 尝试保持原始类型
    if (typeof op.value === 'number') newValue = Number(newValue);
    else if (typeof op.value === 'boolean') newValue = newValue === 'true';

    if (window.designService) {
      window.designService.editOperationValue(op.id, newValue);
    }
    editorEl.remove();
    _refreshPlanPanel(aiMsgEl);
  };

  const doCancel = () => editorEl.remove();

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
  });

  const btnRow = _createEditorBtnRow(doSave, doCancel);
  editorEl.appendChild(btnRow);

  body.appendChild(editorEl);
  input.focus({ preventScroll: true });
  input.select();
}

/**
 * P3 JSON 编辑器（数组/复杂字段）— 实时验证 + Ctrl+Enter 保存
 */
function _showP3JsonEditor(aiMsgEl, op) {
  const card = aiMsgEl.querySelector(`.p3-diff-op-card[data-op-id="${op.id}"]`);
  if (!card) return;

  const body = card.querySelector('.p3-diff-op-body');
  if (!body) return;

  if (body.querySelector('.p3-inline-editor')) return;

  const editorEl = document.createElement('div');
  editorEl.className = 'p3-inline-editor';

  const textarea = document.createElement('textarea');
  textarea.className = 'p3-editor-textarea';
  try {
    textarea.value = JSON.stringify(op.value, null, 2);
  } catch {
    textarea.value = String(op.value);
  }
  editorEl.appendChild(textarea);

  // 实时 JSON 验证指示器
  const validationEl = document.createElement('div');
  validationEl.className = 'p3-json-validation';
  editorEl.appendChild(validationEl);

  let validateTimer = null;
  const doValidate = () => {
    try {
      JSON.parse(textarea.value);
      validationEl.textContent = '✓ JSON 格式正确'; // ui-lint-allow
      validationEl.className = 'p3-json-validation valid';
    } catch (e) {
      validationEl.textContent = '✗ ' + e.message; // ui-lint-allow
      validationEl.className = 'p3-json-validation invalid';
    }
  };
  textarea.addEventListener('input', () => {
    clearTimeout(validateTimer);
    validateTimer = setTimeout(doValidate, 300);
    // 自适应高度
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(400, Math.max(120, textarea.scrollHeight)) + 'px';
  });
  // 初始验证 + 高度
  doValidate();
  requestAnimationFrame(() => {
    textarea.style.height = Math.min(400, Math.max(120, textarea.scrollHeight)) + 'px';
  });

  const doSave = () => {
    try {
      const newValue = JSON.parse(textarea.value);
      if (window.designService) {
        window.designService.editOperationValue(op.id, newValue);
      }
      editorEl.remove();
      _refreshPlanPanel(aiMsgEl);
    } catch (e) {
      if (typeof showToast === 'function') {
        showToast('JSON 格式错误: ' + e.message);
      }
    }
  };

  const doCancel = () => { clearTimeout(validateTimer); editorEl.remove(); };

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
  });

  const btnRow = _createEditorBtnRow(doSave, doCancel);
  editorEl.appendChild(btnRow);

  body.appendChild(editorEl);
  textarea.focus({ preventScroll: true });
}

/**
 * P3 表单编辑器（对象字段）— 为每个 key 生成标签+输入控件
 */
function _showP3FormEditor(aiMsgEl, op) {
  const card = aiMsgEl.querySelector(`.p3-diff-op-card[data-op-id="${op.id}"]`);
  if (!card) return;

  const body = card.querySelector('.p3-diff-op-body');
  if (!body) return;

  if (body.querySelector('.p3-inline-editor')) return;

  const editorEl = document.createElement('div');
  editorEl.className = 'p3-inline-editor p3-form-editor';

  const obj = op.value;
  const fieldEls = {};

  for (const [key, val] of Object.entries(obj)) {
    if (key.startsWith('_')) continue; // 跳过内部字段

    const fieldDiv = document.createElement('div');
    fieldDiv.className = 'p3-form-field';

    const label = document.createElement('label');
    label.textContent = key;
    fieldDiv.appendChild(label);

    if (val !== null && typeof val === 'object') {
      // 嵌套对象/数组 → 小 textarea
      const ta = document.createElement('textarea');
      ta.className = 'p3-editor-textarea p3-form-field-json';
      try { ta.value = JSON.stringify(val, null, 2); } catch { ta.value = String(val); }
      ta.addEventListener('input', () => {
        ta.style.height = 'auto';
        ta.style.height = Math.min(200, Math.max(60, ta.scrollHeight)) + 'px';
      });
      requestAnimationFrame(() => {
        ta.style.height = Math.min(200, Math.max(60, ta.scrollHeight)) + 'px';
      });
      fieldDiv.appendChild(ta);
      fieldEls[key] = { type: 'json', el: ta };
    } else if (typeof val === 'boolean') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = val;
      fieldDiv.appendChild(cb);
      fieldEls[key] = { type: 'boolean', el: cb };
    } else if (typeof val === 'number') {
      const numInput = document.createElement('input');
      numInput.type = 'number';
      numInput.value = val;
      numInput.step = 'any';
      fieldDiv.appendChild(numInput);
      fieldEls[key] = { type: 'number', el: numInput };
    } else {
      // string 或 null
      const strVal = val === null ? '' : String(val);
      if (strVal.length > 80) {
        const ta = document.createElement('textarea');
        ta.className = 'p3-editor-textarea';
        ta.value = strVal;
        ta.addEventListener('input', () => {
          ta.style.height = 'auto';
          ta.style.height = Math.min(200, Math.max(60, ta.scrollHeight)) + 'px';
        });
        requestAnimationFrame(() => {
          ta.style.height = Math.min(200, Math.max(60, ta.scrollHeight)) + 'px';
        });
        fieldDiv.appendChild(ta);
        fieldEls[key] = { type: 'text', el: ta };
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.value = strVal;
        fieldDiv.appendChild(inp);
        fieldEls[key] = { type: 'string', el: inp };
      }
    }

    editorEl.appendChild(fieldDiv);
  }

  const doSave = () => {
    const newObj = {};
    // 保留内部字段
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) newObj[k] = v;
    }
    for (const [key, field] of Object.entries(fieldEls)) {
      switch (field.type) {
        case 'json':
          try { newObj[key] = JSON.parse(field.el.value); } catch {
            if (typeof showToast === 'function') showToast(`字段 "${key}" JSON 格式错误`);
            return;
          }
          break;
        case 'boolean':
          newObj[key] = field.el.checked;
          break;
        case 'number':
          newObj[key] = Number(field.el.value);
          break;
        default:
          newObj[key] = field.el.value || null;
      }
    }
    if (window.designService) {
      window.designService.editOperationValue(op.id, newObj);
    }
    editorEl.remove();
    _refreshPlanPanel(aiMsgEl);
  };

  const doCancel = () => editorEl.remove();

  // Ctrl+Enter / Escape 全局快捷键
  editorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
  });

  const btnRow = _createEditorBtnRow(doSave, doCancel);
  editorEl.appendChild(btnRow);

  body.appendChild(editorEl);
  // 聚焦第一个输入元素
  const firstInput = editorEl.querySelector('input, textarea');
  if (firstInput) firstInput.focus({ preventScroll: true });
}

/**
 * P3 长文本编辑器 — 自适应 textarea + 字符/行数统计
 */
function _showP3TextAreaEditor(aiMsgEl, op) {
  const card = aiMsgEl.querySelector(`.p3-diff-op-card[data-op-id="${op.id}"]`);
  if (!card) return;

  const body = card.querySelector('.p3-diff-op-body');
  if (!body) return;

  if (body.querySelector('.p3-inline-editor')) return;

  const editorEl = document.createElement('div');
  editorEl.className = 'p3-inline-editor';

  const textarea = document.createElement('textarea');
  textarea.className = 'p3-editor-textarea';
  textarea.value = typeof op.value === 'string' ? op.value : String(op.value ?? '');
  editorEl.appendChild(textarea);

  // 字符/行数统计
  const metaEl = document.createElement('div');
  metaEl.className = 'p3-editor-meta';
  editorEl.appendChild(metaEl);

  const updateMeta = () => {
    const chars = textarea.value.length;
    const lines = textarea.value.split('\n').length;
    metaEl.textContent = `${chars} 字符 · ${lines} 行`;
    // 自适应高度
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(400, Math.max(120, textarea.scrollHeight)) + 'px';
  };
  textarea.addEventListener('input', updateMeta);
  updateMeta();
  requestAnimationFrame(updateMeta);

  const doSave = () => {
    if (window.designService) {
      window.designService.editOperationValue(op.id, textarea.value);
    }
    editorEl.remove();
    _refreshPlanPanel(aiMsgEl);
  };

  const doCancel = () => editorEl.remove();

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); doSave(); }
    else if (e.key === 'Escape') { e.preventDefault(); doCancel(); }
  });

  const btnRow = _createEditorBtnRow(doSave, doCancel);
  editorEl.appendChild(btnRow);

  body.appendChild(editorEl);
  textarea.focus({ preventScroll: true });
}

/**
 * 创建编辑器按钮行（保存 + 取消）
 */
function _createEditorBtnRow(onSave, onCancel) {
  const row = document.createElement('div');
  row.className = '';
  row.dataset.action = 'p3-editor-btn-row';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'btn-primary';
  saveBtn.dataset.action = 'p3-inline-editor-btn p3-inline-editor-save';
  saveBtn.textContent = '保存';
  saveBtn.addEventListener('click', onSave);
  row.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn-secondary';
  cancelBtn.dataset.action = 'p3-inline-editor-btn p3-inline-editor-cancel';
  cancelBtn.textContent = '取消';
  cancelBtn.addEventListener('click', onCancel);
  row.appendChild(cancelBtn);

  return row;
}

/**
 * Plan Panel 渲染与交互绑定
 */
function _renderPlanPanel(aiMsgEl, enrichedOps) {
  if (!window.PlanRenderer || !window.designService) return;

  const contentEl = aiMsgEl.querySelector('.chat-message-content');
  if (!contentEl) return;

  const state = designService.getP3SessionState();

  const panelOptions = {
    streaming: state.streaming,
    canUndo: state.canUndo,
    onToggle: (opId, checked) => {
      if (checked) designService.acceptOperation(opId);
      else designService.rejectOperation(opId);
      _refreshPlanPanel(aiMsgEl);
    },
    onToggleAll: (checked) => {
      if (checked) designService.acceptAll();
      else designService.rejectAll();
      _refreshPlanPanel(aiMsgEl);
    },
    onApply: async () => {
      const ops = designService.p3Session.enrichedOps;
      const acceptedCount = ops.filter(op => op.status === 'accepted').length;
      if (acceptedCount === 0) return;

      const confirmed = await showDesignConfirm(
        `确认应用 ${acceptedCount} 项修改？`,
        '修改将写入世界配置，可在预览面板中查看结果。'
      );
      if (!confirmed) return;

      const result = designService.applySelectedOperations();
      if (typeof showToast === 'function') {
        if (result.failed > 0) {
          showToast(`执行失败，已全部回滚`, 'error');
        } else if (result.skipped > 0) {
          showToast(`${result.applied} 项已应用，${result.skipped} 项已跳过`);
        } else {
          showToast(`已应用 ${result.applied} 项修改`);
        }
      }
      _refreshPlanPanel(aiMsgEl);
    },
    onUndo: () => {
      const result = designService.undoLastOperation();
      if (result && typeof showToast === 'function') {
        showToast('已撤销');
      }
      _refreshPlanPanel(aiMsgEl);
    },
    onUndoAll: () => {
      const count = designService.undoAllOperations();
      if (count > 0 && typeof showToast === 'function') {
        showToast(`已撤销 ${count} 项修改`);
      }
      _refreshPlanPanel(aiMsgEl);
    },
  };

  window.PlanRenderer.renderPlanPanel(enrichedOps, contentEl, panelOptions);
}

/**
 * 刷新已渲染的 plan panel（状态变化后调用）
 */
function _refreshPlanPanel(aiMsgEl) {
  if (!window.designService) return;
  const ops = designService.p3Session.enrichedOps;
  if (ops.length > 0) {
    _renderPlanPanel(aiMsgEl, ops);
  }
}

/**
 * 世界卡消息处理（V2 三阶段路由）
 * 根据当前 phase 路由到 Phase 1（框架采集对话）或 Phase 3（审阅编辑）
 * Phase 2（自动生成）由 handleDesignModePhase2 独立处理
 */
async function handleDesignModeSendMessage(message, displayMessage) {
  // 注意：isSending 由外层 handleSendMessage 管理，此处不重复检查
  const isP1PackedReply = typeof message === 'string' && message.includes('【回答当前轮问题】');
  let currentPhase = null;

  // 用户消息的索引（push 前的长度）
  const userIndex = chatHistory.length;

  // 显示用户消息
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-message user-message design-mode-msg';
  userMsgEl.dataset.originalIndex = userIndex;
  const userMessageContent = _getDesignModeUserMessageSafeContent(displayMessage || message);
  userMsgEl.innerHTML = `
        <div class="chat-user-label">${getUserLabel()}</div>
        <div class="chat-message-content">${userMessageContent}</div>
    `;
  applyUserTurnLabel(userMsgEl, userIndex);
  chatMessagesArea.appendChild(userMsgEl);

  chatHistory.push({
    sender: 'user',
    text: message,
    displayText: displayMessage && displayMessage !== message ? displayMessage : undefined,
  });

  setTimeout(enhanceMessages, 10);

  // 显示加载指示器
  const designProviderKey = resolveDesignProviderKey();
  const designModelLabel = resolveDesignModelLabel();
  const designAssistantLabel = escapeHTML(formatDesignAssistantLabel(designModelLabel));
  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-message ai-message design-mode-msg design-loading';
  loadingEl.innerHTML = `
        <div class="chat-user-label">${designAssistantLabel}</div>
        <div class="chat-message-content">
            <div class="design-thinking-indicator">
                <span class="design-dot"></span>
                <span class="design-dot"></span>
                <span class="design-dot"></span>
            </div>
        </div>
    `;
  applyAiProviderDataset(loadingEl, designProviderKey);
  chatMessagesArea.appendChild(loadingEl);

  // P3 流式消息元素：声明在 try 外，让 catch 也能访问以便清理残留 DOM
  let p3StreamMsgEl = null;

  try {
    if (!window.designService) {
      throw new Error('设计服务未初始化，请重新进入世界卡');
    }

    currentPhase = designService.phase;
    let aiText = '';
    let p1Result = null;

    // Stage 3 卡牌审阅模式：自然语言改写（仅作用于 character_database）
    if (currentPhase === 'p2' && designService.p2ReviewStage != null) {
      setSendBtnCancelMode(true);
      try {
        const editResult = await designService._reviewModeNaturalEdit(message);
        setSendBtnCancelMode(false);
        loadingEl.remove();
        const summaryParts = [];
        summaryParts.push(
          editResult.applied > 0
            ? `> ✓ 已应用 ${editResult.applied} 处修改，请查看右侧角色卡。` /* ui-lint-allow: markdown 状态消息装饰勾 */
            : '> ⓘ 本次未生成实际修改（可能超出审阅范围或 AI 仅做了说明）。'
        );
        const discarded = editResult.discardedByTarget || {};
        const discardedKeys = Object.keys(discarded);
        if (discardedKeys.length > 0) {
          const breakdown = discardedKeys
            .map(t => `${discarded[t]} 条 ${t}`)
            .join('、');
          summaryParts.push(
            `> ⚠️ AI 还输出了 ${breakdown} 修改，已被丢弃（卡牌审阅模式仅作用于 character_database）。如需修改这些目标，请在 Stage 4 完成后于 P3 阶段处理。`
          );
        }
        const summary = '\n\n' + summaryParts.join('\n\n');
        const aiMsgText = (editResult.text || '').trim() + summary;
        const reviewAiMsg = {
          sender: 'ai',
          text: aiMsgText,
          modelLabel: designModelLabel,
        };
        if (designProviderKey) reviewAiMsg.providerKey = designProviderKey;
        chatHistory.push(reviewAiMsg);
        const reviewMsgEl = document.createElement('div');
        reviewMsgEl.className = 'chat-message ai-message design-mode-msg';
        reviewMsgEl.innerHTML = `
          <div class="chat-user-label">${designAssistantLabel}</div>
          <div class="chat-message-content">${formatMessageContent(aiMsgText)}</div>
        `;
        applyAiProviderDataset(reviewMsgEl, designProviderKey);
        chatMessagesArea.appendChild(reviewMsgEl);
        setTimeout(enhanceMessages, 10);
        if (window.designService) designService._fullSave(chatHistory);
        isSending = false;
        return;
      } catch (err) {
        setSendBtnCancelMode(false);
        loadingEl.remove();
        console.error('[DesignMode] review-mode natural edit failed:', err);
        const errMsg = {
          sender: 'ai',
          text: `审阅模式改写失败：${err?.message || err}`,
          modelLabel: designModelLabel,
          isError: true,
        };
        if (designProviderKey) errMsg.providerKey = designProviderKey;
        chatHistory.push(errMsg);
        refreshChatUI();
        isSending = false;
        return;
      }
    }

    if (currentPhase === 'p1') {
      // Phase 1: 框架采集对话
      setSendBtnCancelMode(true);
      const result = await designService.sendP1Message(message, chatHistory);
      setSendBtnCancelMode(false);
      p1Result = result;
      aiText = result.text;

      if (result.frameworkReady) {
        // 框架就绪：提示用户点击「执行」开始生成（不再自动触发）
        aiText += `\n\n---\n\n✅ 世界框架已整理完毕。点击输入栏的${getChatInlineExecuteActionHtml()}按键开始自动生成。`;
        updateExecuteButtonState('p1');
      }
    } else if (currentPhase === 'p3') {
      // Phase 3: Cursor 化编辑 — 带流式 + diff 面板

      // 准备流式文本显示：替换 loading 为流式消息容器
      loadingEl.remove();
      p3StreamMsgEl = document.createElement('div');
      p3StreamMsgEl.className = 'chat-message ai-message design-mode-msg';
      // aiIndex 将在后续设置（chatHistory push 后）
      p3StreamMsgEl.innerHTML = `
        <div class="chat-user-label">${designAssistantLabel}</div>
        <div class="chat-message-content"><span class="p3-stream-text">
          <span class="p3-stream-loading">
            <span class="design-dot"></span>
            <span class="design-dot"></span>
            <span class="design-dot"></span>
          </span>
        </span></div>
      `;
      applyAiProviderDataset(p3StreamMsgEl, designProviderKey);
      chatMessagesArea.appendChild(p3StreamMsgEl);

      // 将发送按钮切换为取消模式
      setSendBtnCancelMode(true);

      const streamTextEl = p3StreamMsgEl.querySelector('.p3-stream-text');
      let lastStreamText = '';

      // 使用 P3StreamParser 处理流式 chunk
      const streamParser = window.P3StreamParser ? new window.P3StreamParser({
        onTextChunk: (text) => {
          if (streamTextEl && text !== lastStreamText) {
            streamTextEl.innerHTML = formatMessageContent(text);
            lastStreamText = text;
          }
        },
      }) : null;

      const p3Options = {};
      if (streamParser) {
        let _lastAccLen = 0;
        p3Options.onStreamChunk = (accumulatedText) => {
          try {
            // Summary API 传入的是累积全文，P3StreamParser 期望增量 delta
            const delta = accumulatedText.slice(_lastAccLen);
            _lastAccLen = accumulatedText.length;
            if (delta) streamParser.feed(delta);
          } catch (err) {
            console.warn('[P3] Stream parser feed error:', err);
            p3Options.onStreamChunk = null; // 降级到完整响应解析
          }
        };
      }

      const p3Result = await designService.sendP3Message(message, p3Options);

      // 生成完成，恢复发送按钮
      setSendBtnCancelMode(false);

      // abort 特判：跳过成功收尾
      if (p3Result.aborted) {
        if (p3StreamMsgEl?.parentNode) p3StreamMsgEl.remove();
        loadingEl.remove();
        isSending = false;
        return;
      }

      aiText = p3Result.text;

      // 更新流式消息为最终文本
      const contentEl = p3StreamMsgEl.querySelector('.chat-message-content');
      if (contentEl) {
        contentEl.innerHTML = formatMessageContent(aiText);
      }

      // 提示用户上一次的待执行操作已被替换
      if (p3Result.hadPendingOps > 0) {
        aiText += `\n\n> ⚠️ 注意：上一次的 ${p3Result.hadPendingOps} 项待执行修改已被本次新操作替换。`;
        if (contentEl) contentEl.innerHTML = formatMessageContent(aiText);
      }

      // 渲染 diff panel
      if (p3Result.enrichedOps && p3Result.enrichedOps.length > 0) {
        _renderPlanPanel(p3StreamMsgEl, p3Result.enrichedOps);
      }

      // 有 enrichedOps 时通过 diff panel 控制
      updateExecuteButtonState(p3Result.hasPendingOps && !p3Result.enrichedOps?.length ? 'p3_pending' : 'p3_idle');

    } else {
      aiText = '当前阶段不支持对话操作。请等待自动生成完成，或重置世界卡。';
    }

    loadingEl.remove();

    const aiIndex = chatHistory.length;
    const aiMessage =
      currentPhase === 'p1'
        ? typeof buildDesignP1AiMessage === 'function'
          ? buildDesignP1AiMessage(
            { ...(p1Result || {}), text: aiText },
            designModelLabel,
            designProviderKey
          )
          : {
            sender: 'ai',
            text: aiText,
            modelLabel: designModelLabel,
            providerKey: designProviderKey || undefined,
          }
        : {
          sender: 'ai',
          text: aiText,
          modelLabel: designModelLabel,
          providerKey: designProviderKey || undefined,
        };
    // 标记框架就绪消息，用于历史恢复
    if (currentPhase === 'p1' && p1Result?.frameworkReady) {
      aiMessage.frameworkReady = true;
    }
    // P3 diff panel 标记（用于历史恢复时显示过期提示 D9）
    if (currentPhase === 'p3' && typeof p3Result !== 'undefined' && p3Result?.enrichedOps?.length > 0) {
      aiMessage._hasP3DiffPanel = true;
    }
    chatHistory.push(aiMessage);

    // P3: 更新流式消息元素的 index
    if (currentPhase === 'p3' && p3StreamMsgEl) {
      p3StreamMsgEl.dataset.originalIndex = aiIndex;
    }

    // P3 已在流式阶段创建了消息元素，跳过重复创建
    if (currentPhase !== 'p3') {
      const aiMsgEl = document.createElement('div');
      aiMsgEl.className = 'chat-message ai-message design-mode-msg';
      aiMsgEl.dataset.originalIndex = aiIndex;
      aiMsgEl.innerHTML = `
              <div class="chat-user-label">${designAssistantLabel}</div>
              <div class="chat-message-content">${formatMessageContent(aiText)}</div>
          `;
      applyAiProviderDataset(aiMsgEl, designProviderKey);
      chatMessagesArea.appendChild(aiMsgEl);
      if (currentPhase === 'p1') {
        renderDesignP1PanelIntoMessage(aiMsgEl, aiMessage);
        // 框架就绪时渲染内嵌预览卡片
        if (p1Result?.frameworkReady) {
          // 禁用之前的框架预览（只有最新可交互）
          chatMessagesArea.querySelectorAll('.design-p1-framework-preview:not(.is-disabled)').forEach(el => {
            el.classList.add('is-disabled');
            el.querySelectorAll('button, textarea, input').forEach(ctrl => { ctrl.disabled = true; });
          });
          renderDesignP1FrameworkPreview(aiMsgEl, true);
        }
        _designP1SubmitRetryContext = null;
      }
    }
    setTimeout(enhanceMessages, 10);
  } catch (error) {
    console.error('[DesignMode] Error:', error);
    loadingEl.remove();

    // P3: 清理已创建的流式消息元素，避免残留空白/半成品消息
    if (p3StreamMsgEl && p3StreamMsgEl.parentNode) {
      p3StreamMsgEl.remove();
      p3StreamMsgEl = null;
    }

    if (error && error.code === 'P2_ABORTED') {
      return;
    }

    // 用户主动取消（P1/P3）
    if (error && error.name === 'AbortError') {
      return;
    }

    const translated = _translateDesignErrorForUser(error);
    const contextInfo = `${translated.providerInfo}${translated.statusInfo}`.trim();
    const translatedText = contextInfo
      ? `⚠️ 设计助手出错 ${contextInfo}: ${translated.detail}`
      : `⚠️ 设计助手出错: ${translated.detail}`;
    const {
      errorInfo: dsErrInfo,
      traceId: dsTraceId,
      failedPhase: dsFailedPhase,
    } = _extractAIFailureMeta(error);

    // 错误不再写入 chatHistory，也不在聊天区渲染气泡——改用 toast 轻量提示。
    // 原因：错误消息进入历史会污染下一次 AI 调用的上下文（_formatMessages 不过滤
    // isError），导致 retry 时 AI 看到错误描述继续报错（`test` 卡 API Key 案例）。
    if (typeof showToast === 'function') {
      showToast(translatedText, 'error', 6000);
    }
    console.warn('[DesignMode][AI Error]', {
      detail: translated.detail,
      provider: designProviderKey,
      phase: dsFailedPhase || currentPhase,
      traceId: dsTraceId,
      errorInfo: dsErrInfo,
    });
    // 把世界卡 AI 错误送进 eventBus，让 Analytics 拿到结构化字段（phase/model/provider）
    // 便于后续从遥测直接分析失败模式，不必每次再做 chat 导出。
    if (window.eventBus && window.GameEvents?.AI_ERROR) {
      window.eventBus.emit(window.GameEvents.AI_ERROR, {
        error,
        errorInfo: dsErrInfo,
        traceId: dsTraceId,
        failedPhase: dsFailedPhase || currentPhase || null,
        model: window.aiService?.lastDesignPayload?.model || designModelLabel || null,
        provider: designProviderKey || null,
      });
    }
  } finally {
    setSendBtnCancelMode(false); // 安全网：确保按钮恢复
    isSending = false;
    if (window.designService) {
      designService._fullSave(chatHistory);
    }
  }
}

/**
 * 世界卡 - Phase 2 自动生成管线
 * 串行执行5阶段：世界设定 → 规则系统 → 角色数据库 → 时间线 → 角色时间线
 * 由 Phase 1 完成后自动触发，或手动触发
 */
function summarizeDesignPhase2RequestForConsole(snapshot) {
  const payload = snapshot?.payload;
  let payloadBytes = 0;
  try {
    payloadBytes = payload ? JSON.stringify(payload).length : 0;
  } catch (_e) {
    payloadBytes = 0;
  }
  const messageCount = Array.isArray(payload?.messages)
    ? payload.messages.length
    : Array.isArray(payload?.contents)
      ? payload.contents.length
      : 0;
  const model =
    typeof payload?.model === 'string'
      ? payload.model
      : typeof payload?.model_id === 'string'
        ? payload.model_id
        : '';
  const url =
    typeof snapshot?.url === 'string' && snapshot.url
      ? snapshot.url.replace(/([?&](?:key|api_key|token|access_token)=)[^&]*/gi, '$1***')
      : '';

  return {
    provider: snapshot?.provider || '',
    model,
    url,
    messageCount,
    payloadBytes,
  };
}

function logDesignPhase2FailureOverview(error) {
  const snapshot = window.aiService?.lastDesignPayload || null;
  const requestSummary = summarizeDesignPhase2RequestForConsole(snapshot);
  const state = window.designService
    ? {
      phase: window.designService.phase,
      p2Stage: window.designService.p2Stage,
      isAutoGenerating: window.designService.isAutoGenerating,
    }
    : null;
  const errorInfo = {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: typeof error?.stack === 'string' ? error.stack : '',
  };

  console.groupCollapsed(`[DesignMode][P2][总览] 自动生成中断: ${errorInfo.message}`);
  console.log('phase:', 'p2');
  console.log('requestSummary:', {
    provider: requestSummary.provider || 'unknown',
    model: requestSummary.model || 'unknown',
    url: requestSummary.url || 'unknown',
    messageCount: requestSummary.messageCount,
    payloadBytes: requestSummary.payloadBytes,
  });
  console.log('state:', state);
  console.log('error:', errorInfo);
  console.groupEnd();
}

/**
 * 将 Phase 2 错误翻译为用户友好的中文消息
 */
function _translateDesignErrorForUser(error) {
  const safeError = error || {};
  const rawMessage =
    typeof safeError.message === 'string' ? safeError.message : String(safeError || '未知错误');
  const rawMessageLower = rawMessage.toLowerCase();
  const safeErrorInfo = safeError.errorInfo || safeError.unifiedErrorInfo || {};

  const df = safeError.designFailure;
  const stageLabel = df ? `第${df.stageIndex}阶段「${df.stageName}」` : '';

  const httpStatus = df?.httpStatus || safeError.apiErrorInfo?.httpStatus;
  let friendlyMsg = null;

  // 世界卡缺少 API Key（结构化错误）
  if (safeError.code === 'DESIGN_API_KEY_MISSING') {
    friendlyMsg = '世界卡 API Key 未设置，请先在设置中填写并保存后重试。';
  }

  if (
    !friendlyMsg &&
    (safeError.code === 'DESIGN_VALIDATION_FAILED' || safeErrorInfo.errorType === 'validation')
  ) {
    friendlyMsg = rawMessage;
  }

  // 世界卡缺少 API Key（Gemini 常见原始错误兜底）
  if (
    !friendlyMsg &&
    (rawMessageLower.includes('unregistered callers') ||
      rawMessageLower.includes('please use api key') ||
      rawMessageLower.includes('api key not valid'))
  ) {
    friendlyMsg = '世界卡 API Key 未设置，请先在设置中填写并保存后重试。';
  }

  // 匹配常见网络错误
  if (
    !friendlyMsg &&
    (rawMessage.includes('Load failed') || rawMessage.includes('Failed to fetch'))
  ) {
    friendlyMsg = '网络连接失败，请检查网络连接或代理设置';
  } else if (!friendlyMsg && rawMessage.includes('NetworkError')) {
    friendlyMsg = '网络错误，请检查网络连接';
  }

  // 匹配 HTTP 状态码
  if (!friendlyMsg && httpStatus) {
    if (httpStatus === 429) {
      friendlyMsg = 'API 调用频率超限，请稍后重试或更换 API Key';
    } else if (httpStatus === 401 || httpStatus === 403) {
      friendlyMsg = 'API 认证失败，请检查 API Key 是否正确';
    } else if (httpStatus === 400) {
      friendlyMsg = 'API 请求参数错误，请检查模型配置';
    } else if (httpStatus === 404) {
      friendlyMsg = '模型或 API 地址不存在，请检查模型名称和 Base URL';
    } else if (httpStatus >= 500) {
      friendlyMsg = 'API 服务端错误，请稍后重试';
    }
  }

  // 匹配超时
  if (!friendlyMsg && rawMessage.includes('超时')) {
    friendlyMsg = '请求超时，可能是网络过慢或提示词过长';
  }

  // 匹配 JSON 解析失败
  if (!friendlyMsg && (rawMessage.includes('JSON 解析失败') || rawMessage.includes('遇到错误'))) {
    friendlyMsg = 'AI 输出格式异常，请重试';
  }

  const detail = friendlyMsg || rawMessage;
  const provider = df?.provider || safeError.designErrorInfo?.provider || '';
  const providerInfo = provider ? ` [${provider}]` : '';
  const statusInfo = httpStatus ? ` (HTTP ${httpStatus})` : '';

  return {
    stageLabel,
    detail,
    providerInfo,
    statusInfo,
    hasStage: !!df,
  };
}

async function handleDesignModePhase2() {
  if (isSending) return false;
  isSending = true;
  updateExecuteButtonState('p2_running');

  const stageNames =
    (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en'
      ? ['World Setting', 'Rules', 'Character Database', 'Timeline', 'Character Timelines']
      : ['世界设定', '规则系统', '角色数据库', '时间线', '角色时间线'];
  const initialStage =
    normalizePhase2Stage(
      typeof window.designService?.getPhase2StartStage === 'function'
        ? window.designService.getPhase2StartStage()
        : window.designService?.p2Stage
    ) || 1;
  const designProviderKey = resolveDesignProviderKey();
  const designModelLabel = resolveDesignModelLabel();
  const designAssistantLabel = escapeHTML(formatDesignAssistantLabel(designModelLabel));

  // 显示起始系统消息
  const startText = '开始自动生成世界（Phase 2）...';
  const startIndex = chatHistory.length;
  const startMessage = { sender: 'ai', text: startText, modelLabel: designModelLabel };
  if (designProviderKey) {
    startMessage.providerKey = designProviderKey;
  }
  chatHistory.push(startMessage);

  const sysMsgEl = document.createElement('div');
  sysMsgEl.className = 'chat-message ai-message design-mode-msg';
  sysMsgEl.dataset.originalIndex = startIndex;
  sysMsgEl.innerHTML = `
        <div class="chat-user-label">${designAssistantLabel}</div>
        <div class="chat-message-content">${startText}</div>
    `;
  applyAiProviderDataset(sysMsgEl, designProviderKey);
  chatMessagesArea.appendChild(sysMsgEl);
  setTimeout(enhanceMessages, 10);

  // 进度加载指示器
  const loadingEl = document.createElement('div');
  loadingEl.className = 'chat-message ai-message design-mode-msg design-loading';
  loadingEl.innerHTML = `
        <div class="chat-user-label">${designAssistantLabel}</div>
        <div class="chat-message-content">
            <div class="design-thinking-indicator">
                <span class="design-dot"></span><span class="design-dot"></span><span class="design-dot"></span>
            </div>
            <div class="design-auto-progress">正在生成: ${stageNames[initialStage - 1]}（${initialStage}/4）</div>
            <div class="design-auto-progress">生成完整世界卡的时间大约在 5-15 分钟（取决于使用的模型），建议使用顶级模型，或启用「推荐设置」以保证世界卡质量。</div>
            <div class="design-stream-preview"></div>
        </div>
    `;
  applyAiProviderDataset(loadingEl, designProviderKey);
  chatMessagesArea.appendChild(loadingEl);

  const previewEl = loadingEl.querySelector('.design-stream-preview');
  let latestPreviewText = '';
  let rafId = null;
  let previewMounted = true;

  const flushPreview = () => {
    rafId = null;
    if (!previewMounted || !previewEl) return;
    previewEl.textContent = latestPreviewText;
    previewEl.scrollTop = previewEl.scrollHeight;
  };

  const schedulePreviewFlush = () => {
    if (!previewMounted || !previewEl) return;
    if (rafId !== null) return;
    rafId = requestAnimationFrame(flushPreview);
  };

  const clearPreview = () => {
    latestPreviewText = '';
    if (!previewEl) return;
    previewEl.textContent = '';
    previewEl.scrollTop = 0;
  };

  const cleanupPreview = () => {
    previewMounted = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  try {
    const pipelineResult = await designService.runPhase2Pipeline(
      ({ text, stageName, stageIndex, isLast }) => {
        const aiIndex = chatHistory.length;
        const stageMessage = {
          sender: 'ai',
          text,
          modelLabel: designModelLabel,
          stageName,
          stageIndex,
        };
        if (designProviderKey) {
          stageMessage.providerKey = designProviderKey;
        }
        chatHistory.push(stageMessage);

        const aiMsgEl = document.createElement('div');
        aiMsgEl.className = 'chat-message ai-message design-mode-msg';
        aiMsgEl.dataset.originalIndex = aiIndex;
        const stageLabel = escapeHTML(formatDesignAssistantLabel(designModelLabel, stageName));
        aiMsgEl.innerHTML = `
                <div class="chat-user-label">${stageLabel}</div>
                <div class="chat-message-content">${formatMessageContent(text)}</div>
            `;
        applyAiProviderDataset(aiMsgEl, designProviderKey);
        if (loadingEl.parentNode === chatMessagesArea) {
          chatMessagesArea.insertBefore(aiMsgEl, loadingEl);
        } else {
          chatMessagesArea.appendChild(aiMsgEl);
        }
        setTimeout(enhanceMessages, 10);

        clearPreview();

        if (!isLast) {
          const progressEl = loadingEl.querySelector('.design-auto-progress');
          if (progressEl) {
            const nextStep = stageIndex + 1;
            progressEl.textContent = `正在生成: ${stageNames[nextStep - 1]}（${nextStep}/4）`;
          }
        }
        if (window.designService) {
          designService._fullSave(chatHistory);
        }
      },
      (chunkText, _stageIndex) => {
        if (!previewMounted || !previewEl) return;
        latestPreviewText = typeof chunkText === 'string' ? chunkText : String(chunkText || '');
        schedulePreviewFlush();
      },
      progressText => {
        const progressEl = loadingEl.querySelector('.design-auto-progress');
        if (progressEl) progressEl.textContent = progressText;
        // 质量检测/AI质量修正阶段不使用流式输出，隐藏流式预览框，显示进度条
        const isNonStreamingStage = typeof progressText === 'string' &&
          (progressText.includes('质量检测') || progressText.includes('质量修正') ||
            progressText.includes('quality') || progressText.includes('inspection'));
        const streamPreview = loadingEl.querySelector('.design-stream-preview');
        if (streamPreview) streamPreview.style.display = isNonStreamingStage ? 'none' : '';
        // 非流式阶段：JS 驱动的渐近进度条
        const contentEl = loadingEl.querySelector('.chat-message-content');
        let progressBar = loadingEl.querySelector('.design-inspection-progress');
        if (isNonStreamingStage && !progressBar && contentEl) {
          progressBar = document.createElement('div');
          progressBar.className = 'design-inspection-progress';
          progressBar.innerHTML = '<div class="design-inspection-progress-bar"></div>';
          contentEl.appendChild(progressBar);
          const barEl = progressBar.querySelector('.design-inspection-progress-bar');
          const startTime = Date.now();

          // 强制完成逻辑 (供 Pipeline 结束时调用)
          loadingEl._forceCompleteProgressBar = () => {
            if (loadingEl._inspectionTimer) {
              clearInterval(loadingEl._inspectionTimer);
              loadingEl._inspectionTimer = null;
            }
            if (barEl) barEl.style.width = '100%';
            if (progressEl) progressEl.textContent = '完成！';
          };

          // 渐近曲线：快速到 80%，然后指数减速，永远到不了 100%
          const tick = () => {
            const elapsed = (Date.now() - startTime) / 1000;
            // 曲线：1 - e^(-t/k)，k=25 约 40s 到 80%
            const pct = Math.min(99, 99 * (1 - Math.exp(-elapsed / 25)));
            if (barEl) barEl.style.width = pct.toFixed(1) + '%';
            // 超时文案安抚
            if (progressEl) {
              if (elapsed > 60) {
                progressEl.textContent = '修正细节较多，AI 正在做最后的精雕细琢…要不想想今晚吃什么？';
              } else if (elapsed > 30) {
                progressEl.textContent = '正在进行 AI 深度修正…';
              }
            }
          };
          loadingEl._inspectionTimer = setInterval(tick, 500);
          tick();
        } else if (!isNonStreamingStage && progressBar) {
          if (loadingEl._inspectionTimer) {
            clearInterval(loadingEl._inspectionTimer);
            loadingEl._inspectionTimer = null;
          }
          progressBar.remove();
        }
      },
      messageData => {
        const msgIndex = chatHistory.length;
        chatHistory.push(messageData);
        const msgEl = document.createElement('div');
        msgEl.className = 'chat-message ai-message design-mode-msg';
        msgEl.dataset.originalIndex = msgIndex;
        msgEl.innerHTML = `
        <div class="chat-user-label">${designAssistantLabel}</div>
        <div class="chat-message-content">${formatMessageContent(messageData.text)}</div>
      `;
        applyAiProviderDataset(msgEl, designProviderKey);
        if (loadingEl.parentNode === chatMessagesArea) {
          chatMessagesArea.insertBefore(msgEl, loadingEl);
        } else {
          chatMessagesArea.appendChild(msgEl);
        }
        if (messageData?.consistencyFindings) {
          renderConsistencyFindingButtons(msgEl, messageData.consistencyFindings);
        }
        if (messageData?.inspectionFindings) {
          renderInspectionFindingButtons(msgEl, messageData.inspectionFindings);
        }
        setTimeout(enhanceMessages, 10);
      }
    );

    // 卡牌审阅暂停：当前 stage 注册了 review adapter 时停下，让用户在 chat 气泡里审阅。
    if (pipelineResult && pipelineResult.paused) {
      cleanupPreview();
      loadingEl.remove();
      const pausedStage = pipelineResult.reviewStage;
      const adapter =
        window.getReviewAdapter && window.getReviewAdapter(pausedStage);
      const reviewText = adapter
        ? adapter.buildPausedChatMessage(designService.designConfig)
        : `第 ${pausedStage} 阶段已完成，请审阅后继续。`;
      const reviewEl = document.createElement('div');
      reviewEl.className = 'chat-message ai-message design-mode-msg';
      const reviewIndex = chatHistory.length;
      reviewEl.dataset.originalIndex = reviewIndex;
      reviewEl.innerHTML = `
        <div class="chat-user-label">${designAssistantLabel}</div>
        <div class="chat-message-content">${formatMessageContent(reviewText)}</div>
      `;
      applyAiProviderDataset(reviewEl, designProviderKey);
      chatMessagesArea.appendChild(reviewEl);
      const reviewMessage = {
        sender: 'ai',
        text: reviewText,
        modelLabel: designModelLabel,
        _isReviewPanelMessage: true,
        _reviewStage: pausedStage,
      };
      if (designProviderKey) reviewMessage.providerKey = designProviderKey;
      chatHistory.push(reviewMessage);
      setTimeout(enhanceMessages, 10);
      // 把卡组挂到这条 AI 消息气泡下方
      try {
        if (typeof designService.renderStageReviewPanel === 'function') {
          designService.renderStageReviewPanel(pausedStage, reviewEl);
        } else if (typeof designService.renderCharacterReviewPanel === 'function') {
          designService.renderCharacterReviewPanel(reviewEl); // legacy fallback
        }
      } catch (panelErr) {
        console.warn('[DesignMode] renderStageReviewPanel failed:', panelErr);
      }
      if (window.designService) {
        designService._fullSave(chatHistory);
      }
      updateExecuteButtonState('p2_retry');
      isSending = false;
      return true;
    }

    // Phase 2 完成，进入 Phase 3
    if (typeof loadingEl._forceCompleteProgressBar === 'function') {
      loadingEl._forceCompleteProgressBar();
    }
    cleanupPreview();
    // 延迟移除加载态，让用户看到 100%
    await new Promise(resolve => setTimeout(resolve, 800));
    loadingEl.remove();
    const doneText = `**✓ 世界构建完成，进入完善模式**\n\n你可以在右侧预览面板【移动端在左上角的世界卡按键】查看所有生成内容。\n\n现在你可以：\n- 点击卡片式预览中某一项的「完善」按键，会自动填入对应条目的定向编辑前缀，补充你的修改要求后发送即可\n- 也可以直接描述修改，我会自动识别目标\n- 描述修改后，点击${getChatInlineExecuteActionHtml()}确认应用\n- 点击${getChatInlineApplyActionHtml()}完成设计\n\n当然，你也可以点击${getChatInlineAutoReviewActionHtml()}让 AI 帮你审查整张世界卡，先给你点建议。`; // ui-lint-allow
    const doneEl = document.createElement('div');
    doneEl.className = 'chat-message ai-message design-mode-msg';
    const doneIndex = chatHistory.length;
    doneEl.dataset.originalIndex = doneIndex;
    doneEl.innerHTML = `
            <div class="chat-user-label">${designAssistantLabel}</div>
            <div class="chat-message-content">${formatMessageContent(doneText)}</div>
        `;
    applyAiProviderDataset(doneEl, designProviderKey);
    chatMessagesArea.appendChild(doneEl);
    const doneMessage = { sender: 'ai', text: doneText, modelLabel: designModelLabel };
    if (designProviderKey) {
      doneMessage.providerKey = designProviderKey;
    }
    chatHistory.push(doneMessage);
    setTimeout(enhanceMessages, 10);
    // Phase 2 完成，按键恢复为 P3 可用态
    updateExecuteButtonState('p3_idle');
  } catch (error) {
    if (error && error.code === 'P2_ABORTED') {
      console.info('[DesignMode] Phase2 aborted:', error.message || error);
      cleanupPreview();
      loadingEl.remove();
      // 本次调用被新的 Phase2 run 抢占而中止：清掉它推入的「开始自动生成世界（Phase 2）...」
      // 占位消息，否则它会被 _fullSave 焊进世界卡，每次进设计模式 replay 一摞裸占位。
      // 仅当占位仍是 chatHistory 末元素（顺序 abort 的主场景）时移除，避免抢占 run
      // 已在其后追加内容时错位 originalIndex。
      const abortedStartIdx = chatHistory.lastIndexOf(startMessage);
      if (abortedStartIdx !== -1 && abortedStartIdx === chatHistory.length - 1) {
        chatHistory.splice(abortedStartIdx, 1);
        if (sysMsgEl && sysMsgEl.parentNode) {
          sysMsgEl.remove();
        }
      }
      if (
        window.designService &&
        window.designService.phase === 'p2' &&
        !window.designService.isAutoGenerating
      ) {
        updateExecuteButtonState('p2_retry');
      }
      return true;
    }
    console.error('[DesignMode] Phase2 error:', error);
    logDesignPhase2FailureOverview(error);
    cleanupPreview();
    loadingEl.remove();
    const translated = _translateDesignErrorForUser(error);
    const stagePrefix = translated.hasStage ? `${translated.stageLabel}` : '生成过程';
    const errText = `**${stagePrefix}中断**${translated.providerInfo}${translated.statusInfo}\n\n${translated.detail}\n\n你可以点击右下角的 ${CHAT_INLINE_RETRY_ICON_ACTION_HTML} 再试一次。`;
    const {
      errorInfo: p2ErrInfo,
      traceId: p2TraceId,
      failedPhase: p2FailedPhase,
    } = _extractAIFailureMeta(error);
    const errMessage = {
      sender: 'ai',
      text: errText,
      modelLabel: designModelLabel,
      isError: true,
      errorMeta: { error, errorInfo: p2ErrInfo, traceId: p2TraceId, failedPhase: p2FailedPhase },
    };
    if (designProviderKey) {
      errMessage.providerKey = designProviderKey;
    }
    const errIndex = chatHistory.length;
    chatHistory.push(errMessage);
    const errEl = document.createElement('div');
    errEl.className = 'chat-message ai-message design-mode-msg';
    errEl.dataset.originalIndex = errIndex;
    const retryHint = `<p>${formatMessageContent(`你可以点击右下角的 ${CHAT_INLINE_RETRY_ICON_ACTION_HTML} 再试一次。`)}</p>`;
    errEl.innerHTML = `
            <div class="chat-user-label">${designAssistantLabel}</div>
            <div class="chat-message-content">${_renderErrorBannerHTML(error)}${retryHint}</div>
        `;
    applyAiProviderDataset(errEl, designProviderKey);
    chatMessagesArea.appendChild(errEl);
    setTimeout(enhanceMessages, 10);
    // Phase 2 失败，按键恢复可点击（让用户可重试）
    updateExecuteButtonState('p2_retry');
  } finally {
    if (loadingEl && loadingEl._inspectionTimer) {
      clearInterval(loadingEl._inspectionTimer);
    }
    cleanupPreview();
    isSending = false;
    if (window.designService) {
      try {
        designService._fullSave(chatHistory);
      } catch (saveErr) {
        console.warn('[DesignMode] full save failed in finally:', saveErr);
      }
    }
  }
  return true;
}

// ============================================
// 渲染辅助函数
// ============================================

// renderProcessBar / handleReactComplete — 已移除（ai-process-bar 不再显示）

// 增强消息显示
function enhanceMessages() {
  const messages = document.querySelectorAll('.chat-message');
  messages.forEach(msg => {
    // 跳过正在流式输出的气泡(由 streamVisualizer 管理)
    if (msg.classList.contains('streaming-state')) {
      return;
    }

    // 使用 data-original-index 作为消息索引(支持折叠模式)
    const originalIndex = msg.dataset.originalIndex;
    if (originalIndex === undefined) return;
    const normalizedIndex = _normalizeMessageIndex(originalIndex);
    if (!Number.isInteger(normalizedIndex)) return;

    const expectedActionsHtml = renderMessageActionsHtml(normalizedIndex);

    // 添加底部栏，或同步底部栏中的按键状态
    let footerEl = msg.querySelector('.message-footer');
    if (!footerEl) {
      const contentEl = msg.querySelector('.chat-message-content');
      if (!contentEl) return;
      const footerHtml = `
                    <div class="message-footer">
                        <div class="metrics-placeholder"></div>
                        ${expectedActionsHtml}
                    </div>
                `;
      contentEl.insertAdjacentHTML('afterend', footerHtml);
      footerEl = msg.querySelector('.message-footer');
    } else {
      const existingActionsEl = footerEl.querySelector('.message-actions');
      if (expectedActionsHtml) {
        if (existingActionsEl) {
          existingActionsEl.dataset.msgIndex = String(normalizedIndex);
        } else {
          footerEl.insertAdjacentHTML('beforeend', expectedActionsHtml);
        }
      } else if (existingActionsEl) {
        existingActionsEl.remove();
      }
    }
  });

  bindMessageActionEvents();
}

// 绑定消息操作按键事件
function bindMessageActionEvents() {
  const bindButton = (selector, handler) => {
    document.querySelectorAll(selector).forEach(btn => {
      if (btn._eventBound) return;
      btn._eventBound = true;
      btn.addEventListener('click', e => {
        e.stopPropagation();
        // 使用 chatActions.js 中定义的 getMessageIndex
        const msgIndex = typeof getMessageIndex === 'function' ? getMessageIndex(btn) : -1;
        if (!Number.isInteger(msgIndex) || msgIndex < 0) return;
        const policy =
          typeof resolveMessageActionPolicy === 'function'
            ? resolveMessageActionPolicy(msgIndex)
            : { showActions: true };
        if (!policy.showActions) return;
        handler(msgIndex);
      });
    });
  };

  if (typeof copyMessage !== 'undefined') bindButton('.copy-action', copyMessage);
  if (typeof regenerateMessage !== 'undefined') bindButton('.regenerate-action', regenerateMessage);
  if (typeof deleteMessage !== 'undefined') bindButton('.delete-action', deleteMessage);
  if (typeof editMessage !== 'undefined') bindButton('.edit-action', editMessage);
}
window.bindMessageActionEvents = bindMessageActionEvents;

// 格式化消息内容
function formatMessageContent(text, uid = null) {
  if (typeof jsonRenderer !== 'undefined') {
    text = jsonRenderer.process(text, uid);
  }

  return window.htmlSecurity
    ? window.htmlSecurity.markdownToSafeHtml(text)
    : escapeHTML(text).replace(/\n/g, '<br>');
}
window.formatMessageContent = formatMessageContent;

let _designP1PanelEventsBound = false;
const DESIGN_P1_SKIP_ANSWER_TEXT = '跳过（请按保守默认值继续）';
const DESIGN_P1_CUSTOM_TEXT_MAX_LEN = 10000;
const DESIGN_P1_OPTION_TEXT_MAX_LEN = 140;
const DESIGN_P1_FLOW_SAVE_DEBOUNCE_MS = 200;
const DESIGN_P1_BUSY_TOAST_COOLDOWN_MS = 1200;
let _designP1FlowPersistTimer = null;
let _designP1FlowPersistPending = false;
let _designP1LifecycleEventsBound = false;
let _designP1LastBusyToastAt = 0;
let _designP1LastTruncToastAt = 0;

function _truncateTextForDesignPrompt(text, maxLen = 400) {
  const source = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!source) return '';
  if (source.length <= maxLen) return source;
  return `${source.slice(0, maxLen)}…`;
}

function _escapeDesignAttr(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _escapeDesignInputValue(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

let _designP1SubmitRetryContext = null;

function _showDesignP1BusyToastOnce(message = '请等待 AI 回复完成') {
  const now = Date.now();
  if (now - _designP1LastBusyToastAt < DESIGN_P1_BUSY_TOAST_COOLDOWN_MS) return;
  _designP1LastBusyToastAt = now;
  showToast(message);
}

function _buildFallbackDesignP1Options(target = '') {
  const normalizedTarget = typeof target === 'string' ? target.trim() : '';
  const byTarget = {
    context_world: ['我先补世界类型和关键地点', '我先补主要势力关系', '你先按保守默认值补世界设定'],
    context_rules: ['我先补核心玩法方向', '我先补经济和战斗规则', '你先按保守默认值补规则系统'],
    context_chars: ['我先补关键角色设定', '我先补角色关系网络', '你先按保守默认值补角色概念'],
    context_timeline: ['我先补关键历史事件', '我先补当前局势和钩子', '你先按保守默认值补时间线'],
    style_guide: ['我先补叙事风格和语气', '我先补内容尺度和禁区', '你先按保守默认值补风格基调'],
    _mode: ['🚀 快速模式 — 聚焦角色和故事风格，世界规则由我自动补全', '🔧 深度定制 — 从世界观、规则、势力、时间线到角色全面定制'],
    _upgrade: ['直接开始生成', '切换到深度定制'],
  };
  const defaults = ['我先补一个明确方向', '你先给我一个推荐方向', '你先按保守默认值继续'];
  const source = byTarget[normalizedTarget] || defaults;
  return source.slice(0, 3).map((text, idx) => ({
    id: String.fromCharCode(97 + idx),
    text,
  }));
}

function _normalizeDesignP1Options(options, target = '') {
  const list = Array.isArray(options) ? options : [];
  const normalized = [];
  const seen = new Set();

  for (const item of list) {
    const text =
      typeof item === 'string'
        ? item.trim()
        : typeof item?.text === 'string'
          ? item.text.trim()
          : typeof item?.label === 'string'
            ? item.label.trim()
            : '';
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      id:
        typeof item?.id === 'string' && item.id.trim()
          ? item.id.trim()
          : String.fromCharCode(97 + normalized.length),
      text: text.slice(0, 120),
    });
    if (normalized.length >= 3) break;
  }

  // AI 提供了多少选项就用多少，不再强制填充 fallback
  return normalized.slice(0, 3).map((opt, idx) => ({ ...opt, id: String.fromCharCode(97 + idx) }));
}

function _normalizeDesignP1Questions(questions) {
  if (!Array.isArray(questions)) return [];
  const allowedTargets = new Set([
    'context_world',
    'context_rules',
    'context_chars',
    'context_timeline',
    'style_guide',
    '_mode',
    '_upgrade',
  ]);
  const normalized = [];
  const seen = new Set();
  for (const item of questions) {
    const text = typeof item?.text === 'string' ? item.text.trim() : '';
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const targetRaw = typeof item?.target === 'string' ? item.target.trim().toLowerCase() : '';
    const target = allowedTargets.has(targetRaw) ? targetRaw : '';
    normalized.push({
      id:
        typeof item?.id === 'string' && item.id.trim()
          ? item.id.trim()
          : `q${normalized.length + 1}`,
      text: text.slice(0, 220),
      target,
      required: item?.required !== false,
      options: _normalizeDesignP1Options(item?.options, target),
    });
    if (normalized.length >= 2) break;
  }
  if (Array.isArray(questions) && questions.length > 0 && normalized.length === 0) {
    normalized.push({
      id: 'q1',
      text: '如果你只想先定一个方向，你最想先定哪一块？',
      target: '',
      required: true,
      options: _buildFallbackDesignP1Options(''),
    });
  }
  return normalized.slice(0, 2).map((q, idx) => ({
    ...q,
    id: `q${idx + 1}`,
  }));
}

function _normalizeDesignP1AnswerSource(source) {
  const normalized = typeof source === 'string' ? source.trim().toLowerCase() : '';
  return normalized === 'option' || normalized === 'custom' || normalized === 'skip'
    ? normalized
    : '';
}

function _resolveDesignP1Answer(question, answerState) {
  if (!question || typeof question !== 'object') {
    return { valid: false, answerText: '', source: '', reason: 'question_invalid' };
  }
  const answer = answerState && typeof answerState === 'object' ? answerState : {};
  const source = _normalizeDesignP1AnswerSource(answer.answerSource);
  const skipped = answer.skipped === true || source === 'skip';
  if (skipped) {
    return { valid: true, answerText: DESIGN_P1_SKIP_ANSWER_TEXT, source: 'skip', reason: '' };
  }

  const options = Array.isArray(question.options) ? question.options : [];
  const selectedOptionId =
    typeof answer.selectedOptionId === 'string' && answer.selectedOptionId.trim()
      ? answer.selectedOptionId.trim()
      : typeof answer.optionId === 'string' && answer.optionId.trim()
        ? answer.optionId.trim()
        : '';
  const selectedOptionText =
    typeof answer.selectedOptionText === 'string' ? answer.selectedOptionText.trim() : '';
  const legacyAnswerText = typeof answer.answerText === 'string' ? answer.answerText.trim() : '';
  const customTextRaw = typeof answer.customText === 'string' ? answer.customText : '';
  const customText = customTextRaw.trim().slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN);

  let matchedOption = null;
  if (selectedOptionId) {
    matchedOption = options.find(opt => String(opt?.id || '').trim() === selectedOptionId) || null;
  }
  if (!matchedOption && selectedOptionText) {
    matchedOption =
      options.find(opt => String(opt?.text || '').trim() === selectedOptionText) || null;
  }
  if (!matchedOption && legacyAnswerText && legacyAnswerText !== DESIGN_P1_SKIP_ANSWER_TEXT) {
    matchedOption =
      options.find(opt => String(opt?.text || '').trim() === legacyAnswerText) || null;
  }
  const optionText = (
    matchedOption?.text ||
    selectedOptionText ||
    (source === 'option' ? legacyAnswerText : '')
  ).trim();

  if (source === 'custom') {
    if (!customText) {
      return { valid: false, answerText: '', source: 'custom', reason: 'custom_empty' };
    }
    return { valid: true, answerText: customText, source: 'custom', reason: '' };
  }

  if (source === 'option') {
    if (!optionText) {
      return { valid: false, answerText: '', source: 'option', reason: 'option_empty' };
    }
    return {
      valid: true,
      answerText: optionText.slice(0, DESIGN_P1_OPTION_TEXT_MAX_LEN),
      source: 'option',
      reason: '',
    };
  }

  // 兼容旧数据：没有 answerSource 时按已有字段推断
  if (!source && customText && optionText) {
    if (legacyAnswerText && legacyAnswerText === customText) {
      return {
        valid: true,
        answerText: customText,
        source: 'custom',
        reason: 'legacy_both_custom',
      };
    }
    if (legacyAnswerText && legacyAnswerText === optionText) {
      return {
        valid: true,
        answerText: optionText.slice(0, DESIGN_P1_OPTION_TEXT_MAX_LEN),
        source: 'option',
        reason: 'legacy_both_option',
      };
    }
    return {
      valid: true,
      answerText: customText,
      source: 'custom',
      reason: 'legacy_both_default_custom',
    };
  }
  if (customText && !optionText) {
    return { valid: true, answerText: customText, source: 'custom', reason: 'legacy_custom' };
  }
  if (optionText) {
    return {
      valid: true,
      answerText: optionText.slice(0, DESIGN_P1_OPTION_TEXT_MAX_LEN),
      source: 'option',
      reason: 'legacy_option',
    };
  }
  if (legacyAnswerText && legacyAnswerText !== DESIGN_P1_SKIP_ANSWER_TEXT) {
    return {
      valid: true,
      answerText: legacyAnswerText.slice(0, DESIGN_P1_OPTION_TEXT_MAX_LEN),
      source: 'option',
      reason: 'legacy_answer',
    };
  }

  return { valid: false, answerText: '', source: source || '', reason: 'missing' };
}

function _sanitizeDesignP1FlowState(flowState, questions) {
  const normalizedQuestions = _normalizeDesignP1Questions(questions);
  if (normalizedQuestions.length === 0) {
    return { cursor: 0, answers: [] };
  }

  const rawCursor = Number.isFinite(flowState?.cursor) ? Math.floor(flowState.cursor) : 0;
  const cursor = Math.min(Math.max(rawCursor, 0), normalizedQuestions.length - 1);
  const rawAnswers = Array.isArray(flowState?.answers) ? flowState.answers : [];
  const answers = [];
  const seen = new Set();

  for (const question of normalizedQuestions) {
    const matched = rawAnswers.find(
      item =>
        item &&
        typeof item.questionId === 'string' &&
        item.questionId.trim() &&
        item.questionId.trim().toLowerCase() === question.id.toLowerCase()
    );
    if (!matched) continue;
    const key = question.id.toLowerCase();
    if (seen.has(key)) continue;

    const selectedOptionId =
      typeof matched.selectedOptionId === 'string' && matched.selectedOptionId.trim()
        ? matched.selectedOptionId.trim().slice(0, 16)
        : typeof matched.optionId === 'string' && matched.optionId.trim()
          ? matched.optionId.trim().slice(0, 16)
          : '';
    let selectedOptionText =
      typeof matched.selectedOptionText === 'string'
        ? matched.selectedOptionText.trim().slice(0, 120)
        : '';
    let customText =
      typeof matched.customText === 'string'
        ? matched.customText.slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN)
        : '';
    const legacyAnswerText =
      typeof matched.answerText === 'string'
        ? matched.answerText.trim().slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN)
        : '';
    const customTextTrimmed = customText.trim();
    const hasOptionMeta = Boolean(selectedOptionId || selectedOptionText);
    const hasCustomMeta = Boolean(customTextTrimmed);
    let answerSource = _normalizeDesignP1AnswerSource(matched.answerSource);
    const skipped = matched.skipped === true || legacyAnswerText === DESIGN_P1_SKIP_ANSWER_TEXT;
    if (!answerSource) {
      if (skipped) answerSource = 'skip';
      else if (hasOptionMeta && hasCustomMeta) {
        if (legacyAnswerText && legacyAnswerText === customTextTrimmed) answerSource = 'custom';
        else if (
          legacyAnswerText &&
          selectedOptionText &&
          legacyAnswerText === selectedOptionText
        ) {
          answerSource = 'option';
        } else {
          answerSource = 'custom';
        }
      } else if (hasCustomMeta) answerSource = 'custom';
      else if (hasOptionMeta) answerSource = 'option';
      else if (legacyAnswerText) answerSource = 'option';
    }

    const candidate = {
      questionId: question.id,
      questionText: question.text,
      answerText: legacyAnswerText,
      skipped,
      optionId: selectedOptionId,
      answerSource,
      selectedOptionId,
      selectedOptionText,
      customText,
    };
    const resolved = _resolveDesignP1Answer(question, candidate);
    const normalizedSource = resolved.source || answerSource || (skipped ? 'skip' : '');
    if (normalizedSource === 'option' && !selectedOptionText && resolved.valid) {
      selectedOptionText = resolved.answerText;
    }
    if (normalizedSource === 'custom' && !customText && resolved.valid) {
      customText = resolved.answerText;
    }
    const answerText =
      normalizedSource === 'skip'
        ? DESIGN_P1_SKIP_ANSWER_TEXT
        : resolved.answerText || legacyAnswerText || '';
    const hasAnyAnswerState = Boolean(
      normalizedSource ||
      selectedOptionId ||
      selectedOptionText ||
      customText ||
      answerText ||
      skipped
    );
    if (!hasAnyAnswerState) continue;

    seen.add(key);
    answers.push({
      questionId: question.id,
      questionText: question.text,
      answerText: answerText.slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN),
      skipped: normalizedSource === 'skip',
      optionId: selectedOptionId,
      answerSource: normalizedSource,
      selectedOptionId,
      selectedOptionText: selectedOptionText.slice(0, 120),
      customText: customText.slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN),
    });
  }

  return { cursor, answers };
}

function _findDesignP1Answer(flowState, questionId) {
  if (!flowState || !Array.isArray(flowState.answers) || !questionId) return null;
  return (
    flowState.answers.find(
      item =>
        item &&
        typeof item.questionId === 'string' &&
        item.questionId.trim().toLowerCase() === String(questionId).trim().toLowerCase()
    ) || null
  );
}

function _upsertDesignP1Answer(flowState, payload) {
  const next = {
    cursor: Number.isFinite(flowState?.cursor) ? flowState.cursor : 0,
    answers: Array.isArray(flowState?.answers) ? [...flowState.answers] : [],
  };
  const idx = next.answers.findIndex(
    item =>
      item &&
      typeof item.questionId === 'string' &&
      item.questionId.trim().toLowerCase() ===
      String(payload?.questionId || '')
        .trim()
        .toLowerCase()
  );
  if (idx >= 0) {
    next.answers[idx] = payload;
  } else {
    next.answers.push(payload);
  }
  return next;
}

function _getLatestDesignAiMessageIndex() {
  if (!Array.isArray(chatHistory)) return -1;
  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const msg = chatHistory[i];
    if (msg?.sender === 'ai') return i;
  }
  return -1;
}

function _canUseDesignP1Panel(messageIndex) {
  if (!Number.isInteger(messageIndex) || messageIndex < 0) return false;
  if (!isDesignMode) return false;
  if (!window.designService || designService.phase !== 'p1') return false;
  return messageIndex === _getLatestDesignAiMessageIndex();
}

function _buildDesignP1RoundAnswerPayload(questions, flowState) {
  const normalizedQuestions = _normalizeDesignP1Questions(questions);
  const safeState = _sanitizeDesignP1FlowState(flowState, normalizedQuestions);
  const lines = ['【回答当前轮问题】'];
  normalizedQuestions.forEach((q, idx) => {
    const answer = _findDesignP1Answer(safeState, q.id);
    const resolved = _resolveDesignP1Answer(q, answer);
    const answerText = resolved.valid ? resolved.answerText : DESIGN_P1_SKIP_ANSWER_TEXT;
    lines.push(`Q${idx + 1}：${q.text}`);
    lines.push(`A${idx + 1}：${answerText}`);
  });
  return lines.join('\n');
}

function _buildDesignP1RoundAnswerDisplay(questions, flowState) {
  return _buildDesignP1RoundAnswerPayload(questions, flowState);
}

function _isDesignP1PackedAnswerText(text) {
  if (typeof text !== 'string') return false;
  const source = text.replace(/\r/g, '').trim();
  if (!source || !source.includes('【回答当前轮问题】')) return false;
  const hasQuestion = /(?:^|\n)\s*Q\s*\d+\s*[：:]/i.test(source);
  const hasAnswer = /(?:^|\n)\s*A\s*\d+\s*[：:]/i.test(source);
  return hasQuestion && hasAnswer;
}

function _parseDesignP1PackedAnswerText(text) {
  if (!_isDesignP1PackedAnswerText(text)) return null;
  const lines = String(text)
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/\u3000/g, ' ').trim())
    .filter(Boolean);
  const questionMap = new Map();
  const answerMap = new Map();

  lines.forEach(line => {
    const qMatch = line.match(/^Q\s*(\d+)\s*[：:]\s*(.*)$/i);
    if (qMatch) {
      const idx = Number.parseInt(qMatch[1], 10);
      if (Number.isFinite(idx) && idx > 0) {
        questionMap.set(idx, qMatch[2] || '');
      }
      return;
    }
    const aMatch = line.match(/^A\s*(\d+)\s*[：:]\s*(.*)$/i);
    if (!aMatch) return;
    const idx = Number.parseInt(aMatch[1], 10);
    if (!Number.isFinite(idx) || idx <= 0) return;
    answerMap.set(idx, aMatch[2] || '');
  });

  const indices = Array.from(
    new Set([...Array.from(questionMap.keys()), ...Array.from(answerMap.keys())])
  ).sort((a, b) => a - b);
  if (indices.length === 0) return null;

  const items = indices.map(index => ({
    index,
    question: questionMap.get(index) || '',
    answer: answerMap.get(index) || '',
  }));
  return {
    title: '回答当前轮问题',
    items,
  };
}

function _renderDesignP1PackedAnswerHtml(text) {
  const parsed = _parseDesignP1PackedAnswerText(text);
  if (!parsed || !Array.isArray(parsed.items) || parsed.items.length === 0) return '';
  const title = escapeHTML(parsed.title || '回答当前轮问题');
  const cardsHtml = parsed.items
    .map(item => {
      const index = Number.isFinite(item?.index) ? Math.max(1, item.index) : 1;
      const question = escapeHTML(item?.question || '（未提供）');
      const answer = escapeHTML(item?.answer || '（未提供）');
      return `
      <div class="design-p1-round-answer-card">
        <div class="design-p1-round-answer-card-title">第${index}题</div>
        <div class="design-p1-round-answer-row is-question">
          <span class="design-p1-round-answer-label">问题</span>
          <span class="design-p1-round-answer-value">${question}</span>
        </div>
        <div class="design-p1-round-answer-row is-answer">
          <span class="design-p1-round-answer-label">回答</span>
          <span class="design-p1-round-answer-value">${answer}</span>
        </div>
      </div>
    `;
    })
    .join('');
  return `
    <div class="design-p1-round-answer">
      <div class="design-p1-round-answer-title">${title}</div>
      ${cardsHtml}
    </div>
  `;
}

function _getDesignModeUserMessageSafeContent(text) {
  const source = typeof text === 'string' ? text : String(text ?? '');
  const cardHtml = _renderDesignP1PackedAnswerHtml(source);
  if (cardHtml) return cardHtml;
  return window.htmlSecurity
    ? window.htmlSecurity.plainTextToSafeHtml(source)
    : escapeHTML(source).replace(/\n/g, '<br>');
}

function _cancelDesignP1FlowPersistDebounce() {
  if (_designP1FlowPersistTimer) {
    clearTimeout(_designP1FlowPersistTimer);
    _designP1FlowPersistTimer = null;
  }
  _designP1FlowPersistPending = false;
}

function _flushDesignP1FlowPersistNow() {
  if (!_designP1FlowPersistPending && !_designP1FlowPersistTimer) return;
  if (_designP1FlowPersistTimer) {
    clearTimeout(_designP1FlowPersistTimer);
    _designP1FlowPersistTimer = null;
  }
  _designP1FlowPersistPending = false;
  if (window.designService) {
    designService._fullSave(chatHistory);
  }
}

function _stageDesignP1FlowState(messageIndex, questions, flowState) {
  const histMsg = chatHistory[messageIndex];
  if (!histMsg || histMsg.sender !== 'ai') return null;
  const safeState = _sanitizeDesignP1FlowState(flowState, questions);
  histMsg.p1FlowState = safeState;
  return safeState;
}

function _persistDesignP1FlowState(messageIndex, questions, flowState) {
  const safeState = _stageDesignP1FlowState(messageIndex, questions, flowState);
  if (!safeState) return null;
  _cancelDesignP1FlowPersistDebounce();
  _designP1FlowPersistPending = false;
  if (window.designService) {
    designService._fullSave(chatHistory);
  }
  return safeState;
}

function _persistDesignP1FlowStateDebounced(messageIndex, questions, flowState) {
  const safeState = _stageDesignP1FlowState(messageIndex, questions, flowState);
  if (!safeState) return null;
  if (_designP1FlowPersistTimer) {
    clearTimeout(_designP1FlowPersistTimer);
    _designP1FlowPersistTimer = null;
  }
  _designP1FlowPersistPending = true;
  _designP1FlowPersistTimer = setTimeout(() => {
    _designP1FlowPersistTimer = null;
    _designP1FlowPersistPending = false;
    if (window.designService) {
      designService._fullSave(chatHistory);
    }
  }, DESIGN_P1_FLOW_SAVE_DEBOUNCE_MS);
  return safeState;
}

function _getDesignP1PanelContextFromButton(buttonEl) {
  if (!buttonEl) return null;
  const msgEl = buttonEl.closest('.chat-message');
  const messageIndex = Number.parseInt(msgEl?.dataset?.originalIndex, 10);
  if (!_canUseDesignP1Panel(messageIndex)) {
    showToast('请使用最新问题卡片');
    return null;
  }
  const histMsg = chatHistory[messageIndex];
  const questions = _normalizeDesignP1Questions(histMsg?.p1Questions);
  if (questions.length === 0) {
    showToast('当前没有可回答的问题');
    return null;
  }
  const flowState = _sanitizeDesignP1FlowState(histMsg?.p1FlowState, questions);
  const cursor = Math.min(Math.max(flowState.cursor, 0), questions.length - 1);
  const question = questions[cursor];
  if (!question) {
    showToast('当前问题状态异常，请刷新后重试');
    return null;
  }
  return { msgEl, messageIndex, histMsg, questions, flowState, cursor, question };
}

function _rerenderDesignP1PanelByContext(context, flowState) {
  if (!context?.msgEl || !context?.histMsg) return;
  context.histMsg.p1FlowState = flowState;
  renderDesignP1PanelIntoMessage(context.msgEl, context.histMsg);
}

function _submitDesignP1RoundAnswers(context, flowState) {
  if (!chatInputTextbox) {
    showToast('输入框未就绪，请稍后重试');
    return;
  }
  _cancelDesignP1FlowPersistDebounce();
  const safeState =
    _persistDesignP1FlowState(context.messageIndex, context.questions, flowState) ||
    _sanitizeDesignP1FlowState(flowState, context.questions);
  const packedMessage = _buildDesignP1RoundAnswerPayload(context.questions, safeState);
  const displayMessage = _buildDesignP1RoundAnswerDisplay(context.questions, safeState);
  _designP1SubmitRetryContext = {
    questions: context.questions,
    flowState: safeState,
    questionGoal:
      typeof context.histMsg?.p1QuestionGoal === 'string' ? context.histMsg.p1QuestionGoal : '',
    thinkingPreview:
      typeof context.histMsg?.p1ThinkingPreview === 'string'
        ? context.histMsg.p1ThinkingPreview
        : '',
  };
  chatInputTextbox.value = packedMessage;
  if (typeof displayMessage === 'string') {
    chatInputTextbox.dataset.designP1Display = displayMessage;
  }
  autoResizeTextarea();
  Promise.resolve(handleSendMessage()).catch(error => {
    console.error('[DesignP1Flow] 提交失败:', error);
    showToast('发送失败，请重试');
    const restored = _persistDesignP1FlowState(context.messageIndex, context.questions, safeState);
    if (restored) {
      _rerenderDesignP1PanelByContext(context, restored);
    }
  });
}

function _handleDesignP1OptionClick(optionBtn) {
  if (isSending) {
    _showDesignP1BusyToastOnce();
    return;
  }
  const context = _getDesignP1PanelContextFromButton(optionBtn);
  if (!context) return;
  _cancelDesignP1FlowPersistDebounce();
  const optionText =
    typeof optionBtn.dataset.optionText === 'string' ? optionBtn.dataset.optionText.trim() : '';
  if (!optionText) {
    showToast('选项内容异常，请手动输入');
    return;
  }
  const optionId =
    typeof optionBtn.dataset.optionId === 'string'
      ? optionBtn.dataset.optionId.trim().slice(0, 16)
      : '';
  const prevAnswer = _findDesignP1Answer(context.flowState, context.question.id);
  const nextState = _upsertDesignP1Answer(context.flowState, {
    questionId: context.question.id,
    questionText: context.question.text,
    answerText: optionText.slice(0, DESIGN_P1_OPTION_TEXT_MAX_LEN),
    skipped: false,
    optionId,
    answerSource: 'option',
    selectedOptionId: optionId,
    selectedOptionText: optionText.slice(0, 120),
    customText:
      typeof prevAnswer?.customText === 'string'
        ? prevAnswer.customText.slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN)
        : '',
  });
  const savedState = _persistDesignP1FlowState(context.messageIndex, context.questions, nextState);
  if (savedState) {
    _rerenderDesignP1PanelByContext(context, savedState);
  }
}

function _handleDesignP1CustomInputChange(inputEl, persistMode = 'debounced') {
  const context = _getDesignP1PanelContextFromButton(inputEl);
  if (!context) return;
  if (isSending) {
    _showDesignP1BusyToastOnce();
    return;
  }
  const rawInput = typeof inputEl.value === 'string' ? inputEl.value : '';
  const limitedInput = rawInput.slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN);
  // 自动撑高 textarea
  if (inputEl.tagName === 'TEXTAREA') {
    inputEl.style.height = 'auto';
    inputEl.style.height = inputEl.scrollHeight + 'px';
  }
  if (rawInput !== limitedInput) {
    inputEl.value = limitedInput;
    const now = Date.now();
    if (now - _designP1LastTruncToastAt > 3000) {
      _designP1LastTruncToastAt = now;
      if (typeof showToast === 'function') {
        showToast('内容过长，已截断为10000字。如需更多内容，可点击左下角📎上传文档');
      }
    }
  }
  const prevAnswer = _findDesignP1Answer(context.flowState, context.question.id);
  const nextState = _upsertDesignP1Answer(context.flowState, {
    questionId: context.question.id,
    questionText: context.question.text,
    answerText: limitedInput.trim().slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN),
    skipped: false,
    optionId:
      typeof prevAnswer?.selectedOptionId === 'string' && prevAnswer.selectedOptionId.trim()
        ? prevAnswer.selectedOptionId.trim().slice(0, 16)
        : typeof prevAnswer?.optionId === 'string' && prevAnswer.optionId.trim()
          ? prevAnswer.optionId.trim().slice(0, 16)
          : '',
    answerSource: 'custom',
    selectedOptionId:
      typeof prevAnswer?.selectedOptionId === 'string'
        ? prevAnswer.selectedOptionId.trim().slice(0, 16)
        : '',
    selectedOptionText:
      typeof prevAnswer?.selectedOptionText === 'string'
        ? prevAnswer.selectedOptionText.trim().slice(0, 120)
        : '',
    customText: limitedInput,
  });
  const stagedState =
    persistMode === 'immediate'
      ? _persistDesignP1FlowState(context.messageIndex, context.questions, nextState)
      : _persistDesignP1FlowStateDebounced(context.messageIndex, context.questions, nextState);
  if (!stagedState) return;
  const panel = context.msgEl?.querySelector('.design-p1-panel');
  if (!panel) return;
  panel
    .querySelectorAll('[data-action~="design-p1-option-btn"].is-selected')
    .forEach(btn => btn.classList.remove('is-selected'));
  const customRow = panel.querySelector('.design-p1-custom-row');
  if (customRow) customRow.classList.add('is-selected');
}

function _handleDesignP1ContinueClick(continueBtn) {
  if (isSending) {
    _showDesignP1BusyToastOnce();
    return;
  }
  const context = _getDesignP1PanelContextFromButton(continueBtn);
  if (!context) return;

  const currentAnswer = _findDesignP1Answer(context.flowState, context.question.id);
  const resolved = _resolveDesignP1Answer(context.question, currentAnswer);
  if (!resolved.valid) {
    const hasOptions = Array.isArray(context.question?.options) && context.question.options.length > 0;
    showToast(hasOptions ? '请先选择一个选项，或输入你的想法，或点”跳过”' : '请输入你的想法，或点”跳过”');
    return;
  }

  const isLast = context.cursor >= context.questions.length - 1;
  if (!isLast) {
    const nextState = {
      cursor: context.cursor + 1,
      answers: Array.isArray(context.flowState.answers) ? [...context.flowState.answers] : [],
    };
    const savedState = _persistDesignP1FlowState(
      context.messageIndex,
      context.questions,
      nextState
    );
    if (savedState) {
      _rerenderDesignP1PanelByContext(context, savedState);
    }
    return;
  }

  _submitDesignP1RoundAnswers(context, context.flowState);
}

function _handleDesignP1SkipClick(skipBtn) {
  if (isSending) {
    _showDesignP1BusyToastOnce();
    return;
  }
  const context = _getDesignP1PanelContextFromButton(skipBtn);
  if (!context) return;
  _cancelDesignP1FlowPersistDebounce();

  let nextState = _upsertDesignP1Answer(context.flowState, {
    questionId: context.question.id,
    questionText: context.question.text,
    answerText: DESIGN_P1_SKIP_ANSWER_TEXT,
    skipped: true,
    optionId: '',
    answerSource: 'skip',
    selectedOptionId: '',
    selectedOptionText: '',
    customText: '',
  });

  const isLast = context.cursor >= context.questions.length - 1;
  if (!isLast) {
    nextState = {
      cursor: context.cursor + 1,
      answers: Array.isArray(nextState.answers) ? [...nextState.answers] : [],
    };
    const savedState = _persistDesignP1FlowState(
      context.messageIndex,
      context.questions,
      nextState
    );
    if (savedState) {
      _rerenderDesignP1PanelByContext(context, savedState);
    }
    return;
  }

  _submitDesignP1RoundAnswers(context, nextState);
}

function buildDesignP1PromptText(text, thinkingPreview, questions, flowState = null) {
  const parts = [];
  const base = _truncateTextForDesignPrompt(text, 220);
  const locale = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
  if (base) parts.push(locale === 'en' ? `Current reply: ${base}` : `当前回复：${base}`);
  const preview = _truncateTextForDesignPrompt(thinkingPreview, 120);
  if (preview)
    parts.push(locale === 'en' ? `Thinking summary: ${preview}` : `思考摘要：${preview}`);
  const normalizedQuestions = _normalizeDesignP1Questions(questions);
  if (normalizedQuestions.length > 0) {
    const safeState = _sanitizeDesignP1FlowState(flowState, normalizedQuestions);
    parts.push(
      window.i18nService?.t?.('common.currentQuestion', {
        current: safeState.cursor + 1,
        total: normalizedQuestions.length,
      }) || `当前题：Q${safeState.cursor + 1}/${normalizedQuestions.length}`
    );
    const summary = normalizedQuestions
      .map(q => `${q.id}:${_truncateTextForDesignPrompt(q.text, 28)}`)
      .join(' | ');
    parts.push(`本轮问题：${summary}`);
  }
  return _truncateTextForDesignPrompt(parts.join('；'), 400);
}

function buildDesignP1AiMessage(result, modelLabel = '', providerKey = '') {
  const aiText = typeof result?.text === 'string' ? result.text : '';
  const p1ThinkingFull =
    typeof result?.p1ThinkingFull === 'string' ? result.p1ThinkingFull.trim() : '';
  const p1ThinkingPreview = _truncateTextForDesignPrompt(
    result?.p1ThinkingPreview || p1ThinkingFull,
    400
  );
  const p1Questions = _normalizeDesignP1Questions(result?.p1Questions);
  const p1FlowState = _sanitizeDesignP1FlowState(result?.p1FlowState, p1Questions);
  const p1QuestionGoal =
    typeof result?.p1QuestionGoal === 'string' ? result.p1QuestionGoal.trim() : '';
  const aiMessage = {
    sender: 'ai',
    text: aiText,
    modelLabel: typeof modelLabel === 'string' ? modelLabel : '',
  };
  if (providerKey) aiMessage.providerKey = providerKey;
  if (p1ThinkingFull) aiMessage.p1ThinkingFull = p1ThinkingFull;
  if (p1ThinkingPreview) aiMessage.p1ThinkingPreview = p1ThinkingPreview;
  if (p1Questions.length > 0) aiMessage.p1Questions = p1Questions;
  if (p1Questions.length > 0) aiMessage.p1FlowState = p1FlowState;
  if (p1QuestionGoal) aiMessage.p1QuestionGoal = p1QuestionGoal;
  if (p1ThinkingFull || p1ThinkingPreview || p1Questions.length > 0) {
    aiMessage.p1PanelVersion = p1Questions.length > 0 ? 2 : 1;
  }
  aiMessage.promptText = buildDesignP1PromptText(
    aiText,
    p1ThinkingPreview,
    p1Questions,
    p1FlowState
  );
  return aiMessage;
}
window.buildDesignP1AiMessage = buildDesignP1AiMessage;

function _getDesignP1TargetLabel(target) {
  const map = {
    context_world: '世界设定',
    context_rules: '规则系统',
    context_chars: '角色概念',
    context_timeline: '时间线',
    style_guide: '风格基调',
    _mode: '模式选择',
    _upgrade: '升级确认',
  };
  return map[target] || '';
}

function _bindDesignP1FlowLifecycleEvents() {
  if (_designP1LifecycleEventsBound) return;
  window.addEventListener('beforeunload', () => {
    _flushDesignP1FlowPersistNow();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      _flushDesignP1FlowPersistNow();
    }
  });
  window.addEventListener('pagehide', () => {
    _flushDesignP1FlowPersistNow();
  });
  _designP1LifecycleEventsBound = true;
}

function bindDesignP1PanelEvents() {
  if (_designP1PanelEventsBound) return;
  _bindDesignP1FlowLifecycleEvents();
  document.addEventListener('click', e => {
    const toggleBtn = e.target.closest('[data-action~="design-p1-thinking-toggle"]');
    if (toggleBtn) {
      const panel = toggleBtn.closest('.design-p1-panel');
      const body = panel?.querySelector('.design-p1-thinking-body');
      if (!body) return;
      const collapsed = body.classList.toggle('is-collapsed');
      toggleBtn.textContent = collapsed
        ? window.i18nService?.t?.('common.expandThinking') || '展开完整思考'
        : window.i18nService?.t?.('common.collapseThinking') || '收起完整思考';
      return;
    }

    const optionBtn = e.target.closest('[data-action~="design-p1-option-btn"]');
    if (optionBtn) {
      _handleDesignP1OptionClick(optionBtn);
      return;
    }

    const continueBtn = e.target.closest('[data-action~="design-p1-continue-btn"]');
    if (continueBtn) {
      _handleDesignP1ContinueClick(continueBtn);
      return;
    }

    const skipBtn = e.target.closest('[data-action~="design-p1-skip-btn"]');
    if (skipBtn) {
      _handleDesignP1SkipClick(skipBtn);
    }
  });
  document.addEventListener('input', e => {
    const customInput = e.target.closest('.design-p1-custom-input');
    if (customInput) {
      _handleDesignP1CustomInputChange(customInput, 'debounced');
    }
  });
  document.addEventListener('change', e => {
    const customInput = e.target.closest('.design-p1-custom-input');
    if (customInput) {
      _handleDesignP1CustomInputChange(customInput, 'immediate');
    }
  });
  document.addEventListener('focusout', e => {
    const customInput = e.target.closest('.design-p1-custom-input');
    if (customInput) {
      _handleDesignP1CustomInputChange(customInput, 'immediate');
    }
  });
  _designP1PanelEventsBound = true;
}

/**
 * 渲染 P1 进度条：显示当前处于哪个阶段
 */
function _renderDesignP1ProgressBar() {
  if (!window.designService?.p1State) return '';
  const state = window.designService.p1State.getState();

  const steps = [
    { label: '题材', key: 'r1' },
    { label: '模式/风格', key: 'r2' },
    { label: '细化', key: 'rn' },
    { label: '框架', key: 'fw' },
  ];

  // 根据状态确定当前步骤
  const stateToStep = {
    'P1_INIT': 0, 'P1_R1_PENDING': 0, 'P1_R1_ANSWERED': 0,
    'P1_R2_PENDING': 1, 'P1_R2_ANSWERED': 1,
    'P1_RN_PENDING': 2, 'P1_RN_ANSWERED': 2,
    'P1_UPGRADE_PENDING': 2, 'P1_UPGRADE_ANSWERED': 2,
    'P1_FORCE_COMPLETING': 3,
    'P1_FRAMEWORK_READY': 3,
    'P1_RANDOM_SHORTCUT': 3,
  };
  const currentStep = stateToStep[state] ?? 0;

  const stepsHtml = steps.map((s, i) => {
    let cls = 'design-p1-step';
    if (i < currentStep) cls += ' design-p1-step--done';
    else if (i === currentStep) cls += ' design-p1-step--current';
    else cls += ' design-p1-step--pending';
    return `<span class="${cls}">${i < currentStep ? '✓' : (i + 1) + '.'} ${escapeHTML(s.label)}</span>`; // ui-lint-allow
  }).join('<span class="design-p1-step-arrow">→</span>');

  return `<div class="design-p1-progress-bar">${stepsHtml}</div>`;
}

/**
 * 渲染回退链接：仅在 R3+ 状态可见
 */
function _renderDesignP1BacktrackLink(canInteract) {
  if (!canInteract || !window.designService?.p1State) return '';
  const state = window.designService.p1State.getState();
  const backtrackable = ['P1_RN_PENDING', 'P1_RN_ANSWERED', 'P1_UPGRADE_PENDING', 'P1_UPGRADE_ANSWERED'];
  if (!backtrackable.includes(state)) return '';
  return `<a href="#" class="design-p1-backtrack-link" onclick="event.preventDefault(); if(window.designService?.p1State?.backtrackToR2()){ window.designService._saveDesignConfig(); if(typeof showToast==='function') showToast('已回退到模式/风格选择，请发送消息继续'); }">修改模式/风格</a>`;
}

function renderDesignP1PanelIntoMessage(msgEl, histMsg) {
  if (!msgEl || !histMsg || histMsg.sender !== 'ai') return;
  const contentEl = msgEl.querySelector('.chat-message-content');
  if (!contentEl) return;

  const oldPanel = contentEl.querySelector('.design-p1-panel');
  if (oldPanel) oldPanel.remove();

  const questions = _normalizeDesignP1Questions(histMsg.p1Questions);
  const flowState = _sanitizeDesignP1FlowState(histMsg.p1FlowState, questions);
  const question = questions[flowState.cursor] || null;
  const answer = question ? _findDesignP1Answer(flowState, question.id) : null;
  const thinkingFull =
    typeof histMsg.p1ThinkingFull === 'string' && histMsg.p1ThinkingFull.trim()
      ? histMsg.p1ThinkingFull.trim()
      : typeof histMsg.p1ThinkingPreview === 'string' && histMsg.p1ThinkingPreview.trim()
        ? histMsg.p1ThinkingPreview.trim()
        : '';
  const goal = typeof histMsg.p1QuestionGoal === 'string' ? histMsg.p1QuestionGoal.trim() : '';
  if (!thinkingFull && !question) return;

  bindDesignP1PanelEvents();

  const panel = document.createElement('div');
  panel.className = 'design-p1-panel';

  msgEl.classList.add('design-p1-message-wrapper');

  const messageIndex = Number.parseInt(msgEl.dataset.originalIndex, 10);
  const canInteract = _canUseDesignP1Panel(messageIndex);
  if (question?.id) panel.dataset.questionId = question.id;
  if (question?.text) panel.dataset.questionText = question.text;

  const safeThinking = window.htmlSecurity
    ? window.htmlSecurity.plainTextToSafeHtml(thinkingFull)
    : escapeHTML(thinkingFull).replace(/\n/g, '<br>');
  const disabledAttr = canInteract ? '' : 'disabled';
  const isLastQuestion = question ? flowState.cursor >= questions.length - 1 : false;
  const continueBtnLabel = isLastQuestion ? '继续并提交' : '继续';
  const progressText = question
    ? window.i18nService?.t?.('common.questionProgress', {
      current: flowState.cursor + 1,
      total: questions.length,
    }) || `问题 ${flowState.cursor + 1}/${questions.length}`
    : '';
  const answerSource = _normalizeDesignP1AnswerSource(answer?.answerSource);
  const selectedOptionId =
    typeof answer?.selectedOptionId === 'string' && answer.selectedOptionId.trim()
      ? answer.selectedOptionId.trim()
      : typeof answer?.optionId === 'string' && answer.optionId.trim()
        ? answer.optionId.trim()
        : '';
  const selectedOptionText =
    typeof answer?.selectedOptionText === 'string' ? answer.selectedOptionText.trim() : '';
  const customValueRaw =
    typeof answer?.customText === 'string'
      ? answer.customText
      : answerSource === 'custom' && typeof answer?.answerText === 'string'
        ? answer.answerText
        : '';
  const customValue = customValueRaw.slice(0, DESIGN_P1_CUSTOM_TEXT_MAX_LEN);
  const isCustomSelected = answerSource === 'custom';
  const optionButtonsHtml = question
    ? question.options
      .map(
        (opt, idx) => `
          <button
            type="button"
            class="${canInteract ? '' : 'is-disabled '}${answerSource === 'option' && (selectedOptionId === opt.id || selectedOptionText === opt.text || answer?.answerText === opt.text) ? 'is-selected' : ''}"
            data-action="design-p1-option-btn"
            ${disabledAttr}
            data-question-id="${_escapeDesignAttr(question.id)}"
            data-question-text="${_escapeDesignAttr(question.text)}"
            data-question-target="${_escapeDesignAttr(question.target || '')}"
            data-option-id="${_escapeDesignAttr(opt.id)}"
            data-option-text="${_escapeDesignAttr(opt.text)}"
          >
            <span class="design-p1-option-key">${String.fromCharCode(65 + idx)}</span>
            <span class="design-p1-option-text">${escapeHTML(opt.text)}</span>
          </button>
        `
      )
      .join('')
    : '';
  const customKeyLabel = question ? String.fromCharCode(65 + (question.options?.length || 0)) : 'D';
  const customInputHtml = question
    ? `
      <div class="design-p1-custom-row${canInteract ? '' : ' is-disabled'}${isCustomSelected ? ' is-selected' : ''}">
        <span class="design-p1-custom-key">${customKeyLabel}</span>
        <textarea
          class="design-p1-custom-input${canInteract ? '' : ' is-disabled'}"
          ${disabledAttr}
          maxlength="${DESIGN_P1_CUSTOM_TEXT_MAX_LEN}"
          placeholder="输入你的想法（可选）"
          rows="2"
          data-question-id="${_escapeDesignAttr(question.id)}"
          data-question-text="${_escapeDesignAttr(question.text)}"
        >${_escapeDesignInputValue(customValue)}</textarea>
      </div>
    `
    : '';
  const questionTag = question ? _getDesignP1TargetLabel(question.target) : '';
  const questionTagHtml = questionTag
    ? `<span class="design-p1-question-tag">${escapeHTML(questionTag)}</span>`
    : '';
  const questionHtml = question
    ? `
      <div class="design-p1-question-card">
        <div class="design-p1-question-head">
          <span class="design-p1-question-index">Q${flowState.cursor + 1}</span>
          ${progressText ? `<span class="design-p1-progress">${escapeHTML(progressText)}</span>` : ''}
          ${questionTagHtml}
        </div>
        <div class="design-p1-question-main">${escapeHTML(question.text)}</div>
        <div class="design-p1-option-list">${optionButtonsHtml}</div>
        ${customInputHtml}
        <div class="design-p1-actions">
          <button
            type="button"
            class="${canInteract ? '' : 'is-disabled'}"
            data-action="design-p1-continue-btn"
            ${disabledAttr}
            data-question-id="${_escapeDesignAttr(question.id)}"
            data-question-text="${_escapeDesignAttr(question.text)}"
          >
            ${continueBtnLabel}
          </button>
          <button
            type="button"
            class="${canInteract ? '' : 'is-disabled'}"
            data-action="design-p1-skip-btn"
            ${disabledAttr}
            data-question-id="${_escapeDesignAttr(question.id)}"
            data-question-text="${_escapeDesignAttr(question.text)}"
          >
            跳过
          </button>
        </div>
      </div>
    `
    : '';
  const hasQuestionOptions = question && Array.isArray(question.options) && question.options.length > 0;
  const tipText = canInteract
    ? (hasQuestionOptions
      ? '先选一个选项或输入你的想法，再点”继续”；也可以点”跳过”。'
      : '输入你的想法，再点”继续”；也可以点”跳过”。')
    : '历史问题仅供查看，可在输入框继续补充。';

  // 进度条 + 回退链接
  const p1ProgressHtml = _renderDesignP1ProgressBar();
  const p1BacktrackHtml = _renderDesignP1BacktrackLink(canInteract);

  panel.innerHTML = `
    ${p1ProgressHtml}
    <div class="design-p1-panel-title">本轮思考与提问</div>
    ${p1BacktrackHtml}
    ${goal ? `<div class="design-p1-goal">目标：${escapeHTML(goal)}</div>` : ''}
    <div class="design-p1-thinking">
      <div class="design-p1-thinking-header">
        <span class="design-p1-thinking-label">完整思考</span>
        <button type="button" class="" data-action="design-p1-thinking-toggle">${window.i18nService?.t?.('common.expandThinking') || '展开完整思考'}</button>
      </div>
      <div class="design-p1-thinking-body is-collapsed">${safeThinking}</div>
    </div>
    ${questionHtml}
    <div class="design-p1-panel-tip">${tipText}</div>
  `;
  contentEl.appendChild(panel);
}
window.renderDesignP1PanelIntoMessage = renderDesignP1PanelIntoMessage;

// ── Phase 1 框架预览 ──────────────────────────────────────────

const _DESIGN_FW_FIELD_ICONS = {
  context_world: 'public',
  context_rules: 'dashboard',
  context_chars: 'person',
  context_timeline: 'event',
  style_guide: 'palette',
};

const _DESIGN_FW_TERM_LABELS = {
  currency_name: '货币名称',
  calendar_era: '纪年名称',
};

let _designFwPreviewEventsBound = false;

/**
 * 在聊天消息内渲染 Phase 1 框架预览面板（可折叠/可编辑）
 * @param {HTMLElement} msgEl - 消息 DOM 元素
 * @param {boolean} [canInteract=true] - 是否可交互（历史消息设为 false）
 */
function renderDesignP1FrameworkPreview(msgEl, canInteract = true) {
  if (!msgEl || !window.designService?.p1Output) return;
  const contentEl = msgEl.querySelector('.chat-message-content');
  if (!contentEl) return;

  const oldPreview = contentEl.querySelector('.design-p1-framework-preview');
  if (oldPreview) oldPreview.remove();

  const p1 = window.designService.p1Output;
  const disabledCls = canInteract ? '' : ' is-disabled';
  const disabledAttr = canInteract ? '' : ' disabled';

  const fields = ['context_world', 'context_rules', 'context_chars', 'context_timeline', 'style_guide'];

  let cardsHtml = '';
  for (const field of fields) {
    const label = _getDesignP1TargetLabel(field);
    const icon = _DESIGN_FW_FIELD_ICONS[field] || 'article';
    const text = typeof p1[field] === 'string' ? p1[field] : '';
    const charCount = text.length;
    const safeText = window.htmlSecurity
      ? window.htmlSecurity.plainTextToSafeHtml(text)
      : escapeHTML(text).replace(/\n/g, '<br>');
    const escapedValue = _escapeDesignInputValue(text);

    cardsHtml += `
      <div class="design-fw-card${disabledCls}" data-field="${field}">
        <div class="design-fw-card-header">
          <span class="material-symbols-outlined design-fw-card-icon">${icon}</span>
          <span class="design-fw-card-label">${escapeHTML(label)}</span>
          <span class="design-fw-card-length">(${charCount}字)</span>
          <button type="button" class="btn-ghost btn-sm" data-action="design-fw-cancel-btn" style="display:none"${disabledAttr}>取消</button>
          <button type="button" class="btn-primary btn-sm" data-action="design-fw-save-btn" style="display:none"${disabledAttr}>保存</button>
          <button type="button" class="btn-primary btn-sm" data-action="design-fw-edit-btn"${disabledAttr}>编辑</button>
        </div>
        <div class="design-fw-card-body is-collapsed">
          <div class="design-fw-card-display">${safeText}</div>
          <textarea class="design-fw-card-editor" rows="6" style="display:none"${disabledAttr}>${escapedValue}</textarea>
          <span class="design-fw-validation-hint" style="display:none"></span>
        </div>
      </div>`;
  }

  // world_terms section
  const wt = p1.world_terms || {};
  let termsHtml = '';
  for (const [key, label] of Object.entries(_DESIGN_FW_TERM_LABELS)) {
    const raw = wt[key];
    let value = '';
    if (Array.isArray(raw)) {
      value = raw.join('、');
    } else if (typeof raw === 'string') {
      value = raw;
    }
    termsHtml += `
      <div class="design-fw-term-row">
        <label class="design-fw-term-label">${escapeHTML(label)}</label>
        <input type="text" class="design-fw-term-input${disabledCls}" data-term-key="${key}" value="${_escapeDesignAttr(value)}"${disabledAttr}>
      </div>`;
  }

  // calendar_units / location_levels (read-only display)
  let extrasHtml = '';
  if (Array.isArray(wt.calendar_units) && wt.calendar_units.length > 0) {
    extrasHtml += `<div class="design-fw-extras-row"><span class="design-fw-term-label">时间单位</span><span class="design-fw-extras-value" data-extras-key="calendar_units">${escapeHTML(wt.calendar_units.join('、'))}</span></div>`;
  }
  if (Array.isArray(wt.location_levels) && wt.location_levels.length > 0) {
    extrasHtml += `<div class="design-fw-extras-row"><span class="design-fw-term-label">地点层级</span><span class="design-fw-extras-value" data-extras-key="location_levels">${escapeHTML(wt.location_levels.join('、'))}</span></div>`;
  }
  // extra_status_groups / extra_char_fields (read-only + link to worldcard panel)
  if (Array.isArray(wt.extra_status_groups) && wt.extra_status_groups.length > 0) {
    const names = wt.extra_status_groups.map(g => g?.label || g?.key || '?').join('、');
    extrasHtml += `<div class="design-fw-extras-row"><span class="design-fw-term-label">额外状态组</span><span class="design-fw-extras-value" data-extras-key="extra_status_groups">${escapeHTML(names)}</span></div>`;
  }
  if (Array.isArray(wt.extra_char_fields) && wt.extra_char_fields.length > 0) {
    const names = wt.extra_char_fields.map(f => f?.label || f?.key || '?').join('、');
    extrasHtml += `<div class="design-fw-extras-row"><span class="design-fw-term-label">额外角色字段</span><span class="design-fw-extras-value" data-extras-key="extra_char_fields">${escapeHTML(names)}</span></div>`;
  }

  // 引导提示：如需编辑请到世界卡信息面板
  const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const editGuideHtml = canInteract
    ? `<div class="design-fw-extras-guide">如需编辑状态栏和角色字段，请${isTouchDevice ? '点击顶部的' : '前往右侧'} <a href="#" class="design-fw-worldcard-link"><span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;">dashboard_customize</span> 世界卡信息</a> ${isTouchDevice ? '' : '面板'}</div>`
    : '';

  const preview = document.createElement('div');
  preview.className = `design-p1-framework-preview${disabledCls}`;
  preview.innerHTML = `
    <div class="design-fw-title">世界框架预览</div>
    ${cardsHtml}
    <div class="design-fw-terms-section">
      <div class="design-fw-terms-title">世界术语</div>
      <div class="design-fw-terms-grid">${termsHtml}</div>
      ${extrasHtml}
      ${editGuideHtml}
    </div>
    <div class="design-fw-hint">${canInteract ? '可直接编辑上方内容，也可在下方输入框继续与AI对话优化框架' : '历史预览仅供查看'}</div>
  `;

  contentEl.appendChild(preview);
  bindDesignP1FrameworkPreviewEvents();
}
window.renderDesignP1FrameworkPreview = renderDesignP1FrameworkPreview;

function bindDesignP1FrameworkPreviewEvents() {
  if (_designFwPreviewEventsBound) return;

  document.addEventListener('click', e => {
    // 折叠/展开卡片（点击 header 但不命中 header 上的任一编辑按钮时）
    const header = e.target.closest('.design-fw-card-header');
    const onHeaderBtn = e.target.closest(
      '[data-action~="design-fw-edit-btn"], [data-action~="design-fw-save-btn"], [data-action~="design-fw-cancel-btn"]'
    );
    if (header && !onHeaderBtn && !header.closest('.design-p1-framework-preview.is-disabled')) {
      const body = header.nextElementSibling;
      if (body?.classList.contains('design-fw-card-body')) {
        body.classList.toggle('is-collapsed');
      }
      return;
    }

    // 编辑按钮 → 进入编辑态：隐藏编辑、显示取消+保存
    const editBtn = e.target.closest('[data-action~="design-fw-edit-btn"]');
    if (editBtn && !editBtn.disabled) {
      const card = editBtn.closest('.design-fw-card');
      if (!card) return;
      const body = card.querySelector('.design-fw-card-body');
      if (body) body.classList.remove('is-collapsed');
      const display = card.querySelector('.design-fw-card-display');
      const editor = card.querySelector('.design-fw-card-editor');
      const saveBtnEl = card.querySelector('[data-action~="design-fw-save-btn"]');
      const cancelBtnEl = card.querySelector('[data-action~="design-fw-cancel-btn"]');
      if (display) display.style.display = 'none';
      if (editor) {
        // Refresh editor content from current p1Output
        const field = card.dataset.field;
        if (field && window.designService?.p1Output) {
          editor.value = window.designService.p1Output[field] || '';
        }
        editor.style.display = '';
        editor.focus({ preventScroll: true });
      }
      if (saveBtnEl) saveBtnEl.style.display = '';
      if (cancelBtnEl) cancelBtnEl.style.display = '';
      editBtn.style.display = 'none';
      return;
    }

    // 保存按钮
    const saveBtn = e.target.closest('[data-action~="design-fw-save-btn"]');
    if (saveBtn && !saveBtn.disabled) {
      const card = saveBtn.closest('.design-fw-card');
      if (!card) return;
      const field = card.dataset.field;
      const editor = card.querySelector('.design-fw-card-editor');
      const newValue = editor?.value || '';

      // Soft validation
      const hint = card.querySelector('.design-fw-validation-hint');
      if (newValue.trim().length < 80) {
        if (hint) {
          hint.textContent = '内容较短（建议至少80字），已保存';
          hint.style.display = '';
          setTimeout(() => { hint.style.display = 'none'; }, 3000);
        }
      } else if (hint) {
        hint.style.display = 'none';
      }

      if (field && window.designService) {
        window.designService.updateP1OutputField(field, newValue);
      }

      // Update display
      const display = card.querySelector('.design-fw-card-display');
      if (display) {
        display.innerHTML = window.htmlSecurity
          ? window.htmlSecurity.plainTextToSafeHtml(newValue)
          : escapeHTML(newValue).replace(/\n/g, '<br>');
        display.style.display = '';
      }
      if (editor) editor.style.display = 'none';
      const cancelBtnEl = card.querySelector('[data-action~="design-fw-cancel-btn"]');
      if (cancelBtnEl) cancelBtnEl.style.display = 'none';
      saveBtn.style.display = 'none';
      const editBtnRestore = card.querySelector('[data-action~="design-fw-edit-btn"]');
      if (editBtnRestore) editBtnRestore.style.display = '';

      // Update char count
      const lengthEl = card.querySelector('.design-fw-card-length');
      if (lengthEl) lengthEl.textContent = `(${newValue.length}字)`;
      return;
    }

    // 取消按钮
    const cancelBtn = e.target.closest('[data-action~="design-fw-cancel-btn"]');
    if (cancelBtn) {
      const card = cancelBtn.closest('.design-fw-card');
      if (!card) return;
      const display = card.querySelector('.design-fw-card-display');
      const editor = card.querySelector('.design-fw-card-editor');
      const saveBtnEl = card.querySelector('[data-action~="design-fw-save-btn"]');
      if (display) display.style.display = '';
      if (editor) editor.style.display = 'none';
      if (saveBtnEl) saveBtnEl.style.display = 'none';
      cancelBtn.style.display = 'none';
      const editBtnRestore = card.querySelector('[data-action~="design-fw-edit-btn"]');
      if (editBtnRestore) editBtnRestore.style.display = '';
      return;
    }
  });

  // world_terms input sync
  document.addEventListener('change', e => {
    const input = e.target.closest('.design-fw-term-input');
    if (!input || input.disabled) return;
    const key = input.dataset.termKey;
    if (!key || !window.designService) return;
    const value = input.value.trim();
    window.designService.updateP1OutputField('world_terms.' + key, value);
  });

  // "世界卡信息" link click → open worldcard panel
  document.addEventListener('click', e => {
    const link = e.target.closest('.design-fw-worldcard-link');
    if (!link) return;
    e.preventDefault();
    const isMobile = window.matchMedia('(max-width: 768px)').matches ||
      window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (isMobile) {
      document.getElementById('worldcard-tile-btn')?.click();
    } else {
      const tile = document.getElementById('worldcard-info-tile');
      if (tile) {
        tile.style.display = '';
        const step3Card = tile.querySelector('.wci-s3-card');
        if (step3Card) step3Card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  _designFwPreviewEventsBound = true;
}

/**
 * 在世界卡消息中渲染一致性发现的交互按钮。
 * @param {HTMLElement} msgEl - 消息 DOM 元素
 * @param {Array} findings - consistencyFindings 数组
 */
function renderConsistencyFindingButtons(msgEl, findings) {
  if (!Array.isArray(findings) || findings.length === 0) return;
  const contentEl = msgEl.querySelector('.chat-message-content');
  if (!contentEl) return;

  // 避免重复渲染
  if (contentEl.querySelector('.consistency-findings-container')) return;

  const container = document.createElement('div');
  container.className = 'consistency-findings-container';
  container.style.cssText = 'margin-top: 12px; display: flex; flex-direction: column; gap: 10px;';

  findings.forEach(finding => {
    const row = document.createElement('div');
    row.className = 'consistency-finding-row';
    row.dataset.findingId = finding.id;
    row.style.cssText =
      'display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 0; border-top: 1px solid var(--overlay-20);';

    const btnStyle =
      'padding: 4px 12px; border-radius: 4px; border: 1px solid var(--overlay-20); background: var(--overlay-8); cursor: pointer; font-size: 0.85em; transition: opacity 0.2s;';

    if (finding.resolved) {
      const labels = { fix: '已修改', keep: '已保持', custom: '已自定义', edit: '已转至编辑' };
      row.innerHTML = `<span style="color: var(--status-success); font-size: 0.85em;">✓ ${labels[finding.resolution] || '已处理'}</span>`; // ui-lint-allow
    } else if (finding.type === 'event') {
      row.innerHTML = `
        <button class="btn-secondary" style="${btnStyle}" onclick="window.designService?._resolveConsistencyFinding('${finding.id}', 'edit')">让我修改此事件</button>
        <button class="btn-secondary" style="${btnStyle}" onclick="window.designService?._resolveConsistencyFinding('${finding.id}', 'keep')">保持不变</button>
      `;
    } else {
      row.innerHTML = `
        <button class="btn-secondary" style="${btnStyle}" onclick="window.designService?._resolveConsistencyFinding('${finding.id}', 'fix')">修改到合理时间</button>
        <button class="btn-secondary" style="${btnStyle}" onclick="window.designService?._resolveConsistencyFinding('${finding.id}', 'keep')">保持不变</button>
        <button class="btn-secondary consistency-finding-custom-btn" style="${btnStyle}">自定义...</button>
      `;
      const customBtn = row.querySelector('.consistency-finding-custom-btn');
      if (customBtn) {
        customBtn.addEventListener('click', () => {
          const promptFn = typeof window.showDesignPrompt === 'function'
            ? window.showDesignPrompt
            : null;
          if (!promptFn) return;
          promptFn('自定义时间', '请输入自定义时间值：').then(v => {
            if (v) window.designService?._resolveConsistencyFinding(finding.id, 'custom', v);
          });
        });
      }
    }

    container.appendChild(row);
  });

  contentEl.appendChild(container);
}

function renderInspectionFindingButtons(msgEl, findings) {
  if (!Array.isArray(findings) || findings.length === 0) return;
  const contentEl = msgEl.querySelector('.chat-message-content');
  if (!contentEl) return;

  if (contentEl.querySelector('.inspection-findings-container')) return;

  const container = document.createElement('div');
  container.className = 'inspection-findings-container';
  container.style.cssText = 'margin-top: 12px; display: flex; flex-direction: column; gap: 12px;';

  findings.forEach(finding => {
    const row = document.createElement('div');
    row.className = 'inspection-finding-row';
    row.dataset.findingId = finding.id;
    row.style.cssText =
      'padding: 10px; border-radius: 6px; border-left: 3px solid ' +
      (finding.severity === 'error' || finding.severity === 'fatal' ? 'var(--status-danger)' : 'var(--status-warning)') +
      '; background: var(--overlay-5);';

    const btnStyle =
      'padding: 4px 12px; border-radius: 4px; border: 1px solid var(--overlay-20); background: var(--overlay-8); cursor: pointer; font-size: 0.85em; transition: opacity 0.2s; margin-right: 6px; margin-top: 6px;';

    if (finding.resolved) {
      const optLabel =
        (finding.options || []).find(o => o.id === finding.resolution)?.label || finding.resolution;
      row.innerHTML = `
        <div style="font-size: 0.9em; margin-bottom: 4px;">${escapeHTML(finding.question || '')}</div>
        <span style="color: var(--status-success); font-size: 0.85em;">✓ 已处理: ${escapeHTML(optLabel)}</span> <!-- ui-lint-allow -->
      `;
    } else {
      const questionHtml = `<div style="font-size: 0.9em; margin-bottom: 8px;">${escapeHTML(finding.question || '')}</div>`;
      const buttonsHtml = (finding.options || [])
        .map(
          opt =>
            `<button class="btn-secondary" style="${btnStyle}" onclick="window.designService?._resolveInspectionFinding('${finding.id}', '${opt.id}')">${escapeHTML(opt.label)}</button>`
        )
        .join('');
      row.innerHTML = questionHtml + '<div>' + buttonsHtml + '</div>';
    }

    container.appendChild(row);
  });

  contentEl.appendChild(container);
}

let _pendingChatRefresh = false;

function _shouldDeferChatRefresh() {
  const streamActive =
    typeof streamVisualizer !== 'undefined' &&
    typeof streamVisualizer.isStreaming === 'function' &&
    streamVisualizer.isStreaming();
  const aiRequestActive =
    typeof aiService !== 'undefined' &&
    typeof aiService.hasActiveRequest === 'function' &&
    aiService.hasActiveRequest();
  return streamActive || aiRequestActive;
}

function _normalizeChatRefreshOptions(options = {}) {
  return {
    scrollMode: options?.scrollMode === 'bottom' ? 'bottom' : 'preserve',
  };
}

let _pendingChatRefreshOptions = _normalizeChatRefreshOptions();

function refreshChatUI(options = {}) {
  const normalizedOptions = _normalizeChatRefreshOptions(options);
  const willDefer = _shouldDeferChatRefresh();
  window.__uiDiag?.track?.('diag.chat.refresh', {
    scroll_mode: normalizedOptions.scrollMode,
    will_defer: willDefer,
    pending_was: _pendingChatRefresh,
  });
  if (willDefer) {
    _pendingChatRefresh = true;
    _pendingChatRefreshOptions = normalizedOptions;
    return false;
  }
  _pendingChatRefresh = false;
  _pendingChatRefreshOptions = _normalizeChatRefreshOptions();
  _performChatUIRefresh(normalizedOptions);
  return true;
}

function flushPendingChatRefresh() {
  if (!_pendingChatRefresh) return false;
  if (_shouldDeferChatRefresh()) return false;
  const options = _pendingChatRefreshOptions || _normalizeChatRefreshOptions();
  _pendingChatRefresh = false;
  _pendingChatRefreshOptions = _normalizeChatRefreshOptions();
  _performChatUIRefresh(options);
  return true;
}

// 刷新聊天界面
function _performChatUIRefresh(options = {}) {
  // 确保 chatMessagesArea 已初始化
  if (!chatMessagesArea) {
    chatMessagesArea = document.querySelector('.chat-messages-area');
  }
  if (!chatMessagesArea) {
    console.warn('[refreshChatUI] chatMessagesArea not found');
    return;
  }

  // 确保 chatHistory 存在
  if (typeof chatHistory === 'undefined') {
    console.warn('[refreshChatUI] chatHistory not defined');
    return;
  }

  // 主聊天区滚动条规矩：见 CLAUDE.md
  // - preserve 分支：DOM 全量重建会让浏览器把 scrollTop 重置为 0，save→restore 让用户视角下零位移
  // - bottom 分支：history-replaced 场景（存档载入/卡切换/模式切换/消息删除）让用户落到最新一轮
  const scrollMode = options.scrollMode === 'bottom' ? 'bottom' : 'preserve';
  const savedScrollTop = scrollMode === 'preserve' ? chatMessagesArea.scrollTop : 0;
  const restoreScrollPosition = () => {
    if (!chatMessagesArea || !window.scrollController) return;
    if (scrollMode === 'bottom') {
      // history-replaced：落到最新一轮（scrollController 单一滚动管理者）。
      window.scrollController.scrollToBottom(true);
      return;
    }
    // preserve（rebuild-compensation）：全量重建后把用户视角拉回原 scrollTop。
    // 写入归 scrollController 统一持有（双 rAF 在异步增强后再补一次，覆盖 bug#4）。
    window.scrollController.restoreScrollTop(savedScrollTop);
  };

  // 隐藏以防止闪烁
  chatMessagesArea.style.visibility = 'hidden';

  clearChatHistory();
  // 全量重建即本轮结束、spacer 节点已被 innerHTML='' 销毁 → 撤销发送置顶
  window.scrollController?.clearTurnSpacer?.();

  // 重置折叠状态
  foldedGroups = [];

  // 构建消息信息(带原始索引)
  let aiTurnCount = -1;
  const currentUserLabel = getUserLabel();
  const messageInfos = chatHistory.map((msg, originalIndex) => {
    let name,
      turn = null,
      uid = null;
    let functionCalls = [],
      reasoningContents = null,
      metrics = null,
      step2Choices = null,
      npcReactions = null;
    let providerKey = null;

    if (msg.sender === 'user') {
      name = currentUserLabel;
    } else {
      aiTurnCount++;
      if (isDesignMode) {
        const stageName = typeof msg.stageName === 'string' ? msg.stageName : null;
        const modelLabel = resolveDesignModelLabel(msg);
        name = formatDesignAssistantLabel(modelLabel, stageName);
        providerKey = resolveDesignProviderKey(msg);
      } else {
        uid = msg.uid || null;
        functionCalls = msg.functionCalls || [];
        reasoningContents = msg.reasoningContents || null;
        metrics = msg.metrics || null;
        step2Choices = msg.step2Choices || null;
        npcReactions = msg.npcReactions || null;
        if (!npcReactions && uid && typeof npcReactionStore !== 'undefined') {
          const storeData = npcReactionStore.getReactions(uid);
          if (storeData && Object.keys(storeData).length > 0) {
            npcReactions = storeData;
          }
        }
        const modelLabel = resolveReactModelLabel(msg, metrics);
        const thinkingLevel = resolveReactThinkingLevel(msg, metrics);
        name = formatAiLabel(
          modelLabel,
          aiTurnCount,
          thinkingLevel,
          isReactOfficialDeepSeek(msg, metrics)
        );
        providerKey = resolveReactProviderKey(msg, metrics, modelLabel);
        turn = aiTurnCount;
      }
    }
    return {
      text: msg.displayText || msg.text,
      name,
      turn,
      uid,
      functionCalls,
      reasoningContents,
      metrics,
      sender: msg.sender,
      step2Choices,
      npcReactions,
      providerKey,
      originalIndex,
    };
  });

  // 按 turn(AI 回复数)计算分组，与章节总结周期一致
  // Turn 0 是开场白，所以第一组是 Turn 0-20(21个)，之后每 20 轮一组

  // 统计每个 turn 的结束位置(AI 消息的索引)
  const turnEndIndices = []; // 每个 turn 结束时的消息索引
  messageInfos.forEach((info, idx) => {
    if (info.sender === 'ai') {
      turnEndIndices.push(idx);
    }
  });

  const totalTurns = turnEndIndices.length;

  // 第一组特殊:包含 Turn 0(开场白)到 Turn 20，共 21 个 turn
  const firstGroupSize = TURNS_FOLD_SIZE + 1; // 21

  // 计算折叠组
  const foldGroups = [];

  if (totalTurns > firstGroupSize) {
    // 第一组:Turn 0 - 20(21 个)
    foldGroups.push({ startTurn: 0, endTurn: firstGroupSize });

    // 后续组:每 20 个 turn 一组
    let currentTurn = firstGroupSize;
    while (currentTurn + TURNS_FOLD_SIZE <= totalTurns) {
      foldGroups.push({
        startTurn: currentTurn,
        endTurn: currentTurn + TURNS_FOLD_SIZE,
      });
      currentTurn += TURNS_FOLD_SIZE;
    }
  }

  if (foldGroups.length > 0) {
    // 创建折叠组
    foldGroups.forEach((group, i) => {
      const startTurn = group.startTurn;
      const endTurn = group.endTurn;
      const turnCount = endTurn - startTurn;

      // 转换为消息索引范围
      const startIdx = startTurn === 0 ? 0 : turnEndIndices[startTurn - 1] + 1;
      const endIdx = turnEndIndices[endTurn - 1] + 1;

      const groupMessages = messageInfos.slice(startIdx, endIdx);

      foldedGroups.push({
        groupIndex: i,
        startIndex: startIdx,
        endIndex: endIdx,
        startTurn: startTurn,
        endTurn: endTurn,
        messages: groupMessages,
      });

      // 渲染折叠条
      const foldBar = createFoldBar(i, startTurn, endTurn, turnCount);
      chatMessagesArea.appendChild(foldBar);
    });

    // 渲染剩余的消息
    const lastFoldedTurn = foldGroups[foldGroups.length - 1].endTurn;
    const remainingStartIdx = turnEndIndices[lastFoldedTurn - 1] + 1;
    const visibleMessages = messageInfos.slice(remainingStartIdx);
    visibleMessages.forEach(info => {
      const msgEl = addMessageWithIndex(
        info.text,
        info.name,
        info.sender === 'user' ? 'user' : 'ai',
        info.originalIndex,
        { providerKey: info.providerKey, message: chatHistory[info.originalIndex], uid: info.uid }
      );
      if (msgEl) {
        msgEl.dataset.originalIndex = info.originalIndex;
      }
    });
  } else {
    // 不满足折叠条件，全部显示
    messageInfos.forEach(info => {
      const msgEl = addMessageWithIndex(
        info.text,
        info.name,
        info.sender === 'user' ? 'user' : 'ai',
        info.originalIndex,
        { providerKey: info.providerKey, message: chatHistory[info.originalIndex], uid: info.uid }
      );
      if (msgEl) {
        msgEl.dataset.originalIndex = info.originalIndex;
      }
    });
  }

  // 切换 onboarding 模式（隐藏状态栏、AI 标签、输入栏）
  const chatContainer = document.getElementById('main-stage');
  if (chatContainer) {
    const isOnboarding =
      (chatHistory.length === 1 && chatHistory[0].isOnboarding === true) ||
      window._showOnboarding === true;
    chatContainer.classList.toggle('onboarding-active', isOnboarding);
  }

  // 等待 DOM 更新后处理
  setTimeout(() => {
    enhanceMessages();

    const messages = document.querySelectorAll('.chat-message');
    messages.forEach(msgEl => {
      const originalIndex = parseInt(msgEl.dataset.originalIndex, 10);
      if (isNaN(originalIndex) || originalIndex >= messageInfos.length) return;

      const info = messageInfos[originalIndex];
      const contentEl = msgEl.querySelector('.chat-message-content');

      if (contentEl) {
        // 世界卡下不更新游戏状态
        if (!isDesignMode && info.turn !== null && typeof npcStore !== 'undefined') {
          npcStore.currentTurn = info.turn;
        }
        if (!isDesignMode && info.turn !== null && window.inventoryStore) {
          window.inventoryStore.currentTurn = info.turn;
        }
        // 错误消息使用结构化 Banner 渲染
        const histMsg = chatHistory[originalIndex];
        // 重建 AI 气泡 innerHTML 时，先取一次 OOC prefix——否则下面的整体覆盖
        // 会把 addMessageWithIndex 拼好的 prefix 擦掉，导致刷新后 OOC 气泡丢失
        const rebuildOocPrefix =
          !isDesignMode && info.sender === 'ai'
            ? _buildAdjacentOocPrefixHtml(originalIndex)
            : '';
        if (histMsg && histMsg.isError && histMsg.errorMeta) {
          try {
            contentEl.innerHTML = rebuildOocPrefix + _renderErrorBannerHTML(histMsg.errorMeta.error);
          } catch (_e) {
            contentEl.innerHTML = rebuildOocPrefix + formatMessageContent(info.text, info.uid);
          }
        } else {
          contentEl.innerHTML =
            isDesignMode && info.sender === 'user'
              ? _getDesignModeUserMessageSafeContent(info.text)
              : rebuildOocPrefix + formatMessageContent(info.text, info.uid);
        }
        if (isDesignMode) {
          renderDesignP1PanelIntoMessage(msgEl, histMsg);
          // 恢复框架预览
          if (histMsg?.frameworkReady && window.designService?.p1Output) {
            const isLatestFwReady = !chatHistory.slice(originalIndex + 1).some(m => m.frameworkReady);
            renderDesignP1FrameworkPreview(msgEl, isLatestFwReady);
          }
          if (histMsg?.consistencyFindings) {
            renderConsistencyFindingButtons(msgEl, histMsg.consistencyFindings);
          }
          if (histMsg?.inspectionFindings) {
            renderInspectionFindingButtons(msgEl, histMsg.inspectionFindings);
          }
          // D9: P3 diff panel 过期占位
          if (histMsg?._hasP3DiffPanel && window.PlanRenderer) {
            window.PlanRenderer.renderExpiredPlaceholder(contentEl);
          }
          // 卡牌审阅 panel 重建：仅当仍处于 review 状态、且消息标记的 stage 与当前 review stage 一致时重新挂载
          if (
            histMsg?._isReviewPanelMessage &&
            window.designService &&
            window.designService.p2ReviewStage != null &&
            (histMsg._reviewStage == null ||
              histMsg._reviewStage === window.designService.p2ReviewStage) &&
            typeof window.designService.renderStageReviewPanel === 'function'
          ) {
            try {
              window.designService.renderStageReviewPanel(
                window.designService.p2ReviewStage,
                msgEl
              );
            } catch (e) {
              console.warn('[DesignMode] re-render review panel failed:', e);
            }
          }
        }
      }

      // 以下游戏特有的渲染在世界卡下跳过
      if (isDesignMode) return;

      // 重建 ReAct 交错显示区域（工具组 + 叙事段落按迭代顺序交替）
      if (info.sender === 'ai' && typeof streamVisualizer !== 'undefined') {
        const rebuildHistMsg = chatHistory[originalIndex];
        const segments = rebuildHistMsg?.reactSegments || [];
        const hasFc = info.functionCalls?.length > 0;
        if (hasFc || segments.length > 0) {
          // 优先从 msg.gameData 恢复状态栏和选项（ReAct 纯文本路径），
          // 兜底从 formatMessageContent 的输出里抽出（老的 JSON-in-text 路径）
          let statusHtml = null;
          let choicesHtml = null;
          const gd = rebuildHistMsg?.gameData;
          if (gd && typeof gd === 'object' && typeof gameOutputRenderer !== 'undefined') {
            if (gd.panel_status && typeof gd.panel_status === 'object') {
              const fieldDefs = gameOutputRenderer.resolveCustomStatusFieldDefs
                ? gameOutputRenderer.resolveCustomStatusFieldDefs(gd.panel_status)
                : (window.worldMeta?.getStep3Fields?.()?.panel_status || []);
              const editable = gameOutputRenderer.isLatestTurn
                ? gameOutputRenderer.isLatestTurn(info.uid)
                : false;
              statusHtml = gameOutputRenderer.renderCustomStatus(gd.panel_status, fieldDefs, editable);
            }
            if (Array.isArray(gd.choices) && gd.choices.length > 0) {
              choicesHtml = gameOutputRenderer.renderChoices(gd.choices);
            }
          }

          // 兜底：从 DOM 抠出已渲染的 .game-status / .game-choices（legacy JSON-in-text）
          const renderedStatus = statusHtml ? null : contentEl.querySelector('.game-status');
          const renderedChoices = choicesHtml ? null : contentEl.querySelector('.game-choices');
          if (renderedStatus) renderedStatus.remove();
          if (renderedChoices) renderedChoices.remove();

          // 创建 .game-output 包装结构（修复既有 bug：rebuild 时缺少此结构）
          const gameOutput = document.createElement('div');
          gameOutput.className = 'game-output';

          const interleavedEl = document.createElement('div');
          interleavedEl.className = 'react-interleaved';
          interleavedEl.dataset.slot = 'reactInterleaved';
          gameOutput.appendChild(interleavedEl);

          // 创建叙事容器（用于无 reactSegments 的旧数据回退）
          const narrativeEl = document.createElement('div');
          narrativeEl.className = 'game-narrative';
          gameOutput.appendChild(narrativeEl);

          // 将剩余内容（叙事等）移入 narrativeEl，但 OOC prefix 气泡留在 contentEl 顶部，
          // 否则 reactSegments 含 narrative 时 narrativeEl 会被 display:none 一起隐藏（OOC 跟着丢）
          let nextChild = contentEl.firstChild;
          while (nextChild) {
            const cur = nextChild;
            nextChild = cur.nextSibling;
            if (cur.nodeType === 1 && cur.classList && cur.classList.contains('ooc-qa-bubble')) {
              continue;
            }
            narrativeEl.appendChild(cur);
          }

          // 与直播结构一致的状态栏槽位
          if (statusHtml || renderedStatus) {
            const statusSlot = document.createElement('div');
            statusSlot.className = 'stream-slot filled';
            statusSlot.dataset.slot = 'status';
            if (statusHtml) {
              statusSlot.innerHTML = statusHtml;
            } else {
              statusSlot.appendChild(renderedStatus);
            }
            gameOutput.appendChild(statusSlot);
          }

          // 与直播结构一致的选项槽位
          if (choicesHtml || renderedChoices) {
            const choicesSlot = document.createElement('div');
            choicesSlot.className = 'stream-slot filled';
            choicesSlot.dataset.slot = 'choices';
            if (choicesHtml) {
              choicesSlot.innerHTML = choicesHtml;
            } else {
              choicesSlot.appendChild(renderedChoices);
            }
            gameOutput.appendChild(choicesSlot);
          }

          contentEl.appendChild(gameOutput);

          // 重建交错结构
          const rebuilt = streamVisualizer._rebuildInterleavedTrace(
            interleavedEl, info.functionCalls, segments
          );
          if (rebuilt) {
            // 只有当交错区域包含叙事段落时才隐藏单块叙事
            const hasNarrativeSegments = interleavedEl.querySelector('[data-segment-type="narrative"]');
            if (hasNarrativeSegments) {
              narrativeEl.style.display = 'none';
            }
            // 旧存档无 narrative 段落 → narrativeEl 保持显示（内容来自 msg.text）
          }
        }
      }

      // 渲染时间指标（使用 streamVisualizer 的公共函数）
      if (info.metrics && typeof streamVisualizer !== 'undefined') {
        const placeholder = msgEl.querySelector('.metrics-placeholder');
        if (placeholder && !placeholder.querySelector('.metrics-bar')) {
          const metricsHtml = streamVisualizer.renderMetricsBar(info.metrics);
          if (metricsHtml) {
            placeholder.innerHTML = metricsHtml;
            streamVisualizer.bindMetricsEvents(placeholder);
          }
        }
      }
    });

    // Quick-start buttons: inject below opening greeting when applicable
    if (shouldShowQuickStartButtons()) {
      const firstMsg = chatMessagesArea.querySelector('.chat-message.ai-message');
      if (firstMsg) {
        const contentEl = firstMsg.querySelector('.chat-message-content');
        if (contentEl && !contentEl.querySelector('.quick-start-buttons-container')) {
          contentEl.insertAdjacentHTML('beforeend', renderQuickStartButtonsHtml());
        }
      }
    }
    if (shouldShowDesignQuickStartButtons()) {
      const firstMsg = chatMessagesArea.querySelector('.chat-message.ai-message');
      if (firstMsg) {
        const contentEl = firstMsg.querySelector('.chat-message-content');
        if (contentEl && !contentEl.querySelector('.quick-start-buttons-container')) {
          contentEl.insertAdjacentHTML('beforeend', renderDesignQuickStartButtonsHtml());
        }
      }
    }

    // 刷新置顶状态栏观测器
    refreshStickyStatusObserver();

    // 恢复显示和滚动
    if (chatMessagesArea) {
      restoreScrollPosition();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          restoreScrollPosition();
          chatMessagesArea.style.visibility = '';
        });
      });
    }
  }, 10);
}
window.refreshChatUI = refreshChatUI;
window.flushPendingChatRefresh = flushPendingChatRefresh;

// 创建折叠条
// startTurn/endTurn: turn 范围(从 0 开始)
// turnCount: 折叠的 turn 数
function createFoldBar(groupIndex, startTurn, endTurn, turnCount) {
  const foldBar = document.createElement('div');
  foldBar.className = 'chat-fold-bar';
  foldBar.dataset.groupIndex = groupIndex;
  foldBar.innerHTML = `
        <span class="fold-icon">📂</span>
        <span class="fold-text">Turn ${startTurn} - ${endTurn - 1}(共 ${turnCount} 回合，点击展开)</span>
    `;
  foldBar.addEventListener('click', () => expandFoldedGroup(groupIndex));
  return foldBar;
}

// 添加消息到界面(带原始索引)
function addMessageWithIndex(text, senderName, senderType, originalIndex, options = {}) {
  if (!chatMessagesArea) return null;

  const msgEl = document.createElement('div');
  const designCls = isDesignMode ? ' design-mode-msg' : '';
  const safeSenderName = escapeHTML(senderName ?? '');
  msgEl.className = `chat-message ${senderType === 'user' ? 'user-message' : 'ai-message'}${designCls}`;
  msgEl.dataset.originalIndex = originalIndex;

  // OOC Q&A 元消息：不再独立渲染——会被下一条 AI 消息合并到气泡头部
  if (options?.message?.meta === 'ooc_qa') return null;

  // XSS 防护：首次插入即使用安全 HTML，不依赖事后 setTimeout 覆盖
  const rawSafeContent =
    senderType === 'user'
      ? isDesignMode
        ? _getDesignModeUserMessageSafeContent(text)
        : window.htmlSecurity
          ? window.htmlSecurity.plainTextToSafeHtml(text)
          : escapeHTML(text).replace(/\n/g, '<br>')
      : formatMessageContent(text);
  const safeContent =
    senderType === 'user' && !isDesignMode
      ? highlightOocCandidates(
          rawSafeContent,
          window.i18nService?.getResolvedLanguage?.() || 'zh-CN'
        )
      : rawSafeContent;

  // AI 气泡：把当前 turn 内的 OOC q&a 拼到 content 头部
  const oocPrefixHtml = senderType !== 'user' ? _buildAdjacentOocPrefixHtml(originalIndex) : '';

  msgEl.innerHTML = `
        <div class="chat-user-label">${safeSenderName}</div>
        <div class="chat-message-content">${oocPrefixHtml}${safeContent}</div>
    `;

  if (senderType === 'user') {
    applyUserTurnLabel(msgEl, originalIndex);
  }

  // 主聊天 AI 气泡：把 UID 渲染成 label 行右侧的悬浮徽章（与 metrics 一致的交互模式）
  if (senderType !== 'user' && !isDesignMode && options?.uid && typeof streamVisualizer !== 'undefined') {
    const labelEl = msgEl.querySelector('.chat-user-label');
    if (labelEl) streamVisualizer.appendTurnUidBadge(labelEl, options.uid);
  }

  if (senderType !== 'user' && typeof options?.message?.ooc?.normalized === 'string' && options.message.ooc.normalized) {
    msgEl.dataset.ooc = '1';
    msgEl.title = `OOC: ${options.message.ooc.normalized}`;
  }

  if (isDesignMode && senderType !== 'user') {
    const histMsg =
      options.message ||
      (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory)
        ? chatHistory[originalIndex]
        : null);
    renderDesignP1PanelIntoMessage(msgEl, histMsg);
    // 恢复框架预览
    if (histMsg?.frameworkReady && window.designService?.p1Output) {
      const laterHasReady = Array.isArray(chatHistory) && chatHistory.slice(originalIndex + 1).some(m => m.frameworkReady);
      renderDesignP1FrameworkPreview(msgEl, !laterHasReady);
    }
  }

  if (senderType !== 'user') {
    let resolvedProviderKey = normalizeProviderKey(options.providerKey);
    if (!resolvedProviderKey) {
      if (isDesignMode) {
        resolvedProviderKey = resolveDesignProviderKey(options.message || null);
      } else {
        const sender = typeof senderName === 'string' ? senderName : '';
        const isDesignAssistant = sender.includes('设计助手');
        if (!isDesignAssistant) {
          resolvedProviderKey = resolveReactProviderKey(
            null,
            options.metrics || null,
            options.modelLabel || senderName
          );
        }
      }
    }
    applyAiProviderDataset(msgEl, resolvedProviderKey);
  }

  chatMessagesArea.appendChild(msgEl);
  return msgEl;
}

// 展开折叠组
function expandFoldedGroup(groupIndex) {
  // 确保 chatMessagesArea 存在
  if (!chatMessagesArea) {
    chatMessagesArea = document.querySelector('.chat-messages-area');
  }
  if (!chatMessagesArea) {
    console.warn('[expandFoldedGroup] chatMessagesArea not found');
    return;
  }

  // 找到折叠组数据
  const group = foldedGroups.find(g => g.groupIndex === groupIndex);
  if (!group) {
    console.warn(`Fold group ${groupIndex} not found`);
    return;
  }

  // 找到折叠条 DOM 元素
  const foldBar = chatMessagesArea.querySelector(
    `.chat-fold-bar[data-group-index="${groupIndex}"]`
  );
  if (!foldBar) {
    console.warn(`Fold bar for group ${groupIndex} not found`);
    return;
  }

  // 创建展开容器(包含收起按键)
  const expandedContainer = document.createElement('div');
  expandedContainer.className = 'chat-expanded-group';
  expandedContainer.dataset.groupIndex = groupIndex;

  // 添加收起按键(顶部)
  const collapseBar = document.createElement('div');
  collapseBar.className = 'chat-collapse-bar';
  const turnCount = group.endTurn - group.startTurn;
  collapseBar.innerHTML = `
        <span class="collapse-icon">📁</span>
        <span class="collapse-text">收起 Turn ${group.startTurn} - ${group.endTurn - 1}(共 ${turnCount} 回合)</span>
    `;
  collapseBar.addEventListener('click', () => collapseFoldedGroup(groupIndex));
  expandedContainer.appendChild(collapseBar);

  const newMessageEls = [];

  // 为每条消息创建 DOM 元素
  group.messages.forEach(info => {
    const msgEl = document.createElement('div');
    msgEl.className = `chat-message ${info.sender === 'user' ? 'user-message' : 'ai-message'} expanded-message`;
    msgEl.dataset.originalIndex = info.originalIndex;

    // OOC Q&A 元消息：走专用气泡，短路普通渲染
    const histMsgForExpand = Array.isArray(chatHistory) ? chatHistory[info.originalIndex] : null;
    if (histMsgForExpand?.meta === 'ooc_qa') {
      _applyOocQaBubble(msgEl, histMsgForExpand);
      expandedContainer.appendChild(msgEl);
      newMessageEls.push(msgEl);
      return;
    }

    const safeLabel = escapeHTML(info.name ?? '');

    // XSS 防护：首次插入即使用安全 HTML
    const rawSafeContent =
      info.sender === 'user'
        ? isDesignMode
          ? _getDesignModeUserMessageSafeContent(info.text)
          : window.htmlSecurity
            ? window.htmlSecurity.plainTextToSafeHtml(info.text)
            : escapeHTML(info.text).replace(/\n/g, '<br>')
        : formatMessageContent(info.text);
    const safeContent =
      info.sender === 'user' && !isDesignMode
        ? highlightOocCandidates(
            rawSafeContent,
            window.i18nService?.getResolvedLanguage?.() || 'zh-CN'
          )
        : rawSafeContent;

    msgEl.innerHTML = `
            <div class="chat-user-label">${safeLabel}</div>
            <div class="chat-message-content">${safeContent}</div>
        `;
    if (info.sender === 'user') {
      applyUserTurnLabel(msgEl, info.originalIndex);
    }
    if (info.sender === 'ai') {
      applyAiProviderDataset(msgEl, info.providerKey);
      if (!isDesignMode && info.uid && typeof streamVisualizer !== 'undefined') {
        const labelEl = msgEl.querySelector('.chat-user-label');
        if (labelEl) streamVisualizer.appendTurnUidBadge(labelEl, info.uid);
      }
    }
    expandedContainer.appendChild(msgEl);
    newMessageEls.push(msgEl);
  });

  // 在折叠条位置插入展开容器
  foldBar.replaceWith(expandedContainer);

  // 注意:不从 foldedGroups 中移除该组，以便可以收起

  // 延迟处理新消息(增强显示、格式化内容、绑定事件)
  setTimeout(() => {
    newMessageEls.forEach(msgEl => {
      const originalIndex = parseInt(msgEl.dataset.originalIndex, 10);
      const info = group.messages.find(m => m.originalIndex === originalIndex);
      if (!info) return;

      // 添加 footer
      const contentEl = msgEl.querySelector('.chat-message-content');
      if (contentEl && !msgEl.querySelector('.message-footer')) {
        const actionsHtml = renderMessageActionsHtml(originalIndex);
        const footerHtml = `
                    <div class="message-footer">
                        <div class="metrics-placeholder"></div>
                        ${actionsHtml}
                    </div>
                `;
        contentEl.insertAdjacentHTML('afterend', footerHtml);
      }

      // 格式化内容
      if (contentEl) {
        contentEl.innerHTML =
          isDesignMode && info.sender === 'user'
            ? _getDesignModeUserMessageSafeContent(info.text)
            : formatMessageContent(info.text, info.uid);
        if (isDesignMode) {
          renderDesignP1PanelIntoMessage(msgEl, chatHistory[originalIndex]);
        }
      }

      if (isDesignMode) return;

      // 渲染 NPC 角色动态区块（叙事下方玩家可见）
      if (info.npcReactions && contentEl) {
        const entries = Object.entries(info.npcReactions);
        const hasDecisions = entries.some(([, r]) => r.decision);
        if (hasDecisions && typeof streamVisualizer !== 'undefined') {
          const reactionsArr = entries.map(([npcId, r]) => ({ npcId, ...r }));
          let actionsSlot = contentEl.querySelector('[data-slot="npcActions"]');
          if (!actionsSlot) {
            actionsSlot = document.createElement('div');
            actionsSlot.className = 'npc-actions-slot';
            actionsSlot.dataset.slot = 'npcActions';
            contentEl.appendChild(actionsSlot);
          }
          streamVisualizer._fillNpcActionsSection(actionsSlot, reactionsArr);
          actionsSlot.style.display = '';
        }
      }

      // 重建 ReAct 交错显示区域（工具组 + 叙事段落按迭代顺序交替）
      if (info.sender === 'ai' && typeof streamVisualizer !== 'undefined') {
        const rebuildHistMsg = chatHistory[originalIndex];
        const segments = rebuildHistMsg?.reactSegments || [];
        const hasFc = info.functionCalls?.length > 0;
        if (hasFc || segments.length > 0) {
          // 创建 .game-output 包装结构（修复既有 bug：rebuild 时缺少此结构）
          const gameOutput = document.createElement('div');
          gameOutput.className = 'game-output';

          const interleavedEl = document.createElement('div');
          interleavedEl.className = 'react-interleaved';
          interleavedEl.dataset.slot = 'reactInterleaved';
          gameOutput.appendChild(interleavedEl);

          // 创建叙事容器（用于无 reactSegments 的旧数据回退）
          const narrativeEl = document.createElement('div');
          narrativeEl.className = 'game-narrative';
          gameOutput.appendChild(narrativeEl);

          // 将现有内容移入 narrativeEl
          while (contentEl.firstChild) {
            narrativeEl.appendChild(contentEl.firstChild);
          }
          contentEl.appendChild(gameOutput);

          // 重建交错结构
          const rebuilt = streamVisualizer._rebuildInterleavedTrace(
            interleavedEl, info.functionCalls, segments
          );
          if (rebuilt) {
            const hasNarrativeSegments = interleavedEl.querySelector('[data-segment-type="narrative"]');
            if (hasNarrativeSegments) {
              narrativeEl.style.display = 'none';
            }
          }
        }
      }

      // 渲染时间指标（使用 streamVisualizer 的公共函数）
      if (info.metrics && typeof streamVisualizer !== 'undefined') {
        const placeholder = msgEl.querySelector('.metrics-placeholder');
        if (placeholder && !placeholder.querySelector('.metrics-bar')) {
          const metricsHtml = streamVisualizer.renderMetricsBar(info.metrics);
          if (metricsHtml) {
            placeholder.innerHTML = metricsHtml;
            streamVisualizer.bindMetricsEvents(placeholder);
          }
        }
      }
    });

    // 重新绑定事件
    bindMessageActionEvents();

    // 观测展开后新出现的 AI 消息
    newMessageEls.forEach(el => {
      if (el.classList.contains('ai-message')) {
        el._stickyObserved = false;
        observeAIMessage(el);
      }
    });

    // 添加展开动画效果
    newMessageEls.forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, i * 20); // 错开动画
    });
  }, 10);
}
window.expandFoldedGroup = expandFoldedGroup;

// 收起已展开的折叠组
function collapseFoldedGroup(groupIndex) {
  // 确保 chatMessagesArea 存在
  if (!chatMessagesArea) {
    chatMessagesArea = document.querySelector('.chat-messages-area');
  }
  if (!chatMessagesArea) return;

  // 找到折叠组数据
  const group = foldedGroups.find(g => g.groupIndex === groupIndex);
  if (!group) {
    console.warn(`Fold group ${groupIndex} not found for collapse`);
    return;
  }

  // 找到展开容器
  const expandedContainer = chatMessagesArea.querySelector(
    `.chat-expanded-group[data-group-index="${groupIndex}"]`
  );
  if (!expandedContainer) {
    console.warn(`Expanded container for group ${groupIndex} not found`);
    return;
  }

  // 创建折叠条替换展开容器
  const turnCount = group.endTurn - group.startTurn;
  const foldBar = createFoldBar(groupIndex, group.startTurn, group.endTurn, turnCount);
  expandedContainer.replaceWith(foldBar);

  // 从观测集合中移除已折叠的消息
  if (stickyStatusBar.observer) {
    const removedEls = expandedContainer.querySelectorAll('.ai-message');
    removedEls.forEach(el => {
      const idx = parseInt(el.dataset.originalIndex, 10);
      if (!isNaN(idx)) stickyStatusBar.visibleAIMessages.delete(idx);
      stickyStatusBar.observer.unobserve(el);
    });
    updateStickyStatusDisplay();
  }
}
window.collapseFoldedGroup = collapseFoldedGroup;

// ============================================
// 置顶状态栏 (Sticky Status Bar)
// ============================================

const stickyStatusBar = {
  element: null,
  badgeEl: null,
  compactItemsEl: null,
  fullItemsEl: null,
  popoverEl: null,
  moreEl: null,
  observer: null,
  visibleAIMessages: new Set(), // 当前视口内可见的 AI 消息 originalIndex 集合
  statusCache: new Map(), // originalIndex -> panel_status (解析缓存)
  currentOriginalIndex: -1, // 当前显示的 Turn 的 originalIndex
  expanded: false,
  _outsideHandler: null,
  _scrollHandler: null,
};

function extractStatusFromHistory(originalIndex) {
  if (stickyStatusBar.statusCache.has(originalIndex)) {
    return stickyStatusBar.statusCache.get(originalIndex);
  }
  if (typeof chatHistory === 'undefined' || !chatHistory[originalIndex]) return null;
  const msg = chatHistory[originalIndex];
  if (msg.sender !== 'ai') return null;
  // 优先从持久化的 gameData 读取，兜底解析 legacy JSON
  let status = msg.gameData?.panel_status || null;
  if (!status) {
    try {
      const jsonMatch = msg.text && msg.text.match(/```json\s*([\s\S]*?)\s*```/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[1]);
        status = data.panel_status || null;
      }
    } catch (_error) {
      status = null;
    }
  }
  stickyStatusBar.statusCache.set(originalIndex, status);
  return status;
}

function inferStickyStatusFieldDefs(status) {
  if (!status || typeof status !== 'object') return [];
  const defs = [];

  for (const [groupKey, data] of Object.entries(status)) {
    if (groupKey === 'move_to') continue;
    if (data === null || data === undefined) continue;

    if (Array.isArray(data)) {
      const objectItems = data.filter(
        item => item && typeof item === 'object' && !Array.isArray(item)
      );
      let fields = [];
      if (objectItems.length > 0) {
        const fieldMap = new Map();
        for (const item of objectItems) {
          for (const [key, value] of Object.entries(item)) {
            const inferredType = typeof value === 'number' ? 'integer' : 'string';
            if (!fieldMap.has(key)) {
              fieldMap.set(key, { key, label: key, type: inferredType });
            } else if (fieldMap.get(key).type === 'integer' && inferredType !== 'integer') {
              fieldMap.get(key).type = 'string';
            }
          }
        }
        fields = Array.from(fieldMap.values());
      } else {
        // 非对象数组：兜底为单字段 value，确保内容可见
        fields = [{ key: 'value', label: 'value', type: 'string' }];
      }
      defs.push({ key: groupKey, label: groupKey, icon: '📋', type: 'array', fields });
      continue;
    }

    if (typeof data === 'object') {
      const fields = Object.keys(data).map(key => ({
        key,
        label: key,
        type: typeof data[key] === 'number' ? 'integer' : 'string',
      }));
      defs.push({ key: groupKey, label: groupKey, icon: '📋', fields });
    }
  }

  return defs;
}

function resolveStickyStatusFieldDefs(status) {
  const runtimeFields = window.worldMeta?.getStep3Fields?.()?.panel_status;
  if (Array.isArray(runtimeFields) && runtimeFields.length > 0) return runtimeFields;

  const inferred = inferStickyStatusFieldDefs(status);
  if (inferred.length > 0) return inferred;

  const locale = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? 'en' : 'zh-CN';
  const defaultFields =
    window.step3SchemaBuilder?.getDefaultStatusFields?.(locale) ||
    window.step3SchemaBuilder?.DEFAULT_STATUS_FIELDS;
  if (Array.isArray(defaultFields) && defaultFields.length > 0) return defaultFields;

  return [];
}

function renderStickyStatusHTML(status) {
  if (!status) return { compactHtml: '', fullHtml: '', hiddenCount: 0 };
  const e = v => {
    const d = document.createElement('div');
    d.textContent = String(v ?? '');
    return d.innerHTML;
  };
  const fieldDefs = resolveStickyStatusFieldDefs(status);
  return renderStickyStatusCustom(status, fieldDefs, e);
}

const STICKY_CORE_STATUS_GROUP_KEYS = new Set([
  'datetime',
  'location',
  'money',
  'objective',
  'player_state',
  'move_to',
]);

function isStickyCustomStatusGroup(group) {
  if (!group || typeof group !== 'object') return false;
  if (group._template === 'custom') return true;
  return !STICKY_CORE_STATUS_GROUP_KEYS.has(group.key);
}

function getStickyStatusGroupLabel(group) {
  if (typeof group?.label === 'string' && group.label.trim()) return group.label.trim();
  if (typeof group?.key === 'string' && group.key.trim()) return group.key.trim();
  return '自定义';
}

function getStickyStatusFieldLabel(field) {
  if (typeof field?.label === 'string' && field.label.trim()) return field.label.trim();
  if (typeof field?.key === 'string' && field.key.trim()) return field.key.trim();
  return '';
}

function getStickyFieldsForObjectGroup(group, data) {
  if (Array.isArray(group?.fields) && group.fields.length > 0) return group.fields;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.keys(data).map(key => ({
    key,
    label: key,
    type: typeof data[key] === 'number' ? 'integer' : 'string',
  }));
}

function getStickyFieldsForArrayGroup(group, item) {
  if (Array.isArray(group?.fields) && group.fields.length > 0) return group.fields;
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.keys(item).map(key => ({
      key,
      label: key,
      type: typeof item[key] === 'number' ? 'integer' : 'string',
    }));
  }
  return [{ key: 'value', label: 'value', type: 'string' }];
}

/**
 * 自定义世界的置顶状态栏渲染（根据字段定义动态渲染）
 * 返回 { compactHtml, fullHtml, hiddenCount }：
 * - compactHtml：折叠行只显示 datetime/location/money（必要时取前 2 个组兜底）
 * - fullHtml：浮层显示全部 items
 * - hiddenCount：仅在浮层、未在 compact 中显示的 item 数
 */
function renderStickyStatusCustom(status, fieldDefs, e) {
  const compactBuf = [];
  const fullBuf = [];
  let totalItems = 0;
  let compactItems = 0;

  // 检测是否存在「天然 key 字段」组（datetime / location / money / player_state.money）
  // 物品栏货币 > 0 时也算 key field，触发 compact 主行渲染
  const inventoryHasMoney =
    typeof window !== 'undefined' &&
    window.inventoryStore?.getMoney &&
    window.inventoryStore.getMoney() > 0;
  const hasKeyField =
    inventoryHasMoney ||
    fieldDefs.some(g => {
      if (g._template === 'move_to') return false;
      if (g.key === 'datetime' || g.key === 'location') return true;
      if (g.key === 'money' || g._template === 'money') return true;
      if (g.key === 'player_state') {
        const ps = status?.[g.key];
        if (ps && ps.money !== null && ps.money !== undefined) return true;
      }
      return false;
    });
  let fallbackQuota = hasKeyField ? 0 : 2;

  // 输出一个 item HTML，并按规则归入 compact/full
  const emit = (html, classification) => {
    totalItems++;
    fullBuf.push(html);
    let goCompact = false;
    if (classification === 'compact') {
      goCompact = true;
    } else if (classification === 'objective') {
      goCompact = false;
    } else if (classification === 'fallback' && fallbackQuota > 0) {
      goCompact = true;
      fallbackQuota--;
    }
    if (goCompact) {
      compactBuf.push(html);
      compactItems++;
    }
  };

  const currencyTerms = window.worldMeta?.getActiveCurrencyTerms?.() || {};
  const currencyShort = currencyTerms.currencyShort || currencyTerms.currencyLabel || '';

  // 独立注入货币 tile（不依赖 fieldDefs 中的 money group——货币已迁移到 inventoryStore）
  // 注入位置：在 datetime / location 之后，紧邻其它信息
  let moneyTileEmitted = false;
  const emitMoneyTile = () => {
    if (moneyTileEmitted) return;
    const liveMoney = window.inventoryStore?.getMoney?.();
    if (typeof liveMoney === 'number' && liveMoney !== 0) {
      const moneyHtml = `<div class="status-item custom-status-money"><span class="status-icon">💰</span><span class="status-value">${e(liveMoney)}${currencyShort ? ' ' + e(currencyShort) : ''}</span></div>`;
      emit(moneyHtml, 'compact');
    }
    moneyTileEmitted = true;
  };

  for (const group of fieldDefs) {
    const data = status[group.key];
    if (data === null || data === undefined) continue;
    const icon = group.icon || '📋';
    const groupClass = e(group.key);

    if (group._template === 'move_to') continue;

    if (group.type === 'array' && Array.isArray(data)) {
      data.forEach(item => {
        const isCustomGroup = isStickyCustomStatusGroup(group);
        const fields = getStickyFieldsForArrayGroup(group, item);
        const parts = [];

        for (const field of fields) {
          const value =
            item && typeof item === 'object' && !Array.isArray(item)
              ? item[field.key]
              : field.key === 'value'
                ? item
                : undefined;
          if (value === null || value === undefined || value === '') continue;

          if (isCustomGroup && field.key !== 'value') {
            const fieldLabel = getStickyStatusFieldLabel(field);
            if (fieldLabel) parts.push(`${e(fieldLabel)} ${e(value)}`);
            else parts.push(e(value));
          } else {
            parts.push(e(value));
          }
        }

        if (parts.length > 0) {
          let text = parts.join(isCustomGroup ? ' / ' : ' ');
          if (isCustomGroup) {
            text = `${e(getStickyStatusGroupLabel(group))}: ${text}`;
          }
          const html = `<div class="status-item custom-status-${groupClass}"><span class="status-icon">${icon}</span><span class="status-value">${text}</span></div>`;
          emit(html, 'fallback');
        }
      });
    } else if (typeof data === 'object') {
      const isCustomGroup = isStickyCustomStatusGroup(group);

      // 时间组：使用 formatTimeValueFromGroup 统一格式化
      const timeText = window.step3SchemaBuilder?.formatTimeValueFromGroup?.(data, group);
      if (timeText) {
        const html = `<div class="status-item custom-status-${groupClass}"><span class="status-icon">${icon}</span><span class="status-value">${e(timeText)}</span></div>`;
        emit(html, group.key === 'datetime' ? 'compact' : 'fallback');
        continue;
      }

      // 地点组：使用 · 分隔符，跳过 country 字段（状态栏空间有限）
      if (group.key === 'location') {
        const locParts = (group.fields || [])
          .filter(f => f.key !== 'country')
          .map(f => data[f.key])
          .filter(v => v !== null && v !== undefined && v !== '')
          .map(e);
        if (locParts.length > 0) {
          const html = `<div class="status-item custom-status-${groupClass}"><span class="status-icon">${icon}</span><span class="status-value">${locParts.join('<span class="location-separator"> · </span>')}</span></div>`;
          emit(html, 'compact');
        }
        // 紧跟地点之后注入货币 tile（独立于 fieldDefs，从 inventoryStore 派生）
        emitMoneyTile();
        continue;
      }

      // 货币组：使用货币短形式紧凑显示
      const currency = window.step3SchemaBuilder?.getCurrencyLabelFromGroup?.(group) || '';
      const displayCurrency =
        typeof group._currencyShort === 'string' && group._currencyShort.trim()
          ? group._currencyShort.trim()
          : currencyShort || currency;

      if (group.key === 'player_state' && data.money !== null && data.money !== undefined) {
        // 货币优先使用 inventoryStore.getMoney() 实时值（玩家审批 update_item 后立即生效）
        const liveMoney = window.inventoryStore?.getMoney?.();
        const showMoney = typeof liveMoney === 'number' ? liveMoney : data.money;
        const moneyHtml = `<div class="status-item custom-status-money"><span class="status-icon">${icon}</span><span class="status-value">${e(showMoney)}${displayCurrency ? ' ' + e(displayCurrency) : ''}</span></div>`;
        emit(moneyHtml, 'compact');
        if (data.current_objective) {
          const objHtml = `<div class="status-item custom-status-objective"><span class="status-icon">🎯</span><span class="status-value">${e(data.current_objective)}</span></div>`;
          emit(objHtml, 'objective');
        }
        continue;
      }
      if (group._template === 'money' && data.amount !== null && data.amount !== undefined) {
        const liveMoney = window.inventoryStore?.getMoney?.();
        const showMoney = typeof liveMoney === 'number' ? liveMoney : data.amount;
        const html = `<div class="status-item custom-status-money"><span class="status-icon">${icon}</span><span class="status-value">${e(showMoney)}${displayCurrency ? ' ' + e(displayCurrency) : ''}</span></div>`;
        emit(html, 'compact');
        continue;
      }

      // 通用对象类型：列出所有子字段值
      const parts = [];
      const fields = getStickyFieldsForObjectGroup(group, data);
      for (const field of fields) {
        const value = data[field.key];
        if (value === null || value === undefined || value === '') continue;

        if (isCustomGroup && field.key !== 'value') {
          const fieldLabel = getStickyStatusFieldLabel(field);
          if (fieldLabel) parts.push(`${e(fieldLabel)} ${e(value)}`);
          else parts.push(e(value));
        } else {
          parts.push(e(value));
        }
      }

      if (parts.length > 0) {
        let text = parts.join(isCustomGroup ? ' / ' : ' ');
        if (isCustomGroup) {
          text = `${e(getStickyStatusGroupLabel(group))}: ${text}`;
        }
        const html = `<div class="status-item custom-status-${groupClass}"><span class="status-icon">${icon}</span><span class="status-value">${text}</span></div>`;
        const isObjectiveGroup = group.key === 'objective' || group._template === 'objective';
        emit(html, isObjectiveGroup ? 'objective' : 'fallback');
      }
    }
  }

  // 兜底：如果世界卡没有 location group，循环结束时再尝试注入货币 tile
  emitMoneyTile();

  return {
    compactHtml: compactBuf.join(''),
    fullHtml: fullBuf.join(''),
    hiddenCount: totalItems - compactItems,
  };
}

function getStickyTurnBadgeTextFromUID(originalIndex) {
  if (typeof chatHistory === 'undefined' || !chatHistory[originalIndex]) return 'T?';
  const msg = chatHistory[originalIndex];
  if (msg.sender !== 'ai' || typeof msg.uid !== 'string') return 'T?';
  if (typeof parseTurnFromUID !== 'function') return 'T?';

  const parsedTurn = parseTurnFromUID(msg.uid);
  if (!Number.isInteger(parsedTurn) || parsedTurn < 0) return 'T?';

  return `T${parsedTurn}`;
}

function updateStickyStatusDisplay() {
  const bar = stickyStatusBar.element;
  if (!bar) return;

  if (window.isDesignMode) {
    bar.classList.add('hidden');
    return;
  }

  if (stickyStatusBar.visibleAIMessages.size === 0) {
    const hasAnyAI = typeof chatHistory !== 'undefined' && chatHistory.some(m => m.sender === 'ai');
    if (!hasAnyAI) {
      bar.classList.add('hidden');
    }
    return; // 视口内无 AI 消息，保持上次显示不变
  }

  // 找出可见消息中 originalIndex 最小的（最靠顶部的 Turn）
  let topOriginalIndex = Infinity;
  stickyStatusBar.visibleAIMessages.forEach(idx => {
    if (idx < topOriginalIndex) topOriginalIndex = idx;
  });

  if (topOriginalIndex === stickyStatusBar.currentOriginalIndex) return; // 无变化
  stickyStatusBar.currentOriginalIndex = topOriginalIndex;

  if (stickyStatusBar.badgeEl) {
    stickyStatusBar.badgeEl.textContent = getStickyTurnBadgeTextFromUID(topOriginalIndex);
  }

  const status = extractStatusFromHistory(topOriginalIndex);
  const { compactHtml, fullHtml, hiddenCount } = renderStickyStatusHTML(status);
  if (stickyStatusBar.compactItemsEl) {
    stickyStatusBar.compactItemsEl.innerHTML = compactHtml;
  }
  if (stickyStatusBar.fullItemsEl) {
    stickyStatusBar.fullItemsEl.innerHTML = fullHtml;
  }
  if (stickyStatusBar.moreEl) {
    if (hiddenCount > 0) {
      stickyStatusBar.moreEl.textContent = `+${hiddenCount}`;
      stickyStatusBar.moreEl.classList.remove('hidden');
    } else {
      stickyStatusBar.moreEl.classList.add('hidden');
    }
  }

  bar.classList.remove('hidden');
}

function expandStickyStatusBar() {
  if (stickyStatusBar.expanded || !stickyStatusBar.element) return;
  stickyStatusBar.expanded = true;
  stickyStatusBar.element.classList.add('expanded');
  stickyStatusBar.element.setAttribute('aria-expanded', 'true');
  // 延迟到下一个 microtask 后再挂全局监听，避免触发 expand 的那次 click 立刻冒泡到 document 把它关掉
  queueMicrotask(() => {
    if (!stickyStatusBar.expanded) return;
    stickyStatusBar._outsideHandler = e => {
      if (!stickyStatusBar.element.contains(e.target)) collapseStickyStatusBar();
    };
    document.addEventListener('click', stickyStatusBar._outsideHandler);
    if (chatMessagesArea) {
      stickyStatusBar._scrollHandler = () => collapseStickyStatusBar();
      chatMessagesArea.addEventListener('scroll', stickyStatusBar._scrollHandler, {
        passive: true,
      });
    }
  });
}

function collapseStickyStatusBar() {
  if (!stickyStatusBar.expanded || !stickyStatusBar.element) return;
  stickyStatusBar.expanded = false;
  stickyStatusBar.element.classList.remove('expanded');
  stickyStatusBar.element.setAttribute('aria-expanded', 'false');
  if (stickyStatusBar._outsideHandler) {
    document.removeEventListener('click', stickyStatusBar._outsideHandler);
    stickyStatusBar._outsideHandler = null;
  }
  if (stickyStatusBar._scrollHandler && chatMessagesArea) {
    chatMessagesArea.removeEventListener('scroll', stickyStatusBar._scrollHandler);
    stickyStatusBar._scrollHandler = null;
  }
}

function toggleStickyStatusBar() {
  if (stickyStatusBar.expanded) collapseStickyStatusBar();
  else expandStickyStatusBar();
}

function observeAIMessage(msgEl) {
  if (!stickyStatusBar.observer || msgEl._stickyObserved) return;
  msgEl._stickyObserved = true;
  stickyStatusBar.observer.observe(msgEl);
}

function initStickyStatusBar() {
  stickyStatusBar.element = document.getElementById('sticky-status-bar');
  stickyStatusBar.badgeEl = document.querySelector('.sticky-turn-badge');
  stickyStatusBar.compactItemsEl = document.querySelector('.sticky-status-items-compact');
  stickyStatusBar.fullItemsEl = document.querySelector('.sticky-status-items-full');
  stickyStatusBar.popoverEl = document.getElementById('sticky-status-popover');
  stickyStatusBar.moreEl = document.querySelector('.sticky-status-more');
  if (!stickyStatusBar.element || !chatMessagesArea) return;

  // 整个 bar 是点击热区；浮层内部点击不触发 toggle
  stickyStatusBar.element.addEventListener('click', e => {
    if (e.target.closest('.sticky-status-popover')) return;
    toggleStickyStatusBar();
  });
  stickyStatusBar.element.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleStickyStatusBar();
    }
  });

  stickyStatusBar.observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        const msgEl = entry.target;
        if (!msgEl.classList.contains('ai-message')) return;
        if (msgEl.classList.contains('streaming-state')) return;
        const originalIndex = parseInt(msgEl.dataset.originalIndex, 10);
        if (isNaN(originalIndex)) return;
        if (entry.isIntersecting) {
          stickyStatusBar.visibleAIMessages.add(originalIndex);
        } else {
          stickyStatusBar.visibleAIMessages.delete(originalIndex);
        }
      });
      updateStickyStatusDisplay();
    },
    {
      root: chatMessagesArea,
      rootMargin: '-1px 0px 0px 0px',
      threshold: 0,
    }
  );

  if (window.eventBus && window.GameEvents) {
    window.eventBus.on(window.GameEvents.AI_FIRST_CONTENT_DISPLAY, () => {
      collapseStickyStatusBar();
      if (stickyStatusBar.element) stickyStatusBar.element.classList.add('streaming');
    });
    window.eventBus.on(window.GameEvents.AI_RESPONSE_COMPLETE, () => {
      if (stickyStatusBar.element) stickyStatusBar.element.classList.remove('streaming');
      // 清除最新 AI 消息的缓存，确保状态是最新的
      if (typeof chatHistory !== 'undefined') {
        for (let i = chatHistory.length - 1; i >= 0; i--) {
          if (chatHistory[i] && chatHistory[i].sender === 'ai') {
            stickyStatusBar.statusCache.delete(i);
            break;
          }
        }
      }
      setTimeout(() => {
        document
          .querySelectorAll('.chat-messages-area .ai-message')
          .forEach(el => observeAIMessage(el));
        stickyStatusBar.currentOriginalIndex = -1;
        updateStickyStatusDisplay();
      }, 50);
    });
    window.eventBus.on(window.GameEvents.AI_ERROR, () => {
      if (stickyStatusBar.element) stickyStatusBar.element.classList.remove('streaming');
    });
  }
  console.log('[StickyStatus] 置顶状态栏已初始化');
}

function refreshStickyStatusObserver() {
  if (!stickyStatusBar.observer) return;
  stickyStatusBar.observer.disconnect();
  stickyStatusBar.visibleAIMessages.clear();
  stickyStatusBar.statusCache.clear();
  stickyStatusBar.currentOriginalIndex = -1;
  document.querySelectorAll('.chat-messages-area .ai-message').forEach(el => {
    el._stickyObserved = false;
    observeAIMessage(el);
  });
}

window.invalidateLatestStickyStatusCache = function () {
  if (typeof chatHistory === 'undefined') return;
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i]?.sender === 'ai') {
      stickyStatusBar.statusCache.delete(i);
      break;
    }
  }
  stickyStatusBar.currentOriginalIndex = -1;
  updateStickyStatusDisplay();
};

// 给 streamVisualizer 等外部模块用：把 chatHistory 末尾连续 OOC question 注入流式气泡
window._buildAdjacentOocPrefixHtml = _buildAdjacentOocPrefixHtml;

// 页面加载时初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initChatSystem);
} else {
  queueMicrotask(initChatSystem);
}
