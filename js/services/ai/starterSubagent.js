// ============================================
// Starter Subagent（开局主角解析）
// ============================================
// 开局回合（PZGM Turn 1）在引擎写叙事【之前】跑一次的专用结构化调用：只解析并锁定
// 「主角是谁 + 在哪」（时间由 frozen_moment 透传，不在此决定）。由代码把主角卡落进
// 角色档案 + 把地点锁进 playerOpeningLockStore，再把"已锁定的事实"交给 Turn 1 纯写作。
// 一举根治：① 主角卡不保证存在（旧靠 GM 自觉调 new_npc，无兜底）；② 脆弱关键词分类
// （_detectOpeningChoice 子串匹配）；③ execNewNpc 白名单丢字段导致主角卡太薄。
//
// 输出 = 二选一判别式：
//   existing  → 用作者主角（character_database 里 is_protagonist 的角色，锁死、想改走 generated）
//   generated → 随机 + 自定义两种意图都由本 subagent 语义解析，吐一张厚卡
//
// 模型配置：独立模块键 'starter'（推荐模式 deepseek-v4-flash + thinking off；forced
// tool_choice 要求 thinking off，见 aiService RECOMMENDED_PHASE_MAP gate 注释）。
//
// 职责边界：本 subagent 只【resolve + L1–L3 校验 + L4 重试】，返回校验过的对象或 null；
//   落地（npcStore.add / lock.set / 引擎 save seed / L4 硬地板）由 pzgmStoryController 做
//   （它持有 prevSave / npcStore）。
// ============================================

// 工具声明：判别式 union 用单对象 + source enum 表达（避开 oneOf，DeepSeek function-calling 兼容）。
// is_protagonist 不进 AI schema（落地时代码强制置 true）。
const STARTER_TOOL_DECL = Object.freeze({
  name: 'resolve_starter',
  description:
    '锁定本局开场的【主角】与【开场地点】。只输出结构化数据，不要写任何叙事/散文。' +
    '地点必须从给定的候选地点池里选一条（不要凭空编新地点）。',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'object',
        description: '开场地点，必须命中候选地点池里的某一条（entity_id/country/site/spot 全部照抄那一条）。',
        properties: {
          entity_id: { type: 'string', description: '候选池里该地点所属 entity 的 id（照抄）。' },
          country: { type: 'string', description: '国家/区域（= entity display_name，照抄候选池）。' },
          site: { type: 'string', description: '地点（照抄候选池的 site）。' },
          spot: { type: 'string', description: '具体落点（照抄候选池的 spot）。' },
        },
        required: ['entity_id', 'country', 'site', 'spot'],
      },
      protagonist: {
        type: 'object',
        description: '玩家主角。source=existing 用作者主角；source=generated 现造一张。',
        properties: {
          source: {
            type: 'string',
            enum: ['existing', 'generated'],
            description:
              'existing=玩家要用作者推荐主角（character_database 里 is_protagonist 的角色）；' +
              'generated=随机 / 玩家自定义身份，由你现造。',
          },
          existing_id: {
            type: 'string',
            description: 'source=existing 时必填：character_database 里那个 is_protagonist 角色的 id。',
          },
          card: {
            type: 'object',
            description: 'source=generated 时必填：现造的主角卡（一张厚卡）。',
            properties: {
              id: { type: 'string', description: '蛇形小写英文 id（可留空让代码代生成）。' },
              name: { type: 'string', description: '主角姓名（契合世界；核心人物名只能用世界已有的，别凭空编）。' },
              gender: { type: 'string', description: '性别（可空）。' },
              age: { type: 'integer', description: '年龄（可空）。' },
              origin: { type: 'string', description: '出身/背景，一段人话。' },
              cognitive_state: { type: 'string', description: '此刻的自我认知/世界观（贴合 frozen 此刻）。' },
              initial_status: {
                type: 'string',
                description: '主角【个人】此刻的处境/姿态/状态——不要写外部冲突或情境（那是 Turn 1 的事）。',
              },
              personality: { type: 'string', description: '性格几个关键词。' },
              dialogue_tone: { type: 'string', description: '说话基调。' },
            },
            required: ['name', 'origin', 'cognitive_state', 'initial_status', 'personality', 'dialogue_tone'],
          },
        },
        required: ['source'],
      },
    },
    required: ['location', 'protagonist'],
  },
});

