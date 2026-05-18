/**
 * P3DiffEngine - 纯逻辑模块，无 DOM 依赖
 * 负责 enrichment（计算 oldValue、displayLabel、groupKey）、
 * 逆操作计算、分组、预览数据生成
 */
(function () {
  'use strict';

  // target 中文映射
  const TARGET_LABELS = {
    world_setting: '世界设定',
    character_database: '角色数据库',
    timeline: '时间线',
    prompt_modules: '规则系统',
    character_timelines: '角色时间线',
    relationship_rules: '关系规则',
    meta: '卡片信息',
    step3_fields: '界面字段配置',
  };

  // action 中文映射
  const ACTION_LABELS = {
    update: 'UPDATE',
    add: 'ADD',
    delete: 'DELETE',
  };

  /**
   * 解析路径字符串为 parts 数组
   */
  function parsePath(path) {
    const parts = [];
    for (const segment of path.split('.')) {
      const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        parts.push(arrayMatch[1]);
        parts.push(parseInt(arrayMatch[2], 10));
      } else {
        parts.push(segment);
      }
    }
    return parts;
  }

  /**
   * 读取嵌套路径的值
   */
  function getNestedValue(config, target, path) {
    const data = config[target];
    if (!data) return undefined;

    const parts = parsePath(path);
    let current = data;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * 深拷贝
   */
  function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return obj;
    }
  }

  /**
   * 生成可读的操作标签
   */
  function computeDisplayLabel(target, action, path) {
    const targetLabel = TARGET_LABELS[target] || target;
    const parts = parsePath(path);

    if (target === 'meta') {
      const fieldName = path === 'name' ? '名称' : path === 'description' ? '描述' : path;
      return `${targetLabel} > ${fieldName}`;
    }

    if (
      (target === 'character_database' || target === 'character_timelines') &&
      parts.length >= 1
    ) {
      const entityName = parts[0];
      if (parts.length === 1) {
        return `${targetLabel} > ${entityName}`;
      }
      return `${targetLabel} > ${entityName} > ${parts.slice(1).join('.')}`;
    }

    if (target === 'timeline') {
      if (path === 'events') return `${targetLabel} > 事件列表`;
      return `${targetLabel} > ${path}`;
    }

    if (target === 'step3_fields') {
      if (path === 'panel_status') return `${targetLabel} > 状态栏模板`;
      if (path === 'panel_npc') return `${targetLabel} > 角色档案字段`;
      // panel_status.{key} 格式：提取 key 用于显示
      const psKeyMatch = typeof path === 'string' && path.match(/^panel_status\.(\w+)$/);
      if (psKeyMatch) return `${targetLabel} > 状态栏[${psKeyMatch[1]}]`;
      // panel_status[N] 旧格式向后兼容
      const psIdxMatch = typeof path === 'string' && path.match(/^panel_status\[(\d+)\]$/);
      if (psIdxMatch) return `${targetLabel} > 状态栏[${psIdxMatch[1]}]`;
      return `${targetLabel} > ${path}`;
    }

    if (target === 'prompt_modules') {
      return `${targetLabel} > ${path}`;
    }

    return `${targetLabel} > ${path}`;
  }

  /**
   * 判断是否为实体级 merge 操作
   */
  function isEntityLevelMerge(target, action, path) {
    return (
      (target === 'character_database' || target === 'character_timelines') &&
      action === 'update' &&
      typeof path === 'string' &&
      !path.includes('.') &&
      !path.includes('[')
    );
  }

  /**
   * 计算逆操作（供 undo 使用）
   */
  function computeInverseOp(enrichedOp) {
    const { target, action, path, value, oldValue } = enrichedOp;

    switch (action) {
      case 'update':
        return {
          target,
          action: 'update',
          path,
          value: deepClone(oldValue),
          _isInverse: true,
          _forceReplace: isEntityLevelMerge(target, action, path),
        };

      case 'add':
        return {
          target,
          action: 'delete',
          path,
          value: deepClone(value),
          _isInverse: true,
        };

      case 'delete':
        return {
          target,
          action: 'add',
          path,
          value: deepClone(oldValue),
          _isInverse: true,
        };

      default:
        return null;
    }
  }

  /**
   * 按 target 分组
   */
  function groupByTarget(enrichedOps) {
    const groups = {};
    for (const op of enrichedOps) {
      const key = op.groupKey || op.target;
      if (!groups[key]) {
        groups[key] = {
          target: key,
          label: TARGET_LABELS[key] || key,
          ops: [],
        };
      }
      groups[key].ops.push(op);
    }
    return groups;
  }

  /**
   * 核心方法：enrichOperations
   */
  function enrichOperations(rawOps, designConfig, designServiceInstance) {
    if (!Array.isArray(rawOps)) return [];

    const enriched = [];
    for (let i = 0; i < rawOps.length; i++) {
      const op = rawOps[i];
      if (!op || !op.target || !op.action || !op.path) continue;

      let oldValue;

      if (op.target === 'meta') {
        if (designServiceInstance) {
          if (op.path === 'name') oldValue = designServiceInstance.worldCardName;
          else if (op.path === 'description')
            oldValue = designServiceInstance.worldCardDescription;
        }
      } else {
        oldValue = getNestedValue(designConfig, op.target, op.path);
      }

      oldValue = deepClone(oldValue);

      const enrichedOp = {
        id: `op_${i}`,
        target: op.target,
        action: op.action,
        path: op.path,
        value: op.value,
        oldValue,
        displayLabel: computeDisplayLabel(op.target, op.action, op.path),
        groupKey: op.target,
        status: 'accepted', // opt-out 模型，默认 accepted
        _summary: op._summary || null,
      };

      enriched.push(enrichedOp);
    }

    return enriched;
  }

  /**
   * 将任意值转为可读字符串
   */
  function formatPreviewText(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  /**
   * 获取操作的预览数据（供 PlanRenderer 使用）
   * @returns {{ oldText: string, newText: string, action: string, isLong: boolean } | null}
   */
  function getPreviewData(enrichedOp) {
    const { action, oldValue, value } = enrichedOp;

    let oldText = formatPreviewText(oldValue);
    let newText = formatPreviewText(value);

    // entity-level merge：展示 merge 后的完整对象
    if (isEntityLevelMerge(enrichedOp.target, enrichedOp.action, enrichedOp.path)) {
      if (oldValue && typeof oldValue === 'object' && value && typeof value === 'object') {
        const merged = { ...oldValue, ...value };
        newText = formatPreviewText(merged);
      }
    }

    if (action === 'update' && oldText === newText) return null;

    const isLong = oldText.length > 100 || newText.length > 100;

    return { oldText, newText, action, isLong };
  }

  // 导出
  window.P3DiffEngine = {
    enrichOperations,
    computeInverseOp,
    groupByTarget,
    getPreviewData,
    formatPreviewText,
    deepClone,
    parsePath,
    getNestedValue,
    isEntityLevelMerge,
    TARGET_LABELS,
    ACTION_LABELS,
  };
})();
