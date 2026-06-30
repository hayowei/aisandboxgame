(function () {
  const CURRENT_SCRIPT_URL =
    (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) ||
    (typeof document !== 'undefined' && document.baseURI) ||
    (typeof window !== 'undefined' && window.location ? window.location.href : 'http://localhost/');

  const TRANSFORMERS_RUNTIME_URL = new URL('../vendor/transformers.min.js', CURRENT_SCRIPT_URL).href;
  const DEEPSEEK_TOKENIZER_URL = new URL(
    '../../assets/tokenizers/deepseek-v3/',
    CURRENT_SCRIPT_URL
  );
  const DEEPSEEK_TOKENIZER_MODEL_PATH = DEEPSEEK_TOKENIZER_URL.pathname;

  const SOURCE_USAGE = 'usage';
  const SOURCE_OFFICIAL = 'official-deepseek';
  const SOURCE_OFFICIAL_WITH_TOOLS = 'official-deepseek-with-tools';
  const SOURCE_HEURISTIC = 'heuristic';
  const STEP_PENDING_CACHE = new WeakMap();
  const STEP_RESOLVED_CACHE = new WeakMap();

  let transformersModulePromise = null;
  let tokenizerPromise = null;

  function heuristicCount(value) {
    if (!value) return 0;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return Math.ceil(str.length / 4);
  }

  function normalizeProvider(provider) {
    return typeof provider === 'string' ? provider.trim().toLowerCase() : '';
  }

  function isDeepSeekProvider(provider) {
    return normalizeProvider(provider) === 'deepseek';
  }

  function cloneJSON(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeToolArguments(argumentsValue) {
    if (typeof argumentsValue === 'string') return argumentsValue;
    if (argumentsValue == null) return '{}';
    try {
      return JSON.stringify(argumentsValue);
    } catch (_) {
      return String(argumentsValue);
    }
  }

  function normalizeToolCallsForTokenizer(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return [];
    return toolCalls.map(toolCall => {
      const fn = toolCall?.function || {};
      return {
        id: toolCall?.id,
        type: typeof toolCall?.type === 'string' ? toolCall.type : 'function',
        function: {
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: normalizeToolArguments(fn.arguments),
        },
      };
    });
  }

  function normalizeMessagesForTokenizer(messages) {
    if (!Array.isArray(messages)) return [];

    return messages.map(message => {
      const hasToolCalls = Array.isArray(message?.tool_calls) && message.tool_calls.length > 0;
      const normalized = {
        role: typeof message?.role === 'string' ? message.role : 'user',
      };

      if (hasToolCalls) {
        normalized.tool_calls = normalizeToolCallsForTokenizer(message.tool_calls);
      }

      if (Object.prototype.hasOwnProperty.call(message || {}, 'content')) {
        if (message.content === null) {
          normalized.content = null;
        } else {
          normalized.content = normalizeTextContent(message.content) || '';
        }
      } else if (!hasToolCalls) {
        normalized.content = '';
      }

      return normalized;
    });
  }

  function normalizeTokenCount(tokenized) {
    if (Array.isArray(tokenized)) return tokenized.length;
    if (tokenized && Array.isArray(tokenized.input_ids)) return tokenized.input_ids.length;
    if (tokenized && Array.isArray(tokenized[0])) return tokenized[0].length;
    if (
      tokenized &&
      tokenized.input_ids &&
      typeof tokenized.input_ids.length === 'number'
    ) {
      return tokenized.input_ids.length;
    }
    return 0;
  }

  function normalizeTextContent(value) {
    if (typeof value === 'string') return value;
    if (value == null) return null;
    if (Array.isArray(value)) {
      const text = value
        .map(part => {
          if (typeof part === 'string') return part;
          if (typeof part?.text === 'string') return part.text;
          return '';
        })
        .join('');
      return text || null;
    }
    return String(value);
  }

  function getStepPayload(step) {
    if (!step || typeof step !== 'object') return null;
    return step.request && typeof step.request === 'object' ? step.request : null;
  }

  function getStepResponse(step) {
    if (!step || typeof step !== 'object') return null;
    if (step.response && typeof step.response === 'object') return step.response;

    const body = step.responseBody;
    if (!body || typeof body !== 'object') return null;
    if (body.raw && typeof body.raw === 'object') return body.raw;
    return body;
  }

  function getStepOutputText(step, response) {
    if (typeof step?.responseText === 'string' && step.responseText.trim()) {
      return step.responseText.trim();
    }
    if (typeof step?.responseBody?.text === 'string' && step.responseBody.text.trim()) {
      return step.responseBody.text.trim();
    }
    if (!response) return null;
    if (typeof response === 'string') return response;
    if (typeof response.text === 'string' && response.text.trim()) return response.text.trim();
    if (Array.isArray(response?.choices)) {
      const content = normalizeTextContent(response.choices?.[0]?.message?.content);
      return content && content.trim() ? content.trim() : null;
    }
    return null;
  }

  function getStepReasoningText(step, response) {
    if (
      typeof step?.responseBody?.reasoningContent === 'string' &&
      step.responseBody.reasoningContent.trim()
    ) {
      return step.responseBody.reasoningContent.trim();
    }
    if (typeof response?.reasoningContent === 'string' && response.reasoningContent.trim()) {
      return response.reasoningContent.trim();
    }
    if (typeof response?.choices?.[0]?.message?.reasoning_content === 'string') {
      return response.choices[0].message.reasoning_content;
    }
    return null;
  }

  function buildAssistantMessageFromResponse(response, step) {
    const message = response?.choices?.[0]?.message;
    if (message && typeof message === 'object') {
      const normalizedContent = normalizeTextContent(message.content);
      const reasoningContent =
        typeof message.reasoning_content === 'string' && message.reasoning_content.length > 0
          ? message.reasoning_content
          : null;
      const assistantMessage = { role: 'assistant' };

      if (normalizedContent !== null) {
        assistantMessage.content = normalizedContent;
      } else if (message.content === null) {
        assistantMessage.content = null;
      }

      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        assistantMessage.tool_calls = normalizeToolCallsForTokenizer(message.tool_calls);
      }

      if (assistantMessage.content !== undefined || assistantMessage.tool_calls) {
        return { message: assistantMessage, reasoningContent };
      }
    }

    const reasoningFallback = getStepReasoningText(step, response);
    const contentFallback = getStepOutputText(step, response);

    if (reasoningFallback !== null || contentFallback !== null) {
      return {
        message: {
          role: 'assistant',
          content: contentFallback || '',
        },
        reasoningContent: reasoningFallback,
      };
    }

    return null;
  }

  function buildHeuristicEstimate(step) {
    const payload = getStepPayload(step);
    const response = getStepResponse(step);
    return {
      inputTokens: heuristicCount(payload),
      outputTokens: heuristicCount(response),
      inputSource: SOURCE_HEURISTIC,
      outputSource: SOURCE_HEURISTIC,
      source: SOURCE_HEURISTIC,
    };
  }

  function getCacheableStep(step) {
    return step && typeof step === 'object' ? step : null;
  }

  function encodeTextTokenCount(tokenizer, text) {
    return normalizeTokenCount(tokenizer.encode(text));
  }

  function getToolSchemaSurcharge(tokenizer, payload) {
    const tools = Array.isArray(payload?.tools) ? cloneJSON(payload.tools) : [];
    if (tools.length === 0) {
      return { count: 0, source: SOURCE_OFFICIAL };
    }

    const toolEnvelope = { tools };
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'tool_choice')) {
      toolEnvelope.tool_choice = payload.tool_choice;
    }

    return {
      count: encodeTextTokenCount(tokenizer, JSON.stringify(toolEnvelope)),
      source: SOURCE_OFFICIAL_WITH_TOOLS,
    };
  }

  function computeDeepSeekConversationTokens(tokenizer, payload, messages, addGenerationPrompt) {
    const normalizedMessages = normalizeMessagesForTokenizer(messages);
    const tokenized = tokenizer.apply_chat_template(normalizedMessages, {
      tokenize: true,
      add_generation_prompt: addGenerationPrompt,
      return_tensor: false,
    });
    const templateCount = normalizeTokenCount(tokenized);
    const toolSurcharge = getToolSchemaSurcharge(tokenizer, payload);

    return {
      count: templateCount + toolSurcharge.count,
      source: toolSurcharge.source,
    };
  }

  async function loadTransformersModule() {
    if (!transformersModulePromise) {
      transformersModulePromise = import(TRANSFORMERS_RUNTIME_URL).catch(error => {
        transformersModulePromise = null;
        throw error;
      });
    }
    return transformersModulePromise;
  }

  async function loadTokenizer() {
    if (!tokenizerPromise) {
      tokenizerPromise = (async () => {
        const transformers = await loadTransformersModule();
        const env = transformers?.env;
        if (env && typeof env === 'object') {
          env.allowRemoteModels = true;
          env.allowLocalModels = true;
        }

        const tokenizer = await transformers.AutoTokenizer.from_pretrained(
          DEEPSEEK_TOKENIZER_MODEL_PATH,
          { local_files_only: true }
        );
        return tokenizer;
      })().catch(error => {
        tokenizerPromise = null;
        throw error;
      });
    }
    return tokenizerPromise;
  }

  async function estimateDeepSeekRequest(payload) {
    if (!payload || !Array.isArray(payload.messages)) {
      throw new Error('DeepSeek request payload is missing messages');
    }

    const tokenizer = await loadTokenizer();
    return computeDeepSeekConversationTokens(tokenizer, payload, payload.messages, true);
  }

  async function estimateDeepSeekResponse(payload, response, step) {
    const result = buildAssistantMessageFromResponse(response, step);
    if (!result) {
      throw new Error('DeepSeek response could not be reconstructed');
    }

    const { message: assistantMessage, reasoningContent } = result;
    const tokenizer = await loadTokenizer();

    // Count reasoning tokens separately since the chat template strips <think> blocks
    const reasoningTokens = reasoningContent
      ? encodeTextTokenCount(tokenizer, reasoningContent)
      : 0;

    const requestMessages = Array.isArray(payload?.messages) ? payload.messages : null;
    if (requestMessages) {
      const requestEstimate = computeDeepSeekConversationTokens(
        tokenizer,
        payload,
        requestMessages,
        true
      );
      const totalEstimate = computeDeepSeekConversationTokens(
        tokenizer,
        payload,
        [...requestMessages, assistantMessage],
        false
      );
      const outputCount = totalEstimate.count - requestEstimate.count;

      if (Number.isFinite(outputCount) && outputCount >= 0) {
        return {
          count: outputCount + reasoningTokens,
          source: SOURCE_OFFICIAL,
        };
      }

      throw new Error('DeepSeek response delta estimation returned an invalid token count');
    }

    if (typeof assistantMessage.content === 'string') {
      return {
        count: encodeTextTokenCount(tokenizer, assistantMessage.content) + reasoningTokens,
        source: SOURCE_OFFICIAL,
      };
    }

    if (reasoningTokens > 0) {
      return {
        count: reasoningTokens,
        source: SOURCE_OFFICIAL,
      };
    }

    throw new Error('DeepSeek response is missing content');
  }

  async function estimateRequest(options = {}) {
    if (!isDeepSeekProvider(options.provider)) {
      return {
        count: heuristicCount(options.payload),
        source: SOURCE_HEURISTIC,
      };
    }

    try {
      return {
        ...(await estimateDeepSeekRequest(options.payload)),
      };
    } catch (error) {
      console.warn('[TokenEstimateService] Request estimate fallback:', error);
      return {
        count: heuristicCount(options.payload),
        source: SOURCE_HEURISTIC,
      };
    }
  }

  async function estimateResponse(options = {}) {
    const responseValue =
      options.response && typeof options.response === 'object'
        ? options.response
        : options.step
          ? getStepResponse(options.step)
          : null;

    if (!isDeepSeekProvider(options.provider)) {
      return {
        count: heuristicCount(responseValue),
        source: SOURCE_HEURISTIC,
      };
    }

    try {
      const responseEstimate = await estimateDeepSeekResponse(
        options.payload,
        responseValue,
        options.step
      );
      return {
        ...responseEstimate,
      };
    } catch (error) {
      console.warn('[TokenEstimateService] Response estimate fallback:', error);
      return {
        count: heuristicCount(responseValue),
        source: SOURCE_HEURISTIC,
      };
    }
  }

  async function estimateStep(step) {
    const cachedStep = getCacheableStep(step);
    if (cachedStep && STEP_RESOLVED_CACHE.has(cachedStep)) {
      return STEP_RESOLVED_CACHE.get(cachedStep);
    }
    if (cachedStep && STEP_PENDING_CACHE.has(cachedStep)) {
      return STEP_PENDING_CACHE.get(cachedStep);
    }

    const payload = getStepPayload(step);
    const response = getStepResponse(step);
    const deterministicHeuristic = !isDeepSeekProvider(step?.provider) || !payload;

    const promise = (async () => {
      if (deterministicHeuristic) {
        return buildHeuristicEstimate(step);
      }

      try {
        const requestEstimate = await estimateDeepSeekRequest(payload);
        const inputTokens = requestEstimate.count;
        let inputSource = requestEstimate.source || SOURCE_OFFICIAL;
        let outputTokens = heuristicCount(response);
        let outputSource = SOURCE_HEURISTIC;

        if (response) {
          try {
            const responseEstimate = await estimateDeepSeekResponse(payload, response, step);
            outputTokens = responseEstimate.count;
            outputSource = responseEstimate.source || SOURCE_OFFICIAL;
          } catch (error) {
            console.warn('[TokenEstimateService] Step response estimate fallback:', error);
          }
        }

        return {
          inputTokens,
          outputTokens,
          inputSource,
          outputSource,
          source: inputSource === outputSource ? inputSource : 'mixed',
        };
      } catch (error) {
        console.warn('[TokenEstimateService] Step estimate fallback:', error);
        return buildHeuristicEstimate(step);
      }
    })();

    if (cachedStep) {
      STEP_PENDING_CACHE.set(cachedStep, promise);
    }

    try {
      const result = await promise;
      if (
        cachedStep &&
        (deterministicHeuristic || result.source !== SOURCE_HEURISTIC)
      ) {
        STEP_RESOLVED_CACHE.set(cachedStep, result);
      }
      return result;
    } finally {
      if (cachedStep && STEP_PENDING_CACHE.get(cachedStep) === promise) {
        STEP_PENDING_CACHE.delete(cachedStep);
      }
    }
  }

  window.tokenEstimateService = {
    SOURCE_USAGE,
    SOURCE_OFFICIAL,
    SOURCE_OFFICIAL_WITH_TOOLS,
    SOURCE_HEURISTIC,
    heuristicCount,
    getCachedStepEstimate(step) {
      const cachedStep = getCacheableStep(step);
      return cachedStep ? STEP_RESOLVED_CACHE.get(cachedStep) || null : null;
    },
    estimateRequest,
    estimateResponse,
    estimateStep,
  };
})();
