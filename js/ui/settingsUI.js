// ============================================
// Settings UI - 设置界面
// ============================================

// Function name 合法性校验（Gemini API 规范）
// 必须以字母或下划线开头，只允许 a-zA-Z0-9_.-: ，最长 64 字符
const FN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.:\-]{0,63}$/;
function _isValidFunctionName(name) {
  return FN_NAME_REGEX.test(name);
}

// 启发式：粘贴到 cp-model 的内容像不像 API Key
// 命中即弹 toast 提示用户填错字段（不阻止粘贴）
function _pastedLooksLikeApiKey(text) {
  const t = (text || '').trim();
  if (!t) return false;
  if (/\s/.test(t)) return true;
  if (/^sk-[A-Za-z0-9_-]{10,}/i.test(t)) return true; // OpenAI / DeepSeek / Anthropic
  if (/^AIza[A-Za-z0-9_-]{20,}/.test(t)) return true; // Google
  if (/^xai-[A-Za-z0-9_-]{10,}/i.test(t)) return true; // xAI
  if (t.length > 100) return true;
  return false;
}

function _getDefaultPromptModule(moduleId) {
  const meta = typeof window !== 'undefined' ? window.worldMeta : null;
  if (!meta) return '';
  const mod = meta.getRuleModule?.(moduleId);
  return mod || '';
}

function _getDefaultGreetingForSettings() {
  if (typeof getEffectiveGreeting === 'function') {
    return getEffectiveGreeting();
  }
  if (
    window.i18nService?.getResolvedLanguage?.() === 'en' &&
    typeof INITIAL_GREETING_EN !== 'undefined'
  ) {
    return INITIAL_GREETING_EN;
  }
  return typeof INITIAL_GREETING !== 'undefined' ? INITIAL_GREETING : '';
}

let _savedEditorGreetingValue = _getDefaultGreetingForSettings();
let _savedEditorInitValue = '';

function _getActiveWorldCardForSettings() {
  const mgr = window.worldCardManager;
  if (!mgr || typeof mgr.getActiveCardId !== 'function') {
    return null;
  }
  const activeId = mgr.getActiveCardId();
  if (!activeId) return null;
  if (typeof mgr.getLocalizedCard === 'function') {
    return mgr.getLocalizedCard(activeId, _getSettingsLocale());
  }
  if (typeof mgr.get === 'function') {
    return mgr.get(activeId);
  }
  return null;
}

function _isBuiltInWorldCardForSettings(card = null) {
  const activeCard = card || _getActiveWorldCardForSettings();
  if (!activeCard) return false;
  const mgr = window.worldCardManager;
  if (mgr && typeof mgr.isBuiltInCard === 'function') {
    return mgr.isBuiltInCard(activeCard.id);
  }
  return activeCard.isBuiltIn === true;
}

function _syncEditorPromptReadonlyState(activeCard = null) {
  const isBuiltIn = _isBuiltInWorldCardForSettings(activeCard);
  const copy = _getSettingsCopy();
  const readonlyReason = copy.custom.readonly.reason;
  const targets = [
    {
      textarea: document.getElementById('editor-greeting'),
    },
    {
      textarea: document.getElementById('editor-init-module'),
    },
  ];

  targets.forEach(({ textarea }) => {
    if (textarea) {
      const hintEl = textarea.previousElementSibling;
      if (hintEl && hintEl.classList.contains('hint')) {
        const currentText = hintEl.textContent || '';
        const readonlySuffixes = Object.values(SETTINGS_LOCALE_COPY)
          .map(item => item?.custom?.readonly?.suffix)
          .filter(Boolean);
        const baseText = readonlySuffixes.reduce(
          (text, suffix) => (text.endsWith(suffix) ? text.slice(0, -suffix.length) : text),
          currentText
        );
        hintEl.dataset.baseText = baseText;
        hintEl.textContent = hintEl.dataset.baseText;
        if (isBuiltIn) {
          const suffixEl = document.createElement('span');
          suffixEl.className = 'hint-readonly-suffix';
          suffixEl.textContent = copy.custom.readonly.suffix;
          hintEl.appendChild(suffixEl);
        }
      }
      textarea.readOnly = isBuiltIn;
      textarea.setAttribute('aria-readonly', isBuiltIn ? 'true' : 'false');
      textarea.title = isBuiltIn ? readonlyReason : '';
    }
  });
}

function _getEditorPromptValuesForSettings(_config) {
  const activeCard = _getActiveWorldCardForSettings();
  if (activeCard && activeCard.snapshot && typeof activeCard.snapshot === 'object') {
    const promptModules =
      activeCard.snapshot.prompt_modules && typeof activeCard.snapshot.prompt_modules === 'object'
        ? activeCard.snapshot.prompt_modules
        : {};
    const modules =
      promptModules.modules && typeof promptModules.modules === 'object'
        ? promptModules.modules
        : {};
    const worldGreeting =
      typeof promptModules.opening_greeting === 'string' ? promptModules.opening_greeting : '';
    const worldInit = typeof modules.init === 'string' ? modules.init : '';

    return {
      hasActiveWorldCard: true,
      greeting: worldGreeting.trim() ? worldGreeting : _getDefaultGreetingForSettings(),
      initModule: worldInit.trim() ? worldInit : '',
      savedGreeting: worldGreeting.trim() ? worldGreeting : _getDefaultGreetingForSettings(),
      savedInitModule: worldInit.trim() ? worldInit : '',
    };
  }

  const fallbackGreeting = _getDefaultGreetingForSettings();
  return {
    hasActiveWorldCard: false,
    greeting: fallbackGreeting,
    initModule: '',
    savedGreeting: fallbackGreeting,
    savedInitModule: '',
  };
}

function _saveEditorPromptsToActiveWorldCard(greeting, initModule) {
  const nextGreeting = typeof greeting === 'string' ? greeting : '';
  const currentConfig =
    typeof aiService !== 'undefined' && typeof aiService.getConfig === 'function'
      ? aiService.getConfig()
      : {};
  const currentValues = _getEditorPromptValuesForSettings(currentConfig);
  // Init 模块 UI 已移到世界卡；未传入时保留世界卡现有值，避免被清空
  const nextInitModule =
    typeof initModule === 'string' ? initModule : currentValues.savedInitModule;
  const editorPromptsChanged =
    currentValues.savedGreeting !== nextGreeting || currentValues.savedInitModule !== nextInitModule;

  const mgr = window.worldCardManager;
  if (
    !mgr ||
    typeof mgr.getActiveCardId !== 'function' ||
    typeof mgr.get !== 'function' ||
    typeof mgr.update !== 'function'
  ) {
    return { ok: true, hasActiveWorldCard: false, changed: false, requestedChange: editorPromptsChanged };
  }
  const activeId = mgr.getActiveCardId();
  if (!activeId) {
    return { ok: true, hasActiveWorldCard: false, changed: false, requestedChange: editorPromptsChanged };
  }

  const card = mgr.get(activeId);
  if (!card) {
    return {
      ok: false,
      hasActiveWorldCard: true,
      reason:
        _getSettingsLocale() === 'en'
          ? 'the current world card does not exist'
          : '当前世界卡不存在',
    };
  }
  if (_isBuiltInWorldCardForSettings(card)) {
    return {
      ok: true,
      hasActiveWorldCard: true,
      skippedBuiltIn: true,
      changed: false,
      requestedChange: editorPromptsChanged,
    };
  }

  if (!editorPromptsChanged) {
    return { ok: true, hasActiveWorldCard: true, changed: false, requestedChange: false };
  }

  const snapshot =
    card.snapshot && typeof card.snapshot === 'object' ? _deepClone(card.snapshot) : {};
  if (!snapshot.prompt_modules || typeof snapshot.prompt_modules !== 'object') {
    snapshot.prompt_modules = { modules: {}, module_meta: {}, _summary: '' };
  }
  if (!snapshot.prompt_modules.modules || typeof snapshot.prompt_modules.modules !== 'object') {
    snapshot.prompt_modules.modules = {};
  }
  if (
    !snapshot.prompt_modules.module_meta ||
    typeof snapshot.prompt_modules.module_meta !== 'object'
  ) {
    snapshot.prompt_modules.module_meta = {};
  }

  snapshot.prompt_modules.opening_greeting = nextGreeting;
  snapshot.prompt_modules.modules.init = nextInitModule;

  const shouldDeferRuntimeActivation =
    typeof window.aiService?.hasActiveRequest === 'function' && window.aiService.hasActiveRequest();
  const targetLocale = _getSettingsLocale();

  const result = mgr.update(
    activeId,
    {
      snapshot,
      localizedContentLocale: targetLocale,
    },
    { allowEmptySnapshot: true, suppressRuntimeActivation: shouldDeferRuntimeActivation }
  );
  if (!result) {
    return {
      ok: false,
      hasActiveWorldCard: true,
      reason:
        _getSettingsLocale() === 'en'
          ? 'failed to write to the world card (storage may be full)'
          : '写入世界卡失败（可能存储空间不足）',
    };
  }
  if (
    shouldDeferRuntimeActivation &&
    typeof window.aiService?.queueDeferredWorldCardActivation === 'function'
  ) {
    window.aiService.queueDeferredWorldCardActivation(activeId, targetLocale);
  }
  return {
    ok: true,
    hasActiveWorldCard: true,
    changed: true,
    requestedChange: true,
    deferredRuntimeActivation: shouldDeferRuntimeActivation,
  };
}

function _refreshEditorPromptsForLocaleChange() {
  const activeCard = _getActiveWorldCardForSettings();
  const greetingTextarea = document.getElementById('editor-greeting');
  const initTextarea = document.getElementById('editor-init-module');

  if (_isBuiltInWorldCardForSettings(activeCard)) {
    const currentConfig =
      typeof aiService !== 'undefined' && typeof aiService.getConfig === 'function'
        ? aiService.getConfig()
        : {};
    const editorPromptValues = _getEditorPromptValuesForSettings(currentConfig);
    _savedEditorGreetingValue = editorPromptValues.savedGreeting;
    _savedEditorInitValue = editorPromptValues.savedInitModule;
    if (greetingTextarea) {
      greetingTextarea.value = editorPromptValues.greeting;
    }
    if (initTextarea) {
      initTextarea.value = editorPromptValues.initModule;
    }
    _refreshCustomTabTextareaHeights();
    populateStepPreviews();
  }

  _syncEditorPromptReadonlyState(activeCard);
}

/**
 * 绑定 .tab-strip[data-toggle-target] 这种"二段开关"控件到隐藏 checkbox。
 * 结构:
 *   <div class="tab-strip" data-toggle-target="X">
 *     <input type="checkbox" id="X" hidden [checked]>
 *     <button class="tab" data-value="on">开</button>
 *     <button class="tab" data-value="off">关</button>
 *   </div>
 * 行为：用户点击段 → 设置 checkbox.checked + dispatch change（触发原有业务监听器）+ 同步 .is-active。
 * 程序式 .checked = X 后请直接调 _syncToggleTabStripVisualsForCheckbox(checkbox) 同步视觉
 * （不再 dispatch change，避免与监听器互相递归）。
 * 幂等：可重复调用，绑定标记防止重复挂事件。
 */
function _bindToggleTabStrips() {
  document.querySelectorAll('.tab-strip[data-toggle-target]').forEach(strip => {
    const checkboxId = strip.dataset.toggleTarget;
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) return;

    _syncToggleTabStripVisuals(strip);

    if (strip.dataset.toggleBound === '1') return;

    strip.querySelectorAll('.tab[data-value]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.value === 'on';
        if (checkbox.checked === target) return;
        checkbox.checked = target;
        _syncToggleTabStripVisuals(strip);
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    strip.dataset.toggleBound = '1';
  });
}

function _syncToggleTabStripVisuals(strip) {
  const checkbox = document.getElementById(strip.dataset.toggleTarget);
  if (!checkbox) return;
  const value = checkbox.checked ? 'on' : 'off';
  strip.querySelectorAll('.tab[data-value]').forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.value === value);
  });
}

/**
 * 程序式 set checkbox.checked 后调用：仅同步对应 tab-strip 的 .is-active 视觉，
 * 不 dispatch change，避免与业务监听器的相互递归。
 */
function _syncToggleTabStripVisualsForCheckbox(checkbox) {
  if (!checkbox?.id) return;
  const strip = document.querySelector(`.tab-strip[data-toggle-target="${checkbox.id}"]`);
  if (strip) _syncToggleTabStripVisuals(strip);
}

function _syncNarrativeLengthTabs(activeLength) {
  const tabs = document.querySelectorAll('#narrative-length-tabs .tab[data-length]');
  tabs.forEach(tab => {
    tab.classList.toggle('is-active', tab.dataset.length === activeLength);
  });
}

function _getActiveNarrativeLength() {
  const active = document.querySelector(
    '#narrative-length-tabs .tab[data-length].is-active'
  );
  return active?.dataset.length || null;
}

// 推荐模式下叙事篇幅锁定为 medium 且禁用 UI；非推荐模式恢复为用户保存值且解禁
function _syncNarrativeLengthDisabled(disabled) {
  const section = document.getElementById('narrative-length-section');
  if (section) {
    section.classList.toggle('is-recommended-locked', disabled);
  }
  document.querySelectorAll('#narrative-length-tabs .tab[data-length]').forEach(tab => {
    tab.disabled = !!disabled;
    tab.setAttribute('aria-disabled', disabled ? 'true' : 'false');
  });
}

function _applyNarrativeLengthToUI(config = null) {
  const allowed = ['short', 'medium', 'long'];
  const isRecommended = currentApiSettingsMode === 'recommended';
  const cfg = config || window.aiService?.getConfig?.() || {};
  const savedLength = allowed.includes(cfg.narrativeLength)
    ? cfg.narrativeLength
    : 'medium';
  _syncNarrativeLengthTabs(isRecommended ? 'medium' : savedLength);
  _syncNarrativeLengthDisabled(isRecommended);
}

const SETTINGS_LOCALE_COPY = {
  'zh-CN': {
    header: {
      title: '设置',
      subtitle: 'CONFIGURATION',
      mobileTitle: '设置',
      basicTab: '基础设置',
      apiTab: 'API设置',
      promptsTab: '提示词设置',
      generalTab: '通用设置',
      customTab: '自定义设置',
      languageToggleToEn: '切换到英文',
      languageToggleToZh: '切换到中文',
      languageToggleTextEn: 'En',
      languageToggleTextZh: '中',
      themeToggleToLight: '切换到浅色主题',
      themeToggleToDark: '切换到深色主题',
      cancel: '取消',
      save: '保存',
    },
    general: {
      apiKeysLabel: 'API Keys',
      customProvidersLabel: '自定义服务商',
      customProvidersHint: '(OpenAI / Anthropic 兼容)',
      uiScaleLabel: '界面大小',
      uiScaleDefaultBtn: '恢复默认',
      uiScaleDefaultTitleDefault: '当前已是默认大小',
      uiScaleDefaultTitleManual: '恢复为默认大小',
      uiScaleValueDefault: percent => `默认(${percent})`,
      uiScaleHintAuto: '默认模式：会按屏幕宽度自动调整界面大小。',
      uiScaleHintManual: '手动模式：拖动滑杆调整界面大小。',
      themeSkinLabel: '主题风格',
      themeSkinNames: {
        metro: 'Metro',
        cartoon: '卡通',
        cultivation: '水墨',
        cyberpunk: '霓虹',
        literary: '文学',
      },
      themeSkinHints: {
        cultivation: '浅色模式效果最佳',
        cyberpunk: '深色模式效果最佳',
        literary: '浅色模式效果最佳',
      },
      bgMode: {
        label: '页面背景',
        options: {
          solid: '纯色',
          parchment: '羊皮纸',
          worldCard: '世界卡封面',
          custom: '自定义',
        },
        descriptions: {
          solid: '跟随深色模式',
          parchment: '浅色锁定',
          worldCard: '敬请期待',
          custom: '上传一张图',
        },
        editBtn: '编辑位置',
        replaceBtn: '换图',
        clearBtn: '清除',
        editorTitle: '编辑背景图',
        editorHint: '在预览框内拖动图片调整位置，用滑块调整缩放。',
        editorCancel: '取消',
        editorConfirm: '确定',
        scaleLabel: '缩放',
        parchmentLockTip: '羊皮纸模式下主题被锁定为浅色',
        uploadTooLarge: '图片过大（需要小于 10MB）',
        uploadNotImage: '请选择图片文件',
      },
      defaultContentFont: {
        label: '正文使用默认字体',
        hint: '正文区域使用系统默认字体，提高长文阅读舒适度',
      },
      narrativeColorize: {
        label: '叙事着色',
        hint: '为对话、心理活动、说话人等文字显示不同颜色',
      },
      clickToSend: {
        label: '点击选项即发送',
        hint: '关闭时，点击选项会先填入输入栏，需要手动发送',
      },
      streamingLabel: '流式输出',
      helpButtonTitle: '推荐模型',
      editPrice: '编辑价格',
      savePrice: '保存',
      inputLabel: '输入',
      outputLabel: '输出',
      tempLabel: '温度/Temp',
      thinkingHint: 'DeepSeek 的部分工具调用可能不会回传思考文本',
      thinkingHelp:
        '当思考档位为 High 或 Max 时，DeepSeek 请求会路由到推理后端。但推理后端不接受"强制调用特定工具"的请求，因此游戏中需要必调工具的若干步骤（叙事生成、面板更新、选项生成等）会自动关闭这些请求的思考——以保证工具一定被调用，代价是这些请求看不到思考文本。<span class="module-thinking-help-emphasis">大部分的思考不受影响，可正常使用，思考会正常开启并生效。</span><a href="https://api-docs.deepseek.com/guides/function_calling" target="_blank" rel="noopener noreferrer">详见 DeepSeek API 文档</a>',
      apiKeysFoldTitle: '官方服务商（Gemini / OpenAI / Grok / Anthropic）',
      apiKeysFoldNote: '只支持官方 API，需科学上网',
      webSearchToggleLabel: '联网搜索',
      webSearchToggleSupportedNote: '只支持 Anthropic 和 Gemini',
      webSearchToggleHintPrefix: '开启后',
      webSearchToggleHintWarning: '可能产生额外费用',
      webSearchToggleHintSuffix:
        '，具体计费请咨询 Gemini / Anthropic。Anthropic 用户需先在 Anthropic 后台开启 Web Search 才能生效。',
      webSearchConfirmTitle: '开启联网搜索',
      simple: {
        gameLabel: '标准设置',
      },
      advanced: {
        label: '高级设置',
        hint: '为每个步骤单独配置模型',
        reactLabel: 'ReAct',
        smsLabel: '短信',
        summaryChapterLabel: '总结 / 章节',
        designLabel: '设计模式',
        designModelWarning:
          '⚠️ 该模型在设计模式下表现不稳定（可能输出空气泡或跑题）。推荐使用 Claude Sonnet / Opus 等模型。',
      },
      recommended: {
        label: '推荐设置',
        hint: '使用 DeepSeek V4 最优搭配',
        bannerTitle: '推荐设置已启用',
        bannerBody: '每个阶段已使用最优模型搭配',
        helpBody:
          '需绑定官方 DeepSeek API Key。开启后每个阶段会自动选用 DeepSeek V4 Flash / Pro 与对应思考档位的最佳搭配，兼顾速度与质量。<em class="recommended-help-quip">"我们<span class="recommended-help-emphasis">推荐</span>您使用<span class="recommended-help-emphasis">推荐</span>的<span class="recommended-help-emphasis">推荐</span>设置在<span class="recommended-help-emphasis">推荐</span>模式中体验<span class="recommended-help-emphasis">推荐</span>的效果:)"</em>',
        disabledTooltip: '在账户中心绑定 DeepSeek API Key 后可用',
      },
      help: {
        game: '<p><strong>推荐模型：</strong>DeepSeek V4 Flash, Gemini 3 Flash preview</p>',
        react: '<p><strong>完美适配模型：</strong>DeepSeek V4 Flash, Gemini 3 Flash preview</p>',
        sms: '<p><strong>完美适配模型：</strong>Claude Sonnet 4.6</p>',
        summaryChapter: '<p><strong>完美适配模型：</strong>DeepSeek V4 Flash</p>',
        design: '<p><strong>完美适配模型：</strong>Claude Opus 4.6</p>',
      },
      provider: {
        openOfficialTitle: '打开官网',
        openOfficialDescription: providerName =>
          `将打开 ${providerName} 官网（新标签页）。确定继续吗？`,
        test: '测试',
        testShort: '测试',
        testConnectionTitle: '测试连接',
        failed: '失败',
        unknownError: '未知错误',
        deleteProviderTitle: '删除服务商',
        deleteProviderBody: name => `确定要删除「${name}」吗？`,
        deletedProvider: name => `已删除 ${name}`,
        fillUrlFirst: '请先填写 URL',
        fillModelFirst: '请先填写模型名称',
        addProvider: '+ 添加服务商',
        defaultProviderName: '新服务商',
        providerNameLabel: '名称',
        providerNamePlaceholder: '服务商名称',
        modelLabel: '模型',
        modelPlaceholder: '例如 gpt-5.5 / claude-sonnet-4-6 / deepseek-v4-flash',
        deleteButtonTitle: '删除',
        fetchModels: '获取模型',
        noModelsFound: '该服务商未返回可用模型',
        fetchModelsFailed: '获取模型列表失败',
        // 共用 toast 前缀（按 HTTP status 分类，"测试连接"和"获取模型"两个按钮共享）
        apiErrorAuth: 'API Key 无效',                        // 401 / 403
        apiErrorBalance: '账户余额不足',                       // 402
        apiErrorNotFound: '找不到（请检查 URL 路径与模型名）', // 404
        apiErrorNetwork: '无法连接，请检查 URL 与网络',         // fetch TypeError
        fillUrlAndKeyFirst: '请先填写 URL 和 API Key',
        invalidModelHasSpace: '模型 ID 不能包含空格，请检查是否填错了字段',
        invalidModelLooksLikeLabel: value =>
          `"${value}" 看起来是字段标签而不是模型 ID，请填写实际的模型名（如 gpt-5.5 / claude-sonnet-4-6）`,
        invalidModelTooLong: '模型 ID 过长（超过 100 字符），可能是粘贴了 API Key',
        pastedLooksLikeApiKey: '粘贴的内容看起来像 API Key，是否填错了字段？',
        pasteTitle: '粘贴',
        pasteFailed: '无法访问剪贴板',
        pasteFallback: '请长按输入框粘贴',
        protocolLabel: '协议',
        protocolOpenAI: 'OpenAI 兼容（默认）',
        protocolAnthropic: 'Anthropic 兼容',
        baseUrlPlaceholderAnthropic: 'https://api.deepseek.com/anthropic',
        maxOutputTokensLabel: 'Max Output Tokens',
        maxOutputTokensPlaceholder: '例如 8192',
        advancedSectionLabel: '高级',
        statusBadgePass: '测试通过',
        statusBadgeFail: '测试失败',
        statusBadgeUntested: '未测试 — 建议先点"测试"按钮验证 URL / Key / 模型名',
        unverifiedSaveTitle: '有服务商还没通过测试',
        unverifiedSaveBody: names => {
          const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const list = names.map(n => `「${esc(n)}」`).join('、');
          return `以下自定义服务商还没点过"测试"按钮验证：<br><strong>${list}</strong><br><br>如果 URL / Key / 模型名 有任何一项错了，开局后第一个回合就会报错。建议先回去点一下"测试"。`;
        },
        unverifiedSaveConfirm: '仍然保存',
        unverifiedSaveCancel: '回去测试',
      },
      feedback: {
        entryEyebrow: 'BUG FEEDBACK',
        entryTitle: '反馈 / 报 Bug',
        entryBody:
          '遇到 bug、逻辑问题或流程漏洞时，可以直接留言。默认会附带当前 Debug JSON，帮助更快定位。<br><span style="color: var(--text-soft);">由于服务器更新，暂不可用，正在加紧恢复中。</span>', // ui-lint-allow
        entryButton: '打开反馈表单',
        modalTitle: '反馈 / 报 Bug',
        modalDescription:
          '留下你遇到的问题、复现方式或体验建议。默认会附带当前 Debug JSON，你也可以取消勾选。',
        titleLabel: '问题标题',
        titlePlaceholder: '一句话概括你遇到的问题',
        descriptionLabel: '问题描述',
        descriptionPlaceholder: '发生了什么、你原本期待什么、是否有明显报错',
        contactLabel: '联系方式（可选）',
        contactPlaceholder: '邮箱、QQ 或你希望我联系你的方式',
        screenshotLabel: '上传截图（可选）',
        screenshotPlaceholder: '点击或拖放图片，最多 3 张',
        includeDebugLabel: '附带当前 Debug JSON',
        includeDebugHint:
          '默认附带当前 Debug JSON；如果体积过大，提交前会提示你取消勾选后重试。',
        debugMetaEmpty: '当前没有可附带的 Debug 记录，将只发送文字反馈。',
        debugMetaReady: sizeLabel => `将附带当前 Debug JSON（约 ${sizeLabel}）。`,
        debugMetaTooLarge: (sizeLabel, limitLabel) =>
          `当前 Debug JSON 约 ${sizeLabel}，超过安全上限 ${limitLabel}，提交前会被拦截。`,
        cancelButton: '返回设置',
        submitButton: '发送反馈',
        submittingButton: '发送中...',
        toast: {
          missingTitle: '请先填写问题标题',
          missingDescription: '请先填写问题描述',
          submitted: '反馈已发送，感谢你的帮助。',
          submitFailed: '反馈发送失败，请稍后重试。',
          notEnabled:
            '反馈接收端点未配置，请联系开发者。',
          tooLarge: (sizeLabel, limitLabel) =>
            `当前 Debug JSON 约 ${sizeLabel}，超过安全上限 ${limitLabel}。请取消勾选 Debug 后重试。`,
          tooLargeGeneral: (sizeLabel, limitLabel) =>
            `提交内容约 ${sizeLabel}，超过安全上限 ${limitLabel}。请减少截图或压缩图片后重试。`,
          tooManyImages: '最多只能上传 3 张图片',
          imageTooLarge: name => `图片 ${name} 超过 5 MB，请压缩后重试`,
        },
      },
    },
    custom: {
      helpButtonTitle: '帮助',
      narrativeLength: {
        title: '叙事篇幅',
        hint: '控制 AI 正文字数范围',
        short: '短 (100-200字)',
        medium: '中 (约500字)',
        long: '长 (1000+字)',
        lockedHint: '推荐模式下不可更改',
      },
      systemPrompt: {
        title: '自定义 System Prompt',
        hint: '多条额外指令；user 角色条目会作为伪历史插入到对话最前',
        placeholder: '例如：回复时使用更加诗意的语言风格...',
        add: '+ 新增提示词',
        roleLabel: '角色',
        roleSystem: 'system',
        roleSystemDefaultSuffix: '（默认）',
        roleUser: 'user',
        contentLabel: '内容',
        editLabel: '编辑',
        saveLabel: '保存',
        deleteLabel: '删除',
        moveUpTitle: '上移',
        moveDownTitle: '下移',
        enableTitle: '启用 / 禁用此提示词',
        disabledLabel: '已禁用',
        emptyPreview: '(空)',
      },
      reset: {
        title: '重置',
        button: '重置所有自定义设置内容',
        buttonTitle: '重置所有自定义设置内容为默认值',
      },
      greeting: {
        title: '开场白',
        hint: '新游戏时 AI 发出的第一条消息',
        placeholder: '开场白内容...',
      },
      init: {
        title: 'Init 模块',
        hint: 'Turn 1 自动注入的开场引导规则',
        placeholder: 'Init 模块内容...',
      },
      readonly: {
        suffix: '（当前内置默认世界只读）',
        reason:
          '当前激活的是内置默认世界，这里的开场白只读。请在设计模式另存为新世界后修改。',
      },
      help: {
        systemPrompt:
          '<p><strong>用途：</strong>多条自定义指令，按顺序追加到系统默认 Prompt 之后。每条可选角色：</p><p><strong>system：</strong>作为系统指令追加，影响 AI 的每一轮输出（最常用）。</p><p><strong>user：</strong>作为"伪造的玩家对话"插入到真实对话历史最前面，相当于给 AI 看一份开场对白，常用于人设引导、对话风格预热。</p><p><strong>建议：</strong>条目越少越好，保持简洁清晰，避免与默认 Prompt 冲突。可用全局"重置"按钮一键清空。</p>',
        reset:
          '<p><strong>用途：</strong>一键将此页面所有自定义设置恢复为默认值，包括自定义 System Prompt 和开场白的内容。</p><p><strong>建议：</strong>当你的自定义修改导致 AI 表现异常，或想从零开始重新配置时使用。注意：此操作不可撤销，建议先导出当前设置作为备份。</p><p><strong>修改：</strong>点击「重置所有自定义设置内容」按钮即可执行，会有确认弹窗防止误操作。</p>',
        greeting:
          '<p><strong>用途：</strong>开场白是每次开始新游戏时，AI 发出的第一条消息。它用于建立世界观氛围、引导玩家进入故事，通常包含场景描述和初始互动提示。</p><p><strong>建议：</strong>当你想为自定义世界设定独特的开场氛围时修改。好的开场白应包含：场景描写、玩家角色的初始状态、以及 1-2 个引导性问题帮助玩家开始冒险。</p><p><strong>修改：</strong>在下方文本框中直接编辑开场白内容。内容会在新游戏第一回合完全替换默认开场消息。使用下方「重置所有自定义设置内容」可恢复为默认值。</p>',
        init: '<p><strong>用途：</strong>Init 模块是仅在第一回合（Turn 1）自动注入的特殊引导规则。它告诉 AI 如何处理游戏开场——比如如何引导玩家选择起始时间、地点，以及如何展开初始剧情。</p><p><strong>建议：</strong>当你想定制新手引导流程时修改。例如改变初始问题、添加教程性质的引导、或跳过某些默认的开场步骤。此模块仅影响第一回合，不会影响后续游戏。</p><p><strong>修改：</strong>在下方文本框中编辑引导规则。内容将在第一回合作为额外指令注入 AI 的系统 Prompt。使用下方「重置所有自定义设置内容」可恢复为默认值。留空则不注入任何开场引导。</p>',
      },
    },
    functionEditor: {
      groupTitle: '常驻 Function',
      coreBadge: '常驻',
      fields: {
        name: 'Name',
        description: 'Description',
        parameters: 'Parameters',
        dataSource: '数据来源',
        content: 'Content / 返回内容',
      },
      buttons: {
        edit: '编辑',
        preview: '预览',
        reset: '重置',
        add: '新增 Function',
      },
      custom: {
        newTitle: '(新 Function)',
        deleteTitle: '移除此自定义 Function',
      },
      placeholders: {
        defaultName: 'my_function（字母/下划线开头）',
        customName: 'my_function（字母/下划线开头，a-z 0-9 _ . : -）',
        customDescription: '描述 AI 何时应该调用此函数...',
        parameters:
          '{\n  "type": "object",\n  "properties": {\n    "param_name": {\n      "type": "string",\n      "description": "参数描述"\n    }\n  }\n}',
        coreDescription: '常驻注入机制，不参与 Function Call。',
        coreContent: '填写常驻注入的核心世界机制内容...',
        noDefaultContent: '（无默认内容）',
        loading: '（加载中...）',
        customContent: '当 AI 调用此函数时返回的内容...',
        noParameters: '（无参数）',
        requiredSuffix: '（必填）',
      },
      confirm: {
        resetFunctionTitle: '重置Function内容',
        resetFunctionBody: functionName =>
          `确定要重置 ${functionName} 的内容吗？这将清空自定义内容并恢复使用默认值。`,
        resetAllTitle: '重置所有内容',
        resetAllBody:
          'ReAct Functions 和 System Prompt 将恢复为默认值，Editor 开场白将恢复为上次保存的值（API Key、模型选择等通用设置不受影响）。',
        resetReactTitle: '重置 Functions',
        resetReactBody:
          '确定要重置所有 Function 为默认值吗？将恢复已删除的 Function、清除所有自定义设置（包括参数修改），并移除所有新增的 Function。',
      },
      toast: {
        chooseProviderAndModel: '请先选择服务商并填写模型名称',
        stepModelSaved: '步骤模型已保存',
        editPriceFirst: '请先点“编辑价格”',
        invalidPrice: max => `价格必须是 0 ~ ${max} 的数字`,
        priceSaveFailed: '保存价格失败',
        priceSaved: '价格已保存',
        resetAllDone: '所有 Step 内容已重置，点击"保存"生效',
        invalidFunctionName: name =>
          `Function 名称不合法: "${name}"\n须以字母/下划线开头，仅允许 a-z 0-9 _ . : -`,
        invalidParameters: message => `Parameters JSON 格式错误: ${message}`,
        missingModel: (moduleLabel, providerLabel) =>
          `${moduleLabel} 使用了 ${providerLabel}，请选择模型或填写自定义模型名称`,
        temperatureAdjusted: modules => `temp 已自动修正（0~2）: ${modules.join(', ')}`,
        saveFailed: reason => `保存失败：${reason || '无法写入当前世界卡'}`,
        coreWorldMechanics:
          'core_world_mechanics 不会在设置页直接写入世界卡。请在设计模式修改后点击”应用到游戏”。',
        savedNoWorld: '配置已保存（当前无激活世界卡，开场白/init 编辑未保存）',
        saved: '配置已保存',
      },
    },
  },
  en: {
    header: {
      title: 'Settings',
      subtitle: 'CONFIGURATION',
      mobileTitle: 'Settings',
      basicTab: 'Basic',
      apiTab: 'API',
      promptsTab: 'Prompts',
      generalTab: 'General',
      customTab: 'Custom',
      languageToggleToEn: 'Switch to English',
      languageToggleToZh: 'Switch to Chinese',
      languageToggleTextEn: 'En',
      languageToggleTextZh: '中',
      themeToggleToLight: 'Switch to light theme',
      themeToggleToDark: 'Switch to dark theme',
      cancel: 'Cancel',
      save: 'Save',
    },
    general: {
      apiKeysLabel: 'API Keys',
      customProvidersLabel: 'Custom Providers',
      customProvidersHint: '(OpenAI / Anthropic compatible)',
      uiScaleLabel: 'Interface Size',
      uiScaleDefaultBtn: 'Reset',
      uiScaleDefaultTitleDefault: 'Already using the default size',
      uiScaleDefaultTitleManual: 'Restore the default size',
      uiScaleValueDefault: percent => `Auto (${percent})`,
      uiScaleHintAuto: 'Auto mode adjusts the interface size based on screen width.',
      uiScaleHintManual: 'Manual mode lets you adjust the interface size with the slider.',
      themeSkinLabel: 'Theme',
      themeSkinNames: {
        metro: 'Metro',
        cartoon: 'Toon',
        cultivation: 'Ink Wash',
        cyberpunk: 'Neon',
        literary: 'Literary',
      },
      themeSkinHints: {
        cultivation: 'Best in light mode',
        cyberpunk: 'Best in dark mode',
        literary: 'Best in light mode',
      },
      bgMode: {
        label: 'Page Background',
        options: {
          solid: 'Solid',
          parchment: 'Parchment',
          worldCard: 'World Card Cover',
          custom: 'Custom',
        },
        descriptions: {
          solid: 'Follows dark mode',
          parchment: 'Locks light mode',
          worldCard: 'Coming soon',
          custom: 'Upload an image',
        },
        editBtn: 'Edit position',
        replaceBtn: 'Replace',
        clearBtn: 'Clear',
        editorTitle: 'Edit background',
        editorHint: 'Drag the image to reposition, use the slider to zoom.',
        editorCancel: 'Cancel',
        editorConfirm: 'Confirm',
        scaleLabel: 'Zoom',
        parchmentLockTip: 'Dark mode is locked off while Parchment is selected',
        uploadTooLarge: 'Image too large (must be under 10MB)',
        uploadNotImage: 'Please choose an image file',
      },
      defaultContentFont: {
        label: 'Default Content Font',
        hint: 'Use system default font for story text to improve readability',
      },
      narrativeColorize: {
        label: 'Narrative Coloring',
        hint: 'Highlight dialogue, thoughts, and speakers in different colors',
      },
      clickToSend: {
        label: 'Click to Send',
        hint: 'When off, clicking a choice fills the input box for manual sending',
      },
      streamingLabel: 'Streaming',
      helpButtonTitle: 'Recommended Models',
      editPrice: 'Edit Price',
      savePrice: 'Save',
      inputLabel: 'Input',
      outputLabel: 'Output',
      tempLabel: 'Temp',
      thinkingHint: 'Some DeepSeek tool calls will not return thinking text.',
      thinkingHelp:
        'When Thinking is set to High or Max, DeepSeek requests are routed to the reasoner backend. The reasoner refuses requests that pin the model to a specific tool, so the game silently disables thinking on those steps (narrative generation, panel updates, choice generation) — the tool call is guaranteed to fire, but those requests no longer return thinking text. <span class="module-thinking-help-emphasis">Most requests are unaffected — Thinking still activates normally for the rest.</span> <a href="https://api-docs.deepseek.com/guides/function_calling" target="_blank" rel="noopener noreferrer">See the DeepSeek API docs</a>.',
      apiKeysFoldTitle: 'Official Providers (Gemini / OpenAI / Grok / Anthropic)',
      apiKeysFoldNote: 'Official APIs only',
      webSearchToggleLabel: 'Web Search',
      webSearchToggleSupportedNote: 'Only Anthropic and Gemini are supported',
      webSearchToggleHintPrefix: '',
      webSearchToggleHintWarning: 'May incur additional fees',
      webSearchToggleHintSuffix:
        ' — check pricing with Gemini / Anthropic. Anthropic users must first enable Web Search in the Anthropic console.',
      webSearchConfirmTitle: 'Enable Web Search',
      simple: {
        gameLabel: 'Standard Settings',
      },
      advanced: {
        label: 'Advanced Settings',
        hint: 'Configure a model for each step separately',
        reactLabel: 'ReAct',
        smsLabel: 'Messages',
        summaryChapterLabel: 'Summary / Chapter',
        designLabel: 'Design Mode',
        designModelWarning:
          '⚠️ This model is unstable in Design Mode (may produce empty bubbles or off-topic replies). We recommend Claude Sonnet / Opus.',
      },
      recommended: {
        label: 'Recommended Settings',
        hint: 'Optimal DeepSeek V4 pairing',
        bannerTitle: 'Recommended settings active',
        bannerBody: 'Each phase uses an optimal model pairing',
        helpBody:
          'Requires an official DeepSeek API key. When enabled, each phase auto-selects the best mix of DeepSeek V4 Flash / Pro and thinking levels — balancing speed and quality. <em class="recommended-help-quip">“We <span class="recommended-help-emphasis">recommend</span> using the <span class="recommended-help-emphasis">recommended</span> <span class="recommended-help-emphasis">Recommended</span> Settings in <span class="recommended-help-emphasis">recommended</span> mode to experience the <span class="recommended-help-emphasis">recommended</span> result :)”</em>',
        disabledTooltip: 'Bind your DeepSeek API key in Account Center to unlock',
      },
      help: {
        game: '<p><strong>Recommended models:</strong> DeepSeek V4 Flash, Gemini 3 Flash Preview</p>',
        react: '<p><strong>Recommended models:</strong> DeepSeek V4 Flash, Gemini 3 Flash Preview</p>',
        sms: '<p><strong>Recommended model:</strong> Claude Sonnet 4.6</p>',
        summaryChapter: '<p><strong>Recommended model:</strong> DeepSeek V4 Flash</p>',
        design: '<p><strong>Recommended model:</strong> Claude Opus 4.6</p>',
      },
      provider: {
        openOfficialTitle: 'Open Official Site',
        openOfficialDescription: providerName =>
          `Open the official site for ${providerName} in a new tab?`,
        test: 'Test',
        testShort: 'Test',
        testConnectionTitle: 'Test Connection',
        failed: 'Failed',
        unknownError: 'Unknown error',
        deleteProviderTitle: 'Delete Provider',
        deleteProviderBody: name => `Delete "${name}"?`,
        deletedProvider: name => `Deleted ${name}`,
        fillUrlFirst: 'Please fill in the URL first',
        fillModelFirst: 'Please fill in the model name first',
        addProvider: '+ Add Provider',
        defaultProviderName: 'New Provider',
        providerNameLabel: 'Name',
        providerNamePlaceholder: 'Provider Name',
        modelLabel: 'Model',
        modelPlaceholder: 'e.g. gpt-5.5 / claude-sonnet-4-6 / deepseek-v4-flash',
        deleteButtonTitle: 'Delete',
        fetchModels: 'Models',
        noModelsFound: 'No models available from this provider',
        fetchModelsFailed: 'Failed to fetch models',
        // Shared toast prefixes (categorized by HTTP status, used by both "Test" and "Models" buttons)
        apiErrorAuth: 'Invalid API Key',                              // 401 / 403
        apiErrorBalance: 'Insufficient balance',                       // 402
        apiErrorNotFound: 'Not found (check URL path and model name)',// 404
        apiErrorNetwork: 'Cannot reach endpoint — check URL and network', // fetch TypeError
        fillUrlAndKeyFirst: 'Please fill in the URL and API Key first',
        invalidModelHasSpace: 'Model ID cannot contain spaces — looks like the wrong field',
        invalidModelLooksLikeLabel: value =>
          `"${value}" looks like a field label, not a model ID. Please enter the real model name (e.g. gpt-5.5 / claude-sonnet-4-6).`,
        invalidModelTooLong: 'Model ID is too long (>100 chars) — likely pasted an API Key',
        pastedLooksLikeApiKey: 'The pasted content looks like an API Key — wrong field?',
        pasteTitle: 'Paste',
        pasteFailed: 'Clipboard access denied',
        pasteFallback: 'Please long-press the input to paste',
        protocolLabel: 'Protocol',
        protocolOpenAI: 'OpenAI-compatible (default)',
        protocolAnthropic: 'Anthropic-compatible',
        baseUrlPlaceholderAnthropic: 'https://api.deepseek.com/anthropic',
        maxOutputTokensLabel: 'Max Output Tokens',
        maxOutputTokensPlaceholder: 'e.g. 8192',
        advancedSectionLabel: 'Advanced',
        statusBadgePass: 'Test passed',
        statusBadgeFail: 'Test failed',
        statusBadgeUntested: 'Not tested — click "Test" to verify URL / Key / model',
        unverifiedSaveTitle: 'Provider(s) not tested',
        unverifiedSaveBody: names => {
          const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const list = names.map(n => `"${esc(n)}"`).join(', ');
          return `These custom provider(s) haven't passed the "Test" check yet: <strong>${list}</strong><br><br>If the URL / Key / model name is wrong on any of them, the first turn will fail. Recommend going back and clicking "Test".`;
        },
        unverifiedSaveConfirm: 'Save anyway',
        unverifiedSaveCancel: 'Go back & test',
      },
      feedback: {
        entryEyebrow: 'BUG FEEDBACK',
        entryTitle: 'Feedback / Bug Report',
        entryBody:
          'Leave a note when you hit a bug, logic issue, or flow problem. Debug JSON is attached by default to help with diagnosis.<br><span style="color: var(--text-soft);">Due to server migration, temporarily unavailable—restoration in progress.</span>', // ui-lint-allow
        entryButton: 'Open Feedback Form',
        modalTitle: 'Feedback / Bug Report',
        modalDescription:
          'Describe the problem or share product feedback. Debug JSON is attached by default; you can uncheck it if you prefer.',
        titleLabel: 'Issue Title',
        titlePlaceholder: 'Summarize the problem in one sentence',
        descriptionLabel: 'Description',
        descriptionPlaceholder: 'What happened, what you expected, and any visible error text',
        contactLabel: 'Contact (Optional)',
        contactPlaceholder: 'Email, QQ, or another way to reach you',
        screenshotLabel: 'Screenshots (Optional)',
        screenshotPlaceholder: 'Click or drop images, up to 3',
        includeDebugLabel: 'Attach current Debug JSON',
        includeDebugHint:
          'Debug JSON is attached by default. If the payload is too large, submission will be blocked before sending.',
        debugMetaEmpty: 'No debug snapshot is available right now, so only the text feedback will be sent.',
        debugMetaReady: sizeLabel => `The current Debug JSON will be attached (about ${sizeLabel}).`,
        debugMetaTooLarge: (sizeLabel, limitLabel) =>
          `The current Debug JSON is about ${sizeLabel}, which exceeds the safe limit of ${limitLabel}. Submission will be blocked.`,
        cancelButton: 'Back to Settings',
        submitButton: 'Send Feedback',
        submittingButton: 'Sending...',
        toast: {
          missingTitle: 'Please enter a title for the issue first.',
          missingDescription: 'Please describe the issue first.',
          submitted: 'Feedback sent. Thank you for helping improve the game.',
          submitFailed: 'Failed to send feedback. Please try again later.',
          notEnabled:
            'Feedback endpoint is not configured. Please contact the developer.',
          tooLarge: (sizeLabel, limitLabel) =>
            `The current Debug JSON is about ${sizeLabel}, which exceeds the safe limit of ${limitLabel}. Uncheck Debug and try again.`,
          tooLargeGeneral: (sizeLabel, limitLabel) =>
            `The submission is about ${sizeLabel}, which exceeds the safe limit of ${limitLabel}. Please remove or compress some screenshots and try again.`,
          tooManyImages: 'You can upload up to 3 images',
          imageTooLarge: name => `Image ${name} exceeds 5 MB. Please compress it and try again.`,
        },
      },
    },
    custom: {
      helpButtonTitle: 'Help',
      narrativeLength: {
        title: 'Narrative Length',
        hint: 'Controls the word-count range of AI responses',
        short: 'Short (100–200)',
        medium: 'Medium (~500)',
        long: 'Long (1000+)',
        lockedHint: 'Locked while Recommended Settings is on',
      },
      systemPrompt: {
        title: 'Custom System Prompt',
        hint: 'Multiple extra instructions; user-role entries are injected as fake history at the start of the conversation.',
        placeholder: 'Example: Use a more poetic writing style in replies...',
        add: '+ Add Prompt',
        roleLabel: 'Role',
        roleSystem: 'system',
        roleSystemDefaultSuffix: ' (default)',
        roleUser: 'user',
        contentLabel: 'Content',
        editLabel: 'Edit',
        saveLabel: 'Save',
        deleteLabel: 'Delete',
        moveUpTitle: 'Move up',
        moveDownTitle: 'Move down',
        enableTitle: 'Enable / disable this prompt',
        disabledLabel: 'disabled',
        emptyPreview: '(empty)',
      },
      reset: {
        title: 'Reset',
        button: 'Reset All Custom Content',
        buttonTitle: 'Reset all custom content to defaults',
      },
      greeting: {
        title: 'Opening Greeting',
        hint: 'The first AI message in a new game.',
        placeholder: 'Opening greeting...',
      },
      init: {
        title: 'Init Module',
        hint: 'Opening rules injected automatically on Turn 1.',
        placeholder: 'Init module content...',
      },
      readonly: {
        suffix: ' (read-only for the built-in default world)',
        reason:
          'The built-in default world is active, so the greeting is read-only here. Save a new world from Design Mode first if you want to edit it.',
      },
      help: {
        systemPrompt:
          '<p><strong>Purpose:</strong> Multiple custom instructions, appended in order after the default system prompt. Each entry has a role:</p><p><strong>system:</strong> appended as a system instruction; affects every AI reply (most common).</p><p><strong>user:</strong> injected as a "fake player turn" at the very start of the conversation history — useful for persona priming and tone calibration.</p><p><strong>Tips:</strong> Keep the list short and focused. Use the global Reset button to clear all entries at once.</p>',
        reset:
          '<p><strong>Purpose:</strong> Reset all custom content on this page, including the custom system prompt and opening greeting.</p><p><strong>Recommended:</strong> Use this if your custom prompt setup starts causing bad output.</p><p><strong>How to change:</strong> Click the button and confirm the reset.</p>',
        greeting:
          '<p><strong>Purpose:</strong> This is the first AI message at the start of a new game. It sets the mood and guides the player into the story.</p><p><strong>Recommended:</strong> A good opening includes scene setup, the player’s initial state, and one or two guiding questions.</p><p><strong>How to change:</strong> Edit the box below. It replaces the default first-turn opening message.</p>',
        init: '<p><strong>Purpose:</strong> The Init module is injected only on Turn 1. It tells the AI how to handle the opening flow, such as time, place, and initial story setup.</p><p><strong>Recommended:</strong> Use this to customize onboarding or skip parts of the default opening flow.</p><p><strong>How to change:</strong> Edit the box below. Leave it empty to disable extra opening rules.</p>',
      },
    },
    functionEditor: {
      groupTitle: 'Resident Functions',
      coreBadge: 'Resident',
      fields: {
        name: 'Name',
        description: 'Description',
        parameters: 'Parameters',
        dataSource: 'Data Source',
        content: 'Content / Return Value',
      },
      buttons: {
        edit: 'Edit',
        preview: 'Preview',
        reset: 'Reset',
        add: '+ Add Function',
      },
      custom: {
        newTitle: '(New Function)',
        deleteTitle: 'Remove this custom function',
      },
      placeholders: {
        defaultName: 'my_function (start with a letter or underscore)',
        customName: 'my_function (start with a letter or underscore; allowed: a-z 0-9 _ . : -)',
        customDescription: 'Describe when the AI should call this function...',
        parameters:
          '{\n  "type": "object",\n  "properties": {\n    "param_name": {\n      "type": "string",\n      "description": "Parameter description"\n    }\n  }\n}',
        coreDescription:
          'Resident injection mechanism. Not used in function calling.',
        coreContent: 'Describe the core world mechanics for resident injection...',
        noDefaultContent: '(No default content)',
        loading: '(Loading...)',
        customContent: 'Return content when the AI calls this function...',
        noParameters: '(No parameters)',
        requiredSuffix: ' (required)',
      },
      confirm: {
        resetFunctionTitle: 'Reset Function Content',
        resetFunctionBody: functionName =>
          `Reset the content of ${functionName}? This clears the custom content and falls back to the default behavior.`,
        resetAllTitle: 'Reset All Content',
        resetAllBody:
          'ReAct Functions and System Prompt will be reset to defaults. The Editor greeting will return to its last saved value. API keys, model choices, and other general settings will not be changed.',
        resetReactTitle: 'Reset Functions',
        resetReactBody:
          'Reset all functions to their defaults? This restores deleted functions, clears custom edits (including parameter changes), and removes newly added functions.',
      },
      toast: {
        chooseProviderAndModel: 'Choose a provider and enter a model name first.',
        stepModelSaved: 'Step model saved.',
        editPriceFirst: 'Click "Edit Price" first.',
        invalidPrice: max => `Price must be a number between 0 and ${max}.`,
        priceSaveFailed: 'Failed to save the price.',
        priceSaved: 'Price saved.',
        resetAllDone: 'All Step content was reset. Click "Save" to apply it.',
        invalidFunctionName: name =>
          `Invalid function name: "${name}"\nIt must start with a letter or underscore, and may only contain a-z 0-9 _ . : -`,
        invalidParameters: message => `Parameters JSON is invalid: ${message}`,
        missingModel: (moduleLabel, providerLabel) =>
          `${moduleLabel} uses ${providerLabel}. Choose a model or enter a custom model name.`,
        temperatureAdjusted: modules =>
          `Temperature was adjusted to stay within 0-2: ${modules.join(', ')}`,
        saveFailed: reason =>
          `Save failed: ${reason || 'could not write to the active world card'}`,
        coreWorldMechanics:
          'core_world_mechanics is not written directly from the settings page. Update it in Design Mode and then click "Apply to Game".',
        savedNoWorld:
          'Settings saved. No active world card was available, so the greeting/init edits were not saved.',
        saved: 'Settings saved.',
      },
    },
  },
};

