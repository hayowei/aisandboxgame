// ============================================
// ReactLoop — provider 适配工具
// ============================================
// 提供 buildAdapterTools / appendUserMessage 等 protocol-family 路由 helper。
// 历史上还承担过 nudge 安全网（NUDGE_ITERATION/shouldNudge/getNudgeText），
// 但并行 ReAct pipeline 把 iter 数量做成代码定死后这套 nudge 已无 caller，已删除。
// ============================================

class ReactLoop {
  constructor(aiService) {
    this._ai = aiService;
  }

  /**
   * 将 toolRegistry 格式的声明转为 adapter 特定格式
   * @param {Array} declarations - toolRegistry.getDeclarations() 格式
   * @param {Object} adapter - reactAdapter
   * @returns {Array} adapter 格式的工具定义
   */
  buildAdapterTools(declarations, adapter) {
    if (!declarations || declarations.length === 0) return [];

    // 用 protocolFamily 而非 provider 来选格式：custom Anthropic 协议的 adapter
    // provider='custom' 但 protocolFamily='anthropic'，必须按 Anthropic 工具格式发
    const family = adapter?.protocolFamily || adapter?.provider || 'gemini';

    if (family === 'gemini') {
      const strip = typeof window !== 'undefined' && typeof window._stripForGemini === 'function'
        ? window._stripForGemini
        : (s) => s;
      const cleaned = declarations.map(({ name, description, parameters }) => ({
        name,
        description: description || '',
        parameters: strip(parameters) || { type: 'object', properties: {} },
      }));
      return [{ functionDeclarations: cleaned }];
    }

    if (family === 'anthropic') {
      return declarations.map(decl => ({
        name: decl.name,
        description: decl.description || '',
        input_schema: decl.parameters || { type: 'object', properties: {} },
      }));
    }

    // 默认 OpenAI tools 格式，覆盖 openai / deepseek / grok / siliconflow / custom
    return declarations.map(decl => ({
      type: 'function',
      function: {
        name: decl.name,
        description: decl.description || '',
        parameters: decl.parameters || { type: 'object', properties: {} },
      },
    }));
  }

  /**
   * 追加用户角色消息到消息历史（用于 nudge）
   * 各 provider 消息格式不同
   * @param {Array} messagesRef - payload 中的消息数组引用
   * @param {string} text - 消息文本
   * @param {Object} adapter - reactAdapter
   */
  appendUserMessage(messagesRef, text, adapter) {
    const family = adapter?.protocolFamily || adapter?.provider || 'gemini';

    if (family === 'gemini') {
      messagesRef.push({ role: 'user', parts: [{ text }] });
    } else if (family === 'anthropic') {
      messagesRef.push({ role: 'user', content: [{ type: 'text', text }] });
    } else {
      messagesRef.push({ role: 'user', content: text });
    }
  }
}

window.ReactLoop = ReactLoop;
