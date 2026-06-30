// ============================================
// NPC Recheck Subagent（玩家手动「复核」：单 NPC 单字段重判）
// ============================================
// 玩家在 NPC 卡上点某字段的「复核」键 → 一次【独立、即时】的结构化 AI 调用：根据当前剧情
// 重新判断该字段的最新值。不进叙事回合、不推进剧情。分两类：
//   · 位置（状态层，free 字符串）→ _runNpcLocateRecheck；结果由调用方即时写
//     （host applyReactionToState + PZGM 引擎存档 states[id].location，两处同值方能熬过下回合投影）。
//   · 身份字段（认知/职业/性格/外貌/势力…）→ _runNpcFieldRecheck；玩家主动点的 → 直接生效
//     （updateField 写 host 卡 + PZGM 同步引擎存档 card），不走审批。
// 红线：状态字段禁玩家手写——复核值来自 AI 调用（属「AI 写」），不是玩家手填。
// 职责边界：本 subagent 只 resolve + 校验、返回对象或 null；落地（写 store / queueUpdate / 引擎存档）
//   由 npcPanelUI 调用方做（它持有 npcStore / ServiceRegistry）。
// 模型：模块键 npc_locate / npc_field_recheck（推荐模式 flash + thinking off；forced tool → off）。
// 范式照搬 starterSubagent.js（自取 adapter、单工具强制、parse、遥测、stepLog）。
// ============================================

// 工具声明：位置复核（NPC state.current_location 是 free 字符串，非状态栏的 {country,site,spot} 结构）。
const RECHECK_LOCATE_DECL = Object.freeze({
  name: 'recheck_npc_location',
  description:
    '根据【当前剧情】重新判断这个角色【此刻在哪】。只输出结构化数据，不要写任何叙事/散文。',
  parameters: {
    type: 'object',
    properties: {
      current_location: {
        type: 'object',
        description: '该角色此刻所在地点，三段式 country/site/spot（不确定的段填"未知"；缺只能从右往左连续地缺）。剧情明确移动了就给新地点，没动就维持原值；尽量用世界已知地点。',
        properties: {
          country: { type: 'string', description: '国家/区域（= 世界已知实体名；不确定填"未知"）。' },
          site: { type: 'string', description: '地点（不确定填"未知"）。' },
          spot: { type: 'string', description: '具体落点（不确定填"未知"）。' },
        },
        required: ['country', 'site', 'spot'],
      },
      is_present: { type: 'boolean', description: '该角色此刻是否在主角身边 / 同一场景里。' },
      confidence: { type: 'number', description: '把握度 0–1。剧情线索不足时给低值，别硬猜。' },
      reason: { type: 'string', description: '判断依据（引用剧情）。' },
    },
    required: ['current_location', 'confidence'],
  },
});

// 工具声明：通用身份字段复核（认知/职业/性格/外貌/衣着/势力…）。
const RECHECK_FIELD_DECL = Object.freeze({
  name: 'recheck_npc_field',
  description:
    '根据【当前剧情】重新判断这个角色某个档案字段的最新值。只输出结构化数据，不要写任何叙事/散文。',
  parameters: {
    type: 'object',
    properties: {
      new_value: {
        type: 'string',
        description: '该字段根据当前剧情应有的最新值（一段简洁人话，与字段含义匹配）。若无需改动，照抄当前值。',
      },
      changed: { type: 'boolean', description: '相比当前值是否有实质变化。' },
      reason: { type: 'string', description: '判断依据（引用剧情）。' },
    },
    required: ['new_value', 'changed'],
  },
});

// 工具声明：念头复核（NPC state.recent_thoughts / 引擎 npcState.states[id].memory 的内心独白）。
// 只产【一条】此刻最新的念头 → 落地时整个【替换】掉那串累积旧念头（清残留 + 收住无上限累积）。
const RECHECK_THOUGHT_DECL = Object.freeze({
  name: 'recheck_npc_thought',
  description:
    '根据【当前剧情】重新判断这个角色【此刻心里最新的一个念头】。只输出结构化数据，不要写任何叙事/散文。',
  parameters: {
    type: 'object',
    properties: {
      inner_thought: {
        type: 'string',
        description:
          '该角色此刻心里最新的一个念头：第一人称内心独白，一句话，贴合 TA 当前处境与最近发生的事。不复述剧情、不写旁白、不替玩家做选择。',
      },
      reason: { type: 'string', description: '判断依据（引用剧情）。' },
    },
    required: ['inner_thought'],
  },
});

