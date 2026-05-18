// ============================================
// NPC Intro Audit Subagent（代号 him）
// ============================================
// 回合叙事定稿后，与写 choice 那一步（_runChoicesIteration）并行 Promise.all 发出、
// 回合内 await。让模型看完本回合最终全叙事 + 当前已登场名单 + 预定义池，判断是否有
// **重要新角色**在叙事中登场却没进角色档案；如有则调 new_npc / load_predefined_npc
// 建卡（走现有 npcStore.processNpcPanel 落地，建卡即面板可见）。
//
// 与 npcCardSync 解耦（数据源不同就该是两个 agent）：
//   - npcCardSync：已存在 NPC 身份层字段，数据源 = 该 NPC 自己的 reaction
//   - 本 subagent：漏建卡的新角色，数据源 = 本回合最终叙事
// 本 subagent **不碰** update_npc / update_item。
//
// 模型配置：独立模块键 'npc_intro_audit'（推荐模式默认 deepseek-v4-pro + thinking=max，
// 非推荐 off）。**不复用** reactAdapter / npc_reaction 配置——必须端到端走自己的
// adapter + 模型，否则"him 用强思考模型"这条锁定决策落空。
//
// 失败处理：内部不阻塞主流程，caller（react.js B3 的 Promise.all）用 .catch 吞。
// ============================================

