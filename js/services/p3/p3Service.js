/**
 * js/services/p3/p3Service.js
 *
 * Phase 3 主控制器（2026-05-27 重构）：
 *
 * **架构换血**：弃 OpenAI tool calling 协议，改 JSON content output + agent loop。
 *
 * 每个 user turn：
 *   _runRequest(text)
 *     → 调 window.p3Dispatcher.runAgentLoop(...)
 *     → dispatcher 内部 while loop（≤8 轮）：每轮 callP3API → validate → 分发
 *     → 返 { kind: 'patch'|'discussion'|'json_bail'|'iter_exhausted'|'aborted'|'error', ... }
 *     → service 根据 kind 渲染 UI（diff card / 纯对话气泡 / error notice）
 *
 * chatHistory 简化：只有 user/assistant + content（不再含 tool_calls / tool_call_id）。
 *   - user 真问题
 *   - assistant 的 JSON action（dispatcher push）
 *   - tool_result 表达成 user message："[tool_result query_card]\n..."（dispatcher push）
 *
 * patch 审批追踪：用 syntheticPatchId（dispatcher 不感知；service 在 _handlePatchAction 生成）。
 *   - resolvedPatchIds Set：内存运行时防 race
 *   - designChatHistory ai message 的 _p3Resolutions[patchId]：持久化真源
 *
 * 老存档兼容：
 *   - 老形态 ai message 含 _p3ToolCalls → p3UI.renderHistoricalAssistantCard 走旧路径
 *   - 新形态 ai message 含 _p3Patch + _p3PatchId / _p3InvestigationSteps → 走新路径
 *   - 不强制迁移；老对话保持原样可读
 *
 * 暴露 window.p3Service（单例）。
 */

