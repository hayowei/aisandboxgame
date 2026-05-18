// ============================================
// Search Scorer - 搜索打分服务
// ============================================
// 封装搜索评分逻辑，支持 IDF 权重、内容长度加权、关键词频次加权
// 支持剧情感知：时间相关性、NPC 关系、剧情摘要关键词
// 便于后续迭代升级（如向量搜索、BM25 等）

class SearchScorer {
  constructor(options = {}) {
    this.options = {
      maxResults: 15, // 最大返回结果数
      fieldWeights: { characters: 3, location: 2, content: 1 }, // 字段权重
      lengthBonusPerChars: 300, // 每多少字符加一次分
      lengthBonusStep: 0.5, // 每次加多少分
      lengthBonusMax: 2, // 长度加分上限
      frequencyBonusStep: 0.3, // 频次加分步长
      frequencyBonusMax: 1.5, // 频次加分上限
      allMatchBonus: 1.5, // 多关键词全匹配加成倍率
      // 剧情感知加权配置
      timeBonusMax: 2, // 时间加权上限
      relationBonusMax: 1.5, // 关系加权上限
      summaryBonusMax: 1, // 摘要关键词加权上限
      ...options,
    };

    // 词频索引缓存（用于 IDF 计算）
    this.termFrequency = {};
    this.documentCount = 0;
    this.indexBuilt = false;

    // 剧情上下文（动态设置）
    this.context = {
      gameTime: null, // { year, month, day } 当前游戏时间
      npcRelations: {}, // { characterName: relationString } NPC 关系映射
      recentSummaries: [], // 最近的剧情摘要文本数组
      summaryKeywords: [], // 从摘要中提取的关键词
    };

    // 关系关键词映射：不同关系状态对应的事件内容关键词
    this.relationKeywordMap = {
      从属: ['转化', '服从', '主人', '命令', '奴役', '臣服', '仪式', '约束'],
      敌对: ['对抗', '威胁', '逃跑', '反抗', '背叛', '攻击', '敌人'],
      同盟: ['合作', '帮助', '信任', '盟友', '支援', '联合'],
      情人: ['爱', '亲密', '拥抱', '亲吻', '温柔'],
      仆从: ['服侍', '效忠', '听命', '侍奉'],
    };
  }

  // ============================================
  // 剧情上下文管理
  // ============================================

  /**
   * 设置剧情上下文（在每次搜索前调用）
   * @param {Object} gameTime - 当前游戏时间 { year, month, day }
   * @param {Object} npcRelations - NPC 关系映射 { characterName: relationString }
   * @param {string[]} recentSummaries - 最近的剧情摘要文本数组
   */
  setContext(gameTime = null, npcRelations = {}, recentSummaries = []) {
    this.context.gameTime = gameTime;
    this.context.npcRelations = npcRelations || {};
    this.context.recentSummaries = recentSummaries || [];

    // 从摘要中提取关键词
    this.context.summaryKeywords = this._extractKeywordsFromSummaries(recentSummaries);
  }

  /**
   * 清除剧情上下文
   */
  clearContext() {
    this.context = {
      gameTime: null,
      npcRelations: {},
      recentSummaries: [],
      summaryKeywords: [],
    };
  }

  /**
   * 从剧情摘要中提取关键词
   * @param {string[]} summaries - 摘要文本数组
   * @returns {string[]} 关键词数组
   */
  _extractKeywordsFromSummaries(summaries) {
    if (!summaries || summaries.length === 0) return [];

    const text = summaries.join(' ');
    const keywords = [];

    // 提取人名（大写开头的英文名）
    const nameMatches = text.match(/[A-Z][a-z]+/g) || [];
    keywords.push(...nameMatches.map(n => n.toLowerCase()));

    // 提取中文关键词（2-4字的词语，排除常见停用词）
    const stopWords = [
      '这个',
      '那个',
      '他的',
      '她的',
      '我们',
      '他们',
      '之后',
      '之前',
      '然后',
      '但是',
      '因为',
      '所以',
      '可以',
      '已经',
      '正在',
      '开始',
      '结束',
    ];
    const chineseMatches = text.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
    const filteredChinese = chineseMatches.filter(w => !stopWords.includes(w));

    // 统计词频，取前 20 个高频词
    const wordCount = {};
    filteredChinese.forEach(w => {
      wordCount[w] = (wordCount[w] || 0) + 1;
    });

    const topWords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    keywords.push(...topWords);

    return [...new Set(keywords)]; // 去重
  }

  // ============================================
  // 时间相关性加权
  // ============================================

