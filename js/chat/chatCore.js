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

// 存档时间线（每存档内嵌）· v2「自由跳转池」：每回合提交后压一个【自包含】回合末快照进池——最近 5 个
// 自动点（按【保存时间】滚动）+ 永久手动钉点（≤3）。读取/载入【永不删】快照；删除/重生只移走被退掉那一条。
// 每个快照 = { turn(显示标签), kind, name?, savedAt, chatUid(身份), stores:<16 store 深拷贝>, history:<自包含聊天记录> }。
// 身份是 chatUid（回退后 turn 会重复，不能再当唯一键）；某点还原 = restoreAll(stores) + 把游戏历史设为
// snap.history（不依赖 live 历史里还有那个 uid）。不注册成 store（否则 collectSaveData 会把池套进新快照 → 嵌套爆炸）。
// 环纯逻辑统一委托 js/utils/snapshotRing.js（window.SnapshotRing，先于本文件加载）。
const AUTO_SNAPSHOT_CAP = 5;
const MANUAL_PIN_CAP = 3;
let _snapshotRing = [];
function getSnapshotRing() {
  return _snapshotRing;
}
function setSnapshotRing(ring) {
  _snapshotRing = Array.isArray(ring) ? ring : [];
}
// design(世界卡)模式下全局 chatHistory 被别名成 designChatHistory、真游戏历史在 window._gameChatHistory
// （见 game.js mode-toggle / sessionManager._getGameHistoryForSave）。所有"游戏历史"读取统一走这里——
// 存档台是 design-mode stage，直接读 chatHistory 会误读设计对话。
function _gameHistoryRef() {
  if (typeof isDesignMode !== 'undefined' && isDesignMode) {
    return Array.isArray(window._gameChatHistory) ? window._gameChatHistory : [];
  }
  return Array.isArray(chatHistory) ? chatHistory : [];
}
// 当前所在位置 = 游戏历史里最后一条已提交 AI 消息的 chatUid（"当前点"）。开局/无 → null。
function currentTurnChatUid() {
  return window.SnapshotRing ? window.SnapshotRing.lastCommittedAiUid(_gameHistoryRef()) : null;
}
// 删/重生某回合（chatUid）的回退基 = 它【上一条已提交 AI 消息】对应的快照（按游戏历史定位，不靠 turn）。无→null。
function getPrevAiSnapshot(chatUid) {
  return window.SnapshotRing
    ? window.SnapshotRing.prevAiSnapshot(_snapshotRing, _gameHistoryRef(), chatUid)
    : null;
}
// 按 chatUid 精确取一个快照。
function getSnapshotByChatUid(chatUid) {
  return window.SnapshotRing ? window.SnapshotRing.byChatUid(_snapshotRing, chatUid) : null;
}
// 精确移走池里一条快照（删除/重生「只删被退掉那一个」用；非破坏性，只动这一条）。
function removeRingByChatUid(chatUid) {
  if (!window.SnapshotRing || !chatUid) return;
  _snapshotRing = window.SnapshotRing.removeByChatUid(_snapshotRing, chatUid);
}
// 回合末压【自包含】快照：clone 全部 store + 当前回合为止的【游戏历史】切片；同 chatUid 就地替换（复核 re-push
// 不堆叠、刷新 savedAt、保留钉点）；非钉点超 AUTO_SNAPSHOT_CAP 丢 savedAt 最旧的非钉点。失败仅遥测、绝不阻断回合提交。
function pushTurnSnapshot(turnNumber, chatUid) {
  try {
    if (!window.ServiceRegistry || typeof window.ServiceRegistry.collectSaveData !== 'function') return null;
    if (!window.SnapshotRing) return null; // 硬依赖（snapshotRing.js 先加载）
    const collected = window.ServiceRegistry.collectSaveData();
    let stores;
    let history;
    try {
      stores = JSON.parse(JSON.stringify(collected.data));
      // 自包含 history：取 design-aware 游戏历史，切到本回合 chatUid（含）。
      const gh = _gameHistoryRef();
      let cut = gh.length;
      if (chatUid) {
        const idx = gh.findIndex(m => m && m.uid === chatUid);
        if (idx >= 0) cut = idx + 1;
      }
      // 跑存档同款瘦身（截 functionCalls.result / reactSegments.text 等重字段）——否则池里 8 份各存一份【原始】
      // history（含完整工具输出）会把存档撑到原来的数倍、撞 IDB/localStorage 配额 → 静默丢档。与顶层 history 一致
      // （顶层存档本就经 _cleanHistory；迁移回填也是从已清洗的顶层切的）。_cleanHistory 返回全新对象，再深拷贝隔离。
      const sliced = gh.slice(0, cut);
      const cleaned =
        window.saveManager && typeof window.saveManager._cleanHistory === 'function'
          ? window.saveManager._cleanHistory(sliced)
          : sliced;
      history = JSON.parse(JSON.stringify(cleaned));
    } catch (_cloneErr) {
      // clone 失败 = 该状态无法 JSON 序列化 → 绝不存「共享引用的假快照」（会被后续 in-place 改污染、比无快照更险）。
      // 跳过本次压栈、仅遥测；门控会安全降级为「这一回合不可回退」。
      console.warn('[chatCore] 快照深拷贝失败，跳过压栈（不存共享引用假快照）:', _cloneErr);
      try {
        window.analyticsService?.track?.('anomaly.snapshot_clone_failed', {});
      } catch (_e) {
        /* 遥测永不影响主流程 */
      }
      return null;
    }
    if (Array.isArray(collected.errors) && collected.errors.length > 0) {
      // 部分采集失败 → 该 store 缺席快照；还原时用「并到当前活态之上」兜底（见 restoreAll 调用方），不被 clear。
      try {
        window.analyticsService?.track?.('anomaly.prior_capture_partial', {
          services: collected.errors.map(e => e && e.service).filter(Boolean),
        });
      } catch (_e) {
        /* 遥测永不影响主流程 */
      }
    }
    const entry = {
      turn: Number.isFinite(turnNumber) ? turnNumber : null,
      kind: 'auto',
      savedAt: Date.now(),
      chatUid: chatUid || null,
      stores,
      history,
    };
    _snapshotRing = window.SnapshotRing.pushAuto(_snapshotRing, entry, AUTO_SNAPSHOT_CAP);
    return entry;
  } catch (snapErr) {
    console.warn('[chatCore] 压快照失败（仅遥测、不阻断回合）:', snapErr);
    return null;
  }
}
window.getSnapshotRing = getSnapshotRing;
window.setSnapshotRing = setSnapshotRing;
window.getPrevAiSnapshot = getPrevAiSnapshot;
window.getSnapshotByChatUid = getSnapshotByChatUid;
window.removeRingByChatUid = removeRingByChatUid;
window.currentTurnChatUid = currentTurnChatUid;
window.pushTurnSnapshot = pushTurnSnapshot;

// 兼容 shim：门控 _regenButtonMode/_deleteButtonMode 读「能否退最新回合」= 当前 head 的上一条 AI 是否有快照。
function getPriorStoresSnapshot() {
  const u = currentTurnChatUid();
  if (!u) return null;
  const base = getPrevAiSnapshot(u);
  return base ? base.stores : null;
}
function setPriorStoresSnapshot(_snap) {
  /* no-op：时间线池由 pushTurnSnapshot / removeRingByChatUid 维护 */
}
window.getPriorStoresSnapshot = getPriorStoresSnapshot;
window.setPriorStoresSnapshot = setPriorStoresSnapshot;

// ───── 时间线操作（玩家可见的「回到某点 / 钉点 / 删钉点」，由 saveManagerUI 经 SAVES_ACTIONS 调）─────

// 跳到时间线某点（chatUid = 该回合 AI 消息 uid）· v2 自由跳转：还原该点 16 store（并到活态之上）+ 把【游戏历史】
// 设为该快照【自带的自包含 history】（不依赖 live 历史里还有那个 uid）+【不截断池】（读取永不删快照）+ 存盘刷新。
// 成功 true；流式中 / 找不到该点 → 提示 false。
// ⚠️ 时间线 UI（存档台）只在世界卡(设计)模式下可见——此时全局 chatHistory 被别名成 designChatHistory，真游戏
// 历史在 window._gameChatHistory。游戏 store 不随 mode 交换，故 restoreAll/autoSaveGame 照常对游戏态生效；
// 历史写回必须写 _gameChatHistory（design）/ chatHistory（game）。
function rollbackToTimelinePoint(chatUid) {
  try {
    if (isSending) {
      if (typeof showToast === 'function') showToast('请等待 AI 回复完成');
      return false;
    }
    const inDesign = typeof isDesignMode !== 'undefined' && isDesignMode;
    const histRef = inDesign
      ? (Array.isArray(window._gameChatHistory) ? window._gameChatHistory : [])
      : chatHistory;
    const snap = typeof getSnapshotByChatUid === 'function' ? getSnapshotByChatUid(chatUid) : null;
    if (
      !snap ||
      !snap.stores ||
      typeof window.ServiceRegistry === 'undefined' ||
      typeof window.ServiceRegistry.restoreAll !== 'function'
    ) {
      if (typeof showToast === 'function') showToast('回退快照暂不可用，请重试');
      return false;
    }
    // 解析目标历史：优先用快照【自包含 history】（自由跳转的核心——即使 live 历史已岔开也能跳）；
    // 缺失（漏迁的老 entry）→ 兜底走老路：在当前游戏历史里 findIndex 切片（仅当该 uid 仍在 live 历史里时可用）。
    let nextHistory = null;
    if (Array.isArray(snap.history)) {
      try {
        nextHistory = JSON.parse(JSON.stringify(snap.history));
      } catch (_) {
        nextHistory = snap.history.slice();
      }
    } else {
      const idx = Array.isArray(histRef) ? histRef.findIndex(m => m && m.uid === chatUid) : -1;
      if (idx < 0) {
        if (typeof showToast === 'function') showToast('回退快照暂不可用，请重试');
        return false;
      }
      nextHistory = histRef.slice(0, idx + 1);
    }
    // 并到活态之上：缺席的 store（采集抛错漏掉）保留当前值、不被缺键 clear。全量快照下等价于直接还原。
    let merged = snap.stores;
    try {
      const live =
        typeof window.ServiceRegistry.collectSaveData === 'function'
          ? window.ServiceRegistry.collectSaveData().data || {}
          : {};
      merged = { ...live, ...snap.stores };
    } catch (_) {
      merged = snap.stores;
    }
    // v2：还原侧【必须深拷贝】——否则 live store 与池里这条快照共享嵌套引用（如 npc.state），后续回合 in-place
    // 改会污染仍可跳回的快照 → 再跳回该点 store↔history 错位（见 _restoreStoresMergedOverLive 同款注释）。
    try {
      merged = JSON.parse(JSON.stringify(merged));
    } catch (_) {}
    window.ServiceRegistry.restoreAll(merged);
    // 把游戏历史设为该点的自包含历史。设计模式写回 _gameChatHistory（切回游戏模式时会成为 chatHistory）。
    if (inDesign) window._gameChatHistory = nextHistory;
    else chatHistory = nextHistory;
    // v2：刷新【跳到的这个点】的 savedAt（它现在是当前所在位置，不该被当成最旧而下一回合就被挤掉——否则紧接着
    // 玩一回合就删/重生不了那一回合，因为它的回退基=这个点已被淘汰）。repush 按 chatUid 就地替换 + 刷新 savedAt +
    // 重新捕获已还原的活态（与历史一致）。
    if (typeof repushCurrentTurnSnapshot === 'function') {
      try { repushCurrentTurnSnapshot(); } catch (_) {}
    }
    // v2：读取/回退【不截断池】——T22–48 等其它点保留、可继续跳，随后续游玩按 savedAt 自然老化。
    if (typeof window.autoSaveGame === 'function') {
      try {
        window.autoSaveGame();
      } catch (_) {}
    }
    // 设计模式下游戏聊天区不可见（显示的是设计历史），刷新无意义且会动到设计区——交由 _savesNavigateBackToGame
    // 切回游戏模式时的 refreshChatUI 统一刷新（game.js mode-toggle 末尾必刷）。
    if (!inDesign) {
      if (typeof refreshChatUI === 'function') refreshChatUI({ scrollMode: 'bottom' });
      if (window.scrollController && typeof window.scrollController.runScoped === 'function') {
        window.scrollController.runScoped(() => window._markStaleChoices?.());
      } else {
        window._markStaleChoices?.();
      }
    }
    return true;
  } catch (e) {
    console.warn('[chatCore] rollbackToTimelinePoint 失败:', e);
    if (typeof showToast === 'function') showToast('回退失败，请重试');
    return false;
  }
}
window.rollbackToTimelinePoint = rollbackToTimelinePoint;

