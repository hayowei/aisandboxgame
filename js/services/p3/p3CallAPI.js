/**
 * js/services/p3/p3CallAPI.js
 *
 * Phase 3 专用 AI 调用通道（_callP3API）。
 *
 * **架构换血**（2026-05-27 改造）：弃用 OpenAI tool calling 协议，改用
 * JSON content output + 自定义 dispatcher（见 p3Dispatcher.js）。
 *
 * 原因：DeepSeek 不支持 tool_choice='required'，AI 可以选择"调 tool args 空"或
 * "不调 tool 直接 content" 两种逃逸路径——这是空 patch hallucination 的根因。
 *
 * 现在的协议：
 *   - 所有 provider：用 response_format: {type: 'json_object'} 保 parseable JSON
 *   - AI 输出 JSON 形态 {description, patch?, tool_call?} 到 message.content
 *   - dispatcher 校验 + 分发；validator retry 兜底格式错误
 *
 * 与 _callSummaryAPI 的差异：
 *   - _callSummaryAPI 只返字符串
 *   - _callP3API 返完整 assistant message + reasoning + usage + finish_reason
 *     （**不再含 tool_calls**——弃用 tool calling 协议）
 *
 * Analytics 上报：仿 _callSummaryAPI 的 ai.aux_request / ai.aux_response。
 */

