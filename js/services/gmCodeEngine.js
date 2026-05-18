// ============================================
// GM Code Engine - 纯代码 GM 决策引擎
// ============================================
// 用纯 JavaScript 代码取代 GM AI 调用
// 职责：事件筛选 + 场景节奏判断 + directive 生成
// ============================================

class GMCodeEngine {
  constructor() {
    // 已播报事件记录 { eventId: { turn, type } }
    this._broadcastedEvents = {};
    // 开场引导状态（每局随机一次，存档内固定）
    this._openingGuide = null;
  }

  _deepClone(value) {
    if (value === null || value === undefined) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_e) {
      return value;
    }
  }

  _getActiveWorldCardId() {
    if (typeof window === 'undefined') return null;
    return window.worldCardManager?.getActiveCardId?.() || null;
  }

  _pickRandom(list) {
    if (!Array.isArray(list) || list.length === 0) return null;
    const index = Math.floor(Math.random() * list.length);
    return list[index];
  }

  _eventContainsCharacter(event, characterName) {
    if (!event || !characterName) return false;
    const rawCharacters = typeof event.characters === 'string' ? event.characters : '';
    if (!rawCharacters.trim()) return false;
    const names = this._splitEventCharacters(rawCharacters);
    return names.includes(characterName);
  }

  _splitEventCharacters(rawCharacters) {
    if (typeof rawCharacters !== 'string') return [];
    return rawCharacters
      .split(/\s*\/\s*|\s*,\s*|\s+/)
      .map(name => name.trim())
      .filter(Boolean);
  }

  _resolveLocationDisplayName(locationStr) {
    if (!locationStr || typeof locationStr !== 'string') return '';
    const parts = locationStr
      .split('-')
      .map(part => part.trim())
      .filter(Boolean);
    if (!parts.length) return '';

    if (typeof window.entityStore?.resolveDisplayName === 'function') {
      return parts.map(part => window.entityStore.resolveDisplayName(part) || part).join('-');
    }
    return locationStr.trim();
  }

  _normalizeRawLocationValue(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim().replace(/\s+/g, ' ');
    return trimmed ? `raw:${trimmed.toLowerCase()}` : '';
  }

  _resolveLocationCanonicalKey(value) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.startsWith('entity:') || trimmed.startsWith('raw:')) {
        return trimmed;
      }
    }
    if (typeof window.entityStore?.resolveCanonicalKey === 'function') {
      return window.entityStore.resolveCanonicalKey(value);
    }
    return this._normalizeRawLocationValue(value);
  }

  _normalizeLocationForCompare(location) {
    if (typeof window.entityStore?.normalizeLocationForCompare === 'function') {
      return window.entityStore.normalizeLocationForCompare(location);
    }
    return {
      country: this._normalizeRawLocationValue(location?.country || ''),
      site: this._normalizeRawLocationValue(location?.site || ''),
      spot: this._normalizeRawLocationValue(location?.spot || ''),
    };
  }

  _buildSynthSnapshot() {
    const snap = {};
    if (window.npcStore?.getCharacterDatabase) {
      snap.character_database = window.npcStore.getCharacterDatabase() || {};
    }
    if (window.timelineStore?.getEvents) {
      snap.timeline = { events: window.timelineStore.getEvents() };
    }
    if (window.worldMeta) {
      const timeTerms = window.worldMeta.getActiveTimeTerms?.();
      snap.step3_fields = window.worldMeta.getStep3Fields?.();
      snap.prompt_modules = window.worldMeta.getPromptConfig?.() || {};
      if (timeTerms) snap._timeTerms = timeTerms;
    }
    return Object.keys(snap).length > 0 ? snap : null;
  }

  _buildClueText(event) {
    if (!event || typeof event.content !== 'string') return '';

    const content = event.content.replace(/\s+/g, ' ').trim();
    if (!content) return '';

    const sentenceMatch = content.match(/^[^。！？!?]+/);
    let snippet = sentenceMatch ? sentenceMatch[0].trim() : content;
    if (snippet.length > 26) {
      snippet = snippet.slice(0, 26).trim();
    }
    snippet = snippet.replace(/[。！？!?…]+$/g, '').trim();

    const displayName = this._resolveLocationDisplayName(event.location);
    const prefix =
      displayName && displayName !== '不详' ? `${displayName}那边传来风声：` : '街头传来风声：';

    return `${prefix}${snippet}。`;
  }

  _escapeRegExp(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _sanitizeNarrativeForGuide(text) {
    if (typeof text !== 'string') return '';

    const lines = text.split('\n');
    const filtered = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return true;

      if (/^[A-DＡ-Ｄ][\.\、:：\)\]）]\s*/.test(trimmed)) return false;
      if (/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/.test(trimmed)) return false;
      if (/^选项\s*[:：]?/i.test(trimmed)) return false;
      return true;
    });

    return filtered.join('\n').trim();
  }

  _normalizeGuideText(text) {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[，。！？；：“”‘’、（）《》【】…·,.!?;:'"(){}\[\]<>~`@#$%^&*_\-+=|\\/]/g, '')
      .replace(/\s+/g, '');
  }

  _splitKeywordByLength(keyword) {
    if (typeof keyword !== 'string') return [];
    const text = keyword.trim();
    if (!text) return [];
    if (text.length < 6) return [text];

    const mid = Math.floor(text.length / 2);
    const first = text.slice(0, mid).trim();
    const second = text.slice(mid).trim();
    return [first, second].filter(item => item.length >= 2);
  }

  _extractGuideKeywords(clueText) {
    if (typeof clueText !== 'string') return [];

    const stopWords = new Set([
      '那边',
      '街头',
      '传来',
      '风声',
      '消息',
      '听说',
      '听闻',
      '传闻',
      '近日',
      '最近',
      '有人',
      '一条',
      '一则',
      '这个',
      '那个',
      '这里',
      '那里',
      '事情',
      '事件',
      '情况',
      '发生',
      '之后',
      '已经',
      '正在',
    ]);

    const source = clueText
      .replace(/^.*?(?:传来风声|传来消息|风声传来|消息传来)[:：]/, '')
      .replace(/^.*?(?:听闻|听说|传闻)[:：]?/, '')
      .trim();

    const keywords = [];
    const pushKeyword = value => {
      if (typeof value !== 'string') return;
      const normalized = value.trim();
      if (normalized.length < 2) return;
      if (stopWords.has(normalized)) return;
      if (!keywords.includes(normalized)) {
        keywords.push(normalized);
      }
    };

    source.split(/[\s，。！？；：、,.!?;:·…]+/).forEach(token => pushKeyword(token));

    if (keywords.length < 2 && keywords.length > 0) {
      const splitParts = this._splitKeywordByLength(keywords[0]);
      splitParts.forEach(part => pushKeyword(part));
    }

    if (keywords.length < 2) {
      const normalizedClue = this._normalizeGuideText(source || clueText);
      if (normalizedClue.length >= 6) {
        const mid = Math.floor(normalizedClue.length / 2);
        pushKeyword(normalizedClue.slice(0, mid));
        pushKeyword(normalizedClue.slice(mid));
      }
    }

    return keywords.slice(0, 6);
  }

  _hasNpcInteractionInText(narrativeText, npcName) {
    if (typeof narrativeText !== 'string' || typeof npcName !== 'string') return false;
    const name = npcName.trim();
    if (!name) return false;
    if (!narrativeText.includes(name)) return false;

    const signals = [
      '说',
      '问',
      '回答',
      '回应',
      '开口',
      '对你',
      '与你',
      '你与',
      '看向你',
      '朝你',
      '告诉你',
      '向你',
      '对话',
      '交谈',
      '搭话',
      '招呼',
    ];

    let fromIndex = 0;
    let checks = 0;
    while (checks < 12) {
      const index = narrativeText.indexOf(name, fromIndex);
      if (index === -1) break;

      const windowStart = Math.max(0, index - 28);
      const windowEnd = Math.min(narrativeText.length, index + name.length + 28);
      const windowText = narrativeText.slice(windowStart, windowEnd);

      if (signals.some(signal => windowText.includes(signal))) {
        return true;
      }

      if ((windowText.includes('：') || windowText.includes(':')) && windowText.includes('你')) {
        return true;
      }

      fromIndex = index + name.length;
      checks += 1;
    }

    const escapedName = this._escapeRegExp(name);
    const interactionPatterns = [
      new RegExp(
        `${escapedName}.{0,10}(说|问|回答|回应|对你|与你|看向你|朝你|告诉你|向你|搭话|交谈)`
      ),
      new RegExp(`(你|你们).{0,10}${escapedName}.{0,10}(说|问|回答|回应|看向|搭话|交谈)`),
      new RegExp(`${escapedName}[:：].{0,20}(你|您)`),
    ];
    return interactionPatterns.some(pattern => pattern.test(narrativeText));
  }

  _hasEventClueInText(narrativeText, clueText) {
    const normalizedNarrative = this._normalizeGuideText(narrativeText);
    const normalizedClue = this._normalizeGuideText(clueText);
    if (!normalizedNarrative || !normalizedClue) return false;

    if (normalizedNarrative.includes(normalizedClue)) {
      return true;
    }

    const keywords = this._extractGuideKeywords(clueText);
    if (keywords.length < 2) return false;

    let hitCount = 0;
    for (const keyword of keywords) {
      const normalizedKeyword = this._normalizeGuideText(keyword);
      if (!normalizedKeyword) continue;
      if (normalizedNarrative.includes(normalizedKeyword)) {
        hitCount += 1;
        if (hitCount >= 2) {
          return true;
        }
      }
    }

    return false;
  }

  _getActiveTimeConfig() {
    const terms = window.worldMeta?.getActiveTimeTerms?.() || {};
    return {
      precision: terms.precision || 'time',
      timeSegments: Array.isArray(terms.timeSegments) ? terms.timeSegments : [],
    };
  }

  _compareDates(dateA, dateB) {
    if (
      typeof timelineService !== 'undefined' &&
      typeof timelineService.compareDates === 'function'
    ) {
      const config = this._getActiveTimeConfig();
      return timelineService.compareDates(dateA, dateB, config.precision, config.timeSegments);
    }
    return this._dateToDays(dateA) - this._dateToDays(dateB);
  }

  _parseCharacterBirthday(character) {
    const birthday = character?.birthday;
    if (
      typeof timelineService !== 'undefined' &&
      typeof timelineService.parseTimeString === 'function'
    ) {
      return timelineService.parseTimeString(birthday);
    }
    return this._parseTimeStringFallback(birthday, null);
  }

  _isDateWithinRange(date, range) {
    if (!date || !range?.start || !range?.end) return true;
    return this._compareDates(date, range.start) >= 0 && this._compareDates(date, range.end) <= 0;
  }

  _getCharacterCandidates(currentTime = null) {
    const characterDb = window.npcStore?.getCharacterDatabase?.() || null;
    if (!characterDb || typeof characterDb !== 'object') return [];

    const allCandidates = [];
    const priorityCandidates = [];

    for (const [id, char] of Object.entries(characterDb)) {
      if (id.startsWith('_')) continue;
      if (!char || typeof char !== 'object') continue;

      const name = typeof char.name === 'string' ? char.name.trim() : '';
      if (!name) continue;

      const candidate = {
        id: typeof char.id === 'string' && char.id.trim() ? char.id.trim() : id,
        name,
      };

      const birthday = this._parseCharacterBirthday(char);
      if (currentTime && birthday && this._compareDates(currentTime, birthday) < 0) {
        continue;
      }

      allCandidates.push(candidate);

      const hasSmsTone = typeof char.msg_reply_tone === 'string' && char.msg_reply_tone.trim();
      const hasDefaultCognitive =
        typeof char.default_cognitive_state === 'string' && char.default_cognitive_state.trim();
      if (hasSmsTone || hasDefaultCognitive) {
        priorityCandidates.push(candidate);
      }
    }

    return priorityCandidates.length > 0 ? priorityCandidates : allCandidates;
  }

  _getTimelineCandidates(currentTime = null, openingTimeRange = null) {
    const timelineEvents = window.timelineStore?.getEvents?.() || [];
    const characterDb = window.npcStore?.getCharacterDatabase?.() || {};
    if (!Array.isArray(timelineEvents) || timelineEvents.length === 0) return [];

    const birthdayByName = new Map();
    for (const [characterId, character] of Object.entries(characterDb)) {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') continue;
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      const birthday = this._parseCharacterBirthday(character);
      if (name && birthday) birthdayByName.set(name, birthday);
    }

    const result = [];
    for (const event of timelineEvents) {
      if (!event || typeof event !== 'object') continue;
      const content = typeof event.content === 'string' ? event.content.trim() : '';
      if (!content) continue;
      const eventDate = this._parseEventDate(event);
      if (openingTimeRange && eventDate && !this._isDateWithinRange(eventDate, openingTimeRange)) {
        continue;
      }
      if (
        !openingTimeRange &&
        currentTime &&
        eventDate &&
        this._compareDates(eventDate, currentTime) > 0
      ) {
        continue;
      }
      const eventCharacters = this._splitEventCharacters(event.characters);
      const violatesBirthday =
        eventDate &&
        eventCharacters.some(name => {
          const birthday = birthdayByName.get(name);
          return birthday && this._compareDates(eventDate, birthday) < 0;
        });
      if (violatesBirthday) continue;

      result.push({
        event,
        eventId: this._getEventId(event),
        eventDate,
      });
    }
    return result;
  }

  _buildOpeningGuideFromOpeningEvent(worldCardId = null, openingEvent = null, currentTime = null) {
    if (!openingEvent || typeof openingEvent !== 'object') return null;

    const event =
      openingEvent.event && typeof openingEvent.event === 'object' ? openingEvent.event : null;
    if (!event) return null;

    let preferredNpcCandidates = Array.isArray(openingEvent.preferredNpcCandidates)
      ? openingEvent.preferredNpcCandidates.filter(candidate => candidate && candidate.name)
      : [];
    let availableNpcCandidates = Array.isArray(openingEvent.availableNpcCandidates)
      ? openingEvent.availableNpcCandidates.filter(candidate => candidate && candidate.name)
      : [];

    if (
      availableNpcCandidates.length === 0 &&
      currentTime &&
      typeof timelineService !== 'undefined'
    ) {
      const synthSnapshot = this._buildSynthSnapshot();
      if (synthSnapshot && typeof timelineService.getAvailableCharacterCandidatesAtDate === 'function') {
        availableNpcCandidates = timelineService.getAvailableCharacterCandidatesAtDate(
          synthSnapshot,
          currentTime
        );
        const preferredNames = new Set(this._splitEventCharacters(event.characters));
        preferredNpcCandidates = availableNpcCandidates.filter(candidate =>
          preferredNames.has(candidate.name)
        );
      }
    }

    const selectedNpc = this._pickRandom(
      preferredNpcCandidates.length > 0 ? preferredNpcCandidates : availableNpcCandidates
    );
    if (!selectedNpc) {
      return null;
    }

    return {
      version: 1,
      worldCardId: worldCardId || null,
      picked: {
        npc: {
          id:
            typeof selectedNpc.id === 'string' && selectedNpc.id.trim()
              ? selectedNpc.id.trim()
              : selectedNpc.name.trim(),
          name: selectedNpc.name.trim(),
        },
        event: {
          eventId: openingEvent.eventId || this._getEventId(event),
          clueText: this._buildClueText(event),
          time: event.time || '',
          day: event.day || '',
          location: event.location || '',
          characters: event.characters || '',
        },
      },
      progress: {
        npcMet: false,
        eventClueShown: false,
        metTurn: null,
        clueTurn: null,
      },
    };
  }

  _buildOpeningGuide(
    worldCardId = null,
    currentTime = null,
    openingTimeRange = null,
    openingEvent = null
  ) {
    const anchoredGuide = this._buildOpeningGuideFromOpeningEvent(
      worldCardId,
      openingEvent,
      currentTime
    );
    if (anchoredGuide) {
      return anchoredGuide;
    }
    if (openingEvent) {
      return null;
    }

    const characterCandidates = this._getCharacterCandidates(currentTime);
    const timelineCandidates = this._getTimelineCandidates(currentTime, openingTimeRange);

    const selectedNpc = this._pickRandom(characterCandidates);
    let selectedEvent = null;

    if (selectedNpc && timelineCandidates.length > 0) {
      const relatedEvents = timelineCandidates.filter(item =>
        this._eventContainsCharacter(item.event, selectedNpc.name)
      );
      selectedEvent = this._pickRandom(
        relatedEvents.length > 0 ? relatedEvents : timelineCandidates
      );
    } else {
      selectedEvent = this._pickRandom(timelineCandidates);
    }

    if (!selectedNpc && !selectedEvent) {
      return null;
    }

    const pickedNpc = selectedNpc
      ? {
          id: selectedNpc.id,
          name: selectedNpc.name,
        }
      : null;

    const pickedEvent = selectedEvent
      ? {
          eventId: selectedEvent.eventId,
          clueText: this._buildClueText(selectedEvent.event),
          time: selectedEvent.event.time || '',
          day: selectedEvent.event.day || '',
          location: selectedEvent.event.location || '',
          characters: selectedEvent.event.characters || '',
        }
      : null;

    return {
      version: 1,
      worldCardId: worldCardId || null,
      picked: {
        npc: pickedNpc,
        event: pickedEvent,
      },
      progress: {
        npcMet: !pickedNpc,
        eventClueShown: !pickedEvent || !pickedEvent.clueText,
        metTurn: null,
        clueTurn: null,
      },
    };
  }

  _normalizeOpeningGuide(guide) {
    if (!guide || typeof guide !== 'object') return null;

    const rawNpc = guide?.picked?.npc;
    const npc =
      rawNpc && typeof rawNpc.name === 'string' && rawNpc.name.trim()
        ? {
            id:
              typeof rawNpc.id === 'string' && rawNpc.id.trim()
                ? rawNpc.id.trim()
                : rawNpc.name.trim(),
            name: rawNpc.name.trim(),
          }
        : null;

    const rawEvent = guide?.picked?.event;
    const clueText = typeof rawEvent?.clueText === 'string' ? rawEvent.clueText.trim() : '';
    const event =
      rawEvent && clueText
        ? {
            eventId: typeof rawEvent.eventId === 'string' ? rawEvent.eventId : '',
            clueText,
            time: typeof rawEvent.time === 'string' ? rawEvent.time : '',
            day: typeof rawEvent.day === 'string' ? rawEvent.day : '',
            location: typeof rawEvent.location === 'string' ? rawEvent.location : '',
            characters: typeof rawEvent.characters === 'string' ? rawEvent.characters : '',
          }
        : null;

    if (!npc && !event) return null;

    const rawProgress = guide.progress && typeof guide.progress === 'object' ? guide.progress : {};
    const metTurnNum = Number(rawProgress.metTurn);
    const clueTurnNum = Number(rawProgress.clueTurn);

    return {
      version: 1,
      worldCardId:
        typeof guide.worldCardId === 'string' && guide.worldCardId.trim()
          ? guide.worldCardId.trim()
          : null,
      picked: { npc, event },
      progress: {
        npcMet: npc ? Boolean(rawProgress.npcMet) : true,
        eventClueShown: event ? Boolean(rawProgress.eventClueShown) : true,
        metTurn: Number.isFinite(metTurnNum) ? metTurnNum : null,
        clueTurn: Number.isFinite(clueTurnNum) ? clueTurnNum : null,
      },
    };
  }

  ensureOpeningGuide(
    worldCardId = null,
    currentTime = null,
    openingTimeRange = null,
    openingEvent = null
  ) {
    const activeWorldId = worldCardId || this._getActiveWorldCardId();
    const currentWorldId = this._openingGuide?.worldCardId || null;

    if (this._openingGuide && currentWorldId === activeWorldId) {
      return this._openingGuide;
    }

    this._openingGuide = this._buildOpeningGuide(
      activeWorldId,
      currentTime,
      openingTimeRange,
      openingEvent
    );
    if (this._openingGuide) {
      console.log('[GMCodeEngine] 开场引导已初始化:', {
        worldCardId: this._openingGuide.worldCardId,
        npc: this._openingGuide.picked?.npc?.name || null,
        event: this._openingGuide.picked?.event?.eventId || null,
      });
    } else {
      console.log('[GMCodeEngine] 开场引导未初始化（缺少人物和事件数据）');
    }

    return this._openingGuide;
  }

  getOpeningGuideComment(currentTurn = 0, currentTime = null) {
    const turn = Number(currentTurn);
    if (!Number.isFinite(turn) || turn < 1 || turn > 3) return '';

    const guide = this._openingGuide;
    if (!guide || !guide.picked || !guide.progress) return '';

    const missingNpc = Boolean(guide.picked.npc) && guide.progress.npcMet !== true;
    const missingEvent =
      Boolean(guide.picked.event?.clueText) && guide.progress.eventClueShown !== true;

    if (!missingNpc && !missingEvent) {
      return '';
    }

    const lines = ['【开场引导】前3轮内请优先让玩家接触世界卡信息。'];

    if (missingNpc) {
      lines.push(
        `本轮请让「${guide.picked.npc.name}」与玩家产生至少1次明确互动（对话或当面回应）。`
      );

      // 注入被选角色的完整档案，防止 Step 2 编造
      const _charDB = window.npcStore?.getCharacterDatabase?.() || {};
      const _charData = _charDB[guide.picked.npc.id];
      if (_charData) {
        lines.push('');
        lines.push(
          `【${_charData.name} 角色档案 — 世界卡权威数据，叙事必须严格遵守，禁止编造不同的外貌/身份/性格】`
        );

        let _currentCognitiveState = '';
        if (currentTime && typeof AnalyzerManager !== 'undefined') {
          const _fullState =
            typeof AnalyzerManager.getCharacterState === 'function'
              ? AnalyzerManager.getCharacterState(guide.picked.npc.id, currentTime)
              : null;
          _currentCognitiveState =
            _fullState?.cognitive_state ||
            (typeof AnalyzerManager.getCognitiveState === 'function'
              ? AnalyzerManager.getCognitiveState(guide.picked.npc.id, currentTime)
              : '');
        }
        if (!_currentCognitiveState) {
          _currentCognitiveState = _charData.default_cognitive_state || '';
        }

        const _dynamicAge =
          typeof AnalyzerUtils !== 'undefined'
            ? AnalyzerUtils.calculateAgeFromBirthday(_charData.birthday, currentTime)
            : null;

        // 已知字段的显示标签（有序）
        const _knownLabels = [
          ['title', '头衔/职业'],
          ['gender', '性别'],
          ['origin', '来历'],
          ['birthday', '生日'],
          ['personality', '性格'],
          ['appearance', '外貌'],
          ['clothing', '服装'],
          ['msg_reply_tone', '说话语气'],
        ];
        // 不注入的结构字段
        const _skipKeys = new Set(['id', 'name', 'relationships', 'status']);
        const _outputKeys = new Set();

        // 1) 先按已知顺序输出标准字段（null 显示为"未设定"）
        for (const [key, label] of _knownLabels) {
          _outputKeys.add(key);
          const val = _charData[key];
          if (val === undefined) continue;
          lines.push(`- ${label}：${val === null ? '未设定' : val}`);
        }

        if (_dynamicAge) {
          lines.push(`- 年龄：${_dynamicAge}`);
        }

        if (_currentCognitiveState) {
          lines.push(`- 认知状态：${_currentCognitiveState}`);
        }

        // 2) 再输出自定义字段（从 step3_fields.panel_npc 获取 label）
        const _npcFields = window.worldMeta?.getStep3Fields?.()?.panel_npc || [];
        const _fieldLabelMap = {};
        for (const f of _npcFields) {
          if (f.key && f.label) _fieldLabelMap[f.key] = f.label;
        }
        for (const [key, value] of Object.entries(_charData)) {
          if (key.startsWith('_') || _skipKeys.has(key) || _outputKeys.has(key)) continue;
          if (value === undefined) continue;
          const label = _fieldLabelMap[key] || key;
          lines.push(`- ${label}：${value === null ? '未设定' : value}`);
        }

        lines.push('');
      }
    }

    if (missingEvent) {
      lines.push(
        `本轮请原样带出这句事件线索（只带一句，不展开细节）：「${guide.picked.event.clueText}」`
      );
    }

    lines.push('可通过当面对话、路人传闻或布告自然带出。');
    return lines.join('\n');
  }

  updateOpeningGuideProgress(currentTurn = 0, narrativeText = '') {
    const guide = this._openingGuide;
    if (!guide || !guide.progress || typeof narrativeText !== 'string' || !narrativeText) {
      return {
        changed: false,
        npcMet: guide?.progress?.npcMet || false,
        eventClueShown: guide?.progress?.eventClueShown || false,
      };
    }

    const cleanedNarrative = this._sanitizeNarrativeForGuide(narrativeText);
    if (!cleanedNarrative) {
      return {
        changed: false,
        npcMet: guide.progress.npcMet,
        eventClueShown: guide.progress.eventClueShown,
      };
    }

    const turn = Number(currentTurn);
    const normalizedTurn = Number.isFinite(turn) ? turn : null;
    let changed = false;

    if (guide.picked?.npc && guide.progress.npcMet !== true) {
      if (this._hasNpcInteractionInText(cleanedNarrative, guide.picked.npc.name)) {
        guide.progress.npcMet = true;
        guide.progress.metTurn = normalizedTurn;
        changed = true;
      }
    }

    if (guide.picked?.event?.clueText && guide.progress.eventClueShown !== true) {
      if (this._hasEventClueInText(cleanedNarrative, guide.picked.event.clueText)) {
        guide.progress.eventClueShown = true;
        guide.progress.clueTurn = normalizedTurn;
        changed = true;
      }
    }

    if (changed) {
      console.log('[GMCodeEngine] 开场引导进度更新:', {
        turn: normalizedTurn,
        npcMet: guide.progress.npcMet,
        eventClueShown: guide.progress.eventClueShown,
      });
    }

    return {
      changed,
      npcMet: guide.progress.npcMet,
      eventClueShown: guide.progress.eventClueShown,
    };
  }

  _resetOpeningGuideProgress() {
    if (!this._openingGuide || !this._openingGuide.progress) return false;

    const hadNpcProgress =
      this._openingGuide.progress.npcMet === true || this._openingGuide.progress.metTurn !== null;
    const hadEventProgress =
      this._openingGuide.progress.eventClueShown === true ||
      this._openingGuide.progress.clueTurn !== null;

    this._openingGuide.progress.npcMet = !this._openingGuide.picked?.npc;
    this._openingGuide.progress.eventClueShown = !this._openingGuide.picked?.event?.clueText;
    this._openingGuide.progress.metTurn = null;
    this._openingGuide.progress.clueTurn = null;

    return hadNpcProgress || hadEventProgress;
  }

  _rollbackOpeningGuideProgress(targetTurn) {
    if (!this._openingGuide || !this._openingGuide.progress) return false;
    if (targetTurn === null || targetTurn === undefined) return false;

    let changed = false;
    const progress = this._openingGuide.progress;

    if (this._openingGuide.picked?.npc) {
      const metTurn = Number(progress.metTurn);
      if (Number.isFinite(metTurn) && metTurn > targetTurn) {
        progress.npcMet = false;
        progress.metTurn = null;
        changed = true;
      }
    } else {
      progress.npcMet = true;
      progress.metTurn = null;
    }

    if (this._openingGuide.picked?.event?.clueText) {
      const clueTurn = Number(progress.clueTurn);
      if (Number.isFinite(clueTurn) && clueTurn > targetTurn) {
        progress.eventClueShown = false;
        progress.clueTurn = null;
        changed = true;
      }
    } else {
      progress.eventClueShown = true;
      progress.clueTurn = null;
    }

    return changed;
  }

  // ==========================================
  // 主入口
  // ==========================================

  /**
   * 生成 GM Directive（纯代码，无 AI）
   * @param {Object} input - 输入数据
   * @param {Object} input.currentTime - { year, month, day }
   * @param {Object} input.currentLocation - { country, site, spot }
   * @param {number} input.turnsAtLocation - 当前位置停留轮数
   * @param {number} input.scenesToday - 今日场景数
   * @param {number} input.currentTurn - 当前轮次
   * @param {string|null} input.worldCardId - 当前世界卡 ID
   * @param {Object|null} input.openingEvent - 首轮选中的开场事件上下文
   * @returns {Object} { directive, openingGuideComment, eventToReport }
   */
  generateDirective(input) {
    const {
      currentTime,
      currentLocation,
      turnsAtLocation = 0,
      scenesToday = 1,
      currentTurn = 0,
      worldCardId = null,
      openingTimeRange = null,
      openingEvent = null,
    } = input;

    // 每局随机一次开场引导，读档后保持一致
    this.ensureOpeningGuide(worldCardId, currentTime, openingTimeRange, openingEvent);

    // 1. 场景状态（查表）
    const sceneStatus = this._getSceneStatus(turnsAtLocation);

    // 2. 事件扫描与筛选
    const candidates = this._scanCandidateEvents(currentTime, currentLocation);

    // 3. 选择要播报的事件（取第一个）
    const eventToReport = candidates.length > 0 ? candidates[0] : null;

    // 4. 构建 actions
    const actions = [];

    if (eventToReport) {
      actions.push(eventToReport.type); // BROADCAST 或 FORESHADOW
    }

    if (sceneStatus.action !== 'NO_ACTION') {
      actions.push(sceneStatus.action);
    }

    if (actions.length === 0) {
      actions.push('NO_ACTION');
    }

    // 5. 构建 directive
    const directive = {
      date: this._formatDate(currentTime),
      scene_status: sceneStatus.status,
      turns: turnsAtLocation,
      action: actions.join(', '),
      event_id: eventToReport?.eventId || null,
      event_summary: eventToReport ? this._formatEventSummary(eventToReport) : null,
      day_schedule: scenesToday >= 2 && turnsAtLocation >= 3 ? 'END_DAY_SUGGESTED' : null,
    };

    // 6. 开场引导（自然语言，由 formatDirectiveToText 合并）
    const openingGuideComment = this.getOpeningGuideComment(currentTurn, currentTime);

    return { directive, openingGuideComment, eventToReport };
  }

  // ==========================================
  // 事件扫描与筛选
  // ==========================================

  /**
   * 扫描候选事件
   * @returns {Array} 已排序的候选事件数组
   */
  _scanCandidateEvents(currentDate, playerLocation) {
    if (!currentDate || !currentDate.year) return [];

    const timelineData = window.timelineStore?.getEvents?.() || [];
    if (!timelineData.length) {
      console.warn('[GMCodeEngine] timeline 数据不可用');
      return [];
    }

    const candidates = [];
    const currentDays = this._dateToDays(currentDate);

    for (const event of timelineData) {
      // 跳过无具体日期的事件
      if (event.day === '无日期') continue;

      // 解析事件日期
      const eventDate = this._parseEventDate(event);
      if (!eventDate) continue;

      const eventDays = this._dateToDays(eventDate);
      const exactCompare = this._compareDates(eventDate, currentDate);
      if (eventDays === currentDays && exactCompare > 0) continue;
      const daysDiff = eventDays - currentDays; // 正数=未来，负数=过去

      // 检查是否在时间窗口内
      const locationMatch = this._matchLocation(event.location, playerLocation);
      const isSameCountryOrCity = locationMatch.isSameCountry || locationMatch.isSameSite;

      const broadcastResult = this._shouldBroadcast(daysDiff, isSameCountryOrCity);
      if (!broadcastResult.broadcast) continue;

      // 生成 eventId
      const eventId = this._getEventId(event);

      // 检查是否已播报
      if (this.isEventBroadcasted(eventId)) continue;

      candidates.push({
        event,
        eventId,
        eventDate,
        daysDiff,
        exactCompare,
        type: broadcastResult.type,
        locationMatch,
      });
    }

    // 排序：当日 > 过去 > 未来
    return this._sortCandidates(candidates);
  }

  /**
   * 判断是否应该播报
   * @param {number} daysDiff - 天数差（负=过去，0=当日，正=未来）
   * @param {boolean} isSameCountryOrCity - 是否同城/同国
   * @returns {{ broadcast: boolean, type: string }}
   */
  _shouldBroadcast(daysDiff, isSameCountryOrCity) {
    // 过去 1-3 天：无论地点都播报
    if (daysDiff >= -3 && daysDiff < 0) {
      return { broadcast: true, type: 'BROADCAST_EVENT' };
    }

    // 当日：无论地点都播报
    if (daysDiff === 0) {
      return { broadcast: true, type: 'BROADCAST_EVENT' };
    }

    // 未来 1-3 天：无论地点都预兆
    if (daysDiff >= 1 && daysDiff <= 3) {
      return { broadcast: true, type: 'FORESHADOW' };
    }

    // 未来 4-7 天：仅异国预兆（给玩家赶路时间）
    if (daysDiff >= 4 && daysDiff <= 7 && !isSameCountryOrCity) {
      return { broadcast: true, type: 'FORESHADOW' };
    }

    return { broadcast: false };
  }

  /**
   * 候选事件排序：当日 > 过去 > 未来
   */
  _sortCandidates(candidates) {
    return candidates.sort((a, b) => {
      // 当日优先（daysDiff = 0）
      if (a.daysDiff === 0 && b.daysDiff !== 0) return -1;
      if (b.daysDiff === 0 && a.daysDiff !== 0) return 1;

      // 过去事件次之（daysDiff < 0）
      if (a.daysDiff < 0 && b.daysDiff > 0) return -1;
      if (b.daysDiff < 0 && a.daysDiff > 0) return 1;

      if (a.daysDiff === 0 && b.daysDiff === 0 && a.exactCompare !== b.exactCompare) {
        return Math.abs(a.exactCompare) - Math.abs(b.exactCompare);
      }

      // 同类型按时间远近排序（越近越优先）
      return Math.abs(a.daysDiff) - Math.abs(b.daysDiff);
    });
  }

  // ==========================================
  // 场景状态
  // ==========================================

  /**
   * 获取场景状态（查表）
   * @param {number} turns - 停留轮数
   * @returns {{ status: string, action: string }}
   */
  _getSceneStatus(turns) {
    if (turns <= 2) return { status: '舒适区', action: 'NO_ACTION' };
    if (turns <= 4) return { status: '推进区', action: 'SUGGEST_ADVANCE' };
    if (turns <= 6) return { status: '停滞区', action: 'SUGGEST_WRAP_UP' };
    return { status: '死水区', action: 'FORCE_WRAP_UP' };
  }

  // ==========================================
  // 事件标记
  // ==========================================

  /**
   * 检查事件是否已播报
   */
  isEventBroadcasted(eventId) {
    return eventId in this._broadcastedEvents;
  }

  /**
   * 标记事件为已播报
   * @param {string} eventId - 事件 ID
   * @param {number} turn - 播报回合
   * @param {string} type - 播报类型
   * @param {string} [uid] - 播报时的 UID
   */
  markEventBroadcasted(eventId, turn, type, uid = null) {
    this._broadcastedEvents[eventId] = { turn, type, uid };
    console.log(
      `[GMCodeEngine] 标记事件已播报: ${eventId} (Turn ${turn}, ${type}, UID: ${uid || 'N/A'})`
    );
  }

  // ==========================================
  // 回滚支持
  // ==========================================

  /**
   * 回滚到指定轮次（删除 turn >= targetTurn 的标记）
   */
  rollbackToTurn(targetTurn) {
    const toRemove = [];
    for (const eventId in this._broadcastedEvents) {
      if (this._broadcastedEvents[eventId].turn >= targetTurn) {
        toRemove.push(eventId);
      }
    }
    for (const eventId of toRemove) {
      delete this._broadcastedEvents[eventId];
    }
    if (toRemove.length > 0) {
      console.log(`[GMCodeEngine] 回滚 ${toRemove.length} 个已播报事件 (Turn >= ${targetTurn})`);
    }
  }

  /**
   * 基于 UID 回滚（删除 targetUID 之后的所有数据）
   * @param {string} targetUID - 目标 UID（格式: "turn_N_xxx"）
   */
  rollbackAfterUID(targetUID) {
    if (!targetUID) {
      // 没有 targetUID 意味着回滚到第一条 AI 消息，清空所有标记
      const count = Object.keys(this._broadcastedEvents).length;
      this._broadcastedEvents = {};
      const guideReset = this._resetOpeningGuideProgress();
      if (count > 0) {
        console.log(`[GMCodeEngine] 回滚清空所有 ${count} 个已播报事件`);
      }
      if (guideReset) {
        console.log('[GMCodeEngine] 回滚重置开场引导进度');
      }
      return;
    }

    // 从 targetUID 解析 turn 数（用于 UID 不可用时的 fallback）
    // 格式: "turn_N_timestamp"
    let targetTurn = null;
    const turnMatch = targetUID.match(/^turn_(\d+)_/);
    if (turnMatch) {
      targetTurn = parseInt(turnMatch[1]);
    }

    const toRemove = [];
    for (const eventId in this._broadcastedEvents) {
      const eventData = this._broadcastedEvents[eventId];
      const eventUID = eventData.uid;
      const eventTurn = eventData.turn;

      // 优先使用 UID 比较
      if (eventUID && typeof isUIDAfter === 'function' && isUIDAfter(eventUID, targetUID)) {
        toRemove.push(eventId);
      }
      // UID 不存在时，使用 turn fallback（删除 turn > targetTurn 的事件）
      else if (!eventUID && targetTurn !== null && eventTurn > targetTurn) {
        toRemove.push(eventId);
      }
    }
    for (const eventId of toRemove) {
      delete this._broadcastedEvents[eventId];
    }
    if (toRemove.length > 0) {
      console.log(`[GMCodeEngine] 回滚 ${toRemove.length} 个已播报事件 (UID > ${targetUID})`);
    }

    const guideRolledBack = this._rollbackOpeningGuideProgress(targetTurn);
    if (guideRolledBack) {
      console.log(`[GMCodeEngine] 回滚开场引导进度 (Turn > ${targetTurn})`);
    }
  }

  // ==========================================
  // 持久化
  // ==========================================

  /**
   * 导出存档数据
   */
  getData() {
    return {
      broadcastedEvents: { ...this._broadcastedEvents },
      openingGuide: this._deepClone(this._openingGuide),
    };
  }

  /**
   * 从存档恢复
   */
  restore(savedData) {
    this._broadcastedEvents = savedData?.broadcastedEvents || {};
    this._openingGuide = this._normalizeOpeningGuide(savedData?.openingGuide || null);
    console.log(`[GMCodeEngine] 恢复 ${Object.keys(this._broadcastedEvents).length} 个已播报事件`);
  }

  /**
   * 清除状态（新游戏）
   */
  clear() {
    this._broadcastedEvents = {};
    this._openingGuide = null;
    console.log('[GMCodeEngine] 状态已清除');
  }

  // ==========================================
  // 工具方法
  // ==========================================

  /**
   * 解析事件日期
   * 复用 timelineService 的逻辑
   */
  _parseEventDate(event) {
    if (typeof timelineService !== 'undefined' && timelineService.parseTimeString) {
      const baseDate = timelineService.parseTimeString(event.time);
      if (!baseDate) return null;

      // 解析 day 字段
      const dayNum = timelineService.parseDayField(event.day);
      if (!Number.isFinite(dayNum)) return null;
      return {
        ...baseDate,
        day: dayNum,
        time_str:
          typeof event?.time_str === 'string'
            ? event.time_str.trim()
            : typeof event?.timeStr === 'string'
              ? event.timeStr.trim()
              : typeof baseDate?.time_str === 'string'
                ? baseDate.time_str.trim()
                : '',
      };
    }

    // 备用解析
    return this._parseTimeStringFallback(event.time, event.day);
  }

  /**
   * 备用日期解析（如果 timelineService 不可用）
   */
  _parseTimeStringFallback(timeStr, dayStr) {
    if (!timeStr) return null;

    // 前纪元（纪年无关）
    const preMatch = timeStr.match(/(?:Pre-|前)\S*?[约]?(\d+)/);
    if (preMatch) {
      return { year: -parseInt(preMatch[1], 10), month: 1, day: 15 };
    }

    const dayMatch = dayStr?.match(/(\d+)日/);
    const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : 15;

    // 任意纪年 + 年月(.日)
    const fullMatch = timeStr.match(/(\d+)[\.。](\d+)(?:[\.。](\d+))?/);
    if (fullMatch) {
      return {
        year: parseInt(fullMatch[1], 10),
        month: parseInt(fullMatch[2], 10),
        day: fullMatch[3] ? parseInt(fullMatch[3], 10) : dayNum,
      };
    }

    // 仅年份
    const yearMatch = timeStr.match(/(\d{2,})\s*$/);
    if (yearMatch) {
      return { year: parseInt(yearMatch[1], 10), month: 1, day: dayNum };
    }

    return null;
  }

  /**
   * 将日期转换为天数（用于比较）
   * 假设每年12个月，每月30天
   */
  _dateToDays(date) {
    if (!date) return 0;
    return date.year * 360 + (date.month - 1) * 30 + (date.day - 1);
  }

  /**
   * 生成事件唯一 ID
   */
  _getEventId(event) {
    if (typeof timelineService !== 'undefined' && timelineService.getEventId) {
      return timelineService.getEventId(event);
    }
    // 备用格式
    return `${event.time}_${event.day}_${event.characters}_${(event.content || '').substring(0, 30)}`;
  }

  /**
   * 位置匹配
   */
  _matchLocation(eventLocation, playerLocation) {
    const rawEventLocation = typeof eventLocation === 'string' ? eventLocation.trim() : '';
    if (!rawEventLocation || rawEventLocation.includes('不详') || !playerLocation) {
      return { isSameCountry: false, isSameSite: false };
    }

    const normalizedPlayer = this._normalizeLocationForCompare(playerLocation);
    const playerKeys = [
      normalizedPlayer.country,
      normalizedPlayer.site,
      normalizedPlayer.spot,
    ].filter(Boolean);

    if (playerKeys.length === 0) {
      return { isSameCountry: false, isSameSite: false };
    }

    const fullEventKey = this._resolveLocationCanonicalKey(rawEventLocation);
    if (fullEventKey && playerKeys.includes(fullEventKey)) {
      return { isSameCountry: true, isSameSite: true };
    }

    const parts = rawEventLocation
      .split('-')
      .map(part => part.trim())
      .filter(Boolean);
    const eventCountryKey = this._resolveLocationCanonicalKey(parts[0] || '');
    const eventSiteKey = this._resolveLocationCanonicalKey(parts[1] || '');

    if (parts.length <= 1) {
      const isSameCountry =
        !!eventCountryKey &&
        !!normalizedPlayer.country &&
        eventCountryKey === normalizedPlayer.country;
      const isSameSite =
        !!eventCountryKey &&
        ((!!normalizedPlayer.site && eventCountryKey === normalizedPlayer.site) ||
          (!!normalizedPlayer.spot && eventCountryKey === normalizedPlayer.spot));
      return { isSameCountry, isSameSite };
    }

    const isSameCountry =
      !!eventCountryKey &&
      !!normalizedPlayer.country &&
      eventCountryKey === normalizedPlayer.country;
    const isSameSite =
      isSameCountry &&
      !!eventSiteKey &&
      ((!!normalizedPlayer.site && eventSiteKey === normalizedPlayer.site) ||
        (!!normalizedPlayer.spot && eventSiteKey === normalizedPlayer.spot));

    return { isSameCountry, isSameSite };
  }

  /**
   * 格式化日期
   */
  _formatDate(date) {
    if (!date) return '未知日期';
    const terms = window.worldMeta?.getActiveTimeTerms?.();
    const era = terms?.era || '';
    const precision = terms?.precision || 'time';
    const labels = terms?.labels || { year: '年', month: '月', day: '日' };
    let text = `${era}${date.year}${labels.year || '年'}`;
    if (
      ['month', 'day', 'time'].includes(precision) &&
      date.month !== null &&
      date.month !== undefined
    ) {
      text += `${date.month}${labels.month || '月'}`;
    }
    if (['day', 'time'].includes(precision) && date.day !== null && date.day !== undefined) {
      text += `${date.day}${labels.day || '日'}`;
    }
    const timeText = date.timeStr || date.time_str || '';
    if (precision === 'time' && timeText) {
      text += ` ${timeText}`;
    }
    return text;
  }

  /**
   * 格式化事件摘要
   */
  _formatEventSummary(candidate) {
    const { event, daysDiff } = candidate;
    let timeDesc = '';

    if (daysDiff === 0) {
      timeDesc = '（当日）';
    } else if (daysDiff < 0) {
      timeDesc = `（${Math.abs(daysDiff)}天前）`;
    } else {
      timeDesc = `（${daysDiff}天后）`;
    }

    // 完整事件内容（不截断，让 AI 理解完整语境）
    return `${event.characters}: ${event.content || ''}${timeDesc}`;
  }

  /**
   * 将 directive 格式化为自然语言文本（供 Step 2 创作 AI 直接阅读）
   * @param {Object} directive - generateDirective() 返回的 directive 对象
   * @param {string} [openingGuideComment] - 开场引导文本（已是自然语言）
   * @returns {string} 自然语言写作指导
   */
  formatDirectiveToText(directive, openingGuideComment) {
    const sentences = [];
    const action = directive.action || '';

    // 1. 日期
    sentences.push(`当前日期：${directive.date}。`);

    // 2. 场景节奏
    if (action.includes('FORCE_WRAP_UP')) {
      sentences.push(`本场景已持续${directive.turns}轮，必须在本轮收尾（天色已晚、有急事等）。选项中必须包含至少一个离开/转场选项。`);
    } else if (action.includes('SUGGEST_WRAP_UP')) {
      sentences.push(`本场景已持续${directive.turns}轮，节奏偏慢。本轮叙事必须制造明确的转折点或收尾契机。选项中应包含离开当前场景或推进主线的选项。`);
    } else if (action.includes('SUGGEST_ADVANCE')) {
      sentences.push(`本场景已持续${directive.turns}轮。请推进剧情节奏：本轮叙事应引入新信息、新冲突或关系变化，避免原地重复。选项应提供能显著改变局面的行动方向。`);
    }

    // 3. 事件
    if (directive.event_summary) {
      if (action.includes('BROADCAST_EVENT')) {
        sentences.push(
          `近期世界动态：${directive.event_summary}。可通过传闻、布告或NPC对话自然带出，也可忽略。`
        );
      } else if (action.includes('FORESHADOW')) {
        sentences.push(
          `即将发生的事件：${directive.event_summary}。可通过环境暗示或NPC担忧等方式隐约透露。`
        );
      }
    }

    // 4. 日程建议
    if (directive.day_schedule === 'END_DAY_SUGGESTED') {
      sentences.push('今天已经历多个场景，可以考虑让一天结束。');
    }

    // 5. 开场引导（已是自然语言）
    if (openingGuideComment) {
      sentences.push(openingGuideComment);
    }

    return sentences.join('\n');
  }
}

// ============================================
// 导出
// ============================================

const gmCodeEngine = new GMCodeEngine();

// 浏览器全局变量
if (typeof window !== 'undefined') {
  window.gmCodeEngine = gmCodeEngine;
  window.GMCodeEngine = GMCodeEngine;
}

// Node.js 模块导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GMCodeEngine, gmCodeEngine };
}

// ============================================
// EventBus 订阅 - 回滚支持
// ============================================
if (typeof window !== 'undefined' && typeof window.eventBus !== 'undefined' && window.GameEvents) {
  window.eventBus.on(window.GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
    gmCodeEngine.rollbackAfterUID(targetUID);
  });
  console.log('[GMCodeEngine] 已订阅 ROLLBACK_TO_TURN 事件');
}

// 生命周期别名（供 ServiceRegistry 统一调用）
gmCodeEngine.getSaveData = gmCodeEngine.getData.bind(gmCodeEngine);

// 注册到服务中心
ServiceRegistry.register('gmData', gmCodeEngine);
