/**
 * design/p1.js
 * Phase 1 (The Architect) — 框架采集对话 + 阶段过渡 + 部分 P3/P2 杂项方法
 *
 * 通过 mixin 模式扩展 DesignService.prototype。所有方法实现与原 class
 * DesignService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyDesignServiceMixin 合并到 DesignService 上。
 *
 * 注意：本文件按原 designService.js 中标记为 "Phase 1: The Architect" 的
 * 区段整体抽出，区段内除了真正的 P1 框架采集方法外，还混入了若干 P3 操作
 * 应用方法（acceptOperation 等）和 Phase 2 辅助函数。后续如需进一步按职责
 * 拆分，可在此基础上做二次切分。
 *
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceP1Mixin {
  // ========================================
  // Phase 1: The Architect — 框架采集对话
  // ========================================

  /**
   * Phase 1 对话：发送消息并获取 AI 回复
   * AI 可能在回复中包含 FRAMEWORK_READY 标记，表示框架采集完成
   * @param {string} userMessage - 用户消息
   * @param {Array} history - 聊天历史
   * @returns {Promise<{text: string, frameworkReady: boolean, frameworkRejected: boolean, frameworkIssues: Array, frameworkIssueSummary: string, p1ThinkingFull: string, p1ThinkingPreview: string, p1Questions: Array, p1QuestionGoal: string}>}
   */
  async sendP1Message(_userMessage, history, options = {}) {
    if (this.isProcessing) throw new Error('正在处理中，请稍候');
    this._assertDesignApiKeyConfigured();
    this.isProcessing = true;
    const requestAbortController = new AbortController();
    this.designRequestAbortController = requestAbortController;
    let externalAbortHandler = null;
    const externalAbortSignal =
      typeof AbortSignal !== 'undefined' && options?.abortSignal instanceof AbortSignal
        ? options.abortSignal
        : null;
    if (externalAbortSignal) {
      externalAbortHandler = () => {
        try {
          requestAbortController.abort(new Error('Phase 1 cancelled'));
        } catch (_e) {
          /* ignore */
        }
      };
      if (externalAbortSignal.aborted) {
        externalAbortHandler();
      } else {
        externalAbortSignal.addEventListener('abort', externalAbortHandler);
      }
    }

    try {
      // STEP 1: 状态机处理用户消息 + 证据提取
      const userText = this._getLastUserText(history);
      this.p1State.onUserMessage(userText);
      this._extractAndRecordEvidence(history);

      // 合法状态断言
      if (!this.p1State.isValidCallState()) {
        console.warn('[P1] sendP1Message called in unexpected state:', this.p1State.getState());
      }

      // STEP 2: 构建状态感知的 system prompt
      const systemPrompt = this._buildP1SystemPrompt();

      // STEP 3: 格式化消息并调用 AI
      const messages = this._formatMessages(history);
      let response = await aiService._callSummaryAPI(messages, systemPrompt, 'p1', {
        abortSignal: requestAbortController.signal,
      });

      if (aiService.lastDesignPayload) {
        aiService.lastDesignPayload.response = response;
      }

      // STEP 4: 解析 AI 响应
      let parsed = this._parseP1Response(response);

      // AI 偶尔把 marker 写成残缺形式（如 <<>），用同样的 messages 静默重试一次
      if (parsed.parseFailed && !requestAbortController.signal.aborted) {
        try {
          const retryResponse = await aiService._callSummaryAPI(messages, systemPrompt, 'p1', {
            abortSignal: requestAbortController.signal,
          });
          const retryParsed = this._parseP1Response(retryResponse);
          if (!retryParsed.parseFailed) {
            response = retryResponse;
            parsed = retryParsed;
            if (aiService.lastDesignPayload) {
              aiService.lastDesignPayload.response = retryResponse;
            }
          }
        } catch (retryErr) {
          if (retryErr.name === 'AbortError' || requestAbortController.signal.aborted) {
            throw retryErr;
          }
          console.warn('[P1] retry call failed, falling back to first response:', retryErr);
        }
      }

      let { text, framework, p1Thinking = '', p1Questions = [], p1QuestionGoal = '' } = parsed;

      let frameworkRejected = false;
      let frameworkIssues = [];
      let frameworkIssueSummary = '';

      // STEP 5: getExpectedAiOutputType 前置校验——防止 AI 过早输出框架
      const expectedType = this.p1State.getExpectedAiOutputType();
      if (framework && expectedType === 'questions') {
        console.warn('[P1StateMachine] AI 在状态', this.p1State.getState(), '输出了 FRAMEWORK_READY，拒绝');
        framework = null;
        text = [text, '⚠️ 信息收集尚未完成，让我们继续补齐关键问题。'].filter(Boolean).join('\n\n');
      }

      // STEP 6: 框架验证
      if (framework) {
        const frameworkValidation = this._validateP1Framework(framework);
        if (!frameworkValidation.ok) {
          this._lastRejectedFramework = framework;
          frameworkRejected = true;
          frameworkIssues = Array.isArray(frameworkValidation.issues) ? [...frameworkValidation.issues] : [];
          frameworkIssueSummary = typeof frameworkValidation.issueSummary === 'string' ? frameworkValidation.issueSummary : '';
          framework = null;
          const issueText = frameworkIssues.join('；');
          text = [text, `⚠️ 我检测到框架信息还不完整（${issueText}），先继续补齐关键问题。`].filter(Boolean).join('\n\n');
          if (!p1Thinking) {
            p1Thinking = '我检查了当前框架，发现还有关键维度缺失或过短。下一轮我会聚焦补齐这些缺口，再继续推进。';
          }
          if (!Array.isArray(p1Questions) || p1Questions.length === 0) {
            p1Questions = this._buildFallbackP1Questions(frameworkValidation.missingTargets || []);
          }
          if (!p1QuestionGoal) {
            p1QuestionGoal = '补齐框架缺失维度';
          }
        }
      }

      // STEP 7: 规范化问题 + 强制 target 约束
      let normalizedQuestions = this._normalizeP1Questions(p1Questions);
      normalizedQuestions = this._enforceQuestionTargets(normalizedQuestions);

      if (!framework && normalizedQuestions.length === 0) {
        // 生成 fallback 问题（基于状态机允许的 targets）
        const allowed = this.p1State.getAllowedTargets();
        const evidence = this.p1State.getDimensionEvidence();
        const fallbackTargets = allowed
          .filter(t => !t.startsWith('_'))
          .sort((a, b) => (evidence[a]?.rounds || 0) - (evidence[b]?.rounds || 0));
        // lite 模式特殊处理
        if (this.p1State.getMode() === 'lite' && fallbackTargets.length === 0) {
          normalizedQuestions = this._buildFallbackP1Questions(['_upgrade']);
        } else {
          normalizedQuestions = this._buildFallbackP1Questions(
            fallbackTargets.length > 0 ? fallbackTargets : allowed
          );
        }
      }

      const p1ThinkingPreview = this._buildP1ThinkingPreview(p1Thinking, text);

      // STEP 8: 框架通过——通知状态机并保存
      if (framework) {
        this.p1State.onFrameworkReady(framework);
        this.p1Output = framework;
        const complexity = this._normalizeComplexity(framework.complexity) || 'full';
        this.p1State.onModeSelected(complexity);
        this.designTargetStages = framework.target_stages || (complexity === 'lite' ? 3 : 4);
        this.designConfig._complexity = complexity;
        this.designConfig._targetStages = this.designTargetStages;
        if (!this.designConfig.step3_fields) {
          this._applyWorldTermsToStep3Fields(framework.world_terms || {});
        }
        this._saveDesignConfig();
        return {
          text,
          frameworkReady: true,
          frameworkRejected: false,
          frameworkIssues: [],
          frameworkIssueSummary: '',
          p1ThinkingFull: typeof p1Thinking === 'string' ? p1Thinking.trim() : '',
          p1ThinkingPreview,
          p1Questions: normalizedQuestions,
          p1QuestionGoal: p1QuestionGoal || '',
        };
      }

      // STEP 9: 非框架路径——状态机处理 AI 响应，推进轮次
      // 注意：传入的是 _enforceQuestionTargets 清洗后的 questions，
      // 这是有意为之——状态机基于合规 targets 做转换决策（如 _upgrade 检测）
      this.p1State.onAiResponse({ questions: normalizedQuestions, hasFramework: false });
      this._saveDesignConfig();
      return {
        text,
        frameworkReady: false,
        frameworkRejected,
        frameworkIssues,
        frameworkIssueSummary,
        p1ThinkingFull: typeof p1Thinking === 'string' ? p1Thinking.trim() : '',
        p1ThinkingPreview,
        p1Questions: normalizedQuestions,
        p1QuestionGoal: p1QuestionGoal || '',
      };
    } catch (err) {
      console.error('[P1] sendP1Message error:', err);
      throw err;
    } finally {
      if (externalAbortSignal && externalAbortHandler) {
        externalAbortSignal.removeEventListener('abort', externalAbortHandler);
      }
      if (this.designRequestAbortController === requestAbortController) {
        this.designRequestAbortController = null;
      }
      this.isProcessing = false;
    }
  }

  /**
   * 从聊天历史中获取最后一条用户消息文本
   */
  _getLastUserText(history) {
    if (!Array.isArray(history)) return '';
    const last = [...history].reverse().find(m => m.sender === 'user');
    return typeof last?.text === 'string' ? last.text : '';
  }

  /**
   * 证据提取：解析用户回答并记录到状态机
   * 替代旧的 _detectModeFromHistory + _updateDimensionCoverage
   */
  _extractAndRecordEvidence(history) {
    if (!Array.isArray(history) || !this.p1State) return;
    const lastUserMsg = [...history].reverse().find(m => m.sender === 'user');
    if (!lastUserMsg) return;

    const text = typeof lastUserMsg.text === 'string' ? lastUserMsg.text : '';
    if (!text.trim()) return;

    if (text.includes('【回答当前轮问题】')) {
      // 打包格式：解析 Q/A 对，匹配到对应 question 的 target
      const pairs = this._parsePackedAnswerPairs(text);
      const lastAiMsg = [...history].reverse().find(m => m.sender === 'ai' && Array.isArray(m.p1Questions));
      const questions = lastAiMsg?.p1Questions || [];

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const answer = pairs[i]?.answer || '';
        if (!answer || answer === P1_FLOW_SKIP_ANSWER_TEXT) continue;

        // 特殊 target：触发状态机转换（不记录为维度证据）
        if (q.target === '_mode') {
          const mode = this._detectModeFromAnswer(answer);
          if (mode) this.p1State.onModeSelected(mode);
          continue;
        }
        if (q.target === '_upgrade') {
          const switchToFull = /深度|定制|切换|full/i.test(answer);
          this.p1State.onUpgradeDecision(switchToFull);
          continue;
        }
        if (q.target === 'style_guide') {
          this.p1State.onStyleSelected(answer);
        }

        // 普通维度 target：记录证据
        if (q.target && this.p1State.getDimensionEvidence()[q.target]) {
          this.p1State.recordEvidence(q.target, answer);
        }
      }
    } else {
      // 自由文本：根据当前状态和最近问题 targets 归因
      const targets = this.p1State.lastAiQuestionTargets;
      const state = this.p1State.getState();

      if (state === P1_STATES.R2_PENDING || state === P1_STATES.R2_ANSWERED) {
        // R2 状态下自由文本：尝试关键词匹配模式选择
        const mode = this._detectModeFromAnswer(text);
        if (mode) this.p1State.onModeSelected(mode);
        this.p1State.recordEvidence('style_guide', text);
      } else if (targets.length === 1 && text.trim().length > 10) {
        const t = targets[0];
        if (t && !t.startsWith('_') && this.p1State.getDimensionEvidence()[t]) {
          this.p1State.recordEvidence(t, text);
        }
      } else if (targets.length > 1 && text.trim().length > 10) {
        for (const t of targets) {
          if (t && !t.startsWith('_') && this.p1State.getDimensionEvidence()[t]) {
            this.p1State.recordEvidence(t, text, { weight: 0.5 });
          }
        }
      }
    }
  }

  /**
   * 从回答文本中检测模式选择
   */
  _detectModeFromAnswer(answerText) {
    const text = (typeof answerText === 'string' ? answerText : '').toLowerCase();
    if (text.includes('快速') || text.includes('lite')) return 'lite';
    if (text.includes('深度') || text.includes('full') || text.includes('定制')) return 'full';
    return null;
  }

  /**
   * 解析打包回答中的 Q/A 对
   */
  _parsePackedAnswerPairs(text) {
    const lines = String(text).replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const qMap = {};
    const aMap = {};
    for (const line of lines) {
      const qMatch = line.match(/^Q\s*(\d+)\s*[：:]\s*(.*)$/i);
      const aMatch = line.match(/^A\s*(\d+)\s*[：:]\s*(.*)$/i);
      if (qMatch) qMap[qMatch[1]] = qMatch[2];
      else if (aMatch) aMap[aMatch[1]] = aMatch[2];
    }
    const pairs = [];
    for (const idx of Object.keys(qMap).sort((a, b) => +a - +b)) {
      pairs.push({ question: qMap[idx], answer: aMap[idx] || '' });
    }
    return pairs;
  }

  /**
   * 代码侧硬约束：AI 返回的 questions 如果 target 不在允许范围内，自动重映射
   */
  _enforceQuestionTargets(questions) {
    if (!this.p1State || !Array.isArray(questions)) return questions;
    const allowed = new Set(this.p1State.getAllowedTargets());
    if (allowed.size === 0) return questions; // 没有限制时跳过
    return questions.map(q => {
      if (q.target && !allowed.has(q.target)) {
        console.warn(`[P1StateMachine] Target "${q.target}" not allowed in state ${this.p1State.getState()}, remapping`);
        const contentTargets = [...allowed].filter(t => !t.startsWith('_'));
        q.target = contentTargets[0] || [...allowed][0] || q.target;
      }
      return q;
    });
  }

  /**
   * 解析 Phase 1 响应，提取框架数据
   */
  _parseP1Response(response) {
    const source = typeof response === 'string' ? response : '';
    // AI 偶尔会把 <<< 写成 << 或把 >>> 写成 >>，允许 2-4 个尖括号（与 P3 一致）
    const frameworkPattern = /<{2,4}FRAMEWORK_READY>{2,4}\s*([\s\S]*?)\s*<{2,4}END_FRAMEWORK_READY>{2,4}/;
    const frameworkMatch = source.match(frameworkPattern);

    let framework = null;
    let withoutFramework = source;
    if (frameworkMatch) {
      withoutFramework = source.replace(frameworkPattern, '').trim();
      try {
        framework = JSON.parse(frameworkMatch[1]);
      } catch (e) {
        console.warn('[DesignService] P1 框架 JSON 解析失败:', e);
      }
    }

    const thinkingExtract = this._extractTaggedBlock(withoutFramework, 'P1_THINKING');
    const questionsExtract = this._extractTaggedBlock(thinkingExtract.text, 'P1_QUESTIONS');
    const questionParsed = this._parseP1Questions(questionsExtract.block);
    let text = typeof questionsExtract.text === 'string' ? questionsExtract.text.trim() : '';

    if (frameworkMatch && !framework) {
      text = [text, '⚠️ 框架数据解析失败，请继续补齐后重试。'].filter(Boolean).join('\n\n');
    }

    // 检测 AI 想写 marker 但写炸的情况（用于触发静默重试）
    const intendedFramework =
      /<+\s*FRAMEWORK_READY/.test(source) || /<+\s*END_FRAMEWORK_READY/.test(source);
    const intendedThinking =
      /<+\s*P1_THINKING/.test(source) || /<+\s*END_P1_THINKING/.test(source);
    const intendedQuestions =
      /<+\s*P1_QUESTIONS/.test(source) || /<+\s*END_P1_QUESTIONS/.test(source);
    const frameworkBroken = intendedFramework && (!frameworkMatch || !framework);
    const thinkingBroken = intendedThinking && !thinkingExtract.block;
    const questionsBroken = intendedQuestions && !questionsExtract.block;
    const parseFailed = frameworkBroken || thinkingBroken || questionsBroken;

    return {
      text,
      framework,
      p1Thinking: typeof thinkingExtract.block === 'string' ? thinkingExtract.block.trim() : '',
      p1Questions: questionParsed.questions,
      p1QuestionGoal: questionParsed.goal,
      parseFailed,
    };
  }

  _extractTaggedBlock(text, tag) {
    const source = typeof text === 'string' ? text : '';
    const safeTag = String(tag || '').trim();
    if (!safeTag) return { text: source, block: '' };
    // AI 偶尔会把 <<< 写成 << 或把 >>> 写成 >>，允许 2-4 个尖括号（与 P3 一致）
    const pattern = new RegExp(`<{2,4}${safeTag}>{2,4}\\s*([\\s\\S]*?)\\s*<{2,4}END_${safeTag}>{2,4}`, 'i');
    const match = source.match(pattern);
    if (!match) {
      return { text: source, block: '' };
    }
    return {
      text: source.replace(pattern, '').trim(),
      block: match[1] || '',
    };
  }

  _parseP1Questions(rawText) {
    const source = typeof rawText === 'string' ? rawText.trim() : '';
    if (!source) {
      return { goal: '', questions: [] };
    }

    let parsed = null;
    const parsedResult = this._extractJSON(source, { includeMeta: true, silent: true });
    if (
      parsedResult.parsed &&
      typeof parsedResult.parsed === 'object' &&
      !Array.isArray(parsedResult.parsed)
    ) {
      parsed = parsedResult.parsed;
    } else {
      const normalizedSource = source.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
      const normalizedResult = this._extractJSON(normalizedSource, {
        includeMeta: true,
        silent: true,
      });
      if (
        normalizedResult.parsed &&
        typeof normalizedResult.parsed === 'object' &&
        !Array.isArray(normalizedResult.parsed)
      ) {
        parsed = normalizedResult.parsed;
      }
    }

    if (!parsed) {
      const lineQuestions = source
        .split('\n')
        .map(line => line.trim().replace(/^[\-\d\.\)\s]+/, ''))
        .filter(Boolean)
        .filter(line => /[？?]$/.test(line))
        .slice(0, 2)
        .map((text, idx) => ({ id: `q${idx + 1}`, text, target: '', required: true }));
      return {
        goal: '补齐框架关键信息',
        questions: this._normalizeP1Questions(lineQuestions),
      };
    }

    const goal = typeof parsed.goal === 'string' ? parsed.goal.trim() : '';
    const questionList = Array.isArray(parsed.questions)
      ? parsed.questions
      : parsed.question && typeof parsed.question === 'object'
        ? [parsed.question]
        : [];
    const normalized = questionList.map((q, idx) => {
      const text =
        typeof q?.text === 'string' ? q.text : typeof q?.question === 'string' ? q.question : '';
      const rawOptions = Array.isArray(q?.options)
        ? q.options
        : Array.isArray(q?.choices)
          ? q.choices
          : [];
      return {
        id: typeof q?.id === 'string' ? q.id : `q${idx + 1}`,
        text,
        target: this._normalizeP1QuestionTarget(q?.target),
        required: q?.required !== false,
        options: rawOptions,
      };
    });

    return {
      goal,
      questions: this._normalizeP1Questions(normalized),
    };
  }

  _normalizeP1QuestionTarget(target) {
    if (typeof target !== 'string') return '';
    const normalized = target.trim().toLowerCase();
    const allowedTargets = new Set([
      'context_world',
      'context_rules',
      'context_chars',
      'context_timeline',
      'style_guide',
      '_mode',
      '_upgrade',
    ]);
    return allowedTargets.has(normalized) ? normalized : '';
  }

  _normalizeP1Options(options, target = '') {
    const list = Array.isArray(options) ? options : [];
    const normalized = [];
    const seenText = new Set();

    for (const item of list) {
      const text =
        typeof item === 'string'
          ? item.trim()
          : typeof item?.text === 'string'
            ? item.text.trim()
            : typeof item?.label === 'string'
              ? item.label.trim()
              : '';
      if (!text) continue;
      const key = text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      normalized.push({
        id:
          typeof item?.id === 'string' && item.id.trim()
            ? item.id.trim()
            : String.fromCharCode(97 + normalized.length),
        text: text.slice(0, 120),
      });
      if (normalized.length >= 3) break;
    }

    // AI 提供了多少选项就用多少，不再强制填充 fallback
    return normalized
      .slice(0, 3)
      .map((opt, idx) => ({ ...opt, id: String.fromCharCode(97 + idx) }));
  }

  _normalizeP1Questions(questions) {
    const list = Array.isArray(questions) ? questions : [];
    const normalized = [];
    const seenText = new Set();
    for (const item of list) {
      const text = typeof item?.text === 'string' ? item.text.trim() : '';
      if (!text) continue;
      const textKey = text.toLowerCase();
      if (seenText.has(textKey)) continue;
      seenText.add(textKey);
      const target = this._normalizeP1QuestionTarget(item?.target);
      normalized.push({
        id:
          typeof item?.id === 'string' && item.id.trim()
            ? item.id.trim()
            : `q${normalized.length + 1}`,
        text: text.slice(0, 220),
        target,
        required: item?.required !== false,
        options: this._normalizeP1Options(item?.options, target),
      });
      if (normalized.length >= 2) break;
    }

    return normalized.slice(0, 2).map((q, idx) => ({
      ...q,
      id: `q${idx + 1}`,
      options: this._normalizeP1Options(q.options, q.target),
    }));
  }

  _buildFallbackP1Options(target = '') {
    const normalizedTarget = this._normalizeP1QuestionTarget(target);
    const byTarget = {
      context_world: [
        '我先补世界类型和关键地点',
        '我先补主要势力关系',
        '你先按保守默认值补世界设定',
      ],
      context_rules: ['我先补核心玩法方向', '我先补经济和战斗规则', '你先按保守默认值补规则系统'],
      context_chars: ['我先补关键角色设定', '我先补角色关系网络', '你先按保守默认值补角色概念'],
      context_timeline: ['我先补关键历史事件', '我先补当前局势和钩子', '你先按保守默认值补时间线'],
      style_guide: ['我先补叙事风格和语气', '我先补内容尺度和禁区', '你先按保守默认值补风格基调'],
      _mode: ['🚀 快速模式 — 聚焦角色和故事风格，世界规则由我自动补全', '🔧 深度定制 — 从世界观、规则、势力、时间线到角色全面定制'],
      _upgrade: ['直接开始生成', '切换到深度定制'],
    };
    const defaults = ['我先补一个明确方向', '你先给我一个推荐方向', '你先按保守默认值继续'];
    const source = byTarget[normalizedTarget] || defaults;
    return source.slice(0, 3).map((text, idx) => ({
      id: String.fromCharCode(97 + idx),
      text,
    }));
  }

  _buildFallbackP1Questions(missingTargets = []) {
    const targetQueue = Array.isArray(missingTargets) ? missingTargets : [];
    const targetToQuestion = {
      context_world: '这个世界最关键的地点和势力关系，你希望如何设定？',
      context_rules: '你希望游戏的核心规则偏向哪种？例如经济、战斗或成长。',
      context_chars: '你希望先确定哪些关键角色？他们之间是什么关系？',
      context_timeline: '这个世界从过去到现在，最关键的事件有哪些？',
      style_guide: '你希望叙事风格和内容尺度是什么？有没有明确禁区？',
      _mode: '你希望用快速模式还是深度定制来创建这个世界？',
      _upgrade: '角色和风格已就绪。要直接开始生成，还是切换到深度定制进一步定制世界观？',
    };

    const questions = [];
    for (const target of targetQueue) {
      const normalizedTarget = this._normalizeP1QuestionTarget(target);
      if (!normalizedTarget || !targetToQuestion[normalizedTarget]) continue;
      questions.push({
        id: `q${questions.length + 1}`,
        text: targetToQuestion[normalizedTarget],
        target: normalizedTarget,
        required: true,
        options: this._buildFallbackP1Options(normalizedTarget),
      });
      if (questions.length >= 2) break;
    }

    // 不再用元级别默认问题填充：只返回 missingTargets 对应的实际问题
    return questions.slice(0, 2).map((q, idx) => ({
      ...q,
      id: `q${idx + 1}`,
      options: this._normalizeP1Options(q.options, q.target),
    }));
  }

  _buildP1ThinkingPreview(thinkingText, fallbackText = '') {
    const thinking = typeof thinkingText === 'string' ? thinkingText.trim() : '';
    const fallback = typeof fallbackText === 'string' ? fallbackText.trim() : '';
    const source = thinking || fallback;
    if (!source) return '';
    const normalized = source.replace(/\s+/g, ' ').trim();
    if (normalized.length <= P1_THINKING_PREVIEW_MAX_LEN) return normalized;
    return `${normalized.slice(0, P1_THINKING_PREVIEW_MAX_LEN)}…`;
  }

  _summarizeP1FrameworkIssues(issues) {
    const normalizedIssues = Array.isArray(issues)
      ? issues
          .filter(item => typeof item === 'string')
          .map(item => item.trim())
          .filter(Boolean)
      : [];
    if (normalizedIssues.length === 0) return '';
    if (normalizedIssues.length <= 2) return normalizedIssues.join('；');
    return `${normalizedIssues.slice(0, 2).join('；')}；等 ${normalizedIssues.length} 项`;
  }

  _validateP1Framework(framework) {
    const issues = [];
    const missingTargets = [];
    if (!framework || typeof framework !== 'object' || Array.isArray(framework)) {
      const baseIssues = ['FRAMEWORK_READY 不是合法对象'];
      return {
        ok: false,
        issues: baseIssues,
        issueSummary: this._summarizeP1FrameworkIssues(baseIssues),
        missingTargets: ['context_world', 'context_rules'],
      };
    }

    const complexity = this._normalizeComplexity(framework.complexity);
    // 根据复杂度确定哪些字段需要严格验证长度
    const strictFields = complexity === 'lite'
      ? ['context_chars', 'style_guide']
      : ['context_world', 'context_rules', 'context_chars', 'context_timeline', 'style_guide'];
    // 按复杂度分级验证阈值：lite 允许更短的字段（用户可能跳过某些维度）
    const minFieldLen = complexity === 'lite' ? 20 : P1_FRAMEWORK_MIN_FIELD_LEN; // 80 for full

    const requiredFields = [
      'context_world',
      'context_rules',
      'context_chars',
      'context_timeline',
      'style_guide',
    ];
    const P1_PLACEHOLDER_RE = /^[\s\-—_…。.、,，]+$|^(待补充|TODO|TBD|placeholder|待定|暂无)/i;
    for (const field of requiredFields) {
      const value = framework[field];
      const text = typeof value === 'string' ? value.trim() : '';
      const isStrict = strictFields.includes(field);
      if (!text) {
        // 非严格字段允许为空（lite 的 timeline/rules）
        if (isStrict) {
          issues.push(`${field} 为空`);
          missingTargets.push(field);
        }
      } else if (P1_PLACEHOLDER_RE.test(text)) {
        if (isStrict) {
          issues.push(`${field} 包含占位文本`);
          missingTargets.push(field);
        }
      } else if (isStrict && text.length < minFieldLen) {
        issues.push(`${field} 内容过短`);
        missingTargets.push(field);
      }
    }

    const worldTerms = framework.world_terms;
    if (!worldTerms || typeof worldTerms !== 'object' || Array.isArray(worldTerms)) {
      issues.push('world_terms 缺失');
      missingTargets.push('context_world');
    } else {
      const currencyName =
        typeof worldTerms.currency_name === 'string' ? worldTerms.currency_name.trim() : '';
      const calendarEra =
        typeof worldTerms.calendar_era === 'string' ? worldTerms.calendar_era.trim() : '';
      const timePrecision = this._normalizeWorldTimePrecision(worldTerms.time_precision);
      const calendarUnits = Array.isArray(worldTerms.calendar_units)
        ? worldTerms.calendar_units
        : [];
      const locationLevels = Array.isArray(worldTerms.location_levels)
        ? worldTerms.location_levels
        : [];
      if (!currencyName) issues.push('world_terms.currency_name 缺失');
      if (!calendarEra) issues.push('world_terms.calendar_era 缺失');
      if (!timePrecision) issues.push('world_terms.time_precision 缺失、非法或不是固定值 time');
      if (calendarUnits.length < 3) issues.push('world_terms.calendar_units 数量不足');
      if (locationLevels.length < 3) issues.push('world_terms.location_levels 数量不足');
      if (
        !currencyName ||
        !calendarEra ||
        !timePrecision ||
        calendarUnits.length < 3 ||
        locationLevels.length < 3
      ) {
        missingTargets.push('context_world');
      }
      // extra_status_groups / extra_char_fields 结构校验（软性警告，不阻断框架）
      if (Array.isArray(worldTerms.extra_status_groups)) {
        for (const group of worldTerms.extra_status_groups) {
          if (
            !group?.key ||
            !group?.label ||
            !Array.isArray(group?.fields) ||
            group.fields.length === 0
          ) {
            console.warn(
              '[DesignService] extra_status_groups 中存在结构不完整的条目，将在应用时自动过滤'
            );
            break;
          }
        }
      }
      if (Array.isArray(worldTerms.extra_char_fields)) {
        for (const field of worldTerms.extra_char_fields) {
          if (!field?.key || !field?.label) {
            console.warn(
              '[DesignService] extra_char_fields 中存在结构不完整的条目，将在应用时自动过滤'
            );
            break;
          }
        }
      }

      // extra_char_fields 空值检查：lite 或现代现实题材可为空
      const extraCharFields = Array.isArray(worldTerms.extra_char_fields)
        ? worldTerms.extra_char_fields
        : [];
      const charsEvidence = this.p1State ? this.p1State.getDimensionEvidence().context_chars : null;
      if (extraCharFields.length === 0 && complexity !== 'lite' && (!charsEvidence || charsEvidence.confidence !== 'sufficient')) {
        issues.push('extra_char_fields 为空（角色需要哪些自定义追踪属性？请与用户确认）');
        missingTargets.push('context_chars');
      }
    }

    return {
      ok: issues.length === 0,
      issues,
      issueSummary: this._summarizeP1FrameworkIssues(issues),
      missingTargets: [...new Set(missingTargets)],
    };
  }

  /**
   * 从 world_terms 自动推断并填充 step3_fields
   * 防御性逐字段校验，无效值静默跳过保持默认
   */
  _normalizeWorldTimePrecision(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    return normalized === 'time' ? 'time' : '';
  }

  _getDefaultTimeSegments() {
    return [];
  }

  _normalizeWorldTimeSegments(value) {
    if (!Array.isArray(value)) return [];
    const normalized = [];
    const seen = new Set();
    for (const raw of value) {
      if (typeof raw !== 'string') continue;
      const text = raw.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      normalized.push(text);
    }
    return normalized;
  }

  _getNpcDisplayCoreFields() {
    const builderFields = Array.isArray(window.step3SchemaBuilder?.NPC_DISPLAY_CORE_FIELDS)
      ? window.step3SchemaBuilder.NPC_DISPLAY_CORE_FIELDS
      : null;
    if (builderFields && builderFields.length > 0) {
      return JSON.parse(JSON.stringify(builderFields));
    }
    return [
      {
        key: 'trigger_type',
        label: '触发类型',
        desc: 'NEW=首次登场；UPDATE=状态变化；NEW_PREDEFINED=预定义角色首次登场',
        type: 'string',
        enum: ['NEW', 'UPDATE', 'NEW_PREDEFINED'],
        fixed: true,
        runtimeRequired: true,
      },
      { key: 'id', label: '标识符', type: 'string', fixed: true, runtimeRequired: true },
      { key: 'name', label: '角色名', type: 'string', fixed: true, runtimeRequired: true },
      {
        key: 'gender',
        label: '性别',
        desc: '如：女/男/未知',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'origin',
        label: '来历',
        desc: '一句话说明出身或来源',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'birthday',
        label: '生日',
        desc: '纯时间值，格式必须符合当前世界历法',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
        nullable: true,
      },
      {
        key: 'cognitive_state',
        label: '认知状态',
        desc: '角色当前认为自己是谁',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'msg_reply_tone',
        label: '说话语气',
        desc: '稳定说话风格，不写当前情绪',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
    ];
  }

  _getNpcDisplayCoreKeySet() {
    return new Set(this._getNpcDisplayCoreFields().map(field => field.key));
  }

  _getNpcReservedKeySet() {
    return new Set([...this._getNpcDisplayCoreKeySet(), 'age']);
  }

  _getNpcRuntimeRequiredKeySet() {
    const builderKeys = Array.isArray(window.step3SchemaBuilder?.NPC_RUNTIME_REQUIRED_KEYS)
      ? window.step3SchemaBuilder.NPC_RUNTIME_REQUIRED_KEYS
      : null;
    return new Set(
      builderKeys && builderKeys.length > 0 ? builderKeys : ['trigger_type', 'id', 'name']
    );
  }

  _normalizePanelNpcFields(panelNpcFields) {
    const coreFields = this._getNpcDisplayCoreFields();
    const coreKeySet = this._getNpcReservedKeySet();
    const seenKeys = new Set(coreKeySet);
    const customFields = [];
    const sourceFields = Array.isArray(panelNpcFields) ? panelNpcFields : [];

    for (const field of sourceFields) {
      if (!field || typeof field !== 'object') continue;
      if (typeof field.key !== 'string' || !field.key.trim()) continue;
      if (typeof field.label !== 'string' || !field.label.trim()) continue;
      const key = field.key.trim();
      if (coreKeySet.has(key)) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const normalizedField = {
        key,
        label: field.label.trim(),
        type: field.type || 'string',
      };
      if (typeof field.desc === 'string' && field.desc.trim()) {
        normalizedField.desc = field.desc.trim();
      }
      if (Array.isArray(field.enum) && field.enum.length > 0) {
        normalizedField.enum = field.enum;
      }
      if (field.nullable === true) {
        normalizedField.nullable = true;
      }
      customFields.push(normalizedField);
    }

    return [...coreFields, ...customFields];
  }

  _applyWorldTermsToStep3Fields(worldTerms) {
    if (!worldTerms || typeof worldTerms !== 'object') return;

    const builder = window.step3SchemaBuilder;
    if (!builder) return;

    const locale = window.i18nService?.getDesignLanguage?.() || 'zh-CN';
    const statusFields =
      typeof builder.getDefaultStatusFields === 'function'
        ? builder.getDefaultStatusFields(locale)
        : JSON.parse(JSON.stringify(builder.DEFAULT_STATUS_FIELDS));

    try {
      // 货币名称 → money 组的 amount 字段 label（兼容旧 player_state 组）
      const currency =
        typeof worldTerms.currency_name === 'string' && worldTerms.currency_name.trim();
      if (currency) {
        const moneyGroup =
          statusFields.find(g => g.key === 'money') ||
          statusFields.find(g => g.key === 'player_state');
        if (moneyGroup) {
          if (moneyGroup.fields) {
            const moneyField =
              moneyGroup.fields.find(f => f.key === 'amount') ||
              moneyGroup.fields.find(f => f.key === 'money');
            if (moneyField) moneyField.label = currency;
          }
          // 传播 _currency 元标签
          moneyGroup._currency = currency;
        }
      }

      // 纪年体系 → datetime 组的字段 labels + _era 元标签
      const calendarUnits = Array.isArray(worldTerms.calendar_units)
        ? worldTerms.calendar_units
        : null;
      const calendarEra =
        typeof worldTerms.calendar_era === 'string' && worldTerms.calendar_era.trim();
      const timePrecision = this._normalizeWorldTimePrecision(worldTerms.time_precision) || 'time';
      const dtGroup = statusFields.find(g => g.key === 'datetime');
      if (dtGroup) {
        dtGroup._precision = timePrecision;
        const baseTimeFields = [
          { key: 'year', label: '年份', type: 'integer' },
          { key: 'month', label: '月份', type: 'integer' },
          { key: 'day', label: '日期', type: 'integer' },
          { key: 'hour', label: '时', type: 'integer' },
          { key: 'minute', label: '分', type: 'integer' },
        ];
        const precisionFieldCount = { year: 1, month: 2, day: 3, time: 5 };
        dtGroup.fields = baseTimeFields.slice(0, precisionFieldCount[timePrecision] || 3);
        delete dtGroup._time_segments;
        // 写入 _era 元标签
        if (calendarEra) {
          dtGroup._era = calendarEra;
        }
        if (dtGroup.fields) {
          // calendar_units 覆盖前 N 个字段 label（year, month, day），hour/minute 保持默认
          if (calendarUnits) {
            const editableFields = dtGroup.fields.filter(
              f => f.key !== 'hour' && f.key !== 'minute'
            );
            const len = Math.min(calendarUnits.length, editableFields.length);
            for (let i = 0; i < len; i++) {
              const unit = typeof calendarUnits[i] === 'string' && calendarUnits[i].trim();
              if (unit) editableFields[i].label = unit;
            }
          } else if (calendarEra) {
            // 仅有 era 名称时，修改 year 字段 label
            const yearField = dtGroup.fields.find(f => f.key === 'year');
            if (yearField) yearField.label = calendarEra;
          }
        }
      }

      // 地点层级 → location 组的字段 labels
      const locLevels = Array.isArray(worldTerms.location_levels)
        ? worldTerms.location_levels
        : null;
      if (locLevels) {
        const locGroup = statusFields.find(g => g.key === 'location');
        if (locGroup?.fields) {
          const len = Math.min(locLevels.length, locGroup.fields.length);
          for (let i = 0; i < len; i++) {
            const level = typeof locLevels[i] === 'string' && locLevels[i].trim();
            if (level) locGroup.fields[i].label = level;
          }
        }
      }

      // 额外状态栏分组（过滤与核心5组 key 冲突的条目）
      const CORE_STATUS_KEYS = new Set([
        'datetime',
        'location',
        'money',
        'objective',
      ]);
      if (Array.isArray(worldTerms.extra_status_groups)) {
        for (const group of worldTerms.extra_status_groups) {
          if (!group || typeof group !== 'object') continue;
          if (typeof group.key !== 'string' || !group.key.trim()) continue;
          if (CORE_STATUS_KEYS.has(group.key.trim())) continue; // 与核心组冲突，静默跳过
          if (typeof group.label !== 'string' || !group.label.trim()) continue;
          if (!Array.isArray(group.fields) || group.fields.length === 0) continue;
          // 验证子字段
          const validFields = group.fields.filter(
            f =>
              f &&
              typeof f === 'object' &&
              typeof f.key === 'string' &&
              f.key.trim() &&
              typeof f.label === 'string' &&
              f.label.trim()
          );
          if (validFields.length === 0) continue;
          statusFields.push({
            key: group.key.trim(),
            label: group.label.trim(),
            icon: (typeof group.icon === 'string' && group.icon.trim()) || '📋',
            fields: validFields.map(f => ({
              key: f.key.trim(),
              label: f.label.trim(),
              type: f.type || 'string',
            })),
          });
        }
      }
    } catch (e) {
      console.warn('[DesignService] world_terms 应用失败，使用默认字段:', e);
    }

    // panel_status 由 world_terms 确定；panel_npc 最终由 Stage 2 npc_fields 决定
    if (!this.designConfig.step3_fields) {
      this.designConfig.step3_fields = {};
    }
    this.designConfig.step3_fields.panel_status = statusFields;
    this._ensureCoreStatusGroups();

    // 预览性填充 panel_npc（P2 Stage 2 会用 npc_fields 完整覆盖）
    const FIXED_NPC_FIELDS = this._getNpcDisplayCoreFields();
    const fixedKeys = this._getNpcReservedKeySet();
    const previewFields = [];
    if (Array.isArray(worldTerms.extra_char_fields)) {
      for (const f of worldTerms.extra_char_fields) {
        if (!f || typeof f.key !== 'string' || !f.key.trim()) continue;
        if (!f.label || typeof f.label !== 'string') continue;
        if (fixedKeys.has(f.key.trim())) continue;
        previewFields.push({
          key: f.key.trim(),
          label: f.label.trim(),
          type: f.type || 'string',
          ...(f.desc ? { desc: f.desc.trim() } : {}),
        });
      }
    }
    this.designConfig.step3_fields.panel_npc = [...FIXED_NPC_FIELDS, ...previewFields];

    // 保存 _worldTermsSource 以便重导入时恢复
    this.designConfig.step3_fields._worldTermsSource = worldTerms;

    // 标记来源
    const hasCustomTerms =
      worldTerms &&
      typeof worldTerms === 'object' &&
      (worldTerms.currency_name ||
        worldTerms.calendar_era ||
        worldTerms.time_precision ||
        (Array.isArray(worldTerms.calendar_units) &&
          worldTerms.calendar_units.some(u => typeof u === 'string' && u.trim())) ||
        (Array.isArray(worldTerms.time_segments) &&
          worldTerms.time_segments.some(seg => typeof seg === 'string' && seg.trim())) ||
        (Array.isArray(worldTerms.location_levels) &&
          worldTerms.location_levels.some(l => typeof l === 'string' && l.trim())) ||
        (Array.isArray(worldTerms.extra_status_groups) &&
          worldTerms.extra_status_groups.length > 0) ||
        (Array.isArray(worldTerms.extra_char_fields) && worldTerms.extra_char_fields.length > 0));
    this.designConfig.step3_fields._source = hasCustomTerms ? 'inferred' : 'defaults';
    console.log(
      `[DesignService] 从 world_terms 推断 panel_status 完成 (_source: ${this.designConfig.step3_fields._source}); panel_npc 将由 Stage 2 npc_fields 定义`
    );
  }

  /**
   * 从每个实体第五章 [Narrative_Core] 提取核心人物名列表
   * 返回 { entityId: ["人名1", "人名2"], ... }
   */
  _extractNarrativeCoreCharacters(settings) {
    const result = {};
    const narrativeCoreRE = /###\s*第五章[^\n]*\[Narrative_Core\]([\s\S]*?)(?=###|$)/i;
    const dotNameRE = /[\u4e00-\u9fff]{1,4}(?:[·•][\u4e00-\u9fff]{1,4})+/g;
    const quotedNameRE =
      /[\u201c\u201d\u0022\u300c]([^\u201c\u201d\u0022\u300d]{2,8})[\u201c\u201d\u0022\u300d]/g;
    const coreCharRE =
      /核心人物[：:]\s*(?:[\u4e00-\u9fff]+[·•]?)*[\u201c\u201d\u0022]?([\u4e00-\u9fff]{2,8}(?:[·•][\u4e00-\u9fff]{1,4})*)[\u201c\u201d\u0022]?/g;
    const nonNameRE =
      /议会|联盟|帝国|王国|组织|公会|门派|宗门|势力|部落|城邦|学院|教廷|阵列|病毒|装置|协议|系统|矩阵|武器|载具|芯片|模块|引擎|网络|图|论|计划|行动|代号|余烬|清肃|节点|碎片|密钥|卷宗|手册|宝典|预言|仪式|秘术/;

    for (const [entityId, text] of Object.entries(settings)) {
      if (entityId.startsWith('_') || typeof text !== 'string') continue;
      const match = text.match(narrativeCoreRE);
      if (!match) continue;

      const chapterText = match[1];
      const names = new Set();

      for (const m of chapterText.matchAll(dotNameRE)) names.add(m[0]);
      for (const m of chapterText.matchAll(quotedNameRE)) {
        const name = m[1].trim();
        if (name.length >= 2 && /[\u4e00-\u9fff]/.test(name) && !nonNameRE.test(name)) {
          names.add(name);
        }
      }
      for (const m of chapterText.matchAll(coreCharRE)) {
        if (m[1] && !nonNameRE.test(m[1])) names.add(m[1]);
      }

      if (names.size > 0) result[entityId] = [...names];
    }
    return result;
  }

  /**
   * 从 Stage 2 输出的 npc_fields 构建 step3_fields.panel_npc
   * 统一显示字段由引擎提供，AI 仅定义额外字段
   */
  _applyNpcFieldsToStep3Fields(npcFields) {
    if (!Array.isArray(npcFields) || npcFields.length === 0) {
      console.warn('[DesignService] npc_fields 为空，panel_npc 保持现有值');
      return;
    }
    const normalizedFields = this._normalizePanelNpcFields(npcFields);
    const fixedKeys = this._getNpcReservedKeySet();
    const validFields = normalizedFields.filter(field => !fixedKeys.has(field.key));

    if (!this.designConfig.step3_fields) {
      this.designConfig.step3_fields = {};
    }
    this.designConfig.step3_fields.panel_npc = normalizedFields;
    this.designConfig.step3_fields._source = 'ai_defined';

    if (validFields.length === 0) {
      console.warn(
        '[DesignService] npc_fields 中无有效的 AI 定义字段（全部被过滤），panel_npc 仅保留统一核心字段'
      );
    }

    // 回写 _worldTermsSource.extra_char_fields，保持与 panel_npc 类型同步
    const wts = this.designConfig.step3_fields._worldTermsSource;
    if (wts && Array.isArray(wts.extra_char_fields)) {
      const npcFieldMap = {};
      for (const f of validFields) {
        npcFieldMap[f.key] = f;
      }
      for (const ecf of wts.extra_char_fields) {
        if (ecf?.key && npcFieldMap[ecf.key]) {
          ecf.type = npcFieldMap[ecf.key].type || 'string';
          if (npcFieldMap[ecf.key].desc) ecf.desc = npcFieldMap[ecf.key].desc;
        }
      }
      const existingKeys = new Set(wts.extra_char_fields.map(f => f?.key));
      for (const f of validFields) {
        if (!existingKeys.has(f.key)) {
          wts.extra_char_fields.push({
            key: f.key,
            label: f.label,
            type: f.type || 'string',
            ...(f.desc ? { desc: f.desc } : {}),
          });
        }
      }
    }

    this._saveDesignConfig();
    console.log(
      `[DesignService] 从 npc_fields 构建 panel_npc 完成: ${validFields.length} 个 AI 定义字段`
    );
  }

  /**
   * 更新 Phase 1 框架输出的单个字段（用于用户在预览中手动编辑）
   * @param {string} fieldKey - 字段路径，如 'context_world' 或 'world_terms.currency_name'
   * @param {*} newValue - 新值
   */
  updateP1OutputField(fieldKey, newValue) {
    if (!this.p1Output) return;
    if (fieldKey.startsWith('world_terms.')) {
      const termKey = fieldKey.slice('world_terms.'.length);
      if (!this.p1Output.world_terms) this.p1Output.world_terms = {};
      this.p1Output.world_terms[termKey] = newValue;
      if (!this.designConfig.step3_fields) {
        // 初始化：从 world_terms 全量构建 step3_fields
        this._applyWorldTermsToStep3Fields(this.p1Output.world_terms);
      } else {
        // 定向更新：仅修改对应的 step3_fields 字段，不重建整体
        this._patchStep3FieldFromTermChange(termKey, newValue);
      }
      // _saveDesignConfig() 会自动调用 worldCardInfoUI.refresh()
    } else {
      this.p1Output[fieldKey] = newValue;
    }
    this._saveDesignConfig();
  }

  /**
   * 手动跳转到 Phase 2（当 Phase 1 框架已就绪时调用）
   * @param {Array} [p1ChatHistory] - P1 阶段聊天历史，用于即刻 build design_qna 模块
   *
   * 在此处直接 build 而不是延迟到 stage 2 commit，是为了避免把原始 chatHistory
   * （可能含 1M 字粘贴）持久化到 localStorage 几分钟撑爆配额。
   */
  transitionToPhase2(p1ChatHistory = null) {
    if (!this.p1Output) {
      throw new Error('Phase 1 框架未就绪，无法进入 Phase 2');
    }
    this.phase = 'p2';
    this.p2Stage = 0;
    // P1 完整对话快照存进 designConfig，供 P2 各 stage prompt 直接读原文
    // （而不是只读压缩后的五维 JSON）。reset 时随 designConfig 整体清空。
    try {
      const filtered = this._filterPersistableHistory(
        Array.isArray(p1ChatHistory) ? p1ChatHistory : []
      );
      this.designConfig._p1ChatHistory = filtered.map(msg => {
        const out = { sender: msg.sender, text: typeof msg.text === 'string' ? msg.text : '' };
        if (msg.frameworkReady === true) out.frameworkReady = true;
        return out;
      });
    } catch (err) {
      console.warn('[DesignMode] _p1ChatHistory 快照失败（非致命）:', err);
      this.designConfig._p1ChatHistory = [];
    }
    try {
      this._designQnaPending = this._buildDesignQnaModule(
        this.p1Output,
        Array.isArray(p1ChatHistory) ? p1ChatHistory : []
      );
    } catch (err) {
      console.warn('[DesignMode] design_qna 预构建失败（非致命）:', err);
      this._designQnaPending = null;
    }
    this._saveDesignConfig();
  }

  /**
   * 强制结束 Phase 1：根据当前对话整理框架，缺失维度由 AI 自动补全。
   * 用户点击「执行」按键时（无论对话是否完整）调用。
   * @param {Array} history - 当前聊天历史
   * @returns {Promise<{text: string, frameworkReady: boolean, frameworkRejected: boolean, frameworkIssues: Array, frameworkIssueSummary: string}>}
   */
  async forceP1Completion(history, options = {}) {
    // 通知状态机进入强制完成模式（sendP1Message 中的 onUserMessage 会跳过）
    this.p1State.onForceComplete();

    let forceMsg =
      '用户已决定开始生成，请立即整理我们目前对话中的全部信息，' +
      '输出完整的 FRAMEWORK_READY JSON 框架（包含 complexity、target_stages 和 world_terms 字段）。' +
      '根据对话内容判断场景复杂度（lite/full），并设置对应的 target_stages（lite=3，full=4）。' +
      '对于尚未讨论到的维度（世界设定/规则/角色/时间线/风格基调/世界术语），' +
      '根据已有内容的风格和逻辑，用合理的默认值自行补全，不要提问，直接输出。' +
      'style_guide（风格基调）尤其重要：如果对话中用户提过文风偏好，必须忠实采纳；' +
      '如果用户未明确提过，根据世界类型推断一个最匹配的文风基调（如奇幻冒险→轻悬念、末日→紧张写实、日常→轻松温馨），' +
      '并在 style_guide 中写清叙事语气、节奏和氛围方向。' +
      'world_terms 必须与世界主题匹配——货币、纪年、时间精度、地点层级要使用世界观内的称呼，' +
      'time_precision 必须固定使用 time，且所有时间示例都要写成 HH:MM；' +
      'extra_status_groups 仅在核心4组（时间/地点/金钱/目标）无法表达的关键追踪机制时才添加，空数组是合理的默认选择；' +
      'extra_char_fields 要根据主题添加角色的独特追踪字段。';
    // 附加被拒框架作为参考基础
    if (this._lastRejectedFramework) {
      try {
        forceMsg +=
          '\n\n以下是之前生成但未通过验证的框架，请以此为基础修正和补充：\n' +
          JSON.stringify(this._lastRejectedFramework);
      } catch (_) {
        /* ignore serialization error */
      }
    }
    // sendP1Message 使用 _formatMessages(history)，忽略第一个参数。
    // 必须把 forceMsg 追加到 history 末尾，AI 才能收到这条指令。
    const augmentedHistory = [...history, { sender: 'user', text: forceMsg }];
    return this.sendP1Message(forceMsg, augmentedHistory, options);
  }

  _clampPhase2Stage(stage) {
    const parsed = Number.parseInt(stage, 10);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(PHASE2_TOTAL_STAGES, Math.max(1, parsed));
  }

  _normalizeStage3CharacterId(rawId) {
    if (typeof rawId !== 'string') return '';
    const trimmed = rawId.trim();
    if (!trimmed) return '';

    let entityPart = '';
    let serialPart = '';
    let namePart = '';

    const strictMatch = trimmed.match(/^(.*)_([12]\d{2})_(.+)$/);
    if (strictMatch) {
      entityPart = strictMatch[1];
      serialPart = strictMatch[2];
      namePart = strictMatch[3];
    } else {
      const segments = trimmed.split('_').filter(Boolean);
      if (segments.length < 3) {
        return trimmed
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '');
      }
      serialPart = segments[segments.length - 2];
      namePart = segments[segments.length - 1];
      entityPart = segments.slice(0, -2).join('_');
    }

    const entity =
      String(entityPart || 'entity')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'entity';

    let serial = serialPart;
    if (!/^[12]\d{2}$/.test(serial)) {
      const numeric = String(serialPart || '').replace(/\D/g, '');
      serial = numeric ? numeric.padStart(3, '0').slice(-3) : '101';
    }

    const name =
      String(namePart || 'character')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '') || 'character';

    return `${entity}_${serial}_${name}`;
  }

  /**
   * Stage 3 完成后，扫描 init 模块中残留的角色占位符（如 [该势力的领袖]），
   * 尝试用 character_database 中的角色名替换。
   * 返回 { replaced: number, remaining: number }
   */
  _backfillInitPlaceholders() {
    const initModule = this.designConfig.prompt_modules?.modules?.init;
    if (!initModule || typeof initModule !== 'string') return { replaced: 0, remaining: 0 };

    const charDb = this.designConfig.character_database;
    if (!charDb || typeof charDb !== 'object') return { replaced: 0, remaining: 0 };

    // 构建 实体前缀 → 角色列表 映射
    const entityCharMap = {};
    for (const [charId, char] of Object.entries(charDb)) {
      if (charId.startsWith('_') || !char?.name) continue;
      const prefixMatch = charId.match(/^(.+?)_\d{3}_/);
      if (prefixMatch) {
        const prefix = prefixMatch[1];
        if (!entityCharMap[prefix]) entityCharMap[prefix] = [];
        entityCharMap[prefix].push({
          name: char.name,
          cognitive: char.default_cognitive_state || '',
        });
      }
    }

    // 领导力关键词：用于识别"领袖类"角色
    const LEADER_KEYWORDS = /领袖|首领|国王|女王|皇帝|皇后|族长|长老|掌门|教主|统领|统治|王|主|首|领|帝/;

    // 已知的非角色方括号标记模式（跳过）
    const SKIP_RE = /^[!A-Za-z_]|^填入[：:]|^如[无需]|^时间$|^地点$/;

    let replaced = 0;
    let remaining = 0;

    const newInit = initModule.replace(/\[([^\[\]]{2,30})\]/g, (match, content) => {
      // 跳过已知的非占位符模式
      if (SKIP_RE.test(content)) return match;
      // 跳过纯英文/数字内容
      if (/^[A-Za-z0-9_\s.]+$/.test(content)) return match;

      // 从占位符周围文本推断所属实体
      // 获取占位符前 80 字符的上下文
      const matchIndex = initModule.indexOf(match);
      const contextBefore = matchIndex > 0
        ? initModule.slice(Math.max(0, matchIndex - 80), matchIndex)
        : '';

      // 遍历实体前缀，检查上下文或占位符内容是否提及该实体
      for (const [prefix, chars] of Object.entries(entityCharMap)) {
        // 将下划线前缀转为可能的中文实体名（从 world_setting 获取）
        const wsEntity = this.designConfig.world_setting?.settings?.[prefix];
        // 提取实体中文名（从设定文本的标题行）
        let entityCnName = '';
        if (typeof wsEntity === 'string') {
          const titleMatch = wsEntity.match(/^##\s*实体设定\s*--\s*(.+?)[\s(（]/m);
          if (titleMatch) entityCnName = titleMatch[1].trim();
        }

        // 检查上下文或占位符是否提到这个实体
        const mentionsEntity =
          (entityCnName && (contextBefore.includes(entityCnName) || content.includes(entityCnName))) ||
          contextBefore.includes(prefix.replace(/_/g, ''));

        if (mentionsEntity) {
          // 在该实体的角色中找领袖类角色
          const leader = chars.find(c => LEADER_KEYWORDS.test(c.cognitive));
          if (leader) {
            replaced++;
            return leader.name;
          }
          // 没有明确的领袖，取第一个角色
          if (chars.length > 0) {
            replaced++;
            return chars[0].name;
          }
        }
      }

      // 未能匹配任何实体，保留占位符
      remaining++;
      return match;
    });

    if (replaced > 0) {
      this.designConfig.prompt_modules.modules.init = newInit;
      console.log(
        `[DesignService] Stage3 后处理: init 模块中 ${replaced} 个占位符已替换为角色名` +
        (remaining > 0 ? `，${remaining} 个未能自动匹配` : '')
      );
    }

    return { replaced, remaining };
  }

  _normalizeStage3CharacterDatabase(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { normalized: parsed, changedCount: 0, conflictCount: 0 };
    }

    const normalized = {};
    const usedIds = new Set();
    let changedCount = 0;
    let conflictCount = 0;

    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith('_')) {
        normalized[key] = value;
        continue;
      }

      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        normalized[key] = value;
        usedIds.add(key);
        continue;
      }

      const sourceId = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : key;
      let normalizedId =
        this._normalizeStage3CharacterId(sourceId) || this._normalizeStage3CharacterId(key) || key;

      if (usedIds.has(normalizedId)) {
        const baseId = normalizedId;
        let suffix = 2;
        while (usedIds.has(`${baseId}_dup${suffix}`)) {
          suffix += 1;
        }
        normalizedId = `${baseId}_dup${suffix}`;
        conflictCount += 1;
      }
      usedIds.add(normalizedId);

      if (normalizedId !== key || normalizedId !== sourceId) {
        changedCount += 1;
      }

      const normalizedCharacter = { ...value, id: normalizedId };
      if ('age' in normalizedCharacter) {
        delete normalizedCharacter.age;
        changedCount += 1;
      }
      if (!Object.prototype.hasOwnProperty.call(normalizedCharacter, 'birthday')) {
        normalizedCharacter.birthday = null;
        changedCount += 1;
      } else if (normalizedCharacter.birthday === '') {
        normalizedCharacter.birthday = null;
        changedCount += 1;
      }
      normalized[normalizedId] = normalizedCharacter;
    }

    if (
      !Object.prototype.hasOwnProperty.call(normalized, '_summary') &&
      Object.prototype.hasOwnProperty.call(parsed, '_summary')
    ) {
      normalized._summary = parsed._summary;
    }

    return { normalized, changedCount, conflictCount };
  }

  /**
   * 校验 designConfig 中某个 section 是否具有有效结构（用于 P2 恢复时的前序数据校验）
   * @returns {boolean} true = 结构有效
   */
  _isValidDesignSection(key) {
    const data = this.designConfig[key];
    if (!data || typeof data !== 'object') return false;
    switch (key) {
      case 'world_setting': {
        const s = data.settings;
        if (!s || typeof s !== 'object') return false;
        return Object.keys(s).some(k => !k.startsWith('_'));
      }
      case 'prompt_modules': {
        const m = data.modules;
        return !!(m && typeof m === 'object');
      }
      case 'character_database':
        return Object.keys(data).some(k => !k.startsWith('_'));
      case 'timeline':
        return Array.isArray(data.events);
      case 'character_timelines':
        return true; // 已通过 typeof === 'object' 检查
      case 'relationship_rules':
        return true; // 已通过 typeof === 'object' 检查
      default:
        return !!data;
    }
  }

  _resolvePhase2StartStage(options = {}) {
    const mutate = options.mutate === true;
    // p2Stage > PHASE2_TOTAL_STAGES 表示 finalize（最后 stage 审阅完成）—— 不 clamp，
    // 让 runPhase2Pipeline 的 for 循环自然跳过、直接走后处理（_postPhase2ConsistencyCheck → phase='p3'）
    if (this.p2Stage > PHASE2_TOTAL_STAGES) {
      return this.p2Stage;
    }
    let startStage = this.p2Stage > 0 ? this._clampPhase2Stage(this.p2Stage) : 1;

    if (startStage > 1) {
      const stageRequires = [
        [],                                                     // Stage 1: 无前序依赖
        ['world_setting'],                                      // Stage 2
        ['world_setting', 'prompt_modules'],                    // Stage 3
        ['world_setting', 'prompt_modules', 'character_database'], // Stage 4
      ];
      const missing = (stageRequires[startStage - 1] || []).filter(k => !this._isValidDesignSection(k));
      if (missing.length > 0) {
        console.warn(
          `[DesignService] P2 恢复时前序数据缺失: ${missing.join(', ')}，从 Stage 1 重新开始`
        );
        startStage = 1;
        if (mutate) {
          this.p2Stage = 0;
        }
      }
    }

    return startStage;
  }

  _createPhase2AbortError(message = 'Phase 2 已中止') {
    const err = new Error(message);
    err.code = 'P2_ABORTED';
    return err;
  }

  _isPhase2AbortError(error) {
    return Boolean(error && error.code === 'P2_ABORTED');
  }

  _createDesignValidationError(message = '生成结果未通过校验', options = {}) {
    const error = new Error(message);
    error.code = 'DESIGN_VALIDATION_FAILED';
    error.designValidation = {
      report: options.report || null,
      rootCause:
        typeof options.rootCause === 'string' && options.rootCause.trim()
          ? options.rootCause.trim()
          : message,
      failedFields: Array.isArray(options.failedFields) ? options.failedFields : null,
    };
    return error;
  }

  _isPhase2RunActive(runToken) {
    return this.isAutoGenerating && this.activePhase2RunToken === runToken;
  }

  getPhase2StartStage() {
    return this._resolvePhase2StartStage({ mutate: false });
  }

  setPhase2Stage(stage) {
    const nextStage = this._clampPhase2Stage(stage);
    this.phase = 'p2';
    this.p2Stage = nextStage;
    this._saveDesignConfig();
    return nextStage;
  }

  clearPhase2FromStage(stage) {
    const startStage = this._clampPhase2Stage(stage);
    // Clear stage keys + associated data for stages >= startStage
    const allKeys = [...PHASE2_STAGE_KEYS, 'character_timelines', 'relationship_rules'];
    for (let i = startStage - 1; i < PHASE2_STAGE_KEYS.length; i++) {
      delete this.designConfig[PHASE2_STAGE_KEYS[i]];
    }
    // Stage 3 onwards: also clear relationship_rules
    if (startStage <= 3) {
      delete this.designConfig.relationship_rules;
    }
    // Stage 4: also clear character_timelines
    if (startStage <= 4) {
      delete this.designConfig.character_timelines;
    }
    if (startStage <= 2 && this.stageValidationReports?.prompt_modules) {
      delete this.stageValidationReports.prompt_modules;
    }
    if (startStage <= 3 && this.stageValidationReports?.character_database) {
      delete this.stageValidationReports.character_database;
    }
    this.phase = 'p2';
    this.p2Stage = startStage;
    // 清掉 stage 3 及更早重启时的卡牌审阅暂停标记（重跑会重新触发暂停）
    if (startStage <= 3) {
      this.p2ReviewStage = null;
    }
    this.pendingOperations = [];
    this._saveDesignConfig();
    this._updatePreviewPanel();
    return startStage;
  }

  resetPhase2ForRestart() {
    this.stopAutoGenerate();
    for (const key of [...PHASE2_STAGE_KEYS, 'character_timelines', 'relationship_rules']) {
      delete this.designConfig[key];
    }
    this.stageValidationReports = {};
    this.phase = 'p2';
    this.p2Stage = 0;
    this.p2ReviewStage = null;
    this.pendingOperations = [];
    this._saveDesignConfig();
    this._updatePreviewPanel();
  }

}

_applyDesignServiceMixin(_DesignServiceP1Mixin);
