/**
 * js/services/p3/p3Tools.js
 *
 * Phase 3 工具集——4 个 read-only 调研工具，无副作用。
 *
 * apply_patch 不在这里：它是顶层 action.patch 字段（不是 tool_call），
 * 由 dispatcher 直接走 UI 渲染 diff card 路径。
 *
 * 工具白名单（window.P3_TOOLS）：
 *   - query_card(path)         查 JSON Pointer 路径下的子树
 *   - search_text(keyword)     全卡字符串字段 grep
 *   - lookup_schema(path)      查字段 schema 定义
 *   - check_consistency(scope?) 跑 worldCardInspection 规则集（按 scope 过滤）
 *
 * 每个工具暴露：
 *   - description: 给 AI 看的工具说明（拼进 system prompt）
 *   - args_schema: 参数 schema 描述（给 AI 看）
 *   - validateArgs(args): 校验 args 形态，返 null=ok / 字符串=error message
 *   - exec(args, ctx): 异步或同步执行；ctx = { designConfig }；返字符串（喂回 AI）
 *
 * 工具失败 → exec 返字符串描述错误（不抛异常）；dispatcher 把字符串作为
 * tool_result 喂回 AI，计入 agent loop 总轮数。
 */

(function () {
  'use strict';

  // ============================================
  // 通用辅助
  // ============================================

  /** JSON Pointer 转义：/ → ~1，~ → ~0（RFC 6901） */
  function encodePointer(segment) {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  /**
   * 按 JSON Pointer 路径取值。
   * @returns {{ found: boolean, value?: any }}
   */
  function getByPointer(root, pointer) {
    if (pointer === '' || pointer === '/') {
      return { found: true, value: root };
    }
    if (typeof pointer !== 'string' || pointer[0] !== '/') {
      return { found: false };
    }
    if (window.jsonpatch && typeof window.jsonpatch.getValueByPointer === 'function') {
      try {
        const v = window.jsonpatch.getValueByPointer(root, pointer);
        if (v === undefined) return { found: false };
        return { found: true, value: v };
      } catch (_) {
        return { found: false };
      }
    }
    // 兜底手写解析
    const segs = pointer.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    let cur = root;
    for (const seg of segs) {
      if (cur === null || typeof cur !== 'object') return { found: false };
      if (Array.isArray(cur)) {
        const idx = parseInt(seg, 10);
        if (Number.isNaN(idx) || idx < 0 || idx >= cur.length) return { found: false };
        cur = cur[idx];
      } else {
        if (!(seg in cur)) return { found: false };
        cur = cur[seg];
      }
    }
    return { found: true, value: cur };
  }

  /**
   * 递归遍历 root 上所有字符串叶子节点。
   * 对每个匹配 predicate 的节点调 visit(path, value)。
   */
  function walkStringLeaves(root, predicate, visit) {
    const stack = [{ node: root, path: '' }];
    while (stack.length > 0) {
      const { node, path } = stack.pop();
      if (node === null || node === undefined) continue;
      if (typeof node === 'string') {
        if (predicate(node)) visit(path, node);
        continue;
      }
      if (typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          stack.push({ node: node[i], path: `${path}/${i}` });
        }
      } else {
        for (const k of Object.keys(node)) {
          stack.push({ node: node[k], path: `${path}/${encodePointer(k)}` });
        }
      }
    }
  }

  function safeStringify(value, maxLen = 8000) {
    let s;
    try {
      s = JSON.stringify(value, null, 2);
    } catch (e) {
      s = String(value);
    }
    if (typeof s !== 'string') s = String(s);
    if (s.length > maxLen) {
      return s.slice(0, maxLen) + `\n…（已截断，原长 ${s.length} 字符）`;
    }
    return s;
  }

  /**
   * 取 snippet：字段值前后若干字符的截取（命中关键词用 ★ 包裹）。
   * 用于 search_text 的结果展示。
   */
  function makeSnippet(value, keyword, context = 60) {
    const idx = value.indexOf(keyword);
    if (idx < 0) return value.slice(0, context * 2);
    const start = Math.max(0, idx - context);
    const end = Math.min(value.length, idx + keyword.length + context);
    const prefix = start > 0 ? '…' : '';
    const suffix = end < value.length ? '…' : '';
    const before = value.slice(start, idx);
    const hit = value.slice(idx, idx + keyword.length);
    const after = value.slice(idx + keyword.length, end);
    return `${prefix}${before}【${hit}】${after}${suffix}`;
  }

  // ============================================
  // query_card
  // ============================================

  const QUERY_CARD = {
    name: 'query_card',
    description:
      '按 JSON Pointer 路径查看世界卡里的子树。例如 path="/character_database/陆青渊" 返回该 NPC 完整对象；path="" 或 "/" 返回整卡（一般不必，整卡已在 system prompt）。中文 key 直接写字符（汉字会自动按 JSON Pointer 转义）。',
    args_schema: { path: 'string（JSON Pointer，如 "/character_database/{npc_id}" 或 "/world_timeline/3"）' },

    validateArgs(args) {
      if (typeof args.path !== 'string') return 'args.path 必须是字符串';
      if (args.path !== '' && args.path !== '/' && args.path[0] !== '/') {
        return 'args.path 必须以 "/" 开头（或留空表示根）';
      }
      return null;
    },

    exec(args, ctx) {
      const designConfig = ctx?.designConfig || {};
      const { found, value } = getByPointer(designConfig, args.path);
      if (!found) {
        return `[query_card] path "${args.path}" 不存在。提示：用 search_text 找相关关键词，或先 query_card "/character_database" 看现有 NPC id 列表。`;
      }
      if (value === null) return `[query_card ${args.path}] null`;
      if (typeof value !== 'object') {
        return `[query_card ${args.path}] (${typeof value}) ${JSON.stringify(value)}`;
      }
      return `[query_card ${args.path}]\n${safeStringify(value)}`;
    },
  };

  // ============================================
  // search_text
  // ============================================

  const SEARCH_TEXT = {
    name: 'search_text',
    description:
      '在整张世界卡的所有字符串字段里 grep 关键词，返回命中 path 列表 + 上下文片段。适合查"哪里提到过 X"。例：search_text("师父") 找所有 backstory/description 里提到师父的位置。',
    args_schema: { keyword: 'string（非空；区分大小写）' },

    validateArgs(args) {
      if (typeof args.keyword !== 'string' || !args.keyword.trim()) {
        return 'args.keyword 必须是非空字符串';
      }
      return null;
    },

    exec(args, ctx) {
      const designConfig = ctx?.designConfig || {};
      const keyword = args.keyword;
      const hits = [];
      const MAX_HITS = 30;
      walkStringLeaves(
        designConfig,
        (s) => s.includes(keyword),
        (path, value) => {
          if (hits.length >= MAX_HITS) return;
          hits.push({ path, snippet: makeSnippet(value, keyword) });
        }
      );
      if (hits.length === 0) {
        return `[search_text "${keyword}"] 未找到命中。提示：① 检查关键词拼写 ② 试试更短/更通用的词 ③ 用 query_card 列子树`;
      }
      const truncatedNote = hits.length >= MAX_HITS ? `\n（结果已截断至前 ${MAX_HITS} 条；缩短关键词搜更具体内容）` : '';
      const lines = hits.map((h, i) => `${i + 1}. ${h.path}\n   ${h.snippet}`);
      return `[search_text "${keyword}"] 命中 ${hits.length} 处：\n${lines.join('\n')}${truncatedNote}`;
    },
  };

  // ============================================
  // lookup_schema
  // ============================================

  const LOOKUP_SCHEMA = {
    name: 'lookup_schema',
    description:
      '查 V2 schema 字段定义（类型、用途、示例、相关字段）。当你不确定某字段该写什么形态时用——比 query_card 看现有值更明确。path 用通用形式（"/character_database/{id}/cognitive_state"），系统会自动标准化。',
    args_schema: { path: 'string（JSON Pointer 形式；{id} 等占位符可保留）' },

    validateArgs(args) {
      if (typeof args.path !== 'string' || !args.path.trim()) {
        return 'args.path 必须是非空字符串';
      }
      return null;
    },

    exec(args, ctx) {
      const path = args.path;
      // L1: 结构化 schema（worldCardFieldSchema.js）
      if (window.worldCardFieldSchema && typeof window.worldCardFieldSchema.lookup === 'function') {
        const def = window.worldCardFieldSchema.lookup(path);
        if (def) {
          return _formatSchemaDef(path, def);
        }
      }
      // L2: __rfb_data markdown grep
      if (typeof window.__rfb_data === 'string' && window.__rfb_data) {
        const excerpt = _grepSchemaDoc(window.__rfb_data, path);
        if (excerpt) {
          return `[lookup_schema ${path}] 未找到结构化定义，从 V2 schema 文档摘出相关段落：\n\n${excerpt}`;
        }
      }
      return `[lookup_schema ${path}] 未找到 schema 定义。提示：① 路径可能拼错 ② 用 query_card 看现有卡同字段的实际形态参考`;
    },
  };

  function _formatSchemaDef(path, def) {
    const lines = [`[lookup_schema ${path}]`];
    if (def.type) lines.push(`类型: ${def.type}`);
    if (def.label) lines.push(`字段名: ${def.label}`);
    if (def.desc) lines.push(`用途: ${def.desc}`);
    if (def.constraint) lines.push(`约束: ${def.constraint}`);
    if (Array.isArray(def.examples) && def.examples.length > 0) {
      lines.push(`示例: ${def.examples.map(e => JSON.stringify(e)).join(' / ')}`);
    }
    if (Array.isArray(def.related) && def.related.length > 0) {
      lines.push(`相关字段: ${def.related.join(', ')}`);
    }
    if (def.enum && Array.isArray(def.enum)) {
      lines.push(`可选值: ${def.enum.join(' / ')}`);
    }
    return lines.join('\n');
  }

  /**
   * 从 markdown schema doc 里按 path 抽相关段落。
   * 简单策略：把 path 拆 segment，找文档里同时含多个 segment 的章节。
   */
  function _grepSchemaDoc(doc, path) {
    const segments = path.split('/').filter(s => s && !s.startsWith('{'));
    if (segments.length === 0) return null;
    // 在 doc 里找包含至少 1 个 segment 的段落（按 ## 切段）
    const sections = doc.split(/(?=^##\s)/m);
    const scored = sections.map(sec => {
      let score = 0;
      for (const seg of segments) {
        if (sec.includes(seg)) score += 1;
      }
      return { sec, score };
    }).filter(x => x.score > 0);
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0].sec;
    const MAX_LEN = 1500;
    return top.length > MAX_LEN ? top.slice(0, MAX_LEN) + '\n…（已截断）' : top;
  }

  // ============================================
  // check_consistency
  // ============================================

  const VALID_SCOPE_CODES = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K']);

  const CHECK_CONSISTENCY = {
    name: 'check_consistency',
    description:
      '跑世界卡一致性体检（基于 worldCardInspection 规则集 A-K，自动排除 J 类修复触发）。' +
      '不传 scope = 全跑；scope 可传单字母或 CSV，如 "A,D,H" 只跑结构 + 角色 + 面板。' +
      '返回 fail/warning 条目列表（pass 项不返）。用来验证你想做的改动是否会破坏卡的一致性。',
    args_schema: {
      scope: 'string?（可选；如 "A" / "A,D,H" / "D-H"。不传 = 全跑除 J）',
    },

    validateArgs(args) {
      if (args.scope === undefined || args.scope === null) return null;
      if (typeof args.scope !== 'string') return 'args.scope 必须是字符串或省略';
      const codes = _parseScopeCodes(args.scope);
      if (codes === null) {
        return `args.scope="${args.scope}" 不合法。用单字母 (如 "A")、CSV (如 "A,D,H") 或范围 (如 "D-H")。可用规则代号：${[...VALID_SCOPE_CODES].join(', ')}`;
      }
      return null;
    },

    exec(args, ctx) {
      if (typeof window.inspectWorldCard !== 'function') {
        return '[check_consistency] worldCardInspection 未加载（window.inspectWorldCard 不存在）。';
      }
      const designConfig = ctx?.designConfig || {};
      const scopeCodes = args.scope ? _parseScopeCodes(args.scope) : null;

      // inspectWorldCard 期望 rawData 含 .card.snapshot / .snapshot / 直接 snapshot
      const rawData = { snapshot: designConfig };
      let report;
      try {
        report = window.inspectWorldCard(rawData);
      } catch (e) {
        return `[check_consistency] inspectWorldCard 抛错：${e?.message || String(e)}`;
      }

      if (!report || !report.sections) {
        return '[check_consistency] inspection 返回空报告（可能数据格式不兼容）';
      }

      const lines = [];
      const sectionsObj = report.sections || {};
      const sectionKeys = Object.keys(sectionsObj).sort();

      for (const sectionKey of sectionKeys) {
        // sectionKey 形如 "A" / "B" / ...
        const code = sectionKey.toUpperCase();
        // 永远排除 J 类（修复触发非业务规则）
        if (code === 'J') continue;
        // scope 过滤
        if (scopeCodes && !scopeCodes.has(code)) continue;

        const section = sectionsObj[sectionKey];
        const items = Array.isArray(section?.items) ? section.items : (Array.isArray(section) ? section : []);
        if (items.length === 0) continue;

        const failed = items.filter(it => it && it.pass === false);
        if (failed.length === 0) continue;

        lines.push(`## Section ${code} (${section?.title || ''})`);
        for (const it of failed) {
          const sev = it.severity ? `[${it.severity}]` : '';
          const id = it.id ? `(${it.id})` : '';
          lines.push(`- ${sev} ${id} ${it.message || '(无消息)'}`);
        }
      }

      if (lines.length === 0) {
        const scopeNote = scopeCodes ? `scope=${[...scopeCodes].join(',')}` : '全部规则';
        return `[check_consistency] ${scopeNote} 全部通过（无 fail/warning 条目）。`;
      }

      const summaryScore = report.summary?.score;
      const header = `[check_consistency] 检出 ${lines.filter(l => l.startsWith('-')).length} 项问题${summaryScore !== undefined ? `；总分 ${summaryScore}` : ''}：`;
      return `${header}\n\n${lines.join('\n')}`;
    },
  };

  /**
   * 解析 scope 字符串成代号 Set。
   * 支持："A" / "A,D,H" / "D-H" / "A, D-G, K"
   * 返回 null = 不合法。
   */
  function _parseScopeCodes(scope) {
    const result = new Set();
    // 大小写不敏感：AI 偶尔发小写 scope（"a,d-h"），统一归一成大写再匹配规则代号。
    const parts = scope.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (parts.length === 0) return null;
    for (const part of parts) {
      if (/^[A-Z]$/.test(part)) {
        if (!VALID_SCOPE_CODES.has(part)) return null;
        result.add(part);
        continue;
      }
      const rangeMatch = part.match(/^([A-Z])-([A-Z])$/);
      if (rangeMatch) {
        const start = rangeMatch[1].charCodeAt(0);
        const end = rangeMatch[2].charCodeAt(0);
        if (start > end) return null;
        for (let c = start; c <= end; c++) {
          const code = String.fromCharCode(c);
          if (!VALID_SCOPE_CODES.has(code)) return null;
          result.add(code);
        }
        continue;
      }
      return null;
    }
    return result.size > 0 ? result : null;
  }

  // ============================================
  // 注册 P3_TOOLS
  // ============================================

  window.P3_TOOLS = {
    query_card: QUERY_CARD,
    search_text: SEARCH_TEXT,
    lookup_schema: LOOKUP_SCHEMA,
    check_consistency: CHECK_CONSISTENCY,
  };

  // 暴露辅助函数供测试 / dispatcher 用
  window.p3ToolsUtils = {
    encodePointer,
    getByPointer,
    walkStringLeaves,
    safeStringify,
  };
})();