class _AIServiceNpcIntroAuditMixin {
  /**
   * 回合叙事定稿后调用一次登场审计 subagent。
   * @param {string} narrativeText - 本回合最终叙事（= narrativeAccRef.value）
   * @param {Array} chatHistory - 对话历史；B6 取最近 N 条原文，配 summaryService 摘要，
   *                               让 him 能判"跨回合反复出现/早有铺垫"的角色重要性
   * @returns {Promise<void>}
   */
  async _runNpcIntroAuditSubagent(narrativeText, chatHistory) {
    // ── 空叙事守卫：iter1-7 全 crash 路 → 叙事为空 → 直接 no-op ──
    if (!narrativeText || typeof narrativeText !== 'string' || !narrativeText.trim()) {
      console.warn('[NPC IntroAudit] 叙事为空，跳过');
      return;
    }

    const registry = window.toolRegistry;
    if (!registry) {
      console.warn('[NPC IntroAudit] toolRegistry 未加载，跳过');
      return;
    }
    if (!window.promptRegistry) {
      console.warn('[NPC IntroAudit] promptRegistry 未加载，跳过');
      return;
    }
    if (!this.reactLoop) {
      console.warn('[NPC IntroAudit] reactLoop 未初始化，跳过');
      return;
    }

    // 自建 npc_intro_audit adapter —— 不借 reactAdapter（否则用错 provider/model）
    let adapter;
    try {
      adapter = this._getAdapter('npc_intro_audit', AI_REQUEST_SCOPED);
    } catch (e) {
      console.warn('[NPC IntroAudit] 无法构建 npc_intro_audit adapter，跳过:', e?.message || e);
      return;
    }
    if (!adapter) {
      console.warn('[NPC IntroAudit] npc_intro_audit adapter 为空，跳过');
      return;
    }

    // 取声明：内部自动 refreshNpcTools（id enum 反映当前已登场）+ 应用用户 deletedFunctions
    const allDecls = typeof this._getReactLoopFunctionDeclarations === 'function'
      ? this._getReactLoopFunctionDeclarations()
      : registry.getReactLoopDeclarations();
    const newNpcDecl = allDecls.find(d => d.name === 'new_npc');
    const loadPredefDecl = allDecls.find(d => d.name === 'load_predefined_npc');
    const himDecls = [newNpcDecl, loadPredefDecl].filter(Boolean);
    if (himDecls.length === 0) {
      // new_npc/load_predefined_npc 都不可用（被用户禁用等），nothing to do
      return;
    }
    const allowedNames = new Set(himDecls.map(d => d.name));

    // 构造 prompt context（roster/pool 直接读 npcStore；摘要/近回合复用现成件，B6）
    // 摘要源 = summaryService.getSummaries()，与 formatMessages 同源，口径同主 iter
    const summaries = (window.summaryService && typeof window.summaryService.getSummaries === 'function')
      ? (window.summaryService.getSummaries() || [])
      : [];
    const summaryDigest = Array.isArray(summaries) ? summaries.filter(Boolean).join('\n') : '';
    // 最近 N 回合原文：摘要压缩掉的近文细节，对应主 iter "摘要 + 最近原文" 口径
    const RECENT_N = 3;
    const recentTurns = (Array.isArray(chatHistory) ? chatHistory.slice(-RECENT_N) : [])
      .map(m => `[${m && m.sender === 'user' ? '玩家' : 'AI'}]: ${(m && m.text) || ''}`)
      .join('\n\n');
    const ctx = this._buildNpcIntroAuditContext(narrativeText, summaryDigest, recentTurns);

    // 装配 system prompt（promptRegistry 是核心依赖，无 fallback）
    const { parts } = window.promptRegistry.assembleChannel('npcIntroAudit', ctx);
    const systemText = parts.map(p => p.text).filter(Boolean).join('\n\n');

    // tools (adapter format)
    const adapterTools = this.reactLoop.buildAdapterTools(himDecls, adapter);

    // user message（by protocol family）—— 提示模型现在该输出 tool_calls
    const userContent = '请基于上文最终叙事与当前已登场名单，判定是否有重要新角色漏建卡。零调用合法；命中预定义池用 load_predefined_npc，纯原创用 new_npc，已在名单的不要调，不要调 update_npc/update_item。';
    const family = adapter?.protocolFamily || adapter?.provider || 'gemini';
    const userMessage =
      family === 'gemini'
        ? { role: 'user', parts: [{ text: userContent }] }
        : family === 'anthropic'
          ? { role: 'user', content: [{ type: 'text', text: userContent }] }
          : { role: 'user', content: userContent };

    // 温度 + thinking：读 'npc_intro_audit'（**不要**照抄 npcCardSync 的 'npc_reaction'）
    const temperature = this.getModuleTemperature('npc_intro_audit', 1.0, AI_REQUEST_SCOPED);
    const isRecommended = this.getEffectiveApiSettingsMode(AI_REQUEST_SCOPED) === 'recommended';
    const thinking = isRecommended
      ? this.getModuleThinking('npc_intro_audit', AI_REQUEST_SCOPED)
      : 'off';

    const { payload, url } = adapter.buildPayload(
      [userMessage],
      [{ text: systemText, cacheable: false, tag: 'npc_intro_audit' }],
      adapterTools,
      { temperature, thinking, toolChoice: 'auto' }
    );

    // stepLog 注入 lastPayload.steps（让 debug UI 看见这一步）
    const stepLog = {
      step: 'parallel',
      phase: 'npc_intro_audit',
      model: this.getModelForModule('npc_intro_audit', AI_REQUEST_SCOPED),
      provider: adapter.getProviderLabel(),
      request: this._cloneSerializable(payload),
      url: typeof url === 'string' ? url.replace(/key=[^&]+/, 'key=***') : null,
    };
    if (this.lastPayload?.steps) {
      this.lastPayload.steps.push(stepLog);
    }
    this._markStepStarted(stepLog);

    let apiResult;
    const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    try {
      apiResult = await adapter.callAPI(url, payload, null, this._currentAbortSignal);
      stepLog.response = apiResult?.raw || null;
      stepLog.responseBody = apiResult;
      stepLog.metrics = apiResult?.metrics || null;
      this._markStepSucceeded(stepLog);
      this._trackSubagentCall({
        subsystem: 'npc_intro_audit',
        parentRequestId: null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_intro_audit', AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        metrics: apiResult?.metrics || null,
        ok: true,
      });
    } catch (e) {
      this._markStepFailure(stepLog, e, {
        phase: 'npc_intro_audit',
        module: 'npc_intro_audit',
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_intro_audit', AI_REQUEST_SCOPED),
        url,
      });
      this._trackSubagentCall({
        subsystem: 'npc_intro_audit',
        parentRequestId: null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_intro_audit', AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        ok: false,
        errorMessage: e?.message || String(e),
      });
      throw e;
    }

    // 解析 tool_calls
    const parsed = adapter.parseToolCalls(apiResult.raw);
    const calls = parsed?.needsRecovery ? parsed.recoveredCalls : (parsed?.toolCalls || []);

    // 逐个执行（new_npc/load_predefined_npc.execute 内部走 npcStore.processNpcPanel）
    const executed = [];
    let successCount = 0;
    for (const call of calls) {
      if (!allowedNames.has(call.name)) {
        console.warn(`[NPC IntroAudit] 非预期工具 ${call.name}，跳过`);
        executed.push({ name: call.name, args: call.args, success: false, error: 'non-allowed tool' });
        continue;
      }
      try {
        const rawResult = await registry.execute(call.name, call.args);
        const resultStr = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult);
        executed.push({ name: call.name, args: call.args, success: true, result: resultStr });
        successCount++;
      } catch (err) {
        executed.push({
          name: call.name,
          args: call.args,
          success: false,
          error: err?.message || String(err),
        });
      }
    }
    stepLog.toolCalls = executed;

