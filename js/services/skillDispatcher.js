// ============================================
// Skill Dispatcher — 并发结算 subagent 调度器
// ============================================
// 管理 settlement phase 的独立 API 调用 skill
// 每个 skill 有专属 system prompt + 工具集 + 上下文构建器
// 框架支持 N 个 skill 并发执行（Promise.allSettled）
// ============================================

class SkillDispatcher {
  constructor() {
    /** @type {Map<string, SkillDefinition>} */
    this._skills = new Map();
  }

  // ── 注册 / 查询 ──

  /**
   * 注册一个 skill
   * @param {string} name - skill 名称（通常与管理的主工具同名）
   * @param {Object} def
   * @param {string} def.phase - 所属阶段（'settlement'）
   * @param {boolean} def.required - 是否每回合必跑；同时驱动 tool_choice 锁定：
   *   required=true 且 tools.length===1 时该 skill 的 LLM call 自动用 specific tool_choice 锁该工具
   * @param {string[]} def.tools - toolRegistry 中该 skill 管理的工具名列表
   * @param {(ctx: Object) => string} def.promptTemplate - 生成 system prompt
   * @param {(turnCtx: Object) => Object} def.contextBuilder - 提取 skill 所需上下文
   * @param {(toolResults: Array) => Object} def.resultHandler - 处理工具执行结果
   * @param {(turnCtx: Object) => boolean} [def.shouldRun] - 可选；返回 false 则跳过整个 LLM call。
   *   让 skill 自己根据 turnCtx 判断是否需要跑（如 inventorySkill 仅在主循环 0 次 update_item 时启动）。
   *   默认视为始终需要跑。
   */
  register(name, def) {
    if (!name || !def) {
      console.warn(`[SkillDispatcher] 注册失败: 缺少 name 或 def`);
      return;
    }
    this._skills.set(name, {
      phase: def.phase || 'settlement',
      required: def.required === true,
      tools: Array.isArray(def.tools) ? def.tools : [],
      promptTemplate: typeof def.promptTemplate === 'function' ? def.promptTemplate : () => '',
      contextBuilder: typeof def.contextBuilder === 'function' ? def.contextBuilder : () => ({}),
      resultHandler: typeof def.resultHandler === 'function' ? def.resultHandler : (r) => r,
      shouldRun: typeof def.shouldRun === 'function' ? def.shouldRun : null,
    });
    console.log(`[SkillDispatcher] 已注册 skill: ${name} (phase=${def.phase}, required=${!!def.required}, tools=[${def.tools}])`);
  }

  unregister(name) {
    this._skills.delete(name);
  }

  has(name) {
    return this._skills.has(name);
  }

  list() {
    return Array.from(this._skills.keys());
  }

  get size() {
    return this._skills.size;
  }

  /** 查询指定 phase 是否有已注册的 skill */
  hasSkillsForPhase(phase) {
    for (const skill of this._skills.values()) {
      if (skill.phase === phase) return true;
    }
    return false;
  }

  /** 返回指定 phase 所有 skill 管理的工具名列表 */
  getManagedToolsForPhase(phase) {
    const tools = [];
    for (const skill of this._skills.values()) {
      if (skill.phase === phase) {
        tools.push(...skill.tools);
      }
    }
    return tools;
  }

  // ── 核心调度 ──