function _getSettingsLocale() {
  return _getResolvedUiLanguageForSettings() === 'en' ? 'en' : 'zh-CN';
}

function _getSettingsCopy() {
  return SETTINGS_LOCALE_COPY[_getSettingsLocale()] || SETTINGS_LOCALE_COPY['zh-CN'];
}

function _normalizeThemeMode(mode) {
  return mode === 'dark' ? 'dark' : 'light';
}

function _getCurrentThemeModeForSettings() {
  if (typeof settingsDraftThemeMode === 'string') {
    return _normalizeThemeMode(settingsDraftThemeMode);
  }
  if (window.themeUI && typeof window.themeUI.getThemeMode === 'function') {
    return _normalizeThemeMode(window.themeUI.getThemeMode());
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getConfig === 'function') {
    return _normalizeThemeMode(aiService.getConfig()?.themeMode);
  }
  return 'light';
}

function _getCurrentUiLanguageForSettings() {
  const normalizer = window.i18nService?.normalizeUiLanguage;
  if (typeof settingsDraftUiLanguage === 'string') {
    return typeof normalizer === 'function'
      ? normalizer(settingsDraftUiLanguage)
      : settingsDraftUiLanguage;
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getConfig === 'function') {
    const configured = aiService.getConfig()?.uiLanguage;
    return typeof normalizer === 'function' ? normalizer(configured) : configured || 'auto';
  }
  return 'auto';
}

function _getResolvedUiLanguageForSettings() {
  const configured = _getCurrentUiLanguageForSettings();
  if (configured === 'zh-CN' || configured === 'en') return configured;
  const resolved = window.i18nService?.getResolvedLanguage?.();
  if (resolved === 'en') return 'en';
  if (resolved === 'zh-CN') return 'zh-CN';
  return /^en/i.test(navigator.language || '') ? 'en' : 'zh-CN';
}

function _applyUiLanguageInstant(value) {
  const normalizer = window.i18nService?.normalizeUiLanguage;
  settingsDraftUiLanguage = typeof normalizer === 'function' ? normalizer(value) : value || 'auto';
  if (window.i18nService && typeof window.i18nService.setUiLanguage === 'function') {
    window.i18nService.setUiLanguage(settingsDraftUiLanguage);
  }
  _syncSettingsLanguageToggleButton();
}

function _syncSettingsLanguageToggleButton() {
  const btn = document.getElementById('settings-language-toggle-btn');
  if (!btn) return;
  const copy = _getSettingsCopy();
  const resolvedLanguage = _getResolvedUiLanguageForSettings();
  const nextLanguage = resolvedLanguage === 'en' ? 'zh-CN' : 'en';
  const toggleText =
    nextLanguage === 'en' ? copy.header.languageToggleTextEn : copy.header.languageToggleTextZh;
  const label =
    nextLanguage === 'en' ? copy.header.languageToggleToEn : copy.header.languageToggleToZh;
  btn.textContent = toggleText;
  btn.dataset.targetLanguage = nextLanguage;
  btn.setAttribute('aria-label', label);
  btn.title = label;
}

function _syncSettingsThemeToggleIcon(mode) {
  const btn = document.getElementById('settings-theme-toggle-btn');
  if (!btn) return;
  const copy = _getSettingsCopy();
  const normalized = _normalizeThemeMode(mode);
  const icon = btn.querySelector('.material-symbols-outlined');
  const toLight = normalized === 'dark';
  if (icon) {
    icon.textContent = toLight ? 'light_mode' : 'dark_mode';
  }
  const label = toLight ? copy.header.themeToggleToLight : copy.header.themeToggleToDark;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.setAttribute('aria-pressed', normalized === 'dark' ? 'true' : 'false');
}

function _applyThemeModeInstant(mode, origin) {
  const normalized = _normalizeThemeMode(mode);
  if (window.themeUI && typeof window.themeUI.applyThemeMode === 'function') {
    window.themeUI.applyThemeMode(normalized, origin ? { origin } : {});
  }
  settingsDraftThemeMode = normalized;
  _syncSettingsThemeToggleIcon(normalized);
}

function _normalizeUIScaleMode(mode) {
  return mode === 'manual' ? 'manual' : 'auto';
}

function _normalizeUIScaleValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  // 吸附到最接近的离散档位
  let nearest = SETTINGS_UI_SCALE_VALUES[0];
  let bestDiff = Math.abs(parsed - nearest);
  for (let i = 1; i < SETTINGS_UI_SCALE_VALUES.length; i++) {
    const diff = Math.abs(parsed - SETTINGS_UI_SCALE_VALUES[i]);
    if (diff < bestDiff) {
      bestDiff = diff;
      nearest = SETTINGS_UI_SCALE_VALUES[i];
    }
  }
  return nearest;
}

function _formatUIScalePercent(value) {
  return `${Math.round(_normalizeUIScaleValue(value) * 100)}%`;
}

function _getCurrentUIScaleModeForSettings() {
  if (typeof settingsDraftUiScaleMode === 'string') {
    return _normalizeUIScaleMode(settingsDraftUiScaleMode);
  }
  if (window.themeUI && typeof window.themeUI.getUIScaleSettings === 'function') {
    return _normalizeUIScaleMode(window.themeUI.getUIScaleSettings().mode);
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getConfig === 'function') {
    return _normalizeUIScaleMode(aiService.getConfig()?.uiScaleMode);
  }
  return 'auto';
}

function _getCurrentUIScaleValueForSettings() {
  if (typeof settingsDraftUiScale === 'number') {
    return _normalizeUIScaleValue(settingsDraftUiScale);
  }
  if (window.themeUI && typeof window.themeUI.getUIScaleSettings === 'function') {
    return _normalizeUIScaleValue(window.themeUI.getUIScaleSettings().scale);
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getConfig === 'function') {
    return _normalizeUIScaleValue(aiService.getConfig()?.uiScale);
  }
  return 1;
}

function _syncUIScaleControls(mode, scale) {
  const copy = _getSettingsCopy();
  const normalizedMode = _normalizeUIScaleMode(mode);
  const normalizedScale = _normalizeUIScaleValue(scale);

  const defaultBtn = document.getElementById('ui-scale-default-btn');
  const tabs = document.getElementById('ui-scale-tabs');
  const valueEl = document.getElementById('ui-scale-value');
  const hintEl = document.getElementById('ui-scale-hint');
  const isDefaultMode = normalizedMode === 'auto';
  const autoScale =
    window.themeUI && typeof window.themeUI.getAutoUIScale === 'function'
      ? _normalizeUIScaleValue(window.themeUI.getAutoUIScale())
      : 1;

  if (tabs) {
    // auto 模式也点亮匹配 auto 计算值的那段，避免"看起来全没选中"
    const activeScale = isDefaultMode ? autoScale : normalizedScale;
    tabs.querySelectorAll('.tab[data-scale]').forEach(tab => {
      const tabScale = Number(tab.dataset.scale);
      tab.classList.toggle('is-active', Math.abs(tabScale - activeScale) < 0.001);
    });
  }

  if (defaultBtn) {
    defaultBtn.disabled = isDefaultMode;
    defaultBtn.title = isDefaultMode
      ? copy.general.uiScaleDefaultTitleDefault
      : copy.general.uiScaleDefaultTitleManual;
    defaultBtn.setAttribute('aria-pressed', isDefaultMode ? 'true' : 'false');
  }

  if (valueEl) {
    const currentPercent = _formatUIScalePercent(isDefaultMode ? autoScale : normalizedScale);
    valueEl.textContent = isDefaultMode
      ? copy.general.uiScaleValueDefault(currentPercent)
      : currentPercent;
  }

  if (hintEl) {
    hintEl.textContent = isDefaultMode
      ? copy.general.uiScaleHintAuto
      : copy.general.uiScaleHintManual;
  }
}

window.openSettings = openSettings;
window.saveSettings = saveSettings;

function _applyUIScaleInstant(mode, scale) {
  const normalizedMode = _normalizeUIScaleMode(mode);
  const normalizedScale = _normalizeUIScaleValue(scale);
  settingsDraftUiScaleMode = normalizedMode;
  settingsDraftUiScale = normalizedScale;

  if (window.themeUI && typeof window.themeUI.applyUIScaleSettings === 'function') {
    window.themeUI.applyUIScaleSettings({ mode: normalizedMode, scale: normalizedScale });
  }
  _syncUIScaleControls(normalizedMode, normalizedScale);
}

function _setSettingsActionButtonCopy(selector, zhText, enText) {
  if (typeof window.i18nService?.setBilingualText === 'function') {
    window.i18nService.setBilingualText(selector, zhText, enText);
    return;
  }
  const node = document.querySelector(selector);
  if (!node) return;
  node.textContent = _getSettingsLocale() === 'en' ? enText : zhText;
}

function _applySettingsPriceRowCopy() {
  const copy = _getSettingsCopy();
  document.querySelectorAll('#settings-modal .module-price-row').forEach(row => {
    const moduleId = row.dataset.moduleId;
    if (!moduleId) return;
    const inEl = row.querySelector(`#module-price-in-${moduleId}`);
    const outEl = row.querySelector(`#module-price-out-${moduleId}`);
    const priceInfo = row.querySelector('.price-info');
    if (priceInfo) {
      const inputValue = inEl?.textContent || '-';
      const outputValue = outEl?.textContent || '-';
      priceInfo.innerHTML = `${copy.general.inputLabel} <span id="module-price-in-${moduleId}" class="price-value">${inputValue}</span> / ${copy.general.outputLabel} <span id="module-price-out-${moduleId}" class="price-value">${outputValue}</span> $/M`;
    }
  });
  document.querySelectorAll('#settings-modal [data-action~="module-price-edit-btn"]').forEach(btn => {
    btn.textContent = copy.general.editPrice;
  });
  document.querySelectorAll('#settings-modal [data-action~="module-price-save-btn"]').forEach(btn => {
    btn.textContent = copy.general.savePrice;
  });
  document.querySelectorAll('#settings-modal .price-label.temp-label').forEach(label => {
    label.textContent = copy.general.tempLabel;
  });
  document.querySelectorAll('#settings-modal .module-streaming-label').forEach(label => {
    label.textContent = copy.general.streamingLabel;
  });
  document.querySelectorAll('#tab-api [data-action~="section-help-btn"]').forEach(btn => {
    btn.title = copy.general.helpButtonTitle;
  });
  document.querySelectorAll('#tab-prompts [data-action~="section-help-btn"]').forEach(btn => {
    btn.title = copy.custom.helpButtonTitle;
  });
}

function _applySettingsStaticCopy() {
  const copy = _getSettingsCopy();
  const zhCopy = SETTINGS_LOCALE_COPY['zh-CN'];
  const enCopy = SETTINGS_LOCALE_COPY.en;
  const textMap = {
    'header.title': copy.header.title,
    'header.subtitle': copy.header.subtitle,
    'header.mobileTitle': copy.header.mobileTitle,
    'header.basicTab': copy.header.basicTab,
    'header.apiTab': copy.header.apiTab,
    'header.promptsTab': copy.header.promptsTab,
    'general.apiKeysLabel': copy.general.apiKeysLabel,
    'general.customProvidersLabel': copy.general.customProvidersLabel,
    'general.customProvidersHint': copy.general.customProvidersHint,
    'general.uiScaleLabel': copy.general.uiScaleLabel,
    'general.uiScaleDefaultBtn': copy.general.uiScaleDefaultBtn,
    'general.uiScaleHint': copy.general.uiScaleHintAuto,
    'general.simple.gameLabel': copy.general.simple.gameLabel,
    'general.advanced.label': copy.general.advanced.label,
    'general.advanced.hint': copy.general.advanced.hint,
    'general.advanced.reactLabel': copy.general.advanced.reactLabel,
    'general.advanced.smsLabel': copy.general.advanced.smsLabel,
    'general.advanced.summaryChapterLabel': copy.general.advanced.summaryChapterLabel,
    'general.advanced.designLabel': copy.general.advanced.designLabel,
    'general.advanced.designModelWarning': copy.general.advanced.designModelWarning,
    'general.recommended.label': copy.general.recommended.label,
    'general.recommended.hint': copy.general.recommended.hint,
    'general.recommended.bannerTitle': copy.general.recommended.bannerTitle,
    'general.recommended.bannerBody': copy.general.recommended.bannerBody,
    'general.recommended.helpBody': copy.general.recommended.helpBody,
    'general.help.react': copy.general.help.react,
    'general.help.sms': copy.general.help.sms,
    'general.help.summaryChapter': copy.general.help.summaryChapter,
    'general.help.design': copy.general.help.design,
    'general.themeSkinLabel': copy.general.themeSkinLabel,
    'general.bgMode.label': copy.general.bgMode.label,
    'general.bgMode.editBtn': copy.general.bgMode.editBtn,
    'general.bgMode.replaceBtn': copy.general.bgMode.replaceBtn,
    'general.bgMode.clearBtn': copy.general.bgMode.clearBtn,
    'general.bgMode.editorTitle': copy.general.bgMode.editorTitle,
    'general.bgMode.editorHint': copy.general.bgMode.editorHint,
    'general.bgMode.editorCancel': copy.general.bgMode.editorCancel,
    'general.bgMode.editorConfirm': copy.general.bgMode.editorConfirm,
    'general.bgMode.scaleLabel': copy.general.bgMode.scaleLabel,
    'general.defaultContentFont.label': copy.general.defaultContentFont.label,
    'general.defaultContentFont.hint': copy.general.defaultContentFont.hint,
    'general.narrativeColorize.label': copy.general.narrativeColorize.label,
    'general.narrativeColorize.hint': copy.general.narrativeColorize.hint,
    'general.clickToSend.label': copy.general.clickToSend.label,
    'general.clickToSend.hint': copy.general.clickToSend.hint,
    'general.thinkingHint': copy.general.thinkingHint,
    'general.thinkingHelp': copy.general.thinkingHelp,
    'general.feedback.entryEyebrow': copy.general.feedback.entryEyebrow,
    'general.feedback.entryTitle': copy.general.feedback.entryTitle,
    'general.feedback.entryBody': copy.general.feedback.entryBody,
    'general.feedback.entryButton': copy.general.feedback.entryButton,
    'general.feedback.modalTitle': copy.general.feedback.modalTitle,
    'general.feedback.modalDescription': copy.general.feedback.modalDescription,
    'general.feedback.titleLabel': copy.general.feedback.titleLabel,
    'general.feedback.descriptionLabel': copy.general.feedback.descriptionLabel,
    'general.feedback.stepsLabel': copy.general.feedback.stepsLabel,
    'general.feedback.contactLabel': copy.general.feedback.contactLabel,
    'general.feedback.includeDebugLabel': copy.general.feedback.includeDebugLabel,
    'general.feedback.includeDebugHint': copy.general.feedback.includeDebugHint,
    'general.feedback.cancelButton': copy.general.feedback.cancelButton,
    'general.feedback.submitButton': copy.general.feedback.submitButton,
    'custom.narrativeLength.title': copy.custom.narrativeLength.title,
    'custom.narrativeLength.hint': copy.custom.narrativeLength.hint,
    'custom.narrativeLength.short': copy.custom.narrativeLength.short,
    'custom.narrativeLength.medium': copy.custom.narrativeLength.medium,
    'custom.narrativeLength.long': copy.custom.narrativeLength.long,
    'custom.narrativeLength.lockedHint': copy.custom.narrativeLength.lockedHint,
    'custom.systemPrompt.title': copy.custom.systemPrompt.title,
    'custom.systemPrompt.hint': copy.custom.systemPrompt.hint,
    'custom.systemPrompt.add': copy.custom.systemPrompt.add,
    'custom.help.systemPrompt': copy.custom.help.systemPrompt,
    'custom.reset.title': copy.custom.reset.title,
    'custom.reset.button': copy.custom.reset.button,
    'custom.help.reset': copy.custom.help.reset,
    'custom.greeting.title': copy.custom.greeting.title,
    'custom.greeting.hint': copy.custom.greeting.hint,
    'custom.help.greeting': copy.custom.help.greeting,
    'custom.init.title': copy.custom.init.title,
    'custom.init.hint': copy.custom.init.hint,
    'custom.help.init': copy.custom.help.init,
  };
  const htmlKeys = new Set([
    'general.simple.gameLabel',
    'general.help.react',
    'general.help.sms',
    'general.help.summaryChapter',
    'general.help.design',
    'general.feedback.entryBody',
    'general.thinkingHelp',
    'general.recommended.helpBody',
    'custom.help.systemPrompt',
    'custom.help.reset',
    'custom.help.greeting',
    'custom.help.init',
  ]);

  document.querySelectorAll('[data-settings-copy]').forEach(node => {
    const key = node.dataset.settingsCopy;
    if (!Object.prototype.hasOwnProperty.call(textMap, key)) return;
    const value = textMap[key];
    if (htmlKeys.has(key)) {
      node.innerHTML = value;
    } else {
      node.textContent = value;
    }
  });

  const placeholderMap = {
    'custom.systemPrompt.placeholder': copy.custom.systemPrompt.placeholder,
    'custom.greeting.placeholder': copy.custom.greeting.placeholder,
    'custom.init.placeholder': copy.custom.init.placeholder,
    'general.feedback.titlePlaceholder': copy.general.feedback.titlePlaceholder,
    'general.feedback.descriptionPlaceholder': copy.general.feedback.descriptionPlaceholder,
    'general.feedback.stepsPlaceholder': copy.general.feedback.stepsPlaceholder,
    'general.feedback.contactPlaceholder': copy.general.feedback.contactPlaceholder,
  };
  document.querySelectorAll('[data-settings-copy-placeholder]').forEach(node => {
    const key = node.dataset.settingsCopyPlaceholder;
    if (!Object.prototype.hasOwnProperty.call(placeholderMap, key)) return;
    node.setAttribute('placeholder', placeholderMap[key]);
  });

  const titleMap = {
    'custom.reset.buttonTitle': copy.custom.reset.buttonTitle,
  };
  document.querySelectorAll('#settings-modal [data-settings-copy-title]').forEach(node => {
    const key = node.dataset.settingsCopyTitle;
    if (!Object.prototype.hasOwnProperty.call(titleMap, key)) return;
    node.setAttribute('title', titleMap[key]);
  });

  const helpGame = document.getElementById('help-game');
  if (helpGame) helpGame.innerHTML = copy.general.help.game;


  _setSettingsActionButtonCopy('#cancel-settings-btn', zhCopy.header.cancel, enCopy.header.cancel);
  _setSettingsActionButtonCopy('#save-settings-btn', zhCopy.header.save, enCopy.header.save);
  _applySettingsPriceRowCopy();
  _syncSettingsLanguageToggleButton();
  _syncSettingsThemeToggleIcon(_getCurrentThemeModeForSettings());
  _syncUIScaleControls(_getCurrentUIScaleModeForSettings(), _getCurrentUIScaleValueForSettings());
  _syncEditorPromptReadonlyState(_getActiveWorldCardForSettings());
  _setFeedbackSubmitState(feedbackSubmitPending);
  _updateFeedbackDebugMeta();
}

function _captureReactLocaleRefreshState() {
  const container = document.getElementById('react-fn-list');
  if (!container) return null;
  return {
    config: {
      customFunctionOverrides: _collectReactFunctionOverrides(),
      customFunctionContents: _collectReactFunctionContents(),
      deletedFunctions: _collectDeletedFunctions(),
      customFunctions: _collectCustomFunctions(),
      customParameterOverrides: _collectParameterOverrides(),
      disableResidentFunctions: _collectDisableResidentFunctions(),
    },
    expandedDefaultNames: new Set(
      Array.from(container.querySelectorAll('.fn-card.expanded[data-default-name]'))
        .map(card => card.dataset.defaultName)
        .filter(Boolean)
    ),
    expandedCustomIds: new Set(
      Array.from(container.querySelectorAll('.fn-card-custom.expanded'))
        .map(card => card.dataset.customId)
        .filter(Boolean)
    ),
    expandedCoreWorldMechanics: Boolean(
      container.querySelector('.fn-card.expanded[data-core-module-id="core_world_mechanics"]')
    ),
    expandedGroupKeys: new Set(
      Array.from(container.querySelectorAll('.fn-group.fn-group-expanded'))
        .map(group => group.dataset.groupKey)
        .filter(Boolean)
    ),
    coreWorldMechanicsContent: _collectCoreWorldMechanicsDraft(),
  };
}

function applySettingsLocaleToDom(options = {}) {
  const { refreshDynamic = true } = options;
  _applySettingsStaticCopy();
  if (!refreshDynamic) return;

  _captureDraftProviderApiKeysFromUI();
  _captureDraftCustomProvidersFromUI();
  _renderApiKeyRows();
  _renderCustomProviderManager();

  const reactLocaleState = _captureReactLocaleRefreshState();
  if (reactLocaleState) {
    _populateReactFunctions(reactLocaleState.config, reactLocaleState);
  }
  populateStepPreviews();
}

// 依赖: aiService (来自 aiService.js)

// 当前选中的设置标签页
let currentSettingsTab = 'basic';

// API 设置模式: 'simple' (常规) 或 'advanced' (高级)
let currentApiSettingsMode = 'simple';

// 模块列表(UI显示用)
// 模块列表(UI显示用)
// main 被拆分为 react, editor, step3 等模块
const UI_MODULES = ['react', 'sms', 'summary-chapter', 'design'];
const UI_MODULES_WITH_UNIFIED = ['game', ...UI_MODULES];
// 常规模式：标准设置控制所有模块
const SIMPLE_GROUP_GAME = ['react', 'sms', 'summary-chapter', 'design'];
// 实际存储的模块列表
const _MODULES = ['react', 'sms', 'summary', 'chapter', 'design'];

// 服务商列表
const PROVIDERS = [
  'gemini',
  'openai',
  'grok',
  'anthropic',
  'deepseek',
  'siliconflow',
];
const FOLDED_OFFICIAL_PROVIDERS = ['gemini', 'openai', 'grok', 'anthropic'];
const VISIBLE_PROVIDERS = PROVIDERS.filter(id => !FOLDED_OFFICIAL_PROVIDERS.includes(id));

// 折叠栏内当前协议（Messages / generateContent）原生支持 server-side web search 的服务商。
// OpenAI 的 web_search 仅在 Responses API（项目走 Chat Completions），Grok 的 Live Search 已于 2026-01-12 退役。
const WEBSEARCH_SUPPORTED_PROVIDERS = ['anthropic', 'gemini'];

const SETTINGS_PROVIDER_OFFICIAL_URLS = {
  deepseek: 'https://platform.deepseek.com',
  siliconflow: 'https://www.siliconflow.cn/',
};

// 每个服务商的推荐模型(当切换服务商时自动填充)
const DEFAULT_MODELS = {
  gemini: 'gemini-3.1-flash-lite',
  deepseek: 'deepseek-v4-flash',
  openai: 'gpt-5.5',
  grok: 'grok-4.3',
  anthropic: 'claude-sonnet-4-6',
  siliconflow: 'deepseek-ai/DeepSeek-V4-Flash',
};

