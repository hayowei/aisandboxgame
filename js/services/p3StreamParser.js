/**
 * P3StreamParser - 增量解析流式 P3 响应
 *
 * 状态机：
 * 1. STATE_TEXT — 累积自然语言文本，监测 <<<EDIT_OPERATIONS>>>
 * 2. STATE_OPS_JSON — 累积 JSON 内容
 * 3. STATE_DONE — 检测到 <<<END_EDIT_OPERATIONS>>>
 *
 * 核心路径 (D4)：流式期间显示文本 + 完成后一次性解析操作
 * 增量操作解析作为可选优化
 */
(function () {
  'use strict';

  const STATE_TEXT = 'text';
  const STATE_OPS_JSON = 'ops_json';
  const STATE_DONE = 'done';

  const START_MARKER = '<<<EDIT_OPERATIONS>>>';
  const END_MARKER = '<<<END_EDIT_OPERATIONS>>>';
  // 容错匹配：AI 偶尔把 <<< 写成 << 或把 >>> 写成 >>，允许 2-4 个尖括号
  const START_TAIL_RE = /<{2,4}EDIT_OPERATIONS>{2,4}$/;
  const END_TAIL_RE = /<{2,4}END_EDIT_OPERATIONS>{2,4}$/;
  const MAX_MARKER_LEN = 27; // <<<<END_EDIT_OPERATIONS>>>>

  class P3StreamParser {
    constructor(options = {}) {
      this.state = STATE_TEXT;
      this.textBuffer = '';
      this.jsonBuffer = '';
      this.fullBuffer = ''; // 完整响应（用于降级）

      // 回调
      this.onTextChunk = options.onTextChunk || null; // (text) => void
      this.onOperationsParsed = options.onOperationsParsed || null; // (ops[]) => void
      this.onStreamOp = options.onStreamOp || null; // (op) => void — 增量解析出的单个 op
      this.onComplete = options.onComplete || null; // ({ text, operations }) => void

      // 增量解析状态
      this._bracketDepth = 0;
      this._inString = false;
      this._escapeNext = false;
      this._currentOpBuffer = '';
      this._parsedOps = [];
      this._incrementalFailed = false;
    }

    /**
     * 处理流式 chunk
     * @param {string} chunk - 新到达的文本片段
     */
    feed(chunk) {
      this.fullBuffer += chunk;

      if (this.state === STATE_DONE) return;

      // 将 chunk 逐字符处理
      for (let i = 0; i < chunk.length; i++) {
        const char = chunk[i];

        if (this.state === STATE_TEXT) {
          this.textBuffer += char;

          // 检测开始标记（容错匹配 << / <<< / <<<<）
          const startTail = this.textBuffer.slice(-MAX_MARKER_LEN);
          const startMatch = startTail.match(START_TAIL_RE);
          if (startMatch) {
            this.textBuffer = this.textBuffer.slice(0, -startMatch[0].length);
            this.state = STATE_OPS_JSON;
            this.jsonBuffer = '';
            this._bracketDepth = 0;
            this._inString = false;
            this._escapeNext = false;
            this._currentOpBuffer = '';
          } else if (this.onTextChunk) {
            // 批量发送文本（避免逐字符，但需要处理标记边界）
            // 只在不可能是标记前缀时发送
            // 简化：每次 feed 结束后统一发送
          }
        } else if (this.state === STATE_OPS_JSON) {
          this.jsonBuffer += char;

          // 检测结束标记（容错匹配）
          const endTail = this.jsonBuffer.slice(-MAX_MARKER_LEN);
          const endMatch = endTail.match(END_TAIL_RE);
          if (endMatch) {
            this.jsonBuffer = this.jsonBuffer.slice(0, -endMatch[0].length);
            this.state = STATE_DONE;
            this._finalize();
            return; // 忽略剩余字符
          }

          // 增量 JSON 解析（可选优化）
          if (!this._incrementalFailed && this.onStreamOp) {
            this._feedJsonChar(char);
          }
        }
      }

      // 流式文本回调（批量发送当前累积的安全文本）
      if (this.state === STATE_TEXT && this.onTextChunk) {
        // 容错前缀检测：tail 出现连续 2+ 个 < 即可能是标记开头，暂不发送
        // 自然语言极少出现 << 序列，副作用可接受
        const tail = this.textBuffer.slice(-MAX_MARKER_LEN);
        const safeSend = !/<{2,}/.test(tail);
        if (safeSend && this.textBuffer.length > 0) {
          this.onTextChunk(this.textBuffer);
        }
      }
    }

    /**
     * 增量 JSON 字符处理（尝试提取单个 operation 对象）
     */
    _feedJsonChar(char) {
      try {
        if (this._escapeNext) {
          this._escapeNext = false;
          this._currentOpBuffer += char;
          return;
        }

        if (this._inString) {
          this._currentOpBuffer += char;
          if (char === '\\') this._escapeNext = true;
          else if (char === '"') this._inString = false;
          return;
        }

        if (char === '"') {
          this._inString = true;
          this._currentOpBuffer += char;
          return;
        }

        if (char === '{') {
          this._bracketDepth++;
          this._currentOpBuffer += char;
          return;
        }

        if (char === '}') {
          this._bracketDepth--;
          this._currentOpBuffer += char;

          // 完整对象（深度回到 0 或 1 表示数组内的 top-level 对象）
          if (this._bracketDepth <= 0) {
            this._tryParseCurrentOp();
            this._currentOpBuffer = '';
            this._bracketDepth = 0;
          }
          return;
        }

        if (this._bracketDepth > 0) {
          this._currentOpBuffer += char;
        }
        // 忽略数组外的空白和逗号
      } catch {
        this._incrementalFailed = true;
      }
    }

    /**
     * 尝试解析当前累积的 operation JSON
     */
    _tryParseCurrentOp() {
      const trimmed = this._currentOpBuffer.trim();
      if (!trimmed || !trimmed.startsWith('{')) return;

      try {
        const op = JSON.parse(trimmed);
        if (op && op.target && op.action && op.path) {
          this._parsedOps.push(op);
          if (this.onStreamOp) {
            this.onStreamOp(op);
          }
        }
      } catch {
        // 解析失败：可能是不完整的 JSON，忽略
        // 降级到完成后一次性解析
      }
    }

    /**
     * 流结束后的最终解析
     */
    _finalize() {
      let operations = [];

      // 尝试解析完整 JSON
      const trimmedJson = this.jsonBuffer.trim();
      if (trimmedJson) {
        try {
          const parsed = JSON.parse(trimmedJson);
          if (Array.isArray(parsed)) {
            operations = parsed;
          } else if (parsed && Array.isArray(parsed.operations)) {
            operations = parsed.operations;
          }
        } catch {
          // JSON 解析失败，尝试提取数组
          try {
            const arrayMatch = trimmedJson.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              operations = JSON.parse(arrayMatch[0]);
            }
          } catch {
            // 最终降级：使用增量解析结果
            if (this._parsedOps.length > 0) {
              operations = this._parsedOps;
            }
          }
        }
      }

      if (this.onOperationsParsed) {
        this.onOperationsParsed(operations);
      }
      if (this.onComplete) {
        this.onComplete({
          text: this.textBuffer,
          operations,
        });
      }
    }

    /**
     * 流意外结束时调用
     */
    finishEarly() {
      if (this.state !== STATE_DONE) {
        if (this.onTextChunk && this.textBuffer.length > 0) {
          this.onTextChunk(this.textBuffer);
        }
        this.state = STATE_DONE;
        this._finalize();
      }
    }

    /**
     * 获取当前文本内容
     */
    getText() {
      return this.textBuffer;
    }

    /**
     * 是否已完成
     */
    isDone() {
      return this.state === STATE_DONE;
    }

    /**
     * 是否在 JSON 解析阶段
     */
    isParsingOps() {
      return this.state === STATE_OPS_JSON;
    }
  }

  window.P3StreamParser = P3StreamParser;
})();
