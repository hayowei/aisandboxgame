// ============================================
// Timeline Service - 时间轴上下文服务
// ============================================
// 根据当前游戏日期，自动筛选 +/-15天 内的历史事件

// 数据来源：timelineStore.getEvents()

class TimelineService {
  constructor() {
    this.currentDate = null; // { year, month, day, hour, minute, timeStr, time_str }
    this.dayRange = 15; // 前后各15天
    // 已触发短信的事件ID(避免重复发送)
    // 格式: { eventId: triggerUID }
    this.triggeredEventIds = {};
    this.lastCheckedDate = null; // 上次检查的日期(用于判断日期是否变化)

    // 角色名 -> 联系人ID 映射表（运行时从 CHARACTER_DATABASE 动态构建）
    this.characterToContactId = {};
    this._contactMapBuilt = false;
  }

  /**
   * 根据当前世界的 CHARACTER_DATABASE 动态构建角色名 → 联系人 ID 映射
   */
  buildContactMap() {
    const db = window.npcStore?.getCharacterDatabase?.();
    if (!db || typeof db !== 'object') {
      this._contactMapBuilt = false;
      return;
    }

    this.characterToContactId = {};
    for (const [id, char] of Object.entries(db)) {
      if (id.startsWith('_') || !char || typeof char !== 'object') continue;
      // 用 name 字段映射到 id（联系人 ID = 角色 ID）
      if (char.name) {
        this.characterToContactId[char.name] = id;
      }
      // 同时用 id 中的名字部分（如 iron_101_Elena → Elena）作为备用
      const parts = id.split('_');
      if (parts.length >= 3) {
        const namePart = parts.slice(2).join('_');
        if (namePart && !this.characterToContactId[namePart]) {
          this.characterToContactId[namePart] = id;
        }
      }
    }
    this._contactMapBuilt = true;
    console.log(
      '[TimelineService] 联系人映射已构建:',
      Object.keys(this.characterToContactId).length,
      '个角色'
    );
  }

  /**
   * 获取当前激活世界的时间线事件
   * custom 模式 strict custom-only：缺失即空数组
   */
  _getTimelineData() {
    if (!window.timelineStore || typeof window.timelineStore.getEvents !== 'function') {
      console.warn('[TimelineService] timelineStore 未加载');
      return [];
    }
    return window.timelineStore.getEvents();
  }

  /**
   * 获取当前主聊天的 UID（用于回滚追踪）
   */
  _getCurrentUID() {
    if (typeof chatHistory !== 'undefined') {
      const lastAi = [...chatHistory].reverse().find(m => m.sender === 'ai');
      return lastAi?.uid || null;
    }
    return null;
  }

