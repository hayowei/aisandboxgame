// ============================================
// OpeningController - 开场流程统一控制器
// ============================================
// 将三套开场信号（opening_greeting / init / openingTimeContext）
// 收敛为单一 resolve() 输出，消除 prompt 冲突
// ============================================

class OpeningController {
  /**
   * @param {Object} aiService - AIService 实例
   */
  constructor(aiService) {
    this._ai = aiService;
  }

  /**
   * 统一开场解析入口
   * @param {Array} messages - 消息历史
   * @param {string|null} lastGameState - 上一轮游戏状态（非首轮时有值）
   * @param {string} lastUserMessage - 玩家最新消息
   * @returns {{ promptText: string|null, mode: string|null, isOpening: boolean }}
   */
  resolve(messages, lastGameState, lastUserMessage) {
    // 非首轮：不注入任何开场内容
    const modelMessageCount = Array.isArray(messages)
      ? messages.filter(m => m.role === 'model').length
      : 0;
    if (lastGameState || modelMessageCount > 1) {
      return { promptText: null, mode: null, isOpening: false };
    }

    // 检测开场模式。新卡：frozen_moment 已锁定此刻（_activeOpeningTimeContext.mode==='frozen'），
    // 优先走 frozen，不再按玩家消息里的随机/推荐关键词分流。
    const activeCtx = this._ai._activeOpeningTimeContext;
    const isFrozen = activeCtx?.mode === 'frozen' && !activeCtx?.blocked;
    const mode = isFrozen ? 'frozen' : this._detectMode(lastUserMessage, lastGameState);

    // 获取 init 模块文本
    const initText = window.worldMeta?.getRuleModule?.('init') || '';
    const initRules = this._parseInitRules(initText);

    // 获取 openingTimeContext（random/recommended/frozen 模式）
    const openingContext = (mode === 'random' || mode === 'recommended' || mode === 'frozen')
      ? activeCtx
      : null;

    // 组装 prompt
    const promptText = this._buildPromptText(mode, openingContext, initRules, initText, lastUserMessage);

    const resolvedMode = mode || (initRules.length > 0 ? 'player_specified' : 'questionnaire');

    console.log(
      `[OpeningController] mode=${resolvedMode}, ` +
      `rules=[${(OpeningController.RULES_BY_MODE[resolvedMode] || []).join(',')}], ` +
      `hasEvent=${!!(openingContext && !openingContext.blocked)}, ` +
      `hasInitRules=${initRules.length > 0}`
    );

    return {
      promptText,
      mode: resolvedMode,
      isOpening: true,
    };
  }

  /**
   * 检测开场模式
   * @returns {'random'|'recommended'|null}
   */
  _detectMode(lastUserMessage, lastGameState) {
    return this._ai._getOpeningRequestMode(lastUserMessage, lastGameState);
  }

  /**
   * 解析 init 模块文本为编号规则数组
   * 支持格式：数字. 或数字、或数字) 开头的行
   * @param {string} initText
   * @returns {Array<{number: number, text: string}>}
   */
  _parseInitRules(initText) {
    if (!initText || typeof initText !== 'string') return [];

    const lines = initText.split('\n');
    const rules = [];
    let currentRule = null;

    for (const line of lines) {
      // 匹配编号行：1. / 1、/ 1) / 1： 等
      const match = line.match(/^\s*(\d+)\s*[.、)：:]\s*(.*)$/);
      if (match) {
        if (currentRule) rules.push(currentRule);
        currentRule = { number: parseInt(match[1], 10), text: match[2].trim() };
      } else if (currentRule && line.trim()) {
        // 续行：追加到当前规则
        currentRule.text += '\n' + line.trim();
      }
    }
    if (currentRule) rules.push(currentRule);

