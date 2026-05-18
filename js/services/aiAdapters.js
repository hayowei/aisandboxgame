// ============================================
// AI Adapters - 服务商适配器
// ============================================
// 被 aiService.js 使用
// ============================================

// ============================================
// Provider Adapters - 策略模式抽象
// ============================================

/**
 * 从不完整的 JSON 字符串中提取 update_narrative 的 text 值
 * 用于流式输出时实时提取叙事文本
 */
function _extractPartialNarrativeText(argsStr) {
  if (!argsStr) return null;
  // 匹配 "text": "内容..." —— 内容可能未闭合
  const match = argsStr.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)("?)/);
  if (!match || !match[1]) return null;
  try {
    // 尝试正确解码转义字符（\n, \", \\ 等）
    return JSON.parse('"' + match[1] + '"');
  } catch {
    // 兜底：最后一个转义字符可能不完整，去掉末尾的孤立反斜杠
    const cleaned = match[1].replace(/\\$/, '');
    try {
      return JSON.parse('"' + cleaned + '"');
    } catch {
      return cleaned;
    }
  }
}

/**
 * 递归剥离 JSON Schema 中 Gemini 不接受的字段：
 * - additionalProperties — Gemini 的 OpenAPI 3.0 子集不识别
 * - enum 数组里的空字符串 — Gemini 报 `enum[N]: cannot be empty`，
 *   过滤掉空串；若过滤后 enum 为空则整个删除
 */
function _stripForGemini(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(_stripForGemini);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    if (k === 'enum' && Array.isArray(v)) {
      const filtered = v.filter(x => x !== '');
      if (filtered.length === 0) continue;
      out[k] = filtered;
      continue;
    }
    out[k] = _stripForGemini(v);
  }
  return out;
}

// 暴露给 reactLoop.buildAdapterTools 等同样需要构造 Gemini 工具声明的消费者
window._stripForGemini = _stripForGemini;

// ============================================
// 用户自定义 Prompt 多条 + role 支持
// ============================================
// prompt-gm.js 在 systemParts 数组中给 role=user 的自定义 prompt 项打 roleOverride='user'
// 标记。adapter 端识别后把它们从 system 段拆出来，merge 到 messages 数组中第一条真实
// user 消息的内容前面 —— 等价于"在真实对话之前插一段伪用户输入"，同时避免 Gemini /
// Anthropic 严格 user/assistant 交替规则被破坏（两个连续 user 消息会被拒）。
//
// CPS_SENTINEL 是 prepend 文本的指纹前缀，用于 telemetry / debug 区分 + 下游 sanitize
// 识别 CPS 块开头。CPS_END_SENTINEL 紧跟在 joinedPrepend 与真实玩家输入之间，让 string
// 形态的 content 可以被精确切割（array/parts 形态本身就结构化，不依赖 end sentinel）。
const CPS_SENTINEL = '<!-- __cps__ -->\n## 额外指令（最高优先级）\n\n';
const CPS_END_SENTINEL = '<!-- __cps_end__ -->';

function _splitPromptParts(systemPrompt) {
  if (!Array.isArray(systemPrompt)) {
    return { systemParts: systemPrompt, userPrepends: [] };
  }
  const systemParts = [];
  const userPrepends = [];
  for (const p of systemPrompt) {
    if (p && typeof p === 'object' && p.roleOverride === 'user') {
      const text = p.text || '';
      if (text) userPrepends.push(text);
    } else {
      systemParts.push(p);
    }
  }
  return { systemParts, userPrepends };
}

function _joinUserPrepends(userPrepends) {
  return userPrepends.length ? userPrepends.join('\n\n---\n\n') : '';
}

/**
 * 把 prepend 文本 merge 进 messages 数组中"第一条 role=user 的消息"内容里。
 * 返回新数组（不 mutate 入参）；若无 user 消息，则把 prepend 作为新 user 消息 unshift。
 *
 * @param {Array} messages — adapter convertMessages 后的消息数组（已过滤 system）
 * @param {string} joinedPrepend — 已 join 的 prepend 文本（空字符串则原样返回）
 * @param {'openai'|'gemini'|'anthropic'} format — content 形态分支
 * @returns {Array}
 */
function _mergePrependIntoFirstUser(messages, joinedPrepend, format) {
  if (!joinedPrepend) return messages;
  const arr = Array.isArray(messages) ? messages : [];
  const firstUserIdx = arr.findIndex(m => m && m.role === 'user');

  // 字符串形态下，CPS 与真实玩家输入之间插 CPS_END_SENTINEL，让下游 sanitize 能精确切割
  // （array/parts 形态由结构化分块，不依赖 sentinel）。
  // unshift 路径（找不到 user 消息）也加 end sentinel，保持纯 CPS 的 user 消息可被识别
  // 整段是 CPS 而非真实输入。
  const stringPrepend = `${joinedPrepend}\n\n${CPS_END_SENTINEL}\n\n`;

  if (firstUserIdx < 0) {
    if (format === 'gemini') {
      return [{ role: 'user', parts: [{ text: joinedPrepend }] }, ...arr];
    }
    return [{ role: 'user', content: stringPrepend }, ...arr];
  }

  const target = arr[firstUserIdx];
  let mergedMsg;
  if (format === 'gemini') {
    const existingParts = Array.isArray(target.parts) ? target.parts : [];
    mergedMsg = { ...target, parts: [{ text: joinedPrepend }, ...existingParts] };
  } else if (format === 'anthropic') {
    if (typeof target.content === 'string') {
      mergedMsg = { ...target, content: `${stringPrepend}${target.content}` };
    } else if (Array.isArray(target.content)) {
      mergedMsg = { ...target, content: [{ type: 'text', text: joinedPrepend }, ...target.content] };
    } else {
      mergedMsg = { ...target, content: stringPrepend };
    }
  } else {
    // openai-shape
    if (typeof target.content === 'string') {
      mergedMsg = { ...target, content: target.content
        ? `${stringPrepend}${target.content}`
        : stringPrepend };
    } else if (Array.isArray(target.content)) {
      // OpenAI 多模态：content 为 array of {type:'text'|'image_url',...}
      mergedMsg = { ...target, content: [{ type: 'text', text: joinedPrepend }, ...target.content] };
    } else {
      // content 为 null（assistant 带 tool_calls 时）—— 不应发生在 user 消息上，但兜底
      mergedMsg = { ...target, content: stringPrepend };
    }
  }

  return [...arr.slice(0, firstUserIdx), mergedMsg, ...arr.slice(firstUserIdx + 1)];
}

/**
 * 把 buildPayload 已 prepend 过 system + CPS user-prepend 的 messages 剥回 clean 形态，
 * 让下一个 iter 的 buildPayload 重新 prepend 时不重复积累。
 *
 * 修复的 bug：每个 iter（iter5/6/7/9）在 propagation 点做 `iterNMessagesRef.slice()`
 * 喂给下一个 iter buildPayload。adapter 不去重 → 双 system 块 + 重复 CPS prepend。
 *
 * 清理动作：
 * 1. 剔除所有 `role: 'system'` 条目（仅 OpenAI/DeepSeek 受影响；Anthropic/Gemini messages
 *    数组本身不含 system，这步对它们 no-op）
 * 2. 第一条 `role: 'user'` 消息内剥掉 CPS 内容：
 *    - string content：以 `CPS_END_SENTINEL` 切割取末段（含端点情况：纯 CPS 无玩家输入 → 空串）
 *    - Anthropic content array：丢首个 text block 且 `text.startsWith(CPS_SENTINEL)` 的
 *    - Gemini parts：丢首个 part 且 `text.startsWith(CPS_SENTINEL)` 的
 * 3. 不动其他 user 消息（CPS 只能注入到第一条 user）；保留所有 tool_calls / tool_call_id
 *    / name 等字段
 *
 * @param {Array} messages
 * @returns {Array} 新数组，不 mutate 入参
 */
function sanitizeMessagesForRebuild(messages) {
  if (!Array.isArray(messages)) return messages;

  // Step 1: 剔除 system 条目
  const withoutSystem = messages.filter(m => !(m && m.role === 'system'));

  // Step 2: 找第一条 user，剥 CPS
  const firstUserIdx = withoutSystem.findIndex(m => m && m.role === 'user');
  if (firstUserIdx < 0) return withoutSystem;

  const target = withoutSystem[firstUserIdx];
  let cleaned;

  if (typeof target.content === 'string') {
    // 字符串形态（openai / anthropic-string）：用 CPS_END_SENTINEL 切割取末段
    const idx = target.content.lastIndexOf(CPS_END_SENTINEL);
    if (idx < 0) {
      // 内容里没有 end sentinel：可能是无 CPS 的纯玩家输入（早 return 路径），保持原样
      return withoutSystem;
    }
    const tail = target.content.slice(idx + CPS_END_SENTINEL.length).replace(/^\s+/, '');
    cleaned = { ...target, content: tail };
  } else if (Array.isArray(target.content)) {
    // Anthropic content array：丢首个 CPS_SENTINEL text block
    const first = target.content[0];
    if (first && first.type === 'text' && typeof first.text === 'string' && first.text.startsWith(CPS_SENTINEL)) {
      cleaned = { ...target, content: target.content.slice(1) };
    } else {
      return withoutSystem;
    }
  } else if (Array.isArray(target.parts)) {
    // Gemini parts：丢首个 CPS_SENTINEL text part
    const first = target.parts[0];
    if (first && typeof first.text === 'string' && first.text.startsWith(CPS_SENTINEL)) {
      cleaned = { ...target, parts: target.parts.slice(1) };
    } else {
      return withoutSystem;
    }
  } else {
    return withoutSystem;
  }

  return [
    ...withoutSystem.slice(0, firstUserIdx),
    cleaned,
    ...withoutSystem.slice(firstUserIdx + 1),
  ];
}
window.sanitizeMessagesForRebuild = sanitizeMessagesForRebuild;

/**
 * BaseAdapter - 服务商适配器基类
 * 定义了所有适配器必须实现的接口
 */
class BaseAdapter {
  constructor(config, apiKey, aiService) {
    this.config = config;
    this.apiKey = apiKey;
    this.aiService = aiService; // 引用 AIService 实例，用于访问公共方法
  }

  /**
   * 获取服务商标识(用于日志)
   * @returns {string}
   */
  getProviderLabel() {
    throw new Error('Not Implemented: getProviderLabel');
  }

  /**
   * 将通用消息格式转换为厂商特定格式
   * @param {Array} messages - 通用格式消息 [{role, content}]
   * @param {string} systemPrompt - 系统提示词
   * @param {Array} tools - 工具定义数组
   * @param {Object} options - 选项 {temperature, ...}
   * @returns {Object} { payload, url, streamUrl }
   */
  buildPayload(messages, systemPrompt, _tools = [], _options = {}) {
    throw new Error('Not Implemented: buildPayload');
  }

  /**
   * 就地更新 payload 的 system 部分（用于 ReAct 迭代间重建易变 system 块，不触碰 messages/tools）
   * 子类按自家 payload 结构实现；默认 no-op 以保持向后兼容
   * @param {Object} _payload - buildPayload() 返回的 payload 对象
   * @param {string|Array} _systemPrompt - 新的 system 部分（字符串或 parts 数组）
   */
  updateSystemParts(_payload, _systemPrompt) {
    // 默认 no-op — 未实现的 adapter 等于跳过刷新（但不会崩）
  }

  /**
   * 调用 API
   * @param {string} url - API 端点
   * @param {Object} payload - 请求体
   * @param {Function|null} onChunk - 流式回调
   * @param {AbortSignal|null} abortSignal - 外部中止信号
   * @returns {Promise<Object>} 标准化响应 { text, toolCalls: [{name, args, id?}], reasoningContent, metrics, raw }
   */
  async callAPI(url, payload, _onChunk = null, _abortSignal = null) {
    throw new Error('Not Implemented: callAPI');
  }

  /**
   * 清理历史记录，为叙事阶段做准备
   * 移除工具调用的特殊标记，转为纯文本参考
   * @param {Array} messages - 当前消息数组
   * @returns {{ cleanedMessages: Array, collectedReferences: Array, lastGameState: string|null }}
   */
  cleanHistoryForGeneration(_messages) {
    throw new Error('Not Implemented: cleanHistoryForGeneration');
  }