// 手动钉一个永久点（当前已提交回合末）= 在该回合【已有的那条快照】上打 pinned 标记（不新建条目，避免与
// 自动点撞同一 chatUid 产生重复行/重复 React key）。返回钉点条目或 null（无可钉回合 / 同点已钉 / 超上限 / 流式中）。
function pinCurrentTimelinePoint(name) {
  if (isSending) {
    if (typeof showToast === 'function') showToast('请等待 AI 回复完成');
    return null;
  }
  if (!window.SnapshotRing) return null;
  // 手动保存 = 给【当前所在回合】那条快照打 pinned 标记。当前回合 = 游戏历史最后一条已提交 AI（design-aware，
  // 存档台是 design-mode stage、直接读 chatHistory 会扫到设计对话钉不到东西）。
  const chatUid = currentTurnChatUid();
  const ring = getSnapshotRing();
  const target = chatUid ? ring.find(s => s && s.chatUid === chatUid) : null;
  if (!target) {
    // 没有当前回合的快照（开局尚未提交回合 / clone 失败跳过）→ 没东西可钉。
    if (typeof showToast === 'function') showToast('现在还没有可保存的进度');
    return null;
  }
  if (target.pinned) {
    if (typeof showToast === 'function') showToast('这一刻已经手动保存过了');
    return null;
  }
  if (ring.filter(s => s && s.pinned).length >= MANUAL_PIN_CAP) {
    if (typeof showToast === 'function') showToast(`手动保存点已满（最多 ${MANUAL_PIN_CAP} 个），请先删除一个再保存`);
    return null;
  }
  setSnapshotRing(window.SnapshotRing.setPinned(ring, chatUid, true, name));
  if (typeof window.autoSaveGame === 'function') {
    try {
      window.autoSaveGame();
    } catch (_) {}
  }
  return getSnapshotByChatUid(chatUid);
}
window.pinCurrentTimelinePoint = pinCurrentTimelinePoint;

// 取消一个手动钉点（按 chatUid）= 清掉该条目的 pinned 标记（条目本身留下、回归普通自动点继续受滚动驱逐）。
function deleteTimelinePin(chatUid) {
  if (!chatUid || !window.SnapshotRing) return false;
  setSnapshotRing(window.SnapshotRing.setPinned(getSnapshotRing(), chatUid, false));
  if (typeof window.autoSaveGame === 'function') {
    try {
      window.autoSaveGame();
    } catch (_) {}
  }
  return true;
}
window.deleteTimelinePin = deleteTimelinePin;

// 回合【之外】改了 store（状态栏复核/手编、NPC 复核等都绕过 processAIResponse 直接写 + autoSave）后，
// 刷新【当前回合】那条快照，使其反映这些改动——否则下一回合后删除/回退到当前回合会用旧快照、把这些改动
// 悄悄丢掉（见审查 M2）。同 turn 就地替换、保留钉点标记。无当前已提交回合（开局未提交）则 no-op。
function repushCurrentTurnSnapshot() {
  if (typeof isSending !== 'undefined' && isSending) return; // 流式中不动（回合末会自然压一条）
  // 当前回合 uid 走 design-aware 推导（pushAuto 按 chatUid 就地替换 + 刷 savedAt + 保留钉点）。
  const chatUid = currentTurnChatUid();
  if (chatUid == null) return;
  const turn = typeof parseTurnFromUID === 'function' ? parseTurnFromUID(chatUid) : null;
  pushTurnSnapshot(turn, chatUid);
}
window.repushCurrentTurnSnapshot = repushCurrentTurnSnapshot;

// 编辑某条消息（文本/叙事）后，把改后的内容同步进【所有自包含快照里对应那条】（按 uid 匹配）——否则跳回任意
// 历史窗口包含这条消息的快照点会显示编辑前文本（对抗审查 #3/4/5）。文本编辑不改 16 store，只 patch 各快照 history。
// 适用于有 uid 的消息（AI 回合）；无 uid 的消息由调用方回退 repushCurrentTurnSnapshot（至少刷新 head）。
function patchEditedMessageInPool(uid) {
  if (!uid || !window.SnapshotRing) return false;
  const gh = _gameHistoryRef();
  const liveMsg = Array.isArray(gh) ? gh.find(m => m && m.uid === uid) : null;
  if (!liveMsg) return false;
  // 用存档同款瘦身后的克隆替换（与快照内 history 一致、避免共享引用）。
  let cleanedMsg;
  try {
    const c =
      window.saveManager && typeof window.saveManager._cleanHistory === 'function'
        ? window.saveManager._cleanHistory([liveMsg])
        : [liveMsg];
    cleanedMsg = JSON.parse(JSON.stringify(c && c[0] ? c[0] : liveMsg));
  } catch (_) {
    return false;
  }
  const ring = getSnapshotRing();
  let changed = false;
  for (const snap of ring) {
    if (!snap || !Array.isArray(snap.history)) continue;
    const k = snap.history.findIndex(m => m && m.uid === uid);
    if (k >= 0) {
      try {
        snap.history[k] = JSON.parse(JSON.stringify(cleanedMsg));
        changed = true;
      } catch (_) {}
    }
  }
  return changed;
}
window.patchEditedMessageInPool = patchEditedMessageInPool;

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

// OOC（场外发言）现在只走 /ooc 命令；【】/[] 的输入抽取与高亮已移除。
// /ooc 用户消息以 meta:'ooc' 标记，渲染时加一个"场外"标签（下面三处 user 渲染路径共用）。
function _oocMsgTagHtml() {
  const en = window.i18nService?.getResolvedLanguage?.() === 'en';
  return `<span class="ooc-msg-tag">${en ? 'OOC' : '场外'}</span>`;
}

