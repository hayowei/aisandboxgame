// ============================================
// Player Status Recheck Subagent（玩家状态栏手动「复核」：单组重判）
// ============================================
// 玩家在聊天内每回合状态栏上点某【组】的「复核」键 → 一次【独立、即时】的结构化 AI 调用：
// 根据当前剧情重新判断该组的最新值。不进叙事回合、不推进剧情。按组分四类：
//   · 位置（location，三段 {country,site,spot}）→ _runStatusLocationRecheck
//   · 当前目标（objective，free 文本）       → _runStatusObjectiveRecheck
//   · 时间（datetime，按精度的年月日时分）    → _runStatusDatetimeRecheck
//   · 自定义组（作者配的 health/名声…）       → _runStatusCustomGroupRecheck（schema 运行时动态生成）
// 红线：状态值禁玩家手填——复核值来自 AI 调用（属「AI 写」）。货币不在复核范围（真源 inventoryStore）。
// 职责边界：本 subagent 只 resolve + 校验、返回值；落地（写 host service / customStatusStore /
//   PZGM 引擎存档 + 定点刷新）由 gameOutputRenderer 调用方做。
// 模型：模块键 status_locate / status_objective / status_datetime / status_custom_recheck
//   （推荐模式 flash + thinking off；forced tool → off）。
// 范式照搬 npcRecheckSubagent.js；公共骨架（_recheckCallOnce / _buildRecheckNarrative）直接复用
//   它已注入 AIService.prototype 的那份（本文件在其后加载）。
// ============================================

// 工具声明：位置复核（状态栏 location = {country,site,spot} 三段式，与 NPC 位置同结构）。
const RECHECK_STATUS_LOCATION_DECL = Object.freeze({
  name: 'recheck_status_location',
  description:
    '根据【当前剧情】重新判断【主角（玩家）此刻在哪】。只输出结构化数据，不要写任何叙事/散文。',
  parameters: {
    type: 'object',
    properties: {
      current_location: {
        type: 'object',
        description: '主角此刻所在地点，三段式 country/site/spot（不确定的段填"未知"；缺只能从右往左连续地缺）。剧情明确移动了就给新地点，没动就维持原值；尽量用世界已知地点。',
        properties: {
          country: { type: 'string', description: '国家/区域（= 世界已知实体名；不确定填"未知"）。' },
          site: { type: 'string', description: '地点（不确定填"未知"）。' },
          spot: { type: 'string', description: '具体落点（不确定填"未知"）。' },
        },
        required: ['country', 'site', 'spot'],
      },
      confidence: { type: 'number', description: '把握度 0–1。剧情线索不足时给低值，别硬猜。' },
      reason: { type: 'string', description: '判断依据（引用剧情）。' },
    },
    required: ['current_location', 'confidence'],
  },
});

// 工具声明：当前目标复核（objective 为 free 文本）。
const RECHECK_STATUS_OBJECTIVE_DECL = Object.freeze({
  name: 'recheck_status_objective',
  description:
    '根据【当前剧情】重新判断【主角此刻最该追的短期目标】。只输出结构化数据，不要写任何叙事/散文。',
  parameters: {
    type: 'object',
    properties: {
      objective: { type: 'string', description: '主角当前最该追的短期目标（一句话，可执行）。没明显变化就照抄当前值。' },
      changed: { type: 'boolean', description: '相比当前值是否有实质变化。' },
      reason: { type: 'string', description: '判断依据（引用剧情）。' },
    },
    required: ['objective', 'changed'],
  },
});

// 工具声明：时间复核（按精度填字段；非精度内字段忽略）。year 必填，其余按精度。
const RECHECK_STATUS_DATETIME_DECL = Object.freeze({
  name: 'recheck_status_datetime',
  description:
    '根据【当前剧情】重新判断【此刻的游戏内时间】。只输出结构化数据，不要写任何叙事/散文。',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'integer', description: '年。' },
      month: { type: 'integer', description: '月 1–12（精度不含月则忽略）。' },
      day: { type: 'integer', description: '日 1–31（精度不含日则忽略）。' },
      hour: { type: 'integer', description: '时 0–23（精度不含时分则忽略）。' },
      minute: { type: 'integer', description: '分 0–59（精度不含时分则忽略）。' },
      changed: { type: 'boolean', description: '相比当前时间是否有实质变化。' },
      reason: { type: 'string', description: '判断依据（引用剧情）。' },
    },
    required: ['year', 'changed'],
  },
});