  /**
   * 获取厂商特定的工具定义
   * @returns {Array}
   */
  getToolDefinitions() {
    throw new Error('Not Implemented: getToolDefinitions');
  }

  /**
   * 将工具调用结果追加到消息历史
   * @param {Array} messages - 当前消息数组
   * @param {Array} toolCalls - 工具调用 [{name, args, id?}]
   * @param {Array} results - 执行结果 [{name, result}]
   * @returns {Array} 更新后的消息数组
   */
  appendToolResults(_messages, _toolCalls, _results, _assistantContent = null) {
    throw new Error('Not Implemented: appendToolResults');
  }

  /**
   * 将纯文本 assistant 回复追加到消息历史（用于 ReAct 交错模式：无 tool calls 也无 <choices> 的中间叙事段落）
   * @param {Array} messages - 当前消息数组
   * @param {string} text - assistant 输出的文本
   */
  appendAssistantText(_messages, _text) {
    throw new Error('Not Implemented: appendAssistantText');
  }

  /**
   * 获取 payload 内部消息数组的可变引用（用于 ReAct 多轮循环追加工具结果）
   * @param {Object} _payload - buildPayload() 返回的 payload 对象
   * @returns {Array} payload 内部消息数组的引用
   */
  getPayloadMessagesRef(_payload) {
    throw new Error('Not Implemented: getPayloadMessagesRef');
  }

  /**
   * 从响应中解析工具调用(处理厂商特定的格式问题)
   * @param {Object} response - API 响应
   * @returns {{ toolCalls: Array, needsRecovery: boolean, recoveredCalls: Array }}
   */
  parseToolCalls(_response) {
    throw new Error('Not Implemented: parseToolCalls');
  }

  /**
   * 同步历史中已执行的工具签名
   * @param {Array} messages - 消息数组
   * @param {Set} executedTools - 已执行工具签名集合
   */
  syncExecutedTools(_messages, _executedTools) {
    throw new Error('Not Implemented: syncExecutedTools');
  }

  /**
   * 转换输入消息为厂商格式
   * @param {Array} messages - 通用格式消息
   * @returns {Array} 厂商格式消息
   */
  convertMessages(_messages) {
    throw new Error('Not Implemented: convertMessages');
  }
}

/**
 * 自定义世界兜底状态文本构建（仅在 step3SchemaBuilder 不可用时使用）
 */
function _buildLooseStatusSummary(status) {
  if (!status || typeof status !== 'object') return '';
  const lines = [];
  const formatLocationValue = value => {
    if (value === null || value === undefined || value === '') return value;
    const eStore = window.entityStore;
    if (!eStore || typeof eStore.resolveDisplayName !== 'function') {
      return value;
    }
    return eStore.resolveDisplayName(String(value)) || value;
  };

  for (const [groupKey, data] of Object.entries(status)) {
    if (data === null || data === undefined) continue;

    if (Array.isArray(data)) {
      const items = data
        .map(item => {
          if (!item || typeof item !== 'object') return '';
          return Object.values(item)
            .filter(v => v !== null && v !== undefined && v !== '')
            .join('/');
        })
        .filter(Boolean);
      if (items.length > 0) lines.push(`* ${groupKey}: ${items.join(', ')}`);
      continue;
    }

    if (typeof data === 'object') {
      const parts = Object.values(data)
        .map(value => (groupKey === 'location' ? formatLocationValue(value) : value))
        .filter(v => v !== null && v !== undefined && v !== '');
      if (parts.length > 0) lines.push(`* ${groupKey}: ${parts.join(' ')}`);
      continue;
    }

    lines.push(`* ${groupKey}: ${data}`);
  }

  return lines.join('\n');
}

/**
 * 统一构建 lastGameState 文本
 * 所有世界使用 step3_fields 动态术语
 */
function buildStatusSummaryText(status) {
  if (!status || typeof status !== 'object') return '';

  const step3Fields = window.worldMeta?.getStep3Fields?.();
  if (step3Fields && typeof window.step3SchemaBuilder !== 'undefined') {
    return window.step3SchemaBuilder.buildLastGameStateText(status, step3Fields.panel_status || []);
  }
  return _buildLooseStatusSummary(status);
}

function _maskApiUrl(rawUrl) {
  if (!rawUrl) return '';
  return String(rawUrl).replace(/([?&](?:key|api_key|token|access_token)=)[^&]+/gi, '$1***');
}

function _headersToObject(headers) {
  const out = {};
  if (!headers || typeof headers.forEach !== 'function') return out;
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function _extractRequestId(headersObj = {}) {
  const keys = ['x-request-id', 'request-id', 'anthropic-request-id', 'cf-ray'];
  for (const key of keys) {
    if (headersObj[key]) return headersObj[key];
  }
  return null;
}

async function _readErrorResponseBody(response) {
  let rawText = null;
  let parsed = null;
  try {
    rawText = await response.text();
  } catch (_e) {
    rawText = null;
  }

  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch (_e) {
      parsed = null;
    }
  }

  return {
    rawText,
    parsed,
    body: parsed || rawText || null,
  };
}

function _extractProviderErrorDetails(provider, responseBody) {
  const bodyObj = responseBody && typeof responseBody === 'object' ? responseBody : null;
  const errorObj = bodyObj?.error && typeof bodyObj.error === 'object' ? bodyObj.error : bodyObj;

  if (provider === 'gemini') {
    return {
      message: errorObj?.message || bodyObj?.message || null,
      type: errorObj?.status || errorObj?.type || null,
      code: errorObj?.code || null,
      param: null,
    };
  }

  if (provider === 'anthropic') {
    return {
      message: errorObj?.message || bodyObj?.message || null,
      type: errorObj?.type || null,
      code: errorObj?.code || null,
      param: null,
    };
  }

  // OpenAI / DeepSeek / Grok / custom(OpenAI兼容)
  return {
    message: errorObj?.message || bodyObj?.message || null,
    type: errorObj?.type || bodyObj?.type || null,
    code: errorObj?.code || bodyObj?.code || null,
    param: errorObj?.param || bodyObj?.param || null,
  };
}

function _buildApiErrorInfo({
  provider,
  url,
  startTime,
  errorType,
  httpStatus = null,
  httpStatusText = null,
  responseBody = null,
  responseHeaders = null,
  providerErrorType = null,
  providerErrorCode = null,
  providerErrorParam = null,
  requestId = null,
  originalName = null,
  safetyReason = null,    // Gemini 200+审查触发时的 reason 枚举（SAFETY/PROHIBITED_CONTENT/BLOCKLIST/RECITATION/SPII/...）
  safetyStage = null,     // 'prompt' (输入被拦) | 'output' (生成中切断)
}) {
  return {
    errorType,
    provider,
    httpStatus,
    httpStatusText,
    providerErrorType,
    providerErrorCode,
    providerErrorParam,
    requestId,
    url: _maskApiUrl(url),
    responseHeaders,
    responseBody,
    elapsedMs: Math.round(performance.now() - startTime),
    originalName,
    safetyReason,
    safetyStage,
  };
}

// Gemini 把内容审查不当 HTTP 错处理——返回 200 + body 字段。这个 helper 检测两种位置：
// 1) promptFeedback.blockReason: 整个输入被拦（请求一开始就空）
// 2) candidates[0].finishReason: 输出生成中被切断
// 详见 docs/API_ERROR_CODES.md §Gemini 段
const _GEMINI_SAFETY_FINISH_REASONS = new Set([
  'SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'RECITATION', 'SPII',
]);
function _detectGeminiSafetyBlock(data) {
  const promptBlock = data?.promptFeedback?.blockReason;
  if (promptBlock) return { reason: promptBlock, stage: 'prompt' };
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason && _GEMINI_SAFETY_FINISH_REASONS.has(finishReason)) {
    return { reason: finishReason, stage: 'output' };
  }
  return null;
}

/**
 * GeminiAdapter - Gemini API 适配器
 */
class GeminiAdapter extends BaseAdapter {
  constructor(config, apiKey, aiService) {
    super(config, apiKey, aiService);
    this.provider = 'gemini'; // 与 OpenAIAdapter 保持一致
    this.protocolFamily = 'gemini';
  }

  getProviderLabel() {
    return 'Gemini';
  }

  getToolDefinitions() {
    const declarations = this.aiService._getFunctionDeclarations();
    if (declarations.length === 0) return [];
    // Gemini API 严格拒绝未知字段，只保留 name/description/parameters
    // 并递归剥离 additionalProperties —— Gemini 的 OpenAPI 子集不接受此字段
    const cleaned = declarations.map(({ name, description, parameters }) => ({
      name,
      description: description || '',
      parameters: _stripForGemini(parameters) || { type: 'object', properties: {} },
    }));
    return [{ functionDeclarations: cleaned }];
  }

