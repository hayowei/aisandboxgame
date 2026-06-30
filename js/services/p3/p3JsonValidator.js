/**
 * js/services/p3/p3JsonValidator.js
 *
 * 校验 P3 AI 输出的 JSON content 是否符合 action schema：
 *   {
 *     description: string (非空，必填),
 *     patch?:     RFC6902 ops 数组 | null,
 *     tool_call?: { tool: string, args: object } | null
 *   }
 *
 * 三种合法状态：
 *   1. description + tool_call  = 中间轮调研
 *   2. description + patch      = 最终带改动
 *   3. description 单独          = 纯对话
 *
 * patch 和 tool_call 互斥（最多一个有值）。
 *
 * 失败时返 { ok: false, error_message_for_ai: "..." }，
 * 由 dispatcher 把 error 作为 user message 喂回让 AI 修。
 *
 * 工具白名单 + args schema 从 window.P3_TOOLS 拿（forward ref 到 p3Tools.js）。
 *
 * 暴露 window.p3JsonValidator.validate(content, designConfig)。
 */

(function () {
  'use strict';

  // RFC 6902 合法 op 集合
  const VALID_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

  /**
   * 检测 content 是否被 markdown code fence 包裹。
   * 例如：
   *   ```json
   *   { ... }
   *   ```
   * 或前后带任何额外文字。
   */
  function detectMarkdownFence(content) {
    if (typeof content !== 'string') return false;
    // 任意位置出现 ``` 即视为 fence（严格）
    return /```/.test(content);
  }

  /**
   * 检测 content 是否在 JSON 前后有额外文字（非 JSON 形态）。
   * 严格要求 content 去掉首尾空白后必须以 { 开头、} 结尾。
   */
  function detectExtraText(content) {
    if (typeof content !== 'string') return true;
    const trimmed = content.trim();
    if (!trimmed) return true;
    if (trimmed[0] !== '{' || trimmed[trimmed.length - 1] !== '}') return true;
    return false;
  }

  /**
   * 校验单条 RFC 6902 op 的形态。
   * 返回 null = ok，返回字符串 = 错误说明。
   */
  function validatePatchOp(op, index) {
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      return `patch[${index}] 不是 object`;
    }
    if (typeof op.op !== 'string' || !VALID_OPS.has(op.op)) {
      return `patch[${index}].op="${op.op}" 不合法，必须是 ${[...VALID_OPS].join('/')} 之一`;
    }
    if (typeof op.path !== 'string' || op.path === '' || op.path[0] !== '/') {
      // 禁止根指针 ""：{op:"remove",path:""} 会让整卡变 null、{op:"replace",path:""} 整卡替换，
      // P3 编辑 patch 永远只该针对子路径，根级操作一律拒绝。
      return `patch[${index}].path 必须是以 "/" 开头的 JSON Pointer（不允许空字符串根指针）`;
    }
    // op 特定字段
    if (op.op === 'add' || op.op === 'replace' || op.op === 'test') {
      if (!('value' in op)) {
        return `patch[${index}] op="${op.op}" 缺 value 字段`;
      }
    }
    if (op.op === 'move' || op.op === 'copy') {
      if (typeof op.from !== 'string' || op.from === '' || op.from[0] !== '/') {
        return `patch[${index}] op="${op.op}" 缺合法 from 字段（不允许空字符串根指针）`;
      }
    }
    return null;
  }

  /**
   * fast-json-patch dry-run 校验 patch 整体能否应用。
   * 不修改原 designConfig（mutateDocument=false）。
   */
  function dryRunPatch(patch, designConfig) {
    if (!window.jsonpatch || typeof window.jsonpatch.applyPatch !== 'function') {
      // fast-json-patch 未加载——跳过 dry-run（patchEngine 会在真正 apply 时校验）
      return null;
    }
    try {
      // deep clone designConfig 防止 mutate
      const clone = JSON.parse(JSON.stringify(designConfig || {}));
      window.jsonpatch.applyPatch(clone, patch, /*validate*/ true, /*mutateDocument*/ false);
      return null;
    } catch (e) {
      const msg = e?.message || String(e);
      // fast-json-patch 错误格式：含 OPERATION_PATH_UNRESOLVABLE / TEST_OPERATION_FAILED 等 enum
      return `patch dry-run 失败：${msg}`;
    }
  }

  /**
   * 校验 tool_call 形态 + tool 在白名单 + args 通过 schema 校验。
   */
  function validateToolCall(toolCall) {
    if (!toolCall || typeof toolCall !== 'object' || Array.isArray(toolCall)) {
      return 'tool_call 不是 object';
    }
    if (typeof toolCall.tool !== 'string' || !toolCall.tool) {
      return 'tool_call.tool 必须是非空字符串';
    }
    const tools = window.P3_TOOLS;
    if (!tools || typeof tools !== 'object') {
      // P3_TOOLS 还没加载——保守跳过白名单校验
      return null;
    }
    const def = tools[toolCall.tool];
    if (!def) {
      const whitelist = Object.keys(tools).join(', ');
      return `tool_call.tool="${toolCall.tool}" 不在白名单内。可用：${whitelist}`;
    }
    if (toolCall.args === undefined || toolCall.args === null) {
      return `tool_call.args 缺失（${toolCall.tool} 需要 args）`;
    }
    if (typeof toolCall.args !== 'object' || Array.isArray(toolCall.args)) {
      return `tool_call.args 必须是 object`;
    }
    // args schema 校验（每个工具自带 validator）
    if (typeof def.validateArgs === 'function') {
      const err = def.validateArgs(toolCall.args);
      if (err) return `tool_call.args 不合法：${err}`;
    }
    return null;
  }

  /**
   * 主入口。
   *
   * @param {string} content - AI 返回的 message.content 整段
   * @param {object} designConfig - 当前世界卡 JSON（dry-run patch 校验用）
   * @returns {{
   *   ok: boolean,
   *   action?: { description: string, patch: array|null, tool_call: object|null },
   *   error_message_for_ai?: string
   * }}
   */
  function validate(content, designConfig) {
    // Step 1: 先尝试 JSON.parse。
    // 注意：parse 优先于 fence/extra-text 检测——合法 JSON 的 description 字段值内可以
    // 含字面 ``` 三个字符（JSON 不要求 escape），先 parse 不会误判。只在 parse 失败时
    // 才看是不是 fence/extra-text 包裹导致的，给 AI 针对性的 error message。
    let obj;
    try {
      obj = JSON.parse((content || '').trim());
    } catch (e) {
      // Parse 失败——判断错误类型给针对性提示
      if (detectMarkdownFence(content)) {
        return {
          ok: false,
          error_message_for_ai:
            '[json_error] 你的输出含 markdown code fence (```)。严格按协议：只输出 JSON 对象本身，不要包裹任何 markdown 代码块、不要前后加文字说明。请重新输出。',
        };
      }
      if (detectExtraText(content)) {
        return {
          ok: false,
          error_message_for_ai:
            '[json_error] 你的输出不是纯 JSON 对象。请整段重写，只输出 {...} 这一个对象，不要在 JSON 前后加任何说明文字。',
        };
      }
      return {
        ok: false,
        error_message_for_ai:
          `[json_error] 你的输出不是合法 JSON：${e?.message || String(e)}。请重新输出合法 JSON 对象。`,
      };
    }

    // Step 4: 必须是 object（非 array/string/null）
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return {
        ok: false,
        error_message_for_ai: '[json_error] 顶层必须是 object（{...}），不能是数组/字符串/null。',
      };
    }

    // Step 5: description 必填非空 string
    if (typeof obj.description !== 'string' || !obj.description.trim()) {
      return {
        ok: false,
        error_message_for_ai:
          '[json_error] 缺 description 字段（必填、非空字符串）。description 是给用户看的人话说明——不管这一轮是调工具、出 patch、还是纯讨论，都必须写。',
      };
    }

    // Step 6: patch 字段（可选）—— null 或数组
    let patch = null;
    if ('patch' in obj && obj.patch !== null && obj.patch !== undefined) {
      if (!Array.isArray(obj.patch)) {
        return {
          ok: false,
          error_message_for_ai: '[json_error] patch 字段必须是数组或 null。',
        };
      }
      patch = obj.patch;
    }

    // Step 7: tool_call 字段（可选）
    let toolCall = null;
    if ('tool_call' in obj && obj.tool_call !== null && obj.tool_call !== undefined) {
      toolCall = obj.tool_call;
    }

    // Step 8: patch && tool_call 互斥
    if (patch && patch.length > 0 && toolCall) {
      return {
        ok: false,
        error_message_for_ai:
          '[json_error] patch 和 tool_call 不能同时有值。一轮要么调工具调研（tool_call），要么给出最终改动（patch），要么纯讨论（两者都 null）。',
      };
    }

    // Step 9: patch 内部校验
    if (patch && patch.length > 0) {
      for (let i = 0; i < patch.length; i++) {
        const opErr = validatePatchOp(patch[i], i);
        if (opErr) {
          return {
            ok: false,
            error_message_for_ai: `[json_error] ${opErr}`,
          };
        }
      }
      // fast-json-patch dry-run（path 不存在 / test op fail 等）
      const dryErr = dryRunPatch(patch, designConfig);
      if (dryErr) {
        return {
          ok: false,
          error_message_for_ai:
            `[json_error] ${dryErr}。提示：用 query_card 查路径是否存在；replace/remove 前先用 test op 验证当前值。`,
        };
      }
    }

    // Step 10: tool_call 内部校验
    if (toolCall) {
      const tcErr = validateToolCall(toolCall);
      if (tcErr) {
        return {
          ok: false,
          error_message_for_ai: `[json_error] ${tcErr}`,
        };
      }
    }

    return {
      ok: true,
      action: {
        description: obj.description,
        patch: patch && patch.length > 0 ? patch : null,
        tool_call: toolCall,
      },
    };
  }

  window.p3JsonValidator = {
    validate,
    // 暴露内部函数供测试 / debug
    _detectMarkdownFence: detectMarkdownFence,
    _detectExtraText: detectExtraText,
    _validatePatchOp: validatePatchOp,
    _validateToolCall: validateToolCall,
    _dryRunPatch: dryRunPatch,
  };
})();
