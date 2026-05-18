// ============================================
// AI Service - API 调用服务
// ============================================
// 全局变量(来自 [Fixed]core_prompt.js):
// - CORE_PROMPT_MERGED: ReAct 合并 Prompt（工具调用+叙事创作）
// - CORE_PROMPT_NPC_REACTION: NPC 独立反应
// ============================================
// Adapter 类定义在 aiAdapters.js 中
// ============================================

// 历史遗留字段：用于覆写 core prompt（现已禁止）
const LEGACY_CORE_PROMPT_FIELDS = [
  'customStep1Prompt',
  'customStep2CorePrompt',
  'customEditorCorePrompt',
  'customStep3CorePrompt',
  'step1_prompt',
  'step2_core_prompt',
  'editor_core_prompt',
  'step3_core_prompt',
  'custom_step1_prompt',
  'custom_step2_core_prompt',
  'custom_editor_core_prompt',
  'custom_step3_core_prompt',
  'customGreeting',
  'customInitModule',
];

const THEME_MODES = new Set(['light', 'dark']);
const BG_MODES = new Set(['solid', 'parchment', 'world-card', 'custom']);

const UI_SCALE_MODES = new Set(['auto', 'manual']);
const UI_LANGUAGES = new Set(['auto', 'zh-CN', 'en']);
const UI_SCALE_MIN = 0.9;
const UI_SCALE_MAX = 1.4;
const REACT_FUNCTION_GROUP = {
  RESIDENT: 'resident',
};
const BUILTIN_PROVIDER_DEFAULT_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-5.5',
  grok: 'grok-4.3',
  anthropic: 'claude-sonnet-4-6',
  siliconflow: 'deepseek-ai/DeepSeek-V4-Flash',
};

const DEEPSEEK_THINKING_LEVELS = Object.freeze(['off', 'high', 'max']);
const DEEPSEEK_THINKING_DEFAULT = 'off';

const BUILTIN_PROVIDER_DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com',
  grok: 'https://api.x.ai/v1',
  siliconflow: 'https://api.siliconflow.cn/v1',
};
const REQUIRED_MODULES = Object.freeze([
  'react',
  'sms',
  'summary',
  'chapter',
  'design',
]);
const MODULE_DEFAULT_CONFIGS = Object.freeze({
  react: Object.freeze({ provider: 'deepseek', model: 'deepseek-v4-flash', thinking: DEEPSEEK_THINKING_DEFAULT }),
  sms: Object.freeze({ provider: 'deepseek', model: 'deepseek-v4-flash', thinking: DEEPSEEK_THINKING_DEFAULT }),
  summary: Object.freeze({ provider: 'deepseek', model: 'deepseek-v4-flash', thinking: DEEPSEEK_THINKING_DEFAULT }),
  chapter: Object.freeze({ provider: 'deepseek', model: 'deepseek-v4-flash', thinking: DEEPSEEK_THINKING_DEFAULT }),
  design: Object.freeze({ provider: 'deepseek', model: 'deepseek-v4-flash', thinking: DEEPSEEK_THINKING_DEFAULT }),
});

// 推荐模式 per-iter / per-phase 路由表。Provider 恒为内置 'deepseek'。
// 完整理由 + 调整原则见 docs/RECOMMENDED_PHASE_MAP.md。
//
// 关键约束（aiAdapters.js:1101-1116 的 forced-tool gate）：
//   thinking='enabled' + tool_choice ∈ {'required', {type:'function'}} → DeepSeek 服务端拒。
//   adapter 层会自动降级 thinking → disabled 保留工具硬约束。
//   ⇒ forced tool_choice 的 iter 槽（1 / 6 / 7 / 8.panel / 9）thinking 必须 off。
//   ⇒ tool_choice='auto' 或 JSON-only 输出（无 function tool）的 iter 槽可放 thinking。
const RECOMMENDED_PHASE_MAP = Object.freeze({
  // ReAct 主回合（per-iter）
  iter1_narrative:  Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'off'  }),
  iter2_4_reads:    Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),
  iter5_mutations:  Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'off'  }),
  iter6_narrative:  Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'off'  }),
  iter7_closing:    Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'off'  }),
  iter8_settlement: Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),
  iter9_choices:    Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),

  // ReAct 周边（per-turn 但不在主 iter 链上；都是 JSON-only 无 function tool）
  npc_reaction:     Object.freeze({ model: 'deepseek-v4-flash', thinking: 'max'  }),
  ooc_normalizer:   Object.freeze({ model: 'deepseek-v4-flash', thinking: 'max'  }),
  // him（NPC 登场审计）：有 function tool 但 toolChoice='auto'，按上方规则可放 thinking。
  npc_intro_audit:  Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'max'  }),
  action_classify:  Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),
  map_naming:       Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),

  // 其他 phase
  sms:     Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),
  summary: Object.freeze({ model: 'deepseek-v4-flash', thinking: 'high' }),
  chapter: Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),
  p1:      Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'max'  }),
  p2:      Object.freeze({ model: 'deepseek-v4-pro',   thinking: 'max'  }),
  p3:      Object.freeze({ model: 'deepseek-v4-flash', thinking: 'max'  }),
  repair:  Object.freeze({ model: 'deepseek-v4-flash', thinking: 'off'  }),
});

// 推荐模式下，已废弃的 'react' 大类入口需要兜底到具体 iter 配置（典型场景：
// generateResponse 启动前的 API key 检查、telemetry 标签、UI label 显示）。
// 走 iter1_narrative（叙事 spine）作为代表性配置——provider/key 与所有 iter 共享。
const RECOMMENDED_REACT_FALLBACK_KEY = 'iter1_narrative';

// 官方 DeepSeek cache-miss 价格（$ / 1M tokens）。推荐模式合成配置时查这里写入
// priceIn/priceOut。完整说明见 docs/DEEPSEEK_PRICING.md。
const OFFICIAL_DEEPSEEK_PRICES = Object.freeze({
  'deepseek-v4-flash': Object.freeze({ in: 0.14,  out: 0.28 }),
  'deepseek-v4-pro':   Object.freeze({ in: 0.435, out: 0.87 }),
});
const STEP3_SCHEMA_SUPPORTED_PROVIDERS = new Set(['gemini', 'openai', 'grok', 'anthropic']);
const AI_SERVICE_STEP3_CHOICE_RULES =
  typeof window !== 'undefined' && window.STEP3_CHOICE_RULES ? window.STEP3_CHOICE_RULES : null;
const STEP3_CHOICE_IDS = Object.freeze(['A', 'B', 'C']);
const STEP3_CHOICE_TYPES = Object.freeze(
  Array.isArray(AI_SERVICE_STEP3_CHOICE_RULES?.typeValues) &&
    AI_SERVICE_STEP3_CHOICE_RULES.typeValues.length > 0
    ? [...AI_SERVICE_STEP3_CHOICE_RULES.typeValues]
    : ['explore', 'trade', 'travel', 'work', 'talk', 'action']
);
const STEP3_CHOICE_TYPE_TAGS = new Set(STEP3_CHOICE_TYPES);
const STEP3_CHOICE_TIME_EFFECTS = new Set(['low', 'medium', 'high', 'extra']);
const STEP3_CHOICE_TIME_EFFECT_RULES = Object.freeze({
  low: Object.freeze({ min: 5, max: 30 }),
  medium: Object.freeze({ min: 31, max: 300 }),
  high: Object.freeze({ min: 301, max: 1440 }),
  extra: Object.freeze({ min: 1441, max: null }),
});
const STEP3_CHOICE_TYPE_TIME_MATRIX = Object.freeze(
  AI_SERVICE_STEP3_CHOICE_RULES?.timeMatrix || {
    explore: 'medium',
    trade: 'low',
    travel: 'extra',
    work: 'extra',
    talk: 'low',
    action: 'low',
  }
);
const STEP3_CHOICE_DAY_TYPES = new Set(
  AI_SERVICE_STEP3_CHOICE_RULES?.dayTypes || ['travel', 'work']
);
const AI_REQUEST_SCOPED = Object.freeze({ requestScoped: true });
window.AI_REQUEST_SCOPED = AI_REQUEST_SCOPED;

// ============================================
// AIService 主类
// ============================================
//
// 文件入口导航（ReAct 工作流相关）：
//   • _runAgentWorkflow         — 并行 ReAct pipeline 编排（iter 1.A‖2-4.B → iter 5/6/7 → iter 8/9）
//   • _runReactIteration        — iter 1-7 单 stage 执行（含工具调用 + 消息追加）
//   • _runSettlementIteration   — iter 8（panelSkill ‖ inventorySkill 并发，注回结算摘要）
//   • _runChoicesIteration      — iter 9（仅 update_choices 工具 + 4 层 salvage）
//   • _executeReactTools        — 一轮内的工具调用执行
//   • this.reactLoop            (constructor 内) — ReactLoop 实例，提供 buildAdapterTools / appendUserMessage
//   • window.skillDispatcher    — iter 8 的 subagent 并发调度器（外部模块）
//

class AIService {
  constructor() {
    this.config = this.loadConfig();
    this.lastPayload = null; // 保存最后一次请求的 payload 用于调试
    this.lastSummaryPayload = null; // 保存最后一次总结请求的 payload
    this.lastDesignPayload = null; // 保存最后一次世界卡请求的 payload
    this.lastSMSPayload = null; // 保存最后一次短信请求的 payload
    this.lastFunctionCalls = null; // 保存最后一次请求的 function calls
    this.lastReasoningContents = []; // 保存 DeepSeek Reasoner 的推理过程(数组，包含多个阶段)
    this.lastRequestMetrics = null; // 保存最后一次请求的时间指标 (TTFT, 总时间等)
    this.lastNarrativeText = null; // 保存生成的叙事文本(供 summary 等服务使用)
    this.lastNarrativeOnly = null; // Editor 分离后的纯叙事（不含选项）
    this.lastStep2Choices = null; // Editor 分离出的选项文本
    this.lastChoicesData = null; // update_choices 工具调用的原始结构化选项数据

    // AbortController（用于取消正在进行的请求）
    this._requestAbortController = null;
    this._requestInFlight = false;
    this._activeRequestContext = null;
    this._lastResponseConfigSnapshot = null;
    this._pendingRuntimeWorldActivation = null;

    // ========================================
    // GM 决策层相关
    // ========================================
    this._pendingEventToMark = null; // 待标记的事件（等待叙事完成后再标记）
    this.lastGMPayload = null; // GM 请求的 payload 用于调试
    this._activeOpeningTimeContext = null; // 首轮随机/推荐开局的已选定时间
    this._openingMoneyContext = null; // 首轮开局金额缓存（首轮固定，直到落盘）
    this._pendingPlayerActionContext = null; // 本回合待执行动作（用于代码结算时间/金钱）
    this._pendingPlayerItemActions = []; // 玩家在本回合开始前对物品的主动动作（消耗/丢弃），下回合 prompt 注入
    this._pendingOoc = null; // 本回合 OOC 写作准则（【...】或 [...] 候选经 subagent 判真后的成品指令）
    this._oocAnswerHandler = null; // chatCore 注入的"问玩家"回调：(question, ctx) => Promise<{answer}|{skipped:true}>

    // ========================================
    // 模块化子系统（Phase 1: 委托边界）
    // ========================================
    this.promptAssembler = typeof PromptAssembler !== 'undefined' ? new PromptAssembler(this) : null;
    this.openingController = typeof OpeningController !== 'undefined' ? new OpeningController(this) : null;
    this.reactLoop = typeof ReactLoop !== 'undefined' ? new ReactLoop(this) : null;
  }

