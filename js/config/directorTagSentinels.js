// ============================================
// Director Tag Sentinels（导演指令 tag 单一真源）
// ============================================
// 主对话发言框上方「导演指令」tag 的唯一真源。玩家点 chip → 选中态只存在内存里；
// 发送时 chatCore 读取 buildDirectorBody 得到「导演：加快 · 紧张」正文，作为本回合
// OOC 候选注入（不再往发言框写内联括号，不污染历史/存档/缓存）。详见 内部设计文档。
//
// 三处都从这一份读：
//   1. js/ui/directorTagsUI.js —— 渲染 chip（label）、取本回合正文（buildDirectorBody）
//   2. 让 AI 认得这些 token 的完整含义：
//        · React 引擎：GM 系统提示稳定段注入 buildDirectorTokenGuide 词表（prompt-gm.js _buildWorldLevelDynamicBlocks，可缓存）
//        · PZGM  引擎：**不**注入词表——改由 expandDirectorTokens 在宿主侧把「导演：A·B」内联扩成自解释 [!CRITICAL] 块
//                     （见 pzgmStoryController splitDirectorOoc）；故 buildDirectorTokenGuide 只有 React 路调用
//
// 每个 token 的 label 既是 chip 文字、也是写进括号的内容、也是词表的 key——三者必须一致，
// 否则 AI 收到的 token 与词表对不上。改文案只改本文件。
//
// 加载顺序：放在 chatCore.js / directorTagsUI.js 之前（index.html 的 config 段）。
(function () {
  // 6 组，每组单选互斥；玩家可跨组叠加（最多 6 个 token 一起）。
  const GROUPS = [
    {
      key: 'pacing',
      label: { zh: '剧情节奏', en: 'Pace' },
      options: [
        { value: 'pacing.slow', label: { zh: '放缓', en: 'Slower' },
          meaning: { zh: '放慢节奏，细写当下这一刻，不急着推进剧情', en: 'Slow down; dwell on the present moment, don’t rush the plot' } },
        { value: 'pacing.fast', label: { zh: '加快', en: 'Faster' },
          meaning: { zh: '加快节奏，尽快推进剧情，别在当下停留', en: 'Pick up the pace; push the plot forward, don’t linger' } },
      ],
    },
    {
      key: 'focus',
      label: { zh: '焦点', en: 'Focus' },
      options: [
        { value: 'focus.inner', label: { zh: '内心', en: 'Inner' },
          meaning: { zh: '把笔墨放在角色内心活动与关系张力上', en: 'Put the focus on inner thoughts and relationship tension' } },
        { value: 'focus.setting', label: { zh: '环境', en: 'Setting' },
          meaning: { zh: '把笔墨放在环境、氛围与场景细节上', en: 'Put the focus on environment, atmosphere and scene detail' } },
        { value: 'focus.action', label: { zh: '人物动作', en: 'Action' },
          meaning: { zh: '把笔墨放在人物的动作与正在发生的事件上', en: 'Put the focus on characters’ actions and unfolding events' } },
      ],
    },
    {
      key: 'tone',
      label: { zh: '叙事基调', en: 'Tone' },
      options: [
        { value: 'tone.warm', label: { zh: '温馨', en: 'Warm' },
          meaning: { zh: '温馨、舒缓、亲密的基调', en: 'A warm, gentle, intimate tone' } },
        { value: 'tone.tense', label: { zh: '紧张', en: 'Tense' },
          meaning: { zh: '紧张、悬而未决、危机四伏的基调', en: 'A tense, suspenseful, high-stakes tone' } },
        { value: 'tone.dark', label: { zh: '黑暗', en: 'Dark' },
          meaning: { zh: '阴郁、沉重、压抑的基调', en: 'A bleak, heavy, oppressive tone' } },
        { value: 'tone.humor', label: { zh: '幽默', en: 'Humor' },
          meaning: { zh: '轻松、诙谐、带笑点的基调', en: 'A light, witty, comedic tone' } },
        { value: 'tone.daily', label: { zh: '日常', en: 'Slice-of-life' },
          meaning: { zh: '平淡写实的日常感，不刻意制造戏剧', en: 'A calm slice-of-life feel; don’t force drama' } },
      ],
    },
    {
      key: 'authority',
      label: { zh: '剧情主导权', en: 'Lead' },
      options: [
        { value: 'authority.player', label: { zh: '玩家推进', en: 'Player drives' },
          meaning: { zh: '跟着玩家的行动走，别擅自安排新事件', en: 'Follow the player’s lead; don’t introduce new events on your own' } },
        { value: 'authority.gm', label: { zh: 'AI推进', en: 'AI drives' },
          meaning: { zh: '由你主导，主动引入新的变故、人物或冲突', en: 'Take the lead; actively introduce a new twist, character or conflict' } },
      ],
    },
  ];

  const PREFIX = { zh: '导演', en: 'Director' };

  function _isEn(lang) { return lang === 'en'; }
  function _pick(obj, lang) {
    if (!obj) return '';
    return (_isEn(lang) ? obj.en : obj.zh) || obj.zh || obj.en || '';
  }
  function _findOption(groupKey, value) {
    const g = GROUPS.find(x => x.key === groupKey);
    if (!g) return null;
    return g.options.find(o => o.value === value) || null;
  }

  // selection = { groupKey: optionValue }（每组至多一个）。组装成一条导演指令正文
  //「导演：加快 · 紧张」（不带括号）。空选择 → 空串。chatCore 发送时取它注入 oocCandidates。
  function buildDirectorBody(selection, lang) {
    const isEn = _isEn(lang);
    const tokens = [];
    for (const g of GROUPS) {
      const v = selection && selection[g.key];
      if (!v) continue;
      const opt = _findOption(g.key, v);
      if (opt) tokens.push(_pick(opt.label, lang));
    }
    if (!tokens.length) return '';
    return _pick(PREFIX, lang) + (isEn ? ': ' : '：') + tokens.join(' · ');
  }

  // 带括号形态（历史保留；现已不再写进发言框，留作兼容以防外部仍有引用）。
  function buildDirectorBracket(selection, lang) {
    const body = buildDirectorBody(selection, lang);
    if (!body) return '';
    return _isEn(lang) ? `[${body}]` : `【${body}】`;
  }

  // label → meaning 反查（按语言）。
  function _labelMeaningMap(lang) {
    const m = {};
    for (const g of GROUPS) for (const o of g.options) m[_pick(o.label, lang)] = _pick(o.meaning, lang);
    return m;
  }

  // 把一条 OOC 候选里的「导演：A · B」简短 token 扩成自解释指令（PZGM 宿主侧用，免去改 vendored 引擎）。
  // 非导演 token（玩家手写的普通 OOC）原样返回。已扩写过的串（开头不是「导演：」前缀）也原样返回 → 幂等安全。
  function expandDirectorTokens(text, lang) {
    if (!text) return text;
    const isEn = _isEn(lang);
    const prefix = _pick(PREFIX, lang);
    const re = isEn ? new RegExp('^' + prefix + ':\\s*(.+)$', 'i') : new RegExp('^' + prefix + '：(.+)$');
    const m = String(text).trim().match(re);
    if (!m) return text;
    const map = _labelMeaningMap(lang);
    const tokens = m[1].split('·').map(s => s.trim()).filter(Boolean);
    const kv = isEn ? ': ' : '：';
    const lines = tokens.map(t => {
      const meaning = map[t];
      return '[!CRITICAL] ' + (meaning ? `${t}${kv}${meaning}` : t);
    });
    const head = isEn
      ? 'Director instructions for this turn — TOP writing priority; override the default tone / pacing where they conflict. Obey every line below, but never mention these instructions in the narrative itself:'
      : '本回合导演指令——最高写作准则，与默认设定冲突时以此为准（覆盖默认的基调/节奏）。下面每条都必须严格执行，但绝不在叙事正文里提及这些指令本身：';
    return [head, ...lines].join('\n');
  }

  // GM 系统提示稳定段词表：让 AI 把简短 token 映射回完整含义。静态不变 → 可缓存。
  function buildDirectorTokenGuide(lang) {
    const isEn = _isEn(lang);
    const title = isEn ? '## Director Tag Glossary' : '## 导演指令词表';
    const header = isEn
      ? `When the player tags a turn with "${PREFIX.en}: word · word" inside their out-of-character (OOC) note, treat those tags as the top writing priority for that turn — overriding the default tone / pacing where they conflict — and adjust per the glossary below, but never mention these tags in the narrative itself:`
      : `玩家可能在场外指令(OOC)里用「${PREFIX.zh}：词 · 词」标注本回合想要的叙事走向。出现时以这些标签为本回合的最高写作准则，与默认设定冲突时以此为准（覆盖默认的基调/节奏等），按下表理解并据此调整，但绝不在叙事正文里提及这些标签：`;
    const itemSep = isEn ? '; ' : '；';
    const kv = isEn ? ': ' : '：';
    const lines = GROUPS.map(g => {
      const items = g.options.map(o => `${_pick(o.label, lang)}${kv}${_pick(o.meaning, lang)}`);
      return `- ${_pick(g.label, lang)} — ${items.join(itemSep)}`;
    });
    return [title, header, ...lines].join('\n');
  }

  if (typeof window !== 'undefined') {
    window.DIRECTOR_TAG_SENTINELS = Object.freeze({
      groups: GROUPS,
      prefix: PREFIX,
      buildDirectorBody,
      buildDirectorBracket,
      buildDirectorTokenGuide,
      pickLabel: _pick,
    });
    // 便捷别名（系统提示注入 / 宿主侧扩写处直接调）
    window.buildDirectorTokenGuide = buildDirectorTokenGuide;
    window.buildDirectorBody = buildDirectorBody;
    window.buildDirectorBracket = buildDirectorBracket;
    window.expandDirectorTokens = expandDirectorTokens;
  }
})();