(function () {
  'use strict';

  class P3Service {
    constructor() {
      this.ui = null;
      this.patchEngine = null;
      this.chatHistory = []; // [{role:'user'|'assistant', content:string}]（OpenAI 协议、in-memory）
      this.resolvedPatchIds = new Set();
      this.abortController = null;
      this.busy = false;
      this._open = false;
      this._bootstrapped = false;
      // 首次 openPanel 时从模块级 window.p3ChatHistory 回填 in-memory chatHistory 一次。
      // 模块级 p3ChatHistory 是 P3 chat 的唯一真源（持久化字段 + UI 重建源），由 worldCardUI
      // loadCardIntoDesignMode 灌（从 card.p3ChatHistory 读）或者 P2→P3 bootstrap 时为空。
      // applyToGame 是唯一清空 trigger——其他场景（刷新/换 stage/apply patch）一律不动。
      this._historyRestored = false;
    }

    // ===== 启动 / 关闭面板 =====
    openPanel() {
      if (!this.ui) this.ui = new window.P3UI(this._buildHandlers());
      if (!this.patchEngine) this.patchEngine = new window.P3PatchEngine();
      this.ui.ensureMounted();
      this._syncInspectBtnLabel();

      const ds = window.designService;

      // 首次进入（这个 P3Service 实例从未回填过 chatHistory）时从模块级 p3ChatHistory 回填。
      // 不再做 identity check / auto reset——切卡时 loadCardIntoDesignMode 已经把模块级
      // p3ChatHistory 灌成新卡的内容了；this.chatHistory 跟着重新回填一次就同步。
      // applyToGame 才是唯一 reset trigger——P3Service 没有"在 openPanel 内推断切卡"的责任。
      if (!this._historyRestored) {
        this._restoreFromP3History();
        this._historyRestored = true;
      }

      if (this._shouldGateAsV1(ds)) {
        this.ui.renderV1LockBanner();
        this.ui.show();
        this._open = true;
        return;
      }

      this.ui.rebuildChatSkeletonIfLocked();
      this.ui.show();
      this._open = true;
      this.ui.setUndoCount(this.patchEngine.undoCount());
    }

    closePanel() {
      if (this.busy && this.abortController) {
        try { this.abortController.abort(); } catch (_) {}
      }
      if (this.ui) this.ui.hide();
      this._open = false;
    }

    isOpen() { return this._open; }

    /**
     * P2 完成时调（[design/design2.js:795]）。**不再清空 chatHistory**——草稿期 P3 chat 是
     * sticky 的，applyToGame 是唯一清空 trigger。这里只负责：进 P3 面板 + 如果 chatHistory
     * 空才发开场建议（非空说明之前 P3 聊过、续接即可）。
     */
    async bootstrap(_designConfig) {
      this.openPanel();
      if (this.ui?._lockedView) return;
      this._bootstrapped = true;
      if (this.chatHistory.length === 0) {
        await this._sendBootstrapGreeting();
      }
    }

    /**
     * 切卡入口（worldCardUI.loadCardIntoDesignMode 调）——清 in-memory P3 状态、让
     * openPanel 下次从模块级 p3ChatHistory（caller 已经灌成新卡内容）重新回填。
     * **不动**模块级 p3ChatHistory、**不动** localStorage——新卡内容已经在那了。
     */
    reloadFromCard() {
      this.chatHistory = [];
      this.resolvedPatchIds.clear();
      this._bootstrapped = false;
      this._historyRestored = false;
      if (this.patchEngine) this.patchEngine.clear();
      if (this.ui) {
        this.ui.clearLog();
        this.ui.setUndoCount(0);
      }
    }

    /**
     * applyToGame 唯一清空入口——由 designService.applyToGame 触发。
     * 清掉 P3 所有状态：chatHistory / 模块级 p3ChatHistory / localStorage / undo stack / UI。
     */
    resetForApply() {
      this.chatHistory = [];
      this.resolvedPatchIds.clear();
      this._bootstrapped = false;
      this._historyRestored = false; // 允许下一张卡的 p3ChatHistory 重新回填
      if (this.patchEngine) this.patchEngine.clear();
      if (this.ui) {
        this.ui.clearLog();
        this.ui.setUndoCount(0);
      }
      // 清模块级 p3ChatHistory + localStorage
      const p3Hist = this._getP3HistoryRef();
      if (Array.isArray(p3Hist)) p3Hist.length = 0;
      try { window.designService?.clearP3ChatHistory?.(); } catch (_) {}
    }

    // ============================================
    // Public API
    // ============================================
    async sendMessage(text) {
      if (typeof text !== 'string') text = String(text ?? '');
      const trimmed = text.trim();
      if (!trimmed) return;
      if (this.ui?._lockedView) return;
      this.openPanel();
      if (this.ui?._lockedView) return;
      await this._runRequest(trimmed, { showUserBubble: true });
    }

    /**
     * 一键检查：跑全量一致性体检（AI 调 check_consistency 工具）→ 解读 + 给可一键应用的修复 patch。
     * 由 #design-p3-inspect-btn 触发（用户主动点击，非系统自动跑——符合「系统不替用户做选择」红线）。
     */
    async runInspection() {
      this.openPanel();
      if (this.ui?._lockedView) return; // V1 锁定卡不可编辑/检查
      if (this.busy) return;
      const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
      const prompt = isEn
        ? 'Run a full consistency inspection on the current world card: call the check_consistency tool with no scope (all rules). Then read the returned issues and, for each fixable one, propose a concrete patch I can apply in one click. If nothing is wrong, say so briefly.'
        : '请对当前世界卡跑一次全量一致性体检：调用 check_consistency 工具（不传 scope，跑全部规则）。然后逐条解读检出的问题，并对每个可修复的问题给出可一键应用的修复 patch。如果没有问题，简短说明即可。';
      await this._runRequest(prompt, { showUserBubble: false });
    }

    /**
     * 让 AI 帮我修：把代码预览校验面板里的提示原文丢给 P3，让它逐条修复并给可一键应用的 patch。
     * 由各 warning 面板的可点击热区触发（用户主动点击 + 以用户身份发指令）。
     * 不自动 apply——P3 照常出 Apply/Reject diff 卡（红线）。
     */
    async fixIssues(issueMessages, opts = {}) {
      let list = Array.isArray(issueMessages)
        ? issueMessages.map(m => String(m ?? '').trim()).filter(Boolean)
        : [];
      if (list.length === 0) return;
      const CAP = 20;
      const truncated = list.length > CAP;
      list = list.slice(0, CAP);
      this.openPanel();
      if (this.ui?._lockedView) return;   // V1 锁卡不可编辑
      if (this.busy) return;
      const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
      const bullets = list.map(m => '- ' + m).join('\n');
      const moreZh = truncated ? '\n（还有更多同类问题，先修这些。）' : '';
      const moreEn = truncated ? '\n(There are more similar issues; fix these first.)' : '';
      const prompt = isEn
        ? `The world-card code-preview validator flagged these issues:\n\n${bullets}${moreEn}\n\nFix every one of them. For each, propose a concrete patch I can apply in one click. If an issue is about a deprecated or auto-rewritten field, remove/correct it via a patch. If any item is not patch-fixable, say briefly why. Don't ask me to confirm before proposing the patches.`
        : `世界卡代码预览的校验器报了这些提示：\n\n${bullets}${moreZh}\n\n请把每一条都修掉，逐条给出我可以一键应用的修复 patch。如果某条是关于已废弃/会被自动改写的字段，就用 patch 删掉或改正。如果有哪条你没法用 patch 修，简短说明原因即可。不用先问我确认，直接给 patch。`;
      await this._runRequest(prompt, { showUserBubble: true, ...opts });
    }

    /** 同步一键检查按钮 label 到当前语言（每次 openPanel 调用）。 */
    _syncInspectBtnLabel() {
      const btn = document.getElementById('design-p3-inspect-btn');
      if (!btn) return;
      const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
      const lbl = btn.querySelector('.p3-inspect-label');
      if (lbl) lbl.textContent = isEn ? 'Check card' : '一键检查';
    }

    cancelRequest() {
      try { this.abortController?.abort(); } catch (_) { /* defensive */ }
    }

    // 注：原 clearChat / onClearChat handler 已删——applyToGame 是唯一清空 trigger。
    // 「清空对话」按钮 DOM 也一并移除，see _bindHeaderTools。

    // ===== UI handlers =====
    _buildHandlers() {
      return {
        onSend: (text) => this._runRequest(text, { showUserBubble: true }),
        onCancel: () => this.abortController?.abort(),
        // 注：UI handler 仍叫 onApplyPatch/onRejectPatch；id 在新架构下是 syntheticPatchId。
        onApplyPatch: (patchId, selectedRawOps, totalLogicalCount, selectedLogicalCount) =>
          this._applyPatch(patchId, selectedRawOps, totalLogicalCount, selectedLogicalCount),
        onRejectPatch: (patchId) => this._rejectPatch(patchId),
        onRegenerate: (assistantHistMsg, originPrompt, live) =>
          this._regenerateFromCard(assistantHistMsg, originPrompt, live),
        onUndo: () => this._undo(),
        onApplyToGame: () => {
          try { window.designService?.applyToGame?.(); }
          catch (e) { console.error('[P3Service] applyToGame failed:', e); }
        },
        onExportJson: () => {
          try { window.designService?.exportConfig?.(); }
          catch (e) { console.error('[P3Service] exportConfig failed:', e); }
        },
      };
    }

    // ===== V1 gate =====
    _shouldGateAsV1(ds) {
      if (!ds) return false;
      try {
        const sourceId = ds._reimportSourceCardId;
        if (!sourceId) return false;
        if (!window.worldCardManager?.get || !window.cardSchemaVersion?.isOriginallyV1) {
          return false;
        }
        const sourceCard = window.worldCardManager.get(sourceId);
        if (!sourceCard) return false;
        return !!window.cardSchemaVersion.isOriginallyV1(sourceCard);
      } catch (_) {
        return false;
      }
    }

    // ===== 开场 AI =====
    async _sendBootstrapGreeting() {
      const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
      const userOpener = isEn
        ? 'I just entered Phase 3. Please read the current world-card JSON and give me 3-5 specific improvement directions in 2-3 sentences. Output ONLY the JSON object {"description":"...","patch":null,"tool_call":null} — pure discussion, no patch, no tool call.'
        : '我刚进入 Phase 3。请阅读当前世界卡 JSON，用 2-3 句中文给我 3-5 个具体的改进方向建议。只输出 JSON 对象 {"description":"...","patch":null,"tool_call":null}——纯讨论，不要 patch、不要调工具。';
      await this._runRequest(userOpener, { showUserBubble: false });
    }

    // ============================================
    // 主请求循环（接入 dispatcher）
    // ============================================
    async _runRequest(text, opts = {}) {
      if (this.busy) return;
      if (!this.ui) this.openPanel();

      // API key 预检：缺 key 时早退给清晰提示，别等 user 回合已入史后再以裸 HTTP/传输错暴露。
      // 与 PZWC 控制器对 design 模块的预检一致（设计模式 BYOK）。
      const _p3Key = window.aiService?.getApiKeyForModule?.('p3');
      if (!_p3Key) {
        if (opts.showUserBubble !== false) this.ui.appendUserMsg(text);
        this.ui.appendSimpleMsg('error', 'P3 编辑还没配置 API key——到「设置 → API 设置」填一个再试。');
        return;
      }

      // 注：以前这里调 _flushUnresolvedPatches 把 pending patch 自动标 ignored 并 push
      // [patch_result] 作者跳过了。新设计（学 Cursor）：pending sticky——用户发新消息时
      // 不动旧 patch 状态，AI 在新一轮看到 chatHistory 里 pending patch + 新指令，自己
      // 判断 user intent（修订 / 追加 / 询问 / 取消）。新的视觉降权由 addDiffSection 处理。

      if (opts.showUserBubble !== false) {
        this.ui.appendUserMsg(text);
        this._pushP3History({ sender: 'user', text, _p3: true });
      }
      const userMsg = { role: 'user', content: text };
      this.chatHistory.push(userMsg);

      this._setBusy(true);
      const live = this.ui.createSkeletonCard();
      this.abortController = new AbortController();

      const investigationSteps = [];
      const startTime = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();

      try {
        const result = await window.p3Dispatcher.runAgentLoop({
          chatHistory: this.chatHistory,
          systemPrompt: this._buildSystemPrompt(),
          designConfig: window.designService?.designConfig || {},
          signal: this.abortController.signal,
          onDescriptionChunk: (chunk) => {
            try { this.ui.appendDescriptionChunk(live, chunk); } catch (_) {}
          },
          onInvestigationStep: (step) => {
            investigationSteps.push(step);
            try { this.ui.addInvestigationStep(live, step); } catch (_) {}
          },
          onIterationStart: (meta) => {
            try { this.ui.markIterationStart(live, meta); } catch (_) {}
          },
        });

        const durationMs = ((typeof performance !== 'undefined' && performance.now)
          ? performance.now() : Date.now()) - startTime;

        const histMsg = this._buildAssistantHistMsg(result, text, investigationSteps, durationMs);
        live._histMsgRef = histMsg;
        // 只持久化有实质内容的回合（patch / discussion）。aborted / json_bail / iter_exhausted / error
        // 没有 description/patch——持久化会在刷新后重放空 AI 回合，与被 dispatcher 回滚的 in-memory
        // chatHistory 发散，并让 AI 下一轮看到自己「产出空答」。
        if (result.kind === 'patch' || result.kind === 'discussion') {
          this._pushP3History(histMsg);
        }

        this._dispatchActionResult(live, result, histMsg);
        // P3 实时渲染 metrics bar——_dispatchActionResult 已经 finalize 卡片，
        // 这里把 footer + metrics 挂到 msgEl 末尾（与 P1/P2 共用 _renderDesignAiMetricsInto 实现）
        try {
          if (live?.el && histMsg.metrics && typeof window._renderDesignAiMetricsInto === 'function') {
            window._renderDesignAiMetricsInto(live.el, histMsg.metrics);
          }
        } catch (_) { /* metrics 渲染失败不影响主流程 */ }
      } catch (err) {
        // dispatcher 自己捕获了 AbortError；走到这里通常是其他异常
        if (err?.name === 'AbortError') {
          this.ui.abortCard(live, '已取消');
        } else {
          this.ui.abortCard(live, `失败：${err?.message || String(err)}`);
        }
      } finally {
        this.abortController = null;
        this._setBusy(false);
        // 收缩 scrollController 撑出来的 chat-tail-spacer——appendUserMsg → scrollNewTurnToTop
        // 撑大 spacer 把 user 消息钉在视口顶，但 P3 一轮结束后没人收缩它，UI 下方就留一大块空。
        // P1/P2 主聊天 finalize 走 runScoped 自动 shrinkSpacerToFit，P3 自定义流程没经过那条路径——
        // 这里显式触发：runScoped 让 shrinkSpacerToFit 跑、clearTurnSpacer 释放 pinActive。
        try { window.scrollController?.runScoped?.(() => {}); } catch (_) {}
        try { window.scrollController?.clearTurnSpacer?.(); } catch (_) {}
      }
    }

    /**
     * 根据 dispatcher 返回的 result 分发到 UI。
     */
    _dispatchActionResult(live, result, histMsg) {
      switch (result.kind) {
        case 'patch':
          this._handlePatchAction(live, result, histMsg);
          break;
        case 'discussion':
          this._handleDiscussionAction(live, result);
          break;
        case 'json_bail':
          this.ui.finalizeCard(live, result);
          this.ui.addInlineError(
            live.el,
            `⚠ JSON 格式连续异常，请重发问题或简化诉求。最后错误：${result.error || '(无)'}`
          );
          break;
        case 'iter_exhausted':
          this.ui.finalizeCard(live, result);
          this.ui.addInlineError(
            live.el,
            `⚠ AI 调研后仍未给出最终答复，请简化诉求重试。`
          );
          break;
        case 'aborted':
          this.ui.abortCard(live, '已取消');
          break;
        case 'error':
          this.ui.abortCard(live, `失败：${result.error || '(unknown)'}`);
          break;
        default:
          this.ui.abortCard(live, `未知 result.kind=${result.kind}`);
      }
      this.ui.attachRegenerateButton(live);
    }

    _handlePatchAction(live, result, histMsg) {
      const patchId = histMsg._p3PatchId;
      this.ui.finalizeCard(live, result);
      this.ui.addDiffSection(
        live.el, patchId, result.patch,
        () => window.designService?.designConfig || null
      );
    }

    _handleDiscussionAction(live, result) {
      this.ui.finalizeCard(live, result);
      // 纯对话——description 已经流式 push 到 live，finalize 标完成即可
    }

    /**
     * 构造 designChatHistory 上的 P3 assistant message（新形态）。
     */
    _buildAssistantHistMsg(result, originPrompt, investigationSteps, durationMs) {
      const histMsg = {
        sender: 'ai',
        text: result.description || '',
        _p3: true,
        _p3OriginPrompt: originPrompt,
        _p3DurationMs: Math.round(durationMs) || 0,
        _p3Iterations: result.iterations || 1,
        _p3FinalKind: result.kind,
      };
      // dispatcher 跨 iteration 累加的 metrics（耗时/token/费用 bar 用）
      if (result?.metrics && typeof result.metrics === 'object') {
        histMsg.metrics = result.metrics;
      }
      if (Array.isArray(investigationSteps) && investigationSteps.length > 0) {
        histMsg._p3InvestigationSteps = investigationSteps.map(s => ({
          iteration: s.iteration,
          tool: s.tool,
          args: s.args,
          description: s.description,
          result: s.result,
          ok: s.ok !== false,
        }));
      }
      if (result.kind === 'patch') {
        const patchId = `p3p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        histMsg._p3Patch = result.patch;
        histMsg._p3PatchId = patchId;
        histMsg._p3Resolutions = { [patchId]: { resolution: 'pending' } };
      }
      return histMsg;
    }

    // ============================================
    // p3ChatHistory 持久化辅助
    // ============================================
    /**
     * 模块级 p3ChatHistory（window.p3ChatHistory）—— P3 chat 的唯一真源。
     * 不再混进 designChatHistory（P1/P2 创作 pipeline 的领地）。
     */
    _getP3HistoryRef() {
      try {
        return Array.isArray(window.p3ChatHistory) ? window.p3ChatHistory : null;
      } catch (_) {
        return null;
      }
    }

    /**
     * push 一条 P3 消息（含 UI metadata）到模块级 p3ChatHistory + localStorage 持久化 +
     * 如果当前是编辑成型卡，sync 到 card.p3ChatHistory。
     */
    _pushP3History(msg) {
      const history = this._getP3HistoryRef();
      if (!Array.isArray(history)) return;
      history.push(msg);
      this._scheduleP3Persist();
    }

    /**
     * 持久化 P3 chat history：写 localStorage + 编辑成型卡时 sync 到 card.p3ChatHistory + _editDraft。
     * 注：函数名/旧注释曾写「debounce」，实为**同步**直写（无 timer），按消息/审批触发、非按 chunk。
     */
    _scheduleP3Persist() {
      const history = this._getP3HistoryRef();
      if (!Array.isArray(history)) return;
      try {
        const ds = window.designService;
        if (ds && typeof ds.saveP3ChatHistory === 'function') {
          ds.saveP3ChatHistory(history);
        }
      } catch (e) {
        console.warn('[P3] saveP3ChatHistory 失败:', e);
      }
      // 编辑成型卡时同步写 card.p3ChatHistory（让切卡/重进时 loadCardIntoDesignMode 能读回）。
      // worldCardManager.update 签名是 (id, updates, options)——必须传 id 字符串 + patch，
      // 不能传整 card 对象（之前那种写法 _loadCard 查不到、静默失败）。
      try {
        const ds = window.designService;
        const cardId = ds?._reimportSourceCardId;
        if (cardId && window.worldCardManager?.update) {
          // 对话 + 编辑中的卡内容（designConfig）一次 update 原子落盘——草稿态续编靠这两样。
          // 不带 snapshot，故不触发 activeCard 运行时热更新。
          const patch = { p3ChatHistory: history.slice() };
          if (ds.designConfig && typeof ds.designConfig === 'object') patch._editDraft = ds.designConfig;
          const saved = window.worldCardManager.update(cardId, patch);
          // 草稿落盘失败（配额满时 update 返回 null、不抛错）——提示用户，否则他看着「编辑中」以为已存、刷新即丢。
          // 节流：失败只提示一次，成功后复位标志。
          if (saved === null) {
            if (!this._draftPersistFailedNotified) {
              this._draftPersistFailedNotified = true;
              try { if (typeof showToast === 'function') showToast('编辑草稿保存失败：存储空间不足，请尽快「应用到游戏」或清理存档', 'error'); } catch (_) {}
            }
          } else {
            this._draftPersistFailedNotified = false;
          }
        }
      } catch (_) { /* defensive */ }
    }

    /**
     * 从模块级 p3ChatHistory 把消息回填进 in-memory this.chatHistory。
     *
     * 触发场景：刷新网页 / openPanel 首次进入 / 切到 design mode → service 重新构造后，
     * in-memory chatHistory 是空的、但模块级 p3ChatHistory 已经由 loadCardIntoDesignMode
     * 或 localStorage 加载好。这里把它翻译成 OpenAI 协议喂给 AI。
     *
     * 翻译规则：
     *   - user 消息：直接转 { role:'user', content }
     *   - ai 新形态（_p3InvestigationSteps + _p3Patch + _p3FinalKind）：
     *     先展开调研步成 assistant tool_call + user tool_result 链，再 push 最终 ai message
     *   - ai 老形态（_p3ToolCalls 含 apply_patch 调用）：翻译成新协议 JSON content
     *   - ai 纯讨论 / json_bail / iter_exhausted：包成 {description, patch:null, tool_call:null}
     *
     * [patch_result] / [tool_result] in-memory 消息不持久化、回填后没有——但 AI 看到
     * designConfig 已经是 applied 后的状态、加上历史 patch 内容能推断发生过什么。
     */
    _restoreFromP3History() {
      const history = this._getP3HistoryRef();
      if (!Array.isArray(history) || history.length === 0) return;

      for (const m of history) {
        if (!m) continue;
        // p3ChatHistory 里全是 P3 消息，不需要反向过滤；保留 _p3 兼容性检查避免历史脏数据
        if (m._p3 === false) continue;

        if (m.sender === 'user') {
          this.chatHistory.push({ role: 'user', content: m.text || '' });
          continue;
        }

        if (m.sender !== 'ai') continue;

        // 新形态：先展开 investigation steps（每步 = 一对 assistant tool_call + user tool_result）
        if (Array.isArray(m._p3InvestigationSteps) && m._p3InvestigationSteps.length > 0) {
          for (const step of m._p3InvestigationSteps) {
            this.chatHistory.push({
              role: 'assistant',
              content: JSON.stringify({
                description: step.description || '',
                patch: null,
                tool_call: { tool: step.tool, args: step.args || {} },
              }),
            });
            this.chatHistory.push({
              role: 'user',
              content: `[tool_result ${step.tool}]\n${typeof step.result === 'string' ? step.result : ''}`,
            });
          }
        }

        // 最终 ai message：决定 content 形态
        let finalContent;
        let restoredPatchId = m._p3PatchId; // 新形态用这个 id 查 resolution
        if (Array.isArray(m._p3ToolCalls) && m._p3ToolCalls.length > 0) {
          // 老形态（v3.8.x 以前）：从 tool_calls 抽 apply_patch 的 patch
          const applyCall = m._p3ToolCalls.find(tc => tc.function?.name === 'apply_patch');
          let patch = null;
          if (applyCall?.function?.arguments) {
            try {
              const args = JSON.parse(applyCall.function.arguments);
              patch = Array.isArray(args.patch) ? args.patch : null;
            } catch (_) { /* 解析失败放弃 patch */ }
          }
          finalContent = JSON.stringify({
            description: m.text || '',
            patch,
            tool_call: null,
          });
          // 老形态 patchId = tool_call.id
          if (!restoredPatchId && applyCall?.id) restoredPatchId = applyCall.id;
        } else {
          // 新形态：直接读 _p3Patch 字段
          finalContent = JSON.stringify({
            description: m.text || '',
            patch: Array.isArray(m._p3Patch) ? m._p3Patch : null,
            tool_call: null,
          });
        }
        this.chatHistory.push({ role: 'assistant', content: finalContent });

        // 加 [patch_result]——根据持久化的 resolution 重建用户审批结果。
        // 否则 AI 刷新后看到"我提了 patch X"但不知道用户应用/拒绝了，可能基于错误状态推断。
        // pending 不 push（保持"未决断"语义，AI 可以自己问/不动）。
        if (restoredPatchId && m._p3Resolutions) {
          const res = m._p3Resolutions[restoredPatchId];
          const resultText = _formatPatchResultForRestore(res);
          if (resultText) {
            this.chatHistory.push({ role: 'user', content: resultText });
          }
        }
      }
    }

    /**
     * 找到含 patchId 的 ai message，更新 _p3Resolutions[patchId]。
     */
    _setResolutionByPatchId(patchId, status, detail) {
      const history = this._getP3HistoryRef();
      if (!Array.isArray(history)) return;
      for (let i = history.length - 1; i >= 0; i--) {
        const m = history[i];
        if (m && m.sender === 'ai' && m._p3Resolutions && m._p3Resolutions[patchId]) {
          m._p3Resolutions[patchId] = { resolution: status };
          if (detail) m._p3Resolutions[patchId].detail = String(detail);
          this._scheduleP3Persist();
          return;
        }
      }
    }

    // ===== Patch 应用 / 拒绝 =====
    _applyPatch(patchId, selectedRawOps, totalLogicalCount, selectedLogicalCount) {
      // 进行中禁止应用旧 patch：apply 会换掉 designConfig 对象，正在跑的 loop 仍对旧引用调研/dry-run；
      // 且 push [patch_result] 进共享 chatHistory 可能被 dispatcher 的 json_bail 截断丢失。
      if (this.busy) return;
      if (this.resolvedPatchIds.has(patchId)) return;
      const ds = window.designService;
      if (!ds) {
        this.ui.appendSimpleMsg('error', 'designService 未就绪，无法应用');
        return;
      }
      const result = this.patchEngine.apply(ds, selectedRawOps);
      if (!result.ok) {
        const isTestFail = !!result.isTestFail;
        this.ui.appendSimpleMsg('error', `Patch 应用失败：${result.error}`);
        // 喂回结果给后续 AI（chatHistory 用 user message 表达）
        this.chatHistory.push({
          role: 'user',
          content: isTestFail
            ? `[patch_result] 应用失败：test op 不匹配——作者在你生成 patch 后修改了编辑器，基线值已变。请基于最新 JSON 重新生成。原始错误：${result.error}`
            : `[patch_result] 应用失败：${result.error}`,
        });
        this.resolvedPatchIds.add(patchId);
        this.ui.updateDiffSectionStatus(patchId, 'error');
        this._setResolutionByPatchId(patchId, 'error', result.error);
        return;
      }

      const partial = selectedLogicalCount < totalLogicalCount;
      this.chatHistory.push({
        role: 'user',
        content: partial
          ? `[patch_result] 已应用部分：${selectedLogicalCount}/${totalLogicalCount} 项（作者手动勾选了子集）`
          : `[patch_result] 已应用：${selectedLogicalCount} 项全部成功`,
      });
      this.resolvedPatchIds.add(patchId);
      const detail = partial ? `${selectedLogicalCount}/${totalLogicalCount}` : null;
      this.ui.updateDiffSectionStatus(patchId, 'applied', detail);
      this.ui.setUndoCount(this.patchEngine.undoCount());
      this.ui.appendSimpleMsg('system', partial
        ? `已应用选中的 ${selectedLogicalCount}/${totalLogicalCount} 项（其余跳过）`
        : `已应用全部 ${selectedLogicalCount} 项修改`);
      this._setResolutionByPatchId(patchId, 'applied', detail);
    }

    _rejectPatch(patchId) {
      if (this.busy) return;
      if (this.resolvedPatchIds.has(patchId)) return;
      this.chatHistory.push({
        role: 'user',
        content: '[patch_result] 作者拒绝了这组改动。',
      });
      this.resolvedPatchIds.add(patchId);
      this.ui.updateDiffSectionStatus(patchId, 'rejected');
      this.ui.appendSimpleMsg('system', '已拒绝该 patch');
      this._setResolutionByPatchId(patchId, 'rejected');
    }

    _undo() {
      if (this.busy) return;
      const ds = window.designService;
      if (!ds || !this.patchEngine) return;
      const ok = this.patchEngine.undoOnce(ds);
      this.ui.setUndoCount(this.patchEngine.undoCount());
      if (ok) {
        this.ui.appendSimpleMsg('system', '已撤销一步');
        // 撤销必须记进对话历史（in-memory + 持久化 p3ChatHistory）。否则：上一条 patch 的
        // resolution 仍持久化为 'applied'，刷新后 _restoreFromP3History 会重建出 [patch_result]
        // 已应用，而 designConfig 早被 undoOnce 回滚——AI 看到「已应用」却对着回滚后的 JSON，
        // 状态矛盾，可能基于错误前提继续编辑。补一条 user 记录把回滚事实喂回 AI。
        const undoNote = '[patch_result] 作者撤销了上一步修改（designConfig 已回滚到该 patch 之前）。';
        this.chatHistory.push({ role: 'user', content: undoNote });
        // _pushP3History 内部 _scheduleP3Persist 会原子落盘：历史记录 + _editDraft（已含 undo 后的
        // designConfig），一次搞定——无需再单独 _scheduleP3Persist。
        this._pushP3History({ sender: 'user', text: undoNote, _p3: true });
      }
    }

    // ===== 重新生成 =====
    async _regenerateFromCard(assistantHistMsg, originPrompt, live) {
      if (this.busy) return;

      // chatHistory：找到上次这条 assistant message 在 chatHistory 中的对应位置回滚。
      // 新协议下 chatHistory 是 user/assistant 序列；找到最后一个 assistant 之后所有都删，
      // 然后再删紧挨它前面那条 user（=本次 originPrompt）。
      // 简化策略：找 chatHistory 里最后一个 role=='user' && content==originPrompt 的位置，
      // 从该位置开始整段截断（含 user）。
      let cutIdx = -1;
      for (let i = this.chatHistory.length - 1; i >= 0; i--) {
        const m = this.chatHistory[i];
        if (m.role === 'user' && m.content === originPrompt) {
          cutIdx = i;
          break;
        }
      }
      if (cutIdx < 0) {
        this.ui.appendSimpleMsg('error', '找不到原始提问，无法重新生成（可能已被清空）');
        return;
      }
      this.chatHistory.splice(cutIdx);

      // p3ChatHistory：移除对应 ai message + user message（runRequest 会再 push）
      const history = this._getP3HistoryRef();
      if (Array.isArray(history)) {
        let changed = false;
        if (assistantHistMsg) {
          const aiIdx = history.lastIndexOf(assistantHistMsg);
          if (aiIdx >= 0) {
            // 同时清理对应 patch 的 resolvedPatchIds
            if (assistantHistMsg._p3PatchId) {
              this.resolvedPatchIds.delete(assistantHistMsg._p3PatchId);
            }
            history.splice(aiIdx, 1);
            changed = true;
          }
        }
        for (let i = history.length - 1; i >= 0; i--) {
          const m = history[i];
          if (m && m.sender === 'user' && m.text === originPrompt) {
            history.splice(i, 1);
            changed = true;
            break;
          }
        }
        if (changed) this._scheduleP3Persist();
      }
      this.ui.markCardRegenerated(live);
      await this._runRequest(originPrompt, { showUserBubble: true });
    }

    // ===== System prompt 组装 =====
    _buildSystemPrompt() {
      const base = (typeof globalThis.__skd_init === 'string' && globalThis.__skd_init) || '';
      const baseLocalized = this._localizeBase(base);
      const schema = (typeof globalThis.__rfb_data === 'string' && globalThis.__rfb_data) || '';
      const cardJson = this._safeStringifyCard();
      const parts = [baseLocalized];
      if (schema) parts.push('\n\n## V2 Schema 参考\n\n' + schema);
      if (cardJson) parts.push('\n\n当前世界卡 JSON：\n```json\n' + cardJson + '\n```');
      return parts.join('');
    }

    _localizeBase(zhBase) {
      const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
      if (isEn && typeof globalThis.__skd_init_EN === 'string') {
        return globalThis.__skd_init_EN;
      }
      return zhBase;
    }

    _safeStringifyCard() {
      try {
        const cfg = window.designService?.designConfig || {};
        return JSON.stringify(cfg, null, 2);
      } catch (e) {
        return '';
      }
    }

    // ===== 内部 =====
    _setBusy(b) {
      this.busy = b;
      this.ui?.setBusy(b);
      if (typeof window.setSendBtnCancelMode === 'function') {
        try { window.setSendBtnCancelMode(b); } catch (_) {}
      }
    }
  }

  /**
   * 把持久化的 resolution 翻译成 chatHistory 里的 [patch_result] user message。
   * pending 返 null（保持未决断语义，AI 自行处理）。
   * 文案跟 _applyPatch / _rejectPatch / _flushUnresolvedPatches 推 chatHistory 时一致。
   */
  function _formatPatchResultForRestore(res) {
    if (!res || !res.resolution || res.resolution === 'pending') return null;
    const detail = res.detail ? String(res.detail) : '';
    switch (res.resolution) {
      case 'applied':
        return detail
          ? `[patch_result] 已应用部分：${detail} 项`
          : `[patch_result] 已应用全部`;
      case 'rejected':
        return '[patch_result] 作者拒绝了这组改动。';
      case 'ignored':
        return '[patch_result] 作者跳过了这组改动。';
      case 'error':
        return detail ? `[patch_result] 应用失败：${detail}` : '[patch_result] 应用失败';
      default:
        return null;
    }
  }

  // 单例
  window.p3Service = new P3Service();

  // ===== #design-chat-header 上的 P3 工具按钮绑定 =====
  // 注：「清空对话」按钮已删——applyToGame 是唯一清空 trigger。
  function _bindHeaderTools() {
    const undoBtn = document.getElementById('design-p3-undo-btn');
    if (undoBtn && !undoBtn.dataset._p3Bound) {
      undoBtn.dataset._p3Bound = '1';
      undoBtn.addEventListener('click', () => {
        window.p3Service?._undo?.();
      });
    }
    const inspectBtn = document.getElementById('design-p3-inspect-btn');
    if (inspectBtn && !inspectBtn.dataset._p3Bound) {
      inspectBtn.dataset._p3Bound = '1';
      inspectBtn.addEventListener('click', () => {
        window.p3Service?.runInspection?.();
      });
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_bindHeaderTools, 0);
  } else {
    window.addEventListener('DOMContentLoaded', _bindHeaderTools, { once: true });
  }

  // ===== Bootstrapping after page load =====
  function _checkAutoOpenIfRestoredP3() {
    try {
      if (window.designService?.phase !== 'p3') return;
      const gameScreen = document.getElementById('game-screen');
      const inDesignMode = gameScreen?.classList.contains('design-mode-active') ?? false;
      if (!inDesignMode) return;
      window.p3Service.openPanel();
    } catch (_) { /* defensive */ }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(_checkAutoOpenIfRestoredP3, 0);
  } else {
    window.addEventListener('DOMContentLoaded', _checkAutoOpenIfRestoredP3, { once: true });
  }
})();
