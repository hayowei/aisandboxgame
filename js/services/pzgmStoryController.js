// PZGM 剧情模式控制器 —— 剧情模式新 GM 大脑（PZGM 引擎岛）的游戏侧宿主。
//
// 角色分工（沿用 PZWC「大脑/皮」范式）：
//   - 引擎（window.pzgmEngine，dist/pzgm-engine.js 岛）：PZGM 内核负责一整回合的全部 GM 逻辑
//     —— 叙事流式、检定掷骰（引擎掷·公式锚卡·全公开）、NPC 反应、SMS、世界扩展、状态结算、
//     选项，产出纯 JSON { turnResult, nextSave }。
//   - 本控制器：引擎的浏览器 host/io 实现 + 游戏侧编排。把引擎的 emit 事件流渲染进现有聊天/
//     状态栏/NPC/短信皮，把 BYOK key 从游戏设置喂成 adapter，把 turnResult 喂进 aiService 的
//     side-channel（让下游 processAIResponse / buildTurnResult / autoSaveGame 原样工作），把
//     nextSave 投影进现有 store 并经 ServiceRegistry('pzgmState') 随存档持久化。
//
// 接入点（灰度）：aiService.generateResponse 在 StoryEngineFlag.isPzgm() 为真时把整回合委托给
//   本控制器的 runTurn（取代 _runAgentWorkflow iter1–9）；flag 默认关 → react.js 老路径字节不动。
//
// 约束：
//   - 引擎 runTurn 无模块级单例状态（全参数注入），但同一存档的回合必须串行——本控制器由
//     generateResponse（被 chatCore isSending 锁包裹）单线进入，另加轻量 running 守卫。
//   - 滚动一律走 window.scrollController（主聊天区滚动锁铁律）；本文件绝不直接写 scrollTop。
//   - 顶层只暴露 window.pzgmStoryController 单一对象（防发布 bundle 顶层重名互覆）。
//
// v1 范围（首批可灰度 dogfood，后续精修项见各处 [v1] 标注）：叙事流式 + 全公开掷骰行 + 选项 +
//   状态栏结算 + NPC 反应/建卡 + 短信 + 物品（镜像进现有审批队列）+ 引擎存档持久化。