class _AIServicePlayerStatusRecheckMixin {
  /** 复核公共上下文（剧情摘要 + 最近原文）。复用 npcRecheckSubagent 注入的同名方法；防御性兜底。 */
  _buildStatusRecheckNarrative(en, recentN = 4) {
    if (typeof this._buildRecheckNarrative === 'function') {
      return this._buildRecheckNarrative(en, recentN);
    }
    return { summaryDigest: '', recent: '' };
  }

  /**
   * 位置复核：根据当前剧情重判主角此刻在哪。返回 { location:{country,site,spot}, confidence, reason } 或 null。
   */
  async _runStatusLocationRecheck(signal = null) {
    if (typeof this._recheckCallOnce !== 'function') return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const curRaw = window.locationTracker?.getLocation?.();
    const curT = window.locationTriad ? window.locationTriad.toTriad(curRaw || {}) : (curRaw || {});
    const seg = k => (curT && typeof curT[k] === 'string' && curT[k].trim() ? curT[k].trim() : '未知');
    // 给 AI 看【显式三段】（含"未知"标记），别用折叠串——否则 AI 不知道哪段缺、会把地名错位塞段。
    const curSegLine = `country=${seg('country')} / site=${seg('site')} / spot=${seg('spot')}`;
    const { summaryDigest, recent } = this._buildStatusRecheckNarrative(en);
    const pool = (typeof this._readStarterSitesPool === 'function') ? (this._readStarterSitesPool() || []) : [];
    const poolText = pool.length
      ? pool.map((s, i) => `  ${i + 1}. ${s.fullPath}`).join('\n')
      : (en ? '  (no structured site pool)' : '  （无结构化地点池）');

    const systemText = en
      ? [
          'You are a player-location rechecker. Task: from the CURRENT story, re-judge WHERE the protagonist (the player) is right now, then call recheck_status_location. **Only emit the tool call — never write narrative.**',
          '',
          '## Current value (explicit 3 segments)',
          curSegLine,
          '',
          '## What each segment means',
          '- country = the big region: nation / city / faction territory / large place name.',
          '- site = the concrete place/venue: a building, market, square, hall, ship, etc.',
          '- spot = the specific position INSIDE the site: a direction ("east side"), a room, a floor, a corner.',
          '',
          '## Rules',
          '- Keep each segment at its correct level. Do NOT push a concrete place up into country, and do NOT repeat the same name across segments.',
          '- If the story already establishes a finer position (a direction / room / corner), put it in spot — do not leave spot as "未知".',
          '- Keep segments the story still supports; only change/fill the ones the story actually moved or clarified. Fill "未知" ONLY for a segment you truly cannot tell.',
          '- Prefer the world\'s known places below. If clues are thin, give a LOW confidence — do not guess.',
          '',
          '## Known places (reference)',
          poolText,
          '',
          '## Story summary',
          summaryDigest || '(none)',
          '',
          '## Recent story',
          recent || '(none)',
        ].join('\n')
      : [
          '你是玩家位置复核器。任务：根据【当前剧情】重新判断【主角（玩家）此刻在哪】，然后调用 recheck_status_location。**只输出工具调用，绝不写叙事。**',
          '',
          '## 当前值（显式三段）',
          curSegLine,
          '',
          '## 三段各是什么',
          '- country = 大区域：国家 / 城 / 势力领地 / 大地名。',
          '- site = 具体场所：建筑、坊市、广场、大殿、船等一个落脚的地点。',
          '- spot = 场所内的具体位置：方位（"东侧"）、房间、楼层、角落。',
          '',
          '## 判断要求',
          '- 每段放在正确层级：别把具体场所塞进 country，别把同一个地名重复填进多段。',
          '- 剧情若已交代更细的落点（方位/房间/角落），就放进 spot，别让 spot 停在"未知"。',
          '- 维持剧情仍支持的段；只改/补剧情确实移动或交代了的段。只有真判不出的段才填"未知"。',
          '- 地点尽量用下方世界已知地点。线索不足时给【低 confidence】，别硬猜。',
          '',
          '## 世界已知地点（参考）',
          poolText,
          '',
          '## 剧情摘要',
          summaryDigest || '（无）',
          '',
          '## 最近剧情原文',
          recent || '（无）',
        ].join('\n');

    const userContent = en
      ? 'Call recheck_status_location for the protagonist. Tool call only.'
      : '请调用 recheck_status_location 重新判断主角此刻在哪。只输出工具调用。';

    const args = await this._recheckCallOnce('status_locate', RECHECK_STATUS_LOCATION_DECL, systemText, userContent, signal);
    const loc = args && args.current_location;
    if (!loc || typeof loc !== 'object') return null;
    const triad = window.locationTriad ? window.locationTriad.toTriad(loc) : loc;
    return {
      location: triad,
      confidence: typeof args.confidence === 'number' ? args.confidence : 1,
      reason: typeof args.reason === 'string' ? args.reason : '',
    };
  }

