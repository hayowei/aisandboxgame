/**
 * ai/npc-ooc.js
 * NPC Reaction Part + OOC (Out-Of-Context) Part
 *
 * 通过 mixin 模式扩展 AIService.prototype。所有方法实现与原 class
 * AIService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyAIServiceMixin 合并到 AIService 上。
 *
 * 内容：
 * - NPC Reaction：触发 NPC 角色反应、对话风格构建
 * - OOC Part：sub-agent 协调、上下文外操作处理
 *
 * 加载顺序：必须在 aiService.js 之后加载。
 */

class _AIServiceNpcOocMixin {
  // ==========================================
  // NPC Reaction Part
  // ==========================================

  /**
   * 并行调用所有选中 NPC 的独立自主决策
   * @returns {Array<{npcId, name, text, decision}>} 成功的决策列表
   */
  async _runNpcReactionCalls(adapter, messages, _systemContext) {
    const selectedNpcs = this._getSelectedPromptNpcs();
    if (selectedNpcs.length === 0) return [];

    const lastUserMessage =
      messages
        .slice()
        .reverse()
        .find(m => m.role === 'user')?.content || '';
    if (!lastUserMessage.trim()) return [];

    const worldSummary = this._buildNpcWorldSummary();
    const gameState = this._buildNpcGameState();
    const summaries = typeof summaryService !== 'undefined' ? summaryService.getSummaries() : [];
    const recentHistory = this._buildNpcRecentHistory(messages);
    const reactionHistory =
      typeof npcReactionStore !== 'undefined' ? npcReactionStore.getRecentReactions(4) : [];

    // Analytics Phase 5a: 本回合 NPC reaction 批次共享一个 parent id，便于按回合聚合
    let _npcBatchReqId;
    try { _npcBatchReqId = crypto.randomUUID(); }
    catch (_) { _npcBatchReqId = 'npcb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

    const context = {
      worldSummary,
      gameState,
      summaries,
      recentHistory,
      lastUserMessage,
      reactionHistory,
      _npcBatchReqId,
    };

    console.log(`[NPC Decision] 开始并行调用 ${selectedNpcs.length} 个 NPC 自主决策`);
    const startTime = performance.now();

    // 清空 npcReaction 通道的累积 snapshot——本回合的并发结果会按 NPC 顺序 push 到数组
    if (window.promptRegistry?.clearSnapshot) {
      window.promptRegistry.clearSnapshot('npcReaction');
    }

    const results = await Promise.allSettled(
      selectedNpcs.map(npc => this._callSingleNpcReaction(adapter, npc, context))
    );

    const reactions = [];
    results.forEach((result, i) => {
      const npc = selectedNpcs[i];
      // 嵌套结构：id/name 在 npc.card 里；fallback 兼容老平铺
      const npcId = npc.card?.id || npc.id;
      const npcName = npc.card?.name || npc.name;
      if (result.status === 'fulfilled' && result.value) {
        const val = result.value;
        reactions.push({
          npcId,
          name: npcName,
          text: val.text || '',
          decision: val.decision || null,
        });
        const decisionTag = val.decision ? '✓ structured' : '○ text-only'; /* ui-lint-allow */
        console.log(`[NPC Decision] ${npcName || npcId}: ${decisionTag}`);
      } else {
        const reason = result.status === 'rejected' ? result.reason?.message : 'empty response';
        console.warn(`[NPC Decision] ${npcName || npcId} 决策失败: ${reason}`);
      }
    });

    const elapsed = Math.round(performance.now() - startTime);
    const structured = reactions.filter(r => r.decision).length;
    console.log(
      `[NPC Decision] 完成: ${reactions.length}/${selectedNpcs.length} 成功 (${structured} structured), 耗时 ${elapsed}ms`
    );

    // ━━━ Card Sync 接力 ━━━
    // 在 N 个 reaction 跑完后再发一次 API call，让模型看完所有 reaction 输出
    // 决定是否需要调 update_npc 同步**身份层**持久字段（衣物/外貌/性格/阵营/世界卡扩展）。
    // NPC 自治字段由 reaction 本体经 applyReactionToState 落地，本 subagent 不动。
    // 失败不阻塞 reactions 的 return；调用副作用通过 update_npc.execute 进审批队列。
    if (reactions.length > 0 && typeof this._runNpcCardSyncSubagent === 'function') {
      try {
        await this._runNpcCardSyncSubagent(adapter, reactions, context);
      } catch (e) {
        console.warn('[NPC CardSync] 接力失败，不阻塞主流程:', e?.message || e);
      }
    }

    this.lastNpcReactions = reactions.length > 0 ? reactions : null;
    return reactions;
  }

  /**
   * 为单个 NPC 构建 prompt 并调用 API，返回结构化决策
   * @returns {{ text: string, decision: Object|null }} 或 null
   */
  async _callSingleNpcReaction(adapter, npc, context) {
    // 通过 promptRegistry 装配 npcReaction.corePrompt（传 npcId 让 snapshot 可区分并发 NPC）
    // 嵌套结构：从 npc.card 取 id/name；fallback 兼容老平铺
    const npcIdForSnapshot = npc?.card?.id || npc?.id || npc?.card?.name || npc?.name || null;
    let corePrompt;
    if (window.promptRegistry?.has?.('core.npcReaction')) {
      const { parts } = window.promptRegistry.assembleChannel('npcReaction', {
        npcId: npcIdForSnapshot,
      });
      corePrompt =
        parts.map(p => p.text).join('\n') ||
        this._getRequiredCorePromptString('CORE_PROMPT_NPC_REACTION');
    } else {
      corePrompt = this._getRequiredCorePromptString('CORE_PROMPT_NPC_REACTION');
    }

    // A2 顺序保留（共享前置 → 独有后置），但移除 cacheable 标记：
    // Anthropic ephemeral cache 在 Promise.all 并发调用下永远 miss（cache 只在响应返回后写入），
    // 标 cacheable 反而白付 cache_write 25% 溢价。OpenAI/Gemini 的 implicit cache 不依赖标记，
    // 仅依赖前缀稳定性，A2 顺序已能让其受益。
    const systemParts = [];

    // Part 1: 核心指令（所有 NPC 通用，最稳定）
    systemParts.push({ text: corePrompt, cacheable: false });

    // Part 2: 世界背景（所有 NPC 通用）
    if (context.worldSummary) {
      systemParts.push({ text: context.worldSummary, cacheable: false });
    }

    // Part 3: 剧情总结（所有 NPC 通用）
    if (context.summaries.length > 0) {
      systemParts.push({
        text: `## 之前剧情的总结\n\n${context.summaries.join('\n')}`,
        cacheable: false,
      });
    }

    // Part 4: 最近对话（所有 NPC 通用）
    if (context.recentHistory) {
      systemParts.push({
        text: `## 最近的对话\n\n${context.recentHistory}`,
        cacheable: false,
      });
    }

    // Part 5: 当前游戏状态（所有 NPC 通用）
    if (context.gameState) {
      systemParts.push({ text: context.gameState, cacheable: false });
    }

    // ── 以下为每个 NPC 独有 ──

    // Part 6: 角色档案
    // 注意：剥掉 state 子对象——他只通过 reactionHistory 看到自己上回合做了什么/想了什么，
    // 而不通过结构化 state 字段。防止 LLM 把"我之前 mood=压抑"当成"我应该继续压抑"的锚定。
    // 新嵌套结构：档案 = npc.card 子对象；fallback 兼容老平铺（去掉 state）
    let cardForPrompt;
    if (npc.card && typeof npc.card === 'object') {
      cardForPrompt = { ...npc.card };
    } else {
      const { state: _omitState, ...rest } = npc;
      cardForPrompt = rest;
    }
    const npcJson = JSON.stringify(cardForPrompt, null, 2);
    systemParts.push({ text: `## 你的角色档案\n\n${npcJson}`, cacheable: false });

    // Part 7: 其他角色的当前状态（上一轮决策结果）
    const selfId = npc.card?.id || npc.id;
    const otherNpcText = this._buildOtherNpcStatusText(context.reactionHistory, selfId);
    if (otherNpcText) {
      systemParts.push({ text: otherNpcText, cacheable: false });
    }

    // Part 8: 你自己的历史决策
    const historyText = this._buildNpcReactionHistoryText(context.reactionHistory, selfId);
    if (historyText) {
      systemParts.push({ text: historyText, cacheable: false });
    }

    const triggerMessages = [{ role: 'user', parts: [{ text: context.lastUserMessage }] }];

    const temperature = this.getModuleTemperature('npc_reaction', 1.0, AI_REQUEST_SCOPED);
    // thinking 选择：
    //   • 推荐模式：用 npc_reaction 配置（v4-flash + thinking=max）；
    //     无 function tool（纯 JSON 输出）→ forced-tool gate 不触发，thinking 真实生效。
    //   • 非推荐模式（simple/advanced）：强制 'off'，保留 NPC reaction 历史的"轻量 JSON
    //     决策、强制低延迟"语义；避免用户给 react 设了 high 后 NPC reaction 也被拖慢。
    const isRecommended = this.getEffectiveApiSettingsMode(AI_REQUEST_SCOPED) === 'recommended';
    const npcThinking = isRecommended
      ? this.getModuleThinking('npc_reaction', AI_REQUEST_SCOPED)
      : 'off';
    const { payload, url } = adapter.buildPayload(triggerMessages, systemParts, [], {
      temperature,
      thinking: npcThinking,
    });

    const npcStepLog = {
      step: 'parallel',
      phase: 'npc_reaction',
      npcId: selfId,
      npcName: npc.card?.name || npc.name || selfId,
      model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
      provider: adapter.getProviderLabel(),
      request: this._cloneSerializable(payload),
      url: url.replace(/key=[^&]+/, 'key=***'),
    };
    if (this.lastPayload?.steps) {
      this.lastPayload.steps.push(npcStepLog);
    }
    this._markStepStarted(npcStepLog);

    const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      const result = await adapter.callAPI(url, payload, null, this._currentAbortSignal);
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      const rawResponse = Object.prototype.hasOwnProperty.call(result || {}, 'raw')
        ? result.raw
        : result;

      npcStepLog.response = rawResponse || null;
      npcStepLog.responseBody = result;
      npcStepLog.responseText = text || null;
      npcStepLog.metrics = result?.metrics || null;
      this._markStepSucceeded(npcStepLog);

      this._trackSubagentCall({
        subsystem: 'npc_reaction',
        parentRequestId: context?._npcBatchReqId || null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        metrics: result?.metrics || null,
        ok: true,
      });

      if (!text) return null;

      // 解析结构化 JSON 决策
      const decision = this._parseNpcDecisionJson(text, npc.card?.name || npc.name || selfId);
      return {
        text: decision ? decision.inner_thought || text : text,
        decision,
      };
    } catch (e) {
      this._markStepFailure(npcStepLog, e, {
        phase: 'npc_reaction',
        module: 'npc_reaction',
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
        url,
      });
      this._trackSubagentCall({
        subsystem: 'npc_reaction',
        parentRequestId: context?._npcBatchReqId || null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        ok: false,
        errorMessage: e?.message || String(e),
      });
      throw e;
    }
  }

