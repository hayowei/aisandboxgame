/**
 * design/utils.js
 * 世界卡文件级工具函数 + localStorage 草稿读写
 *
 * 加载顺序：必须在 constants.js 之后、designService.js 之前加载
 * （依赖 P1_FLOW_* / DESIGN_DRAFT_SOURCE_CARD_EDIT 等常量）
 */

function _getDesignPromptValue(name, fallback = null) {
  const locale = window.i18nService?.getDesignLanguage?.() || 'zh-CN';
  const localizedName = locale === 'en' ? `${name}_EN` : name;
  if (typeof window !== 'undefined' && typeof window[localizedName] !== 'undefined') {
    return window[localizedName];
  }
  if (typeof window !== 'undefined' && typeof window[name] !== 'undefined') {
    return window[name];
  }
  return fallback;
}

function _cloneDefaultStep3Fields(locale = null) {
  const builder = window.step3SchemaBuilder;
  if (!builder) return null;
  const resolvedLocale = locale || window.i18nService?.getDesignLanguage?.() || 'zh-CN';
  return {
    panel_status:
      typeof builder.getDefaultStatusFields === 'function'
        ? builder.getDefaultStatusFields(resolvedLocale)
        : JSON.parse(JSON.stringify(builder.DEFAULT_STATUS_FIELDS)),
    panel_npc:
      typeof builder.getDefaultNpcFields === 'function'
        ? builder.getDefaultNpcFields(resolvedLocale)
        : JSON.parse(JSON.stringify(builder.DEFAULT_NPC_FIELDS)),
  };
}

function _normalizeStoredP1AnswerSource(source) {
  const normalized = typeof source === 'string' ? source.trim().toLowerCase() : '';
  return normalized === 'option' || normalized === 'custom' || normalized === 'skip'
    ? normalized
    : '';
}

function _sanitizeStoredP1FlowState(flowState) {
  const flow = flowState && typeof flowState === 'object' ? flowState : {};
  const cursor = Number.isFinite(flow.cursor) ? Math.max(0, Math.floor(flow.cursor)) : 0;
  const answers = Array.isArray(flow.answers)
    ? flow.answers
        .slice(0, 2)
        .map(item => {
          const questionId = typeof item?.questionId === 'string' ? item.questionId.trim() : '';
          if (!questionId) return null;
          const questionText =
            typeof item?.questionText === 'string' ? item.questionText.trim().slice(0, 220) : '';
          const selectedOptionId =
            typeof item?.selectedOptionId === 'string' && item.selectedOptionId.trim()
              ? item.selectedOptionId.trim().slice(0, 16)
              : typeof item?.optionId === 'string' && item.optionId.trim()
                ? item.optionId.trim().slice(0, 16)
                : '';
          let selectedOptionText =
            typeof item?.selectedOptionText === 'string'
              ? item.selectedOptionText.trim().slice(0, P1_FLOW_OPTION_TEXT_MAX_LEN)
              : '';
          let customText =
            typeof item?.customText === 'string'
              ? item.customText.slice(0, P1_FLOW_CUSTOM_TEXT_MAX_LEN)
              : '';
          const rawAnswerText =
            typeof item?.answerText === 'string'
              ? item.answerText.trim().slice(0, P1_FLOW_ANSWER_TEXT_MAX_LEN)
              : '';
          const customTextTrimmed = customText.trim();
          const hasOptionMeta = Boolean(selectedOptionId || selectedOptionText);
          const hasCustomMeta = Boolean(customTextTrimmed);
          let answerSource = _normalizeStoredP1AnswerSource(item?.answerSource);
          const skipped =
            item?.skipped === true ||
            answerSource === 'skip' ||
            rawAnswerText === P1_FLOW_SKIP_ANSWER_TEXT;
          if (!answerSource) {
            if (skipped) answerSource = 'skip';
            else if (hasOptionMeta && hasCustomMeta) {
              if (rawAnswerText && rawAnswerText === customTextTrimmed) answerSource = 'custom';
              else if (
                rawAnswerText &&
                selectedOptionText &&
                rawAnswerText === selectedOptionText
              ) {
                answerSource = 'option';
              } else {
                answerSource = 'custom';
              }
            } else if (hasCustomMeta) answerSource = 'custom';
            else if (hasOptionMeta) answerSource = 'option';
            else if (rawAnswerText) answerSource = 'option';
          }

          let answerText = '';
          if (answerSource === 'skip') {
            answerText = P1_FLOW_SKIP_ANSWER_TEXT;
          } else if (answerSource === 'custom') {
            if (!customText && rawAnswerText) {
              customText = rawAnswerText.slice(0, P1_FLOW_CUSTOM_TEXT_MAX_LEN);
            }
            answerText = customText.trim().slice(0, P1_FLOW_ANSWER_TEXT_MAX_LEN);
          } else if (answerSource === 'option') {
            if (
              !selectedOptionText &&
              rawAnswerText &&
              rawAnswerText !== P1_FLOW_SKIP_ANSWER_TEXT
            ) {
              selectedOptionText = rawAnswerText.slice(0, P1_FLOW_OPTION_TEXT_MAX_LEN);
            }
            answerText = (selectedOptionText || rawAnswerText).slice(
              0,
              P1_FLOW_ANSWER_TEXT_MAX_LEN
            );
          } else {
            answerText = rawAnswerText;
          }

          const hasAnyAnswerState = Boolean(
            answerSource ||
            selectedOptionId ||
            selectedOptionText ||
            customText ||
            answerText ||
            skipped
          );
          if (!hasAnyAnswerState) return null;

          return {
            questionId,
            questionText,
            answerText,
            skipped: answerSource === 'skip',
            optionId: selectedOptionId,
            answerSource,
            selectedOptionId,
            selectedOptionText,
            customText,
          };
        })
        .filter(Boolean)
    : [];
  return { cursor, answers };
}