  /**
   * 当前目标复核。返回 { objective, changed, reason } 或 null。
   */
  async _runStatusObjectiveRecheck(signal = null) {
    if (typeof this._recheckCallOnce !== 'function') return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const cur = window.playerStateService?.getObjective?.();
    const curText = (cur == null || cur === '') ? (en ? '(empty)' : '（空）') : String(cur);
    const { summaryDigest, recent } = this._buildStatusRecheckNarrative(en);

    const systemText = en
      ? [
          'You are a player-objective rechecker. Task: from the CURRENT story, re-judge the protagonist\'s most pressing short-term objective, then call recheck_status_objective. **Only emit the tool call — never write narrative.**',
          '',
          `## Current objective\n${curText}`,
          '',
          '## Rules',
          '- Judge ONLY from what the story has already established.',
          '- If it changed, give the new objective (one concise, actionable line) and set changed=true. If not, copy the current value and set changed=false.',
          '- Do NOT invent unrelated goals; only reflect what the story already points to.',
          '',
          '## Story summary',
          summaryDigest || '(none)',
          '',
          '## Recent story',
          recent || '(none)',
        ].join('\n')
      : [
          '你是玩家目标复核器。任务：根据【当前剧情】重新判断主角此刻最该追的短期目标，然后调用 recheck_status_objective。**只输出工具调用，绝不写叙事。**',
          '',
          `## 当前目标\n${curText}`,
          '',
          '## 判断要求',
          '- 只依据剧情【已经发生】的事实判断。',
          '- 变了就给最新目标（一句简洁、可执行）并把 changed 设为 true；没变就照抄当前值、changed 设为 false。',
          '- 不要凭空扩写无关目标，只反映剧情已经指向的方向。',
          '',
          '## 剧情摘要',
          summaryDigest || '（无）',
          '',
          '## 最近剧情原文',
          recent || '（无）',
        ].join('\n');

    const userContent = en
      ? 'Call recheck_status_objective for the protagonist. Tool call only.'
      : '请调用 recheck_status_objective 重新判断主角当前目标。只输出工具调用。';

    const args = await this._recheckCallOnce('status_objective', RECHECK_STATUS_OBJECTIVE_DECL, systemText, userContent, signal);
    if (!args || typeof args.objective !== 'string' || !args.objective.trim()) return null;
    const objective = args.objective.trim();
    return {
      objective,
      changed: args.changed !== false && objective !== String(cur ?? '').trim(),
      reason: typeof args.reason === 'string' ? args.reason : '',
    };
  }

