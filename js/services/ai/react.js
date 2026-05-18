/**
 * ai/react.js
 * 统一工作流 Runner — ReAct 主循环
 *
 * 通过 mixin 模式扩展 AIService.prototype。所有方法实现与原 class
 * AIService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyAIServiceMixin 合并到 AIService 上。
 *
 * 内容：核心 Agent 工作流（策略模式）、ReAct Loop → Step 3 流程、
 * narrative/settlement/closing 三阶段编排、function calling、streaming、
 * segment tracking。
 *
 * 加载顺序：必须在 aiService.js 之后加载。
 */

// 把 upstream step 的失败分类成可读的"错误种类"，让错误对话框可以给精准建议而不是
// 通用"重试"。优先读结构化字段 (errorInfo.httpStatus/providerErrorCode)，字符串路径
// (e.g. iter 9 catch 块拼的字符串) 时退到 message 关键词识别。无论 kind 命中哪种，
// 原始 msg 永远显示给用户——kind 只用来加一行精准建议。
// 完整错误码参考见 docs/API_ERROR_CODES.md（OpenAI/Anthropic/DeepSeek/Gemini 四家差异 + 中转站 quirk）
function classifyUpstreamErrorStep(step) {
  const ei = step?.errorInfo;
  const isObj = ei && typeof ei === 'object';
  const msg = isObj ? (ei.message || '') : (typeof ei === 'string' ? ei : (step?.error || ''));
  const status = isObj ? ei.httpStatus : null;
  const code = isObj ? ei.providerErrorCode : null;
  const errorType = isObj ? ei.errorType : null;
  const safetyReason = isObj ? ei.safetyReason : null;
  const safetyStage = isObj ? ei.safetyStage : null;

  // 0. Gemini 安全过滤：errorType 是 GeminiAdapter 在 200+blockReason/finishReason 时设的——直接走 safety_filtered
  if (errorType === 'safety_filtered') return { kind: 'safety_filtered', msg, status, safetyReason, safetyStage };

  // 1. 强 status 信号（标准且不会被中转站误用）
  if (status === 402) return { kind: 'balance', msg, status };               // Anthropic billing_error / DeepSeek 余额不足
  if (status === 413) return { kind: 'payload_too_large', msg, status };     // Anthropic >32MB body
  if (typeof status === 'number' && status >= 500 && status < 600) return { kind: 'provider_5xx', msg, status }; // 含 Anthropic 529 overloaded

  // 2. message 强信号（中转站常用 401/403 包装"余额不足/限流"——message 关键词比 status 准；
  //    relay 之类把"用户额度不足"用 403 返回的 case 必须靠这里救回，不然会被下面 401/403→auth 误判）
  //    OpenAI billing_hard_limit_reached 走 code 检测（5 区段命中 insufficient_quota 同理）
  if (/insufficient[\s_]?balance|余额不足|额度不足|out of credit|余额.*不足|额度.*不足|billing[\s_]?hard[\s_]?limit/i.test(msg)) return { kind: 'balance', msg, status };
  if (code === 'billing_hard_limit_reached') return { kind: 'balance', msg, status };
  if (/rate[\s_]?limit|too many requests|超出.*限制|已达到.*请求.*限制|请求数限制/i.test(msg)) return { kind: 'rate_or_quota', msg, status };

  // 3. Gemini key 错的特殊形式：HTTP 400 + message/details 含 API_KEY_INVALID/API_KEY_EXPIRED（不返 401）
  //    放在 401/403→auth 之前，让"格式错"和"key 错"的 400 分流
  if (status === 400 && /API[_\s]?KEY[_\s]?(INVALID|EXPIRED)|api.{0,5}key.{0,5}(invalid|expired|not[_\s]?valid)/i.test(msg)) {
    return { kind: 'auth', msg, status };
  }

  // 3a. 推理模式 + 强制工具调用不兼容（DeepSeek-reasoner / Kimi-2.5 / 部分推理后端）
  //    我们的 buildPayload 已对 deepseek 自动降级 thinking，但 'custom' provider 走第三方代理时
  //    后端默认开 thinking 我们这边无法预判 → 上游回 400 后给用户明确"关 thinking 或换模型"引导
  if (/incompatible with thinking|does not support this tool_choice/i.test(msg)) {
    return { kind: 'forced_tool_thinking_incompat', msg, status };
  }

  // 3b. Gemini billing 没开 / 区域不支持：HTTP 400 + FAILED_PRECONDITION（语义上是"账户没开通付费"，不是"余额耗尽"）
  //     典型 message: "User location is not supported for the API use without a billing account configured"
  if (status === 400 && /FAILED_PRECONDITION|billing[\s_]?account|billing.{0,10}(not[\s_]?(enabled|configured)|required|disabled)/i.test(msg)) {
    return { kind: 'billing_disabled', msg, status };
  }

  // 4. errorType（fetch 抛 TypeError 已经在 _buildApiErrorInfo 里分到 'network'，直接采信）
  if (errorType === 'network' || errorType === 'timeout') return { kind: 'network', msg, status };

  // 5. status 401/403/429 — message 没明说余额/限流时才认为是真鉴权/真限流
  if (status === 401 || status === 403) return { kind: 'auth', msg, status };
  if (status === 429 || code === 'insufficient_quota') {
    // OpenAI 把"账户余额耗尽"用 429 + insufficient_quota 返回，独立于真限流——按 balance 处理而不是限流
    if (code === 'insufficient_quota') return { kind: 'balance', msg, status };
    return { kind: 'rate_or_quota', msg, status };
  }

  // 6. message 兜底网络关键词（errorInfo 是字符串 / 没 errorType 的路径）
  if (/timeout|timed out|超时|ETIMEDOUT|ECONNRESET|Load failed|Failed to fetch|NetworkError/i.test(msg)) return { kind: 'network', msg, status };

  return { kind: 'unknown', msg, status };
}

class _AIServiceReactMixin {
  // ========================================
  // 统一工作流 Runner
  // ========================================