const CUSTOM_MODEL_OPTION_VALUE = '__custom__';
const BUILTIN_PROVIDER_MODEL_OPTIONS = {
  gemini: ['gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openai: ['gpt-5.5'],
  grok: ['grok-4.3'],
  anthropic: ['claude-sonnet-4-6', 'claude-opus-4-7'],
  siliconflow: ['deepseek-ai/DeepSeek-V4-Flash'],
};

// DeepSeek V4 hybrid 思考档位常量在 aiService.js 顶层声明，settingsUI.js 直接复用。

// 预置模型价格库（key: provider::model, 单位: $/M tokens）
const MODEL_PRICES = {
  // Gemini
  'gemini::gemini-3.1-flash-lite': { in: 0.25, out: 1.5 },
  'gemini::gemini-3.1-pro-preview': { in: 2, out: 12 },
  // DeepSeek V4（cache-miss 价；2026-04-24 发布）
  'deepseek::deepseek-v4-flash': { in: 0.14, out: 0.28 },
  // v4-pro 沿用 75% 折扣价作为标价
  'deepseek::deepseek-v4-pro': { in: 0.435, out: 0.87 },
  // OpenAI
  'openai::gpt-5.5': { in: 5, out: 30 },
  // Grok
  'grok::grok-4.3': { in: 1.25, out: 2.5 },
  // Anthropic
  'anthropic::claude-sonnet-4-6': { in: 3, out: 15 },
  'anthropic::claude-opus-4-7': { in: 5, out: 25 },
};

const MODULE_TEMPERATURE_MIN = 0;
// 上游 API 范围是 [0.0, 2.0) 左闭右开，clamp 到 1.99 避开边界
const MODULE_TEMPERATURE_MAX = 1.99;
const MODULE_PRICE_MAX = 100000;
const SETTINGS_UI_SCALE_VALUES = [0.9, 0.95, 1, 1.2, 1.5];
const FEEDBACK_FORM_MAX_BYTES = Math.floor(7.5 * 1024 * 1024);

let settingsDraftThemeMode = null;
let settingsDraftUiLanguage = null;
let settingsDraftUiScaleMode = null;
let settingsDraftUiScale = null;
let settingsDraftCustomProviders = null;
// 内存里记录每个 cp.id 的最近一次"实测"结果。
// 重渲染（如 +添加服务商 / 删除其他服务商）会重建所有 row DOM，dataset.testResult 会丢失；
// 这个 Map 让 _renderCustomProviderRow 在恢复时把状态还原回来。
// 不持久化到 config——浏览器刷新后清空，已保存的 cp 重新走"字段全填即视作 pass"的预设逻辑。
const _cpTestResultMemory = new Map();
let settingsDraftProviderApiKeys = null;
let settingsInitialThemeMode = null;
let settingsInitialThemeSkin = null;
let settingsInitialUiLanguage = null;
let settingsInitialUiScaleMode = null;
let settingsInitialUiScale = null;
// 背景模式草稿
let settingsDraftBgMode = null;
let settingsDraftBgCustom = null;
let settingsInitialBgMode = null;
let settingsInitialBgCustom = null;
// 待保存的新上传图片 blob（设置保存后写入 IndexedDB）
let settingsPendingBgBlob = null;
// 对象 URL 池（便于打开/关闭时释放）
let settingsBgCustomObjectUrl = null;
// 标记用户是否请求清除现有自定义图
let settingsPendingBgClear = false;
// 跟踪已绑定的事件监听器，避免重复绑定
const boundEventListeners = new Set();
let feedbackModalTrigger = null;
let feedbackSubmitPending = false;

function _deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function _stableSerializeSettingsValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => _stableSerializeSettingsValue(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${_stableSerializeSettingsValue(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function _normalizeSettingsConfigForCompare(currentConfig, nextPartialConfig = null) {
  const mergedConfig = {
    ..._deepClone(currentConfig || {}),
    ...(nextPartialConfig ? _deepClone(nextPartialConfig) : {}),
  };
  if (typeof aiService !== 'undefined' && typeof aiService._normalizeConfig === 'function') {
    return aiService._normalizeConfig(mergedConfig);
  }
  return mergedConfig;
}

function _settingsSaveRequiresChatRefresh(previousConfig, nextConfig) {
  return previousConfig?.uiLanguage !== nextConfig?.uiLanguage;
}

function _beginSettingsDraftSession(config) {
  settingsInitialThemeMode = _normalizeThemeMode(config?.themeMode);
  settingsDraftThemeMode = settingsInitialThemeMode;
  settingsInitialThemeSkin = config?.themeName || (window.themeUI && window.themeUI.getThemeName ? window.themeUI.getThemeName() : 'metro');
  settingsInitialUiLanguage =
    window.i18nService?.normalizeUiLanguage?.(config?.uiLanguage) || 'auto';
  settingsDraftUiLanguage = settingsInitialUiLanguage;
  settingsInitialUiScaleMode = _normalizeUIScaleMode(config?.uiScaleMode);
  settingsInitialUiScale = _normalizeUIScaleValue(config?.uiScale);
  settingsDraftUiScaleMode = settingsInitialUiScaleMode;
  settingsDraftUiScale = settingsInitialUiScale;
  settingsDraftCustomProviders = _deepClone(config?.customProviders || []);
  settingsDraftProviderApiKeys = _deepClone(config?.providerApiKeys || {});
  settingsInitialBgMode = window.themeUI?.normalizeBgMode?.(config?.backgroundMode) || 'solid';
  settingsDraftBgMode = settingsInitialBgMode;
  settingsInitialBgCustom = window.themeUI?.normalizeBgCustom?.(config?.backgroundCustom) || { positionX: 50, positionY: 50, scale: 100 };
  settingsDraftBgCustom = { ...settingsInitialBgCustom };
  settingsPendingBgBlob = null;
  settingsPendingBgClear = false;
}

function _clearSettingsDraftSession() {
  settingsDraftThemeMode = null;
  settingsDraftUiLanguage = null;
  settingsDraftUiScaleMode = null;
  settingsDraftUiScale = null;
  settingsDraftCustomProviders = null;
  settingsDraftProviderApiKeys = null;
  // 关掉 settings 后清空内存里的"测试结果"——下次打开时所有 cp 重新走"字段全填即默认 pass"逻辑，
  // 避免上次会话里的 'untested' / 'fail' 残留导致 badge 跟实际配置对不上
  _cpTestResultMemory.clear();
  settingsInitialThemeMode = null;
  settingsInitialThemeSkin = null;
  settingsInitialUiLanguage = null;
  settingsInitialUiScaleMode = null;
  settingsInitialUiScale = null;
  settingsDraftBgMode = null;
  settingsDraftBgCustom = null;
  settingsInitialBgMode = null;
  settingsInitialBgCustom = null;
  settingsPendingBgBlob = null;
  settingsPendingBgClear = false;
  if (settingsBgCustomObjectUrl) {
    URL.revokeObjectURL(settingsBgCustomObjectUrl);
    settingsBgCustomObjectUrl = null;
  }
}

function _getFeedbackCopy() {
  return _getSettingsCopy().general.feedback;
}

function _getFeedbackModal() {
  return document.getElementById('feedback-modal');
}

function _getFeedbackForm() {
  return document.getElementById('feedback-form');
}

function _formatFeedbackBytes(bytes = 0) {
  const normalized = Math.max(0, Number(bytes) || 0);
  if (normalized >= 1024 * 1024) return `${(normalized / (1024 * 1024)).toFixed(1)} MB`;
  if (normalized >= 1024) return `${Math.round(normalized / 1024)} KB`;
  return `${normalized} B`;
}

function _setFeedbackSubmitState(isPending = false) {
  feedbackSubmitPending = Boolean(isPending);
  const submitBtn = document.getElementById('feedback-submit-btn');
  const cancelBtn = document.getElementById('feedback-cancel-btn');
  const submitLabel = submitBtn?.querySelector('[data-settings-copy="general.feedback.submitButton"]');
  const copy = _getFeedbackCopy();
  if (submitBtn) submitBtn.disabled = feedbackSubmitPending;
  if (cancelBtn) cancelBtn.disabled = feedbackSubmitPending;
  if (submitLabel) {
    submitLabel.textContent = feedbackSubmitPending
      ? copy.submittingButton
      : copy.submitButton;
  }
}

function _getFeedbackVersionText() {
  const versionNode =
    document.getElementById('launcher-changelog-link') ||
    document.querySelector('.launcher-version-link');
  return (versionNode?.textContent || '').trim();
}

function _getFeedbackModeValue() {
  return typeof isDesignMode !== 'undefined' && isDesignMode ? 'design' : 'game';
}

function _populateFeedbackContextFields() {
  const activeCard = _getActiveWorldCardForSettings();
  const viewportWidth = Math.round(window.innerWidth || document.documentElement.clientWidth || 0);
  const viewportHeight = Math.round(
    window.innerHeight || document.documentElement.clientHeight || 0
  );
  const ratio = Number(window.devicePixelRatio || 1);
  const fields = {
    'feedback-page-url': window.location.href,
    'feedback-ui-language': window.i18nService?.getResolvedLanguage?.() || _getSettingsLocale(),
    'feedback-app-version': _getFeedbackVersionText(),
    'feedback-mode': _getFeedbackModeValue(),
    'feedback-user-agent': navigator.userAgent || '',
    'feedback-viewport': `${viewportWidth}x${viewportHeight}@${ratio}`,
    'feedback-world-card-id': activeCard?.id || '',
    'feedback-world-card-name': activeCard?.name || activeCard?.title || '',
  };

  Object.entries(fields).forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (field) field.value = value;
  });
}

function _getFeedbackDebugSnapshotText() {
  if (typeof window.getDebugPayloadSnapshot !== 'function') return '';
  const preferredTab = _getFeedbackModeValue() === 'design' ? 'design' : 'api';
  const primary = window.getDebugPayloadSnapshot(preferredTab);
  if (primary) return primary;
  const fallbackTab = preferredTab === 'design' ? 'api' : 'design';
  return window.getDebugPayloadSnapshot(fallbackTab) || '';
}

function _updateFeedbackDebugMeta() {
  const includeDebug = document.getElementById('feedback-include-debug');
  const meta = document.getElementById('feedback-debug-meta');
  if (!meta || !includeDebug) return;

  if (!includeDebug.checked) {
    meta.textContent = '';
    meta.hidden = true;
    meta.classList.remove('feedback-debug-box__meta--warning');
    return;
  }

  const copy = _getFeedbackCopy();
  const payloadText = _getFeedbackDebugSnapshotText();
  const payloadBytes = payloadText ? new TextEncoder().encode(payloadText).length : 0;
  const sizeLabel = _formatFeedbackBytes(payloadBytes);
  const limitLabel = _formatFeedbackBytes(FEEDBACK_FORM_MAX_BYTES);
  const oversize = payloadBytes > FEEDBACK_FORM_MAX_BYTES;

  meta.textContent = payloadText
    ? oversize
      ? copy.debugMetaTooLarge(sizeLabel, limitLabel)
      : copy.debugMetaReady(sizeLabel)
    : copy.debugMetaEmpty;
  meta.hidden = false;
  meta.classList.toggle('feedback-debug-box__meta--warning', oversize);
}

function _autoGrowTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const maxH = parseFloat(getComputedStyle(textarea).maxHeight) || 200;
  if (textarea.scrollHeight > maxH) {
    textarea.style.height = maxH + 'px';
    textarea.classList.add('is-overflowing');
  } else {
    textarea.style.height = textarea.scrollHeight + 'px';
    textarea.classList.remove('is-overflowing');
  }
}

const FEEDBACK_MAX_IMAGES = 3;
const FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image
let feedbackSelectedImages = [];

function _renderFeedbackImagePreviews() {
  const container = document.getElementById('feedback-upload-previews');
  if (!container) return;
  container.innerHTML = '';
  feedbackSelectedImages.forEach((file, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'feedback-upload-preview';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    img.onload = () => URL.revokeObjectURL(img.src);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn-danger btn-icon btn-sm';
    removeBtn.innerHTML = '×';
    removeBtn.addEventListener('click', () => _removeFeedbackImage(index));
    wrapper.appendChild(img);
    wrapper.appendChild(removeBtn);
    container.appendChild(wrapper);
  });
  // hide upload zone when at max
  const zone = document.getElementById('feedback-upload-zone');
  if (zone) zone.style.display = feedbackSelectedImages.length >= FEEDBACK_MAX_IMAGES ? 'none' : '';
}

function _removeFeedbackImage(index) {
  feedbackSelectedImages.splice(index, 1);
  _renderFeedbackImagePreviews();
}

function _handleFeedbackImageSelect(files) {
  const copy = _getFeedbackCopy();
  const incoming = Array.from(files).filter(f => f.type.startsWith('image/'));
  for (const file of incoming) {
    if (feedbackSelectedImages.length >= FEEDBACK_MAX_IMAGES) {
      showToast(copy.toast.tooManyImages);
      break;
    }
    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) {
      showToast(copy.toast.imageTooLarge(file.name));
      continue;
    }
    feedbackSelectedImages.push(file);
  }
  _renderFeedbackImagePreviews();
}

function _clearFeedbackImages() {
  feedbackSelectedImages = [];
  const container = document.getElementById('feedback-upload-previews');
  if (container) container.innerHTML = '';
  const zone = document.getElementById('feedback-upload-zone');
  if (zone) zone.style.display = '';
  const fileInput = document.getElementById('feedback-screenshots');
  if (fileInput) fileInput.value = '';
}

function _initFeedbackUploadZone() {
  const zone = document.getElementById('feedback-upload-zone');
  const fileInput = document.getElementById('feedback-screenshots');
  if (!zone || !fileInput || zone.dataset.uploadBound) return;

  zone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) _handleFeedbackImageSelect(fileInput.files);
    fileInput.value = '';
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer?.files?.length) _handleFeedbackImageSelect(e.dataTransfer.files);
  });
  zone.dataset.uploadBound = 'true';
}

function _initFeedbackAutoGrow() {
  const textarea = document.getElementById('feedback-description');
  if (!textarea || textarea.dataset.autoGrowBound) return;
  textarea.addEventListener('input', () => _autoGrowTextarea(textarea));
  textarea.dataset.autoGrowBound = 'true';
}

function openFeedbackModal(trigger = null) {
  const modal = _getFeedbackModal();
  const titleInput = document.getElementById('feedback-title');
  if (!modal) return;
  feedbackModalTrigger = trigger || document.activeElement || null;
  _populateFeedbackContextFields();
  _initFeedbackAutoGrow();
  _initFeedbackUploadZone();
  _clearFeedbackImages();
  _updateFeedbackDebugMeta();
  _setFeedbackSubmitState(false);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  const descTextarea = document.getElementById('feedback-description');
  if (descTextarea) { descTextarea.style.height = 'auto'; descTextarea.classList.remove('is-overflowing'); }
  requestAnimationFrame(() => titleInput?.focus());
}

function closeFeedbackModal(options = {}) {
  const { restoreFocus = true } = options;
  const modal = _getFeedbackModal();
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  _setFeedbackSubmitState(false);
  if (restoreFocus && feedbackModalTrigger && typeof feedbackModalTrigger.focus === 'function') {
    feedbackModalTrigger.focus();
  }
}

async function _handleFeedbackSubmit(event) {
  event.preventDefault();
  if (feedbackSubmitPending) return;

  const form = _getFeedbackForm();
  const copy = _getFeedbackCopy();
  const titleInput = document.getElementById('feedback-title');
  const descriptionInput = document.getElementById('feedback-description');
  const includeDebugInput = document.getElementById('feedback-include-debug');
  const debugPayloadField = document.getElementById('feedback-debug-payload');
  if (!form || !titleInput || !descriptionInput || !includeDebugInput || !debugPayloadField) return;

  if (!titleInput.value.trim()) {
    showToast(copy.toast.missingTitle);
    titleInput.focus();
    return;
  }
  if (!descriptionInput.value.trim()) {
    showToast(copy.toast.missingDescription);
    descriptionInput.focus();
    return;
  }

  titleInput.value = titleInput.value.trim();
  descriptionInput.value = descriptionInput.value.trim();
  const contactInput = document.getElementById('feedback-contact');
  if (contactInput) contactInput.value = contactInput.value.trim();

  _populateFeedbackContextFields();
  const includeDebug = includeDebugInput.checked;
  const debugPayload = includeDebug ? _getFeedbackDebugSnapshotText() : '';
  debugPayloadField.value = debugPayload;

  const formData = new FormData(form);

  // Remove the bare file input entries (browser adds empty ones); append our managed list
  formData.delete('screenshots');
  feedbackSelectedImages.forEach(file => formData.append('screenshots', file, file.name));

  // Estimate total size for limit check
  let estimatedBytes = 0;
  for (const [, value] of formData.entries()) {
    if (typeof value === 'string') {
      estimatedBytes += new TextEncoder().encode(value).length;
    } else if (value instanceof File) {
      estimatedBytes += value.size;
    }
  }

  if (estimatedBytes > FEEDBACK_FORM_MAX_BYTES) {
    const sizeText = _formatFeedbackBytes(estimatedBytes);
    const limitText = _formatFeedbackBytes(FEEDBACK_FORM_MAX_BYTES);
    showToast(
      includeDebug
        ? copy.toast.tooLarge(sizeText, limitText)
        : copy.toast.tooLargeGeneral(sizeText, limitText),
      4600
    );
    _updateFeedbackDebugMeta();
    return;
  }

  _setFeedbackSubmitState(true);
  try {
    const headers = {};
    let uid = '';
    try { uid = localStorage.getItem('analytics_uid') || ''; } catch (_) { /* ignore */ }
    if (uid) headers['X-Analytics-Uid'] = uid;
    const response = await fetch('/_/s-db3cd926d5a5/sync/feedback', {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    form.reset();
    debugPayloadField.value = '';
    _clearFeedbackImages();
    _updateFeedbackDebugMeta();
    closeFeedbackModal();
    showToast(copy.toast.submitted, 4200);
  } catch (error) {
    console.error('[SettingsUI] Feedback submit failed:', error);
    _updateFeedbackDebugMeta();
    if (error?.status === 404) {
      showToast(copy.toast.notEnabled, 5200);
    } else {
      showToast(copy.toast.submitFailed, 4200);
    }
  } finally {
    _setFeedbackSubmitState(false);
  }
}

function _getCurrentCustomProvidersForSettings() {
  if (Array.isArray(settingsDraftCustomProviders)) return settingsDraftCustomProviders;
  if (typeof aiService !== 'undefined' && typeof aiService.getCustomProviders === 'function') {
    return aiService.getCustomProviders();
  }
  return [];
}

function _getCurrentProviderApiKeysForSettings() {
  if (settingsDraftProviderApiKeys && typeof settingsDraftProviderApiKeys === 'object') {
    return settingsDraftProviderApiKeys;
  }
  return aiService.getConfig()?.providerApiKeys || {};
}

function _getCustomProviderByIdForSettings(id) {
  return _getCurrentCustomProvidersForSettings().find(p => p.id === id) || null;
}

function _getModuleDefaultConfigForSettings(uiModuleId, providerId = null) {
  const configModuleId = _getConfigModuleIdByUI(uiModuleId);
  const normalizedProvider =
    typeof providerId === 'string' && providerId.trim() ? providerId.trim() : 'gemini';
  const draftCustomProvider = normalizedProvider
    ? _getCustomProviderByIdForSettings(normalizedProvider)
    : null;
  if (draftCustomProvider && !_isBuiltinProviderForSettings(normalizedProvider)) {
    const baseConfig =
      typeof aiService !== 'undefined' && typeof aiService.getDefaultModuleConfig === 'function'
        ? aiService.getDefaultModuleConfig(configModuleId)
        : { provider: normalizedProvider, model: '' };
    return {
      ...baseConfig,
      provider: normalizedProvider,
      model: draftCustomProvider.defaultModel || '',
    };
  }
  if (typeof aiService !== 'undefined' && typeof aiService.getDefaultModuleConfig === 'function') {
    return aiService.getDefaultModuleConfig(configModuleId, providerId);
  }
  const builtinModel = DEFAULT_MODELS[normalizedProvider];
  const customModel = draftCustomProvider?.defaultModel || '';
  return {
    provider: normalizedProvider,
    model: builtinModel || customModel || '',
  };
}

function _getDefaultProviderForUIModule(uiModuleId) {
  return _getModuleDefaultConfigForSettings(uiModuleId).provider || 'gemini';
}

function _getProviderDefaultModel(uiModuleId, providerId) {
  return _getModuleDefaultConfigForSettings(uiModuleId, providerId).model || '';
}

function _isBuiltinProviderForSettings(providerId) {
  return PROVIDERS.includes(providerId);
}

function _getModelControlElements(moduleId) {
  return {
    modelSelect: document.getElementById(`module-model-select-${moduleId}`),
    modelInput: document.getElementById(`module-model-${moduleId}`),
  };
}

function _toggleCustomModelInput(moduleId, shouldShow) {
  const { modelInput } = _getModelControlElements(moduleId);
  if (!modelInput) return;
  modelInput.classList.toggle('is-hidden', !shouldShow);
  modelInput.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
}

function _getResolvedModelValue(moduleId) {
  const { modelSelect, modelInput } = _getModelControlElements(moduleId);
  if (modelSelect && modelSelect.value && modelSelect.value !== CUSTOM_MODEL_OPTION_VALUE) {
    return modelSelect.value.trim();
  }
  if (modelInput) {
    return modelInput.value.trim();
  }
  return '';
}

function _populateModelSelectByProvider(moduleId, provider) {
  const { modelSelect } = _getModelControlElements(moduleId);
  if (!modelSelect) return;

  let optionModels;
  if (_isBuiltinProviderForSettings(provider)) {
    optionModels = BUILTIN_PROVIDER_MODEL_OPTIONS[provider] || [];
  } else {
    // 自定义 provider：把"自定义服务商"行内填的 defaultModel 作为具体选项列出
    const cp = _getCustomProviderByIdForSettings(provider);
    optionModels = cp?.defaultModel ? [cp.defaultModel] : [];
  }

  modelSelect.innerHTML = '';
  optionModels.forEach(modelName => {
    const option = document.createElement('option');
    option.value = modelName;
    option.textContent = modelName;
    modelSelect.appendChild(option);
  });

  const customOption = document.createElement('option');
  customOption.value = CUSTOM_MODEL_OPTION_VALUE;
  customOption.textContent = _getSettingsLocale() === 'en' ? 'Custom' : '自定义';
  modelSelect.appendChild(customOption);
}

function _setResolvedModelValue(moduleId, provider, model) {
  const { modelSelect, modelInput } = _getModelControlElements(moduleId);
  const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  let optionModels;
  if (_isBuiltinProviderForSettings(normalizedProvider)) {
    optionModels = BUILTIN_PROVIDER_MODEL_OPTIONS[normalizedProvider] || [];
  } else {
    const cp = _getCustomProviderByIdForSettings(normalizedProvider);
    optionModels = cp?.defaultModel ? [cp.defaultModel] : [];
  }

  if (modelSelect && optionModels.includes(normalizedModel)) {
    modelSelect.value = normalizedModel;
    if (modelInput) {
      modelInput.value = '';
    }
    _toggleCustomModelInput(moduleId, false);
    _syncDesignModelWarning(moduleId, normalizedProvider, normalizedModel);
    return;
  }

  if (modelSelect) {
    modelSelect.value = CUSTOM_MODEL_OPTION_VALUE;
  }
  if (modelInput) {
    modelInput.value = normalizedModel;
  }
  _toggleCustomModelInput(moduleId, true);
  _syncDesignModelWarning(moduleId, normalizedProvider, normalizedModel);
}

// 世界卡选了不稳定模型时显示警示。检测条件：provider 或 model id 含 'doubao'
function _syncDesignModelWarning(moduleId, provider, model) {
  if (moduleId !== 'design') return;
  const warningEl = document.getElementById('design-model-warning');
  if (!warningEl) return;
  const haystack = `${provider || ''} ${model || ''}`.toLowerCase();
  const shouldWarn = haystack.includes('doubao');
  warningEl.classList.toggle('is-hidden', !shouldWarn);
  warningEl.setAttribute('aria-hidden', shouldWarn ? 'false' : 'true');
}

function _syncModelControlForProvider(moduleId, provider, model) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
  _populateModelSelectByProvider(moduleId, normalizedProvider);
  const hasExplicitModel = typeof model === 'string';
  const normalizedModel = hasExplicitModel ? model.trim() : '';
  const fallbackModel = _getProviderDefaultModel(moduleId, normalizedProvider);
  const nextModel = hasExplicitModel ? normalizedModel : fallbackModel || '';
  _setResolvedModelValue(moduleId, normalizedProvider, nextModel);
  _syncThinkingControlVisibility(moduleId, normalizedProvider);
}

function _getThinkingTabsContainer(moduleId) {
  return document.querySelector(`[data-thinking-tabs="${moduleId}"]`);
}

function _normalizeThinkingForUI(rawValue) {
  const value = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : '';
  return DEEPSEEK_THINKING_LEVELS.includes(value) ? value : DEEPSEEK_THINKING_DEFAULT;
}

function _syncThinkingControlVisibility(moduleId, provider) {
  const wrapper = document.querySelector(`[data-thinking-wrapper="${moduleId}"]`);
  if (!wrapper) return;
  const isDeepseek = (typeof provider === 'string' ? provider.trim() : '') === 'deepseek';
  wrapper.classList.toggle('is-hidden', !isDeepseek);
  wrapper.setAttribute('aria-hidden', isDeepseek ? 'false' : 'true');
}

function _setThinkingControlValue(moduleId, rawValue) {
  const container = _getThinkingTabsContainer(moduleId);
  if (!container) return;
  const normalized = _normalizeThinkingForUI(rawValue);
  container.querySelectorAll('.tab').forEach(btn => {
    const isActive = btn.dataset.thinkingValue === normalized;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  const hint = document.querySelector(`[data-thinking-hint="${moduleId}"]`);
  if (hint) {
    const showHint = normalized === 'high' || normalized === 'max';
    hint.classList.toggle('is-hidden', !showHint);
    if (!showHint) {
      const helpPanel = document.getElementById(`thinking-help-${moduleId}`);
      if (helpPanel?.classList.contains('expanded')) {
        helpPanel.classList.remove('expanded');
        helpPanel.setAttribute('aria-hidden', 'true');
      }
      const helpBtn = hint.querySelector('[data-action~="section-help-btn"]');
      helpBtn?.classList.remove('is-active');
    }
  }
}

function _getThinkingControlValue(moduleId) {
  const container = _getThinkingTabsContainer(moduleId);
  if (!container) return DEEPSEEK_THINKING_DEFAULT;
  const active = container.querySelector('.tab.is-active');
  return _normalizeThinkingForUI(active?.dataset?.thinkingValue);
}

function _bindThinkingTabsEvents(moduleId) {
  const container = _getThinkingTabsContainer(moduleId);
  if (!container) return;
  const bindKey = `thinking-tabs-${moduleId}`;
  if (boundEventListeners.has(bindKey)) return;
  container.addEventListener('click', evt => {
    const btn = evt.target.closest('.tab');
    if (!btn || !container.contains(btn)) return;
    const value = btn.dataset.thinkingValue;
    if (!value) return;
    _setThinkingControlValue(moduleId, value);
  });
  boundEventListeners.add(bindKey);
}

function _bindModelControlEvents(moduleId) {
  const { modelSelect, modelInput } = _getModelControlElements(moduleId);
  if (modelSelect) {
    const selectKey = `model-select-${moduleId}`;
    if (!boundEventListeners.has(selectKey)) {
      modelSelect.addEventListener('change', () => {
        const provider =
          document.getElementById(`module-provider-${moduleId}`)?.value ||
          _getDefaultProviderForUIModule(moduleId);
        _setResolvedModelValue(moduleId, provider, _getResolvedModelValue(moduleId));
        updatePriceForModel(moduleId);
      });
      boundEventListeners.add(selectKey);
    }
  }

  if (modelInput) {
    const inputKey = `model-input-${moduleId}`;
    if (!boundEventListeners.has(inputKey)) {
      modelInput.addEventListener('change', () => {
        updatePriceForModel(moduleId);
        if (moduleId === 'design') {
          const provider =
            document.getElementById(`module-provider-${moduleId}`)?.value ||
            _getDefaultProviderForUIModule(moduleId);
          _syncDesignModelWarning(moduleId, provider, modelInput.value);
        }
      });
      // 用 input 事件让用户边输入边能看到警示同步出现/消失（无需失焦）
      if (moduleId === 'design') {
        modelInput.addEventListener('input', () => {
          const provider =
            document.getElementById(`module-provider-${moduleId}`)?.value ||
            _getDefaultProviderForUIModule(moduleId);
          _syncDesignModelWarning(moduleId, provider, modelInput.value);
        });
      }
      boundEventListeners.add(inputKey);
    }
  }
}

function _getConfigModuleIdByUI(uiModuleId) {
  if (uiModuleId === 'game') return 'react';
  return uiModuleId === 'summary-chapter' ? 'summary' : uiModuleId;
}

function _getConfigModuleIdsByUI(uiModuleId) {
  if (uiModuleId === 'game') return ['react', 'sms', 'summary', 'chapter', 'design'];
  if (uiModuleId === 'summary-chapter') return ['summary', 'chapter'];
  return [uiModuleId];
}

function _getDefaultTemperatureForUIModule(uiModuleId, providerId) {
  return 1.0;
}

function _normalizeTemperatureForUI(rawValue, defaultValue) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return { value: defaultValue, adjusted: true };
  }
  const clamped = Math.min(MODULE_TEMPERATURE_MAX, Math.max(MODULE_TEMPERATURE_MIN, parsed));
  return { value: clamped, adjusted: clamped !== parsed };
}

// 读取 module-temp-* input 当前值，clamp 到合法范围（防止玩家输入越界未保存就被读取发上游）
function _readModuleTemperatureClamped(uiModuleId, fallback = '1.0') {
  const el = document.getElementById(`module-temp-${uiModuleId}`);
  const raw = el?.value;
  if (raw === '' || raw === null || raw === undefined) return String(fallback);
  const { value } = _normalizeTemperatureForUI(raw, Number(fallback) || 1.0);
  return String(value);
}

function _buildPriceKey(provider, model) {
  const normalizedProvider = typeof provider === 'string' ? provider.trim() : '';
  const normalizedModel = typeof model === 'string' ? model.trim() : '';
  if (!normalizedProvider || !normalizedModel) return '';
  return `${normalizedProvider}::${normalizedModel}`;
}

function _getConfigModelPrices(configOrDraft = null) {
  const config = configOrDraft || aiService.getConfig();
  const modelPrices = config?.modelPrices;
  if (!modelPrices || typeof modelPrices !== 'object' || Array.isArray(modelPrices)) {
    return {};
  }
  return modelPrices;
}

function _normalizePriceNumber(value, options = {}) {
  const { allowEmptyString = false } = options;
  if (typeof value === 'string' && value.trim() === '') {
    return allowEmptyString ? 0 : null;
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  if (num > MODULE_PRICE_MAX) return null;
  return num;
}

function _formatPriceForDisplay(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return '-';
  return num.toFixed(6).replace(/\.?0+$/, '');
}

// 预置价中如果带 promo 字段且未过期，返回 promo 价；否则返回原价。
// 用户自定义价（modelPrices）走另一条分支，不受 promo 影响。
function _resolvePresetPrice(presetPrice) {
  if (!presetPrice || typeof presetPrice !== 'object') return null;
  const promo = presetPrice.promo;
  if (promo && typeof promo === 'object' && typeof promo.until === 'string') {
    const promoUntil = Date.parse(promo.until);
    if (Number.isFinite(promoUntil) && Date.now() < promoUntil) {
      const promoIn = _normalizePriceNumber(promo.in);
      const promoOut = _normalizePriceNumber(promo.out);
      if (promoIn !== null && promoOut !== null) {
        return { in: promoIn, out: promoOut };
      }
    }
  }
  const presetIn = _normalizePriceNumber(presetPrice.in);
  const presetOut = _normalizePriceNumber(presetPrice.out);
  if (presetIn !== null && presetOut !== null) {
    return { in: presetIn, out: presetOut };
  }
  return null;
}

function _getPriceFromMap(provider, model, configOrDraft = null) {
  const priceKey = _buildPriceKey(provider, model);
  if (!priceKey) return null;

  const modelPrices = _getConfigModelPrices(configOrDraft);
  const customPrice = modelPrices[priceKey];
  const customIn = _normalizePriceNumber(customPrice?.in);
  const customOut = _normalizePriceNumber(customPrice?.out);
  if (customIn !== null && customOut !== null) {
    return { in: customIn, out: customOut };
  }

  return _resolvePresetPrice(MODEL_PRICES[priceKey]);
}

function _setPriceToMap(provider, model, inPrice, outPrice, options = {}) {
  const priceKey = _buildPriceKey(provider, model);
  const normalizedIn = _normalizePriceNumber(inPrice);
  const normalizedOut = _normalizePriceNumber(outPrice);
  if (!priceKey || normalizedIn === null || normalizedOut === null) {
    return false;
  }

  const currentConfig = aiService.getConfig() || {};
  const currentModules =
    currentConfig.modules && typeof currentConfig.modules === 'object' ? currentConfig.modules : {};
  const nextModules = {};
  Object.entries(currentModules).forEach(([moduleId, moduleConfig]) => {
    if (!moduleConfig || typeof moduleConfig !== 'object') {
      nextModules[moduleId] = moduleConfig;
      return;
    }
    const moduleProvider =
      typeof moduleConfig.provider === 'string' ? moduleConfig.provider.trim() : '';
    const moduleModel = typeof moduleConfig.model === 'string' ? moduleConfig.model.trim() : '';
    const modulePriceKey = _buildPriceKey(moduleProvider, moduleModel);
    if (modulePriceKey === priceKey) {
      nextModules[moduleId] = {
        ...moduleConfig,
        priceIn: normalizedIn,
        priceOut: normalizedOut,
      };
      return;
    }
    nextModules[moduleId] = { ...moduleConfig };
  });

  // 行内保存：当前行对应模块立即同步到配置（包含 provider/model）
  const targetModuleId = typeof options.moduleId === 'string' ? options.moduleId : '';
  if (targetModuleId) {
    if (targetModuleId === 'game') {
      _getConfigModuleIdsByUI(targetModuleId).forEach(configModuleId => {
        const moduleConfig = nextModules[configModuleId];
        if (!moduleConfig || typeof moduleConfig !== 'object') return;
        nextModules[configModuleId] = {
          ...moduleConfig,
          provider,
          model,
          priceIn: normalizedIn,
          priceOut: normalizedOut,
        };
      });
    } else {
      const configModuleIds =
        targetModuleId === 'summary-chapter' ? ['summary', 'chapter'] : [targetModuleId];
      configModuleIds.forEach(configModuleId => {
        const moduleConfig = nextModules[configModuleId];
        if (!moduleConfig || typeof moduleConfig !== 'object') return;
        nextModules[configModuleId] = {
          ...moduleConfig,
          provider,
          model,
          priceIn: normalizedIn,
          priceOut: normalizedOut,
        };
      });
    }
  }

  const nextModelPrices = {
    ..._getConfigModelPrices(currentConfig),
    [priceKey]: { in: normalizedIn, out: normalizedOut },
  };
  aiService.saveConfig({ modelPrices: nextModelPrices, modules: nextModules });
  return true;
}

function _getPriceRowByModuleId(moduleId) {
  return document.querySelector(`#settings-modal .module-price-row[data-module-id="${moduleId}"]`);
}

function _getProviderModelByModuleId(moduleId) {
  const providerSelect = document.getElementById(`module-provider-${moduleId}`);
  return {
    provider: providerSelect?.value?.trim() || '',
    model: _getResolvedModelValue(moduleId),
  };
}

function _saveModuleProviderModelByModuleId(moduleId) {
  const copy = _getSettingsCopy();
  const { provider, model } = _getProviderModelByModuleId(moduleId);
  if (!provider || !model) {
    showToast(copy.functionEditor.toast.chooseProviderAndModel, 'error');
    return false;
  }

  const currentConfig = aiService.getConfig() || {};
  const currentModules =
    currentConfig.modules && typeof currentConfig.modules === 'object' ? currentConfig.modules : {};
  const nextModules = {};

  Object.entries(currentModules).forEach(([configModuleId, moduleConfig]) => {
    if (!moduleConfig || typeof moduleConfig !== 'object') {
      nextModules[configModuleId] = moduleConfig;
      return;
    }
    nextModules[configModuleId] = { ...moduleConfig };
  });

  const configModuleIds = _getConfigModuleIdsByUI(moduleId);
  const thinking = _getThinkingControlValue(moduleId);
  configModuleIds.forEach(configModuleId => {
    const fallbackModuleConfig =
      typeof aiService.getModuleConfig === 'function'
        ? aiService.getModuleConfig(configModuleId)
        : {};
    const currentModuleConfig = nextModules[configModuleId];
    const baseModuleConfig =
      currentModuleConfig &&
      typeof currentModuleConfig === 'object' &&
      !Array.isArray(currentModuleConfig)
        ? currentModuleConfig
        : fallbackModuleConfig &&
            typeof fallbackModuleConfig === 'object' &&
            !Array.isArray(fallbackModuleConfig)
          ? fallbackModuleConfig
          : {};
    nextModules[configModuleId] = {
      ...baseModuleConfig,
      provider,
      model,
      thinking,
    };
  });

  aiService.saveConfig({ modules: nextModules });
  _refreshAllModulePriceDisplays();
  showToast(copy.functionEditor.toast.stepModelSaved);
  return true;
}

function _fillPriceEditorFromRow(row, prices) {
  if (!row) return;
  const inputIn = row.querySelector('.module-price-edit-in');
  const inputOut = row.querySelector('.module-price-edit-out');
  if (inputIn) inputIn.value = prices ? _formatPriceForDisplay(prices.in) : '';
  if (inputOut) inputOut.value = prices ? _formatPriceForDisplay(prices.out) : '';
}

function _refreshAllModulePriceDisplays() {
  updatePriceForModel('game');
  UI_MODULES.forEach(uiModuleId => updatePriceForModel(uiModuleId));
}

function _resetPriceRowEditingState(row) {
  if (!row) return;
  row.classList.remove('is-editing');
  row.setAttribute('aria-expanded', 'false');
  const editor = row.querySelector('.module-price-editor');
  if (editor) editor.setAttribute('aria-hidden', 'true');
}

function _resetAllPriceRowEditingStates() {
  document.querySelectorAll('#settings-modal .module-price-row').forEach(row => {
    _resetPriceRowEditingState(row);
  });
}

function _savePriceFromRow(moduleId, row) {
  const copy = _getSettingsCopy();
  if (!row || !row.classList.contains('is-editing')) {
    showToast(copy.functionEditor.toast.editPriceFirst);
    return;
  }

  const { provider, model } = _getProviderModelByModuleId(moduleId);
  if (!provider || !model) {
    showToast(copy.functionEditor.toast.chooseProviderAndModel, 'error');
    return;
  }

  const inputIn = row.querySelector('.module-price-edit-in');
  const inputOut = row.querySelector('.module-price-edit-out');
  const rawIn = inputIn?.value?.trim() || '';
  const rawOut = inputOut?.value?.trim() || '';
  const inPrice = _normalizePriceNumber(rawIn);
  const outPrice = _normalizePriceNumber(rawOut);

  if (inPrice === null || outPrice === null) {
    showToast(copy.functionEditor.toast.invalidPrice(MODULE_PRICE_MAX), 'error');
    return;
  }

  const saved = _setPriceToMap(provider, model, inPrice, outPrice, { moduleId });
  if (!saved) {
    showToast(copy.functionEditor.toast.priceSaveFailed, 'error');
    return;
  }

  _resetPriceRowEditingState(row);
  _refreshAllModulePriceDisplays();
  showToast(copy.functionEditor.toast.priceSaved);
}

function _bindPriceRowEvents(moduleId) {
  const row = _getPriceRowByModuleId(moduleId);
  if (!row || row.dataset.bound === 'true') return;
  const copy = _getSettingsCopy();

  const editBtn = row.querySelector('[data-action~="module-price-edit-btn"]');
  const saveBtn = row.querySelector('[data-action~="module-price-save-btn"]');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      const { provider, model } = _getProviderModelByModuleId(moduleId);
      if (!provider || !model) {
        showToast(copy.functionEditor.toast.chooseProviderAndModel, 'error');
        return;
      }

      const prices = _getPriceFromMap(provider, model);
      row.classList.add('is-editing');
      row.setAttribute('aria-expanded', 'true');
      const editor = row.querySelector('.module-price-editor');
      if (editor) editor.setAttribute('aria-hidden', 'false');
      _fillPriceEditorFromRow(row, prices);
      const inputIn = row.querySelector('.module-price-edit-in');
      if (inputIn) inputIn.focus();
    });
  }
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (row.classList.contains('is-editing')) {
        _savePriceFromRow(moduleId, row);
        return;
      }
      _saveModuleProviderModelByModuleId(moduleId);
    });
  }
  row.querySelectorAll('.module-price-edit-input').forEach(input => {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        _savePriceFromRow(moduleId, row);
      } else if (event.key === 'Escape') {
        _resetPriceRowEditingState(row);
      }
    });
  });

  row.dataset.bound = 'true';
}