  // ==========================================
  // OOC Part
  // ==========================================

  /**
   * OOC subagent 单轮调用 + JSON 解析。
   * Round 1 可输出 commit / continue / ask；Round 2 仅限 commit / continue（ask 会被兜底为 continue）。
   * @param {Object} adapter
   * @param {Array<string>} candidates
   * @param {Object} ctx - { round: 1|2, askedQuestion?, userAnswer?, userSkipped? }
   * @returns {Promise<{mode, directive?, question?, rawText}|null>}
   */
  async _callOocNormalizer(adapter, candidates, ctx = {}) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const round = ctx.round === 2 ? 2 : 1;

    // 通过 promptRegistry 装配 ooc 通道核心 prompt（fallback 到原全局常量）
    const channel = round === 2 ? 'oocRound2' : 'oocRound1';
    let corePrompt;
    if (window.promptRegistry?.has?.('core.ooc')) {
      const { parts } = window.promptRegistry.assembleChannel(channel, {});
      corePrompt =
        parts.map(p => p.text).join('\n') ||
        this._getRequiredCorePromptString('CORE_PROMPT_OOC');
    } else {
      corePrompt = this._getRequiredCorePromptString('CORE_PROMPT_OOC');
    }
    const isEn = this._getGamePromptLanguage() === 'en';