  /**
   * 时间复核（按精度）。返回 { date:{year,month,day,hour,minute}, changed, reason } 或 null。
   */
  async _runStatusDatetimeRecheck(signal = null) {
    if (typeof this._recheckCallOnce !== 'function') return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const terms = window.worldMeta?.getActiveTimeTerms?.() || { precision: 'day', labels: {}, era: '' };
    const precision = terms.precision || 'day';
    const curDate = window.timelineService?.getCurrentDate?.() || {};
    const curStr = (() => {
      const parts = [];
      if (terms.era) parts.push(terms.era);
      if (curDate.year != null) parts.push(`${curDate.year}${terms.labels?.year || '年'}`);
      if (['month', 'day', 'time'].includes(precision) && curDate.month != null) parts.push(`${curDate.month}${terms.labels?.month || '月'}`);
      if (['day', 'time'].includes(precision) && curDate.day != null) parts.push(`${curDate.day}${terms.labels?.day || '日'}`);
      if (precision === 'time') {
        const clock = typeof curDate.timeStr === 'string' ? curDate.timeStr : (typeof curDate.time_str === 'string' ? curDate.time_str : '');
        if (clock) parts.push(clock);
      }
      return parts.join(' ') || (en ? '(unknown)' : '（未知）');
    })();
    const precisionHint = en
      ? `Precision = "${precision}". Fill only the fields within this precision (year${['month', 'day', 'time'].includes(precision) ? '/month' : ''}${['day', 'time'].includes(precision) ? '/day' : ''}${precision === 'time' ? '/hour/minute' : ''}).`
      : `精度 = "${precision}"。只填该精度内的字段（年${['month', 'day', 'time'].includes(precision) ? '/月' : ''}${['day', 'time'].includes(precision) ? '/日' : ''}${precision === 'time' ? '/时/分' : ''}）。`;
    const { summaryDigest, recent } = this._buildStatusRecheckNarrative(en);

    const systemText = en
      ? [
          'You are an in-game-time rechecker. Task: from the CURRENT story, re-judge what the in-game date/time is right now, then call recheck_status_datetime. **Only emit the tool call — never write narrative.**',
          '',
          `## Current time\n${curStr}`,
          '',
          '## Rules',
          `- ${precisionHint}`,
          '- Judge ONLY from what the story has already established. Do NOT move time backward unless the story clearly shows a flashback/rewind.',
          '- If it did not really change, copy the current values and set changed=false.',
          '',
          '## Story summary',
          summaryDigest || '(none)',
          '',
          '## Recent story',
          recent || '(none)',
        ].join('\n')
      : [
          '你是游戏内时间复核器。任务：根据【当前剧情】重新判断此刻的游戏内日期/时间，然后调用 recheck_status_datetime。**只输出工具调用，绝不写叙事。**',
          '',
          `## 当前时间\n${curStr}`,
          '',
          '## 判断要求',
          `- ${precisionHint}`,
          '- 只依据剧情【已经发生】的事实判断。除非剧情明确闪回/回溯，否则【不要让时间倒退】。',
          '- 实质没变就照抄当前值、changed 设为 false。',
          '',
          '## 剧情摘要',
          summaryDigest || '（无）',
          '',
          '## 最近剧情原文',
          recent || '（无）',
        ].join('\n');

    const userContent = en
      ? 'Call recheck_status_datetime. Tool call only.'
      : '请调用 recheck_status_datetime 重新判断此刻时间。只输出工具调用。';

    const args = await this._recheckCallOnce('status_datetime', RECHECK_STATUS_DATETIME_DECL, systemText, userContent, signal);
    if (!args || !Number.isFinite(Number(args.year))) return null;
    const num = (v, fallback) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
    const date = {
      year: num(args.year, curDate.year),
      month: ['month', 'day', 'time'].includes(precision) ? num(args.month, curDate.month) : curDate.month,
      day: ['day', 'time'].includes(precision) ? num(args.day, curDate.day) : curDate.day,
      hour: precision === 'time' ? num(args.hour, curDate.hour) : curDate.hour,
      minute: precision === 'time' ? num(args.minute, curDate.minute) : curDate.minute,
    };
    return {
      date,
      changed: args.changed !== false,
      reason: typeof args.reason === 'string' ? args.reason : '',
    };
  }

