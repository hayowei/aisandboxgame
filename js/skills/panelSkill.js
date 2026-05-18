// ============================================
// Panel Skill — update_panel 结算 subagent
// ============================================
// 将 update_panel 从主 ReAct 循环中剥离为独立 skill
// 由 SkillDispatcher 在 settlement phase 并发调用
// Prompt 内容通过 promptRegistry 注册（5 个 block），promptTemplate 单行化为 assembleChannel
// ============================================

(function registerPanelSkill() {
  const dispatcher = window.skillDispatcher;
  if (!dispatcher) {
    console.warn('[panelSkill] skillDispatcher 未加载，跳过注册');
    return;
  }

  // ── promptRegistry block 注册 ──
  if (window.promptRegistry) {
    const reg = window.promptRegistry;

    reg.register('panelSkill.intro', {
      channel: 'panelSkill',
      category: 'directive',
      source: 'static-file',
      cacheable: false,
      description: 'panelSkill 角色定义与首句任务说明',
      origin: { file: 'js/skills/panelSkill.js', symbol: 'panelSkill.intro' },
      builder: () =>
        '你是游戏状态结算助手。根据本回合叙事内容，判断游戏状态变化并调用 update_panel 一次。',
      order: 10,
    });

    reg.register('panelSkill.currentState', {
      channel: 'panelSkill',
      category: 'context',
      source: 'dynamic-runtime',
      cacheable: false,
      description: '当前时间/地点/金钱状态摘要（仅供 panelSkill 参考）',
      origin: { file: 'js/skills/panelSkill.js', symbol: 'panelSkill.currentState' },
      builder: ctx => {
        const state = ctx?.currentState || {};
        const panelStatus = state.panel_status || state;
        const dt = panelStatus.datetime;
        const timeStr = dt
          ? `${dt.year}年${dt.month}月${dt.day}日 ${dt.timeStr || dt.time_str || ''}`
          : '未知';
        const loc = panelStatus.location;
        const locStr = loc
          ? [loc.country, loc.site, loc.spot].filter(Boolean).join(' > ')
          : '未知';
        const money = window.inventoryStore?.getMoney?.() ?? null;
        const currencyLabel = window.inventoryStore?.getCurrencyLabel?.() || '银币';
        const moneyStr = money != null ? `${money} ${currencyLabel}` : '未知';
        return [
          '## 当前状态',
          `- 时间: ${timeStr}`,
          `- 地点: ${locStr}`,
          `- 金钱: ${moneyStr}（仅供参考；货币变动由 update_item 在 ReAct 主循环中处理，本 skill 不处理货币）`,
        ].join('\n');
      },
      order: 20,
    });

    reg.register('panelSkill.settlementRules', {
      channel: 'panelSkill',
      category: 'directive',
      source: 'static-file',
      cacheable: false,
      description: 'panelSkill 结算规则（time 必填，其它字段按需）',
      origin: { file: 'js/skills/panelSkill.js', symbol: 'panelSkill.settlementRules' },
      builder: () =>
        [
          '## 结算规则',
          '- time 必填: 在当前时间基础上合理推进',
          '- location: 仅在玩家实际移动时填写',
          '- objective: 仅在目标实质变化时填写',
          '- custom_status: 仅在自定义字段变化时填写',
        ].join('\n'),
      order: 30,
    });

    reg.register('panelSkill.systemHints', {
      channel: 'panelSkill',
      category: 'context',
      source: 'dynamic-runtime',
      cacheable: false,
      description: '系统结算建议（type_tag / 时间推进区间，从 settlementHints 派生）',
      conditionDesc: 'hints 中含 typeTag 或 timeRange 时',
      origin: { file: 'js/skills/panelSkill.js', symbol: 'panelSkill.systemHints' },
      builder: ctx => {
        const hints = ctx?.settlementHints || {};
        const lines = [];
        if (hints.typeTag) lines.push(`type_tag: ${hints.typeTag}`);
        if (hints.timeRangeMin != null && hints.timeRangeMax != null) {
          lines.push(`建议时间推进: ${hints.timeRangeMin}~${hints.timeRangeMax} 分钟`);
        }
        if (lines.length === 0) return '';
        return '## 系统结算建议\n' + lines.join('\n');
      },
      order: 40,
    });

    reg.register('panelSkill.callDirective', {
      channel: 'panelSkill',
      category: 'directive',
      source: 'static-file',
      cacheable: false,
      description: '末尾调用指令',
      origin: { file: 'js/skills/panelSkill.js', symbol: 'panelSkill.callDirective' },
      builder: () => '请基于叙事内容调用 update_panel 一次。',
      order: 90,
    });
  }

  dispatcher.register('update_panel', {
    phase: 'settlement',
    // softRequired：模型仍被 tool_choice 锁向 update_panel，但偶尔判断"本回合无变化"不调用
    // 是合法情况；dispatcher 不会 throw，resultHandler 在空结果时返回 { skipped: true }
    softRequired: true,
    tools: ['update_panel'],

    /**
     * 通过 promptRegistry 装配 panelSkill 通道（promptRegistry 是核心依赖，不提供 fallback：
     * 若缺失说明加载链断裂，整个游戏都不可用，应让错误尽快暴露而非静默使用错误 prompt）
     */
    promptTemplate(ctx) {
      const { parts } = window.promptRegistry.assembleChannel('panelSkill', ctx);
      return parts.map(p => p.text).join('\n');
    },

    /**
     * 从回合上下文提取 skill 所需信息
     */
    contextBuilder(turnCtx) {
      return {
        narrative: turnCtx.narrativeText || '',
        currentState: turnCtx.gameState || {},
        settlementHints: turnCtx.settlementHints || null,
      };
    },

    /**
     * 处理工具执行结果
     * 注：本 skill 是 softRequired，工具可能未被调用（模型判断本回合无字段变化）；
     * 此情况下返回 { skipped: true } 而非 error，避免下游被当成失败 skill 处理。
     */
    resultHandler(toolResults) {
      const panelResult = toolResults.find(r => r.name === 'update_panel');
      if (panelResult?.success) {
        try {
          return JSON.parse(panelResult.result);
        } catch {
          return { raw: panelResult.result };
        }
      }
      if (!panelResult) {
        return { skipped: true, note: '本回合无字段变化' };
      }
      return { error: panelResult.error || 'update_panel 执行失败' };
    },
  });

  console.log('[panelSkill] 已注册 update_panel skill');
})();
