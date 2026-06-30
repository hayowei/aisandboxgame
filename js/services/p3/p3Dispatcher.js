/**
 * js/services/p3/p3Dispatcher.js
 *
 * Phase 3 agent loop 主控。
 *
 * 替代旧的"AI 一次性出 tool_call → service 处理"模型。新模型：
 *
 *   user 发问 → dispatcher 进 while loop（最多 8 轮）
 *     ├ 每轮：callP3API → 拿 JSON content → validate → 分发
 *     ├ JSON 不合法（最多 retry 3 次） → error 喂回 user message → 重 call（不计 agent 轮）
 *     ├ action.patch         → 返 { kind: 'patch', ... }   服务层渲染 diff card 等审批
 *     ├ action 纯 description → 返 { kind: 'discussion', ... }  服务层渲染对话气泡
 *     ├ action.tool_call     → 执行工具 → 结果作为 user message 喂回 → 继续 loop
 *     └ 触顶第 8 轮          → 强制 system hint "禁止 tool_call、必须最终输出"
 *
 * 不依赖 OpenAI tool calling 协议——所有逻辑基于 JSON content + p3JsonValidator。
 *
 * 暴露 window.p3Dispatcher.runAgentLoop(options)。
 */

(function () {
  'use strict';

  const MAX_ITER = 8;
  const MAX_JSON_RETRY = 3;

  /**
   * 顺序匹配状态机：从流式 JSON content 增量提取 description 字段值。
   *
   * AI 被 prompt 教导按顺序输出 description 在前，所以我们扫到 `"description": "`
   * 后开始往 onChunk 推未转义字符，遇到字符串结尾的未转义 `"` 停止。
   *
   * 这是 D5 决策的实现——patch / tool_call 流式不推（用户审最终结果，过程不重要）。
   */
  class DescriptionStreamExtractor {
    constructor(onChunk) {
      this.onChunk = typeof onChunk === 'function' ? onChunk : () => {};
      this.buffer = '';
      this.foundStart = false;
      this.startIdx = -1;
      this.cursor = -1; // 已扫描位置（下次从 cursor+1 开始）
      this.finished = false;
    }

    feed(chunk) {
      if (this.finished || typeof chunk !== 'string' || chunk.length === 0) return;
      this.buffer += chunk;

      // 还没找到 description 起始
      if (!this.foundStart) {
        const m = this.buffer.match(/"description"\s*:\s*"/);
        if (!m) return;
        this.foundStart = true;
        this.startIdx = m.index + m[0].length;
        this.cursor = this.startIdx - 1;
      }

      let i = this.cursor + 1;
      let segment = '';
      while (i < this.buffer.length) {
        const ch = this.buffer[i];

        if (ch === '\\') {
          // 转义序列至少 2 字符；不够就先等下一个 chunk
          if (i + 1 >= this.buffer.length) break;
          const next = this.buffer[i + 1];
          let decoded;
          switch (next) {
            case 'n': decoded = '\n'; break;
            case 'r': decoded = '\r'; break;
            case 't': decoded = '\t'; break;
            case '"': decoded = '"'; break;
            case '\\': decoded = '\\'; break;
            case '/': decoded = '/'; break;
            case 'b': decoded = '\b'; break;
            case 'f': decoded = '\f'; break;
            case 'u': {
              // \uXXXX 6 字符
              if (i + 5 >= this.buffer.length) {
                // 等下一个 chunk
                this.cursor = i - 1;
                if (segment) this.onChunk(segment);
                return;
              }
              const hex = this.buffer.slice(i + 2, i + 6);
              decoded = String.fromCharCode(parseInt(hex, 16) || 0);
              segment += decoded;
              i += 6;
              continue;
            }
            default:
              decoded = next;
          }
          segment += decoded;
          i += 2;
          continue;
        }

        if (ch === '"') {
          // description 字符串结束
          this.finished = true;
          break;
        }

        segment += ch;
        i++;
      }

      this.cursor = i - 1;
      if (segment) this.onChunk(segment);
    }
  }

  /**
   * 主入口：跑一轮 agent loop。
   *
   * @param {object} opts
   * @param {Array}  opts.chatHistory       OpenAI 协议形态 messages 数组（不含 system）。
   *                                         dispatcher 会 push 新 messages（mutation）。
   * @param {string} opts.systemPrompt      系统 prompt 整 string（含 V2 schema + 整卡 JSON）
   * @param {object} opts.designConfig      当前世界卡（工具 ctx + dry-run patch validate）
   * @param {AbortSignal} [opts.signal]
   * @param {(chunk:string)=>void} [opts.onDescriptionChunk]   流式 description 增量推
   * @param {(step:object)=>void}  [opts.onInvestigationStep]  中间轮调研完成时调
   * @param {(meta:object)=>void}  [opts.onIterationStart]     每轮开始时调（UI 显 "正在思考"）
   * @returns {Promise<{
   *   kind: 'patch' | 'discussion' | 'json_bail' | 'iter_exhausted' | 'aborted' | 'error',
   *   description?: string,
   *   patch?: array,
   *   error?: string,
   *   iterations?: number,
   * }>}
   */
  async function runAgentLoop(opts) {
    const {
      chatHistory,
      systemPrompt,
      designConfig,
      signal,
      onDescriptionChunk,
      onInvestigationStep,
      onIterationStart,
    } = opts || {};

    if (!Array.isArray(chatHistory)) {
      return { kind: 'error', error: 'chatHistory 必须是数组' };
    }
    if (typeof window.callP3API !== 'function') {
      return { kind: 'error', error: 'callP3API 未加载' };
    }
    if (!window.p3JsonValidator || typeof window.p3JsonValidator.validate !== 'function') {
      return { kind: 'error', error: 'p3JsonValidator 未加载' };
    }

    let iteration = 0;
    let jsonRetryCount = 0;
    const ctx = { designConfig: designConfig || {} };

    // 跨 iteration 累加 token / 耗时，最终在 dispatcher 返回里附带 metrics（拼 metrics bar 用）
    const _aggUsage = { input: 0, output: 0, cacheRead: 0 };
    let _aggDurationMs = 0;
    const _aggBuildMetricsObj = () => {
      const total = _aggUsage.input + _aggUsage.output;
      if (total <= 0 && _aggDurationMs <= 0) return null;
      const totalTime = Math.round(_aggDurationMs);
      let prices = null;
      try {
        const p = window.aiService?.getModulePrices?.('p3', {});
        if (p && typeof p === 'object') prices = { p3: p };
      } catch (_) { /* ignore */ }
      return {
        ttft: totalTime,
        totalTime,
        inputTokens: _aggUsage.input,
        outputTokens: _aggUsage.output,
        cacheReadTokens: _aggUsage.cacheRead,
        cacheCreationTokens: 0,
        steps: [{
          phase: 'p3',
          ttft: totalTime,
          downloadTime: 0,
          totalTime,
          inputTokens: _aggUsage.input,
          outputTokens: _aggUsage.output,
          cacheReadTokens: _aggUsage.cacheRead,
        }],
        prices,
        models: window.aiService?.getModelForModule
          ? { p3: window.aiService.getModelForModule('p3', {}) }
          : null,
        timestamp: new Date(),
      };
    };

    // D11: 入口记 length，bail 时按这个回滚（保留 user 原 prompt + 删本轮 retry trail）
    const startLength = chatHistory.length;

    // D9: 每个 return 出口前清掉本轮 dispatcher 自己加的 [system] 触顶 hint。
    // 不清的话 hint 会留在 chatHistory，下一轮 user 发问时 AI 还看到这条过期指令、
    // 可能误以为"调研轮数用完"在新一轮也适用 → 保守不调工具。
    // 从 startLength 起扫，避免动到入口前已有的历史 message。
    const cleanupSystemHints = () => {
      for (let i = chatHistory.length - 1; i >= startLength; i--) {
        const m = chatHistory[i];
        if (m?.role === 'user' && typeof m.content === 'string' && m.content.startsWith('[system]')) {
          chatHistory.splice(i, 1);
        }
      }
    };

    while (iteration < MAX_ITER) {
      if (signal && signal.aborted) {
        cleanupSystemHints();
        return { kind: 'aborted', iterations: iteration, metrics: _aggBuildMetricsObj() };
      }

      iteration++;
      const isLastIter = iteration === MAX_ITER;

      if (isLastIter) {
        // 触顶 hint：强制 AI 本轮不能再 tool_call，必须出 patch 或 description-only。
        // 先清掉本轮已有的 [system] hint——retry 路径下 iteration 回到原值后会重进
        // 这个 if，不去重的话 chatHistory 末尾会累积多条同样的 [system] 触顶指令、
        // AI 看到重复指令更困惑。
        cleanupSystemHints();
        chatHistory.push({
          role: 'user',
          content:
            '[system] 调研轮数已用完。请在本轮直接给最终输出：要么含 patch（带改动）、要么纯 description（讨论 / 提问）。禁止再用 tool_call。',
        });
      }

      if (typeof onIterationStart === 'function') {
        // D10: 把 jsonRetryCount 传给 UI，让用户能看到"重试 K 次"——retry 路径下
        // iteration 数字不变 + descriptionBody 被清空重写，没这个标记用户会以为卡死。
        try { onIterationStart({ iteration, isLastIter, retryCount: jsonRetryCount }); } catch (_) {}
      }

      // ---- 调 model ----
      const descExtractor = new DescriptionStreamExtractor(onDescriptionChunk);
      let apiResult;
      try {
        apiResult = await window.callP3API({
          messages: chatHistory.slice(),
          systemPrompt,
          useTools: false, // 新架构弃 OpenAI tool calling
          signal,
          onPartial: (snap) => {
            if (snap && typeof snap.content === 'string' && snap.content.length > 0) {
              // 推增量：snap.content 是累积值，descExtractor 只看新追加部分
              const last = descExtractor._lastSeen || '';
              if (snap.content.length > last.length) {
                const delta = snap.content.slice(last.length);
                descExtractor.feed(delta);
                descExtractor._lastSeen = snap.content;
              }
            }
          },
        });
      } catch (err) {
        cleanupSystemHints();
        if (err?.name === 'AbortError') return { kind: 'aborted', iterations: iteration, metrics: _aggBuildMetricsObj() };
        return { kind: 'error', error: err?.message || String(err), iterations: iteration, metrics: _aggBuildMetricsObj() };
      }

      // 本 iteration 的 token + 耗时累加到 aggregator
      if (apiResult?.usage) {
        _aggUsage.input += Number(apiResult.usage.prompt_tokens) || 0;
        _aggUsage.output += Number(apiResult.usage.completion_tokens) || 0;
        _aggUsage.cacheRead += Number(apiResult.usage.prompt_cache_hit_tokens) || 0;
      }
      _aggDurationMs += Number(apiResult?.durationMs) || 0;

      const content = apiResult?.message?.content || '';
      // ---- 校验 JSON ----
      const validation = window.p3JsonValidator.validate(content, designConfig);
      if (!validation.ok) {
        jsonRetryCount++;
        if (jsonRetryCount > MAX_JSON_RETRY) {
          // D11: bail 时回滚到 startLength——删本轮所有 retry trail（坏 JSON × 3 + error × 3），
          // 保留 user 原 prompt（startLength 入口时已经含这条）。下一轮 AI 看到的 history 是
          // user 原 prompt 单条尾巴，不会被自己写错的样本"粘住"。
          chatHistory.length = startLength;
          return {
            kind: 'json_bail',
            error: validation.error_message_for_ai,
            iterations: iteration,
            metrics: _aggBuildMetricsObj(),
          };
        }
        // 喂错回 AI，JSON retry 不占 agent loop 轮次
        chatHistory.push({ role: 'assistant', content }); // 保留 AI 的坏输出，让 AI 看到自己写错了什么
        chatHistory.push({ role: 'user', content: validation.error_message_for_ai });
        iteration--; // 抵消本轮
        continue;
      }
      jsonRetryCount = 0;

      const { action } = validation;
      // 把 AI 输出加进 history（合法 JSON）
      chatHistory.push({ role: 'assistant', content });

      // ---- 分发 ----
      if (action.patch) {
        cleanupSystemHints();
        return {
          kind: 'patch',
          description: action.description,
          patch: action.patch,
          iterations: iteration,
          metrics: _aggBuildMetricsObj(),
        };
      }
      if (!action.tool_call) {
        cleanupSystemHints();
        return {
          kind: 'discussion',
          description: action.description,
          iterations: iteration,
          metrics: _aggBuildMetricsObj(),
        };
      }

      // tool_call 路径
      const tools = window.P3_TOOLS || {};
      const toolDef = tools[action.tool_call.tool];
      if (!toolDef || typeof toolDef.exec !== 'function') {
        // validator 已经卡了不在白名单的工具，这里走到说明 race；保险喂回 error
        chatHistory.push({
          role: 'user',
          content: `[tool_error ${action.tool_call.tool}] 工具未注册或不可执行`,
        });
        if (typeof onInvestigationStep === 'function') {
          try {
            onInvestigationStep({
              iteration,
              tool: action.tool_call.tool,
              args: action.tool_call.args,
              description: action.description,
              result: '(工具未注册)',
              ok: false,
            });
          } catch (_) {}
        }
        continue;
      }

      let toolResult;
      try {
        toolResult = await Promise.resolve(toolDef.exec(action.tool_call.args, ctx));
      } catch (e) {
        toolResult = `[tool_error ${action.tool_call.tool}] 工具执行抛错：${e?.message || String(e)}`;
      }
      if (typeof toolResult !== 'string') {
        try { toolResult = JSON.stringify(toolResult); } catch (_) { toolResult = String(toolResult); }
      }

      // 喂 tool_result 回 AI（user role；不用 OpenAI 协议的 role:'tool'，
      // 因为这是自定义 dispatcher，所有 provider 都支持 user role）
      chatHistory.push({
        role: 'user',
        content: `[tool_result ${action.tool_call.tool}]\n${toolResult}`,
      });

      if (typeof onInvestigationStep === 'function') {
        try {
          onInvestigationStep({
            iteration,
            tool: action.tool_call.tool,
            args: action.tool_call.args,
            description: action.description,
            result: toolResult,
            ok: true,
          });
        } catch (_) {}
      }

      // 进下一轮
    }

    // 走到这里说明 MAX_ITER 用完但 AI 还在 tool_call（触顶 hint 没生效）
    cleanupSystemHints();
    return { kind: 'iter_exhausted', iterations: iteration, metrics: _aggBuildMetricsObj() };
  }

  window.p3Dispatcher = {
    runAgentLoop,
    DescriptionStreamExtractor,
    _config: { MAX_ITER, MAX_JSON_RETRY },
  };
})();