function _captureDraftProviderApiKeysFromUI() {
  const next = { ...(_getCurrentProviderApiKeysForSettings() || {}) };

  PROVIDERS.forEach(id => {
    const input = document.getElementById(`api-key-${id}`);
    if (!input) return;
    const value = _getApiKeyRealValue(input);
    if (value) next[id] = value;
    else delete next[id];
  });

  const container = document.getElementById('custom-providers-container');
  if (container) {
    container.querySelectorAll('.custom-provider-row').forEach(row => {
      const id = row.dataset.id;
      if (!id) return;
      const cpInput = row.querySelector('.cp-apikey');
      const value = cpInput ? _getApiKeyRealValue(cpInput) : '';
      if (value) next[id] = value;
      else delete next[id];
    });
  }

  settingsDraftProviderApiKeys = next;
}

function _captureDraftCustomProvidersFromUI() {
  const container = document.getElementById('custom-providers-container');
  if (!container) return;

  const next = [];
  container.querySelectorAll('.custom-provider-row').forEach(row => {
    const id = row.dataset.id;
    const name = row.querySelector('.cp-name')?.value?.trim() || '';
    if (!id || !name) return;
    const protocol =
      row.querySelector('.cp-protocol')?.value === 'anthropic' ? 'anthropic' : 'openai';
    // maxOutputTokens 字段也要捕获，否则点"+添加服务商"等触发 capture 的操作会让该字段被默认值覆盖
    const maxOutputTokensEnabled = !!row.querySelector('.cp-maxtokens-enabled')?.checked;
    const rawMaxOutputTokens = row.querySelector('.cp-maxtokens-value')?.value?.trim();
    const parsedMaxOutputTokens = parseInt(rawMaxOutputTokens, 10);
    const maxOutputTokens =
      Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
        ? parsedMaxOutputTokens
        : null;
    next.push({
      id,
      name,
      baseUrl: row.querySelector('.cp-baseurl')?.value?.trim() || '',
      defaultModel: row.querySelector('.cp-model')?.value?.trim() || '',
      protocol,
      maxOutputTokensEnabled,
      maxOutputTokens,
    });
  });
  settingsDraftCustomProviders = next;

  const validCustomIds = new Set(next.map(item => item.id));
  const apiKeys = { ...(_getCurrentProviderApiKeysForSettings() || {}) };
  Object.keys(apiKeys).forEach(key => {
    if (!PROVIDERS.includes(key) && !validCustomIds.has(key)) {
      delete apiKeys[key];
    }
  });
  settingsDraftProviderApiKeys = apiKeys;
}

function _alignModuleProviderModelSelections() {
  const allProviderIds = _getAllProviderIds();
  if (!allProviderIds.length) return;

  UI_MODULES_WITH_UNIFIED.forEach(uiModuleId => {
    const providerSelect = document.getElementById(`module-provider-${uiModuleId}`);
    if (!providerSelect) return;

    let provider = providerSelect.value;
    let providerChanged = false;
    const moduleDefaultProvider = _getDefaultProviderForUIModule(uiModuleId);
    const fallbackProvider = allProviderIds.includes(moduleDefaultProvider)
      ? moduleDefaultProvider
      : allProviderIds.includes('gemini')
        ? 'gemini'
        : allProviderIds[0];

    if (!allProviderIds.includes(provider)) {
      provider = fallbackProvider;
      providerSelect.value = provider;
      providerChanged = true;
    }

    const currentModel = _getResolvedModelValue(uiModuleId);
    const { modelSelect } = _getModelControlElements(uiModuleId);
    const isCustomModel = modelSelect?.value === CUSTOM_MODEL_OPTION_VALUE;
    const nextModel = providerChanged
      ? _getProviderDefaultModel(uiModuleId, provider)
      : currentModel || (isCustomModel ? '' : _getProviderDefaultModel(uiModuleId, provider));
    _syncModelControlForProvider(uiModuleId, provider, nextModel);
    updatePriceForModel(uiModuleId);
  });
}

// ============================================
// Step Input Parts 定义 (框架预览用)
// ============================================

const REACT_PARTS = [
  {
    name: 'systemContext',
    label: '剧情总结 + 角色档案',
    type: 'dynamic',
    condition: '始终',
    hint: '运行时由系统自动生成：包含之前剧情的总结和当前角色档案',
  },
  {
    name: 'conversationHistory',
    label: '对话历史',
    type: 'dynamic',
    condition: '始终',
    hint: '运行时由系统自动生成：序列化的近期对话记录',
  },
  {
    name: 'CORE_PROMPT_MERGED',
    label: '核心指令（ReAct）',
    type: 'fixed',
    getContent: () => (typeof CORE_PROMPT_MERGED !== 'undefined' ? CORE_PROMPT_MERGED : ''),
  },
  {
    name: 'Function Declarations',
    label: '工具列表',
    type: 'configurable',
    condition: '始终',
    getContent: () => {
      // 从 DOM 实时读取当前编辑状态
      const cards = document.querySelectorAll('#react-fn-list .fn-card:not(.fn-card-deleted)');
      if (!cards.length) {
        // fallback: 面板未渲染时从 service 读取
        if (typeof aiService === 'undefined') return '';
        try {
          const fns = aiService._getFunctionDeclarations();
          return fns.map(fn => `${fn.name}\n  ${fn.description || ''}`).join('\n');
        } catch {
          return '';
        }
      }
      const lines = [];
      cards.forEach(card => {
        // 跳过被整体禁用的组内卡片
        if (card.closest('.fn-group-disabled')) return;
        // 跳过非 callable 卡片（如 core_world_mechanics 常驻注入卡）
        if (card.dataset.nonCallable === 'true') return;
        const name = card.querySelector('.fn-name-input')?.value?.trim() || '';
        const desc = card.querySelector('.fn-desc-textarea')?.value?.trim() || '';
        if (name) lines.push(`${name}\n  ${desc}`);
      });
      return lines.join('\n\n');
    },
  },
  {
    name: 'Trigger Message',
    label: '触发消息',
    type: 'fixed',
    getContent: () => '现在分析玩家意图并调用所需工具。',
  },
];

const STEP_PREVIEW_MAP = {
  react: { parts: REACT_PARTS, listId: 'react-preview-list', badgeId: 'react-preview-badge' },
};

function _getSettingsPreviewPartCopy(partDef) {
  const isEnglish = _getSettingsLocale() === 'en';
  const partName = partDef?.name || '';
  const labelMap = {
    systemContext: isEnglish ? 'Story Summary + Character Profile' : '剧情总结 + 角色档案',
    conversationHistory: isEnglish ? 'Conversation History' : '对话历史',
    CORE_PROMPT_MERGED: isEnglish ? 'Core Prompt (ReAct)' : '核心指令（ReAct）',
    'Function Declarations': isEnglish ? 'Tool List' : '工具列表',
    'Trigger Message': isEnglish ? 'Trigger Message' : '触发消息',
  };
  const hintMap = {
    systemContext: isEnglish
      ? 'Injected automatically at runtime: summary of earlier story progress and the current character profile.'
      : '运行时由系统自动生成：包含之前剧情的总结和当前角色档案',
    conversationHistory: isEnglish
      ? 'Injected automatically at runtime: serialized recent conversation history.'
      : '运行时由系统自动生成：序列化的近期对话记录',
  };
  const conditionMap = {
    systemContext: isEnglish ? 'Always' : '始终',
    conversationHistory: isEnglish ? 'Always' : '始终',
    'Function Declarations': isEnglish ? 'Always' : '始终',
    'Trigger Message': isEnglish ? 'Fixed' : '固定',
  };
  return {
    label: labelMap[partName] || partDef.label || partName,
    hint: hintMap[partName] || partDef.hint || '',
    condition: conditionMap[partName] || partDef.condition || '',
    groupTitle: isEnglish ? 'System Prompts' : '系统提示词',
    emptyContent: isEnglish ? '(Empty)' : '(空)',
    dynamicHint: isEnglish ? 'Generated automatically at runtime' : '运行时由系统自动生成',
    tagText: {
      dynamic: isEnglish ? 'Dynamic' : '动态',
      configurable: isEnglish ? 'Configurable' : '可配置',
      fixed: isEnglish ? 'Fixed' : '固定',
    },
  };
}

/**
 * 渲染所有 Step 的 Input Parts 预览（分组折叠）
 */
function populateStepPreviews() {
  for (const [, config] of Object.entries(STEP_PREVIEW_MAP)) {
    const listEl = document.getElementById(config.listId);
    const badgeEl = document.getElementById(config.badgeId);
    if (!listEl) continue;

    listEl.innerHTML = '';

    // 按 type 分组: configurable vs system(其余)
    const configurableParts = config.parts.filter(p => p.type === 'configurable');
    const systemParts = config.parts.filter(p => p.type !== 'configurable');

    // 可配置项直接显示（不套折叠组）
    configurableParts.forEach(partDef => {
      const card = _createPartCard(partDef);
      card.classList.add('expanded');
      listEl.appendChild(card);
    });

    // 系统提示词组（默认收起）
    if (systemParts.length > 0) {
      listEl.appendChild(
        _createPartGroup(
          _getSettingsPreviewPartCopy(systemParts[0]).groupTitle,
          'system',
          systemParts,
          false
        )
      );
    }

    if (badgeEl) badgeEl.textContent = `${config.parts.length} parts`;
  }
}

function _createDisclosureChevron(className) {
  const chevron = document.createElement('span');
  chevron.className = `${className} material-symbols-outlined`;
  chevron.textContent = 'chevron_right';
  chevron.setAttribute('aria-hidden', 'true');
  return chevron;
}

/**
 * 创建折叠分组容器
 */
function _createPartGroup(title, groupType, parts, defaultExpanded) {
  const group = document.createElement('div');
  group.className = 'preview-group' + (defaultExpanded ? ' expanded' : '');
  group.setAttribute('data-group', groupType);

  // 组头
  const header = document.createElement('div');
  header.className = 'preview-group-header';

  const chevron = _createDisclosureChevron('preview-group-chevron');

  const titleEl = document.createElement('span');
  titleEl.className = 'preview-group-title';
  titleEl.textContent = title;

  const badge = document.createElement('span');
  badge.className = 'preview-group-badge';
  badge.textContent = `${parts.length}`;

  header.appendChild(chevron);
  header.appendChild(titleEl);
  header.appendChild(badge);
  header.addEventListener('click', () => group.classList.toggle('expanded'));
  group.appendChild(header);

  // 组体
  const body = document.createElement('div');
  body.className = 'preview-group-body';
  parts.forEach(partDef => {
    body.appendChild(_createPartCard(partDef));
  });
  group.appendChild(body);

  return group;
}

/**
 * Debounce 工具函数
 */
function _debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/**
 * 刷新指定 step + part 的预览卡片内容和 size badge
 */
function _refreshPreviewPartCard(stepKey, partName) {
  const config = STEP_PREVIEW_MAP[stepKey];
  if (!config) return;
  const listEl = document.getElementById(config.listId);
  if (!listEl) return;

  const partDef = config.parts.find(p => p.name === partName);
  if (!partDef || typeof partDef.getContent !== 'function') return;
  const copy = _getSettingsPreviewPartCopy(partDef);

  const card = listEl.querySelector(`.preview-part-card[data-name="${partDef.name}"]`);
  if (!card) return;

  const content = partDef.getContent();

  // 更新 body 内容
  const contentEl = card.querySelector('.preview-part-content');
  if (contentEl) contentEl.textContent = content || copy.emptyContent;

  // 更新 size badge（找到或创建）
  let sizeEl = card.querySelector('.preview-part-size');
  if (content) {
    const sizeText =
      content.length >= 1000 ? `${(content.length / 1000).toFixed(1)}k` : `${content.length}`;
    if (sizeEl) {
      sizeEl.textContent = sizeText;
    } else {
      sizeEl = document.createElement('span');
      sizeEl.className = 'preview-part-size';
      sizeEl.textContent = sizeText;
      card.querySelector('.preview-part-meta')?.appendChild(sizeEl);
    }
  } else if (sizeEl) {
    sizeEl.remove();
  }
}

/**
 * 刷新指定 step 的可配置卡片内容和 size badge
 */
function _refreshConfigurableCard(stepKey) {
  const config = STEP_PREVIEW_MAP[stepKey];
  if (!config) return;
  const partDef = config.parts.find(p => p.type === 'configurable');
  if (!partDef) return;
  _refreshPreviewPartCard(stepKey, partDef.name);
}

/**
 * 创建单个 Part 预览卡片
 */
function _createPartCard(partDef) {
  const copy = _getSettingsPreviewPartCopy(partDef);
  const card = document.createElement('div');
  card.className = 'preview-part-card';
  card.setAttribute('data-type', partDef.type);
  card.setAttribute('data-name', partDef.name);

  // Header
  const header = document.createElement('div');
  header.className = 'preview-part-header';

  const chevron = _createDisclosureChevron('preview-part-chevron');

  const label = document.createElement('span');
  label.className = 'preview-part-label';
  label.textContent = copy.label;

  const meta = document.createElement('span');
  meta.className = 'preview-part-meta';

  const tag = document.createElement('span');
  const tagClass =
    { dynamic: 'tag-dynamic', configurable: 'tag-configurable', fixed: 'tag-fixed' }[
      partDef.type
    ] || 'tag-fixed';
  const tagText = copy.tagText[partDef.type] || partDef.type;
  tag.className = `preview-part-tag ${tagClass}`;
  tag.textContent = tagText;
  meta.appendChild(tag);

  // Size badge for content-bearing parts
  if (partDef.getContent) {
    const content = partDef.getContent();
    if (content) {
      const size = document.createElement('span');
      size.className = 'preview-part-size';
      size.textContent =
        content.length >= 1000 ? `${(content.length / 1000).toFixed(1)}k` : `${content.length}`;
      meta.appendChild(size);
    }
  }

  header.appendChild(chevron);
  header.appendChild(label);
  header.appendChild(meta);

  header.addEventListener('click', () => card.classList.toggle('expanded'));
  card.appendChild(header);

  // Condition line
  if (partDef.condition) {
    const condLine = document.createElement('div');
    condLine.className = 'preview-part-condition';
    condLine.textContent = copy.condition;
    card.appendChild(condLine);
  }

  // Body
  const body = document.createElement('div');
  body.className = 'preview-part-body';

  const contentDiv = document.createElement('div');
  contentDiv.className = 'preview-part-content';

  if (partDef.getContent) {
    const text = partDef.getContent();
    contentDiv.textContent = text || copy.emptyContent;
  } else {
    contentDiv.className += ' dynamic-hint';
    contentDiv.textContent = copy.hint || copy.dynamicHint;
  }

  body.appendChild(contentDiv);
  card.appendChild(body);

  return card;
}

/**
 * 导出 design_config 模板（Markdown）
 */
