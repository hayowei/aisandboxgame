/**
 * js/services/p3/p3UI.js
 *
 * Phase 3 UI 渲染层（DOM 只）。状态/网络由 p3Service.js 持有。
 *
 * **2026-05-27 改造（agent loop + JSON content dispatcher）**：
 * - createSkeletonCard 不再含 toolCallEntries Map（新架构 chatHistory 无 tool_calls）
 * - 新增流式 description 推字接口 `appendDescriptionChunk`
 * - 新增调研轨迹折叠 `addInvestigationStep`（CC 风格，默认收起）
 * - 新增迭代进度 `markIterationStart`（meta-bar 显示"思考第 N 轮"）
 * - finalizeCard 改成接 dispatcher result（{kind, description, patch, iterations}）
 * - renderHistoricalAssistantCard 双路：老形态（_p3ToolCalls）vs 新形态（_p3Patch + _p3InvestigationSteps）
 * - 删 updateLiveCard / addEmbeddedPatchNotice（新架构不需要）
 *
 * **架构铁律不变**：
 *   DOM 全部 appendChild 到 `.chat-messages-area`；滚动由 window.scrollController 管。
 *   遵守 内部设计文档 单一管理铁律。
 */

(function () {
  'use strict';

  // ============================================
  // 工具函数
  // ============================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // AI 正文（description）的 Markdown → 安全 HTML。与主聊天/PZWC 同一条管线
  // （marked + DOMPurify），没有 htmlSecurity 时降级成纯文本换行。
  function _proseHtml(text) {
    const s = String(text ?? '');
    if (window.htmlSecurity?.markdownToSafeHtml) {
      return window.htmlSecurity.markdownToSafeHtml(s);
    }
    return escapeHtml(s).replace(/\n/g, '<br>');
  }

  function formatVal(val) {
    if (val === undefined) return '<undefined>';
    if (typeof val === 'string') return JSON.stringify(val);
    try { return JSON.stringify(val, null, 2); }
    catch { return String(val); }
  }

  function _L(zh, en) {
    const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
    return isEn ? en : zh;
  }

  function _afterDomChange(fn) {
    if (window.scrollController?.runScoped) {
      window.scrollController.runScoped(fn);
    } else if (typeof fn === 'function') {
      fn();
    }
  }

  // ============================================
  // P3UI 类
  // ============================================
  class P3UI {
    /**
     * @param {object} handlers - callbacks 集合：
     *   onApplyPatch(patchId, selectedRawOps, totalLogicalCount, selectedLogicalCount)
     *   onRejectPatch(patchId)
     *   onRegenerate(assistantHistMsg, originPrompt, live)
     *   onApplyToGame()
     *   onExportJson()
     */
    constructor(handlers) {
      this.handlers = handlers || {};
      this._lockedView = false;
    }

    _getChatArea() {
      return document.querySelector('.chat-messages-area');
    }

    // ===== 生命周期 stubs =====
    ensureMounted() { /* no-op */ }
    show() { /* no-op */ }
    hide() { /* no-op */ }
    rebuildChatSkeletonIfLocked() { this._lockedView = false; }
    setBusy(busy) {
      this._busy = !!busy;
      const undoBtn = document.getElementById('design-p3-undo-btn');
      if (undoBtn) undoBtn.disabled = !!busy;
      // 进行中禁用所有历史 diff 卡的应用/拒绝按钮 + 勾选框 + 全选控件，避免与 in-flight loop 抢
      // chatHistory / designConfig（应用会换掉 designConfig 对象、loop 仍对旧引用 dry-run）。
      const area = this._getChatArea?.();
      if (area) {
        area
          .querySelectorAll('.p3-diff-actions button, .p3-op-checkbox, .p3-op-select-controls button')
          .forEach(el => { el.disabled = !!busy; });
      }
    }
    setUndoCount(count) {
      const btn = document.getElementById('design-p3-undo-btn');
      if (!btn) return;
      const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
      const label = btn.querySelector('.p3-undo-label');
      if (label) label.textContent = isEn ? `Undo (${count})` : `撤销 (${count})`;
      btn.disabled = count === 0;
    }

    // ===== V1 锁定页 =====
    renderV1LockBanner() {
      this._lockedView = true;
      const area = this._getChatArea();
      if (!area) return;
      area.querySelectorAll('.p3-locked-banner').forEach(el => el.remove());
      const banner = document.createElement('div');
      banner.className = 'p3-locked-banner chat-message';
      banner.innerHTML = `
        <div class="p3-locked-icon">🔒</div>
        <div class="p3-locked-title">${escapeHtml(_L('这是一张旧版世界卡', 'This is a legacy world card'))}</div>
        <div class="p3-locked-desc">${escapeHtml(_L('可以继续游玩，但不能再编辑（V1 schema 已停止支持精修工作流）。', 'You can keep playing, but it can no longer be edited (V1 schema has been deprecated for the refine workflow).'))}</div>
        <div class="p3-locked-actions">
          <button type="button" class="btn-secondary p3-locked-export-btn">${escapeHtml(_L('导出 JSON', 'Export JSON'))}</button>
          <button type="button" class="btn-primary p3-locked-apply-btn">${escapeHtml(_L('应用到游戏', 'Apply to game'))}</button>
        </div>
      `;
      banner.querySelector('.p3-locked-apply-btn')?.addEventListener('click', () => this.handlers.onApplyToGame?.());
      banner.querySelector('.p3-locked-export-btn')?.addEventListener('click', () => this.handlers.onExportJson?.());
      _afterDomChange(() => area.appendChild(banner));
    }

    // ===== 简单消息 =====
    appendSimpleMsg(role, content) {
      const area = this._getChatArea();
      if (!area) return null;
      const div = document.createElement('div');
      div.className = `chat-message p3-msg p3-msg-${role}`;
      div.textContent = content;
      _afterDomChange(() => area.appendChild(div));
      return div;
    }

    appendUserMsg(text) {
      const area = this._getChatArea();
      if (!area) return null;
      const div = document.createElement('div');
      div.className = 'chat-message user-message design-mode-msg p3-user-msg';
      div.innerHTML = `<div class="chat-message-content"></div>`;
      div.querySelector('.chat-message-content').textContent = text;
      area.appendChild(div);
      if (window.scrollController?.scrollNewTurnToTop) {
        window.scrollController.scrollNewTurnToTop(div);
      } else {
        _afterDomChange(() => {});
      }
      return div;
    }

    // ============================================
    // Assistant 卡片：skeleton → 流式描述 + 调研轨迹 → finalize / abort
    // ============================================
    createSkeletonCard() {
      const area = this._getChatArea();
      const card = document.createElement('div');
      card.className = 'chat-message ai-message design-mode-msg p3-assistant-card p3-assistant-card-streaming';

      const meta = document.createElement('div');
      meta.className = 'p3-meta-bar';
      const inProgress = document.createElement('span');
      inProgress.className = 'p3-meta-streaming';
      inProgress.textContent = _L('⏳ 思考中…', '⏳ Thinking…');
      meta.appendChild(inProgress);
      card.appendChild(meta);

      if (area) {
        _afterDomChange(() => area.appendChild(card));
      }

      return {
        el: card,
        metaEl: meta,
        descriptionBody: null,
        investigationContainer: null,
        reasoningBody: null,
        _iterations: 0,
      };
    }

    /**
     * 流式追加 description 字符（dispatcher 的 onDescriptionChunk hook）。
     * 描述段 lazy create——第一个 chunk 到才插 DOM。
     */
    appendDescriptionChunk(live, chunk) {
      if (!live || !chunk) return;
      if (!live.descriptionBody) {
        const div = document.createElement('div');
        div.className = 'p3-card-section p3-prose-body';
        const body = document.createElement('div');
        body.className = 'p3-section-body';
        div.appendChild(body);
        // 插到 investigationContainer 之前（如果有）；否则末尾
        if (live.investigationContainer && live.investigationContainer.parentNode === live.el) {
          live.el.insertBefore(div, live.investigationContainer);
        } else {
          live.el.appendChild(div);
        }
        live.descriptionBody = body;
      }
      // 原始 markdown 累积在 _descRaw（textContent 会丢标记无法回读），整段重渲染
      live._descRaw = (live._descRaw || '') + chunk;
      live.descriptionBody.innerHTML = _proseHtml(live._descRaw);
    }

    /**
     * 渲染中间轮调研步（CC 风格折叠 ── 默认收起）。
     */
    addInvestigationStep(live, step) {
      if (!live || !step) return;
      if (!live.investigationContainer) {
        const container = document.createElement('div');
        container.className = 'p3-card-section p3-investigation-container';
        live.el.appendChild(container);
        live.investigationContainer = container;
      }
      const tool = step.tool || '?';
      const argsBrief = _briefArgs(step.args);

      const details = document.createElement('details');
      details.className = 'p3-investigation-step';
      details.open = false;

      const summary = document.createElement('summary');
      summary.className = 'p3-investigation-summary';
      summary.textContent = _L(
        `> 调用 ${tool}${argsBrief ? ` ${argsBrief}` : ''}`,
        `> Called ${tool}${argsBrief ? ` ${argsBrief}` : ''}`
      );
      // 体检结果出 chip：与建造段 run_inspection 的 pzwc-tool-chip 同一套语言（is-pass/is-fail）
      const inspChip = _inspectionChip(step);
      if (inspChip) summary.appendChild(inspChip);
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'p3-investigation-body';

      if (step.description) {
        const desc = document.createElement('div');
        desc.className = 'p3-investigation-desc';
        desc.textContent = step.description;
        body.appendChild(desc);
      }

      if (step.args && Object.keys(step.args).length > 0) {
        const argsBlock = document.createElement('div');
        argsBlock.className = 'p3-investigation-args';
        const argsLabel = document.createElement('div');
        argsLabel.className = 'p3-investigation-label';
        argsLabel.textContent = _L('参数', 'Args');
        argsBlock.appendChild(argsLabel);
        const argsPre = document.createElement('pre');
        argsPre.className = 'p3-investigation-args-pre code-surface code-surface--block';
        argsPre.textContent = formatVal(step.args);
        argsBlock.appendChild(argsPre);
        body.appendChild(argsBlock);
      }

      const resultBlock = document.createElement('div');
      resultBlock.className = 'p3-investigation-result';
      const resultLabel = document.createElement('div');
      resultLabel.className = 'p3-investigation-label';
      resultLabel.textContent = _L('返回', 'Result');
      resultBlock.appendChild(resultLabel);
      const resultPre = document.createElement('pre');
      resultPre.className = 'p3-investigation-result-pre code-surface code-surface--block';
      resultPre.textContent = String(step.result ?? '');
      resultBlock.appendChild(resultPre);
      body.appendChild(resultBlock);

      details.appendChild(body);
      live.investigationContainer.appendChild(details);
    }

    /**
     * 更新 meta-bar 状态文字：思考第 N 轮、isLastIter 时变红。
     *
     * **副作用**：每轮开始时清空 descriptionBody——本轮 description 从头流式累积。
     * 中间轮 description 已经通过 onInvestigationStep 写到调研块的 details 里了
     * （不丢失），UI 主区只该显示**当前轮**的 description。否则前几轮描述会拼到
     * 最终轮 description 后面（"我先查下陆青渊...建议改成..."）。
     *
     * **D10 retry 进度**：meta.retryCount > 0 时附加「· 重试 K 次」后缀，
     * 让作者知道 retry 路径在跑（否则 iteration 数字不变 + descriptionBody 被清空，
     * 看起来像卡死）。
     */
    markIterationStart(live, meta) {
      if (!live?.metaEl) return;
      live._iterations = meta.iteration || (live._iterations + 1);
      // 清空 descriptionBody，本轮新 description chunk 从头追加
      live._descRaw = '';
      if (live.descriptionBody) {
        live.descriptionBody.textContent = '';
      }
      const retryCount = (meta && typeof meta.retryCount === 'number') ? meta.retryCount : 0;
      const retrySuffix = retryCount > 0
        ? _L(` · 重试 ${retryCount} 次`, ` · retry ${retryCount}`)
        : '';
      const text = meta.isLastIter
        ? _L(
            `⚠ 最后一轮 —— 必须出最终答复${retrySuffix}`,
            `⚠ Final iteration — must finalize${retrySuffix}`
          )
        : _L(
            `⏳ 思考中（第 ${live._iterations} 轮${retrySuffix}）…`,
            `⏳ Thinking (iter ${live._iterations}${retrySuffix})…`
          );
      const span = live.metaEl.querySelector('.p3-meta-streaming');
      if (span) span.textContent = text;
    }

    /**
     * dispatcher 完成后调（result.kind 决定后续 UI 行为）。
     * 改造前签名：(live, result, originPrompt) —— result 是 callP3API 返的 {message, finishReason, ...}
     * 改造后签名：(live, result) —— result 是 dispatcher 返的 {kind, description, patch?, iterations}
     */
    finalizeCard(live, result) {
      if (!live) return;
      live.el.classList.remove('p3-assistant-card-streaming');

      // 移除 meta-bar（abort 路径会保留 meta-bar 放警告）
      if (live.metaEl?.parentNode) live.metaEl.parentNode.removeChild(live.metaEl);
      live.metaEl = null;

      // 确保 description 完整（流式过程可能漏字 / 状态机抢跑）—— 用 result.description 覆盖
      if (result?.description) {
        if (!live.descriptionBody) {
          const div = document.createElement('div');
          div.className = 'p3-card-section p3-prose-body';
          const body = document.createElement('div');
          body.className = 'p3-section-body';
          div.appendChild(body);
          if (live.investigationContainer && live.investigationContainer.parentNode === live.el) {
            live.el.insertBefore(div, live.investigationContainer);
          } else {
            live.el.appendChild(div);
          }
          live.descriptionBody = body;
        }
        live._descRaw = result.description;
        live.descriptionBody.innerHTML = _proseHtml(result.description);
      } else if (!live.descriptionBody) {
        // 完全没拿到 description（json_bail / error 等）
        const empty = document.createElement('div');
        empty.className = 'p3-card-section p3-prose-body';
        const body = document.createElement('div');
        body.className = 'p3-section-body';
        body.textContent = _L('（AI 没返回内容）', '(empty response)');
        empty.appendChild(body);
        live.el.appendChild(empty);
      }

      // 记下 regenerate 意图，attachRegenerateButton 决定放哪
      live._pendingRegenerate = {
        originPrompt: live._histMsgRef?._p3OriginPrompt || null,
        histMsg: live._histMsgRef || null,
      };
    }

    /**
     * 决定「重新生成」按钮的位置：
     * - 有 diff section → 注入到 .p3-diff-actions 行最左
     * - 无 diff section → fallback 单独 footer
     */
    attachRegenerateButton(live) {
      if (!live?._pendingRegenerate) return;
      const { originPrompt, histMsg } = live._pendingRegenerate;
      live._pendingRegenerate = null;
      if (!originPrompt) return;
      const diffActions = live.el.querySelector('.p3-diff-actions');
      if (diffActions) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-ghost btn-sm p3-regen-btn';
        btn.style.marginRight = 'auto';
        btn.textContent = _L('↻ 重新生成', '↻ Regenerate');
        btn.title = _L('回滚这条 AI 回复 + 用同样的提问再发一次', 'Roll back this AI reply and resend the same prompt');
        btn.addEventListener('click', () => this.handlers.onRegenerate?.(histMsg, originPrompt, live));
        diffActions.insertBefore(btn, diffActions.firstChild);
        live.regenerateFooter = btn;
      } else {
        this._addRegenerateFooter(live, originPrompt, histMsg);
      }
    }

    abortCard(live, reasonText) {
      live.el.classList.remove('p3-assistant-card-streaming');
      live.el.classList.add('p3-assistant-card-aborted');
      if (live.metaEl) {
        live.metaEl.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'p3-meta-warn';
        span.textContent = `⚠ ${reasonText}`;
        live.metaEl.appendChild(span);
      }
    }

    _addRegenerateFooter(live, originPrompt, histMsg) {
      if (!originPrompt) return;
      // 只挂 .p3-card-footer，不挂 .p3-card-section——避免 section padding/border 把
      // 一个小按钮撑成独立横条。
      // Layout: 左边「重新生成」（跟有 diff section 时的位置一致），右边一行小灰字提示。
      const footer = document.createElement('div');
      footer.className = 'p3-card-footer';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-ghost btn-sm p3-regen-btn';
      btn.textContent = _L('↻ 重新生成', '↻ Regenerate');
      btn.title = _L('回滚这条 AI 回复 + 用同样的提问再发一次', 'Roll back this AI reply and resend the same prompt');
      btn.addEventListener('click', () => this.handlers.onRegenerate?.(histMsg, originPrompt, live));
      footer.appendChild(btn);

      const hint = document.createElement('span');
      hint.className = 'p3-card-footer-hint';
      hint.textContent = _L('可在下方输入栏输入你的想法', 'Type your thoughts in the input below');
      footer.appendChild(hint);

      live.el.appendChild(footer);
      live.regenerateFooter = footer;
    }

    markCardRegenerated(live) {
      live.el.classList.add('p3-assistant-card-regenerated');
      if (live.regenerateFooter) live.regenerateFooter.remove();
      const note = document.createElement('div');
      note.className = 'p3-card-section p3-regenerated-note';
      note.textContent = _L('↻ 已请求重新生成 — 新回复在下方', '↻ Regeneration requested — new reply below');
      live.el.appendChild(note);
    }

    // ============================================
    // Diff 面板（含 per-op checkbox）—— 签名兼容，patchId 参数名仍叫 toolCallId
    // ============================================
    addDiffSection(cardEl, toolCallId, patch, getCurrentDoc) {
      const logicalOps = this._pairOps(patch);
      const total = logicalOps.length;

      const details = document.createElement('details');
      details.className = 'p3-card-section p3-diff-section p3-diff-pending';
      details.open = true;
      details.dataset.toolCallId = toolCallId;
      details._p3LogicalOps = logicalOps;

      const summary = document.createElement('summary');
      summary.innerHTML = `
        <span class="p3-diff-summary-label">${escapeHtml(_L(`📋 修改预览 · ${total} 项`, `📋 Change preview · ${total} ops`))}</span>
        <span class="p3-diff-status-badge">${escapeHtml(_L('待决断', 'Pending'))}</span>
      `;
      details.appendChild(summary);

      const body = document.createElement('div');
      body.className = 'p3-section-body p3-diff-section-body';

      const selectControls = document.createElement('div');
      selectControls.className = 'p3-op-select-controls';
      selectControls.innerHTML = `
        <span class="p3-op-select-label">${escapeHtml(_L('已选', 'Selected'))} <span class="p3-op-selected-count">${total}</span> / ${total}</span>
        <button type="button" class="btn-ghost btn-sm" data-act="all">${escapeHtml(_L('全选', 'All'))}</button>
        <button type="button" class="btn-ghost btn-sm" data-act="none">${escapeHtml(_L('全不选', 'None'))}</button>
      `;
      body.appendChild(selectControls);

      body.appendChild(this._renderDiffContent(logicalOps, getCurrentDoc));

      const actions = document.createElement('div');
      actions.className = 'p3-diff-actions';

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.className = 'btn-secondary';
      rejectBtn.textContent = _L('拒绝整组', 'Reject all');
      rejectBtn.addEventListener('click', () => this.handlers.onRejectPatch?.(toolCallId));

      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn-primary';
      applyBtn.dataset.role = 'apply-btn';
      applyBtn.textContent = _L(`应用全部 ${total} 项`, `Apply all ${total}`);
      applyBtn.addEventListener('click', () => {
        const selectedRawOps = this._readSelectedOps(details);
        if (selectedRawOps.length === 0) return;
        const selectedCount = this._countSelectedLogicalOps(details);
        // 顺序型数组 patch（同一数组多条带数字索引 / '-' 追加）不能部分勾选：RFC6902 索引按「前面都执行」算，
        // 跳过其中一条会让后续索引错位、改到错误条目。这种 patch 强制整组应用。
        if (selectedCount < total && this._isOrderSensitiveArrayPatch(logicalOps)) {
          window.showAlertModal?.(
            _L('无法部分应用', 'Cannot partially apply'),
            _L(
              '这组改动对同一数组有多条按序操作，部分勾选会让索引错位、改到错误的条目。请整组应用或整组拒绝。',
              'This change set has multiple ordered operations on the same array; a partial selection would shift indices and edit the wrong items. Apply or reject the whole group.'
            ),
            null,
            { icon: 'warning' }
          );
          return;
        }
        this.handlers.onApplyPatch?.(toolCallId, selectedRawOps, total, selectedCount);
      });

      actions.appendChild(rejectBtn);
      actions.appendChild(applyBtn);
      body.appendChild(actions);

      const refreshLabel = () => {
        const n = this._countSelectedLogicalOps(details);
        selectControls.querySelector('.p3-op-selected-count').textContent = n;
        applyBtn.textContent = n === total
          ? _L(`应用全部 ${total} 项`, `Apply all ${total}`)
          : (n === 0 ? _L('请至少勾选一项', 'Select at least one') : _L(`应用选中 ${n}/${total} 项`, `Apply ${n}/${total} selected`));
        applyBtn.disabled = n === 0;
      };
      body.addEventListener('change', (e) => {
        if (e.target.classList.contains('p3-op-checkbox')) refreshLabel();
      });

      selectControls.addEventListener('click', (e) => {
        const act = e.target.dataset.act;
        if (!act) return;
        const boxes = details.querySelectorAll('.p3-op-checkbox');
        boxes.forEach(b => {
          if (act === 'all') b.checked = true;
          else if (act === 'none') b.checked = false;
        });
        refreshLabel();
      });

      details.appendChild(body);
      cardEl.appendChild(details);

      // 旧 pending 卡视觉降权：当前 details 保持完整 + 展开；更早还 pending 的卡
      // 加 .p3-diff-stale class（CSS 降 opacity + 收 details）。这样用户专注最新一组，
      // 但旧 pending 仍可点开 apply/reject（patchEngine 的 test op 会守门保证一致性）。
      this._staleOlderPendingSections(details);

      return details;
    }

    /** 把当前 chat 区里除 currentSection 之外的所有 pending diff section 标 stale + 收起 */
    _staleOlderPendingSections(currentSection) {
      const area = this._getChatArea();
      if (!area) return;
      area.querySelectorAll('.p3-diff-section.p3-diff-pending').forEach(sec => {
        if (sec === currentSection) return;
        if (sec.classList.contains('p3-diff-stale')) return;
        sec.classList.add('p3-diff-stale');
        if (sec.tagName === 'DETAILS') sec.open = false;
      });
    }

    // 检测「顺序型数组 patch」：同一父数组上有 ≥2 条以数字索引或 '-' 结尾的操作。
    // 这类 patch 的索引按顺序执行计算，不能部分勾选（跳过会让后续索引错位）。
    _isOrderSensitiveArrayPatch(logicalOps) {
      if (!Array.isArray(logicalOps)) return false;
      const parents = new Map();
      for (const lo of logicalOps) {
        const path = lo && typeof lo.path === 'string' ? lo.path : '';
        const m = path.match(/^(.*)\/(\d+|-)$/);
        if (!m) continue;
        const parent = m[1];
        parents.set(parent, (parents.get(parent) || 0) + 1);
      }
      for (const count of parents.values()) if (count >= 2) return true;
      return false;
    }

    _pairOps(patch) {
      const out = [];
      if (!Array.isArray(patch)) return out;
      for (let i = 0; i < patch.length; i++) {
        const op = patch[i];
        if (!op) continue;
        const next = patch[i + 1];
        if (
          op.op === 'test' && next && typeof next === 'object'
          && (next.op === 'replace' || next.op === 'remove')
          && next.path === op.path
        ) {
          out.push({
            kind: 'paired',
            displayOp: next.op,
            path: op.path,
            oldValue: op.value,
            newValue: next.op === 'replace' ? next.value : undefined,
            rawOps: [op, next],
          });
          i += 1;
          continue;
        }
        out.push({
          kind: 'single',
          displayOp: op.op,
          path: op.path,
          oldValue: undefined,
          newValue: op.value,
          from: op.from,
          rawOps: [op],
        });
      }
      return out;
    }

    updateDiffSectionStatus(toolCallId, status, extra) {
      const area = this._getChatArea();
      const section = area?.querySelector(`.p3-diff-section[data-tool-call-id="${toolCallId}"]`);
      if (!section) return;
      section.classList.remove('p3-diff-pending');
      section.classList.add(`p3-diff-${status}`);
      const badge = section.querySelector('.p3-diff-status-badge');
      const labels = {
        applied: _L('✓ 已应用', '✓ Applied'),
        rejected: _L('✗ 已拒绝', '✗ Rejected'),
        ignored: _L('⊘ 已跳过', '⊘ Ignored'),
        error: _L('⚠ 应用出错', '⚠ Apply error'),
      };
      if (badge) badge.textContent = extra ? `${labels[status] || status} (${extra})` : (labels[status] || status);
      const actions = section.querySelector('.p3-diff-actions');
      if (actions) actions.remove();
      const selectControls = section.querySelector('.p3-op-select-controls');
      if (selectControls) selectControls.remove();
      section.querySelectorAll('.p3-op-checkbox').forEach(cb => cb.disabled = true);
    }

    _readSelectedOps(section) {
      const logicalOps = section._p3LogicalOps || [];
      const out = [];
      logicalOps.forEach((logOp, i) => {
        const cb = section.querySelector(`.p3-op-checkbox[data-op-index="${i}"]`);
        if (cb?.checked) out.push(...logOp.rawOps);
      });
      return out;
    }

    _countSelectedLogicalOps(section) {
      const logicalOps = section._p3LogicalOps || [];
      let n = 0;
      logicalOps.forEach((_logOp, i) => {
        const cb = section.querySelector(`.p3-op-checkbox[data-op-index="${i}"]`);
        if (cb?.checked) n += 1;
      });
      return n;
    }

    _renderDiffContent(logicalOps, getCurrentDoc) {
      const container = document.createElement('div');
      container.className = 'p3-diff-body';

      let currentJson = null;
      try { currentJson = getCurrentDoc?.() || null; } catch (_) { currentJson = null; }

      logicalOps.forEach((logOp, idx) => {
        const div = document.createElement('div');
        div.className = `p3-diff-op p3-diff-op-${logOp.displayOp}`;
        div.dataset.opIndex = idx;

        const headRow = document.createElement('label');
        headRow.className = 'p3-diff-op-head-row';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'p3-op-checkbox';
        cb.checked = true;
        cb.dataset.opIndex = idx;
        headRow.appendChild(cb);

        // 双行 header：第一行中文面包屑（op 动词 + path 翻译），第二行 raw（小灰字 monospace）
        // 翻译走 worldCardFieldSchema.formatOp / formatPathBreadcrumb，未加载时 fallback 到 raw 防爆
        const header = document.createElement('div');
        header.className = 'p3-diff-op-header';

        const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN').startsWith('en');
        const lang = isEn ? 'en' : 'zh';
        const wcs = window.worldCardFieldSchema;
        const opLabel = wcs?.formatOp ? wcs.formatOp(logOp.displayOp, lang) : logOp.displayOp.toUpperCase();
        const breadcrumb = wcs?.formatPathBreadcrumb
          ? wcs.formatPathBreadcrumb(logOp.path, currentJson, lang)
          : logOp.path;

        const zhRow = document.createElement('div');
        zhRow.className = 'p3-diff-op-header-zh';
        zhRow.textContent = `${opLabel} · ${breadcrumb}`;

        const rawRow = document.createElement('div');
        rawRow.className = 'p3-diff-op-header-raw';
        rawRow.textContent = `${logOp.displayOp.toUpperCase()} ${logOp.path}`;

        header.appendChild(zhRow);
        header.appendChild(rawRow);
        headRow.appendChild(header);

        div.appendChild(headRow);

        if (logOp.displayOp === 'replace' || logOp.displayOp === 'remove') {
          let oldVal;
          if (logOp.kind === 'paired') {
            oldVal = logOp.oldValue;
          } else if (currentJson && window.P3PatchEngine) {
            oldVal = window.P3PatchEngine.getValueByPointer(currentJson, logOp.path);
          } else {
            oldVal = '<' + _L('无法读取', 'unavailable') + '>';
          }
          div.appendChild(this._diffLine('old', oldVal));
        } else if (logOp.displayOp === 'test') {
          div.appendChild(this._diffLine('test-expected', logOp.newValue));
        }

        if (logOp.displayOp === 'add' || logOp.displayOp === 'replace') {
          div.appendChild(this._diffLine('new', logOp.newValue));
        }

        if (logOp.displayOp === 'move' || logOp.displayOp === 'copy') {
          const fromText = document.createElement('div');
          fromText.className = 'p3-diff-line';
          fromText.textContent = `from: ${logOp.from}`;
          div.appendChild(fromText);
        }

        container.appendChild(div);
      });

      return container;
    }

    _diffLine(kind, val) {
      const line = document.createElement('div');
      line.className = `p3-diff-line p3-diff-line-${kind}`;
      const text = formatVal(val);
      const lineCount = text.split('\n').length;
      // 短内容（≤3 行）直接渲染——保持简单
      if (lineCount <= 3) {
        line.textContent = text;
        return line;
      }
      // 长内容：默认折叠到 3 行 + 「展开全部 N 行」按钮，再点切回折叠
      line.classList.add('p3-diff-line-collapsible', 'collapsed');
      const body = document.createElement('div');
      body.className = 'p3-diff-line-body';
      body.textContent = text;
      line.appendChild(body);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'p3-diff-line-toggle';
      const updateLabel = () => {
        const collapsed = line.classList.contains('collapsed');
        toggle.textContent = collapsed
          ? _L(`▾ 展开全部 ${lineCount} 行`, `▾ Expand all ${lineCount} lines`)
          : _L('▴ 折叠', '▴ Collapse');
      };
      updateLabel();
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        line.classList.toggle('collapsed');
        updateLabel();
      });
      line.appendChild(toggle);
      return line;
    }

    addInlineError(cardEl, text) {
      const div = document.createElement('div');
      div.className = 'p3-card-section p3-inline-error';
      div.textContent = text;
      cardEl.appendChild(div);
    }

    // ===== 清 P3 消息 =====
    clearLog() {
      const area = this._getChatArea();
      if (!area) return;
      area.querySelectorAll(
        '.p3-user-msg, .p3-assistant-card, .p3-msg, .p3-locked-banner'
      ).forEach(el => el.remove());
    }

    // ============================================
    // 历史重建（refreshChatUI 调用，纯只读还原）
    // ============================================
    renderHistoricalUserCard(msgEl, _histMsg) {
      if (!msgEl) return;
      msgEl.classList.add('p3-user-msg', 'design-mode-msg');
    }

    /**
     * 双路重建：
     *   - 新形态 histMsg 含 _p3Patch + _p3PatchId / _p3InvestigationSteps → 走新路
     *   - 老形态 histMsg 含 _p3ToolCalls + _p3Resolutions → 走旧路（兼容旧存档）
     */
    renderHistoricalAssistantCard(msgEl, histMsg) {
      if (!msgEl) return;
      msgEl.classList.add('p3-assistant-card', 'design-mode-msg');

      const contentEl = msgEl.querySelector('.chat-message-content');
      if (contentEl) contentEl.remove();
      const labelEl = msgEl.querySelector('.chat-user-label');
      if (labelEl) labelEl.remove();

      // reasoning 段（_p3Reasoning 在新老形态都可能存在）
      if (histMsg._p3Reasoning) {
        const details = document.createElement('details');
        details.className = 'p3-card-section p3-reasoning-body';
        details.open = false;
        const summary = document.createElement('summary');
        summary.textContent = _L('💭 推理过程', '💭 Reasoning');
        details.appendChild(summary);
        const body = document.createElement('div');
        body.className = 'p3-section-body';
        body.textContent = histMsg._p3Reasoning;
        details.appendChild(body);
        msgEl.appendChild(details);
      }

      // prose / description 段
      if (histMsg.text) {
        const div = document.createElement('div');
        div.className = 'p3-card-section p3-prose-body';
        const body = document.createElement('div');
        body.className = 'p3-section-body';
        body.innerHTML = _proseHtml(histMsg.text);
        div.appendChild(body);
        msgEl.appendChild(div);
      }

      // 新形态：调研轨迹折叠
      if (Array.isArray(histMsg._p3InvestigationSteps) && histMsg._p3InvestigationSteps.length > 0) {
        const fakeLive = { el: msgEl, investigationContainer: null };
        for (const step of histMsg._p3InvestigationSteps) {
          this.addInvestigationStep(fakeLive, step);
        }
      }

      // 新形态：patch + 终态 resolution
      if (histMsg._p3Patch && Array.isArray(histMsg._p3Patch) && histMsg._p3PatchId) {
        const pid = histMsg._p3PatchId;
        this.addDiffSection(msgEl, pid, histMsg._p3Patch, () => window.designService?.designConfig || null);
        const res = histMsg._p3Resolutions?.[pid];
        if (res && res.resolution && res.resolution !== 'pending') {
          this.updateDiffSectionStatus(pid, res.resolution, res.detail);
        }
        // 仍 pending（作者尚未决定）：保留 addDiffSection 刚建好的 apply/reject 按钮，不再标「已过期」剥按钮。
        // 否则刷新 / 切语言 / mode 往返触发 refreshChatUI 重建后，有效未决 patch 会被灰掉、永远无法应用（数据丢失）。
        // 若此刻 designConfig 已变，应用时 test op 会优雅失配并提示，比直接吞掉 patch 安全。
        return;
      }

      // 老形态截断警告（_p3FinishReason='length'）
      if (histMsg._p3FinishReason === 'length') {
        const warn = document.createElement('div');
        warn.className = 'p3-card-section p3-truncation-warning';
        warn.innerHTML = `
          <div class="p3-trunc-title">${escapeHtml(_L('⚠ 输出被截断 (finish_reason=length)', '⚠ Output truncated (finish_reason=length)'))}</div>
          <div class="p3-trunc-detail">${escapeHtml(_L('AI 输出达到模型上限，patch 不完整。', 'AI hit the model output limit; the patch is incomplete.'))}</div>
        `;
        msgEl.appendChild(warn);
      }

      // 老形态：_p3ToolCalls + diff sections
      const toolCalls = Array.isArray(histMsg._p3ToolCalls) ? histMsg._p3ToolCalls : [];
      const resolutions = histMsg._p3Resolutions || {};
      for (const tc of toolCalls) {
        if (tc.function?.name !== 'apply_patch') continue;
        let args;
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (_) { args = {}; }
        const patch = Array.isArray(args.patch) ? args.patch : [];
        if (patch.length === 0) continue;
        this.addDiffSection(msgEl, tc.id, patch, () => window.designService?.designConfig || null);
        const res = resolutions[tc.id];
        if (res && res.resolution && res.resolution !== 'pending') {
          this.updateDiffSectionStatus(tc.id, res.resolution, res.detail);
        } else {
          this.updateDiffSectionStatus(tc.id, 'ignored', _L('已过期', 'expired'));
        }
      }
    }

    renderHistoricalSystemMsg(msgEl, histMsg) {
      if (!msgEl) return;
      msgEl.classList.add('p3-msg', 'p3-msg-system');
      const content = msgEl.querySelector('.chat-message-content');
      if (content) content.textContent = histMsg.text || '';
    }
  }

  /**
   * check_consistency 调研步的体检结果 chip（复用建造段 .pzwc-tool-chip 样式，app.css PZWC 块）。
   * 只认 p3Tools 的两种正常产出（全部通过 / 检出 N 项；总分 S）；工具报错类结果不出 chip。
   */
  function _inspectionChip(step) {
    if ((step?.tool || '') !== 'check_consistency') return null;
    const result = String(step?.result ?? '');
    if (!result.startsWith('[check_consistency]')) return null;
    const passed = result.includes('全部通过');
    const count = /检出 (\d+) 项/.exec(result);
    if (!passed && !count) return null;
    const score = /总分 (-?\d+)/.exec(result);
    const chip = document.createElement('span');
    chip.className = 'pzwc-tool-chip ' + (passed ? 'is-pass' : 'is-fail');
    if (passed) {
      chip.textContent = _L('体检通过', 'Passed');
    } else {
      const parts = [];
      if (score) parts.push('score=' + score[1]);
      parts.push(_L(`检出 ${count[1]} 项`, `${count[1]} issue(s)`));
      chip.textContent = parts.join(' · ');
    }
    return chip;
  }

  /**
   * 给 args 生成一句话简介（投到调研步 summary 的 `> 调用 X (args)` 处）。
   */
  function _briefArgs(args) {
    if (!args || typeof args !== 'object') return '';
    const keys = Object.keys(args);
    if (keys.length === 0) return '';
    if (args.path) return args.path;
    if (args.keyword) return `"${args.keyword}"`;
    if (args.scope) return `scope=${args.scope}`;
    // 兜底：前两个字段 inline
    const first = keys.slice(0, 2).map(k => {
      const v = args[k];
      if (typeof v === 'string' && v.length < 40) return `${k}="${v}"`;
      return `${k}=${typeof v}`;
    }).join(' ');
    return first;
  }

  window.P3UI = P3UI;
})();