  /**
   * 核心 Agent 工作流(策略模式)
   * 统一处理 ReAct Loop -> Step 3 流程
   * 各模块可使用不同模型(通过 react/step3 等模块配置)
   * Step 完成通知通过 EventBus 广播，不再使用回调
   * @param {Array} messages - 通用格式消息
   * @param {Function|null} onChunk - 流式输出回调（高频，保留）
   * @param {string} systemContext - 系统上下文(包含角色档案等)
   * @returns {Promise<string>} 最终输出
   */
  async _runAgentWorkflow(messages, onChunk, systemContext, actionClassificationOptions = null, oocOptions = null, abortSignal = null) {
    // ━━━ ReAct Workflow: Entry & Setup ━━━
    // 中止信号、telemetry 追踪、turn 级初始化
    // 存储当前中止信号，供所有子方法访问
    this._currentAbortSignal = abortSignal || null;

    const _analyticsReqId = (() => {
      try { return crypto.randomUUID(); } catch (_) { return 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
    })();
    const _analyticsT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      // Telemetry 用 iter1（叙事 spine）作为代表性 model/provider；推荐模式下其他 iter
      // 各自不同（参见 RECOMMENDED_PHASE_MAP），完整 per-iter 数据在 stepMetrics 里。
      const reactModelForTelemetry = this.getModelForModule('iter1_narrative', AI_REQUEST_SCOPED);
      const reactProviderForTelemetry = this.getProviderForModule('iter1_narrative', AI_REQUEST_SCOPED);

      // Capability pre-flight: 之前已确认不支持 function calling 的模型, 直接早抛同款错误,
      // 避免用户在不知情下浪费几十秒等 ReAct 跑完一整轮才看到错误对话框。memo 在
      // 错误抛出处累积 (见函数末尾 _rememberModelNoFunctionCalling 调用)。
      // 用户切到支持的模型自然就过了。memo entry 格式: "provider::model"。
      if (this._isModelKnownNoFunctionCalling(reactProviderForTelemetry, reactModelForTelemetry)) {
        const lang = this._getGamePromptLanguage?.() || 'zh';
        const earlyMsg = lang === 'en'
          ? `Agent ReAct Error: Model "${reactModelForTelemetry}" was previously confirmed not to support function calling. Please switch to a model that supports tool calls, or enable "Recommended Settings" in API settings.`
          : `Agent ReAct Error: 模型 "${reactModelForTelemetry}" 此前已确认不支持工具调用（function calling）。请切换到支持工具调用的模型，或在 API 设置里启用「推荐设置」。`;
        const earlyErr = new Error(earlyMsg);
        // chatCore _extractAIFailureMeta 只读 errorInfo / unifiedErrorInfo / _aiErrorMeta.errorInfo,
        // 直接挂 earlyErr.errorType 会让对话框走"未知错误"分支，错过 no_function_calling 精准提示。
        earlyErr.errorInfo = {
          errorType: 'no_function_calling',
          provider: reactProviderForTelemetry,
          model: reactModelForTelemetry,
          phase: 'react',
          message: earlyMsg,
        };
        earlyErr.preflight = true;
        throw earlyErr;
      }
      const promptLenChars = Array.isArray(messages)
        ? messages.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0) : 0;
      // Lift the player's typed turn input out of the prompt envelope so the
      // admin event waterfall can render it inline. Multimodal content (array
      // of {type,text}) is collapsed to its text parts; non-text falls through
      // as null and the admin renders nothing for that row.
      let userMessageText = null;
      if (Array.isArray(messages)) {
        const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
        const c = lastUser?.content;
        if (typeof c === 'string') {
          userMessageText = c.slice(0, 32000);
        } else if (Array.isArray(c)) {
          const joined = c.map((p) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
          userMessageText = joined ? joined.slice(0, 32000) : null;
        }
      }
      window.analyticsService?.track?.('ai.request', {
        request_id: _analyticsReqId,
        model: reactModelForTelemetry,
        provider: reactProviderForTelemetry,
        phase: 'react',
        // 缺口补齐：think 档 / 温度 / 设置模式（ai.request 一直只带 model+provider）。
        // think 取 iter1_narrative（与 reactModelForTelemetry 同源 spine 代表），
        // 温度取回合级 'react'，模式走 effective（已处理"想推荐但无 key 降级"）。
        thinking: this.getModuleThinking('iter1_narrative', AI_REQUEST_SCOPED),
        temperature: this.getModuleTemperature('react', 1.0, AI_REQUEST_SCOPED),
        settings_mode: this.getEffectiveApiSettingsMode(AI_REQUEST_SCOPED),
        prompt_len_chars: promptLenChars,
        user_message: userMessageText,
      });
    } catch (_) { /* ignore */ }

    try {

    // 获取 adapter（iter1_narrative 作为 react 流的代表性 protocol adapter；
    // 推荐模式下 cleanHistoryForGeneration / convertMessages 等协议级方法所有 iter 共享，
    // 仅 buildPayload + callAPI 阶段每 iter 重新查 adapter 拿不同 model/thinking）
    const reactAdapter = this._getAdapter('iter1_narrative', AI_REQUEST_SCOPED);

    // 重置调试记录
    this.lastFunctionCalls = null;
    this.lastReasoningContents = [];
    this.lastGMPayload = null;
    this.lastNpcReactions = null;
    this._pendingEventToMark = null; // 防止上一次请求失败后的残留事件被错误播报

    this.lastPayload = {
      provider: 'multi-step-agent',
      traceId: this._generateTraceId(),
      failedPhase: null,
      errorInfo: null,
      models: {
        // 代表性 model（iter1 叙事 spine）；推荐模式下其他 iter 各自配置，
        // 完整数据在 stepMetrics.perIteration 里。
        react: this.getModelForModule('iter1_narrative', AI_REQUEST_SCOPED),
      },
      steps: [],
      settlementDispatch: null,
    };
    this.accumulatedStepCount = 0;

    // 重置模块追踪(避免跨调用模块重复加载)
    if (typeof archiveService !== 'undefined' && archiveService.resetLoadedModules) {
      archiveService.resetLoadedModules();
    }

    // 初始化时间指标记录
    const requestStartTime = performance.now();
    const stepMetrics = [];

    // 转换消息为厂商格式(使用 ReAct adapter)
    const currentMessages = reactAdapter.convertMessages(messages);
    const executedTools = new Set();

    // 本回合主循环成功执行过的工具调用次数（按工具名累计）
    // 用于让 settlement subagent 决策是否跳过自身（如 inventorySkill 仅在主循环 0 次 update_item 时兜底）
    const mainLoopToolCounts = Object.create(null);

    // ==========================================
    // 前置准备：消息转换 + 清理 + 提取状态
    // ==========================================
    // 周边 subagent 用各自专属 module key 拿 adapter（推荐模式下分别走 npc_reaction /
    // ooc_normalizer 配置；非推荐模式 aliasMap 兜底到用户 'react' 选择）。
    const npcReactionAdapter = this._getAdapter('npc_reaction', AI_REQUEST_SCOPED);
    const oocAdapter = this._getAdapter('ooc_normalizer', AI_REQUEST_SCOPED);
    // reactModel 用 iter1_narrative（叙事 spine）作代表性显示；UI 标签 + 旧 telemetry 用。
    const reactModel = this.getModelForModule('iter1_narrative', AI_REQUEST_SCOPED);
    const reactLabel = reactAdapter.getProviderLabel();

    const { cleanedMessages, lastGameState } =
      reactAdapter.cleanHistoryForGeneration(currentMessages);
    const { messages: sanitizedMessages, stats: messageSanitization } =
      this._sanitizeMessagesForDeepSeek(cleanedMessages, reactAdapter.provider);
    const lastUserMessage =
      messages
        .slice()
        .reverse()
        .find(m => m.role === 'user')?.content || '';
    const openingTurn =
      typeof chatHistory !== 'undefined' ? chatHistory.filter(m => m.sender === 'ai').length : 0;
    const openingTimeContext = this._getSelectedOpeningTimeContext(
      lastUserMessage,
      lastGameState,
      openingTurn
    );
    if (this.lastPayload) {
      this.lastPayload.openingTimeContext = openingTimeContext
        ? {
            mode: openingTimeContext.mode,
            currentTurn: openingTimeContext.currentTurn,
            blocked: openingTimeContext.blocked === true,
            message: openingTimeContext.message || '',
            selectedTime: openingTimeContext.selectedTime,
            precision: openingTimeContext.precision,
            source: openingTimeContext.source,
            selectedEventId: openingTimeContext.selectedEvent?.eventId || null,
            selectedLocation: openingTimeContext.selectedLocation || null,
          }
        : null;
    }

    // 开局 Turn 1：prime timelineService，避免 panelSkill / buildTurnResult 等下游
    // 在 update_panel 第一次调用前读到 currentDate=null 而自行编造时间（如 panelSkill
    // 缺时间上下文时编出 "2077-3-15"，与 gmDirective 的"新历 32 年"错位）。
    // 四重 guard：仅新游戏开局首回合 + selectedTime 存在 + timelineService 加载 + 未初始化时触发。
    if (
      openingTurn === 0 &&
      openingTimeContext?.selectedTime &&
      typeof timelineService !== 'undefined' &&
      !timelineService.getCurrentDate()
    ) {
      const t = openingTimeContext.selectedTime;
      timelineService.setCurrentDateManual(
        t.year, t.month, t.day,
        t.time_str || '00:00',
        null,   // minute 由 time_str 解析
        null,   // 无 previousTurnDate
        true,   // skipSideEffects=true（Turn 1 不触发事件 SMS 跳跃检查）
      );
      console.log('[Agent] Turn 1 prime timelineService:', t);
    }

    // ==========================================
    // Phase 1: OOC Subagent (在 ReAct 循环前完成)
    // ==========================================
    // NPC Reaction 和 Action Classification 已挪入下方大 Promise.all，
    // 与 Branch A iter 1 / Branch B iter 2-4 并行，iter 5+ rebuild 时统一拿到。
    // 本轮开始先清掉上一轮遗留的 OOC 准则，避免空触发时残留。
    this.clearPendingOoc();

    await (async () => {
      // 优先级：forced directive（regenerate 复用上一轮 OOC）> candidates（首次输入提取）。
      // forced 路径不走 subagent，不打 stepLog，不会触发反问。
      if (typeof oocOptions?.forcedNormalized === 'string' && oocOptions.forcedNormalized.trim()) {
        this.setPendingOoc({
          raw: Array.isArray(oocOptions.forcedRaw) ? oocOptions.forcedRaw.slice() : [],
          normalized: oocOptions.forcedNormalized,
        });
        return;
      }
      const cands = Array.isArray(oocOptions?.candidates)
        ? oocOptions.candidates
        : [];
      if (!cands.length) return;
      // _runOocWorkflow 内部已吞掉所有异常，不抛出
      await this._runOocWorkflow(oocAdapter, cands);
    })();

    // ==========================================
    // GM 决策层（OOC 完成后、ReAct 循环前，纯代码瞬时完成）
    // ==========================================
    let gmDirective = null;
    const hasEnoughHistory =
      typeof chatHistory !== 'undefined' && chatHistory.filter(m => m.sender === 'ai').length > 0;
    const openingTimeBlocked = this._activeOpeningTimeContext?.blocked === true;

    if (hasEnoughHistory && !openingTimeBlocked) {
      const gmStepLog = {
        step: 'gm',
        phase: 'gm_decision',
        engine: 'GM Code Engine',
        request: null,
      };
      this.lastPayload.steps.push(gmStepLog);
      this._markStepStarted(gmStepLog);

      try {
        gmDirective = await this._callGM(messages);
        gmStepLog.request = this.lastGMPayload?.request || null;
        gmStepLog.response = {
          directive: gmDirective,
          result: this.lastGMPayload?.result || null,
        };
        if (this.lastGMPayload?.errorInfo) {
          gmStepLog.failed = true;
          gmStepLog.errorInfo = this.lastGMPayload.errorInfo;
          gmStepLog.error = this.lastGMPayload.errorInfo.message;
          gmStepLog.endedAt = new Date().toISOString();
        } else {
          this._markStepSucceeded(gmStepLog);
        }
        if (gmDirective) {
          console.log(`[GM] 写作指导: ${gmDirective.substring(0, 100)}...`);
        } else {
          console.log('[GM] 无指导');
        }
      } catch (e) {
        this._markStepFailure(
          gmStepLog,
          e,
          {
            phase: 'gm_decision',
            module: 'gm',
            engine: 'GM Code Engine',
            defaultErrorType: 'unknown',
          },
          {
            updatePayload: false,
          }
        );
        console.warn('[GM] 调用失败:', e);
      }
    } else if (openingTimeBlocked) {
      console.log('[GM] 首轮随机开局缺少合法时间范围，跳过 GM 引导');
    }

    // ==========================================
    // Pure ReAct Loop
    // ==========================================

    // 保存当前状态快照（工具会在循环中直接修改状态，需在修改前记录）
    if (typeof playerStateService !== 'undefined') {
      const prevDate = typeof timelineService !== 'undefined' ? timelineService.getCurrentDate() : null;
      const prevLocation = typeof locationTracker !== 'undefined' ? locationTracker.getLocation() : null;
      playerStateService.setPreviousTurnState(prevDate, prevLocation);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Parallel ReAct Pipeline (v0)
    // Branch A (iter 1, narrative-only) ‖ Branch B (iter 2-4 read-only chain)
    //                            ↓ Promise.all merge ↓
    //                  iter 5 (read 补查 + mutations，执行 iter1 next_tool)
    //                  iter 6 (segment 2 narrative + 可选 update_item，checkpoint 三选一: none/item_check/hidden_state)
    //                  iter 7 (仅 iter6 type 非-none 时跑：执行 iter6 next_tool + segment 3 收尾)
    //                  → fall through to iter 8 (settlement) + iter 9 (choices)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    this.accumulatedStepCount++;
    console.log(`[${reactLabel} Agent] Parallel ReAct Pipeline (model: ${reactModel})`);

    reactAdapter.syncExecutedTools(currentMessages, executedTools);

    // 构建系统提示词（包含所有上下文：GM、游戏状态等）
    // 注：npcReactions 已挪入下方大 Promise.all（与 Branch A/B 并行），此处尚未解析；
    // iter 5+ 通过 _rebuildMergedSystemPartsForIteration 拿到完整 NPC reactions / action context。
    let mergedSystemParts;
    try {
      mergedSystemParts = this._buildMergedSystemParts(
        systemContext,
        lastGameState,
        lastUserMessage,
        messages,
        gmDirective,
        null
      );
    } catch (e) {
      e.failedPhase = 'react';
      throw e;
    }
    // 注：mergedSystemParts 的 manifest（this._lastPromptManifest）会被下一步
    // _buildSystemPartsForIter1 的写入覆盖。Branch B / iter 5+ 都不消费此处
    // 捕获的 manifest（它们自己在调度前重新 build），故无需保留。

    // iter1（Branch A）专用 system parts —— 与 mergedSystemParts 不共用。
    // 用 stage-specific prompt 消除"🎒新游戏开局必须 update_item"等 system 层强指令
    // 与 iter1 工具限制（仅 update_narrative）的冲突，并去掉 choices / NPC 工具 /
    // 世界扩展 / type=none 等无关章节，对小模型（v4-flash）显著提升工具调用准确度。
    // Branch B（iter 2-4）与 iter 5+ 继续复用 mergedSystemParts，本次重构只动 iter 1。
    // 详见 prompt-gm.js: _buildSystemPartsForIter1 的 doc。
    let iter1SystemParts;
    try {
      iter1SystemParts = this._buildSystemPartsForIter1(
        systemContext,
        lastGameState,
        lastUserMessage,
        messages,
        gmDirective
      );
    } catch (e) {
      e.failedPhase = 'react';
      throw e;
    }
    const iter1PromptManifest = this._lastPromptManifest;

    // DeepSeek 预检：确保消息中有 user 消息
    if (reactAdapter.provider === 'deepseek' && !messageSanitization.hasUser) {
      throw new Error('ReAct 请求前检查失败：未找到玩家输入');
    }

    // 温度（所有 iter 共享，由用户 modules.react.temperature 决定）
    // thinking 改为 per-iter：iter1_narrative 作 default（用于 iter 1/6/7 叙事路径），
    // iter 2-4/5/9 在各自 buildPayload 前再单独查。
    const defaultTemperature = 1.0;
    const temperature = this.getModuleTemperature('react', defaultTemperature, AI_REQUEST_SCOPED);
    const thinking = this.getModuleThinking('iter1_narrative', AI_REQUEST_SCOPED);

    // ━━━ 累积器 ━━━
    const iterationMetrics = [];
    const reactIterationSegments = [];
    const narrativeAccRef = { value: '' };       // wrapper：让 _runReactIteration mutate 字符串
    // 回合级"已 emit 的归一化叙事全文"指纹 Set —— L1 治本：同一段第二次走到任一
    // emit 点直接拦掉（rescue/iter9 L3 重复转发）。与 narrativeAccRef 同生命周期、
    // 同样经各 _runReactIteration 调用并列穿透到 prompt-gm。镜像 executedTools 范式。
    const narrativeEmitGuard = { keys: new Set() };
    let narrativeAccumulator = '';                // iter 8/9 + 函数 epilogue 用 plain string
    let choicesData = [];
    // mainLoopToolCounts 已在函数顶部声明（line ~95），跨 stage 复用。
    let messagesRef;                              // 每个 stage 后刷新指向最新 stage 的 messagesRef

    const isEn = this._getGamePromptLanguage?.() === 'en';

    // ━━━ Branch A 准备：iter 1 (narrative-only) ━━━
    // 关键：每个 branch 必须 deep-clone sanitizedMessages 再传给 buildPayload。
    // 原因：Gemini 的 buildPayload 直接 alias 输入数组（payload.contents = messages），
    // 不复制。两支并发跑时若共用同一个数组，appendUserMessage / appendToolResults
    // 会互相污染（指令交叉、tool result 串入对方分支），merge 时 slice(baseLen) 也会
    // 拿到重复内容。OpenAI / Anthropic 的 buildPayload 内部 .map 已新建数组，本身无碍，
    // 但为统一代码路径都加 clone。
    const { tools: branchATools, allowedToolNames: branchAAllowed, toolChoice: branchAToolChoice } = this._buildToolsForStage('narrative_only', reactAdapter);
    const branchABaseMessages = JSON.parse(JSON.stringify(sanitizedMessages));
    const branchAWebSearch = this._shouldEnableWebSearchForStage('narrative_only', reactAdapter);
    const { payload: branchAPayloadObj, url: branchAUrl, streamUrl: branchAStreamUrl } =
      reactAdapter.buildPayload(branchABaseMessages, iter1SystemParts, branchATools, { temperature, thinking, toolChoice: branchAToolChoice, webSearch: branchAWebSearch });
    const branchAMessagesRef = reactAdapter.getPayloadMessagesRef(branchAPayloadObj);
    // ⚠️ 关键：baseLen 必须在 buildPayload 之后捕获。
    // 不同 adapter 的 messagesRef 起始长度不同：
    //   Gemini: payload.contents = messages（无 system 前缀）→ length = sanitized.length
    //   OpenAI/DeepSeek: payload.messages = [system, ...converted]（多 1 项 system 前缀）→ length = sanitized.length + 1
    //   Anthropic: payload.messages = converted（system 走 system 字段）→ length = sanitized.length
    // 用 sanitizedMessages.length 当 baseLen 在 OpenAI/DeepSeek 上 off-by-one，会让 branchADelta
    // 把原始 user 消息也拽进 delta，merge 后产生重复用户消息。改用 messagesRef.length 自适应所有 adapter。
    //
    // Stage 1 directive 已融入 iter1SystemParts（system 层），不再用 user-role directive
    // 重复——避免对小模型造成"system 强令 vs user 禁令"的权威感冲突。
    // Branch B 同样融入 iter2_4SystemParts（system 层）+ 每轮一段轮次 coda（user-role 信息
    // 块，由 react.directive.iter2_4Round{N} 注入；告诉模型当前是第几轮 / 还剩几轮 / 本轮焦点）。
    const baseLen = branchAMessagesRef.length;

    // ━━━ Branch B 准备：iter 2-4 chain (reads-only) ━━━
    // per-iter 路由：iter 2-4 用 iter2_4_reads（推荐模式：v4-flash + thinking=off）。
    // tool_choice='auto'，即便后续把 thinking 调高也不会被 forced-tool gate 吞。
    //
    // iter2-4 专用 system parts —— 与 mergedSystemParts 不共用。理由同 iter1：
    // 老 prompt 把 CORE_PROMPT_MERGED 的 NPC 工具/世界扩展/choices/checkpoint 等
    // iter2-4 用不到的内容暴露出来，加上 playerInventory 的"🎒强制 update_item"，
    // 直接造成 iter4 越权调 load_predefined_npc 的工具幻觉（已实测）。
    // 详见 prompt-gm.js: _buildSystemPartsForIter2_4 的 doc。
    let iter2_4SystemParts;
    try {
      iter2_4SystemParts = this._buildSystemPartsForIter2_4(
        systemContext,
        lastGameState,
        lastUserMessage,
        messages,
        gmDirective
      );
    } catch (e) {
      e.failedPhase = 'react';
      throw e;
    }
    const branchBAdapter = this._getAdapter('iter2_4_reads', AI_REQUEST_SCOPED);
    const branchBModel = this.getModelForModule('iter2_4_reads', AI_REQUEST_SCOPED);
    const branchBThinking = this.getModuleThinking('iter2_4_reads', AI_REQUEST_SCOPED);
    const { tools: branchBTools, allowedToolNames: branchBAllowed, toolChoice: branchBToolChoice } = this._buildToolsForStage('reads_only', branchBAdapter);
    const branchBBaseMessages = JSON.parse(JSON.stringify(sanitizedMessages));
    const { payload: branchBPayloadObj, url: branchBUrl, streamUrl: branchBStreamUrl } =
      branchBAdapter.buildPayload(branchBBaseMessages, iter2_4SystemParts, branchBTools, { temperature, thinking: branchBThinking, toolChoice: branchBToolChoice });
    const branchBMessagesRef = branchBAdapter.getPayloadMessagesRef(branchBPayloadObj);
    // Stage 2 directive 已融入 iter2_4SystemParts（system 层），不再用 user-role
    // directive 重复——避免对小模型造成"system 强令 vs user 禁令"的权威感冲突。

    // ━━━ Promise.all 跑四支：Branch A ‖ Branch B ‖ NPC Reaction ‖ Action Classification ━━━
    const [iter1Result, , npcReactions] = await Promise.all([
      // Branch A: 单轮 iter 1（attach promptManifest 到首个 stepLog 供 debug UI）
      this._runReactIteration({
        reactAdapter, reactLabel, reactModel,
        payload: branchAPayloadObj, messagesRef: branchAMessagesRef,
        url: branchAUrl, streamUrl: branchAStreamUrl,
        executedTools,
        narrativeAccumulator: narrativeAccRef,
        narrativeEmitGuard,
        reactIterationSegments, iterationMetrics, mainLoopToolCounts,
        iteration: 1, iterationLabel: 'iter1.A', branchLabel: 'A',
        onChunk,
        skipNarrativeRescue: false,
        promptManifest: iter1PromptManifest,
        allowedToolNames: branchAAllowed,
      }).catch(e => {
        console.error('[Agent] Branch A (iter 1) 异常:', e?.message || e);
        return { hadError: true, hadToolCalls: false, narrativeCheckpoint: null };
      }),
      // Branch B: 最多 3 iter 链（用 iter2_4_reads 配置）
      (async () => {
        let last = null;
        for (let i = 0; i < 3; i++) {
          const branchBLabel = `iter${i + 2}.B`;
          // 注入本轮轮次 coda（user-role 信息块：告诉模型"这是第 N/3 轮"+ 本轮焦点）。
          // 与 system 层 CORE_PROMPT_ITER2 互补：system 给角色 + 工具 + 策略，
          // coda 给本轮焦点（规划 / 深入 / 终止）。最后一轮的 coda 明确"默认返回零
          // tool call 终止"，给小模型最强的"该停了"信号。
          const roundDirective = window.promptRegistry
            .get(`react.directive.iter2_4Round${i + 1}`)
            .builder({ isEn });
          this.reactLoop.appendUserMessage(branchBMessagesRef, roundDirective, branchBAdapter);

          try {
            last = await this._runReactIteration({
              reactAdapter: branchBAdapter, reactLabel, reactModel: branchBModel,
              payload: branchBPayloadObj, messagesRef: branchBMessagesRef,
              url: branchBUrl, streamUrl: branchBStreamUrl,
              executedTools,
              narrativeAccumulator: narrativeAccRef,
          narrativeEmitGuard,
              reactIterationSegments, iterationMetrics, mainLoopToolCounts,
              iteration: i + 2, iterationLabel: branchBLabel, branchLabel: 'B',
              onChunk: null,
              skipNarrativeRescue: true,  // 后台 read 阶段不抢救纯文本为叙事
              allowedToolNames: branchBAllowed,
            });
          } catch (e) {
            console.warn(`[Agent] Branch B ${branchBLabel} 异常，终止 chain:`, e?.message || e);
            break;
          }
          if (!last.hadToolCalls) {
            console.log(`[Agent] Branch B ${branchBLabel} 无工具调用，提前终止 chain`);
            break;
          }
        }
        return last;
      })(),
      // NPC Reaction（原 Phase 1 内容，挪到此处与 Branch A/B 并行）
      this._runNpcReactionCalls(npcReactionAdapter, messages, systemContext).catch(e => {
        console.warn('[NPC Reaction] 整体失败，不阻塞主流程:', e?.message || e);
        return [];
      }),
      // Action Classification（原 Phase 1 内容，挪到此处与 Branch A/B 并行）
      (async () => {
        if (!actionClassificationOptions?.actionInputText) return;
        try {
          await this.preparePendingPlayerActionContext(
            actionClassificationOptions.actionInputText,
            {
              selectedChoicePayload: actionClassificationOptions.selectedChoicePayload || '',
              selectedChoiceText: actionClassificationOptions.selectedChoiceText || '',
            }
          );
        } catch (error) {
          this.clearPendingPlayerActionContext();
          console.warn('[ActionContext] 并行动作分类失败:', error?.message || error);
        }
      })(),
    ]);

    // NPC Reaction 完成通知（移到此处，原 Phase 1 emit 已删除）
    if (npcReactions && npcReactions.length > 0 && window.eventBus && window.GameEvents) {
      window.eventBus.emit(window.GameEvents.AI_NPC_REACTIONS_COMPLETE, {
        reactions: npcReactions,
      });
    }

    // ━━━ Merge: 拼出统一 messagesArr ━━━
    const branchADelta = branchAMessagesRef.slice(baseLen);
    const branchBDelta = branchBMessagesRef.slice(baseLen);
    let unifiedMessages = [...sanitizedMessages, ...branchADelta, ...branchBDelta];
    console.log(`[Agent] Parallel merge: A=+${branchADelta.length} entries, B=+${branchBDelta.length} entries`);

    const iter1Checkpoint = iter1Result?.narrativeCheckpoint || null;
    const iter1NextToolRaw = (iter1Checkpoint && iter1Checkpoint.type !== 'none' && typeof iter1Checkpoint.next_tool === 'string')
      ? iter1Checkpoint.next_tool.trim()
      : '';
    // 'none' 是 schema enum 的哨兵值（取代旧的空字符串，因 Gemini 不允许 enum 含空字符串），
    // 与未声明等价：跳过 latch。
    const iter1NextTool = iter1NextToolRaw === 'none' ? '' : iter1NextToolRaw;

    if (!iter1NextTool) {
      console.warn('[Agent] iter 1 未声明有效 checkpoint（type=none 或 next_tool 缺失），跳过 iter 5/6/7，直接进 iter 8/9');
      // 用一个临时 payload 把 unifiedMessages 转成可被 iter 8/9 后续 mutate 的 messagesRef
      const tailPayload = reactAdapter.buildPayload(unifiedMessages, mergedSystemParts, branchATools, { temperature, thinking, toolChoice: branchAToolChoice });
      messagesRef = reactAdapter.getPayloadMessagesRef(tailPayload.payload);
    } else {
      // ━━━ iter 5: read 补查 + mutations ━━━
      // per-iter 路由：iter 5 是整个回合的逻辑决策核心（state mutations）。
      // 推荐模式 v4-flash + thinking=max；tool_choice='auto' → forced-tool gate 不触发。
      const iter5Adapter = this._getAdapter('iter5_mutations', AI_REQUEST_SCOPED);
      const iter5Model = this.getModelForModule('iter5_mutations', AI_REQUEST_SCOPED);
      const iter5Thinking = this.getModuleThinking('iter5_mutations', AI_REQUEST_SCOPED);
      // iter5 专用 system parts —— 与 mergedSystemParts 不共用。理由同 iter1/iter2-4：
      // 老 prompt 把 CORE_PROMPT_MERGED 的 narrative_base / NARRATIVE_LENGTH / choices 规范 /
      // type=none 双语义等与 mutation 无关的内容暴露给 iter5，浪费 token + 注入 narrative-style
      // 推理偏向。iter5 的核心责任（🎒新游戏开局必须 update_item / load_predefined_npc 工具连接）
      // 在新 builder 里集中说明，stage 3 directive 不再需要。
      // 详见 prompt-gm.js: _buildSystemPartsForIter5 的 doc。
      // 注：_rebuildMergedSystemPartsForIteration 内部会重新 formatMessages(chatHistory)
      // 拿最新 systemContext（NPC 档案 JSON 在 update_npc 后会变）。iter5 builder 也需要
      // 这份 fresh systemContext——直接复用此辅助函数的 fresh 数据。
      let iter5SystemParts;
      try {
        const history = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
        const { systemContext: freshSystemContext } = this.formatMessages(history);
        iter5SystemParts = this._buildSystemPartsForIter5(
          freshSystemContext,
          lastGameState,
          lastUserMessage,
          messages,
          gmDirective,
          npcReactions,
          iter1NextTool
        );
      } catch (e) {
        console.warn('[Agent] iter 5: 构建 iter5SystemParts 失败，回退老路径:', e?.message || e);
        iter5SystemParts = this._rebuildMergedSystemPartsForIteration({
          lastGameState, userMessage: lastUserMessage, messages,
          gmDirective, npcReactions,
        });
      }
      const { tools: iter5Tools, allowedToolNames: iter5Allowed, toolChoice: iter5ToolChoice } = this._buildToolsForStage('reads_and_mutations', iter5Adapter);
      const iter5Built = iter5Adapter.buildPayload(unifiedMessages, iter5SystemParts, iter5Tools, { temperature, thinking: iter5Thinking, toolChoice: iter5ToolChoice });
      const iter5MessagesRef = iter5Adapter.getPayloadMessagesRef(iter5Built.payload);
      // Stage 3 directive 已融入 iter5SystemParts（system 层）：
      // - 流水线分工说明 → CORE_PROMPT_ITER5 的"你在流水线中的位置"段
      // - 工具列表说明 → 工具段 + 工具暴露表
      // - iter1NextTool 提示 → iter1NextToolHint volatile 块
      // - "禁止 update_narrative/update_choices/update_npc" → 改为正面陈述"工具列表里没有这三个"
      // user-role stage 3 directive 不再注入，避免对小模型造成"system vs user 权威感冲突"。

      try {
        await this._runReactIteration({
          reactAdapter: iter5Adapter, reactLabel, reactModel: iter5Model,
          payload: iter5Built.payload, messagesRef: iter5MessagesRef,
          url: iter5Built.url, streamUrl: iter5Built.streamUrl,
          executedTools,
          narrativeAccumulator: narrativeAccRef,
          narrativeEmitGuard,
          reactIterationSegments, iterationMetrics, mainLoopToolCounts,
          iteration: 5, iterationLabel: 'iter5', branchLabel: 'main',
          onChunk: null,
          skipNarrativeRescue: true,
          allowedToolNames: iter5Allowed,
        });
      } catch (e) {
        console.warn('[Agent] iter 5 异常，继续 iter 6:', e?.message || e);
      }
      messagesRef = iter5MessagesRef;
      // sanitize：剔除 iter5 buildPayload 前置的 system 块 + 第一条 user 消息中 CPS-merged
      // 内容。否则 iter6 buildPayload 会再次 prepend 自己的 system+CPS，造成双 system 块 +
      // 双 CPS 累积。详见 plans/cache-c-mellow-alpaca.md 根因分析。
      unifiedMessages = window.sanitizeMessagesForRebuild(iter5MessagesRef);

      // ━━━ iter 6: segment 2 narrative ━━━
      // iter6 专用 system parts —— 与 mergedSystemParts 不共用。理由同 iter1/2-4/5：
      // 老 prompt 把 CORE_PROMPT_MERGED 的 choices 规范 / NPC 工具用法 / 世界扩展 /
      // type=none 双语义详解等与 iter6 任务不匹配的内容暴露出来；同时 stage 4 user
      // directive 把所有 iter6 关键规则（必调 update_narrative 软约束 / 模式 A/B/C
      // 详细描述 / 避免重复扣减）塞到 user 层——权威感弱。新 builder 把规则集中到
      // CORE_PROMPT_ITER6 system 层，stage 4 directive 不再需要。
      // 详见 prompt-gm.js: _buildSystemPartsForIter6 的 doc。
      let iter6SystemParts;
      try {
        const history = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
        const { systemContext: freshSystemContext } = this.formatMessages(history);
        iter6SystemParts = this._buildSystemPartsForIter6(
          freshSystemContext,
          lastGameState,
          lastUserMessage,
          messages,
          gmDirective,
          npcReactions
        );
      } catch (e) {
        console.warn('[Agent] iter 6: 构建 iter6SystemParts 失败，回退老路径:', e?.message || e);
        iter6SystemParts = this._rebuildMergedSystemPartsForIteration({
          lastGameState, userMessage: lastUserMessage, messages,
          gmDirective, npcReactions,
        });
      }
      const { tools: iter6Tools, allowedToolNames: iter6Allowed, toolChoice: iter6ToolChoice } = this._buildToolsForStage('narrative_with_item', reactAdapter);
      const iter6WebSearch = this._shouldEnableWebSearchForStage('narrative_with_item', reactAdapter);
      const iter6Built = reactAdapter.buildPayload(unifiedMessages, iter6SystemParts, iter6Tools, { temperature, thinking, toolChoice: iter6ToolChoice, webSearch: iter6WebSearch });
      const iter6MessagesRef = reactAdapter.getPayloadMessagesRef(iter6Built.payload);
      // Stage 4 directive 已融入 iter6SystemParts（system 层）：
      // - 必调 update_narrative 软约束 → CORE_PROMPT_ITER6 工具段⚠️警告
      // - 模式 A/B/C 详细规则 → CORE_PROMPT_ITER6 checkpoint 三种 type + 模式选择段
      // - 避免重复扣减规则 → CORE_PROMPT_ITER6 mode A 段的 🔍 关键提醒
      // user-role stage 4 directive 不再注入。

      let iter6Result = null;
      try {
        iter6Result = await this._runReactIteration({
          reactAdapter, reactLabel, reactModel,
          payload: iter6Built.payload, messagesRef: iter6MessagesRef,
          url: iter6Built.url, streamUrl: iter6Built.streamUrl,
          executedTools,
          narrativeAccumulator: narrativeAccRef,
          narrativeEmitGuard,
          reactIterationSegments, iterationMetrics, mainLoopToolCounts,
          iteration: 6, iterationLabel: 'iter6', branchLabel: 'main',
          onChunk,
          skipNarrativeRescue: false,
          allowedToolNames: iter6Allowed,
        });
      } catch (e) {
        console.warn('[Agent] iter 6 异常，跳到 iter 8:', e?.message || e);
      }
      messagesRef = iter6MessagesRef;
      // sanitize：剔除 iter6 buildPayload 前置的 system + CPS（同 iter5→iter6）
      unifiedMessages = window.sanitizeMessagesForRebuild(iter6MessagesRef);

      // ━━━ iter 7: 三分支 gating ━━━
      //   分支 1: rescue 模式  — iter 6 漏调 update_narrative（segment 2 缺失），用 iter 7 槽位补写
      //                        包含两种情况：(a) iter 6 跑完但 AI 没调 update_narrative；
      //                                     (b) iter 6 整体抛异常（iter6Result=null）
      //                        瞬时故障 / 单点解析失败下，rescue 用更简单 payload 还能救活回合
      //   分支 2: closing_resolve — iter 6 调了 narrative + 非-none type，正常闭合
      //   分支 3: 跳过           — iter 6 调了 narrative 但 type=none，无需 iter 7
      const iter6MissedNarrative = !iter6Result || !iter6Result.executedToolNames?.includes('update_narrative');
      const iter6Checkpoint = iter6Result?.narrativeCheckpoint || null;
      const iter6NextToolFromSchema = (iter6Checkpoint && iter6Checkpoint.type !== 'none' && typeof iter6Checkpoint.next_tool === 'string')
        ? iter6Checkpoint.next_tool.trim()
        : '';
      // 'none' 是 schema enum 的哨兵值（取代旧的空字符串），与未声明等价。
      const iter6NextToolRaw = iter6NextToolFromSchema === 'none' ? '' : iter6NextToolFromSchema;

      // 验证 iter6NextTool 必须命中 registry——否则 closing_resolve filter 只会暴露 update_narrative，
      // 而 directive 仍会要求 AI 调那个不存在的工具，触发 hard-reject。
      // schema enum 已锁住合法名，但保留 runtime 校验作为防御层（custom function override / 工具被禁用等场景）。
      let iter6NextTool = '';
      if (iter6NextToolRaw) {
        const reg = window.toolRegistry;
        if (reg && typeof reg.has === 'function' && reg.has(iter6NextToolRaw) && !reg.isDispatcherManaged(iter6NextToolRaw)) {
          iter6NextTool = iter6NextToolRaw;
        } else {
          console.warn(`[Agent] iter 6 声明 next_tool="${iter6NextToolRaw}" 但 registry 中不存在或被 dispatcher 管理，跳过 iter 7`);
        }
      }

      if (iter6MissedNarrative) {
        // ━━━ 分支 1: iter 7 rescue 模式 ━━━
        // iter 6 漏调 update_narrative（典型：弱模型如 DeepSeek 在 toolChoice='any' + 多工具下选了逃逸路径
        // 只调 update_item 跳过 update_narrative）。用命名强制 narrative_only_closing stage 占用 iter 7 槽位
        // 补写 segment 2，type 强制为 none（与 iter 7 closing 精神一致）。
        console.warn('[Agent] iter 6 漏调 update_narrative，iter 7 切换到 rescue 模式');

        // Layer 1: 消毒 messages clone。把 iter 1/iter 6 的 update_narrative.text
        // 替换为占位符 + 末尾 ≤50 字锚点，模型 rescue call 看不到完整 segment 1 原文
        // 就没法照抄。restore() 通过共享引用还原 rescueMessagesRef 里的 tool_call args，
        // 下游 iter 8/9 看到的还是 unredacted 上下文。详见 _redactNarrativeForRescue 注释。
        //
        // try/catch 兜底：redact 内部用 structuredClone/JSON.parse，理论可能因极端
        // 输入（循环引用、非 JSON-safe 字段）抛错。若发生就回退到原 unifiedMessages，
        // 让 rescue 流程继续跑（Layer 2 directive + Layer 3 dedupe 仍然提供防御），
        // 总比因 redact 失败导致整个 rescue 路径瘫掉好。
        let redactedMessages;
        let restoreRescueRedaction;
        try {
          ({ redactedMessages, restore: restoreRescueRedaction } =
            this._redactNarrativeForRescue(unifiedMessages, 50));
        } catch (e) {
          console.warn('[Agent] iter 7 rescue: Layer 1 redact 失败，回退到原 messages:', e?.message || e);
          redactedMessages = unifiedMessages;
          restoreRescueRedaction = () => {};
        }

        // iter7 rescue 专用 system parts —— 与 mergedSystemParts 不共用。理由同 iter1/2-4/5/6：
        // 老 prompt 把 CORE_PROMPT_MERGED 的 choices 规范 / NPC 工具用法 / iter6 mode A/B/C 等与
        // rescue 任务不匹配的内容暴露出来；同时 stage 5 rescue user directive 把所有 iter7 rescue
        // 关键规则（不要重写 segment 1 / type=none 锁定 / 仅调 update_narrative / 不调 update_item
        // 让 inventory skill 兜底）塞到 user 层——权威感弱。新 builder 把规则集中到
        // CORE_PROMPT_ITER7 system 层 Mode B 段（rescue 判别器：没看到 iter6NextToolHint 块=rescue）。
        // 详见 prompt-gm.js: _buildSystemPartsForIter7 的 doc。
        let iter7SystemParts;
        try {
          const history = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
          const { systemContext: freshSystemContext } = this.formatMessages(history);
          iter7SystemParts = this._buildSystemPartsForIter7(
            'rescue', '',
            freshSystemContext,
            lastGameState,
            lastUserMessage,
            messages,
            gmDirective,
            npcReactions
          );
        } catch (e) {
          console.warn('[Agent] iter 7 rescue: 构建 iter7SystemParts 失败，回退老路径:', e?.message || e);
          iter7SystemParts = this._rebuildMergedSystemPartsForIteration({
            lastGameState, userMessage: lastUserMessage, messages,
            gmDirective, npcReactions,
          });
        }
        const { tools: rescueTools, allowedToolNames: rescueAllowed, toolChoice: rescueToolChoice } = this._buildToolsForStage('narrative_only_closing', reactAdapter);
        const rescueWebSearch = this._shouldEnableWebSearchForStage('narrative_only_closing', reactAdapter);
        const rescueBuilt = reactAdapter.buildPayload(redactedMessages, iter7SystemParts, rescueTools, { temperature, thinking, toolChoice: rescueToolChoice, webSearch: rescueWebSearch });
        const rescueMessagesRef = reactAdapter.getPayloadMessagesRef(rescueBuilt.payload);
        // Stage 5 rescue directive 已融入 iter7SystemParts（system 层）：
        // - 不要重写 segment 1 文本 → CORE_PROMPT_ITER7 Mode B 段 ⚠️ 警告
        // - type=none + 其他字段空 → CORE_PROMPT_ITER7 Mode B 段
        // - 不调 update_item → 工具段（rescue 的 stage 工具只有 update_narrative）
        // user-role stage 5 rescue directive 不再注入，避免对小模型造成"system vs user 权威感冲突"。

        try {
          await this._runReactIteration({
            reactAdapter, reactLabel, reactModel,
            payload: rescueBuilt.payload, messagesRef: rescueMessagesRef,
            url: rescueBuilt.url, streamUrl: rescueBuilt.streamUrl,
            executedTools,
            narrativeAccumulator: narrativeAccRef,
          narrativeEmitGuard,
            reactIterationSegments, iterationMetrics, mainLoopToolCounts,
            iteration: 7, iterationLabel: 'iter7.rescue', branchLabel: 'main',
            onChunk,
            skipNarrativeRescue: false,
            allowedToolNames: rescueAllowed,
          });
        } catch (e) {
          console.warn('[Agent] iter 7 rescue 异常，跳到 iter 8:', e?.message || e);
        }

        // Layer 1: 还原 rescueMessagesRef 里被消毒过的 tool_call.function.arguments。
        // 利用 buildPayload 的 tool_calls 引用共享（aiAdapters.js:1213），restore()
        // 改 tool_call.function.arguments 会同步反映到 payload.messages 里的对应条目。
        try { restoreRescueRedaction(); } catch (e) {
          console.warn('[Agent] iter 7 rescue restore 异常（不影响 rescue 结果）:', e?.message || e);
        }

        messagesRef = rescueMessagesRef;
      } else if (iter6NextTool) {
        // ━━━ 分支 2: iter 7 closing_resolve 正常路径 ━━━
        // iter7 closing 专用 system parts —— 与 mergedSystemParts 不共用。理由同 iter1/2-4/5/6：
        // 老 prompt 把 CORE_PROMPT_MERGED 的 iter1 segment 1 规范 / iter5 mutation 规则 / iter6
        // checkpoint 描述等与 closing 任务无关的内容暴露出来；同时 stage 5 final user directive
        // 把所有 iter7 closing 关键规则（同响应双 tool / type=none 锁定 / 不要重写 segment 1/2）
        // 塞到 user 层——权威感弱。新 builder 把规则集中到 CORE_PROMPT_ITER7 system 层 Mode A 段
        // （closing 判别器：看到 iter6NextToolHint 块=closing），并通过 iter6NextToolHint volatile
        // 块传入 iter6 声明的工具名。
        // 详见 prompt-gm.js: _buildSystemPartsForIter7 的 doc。
        let iter7SystemParts;
        try {
          const history = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
          const { systemContext: freshSystemContext } = this.formatMessages(history);
          iter7SystemParts = this._buildSystemPartsForIter7(
            'closing', iter6NextTool,
            freshSystemContext,
            lastGameState,
            lastUserMessage,
            messages,
            gmDirective,
            npcReactions
          );
        } catch (e) {
          console.warn('[Agent] iter 7 closing: 构建 iter7SystemParts 失败，回退老路径:', e?.message || e);
          iter7SystemParts = this._rebuildMergedSystemPartsForIteration({
            lastGameState, userMessage: lastUserMessage, messages,
            gmDirective, npcReactions,
          });
        }
        const { tools: iter7Tools, allowedToolNames: iter7Allowed, toolChoice: iter7ToolChoice } = this._buildToolsForStage('closing_resolve', reactAdapter, { iter6NextTool });
        const iter7WebSearch = this._shouldEnableWebSearchForStage('closing_resolve', reactAdapter);
        const iter7Built = reactAdapter.buildPayload(unifiedMessages, iter7SystemParts, iter7Tools, { temperature, thinking, toolChoice: iter7ToolChoice, webSearch: iter7WebSearch });
        const iter7MessagesRef = reactAdapter.getPayloadMessagesRef(iter7Built.payload);
        // Stage 5 final directive 已融入 iter7SystemParts（system 层）：
        // - 同响应双 tool 强制要求 → CORE_PROMPT_ITER7 Mode A 段 ⚠️ 警告
        // - iter6NextTool 工具名 → iter6NextToolHint volatile 块
        // - 不要重写 segment 1/2 → CORE_PROMPT_ITER7 共同规则段（80+ 字重合检测）
        // - type=none 锁定 → CORE_PROMPT_ITER7 Mode A 段
        // user-role stage 5 final directive 不再注入。

        let iter7Result = null;
        try {
          iter7Result = await this._runReactIteration({
            reactAdapter, reactLabel, reactModel,
            payload: iter7Built.payload, messagesRef: iter7MessagesRef,
            url: iter7Built.url, streamUrl: iter7Built.streamUrl,
            executedTools,
            narrativeAccumulator: narrativeAccRef,
          narrativeEmitGuard,
            reactIterationSegments, iterationMetrics, mainLoopToolCounts,
            iteration: 7, iterationLabel: 'iter7', branchLabel: 'main',
            onChunk,
            skipNarrativeRescue: false,
            allowedToolNames: iter7Allowed,
          });
        } catch (e) {
          console.warn('[Agent] iter 7 异常，跳到 iter 8:', e?.message || e);
        }
        messagesRef = iter7MessagesRef;

        // ━━━ iter 7 closing 软契约补救 ━━━
        // iter7 closing 应同响应调 update_narrative + iter6NextTool。但 API 不支持
        // "命名强制 N 个工具同时调"，纯靠 prompt 软约束，实测大小模型都偶尔违约——
        // 模型只调 next_tool 跳过 update_narrative，segment 3 缺失，玩家叙事断裂。
        // 检测漏调时复用 iter7 rescue 基础设施（Layer 1 redact + Mode B prompt +
        // narrative_only_closing 命名强制 stage）跑一次仅 narrative 补救子轮。
        // 失败不再二次重试——iter9 内部 L3 narrative salvage + L4 fallback 兜底。
        const iter7ClosingMissedNarrative = !iter7Result
          || !iter7Result.executedToolNames?.includes('update_narrative');
        if (iter7ClosingMissedNarrative) {
          console.warn('[Agent] iter 7 closing 漏调 update_narrative，启动补救子轮');

          // Layer 1: redact iter1/iter6 的 update_narrative.text 为占位符+50字尾锚，
          // 防止模型抄旧 segment。restore() 跑完还原下游可见原文。
          let recoveryRedactedMessages;
          let restoreRecoveryRedaction;
          try {
            ({ redactedMessages: recoveryRedactedMessages, restore: restoreRecoveryRedaction } =
              this._redactNarrativeForRescue(iter7MessagesRef, 50));
          } catch (e) {
            console.warn('[Agent] iter 7 closing 补救: Layer 1 redact 失败，回退到原 messages:', e?.message || e);
            recoveryRedactedMessages = iter7MessagesRef;
            restoreRecoveryRedaction = () => {};
          }

          // system parts: 复用 Mode B prompt（_buildSystemPartsForIter7('rescue')）
          // Mode B 措辞已泛化覆盖 segment 2 / segment 3 双场景，模型从消息历史里
          // 的 update_narrative 锚点数量自行判断该补哪段。
          let recoverySystemParts;
          try {
            const history = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
            const { systemContext: freshSystemContext } = this.formatMessages(history);
            recoverySystemParts = this._buildSystemPartsForIter7(
              'rescue', '',
              freshSystemContext,
              lastGameState,
              lastUserMessage,
              messages,
              gmDirective,
              npcReactions
            );
          } catch (e) {
            console.warn('[Agent] iter 7 closing 补救: 构建 systemParts 失败，回退:', e?.message || e);
            recoverySystemParts = this._rebuildMergedSystemPartsForIteration({
              lastGameState, userMessage: lastUserMessage, messages,
              gmDirective, npcReactions,
            });
          }

          const { tools: recoveryTools, allowedToolNames: recoveryAllowed, toolChoice: recoveryToolChoice } =
            this._buildToolsForStage('narrative_only_closing', reactAdapter);
          const recoveryWebSearch = this._shouldEnableWebSearchForStage('narrative_only_closing', reactAdapter);
          const recoveryBuilt = reactAdapter.buildPayload(
            recoveryRedactedMessages, recoverySystemParts, recoveryTools,
            { temperature, thinking, toolChoice: recoveryToolChoice, webSearch: recoveryWebSearch }
          );
          const recoveryMessagesRef = reactAdapter.getPayloadMessagesRef(recoveryBuilt.payload);

          try {
            await this._runReactIteration({
              reactAdapter, reactLabel, reactModel,
              payload: recoveryBuilt.payload, messagesRef: recoveryMessagesRef,
              url: recoveryBuilt.url, streamUrl: recoveryBuilt.streamUrl,
              executedTools,
              narrativeAccumulator: narrativeAccRef,
          narrativeEmitGuard,
              reactIterationSegments, iterationMetrics, mainLoopToolCounts,
              iteration: 7, iterationLabel: 'iter7.closing_recovery', branchLabel: 'main',
              onChunk,
              skipNarrativeRescue: false,
              allowedToolNames: recoveryAllowed,
            });
          } catch (e) {
            console.warn('[Agent] iter 7 closing 补救异常，跳到 iter 8:', e?.message || e);
          }

          // 还原 Layer 1 redact，让下游 iter8/9 看到 unredacted 上下文。
          try { restoreRecoveryRedaction(); } catch (e) {
            console.warn('[Agent] iter 7 closing 补救 restore 异常（不影响补救结果）:', e?.message || e);
          }

          messagesRef = recoveryMessagesRef;
        }
      } else {
        // ━━━ 分支 3: 跳过 iter 7 ━━━
        console.log('[Agent] iter 6 type=none 或无有效 next_tool，跳过 iter 7');
      }
    }

    // 把累积叙事拷回 plain string 供 iter 8/9 与函数 epilogue 使用
    narrativeAccumulator = narrativeAccRef.value;

    // ━━━ iter 8: settlement（panelSkill ‖ inventorySkill 并发 + 摘要注回 messagesRef）━━━
    await this._runSettlementIteration({
      narrativeAccumulator,
      mainLoopToolCounts,
      messagesRef,
      reactAdapter,
      temperature,
      reactIterationSegments,
    });

    // ━━━ iter 9: choices（仅 update_choices 工具 + 4 层 salvage）━━━
    // 注：iter 9 在 _runChoicesIteration 内部用 iter9_choices 专属配置（v4-flash + off），
    // 不复用 caller 的 reactAdapter / thinking / reactModel；本调用不再传这三个参数。
    // him（NPC 登场审计）与写 choice 那步并行 Promise.all、回合内联合 await。
    // 锚 _runChoicesIteration 调用点本身（不锚 iter 序号——序号随 Branch B 长度浮动到 7/8/9）。
    // 变长 Branch B 在回合开头那段 Promise.all 已 resolve、到不了这里，故此处良定义。
    // him 异常安全（.catch 吞，不阻塞主流程）；自建 npc_intro_audit adapter（见 B1）。
    const _himHistory = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
    const [choicesResult] = await Promise.all([
      this._runChoicesIteration({
        sanitizedMessages,
        messagesRef,
        lastGameState,
        lastUserMessage,
        messages,
        gmDirective,
        npcReactions,
        temperature,
        reactLabel,
        reactIterationSegments,
        iterationMetrics,
        narrativeAccumulator,
        narrativeEmitGuard,
      }),
      this._runNpcIntroAuditSubagent(narrativeAccRef.value, _himHistory)
        .catch(e => console.warn('[NPC IntroAudit] 不阻塞主流程:', e?.message || e)),
    ]);
    choicesData = choicesResult.choicesData;
    narrativeAccumulator = choicesResult.narrativeAccumulator;

    // ── 函数 epilogue · 空 narrative 灾难兜底 ──
    // 处理"全 pipeline 一字未产"的极端情况：iter 1/6/7 都 throw + iter 9 也无 hallucinated narrative。
    // 这是函数级最后一道闸，与 iter 9 内部 4 层 salvage 不同（后者只兜 choices）。
    if (!narrativeAccumulator.trim()) {
      // 兜底 1：尝试从 commentary 段落拼接明文输出
      const commentaryText = reactIterationSegments
        .filter(s => s.type === 'commentary' && s.text && s.text.trim())
        .map(s => s.text.trim())
        .join('\n\n');

      if (commentaryText) {
        console.warn('[Agent] 模型未调用 update_narrative()，使用 commentary 文本兜底');
        narrativeAccumulator = commentaryText;
        reactIterationSegments.push({
          type: 'narrative',
          iteration: 0,
          text: commentaryText,
          fallback: true,
        });
      } else {
        // 兜底 2：commentary 也为空 → 5 档分类（A upstream / B narrative_skipped /
        // C no_function_calling 仅自定义 provider / C' & D unexpected_format）
        // 历史 bug-0004：557ebaa 引入的"非 upstream 即 no_function_calling"兜底逻辑把
        // 余额不足/限流/超时全甩成"模型不支持 fc"，污染 capability memo 还引导用户换模型
        // (用户 812cb818 / 4a9a8b66 实证)。新逻辑要求 no_function_calling 必须有积极证据
        // (整个 turn 零 tool_call) 且 provider 是自定义 (builtin 永不下此结论)。
        const lang = this._getGamePromptLanguage?.() || 'zh';

        // ── A 档积极证据：任何 step.failed === true（不再做关键词白名单过滤）──
        const allSteps = this.lastPayload?.steps || [];
        const failedSteps = allSteps.filter(s => s?.failed);
        const upstreamFirst = failedSteps[0];

        // ── B / C 档区分：扫 executedTools (Set of "name:argsJSON") 看 turn 内
        //    是否调过任何工具、是否调过 update_narrative ──
        const executedNames = [...executedTools].map(sig =>
          typeof sig === 'string' ? sig.split(':')[0] : ''
        );
        const anyToolCalled = executedNames.length > 0;
        const narrativeCalled = executedNames.includes('update_narrative');

        // ── 自定义 provider 判定 (用 telemetry 取的 reactProviderForTelemetry，
        //    覆盖推荐模式下 iter1_narrative 的实际 provider) ──
        const reactProviderId = this.getProviderForModule('iter1_narrative', AI_REQUEST_SCOPED);
        const isCustom = !!(this.isCustomProvider && this.isCustomProvider(reactProviderId));

        // ── 5 档分类决策 ──
        let errorTypeForDialog;
        let upstreamKindResult = null;
        let msg;
        let rootCause;

        if (upstreamFirst) {
          // A 档: upstream_failure
          errorTypeForDialog = 'upstream_failure';
          upstreamKindResult = classifyUpstreamErrorStep(upstreamFirst);
          const realMsg = upstreamKindResult.msg || '上游 API 调用失败';
          msg = lang === 'en'
            ? `Upstream API error: ${realMsg}`
            : `上游 API 调用失败：${realMsg}`;
          rootCause = `上游 ${failedSteps.length} 个 step 失败（首条 ${upstreamFirst.phase || '?'}: ${realMsg}）`;
        } else if (anyToolCalled && !narrativeCalled) {
          // B 档: narrative_skipped (模型支持 fc 协议但未调 update_narrative，典型 Gemini 抽风)
          errorTypeForDialog = 'narrative_skipped';
          msg = lang === 'en'
            ? 'Model executed other tools but skipped update_narrative. This often happens when the model does not reliably honor named tool_choice — please retry.'
            : '模型执行了其他工具但跳过了 update_narrative（叙事生成）。这通常是模型对 named tool_choice 的遵守不稳定，请重试。';
          rootCause = `模型调用了 ${executedNames.length} 个工具但未调 update_narrative（已调：${[...new Set(executedNames)].join(', ') || 'none'}）`;
        } else if (!anyToolCalled && isCustom) {
          // C 档: no_function_calling (真阳性，仅自定义 provider 路径) → 写 memo
          errorTypeForDialog = 'no_function_calling';
          msg = lang === 'en'
            ? 'Model did not produce narrative via function calling (no tool calls and no plain text output). This model may not support tool calling — try a model with function calling support.'
            : '模型未通过 function calling 返回叙事（既无任何工具调用也无明文输出）。该模型可能不支持工具调用，建议改用支持 function calling 的模型。';
          rootCause = '模型未按 function calling 协议返回任何工具调用（commentary 也为空）';
          this._rememberModelNoFunctionCalling(reactProviderId, reactModel);
        } else {
          // C' / D 档: unexpected_format (builtin provider 无 tool_call，或其他 edge case)
          errorTypeForDialog = 'unexpected_format';
          msg = lang === 'en'
            ? 'Model returned an unexpected response format (no narrative tool call and no plain text). Please retry.'
            : '模型返回格式异常（无叙事工具调用也无明文输出），请重试。';
          rootCause = anyToolCalled
            ? '模型调用了工具但未产出叙事 + commentary 为空'
            : '模型未产出任何工具调用 + commentary 为空（builtin provider 不下"不支持 fc"结论）';
        }

        const emptyTextError = new Error(`Agent ReAct Error: ${msg}`);
        const failureContext = {
          phase: 'react',
          module: 'react',
          provider: reactLabel,
          model: reactModel,
          url: null,  // 函数 epilogue：无单一 url 概念
          defaultErrorType: errorTypeForDialog,
          rootCause,
        };
        this._markStepFailure(
          this.lastPayload.steps[this.lastPayload.steps.length - 1],
          emptyTextError,
          failureContext
        );
        // upstream_failure 时把 classify 结果挂到 errorInfo，让 chatCore 错误对话框路由建议
        if (upstreamKindResult && emptyTextError.errorInfo && typeof emptyTextError.errorInfo === 'object') {
          emptyTextError.errorInfo.upstreamKind = upstreamKindResult.kind;
          emptyTextError.errorInfo.upstreamStatus = upstreamKindResult.status;
          emptyTextError.errorInfo.upstreamRawMessage = upstreamKindResult.msg;
          // Gemini 安全过滤的额外元数据：reason 枚举 + 阶段（输入拦/输出切）
          if (upstreamKindResult.safetyReason) emptyTextError.errorInfo.safetyReason = upstreamKindResult.safetyReason;
          if (upstreamKindResult.safetyStage) emptyTextError.errorInfo.safetyStage = upstreamKindResult.safetyStage;
        }
        throw emptyTextError;
      }
    }

    // ── 保存结果 ──
    this.lastReactSegments = reactIterationSegments;
    this.lastNarrativeText = narrativeAccumulator;
    this.lastNarrativeOnly = narrativeAccumulator;

    // 保存结构化选项数据（供 processAIResponse 注入 gameData）
    this.lastChoicesData = choicesData.length > 0 ? choicesData : null;

    // 将 choices 格式化为 step2Choices 文本（供 UI 展示）
    if (choicesData.length > 0) {
      this.lastStep2Choices = choicesData
        .filter(c => c && c.id != null && c.text)
        .map(c => `${c.id}. [${c.type_tag || '?'}] ${c.text}`)
        .join('\n');
    } else {
      this.lastStep2Choices = '';
    }

    // 通知前端
    if (window.eventBus && window.GameEvents) {
      window.eventBus.emit(window.GameEvents.AI_REACT_COMPLETE, {
        functionCalls: this.lastFunctionCalls,
      });
      window.eventBus.emit(window.GameEvents.AI_NARRATIVE_COMPLETE, {});
    }

    // 汇总 ReAct 循环 metrics
    if (iterationMetrics.length > 0) {
      // TTFT 取 Branch A（iter 1）的——这是用户感知的首字延迟。
      // Promise.all 下完成顺序非确定，iterationMetrics[0] 可能是更快返回的 Branch B 小 read query，
      // 那不是 user-visible TTFT。所以显式按 branch='A' 找。
      const branchATTFT = iterationMetrics.find(m => m.branch === 'A')?.ttft;
      stepMetrics.push({
        phase: 'react',
        model: reactModel,
        iterations: iterationMetrics.length,
        inputTokens: iterationMetrics.reduce((s, m) => s + (m.inputTokens || 0), 0),
        outputTokens: iterationMetrics.reduce((s, m) => s + (m.outputTokens || 0), 0),
        cacheReadTokens: iterationMetrics.reduce((s, m) => s + (m.cacheReadTokens || 0), 0),
        cacheCreationTokens: iterationMetrics.reduce((s, m) => s + (m.cacheCreationTokens || 0), 0),
        // 末 iter 的 stopReason 才是回合"最终"为什么结束（中间 iter 必为 tool_use/tool_calls）
        stopReason: iterationMetrics[iterationMetrics.length - 1]?.stopReason || null,
        ttft: branchATTFT ?? iterationMetrics[0]?.ttft ?? null,
        totalTime: iterationMetrics.reduce((s, m) => s + (m.totalTime || 0), 0),
        perIteration: iterationMetrics,
      });
    }

    this.lastPayload.models.react = reactModel;

    // ── 折入子代理（npc_reaction / npc_card_sync / npc_intro_audit）token+费用 ──
    // 它们与主循环并行，wall-clock 已含在 totalRequestTime → 只折 token/费用，
    // 不加时间（用户决策：不计入总时间）。不塞进 stepMetrics（保留 ReAct
    // 单 step 多迭代的逐迭代 tooltip 不回归），单列 lastRequestMetrics.subagents。
    const _SUBAGENT_PRICE_MODULE = {
      npc_reaction: 'npc_reaction',
      npc_card_sync: 'npc_reaction', // npc_card_sync 复用 npc_reaction 模型/价
      npc_intro_audit: 'npc_intro_audit',
    };
    const subagentMetrics = [];
    const subagentPrices = {};
    const _subSteps = (this.lastPayload && Array.isArray(this.lastPayload.steps)) ? this.lastPayload.steps : [];
    for (const ph of Object.keys(_SUBAGENT_PRICE_MODULE)) {
      const matched = _subSteps.filter(s => s && s.phase === ph && s.metrics);
      if (matched.length === 0) continue;
      const inTok = matched.reduce((sum, st) => sum + (st.metrics.inputTokens || 0), 0);
      const outTok = matched.reduce((sum, st) => sum + (st.metrics.outputTokens || 0), 0);
      if (inTok === 0 && outTok === 0) continue;
      subagentMetrics.push({ phase: ph, inputTokens: inTok, outputTokens: outTok });
      subagentPrices[ph] = this.getModulePrices(_SUBAGENT_PRICE_MODULE[ph], AI_REQUEST_SCOPED);
    }

    console.log(`[Agent] ReAct 完成: 叙事 ${narrativeAccumulator.length} 字, ${choicesData.length} 个选项`);

    // 记录当前 turn number，供标记短信时使用
    if (this._pendingSmsInjection) {
      this._pendingSmsTurnNumber =
        messages.filter(m => m.role === 'model' || m.role === 'assistant').length + 1;
    }

    this.clearPendingPlayerActionContext();

    // GM 状态提交
    const openingGuideTurn =
      typeof chatHistory !== 'undefined' ? chatHistory.filter(m => m.sender === 'ai').length : 0;

    if (
      typeof gmCodeEngine !== 'undefined' &&
      typeof gmCodeEngine.updateOpeningGuideProgress === 'function'
    ) {
      gmCodeEngine.updateOpeningGuideProgress(openingGuideTurn, narrativeAccumulator);
    }

    if (this._pendingEventToMark) {
      const pending = this._pendingEventToMark;
      if (
        typeof gmCodeEngine !== 'undefined' &&
        typeof gmCodeEngine.markEventBroadcasted === 'function'
      ) {
        gmCodeEngine.markEventBroadcasted(pending.eventId, pending.turn, pending.type, null);
        console.log('[GM] 事件已标记:', pending.eventId);
      }
      this._pendingEventToMark = null;
    }

    // 返回叙事文本（不再包装为 JSON 代码块）
    // processAIResponse 将以纯文本形式接收，panel_status 由工具直接修改
    const finalOutput = narrativeAccumulator;

    // 兼容下游监听器
    if (window.eventBus && window.GameEvents) {
      window.eventBus.emit(window.GameEvents.AI_STEP3_COMPLETE, {
        jsonData: { choices: choicesData, panel_narrative: narrativeAccumulator },
        narrativeText: narrativeAccumulator,
      });
    }

    // 时间指标
    const totalRequestTime = performance.now() - requestStartTime;
    const totalInputTokens = stepMetrics.reduce((sum, s) => sum + (s.inputTokens || 0), 0)
      + subagentMetrics.reduce((sum, s) => sum + (s.inputTokens || 0), 0);
    const totalOutputTokens = stepMetrics.reduce((sum, s) => sum + (s.outputTokens || 0), 0)
      + subagentMetrics.reduce((sum, s) => sum + (s.outputTokens || 0), 0);
    const totalCacheReadTokens = stepMetrics.reduce((sum, s) => sum + (s.cacheReadTokens || 0), 0);
    const totalCacheCreationTokens = stepMetrics.reduce((sum, s) => sum + (s.cacheCreationTokens || 0), 0);

    const reactProviderKey = reactAdapter.getProviderLabel().toLowerCase();
    this.lastRequestMetrics = {
      provider: reactProviderKey,
      providers: {
        react: reactProviderKey,
      },
      models: {
        react: reactModel,
      },
      thinking: reactProviderKey === 'deepseek'
        ? { react: this.getModuleThinking('react', AI_REQUEST_SCOPED) }
        : {},
      prices: {
        react: this.getModulePrices('react', AI_REQUEST_SCOPED),
        ...subagentPrices,
      },
      gmDirective: gmDirective ? true : false,
      ttft: stepMetrics[0]?.ttft || null,
      totalTime: Math.round(totalRequestTime),
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheReadTokens: totalCacheReadTokens,
      cacheCreationTokens: totalCacheCreationTokens,
      steps: stepMetrics,
      subagents: subagentMetrics,
      timestamp: new Date(),
    };
    console.log(
      `[Agent] 请求完成 - ReAct: ${reactModel}, GM指令: ${gmDirective ? '有' : '无'} | TTFT: ${this.lastRequestMetrics.ttft}ms, 总时间: ${this.lastRequestMetrics.totalTime}ms`
    );

    // 标记短信
    if (this._pendingSmsInjection && typeof smsService !== 'undefined') {
      smsService.markAllNewAsInjected(this._pendingSmsTurnNumber);
      console.log(`[Agent] 短信已标记为 injected (Turn ${this._pendingSmsTurnNumber})`);
      this._pendingSmsInjection = false;
      this._pendingSmsTurnNumber = null;
    }

    try {
      const _dur = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _analyticsT0;
      window.analyticsService?.noteAiCall?.(_dur);
      const _lrm = this.lastRequestMetrics;
      const _iterCount = _lrm?.steps?.reduce((s, x) => s + (x.iterations || 0), 0) ?? null;
      const _perIterTokens = _lrm?.steps?.flatMap(s =>
        (s.perIteration || []).map(it => ({
          i: it.iteration,
          in: it.inputTokens || 0,
          out: it.outputTokens || 0,
          model: it.model || s.model || null,
        }))
      )?.slice(0, 50) ?? null;
      // 规范化各 provider 的 stop_reason → {stop, length, tool_calls, content_filter, other}
      const _normalizeFinish = (raw) => {
        if (!raw) return 'stop';
        const r = String(raw).toLowerCase();
        if (['end_turn', 'stop', 'stop_sequence'].includes(r)) return 'stop';
        if (['max_tokens', 'length'].includes(r)) return 'length';
        if (['tool_use', 'tool_calls'].includes(r)) return 'tool_calls';
        if (['safety', 'content_filter', 'recitation', 'blocklist'].includes(r)) return 'content_filter';
        return r;
      };
      const _lastStop = _lrm?.steps?.[_lrm.steps.length - 1]?.stopReason ?? null;
      window.analyticsService?.track?.('ai.response', {
        request_id: _analyticsReqId,
        duration_ms: Math.round(_dur),
        completion_len_chars: typeof finalOutput === 'string' ? finalOutput.length : 0,
        provider: _lrm?.provider ?? null,
        model: _lrm?.models?.react ?? null,
        input_tokens: _lrm?.inputTokens ?? null,
        output_tokens: _lrm?.outputTokens ?? null,
        cache_read_tokens: _lrm?.cacheReadTokens ?? null,
        cache_creation_tokens: _lrm?.cacheCreationTokens ?? null,
        iter_count: _iterCount,
        per_iter_tokens: _perIterTokens,
        finish_reason: _normalizeFinish(_lastStop),
        finish_reason_raw: _lastStop,
        retry_count: 0,
        was_streamed: true,
        ok: true,
        completion_text: typeof finalOutput === 'string' ? finalOutput.slice(0, 32000) : null,
      });
    } catch (_) { /* ignore */ }

    return finalOutput;

    } catch (err) {
      try {
        const _dur = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _analyticsT0;
        window.analyticsService?.noteAiCall?.(_dur);
        // 区分用户主动 abort 与系统 error
        const _isAbort = err?.name === 'AbortError' || err?.message === 'AbortError' || err?.message?.includes('aborted');
        window.analyticsService?.track?.('ai.response', {
          request_id: _analyticsReqId,
          duration_ms: Math.round(_dur),
          completion_len_chars: 0,
          provider: this.lastRequestMetrics?.provider ?? null,
          model: this.lastRequestMetrics?.models?.react ?? null,
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          cache_creation_tokens: null,
          iter_count: null,
          per_iter_tokens: null,
          finish_reason: _isAbort ? 'abort' : 'error',
          finish_reason_raw: err?.name || null,
          retry_count: 0,
          was_streamed: true,
          ok: false,
          error_message: err?.message ? String(err.message).slice(0, 256) : null,
        });
      } catch (_) { /* ignore */ }
      throw err;
    } finally {
      this._currentAbortSignal = null;
      // Turn 结束（正常/abort/异常）统一清理 turn 级全局状态
      // 避免用户快速连续提交时前一回合的 hints 泄露到下一回合
      window._currentTurnSettlementHints = null;
    }
  }

  // ============================================
  // iter 8 · settlement
  // ============================================
  /**
   * 并发执行所有已注册 skill（panelSkill + inventorySkill），结果折叠成结算摘要
   * 注回 messagesRef 末尾，给 iter 9 看见结算后状态。
   *
   * 输入契约：
   *   - narrativeAccumulator: iter 1-7 累积叙事的 plain string
   *   - mainLoopToolCounts: 主循环 tool 调用次数累计（inventorySkill.shouldRun 用）
   *   - messagesRef: 主对话流引用（结算摘要 append 进去）
   *   - reactAdapter / temperature: 透传给 skill subagent 调用
   *
   * 输出契约：
   *   - 写 this.lastPayload.settlementDispatch（debug UI 在 6 处读这个字段）
   *   - 通过 settlementSummaryWrapper directive 把结算摘要 append 到 messagesRef
   *   - 返回 dispatchResult（caller 可选地利用，目前不用）
   *
   * @returns {Promise<Object>} skillDispatcher.dispatch 的原始 result
   */
  async _runSettlementIteration({
    narrativeAccumulator,
    mainLoopToolCounts,
    messagesRef,
    reactAdapter,
    temperature,
    reactIterationSegments,  // 让 iter 8 出现在主气泡的推理列表（VIII）
  }) {
    if (!window.skillDispatcher || window.skillDispatcher.size === 0) {
      // 没有任何 skill 注册时直接 no-op（早期初始化或测试场景）
      return { completedTools: [], failedSkills: [], summary: {}, skillResults: {} };
    }

    const turnCtx = {
      narrativeText: narrativeAccumulator,
      gameState: window.buildTurnResult?.() || {},
      settlementHints: window._currentTurnSettlementHints || null,
      mainLoopToolCounts: { ...mainLoopToolCounts },
      adapter: reactAdapter,
      temperature,
      abortSignal: this._currentAbortSignal,
    };

    let result = null;
    let dispatchCrashed = false;
    try {
      result = await window.skillDispatcher.dispatch(turnCtx, this);
    } catch (e) {
      console.error('[Agent] iter 8 settlement dispatch 异常:', e);
      dispatchCrashed = true;
    }

    const hasRequiredFailure = !dispatchCrashed && (result?.failedSkills || []).some(name => {
      const skill = window.skillDispatcher._skills?.get(name);
      return skill?.required;
    });

    // 持久化到 lastPayload 供 debug UI 使用
    if (this.lastPayload) {
      this.lastPayload.settlementDispatch = {
        status: dispatchCrashed ? 'crashed' : (hasRequiredFailure ? 'failed' : 'succeeded'),
        completedTools: result?.completedTools || [],
        failedSkills: result?.failedSkills || [],
        duration: result?.duration || 0,
        skillResults: Object.fromEntries(
          Object.entries(result?.skillResults || {}).map(
            ([k, v]) => [k, { status: v.status, duration: v.duration }]
          )
        ),
      };
    }

    // 结算摘要 → user 消息注入 messagesRef，给 iter 9 看见结算结果
    // 仅在 dispatch 正常返回时注入；crash 时跳过避免给 iter 9 注入误导性的"(无字段变化)"
    // 同时把摘要文本暴露给 iter9 的极简 tail（_runChoicesIteration 读
    // this._lastSettlementSummaryText）。块外先置空，crash/无结算时为空防脏读。
    this._lastSettlementSummaryText = '';
    if (result && this.reactLoop) {
      const summaryText = this._formatSettlementSummary(result);
      this._lastSettlementSummaryText = summaryText || '';
      if (summaryText) {
        const wrappedSummary = window.promptRegistry
          ?.get('react.directive.settlementSummaryWrapper')
          ?.builder({ summaryText });
        if (wrappedSummary) {
          this.reactLoop.appendUserMessage(messagesRef, wrappedSummary, reactAdapter);
        }
      }
    }

    // 把 iter 8 的 skill subagent 工具调用同步到 lastFunctionCalls + reactIterationSegments，
    // 让主气泡的推理时间线显示 VIII 这一步（与 iter 1-7 同形）。
    if (result?.skillResults) {
      const iter8Calls = [];
      for (const [skillName, sr] of Object.entries(result.skillResults)) {
        if (!Array.isArray(sr?.toolResults)) continue;
        for (const tr of sr.toolResults) {
          iter8Calls.push({
            name: tr.name,
            args: tr.args || {},
            status: tr.success ? 'executed' : 'failed',
            result: tr.result ?? (tr.error ? `[失败] ${tr.error}` : null),
            skill: skillName,
          });
        }
      }
      if (iter8Calls.length > 0) {
        if (!this.lastFunctionCalls) this.lastFunctionCalls = [];
        this.lastFunctionCalls.push({
          step: this.accumulatedStepCount,
          iteration: 8,
          iterationLabel: 'iter8',
          branch: 'main',
          calls: iter8Calls,
        });
        if (Array.isArray(reactIterationSegments)) {
          reactIterationSegments.push({ type: 'tools', iteration: 8, iterationLabel: 'iter8' });
        }
        if (window.eventBus && window.GameEvents?.AI_REACT_TOOL_CALL) {
          window.eventBus.emit(window.GameEvents.AI_REACT_TOOL_CALL, {
            iteration: 8,
            iterationLabel: 'iter8',
            calls: iter8Calls,
          });
        }
      }
    }

    return result;
  }

  // ============================================
  // iter 9 · choices
  // ============================================
  /**
   * 单次主模型 API call，工具白名单 = [update_choices]，tool_choice 锁定该工具。
   * 4 层 salvage 保底：
   *   L1: ALLOWED_FORCE_TOOLS 过滤 hallucinated 工具调用
   *   L2: 逐条 _normalizeAndValidateChoiceObject + 占位字段填充
   *   L3: hallucinated update_narrative 文本 salvage 进 narrativeAccumulator
   *   L4: 完全失败 → 注入 3 个泛用 fallback choices, lastPayload.fallbackChoicesUsed=true
   *
   * @returns {Promise<{choicesData: Array, narrativeAccumulator: string}>}
   */
  async _runChoicesIteration({
    // 注意：caller 仍传 reactAdapter/thinking/reactModel（iter1 配置），
    // 但 iter 9 走自己专属 iter9_choices 配置，这里不解构 caller 的版本。
    // mergedSystemParts 在 iter9 refactor 后也不再需要——_buildSystemPartsForIter9
    // 失败时直接调 _rebuildMergedSystemPartsForIteration() 重建，不复用 caller 的版本。
    sanitizedMessages,
    messagesRef,
    lastGameState,
    lastUserMessage,
    messages,
    gmDirective,
    npcReactions,
    temperature,
    reactLabel,
    reactIterationSegments,
    iterationMetrics,
    narrativeAccumulator,
    narrativeEmitGuard,
  }) {
    let choicesData = [];

    // per-iter 路由：iter 9 用 iter9_choices（推荐模式：v4-flash + thinking=off）。
    // tool_choice 强制 update_choices，forced-tool gate 会自动 strip thinking——
    // 但 thinking=off 一开始就不会触发 gate。
    const reactAdapter = this._getAdapter('iter9_choices', AI_REQUEST_SCOPED);
    const thinking = this.getModuleThinking('iter9_choices', AI_REQUEST_SCOPED);
    const reactModel = this.getModelForModule('iter9_choices', AI_REQUEST_SCOPED);

    // 工具集仅 update_choices；通过 _buildToolsForStage 走统一 schema clone + tool_choice 路径
    const { tools: ucTools, toolChoice: ucToolChoice } = this._buildToolsForStage('choices_only', reactAdapter);

    // iter9 专用 system parts —— 与 mergedSystemParts 不共用。理由同 iter1/2-4/5/6/7：
    // 老 prompt 把 CORE_PROMPT_MERGED 的叙事段说明 / NPC 工具用法 / item 规则 / checkpoint
    // 机制等与 iter9 无关的内容暴露出来；同时 forceUpdateChoices user directive 把"必须立刻
    // 调 update_choices"塞到 user 层——权威感弱。新 builder 把规则集中到 CORE_PROMPT_ITER9
    // system 层（流水线位置 + 选项质量原则 + 文风锁定），forceUpdateChoices directive 不再
    // 需要（tool_choice 已硬约束工具调用）。
    // 详见 prompt-gm.js: _buildSystemPartsForIter9 的 doc。
    let iter9SystemParts;
    try {
      const history = typeof chatHistory !== 'undefined' && Array.isArray(chatHistory) ? chatHistory : [];
      const { systemContext: freshSystemContext } = this.formatMessages(history);
      iter9SystemParts = this._buildSystemPartsForIter9(
        freshSystemContext,
        lastGameState,
        lastUserMessage,
        messages,
        gmDirective,
        npcReactions
      );
    } catch (e) {
      console.warn('[Agent] iter 9: 构建 iter9SystemParts 失败，回退老路径:', e?.message || e);
      iter9SystemParts = this._rebuildMergedSystemPartsForIteration({
        lastGameState,
        userMessage: lastUserMessage,
        messages,
        gmDirective,
        npcReactions,
      });
    }
    // forceUpdateChoices directive 已融入 iter9SystemParts（system 层）：
    // - "立刻调用 update_choices()" → CORE_PROMPT_ITER9 工具段（"runtime 已强制 tool_choice
    //   锁定该工具——你必须调它一次"）
    // - "提供 2-4 个选项" → CORE_PROMPT_ITER9 任务段
    // user-role forceUpdateChoices directive 不再注入。

    // 构建 payload，messagesRef 内容拷贝过去（与 iter 1-7 形态保持一致）
    const iter9Payload = reactAdapter.buildPayload(
      sanitizedMessages,
      iter9SystemParts,
      ucTools,
      { temperature, thinking, toolChoice: ucToolChoice }
    );
    const iter9MessagesRef = reactAdapter.getPayloadMessagesRef(iter9Payload.payload);

    // 方案 C 保守 tail：旧实现用 sanitizeMessagesForRebuild(messagesRef) 整体覆盖，
    // 把本回合 iter1-8 的 tool-call transcript（update_item/new_npc/load_predefined_npc
    // 等工具名 token + role:tool + branch-B coda）灌进 iter9，弱模型被诱导幻觉调 stage
    // 外工具 → L1 全拒 → L4 泛用 fallback。改为：保留 sanitizedMessages（前几回合已被
    // cleanHistoryForGeneration 剥光 tool_calls/tool/choices 的纯文本对话）作干净基底，
    // 本回合上下文只精炼带入定稿叙事 + 结算（不含 iter1-8 transcript）。
    // freshSystemMsg 逻辑保留：OpenAI/DeepSeek 把 system 放 messages[0]，需保住 iter9
    // freshly-built 的 system 不被旧 system 覆盖。
    const family = reactAdapter?.protocolFamily || reactAdapter?.provider || 'gemini';
    const systemInMessages = family !== 'gemini' && family !== 'anthropic';
    const freshSystemMsg = systemInMessages && iter9MessagesRef[0]?.role === 'system'
      ? iter9MessagesRef[0]
      : null;
    // sanitizedMessages 已是干净跨回合对话；再过一遍 sanitizeMessagesForRebuild 同等
    // 剥 system + 首条 user 的 CPS 前缀（与旧路径对 messagesRef 的处理一致）。
    const cleanPrior = window.sanitizeMessagesForRebuild(sanitizedMessages);
    iter9MessagesRef.length = 0;
    if (freshSystemMsg) iter9MessagesRef.push(freshSystemMsg);
    for (const msg of cleanPrior) {
      iter9MessagesRef.push(msg);
    }
    // 本回合精简上下文（不含 iter1-8 tool transcript）。玩家本回合输入已是 cleanPrior
    // 末条 user，不重复带入。结算文本由 _runSettlementIteration 暴露（crash 时为空）。
    const settlementText = this._lastSettlementSummaryText || '';
    const tailParts = [
      `## 本回合已定稿的叙事（基于它生成选项）\n\n${narrativeAccumulator || '（本回合无叙事产出）'}`,
    ];
    if (settlementText) tailParts.push(`## 本回合结算结果\n\n${settlementText}`);
    tailParts.push('---\n现在调用 update_choices，基于以上叙事与当前世界状态生成 2-4 个玩家行动选项。');
    this.reactLoop.appendUserMessage(iter9MessagesRef, tailParts.join('\n\n'), reactAdapter);

    // iter9 自动重试：根因是 iter8 注入的 [系统结算摘要] 文本里带 【update_panel】
    // 等工具名，弱模型 (v4-flash) 被诱导调了 stage 外工具而非 update_choices →
    // L1 全拒 → 无 choices → 掉 L4 fallback（玩家看到泛用 3 选项）。
    // 这里在"收到响应但没拿到合法 update_choices"（软失败）时自动重试一次，
    // 重试前追加纠偏 user 消息显式点名忽略摘要里的工具名。
    // 不重试的情况：API 异常（402/网络）、abort——重试无意义或不该重试。
    const MAX_ITER9_ATTEMPTS = 2;
    let lastRejectedNames = [];
    let lastCallsAll = [];

    for (let attempt = 0; attempt < MAX_ITER9_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const rejectedHint = lastRejectedNames.length
          ? `（上次错误调用了 ${lastRejectedNames.join('、')}）`
          : '（上次未产出有效选项）';
        const nudge = `⚠️ 重试：上一次没有调用 update_choices${rejectedHint}。`
          + `本回合你唯一能调用的工具是 update_choices，必须且只能调它一次，生成 2-4 个玩家行动选项。`
          + `忽略上文里出现的任何非 update_choices 工具名——那些是状态播报，不是本回合可调用的工具。`;
        this.reactLoop.appendUserMessage(iter9MessagesRef, nudge, reactAdapter);
      }

      const stepLog = {
        step: this.accumulatedStepCount,
        phase: 'react',
        iteration: 9,
        iterationLabel: attempt === 0 ? 'iter9' : `iter9-retry${attempt}`,
        branch: 'main',
        model: reactModel,
        provider: reactLabel,
        request: this._cloneSerializable(iter9Payload.payload),
        url: iter9Payload.url.replace(/key=[^&]+/, 'key=***'),
      };
      this.lastPayload.steps.push(stepLog);
      this._markStepStarted(stepLog);

      let gotResponse = false;  // 收到 API 响应（区分软失败 vs 异常）
      try {
        const apiResult = await reactAdapter.callAPI(
          iter9Payload.url, iter9Payload.payload, null, this._currentAbortSignal
        );
        gotResponse = true;
        stepLog.response = apiResult.raw;
        stepLog.metrics = apiResult.metrics;
        iterationMetrics.push({ iteration: 9, branch: 'main', ...apiResult.metrics });
        this._markStepSucceeded(stepLog);

        const { toolCalls: callsAll } = reactAdapter.parseToolCalls(apiResult.raw);
        lastCallsAll = callsAll;

        // L1: 白名单过滤 hallucinated 工具
        const ALLOWED_TOOLS = new Set(['update_choices']);
        const calls = callsAll.filter(c => ALLOWED_TOOLS.has(c.name));
        const rejected = callsAll.filter(c => !ALLOWED_TOOLS.has(c.name));
        lastRejectedNames = rejected.map(c => c.name);
        if (rejected.length > 0) {
          stepLog.rejectedHallucinations = rejected.map(c => ({ name: c.name, args: c.args || {} }));
          console.warn(
            `[Agent] iter 9${attempt ? `(retry${attempt})` : ''}：拒掉 ${rejected.length} 个 stage 外 hallucinate 调用 (${lastRejectedNames.join(', ')})`
          );
        }

        // L2: 逐条验证 choices；失败用占位字段兜底
        const ucCall = calls.find(c => c.name === 'update_choices');
        if (ucCall) {
          const rawChoices = Array.isArray(ucCall.args?.choices) ? ucCall.args.choices : [];
          const salvaged = [];
          for (let idx = 0; idx < rawChoices.length; idx++) {
            const validation = this._normalizeAndValidateChoiceObject(rawChoices[idx], {
              requireId: false,
              index: idx,
            });
            if (validation.isValid) {
              salvaged.push(validation.choice);
            } else {
              const raw = rawChoices[idx] || {};
              const shortText = raw.short_text || raw.text || `选项 ${idx + 1}`;
              const rawDetail = typeof raw.detail_text === 'string' ? raw.detail_text.trim() : '';
              const fallback = {
                id: raw.id || String.fromCharCode(65 + idx),
                type_tag: raw.type_tag || 'action',
                short_text: shortText,
                detail_text: rawDetail || shortText,
                cost_hint: (typeof raw.cost_hint === 'string' && raw.cost_hint.trim()) ? raw.cost_hint : '待定',
                effect_days: typeof raw.effect_days === 'number' ? raw.effect_days : 0,
              };
              console.warn(`[Agent] iter 9: choice #${idx} 验证失败 (${validation.reason})，使用占位符`);
              salvaged.push(fallback);
            }
          }
          choicesData = salvaged;
          console.log(`[Agent] iter 9${attempt ? `(retry${attempt})` : ''} 成功: ${choicesData.length} 个选项`);
        } else {
          console.warn('[Agent] iter 9：AI 仍未调用 update_choices');
        }
      } catch (e) {
        this._markStepFailure(stepLog, e, {
          phase: 'react',
          module: 'react',
          provider: reactLabel,
          model: reactModel,
          url: iter9Payload.url,
        });
        console.warn('[Agent] iter 9 API 调用失败:', e);
        if (window.eventBus && window.GameEvents?.AI_ERROR) {
          // 优先传 _markStepFailure 已挂的结构化 unifiedErrorInfo (含 httpStatus /
          // providerErrorCode 等)，让 analytics ai.error_detail 收到结构化字段而非
          // 字符串拼接 (bug-0004 调查发现 errorInfo 被字符串化导致 402 余额错误无
          // 法按 httpStatus 分类)。fallback 保留字符串以兼容老路径。
          window.eventBus.emit(window.GameEvents.AI_ERROR, {
            error: e,
            errorInfo: e?.unifiedErrorInfo || e?.errorInfo || stepLog?.errorInfo
              || `iter 9 API 调用失败: ${e?.message || String(e)}`,
            traceId: this.lastPayload?.traceId,
            failedPhase: 'react',
          });
        }
        // 异常不重试 → 落到 L4 兜底
      }

      if (choicesData.length > 0) break;                       // 成功 → 结束
      if (!gotResponse) break;                                  // 异常 → 不重试，落 L4
      if (this._currentAbortSignal?.aborted) break;             // 已中止 → 不重试
      if (attempt + 1 < MAX_ITER9_ATTEMPTS) {
        console.warn(`[Agent] iter 9 软失败（无合法 update_choices）→ 自动重试 ${attempt + 1}/${MAX_ITER9_ATTEMPTS - 1}`);
      }
    }

    // L3: hallucinated update_narrative 文本 salvage（基于最后一次 attempt 的产物，
    // 不当工具执行——避免破坏 tool_call_id 配对，但 AI 已生成的文本不浪费）
    const narHallucinated = lastCallsAll.find(c => c.name === 'update_narrative');
    if (narHallucinated) {
      const rawNarText = narHallucinated.args?.text || '';
      const narText = this._dedupeNarrativePrefix(narrativeAccumulator, rawNarText);
      // L1 治本主战场：iter9 L3 把上一次 attempt 的 update_narrative 又捞出来，
      // 若该归一化全文本回合已 emit 过（iter7.rescue 已渲染，dedupe 没吃干净）→
      // 累加/push/emit 三者一起跳过，杜绝 accumulator 二次污染 + 屏幕重复。
      if (narText && this._shouldEmitNarrative(narrativeEmitGuard, narText, {
        iteration: 9, iterationLabel: 'iter9.L3', reason: 'iter9-hallucinated',
      })) {
        narrativeAccumulator += narText;
        reactIterationSegments.push({ type: 'narrative', iteration: 9, text: narText, hallucinated: true });
        if (window.eventBus && window.GameEvents) {
          window.eventBus.emit(window.GameEvents.AI_NARRATIVE_DISPLAY, {
            text: narText,
            accumulated: narrativeAccumulator,
            iteration: 9,
          });
        }
      }
    }

    // L4: 终极兜底 —— 仍无 choices → 注入 3 个泛用预设
    if (choicesData.length === 0) {
      console.warn('[Agent] iter 9 兜底 → 注入泛用 fallback choices 保证 turn 能收尾');
      choicesData = [
        {
          id: 'A',
          type_tag: 'explore',
          short_text: '观察四周',
          detail_text: '环顾当前所在的环境，留意身边的人和事，看看有什么值得注意的。',
          cost_hint: '无',
          effect_days: 0,
        },
        {
          id: 'B',
          type_tag: 'talk',
          short_text: '主动搭话',
          detail_text: '走向一个看起来好接近的人，找个由头聊上几句，看能打听到什么。',
          cost_hint: '无',
          effect_days: 0,
        },
        {
          id: 'C',
          type_tag: 'action',
          short_text: '稍作休整',
          detail_text: '原地停顿片刻，整理思绪和身上的物件，思考下一步该往哪去。',
          cost_hint: '无',
          effect_days: 0,
        },
      ];
      if (this.lastPayload) {
        this.lastPayload.fallbackChoicesUsed = true;
      }
    }

    // 同步 iter 9 到 lastFunctionCalls + reactIterationSegments，让主气泡推理时间线显示 IX
    // status: 'executed' / 'fallback'（区分真 update_choices 调用 vs L4 兜底）
    const iter9Status = this.lastPayload?.fallbackChoicesUsed ? 'fallback' : 'executed';
    const iter9Calls = [{
      name: 'update_choices',
      args: { choices: choicesData },
      status: iter9Status,
      result: JSON.stringify({ count: choicesData.length, fallback: iter9Status === 'fallback' }),
    }];
    if (!this.lastFunctionCalls) this.lastFunctionCalls = [];
    this.lastFunctionCalls.push({
      step: this.accumulatedStepCount,
      iteration: 9,
      iterationLabel: 'iter9',
      branch: 'main',
      calls: iter9Calls,
    });
    if (Array.isArray(reactIterationSegments)) {
      reactIterationSegments.push({ type: 'tools', iteration: 9, iterationLabel: 'iter9' });
    }
    if (window.eventBus && window.GameEvents?.AI_REACT_TOOL_CALL) {
      window.eventBus.emit(window.GameEvents.AI_REACT_TOOL_CALL, {
        iteration: 9,
        iterationLabel: 'iter9',
        calls: iter9Calls,
      });
    }

    return { choicesData, narrativeAccumulator };
  }

