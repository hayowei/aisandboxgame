/**
 * design/p3.js
 * Phase 3 (Review & Edit) — 快照 + 对话记忆编辑
 *
 * 通过 mixin 模式扩展 DesignService.prototype。
 * 所有方法实现与原 class DesignService 中的版本完全一致，仅以独立 class 形式承载，
 * 在文件末尾通过 _applyDesignServiceMixin 合并到 DesignService 上。
 *
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceP3Mixin {
  /** P3 对话记忆：最大保留条目数 */
  static get MAX_P3_HISTORY() { return 8; }

  static get P3_SNAPSHOT_LIMITS() {
    return Object.freeze({
      worldSettingEntity: Infinity,
      promptModuleContent: Infinity,
      moduleMetaField: 400,
      characterStringField: 1200,
      characterJsonField: 2000,
      timelineEventContent: Infinity,
    });
  }

  /**
   * 构建 P3 对话历史消息数组（用于 API 调用）
   * 取最近 N 条，每条截断，assistant 消息附带应用摘要
   */
  _buildP3HistoryMessages(systemPromptLength = 0) {
    const history = this.p3Session.p3History;
    if (!history || history.length === 0) return [];

    const MAX_CONTENT_LEN = 2000;
    const maxEntries = 6;

    const recent = history.slice(-maxEntries);
    return recent.map(entry => {
      let content = entry.content || '';
      // assistant 消息附带应用摘要
      if (entry.role === 'assistant' && entry.appliedSummary) {
        content += '\n\n[' + entry.appliedSummary + ']';
      }
      // 截断过长内容
      if (content.length > MAX_CONTENT_LEN) {
        content = content.slice(0, MAX_CONTENT_LEN) + '...(截断)';
      }
      return { role: entry.role, content };
    });
  }

  /**
   * Phase 3 编辑消息：快照 + 对话记忆模式
   * 每次调用发送当前完整快照 + 最近对话历史 + 用户指令
   * @param {string} userMessage - 用户的编辑指令
   * @returns {Promise<{text: string, operations: Array|null}>}
   */
  async sendP3Message(userMessage, options = {}) {
    if (this.isProcessing) throw new Error('正在处理中，请稍候');
    this._assertDesignApiKeyConfigured();
    this.isProcessing = true;

    const requestAbortController = new AbortController();
    this._p3AbortController = requestAbortController;

    // 支持外部 abortSignal
    let externalAbortHandler;
    if (options.abortSignal instanceof AbortSignal) {
      externalAbortHandler = () =>
        requestAbortController.abort(options.abortSignal.reason ?? new Error('Phase 3 cancelled'));
      if (options.abortSignal.aborted) externalAbortHandler();
      else options.abortSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }

    try {
      this.p3Session.sm.onSendMessage();

      // 备份完整 session 快照（用于 abort/error 恢复）
      this.p3Session.sessionSnapshot = {
        enrichedOps: JSON.parse(JSON.stringify(this.p3Session.enrichedOps)),
        undoStack: window.P3UndoManager ? window.P3UndoManager.exportStack() : [],
      };

      // 新消息清空 session (D5) — p3History 不清
      const hadPendingOps = this.p3Session.enrichedOps.filter(
        op => op.status === 'accepted' || op.status === 'rejected'
      ).length;
      this.clearP3Session();

      // 构建无状态快照上下文（全量快照，不做相关性筛选）
      const snapshot = this._buildP3Snapshot();
      const phase3Prompt = _getDesignPromptValue('PHASE3_SYSTEM_PROMPT', PHASE3_SYSTEM_PROMPT);
      const systemPrompt = phase3Prompt + '\n\n## 当前世界数据快照\n' + snapshot;

      // 构建消息：对话历史 + 当前用户消息
      const historyMessages = this._buildP3HistoryMessages(systemPrompt.length);
      const messages = [...historyMessages, { role: 'user', content: userMessage }];

      // 支持流式回调
      const apiOptions = { abortSignal: requestAbortController.signal };
      if (options.onStreamChunk) {
        apiOptions.onChunk = options.onStreamChunk;
      }

      let response = await aiService._callSummaryAPI(messages, systemPrompt, 'p3', apiOptions);

      if (aiService.lastDesignPayload) {
        aiService.lastDesignPayload.response = response;
      }

      let parsed = this._parseP3Response(response);

      // AI 偶尔把 <<<EDIT_OPERATIONS>>> 写成 <<EDIT_OPERATIONS>> 等变形，触发一次静默重试纠错
      if (parsed.parseFailed) {
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: response },
          {
            role: 'user',
            content:
              '你上次输出的 EDIT_OPERATIONS 标记块格式不正确（开/闭标签必须各为 3 个 < 和 3 个 >）。' +
              '请保持上次的修改意图不变，仅重新输出严格格式的 <<<EDIT_OPERATIONS>>>...<<<END_EDIT_OPERATIONS>>> 块。',
          },
        ];
        const retryApiOptions = { abortSignal: requestAbortController.signal };
        try {
          const retryResponse = await aiService._callSummaryAPI(retryMessages, systemPrompt, 'p3', retryApiOptions);
          const retryParsed = this._parseP3Response(retryResponse);
          if (!retryParsed.parseFailed) {
            response = retryResponse;
            parsed = retryParsed;
            if (aiService.lastDesignPayload) {
              aiService.lastDesignPayload.response = retryResponse;
            }
          }
        } catch (retryErr) {
          // 重试期间被 abort：往外抛，由外层 catch 统一处理
          if (retryErr.name === 'AbortError' || requestAbortController.signal.aborted) {
            throw retryErr;
          }
          // 其他错误：保留第一次 response 的 parsed 结果，由下方失败提示兜底
          console.warn('[P3] retry call failed, falling back to first response:', retryErr);
        }
      }

      let { text, operations } = parsed;
      // 重试也未恢复时，给用户一个温和提示，避免静默看到含残缺标记的脏文本
      if (parsed.parseFailed) {
        text = (text || '') + '\n\n> ⚠️ 编辑操作格式解析失败，请重新发送或换种说法描述修改意图。';
      }
      const normalizedOperations = this._sanitizeP3Operations(operations);

      // 使用 P3DiffEngine 进行 enrichment
      let enrichedOps = [];
      if (normalizedOperations.length > 0 && window.P3DiffEngine) {
        enrichedOps = window.P3DiffEngine.enrichOperations(
          normalizedOperations,
          this.designConfig,
          this
        );
      }

      // 操作验证
      if (enrichedOps.length > 0) {
        this._validateP3Operations(enrichedOps);
      }

      // 存储到 p3Session
      this.p3Session.enrichedOps = enrichedOps;

      // 记录对话历史（Bug #5: 移到解析成功之后）
      this.p3Session.p3History.push({ role: 'user', content: userMessage, appliedSummary: null });
      this.p3Session.p3History.push({ role: 'assistant', content: text, appliedSummary: null });
      // 裁剪历史长度
      const maxHist = DesignService.MAX_P3_HISTORY;
      if (this.p3Session.p3History.length > maxHist) {
        this.p3Session.p3History = this.p3Session.p3History.slice(-maxHist);
      }

      // 兼容旧路径
      this.pendingOperations = normalizedOperations;

      this.p3Session.sm.onResponseComplete(enrichedOps.length > 0);
      this.p3Session.sessionSnapshot = null; // 成功后丢弃快照

      return {
        text,
        operations: normalizedOperations,
        enrichedOps,
        hasPendingOps: enrichedOps.length > 0,
        hadPendingOps,
      };

    } catch (err) {
      if (err.name === 'AbortError' || requestAbortController.signal.aborted) {
        this.p3Session.sm.onAbort();
        this._restoreP3SessionSnapshot();
        return { text: '', enrichedOps: [], aborted: true };
      }
      this.p3Session.sm.onApiError();
      this.p3Session.lastError = err;
      this._restoreP3SessionSnapshot();
      console.error('[P3] sendP3Message error:', err);
      throw err;

    } finally {
      this.isProcessing = false;
      this._p3AbortController = null;
      if (options.abortSignal && externalAbortHandler) {
        options.abortSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  /**
   * 恢复 P3 session 快照（abort/error 时调用）
   */
  _restoreP3SessionSnapshot() {
    const snap = this.p3Session.sessionSnapshot;
    if (!snap) return;
    this.p3Session.enrichedOps = snap.enrichedOps;
    if (window.P3UndoManager && snap.undoStack) {
      window.P3UndoManager.importStack(snap.undoStack);
    }
    this.p3Session.sessionSnapshot = null;
  }

  /**
   * 取消当前 P3 请求
   */
  cancelP1Request() {
    if (this.designRequestAbortController) {
      this.designRequestAbortController.abort(new Error('Design request cancelled'));
    }
  }

  cancelP3Request() {
    if (this._p3AbortController) {
      this._p3AbortController.abort(new Error('Phase 3 cancelled'));
    }
  }

  /**
   * 构建 Phase 3 快照上下文（全量，不按相关性筛选）
   */
  _buildP3Snapshot() {
    const dc = this.designConfig;
    const sections = [];
    const limits = DesignService.P3_SNAPSHOT_LIMITS;

    // World Setting
    if (dc.world_setting) {
      const truncLimit = limits.worldSettingEntity;
      const entities = dc.world_setting.settings
        ? Object.entries(dc.world_setting.settings)
            .filter(([k]) => !k.startsWith('_'))
            .map(([id, text]) => {
              const truncated =
                typeof text === 'string' && text.length > truncLimit
                  ? text.slice(0, truncLimit) + '...(截断)'
                  : text;
              return `### ${id}\n${truncated}`;
            })
            .join('\n\n')
        : '（空）';
      sections.push(
        `## 世界设定（world_setting）\n_summary: ${dc.world_setting._summary || '无'}\n\n${entities}`
      );
    }

    // Prompt Modules (Rules)
    if (dc.prompt_modules) {
      const pm = dc.prompt_modules;
      const moduleLimit = limits.promptModuleContent;
      const metaLimit = limits.moduleMetaField;
      const moduleList = pm.modules
        ? Object.entries(pm.modules)
            .map(([id, content]) => {
              const truncated =
                typeof content === 'string' && content.length > moduleLimit
                  ? content.slice(0, moduleLimit) + '...(截断)'
                  : content;
              return `### ${id}\n${truncated}`;
            })
            .join('\n\n')
        : '（空）';
      const metaList = pm.module_meta
        ? Object.entries(pm.module_meta)
            .map(([id, meta]) => {
              if (!meta || typeof meta !== 'object') return `### ${id}\n（meta 无效）`;
              const desc = typeof meta.description === 'string' ? meta.description : '（缺失）';
              const when = typeof meta.when_to_call === 'string' ? meta.when_to_call : '（缺失）';
              const trimmedDesc = desc.length > metaLimit ? desc.slice(0, metaLimit) + '...(截断)' : desc;
              const trimmedWhen = when.length > metaLimit ? when.slice(0, metaLimit) + '...(截断)' : when;
              return `### ${id}\n- description: ${trimmedDesc}\n- when_to_call: ${trimmedWhen}`;
            })
            .join('\n\n')
        : '（空）';
      sections.push(
        `## 规则系统（prompt_modules）\n_summary: ${pm._summary || '无'}\n\n### modules\n${moduleList}\n\n### module_meta\n${metaList}`
      );
    }

    // Character Database - show all fields for edit accuracy
    if (dc.character_database) {
      const strTruncLimit = limits.characterStringField;
      const jsonTruncLimit = limits.characterJsonField;
      const chars = Object.entries(dc.character_database)
        .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')
        .map(([id, c]) => {
          const fieldLines = Object.entries(c)
            .filter(([k]) => !k.startsWith('_'))
            .map(([k, v]) => {
              if (v === null || v === undefined) return `  ${k}: null`;
              if (typeof v === 'string') {
                const t = v.length > strTruncLimit ? v.slice(0, strTruncLimit) + '...' : v;
                return `  ${k}: "${t}"`;
              }
              const s = JSON.stringify(v);
              const t = s.length > jsonTruncLimit ? s.slice(0, jsonTruncLimit) + '...' : s;
              return `  ${k}: ${t}`;
            })
            .join('\n');
          return `### ${c.name || id} (${id})\n${fieldLines}`;
        })
        .join('\n\n');
      sections.push(
        `## 角色数据库（character_database）\n_summary: ${dc.character_database._summary || '无'}\n\n${chars}`
      );
    }

    // Timeline
    if (dc.timeline?.events) {
      const eventLimit = limits.timelineEventContent;
      const events = dc.timeline.events
        .map((e, i) => {
          const raw = typeof e.content === 'string' ? e.content : '';
          const t = raw.length > eventLimit ? raw.slice(0, eventLimit) + '...(截断)' : raw;
          return `${i}. [${e.time}] ${e.location}: ${t}`;
        })
        .join('\n');
      sections.push(
        `## 时间线（timeline）\n_summary: ${dc.timeline._summary || '无'}\n事件数: ${dc.timeline.events.length}\n\n${events}`
      );
    }

    // Character Timelines
    if (dc.character_timelines) {
      const _tlFmt = entry => `${entry.year || '?'}.${entry.month || '?'}`;
      const _tlRange = (arr, valKey) => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const first = arr[0];
        const last = arr[arr.length - 1];
        const fVal = typeof first[valKey] === 'string' ? first[valKey].slice(0, 40) : '?';
        const lVal = typeof last[valKey] === 'string' ? last[valKey].slice(0, 40) : '?';
        if (arr.length === 1) return `[${_tlFmt(first)}→"${fVal}"] (1条)`;
        return `[${_tlFmt(first)}→"${fVal}", ${_tlFmt(last)}→"${lVal}"] (${arr.length}条)`;
      };
      const _tlRelRange = arr => {
        if (!Array.isArray(arr) || arr.length === 0) return null;
        const first = arr[0];
        const last = arr[arr.length - 1];
        const fCount = first.relations ? Object.keys(first.relations).length : 0;
        const lCount = last.relations ? Object.keys(last.relations).length : 0;
        if (arr.length === 1) return `[${_tlFmt(first)}→{${fCount}人}] (1条)`;
        return `[${_tlFmt(first)}→{${fCount}人}, ${_tlFmt(last)}→{${lCount}人}] (${arr.length}条)`;
      };
      const ctEntries = Object.entries(dc.character_timelines)
        .filter(([k, v]) => !k.startsWith('_') && v && typeof v === 'object')
        .map(([id, ct]) => {
          const lines = [`- **${id}**:`];
          const cog = _tlRange(ct.cognitive, 'state');
          if (cog) lines.push(`  cognitive: ${cog}`);
          const rel = _tlRelRange(ct.relationships);
          if (rel) lines.push(`  relationships: ${rel}`);
          const sts = _tlRange(ct.status, 'status');
          if (sts) lines.push(`  status: ${sts}`);
          return lines.join('\n');
        })
        .join('\n');
      sections.push(
        `## 角色时间线（character_timelines）\n_summary: ${dc.character_timelines._summary || '无'}\n\n${ctEntries}`
      );
    }

    // Meta 快照
    sections.push(
      `## 世界卡信息（meta）\n- 名称: ${this.worldCardName || '（未设置）'}\n- 描述: ${this.worldCardDescription || '（未设置）'}`
    );

    // Step3 Fields 快照
    const s3 = dc.step3_fields || _cloneDefaultStep3Fields();
    if (s3) {
      const s3Lines = [];
      if (Array.isArray(s3.panel_status)) {
        s3Lines.push('### panel_status 状态栏字段');
        for (let i = 0; i < s3.panel_status.length; i++) {
          const g = s3.panel_status[i];
          if (!g || typeof g !== 'object') continue;
          const params = [];
          if (g._template) params.push(`_template="${g._template}"`);
          if (g._precision) params.push(`_precision="${g._precision}"`);
          if (g._era) params.push(`_era="${g._era}"`);
          if (g._currency) params.push(`_currency="${g._currency}"`);
          if (g.type) params.push(`type="${g.type}"`);
          const fieldsStr = Array.isArray(g.fields)
            ? g.fields.map(f => `${f.key}:${f.label}:${f.type || 'string'}`).join(', ')
            : '';
          s3Lines.push(
            `- [key=${g.key || ''}] label="${g.label || ''}" icon="${g.icon || ''}" ${params.join(' ')}${fieldsStr ? `\n  fields: [${fieldsStr}]` : ''}`
          );
        }
      }
      if (Array.isArray(s3.panel_npc)) {
        s3Lines.push('### panel_npc 角色档案字段');
        for (const f of s3.panel_npc) {
          if (!f || typeof f !== 'object') continue;
          const extras = [];
          if (f.desc) extras.push(`desc="${f.desc}"`);
          if (f.fixed) extras.push('fixed=true');
          if ('runtimeRequired' in f) {
            extras.push(`runtimeRequired=${f.runtimeRequired === true ? 'true' : 'false'}`);
          }
          if (f.enum) extras.push(`enum=[${f.enum.join(',')}]`);
          s3Lines.push(
            `- key="${f.key}" label="${f.label}" type="${f.type || 'string'}"${extras.length ? ' ' + extras.join(' ') : ''}`
          );
        }
      }
      if (s3Lines.length > 0) {
        sections.push(`## 界面字段配置（step3_fields）\n${s3Lines.join('\n')}`);
      }
    }

    return sections.join('\n\n---\n\n');
  }

  /**
   * 解析 Phase 3 响应，提取操作指令
   * parseFailed=true 表示 AI 想输出操作但格式炸了（用于触发自动重试）
   */
  _parseP3Response(response) {
    // AI 偶尔会把 <<< 写成 << 或把 >>> 写成 >>，允许 2-4 个尖括号
    const pattern = /<{2,4}EDIT_OPERATIONS>{2,4}\s*([\s\S]*?)\s*<{2,4}END_EDIT_OPERATIONS>{2,4}/;
    const match = response.match(pattern);
    // 检测残缺的标记块：必须有 < 紧贴 EDIT_OPERATIONS，避免 AI 在普通文本里提到关键字时被误判
    const intendedOps = /<+\s*EDIT_OPERATIONS/.test(response) || /<+\s*END_EDIT_OPERATIONS/.test(response);

    if (!match) {
      // 流式输出可能在 EDIT_OPERATIONS 中途被截断（无 END_EDIT_OPERATIONS 闭合）。
      // 尝试从开块 marker 后抓所有内容做截断恢复，能救一部分就好。
      if (intendedOps) {
        const recovered = this._recoverTruncatedP3Operations(response);
        if (recovered && recovered.operations && recovered.operations.length > 0) {
          const openMatch = response.match(/<{2,4}EDIT_OPERATIONS>{2,4}/);
          const text = (openMatch
            ? response.slice(0, openMatch.index)
            : response
          ).trim() + '\n\n> ⚠️ AI 输出被截断，已尝试恢复 ' + recovered.operations.length + ' 项操作，建议核对后再确认。';
          return { text, operations: recovered.operations, parseFailed: false };
        }
      }
      // intendedOps=true 但既没匹配也没恢复 → 剥离残缺 marker，避免半残文本流入对话历史污染下一轮模型
      const cleanText = intendedOps
        ? response
            .replace(/<{1,4}\s*EDIT_OPERATIONS\s*>{0,4}/g, '')
            .replace(/<{1,4}\s*END_EDIT_OPERATIONS\s*>{0,4}/g, '')
            .trim()
        : response;
      return { text: cleanText, operations: null, parseFailed: intendedOps };
    }

    let operations = null;
    const rawJson = match[1].trim();
    try {
      const parsed = JSON.parse(rawJson);
      operations = parsed.operations || [];
    } catch (strictErr) {
      // 严格解析失败 → 尝试去尾逗号兜底，但只在确认有尾逗号时才动手，避免破坏字符串内容
      try {
        const lenient = rawJson.replace(/,(\s*[}\]])/g, '$1');
        if (lenient !== rawJson) {
          const parsed = JSON.parse(lenient);
          operations = parsed.operations || [];
        } else {
          throw strictErr;
        }
      } catch (lenientErr) {
        console.warn('[DesignService] P3 操作 JSON 解析失败:', lenientErr);
        const text = response.replace(pattern, '').trim();
        return { text, operations: null, parseFailed: true };
      }
    }

    const text = response.replace(pattern, '').trim();
    return { text, operations, parseFailed: false };
  }

  /**
   * 截断恢复：从开块 marker 后的内容里抓出可解析的完整 operation 对象
   * 用于流式被截断、END_EDIT_OPERATIONS 缺失的场景
   */
  _recoverTruncatedP3Operations(response) {
    const openMatch = response.match(/<{2,4}EDIT_OPERATIONS>{2,4}/);
    if (!openMatch) return null;
    const tail = response.slice(openMatch.index + openMatch[0].length).trim();
    if (!tail) return null;

    // 路径 1：尝试用括号平衡补全后整体 parse
    const repaired = _balanceJsonBrackets(tail);
    if (repaired) {
      try {
        const parsed = JSON.parse(repaired);
        const ops = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.operations)
            ? parsed.operations
            : null;
        if (Array.isArray(ops) && ops.length > 0) {
          return { operations: ops };
        }
      } catch { /* fall through */ }
    }

    // 路径 2：扫描 tail，按括号深度切出每个完整的顶层对象逐个 parse
    const ops = [];
    const arrStart = tail.indexOf('[');
    const scanFrom = arrStart >= 0 ? arrStart + 1 : 0;
    let depth = 0;
    let opStart = -1;
    let inString = false;
    let escape = false;
    for (let i = scanFrom; i < tail.length; i++) {
      const c = tail[i];
      if (escape) { escape = false; continue; }
      if (inString) {
        if (c === '\\') escape = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === '{') {
        if (depth === 0) opStart = i;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0 && opStart >= 0) {
          const objText = tail.slice(opStart, i + 1);
          try {
            const op = JSON.parse(objText);
            if (op && op.target && op.action && op.path) ops.push(op);
          } catch { /* 跳过无效对象 */ }
          opStart = -1;
        }
      }
    }
    return ops.length > 0 ? { operations: ops } : null;
  }

  _isDisallowedTimelineIndexedOperation(op) {
    if (!op || op.target !== 'timeline') return false;
    if (op.action !== 'update' && op.action !== 'delete') return false;
    if (typeof op.path !== 'string') return false;
    return /^events\[\d+\](?:\.|$)/.test(op.path.trim());
  }

  _sanitizeP3Operations(operations) {
    if (!Array.isArray(operations)) return [];

    const sanitized = [];
    for (const op of operations) {
      if (!op || typeof op !== 'object') {
        console.warn('[DesignService] 跳过非法 P3 操作（非对象）:', op);
        continue;
      }

      const target = typeof op.target === 'string' ? op.target : '';
      const action = typeof op.action === 'string' ? op.action : '';
      const path = typeof op.path === 'string' ? op.path : '';

      if (!target || !action || !path) {
        console.warn('[DesignService] 跳过非法 P3 操作（缺少 target/action/path）:', op);
        continue;
      }

      // _summary 必填（PHASE3_SYSTEM_PROMPT 原则 6）
      const summaryRaw = typeof op._summary === 'string' ? op._summary.trim() : '';
      if (!summaryRaw) {
        console.warn('[DesignService] 跳过缺少 _summary 的 P3 操作:', op);
        continue;
      }
      // _summary 前缀约定（不阻拦，仅提醒）
      if (!summaryRaw.startsWith('[原始]') && !summaryRaw.startsWith('[级联]')) {
        console.warn(
          `[DesignService] _summary 缺少 [原始]/[级联] 前缀（不阻拦）："${summaryRaw}"`,
          op
        );
      }

      const normalizedOp = {
        ...op,
        target,
        action,
        path,
      };

      if (this._isDisallowedTimelineIndexedOperation(normalizedOp)) {
        console.warn(
          '[DesignService] 拒绝时间线索引 patch，请改用完整 events 数组更新:',
          normalizedOp
        );
        continue;
      }

      if (
        target === 'timeline' &&
        action === 'update' &&
        path === 'events' &&
        !Array.isArray(op.value)
      ) {
        console.warn(
          '[DesignService] 拒绝非法时间线更新：path=events 时 value 必须是完整数组:',
          normalizedOp
        );
        continue;
      }

      // events update 时每条 event 必须含 time/day/location/characters/content
      if (
        target === 'timeline' &&
        action === 'update' &&
        path === 'events' &&
        Array.isArray(op.value)
      ) {
        const REQUIRED_EVENT_FIELDS = ['time', 'day', 'location', 'characters', 'content'];
        const invalidIdx = op.value.findIndex(
          e => !e
            || typeof e !== 'object'
            || REQUIRED_EVENT_FIELDS.some(f => !(f in e) || e[f] === undefined || e[f] === null)
        );
        if (invalidIdx >= 0) {
          console.warn(
            `[DesignService] 拒绝非法时间线更新：events[${invalidIdx}] 缺必填字段（time/day/location/characters/content）:`,
            normalizedOp
          );
          continue;
        }
      }

      if (target === 'timeline' && action === 'delete' && path === 'events') {
        console.warn(
          '[DesignService] 拒绝删除整个 events；请使用 update + events + 完整新数组:',
          normalizedOp
        );
        continue;
      }

      // meta 仅允许 update + name/description
      if (target === 'meta' && action !== 'update') {
        console.warn('[DesignService] meta 仅支持 update 操作:', normalizedOp);
        continue;
      }
      if (target === 'meta' && path !== 'name' && path !== 'description') {
        console.warn('[DesignService] meta 仅支持 path=name 或 path=description:', normalizedOp);
        continue;
      }

      // step3_fields 整组更新时 value 必须是数组
      if (
        target === 'step3_fields' &&
        action === 'update' &&
        (path === 'panel_status' || path === 'panel_npc') &&
        !Array.isArray(op.value)
      ) {
        console.warn('[DesignService] step3_fields 整组更新时 value 必须是数组:', normalizedOp);
        continue;
      }

      // character_database / character_timelines entity-level update: value must be object
      if (
        (target === 'character_database' || target === 'character_timelines') &&
        action === 'update' &&
        !path.includes('.') &&
        !path.includes('[') &&
        (typeof op.value !== 'object' || op.value === null || Array.isArray(op.value))
      ) {
        console.warn(`[DesignService] ${target} 实体更新 value 必须是对象:`, normalizedOp);
        continue;
      }

      sanitized.push(normalizedOp);
    }

    return sanitized;
  }

  /**
   * 应用 Phase 3 编辑操作
   */
  _applyP3Operations(operations) {
    const safeOperations = this._sanitizeP3Operations(operations);

    // 备份 step3_fields 元数据，防止被 P3 操作覆盖
    const savedWorldTermsSource = this.designConfig.step3_fields?._worldTermsSource;
    const savedSource = this.designConfig.step3_fields?._source;
    let hasStep3FieldsOps = false;

    for (const op of safeOperations) {
      const { target, action, path, value } = op;

      // meta 存储在 designService 实例上，不在 designConfig 中
      if (target === 'meta') {
        if (action === 'update') {
          if (path === 'name') this.worldCardName = typeof value === 'string' ? value : '';
          else if (path === 'description')
            this.worldCardDescription = typeof value === 'string' ? value : '';
        }
        continue;
      }

      // step3_fields 首次被修改时确保有基础结构
      if (target === 'step3_fields') {
        hasStep3FieldsOps = true;
        if (!this.designConfig.step3_fields && action !== 'delete') {
          this.designConfig.step3_fields = { panel_status: [], panel_npc: [] };
        }
      }

      const data = this.designConfig[target];
      if (!data && action !== 'add') {
        console.warn(`[DesignService] P3 操作目标不存在: ${target}`);
        continue;
      }

      switch (action) {
        case 'update':
          // Character database / timelines entity-level update: merge to prevent field loss
          if (
            (target === 'character_database' || target === 'character_timelines') &&
            typeof path === 'string' &&
            !path.includes('.') &&
            !path.includes('[')
          ) {
            const existing = data?.[path];
            if (
              existing &&
              typeof existing === 'object' &&
              typeof value === 'object' &&
              value !== null
            ) {
              data[path] = { ...existing, ...value };
              break;
            }
          }
          // 保护：整组替换 panel_status 时，保留核心字段
          if (
            target === 'step3_fields' &&
            path === 'panel_status' &&
            Array.isArray(value)
          ) {
            const CORE_KEYS = ['datetime', 'location', 'money', 'objective'];
            const existing = this.designConfig.step3_fields?.panel_status;
            if (Array.isArray(existing)) {
              for (const ck of CORE_KEYS) {
                if (!value.some(g => g && g.key === ck)) {
                  const original = existing.find(g => g && g.key === ck);
                  if (original) value.unshift(original);
                }
              }
            }
          }
          this._setNestedValue(this.designConfig, target, path, value);
          break;

        case 'add':
          if (!this.designConfig[target]) this.designConfig[target] = {};
          // 特殊处理：如果目标路径是一个数组，执行 push 而不是覆写
          // 例：timeline.events 新增单个事件
          this._addNestedValue(this.designConfig, target, path, value);
          break;

        case 'delete':
          // 保护核心状态字段不被删除
          if (target === 'step3_fields' && typeof path === 'string') {
            const m = path.match(/^panel_status\[(\d+)\]$/);
            if (m) {
              const idx = parseInt(m[1], 10);
              const groups = this.designConfig.step3_fields?.panel_status;
              if (Array.isArray(groups) && groups[idx]) {
                const PROTECTED = new Set(['datetime', 'location', 'money', 'objective']);
                if (PROTECTED.has(groups[idx].key)) {
                  console.warn(`[DesignService] 核心状态字段 "${groups[idx].key}" 不可删除，跳过`);
                  break;
                }
              }
            }
          }
          this._deleteNestedValue(this.designConfig, target, path);
          break;

        default:
          console.warn(`[DesignService] 未知操作类型: ${action}`);
      }
    }

    // 回填 step3_fields 元数据（防止整组 update 时丢失）
    if (hasStep3FieldsOps && this.designConfig.step3_fields) {
      // 确保核心状态字段未被整组 update 误删
      this._ensureCoreStatusGroups();
      this.designConfig.step3_fields.panel_npc = this._normalizePanelNpcFields(
        this.designConfig.step3_fields.panel_npc
      );
      if (
        savedWorldTermsSource !== undefined &&
        !this.designConfig.step3_fields._worldTermsSource
      ) {
        this.designConfig.step3_fields._worldTermsSource = savedWorldTermsSource;
      }
      if (savedSource !== undefined && !this.designConfig.step3_fields._source) {
        this.designConfig.step3_fields._source = savedSource;
      }
    }
  }

  /**
   * 确保核心状态字段（datetime/location/money/objective）存在于 panel_status 中
   * 如果被整组 update 或 delete 误删，从默认字段中补回
   */
  _ensureCoreStatusGroups() {
    const s3 = this.designConfig?.step3_fields;
    if (!s3 || !Array.isArray(s3.panel_status)) return;

    const CORE_KEYS = ['datetime', 'location', 'money', 'objective'];
    const builder = window.step3SchemaBuilder;
    if (!builder) return;

    const locale = window.i18nService?.getDesignLanguage?.() || 'zh-CN';
    const defaults =
      typeof builder.getDefaultStatusFields === 'function'
        ? builder.getDefaultStatusFields(locale)
        : JSON.parse(JSON.stringify(builder.DEFAULT_STATUS_FIELDS));
    if (!Array.isArray(defaults)) return;

    for (const key of CORE_KEYS) {
      if (!s3.panel_status.some(g => g && g.key === key)) {
        const fallback = defaults.find(d => d && d.key === key);
        if (fallback) {
          if (key === 'datetime') {
            s3.panel_status.unshift(fallback);
          } else if (key === 'location') {
            const dtIdx = s3.panel_status.findIndex(g => g && g.key === 'datetime');
            s3.panel_status.splice(dtIdx >= 0 ? dtIdx + 1 : 0, 0, fallback);
          } else {
            const locIdx = s3.panel_status.findIndex(g => g && g.key === 'location');
            s3.panel_status.splice(locIdx >= 0 ? locIdx + 1 : s3.panel_status.length, 0, fallback);
          }
          console.warn(`[DesignService] 核心状态字段 "${key}" 被自动恢复`);
        }
      }
    }
  }

  /**
   * 新增嵌套路径的值
   * 如果最终目标是数组，push 新元素；否则直接赋值（与 update 相同）
   */
  _addNestedValue(config, target, path, value) {
    const data = config[target];
    if (!data) return;

    const parts = this._parsePath(path);

    // 找到倒数第二层
    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = (typeof parts[i + 1] === 'number') ? [] : {};
      current = current[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (Array.isArray(current[lastKey])) {
      // 目标是数组：push 新元素
      if (Array.isArray(value)) {
        current[lastKey].push(...value);
      } else {
        current[lastKey].push(value);
      }
    } else {
      // 目标不是数组（或不存在）：直接赋值
      current[lastKey] = value;
    }
  }

  /**
   * 读取嵌套路径的值
   */
  _getNestedValue(config, target, path) {
    const data = config[target];
    if (!data) return undefined;

    const parts = this._parsePath(path);
    let current = data;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * 设置嵌套路径的值
   * 支持 "settings.entity_id" 和 "events[3]" 格式
   */
  _setNestedValue(config, target, path, value) {
    const data = config[target];
    if (!data) return;

    const parts = this._parsePath(path);
    if (parts.length === 1) {
      data[parts[0]] = value;
      return;
    }

    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = (typeof parts[i + 1] === 'number') ? [] : {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  /**
   * 删除嵌套路径的值
   */
  _deleteNestedValue(config, target, path) {
    const data = config[target];
    if (!data) return;

    const parts = this._parsePath(path);
    if (parts.length === 1) {
      if (Array.isArray(data) && typeof parts[0] === 'number') {
        data.splice(parts[0], 1);
      } else {
        delete data[parts[0]];
      }
      return;
    }

    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) return;
      current = current[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (Array.isArray(current) && typeof lastKey === 'number') {
      current.splice(lastKey, 1);
    } else {
      delete current[lastKey];
    }
  }

  /**
   * 解析路径字符串为数组
   * "settings.entity_id" → ["settings", "entity_id"]
   * "events[3]" → ["events", 3]
   */
  _parsePath(path) {
    const parts = [];
    for (const segment of path.split('.')) {
      const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        parts.push(arrayMatch[1]);
        parts.push(parseInt(arrayMatch[2], 10));
      } else {
        parts.push(segment);
      }
    }
    return parts;
  }

  /**
   * 在所有 designConfig section 中搜索对指定 ID 的文本引用
   * @returns {string[]} 包含引用的 section 标签列表
   */
  _searchReferences(entityId) {
    const refs = [];
    const dc = this.designConfig;
    const searchIn = (obj, sectionLabel) => {
      if (!obj) return;
      const text = JSON.stringify(obj);
      if (text.includes(entityId)) refs.push(sectionLabel);
    };
    searchIn(dc.world_setting, '世界设定');
    searchIn(dc.prompt_modules, '规则系统');
    searchIn(dc.character_database, '角色数据库');
    searchIn(dc.timeline, '时间线');
    return refs;
  }

  /**
   * 弹出编辑 Modal，直接修改 designConfig 中的值
   */
  _showEditModal(name, editTarget, editPath) {
    // 移除已有 modal
    const existing = document.getElementById('dcv-edit-modal');
    if (existing) existing.remove();

    const rawValue = this._getNestedValue(this.designConfig, editTarget, editPath);
    const isObj = typeof rawValue === 'object' && rawValue !== null;
    const textValue = isObj ? JSON.stringify(rawValue, null, 2) : rawValue || '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'dcv-edit-modal';

    const content = document.createElement('div');
    content.className = 'modal-content dcv-edit-modal-content';

    const title = document.createElement('h2');
    title.textContent = `编辑：${name}`;

    const textarea = document.createElement('textarea');
    textarea.id = 'dcv-edit-textarea';
    textarea.value = textValue;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    // 统一关闭函数（清理监听器 + 移除 DOM）
    const onEsc = e => {
      if (e.key === 'Escape') closeModal();
    };
    const closeModal = () => {
      modal.remove();
      document.removeEventListener('keydown', onEsc);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => {
      let newValue = textarea.value;
      if (isObj) {
        try {
          newValue = JSON.parse(newValue);
        } catch (e) {
          window.showAlertModal('JSON 格式错误', '请检查后重试', null, { icon: 'error' });
          return;
        }
      }
      if (
        editTarget === 'character_database' &&
        newValue &&
        typeof newValue === 'object' &&
        !Array.isArray(newValue)
      ) {
        if ('age' in newValue) {
          delete newValue.age;
        }
        if (
          !Object.prototype.hasOwnProperty.call(newValue, 'birthday') ||
          newValue.birthday === ''
        ) {
          newValue.birthday = null;
        }
        const birthdayValidation = this._validateBirthdayValueForCurrentWorld(newValue.birthday);
        if (!birthdayValidation.ok) {
          window.showAlertModal('生日格式错误', birthdayValidation.message, null, { icon: 'error' });
          return;
        }
      }
      this._setNestedValue(this.designConfig, editTarget, editPath, newValue);
      if (
        editTarget === 'timeline' &&
        this.designConfig?.timeline?.events &&
        typeof timelineService !== 'undefined' &&
        timelineService.sortEventsByDate
      ) {
        timelineService.sortEventsByDate(this.designConfig.timeline.events);
      }
      this._saveDesignConfig();
      this._updatePreviewPanel();
      closeModal();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    content.appendChild(title);
    content.appendChild(textarea);
    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // 点击遮罩关闭
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });

    // Escape 关闭
    document.addEventListener('keydown', onEsc);

    // 聚焦 textarea
    setTimeout(() => textarea.focus(), 50);
  }

  /**
   * 从名称自动生成合法 ID
   * 优先提取括号内英文名，否则用原文做 key
   */
  _generateId(name) {
    if (!name || !name.trim()) return '';
    const trimmed = name.trim();
    // 尝试提取括号中的英文名: "永夜帝国 (The Empire of Evernight)" → "The Empire of Evernight"
    const bracketMatch = trimmed.match(/[（(]\s*([A-Za-z][\w\s'-]+?)\s*[）)]/);
    if (bracketMatch) {
      return bracketMatch[1]
        .trim()
        .toLowerCase()
        .replace(/[\s'-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    }
    // 尝试用纯英文部分
    const englishWords = trimmed.match(/[A-Za-z][\w'-]*/g);
    if (englishWords && englishWords.length > 0) {
      return englishWords
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
    }
    // 全中文：直接用中文做 key（designConfig 支持中文 key）
    return trimmed.replace(/[\s\t]+/g, '_').replace(/[()（）/\\]/g, '');
  }

  _buildCharacterDatabaseAddConfig() {
    const timePrecision = this._getTimePrecisionFromStep3Fields(this.designConfig?.step3_fields);
    const timeGroup = Array.isArray(this.designConfig?.step3_fields?.panel_status)
      ? this.designConfig.step3_fields.panel_status.find(group => group?.key === 'datetime')
      : null;
    const timeEra = typeof timeGroup?._era === 'string' ? timeGroup._era : '';
    const fields = [
      { section: '基本信息' },
      { key: 'name', label: '角色名称', type: 'input', placeholder: '例如：Alice、Godwin' },
      { key: 'gender', label: '性别', type: 'input', placeholder: '例如：男、女' },
      {
        key: 'title',
        label: '头衔 / 职称',
        type: 'input',
        placeholder: '例如：永夜女皇、圣骑士团长',
      },
      {
        key: 'birthday',
        label: '生日',
        type: 'input',
        placeholder: this._getBirthdayPlaceholderFromPrecision(timePrecision, timeEra),
      },
      { key: 'origin', label: '出身 / 来源', type: 'input', placeholder: '例如：A国、X国圣城' },
      { section: '外貌与性格' },
      {
        key: 'personality',
        label: '性格特征',
        type: 'input',
        placeholder: '例如：沉稳、忠诚、开朗',
      },
      {
        key: 'appearance',
        label: '外貌描述',
        type: 'input',
        placeholder: '例如：30岁冻龄/苍白/灰瞳/麻木',
      },
      {
        key: 'clothing',
        label: '服装',
        type: 'input',
        placeholder: '例如：破旧黑裙/铅斗篷/铁冠',
      },
    ];

    const fieldMap = new Map();
    for (const field of fields) {
      if (field.key) fieldMap.set(field.key, field);
    }

    const panelNpcFields = Array.isArray(this.designConfig?.step3_fields?.panel_npc)
      ? this.designConfig.step3_fields.panel_npc
      : [];
    const fixedKeys = this._getNpcRuntimeRequiredKeySet();
    let injectedExtraSection = false;

    const applyDynamicMeta = (targetField, panelField) => {
      const desc = typeof panelField.desc === 'string' ? panelField.desc.trim() : '';
      if (Array.isArray(panelField.enum) && panelField.enum.length > 0) {
        targetField.type = 'select';
        targetField.options = panelField.enum.map(option => ({
          value: String(option),
          label: String(option),
        }));
      } else if (panelField.type === 'integer') {
        targetField.type = 'number';
      }
      if (desc) {
        targetField.placeholder = desc;
      }
    };

    const ensureExtraSection = () => {
      if (injectedExtraSection) return;
      fields.push({ section: '角色档案扩展' });
      injectedExtraSection = true;
    };

    for (const panelField of panelNpcFields) {
      if (!panelField || typeof panelField.key !== 'string' || !panelField.key.trim()) continue;
      const rawKey = panelField.key.trim();
      if (fixedKeys.has(rawKey)) continue;

      let saveKey = rawKey;
      let displayKey = rawKey;
      let displayLabel =
        typeof panelField.label === 'string' && panelField.label.trim()
          ? panelField.label.trim()
          : rawKey;

      if (rawKey === 'cognitive_state') {
        saveKey = 'default_cognitive_state';
        displayKey = 'default_cognitive_state';
        displayLabel = '初始认知状态';
      }

      const existingField = fieldMap.get(displayKey);
      if (existingField) {
        existingField.saveKey = saveKey;
        applyDynamicMeta(existingField, panelField);
        continue;
      }

      ensureExtraSection();
      const newField = {
        key: displayKey,
        saveKey,
        label: displayLabel,
        type: 'input',
        placeholder: typeof panelField.desc === 'string' ? panelField.desc.trim() : '',
      };
      applyDynamicMeta(newField, panelField);
      fields.push(newField);
      fieldMap.set(displayKey, newField);
    }

    return {
      title: '新增角色',
      fields,
      save: values => {
        const name = (values.name || '').trim();
        if (!name) {
          window.showAlertModal('提示', '请输入角色名称', null, { icon: 'warning' });
          return false;
        }
        const id = this._generateId(name);
        if (!id) {
          window.showAlertModal('错误', '无法从名称生成有效 ID', null, { icon: 'error' });
          return false;
        }
        if (!this.designConfig.character_database) this.designConfig.character_database = {};
        if (this.designConfig.character_database[id] !== undefined) {
          window.showAlertModal('ID 冲突', `角色「${id}」已存在，请使用不同的名称`, null, { icon: 'error' });
          return false;
        }

        const charObj = {};
        for (const field of fields) {
          if (!field || field.section || !field.key) continue;
          const saveKey = field.saveKey || field.key;
          const rawValue = values[field.key];
          if (field.type === 'number') {
            if (rawValue === '' || rawValue === null || rawValue === undefined) continue;
            const parsed = Number(rawValue);
            if (!Number.isFinite(parsed)) {
              window.showAlertModal('字段错误', `字段「${field.label}」必须是数字`, null, { icon: 'error' });
              return false;
            }
            charObj[saveKey] = Math.trunc(parsed);
            continue;
          }

          const text =
            typeof rawValue === 'string' ? rawValue.trim() : String(rawValue || '').trim();
          if (field.key === 'birthday' && text) {
            const birthdayValidation = this._validateBirthdayValueForCurrentWorld(text);
            if (!birthdayValidation.ok) {
              window.showAlertModal('生日格式错误', birthdayValidation.message, null, { icon: 'error' });
              return false;
            }
          }
          if (field.key === 'birthday') {
            charObj[saveKey] = text || null;
            continue;
          }
          if (text) charObj[saveKey] = text;
        }

        if (!Object.prototype.hasOwnProperty.call(charObj, 'birthday')) {
          charObj.birthday = null;
        }
        this.designConfig.character_database[id] = charObj;
        return true;
      },
    };
  }

  /**
   * 弹出新增 Modal，根据 sectionType 展示结构化表单
   */
  _showAddModal(sectionType) {
    const existing = document.getElementById('dcv-edit-modal');
    if (existing) existing.remove();

    // ── 各区块表单配置 ──
    const configs = {
      world_setting: {
        title: '新增世界实体',
        fields: [
          {
            key: 'name',
            label: '实体名称',
            type: 'input',
            placeholder: '例如：永夜帝国 (The Empire of Evernight)',
          },
          { section: '地缘政治' },
          {
            key: 'geopolitics',
            label: '基础地缘与世界定位',
            type: 'textarea',
            tall: true,
            placeholder: '描述国家的地理位置、领土范围、核心城市、与周边国家的关系...',
          },
          { section: '历史与文化' },
          {
            key: 'history',
            label: '历史起源与文化基调',
            type: 'textarea',
            tall: true,
            placeholder: '描述文明的起源、重要历史事件、文化传统、宗教信仰...',
          },
          { section: '社会与治理' },
          {
            key: 'system',
            label: '社会治理与体系',
            type: 'textarea',
            tall: true,
            placeholder: '描述政治体制、社会阶层、军事组织、法律制度...',
          },
          { section: '经济与环境' },
          {
            key: 'economy',
            label: '经济生态与环境场景',
            type: 'textarea',
            tall: true,
            placeholder: '描述经济模式、自然环境、重要地标、日常生活场景...',
          },
          { section: '核心人物与局势' },
          {
            key: 'narrative',
            label: '核心人物与当前局势',
            type: 'textarea',
            tall: true,
            placeholder: '描述关键人物、当前政治局势、潜在冲突与故事线索...',
          },
        ],
        save: values => {
          const name = (values.name || '').trim();
          if (!name) {
            window.showAlertModal('提示', '请输入实体名称', null, { icon: 'warning' });
            return false;
          }
          const id = this._generateId(name);
          if (!id) {
            window.showAlertModal('错误', '无法从名称生成有效 ID', null, { icon: 'error' });
            return false;
          }
          if (!this.designConfig.world_setting) this.designConfig.world_setting = { settings: {} };
          if (!this.designConfig.world_setting.settings)
            this.designConfig.world_setting.settings = {};
          if (this.designConfig.world_setting.settings[id] !== undefined) {
            window.showAlertModal('ID 冲突', `实体「${id}」已存在，请使用不同的名称`, null, { icon: 'error' });
            return false;
          }
          // 拼接为标准格式字符串
          const sections = [
            { tag: 'Geopolitics', title: '第一章：基础地缘与世界定位', key: 'geopolitics' },
            { tag: 'History_Culture', title: '第二章：历史起源与文化基调', key: 'history' },
            { tag: 'System_Hierarchy', title: '第三章：社会治理与体系', key: 'system' },
            { tag: 'Economy_Environment', title: '第四章：经济生态与环境场景', key: 'economy' },
            { tag: 'Narrative_Core', title: '第五章：核心人物与当前局势', key: 'narrative' },
          ];
          const parts = [`## 国家设定—— ${name}\n`];
          for (const s of sections) {
            const content = (values[s.key] || '').trim();
            if (content) {
              parts.push(`### ${s.title} [${s.tag}]\n${content}\n`);
            }
          }
          this.designConfig.world_setting.settings[id] = parts.join('\n');
          return true;
        },
      },
      prompt_modules: {
        title: '新增规则模块',
        fields: [
          {
            key: 'name',
            label: '模块名称',
            type: 'input',
            placeholder: '例如：战斗系统、魔法规则、社交机制',
          },
          { section: '模块信息' },
          {
            key: 'description',
            label: '模块描述',
            type: 'input',
            placeholder: '简要描述这个规则模块的核心功能',
          },
          {
            key: 'when_to_call',
            label: '调用时机',
            type: 'input',
            placeholder: '什么情况下 AI 应该参考这个规则？',
          },
          {
            key: 'avoid_when',
            label: '避免场景',
            type: 'input',
            placeholder: '什么情况下不应调用这个规则？',
          },
          {
            key: 'input_focus',
            label: '输入重点',
            type: 'input',
            placeholder: '调用时需要关注哪些输入信息？',
          },
          {
            key: 'expected_output',
            label: '预期输出',
            type: 'input',
            placeholder: '调用后应该产生什么样的输出效果？',
          },
          { section: '规则内容' },
          {
            key: 'content',
            label: '详细规则',
            type: 'textarea',
            tall: true,
            placeholder: '详细描述规则的具体内容、机制、数值、触发条件...',
          },
        ],
        save: values => {
          const name = (values.name || '').trim();
          if (!name) {
            window.showAlertModal('提示', '请输入模块名称', null, { icon: 'warning' });
            return false;
          }
          const id = this._generateId(name);
          if (!id) {
            window.showAlertModal('错误', '无法从名称生成有效 ID', null, { icon: 'error' });
            return false;
          }
          if (!this.designConfig.prompt_modules)
            this.designConfig.prompt_modules = { modules: {}, module_meta: {} };
          if (!this.designConfig.prompt_modules.modules)
            this.designConfig.prompt_modules.modules = {};
          if (!this.designConfig.prompt_modules.module_meta)
            this.designConfig.prompt_modules.module_meta = {};
          if (this.designConfig.prompt_modules.modules[id] !== undefined) {
            window.showAlertModal('ID 冲突', `模块「${id}」已存在，请使用不同的名称`, null, { icon: 'error' });
            return false;
          }
          this.designConfig.prompt_modules.modules[id] = values.content || '';
          this.designConfig.prompt_modules.module_meta[id] = {
            description: values.description || '',
            when_to_call: values.when_to_call || '',
            avoid_when: values.avoid_when || '',
            input_focus: values.input_focus || '',
            expected_output: values.expected_output || '',
          };
          return true;
        },
      },
      character_database: this._buildCharacterDatabaseAddConfig(),
      timeline: {
        title: '新增时间线事件',
        fields: [
          { section: '事件信息' },
          { key: 'time', label: '时间', type: 'input', placeholder: '例如：星历118.08' },
          { key: 'day', label: '日期', type: 'input', placeholder: '例如：10日' },
          { key: 'time_str', label: '时刻', type: 'input', placeholder: '例如：09:30' },
          { key: 'location', label: '地点', type: 'input', placeholder: '例如：X国-圣城-大教堂' },
          {
            key: 'characters',
            label: '相关角色',
            type: 'input',
            placeholder: '例如：Godwin / Amelia',
          },
          { section: '事件内容' },
          {
            key: 'content',
            label: '事件描述',
            type: 'textarea',
            tall: true,
            placeholder: '描述事件的详细经过、起因、结果和影响...',
          },
        ],
        save: values => {
          if (!this.designConfig.timeline) this.designConfig.timeline = { events: [] };
          if (!Array.isArray(this.designConfig.timeline.events))
            this.designConfig.timeline.events = [];
          const event = {};
          const eventFields = ['time', 'day', 'location', 'characters', 'content'];
          for (const key of eventFields) {
            const val = (values[key] || '').trim();
            if (val) event[key] = val;
          }
          if (!event.time && !event.content) {
            window.showAlertModal('提示', '请至少填写时间或事件内容', null, { icon: 'warning' });
            return false;
          }
          this.designConfig.timeline.events.push(event);
          if (typeof timelineService !== 'undefined' && timelineService.sortEventsByDate) {
            timelineService.sortEventsByDate(this.designConfig.timeline.events);
          }
          return true;
        },
      },
    };

    const cfg = configs[sectionType];
    if (!cfg) return;

    // ── 构建 Modal DOM ──
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'dcv-edit-modal';

    const content = document.createElement('div');
    content.className = 'modal-content dcv-edit-modal-content dcv-add-modal-scrollable';

    const title = document.createElement('h2');
    title.textContent = cfg.title;
    content.appendChild(title);

    // ── 渲染字段 ──
    const fieldElements = {};
    for (const field of cfg.fields) {
      // 分组标题
      if (field.section) {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'dcv-add-section-title';
        sectionTitle.textContent = field.section;
        content.appendChild(sectionTitle);
        continue;
      }

      const label = document.createElement('label');
      label.textContent = field.label;
      label.className = 'dcv-add-modal-label';
      content.appendChild(label);

      if (field.type === 'input' || field.type === 'number') {
        const input = document.createElement('input');
        input.type = field.type === 'number' ? 'number' : 'text';
        input.placeholder = field.placeholder || '';
        input.className = 'dcv-add-modal-input';
        content.appendChild(input);
        fieldElements[field.key] = input;
      } else if (field.type === 'select') {
        const select = document.createElement('select');
        select.className = 'dcv-add-modal-input';
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = field.placeholder || '请选择';
        select.appendChild(emptyOption);
        for (const option of field.options || []) {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.label;
          select.appendChild(optionEl);
        }
        content.appendChild(select);
        fieldElements[field.key] = select;
      } else {
        const textarea = document.createElement('textarea');
        textarea.placeholder = field.placeholder || '';
        textarea.className = 'dcv-add-modal-textarea';
        if (field.tall) textarea.classList.add('dcv-add-modal-textarea--tall');
        textarea.rows = 1;
        const autoGrow = () => {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
        };
        textarea.addEventListener('input', autoGrow);
        content.appendChild(textarea);
        fieldElements[field.key] = textarea;
      }
    }

    // ── 操作按键 ──
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const onEsc = e => {
      if (e.key === 'Escape') closeModal();
    };
    const closeModal = () => {
      modal.remove();
      document.removeEventListener('keydown', onEsc);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '创建';
    saveBtn.addEventListener('click', () => {
      const values = {};
      for (const [key, el] of Object.entries(fieldElements)) {
        values[key] = el.value;
      }
      if (cfg.save(values)) {
        this._saveDesignConfig();
        this._updatePreviewPanel();
        closeModal();
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', onEsc);

    const firstField = Object.values(fieldElements)[0];
    if (firstField) setTimeout(() => firstField.focus(), 50);
  }
  /**
   * 定向更新 step3_fields 中受 world_terms 单个字段变更影响的部分
   * 不会重建整个 step3_fields，保留用户的其他自定义编辑
   */
  _patchStep3FieldFromTermChange(termKey, newValue) {
    const s3 = this.designConfig.step3_fields;
    if (!s3 || !Array.isArray(s3.panel_status)) return;

    if (termKey === 'currency_name') {
      const currency = typeof newValue === 'string' ? newValue.trim() : '';
      const moneyGroup = s3.panel_status.find(g => g && g.key === 'money');
      if (moneyGroup) {
        moneyGroup._currency = currency;
        if (moneyGroup.fields) {
          const amountField =
            moneyGroup.fields.find(f => f.key === 'amount') ||
            moneyGroup.fields.find(f => f.key === 'money');
          if (amountField && currency) amountField.label = currency;
        }
      }
    } else if (termKey === 'calendar_era') {
      const era = typeof newValue === 'string' ? newValue.trim() : '';
      const dtGroup = s3.panel_status.find(g => g && g.key === 'datetime');
      if (dtGroup) {
        dtGroup._era = era;
        // 如果没有 calendar_units 覆盖，同步 year 字段 label
        if (dtGroup.fields && !this.p1Output?.world_terms?.calendar_units?.length) {
          const yearField = dtGroup.fields.find(f => f.key === 'year');
          if (yearField && era) yearField.label = era;
        }
      }
    }
  }

  /**
   * 应用 P3 暂存的编辑操作（旧接口，保留兼容）
   * @returns {{ applied: number }}
   */
  executePendingOperations() {
    // 优先使用新的 p3Session 路径
    if (this.p3Session.enrichedOps.length > 0) {
      return this.applySelectedOperations();
    }
    if (!this.pendingOperations.length) return { applied: 0 };
    this._applyP3Operations(this.pendingOperations);
    const count = this.pendingOperations.length;
    this.pendingOperations = [];
    this._saveDesignConfig();
    this._updatePreviewPanel();
    return { applied: count };
  }

  /**
   * 应用 P3 session 中 status === 'accepted' 的操作（新 Cursor 化流程）
   * 逐条应用，每条前记录 undo 信息
   * 后处理在批次末尾统一执行 (D2)
   * @returns {{ applied: number, rejected: number }}
   */
  applySelectedOperations() {
    const ops = this.p3Session.enrichedOps;
    const accepted = ops.filter(op => op.status === 'accepted');
    if (accepted.length === 0) return { applied: 0, rejected: 0, skipped: 0, failed: 0, skippedOps: [] };

    this.p3Session.sm.onApplyStart();

    // 事务快照：deep clone 当前数据（用于回滚）
    const snapshot = {
      config: JSON.parse(JSON.stringify(this.designConfig)),
      name: this.worldCardName,
      description: this.worldCardDescription,
    };

    // 标记 undo 批次开始
    if (window.P3UndoManager) {
      window.P3UndoManager.markBatchStart();
    }

    try {
      let appliedCount = 0;
      let skippedCount = 0;
      const skippedOps = [];
      let hasStep3FieldsOps = false;

      for (const op of accepted) {
        // 记录 undo 信息（在 apply 之前 deep clone 当前值）
        if (window.P3UndoManager) {
          window.P3UndoManager.recordApply(op, this.designConfig, this);
        }

        // 应用单条操作
        const result = this._applySingleP3Operation(op);
        if (result.applied) {
          op.status = 'applied';
          appliedCount++;
        } else {
          op.status = 'skipped';
          op._skipReason = result.reason || '已跳过';
          skippedCount++;
          skippedOps.push({ id: op.id, reason: result.reason });
        }

        if (op.target === 'step3_fields') hasStep3FieldsOps = true;
      }

      // 后处理统一在批次末尾执行 (D2)
      this._runP3PostProcessing();

      this._saveDesignConfig();
      this._updatePreviewPanel();

      // 记录应用摘要到对话历史
      const summaryParts = accepted
        .filter(op => op.status === 'applied')
        .map(op => op._summary || op.displayLabel)
        .filter(Boolean)
        .slice(0, 5);
      const summaryText = summaryParts.join('、');
      const lastAssistant = this.p3Session.p3History
        ? [...this.p3Session.p3History].reverse().find(h => h.role === 'assistant')
        : null;
      if (lastAssistant) {
        lastAssistant.appliedSummary = `用户已应用 ${appliedCount} 项操作: ${summaryText}`;
      }

      const rejected = ops.filter(op => op.status === 'rejected').length;

      this.p3Session.sm.onApplyComplete();
      return { applied: appliedCount, rejected, skipped: skippedCount, failed: 0, skippedOps };

    } catch (err) {
      console.error('[P3] applySelectedOperations error, rolling back:', err);

      // 回滚数据
      this.designConfig = snapshot.config;
      this.worldCardName = snapshot.name;
      this.worldCardDescription = snapshot.description;

      // 回滚 undo 栈（只清本批次，保留之前的 undo 历史）
      if (window.P3UndoManager) {
        window.P3UndoManager.rollbackBatch();
      }

      // 恢复 op status
      for (const op of accepted) {
        if (op.status === 'applied' || op.status === 'skipped') op.status = 'accepted';
      }

      this.p3Session.sm.onApplyRollback();
      return { applied: 0, rejected: 0, skipped: 0, failed: accepted.length, skippedOps: [] };
    }
  }

  /**
   * 解析 P3 操作的 path（panel_status.key → panel_status[N] 等转换）
   * @returns {string|null} 解析后的 path，null 表示 path 无法解析
   */
  _resolveP3OpPath(op) {
    const { target, path, action } = op;
    if (target === 'step3_fields' && typeof path === 'string') {
      const keyMatch = path.match(/^panel_status\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
      if (keyMatch) {
        const targetKey = keyMatch[1];
        const groups = this.designConfig.step3_fields?.panel_status;
        if (Array.isArray(groups)) {
          const idx = groups.findIndex(g => g && g.key === targetKey);
          if (idx >= 0) return `panel_status[${idx}]`;
          if (action === 'add') return 'panel_status';
          return null; // key 不存在
        }
      }
    }
    return path; // 不需转换
  }

  /**
   * 应用单条 P3 操作（从 _applyP3Operations 拆出的核心逻辑）
   * @returns {{ applied: boolean, reason?: string }}
   */
  _applySingleP3Operation(op) {
    const { target, action, value } = op;
    const resolvedPath = this._resolveP3OpPath(op);

    if (resolvedPath === null) {
      return { applied: false, reason: 'panel_status key 未找到' };
    }

    // meta 存储在实例上
    if (target === 'meta') {
      if (action === 'update') {
        if (resolvedPath === 'name') this.worldCardName = typeof value === 'string' ? value : '';
        else if (resolvedPath === 'description')
          this.worldCardDescription = typeof value === 'string' ? value : '';
      }
      return { applied: true };
    }

    // step3_fields 初始化
    if (target === 'step3_fields') {
      if (!this.designConfig.step3_fields && action !== 'delete') {
        this.designConfig.step3_fields = { panel_status: [], panel_npc: [] };
      }
    }

    const data = this.designConfig[target];
    if (!data && action !== 'add') {
      return { applied: false, reason: '目标数据不存在' };
    }

    switch (action) {
      case 'update':
        // Character database / timelines entity-level update: merge
        if (
          (target === 'character_database' || target === 'character_timelines') &&
          typeof resolvedPath === 'string' &&
          !resolvedPath.includes('.') &&
          !resolvedPath.includes('[')
        ) {
          // 检查是否为 undo 的强制替换
          if (op._forceReplace) {
            this._setNestedValue(this.designConfig, target, resolvedPath, value);
            break;
          }
          const existing = data?.[resolvedPath];
          if (existing && typeof existing === 'object' && typeof value === 'object' && value !== null) {
            data[resolvedPath] = { ...existing, ...value };
            break;
          }
        }
        // panel_status 保护
        if (target === 'step3_fields' && resolvedPath === 'panel_status' && Array.isArray(value)) {
          const CORE_KEYS = ['datetime', 'location', 'money', 'objective'];
          const existing = this.designConfig.step3_fields?.panel_status;
          if (Array.isArray(existing)) {
            for (const ck of CORE_KEYS) {
              if (!value.some(g => g && g.key === ck)) {
                const original = existing.find(g => g && g.key === ck);
                if (original) value.unshift(original);
              }
            }
          }
        }
        this._setNestedValue(this.designConfig, target, resolvedPath, value);
        break;

      case 'add':
        if (!this.designConfig[target]) this.designConfig[target] = {};
        this._addNestedValue(this.designConfig, target, resolvedPath, value);
        break;

      case 'delete': {
        // 保护核心状态字段
        if (target === 'step3_fields' && typeof resolvedPath === 'string') {
          const m = resolvedPath.match(/^panel_status\[(\d+)\]$/);
          if (m) {
            const idx = parseInt(m[1], 10);
            const groups = this.designConfig.step3_fields?.panel_status;
            if (Array.isArray(groups) && groups[idx]) {
              const PROTECTED = new Set(['datetime', 'location', 'money', 'objective']);
              if (PROTECTED.has(groups[idx].key)) {
                return { applied: false, reason: `核心字段 "${groups[idx].key}" 不可删除` };
              }
            }
          }
        }
        this._deleteNestedValue(this.designConfig, target, resolvedPath);
        break;
      }

      default:
        return { applied: false, reason: `未知操作类型: ${action}` };
    }

    return { applied: true };
  }

  /**
   * 接受操作
   */
  acceptOperation(opId) {
    const op = this.p3Session.enrichedOps.find(o => o.id === opId);
    if (!op || op.status === 'applied' || op.status === 'undone') return;
    op.status = 'accepted';
    return op;
  }

  /**
   * 拒绝操作（级联警告由 UI 层处理）
   */
  rejectOperation(opId) {
    const op = this.p3Session.enrichedOps.find(o => o.id === opId);
    if (!op || op.status === 'applied' || op.status === 'undone') return;
    op.status = 'rejected';
    return op;
  }

  /**
   * 全部接受
   */
  acceptAll() {
    for (const op of this.p3Session.enrichedOps) {
      if (op.status !== 'applied' && op.status !== 'undone') {
        op.status = 'accepted';
      }
    }
  }

  /**
   * 全部拒绝
   */
  rejectAll() {
    for (const op of this.p3Session.enrichedOps) {
      if (op.status !== 'applied' && op.status !== 'undone') {
        op.status = 'rejected';
      }
    }
  }

  /**
   * 撤销最后一条已应用的操作 (LIFO)
   */
  undoLastOperation() {
    if (!window.P3UndoManager) return null;
    const result = window.P3UndoManager.undo(this);
    if (result) {
      this._runP3PostProcessing();
      this._saveDesignConfig(); // Bug #4 fix: 同步 save，防止丢数据
      this._updatePreviewPanel();
    }
    return result;
  }

  /**
   * 撤销所有已应用的操作（闭合路径：统一走 service 层）
   */
  undoAllOperations() {
    if (!window.P3UndoManager) return 0;
    const count = window.P3UndoManager.undoAll(this);
    if (count > 0) {
      this._runP3PostProcessing();
      this._saveDesignConfig();
      this._updatePreviewPanel();
      // 状态机：全部 undo 后回到 OPS_PENDING
      if (this.p3Session.sm.getState() === P3_STATES.APPLIED) {
        this.p3Session.sm.onUndoToOps();
      }
    }
    return count;
  }

  /**
   * P3 后处理（undo/redo 后也需要执行）
   */
  _runP3PostProcessing() {
    try {
      if (this.designConfig.step3_fields) {
        // 备份元数据
        const savedWorldTermsSource = this.designConfig.step3_fields._worldTermsSource;
        const savedSource = this.designConfig.step3_fields._source;

        this._ensureCoreStatusGroups();
        this.designConfig.step3_fields.panel_npc = this._normalizePanelNpcFields(
          this.designConfig.step3_fields.panel_npc
        );

        // 回填被后处理可能覆盖的元数据
        if (savedWorldTermsSource !== undefined && !this.designConfig.step3_fields._worldTermsSource) {
          this.designConfig.step3_fields._worldTermsSource = savedWorldTermsSource;
        }
        if (savedSource !== undefined && !this.designConfig.step3_fields._source) {
          this.designConfig.step3_fields._source = savedSource;
        }
      }
    } catch (err) {
      console.error('[P3] Post-processing error (non-blocking):', err);
    }
  }

  /**
   * 编辑操作值（内联编辑）
   */
  editOperationValue(opId, newValue) {
    const op = this.p3Session.enrichedOps.find(o => o.id === opId);
    if (!op || op.status === 'applied' || op.status === 'undone') return null;
    op.value = newValue;
    // 值已更新，下次渲染 plan panel 时会使用新值
    return op;
  }

  /**
   * 操作验证：path normalization + 冲突检测 + 存在性检查
   * 在 enrichment 之后执行，结果写入 op._validationIssues
   */
  _validateP3Operations(enrichedOps) {
    const seenPaths = new Map();

    for (const op of enrichedOps) {
      const issues = [];
      const resolvedPath = this._resolveP3OpPath(op);
      const pathKey = `${op.target}::${resolvedPath || op.path}`;

      // path 解析失败
      if (resolvedPath === null) {
        issues.push({ type: 'invalid_path', message: '路径无法解析' });
      }

      // 冲突检测
      if (seenPaths.has(pathKey)) {
        const conflicting = seenPaths.get(pathKey);
        issues.push({ type: 'conflict', message: `与操作 ${conflicting.join(', ')} 冲突` });
      }
      const existing = seenPaths.get(pathKey) || [];
      existing.push(op.id);
      seenPaths.set(pathKey, existing);

      // 目标存在性（delete 操作）
      if (resolvedPath && op.action === 'delete' && op.target !== 'meta') {
        const val = window.P3DiffEngine?.getNestedValue(this.designConfig, op.target, resolvedPath);
        if (val === undefined) {
          issues.push({ type: 'delete_missing', message: '删除路径不存在' });
        }
      }

      // step3_fields 硬约束校验（与 PHASE3_SYSTEM_PROMPT 对应原则同步）
      // 用原始 op.path 做语义匹配——_resolveP3OpPath 会把 panel_status.{key} 转成 panel_status[N]，
      // 那是给 _setNestedValue 用的应用路径，不能用于语义判断。
      if (op.target === 'step3_fields' && typeof op.path === 'string') {
        const semanticPath = op.path;
        const validTemplates = ['time', 'location', 'money', 'objective', 'custom'];
        const protectedStatusKeys = ['datetime', 'location', 'money', 'objective'];
        const protectedNpcKeys = ['trigger_type', 'id', 'name', 'gender', 'origin', 'birthday', 'cognitive_state', 'msg_reply_tone'];

        if ((op.action === 'add' || op.action === 'update')
            && /^panel_status(\.[^.]+)?$/.test(semanticPath)) {
          const val = op.value;
          const groups = Array.isArray(val) ? val : (val && typeof val === 'object' ? [val] : []);
          for (const g of groups) {
            if (!g || typeof g !== 'object') continue;
            if (!g._template || !validTemplates.includes(g._template)) {
              issues.push({
                type: 'invalid_template',
                message: 'panel_status 组必须含合法 _template（time/location/money/objective/custom）',
              });
              break;
            }
          }
        }

        if (op.action === 'delete') {
          const statusMatch = semanticPath.match(/^panel_status\.(.+)$/);
          if (statusMatch && protectedStatusKeys.includes(statusMatch[1])) {
            issues.push({
              type: 'protected_field',
              message: `panel_status.${statusMatch[1]} 是核心字段组，不可删除`,
            });
          }
          const npcMatch = semanticPath.match(/^panel_npc\.(.+)$/);
          if (npcMatch && protectedNpcKeys.includes(npcMatch[1])) {
            issues.push({
              type: 'protected_field',
              message: `panel_npc.${npcMatch[1]} 是统一显示字段，不可删除`,
            });
          }
        }
      }

      if (issues.length > 0) op._validationIssues = issues;
    }
  }

  /**
   * 获取 P3 session 状态（供 UI 查询）
   */
  getP3SessionState() {
    return {
      enrichedOps: this.p3Session.enrichedOps,
      streaming: this.p3Session.sm.getState() === P3_STATES.STREAMING,
      canUndo: window.P3UndoManager ? window.P3UndoManager.canUndo() : false,
    };
  }

  /**
   * 清空 P3 session (D5) — 不清空对话历史，仅重置当前轮的操作状态
   */
  clearP3Session() {
    this.p3Session.enrichedOps = [];
    this.pendingOperations = [];
    if (window.P3UndoManager) {
      window.P3UndoManager.clear();
    }
  }

  /**
   * 重置 P3 对话历史（阶段切换时调用）
   */
  resetP3History() {
    this.p3Session.p3History = [];
  }

}

/**
 * 截断 JSON 括号平衡修复：扫描字符串，统计未闭合的 {} 与 []，按顺序补齐结尾。
 * 处理流式 EDIT_OPERATIONS 被截断的场景。
 * 返回补全后的字符串；若字符串为空或字符串内未闭合（双引号），返回 null。
 */
function _balanceJsonBrackets(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let s = input.replace(/[,\s]+$/, ''); // 去尾部逗号或空白
  const stack = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') stack.pop();
  }
  if (inString) return null; // 字符串内被截断，无法可靠恢复
  // 移除可能的悬空逗号
  s = s.replace(/,\s*$/, '');
  while (stack.length > 0) {
    s += stack.pop();
  }
  return s;
}

_applyDesignServiceMixin(_DesignServiceP3Mixin);