  convertMessages(messages) {
    return messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    }));
  }

  buildPayload(messages, systemPrompt, tools = [], options = {}) {
    const apiKey = this.apiKey;
    const model = this.config.model;
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}`;
    const url = `${baseUrl}:generateContent?key=${apiKey}`;
    const streamUrl = `${baseUrl}:streamGenerateContent?alt=sse&key=${apiKey}`;

    // 支持 systemPrompt 为数组（多个 parts）或字符串（单个 part）
    // Gemini parts 只接受 text，需剥离 cacheable/cacheBreakpoint/tag 等跨 provider 元数据
    // 同时把 roleOverride='user' 的自定义 prompt 项拆出来 merge 到第一条真实 user 消息里
    // （Gemini 严格要求 user/model 交替，不能两条连续 user）
    const { systemParts: _spArr, userPrepends } = _splitPromptParts(systemPrompt);
    const systemParts = Array.isArray(_spArr)
      ? _spArr.map(p => {
          if (typeof p === 'string') return { text: p };
          return { text: p.text || '' };
        }).filter(p => p.text)
      : [{ text: _spArr }];
    const joinedPrepend = _joinUserPrepends(userPrepends);
    const finalContents = _mergePrependIntoFirstUser(messages, joinedPrepend, 'gemini');

    const payload = {
      system_instruction: { parts: systemParts },
      contents: finalContents, // 已经是 Gemini 格式
      generationConfig: { temperature: options.temperature ?? 1.0 },
    };

    if (tools.length > 0) {
      payload.tools = tools;
      // toolChoice 翻译 (Gemini): 'auto'→{mode:AUTO} / 'any'→{mode:ANY} /
      //   {name}→{mode:ANY, allowed_function_names:[name]} / 'none'→{mode:NONE}
      // 单工具退化：与 OpenAI/Anthropic 路径对齐——只有一个候选时 allowed_function_names
      // 是冗余约束，{mode:'ANY'} 已等价。
      const tc = options.toolChoice;
      // Gemini 的 tools 结构是 [{functionDeclarations:[...]}]，单工具判定要看 declarations 内层
      const decls = tools[0]?.functionDeclarations || [];
      if (tc && typeof tc === 'object' && typeof tc.name === 'string') {
        const onlyTool = tools.length === 1 && decls.length === 1 && decls[0]?.name === tc.name;
        payload.tool_config = onlyTool
          ? { function_calling_config: { mode: 'ANY' } }
          : {
              function_calling_config: {
                mode: 'ANY',
                allowed_function_names: [tc.name],
              },
            };
      } else if (tc === 'any') {
        payload.tool_config = { function_calling_config: { mode: 'ANY' } };
      } else if (tc === 'none') {
        payload.tool_config = { function_calling_config: { mode: 'NONE' } };
      } else {
        payload.tool_config = { function_calling_config: { mode: 'AUTO' } };
      }
    }

    // Structured Output: 使用 JSON Schema 约束输出格式
    if (options.responseSchema) {
      payload.generationConfig.responseMimeType = 'application/json';
      payload.generationConfig.responseJsonSchema = options.responseSchema;
    }

    // 联网搜索：调用方决定 stage/provider 是否合适，这里只负责注入 google_search 工具。
    // Gemini 规矩：function declarations + built-in tool 共存时，tool_config 必须显式
    // 加 include_server_side_tool_invocations=true，否则 400 INVALID_ARGUMENT。
    if (options.webSearch === true) {
      if (!Array.isArray(payload.tools)) payload.tools = [];
      payload.tools.push({ google_search: {} });
      if (!payload.tool_config) payload.tool_config = {};
      payload.tool_config.include_server_side_tool_invocations = true;
    }

    return { payload, url, streamUrl };
  }

  updateSystemParts(payload, systemPrompt) {
    if (!payload) return;
    // user-role 自定义 prompt 已在 buildPayload 时 merge 进 messages，updateSystemParts
    // 只负责刷新 system_instruction；user prepend 的"在线热更"由调用方走完整 buildPayload。
    const { systemParts: _spArr } = _splitPromptParts(systemPrompt);
    const systemParts = Array.isArray(_spArr)
      ? _spArr.map(p => {
          if (typeof p === 'string') return { text: p };
          return { text: p.text || '' };
        }).filter(p => p.text)
      : [{ text: _spArr }];
    payload.system_instruction = { parts: systemParts };
  }

  async callAPI(url, payload, onChunk = null, abortSignal = null) {
    const timeoutMs = 1200000;
    const controller = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason ?? new Error('Upstream signal already aborted'));
      } else {
        abortSignal.addEventListener(
          'abort',
          () => controller.abort(abortSignal.reason ?? new Error('Upstream signal aborted')),
          { once: true }
        );
      }
    }
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`API timeout (${timeoutMs / 1000}s)`)),
      timeoutMs
    );
    const startTime = performance.now();

    try {
      if (onChunk) {
        // 流式模式
        return await this._callStreaming(url, payload, onChunk, controller, startTime);
      } else {
        // 非流式模式
        return await this._callNonStreaming(url, payload, controller, startTime);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        // 外部中止：直接抛出 AbortError，由调用方处理
        if (abortSignal && abortSignal.aborted) throw e;
        const timeoutError = new Error(`API 请求超时 (${timeoutMs / 1000}秒)`);
        timeoutError.apiErrorInfo = _buildApiErrorInfo({
          provider: this.provider,
          url,
          startTime,
          errorType: 'timeout',
          originalName: e.name,
        });
        throw timeoutError;
      }

      if (!e.apiErrorInfo) {
        const isNetworkTypeError = e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message);
        e.apiErrorInfo = _buildApiErrorInfo({
          provider: this.provider,
          url,
          startTime,
          errorType: isNetworkTypeError ? 'network' : e.name === 'TypeError' ? 'runtime' : 'unknown',
          originalName: e.name,
        });
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async _callNonStreaming(url, payload, controller, startTime) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // TTFB: 从请求开始到收到响应头的时间（服务器处理 + 网络往返）
    const ttfb = performance.now() - startTime;

    if (!response.ok) {
      const bodyResult = await _readErrorResponseBody(response);
      const headersObj = _headersToObject(response.headers);
      const requestId = _extractRequestId(headersObj);
      const providerError = _extractProviderErrorDetails(
        this.provider,
        bodyResult.parsed || bodyResult.body
      );
      const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;
      const errorMessage = providerError.message || fallbackMessage;
      const error = new Error(errorMessage);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'http',
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBody: bodyResult.body,
        responseHeaders: headersObj,
        providerErrorType: providerError.type,
        providerErrorCode: providerError.code,
        providerErrorParam: providerError.param,
        requestId,
      });
      throw error;
    }

    const data = await response.json();

    // Gemini 安全过滤：HTTP 200 但 promptFeedback / finishReason 表明内容被审查拦了——抛 error 走标准错误流程
    const safetyBlock = _detectGeminiSafetyBlock(data);
    if (safetyBlock) {
      const error = new Error(`Gemini safety filter blocked ${safetyBlock.stage}: ${safetyBlock.reason}`);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'safety_filtered',
        httpStatus: 200,
        responseBody: JSON.stringify(data).slice(0, 500),
        safetyReason: safetyBlock.reason,
        safetyStage: safetyBlock.stage,
      });
      throw error;
    }

    const totalTime = performance.now() - startTime;
    // Download: 下载响应体的时间
    const downloadTime = totalTime - ttfb;

    // 提取文本（Gemini 可能把正文拆到多个 part，需按顺序拼接）
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let text = '';
    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.length > 0) {
        text += part.text;
      }
    }

    // 提取 token 使用量
    // Gemini: promptTokenCount (输入), candidatesTokenCount (输出), thoughtsTokenCount (thinking tokens, Gemini 2.5+)
    const usage = data?.usageMetadata;
    const inputTokens = usage?.promptTokenCount || 0;
    // candidatesTokenCount 是实际输出，thoughtsTokenCount 是 thinking 过程（也算输出/花费）
    const candidateTokens = usage?.candidatesTokenCount || 0;
    const thoughtsTokens = usage?.thoughtsTokenCount || 0;
    const outputTokens = candidateTokens + thoughtsTokens;
    // Gemini 2.5 context cache: cachedContentTokenCount = 命中缓存的 input token 数 (input 子集)
    const cacheReadTokens = usage?.cachedContentTokenCount || 0;
    // 末帧 finishReason: STOP / MAX_TOKENS / SAFETY / RECITATION / OTHER / BLOCKLIST / ...
    const stopReason = data?.candidates?.[0]?.finishReason || null;

    return {
      text,
      toolCalls: [], // 工具调用由 parseToolCalls 单独处理
      reasoningContent: null,
      metrics: {
        ttfb: Math.round(ttfb), // 响应头到达时间
        downloadTime: Math.round(downloadTime), // 下载时间
        ttft: Math.round(ttfb), // 兼容旧字段
        totalTime: Math.round(totalTime),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens: 0, // Gemini 无显式 cache_creation 概念
        stopReason,
      },
      raw: data,
    };
  }

  async _callStreaming(url, payload, onChunk, controller, startTime) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // TTFB: 响应头到达时间
    const ttfb = performance.now() - startTime;

    if (!response.ok) {
      const bodyResult = await _readErrorResponseBody(response);
      const headersObj = _headersToObject(response.headers);
      const requestId = _extractRequestId(headersObj);
      const providerError = _extractProviderErrorDetails(
        this.provider,
        bodyResult.parsed || bodyResult.body
      );
      const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;
      const errorMessage = providerError.message || fallbackMessage;
      const error = new Error(errorMessage);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'http',
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBody: bodyResult.body,
        responseHeaders: headersObj,
        providerErrorType: providerError.type,
        providerErrorCode: providerError.code,
        providerErrorParam: providerError.param,
        requestId,
      });
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let ttft = null;
    let accumulatedText = '';
    let lastChunkData = null;
    let usageMetadata = null;
    const accumulatedFunctionCallParts = []; // 收集流式中的 functionCall parts（保留完整 part 以包含 thoughtSignature 等 sibling 字段）

    const processSseLine = line => {
      const trimmedLine = line.trim();
      // 兼容 "data:" 和 "data: " 两种格式
      if (!trimmedLine || !trimmedLine.startsWith('data:')) return;

      const jsonStr = trimmedLine.slice(5).trim();
      if (!jsonStr || jsonStr === '[DONE]') return;

      try {
        const data = JSON.parse(jsonStr);
        lastChunkData = data;

        if (data.usageMetadata) {
          usageMetadata = data.usageMetadata;
        }

        const parts = data?.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts) || parts.length === 0) return;

        // Gemini 可能把文本分散在多个 part 里，不能只读 parts[0]
        let chunkText = '';
        for (const part of parts) {
          if (typeof part?.text === 'string' && part.text.length > 0) {
            chunkText += part.text;
          }
          // 收集 functionCall parts（Gemini 以完整对象发送，非增量）
          // 保留整个 part，以包含 thoughtSignature 等必须回传的 sibling 字段
          if (part?.functionCall) {
            accumulatedFunctionCallParts.push(part);
            // 流式叙事：Gemini 把 update_narrative 的正文放在 functionCall.args.text 里，
            // 没有顶层 part.text，所以走独立的 narrativeStream 通道（和 OpenAI 路径一致）
            if (part.functionCall.name === 'update_narrative' && onChunk) {
              const narrText = part.functionCall.args?.text;
              if (typeof narrText === 'string' && narrText.length > 0) {
                if (ttft === null) {
                  ttft = performance.now() - startTime;
                  console.log(`[Gemini Stream] TTFT: ${Math.round(ttft)}ms`);
                }
                onChunk(accumulatedText, null, { narrativeStream: narrText, narrativeBlob: true });
              }
            }
          }
        }

        // 只有本次 chunk 确实有新增文本时才触发 onChunk
        if (chunkText) {
          if (ttft === null) {
            ttft = performance.now() - startTime;
            console.log(`[Gemini Stream] TTFT: ${Math.round(ttft)}ms`);
          }
          accumulatedText += chunkText;
          onChunk(accumulatedText);
        }
      } catch (e) {
        console.warn('[Gemini Stream] JSON parse error:', e.message);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        processSseLine(line);
      }
    }

    // 刷新 decoder 缓冲，避免最后一个分片丢失
    buffer += decoder.decode();

    // 处理尾缓冲区（有些 SSE 最后一条没有换行）
    if (buffer.trim()) {
      const tailLines = buffer.split('\n');
      for (const line of tailLines) {
        processSseLine(line);
      }
    }

    const totalTime = performance.now() - startTime;
    console.log(`[Gemini Stream] 完成 - 总时间: ${Math.round(totalTime)}ms`);

    // Gemini 安全过滤（流式版）：解析最后一个 chunk 的 promptFeedback / finishReason 看是否被审查拦了
    const safetyBlock = _detectGeminiSafetyBlock(lastChunkData);
    if (safetyBlock) {
      const error = new Error(`Gemini safety filter blocked ${safetyBlock.stage}: ${safetyBlock.reason}`);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'safety_filtered',
        httpStatus: 200,
        responseBody: JSON.stringify(lastChunkData).slice(0, 500),
        safetyReason: safetyBlock.reason,
        safetyStage: safetyBlock.stage,
      });
      throw error;
    }

    // 构建标准化响应（含流式中收集的 functionCall parts）
    const finalCandidate = lastChunkData?.candidates?.[0] || {};
    const finalUsage = usageMetadata || lastChunkData?.usageMetadata || null;
    const reconstructedParts = [{ text: accumulatedText }];
    for (const fcPart of accumulatedFunctionCallParts) {
      reconstructedParts.push(fcPart);
    }
    const reconstructedResponse = {
      candidates: [
        {
          content: {
            parts: reconstructedParts,
            role: 'model',
          },
          finishReason: finalCandidate.finishReason || 'STOP',
          index: 0,
          safetyRatings: finalCandidate.safetyRatings || [],
        },
      ],
      usageMetadata: finalUsage,
      modelVersion: lastChunkData?.modelVersion || null,
    };

    // 提取 token 使用量
    // Gemini: promptTokenCount (输入), candidatesTokenCount (输出), thoughtsTokenCount (thinking tokens, Gemini 2.5+)
    const inputTokens = finalUsage?.promptTokenCount || 0;
    const candidateTokens = finalUsage?.candidatesTokenCount || 0;
    const thoughtsTokens = finalUsage?.thoughtsTokenCount || 0;
    const outputTokens = candidateTokens + thoughtsTokens;
    const cacheReadTokens = finalUsage?.cachedContentTokenCount || 0;
    const stopReason = lastChunkData?.candidates?.[0]?.finishReason
      || reconstructedResponse?.candidates?.[0]?.finishReason
      || null;

    // 计算 downloadTime（流式：从响应头到结束）
    const downloadTime = totalTime - ttfb;

    return {
      text: accumulatedText,
      toolCalls: [],
      reasoningContent: null,
      metrics: {
        ttfb: Math.round(ttfb), // 响应头到达时间
        downloadTime: Math.round(downloadTime), // 流式下载时间
        ttft: Math.round(ttft || totalTime), // 首 token 时间
        totalTime: Math.round(totalTime),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens: 0,
        stopReason,
      },
      raw: reconstructedResponse,
    };
  }

  parseToolCalls(rawResponse) {
    const candidate = rawResponse?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    const parts = candidate?.content?.parts || [];

    // 处理 MALFORMED_FUNCTION_CALL 错误
    if (finishReason === 'MALFORMED_FUNCTION_CALL') {
      const finishMessage = candidate?.finishMessage || '';
      console.warn(`[GeminiAdapter] 检测到 MALFORMED_FUNCTION_CALL，尝试解析...`);
      const recoveredCalls = this._parseMalformedFunctionCalls(finishMessage);
      return {
        toolCalls: [],
        needsRecovery: true,
        recoveredCalls: recoveredCalls.map(c => ({ name: c.name, args: c.args })),
      };
    }

    // 正常情况:提取 functionCall
    const functionCallParts = parts.filter(p => p.functionCall);
    const toolCalls = functionCallParts.map(p => ({
      name: p.functionCall.name,
      args: p.functionCall.args,
      _raw: p,
    }));

    return { toolCalls, needsRecovery: false, recoveredCalls: [] };
  }

  _parseMalformedFunctionCalls(finishMessage) {
    const calls = [];
    try {
      const content = finishMessage.replace(/^Malformed function call:\s*/i, '');
      const callRegex = /call:default_api:(\w+)\{([^}]*)\}/g;
      let match;

      while ((match = callRegex.exec(content)) !== null) {
        const name = match[1];
        const paramsStr = match[2];
        const args = {};

        const paramPairs = paramsStr.split(',');
        for (const pair of paramPairs) {
          const colonIdx = pair.indexOf(':');
          if (colonIdx > 0) {
            const key = pair.substring(0, colonIdx).trim();
            const value = pair.substring(colonIdx + 1).trim();
            if (key && value) {
              args[key] = value;
            }
          }
        }
        calls.push({ name, args });
      }
      console.log(`[GeminiAdapter] 从 MALFORMED_FUNCTION_CALL 解析出 ${calls.length} 个工具调用`);
    } catch (e) {
      console.error('[GeminiAdapter] MALFORMED_FUNCTION_CALL 解析失败:', e);
    }
    return calls;
  }

  cleanHistoryForGeneration(messages) {
    const collectedReferences = [];
    let lastGameState = null;
    const cleanedContents = [];

    for (const msg of messages) {
      const cleanedParts = [];
      for (const part of msg.parts) {
        if (part.functionCall) {
          continue;
        } else if (part.functionResponse) {
          const name = part.functionResponse.name;
          const content = part.functionResponse.response?.content;
          if (content) {
            collectedReferences.push(`### [${name}]\n${content}`);
          }
          continue;
        } else if (part.text && msg.role === 'model') {
          const text = part.text.trim();
          const isJson = text.startsWith('```json') || text.startsWith('{');
          if (isJson) {
            try {
              const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
              const jsonContent = jsonMatch ? jsonMatch[1] : text;
              const parsed = JSON.parse(jsonContent);

              if (parsed.panel_narrative) {
                cleanedParts.push({ text: parsed.panel_narrative });
              }

              delete parsed.panel_narrative;
              delete parsed.panel_npc; // 权威角色档案由单独的 part 提供
              delete parsed.choices; // 选项不需要传递给叙事阶段

              // 转换为纯文字格式，消除 JSON 视觉诱导
              const status = parsed.panel_status;
              if (status) {
                lastGameState = buildStatusSummaryText(status);
              } else {
                lastGameState = null;
              }
            } catch (e) {
              cleanedParts.push(part);
            }
            continue;
          } else {
            cleanedParts.push(part);
          }
        } else {
          cleanedParts.push(part);
        }
      }
      if (cleanedParts.length > 0) {
        cleanedContents.push({ role: msg.role, parts: cleanedParts });
      }
    }

    return { cleanedMessages: cleanedContents, collectedReferences, lastGameState };
  }

  appendToolResults(messages, toolCalls, results, assistantContent = null) {
    // 构建 model 的 parts：先放思考文本，再放 functionCall
    const modelParts = [];
    if (assistantContent) {
      modelParts.push({ text: assistantContent });
    }
    modelParts.push(...toolCalls.map(tc => tc._raw || {
      functionCall: { name: tc.name, args: tc.args },
    }));

    // 构建 user 的 functionResponse parts
    const responseParts = results.map(r => ({
      functionResponse: {
        name: r.name,
        response: { content: r.result },
      },
    }));

    messages.push({ role: 'model', parts: modelParts }, { role: 'user', parts: responseParts });

    return messages;
  }

  appendAssistantText(messages, text) {
    if (!text) return;
    messages.push({ role: 'model', parts: [{ text }] });
  }

  getPayloadMessagesRef(payload) {
    return payload.contents;
  }

  syncExecutedTools(messages, executedTools) {
    for (const content of messages) {
      if (content.parts) {
        for (const part of content.parts) {
          if (part.functionCall) {
            const fc = part.functionCall;
            const sig = `${fc.name}:${JSON.stringify(fc.args)}`;
            if (!executedTools.has(sig)) {
              executedTools.add(sig);
              console.log(`[GeminiAdapter] 同步已执行工具: ${fc.name}`);
            }
          }
        }
      }
    }
  }
}