  /**
   * 并发执行所有已注册 skill
   * @param {Object} turnCtx - 回合上下文
   * @param {string} turnCtx.narrativeText - 本回合叙事累积文本
   * @param {Object} turnCtx.gameState - buildTurnResult() 快照
   * @param {Object|null} turnCtx.settlementHints - _currentTurnSettlementHints
   * @param {Object} turnCtx.adapter - 当前 AI adapter（用于获取 provider 配置）
   * @param {number} turnCtx.temperature - 温度
   * @param {AbortSignal} [turnCtx.abortSignal]
   * @param {Object} aiService - AIService 实例（延迟传入，不在构造时绑定）
   * @returns {Promise<DispatchResult>}
   */
  async dispatch(turnCtx, aiService) {
    if (this._skills.size === 0) {
      return { completedTools: [], failedSkills: [], summary: {}, skillResults: {} };
    }

    // emit 开始事件
    if (window.eventBus && window.GameEvents?.SETTLEMENT_DISPATCH_START) {
      window.eventBus.emit(window.GameEvents.SETTLEMENT_DISPATCH_START, {
        skills: this.list(),
      });
    }

    // 打开 UI 诊断窗口：追"卡住/横跳只在 update_panel 阶段"症状用，
    // 上报 settlement 期间的 refreshChatUI 等 UI 调用时序。
    window.__uiDiag?.setSettlement?.(true);
    window.__uiDiag?.track?.('diag.settlement.start', { skills: this.list() });

    const startTime = performance.now();

    // 并发执行
    const tasks = [];
    const names = [];
    for (const [name, skill] of this._skills) {
      names.push(name);
      tasks.push(this._runSingleSkill(name, skill, turnCtx, aiService));
    }
    const outcomes = await Promise.allSettled(tasks);

    const result = this._mergeOutcomes(names, outcomes);
    result.duration = performance.now() - startTime;

    // emit 完成事件
    if (window.eventBus && window.GameEvents?.SETTLEMENT_DISPATCH_COMPLETE) {
      window.eventBus.emit(window.GameEvents.SETTLEMENT_DISPATCH_COMPLETE, {
        skills: result.skillResults,
        completedTools: result.completedTools,
        failedSkills: result.failedSkills,
        totalDuration: result.duration,
      });
    }

    window.__uiDiag?.track?.('diag.settlement.complete', {
      duration_ms: Math.round(result.duration),
      completed_tools: result.completedTools,
      failed_skills: result.failedSkills,
    });
    window.__uiDiag?.setSettlement?.(false);

    console.log(
      `[SkillDispatcher] dispatch 完成: ${result.completedTools.length} tools OK, ${result.failedSkills.length} skills failed, ${Math.round(result.duration)}ms`
    );

    return result;
  }

