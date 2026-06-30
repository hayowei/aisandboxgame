/**
 * ai/provider.js
 * Provider 管理 + API 连接测试 + Adapter 工厂
 *
 * 通过 mixin 模式扩展 AIService.prototype。所有方法实现与原 class
 * AIService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyAIServiceMixin 合并到 AIService 上。
 *
 * 加载顺序：必须在 aiService.js 之后加载。
 */

class _AIServiceProviderMixin {
  // ========================================
  // 自定义 Provider 管理
  // ========================================

  getCustomProviders(options = {}) {
    return this._getCustomProvidersFromConfigSource(options);
  }

  addCustomProvider(provider) {
    if (!this.config.customProviders) this.config.customProviders = [];
    if (this.config.customProviders.length >= 5) {
      throw new Error('自定义服务商最多 5 个');
    }
    this.config.customProviders.push(provider);
    this.config = this._normalizeConfig(this.config);
    localStorage.setItem('ai_adventure_settings', JSON.stringify(this.config));
  }

  removeCustomProvider(id) {
    if (!this.config.customProviders) return;
    this.config.customProviders = this.config.customProviders.filter(p => p.id !== id);
    // 清理使用该 provider 的模块配置，回退到模块默认值
    if (this.config.modules) {
      for (const [key, mod] of Object.entries(this.config.modules)) {
        if (mod.provider === id) {
          const defaultConfig = this._buildDefaultModuleConfig(key);
          mod.provider = defaultConfig.provider;
          mod.model = defaultConfig.model;
          mod.temperature = defaultConfig.temperature;
          delete mod.priceIn;
          delete mod.priceOut;
        }
      }
    }
    // 清理 API Key
    if (this.config.providerApiKeys) {
      delete this.config.providerApiKeys[id];
    }
    this.config = this._normalizeConfig(this.config);
    localStorage.setItem('ai_adventure_settings', JSON.stringify(this.config));
  }

  // ========================================
  // API 连接测试
  // ========================================

