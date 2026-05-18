/**
 * design/stateMachines.js
 * P1StateMachine（Phase 1 状态机）+ P3SessionStateMachine（Phase 3 session 状态机）
 *
 * 加载顺序：必须在 designService.js 之前加载
 * 顶层 const/class 在 classic <script> 中位于全局 LexicalEnvironment，跨脚本可按名访问
 */

// ============================================
// P1StateMachine: Phase 1 状态机
// ============================================

const P1_STATES = {
  INIT: 'P1_INIT',
  R1_PENDING: 'P1_R1_PENDING',
  R1_ANSWERED: 'P1_R1_ANSWERED',
  R2_PENDING: 'P1_R2_PENDING',
  R2_ANSWERED: 'P1_R2_ANSWERED',
  RN_PENDING: 'P1_RN_PENDING',
  RN_ANSWERED: 'P1_RN_ANSWERED',
  UPGRADE_PENDING: 'P1_UPGRADE_PENDING',
  UPGRADE_ANSWERED: 'P1_UPGRADE_ANSWERED',
  FORCE_COMPLETING: 'P1_FORCE_COMPLETING',
  FRAMEWORK_READY: 'P1_FRAMEWORK_READY',
  RANDOM_SHORTCUT: 'P1_RANDOM_SHORTCUT',
};

const P1_RANDOM_KEYWORDS_RE = /^(?:随机|随便|你来决定|你决定|random|whatever|surprise me|随机生成|随机生成一个)/i;

const P1_EVIDENCE_SNIPPET_MAX_LEN = 200;
const P1_EVIDENCE_SUFFICIENT_CHARS = 200;
const P1_EVIDENCE_SUFFICIENT_SNIPPETS = 2;

class P1StateMachine {
  constructor(savedState = null) {
    if (savedState && typeof savedState === 'object') {
      this.state = savedState.state || P1_STATES.INIT;
      this.round = Number.isFinite(savedState.round) ? savedState.round : 0;
      this.mode = savedState.mode || null;
      this.style = savedState.style || null;
      this.dimensionEvidence = this._validateEvidence(savedState.dimensionEvidence);
      this.lastAiQuestionTargets = Array.isArray(savedState.lastAiQuestionTargets)
        ? savedState.lastAiQuestionTargets
        : [];
      this._previousMode = savedState._previousMode || null;
      this._previousStyle = savedState._previousStyle || null;
      this._isBacktrackR2 = !!savedState._isBacktrackR2;
    } else {
      this.state = P1_STATES.INIT;
      this.round = 0;
      this.mode = null;
      this.style = null;
      this.dimensionEvidence = this._defaultEvidence();
      this.lastAiQuestionTargets = [];
      this._previousMode = null;
      this._previousStyle = null;
      this._isBacktrackR2 = false;
    }
  }

  // --- 默认/校验 ---

  _defaultEvidence() {
    const dims = ['context_world', 'context_rules', 'context_chars', 'context_timeline', 'style_guide'];
    const evidence = {};
    for (const d of dims) {
      evidence[d] = { rounds: 0, snippets: [], confidence: 'none' };
    }
    return evidence;
  }

  _validateEvidence(raw) {
    const defaults = this._defaultEvidence();
    if (!raw || typeof raw !== 'object') return defaults;
    for (const key of Object.keys(defaults)) {
      const entry = raw[key];
      if (!entry || typeof entry !== 'object') continue;
      defaults[key] = {
        rounds: Number.isFinite(entry.rounds) ? entry.rounds : 0,
        snippets: Array.isArray(entry.snippets) ? entry.snippets.slice(0, 20) : [],
        confidence: ['none', 'partial', 'sufficient'].includes(entry.confidence)
          ? entry.confidence
          : 'none',
      };
    }
    return defaults;
  }

  // --- 状态查询 ---

  getState() { return this.state; }
  getRound() { return this.round; }
  getMode() { return this.mode; }
  getStyle() { return this.style; }
  getDimensionEvidence() { return this.dimensionEvidence; }
  isBacktrackR2() { return this._isBacktrackR2; }

  // --- 状态转换 ---

  onUserMessage(text) {
    if (this.state === P1_STATES.FORCE_COMPLETING) return;

    // 随机快捷路径检测（仅 INIT 状态）
    if (this.state === P1_STATES.INIT) {
      const trimmed = typeof text === 'string' ? text.trim() : '';
      if (P1_RANDOM_KEYWORDS_RE.test(trimmed)) {
        this.state = P1_STATES.RANDOM_SHORTCUT;
        return;
      }
      // INIT 状态下用户发消息不转换状态（等 AI 回复后转 R1_PENDING）
      return;
    }

    // PENDING → ANSWERED 转换
    const pendingToAnswered = {
      [P1_STATES.R1_PENDING]: P1_STATES.R1_ANSWERED,
      [P1_STATES.R2_PENDING]: P1_STATES.R2_ANSWERED,
      [P1_STATES.RN_PENDING]: P1_STATES.RN_ANSWERED,
      [P1_STATES.UPGRADE_PENDING]: P1_STATES.UPGRADE_ANSWERED,
    };
    const next = pendingToAnswered[this.state];
    if (next) {
      this.state = next;
    }
  }