  /**
   * 执行单个 skill 的完整流程
   * @private
   */
  async _runSingleSkill(name, skill, turnCtx, aiService) {
    const skillStart = performance.now();

    // 1) skill 自定义 shouldRun 钩子：让 skill 根据 turnCtx 自决是否跳过整个 LLM call
    //    （inventorySkill 用它来在主循环已成功调过 update_item 时跳过审计）
    if (typeof skill.shouldRun === 'function') {
      let shouldRun = true;
      try { shouldRun = skill.shouldRun(turnCtx) !== false; } catch (e) {
        console.warn(`[SkillDispatcher] skill "${name}" shouldRun 抛错，默认放行:`, e);
      }
      if (!shouldRun) {
        console.log(`[SkillDispatcher] skill "${name}" shouldRun=false，跳过 subagent`);
        return {
          skillName: name,
          completedTools: [...skill.tools],
          toolResults: [],
          handlerResult: { skipped: true, reason: 'should_run_returned_false' },
          metrics: {},
          duration: performance.now() - skillStart,
        };
      }
    }

    console.log(`[SkillDispatcher] 开始执行 skill: ${name}`);

    // 1. 构建上下文
    const ctx = skill.contextBuilder(turnCtx);

    // 2. 生成 system prompt
    const systemPrompt = skill.promptTemplate(ctx);

    // 3. 获取 skill 的工具声明
    const registry = window.toolRegistry;
    if (!registry) throw new Error('toolRegistry 未加载');

    const allDeclarations = registry.getDeclarations();
    const skillDeclarations = allDeclarations.filter(d => skill.tools.includes(d.name));
    if (skillDeclarations.length === 0) {
      throw new Error(`skill "${name}" 的工具 [${skill.tools}] 未在 toolRegistry 中找到`);
    }

    // 4. 创建 adapter（iter 8 settlement 专属配置：v4-flash + thinking=off in recommended mode；
    //    非推荐模式下 aliasMap 兜底到用户的 'react' 选择，行为不变）
    const adapter = aiService._getAdapter('iter8_settlement', typeof AI_REQUEST_SCOPED !== 'undefined' ? AI_REQUEST_SCOPED : {});
    const reactLoop = aiService.reactLoop;
    if (!reactLoop) throw new Error('reactLoop 未初始化');

    // 5. 转换工具声明为 adapter 格式
    const adapterTools = reactLoop.buildAdapterTools(skillDeclarations, adapter);

    // 6. 构建 user message（按协议家族适配；精简上下文，不带对话历史）
    // 用 protocolFamily 而非 provider：custom Anthropic provider 的 provider='custom' 但 protocolFamily='anthropic'
    const userContent = typeof ctx === 'string' ? ctx : JSON.stringify(ctx, null, 2);
    const provider = adapter?.provider || 'gemini'; // 用于日志/telemetry
    const family = adapter?.protocolFamily || provider;
    const userMessage =
      family === 'gemini'
        ? { role: 'user', parts: [{ text: userContent }] }
        : family === 'anthropic'
          ? { role: 'user', content: [{ type: 'text', text: userContent }] }
          : { role: 'user', content: userContent };

    // 7. buildPayload
    const thinkingLevel = typeof aiService.getModuleThinking === 'function'
      ? aiService.getModuleThinking('iter8_settlement', typeof AI_REQUEST_SCOPED !== 'undefined' ? AI_REQUEST_SCOPED : {})
      : 'off';
    // 启发式锁工具：required/softRequired 且仅 1 个工具的 skill → 锁该工具
    //   panelSkill (softRequired, [update_panel]) → tool_choice: { name: 'update_panel' }
    //   inventorySkill (!required, [update_item]) → 'auto'（保留"零调用 = 无漏报"信号）
    // softRequired 与 required 在 tool_choice 锁定行为上一致；区别仅在事后处理：
    //   required → 未调用任何工具时 throw（视为隐性失败，避免主循环卡死）
    //   softRequired → 未调用任何工具时仅 warn（模型判断本回合无变化是合法情况）
    const toolChoice = ((skill.required || skill.softRequired) && skill.tools.length === 1)
      ? { name: skill.tools[0] }
      : 'auto';
    const { payload, url } = adapter.buildPayload(
      [userMessage],
      [systemPrompt],
      adapterTools,
      { temperature: turnCtx.temperature || 1.0, thinking: thinkingLevel, toolChoice }
    );

    // 7b. step 日志注入 aiService.lastPayload.steps（让调试面板可见 subagent 调用）
    const stepLog = {
      step: aiService?.accumulatedStepCount ?? null,
      phase: `skill:${name}`,
      model: adapter?.config?.model || null,
      provider,
      request: (() => {
        try { return typeof structuredClone === 'function' ? structuredClone(payload) : JSON.parse(JSON.stringify(payload)); } catch { return null; }
      })(),
      url: typeof url === 'string' ? url.replace(/key=[^&]+/, 'key=***') : null,
    };
    if (aiService?.lastPayload?.steps && Array.isArray(aiService.lastPayload.steps)) {
      aiService.lastPayload.steps.push(stepLog);
    }
    aiService?._markStepStarted?.(stepLog);

    // 8. 调用 API（非流式）
    let apiResult;
    const _saT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const _saModel = adapter?.config?.model || null;
    try {
      apiResult = await adapter.callAPI(url, payload, null, turnCtx.abortSignal);
      stepLog.response = apiResult.raw;
      stepLog.metrics = apiResult.metrics;
      aiService?._markStepSucceeded?.(stepLog);
      aiService?._trackSubagentCall?.({
        subsystem: 'settlement_' + name,
        provider,
        model: _saModel,
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _saT0,
        metrics: apiResult?.metrics || null,
        ok: true,
      });
    } catch (e) {
      aiService?._markStepFailure?.(stepLog, e, {
        phase: `skill:${name}`,
        module: 'react',
        provider,
        model: _saModel,
        url,
      });
      aiService?._trackSubagentCall?.({
        subsystem: 'settlement_' + name,
        provider,
        model: _saModel,
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _saT0,
        ok: false,
        errorMessage: e?.message || String(e),
      });
      throw e;
    }

    // 9. 解析 tool calls
    const { toolCalls, needsRecovery, recoveredCalls } = adapter.parseToolCalls(apiResult.raw);
    const calls = needsRecovery ? recoveredCalls : toolCalls;

    // 10. 执行工具 + signal 广播
    const toolResults = [];
    const completedTools = [];

    for (const call of calls) {
      if (!skill.tools.includes(call.name)) {
        console.warn(`[SkillDispatcher] skill "${name}" 收到非预期工具调用: ${call.name}，跳过`);
        continue;
      }

      try {
        const rawResult = await registry.execute(call.name, call.args);
        const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);

        toolResults.push({ name: call.name, args: call.args, result: resultStr, success: true });
        completedTools.push(call.name);

        // Signal 广播（补齐 _executeReactTools 中的语义）
        if (window.eventBus && window.GameEvents) {
          let parsedResult = resultStr;
          try { parsedResult = JSON.parse(resultStr); } catch { /* keep string */ }

          const signalPayload = {
            name: call.name,
            args: call.args || {},
            result: parsedResult,
            phase: skill.phase,
            source: 'dispatcher',
          };

          if (window.GameEvents.TOOL_EXECUTED) {
            window.eventBus.emit(window.GameEvents.TOOL_EXECUTED, signalPayload);
          }
          const toolSignal = registry.getSignal?.(call.name);
          if (toolSignal) {
            window.eventBus.emit(toolSignal, signalPayload);
          }
        }

        console.log(`[SkillDispatcher] skill "${name}" 工具 ${call.name} 执行成功`);
      } catch (e) {
        console.error(`[SkillDispatcher] skill "${name}" 工具 ${call.name} 执行失败:`, e);
        toolResults.push({ name: call.name, args: call.args, error: e.message, success: false });
      }
    }

