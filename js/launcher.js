// ============================================
// Launcher / Start Screen Controller
// ============================================

(function () {
  'use strict';

  const LAUNCHER_ID = 'launcher-overlay';
  const INTRO_ACTIVE_CLASS = 'launcher--intro-active';
  const INTRO_TRANSITION_CLASS = 'launcher--transition-to-intro';
  const INTRO_STEP_EXIT_CLASS = 'launcher--intro-step-exit';
  const INTRO_ENTER_CLASS = 'launcher--intro-enter';
  const INTRO_RETURN_CLASS = 'launcher--transition-from-intro';
  const TRANSITION_LOCK_CLASS = 'launcher--transition-lock';
  const TILE_PRESS_DURATION_MS = 150;
  const TURNSTILE_DURATION_MS = 350;
  const INTRO_OUT_MAX_DELAY_MS = 180;
  const INTRO_ENTER_DURATION_MS = 350;

  function getLauncherCopy() {
    const isEnglish = isEnglishLauncherLocale();
    const i18n = window.i18nService;
    return {
      intro: {
        stepIntroTitle: isEnglish
          ? 'Traveler, welcome to a world that has not been written yet.'
          : '旅行者，欢迎来到这片尚未书写的世界',
        stepIntroText: isEnglish
          ? 'I am the narrative engine of this sandbox game, an AI-driven game master. There is no preset script and no fixed world limit here. You are not just the player, but also the creator. If you can imagine it, we can turn it into a world.'
          : '我是这个沙盒游戏的叙事引擎——一个由 AI 驱动的游戏主持人。这里没有预设的剧本，更没有任何世界观的限制。你不仅是玩家，更是创世者，只要你能想象，我们就能将它具象化。',
        stepIntroButton: isEnglish ? 'What kind of game is this?' : '这是个什么游戏？',
        stepWorldChoiceTitle: isEnglish
          ? 'This is a sandbox text adventure where you can freely explore and build your own world.'
          : '这是一个沙盒式的文字冒险游戏，你可以自由探索和构造属于你的世界。',
        stepWorldChoiceText: isEnglish
          ? 'You can:\n\n• Create any kind of world, from neon cyberpunk cities to fantasy continents or vast interstellar empires.\n• Build the full social fabric, from physical or magical rules to nations, factions, species, and local culture.\n• Start a truly free adventure on a stage of your own, whether you want to explore the unknown, get tangled in conspiracies, or simply live the life you want.\n\nLet us begin with a built-in world card. What kind of world do you want?'
          : '你可以：\n\n• 设定任意的世界背景：无论是赛博朋克的霓虹深渊、剑与魔法的奇幻大陆，还是深邃浩瀚的星际帝国；\n• 搭建完整的社会生态：从底层的物理/魔法法则，到错综复杂的国家政权、种族势力与风土人情；\n• 展开绝对自由的冒险：在你自己构建的舞台上探索未知、卷入阴谋，或是仅仅经营你理想中的生活。\n\n我们先从内置的世界卡中选一个吧，告诉我，你喜欢什么类型的世界？',
        stepApiTitle: isEnglish ? 'Enter your API key first' : '先填入你的 API Key',
        stepApiText: isEnglish
          ? 'If you already have a DeepSeek API key, you can paste it here directly.\nIf you do not have one, or if you want to use a custom provider, click "Open Settings" below.'
          : '如果你已经有 DeepSeek 的 API Key，可以直接粘贴在这里。\n如果你没有，或者你要使用自定义服务商，也可以点下面的“打开设置”。',
        apiChoice: label =>
          isEnglish ? `You just picked "${label}".` : `你刚才选择的是「${label}」`,
        apiKeyLabel: 'DeepSeek API Key',
        apiKeyHint: isEnglish
          ? 'If you do not have a DeepSeek API key, or if you need a custom provider, click "Open Settings" below.'
          : '如果你没有 DeepSeek 的 API，或者你需要自定义服务商，请点下面的“打开设置”。',
        saveApiButton: isEnglish ? 'Test and Save' : '测试并保存',
        openSettingsButton: isEnglish ? 'Open Settings' : '打开设置',
        continueButton: isEnglish ? 'Continue into Game' : '继续进入游戏',
        noApiNoticeTitle: isEnglish ? 'Notice' : '提示',
        noApiNoticeText: isEnglish
          ? 'No API key was detected. The game may not work properly after you enter. Continue anyway?'
          : '系统没有检测到任何 API Key，进入游戏界面后可能无法正常游玩，是否进入？',
        noApiNoticeCancel: isEnglish ? 'Cancel' : '取消',
        noApiNoticeConfirm: isEnglish ? 'Enter Anyway' : '坚持进入',
        noApiFallback: isEnglish
          ? 'The confirmation modal is unavailable, so the game cannot continue right now.'
          : '确认弹窗未加载，暂时无法继续进入游戏。',
        missingApiPrompt: isEnglish
          ? 'Please enter a DeepSeek API key first.'
          : '请先填入 DeepSeek API Key。',
        apiDirtyWithSavedKey: isEnglish
          ? 'The input has changed. Test and save again if you want to use the new DeepSeek key. A saved API key is still available, so you can continue.'
          : '输入内容已修改。如需使用新的 DeepSeek Key，请重新测试并保存。当前仍已检测到已保存的 API Key，可继续进入游戏。',
        apiDirtyWithoutSavedKey: isEnglish
          ? 'The input has changed. Test and save again if you want to use the new DeepSeek key.'
          : '输入内容已修改。如需使用新的 DeepSeek Key，请重新测试并保存。',
        backButton: isEnglish ? 'Back' : '返回',
        backToLauncherAria: isEnglish ? 'Back to start screen' : '返回开始界面',
        backToPreviousAria: isEnglish ? 'Back to previous step' : '返回上一步',
        apiTesting: isEnglish ? 'Testing the DeepSeek connection...' : '正在测试 DeepSeek 连接...',
        apiTestSuccess: latency =>
          isEnglish
            ? `DeepSeek connection succeeded (${latency || 0}ms). You can continue now.`
            : `DeepSeek 连接测试成功（${latency || 0}ms），现在可以继续进入游戏。`,
        apiTestFailed: message =>
          isEnglish
            ? message || 'DeepSeek connection test failed. Check the API key and try again.'
            : message || 'DeepSeek 连接测试失败，请检查 API Key。',
      },
      preview: {
        title: 'AI Sandbox Game',
        modeGame: i18n?.t?.('launcher.modeGame') || (isEnglish ? 'Sandbox' : '沙盒'),
        modeDesign: i18n?.t?.('launcher.modeDesign') || (isEnglish ? 'World Cards' : '世界卡'),
        tileNpc: isEnglish ? 'Characters' : '角色',
        tileSummary: isEnglish ? 'Summary' : '总结',
        tileMap: i18n?.t?.('launcher.mapText') || (isEnglish ? 'World Map' : '世界地图'),
        tileSave: isEnglish ? 'Saves' : '存档',
        tileSettings: isEnglish ? 'Settings' : '设置',
        summaryTitle:
          i18n?.t?.('launcher.summaryTitle') || (isEnglish ? 'Story Summary' : '剧情总结'),
        npcTitle: i18n?.t?.('sidebar.npcTitle') || (isEnglish ? 'Characters' : '角色档案'),
        npcEmpty:
          i18n?.t?.('sidebar.npcEmpty') || (isEnglish ? 'No character data yet' : '暂无角色信息'),
        summaryStatsHtml: isEnglish
          ? 'Chapters: <strong>0</strong>&emsp;Turns: <strong>0</strong>'
          : '章节：<strong>0</strong>&emsp;剧情：<strong>0</strong>',
        summaryEmptyHtml: isEnglish
          ? 'Once your adventure starts,<br />story summaries will appear here'
          : '开始冒险后<br />这里会显示每次剧情的总结',
      },
      toast: {
        savedApiKeyReady: count =>
          isEnglish
            ? `Detected ${count} saved API key${count === 1 ? '' : 's'}. You can continue into the game.`
            : `已检测到 ${count} 个已保存的 API Key，你可以继续进入游戏。`,
        directStart: worldName =>
          isEnglish
            ? worldName
              ? `Saved API keys detected. Started a new adventure in ${worldName}.`
              : 'Saved API keys detected. Started a new adventure directly.'
            : worldName
              ? `已检测到已保存的 API Key，已直接进入当前世界卡：${worldName}。`
              : '已检测到已保存的 API Key，已直接开始新旅程。',
        defaultWorldInitFailed: isEnglish
          ? 'Default world initialization failed. Refresh and try again.'
          : '默认世界卡初始化失败，请刷新重试',
        enterDesignFailed: reason =>
          isEnglish
            ? `Failed to enter Design New World: ${reason}`
            : `进入设计新世界失败：${reason}`,
        sessionManagerUnavailableForDesign: isEnglish
          ? 'sessionManager is not ready, so Design New World cannot start.'
          : 'sessionManager 未就绪，无法进入设计新世界',
        finishCurrentFlow: reason =>
          isEnglish
            ? reason
              ? `Finish the current flow first (${reason})`
              : 'Finish the current flow first.'
            : reason
              ? `请先完成当前流程（${reason}）`
              : '请先完成当前流程',
        couldNotEnterOverwrite: isEnglish
          ? 'Could not enter the overwrite flow.'
          : '无法进入覆盖流程',
        autoSaveNoSlot: isEnglish
          ? 'Switch failed: auto-save failed because the current world has no empty slot. Choose a slot to overwrite manually.'
          : '切换失败：自动保存失败（当前世界没有空槽位，请手动选择要覆盖的存档槽位）',
        autoSaveFailed: reason =>
          isEnglish
            ? `Switch failed: auto-save failed (${reason})`
            : `切换失败：自动保存失败（${reason}）`,
        waitReplyBeforeDesignMode: isEnglish
          ? 'Wait for the current reply to finish before entering World Cards.'
          : '请等待回复完成后再进入世界卡',
        selectAvailableWorld: isEnglish
          ? 'Choose an available world first.'
          : '请先选择一个可用的世界',
        startNewJourneyFailed: reason =>
          isEnglish ? `Failed to start a new adventure: ${reason}` : `开始新旅程失败：${reason}`,
        sessionManagerUnavailableForStart: isEnglish
          ? 'sessionManager is not ready, so a new adventure cannot start.'
          : 'sessionManager 未就绪，无法开始新旅程',
      },
    };
  }

  function getLauncherReasonText(reason) {
    const rawReason = String(reason || '').trim();
    if (!rawReason) {
      return isEnglishLauncherLocale() ? 'Unknown error' : '未知错误';
    }
    if (typeof window.i18nService?.translateLegacyText === 'function') {
      return window.i18nService.translateLegacyText(rawReason);
    }
    return rawReason;
  }

  function getIntroThemeOptions() {
    const shared = window.getLauncherWorldChoiceOptions?.();
    return Array.isArray(shared) && shared.length > 0 ? shared : [];
  }

  function buildIntroWorldChoiceButtons() {
    return Object.freeze(
      getIntroThemeOptions().map((option, index) =>
        Object.freeze({
          label: isEnglishLauncherLocale() ? option.labelEn || option.label : option.label,
          action: option.placeholder ? 'intro-placeholder' : 'intro-select-theme',
          choice: option.choice,
          primary: index === 0,
        })
      )
    );
  }
  const INTRO_API_PRIMARY_MODULES = Object.freeze([
    'react',
    'sms',
    'summary',
    'chapter',
    'design',
  ]);
  function getIntroSteps() {
    const copy = getLauncherCopy();
    return Object.freeze([
      Object.freeze({
        id: 'intro',
        kind: 'intro',
        title: copy.intro.stepIntroTitle,
        text: copy.intro.stepIntroText,
        buttons: [
          Object.freeze({ label: copy.intro.stepIntroButton, action: 'intro-next', primary: true }),
        ],
      }),
      Object.freeze({
        id: 'world-choice',
        kind: 'world-choice',
        title: copy.intro.stepWorldChoiceTitle,
        text: copy.intro.stepWorldChoiceText,
        buttons: buildIntroWorldChoiceButtons(),
      }),
      Object.freeze({
        id: 'api-setup',
        kind: 'api-setup',
        title: copy.intro.stepApiTitle,
        text: copy.intro.stepApiText,
        buttons: [
          Object.freeze({
            label: copy.intro.saveApiButton,
            action: 'intro-save-api',
            primary: true,
          }),
          Object.freeze({
            label: copy.intro.openSettingsButton,
            action: 'intro-open-settings',
            variant: 'secondary',
          }),
          Object.freeze({ label: copy.intro.continueButton, action: 'intro-start-game' }),
        ],
      }),
    ]);
  }
  const QQ_GROUP_URL =
    'https://qun.qq.com/universal-share/share?ac=1&authKey=VfXfdNqWLl5SfUyOySR68a%2FBTAzSey5uMuS1W8P38HS1h5g663PG57icwtpaQ4Hn&busi_data=eyJncm91cENvZGUiOiIxMDg3OTM2OTAxIiwidG9rZW4iOiJXbjBZSVM5cE9oTmNHcHlzd3cyS1hUc2VKaUs2bGJsQmhDeEtuMUdZajRTTHVnY1BhWktlMHNjSTY1ZjB0NW5xIiwidWluIjoiMjQ4MDc5MTQ0MiJ9&data=3cHe_YUD4Sel_KAoBx5zWpPawRYWhsltP11zVDc3LZvJ283WqcVdiJTGQDmmhCcLCF4rNIR--k7nYfdCSEjMyw&svctype=4&tempid=h5_group_info';
  let introContinuePending = false;
  let introTransitionPending = false;
  let introTransitionTimerIds = [];
  let currentIntroStepIndex = 0;
  let selectedIntroChoice = null;
  let introSettingsObserver = null;
  let launcherNewGamePending = false;
  let introApiSetupState = createInitialIntroApiSetupState();

  function createInitialIntroApiSetupState() {
    return {
      inputValue: '',
      status: 'idle',
      message: '',
      canContinue: false,
      validatedKey: '',
      startGameWarnedWithoutApi: false,
    };
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCurrentIntroStep() {
    const steps = getIntroSteps();
    return steps[Math.min(Math.max(currentIntroStepIndex, 0), steps.length - 1)];
  }

  function isEnglishLauncherLocale() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  }

  function getIntroThemeChoiceMeta(choice = selectedIntroChoice) {
    return window.getLauncherWorldChoiceMeta?.(choice) || null;
  }

  function applyIntroThemeFromMeta(meta) {
    const skin = meta?.themeSkin;
    const mode = meta?.themeMode;
    if (!skin || !mode) return;
    if (typeof window.themeUI?.setThemeName === 'function') {
      window.themeUI.setThemeName(skin);
    }
    if (typeof window.themeUI?.applyThemeMode === 'function') {
      window.themeUI.applyThemeMode(mode);
    }
    if (typeof window.aiService?.saveConfig === 'function') {
      window.aiService.saveConfig({ themeName: skin, themeMode: mode });
    }
  }

  function getSavedApiKeyCount() {
    const providerApiKeys = window.aiService?.getConfig?.()?.providerApiKeys;
    if (!providerApiKeys || typeof providerApiKeys !== 'object') return 0;
    return Object.values(providerApiKeys).filter(value => typeof value === 'string' && value.trim())
      .length;
  }

  function hasAnySavedApiKey() {
    return getSavedApiKeyCount() > 0;
  }

  function getSavedApiKeyReadyMessage() {
    const count = getSavedApiKeyCount();
    if (count <= 0) return '';
    return getLauncherCopy().toast.savedApiKeyReady(count);
  }

  function setLauncherNewGamePending(overlay = null, isPending = false) {
    launcherNewGamePending = Boolean(isPending);
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root) return;

    const newGameBtn = root.querySelector('[data-action="new-game"]');
    if (!newGameBtn) return;

    if (launcherNewGamePending) {
      newGameBtn.classList.add('launcher-nav--disabled');
      newGameBtn.setAttribute('aria-disabled', 'true');
      return;
    }

    newGameBtn.classList.remove('launcher-nav--disabled');
    newGameBtn.removeAttribute('aria-disabled');
  }

  function getDirectStartGameNotice() {
    const worldName = window.worldCardManager?.getActiveCard?.()?.name?.trim?.() || '';
    return getLauncherCopy().toast.directStart(worldName);
  }

  function getLauncherPreviewCopy() {
    return getLauncherCopy().preview;
  }

  function getIntroPreviewElements(overlay = null) {
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root) {
      return {
        introEl: null,
        previewEl: null,
        titleEl: null,
        modeGameEl: null,
        modeDesignEl: null,
        tileNpcEl: null,
        tileSummaryEl: null,
        tileMapEl: null,
        tileSaveEl: null,
        tileSettingsEl: null,
        summaryTitleEl: null,
        summaryStatsEl: null,
        summaryEmptyEl: null,
        npcTitleEl: null,
        npcEmptyEl: null,
      };
    }

    const introEl = root.querySelector('.launcher-intro');
    return {
      introEl,
      previewEl: root.querySelector('.launcher-ui-preview'),
      titleEl: root.querySelector('[data-preview-text="title"]'),
      modeGameEl: root.querySelector('[data-preview-text="mode-game"]'),
      modeDesignEl: root.querySelector('[data-preview-text="mode-design"]'),
      tileNpcEl: root.querySelector('[data-preview-text="tile-npc"]'),
      tileSummaryEl: root.querySelector('[data-preview-text="tile-summary"]'),
      tileMapEl: root.querySelector('[data-preview-text="tile-map"]'),
      tileSaveEl: root.querySelector('[data-preview-text="tile-save"]'),
      tileSettingsEl: root.querySelector('[data-preview-text="tile-settings"]'),
      summaryTitleEl: root.querySelector('[data-preview-text="summary-title"]'),
      summaryStatsEl: root.querySelector('[data-preview-html="summary-stats"]'),
      summaryEmptyEl: root.querySelector('[data-preview-html="summary-empty"]'),
      npcTitleEl: root.querySelector('[data-preview-text="npc-title"]'),
      npcEmptyEl: root.querySelector('[data-preview-text="npc-empty"]'),
    };
  }

  function syncLauncherPreviewTexts(overlay = null) {
    const preview = getIntroPreviewElements(overlay);
    if (!preview.previewEl) return;

    const copy = getLauncherPreviewCopy();
    if (preview.titleEl) preview.titleEl.textContent = copy.title;
    if (preview.modeGameEl) preview.modeGameEl.textContent = copy.modeGame;
    if (preview.modeDesignEl) preview.modeDesignEl.textContent = copy.modeDesign;
    if (preview.tileNpcEl) preview.tileNpcEl.textContent = copy.tileNpc;
    if (preview.tileSummaryEl) preview.tileSummaryEl.textContent = copy.tileSummary;
    if (preview.tileMapEl) preview.tileMapEl.textContent = copy.tileMap;
    if (preview.tileSaveEl) preview.tileSaveEl.textContent = copy.tileSave;
    if (preview.tileSettingsEl) preview.tileSettingsEl.textContent = copy.tileSettings;
    if (preview.summaryTitleEl) preview.summaryTitleEl.textContent = copy.summaryTitle;
    if (preview.summaryStatsEl) preview.summaryStatsEl.innerHTML = copy.summaryStatsHtml;
    if (preview.summaryEmptyEl) preview.summaryEmptyEl.innerHTML = copy.summaryEmptyHtml;
    if (preview.npcTitleEl) preview.npcTitleEl.textContent = copy.npcTitle;
    if (preview.npcEmptyEl) preview.npcEmptyEl.textContent = copy.npcEmpty;
  }

  function updateLauncherPreviewState(step, overlay = null) {
    const preview = getIntroPreviewElements(overlay);
    if (!preview.introEl) return;
    preview.introEl.classList.toggle('launcher-intro--api-preview', step?.kind === 'api-setup');
  }

  function canContinueIntoGameFromIntro() {
    return hasAnySavedApiKey() || introApiSetupState.canContinue === true;
  }

  function getIntroNoApiNoticeCopy() {
    const copy = getLauncherCopy().intro;
    return {
      title: copy.noApiNoticeTitle,
      text: copy.noApiNoticeText,
      cancelText: copy.noApiNoticeCancel,
      confirmText: copy.noApiNoticeConfirm,
      fallbackText: copy.noApiFallback,
    };
  }

  function getIntroMissingApiKeyPrompt() {
    return getLauncherCopy().intro.missingApiPrompt;
  }

  function clearIntroTransitionTimers() {
    introTransitionTimerIds.forEach(timerId => clearTimeout(timerId));
    introTransitionTimerIds = [];
  }

  function scheduleIntroTransitionStep(callback, delay) {
    const timerId = setTimeout(() => {
      introTransitionTimerIds = introTransitionTimerIds.filter(id => id !== timerId);
      callback();
    }, delay);
    introTransitionTimerIds.push(timerId);
    return timerId;
  }

  function setLauncherTransitionLock(overlay, isLocked) {
    if (!overlay) return;
    overlay.classList.toggle(TRANSITION_LOCK_CLASS, Boolean(isLocked));
  }

  function ensureIntroSettingsObserver() {
    if (introSettingsObserver || typeof MutationObserver === 'undefined') return;
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    let lastHidden = modal.classList.contains('hidden');
    introSettingsObserver = new MutationObserver(() => {
      const isHidden = modal.classList.contains('hidden');
      if (isHidden === lastHidden) return;
      lastHidden = isHidden;
      if (!isHidden) return;
      if (getCurrentIntroStep().kind !== 'api-setup') return;
      syncIntroApiSetupStateFromSavedKeys(document.getElementById(LAUNCHER_ID));
    });
    introSettingsObserver.observe(modal, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function getIntroElements(overlay = null) {
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root) {
      return {
        backBtn: null,
        panelEl: null,
        copyEl: null,
        titleEl: null,
        textEl: null,
        extraEl: null,
        actionsEl: null,
        continueBtn: null,
        continueBtns: [],
      };
    }
    const continueBtns = Array.from(
      root.querySelectorAll('.launcher-intro [data-intro-button="true"]')
    );
    const continueBtn =
      root.querySelector('.launcher-intro [data-intro-primary="true"]') || continueBtns[0] || null;
    return {
      backBtn: root.querySelector('.launcher-intro-back'),
      panelEl: root.querySelector('.launcher-intro-panel'),
      copyEl: root.querySelector('.launcher-intro-copy'),
      titleEl: root.querySelector('#launcher-intro-title'),
      textEl: root.querySelector('#launcher-intro-text'),
      extraEl: root.querySelector('#launcher-intro-extra'),
      actionsEl: root.querySelector('#launcher-intro-actions'),
      continueBtn,
      continueBtns,
    };
  }

  function renderIntroStepExtra(step, overlay = null) {
    const { extraEl } = getIntroElements(overlay);
    if (!extraEl) return;

    if (step.kind !== 'api-setup') {
      extraEl.hidden = true;
      extraEl.innerHTML = '';
      return;
    }

    const themeMeta = getIntroThemeChoiceMeta();
    const copy = getLauncherCopy().intro;
    const themeLabel = themeMeta
      ? isEnglishLauncherLocale()
        ? themeMeta.labelEn || themeMeta.label
        : themeMeta.label
      : '';
    const statusClassMap = {
      pending: 'launcher-intro-api-status--pending',
      success: 'launcher-intro-api-status--success',
      settings_ready: 'launcher-intro-api-status--success',
      error: 'launcher-intro-api-status--error',
    };
    const statusClass = statusClassMap[introApiSetupState.status] || '';
    const message = introApiSetupState.message || '';

    extraEl.hidden = false;
    extraEl.innerHTML = `
      <div class="launcher-intro-api">
        ${themeMeta ? `<div class="launcher-intro-api-choice">${escapeHtml(copy.apiChoice(themeLabel))}</div>` : ''}
        <label class="launcher-intro-api-label" for="launcher-api-key-input">${escapeHtml(copy.apiKeyLabel)}</label>
        <div class="launcher-intro-api-input-wrapper">
          <input
            id="launcher-api-key-input"
            class="launcher-intro-api-input"
            type="password"
            value="${escapeHtml(introApiSetupState.inputValue)}"
            placeholder="sk-..."
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="" data-action="launcher-intro-api-paste-btn" title="${escapeHtml(isEnglishLauncherLocale() ? 'Paste' : '粘贴')}">
            <span class="material-symbols-outlined">content_paste</span>
          </button>
        </div>
        <p class="launcher-intro-api-hint">${escapeHtml(copy.apiKeyHint)}</p>
        <div class="launcher-intro-api-status${statusClass ? ` ${statusClass}` : ''}"${message ? '' : ' hidden'}>${escapeHtml(message)}</div>
      </div>
    `;
  }

  function getRenderedIntroButtons(step) {
    return step.buttons.map((button, index) => {
      const rendered = {
        ...button,
        primary: button.primary === true,
      };

      if (step.kind === 'api-setup') {
        if (button.action === 'intro-save-api') {
          rendered.primary = !introApiSetupState.canContinue;
        }
        if (button.action === 'intro-start-game') {
          rendered.primary = introApiSetupState.canContinue;
        }
      }

      if (
        !step.buttons.some(item => item.primary === true) &&
        index === 0 &&
        step.kind !== 'api-setup'
      ) {
        rendered.primary = true;
      }
      return rendered;
    });
  }

  function renderIntroStepButtons(step, overlay = null) {
    const { actionsEl } = getIntroElements(overlay);
    if (!actionsEl) return;

    const buttons = getRenderedIntroButtons(step);
    actionsEl.className = 'launcher-intro-actions';
    actionsEl.classList.toggle('launcher-intro-actions--multi', buttons.length > 1);
    actionsEl.innerHTML = buttons
      .map(button => {
        const choiceAttr = Number.isInteger(button.choice)
          ? ` data-intro-choice="${button.choice}"`
          : '';
        const primaryAttr = button.primary ? ' data-intro-primary="true"' : '';
        const disabledAttr = button.disabled ? ' disabled aria-disabled="true"' : '';
        const classNames = ['launcher-intro-continue'];
        if (button.variant === 'secondary') classNames.push('launcher-intro-continue--secondary');
        if (button.action === 'intro-start-game')
          classNames.push('launcher-intro-continue--success');
        return `<button type="button" class="${classNames.join(' ')}" data-action="${button.action}" data-intro-button="true"${primaryAttr}${choiceAttr}${disabledAttr}>${escapeHtml(button.label)}</button>`;
      })
      .join('');
  }

  function updateIntroButtonStates(overlay = null) {
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root) return;

    const { continueBtns, backBtn } = getIntroElements(root);
    const disabled = introContinuePending;
    if (backBtn) {
      backBtn.disabled = disabled;
      backBtn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    }
    continueBtns.forEach(button => {
      button.disabled = disabled;
      button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
  }

  function renderIntroBackButton(stepIndex = currentIntroStepIndex, overlay = null) {
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root) return;

    const { backBtn } = getIntroElements(root);
    if (!backBtn) return;

    const copy = getLauncherCopy().intro;
    const isFirstStep = Number(stepIndex) <= 0;
    const labelEl = backBtn.querySelector('.launcher-intro-back-text');

    if (labelEl) labelEl.textContent = copy.backButton;
    backBtn.setAttribute(
      'aria-label',
      isFirstStep ? copy.backToLauncherAria : copy.backToPreviousAria
    );
  }

  function updateIntroApiStatusUI(overlay = null) {
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root || getCurrentIntroStep().kind !== 'api-setup') return;

    const statusEl = root.querySelector('.launcher-intro-api-status');
    if (statusEl) {
      statusEl.className = 'launcher-intro-api-status';
      const statusClassMap = {
        pending: 'launcher-intro-api-status--pending',
        success: 'launcher-intro-api-status--success',
        settings_ready: 'launcher-intro-api-status--success',
        error: 'launcher-intro-api-status--error',
        dirty: 'launcher-intro-api-status--pending',
      };
      const statusClass = statusClassMap[introApiSetupState.status] || '';
      if (statusClass) statusEl.classList.add(statusClass);
      statusEl.textContent = introApiSetupState.message || '';
      statusEl.hidden = !introApiSetupState.message;
    }

    updateIntroButtonStates(root);
  }

  function renderIntroStep(stepIndex = currentIntroStepIndex, overlay = null) {
    const steps = getIntroSteps();
    const safeIndex = Math.min(Math.max(Number(stepIndex) || 0, 0), steps.length - 1);
    currentIntroStepIndex = safeIndex;
    const step = steps[safeIndex];
    const root = overlay || document.getElementById(LAUNCHER_ID);
    const introEl = root?.querySelector('.launcher-intro') || null;
    const { panelEl, copyEl, titleEl, textEl } = getIntroElements(overlay);
    if (titleEl) titleEl.textContent = step.title;
    if (textEl) textEl.textContent = step.text;
    if (root) {
      root.dataset.introStep = String(safeIndex + 1);
      root.dataset.introKind = step.kind;
    }
    if (introEl) {
      introEl.dataset.introStep = String(safeIndex + 1);
      introEl.dataset.introKind = step.kind;
    }
    if (panelEl) {
      panelEl.dataset.introStep = String(safeIndex + 1);
      panelEl.dataset.introKind = step.kind;
      panelEl.classList.toggle('launcher-intro-panel--multi-actions', step.buttons.length > 1);
    }
    if (copyEl) {
      copyEl.classList.toggle('launcher-intro-copy--api-setup', step.kind === 'api-setup');
    }
    renderIntroBackButton(safeIndex, overlay);
    renderIntroStepExtra(step, overlay);
    renderIntroStepButtons(step, overlay);
    syncLauncherPreviewTexts(overlay);
    updateLauncherPreviewState(step, overlay);
    updateIntroButtonStates(overlay);
  }

  function resetIntroSteps(overlay = null) {
    currentIntroStepIndex = 0;
    selectedIntroChoice = null;
    introApiSetupState = createInitialIntroApiSetupState();
    window._launcherIntroThemeChoice = null;
    window._launcherIntroThemeChoiceLabel = '';
    renderIntroStep(currentIntroStepIndex, overlay);
  }

  function applyPressedState(clickedItem) {
    if (!clickedItem) return;
    if (clickedItem.matches('.launcher-intro-back')) {
      clickedItem.classList.add('launcher-intro-back--pressed');
      return;
    }
    if (clickedItem.matches('.launcher-intro-continue')) {
      clickedItem.classList.add('launcher-intro-continue--pressed');
      return;
    }
    clickedItem.classList.add('is-active');
  }

  function clearPressedStates(overlay) {
    if (!overlay) return;
    overlay.querySelectorAll('.is-active').forEach(item => {
      item.classList.remove('is-active');
    });
    overlay.querySelectorAll('.launcher-intro-continue--pressed').forEach(item => {
      item.classList.remove('launcher-intro-continue--pressed');
    });
    overlay.querySelectorAll('.launcher-intro-back--pressed').forEach(item => {
      item.classList.remove('launcher-intro-back--pressed');
    });
  }

  function resetIntroTransitionState(overlay) {
    clearIntroTransitionTimers();
    introTransitionPending = false;
    if (!overlay) return;
    overlay.classList.remove(INTRO_TRANSITION_CLASS);
    overlay.classList.remove(INTRO_STEP_EXIT_CLASS);
    overlay.classList.remove(INTRO_ENTER_CLASS);
    overlay.classList.remove(INTRO_RETURN_CLASS);
    overlay.classList.remove(TRANSITION_LOCK_CLASS);
    clearPressedStates(overlay);
  }

  function setIntroContinuePending(overlay, isPending) {
    introContinuePending = Boolean(isPending);
    updateIntroButtonStates(overlay);
  }

  function syncIntroApiSetupStateFromSavedKeys(overlay = null) {
    if (hasAnySavedApiKey()) {
      if (introApiSetupState.status !== 'success') {
        introApiSetupState.status = 'settings_ready';
        introApiSetupState.message = getSavedApiKeyReadyMessage();
      }
      introApiSetupState.canContinue = true;
    } else if (introApiSetupState.status === 'settings_ready') {
      introApiSetupState.status = 'idle';
      introApiSetupState.message = '';
      introApiSetupState.canContinue = false;
    }

    if (getCurrentIntroStep().kind === 'api-setup') {
      renderIntroStep(currentIntroStepIndex, overlay);
    }
  }

  function setLauncherIntroState(isActive, options = {}) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay) return;

    const nextState = Boolean(isActive);
    const { focusContinue = nextState, resetPending = true } = options;
    overlay.classList.toggle(INTRO_ACTIVE_CLASS, nextState);
    renderIntroStep(currentIntroStepIndex, overlay);

    const intro = overlay.querySelector('.launcher-intro');
    if (intro) {
      intro.setAttribute('aria-hidden', nextState ? 'false' : 'true');
    }

    const bubble = overlay.querySelector('#launcher-profile-bubble');
    if (bubble) {
      bubble.classList.remove('is-visible');
      bubble.setAttribute('aria-hidden', 'true');
    }

    if (resetPending) {
      setIntroContinuePending(overlay, false);
    }

    if (nextState && focusContinue) {
      requestAnimationFrame(() => {
        getIntroElements(overlay).continueBtn?.focus();
      });
    }
  }

  /**
   * 获取全部世界卡 ID
   */
  function getAllWorldCardIds() {
    const mgr = window.worldCardManager;
    if (!mgr || typeof mgr.list !== 'function') return [];
    return mgr
      .list()
      .map(card => (typeof card?.id === 'string' ? card.id.trim() : ''))
      .filter(Boolean);
  }

  async function worldHasSaveData(worldId) {
    if (typeof saveManager === 'undefined') return false;
    const normalizedWorldId = typeof worldId === 'string' ? worldId.trim() : '';
    if (!normalizedWorldId) return false;
    try {
      const saves =
        typeof saveManager.getSaveList === 'function'
          ? await saveManager.getSaveList(normalizedWorldId, { allowRepair: false })
          : {};
      return saves && Object.keys(saves).length > 0;
    } catch (e) {
      console.warn('[Launcher] Error checking save data:', e);
      return false;
    }
  }

  async function getWorldLatestProgressTimestamp(worldId) {
    if (typeof saveManager === 'undefined') return null;
    const normalizedWorldId = typeof worldId === 'string' ? worldId.trim() : '';
    if (!normalizedWorldId) return null;

    let latestTimestamp = Number.NEGATIVE_INFINITY;
    const updateLatest = saveLike => {
      const timestamp =
        typeof saveManager.getProgressTimestamp === 'function'
          ? saveManager.getProgressTimestamp(saveLike)
          : Date.parse(saveLike?.progressUpdatedAt || saveLike?.updatedAt || '');
      if (Number.isFinite(timestamp)) {
        latestTimestamp = Math.max(latestTimestamp, timestamp);
      }
    };

    try {
      const saves =
        typeof saveManager.getSaveList === 'function'
          ? await saveManager.getSaveList(normalizedWorldId, { allowRepair: false })
          : {};
      Object.values(saves || {}).forEach(updateLatest);
    } catch (e) {
      console.warn('[Launcher] Error resolving latest progress timestamp:', e);
      return null;
    }

    return Number.isFinite(latestTimestamp) ? latestTimestamp : null;
  }

  /**
   * 检查是否存在任意世界的存档
   */
  async function hasSaveData() {
    const worldIds = getAllWorldCardIds();
    const results = await Promise.all(worldIds.map(worldHasSaveData));
    return results.some(Boolean);
  }

  function hasRestorableDesignDraft() {
    if (typeof window.hasStoredDesignDraft === 'function') {
      return window.hasStoredDesignDraft();
    }
    return false;
  }

  async function getPreferredContinueWorldId() {
    if (typeof saveManager === 'undefined') return null;

    const mgr = window.worldCardManager;
    const activeWorldId = mgr?.getActiveCardId?.() || null;
    const worldIds = getAllWorldCardIds();
    const timestamps = await Promise.all(
      worldIds.map(worldId => getWorldLatestProgressTimestamp(worldId))
    );
    const candidates = worldIds
      .map((worldId, index) => ({
        worldId,
        index,
        latestTimestamp: timestamps[index],
      }))
      .filter(candidate => Number.isFinite(candidate.latestTimestamp));

    if (candidates.length === 0) return null;

    candidates.sort((candidateA, candidateB) => {
      if (candidateB.latestTimestamp !== candidateA.latestTimestamp) {
        return candidateB.latestTimestamp - candidateA.latestTimestamp;
      }
      if (
        activeWorldId &&
        candidateA.worldId === activeWorldId &&
        candidateB.worldId !== activeWorldId
      ) {
        return -1;
      }
      if (
        activeWorldId &&
        candidateB.worldId === activeWorldId &&
        candidateA.worldId !== activeWorldId
      ) {
        return 1;
      }
      return candidateA.index - candidateB.index;
    });

    return candidates[0]?.worldId || null;
  }

  async function syncContinueButtonState(overlay) {
    const continueBtn = overlay?.querySelector?.('[data-action="continue"]');
    const designBtn = overlay?.querySelector?.('[data-action="design-mode"]');
    const hasDraft = hasRestorableDesignDraft();

    if (continueBtn) {
      const hasSaves = await hasSaveData();
      if (hasSaves || hasDraft) {
        continueBtn.classList.remove('launcher-nav--disabled');
        continueBtn.removeAttribute('aria-disabled');
      } else {
        continueBtn.classList.add('launcher-nav--disabled');
        continueBtn.setAttribute('aria-disabled', 'true');
      }
    }

    if (!designBtn) return;

    const cnLabel = designBtn.querySelector('.launcher-nav-label-cn');
    const enLabel = designBtn.querySelector('.launcher-nav-label-en');
    if (cnLabel) {
      cnLabel.textContent = hasDraft ? '继续设计草稿' : '设计新世界';
    }
    if (enLabel) {
      enLabel.textContent = hasDraft ? 'Continue Design Draft' : 'Design New World';
    }
    designBtn.classList.toggle('launcher-nav--draft', hasDraft);
    if (hasDraft) {
      designBtn.setAttribute(
        'title',
        isEnglishLauncherLocale() ? 'Continue Design Draft' : '继续设计草稿'
      );
    } else {
      designBtn.removeAttribute('title');
    }
  }

  async function ensureWorldCardManagerReady(options = {}) {
    const { showToastOnFail = true } = options;
    const mgr = window.worldCardManager;
    if (!mgr || typeof mgr.ensureReady !== 'function') return true;
    try {
      await mgr.ensureReady();
      return true;
    } catch (error) {
      console.error('[Launcher] 等待 worldCardManager 就绪失败:', error);
      if (showToastOnFail && typeof showToast === 'function') {
        showToast(getLauncherCopy().toast.defaultWorldInitFailed);
      }
      return false;
    }
  }

  /**
   * Hide the launcher with a Windows Phone turnstile 3D flip animation.
   * @param {HTMLElement|null} clickedItem - The nav item that was clicked (for press feedback)
   * @param {Function} callback - Called after animation completes
   */
  function hideLauncher(clickedItem, callback) {
    const el = document.getElementById(LAUNCHER_ID);
    if (!el || el.classList.contains('launcher--hidden')) {
      if (callback) callback();
      return;
    }

    let called = false;
    function done() {
      if (called) return;
      called = true;
      el.classList.add('launcher--hidden');
      window._launcherVisible = false;
      if (callback) callback();
    }

    // Phase 1: Pressed tile feedback (150ms)
    if (clickedItem) {
      applyPressedState(clickedItem);
    }

    // Phase 2: After press, trigger staggered turnstile rotation (350ms)
    setTimeout(function () {
      el.classList.add('launcher--turnstile-exit');
    }, 150);

    // Phase 3: Background fades out 0.35s after turnstile starts + 0.3s duration
    // Total: 150 + 350 + 300 = 800ms. Use fallback at 850ms.
    setTimeout(done, 850);
  }

  function showLauncherOverlay() {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay) return;

    resetIntroTransitionState(overlay);
    setLauncherNewGamePending(overlay, false);
    overlay.classList.remove('launcher--turnstile-exit');
    overlay.classList.remove('launcher--hidden');
    overlay.classList.remove(INTRO_ACTIVE_CLASS);
    overlay.classList.remove(INTRO_RETURN_CLASS);
    resetIntroSteps(overlay);
    clearPressedStates(overlay);

    const bubble = overlay.querySelector('#launcher-profile-bubble');
    if (bubble) {
      bubble.classList.remove('is-visible');
      bubble.setAttribute('aria-hidden', 'true');
    }

    const creditsModal = document.getElementById('launcher-credits-modal');
    if (creditsModal) {
      creditsModal.classList.remove('is-open');
      creditsModal.setAttribute('aria-hidden', 'true');
    }

    const changelogModal = document.getElementById('launcher-changelog-modal');
    if (changelogModal) {
      changelogModal.classList.remove('is-open');
      changelogModal.setAttribute('aria-hidden', 'true');
    }

    setLauncherIntroState(false, { focusContinue: false });
    syncContinueButtonState(overlay);
    window._launcherVisible = true;

    try {
      window.analyticsService?.trackOnce?.('funnel.launcher_open', {}, 'funnel.launcher_open');
    } catch (_) { /* ignore */ }
  }

  /**
   * Enter the main game after hiding the launcher.
   */
  function enterGame() {
    if (typeof window._launcherGameInit === 'function') {
      window._launcherGameInit();
    }
  }

  /**
   * Programmatically switch to design mode by clicking the mode toggle.
   */
  function activateDesignMode() {
    const modeToggle = document.getElementById('mode-toggle');
    if (modeToggle && !modeToggle.classList.contains('design-mode')) {
      modeToggle.click();
    }
    // 显式落到 design stage（DEFAULT_STAGE.design 是 saves，
    // launcher 入口期望直接进设计工作区而非存档列表）
    if (typeof window.stageRouter?.setStage === 'function') {
      window.stageRouter.setStage('design');
    }
  }

  function _releaseTransitionLock(source) {
    const mgr = window.sessionManager;
    if (!mgr || typeof mgr.releaseTransitionLock !== 'function') return;
    mgr.releaseTransitionLock(source);
  }

  function _acquireTransitionLock(source) {
    const mgr = window.sessionManager;
    if (!mgr || typeof mgr.acquireTransitionLock !== 'function') {
      return { ok: true, reason: null };
    }
    return mgr.acquireTransitionLock(source);
  }

  function _resolveBlockedWorldCardId(saveResult) {
    const fromResult = String(
      saveResult?.blockedWorldCardId || saveResult?.worldCardId || ''
    ).trim();
    if (fromResult) return fromResult;
    return window.worldCardManager?.getActiveCardId?.() || null;
  }

  function _enterDesignModeAfterTransition(clickedItem, lockSource) {
    const toastCopy = getLauncherCopy().toast;

    // 进入世界卡前先确认设计模块的 API Key 已配置，
    // 避免用户输完想法后才在 chat 里看到「API Key 未设置」错误
    if (
      window.aiService &&
      typeof window.aiService.getApiKeyForModule === 'function' &&
      !window.aiService.getApiKeyForModule('p1')
    ) {
      _releaseTransitionLock(lockSource);
      const isEn = isEnglishLauncherLocale();
      if (typeof showToast === 'function') {
        showToast(
          isEn
            ? 'World Cards requires an API key. Opening Settings…'
            : '世界卡需要先配置 API Key，已为你打开设置…'
        );
      }
      const settingsModal = document.getElementById('settings-modal');
      if (settingsModal) settingsModal.style.zIndex = '400';
      if (typeof openSettings === 'function') openSettings('api');
      return;
    }

    const preserveDesignDraft = hasRestorableDesignDraft();
    if (window.sessionManager && typeof window.sessionManager.resetSessionState === 'function') {
      const startResult = window.sessionManager.resetSessionState({
        silent: true,
        seedGameGreeting: false,
        preserveDesignDraft,
      });
      if (!startResult || !startResult.ok) {
        if (typeof showToast === 'function') {
          showToast(toastCopy.enterDesignFailed(getLauncherReasonText(startResult?.reason)));
        }
        _releaseTransitionLock(lockSource);
        return;
      }
    } else {
      if (typeof showToast === 'function') showToast(toastCopy.sessionManagerUnavailableForDesign);
      _releaseTransitionLock(lockSource);
      return;
    }

    try {
      window.analyticsService?.trackOnce?.('funnel.design_mode_entered', {}, 'funnel.design_mode_entered');
    } catch (_) { /* ignore */ }

    hideLauncher(clickedItem, function () {
      enterGame();
      requestAnimationFrame(function () {
        activateDesignMode();
      });
      _releaseTransitionLock(lockSource);
    });
  }

  function _runDesignModeTransitionFlow(clickedItem) {
    const lockSource = 'launcher-design-mode';
    if (typeof window.runTransitionAutoSaveGuard === 'function') {
      window.runTransitionAutoSaveGuard({
        lockSource,
        onReady: () => {
          _enterDesignModeAfterTransition(clickedItem, lockSource);
          return true;
        },
        failurePrefix: isEnglishLauncherLocale()
          ? 'Failed to enter World Cards'
          : '进入世界卡失败',
      });
      return;
    }

    _enterDesignModeAfterTransition(clickedItem, lockSource);
  }

  function transitionLauncherToIntro(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || introTransitionPending || overlay.classList.contains(INTRO_ACTIVE_CLASS)) {
      return;
    }

    resetIntroTransitionState(overlay);
    resetIntroSteps(overlay);
    introTransitionPending = true;
    setLauncherTransitionLock(overlay, true);
    setIntroContinuePending(overlay, true);

    if (clickedItem) {
      applyPressedState(clickedItem);
    }

    scheduleIntroTransitionStep(() => {
      overlay.classList.add(INTRO_TRANSITION_CLASS);
    }, TILE_PRESS_DURATION_MS);

    scheduleIntroTransitionStep(
      () => {
        overlay.classList.remove(INTRO_TRANSITION_CLASS);
        clearPressedStates(overlay);
        overlay.classList.add(INTRO_ENTER_CLASS);
        setLauncherIntroState(true, {
          focusContinue: false,
          resetPending: false,
        });
      },
      TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS + INTRO_OUT_MAX_DELAY_MS
    );

    scheduleIntroTransitionStep(
      () => {
        overlay.classList.remove(INTRO_ENTER_CLASS);
        setLauncherTransitionLock(overlay, false);
        setIntroContinuePending(overlay, false);
        introTransitionPending = false;
        getIntroElements(overlay).continueBtn?.focus();
      },
      TILE_PRESS_DURATION_MS +
        TURNSTILE_DURATION_MS +
        INTRO_OUT_MAX_DELAY_MS +
        INTRO_ENTER_DURATION_MS
    );
  }

  function transitionToNextIntroStep(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || introTransitionPending || currentIntroStepIndex >= getIntroSteps().length - 1) {
      return;
    }

    resetIntroTransitionState(overlay);
    introTransitionPending = true;
    setLauncherTransitionLock(overlay, true);
    setIntroContinuePending(overlay, true);

    if (clickedItem) {
      applyPressedState(clickedItem);
    }

    scheduleIntroTransitionStep(() => {
      overlay.classList.add(INTRO_STEP_EXIT_CLASS);
    }, TILE_PRESS_DURATION_MS);

    scheduleIntroTransitionStep(() => {
      overlay.classList.remove(INTRO_STEP_EXIT_CLASS);
      clearPressedStates(overlay);
      currentIntroStepIndex += 1;
      renderIntroStep(currentIntroStepIndex, overlay);
      syncIntroApiSetupStateFromSavedKeys(overlay);
      overlay.classList.add(INTRO_ENTER_CLASS);
    }, TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS);

    scheduleIntroTransitionStep(
      () => {
        overlay.classList.remove(INTRO_ENTER_CLASS);
        setLauncherTransitionLock(overlay, false);
        setIntroContinuePending(overlay, false);
        introTransitionPending = false;
        getIntroElements(overlay).continueBtn?.focus();
      },
      TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS + INTRO_ENTER_DURATION_MS
    );
  }

  function transitionToPreviousIntroStep(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || introTransitionPending || currentIntroStepIndex <= 0) {
      return;
    }

    resetIntroTransitionState(overlay);
    introTransitionPending = true;
    setLauncherTransitionLock(overlay, true);
    setIntroContinuePending(overlay, true);

    if (clickedItem) {
      applyPressedState(clickedItem);
    }

    scheduleIntroTransitionStep(() => {
      overlay.classList.add(INTRO_STEP_EXIT_CLASS);
    }, TILE_PRESS_DURATION_MS);

    scheduleIntroTransitionStep(() => {
      overlay.classList.remove(INTRO_STEP_EXIT_CLASS);
      clearPressedStates(overlay);
      currentIntroStepIndex -= 1;
      renderIntroStep(currentIntroStepIndex, overlay);
      overlay.classList.add(INTRO_ENTER_CLASS);
    }, TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS);

    scheduleIntroTransitionStep(
      () => {
        overlay.classList.remove(INTRO_ENTER_CLASS);
        setLauncherTransitionLock(overlay, false);
        setIntroContinuePending(overlay, false);
        introTransitionPending = false;
        getIntroElements(overlay).continueBtn?.focus();
      },
      TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS + INTRO_ENTER_DURATION_MS
    );
  }

  function transitionIntroToLauncherMain(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || introTransitionPending) {
      return;
    }

    resetIntroTransitionState(overlay);
    introTransitionPending = true;
    setLauncherTransitionLock(overlay, true);
    setIntroContinuePending(overlay, true);

    if (clickedItem) {
      applyPressedState(clickedItem);
    }

    scheduleIntroTransitionStep(() => {
      overlay.classList.add(INTRO_STEP_EXIT_CLASS);
    }, TILE_PRESS_DURATION_MS);

    scheduleIntroTransitionStep(() => {
      overlay.classList.remove(INTRO_STEP_EXIT_CLASS);
      clearPressedStates(overlay);
      overlay.classList.add(INTRO_RETURN_CLASS);
      setLauncherIntroState(false, {
        focusContinue: false,
        resetPending: false,
      });
    }, TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS);

    scheduleIntroTransitionStep(
      () => {
        overlay.classList.remove(INTRO_RETURN_CLASS);
        setLauncherTransitionLock(overlay, false);
        setIntroContinuePending(overlay, false);
        setLauncherNewGamePending(overlay, false);
        introTransitionPending = false;
        overlay.querySelector('[data-action="new-game"]')?.focus();
      },
      TILE_PRESS_DURATION_MS + TURNSTILE_DURATION_MS + INTRO_ENTER_DURATION_MS
    );
  }

  function buildDeepseekIntroModules() {
    const nextModules = {};
    const service = window.aiService;
    INTRO_API_PRIMARY_MODULES.forEach(moduleId => {
      nextModules[moduleId] = service?.getDefaultModuleConfig?.(moduleId, 'deepseek') || {
        provider: 'deepseek',
        model: 'deepseek-v4-flash',
        thinking: 'off',
      };
    });
    return nextModules;
  }

  function openSettingsFromIntro() {
    const settingsModal = document.getElementById('settings-modal');
    if (settingsModal) settingsModal.style.zIndex = '400';
    ensureIntroSettingsObserver();
    if (typeof openSettings === 'function') {
      openSettings('api');
    }
  }

  async function saveDeepseekApiKeyFromIntro() {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || introContinuePending || introTransitionPending) return;
    const introCopy = getLauncherCopy().intro;

    const apiKey = String(introApiSetupState.inputValue || '').trim();
    if (!apiKey) {
      introApiSetupState.status = 'error';
      introApiSetupState.message = introCopy.missingApiPrompt;
      introApiSetupState.canContinue = false;
      renderIntroStep(currentIntroStepIndex, overlay);
      return;
    }

    introApiSetupState.status = 'pending';
    introApiSetupState.message = introCopy.apiTesting;
    introApiSetupState.canContinue = false;
    renderIntroStep(currentIntroStepIndex, overlay);
    setIntroContinuePending(overlay, true);

    try {
      const result = await window.aiService?.testApiConnection?.(
        'deepseek',
        apiKey,
        'deepseek-v4-flash'
      );
      if (!result || result.ok !== true) {
        introApiSetupState.status = 'error';
        introApiSetupState.message = introCopy.apiTestFailed(result?.message);
        introApiSetupState.canContinue = false;
        return;
      }

      const currentConfig = window.aiService?.getConfig?.() || {};
      const nextProviderApiKeys = {
        ...(currentConfig.providerApiKeys || {}),
        deepseek: apiKey,
      };
      const nextModules = {
        ...(currentConfig.modules || {}),
        ...buildDeepseekIntroModules(),
      };
      const saveConfigPayload = {
        providerApiKeys: nextProviderApiKeys,
        modules: nextModules,
      };
      // 新手在 intro 里绑定官方 DeepSeek key 后，默认启用推荐模式获得最佳搭配。
      // 守卫：只在 saved mode 不是 'advanced' 时翻到 'recommended'，
      // 防止已经主动选 advanced 的用户被重置（intro 几乎不会撞到，但保守留一手）。
      if (currentConfig.apiSettingsMode !== 'advanced') {
        saveConfigPayload.apiSettingsMode = 'recommended';
      }
      window.aiService?.saveConfig?.(saveConfigPayload);

      introApiSetupState.inputValue = apiKey;
      introApiSetupState.status = 'success';
      introApiSetupState.message = introCopy.apiTestSuccess(result.latency);
      introApiSetupState.canContinue = true;
      introApiSetupState.validatedKey = apiKey;
    } catch (error) {
      introApiSetupState.status = 'error';
      introApiSetupState.message = introCopy.apiTestFailed(error?.message || '');
      introApiSetupState.canContinue = false;
    } finally {
      renderIntroStep(currentIntroStepIndex, overlay);
      setIntroContinuePending(overlay, false);
    }
  }

  async function startNewGameWithLegacyOnboarding(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || introContinuePending || introTransitionPending) return;
    const toastCopy = getLauncherCopy().toast;

    setIntroContinuePending(overlay, true);

    if (!(await ensureWorldCardManagerReady())) {
      setIntroContinuePending(overlay, false);
      return;
    }

    const themeMeta = getIntroThemeChoiceMeta();
    const selectedWorldCardId =
      typeof themeMeta?.worldCardId === 'string' ? themeMeta.worldCardId.trim() : '';
    if (!selectedWorldCardId || themeMeta?.placeholder) {
      if (typeof showToast === 'function') {
        showToast(toastCopy.selectAvailableWorld);
      }
      setIntroContinuePending(overlay, false);
      return;
    }

    if (window.sessionManager && typeof window.sessionManager.startNewGame === 'function') {
      const startResult = await window.sessionManager.startNewGame({
        worldCardId: selectedWorldCardId,
      });
      if (!startResult || startResult.ok === false) {
        if (typeof showToast === 'function') {
          showToast(toastCopy.startNewJourneyFailed(getLauncherReasonText(startResult?.reason)));
        }
        window._launcherIntroThemeChoice = null;
        window._launcherIntroThemeChoiceLabel = '';
        window._showOnboarding = false;
        setIntroContinuePending(overlay, false);
        return;
      }
    } else if (typeof resetGame === 'function') {
      const startResult = await resetGame({ worldCardId: selectedWorldCardId });
      if (!startResult || startResult.ok === false) {
        if (typeof showToast === 'function') {
          showToast(toastCopy.startNewJourneyFailed(getLauncherReasonText(startResult?.reason)));
        }
        window._launcherIntroThemeChoice = null;
        window._launcherIntroThemeChoiceLabel = '';
        window._showOnboarding = false;
        setIntroContinuePending(overlay, false);
        return;
      }
    } else {
      if (typeof showToast === 'function') {
        showToast(toastCopy.sessionManagerUnavailableForStart);
      }
      window._launcherIntroThemeChoice = null;
      window._launcherIntroThemeChoiceLabel = '';
      window._showOnboarding = false;
      setIntroContinuePending(overlay, false);
      return;
    }

    window._launcherIntroThemeChoice = null;
    window._launcherIntroThemeChoiceLabel = '';
    window._showOnboarding = false;
    enterGame();
    hideLauncher(clickedItem);
  }

  function clearLauncherIntroSelections() {
    window._launcherIntroThemeChoice = null;
    window._launcherIntroThemeChoiceLabel = '';
    window._showOnboarding = false;
  }

  async function startNewGameDirectlyFromLauncher(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay) return false;
    const toastCopy = getLauncherCopy().toast;

    setLauncherTransitionLock(overlay, true);
    let keepPendingState = false;

    try {
      let startResult = null;
      if (window.sessionManager && typeof window.sessionManager.startNewGame === 'function') {
        startResult = await window.sessionManager.startNewGame();
      } else if (typeof resetGame === 'function') {
        startResult = await resetGame();
      } else {
        if (typeof showToast === 'function') {
          showToast(toastCopy.sessionManagerUnavailableForStart);
        }
        return false;
      }

      if (!startResult || startResult.ok === false) {
        if (typeof showToast === 'function') {
          showToast(toastCopy.startNewJourneyFailed(getLauncherReasonText(startResult?.reason)));
        }
        return false;
      }

      clearLauncherIntroSelections();
      const successNotice = getDirectStartGameNotice();
      keepPendingState = true;
      hideLauncher(clickedItem, function () {
        try {
          enterGame();
          if (typeof showToast === 'function' && successNotice) {
            showToast(successNotice);
          }
        } finally {
          const latestOverlay = document.getElementById(LAUNCHER_ID);
          setLauncherTransitionLock(latestOverlay, false);
          setLauncherNewGamePending(latestOverlay, false);
        }
      });
      return true;
    } catch (error) {
      if (typeof showToast === 'function') {
        showToast(toastCopy.startNewJourneyFailed(getLauncherReasonText(error?.message)));
      }
      return false;
    } finally {
      if (!keepPendingState) {
        setLauncherTransitionLock(overlay, false);
      }
    }
  }

  async function handleLauncherNewGameAction(clickedItem) {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay || launcherNewGamePending || introContinuePending || introTransitionPending) {
      return;
    }

    setLauncherNewGamePending(overlay, true);
    let keepPendingState = false;

    try {
      if (!(await ensureWorldCardManagerReady())) {
        return;
      }

      if (hasAnySavedApiKey()) {
        const started = await startNewGameDirectlyFromLauncher(clickedItem);
        keepPendingState = started === true;
        if (started) return;
        return;
      }

      transitionLauncherToIntro(clickedItem);
      keepPendingState = introTransitionPending === true;
    } finally {
      if (
        !keepPendingState &&
        !introTransitionPending &&
        !overlay.classList.contains('launcher--hidden')
      ) {
        setLauncherNewGamePending(overlay, false);
      }
    }
  }

  function openIntroNoApiNotice(clickedItem) {
    const copy = getIntroNoApiNoticeCopy();
    const opened =
      typeof window.openTransitionAutosaveModal === 'function'
        ? window.openTransitionAutosaveModal({
            title: copy.title,
            text: copy.text,
            titleIconClass: '',
            showSkip: false,
            cancelText: copy.cancelText,
            cancelOrder: 1,
            overwriteText: copy.confirmText,
            overwriteOrder: 2,
            onOverwrite: () => {
              startNewGameWithLegacyOnboarding(clickedItem);
            },
            onCancel: () => undefined,
          })
        : false;

    if (!opened && typeof showToast === 'function') {
      showToast(copy.fallbackText);
    }
  }

  function showIntroMissingApiKeyPrompt(overlay = null) {
    const root = overlay || document.getElementById(LAUNCHER_ID);
    if (!root) return;

    introApiSetupState.startGameWarnedWithoutApi = true;
    introApiSetupState.status = 'error';
    introApiSetupState.message = getIntroMissingApiKeyPrompt();
    introApiSetupState.canContinue = false;
    updateIntroApiStatusUI(root);
  }

  async function handleIntroAction(clickedItem) {
    const action = clickedItem?.dataset?.action || '';
    const overlay = document.getElementById(LAUNCHER_ID);

    switch (action) {
      case 'intro-back':
        if (currentIntroStepIndex <= 0) {
          transitionIntroToLauncherMain(clickedItem);
          return;
        }
        transitionToPreviousIntroStep(clickedItem);
        return;

      case 'intro-next':
        transitionToNextIntroStep(clickedItem);
        return;

      case 'intro-select-theme':
        const parsedChoice = Number.parseInt(clickedItem?.dataset?.introChoice || '', 10);
        selectedIntroChoice = [1, 2, 3].includes(parsedChoice) ? parsedChoice : null;
        if (selectedIntroChoice) {
          const meta = getIntroThemeChoiceMeta(selectedIntroChoice);
          window._launcherIntroThemeChoice = selectedIntroChoice;
          window._launcherIntroThemeChoiceLabel = meta
            ? isEnglishLauncherLocale()
              ? meta.labelEn || meta.label
              : meta.label
            : '';
          applyIntroThemeFromMeta(meta);
        }
        transitionToNextIntroStep(clickedItem);
        return;

      case 'intro-placeholder':
        return;

      case 'intro-save-api':
        await saveDeepseekApiKeyFromIntro();
        return;

      case 'intro-open-settings':
        openSettingsFromIntro();
        return;

      case 'intro-start-game':
        if (canContinueIntoGameFromIntro()) {
          await startNewGameWithLegacyOnboarding(clickedItem);
          return;
        }
        if (String(introApiSetupState.inputValue || '').trim()) {
          await saveDeepseekApiKeyFromIntro();
          if (canContinueIntoGameFromIntro()) {
            await startNewGameWithLegacyOnboarding(clickedItem);
          }
          return;
        }
        if (!introApiSetupState.startGameWarnedWithoutApi) {
          showIntroMissingApiKeyPrompt(overlay);
          return;
        }
        openIntroNoApiNotice(clickedItem);
        return;
    }
  }

  /**
   * Bind profile bubble micro-interaction on launcher top-right avatar.
   * Guest mode: click to toggle bubble (with future login hint).
   * Signed-in mode (mock): click to open account center.
   */
  function bindProfileBubble(overlay) {
    const profile = overlay.querySelector('.launcher-profile');
    const bubble = overlay.querySelector('#launcher-profile-bubble');
    if (!profile || !bubble) return;

    let autoHideTimer = null;
    let lastTouchTs = 0;

    function clearAutoHide() {
      if (!autoHideTimer) return;
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }

    function hideBubble() {
      bubble.classList.remove('is-visible');
      bubble.setAttribute('aria-hidden', 'true');
      clearAutoHide();
    }

    function showBubble() {
      // Update bubble text with login guidance for guest mode
      const isEn = isEnglishLauncherLocale();
      const guideCn =
        '点击右上角头像 → 账户中心，登录后可使用社区世界卡平台、云同步、计费模型等在线功能。\n\n离线模式下你的所有存档和 API Key 都保存在本地，永久免费。';
      const guideEn =
        'Tap the avatar at the top-right → Account Center to sign in. Online mode unlocks community world cards, cloud sync, and billed models.\n\nIn offline mode all your saves and API keys are stored locally — free forever.';
      bubble.textContent = isEn ? guideEn : guideCn;

      bubble.classList.add('is-visible');
      bubble.setAttribute('aria-hidden', 'false');
      clearAutoHide();
      autoHideTimer = setTimeout(hideBubble, 6500);
    }

    function handleProfileAction(e) {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }

      // If signed in (mock), open account center instead of bubble
      if (window.accountStore && !window.accountStore.isGuest()) {
        hideBubble();
        if (window.accountCenterUI) {
          window.accountCenterUI.open();
        }
        return;
      }

      // Guest mode: toggle bubble
      if (bubble.classList.contains('is-visible')) {
        hideBubble();
      } else {
        showBubble();
      }
    }

    function onProfileClick(e) {
      // iOS Safari: ignore synthetic click right after touchend.
      if (Date.now() - lastTouchTs < 500) return;
      handleProfileAction(e);
    }

    function onProfileTouchEnd(e) {
      lastTouchTs = Date.now();
      e.preventDefault();
      handleProfileAction(e);
    }

    profile.addEventListener('click', onProfileClick);
    profile.addEventListener('touchend', onProfileTouchEnd, { passive: false });

    function closeIfOutside(target) {
      if (!profile.contains(target)) {
        hideBubble();
      }
    }

    overlay.addEventListener('click', function (e) {
      closeIfOutside(e.target);
    });

    overlay.addEventListener('touchstart', function (e) {
      closeIfOutside(e.target);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        hideBubble();
      }
    });
  }

  /**
   * Render changelog data into the changelog modal body.
   */
  async function renderChangelog() {
    const body = document.getElementById('launcher-changelog-body');
    if (!body) return;
    if (!window.changelogService) {
      body.innerHTML =
        '<div class="launcher-credits-section"><p>⚠ changelogService 未加载</p></div>';
      return;
    }

    let source;
    let data;
    try {
      data = await window.changelogService.loadChangelog();
      const locale = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
      source = window.changelogService.getEntriesForLocale(data, locale);
      if (!Array.isArray(source) || source.length === 0) {
        const keys = data ? Object.keys(data).join(',') : '(null)';
        body.innerHTML =
          '<div class="launcher-credits-section"><p>⚠ 无 changelog 条目 (locale=' +
          locale +
          ', keys=' +
          keys +
          ')</p></div>';
        return;
      }
    } catch (e) {
      console.warn('[Launcher] failed to load changelog:', e);
      const msg = String((e && e.message) || e);
      const online = typeof navigator !== 'undefined' ? navigator.onLine : 'n/a';
      const swUrl =
        (typeof navigator !== 'undefined' &&
          navigator.serviceWorker &&
          navigator.serviceWorker.controller &&
          navigator.serviceWorker.controller.scriptURL) ||
        'no-sw';
      body.innerHTML =
        '<div class="launcher-credits-section"><p>⚠ 加载失败：' +
        msg +
        '<br>online=' +
        online +
        '<br>sw=' +
        swUrl +
        '</p></div>';
      return;
    }

    let html = '';
    source.forEach(function (entry) {
      html += '<div class="launcher-credits-section">';
      html += '<h3>v' + entry.version + (entry.date ? ' — ' + entry.date : '') + '</h3>';
      html += '<ul>';
      entry.changes.forEach(function (change) {
        const normalizedChange = String(change).replace(/^[\s•·.]+/, '');
        html += '<li>• ' + normalizedChange + '</li>';
      });
      html += '</ul>';
      html += '</div>';
    });
    body.innerHTML = html;
  }

  /**
   * Initialize the launcher: check save state, bind handlers.
   */
  function initLauncher() {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay) {
      try { window.dispatchEvent(new Event('launcher:ready')); } catch (_) {}
      return;
    }

    resetIntroSteps(overlay);
    ensureIntroSettingsObserver();
    bindProfileBubble(overlay);

    // Bind Credits modal
    (function () {
      const creditsModal = document.getElementById('launcher-credits-modal');
      const creditsLink = document.getElementById('launcher-credits-link');
      if (!creditsModal || !creditsLink) return;

      function openCredits(e) {
        if (e) e.stopPropagation();
        creditsModal.classList.add('is-open');
        creditsModal.setAttribute('aria-hidden', 'false');
      }

      function closeCredits() {
        creditsModal.classList.remove('is-open');
        creditsModal.setAttribute('aria-hidden', 'true');
      }

      creditsLink.addEventListener('click', openCredits);

      creditsModal
        .querySelector('.launcher-credits-close')
        ?.addEventListener('click', closeCredits);

      creditsModal
        .querySelector('.launcher-credits-backdrop')
        ?.addEventListener('click', closeCredits);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && creditsModal.classList.contains('is-open')) {
          closeCredits();
        }
      });
    })();

    // Bind Changelog modal
    (function () {
      const changelogModal = document.getElementById('launcher-changelog-modal');
      const changelogLink = document.getElementById('launcher-changelog-link');
      if (!changelogModal || !changelogLink) return;

      renderChangelog();

      function openChangelog(e) {
        if (e) e.stopPropagation();
        changelogModal.classList.add('is-open');
        changelogModal.setAttribute('aria-hidden', 'false');
        try {
          window.analyticsService?.trackOnce?.(
            'feature.changelog_viewed',
            {},
            'feature.changelog_viewed'
          );
        } catch (_) { /* noop */ }
      }

      function closeChangelog() {
        changelogModal.classList.remove('is-open');
        changelogModal.setAttribute('aria-hidden', 'true');
      }

      changelogLink.addEventListener('click', openChangelog);

      changelogModal
        .querySelector('.launcher-credits-close')
        ?.addEventListener('click', closeChangelog);

      changelogModal
        .querySelector('.launcher-credits-backdrop')
        ?.addEventListener('click', closeChangelog);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && changelogModal.classList.contains('is-open')) {
          closeChangelog();
        }
      });
    })();

    // Update "Continue" button state
    syncContinueButtonState(overlay);
    ensureWorldCardManagerReady({ showToastOnFail: false }).finally(() => {
      syncContinueButtonState(overlay);
    });

    overlay.addEventListener('input', function (e) {
      if (e.target?.id !== 'launcher-api-key-input') return;
      const introCopy = getLauncherCopy().intro;
      introApiSetupState.inputValue = e.target.value;
      const trimmedValue = e.target.value.trim();
      if (
        introApiSetupState.status === 'success' &&
        trimmedValue !== introApiSetupState.validatedKey
      ) {
        introApiSetupState.status = hasAnySavedApiKey() ? 'dirty' : 'idle';
        introApiSetupState.message = hasAnySavedApiKey()
          ? introCopy.apiDirtyWithSavedKey
          : introCopy.apiDirtyWithoutSavedKey;
        introApiSetupState.canContinue = hasAnySavedApiKey();
        updateIntroApiStatusUI(overlay);
        return;
      }
      if (introApiSetupState.status === 'error') {
        introApiSetupState.status = 'idle';
        introApiSetupState.message = '';
        introApiSetupState.canContinue = false;
        updateIntroApiStatusUI(overlay);
      }
    });

    overlay.addEventListener('click', async function (e) {
      const pasteBtn = e.target.closest('[data-action~="launcher-intro-api-paste-btn"]');
      if (!pasteBtn) return;
      const input = overlay.querySelector('#launcher-api-key-input');
      if (!input) return;

      function onPasteSuccess(text) {
        input.value = text.trim();
        pasteBtn.classList.add('launcher-intro-api-paste-btn--success');
        const icon = pasteBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = 'check';
        setTimeout(() => {
          pasteBtn.classList.remove('launcher-intro-api-paste-btn--success');
          if (icon) icon.textContent = 'content_paste';
        }, 1500);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Strategy 1: Clipboard API
      if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
        try {
          const text = await navigator.clipboard.readText();
          if (text) { onPasteSuccess(text); return; }
        } catch (_) { /* fallback */ }
      }

      // Strategy 2: execCommand('paste')
      try {
        const result = await new Promise((resolve) => {
          const ta = document.createElement('textarea');
          ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;width:1px;height:1px;';
          document.body.appendChild(ta);
          const onPaste = (ev) => {
            const t = (ev.clipboardData || window.clipboardData)?.getData('text') || '';
            ev.preventDefault();
            ta.removeEventListener('paste', onPaste);
            document.body.removeChild(ta);
            resolve(t);
          };
          ta.addEventListener('paste', onPaste);
          ta.focus();
          const ok = document.execCommand('paste');
          if (!ok) {
            ta.removeEventListener('paste', onPaste);
            if (ta.parentNode) document.body.removeChild(ta);
            resolve('');
          } else {
            setTimeout(() => {
              ta.removeEventListener('paste', onPaste);
              if (ta.parentNode) document.body.removeChild(ta);
              resolve('');
            }, 100);
          }
        });
        if (result) { onPasteSuccess(result); return; }
      } catch (_) { /* fallback */ }

      // Strategy 3: focus input for manual paste
      input.focus();
      input.select();
      if (typeof showToast === 'function') {
        showToast(isEnglishLauncherLocale() ? 'Please long-press the input to paste' : '请长按输入框粘贴');
      }
    });

    window.addEventListener('ui-language-changed', () => {
      const themeMeta = getIntroThemeChoiceMeta(selectedIntroChoice);
      window._launcherIntroThemeChoiceLabel = themeMeta
        ? isEnglishLauncherLocale()
          ? themeMeta.labelEn || themeMeta.label
          : themeMeta.label
        : '';
      syncLauncherPreviewTexts(overlay);
      renderIntroStep(currentIntroStepIndex, overlay);
      syncContinueButtonState(overlay);
      if (document.getElementById('launcher-changelog-modal')?.classList.contains('is-open')) {
        renderChangelog();
      }
    });

    // Event delegation for nav items
    overlay.addEventListener('click', async function (e) {
      const item = e.target.closest('[data-action]');
      if (!item || item.classList.contains('launcher-nav--disabled')) return;

      const action = item.dataset.action;

      switch (action) {
        case 'new-game':
          await handleLauncherNewGameAction(item);
          break;

        case 'intro-back':
        case 'intro-next':
        case 'intro-select-theme':
        case 'intro-placeholder':
        case 'intro-save-api':
        case 'intro-open-settings':
        case 'intro-start-game':
          await handleIntroAction(item);
          break;

        case 'continue':
          if (!(await ensureWorldCardManagerReady())) return;
          const preferredWorldCardId = await getPreferredContinueWorldId();
          window._skipLauncherGameSeedOnce = true;
          hideLauncher(item, function () {
            enterGame();
            requestAnimationFrame(function () {
              if (typeof openSaveManager === 'function') {
                // saves 现在是 stage，openSaveManager 内部走 stageRouter 导航
                openSaveManager(
                  preferredWorldCardId ? { preferredWorldCardId } : {}
                );
              }
            });
          });
          break;

        case 'design-mode':
          if (!(await ensureWorldCardManagerReady())) return;
          _runDesignModeTransitionFlow(item);
          break;

        case 'qq-group':
          window.open(QQ_GROUP_URL, '_blank');
          break;

        case 'settings':
          // Bump settings modal z-index so it appears above the launcher
          const settingsModal = document.getElementById('settings-modal');
          if (settingsModal) settingsModal.style.zIndex = '400';
          if (typeof openSettings === 'function') openSettings('api');
          break;
      }
    });

    try { window.dispatchEvent(new Event('launcher:ready')); } catch (_) {}
  }

  // Flag for game.js to detect launcher presence
  window._launcherVisible = true;
  window.showLauncherOverlay = showLauncherOverlay;

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLauncher);
  } else {
    queueMicrotask(initLauncher);
  }
})();