(function () {
  'use strict';

  // ---------- 状态 ----------
  const state = {
    running: false,
    abortController: null,
    pendingPlayerCheck: false, // 🎲 显式检定（diceMode UI 的骰子按钮置位，消费即清）
  };

  // 引擎 stage → 调试/迭代链友好名（chain 头部分段标签 + debug 侧栏分段名）。
  // 引擎 host.emit('tool_call', {stage,...}) 的 stage 取自 turnState.currentStage（open/exec/continue/
  // closeout）；NPC/memory/gate 走服务端 aux，不发 tool_call，故不进迭代链（其成本在 metrics.subagents）。
  const STAGE_LABELS = {
    open: '写作·开场', exec: '代查·检查点', continue: '写作·承接',
    closeout: '收尾·状态/选项', npc: 'NPC 反应', memory: '记忆', gate: '回合闸', S0: '准备',
    presence_triage: '在场判定',
  };

  function engine() {
    return window.pzgmEngine || null;
  }

  // ---------- 引擎存档 store（ServiceRegistry 'pzgmState'）----------
  // nextSave 是 PZGM 的权威引擎状态（vars/narrativeLog/chapters/npcState/sms/customStatus/…）。
  // 注册成存档源 → 随 autoSaveGame 一并落库、随 loadGame 一并恢复（同 customStatusData 等的生命周期）。
  // 老 react.js 存档无此键 → restore 缺省 clear → 首个 PZGM 回合从空档（turn 1）起；
  // 中途换脑的老局从新档开始（P6 老存档过渡为后续决策，见 plan）。
  //
  // 引擎存档单值。回滚由「重新生成末回合 → restoreAll(上一份完整存档快照)」统一处理
  // （chatActions.regenerateMessage + chatCore._priorStores），引擎态随 restoreAll → 本 store.restore()
  // 退回 N-1，下次 runTurn 读 get() 即接上 N-1，无需 per-turn history / rollbackTo。
  const pzgmStateStore = {
    _save: null,
    get() {
      return this._save;
    },
    set(save) {
      this._save = save || null;
    },
    getSaveData() {
      if (this._save) return { current: this._save };
      // 新 PZGM 局还没跑过回合时 _save 仍为 null —— 但这局确实归 PZGM 管。落一个轻量引擎标记，
      // 否则「新建存档 → 还没玩就载入」时 selectForSave 查不到 pzgmState、把它误判成老 react 局，
      // 骰子栏 / 新引擎全部丢失（见 storyEngineFlag.selectForSave）。flag 由 startNewGame 在初次 saveGame 前置好。
      try {
        if (window.StoryEngineFlag?.get?.() === 'pzgm') {
          return { current: null, engine: 'pzgm' };
        }
      } catch (_) { /* ignore */ }
      return null;
    },
    restore(data) {
      if (!data) {
        this._save = null;
        return;
      }
      // 新形态 {current}（老档可能带已弃用的 history，忽略即可）；兼容旧形态（data 直接是 save）
      if (data.current !== undefined || data.history !== undefined) {
        this._save = data.current ? JSON.parse(JSON.stringify(data.current)) : null;
      } else {
        this._save = JSON.parse(JSON.stringify(data));
      }
    },
    clear() {
      this._save = null;
    },
  };
  try {
    if (typeof ServiceRegistry !== 'undefined' && typeof ServiceRegistry.register === 'function') {
      ServiceRegistry.register('pzgmState', pzgmStateStore);
    } else if (window.ServiceRegistry?.register) {
      window.ServiceRegistry.register('pzgmState', pzgmStateStore);
    }
  } catch (e) {
    console.warn('[pzgm] ServiceRegistry 注册失败（引擎存档不随档持久化）:', e);
  }

  // ---------- BYOK：游戏设置 → PZGM adapter ----------
  // PZGM 没有 PZWC 那套 llmConfig 单例——adapter 由这里用 getAdapter(providerDef, model, key) 直接
  // 构造后注入 runTurn。沿用 'react' 模块的服务商/模型/key（与 generateResponse 上方的 key 预检同源，
  // 玩家无需另配模块）。key 闭包在 adapter 内、永不回显。
  function buildAdapter() {
    const eng = engine();
    const ai = window.aiService;
    if (!eng) return { error: 'PZGM 引擎未加载（dist/pzgm-engine.js）' };
    if (!ai) return { error: 'aiService 未加载' };
    const providerId = ai.getProviderForModule('react');
    const model = ai.getModelForModule ? ai.getModelForModule('react') : null;
    const key = ai.getApiKeyForModule('react');
    const thinking =
      typeof ai.getModuleThinking === 'function' ? ai.getModuleThinking('react') : 'off';
    if (!providerId || !model) return { error: '剧情模块还没配置模型——到「设置 → API 设置」选服务商和模型。' };
    if (!key) return { error: '剧情模块还没配置 API key——到「设置 → API 设置」填一个。' };
    const customs =
      (typeof ai.getCustomProviders === 'function' ? ai.getCustomProviders() : null) ||
      (ai.config && ai.config.customProviders) ||
      [];
    let providerDef = null;
    try {
      providerDef = eng.providers.resolveProvider(providerId, customs);
    } catch (e) {
      return { error: '解析服务商失败：' + ((e && e.message) || e) };
    }
    if (!providerDef) return { error: '未知服务商 ' + providerId };
    let adapter;
    try {
      adapter = eng.adapters.getAdapter(providerDef, model, key);
    } catch (e) {
      return { error: '构造 adapter 失败：' + ((e && e.message) || e) };
    }
    return { adapter, providerId, model, thinking };
  }

  // ---------- 骰子三档 ----------
  function readDiceMode() {
    try {
      const v = localStorage.getItem('pzgm_dice_mode');
      return ['always', 'ai', 'never'].includes(v) ? v : 'ai';
    } catch (_) {
      return 'ai';
    }
  }

  // ---------- 玩家自定义四档难度 DC（设置页可改）----------
  // 读 localStorage['pzgm_tier_dc']（{easy,medium,hard,extreme}）→ 注入 runConfig.tierDC，
  // 引擎裸检定/公式降级时按此查表（modEngine.resolveTierDC）。完全自由 1–30、不强制递增。
  // 缺省/非法/缺键回退默认；返回 null 表示「无自定义」→ 引擎用内核默认常量（零行为变化）。
  function readTierDC() {
    try {
      const raw = localStorage.getItem('pzgm_tier_dc');
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o !== 'object') return null;
      const out = {};
      for (const k of ['easy', 'medium', 'hard', 'extreme']) {
        const v = Math.round(Number(o[k]));
        if (Number.isInteger(v)) out[k] = Math.max(1, Math.min(30, v));
      }
      return Object.keys(out).length ? out : null;
    } catch (_) {
      return null;
    }
  }

  // ---------- 输入装配（game options → PZGM options）----------
  function assembleOptions(actionClassification, requestedCheck) {
    const options = {};
    // 玩家所选选项（结构化直传；URI-encoded payload 优先，回退纯文本）
    const ac = actionClassification || {};
    if (ac.selectedChoicePayload) {
      try {
        options.chosenChoice = JSON.parse(decodeURIComponent(ac.selectedChoicePayload));
      } catch (_) {
        /* 解析失败 → 不带 chosenChoice，playerInput 仍承载文本 */
      }
    }
    // OOC / 导演 tag 的注入改由 runTurn 处理（splitDirectorOoc）：导演指令挂到 playerInput 末尾（[!CRITICAL]、
    // 位置更靠后更听话），玩家手写的 freehand OOC 留中段 directives.ooc 槽。见 runTurn 内 _dsplit。
    // 🎲 显式检定（diceMode='never' 时引擎自行忽略并记 info）
    if (requestedCheck) options.playerRequestedCheck = true;
    // 「是否在玩家身边」三档覆盖（活世界 §2）：玩家手动 present/absent 传给引擎 detectPresentNpcs；
    // 'auto' 不入 map（引擎走名字命中/AI 判定）。空 map 不传。
    try {
      const ns = window.npcStore;
      if (ns && typeof ns.getPresenceMap === 'function') {
        const pm = ns.getPresenceMap();
        if (pm && Object.keys(pm).length) options.presence = pm;
      }
      // 删除集（活世界 §2）：把玩家删除的 NPC 移出引擎活名册/在场/简报。
      if (ns && typeof ns.getDeletedIds === 'function') {
        const del = ns.getDeletedIds();
        if (del && Object.keys(del).length) options.deletedIds = del;
      }
    } catch (_) { /* 取不到 presence/deletedIds 不阻断回合 */ }
    return options;
  }

  // ---------- OOC 拆分：导演 tag → playerInput 末尾（更靠后更听话）；玩家手写 freehand → 交子模块归一化 ----------
  // 从【原始串】拆（首发=ooc.candidates，重生=ooc.forcedRaw，两者都含原始「导演：A · B」），保证重生复用一致。
  //   · directorBlock：[!CRITICAL] 多行块（已内联扩写），挂到 playerInput 末尾。
  //   · freehandCandidates：玩家手写 OOC 候选（数组），交 _runOocWorkflow 归一化+反问 → directives.ooc 中段槽。
  //     导演标签不进子模块/反问——它们只走 directorBlock 内联扩写。
  function splitDirectorOoc(ooc, lang) {
    const empty = { directorBlock: '', freehandCandidates: [] };
    if (!ooc) return empty;
    const S = (typeof window !== 'undefined' && window.DIRECTOR_TAG_SENTINELS) || null;
    const px = (S && S.prefix) || { zh: '导演', en: 'Director' };
    const isDir = (s) => {
      const t = String(s || '').trim();
      return t.startsWith(px.zh + '：') || t.toLowerCase().startsWith((px.en + ':').toLowerCase());
    };
    let raws = [];
    if (Array.isArray(ooc.candidates) && ooc.candidates.length) raws = ooc.candidates;
    else if (Array.isArray(ooc.forcedRaw) && ooc.forcedRaw.length) raws = ooc.forcedRaw;
    else if (ooc.forcedNormalized) raws = [ooc.forcedNormalized]; // 老数据兜底：当 freehand 处理
    const expand = (s) => (window.expandDirectorTokens ? window.expandDirectorTokens(s, lang) : s);
    const directorBlock = raws.filter(isDir).map(expand).join('\n\n');
    const freehandCandidates = raws.filter((s) => !isDir(s)).map((s) => String(s).trim()).filter(Boolean);
    return { directorBlock, freehandCandidates };
  }

  // ---------- 世界事件 directive 桥（paceEngine → directives.gm；回执 → 标记已播报）----------
  // react.js 在 prompt-gm.js:_callGM 调 paceEngine.generateDirective，把按时间线该播报的世界事件
  // （BROADCAST / FORESHADOW）注入叙事；PZGM 引擎有对应 `d.gm` 槽（gmPrompt.js:130「世界事件指令」）+
  // directive_receipts 回执，但控制器之前从不转发 directives.gm → PZGM 模式下「按时间线把世界事件播报进
  // 叙事」整条静默丢失（功能回归，非纯影子）。本桥补上（plan B1#4 的宿主侧补桥版；治本=搬进内核 C-4）。
  //
  // 世界事件播报（BROADCAST/FORESHADOW）→ directives.gm；场景节奏（FORCE/SUGGEST_*）→ 独立 directives.pacing
  // 槽（档位由 paceEngine.getPacingNudge 的 FORWARD 控制；旧 react 那套节奏判定本就每回合在算，此前被丢弃）。
  // 不带开场引导（PZGM 走 directives.opening）。返回 { gm:[{id,text}], eventToReport, pacing } 或 null（事件+节奏都空）。
  function buildWorldEventDirective(openCtx, turnNumber) {
    try {
      const gce = window.paceEngine;
      if (!gce || typeof gce.generateDirective !== 'function') return null;
      const ts = (typeof timelineService !== 'undefined' && timelineService) || window.timelineService || null;
      const lt = (typeof locationTracker !== 'undefined' && locationTracker) || window.locationTracker || null;
      const requestContext = {
        currentTime: ts && typeof ts.getCurrentDate === 'function' ? ts.getCurrentDate() : null,
        currentLocation: lt && typeof lt.getCurrentLocation === 'function' ? lt.getCurrentLocation() : null,
        turnsAtLocation: lt && typeof lt.getTurnsAtLocation === 'function' ? lt.getTurnsAtLocation(turnNumber) : 0,
        scenesToday: lt && typeof lt.getScenesToday === 'function' ? lt.getScenesToday() : 1,
        currentTurn: turnNumber,
        worldCardId: window.worldCardManager?.getActiveCardId?.() || null,
        openingTimeRange: openCtx?.range || null,
        openingEvent: openCtx?.selectedEvent || null,
      };
      const result = gce.generateDirective(requestContext);
      const dir = result && result.directive;
      if (!dir) return null;
      const action = String(dir.action || '');
      const gm = [];
      // (a) 世界事件条目（BROADCAST/FORESHADOW）——仅当本回合确有事件。恒为 index 0，下方 A2b 据此定位。
      let text = '';
      if (dir.event_summary) {
        if (action.includes('BROADCAST_EVENT')) {
          text = `近期世界动态：${dir.event_summary}。可通过传闻、布告或 NPC 对话自然带出，也可忽略。`;
        } else if (action.includes('FORESHADOW')) {
          text = `即将发生的事件：${dir.event_summary}。可通过环境暗示或 NPC 担忧等方式隐约透露。`;
        }
      }
      if (text) {
        const id = (result.eventToReport && result.eventToReport.eventId) || `gm_turn_${turnNumber}`;
        gm.push({ id, text });
      }
      // (b) 场景节奏条目——独立于是否有事件；无事件的停滞回合（常态）也触发。复用 paceEngine 同一批文案，
      //     走独立 directives.pacing 槽（无 eventId → 不进播报去重，每个停滞回合都重新触发，这正是要的）。
      const pacing = (typeof gce.getPacingNudge === 'function') ? (gce.getPacingNudge(dir) || '') : '';
      if (!gm.length && !pacing) return null; // 四态：event-only / pacing-only / both / neither，仅 neither → null
      return { gm, eventToReport: result.eventToReport || null, pacing };
    } catch (e) {
      console.warn('[pzgm] 世界事件 directive 桥失败（不阻断回合）:', e);
      return null;
    }
  }

  // 回合后：消费引擎 directive_receipts，把 narrated 的世界事件标记为已播报（否则每回合重播同一事件）。
  function applyDirectiveReceipts(tr, pendingEvent) {
    try {
      if (!pendingEvent || !pendingEvent.eventId) return;
      const receipts = (tr && Array.isArray(tr.directive_receipts)) ? tr.directive_receipts : [];
      const narrated = receipts.some((r) => r && r.id === pendingEvent.eventId && r.status === 'narrated');
      const gce = window.paceEngine;
      if (narrated && gce && typeof gce.markEventBroadcasted === 'function') {
        gce.markEventBroadcasted(pendingEvent.eventId, pendingEvent.turn, pendingEvent.type, null);
      }
    } catch (e) {
      console.warn('[pzgm] directive 回执处理失败:', e);
    }
  }

  function playerInputFrom(actionClassification, history) {
    const ac = actionClassification || {};
    if (ac.actionInputText) return String(ac.actionInputText);
    if (ac.selectedChoiceText) return String(ac.selectedChoiceText);
    // 回退：history 里最后一条用户消息
    if (Array.isArray(history)) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i] && history[i].sender === 'user' && history[i].text) return String(history[i].text);
      }
    }
    return '';
  }

  // ---------- 全公开掷骰行（reload 后 panel_narrative 只重渲 markdown、不重建掷骰卡 → 这行文本是读档
  //   回看时唯一可见的掷骰记录，5 种形态都要正确）----------
  // ⚠️ 引擎 rollResult 的 kind 只有三值 d20 / coin / ai_score（modEngine.js）；chance 与 draw 都伪装成
  //   kind:'d20'，靠 check_kind==='chance' 和 draw_result!==undefined 二级判别（对齐 cli.js rollReport）。
  function formatRoll(result) {
    if (!result || typeof result !== 'object') return '';
    const r = result;
    // 硬币
    if (r.kind === 'coin') {
      return `🪙 硬币 · ${r.face === 'hit' || r.success ? '正面' : '反面'}`;
    }
    // ai_score（阈值可空 → 仅记录评分）
    if (r.kind === 'ai_score') {
      const range = Array.isArray(r.range) ? `（范围 ${r.range[0]}–${r.range[1]}）` : '';
      const mod = r.modifier ? ` + ${r.modifier}` : '';
      if (r.threshold == null) return `🎯 评分 · ${r.score}${mod}${range}`;
      return `🎯 评分 · ${r.score}${mod} vs 阈值 ${r.threshold}${range} → ${r.success ? '达标' : '未达标'}`;
    }
    // 抽取（kind:'d20' + draw_result）
    if (r.draw_result !== undefined && r.draw_result !== null) {
      return `🎲 抽取 · d20 ${r.d20} → 「${r.draw_result}」`;
    }
    // 概率判定（kind:'d20' + check_kind:'chance'；阈值 = 21 − dc）
    if (r.check_kind === 'chance') {
      const threshold = Number.isFinite(r.dc) ? 21 - r.dc : (r.threshold ?? '?');
      return `🎲 概率 · d20 ${r.d20} vs 阈值 ${threshold} → ${r.success ? '命中' : '未命中'}`;
    }
    // 标准 d20 检定
    const mod = Number(r.modifier) || 0;
    const modStr = mod === 0 ? '' : (mod > 0 ? ` + ${mod}` : ` − ${Math.abs(mod)}`);
    const src = r.modifier_source && r.modifier_source.label ? `（${r.modifier_source.label}）` : '';
    const total = r.total != null ? r.total : (r.d20 + mod);
    return `🎲 检定 · d20 ${r.d20}${modStr}${src} = ${total} vs DC ${r.dc} → ${r.success ? '成功' : '失败'}`;
  }

  // ---------- 开局时间种子（解析卡的开局「此刻」→ 引擎 save.time {year,month,day,hour,minute}）----------
  // PZGM 引擎自管时间：turn 1 若 save 无 time，引擎从默认 year1/01/01/08:00 起 → 开局时间错乱（实测面板
  // 显示「1年1月1日 08:30」）。react.js 由运行时回填 panel datetime；PZGM 须宿主在回合入口把开局此刻种好。
  // 解析链：① 开局时间上下文 selectedTime（frozen/推荐剧情/随机）② frozen_moment.datetime
  //         ③ world_timeline 最后一条事件 time+time_str（无 frozen 的卡兜底，如「废都圣女」）。
  function resolveOpeningEngineTime(openCtx) {
    // ⚠️ timelineService 是顶层 const 全局，**不是** window 属性——浏览器里 window.timelineService===undefined，
    //   必须用裸 timelineService（同 projectTurn 的访问方式）。探针实证：window.timelineService.parseTimeString
    //   缺失 → 解析全 null → 种子失效（「依然是1月1日」根因）。
    const ts = (typeof timelineService !== 'undefined' && timelineService) ||
      (typeof window !== 'undefined' && window.timelineService) || null;
    const toEngineTime = (st) => {
      if (!st || typeof st !== 'object' || !Number.isFinite(st.year)) return null;
      let hour = 0, minute = 0;
      const clock = typeof st.time_str === 'string' ? st.time_str : (typeof st.timeStr === 'string' ? st.timeStr : '');
      const m = clock.match(/^(\d{1,2}):(\d{2})$/);
      if (m) { hour = Number(m[1]); minute = Number(m[2]); }
      else { if (Number.isFinite(st.hour)) hour = st.hour; if (Number.isFinite(st.minute)) minute = st.minute; }
      return {
        year: st.year,
        month: Number.isFinite(st.month) ? st.month : 1,
        day: Number.isFinite(st.day) ? st.day : 1,
        hour, minute,
      };
    };
    // ① 开局时间上下文（aiService._getSelectedOpeningTimeContext 的产物）
    const fromCtx = toEngineTime(openCtx && openCtx.selectedTime);
    if (fromCtx) return fromCtx;
    // ② frozen_moment.datetime
    try {
      const fm = window.worldMeta?.getFrozenMoment?.();
      if (fm && fm.datetime && ts && typeof ts.parseTimeString === 'function') {
        const t = toEngineTime(ts.parseTimeString(fm.datetime));
        if (t) return t;
      }
    } catch (_) {}
    // ③ world_timeline 最后一条事件（双源 world_timeline || timeline，V1 红线）
    try {
      const card = window.worldCardManager?.getActiveCardRaw?.() || window.worldCardManager?.getActiveCard?.();
      const tl = card && card.snapshot && (card.snapshot.world_timeline || card.snapshot.timeline);
      const events = tl && Array.isArray(tl.events) ? tl.events : [];
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        if (e && typeof e.time === 'string' && typeof e.time_str === 'string' && ts && typeof ts.parseTimeString === 'function') {
          const t = toEngineTime(ts.parseTimeString(`${e.time} ${e.time_str}`));
          if (t) return t;
        }
      }
    } catch (_) {}
    return null;
  }

  // ---------- starter 落地（开局主角/地点）----------
  // starter subagent 只 resolve；落卡 / 引擎 save seed / 硬地板由这里做（持有 npcStore / prevSave）。

  /**
   * 把 starter 解析出的主角落进 npcStore（UI）。返回 { heroId, engineCard }：
   *   - existing：复用推荐主角按钮路径（NEW_PREDEFINED 装配厚卡）；引擎无需 seed（作者主角已在
   *     cardJson.character_database → ctx.card.characters，引擎 roster 直接看得到）。engineCard=null。
   *   - generated：直接 add；引擎 roster 看不到现造卡 → 必须把【全量卡】seed 进 prevSave.npcState.cards。
   */
  function landStarterProtagonist(protagonist) {
    const store = window.npcStore;
    if (!store || !protagonist) return null;
    try {
      if (protagonist.source === 'existing' && protagonist.existing_id) {
        if (typeof store.processNpcPanel === 'function') {
          store.processNpcPanel([{ trigger_type: 'NEW_PREDEFINED', id: protagonist.existing_id }], 0, null);
        }
        return { heroId: protagonist.existing_id, engineCard: null };
      }
      if (protagonist.source === 'generated' && protagonist.card) {
        const c = { ...protagonist.card, is_protagonist: true, origin_kind: 'gm' };
        if (!c.id || typeof c.id !== 'string') {
          const base = String(c.name || 'protagonist').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          c.id = base || 'protagonist';
        }
        // store.add 返回 false（id 缺失/撞 deletedIds）= 主角没真落进 store → UI 无 hero 卡 +
        //   openingController 取名回退到 character_database。开局 deletedIds 一般为空、近乎不可达，
        //   但换唯一 id 再落一次兜底，保证 heroId 真有对应卡（引擎那侧由 engineCard seed 另行保证）。
        if (!store.add({ id: c.id, name: c.name, card: c }, 0)) {
          console.warn('[pzgm] 主角落卡失败（id 撞删除/缺失），换 id 重试:', c.id);
          c.id = `${c.id}_pc`;
          store.add({ id: c.id, name: c.name, card: c }, 0);
        }
        return { heroId: c.id, engineCard: c };
      }
    } catch (e) {
      console.warn('[pzgm] landStarterProtagonist 失败:', e);
    }
    return null;
  }

  /** L4 硬地板：starter 彻底失败时，纯代码合成一对合法 {地点 + 主角}，零 LLM、永不失败。
   *  forcedSource==='existing'（玩家点了推荐主角）且有作者主角时，落 existing 而非合成"无名旅人"，
   *  否则会 store.add 出第二个主角、被单主角不变式剥成 is_protagonist:false。 */
  function buildStarterHardFloor(aiService, forcedSource = null, authoredId = null) {
    const sites = (aiService && typeof aiService._readStarterSitesPool === 'function')
      ? aiService._readStarterSitesPool() : [];
    const loc = sites[0] || { entity_id: '', country: '', site: '', spot: '', fullPath: '' };
    if (forcedSource === 'existing' && authoredId) {
      return { location: loc, protagonist: { source: 'existing', existing_id: authoredId }, _fallback: true };
    }
    // 非空默认值：openingController._formatLockedProtagonistSection / 引擎 protagonistSection 会读这些字段，
    // 留空会让开场锚点贫瘠（硬地板本就罕见，给一组通用占位让 Turn 1 有据可依，GM 可在叙事里充实）。
    return {
      location: loc,
      protagonist: {
        source: 'generated',
        card: {
          id: 'protagonist',
          name: '无名旅人',
          origin: '一个契合此地、来历普通的本地人',
          cognitive_state: '初到此地、尚在摸清眼前处境，只想先站稳脚跟',
          initial_status: `独自一人，刚落脚在${loc.spot || loc.site || '此处'}`,
          personality: '谨慎、留心周遭、临场应变',
          dialogue_tone: '话不多、先观察后开口',
        },
      },
      _fallback: true,
    };
  }

  // ---------- 主入口：跑一整回合 ----------
  // 由 aiService.generateResponse 在 flag 开时委托。返回叙事文本字符串（= aiResponse），
  // 其余产物经 aiService.last* side-channel 暴露给 processAIResponse；nextSave 投影进 store。
  async function runTurn(ctx) {
    const { aiService, history, onChunk, actionClassification, ooc, signal } = ctx;
    if (state.running) {
      throw new Error('PZGM 回合已在进行中');
    }
    const built = buildAdapter();
    if (built.error) {
      const e = new Error(built.error);
      e.apiErrorInfo = { errorType: 'config', provider: 'pzgm' };
      throw e;
    }
    const eng = engine();
    const cardJson = window.worldCardManager?.getActiveCardRaw?.() || window.worldCardManager?.getActiveCard?.();
    if (!cardJson) {
      throw new Error('没有激活的世界卡（worldCardManager 为空）');
    }

    state.running = true;
    const requestedCheck = state.pendingPlayerCheck;
    state.pendingPlayerCheck = false;
    let prevSave = pzgmStateStore.get() || {};
    // 主角认知/职业回写引擎(承重·与 gmPrompt.protagonistSection 配套)：引擎不跟踪 cognitive_state/role,
    // 且 GM 提案/手动编辑批准后的值【只落宿主 _npcs[hero].card】(approveField 在 processNpcPanel 的
    // setTimeout 里、晚于上回合 pzgmStateStore.set)。在此(回合开跑前,上回合审批早已落定)把宿主当前权威
    // 值镜像进 prevSave.npcState.cards[hero] → 引擎 findRosterCharacter(hero) 即读到演进后的值,GM 提示词
    // 拿到当前锚点做增量提案。零滞后。注意:只 patch 这两字段、保留 cards[hero] 其余键(new_npc 建的主角
    // 卡其余字段不丢);主角不进在场/离场名单的反应红线与此无关(此处只写 save.cards,不碰 states/名单)。
    try {
      const heroId = typeof window.npcStore?.getProtagonistRuntimeId === 'function'
        ? window.npcStore.getProtagonistRuntimeId() : null;
      const heroCard = heroId ? window.npcStore.get(heroId)?.card : null;
      // 清累积的 cardProposals(只进不出、宿主只消费 tr.npc.card_proposals 本回合版、引擎出队函数
      // applyNpcProposalDecision 已 tree-shake)→ 防存档单调膨胀。本回合引擎会按需重新 push。
      // ⚠ 必须【无论有无主角 NPC 都清】：above_world 锚点世界玩家不表示为 NPC、heroId 恒 null，旧版把这步
      //   嵌在 if(heroId) 内 → 那类世界 cardProposals 永不清、逐回合无界膨胀。修：存档膨胀（review）。
      if (prevSave.npcState && Array.isArray(prevSave.npcState.cardProposals) && prevSave.npcState.cardProposals.length) {
        prevSave.npcState.cardProposals = [];
      }
      if (heroId && heroCard) {
        const ns = prevSave.npcState || (prevSave.npcState = { states: {}, cards: {}, cardProposals: [] });
        ns.cards = ns.cards || {};
        const keys = window.panelSchemaBuilder?.NPC_PROTAGONIST_UPDATABLE_KEYS || ['cognitive_state', 'role'];
        const patched = { ...(ns.cards[heroId] || {}) };
        for (const k of keys) {
          if (heroCard[k] != null && heroCard[k] !== '') patched[k] = heroCard[k];
        }
        ns.cards[heroId] = patched;
      }
    } catch (e) {
      console.warn('[pzgm] 主角认知回写引擎失败(不阻断回合):', e);
    }
    const options = assembleOptions(actionClassification, requestedCheck);
    // 自由打字回合（无预设选项 → assembleOptions 没设 chosenChoice）：接动作分类器补出 type_tag/effect_days，
    // 使引擎拿到 timeHint（turnEngine.js:52）。否则自由打字回合 timeHint=null，时间只受 free_input 上限
    // （30 天）约束、估不出粗时间档。走的是 react.js:_runAgentWorkflow 同一个 classifySingleAction
    // （AI 分类失败内部自动回退本地正则 _buildFallbackChoiceFromText，永不抛、只有空输入才 null）。
    // ⚠️ 这是一次额外的阻塞型 AI 调用（action_classify=v4-flash/off，~亚秒级），加在回合开跑前；react 路它
    //    与主链并行、不计回合费用气泡（未经 _trackSubagentCall），此处镜像同行为：不单独记账，保持两路一致。
    if (!options.chosenChoice && aiService && typeof aiService.classifySingleAction === 'function') {
      const freeText =
        actionClassification && typeof actionClassification.actionInputText === 'string'
          ? actionClassification.actionInputText.trim()
          : '';
      if (freeText) {
        try {
          const classified = await aiService.classifySingleAction(freeText);
          if (classified && classified.type_tag) options.chosenChoice = classified;
        } catch (e) {
          // 分类失败 → 不设 chosenChoice，时间退回 free_input 兜底（回合照常进行，绝不阻断）
          console.warn('[pzgm] 自由打字动作分类失败，时间退回 free_input 兜底:', e?.message || e);
        }
      }
    }
    const playerInput = playerInputFrom(actionClassification, history);
    // 导演 tag → playerInput 末尾（[!CRITICAL]，比中段 OOC 槽更靠后、更听话）；玩家手写 freehand → 见下方 OOC 子模块。
    // directorBlock 纯代码扩写、可早算；freehand 归一化+反问推迟到开局/starter 之后跑（见下方「OOC 归一化+反问」），
    // 这样 OOC stepLog 落在已重置的 lastPayload 上、反问也不挡 turn-1 主角创建。
    const _dlang = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
    const _dsplit = splitDirectorOoc(ooc, _dlang);
    const playerInputForEngine = _dsplit.directorBlock
      ? `${playerInput}\n\n${_dsplit.directorBlock}`
      : playerInput;
    // 开局回合判定：用引擎 save.turnCount===0（引擎尚未跑过任何回合）。**不能**用 currentAiTurnNumber()===0——
    // 开场白本身是 chatHistory 里的一条 ai 消息，turn 1 时 currentAiTurnNumber() 已是 1（traceId `pzgm_0_1`
    // 实证：turnCount=0、aiTurn=1）。早前误用 aiTurn===0 → 开局时间种子 + 开局指令注入在真实开局都没触发。
    const isOpeningTurn = (prevSave.turnCount || 0) === 0;
    // 本回合干净 lastPayload —— **必须在开局块（starter 调用）之前**初始化，否则 starter 的 stepLog
    //   推进的是上一回合的陈旧 payload、随后被下方重置清掉 → 开局解析调用在 debug trace 里整条丢失。
    //   也供 generateResponse 的 catch（react.js:2174+）读它装配错误归因（不重置会污染前回合）。
    try {
      aiService.lastPayload = {
        provider: 'pzgm',
        traceId: `pzgm_${prevSave.turnCount || 0}_${currentAiTurnNumber()}`,
        failedPhase: null,
        errorInfo: null,
        models: { react: built.model },
        steps: [],
        engine: 'pzgm',
      };
    } catch (_) { /* defensive */ }
    // 开局（本局第一回合）时间种子：① 调 _getSelectedOpeningTimeContext 解析开局时间上下文——它顺带设
    //   aiService._activeOpeningTimeContext，供下方 openingController.resolve 走 frozen/recommended 路径
    //   （PZGM 之前没人设它 → frozen 卡的开局指令也走不到 frozen 段）；② 把开局「此刻」种进引擎 save.time
    //   （否则引擎从默认 year1/01/01/08:00 起，开局时间错乱）。
    if (isOpeningTurn && aiService) {
      let openCtx = null;
      try {
        openCtx = typeof aiService._getSelectedOpeningTimeContext === 'function'
          ? (aiService._getSelectedOpeningTimeContext(playerInput, null, 0) || null)
          : null;
      } catch (_) { /* 时间上下文解析失败不阻断回合 */ }
      if (!prevSave.time) {
        const seededTime = resolveOpeningEngineTime(openCtx);
        if (seededTime) prevSave = { ...prevSave, time: seededTime };
      }
      // ── starter：开局主角/地点解析（引擎写叙事前一次结构化调用）。代码落卡，不靠 GM 调 new_npc。──
      // 再入守卫：每局只跑一次。重新生成 Turn1 / 闸失败空叙事（skipCommit→turnCount 不前进→isOpeningTurn
      //   再次为真）都会重进开局块——若主角已建/已锁，跳过 starter，避免重复造主角（单主角不变式会把
      //   后到者剥成 is_protagonist:false，留下一张坏卡）。lock 同步写、且随存档持久；npcStore 兜一手。
      const starterAlreadyRan = !!(window.playerOpeningLockStore?.get?.()?.player_role)
        || !!(window.npcStore?.getProtagonistRuntimeId?.());
      if (!starterAlreadyRan && typeof aiService._runStarterSubagent === 'function') {
        let spec = null;
        try {
          spec = await aiService._runStarterSubagent(openCtx, playerInput, signal);
        } catch (e) {
          console.warn('[pzgm] starter 调用异常，走硬地板:', e);
        }
        const usedFallback = !spec;
        if (usedFallback) {
          // 硬地板也要认按钮意图（推荐主角→existing 作者主角，随机/普通人→generated 无名旅人）
          let forcedSource = typeof aiService._starterForcedSource === 'function'
            ? aiService._starterForcedSource(playerInput) : null;
          const authoredId = (typeof aiService._findStarterAuthoredProtagonist === 'function'
            ? aiService._findStarterAuthoredProtagonist() : null)?.id || null;
          // 与 subagent 同步降级（_runStarterSubagent:369）：existing 但本卡无作者主角 → 这约束不可能成立，
          //   降级为 generated，免得 buildStarterHardFloor 拿到 existing+空 id 的矛盾入参。
          if (forcedSource === 'existing' && !authoredId) forcedSource = null;
          spec = buildStarterHardFloor(aiService, forcedSource, authoredId);   // L4 硬地板（null 或抛错都兜）
        }
        try {
          const landed = landStarterProtagonist(spec.protagonist);
          if (landed && landed.heroId) {
            if (landed.engineCard) {
              // generated：把全量主角卡 seed 进引擎 save，引擎 roster（ctx.card.characters ∪ npcState.cards）才看得到
              prevSave.npcState = prevSave.npcState || { states: {}, cards: {}, cardProposals: [] };
              prevSave.npcState.cards = prevSave.npcState.cards || {};
              prevSave.npcState.cards[landed.heroId] = landed.engineCard;
            }
            // 同步写 lock（'existing' 走 processNpcPanel 异步落卡，lock 让 openingController 当回合即可取名）
            window.playerOpeningLockStore?.set?.({
              mode: 'assigned',
              player_role: landed.heroId,
              location_site: (spec.location && spec.location.fullPath) || null,
            });
          }
          if (usedFallback) {
            try { window.analyticsService?.track?.('starter.fallback_used', { reason: 'resolve_failed' }); } catch (_) {}
          }
        } catch (e) {
          console.warn('[pzgm] starter 落地失败（不阻断回合）:', e);
        }
      }
    }
    // 开局指令（仅本局第一回合）：openingController.resolve 产出「玩家扮演谁 / frozen_moment / init 规则」，
    // 注入 directives.opening → 引擎 gmPrompt 的「开局指令」槽（gmPrompt.js:128 `d.opening`）。react.js 经
    // prompt-gm.js:3184 注入这条，PZGM 之前整条缺失 → GM 收不到「把玩家登记成 is_protagonist NPC」的指令
    // （开场主角不显示的根因之一；另一半=引擎 new_npc 透传 is_protagonist，已在引擎侧补）。
    // 仅首个 AI 回合（currentAiTurnNumber()===0）注入；resolve 自带「非首轮 return isOpening:false」二次防护。
    try {
      const oc = aiService && aiService.openingController;
      if (isOpeningTurn && oc && typeof oc.resolve === 'function') {
        const op = oc.resolve([], null, playerInput);
        if (op && op.isOpening && op.promptText) {
          options.directives = { ...(options.directives || {}), opening: String(op.promptText) };
        }
      }
    } catch (e) {
      console.warn('[pzgm] 开局指令注入失败（不阻断回合）:', e);
    }
    // 世界事件 directive 桥（仅非开局回合——开局回合由 directives.opening 统辖，避免 turn-1 撞车）：
    // 把按时间线该播报的世界事件（BROADCAST/FORESHADOW）桥进 directives.gm；回合后据 receipts 标记已播报。
    let pendingGmEvent = null;
    if (!isOpeningTurn) {
      const wed = buildWorldEventDirective(null, currentAiTurnNumber());
      if (wed) {
        // 承重角色双通道入场（活世界·改动6）：本回合该播报的世界事件的 character_refs = 涉及的预定义承重角色。
        //   A2a（引擎侧·静默）：经 options.summonPredefined seed 进活名册（dormant），让其上运行时雷达，
        //                       之后由在场判定器/碰面/玩家行动决定是否转在场——不强行拉到玩家面前。
        //   A2b（GM 面·软提示）：在 directive 文本里点名"这些核心角色可登场"，让 GM 在相关时主动 load_predefined。
        //   两通道同源 character_refs（结构化 id，数据齐全），不依赖脆弱的 region 推断。
        //   注：纯节奏回合（gm 为空、仅 pacing）时下方 refs 恒空，A2b 自然跳过。
        let gm = wed.gm || [];
        try {
          const ev = wed.eventToReport && wed.eventToReport.event;
          let refs = ev && Array.isArray(ev.character_refs) ? ev.character_refs.map((x) => String(x || '').trim()).filter(Boolean) : [];
          // 活世界 §2：被玩家删除的预定义角色不得经世界事件 character_refs 复活进引擎活名册（A2a 召唤）。
          // assembleOptions 已为 options.deletedIds 算过同一份；这里对 summon 入参再滤一遍。修：删后复活（review）。
          const _del = (window.npcStore && typeof window.npcStore.getDeletedIds === 'function') ? window.npcStore.getDeletedIds() : null;
          if (_del && refs.length) refs = refs.filter((id) => !_del[id]);
          if (refs.length) {
            options.summonPredefined = refs.map((id) => ({ id, location: (ev && ev.location) || '' })); // A2a
            const cdb = (window.npcStore && typeof window.npcStore.getCharacterDatabase === 'function' && window.npcStore.getCharacterDatabase()) || {};
            const names = refs.map((id) => (cdb[id] && cdb[id].name) || id);
            gm = wed.gm.map((d, i) => i === 0 ? { ...d, text: `${d.text}（涉及核心角色：${names.join('、')}——如需让其登场，调 load_predefined_npc）` } : d); // A2b
          }
        } catch (e) { console.warn('[pzgm] 承重入场（A2a/A2b）失败（不阻断回合）:', e); }
        const add = {};
        if (gm.length) add.gm = gm;                 // 世界事件条目
        if (wed.pacing) add.pacing = wed.pacing;    // 场景节奏（独立槽，不进 gm/不进播报去重）
        if (Object.keys(add).length) options.directives = { ...(options.directives || {}), ...add };
        if (wed.eventToReport) {
          pendingGmEvent = { eventId: wed.eventToReport.eventId, turn: currentAiTurnNumber(), type: wed.eventToReport.type };
        }
      }
    }
    const diceMode = readDiceMode();
    // ── OOC 归一化 + 反问（决策 1+2）────────────────────────────────────────────────
    // 只对 freehand 跑子模块（导演标签不进反问，已由 _dsplit.directorBlock 内联扩写处理）。放在开局/starter
    // 之后跑：① lastPayload 已重置 → OOC stepLog 进得来、不被开局块清掉；② 反问阻塞不挡 turn-1 主角创建；
    // ③ classifySingleAction 已在上方跑完。重生（forcedNormalized）走 fast-path：复用上一轮归一化结果、绝不再反问。
    let _normalizedFreehand = '';
    try {
      if (ooc && typeof ooc.forcedNormalized === 'string' && ooc.forcedNormalized.trim()) {
        _normalizedFreehand = ooc.forcedNormalized.trim();
      } else if (
        Array.isArray(_dsplit.freehandCandidates) && _dsplit.freehandCandidates.length &&
        aiService && typeof aiService._runOocWorkflow === 'function'
      ) {
        const oocAdapter = aiService._getAdapter('ooc_normalizer', window.AI_REQUEST_SCOPED);
        _normalizedFreehand = (await aiService._runOocWorkflow(oocAdapter, _dsplit.freehandCandidates)) || '';
      }
    } catch (e) {
      console.warn('[pzgm] OOC 归一化失败（不阻断回合）:', e?.message || e);
    }
    if (_normalizedFreehand) {
      options.directives = { ...(options.directives || {}), ooc: _normalizedFreehand };
    }
    // 暂存 = 仅 freehand 归一化（与 react 形态一致：normalized=子模块产物）；raw=原始候选（含导演，供重生重扩）。
    // 导演单发回合 _normalizedFreehand='' 但 raw 非空 → applySideChannels 仍盖章（条件已放宽到 raw.length）。
    const oocText = _normalizedFreehand;
    // 注：lastPayload 已在上方开局块之前初始化（让 starter 的 stepLog 进得来）；此处不再重置。

    // 流式渲染走 eventBus 的 AI_NARRATIVE_STREAM/DISPLAY —— streamVisualizer 既有订阅会创建叙事段、
    // 设 narrativeElement、增量绘制（同 react.js 流式契约）。【不】走 onChunk→streamVisualizer.update
    // （update 在 narrativeElement 为空时直接 return；且与事件路径并用会触发 Geelong 类「同节点重复-塌缩」
    // 渲染红线）。pieces 仍累积 → 回合末单一真源叙事串（lastNarrativeText / 返回值 / panel_narrative 一致）。
    const EB = window.eventBus;
    const GE = window.GameEvents || {};
    const streamTurnId = `pzgm_${prevSave.turnCount || 0}_${currentAiTurnNumber()}`;
    const pieces = []; // 已定稿叙事段 / 掷骰行 / 闸提示（按发生顺序，纯文本串拼接源）
    // 叙事-工具「按到达顺序交错」记录 → lastReactSegments，供历史重建/读档回看时把叙事段穿插进工具迭代链
    //（同 react 路径口径）。narrative 段 iteration 仅作身份元数据不参与定位；tools 段 iteration=roundIdx 与
    // lastFunctionCalls 的 group key 对齐（_rebuildInterleavedTrace 据此 find 到对应工具组）。
    const reactSegments = [];
    const liveNpcSeen = new Set(); // 即时 NPC 气泡去重：同一 NPC 一回合只 live 一次
    let segIdx = 0;
    let ttftMs = null; // 首字耗时（首个 narrative_stream）
    const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : 0;
    const nowMs = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : 0);
    const emitStream = (text) => { try { if (EB && GE.AI_NARRATIVE_STREAM && text) EB.emit(GE.AI_NARRATIVE_STREAM, { iteration: segIdx, text, turn_id: streamTurnId }); } catch (_) {} };
    const emitDisplay = (text) => { try { if (EB && GE.AI_NARRATIVE_DISPLAY && text) EB.emit(GE.AI_NARRATIVE_DISPLAY, { iteration: segIdx, text }); } catch (_) {} };
    // 把一段已定稿文本作为独立段「落定并渲染」（掷骰行 / 闸提示用——DISPLAY 的 L3 兜底会建节点）
    const commitSegment = (text) => { if (!text) return; emitDisplay(text); pieces.push(text); reactSegments.push({ type: 'narrative', iteration: segIdx, text }); segIdx++; };

    // 引擎逐段工具 trace（合同 host.emit('tool_call', {stage, calls})）→ 同时喂两个观测面：
    //   ① streamVisualizer 迭代链：既有 AI_REACT_TOOL_CALL 订阅按 iteration 建迭代节点 + 工具卡 +
    //      「已推理 Xs」+ I → II → III · 工具 摘要条（react.js 老路径同款；之前 PZGM 不发此事件 →
    //      只剩裸叙事段、链整条不出）。叙事段是 container 直挂兄弟、按 iteration 仅作身份元数据不定位
    //      （streamVisualizer.js:2711/2871），故迭代链用独立单调 roundIdx，与叙事 segIdx 互不干涉。
    //   ② debug 面板：lastPayload.steps[]（phase:'react' 复用现成 react-group 分组渲染）+
    //      lastFunctionCalls[]（按 iteration 取工具结果）。引擎不暴露逐段 raw request/response/token
    //      （只回合末聚合 metrics）→ step 不带 request/metrics，debug 靠 executionResults 呈现工具
    //      名/参数/结果，per-step token 走 debugUI 的估算兜底。
    aiService.lastFunctionCalls = [];
    const stepsLog = (aiService.lastPayload && aiService.lastPayload.steps) || [];
    const fcLog = aiService.lastFunctionCalls;
    let roundIdx = 0;
    let roundStartT = t0;
    const stageTimeLog = []; // [{label, ms}] 逐段耗时 → 费用条 ⏱️ tooltip 分段明细（引擎不给逐段 token，时间能给）
    // 缓存该段最近一次 llm_call（kind:stage），由随后同一迭代的 tool_call 折进同一 step（见下）。
    let pendingStageCall = null;
    // 同步深克隆 trace 快照——引擎跨段复用同一 messages 数组，不克隆会被后续 attempt/段污染。
    const _cloneTrace = (x) => { try { return JSON.parse(JSON.stringify(x)); } catch (_) { return x; } };

    const host = {
      signal: signal || (state.abortController && state.abortController.signal),
      log: () => {},
      emit(e, p) {
        try {
          if (e === 'narrative_stream') {
            if (ttftMs === null && t0) ttftMs = nowMs() - t0;
            emitStream(p.text || ''); // 段内累积全文（streamVisualizer 全替换）
          } else if (e === 'narrative_display') {
            const t = (p.text || '').trim(); // corrected 时 p.text 即校正后定稿
            if (t) { emitDisplay(t); pieces.push(t); reactSegments.push({ type: 'narrative', iteration: segIdx, text: t }); segIdx++; }
          } else if (e === 'narrative_retract') {
            // 在飞段会被下一段 stream/display 覆写；v1 不主动撤回 DOM
          } else if (e === 'roll_complete') {
            const r = p.result || {};
            // ① 实时掷骰卡：发结构化 ROLL_COMPLETE（带 engine:'pzgm' 标记）→ streamVisualizer 渲 .roll-report 卡。
            //    与 react 的 result.tool==='get_roll' 守卫天然互斥（PZGM result 无 tool 字段）→ react 卡一字不动。
            try { if (EB && GE.ROLL_COMPLETE) EB.emit(GE.ROLL_COMPLETE, { result: { ...r, engine: 'pzgm' } }); } catch (_) {}
            // ② 持久化：精简单行进叙事正文（reload 后 panel_narrative 只重渲 markdown、不重建卡 → 留文字行作记录）。
            commitSegment('> ' + formatRoll(r));
          } else if (e === 'notification') {
            if (typeof window.showToast === 'function' && p.text) window.showToast(p.text);
          } else if (e === 'npc_reaction') {
            // 即时 NPC 气泡：引擎在 NPC 子代理跑完当刻发（与主写作并行）→ 转给 streamVisualizer 实时渲精简气泡。
            // payload 只有 npcId/name/text（无 decision）；回合末权威完整卡由 finalize 的 _fillNpcActionsSection
            // 整体覆盖（innerHTML=），故无需在此落库/去重至权威链（避免双写）。react 路径不发此事件 → react 零影响。
            const text = String((p && p.text) || '').trim();
            if (text && p.npcId && !liveNpcSeen.has(p.npcId)) {
              liveNpcSeen.add(p.npcId);
              try { if (EB && GE.AI_NPC_REACTION_LIVE) EB.emit(GE.AI_NPC_REACTION_LIVE, { npcId: p.npcId, name: p.name, text, turn_id: streamTurnId }); } catch (_) {}
            }
          } else if (e === 'tool_call') {
            // 一段引擎工具轮（open/exec/continue/closeout 的一次 LLM 轮，或 exec 的引擎代查 engine:*）。
            const stage = (p && p.stage) || 'react';
            const calls = ((p && p.calls) || []).map((c) => ({
              name: c.name,
              args: c.args || {},
              status: c.status,
              result: typeof c.result === 'string' ? c.result : (c.result == null ? '' : JSON.stringify(c.result)),
            }));
            const dur = Math.max(0, Math.round(nowMs() - roundStartT));
            roundStartT = nowMs();
            stageTimeLog.push({ label: STAGE_LABELS[stage] || stage, ms: dur });
            // ① 迭代链：streamVisualizer 既有 AI_REACT_TOOL_CALL 订阅 → 迭代节点 + 工具卡 + 已推理耗时 + 摘要条
            try { if (EB && GE.AI_REACT_TOOL_CALL) EB.emit(GE.AI_REACT_TOOL_CALL, { iteration: roundIdx, calls, durationMs: dur }); } catch (_) {}
            // ② debug 面板：phase:'react' 复用 react-group 渲染；stageName 让侧栏/详情显示「写作·开场」等
            //    分段名而非「迭代 N」；executionResults + lastFunctionCalls(iteration) 喂工具时间线。
            try {
              const _step = {
                step: roundIdx,
                phase: 'react',
                iteration: roundIdx,
                iterationLabel: stage,
                stageName: STAGE_LABELS[stage] || stage,
                enginePipeline: 'pzgm',
                model: built.model,
                provider: built.providerId,
                response: { toolCalls: calls.map((c) => ({ name: c.name, args: c.args })) },
                executionResults: calls,
              };
              // 折进本段 llm_call 的完整出站 prompt / 原始返回 / 真实 token（PZGM 透明化核心）。
              if (pendingStageCall && pendingStageCall.stage === stage) {
                _step.request = pendingStageCall.request;           // 完整 messages + system，未截断
                _step.response.raw = pendingStageCall.responseRaw;  // 模型完整原始返回
                _step.response.text = pendingStageCall.responseText;
                _step.responseText = pendingStageCall.responseText;
                _step.metrics = pendingStageCall.metrics;           // 真实 per-step token（引擎过去给不出）
                _step.stopReason = pendingStageCall.stopReason;
                if (pendingStageCall.model) _step.model = pendingStageCall.model;
                pendingStageCall = null;
              }
              stepsLog.push(_step);
              fcLog.push({ iteration: roundIdx, calls });
              // 交错记录：tools 段（iteration=roundIdx 与 fcLog group key 一致，重建时据此 find 工具组）
              reactSegments.push({ type: 'tools', iteration: roundIdx });
            } catch (_) { /* trace 失败不杀回合 */ }
            roundIdx++;
          } else if (e === 'llm_call') {
            // 引擎每次实际 LLM 调用的完整出站 prompt + 原始返回 + 真实 token（debug 接缝，纯加法）。
            // emit 同步：此处当场克隆，引擎后续对 messages 的追加不污染已存快照。
            try {
              if (p && p.kind === 'stage') {
                // 缓存，等本段随后同一迭代的 tool_call 折进同一 step（见上）。
                pendingStageCall = {
                  stage: p.stage,
                  request: { messages: _cloneTrace(p.requestPrompt), system: p.system || '' },
                  responseRaw: _cloneTrace(p.rawResponse),
                  responseText: (p.rawResponse && typeof p.rawResponse === 'object') ? (p.rawResponse.text || '') : String(p.rawResponse || ''),
                  metrics: p.usage || null,
                  stopReason: p.stopReason || null,
                  model: p.model || null,
                };
              } else {
                // aux 子调用（npc_reaction/npc_offscreen/intro_audit/ai_score/turn_summary/chapter）：
                // 无后续 tool_call → 直接 push 一条 step，字段对齐 react 路径 npcStepLog → NPC tab/详情零新代码点亮。
                const auxKind = (p && p.auxKind) || 'aux';
                stepsLog.push({
                  step: 'aux',
                  phase: auxKind,
                  npcId: (p && p.npcId) || undefined,
                  npcName: (p && p.npcName) || undefined,
                  stageName: STAGE_LABELS[auxKind] || auxKind,
                  enginePipeline: 'pzgm',
                  model: (p && p.model) || built.model,
                  provider: built.providerId,
                  request: { messages: [{ role: 'user', content: String((p && p.requestPrompt) || '') }], system: (p && p.system) || '' },
                  response: { raw: (p && p.rawResponse) || '' },
                  responseText: String((p && p.rawResponse) || ''),
                  metrics: (p && p.usage) || null,
                });
              }
            } catch (_) { /* trace 失败不杀回合 */ }
          } else if (e === 'presence_resolved') {
            // 在场判定的【最终分区+来路】（引擎在 grace/手动/cap/summon 叠加后另发，presence_triage 的 llm_call 不含）。
            // 挂到 lastPayload._presence（仅当前回合，覆盖式），debugUI NPC tab 渲染「在场判定·最终分区」面板。
            try {
              if (aiService.lastPayload && p) {
                aiService.lastPayload._presence = {
                  turnNo: p.turnNo,
                  resolved: Array.isArray(p.resolved) ? p.resolved : [],
                  presentIds: Array.isArray(p.presentIds) ? p.presentIds : [],
                  offscreenDispatched: Array.isArray(p.offscreenDispatched) ? p.offscreenDispatched : [],
                  offscreenEligible: Array.isArray(p.offscreenEligible) ? p.offscreenEligible : [],
                };
              }
            } catch (_) { /* trace 失败不杀回合 */ }
          }
          // npc_reaction：实时气泡上面已转发；其权威落库（decision/state）仍回合末从 turnResult 走（见 applySideChannels）。
          // sms_received / panel_updated：回合末统一从 turnResult 落（含 async 持久化）
        } catch (err) {
          console.warn('[pzgm] emit 处理异常（已吞）:', e, err);
        }
      },
    };

    let out;
    try {
      // 按段模型/思考分档（仅推荐模式；simple/advanced 返回 null → 单模型 + closeout 不思考，行为不变）。
      // 引擎按 config.stageModels[stage] / stageThinking[stage] 逐段覆盖 adapter.call 的 model/thinking
      // （单 DeepSeek adapter 经 opts.model 逐调用切 pro/flash，同 key 同端点）；auxModel 统一路由 aux 子代理。
      const pzgmRouting =
        (window.aiService && typeof window.aiService.getPzgmStageRouting === 'function')
          ? window.aiService.getPzgmStageRouting()
          : null;
      const runConfig = {
        diceMode,
        tierDC: readTierDC(), // 玩家自定义四档难度 DC（null=用引擎默认 10/15/20/25）
        autoApprove: true, // [v1] 物品/改卡提案引擎内自动通过；专门审批 UX 为后续精修
        thinking: built.thinking, // 全局兜底（推荐模式下三段 stageThinking 已全覆盖，此值仅作 fallback）
        stageThinking: pzgmRouting ? pzgmRouting.stageThinking : { closeout: 'off' },
        npcOffscreen: true, // 活世界 §4「全活」：离场 NPC 每回合各过自己一笔生活（PZGM 开启；引擎默认关）
      };
      if (pzgmRouting) {
        runConfig.stageModels = pzgmRouting.stageModels;
        runConfig.stageMaxTokens = pzgmRouting.stageMaxTokens; // 每段输出上限：防服务端低默认掐断叙事/工具参数
        runConfig.auxModel = pzgmRouting.auxModel;
      }
      out = await eng.runTurn({
        cardJson,
        save: prevSave,
        playerInput: playerInputForEngine, // 含挂在末尾的 [!CRITICAL] 导演指令；历史里仍是干净 playerInput
        options,
        adapter: built.adapter,
        auxAdapter: built.adapter,
        host,
        config: runConfig,
      });
    } catch (err) {
      state.running = false;
      // 透传给 generateResponse 的 catch（它会装配 unifiedErrorInfo）。PZGM 错误契约带 errorInfo →
      // 镜像成 unifiedErrorInfo 便于上层归因（traceId/failedPhase 已在 err 上）。
      if (err && err.name === 'AbortError') throw err;
      if (err && err.errorInfo && !err.unifiedErrorInfo) err.unifiedErrorInfo = err.errorInfo;
      throw err;
    }

    try {
      const tr = out.turnResult || {};
      const totalTime = t0 ? Math.round(nowMs() - t0) : null;
      // 1) 闸未过：把「可继续/可重生成」提示作为独立段落定（实时显示 + 进 pieces）——确保
      //    lastNarrativeText / 返回值 / panel_narrative 三者单一真源一致（残段仍可玩）。
      const gateFailed = !!(tr.gate && tr.gate.passed === false);
      if (gateFailed && tr.gate.player_message) {
        commitSegment('⚠️ ' + tr.gate.player_message);
      }
      // 空叙事回合（闸 G1）：引擎态不落档/不投影——让它成为真正的 no-op，用户重新生成即干净回滚，
      //   不在「什么都没发生」的回合上偷偷推进时间/面板/NPC 态（A3）。
      const skipCommit = gateFailed && !String((tr.narrative && tr.narrative.full_text) || '').trim();
      // 2) 单一真源叙事串
      const finalNarrative = pieces.length
        ? pieces.join('\n\n')
        : (tr.narrative && tr.narrative.full_text) || '';

      // 主线 PZGM 对话镜像进独立通道：玩家输入(轻量) + 最终叙事。两者都不大，全量发；best-effort 不影响回合。
      try {
        const _cvReq = (aiService && aiService.lastPayload && aiService.lastPayload.traceId) || null;
      } catch (_) { /* never break the turn */ }
      // 3) 喂 aiService side-channel（让 processAIResponse / buildTurnResult 原样工作）
      // 双付去重：算出本回合引擎是否并章（nextSave.chapters 比 prevSave 多一条 = 新章），连同引擎已产
      //   turn_summary 一并交给 summaryService 复用，省掉 host 那次重复的总结/章节 AI 调用。
      const _prevChapters = Array.isArray(prevSave && prevSave.chapters) ? prevSave.chapters : [];
      const _nextChapters = Array.isArray(out.nextSave && out.nextSave.chapters) ? out.nextSave.chapters : [];
      const engineChapter = _nextChapters.length > _prevChapters.length ? _nextChapters[_nextChapters.length - 1] : null;
      applySideChannels(aiService, tr, built, finalNarrative, { ttftMs, totalTime, oocText, ooc, stageTimes: stageTimeLog, reactSegments, engineTurnSummary: (tr.memory && tr.memory.turn_summary) || null, engineChapter });
      if (!skipCommit) {
        // 4) 投影 nextSave 进现有渲染/存档 store
        await projectTurn(tr, out.nextSave);
        // 4.5) 世界事件回执：narrated → 标记已播报（防同一事件每回合重播）
        applyDirectiveReceipts(tr, pendingGmEvent);
        // 5) 引擎权威存档落入 pzgmState（随 autoSaveGame 持久化；回滚走 restoreAll 上一份快照统一处理）
        pzgmStateStore.set(out.nextSave);
      }
      state.running = false;
      return finalNarrative;
    } catch (err) {
      state.running = false;
      console.error('[pzgm] 回合产物落地失败:', err);
      throw err;
    }
  }

  // ---------- side-channel 喂入 ----------
  function applySideChannels(aiService, tr, built, finalNarrative, meta) {
    if (!aiService) return;
    const { ttftMs = null, totalTime = null, oocText = '', ooc = null, stageTimes = null, reactSegments = [], engineTurnSummary = null, engineChapter = null } = meta || {};
    aiService.lastNarrativeText = finalNarrative;
    aiService.lastChoicesData = Array.isArray(tr.choices) ? tr.choices : null;
    // 叙事-工具交错段：历史重建/读档回看时把叙事段穿插进工具迭代链（同 react 路径）。空时退回整段渲染。
    aiService.lastReactSegments = (Array.isArray(reactSegments) && reactSegments.length) ? reactSegments : [];
    aiService.lastStep2Choices = null;
    // lastFunctionCalls 已在 runTurn 入口重置、并由 host.emit('tool_call') 逐段累积 → 此处勿清空
    aiService.lastReasoningContents = null;
    // OOC 回执：processAIResponse 读 getPendingOoc() 贴 aiMessage.ooc（重新生成复用）。本回合有 OOC →
    // setPendingOoc（否则清掉，避免上一 react 回合的陈旧 OOC 误贴到本 PZGM 回合）。
    try {
      const _rawForStash = (ooc && (ooc.forcedRaw || ooc.candidates)) || [];
      // 盖章条件放宽到 raw.length：导演单发回合 normalized 为空、但 raw 含导演标签，仍须盖章供重生重扩。
      if ((oocText || (Array.isArray(_rawForStash) && _rawForStash.length)) && typeof aiService.setPendingOoc === 'function') {
        aiService.setPendingOoc({ normalized: oocText, raw: _rawForStash });
      } else if (typeof aiService.clearPendingOoc === 'function') {
        aiService.clearPendingOoc();
      }
    } catch (_) { /* OOC 回执失败不杀回合 */ }
    // NPC 反应 → processAIResponse 负责 npcReactionStore.addReaction + applyReactionToState。
    // ⚠️ PZGM 的 tr.npc.reactions 是【对象】keyed by npcId（npcEngine.js: st.npc.reactions[id]={name,text,decision}），
    //    不是数组——必须 Object.entries 展开（decision 字段 location/mood/social_target/inner_thought
    //    与 npcStore.applyReactionToState 读取的字段名逐一吻合）。
    //    引擎已把 intent_toward_player 改名 current_intention（语义更宽：她当下奔着啥）；host npcStore 的 state
    //    字段名暂留旧名 intent_toward_player（Phase 4 UI 直渲 GNA 包时再统一），这里把新字段回填进旧槽即可。
    const reactionsObj = (tr.npc && tr.npc.reactions && typeof tr.npc.reactions === 'object') ? tr.npc.reactions : {};
    const reactions = Object.entries(reactionsObj).map(([npcId, r]) => {
      const d = r.decision || null;
      const decision = d
        ? { ...d, intent_toward_player: (d.current_intention ?? d.intent_toward_player) ?? null }
        : null;
      return { npcId, name: r.name, text: r.text, decision };
    });
    aiService.lastNpcReactions = reactions.length ? reactions : null;
    // 双付去重侧槽：把引擎 aux 已产的 turn_summary（+本回合若并章则 chapter）暴露给 summaryService。
    // AI_RESPONSE_COMPLETE 钩子用 lastRequestMetrics.engine==='pzgm' 把关后复用之，跳过 host 重复 AI 总结/章节。
    aiService.lastEngineMemory = {
      turn_summary: engineTurnSummary || null,
      chapter: engineChapter || null,
    };
    // 用量度量 + 成本台账（PZGM metrics → lastRequestMetrics + 子代理逐条 _trackSubagentCall）。
    // ⚠️ streamVisualizer.renderMetricsBar 在缺 ttft/totalTime 时整条返回 ''（时间+token+费用全不显）；
    //    费用块要 prices+steps；子代理头条要 subagentsFolded===false + subagents[]。必须按 react.js:1367
    //    的形状供齐（否则 PZGM 回合费用气泡整条空白）。subagents 的 .kind → .phase 供 tooltip 取标签。
    const m = tr.metrics || {};
    const inTok = m.inputTokens || 0, outTok = m.outputTokens || 0, crTok = m.cacheReadTokens || 0, ccTok = m.cacheWriteTokens || 0;
    const subs = Array.isArray(m.subagents) ? m.subagents.map((s) => ({
      ...s,
      phase: s.phase || s.kind,
      // 引擎子代理记 cacheWriteTokens；stepCostCny 读 cacheCreationTokens → 对齐（deepseek 恒 0，anthropic 才非 0）
      cacheCreationTokens: s.cacheCreationTokens != null ? s.cacheCreationTokens : (s.cacheWriteTokens || 0),
    })) : [];
    // starter（开局解析，host 侧 flash 子代理）不在引擎 m.subagents 里 → 从 lastPayload.steps 捞它的 metrics
    //   折进 subs，让费用气泡 headline（= 主循环 + 全部 subagents）把这次开局调用的 in/out/费用算进去。
    //   ⚠️ 它在子代理内部已自报一次 _trackSubagentCall → 故【不】进下方遍历 m.subagents 的 _trackSubagentCall
    //   循环（那个只遍历引擎 m.subagents，starter 不在其中）→ Analytics 端只记一次，不双计。
    try {
      // 重试时 lastPayload.steps 会有多条 'starter'（每 attempt 一条，每条都是真实 API 调用、各自计费、
      //   各自 _trackSubagentCall）→ 求和全部，与 Analytics 端逐条记账对齐（取首条会漏掉重试那次的费用）。
      const _starterSteps = (aiService.lastPayload && Array.isArray(aiService.lastPayload.steps))
        ? aiService.lastPayload.steps.filter((s) => s && s.phase === 'starter' && s.metrics) : [];
      if (_starterSteps.length) {
        const agg = _starterSteps.reduce((a, s) => {
          const sm = s.metrics || {};
          a.inputTokens += sm.inputTokens || 0;
          a.outputTokens += sm.outputTokens || 0;
          a.cacheReadTokens += sm.cacheReadTokens || 0;
          a.cacheCreationTokens += (sm.cacheCreationTokens != null ? sm.cacheCreationTokens : (sm.cacheWriteTokens || 0));
          a.durationMs += sm.totalTime || 0;
          return a;
        }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, durationMs: 0 });
        subs.push({ phase: 'starter', ...agg });
      }
    } catch (_) { /* 费用折叠失败绝不杀回合 */ }
    // ⚠️ 计费近似（推荐模式按段路由后，方案 B·2026-06-12）：引擎 bumpUsage 把主链三段
    //    （open/continue=pro、closeout=flash）token 聚合进一个 bucket、不带 per-stage 模型标签，
    //    宿主拿不到分段 token → 整条主链按 react(=pro) 单价计。closeout(flash) 折进 pro 聚合价
    //    会让客户端费用条每回合偏高约 1-4%（恒偏高、永不偏低；closeout 是最小那段）。这是纯
    //    显示估算偏差——推荐模式直连用户官方 DeepSeek key，真实账单 DeepSeek 按模型正确扣（flash 算 flash）。
    //    要显示精确需 re-vendor 引擎让其按段吐 token（A 方案，已评估暂不做）。
    // 价表：PZGM aux 子代理（npc_reaction/intro_audit/ai_score/turn_summary/chapter_summary/
    // world_expand*）auxModel=pro 经同一 adapter → 与 react(pro) 同价（计价正确）。逐 phase 补价，否则费用条按
    // metrics.prices[phase] → {in:0,out:0} 把子代理成本算成 ¥0（token 进了 headline、钱却没算）。
    let prices;
    try {
      if (typeof aiService.getModulePrices === 'function') {
        const reactPrice = aiService.getModulePrices('react');
        prices = { react: reactPrice };
        for (const s of subs) { if (s.phase && !(s.phase in prices)) prices[s.phase] = reactPrice; }
        // starter（开局解析）是 host 侧 flash 子代理、不在引擎 subs 里 → 单独按 'starter'(flash) 补价，
        //   否则 debug 步价把这条开局调用算成 ¥0（仅开局回合有此 step；其余回合此键闲置无害）。
        try { prices.starter = aiService.getModulePrices('starter'); } catch (_) {}
      } else { prices = undefined; }
    } catch (_) { prices = undefined; }
    aiService.lastRequestMetrics = {
      provider: built.providerId,
      providers: { react: built.providerId },
      model: built.model,
      models: { react: built.model },
      inputTokens: inTok,
      outputTokens: outTok,
      cacheReadTokens: crTok,
      cacheCreationTokens: ccTok,
      subagents: subs,
      subagentsFolded: false,
      prices,
      steps: [{ phase: 'react', model: built.model, inputTokens: inTok, outputTokens: outTok, cacheReadTokens: crTok, cacheCreationTokens: ccTok, ttft: ttftMs, totalTime }],
      ttft: ttftMs,
      totalTime,
      stageTimes: Array.isArray(stageTimes) ? stageTimes : null, // 费用条 ⏱️ tooltip 逐段耗时
      engine: 'pzgm',
    };
    try {
      const calls = Array.isArray(m.subagents) ? m.subagents : [];
      for (const s of calls) {
        aiService._trackSubagentCall?.({
          subsystem: 'react_pzgm' + (s.kind ? ':' + s.kind : ''),
          provider: built.providerId,
          model: built.model,
          durationMs: s.durationMs || null,
          metrics: {
            inputTokens: s.inputTokens || 0,
            outputTokens: s.outputTokens || 0,
            cacheReadTokens: s.cacheReadTokens || 0,
            cacheCreationTokens: s.cacheWriteTokens || 0,
            stopReason: s.stopReason || null,
          },
          ok: true,
        });
      }
    } catch (_) {
      /* telemetry 绝不杀回合 */
    }
  }

  // ---------- nextSave 投影进现有 store ----------
  async function projectTurn(tr, nextSave) {
    const turnNumber = currentAiTurnNumber();
    const settlement = tr.settlement || {};

    // 状态栏自定义字段：PZGM 给的是已合并的全量快照 → 一次性覆盖（不 re-merge）
    try {
      if (nextSave && nextSave.customStatus != null && window.customStatusStore) {
        window.customStatusStore.syncFromAIResponse(nextSave.customStatus);
        // 广播面板字段已更新（与 react 路径 update_panel 工具同事件）：主角卡的状态栏数值镜像据此刷新。
        // 该事件目前仅主角卡镜像订阅；PZGM 不走 update_panel 工具，故在此补发。
        if (window.eventBus && window.GameEvents?.AI_STATE_PANEL_UPDATED) {
          window.eventBus.emit(window.GameEvents.AI_STATE_PANEL_UPDATED, { source: 'pzgm' });
        }
      }
    } catch (e) {
      console.warn('[pzgm] customStatus 投影失败:', e);
    }

    // 时间推进
    try {
      const t = settlement.time;
      if (t && typeof timelineService !== 'undefined' && timelineService.setCurrentDate) {
        timelineService.setCurrentDate(t.year, t.month, t.day, t.hour, typeof t.minute === 'number' ? t.minute : 0);
      }
    } catch (e) {
      console.warn('[pzgm] time 投影失败:', e);
    }

    // 地点（settlement.location = {country, site, spot} → locationTracker；引擎已三段化，tracker 入口再过 toTriad 归一）
    try {
      const loc = settlement.location;
      if (loc && (loc.country || loc.site || loc.spot) && typeof locationTracker !== 'undefined' && locationTracker.updateFromResponse) {
        locationTracker.updateFromResponse({ country: loc.country, site: loc.site, spot: loc.spot }, turnNumber, settlement.time || null);
      }
    } catch (e) {
      console.warn('[pzgm] location 投影失败:', e);
    }

    // 目标
    try {
      if (settlement.objective && typeof playerStateService !== 'undefined' && playerStateService.setObjective) {
        playerStateService.setObjective(settlement.objective);
      }
    } catch (e) {
      console.warn('[pzgm] objective 投影失败:', e);
    }

    // 活世界 §2/§7：把引擎权威 npcState 镜像回 host store——卡内预定义角色（被全活跑活）按需登场 + 离场/在场
    // NPC 的 state 推进同步进面板。必须在 processNpcPanel 之前：预定义角色先同步登场，下面的 profile_writes
    // 才会在 _npcs 里找到她走正常 UPDATE，而非又触发一次 NEW_PREDEFINED（双建）。
    try {
      if (nextSave && nextSave.npcState && window.npcStore && typeof window.npcStore.projectEngineNpcState === 'function') {
        // 本回合引擎最终在场集（presence_resolved → lastPayload._presence，仅当前回合、覆盖式）→
        // 写进每个 NPC 的 state.is_present（持久化），正面在场徽章读。无则传 null（投影保留旧值）。
        const pres = aiService.lastPayload && aiService.lastPayload._presence;
        const presentIds = pres && Array.isArray(pres.presentIds) ? pres.presentIds : null;
        // 引擎本回合号（presence_resolved.turnNo）→ 投影侧据 lastPresentTurn===turnNo 兜住 GM 回合中途
        // load_predefined_npc 拉上场的在场 NPC（presentIds 是回合首快照、漏掉它们，会误判离场）。
        const engineTurnNo = pres && typeof pres.turnNo === 'number' ? pres.turnNo : null;
        // 本回合 new_cards 的 id 集 → 投影登场兜底排除它们（交给下面 processNpcPanel 自己建，避免双建）。
        const _freshBuiltIds = new Set(((tr.npc && tr.npc.new_cards) || []).map((c) => c && c.id).filter(Boolean));
        window.npcStore.projectEngineNpcState(nextSave.npcState, presentIds, _freshBuiltIds, engineTurnNo);
      }
    } catch (e) {
      console.warn('[pzgm] npc state 投影失败:', e);
    }

    // NPC 新建 / 档案写入 → processNpcPanel（reactions 由 processAIResponse 落）。
    // ⚠️ PZGM 形状（npcEngine.js）：new_cards[]={id,name,card:{name,personality,dialogue_tone,role?,origin_kind}}（flat，
    //    与 processNpcPanel NEW 期望吻合）；profile_writes[]={npc_id,npc_name,fields,turn,uid}（字段名是 npc_id/
    //    npc_name/fields，不是 id/name/profile）。trigger_type 'NEW'/'UPDATE' 均为 npcStore 合法值。
    try {
      const npc = tr.npc || {};
      const panelNpc = [];
      const _engStates = (nextSave.npcState && nextSave.npcState.states) || {};
      for (const c of npc.new_cards || []) {
        // 活世界·三态：dormant（建档但从未在场——intro_audit 仅被提到名字的人 / GM enters_player_loop:false）不进面板。
        // 与 projectEngineNpcState 的 ever_present===false gate 一致（new_cards 这条路也得拦，否则 dormant 漏进面板）。
        if (_engStates[c.id] && _engStates[c.id].ever_present === false) continue;
        panelNpc.push({ trigger_type: 'NEW', id: c.id, name: c.name, card: c.card || {} });
      }
      for (const w of npc.profile_writes || []) {
        panelNpc.push({ trigger_type: 'UPDATE', id: w.npc_id, name: w.npc_name, card: w.fields || {} });
      }
      // 引擎 update_npc 提案（身份档案变化，含主角 cognitive_state/role）→ 走宿主审批/自动批准。
      // ⚠ 必须用 tr.npc.card_proposals（本回合产物，turnState 每回合重置），不是 nextSave.cardProposals
      //   （累积），否则会逐回合重复投影。形状 {npc_id,npc_name,patch,...}（npcEngine.js execUpdateNpc）。
      //   主角的两字段白名单兜底在 npcStore.queueUpdate（非白名单字段被剥）。
      for (const p of npc.card_proposals || []) {
        panelNpc.push({ trigger_type: 'UPDATE', id: p.npc_id, name: p.npc_name, card: p.patch || {} });
      }
      if (panelNpc.length && window.npcStore && typeof window.npcStore.processNpcPanel === 'function') {
        window.npcStore.processNpcPanel(panelNpc, turnNumber, null);
      }
    } catch (e) {
      console.warn('[pzgm] npc 卡投影失败:', e);
    }

    // 物品：镜像进现有 inventoryStore 审批队列（autoApprove 引擎已应用 → 这里直接落地显示）。
    // ⚠️ PZGM PendingChange（itemLedger.js）= {name, delta, desc_after, ...}——desc 字段是 desc_after，不是 desc。
    try {
      const changes = tr.item_changes || [];
      if (changes.length && window.inventoryStore && typeof window.inventoryStore.queueChange === 'function') {
        window.inventoryStore.setAutoApprove?.(true);
        for (const ch of changes) {
          const name = ch.name || ch.item;
          const delta = typeof ch.delta === 'number' ? ch.delta : 0;
          if (name && delta) window.inventoryStore.queueChange({ name, delta, desc: ch.desc_after ?? ch.desc }, turnNumber, null);
        }
      }
    } catch (e) {
      console.warn('[pzgm] item 投影失败:', e);
    }

    // 短信（async）。⚠️ PZGM sms（commsEngine.js）= {from_npc_id, from_name, message, mood?, game_time, ...}——
    //    发件人字段是 from_npc_id（联系人）/ from_name（显示名），不是 contactId/from/npcId。
    //    notify 是即焚通知（{type,text}，不进存档）——已由 host.emit('notification')→showToast 实时处理，
    //    这里【不】再经 receiveSystemNotification 持久化（那会把即焚通知错误地永久化进短信）。
    try {
      if (typeof smsService !== 'undefined' && typeof smsService.receiveEventSMS === 'function') {
        for (const s of (tr.comms && tr.comms.sms) || []) {
          const contactId = s.from_npc_id || s.from_name || 'unknown';
          await smsService.receiveEventSMS(
            contactId,
            { message: s.message || '', mood: s.mood },
            s.game_time ? toGameTime(s.game_time) : (settlement.time ? toGameTime(settlement.time) : null)
          );
        }
        // 闭合 'new'→'injected' 循环（同老路径 react.js:1406）：PZGM 自管 prompt 注入（nextSave.sms），
        // 游戏侧 smsService 的 'new' 仅作显示；不闭合则积压，且若中途切回 react 会被一次性全量重注入。
        // injectionStatus 与 unreadCounts（未读徽章）相互独立 → 此调用不影响徽章。
        if (typeof smsService.markAllNewAsInjected === 'function') {
          try { smsService.markAllNewAsInjected(`turn_${turnNumber}`); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[pzgm] sms 投影失败:', e);
    }

    // [v1] 世界扩展：PZGM world_expansions 是【数组】，元素 {kind:'region'|'characters', brief, content}（区域/
    //   角色设定文本，非时间线事件）——已随 nextSave.worldExtensions 由引擎自身回灌 prompt，游戏侧无对应
    //   渲染 sink。v1 不投影（不再错误地塞进 timelineStore）；新角色已由 PZGM 内部 execNewNpc 走 new_cards 落地。
    // memory.turn_summary / chapter：已去重（2026-06-12）——applySideChannels 把引擎 aux 已产的 turn_summary
    //   （+ 章节边界并的 chapter）写入 aiService.lastEngineMemory；summaryService 的 AI_RESPONSE_COMPLETE 钩子
    //   复用之、跳过 host 那次重复的总结/章节 AI 调用（每回合省一次 pro 总结、每 20 回合省一次 pro 章节）。
  }

  function toGameTime(t) {
    if (!t) return null;
    return { year: t.year, month: t.month, day: t.day, timeStr: `${String(t.hour).padStart(2, '0')}:${String(t.minute || 0).padStart(2, '0')}` };
  }

  function currentAiTurnNumber() {
    // OOC 反问的提问条目（meta==='ooc_qa'）也是 sender:'ai'，但不是剧情回合——必须排除：
    // 否则它会虚增「停留轮数」(turnsAtLocation)，让节奏提示(PaceEngine)提前一回合触发。
    // 此函数同时是读(turnsAtLocation)与写(locationEnterTurn)两侧的同一来源，剔除后两侧仍一致。
    const isStoryTurn = (m) => m && m.sender === 'ai' && m.meta !== 'ooc_qa';
    try {
      if (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory)) {
        return chatHistory.filter(isStoryTurn).length;
      }
      if (Array.isArray(window.chatHistory)) {
        return window.chatHistory.filter(isStoryTurn).length;
      }
    } catch (_) {}
    return 0;
  }

  // ---------- 🎲 显式检定置位（diceMode UI 的骰子按钮调用）----------
  function requestCheckNextTurn(on = true) {
    state.pendingPlayerCheck = !!on;
  }

  function isRunning() {
    return state.running;
  }

  window.pzgmStoryController = {
    runTurn,
    requestCheckNextTurn,
    isRunning,
    // 暴露引擎存档 store 给调试/对账
    _pzgmStateStore: pzgmStateStore,
    // 探针：确认浏览器加载的是新版控制器 + 直接验开局时间解析（诊断「依然是1月1日」用）
    _version: '20260612h-pzgm-fullroute',
    _resolveOpeningEngineTime: resolveOpeningEngineTime,
    _buildWorldEventDirective: buildWorldEventDirective,
    _formatRoll: formatRoll,
  };
})();