  onAiResponse(parsedResponse) {
    const { questions = [], hasFramework = false } = parsedResponse || {};

    if (hasFramework) {
      // 框架验证在外部执行，这里只处理已通过验证的情况
      return;
    }

    // 检测 AI 问题中的特殊 target 来判断转换目标
    const targets = questions.map(q => q.target).filter(Boolean);
    const hasUpgradeTarget = targets.includes('_upgrade');

    // 根据当前状态和 AI 输出决定下一状态
    switch (this.state) {
      case P1_STATES.INIT:
      case P1_STATES.RANDOM_SHORTCUT:
        this.state = P1_STATES.R1_PENDING;
        this.round = 1;
        break;

      case P1_STATES.R1_ANSWERED:
        this.state = P1_STATES.R2_PENDING;
        this.round = 2;
        this._isBacktrackR2 = false;
        break;

      case P1_STATES.R2_ANSWERED:
        this.state = P1_STATES.RN_PENDING;
        this.round = 3;
        break;

      case P1_STATES.RN_ANSWERED:
        if (hasUpgradeTarget) {
          this.state = P1_STATES.UPGRADE_PENDING;
        } else {
          this.state = P1_STATES.RN_PENDING;
        }
        this.round++;
        break;

      case P1_STATES.UPGRADE_ANSWERED:
        // 用户选了"切换到深度定制"，AI 继续提问
        this.state = P1_STATES.RN_PENDING;
        this.round++;
        break;

      default:
        console.warn('[P1StateMachine] onAiResponse called in unexpected state:', this.state);
        break;
    }

    this.lastAiQuestionTargets = targets;
  }

  onModeSelected(mode) {
    if (mode === 'lite' || mode === 'full') {
      this.mode = mode;
    }
  }

  onStyleSelected(style) {
    if (typeof style === 'string' && style.trim()) {
      this.style = style.trim();
    }
  }

  onUpgradeDecision(switchToFull) {
    if (switchToFull) {
      this.mode = 'full';
    }
    // 状态由 onUserMessage 转换为 UPGRADE_ANSWERED
    // 后续由 onAiResponse 或 onFrameworkReady 继续
  }

  onFrameworkReady(_framework) {
    this.state = P1_STATES.FRAMEWORK_READY;
  }

  onForceComplete() {
    this.state = P1_STATES.FORCE_COMPLETING;
  }

  // --- 证据追踪 ---

  recordEvidence(target, text, options = {}) {
    const entry = this.dimensionEvidence[target];
    if (!entry) return;

    let snippet = typeof text === 'string' ? text.trim().slice(0, P1_EVIDENCE_SNIPPET_MAX_LEN) : '';
    if (!snippet) return;

    // weight < 1 时截断 snippet 来模拟权重（避免影响之前累积的证据）
    const weight = Number.isFinite(options.weight) ? options.weight : 1;
    if (weight > 0 && weight < 1) {
      snippet = snippet.slice(0, Math.max(1, Math.floor(snippet.length * weight)));
    }
    entry.snippets.push(snippet);
    entry.rounds++;

    // 重新计算 confidence
    const totalChars = entry.snippets.reduce((sum, s) => sum + s.length, 0);
    if (entry.snippets.length >= P1_EVIDENCE_SUFFICIENT_SNIPPETS || totalChars >= P1_EVIDENCE_SUFFICIENT_CHARS) {
      entry.confidence = 'sufficient';
    } else if (entry.snippets.length > 0) {
      entry.confidence = 'partial';
    } else {
      entry.confidence = 'none';
    }
  }

  // --- Prompt 构建辅助 ---

  getRequiredPromptContext() {
    return {
      state: this.state,
      round: this.round,
      mode: this.mode,
      style: this.style,
      evidence: this.dimensionEvidence,
      isBacktrackR2: this._isBacktrackR2,
      previousMode: this._previousMode,
      previousStyle: this._previousStyle,
    };
  }

  getExpectedAiOutputType() {
    switch (this.state) {
      case P1_STATES.INIT:
        return 'questions';
      case P1_STATES.R1_ANSWERED:
        return 'questions';
      case P1_STATES.R2_ANSWERED:
        return 'questions_or_framework';
      case P1_STATES.RN_ANSWERED:
        return 'questions_or_framework';
      case P1_STATES.UPGRADE_ANSWERED:
        return 'questions_or_framework';
      case P1_STATES.RANDOM_SHORTCUT:
        return 'framework';
      case P1_STATES.FORCE_COMPLETING:
        return 'framework';
      default:
        return 'questions';
    }
  }

