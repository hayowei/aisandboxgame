// ============================================
// NPC Card Sync Subagent
// ============================================
// 在 _runNpcReactionCalls 的 Promise.allSettled 完成后接力一次 API call：
// 让模型看完所有 N 个 NPC 的 reaction 输出，决定是否需要调 update_npc 把
// **身份层持久字段**（衣物/外貌/性格/阵营/世界卡扩展字段）同步到 NPC 卡片，
// 走玩家审批队列。
//
// 与 npc-ooc.js 同形：mixin 进 AIService.prototype，由 npc-ooc 入口在 reaction
// forEach 完后调 this._runNpcCardSyncSubagent(...)。
//
// 字段范围：仅 update_npc 当前 schema 暴露的可改字段。NPC 自治字段
// (attitude / relationships / cognitive_state / current_goal / state.*) 由
// reaction 本体经 applyReactionToState 落地，本 subagent **不动**（schema 自动屏蔽）。
//
// 失败处理：内部不阻塞主流程，caller (_runNpcReactionCalls) 用 try/catch warn。
// ============================================

class _AIServiceNpcCardSyncMixin {
  /**
   * 在 N 个 reaction 跑完后调用一次 card-sync subagent。
   * @param {Object} adapter - npc_reaction adapter（与 reaction 共享）
   * @param {Array} reactions - _runNpcReactionCalls 拼好的 reactions[]，{npcId, name, text, decision}
   * @param {Object} reactionCtx - 上游 reaction context（未使用，预留 hook）
   * @returns {Promise<void>}
   */
  async _runNpcCardSyncSubagent(adapter, reactions, _reactionCtx) {
    if (!Array.isArray(reactions) || reactions.length === 0) return;

    const registry = window.toolRegistry;
    if (!registry) {
      console.warn('[NPC CardSync] toolRegistry 未加载，跳过');
      return;
    }
    if (!window.promptRegistry) {
      console.warn('[NPC CardSync] promptRegistry 未加载，跳过');
      return;
    }
    if (!this.reactLoop) {
      console.warn('[NPC CardSync] reactLoop 未初始化，跳过');
      return;
    }

    // 通过 _getReactLoopFunctionDeclarations() 拿声明：
    //   • 内部自动 refreshArchiveTools / refreshNpcTools（id enum 反映当前已登场 NPCs）
    //   • 应用用户的 deletedFunctions / customFunctionOverrides / customParameterOverrides
    //     —— 与主 pipeline iter 1-9 行为对齐：用户关了 update_npc，card-sync 也看不见
    //   • dispatcherManaged 工具已被 getReactLoopDeclarations 过滤
    const allDecls = typeof this._getReactLoopFunctionDeclarations === 'function'
      ? this._getReactLoopFunctionDeclarations()
      : registry.getReactLoopDeclarations();
    const updateNpcDecl = allDecls.find(d => d.name === 'update_npc');
    if (!updateNpcDecl) {
      // 无已登场 NPC（update_npc 不会注册）或被用户禁用，nothing to do
      return;
    }

    const props = updateNpcDecl.parameters?.properties || {};
    const editableKeys = Object.keys(props).filter(k => k !== 'id');
    if (editableKeys.length === 0) {
      // 世界卡未定义任何可改身份字段（理论不应发生），跳过
      return;
    }

    // 构造 prompt context
    const ctx = this._buildNpcCardSyncContext(reactions, editableKeys, props);

    // 装配 system prompt（promptRegistry 是核心依赖，无 fallback）
    const { parts } = window.promptRegistry.assembleChannel('npcCardSync', ctx);
    const systemText = parts.map(p => p.text).filter(Boolean).join('\n\n');

    // tools (adapter format)
    const adapterTools = this.reactLoop.buildAdapterTools([updateNpcDecl], adapter);

    // user message (by protocol family) — 提示模型现在该输出 tool_calls
    const userContent = '请基于上文 reactions 与当前卡片快照，判定身份层是否需更新。零调用合法；若需更新，每个 NPC 一次 update_npc，只传 id + 变化字段。';
    const family = adapter?.protocolFamily || adapter?.provider || 'gemini';
    const userMessage =
      family === 'gemini'
        ? { role: 'user', parts: [{ text: userContent }] }
        : family === 'anthropic'
          ? { role: 'user', content: [{ type: 'text', text: userContent }] }
          : { role: 'user', content: userContent };

    // 温度 + thinking：复用 npc_reaction 配置（推荐模式 v4-flash + thinking=max，非推荐 off）
    const temperature = this.getModuleTemperature('npc_reaction', 1.0, AI_REQUEST_SCOPED);
    const isRecommended = this.getEffectiveApiSettingsMode(AI_REQUEST_SCOPED) === 'recommended';
    const thinking = isRecommended
      ? this.getModuleThinking('npc_reaction', AI_REQUEST_SCOPED)
      : 'off';

    const { payload, url } = adapter.buildPayload(
      [userMessage],
      [{ text: systemText, cacheable: false, tag: 'npc_card_sync' }],
      adapterTools,
      { temperature, thinking, toolChoice: 'auto' }
    );

    // stepLog 注入 lastPayload.steps（让 debug UI 看见这一步）
    const stepLog = {
      step: 'parallel',
      phase: 'npc_card_sync',
      model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
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
        subsystem: 'npc_card_sync',
        parentRequestId: _reactionCtx?._npcBatchReqId || null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        metrics: apiResult?.metrics || null,
        ok: true,
      });
    } catch (e) {
      this._markStepFailure(stepLog, e, {
        phase: 'npc_card_sync',
        module: 'npc_reaction',
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
        url,
      });
      this._trackSubagentCall({
        subsystem: 'npc_card_sync',
        parentRequestId: _reactionCtx?._npcBatchReqId || null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule('npc_reaction', AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        ok: false,
        errorMessage: e?.message || String(e),
      });
      throw e;
    }

    // 解析 tool_calls
    const parsed = adapter.parseToolCalls(apiResult.raw);
    const calls = parsed?.needsRecovery ? parsed.recoveredCalls : (parsed?.toolCalls || []);

    // 逐个执行（update_npc.execute 内部走 npcStore.processNpcPanel → 审批队列）
    const executed = [];
    let successCount = 0;
    for (const call of calls) {
      if (call.name !== 'update_npc') {
        console.warn(`[NPC CardSync] 非预期工具 ${call.name}，跳过`);
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
      console.log('[NPC CardSync] 完成：本回合无需调用 update_npc（0 调用）');
    } else {
      console.log(`[NPC CardSync] 完成：${successCount}/${executed.length} update_npc 已进审批队列`);
    }
  }

  /**
   * 构造 prompt context：每个 reaction 配对当前卡片快照 + editable 字段元数据
   * @returns {{reactions: Array, editableFields: Array}}
   */
  _buildNpcCardSyncContext(reactions, editableKeys, fieldProps) {
    const npcStore = window.npcStore;
    const snapshots = reactions.map(r => {
      const npc = npcStore?.get?.(r.npcId) || null;
      const card = {};
      // 新嵌套结构：从 npc.card 读 editableKeys；fallback 兼容老平铺
      const cardSource = (npc?.card && typeof npc.card === 'object') ? npc.card : npc;
      if (cardSource) {
        for (const k of editableKeys) {
          if (Object.prototype.hasOwnProperty.call(cardSource, k)) {
            const v = cardSource[k];
            if (v == null) continue;
            if (typeof v === 'string' && v.trim() === '') continue;
            card[k] = v;
          }
        }
      }
      return {
        id: r.npcId,
        name: r.name || r.npcId,
        currentCard: card,
        decision: r.decision || null,
        text: r.text || '',
      };
    });

    const editableFields = editableKeys.map(k => {
      const p = fieldProps[k] || {};
      return {
        key: k,
        type: typeof p.type === 'string' ? p.type : 'string',
        description: typeof p.description === 'string' ? p.description : k,
        enum: Array.isArray(p.enum) ? p.enum.slice() : null,
      };
    });

    return { reactions: snapshots, editableFields };
  }
}

// 把 mixin 方法合并到 AIService.prototype（与 npc-ooc.js 同形）
(function _applyNpcCardSyncMixin() {
  if (typeof AIService === 'undefined') {
    console.warn('[npcCardSync] AIService 未定义，mixin 跳过（加载顺序问题）');
    return;
  }
  const proto = _AIServiceNpcCardSyncMixin.prototype;
  Object.getOwnPropertyNames(proto).forEach(name => {
    if (name === 'constructor') return;
    AIService.prototype[name] = proto[name];
  });
})();
