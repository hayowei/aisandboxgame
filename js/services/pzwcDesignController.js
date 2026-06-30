// PZWC 设计模式控制器 —— 设计模式「先问再写」的新引擎编排层。
//
// 角色分工：
//   - 引擎（window.pzwcEngine，dist/pzwc-engine.js 岛）：PZWC 内核原样负责一切建造逻辑
//     （提问 → 铺骨架 → patch 建实体/角色/时间线/v2.1 → 体检 → finish 双闸）。
//   - 本控制器：引擎的浏览器 io 实现 + 游戏侧编排。把引擎的叙述/思考/工具流渲染成
//     现有设计模式聊天观感；ask_user 渲染成选择面板（chips + 永远带「让我看着办」逃生项，
//     绝不替用户自动选 —— 红线 feedback_no_system_auto_choices）；BYOK key 从游戏设置喂给
//     引擎；finish 过双闸后先把建成卡以草稿态（_editDraft）写进 worldCardManager 卡库
//     （durable 落点，刷新不丢、存档列表可「继续编辑」），再经 designService.loadCardIntoDesignMode
//     落进 P3 编辑阶段——「应用到游戏」覆盖这张草稿卡收掉草稿态。
//
// 入口：designService.phase === 'pzwc' 时，chatCore.handleDesignModeSendMessage 把用户消息
// 路由到 handleUserMessage —— 第一条消息 = 建造 brief（启动引擎），之后的消息 = ask_user 的
// 回答（resolve pendingAsk）。引擎建造中（无 pendingAsk）时 shouldRejectMessage() 拦截输入。
//
// 约束：
//   - cardStore 是引擎内模块级单例 ⇒ 同时只能跑一个建造（state.running 锁，同 PZWC server.js BUSY）。
//   - 滚动一律走 window.scrollController（主聊天区滚动锁铁律）；本文件绝不直接写 scrollTop。
//   - 顶层只暴露 window.pzwcDesignController 单一对象（防发布 bundle 顶层重名互覆）。

