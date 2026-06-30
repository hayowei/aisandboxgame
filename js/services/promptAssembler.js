// ============================================
// PromptAssembler - Prompt 组装模块
// ============================================
// 从 AIService 提取的 prompt 组装逻辑
// Phase 1: 委托给 AIService，建立模块边界
// 后续 Phase: 逐步迁移实际逻辑到此模块
// ============================================

class PromptAssembler {
  /**
   * @param {Object} aiService - AIService 实例
   */
  constructor(aiService) {
    this._ai = aiService;
  }

  /**
   * 构建合并后的 system prompt 各部分
   * @param {string} systemContext - 叙事摘要 + 角色 profile
   * @param {string} lastGameState - 上一轮游戏状态
   * @param {string} [userMessage=''] - 用户消息
   * @param {Array} [messages=[]] - 消息历史（用于回合计数）
   * @param {string|null} [gmDirective=null] - GM 写作指导
   * @param {Array|null} [npcReactions=null] - NPC 自主决策
   * @returns {Array<string>} prompt 部分数组
   */
  buildMergedSystemParts(systemContext, lastGameState, userMessage = '', messages = [], gmDirective = null, npcReactions = null) {
    return this._ai._buildMergedSystemParts(systemContext, lastGameState, userMessage, messages, gmDirective, npcReactions);
  }

  /**
   * 获取上次 prompt 组装的 manifest（记录每个 part 的来源和条件）
   * @returns {Array|null}
   */
  get lastPromptManifest() {
    return this._ai._lastPromptManifest;
  }

  /**
   * 构建 Opening Time 的 prompt 文本
   * @returns {string|null}
   */
  buildOpeningTimePromptText() {
    return this._ai._buildOpeningTimePromptText();
  }

  /**
   * 获取有效的 core_world_mechanics 模块文本
   * @returns {string}
   */
  getEffectiveCoreWorldMechanics() {
    return this._ai._getEffectiveCoreWorldMechanics();
  }

  /**
   * 获取有效的 narrative_base 模块文本
   * @returns {string}
   */
  getEffectiveNarrativeBase() {
    return this._ai._getEffectiveNarrativeBase();
  }

  // ---- Helper methods ----

  _buildTermConstraints() {
    const parts = [];

    try {
      const timeTerms = this._ai._getActiveTimeTerms?.();
      if (timeTerms?.era) {
        const isStandard = ['UE', 'Pre-UE'].includes(timeTerms.era);
        const ban = isStandard ? '' : ' No UE/Pre-UE era notation allowed.';
        parts.push(`[!CRITICAL] World era: "${timeTerms.era}". All time expressions must use this era.${ban}`);
      } else {
        parts.push('[!CRITICAL] No era defined. Time expressions must use plain year/month/day only.');
      }

      const currencyTerms = this._ai._getActiveCurrencyTerms?.();
      if (currencyTerms?.currencyLabel) {
        parts.push(`[!CRITICAL] World currency: "${currencyTerms.currencyLabel}". Use this name exclusively.`);
      }
    } catch (_) {
      // term methods may not exist
    }

    return parts.length > 0 ? parts.join('\n') : null;
  }

  _formatNpcReactionsForPrompt(npcReactions) {
    if (!Array.isArray(npcReactions) || npcReactions.length === 0) return null;

    const directives = npcReactions.map(r => {
      const d = r.decision;
      if (!d) return `### ${r.name}\n${r.text}`;
      let s = `### ${r.name}\n`;
      s += `- Action: ${d.action}\n`;
      if (d.location) s += `- Location: ${d.location}\n`;
      if (d.social_target) s += `- Interacts with: ${d.social_target}\n`;
      if (d.mood) s += `- Mood: ${d.mood}\n`;
      if (d.inner_thought) s += `- Inner thought: ${d.inner_thought}\n`;
      s += `**Requirement**: The narrative MUST show ${r.name}'s actions above.`;
      return s;
    }).join('\n\n');

    return `## NPC Autonomous Actions (MUST reflect in narrative)\n\n${directives}`;
  }
}

window.PromptAssembler = PromptAssembler;