  /**
   * 解析时间轴事件的时间字符串
   * @param {string} timeStr - 时间字符串，如 "星历1042.06" 或 "Pre-星历约070"
   * @param {string} dayStr - 日期字符串，如 "15日" 或 "无日期"
   * @returns {Object|null} { year, month, day } 或 null
   */
  _parseEventTime(timeStr, dayStr, clockStr = '') {
    if (!timeStr) return null;

    // 优先复用 timelineService（支持任意纪年前缀）
    if (
      typeof timelineService !== 'undefined' &&
      typeof timelineService.parseTimeString === 'function'
    ) {
      const parsed = timelineService.parseTimeString(timeStr);
      if (parsed) {
        const day =
          typeof timelineService.parseDayField === 'function'
            ? timelineService.parseDayField(dayStr)
            : null;
        if (!Number.isFinite(day)) return null;
        return {
          year: parsed.year,
          month: parsed.month,
          day,
          time_str: parsed.time_str || String(clockStr || '').trim(),
        };
      }
    }

    // Fallback：前纪元（纪年无关）
    const preMatch = timeStr.match(/(?:Pre-|前)\S*?[约]?(\d+)/);
    if (preMatch) {
      return { year: -parseInt(preMatch[1], 10), month: 1, day: 1, time_str: String(clockStr || '').trim() };
    }

    const dayFromField =
      dayStr && dayStr !== '无日期'
        ? dayStr.match(/(\d+)日/)
          ? parseInt(dayStr.match(/(\d+)日/)[1], 10)
          : null
        : null;

    // Fallback：任意纪年 + 年月日（或年月）
    const fullMatch = timeStr.match(/(\d+)[\.。](\d+)(?:[\.。](\d+))?/);
    if (fullMatch) {
      return {
        year: parseInt(fullMatch[1], 10),
        month: parseInt(fullMatch[2], 10),
        day: fullMatch[3] ? parseInt(fullMatch[3], 10) : dayFromField || 15,
        time_str: String(clockStr || '').trim(),
      };
    }

    // Fallback：仅年份（如 王历118 / 星历1042）
    const yearMatch = timeStr.match(/(\d{2,})\s*$/);
    if (yearMatch) {
      return {
        year: parseInt(yearMatch[1], 10),
        month: 6,
        day: dayFromField || 15,
        time_str: String(clockStr || '').trim(),
      };
    }

    return null;
  }

  /**
   * 将日期转换为天数（用于比较）
   * 假设每年12个月，每月30天
   */
  _dateToDays(date) {
    if (!date) return 0;
    const [hour, minute] = String(date.time_str || date.timeStr || '00:00')
      .split(':')
      .map(value => parseInt(value, 10));
    return (
      date.year * 360 +
      (date.month - 1) * 30 +
      date.day +
      (((Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)) / 1440)
    );
  }

  /**
   * 计算时间相关性加权
   * 距离当前游戏时间越近，加分越高
   * @param {Object} event - 事件对象
   * @returns {number} 时间加权分数
   */
  _calcTimeBonus(event) {
    if (!this.context.gameTime) return 0;

    const eventTime = this._parseEventTime(event.time, event.day, event.time_str || event.timeStr || '');
    if (!eventTime) return 0;

    const currentDays = this._dateToDays(this.context.gameTime);
    const eventDays = this._dateToDays(eventTime);
    const daysDiff = Math.abs(currentDays - eventDays);

    // 同一天内按连续值细分，避免 09:00 和 14:00 完全同分
    if (daysDiff <= 1) {
      return this.options.timeBonusMax * Math.max(0.5, 1 - daysDiff / 2);
    }

    // 距离当前时间越近，加分越高
    // 30天内: +2分, 90天内: +1分, 180天内: +0.5分
    if (daysDiff <= 30) return this.options.timeBonusMax;
    if (daysDiff <= 90) return this.options.timeBonusMax * 0.5;
    if (daysDiff <= 180) return this.options.timeBonusMax * 0.25;

    return 0;
  }

  // ============================================
  // NPC 关系加权
  // ============================================