/**
 * OpenAIAdapter - OpenAI 兼容 API 适配器
 * 支持 OpenAI、Grok、DeepSeek
 */
class OpenAIAdapter extends BaseAdapter {
  constructor(
    config,
    apiKey,
    aiService,
    provider = 'openai',
    customName = null,
    customBaseUrl = null,
    customMaxOutputTokens = null
  ) {
    super(config, apiKey, aiService);
    this.provider = provider; // 'openai' | 'grok' | 'deepseek' | 'siliconflow' | 'custom'
    this.protocolFamily = 'openai';
    this.customName = customName;
    this.customBaseUrl = customBaseUrl;
    this.customMaxOutputTokens = customMaxOutputTokens;
  }

  getProviderLabel() {
    if (this.provider === 'custom' && this.customName) return this.customName;
    switch (this.provider) {
      case 'grok':
        return 'Grok';
      case 'deepseek':
        return 'DeepSeek';
      case 'siliconflow':
        return 'SiliconFlow (CN)';
      default:
        return 'OpenAI';
    }
  }

  getToolDefinitions() {
    const geminiDeclarations = this.aiService._getFunctionDeclarations();
    return geminiDeclarations.map(decl => ({
      type: 'function',
      function: {
        name: decl.name,
        description: decl.description,
        parameters: decl.parameters,
      },
    }));
  }

  convertMessages(messages) {
    return messages.map(m => ({
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content,
    }));
  }