    // trigger 模板由 promptRegistry 提供（让 inspector 能看到完整 prompt）
    const triggerBlock = window.promptRegistry?.get?.(
      round === 2 ? 'oocRound2.triggerTemplate' : 'oocRound1.triggerTemplate'
    );
    const triggerText = triggerBlock?.builder({
      isEn,
      candidates,
      askedQuestion: ctx.askedQuestion,
      userAnswer: ctx.userAnswer,
    }) || '';

    // C4: 标记可缓存，让 round 2 命中 round 1 创建的缓存
    const systemParts = [{ text: corePrompt, cacheable: true }];
    const triggerMessages = [{ role: 'user', parts: [{ text: triggerText }] }];

    const temperature = this.getModuleTemperature('ooc_normalizer', 1.0, AI_REQUEST_SCOPED);
    // thinking 选择：见 _callSingleNpcReaction 同款解释（推荐模式走配置，
    // 非推荐模式强制 'off' 保留历史"轻量 JSON 路由判真"语义）。
    const isRecommended = this.getEffectiveApiSettingsMode(AI_REQUEST_SCOPED) === 'recommended';
    const oocThinking = isRecommended
      ? this.getModuleThinking('ooc_normalizer', AI_REQUEST_SCOPED)
      : 'off';
    const { payload, url } = adapter.buildPayload(triggerMessages, systemParts, [], {
      temperature,
      thinking: oocThinking,
    });

    const stepLog = {
      step: 'parallel',
      phase: 'ooc',
      round,
      model: this.getModelForModule('ooc_normalizer', AI_REQUEST_SCOPED),
      provider: adapter.getProviderLabel(),
      request: this._cloneSerializable(payload),
      url: url.replace(/key=[^&]+/, 'key=***'),
    };
    if (this.lastPayload?.steps) this.lastPayload.steps.push(stepLog);
    this._markStepStarted(stepLog);

