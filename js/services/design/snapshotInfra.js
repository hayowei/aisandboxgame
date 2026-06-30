/**
 * design/snapshotInfra.js
 * 设计快照校验与修复基础设施（原 design2.js 的存活半区，2026-06-10 P1/P2 拆除时瘦身改名）
 *
 * 这里的方法服务于【所有】产卡路径（PZWC 建造 / P3 编辑 / 导入 / apply 落库），
 * 不是 P2 生成管线的遗产：
 *   - _repairSnapshotBeforePersist / _syncRepairedSnapshotSections / _formatSnapshotRepairSummary
 *     —— import-export 的 _validateSnapshotBeforePersist 落库前确定性修复
 *   - 时间一致性校验族（_getTimeValidationRuntime / _validateDateValueRange / …）
 *     —— design/validators.js 的时间地板
 *   - _validateStage2PromptModules —— design/ui.js 预览面板的模块校验
 *   - _resolveConsistencyFinding / _updateConsistencyFindingUI —— P3 一键检查 findings 按钮
 *   - 推荐开场修复族（_repair/Extract/Score…RecommendedOpening*）—— 落库修复的子例程
 *
 * 通过 mixin 模式扩展 DesignService.prototype（文件末尾 _applyDesignServiceMixin）。
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceSnapshotInfraMixin {
  _pushStage2Issue(report, type, message, moduleId = null) {
    const issue = { message, moduleId };
    if (type === 'fatal') {
      report.fatalErrors.push(issue);
    } else {
      report.warnings.push(issue);
    }
  }

  _extractInitRecommendedOpeningText(initText) {
    if (typeof initText !== 'string' || !initText.trim()) return '';
    const match = initText.match(
      /^\s*(?:[-*]\s+|\d+[.)、]\s*)?(?:推荐剧情|Recommended Opening)[：:]\s*(.+?)\s*$/im
    );
    return match && typeof match[1] === 'string' ? match[1].trim() : '';
  }

  _replaceInitRecommendedOpeningText(initText, recommendationText) {
    if (
      typeof initText !== 'string' ||
      !initText.trim() ||
      typeof recommendationText !== 'string'
    ) {
      return initText;
    }
    const normalizedText = recommendationText.trim();
    if (!normalizedText) return initText;
    const linePattern = /^(\s*(?:[-*]\s+|\d+[.)、]\s*)?)(?:推荐剧情|Recommended Opening)[：:].*$/im;
    const recommendationLabel =
      (window.i18nService?.getDesignLanguage?.() || 'zh-CN') === 'en'
        ? 'Recommended Opening'
        : '推荐剧情';
    if (linePattern.test(initText)) {
      return initText.replace(
        linePattern,
        (_, prefix) => `${prefix || ''}${recommendationLabel}：${normalizedText}`
      );
    }
    return `${initText.trim()}\n${recommendationLabel}：${normalizedText}`;
  }

  _normalizeRecommendedOpeningText(text = '') {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[，。！？；：“”‘’、（）《》【】…·,.!?;:'"(){}\[\]<>~`@#$%^&*_\-+=|\\/]/g, '')
      .replace(/\s+/g, '');
  }

  _extractRecommendedOpeningPhrases(text = '') {
    if (typeof text !== 'string' || !text.trim()) return [];
    const phrases = [];
    const seen = new Set();
    const pushPhrase = value => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      phrases.push(trimmed);
    };

    const quotedPattern = /[“"「『《](.+?)[”"」』》]/g;
    let match = null;
    while ((match = quotedPattern.exec(text))) {
      pushPhrase(match[1]);
    }

    text
      .split(/[，。！？；：、,.!?;:\n]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => pushPhrase(part));

    return phrases.slice(0, 8);
  }

  _getLongestCommonSubstringLength(textA = '', textB = '') {
    if (!textA || !textB) return 0;
    const rows = new Array(textB.length + 1).fill(0);
    let longest = 0;
    for (let i = 1; i <= textA.length; i++) {
      let previous = 0;
      for (let j = 1; j <= textB.length; j++) {
        const temp = rows[j];
        if (textA[i - 1] === textB[j - 1]) {
          rows[j] = previous + 1;
          if (rows[j] > longest) longest = rows[j];
        } else {
          rows[j] = 0;
        }
        previous = temp;
      }
    }
    return longest;
  }

  _extractSnapshotEntityDisplayNameFromText(text, entityId = '') {
    if (typeof text !== 'string') return '';
    const raw = text.trim();
    if (!raw) return '';
    const headerMatch = raw.match(
      /^\s*##\s*(?:实体设定|实体|Entity(?:\s+Setting)?)\s*--\s*([^\n（(]+?)(?:\s*[（(][^\n）)]+[）)])?\s*(?:\n|$)/im
    );
    if (headerMatch && headerMatch[1]?.trim()) {
      return headerMatch[1].trim();
    }
    const firstLine = raw
      .split('\n')
      .map(line => line.trim())
      .find(Boolean);
    const source = (firstLine || raw)
      .replace(/^#{1,6}\s*/, '')
      .replace(/^(?:实体设定|实体|Entity(?:\s+Setting)?)\s*--\s*/i, '');
    const candidate = source.split(/(?:——+|—+|--+|:|：|\n)/)[0].trim();
    if (!candidate || candidate === '实体设定' || /^entity(?:\s+setting)?$/i.test(candidate))
      return '';
    if (entityId && candidate === entityId.trim()) return '';
    return candidate;
  }

  _getSnapshotEntityDisplayMap(snapshot) {
    const map = new Map();
    const settings = snapshot?.world_setting?.settings;
    if (!settings || typeof settings !== 'object') return map;

    const eStore = typeof window !== 'undefined' ? window.entityStore : null;
    if (eStore && typeof eStore.inspectDisplayNames === 'function') {
      const inspection = eStore.inspectDisplayNames(settings);
      const records = Array.isArray(inspection?.records) ? inspection.records : [];
      records.forEach(record => {
        if (!record?.entityId) return;
        map.set(record.entityId, record.displayName || record.entityId);
      });
      return map;
    }

    Object.entries(settings).forEach(([entityId, text]) => {
      if (!entityId || entityId.startsWith('_')) return;
      map.set(entityId, this._extractSnapshotEntityDisplayNameFromText(text, entityId) || entityId);
    });
    return map;
  }

  _formatSnapshotOpeningLocationText(location = null) {
    if (!location || typeof location !== 'object') return '';
    return [location.country || '', location.site || '', location.spot || '']
      .filter(Boolean)
      .join(' · ');
  }

  _isSnapshotOpeningLocationTooBroad(locationStr) {
    if (typeof locationStr !== 'string') return false;
    const normalized = locationStr.replace(/\s+/g, '');
    if (!normalized) return true;
    return /^(?:全空间站|全城|全国|全境|全域|全大陆|全世界|全区域|整个空间站|整个城市|整个大陆|整个世界)/.test(
      normalized
    );
  }

  _buildSnapshotOpeningLocationFromEventLocation(loc, snapshot, entityDisplayMap = null) {
    // event.location 现支持对象（新卡）/老分隔串：统一升格三段，再用 displayMap 解析显示名；'未知'/空 → ''
    const t = (typeof window !== 'undefined' && window.locationTriad)
      ? window.locationTriad.eventToTriad(loc)
      : { country: '', site: '', spot: '' };
    const displayMap =
      entityDisplayMap instanceof Map
        ? entityDisplayMap
        : this._getSnapshotEntityDisplayMap(snapshot);
    const disp = value => {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (!trimmed || trimmed === '未知') return '';
      return displayMap.get(trimmed) || trimmed;
    };
    return { country: disp(t.country), site: disp(t.site), spot: disp(t.spot) };
  }

  _isSnapshotOpeningEventLocationUsable(loc, snapshot, entityDisplayMap = null) {
    const str = (typeof window !== 'undefined' && window.locationTriad)
      ? window.locationTriad.formatEventLocation(loc)
      : (typeof loc === 'string' ? loc.trim() : '');
    if (!str.trim()) return false;
    if (/(未知|不详)/.test(str)) return false;
    if (this._isSnapshotOpeningLocationTooBroad(str)) return false;
    const parsed = this._buildSnapshotOpeningLocationFromEventLocation(loc, snapshot, entityDisplayMap);
    return Boolean(parsed.country || parsed.site || parsed.spot);
  }

  _getSnapshotAvailableOpeningNpcCandidates(
    snapshot,
    targetDate,
    runtime,
    precision,
    timeSegments
  ) {
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const candidates = [];
    for (const [characterId, character] of Object.entries(characterDatabase)) {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') continue;
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      if (!name) continue;
      const birthday =
        typeof runtime?._parseBirthdayDate === 'function'
          ? runtime._parseBirthdayDate(character.birthday)
          : runtime.parseTimeString?.(character.birthday);
      if (birthday && runtime.compareDates(targetDate, birthday, precision, timeSegments) < 0) {
        continue;
      }
      candidates.push({ id: characterId, name });
    }
    return candidates;
  }

  _getSnapshotOpeningEventCandidates(snapshot, runtime) {
    if (!snapshot || typeof snapshot !== 'object' || !runtime) return [];
    const { precision, timeSegments } = this._getSnapshotTimeConfig(snapshot);
    const entityDisplayMap = this._getSnapshotEntityDisplayMap(snapshot);
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const birthdaysByName = new Map();
    Object.entries(characterDatabase).forEach(([characterId, character]) => {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') return;
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      const birthday =
        typeof runtime?._parseBirthdayDate === 'function'
          ? runtime._parseBirthdayDate(character.birthday)
          : runtime.parseTimeString?.(character.birthday);
      if (name && birthday) birthdaysByName.set(name, birthday);
    });

    const events = Array.isArray(snapshot?.world_timeline?.events)
      ? snapshot.world_timeline.events
      : Array.isArray(snapshot?.timeline?.events)
        ? snapshot.timeline.events
        : [];
    const candidates = [];
    events.forEach((event, index) => {
      if (!event || typeof event !== 'object') return;
      const dayText = typeof event.day === 'string' ? event.day.trim() : '';
      if (dayText === '无日期') return;
      if (typeof event.content !== 'string' || !event.content.trim()) return;
      const eventDate =
        typeof runtime._parseSnapshotEventDate === 'function'
          ? runtime._parseSnapshotEventDate(event)
          : null;
      if (!eventDate || eventDate.year <= 0) return;
      const normalizedDate =
        typeof runtime.normalizeDateForPrecision === 'function'
          ? runtime.normalizeDateForPrecision(eventDate, precision, timeSegments)
          : eventDate;
      if (!normalizedDate) return;
      const characters = this._splitTimelineCharacters(event.characters);
      const violatesBirthday = characters.some(name => {
        const birthday = birthdaysByName.get(name);
        return (
          birthday && runtime.compareDates(normalizedDate, birthday, precision, timeSegments) < 0
        );
      });
      if (violatesBirthday) return;
      if (!this._isSnapshotOpeningEventLocationUsable(event.location, snapshot, entityDisplayMap)) {
        return;
      }

      const availableNpcCandidates = this._getSnapshotAvailableOpeningNpcCandidates(
        snapshot,
        normalizedDate,
        runtime,
        precision,
        timeSegments
      );
      if (availableNpcCandidates.length === 0) return;

      const preferredNpcCandidates = availableNpcCandidates.filter(candidate =>
        characters.includes(candidate.name)
      );
      candidates.push({
        event,
        eventIndex: index,
        eventId:
          typeof runtime.getEventId === 'function'
            ? runtime.getEventId(event)
            : `${event.time}_${event.day}_${event.characters}_${(event.content || '').substring(0, 30)}`,
        eventDate: normalizedDate,
        location: this._buildSnapshotOpeningLocationFromEventLocation(
          event.location,
          snapshot,
          entityDisplayMap
        ),
        availableNpcCandidates,
        preferredNpcCandidates,
      });
    });

    candidates.sort((a, b) => {
      const diff = runtime.compareDates(a.eventDate, b.eventDate, precision, timeSegments);
      if (diff !== 0) return diff;
      return a.eventIndex - b.eventIndex;
    });
    return candidates;
  }

  _buildSnapshotRecommendedOpeningEventText(candidate, snapshot, entityDisplayMap = null) {
    const event = candidate?.event;
    if (!event || typeof event !== 'object') return '';
    const _evtLoc = (typeof window !== 'undefined' && window.locationTriad)
      ? window.locationTriad.eventToTriad(event.location)
      : { country: '', site: '', spot: '' };
    const rawLocationParts = [_evtLoc.country, _evtLoc.site, _evtLoc.spot].filter(s => s && s !== '未知');
    const rawLocation = rawLocationParts.join(' / ');
    const displayMap =
      entityDisplayMap instanceof Map
        ? entityDisplayMap
        : this._getSnapshotEntityDisplayMap(snapshot);
    const displayLocationParts = rawLocationParts.map(part => displayMap.get(part) || part);
    const parsedLocationText = candidate?.location
      ? this._formatSnapshotOpeningLocationText(candidate.location)
      : '';
    return this._normalizeRecommendedOpeningText(
      [
        rawLocation,
        rawLocationParts.join(' '),
        displayLocationParts.join(' '),
        parsedLocationText,
        event.characters || '',
        event.content || '',
        event.time || '',
        event.day || '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  _scoreSnapshotRecommendedOpeningEvent(
    recommendationText,
    candidate,
    snapshot,
    entityDisplayMap = null
  ) {
    const normalizedRecommendation = this._normalizeRecommendedOpeningText(recommendationText);
    if (!normalizedRecommendation) {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }
    const eventText = this._buildSnapshotRecommendedOpeningEventText(
      candidate,
      snapshot,
      entityDisplayMap
    );
    if (!eventText) {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }

    let score = 0;
    let phraseHits = 0;
    const fullMatch =
      eventText.includes(normalizedRecommendation) || normalizedRecommendation.includes(eventText);
    if (fullMatch) {
      score += 100 + Math.min(normalizedRecommendation.length, 40);
    }

    const phrases = this._extractRecommendedOpeningPhrases(recommendationText);
    phrases.forEach(phrase => {
      const normalizedPhrase = this._normalizeRecommendedOpeningText(phrase);
      if (!normalizedPhrase || normalizedPhrase.length < 2) return;
      if (eventText.includes(normalizedPhrase)) {
        phraseHits += 1;
        score += 30 + Math.min(normalizedPhrase.length * 3, 24);
      }
    });

    const longestCommon = this._getLongestCommonSubstringLength(
      normalizedRecommendation,
      eventText
    );
    score += Math.min(longestCommon * 2, 24);

    return { score, phraseHits, fullMatch, longestCommon };
  }

  _findSnapshotRecommendedOpeningEvent(
    snapshot,
    recommendationText,
    candidateEvents,
    entityDisplayMap = null
  ) {
    if (!recommendationText || !Array.isArray(candidateEvents) || candidateEvents.length === 0) {
      return null;
    }
    const scored = candidateEvents
      .map(candidate => ({
        candidate,
        ...this._scoreSnapshotRecommendedOpeningEvent(
          recommendationText,
          candidate,
          snapshot,
          entityDisplayMap
        ),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.candidate.eventIndex - a.candidate.eventIndex;
      });
    if (scored.length === 0) return null;
    const best = scored[0];
    const second = scored[1] || null;
    const isStrongMatch =
      best.fullMatch || best.phraseHits > 0 || best.longestCommon >= 5 || best.score >= 18;
    const isUniqueMatch = !second || best.score >= second.score + 5;
    if (!isStrongMatch || !isUniqueMatch) return null;
    return best.candidate;
  }

  _buildRecommendedOpeningSnippet(content = '') {
    if (typeof content !== 'string') return '';
    let snippet = content.replace(/\s+/g, ' ').trim();
    if (!snippet) return '';
    const sentenceMatch = snippet.match(/^[^。！？!?]+/);
    snippet = sentenceMatch ? sentenceMatch[0].trim() : snippet;
    if (snippet.length > 18) {
      snippet = snippet.slice(0, 18).trim();
    }
    return snippet.replace(/[。！？!?…]+$/g, '').trim();
  }

  _buildRecommendedOpeningTextForCandidate(candidate) {
    if (!candidate?.event) return '';
    const locationText = this._formatSnapshotOpeningLocationText(candidate.location) || '现场';
    const snippet = this._buildRecommendedOpeningSnippet(candidate.event.content || '');
    if (!snippet) return '';
    const characters = this._splitTimelineCharacters(candidate.event.characters);
    const leadName = characters[0] || '';
    if (leadName) {
      return `从${locationText}里${leadName}牵出的「${snippet}」开始。`;
    }
    return `从${locationText}里「${snippet}」开始。`;
  }

  _repairRecommendedOpeningTextForSnapshot(snapshot, report = null) {
    const runtime = this._getTimeValidationRuntime();
    if (!snapshot || typeof snapshot !== 'object' || !runtime) {
      return { applied: false, fixes: [] };
    }
    const initText = snapshot?.prompt_modules?.modules?.init;
    if (typeof initText !== 'string' || !initText.trim()) {
      return { applied: false, fixes: [] };
    }
    const recommendationText = this._extractInitRecommendedOpeningText(initText);
    if (!recommendationText) {
      return { applied: false, fixes: [] };
    }

    const entityDisplayMap = this._getSnapshotEntityDisplayMap(snapshot);
    const candidateEvents = this._getSnapshotOpeningEventCandidates(snapshot, runtime);
    if (candidateEvents.length === 0) {
      return { applied: false, fixes: [] };
    }

    const matchedCandidate = this._findSnapshotRecommendedOpeningEvent(
      snapshot,
      recommendationText,
      candidateEvents,
      entityDisplayMap
    );
    if (matchedCandidate) {
      return { applied: false, fixes: [] };
    }

    const targetCandidate = candidateEvents[candidateEvents.length - 1];
    const nextRecommendationText = this._buildRecommendedOpeningTextForCandidate(targetCandidate);
    if (!nextRecommendationText) {
      return { applied: false, fixes: [] };
    }

    const nextInitText = this._replaceInitRecommendedOpeningText(initText, nextRecommendationText);
    if (nextInitText === initText) {
      return { applied: false, fixes: [] };
    }

    snapshot.prompt_modules.modules.init = nextInitText;
    this._recordSnapshotRepair(
      report,
      'prompt_modules.modules.init',
      `推荐剧情已自动改写为可命中最新开场事件：${nextRecommendationText}`
    );
    return {
      applied: true,
      fixes: [
        {
          path: 'prompt_modules.modules.init',
          message: `推荐剧情已自动改写为 ${nextRecommendationText}`,
        },
      ],
    };
  }

  _validateStage2PromptModules(parsed, { context = 'stage2-raw' } = {}) {
    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      fatalErrors: [],
      warnings: [],
      autoFixes: [],
    };

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this._pushStage2Issue(report, 'fatal', 'Stage2 输出必须是 JSON 对象');
      report.ok = false;
      return report;
    }

    const modules = parsed.modules;
    if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
      this._pushStage2Issue(report, 'fatal', '`modules` 必须是对象');
    }
    const moduleIds =
      modules && typeof modules === 'object' && !Array.isArray(modules) ? Object.keys(modules) : [];
    if (moduleIds.length === 0) {
      this._pushStage2Issue(report, 'fatal', '`modules` 不能为空对象');
    }
    if (moduleIds.includes('random_opening')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`random_opening` 只能出现在顶层 JSON，不能写进 `modules`'
      );
    }

    const moduleMeta = parsed.module_meta;
    if (!moduleMeta || typeof moduleMeta !== 'object' || Array.isArray(moduleMeta)) {
      this._pushStage2Issue(report, 'fatal', '`module_meta` 必须是对象（用于参数级描述）');
    }

    if (report.fatalErrors.length > 0) {
      report.ok = false;
      return report;
    }

    const metaIds = Object.keys(moduleMeta);

    if (typeof parsed._summary !== 'string' || !parsed._summary.trim()) {
      this._pushStage2Issue(report, 'warning', '`_summary` 缺失或为空');
    }

    // Wave 1C: opening_greeting 已上移到 snapshot 顶层（this.designConfig.opening_greeting）；
    // parsed === prompt_modules，只有 V1 老卡才把它留在嵌套位置 → 双源回退
    //（镜像 line 1033-1036 与 worldMeta.getOpeningGreeting）。否则正常 V2 卡 prompt_modules.opening_greeting
    // 恒为 undefined，会无条件命中下面的"缺失或为空"误报（3 张金样卡也都触发）。
    const openingGreeting =
      typeof this.designConfig?.opening_greeting === 'string' && this.designConfig.opening_greeting.trim()
        ? this.designConfig.opening_greeting
        : parsed.opening_greeting;
    if (typeof openingGreeting !== 'string' || !openingGreeting.trim()) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`opening_greeting` 缺失或为空（必须提供 wizard Step 0 顶部"世界氛围引言"）'
      );
    } else {
      const ogText = openingGreeting.trim();
      // 字数地板/天花板：150-350 字 in-medias-res 段落（craft-guide §3.3 标的，不可过短也不可过长压脚）
      if (ogText.length < STAGE2_OPENING_GREETING_MIN_LENGTH) {
        this._pushStage2Issue(
          report,
          'warning',
          `opening_greeting 过短（${ogText.length} 字 < ${STAGE2_OPENING_GREETING_MIN_LENGTH}）`
        );
      } else if (ogText.length > STAGE2_OPENING_GREETING_MAX_LENGTH) {
        this._pushStage2Issue(
          report,
          'warning',
          `opening_greeting 过长（${ogText.length} 字 > ${STAGE2_OPENING_GREETING_MAX_LENGTH}）；wizard 顶部展示，过长会压脚`
        );
      }

      // 含具体钟点 HH:MM = fatal：氛围引言只允许时代/纪元感（"暮春"），不允许具体钟点
      // （钟点是 frozen_moment.datetime 的事；写在引言里会跟 datetime 撞车或矛盾）
      if (/\d{1,2}[:：]\d{2}/.test(ogText)) {
        this._pushStage2Issue(
          report,
          'fatal',
          'opening_greeting 含具体钟点 HH:MM；wizard 顶部氛围引言只允许时代/纪元感（"暮春"），具体钟点归 frozen_moment.datetime'
        );
      }

      // 残留"问玩家时间/地点"句式 → warning（wizard 已抢走时间地点决策，引言里写就是冗余）
      const askTimeRE = /(请告诉我|你想从哪个?(年代|时刻|时候)|从哪个年代或事件开始|随机开始|以推荐剧情开始|\*\*\s*1\.\s*时间|\*\*\s*2\.\s*地点)/;
      if (askTimeRE.test(ogText)) {
        this._pushStage2Issue(
          report,
          'warning',
          'opening_greeting 仍含"问玩家选时间/地点"的句式；wizard 已抢走这两件事的决策，引言只需纯氛围'
        );
      }

      // 「含具体角色名」warning：V2 卡启用——黑名单只收 narrative_core_characters。
      // 2026-06 开场白新语法（in-medias-res 四条，craft-guide §3.3）要求第一句开在 frozen_moment 的现场，
      // 实体名/地点名是合法素材——display_name / sites 不再入黑名单（旧规则会把所有新语法卡误报）；
      // 具体角色名仍禁（玩家身份由开场选择按钮决定）。V1 老卡跳过（无结构化字段、容易误报）。
      try {
        const wsSettings = this.designConfig?.world_setting?.settings || {};
        const nameBlacklist = new Set();
        for (const [eid, val] of Object.entries(wsSettings)) {
          if (eid.startsWith('_')) continue;
          if (!val || typeof val !== 'object' || Array.isArray(val)) continue; // V1 跳过
          if (Array.isArray(val.narrative_core_characters)) {
            for (const n of val.narrative_core_characters) {
              if (typeof n !== 'string' || !n.trim()) continue;
              // V2 narrative_core_characters 可能是 ID（Wave 1B）也可能是姓名——统一解析成显示名，
              // 否则 ID 形态的卡（如赛博）这条检查会哑火（resolveCoreCharacterName 找不到时原样返回）。
              const resolved =
                typeof window !== 'undefined' && window.characterFields?.resolveCoreCharacterName
                  ? window.characterFields.resolveCoreCharacterName(
                      n.trim(),
                      this.designConfig?.character_database
                    )
                  : n.trim();
              if (resolved && resolved.trim()) nameBlacklist.add(resolved.trim());
            }
          }
        }
        const hits = [];
        for (const name of nameBlacklist) {
          // 子串匹配天然脆弱：2 字名极易撞意象/地名词根（明月/青禾/冷月…）→ 误报。
          // 只对 ≥3 字的名字做子串命中（开场白本就禁具名，漏掉 2 字名无害——这条仅 advisory warning）。
          if (name.length >= 3 && ogText.includes(name)) hits.push(name);
        }
        if (hits.length > 0) {
          this._pushStage2Issue(
            report,
            'warning',
            `opening_greeting 含具体角色名 ${hits.slice(0, 3).map(n => `"${n}"`).join('、')}${hits.length > 3 ? ' 等' : ''}；开场白禁含具体角色名（玩家身份由开场选择按钮决定）`
          );
        }
      } catch (_e) {
        /* 防御性：失败不阻塞 */
      }
    }

    // frozen_moment 已由 P1 锁定（落 p1Output.frozen_moment），Stage 2 不再产出。
    // AI 偶尔回归老 schema 仍产了 frozen_moment 字段 → 软警告 + 主动从 parsed 删掉
    // （避免 L443 整段写入 designConfig.prompt_modules 时落进 snapshot 形成 schema 污染）。
    // 真要兼容老数据走 worldMeta.getFrozenMoment 双源回退即可，不靠 Stage 2 重产残留。
    if (parsed.frozen_moment !== undefined) {
      this._pushStage2Issue(
        report,
        'warning',
        '`frozen_moment` 已由 P1 锁定，Stage 2 不应再产出；该字段会被丢弃（runtime 走 worldMeta 双源回退）'
      );
      delete parsed.frozen_moment;
    }

    const initModule = typeof modules.init === 'string' ? modules.init : '';
    const lazyTemplateRe = /执行\s*[Cc]ase\s*[A-D]|依照模板|按模板|严格依照模板|见上文/i;
    if (lazyTemplateRe.test(initModule)) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`modules.init` 包含偷懒模板引用（如“执行 Case A-D”），必须写出完整分支逻辑',
        'init'
      );
    }

    if (parsed.random_opening !== undefined) {
      this._pushStage2Issue(
        report,
        'warning',
        '`random_opening` 已废弃，系统会在保存时自动忽略该字段'
      );
    }

    const extraMetaIds = metaIds.filter(id => !moduleIds.includes(id));
    extraMetaIds.forEach(id => {
      this._pushStage2Issue(
        report,
        'warning',
        '`module_meta` 存在未在 `modules` 中声明的额外 key',
        id
      );
    });

    moduleIds.forEach(id => {
      if (!STAGE2_MODULE_ID_RE.test(id)) {
        this._pushStage2Issue(report, 'warning', '模块 ID 不是 snake_case', id);
      }
      if (id === 'world_mechanics') {
        this._pushStage2Issue(
          report,
          'warning',
          '`world_mechanics` 不应单独成模块，应并入 `narrative_base`',
          id
        );
      }
      if (id === 'job_board') {
        this._pushStage2Issue(
          report,
          'warning',
          '`job_board` 为不建议模块（除非明确需要打工玩法）',
          id
        );
      }

      const content = modules[id];
      if (typeof content !== 'string') {
        this._pushStage2Issue(report, 'warning', '模块正文必须是字符串', id);
      } else {
        const text = content.trim();
        if (!text) {
          this._pushStage2Issue(report, 'warning', '模块正文为空', id);
        } else {
          if (text.length < STAGE2_MODULE_MIN_LENGTH) {
            this._pushStage2Issue(
              report,
              'warning',
              `模块正文过短（< ${STAGE2_MODULE_MIN_LENGTH} 字）`,
              id
            );
          }
          if (STAGE2_PLACEHOLDER_RE.test(text)) {
            this._pushStage2Issue(
              report,
              'warning',
              '模块正文包含占位词（TODO/TBD/待补充 等）',
              id
            );
          }
        }
      }

      const meta = moduleMeta[id];
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        this._pushStage2Issue(report, 'warning', '`module_meta` 缺少该模块的描述对象', id);
        return;
      }

      STAGE2_META_FIELDS.forEach(field => {
        const value = meta[field];
        if (typeof value !== 'string') {
          this._pushStage2Issue(report, 'warning', `module_meta.${field} 必须是字符串`, id);
          return;
        }
        const text = value.trim();
        if (!text) {
          this._pushStage2Issue(report, 'warning', `module_meta.${field} 不能为空`, id);
          return;
        }
        if (STAGE2_PLACEHOLDER_RE.test(text)) {
          this._pushStage2Issue(report, 'warning', `module_meta.${field} 包含占位词`, id);
        }
      });
    });

    // npc_gen 模块必须存在
    if (!moduleIds.includes('npc_gen')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`npc_gen` 模块缺失（必须生成，用于 NPC 面板格式规范）'
      );
    }
    // init 模块必须存在
    if (!moduleIds.includes('init')) {
      this._pushStage2Issue(report, 'fatal', '`init` 模块缺失（必须生成，用于 Turn 1 开场引导）');
    }
    // narrative_base 模块必须存在
    if (!moduleIds.includes('narrative_base')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`narrative_base` 模块缺失（必须生成，用于叙事基线与文风规范）'
      );
    }
    // core_world_mechanics 模块必须存在（运行时每轮 system prompt 永久注入，缺失=每轮少一块常驻规则）
    if (!moduleIds.includes('core_world_mechanics')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`core_world_mechanics` 模块缺失（必须生成，每轮 system prompt 永久注入；存称谓/货币/购买力等不涉主角的世界通用常驻规则）'
      );
    }

    // npc_fields 验证：仅校验 AI 的 Stage 2 原始输出。
    // 快照里 npc_fields 已被搬进 panel_fields.panel_npc，
    // 由 _validateCharacterDatabasePanelConsistency / worldCardInspection 负责。
    if (context === 'stage2-raw') {
      const npcFields = parsed.npc_fields;
      if (!Array.isArray(npcFields)) {
        this._pushStage2Issue(report, 'fatal', '`npc_fields` 必须是数组（NPC 面板字段定义）');
      } else if (npcFields.length === 0) {
        this._pushStage2Issue(report, 'fatal', '`npc_fields` 不能为空数组');
      } else {
        const seenKeys = new Set();
        const fixedKeys = this._getNpcReservedKeySet();
        for (let i = 0; i < npcFields.length; i++) {
          const f = npcFields[i];
          if (!f || typeof f !== 'object') {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] 不是有效对象`);
            continue;
          }
          if (typeof f.key !== 'string' || !f.key.trim()) {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] 缺少 key`);
            continue;
          }
          if (typeof f.label !== 'string' || !f.label.trim()) {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] (${f.key}) 缺少 label`);
          }
          if (fixedKeys.has(f.key)) {
            this._pushStage2Issue(
              report,
              'warning',
              `npc_fields[${i}] (${f.key}) 与引擎固定字段冲突，将被忽略`
            );
          }
          if (seenKeys.has(f.key)) {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] (${f.key}) key 重复`);
          }
          seenKeys.add(f.key);
        }
      }
    }

    report.ok = report.fatalErrors.length === 0;
    return report;
  }

  _getTimeValidationRuntime() {
    if (typeof timelineService !== 'undefined' && timelineService) return timelineService;
    return null;
  }

  _getSnapshotTimeConfig(snapshot) {
    const runtime = this._getTimeValidationRuntime();
    if (runtime && typeof runtime.getTimeConfigFromSnapshot === 'function') {
      return runtime.getTimeConfigFromSnapshot(snapshot);
    }
    return {
      precision: 'time',
      timeSegments: [],
    };
  }

  _pushSnapshotValidationIssue(target, message, path = null) {
    if (!Array.isArray(target)) return;
    const issue = path ? { path, message } : { message };
    target.push(issue);
  }

  _normalizeValidationPrecision(precision = 'time') {
    return ['year', 'month', 'day', 'time'].includes(precision) ? precision : 'time';
  }

  _normalizeClockTimeString(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{2}):(\d{2})$/);
    if (!match) return '';
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  _validateDateValueRange(date, precision = 'time', path = '', target = [], options = {}) {
    const normalizedPrecision = this._normalizeValidationPrecision(precision);
    const allowNegativeYear = options.allowNegativeYear !== false;
    const hasMonth =
      date && date.month !== undefined && date.month !== null && `${date.month}`.trim() !== '';
    const hasDay =
      date && date.day !== undefined && date.day !== null && `${date.day}`.trim() !== '';
    let valid = true;

    const year = Number.parseInt(date?.year, 10);
    if (!Number.isFinite(year) || year === 0 || (!allowNegativeYear && year < 0)) {
      this._pushSnapshotValidationIssue(target, `${path || '日期'} 的 year 非法`, path || null);
      return false;
    }

    if (['month', 'day', 'time'].includes(normalizedPrecision) || hasMonth) {
      const month = Number.parseInt(date?.month, 10);
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        this._pushSnapshotValidationIssue(
          target,
          `${path || '日期'} 的 month=${date?.month} 超出范围（1-12）`,
          path || null
        );
        valid = false;
      }
    }

    if (['day', 'time'].includes(normalizedPrecision) || hasDay) {
      const day = Number.parseInt(date?.day, 10);
      if (!Number.isFinite(day) || day < 1 || day > 30) {
        this._pushSnapshotValidationIssue(
          target,
          `${path || '日期'} 的 day=${date?.day} 超出范围（1-30）`,
          path || null
        );
        valid = false;
      }
    }

    if (normalizedPrecision === 'time') {
      const timeStr = this._normalizeClockTimeString(date?.time_str || date?.timeStr || '');
      if (!timeStr) {
        this._pushSnapshotValidationIssue(
          target,
          `${path || '日期'} 的 time_str 必须是严格 HH:MM 格式`,
          path || null
        );
        valid = false;
      }
    }

    return valid;
  }

  _splitTimelineCharacters(characters) {
    if (typeof characters !== 'string') return [];
    return characters
      .split(/\s*\/\s*|\s*,\s*|\s+/)
      .map(name => name.trim())
      .filter(Boolean);
  }

  _extractConcreteTimeExamplesFromText(text, precision = 'time', runtime = null) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim() || !runtime || typeof runtime.parseTimeString !== 'function') return [];

    const normalizedPrecision = this._normalizeValidationPrecision(precision);
    const patterns =
      normalizedPrecision === 'year'
        ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d{3,}/g]
        : normalizedPrecision === 'month'
          ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+/g]
          : normalizedPrecision === 'time'
            ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+\s+\d{2}:\d{2}/g]
            : [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+/g];

    const results = [];
    const seen = new Set();
    for (const pattern of patterns) {
      const matches = source.match(pattern) || [];
      for (const rawMatch of matches) {
        const value = typeof rawMatch === 'string' ? rawMatch.trim() : '';
        if (!value || seen.has(value)) continue;
        const parsed = runtime.parseTimeString(value);
        if (!parsed) continue;
        seen.add(value);
        results.push({ text: value, date: parsed });
      }
    }
    return results;
  }

  _resolvePromptTimeReferenceWindow(
    report,
    parsedTimelineDates,
    precision = 'day',
    timeSegments = [],
    runtime = null
  ) {
    if (!runtime || typeof runtime.compareDates !== 'function') return null;
    const dates = Array.isArray(parsedTimelineDates) ? parsedTimelineDates.slice() : [];
    if (dates.length === 0) return null;
    dates.sort((a, b) => runtime.compareDates(a, b, precision, timeSegments));
    const tail = dates.slice(-3);
    return {
      start: tail[0],
      end: tail[tail.length - 1],
      label: '主时间线末段',
    };
  }

  _isDateInsideWindow(date, window, precision = 'day', timeSegments = [], runtime = null) {
    if (
      !date ||
      !window?.start ||
      !window?.end ||
      !runtime ||
      typeof runtime.compareDates !== 'function'
    ) {
      return false;
    }
    return (
      runtime.compareDates(date, window.start, precision, timeSegments) >= 0 &&
      runtime.compareDates(date, window.end, precision, timeSegments) <= 0
    );
  }

  _validatePromptModuleTimeConsistency(
    snapshot,
    report,
    parsedTimelineDates,
    precision,
    timeSegments,
    runtime
  ) {
    const promptModules = snapshot?.prompt_modules;
    if (!promptModules || typeof promptModules !== 'object') return;

    const referenceWindow = this._resolvePromptTimeReferenceWindow(
      report,
      parsedTimelineDates,
      precision,
      timeSegments,
      runtime
    );
    if (!referenceWindow) return;

    // Wave 1C: opening_greeting 新位置 snapshot.opening_greeting；老位置 prompt_modules.opening_greeting
    const openingGreetingText =
      (typeof snapshot.opening_greeting === 'string' && snapshot.opening_greeting.trim())
        ? snapshot.opening_greeting
        : promptModules?.opening_greeting;
    const openingExamples = this._extractConcreteTimeExamplesFromText(
      openingGreetingText,
      precision,
      runtime
    );
    if (openingExamples.length > 0) {
      const validExamples = openingExamples.filter(item =>
        this._validateDateValueRange(
          item.date,
          precision,
          'prompt_modules.opening_greeting 时间示例',
          report.errors,
          { timeSegments }
        )
      );
      if (
        validExamples.length > 0 &&
        !validExamples.some(item =>
          this._isDateInsideWindow(item.date, referenceWindow, precision, timeSegments, runtime)
        )
      ) {
        const preview = validExamples
          .slice(0, 3)
          .map(item => item.text)
          .join(' / ');
        this._pushSnapshotValidationIssue(
          report.errors,
          `opening_greeting 的具体时间示例（${preview}）不在${referenceWindow.label}内`,
          'prompt_modules.opening_greeting'
        );
      }
    }
  }

  _validateTimeLabelSemantics(snapshot, observedDates, report) {
    const panelStatus = Array.isArray(snapshot?.panel_fields?.panel_status)
      ? snapshot.panel_fields.panel_status
      : [];
    const timeGroup = panelStatus.find(
      group => group && (group._template === 'time' || group.key === 'datetime')
    );
    if (!timeGroup || !Array.isArray(timeGroup.fields)) return;

    const yearField = timeGroup.fields.find(field => field?.key === 'year');
    const monthField = timeGroup.fields.find(field => field?.key === 'month');
    const dates = Array.isArray(observedDates) ? observedDates : [];
    const positiveYears = dates
      .map(item => Number.parseInt(item?.year, 10))
      .filter(value => Number.isFinite(value) && value > 0);
    const months = dates
      .map(item => Number.parseInt(item?.month, 10))
      .filter(value => Number.isFinite(value) && value > 0);
    const maxYear = positiveYears.length > 0 ? Math.max(...positiveYears) : null;
    const maxMonth = months.length > 0 ? Math.max(...months) : null;

    if (
      yearField?.label &&
      /世纪/.test(yearField.label) &&
      Number.isFinite(maxYear) &&
      maxYear >= 100
    ) {
      this._pushSnapshotValidationIssue(
        report.warnings,
        `时间字段 year 标签为「${yearField.label}」，但世界实际使用 ${maxYear} 这类年份值，语义容易误导`,
        'panel_fields.panel_status.datetime.year'
      );
    }

    if (
      monthField?.label &&
      /季(节)?/.test(monthField.label) &&
      Number.isFinite(maxMonth) &&
      maxMonth > 4
    ) {
      this._pushSnapshotValidationIssue(
        report.warnings,
        `时间字段 month 标签为「${monthField.label}」，但世界实际出现 ${maxMonth} 这类月份值，语义容易误导`,
        'panel_fields.panel_status.datetime.month'
      );
    }
  }

  _recordSnapshotRepair(report, path, message) {
    if (!report || typeof report !== 'object') return;
    if (!Array.isArray(report.fixes)) report.fixes = [];
    report.applied = true;
    report.fixes.push(path ? { path, message } : { message });
  }

  _getSnapshotTimeEra(snapshot) {
    const panelStatus = Array.isArray(snapshot?.panel_fields?.panel_status)
      ? snapshot.panel_fields.panel_status
      : [];
    const timeGroup = panelStatus.find(
      group => group && (group._template === 'time' || group.key === 'datetime')
    );
    if (typeof timeGroup?._era === 'string' && timeGroup._era.trim()) {
      return timeGroup._era.trim();
    }
    const worldTermsEra = snapshot?.panel_fields?._worldTermsSource?.calendar_era;
    return typeof worldTermsEra === 'string' ? worldTermsEra.trim() : '';
  }

  _formatSnapshotDateText(date, snapshot, options = {}) {
    if (!date || !Number.isFinite(Number.parseInt(date.year, 10))) return '';
    const precision = this._normalizeValidationPrecision(
      typeof options.precision === 'string'
        ? options.precision
        : this._getTimePrecisionFromPanelFields(snapshot?.panel_fields)
    );
    const era = this._getSnapshotTimeEra(snapshot);
    const spaced = options.spaced === true;
    const prefix = era ? `${era}${spaced ? ' ' : ''}` : '';
    const year = `${Number.parseInt(date.year, 10)}`;
    const month = String(Math.max(1, Math.min(12, Number.parseInt(date.month, 10) || 1))).padStart(
      2,
      '0'
    );
    const day = String(Math.max(1, Math.min(30, Number.parseInt(date.day, 10) || 1))).padStart(
      2,
      '0'
    );
    let text = `${prefix}${year}`;
    if (['month', 'day', 'time'].includes(precision)) text += `.${month}`;
    if (['day', 'time'].includes(precision)) text += `.${day}`;
    if (precision === 'time') {
      const timeStr = typeof date.time_str === 'string' ? date.time_str.trim() : '';
      if (timeStr) text += ` ${timeStr}`;
    }
    return text.trim();
  }

  _clampDateForSnapshotRepair(date, precision = 'day', timeSegments = []) {
    if (!date || typeof date !== 'object') return { date: null, changed: false };
    const normalizedPrecision = this._normalizeValidationPrecision(precision);
    const year = Number.parseInt(date.year, 10);
    if (!Number.isFinite(year) || year === 0) {
      return { date: null, changed: false };
    }

    const next = { year };
    let changed = false;

    const rawMonth = Number.parseInt(date.month, 10);
    if (['month', 'day', 'time'].includes(normalizedPrecision) || date.month !== undefined) {
      const month = Number.isFinite(rawMonth) ? Math.max(1, Math.min(12, rawMonth)) : 1;
      next.month = month;
      if (!Number.isFinite(rawMonth) || rawMonth !== month) changed = true;
    }

    const rawDay = Number.parseInt(date.day, 10);
    if (['day', 'time'].includes(normalizedPrecision) || date.day !== undefined) {
      const day = Number.isFinite(rawDay) ? Math.max(1, Math.min(30, rawDay)) : 1;
      next.day = day;
      if (!Number.isFinite(rawDay) || rawDay !== day) changed = true;
    }

    if (normalizedPrecision === 'time') {
      const timeStr = this._normalizeClockTimeString(date.time_str || date.timeStr || '');
      next.time_str = timeStr || '00:00';
      if (timeStr !== next.time_str) changed = true;
    }

    return { date: next, changed };
  }

  _repairCharacterTimelineDates(snapshot, precision, timeSegments, runtime, repairReport, options) {
    const skipCharIds = options?.skipCharIds;
    const characterTimelines =
      snapshot?.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
      if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
        continue;
      if (skipCharIds?.has(characterId)) continue;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : null;
        if (!entries || entries.length === 0) continue;

        entries.forEach((entry, index) => {
          if (!entry || typeof entry !== 'object') return;
          const fixed = this._clampDateForSnapshotRepair(entry, precision, timeSegments);
          if (!fixed.date || !fixed.changed) return;
          entry.year = fixed.date.year;
          if (fixed.date.month !== undefined) entry.month = fixed.date.month;
          if (fixed.date.day !== undefined) entry.day = fixed.date.day;
          if (fixed.date.time_str !== undefined) entry.time_str = fixed.date.time_str;
          this._recordSnapshotRepair(
            repairReport,
            `character_timelines.${characterId}.${section}[${index}]`,
            `${characterId}.${section}[${index}] 的时间已自动修正到合法范围`
          );
        });

        const sorted = entries
          .map((entry, index) => ({
            entry,
            index,
            date: runtime._parseTimelineNodeDate?.(entry),
          }))
          .sort((a, b) => {
            if (!a.date && !b.date) return a.index - b.index;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return runtime.compareDates(a.date, b.date, precision, timeSegments);
          })
          .map(item => item.entry);

        const changedOrder = sorted.some((entry, index) => entry !== entries[index]);
        if (changedOrder) {
          timelineGroup[section] = sorted;
          this._recordSnapshotRepair(
            repairReport,
            `character_timelines.${characterId}.${section}`,
            `${characterId}.${section} 已按时间自动排序`
          );
        }
      }
    }
  }

  _repairCharacterBirthdays(snapshot, precision, timeSegments, runtime, repairReport, options) {
    const skipCharIds = options?.skipCharIds;
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const timelineEvents = Array.isArray(snapshot?.world_timeline?.events)
      ? snapshot.world_timeline.events
      : Array.isArray(snapshot?.timeline?.events)
        ? snapshot.timeline.events
        : [];
    const characterTimelines =
      snapshot?.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    const earliestById = new Map();
    const earliestByName = new Map();

    const rememberEarliest = (map, key, date) => {
      if (!key || !date) return;
      const prev = map.get(key);
      if (!prev || runtime.compareDates(date, prev, precision, timeSegments) < 0) {
        map.set(key, date);
      }
    };

    timelineEvents.forEach(event => {
      const eventDate = runtime._parseSnapshotEventDate?.(event);
      const fixed = this._clampDateForSnapshotRepair(eventDate, precision, timeSegments);
      if (!fixed.date) return;
      this._splitTimelineCharacters(event?.characters).forEach(name => {
        rememberEarliest(earliestByName, name, fixed.date);
      });
    });

    Object.entries(characterTimelines).forEach(([characterId, timelineGroup]) => {
      if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
        return;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : [];
        entries.forEach(entry => {
          const entryDate = runtime._parseTimelineNodeDate?.(entry);
          const fixed = this._clampDateForSnapshotRepair(entryDate, precision, timeSegments);
          if (!fixed.date) return;
          rememberEarliest(earliestById, characterId, fixed.date);
        });
      }
    });

    Object.entries(characterDatabase).forEach(([characterId, character]) => {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') return;
      if (skipCharIds?.has(characterId)) return;
      if (typeof character.birthday === 'string') {
        const rawBirthday = character.birthday.trim();
        if (/^null$/i.test(rawBirthday)) {
          character.birthday = null;
          this._recordSnapshotRepair(
            repairReport,
            `character_database.${characterId}.birthday`,
            `${characterId}.birthday 已自动改为 null`
          );
        } else if (rawBirthday) {
          const normalizedBirthday = this._normalizeBirthdayStringForPrecision(
            rawBirthday,
            precision,
            snapshot
          );
          if (normalizedBirthday !== rawBirthday) {
            character.birthday = normalizedBirthday;
            this._recordSnapshotRepair(
              repairReport,
              `character_database.${characterId}.birthday`,
              `${characterId}.birthday 已自动规范为纯日期`
            );
          }
        }
      }
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      const earliest = earliestById.get(characterId) || earliestByName.get(name) || null;
      const parsedBirthday = runtime._parseBirthdayDate?.(character.birthday);
      const fixedBirthday = this._clampDateForSnapshotRepair(
        parsedBirthday,
        precision,
        timeSegments
      );

      if (fixedBirthday.date && fixedBirthday.changed) {
        const nextBirthdayText = this._formatSnapshotDateText(fixedBirthday.date, snapshot, {
          precision: 'day',
        });
        if (nextBirthdayText && character.birthday !== nextBirthdayText) {
          character.birthday = nextBirthdayText;
          this._recordSnapshotRepair(
            repairReport,
            `character_database.${characterId}.birthday`,
            `${characterId}.birthday 已自动修正到合法范围`
          );
        }
      }

      const currentBirthday = runtime._parseBirthdayDate?.(character.birthday);
      if (
        earliest &&
        (!currentBirthday ||
          runtime.compareDates(currentBirthday, earliest, precision, timeSegments) > 0)
      ) {
        // 在首次登场时间基础上减去 20 年，确保角色至少 20 岁
        const offsetYear = Math.max(1, earliest.year - 20);
        const offsetEarliest = { ...earliest, year: offsetYear };
        const repairedBirthday = this._formatSnapshotDateText(offsetEarliest, snapshot, {
          precision: 'day',
        });
        if (repairedBirthday && character.birthday !== repairedBirthday) {
          character.birthday = repairedBirthday;
          this._recordSnapshotRepair(
            repairReport,
            `character_database.${characterId}.birthday`,
            `${characterId}.birthday 已自动前移到首次登场前20年`
          );
        }
      }
    });
  }

  _repairPromptModuleTimeTexts(
    snapshot,
    precision,
    timeSegments,
    runtime,
    repairReport,
    referenceWindow
  ) {
    if (!snapshot || typeof snapshot !== 'object' || !referenceWindow?.end) return;

    const fixedTimeText = this._formatSnapshotDateText(referenceWindow.end, snapshot, {
      precision,
      spaced: true,
    });
    if (!fixedTimeText) return;

    // Wave 1C：开场白正位在 snapshot 顶层，老位置 prompt_modules 仅 V1 兜底——两处都修，
    // 防陈旧时间示例留在任一侧（运行时顶层优先，只修 pm 会被遮蔽）
    const greetingTargets = [
      { holder: snapshot, label: 'opening_greeting' },
      { holder: snapshot.prompt_modules, label: 'prompt_modules.opening_greeting' },
    ];
    greetingTargets.forEach(({ holder, label }) => {
      if (!holder || typeof holder !== 'object' || typeof holder.opening_greeting !== 'string') {
        return;
      }
      const openingExamples = this._extractConcreteTimeExamplesFromText(
        holder.opening_greeting,
        precision,
        runtime
      );
      let nextGreeting = holder.opening_greeting;
      const replaced = [];
      openingExamples.forEach(item => {
        if (this._isDateInsideWindow(item.date, referenceWindow, precision, timeSegments, runtime))
          return;
        nextGreeting = nextGreeting.split(item.text).join(fixedTimeText);
        replaced.push(item.text);
      });
      if (nextGreeting !== holder.opening_greeting) {
        holder.opening_greeting = nextGreeting;
        this._recordSnapshotRepair(
          repairReport,
          label,
          `opening_greeting 的时间示例已自动改为 ${fixedTimeText}${replaced.length > 1 ? `（替换 ${replaced.length} 处）` : ''}`
        );
      }
    });
  }

  _repairSnapshotBeforePersist(snapshot, options) {
    const runtime = this._getTimeValidationRuntime();
    const report = {
      applied: false,
      fixes: [],
    };
    if (!snapshot || typeof snapshot !== 'object') return report;
    if (!runtime || typeof runtime.compareDates !== 'function') return report;

    const { precision, timeSegments } = this._getSnapshotTimeConfig(snapshot);
    this._repairCharacterTimelineDates(snapshot, precision, timeSegments, runtime, report, options);
    this._repairCharacterBirthdays(snapshot, precision, timeSegments, runtime, report, options);

    const timeReport = this._validateTimeConsistencyForSnapshot(snapshot);
    const referenceWindow = this._resolvePromptTimeReferenceWindow(
      timeReport,
      timeReport?.parsedTimelineDates || [],
      precision,
      timeSegments,
      runtime
    );
    if (referenceWindow?.start && referenceWindow?.end) {
      this._repairPromptModuleTimeTexts(snapshot, precision, timeSegments, runtime, report, {
        start: referenceWindow.start,
        end: referenceWindow.end,
        label: referenceWindow.label || '主时间线末段',
      });
    }
    this._repairRecommendedOpeningTextForSnapshot(snapshot, report);
    this._sanitizeSnapshotStructureSemantic(snapshot, report);

    return report;
  }

  _sanitizeSnapshotStructureSemantic(snapshot, report) {
    if (!snapshot) return;

    // 0. entity.sites 统一成 site 树形（三段式规范 §2.1）：旧扁平 (site,spot) 对按 site 名分组成树。
    //    容错读取方本就能吃扁平，但落库/导出时归一成树，保证作者保存/导出的卡是规范形态。
    if (typeof window !== 'undefined' && typeof window.flatSitesToTree === 'function') {
      const settings = snapshot.world_setting && snapshot.world_setting.settings;
      if (settings && typeof settings === 'object') {
        let touched = 0;
        for (const [eid, ent] of Object.entries(settings)) {
          if (eid.startsWith('_') || !ent || typeof ent !== 'object' || Array.isArray(ent)) continue;
          if (!Array.isArray(ent.sites)) continue;
          const before = JSON.stringify(ent.sites);
          ent.sites = window.flatSitesToTree(ent.sites);
          if (JSON.stringify(ent.sites) !== before) touched++;
        }
        if (touched > 0) {
          this._recordSnapshotRepair(report, 'world_setting.sites', `归一 ${touched} 个 entity 的 sites 为 site 树形`);
        }
      }
    }

    // 1. 确保 relationship_rules 存在，防止引发游戏内解析崩溃
    if (
      !snapshot.relationship_rules ||
      typeof snapshot.relationship_rules !== 'object' ||
      Array.isArray(snapshot.relationship_rules)
    ) {
      snapshot.relationship_rules = {};
      this._recordSnapshotRepair(
        report,
        'relationship_rules',
        '补充缺失的 relationship_rules 节点'
      );
    }

    // 1b. 若 relationship_rules 为空，尝试从 character_timelines 的最早 relationship 条目自动提取默认关系
    if (
      snapshot.relationship_rules &&
      typeof snapshot.relationship_rules === 'object' &&
      !Array.isArray(snapshot.relationship_rules)
    ) {
      const rr = snapshot.relationship_rules;
      const ct = snapshot.character_timelines;
      if (ct && typeof ct === 'object' && !Array.isArray(ct)) {
        const rrIds = Object.keys(rr).filter(k => !k.startsWith('_'));
        if (rrIds.length === 0) {
          // 从每个角色的 relationships 时间线中取最早一条作为默认关系
          let extracted = 0;
          for (const charId of Object.keys(ct).filter(k => !k.startsWith('_'))) {
            const relTimeline = ct[charId]?.relationships;
            if (!Array.isArray(relTimeline) || relTimeline.length === 0) continue;
            // 取时间最早的一条
            const earliest = relTimeline.reduce((a, b) => {
              const ay = a.year ?? 0,
                by = b.year ?? 0;
              if (ay !== by) return ay < by ? a : b;
              const am = a.month ?? 0,
                bm = b.month ?? 0;
              return am <= bm ? a : b;
            });
            if (earliest?.relations && typeof earliest.relations === 'object') {
              rr[charId] = { default: { ...earliest.relations } };
              extracted++;
            }
          }
          if (extracted > 0) {
            this._recordSnapshotRepair(
              report,
              'relationship_rules',
              `从 character_timelines 最早关系条目自动补全 relationship_rules（${extracted} 个角色）`
            );
          }
        }
      }
    }

    // 1c. relationship_rules 对称性自动修复
    // 若 A.default 定义了对 B 的关系，但 B.default 中缺少对 A 的定义，则自动补充反向关系为"未定义"。
    // 这样至少保证引擎能正常查找，而不是抛出 undefined。
    {
      const rr = snapshot.relationship_rules;
      if (rr && typeof rr === 'object' && !Array.isArray(rr)) {
        const rrIds = Object.keys(rr).filter(k => !k.startsWith('_'));
        let symmetryRepaired = 0;
        for (const charId of rrIds) {
          const rule = rr[charId];
          if (!rule?.default || typeof rule.default !== 'object') continue;
          for (const targetId of Object.keys(rule.default)) {
            if (!rrIds.includes(targetId)) continue;
            const targetRule = rr[targetId];
            if (!targetRule?.default) {
              rr[targetId] = { default: {} };
            }
            if (!rr[targetId].default[charId]) {
              rr[targetId].default[charId] = '未定义';
              symmetryRepaired++;
            }
          }
        }
        if (symmetryRepaired > 0) {
          this._recordSnapshotRepair(
            report,
            'relationship_rules',
            `自动补全 ${symmetryRepaired} 处单向关系的反向定义（值为"未定义"，建议在 P3 阶段补充实际关系描述）`
          );
        }
      }
    }

    // 2. 确保 world_timeline.events 均有 id 属性，且 day 字段为 "X日" 字符串（兼容老卡 timeline）
    const wtForRepair = snapshot.world_timeline || snapshot.timeline;
    if (wtForRepair && Array.isArray(wtForRepair.events)) {
      let repairedIds = 0;
      let repairedDays = 0;
      wtForRepair.events.forEach((event, idx) => {
        if (!event.id) {
          event.id = `evt_${String(idx + 1).padStart(3, '0')}`;
          repairedIds++;
        }
        if (typeof event.day === 'number') {
          event.day = `${event.day}日`;
          repairedDays++;
        }
      });
      if (repairedIds > 0) {
        this._recordSnapshotRepair(
          report,
          'world_timeline.events.id',
          `为 ${repairedIds} 个时间线事件补充独立 ID`
        );
      }
      if (repairedDays > 0) {
        this._recordSnapshotRepair(
          report,
          'world_timeline.events.day',
          `为 ${repairedDays} 个时间线事件的 day 字段补充 "日" 后缀`
        );
      }
    }

    // 3. 删除 prompt_modules 下误生成的局部 npc_fields 节点
    if (snapshot.prompt_modules && snapshot.prompt_modules.npc_fields) {
      delete snapshot.prompt_modules.npc_fields;
      this._recordSnapshotRepair(
        report,
        'prompt_modules.npc_fields',
        '剥离 prompt_modules 中非法的自定义 npc_fields 污染'
      );
    }

    // 4. 对 location_levels 做合法性语义回退
    const worldTerms = snapshot.panel_fields?._worldTermsSource;
    if (worldTerms && Array.isArray(worldTerms.location_levels)) {
      const ws = snapshot.world_setting?.settings || {};
      const entityNames = Object.values(ws)
        .map(v => {
          // V2 entity（对象）→ display_name；V1 entity（markdown 字符串）→ 标题行正则
          if (v && typeof v === 'object' && !Array.isArray(v)) {
            return typeof v.display_name === 'string' ? v.display_name.trim() : '';
          }
          if (typeof v === 'string') {
            const match = v.match(/(?:设定|Entity(?:\s+Setting)?)\s*--\s*(.+?)\s*[（(]/i);
            return match ? match[1].trim() : '';
          }
          return '';
        })
        .filter(Boolean);

      // 如果 location_levels 直接就是写死了大实体名字，则退回通用安全标签
      const hasEntityName = worldTerms.location_levels.some(
        l => entityNames.includes(l) || l.includes('实体') || /entity/i.test(l)
      );
      if (hasEntityName && worldTerms.location_levels.length > 0) {
        const safeFallbacks =
          (window.i18nService?.getDesignLanguage?.() || 'zh-CN') === 'en'
            ? ['Region', 'Location', 'Spot']
            : ['地区', '地点', '具体位置'];
        worldTerms.location_levels = safeFallbacks.slice(0, worldTerms.location_levels.length);
        this._recordSnapshotRepair(
          report,
          'worldTermsSource.location_levels',
          '修正 location_levels 直接使用了实体名的问题，已重置为通用回退词'
        );
      }
    }

    // 5. year 标签语义修正
    if (
      worldTerms &&
      Array.isArray(worldTerms.calendar_units) &&
      worldTerms.calendar_units.length > 0
    ) {
      const yearUnit = worldTerms.calendar_units[0];
      if (/(世纪|世代|纪元|期)/.test(yearUnit)) {
        // 跳过 Pre- 前缀的远古事件，取第一个非 Pre- 事件校验年份数字
        const events = snapshot.world_timeline?.events || snapshot.timeline?.events || [];
        const checkTL = events.find(e => e?.time && !/^Pre-/i.test(e.time));
        if (checkTL) {
          const stripped = (checkTL.time || '').replace(/^[^\d]+/, '');
          if (/^\d+/.test(stripped)) {
            worldTerms.calendar_units[0] = '年';
            this._recordSnapshotRepair(
              report,
              'worldTermsSource.calendar_units',
              "检测到普通年份数字配以'世纪'修饰符的冲突，已自动规范为'年'"
            );
          }
        }
      }
    }

    // 6. extra_char_fields 过滤重复或无效的通用字段
    if (worldTerms && Array.isArray(worldTerms.extra_char_fields)) {
      const originalLen = worldTerms.extra_char_fields.length;
      const invalidKeys = new Set([
        'personality',
        'appearance',
        'clothing',
        'name',
        'gender',
        'origin',
        'birthday',
        'cognitive_state',
        'default_cognitive_state',
        'initial_status',
        'msg_reply_tone',
        'dialogue_tone',
        'dialogue_examples',
        'trigger_type',
        'id',
      ]);
      worldTerms.extra_char_fields = worldTerms.extra_char_fields.filter(field => {
        return field && typeof field === 'object' && field.key && !invalidKeys.has(field.key);
      });
      if (worldTerms.extra_char_fields.length < originalLen) {
        this._recordSnapshotRepair(
          report,
          'worldTermsSource.extra_char_fields',
          '过滤了 extra_char_fields 中与系统自带字段重复冲突的废弃定义'
        );
      }
    }
  }

  _syncRepairedSnapshotSections(targetSnapshot, sourceSnapshot) {
    if (
      !targetSnapshot ||
      typeof targetSnapshot !== 'object' ||
      !sourceSnapshot ||
      typeof sourceSnapshot !== 'object'
    ) {
      return;
    }
    if (targetSnapshot.random_opening !== undefined) {
      delete targetSnapshot.random_opening;
    }
    // relationship_rules / panel_fields 也会被 _sanitizeSnapshotStructureSemantic 确定性修复
    // （补默认关系 / 修单向关系 / 校正 worldTerms location_levels·extra_char_fields），
    // 必须一并回写，否则修复落在丢弃的 workingSnapshot 上、repairReport 却向用户显示「已修复 N 项」（假性安心）。
    // world_setting 目前只读不改，防御性纳入以防未来加修复逻辑时再踩同一坑。
    const keys = [
      'character_database',
      'character_timelines',
      'prompt_modules',
      'world_timeline',
      'timeline',
      'relationship_rules',
      'panel_fields',
      'world_setting',
      // 顶层 opening_greeting：_repairPromptModuleTimeTexts 会修它的时间示例（greetingTargets[0]）。
      // 不回写就会被丢弃、repairReport 却报「已修复 N 项」（假性安心）；运行时顶层优先读，必须同步。
      'opening_greeting',
    ];
    keys.forEach(key => {
      if (sourceSnapshot[key] === undefined) {
        delete targetSnapshot[key];
        return;
      }
      targetSnapshot[key] = JSON.parse(JSON.stringify(sourceSnapshot[key]));
    });
  }

  _formatSnapshotRepairSummary(repairReport, prefix = '已自动修复') {
    if (
      !repairReport?.applied ||
      !Array.isArray(repairReport.fixes) ||
      repairReport.fixes.length === 0
    ) {
      return '';
    }
    return `${prefix} ${repairReport.fixes.length} 项`;
  }

  // ── Phase 2→3 时间一致性检查 ──────────────────────────────────

  /**
   * Phase 2 完成后执行：自动修复 AI 生成的时间异常，检测用户指定的时间异常并推入 Phase 3 问答。
   */

  /**
   * 处理用户对一致性发现的响应（按钮点击）。
   * @param {string} findingId - finding 的 ID
   * @param {'fix'|'keep'|'custom'|'edit'} action - 用户选择的操作
   * @param {string} [customValue] - 自定义值（仅 action='custom' 时使用）
   */
  _resolveConsistencyFinding(findingId, action, customValue) {
    const findings = this._pendingConsistencyFindings;
    if (!Array.isArray(findings)) return;
    const finding = findings.find(f => f.id === findingId);
    if (!finding || finding.resolved) return;

    const dc = this.designConfig;

    if (action === 'keep') {
      finding.resolved = true;
      finding.resolution = 'keep';
    } else if (action === 'fix') {
      const runtime = this._getTimeValidationRuntime();
      if (runtime && finding.characterId) {
        // 构建 skipSet：跳过其他未处理的用户指定角色，只修复当前角色
        const otherUnresolved = new Set(
          findings
            .filter(f => !f.resolved && f.characterId && f.characterId !== finding.characterId)
            .map(f => f.characterId)
        );
        const { precision, timeSegments } = this._getSnapshotTimeConfig(dc);
        const tempReport = { applied: false, fixes: [] };
        if (finding.type === 'birthday') {
          this._repairCharacterBirthdays(dc, precision, timeSegments, runtime, tempReport, {
            skipCharIds: otherUnresolved,
          });
        } else if (finding.type === 'character_timeline') {
          this._repairCharacterTimelineDates(dc, precision, timeSegments, runtime, tempReport, {
            skipCharIds: otherUnresolved,
          });
        }
      }
      finding.resolved = true;
      finding.resolution = 'fix';
    } else if (action === 'custom' && customValue) {
      if (finding.type === 'birthday' && finding.characterId) {
        const char = dc.character_database?.[finding.characterId];
        if (char) {
          // 与 'fix' 路径一致：把用户输入按快照时间精度归一，避免直写非法/不一致的生日串。
          let nextBirthday = customValue;
          try {
            const { precision } = this._getSnapshotTimeConfig(dc);
            const normalized = this._normalizeBirthdayStringForPrecision(customValue, precision, dc);
            if (normalized) nextBirthday = normalized;
          } catch (_) { /* 归一失败则保留原输入 */ }
          char.birthday = nextBirthday;
        }
      }
      finding.resolved = true;
      finding.resolution = 'custom';
    } else if (action === 'edit') {
      // 预填 Phase 3 输入框（事件修改交给 AI 处理）
      const inputEl = document.querySelector('#design-chat-input, #chat-input');
      if (inputEl) {
        inputEl.value = `请修改时间线中第 ${(finding.eventIndex || 0) + 1} 个事件的时间到合理范围（当前为 ${finding.currentValue}，预期在 ${finding.expectedRange} 之间）`;
        inputEl.focus();
      }
      finding.resolved = true;
      finding.resolution = 'edit';
    }

    // 保存并刷新
    this._saveDesignConfig();
    this._updatePreviewPanel();

    // 更新聊天中的按钮状态
    this._updateConsistencyFindingUI(findingId, finding.resolution);
  }

  /**
   * 更新聊天消息中某个 finding 的按钮状态为已处理。
   */

  /**
   * 更新聊天消息中某个 finding 的按钮状态为已处理。
   */
  _updateConsistencyFindingUI(findingId, resolution) {
    const container = document.querySelector(`[data-finding-id="${findingId}"]`);
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });
    const labels = { fix: '已修改', keep: '已保持', custom: '已自定义', edit: '已转至编辑' };
    const badge = document.createElement('span');
    badge.className = 'consistency-resolved-badge';
    badge.textContent = `✓ ${labels[resolution] || '已处理'}`; /* ui-lint-allow */
    badge.style.cssText = 'color: var(--status-success); font-size: var(--text-caption); margin-left: 8px;'; // ui-lint-allow
    container.appendChild(badge);
  }
}

_applyDesignServiceMixin(_DesignServiceSnapshotInfraMixin);