  buildPayload(messages, systemPrompt, tools = [], options = {}) {
    let baseUrl;
    switch (this.provider) {
      case 'custom':
        baseUrl = String(this.customBaseUrl || '')
          .trim()
          .replace(/\/+$/, '');
        if (!baseUrl) {
          throw new Error(`自定义服务商 "${this.customName || ''}" 未配置 Base URL`);
        }
        break;
      default:
        if (this.aiService && typeof this.aiService.getProviderBaseUrl === 'function') {
          baseUrl = this.aiService.getProviderBaseUrl(this.provider);
        } else {
          switch (this.provider) {
            case 'grok':
              baseUrl = 'https://api.x.ai/v1';
              break;
            case 'deepseek':
              baseUrl = 'https://api.deepseek.com';
              break;
            case 'siliconflow':
              baseUrl = 'https://api.siliconflow.cn/v1';
              break;
            default:
              baseUrl = 'https://api.openai.com/v1';
          }
        }
    }
    const url = baseUrl + '/chat/completions';

    // 支持 systemPrompt 为数组（多个 parts）或字符串
    // OpenAI 格式需要将所有 parts 拼接成单个字符串
    // 拆出 roleOverride='user' 的自定义 prompt 项作为 user 消息 prepend
    const { systemParts: _spArr, userPrepends } = _splitPromptParts(systemPrompt);
    const systemContent = Array.isArray(_spArr)
      ? _spArr.map(p => (typeof p === 'string' ? p : p.text || '')).join('\n\n---\n\n')
      : _spArr;
    // 多条 user prepend 一律 join 成 1 条（避免连续 user 消息违规、统一各 adapter 行为）
    const joinedPrepend = _joinUserPrepends(userPrepends);

    // 转换消息格式：兼容 Gemini 格式（parts）和 OpenAI 格式（content）
    // ⚠️ 关键：保留 tool_calls / tool_call_id / name 字段。
    //   并行 ReAct 流水线会把已含 tool_calls 的 messagesRef 重新喂给 buildPayload
    //   （iter 5/6/7 each rebuild payload with stage-specific tools）。如果 map 抹掉
    //   tool_calls / tool_call_id，DeepSeek 收到的 tool message 缺 tool_call_id 会 400：
    //   "Failed to deserialize the JSON body into the target type: messages[N]: missing field tool_call_id"
    const convertedMessages = messages.map(m => {
      // 如果已经有 content，使用它；否则从 parts 中提取
      let content = m.content;
      if (!content && m.parts && m.parts.length > 0) {
        content = m.parts.map(p => p.text || '').join('\n');
      }
      const out = {
        role: m.role === 'model' ? 'assistant' : m.role,
        // assistant 带 tool_calls 时 content 可以是 null/空，OpenAI 协议允许；其他情况 fallback ''
        content: content !== undefined && content !== null ? content : (m.tool_calls ? null : ''),
      };
      if (m.tool_calls) out.tool_calls = m.tool_calls;
      if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
      if (m.name && m.role === 'tool') out.name = m.name;
      return out;
    });

    // 构建 messages(已包含 system + 自定义 user prepend merge 到第一条 user)
    const finalConverted = _mergePrependIntoFirstUser(convertedMessages, joinedPrepend, 'openai');
    const apiMessages = [
      { role: 'system', content: systemContent },
      ...finalConverted,
    ];

    const payload = {
      model: this.config.model,
      messages: apiMessages,
      temperature: options.temperature ?? 1.0,
    };

    if (tools.length > 0) {
      payload.tools = tools;
      // toolChoice 翻译 (OpenAI 协议家族): 'auto'→'auto' / 'any'→'required' /
      //   {name}→{type:'function', function:{name}} / 'none'→'none'
      // 单工具退化：tools.length===1 且 {name} 指向的就是该工具时，降级为 'required'。
      // 注意：DeepSeek 推理后端（thinking=enabled 时路由到的 deepseek-reasoner）
      // 不接受 'auto'/'none' 之外的任何 tool_choice，会下方 reasoner 兜底强制把 thinking 关掉。
      const tc = options.toolChoice;
      if (tc && typeof tc === 'object' && typeof tc.name === 'string') {
        const onlyTool = tools.length === 1 && tools[0]?.function?.name === tc.name;
        payload.tool_choice = onlyTool
          ? 'required'
          : { type: 'function', function: { name: tc.name } };
      } else if (tc === 'any') {
        payload.tool_choice = 'required';
      } else if (tc === 'none') {
        payload.tool_choice = 'none';
      } else {
        payload.tool_choice = 'auto';
      }
    }

    // DeepSeek V4 hybrid 思考控制
    if (this.provider === 'deepseek') {
      const thinkingLevel = String(options.thinking || 'off').toLowerCase();
      if (thinkingLevel === 'off') {
        payload.thinking = { type: 'disabled' };
      } else {
        payload.thinking = { type: 'enabled' };
        payload.reasoning_effort = thinkingLevel === 'max' ? 'max' : 'high';
      }
    }

    // DeepSeek 推理后端不接受 'auto'/'none' 之外的 tool_choice。
    // thinking=enabled 路由到 deepseek-reasoner；当请求带强制 tool_choice 时降级 thinking → disabled
    //   而不是降级 tool_choice → auto——保留"必须调这个工具"的硬保证，
    //   牺牲该次请求的 reasoning（仅命中 forced-tool 的 5 个 iter 槽：iter 1/6/7/8.panel/9）。
    // 实测验证（2026-05-04，tools/probe-deepseek-tool-choice.mjs）：
    //   thinking=enabled  + 'required' / {type:'function'} → 400 "deepseek-reasoner does not support this tool_choice"
    //   thinking=disabled + 'required' / {type:'function'} → 200，正常工作
    // strict 模式（probe-deepseek-strict.mjs）实测无法绕开此限制：H/I/M/N 全 400。
    if (
      this.provider === 'deepseek' &&
      payload.thinking?.type === 'enabled' &&
      payload.tool_choice &&
      payload.tool_choice !== 'auto' &&
      payload.tool_choice !== 'none'
    ) {
      const original = typeof payload.tool_choice === 'string'
        ? payload.tool_choice
        : JSON.stringify(payload.tool_choice);
      console.warn(
        `[aiAdapters] deepseek-reasoner: forced tool_choice ${original} 触发 thinking enabled→disabled（保留硬工具保证，牺牲本次 CoT）`
      );
      payload.thinking = { type: 'disabled' };
      delete payload.reasoning_effort;
    }

    // Structured Output: 根据 provider 选择不同格式
    if (options.responseSchema) {
      if (['openai', 'grok'].includes(this.provider)) {
        payload.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'step3_output',
            strict: true,
            schema: options.responseSchema,
          },
        };
      } else {
        delete payload.response_format;
      }
    }

    const explicitMaxTokens = options.maxTokens || options.max_tokens;
    if (explicitMaxTokens) {
      payload.max_tokens = explicitMaxTokens;
    } else if (this.customMaxOutputTokens) {
      payload.max_tokens = this.customMaxOutputTokens;
    }

    return { payload, url, streamUrl: url };
  }

  updateSystemParts(payload, systemPrompt) {
    if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) return;
    // user-role 自定义 prompt 已在 buildPayload 时 merge 进 messages，updateSystemParts
    // 只负责刷新 system 消息；user prepend 的"在线热更"由调用方走完整 buildPayload。
    const { systemParts: _spArr } = _splitPromptParts(systemPrompt);
    const systemContent = Array.isArray(_spArr)
      ? _spArr.map(p => (typeof p === 'string' ? p : p.text || '')).join('\n\n---\n\n')
      : _spArr;
    const head = payload.messages[0];
    if (head?.role === 'system') {
      head.content = systemContent;
    } else {
      payload.messages.unshift({ role: 'system', content: systemContent });
    }
  }

  async callAPI(url, payload, onChunk = null, abortSignal = null) {
    const timeoutMs = 1200000;
    const controller = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason ?? new Error('Upstream signal already aborted'));
      } else {
        abortSignal.addEventListener(
          'abort',
          () => controller.abort(abortSignal.reason ?? new Error('Upstream signal aborted')),
          { once: true }
        );
      }
    }
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`API timeout (${timeoutMs / 1000}s)`)),
      timeoutMs
    );
    const startTime = performance.now();

    try {
      if (onChunk) {
        return await this._callStreaming(url, payload, onChunk, controller, startTime);
      } else {
        return await this._callNonStreaming(url, payload, controller, startTime);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        if (abortSignal && abortSignal.aborted) throw e;
        const timeoutError = new Error(`API 请求超时 (${timeoutMs / 1000}秒)`);
        timeoutError.apiErrorInfo = _buildApiErrorInfo({
          provider: this.provider,
          url,
          startTime,
          errorType: 'timeout',
          originalName: e.name,
        });
        throw timeoutError;
      }

      if (!e.apiErrorInfo) {
        const isNetworkTypeError = e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message);
        e.apiErrorInfo = _buildApiErrorInfo({
          provider: this.provider,
          url,
          startTime,
          errorType: isNetworkTypeError ? 'network' : e.name === 'TypeError' ? 'runtime' : 'unknown',
          originalName: e.name,
        });
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async _callNonStreaming(url, payload, controller, startTime) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // TTFB: 从请求开始到收到响应头的时间（服务器处理 + 网络往返）
    const ttfb = performance.now() - startTime;

    if (!response.ok) {
      const bodyResult = await _readErrorResponseBody(response);
      const headersObj = _headersToObject(response.headers);
      const requestId = _extractRequestId(headersObj);
      const providerError = _extractProviderErrorDetails(
        this.provider,
        bodyResult.parsed || bodyResult.body
      );
      const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;
      const errorMessage = providerError.message || fallbackMessage;
      const error = new Error(errorMessage);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'http',
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBody: bodyResult.body,
        responseHeaders: headersObj,
        providerErrorType: providerError.type,
        providerErrorCode: providerError.code,
        providerErrorParam: providerError.param,
        requestId,
      });
      throw error;
    }

    const data = await response.json();
    const totalTime = performance.now() - startTime;
    // Download: 下载响应体的时间
    const downloadTime = totalTime - ttfb;

    const choice = data?.choices?.[0];
    const message = choice?.message;
    const text = message?.content || '';
    const reasoningContent = message?.reasoning_content || null;
    const toolCallsRaw = message?.tool_calls;

    // 提取 token 使用量
    // OpenAI/DeepSeek: prompt_tokens (输入), completion_tokens (输出)
    // 注意: DeepSeek 的 completion_tokens 已包含 reasoning_tokens（无需额外相加）
    const usage = data?.usage;
    const inputTokens = usage?.prompt_tokens || 0;
    const outputTokens = usage?.completion_tokens || 0;
    // Prompt cache:
    //   OpenAI  → usage.prompt_tokens_details.cached_tokens
    //   DeepSeek → usage.prompt_cache_hit_tokens
    // 两组字段位置不同、不会同时出现；同时探之。OpenAI 无显式 cache_creation 概念。
    const cacheReadTokens =
      usage?.prompt_tokens_details?.cached_tokens
      ?? usage?.prompt_cache_hit_tokens
      ?? 0;
    // 末帧 finish_reason: stop / length / tool_calls / content_filter / function_call
    const stopReason = data?.choices?.[0]?.finish_reason || null;

    // 空响应/错误诊断：与流式路径同款，挂进 data._diagnostics 让 trace 能看见 service 端实际返回
    const isEmpty = !text && !reasoningContent
      && (!toolCallsRaw || toolCallsRaw.length === 0)
      && !usage;
    if (isEmpty || data?.error || !data?.choices?.length) {
      // 上游返回 null body 或解析后 data 为 null/非对象时，避免 null._diagnostics 解引用 (bug-0123/0124)
      if (!data || typeof data !== 'object') data = {};
      data._diagnostics = {
        kind: data?.error ? 'error_body' : (!data?.choices?.length ? 'no_choices' : 'empty_response'),
        finishReason: choice?.finish_reason || null,
        errorBody: data?.error || undefined,
        // rawData 故意省略：data 自身已挂载 _diagnostics，自引用会让 JSON.stringify 抛
        // "Converting circular structure to JSON"。下游没有消费 _diagnostics.rawData，需要原始 body 时直接读 data。
        requestSummary: {
          tool_choice: payload.tool_choice,
          tools_count: Array.isArray(payload.tools) ? payload.tools.length : 0,
          tools_names: Array.isArray(payload.tools)
            ? payload.tools.map(t => t?.function?.name).filter(Boolean)
            : [],
          thinking: payload.thinking,
          reasoning_effort: payload.reasoning_effort,
          stream: false,
        },
      };
      console.warn(
        `[${this.getProviderLabel()}] 非流式空响应/错误诊断 - kind=${data._diagnostics.kind}, ` +
        `finish=${data._diagnostics.finishReason}, ` +
        `tool_choice=${JSON.stringify(payload.tool_choice)}, ` +
        `tools=${data._diagnostics.requestSummary.tools_names.join(',')}`,
        { errorBody: data?.error, rawData: data }
      );
    }

    return {
      text,
      toolCalls: [], // 工具调用由 parseToolCalls 单独处理
      reasoningContent,
      metrics: {
        ttfb: Math.round(ttfb), // 服务器响应时间
        downloadTime: Math.round(downloadTime), // 下载时间
        ttft: Math.round(ttfb), // 兼容旧字段
        totalTime: Math.round(totalTime),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens: 0, // OpenAI/DeepSeek 无 cache_creation 概念
        stopReason,
      },
      raw: data,
    };
  }

  async _callStreaming(url, payload, onChunk, controller, startTime) {
    // OpenAI/DeepSeek 流式输出需要 stream_options.include_usage 才能获取 token 使用量
    const streamPayload = {
      ...payload,
      stream: true,
      stream_options: { include_usage: true },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey,
      },
      body: JSON.stringify(streamPayload),
      signal: controller.signal,
    });

    // TTFB: 响应头到达时间
    const ttfb = performance.now() - startTime;

    if (!response.ok) {
      const bodyResult = await _readErrorResponseBody(response);
      const headersObj = _headersToObject(response.headers);
      const requestId = _extractRequestId(headersObj);
      const providerError = _extractProviderErrorDetails(
        this.provider,
        bodyResult.parsed || bodyResult.body
      );
      const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;
      const errorMessage = providerError.message || fallbackMessage;
      const error = new Error(errorMessage);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'http',
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBody: bodyResult.body,
        responseHeaders: headersObj,
        providerErrorType: providerError.type,
        providerErrorCode: providerError.code,
        providerErrorParam: providerError.param,
        requestId,
      });
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let ttft = null;
    let accumulatedText = '';
    let accumulatedReasoning = '';
    let lastChunkData = null;
    let usageData = null;
    let modelName = null;
    const toolCallsMap = new Map(); // index → {id, type, function: {name, arguments}}
    // 诊断：保存原始 SSE 帧（cap 30 条防止内存炸）+ 单独捕获 error 帧。
    // 当 stream 收完但 text/reasoning/toolCalls/usage 全空时把 raw chunk 塞进
    // reconstructedResponse._diagnostics 给 trace 看。
    // 历史上的典型触发是 reasoner + 强制 tool_choice 静默失败；该 case 现在被
    // buildPayload 的 reasoner 兜底（thinking enabled→disabled）消除，主要服务于其他 provider 的空响应。
    const rawChunks = [];
    const errorFrames = [];
    const RAW_CHUNK_CAP = 30;
    let totalChunkCount = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        const jsonStr = trimmedLine.slice(6).trim();
        if (jsonStr === '[DONE]') continue;

        try {
          const data = JSON.parse(jsonStr);
          lastChunkData = data;
          totalChunkCount += 1;
          if (rawChunks.length < RAW_CHUNK_CAP) rawChunks.push(data);
          if (data.error) errorFrames.push(data.error);

          if (data.model) modelName = data.model;
          if (data.usage) usageData = data.usage;

          const delta = data?.choices?.[0]?.delta;
          if (delta) {
            // DeepSeek reasoning_content
            if (delta.reasoning_content) {
              accumulatedReasoning += delta.reasoning_content;
              onChunk(accumulatedText, accumulatedReasoning);
            }
            // 普通内容
            if (delta.content) {
              if (ttft === null) {
                ttft = performance.now() - startTime;
                console.log(`[${this.getProviderLabel()} Stream] TTFT: ${Math.round(ttft)}ms`);
              }
              accumulatedText += delta.content;
              onChunk(accumulatedText, accumulatedReasoning);
            }
            // tool_calls 增量累积
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || '',
                    type: 'function',
                    function: { name: tc.function?.name || '', arguments: '' },
                  });
                }
                const existing = toolCallsMap.get(idx);
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.function.name = tc.function.name;
                if (tc.function?.arguments) {
                  existing.function.arguments += tc.function.arguments;
                  // 流式叙事：检测 update_narrative 并提取部分文本
                  if (existing.function.name === 'update_narrative' && onChunk) {
                    const partialText = _extractPartialNarrativeText(existing.function.arguments);
                    if (partialText) {
                      onChunk(accumulatedText, accumulatedReasoning, { narrativeStream: partialText });
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[${this.getProviderLabel()} Stream] JSON parse error:`, e.message);
        }
      }
    }

    const totalTime = performance.now() - startTime;
    console.log(`[${this.getProviderLabel()} Stream] 完成 - 总时间: ${Math.round(totalTime)}ms`);

    // 构建标准化响应（含流式中累积的 tool_calls）
    const accumulatedToolCalls = toolCallsMap.size > 0 ? [...toolCallsMap.values()] : undefined;
    const finishReason = lastChunkData?.choices?.[0]?.finish_reason || 'stop';
    const reconstructedResponse = {
      id: lastChunkData?.id || 'stream-response',
      object: 'chat.completion',
      model: modelName || this.config.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: accumulatedText,
            reasoning_content: accumulatedReasoning || undefined,
            tool_calls: accumulatedToolCalls,
          },
          finish_reason: finishReason,
        },
      ],
      usage: usageData || null,
    };

    // 空响应诊断：当 text/reasoning/toolCalls/usage 全空时，把 raw 帧挂进 _diagnostics 让 trace 能看见。
    // 历史上的典型触发是 reasoner + 强制 tool_choice 静默失败；该 case 现在被
    // buildPayload 的 reasoner 兜底（thinking enabled→disabled）消除，主要服务于其他 provider 的空响应排查。
    const isEmpty = !accumulatedText && !accumulatedReasoning
      && (!accumulatedToolCalls || accumulatedToolCalls.length === 0)
      && !usageData;
    if (isEmpty || errorFrames.length > 0) {
      reconstructedResponse._diagnostics = {
        kind: errorFrames.length > 0 ? 'error_frame' : 'empty_stream',
        finishReason,
        totalChunkCount,
        capturedChunkCount: rawChunks.length,
        errorFrames: errorFrames.length > 0 ? errorFrames : undefined,
        rawChunks,  // 完整保留 cap 内的 SSE 帧
        requestSummary: {
          tool_choice: payload.tool_choice,
          tools_count: Array.isArray(payload.tools) ? payload.tools.length : 0,
          tools_names: Array.isArray(payload.tools)
            ? payload.tools.map(t => t?.function?.name).filter(Boolean)
            : [],
          thinking: payload.thinking,
          reasoning_effort: payload.reasoning_effort,
          stream: true,
        },
      };
      console.warn(
        `[${this.getProviderLabel()} Stream] 空响应/错误帧诊断 - kind=${reconstructedResponse._diagnostics.kind}, ` +
        `finish=${finishReason}, chunks=${totalChunkCount}, ` +
        `tool_choice=${JSON.stringify(payload.tool_choice)}, ` +
        `tools=${reconstructedResponse._diagnostics.requestSummary.tools_names.join(',')}`,
        { errorFrames, lastChunkData }
      );
    }

    // 提取 token 使用量
    // OpenAI/DeepSeek: prompt_tokens (输入), completion_tokens (输出)
    // 注意: DeepSeek 的 completion_tokens 已包含 reasoning_tokens（无需额外相加）
    const inputTokens = usageData?.prompt_tokens || 0;
    const outputTokens = usageData?.completion_tokens || 0;
    const cacheReadTokens =
      usageData?.prompt_tokens_details?.cached_tokens
      ?? usageData?.prompt_cache_hit_tokens
      ?? 0;
    // finishReason 局部变量在上方 1750 行已从末 chunk 解析过（'stop'/'length'/'tool_calls'/'content_filter'）

    // 计算 downloadTime（流式：从响应头到结束）
    const downloadTime = totalTime - ttfb;

    return {
      text: accumulatedText,
      toolCalls: [],
      reasoningContent: accumulatedReasoning || null,
      metrics: {
        ttfb: Math.round(ttfb), // 响应头到达时间
        downloadTime: Math.round(downloadTime), // 流式下载时间
        ttft: Math.round(ttft || totalTime), // 首 token 时间
        totalTime: Math.round(totalTime),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens: 0,
        stopReason: finishReason || null,
      },
      raw: reconstructedResponse,
    };
  }

  parseToolCalls(rawResponse) {
    const choice = rawResponse?.choices?.[0];
    const message = choice?.message;
    const toolCallsRaw = message?.tool_calls || [];

    // 检测 DeepSeek DSML 伪工具调用 — 支持 ASCII | (U+007C) 和全角 ｜ (U+FF5C)
    const content = message?.content || '';
    const dsmlPattern = /[<＜][|｜]DSML[|｜]/;
    if (this.provider === 'deepseek' && dsmlPattern.test(content)) {
      console.warn(`[OpenAIAdapter] 检测到 DSML 伪工具调用格式`);
      const recoveredCalls = this._parseDSMLToolCalls(content);
      const cleanedText = this._stripDSMLContent(content);
      return {
        toolCalls: [],
        needsRecovery: recoveredCalls.length > 0,
        recoveredCalls,
        cleanedText,
      };
    }

    // 正常工具调用
    const toolCalls = toolCallsRaw.map(tc => {
      let args = {};
      const raw = tc.function.arguments;
      try {
        args = JSON.parse(raw);
      } catch (e) {
        // 兜底：清洗 LLM 常见的非法 JSON 写法后重试
        // 例：DeepSeek 偶尔输出 "delta": +1（JSON 不允许显式正号前缀）
        try {
          const cleaned = String(raw).replace(/(:\s*)\+(\d)/g, '$1$2');
          args = JSON.parse(cleaned);
          console.warn('[OpenAIAdapter] 工具参数 JSON 不规范，已 clean +N 前缀后恢复');
        } catch (_) {
          // 双层 parse 都失败：给 toolCall 打 parseError 标，保留 args={} 以保持类型一致。
          // 调用方（prompt-gm._executeToolCalls）见到 parseError 会跳过 toolRegistry.execute
          // 并向 LLM 返回 [失败] 字符串，避免静默执行空参数工具。
          console.warn('[OpenAIAdapter] 工具参数解析失败:', e, raw?.substring?.(0, 200));
          return {
            name: tc.function.name,
            args: {},
            id: tc.id,
            parseError: {
              message: e?.message || String(e),
              rawPreview: String(raw || '').substring(0, 120),
            },
          };
        }
      }
      return {
        name: tc.function.name,
        args,
        id: tc.id,
      };
    });

    return { toolCalls, needsRecovery: false, recoveredCalls: [] };
  }

  _parseDSMLToolCalls(content) {
    // 支持 ASCII | (U+007C) 和全角 ｜ (U+FF5C)
    const P = '[|｜]'; // pipe 字符类
    const calls = [];
    try {
      const invokeRegex = new RegExp(
        `<${P}DSML${P}invoke\\s+name="([^"]+)">([\\s\\S]*?)<\\/${P}DSML${P}invoke>`, 'g'
      );
      let match;

      while ((match = invokeRegex.exec(content)) !== null) {
        const name = match[1];
        const paramsContent = match[2];
        const args = {};

        // 匹配 <|DSML|parameter name="...">value</|DSML|parameter>
        const paramRegex = new RegExp(
          `<${P}DSML${P}parameter\\s+name="([^"]+)"[^>]*>([^<]*)<\\/${P}DSML${P}parameter>`, 'g'
        );
        let paramMatch;
        while ((paramMatch = paramRegex.exec(paramsContent)) !== null) {
          args[paramMatch[1]] = paramMatch[2];
        }

        // 匹配 <|DSML|input encoding="string">value</|DSML|input>
        const inputRegex = new RegExp(
          `<${P}DSML${P}input[^>]*>([^<]*)<\\/${P}DSML${P}input>`, 'g'
        );
        let inputMatch;
        while ((inputMatch = inputRegex.exec(paramsContent)) !== null) {
          args.query = inputMatch[1];
        }

        // 匹配 <|DSML|function_input name="..." args="..."></|DSML|function_input>
        const fnInputRegex = new RegExp(
          `<${P}DSML${P}function_input\\s+name="([^"]+)"\\s+args="([^"]*)"`, 'g'
        );
        let fnInputMatch;
        while ((fnInputMatch = fnInputRegex.exec(paramsContent)) !== null) {
          args[fnInputMatch[1]] = fnInputMatch[2];
        }

        calls.push({ name, args });
      }
    } catch (e) {
      console.error('[OpenAIAdapter] DSML 解析失败:', e);
    }
    return calls;
  }

  _stripDSMLContent(content) {
    // 移除整个 DSML function_calls 块（支持 ASCII 和全角竖线）
    let cleaned = content.replace(
      /[<＜][|｜]DSML[|｜]function_calls[>＞][\s\S]*?<\/[|｜]DSML[|｜]function_calls[>＞]/g,
      ''
    );
    // 移除 DeepSeek 关于无法调用工具的过渡性自言自语
    cleaned = cleaned.replace(
      /^(我目前无法直接获取|让我先获取|让我尝试获取|我注意到您指定了|该实体可能没有)[^\n]*$/gm,
      ''
    );
    // 合并多余空行
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
  }

  cleanHistoryForGeneration(messages) {
    const collectedReferences = [];
    let lastGameState = null;
    const cleanedMessages = [];

    for (const msg of messages) {
      if (msg.role === 'tool') {
        const toolName = this._findToolNameById(messages, msg.tool_call_id);
        if (msg.content) {
          collectedReferences.push(`### [${toolName || 'tool'}]\n${msg.content}`);
        }
        continue;
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        continue;
      } else if (msg.role === 'assistant' && msg.content) {
        const text = msg.content.trim();
        const isJson = text.startsWith('```json') || text.startsWith('{');
        if (isJson) {
          try {
            const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
            const jsonContent = jsonMatch ? jsonMatch[1] : text;
            const parsed = JSON.parse(jsonContent);

            if (parsed.panel_narrative) {
              cleanedMessages.push({
                role: 'assistant',
                content: parsed.panel_narrative,
              });
            }

            delete parsed.panel_narrative;
            delete parsed.panel_npc; // 权威角色档案由单独的 part 提供
            delete parsed.choices; // 选项不需要传递给叙事阶段

            // 转换为纯文字格式，消除 JSON 视觉诱导
            const status = parsed.panel_status;
            if (status) {
              lastGameState = buildStatusSummaryText(status);
            }
          } catch (e) {
            cleanedMessages.push(msg);
          }
        } else {
          cleanedMessages.push(msg);
        }
      } else {
        cleanedMessages.push(msg);
      }
    }

    return { cleanedMessages, collectedReferences, lastGameState };
  }

  _findToolNameById(messages, toolCallId) {
    if (!toolCallId) return null;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.id === toolCallId) {
            return tc.function?.name || null;
          }
        }
      }
    }
    return null;
  }

  // 思考内容回传：所有 OpenAI 兼容 provider（含 DeepSeek V4 官方、siliconflow、
  // Qwen QwQ、GLM 等）都要求 reasoning_content 作为独立字段回传 assistant 消息，否则
  // 开启 thinking 的多轮 tool call 请求会被服务端拒绝（DeepSeek V4 报
  // "The reasoning_content in the thinking mode must be passed back to the API"）。
  // content 字段保持纯文本，不再 <think> 包装。
  _mergeReasoningIntoContent(text, _reasoning) {
    return text || null;
  }

  _attachReasoning(msg, reasoning) {
    // 带 tool_calls 的 assistant 消息强制要求 reasoning_content 字段存在（哪怕空串），
    // 若模型本轮迭代未返回 reasoning，仍要补上字段，否则下一轮请求被服务端拒绝。
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls) {
      msg.reasoning_content = reasoning || '';
    } else if (reasoning && reasoning.trim()) {
      msg.reasoning_content = reasoning;
    }
  }

  appendToolResults(messages, toolCalls, results, assistantContent = null, reasoning = '') {
    // OpenAI 格式:先添加 assistant 的 tool_calls，再添加 tool 角色的结果
    const assistantMsg = {
      role: 'assistant',
      content: this._mergeReasoningIntoContent(assistantContent, reasoning),
      tool_calls: toolCalls.map((tc, idx) => ({
        id: tc.id || `call_${Date.now()}_${idx}`,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.args),
        },
      })),
    };
    this._attachReasoning(assistantMsg, reasoning);
    messages.push(assistantMsg);

    // 添加每个工具的结果
    for (let i = 0; i < results.length; i++) {
      const tc = toolCalls[i];
      const r = results[i];
      messages.push({
        role: 'tool',
        tool_call_id: tc.id || assistantMsg.tool_calls[i].id,
        content: r.result,
      });
    }

    return messages;
  }

  appendAssistantText(messages, text, reasoning = '') {
    const merged = this._mergeReasoningIntoContent(text, reasoning);
    if (!merged) return;
    const msg = { role: 'assistant', content: merged };
    this._attachReasoning(msg, reasoning);
    messages.push(msg);
  }

  getPayloadMessagesRef(payload) {
    return payload.messages;
  }

  syncExecutedTools(messages, executedTools) {
    for (const msg of messages) {
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const sig = `${tc.function.name}:${tc.function.arguments}`;
          if (!executedTools.has(sig)) {
            executedTools.add(sig);
            console.log(`[${this.getProviderLabel()}Adapter] 同步已执行工具: ${tc.function.name}`);
          }
        }
      }
    }
  }
}

