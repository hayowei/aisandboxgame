// ============================================
// Archive Service - 档案检索服务
// ============================================
// 供 Step1 Function Calling 查询世界档案与规则模块
// 数据来源：entityStore / worldMeta / timelineStore / npcStore
// custom 模式严格 custom-only：缺失即不可用
// ============================================

class ArchiveService {
  constructor() {
    this.loadedModulesInSession = new Set();

    // 兼容旧四国分章检索（仅当文本结构匹配）
    this.topicToSections = {
      Geopolitics: ['第一章'],
      History_Culture: ['第二章'],
      System_Hierarchy: ['第三章'],
      Economy_Environment: ['第四章'],
      Narrative_Core: ['第五章'],
    };
    this.sectionPattern = /^### (第[一二三四五]章)[：:]/;
  }

  // ========================================
  // Store Access
  // ========================================

  _getTimelineEvents() {
    return window.timelineStore?.getEvents?.() || [];
  }

  _hasWorldEntity(entityId) {
    if (!entityId) return false;
    return window.entityStore?.has?.(entityId) || false;
  }

  _hasRuleModule(moduleId) {
    if (!moduleId) return false;
    return this._listRuleModules().includes(moduleId);
  }

  _listRuleModules() {
    return window.worldMeta?.listRuleModules?.() || [];
  }

  _listCallableRuleModules() {
    return this._listRuleModules().filter(
      moduleId => moduleId && moduleId !== 'core_world_mechanics'
    );
  }

  // ========================================
  // 世界设定检索
  // ========================================

  getWorldEntity(entityId) {
    if (!entityId) return null;
    return window.entityStore?.get?.(entityId) || null;
  }

  // 兼容旧接口：四国别名 -> 实体ID
  getCountrySetting(country) {
    if (!country) return null;
    return this.getWorldEntity(String(country).toUpperCase());
  }

  extractSections(fullSetting, targetSections) {
    if (!fullSetting || !targetSections || targetSections.length === 0) {
      return null;
    }

    const lines = fullSetting.split('\n');
    const result = [];
    let capturing = false;

    for (const line of lines) {
      const match = line.match(this.sectionPattern);
      if (match) {
        const sectionNum = match[1];
        capturing = targetSections.includes(sectionNum);
        if (capturing) result.push(line);
        continue;
      }
      if (capturing) result.push(line);
    }

    return result.length > 0 ? result.join('\n').trim() : null;
  }

  // 兼容旧接口：按 topic 分章（若实体文本不含章节，回退整段）
  getCountryTopic(country, topic) {
    const fullSetting = this.getCountrySetting(country);
    if (!fullSetting) return null;

    const topics = Array.isArray(topic) ? topic : [topic];
    const allSections = topics.flatMap(t => this.topicToSections[t] || []);
    if (allSections.length === 0) return fullSetting;

    return this.extractSections(fullSetting, allSections) || fullSetting;
  }

  // ========================================
  // 规则模块检索
  // ========================================

  resetLoadedModules() {
    this.loadedModulesInSession.clear();
  }

  _resolveModuleDependencies(moduleId) {
    const loaded = new Set();
    const result = [];

    const resolve = mid => {
      if (loaded.has(mid)) return;
      loaded.add(mid);
      result.push(mid);
      const deps = ArchiveService.MODULE_DEPENDENCIES[mid];
      if (deps) {
        for (const dep of deps) resolve(dep);
      }
    };

    resolve(moduleId);
    return result;
  }

  getPromptModule(moduleId) {
    if (!window.worldMeta) return '';
    if (!this._hasRuleModule(moduleId)) return '';

    const allModules = this._resolveModuleDependencies(moduleId);
    const newModules = allModules.filter(mid => !this.loadedModulesInSession.has(mid));

    if (newModules.length === 0) {
      console.log(`[Agent] 跳过 ${moduleId}(已加载)`);
      return '';
    }

    const results = [];
    for (const mid of newModules) {
      const content = window.worldMeta.getRuleModule(mid);
      if (content) {
        console.log(`[Agent] 加载模块: ${mid}${mid !== moduleId ? ` (${moduleId}的依赖)` : ''}`);
        results.push(content);
        this.loadedModulesInSession.add(mid);
      }
    }

    return results.join('\n\n---\n\n');
  }

  getPromptModuleDirect(moduleId) {
    if (!window.worldMeta) return '';
    const content = window.worldMeta.getRuleModule(moduleId);
    if (!content) return '';
    return content;
  }

  // ========================================
  // 工具目录
  // ========================================

  getCatalog() {
    return {
      world_entities: {
        description: '当前世界实体设定',
        available: window.entityStore?.list?.() || [],
      },
      prompt_modules: {
        description: '当前规则模块（按需加载）',
        available: window.worldMeta?.listRuleModules?.() || [],
      },
    };
  }


  /**
   * 获取function的默认返回内容（用于设置UI显示）
   * @param {string} functionName - function名称
   * @returns {string|null} 默认内容
   */
  getDefaultContent(functionName) {
    // search_world / get_rule — 动态内容工具，无固定默认值
    if (functionName === 'search_world' || functionName === 'get_rule') {
      return '[动态生成内容，无固定默认值]';
    }

    return '[无运行时默认内容]';
  }

  // ========================================
  // 时间线检索
  // ========================================

  _getCurrentGameTime() {
    if (typeof timelineService !== 'undefined' && timelineService.currentDate) {
      return timelineService.currentDate;
    }
    return null;
  }