function triggerDesignConfigTemplateExport() {
  const markdown = _generateDesignConfigTemplate();
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `design_config_template_${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
window.triggerDesignConfigTemplateExport = triggerDesignConfigTemplateExport;

/**
 * 生成 design_config 模板文档
 * @returns {string} Markdown 文档字符串
 */
function _generateDesignConfigTemplate() {
  const date = new Date().toISOString().slice(0, 10);
  const designConfigExample = {
    world_setting: {
      settings: {
        region_name:
          '# 区域名称\n\n### 基础信息\n地理位置、气候环境...\n\n### 历史背景\n该区域的起源、重要历史事件...\n\n### 社会结构\n统治体系、社会阶层...\n\n### 当前局势\n现状、矛盾冲突...',
      },
    },
    timeline: {
      events: [
        {
          time: 'Year 1, Day 1',
          location: '某城市',
          characters: '角色A / 角色B',
          content: '事件的详细叙述...',
        },
      ],
    },
    character_database: {
      REGION_001_Name: {
        id: 'REGION_001_Name',
        name: '角色名',
        age: '25',
        gender: '性别',
        occupation: '职业',
        background: '背景故事...',
      },
    },
    prompt_modules: {
      modules: {
        init: '# 初始化模块\n开场引导、世界观介绍、角色创建流程...',
        economy: '# 经济系统\n货币单位、物价规则、交易规范...',
      },
      _summary: '规则模块说明',
    },
  };
  const jsonExample = JSON.stringify(designConfigExample, null, 2);

  if (typeof window.generateWorldGuide !== 'function') {
    console.error(
      'generateWorldGuide function not found. Please ensure prompts/[Fixed]template.js is loaded.'
    );
    return 'Error: Template generator missing.';
  }

  return window.generateWorldGuide({
    date,
    jsonExample,
  });
}

/**
 * 根据模型名称更新价格输入框
 */
function updatePriceForModel(moduleId) {
  const providerSelect = document.getElementById(`module-provider-${moduleId}`);
  const priceInSpan = document.getElementById(`module-price-in-${moduleId}`);
  const priceOutSpan = document.getElementById(`module-price-out-${moduleId}`);
  const row = _getPriceRowByModuleId(moduleId);

  if (providerSelect && priceInSpan && priceOutSpan) {
    const provider = providerSelect.value.trim();
    const model = _getResolvedModelValue(moduleId);
    const prices = _getPriceFromMap(provider, model);
    if (prices) {
      priceInSpan.textContent = _formatPriceForDisplay(prices.in);
      priceOutSpan.textContent = _formatPriceForDisplay(prices.out);
    } else {
      priceInSpan.textContent = '-';
      priceOutSpan.textContent = '-';
    }

    if (row && !row.classList.contains('is-editing')) {
      _fillPriceEditorFromRow(row, prices);
    }
  }
}

/**
 * 当服务商变化时更新模型输入框的值
 */
function updateModelForProvider(moduleId) {
  const providerSelect = document.getElementById(`module-provider-${moduleId}`);
  if (providerSelect) {
    const provider = providerSelect.value;
    const defaultModel = _getProviderDefaultModel(moduleId, provider);
    _syncModelControlForProvider(moduleId, provider, defaultModel);
    updatePriceForModel(moduleId);
  }
}

// ========================================
// 动态 Provider 渲染函数
// ========================================

/**
 * 获取所有 provider ID（内置 + 自定义）
 */
function _getAllProviderIds() {
  const customProviders = _getCurrentCustomProvidersForSettings();
  return [...PROVIDERS, ...customProviders.map(p => p.id)];
}

/**
 * 获取 provider 显示名称
 */
function _getProviderDisplayName(id) {
  const isEnglish = _getSettingsLocale() === 'en';
  const builtinNames = {
    gemini: isEnglish ? 'Official Gemini' : '【官方】Gemini',
    deepseek: 'DeepSeek',
    openai: isEnglish ? 'Official OpenAI' : '【官方】OpenAI',
    grok: isEnglish ? 'Official Grok' : '【官方】Grok',
    anthropic: isEnglish ? 'Official Anthropic' : '【官方】Anthropic',
    siliconflow: 'SiliconFlow (CN)',
  };
  if (builtinNames[id]) return builtinNames[id];
  const cp = _getCustomProviderByIdForSettings(id);
  return cp?.name || id;
}

/**
 * 动态填充所有模块的 Provider <select> 选项
 */
function _populateProviderSelects() {
  const allIds = _getAllProviderIds();
  // 填充各模块的 provider select
  UI_MODULES.forEach(uiModuleId => {
    const select = document.getElementById(`module-provider-${uiModuleId}`);
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '';
    allIds.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = _getProviderDisplayName(id);
      select.appendChild(option);
    });
    // 恢复之前的选中值（如果仍存在）
    if (allIds.includes(currentValue)) {
      select.value = currentValue;
    }
  });
  // 同时填充常规模式两个分组的 provider select
  ['game'].forEach(groupId => {
    const groupSelect = document.getElementById(`module-provider-${groupId}`);
    if (groupSelect) {
      const currentValue = groupSelect.value;
      groupSelect.innerHTML = '';
      allIds.forEach(id => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = _getProviderDisplayName(id);
        groupSelect.appendChild(option);
      });
      if (allIds.includes(currentValue)) {
        groupSelect.value = currentValue;
      }
    }
  });
}

// ============================================
// API Settings Mode Toggle (常规/高级)
// ============================================

function _withStableSettingsAnchor(anchorEl, updateFn) {
  if (typeof updateFn !== 'function') return;

  const settingsBody = document.querySelector('#settings-modal .settings-body');
  if (!settingsBody || !anchorEl || !anchorEl.isConnected) {
    updateFn();
    return;
  }

  const getAnchorTop = () => {
    const bodyRect = settingsBody.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();
    return anchorRect.top - bodyRect.top;
  };

  const beforeTop = getAnchorTop();
  const savedOverflowAnchor = settingsBody.style.overflowAnchor;
  settingsBody.style.overflowAnchor = 'none';

  const restoreAnchor = () => {
    if (!anchorEl.isConnected) return;
    const afterTop = getAnchorTop();
    const delta = afterTop - beforeTop;
    if (Math.abs(delta) > 0.5) {
      settingsBody.scrollTop += delta;
    }
  };

  try {
    updateFn();
    restoreAnchor();
  } finally {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        restoreAnchor();
        settingsBody.style.overflowAnchor = savedOverflowAnchor;
      });
    });
  }
}

/**
 * 切换 API 设置模式。3 个模式对应两个二段 toggle 的组合：
 *   recommended on  → mode='recommended'（advanced toggle 此时被隐藏）
 *   recommended off + advanced on  → mode='advanced'
 *   recommended off + advanced off → mode='simple'
 * @param {'simple'|'advanced'|'recommended'} mode
 */
function _switchApiSettingsMode(mode) {
  // 守门：未绑定 deepseek 官方 key 时不允许进入 recommended。
  // UI 层 aria-disabled 已经阻止点击；这里是兜底防御。
  // init 路径走 getEffectiveApiSettingsMode，已自动降级，不会触发这条。
  if (mode === 'recommended' && !window.aiService?.isRecommendedModeAvailable?.()) {
    return;
  }
  currentApiSettingsMode = mode;
  _applyNarrativeLengthToUI();
  const recommendedPanel = document.getElementById('api-recommended-config');
  const simplePanel = document.getElementById('api-simple-config');
  const advancedPanel = document.getElementById('api-advanced-config');
  const recommendedToggleRow = document.getElementById('api-recommended-mode-toggle');
  const advancedToggleRow = document.getElementById('api-settings-mode-toggle');
  const recommendedToggle = document.getElementById('api-recommended-toggle');
  const advancedToggle = document.getElementById('api-advanced-toggle');

  if (!simplePanel || !advancedPanel || !recommendedPanel) return;

  _withStableSettingsAnchor(recommendedToggleRow, () => {
    // 同步两个 hidden checkbox 的状态 + tab-strip 视觉
    if (recommendedToggle) {
      recommendedToggle.checked = mode === 'recommended';
      _syncToggleTabStripVisualsForCheckbox(recommendedToggle);
    }
    // 进 recommended 时不要触碰 advancedToggle，保留用户原状态。
    // 关推荐时 change handler 会读 advancedToggle 决定回到 simple 还是 advanced。
    if (advancedToggle && mode !== 'recommended') {
      advancedToggle.checked = mode === 'advanced';
      _syncToggleTabStripVisualsForCheckbox(advancedToggle);
    }

    if (mode === 'recommended') {
      // 推荐模式：banner 显示，高级 toggle 行 + simple/advanced 面板全部隐藏
      recommendedPanel.style.display = '';
      if (advancedToggleRow) advancedToggleRow.style.display = 'none';
      simplePanel.style.display = 'none';
      advancedPanel.style.display = 'none';
      simplePanel.classList.remove('disabled');
      return;
    }

    // 非推荐模式：banner 隐藏，高级 toggle 行恢复显示
    recommendedPanel.style.display = 'none';
    if (advancedToggleRow) advancedToggleRow.style.display = '';

    if (mode === 'simple') {
      // 高级 → 常规：从 react 读取值填入"沙盒"面板，从 design 读取值填入"世界卡"面板
      const reactProvider =
        document.getElementById('module-provider-react')?.value ||
        _getDefaultProviderForUIModule('game');
      const reactModel = _getResolvedModelValue('react');
      const reactTemp = document.getElementById('module-temp-react')?.value || '1.0';
      const reactThinking = _getThinkingControlValue('react');
      const gameProviderEl = document.getElementById('module-provider-game');
      const gameTempEl = document.getElementById('module-temp-game');
      if (gameProviderEl) gameProviderEl.value = reactProvider;
      _syncModelControlForProvider('game', reactProvider, reactModel);
      if (gameTempEl) gameTempEl.value = reactTemp;
      _setThinkingControlValue('game', reactThinking);
      _syncThinkingControlVisibility('game', reactProvider);
      updatePriceForModel('game');

      // 同步 streaming toggle
      const advStreamingToggle = document.getElementById('streaming-toggle-adv');
      const simpleStreamingToggle = document.getElementById('streaming-toggle');
      if (advStreamingToggle && simpleStreamingToggle) {
        simpleStreamingToggle.checked = advStreamingToggle.checked;
      }

      simplePanel.classList.remove('disabled');
      simplePanel.style.display = '';
      advancedPanel.style.display = 'none';
    } else {
      // 常规 → 高级：将"标准设置"的值同步到全部模块
      const gameProvider =
        document.getElementById('module-provider-game')?.value ||
        _getDefaultProviderForUIModule('game');
      const gameModel = _getResolvedModelValue('game');
      const gameTemp = document.getElementById('module-temp-game')?.value || '1.0';
      const gameThinking = _getThinkingControlValue('game');

      UI_MODULES.forEach(uiModuleId => {
        const providerSel = document.getElementById(`module-provider-${uiModuleId}`);
        const tempInp = document.getElementById(`module-temp-${uiModuleId}`);
        if (providerSel) providerSel.value = gameProvider;
        _syncModelControlForProvider(uiModuleId, gameProvider, gameModel);
        if (tempInp) tempInp.value = gameTemp;
        _setThinkingControlValue(uiModuleId, gameThinking);
        _syncThinkingControlVisibility(uiModuleId, gameProvider);
        updatePriceForModel(uiModuleId);
      });

      // 同步 streaming toggle
      const simpleStreamingToggle = document.getElementById('streaming-toggle');
      const advStreamingToggle = document.getElementById('streaming-toggle-adv');
      if (simpleStreamingToggle && advStreamingToggle) {
        advStreamingToggle.checked = simpleStreamingToggle.checked;
      }

      simplePanel.classList.add('disabled');
      simplePanel.style.display = '';
      advancedPanel.style.display = '';
    }
  });
}

/**
 * 根据 deepseek 官方 key 是否绑定，刷新「推荐模式」toggle 的可用性。
 * 用 aria-disabled（不是 disabled）以保留 hover tooltip。
 * 整个 tab-strip 容器都标记 aria-disabled，两段按钮都不可点击。
 */
function _refreshRecommendedToggleAvailability() {
  const strip = document.querySelector(
    '.tab-strip[data-toggle-target="api-recommended-toggle"]'
  );
  const row = document.getElementById('api-recommended-mode-toggle');
  if (!strip || !row) return;
  const available = !!window.aiService?.isRecommendedModeAvailable?.();
  strip.setAttribute('aria-disabled', String(!available));
  strip.querySelectorAll('.tab').forEach(t => {
    t.setAttribute('aria-disabled', String(!available));
  });
  const isEn =
    typeof _getSettingsLocale === 'function' && _getSettingsLocale() === 'en';
  const tooltip = available
    ? ''
    : isEn
      ? 'Bind your DeepSeek API key in Account Center to unlock.'
      : '在账户中心绑定 DeepSeek API Key 后可用';
  // tooltip 挂在整行上而非只在按钮上，覆盖范围大、用户更容易触发
  row.title = tooltip;
}

/**
 * 初始化 API 设置模式切换事件
 */
function _initApiSettingsModeToggle() {
  // 推荐模式 toggle：change 事件根据当前 advanced toggle 状态推导新模式
  const recommendedToggle = document.getElementById('api-recommended-toggle');
  if (recommendedToggle && !recommendedToggle.dataset.bound) {
    recommendedToggle.dataset.bound = 'true';
    recommendedToggle.addEventListener('change', () => {
      // 守门：strip 的 aria-disabled 是唯一信息源
      // （由 _refreshRecommendedToggleAvailability + deepseek key blur handler 共同维护）
      const strip = document.querySelector(
        '.tab-strip[data-toggle-target="api-recommended-toggle"]'
      );
      const isLocked = strip?.getAttribute('aria-disabled') === 'true';
      if (recommendedToggle.checked && isLocked) {
        recommendedToggle.checked = false;
        _syncToggleTabStripVisualsForCheckbox(recommendedToggle);
        return;
      }
      if (recommendedToggle.checked) {
        _switchApiSettingsMode('recommended');
      } else {
        // 关掉推荐 → 回到 advanced toggle 决定的模式
        const advToggle = document.getElementById('api-advanced-toggle');
        _switchApiSettingsMode(advToggle?.checked ? 'advanced' : 'simple');
      }
    });
    // 拦截 aria-disabled 状态下的点击（_bindToggleTabStrips 不识别 aria-disabled）
    const strip = document.querySelector(
      '.tab-strip[data-toggle-target="api-recommended-toggle"]'
    );
    if (strip) {
      strip.addEventListener(
        'click',
        e => {
          if (strip.getAttribute('aria-disabled') === 'true') {
            e.stopPropagation();
            e.preventDefault();
          }
        },
        true
      );
    }
  }

  // 高级模式 toggle：change 事件
  const advancedToggle = document.getElementById('api-advanced-toggle');
  if (advancedToggle && !advancedToggle.dataset.bound) {
    advancedToggle.dataset.bound = 'true';
    advancedToggle.addEventListener('change', () => {
      _switchApiSettingsMode(advancedToggle.checked ? 'advanced' : 'simple');
    });
  }

  // 常规模式两个分组的 provider/model 变化事件
  const gameProviderEl = document.getElementById('module-provider-game');
  if (gameProviderEl) {
    gameProviderEl.addEventListener('change', () => {
      updateModelForProvider('game');
    });
  }
  _bindModelControlEvents('game');
}

/**
 * 将 API Key 格式化为部分遮罩显示：前4字符 + •••••••• + 后4字符
 * 例如 "sk-abcdef123456xyz" → "sk-a••••••••6xyz"
 * @param {string} key
 * @returns {string}
 */
function _maskApiKey(key) {
  if (!key || typeof key !== 'string') return '';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '••••••••';
  const head = trimmed.slice(0, 4);
  const tail = trimmed.slice(-4);
  return `${head}••••••••${tail}`;
}

/**
 * 获取 API Key 输入框的真实值
 * @param {HTMLInputElement} input
 * @returns {string}
 */
function _getApiKeyRealValue(input) {
  if (!input) return '';
  const raw = (input.dataset.realValue ?? input.value ?? '').trim();
  return window.apiKeySanitizer ? window.apiKeySanitizer.sanitize(raw) : raw;
}

/**
 * 提示用户粘贴/输入的 API Key 中含非 ASCII 字符已被自动剥离
 */
function _maybeNotifyApiKeySanitized(originalTrimmed, sanitized) {
  if (!window.apiKeySanitizer) return;
  const stripped = window.apiKeySanitizer.countStripped(originalTrimmed, sanitized);
  if (stripped > 0 && typeof window.showToast === 'function') {
    window.showToast(`已自动清理 ${stripped} 个无效字符`, 'warning', 2000);
  }
}

/**
 * 设置 API Key 输入框的值（存储真实值并显示遮罩）
 * @param {HTMLInputElement} input
 * @param {string} realValue
 */
function _setApiKeyValue(input, realValue) {
  if (!input) return;
  const trimmedRaw = (realValue || '').trim();
  const trimmed = window.apiKeySanitizer
    ? window.apiKeySanitizer.sanitize(trimmedRaw)
    : trimmedRaw;
  input.dataset.realValue = trimmed;
  // 仅在输入框未聚焦时显示部分遮罩，聚焦时用 password 模式全遮罩
  if (document.activeElement !== input) {
    input.type = 'text';
    input.value = _maskApiKey(trimmed);
  } else {
    input.type = 'password';
    input.value = trimmed;
  }
}

/**
 * 为 API Key 输入框绑定聚焦/失焦事件（显示/遮罩切换）
 * @param {HTMLInputElement} input
 */
function _bindApiKeyMaskEvents(input) {
  if (!input || input.dataset.maskBound) return;
  input.dataset.maskBound = 'true';

  input.addEventListener('focus', () => {
    // 聚焦时切换到 password 模式，显示全部黑点
    const real = input.dataset.realValue ?? '';
    input.type = 'password';
    input.value = real;
  });

  input.addEventListener('blur', () => {
    // 失焦时将当前输入值视为新的真实值，显示部分遮罩
    const rawTrimmed = input.value.trim();
    const sanitized = window.apiKeySanitizer
      ? window.apiKeySanitizer.sanitize(rawTrimmed)
      : rawTrimmed;
    input.dataset.realValue = sanitized;
    input.type = 'text';
    input.value = _maskApiKey(sanitized);
    _maybeNotifyApiKeySanitized(rawTrimmed, sanitized);
  });
}

/**
 * 粘贴剪贴板内容到输入框（支持多种回退策略）
 * @param {HTMLInputElement} input - 目标输入框
 * @param {HTMLElement} btn - 粘贴按钮元素（用于视觉反馈）
 * @param {Object} [options]
 * @param {boolean} [options.raw=false] - true 时不做 API Key sanitize/遮罩，直接写入明文（用于 URL 等普通字段）
 */
async function _pasteIntoInput(input, btn, options = {}) {
  const copy = _getSettingsCopy();
  const raw = options.raw === true;

  /**
   * 成功粘贴后的视觉反馈
   */
  function onSuccess(text) {
    const trimmed = text.trim();
    if (raw) {
      input.value = trimmed;
    } else {
      const sanitized = window.apiKeySanitizer
        ? window.apiKeySanitizer.sanitize(trimmed)
        : trimmed;
      input.dataset.realValue = sanitized;
      input.type = 'text';
      input.value = _maskApiKey(sanitized);
      _maybeNotifyApiKeySanitized(trimmed, sanitized);
    }
    btn.classList.add('api-key-paste-btn--success');
    const icon = btn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = 'check';
    setTimeout(() => {
      btn.classList.remove('api-key-paste-btn--success');
      if (icon) icon.textContent = 'content_paste';
    }, 1500);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Strategy 1: Clipboard API (works on HTTPS / localhost)
  if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onSuccess(text);
        return;
      }
    } catch (_) {
      // Clipboard API denied or unavailable, try fallback
    }
  }

  // Strategy 2: execCommand('paste') via hidden textarea + paste event
  // (works on some browsers that don't support Clipboard API)
  try {
    const result = await new Promise((resolve) => {
      const textarea = document.createElement('textarea');
      textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px;';
      document.body.appendChild(textarea);

      const onPaste = (e) => {
        const pastedText = (e.clipboardData || window.clipboardData)?.getData('text') || '';
        e.preventDefault();
        textarea.removeEventListener('paste', onPaste);
        document.body.removeChild(textarea);
        resolve(pastedText);
      };
      textarea.addEventListener('paste', onPaste);
      textarea.focus();

      const didExec = document.execCommand('paste');
      if (!didExec) {
        textarea.removeEventListener('paste', onPaste);
        if (textarea.parentNode) document.body.removeChild(textarea);
        resolve('');
      } else {
        // Give a short timeout in case the paste event fires asynchronously
        setTimeout(() => {
          textarea.removeEventListener('paste', onPaste);
          if (textarea.parentNode) document.body.removeChild(textarea);
          resolve('');
        }, 100);
      }
    });
    if (result) {
      onSuccess(result);
      return;
    }
  } catch (_) {
    // execCommand fallback also failed
  }

  // Strategy 3: Focus input and show hint for manual paste
  input.focus();
  input.select();
  showToast(copy.general.provider.pasteFallback || 'Please long-press the input to paste');
}

/**
 * 构建单个 API Key 输入行
 */
function _createApiKeyRow(providerId, providerApiKeys, placeholders, testModels, esc) {
  const copy = _getSettingsCopy();
  const officialUrl = SETTINGS_PROVIDER_OFFICIAL_URLS[providerId] || '';
  const providerName = _getProviderDisplayName(providerId);
  const providerNameNode = officialUrl
    ? `<a class="provider-name provider-name-link" href="${esc(officialUrl)}" data-provider-id="${esc(providerId)}" rel="noopener noreferrer">${esc(providerName)}</a>`
    : `<span class="provider-name">${esc(providerName)}</span>`;
  const row = document.createElement('div');
  row.className = 'api-key-row';
  row.innerHTML = `
        ${providerNameNode}
        <div class="api-key-input-wrapper">
          <input type="text" class="provider-api-key-input" id="api-key-${providerId}" placeholder="${placeholders[providerId] || 'sk-...'}" autocomplete="off" spellcheck="false">
          <button class="" data-action="api-key-paste-btn" type="button" title="${copy.general.provider.pasteTitle || 'Paste'}">
            <span class="material-symbols-outlined">content_paste</span>
          </button>
        </div>
        <button class="btn-secondary" data-action="api-test-btn" data-provider="${providerId}" data-default-text="${copy.general.provider.testShort}" data-default-title="${copy.general.provider.testConnectionTitle}" title="${copy.general.provider.testConnectionTitle}">${copy.general.provider.testShort}</button>
    `;
  const input = row.querySelector('.provider-api-key-input');
  _setApiKeyValue(input, providerApiKeys?.[providerId] || '');
  _bindApiKeyMaskEvents(input);

  // DeepSeek 官方 key：blur 时实时刷新「推荐模式」toggle 可用性。
  // 直接读 input.dataset.realValue（_bindApiKeyMaskEvents 的 blur handler 已写入），
  // 不调 aiService.isRecommendedModeAvailable() 因为它读的是已保存的 config，未及时反映。
  if (providerId === 'deepseek') {
    input.addEventListener('blur', () => {
      const strip = document.querySelector(
        '.tab-strip[data-toggle-target="api-recommended-toggle"]'
      );
      const row = document.getElementById('api-recommended-mode-toggle');
      if (!strip || !row) return;
      const hasKey = !!input.dataset.realValue?.trim();
      strip.setAttribute('aria-disabled', String(!hasKey));
      strip.querySelectorAll('.tab').forEach(t => {
        t.setAttribute('aria-disabled', String(!hasKey));
      });
      const isEn =
        typeof _getSettingsLocale === 'function' && _getSettingsLocale() === 'en';
      row.title = hasKey
        ? ''
        : isEn
          ? 'Bind your DeepSeek API key in Account Center to unlock.'
          : '在账户中心绑定 DeepSeek API Key 后可用';

      // key 被清空 + 当前在推荐模式 → 主动翻 OFF 并切回 simple/advanced，
      // 避免 toggle 视觉 ON 但 aria-disabled 卡死。
      if (!hasKey && currentApiSettingsMode === 'recommended') {
        const recommendedToggle = document.getElementById('api-recommended-toggle');
        if (recommendedToggle) {
          recommendedToggle.checked = false;
          _syncToggleTabStripVisualsForCheckbox(recommendedToggle);
        }
        const advToggle = document.getElementById('api-advanced-toggle');
        _switchApiSettingsMode(advToggle?.checked ? 'advanced' : 'simple');
      }
    });
  }

  const pasteBtn = row.querySelector('[data-action~="api-key-paste-btn"]');
  pasteBtn.addEventListener('click', () => {
    _pasteIntoInput(input, pasteBtn);
  });

  const nameLink = row.querySelector('.provider-name-link');
  if (nameLink && officialUrl) {
    nameLink.addEventListener('click', event => {
      event.preventDefault();
      _confirmOpenProviderOfficialSite(providerId, officialUrl);
    });
  }

  const testBtn = row.querySelector('[data-action~="api-test-btn"]');
  testBtn.addEventListener('click', async () => {
    const apiKey = _getApiKeyRealValue(input);
    _runApiTest(testBtn, providerId, apiKey, testModels[providerId]);
  });

  return row;
}

/**
 * 动态渲染 API Key 输入行
 */
function _renderApiKeyRows() {
  const container = document.getElementById('api-keys-grid');
  if (!container) return;
  // 重渲前抓 toggle 当前 checked（applySettingsLocaleToDom 切语言时会重渲；
  // 用户尚未保存的临时改动需要跨重渲保留）
  const existingToggle = document.getElementById('websearch-toggle');
  const pendingWebSearchEnabled = existingToggle ? existingToggle.checked === true : null;
  container.innerHTML = '';
  const providerApiKeys = _getCurrentProviderApiKeysForSettings();
  const esc = s =>
    (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const placeholders = {
    gemini: 'AIza...',
    deepseek: 'sk-...',
    openai: 'sk-...',
    grok: 'xai-...',
    anthropic: 'sk-ant-...',
    siliconflow: 'sk-...',
  };
  // 每个内置 provider 测试用的默认模型
  const testModels = {
    gemini: 'gemini-3.1-flash-lite',
    deepseek: 'deepseek-v4-flash',
    openai: 'gpt-5.5',
    grok: 'grok-4.3',
    anthropic: 'claude-sonnet-4-6',
    siliconflow: 'deepseek-ai/DeepSeek-V4-Flash',
  };

  const copy = _getSettingsCopy();
  const foldGroup = document.createElement('details');
  foldGroup.className = 'provider-fold-group';
  const foldSummary = document.createElement('summary');
  foldSummary.className = 'provider-fold-summary';
  foldSummary.innerHTML = `
        <span class="provider-fold-title">${copy.general.apiKeysFoldTitle}</span>
        <span class="provider-fold-note">${copy.general.apiKeysFoldNote}</span>
    `;
  const foldContent = document.createElement('div');
  foldContent.className = 'provider-fold-content';

  // 置顶：联网搜索总开关。生效范围仅限折叠栏内 WEBSEARCH_SUPPORTED_PROVIDERS 的叙事 iter；
  // 其他服务商（OpenAI / Grok / DeepSeek 等）开了也静默忽略，靠每家行尾 badge 自解释。
  // 优先读重渲前的 pending（用户未保存改动），否则读 config
  const currentConfig = aiService.getConfig() || {};
  const webSearchEnabled =
    pendingWebSearchEnabled !== null
      ? pendingWebSearchEnabled
      : currentConfig.webSearchEnabled === true;
  const webSearchRow = document.createElement('div');
  webSearchRow.className = 'websearch-toggle-row';
  const webSearchHintHtml = `${esc(copy.general.webSearchToggleHintPrefix)}<span class="websearch-toggle-hint-warning">${esc(copy.general.webSearchToggleHintWarning)}</span>${esc(copy.general.webSearchToggleHintSuffix)}`;
  webSearchRow.innerHTML = `
        <div class="websearch-toggle-header">
          <div class="websearch-toggle-titles">
            <span class="websearch-toggle-label">${esc(copy.general.webSearchToggleLabel)}</span>
            <span class="websearch-toggle-supported-note">${esc(copy.general.webSearchToggleSupportedNote)}</span>
          </div>
          <div class="tab-strip websearch-toggle-strip" data-toggle-target="websearch-toggle">
            <input type="checkbox" id="websearch-toggle" class="websearch-toggle-input" hidden${webSearchEnabled ? ' checked' : ''}>
            <button type="button" class="tab${webSearchEnabled ? ' is-active' : ''}" data-value="on">
              <span class="ui-label-cn">开</span><span class="ui-label-en">On</span>
            </button>
            <button type="button" class="tab${webSearchEnabled ? '' : ' is-active'}" data-value="off">
              <span class="ui-label-cn">关</span><span class="ui-label-en">Off</span>
            </button>
          </div>
        </div>
        <div class="websearch-toggle-hint">${webSearchHintHtml}</div>
    `;
  foldContent.appendChild(webSearchRow);

  FOLDED_OFFICIAL_PROVIDERS.forEach(providerId => {
    foldContent.appendChild(
      _createApiKeyRow(providerId, providerApiKeys, placeholders, testModels, esc)
    );
  });
  foldGroup.appendChild(foldSummary);
  foldGroup.appendChild(foldContent);
  container.appendChild(foldGroup);

  // 绑定 toggle 的 tab-strip 视觉同步 + 切到"开"时弹 confirm 提醒额外费用
  const webSearchStrip = foldContent.querySelector('.websearch-toggle-strip');
  const webSearchInput = foldContent.querySelector('#websearch-toggle');
  if (webSearchStrip && webSearchInput) {
    const _applyWebSearchVisual = isOn => {
      webSearchInput.checked = isOn;
      webSearchStrip.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('is-active', t.dataset.value === (isOn ? 'on' : 'off'));
      });
    };
    webSearchStrip.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const isOn = tab.dataset.value === 'on';
        const wasOn = webSearchInput.checked === true;
        // 关→开 时弹 confirm；用户点取消则保持关
        if (isOn && !wasOn && typeof window.showConfirmModal === 'function') {
          window.showConfirmModal(
            copy.general.webSearchConfirmTitle,
            '',
            () => _applyWebSearchVisual(true),
            () => _applyWebSearchVisual(false),
            { descriptionHtml: webSearchHintHtml },
          );
          return;
        }
        _applyWebSearchVisual(isOn);
      });
    });
  }

  VISIBLE_PROVIDERS.forEach(providerId => {
    container.appendChild(
      _createApiKeyRow(providerId, providerApiKeys, placeholders, testModels, esc)
    );
  });
}

function _confirmOpenProviderOfficialSite(providerId, officialUrl) {
  if (!officialUrl) return;
  const providerName = _getProviderDisplayName(providerId);
  const copy = _getSettingsCopy();
  const title = copy.general.provider.openOfficialTitle;
  const description = copy.general.provider.openOfficialDescription(providerName);
  const doOpen = () => window.open(officialUrl, '_blank', 'noopener');
  window.showConfirmModal(title, description, doOpen);
}

/**
 * 执行 API 连接测试（通用逻辑）
 */
async function _runApiTest(btn, providerId, apiKey, model, baseUrl, protocol = 'openai') {
  const copy = _getSettingsCopy();
  if (btn.classList.contains('testing')) return;
  btn.classList.remove('success', 'error');
  // 重新测试 = 旧结果失效；保存时的"未测试"判定读 dataset.testResult，不依赖会被 5s setTimeout 清掉的 class
  delete btn.dataset.testResult;
  btn.classList.add('testing');
  btn.textContent = '';
  btn.disabled = true;

  // 按 HTTP status 选 toast 前缀；无匹配 / 无 status 时返回 null（让调用处用原 message 当 toast）
  const _pickApiErrorPrefix = status => {
    if (status === 401 || status === 403) return copy.general.provider.apiErrorAuth;
    if (status === 402) return copy.general.provider.apiErrorBalance;
    if (status === 404) return copy.general.provider.apiErrorNotFound;
    return null;
  };

  try {
    const result = await aiService.testApiConnection(providerId, apiKey, model, baseUrl, protocol);
    btn.classList.remove('testing');
    if (result.ok) {
      btn.classList.add('success');
      btn.dataset.testResult = 'pass';
      btn.textContent = `${result.latency}ms`;
      btn.title = result.message;
    } else {
      btn.classList.add('error');
      btn.dataset.testResult = 'fail';
      btn.textContent = copy.general.provider.failed;
      // 网络层失败 → 精简文案；HTTP 层失败 → 按 status 加可读前缀（鉴权/余额/找不到）+ 服务商原话
      let toastMsg;
      if (result.code === 'network') {
        toastMsg = copy.general.provider.apiErrorNetwork;
      } else {
        const prefix = _pickApiErrorPrefix(result.status);
        toastMsg = prefix && result.message ? `${prefix}: ${result.message}` : (prefix || result.message);
      }
      btn.title = result.message;
      showToast(toastMsg);
    }
  } catch (e) {
    btn.classList.remove('testing');
    btn.classList.add('error');
    btn.dataset.testResult = 'fail';
    btn.textContent = copy.general.provider.failed;
    const errMsg = e.message || copy.general.provider.unknownError;
    btn.title = errMsg;
    // testApiConnection 内部已 try/catch，外层 catch 几乎只在 fetch 抛 TypeError 才到——按 network 处理
    const toastMsg = e.name === 'TypeError'
      ? copy.general.provider.apiErrorNetwork
      : errMsg;
    showToast(toastMsg);
  } finally {
    btn.disabled = false;
    // 5 秒后恢复默认外观（dataset.testResult 保留，不清 — 它是保存时校验的依据）
    setTimeout(() => {
      btn.classList.remove('success', 'error');
      btn.textContent = btn.dataset.defaultText || copy.general.provider.testShort;
      btn.title = btn.dataset.defaultTitle || copy.general.provider.testConnectionTitle;
    }, 5000);
  }
}

/**
 * 动态渲染自定义 Provider 管理区域
 */
function _renderCustomProviderManager() {
  const container = document.getElementById('custom-providers-container');
  if (!container) return;
  container.innerHTML = '';
  const copy = _getSettingsCopy();
  const customProviders = _getCurrentCustomProvidersForSettings();
  const providerApiKeys = _getCurrentProviderApiKeysForSettings();

  // HTML 转义，防止 XSS 和 HTML 破坏
  const esc = s =>
    (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  // 渲染已有的自定义 provider
  customProviders.forEach(cp => {
    const row = document.createElement('div');
    row.className = 'custom-provider-row';
    row.dataset.id = cp.id;
    const cpProtocol = cp.protocol === 'anthropic' ? 'anthropic' : 'openai';
    const baseUrlPlaceholder =
      cpProtocol === 'anthropic'
        ? copy.general.provider.baseUrlPlaceholderAnthropic
        : 'https://api.example.com/v1';
    const maxTokensEnabled = cp.maxOutputTokensEnabled === true;
    const maxTokensValueAttr =
      cp.maxOutputTokens != null && cp.maxOutputTokens !== ''
        ? esc(String(cp.maxOutputTokens))
        : '';
    row.innerHTML = `
            <div class="cp-field cp-field-name">
                <span class="cp-label">${copy.general.provider.providerNameLabel}</span>
                <input type="text" class="cp-name" value="${esc(cp.name)}" placeholder="${copy.general.provider.providerNamePlaceholder}">
                <span class="cp-status-badge" data-status="untested" title="${copy.general.provider.statusBadgeUntested}"><span class="material-symbols-outlined">warning</span></span>
                <button class="btn-danger btn-icon" data-action="cp-delete-btn" title="${copy.general.provider.deleteButtonTitle}" type="button"><span class="material-symbols-outlined">delete</span></button>
            </div>
            <div class="cp-field cp-field-baseurl">
                <span class="cp-label">URL</span>
                <div class="api-key-input-wrapper">
                  <input type="text" class="cp-baseurl" value="${esc(cp.baseUrl)}" placeholder="${baseUrlPlaceholder}">
                  <button class="" data-action="api-key-paste-btn" type="button" title="${copy.general.provider.pasteTitle || 'Paste'}">
                    <span class="material-symbols-outlined">content_paste</span>
                  </button>
                </div>
            </div>
            <div class="cp-field cp-field-key">
                <span class="cp-label">Key</span>
                <div class="api-key-input-wrapper">
                  <input type="text" class="cp-apikey" placeholder="API Key" autocomplete="off" spellcheck="false">
                  <button class="" data-action="api-key-paste-btn" type="button" title="${copy.general.provider.pasteTitle || 'Paste'}">
                    <span class="material-symbols-outlined">content_paste</span>
                  </button>
                </div>
                <button class="btn-secondary" data-action="api-test-btn" data-provider="${cp.id}" data-default-text="${copy.general.provider.test}" data-default-title="${copy.general.provider.testConnectionTitle}" title="${copy.general.provider.testConnectionTitle}">${copy.general.provider.test}</button>
            </div>
            <div class="cp-field cp-field-model">
                <span class="cp-label">${copy.general.provider.modelLabel}</span>
                <input type="text" class="cp-model" value="${esc(cp.defaultModel)}" placeholder="${copy.general.provider.modelPlaceholder}">
                <button class="" data-action="cp-fetch-models-btn" title="${copy.general.provider.fetchModels}" type="button"><span class="material-symbols-outlined">expand_more</span></button>
            </div>
            <div class="cp-advanced-divider" aria-hidden="true">
                <span class="cp-advanced-divider-label">${copy.general.provider.advancedSectionLabel}</span>
            </div>
            <div class="cp-field cp-field-protocol">
                <span class="cp-label">${copy.general.provider.protocolLabel}</span>
                <select class="cp-protocol">
                  <option value="openai"${cpProtocol === 'openai' ? ' selected' : ''}>${copy.general.provider.protocolOpenAI}</option>
                  <option value="anthropic"${cpProtocol === 'anthropic' ? ' selected' : ''}>${copy.general.provider.protocolAnthropic}</option>
                </select>
            </div>
            <div class="cp-field cp-field-maxtokens">
                <span class="cp-label">${copy.general.provider.maxOutputTokensLabel}</span>
                <div class="tab-strip cp-maxtokens-toggle" data-toggle-target="cp-maxtokens-toggle-${esc(cp.id)}">
                  <input type="checkbox" id="cp-maxtokens-toggle-${esc(cp.id)}" class="cp-maxtokens-enabled" hidden${maxTokensEnabled ? ' checked' : ''}>
                  <button type="button" class="tab${maxTokensEnabled ? ' is-active' : ''}" data-value="on">
                    <span class="ui-label-cn">开</span><span class="ui-label-en">On</span>
                  </button>
                  <button type="button" class="tab${maxTokensEnabled ? '' : ' is-active'}" data-value="off">
                    <span class="ui-label-cn">关</span><span class="ui-label-en">Off</span>
                  </button>
                </div>
                <input type="number" class="cp-maxtokens-value" min="1" step="1" placeholder="${copy.general.provider.maxOutputTokensPlaceholder}" value="${maxTokensValueAttr}"${maxTokensEnabled ? '' : ' disabled'}>
            </div>
        `;
    // 初始化 API Key 遮罩
    const cpKeyInput = row.querySelector('.cp-apikey');
    _setApiKeyValue(cpKeyInput, providerApiKeys?.[cp.id] || '');
    _bindApiKeyMaskEvents(cpKeyInput);
    // 删除按键事件
    row.querySelector('[data-action~="cp-delete-btn"]').addEventListener('click', () => {
      showConfirmModal(
        copy.general.provider.deleteProviderTitle,
        copy.general.provider.deleteProviderBody(cp.name),
        () => {
          _captureDraftProviderApiKeysFromUI();
          _captureDraftCustomProvidersFromUI();
          settingsDraftCustomProviders = _getCurrentCustomProvidersForSettings().filter(
            item => item.id !== cp.id
          );
          const nextApiKeys = { ...(_getCurrentProviderApiKeysForSettings() || {}) };
          delete nextApiKeys[cp.id];
          settingsDraftProviderApiKeys = nextApiKeys;
          _cpTestResultMemory.delete(cp.id);
          _refreshAllProviderUI({ captureFromUI: false });
          showToast(copy.general.provider.deletedProvider(cp.name));
        }
      );
    });
    // 粘贴按键事件（URL + Key 两个字段）
    const cpUrlPasteBtn = row.querySelector('.cp-field-baseurl [data-action~="api-key-paste-btn"]');
    const cpBaseUrlInput = row.querySelector('.cp-baseurl');
    if (cpUrlPasteBtn && cpBaseUrlInput) {
      cpUrlPasteBtn.addEventListener('click', () => {
        _pasteIntoInput(cpBaseUrlInput, cpUrlPasteBtn, { raw: true });
      });
    }
    const cpPasteBtn = row.querySelector('.cp-field-key [data-action~="api-key-paste-btn"]');
    const cpApiKeyInput = row.querySelector('.cp-apikey');
    if (cpPasteBtn && cpApiKeyInput) {
      cpPasteBtn.addEventListener('click', () => {
        _pasteIntoInput(cpApiKeyInput, cpPasteBtn);
      });
    }
    // 协议切换事件：联动 baseurl placeholder + 获取模型按钮显隐
    const protocolSelect = row.querySelector('.cp-protocol');
    const applyProtocolUI = () => {
      const baseUrlInput = row.querySelector('.cp-baseurl');
      const fetchBtn = row.querySelector('[data-action~="cp-fetch-models-btn"]');
      const isAnthropic = protocolSelect.value === 'anthropic';
      baseUrlInput.placeholder = isAnthropic
        ? copy.general.provider.baseUrlPlaceholderAnthropic
        : 'https://api.example.com/v1';
      // Anthropic 兼容端点（DeepSeek/MiniMax 等）通常不暴露 /v1/models，隐藏自动拉取按钮，让用户手输
      // 注意：cp-fetch-models-btn 的 CSS 写了 display: flex，会覆盖 [hidden] 默认样式，所以这里走 style.display
      if (fetchBtn) fetchBtn.style.display = isAnthropic ? 'none' : '';
    };
    protocolSelect.addEventListener('change', applyProtocolUI);
    applyProtocolUI();

    // 状态徽章：与 testBtn.dataset.testResult 联动，但徽章状态独立可读
    const _setRowBadge = status => {
      const badge = row.querySelector('.cp-status-badge');
      if (!badge) return;
      const iconEl = badge.querySelector('.material-symbols-outlined');
      const iconMap = { pass: 'check_circle', fail: 'error', untested: 'warning' };
      const titleMap = {
        pass: copy.general.provider.statusBadgePass,
        fail: copy.general.provider.statusBadgeFail,
        untested: copy.general.provider.statusBadgeUntested,
      };
      badge.dataset.status = status;
      badge.title = titleMap[status] || '';
      if (iconEl) iconEl.textContent = iconMap[status] || 'help';
    };

    // URL / Key / Model / 协议 改动 → 旧的"测试通过"标记失效（避免改完 key 后保存仍被认为已验证）
    // 注：写入 'untested' 而不是 delete——这样下次重渲染（如 +添加 / 删别行）能记住"玩家改过没测"，
    // 不会因为字段全填就被无脑预设成 pass。
    const _invalidateRowTestResult = () => {
      const tBtn = row.querySelector('[data-action~="api-test-btn"]');
      if (tBtn) delete tBtn.dataset.testResult;
      _cpTestResultMemory.set(cp.id, 'untested');
      _setRowBadge('untested');
    };
    cpBaseUrlInput?.addEventListener('input', _invalidateRowTestResult);
    cpApiKeyInput?.addEventListener('input', _invalidateRowTestResult);
    protocolSelect.addEventListener('change', _invalidateRowTestResult);

    // 初始状态优先级：
    // 1) 内存里有记录（pass/fail/untested）→ 直接用（重渲染场景：+添加 / 删别行 / 改完字段又被重渲染都靠这条）
    // 2) 没记录 + 字段全填 → 默认信任为"已通过"（老玩家只改无关字段不被误伤）
    // 3) 没记录 + 字段不全 → "未测试"（新空行走这里，不会闪现绿色）
    const _initialTestBtn = row.querySelector('[data-action~="api-test-btn"]');
    const _initialApiKey = cpApiKeyInput ? _getApiKeyRealValue(cpApiKeyInput) : '';
    const _isFullyConfigured = !!(cp.name && cp.baseUrl && _initialApiKey && cp.defaultModel);
    const _memorizedResult = _cpTestResultMemory.get(cp.id);
    if (_memorizedResult) {
      if (_initialTestBtn && (_memorizedResult === 'pass' || _memorizedResult === 'fail')) {
        _initialTestBtn.dataset.testResult = _memorizedResult;
      }
      _setRowBadge(_memorizedResult);
    } else if (_isFullyConfigured) {
      if (_initialTestBtn) _initialTestBtn.dataset.testResult = 'pass';
      _setRowBadge('pass');
    } else {
      _setRowBadge('untested');
    }

    // Max Output Tokens 开关：勾上才允许输入数字
    const maxTokensToggle = row.querySelector('.cp-maxtokens-enabled');
    const maxTokensInput = row.querySelector('.cp-maxtokens-value');
    if (maxTokensToggle && maxTokensInput) {
      maxTokensToggle.addEventListener('change', () => {
        maxTokensInput.disabled = !maxTokensToggle.checked;
        if (maxTokensToggle.checked) maxTokensInput.focus();
      });
    }

    // 自定义服务商行内 name / defaultModel 实时同步到模块 provider/model 下拉
    const cpNameInput = row.querySelector('.cp-name');
    cpNameInput?.addEventListener('input', () => _syncCustomProviderInlineChange(cp.id));
    const cpModelInput = row.querySelector('.cp-model');
    cpModelInput?.addEventListener('input', () => {
      cpModelInput.classList.remove('cp-model-invalid');
      cpModelInput.removeAttribute('aria-invalid');
      _syncCustomProviderInlineChange(cp.id);
      _invalidateRowTestResult();
    });
    cpModelInput?.addEventListener('paste', e => {
      const pasted = e.clipboardData?.getData('text') || '';
      if (_pastedLooksLikeApiKey(pasted)) {
        // 等粘贴文本落定到 input 之后再弹 toast，避免顺序倒置
        setTimeout(() => {
          showToast(copy.general.provider.pastedLooksLikeApiKey, 'warning');
        }, 0);
      }
    });
    // 测试按键事件
    const testBtn = row.querySelector('[data-action~="api-test-btn"]');
    testBtn.addEventListener('click', async () => {
      const baseUrl = row.querySelector('.cp-baseurl').value.trim();
      const cpKeyEl = row.querySelector('.cp-apikey');
      const apiKey = _getApiKeyRealValue(cpKeyEl);
      const model = row.querySelector('.cp-model').value.trim();
      const protocol = row.querySelector('.cp-protocol')?.value === 'anthropic' ? 'anthropic' : 'openai';

      if (!baseUrl) {
        showToast(copy.general.provider.fillUrlFirst);
        return;
      }
      if (!model) {
        showToast(copy.general.provider.fillModelFirst);
        return;
      }
      // 自定义 provider 的 ID 是 'custom', URL 是从配置获取的
      await _runApiTest(testBtn, 'custom', apiKey, model, baseUrl, protocol);
      // 测试结束后同步徽章 + 记忆（重渲染时能恢复，不会被无脑预设成绿色）
      const finalResult = testBtn.dataset.testResult || 'untested';
      _setRowBadge(finalResult);
      if (finalResult === 'pass' || finalResult === 'fail') {
        _cpTestResultMemory.set(cp.id, finalResult);
      } else {
        _cpTestResultMemory.delete(cp.id);
      }
    });
    // 获取模型列表按键事件
    const fetchModelsBtn = row.querySelector('[data-action~="cp-fetch-models-btn"]');
    fetchModelsBtn.addEventListener('click', async () => {
      const baseUrl = row.querySelector('.cp-baseurl').value.trim();
      const cpKeyEl = row.querySelector('.cp-apikey');
      const apiKey = _getApiKeyRealValue(cpKeyEl);
      const protocol = row.querySelector('.cp-protocol')?.value === 'anthropic' ? 'anthropic' : 'openai';
      if (!baseUrl || !apiKey) {
        showToast(copy.general.provider.fillUrlAndKeyFirst);
        return;
      }
      // 移除已有的下拉菜单
      const existing = row.querySelector('.cp-models-dropdown');
      if (existing) {
        existing.remove();
        return;
      }
      fetchModelsBtn.disabled = true;
      fetchModelsBtn.textContent = '…';
      try {
        const models = await aiService.fetchCustomProviderModels(baseUrl, apiKey, protocol);
        if (!models.length) {
          showToast(copy.general.provider.noModelsFound);
          return;
        }
        const modelField = row.querySelector('.cp-field-model');
        const dropdown = document.createElement('div');
        dropdown.className = 'cp-models-dropdown';
        const header = document.createElement('div');
        header.className = 'cp-models-dropdown-header';
        header.textContent = `${models.length} ${copy.general.provider.modelLabel}`;
        dropdown.appendChild(header);
        const list = document.createElement('div');
        list.className = 'cp-models-dropdown-list';
        models.forEach(m => {
          const item = document.createElement('div');
          item.className = 'cp-models-dropdown-item';
          item.textContent = m;
          item.addEventListener('click', () => {
            row.querySelector('.cp-model').value = m;
            dropdown.remove();
            document.removeEventListener('mousedown', closeOnOutside);
          });
          list.appendChild(item);
        });
        dropdown.appendChild(list);
        modelField.appendChild(dropdown);
        // 点击外部时关闭
        const closeOnOutside = e => {
          if (!dropdown.contains(e.target) && e.target !== fetchModelsBtn) {
            dropdown.remove();
            document.removeEventListener('mousedown', closeOnOutside);
          }
        };
        setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 0);
      } catch (e) {
        // fetch 抛 TypeError = 网络/CORS 层失败，原生 message 是 "Load failed" / "Failed to fetch"
        // 这种字符串对玩家无意义，直接显示精简的"无法连接"文案，不拼后缀
        if (e.name === 'TypeError') {
          showToast(copy.general.provider.apiErrorNetwork);
        } else {
          let prefix = copy.general.provider.fetchModelsFailed;
          if (e.status === 401 || e.status === 403) {
            prefix = copy.general.provider.apiErrorAuth;
          } else if (e.status === 402) {
            prefix = copy.general.provider.apiErrorBalance;
          } else if (e.status === 404) {
            prefix = copy.general.provider.apiErrorNotFound;
          }
          const detail = e.message || '';
          showToast(detail ? `${prefix}: ${detail}` : prefix);
        }
      } finally {
        fetchModelsBtn.disabled = false;
        fetchModelsBtn.innerHTML = '<span class="material-symbols-outlined">expand_more</span>';
      }
    });
    container.appendChild(row);
  });

  // 添加按键
  if (customProviders.length < 5) {
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.dataset.action = 'add-provider-btn';
    addBtn.textContent = copy.general.provider.addProvider;
    addBtn.addEventListener('click', () => {
      _captureDraftProviderApiKeysFromUI();
      _captureDraftCustomProvidersFromUI();
      const newId = 'custom_' + Date.now();
      settingsDraftCustomProviders.push({
        id: newId,
        name: copy.general.provider.defaultProviderName,
        baseUrl: '',
        defaultModel: '',
        protocol: 'openai',
      });
      _refreshAllProviderUI({ captureFromUI: false });
    });
    container.appendChild(addBtn);
  }

  // 给本次新渲染的 Max Output Tokens 二段开关挂上点击 → 同步 hidden checkbox 的桥接
  _bindToggleTabStrips();
}

/**
 * 刷新所有与 Provider 相关的 UI
 */
function _refreshAllProviderUI(options = {}) {
  if (options.captureFromUI !== false) {
    _captureDraftProviderApiKeysFromUI();
    _captureDraftCustomProvidersFromUI();
  }
  _renderApiKeyRows();
  _populateProviderSelects();
  _alignModuleProviderModelSelections();
  _renderCustomProviderManager();
}

/**
 * 自定义服务商行的内联字段（name / defaultModel）变更时实时同步：
 * - 把 UI 输入回写到 settingsDraftCustomProviders
 * - 刷新所有模块的 provider 下拉 label
 * - 对每个当前正在使用此自定义服务商的模块，重新生成模型下拉（保留当前选中值）
 *
 * 不会重渲染自定义服务商区域本身，避免抢走用户正在键入的输入焦点。
 */
function _syncCustomProviderInlineChange(cpId) {
  _captureDraftCustomProvidersFromUI();
  _populateProviderSelects();
  UI_MODULES_WITH_UNIFIED.forEach(uiModuleId => {
    const providerSelect = document.getElementById(`module-provider-${uiModuleId}`);
    if (providerSelect && providerSelect.value === cpId) {
      const currentModel = _getResolvedModelValue(uiModuleId);
      _syncModelControlForProvider(uiModuleId, cpId, currentModel);
    }
  });
}

/**
 * 加载设置到 UI
 */
function setupSettingsUI() {
  const config = aiService.getConfig();
  if (
    settingsDraftThemeMode === null ||
    settingsDraftCustomProviders === null ||
    settingsDraftProviderApiKeys === null
  ) {
    _beginSettingsDraftSession(config);
  }

  // 动态渲染 API Keys、自定义 Provider
  _renderApiKeyRows();
  _renderCustomProviderManager();
  _populateProviderSelects();
  _resetAllPriceRowEditingStates();

  // 加载模块配置(使用UI模块列表)
  UI_MODULES.forEach(uiModuleId => {
    // summary-chapter 特殊处理:从 summary 配置读取
    const configKey = uiModuleId === 'summary-chapter' ? 'summary' : uiModuleId;
    const moduleConfig =
      config.modules?.[configKey] || _getModuleDefaultConfigForSettings(uiModuleId);

    const providerSelect = document.getElementById(`module-provider-${uiModuleId}`);

    if (providerSelect) {
      providerSelect.value = moduleConfig.provider;
      // 绑定变化事件:切换服务商时自动更新模型（只绑定一次）
      const providerKey = `provider-${uiModuleId}`;
      if (!boundEventListeners.has(providerKey)) {
        providerSelect.addEventListener('change', () => {
          updateModelForProvider(uiModuleId);
          if (providerSelect.value === 'siliconflow' && typeof window.showAlertModal === 'function') {
            window.showAlertModal('提示', '硅基流动免费层级有严重的速率限制。');
          }
        });
        boundEventListeners.add(providerKey);
      }
    }
    const selectedProvider =
      providerSelect?.value || moduleConfig.provider || _getDefaultProviderForUIModule(uiModuleId);
    _syncModelControlForProvider(
      uiModuleId,
      selectedProvider,
      moduleConfig.model || _getProviderDefaultModel(uiModuleId, selectedProvider)
    );
    _bindModelControlEvents(uiModuleId);
    updatePriceForModel(uiModuleId);
    _bindPriceRowEvents(uiModuleId);

    // 加载 temperature
    const tempInput = document.getElementById(`module-temp-${uiModuleId}`);
    if (tempInput) {
      const defaultTemperature = _getDefaultTemperatureForUIModule(uiModuleId, selectedProvider);
      const normalizedTemperature = _normalizeTemperatureForUI(
        moduleConfig.temperature,
        defaultTemperature
      ).value;
      tempInput.value = normalizedTemperature;
      // 绑定 change 事件：失焦时实时 clamp，防止玩家输入越界后未保存就发上游
      const tempKey = `temp-${uiModuleId}`;
      if (!boundEventListeners.has(tempKey)) {
        tempInput.addEventListener('change', () => {
          const fallback = _getDefaultTemperatureForUIModule(uiModuleId, null);
          const result = _normalizeTemperatureForUI(tempInput.value, fallback);
          if (result.adjusted) tempInput.value = result.value;
        });
        boundEventListeners.add(tempKey);
      }
    }

    // 加载 DeepSeek V4 思考档位
    _bindThinkingTabsEvents(uiModuleId);
    _setThinkingControlValue(uiModuleId, moduleConfig.thinking);
    _syncThinkingControlVisibility(uiModuleId, selectedProvider);
  });

  _alignModuleProviderModelSelections();

  // 加载其他设置
  const currentThemeMode = _getCurrentThemeModeForSettings();
  _syncSettingsThemeToggleIcon(currentThemeMode);

  const settingsThemeToggleBtn = document.getElementById('settings-theme-toggle-btn');
  if (settingsThemeToggleBtn && !boundEventListeners.has('settings-theme-toggle-btn')) {
    settingsThemeToggleBtn.addEventListener('click', (e) => {
      const nextMode = _getCurrentThemeModeForSettings() === 'dark' ? 'light' : 'dark';
      _applyThemeModeInstant(nextMode, { x: e.clientX, y: e.clientY });
    });
    boundEventListeners.add('settings-theme-toggle-btn');
  }

  const settingsLanguageToggleBtn = document.getElementById('settings-language-toggle-btn');
  if (settingsLanguageToggleBtn) {
    _syncSettingsLanguageToggleButton();
    if (!boundEventListeners.has('settings-language-toggle-btn')) {
      settingsLanguageToggleBtn.addEventListener('click', () => {
        const nextLanguage = _getResolvedUiLanguageForSettings() === 'en' ? 'zh-CN' : 'en';
        _applyUiLanguageInstant(nextLanguage);
      });
      boundEventListeners.add('settings-language-toggle-btn');
    }
  }

  // 界面缩放（恢复默认 + 滑杆）
  const uiScaleMode = _getCurrentUIScaleModeForSettings();
  const uiScaleValue = _getCurrentUIScaleValueForSettings();
  _syncUIScaleControls(uiScaleMode, uiScaleValue);

  const uiScaleDefaultBtn = document.getElementById('ui-scale-default-btn');
  if (uiScaleDefaultBtn && !boundEventListeners.has('ui-scale-default-btn')) {
    uiScaleDefaultBtn.addEventListener('click', () => {
      _applyUIScaleInstant('auto', _getCurrentUIScaleValueForSettings());
    });
    boundEventListeners.add('ui-scale-default-btn');
  }

  const uiScaleTabs = document.getElementById('ui-scale-tabs');
  if (uiScaleTabs && !boundEventListeners.has('ui-scale-tabs')) {
    uiScaleTabs.querySelectorAll('.tab[data-scale]').forEach(tab => {
      tab.addEventListener('click', () => {
        const nextValue = _normalizeUIScaleValue(tab.dataset.scale);
        _applyUIScaleInstant('manual', nextValue);
      });
    });
    boundEventListeners.add('ui-scale-tabs');
  }

  const feedbackOpenBtn = document.getElementById('open-feedback-modal-btn');
  if (feedbackOpenBtn && !boundEventListeners.has('open-feedback-modal-btn')) {
    feedbackOpenBtn.addEventListener('click', () => openFeedbackModal(feedbackOpenBtn));
    boundEventListeners.add('open-feedback-modal-btn');
  }

  const feedbackCancelBtn = document.getElementById('feedback-cancel-btn');
  if (feedbackCancelBtn && !boundEventListeners.has('feedback-cancel-btn')) {
    feedbackCancelBtn.addEventListener('click', () => closeFeedbackModal());
    boundEventListeners.add('feedback-cancel-btn');
  }

  const feedbackForm = _getFeedbackForm();
  if (feedbackForm && !boundEventListeners.has('feedback-form-submit')) {
    feedbackForm.addEventListener('submit', _handleFeedbackSubmit);
    boundEventListeners.add('feedback-form-submit');
  }

  const feedbackIncludeDebug = document.getElementById('feedback-include-debug');
  if (feedbackIncludeDebug && !boundEventListeners.has('feedback-include-debug')) {
    feedbackIncludeDebug.addEventListener('change', _updateFeedbackDebugMeta);
    boundEventListeners.add('feedback-include-debug');
  }

  const feedbackModal = _getFeedbackModal();
  if (feedbackModal && !boundEventListeners.has('feedback-modal-backdrop')) {
    feedbackModal.addEventListener('click', event => {
      if (event.target === feedbackModal && !feedbackSubmitPending) {
        closeFeedbackModal();
      }
    });
    boundEventListeners.add('feedback-modal-backdrop');
  }

  if (!boundEventListeners.has('ui-scale-changed-sync')) {
    window.addEventListener('ui-scale-changed', () => {
      const mode = _getCurrentUIScaleModeForSettings();
      const scale = _getCurrentUIScaleValueForSettings();
      _syncUIScaleControls(mode, scale);
    });
    boundEventListeners.add('ui-scale-changed-sync');
  }

  // Streaming toggle: 同步到两个面板
  const streamingToggle = document.getElementById('streaming-toggle');
  const streamingToggleAdv = document.getElementById('streaming-toggle-adv');
  if (streamingToggle) {
    streamingToggle.checked = config.useStreaming === true;
    _syncToggleTabStripVisualsForCheckbox(streamingToggle);
  }
  if (streamingToggleAdv) {
    streamingToggleAdv.checked = config.useStreaming === true;
    _syncToggleTabStripVisualsForCheckbox(streamingToggleAdv);
  }

  // 初始化 API 设置模式切换
  _initApiSettingsModeToggle();
  // 用 getEffectiveApiSettingsMode：用户保存的 'recommended' 但 deepseek key
  // 已被删除时，自动降级到 'simple'，避免进入推荐面板后 AI 调用失败。
  const savedApiMode =
    typeof window.aiService?.getEffectiveApiSettingsMode === 'function'
      ? window.aiService.getEffectiveApiSettingsMode()
      : (config.apiSettingsMode === 'advanced' ? 'advanced' : 'simple');
  currentApiSettingsMode = savedApiMode;
  _refreshRecommendedToggleAvailability();
  // 从 react 配置初始化"沙盒"面板（兼容旧 key）
  const reactConfig = config.modules?.react || config.modules?.step1 || _getModuleDefaultConfigForSettings('game');
  const gameProviderInit = document.getElementById('module-provider-game');
  const gameTempInit = document.getElementById('module-temp-game');
  const gameProviderForInit = reactConfig.provider || _getDefaultProviderForUIModule('game');
  if (gameProviderInit)
    gameProviderInit.value = gameProviderForInit;
  _syncModelControlForProvider(
    'game',
    gameProviderForInit,
    reactConfig.model || _getProviderDefaultModel('game', reactConfig.provider)
  );
  _bindModelControlEvents('game');
  if (gameTempInit) {
    const defTempG = _getDefaultTemperatureForUIModule(
      'react',
      gameProviderForInit
    );
    gameTempInit.value = _normalizeTemperatureForUI(reactConfig.temperature, defTempG).value;
  }
  _bindThinkingTabsEvents('game');
  _setThinkingControlValue('game', reactConfig.thinking);
  _syncThinkingControlVisibility('game', gameProviderForInit);
  updatePriceForModel('game');
  _bindPriceRowEvents('game');

  // 恢复面板显示状态：visibility-only。
  // 注意：不能调 _switchApiSettingsMode(savedApiMode)——那个函数有跨模式 SYNC 逻辑
  // （把游戏面板的值覆盖到所有 UI_MODULES），是给 USER-INITIATED 切换用的。
  // init 时跑会把 L3985+ 刚加载的用户高级配置全部清掉。
  {
    const recommendedToggle = document.getElementById('api-recommended-toggle');
    const advancedToggle = document.getElementById('api-advanced-toggle');
    const recommendedPanel = document.getElementById('api-recommended-config');
    const simplePanel = document.getElementById('api-simple-config');
    const advancedPanel = document.getElementById('api-advanced-config');
    const advancedToggleRow = document.getElementById('api-settings-mode-toggle');

    if (recommendedToggle) {
      recommendedToggle.checked = savedApiMode === 'recommended';
      _syncToggleTabStripVisualsForCheckbox(recommendedToggle);
    }
    if (advancedToggle) {
      advancedToggle.checked = savedApiMode === 'advanced';
      _syncToggleTabStripVisualsForCheckbox(advancedToggle);
    }

    if (savedApiMode === 'recommended') {
      if (recommendedPanel) recommendedPanel.style.display = '';
      if (advancedToggleRow) advancedToggleRow.style.display = 'none';
      if (simplePanel) {
        simplePanel.style.display = 'none';
        simplePanel.classList.remove('disabled');
      }
      if (advancedPanel) advancedPanel.style.display = 'none';
    } else {
      if (recommendedPanel) recommendedPanel.style.display = 'none';
      if (advancedToggleRow) advancedToggleRow.style.display = '';
      if (savedApiMode === 'advanced') {
        if (simplePanel) {
          simplePanel.classList.add('disabled');
          simplePanel.style.display = '';
        }
        if (advancedPanel) advancedPanel.style.display = '';
      } else {
        if (simplePanel) {
          simplePanel.classList.remove('disabled');
          simplePanel.style.display = '';
        }
        if (advancedPanel) advancedPanel.style.display = 'none';
      }
    }
  }

  // 主题风格选择
  _populateThemeSkinOptions(config);

  // 页面背景模式
  _populateBgModeOptions();
  _syncParchmentLock();

  const defaultContentFontToggle = document.getElementById('default-content-font-toggle');
  if (defaultContentFontToggle) {
    const stored = localStorage.getItem('default-content-font');
    defaultContentFontToggle.checked = stored === null || stored === 'on';
    document.documentElement.setAttribute('data-default-content-font', defaultContentFontToggle.checked ? 'on' : 'off');
  }

  const narrativeColorizeToggle = document.getElementById('narrative-colorize-toggle');
  if (narrativeColorizeToggle) {
    narrativeColorizeToggle.checked = localStorage.getItem('narrative-colorize') === 'on';
  }

  const clickToSendToggle = document.getElementById('click-to-send-toggle');
  if (clickToSendToggle) {
    const stored = localStorage.getItem('click-to-send');
    clickToSendToggle.checked = stored === null || stored === 'on';
  }

  // 重新绑定 toggle tab-strip（HTML 已渲染，幂等调用）
  _bindToggleTabStrips();

  // 叙事篇幅 tabs（短/中/长）— 推荐模式下锁定为 medium 并禁用控件
  const narrativeLengthTabs = document.getElementById('narrative-length-tabs');
  if (narrativeLengthTabs) {
    _applyNarrativeLengthToUI(config);
  }

  // 加载自定义 System Prompt 列表
  _renderCustomSystemPromptList(config);

  // 绑定"新增提示词"按键（只绑定一次）
  const customPromptAddBtn = document.getElementById('custom-system-prompt-add');
  if (customPromptAddBtn && !boundEventListeners.has('custom-prompt-add')) {
    customPromptAddBtn.addEventListener('click', () => {
      const container = document.getElementById('custom-system-prompt-list');
      if (!container) return;
      const newItem = {
        id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        role: 'system',
        content: '',
      };
      _appendCustomSystemPromptCard(container, newItem, null, { expanded: true, editing: true });
      _regroupCustomPromptCards(container);
      // 找回新插入的那张卡片（regroup 后位置可能变）
      const addedCard = container.querySelector(`[data-prompt-id="${newItem.id}"]`);
      addedCard?.querySelector('.fn-content-textarea')?.focus();
    });
    boundEventListeners.add('custom-prompt-add');
  }

  const editorPromptValues = _getEditorPromptValuesForSettings(config);
  _savedEditorGreetingValue = editorPromptValues.savedGreeting;
  _savedEditorInitValue = editorPromptValues.savedInitModule;

  // 加载 Editor 开场白
  const greetingTextarea = document.getElementById('editor-greeting');
  if (greetingTextarea) {
    greetingTextarea.value = editorPromptValues.greeting;
  }

  // 加载 Editor Init 模块
  const initModuleTextarea = document.getElementById('editor-init-module');
  if (initModuleTextarea) {
    initModuleTextarea.value = editorPromptValues.initModule;
  }
  _syncEditorPromptReadonlyState(_getActiveWorldCardForSettings());
  _initCustomTabTextareaAutoResize();

  // 绑定全局重置所有自定义设置内容按键（只绑定一次）
  const globalResetStepsBtn = document.getElementById('global-reset-steps-btn');
  if (globalResetStepsBtn && !boundEventListeners.has('global-reset-steps')) {
    globalResetStepsBtn.addEventListener('click', () => {
      if (typeof window.showConfirmModal !== 'function') return;
      window.showConfirmModal(
        _getSettingsCopy().functionEditor.confirm.resetAllTitle,
        _getSettingsCopy().functionEditor.confirm.resetAllBody,
        () => {
          // 重置 ReAct Functions
          _populateReactFunctions({});
          _refreshConfigurableCard('react');
          // 重置自定义 System Prompt 列表
          const promptListEl = document.getElementById('custom-system-prompt-list');
          if (promptListEl) {
            promptListEl.innerHTML = '';
          }
          if (document.getElementById('narrative-length-tabs')) {
            _syncNarrativeLengthTabs('medium');
          }
          // 重置 Editor 开场白
          const greetingTextarea = document.getElementById('editor-greeting');
          if (greetingTextarea) {
            greetingTextarea.value = _savedEditorGreetingValue;
          }
          // 重置 Editor Init 模块
          const initTextarea = document.getElementById('editor-init-module');
          if (initTextarea) {
            initTextarea.value = _savedEditorInitValue;
          }
          _refreshCustomTabTextareaHeights();
          populateStepPreviews();
          showToast(_getSettingsCopy().functionEditor.toast.resetAllDone);
        }
      );
    });
    boundEventListeners.add('global-reset-steps');
  }

  // 动态生成 ReAct Function 列表
  _populateReactFunctions(config);

  // 绑定 ReAct Function 全部重置按键（只绑定一次）
  const fnResetBtn = document.getElementById('react-fn-reset-btn');
  if (fnResetBtn && !boundEventListeners.has('react-fn-reset')) {
    fnResetBtn.addEventListener('click', () => {
      if (typeof window.showConfirmModal !== 'function') return;
      window.showConfirmModal(
        _getSettingsCopy().functionEditor.confirm.resetReactTitle,
        _getSettingsCopy().functionEditor.confirm.resetReactBody,
        () => {
          _populateReactFunctions({});
          _refreshConfigurableCard('react');
        }
      );
    });
    boundEventListeners.add('react-fn-reset');
  }

  // 渲染 Step Input Parts 预览
  populateStepPreviews();

  // 可配置卡片实时更新
  if (!boundEventListeners.has('configurable-live')) {
    const refreshReact = _debounce(() => _refreshConfigurableCard('react'), 300);

    document.getElementById('react-fn-list')?.addEventListener('input', refreshReact);
    document.getElementById('react-fn-list')?.addEventListener('change', refreshReact);
    document.getElementById('react-fn-list')?.addEventListener('click', refreshReact);
    // 叙事篇幅 tabs：点击切档
    const narrativeLengthTabsEl = document.getElementById('narrative-length-tabs');
    if (narrativeLengthTabsEl && !boundEventListeners.has('narrative-length-tabs')) {
      narrativeLengthTabsEl.querySelectorAll('.tab[data-length]').forEach(tab => {
        tab.addEventListener('click', () => {
          _syncNarrativeLengthTabs(tab.dataset.length);
        });
      });
      boundEventListeners.add('narrative-length-tabs');
    }
    // 正文默认字体开关
    const defaultContentFontToggle = document.getElementById('default-content-font-toggle');
    if (defaultContentFontToggle) {
      defaultContentFontToggle.addEventListener('change', () => {
        const val = defaultContentFontToggle.checked ? 'on' : 'off';
        localStorage.setItem('default-content-font', val);
        document.documentElement.setAttribute('data-default-content-font', val);
      });
    }
    // 叙事着色开关
    const narrativeColorizeToggle = document.getElementById('narrative-colorize-toggle');
    if (narrativeColorizeToggle) {
      narrativeColorizeToggle.checked = localStorage.getItem('narrative-colorize') === 'on';
      narrativeColorizeToggle.addEventListener('change', () => {
        localStorage.setItem('narrative-colorize', narrativeColorizeToggle.checked ? 'on' : 'off');
      });
    }
    // 点击选项即发送开关
    const clickToSendToggle = document.getElementById('click-to-send-toggle');
    if (clickToSendToggle) {
      const stored = localStorage.getItem('click-to-send');
      clickToSendToggle.checked = stored === null || stored === 'on';
      clickToSendToggle.addEventListener('change', () => {
        localStorage.setItem('click-to-send', clickToSendToggle.checked ? 'on' : 'off');
      });
    }

    // 绑定所有 .tab-strip[data-toggle-target] 的"开/关"按钮 → 同步隐藏 checkbox
    _bindToggleTabStrips();

    boundEventListeners.add('configurable-live');
  }

  // 帮助按键 toggle: 事件委托（只绑定一次）
  if (!boundEventListeners.has('section-help-toggle')) {
    const helpToggleHandler = container => {
      if (!container) return;
      container.addEventListener('click', e => {
        const btn = e.target.closest('[data-action~="section-help-btn"]');
        if (!btn) return;
        const targetId = btn.dataset.helpTarget;
        if (!targetId) return;
        const content = document.getElementById(targetId);
        if (!content) return;

        // 收起同容器内其他已展开的帮助面板
        container.querySelectorAll('.section-help-content.expanded').forEach(el => {
          if (el !== content) {
            el.classList.remove('expanded');
            el.setAttribute('aria-hidden', 'true');
            const otherBtn = container.querySelector(
              `[data-action~="section-help-btn"][data-help-target="${el.id}"]`
            );
            if (otherBtn) otherBtn.classList.remove('is-active');
          }
        });

        // 切换当前面板
        const isExpanded = content.classList.toggle('expanded');
        content.setAttribute('aria-hidden', !isExpanded);
        btn.classList.toggle('is-active', isExpanded);
      });
    };
    helpToggleHandler(document.getElementById('tab-basic'));
    helpToggleHandler(document.getElementById('tab-api'));
    helpToggleHandler(document.getElementById('tab-prompts'));
    boundEventListeners.add('section-help-toggle');
  }

  if (!boundEventListeners.has('settings-locale-sync')) {
    window.addEventListener('ui-language-changed', () => {
      applySettingsLocaleToDom({ refreshDynamic: true });
      _refreshEditorPromptsForLocaleChange();
    });
    boundEventListeners.add('settings-locale-sync');
  }

  applySettingsLocaleToDom({ refreshDynamic: false });
}

/**
 * 动态生成 ReAct 可编辑的 Function 卡片
 */
function _getReactDefaultFunctionGroups() {
  if (typeof aiService === 'undefined') {
    return { resident: [] };
  }

  if (typeof aiService.getDefaultFunctionDeclarationGroups === 'function') {
    const groups = aiService.getDefaultFunctionDeclarationGroups() || {};
    return {
      resident: Array.isArray(groups.resident) ? groups.resident : [],
    };
  }

  return {
    resident: aiService.getDefaultFunctionDeclarations?.() || [],
  };
}

function _getReactDefaultFunctionDefinitions() {
  const groups = _getReactDefaultFunctionGroups();
  return [...groups.resident];
}

function _isCardGroupDisabled(card) {
  const group = card?.closest('.fn-group');
  return !!group?.classList.contains('fn-group-disabled');
}

function _isCardInUserDisabledGroup(card) {
  const group = card?.closest('.fn-group');
  if (!group || !group.classList.contains('fn-group-disabled')) return false;
  return group.dataset.forcedDisabled !== 'true';
}

function _appendResidentVirtualItem(groupBody, itemData) {
  const copy = _getSettingsCopy();
  const { name, description } = itemData || {};
  const item = document.createElement('div');
  item.className = 'fn-resident-virtual-item readonly';

  const title = document.createElement('div');
  title.className = 'fn-resident-virtual-title';
  title.textContent = name;

  const desc = document.createElement('div');
  desc.className = 'fn-resident-virtual-desc';
  desc.textContent = description;

  item.appendChild(title);
  item.appendChild(desc);

  const hasContentField = Object.prototype.hasOwnProperty.call(itemData || {}, 'content');
  if (hasContentField) {
    const rawContent = typeof itemData.content === 'string' ? itemData.content : '';
    const hasContent = rawContent.trim().length > 0;
    const content = document.createElement('div');
    content.className = 'fn-resident-virtual-content' + (hasContent ? '' : ' is-empty');
    content.textContent = hasContent
      ? rawContent
      : copy.functionEditor.placeholders.noDefaultContent;
    item.appendChild(content);
  }

  groupBody.appendChild(item);
}

function _setFunctionParamsToggleButtonText(button, isEditing) {
  if (!button) return;
  const copy = _getSettingsCopy();
  button.textContent = isEditing
    ? copy.functionEditor.buttons.preview
    : copy.functionEditor.buttons.edit;
}

function _appendCoreWorldMechanicsCard({ groupBody, content = '', expanded = false }) {
  const copy = _getSettingsCopy();
  const card = document.createElement('div');
  card.className = 'fn-card';
  card.dataset.coreModuleId = 'core_world_mechanics';
  card.dataset.nonCallable = 'true';
  card.dataset.groupKey = 'resident';
  if (expanded) card.classList.add('expanded');

  const header = document.createElement('div');
  header.className = 'fn-card-header';

  const chevron = _createDisclosureChevron('fn-card-chevron');

  const title = document.createElement('span');
  title.className = 'fn-card-title';
  title.textContent = 'core_world_mechanics';

  const badge = document.createElement('span');
  badge.className = 'fn-core-mechanics-badge';
  badge.textContent = copy.functionEditor.coreBadge;

  header.appendChild(chevron);
  header.appendChild(title);
  header.appendChild(badge);

  const body = document.createElement('div');
  body.className = 'fn-card-body';

  const bodyInner = document.createElement('div');
  bodyInner.className = 'fn-card-body-inner';

  const nameLabel = document.createElement('div');
  nameLabel.className = 'fn-field-label';
  nameLabel.textContent = copy.functionEditor.fields.name;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'fn-name-input fn-core-readonly-input';
  nameInput.value = 'core_world_mechanics';
  nameInput.spellcheck = false;
  nameInput.disabled = true;

  const descLabel = document.createElement('div');
  descLabel.className = 'fn-field-label';
  descLabel.textContent = copy.functionEditor.fields.description;
  const descTextarea = document.createElement('textarea');
  descTextarea.className = 'fn-desc-textarea fn-core-readonly-input';
  descTextarea.value = copy.functionEditor.placeholders.coreDescription;
  descTextarea.rows = 2;
  descTextarea.spellcheck = false;
  descTextarea.disabled = true;

  const paramsWrapper = document.createElement('div');
  paramsWrapper.className = 'fn-params-wrapper';
  const paramsLabel = document.createElement('div');
  paramsLabel.className = 'fn-field-label';
  paramsLabel.textContent = copy.functionEditor.fields.parameters;
  const paramsPreview = document.createElement('div');
  paramsPreview.className = 'fn-params-content fn-core-readonly-input';
  paramsPreview.textContent = _formatParameters({ type: 'object', properties: {} });
  paramsWrapper.appendChild(paramsLabel);
  paramsWrapper.appendChild(paramsPreview);

  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'fn-content-wrapper';
  const contentLabel = document.createElement('div');
  contentLabel.className = 'fn-field-label';
  contentLabel.textContent = copy.functionEditor.fields.content;
  const contentTextarea = document.createElement('textarea');
  contentTextarea.className = 'fn-content-textarea fn-core-world-mechanics-textarea';
  contentTextarea.value = typeof content === 'string' ? content : '';
  contentTextarea.spellcheck = false;
  contentTextarea.placeholder = copy.functionEditor.placeholders.coreContent;
  contentWrapper.appendChild(contentLabel);
  contentWrapper.appendChild(contentTextarea);

  bodyInner.appendChild(nameLabel);
  bodyInner.appendChild(nameInput);
  bodyInner.appendChild(descLabel);
  bodyInner.appendChild(descTextarea);
  bodyInner.appendChild(paramsWrapper);
  bodyInner.appendChild(contentWrapper);
  body.appendChild(bodyInner);

  card.appendChild(header);
  card.appendChild(body);
  groupBody.appendChild(card);

  header.addEventListener('click', () => {
    if (_isCardGroupDisabled(card)) return;
    card.classList.toggle('expanded');
  });
}

function _appendDefaultFunctionCard({
  groupBody,
  fn,
  config,
  overrides,
  deletedSet,
  paramOverrides,
  groupKey,
  readOnly = false,
  expanded = false,
}) {
  const copy = _getSettingsCopy();
  const isDeleted = deletedSet.has(fn.name);
  const ov = overrides[fn.name] || {};
  const currentName = ov.name || fn.name;
  const currentDesc = ov.description || fn.description;
  const currentParams = paramOverrides[fn.name] || fn.parameters;

  // --- Card wrapper ---
  const card = document.createElement('div');
  card.className = 'fn-card' + (isDeleted ? ' fn-card-deleted' : '');
  card.dataset.defaultName = fn.name;
  card.dataset.groupKey = groupKey;
  if (expanded && !isDeleted && !readOnly) card.classList.add('expanded');

  // --- Header (always visible, toggles body) ---
  const header = document.createElement('div');
  header.className = 'fn-card-header';

  const chevron = _createDisclosureChevron('fn-card-chevron');

  const title = document.createElement('span');
  title.className = 'fn-card-title';
  title.textContent = currentName;

  // 启用/禁用 toggle
  const toggleWrapper = document.createElement('label');
  toggleWrapper.className = 'fn-tab-strip fn-tab-strip-mini';
  toggleWrapper.addEventListener('click', e => e.stopPropagation());

  const toggleInput = document.createElement('input');
  toggleInput.type = 'checkbox';
  toggleInput.checked = !isDeleted;
  toggleInput.disabled = readOnly;
  toggleInput.addEventListener('change', () => {
    if (readOnly) return;
    const disabled = !toggleInput.checked;
    card.classList.toggle('fn-card-deleted', disabled);
    if (disabled) card.classList.remove('expanded');
  });

  const toggleSlider = document.createElement('span');
  toggleSlider.className = 'fn-';

  toggleWrapper.appendChild(toggleInput);
  toggleWrapper.appendChild(toggleSlider);

  header.appendChild(chevron);
  header.appendChild(title);
  header.appendChild(toggleWrapper);

  // --- Body (expandable) ---
  const body = document.createElement('div');
  body.className = 'fn-card-body';

  const bodyInner = document.createElement('div');
  bodyInner.className = 'fn-card-body-inner';

  // Field: Name
  const nameLabel = document.createElement('div');
  nameLabel.className = 'fn-field-label';
  nameLabel.textContent = copy.functionEditor.fields.name;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'fn-name-input';
  nameInput.value = currentName;
  nameInput.spellcheck = false;
  nameInput.placeholder = copy.functionEditor.placeholders.defaultName;
  nameInput.disabled = readOnly;
  nameInput.addEventListener('input', () => {
    title.textContent = nameInput.value || fn.name;
    const v = nameInput.value.trim();
    nameInput.classList.toggle('fn-name-invalid', v.length > 0 && !_isValidFunctionName(v));
  });

  // Field: Description
  const descLabel = document.createElement('div');
  descLabel.className = 'fn-field-label';
  descLabel.textContent = copy.functionEditor.fields.description;
  const descTextarea = document.createElement('textarea');
  descTextarea.className = 'fn-desc-textarea';
  descTextarea.value = currentDesc;
  descTextarea.spellcheck = false;
  descTextarea.rows = 1;
  descTextarea.disabled = readOnly;

  // Field: Parameters (editable JSON with preview/edit toggle)
  const paramsWrapper = document.createElement('div');
  paramsWrapper.className = 'fn-params-wrapper';

  const paramsHeader = document.createElement('div');
  paramsHeader.className = 'fn-params-header';

  const paramsLabel = document.createElement('div');
  paramsLabel.className = 'fn-field-label';
  paramsLabel.textContent = copy.functionEditor.fields.parameters;

  const paramsActions = document.createElement('div');
  paramsActions.className = 'fn-params-actions';

  const paramsEditBtn = document.createElement('button');
  paramsEditBtn.type = 'button';
  paramsEditBtn.className = 'btn-ghost';
    paramsEditBtn.dataset.action = 'fn-params-toggle-btn';
  _setFunctionParamsToggleButtonText(paramsEditBtn, false);
  paramsEditBtn.disabled = readOnly;

  const paramsResetBtn = document.createElement('button');
  paramsResetBtn.type = 'button';
  paramsResetBtn.className = 'btn-secondary';
    paramsResetBtn.dataset.action = 'fn-params-reset-btn';
  paramsResetBtn.innerHTML = `<span class="material-symbols-outlined">restart_alt</span><span>${copy.functionEditor.buttons.reset}</span>`;
  paramsResetBtn.style.display = 'none';
  paramsResetBtn.disabled = readOnly;

  paramsActions.appendChild(paramsEditBtn);
  paramsActions.appendChild(paramsResetBtn);

  paramsHeader.appendChild(paramsLabel);
  paramsHeader.appendChild(paramsActions);

  const paramsPreview = document.createElement('div');
  paramsPreview.className = 'fn-params-content';
  paramsPreview.textContent = _formatParameters(currentParams);

  const paramsTextarea = document.createElement('textarea');
  paramsTextarea.className = 'fn-params-textarea';
  paramsTextarea.value = JSON.stringify(currentParams, null, 2);
  paramsTextarea.style.display = 'none';
  paramsTextarea.spellcheck = false;
  paramsTextarea.disabled = readOnly;

  paramsEditBtn.addEventListener('click', () => {
    if (readOnly) return;
    const isEditing = paramsTextarea.style.display === 'none';
    paramsPreview.style.display = isEditing ? 'none' : '';
    paramsTextarea.style.display = isEditing ? '' : 'none';
    paramsResetBtn.style.display = isEditing ? '' : 'none';
    _setFunctionParamsToggleButtonText(paramsEditBtn, isEditing);
    if (!isEditing) {
      // 切回预览时校验并更新
      try {
        const parsed = JSON.parse(paramsTextarea.value);
        paramsPreview.textContent = _formatParameters(parsed);
        paramsTextarea.classList.remove('fn-params-invalid');
      } catch (e) {
        paramsTextarea.classList.add('fn-params-invalid');
      }
    }
  });

  paramsResetBtn.addEventListener('click', () => {
    if (readOnly) return;
    paramsTextarea.value = JSON.stringify(fn.parameters, null, 2);
    paramsPreview.textContent = _formatParameters(fn.parameters);
    paramsTextarea.classList.remove('fn-params-invalid');
  });

  paramsWrapper.appendChild(paramsHeader);
  paramsWrapper.appendChild(paramsPreview);
  paramsWrapper.appendChild(paramsTextarea);

  // Field: Data Source (read-only)
  const dataSourceWrapper = document.createElement('div');
  dataSourceWrapper.className = 'fn-data-source-wrapper';
  if (fn.data_source) {
    const dataSourceLabel = document.createElement('div');
    dataSourceLabel.className = 'fn-field-label';
    dataSourceLabel.textContent = copy.functionEditor.fields.dataSource;
    const dataSourceText = document.createElement('span');
    dataSourceText.className = 'fn-data-source';
    dataSourceText.textContent = fn.data_source;
    dataSourceWrapper.appendChild(dataSourceLabel);
    dataSourceWrapper.appendChild(dataSourceText);
  }

  // Field: Content
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'fn-content-wrapper';

  const contentHeader = document.createElement('div');
  contentHeader.className = 'fn-content-header';

  const contentLabel = document.createElement('div');
  contentLabel.className = 'fn-field-label';
  contentLabel.textContent = copy.functionEditor.fields.content;

  const resetContentBtn = document.createElement('button');
  resetContentBtn.type = 'button';
  resetContentBtn.className = 'btn-secondary';
    resetContentBtn.dataset.action = 'fn-content-reset-btn';
  resetContentBtn.innerHTML = `<span class="material-symbols-outlined">restart_alt</span><span>${copy.functionEditor.buttons.reset}</span>`;
  resetContentBtn.dataset.functionName = fn.name;
  resetContentBtn.disabled = readOnly;

  contentHeader.appendChild(contentLabel);
  contentHeader.appendChild(resetContentBtn);

  const contentTextarea = document.createElement('textarea');
  contentTextarea.className = 'fn-content-textarea';
  contentTextarea.value = config.customFunctionContents?.[fn.name] || '';
  contentTextarea.spellcheck = false;
  contentTextarea.disabled = readOnly;

  if (typeof archiveService !== 'undefined') {
    const defaultContent = archiveService.getDefaultContent(fn.name);
    contentTextarea.placeholder =
      defaultContent || copy.functionEditor.placeholders.noDefaultContent;
  } else {
    contentTextarea.placeholder = copy.functionEditor.placeholders.loading;
  }

  contentWrapper.appendChild(contentHeader);
  contentWrapper.appendChild(contentTextarea);

  // Assemble body
  bodyInner.appendChild(nameLabel);
  bodyInner.appendChild(nameInput);
  bodyInner.appendChild(descLabel);
  bodyInner.appendChild(descTextarea);
  bodyInner.appendChild(_buildToolMetadataSection(fn.name));
  bodyInner.appendChild(paramsWrapper);
  if (fn.data_source) bodyInner.appendChild(dataSourceWrapper);
  bodyInner.appendChild(contentWrapper);
  body.appendChild(bodyInner);

  resetContentBtn.addEventListener('click', () => _resetFunctionContent(fn.name, contentTextarea));

  // Assemble card
  card.appendChild(header);
  card.appendChild(body);
  groupBody.appendChild(card);

  // --- Toggle expand/collapse ---
  header.addEventListener('click', () => {
    if (readOnly || card.classList.contains('fn-card-deleted') || _isCardGroupDisabled(card))
      return;
    const isExpanded = card.classList.toggle('expanded');
    if (isExpanded) {
      descTextarea.style.height = 'auto';
      descTextarea.style.height = descTextarea.scrollHeight + 'px';
    }
  });

  descTextarea.addEventListener('input', () => {
    descTextarea.style.height = 'auto';
    descTextarea.style.height = descTextarea.scrollHeight + 'px';
  });
}

function _populateReactFunctions(config, uiState = null) {
  const copy = _getSettingsCopy();
  const container = document.getElementById('react-fn-list');
  if (!container || typeof aiService === 'undefined') return;
  container.innerHTML = '';

  const groups = _getReactDefaultFunctionGroups();
  const overrides = config.customFunctionOverrides || {};
  const deletedSet = new Set(config.deletedFunctions || []);
  const paramOverrides = config.customParameterOverrides || {};
  const disableResidentFunctions = config.disableResidentFunctions === true;
  const coreWorldMechanicsBase = window.worldMeta?.getRuleModule?.('core_world_mechanics');
  const coreWorldMechanicsContent =
    typeof uiState?.coreWorldMechanicsContent === 'string'
      ? uiState.coreWorldMechanicsContent
      : typeof coreWorldMechanicsBase === 'string'
        ? coreWorldMechanicsBase
        : '';

  const groupSpecs = [
    {
      key: 'resident',
      title: copy.functionEditor.groupTitle,
      functions: groups.resident,
      disabled: disableResidentFunctions,
      forcedDisabled: false,
      toggleId: 'fn-resident-group-toggle',
    },
  ];

  groupSpecs.forEach(spec => {
    const residentVirtualItems = [];

    const group = document.createElement('div');
    group.className = 'fn-group' + (spec.disabled ? ' fn-group-disabled' : '');
    group.id = `fn-group-${spec.key}`;
    group.dataset.groupKey = spec.key;
    group.dataset.forcedDisabled = spec.forcedDisabled ? 'true' : 'false';

    const groupHeader = document.createElement('div');
    groupHeader.className = 'fn-group-header';

    const groupChevron = _createDisclosureChevron('fn-group-chevron');

    const groupTitle = document.createElement('span');
    groupTitle.className = 'fn-group-title';
    groupTitle.textContent = spec.title;

    const groupCount = document.createElement('span');
    groupCount.className = 'fn-group-count';
    groupCount.textContent =
      spec.functions.length + residentVirtualItems.length + (spec.key === 'resident' ? 1 : 0);

    const groupToggleWrapper = document.createElement('label');
    groupToggleWrapper.className = 'fn-tab-strip';
    groupToggleWrapper.addEventListener('click', e => e.stopPropagation());

    const groupToggleInput = document.createElement('input');
    groupToggleInput.type = 'checkbox';
    groupToggleInput.checked = !spec.disabled;
    groupToggleInput.id = spec.toggleId;
    groupToggleInput.dataset.forcedDisabled = spec.forcedDisabled ? 'true' : 'false';
    groupToggleInput.disabled = spec.forcedDisabled;
    groupToggleInput.addEventListener('change', () => {
      if (spec.forcedDisabled) return;
      const disabled = !groupToggleInput.checked;
      group.classList.toggle('fn-group-disabled', disabled);
      if (disabled) group.classList.remove('fn-group-expanded');
    });

    const groupToggleSlider = document.createElement('span');
    groupToggleSlider.className = 'fn-';

    groupToggleWrapper.appendChild(groupToggleInput);
    groupToggleWrapper.appendChild(groupToggleSlider);

    groupHeader.appendChild(groupChevron);
    groupHeader.appendChild(groupTitle);
    groupHeader.appendChild(groupCount);
    groupHeader.appendChild(groupToggleWrapper);

    groupHeader.addEventListener('click', () => {
      if (group.classList.contains('fn-group-disabled')) return;
      group.classList.toggle('fn-group-expanded');
    });

    const groupBody = document.createElement('div');
    groupBody.className = 'fn-group-body';

    group.appendChild(groupHeader);
    group.appendChild(groupBody);
    container.appendChild(group);

    const shouldExpandGroup =
      uiState?.expandedGroupKeys instanceof Set
        ? uiState.expandedGroupKeys.has(spec.key)
        : !spec.disabled;
    if (!spec.disabled && shouldExpandGroup) {
      group.classList.add('fn-group-expanded');
    }

    spec.functions.forEach(fn => {
      _appendDefaultFunctionCard({
        groupBody,
        fn,
        config,
        overrides,
        deletedSet,
        paramOverrides,
        groupKey: spec.key,
        readOnly: spec.forcedDisabled,
        expanded:
          uiState?.expandedDefaultNames instanceof Set
            ? uiState.expandedDefaultNames.has(fn.name)
            : false,
      });
    });
    if (spec.key === 'resident') {
      _appendCoreWorldMechanicsCard({
        groupBody,
        content: coreWorldMechanicsContent,
        expanded: Boolean(uiState?.expandedCoreWorldMechanics),
      });
    }
    residentVirtualItems.forEach(item => _appendResidentVirtualItem(groupBody, item));
  });

  // === 渲染自定义 function 卡片（折叠组外面） ===
  const customs = config.customFunctions || [];
  customs.forEach(cf => {
    _appendCustomFunctionCard(container, cf, null, {
      expanded:
        uiState?.expandedCustomIds instanceof Set ? uiState.expandedCustomIds.has(cf.id) : false,
    });
  });

  // === 新增 Function 按键 ===
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'btn-primary';
  addBtn.textContent = copy.functionEditor.buttons.add;
  addBtn.addEventListener('click', () => {
    const newFn = {
      id: 'custom_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: '',
      description: '',
      content: '',
      parameters: '{\n  "type": "object",\n  "properties": {}\n}',
    };
    _appendCustomFunctionCard(container, newFn, addBtn);
  });
  container.appendChild(addBtn);
}

/**
 * 生成自定义 function 卡片
 */
function _appendCustomFunctionCard(container, cf, insertBefore, options = {}) {
  const copy = _getSettingsCopy();
  const card = document.createElement('div');
  card.className = 'fn-card fn-card-custom';
  card.dataset.customId = cf.id;
  if (options.expanded) card.classList.add('expanded');

  // Header
  const header = document.createElement('div');
  header.className = 'fn-card-header';

  const chevron = _createDisclosureChevron('fn-card-chevron');

  const title = document.createElement('span');
  title.className = 'fn-card-title fn-card-title-custom';
  title.textContent = cf.name || copy.functionEditor.custom.newTitle;

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'material-symbols-outlined btn-icon btn-sm btn-danger';
  deleteBtn.dataset.action = 'fn-btn-danger';
  deleteBtn.textContent = 'delete';
  deleteBtn.title = copy.functionEditor.custom.deleteTitle;
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    card.remove();
  });

  header.appendChild(chevron);
  header.appendChild(title);
  header.appendChild(deleteBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'fn-card-body';

  const bodyInner = document.createElement('div');
  bodyInner.className = 'fn-card-body-inner';

  // Field: Name
  const nameLabel = document.createElement('div');
  nameLabel.className = 'fn-field-label';
  nameLabel.textContent = copy.functionEditor.fields.name;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'fn-name-input';
  nameInput.value = cf.name;
  nameInput.placeholder = copy.functionEditor.placeholders.customName;
  nameInput.spellcheck = false;
  nameInput.addEventListener('input', () => {
    title.textContent = nameInput.value || copy.functionEditor.custom.newTitle;
    const v = nameInput.value.trim();
    nameInput.classList.toggle('fn-name-invalid', v.length > 0 && !_isValidFunctionName(v));
  });

  // Field: Description
  const descLabel = document.createElement('div');
  descLabel.className = 'fn-field-label';
  descLabel.textContent = copy.functionEditor.fields.description;
  const descTextarea = document.createElement('textarea');
  descTextarea.className = 'fn-desc-textarea';
  descTextarea.value = cf.description;
  descTextarea.placeholder = copy.functionEditor.placeholders.customDescription;
  descTextarea.spellcheck = false;
  descTextarea.rows = 2;

  // Field: Parameters (editable JSON)
  const paramsWrapper = document.createElement('div');
  paramsWrapper.className = 'fn-params-wrapper';

  const paramsHeader = document.createElement('div');
  paramsHeader.className = 'fn-params-header';

  const paramsLabel = document.createElement('div');
  paramsLabel.className = 'fn-field-label';
  paramsLabel.textContent = copy.functionEditor.fields.parameters;

  paramsHeader.appendChild(paramsLabel);

  // 解析已有参数（字符串或对象）
  let paramsStr = '{\n  "type": "object",\n  "properties": {}\n}';
  if (cf.parameters) {
    paramsStr =
      typeof cf.parameters === 'string' ? cf.parameters : JSON.stringify(cf.parameters, null, 2);
  }

  const paramsTextarea = document.createElement('textarea');
  paramsTextarea.className = 'fn-params-textarea';
  paramsTextarea.value = paramsStr;
  paramsTextarea.spellcheck = false;
  paramsTextarea.placeholder = copy.functionEditor.placeholders.parameters;

  paramsWrapper.appendChild(paramsHeader);
  paramsWrapper.appendChild(paramsTextarea);

  // Field: Content
  const contentWrapper = document.createElement('div');
  contentWrapper.className = 'fn-content-wrapper';

  const contentLabel = document.createElement('div');
  contentLabel.className = 'fn-field-label';
  contentLabel.textContent = copy.functionEditor.fields.content;

  const contentTextarea = document.createElement('textarea');
  contentTextarea.className = 'fn-content-textarea';
  contentTextarea.value = cf.content;
  contentTextarea.placeholder = copy.functionEditor.placeholders.customContent;
  contentTextarea.spellcheck = false;

  contentWrapper.appendChild(contentLabel);
  contentWrapper.appendChild(contentTextarea);

  // Assemble body
  bodyInner.appendChild(nameLabel);
  bodyInner.appendChild(nameInput);
  bodyInner.appendChild(descLabel);
  bodyInner.appendChild(descTextarea);
  bodyInner.appendChild(_buildToolMetadataSection(cf.name || ''));
  bodyInner.appendChild(paramsWrapper);
  bodyInner.appendChild(contentWrapper);
  body.appendChild(bodyInner);

  card.appendChild(header);
  card.appendChild(body);

  if (insertBefore) {
    container.insertBefore(card, insertBefore);
  } else {
    container.appendChild(card);
  }

  // Toggle expand/collapse
  header.addEventListener('click', () => {
    const isExpanded = card.classList.toggle('expanded');
    if (isExpanded) {
      descTextarea.style.height = 'auto';
      descTextarea.style.height = descTextarea.scrollHeight + 'px';
    }
  });

  descTextarea.addEventListener('input', () => {
    descTextarea.style.height = 'auto';
    descTextarea.style.height = descTextarea.scrollHeight + 'px';
  });
}

// ============================================
// 自定义 System Prompt 列表（多条 + role 选择）
// ============================================

function _getCustomPromptCopy() {
  const copy = _getSettingsCopy();
  return copy?.custom?.systemPrompt || {};
}

function _renderCustomSystemPromptList(config) {
  const container = document.getElementById('custom-system-prompt-list');
  if (!container) return;
  container.innerHTML = '';
  const list = Array.isArray(config?.customSystemPrompts) ? config.customSystemPrompts : [];
  // 初始渲染就分组：system 在前，user 在后；组内保持原顺序（稳定排序）
  const systemItems = list.filter(it => (it?.role || 'system') !== 'user');
  const userItems = list.filter(it => it?.role === 'user');
  [...systemItems, ...userItems].forEach(item => _appendCustomSystemPromptCard(container, item));
  _updatePromptCardArrowStates(container);
}

/**
 * 把容器内的 prompt 卡片重新排序：所有 data-role!='user' 在前，data-role='user' 在后
 * 组内保持当前 DOM 相对顺序（稳定）。仅做 DOM 顺序调整，不触发数据迁移
 */
function _regroupCustomPromptCards(container) {
  if (!container) return;
  const cards = [...container.querySelectorAll('.fn-card-prompt')];
  if (cards.length === 0) return;
  const systemCards = cards.filter(c => c.dataset.role !== 'user');
  const userCards = cards.filter(c => c.dataset.role === 'user');
  [...systemCards, ...userCards].forEach(card => container.appendChild(card));
  _updatePromptCardArrowStates(container);
}

/**
 * 把卡片在它所在 role 组内 上移 / 下移 一位。跨组移动用 role tab 切换实现。
 */
function _movePromptCard(card, direction) {
  if (!card) return;
  const container = card.parentNode;
  if (!container) return;
  const role = card.dataset.role;
  const sameRoleSiblings = [...container.querySelectorAll('.fn-card-prompt')]
    .filter(c => c.dataset.role === role);
  const idx = sameRoleSiblings.indexOf(card);
  if (idx < 0) return;
  if (direction === 'up' && idx > 0) {
    container.insertBefore(card, sameRoleSiblings[idx - 1]);
  } else if (direction === 'down' && idx < sameRoleSiblings.length - 1) {
    const next = sameRoleSiblings[idx + 1];
    if (next.nextSibling) container.insertBefore(card, next.nextSibling);
    else container.appendChild(card);
  }
  _updatePromptCardArrowStates(container);
}

/**
 * 根据每张卡在所在 role 组内的位置刷新 ↑↓ 按钮 disabled 状态。
 * 顶部组员的 ↑ 灰、底部组员的 ↓ 灰，单条直接全灰。
 */
function _updatePromptCardArrowStates(container) {
  if (!container) return;
  const cards = [...container.querySelectorAll('.fn-card-prompt')];
  cards.forEach(card => {
    const role = card.dataset.role;
    const sameRoleSiblings = cards.filter(c => c.dataset.role === role);
    const idx = sameRoleSiblings.indexOf(card);
    const upBtn = card.querySelector('.fn-card-move-up');
    const downBtn = card.querySelector('.fn-card-move-down');
    if (upBtn) upBtn.disabled = idx <= 0;
    if (downBtn) downBtn.disabled = idx >= sameRoleSiblings.length - 1;
  });
}

function _appendCustomSystemPromptCard(container, item, insertBefore = null, options = {}) {
  if (!container || !item) return;
  const cpsCopy = _getCustomPromptCopy();
  const card = document.createElement('div');
  card.className = 'fn-card fn-card-prompt';
  card.dataset.promptId = item.id || ('cp_' + Date.now());
  card.dataset.role = item.role === 'user' ? 'user' : 'system';
  const initialEnabled = item.enabled !== false; // 默认启用，老存档没 enabled 字段也视为启用
  if (!initialEnabled) card.classList.add('is-disabled');
  if (options.expanded) card.classList.add('expanded');

  // Header
  const header = document.createElement('div');
  header.className = 'fn-card-header';

  // 启用复选框（粘了 prompt 暂时不想用时可以勾掉）
  const enableLabel = document.createElement('label');
  enableLabel.className = 'fn-card-enable';
  enableLabel.title = cpsCopy.enableTitle || '启用';
  const enableCheckbox = document.createElement('input');
  enableCheckbox.type = 'checkbox';
  enableCheckbox.className = 'fn-card-enable-checkbox';
  enableCheckbox.checked = initialEnabled;
  enableCheckbox.setAttribute('aria-label', cpsCopy.enableTitle || '启用');
  enableLabel.appendChild(enableCheckbox);
  // 点 checkbox 不触发卡片折叠
  enableLabel.addEventListener('click', e => e.stopPropagation());
  enableCheckbox.addEventListener('change', () => {
    card.classList.toggle('is-disabled', !enableCheckbox.checked);
    updateTitle();
  });

  // 上移 / 下移 按钮（替代拖拽，桌面 + 触屏都好用）
  const moveControls = document.createElement('div');
  moveControls.className = 'fn-card-move-controls';

  const upBtn = document.createElement('button');
  upBtn.type = 'button';
  upBtn.className = 'fn-card-move-btn fn-card-move-up';
  upBtn.title = cpsCopy.moveUpTitle || '上移';
  upBtn.setAttribute('aria-label', cpsCopy.moveUpTitle || '上移');
  const upIcon = document.createElement('span');
  upIcon.className = 'material-symbols-outlined';
  upIcon.textContent = 'keyboard_arrow_up';
  upBtn.appendChild(upIcon);
  upBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (upBtn.disabled) return;
    _movePromptCard(card, 'up');
  });

  const downBtn = document.createElement('button');
  downBtn.type = 'button';
  downBtn.className = 'fn-card-move-btn fn-card-move-down';
  downBtn.title = cpsCopy.moveDownTitle || '下移';
  downBtn.setAttribute('aria-label', cpsCopy.moveDownTitle || '下移');
  const downIcon = document.createElement('span');
  downIcon.className = 'material-symbols-outlined';
  downIcon.textContent = 'keyboard_arrow_down';
  downBtn.appendChild(downIcon);
  downBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (downBtn.disabled) return;
    _movePromptCard(card, 'down');
  });

  moveControls.appendChild(upBtn);
  moveControls.appendChild(downBtn);

  const chevron = _createDisclosureChevron('fn-card-chevron');

  const title = document.createElement('span');
  title.className = 'fn-card-title fn-card-title-custom';

  // 右侧按钮组：编辑/保存 + 删除
  const actions = document.createElement('div');
  actions.className = 'fn-card-actions';

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn-ghost btn-sm fn-card-action-btn';
  const editIcon = document.createElement('span');
  editIcon.className = 'material-symbols-outlined';
  editIcon.textContent = 'edit';
  const editLabel = document.createElement('span');
  editLabel.className = 'fn-card-action-label';
  editLabel.textContent = cpsCopy.editLabel || '编辑';
  editBtn.appendChild(editIcon);
  editBtn.appendChild(editLabel);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn-danger btn-sm fn-card-action-btn';
  const deleteIcon = document.createElement('span');
  deleteIcon.className = 'material-symbols-outlined';
  deleteIcon.textContent = 'delete';
  const deleteLabel = document.createElement('span');
  deleteLabel.className = 'fn-card-action-label';
  deleteLabel.textContent = cpsCopy.deleteLabel || '删除';
  deleteBtn.appendChild(deleteIcon);
  deleteBtn.appendChild(deleteLabel);
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    const parent = card.parentNode;
    card.remove();
    if (parent) _updatePromptCardArrowStates(parent);
  });

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  header.appendChild(enableLabel);
  header.appendChild(moveControls);
  header.appendChild(chevron);
  header.appendChild(title);
  header.appendChild(actions);

  // Body
  const body = document.createElement('div');
  body.className = 'fn-card-body';
  const bodyInner = document.createElement('div');
  bodyInner.className = 'fn-card-body-inner';

  // Role field —— 标签 + tab-strip 同一行
  const roleRow = document.createElement('div');
  roleRow.className = 'fn-role-row';
  const roleLabel = document.createElement('span');
  roleLabel.className = 'fn-field-label fn-role-inline-label';
  roleLabel.textContent = (cpsCopy.roleLabel || '角色') + '：';
  const roleTabStrip = document.createElement('div');
  roleTabStrip.className = 'tab-strip fn-role-tabs';
  roleTabStrip.setAttribute('role', 'tablist');
  const userTab = document.createElement('button');
  userTab.type = 'button';
  userTab.className = 'tab';
  userTab.dataset.role = 'user';
  userTab.setAttribute('role', 'tab');
  userTab.textContent = cpsCopy.roleUser || 'user（伪历史）';
  const systemTab = document.createElement('button');
  systemTab.type = 'button';
  systemTab.className = 'tab';
  systemTab.dataset.role = 'system';
  systemTab.setAttribute('role', 'tab');
  systemTab.textContent = (cpsCopy.roleSystem || 'system') + (cpsCopy.roleSystemDefaultSuffix || '（默认）');
  roleTabStrip.appendChild(userTab);
  roleTabStrip.appendChild(systemTab);
  roleRow.appendChild(roleLabel);
  roleRow.appendChild(roleTabStrip);

  // 当前 role state 用 dataset 存（替代原 select.value）
  const initialRole = item.role === 'user' ? 'user' : 'system';
  roleTabStrip.dataset.activeRole = initialRole;
  const syncRoleTabs = () => {
    const active = roleTabStrip.dataset.activeRole;
    userTab.classList.toggle('is-active', active === 'user');
    userTab.setAttribute('aria-selected', active === 'user' ? 'true' : 'false');
    systemTab.classList.toggle('is-active', active === 'system');
    systemTab.setAttribute('aria-selected', active === 'system' ? 'true' : 'false');
  };
  syncRoleTabs();
  userTab.addEventListener('click', () => {
    if (userTab.disabled) return;
    roleTabStrip.dataset.activeRole = 'user';
    card.dataset.role = 'user';
    syncRoleTabs();
    updateTitle();
    // 切换 role 时把卡片挪到容器末尾，regroup 后即落在新组的底部
    container.appendChild(card);
    _regroupCustomPromptCards(container);
  });
  systemTab.addEventListener('click', () => {
    if (systemTab.disabled) return;
    roleTabStrip.dataset.activeRole = 'system';
    card.dataset.role = 'system';
    syncRoleTabs();
    updateTitle();
    container.appendChild(card);
    _regroupCustomPromptCards(container);
  });

  // Content field
  const contentLabel = document.createElement('div');
  contentLabel.className = 'fn-field-label';
  contentLabel.textContent = cpsCopy.contentLabel || '内容';
  const contentTextarea = document.createElement('textarea');
  contentTextarea.className = 'fn-content-textarea';
  contentTextarea.value = item.content || '';
  contentTextarea.placeholder = cpsCopy.placeholder || '例如：回复时使用更加诗意的语言风格...';
  contentTextarea.spellcheck = false;
  contentTextarea.rows = 4;

  // 编辑/保存 切换：默认 readonly + role tabs disabled；点 edit 后可改，再点变 save
  const setEditMode = (editing) => {
    card.classList.toggle('is-editing', editing);
    contentTextarea.readOnly = !editing;
    userTab.disabled = !editing;
    systemTab.disabled = !editing;
    editIcon.textContent = editing ? 'save' : 'edit';
    editLabel.textContent = editing
      ? (cpsCopy.saveLabel || '保存')
      : (cpsCopy.editLabel || '编辑');
  };
  setEditMode(options.editing === true);

  editBtn.addEventListener('click', e => {
    e.stopPropagation();
    const nextEditing = contentTextarea.readOnly; // 当前 readonly → 进入编辑
    if (nextEditing) {
      if (!card.classList.contains('expanded')) {
        card.classList.add('expanded');
      }
      setEditMode(true);
      contentTextarea.focus();
    } else {
      setEditMode(false);
    }
  });

  const updateTitle = () => {
    const activeRole = roleTabStrip.dataset.activeRole === 'user' ? 'user' : 'system';
    const roleText = activeRole === 'user'
      ? (cpsCopy.roleUser || 'user')
      : (cpsCopy.roleSystem || 'system');
    const preview = (contentTextarea.value || '').trim().slice(0, 20)
      || (cpsCopy.emptyPreview || '(空)');
    const disabledMark = enableCheckbox.checked ? '' : ` · ${cpsCopy.disabledLabel || '已禁用'}`;
    title.textContent = `[${roleText}] ${preview}${disabledMark}`;
  };
  contentTextarea.addEventListener('input', updateTitle);
  updateTitle();

  bodyInner.appendChild(roleRow);
  bodyInner.appendChild(contentLabel);
  bodyInner.appendChild(contentTextarea);
  body.appendChild(bodyInner);

  card.appendChild(header);
  card.appendChild(body);

  if (insertBefore) {
    container.insertBefore(card, insertBefore);
  } else {
    container.appendChild(card);
  }

  header.addEventListener('click', e => {
    // 点 actions 区域内的按钮不触发折叠切换
    if (e.target.closest('.fn-card-actions')) return;
    // 编辑中点头部 = 退出编辑 + 折叠（值已在 textarea 内存里，全局保存按钮负责持久化）
    if (card.classList.contains('is-editing')) {
      setEditMode(false);
    }
    card.classList.toggle('expanded');
  });
}

function _collectCustomSystemPrompts() {
  const container = document.getElementById('custom-system-prompt-list');
  if (!container) return [];
  const out = [];
  container.querySelectorAll('.fn-card-prompt').forEach(card => {
    const contentEl = card.querySelector('.fn-content-textarea');
    const tabStrip = card.querySelector('.fn-role-tabs');
    const enabledEl = card.querySelector('.fn-card-enable-checkbox');
    const content = (contentEl?.value || '').trim();
    if (!content) return;
    const role = tabStrip?.dataset.activeRole === 'user' ? 'user' : 'system';
    const enabled = enabledEl ? enabledEl.checked !== false : true;
    const id = card.dataset.promptId
      || ('cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
    out.push({ id, role, content, enabled });
  });
  return out;
}

/**
 * 构建工具元数据展示块（phase / required / trigger / triggerHint / signal）
 * 从 window.toolRegistry.getDisplayMetadata() 读取；未注册的工具返回全 "—"
 */
function _buildToolMetadataSection(toolName) {
  const wrapper = document.createElement('div');
  wrapper.className = 'fn-card-metadata';

  const meta = window.toolRegistry?.getDisplayMetadata?.(toolName) || null;

  const dash = '—';
  const fmt = {
    phase: meta?.phase || dash,
    required: meta?.required === true ? 'true' : meta ? 'false' : dash,
    trigger: typeof meta?.trigger === 'function' ? '(条件谓词)' : dash,
    triggerHint: meta?.triggerHint || dash,
    signal: meta?.signal || dash,
  };

  const rows = [
    ['Phase', fmt.phase],
    ['Required', fmt.required],
    ['Trigger', fmt.trigger],
    ['Trigger Hint', fmt.triggerHint],
    ['Signal', fmt.signal],
  ];

  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.className = 'fn-meta-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'fn-meta-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'fn-meta-value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    wrapper.appendChild(row);
  }

  return wrapper;
}

/**
 * 格式化 parameters 为可读文本
 */
function _formatParameters(params) {
  const copy = _getSettingsCopy();
  if (!params || !params.properties || Object.keys(params.properties).length === 0) {
    return copy.functionEditor.placeholders.noParameters;
  }
  const required = params.required || [];
  const lines = [];
  for (const [name, prop] of Object.entries(params.properties)) {
    const req = required.includes(name) ? copy.functionEditor.placeholders.requiredSuffix : '';
    let typeStr = prop.type;
    if (prop.items?.type) typeStr += `<${prop.items.type}>`;
    lines.push(`${name}: ${typeStr}${req}`);
    if (prop.enum) lines.push(`  enum: [${prop.enum.join(', ')}]`);
    if (prop.items?.enum) lines.push(`  enum: [${prop.items.enum.join(', ')}]`);
    if (prop.description) {
      // 截取描述前 80 字符
      const desc =
        prop.description.length > 80 ? prop.description.substring(0, 80) + '…' : prop.description;
      lines.push(`  ${desc}`);
    }
  }
  return lines.join('\n');
}

// ============================================
// Step 3 Schema Editor - 可视化编辑 JSON Schema
// ============================================

function _resizeTextareaByContent(ta) {
  if (!ta) return;
  const minHeight = parseFloat(window.getComputedStyle(ta).minHeight) || 28;
  ta.style.height = 'auto';
  ta.style.height = Math.max(ta.scrollHeight, minHeight) + 'px';
}

/** textarea 自适应高度：根据内容自动扩展 */
function _autoResizeTextarea(ta) {
  if (!ta) return;
  ta.style.overflow = 'hidden';
  ta.style.resize = 'none';
  if (ta.dataset.autoResizeBound === '1') {
    _resizeTextareaByContent(ta);
    return;
  }

  const resize = () => _resizeTextareaByContent(ta);
  ta.addEventListener('input', resize);
  ta.dataset.autoResizeBound = '1';

  // 用 IntersectionObserver 在元素可见时触发初始 resize（解决折叠容器内 scrollHeight=0 的问题）
  if (typeof IntersectionObserver === 'function') {
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        resize();
        observer.disconnect();
      }
    });
    requestAnimationFrame(() => observer.observe(ta));
  } else {
    requestAnimationFrame(resize);
  }
}

function _initCustomTabTextareaAutoResize() {
  document
    .querySelectorAll('#tab-prompts .prompt-module-textarea')
    .forEach(ta => _autoResizeTextarea(ta));
}

function _refreshCustomTabTextareaHeights() {
  document
    .querySelectorAll('#tab-prompts .prompt-module-textarea')
    .forEach(ta => _resizeTextareaByContent(ta));
}

/**
 * 重置单个function的内容
 */
function _resetFunctionContent(functionName, contentTextarea) {
  const copy = _getSettingsCopy();
  if (typeof window.showConfirmModal !== 'function') return;
  window.showConfirmModal(
    copy.functionEditor.confirm.resetFunctionTitle,
    copy.functionEditor.confirm.resetFunctionBody(functionName),
    () => {
      contentTextarea.value = '';
    }
  );
}

function _collectCoreWorldMechanicsDraft() {
  const textarea = document.querySelector(
    '#react-fn-list .fn-card[data-core-module-id="core_world_mechanics"] .fn-content-textarea'
  );
  if (!textarea) return null;
  const raw = typeof textarea.value === 'string' ? textarea.value : '';
  return raw.trim().length > 0 ? raw : '';
}

/**
 * 收集 ReAct Function 覆写（与默认值对比，只保存差异）
 * @returns {Object|null} 覆写对象，无差异时返回 null
 */
function _collectReactFunctionOverrides() {
  const container = document.getElementById('react-fn-list');
  if (!container || typeof aiService === 'undefined') return null;

  const defaults = _getReactDefaultFunctionDefinitions();
  const defaultMap = {};
  defaults.forEach(fn => {
    defaultMap[fn.name] = fn;
  });

  const overrides = {};
  const cards = container.querySelectorAll('.fn-card[data-default-name]');
  let hasOverride = false;

  cards.forEach(card => {
    if (card.classList.contains('fn-card-deleted')) return;
    if (_isCardInUserDisabledGroup(card)) return;
    const defaultName = card.dataset.defaultName;
    const nameInput = card.querySelector('.fn-name-input');
    const descTextarea = card.querySelector('.fn-desc-textarea');
    if (!defaultName || !nameInput || !descTextarea) return;

    const def = defaultMap[defaultName];
    if (!def) return;

    const newName = nameInput.value.trim();
    const newDesc = descTextarea.value.trim();
    const defaultDesc = (typeof def.description === 'string' ? def.description : '').trim();

    // 只有当有变化时才记录覆写
    if (newName !== def.name || newDesc !== defaultDesc) {
      overrides[defaultName] = {};
      if (newName !== def.name) overrides[defaultName].name = newName;
      if (newDesc !== defaultDesc) overrides[defaultName].description = newDesc;
      hasOverride = true;
    }
  });

  return hasOverride ? overrides : null;
}

/**
 * 收集 ReAct Function 自定义内容
 * @returns {Object|null} 自定义内容对象，无自定义时返回 null
 */
function _collectReactFunctionContents() {
  const container = document.getElementById('react-fn-list');
  if (!container || typeof aiService === 'undefined') return null;

  const contents = {};
  let hasContent = false;

  container.querySelectorAll('.fn-card[data-default-name]').forEach(card => {
    if (card.classList.contains('fn-card-deleted')) return;
    if (_isCardInUserDisabledGroup(card)) return;

    const contentTextarea = card.querySelector('.fn-content-textarea');
    const customContent = contentTextarea?.value?.trim();
    const defaultName = card.dataset.defaultName;
    if (!defaultName) return;

    // 只保存非空的自定义内容
    if (customContent && customContent.length > 0) {
      contents[defaultName] = customContent;
      hasContent = true;
    }
  });

  return hasContent ? contents : null;
}

/**
 * 收集已删除的默认 function 名称
 * @returns {Array|null}
 */
function _collectDeletedFunctions() {
  const container = document.getElementById('react-fn-list');
  if (!container) return null;
  const deleted = [];
  container.querySelectorAll('.fn-card.fn-card-deleted[data-default-name]').forEach(card => {
    if (_isCardInUserDisabledGroup(card)) return;
    deleted.push(card.dataset.defaultName);
  });
  return deleted.length > 0 ? deleted : null;
}

/**
 * 收集用户自定义 function
 * @returns {Array|null}
 */
function _collectCustomFunctions() {
  const container = document.getElementById('react-fn-list');
  if (!container) return null;
  const customs = [];
  container.querySelectorAll('.fn-card-custom').forEach(card => {
    const name = card.querySelector('.fn-name-input')?.value?.trim();
    if (!name) return;
    // 收集 parameters JSON
    let parameters = null;
    const paramsTextarea = card.querySelector('.fn-params-textarea');
    if (paramsTextarea) {
      const paramsValue = paramsTextarea.value.trim();
      if (paramsValue) {
        try {
          parameters = JSON.parse(paramsValue);
        } catch (e) {
          // 保存原始字符串，校验时会报错
          parameters = paramsValue;
        }
      }
    }
    customs.push({
      id: card.dataset.customId,
      name: name,
      description: card.querySelector('.fn-desc-textarea')?.value?.trim() || '',
      content: card.querySelector('.fn-content-textarea')?.value?.trim() || '',
      parameters: parameters,
    });
  });
  return customs.length > 0 ? customs : null;
}

/**
 * 收集默认 function 的参数覆写（与默认值对比，只保存差异）
 * @returns {Object|null}
 */
function _collectParameterOverrides() {
  const container = document.getElementById('react-fn-list');
  if (!container || typeof aiService === 'undefined') return null;

  const defaults = _getReactDefaultFunctionDefinitions();
  const defaultMap = {};
  defaults.forEach(fn => {
    defaultMap[fn.name] = fn;
  });

  const overrides = {};
  let hasOverride = false;

  container.querySelectorAll('.fn-card[data-default-name]').forEach(card => {
    if (card.classList.contains('fn-card-deleted')) return;
    if (_isCardInUserDisabledGroup(card)) return;
    const defaultName = card.dataset.defaultName;
    const paramsTextarea = card.querySelector('.fn-params-textarea');
    if (!paramsTextarea) return;

    const def = defaultMap[defaultName];
    if (!def) return;

    try {
      const edited = JSON.parse(paramsTextarea.value);
      const original = JSON.stringify(def.parameters);
      if (JSON.stringify(edited) !== original) {
        overrides[defaultName] = edited;
        hasOverride = true;
      }
    } catch (e) {
      // 无效 JSON，跳过（保存时校验会捕获）
    }
  });

  return hasOverride ? overrides : null;
}

/**
 * 读取当前配置中的 ReAct 分组开关
 * @returns {{disableResidentFunctions: boolean}}
 */
function _getCurrentReactGroupDisableState() {
  const config = aiService?.config || {};
  return {
    disableResidentFunctions: config.disableResidentFunctions === true,
  };
}

function _collectDisableResidentFunctions() {
  const toggle = document.getElementById('fn-resident-group-toggle');
  if (!toggle) {
    return _getCurrentReactGroupDisableState().disableResidentFunctions;
  }
  if (toggle.dataset.forcedDisabled === 'true') {
    return _getCurrentReactGroupDisableState().disableResidentFunctions;
  }
  return !toggle.checked;
}

function _getVisibleSettingsTabs() {
  const tabs = Array.from(
    document.querySelectorAll('#settings-modal .settings-tabs .tab')
  );
  return tabs.filter(tab => {
    const style = window.getComputedStyle(tab);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
}

function _syncSettingsTabsSlider(tabId = currentSettingsTab, animate = true) {
  const tabsWrap = document.querySelector('#settings-modal .settings-tabs');
  const slider = tabsWrap?.querySelector('.settings-tabs-slider');
  if (!tabsWrap || !slider) return;

  const visibleTabs = _getVisibleSettingsTabs();
  if (!visibleTabs.length) return;

  const targetTab =
    visibleTabs.find(tab => tab.dataset.tab === tabId) ||
    visibleTabs.find(tab => tab.classList.contains('is-active')) ||
    visibleTabs[0];
  if (!targetTab) return;

  const wrapRect = tabsWrap.getBoundingClientRect();
  const tabRect = targetTab.getBoundingClientRect();
  const left = Math.max(0, tabRect.left - wrapRect.left);
  const width = Math.max(0, tabRect.width);

  if (!animate) {
    slider.style.transition = 'none';
  }
  slider.style.width = `${width}px`;
  slider.style.transform = `translateX(${left}px)`;

  if (!animate) {
    requestAnimationFrame(() => {
      slider.style.transition = '';
    });
  }
}

function _syncSettingsModalHeight() {
  const modal = document.getElementById('settings-modal');
  const modalContent = modal?.querySelector('.settings-modal-wide');
  if (!modal || !modalContent || modal.classList.contains('hidden')) return;
  modalContent.style.height = window.matchMedia('(max-width: 640px)').matches ? '100dvh' : '85vh';
}

/**
 * 切换设置标签页
 */
function switchSettingsTab(tabId) {
  if (!tabId) return;
  currentSettingsTab = tabId;

  // 更新按键激活状态：仅设置头部 tab，不影响 form 内部 toggle/thinking 等其他 .tab
  document
    .querySelectorAll('#settings-modal .settings-tabs .tab[data-tab]')
    .forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.tab === tabId);
    });

  // 更新内容显示：限定 settings-modal 范围
  document.querySelectorAll('#settings-modal .tab-panel').forEach(content => {
    content.classList.toggle('is-active', content.id === `tab-${tabId}`);
  });

  _syncSettingsTabsSlider(tabId, true);

  if (tabId === 'prompts') {
    requestAnimationFrame(() => _refreshCustomTabTextareaHeights());
  }
}

function _hasSettingsTab(tabId) {
  if (!tabId) return false;
  const tabBtn = document.querySelector(`#settings-modal .tab[data-tab="${tabId}"]`);
  const tabContent = document.getElementById(`tab-${tabId}`);
  return !!tabBtn && !!tabContent;
}

