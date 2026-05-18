/**
 * ai/summary-sms.js
 * Summary API + SMS API + 事件驱动短信 + 通用 fetch + 最近 AI 回复提取
 *
 * 通过 mixin 模式扩展 AIService.prototype。所有方法实现与原 class
 * AIService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyAIServiceMixin 合并到 AIService 上。
 *
 * 内容（5 个子段）：
 * - 获取最近的 AI 回复（用于临时角色短信风格参考）
 * - 事件驱动短信生成
 * - Summary API 调用（章节切割 / 文本摘要）
 * - SMS API 调用
 * - 通用 fetch 方法（stream 解析、retry）
 *
 * 加载顺序：必须在 aiService.js 之后加载。
 */

class _AIServiceSummarySmsMixin {
  // ========================================
  // Analytics Phase 5d/5e: SMS/Summary/Design 子系统 token 上报
  // ========================================
  // _fetch* 绕过 adapter，只返回 text。用 request_id 作键的临时 map 把 usage
  // 从 _fetch* 内部传出来——避免并发同 module 调用互盖（timelineService 同 tick
  // 多事件会让 SMS chain 并发）。
  _stashSubagentMetrics(reqId, usage) {
    if (!reqId) return;
    (this._inflightSubagentMetrics ||= {})[reqId] = usage || null;
  }

  _consumeSubagentMetrics(reqId) {
    if (!reqId || !this._inflightSubagentMetrics) return null;
    const m = this._inflightSubagentMetrics[reqId];
    delete this._inflightSubagentMetrics[reqId];
    return m || null;
  }

  // module → subsystem 名。summary 走 'summary'；design 系（p1/p2/p3/repair/design）
  // 走 'design_<module>'，一并覆盖 Phase 5e。
  _subsystemForSummaryModule(module) {
    if (module === 'summary') return 'summary';
    if (['p1', 'p2', 'p3', 'repair', 'design'].includes(module)) return 'design_' + module;
    return module || 'summary';
  }

