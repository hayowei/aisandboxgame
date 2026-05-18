// ============================================
// Trigger Scanner — 工具触发条件扫描器
// ============================================
// 每次 ReAct iter 开头由 aiService 调用：
// 1. 构造只读全局状态 context
// 2. 遍历 toolRegistry 中所有声明了 trigger 的工具
// 3. 执行谓词，收集触发的 suggestions
// 4. 去抖：同一 turn 内同一 trigger 最多建议 2 次
// 5. closing phase 跳过全部扫描
// ============================================

(function initTriggerScanner() {
  const SUGGESTION_LIMIT = 2;

  /**
   * 构造 trigger 谓词的只读 context。
   * 使用浅引用——tools 不应修改 context 对象。
   */
  function buildTriggerContext(phaseState, turnNumber) {
    const playerState =
      typeof playerStateService !== 'undefined' && playerStateService
        ? {
            money: window.inventoryStore?.getMoney?.(),
            objective: playerStateService.getObjective?.(),
          }
        : { money: window.inventoryStore?.getMoney?.() };

    const location =
      typeof locationTracker !== 'undefined' && locationTracker
        ? locationTracker.currentLocation || null
        : null;

    const time =
      typeof timelineService !== 'undefined' && timelineService
        ? timelineService.getCurrentDate?.() || null
        : null;

    const customStatus = window.customStatusStore?.getStatus?.() || {};

    const npcSnapshot = window.npcStore?.list?.() || [];

    return Object.freeze({
      playerState: Object.freeze(playerState),
      location,
      time,
      customStatus,
      npcSnapshot,
      currentPhase: phaseState?.currentPhase || null,
      turnNumber: typeof turnNumber === 'number' ? turnNumber : null,
    });
  }

  /**
   * 扫描所有 tool 的 trigger 谓词，返回触发的 suggestion 列表。
   * @param {Object} phaseState - 来自 aiService 的 phase 状态对象
   * @param {Object} triggerState - turn 级计数状态 {suggestionCount, lastFired}
   * @param {number} turnNumber - 当前 turn 号
   * @returns {Array<{name: string, hint: string}>}
   */
  function scanTriggers(phaseState, triggerState, turnNumber) {
    if (!phaseState || !triggerState) return [];

    // closing phase 完全跳过
    if (phaseState.currentPhase === 'closing') return [];

    const registry = window.toolRegistry;
    if (!registry || typeof registry.iterMetadata !== 'function') return [];

    const context = buildTriggerContext(phaseState, turnNumber);
    const suggestions = [];

    for (const [name, meta] of registry.iterMetadata()) {
      if (!meta.trigger) continue;
      if (registry.isDispatcherManaged?.(name)) continue;

      // 已静默（达到建议次数上限）
      const count = triggerState.suggestionCount.get(name) || 0;
      if (count >= SUGGESTION_LIMIT) continue;

      // trigger 所属 phase 必须匹配当前 phase（若声明了 phase）
      if (meta.phase !== null && meta.phase !== phaseState.currentPhase) continue;

      // 求值谓词
      let fire = false;
      let hint = meta.triggerHint || `${name} 的触发条件已满足`;
      try {
        const ret = meta.trigger(context);
        if (ret === true) {
          fire = true;
        } else if (ret && typeof ret === 'object' && ret.fire) {
          fire = true;
          if (typeof ret.hint === 'string' && ret.hint) hint = ret.hint;
        }
      } catch (e) {
        console.error(`[triggerScanner] ${name} trigger 谓词异常:`, e);
        continue;
      }

      if (!fire) continue;

      triggerState.suggestionCount.set(name, count + 1);
      triggerState.lastFired.set(name, hint);
      suggestions.push({ name, hint });
    }

    return suggestions;
  }

  /**
   * 把 suggestion 列表格式化为 system 注入文本。
   * 返回空字符串表示无建议，调用方可以直接拼接。
   */
  function formatSuggestions(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) return '';
    const lines = suggestions.map(s => `- ${s.name}：${s.hint}`);
    return (
      '\n\n[系统建议]\n' +
      lines.join('\n') +
      '\n（建议仅供参考，是否调用由你判断）'
    );
  }

  /**
   * 创建新的 turn 级 triggerState（供 aiService 在每个 _runAgentWorkflow 起点调用）
   */
  function createTriggerState() {
    return {
      suggestionCount: new Map(),
      lastFired: new Map(),
    };
  }

  window.triggerScanner = {
    scanTriggers,
    formatSuggestions,
    createTriggerState,
    buildTriggerContext,
    SUGGESTION_LIMIT,
  };

  console.log('[triggerScanner] ready');
})();