function switchSettingsTabSafe(preferredTabs = ['basic']) {
  const candidates = Array.isArray(preferredTabs) ? preferredTabs : [preferredTabs];
  const target =
    candidates.find(tabId => _hasSettingsTab(tabId)) ||
    _getVisibleSettingsTabs()[0]?.dataset?.tab ||
    'basic';
  switchSettingsTab(target);
}

// 初始化标签页事件绑定（只执行一次）
let settingsTabsInitialized = false;
let settingsTabsResizeBound = false;

function initializeSettingsTabs() {
  if (settingsTabsInitialized) return;

  // 绑定标签页点击事件（仅顶部 settings-tabs 里、带 data-tab 的）
  document
    .querySelectorAll('#settings-modal .settings-tabs .tab[data-tab]')
    .forEach(tab => {
      tab.addEventListener('click', () => switchSettingsTab(tab.dataset.tab));
    });

  if (!settingsTabsResizeBound) {
    window.addEventListener('resize', () => {
      _syncSettingsTabsSlider(currentSettingsTab, false);
      _syncSettingsModalHeight();
    });
    settingsTabsResizeBound = true;
  }

  requestAnimationFrame(() => _syncSettingsTabsSlider(currentSettingsTab, false));

  settingsTabsInitialized = true;
}