    try {
      const result = await adapter.callAPI(url, payload, null, this._currentAbortSignal);
      const text = typeof result?.text === 'string' ? result.text.trim() : '';
      stepLog.response = Object.prototype.hasOwnProperty.call(result || {}, 'raw')
        ? result.raw
        : result;
      stepLog.responseBody = result;
      stepLog.responseText = text || null;
      stepLog.metrics = result?.metrics || null;
      this._markStepSucceeded(stepLog);

      const parsed = this._parseOocOutput(text);
      stepLog.parsed = parsed;
      // Round 2 禁止 ask：意外返回 ask 一律降级为 continue
      if (round === 2 && parsed.mode === 'ask') {
        stepLog.downgraded = 'ask->continue (round 2)';
        return { mode: 'continue', rawText: text };
      }
      return { ...parsed, rawText: text };
    } catch (e) {
      this._markStepFailure(stepLog, e, {
        phase: 'ooc',
        round,
        module: 'ooc',
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('ooc_normalizer', AI_REQUEST_SCOPED),
        url,
      });
      throw e;
    }
  }

  /**
   * 解析 subagent 的 JSON 输出，带容错 fallback。
   * @param {string} text
   * @returns {{mode: 'commit'|'continue'|'ask'|'unknown', directive?: string, question?: string}}
   */
  _parseOocOutput(text) {
    if (!text) return { mode: 'continue' };

    // 先尝试 strip ```json fence
    let src = text.trim();
    const fenceMatch = src.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) src = fenceMatch[1].trim();

    // 尝试定位第一个 { 到对应 } 的块
    const firstBrace = src.indexOf('{');
    const lastBrace = src.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonStr = src.slice(firstBrace, lastBrace + 1);
      try {
        const obj = JSON.parse(jsonStr);
        if (obj && typeof obj === 'object') {
          const mode = obj.mode;
          if (mode === 'commit' && typeof obj.directive === 'string' && obj.directive.trim()) {
            return { mode: 'commit', directive: obj.directive.trim() };
          }
          if (mode === 'continue') return { mode: 'continue' };
          if (mode === 'ask' && typeof obj.question === 'string' && obj.question.trim()) {
            return { mode: 'ask', question: obj.question.trim() };
          }
        }
      } catch (_) { /* fall through to text fallback */ }
    }

    // Fallback：向后兼容。纯文本=继续/continue → continue；其他非空文本 → commit
    if (!text.trim()) return { mode: 'continue' };
    const normalized = text.replace(/[。.!！\s]+$/u, '').toLowerCase();
    if (normalized === '继续' || normalized === 'continue') return { mode: 'continue' };
    return { mode: 'commit', directive: text };
  }

  /**
   * OOC 工作流编排：round 1 → 可选反问 → round 2。
   * 不抛出异常（catch 内清空 pending，打 console 警告），使 Phase 1 Promise.all 永不因为 OOC 失败而 reject。
   */
  async _runOocWorkflow(adapter, candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return;

    let round1;
    try {
      round1 = await this._callOocNormalizer(adapter, candidates, { round: 1 });
    } catch (e) {
      console.warn('[OOC] round 1 failed:', e?.message || e);
      this.clearPendingOoc();
      return;
    }

    if (!round1 || round1.mode === 'continue') return;
    if (round1.mode === 'commit' && round1.directive) {
      this.setPendingOoc({ raw: candidates.slice(), normalized: round1.directive });
      return;
    }
    if (round1.mode !== 'ask' || !round1.question) return;

    // 反问环节：跨层请求玩家输入
    const userResponse = await this._requestOocAnswer(round1.question);
    if (!userResponse || userResponse.skipped) {
      // 跳过 → 按产品决策：不进入 round 2，不注入任何准则
      return;
    }

    let round2;
    try {
      round2 = await this._callOocNormalizer(adapter, candidates, {
        round: 2,
        askedQuestion: round1.question,
        userAnswer: userResponse.answer || '',
      });
    } catch (e) {
      console.warn('[OOC] round 2 failed:', e?.message || e);
      this.clearPendingOoc();
      return;
    }

    if (round2?.mode === 'commit' && round2.directive) {
      this.setPendingOoc({ raw: candidates.slice(), normalized: round2.directive });
    }
    // 其他情形（continue / 解析失败）→ 不设 pending，本轮不注入
  }

  /**
   * 解析 NPC 决策 JSON，支持 ```json 包裹和裸 JSON
   * @returns {Object|null} 解析成功返回决策对象，失败返回 null（fallback 到纯文本）
   */
  _parseNpcDecisionJson(text, npcLabel) {
    let jsonStr = text;

    // 尝试提取 ```json ... ``` 包裹的内容
    const fencedMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fencedMatch) {
      jsonStr = fencedMatch[1].trim();
    }

    try {
      const obj = JSON.parse(jsonStr);
      // 验证：必须是对象（非数组）且有 action 字段
      if (obj && typeof obj === 'object' && !Array.isArray(obj) && typeof obj.action === 'string') {
        return obj;
      }
      console.warn(`[NPC Decision] ${npcLabel}: JSON 缺少 action 字段，fallback 到纯文本`);
      return null;
    } catch (e) {
      console.warn(`[NPC Decision] ${npcLabel}: JSON 解析失败，fallback 到纯文本`, e.message);
      return null;
    }
  }

  /**
   * 构建其他 NPC 的当前状态文本（基于最近一轮决策），让 NPC 之间能感知彼此
   */
  _buildOtherNpcStatusText(reactionHistory, currentNpcId) {
    if (!Array.isArray(reactionHistory) || reactionHistory.length === 0) return '';

    // 取最近一轮的数据
    const lastTurn = reactionHistory[reactionHistory.length - 1];
    if (!lastTurn?.reactions) return '';

    const lines = [];
    for (const [npcId, r] of Object.entries(lastTurn.reactions)) {
      if (npcId === currentNpcId) continue;
      const name = r.name || npcId;
      if (r.decision) {
        const d = r.decision;
        const parts = [`${name}`];
        if (d.action) parts.push(`正在：${d.action}`);
        if (d.location) parts.push(`位置：${d.location}`);
        if (d.mood) parts.push(`情绪：${d.mood}`);
        lines.push(parts.join(' | '));
      } else if (r.text) {
        lines.push(`${name}：${r.text.substring(0, 80)}`);
      }
    }

    return lines.length > 0
      ? `## 其他角色的当前状态\n\n${lines.join('\n')}`
      : '';
  }

  _buildNpcWorldSummary() {
    const parts = [];

    const worldSummary = window.entityStore?.getSummary?.();
    if (worldSummary) parts.push(`世界：${worldSummary}`);

    const promptConfig = window.worldMeta?.getPromptConfig?.();
    const rulesSummary = promptConfig?._summary;
    if (rulesSummary) parts.push(`规则：${rulesSummary}`);

    return parts.length > 0 ? `## 世界背景\n\n${parts.join('\n')}` : '';
  }

  _buildNpcGameState() {
    const parts = [];

    if (typeof timelineService !== 'undefined') {
      const date = timelineService.getCurrentDate?.();
      if (date) {
        const normalizedTime = this._normalizeClockTimeString(date.time_str || date.timeStr || '');
        const timeStr = normalizedTime ? ` ${normalizedTime}` : '';
        parts.push(`时间：${date.year}年${date.month}月${date.day}日${timeStr}`);
      }
    }

    if (typeof locationTracker !== 'undefined') {
      const loc = locationTracker.getLocation?.();
      if (loc) {
        const locParts = [loc.country, loc.site, loc.spot].filter(Boolean);
        if (locParts.length > 0) parts.push(`地点：${locParts.join(' > ')}`);
      }
    }

    return parts.length > 0 ? `## 当前状态\n\n${parts.join('\n')}` : '';
  }

  _buildNpcRecentHistory(messages) {
    const recent = messages.slice(-6);
    if (recent.length === 0) return '';

    return recent
      .map(m => {
        const role = m.role === 'user' ? '玩家' : '叙事';
        const content = typeof m.content === 'string' ? m.content : '';
        const truncated = content.length > 500 ? content.substring(0, 500) + '…' : content;
        return `[${role}] ${truncated}`;
      })
      .join('\n\n');
  }

  /**
   * 格式化当前 NPC 自己的历史决策，帮助保持行为连贯性
   */
  _buildNpcReactionHistoryText(reactionHistory, currentNpcId) {
    if (!Array.isArray(reactionHistory) || reactionHistory.length === 0) return '';

    const lines = [];
    for (const { turnUID, reactions } of reactionHistory) {
      const myReaction = reactions[currentNpcId];
      if (!myReaction) continue;

      const turnLabel = turnUID.split('_')[1] || '?';
      if (myReaction.decision) {
        const d = myReaction.decision;
        const parts = [`轮次 ${turnLabel}:`];
        if (d.action) parts.push(`  行动：${d.action}`);
        if (d.location) parts.push(`  位置：${d.location}`);
        if (d.mood) parts.push(`  情绪：${d.mood}`);
        if (d.inner_thought) parts.push(`  想法：${d.inner_thought}`);
        lines.push(parts.join('\n'));
      } else if (myReaction.text) {
        lines.push(`轮次 ${turnLabel}:\n  ${myReaction.text}`);
      }
    }

    return lines.length > 0 ? `## 你之前的行动记录\n\n${lines.join('\n\n')}` : '';
  }

  /** @deprecated — use worldMeta / entityStore / npcStore / timelineStore directly */
  _getRuntimeStore() {
    return null;
  }

  _normalizeRawLocationValue(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().replace(/\s+/g, ' ');
    return trimmed ? `raw:${trimmed.toLowerCase()}` : '';
  }

  _normalizeLocationToken(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('entity:') || trimmed.startsWith('raw:')) {
      return trimmed;
    }

    if (typeof window.entityStore?.resolveCanonicalKey === 'function') {
      return window.entityStore.resolveCanonicalKey(trimmed);
    }
    return this._normalizeRawLocationValue(trimmed);
  }

  _normalizeLocationForCompare(location) {
    return {
      country: this._normalizeLocationToken(location?.country || ''),
      site: this._normalizeLocationToken(location?.site || ''),
      spot: this._normalizeLocationToken(location?.spot || ''),
    };
  }

  _getActiveTimeTerms() {
    if (window.worldMeta?.getActiveTimeTerms) return window.worldMeta.getActiveTimeTerms();
    return {
      era: '',
      precision: 'time',
      timeSegments: [],
      labels: { year: '年', month: '月', day: '日', hour: '时', minute: '分' },
    };
  }

  _getActiveCurrencyTerms() {
    if (window.worldMeta?.getActiveCurrencyTerms) return window.worldMeta.getActiveCurrencyTerms();
    return { currencyLabel: '', currencyShort: '' };
  }

  _getTimelineRuntime() {
    return typeof timelineService !== 'undefined' && timelineService ? timelineService : null;
  }

  _getOpeningRequestMode(lastUserMessage = '', lastGameState = null) {
    if (lastGameState) return null;
    const normalized = typeof lastUserMessage === 'string' ? lastUserMessage.trim() : '';
    if (!normalized) return null;
    return window.i18nService?.normalizeOpeningModeInput?.(normalized) || null;
  }

  _getOpeningEventCandidates(snapshot = null) {
    const runtime = this._getTimelineRuntime();
    if (!snapshot || !runtime || typeof runtime.getOpeningEventCandidates !== 'function') {
      return [];
    }
    return runtime.getOpeningEventCandidates(snapshot);
  }

  _extractRecommendedOpeningText(initText = '') {
    if (typeof initText !== 'string' || !initText.trim()) return '';
    const match = initText.match(
      /^\s*(?:[-*]\s+|\d+[.)、]\s*)?(?:推荐剧情|Recommended Opening)[：:]\s*(.+?)\s*$/im
    );
    if (!match || typeof match[1] !== 'string') return '';
    return match[1].trim();
  }

  _normalizeClockTimeString(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  _findOpeningTimeSegmentInText(text = '', _timeSegments = []) {
    if (typeof text !== 'string' || !text.trim()) return '';
    const match = text.match(/\b(\d{2}:\d{2})\b/);
    return this._normalizeClockTimeString(match?.[1] || '');
  }

  _extractFirstStructuredTimeFromText(
    text = '',
    precision = 'time',
    timeSegments = [],
    runtime = null
  ) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim() || !runtime || typeof runtime.parseTimeString !== 'function') return null;

    const normalizedPrecision = ['year', 'month', 'day', 'time'].includes(precision)
      ? precision
      : 'day';
    const patterns =
      normalizedPrecision === 'year'
        ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d{2,}/g]
        : normalizedPrecision === 'month'
          ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+/g]
          : normalizedPrecision === 'time'
            ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+\s+\d{2}:\d{2}/g]
            : [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+/g];

    const lines = source.split('\n');
    for (const line of lines) {
      for (const pattern of patterns) {
        const matches = line.match(pattern) || [];
        for (const rawMatch of matches) {
          const parsed = runtime.parseTimeString(rawMatch);
          if (!parsed) continue;
          const normalized =
            typeof runtime.normalizeDateForPrecision === 'function'
              ? runtime.normalizeDateForPrecision(parsed, normalizedPrecision, timeSegments)
              : parsed;
          if (!normalized) continue;
          if (normalizedPrecision === 'time' && !normalized.time_str) {
            normalized.time_str = this._findOpeningTimeSegmentInText(line, timeSegments) || '00:00';
          }
          return normalized;
        }
      }
    }

    return null;
  }

  _resolveAuthorGuidanceOpeningTime(snapshot = null, initText = '') {
    const runtime = this._getTimelineRuntime();
    if (!snapshot || !runtime) return null;

    const timeTerms = this._getActiveTimeTerms();
    const precision = timeTerms?.precision || 'time';
    const timeSegments =
      Array.isArray(timeTerms?.timeSegments) && timeTerms.timeSegments.length > 0
        ? timeTerms.timeSegments
        : typeof runtime.getDefaultTimeSegments === 'function'
          ? runtime.getDefaultTimeSegments()
          : [];
    const greetingText =
      typeof snapshot?.prompt_modules?.opening_greeting === 'string'
        ? snapshot.prompt_modules.opening_greeting
        : '';

    return (
      this._extractFirstStructuredTimeFromText(greetingText, precision, timeSegments, runtime) ||
      this._extractFirstStructuredTimeFromText(initText, precision, timeSegments, runtime) ||
      null
    );
  }

  _normalizeOpeningRecommendationText(text = '') {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[，。！？；：“”‘’、（）《》【】…·,.!?;:'"(){}\[\]<>~`@#$%^&*_\-+=|\\/]/g, '')
      .replace(/\s+/g, '');
  }

  _extractOpeningRecommendationPhrases(text = '') {
    if (typeof text !== 'string' || !text.trim()) return [];
    const phrases = [];
    const seen = new Set();
    const pushPhrase = value => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      phrases.push(trimmed);
    };

    const quotedPattern = /[“"「『《](.+?)[”"」』》]/g;
    let match = null;
    while ((match = quotedPattern.exec(text))) {
      pushPhrase(match[1]);
    }

    text
      .split(/[，。！？；：、,.!?;:\n]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => pushPhrase(part));

    return phrases.slice(0, 8);
  }

  _getLongestCommonSubstringLength(textA = '', textB = '') {
    if (!textA || !textB) return 0;
    const rows = new Array(textB.length + 1).fill(0);
    let longest = 0;
    for (let i = 1; i <= textA.length; i++) {
      let previous = 0;
      for (let j = 1; j <= textB.length; j++) {
        const temp = rows[j];
        if (textA[i - 1] === textB[j - 1]) {
          rows[j] = previous + 1;
          if (rows[j] > longest) longest = rows[j];
        } else {
          rows[j] = 0;
        }
        previous = temp;
      }
    }
    return longest;
  }

  _formatOpeningLocationText(location = null) {
    if (!location || typeof location !== 'object') return '';
    return [location.country || '', location.site || '', location.spot || '']
      .filter(Boolean)
      .join(' · ');
  }

  _scoreRecommendedOpeningEvent(recommendationText = '', candidate = null) {
    const event = candidate?.event;
    if (!event || typeof event !== 'object') {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }

    const normalizedRecommendation = this._normalizeOpeningRecommendationText(recommendationText);
    if (!normalizedRecommendation) {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }

    const rawLocation = typeof event.location === 'string' ? event.location.trim() : '';
    const rawLocationParts = rawLocation
      ? rawLocation
          .split(/\s*(?:-|—|·|\/)\s*/)
          .map(part => part.trim())
          .filter(Boolean)
      : [];
    const displayLocationParts = rawLocationParts.map(part =>
      typeof window.entityStore?.resolveDisplayName === 'function'
        ? window.entityStore.resolveDisplayName(part) || part
        : part
    );
    const parsedLocationText = candidate?.location
      ? this._formatOpeningLocationText(candidate.location)
      : '';
    const eventText = this._normalizeOpeningRecommendationText(
      [
        rawLocation,
        rawLocationParts.join(' '),
        displayLocationParts.join(' '),
        parsedLocationText,
        event.characters || '',
        event.content || '',
        event.time || '',
        event.day || '',
      ]
        .filter(Boolean)
        .join(' ')
    );
    if (!eventText) {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }

    let score = 0;
    let phraseHits = 0;
    const fullMatch =
      eventText.includes(normalizedRecommendation) || normalizedRecommendation.includes(eventText);
    if (fullMatch) {
      score += 100 + Math.min(normalizedRecommendation.length, 40);
    }

    const phrases = this._extractOpeningRecommendationPhrases(recommendationText);
    phrases.forEach(phrase => {
      const normalizedPhrase = this._normalizeOpeningRecommendationText(phrase);
      if (!normalizedPhrase || normalizedPhrase.length < 2) return;
      if (eventText.includes(normalizedPhrase)) {
        phraseHits += 1;
        score += 30 + Math.min(normalizedPhrase.length * 3, 24);
      }
    });

    const longestCommon = this._getLongestCommonSubstringLength(
      normalizedRecommendation,
      eventText
    );
    score += Math.min(longestCommon * 2, 24);

    return { score, phraseHits, fullMatch, longestCommon };
  }

  _findRecommendedOpeningEvent(candidateEvents = [], initText = '') {
    const recommendationText = this._extractRecommendedOpeningText(initText);
    if (!recommendationText) {
      return null;
    }

    const scored = candidateEvents
      .map(candidate => ({
        candidate,
        recommendationText,
        ...this._scoreRecommendedOpeningEvent(recommendationText, candidate),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.candidate.eventIndex - a.candidate.eventIndex;
      });

    if (scored.length === 0) return null;
    const best = scored[0];
    const second = scored[1] || null;
    const isStrongMatch =
      best.fullMatch || best.phraseHits > 0 || best.longestCommon >= 5 || best.score >= 18;
    const isUniqueMatch = !second || best.score >= second.score + 5;
    if (!isStrongMatch || !isUniqueMatch) {
      return null;
    }

    return {
      candidate: best.candidate,
      recommendationText,
      matchScore: best.score,
    };
  }

  _getLatestOpeningEventCandidate(candidateEvents = []) {
    if (!Array.isArray(candidateEvents) || candidateEvents.length === 0) return null;
    return candidateEvents[candidateEvents.length - 1];
  }

  _buildAuthorGuidanceOpeningContext(
    mode,
    worldCardId,
    currentTurn,
    message,
    selectedTime = null,
    selectedTimeText = ''
  ) {
    return {
      cacheKey: `${worldCardId || 'world'}:${currentTurn}:${mode}:author_guidance`,
      mode,
      worldCardId,
      currentTurn,
      blocked: true,
      source: 'author_guidance',
      message,
      selectedEvent: null,
      selectedTime,
      selectedTimeText,
      selectedLocation: null,
    };
  }

  _buildSynthSnapshotForOpening() {
    const snap = {};
    if (window.npcStore?.getCharacterDatabase) {
      snap.character_database = window.npcStore.getCharacterDatabase() || {};
    }
    if (window.timelineStore?.getEvents) {
      snap.timeline = { events: window.timelineStore.getEvents() };
    }
    if (window.worldMeta) {
      const timeTerms = window.worldMeta.getActiveTimeTerms?.();
      snap.step3_fields = window.worldMeta.getStep3Fields?.();
      snap.prompt_modules = window.worldMeta.getPromptConfig?.() || {};
      if (timeTerms) snap._timeTerms = timeTerms;
    }
    return Object.keys(snap).length > 0 ? snap : null;
  }

  _getSelectedOpeningTimeContext(lastUserMessage = '', lastGameState = null, currentTurn = 0) {
    const mode = this._getOpeningRequestMode(lastUserMessage, lastGameState);
    if (!mode) {
      this._activeOpeningTimeContext = null;
      return null;
    }

    const runtime = this._getTimelineRuntime();
    const worldCardId =
      typeof window !== 'undefined' ? window.worldCardManager?.getActiveCardId?.() || null : null;
    const snapshot = this._buildSynthSnapshotForOpening();
    if (!snapshot || !runtime) {
      this._activeOpeningTimeContext = this._buildAuthorGuidanceOpeningContext(
        mode,
        worldCardId,
        currentTurn,
        '当前世界无法解析可直接开场的 timeline 事件。本轮不要伪造时间或地点，也不要继续追问时间；直接按 init 模块中的推荐剧情或随机开场规则进入叙事。'
      );
      return this._activeOpeningTimeContext;
    }

    const candidateEvents = this._getOpeningEventCandidates(snapshot);
    const initText = window.worldMeta?.getRuleModule?.('init') || '';
    const recommendedMatch = this._findRecommendedOpeningEvent(candidateEvents, initText);
    const latestCandidate = this._getLatestOpeningEventCandidate(candidateEvents);
    const fallbackTime = this._resolveAuthorGuidanceOpeningTime(snapshot, initText);
    const fallbackTimeText = fallbackTime
      ? this._formatGameTimeForPrompt(fallbackTime) || JSON.stringify(fallbackTime)
      : '';

    let selectedEvent = null;
    let source = 'none';
    if (mode === 'random') {
      if (candidateEvents.length > 0) {
        selectedEvent = candidateEvents[Math.floor(Math.random() * candidateEvents.length)];
        source = 'timeline_random';
      }
    } else if (recommendedMatch?.candidate) {
      selectedEvent = recommendedMatch.candidate;
      source = 'timeline_recommended';
    } else if (latestCandidate) {
      selectedEvent = latestCandidate;
      source = 'timeline_latest_fallback';
    }

    if (!selectedEvent) {
      this._activeOpeningTimeContext = this._buildAuthorGuidanceOpeningContext(
        mode,
        worldCardId,
        currentTurn,
        '当前世界没有可直接开场的 timeline 事件，或推荐剧情没有命中唯一事件。本轮不要伪造地点或随机结果说明；直接按 init 模块中的推荐剧情或随机开场规则进入叙事。',
        fallbackTime,
        fallbackTimeText
      );
      return this._activeOpeningTimeContext;
    }

    const selectedTime = selectedEvent.eventDate || null;
    if (!selectedTime) {
      this._activeOpeningTimeContext = this._buildAuthorGuidanceOpeningContext(
        mode,
        worldCardId,
        currentTurn,
        '当前世界选中的开场事件缺少合法时间。本轮不要伪造时间；直接按 init 模块中的推荐剧情或随机开场规则进入叙事。'
      );
      return this._activeOpeningTimeContext;
    }

    const cacheKey = `${worldCardId || 'world'}:${currentTurn}:${mode}:${selectedEvent.eventId || selectedEvent.eventIndex}:${source}`;
    if (this._activeOpeningTimeContext?.cacheKey === cacheKey) {
      return this._activeOpeningTimeContext;
    }

    const selectedTimeText =
      this._formatGameTimeForPrompt(selectedTime) || JSON.stringify(selectedTime);
    this._activeOpeningTimeContext = {
      cacheKey,
      mode,
      worldCardId,
      currentTurn,
      precision: this._getActiveTimeTerms()?.precision || 'time',
      timeSegments: this._getActiveTimeTerms()?.timeSegments || [],
      range: null,
      selectedTime,
      selectedTimeText,
      source,
      recommendationText:
        recommendedMatch?.recommendationText || this._extractRecommendedOpeningText(initText),
      selectedEvent,
      selectedLocation: selectedEvent.location || null,
      blocked: false,
      message: '',
    };
    return this._activeOpeningTimeContext;
  }

  _buildOpeningTimePromptText() {
    const context = this._activeOpeningTimeContext;
    const isEnglish = this._getGamePromptLanguage() === 'en';
    if (!context) return '';
    if (context.blocked) {
      const timeHint = context.selectedTimeText
        ? isEnglish
          ? `\nThe opening time is fixed to: ${context.selectedTimeText}.\nThe first paragraph of Step 2 must land on this exact time naturally.\nRuntime datetime will be backfilled by code from this opening time.`
          : `\n首轮时间固定为：${context.selectedTimeText}。\nStep 2 正文第一段必须自然落地这个具体时间。\n运行时 datetime 会由代码按这个开场时间回填。`
        : '';
      return isEnglish
        ? `## Opening Event Anchor Unavailable\n\n${context.message}${timeHint}\nIf the init module contains a standard \`Recommended Opening: ...\` line, prefer that line as the anchor, but do not copy it out as a system statement.`
        : `## 开场事件锚点不可用\n\n${context.message}${timeHint}\n如果 init 模块中存在 \`推荐剧情：...\` 标准行，请优先参考这句文案；但不要把它当成系统声明直接抄出来。`;
    }
    if (!context.selectedTimeText) return '';
    const modeLabel =
      context.mode === 'recommended'
        ? isEnglish
          ? 'recommended opening'
          : '推荐开局'
        : isEnglish
          ? 'random opening'
          : '随机开局';
    const locationText = context.selectedLocation
      ? isEnglish
        ? `\nThe opening location is fixed to: ${this._formatOpeningLocationText(context.selectedLocation)}.\nBoth the Step 2 narrative and panel_status.location must use this location exactly.`
        : `\n本轮开场地点固定为：${this._formatOpeningLocationText(context.selectedLocation)}。\nStep 2 正文和 panel_status.location 都必须使用这个地点，不要改写成近义地点名。`
      : '';
    const event = context.selectedEvent?.event || {};
    const eventHint = [
      typeof event.location === 'string' && event.location.trim()
        ? `${isEnglish ? 'Event Location' : '事件地点'}：${event.location.trim()}`
        : '',
      typeof event.characters === 'string' && event.characters.trim()
        ? `${isEnglish ? 'Characters' : '涉及角色'}：${event.characters.trim()}`
        : '',
      typeof event.content === 'string' && event.content.trim()
        ? `${isEnglish ? 'Event Anchor' : '事件锚点'}：${event.content.trim()}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    return isEnglish
      ? `## Opening Event Selected\n\nThis ${modeLabel} has locked one timeline event as the opening anchor.\nOpening time: ${context.selectedTimeText}.${locationText}\n${eventHint}\nAll first-turn reasoning must use this event's time and location.\nThe first paragraph of Step 2 must land on this exact time and place naturally.\nRuntime datetime will be backfilled by code and must not drift away from this opening time.`
      : `## 本局已选定的开场事件\n\n本轮${modeLabel}已锁定一条 timeline 事件作为开场锚点。\n开场时间：${context.selectedTimeText}。${locationText}\n${eventHint}\n后续所有首轮判断都必须以这个事件对应的时间和地点为准。\nStep 2 正文第一段必须自然落地这个具体时间与地点。\n运行时 datetime 会由代码回填，不得偏离这个开场时间。`;
  }

  _getEffectiveCoreWorldMechanics() {
    return window.worldMeta?.getRuleModule?.('core_world_mechanics') || '';
  }

  _getEffectiveNarrativeBase() {
    return window.worldMeta?.getRuleModule?.('narrative_base') || '';
  }

  _cloneFunctionDeclaration(declaration) {
    const cloned = {
      name: declaration.name,
      description: declaration.description || '',
      parameters: declaration.parameters
        ? JSON.parse(JSON.stringify(declaration.parameters))
        : { type: 'object', properties: {} },
    };
    if (declaration.data_source) cloned.data_source = declaration.data_source;
    return cloned;
  }


  _buildResidentDeclarations() {
    // 刷新动态工具（archiveService 的世界卡工具）
    if (typeof refreshArchiveTools === 'function') {
      refreshArchiveTools();
    }
    // 刷新 NPC 工具（panel_npc 字段定义）
    if (typeof refreshNpcTools === 'function') {
      refreshNpcTools();
    }
    // 所有声明统一从 toolRegistry 读取
    return window.toolRegistry ? window.toolRegistry.getDeclarations() : [];
  }

  _getBuiltInDeclarations() {
    return this._buildResidentDeclarations();
  }

  _applyBuiltInFunctionEditsAndSwitches(declarations) {
    const configSource = this._getConfigSource(AI_REQUEST_SCOPED);
    let result = declarations.map(decl => this._cloneFunctionDeclaration(decl));

    if (configSource.disableResidentFunctions === true) {
      const residentNames = new Set(this._buildResidentDeclarations().map(d => d.name));
      result = result.filter(decl => !residentNames.has(decl.name));
    }

    const deleted = configSource.deletedFunctions;
    if (deleted && Array.isArray(deleted) && deleted.length > 0) {
      const deletedSet = new Set(deleted);
      result = result.filter(decl => !deletedSet.has(decl.name));
    }

    const paramOverrides = configSource.customParameterOverrides;
    if (paramOverrides && typeof paramOverrides === 'object') {
      result.forEach(decl => {
        const overrideParams = paramOverrides[decl.name];
        if (overrideParams && typeof overrideParams === 'object') {
          decl.parameters = overrideParams;
        }
      });
    }

    const overrides = configSource.customFunctionOverrides;
    if (overrides && typeof overrides === 'object') {
      result.forEach(decl => {
        const ov = overrides[decl.name];
        if (!ov) return;
        if (ov.name) decl.name = ov.name;
        if (ov.description) decl.description = ov.description;
      });
    }

    return result;
  }

  _appendCustomFunctions(declarations) {
    const configSource = this._getConfigSource(AI_REQUEST_SCOPED);
    const result = [...declarations];
    const customs = configSource.customFunctions;
    if (customs && Array.isArray(customs)) {
      customs.forEach(cf => {
        if (!cf.name || !cf.name.trim()) return;
        let params = { type: 'object', properties: {} };
        if (cf.parameters && typeof cf.parameters === 'object') {
          params = cf.parameters;
        }
        result.push({
          name: cf.name.trim(),
          description: cf.description || '',
          parameters: params,
        });
      });
    }
    return result;
  }

  // 辅助: 获取工具定义（完整列表，供 adapter/设置面板等使用）
  _getFunctionDeclarations() {
    const builtInDeclarations = this._getBuiltInDeclarations();
    const builtInAfterEdits = this._applyBuiltInFunctionEditsAndSwitches(builtInDeclarations);
    return this._appendCustomFunctions(builtInAfterEdits);
  }

  // 辅助: 获取主 ReAct 循环可见的工具定义（排除 dispatcherManaged 工具）
  _getReactLoopFunctionDeclarations() {
    const registry = window.toolRegistry;
    if (!registry) return [];
    // 刷新动态工具（与 _buildResidentDeclarations 对齐）
    if (typeof refreshArchiveTools === 'function') refreshArchiveTools();
    if (typeof refreshNpcTools === 'function') refreshNpcTools();
    // 使用过滤后的声明，排除 dispatcherManaged 工具
    const reactDeclarations = registry.getReactLoopDeclarations();
    const afterEdits = this._applyBuiltInFunctionEditsAndSwitches(reactDeclarations);
    return this._appendCustomFunctions(afterEdits);
  }

  /**
   * 获取默认 Function 分组（未覆写），供设置 UI 使用
   * @returns {{resident: Array}}
   */
  getDefaultFunctionDeclarationGroups() {
    const resident = this._buildResidentDeclarations().map(decl =>
      this._cloneFunctionDeclaration(decl)
    );
    return {
      [REACT_FUNCTION_GROUP.RESIDENT]: resident,
    };
  }

  /**
   * 获取默认（未覆写）的 Function 列表，供设置 UI 兼容使用
   * @returns {Array<{name: string, description: string, parameters: object}>}
   */
  getDefaultFunctionDeclarations() {
    return this._getBuiltInDeclarations().map(decl => this._cloneFunctionDeclaration(decl));
  }

}

_applyAIServiceMixin(_AIServiceNpcOocMixin);

// promptRegistry 注册已抽出到 js/services/ai/npcOocPromptBootstrap.js
