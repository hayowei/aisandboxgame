// ============================================
// scrollController —— 主聊天区 .chat-messages-area 的唯一滚动管理者
// ============================================
// 见 内部设计文档（Part 2 + 「发送置顶」）。
//
// 模型（实测定稿）：
// - 是否贴底用【同步】距离判定 isAtBottom()（近底 120px 容忍）。早期用异步
//   IntersectionObserver+sentinel 会 stale（refreshChatUI innerHTML='' 重建断
//   观测 → 卡 true → 用户在顶部却被无差别 slam 到底）。同步永不 stale。
// - 粘滞跟随 _following：一旦在跟底就保持，内容插入/折叠不解除；只有用户真的
//   把视图往上拨（scrollTop < 本控制器最后写入值 - 80，内容变化绝不会让
//   scrollTop 变小）才解除转 preserveAnchor（翻看历史不被踹）。这条判据对
//   iOS 延迟 scroll / 触控板惯性 wheel / 内容插入全免疫（实测它们都会让
//   事件类判定假阳、误释放，导致回合末 -344 突跳）。
// - 自动滚动永远只向下追新内容，绝不向上拽用户。
// - 发送置顶 scrollNewTurnToTop(userMsgEl)：底部 spacer 撑足高度后把用户消息
//   平滑滚到视口顶（翻页感），随即正常跟底（答案短则消息稳在顶，长则跟最新
//   文字）。spacer 随回答增长收缩，finalize/abort/重建清。
// - 离散大跳（置顶、回合末落到选项）走 rAF 补间（easeOutCubic ~220ms，可被
//   下次写入打断）；流式每帧小步（<90px）即时写，本就逐帧连续=平滑。
//
// 铁律：除本文件外，任何代码不得对 .chat-messages-area / cma 写
// scrollTop/scrollTo/scrollBy/scrollIntoView（audit:scroll 强制）。
// 所有 scrollTop 写入集中走 setScrollTop()。
(function () {
  'use strict';

  let cma = null;
  let mo = null;
  let _rafPending = false;

  // 发送置顶状态
  let spacer = null; // 单例 <div class="chat-tail-spacer">，始终 cma 末子节点
  let pinnedMsgEl = null;
  let pinActive = false;
  // 粘滞跟随。初值 false，由 isAtBottom() 首次确立（避免初始加载误跟底）。
  let _following = false;
  let _lastSetTop = 0; // 本控制器最后写入的 scrollTop（判定"用户上滚"基准）

  let _tweenRaf = 0;
  let _tweening = false;
  const SMOOTH_MS = 220;
  const SMOOTH_MIN = 90; // 位移 < 此值即时写（小步跟随不套动画，保持逐帧连续）

  function _cancelTween() {
    if (_tweenRaf) {
      cancelAnimationFrame(_tweenRaf);
      _tweenRaf = 0;
    }
    _tweening = false;
  }

  // 唯一 scrollTop 写入口（铁律：除本文件外无人可写 cma 滚动）。
  // smooth=true 且位移够大时用 rAF 补间（ease-out，可被下次写入打断）；
  // 否则即时写（流式每帧小步跟随走这条，保持逐帧连续不卡）。
  function setScrollTop(v, smooth) {
    if (!cma) return;
    _cancelTween(); // 任何新写入都打断正在进行的补间
    const from = cma.scrollTop;
    // _lastSetTop 立刻置最终目标——补间途中 cma.scrollTop 还没到位，
    // 不能被 userScrolledUp() 误判成"用户上滚"。
    _lastSetTop = v;
    if (!smooth || Math.abs(v - from) < SMOOTH_MIN) {
      cma.scrollTop = v; // chat-scroll-allow
      _lastSetTop = cma.scrollTop; // 回读 clamp 后真实值
      return;
    }
    const start = from;
    const dist = v - start;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    _tweening = true;
    const step = () => {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      let p = (now - t0) / SMOOTH_MS;
      if (p >= 1) p = 1;
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      cma.scrollTop = start + dist * eased; // chat-scroll-allow
      if (p < 1) {
        _tweenRaf = requestAnimationFrame(step);
      } else {
        _tweenRaf = 0;
        _tweening = false;
        _lastSetTop = cma.scrollTop;
      }
    };
    _tweenRaf = requestAnimationFrame(step);
  }

  // 用户是否把视图往上拨了（解除粘滞跟随的唯一可靠信号）。
  // 内容插入/折叠绝不会让 scrollTop 变小（overflow-anchor 全 none、不自动调），
  // 只有用户主动上滚会。容差 80 吸收 iOS 回弹小抖。补间途中不判（未到目标）。
  function userScrolledUp() {
    return !_tweening && cma && cma.scrollTop < _lastSetTop - 80;
  }

  function paddingTop() {
    return (cma && parseFloat(getComputedStyle(cma).paddingTop)) || 0;
  }

  function getSpacer() {
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'chat-tail-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      spacer.style.cssText = 'width:100%;flex:0 0 auto;pointer-events:none;';
    }
    return spacer;
  }

  function spacerHeight() {
    return spacer && cma && cma.contains(spacer) ? spacer.offsetHeight : 0;
  }

  // cma 真实内容高度（剔除 spacer）。
  function contentScrollHeight() {
    return cma.scrollHeight - spacerHeight();
  }

  function ensureSpacerLast() {
    if (!cma) return;
    const sp = getSpacer();
    if (!cma.contains(sp) || cma.lastElementChild !== sp) {
      cma.appendChild(sp); // 移到末尾（spacer 必须永远是最后一个子节点）
    }
  }

  // 把 msgEl 顶到视口顶（留 paddingTop 内边距）所需的 scrollTop(desired) 与
  // 底部 spacer 应有高度(need)。msgEl 上方内容不受 spacer 影响，故 desired
  // 与 spacer 无关；need 用"剔除 spacer 的内容高"算，保证可达。
  function pinMetrics(msgEl) {
    const cRect = cma.getBoundingClientRect();
    const mRect = msgEl.getBoundingClientRect();
    const msgOffset = cma.scrollTop + (mRect.top - cRect.top); // msg 顶在滚动内容里的偏移
    const pad = paddingTop();
    const desired = Math.max(0, msgOffset - pad);
    const need = Math.max(0, Math.ceil(desired + cma.clientHeight - contentScrollHeight()));
    return { desired, need };
  }

  // 发送置顶：把用户消息气泡平滑滚到视口顶部，本轮回答在其下方流式生成。
  function scrollNewTurnToTop(msgEl) {
    if (!cma || !msgEl || !cma.contains(msgEl)) return;
    pinnedMsgEl = msgEl;
    pinActive = true;
    ensureSpacerLast();
    const m = pinMetrics(msgEl);
    getSpacer().style.height = m.need + 'px';
    setScrollTop(m.desired, true);
    // enhanceMessages（setTimeout 10）会回流改用户气泡高度 → 下一帧重钉吸收
    requestAnimationFrame(() => {
      if (!pinActive || pinnedMsgEl !== msgEl || !cma.contains(msgEl)) return;
      ensureSpacerLast();
      const m2 = pinMetrics(msgEl);
      getSpacer().style.height = m2.need + 'px';
      setScrollTop(m2.desired, true);
    });
  }

  // 回答增长时收缩 spacer（只减不增；spacer 在 anchor 下方，收缩不动 anchor）。
  function shrinkSpacerToFit() {
    if (!pinActive || !pinnedMsgEl || !cma || !cma.contains(pinnedMsgEl)) return;
    const m = pinMetrics(pinnedMsgEl);
    if (m.need < spacerHeight()) getSpacer().style.height = m.need + 'px';
  }

  // 本轮结束 / 取消 / 重建：仅释放置顶标志。
  // 【不】把 spacer 归 0：短答 finalize 时骤缩 scrollHeight 会被浏览器 clamp
  // 成跳，且会抹掉用户已接受的"短答尾部留白"。残留 spacer 无害（scrollToBottom
  // 跳过它、isAtBottom 剔除它），下一轮重算覆盖、refreshChatUI 重建销毁。
  function clearTurnSpacer() {
    pinActive = false;
    pinnedMsgEl = null;
  }

  // 同步算实际离底距离（近底 120px 容忍），剔除 spacer：贴底=内容尾可见。
  function isAtBottom() {
    if (!cma) return true;
    return contentScrollHeight() - cma.scrollTop - cma.clientHeight <= 120;
  }

  // 把「流式气泡实时内容底部」带入视口。只向下、绝不向上拽：骨架屏消失那刻
  // min-height 锁让框很高、首帧文字短在框顶，delta 为负 → 不动（向上拽正是
  // "骨架屏消失跳"的元凶）；为正（新内容长出屏幕外）→ 追。
  function scrollToBottom(force) {
    if (!cma) return;
    if (!force && !isAtBottom()) return;
    const streaming = cma.querySelector(':scope > .chat-message.streaming-state');
    let target = null;
    if (streaming) {
      target = streaming.querySelector('.md-tail') || streaming;
    } else {
      let last = cma.lastElementChild;
      if (last && last === spacer) last = last.previousElementSibling; // 跳过 spacer
      target = last || null;
    }
    if (target) {
      const cRect = cma.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const delta = tRect.bottom - cRect.bottom;
      if (delta > 0) setScrollTop(cma.scrollTop + delta, true);
    } else {
      const overflow = contentScrollHeight() - cma.clientHeight - cma.scrollTop;
      if (overflow > 0) setScrollTop(contentScrollHeight(), true);
    }
  }

  // 记 viewport 顶第一个稳定可见子元素 offset → fn 改 DOM → 补 delta，
  // 让增长点以上视觉零位移（用户翻看历史 / 旧 turn 折叠时不被抽走）。
  // 选择器【绝不】含 .chat-tail-spacer——spacer 在锚下方，不能当锚。
  function preserveAnchor(fn) {
    if (!cma) {
      if (typeof fn === 'function') fn();
      return;
    }
    const cmaTop = cma.getBoundingClientRect().top;
    let anchor = null;
    let anchorOffset = 0;
    const stable = cma.querySelectorAll(
      ':scope > .chat-message.streaming-complete, :scope > .chat-message.user-message, :scope > .chat-fold-bar, :scope > .chat-expanded-group'
    );
    for (const child of stable) {
      const r = child.getBoundingClientRect();
      if (r.bottom > cmaTop) {
        anchor = child;
        anchorOffset = r.top - cmaTop;
        break;
      }
    }
    if (typeof fn === 'function') fn();
    if (anchor && cma.contains(anchor)) {
      const newOffset =
        anchor.getBoundingClientRect().top - cma.getBoundingClientRect().top;
      const delta = newOffset - anchorOffset;
      if (delta !== 0) setScrollTop(cma.scrollTop + delta);
    }
  }

  // 受控变更：粘滞跟底 → 变更后跟到底；否则 preserveAnchor 钉住阅读位。
  function runScoped(fn) {
    if (!cma) {
      if (typeof fn === 'function') fn();
      return;
    }
    // 平滑补间进行中：照常渲染，但不抢滚动——让补间走完，否则会被一次
    // follow 立刻打断。小步跟随即时写、从不置 _tweening，不受此影响。
    if (_tweening) {
      if (typeof fn === 'function') fn();
      if (pinActive) shrinkSpacerToFit();
      return;
    }
    if (userScrolledUp()) _following = false;
    if (_following || isAtBottom()) {
      _following = true;
      if (typeof fn === 'function') fn();
      scrollToBottom(true);
    } else {
      preserveAnchor(fn);
    }
    if (pinActive) shrinkSpacerToFit();
  }

  // refreshChatUI 全量重建（innerHTML=''）后把用户视角拉回原 scrollTop。
  // 重建即本轮结束、spacer 节点已被 innerHTML='' 销毁 → 重置置顶/跟随状态。
  function restoreScrollTop(top) {
    pinActive = false;
    pinnedMsgEl = null;
    spacer = null;
    _following = false;
    if (!cma || typeof top !== 'number') return;
    setScrollTop(top);
  }

  // 兜底：handler 之外的 DOM 变更（异步图片 / NPC 卡 / footer 填充等）
  // 也跟一下底；rAF 合并。
  function scheduleFollow() {
    if (_rafPending) return;
    _rafPending = true;
    requestAnimationFrame(() => {
      _rafPending = false;
      if (_tweening) return; // 补间进行中不抢滚动（让置顶/大跳动画走完）
      if (userScrolledUp()) _following = false;
      if (_following || isAtBottom()) {
        _following = true;
        scrollToBottom(true);
      }
      if (pinActive) shrinkSpacerToFit();
    });
  }

  function init() {
    if (cma) return;
    cma = document.querySelector('.chat-messages-area');
    if (!cma) return;
    mo = new MutationObserver(() => scheduleFollow());
    mo.observe(cma, { childList: true });
    // 注意：【不】挂 scroll/wheel/touchmove 判"用户滚动→释放跟随"——
    // 实测 iOS 延迟 scroll、触控板惯性 wheel、内容插入都会假阳误释放。
    // 释放统一走 userScrolledUp()（scrollTop 是否被拨小于最后写入值），
    // 对惯性/内容变化免疫。
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.scrollController = {
    isPinned: isAtBottom,
    isAtBottom,
    scrollToBottom,
    preserveAnchor,
    runScoped,
    restoreScrollTop,
    scrollNewTurnToTop,
    shrinkSpacerToFit,
    clearTurnSpacer,
    _init: init,
  };
})();