  /**
   * 计算 NPC 关系加权
   * 根据搜索的角色与玩家的当前关系，优先显示相关事件
   * @param {Object} event - 事件对象
   * @param {string[]} searchKeywords - 搜索关键词数组
   * @returns {number} 关系加权分数
   */
  _calcRelationBonus(event, searchKeywords) {
    if (!this.context.npcRelations || Object.keys(this.context.npcRelations).length === 0) {
      return 0;
    }

    let bonus = 0;
    const contentLower = (event.content || '').toLowerCase();

    // 遍历搜索关键词，查找匹配的 NPC 关系
    for (const kw of searchKeywords) {
      // 在 npcRelations 中查找匹配的角色（不区分大小写）
      for (const [npcName, relation] of Object.entries(this.context.npcRelations)) {
        if (npcName.toLowerCase() === kw || npcName.toLowerCase().includes(kw)) {
          // 找到关系，检查事件内容是否包含关系相关关键词
          const relationLower = (relation || '').toLowerCase();

          // 查找匹配的关系类型
          for (const [relationType, keywords] of Object.entries(this.relationKeywordMap)) {
            if (
              relationLower.includes(relationType.toLowerCase()) ||
              relationLower.includes(relationType)
            ) {
              // 检查事件内容是否包含该关系类型的关键词
              for (const relKeyword of keywords) {
                if (contentLower.includes(relKeyword)) {
                  bonus += 0.3; // 每匹配一个关键词加 0.3 分
                }
              }
              break;
            }
          }
        }
      }
    }

    return Math.min(this.options.relationBonusMax, bonus);
  }

  // ============================================
  // 剧情摘要关键词加权
  // ============================================

  /**
   * 计算剧情摘要关键词加权
   * 事件内容与最近剧情中的关键词匹配，加分
   * @param {Object} event - 事件对象
   * @returns {number} 摘要关键词加权分数
   */
  _calcSummaryBonus(event) {
    if (!this.context.summaryKeywords || this.context.summaryKeywords.length === 0) {
      return 0;
    }

    let bonus = 0;
    const contentLower = (event.content || '').toLowerCase();
    const charactersLower = (event.characters || '').toLowerCase();

    for (const keyword of this.context.summaryKeywords) {
      const kwLower = keyword.toLowerCase();
      // 检查事件内容或人物是否包含该关键词
      if (contentLower.includes(kwLower) || charactersLower.includes(kwLower)) {
        bonus += 0.1; // 每匹配一个关键词加 0.1 分
      }
    }

    return Math.min(this.options.summaryBonusMax, bonus);
  }

  /**
   * 构建词频索引（用于 IDF 权重计算）
   * @param {Array} documents - 文档数组
   * @param {string} field - 用于构建索引的字段名（默认 'characters'）
   */
  buildIndex(documents, field = 'characters') {
    if (!documents || documents.length === 0) return;

    this.termFrequency = {};
    this.documentCount = documents.length;

    documents.forEach(doc => {
      const fieldValue = doc[field] || '';
      // 按 / 或 , 分割人物名
      const terms = fieldValue
        .split(/[\/,]/)
        .map(t => t.trim().toLowerCase())
        .filter(t => t);

      // 统计每个词在多少文档中出现（用于 IDF）
      const uniqueTerms = [...new Set(terms)];
      uniqueTerms.forEach(term => {
        this.termFrequency[term] = (this.termFrequency[term] || 0) + 1;
      });
    });

    this.indexBuilt = true;
  }

  /**
   * 计算 IDF 值（逆文档频率）
   * 词出现在越少的文档中，IDF 越高，说明越有区分度
   * @param {string} term - 搜索词
   * @returns {number} IDF 值
   */
  getIDF(term) {
    if (!this.indexBuilt || this.documentCount === 0) return 1;

    const docFreq = this.termFrequency[term.toLowerCase()] || 1;
    // 标准 IDF 公式：log(总文档数 / 包含该词的文档数)
    // 加 1 平滑处理，避免除以 0
    return Math.log((this.documentCount + 1) / (docFreq + 1)) + 1;
  }

