// ============================================
// Item Tools — update_item ReAct 工具
// ============================================
// update_item — AI 提议物品栏变更（新增/累加/减少/移除）
// 单工具 delta 设计：count 归零保留为 tombstone（防 AI 把消耗完的「面包」误命名成「吐司」）
// 文件命名跟工具命名（item 单数粒度）；inventoryStore / .inventory-* 等集合层命名仍保留 inventory。

(function registerItemTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[itemTools] toolRegistry 未加载，跳过注册');
    return;
  }
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  register('update_item', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '对玩家物品栏做 delta 变更（新增/累加/减少/消耗），含货币。叙事中任何物品或货币变化都必须调用此工具。一次调用只动一种物品；同回合可多次调用表达组合。须经玩家审批后才落地。',
    when_to_call:
      '叙事中物品/货币发生变化时：获得、失去、消耗、付款、收入、演化（旧 -1 + 新 +1）、借出（原名 -1，并以「X（借给Y）」+1 表达临时归属）。',
    avoid_when:
      '叙事中物品或货币完全没变化时；无法从叙事推断具体数量时（应估算最小合理整数 ±1，不要不调）；玩家假设性陈述未实际发生时（"如果我买面包"等玩家真买后再调）。',
    input_focus:
      'name 为物品显示名（中文标签式 ≤6 字优先；货币使用本世界货币标签如「银币」「灵石」「T算力」）；desc 仅在该物品首次出现或确实变化时填，否则省略以保留旧 desc；delta 为非零整数（正=入账，负=出账）。优先复用「曾持有」中的同名（防止「面包」被错命名为「吐司」）。',
    expected_output:
      '返回该提议的 pending id 与变化预览（countBefore → countAfter）。玩家审批后才落库。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '物品名（同名累加，不同名分别记账；曾持有过的同类物品请复用同名以保持一致性）',
        },
        delta: {
          type: 'integer',
          description: '数量变动（正=增加，负=减少）；不可为 0',
        },
        desc: {
          type: 'string',
          description: '物品描述；首次出现必填，后续追加可省略（保留旧 desc）',
        },
      },
      required: ['name', 'delta'],
      additionalProperties: false,
    },
    execute(args) {
      const store = window.inventoryStore;
      if (!store) return '[错误] inventoryStore 未加载';

      const name = typeof args?.name === 'string' ? args.name.trim() : '';
      const delta = parseInt(args?.delta);
      if (!name) return '[错误] update_item 需要非空 name';
      if (!Number.isInteger(delta) || delta === 0) {
        return '[错误] update_item.delta 必须为非零整数';
      }

      const turn = (store.currentTurn || 0) + 1;
      let uid = null;
      try {
        if (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory)) {
          for (let i = chatHistory.length - 1; i >= 0; i--) {
            const m = chatHistory[i];
            if (m && m.sender === 'ai' && m.uid) {
              uid = m.uid;
              break;
            }
          }
        }
      } catch (_) {
        uid = null;
      }

      const autoApprove = !!store.isAutoApprove?.();
      const result = store.queueChange({ name, desc: args.desc, delta }, turn, uid);
      if (!result) return '[错误] 无法入队待审批';
      if (result.error === 'insufficient') {
        const need = -result.requestedDelta;
        return `[失败] 「${name}」库存不足：当前持有 ${result.countBefore}，无法 ${result.requestedDelta}（需要 ${need}）。本次扣减未生效；请在下一段 outcome 叙事里改写为"翻了半天发现不够"等承认事实的写法，或先调一次 +N 入账。`;
      }

      const sign = delta > 0 ? '+' : '';
      if (autoApprove) {
        return `[已落地] ${name} ${sign}${delta}（${result.countBefore} → ${result.countAfter}）（自动审批模式，已直接生效）`;
      }
      return `[已提议] ${name} ${sign}${delta}（${result.countBefore} → ${result.countAfter}），待玩家审批。pending_id=${result.id}`;
    },
    source: 'item',
  });

  console.log('[itemTools] 已注册 update_item 工具');
})();
