// ============================================
// Inventory Skill — update_item 兜底审计 subagent
// ============================================
// 双轨设计：
//   - 主 ReAct 循环：AI 可见 update_item，可在叙事中随时调
//   - Phase 3B 收尾：本 skill 仅在主 ReAct 循环本回合 0 次 update_item 时启动（shouldRun 控制），
//     用于"主 AI 完全漏报"的兜底场景，从叙事文本反推漏报的物品/货币变化并补调 update_item。
//   - 主 AI 调过任意次 update_item 时，本 skill 跳过整个 LLM call（不做"部分漏报"审计）。
// 与 panelSkill 并行执行（Promise.allSettled）。
// Prompt 内容通过 promptRegistry 注册，promptTemplate 单行化为 assembleChannel。
// ============================================

(function registerInventorySkill() {
  const dispatcher = window.skillDispatcher;
  if (!dispatcher) {
    console.warn('[inventorySkill] skillDispatcher 未加载，跳过注册');
    return;
  }

  // ── promptRegistry block 注册 ──
  if (window.promptRegistry) {
    const reg = window.promptRegistry;

    reg.register('inventorySkill.auditRole', {
      channel: 'inventorySkill',
      category: 'directive',
      source: 'static-file',
      cacheable: false,
      description: 'inventorySkill 审计员角色与任务定义',
      origin: { file: 'js/skills/inventorySkill.js', symbol: 'inventorySkill.auditRole' },
      builder: () =>
        '你是物品栏审计员。任务：检查本回合叙事中是否有遗漏的物品/货币变化，对漏报的部分调用 update_item 补调。',
      order: 10,
    });

    reg.register('inventorySkill.narrativeContext', {
      channel: 'inventorySkill',
      category: 'context',
      source: 'dynamic-runtime',
      cacheable: false,
      description: '本回合叙事文本',
      origin: { file: 'js/skills/inventorySkill.js', symbol: 'inventorySkill.narrativeContext' },
      builder: ctx => {
        const narrative = ctx?.narrative || '（无叙事文本）';
        return ['## 本回合叙事', narrative].join('\n');
      },
      order: 20,
    });

    reg.register('inventorySkill.activeItems', {
      channel: 'inventorySkill',
      category: 'context',
      source: 'dynamic-runtime',
      cacheable: false,
      description: '当前已落地物品栏（active + tombstone）',
      origin: { file: 'js/skills/inventorySkill.js', symbol: 'inventorySkill.activeItems' },
      builder: ctx => {
        const activeItems = ctx?.activeItems || [];
        const tombstones = ctx?.tombstones || [];
        const activeStr =
          activeItems.length > 0
            ? activeItems.map(it => `${it.name}×${it.count}`).join('、') /* ui-lint-allow: 物品计数乘号 */
            : '（空）';
        const tombStr = tombstones.length > 0 ? tombstones.map(it => it.name).join('、') : '（无）';
        return [
          '## 当前物品栏（已落地）',
          `- 已持有：${activeStr}`,
          `- 曾持有（再次获得请复用同名）：${tombStr}`,
        ].join('\n');
      },
      order: 30,
    });

    reg.register('inventorySkill.callRules', {
      channel: 'inventorySkill',
      category: 'directive',
      source: 'static-file',
      cacheable: false,
      description: 'inventorySkill 调用规则（货币名 + 名称演化 + 借出）',
      origin: { file: 'js/skills/inventorySkill.js', symbol: 'inventorySkill.callRules' },
      builder: ctx => {
        const currencyLabel = ctx?.currencyLabel || '银币';
        return [
          '## 调用规则',
          `- 本世界货币名为「${currencyLabel}」。`,
          '- 叙事中只要出现物品/货币的获得/失去/消耗/给予/购买/收取等事件，就应补调 update_item；数量含糊时取保守默认（无明确数量按 1 或叙事概数下限），名称含糊时用叙事最贴近的通称并优先复用「曾持有」名。宁可补一个保守条目，也不要整回合漏报。',
          '- 名称演化（生肉→烤肉）：旧 -1 + 新 +1，两次调用。',
          '- 借出/抵押：用名称演化保留身份（如 update_item("宝剑（借给将军）", +1)）。',
          '- 优先复用「曾持有」中的物品名，避免「面包」被错命名为「吐司」。',
          '- **count 是非负整数**：调用前先看上方「已持有」中的实际数量；负 delta 不能超过当前持有量，否则会返回 `[失败] 库存不足`，本回合补调失败、无法重试。',
          '- 仅当叙事真的零物品/货币事件时才不调用任何工具；注意"叙事写得含糊" ≠ "没有变化"——含糊属于"有事件"，仍按上一条保守补。',
        ].join('\n');
      },
      order: 50,
    });
  }

  dispatcher.register('inventory', {
    phase: 'settlement',
    required: false,
    tools: ['update_item'],

    /**
     * 主循环本回合若已成功调过任意次 update_item → 跳过审计 subagent。
     * 设计前提：主 AI 在叙事过程中已写完物品变化，inventorySkill 仅在主 AI
     * 完全没调时作为兜底（防止漏报）。trace 数据显示主 AI 调过后 subagent
     * 100% 返回 0 次补调，说明本兜底无价值，可直接跳。
     */
    shouldRun(turnCtx) {
      const count = (turnCtx.mainLoopToolCounts && turnCtx.mainLoopToolCounts.update_item) || 0;
      return count === 0;
    },

    contextBuilder(turnCtx) {
      const store = window.inventoryStore;
      return {
        narrative: turnCtx.narrativeText || '',
        activeItems: store?.getActiveItems?.() || [],
        tombstones: store?.getTombstoneItems?.() || [],
        pending: store?.getPending?.() || [],
        currencyLabel: store?.getCurrencyLabel?.() || '银币',
      };
    },

    /**
     * 通过 promptRegistry 装配 inventorySkill 通道（promptRegistry 是核心依赖，无 fallback）
     */
    promptTemplate(ctx) {
      const { parts } = window.promptRegistry.assembleChannel('inventorySkill', ctx);
      return parts.map(p => p.text).join('\n\n');
    },

    /**
     * 输出形状对齐 _formatSettlementSummary 期待的 diff 结构：
     *   返回 { '物品名1': { previous, current }, '物品名2': {...}, ... }
     *   每个条目渲染成「物品名: A → B」一行。
     *
     * 实现：从 update_item.execute 的返回字符串里 grep 「（A → B）」。
     * 同名物品多次调用时，保留最早的 previous + 最新的 current（合并成单条 diff）。
     * 失败/无 diff 的调用跳过（失败串没有 → 模式）。
     */
    resultHandler(toolResults) {
      const calls = toolResults.filter(r => r.name === 'update_item');
      const out = {};
      const diffPattern = /（(-?\d+)\s*→\s*(-?\d+)）/;
      for (const r of calls) {
        if (!r.success) continue;
        const name = typeof r.args?.name === 'string' ? r.args.name : '';
        if (!name) continue;
        const m = diffPattern.exec(r.result || '');
        if (!m) continue;
        const previous = parseInt(m[1], 10);
        const current = parseInt(m[2], 10);
        if (Number.isNaN(previous) || Number.isNaN(current)) continue;
        if (out[name]) {
          // 同名多次调用 → 累加：保留最早的 previous + 最新的 current
          out[name] = { previous: out[name].previous, current };
        } else {
          out[name] = { previous, current };
        }
      }
      return out;
    },
  });

  console.log('[inventorySkill] 已注册 inventory skill');
})();