function _populateThemeSkinOptions(config) {
  const container = document.getElementById('theme-skin-options');
  if (!container) return;
  container.innerHTML = '';

  const copy = _getSettingsCopy();
  const skinNames = copy.general.themeSkinNames || {};
  const skinHints = copy.general.themeSkinHints || {};

  // Read available skins from CSS variable
  const rootStyles = getComputedStyle(document.documentElement);
  const availableRaw = rootStyles.getPropertyValue('--available-skins').replace(/[" ]/g, '');
  const skins = availableRaw ? availableRaw.split(',').filter(Boolean) : ['metro'];

  // Current theme
  const currentSkin = (config && config.themeName) ||
    (window.themeUI && window.themeUI.getThemeName ? window.themeUI.getThemeName() : 'metro');

  // Brand primary colors per skin for the color swatch preview
  const skinColors = {
    metro: '#2d89ef', /* ui-lint-allow */
    cartoon: '#FF8FAB', /* ui-lint-allow */
    cultivation: '#6B8E6B', /* ui-lint-allow */
    cyberpunk: '#00F0FF', /* ui-lint-allow */
    literary: '#2F4A3A', /* ui-lint-allow */
  };

  skins.forEach(skin => {
    const wrap = document.createElement('div');
    wrap.className = 'theme-skin-card-wrap';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme-skin-card' + (skin === currentSkin ? ' is-active' : '');
    card.dataset.skin = skin;

    const swatch = document.createElement('span');
    swatch.className = 'theme-skin-swatch';
    swatch.style.background = skinColors[skin] || 'var(--text-soft)'; // ui-lint-allow

    const label = document.createElement('span');
    label.className = 'theme-skin-label';
    label.textContent = skinNames[skin] || skin;

    card.appendChild(swatch);
    card.appendChild(label);
    wrap.appendChild(card);

    const hintText = skinHints[skin] || '';
    let hintEl = null;
    if (hintText) {
      hintEl = document.createElement('p');
      hintEl.className = 'hint theme-skin-card-hint';
      hintEl.textContent = hintText;
      hintEl.hidden = skin !== currentSkin;
      wrap.appendChild(hintEl);
    }

    card.addEventListener('click', (e) => {
      container.querySelectorAll('.theme-skin-card').forEach(c => c.classList.remove('is-active'));
      card.classList.add('is-active');
      container.querySelectorAll('.theme-skin-card-hint').forEach(h => { h.hidden = true; });
      if (hintEl) hintEl.hidden = false;
      if (window.themeUI && typeof window.themeUI.setThemeName === 'function') {
        window.themeUI.setThemeName(skin, { origin: { x: e.clientX, y: e.clientY } });
      } else {
        document.documentElement.setAttribute('data-skin', skin);
      }
      // Cyberpunk reads best in dark mode, cultivation in light — auto-flip
      // on activation. Parchment bg-mode locks light, so skip the dark flip
      // there; the light flip is consistent with parchment so no guard needed.
      if (skin === 'cyberpunk' &&
          settingsDraftBgMode !== 'parchment' &&
          _getCurrentThemeModeForSettings() !== 'dark') {
        _applyThemeModeInstant('dark', { x: e.clientX, y: e.clientY });
      } else if (skin === 'cultivation' &&
          _getCurrentThemeModeForSettings() !== 'light') {
        _applyThemeModeInstant('light', { x: e.clientX, y: e.clientY });
      } else if (skin === 'literary' &&
          _getCurrentThemeModeForSettings() !== 'light') {
        _applyThemeModeInstant('light', { x: e.clientX, y: e.clientY });
      }
    });

    container.appendChild(wrap);
  });
}

// ============================================
// 页面背景模式（bg-mode）
// ============================================

const BG_MODE_ORDER = ['solid', 'parchment', 'world-card', 'custom'];
const BG_MODE_KEY_MAP = { solid: 'solid', parchment: 'parchment', 'world-card': 'worldCard', custom: 'custom' };
const BG_CUSTOM_MAX_BYTES = 10 * 1024 * 1024;

function _populateBgModeOptions() {
  const container = document.getElementById('bg-mode-options');
  if (!container) return;
  container.innerHTML = '';

  const copy = _getSettingsCopy();
  const bgCopy = copy.general.bgMode;
  const currentMode = settingsDraftBgMode || 'solid';

  BG_MODE_ORDER.forEach(mode => {
    const keyName = BG_MODE_KEY_MAP[mode];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'bg-mode-card' + (mode === currentMode ? ' is-active' : '');
    if (mode === 'world-card') card.classList.add('is-disabled');
    card.dataset.bgMode = mode;

    const inner = document.createElement('span');
    inner.className = 'bg-mode-card-inner';

    const label = document.createElement('span');
    label.className = 'bg-mode-label';
    label.textContent = bgCopy.options[keyName] || mode;

    const hint = document.createElement('span');
    hint.className = 'bg-mode-hint';
    hint.textContent = bgCopy.descriptions[keyName] || '';

    inner.appendChild(label);
    inner.appendChild(hint);
    card.appendChild(inner);

    if (mode !== 'world-card') {
      card.addEventListener('click', () => _onBgModeCardClick(mode));
    } else {
      card.setAttribute('aria-disabled', 'true');
    }

    container.appendChild(card);
  });

  _bindBgCustomControlsOnce();
  _syncBgCustomActionsVisibility();
}

function _setBgCardActive(mode) {
  document.querySelectorAll('#bg-mode-options .bg-mode-card').forEach(el => {
    el.classList.toggle('is-active', el.dataset.bgMode === mode);
  });
}

async function _onBgModeCardClick(mode) {
  if (mode === 'world-card') return;
  if (mode === 'custom') {
    const hasExisting = !settingsPendingBgClear && (
      !!settingsPendingBgBlob ||
      !!(await _hasStoredBgBlob())
    );
    if (!hasExisting) {
      // 没有任何可用图片 → 触发选择
      document.getElementById('bg-mode-custom-file')?.click();
      return;
    }
  }
  settingsDraftBgMode = mode;
  _setBgCardActive(mode);
  _applyBgModeLivePreview();
  _syncBgCustomActionsVisibility();
  _syncParchmentLock();
}

async function _hasStoredBgBlob() {
  if (!window.backgroundImageStore?.get) return false;
  try {
    const blob = await window.backgroundImageStore.get();
    return !!blob;
  } catch (_) {
    return false;
  }
}

async function _applyBgModeLivePreview() {
  if (!window.themeUI?.applyBgMode) return;
  const mode = settingsDraftBgMode || 'solid';
  if (mode === 'custom') {
    // 确保 --custom-bg-url 已加载（来自 pending blob 或 stored blob）
    await _ensureCustomBgUrl();
    window.themeUI.applyBgMode('custom', { custom: settingsDraftBgCustom });
  } else {
    window.themeUI.applyBgMode(mode);
  }
}

async function _ensureCustomBgUrl() {
  if (settingsBgCustomObjectUrl) {
    window.themeUI?.setBgCustomUrl?.(settingsBgCustomObjectUrl);
    return;
  }
  let blob = settingsPendingBgBlob;
  if (!blob && !settingsPendingBgClear && window.backgroundImageStore?.get) {
    try { blob = await window.backgroundImageStore.get(); } catch (_) { blob = null; }
  }
  if (!blob) {
    window.themeUI?.setBgCustomUrl?.(null);
    return;
  }
  settingsBgCustomObjectUrl = URL.createObjectURL(blob);
  window.themeUI?.setBgCustomUrl?.(settingsBgCustomObjectUrl);
  window.themeUI?._loadCustomBgImageSize?.(settingsBgCustomObjectUrl);
}

function _syncBgCustomActionsVisibility() {
  const actions = document.getElementById('bg-mode-custom-actions');
  if (!actions) return;
  actions.hidden = settingsDraftBgMode !== 'custom';
}

function _syncParchmentLock() {
  const btn = document.getElementById('settings-theme-toggle-btn');
  if (!btn) return;
  const copy = _getSettingsCopy();
  const isParchment = settingsDraftBgMode === 'parchment';
  btn.disabled = isParchment;
  btn.classList.toggle('is-locked', isParchment);
  if (isParchment) {
    btn.setAttribute('title', copy.general.bgMode.parchmentLockTip);
    // 强制切到浅色
    if (_getCurrentThemeModeForSettings() !== 'light') {
      _applyThemeModeInstant('light');
    }
  } else {
    // 恢复原 title（由 _syncSettingsThemeToggleIcon 重置）
    _syncSettingsThemeToggleIcon(_getCurrentThemeModeForSettings());
  }
}

let _bgCustomControlsBound = false;
function _bindBgCustomControlsOnce() {
  if (_bgCustomControlsBound) return;
  _bgCustomControlsBound = true;

  const fileInput = document.getElementById('bg-mode-custom-file');
  const editBtn = document.getElementById('bg-mode-custom-edit-btn');
  const replaceBtn = document.getElementById('bg-mode-custom-replace-btn');
  const clearBtn = document.getElementById('bg-mode-custom-clear-btn');

  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await _handleBgCustomFileSelect(file);
    });
  }
  if (editBtn) {
    editBtn.addEventListener('click', () => _openBgEditor());
  }
  if (replaceBtn) {
    replaceBtn.addEventListener('click', () => fileInput?.click());
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', () => _clearBgCustom());
  }
}