function _hasMeaningfulStoredDraftP1State(p1State) {
  if (!p1State || typeof p1State !== 'object') return false;
  if (Number.isFinite(p1State.round) && p1State.round > 0) return true;
  if (typeof p1State.mode === 'string' && p1State.mode.trim()) return true;
  if (typeof p1State.style === 'string' && p1State.style.trim()) return true;
  const evidence = p1State.dimensionEvidence;
  if (!evidence || typeof evidence !== 'object') return false;
  return Object.values(evidence).some(entry => {
    if (!entry || typeof entry !== 'object') return false;
    if (Number.isFinite(entry.rounds) && entry.rounds > 0) return true;
    return Array.isArray(entry.snippets) && entry.snippets.length > 0;
  });
}

function _hasMeaningfulStoredDraftHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return false;
  return history.some((msg, index) => {
    if (!msg || typeof msg !== 'object') return false;
    if (msg.sender === 'user') return true;
    if (msg.frameworkReady || msg.isError) return true;
    if (msg.p1FlowState || Array.isArray(msg.p1Questions)) return true;
    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    return index > 0 && text.length > 0;
  });
}

function _readStoredDesignDraftSnapshot() {
  try {
    const metaStr = localStorage.getItem('design_mode_meta');
    const configStr = localStorage.getItem('design_mode_config');
    const historyStr = localStorage.getItem('design_mode_chat_history');
    if (!metaStr || !configStr) {
      return { exists: false, meta: null, config: null, history: [] };
    }

    const meta = JSON.parse(metaStr);
    const config = JSON.parse(configStr);
    const history = historyStr ? JSON.parse(historyStr) : [];

    if (meta?.draftSourceType === DESIGN_DRAFT_SOURCE_CARD_EDIT) {
      return { exists: false, meta, config, history };
    }
    if (meta?.hasDraft === false) {
      return { exists: false, meta, config, history };
    }

    const hasConfigContent =
      !!config &&
      typeof config === 'object' &&
      !Array.isArray(config) &&
      Object.keys(config).length > 0;
    const exists =
      meta?.hasDraft === true ||
      (meta?.phase !== 'done' &&
        (meta?.p1Output ||
          (Number.isFinite(meta?.p2Stage) && meta.p2Stage > 0) ||
          hasConfigContent ||
          _hasMeaningfulStoredDraftP1State(meta?.p1State) ||
          _hasMeaningfulStoredDraftHistory(history)));

    return { exists, meta, config, history };
  } catch (error) {
    console.warn('[DesignDraft] 读取草稿失败:', error);
    return { exists: false, meta: null, config: null, history: [] };
  }
}

function _clearStoredDesignDraft() {
  try {
    localStorage.removeItem('design_mode_config');
    localStorage.removeItem('design_mode_meta');
    localStorage.removeItem('design_mode_chat_history');
  } catch (error) {
    console.warn('[DesignDraft] 清理草稿失败:', error);
  }
}

if (typeof window !== 'undefined') {
  window.getStoredDesignDraftSnapshot = _readStoredDesignDraftSnapshot;
  window.hasStoredDesignDraft = function hasStoredDesignDraft() {
    return _readStoredDesignDraftSnapshot().exists;
  };
  window.clearStoredDesignDraft = _clearStoredDesignDraft;
}

/**
 * 把一个 mixin class 的所有实例方法 + 静态成员合并到 DesignService 上。
 * 用 Object.defineProperty 拷贝 PropertyDescriptor，保留 async / getter / setter 语义。
 *
 * 用法（在每个 design/<phase>.js 末尾调用）：
 *     class _DesignServiceP3Mixin { static get X(){...}  foo(){...}  async bar(){...} }
 *     _applyDesignServiceMixin(_DesignServiceP3Mixin);
 *
 * 调用时 DesignService 必须已加载（designService.js 在 utils.js 之后加载，
 * 但本函数仅在 design/<phase>.js 中执行，那时 DesignService 已存在）。
 */
function _applyDesignServiceMixin(source) {
  for (const name of Object.getOwnPropertyNames(source.prototype)) {
    if (name === 'constructor') continue;
    Object.defineProperty(
      DesignService.prototype,
      name,
      Object.getOwnPropertyDescriptor(source.prototype, name)
    );
  }
  for (const name of Object.getOwnPropertyNames(source)) {
    if (['length', 'name', 'prototype', 'arguments', 'caller'].includes(name)) continue;
    Object.defineProperty(
      DesignService,
      name,
      Object.getOwnPropertyDescriptor(source, name)
    );
  }
}