  /**
   * 生成 AI 回复(主聊天模块)
   * Step 完成通知通过 EventBus 广播（AI_REACT_COMPLETE, AI_NARRATIVE_DISPLAY, AI_NARRATIVE_COMPLETE, AI_STEP3_COMPLETE）
   * @param {Array} history - 对话历史
   * @param {Function} onChunk - 流式输出回调（高频），每收到一个 chunk 调用一次 onChunk(accumulatedText)
   * @returns {Promise<string>} 完整的 AI 回复
   */
  async generateResponse(history, onChunk = null, options = {}) {
    // OOC Q&A 元消息不应出现在发给 NPC/GM/ReAct 的上下文中——它们是玩家与 subagent 的元对话
    if (Array.isArray(history) && history.some(m => m?.meta === 'ooc_qa')) {
      history = history.filter(m => m?.meta !== 'ooc_qa');
    }

    // 🔧 启动后台保活（iOS 后台运行支持）
    if (window.backgroundService) {
      await window.backgroundService.startAITask();
    }

    const requestContext = this._buildActiveRequestContext();
    this._activeRequestContext = requestContext;
    this._requestInFlight = true;

    try {
      // 检查核心模块的 API Key
      const missingKeys = [];

      ['react'].forEach(step => {
        const config = this.getModuleConfig(step, AI_REQUEST_SCOPED);
        const apiKey = this.getApiKeyForModule(step, AI_REQUEST_SCOPED);
        if (!apiKey) {
          missingKeys.push(`${step}(${config.provider})`);
        }
      });

      if (missingKeys.length > 0) {
        // 停止后台任务（API Key 未设置）
        if (window.backgroundService) {
          await window.backgroundService.finishAITask(false, 'API Key 未设置');
        }
        const missingKeyError = new Error(
          `以下模块的 API Key 未设置:${missingKeys.join(', ')}。请点击右上角齿轮图标进行设置。`
        );
        missingKeyError.apiErrorInfo = {
          errorType: 'unknown',
          provider: 'config',
          responseBody: { missingModules: missingKeys },
        };

        // API Key 校验失败发生在 workflow 前，这里手动初始化最小调试 payload
        this.lastPayload = {
          provider: 'multi-step-agent',
          traceId: this._generateTraceId(),
          failedPhase: null,
          errorInfo: null,
          models: {
            react: this.getModelForModule('react', AI_REQUEST_SCOPED),
          },
          steps: [],
        };

        const keyErrorInfo = this._buildUnifiedErrorInfo(missingKeyError, {
          traceId: this.lastPayload.traceId,
          phase: 'react',
          module: 'react',
          provider: 'config',
          model: this.getModelForModule('react', AI_REQUEST_SCOPED),
          responseBody: { missingModules: missingKeys },
        });

        this._markPayloadFailure('react', keyErrorInfo);
        missingKeyError.unifiedErrorInfo = keyErrorInfo;
        missingKeyError.errorInfo = keyErrorInfo;
        missingKeyError.traceId = keyErrorInfo.traceId;
        missingKeyError.failedPhase = keyErrorInfo.phase;

        throw missingKeyError;
      }

      // formatMessages 现在返回 { systemContext, messages }
      const { systemContext, messages } = this.formatMessages(history);

      // 如果开启流式输出且提供了回调，使用流式模式
      const useStream =
        this._getConfigSource(AI_REQUEST_SCOPED).useStreaming && typeof onChunk === 'function';

      // 创建请求级 AbortController，支持外部取消
      this._requestAbortController = new AbortController();

      // 使用新的策略模式架构(每个 step 在 _runAgentWorkflow 内部获取各自的 adapter)
      // Step 完成通知通过 EventBus 广播，不再传递回调
      const result = await this._runAgentWorkflow(
        messages,
        useStream ? onChunk : null,
        systemContext,
        options.actionClassification || null,
        options.ooc || null,
        this._requestAbortController.signal
      );

      // 成功：短信标记在_runAgentWorkflow内部已处理

      // 🔧 完成后台任务，发送通知（await 确保通知发出）
      if (window.backgroundService) {
        await window.backgroundService.finishAITask(true, 'AI 已生成完整回复');
      }

      this._lastResponseConfigSnapshot = this._cloneSerializable(requestContext.configSnapshot);
      this.clearPendingPlayerActionContext();
      return result;
    } catch (error) {
      const lastStepPhase =
        this.lastPayload?.steps?.[this.lastPayload.steps.length - 1]?.phase || null;
      const phase =
        error?.failedPhase || this.lastPayload?.failedPhase || lastStepPhase || 'unknown';
      const moduleName = this._phaseToModule(phase);
      const provider = moduleName ? this.getProviderForModule(moduleName, AI_REQUEST_SCOPED) : null;
      const model = moduleName ? this.getModelForModule(moduleName, AI_REQUEST_SCOPED) : null;
      const fallbackInfo =
        error?.unifiedErrorInfo ||
        this.lastPayload?.errorInfo ||
        this._buildUnifiedErrorInfo(error, {
          traceId: this.lastPayload?.traceId,
          phase,
          module: moduleName,
          provider,
          model,
        });

      error.unifiedErrorInfo = fallbackInfo;
      error.errorInfo = fallbackInfo;
      error.traceId = fallbackInfo.traceId;
      error.failedPhase = fallbackInfo.phase;

      if (this.lastPayload && !this.lastPayload.errorInfo) {
        this._markPayloadFailure(fallbackInfo.phase, fallbackInfo);
      }

      // 🔧 Bug修复：失败时清理短信注入标志
      if (this._pendingSmsInjection) {
        console.warn('[AIService] 请求失败，短信保持new状态供下次注入');
        this._pendingSmsInjection = false;
        this._pendingSmsTurnNumber = null;
      }

      if (this._pendingEventToMark) {
        console.warn('[AIService] 请求失败，清理待标记 GM 事件');
        this._pendingEventToMark = null;
      }

      // 🔧 失败时也要停止后台任务并通知（await 确保通知发出）
      if (window.backgroundService) {
        console.log('[AIService] AI 请求失败，调用 finishAITask');
        await window.backgroundService.finishAITask(false, error.message || '请求失败');
      }

      this.clearPendingPlayerActionContext();
      // 重新抛出异常，让上层（chatCore.js）处理
      throw error;
    } finally {
      this._requestAbortController = null;
      this._requestInFlight = false;
      this._activeRequestContext = null;
    }
  }