  // 获取最后一次请求的时间指标
  // 返回: { ttft: number(ms), totalTime: number(ms), steps: [{phase, ttft, totalTime}], timestamp: Date }
  getLastRequestMetrics() {
    return this.lastRequestMetrics;
  }

  // Analytics Phase 5: 子系统 LLM 调用统一上报。一次调用一条 ai.subagent.response 事件
  // （不发独立 request 事件——成本分析只需结果侧；失败靠 ok=false 标记）。
  // subsystem ∈ npc_reaction | npc_card_sync | sms_event | sms_proactive |
  //             summary | settlement_<skill> | design_<phase>
  // metrics 形状同 adapter.callAPI 返回的 result.metrics（含 Phase 2/3 的
  // cacheReadTokens / cacheCreationTokens / stopReason）。
  _trackSubagentCall({
    subsystem,
    parentRequestId = null,
    provider = null,
    model = null,
    durationMs = null,
    metrics = null,
    ok = true,
    errorMessage = null,
  } = {}) {
    try {
      const normFinish = (raw) => {
        if (!raw) return ok ? 'stop' : 'error';
        const r = String(raw).toLowerCase();
        if (['end_turn', 'stop', 'stop_sequence'].includes(r)) return 'stop';
        if (['max_tokens', 'length'].includes(r)) return 'length';
        if (['tool_use', 'tool_calls'].includes(r)) return 'tool_calls';
        if (['safety', 'content_filter', 'recitation', 'blocklist'].includes(r)) return 'content_filter';
        return r;
      };
      let reqId;
      try { reqId = crypto.randomUUID(); }
      catch (_) { reqId = 'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
      const m = metrics || {};
      window.analyticsService?.track?.('ai.subagent.response', {
        request_id: reqId,
        parent_request_id: parentRequestId,
        subsystem,
        provider,
        model,
        duration_ms: durationMs != null ? Math.round(durationMs) : null,
        input_tokens: m.inputTokens ?? null,
        output_tokens: m.outputTokens ?? null,
        cache_read_tokens: m.cacheReadTokens ?? null,
        cache_creation_tokens: m.cacheCreationTokens ?? null,
        finish_reason: ok ? normFinish(m.stopReason) : 'error',
        finish_reason_raw: m.stopReason ?? null,
        ok,
        error_message: errorMessage ? String(errorMessage).slice(0, 256) : null,
      });
    } catch (_) { /* telemetry 绝不能往调用方抛 */ }
  }

  // 获取最后一次的 function calls
  getLastFunctionCalls() {
    return this.lastFunctionCalls;
  }

  // 获取最后一次的 ReAct 交错段落序列
  getLastReactSegments() {
    return this.lastReactSegments || [];
  }

  // 获取最后一次的 reasoning contents (DeepSeek Reasoner 专用)
  // 返回数组: [{ phase: 'react', content: string }]
  getLastReasoningContents() {
    return this.lastReasoningContents;
  }

  // 获取最后一次生成的叙事文本
  getLastNarrativeText() {
    return this.lastNarrativeText;
  }

  // 获取最后一次 Editor 分离的选项文本
  getLastStep2Choices() {
    return this.lastStep2Choices;
  }

  setPendingPlayerActionContext(context = null) {
    this._pendingPlayerActionContext = context ? this._cloneSerializable(context) : null;
  }

  getPendingPlayerActionContext() {
    return this._pendingPlayerActionContext ? this._cloneSerializable(this._pendingPlayerActionContext) : null;
  }

  clearPendingPlayerActionContext() {
    this._pendingPlayerActionContext = null;
    this._pendingPlayerItemActions = [];
    window._currentTurnSettlementHints = null;
  }

  appendPlayerItemActionContext({ verb, itemName, count = 1 } = {}) {
    const trimmedVerb = String(verb || '').trim();
    const trimmedName = String(itemName || '').trim();
    const safeCount = Number.isFinite(Number(count)) && Number(count) > 0 ? parseInt(count) : 1;
    if (!trimmedVerb || !trimmedName) return;
    this._pendingPlayerItemActions.push({ verb: trimmedVerb, itemName: trimmedName, count: safeCount });
  }

  getPendingPlayerItemActions() {
    return this._pendingPlayerItemActions.map(a => ({ ...a }));
  }

  _buildPlayerItemActionsText() {
    if (!this._pendingPlayerItemActions.length) return '';
    const lines = ['## 玩家在本回合开始前的主动物品操作（已发生，请在叙事中体现）', ''];
    for (const a of this._pendingPlayerItemActions) {
      const countTail = a.count > 1 ? ` ×${a.count}` : ''; /* ui-lint-allow: 物品计数乘号 */
      lines.push(`- 玩家${a.verb}了「${a.itemName}」${countTail}`);
    }
    return lines.join('\n');
  }

  setPendingOoc(context = null) {
    this._pendingOoc = context ? this._cloneSerializable(context) : null;
  }

  getPendingOoc() {
    return this._pendingOoc
      ? this._cloneSerializable(this._pendingOoc)
      : null;
  }

  clearPendingOoc() {
    this._pendingOoc = null;
  }

  registerOocAnswerHandler(fn) {
    this._oocAnswerHandler = typeof fn === 'function' ? fn : null;
  }

  unregisterOocAnswerHandler() {
    this._oocAnswerHandler = null;
  }

  async _requestOocAnswer(question) {
    if (typeof this._oocAnswerHandler !== 'function') return { skipped: true };
    try {
      const result = await this._oocAnswerHandler(question, {
        abortSignal: this._currentAbortSignal || null,
      });
      if (!result || typeof result !== 'object') return { skipped: true };
      if (result.skipped) return { skipped: true };
      const answer = typeof result.answer === 'string' ? result.answer.trim() : '';
      if (!answer) return { skipped: true };
      return { answer };
    } catch (e) {
      console.warn('[OOC] answer handler threw:', e?.message || e);
      return { skipped: true };
    }
  }

  _cloneSerializable(value) {
    if (value === null || value === undefined) return value;
    try {
      if (typeof structuredClone === 'function') {
        return structuredClone(value);
      }
    } catch (_error) {
      // ignore
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return value;
    }
  }

  _buildRequestRuntimeStoreContext() {
    // Legacy — request-scoped store context is no longer needed with unified stores.
    // Kept as stub for _buildActiveRequestContext compatibility.
    return null;
  }

  _buildActiveRequestContext() {
    return {
      configSnapshot: this._normalizeConfig(this._cloneSerializable(this.config || {})),
      runtimeStore: this._buildRequestRuntimeStoreContext(),
    };
  }

  _getConfigSource(options = {}) {
    if (options.requestScoped === true && this._activeRequestContext?.configSnapshot) {
      return this._activeRequestContext.configSnapshot;
    }
    return this.config;
  }

  _getCustomProvidersFromConfigSource(options = {}) {
    return this._getConfigSource(options)?.customProviders || [];
  }

  hasActiveRequest() {
    return this._requestInFlight === true;
  }

  getLastResponseConfigSnapshot() {
    return this._cloneSerializable(this._lastResponseConfigSnapshot);
  }

  queueDeferredWorldCardActivation(cardId, locale = null) {
    if (typeof cardId !== 'string' || !cardId.trim()) return;
    this._pendingRuntimeWorldActivation = {
      cardId: cardId.trim(),
      locale: typeof locale === 'string' && locale.trim() ? locale.trim() : null,
    };
  }

  flushDeferredWorldCardActivation() {
    if (this.hasActiveRequest()) return false;
    const pending = this._pendingRuntimeWorldActivation;
    if (!pending) return false;

    this._pendingRuntimeWorldActivation = null;

    const mgr = typeof window !== 'undefined' ? window.worldCardManager : null;
    if (!mgr || typeof mgr._activateRuntime !== 'function') return false;
    if (typeof mgr.getActiveCardId === 'function' && mgr.getActiveCardId() !== pending.cardId) {
      return false;
    }

    const localized =
      typeof mgr.getLocalizedCard === 'function'
        ? mgr.getLocalizedCard(pending.cardId, pending.locale)
        : mgr.get?.(pending.cardId) || null;
    if (!localized?.snapshot) return false;

    const result = mgr._activateRuntime(localized.snapshot, localized.contentLocale);
    if (result && result.ok === false) return false;

    if (typeof npcCardRenderer !== 'undefined') {
      npcCardRenderer.invalidateCache();
    }
    return true;
  }

  /**
   * 取消当前正在进行的 AI 请求
   */
  cancelRequest() {
    if (this._requestAbortController) {
      this._requestAbortController.abort(new Error('User cancelled'));
      this._requestAbortController = null;
    }
  }

  _getOpeningMoneyCacheKey() {
    const worldCardId =
      typeof window !== 'undefined' ? window.worldCardManager?.getActiveCardId?.() || 'world' : 'world';
    const firstAiUid = Array.isArray(chatHistory)
      ? chatHistory.find(message => message?.sender === 'ai')?.uid || 'opening'
      : 'opening';
    return `${worldCardId}:${firstAiUid}`;
  }

  _getOrCreateOpeningMoneyAmount() {
    const cacheKey = this._getOpeningMoneyCacheKey();
    if (
      this._openingMoneyContext?.cacheKey === cacheKey &&
      Number.isInteger(this._openingMoneyContext?.amount)
    ) {
      return this._openingMoneyContext.amount;
    }
    const amount = Math.floor(Math.random() * 1001);
    this._openingMoneyContext = { cacheKey, amount };
    return amount;
  }

  _resolveCurrentMoneyAmount(lastGameState = null) {
    if (!lastGameState) {
      return this._getOrCreateOpeningMoneyAmount();
    }
    const currentMoney =
      typeof window !== 'undefined' && window.inventoryStore?.getMoney
        ? window.inventoryStore.getMoney()
        : null;
    if (Number.isFinite(currentMoney)) return currentMoney;
    return 0;
  }

  _generateTraceId() {
    return `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  _maskUrlForDebug(url) {
    if (!url) return '';
    return String(url).replace(/([?&](?:key|api_key|token|access_token)=)[^&]+/gi, '$1***');
  }

  _phaseToModule(phase) {
    const map = {
      react: 'react',
      gm_decision: 'gm',
      summary: 'summary',
      chapter: 'chapter',
      sms: 'sms',
      design: 'design',
      // design 子 phase 自映射，防御性 fallback（context.module 缺省时 telemetry 不丢失）
      p1: 'p1',
      p2: 'p2',
      p3: 'p3',
      repair: 'repair',
    };
    return map[phase] || null;
  }

  _phaseToShortLabel(phase) {
    const map = {
      react: 'ReAct',
      gm_decision: 'GM',
      summary: 'Summary',
      chapter: 'Chapter',
      sms: 'SMS',
      design: 'Design',
      p1: 'P1',
      p2: 'P2',
      p3: 'P3',
      repair: 'Repair',
    };
    return map[phase] || phase || '未知阶段';
  }

  _resolveCorePromptValue(name) {
    const localized = this._getLocalizedGlobalPromptValue(name, this._getGamePromptLanguage());
    if (typeof localized !== 'undefined') {
      return localized;
    }

    const globalScope =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof window !== 'undefined'
          ? window
          : null;

    if (globalScope && typeof globalScope[name] !== 'undefined') {
      return globalScope[name];
    }

    switch (name) {
      default:
        return undefined;
    }
  }

  _getGamePromptLanguage() {
    const requestLocale = window.worldMeta?.getActiveContentLocale?.();
    if (requestLocale === 'en' || requestLocale === 'zh-CN') {
      return requestLocale;
    }
    return (
      window.i18nService?.getGameContentLanguage?.() ||
      window.i18nService?.getResolvedLanguage?.() ||
      'zh-CN'
    );
  }

  _getDesignPromptLanguage() {
    return (
      window.i18nService?.getDesignLanguage?.() ||
      window.i18nService?.getResolvedLanguage?.() ||
      'zh-CN'
    );
  }

  _getLocalizedGlobalPromptValue(name, locale = 'zh-CN') {
    const globalScope =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof window !== 'undefined'
          ? window
          : null;
    if (!globalScope || typeof name !== 'string' || !name.trim()) return undefined;
    const localizedName = locale === 'en' ? `${name}_EN` : name;
    if (typeof globalScope[localizedName] !== 'undefined') {
      return globalScope[localizedName];
    }
    if (typeof globalScope[name] !== 'undefined') {
      return globalScope[name];
    }
    return undefined;
  }

  _getRequiredCorePromptString(name) {
    const value = this._resolveCorePromptValue(name);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    throw new Error(`缺少核心提示词: ${name}。请确认 prompts/[Fixed]core_prompt.js 已加载`);
  }

  _getRequiredCorePromptObject(name) {
    const value = this._resolveCorePromptValue(name);
    if (value && typeof value === 'object') {
      return value;
    }
    throw new Error(`缺少核心结构定义: ${name}。请确认 prompts/[Fixed]core_prompt.js 已加载`);
  }

  _buildRootCause(info, fallbackMessage) {
    if (!info) return fallbackMessage || '未知错误';
    const message = info.message || fallbackMessage || '未知错误';

    if (info.errorType === 'parse') {
      return `输出解析失败：${message}`;
    }
    if (info.errorType === 'timeout') {
      return info.elapsedMs ? `请求超时（${info.elapsedMs}ms）` : '请求超时';
    }
    if (info.errorType === 'network') {
      return `网络连接失败：${message}`;
    }
    if (info.errorType === 'runtime') {
      return `运行时错误：${message}`;
    }
    if (info.errorType === 'unexpected_format') {
      return `返回格式异常：${message}`;
    }
    if (info.errorType === 'http' && info.httpStatus) {
      // 上游误导性 400：返回 "field messages is required" / "messages: field required"
      // 等字样，但我们的请求体始终带 messages —— 这通常意味着 provider 不接受当前
      // model 名（常见于自定义中转把"auto"等路由关键字直接打到不支持它的后端时），
      // 中转把校验失败错位到 messages 字段。重写 rootCause 让玩家直接看到下一步动作。
      if (
        info.httpStatus === 400 &&
        /messages?\b[^a-z]{0,30}\b(?:is\s+)?required|缺少.*messages|messages.*field\s+required/i.test(
          message,
        )
      ) {
        const modelHint = info.model ? `当前模型名："${info.model}"` : '';
        const providerHint = info.provider ? `服务商：${info.provider}` : '';
        const detail = [modelHint, providerHint].filter(Boolean).join('，');
        const suffix = detail ? `（${detail}）` : '';
        return `Provider 不接受当前模型名${suffix}。建议到 设置 → API 中改成该 provider 实际支持的具体模型名（上游原始报错：${message}）`;
      }
      return `Provider 返回 HTTP ${info.httpStatus}：${message}`;
    }
    return message;
  }

  _buildUnifiedErrorInfo(error, context = {}) {
    const api = error?.apiErrorInfo || {};
    const inferredType =
      context.defaultErrorType ||
      api.errorType ||
      (error?.name === 'SyntaxError' ? 'parse' : null) ||
      (error?.name === 'AbortError' ? 'timeout' : null) ||
      (error?.name === 'TypeError' ? 'network' : null) ||
      'unknown';

    const traceId = context.traceId || this.lastPayload?.traceId || this._generateTraceId();
    const phase = context.phase || this.lastPayload?.failedPhase || 'unknown';
    const moduleName = context.module || this._phaseToModule(phase);
    const provider = context.provider || api.provider || null;
    const model = context.model || null;
    const message = context.message || error?.message || api.message || '未知错误';

    const hasContextResponseBody = Object.prototype.hasOwnProperty.call(context, 'responseBody');
    const hasApiResponseBody = Object.prototype.hasOwnProperty.call(api, 'responseBody');

    const info = {
      traceId,
      phase,
      module: moduleName,
      provider,
      model,
      engine: context.engine ?? api.engine ?? null,
      errorType: inferredType,
      message,
      rootCause: '',
      httpStatus: context.httpStatus ?? api.httpStatus ?? null,
      httpStatusText: context.httpStatusText ?? api.httpStatusText ?? null,
      providerErrorType: context.providerErrorType ?? api.providerErrorType ?? null,
      providerErrorCode: context.providerErrorCode ?? api.providerErrorCode ?? null,
      providerErrorParam: context.providerErrorParam ?? api.providerErrorParam ?? null,
      requestId: context.requestId ?? api.requestId ?? null,
      url: this._maskUrlForDebug(context.url || api.url || ''),
      responseHeaders: context.responseHeaders ?? api.responseHeaders ?? null,
      responseBody: hasContextResponseBody
        ? context.responseBody
        : hasApiResponseBody
          ? api.responseBody
          : null,
      elapsedMs: context.elapsedMs ?? api.elapsedMs ?? null,
      timestamp: context.timestamp || new Date().toISOString(),
      stack: error?.stack || context.stack || null,
    };

    info.rootCause = context.rootCause || this._buildRootCause(info, message);
    return info;
  }

  _markPayloadFailure(phase, errorInfo) {
    if (!this.lastPayload) return;
    this.lastPayload.failedPhase = phase;
    this.lastPayload.errorInfo = errorInfo;
  }

  _markStepStarted(stepLog) {
    if (!stepLog) return;
    stepLog.startedAt = new Date().toISOString();
    stepLog.failed = false;
  }

  _markStepSucceeded(stepLog) {
    if (!stepLog) return;
    stepLog.failed = false;
    stepLog.endedAt = new Date().toISOString();
  }

  _markStepFailure(stepLog, error, context = {}, options = {}) {
    const info = this._buildUnifiedErrorInfo(error, {
      ...context,
      traceId: this.lastPayload?.traceId,
      phase: context.phase || stepLog?.phase,
      module: context.module || this._phaseToModule(context.phase || stepLog?.phase),
      provider: context.provider || stepLog?.provider || null,
      model: context.model || stepLog?.model || null,
      engine: context.engine || stepLog?.engine || null,
      url: context.url || stepLog?.url || '',
    });

    if (stepLog) {
      stepLog.failed = true;
      stepLog.error = info.message;
      stepLog.errorInfo = info;
      stepLog.endedAt = new Date().toISOString();
    }

    if (options.updatePayload !== false) {
      this._markPayloadFailure(info.phase, info);
    }

    if (options.attachToError !== false && error) {
      error.unifiedErrorInfo = info;
      error.errorInfo = info;
      error.traceId = info.traceId;
      error.failedPhase = info.phase;
    }

    return info;
  }

  /**
   * 分析最近请求的 timing，返回诊断结果
   * 用于判断延迟是网络问题还是 Provider 问题
   * 使用 metrics 中的 ttfb 和 downloadTime 进行诊断（不依赖 PerformanceResourceTiming）
   */
  analyzeTiming() {
    const metrics = this.lastRequestMetrics;
    if (!metrics?.steps?.length) return null;

    // Phase 名称映射
    const PHASE_NAMES = {
      react: 'ReAct 流水线',
      gm_decision: 'GM 决策',
    };

    // Phase 到 module 的映射（用于获取 provider）
    const PHASE_TO_MODULE = {
      react: 'react',
      gm_decision: 'gm',
    };

    const details = [];
    let maxTtfb = 0;
    let maxDownload = 0;
    let hasProviderIssue = false;
    let hasNetworkIssue = false;

    // 遍历所有 steps
    for (const step of metrics.steps) {
      const phaseName = PHASE_NAMES[step.phase] || step.phase;
      const moduleKey = PHASE_TO_MODULE[step.phase] || step.phase;
      const provider = metrics.providers?.[moduleKey] || '';

      // 获取 timing 数据
      const ttfb = step.ttfb || step.ttft || 0; // 优先用 ttfb，降级用 ttft
      const totalTime = step.totalTime || 0;
      // 计算 downloadTime：如果 metrics 里有就用，否则计算（确保非负）
      const downloadTime = Math.max(0, step.downloadTime ?? totalTime - ttfb);

      // 诊断阈值
      const isTtfbSlow = ttfb > 15000; // TTFB > 15s = Provider 慢
      const isDownloadSlow = downloadTime > 10000 && downloadTime > ttfb; // 下载 > 10s 且 > TTFB = 网络慢

      if (isTtfbSlow) hasProviderIssue = true;
      if (isDownloadSlow) hasNetworkIssue = true;
      if (ttfb > maxTtfb) maxTtfb = ttfb;
      if (downloadTime > maxDownload) maxDownload = downloadTime;

      details.push({
        phase: step.phase,
        phaseName: phaseName,
        model: step.model,
        provider: provider,
        ttfb: Math.round(ttfb),
        downloadTime: Math.round(downloadTime),
        totalTime: Math.round(totalTime),
        isTtfbSlow: isTtfbSlow,
        isDownloadSlow: isDownloadSlow,
        inputTokens: step.inputTokens,
        outputTokens: step.outputTokens,
      });
    }

    // 诊断规则
    let diagnosis = '';
    let level = 'normal';

    if (hasNetworkIssue && hasProviderIssue) {
      diagnosis = '网络+Provider都慢';
      level = 'error';
    } else if (hasNetworkIssue) {
      diagnosis = '网络/VPN 慢';
      level = 'error';
    } else if (hasProviderIssue) {
      diagnosis = 'Provider 响应慢';
      level = 'warning';
    } else {
      diagnosis = '正常';
      level = 'normal';
    }

    return {
      diagnosis,
      level,
      details,
      isNetworkSlow: hasNetworkIssue,
      isProviderSlow: hasProviderIssue,
      totalTime: metrics.totalTime,
      maxTtfb: Math.round(maxTtfb),
      maxDownload: Math.round(maxDownload),
    };
  }

  loadConfig() {
    const saved = localStorage.getItem('ai_adventure_settings');
    let parsedSaved = null;
    if (saved) {
      try {
        parsedSaved = JSON.parse(saved);
      } catch (e) {
        console.warn('[aiService] ai_adventure_settings 解析失败，已重置为默认配置:', e);
        localStorage.removeItem('ai_adventure_settings');
      }
    }
    const config = parsedSaved || {
      // 每个服务商的 API Key
      providerApiKeys: {},
      // 模型价格映射（key: provider::model）
      modelPrices: {},
      // 每个模块独立配置(服务商 + 模型)
      modules: this._createDefaultModulesConfig(),
      // 其他设置
      useSummaryContext: true,
      recentMessageCount: 4,
      useStreaming: true,
      narrativeLength: 'medium',
      themeName: 'metro',
      themeMode: 'light',
      uiLanguage: 'auto',
      uiScaleMode: 'auto',
      uiScale: 1,
      webSearchEnabled: false,
    };

    // 确保新字段存在（向后兼容）
    if (!config.customFunctionContents) {
      config.customFunctionContents = null;
    }
    if (!config.deletedFunctions) {
      config.deletedFunctions = null;
    }
    if (!config.customFunctions) {
      config.customFunctions = null;
    }
    if (!config.customParameterOverrides) {
      config.customParameterOverrides = null;
    }
    if (config.disableResidentFunctions === undefined) {
      config.disableResidentFunctions = false;
    }
    // 自定义 Provider 支持（向后兼容）
    if (!config.customProviders) {
      config.customProviders = [];
    }
    // 自定义 System Prompt 列表（向后兼容）
    if (!Array.isArray(config.customSystemPrompts)) {
      config.customSystemPrompts = [];
    }
    if (!Object.prototype.hasOwnProperty.call(config, 'narrativeLength')) {
      config.narrativeLength = 'medium';
    }
    if (!Object.prototype.hasOwnProperty.call(config, 'uiScaleMode')) {
      config.uiScaleMode = 'auto';
    }
    if (!Object.prototype.hasOwnProperty.call(config, 'uiLanguage')) {
      config.uiLanguage = 'auto';
    }
    if (!Object.prototype.hasOwnProperty.call(config, 'uiScale')) {
      config.uiScale = 1;
    }
    if (!Object.prototype.hasOwnProperty.call(config, 'webSearchEnabled')) {
      config.webSearchEnabled = false;
    }

    const hadLegacyCorePromptFields = LEGACY_CORE_PROMPT_FIELDS.some(field =>
      Object.prototype.hasOwnProperty.call(config, field)
    );
    const hadLegacyThemeMode = config.themeMode === 'system';
    const hadLegacyProviderBaseUrls = Object.prototype.hasOwnProperty.call(
      config,
      'providerBaseUrls'
    );

    // react 温度 1.3 → 1.0 一次性迁移：旧默认值在 V4 + thinking=off + 长 system prompt 下
    // 会触发 token 级崩坏（首回合就生成"语法骨架在、语义全无"的字串）。把存在 localStorage
    // 里的旧默认 1.3 一次性迁移到 1.0。用户若主动想要 1.3 可以再去面板调回。
    const hadLegacyReactTemperature =
      saved &&
      parsedSaved &&
      parsedSaved.modules &&
      parsedSaved.modules.react &&
      parsedSaved.modules.react.temperature === 1.3;
    if (hadLegacyReactTemperature) {
      config.modules.react.temperature = 1.0;
    }

    const normalized = this._normalizeConfig(config);
    const shouldPersistNormalizedConfig = Boolean(
      saved && parsedSaved && JSON.stringify(parsedSaved) !== JSON.stringify(normalized)
    );

    // 启动时清理存档中的遗留字段，避免历史残留继续存在于 localStorage
    // 主题模式迁移: 历史 "system" 统一回退为 "light"
    if (
      saved &&
      (hadLegacyCorePromptFields ||
        hadLegacyThemeMode ||
        hadLegacyProviderBaseUrls ||
        hadLegacyReactTemperature ||
        shouldPersistNormalizedConfig)
    ) {
      localStorage.setItem('ai_adventure_settings', JSON.stringify(normalized));
    }

    return normalized;
  }

  _getDefaultProviderForModule(module) {
    const normalizedModule = typeof module === 'string' ? module.trim() : '';
    return MODULE_DEFAULT_CONFIGS[normalizedModule]?.provider || 'gemini';
  }

  _buildDefaultModuleConfig(module, provider = null, customProviders = null, options = {}) {
    const normalizedModule = typeof module === 'string' ? module.trim() : '';
    const defaultProvider = this._getDefaultProviderForModule(normalizedModule);
    const resolvedProvider =
      typeof provider === 'string' && provider.trim() ? provider.trim() : defaultProvider;
    return {
      provider: resolvedProvider,
      model: this._getDefaultModelForProvider(
        resolvedProvider,
        customProviders,
        normalizedModule,
        options
      ),
      temperature: this._getDefaultTemperatureForModule(normalizedModule, resolvedProvider, options),
    };
  }

  _createDefaultModulesConfig(customProviders = null) {
    return REQUIRED_MODULES.reduce((acc, moduleId) => {
      acc[moduleId] = { ...this._buildDefaultModuleConfig(moduleId, null, customProviders) };
      return acc;
    }, {});
  }

  getDefaultModuleConfig(module, provider = null, options = {}) {
    return this._buildDefaultModuleConfig(
      module,
      provider,
      this._getCustomProvidersFromConfigSource(options),
      options
    );
  }

  // 获取指定模块的配置(服务商 + 模型)
  // 别名说明：
  //   • step1/step2/step2Editor/editor/step3 — ReAct 改造前的历史 config key，无活跃调用点
  //   • p1/p2/p3/repair — design 子 phase 的 key；推荐模式下命中专属表，非推荐模式下回落到 modules.design
  getModuleConfig(module, options = {}) {
    const aliasMap = {
      step1: 'react', step2: 'react', step2Editor: 'react', editor: 'react', step3: 'react',
      p1: 'design', p2: 'design', p3: 'design', repair: 'design',
      // per-iter / ReAct 周边 key：非推荐模式下回落到用户的 'react' 配置，
      // 让 simple/advanced 用户继续按一个模型跑全部 iter。
      iter1_narrative: 'react', iter2_4_reads: 'react', iter5_mutations: 'react',
      iter6_narrative: 'react', iter7_closing: 'react', iter8_settlement: 'react',
      iter9_choices: 'react',
      npc_reaction: 'react', ooc_normalizer: 'react',
      npc_intro_audit: 'react',
      action_classify: 'react', map_naming: 'react',
    };
    const configSource = this._getConfigSource(options) || {};

    // 推荐模式：按 iter / phase 表合成虚拟 module 配置。
    // priceIn/priceOut 走官方 DeepSeek 常量表；temperature 复用用户 modules.react 设置或默认值。
    if (this.getEffectiveApiSettingsMode(options) === 'recommended') {
      const recommendedConfig = this._buildRecommendedPhaseConfig(module, options);
      if (recommendedConfig) return recommendedConfig;
      // module 不在推荐表里 → 落到正常解析（防御性，避免 'gm' 等异常 key）
    }

    const resolved = aliasMap[module] || module;
    return configSource.modules?.[resolved]
      || configSource.modules?.[module]  // fallback: 读旧 key
      || this.getDefaultModuleConfig(resolved, null, options);
  }

  _getRecommendedBaseTemperature(options = {}) {
    const configSource = this._getConfigSource(options) || {};
    return this._normalizeTemperatureValue(
      configSource.modules?.react?.temperature,
      this._getDefaultTemperatureForModule('react', 'deepseek', options)
    );
  }

  _buildRecommendedPhaseConfig(phase, options = {}) {
    let resolvedKey = phase;
    let phaseEntry = RECOMMENDED_PHASE_MAP[phase];
    // 'react' 大类入口在 per-iter 化之后已不再单独配置，兜底到 iter1_narrative
    // （叙事 spine 的代表性配置：v4-pro/off）。debug/UI/telemetry 仍可能传 'react'。
    if (!phaseEntry && phase === 'react') {
      resolvedKey = RECOMMENDED_REACT_FALLBACK_KEY;
      phaseEntry = RECOMMENDED_PHASE_MAP[resolvedKey];
    }
    if (!phaseEntry) return null;
    const priceEntry = OFFICIAL_DEEPSEEK_PRICES[phaseEntry.model] || { in: 0, out: 0 };
    return {
      provider: 'deepseek',
      model: phaseEntry.model,
      thinking: phaseEntry.thinking,
      temperature: this._getRecommendedBaseTemperature(options),
      priceIn: priceEntry.in,
      priceOut: priceEntry.out,
    };
  }

  getRecommendedModeConfig(options = {}) {
    const temperature = this._getRecommendedBaseTemperature(options);
    const phases = Object.keys(RECOMMENDED_PHASE_MAP).map(phase => ({
      phase,
      ...this._buildRecommendedPhaseConfig(phase, options),
    }));
    return {
      provider: 'deepseek',
      temperature,
      useStreaming: true,
      phases,
    };
  }

  // 遥测用：解析后的完整 AI 配置快照（所有模式通用，不只推荐模式）。
  // analyticsService 拿它做 hash 去重后 emit `ai.config`——配置语义集中在此，
  // 不让遥测层重抄一份 phase→model 表。phase 清单以 RECOMMENDED_PHASE_MAP
  // 的 key 为权威来源（含 iter1..iter9 / npc_reaction / sms / summary /
  // p1..p3 / repair 等；非推荐模式下 getModuleConfig 内部 aliasMap 会把
  // per-iter / design 子 phase 回落到用户的 react / design 配置）。
  getConfigSnapshot(options = {}) {
    const cfg = this._getConfigSource(options) || {};
    const phases = {};
    for (const phase of Object.keys(RECOMMENDED_PHASE_MAP)) {
      const c = this.getModuleConfig(phase, options) || {};
      phases[phase] = {
        provider: c.provider ?? null,
        model: c.model ?? null,
        thinking: c.thinking ?? null,
      };
    }
    const reactCfg = this.getModuleConfig('react', options) || {};
    return {
      settings_mode: this.getEffectiveApiSettingsMode(options),
      saved_mode: cfg.apiSettingsMode || 'simple',
      has_deepseek_key: this.isRecommendedModeAvailable(options),
      temperature: reactCfg.temperature ?? null,
      phases,
    };
  }

  _getDefaultTemperatureForModule(module, provider = null, options = {}) {
    return 1.0;
  }

  _normalizeTemperatureValue(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    // 上游 API 范围 [0.0, 2.0) 左闭右开；clamp 到 1.99 避开右边界拒绝
    return Math.min(1.99, Math.max(0, parsed));
  }

  _getDefaultModelForProvider(provider, customProviders = null, module = null, options = {}) {
    const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
    const normalizedModule = typeof module === 'string' ? module.trim() : '';
    const moduleDefaultConfig = MODULE_DEFAULT_CONFIGS[normalizedModule];
    if (
      normalizedProvider &&
      moduleDefaultConfig &&
      moduleDefaultConfig.provider === normalizedProvider
    ) {
      return moduleDefaultConfig.model;
    }
    if (normalizedProvider && BUILTIN_PROVIDER_DEFAULT_MODELS[normalizedProvider]) {
      return BUILTIN_PROVIDER_DEFAULT_MODELS[normalizedProvider];
    }
    const list = Array.isArray(customProviders)
      ? customProviders
      : this._getCustomProvidersFromConfigSource(options);
    const custom = list.find(p => p.id === normalizedProvider);
    if (custom?.defaultModel) return custom.defaultModel;
    return BUILTIN_PROVIDER_DEFAULT_MODELS.gemini;
  }

  // 判断 providerId 是否为用户自定义服务商。用于 ReAct 错误分类时决定是否允许下
  // "no_function_calling" 这种严肃指控——builtin provider 内置模型都支持 fc，那条路径上的
  // 误判风险远高于真阳性，所以仅在 customProviders 路径下保留 fc 不支持的判定。
  isCustomProvider(providerId) {
    if (!providerId || typeof providerId !== 'string') return false;
    return !Object.prototype.hasOwnProperty.call(BUILTIN_PROVIDER_DEFAULT_MODELS, providerId);
  }

  // 获取指定模块应使用的模型
  getModelForModule(module, options = {}) {
    return this.getModuleConfig(module, options).model;
  }

  // 获取指定模块应使用的服务商
  getProviderForModule(module, options = {}) {
    return this.getModuleConfig(module, options).provider;
  }

  // 获取指定模块的价格配置 ($/M tokens)
  // 返回 { in: number, out: number }
  getModulePrices(module, options = {}) {
    const config = this.getModuleConfig(module, options);
    return {
      in: config.priceIn || 0,
      out: config.priceOut || 0,
    };
  }

  getModuleTemperature(module, fallback = undefined, options = {}) {
    const config = this.getModuleConfig(module, options);
    const defaultTemp =
      fallback !== undefined
        ? fallback
        : this._getDefaultTemperatureForModule(module, config.provider, options);
    return this._normalizeTemperatureValue(config.temperature, defaultTemp);
  }

  // DeepSeek V4 hybrid 思考档位：'off' | 'high' | 'max'。
  // 仅用于 V4 系列模型（deepseek-v4-flash / deepseek-v4-pro）；legacy 名走服务端默认。
  getModuleThinking(module, options = {}) {
    const config = this.getModuleConfig(module, options);
    const raw = typeof config.thinking === 'string' ? config.thinking.trim().toLowerCase() : '';
    return DEEPSEEK_THINKING_LEVELS.includes(raw) ? raw : DEEPSEEK_THINKING_DEFAULT;
  }

  // 获取指定模块的 API Key
  // 出口处统一 sanitize：剥离非 ASCII 字符（玩家粘贴 key 时易混入中文标点 / 全角空格 / emoji，
  // 直接塞进 fetch header 会触发 "String contains non ISO-N-1 code point" 编码错误）
  getApiKeyForModule(module, options = {}) {
    const provider = this.getProviderForModule(module, options);
    const configSource = this._getConfigSource(options) || {};
    const raw = configSource.providerApiKeys?.[provider] || '';
    return window.apiKeySanitizer ? window.apiKeySanitizer.sanitize(raw) : raw;
  }

  // 推荐模式是否可用：当且仅当用户绑定了官方 DeepSeek API key。
  // 自定义 provider 不能占用 id='deepseek'（_normalizeConfig 已保证），
  // 所以仅检查 providerApiKeys.deepseek 字段即可。
  isRecommendedModeAvailable(options = {}) {
    const cfg = this._getConfigSource(options) || {};
    const key = cfg.providerApiKeys?.deepseek;
    return typeof key === 'string' && key.trim().length > 0;
  }

  // 有效的 API 设置模式。当用户保存了 'recommended' 但事后删了 deepseek key，
  // 这里静默降级为 'simple'，避免 AI 调用走到没 key 的 provider。
  // 调用方应使用此方法，而非直接读 config.apiSettingsMode。
  getEffectiveApiSettingsMode(options = {}) {
    const cfg = this._getConfigSource(options) || {};
    const saved = cfg.apiSettingsMode;
    if (saved === 'recommended') {
      return this.isRecommendedModeAvailable(options) ? 'recommended' : 'simple';
    }
    return saved === 'advanced' ? 'advanced' : 'simple';
  }

  // 推荐模式锁定 narrativeLength 为 medium；其他模式按 config 值。
  // 调用方（prompt 构建、UI 展示）应用此方法而非直接读 config.narrativeLength。
  getEffectiveNarrativeLength(options = {}) {
    if (this.getEffectiveApiSettingsMode(options) === 'recommended') {
      return 'medium';
    }
    const cfg = this._getConfigSource(options) || {};
    const value = cfg.narrativeLength;
    return value === 'short' || value === 'medium' || value === 'long' ? value : 'medium';
  }

  // 联网搜索总开关：仅在折叠栏内 Anthropic / Gemini 的叙事 iter 生效，其他 provider / iter 静默忽略
  isWebSearchEnabled(options = {}) {
    const cfg = this._getConfigSource(options) || {};
    return cfg.webSearchEnabled === true;
  }

  saveConfig(newConfig) {
    this.config = this._normalizeConfig({ ...this.config, ...newConfig });
    localStorage.setItem('ai_adventure_settings', JSON.stringify(this.config));
  }

  _normalizeRecentMessageCount(value) {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) return 4;
    return Math.min(20, Math.max(2, parsed));
  }

  _normalizeUIScaleValue(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, parsed));
  }

  _isStep3SchemaSupportedProvider(providerType) {
    const normalized = typeof providerType === 'string' ? providerType.trim().toLowerCase() : '';
    return STEP3_SCHEMA_SUPPORTED_PROVIDERS.has(normalized);
  }

  _escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _containsChoicePlaceholder(value = '') {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return false;
    return text.includes('?') || text.includes('？') || /\bX{2,}\b/i.test(text);
  }

  _getChoiceCurrencyLabel() {
    const currencyTerms = this._getActiveCurrencyTerms();
    return currencyTerms?.currencyLabel || currencyTerms?.currencyShort || '';
  }

  _normalizeChoiceTypeTag(typeTag = '') {
    return (
      window.i18nService?.normalizeChoiceTypeTag?.(typeTag) ||
      (typeof typeTag === 'string' ? typeTag.trim().toLowerCase() : '')
    );
  }

  _normalizeChoiceEffectTime(effectTime = '') {
    return typeof effectTime === 'string' ? effectTime.trim().toLowerCase() : '';
  }

  _normalizeChoiceEffectDays(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
      return Number.parseInt(value.trim(), 10);
    }
    return null;
  }

  _extractStructuredTimeParts(date = {}) {
    if (!date || typeof date !== 'object') return { hour: null, minute: null };
    const hour = Number.parseInt(date.hour, 10);
    const minute = Number.parseInt(date.minute, 10);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return { hour, minute };
    }
    const timeStr = this._normalizeClockTimeString(date.time_str || date.timeStr || '');
    if (!timeStr) return { hour: null, minute: null };
    const [parsedHour, parsedMinute] = timeStr.split(':').map(Number);
    return { hour: parsedHour, minute: parsedMinute };
  }

  _buildStructuredDatetime(date = {}) {
    const year = Number.parseInt(date.year, 10);
    const month = Number.parseInt(date.month, 10);
    const day = Number.parseInt(date.day, 10);
    const { hour, minute } = this._extractStructuredTimeParts(date);
    return {
      year: Number.isFinite(year) ? year : null,
      month: Number.isFinite(month) ? month : null,
      day: Number.isFinite(day) ? day : null,
      hour: Number.isFinite(hour) ? hour : 0,
      minute: Number.isFinite(minute) ? minute : 0,
    };
  }

  _formatClockTime(hour, minute) {
    const parsedHour = Number.parseInt(hour, 10);
    const parsedMinute = Number.parseInt(minute, 10);
    if (!Number.isFinite(parsedHour) || !Number.isFinite(parsedMinute)) return '';
    if (parsedHour < 0 || parsedHour > 23 || parsedMinute < 0 || parsedMinute > 59) return '';
    return `${String(parsedHour).padStart(2, '0')}:${String(parsedMinute).padStart(2, '0')}`;
  }

  _getExpectedChoiceEffectTime(typeTag = '') {
    return STEP3_CHOICE_TYPE_TIME_MATRIX[this._normalizeChoiceTypeTag(typeTag)] || '';
  }

  _getChoiceEffectTimeRule(effectTime = '') {
    return STEP3_CHOICE_TIME_EFFECT_RULES[this._normalizeChoiceEffectTime(effectTime)] || null;
  }

  _sanitizeActionInputForClassification(text = '') {
    let normalized = String(text || '').trim();
    normalized = normalized.replace(/^[A-Ca-c][.)、:\s]+\s*/, '');
    normalized = normalized.replace(/^\[[^\]]+\]\s*/, '');
    normalized = normalized.replace(/^\s*[A-Ca-c][.)、:\s]+\s*\[[^\]]+\]\s*/, '');
    return normalized;
  }

  _rollChoiceTimeMinutes(effectTime = '') {
    const rule = this._getChoiceEffectTimeRule(effectTime);
    if (!rule || !Number.isFinite(rule.min) || !Number.isFinite(rule.max)) return null;
    if (rule.max < rule.min) return null;
    const span = rule.max - rule.min + 1;
    return rule.min + Math.floor(Math.random() * span);
  }

  _buildActionContextSystemText(context = null) {
    if (!context?.choice) return '';
    const choice = context.choice;
    const normalizedType = this._normalizeChoiceTypeTag(choice.type_tag);

    // --- 计算时间范围 ---
    let timeRangeMin = null;
    let timeRangeMax = null;
    let timeDesc = '';

    if (STEP3_CHOICE_DAY_TYPES.has(normalizedType)) {
      // travel/work: 用 effect_days 确定时间
      const effectDays = this._normalizeChoiceEffectDays(choice.effect_days);
      if (Number.isInteger(effectDays) && effectDays > 0) {
        const totalMinutes = effectDays * 1440;
        timeRangeMin = totalMinutes;
        timeRangeMax = totalMinutes;
        timeDesc = `约 ${effectDays} 天（${totalMinutes} 分钟）`;
      }
    } else {
      // explore/trade/talk/action: 从 timeMatrix 取范围
      const effectTime = this._getExpectedChoiceEffectTime(normalizedType);
      const rule = this._getChoiceEffectTimeRule(effectTime);
      if (rule && Number.isFinite(rule.min) && Number.isFinite(rule.max)) {
        timeRangeMin = rule.min;
        timeRangeMax = rule.max;
        timeDesc = `${rule.min} ~ ${rule.max} 分钟`;
      }
    }

    // --- 设置 settlement hints 供 stateTools 消费 ---
    window._currentTurnSettlementHints = {
      typeTag: normalizedType,
      timeRangeMin,
      timeRangeMax,
    };

    // --- 组装结算指引文本 ---
    const lines = [
      '## 本轮结算指引（系统预处理，具有约束力）',
      '',
      `- type_tag：${normalizedType}`,
    ];
    if (timeDesc) {
      lines.push(`- 时间推进范围：${timeDesc}（系统结算时使用，叙事节奏可参考此区间）`);
    }
    return lines.join('\n');
  }

  _buildMapContextSystemText() {
    if (!window.mapService?.getMapData?.()) return '';

    const mapData = window.mapService.getMapData();
    const playerPos = mapData.getPlayerPosition();
    const currentMap = mapData.getCurrentMap();
    const playerCell = currentMap.find(c => c.row === playerPos.row && c.col === playerPos.col);

    if (!playerCell) return '';

    const adjCells = HexGrid.getAdjacentCells(playerPos.row, playerPos.col, currentMap);
    const adjTerrains = [...new Set(adjCells.map(c => c.terrain))];
    const nearbyLandmarks = adjCells.filter(c => c.landmark);

    const lines = [
      '## 地图位置（代码权威数据）',
      '',
      `- 当前层级：${mapData.layer === 'world' ? '世界地图' : '局部地图'}`,
      `- 坐标：(${playerPos.col}, ${playerPos.row})`,
      `- 当前地形：${playerCell.terrain}${typeof TerrainTypes !== 'undefined' ? '（' + TerrainTypes.getTerrainDescription(playerCell.terrain) + '）' : ''}`,
      `- 相邻地形：${typeof TerrainTypes !== 'undefined' ? adjTerrains.map(t => t + '（' + TerrainTypes.getTerrainDescription(t) + '）').join('、') : adjTerrains.join(', ')}`,
    ];

    if (playerCell.siteName) {
      lines.push(`- 当前地点：${playerCell.siteName}`);
    }
    if (playerCell.locationName) {
      lines.push(`- 当前位置：${playerCell.locationName}`);
      if (playerCell.locationDescription) {
        lines.push(`- 位置描述：${playerCell.locationDescription}`);
      }
    }
    if (nearbyLandmarks.length > 0) {
      const landmarkNames = nearbyLandmarks
        .map(c => c.siteName || c.locationName || c.landmark)
        .join(', ');
      lines.push(`- 附近地标：${landmarkNames}`);
    }

    // Country entity context — always inject when available
    const countryEntityId = mapData.currentCountryId;
    if (countryEntityId) {
      const countryDesc = window.entityStore?.get?.(countryEntityId);
      if (countryDesc) {
        const truncated = countryDesc.length > 200 ? countryDesc.substring(0, 200) + '...' : countryDesc;
        lines.push(`- 所在区域背景：${truncated}`);
      }
    }

    lines.push('');
    lines.push('地形类型为抽象标识（A/B/C/D/E），请根据当前世界观设定自行演绎具体环境描写。');

    return lines.join('\n');
  }

  /**
   * 完整 playerInventory 文本（data + rules 合并版）。
   * Legacy 路径 (_buildVolatileSystemBlocks → iter6/7/9) 和 iter5 / iter6 builder
   * 都用此版本。iter1 用 _buildInventoryDataText() 单独拿数据部分（不需要 rules，
   * 因为不能调 update_item）。
   * 拆分动机：iter1 之前完全看不到 inventory data 导致 Turn 2+ 叙事可能写物品不
   * 一致；同时把 "🎒新游戏开局强制" 隔离到 rules 部分，让 data 部分对所有 iter
   * 都安全可用。
   */
  _buildInventorySystemText() {
    const data = this._buildInventoryDataText();
    const rules = this._buildInventoryRulesText();
    return [data, rules].filter(Boolean).join('\n\n');
  }

  /**
   * 仅"## 玩家物品栏" + 已持有 / 曾持有 / 待审批 清单（无调用规则）。
   * iter1 / iter6 都需要这块——写叙事时要知道玩家身上有什么。
   */
  _buildInventoryDataText() {
    const store = window.inventoryStore;
    if (!store) return '';

    const active = store.getActiveItems?.() || [];
    const tombstones = store.getTombstoneItems?.() || [];
    const pending = store.getPending?.() || [];

    const lines = ['## 玩家物品栏（当前状态）', ''];

    lines.push(
      active.length > 0
        ? '已持有：' + active.map(it => `${it.name}×${it.count}`).join('、') /* ui-lint-allow: 物品计数乘号 */
        : '已持有：（空——玩家还没获得任何物品）'
    );

    if (tombstones.length > 0) {
      lines.push(
        '曾持有（不在身上但保留命名记忆，再次获得请复用同名）：' +
          tombstones.map(it => it.name).join('、')
      );
    }

    if (pending.length > 0) {
      lines.push(
        `待审批（玩家未确认，${pending.length} 项）：` +
          pending.map(p => `${p.name}(${p.delta >= 0 ? '+' : ''}${p.delta})`).join('、')
      );
    }

    return lines.join('\n');
  }

  /**
   * 调用规则 + 🎒 新游戏开局（条件触发） + 主动引导经济感。
   * 仅 iter5（mutation 执行者）和 iter6（mode A 直接落地）需要这些。
   * iter1 / iter2-4 不调 update_item，无需这些规则。
   */
  _buildInventoryRulesText() {
    const store = window.inventoryStore;
    if (!store) return '';

    const active = store.getActiveItems?.() || [];
    const tombstones = store.getTombstoneItems?.() || [];
    const pending = store.getPending?.() || [];
    const label = store.getCurrencyLabel?.() || '银币';

    const lines = [];
    lines.push('## 调用规则（**强制**）：');
    lines.push(
      '- **本世界货币名为「' + label + '」**。涉及付款 / 收入 / 兑换时**必须**调 update_item({ name: "' + label + '", delta: ±N })，不能只在叙事文字里写"花了 5 ' + label + '"。'
    );
    lines.push(
      '- 玩家**任何**物品变化（拾起、获得、失去、消耗、购买、出售、被偷、丢弃、被借走、归还）**必须**调 update_item({ name, delta, desc? })。叙事描述与 tool 调用必须**同步**——不能只在叙事中说"你拾起了苹果"而不调 update_item。'
    );
    lines.push(
      '- 名称演化（生肉→烤肉、未附魔的剑→附魔的剑等）：先 update_item("旧名", delta=-1)，再 update_item("新名", desc="...", delta=+1)。两次调用同回合内可一起发。'
    );
    lines.push(
      '- 临时离开持有但未完全失去（借出 / 寄存 / 抵押）：用名称演化保留身份，如 update_item("宝剑（借给将军）", +1, desc="未归还")。'
    );
    lines.push(
      '- 优先复用「曾持有」中的物品名：玩家曾有「面包」吃完后再次买面包请用 update_item("面包", +N)，不要新创「吐司」「干粮」等同类异名物品。'
    );
    lines.push('- desc 仅在该物品首次出现或确实需要刷新时填，否则省略以保留旧 desc。');
    lines.push(
      '- **count 是非负整数**：负 delta 不可超过当前持有量。先看上方"已持有"中的实际数量再决定 delta。'
    );
    lines.push(
      '- **update_item 返回 [失败] 库存不足时**：本次扣减未生效；如果你已经在前一段 setup 叙事里写了"掏钱包/翻背包"等动作，下一段 outcome 必须改写为"翻了半天发现不够"等承认事实的写法，**绝不可继续写"成功支付"**。这是 item_check checkpoint 的标准失败处理。'
    );
    if (this.config?.autoApproveInventory === true) {
      lines.push('- 物品自动审批已开启：update_item 调用后即刻落地，叙事中可以直接描述物品已在身上，无须"等玩家确认"措辞。');
    } else {
      lines.push('- 待审批项尚未生效；如玩家拒绝可能撤回，不要在叙事中假定其落地。');
    }

    // 新游戏第一个真实回合 + 物品栏完全为空 + 无待审批 → 注入"开局必给起手包"硬指令
    // 三条任意一个不成立（老存档 / 第二回合及之后 / 已有提议）这段都自动消失
    const noPriorAiTurn =
      typeof chatHistory !== 'undefined' &&
      Array.isArray(chatHistory) &&
      !chatHistory.some(
        m =>
          m &&
          m.sender === 'ai' &&
          !(typeof m.uid === 'string' && m.uid.startsWith('turn_0_'))
      );
    if (noPriorAiTurn && active.length === 0 && tombstones.length === 0 && pending.length === 0) {
      lines.push('');
      lines.push('## 🎒 新游戏开局（**强制**）：');
      lines.push(
        '本回合是新游戏的第一个真实回合。**无论**叙事场景如何（普通醒来 / 失忆 / 被流放 / 富家少爷 / 街头乞丐），你**必须**在本回合调用 1-3 次 update_item 给玩家初始物品。'
      );
      lines.push(
        '- 物品贴合**世界主题**和**角色身份**（本世界货币名为「' + label + '」）。'
      );
      lines.push(
        '- **适合时**优先给货币，让玩家开局就有"可花的钱"；不适合的场景（原始部落、无货币体系的世界等）可全给实物。具体数量由你根据世界与身份评估，不预设上下限。'
      );
      lines.push(
        '- 物品要在**叙事中自然出现**：摸口袋、翻背包、低头看身上衣服首饰、想起怀里信物、抚过腰间挂件等——禁止"系统赠送"式凭空交付。'
      );
      lines.push(
        '- "赤手起家"场景（失忆 / 流放 / 裸身被冲上岸 / 从狱中逃出）也**必须**给——用创意表达残留、隐藏、或贴身藏匿的物品。**绝不**因场景困窘就给 0 件。'
      );
      if (this.config?.autoApproveInventory === true) {
        lines.push(
          '- 起始物品调 update_item 后即刻生效（玩家已开自动审批），叙事可以正常描述物品已在身上，不必引导"等玩家确认"。'
        );
      } else {
        lines.push(
          '- 起始物品**同样走 pending 审批流**：调 update_item 后等玩家在面板上点确认。叙事中可以用"你打算清点一下手头的东西"等措辞引导玩家审批，不要假定物品已落地。'
        );
      }
    }

    lines.push('');
    lines.push('## 主动引导（让物品流动有"经济感"）：');
    lines.push(
      '物品和货币交易是世界活力的一部分。叙事**不应只**等玩家明确触发——在合适的场景下应主动制造物品流动：'
    );
    lines.push(
      '- **NPC 主动给予 / 索要**：商贩塞试用品、长辈赠信物、债主追账、街边小偷下手、雇主预付定金、孩子讨糖。'
    );
    lines.push(
      '- **环境拾取**：地上的钱袋、桌上忘拿的物件、抽屉里的旧文件、河边漂来的瓶子、敌人尸体上的遗物。'
    );
    lines.push(
      '- **NPC 经济反应**：玩家给钱物后，NPC 应有具体反应——还礼 / 找零 / 涨价 / 讨价 / 拒收 / 找借口拖延 / 收下后冷淡；不要只"行，收下"了事。'
    );
    lines.push(
      '- **物品损耗**：消耗品被吃掉 / 喝掉、武器在战斗中崩缺、衣服被刮破、灯油烧完、信件被雨淋湿。'
    );
    lines.push(
      '- **任务奖赏**：完成跑腿 / 护送 / 修件 / 打听后，NPC 应主动结算（钱 / 信物 / 食物 / 情报 / 引荐信），用 update_item 提交。'
    );
    lines.push(
      '- 物品流动是"自然涌出"而非"刻意制造"。不必每回合都有，但绝不要刻意回避。给 4 个 choices 里的至少 1-2 个**潜在涉及物品变化**的选项（购买 / 偷取 / 赠送 / 检查物件等），让玩家有"动手"的空间。'
    );

    return lines.join('\n');
  }

  _hasStructuredGameHistory() {
    if (typeof chatHistory === 'undefined' || !Array.isArray(chatHistory)) return false;
    for (let index = chatHistory.length - 1; index >= 0; index--) {
      const message = chatHistory[index];
      if (!message || message.sender !== 'ai') continue;
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (!text) continue;
      try {
        const parsed = this._parseJsonTextLoose(text);
        if (parsed?.panel_status && typeof parsed.panel_status === 'object') {
          return true;
        }
      } catch (_error) {
        // Opening greeting / plain text messages are ignored on purpose.
      }
    }
    return false;
  }

  _normalizeAndValidateChoiceObject(rawChoice, options = {}) {
    const { expectedId = null, index = 0, requireId = true } = options;
    if (!rawChoice || typeof rawChoice !== 'object' || Array.isArray(rawChoice)) {
      return {
        isValid: false,
        choice: null,
        reason: `第 ${index + 1} 个 choice 不是对象`,
      };
    }

    const typeTag = this._normalizeChoiceTypeTag(rawChoice.type_tag);
    const rawEffectDays = this._normalizeChoiceEffectDays(rawChoice.effect_days);
    const normalized = {
      id: typeof rawChoice.id === 'string' ? rawChoice.id.trim() : '',
      type_tag: typeTag,
      short_text: typeof rawChoice.short_text === 'string' ? rawChoice.short_text.trim() : '',
      detail_text: typeof rawChoice.detail_text === 'string' ? rawChoice.detail_text.trim() : '',
      cost_hint: typeof rawChoice.cost_hint === 'string' ? rawChoice.cost_hint.trim() : '',
      effect_time: this._getExpectedChoiceEffectTime(typeTag),
      effect_days: rawEffectDays,
    };

    if (requireId && normalized.id !== expectedId) {
      return {
        isValid: false,
        choice: null,
        reason: `第 ${index + 1} 个 choice.id 必须是 ${expectedId}`,
      };
    }

    if (!STEP3_CHOICE_TYPE_TAGS.has(normalized.type_tag)) {
      return {
        isValid: false,
        choice: null,
        reason: `第 ${index + 1} 个 choice.type_tag 不合法（必须是 explore/trade/travel/work/talk/action 之一）`,
      };
    }

    if (!normalized.short_text || !normalized.detail_text) {
      return {
        isValid: false,
        choice: null,
        reason: `第 ${index + 1} 个 choice 缺少必填字段（short_text/detail_text 不能为空）`,
      };
    }

    if (!normalized.cost_hint) {
      return {
        isValid: false,
        choice: null,
        reason: `第 ${index + 1} 个 choice.cost_hint 不能为空（写一句简短代价提示即可，如"+3天"、"风险中等"、"-30 银币"）`,
      };
    }

    if (normalized.cost_hint.length > 20) {
      return {
        isValid: false,
        choice: null,
        reason: `第 ${index + 1} 个 choice.cost_hint 超过 20 字（实长 ${normalized.cost_hint.length}），请精简`,
      };
    }

    if (STEP3_CHOICE_DAY_TYPES.has(normalized.type_tag)) {
      if (!Number.isInteger(normalized.effect_days) || normalized.effect_days <= 0) {
        return {
          isValid: false,
          choice: null,
          reason: `第 ${index + 1} 个 choice.effect_days 必须为正整数（${normalized.type_tag} 类型必填，=本回合时间推进天数）`,
        };
      }
    } else {
      // 非 travel/work：缺失或 0 都接受；非 0 也静默归 0（不再 reject 以避免 noise）
      normalized.effect_days = 0;
    }

    return {
      isValid: true,
      choice: normalized,
      reason: '',
    };
  }

  _normalizeProviderBaseUrl(value) {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/\/+$/, '');
  }

  _isValidHttpUrl(value) {
    if (!value) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch (_e) {
      return false;
    }
  }

  _normalizeConfig(config) {
    const normalized = { ...(config || {}) };
    const builtinProviders = Object.keys(BUILTIN_PROVIDER_DEFAULT_MODELS);
    // 历史遗留：任何 core prompt 覆写字段一律移除，确保核心提示词固定不可改写
    LEGACY_CORE_PROMPT_FIELDS.forEach(field => {
      if (field in normalized) delete normalized[field];
    });

    // 归一化自定义 provider 列表，避免非法/重复条目污染模块配置
    const rawCustomProviders = Array.isArray(normalized.customProviders)
      ? normalized.customProviders
      : [];
    const seenCustomProviderIds = new Set();
    normalized.customProviders = rawCustomProviders.reduce((acc, item) => {
      if (!item || typeof item !== 'object') return acc;
      const id = typeof item.id === 'string' ? item.id.trim() : '';
      if (!id) return acc;
      if (builtinProviders.includes(id)) return acc;
      if (seenCustomProviderIds.has(id)) return acc;
      seenCustomProviderIds.add(id);
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : id;
      const baseUrl = this._normalizeProviderBaseUrl(item.baseUrl);
      const defaultModel = typeof item.defaultModel === 'string' ? item.defaultModel.trim() : '';
      const protocol = item.protocol === 'anthropic' ? 'anthropic' : 'openai';
      const maxOutputTokensEnabled = item.maxOutputTokensEnabled === true;
      const rawMaxOutputTokens = Number(item.maxOutputTokens);
      const maxOutputTokens =
        Number.isFinite(rawMaxOutputTokens) && rawMaxOutputTokens > 0
          ? Math.floor(rawMaxOutputTokens)
          : null;
      acc.push({
        id,
        name,
        baseUrl,
        defaultModel,
        protocol,
        maxOutputTokensEnabled,
        maxOutputTokens,
      });
      return acc;
    }, []);

    // 归一化自定义 system prompt 列表（多条 + role 选择）
    // 兼容老字段 customSystemPrompt: string —— 若非空则作为新列表首项 (role=system) 迁入后删除
    {
      const rawList = Array.isArray(normalized.customSystemPrompts)
        ? normalized.customSystemPrompts
        : [];
      const migrated = [];
      const legacy =
        typeof normalized.customSystemPrompt === 'string'
          ? normalized.customSystemPrompt.trim()
          : '';
      if (legacy) {
        migrated.push({
          id: 'cp_legacy_' + Date.now(),
          role: 'system',
          content: legacy,
          enabled: true,
        });
      }
      for (const item of rawList) {
        if (!item || typeof item !== 'object') continue;
        const content = typeof item.content === 'string' ? item.content : '';
        if (!content.trim()) continue;
        const role = item.role === 'user' ? 'user' : 'system';
        const enabled = item.enabled !== false; // 默认启用；只有显式 false 才视为禁用
        const id =
          typeof item.id === 'string' && item.id
            ? item.id
            : 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        migrated.push({ id, role, content, enabled });
      }
      normalized.customSystemPrompts = migrated;
      if ('customSystemPrompt' in normalized) {
        delete normalized.customSystemPrompt;
      }
    }

    // 归一化 providerApiKeys：保留内置和仍存在的自定义 provider
    const validProviders = new Set([
      ...builtinProviders,
      ...normalized.customProviders.map(item => item.id),
    ]);
    const rawProviderApiKeys =
      normalized.providerApiKeys &&
      typeof normalized.providerApiKeys === 'object' &&
      !Array.isArray(normalized.providerApiKeys)
        ? normalized.providerApiKeys
        : {};
    const normalizedProviderApiKeys = {};
    for (const [providerId, rawKey] of Object.entries(rawProviderApiKeys)) {
      if (!validProviders.has(providerId)) continue;
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) continue;
      normalizedProviderApiKeys[providerId] = key;
    }
    normalized.providerApiKeys = normalizedProviderApiKeys;

    // 推荐模式默认值：仅当字段缺失（新用户）时初始化。
    // 已绑 deepseek 官方 key 的新用户默认进推荐模式；否则进简单模式。
    // 老用户保存的 'simple' / 'advanced' 不动。
    if (typeof normalized.apiSettingsMode !== 'string') {
      normalized.apiSettingsMode = normalizedProviderApiKeys.deepseek
        ? 'recommended'
        : 'simple';
    }

    // 自动审批开关（NPC 字段更新 / 物品+货币变更）
    normalized.autoApproveNpc = normalized.autoApproveNpc === true;
    normalized.autoApproveInventory = normalized.autoApproveInventory === true;

    // 归一化 modelPrices：仅保留有效非负数字
    const rawModelPrices =
      normalized.modelPrices &&
      typeof normalized.modelPrices === 'object' &&
      !Array.isArray(normalized.modelPrices)
        ? normalized.modelPrices
        : {};
    const normalizedModelPrices = {};
    for (const [rawPriceKey, rawPriceValue] of Object.entries(rawModelPrices)) {
      let priceKey = typeof rawPriceKey === 'string' ? rawPriceKey.trim() : '';
      if (!priceKey) continue;
      if (!rawPriceValue || typeof rawPriceValue !== 'object' || Array.isArray(rawPriceValue))
        continue;

      const inPrice = Number(rawPriceValue.in);
      const outPrice = Number(rawPriceValue.out);
      if (!Number.isFinite(inPrice) || inPrice < 0) continue;
      if (!Number.isFinite(outPrice) || outPrice < 0) continue;

      normalizedModelPrices[priceKey] = { in: inPrice, out: outPrice };
    }
    normalized.modelPrices = normalizedModelPrices;

    if (
      !normalized.modules ||
      typeof normalized.modules !== 'object' ||
      Array.isArray(normalized.modules)
    ) {
      normalized.modules = {};
    }
    if (Object.prototype.hasOwnProperty.call(normalized.modules, 'gm')) {
      delete normalized.modules['gm'];
    }
    REQUIRED_MODULES.forEach(moduleId => {
      const moduleDefaultConfig = this._buildDefaultModuleConfig(
        moduleId,
        null,
        normalized.customProviders
      );
      const moduleConfig = normalized.modules[moduleId];
      if (!moduleConfig || typeof moduleConfig !== 'object' || Array.isArray(moduleConfig)) {
        normalized.modules[moduleId] = {
          ...moduleDefaultConfig,
        };
        return;
      }

      const rawProvider =
        typeof moduleConfig.provider === 'string' ? moduleConfig.provider.trim() : '';
      const provider = validProviders.has(rawProvider) ? rawProvider : moduleDefaultConfig.provider;
      const defaultModel = this._getDefaultModelForProvider(
        provider,
        normalized.customProviders,
        moduleId
      );
      const rawModel = typeof moduleConfig.model === 'string' ? moduleConfig.model.trim() : '';
      const providerChanged = provider !== rawProvider;
      let model = !rawModel || providerChanged ? defaultModel : rawModel;
      // DeepSeek V4 上线后旧模型名一次性重写：
      //   deepseek-chat     → v4-flash + thinking off（保留无推理行为）
      //   deepseek-reasoner → v4-flash + thinking high（保留推理行为）
      let migratedThinking = null;
      if (provider === 'deepseek') {
        if (model === 'deepseek-chat') {
          model = 'deepseek-v4-flash';
          migratedThinking = 'off';
        } else if (model === 'deepseek-reasoner') {
          model = 'deepseek-v4-flash';
          migratedThinking = 'high';
        }
      }
      const defaultTemperature = this._getDefaultTemperatureForModule(moduleId, provider);
      const temperature = this._normalizeTemperatureValue(
        moduleConfig.temperature,
        defaultTemperature
      );
      const rawThinking =
        typeof moduleConfig.thinking === 'string' ? moduleConfig.thinking.trim().toLowerCase() : '';
      let thinking = DEEPSEEK_THINKING_LEVELS.includes(rawThinking)
        ? rawThinking
        : DEEPSEEK_THINKING_DEFAULT;
      if (migratedThinking && !DEEPSEEK_THINKING_LEVELS.includes(rawThinking)) {
        thinking = migratedThinking;
      }
      normalized.modules[moduleId] = { ...moduleConfig, provider, model, temperature, thinking };
    });
    normalized.useSummaryContext =
      typeof normalized.useSummaryContext === 'boolean' ? normalized.useSummaryContext : true;
    normalized.recentMessageCount = this._normalizeRecentMessageCount(
      normalized.recentMessageCount
    );
    normalized.themeName = (typeof normalized.themeName === 'string' && normalized.themeName) ? normalized.themeName : 'metro';
    normalized.themeMode = THEME_MODES.has(normalized.themeMode) ? normalized.themeMode : 'light';
    normalized.backgroundMode = BG_MODES.has(normalized.backgroundMode) ? normalized.backgroundMode : 'solid';
    {
      const rawCustom = normalized.backgroundCustom && typeof normalized.backgroundCustom === 'object' && !Array.isArray(normalized.backgroundCustom)
        ? normalized.backgroundCustom
        : {};
      const clamp = (v, min, max, fallback) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(max, Math.max(min, n));
      };
      normalized.backgroundCustom = {
        positionX: clamp(rawCustom.positionX, 0, 100, 50),
        positionY: clamp(rawCustom.positionY, 0, 100, 50),
        scale: clamp(rawCustom.scale, 100, 300, 100),
      };
    }
    normalized.uiLanguage = UI_LANGUAGES.has(normalized.uiLanguage)
      ? normalized.uiLanguage
      : 'auto';
    normalized.uiScaleMode = UI_SCALE_MODES.has(normalized.uiScaleMode)
      ? normalized.uiScaleMode
      : 'auto';
    normalized.uiScale = this._normalizeUIScaleValue(normalized.uiScale);
    normalized.narrativeLength =
      normalized.narrativeLength === 'short' ||
      normalized.narrativeLength === 'medium' ||
      normalized.narrativeLength === 'long'
        ? normalized.narrativeLength
        : 'medium';
    if (typeof normalized.disableResidentFunctions !== 'boolean') {
      normalized.disableResidentFunctions = false;
    }
    // 清理已废弃的遗留配置字段
    delete normalized.enableNpcReaction;
    delete normalized.defaultCoreWorldMechanicsOverride;
    delete normalized.disableDefaultWorldCardFunctions;
    delete normalized.disableAllDefaultFunctions;
    delete normalized.providerBaseUrls;
    return normalized;
  }

  // 获取指定服务商的 API Key
  getProviderApiKey(provider, options = {}) {
    const configSource = this._getConfigSource(options) || {};
    return configSource.providerApiKeys?.[provider] || '';
  }

  // 获取指定 OpenAI 兼容 provider 的 Base URL（固定使用内置默认）
  getProviderBaseUrl(provider) {
    const providerId = typeof provider === 'string' ? provider.trim() : '';
    if (!providerId) return BUILTIN_PROVIDER_DEFAULT_BASE_URLS.openai;
    return (
      BUILTIN_PROVIDER_DEFAULT_BASE_URLS[providerId] || BUILTIN_PROVIDER_DEFAULT_BASE_URLS.openai
    );
  }

  // 设置指定服务商的 API Key
  setProviderApiKey(provider, apiKey) {
    if (!this.config.providerApiKeys) this.config.providerApiKeys = {};
    this.config.providerApiKeys[provider] = apiKey;
    this.config = this._normalizeConfig(this.config);
    localStorage.setItem('ai_adventure_settings', JSON.stringify(this.config));
  }

}

// 暴露 class 引用，供后续 ai/*.js mixin 文件使用
window.AIService = AIService;

// 创建全局实例
const aiService = new AIService();
window.aiService = aiService; // 暴露给 GTT 控制台访问