(function () {
  'use strict';

  /**
   * SSE 事件流解析器（OpenAI 协议）。
   * yield 解析过的 JSON chunk。
   */
  async function* sseEvents(response, signal) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLines = block
            .split('\n')
            .filter(l => l.startsWith('data:'))
            .map(l => l.slice(5).trimStart());
          if (dataLines.length === 0) continue;
          const data = dataLines.join('\n');
          if (data === '[DONE]') return;
          try {
            yield JSON.parse(data);
          } catch {
            /* 忽略坏 chunk */
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  }

  /**
   * 主入口：调 P3 AI。
   *
   * @param {Object} args
   * @param {Array<{role:string,content:any}>} args.messages
   *        chatHistory（不含 system；system 由内部拼接）。
   *        新协议下 messages 只有 user / assistant role + content（不再有 tool_calls / tool_call_id）。
   * @param {string} args.systemPrompt
   * @param {boolean} [args.useTools]  历史字段，新协议下被忽略（始终不发 tools）
   * @param {AbortSignal} [args.signal]
   * @param {(snap:{content:string,reasoning:string,finishReason:string|null,usage:any})=>void} [args.onPartial]
   * @returns {Promise<{
   *   message: {role:'assistant', content:string|null, reasoning_content?:string},
   *   finishReason: string|null,
   *   usage: any,
   *   durationMs: number,
   *   requestMessageCount: number,
   * }>}
   */
  async function callP3API({ messages, systemPrompt, signal, onPartial }) {
    if (!window.aiService) {
      throw new Error('aiService 未初始化');
    }

    const provider = window.aiService.getProviderForModule('p3', { /* AI_REQUEST_SCOPED */ });
    const adapter = window.aiService._getAdapter
      ? window.aiService._getAdapter('p3', {})
      : null;
    if (!adapter) throw new Error('无法获取 P3 adapter');

    const isAnthropicProto =
      window.aiService._isAnthropicProtocolProvider?.(provider) === true;
    const isOpenAICompat = !isAnthropicProto && provider !== 'gemini';

    const requestId = (() => {
      try { return crypto.randomUUID(); } catch (_) {
        return 'p3_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      }
    })();
    const _CAP = 200000;
    const startMs = (typeof performance !== 'undefined' && performance.now)
      ? performance.now()
      : Date.now();

    // 新协议：messages 只有 user/assistant + content。把任何 model role 归一成 assistant；
    // 任何残留的 tool_calls / tool_call_id 字段静默丢弃（兼容历史 chatHistory）。
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content === undefined ? null : m.content,
      })),
    ];

    _emitAuxRequest({ requestId, provider, messages: apiMessages, systemPrompt, _CAP });

    let result;
    try {
      if (isOpenAICompat) {
        result = await _callOpenAICompatStreaming({
          adapter, apiMessages, signal, onPartial, startMs,
        });
      } else {
        result = await _callViaAdapter({
          adapter, provider, apiMessages, systemPrompt, signal, onPartial, startMs,
        });
      }
    } catch (err) {
      _emitAuxResponse({
        requestId, provider, startMs,
        ok: false, message: null, usage: null, finishReason: null,
        error: err, _CAP,
      });
      // 成本台账：P3 此前只发 ai.aux_*（不在成本聚合集合内），费用在服务器是黑洞。
      // 补发 ai.subagent.response（subsystem 'design_p3'，仿 P1/P2）让 P3 进成本聚合。
      try {
        window.aiService?._trackSubagentCall?.({
          subsystem: 'design_p3',
          provider,
          model: window.aiService?.getModelForModule?.('p3', {}) || null,
          durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - startMs,
          ok: false,
          errorMessage: err?.message || String(err),
        });
      } catch (_) {}
      try { window.aiService._pushDesignTrace?.('p3', null, err); } catch (_) {}
      throw err;
    }

    _emitAuxResponse({
      requestId, provider, startMs,
      ok: true, message: result.message,
      usage: result.usage, finishReason: result.finishReason,
      error: null, _CAP,
    });
    // 成本台账：见上方 catch 注释。usage 形状 {prompt_tokens, completion_tokens,
    // prompt_cache_hit_tokens} → 翻成 _trackSubagentCall 的 metrics 口径。
    try {
      const _u = result.usage || null;
      window.aiService?._trackSubagentCall?.({
        subsystem: 'design_p3',
        provider,
        model: window.aiService?.getModelForModule?.('p3', {}) || null,
        durationMs: result.durationMs,
        metrics: _u ? {
          inputTokens: _u.prompt_tokens || 0,
          outputTokens: _u.completion_tokens || 0,
          cacheReadTokens: _u.prompt_cache_hit_tokens || 0,
          cacheCreationTokens: 0,
          stopReason: result.finishReason || null,
        } : null,
        ok: true,
      });
    } catch (_) {}
    try {
      window.aiService._pushDesignTrace?.('p3', result.message?.content ?? '', null);
    } catch (_) {}

    result.requestMessageCount = apiMessages.length;
    return result;
  }

  /**
   * OpenAI 协议流式：content 增量累积，response_format=json_object 保 parseable。
   */
  async function _callOpenAICompatStreaming({ adapter, apiMessages, signal, onPartial, startMs }) {
    const inner = apiMessages.filter(m => m.role !== 'system');
    const sys = apiMessages.find(m => m.role === 'system')?.content || '';

    let payload, url;
    try {
      // 不传 tools；buildPayload 内部 deepseek thinking guard / system 翻译等仍生效
      const built = adapter.buildPayload(inner, sys, [], {
        toolChoice: 'none',
        temperature: 0.3,
      });
      payload = built?.payload || built;
      url = built?.streamUrl || built?.url;
    } catch (e) {
      throw new Error(`P3 buildPayload 失败：${e?.message || e}`);
    }
    if (!url) throw new Error('P3 buildPayload 未返 url——provider/adapter 不兼容流式调用');
    if (!payload || typeof payload !== 'object') throw new Error('P3 buildPayload 未返合法 payload');

    // 强制 JSON output mode + 流式
    payload.stream = true;
    payload.stream_options = { include_usage: true };
    payload.response_format = { type: 'json_object' };
    // 确保不带 tools / tool_choice（adapter 可能默认带）
    delete payload.tools;
    delete payload.tool_choice;

    const headers = typeof adapter._authHeaders === 'function'
      ? { 'Content-Type': 'application/json', ...adapter._authHeaders() }
      : { 'Content-Type': 'application/json' };

    const res = await fetch(url, {
      method: 'POST', signal, headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
      err.httpStatus = res.status;
      throw err;
    }

    let content = '';
    let reasoning = '';
    let finishReason = null;
    let usage = null;

    for await (const chunk of sseEvents(res, signal)) {
      const choice = chunk.choices?.[0];
      if (choice) {
        const delta = choice.delta || {};
        if (delta.content) content += delta.content;
        if (delta.reasoning_content) reasoning += delta.reasoning_content;
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      if (chunk.usage) usage = chunk.usage;
      if (onPartial) {
        onPartial({ content, reasoning, finishReason, usage });
      }
    }

    const durationMs = ((typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now()) - startMs;

    const message = { role: 'assistant', content: content || null };
    if (reasoning) message.reasoning_content = reasoning;

    return { message, finishReason, usage, durationMs };
  }

  /**
   * 非 OpenAI 协议（Anthropic / Gemini）：走 adapter.callAPI 降级。
   *
   * - Gemini 支持 generationConfig.responseMimeType='application/json' → 注入
   * - Anthropic 不支持 JSON mode → 靠 prompt + validator retry 兜底
   */
  async function _callViaAdapter({
    adapter, provider, apiMessages, systemPrompt, signal, onPartial, startMs,
  }) {
    const inner = apiMessages.filter(m => m.role !== 'system');
    const isGemini = provider === 'gemini';

    let convertedMessages = inner;
    if (isGemini) {
      convertedMessages = _convertMessagesToGemini(inner);
    }

    let payload, url;
    try {
      const built = adapter.buildPayload(convertedMessages, systemPrompt, [], {
        toolChoice: 'none',
        temperature: 0.3,
      });
      payload = built?.payload || built;
      url = built?.streamUrl || built?.url;
    } catch (e) {
      throw new Error(`buildPayload 失败（${provider}）: ${e?.message || e}`);
    }
    if (!url) throw new Error(`P3 buildPayload 未返 url（${provider}）`);

    // Gemini: 注入 JSON mode（generationConfig.responseMimeType）
    if (isGemini && payload && typeof payload === 'object') {
      payload.generationConfig = payload.generationConfig || {};
      payload.generationConfig.responseMimeType = 'application/json';
    }

    let content = '';
    let reasoning = '';
    const onChunk = (text, reasoningText) => {
      content = text || '';
      reasoning = reasoningText || '';
      onPartial?.({ content, reasoning, finishReason: null, usage: null });
    };

    const result = await adapter.callAPI(url, payload, onChunk, signal);

    const durationMs = ((typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now()) - startMs;
    const message = { role: 'assistant', content: content || result.text || null };
    if (reasoning || result.reasoningContent) {
      message.reasoning_content = reasoning || result.reasoningContent;
    }

    const finishReason = result.metrics?.stopReason || null;
    const usage = result.metrics ? {
      prompt_tokens: result.metrics.inputTokens || 0,
      completion_tokens: result.metrics.outputTokens || 0,
      prompt_cache_hit_tokens: result.metrics.cacheReadTokens || 0,
    } : null;

    if (onPartial) {
      onPartial({ content, reasoning, finishReason, usage });
    }

    return { message, finishReason, usage, durationMs };
  }

  // ============================================
  // Analytics 遥测
  // ============================================
  function _emitAuxRequest({ requestId, provider, messages, systemPrompt, _CAP }) {
    try {
      const _flat = (c) => {
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.map(p => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
        return '';
      };
      const _sys = typeof systemPrompt === 'string' ? systemPrompt : '';
      const inner = messages.filter(m => m.role !== 'system');
      const _msgs = inner.map(m => `[${m.role}] ${_flat(m.content)}`).join('\n\n');
      const _full = (_sys ? `<<SYSTEM>>\n${_sys}\n\n` : '') + _msgs;
      const model = window.aiService?.getModelForModule?.('p3', {}) || '?';
      window.analyticsService?.track?.('ai.aux_request', {
        request_id: requestId,
        model, provider, phase: 'p3',
        thinking: window.aiService?.getModuleThinking?.('p3', {}),
        temperature: window.aiService?.getModuleTemperature?.('p3', undefined, {}),
        settings_mode: window.aiService?.getEffectiveApiSettingsMode?.({}),
        prompt_len_chars: _full.length,
        user_message: _full.slice(0, _CAP),
        // 新架构标识：用 json_content_dispatcher 替代旧 tool_calling
        protocol: 'json_content_dispatcher',
      });
      // v2 对话独立通道：全量提问，best-effort
    } catch (_) { /* 上报永不抛 */ }
  }

  function _emitAuxResponse({ requestId, provider, startMs, ok, message, usage, finishReason, error, _CAP }) {
    try {
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      const text = ok ? (message?.content || '') : (error?.message || String(error || ''));
      const model = window.aiService?.getModelForModule?.('p3', {}) || '?';
      let nf;
      if (!ok) nf = 'error';
      else if (!finishReason) nf = 'stop';
      else {
        const r = String(finishReason).toLowerCase();
        if (['end_turn', 'stop', 'stop_sequence'].includes(r)) nf = 'stop';
        else if (['max_tokens', 'length'].includes(r)) nf = 'length';
        else if (['tool_use', 'tool_calls'].includes(r)) nf = 'tool_calls';
        else nf = r;
      }
      window.analyticsService?.track?.('ai.aux_response', {
        request_id: requestId,
        duration_ms: Math.round(now - startMs),
        completion_len_chars: text.length,
        provider, model, phase: 'p3',
        input_tokens: usage?.prompt_tokens ?? null,
        output_tokens: usage?.completion_tokens ?? null,
        cache_read_tokens: usage?.prompt_cache_hit_tokens ?? null,
        finish_reason: nf,
        finish_reason_raw: finishReason || null,
        ok,
        completion_text: text.slice(0, _CAP),
        protocol: 'json_content_dispatcher',
      });
      // v2 对话独立通道：全量回复，best-effort
    } catch (_) { /* 上报永不抛 */ }
  }

  // ============================================
  // 协议翻译：chatHistory → Gemini contents
  //
  // 新协议下 chatHistory 只有 user/assistant + content（无 tool_calls / tool_call_id），
  // 翻译大幅简化——只需 role 映射 + parts.text 包装。
  // Gemini 没 system role（由 system_instruction 处理，buildPayload 内）。
  // ============================================
  function _convertMessagesToGemini(messages) {
    const out = [];
    for (const m of messages) {
      if (!m || !m.role) continue;
      if (m.role === 'system') continue;
      const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
      out.push({
        role,
        parts: [{ text: String(m.content ?? '') }],
      });
    }
    return out;
  }

  // 暴露给 dispatcher / 调试
  window.callP3API = callP3API;
})();