    // 10b. 严格检测：required skill 必须实际成功执行至少一个声明工具
    // 否则视为隐性失败（避免主循环 phase 卡死）
    if (skill.required && skill.tools.length > 0 && completedTools.length === 0) {
      throw new Error(
        `skill "${name}" 是 required 但未实际成功调用任何声明工具 [${skill.tools.join(', ')}]（AI 可能误判为不需要更新）`
      );
    }

    // 10c. softRequired：模型偶尔判断"本回合无字段变化"不调用工具是合法情况，不再 throw。
    // 仅 warn，让 resultHandler 继续接收空 toolResults（约定返回 { skipped: true, ... }）。
    if (skill.softRequired && skill.tools.length > 0 && completedTools.length === 0) {
      console.warn(
        `[SkillDispatcher] skill "${name}" softRequired 未调用 [${skill.tools.join(', ')}]，按"无变化"放行`
      );
    }

    // 11. resultHandler
    const handlerResult = skill.resultHandler(toolResults);

    const skillDuration = performance.now() - skillStart;

    // emit 单 skill 完成事件
    if (window.eventBus && window.GameEvents?.SETTLEMENT_SKILL_COMPLETE) {
      window.eventBus.emit(window.GameEvents.SETTLEMENT_SKILL_COMPLETE, {
        skillName: name,
        result: handlerResult,
        duration: skillDuration,
      });
    }

    console.log(`[SkillDispatcher] skill "${name}" 完成 (${Math.round(skillDuration)}ms)`);

    return {
      skillName: name,
      completedTools,
      toolResults,
      handlerResult,
      metrics: apiResult.metrics || {},
      duration: skillDuration,
    };
  }

  /**
   * 汇总 allSettled 结果
   * @private
   */
  _mergeOutcomes(names, outcomes) {
    const completedTools = [];
    const failedSkills = [];
    const summary = {};
    const skillResults = {};

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const outcome = outcomes[i];

      if (outcome.status === 'fulfilled') {
        const result = outcome.value;
        completedTools.push(...result.completedTools);
        summary[name] = result.handlerResult;
        skillResults[name] = { status: 'succeeded', ...result };
      } else {
        failedSkills.push(name);
        summary[name] = { error: outcome.reason?.message || String(outcome.reason) };
        skillResults[name] = { status: 'failed', error: outcome.reason?.message || String(outcome.reason) };
        console.error(`[SkillDispatcher] skill "${name}" 失败:`, outcome.reason);
      }
    }

    return { completedTools, failedSkills, summary, skillResults };
  }
}

// 自注册单例（与 toolRegistry 同模式）
const skillDispatcher = new SkillDispatcher();
window.skillDispatcher = skillDispatcher;