    return rules;
  }

  /**
   * 按模式过滤规则
   * @param {Array<{number: number, text: string}>} rules
   * @param {string} mode
   * @returns {Array<{number: number, text: string}>}
   */
  _selectRulesForMode(rules, mode) {
    const allowedNumbers = OpeningController.RULES_BY_MODE[mode];
    if (!allowedNumbers) return rules; // 未知模式，返回全部
    return rules.filter(r => allowedNumbers.includes(r.number));
  }

  /**
   * 组装最终的 prompt 文本
   * @param {string|null} mode - 'random'|'recommended'|null
   * @param {Object|null} openingContext - _activeOpeningTimeContext
   * @param {Array} initRules - 解析后的规则数组
   * @param {string} initText - 原始 init 文本（降级用）
   * @returns {string|null}
   */
  _buildPromptText(mode, openingContext, initRules, initText, lastUserMessage) {
    const effectiveMode = mode || 'player_specified';
    const parts = [];

    // ── 标题 ──
    const modeLabels = {
      random: '随机开局',
      recommended: '推荐剧情开局',
      player_specified: '玩家指定开局',
      frozen: '此刻已锁定',
    };
    parts.push(`## 开场引导（${modeLabels[effectiveMode] || '开局'}）`);

    // ── 作者开场白（opening_greeting）：已作为首条消息展示给玩家，承接它往下写。
    //    此前两个大脑（React/PZGM）都没把它喂进 Turn1——与开场白语法承诺矛盾，此处补上。──
    const greetingSection = this._formatOpeningGreetingContext();
    if (greetingSection) parts.push(greetingSection);

    // 身份/地点/时间锚：主角与地点已由 starter 在引擎写叙事前锁定（落 npcStore + playerOpeningLockStore）。
    // 这里只把"已锁定的事实"拼成 Turn-1 写作指令——不再做关键词分类、不再决定玩家扮演谁。
    const isEnglish = this._ai._getGamePromptLanguage?.() === 'en';
    if (openingContext && effectiveMode === 'frozen') {
      const frozenSection = this._formatFrozenContext(openingContext, lastUserMessage);
      if (frozenSection) parts.push(frozenSection);
      else parts.push(this._formatLockedProtagonistSection(isEnglish));
    } else if (openingContext && (effectiveMode === 'random' || effectiveMode === 'recommended')) {
      // 事件锚（开场情境，仍归 Turn 1）+ 已锁定主角
      const eventSection = this._formatEventContext(openingContext, effectiveMode);
      if (eventSection) parts.push(eventSection);
      parts.push(this._formatLockedProtagonistSection(isEnglish));
    } else {
      parts.push(this._formatLockedProtagonistSection(isEnglish));
    }

    // ── 过滤后的 init 规则 ──
    if (initRules.length > 0) {
      const filtered = this._selectRulesForMode(initRules, effectiveMode);
      if (filtered.length > 0) {
        const rulesText = filtered.map(r => `${r.number}. ${r.text}`).join('\n');
        parts.push(`### 开场规则\n\n${rulesText}`);
      } else {
        // 过滤全空：规则编号全不在当前模式允许列表内，降级到原始文本整体注入
        parts.push(`### 开场规则\n\n${initText.trim()}`);
      }
    } else if (initText && initText.trim()) {
      // 降级：init 模块格式非标准，无法解析为编号规则，整体注入
      parts.push(`### 开场规则\n\n${initText.trim()}`);
    }

    // 无任何内容时不注入
    if (parts.length <= 1) return null; // 只有标题，没有实质内容

    return parts.join('\n\n');
  }

  /**
   * 格式化"锁定的此刻"为 prompt 段落（新卡 frozen_moment + player_opening_lock）
   * @param {Object} context - _activeOpeningTimeContext（mode==='frozen'）
   * @returns {string|null}
   *
   * 三段拼接：① 时间锚（frozen_moment.datetime）/ ② 地点锚（lock.location_site）
   *         / ③ 玩家身份（lock.mode + lock.player_role）
   * 老卡不应进 frozen 分支，此函数 lock 缺失时也容错（仅输出时间锚段）。
   */
  _formatFrozenContext(context, lastUserMessage) {
    if (!context || !context.selectedTimeText) return null;
    const isEnglish = this._ai._getGamePromptLanguage?.() === 'en';
    // 地点由 starter 锁进 playerOpeningLockStore.location_site；主角由 starter 落进 npcStore。
    const lock = (typeof window !== 'undefined' && window.playerOpeningLockStore?.get?.()) || null;
    const RANDOM = (typeof window !== 'undefined' && window.openingWizardUI?.RANDOM_SENTINEL) || '__RANDOM__';

    if (isEnglish) {
      const parts = [
        `### Fixed Opening Moment`,
        '',
        `This card is frozen to a single "now". Opening time: ${context.selectedTimeText}.`,
        `The first paragraph of Step 2 must land on this exact moment naturally. ` +
        `Do NOT ask the player to choose a time — treat the player's first message as their first in-world action. ` +
        `panel_status.datetime is backfilled by runtime code.`,
        `Turn-1 opening rules (hard): ` +
        `(1) Open the first paragraph on action already in progress at this moment — no retrospective recap, no static scenery warm-up. ` +
        `(2) End the narration on an unresolved situation pressing directly on the player, leaving the next move entirely to them. ` +
        `(3) Never act, decide, or speak for the player — the first real verb of this story belongs to the player.`,
      ];
      if (lock && lock.location_site && lock.location_site !== RANDOM) {
        parts.push(
          `\n**Opening site is fixed to:** ${lock.location_site}. ` +
          `This is a 3-segment path "country / site / spot". Step 2 narrative and panel_status.location must use these exact three values ` +
          `(split on " / ": .country = seg 1, .site = seg 2, .spot = seg 3). Don't rename to a synonym; don't dump the whole string into one field.`
        );
      } else {
        parts.push(
          `\n**Opening site:** Sandbox random — pick a coherent specific place (fitting this moment) from the world card's existing entity places; do NOT invent a new region/country. ` +
          `Fill panel_status.location three fields strictly from a real place: country = entity.display_name, site = one of its site names, spot = a spot under that site.`
        );
      }
      parts.push(this._formatLockedProtagonistSection(true));
      return parts.join('\n');
    }

    // 中文版
    const parts = [
      `### 开场此刻已锁定`,
      '',
      `这张卡锁定在一个固定的"此刻"。开场时间：${context.selectedTimeText}。`,
      `Step 2 正文第一段必须自然落地这个此刻。` +
      `禁止询问玩家选时间——把玩家的第一条消息当作他在此刻的第一个行动。` +
      `panel_status.datetime 由运行时代码回填。`,
      `首轮起笔铁律：` +
      `① 第一段开在此刻已进行中的动作上——禁止事后回顾、禁止静态环境描写起手；` +
      `② 正文收尾停在一个直接压到玩家面前的未决处境上，把下一步完全交给玩家；` +
      `③ 绝不替玩家做动作、做决定或说台词——这个故事第一个真正的动词必须由玩家自己写出。`,
    ];
    if (lock && lock.location_site && lock.location_site !== RANDOM) {
      parts.push(
        `\n**开场地点固定为：** ${lock.location_site}。` +
        `这是 "country / site / spot" 三段路径（用 " / " 分隔，正好三段）。` +
        `Step 2 正文和 \`panel_status.location\` 三字段必须严格用这三个值——` +
        `\`panel_status.location.country\` = 第一段，\`.site\` = 第二段，\`.spot\` = 第三段。` +
        `不要把整串塞进单个字段，不要改写成近义地名。`
      );
    } else {
      parts.push(
        `\n**开场地点：** 沙盒随机——由你从世界卡已有的地点里挑一个合理、契合此刻的具体地点开场，不要凭空捏造新区域/国家。` +
        `\`panel_status.location\` 三字段严格按真实地点填：country = 所属 entity 的 display_name，site = 其下某个 site 名，spot = 该 site 下的某个 spot 名。`
      );
    }
    parts.push(this._formatLockedProtagonistSection(false));
    return parts.join('\n');
  }

  /**
   * 已锁定主角段（starter 已落卡 + 锁定）。读 npcStore 里的 is_protagonist 主角名，拼成
   * Turn-1 写作指令：「你扮演 X（已在档案、第二人称、别 new_npc 重复建）」。
   * @param {boolean} isEnglish
   * @returns {string}
   */
  _formatLockedProtagonistSection(isEnglish) {
    let name = '';
    try {
      const store = typeof window !== 'undefined' ? window.npcStore : null;
      const heroId = store && typeof store.getProtagonistRuntimeId === 'function'
        ? store.getProtagonistRuntimeId() : null;
      name = heroId ? ((store.get?.(heroId)?.card?.name) || '') : '';
      // 'existing' 路径走 processNpcPanel 是 setTimeout 异步落卡 → 此刻 npcStore 可能还没主角；
      // 回退用 lock.player_role(=starter 落的 heroId) 去 character_database 取名。
      if (!name) {
        const lockedId = window.playerOpeningLockStore?.get?.()?.player_role;
        if (lockedId && typeof lockedId === 'string') {
          const db = window.worldCardManager?.getActiveCardRaw?.()?.snapshot?.character_database;
          const ch = db && typeof db === 'object' ? db[lockedId] : null;
          if (ch && typeof ch.name === 'string' && ch.name.trim()) name = ch.name.trim();
        }
      }
    } catch (_) {}
    if (name) {
      return isEnglish
        ? `\n**Player plays:** ${name} — already registered in the character roster as the \`is_protagonist\` character (= the player). Narrate in second person; do NOT \`new_npc\` them again or treat them as a bystander to "meet". Pull their origin / cognitive_state / initial_status from the roster and show them in the opening.`
        : `\n**玩家扮演：** ${name}——已作为 \`is_protagonist\` 角色登记在角色档案（代表玩家本人）。用第二人称叙事，**不要**用 \`new_npc\` 重复创建、也不要把 TA 当成要"遇见"的旁观角色。origin / cognitive_state / initial_status 从角色档案读取并体现在开场叙事里。`;
    }
    // 防御：starter 落卡异常（理论上不会，硬地板兜底）→ 退回"玩家首条消息即身份"
    return isEnglish
      ? `\n**Player role:** Treat the player's first message as their chosen identity and land the opening from it. Do NOT ask "who are you".`
      : `\n**玩家身份：** 把玩家的第一条消息当作他选择的开场身份，据此落地开场，不要反问"你是谁"。`;
  }

  /**
   * 格式化锁定事件为 prompt 段落
   * 复用 _buildOpeningTimePromptText 的逻辑
   * @param {Object} context - _activeOpeningTimeContext
   * @param {string} mode
   * @returns {string|null}
   */
  _formatEventContext(context, mode) {
    if (!context) return null;

    const isEnglish = this._ai._getGamePromptLanguage?.() === 'en';

    // blocked 场景：无可用 timeline 事件
    if (context.blocked) {
      const timeHint = context.selectedTimeText
        ? (isEnglish
            ? `\nOpening time is fixed to: ${context.selectedTimeText}.`
            : `\n首轮时间固定为：${context.selectedTimeText}。`)
        : '';
      const guidance = isEnglish
        ? `### Opening Event Anchor Unavailable\n\nNo matching timeline event was found for this opening mode. ${context.message || ''}${timeHint}\nUse the init module's recommended opening line as your primary guide.`
        : `### 开场事件锚点不可用\n\n当前模式未找到匹配的 timeline 事件。${context.message || ''}${timeHint}\n请参考开场规则中的推荐剧情行作为首要引导。`;
      return guidance;
    }

    // 正常场景：有锁定事件
    if (!context.selectedTimeText) return null;

    const modeLabel = mode === 'recommended'
      ? (isEnglish ? 'Recommended Opening' : '推荐开局')
      : (isEnglish ? 'Random Opening' : '随机开局');

    const locationText = context.selectedLocation
      ? (isEnglish
          ? `\nOpening location is fixed to: ${this._ai._formatOpeningLocationText(context.selectedLocation)}. Step 2 narrative and panel_status.location must use this exact location.`
          : `\n本轮开场地点固定为：${this._ai._formatOpeningLocationText(context.selectedLocation)}。Step 2 正文和 panel_status.location 都必须使用这个地点，不要改写成近义地点名。`)
      : '';

    const event = context.selectedEvent?.event || context.selectedEvent || {};
    const eventParts = [];
    const _evtLocText = (typeof window !== 'undefined' && window.locationTriad)
      ? window.locationTriad.formatEventLocation(event.location)
      : (typeof event.location === 'string' ? event.location : '');
    if (_evtLocText) eventParts.push(isEnglish ? `Event location: ${_evtLocText}` : `事件地点：${_evtLocText}`);
    if (event.characters) eventParts.push(isEnglish ? `Characters involved: ${event.characters}` : `涉及角色：${event.characters}`);
    if (event.content) eventParts.push(isEnglish ? `Event anchor: ${event.content}` : `事件锚点：${event.content}`);
    const eventHint = eventParts.length > 0 ? '\n' + eventParts.join('\n') : '';

    const timeInstruction = isEnglish
      ? `Step 2 narrative must naturally land on this specific time in the first paragraph. panel_status.datetime will be backfilled by runtime code.`
      : `Step 2 正文第一段必须自然落地这个具体时间。panel_status.datetime 由运行时代码回填。`;

    return isEnglish
      ? `### Locked Opening Event\n\nThis ${modeLabel} has locked a timeline event as the opening anchor.\nOpening time: ${context.selectedTimeText}. ${timeInstruction}${locationText}${eventHint}`
      : `### 本局已锁定的开场事件\n\n本轮${modeLabel}已锁定一条 timeline 事件作为开场锚点。\n开场时间：${context.selectedTimeText}。${timeInstruction}${locationText}${eventHint}`;
  }

  /**
   * 作者写的开场白（opening_greeting）已作为首条消息展示给玩家。把它作为承接上下文喂进 Turn1，
   * 让 GM 接着它的情境/基调往下写——不复述、不重写。此前两个大脑都没注入它（与开场白语法承诺矛盾）。
   * 仅 _buildPromptText 调用（resolve 已保证非首轮 return）。无 greeting 返回 null。
   * @returns {string|null}
   */
  _formatOpeningGreetingContext() {
    const greeting =
      (typeof window !== 'undefined' && window.worldMeta?.getOpeningGreeting?.()) || '';
    if (!greeting || !greeting.trim()) return null;
    const isEnglish = this._ai._getGamePromptLanguage?.() === 'en';
    return isEnglish
      ? `### Opening greeting (already shown to the player — continue from its situation and tone; do NOT restate or rewrite it)\n\n${greeting.trim()}`
      : `### 开场白（已作为开场展示给玩家——承接它的情境与基调往下写，不要复述或重写它）\n\n${greeting.trim()}`;
  }

}

// ── 按模式选择的 init 规则编号 ──
OpeningController.RULES_BY_MODE = {
  random:           [1, 4, 6, 7, 8, 9],
  recommended:      [1, 2, 5, 6, 7, 8, 9],
  player_specified: [1, 3, 6, 7, 8, 9],
};

window.OpeningController = OpeningController;