  // 生成一句话总结(总结模块)
  async generateSummary(text) {
    const moduleConfig = this.getModuleConfig('summary', AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule('summary', AI_REQUEST_SCOPED);
    const locale = this._getGamePromptLanguage();
    // 通过 promptRegistry 装配；fallback 到原 SUMMARY_PROMPT
    let summaryPrompt;
    if (window.promptRegistry) {
      const { parts } = window.promptRegistry.assembleChannel('summary', { locale });
      summaryPrompt =
        parts.map(p => p.text).join('\n') ||
        this._getLocalizedGlobalPromptValue('SUMMARY_PROMPT', locale) ||
        SUMMARY_PROMPT;
    } else {
      summaryPrompt =
        this._getLocalizedGlobalPromptValue('SUMMARY_PROMPT', locale) || SUMMARY_PROMPT;
    }

    if (!apiKey) {
      throw new Error(`总结模块的 ${moduleConfig.provider} API Key 未设置`);
    }

    // SUMMARY_PROMPT 作为系统指令，text 作为用户输入
    const userMessage =
      locale === 'en'
        ? `**[System Ready] Please summarize the following text:**\n\n${text}`
        : `**[系统就绪] 请输入待处理文本:**\n\n${text}`;
    const messages = [{ role: 'user', content: userMessage }];

    return this._callSummaryAPI(messages, summaryPrompt, 'summary');
  }

  // 生成章节总结(章节模块)
  // @param {string[]} turnSummaries - 单轮总结文本数组
  async generateChapterSummary(turnSummaries) {
    const moduleConfig = this.getModuleConfig('chapter', AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule('chapter', AI_REQUEST_SCOPED);
    const locale = this._getGamePromptLanguage();
    let chapterPrompt;
    if (window.promptRegistry) {
      const { parts } = window.promptRegistry.assembleChannel('chapterSummary', { locale });
      chapterPrompt =
        parts.map(p => p.text).join('\n') ||
        this._getLocalizedGlobalPromptValue('CHAPTER_SUMMARY_PROMPT', locale) ||
        CHAPTER_SUMMARY_PROMPT;
    } else {
      chapterPrompt =
        this._getLocalizedGlobalPromptValue('CHAPTER_SUMMARY_PROMPT', locale) ||
        CHAPTER_SUMMARY_PROMPT;
    }

    if (!apiKey) {
      throw new Error(`章节模块的 ${moduleConfig.provider} API Key 未设置`);
    }

    // 将单轮总结格式化为带编号的列表
    const formattedInput = turnSummaries.map((text, idx) => `T${idx + 1}: ${text}`).join('\n');

    const userMessage =
      locale === 'en'
        ? `**[Chapter Compression] Merge these ${turnSummaries.length} turn summaries into one chapter summary:**\n\n${formattedInput}`
        : `**[章节压缩任务] 请将以下${turnSummaries.length}条剧情摘要合并为一段章节概要:**\n\n${formattedInput}`;
    const messages = [{ role: 'user', content: userMessage }];

    return this._callSummaryAPI(messages, chapterPrompt, 'chapter');
  }

  // 生成短信回复(短信模块)
  // @param {string} contactId - 联系人ID(如 'elena')
  // @param {string} message - 玩家发送的短信
  // @param {Array} history - 短信历史记录 [{role: 'user'|'assistant', content: string}]
  async generateSMSReply(contactId, message, history = []) {
    const moduleConfig = this.getModuleConfig('sms', AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule('sms', AI_REQUEST_SCOPED);
    const locale = this._getGamePromptLanguage();
    let smsPrompt;
    if (window.promptRegistry) {
      const { parts } = window.promptRegistry.assembleChannel('sms', { locale });
      smsPrompt =
        parts.map(p => p.text).join('\n') ||
        this._getLocalizedGlobalPromptValue('SMS_PROMPT', locale) ||
        SMS_PROMPT;
    } else {
      smsPrompt = this._getLocalizedGlobalPromptValue('SMS_PROMPT', locale) || SMS_PROMPT;
    }

    if (!apiKey) {
      throw new Error(`短信模块的 ${moduleConfig.provider} API Key 未设置`);
    }

    // 获取联系人配置(支持预定义角色和临时角色，自动填充动态字段)
    const contact = this._getContactWithDynamicState(contactId, this._getCurrentGameTime());
    if (!contact) {
      throw new Error('未知联系人: ' + contactId);
    }
    const isDynamic = contact.type === 'dynamic';
    const currentCognitiveState = contact.cognitive_state;

    // 获取当前关系(从短信历史中的最新 AI 回复获取，或使用默认值)
    const currentRelationship = this._getCurrentRelationship(
      contactId,
      history,
      contact.default_relationship
    );

    // 构建系统提示词各部分(分开便于 API 分别处理)
    // 临时角色:不使用预设的性格和回复风格，而是从主聊天历史中学习
    // 预定义角色:使用预设的性格和回复风格
    let characterInfo;
    let recentStoryContext = ''; // 临时角色的最近剧情原文参考

    if (isDynamic) {
      // 临时角色:只提供基本信息，不提供性格和回复风格
      characterInfo = `## 当前角色
- 名字: ${contact.name}
- 年龄: ${contact.age || '未知'}
- 当前认知状态: ${currentCognitiveState}
- 当前关系: ${currentRelationship}`;
      if (contact.appearance) characterInfo += `\n- 外貌: ${contact.appearance}`;
      if (contact.clothing) characterInfo += `\n- 衣着: ${contact.clothing}`;

      // 获取最后两次 AI 回复的完整文本作为风格参考
      const recentReplies = this._getRecentAIReplies(2);
      if (recentReplies.length > 0) {
        recentStoryContext = `## 最近的剧情原文(作为${contact.name}说话风格的参考)
请从以下剧情中学习${contact.name}的说话方式和语气，在短信中模仿相同的风格:

${recentReplies.map((text, i) => `--- 剧情片段 ${i + 1} ---\n${text}`).join('\n\n')}`;
      }
    } else {
      // 预定义角色:使用预设的性格和回复风格
      characterInfo = `## 当前角色
- 名字: ${contact.name}
- 年龄: ${contact.age || '未知'}
- 性格: ${contact.personality || '未知'}
- 当前认知状态: ${currentCognitiveState}
- 当前关系: ${currentRelationship}
- 回复风格: ${contact.msg_reply_tone || '普通'}`;
    }

    // 获取当前游戏时间
    let currentTimeInfo = '';
    if (typeof timelineService !== 'undefined') {
      const gameDate = timelineService.getCurrentDate();
      const formattedSmsTime = this._formatGameTimeForPrompt(gameDate);
      if (formattedSmsTime) {
        currentTimeInfo = `## 当前游戏时间\n${formattedSmsTime}`;
      }
    }

    // 获取该角色相关的时间线事件(+/-3个月范围)
    const timelineContext =
      typeof timelineService !== 'undefined' ? timelineService.formatForSMS(contact.name, 3) : '';

    // 获取主聊天的剧情总结(让角色了解"最近发生了什么")
    let storySummaryContext = '';
    if (typeof summaryService !== 'undefined') {
      const summaries = summaryService.getSummaries();
      if (summaries.length > 0) {
        storySummaryContext = `## 最近的剧情总结\n${summaries.join('\n')}`;
      }
    }

    // 计算消息间隔(距离玩家上一条消息过了多久)
    let timeSinceLastMsgInfo = '';
    if (history.length > 0) {
      // 找到最后一条玩家消息
      const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
      if (lastUserMsg && lastUserMsg.gameTime) {
        const currentTime = this._getCurrentGameTime();
        if (currentTime) {
          const timeDiff = this._calculateGameTimeDiff(lastUserMsg.gameTime, currentTime);
          timeSinceLastMsgInfo = `## 消息间隔\n距离玩家上一条消息: ${timeDiff}`;
        }
      }
    }

    // 构建系统提示词 parts 数组(类似主聊天的 Gemini 格式)
    const systemParts = [smsPrompt, characterInfo];
    if (currentTimeInfo) {
      systemParts.push(currentTimeInfo);
    }
    if (timeSinceLastMsgInfo) {
      systemParts.push(timeSinceLastMsgInfo);
    }
    if (timelineContext) {
      systemParts.push(timelineContext);
    }
    // 先给剧情总结(理解背景和关系)，再给剧情原文(学习说话风格)
    if (storySummaryContext) {
      systemParts.push(storySummaryContext);
    }
    if (recentStoryContext) {
      systemParts.push(recentStoryContext);
    }

    // 构建消息(包含历史 + 新消息，带时间戳)
    // 格式化消息，在内容前加上时间标签让 AI 理解时间流逝
    const reg = window.promptRegistry;
    const formatMsgWithTime = m => {
      // 系统提示消息:添加特殊标记，不算角色发的消息
      if (m.role === 'system') {
        return {
          role: 'user',
          content: reg.get('sms.format.systemMessageTag').builder({ content: m.content }),
        };
      }

      let content = m.content;

      // 添加时间前缀
      if (m.gameTime) {
        const gt = m.gameTime;
        content = reg.get('sms.format.timestampPrefix').builder({
          month: gt.month,
          day: gt.day,
          timeStr: gt.timeStr || '',
          content,
        });
      }

      // 事件驱动的消息添加特殊标记(角色主动发送，玩家未回复不代表是陌生人)
      if (m.isEventDriven) {
        content = reg.get('sms.format.eventDrivenTag').builder({ content });
      }

      return { role: m.role, content };
    };

    const messages = [
      ...history.map(formatMsgWithTime),
      formatMsgWithTime({ role: 'user', content: message, gameTime: this._getCurrentGameTime() }),
    ];

    // 保存 payload 以供调试
    this.lastSMSPayload = {
      contactId,
      isDynamic: isDynamic,
      contact: {
        name: contact.name,
        age: contact.age,
        personality: contact.personality, // 临时角色可能没有
        msg_reply_tone: contact.msg_reply_tone, // 临时角色没有
      },
      characterInfo: characterInfo,
      recentStoryContext: recentStoryContext || null, // 临时角色的最近剧情原文
      currentTimeInfo: currentTimeInfo,
      timeSinceLastMsgInfo: timeSinceLastMsgInfo,
      timelineContext: timelineContext,
      storySummaryContext: storySummaryContext,
      systemParts: systemParts,
      messages: messages,
    };

    // 调用 API 获取回复
    const rawReply = await this._callSMSAPI(messages, systemParts);

    // 解析 JSON 格式的回复
    const parsedResponse = this._parseSMSResponse(rawReply);

    // 将解析结果保存到 payload 中用于调试
    this.lastSMSPayload.response = {
      raw: rawReply,
      parsed: {
        location: parsedResponse.location,
        cognitive_state: parsedResponse.cognitive_state,
        relationship: parsedResponse.relationship,
        message: parsedResponse.message,
      },
      parseError: parsedResponse.parseError || null,
    };

    return parsedResponse;
  }

  // 解析 SMS 回复的 JSON 格式
  _parseSMSResponse(rawReply) {
    try {
      // 尝试从回复中提取 JSON(可能被 markdown 代码块包裹)
      let jsonStr = rawReply.trim();

      // 移除 markdown 代码块标记
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      }

      const parsed = JSON.parse(jsonStr);

      // 验证必需字段
      if (!parsed.message) {
        throw new Error('Missing message field');
      }

      return {
        location: parsed.location || '未知',
        cognitive_state: parsed.cognitive_state || '未知',
        relationship: parsed.relationship || '未知',
        message: parsed.message,
        raw: rawReply, // 保留原始回复用于调试
      };
    } catch (e) {
      // JSON 解析失败，回退到直接使用原始回复作为消息
      console.warn('SMS JSON parse failed, using raw reply:', e);
      return {
        location: '未知',
        cognitive_state: '未知',
        relationship: '未知',
        message: rawReply.trim(),
        raw: rawReply,
        parseError: e.message,
      };
    }
  }

  // 获取当前关系(从短信历史或 smsService 中获取最新的关系)
  _getCurrentRelationship(contactId, history, defaultRelationship) {
    // 1. 优先从 smsService 中获取完整历史(包含 relationship 字段)
    if (typeof smsService !== 'undefined') {
      const fullHistory = smsService.getConversation(contactId);
      if (fullHistory && fullHistory.length > 0) {
        // 从后往前找到最近一条有 relationship 的 AI 回复
        for (let i = fullHistory.length - 1; i >= 0; i--) {
          const msg = fullHistory[i];
          if (msg.role === 'assistant' && msg.relationship && msg.relationship !== '未知') {
            return msg.relationship;
          }
        }
      }
    }

    // 2. 从传入的 history 中查找(API 调用时的历史)
    if (history && history.length > 0) {
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role === 'assistant' && msg.relationship && msg.relationship !== '未知') {
          return msg.relationship;
        }
      }
    }

    // 3. 使用默认值
    return defaultRelationship || '陌生人';
  }

