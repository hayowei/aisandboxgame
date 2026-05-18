/**
 * P3UndoManager - 撤销管理器
 * LIFO 强制按序撤销
 * Undo 栈仅存于内存，页面刷新后清空
 * 支持批次标记（事务回滚）、栈导入导出（abort 恢复）
 */
(function () {
  'use strict';

  const undoStack = [];

  function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }

  /**
   * 记录即将 apply 的操作（在 apply 之前调用）
   */
  function recordApply(enrichedOp, designConfig, designServiceInstance) {
    let currentValue;
    if (enrichedOp.target === 'meta') {
      if (designServiceInstance) {
        if (enrichedOp.path === 'name') currentValue = designServiceInstance.worldCardName;
        else if (enrichedOp.path === 'description')
          currentValue = designServiceInstance.worldCardDescription;
      }
    } else {
      currentValue = window.P3DiffEngine
        ? window.P3DiffEngine.getNestedValue(designConfig, enrichedOp.target, enrichedOp.path)
        : undefined;
    }

    currentValue = deepClone(currentValue);

    const inverseOp = computeInverse(enrichedOp, currentValue);

    undoStack.push({
      enrichedOp,
      inverseOp,
      opId: enrichedOp.id,
    });
  }

  function computeInverse(enrichedOp, currentValue) {
    const { target, action, path, value } = enrichedOp;

    switch (action) {
      case 'update':
        return {
          target,
          action: 'update',
          path,
          value: currentValue,
          _forceReplace: window.P3DiffEngine
            ? window.P3DiffEngine.isEntityLevelMerge(target, action, path)
            : false,
        };

      case 'add':
        return {
          target,
          action: 'delete',
          path,
          value: deepClone(value),
        };

      case 'delete':
        return {
          target,
          action: 'add',
          path,
          value: currentValue,
        };

      default:
        return null;
    }
  }

  /**
   * 标记批次开始（事务性 apply 前调用）
   */
  function markBatchStart() {
    undoStack.push({ _batchMarker: true });
  }

  /**
   * 回滚当前批次（从栈顶弹到 batchMarker 为止）
   * 仅清除栈条目，不执行逆操作（数据由 snapshot 恢复）
   */
  function rollbackBatch() {
    while (undoStack.length > 0) {
      const entry = undoStack.pop();
      if (entry._batchMarker) return;
    }
  }

  /**
   * 撤销最后一条操作 (LIFO)
   * 跳过 batchMarker 条目
   */
  function undo(designService) {
    while (undoStack.length > 0) {
      const entry = undoStack[undoStack.length - 1];
      if (entry._batchMarker) {
        undoStack.pop(); // 跳过 marker
        continue;
      }
      undoStack.pop();
      const { enrichedOp, inverseOp } = entry;
      if (!inverseOp) return null;
      designService._applySingleP3Operation(inverseOp);
      enrichedOp.status = 'undone';
      return { opId: enrichedOp.id, op: enrichedOp };
    }
    return null;
  }

  /**
   * 撤销所有已应用的操作
   */
  function undoAll(designService) {
    let count = 0;
    while (undoStack.length > 0) {
      const result = undo(designService);
      if (result) count++;
      else break;
    }
    return count;
  }

  function canUndo() {
    // 检查是否有非 marker 的条目
    return undoStack.some(e => !e._batchMarker);
  }

  function clear() {
    undoStack.length = 0;
  }

  function getLastAppliedOpId() {
    for (let i = undoStack.length - 1; i >= 0; i--) {
      if (!undoStack[i]._batchMarker) return undoStack[i].opId;
    }
    return null;
  }

  /**
   * 导出栈（deep clone）— 用于 abort 前的备份
   */
  function exportStack() {
    return deepClone(undoStack);
  }

  /**
   * 导入栈（替换）— 用于 abort 后的恢复
   */
  function importStack(data) {
    undoStack.length = 0;
    if (Array.isArray(data)) {
      for (const entry of data) {
        undoStack.push(entry);
      }
    }
  }

  window.P3UndoManager = {
    recordApply,
    markBatchStart,
    rollbackBatch,
    undo,
    undoAll,
    canUndo,
    clear,
    getLastAppliedOpId,
    exportStack,
    importStack,
  };
})();
