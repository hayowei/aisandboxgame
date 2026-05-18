// ============================================
// OpeningController - 开场流程统一控制器
// ============================================
// 将三套开场信号（opening_greeting / init / openingTimeContext）
// 收敛为单一 resolve() 输出，消除 prompt 冲突
// ============================================

class OpeningController {
  /**
   * @param {Object} aiService - AIService 实例
   */
  constructor(aiService) {
    this._ai = aiService;
  }

  /**
   * 统一开场解析入口
   * @param {Array} messages - 消息历史
   * @param {string|null} lastGameState - 上一轮游戏状态（非首轮时有值）
   * @param {string} lastUserMessage - 玩家最新消息
   * @returns {{ promptText: string|null, mode: string|null, isOpening: boolean }}
   */
  resolve(messages, lastGameState, lastUserMessage) {
    // 非首轮：不注入任何开场内容
    const modelMessageCount = Array.isArray(messages)
      ? messages.filter(m => m.role === 'model').length
      : 0;
    if (lastGameState || modelMessageCount > 1) {
      return { promptText: null, mode: null, isOpening: false };
    }

    // 检测开场模式
    const mode = this._detectMode(lastUserMessage, lastGameState);

    // 获取 init 模块文本
    const initText = window.worldMeta?.getRuleModule?.('init') || '';
    const initRules = this._parseInitRules(initText);

    // 获取 openingTimeContext（仅 random/recommended 模式）
    const openingContext = (mode === 'random' || mode === 'recommended')
      ? this._ai._activeOpeningTimeContext
      : null;

    // 组装 prompt
    const promptText = this._buildPromptText(mode, openingContext, initRules, initText);

    const resolvedMode = mode || (initRules.length > 0 ? 'player_specified' : 'questionnaire');

    console.log(
      `[OpeningController] mode=${resolvedMode}, ` +
      `rules=[${(OpeningController.RULES_BY_MODE[resolvedMode] || []).join(',')}], ` +
      `hasEvent=${!!(openingContext && !openingContext.blocked)}, ` +
      `hasInitRules=${initRules.length > 0}`
    );

    return {
      promptText,
      mode: resolvedMode,
      isOpening: true,
    };
  }

  /**
   * 检测开场模式
   * @returns {'random'|'recommended'|null}
   */
  _detectMode(lastUserMessage, lastGameState) {
    return this._ai._getOpeningRequestMode(lastUserMessage, lastGameState);
  }

  /**
   * 解析 init 模块文本为编号规则数组
   * 支持格式：数字. 或数字、或数字) 开头的行
   * @param {string} initText
   * @returns {Array<{number: number, text: string}>}
   */
  _parseInitRules(initText) {
    if (!initText || typeof initText !== 'string') return [];

    const lines = initText.split('\n');
    const rules = [];
    let currentRule = null;

    for (const line of lines) {
      // 匹配编号行：1. / 1、/ 1) / 1： 等
      const match = line.match(/^\s*(\d+)\s*[.、)：:]\s*(.*)$/);
      if (match) {
        if (currentRule) rules.push(currentRule);
        currentRule = { number: parseInt(match[1], 10), text: match[2].trim() };
      } else if (currentRule && line.trim()) {
        // 续行：追加到当前规则
        currentRule.text += '\n' + line.trim();
      }
    }
    if (currentRule) rules.push(currentRule);