/**
 * AnthropicAdapter - Anthropic Claude API 适配器
 * 使用 Anthropic Messages API 格式
 */
class AnthropicAdapter extends BaseAdapter {
  constructor(config, apiKey, aiService, provider = 'anthropic', customName = null, customBaseUrl = null, customMaxOutputTokens = null) {
    super(config, apiKey, aiService);
    this.provider = provider; // 'anthropic' | 'custom'
    this.protocolFamily = 'anthropic';
    this.customName = customName;
    this.customBaseUrl = customBaseUrl;
    this.customMaxOutputTokens = customMaxOutputTokens;
    // Anthropic extended thinking / DeepSeek thinking 模式：服务端要求把上一轮响应里的 thinking block
    // 原样回填到下一轮 assistant 消息（含 signature），否则报 "content[].thinking must be passed back"。
    // 这里缓存上一次响应的 content blocks，appendToolResults/appendAssistantText 用它重建消息。
    this._lastResponseContent = [];
  }

  getProviderLabel() {
    return this.provider === 'custom' ? (this.customName || 'Custom') : 'Anthropic';
  }

  _resolveMessagesUrl() {
    if (this.provider === 'custom') {
      const trimmed = String(this.customBaseUrl || '')
        .trim()
        .replace(/\/+$/, '')
        .replace(/\/v1$/, '');
      if (!trimmed) {
        throw new Error(`自定义服务商 "${this.customName || ''}" 未配置 Base URL`);
      }
      return trimmed + '/v1/messages';
    }
    return 'https://api.anthropic.com/v1/messages';
  }