  getAllowedTargets() {
    switch (this.state) {
      case P1_STATES.INIT:
      case P1_STATES.R1_PENDING:
        return ['context_world', 'context_rules', 'context_chars', 'context_timeline'];
      case P1_STATES.R2_PENDING:
        return ['_mode', 'style_guide'];
      case P1_STATES.RN_PENDING:
        if (this.mode === 'lite') {
          return ['context_chars', 'style_guide', '_upgrade'];
        }
        return ['context_world', 'context_rules', 'context_chars', 'context_timeline', 'style_guide'];
      case P1_STATES.UPGRADE_PENDING:
        return ['_upgrade'];
      default:
        return [];
    }
  }

  // API 调用仅在这些状态下合法
  isValidCallState() {
    const valid = [
      P1_STATES.INIT, P1_STATES.R1_ANSWERED, P1_STATES.R2_ANSWERED,
      P1_STATES.RN_ANSWERED, P1_STATES.UPGRADE_ANSWERED,
      P1_STATES.RANDOM_SHORTCUT, P1_STATES.FORCE_COMPLETING,
    ];
    return valid.includes(this.state);
  }

  // --- 回退 ---

  backtrackToR2() {
    const backtrackable = [
      P1_STATES.RN_PENDING, P1_STATES.RN_ANSWERED,
      P1_STATES.UPGRADE_PENDING, P1_STATES.UPGRADE_ANSWERED,
    ];
    if (!backtrackable.includes(this.state)) {
      console.warn('[P1StateMachine] backtrackToR2 called in non-backtrackable state:', this.state);
      return false;
    }
    this._previousMode = this.mode;
    this._previousStyle = this.style;
    this._isBacktrackR2 = true;
    this.state = P1_STATES.R1_ANSWERED; // 下次 AI 回复将转到 R2_PENDING
    this.mode = null;
    this.style = null;
    return true;
  }

  // --- 序列化 ---

  serialize() {
    return {
      state: this.state,
      round: this.round,
      mode: this.mode,
      style: this.style,
      dimensionEvidence: this.dimensionEvidence,
      lastAiQuestionTargets: this.lastAiQuestionTargets,
      _previousMode: this._previousMode,
      _previousStyle: this._previousStyle,
      _isBacktrackR2: this._isBacktrackR2,
    };
  }

  static deserialize(obj) {
    return new P1StateMachine(obj);
  }
}

// ============================================
// P3SessionStateMachine: Phase 3 session 状态机
// ============================================

const P3_STATES = {
  IDLE: 'P3_IDLE',
  STREAMING: 'P3_STREAMING',
  OPS_PENDING: 'P3_OPS_PENDING',
  APPLYING: 'P3_APPLYING',
  APPLIED: 'P3_APPLIED',
  ERROR: 'P3_ERROR',
};

const P3_TRANSITIONS = {
  [P3_STATES.IDLE]: {
    onSendMessage: P3_STATES.STREAMING,
  },
  [P3_STATES.STREAMING]: {
    onResponseComplete_hasOps: P3_STATES.OPS_PENDING,
    onResponseComplete_noOps: P3_STATES.IDLE,
    onApiError: P3_STATES.ERROR,
    onAbort: P3_STATES.IDLE,
  },
  [P3_STATES.OPS_PENDING]: {
    onApplyStart: P3_STATES.APPLYING,
    onSendMessage: P3_STATES.STREAMING,
    onDiscard: P3_STATES.IDLE,
  },
  [P3_STATES.APPLYING]: {
    onApplyComplete: P3_STATES.APPLIED,
    onApplyRollback: P3_STATES.OPS_PENDING,
  },
  [P3_STATES.APPLIED]: {
    onSendMessage: P3_STATES.STREAMING,
    onUndoToOps: P3_STATES.OPS_PENDING,
  },
  [P3_STATES.ERROR]: {
    onReset: P3_STATES.IDLE,
    onSendMessage: P3_STATES.STREAMING,
  },
};

class P3SessionStateMachine {
  constructor() {
    this.state = P3_STATES.IDLE;
  }

  getState() {
    return this.state;
  }

  _transition(eventName) {
    const allowed = P3_TRANSITIONS[this.state];
    if (!allowed || !allowed[eventName]) {
      console.warn(`[P3SM] Invalid transition: ${this.state} + ${eventName}`);
      return false;
    }
    const prev = this.state;
    this.state = allowed[eventName];
    console.log(`[P3SM] ${prev} → ${this.state} (${eventName})`);
    return true;
  }

  onSendMessage() { return this._transition('onSendMessage'); }

  onResponseComplete(hasOps) {
    return this._transition(hasOps ? 'onResponseComplete_hasOps' : 'onResponseComplete_noOps');
  }

  onApiError() { return this._transition('onApiError'); }
  onAbort() { return this._transition('onAbort'); }
  onApplyStart() { return this._transition('onApplyStart'); }
  onApplyComplete() { return this._transition('onApplyComplete'); }
  onApplyRollback() { return this._transition('onApplyRollback'); }
  onDiscard() { return this._transition('onDiscard'); }
  onUndoToOps() { return this._transition('onUndoToOps'); }
  onReset() { return this._transition('onReset'); }
}