class _AIServiceStarterMixin {
  /**
   * 读世界卡 entity.sites → 候选地点池（与 openingWizardUI._readSitesForActiveEntities 同源逻辑）。
   * @returns {Array<{entity_id:string,country:string,site:string,spot:string,atmosphere:string,fullPath:string}>}
   */
  _readStarterSitesPool() {
    try {
      const card = window.worldCardManager?.getActiveCardRaw?.();
      const settings = card?.snapshot?.world_setting?.settings;
      if (!settings || typeof settings !== 'object') return [];
      const out = [];
      for (const eid of Object.keys(settings)) {
        if (eid.startsWith('_')) continue;
        const val = settings[eid];
        if (!val || typeof val !== 'object' || Array.isArray(val)) continue; // V1 字符串实体跳过
        // 经 flattenEntitySites 容错展开（吃旧扁平 / 新 site 树都行），候选池输出契约不变。
        const rows = typeof window.flattenEntitySites === 'function'
          ? window.flattenEntitySites(val, eid)
          : [];
        for (const r of rows) {
          if (!r.site && !r.spot) continue;
          out.push({
            entity_id: eid,
            country: r.country,
            site: r.site,
            spot: r.spot,
            atmosphere: r.atmosphere,
            fullPath: r.fullPath,
          });
        }
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  /** character_database 里所有角色名（命名约束用：核心人物名只能从这里取）。 */
  _readStarterCoreFigureNames() {
    try {
      const db = window.worldCardManager?.getActiveCardRaw?.()?.snapshot?.character_database;
      if (!db || typeof db !== 'object') return [];
      return Object.keys(db)
        .filter(k => !k.startsWith('_'))
        .map(k => (db[k] && typeof db[k] === 'object' ? db[k].name : null))
        .filter(n => typeof n === 'string' && n.trim());
    } catch (_) {
      return [];
    }
  }

  /** 作者主角（character_database 里 is_protagonist 的角色）→ {id, name} 或 null。 */
  _findStarterAuthoredProtagonist() {
    try {
      const db = window.worldCardManager?.getActiveCardRaw?.()?.snapshot?.character_database;
      if (!db || typeof db !== 'object') return null;
      const hits = [];
      for (const [k, v] of Object.entries(db)) {
        if (k.startsWith('_')) continue;
        if (v && typeof v === 'object' && window.characterFields?.isProtagonist?.(v)
            && typeof v.name === 'string' && v.name.trim()) {
          hits.push({ id: k, name: v.name.trim() });
        }
      }
      if (hits.length > 1) {
        console.warn(`[Starter] character_database 有 ${hits.length} 个 is_protagonist 条目（应仅 1 个），取首个：${hits.map(h => h.id).join(', ')}`);
      }
      return hits[0] || null;
    } catch (_) {}
    return null;
  }

  /**
   * 把已知开场按钮的玩家输入硬映射成判别式 source —— 点了按钮 = 意图已 100% 确定，不交给 LLM 自由判别
   * （曾把"随机主角开场"错判成 existing、套了作者推荐主角；见 chatCore.renderOpeningChoiceButtonsHtml）。
   * 这些是 chatCore `_getInlineActionLabel(...)` 产出的固定 sentinel（zh/en），点击后原样作为玩家输入发出。
   * 自由打字（非按钮）返回 null → 仍由 subagent 语义判别。
   * @returns {'generated'|'existing'|null}
   */
  _starterForcedSource(raw) {
    const s = (typeof raw === 'string' ? raw : '').trim();
    if (!s) return null;
    // 单一真源：js/config/openingButtonSentinels.js（与 chatCore 渲染同一份，防文案漂移）。
    const S = (typeof window !== 'undefined' && window.OPENING_BUTTON_SENTINELS) || null;
    if (S) {
      for (const k of Object.keys(S)) {
        const b = S[k];
        if (b && (s === b.zh || s === b.en)) return b.source || null;
      }
      return null;
    }
    // 兜底（常量未加载，理论不会）：保底硬编码
    const GENERATED = ['随机主角开场', 'Start with a random protagonist', '以「普通人」身份开场', 'Start as an ordinary person'];
    const EXISTING = ['以推荐主角开场', 'Start as the recommended protagonist'];
    if (GENERATED.includes(s)) return 'generated';
    if (EXISTING.includes(s)) return 'existing';
    return null;
  }

  /**
   * 校验 starter 工具输出（L2 形状 + L3 引用 + L3.5 强制 source）。返回 { ok, error, value }。
   * value = 规整后的 { location:{entity_id,country,site,spot,fullPath}, protagonist }
   * @param {'generated'|'existing'|null} forcedSource - 按钮已定死的判别式；非空时 source 必须等于它
   */
  _validateStarterOutput(args, sitesPool, authoredProtagId, forcedSource = null) {
    if (!args || typeof args !== 'object') return { ok: false, error: '空输出' };
    const loc = args.location;
    const prot = args.protagonist;
    // L2 形状：location 四字段
    if (!loc || typeof loc !== 'object') return { ok: false, error: 'location 缺失' };
    for (const f of ['entity_id', 'country', 'site', 'spot']) {
      if (typeof loc[f] !== 'string' || !loc[f].trim()) return { ok: false, error: `location.${f} 空` };
    }
    // L3 引用：location 必须命中候选池（按 entity_id + site + spot 匹配）
    let matched = null;
    if (sitesPool.length) {
      matched = sitesPool.find(
        s => s.entity_id === loc.entity_id && s.site === loc.site.trim() && s.spot === loc.spot.trim()
      ) || sitesPool.find(s => s.site === loc.site.trim() && s.spot === loc.spot.trim());
      if (!matched) return { ok: false, error: `location 不在候选池：${loc.site}/${loc.spot}` };
    }
    const location = matched
      ? { ...matched }
      : { ...loc, fullPath: [loc.country, loc.site, loc.spot].filter(Boolean).join(' / ') };

    // L2/L3 主角
    if (!prot || typeof prot !== 'object') return { ok: false, error: 'protagonist 缺失' };
    // L3.5 强制 source：玩家点了按钮 → source 已定死，模型偏了直接打回重试（曾把"随机主角"判成 existing）
    if (forcedSource && prot.source !== forcedSource) {
      return { ok: false, error: `source 必须为 ${forcedSource}（玩家已用按钮明确意图），不是 ${prot.source}` };
    }
    if (prot.source === 'existing') {
      if (typeof prot.existing_id !== 'string' || !prot.existing_id.trim()) {
        return { ok: false, error: 'existing 缺 existing_id' };
      }
      // L3：existing 仅在本卡确有作者主角时合法，且 id 必须就是那个作者主角（防引用不存在的角色 →
      //   processNpcPanel 静默落空 → 没有主角）。无作者主角时强制改走 generated。
      if (!authoredProtagId) {
        return { ok: false, error: '本卡无作者主角，不能用 existing，请改用 generated 现造' };
      }
      if (prot.existing_id.trim() !== authoredProtagId) {
        return { ok: false, error: `existing_id 非作者主角（应为 ${authoredProtagId}）：${prot.existing_id}` };
      }
      return { ok: true, value: { location, protagonist: { source: 'existing', existing_id: prot.existing_id.trim() } } };
    }
    if (prot.source === 'generated') {
      const c = prot.card;
      if (!c || typeof c !== 'object') return { ok: false, error: 'generated 缺 card' };
      for (const f of ['name', 'origin', 'cognitive_state', 'initial_status', 'personality', 'dialogue_tone']) {
        if (typeof c[f] !== 'string' || !c[f].trim()) return { ok: false, error: `card.${f} 空` };
      }
      return { ok: true, value: { location, protagonist: { source: 'generated', card: c } } };
    }
    return { ok: false, error: `未知 source：${prot.source}` };
  }

  _buildStarterSystemText(playerInput, sitesPool, coreFigures, authored, initText, isEnglish, forcedSource = null) {
    const hasSites = sitesPool.length > 0;
    const frozenText = (playerInput && playerInput.frozenText) || '';
    const rawLine = (playerInput && playerInput.raw && playerInput.raw.trim()) ? playerInput.raw.trim() : '';
    // 按钮已定死判别式时，把它作为最高优先级硬约束顶在最前面（不让模型自由判 existing/generated）
    const forcedLine = !forcedSource ? ''
      : isEnglish
        ? (forcedSource === 'generated'
            ? '**HARD CONSTRAINT (the player clicked the "random / ordinary person" button): you MUST output source=generated and create a brand-new protagonist. Do NOT output existing; do NOT reuse the author\'s recommended protagonist.**'
            : `**HARD CONSTRAINT (the player chose the recommended protagonist): you MUST output source=existing with existing_id=${authored ? authored.id : ''}.**`)
        : (forcedSource === 'generated'
            ? '**硬约束（玩家点的是"随机主角 / 普通人"按钮）：你必须输出 source=generated，现造一张全新主角卡。禁止输出 existing，禁止套用作者推荐主角。**'
            : `**硬约束（玩家选了推荐主角）：你必须输出 source=existing，existing_id=${authored ? authored.id : ''}。**`);

    if (isEnglish) {
      const sitesList = hasSites
        ? sitesPool.map((s, i) => `  ${i + 1}. entity_id=${s.entity_id} | ${s.fullPath}${s.atmosphere ? ` (${s.atmosphere})` : ''}`).join('\n')
        : '  (no structured sites on this card — give one concrete, coherent location based on the world setting)';
      const figuresLine = coreFigures.length ? coreFigures.join(', ') : '(none)';
      const authoredLine = authored
        ? `This card HAS an author-recommended protagonist: id=${authored.id}, name "${authored.name}". If the player means "use the recommended protagonist", return source=existing + existing_id=${authored.id}.`
        : 'This card has NO author-recommended protagonist; if the player clicks "recommended", still generate one that fits the world.';
      const locRule = hasSites
        ? '- location MUST copy one entry from the candidate site pool below (entity_id/country/site/spot copied verbatim); do NOT invent a new region/country.'
        : '- This card has no structured site pool; give one concrete, coherent location consistent with the world setting (fill all four fields).';
      return [
        'You are the opening protagonist resolver (starter). Your only job: read the player\'s opening input + the world card, decide WHO the protagonist is and WHERE the opening is, then call the resolve_starter tool. **Only emit the tool call — never write any narrative/prose.**',
        ...(forcedLine ? ['', forcedLine] : []),
        '',
        '## Discriminator',
        `- existing: when the player wants the author\'s recommended protagonist. ${authoredLine}`,
        '- generated: when the player clicks "random", clicks "ordinary person", or types their own identity (e.g. "I want to be an Ultraman") — you generate the protagonist card.',
        '  · If the player gave a concrete identity (custom), you MUST honor it; only adapt it to fit this world (its terms/setting). NEVER silently replace it with an unrelated ordinary character.',
        '  · If the player wants random / ordinary, freely pick an identity fitting this moment.',
        '',
        '## Generated card field boundaries',
        '- origin = background; cognitive_state = the character\'s self-perception/worldview at this moment (fit the "now" below).',
        '- initial_status = the protagonist\'s PERSONAL situation/posture/physical state right now (where they are, what condition) — do NOT write external events/conflict/scene; that is the opening narration (Turn 1).',
        '- Do not output dialogue examples, relationships, or appearance.',
        '',
        '## Naming / anti-drift',
        `- Key-figure names may only reuse ones already in this world (${figuresLine}); do NOT invent a new key-figure name. Ordinary new characters may be named freely.`,
        '- Do not auto-assign anonymous fait-accompli timeline events ("some disciple/merchant/refugee") to the player unless the player explicitly takes one up.',
        '',
        '## Location',
        locRule,
        '',
        '## Author opening & world rules (to understand the world + default origin tone)',
        (initText && initText.trim()) ? initText.trim() : '(none)',
        '',
        '## The locked opening moment',
        frozenText || '(time is anchored by runtime)',
        '',
        '## Candidate site pool',
        sitesList,
        '',
        '## The player\'s opening input',
        rawLine ? `"${rawLine}"` : '(the player did not specify — generate a protagonist fitting this moment, as for "random")',
      ].join('\n');
    }

    // ── 中文 ──
    const sitesList = hasSites
      ? sitesPool.map((s, i) => `  ${i + 1}. entity_id=${s.entity_id} | ${s.fullPath}${s.atmosphere ? `（${s.atmosphere}）` : ''}`).join('\n')
      : '  （本卡未提供结构化 sites——请据世界设定给一个具体、合理的地点）';
    const figuresLine = coreFigures.length ? coreFigures.join('、') : '（无）';
    const authoredLine = authored
      ? `本卡有作者推荐主角：id=${authored.id}，姓名「${authored.name}」。玩家若意在"用推荐主角"，用 source=existing + existing_id=${authored.id}。`
      : '本卡没有作者推荐主角；玩家若点"推荐主角"也按 generated 现造一个契合世界的主角。';
    const locRuleZh = hasSites
      ? '- location 必须从下面候选地点池里选一条，entity_id/country/site/spot 照抄那一条，不要改写近义名、不要新造区域。'
      : '- 本卡没有结构化候选地点池；请据世界设定给一个具体、合理的地点（四个字段都填上）。';
    return [
      '你是开局主角解析器（starter）。你的唯一任务：读玩家的开场输入 + 世界卡，确定本局【主角是谁】和【开场地点】，',
      '然后调用 resolve_starter 工具输出结构化结果。**只输出工具调用，绝不写任何叙事/散文/旁白。**',
      ...(forcedLine ? ['', forcedLine] : []),
      '',
      '## 判别式',
      `- existing：玩家想用作者推荐主角时用。${authoredLine}`,
      '- generated：玩家点"随机主角"、点"普通人"、或自己打字描述身份（如"我想当个游方郎中"）时用——你现造一张主角卡。',
      '  · 玩家给了具体身份念头（自定义）→ **必须接住它**，只做世界化调整（让它落进本世界的称谓/设定），**绝不静默替换成一个无关的普通角色**。',
      '  · 玩家要随机 / 普通人 → 你按世界自由配一个契合此刻的身份。',
      '',
      '## 主角卡字段边界（generated）',
      '- origin=出身背景；cognitive_state=此刻的自我认知/世界观（贴合下方"此刻"）。',
      '- initial_status=主角【个人】此刻的处境/姿态/身体状态（在哪、什么状态）——**不要写外部事件/冲突/情境**，那是开场叙事（Turn 1）的事。',
      '- 不要输出对话范例、关系、外貌。',
      '',
      '## 命名 / 防漂移',
      `- 核心大人物名只能用世界已有的（${figuresLine}），**不要凭空编新的核心人物名**；普通新角色可自由起名。`,
      '- 不要把世界时间线里"某弟子/某商人/某流民"这类匿名既成事实事件自动安到玩家头上，除非玩家明确承接。',
      '',
      '## 地点',
      locRuleZh,
      '',
      '## 作者开场与世界规则参考（理解世界 + 默认出身基调用）',
      (initText && initText.trim()) ? initText.trim() : '（无）',
      '',
      '## 本局开场此刻',
      frozenText || '（时间由运行时锚定）',
      '',
      '## 候选地点池',
      sitesList,
      '',
      '## 玩家的开场输入',
      rawLine ? `「${rawLine}」` : '（玩家未明说——按"随机主角"现造一个契合此刻的主角）',
    ].join('\n');
  }

  /**
   * 跑一次 starter 解析。返回校验过的 { location, protagonist } 或 null（彻底失败，调用方走硬地板）。
   * @param {Object|null} openCtx - _activeOpeningTimeContext（含 selectedTimeText 等）
   * @param {string} playerInputRaw - 玩家开场原话（按钮发的固定串 / 自定义打字）
   * @param {AbortSignal|null} signal
   * @returns {Promise<Object|null>}
   */
  async _runStarterSubagent(openCtx, playerInputRaw = '', signal = null) {
    if (!this.reactLoop) {
      console.warn('[Starter] reactLoop 未初始化，跳过（调用方走硬地板）');
      return null;
    }
    let adapter;
    try {
      adapter = this._getAdapter('starter', AI_REQUEST_SCOPED);
    } catch (e) {
      console.warn('[Starter] 无法构建 starter adapter，跳过:', e?.message || e);
      return null;
    }
    if (!adapter) return null;

    const isEnglish = this._getGamePromptLanguage?.() === 'en';
    const sitesPool = this._readStarterSitesPool();
    const coreFigures = this._readStarterCoreFigureNames();
    const authored = this._findStarterAuthoredProtagonist();
    // 按钮 sentinel → 定死判别式（点"随机/普通人"=generated、点"推荐主角"=existing）；自由打字=null 仍交模型判。
    let forcedSource = this._starterForcedSource(playerInputRaw);
    // existing 仅在本卡确有作者主角时成立——无作者主角时降级让模型自判，免得 hard-reject 卡死走硬地板。
    if (forcedSource === 'existing' && !authored) forcedSource = null;
    const initText = window.worldMeta?.getRuleModule?.('init') || '';
    const frozen = window.worldMeta?.getFrozenMoment?.() || null;
    const frozenStamp = openCtx?.selectedTimeText || frozen?.datetime || '';
    const frozenText = frozenStamp
      ? (isEnglish
          ? `Time is anchored to: ${frozenStamp}${frozen?.label ? ` (${frozen.label})` : ''}. The protagonist's cognition/state must fit this moment.`
          : `时间锚定在：${frozenStamp}${frozen?.label ? `（${frozen.label}）` : ''}。主角的认知/状态要贴合这个此刻。`)
      : '';

    const playerInput = { raw: playerInputRaw, frozenText };
    const adapterTools = this.reactLoop.buildAdapterTools([STARTER_TOOL_DECL], adapter);
    const temperature = this.getModuleTemperature('starter', 0.8, AI_REQUEST_SCOPED);
    const family = adapter?.protocolFamily || adapter?.provider || 'gemini';
    const userContent = isEnglish
      ? 'Call resolve_starter and output the locked protagonist and opening location for this run. Emit only the tool call; no narrative.'
      : '请调用 resolve_starter，输出本局锁定的【主角】与【开场地点】。只输出工具调用，不要写叙事。';
    const mkUserMessage = () =>
      family === 'gemini'
        ? { role: 'user', parts: [{ text: userContent }] }
        : family === 'anthropic'
          ? { role: 'user', content: [{ type: 'text', text: userContent }] }
          : { role: 'user', content: userContent };

    // L4 重试：最多 2 次（首发 + 1 次回喂校验错误）。forced tool_choice → thinking off。
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      let systemText = this._buildStarterSystemText(playerInput, sitesPool, coreFigures, authored, initText, isEnglish, forcedSource);
      if (attempt > 0 && lastError) {
        systemText += isEnglish
          ? `\n\n## Previous output was invalid (retry)\nProblem: ${lastError}\nFollow the schema strictly; the location must copy one entry from the candidate pool.`
          : `\n\n## 上次输出无效（修正后重试）\n问题：${lastError}\n请严格按 schema 重新输出，地点务必从候选池照抄一条。`;
      }
      const { payload, url } = adapter.buildPayload(
        [mkUserMessage()],
        [{ text: systemText, cacheable: false, tag: 'starter' }],
        adapterTools,
        // forced tool：用 {name} 对象形（adapter 单工具时降级为服务端 'required'）。
        // 注意：字符串 'required' 不被 adapter 识别 → 落 'auto'，等于没强制（aiAdapters.js:1372-1382）。
        { temperature, thinking: 'off', toolChoice: { name: STARTER_TOOL_DECL.name } }
      );
      const stepLog = {
        step: 'opening',
        phase: 'starter',
        model: this.getModelForModule('starter', AI_REQUEST_SCOPED),
        provider: adapter.getProviderLabel(),
        request: this._cloneSerializable(payload),
        // 让 debug Zone B 显示 prompt 结构（与 react/pzgm 步同形，否则纯工具调用步 Zone B 输入侧空白）。
        systemPartsDebug: [{ order: 1, name: 'starter_system_prompt', length: (systemText || '').length, status: 'active' }],
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
          subsystem: 'starter',
          parentRequestId: null,
          provider: adapter.getProviderLabel(),
          model: this.getModelForModule('starter', AI_REQUEST_SCOPED),
          durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
          metrics: apiResult?.metrics || null,
          ok: true,
        });
      } catch (e) {
        this._markStepFailure?.(stepLog, e, { phase: 'starter', module: 'starter', provider: adapter.getProviderLabel(), model: this.getModelForModule('starter', AI_REQUEST_SCOPED), url });
        this._trackSubagentCall({
          subsystem: 'starter', parentRequestId: null, provider: adapter.getProviderLabel(),
          model: this.getModelForModule('starter', AI_REQUEST_SCOPED),
          durationMs: ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - _t0,
          ok: false, errorMessage: e?.message || String(e),
        });
        if (signal?.aborted) return null; // 用户取消，别重试
        lastError = e?.message || String(e);
        continue;
      }

      // L1 解析
      const parsed = adapter.parseToolCalls(apiResult.raw);
      const calls = parsed?.needsRecovery ? parsed.recoveredCalls : (parsed?.toolCalls || []);
      const call = (calls || []).find(c => c && c.name === STARTER_TOOL_DECL.name) || (calls || [])[0];
      if (!call || !call.args) {
        lastError = '未产出工具调用（疑似写了散文）';
        stepLog.toolCalls = [];
        console.warn('[Starter] L1 解析失败：', lastError);
        continue;
      }
      // L2/L3 校验
      const v = this._validateStarterOutput(call.args, sitesPool, authored?.id || null, forcedSource);
      stepLog.toolCalls = [{ name: call.name, args: call.args, success: v.ok, error: v.ok ? undefined : v.error }];
      if (v.ok) {
        console.log('[Starter] 解析成功：', v.value.protagonist.source, '@', v.value.location.fullPath);
        return v.value;
      }
      lastError = v.error;
      console.warn('[Starter] L2/L3 校验失败：', v.error);
    }
    console.warn('[Starter] 重试用尽，返回 null（调用方走硬地板）');
    return null;
  }
}

// 合并 mixin 到 AIService.prototype（与 npcIntroAuditSubagent.js 同形）
(function _applyStarterMixin() {
  if (typeof AIService === 'undefined') {
    console.warn('[Starter] AIService 未定义，mixin 跳过（加载顺序问题）');
    return;
  }
  const proto = _AIServiceStarterMixin.prototype;
  Object.getOwnPropertyNames(proto).forEach(name => {
    if (name === 'constructor') return;
    AIService.prototype[name] = proto[name];
  });
})();

if (typeof window !== 'undefined') {
  window.STARTER_TOOL_DECL = STARTER_TOOL_DECL;
}
