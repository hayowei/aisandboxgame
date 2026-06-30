// ============================================
// Turn Result Builder
// ============================================
// 当 AI 返回纯文本（无 JSON 块）时，从各 runtime service 汇总
// 一份 gameData 快照，用于持久化到 chatHistory 消息上。

/**
 * 从已同步的 runtime services 组装 gameData
 * @returns {{ panel_status: Object } | null}
 */
function buildTurnResult() {
  const status = typeof customStatusStore !== 'undefined'
    ? customStatusStore.getStatus()
    : null;

  // 以 customStatusStore 的快照为基础，覆盖核心字段
  const panelStatus = status ? JSON.parse(JSON.stringify(status)) : {};

  // datetime
  if (typeof timelineService !== 'undefined') {
    const dt = timelineService.getCurrentDate();
    if (dt) {
      panelStatus.datetime = { ...dt };
      // 保证双别名都存在
      if (dt.time_str && !dt.timeStr) panelStatus.datetime.timeStr = dt.time_str;
      if (dt.timeStr && !dt.time_str) panelStatus.datetime.time_str = dt.timeStr;
    }
  }

  // location
  if (typeof locationTracker !== 'undefined') {
    const loc = locationTracker.getLocation();
    if (loc) panelStatus.location = { ...loc };
  }

  // money（来自 inventoryStore，统一物品栏一项）
  const moneyAmount = window.inventoryStore?.getMoney?.();
  if (typeof moneyAmount === 'number') {
    if (!panelStatus.money) panelStatus.money = {};
    panelStatus.money.amount = moneyAmount;
  }

  // objective
  if (typeof playerStateService !== 'undefined') {
    const obj = playerStateService.getObjective();
    if (obj != null) {
      if (!panelStatus.objective) panelStatus.objective = {};
      panelStatus.objective.text = obj;
    }
  }

  // 如果所有 service 都没数据，返回 null 而非空壳
  if (Object.keys(panelStatus).length === 0) return null;

  return { panel_status: panelStatus };
}

window.buildTurnResult = buildTurnResult;
