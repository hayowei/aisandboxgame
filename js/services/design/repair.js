/**
 * design/repair.js
 * Inspection Triage — Phase 2 后质量检测与 AI 修正
 *
 * 通过 mixin 模式扩展 DesignService.prototype。所有方法实现与原 class
 * DesignService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyDesignServiceMixin 合并到 DesignService 上。
 *
 * 内容：P2 阶段输出的字段补全、时间一致性修复、角色字段修复、生日规范化、
 * timeline 检测、字段补全、_repair* / _validate* 系列方法。
 *
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceRepairMixin {
  // ============================================
  // Inspection Triage — P2 后质量检测与 AI 修正
  // ============================================

  async _runInspectionTriage(report, runToken, onProgressUpdate, onInspectionMessage) {
    const failedChecks = Object.values(report.sections)
      .flat()
      .filter(r => !r.pass);

    const deduped = this._dedupeWithConsistencyFindings(failedChecks);
    if (deduped.length === 0) return;

    if (typeof onProgressUpdate === 'function') {
      onProgressUpdate('正在 AI 质量修正...');
    }

    let decisions;
    try {
      const userContent = this._buildTriageUserPrompt(deduped, this.designConfig);
      const response = await aiService._callSummaryAPI(
        [{ role: 'user', content: userContent }],
        _getDesignPromptValue('INSPECTION_TRIAGE_PROMPT', INSPECTION_TRIAGE_PROMPT),
        'repair'
      );
      const extracted = this._extractJSON(response, { includeMeta: true, silent: true });
      decisions = extracted.parsed?.decisions || [];
    } catch (err) {
      console.error('[InspectionTriage] AI call failed, using fallback:', err);
      decisions = this._buildFallbackDecisions(deduped);
    }

    if (!this._isPhase2RunActive(runToken)) {
      throw this._createPhase2AbortError('Phase 2 在修正阶段被中止');
    }

    const beforeScore = report.summary.score;
    const fixItems = decisions.filter(d => d.action === 'fix');
    const askItems = decisions.filter(d => d.action === 'ask_user');
    const dismissItems = decisions.filter(d => d.action === 'dismiss');

    let applied = [];
    if (fixItems.length > 0) {
      applied = this._applyInspectionFixes(fixItems);
      this._saveDesignConfig();
    }

    const afterScore =
      applied.length > 0 && typeof window.inspectWorldCard === 'function'
        ? window.inspectWorldCard(this.designConfig).summary.score
        : beforeScore;

    if (typeof onInspectionMessage === 'function') {
      const summaryText = this._formatInspectionSummary(
        applied,
        askItems,
        dismissItems,
        beforeScore,
        afterScore
      );
      onInspectionMessage({ sender: 'ai', text: summaryText });
    }

    if (askItems.length > 0 && typeof onInspectionMessage === 'function') {
      const findings = askItems.map((item, i) => ({
        id: `finding_inspect_${i + 1}`,
        checkId: item.checkId,
        severity: item.severity || 'warning',
        question: item.question || item.reason || '',
        options: item.options || [
          { id: 'keep', label: '保持当前内容' },
          { id: 'ignore', label: '忽略此问题' },
        ],
        resolved: false,
        resolution: null,
      }));
      this._pendingInspectionFindings = findings;
      const qaText = '**以下问题需要您决定：**';
      onInspectionMessage({
        sender: 'ai',
        text: qaText,
        inspectionFindings: findings,
      });
    }

    console.log(
      `[InspectionTriage] 完成: fix=${applied.length}, ask=${askItems.length}, dismiss=${dismissItems.length}, score=${beforeScore}→${afterScore}`
    );
  }

  _dedupeWithConsistencyFindings(failedChecks) {
    const consistencyPaths = new Set();
    if (Array.isArray(this._pendingConsistencyFindings)) {
      for (const f of this._pendingConsistencyFindings) {
        if (f.fieldPath) consistencyPaths.add(f.fieldPath);
      }
    }
    if (consistencyPaths.size === 0) return failedChecks;

    return failedChecks.filter(check => {
      if (!check.detail) return true;
      const detailStr = JSON.stringify(check.detail);
      for (const path of consistencyPaths) {
        if (detailStr.includes(path)) return false;
      }
      return true;
    });
  }

  _buildTriageUserPrompt(failedChecks, snapshot) {
    const checksText = failedChecks
      .map(c => {
        let line = `[${(c.severity || 'warning').toUpperCase()}] ${c.id}: ${c.message}`;
        if (c.detail) line += '\n  detail: ' + JSON.stringify(c.detail);
        return line;
      })
      .join('\n\n');

    return `## 检测失败项（${failedChecks.length} 项）\n\n${checksText}\n\n## 世界卡完整数据\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\``;
  }

  _buildFallbackDecisions(failedChecks) {
    return failedChecks.map(check => ({
      checkId: check.id,
      action: check.severity === 'error' || check.severity === 'fatal' ? 'ask_user' : 'dismiss',
      question:
        check.severity === 'error' || check.severity === 'fatal' ? check.message : undefined,
      options:
        check.severity === 'error' || check.severity === 'fatal'
          ? [
              { id: 'keep', label: '保持当前内容，稍后在 P3 手动编辑' },
              { id: 'ignore', label: '忽略此问题' },
            ]
          : undefined,
      reason:
        check.severity !== 'error' && check.severity !== 'fatal'
          ? 'AI 修正不可用，低优先级警告自动跳过'
          : undefined,
    }));
  }

  _applyInspectionFixes(fixes) {
    const applied = [];
    for (const fix of fixes) {
      for (const patch of fix.patches || []) {
        const { path, value } = patch;
        if (!path || typeof path !== 'string') continue;
        const keys = path.split('.');
        let target = this.designConfig;
        for (let i = 0; i < keys.length - 1; i++) {
          if (target === null || target === undefined || typeof target !== 'object') {
            target = null;
            break;
          }
          target = target[keys[i]];
        }
        if (target !== null && target !== undefined && typeof target === 'object') {
          const lastKey = keys[keys.length - 1];
          if (value === null) {
            delete target[lastKey];
          } else {
            target[lastKey] = value;
          }
          applied.push({ checkId: fix.checkId, path, reason: fix.reason });
        }
      }
    }
    return applied;
  }

  _formatInspectionSummary(applied, askItems, dismissItems, beforeScore, afterScore) {
    const lines = [];

    if (applied.length === 0 && askItems.length === 0 && dismissItems.length > 0) {
      lines.push(`**质量检测完成**（评分: ${beforeScore}，所有异常项为检测脚本误判，已忽略）`);
      return lines.join('\n');
    }

    const scoreText =
      afterScore >= 100
        ? '评分: 100'
        : beforeScore === afterScore
          ? `评分: ${beforeScore}`
          : `评分: ${beforeScore} → ${afterScore}`;
    lines.push(`**质量检测完成**（${scoreText}）`);

    if (applied.length > 0) {
      lines.push('');
      lines.push(`已修复（${applied.length} 项）：`);
      for (const item of applied) {
        lines.push(`- ${item.reason || item.path}`);
      }
    }

    if (dismissItems.length > 0) {
      lines.push('');
      lines.push(`已跳过（${dismissItems.length} 项，检测脚本误判）：`);
      for (const item of dismissItems) {
        lines.push(`- ${item.reason || item.checkId}`);
      }
    }

    if (askItems.length > 0) {
      lines.push('');
      lines.push(`待确认（${askItems.length} 项）：见下方问答`);
    }

    return lines.join('\n');
  }

  _resolveInspectionFinding(findingId, optionId) {
    const findings = this._pendingInspectionFindings;
    if (!Array.isArray(findings)) return;
    const finding = findings.find(f => f.id === findingId);
    if (!finding || finding.resolved) return;

    const selectedOption = (finding.options || []).find(o => o.id === optionId);

    if (
      selectedOption &&
      Array.isArray(selectedOption.patches) &&
      selectedOption.patches.length > 0
    ) {
      this._applyInspectionFixes([{ patches: selectedOption.patches }]);
    }

    if (optionId === 'edit') {
      const inputEl = document.querySelector('#design-chat-input, #chat-input');
      if (inputEl) {
        inputEl.value = `请修复质量检测问题: ${finding.question || finding.checkId}`;
        inputEl.focus();
      }
    }

    finding.resolved = true;
    finding.resolution = optionId;

    this._saveDesignConfig();
    this._updatePreviewPanel();
    this._updateInspectionFindingUI(findingId, selectedOption?.label || optionId);
  }

  _updateInspectionFindingUI(findingId, label) {
    const container = document.querySelector(`[data-finding-id="${findingId}"]`);
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });
    const badge = document.createElement('span');
    badge.className = 'inspection-resolved-badge';
    badge.textContent = `✓ 已处理: ${label}`; /* ui-lint-allow */
    badge.style.cssText = 'color: var(--status-success); font-size: var(--text-caption); margin-left: 8px;'; // ui-lint-allow
    container.appendChild(badge);
  }

  _validateTimeConsistencyForSnapshot(snapshot) {
    const runtime = this._getTimeValidationRuntime();
    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      errors: [],
      warnings: [],
      randomOpening: null,
      parsedTimelineDates: [],
    };
    if (!snapshot || typeof snapshot !== 'object') {
      report.errors.push({ message: '快照缺失或结构无效' });
      report.ok = false;
      return report;
    }
    if (!runtime || typeof runtime.compareDates !== 'function') {
      report.warnings.push({ message: 'timelineService 不可用，跳过时间一致性校验' });
      return report;
    }

    const { precision, timeSegments } = this._getSnapshotTimeConfig(snapshot);
    const observedDates = [];
    const parsedTimelineDates = [];
    const invalidDateRange = Symbol('invalidDateRange');
    const characterDatabase =
      snapshot.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const birthdaysById = new Map();
    const birthdaysByName = new Map();
    for (const [characterId, character] of Object.entries(characterDatabase)) {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') continue;
      if (!Object.prototype.hasOwnProperty.call(character, 'birthday')) {
        report.errors.push({
          path: `character_database.${characterId}.birthday`,
          message: `${characterId}.birthday 缺少字段`,
        });
        continue;
      }
      if (character.birthday === null) {
        continue;
      }
      const birthdayRaw = typeof character.birthday === 'string' ? character.birthday.trim() : '';
      if (!birthdayRaw) {
        report.errors.push({
          path: `character_database.${characterId}.birthday`,
          message: `${characterId}.birthday 必须是时间字符串或 null`,
        });
        continue;
      }
      if (!this._canParseCharacterBirthday(birthdayRaw, precision)) {
        report.errors.push({
          path: `character_database.${characterId}.birthday`,
          message: `${characterId}.birthday 不符合当前世界时间精度（${precision}）`,
        });
        continue;
      }
      const birthday =
        typeof runtime._parseBirthdayDate === 'function'
          ? runtime._parseBirthdayDate(character.birthday)
          : runtime.parseTimeString?.(character.birthday);
      if (!birthday) {
        report.errors.push({
          path: `character_database.${characterId}.birthday`,
          message: `${characterId}.birthday 不可解析`,
        });
        continue;
      }
      if (
        !this._validateDateValueRange(
          birthday,
          precision,
          `character_database.${characterId}.birthday`,
          report.errors,
          { timeSegments, allowNegativeYear: false }
        )
      ) {
        continue;
      }
      birthdaysById.set(characterId, birthday);
      observedDates.push(birthday);
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      if (name) birthdaysByName.set(name, birthday);
    }

    const parseEventDate = (event, index) => {
      if (typeof runtime._parseSnapshotEventDate === 'function') {
        const parsed = runtime._parseSnapshotEventDate(event);
        if (
          parsed &&
          !this._validateDateValueRange(
            parsed,
            precision,
            `timeline.events[${index}]`,
            report.errors,
            { timeSegments }
          )
        ) {
          return invalidDateRange;
        }
        return parsed;
      }
      const baseDate = runtime.parseTimeString?.(event?.time);
      if (!baseDate) return null;
      const parsed = { ...baseDate, day: runtime.parseDayField?.(event?.day) || baseDate.day || 1 };
      if (
        !this._validateDateValueRange(
          parsed,
          precision,
          `timeline.events[${index}]`,
          report.errors,
          { timeSegments }
        )
      ) {
        return invalidDateRange;
      }
      return parsed;
    };
    const parseTimelineDate = (item, path) => {
      if (typeof runtime._parseTimelineNodeDate === 'function') {
        const parsed = runtime._parseTimelineNodeDate(item);
        if (
          parsed &&
          !this._validateDateValueRange(parsed, precision, path, report.errors, { timeSegments })
        ) {
          return invalidDateRange;
        }
        return parsed;
      }
      const year = Number.parseInt(item?.year, 10);
      if (!Number.isFinite(year) || year === 0) return null;
      const parsed = {
        year,
        month: Number.parseInt(item?.month, 10) || 1,
        day: Number.parseInt(item?.day, 10) || 1,
        time_str: typeof item?.time_str === 'string' ? item.time_str.trim() : '',
      };
      if (!this._validateDateValueRange(parsed, precision, path, report.errors, { timeSegments })) {
        return invalidDateRange;
      }
      return parsed;
    };

    const timelineEvents = Array.isArray(snapshot.timeline?.events) ? snapshot.timeline.events : [];
    timelineEvents.forEach((event, index) => {
      const eventDate = parseEventDate(event, index);
      if (eventDate === invalidDateRange) {
        return;
      }
      if (!eventDate) {
        report.warnings.push({
          path: `timeline.events[${index}]`,
          message: `timeline.events[${index}] 时间不可解析，已跳过一致性校验`,
        });
        return;
      }
      observedDates.push(eventDate);
      parsedTimelineDates.push(eventDate);
      report.parsedTimelineDates.push(eventDate);
      const names = this._splitTimelineCharacters(event?.characters);
      names.forEach(name => {
        const birthday = birthdaysByName.get(name);
        if (!birthday) return;
        if (runtime.compareDates(eventDate, birthday, precision, timeSegments) < 0) {
          report.errors.push({
            path: `timeline.events[${index}]`,
            message: `角色「${name}」的时间线事件早于生日`,
          });
        }
      });
    });

    const characterTimelines =
      snapshot.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
      if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
        continue;
      const birthday = birthdaysById.get(characterId) || null;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : [];
        let previousDate = null;
        entries.forEach((entry, index) => {
          const entryDate = parseTimelineDate(
            entry,
            `character_timelines.${characterId}.${section}[${index}]`
          );
          if (entryDate === invalidDateRange) {
            return;
          }
          if (!entryDate) {
            report.warnings.push({
              path: `character_timelines.${characterId}.${section}[${index}]`,
              message: `${characterId}.${section}[${index}] 时间不可解析，已跳过一致性校验`,
            });
            return;
          }
          observedDates.push(entryDate);
          if (birthday && runtime.compareDates(entryDate, birthday, precision, timeSegments) < 0) {
            report.errors.push({
              path: `character_timelines.${characterId}.${section}[${index}]`,
              message: `${characterId}.${section}[${index}] 早于角色生日`,
            });
          }
          if (
            previousDate &&
            runtime.compareDates(entryDate, previousDate, precision, timeSegments) < 0
          ) {
            report.errors.push({
              path: `character_timelines.${characterId}.${section}[${index}]`,
              message: `${characterId}.${section} 未按时间升序排列`,
            });
          }
          previousDate = entryDate;
        });
      }
    }

    this._validatePromptModuleTimeConsistency(
      snapshot,
      report,
      parsedTimelineDates,
      precision,
      timeSegments,
      runtime
    );
    this._validateTimeLabelSemantics(snapshot, observedDates, report);

    report.ok = report.errors.length === 0;
    return report;
  }

  _formatTimeConsistencySummary(report, maxItems = 3) {
    if (!report) {
      return '时间一致性校验通过';
    }
    if (!Array.isArray(report.errors) || report.errors.length === 0) {
      if (!Array.isArray(report.warnings) || report.warnings.length === 0) {
        return '时间一致性校验通过';
      }
      const preview = report.warnings.slice(0, maxItems).map(item => item.message);
      const remains = report.warnings.length - preview.length;
      return `时间一致性存在 ${report.warnings.length} 条提示：${preview.join('；')}${remains > 0 ? `；其余 ${remains} 项见调试数据` : ''}`;
    }
    const preview = report.errors.slice(0, maxItems).map(item => item.message);
    const remains = report.errors.length - preview.length;
    return `时间一致性校验失败：${preview.join('；')}${remains > 0 ? `；其余 ${remains} 项见调试数据` : ''}`;
  }

  _hasConcreteTimeExample(text, precision = 'time') {
    if (typeof text !== 'string') return false;
    const normalized = text.trim();
    if (!normalized) return false;

    // 日期分隔符：. 。 · - /
    const sep = '[.。·\\-\\/]';
    // 时间分隔符：半角 : 或全角 ：
    const timeSep = '[:：]';
    // 纪年前缀：可选 Pre-/前 + 任意非空白非数字字符（宽泛匹配各语言纪年名）
    const eraPrefix = '(?:Pre-|前)?[^\\s\\d]*?';

    if (precision === 'time') {
      // 纪年 + 数字.数字.数字 + HH:MM（允许1-2位小时）
      const re = new RegExp(
        eraPrefix + '\\s*\\d+' + sep + '\\d+' + sep + '\\d+' +
        '[\\s\\u3000]*\\d{1,2}' + timeSep + '\\d{2}'
      );
      return re.test(normalized);
    }

    if (precision === 'day') {
      // 纪年 + 数字.数字.数字（如 星历200.05.12）
      return new RegExp(eraPrefix + '\\s*\\d+' + sep + '\\d+' + sep + '\\d+').test(normalized);
    }

    if (precision === 'month') {
      // 纪年 + 数字.数字（如 星历200.05）
      return new RegExp(eraPrefix + '\\s*\\d+' + sep + '\\d+').test(normalized);
    }

    if (precision === 'year') {
      // 要求至少一个非数字字符（纪年名）+ 数字
      return /(?:Pre-|前)?[^\s\d]+\s*\d+/.test(normalized);
    }

    return true;
  }

  _getTimePrecisionFromStep3Fields(step3Fields) {
    const panelStatus = Array.isArray(step3Fields?.panel_status) ? step3Fields.panel_status : [];
    const timeGroup = panelStatus.find(
      group => group && (group._template === 'time' || group.key === 'datetime')
    );
    const precision = typeof timeGroup?._precision === 'string' ? timeGroup._precision.trim() : '';
    return ['year', 'month', 'day', 'time'].includes(precision) ? precision : 'time';
  }

  _canParseCharacterBirthday(birthday, _precision = 'day') {
    if (typeof birthday !== 'string') return false;
    const text = birthday.trim();
    if (!text) return false;
    return /^\D*?\d+[\.。]\d+[\.。]\d+$/.test(text);
  }

  _normalizeBirthdayStringForPrecision(birthday, _precision = 'day', snapshot = null) {
    if (typeof birthday !== 'string') return birthday;
    const text = birthday.trim();
    if (!text) return text;
    const runtime = this._getTimeValidationRuntime();
    if (!runtime || typeof runtime.parseTimeString !== 'function') return text;
    const parsed = runtime.parseTimeString(text);
    if (!parsed) return text;
    return (
      this._formatSnapshotDateText(parsed, snapshot || this.designConfig, {
        precision: 'day',
      }) || text
    );
  }

  _getBirthdayPlaceholderFromPrecision(_precision = 'day', era = '') {
    const prefix = typeof era === 'string' && era.trim() ? era.trim() : '星历';
    return `例如：${prefix}104.06.01`;
  }

  _validateBirthdayValueForCurrentWorld(birthday, step3Fields = this.designConfig?.step3_fields) {
    const text = typeof birthday === 'string' ? birthday.trim() : '';
    const precision = this._getTimePrecisionFromStep3Fields(step3Fields);
    if (!text) return { ok: true, precision };
    if (this._canParseCharacterBirthday(text, 'day')) {
      return { ok: true, precision };
    }
    return {
      ok: false,
      precision,
      message: '生日固定使用“纪年.年.月.日”格式，例如：星历104.06.01',
    };
  }

  _isMeaningfulCharacterFieldValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  }

  // 判断 panel_npc 字段是否"数值类" — 经验/等级/声望/金币/血量等。
  // 用于 Stage 3 校验时, 数值类字段缺失自动补 0 而不是 fatal 中断。
  // 保守判定: 必须满足 (label 含数值关键词) 且 (没有 enum, 因为 enum 字段不能瞎填 0)。
  _isNumericLikeCharacterField(field) {
    if (!field || typeof field !== 'object') return false;
    if (Array.isArray(field.enum) && field.enum.length > 0) return false;
    if (field.type === 'number' || field.type === 'integer') return true;
    const label = String(field.label || '').toLowerCase();
    const key = String(field.key || '').toLowerCase();
    const numericKeywords = [
      // 中文
      '经验', '等级', '声望', '金币', '钱', '血量', '生命', '魔力', '法力', '能量', '体力', '耐力', '积分', '分数', '点数',
      // 英文
      'exp', 'experience', 'level', 'rank', 'reputation', 'gold', 'coin', 'money', 'cash',
      'hp', 'mp', 'health', 'mana', 'energy', 'stamina', 'score', 'point',
    ];
    return numericKeywords.some(kw => label.includes(kw) || key.includes(kw));
  }

  _getCharacterFieldValueForValidation(character, fieldKey) {
    if (!character || typeof character !== 'object') return undefined;
    if (fieldKey === 'cognitive_state') {
      return this._isMeaningfulCharacterFieldValue(character.default_cognitive_state)
        ? character.default_cognitive_state
        : character.cognitive_state;
    }
    return character[fieldKey];
  }

  _validateCharacterFieldEnumValue(field, value) {
    const enumValues = Array.isArray(field?.enum)
      ? field.enum
          .map(item => (typeof item === 'string' ? item.trim() : String(item || '').trim()))
          .filter(Boolean)
      : [];
    if (enumValues.length === 0) {
      return { ok: true, invalidParts: [], invalidValue: null };
    }

    const normalizedValue =
      typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);
    if (!normalizedValue) {
      return { ok: false, invalidParts: [], invalidValue: normalizedValue };
    }

    // 构建扩展的 enumSet：同时包含完整复合值和拆分后的子部分
    // 例如枚举 ["冷静/理性", "热心肠/话痨"] → Set 包含 "冷静/理性", "冷静", "理性", "热心肠/话痨", "热心肠", "话痨"
    const enumSet = new Set();
    for (const val of enumValues) {
      enumSet.add(val);
      if (val.includes('/')) {
        for (const part of val.split('/').map(s => s.trim()).filter(Boolean)) {
          enumSet.add(part);
        }
      }
    }

    // 先检查整体精确匹配
    if (enumSet.has(normalizedValue)) {
      return { ok: true, invalidParts: [], invalidValue: null };
    }

    // 再拆分检查
    const parts =
      typeof value === 'string' && normalizedValue.includes('/')
        ? normalizedValue
            .split('/')
            .map(item => item.trim())
            .filter(Boolean)
        : [normalizedValue];
    const invalidParts = parts.filter(part => !enumSet.has(part));
    return {
      ok: invalidParts.length === 0,
      invalidParts,
      invalidValue: normalizedValue,
    };
  }

  _validateCharacterDatabasePanelConsistency(step3Fields, characterDatabase) {
    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      errors: [],
      warnings: [],
    };

    const panelNpcFields = Array.isArray(step3Fields?.panel_npc) ? step3Fields.panel_npc : [];
    if (panelNpcFields.length === 0) {
      report.warnings.push({
        message: 'step3_fields.panel_npc 缺失或为空，跳过角色档案字段一致性校验',
      });
      return report;
    }

    if (
      !characterDatabase ||
      typeof characterDatabase !== 'object' ||
      Array.isArray(characterDatabase)
    ) {
      report.errors.push({
        characterId: null,
        fieldKey: null,
        fieldLabel: null,
        message: 'character_database 缺失或结构无效',
      });
      report.ok = false;
      return report;
    }

    const fixedKeys = this._getNpcRuntimeRequiredKeySet();
    const characters = Object.entries(characterDatabase).filter(
      ([key, value]) =>
        !String(key).startsWith('_') && value && typeof value === 'object' && !Array.isArray(value)
    );

    for (const [characterId, character] of characters) {
      for (const field of panelNpcFields) {
        if (!field || typeof field.key !== 'string' || !field.key.trim()) continue;
        const fieldKey = field.key.trim();
        if (fixedKeys.has(fieldKey)) continue;
        if (field.nullable === true) continue;

        let hasValue = false;
        if (fieldKey === 'cognitive_state') {
          hasValue = this._isMeaningfulCharacterFieldValue(
            this._getCharacterFieldValueForValidation(character, fieldKey)
          );
        } else if (fieldKey === 'birthday') {
          hasValue = Object.prototype.hasOwnProperty.call(character, 'birthday');
        } else {
          hasValue = this._isMeaningfulCharacterFieldValue(character[fieldKey]);
        }

        if (!hasValue) {
          // 数值类字段缺失自动填 0 + warning, 不报 fatal: AI 偶尔会漏填经验/等级/声望
          // 这种"我也不知道初始值是多少"的字段, 之前 hard error 中断 Stage 3 影响用户体验。
          // 字符串/枚举/复合字段保持 fatal — schema 严肃性不下降。
          if (this._isNumericLikeCharacterField(field)) {
            character[fieldKey] = 0;
            report.warnings.push({
              characterId,
              fieldKey,
              fieldLabel: field.label || fieldKey,
              issueType: 'auto_filled',
              message: `${characterId} -> ${fieldKey}(${field.label || fieldKey}) 缺失, 已自动补 0`,
            });
            continue;
          }
          report.errors.push({
            characterId,
            fieldKey,
            fieldLabel: field.label || fieldKey,
            issueType: 'missing',
            message: `${characterId} -> ${fieldKey}(${field.label || fieldKey})`,
          });
          continue;
        }

        if (Array.isArray(field.enum) && field.enum.length > 0 && fieldKey !== 'birthday') {
          const fieldValue = this._getCharacterFieldValueForValidation(character, fieldKey);
          const enumValidation = this._validateCharacterFieldEnumValue(field, fieldValue);
          if (!enumValidation.ok) {
            const invalidPreview =
              enumValidation.invalidParts.length > 0
                ? enumValidation.invalidParts.join('/')
                : enumValidation.invalidValue || '空值';
            report.errors.push({
              characterId,
              fieldKey,
              fieldLabel: field.label || fieldKey,
              issueType: 'invalid_enum',
              invalidValue: enumValidation.invalidValue,
              invalidParts: enumValidation.invalidParts,
              message: `${characterId} -> ${fieldKey}(${field.label || fieldKey}) 值不在枚举内：${invalidPreview}`,
            });
          }
        }
      }
    }

    report.ok = report.errors.length === 0;
    return report;
  }

  _compactCharacterDatabaseValidation(report) {
    if (!report) return null;
    return {
      ok: report.ok,
      checkedAt: report.checkedAt,
      errors: report.errors.map(e => ({
        characterId: e.characterId || null,
        fieldKey: e.fieldKey || null,
        fieldLabel: e.fieldLabel || null,
        issueType: e.issueType || 'missing',
        invalidValue: e.invalidValue ?? null,
        invalidParts: Array.isArray(e.invalidParts) ? e.invalidParts : [],
        message: e.message,
      })),
      warnings: report.warnings.map(e => ({ message: e.message })),
      issueCount: report.errors.length + report.warnings.length,
    };
  }

  _formatCharacterDatabaseValidationSummary(report, maxItems = 3) {
    if (!report) {
      return '角色数据库校验通过';
    }
    if (!Array.isArray(report.errors) || report.errors.length === 0) {
      if (!Array.isArray(report.warnings) || report.warnings.length === 0) {
        return '角色数据库校验通过';
      }
      const preview = report.warnings.slice(0, maxItems).map(item => item.message);
      const remains = report.warnings.length - preview.length;
      return `角色数据库存在 ${report.warnings.length} 条提示：${preview.join('；')}${remains > 0 ? `；其余 ${remains} 项见调试数据` : ''}`;
    }

    const preview = report.errors.slice(0, maxItems).map(item => item.message);
    const remains = report.errors.length - preview.length;
    const missingCount = report.errors.filter(item => item.issueType === 'missing').length;
    const invalidEnumCount = report.errors.filter(item => item.issueType === 'invalid_enum').length;
    let prefix = '角色数据库存在字段问题：';
    if (missingCount > 0 && invalidEnumCount === 0) {
      prefix = '角色数据库缺少角色档案初始值：';
    } else if (missingCount === 0 && invalidEnumCount > 0) {
      prefix = '角色数据库存在枚举值不合法：';
    } else if (missingCount > 0 && invalidEnumCount > 0) {
      prefix = '角色数据库存在字段缺失/枚举非法：';
    }
    return `${prefix}${preview.join('；')}${remains > 0 ? `；其余 ${remains} 项见调试数据` : ''}`;
  }

  _buildCharacterDatabaseValidationMessage(parsed, report) {
    const summary = parsed?._summary || '角色数据库生成完成';
    if (!report) return summary;

    const issueCount = report.errors.length + report.warnings.length;
    if (issueCount === 0) {
      return `${summary}\n\n✅ 角色数据库字段校验通过（0 条问题）`;
    }

    return `${summary}\n\n⚠️ ${this._formatCharacterDatabaseValidationSummary(report)}`;
  }

  _looksLikeNarrativeCognitiveState(value) {
    if (typeof value !== 'string') return false;
    const text = value.trim();
    if (!text) return false;
    const identitySuffixPattern =
      /(人|员|师|老板|学徒|巡守|护卫|助手|信差|旅人|主角|骑士|冒险者|祭司|守卫|CEO|医师)$/;
    const looksIdentityLike = identitySuffixPattern.test(text);

    const narrativeLikePattern =
      /(发现|怀疑|开始|决定|感到|得知|找到|听说|准备|觉得|处理|看见|看到|等回复|放话|担忧|心有余悸|方案见效|想要|更想|不想)/;
    const attitudeLikePattern =
      /(对主角|对玩家|初见\/|有印象\/|友好|中立|主动好奇|公事公办|职业性友好|生意人式热情|温和观察|公务性审视|友善但保持距离|腼腆好奇|警惕而狡黠|开朗但赶时间)/;
    if (attitudeLikePattern.test(text)) return true;
    if (text.length > 24 && !looksIdentityLike) return true;
    if (narrativeLikePattern.test(text) && !looksIdentityLike) return true;

    return false;
  }

  _validateCognitiveStateSemantics(snapshot) {
    const report = {
      checkedAt: new Date().toISOString(),
      warnings: [],
    };

    const panelNpcFields = Array.isArray(snapshot?.step3_fields?.panel_npc)
      ? snapshot.step3_fields.panel_npc
      : [];
    const hasCognitiveStateField = panelNpcFields.some(field => field?.key === 'cognitive_state');
    if (!hasCognitiveStateField) {
      return report;
    }

    const characterDatabase = snapshot?.character_database;
    if (
      characterDatabase &&
      typeof characterDatabase === 'object' &&
      !Array.isArray(characterDatabase)
    ) {
      for (const [characterId, character] of Object.entries(characterDatabase)) {
        if (
          characterId.startsWith('_') ||
          !character ||
          typeof character !== 'object' ||
          Array.isArray(character)
        )
          continue;
        const value = character.default_cognitive_state;
        if (!this._looksLikeNarrativeCognitiveState(value)) continue;
        report.warnings.push({
          path: `character_database.${characterId}.default_cognitive_state`,
          message: `${characterId}.default_cognitive_state 更像剧情摘要或对玩家态度，建议改成“角色当前认为自己是谁”`,
          value,
        });
      }
    }

    const characterTimelines = snapshot?.character_timelines;
    if (
      characterTimelines &&
      typeof characterTimelines === 'object' &&
      !Array.isArray(characterTimelines)
    ) {
      for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
        if (
          characterId.startsWith('_') ||
          !timelineGroup ||
          typeof timelineGroup !== 'object' ||
          Array.isArray(timelineGroup)
        )
          continue;
        const cognitiveItems = Array.isArray(timelineGroup.cognitive)
          ? timelineGroup.cognitive
          : [];
        cognitiveItems.forEach((item, index) => {
          const value = item?.state;
          if (!this._looksLikeNarrativeCognitiveState(value)) return;
          report.warnings.push({
            path: `character_timelines.${characterId}.cognitive[${index}].state`,
            message: `${characterId}.cognitive[${index}].state 更像剧情摘要或对玩家态度，建议改成“该时间点角色当前认为自己是谁”`,
            value,
          });
        });
      }
    }

    return report;
  }

  _buildCognitiveSemanticWarningPanel(report) {
    const warnings = Array.isArray(report?.warnings) ? report.warnings : [];
    if (warnings.length === 0) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'dcv-cognitive-warning';

    const title = document.createElement('div');
    title.className = 'dcv-cognitive-warning-title';
    title.textContent = `认知状态语义提醒：${warnings.length} 条提示`;
    wrapper.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'dcv-cognitive-warning-list';

    const limit = 8;
    warnings.slice(0, limit).forEach(item => {
      const li = document.createElement('li');
      li.className = 'dcv-cognitive-warning-item';

      if (typeof item?.path === 'string' && item.path.trim()) {
        const path = document.createElement('div');
        path.className = 'dcv-cognitive-warning-path';
        path.textContent = item.path.trim();
        li.appendChild(path);
      }

      const rawMessage = typeof item?.message === 'string' ? item.message.trim() : '';
      const normalizedMessage = rawMessage.replace(/^[^\s]+\s+/, '').trim() || rawMessage;
      const message = document.createElement('div');
      message.className = 'dcv-cognitive-warning-message';
      message.textContent = normalizedMessage || '请检查该字段的内容';
      li.appendChild(message);

      list.appendChild(li);
    });
    if (warnings.length > limit) {
      const li = document.createElement('li');
      li.className = 'dcv-cognitive-warning-more';
      li.textContent = `其余 ${warnings.length - limit} 条已省略（见调试 payload）。`;
      list.appendChild(li);
    }

    wrapper.appendChild(list);
    return wrapper;
  }

  /**
   * JSON 自愈：当首次解析失败时，将错误信息回传给 AI 尝试修复
   * @param {Object} options - 可选参数 { abortSignal? }
   */
  async _repairJSON(badResponse, stageName, options = {}) {
    // 先做一次本地宽容修复（优先避免额外 API 调用）
    const localAttempt = this._extractJSON(badResponse, { includeMeta: true, silent: true });
    if (localAttempt.parsed) {
      console.log(`[DesignService] ${stageName} JSON 本地修复成功`);
      return { parsed: localAttempt.parsed, failureKind: null, repairLog: [] };
    }

    console.warn(`[DesignService] ${stageName} JSON 解析失败，尝试自愈...`, {
      failureKind: localAttempt.failureKind || 'unknown',
      responseLength: localAttempt.responseLength || 0,
    });
    const repairLog = [];

    let errorMsg = localAttempt.errorMessage || 'JSON 格式错误';
    if (localAttempt.failureKind === 'truncated_or_unclosed') {
      errorMsg = `JSON 疑似截断或未闭合；${errorMsg}`;
    } else if (localAttempt.failureKind === 'invalid_escape_or_control') {
      errorMsg = `JSON 含非法转义/控制字符；${errorMsg}`;
    }

    const repairPrompt = `你上一次输出的 JSON 格式有误，解析错误：${errorMsg}

请修正并重新输出。要求：
- 只输出合法的 JSON，不要输出任何其他内容
- 不要用 \`\`\`json 包裹
- 保持与上次相同的内容结构`;
    const repairSource = this._selectJSONRepairSourceText(badResponse);
    const genericRepair = await this._runJSONRepairAttempt(
      repairSource.text,
      repairPrompt,
      {
        abortSignal: options?.abortSignal || null,
      }
    );
    repairLog.push({
      kind: 'generic_repair',
      sourceType: repairSource.sourceType,
      inputLength: repairSource.text.length,
      success: Boolean(genericRepair.parsed),
      failureKind: genericRepair.failureKind || null,
    });
    if (genericRepair.parsed) {
      console.log(`[DesignService] ${stageName} JSON 自愈成功`);
      return { parsed: genericRepair.parsed, failureKind: null, repairLog };
    }

    if (options?.repairMode === 'stage2_modules') {
      const reserializePrompt = this._buildStage2ReserializeRepairPrompt(errorMsg);
      const stage2Repair = await this._runJSONRepairAttempt(
        repairSource.text,
        reserializePrompt,
        {
          abortSignal: options?.abortSignal || null,
        }
      );
      repairLog.push({
        kind: 'stage2_reserialize_repair',
        sourceType: repairSource.sourceType,
        inputLength: repairSource.text.length,
        success: Boolean(stage2Repair.parsed),
        failureKind: stage2Repair.failureKind || null,
      });
      if (stage2Repair.parsed) {
        console.log(`[DesignService] ${stageName} JSON 定向重序列化成功`);
        return { parsed: stage2Repair.parsed, failureKind: null, repairLog };
      }
      return {
        parsed: null,
        failureKind:
          stage2Repair.failureKind ||
          genericRepair.failureKind ||
          localAttempt.failureKind ||
          'non_json_content',
        repairLog,
      };
    }

    return {
      parsed: null,
      failureKind: genericRepair.failureKind || localAttempt.failureKind || 'non_json_content',
      repairLog,
    };
  }

  _selectJSONRepairSourceText(response) {
    const raw = typeof response === 'string' ? response.trim() : '';
    const stripped = this._stripCodeFence(raw);
    const balancedFromStripped = this._extractFirstBalancedJSONObject(stripped);
    if (balancedFromStripped) {
      return { text: balancedFromStripped, sourceType: 'balanced_object' };
    }
    const balancedFromRaw = this._extractFirstBalancedJSONObject(raw);
    if (balancedFromRaw) {
      return { text: balancedFromRaw, sourceType: 'balanced_object' };
    }
    if (stripped && stripped !== raw) {
      return { text: stripped, sourceType: 'stripped_code_fence' };
    }
    return { text: raw, sourceType: 'raw_response' };
  }

  async _runJSONRepairAttempt(sourceText, repairPrompt, options = {}) {
    const repairMessages = [
      { role: 'assistant', content: sourceText },
      { role: 'user', content: repairPrompt },
    ];

    try {
      const repaired = await aiService._callSummaryAPI(
        repairMessages,
        window.promptRegistry.get('design.repair.systemPrompt').builder({}),
        'repair',
        { abortSignal: options?.abortSignal || null }
      );
      const repairedAttempt = this._extractJSON(repaired, { includeMeta: true, silent: true });
      if (repairedAttempt.parsed) {
        return { parsed: repairedAttempt.parsed, failureKind: null };
      }
      return {
        parsed: null,
        failureKind: repairedAttempt.failureKind || 'non_json_content',
      };
    } catch (e) {
      if (this._isPhase2AbortError(e)) {
        throw e;
      }
      console.warn('[DesignService] JSON 自愈尝试失败:', e);
      return {
        parsed: null,
        failureKind: 'non_json_content',
      };
    }
  }

  _buildStage2ReserializeRepairPrompt(errorMsg) {
    return `你上一次输出的规则系统 JSON 仍然无法解析，错误：${errorMsg}

请只做“格式重序列化”，不要改写原有语义。要求：
- 只输出合法 JSON，不要输出任何解释
- 顶层必须保持 modules / opening_greeting / module_meta / npc_fields / _summary 结构
- 禁止 Markdown 代码围栏
- 必须使用 ASCII 双引号 " 作为 JSON 定界符
- 所有换行都必须写成 \\n
- 禁止输出任何控制字符、BOM、占位文本或额外前后缀
- opening_greeting 中的时间示例必须写成 纪年YYYY.MM.DD HH:MM，不得使用“黄昏 / 深夜 / 清晨”这类模糊时段替代`;
  }

  _isRepairableCharacterDatabaseValidation(report) {
    return Boolean(
      report &&
        Array.isArray(report.errors) &&
        report.errors.length > 0 &&
        report.errors.every(
          item =>
            item &&
            typeof item.characterId === 'string' &&
            item.characterId.trim() &&
            typeof item.fieldKey === 'string' &&
            item.fieldKey.trim()
        )
    );
  }

  async _repairCharacterDatabaseMissingFields(characterDatabase, validationReport, options = {}) {
    if (!this._isRepairableCharacterDatabaseValidation(validationReport)) {
      return { repairedDatabase: null, repairLog: [] };
    }

    const missingByCharacter = new Map();
    for (const item of validationReport.errors) {
      const characterId = item.characterId.trim();
      if (!missingByCharacter.has(characterId)) {
        missingByCharacter.set(characterId, []);
      }
      missingByCharacter.get(characterId).push({
        fieldKey: item.fieldKey,
        fieldLabel: item.fieldLabel || item.fieldKey,
        issueType: item.issueType || 'missing',
        invalidValue: item.invalidValue ?? null,
      });
    }

    const panelFields = Array.isArray(this.designConfig?.step3_fields?.panel_npc)
      ? this.designConfig.step3_fields.panel_npc
      : [];
    const fieldMap = new Map();
    for (const field of panelFields) {
      if (field?.key) fieldMap.set(field.key, field);
    }
    const coreCharacters = this.designConfig?.world_setting?._narrativeCoreCharacters || {};
    const coreCharacterText = Object.entries(coreCharacters)
      .map(([entityId, names]) => `- ${entityId}: ${(names || []).join('、')}`)
      .join('\n');

    const requirementsText = [...missingByCharacter.entries()]
      .map(([characterId, missingFields]) => {
        const fieldLines = missingFields
          .map(field => {
            const def = fieldMap.get(field.fieldKey) || {};
            const enumText =
              Array.isArray(def.enum) && def.enum.length > 0
                ? ` [枚举: ${def.enum.map(v => `"${v}"`).join(' | ')}]`
                : '';
            const metaParts = [];
            const labelCandidate = def.label || field.fieldLabel;
            if (labelCandidate && labelCandidate !== field.fieldKey) {
              metaParts.push(labelCandidate);
            }
            if (def.desc) metaParts.push(def.desc);
            const metaText = metaParts.length > 0 ? ` (${metaParts.join(' / ')})` : '';
            const issueText =
              field.issueType === 'invalid_enum'
                ? ` [当前值不合法: ${field.invalidValue || '空值'}]`
                : ' [缺失]';
            return `- ${field.fieldKey}${metaText}${enumText}${issueText}`;
          })
          .join('\n');
        const snapshot = characterDatabase?.[characterId]
          ? JSON.stringify(characterDatabase[characterId], null, 2)
          : '{}';
        return `### ${characterId}\n缺失字段：\n${fieldLines}\n当前角色快照：\n${snapshot}`;
      })
      .join('\n\n');

    const patchPrompt = `你上一次输出的角色数据库 JSON 已基本可用，但仍有少量角色字段缺失或字段值不合法。

请只输出一个“字段补丁 JSON”，格式如下：
{
  "角色ID": {
    "缺失字段key": "补全后的值"
  }
}

要求：
- 只为缺失字段输出值，不要重复整个 character_database
- 只输出合法 JSON，不要输出解释文字或代码围栏
- 有 enum 约束的字段必须严格从枚举值中选择
- **重要**：如果某字段的 enum 列表里没有可以表达"无/不适用/零值"的选项，必须从现有 enum 中选择语义上最弱/最中性的那一项；**绝对不允许**输出 enum 外的字符串或数字
- **禁止**输出 "不适用" / "无" / "N/A" / "0" / null 等占位值，**除非**它们已经明确出现在该字段的 enum 列表中
- 不得改动角色名、所属实体、既有宗门归属或阵营立场
- 如果某角色名属于 Stage 1 已确定的核心人物，必须保持该人物既有身份事实不变
- 若字段是 cognitive_state，请输出 default_cognitive_state

Stage 1 已确定的核心人物：
${coreCharacterText || '（无）'}

本次缺失项如下：
${requirementsText}`;

    const patchSourceText = this._buildCharacterDatabasePatchSourceText(
      characterDatabase,
      validationReport
    );

    const patchResult = await this._runJSONRepairAttempt(
      patchSourceText,
      patchPrompt,
      {
        abortSignal: options?.abortSignal || null,
      }
    );
    const repairLog = [
      {
        kind: 'stage3_missing_field_patch',
        sourceType: 'character_database_subset',
        inputLength: patchSourceText.length,
        success: Boolean(patchResult.parsed),
        failureKind: patchResult.failureKind || null,
      },
    ];
    if (!patchResult.parsed || typeof patchResult.parsed !== 'object' || Array.isArray(patchResult.parsed)) {
      return { repairedDatabase: null, repairLog };
    }

    const repairedDatabase = this._applyCharacterDatabasePatch(
      characterDatabase,
      patchResult.parsed,
      validationReport
    );
    return { repairedDatabase, repairLog };
  }

  _applyCharacterDatabasePatch(characterDatabase, patch, validationReport) {
    const repaired = { ...characterDatabase };
    const missingByCharacter = new Map();
    for (const item of validationReport.errors || []) {
      if (!item?.characterId || !item?.fieldKey) continue;
      if (!missingByCharacter.has(item.characterId)) {
        missingByCharacter.set(item.characterId, new Set());
      }
      missingByCharacter.get(item.characterId).add(item.fieldKey);
    }

    for (const [characterId, fieldKeys] of missingByCharacter.entries()) {
      const currentCharacter = repaired[characterId];
      const patchEntry = patch?.[characterId];
      if (!currentCharacter || !patchEntry || typeof patchEntry !== 'object' || Array.isArray(patchEntry)) {
        continue;
      }
      const nextCharacter = { ...currentCharacter };
      for (const fieldKey of fieldKeys) {
        if (fieldKey === 'cognitive_state') {
          const cognitiveValue =
            patchEntry.default_cognitive_state !== undefined
              ? patchEntry.default_cognitive_state
              : patchEntry.cognitive_state;
          if (this._isMeaningfulCharacterFieldValue(cognitiveValue)) {
            nextCharacter.default_cognitive_state = cognitiveValue;
          }
          continue;
        }
        if (this._isMeaningfulCharacterFieldValue(patchEntry[fieldKey])) {
          nextCharacter[fieldKey] = patchEntry[fieldKey];
        }
      }
      repaired[characterId] = nextCharacter;
    }

    return repaired;
  }

  _extractStage3EntityPrefix(characterId) {
    if (typeof characterId !== 'string' || !characterId.trim()) return '';
    const match = characterId.trim().match(/^(.*)_[12]\d{2}_[^_]+$/);
    return match?.[1] || '';
  }

  _buildCharacterDatabasePatchSourceText(characterDatabase, validationReport) {
    const subset = {};
    const includedIds = new Set();
    const allCharacters = Object.entries(characterDatabase || {}).filter(
      ([key, value]) =>
        !String(key).startsWith('_') && value && typeof value === 'object' && !Array.isArray(value)
    );

    for (const item of validationReport?.errors || []) {
      const characterId = item?.characterId;
      if (!characterId || includedIds.has(characterId)) continue;
      if (characterDatabase?.[characterId]) {
        subset[characterId] = characterDatabase[characterId];
        includedIds.add(characterId);
      }
      const prefix = this._extractStage3EntityPrefix(characterId);
      if (!prefix) continue;
      const siblingEntries = allCharacters.filter(
        ([id]) => id !== characterId && this._extractStage3EntityPrefix(id) === prefix
      );
      for (const [siblingId, siblingValue] of siblingEntries.slice(0, 2)) {
        if (includedIds.has(siblingId)) continue;
        subset[siblingId] = siblingValue;
        includedIds.add(siblingId);
      }
    }

    return JSON.stringify(
      {
        character_database_subset: subset,
        summary:
          typeof characterDatabase?._summary === 'string' ? characterDatabase._summary : '',
      },
      null,
      2
    );
  }

  stopCurrentProcessing() {
    if (this.designRequestAbortController) {
      try {
        this.designRequestAbortController.abort(new Error('Design repair cancelled'));
      } catch (_e) {
        /* ignore */
      }
      this.designRequestAbortController = null;
    }
    this.isProcessing = false;
  }

  /**
   * 中止 Phase 2 自动生成
   */
  stopAutoGenerate() {
    if (this.phase2AbortController) {
      try {
        this.phase2AbortController.abort(new Error('Phase 2 已中止'));
      } catch (_e) {
        /* ignore */
      }
      this.phase2AbortController = null;
    }
    this.isAutoGenerating = false;
    this.phase2RunToken += 1;
    this.activePhase2RunToken = null;
  }

}

_applyDesignServiceMixin(_DesignServiceRepairMixin);