  _parseEventTime(time, day, timeStr = '') {
    if (!time) return null;
    const parseFallbackDay = rawDay => {
      if (!rawDay || rawDay === '无日期') return null;
      const dayText = String(rawDay).trim();
      const dayMatch = dayText.match(/(\d+)日$/);
      if (dayMatch) {
        const parsedDay = parseInt(dayMatch[1], 10);
        return Number.isFinite(parsedDay) ? parsedDay : null;
      }
      const parsedDay = parseInt(dayText, 10);
      return Number.isFinite(parsedDay) ? parsedDay : null;
    };

    // 优先复用 timelineService 的解析（支持任意纪年）
    if (
      typeof timelineService !== 'undefined' &&
      typeof timelineService.parseTimeString === 'function'
    ) {
      const parsed = timelineService.parseTimeString(time);
      if (parsed) {
        const dayNum =
          typeof timelineService.parseDayField === 'function'
            ? timelineService.parseDayField(day)
            : null;
        if (!Number.isFinite(dayNum)) return null;
        return {
          year: parsed.year,
          month: parsed.month,
          day: dayNum,
          time_str: parsed.time_str || String(timeStr || '').trim(),
        };
      }
    }

    // Fallback：前纪元
    const preMatch = time.match(/(?:Pre-|前)\S*?[约]?(\d+)/);
    if (preMatch) {
      const dayNum = parseFallbackDay(day);
      if (!Number.isFinite(dayNum)) return null;
      return { year: -parseInt(preMatch[1], 10), month: 1, day: dayNum, time_str: String(timeStr || '').trim() };
    }

    // Fallback：任意纪年 + 年月(.日)
    const fullMatch = time.match(/(\d+)[\.。](\d+)(?:[\.。](\d+))?/);
    if (fullMatch) {
      const dayNum = fullMatch[3] ? parseInt(fullMatch[3], 10) : parseFallbackDay(day);
      if (!Number.isFinite(dayNum)) return null;
      return {
        year: parseInt(fullMatch[1], 10),
        month: parseInt(fullMatch[2], 10),
        day: dayNum,
        time_str: String(timeStr || '').trim(),
      };
    }

    // Fallback：仅年份
    const yearMatch = time.match(/(\d{2,})\s*$/);
    if (yearMatch) {
      const dayNum = parseFallbackDay(day);
      if (!Number.isFinite(dayNum)) return null;
      return { year: parseInt(yearMatch[1], 10), month: 1, day: dayNum, time_str: String(timeStr || '').trim() };
    }

    return null;
  }

  _daysDiff(date1, date2) {
    const toMinutes = date => {
      const [hour, minute] = String(date?.time_str || date?.timeStr || '00:00')
        .split(':')
        .map(value => parseInt(value, 10));
      const totalDays = date.year * 365 + date.month * 30 + date.day;
      return totalDays * 1440 + (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
    };
    return Math.abs(toMinutes(date1) - toMinutes(date2)) / 1440;
  }

  getTimelineRecent() {
    const timelineEvents = this._getTimelineEvents();
    if (!timelineEvents.length) {
      return '时间轴数据不可用（当前世界未提供 timeline）';
    }

    const current = this._getCurrentGameTime();
    if (!current) {
      return '开场前暂无与当前时间相关的事件';
    }

    const events = timelineEvents.filter(event => {
      const eventTime = this._parseEventTime(event.time, event.day, event.time_str || event.timeStr || '');
      if (!eventTime) return false;
      return this._daysDiff(current, eventTime) <= 15;
    });

    if (events.length === 0) {
      return '当前时间范围内无历史事件';
    }

    return this._formatEvents(events);
  }

  searchTimeline(query) {
    const timelineEvents = this._getTimelineEvents();
    if (!timelineEvents.length) {
      return '时间轴数据不可用（当前世界未提供 timeline）';
    }

    if (typeof searchScorer === 'undefined') {
      return '搜索服务未加载';
    }

    const gameTime = this._getCurrentGameTime();
    const npcRelations = this._getNpcRelations(query);
    const summaries = this._getRecentSummaries();

    searchScorer.setContext(gameTime, npcRelations, summaries);
    const searchResult = searchScorer.search(timelineEvents, query);
    return searchScorer.formatResults(searchResult);
  }

  _getNpcRelations(query) {
    const relations = {};
    if (typeof smsService !== 'undefined' && smsService.conversations) {
      const keywords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(k => k.length > 0);
      for (const [contactId, messages] of Object.entries(smsService.conversations)) {
        const parts = contactId.split('_');
        const npcName = parts.length >= 3 ? parts[parts.length - 1] : contactId;
        const npcNameLower = npcName.toLowerCase();
        const isRelevant = keywords.some(
          kw => npcNameLower.includes(kw) || kw.includes(npcNameLower)
        );

        if (isRelevant && messages.length > 0) {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].relationship && messages[i].relationship !== '未知') {
              relations[npcName] = messages[i].relationship;
              break;
            }
          }
        }
      }
    }
    return relations;
  }

  _getRecentSummaries() {
    if (typeof summaryService !== 'undefined') {
      const summaries = summaryService.getSummaries();
      if (summaries && summaries.length > 0) {
        return summaries.slice(-5);
      }
    }
    return [];
  }

  _formatEvents(events, note = '') {
    const formatted = events
      .map(e => `[${e.time} ${e.day}] ${e.location}\n人物: ${e.characters}\n${e.content}`)
      .join('\n\n---\n\n');
    return note ? `${note}\n\n${formatted}` : formatted;
  }
}

ArchiveService.MODULE_DEPENDENCIES = {
  time_protocol: ['economy'],
  job_board: ['economy'],
};

const archiveService = new ArchiveService();
window.archiveService = archiveService;