(function () {
  'use strict';

  const state = {
    running: false,
    aborted: false,
    abortController: null,
    pendingAsk: null, // resolve(answer) —— 引擎 ask_user 等待中
    askPanelEl: null, // 当前 ask 选项面板（回答后禁用）
    pendingApproval: null, // resolve({approved,feedback}) —— 引擎 request_build_approval 等待中（A2 审批闸门，独立槽、绝不复用 pendingAsk）
    approvalPanelEl: null, // 当前方案审批面板（答复后禁用）
    loadingEl: null, // 当前回合的 loading 气泡（首个流式/工具事件时移除）
    stream: null, // { el, contentEl, buf } 流式叙述气泡
    thinking: null, // { el, bodyEl, buf } 流式思考折叠块
    usage: { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    providerKey: null,
    modelLabel: null,
    // ---- 断点续建（建造死亡后的恢复态）----
    lastBrief: null, // 最近一次全新建造的原始世界描述（resume/重新生成都要用；续建不覆盖）
    dialog: [], // 本次建造会话的问答进度 [{q, a}]（q='' = 开放回合玩家补充）——引擎对话死了它还在
    lastAskQuestion: null, // 当前问出、还没等到回答的问题（死局时随残卡持久化）
    recovery: null, // { canResume } —— 非空 = 上一局死了、等玩家决定（输入默认=续建指示）
    recoveryIntent: null, // { kind, text } —— 恢复 chips 经 composer 提交前预置的一次性意图
    recoveryPanelEl: null, // 当前恢复面板（消费后禁用）
    recoveryHintEl: null,
    restoredResidual: null, // 刷新后从 localStorage 找回的残卡（选择续建时才喂回引擎）
    sessionCardId: null, // 本次建造会话已落库的卡 id；重 roll/重新生成复用它原地更新（不再每次铸新卡），跨刷新随 residual 找回
  };

  // ---------- 小工具 ----------

  function engine() {
    return window.pzwcEngine || null;
  }

  function chatArea() {
    return document.querySelector('.chat-messages-area');
  }

  function withScroll(fn) {
    const sc = window.scrollController;
    if (sc && typeof sc.runScoped === 'function') sc.runScoped(fn);
    else fn();
  }

  // 节点性追底（建造开始 / ask 出现 / 收尾）：用户刚发完消息或轮到他了，把视图带到底部，
  // 之后流式增长靠 runScoped 的贴底跟随。一律走 scrollController 官方 API（滚动锁铁律）。
  function scrollToLatest() {
    try {
      window.scrollController?.scrollToBottom?.();
    } catch (_) {
      /* ignore */
    }
  }

  function esc(text) {
    if (typeof window.escapeHTML === 'function') return window.escapeHTML(text);
    const d = document.createElement('div');
    d.textContent = String(text);
    return d.innerHTML;
  }

  function fmt(text) {
    if (typeof window.formatMessageContent === 'function') return window.formatMessageContent(text);
    return esc(text);
  }

  function toast(msg) {
    if (typeof window.showToast === 'function') window.showToast(msg);
    else console.log('[pzwc]', msg);
  }

  // 界面文案双语：跟随 app 语言（与 designService._getUiText / chatCore 同口径）。
  // 注意：建造 brief / 续建·重新生成引导（composeResumeBrief/composeRegenBrief）是喂给引擎的
  // **提示词**，不是 UI——卡产物恒 zh-CN（见 finish 交接 _pzwcCardLocale），那些保持中文，只有
  // 渲染给玩家看的外壳（按钮/提示/思考标签/报错/收尾说明）走这里。
  function L(zh, en) {
    try {
      const lang = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
      return String(lang).startsWith('en') ? en : zh;
    } catch (_) {
      return zh;
    }
  }

  function setCancelMode(on) {
    if (typeof window.setSendBtnCancelMode === 'function') window.setSendBtnCancelMode(on);
    else if (typeof setSendBtnCancelMode === 'function') setSendBtnCancelMode(on);
  }

  function removeLoading() {
    if (state.loadingEl) {
      // marker 留着（这一轮真有 AI 内容跟上），只摘 loading 气泡
      state.loadingEl.remove();
      state.loadingEl = null;
    }
  }

  function assistantLabelHtml() {
    try {
      const turn =
        typeof window._nextDesignAiTurnNumber === 'function' ? window._nextDesignAiTurnNumber() : null;
      if (typeof window.formatDesignAssistantLabel === 'function') {
        return esc(window.formatDesignAssistantLabel(state.modelLabel, null, turn));
      }
    } catch (_) {
      /* fall through */
    }
    return esc(state.modelLabel || L('设计助手', 'Design assistant'));
  }

  // 建一个设计模式 AI 气泡（pzwc-build-msg = 黑白编辑部手记画风），返回 content 元素
  function aiBubble(extraClass) {
    const area = chatArea();
    if (!area) return null;
    const el = document.createElement('div');
    el.className =
      'chat-message ai-message design-mode-msg pzwc-build-msg' + (extraClass ? ' ' + extraClass : '');
    el.innerHTML =
      '<div class="chat-user-label">' +
      assistantLabelHtml() +
      '</div><div class="chat-message-content"></div>';
    if (typeof window.applyAiProviderDataset === 'function') {
      window.applyAiProviderDataset(el, state.providerKey);
    }
    withScroll(() => area.appendChild(el));
    return el;
  }

  // ---------- 流式渲染（text / thinking 双通道，对齐 PZWC onStream 协议） ----------

  function handleStream(ev) {
    removeLoading();
    if (ev.kind === 'text') handleTextStream(ev.phase, ev.text);
    else if (ev.kind === 'thinking') handleThinkingStream(ev.phase, ev.text);
  }

  function handleTextStream(phase, text) {
    if (phase === 'abandon') {
      // 引擎轮级重试：丢掉这一轮已渲染的半截叙述（不入史），重试后会重新流出来
      if (state.stream) {
        const s = state.stream;
        state.stream = null;
        withScroll(() => s.el.remove());
      }
      return;
    }
    if (phase === 'start') {
      if (state.stream) handleTextStream('end');
      const el = aiBubble('pzwc-streaming');
      if (!el) return;
      state.stream = { el, contentEl: el.querySelector('.chat-message-content'), buf: '' };
    } else if (phase === 'delta') {
      if (!state.stream) handleTextStream('start');
      if (!state.stream) return;
      state.stream.buf += text || '';
      const s = state.stream;
      withScroll(() => {
        s.contentEl.textContent = s.buf.replace(/^\n+/, '');
      });
    } else if (phase === 'end') {
      if (!state.stream) return;
      const s = state.stream;
      state.stream = null;
      const trimmed = s.buf.trim();
      if (!trimmed) {
        s.el.remove(); // 纯工具回合：没有叙述文本
        return;
      }
      s.el.classList.remove('pzwc-streaming');
      withScroll(() => {
        s.contentEl.innerHTML = fmt(trimmed);
      });
      // 入史：narration 是会话的一部分（刷新/恢复后仍可读）；工具行/面板是瞬态进度，不入史
      // _pzwcBuild: refreshChatUI 重建时凭它补回 pzwc-build-msg（手记画风跨重建/恢复不丢）
      try {
        const msg = { sender: 'ai', text: trimmed, _pzwcBuild: true };
        if (state.providerKey) msg.providerKey = state.providerKey;
        if (state.modelLabel) msg.modelLabel = state.modelLabel;
        chatHistory.push(msg);
        s.el.dataset.originalIndex = chatHistory.length - 1;
        persistTranscript(); // 叙述落定即持久化（硬崩溃也保得住）+ 点亮「已保存」
      } catch (_) {
        /* chatHistory 不可达时只渲染不持久化 */
      }
    }
  }

  function handleThinkingStream(phase, text) {
    if (phase === 'abandon') {
      if (state.thinking) {
        const t = state.thinking;
        state.thinking = null;
        withScroll(() => t.el.remove());
      }
      return;
    }
    if (phase === 'start') {
      if (state.thinking) handleThinkingStream('end');
      const area = chatArea();
      if (!area) return;
      const det = document.createElement('details');
      det.className = 'pzwc-thinking';
      det.open = true;
      det.innerHTML =
        '<summary>' +
        esc(L('思考中…', 'Thinking…')) +
        '</summary><div class="pzwc-thinking-body"></div>';
      withScroll(() => area.appendChild(det));
      state.thinking = { el: det, bodyEl: det.querySelector('.pzwc-thinking-body'), buf: '' };
    } else if (phase === 'delta') {
      if (!state.thinking) handleThinkingStream('start');
      if (!state.thinking) return;
      const t = state.thinking;
      t.buf += text || '';
      withScroll(() => {
        t.bodyEl.textContent = t.buf;
        t.bodyEl.scrollTop = t.bodyEl.scrollHeight; // 块内自滚（非 .chat-messages-area，不违滚动锁）
      });
    } else if (phase === 'end') {
      if (!state.thinking) return;
      const t = state.thinking;
      state.thinking = null;
      if (!t.buf.trim()) {
        t.el.remove();
        return;
      }
      const sum = t.el.querySelector('summary');
      if (sum) sum.textContent = L('思考过程', 'Reasoning');
      t.el.open = false;
    }
  }

  function finalizeStreams() {
    if (state.stream) handleTextStream('end');
    if (state.thinking) handleThinkingStream('end');
  }

  // ---------- 工具动作流 + 实时预览 ----------

  const TOOL_ICON = {
    read_exemplar: 'menu_book',
    write_card: 'foundation',
    patch_card: 'construction',
    query_card: 'search',
    search_card: 'manage_search',
    run_inspection: 'stethoscope',
    finish: 'flag',
    ask_user: 'help',
  };

  function parseInspectionTag(result) {
    if (!result) return null;
    const score = /score=(-?\d+)/.exec(result);
    if (!score) return null;
    // 'NOT PASSED' 也含 'PASSED' 子串——必须先排除否定形态，is-fail chip 才可达
    const failed = /NOT\s+PASSED/i.test(result);
    const passed = !failed && /PASSED/.test(result);
    return {
      passed,
      text: 'score=' + score[1] + (passed ? L(' · 体检通过', ' · passed') : L(' · 未通过', ' · not passed')),
    };
  }

  function handleTool(name, _input, summary, result) {
    removeLoading();
    finalizeStreams();
    if (name === 'ask_user' || name === 'request_build_approval') return; // ask / 审批 走专属面板，不出裸工具行
    const area = chatArea();
    if (area) {
      const row = document.createElement('div');
      row.className = 'pzwc-tool-row';
      const icon = TOOL_ICON[name] || 'build';
      let chipHtml = '';
      if (name === 'run_inspection') {
        const tag = parseInspectionTag(result);
        if (tag) {
          chipHtml =
            '<span class="pzwc-tool-chip ' +
            (tag.passed ? 'is-pass' : 'is-fail') +
            '">' +
            esc(tag.text) +
            '</span>';
        }
      }
      row.innerHTML =
        '<span class="material-symbols-outlined pzwc-tool-icon">' +
        icon +
        '</span><span class="pzwc-tool-name">' +
        esc(name) +
        '</span><span class="pzwc-tool-summary">' +
        esc(stripName(summary, name)) +
        '</span>' +
        chipHtml;
      withScroll(() => area.appendChild(row));
    }
    syncPreview();
  }

  function stripName(summary, name) {
    const s = (summary || '').trim();
    return s.startsWith(name) ? s.slice(name.length).trim() : s;
  }

  // ---------- 残卡持久化（跨刷新找回） ----------
  // 本 key 生命周期独立于 design_mode_* 草稿键：只在显式弃稿（clearStoredDesignDraft 一族）
  // 和控制器自身生命周期点（落地成功 / 放弃 chip）清；状态卫生类清理
  // （sessionManager._clearDesignDraftStorage / initDesignService 预清）故意不碰——
  // 硬崩溃后草稿键可能全缺，残卡正是那场崩溃唯一的幸存物，必须活到找回 offer。
  const RESIDUAL_KEY = 'design_mode_pzwc_residual';

  function persistResidual() {
    try {
      const eng = engine();
      const card = eng ? eng.getCard() : null;
      localStorage.setItem(
        RESIDUAL_KEY,
        JSON.stringify({
          brief: state.lastBrief || '',
          savedAt: Date.now(),
          card: card || null,
          dialog: state.dialog || [],
          pendingQuestion: state.lastAskQuestion || '',
          sessionCardId: state.sessionCardId || null,
        })
      );
    } catch (_) {
      /* quota / 序列化失败不致命——同会话续建仍有内存路径 */
    }
  }

  // 问答进度摘要：续建/重新生成时回放给引擎，避免把玩家答过的问题再问一遍。
  // 只取最近 12 条防 brief 膨胀（更早的要么已写进卡、要么权重本就低）。
  function dialogDigest() {
    const lines = [];
    for (const d of (state.dialog || []).slice(-12)) {
      if (!d || typeof d.a !== 'string') continue;
      if (d.q) {
        lines.push('问：' + d.q);
        lines.push('玩家答：' + d.a);
      } else {
        lines.push('玩家补充：' + d.a);
      }
    }
    if (state.lastAskQuestion) {
      lines.push(
        '（上一轮你向玩家提了下面这个问题、玩家还没回答——请先把它原样重新问一遍、等答复后再继续，不要跳过、也不要换个问法重问别的：' +
          state.lastAskQuestion +
          '）'
      );
    }
    return lines.join('\n');
  }

  function clearResidual() {
    try {
      localStorage.removeItem(RESIDUAL_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function readResidual() {
    try {
      const raw = localStorage.getItem(RESIDUAL_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      return p && (p.card || p.brief) ? p : null;
    } catch (_) {
      return null;
    }
  }

  // 把已渲染的建造对话（chatHistory 里的 _pzwcBuild 消息）落进设计聊天历史，并点亮自动保存指示器。
  // 为什么必须显式存：建造是 fire-and-forget（launchBuild 不被 await），chatCore 的 _fullSave 只在
  // 玩家发消息那一刻跑一次——那时 chatHistory 只有 brief；建造叙述/提问/收尾说明都是之后异步 push 的，
  // 控制器此前从不再存。结果：硬崩溃（无 beforeunload，正是 residual 恢复设计针对的场景）会丢掉整段
  // 可见的建造对话，只剩残卡 + 一个光秃秃的恢复面板。每条建造消息落定后调一次：① 持久化 transcript
  // （刷新/崩溃后 refreshChatUI 凭 _pzwcBuild 重建手记画风）② 顺手把指示器打成「已保存」（此前整段
  // 多分钟建造，指示器全程不亮、零保存反馈）。
  function persistTranscript() {
    try {
      const ds = window.designService;
      if (ds && typeof ds.saveChatHistory === 'function' && typeof chatHistory !== 'undefined') {
        ds.saveChatHistory(chatHistory);
        try { ds._updateSaveIndicator?.('saved'); } catch (_) { /* 指示器不在时忽略 */ }
      }
    } catch (_) {
      /* 持久化失败不致命——同会话内容仍在内存/DOM */
    }
  }

  // 把引擎工作卡镜像进 designService.designConfig → 复用现有右侧预览面板渲染
  // （实体/角色/时间线随建造实时长出来）。只镜像、不落盘（_saveDesignConfig 等 finish）。
  // 残卡随每次工具事件落 localStorage（跨刷新找回的快照点）。
  function syncPreview() {
    const eng = engine();
    const ds = window.designService;
    if (!eng || !ds) return;
    const card = eng.getCard();
    if (!card || !card.snapshot) return;
    try {
      ds.designConfig = JSON.parse(JSON.stringify(card.snapshot));
      if (card.designMeta && card.designMeta.p1Output) {
        ds.p1Output = card.designMeta.p1Output;
      }
      if (typeof ds._updatePreviewPanel === 'function') ds._updatePreviewPanel();
    } catch (e) {
      console.warn('[pzwc] preview sync failed:', e);
    }
    persistResidual();
  }

  // ---------- ask_user 选择面板 ----------

  function disableAskPanel() {
    if (!state.askPanelEl) return;
    state.askPanelEl.classList.add('is-disabled');
    state.askPanelEl.querySelectorAll('button').forEach((b) => {
      b.disabled = true;
      b.classList.add('is-disabled');
    });
    state.askPanelEl = null;
  }

  // ---------- A2 方案审批面板（= ExitPlanMode 的呈现） ----------
  // 摘要气泡（**纯瞬态、不入 chatHistory**，刷新即消失靠 death-recovery 兜底）+ 两枚按钮【开始建造 / 改改方向】，
  // **无逃生项**（区别于 renderAsk:506 永远补「让我看着办」）。按钮直接 resolve state.pendingApproval（仿 recovery 范式，
  // 绝不走 submitViaComposer——否则答复会被当 ask_user 问答误食 + 污染 dialog 回放）。审批期文字输入由 shouldRejectMessage
  // 既有逻辑拦下（running && !pendingAsk 在审批期恒 true），作者只能用按钮；「改改方向」顺带捎走输入框里打的反馈。
  function renderApprovalPanel(summary) {
    removeLoading();
    finalizeStreams();
    const area = chatArea();
    if (!area) return;
    // 防堆叠：清掉上一轮被「改改方向」驳回后残留的审批摘要气泡 + 禁用面板，只留当前这版（不入 chatHistory、移除无副作用）。
    area.querySelectorAll('.pzwc-approval, .pzwc-approval-options').forEach((n) => n.remove());
    const el = aiBubble('pzwc-approval');
    if (el) {
      withScroll(() => {
        el.querySelector('.chat-message-content').innerHTML = fmt(summary);
      });
    }
    const panel = document.createElement('div');
    panel.className = 'pzwc-ask-options pzwc-approval-options';
    const mk = (label, verdictFn, primary) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pzwc-ask-opt' + (primary ? ' pzwc-ask-opt-primary' : '');
      b.setAttribute('data-action', 'pzwc-approval-opt-btn');
      b.textContent = label;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        const resolve = state.pendingApproval;
        if (!resolve) return;
        const verdict = verdictFn();
        state.pendingApproval = null;
        disableApprovalPanel();
        if (verdict && verdict.approved === true) {
          // 批准 → 进入自主建造：发送键回到「暂停」，作者建造途中可中断（对齐答完 ask 的 setCancelMode(true)）。
          // 漏了这行 = 批准后发送键停在「发送」、被 shouldRejectMessage 恒拦，作者无暂停键、只能硬刷新。
          setCancelMode(true);
        } else if (verdict && verdict.feedback) {
          // 改改方向带反馈：记进 dialog，供死局后续建/重新生成回放时不丢作者的方向修正。
          state.dialog.push({ q: '（方案审批）作者要求改方向', a: verdict.feedback });
          try { persistResidual(); } catch (_) { /* ignore */ }
        }
        resolve(verdict);
      });
      return b;
    };
    // 开始建造 = 批准
    panel.appendChild(mk(L('开始建造', 'Start building'), () => ({ approved: true }), true));
    // 改改方向 = 否决 + 捎上输入框里的反馈（照 Claude Code 驳回带反馈）；并清空输入框
    panel.appendChild(
      mk(
        L('改改方向', 'Adjust direction'),
        () => {
          const input = document.querySelector('.chat-input-textbox');
          const fb = input ? String(input.value || '').trim() : '';
          if (input) {
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }
          return { approved: false, feedback: fb };
        },
        false
      )
    );
    withScroll(() => area.appendChild(panel));
    state.approvalPanelEl = panel;
    setCancelMode(false); // 让输入框可打反馈（发送键虽显示但 shouldRejectMessage 会拦，只认按钮）
    scrollToLatest();
    try {
      const input = document.querySelector('.chat-input-textbox');
      if (input) input.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
  }

  function disableApprovalPanel() {
    if (!state.approvalPanelEl) return;
    state.approvalPanelEl.classList.add('is-disabled');
    state.approvalPanelEl.querySelectorAll('button').forEach((b) => {
      b.disabled = true;
      b.classList.add('is-disabled');
    });
    state.approvalPanelEl = null;
  }

  function renderAsk(meta) {
    removeLoading();
    finalizeStreams();
    const area = chatArea();
    if (!area) return;
    const question = ((meta && meta.question) || '').trim();
    const options = ((meta && meta.options) || []).filter(
      (o) => typeof o === 'string' && o.trim()
    );

    // 问答进度：记下当前待答问题并随残卡落盘——死在"问了没答"时，续建/重新生成能接着问
    state.lastAskQuestion = question;
    persistResidual();

    if (question) {
      const el = aiBubble('pzwc-ask');
      if (el) {
        withScroll(() => {
          // 「提出问题」眉标走 CSS ::before（挂在 .pzwc-ask 上）——重建后照样有
          el.querySelector('.chat-message-content').innerHTML = fmt(question);
        });
        // 问题入史（恢复会话时能看到问到哪了；选项面板是瞬态、不入史）
        try {
          const msg = { sender: 'ai', text: question, _pzwcBuild: true, _pzwcAsk: true };
          if (state.providerKey) msg.providerKey = state.providerKey;
          if (state.modelLabel) msg.modelLabel = state.modelLabel;
          chatHistory.push(msg);
          el.dataset.originalIndex = chatHistory.length - 1;
          persistTranscript(); // 提问落定即持久化 + 点亮「已保存」
        } catch (_) {
          /* ignore */
        }
      }
    } else {
      // 空问题 = 引擎把话语权交回（end_turn 续聊），给一条轻提示
      const hint = document.createElement('div');
      hint.className = 'pzwc-turn-hint';
      hint.textContent = L(
        '轮到你了——继续补充，或输入「继续」让它接着建。',
        'Your turn — add more, or type “continue” to let it keep building.'
      );
      withScroll(() => area.appendChild(hint));
    }

    if (options.length) {
      const panel = document.createElement('div');
      panel.className = 'pzwc-ask-options';
      const mk = (label, isEscape) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pzwc-ask-opt' + (isEscape ? ' pzwc-ask-opt-escape' : '');
        b.setAttribute('data-action', 'pzwc-ask-opt-btn');
        b.textContent = label;
        b.addEventListener('click', () => {
          if (b.disabled) return;
          submitViaComposer(
            isEscape ? L('让我看着办，你来决定。', 'You decide — use your best judgment.') : label
          );
        });
        return b;
      };
      options.forEach((o) => panel.appendChild(mk(o.trim(), false)));
      // 逃生项永远由 UI 补——模型侧被告知不要自带；点击=用户主动选择，绝非自动前进
      panel.appendChild(mk(L('✱ 让我看着办', '✱ You decide'), true));
      withScroll(() => area.appendChild(panel));
      state.askPanelEl = panel;
    }

    setCancelMode(false); // 等回答期间，发送键回到「发送」
    scrollToLatest(); // 它问你了——把问题和选项带进视口
    try {
      const input = document.querySelector('.chat-input-textbox');
      if (input) input.focus({ preventScroll: true });
    } catch (_) {
      /* ignore */
    }
  }

  // chips 走标准 composer 发送路径：用户消息渲染/入史/路由全部复用 canonical 流程。
  // 返回是否真的把消息送出去了——调用方（恢复面板按钮）凭它决定成功禁面板 / 失败清陈旧 intent。
  function submitViaComposer(text) {
    const input = document.querySelector('.chat-input-textbox');
    const sendBtn = document.querySelector('[data-action~="chat-send-btn"]');
    if (input && sendBtn) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      sendBtn.click();
      return true;
    }
    // 兜底：composer 不可达时直接 resolve（极端环境下保流程不死）。
    if (state.pendingAsk) {
      const resolve = state.pendingAsk;
      state.pendingAsk = null;
      // 与 handleUserMessage 正常路径一致地记账，否则续建/重新生成回放会漏掉该回合的玩家答复。
      state.dialog.push({ q: state.lastAskQuestion || '', a: text });
      state.lastAskQuestion = null;
      try { persistResidual(); } catch (_) {}
      disableAskPanel();
      resolve(text);
      return true;
    }
    return false; // composer 缺失且无 pendingAsk——调用方需兜底（清陈旧 intent，别留半截状态）
  }

  // 恢复面板按钮统一走这里：先置 intent，成功送出立刻禁面板（堵双击/intent 被覆盖那条 race），
  // 送不出去（composer 不可达）则把陈旧 intent 清掉 + 提示用户改用文字，按钮保持可点以便重试。
  function submitRecoveryIntent(kind, text) {
    state.recoveryIntent = { kind, text };
    if (submitViaComposer(text)) {
      disableRecoveryPanel();
    } else {
      state.recoveryIntent = null;
      toast(L('输入框暂不可用——请直接在下方输入你的指示继续', 'The input box is unavailable — type your instructions below to continue'));
    }
  }

  // ---------- 用量 ----------

  function handleUsage(u) {
    state.usage.turns++;
    state.usage.inputTokens += u.inputTokens || 0;
    state.usage.outputTokens += u.outputTokens || 0;
    state.usage.cacheReadTokens += u.cacheReadTokens || 0;
    // Analytics 成本台账：建造是全 app 最贵的 AI 跑动（几十轮 · 单轮 ~200k token），却因为
    // PZWC 引擎走自己的 fetch（绕开 _callSummaryAPI 那条通道）此前对成本聚合完全隐形。
    // 每个引擎回合 = 一次 LLM 调用 → 补发一条 ai.subagent.response（subsystem 'design_pzwc'，
    // 仿 P1/P2/P3），让建造进成本聚合（在线托管 AI 计费 + debug 费用面板都依赖它）。
    try {
      const ai = window.aiService;
      ai?._trackSubagentCall?.({
        subsystem: 'design_pzwc',
        provider: ai.getProviderForModule?.('design') || state.providerKey || null,
        model: ai.getModelForModule?.('design') || state.modelLabel || null,
        durationMs: null, // 引擎 onUsage 不带单回合耗时；成本聚合按 token 不依赖它
        metrics: {
          inputTokens: u.inputTokens || 0,
          outputTokens: u.outputTokens || 0,
          cacheReadTokens: u.cacheReadTokens || 0,
          cacheCreationTokens: 0,
          stopReason: null,
        },
        ok: true,
      });
    } catch (_) {
      /* telemetry 绝不能往建造流程抛 */
    }
  }

  function usageLine() {
    const s = state.usage;
    if (!s.turns) return '';
    const n = (x) => (x || 0).toLocaleString('en-US');
    return L(
      '用量：' +
        s.turns +
        ' 轮 · 输入 ' +
        n(s.inputTokens) +
        ' / 输出 ' +
        n(s.outputTokens) +
        ' tokens' +
        (s.cacheReadTokens ? '（缓存命中 ' + n(s.cacheReadTokens) + '）' : ''),
      'Usage: ' +
        s.turns +
        ' turns · in ' +
        n(s.inputTokens) +
        ' / out ' +
        n(s.outputTokens) +
        ' tokens' +
        (s.cacheReadTokens ? ' (cache hits ' + n(s.cacheReadTokens) + ')' : '')
    );
  }

  // ---------- 引擎配置（BYOK：游戏设置 → 引擎 llmConfig） ----------

  function configureEngine() {
    const eng = engine();
    const ai = window.aiService;
    if (!eng) return { ok: false, reason: L('PZWC 引擎未加载（dist/pzwc-engine.js）', 'PZWC engine not loaded (dist/pzwc-engine.js)') };
    if (!ai) return { ok: false, reason: L('aiService 未加载', 'aiService not loaded') };
    const provider = ai.getProviderForModule('design');
    const model = ai.getModelForModule ? ai.getModelForModule('design') : null;
    const key = ai.getApiKeyForModule('design');
    const thinking = typeof ai.getModuleThinking === 'function' ? ai.getModuleThinking('design') : 'high';
    if (!provider || !model) {
      return {
        ok: false,
        reason: L(
          '设计模块还没配置模型——到「设置 → API 设置」选一个服务商和模型。',
          'No model configured for the design module — pick a provider and model under Settings → API.'
        ),
      };
    }
    if (!key) {
      return {
        ok: false,
        reason: L(
          '设计模块还没配置 API key——到「设置 → API 设置」填一个。',
          'No API key configured for the design module — add one under Settings → API.'
        ),
      };
    }
    // 自定义服务商：把游戏侧定义镜像进引擎注册表（字段形状两边同构）
    const isBuiltin = eng.providers.BUILTIN_PROVIDERS.some((p) => p.id === provider);
    if (!isBuiltin) {
      const customs =
        (typeof ai.getCustomProviders === 'function' ? ai.getCustomProviders() : null) ||
        (ai.config && ai.config.customProviders) ||
        [];
      const def = customs.find((c) => c && c.id === provider);
      if (!def) return { ok: false, reason: L('未知服务商 ' + provider, 'Unknown provider ' + provider) };
      eng.config.upsertCustomProvider({
        id: def.id,
        name: def.name,
        baseUrl: def.baseUrl,
        protocol: def.protocol,
        defaultModel: model,
      });
    }
    eng.config.setProviderApiKey(provider, key);
    eng.config.setActive({ provider, model, thinking });
    return { ok: true };
  }

  // ---------- 建造生命周期 ----------

  function makeIO(resumeApproved) {
    state.abortController = new AbortController();
    return {
      mode: 'interactive',
      resumeApproved: resumeApproved === true, // 续建：残卡已在原局获批 → 引擎 planApproved 起手即 true，不再弹二次审批
      log(line) {
        const t = (line || '').trim();
        if (!t) return;
        removeLoading();
        finalizeStreams();
        const area = chatArea();
        if (!area) return;
        const el = document.createElement('div');
        el.className = 'pzwc-engine-line';
        el.textContent = t;
        withScroll(() => area.appendChild(el));
      },
      onStream: handleStream,
      onTool: handleTool,
      onUsage: handleUsage,
      askUser(_prompt, meta) {
        return new Promise((resolve) => {
          if (state.aborted) return resolve(null);
          state.pendingAsk = resolve;
          renderAsk(meta || {});
        });
      },
      // A2 审批闸门（= ExitPlanMode）：引擎 request_build_approval 调它出方案、等作者裁决。
      // 用独立的 state.pendingApproval 槽（绝不复用 pendingAsk——否则答复会被 handleUserMessage 当 ask 问答误食、污染 dialog 回放）。
      requestApproval(summary) {
        return new Promise((resolve) => {
          if (state.aborted) return resolve(null);
          state.pendingApproval = resolve;
          renderApprovalPanel(String(summary || ''));
        });
      },
      shouldAbort() {
        return state.aborted;
      },
      signal: state.abortController.signal,
    };
  }

  // 续建 brief：残卡还在引擎 cardStore 里，卡才是真状态（上一局的 LLM 对话已销毁）。
  // 引导 agent 先读卡自我定位，再以 patch 修补——明确禁止整卡重写，防止把残卡清掉。
  // 问答进度（dialogDigest）一并回放：对话死了，但玩家答过的别再问一遍。
  function composeResumeBrief(instruction) {
    const digest = dialogDigest();
    return (
      '【续建】上一次建造中断了，工作卡（worldcard）还在你手上——这不是新建造。' +
      '不要从零开始，也不要用 write_card 整卡重写。\n' +
      '先 query_card 看全卡现状、run_inspection 找剩余问题，然后用 patch_card 接着修完，体检通过后 finish。\n' +
      '原始需求（卡应符合它）：' +
      (state.lastBrief || '（未记录——以卡内现状为准）') +
      (digest ? '\n上一局你和玩家的问答进度（已是有效输入，不要重复提问）：\n' + digest : '') +
      (instruction ? '\n玩家此刻的补充指示（优先满足）：' + instruction : '')
    );
  }

  // 重新生成 brief：从头重建（干净工作卡），但带上原始需求 + 已有问答进度——
  // 玩家点「重新生成」是想重跑建造，不是想把答过的问题再答一遍。
  function composeRegenBrief() {
    const digest = dialogDigest();
    return (
      '【重新生成】上一次建造中断了，这次从头重建一张新卡。\n' +
      '原始需求：' +
      (state.lastBrief || '（未记录）') +
      (digest
        ? '\n此前你和玩家的问答进度如下（视为有效输入，不要把同样的问题再问一遍）：\n' +
          digest +
          '\n基于以上信息继续：还缺关键信息就接着往下问，信息够了就直接开始建造。'
        : '')
    );
  }

  // 注意：本函数跑完整个建造（几分钟量级），绝不能被 handleUserMessage await——
  // 否则外层 handleSendMessage 的 isSending 会锁死 composer，ask_user 永远无法回答。
  // opts.resume = 断点续建：保留引擎残卡，brief 换成续建引导（原始需求不覆盖）。
  // opts.regen  = 用原描述重新生成：干净工作卡，但保留原始需求 + 问答进度并回放。
  async function launchBuild(brief, ctx, opts) {
    const resume = !!(opts && opts.resume);
    const regen = !!(opts && opts.regen);
    state.loadingEl = (ctx && ctx.loadingEl) || null;
    const cfg = configureEngine();
    if (!cfg.ok) {
      removeLoading();
      const el = aiBubble('pzwc-error');
      if (el)
        withScroll(() => {
          el.querySelector('.chat-message-content').innerHTML = fmt('⚠️ ' + cfg.reason);
        });
      return;
    }
    const eng = engine();
    state.running = true;
    state.aborted = false;
    state.pendingAsk = null;
    state.recovery = null;
    disableRecoveryPanel();
    state.usage = { turns: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    state.providerKey = (ctx && ctx.providerKey) || null;
    state.modelLabel = (ctx && ctx.modelLabel) || null;
    if (!resume) {
      eng.setCard(null); // 新建造/重新生成 = 干净工作卡（续建保留残卡）
      state.restoredResidual = null;
      if (!regen) {
        // 真·全新建造：换需求、问答进度归零（regen 保留两者用于回放）
        state.lastBrief = brief;
        state.dialog = [];
        state.lastAskQuestion = null;
        state.sessionCardId = null; // 换需求从零建 = 新世界 = 该铸新卡（regen 保留 sessionCardId 以原地更新同一张）
      }
      persistResidual(); // 先落 brief：开局即崩也能「用原描述重新生成」
    } else if (state.restoredResidual) {
      // 刷新后找回的残卡：选择续建时才喂回引擎
      eng.setCard(state.restoredResidual);
      state.restoredResidual = null;
    }
    setCancelMode(true);
    scrollToLatest(); // 建造开始：带到底部，后续流式靠 runScoped 贴底跟随

    let finished = { done: false };
    try {
      finished = await eng.runAgent(
        resume ? composeResumeBrief(brief) : regen ? composeRegenBrief() : brief,
        makeIO(resume)
      );
    } catch (e) {
      console.error('[pzwc] runAgent threw:', e);
      finished = { done: false, engineError: String((e && e.message) || e) };
    }
    finishRun(finished);
  }

  function finishRun(finished) {
    state.running = false;
    const resolve = state.pendingAsk;
    state.pendingAsk = null;
    if (resolve) resolve(null);
    disableAskPanel();
    // A2：收尾时若仍卡在审批 await，resolve pendingApproval(null) + 收面板，防 await 泄漏。
    const resolveAppr = state.pendingApproval;
    state.pendingApproval = null;
    if (resolveAppr) resolveAppr(null);
    disableApprovalPanel();
    finalizeStreams();
    removeLoading();
    setCancelMode(false);

    const eng = engine();
    const card = eng ? eng.getCard() : null;

    if (finished.done && card) {
      try {
        eng.stampManifest(card, finished.cardName || card.name || 'card');
      } catch (e) {
        // stampManifest 只写 manifest 信封字段、理论上不抛——但若抛了，绝不能让异常冒泡
        // 把建好的卡连同交接一起带走（finding #12）。吞掉后继续交接（manifest 缺字段不致命）。
        console.error('[pzwc] stampManifest threw (non-fatal):', e);
      }
      // 防御性补戳（finding #13）：PZWC 卡能落库全靠引擎 finish 的 checkLoadability 闸门要求
      // snapshot._schema_version===2。若未来 re-vendor 削弱了那道闸门，这里兜底盖戳，避免刚建好的
      // 卡因缺戳被读回时当成 V1 锁死。引擎已盖时此句幂等。
      try {
        if (card.snapshot && typeof card.snapshot === 'object' && card.snapshot._schema_version == null) {
          card.snapshot._schema_version =
            (window.cardSchemaVersion && window.cardSchemaVersion.CURRENT) || 2;
        }
      } catch (_) { /* defensive */ }
      const ds = window.designService;
      const mgr = window.worldCardManager;
      // ★ 先把建成的卡以草稿态落进卡库，再交接设计模式——finish→「应用到游戏」之间的窗口期
      // 从此有 durable 落点：刷新/崩溃后卡库里仍有这张「编辑中」卡，存档列表「继续编辑」无损恢复。
      // 旧实现只把卡交给设计态内存就 clearResidual：卡库无卡（_editDraft 无家可归、
      // _scheduleP3Persist 的 update 静默失败）、card-edit 会话又不落盘 design_mode_* 草稿键，
      // 这个窗口刷新 = 整局建造蒸发。
      let libCard = null;
      try {
        const cardName = finished.cardName || card.name || '未命名世界';
        const cardDesc = card.description || card.snapshot?.world_setting?._summary || '';
        const cardLocale = card.contentLocale || 'zh-CN';
        // 本次建造会话已落过库（首次 finish 后记下 sessionCardId）→ 重 roll/重新生成原地更新同一张，
        // 不再每次铸新卡（这是同一世界反复重建堆出几百张副本的根因）。卡被手删/是内置卡时回退新建。
        const reuseId = state.sessionCardId;
        const reuseCard = reuseId && mgr && typeof mgr.get === 'function' ? mgr.get(reuseId) : null;
        const canReuse =
          !!reuseCard && !(typeof mgr.isBuiltInCard === 'function' && mgr.isBuiltInCard(reuseId));
        if (canReuse && typeof mgr.update === 'function') {
          libCard = mgr.update(reuseId, {
            snapshot: card.snapshot,
            name: cardName,
            description: cardDesc,
            localizedContentLocale: cardLocale,
            localizedName: cardName,
            localizedDescription: cardDesc,
            designMeta: card.designMeta || null,
          });
        }
        if (!libCard && mgr && typeof mgr.create === 'function') {
          libCard = mgr.create(cardName, card.snapshot, cardDesc, {
            contentLocale: cardLocale,
            designMeta: card.designMeta || null,
            manifest: card.manifest || null,
          });
          if (libCard) state.sessionCardId = libCard.id; // 首次落库：记下本次会话的卡 id，后续重 roll 原地更新它
        }
      } catch (e) {
        console.error('[pzwc] 建成卡写入卡库失败:', e);
        libCard = null;
      }
      if (!libCard) {
        // 落库失败（配额满等）：残卡保留（最后一次 syncPreview 已写）+ 卡还在引擎 cardStore，
        // 刷新可找回、恢复面板可续——绝不在没有 durable 拷贝时继续交接。
        systemNote(
          L(
            '⚠️ 卡已建成，但写入卡库失败（多半是存储空间不足）。清理一些旧存档或世界卡后，用下方按钮继续。',
            '⚠️ The card was built, but saving it to the library failed (likely out of storage). Free up some space, then continue below.'
          )
        );
        persistResidual();
        state.recovery = { canResume: true };
        renderRecoveryPanel(true);
        return;
      }
      // 草稿态标记：presence 即「编辑中」——卡库挂徽章、该卡「开新游戏」被挡，应用/放弃才了结
      // （对齐 worldCardUI._doLoadCardIntoDesignMode 的进编辑语义）。失败不致命：卡已是正式态
      // 可玩拷贝，且 p3Service._scheduleP3Persist 每条消息都会重写 _editDraft。
      try {
        const marked = mgr.update(libCard.id, { _editDraft: libCard.snapshot });
        if (marked === null) console.warn('[pzwc] _editDraft 草稿标记写入失败（存储空间不足？）');
      } catch (_) {
        /* 见上 */
      }
      try {
        window.analyticsService?.track?.('feature.world_card_created', {
          card_id: libCard.id,
          source: 'pzwc_build',
        });
      } catch (_) {
        /* noop */
      }
      let res = null;
      try {
        res = ds && typeof ds.loadCardIntoDesignMode === 'function' ? ds.loadCardIntoDesignMode(libCard) : null;
      } catch (e) {
        // 交接路上的任何异常都不许吞掉建好的卡——诚实报告 + 卡已在卡库可从存档列表恢复
        console.error('[pzwc] loadCardIntoDesignMode threw:', e);
        res = { ok: false, reason: String((e && e.message) || e) };
      }
      if (res && res.ok) {
        // 「应用到游戏」时可直接覆盖这张草稿卡收掉草稿态（弹窗里仍可选「另存为新卡」）
        ds._allowOverwriteFromCardEdit = true;
        // 标记「PZWC 新建草稿卡」：首次 apply 覆盖时保持老语义（退出设计模式自动开新局）。
        // loadCardIntoDesignMode 开任何新编辑会话都会清掉它，不会泄漏到后续编辑。
        ds._pzwcFreshDraftCardId = libCard.id;
        clearResidual(); // 卡已 durable 落进卡库（草稿态），残卡快照使命完成
        // 刷新卡库列表：「编辑中」徽章立刻可见（含双 pane 侧栏 saves）
        try {
          if (typeof renderSaveSlots === 'function') renderSaveSlots();
        } catch (_) {
          /* noop */
        }
        // 卡语言以引擎产物为准（恒 zh-CN）——apply 时盖 contentLocale 用它，
        // 不被游戏的"设计语言"设置误标（loadCardIntoDesignMode 已先清场）。
        ds._pzwcCardLocale = card.contentLocale || 'zh-CN';
        try {
          window.p3Service?.bootstrap?.(ds.designConfig);
        } catch (e) {
          console.warn('[pzwc] p3Service.bootstrap failed (non-fatal):', e);
        }
        systemNote(
          L(
            '✓ 建造完成——体检与加载性双闸已通过' +
              (finished.note ? '：' + finished.note : '。') +
              '\n\n这张卡已存入卡库（「编辑中」状态，刷新也不会丢）。可以继续在对话里让 AI 精修，右上「前往预览确认」后应用到游戏。\n' +
              usageLine(),
            '✓ Build complete — passed both the inspection and loadability gates' +
              (finished.note ? ': ' + finished.note : '.') +
              '\n\nThe card is now saved in your library (marked “editing” — it survives a refresh). Keep refining it with the AI in chat, then use “Go to preview” at the top right to apply it to the game.\n' +
              usageLine()
          )
        );
      } else {
        systemNote(
          L(
            '⚠️ 卡已建成并存入卡库（「编辑中」状态），但进入编辑阶段失败：' +
              ((res && res.reason) || '未知原因') +
              '。可到存档列表对这张卡「继续编辑」。',
            '⚠️ The card was built and saved to your library (marked “editing”), but entering the editing stage failed: ' +
              ((res && res.reason) || 'unknown reason') +
              '. Use “Keep editing” on it in the saves list.'
          )
        );
      }
      return;
    }

    // 失败 / 中止 / 步数耗尽 —— 与 PZWC 控制台同一套诚实归因
    const ranOut =
      finished.stopReason &&
      ['max_iters', 'nudge_cap', 'max_tokens_cap', 'no_progress'].includes(finished.stopReason);
    let passed = false;
    if (card && eng) {
      try {
        passed = !!eng.runInspection(card).passed;
      } catch (_) {
        passed = false;
      }
    }
    let why;
    if (state.aborted) why = L('已停止。', 'Stopped.');
    else if (finished.engineError)
      why = L(
        '建造中断：引擎 / 接口出错（' +
          finished.engineError +
          '）。已自动重试过仍失败——可能是网络不稳或 API key 问题。',
        'Build interrupted: engine / API error (' +
          finished.engineError +
          '). Auto-retried but still failed — likely an unstable network or an API key issue.'
      );
    else if (ranOut && passed)
      why = L(
        '步数用完了，但这张草稿其实已通过体检——只是模型没主动收尾。点下方「继续修这张卡」让它直接收尾。',
        'Ran out of steps, but this draft already passes inspection — the model just didn’t finalize. Click “Keep editing this card” below to let it finalize directly.'
      );
    else if (ranOut) why = L('建到一半步数用完了，卡还没修完。', 'Ran out of steps mid-build — the card isn’t finished yet.');
    else why = L('没通过体检 / 加载性闸门，卡未落地。', 'Did not pass the inspection / loadability gate — the card was not applied.');
    systemNote('● ' + why + (state.usage.turns ? '\n' + usageLine() : ''));
    // 死局恢复：工作卡在引擎 cardStore 里活过了失败/中止（只有下一次全新建造才清），
    // 给玩家明确的可点选项 + 把"接下来输入文字会发生什么"说清楚（拆「继续」陷阱）。
    persistResidual(); // 最终状态快照（含 brief）——刷新后仍可找回
    state.recovery = { canResume: !!card };
    renderRecoveryPanel(!!card);
  }

  // ---------- 死局恢复面板 ----------

  function disableRecoveryPanel() {
    if (state.recoveryPanelEl) {
      state.recoveryPanelEl.classList.add('is-disabled');
      state.recoveryPanelEl.querySelectorAll('button').forEach((b) => {
        b.disabled = true;
        b.classList.add('is-disabled');
      });
      state.recoveryPanelEl = null;
    }
    if (state.recoveryHintEl) {
      state.recoveryHintEl.classList.add('is-disabled');
      state.recoveryHintEl = null;
    }
  }

  function renderRecoveryPanel(canResume) {
    const area = chatArea();
    if (!area) return;
    disableRecoveryPanel(); // 防御：不该有旧面板残留
    const panel = document.createElement('div');
    panel.className = 'pzwc-recover-options';
    const mk = (label, handler, isEscape) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pzwc-recover-opt' + (isEscape ? ' pzwc-recover-opt-escape' : '');
      b.setAttribute('data-action', 'pzwc-recover-btn');
      b.textContent = label;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        handler();
      });
      return b;
    };
    if (canResume) {
      // chips 走标准 composer 路径（用户消息渲染/入史复用 canonical 流程）；
      // intent 先行预置，handleUserMessage 消费时按它分流。送出/失败的善后统一交 submitRecoveryIntent。
      panel.appendChild(
        mk(L('▶ 继续修这张卡', '▶ Keep editing this card'), () => {
          submitRecoveryIntent('resume', L('继续修这张卡', 'Keep editing this card'));
        })
      );
    }
    if (state.lastBrief) {
      panel.appendChild(
        mk(L('↻ 用原描述重新生成', '↻ Regenerate from the original description'), () => {
          submitRecoveryIntent('regen', L('用原描述重新生成', 'Regenerate from the original description'));
        })
      );
    }
    if (canResume) {
      // 放弃 = 纯本地动作（不发消息、不起建造），只解除"输入=续建"的语义
      panel.appendChild(
        mk(L('✕ 放弃这张残卡', '✕ Discard this draft'), () => {
          disableRecoveryPanel();
          state.recovery = null;
          state.restoredResidual = null;
          state.dialog = [];
          state.lastAskQuestion = null;
          state.sessionCardId = null; // 放弃残卡 = 干净状态，下次建造从零铸新卡（不复用旧 id）
          clearResidual();
          const area2 = chatArea();
          if (area2) {
            const h = document.createElement('div');
            h.className = 'pzwc-turn-hint';
            h.textContent = L(
              '已放弃中断的草稿——现在描述一个新世界即可重新开始。',
              'Discarded the interrupted draft — describe a new world to start over.'
            );
            withScroll(() => area2.appendChild(h));
          }
        }, true)
      );
    }
    const hint = document.createElement('div');
    hint.className = 'pzwc-recover-hint';
    hint.textContent = canResume
      ? L(
          '工作卡还在。直接输入文字 = 带着你的指示继续修这张卡；想换世界先点「放弃」。',
          'The working card is still here. Type anything = keep editing it with your instructions; to switch worlds, click “Discard” first.'
        )
      : L('直接输入新的世界描述即可重新开始。', 'Type a new world description to start over.');
    withScroll(() => {
      area.appendChild(panel);
      area.appendChild(hint);
    });
    state.recoveryPanelEl = panel;
    state.recoveryHintEl = hint;
    scrollToLatest(); // 选项必须可见
  }

  function systemNote(text) {
    const el = aiBubble('pzwc-note');
    if (!el) return;
    withScroll(() => {
      el.querySelector('.chat-message-content').innerHTML = fmt(text);
    });
    scrollToLatest(); // 收尾说明（完成/失败归因）必须可见
    try {
      const msg = { sender: 'ai', text, _pzwcBuild: true, _pzwcNote: true };
      if (state.providerKey) msg.providerKey = state.providerKey;
      if (state.modelLabel) msg.modelLabel = state.modelLabel;
      chatHistory.push(msg);
      el.dataset.originalIndex = chatHistory.length - 1;
      persistTranscript(); // 收尾说明落定即持久化 + 点亮「已保存」
    } catch (_) {
      /* ignore */
    }
  }

  // ---------- 对外接口 ----------

  // chatCore.handleDesignModeSendMessage 渲染完用户消息后调用。
  // ctx = { loadingEl, providerKey, modelLabel }
  async function handleUserMessage(message, ctx) {
    if (state.running) {
      if (state.pendingAsk) {
        // ask_user 的回答：摘掉旧 loading（引擎下一回合的 loading 由本次 ctx 提供）
        const resolve = state.pendingAsk;
        state.pendingAsk = null;
        disableAskPanel();
        // 问答进度入账（q='' = 开放回合的玩家补充）——续建/重新生成回放用
        state.dialog.push({ q: state.lastAskQuestion || '', a: message });
        state.lastAskQuestion = null;
        persistResidual();
        state.loadingEl = (ctx && ctx.loadingEl) || null;
        setCancelMode(true);
        resolve(message);
        return;
      }
      // 不应到达（shouldRejectMessage 先拦），防御性兜底
      if (ctx && ctx.loadingEl) ctx.loadingEl.remove();
      toast(L('引擎正在建造中——等它提问，或先点暂停', 'The engine is building — wait for it to ask, or pause first'));
      return;
    }
    // 死局恢复态：上一局死了、残卡/原描述还在——按恢复语义分流（面板 hint 已向玩家说明）
    if (state.recovery) {
      // intent 只认"chip 预置文本 === 实际消息"（composer 路径失败留下的陈旧 intent 不误食普通输入）
      const intentObj = state.recoveryIntent;
      state.recoveryIntent = null;
      const intent = intentObj && intentObj.text === message ? intentObj.kind : null;
      const canResume = state.recovery.canResume;
      state.recovery = null;
      disableRecoveryPanel();
      if (intent === 'regen') {
        // 「用原描述重新生成」：干净工作卡，原始需求 + 问答进度回放（别再问一遍答过的）
        if (state.lastBrief) {
          void launchBuild(state.lastBrief, ctx, { regen: true });
        } else {
          void launchBuild(message, ctx); // 无原描述可用（不应到达）：退化为新建造
        }
        return;
      }
      if (canResume) {
        // 「继续修这张卡」chip（无补充指示）或直接输入（输入 = 续建指示）
        void launchBuild(intent === 'resume' ? '' : message, ctx, { resume: true });
        return;
      }
      // 无残卡可续：输入当新 brief 落下去
    }
    // fire-and-forget：建造在后台跑（流式渲染自行推进），本函数立刻返回让 composer 解锁
    void launchBuild(message, ctx);
  }

  // 建造中且不在等回答 ⇒ 输入应被拦（chatCore 在渲染用户消息前调它）
  function shouldRejectMessage() {
    return state.running && !state.pendingAsk;
  }

  function cancel() {
    if (!state.running) return;
    state.aborted = true;
    if (state.abortController) state.abortController.abort();
    const resolve = state.pendingAsk;
    state.pendingAsk = null;
    if (resolve) resolve(null);
    disableAskPanel();
    // A2：审批等待期点暂停 → 必须 resolve pendingApproval(null)，否则 dispatchTool 内的 await 永久挂死、loop 卡住。
    const resolveAppr = state.pendingApproval;
    state.pendingApproval = null;
    if (resolveAppr) resolveAppr(null);
    disableApprovalPanel();
  }

  function isBuilding() {
    return state.running;
  }

  // ---------- 刷新后找回（残卡跨页面重载恢复） ----------

  // 进入设计模式时：若 localStorage 里有上一局的残卡/原描述、且引擎是冷的（同会话死局
  // 不走这条——finishRun 已给过面板），把恢复面板重新摆出来。残卡先暂存 restoredResidual，
  // 玩家选择续建时才喂回引擎（不提前污染 cardStore）。
  function maybeOfferRestoredResume() {
    try {
      if (state.running || state.recovery) return;
      if (window.designService?.phase !== 'pzwc') return;
      const eng = engine();
      if (!eng || eng.getCard()) return;
      const saved = readResidual();
      if (!saved) return;
      const area = chatArea();
      if (!area) return;
      state.lastBrief = saved.brief || state.lastBrief;
      state.sessionCardId = saved.sessionCardId || state.sessionCardId;
      state.restoredResidual = saved.card || null;
      state.dialog = Array.isArray(saved.dialog) ? saved.dialog : [];
      state.lastAskQuestion = saved.pendingQuestion || null;
      state.recovery = { canResume: !!saved.card };
      const h = document.createElement('div');
      h.className = 'pzwc-turn-hint';
      h.textContent = saved.card
        ? L(
            '找回上次中断的建造' +
              (saved.card.name ? '「' + saved.card.name + '」' : '') +
              '——工作卡还在，可以继续。',
            'Recovered your interrupted build' +
              (saved.card.name ? ' “' + saved.card.name + '”' : '') +
              ' — the working card is still here, you can continue.'
          )
        : L(
            '上次的建造刚开了头就断了——可用原描述重新生成。',
            'Your last build broke off right at the start — you can regenerate from the original description.'
          );
      withScroll(() => area.appendChild(h));
      renderRecoveryPanel(!!saved.card);
    } catch (e) {
      console.warn('[pzwc] restored-resume offer failed:', e);
    }
  }

  function hookRestoreOffer() {
    const tryHook = () => {
      if (!window.eventBus || typeof window.eventBus.on !== 'function') return false;
      window.eventBus.on('mode-toggled', (data) => {
        // 切完 mode 后稍等：让 refreshChatUI / 过场动画落定，面板别被重建吃掉
        if (data && data.mode === 'design') setTimeout(maybeOfferRestoredResume, 800);
      });
      return true;
    };
    if (tryHook()) return;
    // eventBus 晚于本文件就绪的兜底
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        if (!tryHook()) console.warn('[pzwc] eventBus unavailable — restored-resume offer disabled');
      },
      { once: true }
    );
  }
  hookRestoreOffer();

  window.pzwcDesignController = {
    handleUserMessage,
    shouldRejectMessage,
    cancel,
    isBuilding,
  };
})();