  // ── 模型 capability memo ──────────────────────────
  // 当 ReAct 在某个模型上明确以 'no_function_calling' 失败后, 把模型名记入 localStorage,
  // 下次同一模型进 ReAct 入口时直接早抛同款错误。避免用户重复撞 8 次才意识到要换模型。
  // 切到支持的模型即不受影响 (memo 不会拦截支持的)。

  // memo entry 格式：`provider::model`，避免不同 provider 上同名 model 互踩
  // (e.g. 自定义 provider1 的 "gpt-4" 跟 自定义 provider2 的 "gpt-4" 是两个独立 entry)
  _capabilityMemoKey() { return 'sandbox.incompatible_react_models'; }
  _capabilityMemoEntry(provider, model) {
    if (!provider || !model) return null;
    return `${provider}::${model}`;
  }

  _isModelKnownNoFunctionCalling(provider, model) {
    const entry = this._capabilityMemoEntry(provider, model);
    if (!entry) return false;
    try {
      const raw = localStorage.getItem(this._capabilityMemoKey()) || '';
      if (!raw) return false;
      return raw.split(',').filter(Boolean).includes(entry);
    } catch (_) { return false; }
  }

  _rememberModelNoFunctionCalling(provider, model) {
    const entry = this._capabilityMemoEntry(provider, model);
    if (!entry) return;
    try {
      const key = this._capabilityMemoKey();
      const raw = localStorage.getItem(key) || '';
      const set = new Set(raw.split(',').filter(Boolean));
      if (set.has(entry)) return;
      set.add(entry);
      localStorage.setItem(key, [...set].join(','));
    } catch (_) { /* swallow — memo failure is non-fatal */ }
  }