  getToolDefinitions() {
    // 转换为 Anthropic 工具格式
    const geminiDeclarations = this.aiService._getFunctionDeclarations();
    return geminiDeclarations.map(decl => ({
      name: decl.name,
      description: decl.description,
      input_schema: decl.parameters,
    }));
  }

  convertMessages(messages) {
    // 转换为 Anthropic 消息格式
    // Anthropic 不支持 system 角色在 messages 中，单独处理
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'model' ? 'assistant' : m.role,
        content: m.content,
      }));
  }

  buildPayload(messages, systemPrompt, tools = [], options = {}) {
    const url = this._resolveMessagesUrl();

    // 拆出 roleOverride='user' 的自定义 prompt 项准备 merge 到第一条真实 user 消息里
    // （Anthropic 严格要求 user/assistant 交替，不能两条连续 user）
    const { systemParts: _spArr, userPrepends } = _splitPromptParts(systemPrompt);

    // 系统段 → Anthropic system blocks（支持 prompt caching）
    const systemBlocks = this._buildAnthropicSystemBlocks(_spArr);

    // 转换消息格式
    const convertedMessages = this._convertMessagesToAnthropic(messages);

    const joinedPrepend = _joinUserPrepends(userPrepends);
    const finalMessages = _mergePrependIntoFirstUser(convertedMessages, joinedPrepend, 'anthropic');

    const payload = {
      model: this.config.model,
      max_tokens: options.maxTokens || this.customMaxOutputTokens || 16384,
      system: systemBlocks,
      messages: finalMessages,
    };

    if (tools.length > 0) {
      // 给工具列表末尾附 cache_control，利用 tools 前缀缓存
      payload.tools = this._applyToolsCacheControl(tools);
      // toolChoice 翻译 (Anthropic): 'auto'→{type:'auto'} / 'any'→{type:'any'} /
      //   {name}→{type:'tool', name} / 'none'→{type:'none'}
      // 单工具退化：与 OpenAI 路径对齐——tools.length===1 且 {name} 指向该工具时，
      // 降级为 {type:'any'}（行为等价，少一层 provider 差异）。
      const tc = options.toolChoice;
      if (tc && typeof tc === 'object' && typeof tc.name === 'string') {
        const onlyTool = tools.length === 1 && tools[0]?.name === tc.name;
        payload.tool_choice = onlyTool
          ? { type: 'any' }
          : { type: 'tool', name: tc.name };
      } else if (tc === 'any') {
        payload.tool_choice = { type: 'any' };
      } else if (tc === 'none') {
        payload.tool_choice = { type: 'none' };
      } else {
        payload.tool_choice = { type: 'auto' };
      }
    }

    // Anthropic 不支持 temperature 为 0，最小值为 0.01
    if (options.temperature !== undefined) {
      payload.temperature = Math.max(0.01, options.temperature);
    }

    // 联网搜索：调用方决定 stage/provider 是否合适，这里只负责把 server-side web_search 工具
    // 追加到 tools 数组。需玩家先在 console.anthropic.com /settings/privacy 后台开启 Web Search。
    if (options.webSearch === true) {
      if (!Array.isArray(payload.tools)) payload.tools = [];
      payload.tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 5,
      });
    }

    return { payload, url, streamUrl: url };
  }

  /**
   * 把通用 systemPrompt（string / Array<string|{text,cacheable,cacheBreakpoint}>）转为 Anthropic system blocks
   *
   * Cache 策略：
   * - 显式 `cacheBreakpoint: true` 的块附 cache_control（多个 breakpoint 让 Anthropic 选最长匹配前缀）
   * - 始终对最后一个 cacheable 块加 cache_control（兜底完整前缀）
   * - Anthropic 单请求最多 4 个 cache_control（含 tools 上的）；这里上限 3 个 system + 1 个 tools
   *
   * @param {string|Array} systemPrompt
   * @returns {Array<{type:string,text:string,cache_control?:Object}>}
   */
  _buildAnthropicSystemBlocks(systemPrompt) {
    const parts = Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
    const rawBlocks = [];
    for (const part of parts) {
      if (part === null || part === undefined) continue;
      if (typeof part === 'string') {
        if (part) rawBlocks.push({ type: 'text', text: part, _cacheable: false, _breakpoint: false });
        continue;
      }
      const text = part.text || '';
      if (!text) continue;
      rawBlocks.push({
        type: 'text',
        text,
        _cacheable: part.cacheable === true,
        _breakpoint: part.cacheable === true && part.cacheBreakpoint === true,
      });
    }

    // 收集 breakpoint 索引集合：显式 breakpoint + 最后一个 cacheable（去重）
    const breakpointIdx = new Set();
    for (let i = 0; i < rawBlocks.length; i++) {
      if (rawBlocks[i]._breakpoint) breakpointIdx.add(i);
    }
    for (let i = rawBlocks.length - 1; i >= 0; i--) {
      if (rawBlocks[i]._cacheable) {
        breakpointIdx.add(i);
        break;
      }
    }

    // Anthropic 单请求最多 4 个 cache_control，留 1 个给 tools；system 上限 3 个
    // 如超出，丢弃中间的 breakpoint，保留最早 (core) 和最晚 (full prefix)
    const MAX_SYSTEM_BREAKPOINTS = 3;
    let bpList = Array.from(breakpointIdx).sort((a, b) => a - b);
    if (bpList.length > MAX_SYSTEM_BREAKPOINTS) {
      bpList = [bpList[0], ...bpList.slice(-MAX_SYSTEM_BREAKPOINTS + 1)];
    }
    const finalBreakpoints = new Set(bpList);

    return rawBlocks.map((b, i) => {
      const out = { type: b.type, text: b.text };
      if (finalBreakpoints.has(i)) out.cache_control = { type: 'ephemeral' };
      return out;
    });
  }

  /**
   * 对工具列表最后一个工具附 cache_control，利用 tools 前缀缓存
   * Anthropic 文档保证：tools 末尾 cache_control 会让整个 tools 定义成为缓存前缀的一部分
   */
  _applyToolsCacheControl(tools) {
    if (!Array.isArray(tools) || tools.length === 0) return tools;
    const copy = tools.slice();
    const last = copy[copy.length - 1];
    copy[copy.length - 1] = { ...last, cache_control: { type: 'ephemeral' } };
    return copy;
  }

  /**
   * 替换 payload 中的 system 部分（B2/B3 迭代间重建用）
   * messages 保持不变，tools 已缓存（不触碰）
   */
  updateSystemParts(payload, systemPrompt) {
    if (!payload) return;
    // user-role 自定义 prompt 已在 buildPayload 时 merge 进 messages，updateSystemParts
    // 只负责刷新 system blocks；user prepend 的"在线热更"由调用方走完整 buildPayload。
    const { systemParts: _spArr } = _splitPromptParts(systemPrompt);
    payload.system = this._buildAnthropicSystemBlocks(_spArr);
  }

  _convertMessagesToAnthropic(messages) {
    const result = [];

    for (const msg of messages) {
      // 跳过 system 消息（由 buildPayload 单独处理）
      if (msg.role === 'system') continue;

      // 处理 Gemini 格式（parts）
      if (msg.parts && msg.parts.length > 0) {
        const content = this._convertPartsToAnthropicContent(msg.parts);
        if (content.length > 0) {
          result.push({
            role: msg.role === 'model' ? 'assistant' : msg.role,
            content: content,
          });
        }
        continue;
      }

      // 处理 OpenAI 格式（content + tool_calls）
      if (msg.tool_calls) {
        // assistant 的工具调用
        const content = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        result.push({ role: 'assistant', content });
        continue;
      }

      // 处理 tool 角色（工具结果）
      if (msg.role === 'tool') {
        // 寻找是否可以合并到前一个 user 消息
        const lastMsg = result[result.length - 1];
        const toolResult = {
          type: 'tool_result',
          tool_use_id: msg.tool_call_id,
          content: msg.content,
        };
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
          lastMsg.content.push(toolResult);
        } else {
          result.push({
            role: 'user',
            content: [toolResult],
          });
        }
        continue;
      }

      // 普通消息
      let content = msg.content;
      if (!content && msg.parts) {
        content = msg.parts.map(p => p.text || '').join('\n');
      }

      if (content) {
        result.push({
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: content,
        });
      }
    }

    return result;
  }

  _convertPartsToAnthropicContent(parts) {
    const content = [];

    for (const part of parts) {
      if (part.text) {
        content.push({ type: 'text', text: part.text });
      } else if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: part.functionCall.id || `toolu_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args,
        });
      } else if (part.functionResponse) {
        content.push({
          type: 'tool_result',
          tool_use_id: part.functionResponse.id || `toolu_${Date.now()}`,
          content: part.functionResponse.response?.content || '',
        });
      }
    }

    return content;
  }

  async callAPI(url, payload, onChunk = null, abortSignal = null) {
    const timeoutMs = 1200000;
    const controller = new AbortController();
    if (abortSignal) {
      if (abortSignal.aborted) {
        controller.abort(abortSignal.reason ?? new Error('Upstream signal already aborted'));
      } else {
        abortSignal.addEventListener(
          'abort',
          () => controller.abort(abortSignal.reason ?? new Error('Upstream signal aborted')),
          { once: true }
        );
      }
    }
    const timeoutId = setTimeout(
      () => controller.abort(new Error(`API timeout (${timeoutMs / 1000}s)`)),
      timeoutMs
    );
    const startTime = performance.now();

    try {
      if (onChunk) {
        return await this._callStreaming(url, payload, onChunk, controller, startTime);
      } else {
        return await this._callNonStreaming(url, payload, controller, startTime);
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        if (abortSignal && abortSignal.aborted) throw e;
        const timeoutError = new Error(`API 请求超时 (${timeoutMs / 1000}秒)`);
        timeoutError.apiErrorInfo = _buildApiErrorInfo({
          provider: this.provider,
          url,
          startTime,
          errorType: 'timeout',
          originalName: e.name,
        });
        throw timeoutError;
      }

      if (!e.apiErrorInfo) {
        const isNetworkTypeError = e.name === 'TypeError' && /fetch|network|load failed/i.test(e.message);
        e.apiErrorInfo = _buildApiErrorInfo({
          provider: this.provider,
          url,
          startTime,
          errorType: isNetworkTypeError ? 'network' : e.name === 'TypeError' ? 'runtime' : 'unknown',
          originalName: e.name,
        });
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async _callNonStreaming(url, payload, controller, startTime) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const ttfb = performance.now() - startTime;

    if (!response.ok) {
      const bodyResult = await _readErrorResponseBody(response);
      const headersObj = _headersToObject(response.headers);
      const requestId = _extractRequestId(headersObj);
      const providerError = _extractProviderErrorDetails(
        this.provider,
        bodyResult.parsed || bodyResult.body
      );
      const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;
      const errorMessage = providerError.message || fallbackMessage;
      const error = new Error(errorMessage);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'http',
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBody: bodyResult.body,
        responseHeaders: headersObj,
        providerErrorType: providerError.type,
        providerErrorCode: providerError.code,
        providerErrorParam: providerError.param,
        requestId,
      });
      throw error;
    }

    const data = await response.json();
    const totalTime = performance.now() - startTime;
    const downloadTime = totalTime - ttfb;

    // 缓存原始 content blocks（含 thinking 块），下一轮 assistant 消息需原样带回
    this._lastResponseContent = Array.isArray(data.content) ? data.content : [];

    // 提取文本内容
    const textBlocks = data.content?.filter(b => b.type === 'text') || [];
    const text = textBlocks.map(b => b.text).join('');

    // 提取 token 使用量
    const usage = data.usage;
    const inputTokens = usage?.input_tokens || 0;
    const outputTokens = usage?.output_tokens || 0;
    // Anthropic prompt cache: cache_creation_input_tokens (写入) / cache_read_input_tokens (命中)
    const cacheCreationTokens = usage?.cache_creation_input_tokens || 0;
    const cacheReadTokens = usage?.cache_read_input_tokens || 0;
    // Anthropic stop_reason: end_turn / max_tokens / stop_sequence / tool_use
    const stopReason = data?.stop_reason || null;

    return {
      text,
      toolCalls: [],
      reasoningContent: null,
      metrics: {
        ttfb: Math.round(ttfb),
        downloadTime: Math.round(downloadTime),
        ttft: Math.round(ttfb),
        totalTime: Math.round(totalTime),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        stopReason,
      },
      raw: data,
    };
  }

  async _callStreaming(url, payload, onChunk, controller, startTime) {
    const streamPayload = { ...payload, stream: true };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(streamPayload),
      signal: controller.signal,
    });

    const ttfb = performance.now() - startTime;

    if (!response.ok) {
      const bodyResult = await _readErrorResponseBody(response);
      const headersObj = _headersToObject(response.headers);
      const requestId = _extractRequestId(headersObj);
      const providerError = _extractProviderErrorDetails(
        this.provider,
        bodyResult.parsed || bodyResult.body
      );
      const fallbackMessage = `HTTP ${response.status}: ${response.statusText}`;
      const errorMessage = providerError.message || fallbackMessage;
      const error = new Error(errorMessage);
      error.apiErrorInfo = _buildApiErrorInfo({
        provider: this.provider,
        url,
        startTime,
        errorType: 'http',
        httpStatus: response.status,
        httpStatusText: response.statusText,
        responseBody: bodyResult.body,
        responseHeaders: headersObj,
        providerErrorType: providerError.type,
        providerErrorCode: providerError.code,
        providerErrorParam: providerError.param,
        requestId,
      });
      throw error;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let ttft = null;
    let accumulatedText = '';
    const accumulatedContent = [];
    let usageData = null;
    let stopReason = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

        const jsonStr = trimmedLine.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const event = JSON.parse(jsonStr);

          switch (event.type) {
            case 'content_block_start':
              if (event.content_block?.type === 'text') {
                accumulatedContent.push({ type: 'text', text: '' });
              } else if (event.content_block?.type === 'tool_use') {
                accumulatedContent.push({
                  type: 'tool_use',
                  id: event.content_block.id,
                  name: event.content_block.name,
                  input: {},
                });
              } else if (event.content_block?.type === 'thinking') {
                // Anthropic extended thinking / DeepSeek thinking 模式：捕获 thinking 块以便回填到下一轮
                accumulatedContent.push({
                  type: 'thinking',
                  thinking: event.content_block.thinking || '',
                });
              }
              break;

            case 'content_block_delta':
              if (event.delta?.type === 'text_delta') {
                if (ttft === null) {
                  ttft = performance.now() - startTime;
                  console.log(`[Anthropic Stream] TTFT: ${Math.round(ttft)}ms`);
                }
                const text = event.delta.text || '';
                accumulatedText += text;
                // 更新最后一个 text block
                const lastTextBlock = accumulatedContent.findLast(b => b.type === 'text');
                if (lastTextBlock) {
                  lastTextBlock.text += text;
                }
                onChunk(accumulatedText);
              } else if (event.delta?.type === 'thinking_delta') {
                const lastThinkingBlock = accumulatedContent.findLast(b => b.type === 'thinking');
                if (lastThinkingBlock) {
                  lastThinkingBlock.thinking = (lastThinkingBlock.thinking || '') + (event.delta.thinking || '');
                }
              } else if (event.delta?.type === 'signature_delta') {
                // Anthropic 加密签名：必须连同 thinking 一起回填
                const lastThinkingBlock = accumulatedContent.findLast(b => b.type === 'thinking');
                if (lastThinkingBlock) {
                  lastThinkingBlock.signature = (lastThinkingBlock.signature || '') + (event.delta.signature || '');
                }
              } else if (event.delta?.type === 'input_json_delta') {
                // 工具输入的增量更新（JSON 字符串片段）
                const lastToolBlock = accumulatedContent.findLast(b => b.type === 'tool_use');
                if (lastToolBlock) {
                  lastToolBlock._inputJson =
                    (lastToolBlock._inputJson || '') + event.delta.partial_json;
                  // 流式叙事：检测 update_narrative 并提取部分文本
                  if (lastToolBlock.name === 'update_narrative' && onChunk) {
                    const partialText = _extractPartialNarrativeText(lastToolBlock._inputJson);
                    if (partialText) {
                      onChunk(accumulatedText, null, { narrativeStream: partialText });
                    }
                  }
                }
              }
              break;

            case 'content_block_stop':
              // 解析完整的工具输入 JSON
              const lastTool = accumulatedContent.findLast(b => b.type === 'tool_use');
              if (lastTool && lastTool._inputJson) {
                try {
                  lastTool.input = JSON.parse(lastTool._inputJson);
                } catch (e) {
                  console.warn('[Anthropic] 工具输入 JSON 解析失败:', e);
                }
                delete lastTool._inputJson;
              }
              break;

            case 'message_delta':
              if (event.delta?.stop_reason) {
                stopReason = event.delta.stop_reason;
              }
              if (event.usage) {
                usageData = { ...usageData, ...event.usage };
              }
              break;

            case 'message_start':
              if (event.message?.usage) {
                usageData = event.message.usage;
              }
              break;
          }
        } catch (e) {
          console.warn('[Anthropic Stream] JSON parse error:', e.message);
        }
      }
    }

    const totalTime = performance.now() - startTime;
    console.log(`[Anthropic Stream] 完成 - 总时间: ${Math.round(totalTime)}ms`);

    // 缓存原始 content blocks（含 thinking 块），下一轮 assistant 消息需原样带回
    this._lastResponseContent = accumulatedContent.slice();

    // 构建标准化响应
    const reconstructedResponse = {
      id: `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content: accumulatedContent,
      stop_reason: stopReason || 'end_turn',
      usage: usageData,
    };

    const inputTokens = usageData?.input_tokens || 0;
    const outputTokens = usageData?.output_tokens || 0;
    const cacheCreationTokens = usageData?.cache_creation_input_tokens || 0;
    const cacheReadTokens = usageData?.cache_read_input_tokens || 0;
    // stopReason 局部变量已在上方 _processSSE 循环中从 message_delta 帧捕获
    const downloadTime = totalTime - ttfb;

    return {
      text: accumulatedText,
      toolCalls: [],
      reasoningContent: null,
      metrics: {
        ttfb: Math.round(ttfb),
        downloadTime: Math.round(downloadTime),
        ttft: Math.round(ttft || totalTime),
        totalTime: Math.round(totalTime),
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        stopReason: stopReason || null,
      },
      raw: reconstructedResponse,
    };
  }

  parseToolCalls(rawResponse) {
    const content = rawResponse?.content || [];
    const toolUseBlocks = content.filter(b => b.type === 'tool_use');

    const toolCalls = toolUseBlocks.map(b => ({
      name: b.name,
      args: b.input,
      id: b.id,
    }));

    return { toolCalls, needsRecovery: false, recoveredCalls: [] };
  }

  cleanHistoryForGeneration(messages) {
    const collectedReferences = [];
    let lastGameState = null;
    const cleanedMessages = [];

    for (const msg of messages) {
      // 跳过工具相关消息
      if (Array.isArray(msg.content)) {
        const hasToolUse = msg.content.some(b => b.type === 'tool_use');
        const hasToolResult = msg.content.some(b => b.type === 'tool_result');

        if (hasToolResult) {
          for (const block of msg.content) {
            if (block.type === 'tool_result' && block.content) {
              collectedReferences.push(`### [tool]\n${block.content}`);
            }
          }
          continue;
        }

        if (hasToolUse) {
          continue;
        }
      }

      // 处理 assistant 的 JSON 输出
      if (msg.role === 'assistant') {
        const text =
          typeof msg.content === 'string'
            ? msg.content
            : Array.isArray(msg.content)
              ? msg.content
                  .filter(b => b.type === 'text')
                  .map(b => b.text)
                  .join('')
              : '';

        if (text) {
          const trimmed = text.trim();
          const isJson = trimmed.startsWith('```json') || trimmed.startsWith('{');
          if (isJson) {
            try {
              const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
              const jsonContent = jsonMatch ? jsonMatch[1] : trimmed;
              const parsed = JSON.parse(jsonContent);

              if (parsed.panel_narrative) {
                cleanedMessages.push({
                  role: 'assistant',
                  content: parsed.panel_narrative,
                });
              }

              delete parsed.panel_narrative;
              delete parsed.panel_npc;
              delete parsed.choices; // 选项不需要传递给叙事阶段

              // 转换为纯文字格式，消除 JSON 视觉诱导
              const status = parsed.panel_status;
              if (status) {
                lastGameState = buildStatusSummaryText(status);
              }
            } catch (e) {
              cleanedMessages.push({ role: 'assistant', content: text });
            }
            continue;
          }
        }
        cleanedMessages.push({ role: 'assistant', content: text });
      } else {
        cleanedMessages.push(msg);
      }
    }

    return { cleanedMessages, collectedReferences, lastGameState };
  }

  /**
   * 提取上一次响应里的 thinking 块（Anthropic extended thinking / DeepSeek thinking 模式要求回填）
   * 必须放在 assistant content blocks 最前面，且保留 signature 字段
   */
  _extractLastThinkingBlocks() {
    return (this._lastResponseContent || []).filter(b => b && b.type === 'thinking');
  }

  appendToolResults(messages, toolCalls, results, assistantContentText = null) {
    // Anthropic 格式：assistant 消息包含 tool_use，user 消息包含 tool_result
    // thinking 块（若有）必须放最前面回传服务端
    const assistantBlocks = [...this._extractLastThinkingBlocks()];
    if (assistantContentText) {
      assistantBlocks.push({ type: 'text', text: assistantContentText });
    }
    const tooluseBlocks = toolCalls.map(tc => ({
      type: 'tool_use',
      id: tc.id || `toolu_${Date.now()}`,
      name: tc.name,
      input: tc.args,
    }));
    assistantBlocks.push(...tooluseBlocks);

    messages.push({
      role: 'assistant',
      content: assistantBlocks,
    });

    const userContent = results.map((r, idx) => ({
      type: 'tool_result',
      tool_use_id: toolCalls[idx].id || tooluseBlocks[idx]?.id,
      content: r.result,
    }));

    messages.push({
      role: 'user',
      content: userContent,
    });

    return messages;
  }

  appendAssistantText(messages, text) {
    const thinkingBlocks = this._extractLastThinkingBlocks();
    if (!text && thinkingBlocks.length === 0) return;
    const blocks = [...thinkingBlocks];
    if (text) blocks.push({ type: 'text', text });
    messages.push({ role: 'assistant', content: blocks });
  }

  getPayloadMessagesRef(payload) {
    return payload.messages;
  }

  syncExecutedTools(messages, executedTools) {
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_use') {
            const sig = `${block.name}:${JSON.stringify(block.input)}`;
            if (!executedTools.has(sig)) {
              executedTools.add(sig);
              console.log(`[AnthropicAdapter] 同步已执行工具: ${block.name}`);
            }
          }
        }
      }
    }
  }
}

Object.assign(globalThis, {
  GeminiAdapter,
  OpenAIAdapter,
  AnthropicAdapter,
});