  /**
   * 测试 API 连接是否可用
   * @param {string} providerId - 服务商 ID ('gemini', 'deepseek', 'openai', 'grok', 'anthropic', 'siliconflow', 或自定义 ID)
   * @param {string} apiKey - API Key
   * @param {string} [model] - 模型名称（自定义 provider 必填）
   * @param {string} [baseUrl] - Base URL（仅自定义 provider 需要）
   * @returns {Promise<{ok: boolean, message: string, latency?: number}>}
   */
  async fetchCustomProviderModels(baseUrl, apiKey, protocol = 'openai') {
    if (protocol === 'anthropic') {
      // Anthropic 协议：base 末尾的 /v1 已被 _normalizeProviderBaseUrl 之外的输入留下，这里再做一次容错
      const trimmed = String(baseUrl || '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/v1$/, '');
      const url = trimmed + '/v1/models';
      const response = await fetch(url, {
        headers: {
          'x-api-key': window.apiKeySanitizer.sanitize(apiKey),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => null);
        const e = new Error(err?.error?.message || `HTTP ${response.status}`);
        e.status = response.status;
        throw e;
      }
      const data = await response.json();
      // Anthropic /v1/models 返回 { data: [{ id, ... }] }，DeepSeek 兼容端不一定提供该接口
      return (data.data || []).map(m => m.id).filter(Boolean).sort();
    }
    const url = this._normalizeProviderBaseUrl(baseUrl) + '/models';
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + window.apiKeySanitizer.sanitize(apiKey) },
    });
    if (!response.ok) {
      const err = await response.json().catch(() => null);
      const e = new Error(err?.error?.message || `HTTP ${response.status}`);
      e.status = response.status;
      throw e;
    }
    const data = await response.json();
    return (data.data || []).map(m => m.id).filter(Boolean).sort();
  }

  async testApiConnection(providerId, apiKey, model, baseUrl, protocol = 'openai') {
    if (!apiKey) {
      return { ok: false, message: '请先填入 API Key' };
    }

    const startTime = performance.now();

    try {
      if (providerId === 'gemini') {
        return await this._testGemini(apiKey, model, startTime);
      } else if (providerId === 'anthropic') {
        return await this._testAnthropic(apiKey, model, startTime);
      } else if (providerId === 'custom' && protocol === 'anthropic') {
        return await this._testAnthropicCustom(apiKey, model, baseUrl, startTime);
      } else {
        // OpenAI 兼容: openai / deepseek / grok / siliconflow / custom (默认协议)
        return await this._testOpenAICompatible(providerId, apiKey, model, baseUrl, startTime);
      }
    } catch (e) {
      const latency = Math.round(performance.now() - startTime);
      // fetch 抛 TypeError = 网络/CORS 层挂掉，message 是 "Load failed" 这种空话；让 UI 层用本地化文案替代
      if (e.name === 'TypeError') {
        return { ok: false, code: 'network', message: e.message || 'Network error', latency };
      }
      return { ok: false, message: e.message || '连接失败', latency };
    }
  }

  async _testGemini(apiKey, model, startTime) {
    const testModel = model || 'gemini-3.1-flash-lite';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${testModel}?key=${window.apiKeySanitizer.sanitize(apiKey)}`;
    const response = await fetch(url);
    const latency = Math.round(performance.now() - startTime);

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        msg = err.error?.message || msg;
      } catch (_) {
        /* ignore */
      }
      return { ok: false, message: msg, latency, status: response.status };
    }

    const data = await response.json();
    const displayName = data.displayName || testModel;
    return { ok: true, message: `✓ ${displayName}`, latency }; /* ui-lint-allow */
  }

  async _testOpenAICompatible(providerId, apiKey, model, baseUrl, startTime) {
    let resolvedBaseUrl = '';
    const testModel = model || 'gpt-5.5';

    if (providerId === 'custom') {
      resolvedBaseUrl = this._normalizeProviderBaseUrl(baseUrl);
      if (!resolvedBaseUrl || !this._isValidHttpUrl(resolvedBaseUrl)) {
        return { ok: false, message: '请先填入有效的 Base URL' };
      }
    } else {
      resolvedBaseUrl = this.getProviderBaseUrl(providerId);
    }

    if (!resolvedBaseUrl) {
      return { ok: false, message: '无可用 Base URL' };
    }
    const url = resolvedBaseUrl + '/chat/completions';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + window.apiKeySanitizer.sanitize(apiKey),
      },
      body: JSON.stringify({
        model: testModel,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const latency = Math.round(performance.now() - startTime);

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        msg = err.error?.message || msg;
      } catch (_) {
        /* ignore */
      }
      return { ok: false, message: msg, latency, status: response.status };
    }

    const data = await response.json();
    const actualModel = data.model || testModel;
    return { ok: true, message: `✓ ${actualModel}`, latency }; /* ui-lint-allow */
  }

  async _testAnthropic(apiKey, model, startTime) {
    return this._testAnthropicAtUrl(
      apiKey,
      model || 'claude-sonnet-4-6-20250514',
      'https://api.anthropic.com/v1/messages',
      startTime
    );
  }

  async _testAnthropicCustom(apiKey, model, baseUrl, startTime) {
    if (!model) {
      return { ok: false, message: '请先填入模型名' };
    }
    const trimmed = String(baseUrl || '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/v1$/, '');
    if (!trimmed || !this._isValidHttpUrl(trimmed)) {
      return { ok: false, message: '请先填入有效的 Base URL' };
    }
    return this._testAnthropicAtUrl(apiKey, model, trimmed + '/v1/messages', startTime);
  }

  async _testAnthropicAtUrl(apiKey, model, url, startTime) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': window.apiKeySanitizer.sanitize(apiKey),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    const latency = Math.round(performance.now() - startTime);

    if (!response.ok) {
      let msg = `HTTP ${response.status}`;
      try {
        const err = await response.json();
        msg = err.error?.message || msg;
      } catch (_) {
        /* ignore */
      }
      return { ok: false, message: msg, latency, status: response.status };
    }

    const data = await response.json();
    const actualModel = data.model || model;
    return { ok: true, message: `✓ ${actualModel}`, latency }; /* ui-lint-allow */
  }

  getConfig() {
    return this.config;
  }

  // ========================================
  // Adapter 工厂方法
  // ========================================

  /**
   * 获取指定模块的 Adapter 实例
   * @param {string} module - 模块名称 ('react', 'sms', 'summary', 'chapter', 'design')
   * @returns {BaseAdapter}
   */
  _getAdapter(module = 'react', options = {}) {
    const config = this.getModuleConfig(module, options);
    const apiKey = this.getApiKeyForModule(module, options);

    // 默认走下方 switch 选 adapter。
    if (window.__ONLINE_AI__?.isOn?.()) {
      return new OnlineAdapter(config, '', this);
    }

    switch (config.provider) {
      case 'gemini':
        return new GeminiAdapter(config, apiKey, this);
      case 'deepseek':
        return new OpenAIAdapter(config, apiKey, this, 'deepseek');
      case 'openai':
        return new OpenAIAdapter(config, apiKey, this, 'openai');
      case 'grok':
        return new OpenAIAdapter(config, apiKey, this, 'grok');
      case 'siliconflow':
        return new OpenAIAdapter(config, apiKey, this, 'siliconflow');
      case 'anthropic':
        return new AnthropicAdapter(config, apiKey, this);
      default:
        // 检查是否是自定义 provider
        const customProvider = this.getCustomProviders(options).find(p => p.id === config.provider);
        if (customProvider) {
          const customMaxOutputTokens =
            customProvider.maxOutputTokensEnabled === true &&
            Number.isFinite(customProvider.maxOutputTokens) &&
            customProvider.maxOutputTokens > 0
              ? customProvider.maxOutputTokens
              : null;
          if (customProvider.protocol === 'anthropic') {
            return new AnthropicAdapter(
              config,
              apiKey,
              this,
              'custom',
              customProvider.name,
              customProvider.baseUrl,
              customMaxOutputTokens
            );
          }
          return new OpenAIAdapter(
            config,
            apiKey,
            this,
            'custom',
            customProvider.name,
            customProvider.baseUrl,
            customMaxOutputTokens
          );
        }
        // 未知 provider（可能已被删除），回退到 gemini
        console.warn(`Unknown provider "${config.provider}", fallback to gemini`);
        return new GeminiAdapter(
          { ...config, provider: 'gemini' },
          this.getProviderApiKey('gemini', options),
          this
        );
    }
  }

  /**
   * 通用 Summary API 调用（根据 provider 自动路由）
   * @param {Array} messages - 消息数组
   * @param {string} systemPrompt - 系统提示词
   * @param {string} module - 模块名称
   * @param {Object} options - 可选参数 { onChunk?, abortSignal? }
   * @returns {Promise<string>}
   */
  async _callSummaryAPI(messages, systemPrompt, module, options = {}) {
    const provider = this.getProviderForModule(module, AI_REQUEST_SCOPED);

    // Analytics 内容侧上报：设计模式(p1/p2/p3/repair/design) + summary/chapter/map_naming
    // 走 _callSummaryAPI 这条通道，此前只有 ai.subagent.response（成本/token，无内容）。
    // 补发 ai.aux_request / ai.aux_response（含完整 prompt + 完整回复，payload 形状同
    // react.js 的 ai.request/ai.response）。admin chat-bubble 按 user_message/
    // completion_text 字段判断、'ai' 过滤按 LIKE 'ai.%' → 零改动即呈现。
    // *刻意不复用 ai.request/ai.response*：成本聚合 SQL 是 type IN
    // ('ai.response','ai.subagent.response') 精确匹配，复用会让设计调用被 ai.subagent.response
    // + ai.response 双计 calls 且错归到 react_main subsystem。ai.aux_* 不在该集合内 →
    // 成本面板零污染；成本/token 仍由 _withSubagentTelemetry 的 ai.subagent.response 负责。
    const _phase = (this._subsystemForSummaryModule?.(module)) || module || 'summary';
    const _modelForTele = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const _CAP = 200000; // 设计模式 prompt（整套世界设定 + 角色 schema）常 >> 游戏模式的 32k，放宽避免裁掉出问题的那段
    let _reqId;
    try { _reqId = crypto.randomUUID(); }
    catch (_) { _reqId = 'sd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
    const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const _now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    // per-call sink：_withSubagentTelemetry 成功时把真实 stopReason / token 数
    // 拷进来，供 ai.aux_response 上报真实 finish_reason（设计模式招牌 bug 是
    // 输出截断 = stopReason 'length'/'max_tokens'，写死 'stop' 就筛不出来）。
    // 调用方可以传入 options._auxMetricsSink 自带容器接住 input/output/cache token
    // + stopReason + totalTime，用于在设计模式 AI msg 上展示 metrics bar。
    const _metricsSink = (options && typeof options._auxMetricsSink === 'object' && options._auxMetricsSink)
      ? options._auxMetricsSink
      : {};

    try {
      const _flat = (c) => {
        if (typeof c === 'string') return c;
        if (Array.isArray(c)) return c.map((p) => (typeof p?.text === 'string' ? p.text : (typeof p === 'string' ? p : ''))).filter(Boolean).join('\n');
        return '';
      };
      const _sys = Array.isArray(systemPrompt)
        ? systemPrompt.map((p) => (typeof p === 'string' ? p : (typeof p?.text === 'string' ? p.text : ''))).filter(Boolean).join('\n')
        : (typeof systemPrompt === 'string' ? systemPrompt : '');
      const _msgs = Array.isArray(messages)
        ? messages.map((m) => `[${m?.role || '?'}] ${_flat(m?.content)}`).join('\n\n')
        : '';
      const _full = (_sys ? `<<SYSTEM>>\n${_sys}\n\n` : '') + _msgs;
      window.analyticsService?.track?.('ai.aux_request', {
        request_id: _reqId,
        model: _modelForTele,
        provider,
        phase: _phase,
        // 缺口补齐：think 档 / 温度 / 设置模式，按本次 aux 的真实 module 解析
        // （与 _modelForTele 同源）。模式走 effective，与主回合 ai.request 同口径。
        thinking: this.getModuleThinking(module, AI_REQUEST_SCOPED),
        temperature: this.getModuleTemperature(module, undefined, AI_REQUEST_SCOPED),
        settings_mode: this.getEffectiveApiSettingsMode(AI_REQUEST_SCOPED),
        prompt_len_chars: _full.length,
        user_message: _full.slice(0, _CAP),
      });
      // v2 对话独立通道：全量提问（不截断）也发去新端点，best-effort，不影响老上报
    } catch (_) { /* 上报绝不能向调用方抛 */ }

    const _emitResponse = (ok, text, err) => {
      try {
        const _m = _metricsSink || {};
        const _raw = _m.stopReason ?? null;
        // 归一化口径与 _trackSubagentCall.normFinish / react.js 一致，admin 可统一筛。
        let _nf;
        if (!ok) {
          _nf = 'error';
        } else if (!_raw) {
          _nf = 'stop';
        } else {
          const r = String(_raw).toLowerCase();
          if (['end_turn', 'stop', 'stop_sequence'].includes(r)) _nf = 'stop';
          else if (['max_tokens', 'length'].includes(r)) _nf = 'length';
          else if (['tool_use', 'tool_calls'].includes(r)) _nf = 'tool_calls';
          else if (['safety', 'content_filter', 'recitation', 'blocklist'].includes(r)) _nf = 'content_filter';
          else _nf = r;
        }
        window.analyticsService?.track?.('ai.aux_response', {
          request_id: _reqId,
          duration_ms: Math.round(_now() - _t0),
          completion_len_chars: typeof text === 'string' ? text.length : 0,
          provider,
          model: _modelForTele,
          phase: _phase,
          // token 数一并带上（ai.aux_* 不在成本 SQL 集合内 → 不双计，纯增信息）
          input_tokens: _m.inputTokens ?? null,
          output_tokens: _m.outputTokens ?? null,
          cache_read_tokens: _m.cacheReadTokens ?? null,
          cache_creation_tokens: _m.cacheCreationTokens ?? null,
          finish_reason: _nf,
          finish_reason_raw: _raw,
          ok,
          completion_text: typeof text === 'string'
            ? text.slice(0, _CAP)
            : (err != null ? String(err).slice(0, _CAP) : null),
        });
        // v2 对话独立通道：全量回复（不截断）也发去新端点，best-effort
      } catch (_) { /* 上报绝不能向调用方抛 */ }
    };

    // 浅拷贝注入 sink，不改调用方传入的 options 对象（可能被复用）。
    const _opts = Object.assign({}, options, { _auxMetricsSink: _metricsSink });
    try {
      let _result;
      if (provider === 'gemini') {
        _result = await this.callGeminiSummary(messages, systemPrompt, module, _opts);
      } else if (this._isAnthropicProtocolProvider(provider)) {
        _result = await this.callAnthropicSummary(messages, systemPrompt, module, _opts);
      } else {
        _result = await this.callOpenAISummary(messages, systemPrompt, module, _opts);
      }
      // 把本次 wall-clock 时长写回 sink，方便调用方拼 metrics bar
      _metricsSink.totalTime = Math.round(_now() - _t0);
      _emitResponse(true, _result, null);
      this._pushDesignTrace(module, _result, null);
      return _result;
    } catch (e) {
      _metricsSink.totalTime = Math.round(_now() - _t0);
      _emitResponse(false, null, e?.message || String(e));
      this._pushDesignTrace(module, null, e);
      throw e;
    }
  }

  /**
   * 把 _callSummaryAPI 落回的 metricsSink + 模块名 拼成 streamVisualizer.renderMetricsBar 接受的形状。
   * 设计模式 AI msg 的 footer metrics bar 用这个产物。失败则返回 null（render 自然不画）。
   */
  _buildDesignAiMetrics(sink, module) {
    if (!sink || typeof sink !== 'object') return null;
    const totalTime = Math.round(Number(sink.totalTime) || 0);
    const inputTokens = Number(sink.inputTokens) || 0;
    const outputTokens = Number(sink.outputTokens) || 0;
    const cacheReadTokens = Number(sink.cacheReadTokens) || 0;
    const cacheCreationTokens = Number(sink.cacheCreationTokens) || 0;
    if (totalTime <= 0 && inputTokens === 0 && outputTokens === 0) return null;
    const moduleKey = typeof module === 'string' && module ? module : 'design';
    let prices = null;
    try {
      const p = typeof this.getModulePrices === 'function'
        ? this.getModulePrices(moduleKey, AI_REQUEST_SCOPED)
        : null;
      if (p && typeof p === 'object') prices = { [moduleKey]: p };
    } catch (_e) { /* getModulePrices 失败不影响时间/token 展示 */ }
    return {
      ttft: totalTime, // 非流式调用无单独 TTFT，与总耗时同口径
      totalTime,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      steps: [{
        phase: moduleKey,
        ttft: totalTime,
        downloadTime: 0,
        totalTime,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
      }],
      prices,
      models: typeof this.getModelForModule === 'function'
        ? { [moduleKey]: this.getModelForModule(moduleKey, AI_REQUEST_SCOPED) }
        : null,
      timestamp: new Date(),
    };
  }

  /**
   * 设计模式调用流水累积。每次 _callSummaryAPI 完成后（成功/失败）调用一次。
   * 非 design 系列 module（summary/chapter/map_naming 等）静默忽略。
   * 快照保留当时的 lastDesignPayload（含 provider/url/payload）+ 本次 response/error +
   * 当前 cardId + 时间戳 + module，导出时按 cardId 过滤就能拼出整张卡的完整设计过程。
   */
  _pushDesignTrace(module, response, error) {
    if (!['design', 'p1', 'p2', 'p3', 'repair'].includes(module)) return;
    if (!Array.isArray(this.lastDesignTrace)) this.lastDesignTrace = [];
    let cardId = null, cardName = null;
    try {
      const card = window.worldCardManager?.getActiveCard?.();
      cardId = card?.id || null;
      cardName = card?.name || null;
    } catch (_) { /* worldCardManager 可能未加载 */ }
    // 浅拷一份当前 lastDesignPayload，避免后续 p1/p3 改其 response 字段时回写历史
    const snapshot = this.lastDesignPayload ? { ...this.lastDesignPayload } : null;
    if (snapshot && response != null && snapshot.response === undefined) {
      snapshot.response = response;
    }
    if (snapshot && error != null && !snapshot.errorInfo) {
      snapshot.errorInfo = { message: error?.message || String(error) };
    }
    this.lastDesignTrace.push({
      ts: Date.now(),
      module,
      cardId,
      cardName,
      snapshot,
    });
    // 上限 500 条防内存堆积（一张卡 P1 几十轮 + P2 几个 stage + P3 反复精修，500 通常够）
    if (this.lastDesignTrace.length > 500) {
      this.lastDesignTrace.splice(0, this.lastDesignTrace.length - 500);
    }
  }

  /**
   * 判断 provider 是否走 Anthropic 协议
   * 涵盖：内置 'anthropic' + 自定义服务商配置 protocol='anthropic'
   * @param {string} provider
   * @returns {boolean}
   */
  _isAnthropicProtocolProvider(provider) {
    if (provider === 'anthropic') return true;
    const cp = this.getCustomProviders(AI_REQUEST_SCOPED).find(p => p.id === provider);
    return cp?.protocol === 'anthropic';
  }

  /**
   * 解析模块对应的自定义服务商 maxOutputTokens 覆盖值。
   * 仅当自定义服务商打开了开关且填了正整数才返回该值，否则返回 null。
   * 用于 summary-sms.js 等直接构造 payload 的代码路径（绕过 adapter）。
   * @param {string} module
   * @returns {number|null}
   */
  _resolveCustomProviderMaxOutputTokens(module) {
    const provider = this.getProviderForModule(module, AI_REQUEST_SCOPED);
    const cp = this.getCustomProviders(AI_REQUEST_SCOPED).find(p => p.id === provider);
    if (!cp) return null;
    if (cp.maxOutputTokensEnabled !== true) return null;
    const value = Number(cp.maxOutputTokens);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.floor(value);
  }

  /**
   * 解析模块对应的 Anthropic Messages API URL
   * @param {string} module
   * @returns {string}
   */
  _resolveAnthropicMessagesUrl(module) {
    const provider = this.getProviderForModule(module, AI_REQUEST_SCOPED);
    if (provider === 'anthropic') return 'https://api.anthropic.com/v1/messages';
    const cp = this.getCustomProviders(AI_REQUEST_SCOPED).find(p => p.id === provider);
    if (cp && cp.protocol === 'anthropic') {
      const trimmed = String(cp.baseUrl || '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/v1$/, '');
      if (trimmed) return trimmed + '/v1/messages';
    }
    return 'https://api.anthropic.com/v1/messages';
  }

  // DeepSeek V4 hybrid 思考控制注入（用于绕过 OpenAIAdapter 直接构建 payload 的代码路径）。
  _applyDeepseekThinkingToPayload(payload, provider, _model, module) {
    if (provider !== 'deepseek') return;
    const level = this.getModuleThinking(module, AI_REQUEST_SCOPED);
    if (level === 'off') {
      payload.thinking = { type: 'disabled' };
    } else {
      payload.thinking = { type: 'enabled' };
      payload.reasoning_effort = level === 'max' ? 'max' : 'high';
    }
  }

  /**
   * 通用 SMS API 调用（根据 provider 自动路由）
   * @param {Array} messages - 消息数组
   * @param {Array} systemParts - 系统提示词数组
   * @returns {Promise<string>}
   */
  async _callSMSAPI(messages, systemParts, smsKind = 'sms') {
    const provider = this.getProviderForModule('sms', AI_REQUEST_SCOPED);
    if (provider === 'gemini') {
      return this.callGeminiSMS(messages, systemParts, smsKind);
    }
    if (this._isAnthropicProtocolProvider(provider)) {
      return this.callAnthropicSMS(messages, systemParts, smsKind);
    }
    return this.callOpenAISMS(messages, systemParts, smsKind);
  }

  /**
   * DeepSeek 专用消息预处理：
   * - 仅在 react provider=deepseek 时生效
   * - 仅删除末尾连续 assistant 消息
   * - 不改中间历史，不自动补玩家输入
   */
  _sanitizeMessagesForDeepSeek(messages, provider) {
    const sourceMessages = Array.isArray(messages) ? messages : [];
    const originalCount = sourceMessages.length;
    const isDeepSeekReact = provider === 'deepseek';

    if (!isDeepSeekReact) {
      return {
        messages: sourceMessages,
        stats: {
          enabled: false,
          applied: false,
          originalCount,
          trimmedAssistantCount: 0,
          sanitizedCount: originalCount,
          hasUser: sourceMessages.some(msg => msg?.role === 'user'),
        },
      };
    }

    const sanitizedMessages = [...sourceMessages];
    let trimmedAssistantCount = 0;
    while (
      sanitizedMessages.length > 0 &&
      sanitizedMessages[sanitizedMessages.length - 1]?.role === 'assistant'
    ) {
      sanitizedMessages.pop();
      trimmedAssistantCount++;
    }

    return {
      messages: sanitizedMessages,
      stats: {
        enabled: true,
        applied: trimmedAssistantCount > 0,
        originalCount,
        trimmedAssistantCount,
        sanitizedCount: sanitizedMessages.length,
        hasUser: sanitizedMessages.some(msg => msg?.role === 'user'),
      },
    };
  }

}

_applyAIServiceMixin(_AIServiceProviderMixin);