class _AIServiceNpcRecheckMixin {
  /** 复核用的剧情上下文：摘要（summaryService）+ 最近 N 条原文（chatHistory），与主 iter 同源口径。 */
  _buildRecheckNarrative(en, recentN = 4) {
    const sums = (window.summaryService && typeof window.summaryService.getSummaries === 'function')
      ? (window.summaryService.getSummaries() || [])
      : [];
    const summaryDigest = Array.isArray(sums) ? sums.filter(Boolean).join('\n') : '';
    const hist = (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory))
      ? chatHistory
      : (Array.isArray(window.chatHistory) ? window.chatHistory : []);
    const uLab = en ? 'Player' : '玩家';
    const aLab = en ? 'GM' : 'AI';
    const recent = hist
      .slice(-recentN)
      .map(m => `[${m && m.sender === 'user' ? uLab : aLab}]: ${(m && m.text) || ''}`)
      .join('\n\n');
    return { summaryDigest, recent };
  }

  /**
   * 一次性结构化调用的公共骨架（取 adapter → 强制单工具 → callAPI → parse → 遥测/stepLog）。
   * 返回工具调用的 args 对象，或 null（调用/解析失败、用户取消）。范式同 starter。
   * @returns {Promise<Object|null>}
   */
  async _recheckCallOnce(module, toolDecl, systemText, userContent, signal) {
    if (!this.reactLoop) {
      console.warn(`[Recheck] reactLoop 未初始化，跳过 ${module}`);
      return null;
    }
    let adapter;
    try {
      adapter = this._getAdapter(module, AI_REQUEST_SCOPED);
    } catch (e) {
      console.warn(`[Recheck] 无法构建 ${module} adapter:`, e?.message || e);
      return null;
    }
    if (!adapter) return null;

    const adapterTools = this.reactLoop.buildAdapterTools([toolDecl], adapter);
    const temperature = this.getModuleTemperature(module, 0.6, AI_REQUEST_SCOPED);
    const family = adapter?.protocolFamily || adapter?.provider || 'gemini';
    const userMessage =
      family === 'gemini'
        ? { role: 'user', parts: [{ text: userContent }] }
        : family === 'anthropic'
          ? { role: 'user', content: [{ type: 'text', text: userContent }] }
          : { role: 'user', content: userContent };

    const { payload, url } = adapter.buildPayload(
      [userMessage],
      [{ text: systemText, cacheable: false, tag: module }],
      adapterTools,
      // forced tool：用 {name} 对象形（字符串 'required' 不被 adapter 识别 → 落 'auto' 等于没强制）。
      // 强制工具 ⇒ thinking 必须 off（DeepSeek 强制工具拒绝 thinking enabled）。
      { temperature, thinking: 'off', toolChoice: { name: toolDecl.name } }
    );

    const stepLog = {
      step: 'recheck',
      phase: module,
      model: this.getModelForModule(module, AI_REQUEST_SCOPED),
      provider: adapter.getProviderLabel(),
      request: this._cloneSerializable(payload),
      systemPartsDebug: [
        { order: 1, name: `${module}_system_prompt`, length: (systemText || '').length, status: 'active' },
      ],
      url: typeof url === 'string' ? url.replace(/key=[^&]+/, 'key=***') : null,
    };
    if (this.lastPayload?.steps) this.lastPayload.steps.push(stepLog);
    this._markStepStarted?.(stepLog);

    const _t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    let apiResult;
    try {
      apiResult = await adapter.callAPI(url, payload, null, signal || this._currentAbortSignal);
      stepLog.response = apiResult?.raw || null;
      stepLog.responseBody = apiResult;
      stepLog.metrics = apiResult?.metrics || null;
      this._markStepSucceeded?.(stepLog);
      this._trackSubagentCall({
        subsystem: module,
        parentRequestId: null,
        provider: adapter.getProviderLabel(),
        model: this.getModelForModule(module, AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        metrics: apiResult?.metrics || null,
        ok: true,
      });
    } catch (e) {
      this._markStepFailure?.(stepLog, e, {
        phase: module, module, provider: adapter.getProviderLabel(),
        model: this.getModelForModule(module, AI_REQUEST_SCOPED), url,
      });
      this._trackSubagentCall({
        subsystem: module, parentRequestId: null, provider: adapter.getProviderLabel(),
        model: this.getModelForModule(module, AI_REQUEST_SCOPED),
        durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
        ok: false, errorMessage: e?.message || String(e),
      });
      return null;
    }

    const parsed = adapter.parseToolCalls(apiResult.raw);
    const calls = parsed?.needsRecovery ? parsed.recoveredCalls : (parsed?.toolCalls || []);
    const call = (calls || []).find(c => c && c.name === toolDecl.name) || (calls || [])[0];
    stepLog.toolCalls = call ? [{ name: call.name, args: call.args, success: true }] : [];
    return (call && call.args) ? call.args : null;
  }

  /**
   * 位置复核：根据当前剧情重判某 NPC 此刻在哪。返回 { location, is_present, confidence, reason } 或 null。
   * @param {string} npcId
   * @param {AbortSignal|null} signal
   */
  async _runNpcLocateRecheck(npcId, signal = null) {
    const npc = window.npcStore?.get?.(npcId);
    if (!npc) return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const name = npc.card?.name || npc.name || npcId;
    const _curRaw = npc.state && npc.state.current_location;
    const curLoc = _curRaw
      ? (window.locationTriad ? window.locationTriad.formatTriad(_curRaw) : _curRaw)
      : (en ? '(unknown)' : '（未知）');
    const { summaryDigest, recent } = this._buildRecheckNarrative(en);
    const pool = (typeof this._readStarterSitesPool === 'function') ? this._readStarterSitesPool() : [];
    const poolText = pool.length
      ? pool.map((s, i) => `  ${i + 1}. ${s.fullPath}`).join('\n')
      : (en ? '  (no structured site pool)' : '  （无结构化地点池）');

    const systemText = en
      ? [
          'You are an NPC-location rechecker. Task: from the CURRENT story, re-judge WHERE this character is right now, then call recheck_npc_location. **Only emit the tool call — never write narrative.**',
          '',
          '## Character',
          `${name} (location currently on the card: ${curLoc})`,
          '',
          '## Rules',
          '- Output location as three segments country/site/spot (fill "未知" for any segment you cannot tell; missing segments only from the right).',
          '- Judge their location ONLY from what the story has already established. If the story clearly moved them, give the new place; if not, keep the current one.',
          '- Prefer the world\'s known places (below), but if they are at a specific spot, state it faithfully.',
          '- If clues are thin, give a LOW confidence — do not guess.',
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
          '你是 NPC 位置复核器。任务：根据【当前剧情】重新判断这个角色此刻【在哪】，然后调用 recheck_npc_location。**只输出工具调用，绝不写叙事。**',
          '',
          '## 角色',
          `${name}（当前卡上记录的位置：${curLoc}）`,
          '',
          '## 判断要求',
          '- 位置输出三段 country/site/spot（拿不准的段填"未知"，缺只能从右往左连续地缺）。',
          '- 只依据剧情【已经发生】的事实判断 TA 此刻所在地点：剧情明确移动了就给新地点，没动就维持原值。',
          '- 地点尽量用世界已知地点（见下方），但角色确在某具体落点时可如实写。',
          '- 线索不足时给【低 confidence】，别硬猜。',
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
      ? `Call recheck_npc_location for "${name}". Tool call only.`
      : `请调用 recheck_npc_location 重新判断「${name}」此刻在哪。只输出工具调用。`;

    const args = await this._recheckCallOnce('npc_locate', RECHECK_LOCATE_DECL, systemText, userContent, signal);
    const _loc = args && args.current_location;
    if (!_loc || typeof _loc !== 'object') return null;
    const triad = window.locationTriad ? window.locationTriad.toTriad(_loc) : _loc;
    return {
      location: triad, // 三段对象（落地经 applyReactionToState/引擎存档；§2.1）
      is_present: typeof args.is_present === 'boolean' ? args.is_present : null,
      confidence: typeof args.confidence === 'number' ? args.confidence : 1,
      reason: typeof args.reason === 'string' ? args.reason : '',
    };
  }

  /**
   * 身份字段复核：根据当前剧情重判某 NPC 某个档案字段。返回 { newValue, changed, reason } 或 null。
   * @param {string} npcId
   * @param {string} fieldKey  - 字段键（如 cognitive_state / appearance / faction）
   * @param {string} fieldLabel - 字段显示名（取自 panel schema / _getFieldLabel）
   * @param {string} currentValue - 当前值
   * @param {AbortSignal|null} signal
   */
  async _runNpcFieldRecheck(npcId, fieldKey, fieldLabel, currentValue, signal = null) {
    const npc = window.npcStore?.get?.(npcId);
    if (!npc) return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const name = npc.card?.name || npc.name || npcId;
    const { summaryDigest, recent } = this._buildRecheckNarrative(en);
    const cur = (currentValue == null || currentValue === '')
      ? (en ? '(empty)' : '（空）')
      : String(currentValue);
    const label = fieldLabel || fieldKey;

    const systemText = en
      ? [
          'You are an NPC-profile rechecker. Task: from the CURRENT story, re-judge the latest value of ONE profile field of this character, then call recheck_npc_field. **Only emit the tool call — never write narrative.**',
          '',
          '## Character & field',
          `Character: ${name}`,
          `Field: "${label}"`,
          `Current value: ${cur}`,
          '',
          '## Rules',
          '- Judge ONLY from what the story has already established (injury changing appearance, a change of clothes, a shift in self-perception, a change of faction, etc.).',
          '- If it changed, give the new value (concise, matching the field\'s meaning) and set changed=true. If not, copy the current value and set changed=false.',
          '- Do NOT invent unrelated lore; only reflect changes the story already shows.',
          '',
          '## Story summary',
          summaryDigest || '(none)',
          '',
          '## Recent story',
          recent || '(none)',
        ].join('\n')
      : [
          '你是 NPC 档案复核器。任务：根据【当前剧情】重新判断这个角色【某一个】档案字段的最新值，然后调用 recheck_npc_field。**只输出工具调用，绝不写叙事。**',
          '',
          '## 角色与字段',
          `角色：${name}`,
          `字段：「${label}」`,
          `当前值：${cur}`,
          '',
          '## 判断要求',
          '- 只依据剧情【已发生】的事实判断该字段是否变了（如外貌受伤、换装、认知转变、势力变动……）。',
          '- 变了就给最新值（一段简洁人话，与字段含义匹配）并把 changed 设为 true；没变就照抄当前值、changed 设为 false。',
          '- 不要凭空扩写无关设定，只反映剧情已经体现的变化。',
          '',
          '## 剧情摘要',
          summaryDigest || '（无）',
          '',
          '## 最近剧情原文',
          recent || '（无）',
        ].join('\n');

    const userContent = en
      ? `Call recheck_npc_field for "${name}", field "${label}". Tool call only.`
      : `请调用 recheck_npc_field 重新判断「${name}」的「${label}」字段。只输出工具调用。`;

    const args = await this._recheckCallOnce('npc_field_recheck', RECHECK_FIELD_DECL, systemText, userContent, signal);
    if (!args || typeof args.new_value !== 'string' || !args.new_value.trim()) return null;
    const newValue = args.new_value.trim();
    return {
      newValue,
      // 模型说没变、或新值与当前值实质相同 → 视为无变化（调用方据此不入待审批、提示「无需更新」）。
      changed: args.changed !== false && newValue !== String(currentValue ?? '').trim(),
      reason: typeof args.reason === 'string' ? args.reason : '',
    };
  }

  /**
   * 念头复核：根据当前剧情重算某 NPC 此刻最新的【一条】念头。返回 { thought, reason } 或 null。
   * 落地（写 host recent_thoughts + REPLACE 引擎 memory）由 npcPanelUI 调用方做。
   * @param {string} npcId
   * @param {AbortSignal|null} signal
   */
  async _runNpcThoughtRecheck(npcId, signal = null) {
    const npc = window.npcStore?.get?.(npcId);
    if (!npc) return null;
    const en = this._getGamePromptLanguage?.() === 'en';
    const name = npc.card?.name || npc.name || npcId;
    // 当前最新念头（取末条非空）作为参照
    const thoughts = Array.isArray(npc.state?.recent_thoughts) ? npc.state.recent_thoughts : [];
    let curThought = '';
    for (let i = thoughts.length - 1; i >= 0; i--) {
      const t = thoughts[i];
      if (t && typeof t.thought === 'string' && t.thought.trim()) { curThought = t.thought.trim(); break; }
    }
    const cur = curThought || (en ? '(none yet)' : '（暂无）');
    const persona = npc.card?.personality || npc.card?.cognitive_state || '';
    const { summaryDigest, recent } = this._buildRecheckNarrative(en);

    const systemText = en
      ? [
          'You are an NPC inner-thought rechecker. Task: from the CURRENT story, re-judge this character\'s single most recent inner thought right now, then call recheck_npc_thought. **Only emit the tool call — never write narrative.**',
          '',
          '## Character',
          `${name}`,
          persona ? `Persona: ${persona}` : '',
          `Latest thought on record: ${cur}`,
          '',
          '## Rules',
          '- Produce ONE first-person inner monologue line that fits where the character is and what just happened — this REPLACES any stale accumulated thoughts.',
          '- Ground it ONLY in what the story has already established; do not invent unrelated lore and do not advance the plot.',
          '- Stay in this character\'s voice/personality. Do not make choices on the player\'s behalf.',
          '',
          '## Story summary',
          summaryDigest || '(none)',
          '',
          '## Recent story',
          recent || '(none)',
        ].filter(Boolean).join('\n')
      : [
          '你是 NPC 念头复核器。任务：根据【当前剧情】重新判断这个角色【此刻最新的一个念头】，然后调用 recheck_npc_thought。**只输出工具调用，绝不写叙事。**',
          '',
          '## 角色',
          `${name}`,
          persona ? `人设：${persona}` : '',
          `当前记录的最新念头：${cur}`,
          '',
          '## 判断要求',
          '- 产出【一条】第一人称内心独白，贴合 TA 此刻的处境和刚发生的事——这条会整个【替换】掉之前累积的旧念头。',
          '- 只依据剧情【已经发生】的事实，别凭空扩写无关设定，也别推进剧情。',
          '- 保持该角色的口吻与性格。不要替玩家做选择。',
          '',
          '## 剧情摘要',
          summaryDigest || '（无）',
          '',
          '## 最近剧情原文',
          recent || '（无）',
        ].filter(Boolean).join('\n');

    const userContent = en
      ? `Call recheck_npc_thought for "${name}". Tool call only.`
      : `请调用 recheck_npc_thought 重新判断「${name}」此刻最新的念头。只输出工具调用。`;

    const args = await this._recheckCallOnce('npc_field_recheck', RECHECK_THOUGHT_DECL, systemText, userContent, signal);
    if (!args || typeof args.inner_thought !== 'string' || !args.inner_thought.trim()) return null;
    return {
      thought: args.inner_thought.trim(),
      reason: typeof args.reason === 'string' ? args.reason : '',
    };
  }
}

// 合并 mixin 到 AIService.prototype（与 starterSubagent.js / npcIntroAuditSubagent.js 同形）。
(function _applyNpcRecheckMixin() {
  if (typeof AIService === 'undefined') {
    console.warn('[Recheck] AIService 未定义，mixin 跳过（加载顺序问题）');
    return;
  }
  const proto = _AIServiceNpcRecheckMixin.prototype;
  Object.getOwnPropertyNames(proto).forEach(name => {
    if (name === 'constructor') return;
    AIService.prototype[name] = proto[name];
  });
})();

if (typeof window !== 'undefined') {
  window.RECHECK_LOCATE_DECL = RECHECK_LOCATE_DECL;
  window.RECHECK_FIELD_DECL = RECHECK_FIELD_DECL;
  window.RECHECK_THOUGHT_DECL = RECHECK_THOUGHT_DECL;
}
