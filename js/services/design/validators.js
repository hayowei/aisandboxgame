/**
 * design/validators.js
 * 设计模式的校验工具集（非 Phase 3 专属）。
 *
 * 由 mixin 模式扩展 DesignService.prototype，加载顺序在 designService.js 之后。
 *
 * 这些 validator 原本住在已废除的 design/repair.js 里——Phase 3 重写时
 * repair.js 整文件删了，但里面有 4 个 validator 是 P3 之外（预览面板 / Phase 2
 * stage 校验 / import-export 一致性 check）一直在用的：
 *
 *   _validateTimeConsistencyForSnapshot     ↑ ui.js, design2.js
 *   _validateCharacterDatabasePanelConsistency ↑ ui.js, import-export.js, design2.js
 *   _validateCognitiveStateSemantics        ↑ ui.js
 *   _buildCognitiveSemanticWarningPanel     ↑ ui.js (warning 面板 DOM)
 *   _normalizeBirthdayStringForPrecision    ↑ design2.js
 *
 * 加上它们的内部 helpers（生日 / 时间精度 / 枚举值 / 角色字段校验），原样搬过来。
 * 与 repair.js 中的 inspection-triage / AI fix loop / JSON 修复无关——那些已永久删除。
 *
 * 文件内方法签名与原 _DesignServiceRepairMixin 中的版本一字不动，保证调用方零回归。
 */

class _DesignServiceValidatorsMixin {
  // ============================================
  // 时间一致性校验
  // ============================================

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
          // 生日按设计是「日」粒度（无钟点）——与 _canParseCharacterBirthday /
          // _normalizeBirthdayStringForPrecision 一致。用世界 precision='time' 会对每个无钟点生日
          // 误报 time_str 缺失 fatal（precision='time' 卡的每个角色都中招），且把生日挡在
          // 后续「事件早于出生」交叉校验之外。
          'day',
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

    const _timelineSource = snapshot.world_timeline || snapshot.timeline;
    const timelineEvents = Array.isArray(_timelineSource?.events) ? _timelineSource.events : [];
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

  // ============================================
  // 生日 / 时间精度 helpers
  // ============================================

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

  _validateBirthdayValueForCurrentWorld(birthday, step3Fields = this.designConfig?.panel_fields) {
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

  // ============================================
  // 角色字段 helpers
  // ============================================

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

  // ============================================
  // 角色档案 panel 一致性校验
  // ============================================

  _validateCharacterDatabasePanelConsistency(step3Fields, characterDatabase, options = {}) {
    // mutate=true 才会把缺失的数值字段就地补 0（仅落库前校验该传）；预览渲染路径默认 false——
    // 否则「渲染预览」这种应只读的动作会静默改 designConfig 并经 _editDraft 自动保存落盘。
    const mutate = options && options.mutate === true;
    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      errors: [],
      warnings: [],
    };

    const panelNpcFields = Array.isArray(step3Fields?.panel_npc) ? step3Fields.panel_npc : [];
    if (panelNpcFields.length === 0) {
      report.warnings.push({
        message: 'panel_fields.panel_npc 缺失或为空，跳过角色档案字段一致性校验',
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
            if (mutate) character[fieldKey] = 0;
            report.warnings.push({
              characterId,
              fieldKey,
              fieldLabel: field.label || fieldKey,
              issueType: 'auto_filled',
              message: mutate
                ? `${characterId} -> ${fieldKey}(${field.label || fieldKey}) 缺失, 已自动补 0`
                : `${characterId} -> ${fieldKey}(${field.label || fieldKey}) 缺失（数值类，应用时会自动补 0）`,
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

  // ============================================
  // 认知状态语义校验
  // ============================================

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

    // Wave 1E 改名：读 panel_fields（旧名取不到 → 认知状态语义校验整段被跳过）
    const panelNpcFields = Array.isArray(snapshot?.panel_fields?.panel_npc)
      ? snapshot.panel_fields.panel_npc
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
    // 可点击热区：传原始 message（含字段路径，给 P3 更多定位信息），交给 P3 修
    this._makeWarningPanelFixable(
      wrapper,
      warnings.map(w => w?.message)
    );
    return wrapper;
  }
}

_applyDesignServiceMixin(_DesignServiceValidatorsMixin);