  // 是否在当前 stage / 当前 adapter 的 provider 上注入 server-side 联网搜索工具。
  // 总开关取自 aiService.config.webSearchEnabled；
  // 只在叙事写作 iter（iter1/6/7）注入，reads/mutations/choices/SMS 等 stage 不注入；
  // OpenAI（Chat Completions 协议无 tools-数组形式搜索）/ Grok（Live Search 已退役）/ DeepSeek（无原生）
  // 都不在支持列表里，静默忽略 —— UI 上每家行尾 badge 自解释。
  _shouldEnableWebSearchForStage(stage, adapter) {
    if (!this.isWebSearchEnabled?.()) return false;
    const WEBSEARCH_STAGES = [
      'narrative_only',
      'narrative_with_item',
      'narrative_only_closing',
      'closing_resolve',
    ];
    if (!WEBSEARCH_STAGES.includes(stage)) return false;
    const WEBSEARCH_SUPPORTED_PROVIDERS = ['anthropic', 'gemini'];
    return WEBSEARCH_SUPPORTED_PROVIDERS.includes(adapter?.provider);
  }

}

// schema_v2 一次性迁移：v1 memo 是裸 model 字符串列表，没有 provider 信息且
// 包含 bug-0004 修复前被错判写入的 builtin provider 伪阳性条目（"deepseek-v4-pro"
// 等支持 fc 但被误标的模型）。直接清空让用户在新逻辑下重新积累——新逻辑只会在
// 自定义 provider + 真阳性条件下写入，且 entry 格式是 "provider::model" 全路径。
(function _migrateCapabilityMemoToV2() {
  try {
    if (typeof localStorage === 'undefined') return;
    const SCHEMA_KEY = 'sandbox.incompatible_react_models.schema_version';
    if (localStorage.getItem(SCHEMA_KEY) === '2') return;
    localStorage.removeItem('sandbox.incompatible_react_models');
    localStorage.setItem(SCHEMA_KEY, '2');
  } catch (_) { /* swallow */ }
})();

_applyAIServiceMixin(_AIServiceReactMixin);

// promptRegistry 注册已抽出到 js/services/ai/reactPromptBootstrap.js
