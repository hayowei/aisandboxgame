/**
 * worldCardInspection.js
 * 世界卡质量检测器 — 浏览器 + Node.js 双端兼容模块
 *
 * 浏览器端: window.inspectWorldCard(rawData)
 * Node.js:  const { inspectWorldCard } = require('./worldCardInspection.js');
 */
(function (_root) {
  'use strict';

  // ============================================================
  // 常量
  // ============================================================

  const PLACEHOLDER_RE = /\b(?:TODO|TBD)\b|待补充|示例略|lorem ipsum|占位(?![符物])|待完善/i;
  const SNAKE_CASE_RE = /^[a-z][a-z0-9_]*$/;
  const MODULE_MIN_LENGTH = 120;
  const ENTITY_MIN_LENGTH = 500;
  const OPENING_GREETING_MIN_LENGTH = 20;
  const VALID_TIME_PRECISIONS = ['year', 'month', 'day', 'time'];
  const REQUIRED_TIME_PRECISION = 'time';
  const LAZY_TEMPLATE_RE = /执行\s*[Cc]ase\s*[A-Z]|依照模板|按模板|严格依照模板|见上文/i;
  const VALID_DAY_RE = /^\d+日$|^\d+月\d+日$/;
  const VALID_CLOCK_RE = /^\d{2}:\d{2}$/;
  const MODULE_CRITICAL_LENGTH = 60;
  const RECOMMENDED_OPENING_RE = /(?:推荐剧情|Recommended Opening)[：:]/i;
  const ENTITY_TITLE_RE = /##\s*(?:实体设定|实体|Entity(?:\s+Setting)?)\s*[-—]+\s*([^\n(（]+)/gi;

  const EMOTION_RE =
    /发现线索|怀疑上级|对玩家|心情|情绪|推理进展|调查状态|已知真相|对主角|好感|厌恶|警惕|开始怀疑|产生疑虑|感到不安/;

  // ============================================================
  // 工具函数
  // ============================================================

  function getCharacterIds(db) {
    if (!db || typeof db !== 'object' || Array.isArray(db)) return [];
    return Object.keys(db).filter(k => !k.startsWith('_'));
  }

  function extractEraPrefix(str) {
    if (!str || typeof str !== 'string') return null;
    const cleaned = str.replace(/^Pre-/, '');
    const m = cleaned.match(/^([^\d]+)/);
    if (m && m[1].trim()) return m[1].trim();
    return null;
  }

  function parseEventTime(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;
    const source = timeStr.trim();
    const match = source.match(
      /^(?<prefix>(?:Pre-|前)?[^\d]*?(?:约|c\.?)?)?(?<year>\d+)(?:\.(?<month>\d+))?(?:\.(?<day>\d+))?(?:\s+(?<clock>\d{2}:\d{2}))?\s*$/i
    );
    if (!match || !match.groups || !match.groups.year) return null;
    const isPre = /^(?:Pre-|前)/i.test(match.groups.prefix || '');
    const parsed = {
      year: isPre ? -Number(match.groups.year) : Number(match.groups.year),
      month: match.groups.month ? Number(match.groups.month) : 0,
      day: match.groups.day ? Number(match.groups.day) : 0,
    };
    if (match.groups.clock) parsed.time_str = match.groups.clock;
    return parsed;
  }

  function normalizeClockTime(value) {
    if (!VALID_CLOCK_RE.test(value || '')) return '';
    return String(value);
  }

  function timeToValue(timeStr) {
    const normalized = normalizeClockTime(timeStr);
    if (!normalized) return 0;
    const [hour, minute] = normalized.split(':').map(Number);
    return hour * 100 + minute;
  }

  function dateToValue(d) {
    if (!d || d.year === undefined) return 0;
    return (
      ((d.year || 0) * 10000 + (d.month || 1) * 100 + (d.day || 1)) * 10000 +
      timeToValue(d.time_str)
    );
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function parseEraYearToken(token) {
    if (!token || typeof token !== 'string') return null;
    const trimmed = token.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    if (trimmed === '元') return 1;

    const digitMap = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    const unitMap = {
      十: 10,
      百: 100,
      千: 1000,
      万: 10000,
      亿: 100000000,
    };

    let total = 0;
    let section = 0;
    let current = 0;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (Object.prototype.hasOwnProperty.call(digitMap, ch)) {
        current = digitMap[ch];
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(unitMap, ch)) return null;
      const unit = unitMap[ch];
      if (unit >= 10000) {
        section += current;
        total += (section || 1) * unit;
        section = 0;
        current = 0;
      } else {
        section += (current || 1) * unit;
        current = 0;
      }
    }
    return total + section + current;
  }

  function check(id, pass, severity, message, pipelineStage, bugCategory, detail) {
    const r = {
      id: id,
      pass: pass,
      severity: severity,
      message: message,
      pipelineStage: pipelineStage,
      bugCategory: bugCategory,
    };
    if (detail) r.detail = detail;
    return r;
  }

  // ============================================================
  // A — 结构完整性
  // ============================================================
  function checkSectionA(snapshot) {
    const results = [];
    const requiredNodes = [
      'world_setting',
      'prompt_modules',
      'character_database',
      'timeline',
      'character_timelines',
      'step3_fields',
      'relationship_rules',
    ];
    for (let i = 0; i < requiredNodes.length; i++) {
      const key = requiredNodes[i];
      const val = snapshot[key];
      if (val === undefined || val === null) {
        results.push(
          check('A-' + key, false, 'fatal', '顶层节点 [' + key + '] 缺失', 'P2整体', '缺失验证')
        );
      } else if (typeof val !== 'object' || Array.isArray(val)) {
        results.push(
          check(
            'A-' + key,
            false,
            'fatal',
            '顶层节点 [' +
              key +
              '] 类型错误（期望 object，实际 ' +
              (Array.isArray(val) ? 'array' : typeof val) +
              '）',
            'P2整体',
            '缺失验证'
          )
        );
      } else {
        results.push(
          check('A-' + key, true, 'info', '[' + key + '] 存在且类型正确', 'P2整体', '缺失验证')
        );
      }
    }
    return results;
  }

  // ============================================================
  // B — world_setting 实体质量
  // ============================================================
  function checkSectionB(snapshot) {
    const results = [];
    const ws = snapshot.world_setting;
    if (!ws || typeof ws !== 'object') {
      results.push(
        check('B0', false, 'fatal', 'world_setting 缺失，跳过 B 类', 'P2-Stage1', 'AI生成质量')
      );
      return results;
    }
    const settings = ws.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      results.push(
        check(
          'B1',
          false,
          'error',
          'world_setting.settings 缺失或类型错误',
          'P2-Stage1',
          'AI生成质量'
        )
      );
      return results;
    }

    const entityIds = Object.keys(settings).filter(function (k) {
      return !k.startsWith('_');
    });

    results.push(
      check(
        'B1',
        entityIds.length >= 3,
        entityIds.length < 3 ? 'error' : 'info',
        entityIds.length < 3
          ? '实体数量不足（当前 ' + entityIds.length + '，要求 ≥3）'
          : '实体数量充足（' + entityIds.length + ' 个）',
        'P2-Stage1',
        'AI生成质量'
      )
    );

    const badIds = [],
      shortDescs = [],
      placeholderDescs = [],
      noStructure = [];
    for (let i = 0; i < entityIds.length; i++) {
      const id = entityIds[i];
      const text = settings[id];
      if (typeof text !== 'string') continue;
      if (!SNAKE_CASE_RE.test(id)) badIds.push(id);
      if (text.trim().length < ENTITY_MIN_LENGTH)
        shortDescs.push(id + '(' + text.trim().length + '字)');
      if (PLACEHOLDER_RE.test(text)) placeholderDescs.push(id);
      if (!text.includes('##')) noStructure.push(id);
    }

    results.push(
      check(
        'B2',
        badIds.length === 0,
        badIds.length ? 'warning' : 'info',
        badIds.length ? '实体 ID 不符合 snake_case: ' + badIds.join(', ') : '所有实体 ID 格式正确',
        'P2-Stage1',
        'AI生成质量',
        badIds.length ? { ids: badIds } : null
      )
    );

    results.push(
      check(
        'B3',
        shortDescs.length === 0,
        shortDescs.length ? 'warning' : 'info',
        shortDescs.length
          ? shortDescs.length +
              ' 个实体描述过短（<' +
              ENTITY_MIN_LENGTH +
              '字）: ' +
              shortDescs.join(', ')
          : '所有实体描述长度充足',
        'P2-Stage1',
        'AI生成质量',
        shortDescs.length ? { entities: shortDescs } : null
      )
    );

    results.push(
      check(
        'B4',
        placeholderDescs.length === 0,
        placeholderDescs.length ? 'warning' : 'info',
        placeholderDescs.length
          ? placeholderDescs.length + ' 个实体描述含占位词: ' + placeholderDescs.join(', ')
          : '所有实体描述无占位词',
        'P2-Stage1',
        'AI生成质量'
      )
    );

    results.push(
      check(
        'B5',
        noStructure.length === 0,
        noStructure.length ? 'warning' : 'info',
        noStructure.length
          ? noStructure.length + ' 个实体描述缺少 ## 章节结构: ' + noStructure.join(', ')
          : '所有实体描述包含章节结构',
        'P2-Stage1',
        'AI生成质量'
      )
    );

    results.push(
      check(
        'B6',
        !!ws._summary,
        ws._summary ? 'info' : 'warning',
        ws._summary ? '_summary 字段存在' : 'world_setting 缺少 _summary',
        'P2-Stage1',
        'AI生成质量'
      )
    );

    const REQUIRED_CHAPTERS = [
      'Geopolitics',
      'History_Culture',
      'System_Hierarchy',
      'Economy_Environment',
      'Narrative_Core',
    ];
    const missingChapters = [];
    for (let i = 0; i < entityIds.length; i++) {
      const id = entityIds[i];
      const text = settings[id];
      if (typeof text !== 'string') continue;
      const absent = REQUIRED_CHAPTERS.filter(function (ch) {
        return !text.includes('[' + ch + ']');
      });
      if (absent.length > 0) {
        missingChapters.push(id + ' 缺少 [' + absent.join('], [') + ']');
      }
    }
    results.push(
      check(
        'B7',
        missingChapters.length === 0,
        missingChapters.length ? 'warning' : 'info',
        missingChapters.length
          ? missingChapters.length + ' 个实体缺少标准章节标签: ' + missingChapters.join('; ')
          : '所有实体包含标准五章结构',
        'P2-Stage1',
        'AI生成质量',
        missingChapters.length ? { items: missingChapters } : null
      )
    );

    return results;
  }

  // ============================================================
  // C — prompt_modules 规则模块
  // ============================================================
  function checkSectionC(snapshot) {
    const results = [];
    const pm = snapshot.prompt_modules;
    if (!pm || typeof pm !== 'object') {
      results.push(
        check('C0', false, 'fatal', 'prompt_modules 缺失，跳过 C 类', 'P2-Stage2', 'AI生成质量')
      );
      return results;
    }

    const modules = pm.modules;
    const moduleMeta = pm.module_meta;

    if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
      results.push(
        check(
          'C1',
          false,
          'fatal',
          'prompt_modules.modules 缺失或类型错误',
          'P2-Stage2',
          'AI生成质量'
        )
      );
      return results;
    }
    const moduleIds = Object.keys(modules).filter(function (k) {
      return !k.startsWith('_');
    });
    if (moduleIds.length === 0) {
      results.push(check('C1', false, 'fatal', 'modules 为空对象', 'P2-Stage2', 'AI生成质量'));
      return results;
    }
    results.push(
      check(
        'C1',
        true,
        'info',
        'modules 存在（' + moduleIds.length + ' 个）',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    const metaOk = moduleMeta && typeof moduleMeta === 'object' && !Array.isArray(moduleMeta);
    results.push(
      check(
        'C2',
        metaOk,
        metaOk ? 'info' : 'error',
        metaOk ? 'module_meta 存在' : 'module_meta 缺失或类型错误',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    results.push(
      check(
        'C3',
        moduleIds.includes('init'),
        moduleIds.includes('init') ? 'info' : 'fatal',
        moduleIds.includes('init') ? 'modules.init 存在' : 'modules.init 缺失（必须模块）',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    results.push(
      check(
        'C4',
        moduleIds.includes('npc_gen'),
        moduleIds.includes('npc_gen') ? 'info' : 'fatal',
        moduleIds.includes('npc_gen') ? 'modules.npc_gen 存在' : 'modules.npc_gen 缺失（必须模块）',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    const og = pm.opening_greeting;
    if (typeof og !== 'string' || !og.trim()) {
      results.push(
        check('C5', false, 'fatal', 'opening_greeting 缺失或为空', 'P2-Stage2', 'AI生成质量')
      );
    } else if (og.trim().length < OPENING_GREETING_MIN_LENGTH) {
      results.push(
        check(
          'C5',
          false,
          'warning',
          'opening_greeting 过短（' +
            og.trim().length +
            ' 字，要求 ≥' +
            OPENING_GREETING_MIN_LENGTH +
            '）',
          'P2-Stage2',
          'AI生成质量'
        )
      );
    } else {
      results.push(
        check(
          'C5',
          true,
          'info',
          'opening_greeting 存在（' + og.trim().length + ' 字）',
          'P2-Stage2',
          'AI生成质量'
        )
      );
    }

    const initContent = typeof modules.init === 'string' ? modules.init : '';
    const hasRecPlot = RECOMMENDED_OPENING_RE.test(initContent);
    results.push(
      check(
        'C6',
        hasRecPlot,
        hasRecPlot ? 'info' : 'warning',
        hasRecPlot ? 'modules.init 含推荐开场标准行' : 'modules.init 缺少推荐开场标准行',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    const hasLazy = LAZY_TEMPLATE_RE.test(initContent);
    results.push(
      check(
        'C7',
        !hasLazy,
        hasLazy ? 'fatal' : 'info',
        hasLazy
          ? 'modules.init 含懒惰引用（"执行 Case A-D"等），未写出完整分支逻辑'
          : 'modules.init 无懒惰引用',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    const criticalMods = [],
      shortMods = [],
      placeholderMods = [];
    for (let i = 0; i < moduleIds.length; i++) {
      const mid = moduleIds[i];
      const content = modules[mid];
      if (typeof content !== 'string') continue;
      const len = content.trim().length;
      if (len < MODULE_CRITICAL_LENGTH) criticalMods.push(mid + '(' + len + '字)');
      else if (len < MODULE_MIN_LENGTH) shortMods.push(mid + '(' + len + '字)');
      if (PLACEHOLDER_RE.test(content)) placeholderMods.push(mid);
    }
    const allShort = criticalMods.concat(shortMods);
    const hasCritical = criticalMods.length > 0;
    results.push(
      check(
        'C8a',
        allShort.length === 0,
        hasCritical ? 'error' : shortMods.length ? 'warning' : 'info',
        allShort.length
          ? allShort.length +
              ' 个模块内容过短' +
              (hasCritical
                ? '（其中 ' +
                  criticalMods.length +
                  ' 个严重不足 <' +
                  MODULE_CRITICAL_LENGTH +
                  '字）'
                : '') +
              '（<' +
              MODULE_MIN_LENGTH +
              '字）: ' +
              allShort.join(', ')
          : '所有模块内容长度充足',
        'P2-Stage2',
        'AI生成质量',
        allShort.length ? { critical: criticalMods, short: shortMods } : null
      )
    );

    results.push(
      check(
        'C8b',
        placeholderMods.length === 0,
        placeholderMods.length ? 'warning' : 'info',
        placeholderMods.length
          ? placeholderMods.length + ' 个模块含占位词: ' + placeholderMods.join(', ')
          : '所有模块无占位词',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    if (metaOk) {
      const metaIds = Object.keys(moduleMeta);
      const missingMeta = moduleIds.filter(function (id) {
        return !metaIds.includes(id);
      });
      const extraMeta = metaIds.filter(function (id) {
        return !moduleIds.includes(id);
      });
      results.push(
        check(
          'C9',
          missingMeta.length === 0,
          missingMeta.length ? 'warning' : 'info',
          missingMeta.length
            ? 'module_meta 缺少 ' + missingMeta.length + ' 个模块的描述: ' + missingMeta.join(', ')
            : 'module_meta 覆盖所有模块',
          'P2-Stage2',
          'AI生成质量',
          missingMeta.length || extraMeta.length ? { missing: missingMeta, extra: extraMeta } : null
        )
      );
    }

    const hasNpcFieldsPollution = 'npc_fields' in pm;
    results.push(
      check(
        'C10',
        !hasNpcFieldsPollution,
        hasNpcFieldsPollution ? 'warning' : 'info',
        hasNpcFieldsPollution
          ? 'prompt_modules 中存在 npc_fields（AI 写错了位置，应在 step3_fields）'
          : 'prompt_modules 中无 npc_fields 污染',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    const hasROInModules = moduleIds.includes('random_opening');
    results.push(
      check(
        'C11',
        !hasROInModules,
        hasROInModules ? 'fatal' : 'info',
        hasROInModules
          ? '`random_opening` 出现在 modules 内（应为顶层 JSON，不可放入 modules）'
          : 'modules 中无 random_opening',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    const badModIds = moduleIds.filter(function (id) {
      return !SNAKE_CASE_RE.test(id);
    });
    results.push(
      check(
        'C12',
        badModIds.length === 0,
        badModIds.length ? 'warning' : 'info',
        badModIds.length
          ? badModIds.length + ' 个模块 ID 不符合 snake_case: ' + badModIds.join(', ')
          : '所有模块 ID 格式正确',
        'P2-Stage2',
        'AI生成质量'
      )
    );

    if (typeof og === 'string' && og.trim()) {
      const timeOptionRE = /[\u4e00-\u9fff]+\s*\d+[\.。]\d+[\.。]\d+/g;
      const timeOptions = og.match(timeOptionRE) || [];
      const uniqueOptions = new Set(timeOptions);
      const hasDuplicates = timeOptions.length > 1 && uniqueOptions.size < timeOptions.length;
      results.push(
        check(
          'C13',
          !hasDuplicates,
          hasDuplicates ? 'warning' : 'info',
          hasDuplicates
            ? 'opening_greeting 中有重复的时间选项（' +
                timeOptions.join(' / ') +
                '），玩家无法选择不同时代起点'
            : timeOptions.length > 1
              ? 'opening_greeting 时间选项互不相同（' + timeOptions.join(' / ') + '）'
              : 'opening_greeting 时间选项数量 ≤1，无需去重',
          'P2-Stage2',
          'AI生成质量'
        )
      );
    }

    return results;
  }

  // ============================================================
  // D — character_database 角色数据
  // ============================================================
  function checkSectionD(snapshot) {
    const results = [];
    const db = snapshot.character_database;

    if (!db || typeof db !== 'object' || Array.isArray(db)) {
      results.push(
        check('D0', false, 'fatal', 'character_database 缺失，跳过 D 类', 'P2-Stage3', 'AI生成质量')
      );
      return results;
    }

    const charIds = getCharacterIds(db);

    results.push(
      check(
        'D1',
        charIds.length >= 3,
        charIds.length < 3 ? 'error' : 'info',
        charIds.length < 3
          ? '角色数量不足（当前 ' + charIds.length + '，要求 ≥3）'
          : '角色数量充足（' + charIds.length + ' 个）',
        'P2-Stage3',
        'AI生成质量'
      )
    );

    const idMismatches = [];
    for (let i = 0; i < charIds.length; i++) {
      const key = charIds[i];
      const c = db[key];
      if (c && typeof c === 'object' && c.id !== undefined && String(c.id) !== key) {
        idMismatches.push('key="' + key + '" 但 char.id="' + c.id + '"');
      }
    }
    results.push(
      check(
        'D2',
        idMismatches.length === 0,
        idMismatches.length ? 'error' : 'info',
        idMismatches.length
          ? idMismatches.length +
              ' 个角色 id 字段与 key 不一致（GAP-12，导入/P3编辑时易发生）: ' +
              idMismatches[0]
          : '所有角色 id 与 key 一致',
        'P2-Stage3',
        '跨section不一致',
        idMismatches.length ? { items: idMismatches } : null
      )
    );

    const requiredFields = [
      { key: 'name', label: '角色名' },
      { key: 'gender', label: '性别' },
      { key: 'origin', label: '来历' },
      { key: 'default_cognitive_state', label: '认知状态', alt: 'cognitive_state' },
      { key: 'msg_reply_tone', label: '说话语气' },
    ];
    const missingByField = {};
    const birthdayIssues = [];

    for (let ci = 0; ci < charIds.length; ci++) {
      const charId = charIds[ci];
      const ch = db[charId];
      if (!ch || typeof ch !== 'object') continue;

      for (let fi = 0; fi < requiredFields.length; fi++) {
        const fkey = requiredFields[fi].key;
        const alt = requiredFields[fi].alt;
        const val = alt ? ch[fkey] || ch[alt] : ch[fkey];
        if (!val || (typeof val === 'string' && !val.trim())) {
          (missingByField[fkey] = missingByField[fkey] || []).push(charId);
        }
      }

      if (!Object.prototype.hasOwnProperty.call(ch, 'birthday')) {
        birthdayIssues.push(charId + ': birthday 字段不存在');
      } else if (ch.birthday !== null) {
        const bd = ch.birthday;
        if (typeof bd !== 'string') {
          birthdayIssues.push(charId + ': birthday 必须是字符串或 null（实际: ' + typeof bd + '）');
        } else if (bd.trim() === 'null') {
          birthdayIssues.push(charId + ': birthday 是字符串 "null" 而非 JSON null');
        } else if (bd.trim() === '') {
          birthdayIssues.push(charId + ': birthday 为空字符串（应为 null）');
        } else if (!/\d+\.\d+\.\d+/.test(bd)) {
          birthdayIssues.push(
            charId + ': birthday 格式不符（期望 纪年.年.月.日，实际 "' + bd + '"）'
          );
        } else if (bd.includes('。')) {
          birthdayIssues.push(charId + ': birthday 使用了中文句号（"' + bd + '"）');
        }
      }
    }

    let fieldIdx = 3;
    for (let ri = 0; ri < requiredFields.length; ri++) {
      const fkey = requiredFields[ri].key;
      const label = requiredFields[ri].label;
      const missing = missingByField[fkey] || [];
      results.push(
        check(
          'D' + fieldIdx,
          missing.length === 0,
          missing.length ? 'error' : 'info',
          missing.length
            ? missing.length + ' 个角色缺少 ' + label + '（' + fkey + '）: ' + missing.join(', ')
            : '所有角色均有 ' + label,
          'P2-Stage3',
          '缺失验证',
          missing.length ? { chars: missing } : null
        )
      );
      fieldIdx++;
    }

    const panelNpc = snapshot.step3_fields && snapshot.step3_fields.panel_npc;
    const aiDefinedKeys = Array.isArray(panelNpc)
      ? panelNpc
          .filter(function (f) {
            return f && f.fixed !== true && typeof f.key === 'string';
          })
          .map(function (f) {
            return f.key;
          })
      : [];

    if (aiDefinedKeys.length === 0) {
      results.push(
        check(
          'D9',
          true,
          'info',
          'panel_npc 无 AI 自定义字段（或 panel_npc 缺失），跳过 D9 动态字段检测',
          'P2-Stage3',
          '缺失验证'
        )
      );
    } else {
      const missingByChar = {};
      for (let ci = 0; ci < charIds.length; ci++) {
        const charId = charIds[ci];
        const ch = db[charId];
        if (!ch || typeof ch !== 'object') continue;
        const missingKeys = aiDefinedKeys.filter(function (k) {
          const val = ch[k];
          return val === undefined || val === null || (typeof val === 'string' && !val.trim());
        });
        if (missingKeys.length > 0) missingByChar[charId] = missingKeys;
      }
      const problemChars = Object.keys(missingByChar);
      const detailStr =
        Object.entries(missingByChar)
          .slice(0, 5)
          .map(function (e) {
            return e[0] + '缺[' + e[1].join(',') + ']';
          })
          .join('; ') + (problemChars.length > 5 ? '…共' + problemChars.length + '个' : '');
      results.push(
        check(
          'D9',
          problemChars.length === 0,
          problemChars.length ? 'error' : 'info',
          problemChars.length
            ? problemChars.length + ' 个角色缺少 panel_npc 定义的 AI 自定义字段: ' + detailStr
            : '所有角色均包含 panel_npc 定义的 AI 自定义字段（' + aiDefinedKeys.join('、') + '）',
          'P2-Stage3',
          '缺失验证',
          problemChars.length ? { missingByChar: missingByChar } : null
        )
      );
    }

    results.push(
      check(
        'D10',
        birthdayIssues.length === 0,
        birthdayIssues.length ? 'error' : 'info',
        birthdayIssues.length
          ? birthdayIssues.length + ' 个 birthday 格式/存在性问题'
          : '所有 birthday 格式正确',
        'P2-Stage3',
        '缺失验证',
        birthdayIssues.length ? { issues: birthdayIssues } : null
      )
    );

    const entityIds = new Set(
      snapshot.world_setting && snapshot.world_setting.settings
        ? Object.keys(snapshot.world_setting.settings).filter(function (k) {
            return !k.startsWith('_');
          })
        : []
    );
    if (entityIds.size > 0 && charIds.length > 0) {
      const coveredEntities = new Set();
      for (let ci = 0; ci < charIds.length; ci++) {
        for (const eid of entityIds) {
          if (charIds[ci].startsWith(eid + '_')) {
            coveredEntities.add(eid);
            break;
          }
        }
      }
      const uncoveredEntities = [];
      entityIds.forEach(function (id) {
        if (!coveredEntities.has(id)) uncoveredEntities.push(id);
      });
      results.push(
        check(
          'D11',
          uncoveredEntities.length === 0,
          uncoveredEntities.length ? 'warning' : 'info',
          uncoveredEntities.length
            ? uncoveredEntities.length +
                ' 个实体/势力无对应角色（阵营覆盖失衡）: ' +
                uncoveredEntities.join(', ')
            : '所有实体/势力均有对应角色（' + coveredEntities.size + '/' + entityIds.size + '）',
          'P2-Stage3',
          'AI生成质量',
          uncoveredEntities.length
            ? { uncovered: uncoveredEntities, covered: Array.from(coveredEntities) }
            : null
        )
      );
    }

    const conceptNamesD12 = new Set();
    const CONCEPT_QUOTE_D12 =
      /[\u201c\u201d\u0022\u300c\u2018\u2019]([^\u201c\u201d\u0022\u300d\u2018\u2019]{2,8})[\u201c\u201d\u0022\u300d\u2018\u2019]/g;
    const nonPersonSuffixRE = /[图论表册典卷轴碑石阵塔环带剑盾甲符印章令牌]$/;
    if (snapshot.world_setting && snapshot.world_setting.settings) {
      for (const text of Object.values(snapshot.world_setting.settings)) {
        if (typeof text !== 'string') continue;
        for (const m of text.matchAll(CONCEPT_QUOTE_D12)) {
          conceptNamesD12.add(m[1].trim());
        }
      }
    }
    const tlEvents = (snapshot.timeline && snapshot.timeline.events) || [];
    for (let ei = 0; ei < tlEvents.length; ei++) {
      const evt = tlEvents[ei];
      if (evt && evt.content && typeof evt.content === 'string') {
        for (const m of evt.content.matchAll(CONCEPT_QUOTE_D12)) {
          conceptNamesD12.add(m[1].trim());
        }
      }
    }
    const suspiciousCharNames = [];
    for (let ci = 0; ci < charIds.length; ci++) {
      const charId = charIds[ci];
      const ch = db[charId];
      if (!ch || typeof ch !== 'object') continue;
      const name = ch.name;
      if (!name || typeof name !== 'string') continue;
      const isSuffixMatch = nonPersonSuffixRE.test(name);
      const isConceptMatch = name.length >= 3 && conceptNamesD12.has(name);
      if (isSuffixMatch || isConceptMatch) {
        suspiciousCharNames.push(charId + ': name="' + name + '" 疑似道具/概念名而非人名');
      }
    }
    results.push(
      check(
        'D12',
        suspiciousCharNames.length === 0,
        suspiciousCharNames.length ? 'warning' : 'info',
        suspiciousCharNames.length
          ? suspiciousCharNames.length +
              ' 个角色名疑似为世界概念/道具名而非人名（可能是 _narrativeCoreCharacters 提取错误导致）: ' +
              suspiciousCharNames[0]
          : '所有角色名均为合理人名',
        'P2-Stage3',
        'AI生成质量',
        suspiciousCharNames.length ? { items: suspiciousCharNames } : null
      )
    );

    return results;
  }

  // ============================================================
  // E — timeline.events 时间线事件
  // ============================================================
  function checkSectionE(snapshot) {
    const results = [];
    const tl = snapshot.timeline;
    if (!tl || typeof tl !== 'object') {
      results.push(
        check('E0', false, 'fatal', 'timeline 缺失，跳过 E 类', 'P2-Stage4', 'AI生成质量')
      );
      return results;
    }
    const events = tl.events;
    if (!Array.isArray(events)) {
      results.push(
        check('E1', false, 'fatal', 'timeline.events 不是数组', 'P2-Stage4', 'AI生成质量')
      );
      return results;
    }

    results.push(
      check(
        'E1',
        events.length >= 5,
        events.length < 5 ? 'error' : 'info',
        events.length < 5
          ? '事件数量不足（当前 ' + events.length + '，要求 ≥5）'
          : '事件数量充足（' + events.length + ' 条）',
        'P2-Stage4',
        'AI生成质量'
      )
    );

    const missingFields = {
      id: [],
      time: [],
      day: [],
      location: [],
      characters: [],
      content: [],
      time_str: [],
    };
    const unparsableTimes = [],
      duplicateIds = [],
      badDayFormats = [],
      badClockFormats = [];
    const seenIds = new Set();
    const parsedTimes = [];

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      if (!evt || typeof evt !== 'object') continue;

      for (const field of Object.keys(missingFields)) {
        if (!evt[field] || (typeof evt[field] === 'string' && !evt[field].trim())) {
          missingFields[field].push(i);
        }
      }

      if (evt.time) {
        const p = parseEventTime(evt.time);
        if (!p) {
          unparsableTimes.push('事件[' + i + '] time="' + evt.time + '"');
          parsedTimes.push(null);
        } else {
          const parsedDayMatch =
            evt.day && VALID_DAY_RE.test(evt.day) ? evt.day.match(/(\d+)日$/) : null;
          const parsedDay = parsedDayMatch ? parseInt(parsedDayMatch[1], 10) : null;
          parsedTimes.push({
            idx: i,
            p: {
              ...p,
              day: Number.isFinite(parsedDay) ? parsedDay : p.day || 0,
              time_str: typeof evt.time_str === 'string' ? evt.time_str.trim() : '',
            },
            raw: `${evt.time}${evt.day ? ` ${evt.day}` : ''}${evt.time_str ? ` ${evt.time_str}` : ''}`,
          });
        }
      } else {
        parsedTimes.push(null);
      }

      if (evt.id) {
        if (seenIds.has(evt.id)) duplicateIds.push(evt.id);
        seenIds.add(evt.id);
      }

      if (evt.day && typeof evt.day === 'string') {
        if (!VALID_DAY_RE.test(evt.day) || evt.day === '无日期') {
          badDayFormats.push('事件[' + i + '] day="' + evt.day + '"');
        }
      }

      if (typeof evt.time_str !== 'string' || !VALID_CLOCK_RE.test(evt.time_str.trim())) {
        badClockFormats.push('事件[' + i + '] time_str="' + String(evt.time_str || '') + '"');
      }
    }

    const allMissing = Object.entries(missingFields)
      .filter(function (e) {
        return e[1].length > 0;
      })
      .map(function (e) {
        return e[0] + '(' + e[1].length + '条)';
      });
    results.push(
      check(
        'E2',
        allMissing.length === 0,
        allMissing.length ? 'error' : 'info',
        allMissing.length ? '事件字段缺失: ' + allMissing.join(', ') : '所有事件字段完整',
        'P2-Stage4',
        'AI生成质量',
        allMissing.length ? { missing: missingFields } : null
      )
    );

    results.push(
      check(
        'E3',
        true,
        'info',
        'location 为自由文本字段，无需匹配 world_setting 实体 ID（GAP-2 已确认：引擎不做实体约束）',
        'P2-Stage4',
        '缺失验证',
        null
      )
    );

    results.push(
      check(
        'E4',
        unparsableTimes.length === 0,
        unparsableTimes.length ? 'error' : 'info',
        unparsableTimes.length
          ? unparsableTimes.length + ' 个事件 time 不可解析: ' + unparsableTimes.join(', ')
          : '所有事件时间可解析',
        'P2-Stage4',
        'AI生成质量'
      )
    );

    results.push(
      check(
        'E5',
        duplicateIds.length === 0,
        duplicateIds.length ? 'error' : 'info',
        duplicateIds.length ? '重复的事件 ID: ' + duplicateIds.join(', ') : '所有事件 ID 唯一',
        'P2-Stage4',
        'AI生成质量'
      )
    );

    const validTimes = parsedTimes.filter(Boolean);
    const outOfOrder = [];
    for (let i = 1; i < validTimes.length; i++) {
      const prevVal = dateToValue(validTimes[i - 1].p);
      const currVal = dateToValue(validTimes[i].p);
      if (prevVal > currVal) {
        outOfOrder.push(
          '事件[' +
            validTimes[i].idx +
            '](' +
            validTimes[i].raw +
            ') 早于事件[' +
            validTimes[i - 1].idx +
            '](' +
            validTimes[i - 1].raw +
            ')'
        );
      }
    }
    results.push(
      check(
        'E6',
        outOfOrder.length === 0,
        outOfOrder.length ? 'warning' : 'info',
        outOfOrder.length
          ? outOfOrder.length + ' 处事件时间顺序异常: ' + outOfOrder[0]
          : '事件时间顺序正确',
        'P2-Stage4',
        'AI生成质量',
        outOfOrder.length ? { items: outOfOrder } : null
      )
    );

    results.push(
      check(
        'E7',
        badDayFormats.length === 0,
        badDayFormats.length ? 'error' : 'info',
        badDayFormats.length
          ? badDayFormats.length + ' 个事件 day 字段格式非法（合法: "N日"/"M月N日"）: ' + badDayFormats[0]
          : 'day 字段格式规范',
        'P2-Stage4',
        'AI生成质量'
      )
    );
    results.push(
      check(
        'E7b',
        badClockFormats.length === 0,
        badClockFormats.length ? 'error' : 'info',
        badClockFormats.length
          ? badClockFormats.length + ' 个事件 time_str 不是严格 HH:MM: ' + badClockFormats[0]
          : '事件 time_str 均为严格 HH:MM',
        'P2-Stage4',
        'AI生成质量'
      )
    );

    return results;
  }

  // ============================================================
  // F — character_timelines 角色时间线
  // ============================================================
  function checkSectionF(snapshot) {
    const results = [];
    const ct = snapshot.character_timelines;
    const db = snapshot.character_database;
    const charIds = new Set(getCharacterIds(db));

    if (!ct || typeof ct !== 'object' || Array.isArray(ct)) {
      results.push(
        check(
          'F0',
          false,
          'fatal',
          'character_timelines 缺失，跳过 F 类',
          'P2-Stage5',
          'AI生成质量'
        )
      );
      return results;
    }
    const tlCharIds = Object.keys(ct).filter(function (k) {
      return !k.startsWith('_');
    });

    const nameToId = {};
    for (const cid of charIds) {
      const ch = db[cid];
      if (ch && ch.name) nameToId[ch.name.trim()] = cid;
    }
    const charNamesInEvents = new Set();
    const evts = (snapshot.timeline && snapshot.timeline.events) || [];
    for (let i = 0; i < evts.length; i++) {
      const evt = evts[i];
      if (evt && evt.characters && typeof evt.characters === 'string') {
        evt.characters
          .split(/[/,、／]/)
          .map(function (n) {
            return n.trim();
          })
          .filter(Boolean)
          .forEach(function (n) {
            charNamesInEvents.add(n);
          });
      }
    }
    const missingTimelines = [];
    for (const name of charNamesInEvents) {
      const id = nameToId[name] || (charIds.has(name) ? name : null);
      if (id && !tlCharIds.includes(id)) missingTimelines.push(name + '(id=' + id + ')');
    }
    results.push(
      check(
        'F1',
        missingTimelines.length === 0,
        missingTimelines.length ? 'warning' : 'info',
        missingTimelines.length
          ? missingTimelines.length +
              ' 个在事件中出现的角色缺少时间线: ' +
              missingTimelines.join(', ')
          : '事件涉及的角色均有时间线',
        'P2-Stage5',
        'AI生成质量',
        missingTimelines.length ? { chars: missingTimelines } : null
      )
    );

    const cogOrderIssues = [],
      relOrderIssues = [],
      statusOrderIssues = [];
    const beforeBirthdayIssues = [],
      emotionStateIssues = [];
    const nonIdRelations = [],
      unknownIdRelations = [];

    for (let ci = 0; ci < tlCharIds.length; ci++) {
      const charId = tlCharIds[ci];
      const tl = ct[charId];
      if (!tl || typeof tl !== 'object') continue;

      let birthdayVal = 0;
      const bdStr = db && db[charId] && db[charId].birthday;
      if (bdStr && typeof bdStr === 'string' && bdStr !== 'null') {
        const bm = bdStr.match(/(\d+)\.(\d+)\.(\d+)/);
        if (bm) birthdayVal = +bm[1] * 10000 + +bm[2] * 100 + +bm[3];
      }

      const sections = ['cognitive', 'relationships', 'status'];
      for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        const entries = tl[section];
        if (!Array.isArray(entries)) continue;

        let prevVal = -1;
        for (let ei = 0; ei < entries.length; ei++) {
          const e = entries[ei];
          if (!e || typeof e !== 'object') continue;

          const year = e.year !== undefined ? e.year : e.time && e.time.year;
          const month = e.month !== undefined ? e.month : e.time && e.time.month;
          const day = e.day !== undefined ? e.day : e.time && e.time.day;
          if (year === undefined) continue;

          const val = dateToValue({ year: year, month: month, day: day });

          if (val < prevVal) {
            const bucket =
              section === 'cognitive'
                ? cogOrderIssues
                : section === 'relationships'
                  ? relOrderIssues
                  : statusOrderIssues;
            bucket.push(
              charId +
                '.' +
                section +
                '[' +
                ei +
                '] (' +
                year +
                '.' +
                (month || '?') +
                '.' +
                (day || '?') +
                ')'
            );
          }
          prevVal = val;

          if (birthdayVal > 0 && val < birthdayVal) {
            beforeBirthdayIssues.push(
              charId +
                '.' +
                section +
                '[' +
                ei +
                '] 时间(' +
                year +
                '.' +
                month +
                '.' +
                day +
                ') 早于生日'
            );
          }

          if (section === 'cognitive' && typeof e.state === 'string') {
            if (EMOTION_RE.test(e.state)) {
              emotionStateIssues.push(
                charId + '.cognitive[' + ei + ']: "' + e.state.substring(0, 40) + '"'
              );
            }
          }

          if (section === 'relationships' && e.relations && typeof e.relations === 'object') {
            for (const targetKey of Object.keys(e.relations)) {
              if (/[\u4e00-\u9fff]/.test(targetKey) && !charIds.has(targetKey)) {
                nonIdRelations.push(
                  charId + '.relationships[' + ei + '].relations 使用了中文名 "' + targetKey + '"'
                );
              } else if (!charIds.has(targetKey) && targetKey !== '_') {
                unknownIdRelations.push(
                  charId + '.relationships[' + ei + '].relations 引用了未知 ID "' + targetKey + '"'
                );
              }
            }
          }
        }
      }
    }

    results.push(
      check(
        'F2',
        cogOrderIssues.length === 0,
        cogOrderIssues.length ? 'error' : 'info',
        cogOrderIssues.length
          ? cogOrderIssues.length + ' 处 cognitive 时间非升序: ' + cogOrderIssues[0]
          : 'cognitive 时间升序正确',
        'P2-Stage5',
        'AI生成质量',
        cogOrderIssues.length ? { items: cogOrderIssues } : null
      )
    );

    results.push(
      check(
        'F3a',
        relOrderIssues.length === 0,
        relOrderIssues.length ? 'error' : 'info',
        relOrderIssues.length
          ? relOrderIssues.length + ' 处 relationships 时间非升序'
          : 'relationships 时间升序正确',
        'P2-Stage5',
        'AI生成质量',
        relOrderIssues.length ? { items: relOrderIssues } : null
      )
    );

    results.push(
      check(
        'F3b',
        statusOrderIssues.length === 0,
        statusOrderIssues.length ? 'error' : 'info',
        statusOrderIssues.length
          ? statusOrderIssues.length + ' 处 status 时间非升序'
          : 'status 时间升序正确',
        'P2-Stage5',
        'AI生成质量',
        statusOrderIssues.length ? { items: statusOrderIssues } : null
      )
    );

    results.push(
      check(
        'F4',
        beforeBirthdayIssues.length === 0,
        beforeBirthdayIssues.length ? 'error' : 'info',
        beforeBirthdayIssues.length
          ? beforeBirthdayIssues.length + ' 处时间线条目早于角色生日: ' + beforeBirthdayIssues[0]
          : '所有时间线条目均不早于角色生日',
        'P2-Stage5',
        'AI生成质量',
        beforeBirthdayIssues.length ? { items: beforeBirthdayIssues } : null
      )
    );

    results.push(
      check(
        'F5',
        emotionStateIssues.length === 0,
        emotionStateIssues.length ? 'warning' : 'info',
        emotionStateIssues.length
          ? emotionStateIssues.length +
              ' 处 cognitive.state 疑含情绪/态度描述（GAP-4）: ' +
              emotionStateIssues[0]
          : 'cognitive.state 无明显情绪/态度描述',
        'P2-Stage5',
        '缺失验证',
        emotionStateIssues.length ? { items: emotionStateIssues } : null
      )
    );

    results.push(
      check(
        'F6',
        nonIdRelations.length === 0,
        nonIdRelations.length ? 'error' : 'info',
        nonIdRelations.length
          ? nonIdRelations.length +
              ' 处 relationships.relations 使用中文名而非 ID（GAP-3）: ' +
              nonIdRelations[0]
          : 'relationships.relations 均使用角色 ID',
        'P2-Stage5',
        '缺失验证',
        nonIdRelations.length ? { items: nonIdRelations } : null
      )
    );

    results.push(
      check(
        'F7',
        unknownIdRelations.length === 0,
        unknownIdRelations.length ? 'warning' : 'info',
        unknownIdRelations.length
          ? unknownIdRelations.length +
              ' 处 relationships.relations 引用了未知 ID: ' +
              unknownIdRelations[0]
          : 'relationships.relations 所有 ID 有效',
        'P2-Stage5',
        '跨section不一致',
        unknownIdRelations.length ? { items: unknownIdRelations } : null
      )
    );

    return results;
  }

  // ============================================================
  // G — relationship_rules 关系规则
  // ============================================================
  function checkSectionG(snapshot) {
    const results = [];
    const rr = snapshot.relationship_rules;
    const charIds = new Set(getCharacterIds(snapshot.character_database));

    if (!rr || typeof rr !== 'object' || Array.isArray(rr)) {
      results.push(
        check(
          'G0',
          false,
          'error',
          'relationship_rules 缺失（auto-repair 会补充为空对象）',
          'auto-repair',
          '修复触发'
        )
      );
      return results;
    }

    const rrIds = Object.keys(rr).filter(function (k) {
      return !k.startsWith('_');
    });

    results.push(
      check(
        'G1',
        rrIds.length > 0,
        rrIds.length === 0 ? 'warning' : 'info',
        rrIds.length === 0
          ? 'relationship_rules 为空 {} — AI 未生成关系规则（GAP-5）。自定义卡在时间线首条 relationship 条目前将无默认关系（GAP-15）'
          : 'relationship_rules 有内容（' + rrIds.length + ' 个角色）',
        'auto-repair',
        '修复触发'
      )
    );

    if (rrIds.length === 0) return results;

    const unknownRrIds = rrIds.filter(function (id) {
      return !charIds.has(id);
    });
    results.push(
      check(
        'G2',
        unknownRrIds.length === 0,
        unknownRrIds.length ? 'error' : 'info',
        unknownRrIds.length
          ? 'relationship_rules 中有未知角色 ID: ' + unknownRrIds.join(', ')
          : '所有 relationship_rules ID 有效',
        'P2-Stage3',
        '跨section不一致',
        unknownRrIds.length ? { ids: unknownRrIds } : null
      )
    );

    const asymmetric = [];
    for (let i = 0; i < rrIds.length; i++) {
      const cid = rrIds[i];
      const rule = rr[cid];
      if (!rule || !rule.default) continue;
      for (const targetId of Object.keys(rule.default)) {
        if (charIds.has(targetId) && rrIds.includes(targetId)) {
          if (!rr[targetId] || !rr[targetId].default || !rr[targetId].default[cid]) {
            asymmetric.push(
              cid + '→' + targetId + ' 有关系，但 ' + targetId + '→' + cid + ' 未定义'
            );
          }
        }
      }
    }
    results.push(
      check(
        'G3',
        asymmetric.length === 0,
        asymmetric.length ? 'error' : 'info',
        asymmetric.length
          ? asymmetric.length +
              ' 处关系定义不对称（已由引擎自动补充为"未定义"，建议在 P3 阶段替换为实际描述）: ' +
              asymmetric[0]
          : '关系定义对称性良好',
        'P2-Stage5',
        '跨section不一致',
        asymmetric.length ? { items: asymmetric } : null
      )
    );

    return results;
  }

  // ============================================================
  // H — step3_fields 面板字段定义
  // ============================================================
  function checkSectionH(snapshot) {
    const results = [];
    const sf = snapshot.step3_fields;

    if (!sf || typeof sf !== 'object') {
      results.push(
        check('H0', false, 'fatal', 'step3_fields 缺失，跳过 H 类', 'P2-Stage2', 'AI生成质量')
      );
      return results;
    }

    const panelStatus = sf.panel_status;
    const panelNpc = sf.panel_npc;
    const wts = sf._worldTermsSource;

    results.push(
      check(
        'H1',
        Array.isArray(panelStatus) && panelStatus.length > 0,
        !Array.isArray(panelStatus) || panelStatus.length === 0 ? 'error' : 'info',
        !Array.isArray(panelStatus) || panelStatus.length === 0
          ? 'panel_status 缺失或为空数组'
          : 'panel_status 存在（' + panelStatus.length + ' 个分组）',
        'P2-Stage2',
        '缺失验证'
      )
    );

    results.push(
      check(
        'H2',
        Array.isArray(panelNpc) && panelNpc.length > 0,
        !Array.isArray(panelNpc) || panelNpc.length === 0 ? 'error' : 'info',
        !Array.isArray(panelNpc) || panelNpc.length === 0
          ? 'panel_npc 缺失或为空数组'
          : 'panel_npc 存在（' + panelNpc.length + ' 个字段）',
        'P2-Stage2',
        '缺失验证'
      )
    );

    if (!wts || typeof wts !== 'object') {
      results.push(check('H3', false, 'error', '_worldTermsSource 缺失', 'P2-Stage2', '缺失验证'));
      return results;
    }

    results.push(
      check(
        'H3',
        !!(wts.calendar_era && wts.calendar_era.trim()),
        wts.calendar_era && wts.calendar_era.trim() ? 'info' : 'error',
        wts.calendar_era && wts.calendar_era.trim()
          ? 'calendar_era = "' + wts.calendar_era + '"'
          : 'calendar_era 缺失或为空',
        'P2-Stage2',
        '缺失验证'
      )
    );

    results.push(
      check(
        'H4',
        !!(wts.currency_name && wts.currency_name.trim()),
        wts.currency_name && wts.currency_name.trim() ? 'info' : 'error',
        wts.currency_name && wts.currency_name.trim()
          ? 'currency_name = "' + wts.currency_name + '"'
          : 'currency_name 缺失或为空',
        'P2-Stage2',
        '缺失验证'
      )
    );

    results.push(
      check(
        'H5',
        wts.time_precision === REQUIRED_TIME_PRECISION,
        wts.time_precision === REQUIRED_TIME_PRECISION ? 'info' : 'error',
        wts.time_precision === REQUIRED_TIME_PRECISION
          ? 'time_precision = "time"'
          : 'time_precision 必须固定为 "time"，当前是 "' + wts.time_precision + '"',
        'P2-Stage2',
        '缺失验证'
      )
    );

    results.push(
      check(
        'H6a',
        Array.isArray(wts.calendar_units) && wts.calendar_units.length >= 3,
        Array.isArray(wts.calendar_units) && wts.calendar_units.length >= 3 ? 'info' : 'error',
        Array.isArray(wts.calendar_units)
          ? 'calendar_units = [' +
              wts.calendar_units.join(', ') +
              ']（' +
              wts.calendar_units.length +
              ' 项，要求 ≥3）'
          : 'calendar_units 缺失',
        'P2-Stage2',
        '缺失验证'
      )
    );

    results.push(
      check(
        'H6b',
        Array.isArray(wts.location_levels) && wts.location_levels.length >= 3,
        Array.isArray(wts.location_levels) && wts.location_levels.length >= 3 ? 'info' : 'error',
        Array.isArray(wts.location_levels)
          ? 'location_levels = [' +
              wts.location_levels.join(', ') +
              ']（' +
              wts.location_levels.length +
              ' 项，要求 ≥3）'
          : 'location_levels 缺失',
        'P2-Stage2',
        '缺失验证'
      )
    );

    if (Array.isArray(panelStatus) && wts.calendar_era) {
      const dtGroup = panelStatus.find(function (g) {
        return g.key === 'datetime' || g._template === 'time';
      });
      if (dtGroup) {
        const panelEra = dtGroup._era;
        results.push(
          check(
            'H7',
            panelEra === wts.calendar_era,
            panelEra === wts.calendar_era ? 'info' : 'error',
            panelEra === wts.calendar_era
              ? 'panel_status datetime._era 与 calendar_era 一致（"' + panelEra + '"）'
              : 'panel_status datetime._era("' +
                  panelEra +
                  '") 与 calendar_era("' +
                  wts.calendar_era +
                  '") 不一致（GAP-6，面板时间显示会出错）',
            'P2-Stage2',
            '跨section不一致'
          )
        );
      }
    }

    if (Array.isArray(panelStatus) && wts.currency_name) {
      const moneyGroup = panelStatus.find(function (g) {
        return g.key === 'money' || g._template === 'money';
      });
      if (moneyGroup) {
        const panelCurrency = moneyGroup._currency;
        results.push(
          check(
            'H8',
            panelCurrency === wts.currency_name,
            panelCurrency === wts.currency_name ? 'info' : 'error',
            panelCurrency === wts.currency_name
              ? 'panel_status money._currency 与 currency_name 一致（"' + panelCurrency + '"）'
              : 'panel_status money._currency("' +
                  panelCurrency +
                  '") 与 currency_name("' +
                  wts.currency_name +
                  '") 不一致（GAP-6）',
            'P2-Stage2',
            '跨section不一致'
          )
        );
      }
    }

    if (Array.isArray(panelStatus)) {
      const dtGroup = panelStatus.find(function (g) {
        return g.key === 'datetime' || g._template === 'time';
      });
      if (dtGroup && Array.isArray(dtGroup.fields)) {
        const yearField = dtGroup.fields.find(function (f) {
          return f.key === 'year';
        });
        if (
          yearField &&
          typeof yearField.label === 'string' &&
          /世纪|century/i.test(yearField.label)
        ) {
          const events = sf._worldTermsSource
            ? (snapshot.timeline && snapshot.timeline.events) || []
            : [];
          const eventYears = events
            .map(function (e) {
              return parseEventTime(e && e.time);
            })
            .filter(function (p) {
              return p && typeof p.year === 'number' && p.year > 0;
            })
            .map(function (p) {
              return p.year;
            });
          const maxEventYear = eventYears.length > 0 ? Math.max.apply(null, eventYears) : 0;
          const isMisleading = maxEventYear > 30;
          results.push(
            check(
              'H9',
              !isMisleading,
              isMisleading ? 'warning' : 'info',
              isMisleading
                ? 'year 字段标签为"' +
                    yearField.label +
                    '"，但世界实际年份值最高达 ' +
                    maxEventYear +
                    '，面板将显示"' +
                    maxEventYear +
                    yearField.label +
                    '"，疑似语义误导（建议改为"年份"或"纪年"）'
                : 'year 字段标签"' +
                    yearField.label +
                    '"与实际年份值（最高 ' +
                    maxEventYear +
                    '）语义相符',
              'P2-Stage2',
              'AI生成质量'
            )
          );
        }
      }
    }

    return results;
  }

  // ============================================================
  // I — 跨 Section 一致性
  // ============================================================
  function checkSectionI(snapshot) {
    const results = [];
    const db = snapshot.character_database;
    const ct = snapshot.character_timelines;
    const wts = snapshot.step3_fields && snapshot.step3_fields._worldTermsSource;
    const calendarEra = (wts && wts.calendar_era) || '';
    const charIds = new Set(getCharacterIds(db));

    if (ct && typeof ct === 'object') {
      const unknownCtIds = Object.keys(ct).filter(function (k) {
        return !k.startsWith('_') && !charIds.has(k);
      });
      results.push(
        check(
          'I1',
          unknownCtIds.length === 0,
          unknownCtIds.length ? 'error' : 'info',
          unknownCtIds.length
            ? 'character_timelines 中有 ' +
                unknownCtIds.length +
                ' 个未知角色 ID: ' +
                unknownCtIds.join(', ')
            : 'character_timelines ID 均存在于 character_database',
          'P2-Stage5',
          '跨section不一致',
          unknownCtIds.length ? { ids: unknownCtIds } : null
        )
      );
    }

    results.push(
      check(
        'I3',
        true,
        'info',
        'timeline.events.location 为自由文本（引擎不做实体 ID 约束，GAP-2 已确认）',
        'P2-Stage4',
        '跨section不一致',
        null
      )
    );

    if (db && typeof db === 'object') {
      const badBdFormat = [];
      for (const cid of charIds) {
        const bd = db[cid] && db[cid].birthday;
        if (!bd || bd === null || typeof bd !== 'string') continue;
        if (!/^\D*\d+\.\d+\.\d+$/.test(bd.trim())) {
          badBdFormat.push(cid + ': "' + bd + '"');
        }
      }
      results.push(
        check(
          'I4',
          badBdFormat.length === 0,
          badBdFormat.length ? 'error' : 'info',
          badBdFormat.length
            ? badBdFormat.length + ' 个 birthday 格式不符合 纪年.年.月.日: ' + badBdFormat[0]
            : 'birthday 格式与时间精度一致',
          'P2-Stage3',
          '跨section不一致',
          badBdFormat.length ? { items: badBdFormat } : null
        )
      );
    }

    const og = snapshot.prompt_modules && snapshot.prompt_modules.opening_greeting;
    if (og && typeof og === 'string' && calendarEra) {
      const hasTimeHint =
        og.includes(calendarEra) &&
        /(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+\s+\d{2}:\d{2}/.test(og);
      results.push(
        check(
          'I5',
          hasTimeHint,
          hasTimeHint ? 'info' : 'fatal',
          hasTimeHint
            ? 'opening_greeting 包含完整纪年与 HH:MM 示例'
            : 'opening_greeting 缺少纪年 "' + calendarEra + '" 或完整 HH:MM 时间示例（格式：纪年YYYY.MM.DD HH:MM）',
          'P2-Stage2',
          '跨section不一致'
        )
      );
    }

    if (og && typeof og === 'string') {
      const tlEvents = (snapshot.timeline && snapshot.timeline.events) || [];
      const parsedYears = tlEvents
        .map(function (e) {
          const t = e && e.time;
          if (!t || (typeof t === 'string' && /^Pre-/i.test(t))) return null;
          const p = parseEventTime(t);
          return p ? p.year : null;
        })
        .filter(function (y) {
          return typeof y === 'number' && y > 0;
        })
        .sort(function (a, b) {
          return a - b;
        });

      if (parsedYears.length > 0) {
        const maxRefYear = parsedYears[parsedYears.length - 1];
        const ogYearMatches = (og.match(/\b\d{3,4}\b/g) || []).map(Number).filter(function (y) {
          return y >= 100;
        });
        const overflowYears = ogYearMatches.filter(function (y) {
          return y > maxRefYear + 50;
        });

        if (overflowYears.length > 0) {
          results.push(
            check(
              'I5b',
              false,
              'warning',
              'opening_greeting 时间示例（' +
                overflowYears.join('、') +
                '）超出时间线末段参考年份（' +
                maxRefYear +
                '）约 ' +
                (Math.max.apply(null, overflowYears) - maxRefYear) +
                ' 年，引擎将自动替换（GAP-7）',
              'P2-Stage2',
              '跨section不一致',
              { overflowYears: overflowYears, maxRefYear: maxRefYear }
            )
          );
        } else if (ogYearMatches.length > 0) {
          results.push(
            check(
              'I5b',
              true,
              'info',
              'opening_greeting 年份示例（' +
                ogYearMatches.join('、') +
                '）未超出时间线末段（末年 ' +
                maxRefYear +
                '）',
              'P2-Stage2',
              '跨section不一致'
            )
          );
        }
      }
    }

    if (ct && typeof ct === 'object') {
      const nonIdIssues = [];
      const ctKeys = Object.keys(ct).filter(function (k) {
        return !k.startsWith('_');
      });
      for (let ki = 0; ki < ctKeys.length; ki++) {
        const cid = ctKeys[ki];
        const relTimeline = ct[cid] && ct[cid].relationships;
        if (!Array.isArray(relTimeline)) continue;
        for (let ri = 0; ri < relTimeline.length; ri++) {
          const entry = relTimeline[ri];
          if (!entry || !entry.relations) continue;
          for (const key of Object.keys(entry.relations)) {
            if (/[\u4e00-\u9fff]/.test(key) && !charIds.has(key)) {
              nonIdIssues.push(cid + '.relationships[' + ri + ']: 使用了中文名 "' + key + '"');
            }
          }
        }
      }
      results.push(
        check(
          'I6',
          nonIdIssues.length === 0,
          nonIdIssues.length ? 'error' : 'info',
          nonIdIssues.length
            ? nonIdIssues.length +
                ' 处 relationships.relations 使用了中文名而非角色 ID（GAP-3，运行时查找会失败）'
            : 'relationships.relations 均使用角色 ID',
          'P2-Stage5',
          '缺失验证',
          nonIdIssues.length ? { items: nonIdIssues } : null
        )
      );
    }

    if (ct && typeof ct === 'object' && 'relationship_rules' in ct) {
      results.push(
        check(
          'I7',
          false,
          'error',
          'character_timelines 内部残留了 relationship_rules 键（Stage 5 提取逻辑失效，顶层关系规则会被空 {} 覆盖）',
          'P2-Stage5',
          '跨section不一致'
        )
      );
    } else {
      results.push(
        check(
          'I7',
          true,
          'info',
          'character_timelines 内部无 relationship_rules 残留',
          'P2-Stage5',
          '跨section不一致'
        )
      );
    }

    return results;
  }

  // ============================================================
  // J — 自动修复触发追踪
  // ============================================================
  function checkSectionJ(snapshot) {
    const results = [];
    const wts = snapshot.step3_fields && snapshot.step3_fields._worldTermsSource;
    const calendarEra = (wts && wts.calendar_era) || '';

    const rr = snapshot.relationship_rules;
    const rrIds = rr
      ? Object.keys(rr).filter(function (k) {
          return !k.startsWith('_');
        })
      : [];
    results.push(
      check(
        'J1',
        rrIds.length > 0,
        rrIds.length === 0 ? 'warning' : 'info',
        rrIds.length === 0
          ? '【修复触发-J1】relationship_rules 为空对象，由系统自动补充 {}（AI 未生成关系规则，GAP-5/GAP-15）'
          : 'relationship_rules 由 AI 原生生成（' + rrIds.length + ' 个角色）',
        'auto-repair',
        '修复触发'
      )
    );

    const events = (snapshot.timeline && snapshot.timeline.events) || [];
    const missingIdEvents = events.filter(function (e) {
      return !e || !e.id;
    });
    const autoIdEvents = events.filter(function (e) {
      return e && e.id && /^evt_\d{3,}$/.test(e.id);
    });
    if (missingIdEvents.length > 0) {
      results.push(
        check(
          'J2',
          false,
          'warning',
          '【修复触发-J2】' +
            missingIdEvents.length +
            ' 个事件缺少 id 字段，将由系统自动生成 evt_NNN',
          'auto-repair',
          '修复触发'
        )
      );
    } else if (events.length > 0 && autoIdEvents.length === events.length) {
      results.push(
        check(
          'J2',
          false,
          'warning',
          '【修复触发-J2】所有 ' +
            events.length +
            ' 个事件 ID 均为 evt_NNN 格式——AI 可能未输出 id，由系统统一补充',
          'auto-repair',
          '修复触发'
        )
      );
    } else {
      results.push(
        check(
          'J2',
          true,
          'info',
          'timeline.events id 字段由 AI 原生生成',
          'auto-repair',
          '修复触发'
        )
      );
    }

    results.push(
      check(
        'J3',
        true,
        'info',
        '角色时间线排序请参见 F2/F3 类检测结果（如有 error 则触发自动排序修复）',
        'auto-repair',
        '修复触发'
      )
    );

    const db = snapshot.character_database;
    const charIds = getCharacterIds(db);
    const birthdayRepairNeeded = [];
    for (let ci = 0; ci < charIds.length; ci++) {
      const cid = charIds[ci];
      const ch = db[cid];
      if (!ch) continue;
      if (ch.birthday === '' || ch.birthday === 'null') {
        birthdayRepairNeeded.push(cid + ': birthday="' + ch.birthday + '" 会被自动修复为 null');
      }
    }
    results.push(
      check(
        'J4',
        birthdayRepairNeeded.length === 0,
        birthdayRepairNeeded.length ? 'warning' : 'info',
        birthdayRepairNeeded.length
          ? '【修复触发-J4】' +
              birthdayRepairNeeded.length +
              ' 个 birthday 将被自动修复: ' +
              birthdayRepairNeeded.join('; ')
          : 'birthday 字段无需自动修复',
        'auto-repair',
        '修复触发',
        birthdayRepairNeeded.length ? { items: birthdayRepairNeeded } : null
      )
    );

    const og = snapshot.prompt_modules && snapshot.prompt_modules.opening_greeting;
    if (og && calendarEra && !og.includes(calendarEra)) {
      results.push(
        check(
          'J5',
          false,
          'warning',
          '【修复触发-J5】opening_greeting 未包含纪年 "' +
            calendarEra +
            '"，可能被自动改写时间示例（GAP-7）',
          'auto-repair',
          '修复触发'
        )
      );
    } else {
      results.push(
        check(
          'J5',
          true,
          'info',
          'opening_greeting 时间示例无需自动改写',
          'auto-repair',
          '修复触发'
        )
      );
    }

    if (snapshot.prompt_modules && snapshot.prompt_modules.npc_fields !== undefined) {
      results.push(
        check(
          'J6',
          false,
          'warning',
          '【修复触发-J6】prompt_modules 中存在 npc_fields，将被自动清理（AI 写错了位置）',
          'auto-repair',
          '修复触发'
        )
      );
    }

    return results;
  }

  // ============================================================
  // K — 纪年/术语一致性
  // ============================================================
  function checkSectionK(snapshot) {
    const results = [];
    const db = snapshot.character_database;
    const wts = snapshot.step3_fields && snapshot.step3_fields._worldTermsSource;
    const calendarEra = (wts && wts.calendar_era) || '';
    const charIds = getCharacterIds(db);

    if (!calendarEra) {
      results.push(
        check(
          'K0',
          false,
          'warning',
          'calendar_era 未定义，跳过 K 类纪年一致性检测',
          'P2-Stage2',
          'AI生成质量'
        )
      );
      return results;
    }

    const wrongEraInBd = [];
    for (let ci = 0; ci < charIds.length; ci++) {
      const cid = charIds[ci];
      const bd = db && db[cid] && db[cid].birthday;
      if (!bd || bd === null || typeof bd !== 'string') continue;
      const era = extractEraPrefix(bd);
      if (era && era !== calendarEra) {
        wrongEraInBd.push(cid + ': 纪年 "' + era + '"（期望 "' + calendarEra + '"）');
      }
    }
    results.push(
      check(
        'K1',
        wrongEraInBd.length === 0,
        wrongEraInBd.length ? 'error' : 'info',
        wrongEraInBd.length
          ? wrongEraInBd.length + ' 个 birthday 纪年名与 calendar_era 不一致: ' + wrongEraInBd[0]
          : 'birthday 纪年名均一致',
        'P2-Stage3',
        'AI生成质量',
        wrongEraInBd.length ? { items: wrongEraInBd } : null
      )
    );

    const events = (snapshot.timeline && snapshot.timeline.events) || [];
    const wrongEraInEvents = [];
    for (let ei = 0; ei < events.length; ei++) {
      const time = events[ei] && events[ei].time;
      if (!time || typeof time !== 'string' || time.startsWith('Pre-')) continue;
      const era = extractEraPrefix(time);
      if (era && era !== calendarEra) {
        wrongEraInEvents.push('事件[' + ei + '] time="' + time + '"（纪年 "' + era + '"）');
      }
    }
    results.push(
      check(
        'K2',
        wrongEraInEvents.length === 0,
        wrongEraInEvents.length ? 'error' : 'info',
        wrongEraInEvents.length
          ? wrongEraInEvents.length +
              ' 个事件 time 纪年名与 calendar_era 不一致: ' +
              wrongEraInEvents[0]
          : 'timeline.events.time 纪年名均一致',
        'P2-Stage4',
        'AI生成质量',
        wrongEraInEvents.length ? { items: wrongEraInEvents } : null
      )
    );

    const ERA_NAME_RE = /[\u4e00-\u9fff]{1,6}(?:历|纪元|历元)/g;
    const ERA_PREFIX_STRIP_RE = /^[以在于从自用按依照]/;
    const ERA_SUFFIX_EXCLUDE_RE = /[史来中上下的]/;
    const NON_ERA_TERMS = new Set(['经历', '刚刚经历', '来历', '履历']);

    function extractEraNames(text) {
      const found = new Set();
      let m;
      ERA_NAME_RE.lastIndex = 0;
      while ((m = ERA_NAME_RE.exec(text)) !== null) {
        let era = m[0];
        const afterIdx = m.index + era.length;
        if (afterIdx < text.length && ERA_SUFFIX_EXCLUDE_RE.test(text[afterIdx])) continue;
        era = era.replace(ERA_PREFIX_STRIP_RE, '');
        if (NON_ERA_TERMS.has(era)) continue;
        if (era.length >= 2) found.add(era);
      }
      return Array.from(found);
    }

    const og = snapshot.prompt_modules && snapshot.prompt_modules.opening_greeting;
    if (og && typeof og === 'string') {
      const erasInOg = extractEraNames(og);
      const wrongEras = erasInOg.filter(function (e) {
        return e !== calendarEra;
      });
      results.push(
        check(
          'K3',
          wrongEras.length === 0,
          wrongEras.length ? 'warning' : 'info',
          wrongEras.length
            ? 'opening_greeting 中出现与 calendar_era 不同的纪年名: ' +
                wrongEras.join(', ') +
                '（期望 "' +
                calendarEra +
                '"）'
            : 'opening_greeting 纪年名一致',
          'P2-Stage2',
          'AI生成质量'
        )
      );
    }

    const moduleTexts = snapshot.prompt_modules && snapshot.prompt_modules.modules;
    if (moduleTexts && typeof moduleTexts === 'object') {
      const wrongEraInModules = [];
      for (const modId of Object.keys(moduleTexts)) {
        const content = moduleTexts[modId];
        if (typeof content !== 'string' || modId.startsWith('_')) continue;
        const eras = extractEraNames(content);
        const bad = eras.filter(function (e) {
          return e !== calendarEra;
        });
        for (let bi = 0; bi < bad.length; bi++) {
          wrongEraInModules.push(modId + ': "' + bad[bi] + '"');
        }
      }
      results.push(
        check(
          'K3b',
          wrongEraInModules.length === 0,
          wrongEraInModules.length ? 'warning' : 'info',
          wrongEraInModules.length
            ? wrongEraInModules.length +
                ' 处模块内容出现与 calendar_era 不同的纪年名（期望 "' +
                calendarEra +
                '"）: ' +
                wrongEraInModules.join(', ')
            : '所有模块内纪年名一致',
          'P2-Stage2',
          'AI生成质量',
          wrongEraInModules.length ? { items: wrongEraInModules } : null
        )
      );
    }

    const chinesePeriodBds = charIds
      .filter(function (id) {
        return typeof db[id].birthday === 'string' && db[id].birthday.includes('。');
      })
      .map(function (id) {
        return id + ': "' + db[id].birthday + '"';
      });
    results.push(
      check(
        'K4',
        chinesePeriodBds.length === 0,
        chinesePeriodBds.length ? 'error' : 'info',
        chinesePeriodBds.length
          ? chinesePeriodBds.length + ' 个 birthday 使用了中文句号作分隔: ' + chinesePeriodBds[0]
          : 'birthday 分隔符均为英文句号',
        'P2-Stage3',
        'AI生成质量'
      )
    );

    const badDayInK = events
      .map(function (e, i) {
        return e &&
          e.day &&
          typeof e.day === 'string' &&
          (!VALID_DAY_RE.test(e.day) || e.day === '无日期')
          ? '事件[' + i + '] day="' + e.day + '"'
          : null;
      })
      .filter(Boolean);
    results.push(
      check(
        'K5',
        badDayInK.length === 0,
        badDayInK.length ? 'warning' : 'info',
        badDayInK.length
          ? badDayInK.length + ' 个事件 day 字段格式非法: ' + badDayInK[0]
          : 'timeline.events.day 格式规范',
        'P2-Stage4',
        'AI生成质量'
      )
    );

    const positiveEventYears = events
      .map(function (event) {
        return parseEventTime(event && event.time);
      })
      .filter(function (parsed) {
        return parsed && Number.isFinite(parsed.year) && parsed.year > 0;
      })
      .map(function (parsed) {
        return parsed.year;
      });
    const explicitEraYearOutliers = [];
    if (positiveEventYears.length >= 3) {
      const minPositiveYear = Math.min.apply(null, positiveEventYears);
      const maxPositiveYear = Math.max.apply(null, positiveEventYears);
      const tolerance = Math.max(Math.ceil((maxPositiveYear - minPositiveYear) * 0.25), 200);
      const eraYearRe = new RegExp(
        escapeRegExp(calendarEra) + '([0-9零〇一二三四五六七八九十百千万两元]{1,12})年',
        'g'
      );
      const historicalHintRe = /上古|远古|中古|史前|久远|古卷|纪元开启|修真纪元|元年/;

      function collectEraYearOutliers(text, sourceLabel) {
        if (!text || typeof text !== 'string') return;
        let match;
        eraYearRe.lastIndex = 0;
        while ((match = eraYearRe.exec(text)) !== null) {
          const token = match[1];
          const parsedYear = parseEraYearToken(token);
          if (!Number.isFinite(parsedYear) || token === '元') continue;
          const context = text.slice(
            Math.max(0, match.index - 10),
            Math.min(text.length, eraYearRe.lastIndex + 10)
          );
          if (historicalHintRe.test(context) || /年\s*前/.test(context) || /年前/.test(context)) {
            continue;
          }
          if (parsedYear < minPositiveYear - tolerance || parsedYear > maxPositiveYear + tolerance) {
            explicitEraYearOutliers.push(
              sourceLabel + ': "' + calendarEra + token + '年" 超出主时间线范围'
            );
          }
        }
      }

      const settings = snapshot.world_setting && snapshot.world_setting.settings;
      if (settings && typeof settings === 'object') {
        Object.keys(settings).forEach(function (entityId) {
          collectEraYearOutliers(settings[entityId], 'world_setting.' + entityId);
        });
      }

      const moduleTextsForEraYear = snapshot.prompt_modules && snapshot.prompt_modules.modules;
      if (moduleTextsForEraYear && typeof moduleTextsForEraYear === 'object') {
        Object.keys(moduleTextsForEraYear).forEach(function (moduleId) {
          if (moduleId.startsWith('_')) return;
          collectEraYearOutliers(
            moduleTextsForEraYear[moduleId],
            'prompt_modules.' + moduleId
          );
        });
      }

      collectEraYearOutliers(snapshot.timeline && snapshot.timeline._summary, 'timeline._summary');

      results.push(
        check(
          'K5b',
          explicitEraYearOutliers.length === 0,
          explicitEraYearOutliers.length ? 'error' : 'info',
          explicitEraYearOutliers.length
            ? explicitEraYearOutliers.length +
                ' 处正文显式纪年超出主时间线范围（期望接近 "' +
                calendarEra +
                minPositiveYear +
                ' - ' +
                calendarEra +
                maxPositiveYear +
                '"）: ' +
                explicitEraYearOutliers[0]
            : '正文显式纪年与主时间线范围一致',
          'P2-Stage2',
          '跨section不一致',
          explicitEraYearOutliers.length ? { items: explicitEraYearOutliers } : null
        )
      );
    } else {
      results.push(
        check(
          'K5b',
          true,
          'info',
          '主时间线样本不足，跳过正文显式纪年离群检测',
          'P2-Stage2',
          '跨section不一致'
        )
      );
    }

    const nameCount = {};
    for (let ci = 0; ci < charIds.length; ci++) {
      const name = db[charIds[ci]] && db[charIds[ci]].name;
      if (name) nameCount[name] = (nameCount[name] || 0) + 1;
    }
    const dupNames = Object.entries(nameCount)
      .filter(function (e) {
        return e[1] > 1;
      })
      .map(function (e) {
        return e[0];
      });
    results.push(
      check(
        'K6',
        dupNames.length === 0,
        dupNames.length ? 'warning' : 'info',
        dupNames.length
          ? dupNames.length +
              ' 个重复角色名（GAP-14，同名角色会导致 timelineService 名字→ID 映射错误）: ' +
              dupNames.join(', ')
          : '所有角色名唯一',
        'P2-Stage3',
        'AI生成质量',
        dupNames.length ? { names: dupNames } : null
      )
    );

    // K7: world_setting [Narrative_Core] 章节人名 vs character_database
    const charNameSet = new Set(
      charIds
        .map(function (id) {
          return db[id] && db[id].name;
        })
        .filter(Boolean)
    );
    const narrativeCoreRE = /###\s*第五章[^\n]*\[Narrative_Core\]([\s\S]*?)(?=###|$)/i;
    const dotNameRE = /[\u4e00-\u9fff]{1,4}(?:[·•][\u4e00-\u9fff]{1,4})+/g;
    const quotedNameREK7 =
      /[\u201c\u201d\u0022\u300c]([^\u201c\u201d\u0022\u300d]{2,8})[\u201c\u201d\u0022\u300d]/g;
    const parenNameRE = /([\u4e00-\u9fff]{2,6})（[A-Za-z][\w\s]*?）/g;

    function _extractDotName(raw, nameSet) {
      const sep = raw.includes('·') ? '·' : '•';
      const parts = raw.split(/[·•]/);
      for (let startSeg = 0; startSeg < parts.length; startSeg++) {
        const firstSeg = parts[startSeg];
        for (let leftTrim = 0; leftTrim <= firstSeg.length - 1; leftTrim++) {
          for (let endSeg = parts.length - 1; endSeg >= startSeg + 1; endSeg--) {
            const lastSeg = parts[endSeg];
            for (let rightTrim = 0; rightTrim <= lastSeg.length - 1; rightTrim++) {
              const middle = parts.slice(startSeg + 1, endSeg);
              const candidate = [firstSeg.slice(leftTrim)]
                .concat(middle, [lastSeg.slice(0, lastSeg.length - rightTrim)])
                .join(sep);
              if (nameSet.has(candidate)) return candidate;
            }
          }
        }
      }
      return raw;
    }

    const worldTermsForK7 = new Set(
      [wts && wts.currency_name, wts && wts.calendar_era]
        .concat((wts && wts.location_levels) || [], (wts && wts.calendar_units) || [])
        .filter(Boolean)
    );

    const panelNpcK7 = snapshot.step3_fields && snapshot.step3_fields.panel_npc;
    if (Array.isArray(panelNpcK7)) {
      for (let pi = 0; pi < panelNpcK7.length; pi++) {
        const f = panelNpcK7[pi];
        if (Array.isArray(f && f.enum))
          f.enum.forEach(function (v) {
            worldTermsForK7.add(v);
          });
      }
    }
    const nonNameFilterRE =
      /议会|联盟|帝国|王国|组织|公会|门派|宗门|势力|部落|城邦|学院|教廷|贫民|工业|废弃|矿区|阵列|病毒|装置|协议|系统|矩阵|武器|载具|芯片|模块|引擎|网络|方程|算法|结界|禁术|封印|药剂|符文|卷轴|遗迹|图|论|计划|行动|代号|余烬|清肃|节点|碎片|密钥|卷宗|手册|宝典|预言|仪式|秘术|隐修会|修道院|骑士团|商会|工坊/;

    const CONCEPT_QUOTE_RE_K =
      /[\u201c\u201d\u0022\u300c\u2018\u2019]([^\u201c\u201d\u0022\u300d\u2018\u2019]{2,8})[\u201c\u201d\u0022\u300d\u2018\u2019]/g;
    const worldConceptTerms = new Set();
    const ws = snapshot.world_setting;
    if (ws && ws.settings) {
      for (const text of Object.values(ws.settings)) {
        if (typeof text !== 'string') continue;
        CONCEPT_QUOTE_RE_K.lastIndex = 0;
        for (const m of text.matchAll(CONCEPT_QUOTE_RE_K)) {
          worldConceptTerms.add(m[1].trim());
        }
      }
      const tlEvts = (snapshot.timeline && snapshot.timeline.events) || [];
      for (let ei = 0; ei < tlEvts.length; ei++) {
        const evt = tlEvts[ei];
        if (evt && evt.content && typeof evt.content === 'string') {
          CONCEPT_QUOTE_RE_K.lastIndex = 0;
          for (const m of evt.content.matchAll(CONCEPT_QUOTE_RE_K)) {
            worldConceptTerms.add(m[1].trim());
          }
        }
      }
    }
    for (const cname of charNameSet) {
      worldConceptTerms.delete(cname);
    }

    const narrativeMismatches = [];
    if (ws && ws.settings) {
      for (const entityId of Object.keys(ws.settings)) {
        const text = ws.settings[entityId];
        if (typeof text !== 'string') continue;
        const chapterMatch = text.match(narrativeCoreRE);
        if (!chapterMatch) continue;
        const chapterText = chapterMatch[1];
        const foundNames = new Set();

        const dotNames = new Set();
        dotNameRE.lastIndex = 0;
        for (const m of chapterText.matchAll(dotNameRE)) {
          const dn = _extractDotName(m[0], charNameSet);
          foundNames.add(dn);
          dotNames.add(dn);
        }
        quotedNameREK7.lastIndex = 0;
        for (const m of chapterText.matchAll(quotedNameREK7)) {
          const qn = m[1].trim();
          if (qn.length >= 2 && /[\u4e00-\u9fff]/.test(qn)) foundNames.add(qn);
        }
        parenNameRE.lastIndex = 0;
        for (const m of chapterText.matchAll(parenNameRE)) {
          const pName = m[1];
          let isSubOfDot = false;
          for (const dn of dotNames) {
            if (dn.includes(pName)) {
              isSubOfDot = true;
              break;
            }
          }
          if (!isSubOfDot) foundNames.add(pName);
        }

        for (const name of foundNames) {
          if (charNameSet.has(name)) continue;
          if (worldTermsForK7.has(name)) continue;
          if (worldConceptTerms.has(name)) continue;
          if (nonNameFilterRE.test(name)) continue;
          narrativeMismatches.push(
            '实体[' + entityId + ']第五章提及"' + name + '"但 character_database 中无此角色'
          );
        }
      }
    }
    results.push(
      check(
        'K7',
        narrativeMismatches.length === 0,
        narrativeMismatches.length ? 'warning' : 'info',
        narrativeMismatches.length
          ? narrativeMismatches.length +
              ' 处 world_setting 第五章人名与 character_database 不匹配（跨阶段角色名幻觉）: ' +
              narrativeMismatches[0]
          : 'world_setting [Narrative_Core] 章节人名与 character_database 一致',
        'P2-Stage3',
        '跨section不一致',
        narrativeMismatches.length ? { items: narrativeMismatches } : null
      )
    );

    // K8: prompt_modules.init 中人名 vs character_database
    const initText =
      snapshot.prompt_modules &&
      snapshot.prompt_modules.modules &&
      typeof snapshot.prompt_modules.modules.init === 'string'
        ? snapshot.prompt_modules.modules.init
        : '';
    const initNameMismatches = [];
    if (initText && charNameSet.size > 0) {
      const boldNameRE = /\*\*([\u4e00-\u9fff]{2,6}(?:[·•][\u4e00-\u9fff]{1,4})*)\*\*/g;
      let boldNames = [];
      boldNameRE.lastIndex = 0;
      for (const m of initText.matchAll(boldNameRE)) {
        boldNames.push(m[1]);
      }
      boldNames = Array.from(new Set(boldNames));

      const quotedNameREK8 =
        /[\u201c"]([\u4e00-\u9fff]{2,6}(?:[·•][\u4e00-\u9fff]{1,4})*)[\u201d"]/g;
      let quotedNames = [];
      quotedNameREK8.lastIndex = 0;
      for (const m of initText.matchAll(quotedNameREK8)) {
        quotedNames.push(m[1]);
      }
      quotedNames = Array.from(new Set(quotedNames));

      const allInitNames = Array.from(new Set(boldNames.concat(quotedNames)));
      const nonNameKeywords =
        /议会|之眼|协会|联盟|帝国|王国|阵营|组织|公会|门派|宗门|势力|部落|城邦|城市|学院|教廷|枢纽|贫民|工业|废弃|矿区|天穹|地层|上城|下城|中层|底层|地标|区域|[币元点石圈轮]|何时|可用|禁用|禁止|警告|使用|说明|注意|提示|重要|关键|限制|约束|绑定|允许|触发|格式|规则|配置|设定|初始|条件|生成|确认|绑绑|降临|开局|开始|结算|退化|过载|损耗|隐修会|修道院|骑士团|商会|工坊|铸造|浮空|核心|感应|共鸣|实体列表|图|论|计划|行动|代号|余烬|清肃|节点|碎片|密钥|卷宗|港|码头|边缘|城门|广场|大厅|街道|市场|酒馆|仓库|要塞|堡垒|山谷|峡谷|深渊|遗址|回复|范式|要求|标准行|独立成行|写法|写法要求|逻辑|信息|剧情|背景|时间|地点|分支|处理|声明|列表|结果|阶段|内容|玩家|第一条|第二条|过度使用警告|第一条回复|初始地点|硬要求|示例|下品灵石|类型识别|交通类|生活类|边缘类|自检规则|沉浸优先|玩家记忆状态|系统化定义|选择题菜单|系统奖励|转职|随便|客栈类|客栈醒来|核心大城|经验槽|爆率/;

      const wtsK8 = snapshot.step3_fields && snapshot.step3_fields._worldTermsSource;
      const knownWorldTerms = new Set(
        [wtsK8 && wtsK8.currency_name, wtsK8 && wtsK8.calendar_era]
          .concat((wtsK8 && wtsK8.location_levels) || [], (wtsK8 && wtsK8.calendar_units) || [])
          .filter(Boolean)
      );

      const wsSummary = (snapshot.world_setting && snapshot.world_setting._summary) || '';
      const wsSettings = (snapshot.world_setting && snapshot.world_setting.settings) || {};
      const entityTitleRE = ENTITY_TITLE_RE;
      for (const stext of Object.values(wsSettings)) {
        if (typeof stext !== 'string') continue;
        entityTitleRE.lastIndex = 0;
        for (const m of stext.matchAll(entityTitleRE)) {
          knownWorldTerms.add(m[1].trim());
        }
      }
      const summaryTermRE =
        /[\u4e00-\u9fff]{2,6}(?:公会|联盟|帝国|王国|隐修会|骑士团|组织|势力|部落|教廷|学院|商会|门派)/g;
      summaryTermRE.lastIndex = 0;
      for (const m of wsSummary.matchAll(summaryTermRE)) {
        knownWorldTerms.add(m[0]);
      }

      for (let ni = 0; ni < allInitNames.length; ni++) {
        const iname = allInitNames[ni];
        if (nonNameKeywords.test(iname)) continue;
        if (knownWorldTerms.has(iname)) continue;
        if (charNameSet.has(iname)) continue;
        if (worldConceptTerms.has(iname)) continue;
        const format = boldNames.includes(iname) ? '**' + iname + '**' : '"' + iname + '"';
        initNameMismatches.push('init 中出现 ' + format + ' 但 character_database 中无此角色');
      }
    }
    results.push(
      check(
        'K8',
        initNameMismatches.length === 0,
        initNameMismatches.length ? 'error' : 'info',
        initNameMismatches.length
          ? initNameMismatches.length +
              ' 处 init 模块人名与 character_database 不匹配（Stage 2 角色名幻觉）: ' +
              initNameMismatches[0]
          : 'init 模块人名（加粗+引号格式）均存在于 character_database',
        'P2-Stage2',
        '跨section不一致',
        initNameMismatches.length ? { items: initNameMismatches } : null
      )
    );

    // K9: panel_npc enum 字段值 vs character_database
    const panelNpcK9 = snapshot.step3_fields && snapshot.step3_fields.panel_npc;
    if (Array.isArray(panelNpcK9) && db) {
      const enumFields = panelNpcK9.filter(function (f) {
        return f && f.fixed !== true && Array.isArray(f.enum) && typeof f.key === 'string';
      });
      const enumViolations = [];
      for (let fi = 0; fi < enumFields.length; fi++) {
        const field = enumFields[fi];
        const allowed = new Set();
        for (const ev of field.enum) {
          allowed.add(ev);
          if (typeof ev === 'string' && ev.includes('/')) {
            for (const part of ev.split('/').map(function (s) { return s.trim(); }).filter(Boolean)) {
              allowed.add(part);
            }
          }
        }
        for (let ci = 0; ci < charIds.length; ci++) {
          const cid = charIds[ci];
          const ch = db[cid];
          if (!ch || typeof ch !== 'object') continue;
          const val = ch[field.key];
          if (val !== undefined && val !== null && !allowed.has(val)) {
            enumViolations.push(
              cid + '.' + field.key + '="' + val + '" 不在 enum [' + field.enum.join(', ') + '] 中'
            );
          }
        }
      }
      results.push(
        check(
          'K9',
          enumViolations.length === 0,
          enumViolations.length ? 'error' : 'info',
          enumViolations.length
            ? enumViolations.length +
                ' 个角色字段值不在 panel_npc enum 范围内: ' +
                enumViolations[0]
            : 'character_database 字段值均在 panel_npc enum 范围内',
          'P2-Stage3',
          '跨section不一致',
          enumViolations.length ? { items: enumViolations } : null
        )
      );
    }

    // K10: extra_char_fields vs panel_npc
    const wtsK10 = snapshot.step3_fields && snapshot.step3_fields._worldTermsSource;
    const panelNpcK10 = snapshot.step3_fields && snapshot.step3_fields.panel_npc;
    if (wtsK10 && Array.isArray(panelNpcK10)) {
      const ecfKeys = new Set(
        Array.isArray(wtsK10.extra_char_fields)
          ? wtsK10.extra_char_fields
              .map(function (f) {
                return f && f.key;
              })
              .filter(Boolean)
          : []
      );
      const STANDARD_NONFIXED_KEYS = new Set(['personality', 'appearance', 'clothing']);
      const panelAiKeys = new Set(
        panelNpcK10
          .filter(function (f) {
            return (
              f &&
              f.fixed !== true &&
              typeof f.key === 'string' &&
              !STANDARD_NONFIXED_KEYS.has(f.key)
            );
          })
          .map(function (f) {
            return f.key;
          })
      );
      const onlyInEcf = Array.from(ecfKeys).filter(function (k) {
        return !panelAiKeys.has(k);
      });
      const onlyInPanel = Array.from(panelAiKeys).filter(function (k) {
        return !ecfKeys.has(k);
      });
      const diffs = onlyInEcf
        .map(function (k) {
          return '"' + k + '" 仅在 extra_char_fields';
        })
        .concat(
          onlyInPanel.map(function (k) {
            return '"' + k + '" 仅在 panel_npc';
          })
        );
      results.push(
        check(
          'K10',
          diffs.length === 0,
          diffs.length ? 'warning' : 'info',
          diffs.length
            ? 'extra_char_fields 与 panel_npc AI 字段不一致（' +
                diffs.length +
                ' 处差异）: ' +
                diffs.join('; ')
            : 'extra_char_fields 与 panel_npc AI 字段一致',
          'P2-Stage2',
          '跨section不一致',
          diffs.length ? { onlyInEcf: onlyInEcf, onlyInPanel: onlyInPanel } : null
        )
      );
    }

    // K11: _narrativeCoreCharacters 提取质量
    const ncChars = snapshot.world_setting && snapshot.world_setting._narrativeCoreCharacters;
    if (ncChars && typeof ncChars === 'object' && !Array.isArray(ncChars)) {
      const CONCEPT_QUOTE_K11 =
        /[\u201c\u201d\u0022\u300c\u2018\u2019]([^\u201c\u201d\u0022\u300d\u2018\u2019]{2,8})[\u201c\u201d\u0022\u300d\u2018\u2019]/g;
      const nonPersonSuffixK11 = /[图论表册典卷轴碑石阵塔环带剑盾甲符印章令牌]$/;
      const conceptTermsK11 = new Set();
      const wsK11 = snapshot.world_setting && snapshot.world_setting.settings;
      if (wsK11 && typeof wsK11 === 'object') {
        for (const text of Object.values(wsK11)) {
          if (typeof text !== 'string') continue;
          CONCEPT_QUOTE_K11.lastIndex = 0;
          for (const m of text.matchAll(CONCEPT_QUOTE_K11)) {
            conceptTermsK11.add(m[1].trim());
          }
        }
      }
      const badEntries = [];
      for (const entityId of Object.keys(ncChars)) {
        if (entityId.startsWith('_') || !Array.isArray(ncChars[entityId])) continue;
        const names = ncChars[entityId];
        for (let ni = 0; ni < names.length; ni++) {
          const n = names[ni];
          if (typeof n !== 'string') continue;
          if (conceptTermsK11.has(n) || nonPersonSuffixK11.test(n)) {
            badEntries.push(entityId + ': "' + n + '" 疑似非人名（道具/概念）');
          }
        }
      }
      results.push(
        check(
          'K11',
          badEntries.length === 0,
          badEntries.length ? 'warning' : 'info',
          badEntries.length
            ? '_narrativeCoreCharacters 中有 ' +
                badEntries.length +
                ' 个疑似非人名条目（提取质量问题）: ' +
                badEntries[0]
            : '_narrativeCoreCharacters 提取质量良好（无明显非人名条目）',
          'P2-Stage1',
          'AI生成质量',
          badEntries.length ? { items: badEntries } : null
        )
      );
    }

    return results;
  }

  // ============================================================
  // 主检测入口
  // ============================================================
  function inspectWorldCard(rawData) {
    const snapshot =
      (rawData && rawData.card && rawData.card.snapshot) ||
      (rawData && rawData.snapshot) ||
      rawData;
    const cardMeta = {
      name: (rawData && rawData.card && rawData.card.name) || (rawData && rawData.name) || '未知',
      id: (rawData && rawData.card && rawData.card.id) || (rawData && rawData.id) || null,
      exportedAt: (rawData && rawData.exportedAt) || null,
      exportVersion: (rawData && rawData.exportVersion) || null,
    };

    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return {
        cardMeta: cardMeta,
        error: '无法解析 snapshot：请确认文件为合法的世界卡 JSON',
        summary: {
          score: 0,
          fatal: 1,
          errors: 0,
          warnings: 0,
          repairTriggers: 0,
          totalChecks: 1,
          failedChecks: 1,
        },
        pipelineSuspects: [],
        sections: {},
        inspectedAt: new Date().toISOString(),
      };
    }

    const sections = {
      A: checkSectionA(snapshot),
      B: checkSectionB(snapshot),
      C: checkSectionC(snapshot),
      D: checkSectionD(snapshot),
      E: checkSectionE(snapshot),
      F: checkSectionF(snapshot),
      G: checkSectionG(snapshot),
      H: checkSectionH(snapshot),
      I: checkSectionI(snapshot),
      J: checkSectionJ(snapshot),
      K: checkSectionK(snapshot),
    };

    const allIssues = Object.values(sections).flat();
    const fatal = allIssues.filter(function (r) {
      return !r.pass && r.severity === 'fatal';
    }).length;
    const errors = allIssues.filter(function (r) {
      return !r.pass && r.severity === 'error';
    }).length;
    const warnings = allIssues.filter(function (r) {
      return !r.pass && r.severity === 'warning';
    }).length;
    const repairTriggers = allIssues.filter(function (r) {
      return r.bugCategory === '修复触发' && !r.pass;
    }).length;
    const totalChecks = allIssues.length;
    const failedChecks = allIssues.filter(function (r) {
      return !r.pass;
    }).length;

    const score = Math.max(0, 100 - fatal * 15 - errors * 5 - warnings * 2);

    const pipelineFailCounts = {};
    for (let i = 0; i < allIssues.length; i++) {
      const issue = allIssues[i];
      if (!issue.pass && issue.pipelineStage) {
        pipelineFailCounts[issue.pipelineStage] =
          (pipelineFailCounts[issue.pipelineStage] || 0) + 1;
      }
    }
    const pipelineSuspects = Object.entries(pipelineFailCounts)
      .sort(function (a, b) {
        return b[1] - a[1];
      })
      .slice(0, 3)
      .map(function (e) {
        return e[0] + '（' + e[1] + ' 项）';
      });

    return {
      cardMeta: cardMeta,
      summary: {
        score: score,
        fatal: fatal,
        errors: errors,
        warnings: warnings,
        repairTriggers: repairTriggers,
        totalChecks: totalChecks,
        failedChecks: failedChecks,
      },
      pipelineSuspects: pipelineSuspects,
      sections: sections,
      inspectedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // 模块导出
  // ============================================================

  // Browser <script> tag: set as window global
  if (typeof window !== 'undefined') {
    window.inspectWorldCard = inspectWorldCard;
  }
  // Node.js CommonJS (require)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { inspectWorldCard: inspectWorldCard };
  }
  // Node.js ESM / globalThis fallback (for dynamic import in "type":"module" projects)
  if (typeof globalThis !== 'undefined') {
    globalThis.inspectWorldCard = inspectWorldCard;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