async function _handleBgCustomFileSelect(file) {
  const copy = _getSettingsCopy();
  if (!file.type || !file.type.startsWith('image/')) {
    showToast(copy.general.bgMode.uploadNotImage);
    return;
  }
  if (file.size > BG_CUSTOM_MAX_BYTES) {
    showToast(copy.general.bgMode.uploadTooLarge);
    return;
  }
  settingsPendingBgBlob = file;
  settingsPendingBgClear = false;
  if (settingsBgCustomObjectUrl) {
    URL.revokeObjectURL(settingsBgCustomObjectUrl);
    settingsBgCustomObjectUrl = null;
  }
  settingsBgCustomObjectUrl = URL.createObjectURL(file);
  window.themeUI?.setBgCustomUrl?.(settingsBgCustomObjectUrl);
  // 触发图片尺寸测量（用于 cover-aware 计算）
  window.themeUI?._loadCustomBgImageSize?.(settingsBgCustomObjectUrl);
  // 重置位置/缩放为默认
  settingsDraftBgCustom = { positionX: 50, positionY: 50, scale: 100 };
  settingsDraftBgMode = 'custom';
  _setBgCardActive('custom');
  window.themeUI?.applyBgMode?.('custom', { custom: settingsDraftBgCustom });
  _syncBgCustomActionsVisibility();
  _syncParchmentLock();
  _openBgEditor();
}

function _clearBgCustom() {
  settingsPendingBgBlob = null;
  settingsPendingBgClear = true;
  if (settingsBgCustomObjectUrl) {
    URL.revokeObjectURL(settingsBgCustomObjectUrl);
    settingsBgCustomObjectUrl = null;
  }
  window.themeUI?.setBgCustomUrl?.(null);
  // 回退到 solid
  settingsDraftBgMode = 'solid';
  _setBgCardActive('solid');
  window.themeUI?.applyBgMode?.('solid');
  _syncBgCustomActionsVisibility();
  _syncParchmentLock();
}

// ── 背景图编辑器 ──────────────────────────────
let _bgEditorBound = false;
let _bgEditorState = null; // { dragStart, baseBgCustom, baseForRollback }

function _openBgEditor() {
  const modal = document.getElementById('bg-editor-modal');
  const preview = document.getElementById('bg-editor-preview');
  const scaleRange = document.getElementById('bg-editor-scale');
  const scaleValueLabel = document.getElementById('bg-editor-scale-value');
  if (!modal || !preview || !scaleRange) return;

  _ensureCustomBgUrl();
  _bindBgEditorOnce();

  // 保存回滚快照
  _bgEditorState = {
    baseForRollback: { ...settingsDraftBgCustom },
    dragStart: null,
  };

  // 初始化控件
  scaleRange.value = String(settingsDraftBgCustom.scale);
  scaleValueLabel.textContent = `${settingsDraftBgCustom.scale}%`;
  _renderBgEditorPreview();

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function _closeBgEditor(confirm) {
  const modal = document.getElementById('bg-editor-modal');
  if (!modal) return;
  if (!confirm && _bgEditorState?.baseForRollback) {
    settingsDraftBgCustom = { ..._bgEditorState.baseForRollback };
    window.themeUI?.setBgCustomTransform?.(settingsDraftBgCustom);
  }
  _bgEditorState = null;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function _renderBgEditorPreview() {
  const preview = document.getElementById('bg-editor-preview');
  if (!preview) return;
  const url = settingsBgCustomObjectUrl || window.themeUI?._persistentCustomBgUrl || null;
  preview.style.backgroundImage = url ? `url("${url}")` : 'none'; // ui-lint-allow
  preview.style.backgroundPosition = `${settingsDraftBgCustom.positionX}% ${settingsDraftBgCustom.positionY}%`; // ui-lint-allow
  preview.style.backgroundRepeat = 'no-repeat'; // ui-lint-allow
  // 同步预览框尺寸为视口比例
  const viewportRatio = window.innerWidth / Math.max(1, window.innerHeight);
  preview.style.aspectRatio = String(viewportRatio.toFixed(3));
  // Cover-aware background-size：根据图片/预览比率选 `W% auto` 或 `auto H%`
  const rect = preview.getBoundingClientRect();
  const previewRatio = rect.width / Math.max(1, rect.height);
  const imageSize = window.themeUI?.getCustomBgImageSize?.();
  if (imageSize && imageSize.width && imageSize.height) {
    const imageRatio = imageSize.width / imageSize.height;
    preview.style.backgroundSize = imageRatio < previewRatio // ui-lint-allow
      ? `${settingsDraftBgCustom.scale}% auto`
      : `auto ${settingsDraftBgCustom.scale}%`;
  } else {
    preview.style.backgroundSize = `${settingsDraftBgCustom.scale}%`; // ui-lint-allow
  }
}

function _bindBgEditorOnce() {
  if (_bgEditorBound) return;
  _bgEditorBound = true;

  const preview = document.getElementById('bg-editor-preview');
  const scaleRange = document.getElementById('bg-editor-scale');
  const scaleValueLabel = document.getElementById('bg-editor-scale-value');
  const cancelBtn = document.getElementById('bg-editor-cancel-btn');
  const confirmBtn = document.getElementById('bg-editor-confirm-btn');
  const modal = document.getElementById('bg-editor-modal');

  if (scaleRange) {
    scaleRange.addEventListener('input', () => {
      const v = Math.min(300, Math.max(100, Number(scaleRange.value) || 100));
      settingsDraftBgCustom.scale = v;
      if (scaleValueLabel) scaleValueLabel.textContent = `${v}%`;
      _renderBgEditorPreview();
      window.themeUI?.setBgCustomTransform?.(settingsDraftBgCustom);
    });
  }

  if (preview) {
    const onPointerMove = (e) => {
      if (!_bgEditorState?.dragStart) return;
      const { startX, startY, basePosX, basePosY, width, height } = _bgEditorState.dragStart;
      const scale = settingsDraftBgCustom.scale / 100;
      // Cover-aware: 图片以「cover 基线 x scale」呈现，溢出量 = scaledDim - containerDim
      const imgSize = window.themeUI?.getCustomBgImageSize?.();
      let scaledW, scaledH;
      if (imgSize && imgSize.width && imgSize.height) {
        const coverBase = Math.max(width / imgSize.width, height / imgSize.height);
        scaledW = imgSize.width * coverBase * scale;
        scaledH = imgSize.height * coverBase * scale;
      } else {
        // 拿不到图片尺寸 → 退回到 width-fit 近似
        scaledW = width * scale;
        scaledH = height * scale;
      }
      const extraW = Math.max(0, scaledW - width);
      const extraH = Math.max(0, scaledH - height);
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newX = basePosX;
      let newY = basePosY;
      if (extraW > 0.5) {
        newX = Math.min(100, Math.max(0, basePosX - (dx / extraW) * 100));
      }
      if (extraH > 0.5) {
        newY = Math.min(100, Math.max(0, basePosY - (dy / extraH) * 100));
      }
      settingsDraftBgCustom.positionX = newX;
      settingsDraftBgCustom.positionY = newY;
      _renderBgEditorPreview();
      window.themeUI?.setBgCustomTransform?.(settingsDraftBgCustom);
    };
    const onPointerUp = () => {
      if (_bgEditorState) _bgEditorState.dragStart = null;
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };
    preview.addEventListener('pointerdown', (e) => {
      if (!_bgEditorState) return;
      const rect = preview.getBoundingClientRect();
      _bgEditorState.dragStart = {
        startX: e.clientX,
        startY: e.clientY,
        basePosX: settingsDraftBgCustom.positionX,
        basePosY: settingsDraftBgCustom.positionY,
        width: rect.width,
        height: rect.height,
      };
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp, { once: true });
    });
  }

  if (cancelBtn) cancelBtn.addEventListener('click', () => _closeBgEditor(false));
  if (confirmBtn) confirmBtn.addEventListener('click', () => _closeBgEditor(true));
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) _closeBgEditor(false);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _bgEditorState) {
      e.stopPropagation();
      _closeBgEditor(false);
    }
  });
  window.addEventListener('resize', () => {
    if (_bgEditorState) _renderBgEditorPreview();
  });
  window.addEventListener('custom-bg-image-size-loaded', () => {
    if (_bgEditorState) _renderBgEditorPreview();
  });
}

function openSettings(preferredTab = 'basic') {
  // 初始化标签页事件（如果尚未初始化）
  initializeSettingsTabs();

  // 初始化本次设置会话的草稿
  _beginSettingsDraftSession(aiService.getConfig());

  // 重新加载配置到 UI
  setupSettingsUI();
  applySettingsLocaleToDom({ refreshDynamic: false });
  _populateFeedbackContextFields();
  _updateFeedbackDebugMeta();

  // 切到目标标签页
  switchSettingsTabSafe([preferredTab, 'basic']);

  const modal = document.getElementById('settings-modal');
  const modalContent = modal.querySelector('.settings-modal-wide');
  modalContent.style.height = '';

  modal.classList.remove('hidden');
  _syncSettingsModalHeight();
  requestAnimationFrame(() => _syncSettingsTabsSlider(currentSettingsTab, false));

  try {
    window.analyticsService?.trackOnce?.('funnel.settings_opened', { tab: preferredTab }, 'funnel.settings_opened');
  } catch (_) { /* ignore */ }
}

// 页面加载完成后初始化标签页事件
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeSettingsTabs);
} else {
  // DOM已经加载完成
  queueMicrotask(initializeSettingsTabs);
}

function closeSettings(shouldRollback = true) {
  closeFeedbackModal({ restoreFocus: false });

  if (shouldRollback && settingsInitialThemeMode) {
    if (window.themeUI && typeof window.themeUI.applyThemeMode === 'function') {
      window.themeUI.applyThemeMode(settingsInitialThemeMode);
    }
    _syncSettingsThemeToggleIcon(settingsInitialThemeMode);
  }
  if (shouldRollback && settingsInitialThemeSkin) {
    if (window.themeUI && typeof window.themeUI.setThemeName === 'function') {
      window.themeUI.setThemeName(settingsInitialThemeSkin);
    }
  }
  if (shouldRollback && settingsInitialUiLanguage) {
    if (window.i18nService && typeof window.i18nService.setUiLanguage === 'function') {
      window.i18nService.setUiLanguage(settingsInitialUiLanguage);
    }
    _syncSettingsLanguageToggleButton();
  }
  if (shouldRollback && settingsInitialUiScaleMode) {
    if (window.themeUI && typeof window.themeUI.applyUIScaleSettings === 'function') {
      window.themeUI.applyUIScaleSettings({
        mode: settingsInitialUiScaleMode,
        scale: settingsInitialUiScale,
      });
    }
    _syncUIScaleControls(settingsInitialUiScaleMode, settingsInitialUiScale);
  }
  if (shouldRollback && settingsInitialBgMode && window.themeUI?.applyBgMode) {
    window.themeUI.applyBgMode(settingsInitialBgMode, { custom: settingsInitialBgCustom });
    if (settingsInitialBgMode === 'custom') {
      // 原本是 custom 模式 → 让 themeUI 重建 persistent URL（会 revoke 任何临时 URL）
      window.themeUI._reloadPersistentCustomBgFromIDB?.();
    } else {
      // 切出 custom 模式 → themeUI 也清掉 persistent URL（顺便 revoke）
      window.themeUI.adoptCustomBgUrl?.(null);
    }
    const themeBtn = document.getElementById('settings-theme-toggle-btn');
    if (themeBtn && settingsInitialBgMode !== 'parchment') {
      themeBtn.disabled = false;
      themeBtn.classList.remove('is-locked');
    }
  }

  _clearSettingsDraftSession();

  const modal = document.getElementById('settings-modal');
  const modalContent = modal.querySelector('.settings-modal-wide');
  if (modalContent) {
    modalContent.style.height = '';
  }
  modal.style.zIndex = '';
  modal.classList.add('hidden');
}

/**
 * 扫描所有"看起来打算用的"自定义服务商行（name + baseUrl + key + model 都填了），
 * 返回那些 testBtn.dataset.testResult !== 'pass' 的行的服务商名。
 * 玩家修改 baseUrl/apiKey/model/protocol 时会 invalidate testResult，所以这里读到的是"当前配置下未通过"的行。
 */
function _collectUnverifiedCustomProviderNames() {
  const rows = document.querySelectorAll('.custom-provider-row');
  const result = [];
  rows.forEach(row => {
    const name = row.querySelector('.cp-name')?.value?.trim();
    const baseUrl = row.querySelector('.cp-baseurl')?.value?.trim();
    const apiKeyEl = row.querySelector('.cp-apikey');
    const apiKey = apiKeyEl ? _getApiKeyRealValue(apiKeyEl) : '';
    const model = row.querySelector('.cp-model')?.value?.trim();
    // 任一字段空 → 不是"打算用"的完整配置，跳过（保存逻辑也会过滤）
    if (!name || !baseUrl || !apiKey || !model) return;
    const testBtn = row.querySelector('[data-action~="api-test-btn"]');
    if (testBtn?.dataset.testResult !== 'pass') {
      result.push(name);
    }
  });
  return result;
}

// 用户已经在 modal 里选过"仍然保存" → 重入 saveSettings 时跳过 confirm
let _skipUnverifiedCpSaveConfirm = false;

function saveSettings() {
  const copy = _getSettingsCopy();
  _captureDraftProviderApiKeysFromUI();
  _captureDraftCustomProvidersFromUI();

  // 自定义服务商"未测试就保存"提醒（一次性 confirm，玩家点"仍然保存"才放行）
  if (!_skipUnverifiedCpSaveConfirm) {
    const unverified = _collectUnverifiedCustomProviderNames();
    if (unverified.length > 0 && typeof window.showConfirmModal === 'function') {
      window.showConfirmModal(
        copy.general.provider.unverifiedSaveTitle,
        '',
        () => {
          _skipUnverifiedCpSaveConfirm = true;
          try { saveSettings(); } finally { _skipUnverifiedCpSaveConfirm = false; }
        },
        null,
        {
          icon: 'warning',
          descriptionHtml: copy.general.provider.unverifiedSaveBody(unverified),
          confirmLabel: copy.general.provider.unverifiedSaveConfirm,
          cancelLabel: copy.general.provider.unverifiedSaveCancel,
        }
      );
      return;
    }
  }


  // === Function Name 格式校验 ===
  const fnContainer = document.getElementById('react-fn-list');
  const hasReactFnUI = !!fnContainer;
  if (hasReactFnUI) {
    const allNameInputs = fnContainer.querySelectorAll('.fn-name-input');
    const invalidNames = [];
    allNameInputs.forEach(input => {
      const card = input.closest('.fn-card');
      if (card && card.classList.contains('fn-card-deleted')) return;
      if (card && _isCardGroupDisabled(card)) return;
      if (card && card.dataset.nonCallable === 'true') return;
      const v = input.value.trim();
      if (v && !_isValidFunctionName(v)) {
        invalidNames.push(v);
        input.classList.add('fn-name-invalid');
      } else {
        input.classList.remove('fn-name-invalid');
      }
    });
    if (invalidNames.length > 0) {
      showToast(copy.functionEditor.toast.invalidFunctionName(invalidNames[0]), 'error');
      switchSettingsTabSafe(['react', 'prompts', 'api', 'basic']);
      return;
    }

    // === Parameters JSON 格式校验 ===
    const allParamsTextareas = fnContainer.querySelectorAll('.fn-params-textarea');
    for (const textarea of allParamsTextareas) {
      const card = textarea.closest('.fn-card');
      if (card && card.classList.contains('fn-card-deleted')) continue;
      if (card && _isCardGroupDisabled(card)) continue;
      if (card && card.dataset.nonCallable === 'true') continue;
      const val = textarea.value.trim();
      if (!val) continue;
      try {
        JSON.parse(val);
        textarea.classList.remove('fn-params-invalid');
      } catch (e) {
        textarea.classList.add('fn-params-invalid');
        showToast(copy.functionEditor.toast.invalidParameters(e.message), 'error');
        switchSettingsTabSafe(['react', 'prompts', 'api', 'basic']);
        return;
      }
    }
  }

  // === Custom Provider 模型字段防错 ===
  // 禁止空格（model id 不会有空格），禁止整段是字段标签文本，
  // 触发任一规则就阻止保存、定位 api 标签、给输入框红框。
  const cpRowsForValidation = document.querySelectorAll('.custom-provider-row');
  const labelExactBlocklist = new Set([
    'model', '模型',
    'default model', '默认模型', '默认模型名称',
    'name', '名称',
    'provider name', '服务商名称',
    'url',
  ]);
  for (const row of cpRowsForValidation) {
    const modelInput = row.querySelector('.cp-model');
    if (!modelInput) continue;
    modelInput.classList.remove('cp-model-invalid');
    modelInput.removeAttribute('aria-invalid');
    const v = (modelInput.value || '').trim();
    if (!v) continue;
    let errMsg = null;
    if (/\s/.test(v)) {
      errMsg = copy.general.provider.invalidModelHasSpace;
    } else if (v.length > 100) {
      errMsg = copy.general.provider.invalidModelTooLong;
    } else {
      const lower = v.toLowerCase();
      const looksLikeApiKey =
        lower.includes('api key') ||
        lower.includes('apikey') ||
        lower.includes('api-key') ||
        lower.includes('api 密钥') ||
        lower.includes('密钥');
      if (looksLikeApiKey || labelExactBlocklist.has(lower)) {
        errMsg = copy.general.provider.invalidModelLooksLikeLabel(v);
      }
    }
    if (errMsg) {
      modelInput.classList.add('cp-model-invalid');
      modelInput.setAttribute('aria-invalid', 'true');
      showToast(errMsg, 'error');
      switchSettingsTabSafe(['api', 'basic']);
      return;
    }
  }

  // 收集 API Keys（内置）
  const providerApiKeys = {};
  PROVIDERS.forEach(id => {
    const input = document.getElementById(`api-key-${id}`);
    const realValue = input ? _getApiKeyRealValue(input) : '';
    if (realValue) {
      providerApiKeys[id] = realValue;
    }
  });

  // 收集自定义 Provider 配置（从 UI 中读取最新值，包括 API Key）
  const customProviderRows = document.querySelectorAll('.custom-provider-row');
  const customProviders = [];
  customProviderRows.forEach(row => {
    const id = row.dataset.id;
    const name = row.querySelector('.cp-name')?.value?.trim();
    const baseUrl = row.querySelector('.cp-baseurl')?.value?.trim();
    const defaultModel = row.querySelector('.cp-model')?.value?.trim();
    const protocol = row.querySelector('.cp-protocol')?.value === 'anthropic' ? 'anthropic' : 'openai';
    const cpApiKeyInput = row.querySelector('.cp-apikey');
    const apiKey = cpApiKeyInput ? _getApiKeyRealValue(cpApiKeyInput) : '';
    const maxOutputTokensEnabled = !!row.querySelector('.cp-maxtokens-enabled')?.checked;
    const rawMaxOutputTokens = row.querySelector('.cp-maxtokens-value')?.value?.trim();
    const parsedMaxOutputTokens = parseInt(rawMaxOutputTokens, 10);
    const maxOutputTokens =
      Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0
        ? parsedMaxOutputTokens
        : null;
    if (id && name) {
      customProviders.push({
        id,
        name,
        baseUrl: baseUrl || '',
        defaultModel: defaultModel || '',
        protocol,
        maxOutputTokensEnabled,
        maxOutputTokens,
      });
      // 将自定义 provider 的 API Key 一并收集
      if (apiKey) {
        providerApiKeys[id] = apiKey;
      }
    }
  });

  _alignModuleProviderModelSelections();

  const currentConfig = aiService.getConfig();
  const modelPrices = _deepClone(_getConfigModelPrices(currentConfig));

  // 标准设置模式：将面板的值同步到全部模块的隐藏表单
  if (currentApiSettingsMode === 'simple') {
    const gameProvider =
      document.getElementById('module-provider-game')?.value ||
      _getDefaultProviderForUIModule('game');
    const gameModel = _getResolvedModelValue('game');
    const gameTemp = document.getElementById('module-temp-game')?.value || '1.0';
    const gameThinking = _getThinkingControlValue('game');
    UI_MODULES.forEach(uiModuleId => {
      const providerSel = document.getElementById(`module-provider-${uiModuleId}`);
      const tempInp = document.getElementById(`module-temp-${uiModuleId}`);
      if (providerSel) providerSel.value = gameProvider;
      _syncModelControlForProvider(uiModuleId, gameProvider, gameModel);
      if (tempInp) tempInp.value = gameTemp;
      _setThinkingControlValue(uiModuleId, gameThinking);
      _syncThinkingControlVisibility(uiModuleId, gameProvider);
    });
  }

  // 收集模块配置(从UI模块读取，映射到实际模块)
  const modules = {};
  const temperatureAdjustedModules = [];
  let missingModelForCustom = null;
  UI_MODULES.forEach(uiModuleId => {
    const providerSelect = document.getElementById(`module-provider-${uiModuleId}`);
    const provider = providerSelect?.value || _getDefaultProviderForUIModule(uiModuleId);
    let model = _getResolvedModelValue(uiModuleId);
    const { modelSelect } = _getModelControlElements(uiModuleId);
    const isCustomModel = modelSelect?.value === CUSTOM_MODEL_OPTION_VALUE;

    if (isCustomModel && !model) {
      missingModelForCustom = {
        moduleLabel: uiModuleId === 'summary-chapter' ? 'summary-chapter' : uiModuleId,
        providerLabel: _getProviderDisplayName(provider),
      };
      return;
    }

    // 如果模型为空，使用该服务商的默认模型
    if (!model) {
      const defaultModel = _getProviderDefaultModel(uiModuleId, provider);
      if (defaultModel) {
        model = defaultModel;
        _syncModelControlForProvider(uiModuleId, provider, model);
      } else {
        missingModelForCustom = {
          moduleLabel: uiModuleId === 'summary-chapter' ? 'summary-chapter' : uiModuleId,
          providerLabel: _getProviderDisplayName(provider),
        };
        return;
      }
    }

    // 价格优先使用 modelPrices（provider+model），再回退到预置价格
    const resolvedPrices = _getPriceFromMap(provider, model, { modelPrices });
    const priceIn = resolvedPrices?.in || 0;
    const priceOut = resolvedPrices?.out || 0;

    // 读取 temperature 配置
    const tempInput = document.getElementById(`module-temp-${uiModuleId}`);
    const defaultTemperature = _getDefaultTemperatureForUIModule(uiModuleId, provider);
    const normalizedTempResult = _normalizeTemperatureForUI(tempInput?.value, defaultTemperature);
    const temperature = normalizedTempResult.value;
    if (tempInput) {
      tempInput.value = temperature;
    }
    if (normalizedTempResult.adjusted) {
      temperatureAdjustedModules.push(uiModuleId);
    }

    const thinking = _getThinkingControlValue(uiModuleId);

    // summary-chapter 特殊处理:同时保存到 summary 和 chapter
    if (uiModuleId === 'summary-chapter') {
      modules['summary'] = { provider, model, priceIn, priceOut, temperature, thinking };
      modules['chapter'] = { provider, model, priceIn, priceOut, temperature, thinking };
    } else {
      modules[uiModuleId] = { provider, model, priceIn, priceOut, temperature, thinking };
    }
  });

  if (missingModelForCustom) {
    showToast(
      copy.functionEditor.toast.missingModel(
        missingModelForCustom.moduleLabel,
        missingModelForCustom.providerLabel
      ),
      'error'
    );
    switchSettingsTabSafe(['api', 'prompts', 'basic']);
    return;
  }

  if (temperatureAdjustedModules.length > 0) {
    showToast(copy.functionEditor.toast.temperatureAdjusted(temperatureAdjustedModules));
  }

  // 收集自定义 System Prompt 列表
  const customSystemPrompts = _collectCustomSystemPrompts();

  // 获取 Editor 开场白（Init 模块仅在世界卡编辑，这里保留现有值不覆盖）
  const greetingTextarea = document.getElementById('editor-greeting');
  const greetingValue = greetingTextarea?.value?.trim() || '';

  // 写入当前世界卡的开场白；无激活世界卡时不保存
  const editorPersistResult = _saveEditorPromptsToActiveWorldCard(greetingValue);
  if (!editorPersistResult.ok) {
    showToast(
      copy.functionEditor.toast.saveFailed(
        editorPersistResult.reason ||
          (_getSettingsLocale() === 'en'
            ? 'could not write to the active world card'
            : '无法写入当前世界卡')
      )
    );
    return;
  }
  const hasActiveWorldCard = editorPersistResult.hasActiveWorldCard === true;
  const skippedBuiltInEditorPrompts = editorPersistResult.skippedBuiltIn === true;

  // 收集 core_world_mechanics（通过世界卡修改）
  const coreWorldMechanicsDraft = _collectCoreWorldMechanicsDraft();
  if (coreWorldMechanicsDraft !== null) {
    showToast(copy.functionEditor.toast.coreWorldMechanics);
  }

  let customFunctionOverrides = currentConfig.customFunctionOverrides ?? null;
  let customFunctionContents = currentConfig.customFunctionContents ?? null;
  let deletedFunctions = currentConfig.deletedFunctions ?? null;
  let customFunctions = currentConfig.customFunctions ?? null;
  let customParameterOverrides = currentConfig.customParameterOverrides ?? null;
  let disableResidentFunctions = currentConfig.disableResidentFunctions;

  if (hasReactFnUI) {
    // 收集 ReAct Function 覆写
    customFunctionOverrides = _collectReactFunctionOverrides();

    // 收集 ReAct Function 自定义内容
    customFunctionContents = _collectReactFunctionContents();

    // 收集已删除的 function 和自定义 function
    deletedFunctions = _collectDeletedFunctions();
    customFunctions = _collectCustomFunctions();

    // 收集参数覆写和总开关
    customParameterOverrides = _collectParameterOverrides();
    disableResidentFunctions = _collectDisableResidentFunctions();
  }

  // 保存配置
  // streaming toggle: 推荐模式强制开启 streaming（设计上「只能开/关」不暴露 toggle）；
  // 简单/高级模式各自从对应面板的 toggle 读取。
  const streamingToggleEl =
    currentApiSettingsMode === 'recommended'
      ? null
      : currentApiSettingsMode === 'simple'
        ? document.getElementById('streaming-toggle')
        : document.getElementById('streaming-toggle-adv');
  // 推荐模式 narrativeLength 锁定为 medium；普通模式读 DOM tabs
  const narrativeLength =
    currentApiSettingsMode === 'recommended'
      ? 'medium'
      : (_getActiveNarrativeLength() || 'medium');
  const recentMessageCount = 4;
  const themeMode = _getCurrentThemeModeForSettings();
  const uiLanguage = _getCurrentUiLanguageForSettings();
  const uiScaleMode = _getCurrentUIScaleModeForSettings();
  const uiScale = _getCurrentUIScaleValueForSettings();

  // 羊皮纸模式下强制浅色主题
  const effectiveThemeMode = settingsDraftBgMode === 'parchment' ? 'light' : themeMode;

  // 联网搜索总开关：从置顶 toggle DOM 读取；toggle 可能因 API 设置区不在当前页而不存在，
  // 那种情况下沿用当前 config 的值（避免误清零）
  const webSearchToggleEl = document.getElementById('websearch-toggle');
  const webSearchEnabled = webSearchToggleEl
    ? webSearchToggleEl.checked === true
    : (currentConfig.webSearchEnabled === true);

  const newConfig = {
    providerApiKeys,
    customProviders,
    modelPrices,
    modules,
    apiSettingsMode: currentApiSettingsMode,
    useSummaryContext: true,
    recentMessageCount,
    useStreaming:
      currentApiSettingsMode === 'recommended'
        ? true
        : streamingToggleEl
          ? streamingToggleEl.checked
          : false,
    narrativeLength,
    themeName: document.querySelector('.theme-skin-card.is-active')?.dataset?.skin || ((window.themeUI && window.themeUI.getThemeName) ? window.themeUI.getThemeName() : 'metro'),
    themeMode: effectiveThemeMode,
    uiLanguage,
    uiScaleMode,
    uiScale,
    customSystemPrompts: customSystemPrompts,
    customFunctionOverrides: customFunctionOverrides,
    customFunctionContents: customFunctionContents,
    deletedFunctions: deletedFunctions,
    customFunctions: customFunctions,
    customParameterOverrides: customParameterOverrides,
    disableResidentFunctions: disableResidentFunctions,
    backgroundMode: settingsDraftBgMode || 'solid',
    backgroundCustom: { ...settingsDraftBgCustom },
    webSearchEnabled,
  };

  const normalizedCurrentConfig = _normalizeSettingsConfigForCompare(currentConfig);
  const normalizedNextConfig = _normalizeSettingsConfigForCompare(currentConfig, newConfig);
  const configChanged =
    _stableSerializeSettingsValue(normalizedCurrentConfig) !==
    _stableSerializeSettingsValue(normalizedNextConfig);
  const editorPromptsChanged = editorPersistResult.changed === true;
  const editorPromptChangeRequested = editorPersistResult.requestedChange === true;
  const needsChatRefresh =
    configChanged && _settingsSaveRequiresChatRefresh(normalizedCurrentConfig, normalizedNextConfig);

  if (!configChanged && !editorPromptsChanged) {
    closeSettings(false);
    if (!hasActiveWorldCard && editorPromptChangeRequested) {
      showToast(copy.functionEditor.toast.savedNoWorld);
    } else {
      showToast(copy.functionEditor.toast.saved);
    }
    return;
  }

  _doSaveConfig(newConfig, { needsChatRefresh });

  async function _doSaveConfig(cfg, options = {}) {
    const shouldRefreshChat = options.needsChatRefresh === true;

    try {
      const prev = aiService.getConfig() || {};
      const HARD_EXCLUDE = new Set(['providerApiKeys', 'customProviders']);
      const svc = window.analyticsService;
      const emitChange = (key, fromVal, toVal) => {
        if (!svc?.track) return;
        if (HARD_EXCLUDE.has(key)) {
          svc.track('feature.setting_changed', { key, value_redacted: true });
        } else {
          const safeFrom = (typeof fromVal === 'object') ? null : fromVal;
          const safeTo = (typeof toVal === 'object') ? null : toVal;
          svc.track('feature.setting_changed', { key, from: safeFrom, to: safeTo });
        }
      };
      const scan = (obj, base) => {
        const keys = new Set([...Object.keys(obj || {}), ...Object.keys(base || {})]);
        keys.forEach(k => {
          const a = obj ? obj[k] : undefined;
          const b = base ? base[k] : undefined;
          if (JSON.stringify(a) !== JSON.stringify(b)) emitChange(k, b, a);
        });
      };
      scan(cfg, prev);
      if (cfg.themeName && cfg.themeName !== prev.themeName) {
        svc?.track?.('feature.theme_changed', { from: prev.themeName || null, to: cfg.themeName });
      }
      const newModules = cfg.modules || {};
      const prevModules = prev.modules || {};
      Object.keys(newModules).forEach(mod => {
        const a = newModules[mod] || {};
        const b = prevModules[mod] || {};
        if (a.model !== b.model || a.provider !== b.provider) {
          svc?.track?.('feature.ai_model_selected', {
            module: mod,
            provider: a.provider || null,
            model: a.model || null,
            from_provider: b.provider || null,
            from_model: b.model || null,
          });
        }
      });
    } catch (_) { /* ignore */ }

    aiService.saveConfig(cfg);
    // 持久化自定义背景图 blob（如果有新上传或请求清除）
    if (window.backgroundImageStore) {
      try {
        if (settingsPendingBgClear) {
          await window.backgroundImageStore.clear();
        } else if (settingsPendingBgBlob) {
          await window.backgroundImageStore.put(settingsPendingBgBlob);
        }
      } catch (err) {
        console.warn('[settingsUI] 保存背景图失败:', err);
      }
    }
    if (window.themeUI) {
      if (typeof window.themeUI.setThemeName === 'function' && cfg.themeName) {
        window.themeUI.setThemeName(cfg.themeName);
      }
      if (typeof window.themeUI.applyThemeMode === 'function') {
        window.themeUI.applyThemeMode(cfg.themeMode);
      }
      if (typeof window.themeUI.applyBgMode === 'function') {
        window.themeUI.applyBgMode(cfg.backgroundMode, { custom: cfg.backgroundCustom });
      }
      // 所有权转交：custom 模式时让 themeUI 持有 objectURL；否则清掉 persistent URL
      if (cfg.backgroundMode === 'custom' && settingsBgCustomObjectUrl) {
        window.themeUI.adoptCustomBgUrl?.(settingsBgCustomObjectUrl);
        settingsBgCustomObjectUrl = null;
      } else if (cfg.backgroundMode !== 'custom') {
        window.themeUI.adoptCustomBgUrl?.(null);
      }
    }
    if (window.i18nService && typeof window.i18nService.setUiLanguage === 'function') {
      let prevLang = null;
      try { prevLang = window.i18nService.getResolvedLanguage?.() || null; } catch (_) { /* ignore */ }
      window.i18nService.setUiLanguage(uiLanguage);
      if (uiLanguage && uiLanguage !== prevLang) {
        try { window.analyticsService?.track?.('feature.language_changed', { from: prevLang, to: uiLanguage }); } catch (_) { /* ignore */ }
      }
    }
    if (window.themeUI && typeof window.themeUI.applyUIScaleSettings === 'function') {
      window.themeUI.applyUIScaleSettings({ mode: uiScaleMode, scale: uiScale });
    }
    // Schema 变更后清除 NPC 卡片渲染器缓存
    if (typeof npcCardRenderer !== 'undefined') {
      npcCardRenderer.invalidateCache();
    }
    closeSettings(false);
    if (shouldRefreshChat && typeof refreshChatUI === 'function') {
      refreshChatUI();
    }
    if (!hasActiveWorldCard) {
      showToast(copy.functionEditor.toast.savedNoWorld);
    } else if (skippedBuiltInEditorPrompts) {
      showToast(copy.functionEditor.toast.saved);
    } else {
      showToast(copy.functionEditor.toast.saved);
    }
  }
}