  _normalizeClockTimeString(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return '';
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  _getTimeStringFromDate(date) {
    if (!date || typeof date !== 'object') return '';
    if (Number.isFinite(Number.parseInt(date.hour, 10)) && Number.isFinite(Number.parseInt(date.minute, 10))) {
      return this._normalizeClockTimeString(
        `${String(Number.parseInt(date.hour, 10)).padStart(2, '0')}:${String(Number.parseInt(date.minute, 10)).padStart(2, '0')}`
      );
    }
    return this._normalizeClockTimeString(date.timeStr || date.time_str || '');
  }

  _getDefaultClockTime() {
    return '00:00';
  }

  _getEndOfDayClockTime() {
    return '23:59';
  }

  _timeStringToMinutes(value) {
    const normalized = this._normalizeClockTimeString(value);
    if (!normalized) return 0;
    const [hour, minute] = normalized.split(':').map(Number);
    return hour * 60 + minute;
  }

  _minutesToTimeString(totalMinutes) {
    const normalizedMinutes = Math.max(0, Math.min(23 * 60 + 59, Math.floor(totalMinutes || 0)));
    const hour = Math.floor(normalizedMinutes / 60);
    const minute = normalizedMinutes % 60;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  _buildRuntimeDate(year, month, day, timeOrHour = null, minute = null) {
    let normalizedTime = '';
    if (typeof timeOrHour === 'string') {
      normalizedTime = this._normalizeClockTimeString(timeOrHour);
    } else if (Number.isFinite(Number.parseInt(timeOrHour, 10)) && Number.isFinite(Number.parseInt(minute, 10))) {
      normalizedTime = this._normalizeClockTimeString(
        `${String(Number.parseInt(timeOrHour, 10)).padStart(2, '0')}:${String(Number.parseInt(minute, 10)).padStart(2, '0')}`
      );
    }
    normalizedTime = normalizedTime || this._getDefaultClockTime();
    const [hour, normalizedMinute] = normalizedTime.split(':').map(Number);
    return {
      year,
      month,
      day,
      hour,
      minute: normalizedMinute,
      timeStr: normalizedTime,
      time_str: normalizedTime,
    };
  }

  _toAbsoluteMinutes(date, fallbackTime = null) {
    if (!date || typeof date !== 'object') return 0;
    const year = Number.parseInt(date.year, 10);
    const month = Number.parseInt(date.month, 10);
    const day = Number.parseInt(date.day, 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
    const clockTime =
      this._getTimeStringFromDate(date) ||
      this._normalizeClockTimeString(fallbackTime || '') ||
      this._getDefaultClockTime();
    return this.dateToDays({ year, month, day }) * 1440 + this._timeStringToMinutes(clockTime);
  }

  /**
   * 设置当前游戏日期(从 AI 返回的状态栏提取)
   * 只有当 year 和 month 都是有效数字时才设置
   * 支持时间跳跃:会检查从上次日期到当前日期之间所有天的事件
   * @param {number} year - 年份
   * @param {number} month - 月份
   * @param {number} day - 日期(可选，默认1)
   * @param {string} timeStr - 具体时间如 "14:30"(可选，供手机UI使用)
   */
  setCurrentDate(year, month, day = 1, timeOrHour = null, minute = null) {
    let parsedYear = parseInt(year);
    let parsedMonth = parseInt(month);
    if (!Number.isFinite(parsedMonth) || parsedMonth <= 0 || parsedMonth > 12) {
      parsedMonth = 1;
    }
    let parsedDay = parseInt(day);
    if (!Number.isFinite(parsedDay) || parsedDay <= 0 || parsedDay > 30) {
      parsedDay = 1;
    }

    // 保险机制:如果无法提取有效年份，不设置
    if (isNaN(parsedYear) || parsedYear <= 0) {
      console.log('[TimelineService] 无效日期，跳过设置:', { year, month, day });
      return;
    }

    const newDate = this._buildRuntimeDate(parsedYear, parsedMonth, parsedDay, timeOrHour, minute);

    // 保存旧日期用于时间跳跃检测
    const oldDate = this.lastCheckedDate ? { ...this.lastCheckedDate } : null;

    // 检查日期是否变化
    const dateChanged = !oldDate || this.compareDates(oldDate, newDate, 'day') !== 0;

    this.currentDate = newDate;
    console.log('[TimelineService] 当前日期设置为:', this.currentDate);

    // 如果日期变化，检查并触发事件短信
    if (dateChanged) {
      this.lastCheckedDate = { ...newDate };
      // 传入旧日期，以便检查时间跳跃期间的所有事件
      this.checkAndTriggerEventSMS(oldDate);
    }
  }

  /**
   * 手动编辑设置当前日期（使用指定的 previousTurnDate 作为跳跃起点）
   * 与 setCurrentDate 的区别：不使用内部的 lastCheckedDate，而是使用传入的 previousTurnDate
   * @param {number} year - 年份
   * @param {number} month - 月份
   * @param {number} day - 日期
   * @param {string} timeStr - 具体时间如 "14:30"
   * @param {Object|null} previousTurnDate - 上一个 Turn 的日期，用于时间跳跃检查
   * @param {boolean} skipSideEffects - 是否跳过副作用（开局 Turn 1 时为 true）
   */
  setCurrentDateManual(year, month, day, timeOrHour, minute, previousTurnDate, skipSideEffects = false) {
    let parsedYear = parseInt(year);
    let parsedMonth = parseInt(month);
    if (!Number.isFinite(parsedMonth) || parsedMonth <= 0 || parsedMonth > 12) {
      parsedMonth = 1;
    }
    let parsedDay = parseInt(day);
    if (!Number.isFinite(parsedDay) || parsedDay <= 0 || parsedDay > 30) {
      parsedDay = 1;
    }

    // 保险机制:如果无法提取有效年份，不设置
    if (isNaN(parsedYear) || parsedYear <= 0) {
      console.log('[TimelineService] 手动编辑无效日期，跳过设置:', { year, month, day });
      return;
    }

    const newDate = this._buildRuntimeDate(parsedYear, parsedMonth, parsedDay, timeOrHour, minute);

    this.currentDate = newDate;
    this.lastCheckedDate = { ...newDate };
    console.log('[TimelineService] 手动编辑日期设置为:', this.currentDate);

    // 如果需要触发副作用，使用 previousTurnDate 作为跳跃起点
    if (!skipSideEffects && previousTurnDate) {
      // 检查日期是否变化
      const dateChanged = this.compareDates(previousTurnDate, newDate, 'day') !== 0;

      if (dateChanged) {
        console.log(
          '[TimelineService] 手动编辑触发时间跳跃检查，从:',
          previousTurnDate,
          '到:',
          newDate
        );
        this.checkAndTriggerEventSMS(previousTurnDate);
      }
    }
  }

  /**
   * 获取当前日期
   */
  getCurrentDate() {
    return this.currentDate;
  }

  addMinutesToDate(date, deltaMinutes = 0) {
    if (!date || typeof date !== 'object') return null;
    const parsedDelta = Number.parseInt(deltaMinutes, 10);
    if (!Number.isFinite(parsedDelta)) return this._buildRuntimeDate(date.year, date.month, date.day, date.hour, date.minute);
    const baseMinutes = this._toAbsoluteMinutes(date, this._getDefaultClockTime());
    const nextAbsoluteMinutes = baseMinutes + parsedDelta;
    const nextDayValue = Math.floor(nextAbsoluteMinutes / 1440);
    const clockMinutes = ((nextAbsoluteMinutes % 1440) + 1440) % 1440;
    const nextDate = this.daysToDate(nextDayValue);
    const clockText = this._minutesToTimeString(clockMinutes);
    return this._buildRuntimeDate(nextDate.year, nextDate.month, nextDate.day, clockText);
  }

  /**
   * 解析时间轴中的时间字符串
   * 支持格式: "星历1042.06", "星历1042.06.15", "星历1042.06.15 14:30",
   *          "Pre-星历约070", "Pre-星历约070.01.01 00:00"
   * @returns { year, month, day, time_str? } 或 null
   */
  parseTimeString(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const source = timeStr.trim();
    if (!source) return null;

    const fullMatch = source.match(
      /^(?<prefix>(?:Pre-|前)?[^\d]*?(?:约|c\.?)?)?(?<year>\d+)(?:[\.。](?<month>\d+))?(?:[\.。](?<day>\d+))?(?:\s+(?<clock>\d{2}:\d{2}))?\s*$/i
    );
    if (fullMatch?.groups?.year) {
      const year = Number.parseInt(fullMatch.groups.year, 10);
      const month = fullMatch.groups.month ? Number.parseInt(fullMatch.groups.month, 10) : 1;
      const day = fullMatch.groups.day ? Number.parseInt(fullMatch.groups.day, 10) : 1;
      const normalizedClock = this._normalizeClockTimeString(fullMatch.groups.clock || '');
      const isPre = /^(?:Pre-|前)/i.test(fullMatch.groups.prefix || '');
      const parsed = {
        year: isPre ? -year : year,
        month,
        day,
      };
      if (normalizedClock) {
        parsed.time_str = normalizedClock;
      }
      return parsed;
    }

    return null;
  }

  /**
   * 将日期转换为天数(用于比较)
   * 假设每年12个月，每月30天
   */
  dateToDays(date) {
    if (!date) return 0;
    // 使用 0-based day 避免 day=30 时月份偏移问题
    return date.year * 360 + (date.month - 1) * 30 + (date.day - 1);
  }

  /**
   * 将天数转换回日期对象
   * @param {number} days - 天数
   * @returns {object} { year, month, day }
   */
  daysToDate(days) {
    const year = Math.floor(days / 360);
    const remainingDays = days - year * 360;
    const month = Math.floor(remainingDays / 30) + 1;
    // 使用 0-based 计算后 +1，与 dateToDays 互逆
    const day = (remainingDays % 30) + 1;
    return { year, month, day };
  }

  /**
   * 解析 day 字段获取日期数字
   * 支持格式: "15日", "01日"
   */
  parseDayField(dayStr) {
    if (dayStr == null || dayStr === '无日期' || /^No exact day$/i.test(String(dayStr))) return null;
    if (typeof dayStr === 'number') return Number.isFinite(dayStr) ? dayStr : null;
    const match = dayStr.match(/(\d+)日|Day\s*(\d+)/i);
    return match ? parseInt(match[1] || match[2], 10) : null;
  }

  getDefaultTimeSegments() {
    return [];
  }

  _normalizeTimePrecision(precision) {
    if (typeof precision !== 'string') return 'time';
    const normalized = precision.trim().toLowerCase();
    return ['year', 'month', 'day', 'time'].includes(normalized) ? normalized : 'time';
  }

  _normalizeTimeSegments(segments) {
    const source = Array.isArray(segments) ? segments : [];
    const normalized = [];
    const seen = new Set();
    for (const raw of source) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      normalized.push(text);
    }
    return normalized;
  }

  _getSnapshotTimeGroup(snapshot) {
    const groups = snapshot?.step3_fields?.panel_status;
    if (!Array.isArray(groups)) return null;
    return (
      groups.find(group => group && (group._template === 'time' || group.key === 'datetime')) ||
      null
    );
  }

  _getTimeConfigFromSnapshot(snapshot) {
    const timeGroup = this._getSnapshotTimeGroup(snapshot);
    const precision = this._normalizeTimePrecision(timeGroup?._precision);
    const timeSegments = this._normalizeTimeSegments(timeGroup?._time_segments);
    return {
      precision,
      timeSegments,
    };
  }

  getTimeConfigFromSnapshot(snapshot) {
    return this._getTimeConfigFromSnapshot(snapshot);
  }

  normalizeDateForPrecision(date, precision = 'time', timeSegments = null) {
    if (!date || typeof date !== 'object') return null;
    const normalizedPrecision = this._normalizeTimePrecision(precision);
    const year = Number.parseInt(date.year, 10);
    if (!Number.isFinite(year) || year === 0) return null;
    const month = Number.parseInt(date.month, 10);
    const day = Number.parseInt(date.day, 10);
    const normalized = { year };

    if (['month', 'day', 'time'].includes(normalizedPrecision)) {
      normalized.month = Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1;
    }
    if (['day', 'time'].includes(normalizedPrecision)) {
      normalized.day = Number.isFinite(day) && day >= 1 && day <= 30 ? day : 1;
    }
    if (normalizedPrecision === 'time') {
      normalized.time_str =
        this._getTimeStringFromDate(date) || this._normalizeClockTimeString(date?.time_str || '');
      if (!normalized.time_str) {
        normalized.time_str = this._getDefaultClockTime();
      }
    }
    return normalized;
  }

  compareDates(dateA, dateB, precision = 'time', timeSegments = null) {
    const normalizedPrecision = this._normalizeTimePrecision(precision);
    const normalizedA = this.normalizeDateForPrecision(dateA, normalizedPrecision, timeSegments);
    const normalizedB = this.normalizeDateForPrecision(dateB, normalizedPrecision, timeSegments);
    if (!normalizedA && !normalizedB) return 0;
    if (!normalizedA) return -1;
    if (!normalizedB) return 1;

    if (normalizedPrecision === 'year') {
      return normalizedA.year - normalizedB.year;
    }
    if (normalizedPrecision === 'month') {
      return (
        normalizedA.year * 12 + normalizedA.month - (normalizedB.year * 12 + normalizedB.month)
      );
    }

    const dayDiff =
      this.dateToDays({
        year: normalizedA.year,
        month: normalizedA.month,
        day: normalizedA.day,
      }) -
      this.dateToDays({
        year: normalizedB.year,
        month: normalizedB.month,
        day: normalizedB.day,
      });
    if (dayDiff !== 0 || normalizedPrecision !== 'time') return dayDiff;

    return (
      this._timeStringToMinutes(normalizedA.time_str) -
      this._timeStringToMinutes(normalizedB.time_str)
    );
  }

  _isOpeningEventDayUsable(event) {
    const dayText = typeof event?.day === 'string' ? event.day.trim() : '';
    return dayText !== '无日期';
  }

  _isOpeningLocationTooBroad(locationStr) {
    if (typeof locationStr !== 'string') return false;
    const normalized = locationStr.replace(/\s+/g, '');
    if (!normalized) return true;
    return /^(?:全空间站|全城|全国|全境|全域|全大陆|全世界|全区域|整个空间站|整个城市|整个大陆|整个世界)/.test(
      normalized
    );
  }

  isOpeningEventLocationUsable(locationStr) {
    if (typeof locationStr !== 'string') return false;
    const trimmed = locationStr.trim();
    if (!trimmed) return false;
    if (/(未知|不详)/.test(trimmed)) return false;
    if (this._isOpeningLocationTooBroad(trimmed)) return false;
    const parsed = this.buildOpeningLocationFromEventLocation(trimmed);
    return Boolean(parsed.country || parsed.site || parsed.spot);
  }

  buildOpeningLocationFromEventLocation(locationStr) {
    if (typeof locationStr !== 'string') {
      return { country: '', site: '', spot: '' };
    }
    const eStore = typeof window !== 'undefined' ? window.entityStore : null;
    const toDisplayName = value => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      return typeof eStore?.resolveDisplayName === 'function'
        ? eStore.resolveDisplayName(trimmed) || trimmed
        : trimmed;
    };
    const parts = locationStr
      .split(/\s*(?:-|—|·|\/)\s*/)
      .map(part => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return { country: '', site: '', spot: '' };
    }
    if (parts.length === 1) {
      return { country: toDisplayName(parts[0]), site: '', spot: '' };
    }
    if (parts.length === 2) {
      return { country: toDisplayName(parts[0]), site: toDisplayName(parts[1]), spot: '' };
    }
    return {
      country: toDisplayName(parts[0]),
      site: toDisplayName(parts[1]),
      spot: toDisplayName(parts[2]),
    };
  }

  getAvailableCharacterCandidatesAtDate(snapshot, targetDate) {
    const config = this._getTimeConfigFromSnapshot(snapshot);
    const precision = config.precision;
    const timeSegments = config.timeSegments;
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const candidates = [];

    for (const [characterId, character] of Object.entries(characterDatabase)) {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') continue;
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      if (!name) continue;

      const birthday = this._parseBirthdayDate(character.birthday);
      if (birthday && this.compareDates(targetDate, birthday, precision, timeSegments) < 0) {
        continue;
      }

      candidates.push({
        id:
          typeof character.id === 'string' && character.id.trim()
            ? character.id.trim()
            : characterId,
        name,
        hasPriorityProfile: Boolean(
          (typeof character.msg_reply_tone === 'string' && character.msg_reply_tone.trim()) ||
          (typeof character.default_cognitive_state === 'string' &&
            character.default_cognitive_state.trim())
        ),
      });
    }

    candidates.sort((a, b) => {
      if (a.hasPriorityProfile !== b.hasPriorityProfile) {
        return a.hasPriorityProfile ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'zh-Hans-CN');
    });
    return candidates;
  }

  getOpeningEventCandidates(snapshot) {
    const config = this._getTimeConfigFromSnapshot(snapshot);
    const precision = config.precision;
    const timeSegments = config.timeSegments;
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const timelineEvents = Array.isArray(snapshot?.timeline?.events)
      ? snapshot.timeline.events
      : [];
    const birthdays = this._buildBirthdayMaps(characterDatabase);
    const candidates = [];

    timelineEvents.forEach((event, index) => {
      if (!event || typeof event !== 'object') return;
      if (!this._isOpeningEventDayUsable(event)) return;
      if (typeof event.content !== 'string' || !event.content.trim()) return;

      const eventDate = this._parseSnapshotEventDate(event);
      if (!eventDate || eventDate.year <= 0) return;
      if (
        this._eventViolatesBirthday(event, eventDate, birthdays.byName, precision, timeSegments)
      ) {
        return;
      }
      if (!this.isOpeningEventLocationUsable(event.location)) return;

      const normalizedDate = this.normalizeDateForPrecision(eventDate, precision, timeSegments);
      if (!normalizedDate) return;

      const availableNpcCandidates = this.getAvailableCharacterCandidatesAtDate(
        snapshot,
        normalizedDate
      );
      if (availableNpcCandidates.length === 0) return;

      const preferredNames = new Set(this._splitEventCharacters(event.characters));
      const preferredNpcCandidates = availableNpcCandidates.filter(candidate =>
        preferredNames.has(candidate.name)
      );

      candidates.push({
        event,
        eventIndex: index,
        eventId: this.getEventId(event),
        eventDate: normalizedDate,
        location: this.buildOpeningLocationFromEventLocation(event.location),
        availableNpcCandidates,
        preferredNpcCandidates,
      });
    });

    candidates.sort((a, b) => {
      const diff = this.compareDates(a.eventDate, b.eventDate, precision, timeSegments);
      if (diff !== 0) return diff;
      return a.eventIndex - b.eventIndex;
    });
    return candidates;
  }

  _splitEventCharacters(characters) {
    if (typeof characters !== 'string') return [];
    return characters
      .split(/\s*\/\s*|\s*,\s*|\s+/)
      .map(name => name.trim())
      .filter(Boolean);
  }

  _parseBirthdayDate(birthday) {
    return this.parseTimeString(birthday);
  }

  _parseTimelineNodeDate(node) {
    if (!node || typeof node !== 'object') return null;
    const year = Number.parseInt(node.year, 10);
    if (!Number.isFinite(year) || year === 0) return null;
    return {
      year,
      month: Number.parseInt(node.month, 10) || 1,
      day: Number.parseInt(node.day, 10) || 1,
      time_str: this._getTimeStringFromDate(node) || this._normalizeClockTimeString(node?.time_str || ''),
    };
  }

  _parseSnapshotEventDate(event) {
    if (!event || typeof event !== 'object') return null;
    const baseDate = this.parseTimeString(event.time);
    if (!baseDate) return null;
    const parsedDay = this.parseDayField(event.day);
    if (!Number.isFinite(parsedDay) || parsedDay < 1 || parsedDay > 30) return null;
    return {
      ...baseDate,
      day: parsedDay,
      time_str:
        this._getTimeStringFromDate(event) ||
        this._normalizeClockTimeString(baseDate.time_str || '') ||
        this._getDefaultClockTime(),
    };
  }

  _buildBirthdayMaps(characterDatabase = {}) {
    const byId = new Map();
    const byName = new Map();
    for (const [characterId, character] of Object.entries(characterDatabase)) {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') continue;
      const birthday = this._parseBirthdayDate(character.birthday);
      if (!birthday) continue;
      byId.set(characterId, birthday);
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      if (name) byName.set(name, birthday);
    }
    return { byId, byName };
  }

  _eventViolatesBirthday(event, eventDate, birthdayByName, precision, timeSegments) {
    const names = this._splitEventCharacters(event?.characters);
    if (names.length === 0) return false;
    return names.some(name => {
      const birthday = birthdayByName.get(name);
      return birthday && this.compareDates(eventDate, birthday, precision, timeSegments) < 0;
    });
  }

  _collectCoreTimeConsistencyErrors(snapshot, precision, timeSegments) {
    const errors = [];
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const timelineEvents = Array.isArray(snapshot?.timeline?.events)
      ? snapshot.timeline.events
      : [];
    const characterTimelines =
      snapshot?.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    const birthdays = this._buildBirthdayMaps(characterDatabase);

    timelineEvents.forEach((event, index) => {
      const eventDate = this._parseSnapshotEventDate(event);
      if (!eventDate || eventDate.year <= 0) return;
      const names = this._splitEventCharacters(event?.characters);
      names.forEach(name => {
        const birthday = birthdays.byName.get(name);
        if (birthday && this.compareDates(eventDate, birthday, precision, timeSegments) < 0) {
          errors.push(`timeline.events[${index}] 角色「${name}」早于生日出场`);
        }
      });
    });

    for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
      if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
        continue;
      const birthday = birthdays.byId.get(characterId) || null;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : [];
        let previousDate = null;
        entries.forEach((entry, index) => {
          const entryDate = this._parseTimelineNodeDate(entry);
          if (!entryDate || entryDate.year <= 0) return;
          if (birthday && this.compareDates(entryDate, birthday, precision, timeSegments) < 0) {
            errors.push(`character_timelines.${characterId}.${section}[${index}] 早于生日`);
          }
          if (
            previousDate &&
            this.compareDates(entryDate, previousDate, precision, timeSegments) < 0
          ) {
            errors.push(`character_timelines.${characterId}.${section} 未按时间升序`);
          }
          previousDate = entryDate;
        });
      }
    }