    if (executed.length === 0) {
      console.log('[NPC IntroAudit] 完成：本回合无需建卡（0 调用）');
    } else {
      console.log(`[NPC IntroAudit] 完成：${successCount}/${executed.length} 新角色建卡已落地`);
    }
  }

  /**
   * 构造 prompt context：当前已登场名单 + 预定义池 + 最终叙事 + 摘要/近回合（B6）。
   * roster/pool 直接读 npcStore（与 npcCardSyncSubagent._buildNpcCardSyncContext
   * 读 store 同形）；接受 plan §"已知风险" 里的 setTimeout 取名单竞态。
   * summaryDigest/recentTurns 由 caller 用现成件算好传入。
   * @returns {{narrative: string, roster: Array, predefinedPool: Array, summaryDigest: string, recentTurns: string}}
   */
  _buildNpcIntroAuditContext(narrativeText, summaryDigest = '', recentTurns = '') {
    const npcStore = window.npcStore;

    // 已登场名单：getAllMap = 全部已登场（不论选中与否），这是建卡去重的目标全集
    const allMap = (npcStore && typeof npcStore.getAllMap === 'function')
      ? (npcStore.getAllMap() || {})
      : {};
    const roster = Object.keys(allMap).map(id => {
      const npc = allMap[id];
      const cardSource = (npc && npc.card && typeof npc.card === 'object') ? npc.card : npc;
      const name = (cardSource && (cardSource.name || cardSource.character_name)) || id;
      return { id, name };
    });

    // 预定义池（尚未登场）：命中则引导 load_predefined_npc
    const pool = (npcStore && typeof npcStore.getPredefinedPool === 'function')
      ? (npcStore.getPredefinedPool() || {})
      : {};
    const predefinedPool = Object.keys(pool).map(id => {
      const entry = pool[id] || {};
      const name =
        entry.name ||
        entry.character_name ||
        (entry.card && typeof entry.card === 'object' ? entry.card.name : null) ||
        id;
      return { id, name };
    });

    return { narrative: narrativeText, roster, predefinedPool, summaryDigest, recentTurns };
  }
}

// 把 mixin 方法合并到 AIService.prototype（与 npcCardSyncSubagent.js 同形）
(function _applyNpcIntroAuditMixin() {
  if (typeof AIService === 'undefined') {
    console.warn('[npcIntroAudit] AIService 未定义，mixin 跳过（加载顺序问题）');
    return;
  }
  const proto = _AIServiceNpcIntroAuditMixin.prototype;
  Object.getOwnPropertyNames(proto).forEach(name => {
    if (name === 'constructor') return;
    AIService.prototype[name] = proto[name];
  });
})();