    return rules;
  }

  /**
   * 按模式过滤规则
   * @param {Array<{number: number, text: string}>} rules
   * @param {string} mode
   * @returns {Array<{number: number, text: string}>}
   */
  _selectRulesForMode(rules, mode) {
    const allowedNumbers = OpeningController.RULES_BY_MODE[mode];
    if (!allowedNumbers) return rules; // 未知模式，返回全部
    return rules.filter(r => allowedNumbers.includes(r.number));
  }

  /**
   * 组装最终的 prompt 文本
   * @param {string|null} mode - 'random'|'recommended'|null
   * @param {Object|null} openingContext - _activeOpeningTimeContext
   * @param {Array} initRules - 解析后的规则数组
   * @param {string} initText - 原始 init 文本（降级用）
   * @returns {string|null}
   */
  _buildPromptText(mode, openingContext, initRules, initText) {
    const effectiveMode = mode || 'player_specified';
    const parts = [];

    // ── 标题 ──
    const modeLabels = {
      random: '随机开局',
      recommended: '推荐剧情开局',
      player_specified: '玩家指定开局',
    };
    parts.push(`## 开场引导（${modeLabels[effectiveMode] || '开局'}）`);

    // ── 锁定事件（仅 random/recommended） ──
    if (openingContext && (effectiveMode === 'random' || effectiveMode === 'recommended')) {
      const eventSection = this._formatEventContext(openingContext, effectiveMode);
      if (eventSection) parts.push(eventSection);
    }

    // ── 过滤后的 init 规则 ──
    if (initRules.length > 0) {
      const filtered = this._selectRulesForMode(initRules, effectiveMode);
      if (filtered.length > 0) {
        const rulesText = filtered.map(r => `${r.number}. ${r.text}`).join('\n');
        parts.push(`### 开场规则\n\n${rulesText}`);
      } else {
        // 过滤全空：规则编号全不在当前模式允许列表内，降级到原始文本整体注入
        parts.push(`### 开场规则\n\n${initText.trim()}`);
      }
    } else if (initText && initText.trim()) {
      // 降级：init 模块格式非标准，无法解析为编号规则，整体注入
      parts.push(`### 开场规则\n\n${initText.trim()}`);
    }

    // 无任何内容时不注入
    if (parts.length <= 1) return null; // 只有标题，没有实质内容

    return parts.join('\n\n');
  }

  /**
   * 格式化锁定事件为 prompt 段落
   * 复用 _buildOpeningTimePromptText 的逻辑
   * @param {Object} context - _activeOpeningTimeContext
   * @param {string} mode
   * @returns {string|null}
   */
  _formatEventContext(context, mode) {
    if (!context) return null;

    const isEnglish = this._ai._getGamePromptLanguage?.() === 'en';

    // blocked 场景：无可用 timeline 事件
    if (context.blocked) {
      const timeHint = context.selectedTimeText
        ? (isEnglish
            ? `\nOpening time is fixed to: ${context.selectedTimeText}.`
            : `\n首轮时间固定为：${context.selectedTimeText}。`)
        : '';
      const guidance = isEnglish
        ? `### Opening Event Anchor Unavailable\n\nNo matching timeline event was found for this opening mode. ${context.message || ''}${timeHint}\nUse the init module's recommended opening line as your primary guide.`
        : `### 开场事件锚点不可用\n\n当前模式未找到匹配的 timeline 事件。${context.message || ''}${timeHint}\n请参考开场规则中的推荐剧情行作为首要引导。`;
      return guidance;
    }

    // 正常场景：有锁定事件
    if (!context.selectedTimeText) return null;

    const modeLabel = mode === 'recommended'
      ? (isEnglish ? 'Recommended Opening' : '推荐开局')
      : (isEnglish ? 'Random Opening' : '随机开局');

    const locationText = context.selectedLocation
      ? (isEnglish
          ? `\nOpening location is fixed to: ${this._ai._formatOpeningLocationText(context.selectedLocation)}. Step 2 narrative and panel_status.location must use this exact location.`
          : `\n本轮开场地点固定为：${this._ai._formatOpeningLocationText(context.selectedLocation)}。Step 2 正文和 panel_status.location 都必须使用这个地点，不要改写成近义地点名。`)
      : '';

    const event = context.selectedEvent?.event || context.selectedEvent || {};
    const eventParts = [];
    if (event.location) eventParts.push(isEnglish ? `Event location: ${event.location}` : `事件地点：${event.location}`);
    if (event.characters) eventParts.push(isEnglish ? `Characters involved: ${event.characters}` : `涉及角色：${event.characters}`);
    if (event.content) eventParts.push(isEnglish ? `Event anchor: ${event.content}` : `事件锚点：${event.content}`);
    const eventHint = eventParts.length > 0 ? '\n' + eventParts.join('\n') : '';

    const timeInstruction = isEnglish
      ? `Step 2 narrative must naturally land on this specific time in the first paragraph. panel_status.datetime will be backfilled by runtime code.`
      : `Step 2 正文第一段必须自然落地这个具体时间。panel_status.datetime 由运行时代码回填。`;

    return isEnglish
      ? `### Locked Opening Event\n\nThis ${modeLabel} has locked a timeline event as the opening anchor.\nOpening time: ${context.selectedTimeText}. ${timeInstruction}${locationText}${eventHint}`
      : `### 本局已锁定的开场事件\n\n本轮${modeLabel}已锁定一条 timeline 事件作为开场锚点。\n开场时间：${context.selectedTimeText}。${timeInstruction}${locationText}${eventHint}`;
  }
}

// ── 按模式选择的 init 规则编号 ──
OpeningController.RULES_BY_MODE = {
  random:           [1, 4, 6, 7, 8, 9],
  recommended:      [1, 2, 5, 6, 7, 8, 9],
  player_specified: [1, 3, 6, 7, 8, 9],
};

window.OpeningController = OpeningController;
