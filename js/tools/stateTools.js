// ============================================
// State Tools — 回合尾部状态结算工具
// ============================================
// update_panel — 一次性结算本回合所有状态变化（time/location/money/objective/custom_status）

(function registerStateTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[stateTools] toolRegistry 未加载，跳过注册');
    return;
  }
  // 优先用 registerToolWithPrompt 双写（promptRegistry + toolRegistry）；fallback 到原 register
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  register('update_panel', {
    phase: 'settlement',
    required: true,
    dispatcherManaged: true,
    trigger: null,
    triggerHint: null,
    signal: 'panel:complete',
    description:
      '一次性结算本回合所有状态变化（time 必填；其他字段仅在实际变化时填写）。货币变动改用 update_item 提交，本工具不处理货币。每回合调用一次。',
    when_to_call:
      '本回合叙事输出完毕后，结算所有状态变化。',
    avoid_when:
      '叙事尚未输出完毕时。',
    input_focus:
      'custom_status 用 object 形式，键是字段名（支持点路径），值是新值。',
    expected_output:
      '返回所有被更新字段的 previous → current。',
    parameters: {
      type: 'object',
      properties: {
        time: {
          type: 'object',
          description: '新的游戏时间（每回合必然推进，哪怕只是几分钟）',
          properties: {
            year: { type: 'number', description: '年份' },
            month: { type: 'number', description: '月份 (1-12)' },
            day: { type: 'number', description: '日 (1-31)' },
            hour: { type: 'number', description: '小时 (0-23)' },
            minute: { type: 'number', description: '分钟 (0-59)' },
          },
          required: ['year', 'month', 'day', 'hour'],
        },
        location: {
          type: 'object',
          description: '仅在玩家实际移动到新地点时填写',
          properties: {
            new_location: {
              type: 'string',
              description: '新地点名称，如"铁匠铺"、"东城门外的小路"',
            },
            site: {
              type: 'string',
              description: '新的城市/区域名称（可选）。跨城市移动时填写',
            },
          },
          required: ['new_location'],
        },
        objective: {
          type: 'string',
          description: '仅在目标实质变化时填写 — 新的目标描述',
        },
        custom_status: {
          type: 'object',
          description:
            '自定义状态字段更新，如 {"health": "轻伤", "reputation": "小有名气"}。键是字段名（支持点路径），值是新值。',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['time'],
    },
    execute(args) {
      const results = {};
      const hints = window._currentTurnSettlementHints;

      // 1. 时间推进（必填）
      if (args.time) {
        const ts = typeof timelineService !== 'undefined' ? timelineService : null;
        if (!ts) {
          results.time = { error: 'timelineService 未加载' };
        } else {
          const prev = ts.getCurrentDate?.();
          const previousStr = prev
            ? `${prev.year}年${prev.month}月${prev.day}日 ${prev.timeStr || ''}`
            : '未知';
          const minute = typeof args.time.minute === 'number' ? args.time.minute : 0;
          ts.setCurrentDate(args.time.year, args.time.month, args.time.day, args.time.hour, minute);
          const curr = ts.getCurrentDate?.();
          const currentStr = curr
            ? `${curr.year}年${curr.month}月${curr.day}日 ${curr.timeStr || ''}`
            : `${args.time.year}年${args.time.month}月${args.time.day}日 ${args.time.hour}:${minute}`;
          console.log(`[update_panel.time] ${previousStr} → ${currentStr}`);
          results.time = { previous: previousStr, current: currentStr };

          // 软性校验：检查时间推进是否在建议范围内
          if (prev && curr && hints?.timeRangeMin != null && hints?.timeRangeMax != null && ts._toAbsoluteMinutes) {
            const prevAbsMin = ts._toAbsoluteMinutes(prev);
            const currAbsMin = ts._toAbsoluteMinutes(curr);
            const actualMinutes = currAbsMin - prevAbsMin;
            if (actualMinutes < hints.timeRangeMin || actualMinutes > hints.timeRangeMax) {
              const warn = `时间推进 ${actualMinutes} 分钟，超出建议范围 ${hints.timeRangeMin}-${hints.timeRangeMax} 分钟 (type_tag=${hints.typeTag})`;
              console.warn(`[update_panel.time] ⚠️ ${warn}`);
              results.time.warning = warn;
            }
          }
        }
      }

      // 2. 位置变更（可选）
      if (args.location && args.location.new_location) {
        const lt = typeof locationTracker !== 'undefined' ? locationTracker : null;
        if (!lt) {
          results.location = { error: 'locationTracker 未加载' };
        } else {
          const prev = lt.currentLocation;
          const previousStr = prev
            ? [prev.country, prev.site, prev.spot].filter(Boolean).join(' > ')
            : '未知';

          // 软性记录：location 是否在世界卡 sites/locations 里（不阻断写入）。
          // 仅作 trace 留痕用，便于回查模型是否在编造世界卡外的地名。
          const mapData = window.mapService?.getMapData?.();
          if (mapData) {
            const knownNames = new Set();
            (mapData.worldMap || []).forEach(c => { if (c?.siteName) knownNames.add(c.siteName); });
            Object.values(mapData.localMapCache || {}).forEach(localMap => {
              (localMap || []).forEach(c => { if (c?.locationName) knownNames.add(c.locationName); });
            });
            const candidates = [args.location.new_location, args.location.site].filter(Boolean);
            const unknown = candidates.filter(n => !knownNames.has(n));
            if (unknown.length > 0) {
              results.location = results.location || {};
              results.location.note = `${unknown.map(n => `「${n}」`).join('、')}未在世界卡 sites/locations 中找到`;
            }
          }

          const update = { spot: args.location.new_location };
          if (args.location.site) update.site = args.location.site;
          lt.updateManually(update);
          const currentStr = args.location.site
            ? `${args.location.site} > ${args.location.new_location}`
            : args.location.new_location;
          console.log(`[update_panel.location] ${previousStr} → ${currentStr}`);
          results.location = { ...(results.location || {}), previous: previousStr, current: currentStr };
        }
      }

      // 3. 目标变更（可选）
      if (typeof args.objective === 'string' && args.objective) {
        const ps = typeof playerStateService !== 'undefined' ? playerStateService : null;
        if (!ps) {
          results.objective = { error: 'playerStateService 未加载' };
        } else {
          const previous = ps.getObjective();
          ps.setObjective(args.objective);
          console.log(`[update_panel.objective] "${previous || ''}" → "${args.objective}"`);
          results.objective = { previous: previous || '无', current: args.objective };
        }
      }

      // 4. 自定义状态（可选，object 形式）
      if (args.custom_status && typeof args.custom_status === 'object') {
        const store = window.customStatusStore;
        if (!store) {
          results.custom_status = { error: 'customStatusStore 未加载' };
        } else {
          const currentStatus = store.getStatus?.() || {};
          const changes = [];
          for (const [field, value] of Object.entries(args.custom_status)) {
            if (value === undefined || value === null) continue;
            const previous = currentStatus[field];
            store.updateField(field, value);
            console.log(`[update_panel.custom_status] ${field}: "${previous ?? '未设置'}" → "${value}"`);
            changes.push({
              field,
              previous: previous !== undefined ? previous : '未设置',
              current: value,
            });
          }
          if (changes.length > 0) results.custom_status = changes;
        }
      }

      // 清理 settlement hints
      window._currentTurnSettlementHints = null;

      // 通知前端刷新面板
      if (window.eventBus && window.GameEvents?.AI_STATE_PANEL_UPDATED) {
        window.eventBus.emit(window.GameEvents.AI_STATE_PANEL_UPDATED, {
          changes: results,
        });
      }

      const changedFields = Object.keys(results);
      console.log(`[update_panel] 结算字段: ${changedFields.join(', ') || '(无)'}`);
      return JSON.stringify(results);
    },
  });

  console.log('[stateTools] 已注册 update_panel 工具');
})();