  /**
   * 自定义组复核：schema 运行时按该组真实子字段动态生成。返回 { value, label } 或 null（value=对象或数组）。
   * @param {string} groupKey
   */
  async _runStatusCustomGroupRecheck(groupKey, signal = null) {
    if (typeof this._recheckCallOnce !== 'function') return null;
    if (!groupKey) return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const panelFields = window.worldMeta?.getPanelFields?.()?.panel_status;
    const allProps = window.panelSchemaBuilder?.buildCustomStatusToolProperties?.(panelFields) || {};
    const groupProp = allProps[groupKey];
    if (!groupProp) return null; // 退化组（无可填子字段）→ 不复核

    const groupDef = Array.isArray(panelFields)
      ? panelFields.find(g => g && g.key === groupKey)
      : null;
    const label = (groupDef && typeof groupDef.label === 'string' && groupDef.label.trim()) ? groupDef.label.trim() : groupKey;
    const curVal = window.customStatusStore?.getStatus?.()?.[groupKey];
    const curJson = (curVal === undefined) ? (en ? '(none)' : '（无）') : JSON.stringify(curVal);

    const decl = {
      name: 'recheck_status_group',
      description: en
        ? `Re-judge the latest value of the "${label}" status group from the current story. Output structured data only — no narrative.`
        : `根据当前剧情重判「${label}」状态组的最新值。只输出结构化数据，不写叙事。`,
      parameters: { type: 'object', properties: { [groupKey]: groupProp }, required: [groupKey] },
    };

    const { summaryDigest, recent } = this._buildStatusRecheckNarrative(en);
    const systemText = en
      ? [
          `You are a status-group rechecker. Task: from the CURRENT story, re-judge the latest value of the status group "${label}", then call recheck_status_group. **Only emit the tool call — never write narrative.**`,
          '',
          `## Current value of "${label}"\n${curJson}`,
          '',
          '## Rules',
          '- Fill each sub-field by its description; reflect ONLY changes the story already shows. If a sub-field did not change, keep its current value.',
          '- For a list group, re-list by the current number of entries; only add/remove an entry if the story clearly added/removed one.',
          '- Do NOT invent unrelated data.',
          '',
          '## Story summary',
          summaryDigest || '(none)',
          '',
          '## Recent story',
          recent || '(none)',
        ].join('\n')
      : [
          `你是状态组复核器。任务：根据【当前剧情】重新判断状态组「${label}」的最新值，然后调用 recheck_status_group。**只输出工具调用，绝不写叙事。**`,
          '',
          `##「${label}」当前值\n${curJson}`,
          '',
          '## 判断要求',
          '- 按每个子字段的含义填值；只反映剧情已经体现的变化，没变的子字段照抄当前值。',
          '- 列表型组按当前条目数重列；只有剧情明确增删了才增删条目。',
          '- 不要凭空扩写无关数据。',
          '',
          '## 剧情摘要',
          summaryDigest || '（无）',
          '',
          '## 最近剧情原文',
          recent || '（无）',
        ].join('\n');

    const userContent = en
      ? `Call recheck_status_group for "${label}". Tool call only.`
      : `请调用 recheck_status_group 重判「${label}」组。只输出工具调用。`;

    const args = await this._recheckCallOnce('status_custom_recheck', decl, systemText, userContent, signal);
    if (!args || args[groupKey] === undefined || args[groupKey] === null) return null;
    return { value: args[groupKey], label };
  }
}

// 合并 mixin 到 AIService.prototype（与 npcRecheckSubagent.js 同形）。
(function _applyPlayerStatusRecheckMixin() {
  if (typeof AIService === 'undefined') {
    console.warn('[StatusRecheck] AIService 未定义，mixin 跳过（加载顺序问题）');
    return;
  }
  const proto = _AIServicePlayerStatusRecheckMixin.prototype;
  Object.getOwnPropertyNames(proto).forEach(name => {
    if (name === 'constructor') return;
    AIService.prototype[name] = proto[name];
  });
})();

if (typeof window !== 'undefined') {
  window.RECHECK_STATUS_LOCATION_DECL = RECHECK_STATUS_LOCATION_DECL;
  window.RECHECK_STATUS_OBJECTIVE_DECL = RECHECK_STATUS_OBJECTIVE_DECL;
  window.RECHECK_STATUS_DATETIME_DECL = RECHECK_STATUS_DATETIME_DECL;
}