  /**
   * 计算单条事件的相关性分数
   * @param {Object} event - 事件对象
   * @param {string[]} keywords - 关键词数组（已转小写）
   * @returns {Object} { score, matchedFields }
   */
  score(event, keywords) {
    const {
      fieldWeights,
      lengthBonusPerChars,
      lengthBonusStep,
      lengthBonusMax,
      frequencyBonusStep,
      frequencyBonusMax,
      allMatchBonus,
    } = this.options;

    let score = 0;
    const matchedFields = [];

    // 预解析 location 显示名（支持 entity ID）
    const locationDisplayName =
      typeof gmCodeEngine !== 'undefined' && gmCodeEngine._resolveLocationDisplayName
        ? gmCodeEngine._resolveLocationDisplayName(event.location)
        : event.location;
    const locationSearchText = `${event.location} ${locationDisplayName}`.toLowerCase();

    for (const kw of keywords) {
      const idf = this.getIDF(kw);

      // 搜索 characters 字段
      if (event.characters && event.characters.toLowerCase().includes(kw)) {
        score += fieldWeights.characters * idf;
        if (!matchedFields.includes('人物')) matchedFields.push('人物');
      }

      // 搜索 location 字段
      if (locationSearchText.includes(kw)) {
        score += fieldWeights.location * idf;
        if (!matchedFields.includes('地点')) matchedFields.push('地点');
      }

      // 搜索 content 字段
      if (event.content && event.content.toLowerCase().includes(kw)) {
        score += fieldWeights.content * idf;
        if (!matchedFields.includes('内容')) matchedFields.push('内容');

        // 关键词频次加权：同一关键词多次出现，额外加分
        const contentLower = event.content.toLowerCase();
        const regex = new RegExp(this._escapeRegex(kw), 'g');
        const matches = (contentLower.match(regex) || []).length;
        if (matches > 1) {
          score += Math.min(frequencyBonusMax, (matches - 1) * frequencyBonusStep);
        }
      }
    }

    // 多关键词全部命中加成（AND 逻辑）
    if (keywords.length > 1 && score > 0) {
      const allMatched = keywords.every(
        kw =>
          (event.characters && event.characters.toLowerCase().includes(kw)) ||
          locationSearchText.includes(kw) ||
          (event.content && event.content.toLowerCase().includes(kw))
      );
      if (allMatched) {
        score *= allMatchBonus;
      }
    }

    // 内容长度加权：重要事件通常描述更详细
    if (score > 0 && event.content) {
      const lengthBonus = Math.min(
        lengthBonusMax,
        Math.floor(event.content.length / lengthBonusPerChars) * lengthBonusStep
      );
      score += lengthBonus;
    }

    // ============================================
    // 剧情感知加权（仅在有匹配时应用）
    // ============================================
    if (score > 0) {
      // 时间相关性加权
      score += this._calcTimeBonus(event);

      // NPC 关系加权
      score += this._calcRelationBonus(event, keywords);

      // 剧情摘要关键词加权
      score += this._calcSummaryBonus(event);
    }

    return { score, matchedFields };
  }

  /**
   * 完整搜索流程：评分 + 排序 + 截取
   * @param {Array} documents - 文档数组
   * @param {string} query - 搜索查询字符串
   * @returns {Object} { results, totalMatches, note }
   */
  search(documents, query) {
    if (!documents || documents.length === 0) {
      return { results: [], totalMatches: 0, note: '无数据' };
    }

    // 解析关键词
    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter(k => k.length > 0);
    if (keywords.length === 0) {
      return { results: [], totalMatches: 0, note: '请提供有效的搜索词' };
    }

    // 确保索引已构建
    if (!this.indexBuilt) {
      this.buildIndex(documents, 'characters');
    }

    // 计算每条事件的分数
    const scoredEvents = documents.map(event => {
      const { score, matchedFields } = this.score(event, keywords);
      return { event, score, matchedFields };
    });

    // 过滤无匹配项，按分数降序排序，同分时按时间倒序
    const matchedEvents = scoredEvents
      .filter(item => item.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        // 同分时按时间倒序（更近期的事件优先）
        return (b.event.time || '').localeCompare(a.event.time || '');
      });

    const totalMatches = matchedEvents.length;
    const results = matchedEvents.slice(0, this.options.maxResults);

    let note = '';
    if (totalMatches === 0) {
      note = `未找到包含 "${query}" 的历史事件`;
    } else if (totalMatches > this.options.maxResults) {
      note = `(按相关性排序，显示前 ${this.options.maxResults} 条，共 ${totalMatches} 条匹配)`;
    } else {
      note = `(共 ${totalMatches} 条匹配)`;
    }

    return { results, totalMatches, note };
  }

  /**
   * 格式化搜索结果为文本
   * @param {Object} searchResult - search() 方法的返回值
   * @returns {string} 格式化的文本
   */
  formatResults(searchResult) {
    const { results, note } = searchResult;

    if (results.length === 0) {
      return note;
    }

    const formatted = results
      .map((item, idx) => {
        const e = item.event;
        const matchInfo =
          item.matchedFields.length > 0 ? `[匹配: ${item.matchedFields.join('/')}]` : '';
        return `#${idx + 1} [${e.time} ${e.day}] ${e.location} ${matchInfo}\n人物: ${e.characters}\n${e.content}`;
      })
      .join('\n\n---\n\n');

    return note ? `${note}\n\n${formatted}` : formatted;
  }

  /**
   * 转义正则表达式特殊字符
   * @param {string} str - 原始字符串
   * @returns {string} 转义后的字符串
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 重置索引（当数据源变化时调用）
   */
  resetIndex() {
    this.termFrequency = {};
    this.documentCount = 0;
    this.indexBuilt = false;
  }
}

// 创建全局实例
const searchScorer = new SearchScorer();
window.searchScorer = searchScorer;