    return errors;
  }

  buildRandomOpeningTimeRange(snapshot) {
    const config = this._getTimeConfigFromSnapshot(snapshot);
    const precision = config.precision;
    const timeSegments = config.timeSegments;
    const coreErrors = this._collectCoreTimeConsistencyErrors(snapshot, precision, timeSegments);
    if (coreErrors.length > 0) {
      return {
        ok: false,
        precision,
        timeSegments,
        errors: coreErrors,
        time_range: null,
        source: 'invalid_snapshot',
      };
    }
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const timelineEvents = Array.isArray(snapshot?.timeline?.events)
      ? snapshot.timeline.events
      : [];
    const characterTimelines =
      snapshot?.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    const birthdays = this._buildBirthdayMaps(characterDatabase);

    const validEventCandidates = [];
    for (const event of timelineEvents) {
      const eventDate = this._parseSnapshotEventDate(event);
      if (!eventDate || eventDate.year <= 0) continue;
      if (
        this._eventViolatesBirthday(event, eventDate, birthdays.byName, precision, timeSegments)
      ) {
        continue;
      }
      validEventCandidates.push({ kind: 'timeline_event', date: eventDate, source: event });
    }
    validEventCandidates.sort((a, b) => this.compareDates(a.date, b.date, precision, timeSegments));

    const baseEventCandidates = validEventCandidates.slice(-3);
    let candidateDates = baseEventCandidates.map(item => item.date);
    let source = baseEventCandidates.length > 0 ? 'timeline_events' : 'none';

    if (baseEventCandidates.length > 0) {
      const baseStart = baseEventCandidates[0].date;
      const baseEnd = baseEventCandidates[baseEventCandidates.length - 1].date;
      for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
        if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
          continue;
        const birthday = birthdays.byId.get(characterId) || null;
        for (const section of ['cognitive', 'relationships', 'status']) {
          const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : [];
          for (const entry of entries) {
            const entryDate = this._parseTimelineNodeDate(entry);
            if (!entryDate || entryDate.year <= 0) continue;
            if (birthday && this.compareDates(entryDate, birthday, precision, timeSegments) < 0)
              continue;
            if (this.compareDates(entryDate, baseStart, precision, timeSegments) < 0) continue;
            if (this.compareDates(entryDate, baseEnd, precision, timeSegments) > 0) continue;
            candidateDates.push(entryDate);
          }
        }
      }
    } else {
      const fallbackDates = [];
      for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
        if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
          continue;
        const birthday = birthdays.byId.get(characterId) || null;
        for (const section of ['cognitive', 'relationships', 'status']) {
          const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : [];
          for (const entry of entries) {
            const entryDate = this._parseTimelineNodeDate(entry);
            if (!entryDate || entryDate.year <= 0) continue;
            if (birthday && this.compareDates(entryDate, birthday, precision, timeSegments) < 0)
              continue;
            fallbackDates.push(entryDate);
          }
        }
      }
      fallbackDates.sort((a, b) => this.compareDates(a, b, precision, timeSegments));
      if (fallbackDates.length > 0) {
        candidateDates = fallbackDates.slice(-3);
        source = 'character_timelines';
      } else {
        const birthdayDates = [...birthdays.byId.values()]
          .filter(date => date && date.year > 0)
          .sort((a, b) => this.compareDates(a, b, precision, timeSegments));
        if (birthdayDates.length > 0) {
          candidateDates = birthdayDates.slice(-3);
          source = 'birthdays';
        }
      }
    }

    const birthdayDates = [...birthdays.byId.values()]
      .filter(date => date && date.year > 0)
      .sort((a, b) => this.compareDates(a, b, precision, timeSegments));
    if (candidateDates.length > 0 && birthdayDates.length > 0) {
      const latestCandidate = candidateDates
        .slice()
        .sort((a, b) => this.compareDates(a, b, precision, timeSegments))
        .slice(-1)[0];
      const hasEligibleCharacter = birthdayDates.some(
        birthday => this.compareDates(birthday, latestCandidate, precision, timeSegments) <= 0
      );
      if (!hasEligibleCharacter) {
        candidateDates = birthdayDates.slice(-3);
        source = 'birthdays';
      }
    }

    if (candidateDates.length === 0) {
      return {
        ok: false,
        precision,
        timeSegments,
        errors: ['无法从当前世界卡推导随机开局时间范围'],
        time_range: null,
        source: 'missing',
      };
    }

    candidateDates.sort((a, b) => this.compareDates(a, b, precision, timeSegments));
    const start = this.normalizeDateForPrecision(candidateDates[0], precision, timeSegments);
    const endBase = this.normalizeDateForPrecision(
      candidateDates[candidateDates.length - 1],
      precision,
      timeSegments
    );
    const end =
      precision === 'time'
        ? {
            ...endBase,
            time_str: endBase?.time_str || this._getEndOfDayClockTime(),
          }
        : endBase;

    return {
      ok: true,
      precision,
      timeSegments,
      time_range: { start, end },
      source,
    };
  }

  pickOpeningTime(rangeInfo, strategy = 'random') {
    const precision = this._normalizeTimePrecision(rangeInfo?.precision);
    const timeSegments = this._normalizeTimeSegments(rangeInfo?.timeSegments);
    const range = rangeInfo?.time_range;
    const start = this.normalizeDateForPrecision(range?.start, precision, timeSegments);
    const end = this.normalizeDateForPrecision(range?.end, precision, timeSegments);
    if (!start || !end) return null;
    if (this.compareDates(start, end, precision, timeSegments) > 0) return null;

    if (strategy === 'recommended') {
      return this.normalizeDateForPrecision(end, precision, timeSegments);
    }

    if (precision === 'year') {
      const minYear = Math.min(start.year, end.year);
      const maxYear = Math.max(start.year, end.year);
      return { year: minYear + Math.floor(Math.random() * (maxYear - minYear + 1)) };
    }

    if (precision === 'month') {
      const minMonthValue = start.year * 12 + (start.month - 1);
      const maxMonthValue = end.year * 12 + (end.month - 1);
      const pickedValue =
        minMonthValue + Math.floor(Math.random() * (maxMonthValue - minMonthValue + 1));
      return {
        year: Math.floor(pickedValue / 12),
        month: (pickedValue % 12) + 1,
      };
    }

    const minDayValue = this.dateToDays({
      year: start.year,
      month: start.month,
      day: start.day,
    });
    const maxDayValue = this.dateToDays({
      year: end.year,
      month: end.month,
      day: end.day,
    });
    const pickedDayValue =
      minDayValue + Math.floor(Math.random() * (maxDayValue - minDayValue + 1));
    const pickedDate = this.daysToDate(pickedDayValue);

    if (precision === 'day') {
      return pickedDate;
    }

    const minMinute = this._toAbsoluteMinutes(start, this._getDefaultClockTime());
    const maxMinute = this._toAbsoluteMinutes(end, this._getEndOfDayClockTime());
    const pickedMinute =
      minMinute + Math.floor(Math.random() * Math.max(1, maxMinute - minMinute + 1));
    const pickedDayIndex = Math.floor(pickedMinute / 1440);
    const timeOfDay = pickedMinute % 1440;
    return {
      ...this.daysToDate(pickedDayIndex),
      time_str: this._minutesToTimeString(timeOfDay),
    };
  }

  /**
   * 获取 +/-15天 范围内的事件
   */
  getRelevantEvents() {
    if (!this.currentDate) {
      console.log('[TimelineService] 未设置当前日期，跳过时间轴注入');
      return [];
    }

    const timelineData = this._getTimelineData();
    if (!timelineData.length) {
      console.warn('[TimelineService] timeline 数据为空');
      return [];
    }

    const currentMinutes = this._toAbsoluteMinutes(this.currentDate, this._getDefaultClockTime());
    const minMinutes = currentMinutes - this.dayRange * 1440;
    const maxMinutes = currentMinutes + this.dayRange * 1440;

    const events = timelineData.filter(event => {
      const eventDate = this._parseSnapshotEventDate(event);
      if (!eventDate) return false;
      const eventMinutes = this._toAbsoluteMinutes(eventDate, this._getDefaultClockTime());
      return eventMinutes >= minMinutes && eventMinutes <= maxMinutes;
    });

    this.sortEventsByDate(events);

    console.log(`[TimelineService] 找到 ${events.length} 个相关事件 (范围: +/-${this.dayRange}天)`);
    return events;
  }

  /**
   * 原地按事件 time/day/time_str 字段升序排序；无可解析日期的事件放到末尾。
   * @param {Array} events
   * @returns {Array} 同一数组引用，便于链式调用
   */
  sortEventsByDate(events) {
    if (!Array.isArray(events) || events.length < 2) return events;
    events.sort((a, b) => {
      const dateA = this._parseSnapshotEventDate(a);
      const dateB = this._parseSnapshotEventDate(b);
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return this.compareDates(dateA, dateB, 'time');
    });
    return events;
  }

  /**
   * 格式化事件为注入文本
   */
  formatForInjection() {
    const events = this.getRelevantEvents();
    if (events.length === 0) return '';

    let text = '\n\n# 历史事件参考(当前时间附近 +/-15天)\n\n';
    text += '以下是玩家当前游戏时间附近发生的历史事件，可作为叙事参考:\n\n';

    for (const event of events) {
      const timeText = this._getTimeStringFromDate(event);
      const dateStr =
        event.day !== '无日期'
          ? `${event.time} ${event.day}${timeText ? ` ${timeText}` : ''}`
          : `${event.time}${timeText ? ` ${timeText}` : ''}`;
      const locationName =
        typeof gmCodeEngine !== 'undefined' && gmCodeEngine._resolveLocationDisplayName
          ? gmCodeEngine._resolveLocationDisplayName(event.location)
          : event.location;
      text += `**${dateStr}** - ${locationName}\n`;
      text += `角色: ${event.characters}\n`;
      text += `${event.content}\n\n`;
    }

    return text;
  }

  /**
   * 清除当前日期(重置状态)
   */
  clear() {
    this.currentDate = null;
    this.triggeredEventIds = {};
    this.lastCheckedDate = null;
    this.characterToContactId = {};
    this._contactMapBuilt = false;
  }

  /**
   * 清除已触发事件记录(用于调试/测试)
   * 可在控制台调用: timelineService.clearTriggeredEvents()
   */
  clearTriggeredEvents() {
    const count = Object.keys(this.triggeredEventIds).length;
    this.triggeredEventIds = {};
    this._contactMapBuilt = false; // 切换世界时需重建联系人映射
    console.log(`[TimelineService] 已清除 ${count} 个已触发事件记录`);
  }

  /**
   * 手动触发事件检查(用于调试/测试)
   * 可在控制台调用: timelineService.debugTriggerEvents()
   */
  debugTriggerEvents() {
    console.log('[TimelineService] === 调试信息 ===');
    console.log('当前日期:', this.currentDate);
    console.log('上次检查日期:', this.lastCheckedDate);
    console.log('已触发事件数:', Object.keys(this.triggeredEventIds).length);

    if (this.currentDate) {
      const todayEvents = this.getEventsForToday();
      console.log('今日事件数:', todayEvents.length);
      todayEvents.forEach((e, i) => {
        const id = this.getEventId(e);
        const triggered = id in this.triggeredEventIds;
        const contacts = this.getContactsFromEvent(e);
        console.log(
          `  ${i + 1}. [${triggered ? '已触发' : '未触发'}] ${e.characters}: ${e.content.substring(0, 40)}...`
        );
        console.log(`     可发短信角色: ${contacts.map(c => c.name).join(', ') || '无'}`);
      });
    }
    console.log('[TimelineService] === 调试结束 ===');
  }

  // ============================================
  // 事件驱动短信系统
  // ============================================

  /**
   * 生成事件的唯一ID(用于去重)
   * @param {object} event - 时间轴事件
   * @returns {string} 事件唯一ID
   */
  getEventId(event) {
    return `${event.time}_${event.day}_${event.time_str || event.timeStr || ''}_${event.characters}_${(event.content || '').substring(0, 30)}`;
  }

  /**
   * 获取当天发生的具体事件(只匹配有明确日期的事件)
   * @returns {Array} 当天的事件数组
   */
  getEventsForToday() {
    return this.getEventsInRange(this.currentDate, this.currentDate);
  }

  /**
   * 获取指定日期范围内的事件(支持时间跳跃)
   * @param {object} fromDate - 起始日期 { year, month, day }
   * @param {object} toDate - 结束日期 { year, month, day }
   * @returns {Array} 范围内的事件数组(按时间排序)
   */
  getEventsInRange(fromDate, toDate) {
    if (!fromDate || !toDate) {
      return [];
    }

    const timelineData = this._getTimelineData();
    if (!timelineData.length) {
      return [];
    }

    const normalizedFrom = this.normalizeDateForPrecision(fromDate, 'time');
    const normalizedTo = this.normalizeDateForPrecision(toDate, 'time');
    if (!normalizedFrom || !normalizedTo) return [];

    const events = timelineData.filter(event => {
      // 必须有具体日期(排除"无日期"的事件)
      if (!event.day || event.day === '无日期') {
        return false;
      }

      const eventDate = this._parseSnapshotEventDate(event);
      if (!eventDate) return false;
      return (
        this.compareDates(eventDate, normalizedFrom, 'time') >= 0 &&
        this.compareDates(eventDate, normalizedTo, 'time') <= 0
      );
    });

    // 按时间排序
    events.sort((a, b) => {
      const dateA = this._parseSnapshotEventDate(a);
      const dateB = this._parseSnapshotEventDate(b);
      if (!dateA || !dateB) return 0;
      return this.compareDates(dateA, dateB, 'time');
    });

    return events;
  }

  /**
   * 从事件中提取可发送短信的角色
   * 只返回在联系人列表中存在的角色
   * @param {object} event - 时间轴事件
   * @returns {Array} 可发送短信的角色列表 [{name, contactId}]
   */
  getContactsFromEvent(event) {
    if (!event.characters) return [];

    // 延迟构建联系人映射（首次使用时从 CHARACTER_DATABASE 构建）
    if (!this._contactMapBuilt) {
      this.buildContactMap();
    }

    const contacts = [];
    const characterNames = event.characters.split(/\s*\/\s*|\s*,\s*|\s+/);

    for (const name of characterNames) {
      const trimmedName = name.trim();
      const contactId = this.characterToContactId[trimmedName];
      if (contactId) {
        contacts.push({ name: trimmedName, contactId });
      }
    }

    return contacts;
  }

  /**
   * 检查事件并触发短信
   * 支持时间跳跃:检查从 oldDate 到 currentDate 之间所有天的事件
   * @param {object|null} oldDate - 上次的日期(如果是首次设置则为 null)
   */
  async checkAndTriggerEventSMS(oldDate = null) {
    if (!this.currentDate) {
      return;
    }

    // 计算需要检查的日期范围
    let fromDate, toDate;

    if (!oldDate) {
      // 首次设置日期，只检查当天
      fromDate = this.currentDate;
      toDate = this.currentDate;
      console.log('[TimelineService] 首次设置日期，检查当天事件');
    } else {
      // 时间跳跃，检查从上次日期的下一天到当前日期
      // 注意:上次日期的事件已经检查过了，所以从下一天开始
      const compareResult = this.compareDates(oldDate, this.currentDate, 'time');
      if (compareResult >= 0) {
        // 时间没有前进(可能是回退或同一天)，跳过
        console.log('[TimelineService] 时间未前进，跳过事件检查');
        return;
      }

      fromDate = this.normalizeDateForPrecision(oldDate, 'time');
      toDate = this.normalizeDateForPrecision(this.currentDate, 'time');

      const oldDays = this.dateToDays(oldDate);
      const newDays = this.dateToDays(this.currentDate);
      const daysDiff = Math.max(0, newDays - oldDays);
      if (daysDiff > 1) {
        console.log(`[TimelineService] 检测到时间跳跃: ${daysDiff} 天，检查期间所有事件`);
      }
    }

    // 获取范围内的事件
    const events = this.getEventsInRange(fromDate, toDate);

    if (events.length === 0) {
      console.log('[TimelineService] 该时间段无事件');
      return;
    }

    console.log(`[TimelineService] 找到 ${events.length} 个事件需要检查`);

    for (const event of events) {
      const eventId = this.getEventId(event);

      // 跳过已触发的事件
      if (eventId in this.triggeredEventIds) {
        continue;
      }

      // 标记为已触发，记录当前 UID
      const currentUID = this._getCurrentUID();
      this.triggeredEventIds[eventId] = currentUID;

      // 获取可发送短信的角色
      const contacts = this.getContactsFromEvent(event);
      if (contacts.length === 0) {
        console.log(`[TimelineService] 事件无可发短信的角色:`, event.content.substring(0, 50));
        continue;
      }

      // 所有在联系人列表内的角色都发送短信
      console.log(
        `[TimelineService] 触发事件短信: ${contacts.map(c => c.name).join(', ')} -> 玩家`
      );

      // 依次发送短信，每个角色之间加随机延迟(更自然)
      this._sendEventSMSWithDelay(contacts, event);
    }
  }

  /**
   * 依次发送多个角色的事件短信(带随机延迟)
   * @param {Array} contacts - 联系人列表 [{name, contactId}]
   * @param {object} event - 触发的事件
   */
  async _sendEventSMSWithDelay(contacts, event) {
    for (let i = 0; i < contacts.length; i++) {
      const sender = contacts[i];

      // 第一个角色立即发送，后续角色加随机延迟(2-5秒)
      if (i > 0) {
        const delay = 2000 + Math.random() * 3000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        await this.sendEventSMS(sender.contactId, event);
      } catch (err) {
        console.error(`[TimelineService] 事件短信发送失败 (${sender.name}):`, err);
        // 继续发送下一个角色的短信
      }
    }
  }

  /**
   * 发送事件驱动的短信(双模式系统)
   * 模式 A:玩家从未给该角色发过短信 -> 发送[系统提示]
   * 模式 B:玩家曾给该角色发过短信 -> 角色本人口吻发送，基于聊天记录
   * @param {string} contactId - 联系人ID
   * @param {object} event - 触发的事件
   */
  async sendEventSMS(contactId, event) {
    // 检查依赖服务是否可用
    if (typeof smsService === 'undefined') {
      console.warn('[TimelineService] SMS服务不可用，跳过事件短信');
      return;
    }

    try {
      // 从事件中提取实际日期
      const eventDate = this._parseSnapshotEventDate(event);

      // 构建事件发生时的游戏时间
      const eventGameTime = eventDate
        ? this._buildRuntimeDate(
            eventDate.year,
            eventDate.month,
            eventDate.day,
            eventDate.time_str || this._getDefaultClockTime()
          )
        : null;

      // 获取联系人信息
      const contact = getContactInfo(contactId);
      const characterName = contact?.name || contactId;

      // ========== 双模式判断 ==========
      const hasPlayerContact = smsService.hasPlayerSentMessage(contactId);

      if (!hasPlayerContact) {
        // ========== 模式 A:系统提示 ==========
        // 玩家从未与该角色联系过，发送系统通知
        let dateStr = '未知时间';
        if (event?.time) {
          const timeText = this._getTimeStringFromDate(event);
          dateStr =
            event.day && event.day !== '无日期'
              ? `${event.time} ${event.day}${timeText ? ` ${timeText}` : ''}`
              : `${event.time}${timeText ? ` ${timeText}` : ''}`;
        } else if (eventDate) {
          const terms = window.worldMeta?.getActiveTimeTerms?.();
          const era = terms?.era || '';
          const labels = terms?.labels || { year: '年', month: '月', day: '日' };
          dateStr = `${era}${eventDate.year}${labels.year || '年'}${eventDate.month}${labels.month || '月'}${eventDate.day}${labels.day || '日'} ${eventDate.time_str || this._getDefaultClockTime()}`;
        }

        const systemMessage = window.promptRegistry
          .get('sms.format.timelineSystemNotification')
          .builder({ dateStr, characterName, eventContent: event.content });

        await smsService.receiveSystemNotification(contactId, systemMessage, eventGameTime);

        console.log(`[TimelineService] 模式A - 系统提示已发送: ${characterName}`);
      } else {
        // ========== 模式 B:角色主动发消息 ==========
        // 玩家曾与该角色联系过，AI 生成基于上下文的主动消息
        if (typeof aiService === 'undefined') {
          console.warn('[TimelineService] AI服务不可用，跳过模式B');
          return;
        }

        // 调用 AI 生成基于聊天记录的主动消息(不参考 timeline 事件内容)
        const reply = await aiService.generateProactiveSMS(contactId, eventGameTime);

        await smsService.receiveEventSMS(contactId, reply, eventGameTime);

        console.log(`[TimelineService] 模式B - 角色主动消息已发送: ${characterName}`);
      }
    } catch (error) {
      console.error(`[TimelineService] 生成事件短信失败 (${contactId}):`, error);
    }
  }

  /**
   * 获取存档数据(包含已触发事件)
   */
  getSaveData() {
    return {
      currentDate: this.currentDate,
      triggeredEventIds: { ...this.triggeredEventIds }, // 对象格式（包含 UID）
    };
  }

  /**
   * 从存档恢复数据(包含已触发事件)
   */
  restore(data) {
    // 先清空，再按存档恢复，避免旧状态残留
    this.clear();

    const source = data && typeof data === 'object' ? data : null;
    if (!source) {
      this.buildContactMap();
      return;
    }

    const hasOwn = key => Object.prototype.hasOwnProperty.call(source, key);

    // 恢复已触发事件列表（兼容旧格式数组和新格式对象）
    if (hasOwn('triggeredEventIds')) {
      if (Array.isArray(source.triggeredEventIds)) {
        // 旧格式：数组 -> 转换为对象，UID 设为 null（不可回滚）
        for (const id of source.triggeredEventIds) {
          this.triggeredEventIds[id] = null;
        }
      } else if (source.triggeredEventIds && typeof source.triggeredEventIds === 'object') {
        this.triggeredEventIds = { ...source.triggeredEventIds };
      }
      console.log(
        `[TimelineService] 从存档恢复 ${Object.keys(this.triggeredEventIds).length} 个已触发事件`
      );
    }

    // currentDate 仅在合法时恢复；不合法保持 null
    if (hasOwn('currentDate') && source.currentDate && typeof source.currentDate === 'object') {
      const dateData = source.currentDate;
      const year = Number.parseInt(dateData.year, 10);
      const rawMonth = Number.parseInt(dateData.month, 10);
      const rawDay = Number.parseInt(dateData.day, 10);
      const month = Number.isFinite(rawMonth) && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : 1;
      const day = Number.isFinite(rawDay) && rawDay >= 1 && rawDay <= 30 ? rawDay : 1;

      if (Number.isFinite(year) && year > 0) {
        this.currentDate = this._buildRuntimeDate(
          year,
          month,
          day,
          typeof dateData.timeStr === 'string'
            ? dateData.timeStr
            : typeof dateData.time_str === 'string'
              ? dateData.time_str
              : this._getDefaultClockTime()
        );
        this.lastCheckedDate = { ...this.currentDate };
        console.log('[TimelineService] 从存档恢复日期:', this.currentDate);
      }
    }

    // 恢复后重建联系人映射
    this.buildContactMap();
  }

  /**
   * 基于 UID 回滚（删除 targetUID 之后触发的事件记录）
   * @param {string} targetUID - 目标 UID
   */
  rollbackAfterUID(targetUID) {
    const toDelete = [];
    for (const eventId in this.triggeredEventIds) {
      const triggerUID = this.triggeredEventIds[eventId];
      if (triggerUID && typeof isUIDAfter === 'function' && isUIDAfter(triggerUID, targetUID)) {
        toDelete.push(eventId);
      }
    }
    for (const eventId of toDelete) {
      delete this.triggeredEventIds[eventId];
    }
    if (toDelete.length > 0) {
      console.log(`[TimelineService] 回滚: 删除 ${toDelete.length} 个已触发事件记录`);
    }
  }

  // ============================================
  // SMS 专用方法
  // ============================================

  /**
   * 获取特定角色在 +/-N个月 范围内的事件(用于短信上下文)
   * @param {string} characterName - 角色名字(如 'Lili', 'Elena')
   * @param {number} monthRange - 月份范围(默认3，即前后各3个月)
   * @returns {Array} 筛选后的事件数组
   */
  getEventsForSMS(characterName, monthRange = 3) {
    if (!this.currentDate) {
      console.log('[TimelineService] 未设置当前日期，无法筛选SMS事件');
      return [];
    }

    const timelineData = this._getTimelineData();
    if (!timelineData.length) {
      console.warn('[TimelineService] timeline 数据为空');
      return [];
    }

    const currentDays = this.dateToDays(this.currentDate);
    // 每月按30天计算，+/-monthRange 个月
    const dayRange = monthRange * 30;
    const minDays = currentDays - dayRange;
    const maxDays = currentDays + dayRange;

    const events = timelineData.filter(event => {
      // 1. 检查角色匹配
      if (!event.characters || !event.characters.includes(characterName)) {
        return false;
      }

      // 2. 检查时间范围
      const eventDate = this._parseSnapshotEventDate(event);
      if (!eventDate) return false;

      const eventDays = this.dateToDays(eventDate);
      return eventDays >= minDays && eventDays <= maxDays;
    });

    this.sortEventsByDate(events);

    console.log(
      `[TimelineService] SMS筛选: 角色"${characterName}", 范围+/-${monthRange}月, 找到 ${events.length} 个事件`
    );
    return events;
  }

  /**
   * 格式化事件为SMS上下文注入文本
   * @param {string} characterName - 角色名字
   * @param {number} monthRange - 月份范围
   * @returns {string} 格式化后的文本
   */
  formatForSMS(characterName, monthRange = 3) {
    const events = this.getEventsForSMS(characterName, monthRange);
    if (events.length === 0) return '';

    let text = `\n\n## ${characterName} 近期经历(+/-${monthRange}个月)\n\n`;
    text += '以下是该角色近期发生的事件，请在回复时保持一致性:\n\n';

    for (const event of events) {
      const eventClock = this._getTimeStringFromDate(event);
      const dateStr = `${event.time}${event.day ? ` ${event.day}` : ''}${eventClock ? ` ${eventClock}` : ''}`;
      const locationName =
        typeof gmCodeEngine !== 'undefined' && gmCodeEngine._resolveLocationDisplayName
          ? gmCodeEngine._resolveLocationDisplayName(event.location)
          : event.location;
      text += `[${dateStr}]${locationName}\n`;
      text += `${event.content}\n\n`;
    }

    return text;
  }
}

// 创建全局实例
const timelineService = new TimelineService();

// ========================================
// EventBus 监听器
// ========================================
if (window.eventBus && window.GameEvents) {
  // 监听回滚事件
  eventBus.on(GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
    timelineService.rollbackAfterUID(targetUID);
  });

  console.log('[TimelineService] EventBus 监听器已注册');
}

// 注册到服务中心
ServiceRegistry.register('gameTime', timelineService);