// 用户消息正文 HTML：三处 user 渲染路径共用。
//   meta:'ooc'（只有场外）→ 标签 + 整条柔和（外层加 .ooc-message）
//   oocNote（场外 + 剧情）→ 剧情正文上方挂一行淡色"场外 …"，剧情正文本身正常色
//   都没有 → 原样
function _userOocContentHtml(safeContent, isOocMsg, oocNote) {
  if (isOocMsg) return `${_oocMsgTagHtml()}${safeContent}`;
  if (oocNote) {
    return `<div class="ooc-note-line">${_oocMsgTagHtml()}${escapeHTML(oocNote)}</div>${safeContent}`;
  }
  return safeContent;
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
        // aborted:true 区分"取消整个回合"和"玩家手动跳过"——前者丢弃 OOC，后者仍尽力 commit（决策 6）。
        finalize({ skipped: true, aborted: true });
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
function getChatInlineApplyActionHtml() {
  return `<a class="chat-inline-action-apply" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">play_arrow</span><span class="chat-inline-action-label">${_getInlineActionLabel('应用到游戏', 'Apply to Game')}</span></a>`;
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
  // 新旧卡都在首轮开场白下出按钮；具体出哪套（新卡=开场选择 / 老卡=随机开始·推荐剧情）由注入处按
  // 是否有 frozen_moment 分支（见 renderOpeningChoiceButtonsHtml / renderQuickStartButtonsHtml）。
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

// 新卡（有 frozen_moment）开场白下的开场选择按钮：在「你扮演谁」维度二选一（地点沙盒里始终随机）。
//   有推荐主角 → [以推荐主角开场] [随机主角开场]
//   无推荐主角 → [以「普通人」身份开场] [随机主角开场]
// 点击 = 发一句开场指令给 GM，据此开 Turn 1（复用 quick-start 发送路径，不碰已死的 wizard）。
function renderOpeningChoiceButtonsHtml() {
  const anchor = window.worldMeta?.getPlayerAnchor?.() || null;
  const recommended =
    anchor && typeof anchor.recommended_role === 'string' ? anchor.recommended_role.trim() : '';
  // 「以推荐主角开场」按钮的出现条件：player_anchor 指定了推荐角色（老向导卡），或卡里直接有预设
  // is_protagonist 角色（新 PZWC 卡通常无 anchor）。点击经 chatCore handleQuickStart 的
  // NEW_PREDEFINED 分支把该预设主角播种进 npcStore → 角色面板显示主角。
  const hasPredefinedProtag = !!window.npcStore?._findProtagonistIdInPool?.();
  const hasRecommended =
    (!!recommended && Array.isArray(anchor?.allowed_modes) && anchor.allowed_modes.includes('assigned')) ||
    hasPredefinedProtag;
  const S = window.OPENING_BUTTON_SENTINELS; // 单一真源（防漂移），见 js/config/openingButtonSentinels.js
  const firstLabel = hasRecommended
    ? _getInlineActionLabel(S.recommended.zh, S.recommended.en)
    : _getInlineActionLabel(S.plain.zh, S.plain.en);
  const firstClass = hasRecommended ? 'chat-opening-recommended' : 'chat-opening-plain';
  const randomLabel = _getInlineActionLabel(S.random.zh, S.random.en);
  return `<div class="quick-start-buttons-container">
    <a class="btn-secondary ${firstClass}" data-action="chat-quick-start-btn" href="#">${firstLabel}</a>
    <a class="btn-secondary chat-opening-random" data-action="chat-quick-start-btn" href="#">${randomLabel}</a>
  </div>`;
}

function shouldShowDesignQuickStartButtons() {
  if (!isDesignMode) return false;
  if (!Array.isArray(chatHistory) || chatHistory.length !== 1) return false;
  const msg = chatHistory[0];
  if (!msg || msg.sender !== 'ai') return false;
  return true;
}

// ── Editorial frame helper（V9 工坊页骨架） ────────────────────
// 所有 P1 结构化面板的视觉外壳统一走这里：顶/底 mono 状态栏 + 居中 eyebrow + 大 H1 + rule + lede + body
//
// opts = {
//   stepNumber: '01' | '02' | ...,
//   totalSteps: '05',                          // 默认 05
//   eyebrow: 'STEP 02 — 施力点',                 // mono 副标
//   headline: '你想以什么身份进入这张卡？',         // 大 H1
//   lede: '这一步决定…',                          // 居中 lede 段落（可空）
//   ask: '— 可多选 · 至少选一项 —',               // mono 小副标（可空）
//   bodyHtml: '<div>…</div>',                   // 主体内容
//   bottomLabel: '施力点',                       // 底栏副标
//   scribed: '0%',                              // 底栏 worldcard.json 完成度
//   extraClass: 'quick-start-buttons-container dcv-quickstart', // 额外类（可空）
// }
function _renderEditorialFrame(opts) {
  // 注意：这里曾默认把 body[data-design-phase] 钉成 'p1'（P1 时代 composer pill /
  // commentary CSS 的作用域 hook）。PZWC 替换 P1/P2 后该强写只剩害处——pzwc 欢迎卡
  // 渲染会把 body 误标 p1，老 NOTE 条样式（特异性更高）压过 pzwc-build-msg 手记画风。
  // 已整体移除：body[data-design-phase] 现在唯一由 designService._syncDesignPhaseBodyAttr 管理。
  const t = (zh, en) => _getInlineActionLabel(zh, en);
  const stepNumber = opts.stepNumber || '01';
  const totalSteps = opts.totalSteps || '05';
  const stepLabel = typeof opts.stepLabel === 'string' && opts.stepLabel ? opts.stepLabel : 'STEP';
  const stepSlash = typeof opts.stepSlash === 'string' ? opts.stepSlash : ' / ';
  // stepText：整体覆盖步数指示（如开场卡 'BRIEF'）——步数叙事归 dpi 阶段指示器单源，
  // 卡内不再双讲；legacy 衔接卡（_designP3Intro 历史回放）仍走 stepNumber/totalSteps 老参数
  const stepText = typeof opts.stepText === 'string' && opts.stepText ? opts.stepText : '';
  const eyebrow = opts.eyebrow || '';
  const headline = opts.headline || '';
  const narrator = opts.narrator || '';
  const lede = opts.lede || '';
  const ask = opts.ask || '';
  const topAccessoryHtml = opts.topAccessoryHtml || ''; // 顶部附件（如「完整思考」展开框）—— 放在 eyebrow 之上
  const bodyHtml = opts.bodyHtml || '';
  const bottomLabel = opts.bottomLabel || '';
  const scribed = opts.scribed || '0%';
  const extraClass = opts.extraClass || '';

  const brand = t('世界卡设计工坊', 'World Card Workshop');
  const model =
    typeof getConfiguredDesignModelLabel === 'function' ? getConfiguredDesignModelLabel() : '';
  // "· " 分隔符走 CSS ::before，方便手机模式跟着 .dcv-frame-brand-name 一起隐起
  const modelHtml = model && model !== '模型' ? ` <span class="dcv-frame-model">${model}</span>` : '';
  const stepIndicator = stepText || `${stepLabel} ${stepNumber}${stepSlash}${totalSteps}`;
  const bottomMeta = `${scribed} scribed`;
  const bottomStep = bottomLabel ? `${stepIndicator} — ${bottomLabel}` : stepIndicator;

  // 用 div 而非 <header>/<section>：app.css 有全局 `header { display: flex }` 规则会把
  // eyebrow+h1+rule 摊平为一行；用 div 避开。
  const headerHtml = headline
    ? `<div class="dcv-step-header">
      ${eyebrow ? `<div class="dcv-eyebrow">${eyebrow}</div>` : ''}
      <h1 class="dcv-headline">${headline}</h1>
      <div class="dcv-rule"></div>
    </div>`
    : '';
  // narrator 是 AI 当轮的可见引言（preamble），已由调用方先经 formatMessageContent 处理成 HTML
  const narratorHtml = narrator ? `<div class="dcv-narrator">${narrator}</div>` : '';
  const ledeHtml = lede ? `<p class="dcv-lede">${lede}</p>` : '';
  const askHtml = ask ? `<div class="dcv-ask">${ask}</div>` : '';

  return `<div class="dcv-workshop-frame ${extraClass}">
    <div class="dcv-frame-top">
      <span class="dcv-frame-brand"><span class="dcv-frame-dot"></span><span class="dcv-frame-brand-name">${brand}</span>${modelHtml}</span>
      <span class="dcv-frame-step">${stepIndicator}</span>
    </div>
    <div class="dcv-step-section">
      ${topAccessoryHtml}
      ${headerHtml}
      ${narratorHtml}
      ${ledeHtml}
      ${askHtml}
      ${bodyHtml}
    </div>
    <div class="dcv-frame-bottom">
      <span class="dcv-frame-step"><span class="dcv-frame-led"></span>${bottomStep}</span>
      <span class="dcv-frame-meta">${bottomMeta}</span>
    </div>
  </div>`;
}

window._renderEditorialFrame = _renderEditorialFrame;

function renderDesignQuickStartButtonsHtml() {
  const t = (zh, en) => _getInlineActionLabel(zh, en);
  const glyphRole =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="20" cy="15" r="6"/><path d="M7 33c1.5-6 7-9 13-9s11.5 3 13 9"/></svg>';
  const glyphWorld =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="20" cy="20" r="13"/>' +
    '<ellipse cx="20" cy="20" rx="13" ry="6"/>' +
    '<ellipse cx="20" cy="20" rx="6" ry="13"/></svg>';
  const glyphScene =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="6" y="10" width="28" height="20" rx="2.5"/>' +
    '<circle cx="14" cy="17" r="2"/>' +
    '<path d="M8 27 L16 19 L21 24 L26 17 L32 25"/></svg>';
  const glyphImprov =
    '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="8" y="8" width="24" height="24" rx="3" transform="rotate(6 20 20)"/>' +
    '<circle cx="14" cy="14" r="1.6" fill="currentColor"/><circle cx="26" cy="14" r="1.6" fill="currentColor"/>' +
    '<circle cx="14" cy="26" r="1.6" fill="currentColor"/><circle cx="26" cy="26" r="1.6" fill="currentColor"/>' +
    '<circle cx="20" cy="20" r="1.6" fill="currentColor"/></svg>';
  const glyphArrow =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 12h14M13 5l7 7-7 7"/></svg>';

  const cards = [
    {
      id: 'role', n: '01', tag: 'PERSONA',
      title: t('扮演一个角色', 'Play a character'),
      desc: t('修仙弟子、高考刚结束的少年、末日里的一只猫……',
              'A cultivation disciple, a teen the night after college exams, a stray cat in the apocalypse…'),
      glyph: glyphRole,
    },
    {
      id: 'world', n: '02', tag: 'WORLD',
      title: t('构建一个世界', 'Build a world'),
      desc: t('修仙宇宙、雨夜的赛博朋克、停战翌日的边境小镇……',
              'A cultivation universe, a rainy-night cyberpunk city, a border town the morning after the ceasefire…'),
      glyph: glyphWorld,
    },
    {
      id: 'scene', n: '03', tag: 'SCENE',
      title: t('我有一个画面', 'I have a scene'),
      desc: t('「偷看师傅秘诀被师兄撞见」——直接写出来即可',
              '"I peeked at my master\'s manual and got caught" — just write it out'),
      glyph: glyphScene,
    },
  ];

  const improvTitle = t('随便来一个', 'Give me a random one');
  const improvSub = t('暂无头绪？由我起头', 'No idea? I\'ll start one for you');
  const foot = t(
    '也可以直接写一段——粘贴已有设定、写出脑中的画面，或随便聊聊',
    'Or write a paragraph yourself — paste an existing setting, sketch the scene in your head, or just chat'
  );

  const cardsHtml = cards.map(c => `<a class="dcv-card chat-quick-start-design-${c.id}" data-action="chat-quick-start-btn" href="#">
      <span class="dcv-card-num">${c.n}</span>
      <span class="dcv-card-glyph">${c.glyph}</span>
      <span class="dcv-card-body">
        <span class="dcv-card-title">${c.title}</span>
        <span class="dcv-card-tag">${c.tag}</span>
        <span class="dcv-card-desc">${c.desc}</span>
      </span>
    </a>`).join('');

  const bodyHtml = `<div class="dcv-cards">${cardsHtml}</div>
    <a class="dcv-improv chat-quick-start-design-improv" data-action="chat-quick-start-btn" href="#">
      <span class="dcv-improv-glyph">${glyphImprov}</span>
      <span class="dcv-improv-text">
        <span class="dcv-improv-meta">04 · IMPROV</span>
        <span class="dcv-improv-title">${improvTitle}<small>${improvSub}</small></span>
      </span>
      <span class="dcv-improv-go">GO${glyphArrow}</span>
    </a>
    <div class="dcv-foot">${foot}</div>`;

  return _renderEditorialFrame({
    // 三拍进度（描述→建造→精修）由 header 的 dpi 阶段指示器单源讲述，卡内只标卡的身份
    stepText: 'BRIEF',
    headline: t('欢迎来到设计模式，你想从哪个角度出发？', 'Welcome to design mode. Where would you like to start?'),
    lede: t(
      '在这里，你可以设计一张属于自己的世界卡。我会一步步引导你——先确立一个大方向，再围绕它逐层展开。',
      'Here you can design a world card of your own. I\'ll guide you step by step — first we lock in a direction, then we open it out layer by layer.'
    ),
    ask: t('— 选择一个方向开始 —', '— PICK A DIRECTION TO BEGIN —'),
    bodyHtml: bodyHtml,
    bottomLabel: t('确立方向', 'SET A DIRECTION'),
    scribed: '0%',
    extraClass: 'quick-start-buttons-container dcv-quickstart',
  });
}

window.renderDesignQuickStartButtonsHtml = renderDesignQuickStartButtonsHtml;

function removeQuickStartButtons() {
  // 只移除沙盒模式的 quick-start chips（不带 .dcv-workshop-frame 标记）。
  // 设计模式 editorial opening frame 不在这里碰 —— 它由用户拍板"保留可见到提交"，
  // 提交后 refreshChatUI 看到 chatHistory.length>1 自然不再 inject editorial，
  // 老 DOM 重渲染时变成普通 chat bubble（含欢迎文字 + sender label）。
  document
    .querySelectorAll('.quick-start-buttons-container:not(.dcv-workshop-frame)')
    .forEach(el => el.remove());
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

  if (isDesignMode) {
    return { showActions: false, reason: 'design_mode_disabled' };
  }

  const isErrorMessage = msg.isError === true || Boolean(msg.errorMeta);
  if (isErrorMessage) {
    return { showActions: true, reason: 'error_message' };
  }

  const sender = msg.sender;
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

// 重新生成按钮是否显示（tail-only + null 门控）。复制/删除/编辑不受影响、照常显示在所有消息上。
//   错误消息 = 重试：仅当它是历史最后一条时给（中途旧错误重试会落到错误的回滚基线；错误重试不需快照，
//     故不门控 prior——老存档后第一回合就报错也能重试）。错误消息无 uid，用位置判定而非 isLatestTurn。
//   非错误 AI 消息：只在「最新 AI 回合（isLatestTurn）+ 有可回退快照（_priorStores）」时给。
//     无快照（老存档 / 新局未满 2 回合 / 捕获抛错）→ 不显示，避免 regenerate 在当前态上静默重复施加。
//   用户/系统消息：不给重新生成。
// 删除/重新生成按钮的三态（tail-only）：
//   'enabled'  可点：① 末尾临时气泡（出错/取消，纯擦除）② 已提交最新 AI 回合 + 有可回退快照（restoreAll 退 N-1）
//   'disabled' 显示但禁用：已提交最新回合，但其更早的快照已被「只保留最近 N 个回退点」的滚动驱逐挤掉
//              （turnNum>=2 = 确实有更早回合、只是退不回去了）→ 露出禁用态 + 提示，向玩家解释上限（审查 Q3）。
//   'hidden'   不显示：中间/老回合、玩家消息、非末尾出错气泡、第一回合（turnNum<=1，之前只有开局、本就不可退、不打扰）。
// 把删除收成只在末回合给：删中间/老回合那条只 splice chatHistory、不动 pzgmState 的「记忆」的泄漏路径就走不到了。
function _regenButtonMode(index) {
  if (typeof chatHistory === 'undefined' || !Array.isArray(chatHistory)) return 'hidden';
  const msg = chatHistory[index];
  if (!msg) return 'hidden';
  if (msg.isError === true || Boolean(msg.errorMeta)) {
    return index === chatHistory.length - 1 ? 'enabled' : 'hidden';
  }
  if (msg.sender !== 'ai') return 'hidden';
  // fail-closed：取不到 isLatestTurn 判定时当作非末回合（隐藏），绝不在非末回合误显示。
  const isLatest =
    typeof gameOutputRenderer !== 'undefined' && typeof gameOutputRenderer.isLatestTurn === 'function'
      ? gameOutputRenderer.isLatestTurn(msg.uid)
      : false;
  if (!isLatest) return 'hidden';
  const hasPrior =
    (typeof window.getPriorStoresSnapshot === 'function' ? window.getPriorStoresSnapshot() : null) != null;
  if (hasPrior) return 'enabled';
  const turnNum = typeof parseTurnFromUID === 'function' ? parseTurnFromUID(msg.uid) : null;
  return Number.isFinite(turnNum) && turnNum >= 2 ? 'disabled' : 'hidden';
}
function _deleteButtonMode(index) {
  if (typeof chatHistory === 'undefined' || !Array.isArray(chatHistory)) return 'hidden';
  const msg = chatHistory[index];
  if (!msg || msg.sender !== 'ai') return 'hidden';
  const isTransientBubble = msg.isError === true || Boolean(msg.errorMeta) || msg.isCancelled === true;
  if (isTransientBubble) {
    return index === chatHistory.length - 1 ? 'enabled' : 'hidden';
  }
  const isLatest =
    typeof gameOutputRenderer !== 'undefined' && typeof gameOutputRenderer.isLatestTurn === 'function'
      ? gameOutputRenderer.isLatestTurn(msg.uid)
      : false;
  if (!isLatest) return 'hidden';
  const hasPrior =
    (typeof window.getPriorStoresSnapshot === 'function' ? window.getPriorStoresSnapshot() : null) != null;
  if (hasPrior) return 'enabled';
  const turnNum = typeof parseTurnFromUID === 'function' ? parseTurnFromUID(msg.uid) : null;
  return Number.isFinite(turnNum) && turnNum >= 2 ? 'disabled' : 'hidden';
}
// 旧名保留为「是否可点」包装（renderMessageActionsHtml / enhanceMessages 现按 mode 渲染三态）。
function _shouldShowRegenerateButton(index) {
  return _regenButtonMode(index) === 'enabled';
}
function _shouldShowDeleteButton(index) {
  return _deleteButtonMode(index) === 'enabled';
}

// 禁用态提示文案（已达最早回退点）。禁用按钮仍可点 → 点了走各自 handler 给 toast 解释（见 deleteMessage /
// regenerateMessage）；用 .is-disabled 类灰显（不用原生 disabled 属性，否则部分浏览器吞 title/hover）。
const NO_EARLIER_POINT_TITLE = '只保留最近 5 个回退点——这一回合之前的已经退不回去了';
// 按钮 HTML：初次渲染（renderMessageActionsHtml）与增量同步（enhanceMessages）共用一份，避免漂移。
const REGENERATE_BTN_HTML = `<button class="regenerate-action" data-action="msg-action-btn" title="重新生成">
                        <span class="icon icon-regenerate"></span>
                    </button>`;
const REGENERATE_BTN_DISABLED_HTML = `<button class="regenerate-action is-disabled" data-action="msg-action-btn" title="${NO_EARLIER_POINT_TITLE}">
                        <span class="icon icon-regenerate"></span>
                    </button>`;
const DELETE_BTN_HTML = `<button class="delete-action" data-action="msg-action-btn" title="删除">
                        <span class="icon icon-delete"></span>
                    </button>`;
const DELETE_BTN_DISABLED_HTML = `<button class="delete-action is-disabled" data-action="msg-action-btn" title="${NO_EARLIER_POINT_TITLE}">
                        <span class="icon icon-delete"></span>
                    </button>`;

function renderMessageActionsHtml(msgIndex) {
  const index = _normalizeMessageIndex(msgIndex);
  const policy = resolveMessageActionPolicy(index);
  if (!policy.showActions || !Number.isInteger(index)) {
    return '';
  }
  const _regenMode = _regenButtonMode(index);
  const regenerateBtnHtml =
    _regenMode === 'enabled' ? REGENERATE_BTN_HTML : _regenMode === 'disabled' ? REGENERATE_BTN_DISABLED_HTML : '';
  const _delMode = _deleteButtonMode(index);
  const deleteBtnHtml =
    _delMode === 'enabled' ? DELETE_BTN_HTML : _delMode === 'disabled' ? DELETE_BTN_DISABLED_HTML : '';
  return `
                <div class="message-actions" data-msg-index="${index}">
                    <button class="copy-action" data-action="msg-action-btn" title="复制">
                        <span class="icon icon-copy"></span>
                    </button>
                    ${regenerateBtnHtml}
                    ${deleteBtnHtml}
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

// 主聊天输入框占位符：分模式 + 分语言。
//   游戏（剧情）模式：带"输入 / 查看命令"提示（斜杠命令在此模式生效）
//   设计（世界卡）模式：中性文案，不提命令（设计模式下斜杠是关的）
// 由 initChatSystem 初始化、ui-language-changed 跟随、game.js 切 mode 时调用。
// forceDesign 显式传入新模式（切 mode 时 window.isDesignMode 可能还没翻）。
function updateChatInputPlaceholder(forceDesign) {
  if (!chatInputTextbox) return;
  const en = window.i18nService?.getResolvedLanguage?.() === 'en';
  const isDesign = forceDesign !== undefined ? !!forceDesign : !!window.isDesignMode;
  // 窄屏（≤480px）：游戏模式占位符省去"输入你的想法"，只留命令提示。
  const narrow = !!(window.matchMedia && window.matchMedia('(max-width: 480px)').matches);
  let next;
  if (isDesign) {
    next = en ? 'Type your idea…' : '输入你的想法…';
  } else if (narrow) {
    next = en ? '/ for commands' : '输入 / 查看命令';
  } else {
    next = en ? 'Type your idea…  (type / for commands)' : '输入你的想法…（输入 / 查看命令）';
  }
  // OOC 反问进行中：输入框被禁用并显示"请先回答"占位——别覆盖它，只更新待恢复值，
  // 答完 restore 时就用对的模式/语言（顺带修掉"切语言盖掉 OOC 占位"那条）。
  if (chatInputTextbox.dataset && chatInputTextbox.dataset.oocPrevPlaceholder !== undefined) {
    chatInputTextbox.dataset.oocPrevPlaceholder = next;
    return;
  }
  chatInputTextbox.placeholder = next;
}
window.updateChatInputPlaceholder = updateChatInputPlaceholder;

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

  // Enter 发送，Shift+Enter 换行（或根据设置反转）；中文输入法 composing 期间不拦截
  chatInputTextbox.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (e.isComposing || e.keyCode === 229) return;
    // 斜杠命令菜单开着时：Enter 交给菜单（选中命令），不触发发送
    if (window.slashCommandMenu?.isOpen?.()) return;

    const enterToNewline = localStorage.getItem('enter-to-newline') === 'on';
    if (enterToNewline) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        chatSendBtn.click();
      }
    } else {
      if (!e.shiftKey) {
        e.preventDefault();
        chatSendBtn.click();
      }
    }
  });

  // 输入框自动调整高度
  chatInputTextbox.addEventListener('input', () => {
    autoResizeTextarea();
  });

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

  // 斜杠命令菜单：在发送 keydown 绑定之后 init，保证菜单 keydown 注册在其后（键盘不打架）
  window.slashCommandMenu?.init?.();
  // 场外输入行（/ooc 自动分两行）：绑定 #chat-input 的 /ooc 检测 + 场外字段键盘
  window.oocInputRow?.init?.();

  // 导演指令 tag 栏（发言框上方折叠条）。此刻 .chat-input-textbox 已就位。
  window.directorTagsUI?.init?.();

  // 主输入框占位符分模式（游戏带 / 命令提示 / 设计中性）+ 跟随语言切换
  updateChatInputPlaceholder();
  window.addEventListener('ui-language-changed', () => updateChatInputPlaceholder());
  // 跨 480px 宽度边界时刷新占位符（窄屏只显示"输入 / 查看命令"）
  try {
    window.matchMedia?.('(max-width: 480px)')?.addEventListener?.('change', () => updateChatInputPlaceholder());
  } catch (_) { /* 老浏览器无 addEventListener(MQ)；不阻断 */ }
}

// chat-messages-area 滚到顶部时浮现 subtab nav（CSS 控制最终可见性，仅手机端 media query 启用）。
// 桌面端 CSS 不读 .is-chat-at-top，subtab 持续可见，所以这里始终切换 class 没副作用。
// 只读 scrollTop（不写），符合 项目内部规范 主聊天区滚动条规矩。
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
      '.chat-inline-action-settings, .chat-inline-action-reset, .chat-inline-action-save-manager, .chat-inline-action-default-world, .chat-inline-action-execute, .chat-inline-action-apply, .chat-inline-action-retry, .chat-quick-start-random, .chat-quick-start-recommended, .chat-opening-recommended, .chat-opening-plain, .chat-opening-random, .chat-quick-start-design-role, .chat-quick-start-design-world, .chat-quick-start-design-scene, .chat-quick-start-design-improv'
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
      // 执行按键已随老 P1/P2 退役（老历史消息里的 inline execute 链接降级为提示）
      if (typeof showToast === 'function') {
        showToast('该按钮已随旧版设计流程下线——直接发送你的世界描述即可开始建造');
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
      inlineBtn.classList.contains('chat-opening-recommended') ||
      inlineBtn.classList.contains('chat-opening-plain') ||
      inlineBtn.classList.contains('chat-opening-random')
    ) {
      // 新卡开场选择：点击 = 发一句开场指令给 GM，据此开 Turn 1（你扮演谁三选一，地点沙盒随机）。
      const S = window.OPENING_BUTTON_SENTINELS; // 单一真源（防漂移），见 js/config/openingButtonSentinels.js
      let openingText;
      if (inlineBtn.classList.contains('chat-opening-recommended')) {
        openingText = _getInlineActionLabel(S.recommended.zh, S.recommended.en);
        // 推荐主角 = 直接把预设的 is_protagonist 角色 load 进运行时，显示到角色 stage。
        // 找不到预设主角则跳过，交给 GM 经 new_npc 产出（与随机/自定义同路）。NEW_PREDEFINED 路径自带幂等。
        try {
          const protagId = window.npcStore?._findProtagonistIdInPool?.();
          if (protagId) {
            window.npcStore.processNpcPanel(
              [{ trigger_type: 'NEW_PREDEFINED', id: protagId }],
              0,
              null
            );
          }
        } catch (_) {}
      } else if (inlineBtn.classList.contains('chat-opening-plain')) {
        openingText = _getInlineActionLabel(S.plain.zh, S.plain.en);
      } else {
        openingText = _getInlineActionLabel(S.random.zh, S.random.en);
      }
      removeQuickStartButtons();
      if (chatInputTextbox) {
        chatInputTextbox.value = openingText;
        handleSendMessage();
      }
      return;
    }

    if (inlineBtn.classList.contains('chat-quick-start-design-improv')) {
      const text = _getInlineActionLabel('随便来一个', 'Give me a random one');
      // 不调 removeQuickStartButtons —— 用户拍板：editorial 卡片保留可见，
      // 提交后下一轮 refreshChatUI 看到 length>1 自然不再 inject editorial，
      // 老消息重渲染为普通 chat bubble；过渡用 refresh 节点接管。
      if (chatInputTextbox) {
        chatInputTextbox.value = text;
        handleSendMessage();
      }
      return;
    }

    if (
      inlineBtn.classList.contains('chat-quick-start-design-role') ||
      inlineBtn.classList.contains('chat-quick-start-design-world') ||
      inlineBtn.classList.contains('chat-quick-start-design-scene')
    ) {
      let prefix;
      if (inlineBtn.classList.contains('chat-quick-start-design-role')) {
        prefix = _getInlineActionLabel('我想扮演一个角色：', 'I want to play a character: ');
      } else if (inlineBtn.classList.contains('chat-quick-start-design-world')) {
        prefix = _getInlineActionLabel('我想创造一个世界：', 'I want to create a world: ');
      } else {
        prefix = _getInlineActionLabel('我有一个画面：', 'I have a scene: ');
      }
      // 不调 removeQuickStartButtons —— editorial 卡片保留，用户可换选另一张；
      // 提交后下次 refresh 自然变普通气泡。
      if (chatInputTextbox) {
        chatInputTextbox.value = prefix;
        chatInputTextbox.focus({ preventScroll: true });
        const end = prefix.length;
        try {
          chatInputTextbox.setSelectionRange(end, end);
        } catch (_) {}
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
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
 * 把模型 ID（如 `deepseek-v4-pro`）美化成展示形 `DeepSeek-V4-Pro`。
 * 段内 v\d+ 全大写、deepseek 专名套壳，其余首字母大写。
 */
function _prettifyDesignModelLabel(label) {
  if (typeof label !== 'string') return '';
  const trimmed = label.trim();
  if (!trimmed) return '';
  return trimmed
    .split('-')
    .map(seg => {
      if (!seg) return seg;
      if (/^v\d+$/i.test(seg)) return seg.toUpperCase();
      if (/^deepseek$/i.test(seg)) return 'DeepSeek';
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    })
    .join('-');
}

/** 判定 P2 自动生成阶段的 AI msg——不参与 turn marker / T<n> 计数。 */
function _isDesignP2Msg(msg) {
  return !!(msg && (msg._isStageBubble === true || msg._designP2Aux === true));
}

// P2→P3 衔接卡片（_designP3Intro: true）：套用 _renderEditorialFrame 的 chrome（顶部 brand
// + eyebrow + 大标题 + 分隔线 + lede + body + 底部 STEP/SCRIBED），跟 Phase 2 stage 面板视觉对齐。
// body 内放 2 条 bullet 引导（直接说话 / 应用到游戏）。
function _designP3IntroFrameHtml() {
  const applyBtnHtml = (typeof getChatInlineApplyActionHtml === 'function')
    ? getChatInlineApplyActionHtml()
    : '';
  const bullets = [
    `直接告诉我要改什么，我会出一份 diff 给你 review，确认后应用`,
    `完成所有调整后，点击${applyBtnHtml}进入预览确认`,
  ];
  const bodyHtml =
    `<ul class="design-p2-done-list">` +
    bullets.map(b => `<li>${b}</li>`).join('') +
    `</ul>`;
  return _renderEditorialFrame({
    stepNumber: '04',
    totalSteps: '04',
    stepLabel: 'Stage',
    stepSlash: '/',
    eyebrow:
      `<span class="dcv-eyebrow-text">完成</span>` +
      `<span class="design-p2-stage-chip is-success">✓ 全部完成</span>`,
    headline: '世界构建完成，进入完善模式',
    lede: '右侧预览面板可以查看所有生成内容（手机端在左上角的世界卡按键）。',
    bodyHtml,
    bottomLabel: '世界卡构建',
    scribed: '100%',
    extraClass: 'design-p2-done-frame',
  });
}

// refreshChatUI 重建时把 msgEl 切到 editorial frame 样式（删 .chat-user-label，把
// .chat-message-content 内容替换成 frame chrome）。class 跟 stage bubble 一样加
// .dcv-editorial-msg，借用其"chat-message-content 透明化"规则。
function _applyDesignP3IntroStyle(msgEl, _histMsg) {
  if (!msgEl) return;
  msgEl.classList.remove('design-p2-msg', 'p3-assistant-card');
  msgEl.classList.add('dcv-editorial-msg');
  const labelEl = msgEl.querySelector('.chat-user-label');
  if (labelEl) labelEl.remove();
  let contentEl = msgEl.querySelector('.chat-message-content');
  if (!contentEl) {
    contentEl = document.createElement('div');
    contentEl.className = 'chat-message-content';
    msgEl.appendChild(contentEl);
  }
  contentEl.innerHTML = _designP3IntroFrameHtml();
}

/** 下一个待 push 的"会计入 T 计数"的设计助手 AI 消息的回合号（跳过 P2 stage/inspection/done）。 */
function _nextDesignAiTurnNumber() {
  if (!Array.isArray(chatHistory)) return 1;
  // PZWC 建造手记（_pzwcBuild）：引擎一轮连出多条叙述/提问，只有紧跟玩家消息的
  // 「回合头」那条计入 T<n>——与 _rebuildDesignTurnMarkers 的 marker 豁免同一条规则，
  // 实时编号和重建编号才一致。
  return (
    chatHistory.filter(
      (m, i) =>
        m &&
        m.sender === 'ai' &&
        !_isDesignP2Msg(m) &&
        (!m._pzwcBuild || chatHistory[i - 1]?.sender === 'user')
    ).length + 1
  );
}

/**
 * 设计模式 turn marker（外置 header）：单独的 chat-message 节点，里头只放 chat-user-label，
 * 通过 data-ai-provider 借用 AI logo（::before 由 [data-ai-provider] CSS 提供），
 * 浮在该轮 AI msg 在 chatHistory 中"前一条玩家消息"之上。
 */
function _designCreateTurnMarker(modelLabel, providerKey, turnNumber, stageName = null) {
  const marker = document.createElement('div');
  marker.className = 'chat-message ai-message design-mode-msg design-turn-marker';
  marker.innerHTML = `<div class="chat-user-label">${escapeHTML(
    formatDesignAssistantLabel(modelLabel, stageName, turnNumber)
  )}</div>`;
  applyAiProviderDataset(marker, providerKey);
  return marker;
}

/**
 * 重建所有设计模式 turn marker。扫 chatHistory 给每条 AI msg 配一个 marker，
 * 浮在前一条玩家消息之前（前面不是 user → 紧贴 AI msg 自身）。
 * 用于 refreshChatUI 历史回放，以及 designService.js greeting 直推之后的初始化。
 */
/**
 * 实时把 metrics bar 灌进设计模式 AI msg 的 footer placeholder。
 * - msgEl 没 footer 时主动建一个（design AI msg 默认没 actions → enhanceMessages 通常不给加）。
 * - 复用 streamVisualizer.renderMetricsBar，与游戏模式 footer 同一套样式 + tooltip。
 * - metrics 是空或非对象 → 直接返回。
 */
function _renderDesignAiMetricsInto(msgEl, metrics) {
  if (!msgEl || !metrics || typeof metrics !== 'object') return;
  if (typeof streamVisualizer === 'undefined' || typeof streamVisualizer.renderMetricsBar !== 'function') return;
  let footerEl = msgEl.querySelector('.message-footer');
  if (!footerEl) {
    const contentEl = msgEl.querySelector('.chat-message-content');
    if (contentEl) {
      contentEl.insertAdjacentHTML(
        'afterend',
        '<div class="message-footer"><div class="metrics-placeholder"></div></div>'
      );
    } else {
      // P3 卡片化渲染会把 .chat-user-label / .chat-message-content 一并删掉，
      // 此时把 footer 直接挂到 msgEl 末尾——保持 metrics bar 出现的位置一致。
      msgEl.insertAdjacentHTML(
        'beforeend',
        '<div class="message-footer"><div class="metrics-placeholder"></div></div>'
      );
    }
    footerEl = msgEl.querySelector('.message-footer');
  }
  const placeholder = footerEl?.querySelector('.metrics-placeholder');
  if (!placeholder || placeholder.querySelector('.metrics-bar')) return;
  const html = streamVisualizer.renderMetricsBar(metrics);
  if (!html) return;
  placeholder.innerHTML = html;
  if (typeof streamVisualizer.bindMetricsEvents === 'function') {
    streamVisualizer.bindMetricsEvents(placeholder);
  }
}
window._renderDesignAiMetricsInto = _renderDesignAiMetricsInto;

function _rebuildDesignTurnMarkers() {
  if (!isDesignMode || !Array.isArray(chatHistory) || !chatMessagesArea) return;
  chatMessagesArea.querySelectorAll('.design-turn-marker').forEach(el => el.remove());
  let aiTurnCounter = 0;
  for (let i = 0; i < chatHistory.length; i++) {
    const msg = chatHistory[i];
    if (!msg || msg.sender !== 'ai') continue;
    // P2 自动生成阶段（stage/inspection/done）：不走 marker，也不递增 T<n> 计数。
    // P2 是 AI 串行生成、玩家不参与的批量流程，靠 stage 名做 header 就够了。
    if (_isDesignP2Msg(msg)) continue;
    // PZWC 建造手记：一轮多条叙述/提问全部入史，只有紧跟玩家消息的回合头
    // 领 marker + 计数（与实时建造「每次发送配一个 marker」对齐，
    // 也与 _nextDesignAiTurnNumber 的过滤规则一致）。
    if (msg._pzwcBuild && chatHistory[i - 1]?.sender !== 'user') continue;
    // step3：「世界卡框架已初步形成」通知 + 字段勾选面板是同一步的两条气泡。
    // 字段面板紧跟通知时不另起 turn marker（通知那条已领到本回合的 T 标记），避免一步出两个回合头。
    const _prevMsgForMarker = chatHistory[i - 1];
    if (msg.p1Fields && _prevMsgForMarker && _prevMsgForMarker.p1FrameworkNotice === true) continue;
    aiTurnCounter++;
    const aiEl = chatMessagesArea.querySelector(`.chat-message[data-original-index="${i}"]`);
    if (!aiEl || aiEl.parentNode !== chatMessagesArea) continue;
    const modelLabel = resolveDesignModelLabel(msg);
    const providerKey = resolveDesignProviderKey(msg);
    const marker = _designCreateTurnMarker(modelLabel, providerKey, aiTurnCounter, null);
    let anchor = aiEl;
    const prev = chatHistory[i - 1];
    if (prev && prev.sender === 'user') {
      const userEl = chatMessagesArea.querySelector(`.chat-message[data-original-index="${i - 1}"]`);
      if (userEl && userEl.parentNode === chatMessagesArea) {
        anchor = userEl;
      }
    }
    chatMessagesArea.insertBefore(marker, anchor);
  }
}
window._rebuildDesignTurnMarkers = _rebuildDesignTurnMarkers;

/**
 * 格式化世界卡助手标签
 * @param {string} modelLabel 模型 ID（会被 prettify）
 * @param {string|null} stageName Phase 2 stage 名（可选）
 * @param {number|null} turnNumber 回合号（提供时前缀 `T<n> · `；history replay/loading 都需传入）
 */
function formatDesignAssistantLabel(modelLabel, stageName = null, turnNumber = null) {
  const prettyModel = _prettifyDesignModelLabel(modelLabel) || '模型';
  let label = `设计助手「${prettyModel}」`;
  if (typeof stageName === 'string' && stageName.trim()) {
    label = `${label} · ${stageName.trim()}`;
  }
  if (Number.isFinite(turnNumber) && turnNumber > 0) {
    label = `T${turnNumber} · ${label}`;
  }
  return label;
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
  const safeContent = rawSafeContent;
  // /ooc 消息：meta:'ooc' 整条柔和（只有场外）/ oocNote 剧情正文上方挂淡色场外行（场外+剧情）
  const isOocMsg = senderType === 'user' && options?.message?.meta === 'ooc';
  const oocNote = senderType === 'user' ? (options?.message?.oocNote || '') : '';
  if (isOocMsg) msgEl.classList.add('ooc-message');
  const userContentHtml = _userOocContentHtml(safeContent, isOocMsg, oocNote);

  // 用户消息：添加等待计时器 UI（放在 message-footer 中，与操作按键同行）
  if (senderType === 'user' && options.showWaitTimer) {
    const actionsHtml = renderMessageActionsHtml(indexToUse);
    msgEl.innerHTML = `
            <div class="chat-user-label">${safeSenderName}</div>
            <div class="chat-message-content">${userContentHtml}</div>
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
                ${oocPrefixHtml}${userContentHtml}
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
  // 盖章条件含 raw.length：PZGM 导演单发回合 normalized 为空、但 raw 含导演标签，重生需靠它重扩，故也要盖章。
  if (usedOoc?.normalized || (Array.isArray(usedOoc?.raw) && usedOoc.raw.length)) {
    aiMessage.ooc = {
      normalized: usedOoc.normalized || '',
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
    //    地点形状审查（三段式规范 §2.1）：必须是三段对象；非对象（AI 写成一句话/字符串）或缺 country
    //    → 丢弃本回合位置改动、保留上一回合；缺 site/spot 从右往左补"未知"（保留值，匹配时当通配）。
    if (status.location && typeof locationTracker !== 'undefined') {
      const _loc = status.location;
      const _kept = (typeof locationTracker.getLocation === 'function' && locationTracker.getLocation()) || null;
      if (!_loc || typeof _loc !== 'object' || Array.isArray(_loc)) {
        console.warn('[processAIResponse] panel_status.location 非三段对象，保留上一回合位置');
        if (_kept) status.location = _kept;
      } else {
        const _seg = k => (typeof _loc[k] === 'string' ? _loc[k].trim() : '');
        const _country = _seg('country');
        let _site = _seg('site');
        let _spot = _seg('spot');
        if (!_country) {
          console.warn('[processAIResponse] panel_status.location 缺 country，保留上一回合位置');
          if (_kept) status.location = _kept;
        } else {
          if (!_site) { _site = '未知'; _spot = '未知'; }
          else if (!_spot) { _spot = '未知'; }
          const _norm = { country: _country, site: _site, spot: _spot };
          status.location = _norm; // 写回：存档 / lastGameState 回填读到规范三段
          locationTracker.updateFromResponse(_norm, turnNumber, status.datetime);
        }
      }
    }

    // 3. 同步 playerStateService（金钱、目标）
    if (typeof playerStateService !== 'undefined') {
      playerStateService.syncFromAIResponse(status);
    }

    // 5. 自定义世界：将完整 panel_status 存入 customStatusStore
    if (window.worldMeta?.getPanelFields?.() && typeof customStatusStore !== 'undefined') {
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

  // 回合末压一个 end-of-N 快照进时间线环（此刻 panel_status / 引擎投影 / 同步订阅都已落地）。
  // 这是唯一的「回合已提交」漏斗 → 覆盖打字/选项/地图/重生/开场所有提交路径；异常路不到这里、不压快照。
  // 紧随其后调用方会 autoSaveGame，把更新后的环落进存档 _snapshots。
  pushTurnSnapshot(turnNumber, turnUID, { kind: 'auto' });

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
      if (e.key === 'Enter') {
        if (e.isComposing || e.keyCode === 229) return;
        const enterToNewline = localStorage.getItem('enter-to-newline') === 'on';
        if (enterToNewline) {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            onOk();
          }
        } else {
          if (!e.shiftKey) {
            e.preventDefault();
            onOk();
          }
        }
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



let isDesignP2RetryPromptOpen = false;





/**
 * 切换发送按钮为取消模式（AI 生成期间）
 */
function setSendBtnCancelMode(enable) {
  _aiCancelMode = !!enable;
  if (!chatSendBtn) return;
  const iconEl = chatSendBtn.querySelector('.material-symbols-outlined');
  const labelEl = chatSendBtn.querySelector('.chat-send-label');
  const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
  if (enable) {
    chatSendBtn.classList.add('cancel-mode');
    chatSendBtn.title = isEn ? 'Pause' : '暂停';
    if (iconEl) iconEl.textContent = 'pause';
    if (labelEl) labelEl.textContent = isEn ? 'Pause' : '暂停';
  } else {
    chatSendBtn.classList.remove('cancel-mode');
    chatSendBtn.title = isEn ? 'Send' : '发送';
    if (iconEl) iconEl.textContent = 'send';
    if (labelEl) labelEl.textContent = isEn ? 'Send' : '发送';
  }
}
window.setSendBtnCancelMode = setSendBtnCancelMode;

/**
 * 执行取消操作：根据当前模式调用不同的取消方法
 */
function _executeCancelAction() {
  if (isDesignMode && window.designService) {
    const phase = designService.phase;
    if (phase === 'pzwc') {
      window.pzwcDesignController?.cancel?.();
    } else if (phase === 'p3') {
      window.p3Service?.cancelRequest?.();
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

  // 场外输入行（/ooc 分两行）：上行 = 场外，#chat-input = 剧情。两者任一非空即可发。
  const oocActive = window.oocInputRow?.isActive?.() === true;
  const oocText = oocActive ? (window.oocInputRow.getValue() || '').trim() : '';
  const message = chatInputTextbox.value.trim();
  // 导演标签也算"有内容"（getActiveCandidate 无副作用）——否则只选标签不打字会在这里被静默吞掉（A1）；
  // 放行后由下方"修饰必须配行动"守卫弹提示。
  const directorActive = (window.directorTagsUI?.getActiveCandidate?.() || '') !== '';
  if (!message && !oocText && !directorActive) return;

  // 发送前主动退出状态栏编辑态：焦点已离开字段（focusout 已落库），收掉 is-editing 让随后 rebuild 正常整渲，
  // 不残留可编辑旧栏（守卫只兜「编辑中途的并发 rebuild」，正常发送走这条更干净）。
  window._exitStatusEditMode?.();

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
  // 提交发送即收起斜杠菜单（覆盖非鼠标触发的程序化发送——鼠标点发送靠 outside-mousedown 收起）
  window.slashCommandMenu?.hide?.();

  // try/finally 必须从 isSending=true 之后立即开始包围——任何同步代码（OOC
  // 提取 / DOM 清空 / 埋点）抛错都得能跑 finally 复位 isSending + textarea.disabled，
  // 否则 textarea 卡禁用 = 永久不可输入。
  try {
    // 沙盒下抽取/剥离 OOC 候选（【...】或 [...]）。
    // 世界卡跳过，保留世界卡内容中的字面括号。
    const isDesign = typeof isDesignMode !== 'undefined' && isDesignMode;
    const gameLang = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';

    // 斜杠命令（仅游戏模式；设计模式由 slashCommands 内部 gate 掉，保留字面斜杠）。
    // handled→meta 命令已自行处理；ooc→/ooc <内容> 走 OOC 流水线；其余落普通发送。
    const _clearSlashInput = () => {
      chatInputTextbox.value = '';
      if (chatInputTextbox?.dataset) {
        // 与正常发送路径同样清理：避免 meta 命令早返回后残留旧选项 payload，污染下一条消息
        delete chatInputTextbox.dataset.designP1Display;
        delete chatInputTextbox.dataset.selectedChoicePayload;
        delete chatInputTextbox.dataset.selectedChoiceText;
      }
      resetTextareaHeight();
      window.slashCommandMenu?.hide?.();
    };

    // 裸命令半截 token 守卫（两路都跑——OOC 行开着时下面那行也走这里，避免 "/oo" 半截命令泄漏给 AI）。
    // 非任何命令前缀的（如自创 emote /shrug）则不拦，照常发出。
    if (!isDesign && /^\/\S+$/.test(message)) {
      const parsedCmd = window.slashCommands?.parse?.(message);
      if (parsedCmd && parsedCmd.isCommand && !parsedCmd.command) {
        const hasMatches = (window.slashCommands?.match?.(parsedCmd.trigger) || []).length > 0;
        if (hasMatches) {
          showToast(gameLang === 'en'
            ? 'Pick a command from the list, or finish typing it'
            : '请从命令列表中选择，或补全命令');
          _clearSlashInput();
          return; // try→finally 复位 isSending / textarea.disabled
        }
      }
    }

    let oocCandidates = [];
    let fullMessage = message;
    let displayMessage;
    let oocNote = '';            // 场外 + 剧情：剧情正文上方挂淡色"场外"行
    let hasAction = false;       // 本回合是否有"世界内行动"（区别于纯修饰：场外发言 / 导演标签）

    // 导演候选：无副作用读取（设计模式 selection 恒空 → 返回 ''）。与场外发言、斜杠 /ooc 同为"修饰"，
    // 都必须配合一句行动才成立（决策 3+4）。必须在下面 resetSelection() 清空之前读取。
    const directorOoc = !isDesign ? (window.directorTagsUI?.getActiveCandidate?.() || '') : '';

    if (oocActive && !isDesign) {
      // 场外行已分出（打了 /ooc）：上行 = 场外(oocText)，#chat-input(message) = 剧情。下行不走斜杠分发。
      if (oocText) oocCandidates.push(oocText); // 空/纯空白不入候选，避免触发空的子代理回合
      hasAction = !!message || !!selectedChoicePayload;
      if (oocText && message) {
        // 场外 + 剧情：剧情走本回合动作，场外走 oocCandidates，消息渲染剧情 + 顶上场外行。
        fullMessage = message;
        displayMessage = message;
        oocNote = oocText;
      } else {
        // 只有场外（无剧情）→ hasAction=false，下方守卫弹提示；
        // 或场外行空着只打了剧情 → hasAction=true，当普通剧情发。
        displayMessage = stagedDesignDisplay || message;
      }
    } else {
      // message 为空（如只选了导演标签）时不派发斜杠，避免空串误入命令解析。
      const slashResult = message ? window.slashCommands?.dispatch?.(message, {}) : null;
      if (slashResult && slashResult.handled) {
        if (slashResult.notice) showToast(slashResult.notice);
        if (slashResult.keepInput) window.slashCommandMenu?.hide?.();
        else _clearSlashInput();
        return; // try→finally 复位 isSending / textarea.disabled
      }
      if (slashResult && slashResult.ooc != null) {
        // 直接打 /ooc <内容> 并发送（没经分两行）：场外作修饰候选，本路无独立行动 → 下方守卫弹提示。
        oocCandidates.push(slashResult.ooc);
        displayMessage = slashResult.ooc;
      } else {
        // 普通消息：不再抽取 【】/[]——括号一律当普通文字原样发出（OOC 改走 /ooc）。
        displayMessage = stagedDesignDisplay || message;
        hasAction = !!message || !!selectedChoicePayload;
      }
    }

    // 导演候选并入修饰候选（必须在 resetSelection 之前）。
    if (directorOoc) oocCandidates.push(directorOoc);

    // 决策 3+4：场外发言 / 导演标签都是"修饰"，必须配合一句行动。只有修饰、没有行动 → 弹提示并 return，
    // **不**清空输入 / **不** resetSelection() / **不**收场外行——让玩家补一句行动再发（顺带修 A6 选中态泄漏）。
    if (oocCandidates.length > 0 && !hasAction) {
      showToast(gameLang === 'en'
        ? 'An out-of-character note or director tag needs an accompanying action.'
        : '场外发言 / 导演标签需要配合一句行动');
      return; // try→finally 复位 isSending / textarea.disabled
    }

    // 清空输入框
    chatInputTextbox.value = '';
    if (chatInputTextbox?.dataset) {
      delete chatInputTextbox.dataset.designP1Display;
      delete chatInputTextbox.dataset.selectedChoicePayload;
      delete chatInputTextbox.dataset.selectedChoiceText;
    }
    // 导演 tag「每回合用完即清」：本回合选择已在上面读入 oocCandidates，这里只重置 chip 选中态
    window.directorTagsUI?.resetSelection?.();
    // 场外行用完即收回单行（场外内容已在上面读入 oocCandidates）
    window.oocInputRow?.reset?.();
    resetTextareaHeight();

    if (!isDesignMode) {
      try {
        const sessionStart = window.analyticsService?._sessionStartedAt || 0;
        const msSince = sessionStart ? (Date.now() - sessionStart) : null;
        window.analyticsService?.noteTurn?.();
        window.analyticsService?.trackOnce?.('funnel.first_turn',
          { ms_since_session_start: msSince }, 'funnel.first_turn');
        // v2 通道：每回合发一条 tr（活跃=有tr / 深度=count(tr) / 漏斗第⑦关=有tr）
      } catch (_) { /* ignore */ }
    }

    // 主线模式处理（传入 UI 展示文本和实际发送文本）
    await handleMainlineSendMessage(fullMessage, displayMessage, {
      actionInputText: fullMessage,
      selectedChoicePayload,
      selectedChoiceText,
      oocCandidates,
      oocDisplay: false, // 纯场外发送已取消（决策 4）——OOC 必配行动，不再有"只有场外"的 meta:'ooc' 气泡
      oocNote,
    });
  } finally {
    isSending = false;
    if (chatInputTextbox) chatInputTextbox.disabled = false;

    if (!isDesignMode) {
      requestAnimationFrame(() => {
        if (window.isDesignMode) return;
        // streaming-state class 切换 + choices stale 折叠会变化尺寸。交给
        // scrollController 受控：pinned 贴住底部 / 非 pinned 保持阅读位
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
 * 从错误 message 里解析出 "HTTP <三位数>" 的状态码（PZGM 等不产出结构化 httpStatus 的路径用）。
 * 只认开头/词边界处的 "HTTP 402" 这种形态，避免把响应体 JSON 里的数字误当状态码。
 * 解析不到返回 undefined（行为同字段缺失）。
 */
function _httpStatusFromMessage(message) {
  if (typeof message !== 'string') return undefined;
  const m = message.match(/\bHTTP\s+(\d{3})\b/i);
  return m ? parseInt(m[1], 10) : undefined;
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
  //
  // 第三档兜底：PZGM 引擎路径不像 ReAct 那样产出结构化 httpStatus，错误只包成
  // { type:'provider', message:'HTTP 402: ...' }——状态码只活在 message 字符串里。
  // 这里从 message 里把 "HTTP <三位数>" 解析回数字，让下面所有 status 分支（402/401/429/5xx…）
  // 对 PZGM 这条线也一并生效，而不必去改 vendored 的引擎。
  const status = info.httpStatus ?? info.upstreamStatus ?? _httpStatusFromMessage(info.message ?? error?.message);
  const type = info.errorType;
  const elapsed = info.elapsedMs || info.stageElapsedMs;
  const elapsedSec = elapsed ? (elapsed / 1000).toFixed(1) : null;

  let body = '';

  // upstream_failure 路径优先按 ReAct 的 upstreamKind 分类（已经做过 message 强信号识别），
  // 不能让 raw status 抢先误导——比如中转站把"余额不足"用 403 返回，按 status 会走"权限被限制"，
  // 但 upstreamKind='balance' 是对的。kind === 'unknown' 时 fall-through 到下面 status 路由 / 最终兜底。
  // 完整错误码语义见 内部设计文档
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
    // 中转站常用 401/403 包装"余额不足"——message 关键词比 status 准（服务端 之类把"用户额度不足"用 403 返回）；
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

  // 注:回合快照不在此处采集。时间线环改为「回合提交后」在 processAIResponse 末尾压一个 end-of-N 快照
  // （见 pushTurnSnapshot）。异常路（无 API key / 取消 / 出错）不经 processAIResponse → 不压快照 →
  // 环天然停在上一回合，无需任何回退补偿（旧的「回合首采集 + 三处 revert」整套已删除）。

  // ───── 新卡开局问答 wizard 拦截 ─────
  // 触发条件：① 卡有 frozen_moment（新卡）② lock 未写（wizard 未完成）③ 首轮（无 model 回复）
  // 满足 → 弹 wizard、暂停此次 sendMessage；wizard 完成后重新调用，cancel 则回 launcher 避免死循环
  try {
    const hasFrozen = !!window.worldMeta?.getFrozenMoment?.();
    const lock = window.playerOpeningLockStore?.get?.() || null;
    const aiMsgCount = Array.isArray(chatHistory)
      ? chatHistory.filter(m => m && m.sender === 'ai').length
      : 0;
    const needsWizard =
      hasFrozen && !lock && aiMsgCount === 0 && typeof window.openingWizardUI?.openWizard === 'function';
    if (needsWizard) {
      window.openingWizardUI.openWizard({
        onComplete: () => {
          // F-1c: 包裹 isSending + disabled 管理（绕过 handleSendMessage 的 try/finally 复位）
          // 防止流式 AI 跑期间 isSending=false、玩家再点发送可重入
          (async () => {
            isSending = true;
            if (chatInputTextbox) chatInputTextbox.disabled = true;
            try {
              await handleMainlineSendMessage(message, displayMessage, options);
            } finally {
              isSending = false;
              if (chatInputTextbox) chatInputTextbox.disabled = false;
            }
          })();
        },
        onCancel: () => {
          // 回 launcher 避免反复触发死循环
          if (typeof window.showLauncherOverlay === 'function') {
            window.showLauncherOverlay();
          }
        },
      });
      return;
    }
  } catch (wizErr) {
    console.warn('[chatCore] opening wizard 拦截失败、走原路径', wizErr);
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

    const _noKeyEntry = {
      sender: 'user',
      text: message,
      displayText: displayMessage && displayMessage !== message ? displayMessage : undefined,
    };
    if (options.oocDisplay) _noKeyEntry.meta = 'ooc';
    if (options.oocNote) _noKeyEntry.oocNote = options.oocNote;
    addMessage(shownMessage, getUserLabel(), 'user', null, { message: _noKeyEntry });
    setTimeout(enhanceMessages, 10);
    chatHistory.push(_noKeyEntry);

    addMessage(noApiError, 'AI', 'ai');
    chatHistory.push({ sender: 'ai', text: noApiError });
    // 本回合没产出（缺 key），未走 processAIResponse → 时间线环未压新点、天然停在上一回合，无需补偿。
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

  // 用户消息历史条目：先建好，渲染与存档共用同一对象，OOC 标记（meta:'ooc'）两边一致。
  // text 保存完整消息（含文档内容/给 AI 的 【】 形态），displayText 保存 UI 展示文本（/ooc 为纯内容）。
  const userHistEntry = {
    sender: 'user',
    text: message,
    displayText: displayMessage && displayMessage !== message ? displayMessage : undefined,
  };
  if (options.oocDisplay) userHistEntry.meta = 'ooc';
  if (options.oocNote) userHistEntry.oocNote = options.oocNote;
  // 显示用户消息（带等待计时器）— 使用 displayMessage 避免显示文档全文
  const userMsgEl = addMessage(displayMessage || message, getUserLabel(), 'user', null, {
    showWaitTimer: true,
    message: userHistEntry,
  });
  setTimeout(enhanceMessages, 10);
  chatHistory.push(userHistEntry);

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
      // 取消的回合没走 processAIResponse → 时间线环未压新点、天然停在上一回合，无需补偿。
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
    // 出错的回合没走 processAIResponse → 时间线环未压新点、天然停在上一回合，无需补偿。错误气泡的
    // 「重试」走位置判定（index===末条）、不依赖快照对齐。
    window.autoSaveGame();
    if (typeof aiService !== 'undefined' && typeof aiService.flushDeferredWorldCardActivation === 'function') {
      aiService.flushDeferredWorldCardActivation();
    }
    refreshChatUI();
  }
}


/**
 * 世界卡消息处理（PZWC 替换 P1/P2 后的精简路由，2026-06-10）
 * phase 路由：p3 → p3Service.sendMessage；pzwc → pzwcDesignController
 * （第一条消息 = 建造 brief，之后 = ask_user 的回答）；其余 phase 不支持对话。
 */
async function handleDesignModeSendMessage(message, displayMessage) {
  // 注意：isSending 由外层 handleSendMessage 管理，此处不重复检查

  // Phase 3 走独立 service（消息渲染到 chat-messages-area，跟主流程同流）
  if (window.designService?.phase === 'p3' && window.p3Service?.sendMessage) {
    try {
      await window.p3Service.sendMessage(message);
    } catch (e) {
      console.warn('[handleDesignModeSendMessage] p3Service.sendMessage failed:', e);
    }
    return;
  }

  // PZWC 引擎建造中且不在等回答 ⇒ 拦在用户消息渲染之前（不入史、不出气泡）。
  // 外层 handleSendMessage 已清空输入框——把用户打的字放回去，别静默吞掉。
  if (
    window.designService?.phase === 'pzwc' &&
    window.pzwcDesignController?.shouldRejectMessage?.()
  ) {
    if (typeof showToast === 'function') showToast('引擎正在建造中——等它提问，或先点暂停');
    try {
      const tb = document.querySelector('.chat-input-textbox');
      if (tb && !tb.value) tb.value = displayMessage || message;
    } catch (_) {
      /* ignore */
    }
    return;
  }

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

  // 回合 marker + loading 指示器（一轮 = marker → 玩家 → AI 内容）
  const designProviderKey = resolveDesignProviderKey();
  const designModelLabel = resolveDesignModelLabel();
  const designTurnNumber = _nextDesignAiTurnNumber();
  const designAssistantLabel = escapeHTML(
    formatDesignAssistantLabel(designModelLabel, null, designTurnNumber)
  );
  const designTurnMarker = _designCreateTurnMarker(
    designModelLabel,
    designProviderKey,
    designTurnNumber
  );
  if (userMsgEl && userMsgEl.parentNode === chatMessagesArea) {
    chatMessagesArea.insertBefore(designTurnMarker, userMsgEl);
  } else {
    chatMessagesArea.appendChild(designTurnMarker);
  }
  const loadingEl = document.createElement('div');
  // pzwc 路径 loading 直接穿手记装：避免同一回合「实底橙三点 → 透明手记」中途换装
  const loadingPhaseClass =
    window.designService?.phase === 'pzwc' ? ' pzwc-build-msg pzwc-loading' : '';
  loadingEl.className = 'chat-message ai-message design-mode-msg design-loading' + loadingPhaseClass;
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
  loadingEl._designTurnMarker = designTurnMarker; // 失败时一并清掉，避免遗留孤儿 marker
  chatMessagesArea.appendChild(loadingEl);

  try {
    if (!window.designService) {
      throw new Error('设计服务未初始化，请重新进入世界卡');
    }

    currentPhase = designService.phase;

    if (currentPhase === 'pzwc') {
      // PZWC 引擎路由：控制器自管这一回合之后的全部渲染（流式气泡/工具行/ask 面板/
      // 取消按钮），loadingEl 交给它在首个流式事件时摘除。
      await window.pzwcDesignController.handleUserMessage(message, {
        loadingEl,
        providerKey: designProviderKey,
        modelLabel: designModelLabel,
      });
      return;
    }

    // 未知 phase（p1/p2 已随 PZWC 替换退役）
    loadingEl.remove();
    const aiText = '当前阶段不支持对话操作。请重置世界卡后重新开始。';
    const aiIndex = chatHistory.length;
    const aiMessage = {
      sender: 'ai',
      text: aiText,
      modelLabel: designModelLabel,
      providerKey: designProviderKey || undefined,
    };
    chatHistory.push(aiMessage);
    const aiMsgEl = document.createElement('div');
    aiMsgEl.className = 'chat-message ai-message design-mode-msg';
    aiMsgEl.dataset.originalIndex = aiIndex;
    aiMsgEl.innerHTML = `
            <div class="chat-user-label">${designAssistantLabel}</div>
            <div class="chat-message-content">${formatMessageContent(aiText)}</div>
        `;
    applyAiProviderDataset(aiMsgEl, designProviderKey);
    chatMessagesArea.appendChild(aiMsgEl);
    _rebuildDesignTurnMarkers();
    setTimeout(enhanceMessages, 10);
  } catch (error) {
    console.error('[DesignMode] Error:', error);
    // loading 一起清掉它头上的外置 marker，避免出错后玩家消息上面留个孤儿 header
    loadingEl._designTurnMarker?.remove?.();
    loadingEl.remove();

    if (error && error.code === 'P2_ABORTED') {
      return;
    }

    // 用户主动取消（P1）
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
    // 安全网：确保按钮恢复。例外——PZWC 引擎建造进行中：发送键保持「暂停」
    // （它是建造期间唯一的取消入口；renderAsk 等回答时控制器自己会切回「发送」）。
    const _pzwcBuilding =
      window.designService?.phase === 'pzwc' && window.pzwcDesignController?.isBuilding?.();
    setSendBtnCancelMode(_pzwcBuilding ? true : false);
    isSending = false;
    if (window.designService) {
      designService._fullSave(chatHistory);
    }
  }
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

// 当前正在生成中的 stage bubble（streaming/inspecting 时引用）。
// beforeunload/visibilitychange 监听器拿它把状态翻成 'aborted' 落盘。
let _activePhase2StageBubbleRef = null;

let _phase2StreamingAbortLifecycleBound = false;


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
    // design AI msg 没有 actions 时通常没 footer——但若 chatHistory 里挂了 metrics
    // （耗时/token/费用 bar），仍要保留 footer 让 placeholder 接得住后续 renderMetricsBar 填充。
    const histMsgForFooter = Array.isArray(chatHistory) ? chatHistory[normalizedIndex] : null;
    const hasDesignMetrics = !!(histMsgForFooter && histMsgForFooter.metrics);

    // 添加底部栏，或同步底部栏中的按键状态
    let footerEl = msg.querySelector('.message-footer');
    if (!footerEl) {
      if (isDesignMode && !expectedActionsHtml && !hasDesignMetrics) return;
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
          // tail-only：「该不该有重新生成按钮」会随回合推移变化（末回合→有，下一回合到来→无）。
          // 必须把已存在的按钮栏也同步——老逻辑只在「整条加 / 整条删」时动按钮集、从不改已有栏，
          // 导致某回合当年作为末回合拿到的重新生成按钮永久滞留在老回合上。按当前三态增删 + 切换禁用态。
          const regenMode = _regenButtonMode(normalizedIndex);
          let curRegen = existingActionsEl.querySelector('.regenerate-action');
          if (regenMode === 'hidden') {
            if (curRegen) curRegen.remove();
          } else {
            if (!curRegen) {
              const copyBtn = existingActionsEl.querySelector('.copy-action');
              const html = regenMode === 'disabled' ? REGENERATE_BTN_DISABLED_HTML : REGENERATE_BTN_HTML;
              if (copyBtn) copyBtn.insertAdjacentHTML('afterend', html);
              else existingActionsEl.insertAdjacentHTML('afterbegin', html);
              curRegen = existingActionsEl.querySelector('.regenerate-action');
            }
            if (curRegen) {
              const dis = regenMode === 'disabled';
              curRegen.classList.toggle('is-disabled', dis);
              curRegen.setAttribute('title', dis ? NO_EARLIER_POINT_TITLE : '重新生成');
            }
          }
          // 删除按钮同理：只在末回合（或末尾临时气泡）显示；老回合撤掉（否则点它走「只藏文字」泄漏路径）；
          // 末回合但更早快照被驱逐时露出禁用态解释上限。
          const delMode = _deleteButtonMode(normalizedIndex);
          let curDelete = existingActionsEl.querySelector('.delete-action');
          if (delMode === 'hidden') {
            if (curDelete) curDelete.remove();
          } else {
            if (!curDelete) {
              // 维持初次渲染的按钮顺序：copy → regenerate → delete → edit，插在 edit 之前。
              const editBtn = existingActionsEl.querySelector('.edit-action');
              const html = delMode === 'disabled' ? DELETE_BTN_DISABLED_HTML : DELETE_BTN_HTML;
              if (editBtn) editBtn.insertAdjacentHTML('beforebegin', html);
              else existingActionsEl.insertAdjacentHTML('beforeend', html);
              curDelete = existingActionsEl.querySelector('.delete-action');
            }
            if (curDelete) {
              const dis = delMode === 'disabled';
              curDelete.classList.toggle('is-disabled', dis);
              curDelete.setAttribute('title', dis ? NO_EARLIER_POINT_TITLE : '删除');
            }
          }
        } else {
          footerEl.insertAdjacentHTML('beforeend', expectedActionsHtml);
        }
      } else if (existingActionsEl) {
        existingActionsEl.remove();
      }
      if (
        isDesignMode &&
        !expectedActionsHtml &&
        !footerEl.querySelector('.metrics-placeholder > *') &&
        !hasDesignMetrics
      ) {
        footerEl.remove();
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











function _getLatestDesignAiMessageIndex() {
  if (!Array.isArray(chatHistory)) return -1;
  for (let i = chatHistory.length - 1; i >= 0; i -= 1) {
    const msg = chatHistory[i];
    if (msg?.sender === 'ai') return i;
  }
  return -1;
}








function _getDesignModeUserMessageSafeContent(text) {
  const source = typeof text === 'string' ? text : String(text ?? '');
  return window.htmlSecurity
    ? window.htmlSecurity.plainTextToSafeHtml(source)
    : escapeHTML(source).replace(/\n/g, '<br>');
}
























// 2026-05-29：删除重构遗留的两个死函数 _renderDesignP1ProgressBar / _renderDesignP1BacktrackLink——
// 二者 state 映射全是旧 legacy 名（新流程恒亮第 1 格）、backtrackToR2 是 no-op，且全工程零调用方。
// 若日后要恢复进度条，改用 stateMachines.js 的 STATE_TO_STEP_INDEX（新枚举映射）。

// ── Phase 1 新流程：起名步骤 / 确认页 / 前置过滤 面板 ──────────────




































let _designP1SkeletonToken = 0;












// Phase 1 卡片图标系统（原稿 GLYPHS / S2_GLYPHS / S3_POS_GLYPHS / S3_LET_ME_GLYPH 移植）
// 所有 SVG 24x24, stroke-width 1.8, stroke linecap/join round, fill none, currentColor —— 跟卡片 token 一起继承
const _DESIGN_P1_GLYPH_SVG_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

// 施力点（Anchor）模式 -> 图标（assigned/any_role/director）
const _DESIGN_P1_ANCHOR_GLYPHS = {
  assigned: `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><circle cx="11" cy="8" r="4"/><path d="M3 20c0-4 3.5-6 8-6 1.8 0 3.4.3 4.6 1"/><path d="M19 13l.9 1.9 2.1.3-1.5 1.5.4 2.1L19 18l-1.9 1 .4-2.1-1.5-1.5 2.1-.3z"/></svg>`,
  any_role: `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3 3-5 7-5 2 0 4 .6 5 2"/><path d="M14 18c.5-2 2.5-3 5-3"/></svg>`,
  director: `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
};

// 方向题选项按索引取的几何形状（圆 / 三角 / 方 / 菱 / 六边 / 星）—— AI 不出语义图标，索引循环即可
const _DESIGN_P1_OPTION_GLYPHS = [
  `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><circle cx="12" cy="12" r="8"/></svg>`,
  `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><path d="M12 4l9 16H3z"/></svg>`,
  `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><rect x="4" y="4" width="16" height="16" rx="1.5"/></svg>`,
  `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><path d="M12 3l4 9-4 9-4-9z"/></svg>`,
  `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/></svg>`,
  `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><path d="M12 3l2.6 5.6L20.5 9l-4.5 4 1.1 6L12 16.2 6.9 19 8 13l-4.5-4 5.9-.4z"/></svg>`,
];

// 自由输入 "让我安排" 长卡的星号图标
const _DESIGN_P1_CUSTOM_GLYPH = `<svg ${_DESIGN_P1_GLYPH_SVG_ATTRS}><path d="M12 4v16M5 7l14 10M5 17l14-10"/></svg>`;


// AI 在选项文本里常带 ①②③… 前缀；UI 自己出 mono 编号 chip，剥掉前缀避免重复
// 保留 ✱（"让我看着办"专属标记）和其他非编号前缀
const _DESIGN_P1_LEADING_NUMBER_RE = /^[①-⑳❶-❿➀-➉⓫-⓿]\s*/;








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
      // 处理入口（_resolveInspectionFinding）随老 repair/P2 流程拆除——老历史里的
      // 未处理检查项只读展示，修改一律走 P3 对话。
      const questionHtml = `<div style="font-size: 0.9em; margin-bottom: 8px;">${escapeHTML(finding.question || '')}</div>`;
      const buttonsHtml = (finding.options || [])
        .map(
          opt =>
            `<button class="btn-secondary" style="${btnStyle}" onclick="window.showToast?.('旧版检查项已不可交互——想改的话在对话里直接告诉 AI')">${escapeHTML(opt.label)}</button>`
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

  // 主聊天区滚动条规矩：见 项目内部规范
  // - preserve 分支：DOM 全量重建会让浏览器把 scrollTop 重置为 0，save→restore 让用户视角下零位移
  // - bottom 分支：history-replaced 场景（存档载入/卡切换/模式切换/消息删除）让用户落到最新一轮
  // - design mode 例外：暂禁自动滚到底，bottom 请求统一降级为 preserve（同 scrollController
  //   的 isFollowSuppressed 策略），重置/卡切换都保持用户当前阅读位置。
  const _gameScreen = document.getElementById('game-screen');
  const _followSuppressed = !!(_gameScreen && _gameScreen.getAttribute('data-active-mode') === 'design');
  const _requestedMode = options.scrollMode === 'bottom' ? 'bottom' : 'preserve';
  const scrollMode = _followSuppressed ? 'preserve' : _requestedMode;
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
      if (isDesignMode) {
        const stageName = typeof msg.stageName === 'string' ? msg.stageName : null;
        const modelLabel = resolveDesignModelLabel(msg);
        const isP2 = _isDesignP2Msg(msg);
        // P2 stage/inspection/done 不计入 T<n>，也不走 marker——label 走 stage 名（如有）。
        // 其他 design AI msg 进 T<n> 计数；内部 label 被 CSS 藏，仅由外置 marker 展示。
        if (!isP2) aiTurnCount++;
        name = formatDesignAssistantLabel(modelLabel, stageName, isP2 ? null : aiTurnCount);
        providerKey = resolveDesignProviderKey(msg);
        // 设计模式 AI msg 的耗时/token/费用 metrics bar：复用游戏模式同一 placeholder + renderMetricsBar
        metrics = msg.metrics || null;
      } else {
        aiTurnCount++;
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

  // 设计模式不按每 20 回合折叠：设计对话靠 stage 分段，不需要章节折叠，
  // foldGroups 保持空 → 走"全部显示"分支。
  if (!isDesignMode && totalTurns > firstGroupSize) {
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
        // P2 自动生成阶段（stage / inspection / done）：补 design-p2-msg 类，
        // 让 CSS 露出内部 label（stage 名 header），并和实时渲染时一致
        if (isDesignMode && _isDesignP2Msg(chatHistory[info.originalIndex])) {
          msgEl.classList.add('design-p2-msg');
        } else if (isDesignMode && chatHistory[info.originalIndex]?._designP3Intro) {
          _applyDesignP3IntroStyle(msgEl, chatHistory[info.originalIndex]);
        } else if (isDesignMode && chatHistory[info.originalIndex]?._pzwcBuild) {
          // PZWC 建造手记：重建时补回黑白编辑部画风（实时节点由控制器 aiBubble 挂）
          msgEl.classList.add('pzwc-build-msg');
          if (chatHistory[info.originalIndex]._pzwcAsk) msgEl.classList.add('pzwc-ask');
          if (chatHistory[info.originalIndex]._pzwcNote) msgEl.classList.add('pzwc-note');
        }
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
        if (isDesignMode && _isDesignP2Msg(chatHistory[info.originalIndex])) {
          msgEl.classList.add('design-p2-msg');
        } else if (isDesignMode && chatHistory[info.originalIndex]?._designP3Intro) {
          _applyDesignP3IntroStyle(msgEl, chatHistory[info.originalIndex]);
        } else if (isDesignMode && chatHistory[info.originalIndex]?._pzwcBuild) {
          // PZWC 建造手记：重建时补回黑白编辑部画风（实时节点由控制器 aiBubble 挂）
          msgEl.classList.add('pzwc-build-msg');
          if (chatHistory[info.originalIndex]._pzwcAsk) msgEl.classList.add('pzwc-ask');
          if (chatHistory[info.originalIndex]._pzwcNote) msgEl.classList.add('pzwc-note');
        }
      }
    });
  }

  // 设计模式：为每条 AI msg 生成外置 .design-turn-marker（header strip），
  // 浮在 chatHistory 里前一条 user msg 之上；前面不是 user 时紧贴 AI msg 自己。
  // 整体形成 "marker → 玩家消息 → AI 内容" 的三段结构。
  _rebuildDesignTurnMarkers();

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
          // P3 消息（_p3:true）走 p3UI 历史重建：user 加 class、assistant 重建终态卡 + diff
          if (histMsg?._p3 && window.p3Service?.ui) {
            try {
              if (histMsg.sender === 'user') {
                window.p3Service.ui.renderHistoricalUserCard(msgEl, histMsg);
              } else if (histMsg.sender === 'ai') {
                window.p3Service.ui.renderHistoricalAssistantCard(msgEl, histMsg);
                // P3 卡渲染会删掉 .chat-message-content，metrics bar 直接挂在 msgEl 末尾
                if (histMsg.metrics) {
                  _renderDesignAiMetricsInto(msgEl, histMsg.metrics);
                }
              }
            } catch (e) {
              console.warn('[DesignMode] render P3 historical msg failed:', e);
            }
          }
          // （老 P1 面板 / P2 stage 气泡渲染已随 PZWC 替换退役——
          //  老草稿历史里的 p1/p2 面板消息按普通文本气泡显示）
          // P3 inspection/consistency findings 按钮照常重建
          if (histMsg?.consistencyFindings) {
            renderConsistencyFindingButtons(msgEl, histMsg.consistencyFindings);
          }
          if (histMsg?.inspectionFindings) {
            renderInspectionFindingButtons(msgEl, histMsg.inspectionFindings);
          }
        }
      }

      // 设计模式 AI msg 的 metrics bar：要在"游戏特有的 ReAct 渲染"早退出前先灌一次
      // （否则 isDesignMode return 直接跳过下面所有渲染逻辑，placeholder 永远空着）
      if (isDesignMode && info.metrics && typeof streamVisualizer !== 'undefined') {
        const placeholder = msgEl.querySelector('.metrics-placeholder');
        if (placeholder && !placeholder.querySelector('.metrics-bar')) {
          const metricsHtml = streamVisualizer.renderMetricsBar(info.metrics);
          if (metricsHtml) {
            placeholder.innerHTML = metricsHtml;
            streamVisualizer.bindMetricsEvents(placeholder);
          }
        } else if (!placeholder) {
          // 兜底（P3 卡删了 .chat-message-content → 没 placeholder）：直接挂 footer + metrics
          _renderDesignAiMetricsInto(msgEl, info.metrics);
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
                : (window.worldMeta?.getPanelFields?.()?.panel_status || []);
              const editable = gameOutputRenderer.isLatestTurn
                ? gameOutputRenderer.isLatestTurn(info.uid)
                : false;
              // 翻面态守卫：用户正翻到最新回合状态栏背面编辑（.game-status.is-flipped，可能有未保存 contenteditable 文本）时，
              // 不重渲整段——statusHtml=null 会让下方逻辑改为复用现存 .game-status 节点（保住翻面态/未存文本）。
              // 数据本身已由 focusout 落库；翻回正面后下次 rebuild 正常整渲读到落库新值。
              const editingLive = editable && contentEl.querySelector('.game-status.is-flipped');
              statusHtml = editingLive
                ? null
                : gameOutputRenderer.renderCustomStatus(gd.panel_status, fieldDefs, editable);
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
        } else if (!placeholder && isDesignMode) {
          // 兜底：design AI msg 没 placeholder（enhanceMessages 之前 footer 没建出来——
          // 比如 P3 卡删了 .chat-message-content / setTimeout 时序不对）→ 用
          // _renderDesignAiMetricsInto 直接补 footer + 灌 metrics bar，确保重载后能看到
          _renderDesignAiMetricsInto(msgEl, info.metrics);
        }
      }
    });

    // Quick-start buttons: inject below opening greeting when applicable
    // 注意：设计模式下 `chatMessagesArea` 的第一条 `.chat-message.ai-message` 可能是 .design-turn-marker
    // （marker 浮在 greeting 之上），需要 :not(.design-turn-marker) 才能拿到真正的 greeting msgEl。
    if (shouldShowQuickStartButtons()) {
      const firstMsg = chatMessagesArea.querySelector(
        '.chat-message.ai-message:not(.design-turn-marker)'
      );
      if (firstMsg) {
        const contentEl = firstMsg.querySelector('.chat-message-content');
        if (contentEl && !contentEl.querySelector('.quick-start-buttons-container')) {
          // 新卡出开场选择按钮（推荐主角 / 普通人 / 随机主角）；老卡仍出旧的随机·推荐剧情按钮。
          // 新卡信号双路：① frozen_moment（老向导卡）② 卡里有预设 is_protagonist 主角。新 PZWC 卡走
          // opening_greeting 开局、不产 frozen_moment——只认 frozen_moment 会把它误判成老卡 → 出错的旧
          // 按钮 → 预设主角永不经 NEW_PREDEFINED 播种 → 角色面板不显示主角（实测「废都圣女」即此）。
          // 用预设主角存在性兜底：is_protagonist 是 V2 标记，无主角的卡返回 null，不误伤。
          const hasFrozen = !!window.worldMeta?.getFrozenMoment?.();
          const hasPredefinedProtag = !!window.npcStore?._findProtagonistIdInPool?.();
          contentEl.insertAdjacentHTML(
            'beforeend',
            (hasFrozen || hasPredefinedProtag) ? renderOpeningChoiceButtonsHtml() : renderQuickStartButtonsHtml()
          );
        }
      }
    }
    if (shouldShowDesignQuickStartButtons()) {
      const firstMsg = chatMessagesArea.querySelector(
        '.chat-message.ai-message:not(.design-turn-marker)'
      );
      if (firstMsg) {
        const contentEl = firstMsg.querySelector('.chat-message-content');
        if (contentEl && !contentEl.querySelector('.quick-start-buttons-container')) {
          // 工坊开场：editorial frame 完全替换 chat-message-content（不追加，避免和原 greeting 文本重复）
          contentEl.innerHTML = renderDesignQuickStartButtonsHtml();
          firstMsg.classList.add('dcv-opening');
        }
      }
    }

    // 刷新置顶状态栏观测器
    refreshStickyStatusObserver();


    // P3 历史重建（独立 channel：window.p3ChatHistory，不再混在 designChatHistory 里）
    // 在 design mode 下、phase=p3 时，把 p3ChatHistory 的每条消息渲染为 chat-messages-area 末尾的卡。
    // P3UI 历史重建走 renderHistoricalUserCard / renderHistoricalAssistantCard，跟当前 turn 的卡同款。
    if (
      isDesignMode &&
      chatMessagesArea &&
      window.designService?.phase === 'p3' &&
      Array.isArray(window.p3ChatHistory) &&
      window.p3ChatHistory.length > 0 &&
      window.p3Service?.ui
    ) {
      try {
        for (const histMsg of window.p3ChatHistory) {
          if (!histMsg || !histMsg.sender) continue;
          const msgEl = document.createElement('div');
          if (histMsg.sender === 'user') {
            msgEl.className = 'chat-message user-message';
            const contentEl = document.createElement('div');
            contentEl.className = 'chat-message-content';
            contentEl.textContent = histMsg.text || '';
            msgEl.appendChild(contentEl);
            chatMessagesArea.appendChild(msgEl);
            try { window.p3Service.ui.renderHistoricalUserCard(msgEl, histMsg); } catch (_) {}
          } else if (histMsg.sender === 'ai') {
            msgEl.className = 'chat-message ai-message';
            const contentEl = document.createElement('div');
            contentEl.className = 'chat-message-content';
            msgEl.appendChild(contentEl);
            chatMessagesArea.appendChild(msgEl);
            try { window.p3Service.ui.renderHistoricalAssistantCard(msgEl, histMsg); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn('[refreshChatUI] P3 history rebuild failed:', e);
      }
    }
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
  const safeContent = rawSafeContent;
  // /ooc 消息：meta:'ooc' 整条柔和 / oocNote 剧情上方挂场外行（重建路径，与 addMessage 一致）
  const isOocMsg = senderType === 'user' && options?.message?.meta === 'ooc';
  const oocNote = senderType === 'user' ? (options?.message?.oocNote || '') : '';
  if (isOocMsg) msgEl.classList.add('ooc-message');
  const userContentHtml = _userOocContentHtml(safeContent, isOocMsg, oocNote);

  // AI 气泡：把当前 turn 内的 OOC q&a 拼到 content 头部
  const oocPrefixHtml = senderType !== 'user' ? _buildAdjacentOocPrefixHtml(originalIndex) : '';

  msgEl.innerHTML = `
        <div class="chat-user-label">${safeSenderName}</div>
        <div class="chat-message-content">${oocPrefixHtml}${userContentHtml}</div>
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

  // （老 P1 面板 / P2 stage 气泡的实时渲染已随 PZWC 替换退役）

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
    const safeContent = rawSafeContent;
    // /ooc 消息：meta:'ooc' 整条柔和 / oocNote 剧情上方挂场外行（展开折叠组路径，与 addMessage 一致）
    const isOocMsg = info.sender === 'user' && histMsgForExpand?.meta === 'ooc';
    const oocNote = info.sender === 'user' ? (histMsgForExpand?.oocNote || '') : '';
    if (isOocMsg) msgEl.classList.add('ooc-message');
    const userContentHtml = _userOocContentHtml(safeContent, isOocMsg, oocNote);

    msgEl.innerHTML = `
            <div class="chat-user-label">${safeLabel}</div>
            <div class="chat-message-content">${userContentHtml}</div>
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
        if (isDesignMode && !actionsHtml) return;
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
        } else if (!placeholder && isDesignMode) {
          // 兜底（fold expand 路径同上）：design AI msg 没 placeholder → 直接补 footer + metrics
          _renderDesignAiMetricsInto(msgEl, info.metrics);
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
  const runtimeFields = window.worldMeta?.getPanelFields?.()?.panel_status;
  if (Array.isArray(runtimeFields) && runtimeFields.length > 0) return runtimeFields;

  const inferred = inferStickyStatusFieldDefs(status);
  if (inferred.length > 0) return inferred;

  const locale = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? 'en' : 'zh-CN';
  const defaultFields =
    window.panelSchemaBuilder?.getDefaultStatusFields?.(locale) ||
    window.panelSchemaBuilder?.DEFAULT_STATUS_FIELDS;
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
      const timeText = window.panelSchemaBuilder?.formatTimeValueFromGroup?.(data, group);
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
      const currency = window.panelSchemaBuilder?.getCurrencyLabelFromGroup?.(group) || '';
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