  // 包住一次 _fetch* 调用：生成 reqId、计时、成功/失败各发一条 ai.subagent.response。
  // fetchFn 收到 reqId，须把它透传进 _fetch* 的 options._metricsReqId。
  // metricsSink（可选）：调用方传入的 per-call 空对象，成功时把本次 consumed
  // metrics（含 stopReason / token 数）拷一份进去，供 _callSummaryAPI 的
  // ai.aux_response 上报真实 finish_reason。per-call 对象 → 并发安全；
  // 不改 _trackSubagentCall 既有成本事件行为（仍收到同一份 metrics）。
  async _withSubagentTelemetry(subsystem, provider, model, fetchFn, metricsSink = null) {
    let reqId;
    try { reqId = crypto.randomUUID(); }
    catch (_) { reqId = 'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }
    const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const _now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    try {
      const result = await fetchFn(reqId);
      const _m = this._consumeSubagentMetrics(reqId);
      if (metricsSink && _m) Object.assign(metricsSink, _m);
      this._trackSubagentCall?.({
        subsystem, provider, model,
        durationMs: _now() - t0,
        metrics: _m,
        ok: true,
      });
      return result;
    } catch (e) {
      this._consumeSubagentMetrics(reqId); // 清 map，防泄漏
      this._trackSubagentCall?.({
        subsystem, provider, model,
        durationMs: _now() - t0,
        ok: false,
        errorMessage: e?.message || String(e),
      });
      throw e;
    }
  }

  // ========================================
  // 获取最近的 AI 回复(用于临时角色短信风格参考)
  // ========================================

  /**
   * 从 AI 回复中提取 panel_narrative 部分
   * @param {string} text - AI 回复的原始文本
   * @returns {string|null} panel_narrative 内容，如果提取失败则返回 null
   */
  _extractNarrativeFromReply(text) {
    if (!text) return null;

    try {
      // 尝试从 JSON 代码块中提取
      const jsonMatch = text.match(/```(?:json|typescript)?\s*([\s\S]*?)```/i);
      if (jsonMatch) {
        const json = JSON.parse(jsonMatch[1]);
        if (json.panel_narrative) {
          return json.panel_narrative;
        }
      }
    } catch (e) {
      // JSON 解析失败，返回原文本(可能是纯叙事文本)
    }

    // 如果不是 JSON 格式，返回原文本
    return text;
  }

  /**
   * 获取主聊天历史中最后 N 次 AI 回复的叙事文本(panel_narrative)
   * @param {number} count - 获取多少条(默认2条)
   * @returns {string[]} 叙事文本数组
   */
  _getRecentAIReplies(count = 2) {
    // 获取全局 chatHistory
    if (typeof chatHistory === 'undefined' || !Array.isArray(chatHistory)) {
      return [];
    }

    const narratives = [];

    // 从最新的消息往前搜索
    for (let i = chatHistory.length - 1; i >= 0 && narratives.length < count; i--) {
      const msg = chatHistory[i];
      if (msg.sender === 'ai' && msg.text) {
        const narrative = this._extractNarrativeFromReply(msg.text);
        if (narrative) {
          narratives.push(narrative);
        }
      }
    }

    // 反转顺序，让较早的在前面
    return narratives.reverse();
  }

  // ========================================
  // 事件驱动短信生成
  // ========================================

  /**
   * 生成事件驱动的短信(角色主动发送给玩家)
   * @param {string} contactId - 联系人ID
   * @param {object} event - 时间轴事件 { time, day, location, characters, content }
   * @returns {Promise<object>} { location, cognitive_state, message }
   */
  async generateEventSMS(contactId, event) {
    const moduleConfig = this.getModuleConfig('sms', AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule('sms', AI_REQUEST_SCOPED);

    if (!apiKey) {
      throw new Error(`短信模块的 ${moduleConfig.provider} API Key 未设置`);
    }

    // 获取联系人配置(自动填充动态字段)
    const contact = this._getContactWithDynamicState(contactId, this._getCurrentGameTime());
    if (!contact) {
      throw new Error('未知联系人: ' + contactId);
    }
    const currentCognitiveState = contact.cognitive_state;

    // 获取当前关系
    const currentRelationship = this._getCurrentRelationship(
      contactId,
      [],
      contact.default_relationship
    );

    // 构建角色信息
    const characterInfo = `## 当前角色
- 名字: ${contact.name}
- 年龄: ${contact.age || '未知'}
- 性格: ${contact.personality || '未知'}
- 当前认知状态: ${currentCognitiveState}
- 当前关系: ${currentRelationship}
- 回复风格: ${contact.msg_reply_tone || '普通'}`;

    // 构建事件信息
    const eventClock = this._normalizeClockTimeString(event.time_str || event.timeStr || '');
    const eventDateStr =
      event.day !== '无日期'
        ? `${event.time} ${event.day}${eventClock ? ` ${eventClock}` : ''}`
        : `${event.time}${eventClock ? ` ${eventClock}` : ''}`;
    const eventInfo = `## 今日发生的事件
- 时间: ${eventDateStr}
- 地点: ${typeof gmCodeEngine !== 'undefined' && gmCodeEngine._resolveLocationDisplayName ? gmCodeEngine._resolveLocationDisplayName(event.location) : event.location}
- 相关角色: ${event.characters}
- 事件内容: ${event.content}`;

    // 获取当前游戏时间
    let currentTimeInfo = '';
    if (typeof timelineService !== 'undefined') {
      const gameDate = timelineService.getCurrentDate();
      const formattedSmsTime = this._formatGameTimeForPrompt(gameDate);
      if (formattedSmsTime) {
        currentTimeInfo = `## 当前游戏时间\n${formattedSmsTime}`;
      }
    }

    // 获取剧情总结(了解玩家的上下文)
    let storySummaryContext = '';
    if (typeof summaryService !== 'undefined') {
      const summaries = summaryService.getSummaries();
      if (summaries.length > 0) {
        storySummaryContext = `## 最近的剧情总结(玩家视角)\n${summaries.join('\n')}`;
      }
    }

    // 获取该角色与玩家的短信历史(如果有)
    let smsHistoryContext = '';
    if (typeof smsService !== 'undefined') {
      const history = smsService.getConversation(contactId);
      if (history.length > 0) {
        const recentMessages = history
          .slice(-5)
          .map(m => `${m.role === 'user' ? '玩家' : contact.name}: ${m.content}`)
          .join('\n');
        smsHistoryContext = `## 最近的短信记录\n${recentMessages}`;
      }
    }

    // 通过 promptRegistry 装配（body + 5 dynamic context blocks），确保 inspector 与运行时一致
    const { parts } = window.promptRegistry.assembleChannel('eventSms', {
      characterInfo,
      eventInfo,
      currentTimeInfo,
      storySummaryContext,
      smsHistoryContext,
    });
    const systemParts = parts.map(p => p.text);

    // 用户消息(触发生成) - 走 promptRegistry 让 inspector 可见
    const messages = [{
      role: 'user',
      content: window.promptRegistry.get('eventSms.triggerMessage').builder({}),
    }];

    // 保存 payload 用于调试
    this.lastEventSMSPayload = {
      contactId,
      event,
      characterInfo,
      eventInfo,
      systemParts,
      messages,
    };

    // 调用 API
    const rawReply = await this._callSMSAPI(messages, systemParts, 'sms_event');

    // 解析回复
    const parsedResponse = this._parseSMSResponse(rawReply);

    // 保存响应用于调试
    this.lastEventSMSPayload.response = {
      raw: rawReply,
      parsed: parsedResponse,
    };

    console.log(
      `[AIService] 事件短信生成完成: ${contact.name} -> "${parsedResponse.message.substring(0, 30)}..."`
    );

    return parsedResponse;
  }

  /**
   * 生成主动短信(模式B:基于聊天记录和剧情上下文，不参考 timeline 事件)
   * 用于玩家已与角色建立联系的情况
   * @param {string} contactId - 联系人ID
   * @param {object|null} gameTime - 当前游戏时间 { year, month, day }
   * @returns {Promise<object>} { location, cognitive_state, message }
   */
  async generateProactiveSMS(contactId, gameTime = null) {
    const moduleConfig = this.getModuleConfig('sms', AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule('sms', AI_REQUEST_SCOPED);

    if (!apiKey) {
      throw new Error(`短信模块的 ${moduleConfig.provider} API Key 未设置`);
    }

    // 获取联系人配置(自动填充动态字段)
    const effectiveGameTime = gameTime || this._getCurrentGameTime();
    const contact = this._getContactWithDynamicState(contactId, effectiveGameTime);
    if (!contact) {
      throw new Error('未知联系人: ' + contactId);
    }
    const currentCognitiveState = contact.cognitive_state;

    // 获取当前关系
    const currentRelationship = this._getCurrentRelationship(
      contactId,
      [],
      contact.default_relationship
    );

    // 构建角色信息
    const characterInfo = `## 当前角色
- 名字: ${contact.name}
- 年龄: ${contact.age || '未知'}
- 性格: ${contact.personality || '未知'}
- 当前认知状态: ${currentCognitiveState}
- 当前关系: ${currentRelationship}
- 回复风格: ${contact.msg_reply_tone || '普通'}`;

    // 获取当前游戏时间
    let currentTimeInfo = '';
    if (effectiveGameTime) {
      const formattedSmsTime = this._formatGameTimeForPrompt(effectiveGameTime);
      if (formattedSmsTime) {
        currentTimeInfo = `## 当前游戏时间\n${formattedSmsTime}`;
      }
    }

    // 获取剧情总结(了解玩家的上下文)
    let storySummaryContext = '';
    if (typeof summaryService !== 'undefined') {
      const summaries = summaryService.getSummaries();
      if (summaries.length > 0) {
        storySummaryContext = `## 最近的剧情总结(玩家视角)\n${summaries.join('\n')}`;
      }
    }

    // 获取该角色与玩家的短信历史(关键:这是主要参考)
    let smsHistoryContext = '';
    if (typeof smsService !== 'undefined') {
      const history = smsService.getConversation(contactId);
      if (history.length > 0) {
        // 获取更多历史记录，因为这是主要参考
        const recentMessages = history
          .slice(-10)
          .map(m => {
            if (m.role === 'system') {
              return window.promptRegistry
                .get('proactiveSms.format.historySystemTag')
                .builder({ content: m.content });
            }
            return `${m.role === 'user' ? '玩家' : contact.name}: ${m.content}`;
          })
          .join('\n');
        smsHistoryContext = `## 与玩家的短信记录(重要参考)\n${recentMessages}`;
      }
    }

    // 通过 promptRegistry 装配（body + 4 dynamic context blocks），确保 inspector 与运行时一致
    const { parts } = window.promptRegistry.assembleChannel('proactiveSms', {
      characterInfo,
      currentTimeInfo,
      smsHistoryContext,
      storySummaryContext,
    });
    const systemParts = parts.map(p => p.text);

    // 用户消息(触发生成) - 走 promptRegistry 让 inspector 可见
    const messages = [
      {
        role: 'user',
        content: window.promptRegistry.get('proactiveSms.triggerMessage').builder({}),
      },
    ];

    // 保存 payload 用于调试
    this.lastProactiveSMSPayload = {
      contactId,
      gameTime: effectiveGameTime,
      characterInfo,
      systemParts,
      messages,
    };

    // 调用 API
    const rawReply = await this._callSMSAPI(messages, systemParts, 'sms_proactive');

    // 解析回复
    const parsedResponse = this._parseSMSResponse(rawReply);

    // 保存响应用于调试
    this.lastProactiveSMSPayload.response = {
      raw: rawReply,
      parsed: parsedResponse,
    };

    console.log(
      `[AIService] 主动短信生成完成: ${contact.name} -> "${parsedResponse.message.substring(0, 30)}..."`
    );

    return parsedResponse;
  }

  // ========================================
  // Summary API 调用
  // ========================================

  async callGeminiSummary(messages, systemPrompt, module = 'summary', options = {}) {
    const model = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule(module, AI_REQUEST_SCOPED);
    const temperature = this.getModuleTemperature(module, 1.0, AI_REQUEST_SCOPED);
    const baseUrl =
      this._getConfigSource(AI_REQUEST_SCOPED).baseUrl ||
      'https://generativelanguage.googleapis.com/v1beta/models';
    const url = baseUrl + '/' + model + ':generateContent?key=' + apiKey;

    const payload = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature,
      },
    };

    const targetProp = ['design', 'p1', 'p2', 'p3', 'repair'].includes(module)
      ? 'lastDesignPayload'
      : 'lastSummaryPayload';
    this[targetProp] = { provider: 'gemini', url: url.replace(apiKey, '***'), payload };
    try {
      return await this._withSubagentTelemetry(
        this._subsystemForSummaryModule(module), 'gemini', model,
        rid => this._fetchGemini(url, payload, 1200000, module, { ...options, _metricsReqId: rid }),
        options?._auxMetricsSink || null
      );
    } catch (e) {
      this[targetProp].errorInfo = this._buildUnifiedErrorInfo(e, {
        traceId: this.lastPayload?.traceId,
        phase: module,
        module,
        provider: 'gemini',
        model,
        url,
      });
      throw e;
    }
  }

  async callOpenAISummary(messages, systemPrompt, module = 'summary', options = {}) {
    const model = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const provider = this.getProviderForModule(module, AI_REQUEST_SCOPED);
    const temperature = this.getModuleTemperature(module, 1.0, AI_REQUEST_SCOPED);
    const url = this._getOpenAIBaseUrl(provider) + '/chat/completions';

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content,
      })),
    ];

    const payload = {
      model: model,
      messages: apiMessages,
      temperature,
    };

    if (options && (options.maxTokens || options.max_tokens)) {
      payload.max_tokens = options.maxTokens || options.max_tokens;
    } else {
      const customMax = this._resolveCustomProviderMaxOutputTokens(module);
      if (customMax) payload.max_tokens = customMax;
    }

    this._applyDeepseekThinkingToPayload(payload, provider, model, module);

    const targetProp = ['design', 'p1', 'p2', 'p3', 'repair'].includes(module)
      ? 'lastDesignPayload'
      : 'lastSummaryPayload';
    this[targetProp] = { provider: provider, url, payload };
    try {
      return await this._withSubagentTelemetry(
        this._subsystemForSummaryModule(module), provider, model,
        rid => this._fetchOpenAI(url, payload, 1200000, module, { ...options, _metricsReqId: rid }),
        options?._auxMetricsSink || null
      );
    } catch (e) {
      this[targetProp].errorInfo = this._buildUnifiedErrorInfo(e, {
        traceId: this.lastPayload?.traceId,
        phase: module,
        module,
        provider,
        model,
        url,
      });
      throw e;
    }
  }

  // ========================================
  // SMS API 调用
  // ========================================

  async callGeminiSMS(messages, systemParts, smsKind = 'sms') {
    const module = 'sms';
    const model = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const apiKey = this.getApiKeyForModule(module, AI_REQUEST_SCOPED);
    const temperature = this.getModuleTemperature(module, 1.0, AI_REQUEST_SCOPED);
    const baseUrl =
      this._getConfigSource(AI_REQUEST_SCOPED).baseUrl ||
      'https://generativelanguage.googleapis.com/v1beta/models';
    const url = baseUrl + '/' + model + ':generateContent?key=' + apiKey;

    const payload = {
      system_instruction: {
        parts: systemParts.map(text => ({ text })),
      },
      contents: messages.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        temperature,
      },
    };

    this.lastSMSPayload = { provider: 'gemini', url: url.replace(apiKey, '***'), payload };
    try {
      return await this._withSubagentTelemetry(smsKind, 'gemini', model,
        rid => this._fetchGemini(url, payload, 1200000, module, { _metricsReqId: rid }));
    } catch (e) {
      this.lastSMSPayload.errorInfo = this._buildUnifiedErrorInfo(e, {
        traceId: this.lastPayload?.traceId,
        phase: 'sms',
        module: 'sms',
        provider: 'gemini',
        model,
        url,
      });
      throw e;
    }
  }

  async callOpenAISMS(messages, systemParts, smsKind = 'sms') {
    const module = 'sms';
    const model = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const provider = this.getProviderForModule(module, AI_REQUEST_SCOPED);
    const temperature = this.getModuleTemperature(module, 1.0, AI_REQUEST_SCOPED);
    const url = this._getOpenAIBaseUrl(provider) + '/chat/completions';

    // 每个 systemPart 作为独立的 system 消息
    const systemMessages = systemParts.map(content => ({ role: 'system', content }));

    const apiMessages = [
      ...systemMessages,
      ...messages.map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content,
      })),
    ];

    const payload = {
      model: model,
      messages: apiMessages,
      temperature,
    };

    const customMaxSms = this._resolveCustomProviderMaxOutputTokens('sms');
    if (customMaxSms) payload.max_tokens = customMaxSms;

    this._applyDeepseekThinkingToPayload(payload, provider, model, 'sms');

    this.lastSMSPayload = { provider: provider, url, payload };
    try {
      return await this._withSubagentTelemetry(smsKind, provider, model,
        rid => this._fetchOpenAI(url, payload, 1200000, module, { _metricsReqId: rid }));
    } catch (e) {
      this.lastSMSPayload.errorInfo = this._buildUnifiedErrorInfo(e, {
        traceId: this.lastPayload?.traceId,
        phase: 'sms',
        module: 'sms',
        provider,
        model,
        url,
      });
      throw e;
    }
  }

  async callAnthropicSummary(messages, systemPrompt, module = 'summary', options = {}) {
    const model = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const _apiKey = this.getApiKeyForModule(module, AI_REQUEST_SCOPED);
    const temperature = this.getModuleTemperature(module, 1.0, AI_REQUEST_SCOPED);
    const url = this._resolveAnthropicMessagesUrl(module);

    // 转换消息格式
    const anthropicMessages = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
    }));

    const payload = {
      model: model,
      max_tokens:
        options?.maxTokens ||
        options?.max_tokens ||
        this._resolveCustomProviderMaxOutputTokens(module) ||
        16384,
      system: systemPrompt,
      messages: anthropicMessages,
      temperature: Math.max(0.01, temperature),
    };

    const targetProp = ['design', 'p1', 'p2', 'p3', 'repair'].includes(module)
      ? 'lastDesignPayload'
      : 'lastSummaryPayload';
    this[targetProp] = { provider: 'anthropic', url, payload };
    try {
      return await this._withSubagentTelemetry(
        this._subsystemForSummaryModule(module), 'anthropic', model,
        rid => this._fetchAnthropic(url, payload, 1200000, module, { ...options, _metricsReqId: rid }),
        options?._auxMetricsSink || null
      );
    } catch (e) {
      this[targetProp].errorInfo = this._buildUnifiedErrorInfo(e, {
        traceId: this.lastPayload?.traceId,
        phase: module,
        module,
        provider: 'anthropic',
        model,
        url,
      });
      throw e;
    }
  }

  async callAnthropicSMS(messages, systemParts, smsKind = 'sms') {
    const module = 'sms';
    const model = this.getModelForModule(module, AI_REQUEST_SCOPED);
    const _apiKey = this.getApiKeyForModule(module, AI_REQUEST_SCOPED);
    const temperature = this.getModuleTemperature(module, 1.0, AI_REQUEST_SCOPED);
    const url = this._resolveAnthropicMessagesUrl(module);

    // 合并 systemParts 为单个 system 字符串
    const systemPrompt = systemParts.join('\n\n');

    // 转换消息格式
    const anthropicMessages = messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
    }));

    const payload = {
      model: model,
      max_tokens: this._resolveCustomProviderMaxOutputTokens('sms') || 16384,
      system: systemPrompt,
      messages: anthropicMessages,
      temperature: Math.max(0.01, temperature),
    };

    this.lastSMSPayload = { provider: 'anthropic', url, payload };
    try {
      return await this._withSubagentTelemetry(smsKind, 'anthropic', model,
        rid => this._fetchAnthropic(url, payload, 1200000, module, { _metricsReqId: rid }));
    } catch (e) {
      this.lastSMSPayload.errorInfo = this._buildUnifiedErrorInfo(e, {
        traceId: this.lastPayload?.traceId,
        phase: 'sms',
        module: 'sms',
        provider: 'anthropic',
        model,
        url,
      });
      throw e;
    }
  }

  _createSummaryFetchAbortState(timeoutMs, abortSignal = null) {
    const controller = new AbortController();
    let abortedByTimeout = false;
    let abortedByExternal = false;
    let externalAbortHandler = null;

    const timeoutId = setTimeout(() => {
      abortedByTimeout = true;
      controller.abort(new Error(`Summary fetch timeout (${timeoutMs / 1000}s)`));
    }, timeoutMs);

    const canUseAbortSignal =
      typeof AbortSignal !== 'undefined' && abortSignal instanceof AbortSignal;
    if (canUseAbortSignal) {
      externalAbortHandler = () => {
        abortedByExternal = true;
        controller.abort(abortSignal.reason ?? new Error('Summary fetch upstream aborted'));
      };
      if (abortSignal.aborted) {
        externalAbortHandler();
      } else {
        abortSignal.addEventListener('abort', externalAbortHandler);
      }
    }

    return {
      controller,
      cleanup: () => {
        clearTimeout(timeoutId);
        if (canUseAbortSignal && externalAbortHandler) {
          abortSignal.removeEventListener('abort', externalAbortHandler);
        }
      },
      wasTimeoutAbort: () => abortedByTimeout,
      wasExternalAbort: () => abortedByExternal,
    };
  }

  _createSummaryAbortedError(provider, url, startTime) {
    const abortedError = new Error('Phase 2 已中止');
    abortedError.code = 'P2_ABORTED';
    abortedError.apiErrorInfo = {
      errorType: 'aborted',
      provider,
      url: this._maskUrlForDebug(url),
      elapsedMs: Math.round(performance.now() - startTime),
    };
    return abortedError;
  }

  _resolveSummaryAbortError(error, abortState, timeoutMs, provider, url, startTime) {
    if (error?.code === 'P2_ABORTED') {
      return error;
    }
    if (error?.name !== 'AbortError') {
      return null;
    }
    if (abortState?.wasExternalAbort?.()) {
      return this._createSummaryAbortedError(provider, url, startTime);
    }
    const timeoutError = new Error(`API 请求超时 (${timeoutMs / 1000}秒)`);
    timeoutError.apiErrorInfo = {
      errorType: 'timeout',
      provider,
      url: this._maskUrlForDebug(url),
      elapsedMs: Math.round(performance.now() - startTime),
    };
    return timeoutError;
  }

  _toGeminiStreamUrl(url) {
    if (typeof url !== 'string' || !url) return url;
    let streamUrl = url.replace(':generateContent', ':streamGenerateContent');
    if (!/[?&]alt=sse(?:&|$)/.test(streamUrl)) {
      streamUrl += streamUrl.includes('?') ? '&alt=sse' : '?alt=sse';
    }
    return streamUrl;
  }

  _isOpenAIStreamingUnsupported(errorResponseBody, statusCode = null) {
    const errorObj =
      errorResponseBody?.error && typeof errorResponseBody.error === 'object'
        ? errorResponseBody.error
        : errorResponseBody && typeof errorResponseBody === 'object'
          ? errorResponseBody
          : null;
    const param = typeof errorObj?.param === 'string' ? errorObj.param.toLowerCase() : '';
    const code = typeof errorObj?.code === 'string' ? errorObj.code.toLowerCase() : '';
    const type = typeof errorObj?.type === 'string' ? errorObj.type.toLowerCase() : '';
    if (param === 'stream' || param === 'stream_options') return true;
    if (code.includes('unsupported') && (code.includes('stream') || code.includes('parameter')))
      return true;
    if (
      (type.includes('invalid_request') || type.includes('invalid_request_error')) &&
      (param === 'stream' || param === 'stream_options')
    )
      return true;

    let text = '';
    if (typeof errorResponseBody === 'string') {
      text = errorResponseBody;
    } else if (errorResponseBody && typeof errorResponseBody === 'object') {
      try {
        text = JSON.stringify(errorResponseBody);
      } catch (_e) {
        text = String(errorResponseBody);
      }
    }
    const lowered = text.toLowerCase();
    const hasStreamWord = lowered.includes('stream');
    const hasUnsupportedWord =
      lowered.includes('unsupported') ||
      lowered.includes('not support') ||
      lowered.includes('does not support') ||
      lowered.includes('not supported') ||
      lowered.includes('unknown') ||
      lowered.includes('invalid') ||
      lowered.includes('unknown parameter') ||
      lowered.includes('unrecognized') ||
      lowered.includes('not allowed') ||
      lowered.includes('extra inputs are not permitted');
    if (hasStreamWord && hasUnsupportedWord) return true;
    if ((statusCode === 400 || statusCode === 404 || statusCode === 422) && hasStreamWord)
      return true;
    return false;
  }

  async _readSSEDataLines(response, onDataLine) {
    const reader = response.body?.getReader?.();
    if (!reader) {
      throw new Error('流式响应不可读取');
    }
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = line => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      onDataLine(data);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
      const lines = buffer.split('\n');
      for (const line of lines) {
        processLine(line);
      }
    }
  }

  /**
   * Anthropic API 通用 fetch 方法
   * @param {string} url - API URL
   * @param {Object} payload - 请求体
   * @param {number} timeoutMs - 超时时间
   * @param {string} module - 模块名称
   * @returns {Promise<string>}
   */
  async _fetchAnthropic(url, payload, timeoutMs = 1200000, module = 'summary', options = {}) {
    const apiKey = this.getApiKeyForModule(module, AI_REQUEST_SCOPED);
    const onChunk = typeof options?.onChunk === 'function' ? options.onChunk : null;
    const abortState = this._createSummaryFetchAbortState(timeoutMs, options?.abortSignal || null);
    const startTime = performance.now();
    const requestPayload = onChunk ? { ...payload, stream: true } : payload;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(requestPayload),
        signal: abortState.controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorResponseBody = null;
        const responseHeaders = {};
        response.headers?.forEach?.((value, key) => {
          responseHeaders[key] = value;
        });
        try {
          const rawText = await response.text();
          try {
            errorResponseBody = JSON.parse(rawText);
            errorMessage = errorResponseBody.error?.message || errorMessage;
          } catch (_) {
            errorResponseBody = rawText;
          }
        } catch (_) {
          /* 无法读取响应体 */
        }
        const error = new Error(errorMessage);
        const errorObj =
          errorResponseBody?.error && typeof errorResponseBody.error === 'object'
            ? errorResponseBody.error
            : errorResponseBody;
        error.apiErrorInfo = {
          errorType: 'http',
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseBody: errorResponseBody,
          responseHeaders,
          requestId:
            responseHeaders['anthropic-request-id'] ||
            responseHeaders['x-request-id'] ||
            responseHeaders['request-id'] ||
            responseHeaders['cf-ray'] ||
            null,
          provider: 'anthropic',
          providerErrorType: errorObj?.type || null,
          providerErrorCode: errorObj?.code || null,
          providerErrorParam: errorObj?.param || null,
          url: this._maskUrlForDebug(url),
          elapsedMs: Math.round(performance.now() - startTime),
        };
        throw error;
      }

      if (onChunk) {
        let accumulatedText = '';
        await this._readSSEDataLines(response, dataLine => {
          try {
            const event = JSON.parse(dataLine);
            if (event?.type !== 'content_block_delta') return;
            const delta = event?.delta || {};
            const text =
              typeof delta.text === 'string'
                ? delta.text
                : delta.type === 'text_delta'
                  ? delta.text || ''
                  : '';
            if (!text) return;
            accumulatedText += text;
            onChunk(accumulatedText);
          } catch (_e) {
            // 忽略单条 SSE 解析异常，继续读取后续分片
          }
        });
        if (!accumulatedText.trim()) {
          const fallbackText = await this._fetchAnthropic(url, payload, timeoutMs, module, {
            ...options,
            onChunk: null,
          });
          onChunk(fallbackText);
          return fallbackText;
        }
        return accumulatedText;
      }

      const data = await response.json();
      const totalTime = performance.now() - startTime;

      const _mid = options?._metricsReqId;
      if (_mid) {
        const u = data?.usage || {};
        this._stashSubagentMetrics(_mid, {
          inputTokens: u.input_tokens || 0,
          outputTokens: u.output_tokens || 0,
          cacheReadTokens: u.cache_read_input_tokens || 0,
          cacheCreationTokens: u.cache_creation_input_tokens || 0,
          stopReason: data?.stop_reason || null,
        });
      }

      // Anthropic 响应格式: { content: [{ type: 'text', text: '...' }] }
      const textBlock = data?.content?.find(b => b.type === 'text');
      const content = textBlock?.text;
      if (!content) {
        const error = new Error('API 返回格式异常');
        error.apiErrorInfo = {
          errorType: 'unexpected_format',
          responseBody: data,
          provider: 'anthropic',
          url: this._maskUrlForDebug(url),
          elapsedMs: Math.round(totalTime),
        };
        throw error;
      }

      return content;
    } catch (e) {
      const abortError = this._resolveSummaryAbortError(
        e,
        abortState,
        timeoutMs,
        'anthropic',
        url,
        startTime
      );
      if (abortError) throw abortError;
      if (!e.apiErrorInfo) {
        e.apiErrorInfo = {
          errorType: e.name === 'TypeError' ? 'network' : 'unknown',
          provider: 'anthropic',
          url: this._maskUrlForDebug(url),
          originalName: e.name,
          elapsedMs: Math.round(performance.now() - startTime),
        };
      }
      throw e;
    } finally {
      abortState.cleanup();
    }
  }

  // ========================================
  // 通用 fetch 方法
  // ========================================

  // 获取 OpenAI 兼容 API 的 baseUrl
  // @param {string} provider - 服务商名称
  _getOpenAIBaseUrl(provider) {
    // 1. 检查是否是自定义 provider
    const cp = this.getCustomProviders(AI_REQUEST_SCOPED).find(p => p.id === provider);
    if (cp) return cp.baseUrl;
    // 2. 内置 provider（固定默认地址）
    return this.getProviderBaseUrl(provider);
  }

  async _fetchGemini(url, payload, timeoutMs = 1200000, module = null, options = {}) {
    const onChunk = typeof options?.onChunk === 'function' ? options.onChunk : null;
    const abortState = this._createSummaryFetchAbortState(timeoutMs, options?.abortSignal || null);
    const startTime = performance.now();
    const actualUrl = onChunk ? this._toGeminiStreamUrl(url) : url;

    try {
      const response = await fetch(actualUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortState.controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorResponseBody = null;
        const responseHeaders = {};
        response.headers?.forEach?.((value, key) => {
          responseHeaders[key] = value;
        });
        try {
          const rawText = await response.text();
          try {
            errorResponseBody = JSON.parse(rawText);
            errorMessage = errorResponseBody.error?.message || errorMessage;
          } catch (_) {
            errorResponseBody = rawText;
          }
        } catch (_) {
          /* 无法读取响应体 */
        }
        const error = new Error(errorMessage);
        const errorObj =
          errorResponseBody?.error && typeof errorResponseBody.error === 'object'
            ? errorResponseBody.error
            : errorResponseBody;
        error.apiErrorInfo = {
          errorType: 'http',
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseBody: errorResponseBody,
          responseHeaders,
          requestId:
            responseHeaders['x-request-id'] ||
            responseHeaders['request-id'] ||
            responseHeaders['anthropic-request-id'] ||
            responseHeaders['cf-ray'] ||
            null,
          provider: 'gemini',
          providerErrorType: errorObj?.status || errorObj?.type || null,
          providerErrorCode: errorObj?.code || null,
          providerErrorParam: errorObj?.param || null,
          url: this._maskUrlForDebug(actualUrl),
          elapsedMs: Math.round(performance.now() - startTime),
        };
        throw error;
      }

      if (onChunk) {
        let accumulatedText = '';
        await this._readSSEDataLines(response, dataLine => {
          try {
            const chunkData = JSON.parse(dataLine);
            const parts = chunkData?.candidates?.[0]?.content?.parts;
            if (!Array.isArray(parts) || parts.length === 0) return;
            let chunkText = '';
            for (const part of parts) {
              if (typeof part?.text === 'string' && part.text) {
                chunkText += part.text;
              }
            }
            if (!chunkText) return;
            accumulatedText += chunkText;
            onChunk(accumulatedText);
          } catch (_e) {
            // 忽略单条 SSE 解析异常，继续读取后续分片
          }
        });
        if (!accumulatedText.trim()) {
          const fallbackText = await this._fetchGemini(url, payload, timeoutMs, module, {
            ...options,
            onChunk: null,
          });
          onChunk(fallbackText);
          return fallbackText;
        }
        return accumulatedText;
      }

      const data = await response.json();
      const totalTime = performance.now() - startTime;

      const _mid = options?._metricsReqId;
      if (_mid) {
        const u = data?.usageMetadata || {};
        this._stashSubagentMetrics(_mid, {
          inputTokens: u.promptTokenCount || 0,
          outputTokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
          cacheReadTokens: u.cachedContentTokenCount || 0,
          cacheCreationTokens: 0,
          stopReason: data?.candidates?.[0]?.finishReason || null,
        });
      }

      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        const error = new Error('API 返回格式异常');
        error.apiErrorInfo = {
          errorType: 'unexpected_format',
          responseBody: data,
          provider: 'gemini',
          url: this._maskUrlForDebug(actualUrl),
          elapsedMs: Math.round(totalTime),
        };
        throw error;
      }

      return text;
    } catch (e) {
      const abortError = this._resolveSummaryAbortError(
        e,
        abortState,
        timeoutMs,
        'gemini',
        actualUrl,
        startTime
      );
      if (abortError) throw abortError;
      if (!e.apiErrorInfo) {
        e.apiErrorInfo = {
          errorType: e.name === 'TypeError' ? 'network' : 'unknown',
          provider: 'gemini',
          url: this._maskUrlForDebug(actualUrl),
          originalName: e.name,
          elapsedMs: Math.round(performance.now() - startTime),
        };
      }
      throw e;
    } finally {
      abortState.cleanup();
    }
  }

  async _fetchOpenAI(url, payload, timeoutMs = 1200000, module = 'main', options = {}) {
    const apiKey = this.getApiKeyForModule(module, AI_REQUEST_SCOPED);
    const provider = this.getProviderForModule(module, AI_REQUEST_SCOPED);
    const onChunk = typeof options?.onChunk === 'function' ? options.onChunk : null;
    const abortState = this._createSummaryFetchAbortState(timeoutMs, options?.abortSignal || null);
    const startTime = performance.now();
    const requestPayload = onChunk ? { ...payload, stream: true } : payload;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + apiKey,
        },
        body: JSON.stringify(requestPayload),
        signal: abortState.controller.signal,
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        let errorResponseBody = null;
        const responseHeaders = {};
        response.headers?.forEach?.((value, key) => {
          responseHeaders[key] = value;
        });
        try {
          const rawText = await response.text();
          try {
            errorResponseBody = JSON.parse(rawText);
            errorMessage = errorResponseBody.error?.message || errorMessage;
          } catch (_) {
            errorResponseBody = rawText;
          }
        } catch (_) {
          /* 无法读取响应体 */
        }

        if (onChunk && this._isOpenAIStreamingUnsupported(errorResponseBody, response.status)) {
          const fallbackText = await this._fetchOpenAI(url, payload, timeoutMs, module, {
            ...options,
            onChunk: null,
          });
          onChunk(fallbackText);
          return fallbackText;
        }

        const error = new Error(errorMessage);
        const errorObj =
          errorResponseBody?.error && typeof errorResponseBody.error === 'object'
            ? errorResponseBody.error
            : errorResponseBody;
        error.apiErrorInfo = {
          errorType: 'http',
          httpStatus: response.status,
          httpStatusText: response.statusText,
          responseBody: errorResponseBody,
          responseHeaders,
          requestId:
            responseHeaders['x-request-id'] ||
            responseHeaders['request-id'] ||
            responseHeaders['anthropic-request-id'] ||
            responseHeaders['cf-ray'] ||
            null,
          provider,
          providerErrorType: errorObj?.type || null,
          providerErrorCode: errorObj?.code || null,
          providerErrorParam: errorObj?.param || null,
          url: this._maskUrlForDebug(url),
          elapsedMs: Math.round(performance.now() - startTime),
        };
        throw error;
      }

      if (onChunk) {
        let accumulatedText = '';
        await this._readSSEDataLines(response, dataLine => {
          try {
            const data = JSON.parse(dataLine);
            const delta = data?.choices?.[0]?.delta;
            const chunkText = delta?.content;
            if (typeof chunkText !== 'string' || !chunkText) return;
            accumulatedText += chunkText;
            onChunk(accumulatedText);
          } catch (_e) {
            // 忽略单条 SSE 解析异常，继续读取后续分片
          }
        });
        if (!accumulatedText.trim()) {
          const fallbackText = await this._fetchOpenAI(url, payload, timeoutMs, module, {
            ...options,
            onChunk: null,
          });
          onChunk(fallbackText);
          return fallbackText;
        }
        return accumulatedText;
      }

      const data = await response.json();
      const totalTime = performance.now() - startTime;

      const _mid = options?._metricsReqId;
      if (_mid) {
        const u = data?.usage || {};
        this._stashSubagentMetrics(_mid, {
          inputTokens: u.prompt_tokens || 0,
          outputTokens: u.completion_tokens || 0,
          cacheReadTokens:
            u.prompt_tokens_details?.cached_tokens
            ?? u.prompt_cache_hit_tokens
            ?? 0,
          cacheCreationTokens: 0,
          stopReason: data?.choices?.[0]?.finish_reason || null,
        });
      }

      const content = data?.choices?.[0]?.message?.content;
      if (!content) {
        const error = new Error('API 返回格式异常');
        error.apiErrorInfo = {
          errorType: 'unexpected_format',
          responseBody: data,
          provider,
          url: this._maskUrlForDebug(url),
          elapsedMs: Math.round(totalTime),
        };
        throw error;
      }

      return content;
    } catch (e) {
      const abortError = this._resolveSummaryAbortError(
        e,
        abortState,
        timeoutMs,
        provider,
        url,
        startTime
      );
      if (abortError) throw abortError;
      if (!e.apiErrorInfo) {
        e.apiErrorInfo = {
          errorType: e.name === 'TypeError' ? 'network' : 'unknown',
          provider,
          url: this._maskUrlForDebug(url),
          originalName: e.name,
          elapsedMs: Math.round(performance.now() - startTime),
        };
      }
      throw e;
    } finally {
      abortState.cleanup();
    }
  }

  formatMessages(history) {
    const configSource = this._getConfigSource(AI_REQUEST_SCOPED);
    // 如果未开启总结上下文，使用原有逻辑
    if (!configSource.useSummaryContext) {
      const recentHistory = history.slice(-20);
      return {
        systemContext: '',
        messages: recentHistory.map(msg => ({
          role: msg.sender === 'user' ? 'user' : 'model',
          content: msg.text,
        })),
      };
    }

    // 使用总结 + 最近消息的新逻辑
    const messages = [];
    const systemContextParts = [];

    // 获取所有总结 -> 移到 system context
    const summaries = typeof summaryService !== 'undefined' ? summaryService.getSummaries() : [];
    if (summaries.length > 0) {
      systemContextParts.push(
        `## 之前剧情的总结\n\n${summaries.join('\n')}\n\n` +
        `_注：以上为压缩骨架，对话原文、具体细节、情感片段已丢失。` +
        `当玩家追问过去具体细节（"那馒头烫不烫"）、复述具体对话、引用过去原话、` +
        `或叙事需要还原某回合精确语气时，先用 \`search_world\` 找回合号，` +
        `再用 \`get_raw_narrative({turn_number: N})\` 看完整原文。_`
      );
    }

    const selectedNpcs = this._getSelectedPromptNpcs();
    const authorityContext = this._buildSelectedNpcAuthorityContext(selectedNpcs, {
      includeAgeReference: true,
    });
    if (authorityContext) {
      systemContextParts.push(authorityContext);
    }

    // 添加最近的完整对话
    const recentCount = configSource.recentMessageCount ?? 4;
    const recentHistory = history.slice(-recentCount);
    messages.push(
      ...recentHistory.map(msg => ({
        role: msg.sender === 'user' ? 'user' : 'model',
        content: msg.text,
      }))
    );

    return {
      systemContext:
        systemContextParts.length > 0 ? systemContextParts.join('\n\n---\n\n') + '\n\n---\n\n' : '',
      messages: messages,
    };
  }

  _getSelectedPromptNpcs() {
    const selected =
      typeof npcStore !== 'undefined' && typeof npcStore.getSelected === 'function'
        ? npcStore.getSelected()
        : [];
    return Array.isArray(selected) ? selected.filter(npc => npc && typeof npc === 'object') : [];
  }

  _buildSelectedNpcJsonText(selectedNpcs = []) {
    if (!Array.isArray(selectedNpcs) || selectedNpcs.length === 0) return '';
    // 剥掉 _ 开头的私有运行时元数据（_lastTurn / _lastUID 等），避免污染 LLM prompt
    const replacer = (key, value) => (typeof key === 'string' && key.startsWith('_')) ? undefined : value;
    return selectedNpcs.map(npc => JSON.stringify(npc, replacer, 2)).join('\n\n');
  }

  _buildSelectedNpcAgeReferenceText(selectedNpcs = []) {
    if (!Array.isArray(selectedNpcs) || selectedNpcs.length === 0) return '';

    const currentTime = this._getCurrentGameTime();
    const worldPrecision = this._getActiveTimeTerms()?.precision || null;
    const canCalculateAge =
      typeof AnalyzerUtils !== 'undefined' &&
      typeof AnalyzerUtils.calculateAgeFromBirthday === 'function';

    const lines = selectedNpcs.map(npc => {
      // 兼容嵌套 {card,state} 或老平铺
      const c = (npc?.card && typeof npc.card === 'object') ? npc.card : npc;
      const displayName =
        typeof c?.name === 'string' && c.name.trim()
          ? c.name.trim()
          : typeof c?.id === 'string' && c.id.trim()
            ? c.id.trim()
            : '未命名角色';
      const age = canCalculateAge
        ? AnalyzerUtils.calculateAgeFromBirthday(c?.birthday, currentTime, worldPrecision)
        : null;
      return `- ${displayName}: ${age || '—'}`;
    });

    return `## 当前年龄参考（代码计算）\n\n${lines.join('\n')}`;
  }

  _buildSelectedNpcAuthorityContext(selectedNpcs = [], options = {}) {
    const { includeAgeReference = false, step3 = false } = options;
    const selectedNpcsJson = this._buildSelectedNpcJsonText(selectedNpcs);
    if (!selectedNpcsJson) return '';

    const parts = [
      step3
        ? `## 当前角色档案 - 权威数据源

以下是当前已存在角色的最新状态（可能已被玩家手动修改）。

**panel_npc 判定流程**：
1. 对比本轮叙事，判断这些角色是否必须UPDATE？
2. 本轮叙事中是否有新角色登场？
3. 都不满足 → panel_npc: null

${selectedNpcsJson}`
        : `## 当前角色档案 - 权威数据源

以下是角色的最新状态。在生成叙事文本时，必须基于人物数据进行创作，只作为参考输出叙事文本，不复写任何角色档案。

${selectedNpcsJson}`,
    ];

    if (includeAgeReference) {
      const ageReferenceText = this._buildSelectedNpcAgeReferenceText(selectedNpcs);
      if (ageReferenceText) {
        parts.push(ageReferenceText);
      }
    }

    return parts.join('\n\n');
  }

}

_applyAIServiceMixin(_AIServiceSummarySmsMixin);
// promptRegistry 注册已抽出到 js/services/ai/summarySmsPromptBootstrap.js
