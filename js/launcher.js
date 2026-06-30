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
    // 草稿态 gate 的 reason 在游戏内指向「应用到游戏 / 放弃编辑」按钮，但 launcher 上没有这些入口——
    // 换成 launcher 语境文案，别指向不存在的按钮（bug7）。
    if (rawReason.includes('正在编辑中')) {
      return isEnglishLauncherLocale()
        ? 'This world card has unsaved edits and cannot start a new game here. Open it in the game and finish or discard the edits in the card library.'
        : '这张世界卡正在编辑中，暂时无法在此开始新游戏（请在游戏内的卡库里完成或放弃编辑）。';
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
    '';
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

  // 「正在编辑中的世界卡」（design_mode_editing_card_id 指针，loadCardIntoDesignMode 写）：
  // PZWC 建完落库 / 编辑已有卡的会话不走 design_mode_* 草稿键，hasRestorableDesignDraft 看不见它。
  // 指针只在卡仍处草稿态（_editDraft 在）时有效——应用/放弃/删卡后此处返回 null。
  // 点击入口后游戏内 mode-toggle 的自动接回（game.js _readPendingCardEditResumeId）会恢复会话，
  // 这里只负责让首页文案不撒谎（否则玩家看到「设计新世界」会以为建造成果丢了）。
  function getPendingCardEditInfo() {
    try {
      const id = localStorage.getItem('design_mode_editing_card_id');
      if (!id) return null;
      const card = window.worldCardManager?.get?.(id);
      const draft = card ? card._editDraft : null;
      if (!draft || typeof draft !== 'object' || Array.isArray(draft) || !Object.keys(draft).length) {
        return null;
      }
      return { id, name: card.name || '' };
    } catch (_) {
      return null;
    }
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
    // 优先级：建造/新建草稿（hasDraft，恢复路径也是它优先）＞ 编辑中的卡 ＞ 新建
    const pendingEdit = hasDraft ? null : getPendingCardEditInfo();
    if (cnLabel) {
      cnLabel.textContent = hasDraft ? '继续设计草稿' : pendingEdit ? '继续编辑世界卡' : '设计新世界';
    }
    if (enLabel) {
      enLabel.textContent = hasDraft
        ? 'Continue Design Draft'
        : pendingEdit
          ? 'Continue Editing'
          : 'Design New World';
    }
    designBtn.classList.toggle('launcher-nav--draft', hasDraft || !!pendingEdit);
    if (hasDraft) {
      designBtn.setAttribute(
        'title',
        isEnglishLauncherLocale() ? 'Continue Design Draft' : '继续设计草稿'
      );
    } else if (pendingEdit) {
      designBtn.setAttribute(
        'title',
        isEnglishLauncherLocale()
          ? `Continue editing "${pendingEdit.name}"`
          : `继续编辑「${pendingEdit.name}」`
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
      // 进游戏后暂停动态壁纸：display:none 在部分浏览器（Firefox）不会停止视频解码，整局持续耗电。
      // 暂停 + 撤 is-playing：返回 launcher 时显示静态封面（图相同、无功能损失），下次整页刷新自然恢复动效。
      try {
        const v = el.querySelector('#launcher-bg-video');
        if (v) { v.pause(); v.classList.remove('is-playing'); }
      } catch (_) { }
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

  // ============================================
  // 新手配置防呆：检测"配了自定义服务商但游戏还在用默认 DeepSeek"
  // 触发条件 + 一键切换弹窗。详见 内部设计文档。
  // ============================================
  const _MISCONFIG_NUDGE_DISMISSED_KEY = 'newbieMisconfigNudge.dismissedSig';

  // 简短稳定签名：custom provider id + key 末 4 位 + providerApiKeys 末 4 位
  // 任一变化就触发新签名，"不再提醒"自动失效，重新弹一次
  function _buildApiMisconfigSignature(config) {
    const cps = Array.isArray(config?.customProviders) ? config.customProviders : [];
    const keys =
      config?.providerApiKeys && typeof config.providerApiKeys === 'object'
        ? config.providerApiKeys
        : {};
    // customProvider 对象没有 key 字段；key 在 providerApiKeys[cp.id] 里
    const cpStr = cps
      .map(cp => {
        const id = cp?.id || '';
        const cpKey = String((id && keys[id]) || '').slice(-4);
        return `${id}:${cpKey}`;
      })
      .sort()
      .join('|');
    const keyStr = Object.keys(keys)
      .sort()
      .map(k => `${k}:${String(keys[k] || '').slice(-4)}`)
      .join('|');
    return `cps[${cpStr}]/pak[${keyStr}]`;
  }

  function _hasApiMisconfigSignal() {
    const ai = window.aiService;
    if (!ai || typeof ai.getConfig !== 'function') return null;
    const config = ai.getConfig() || {};
    const customProviders = Array.isArray(config.customProviders) ? config.customProviders : [];
    const providerApiKeys = config.providerApiKeys || {};
    const customWithKey = customProviders.filter(cp => {
      const id = cp?.id;
      if (!id) return false;
      const key = providerApiKeys[id];
      return typeof key === 'string' && key.trim().length > 0;
    });
    if (customWithKey.length === 0) return null;

    let routedToDefault = false;
    try {
      const mode =
        typeof ai.getEffectiveApiSettingsMode === 'function'
          ? ai.getEffectiveApiSettingsMode()
          : null;
      // 推荐模式：所有 phase 被 hijack 到 DeepSeek，自定义没在用
      if (mode === 'recommended') {
        routedToDefault = true;
      } else if (
        typeof ai.getProviderForModule === 'function' &&
        ai.getProviderForModule('react') === 'deepseek'
      ) {
        // simple/advanced 模式：主路径模型还是 deepseek（默认未改）
        routedToDefault = true;
      }
    } catch (_) {
      return null;
    }
    if (!routedToDefault) return null;
    return { customWithKey };
  }

  // 切到 simple 模式 + 把 5 个 top-level module 的 provider/model 全部指向目标自定义服务商
  // aliasMap 让 iter*/p1-p3 等子 key 都回落到这 5 个之一，不用逐个写
  function _applyMisconfigSwitch(targetProvider) {
    if (!targetProvider?.id || !window.aiService) return false;
    const ai = window.aiService;
    const config =
      (typeof ai.getConfig === 'function' ? ai.getConfig() : ai.config) || {};
    const modules = { ...(config.modules || {}) };
    const targetModel = targetProvider.defaultModel || targetProvider.model || '';
    ['react', 'sms', 'summary', 'chapter', 'design'].forEach(modKey => {
      const prev = modules[modKey] || {};
      modules[modKey] = {
        ...prev,
        provider: targetProvider.id,
        model: targetModel || prev.model || '',
      };
    });
    try {
      ai.saveConfig({ apiSettingsMode: 'simple', modules });
      return true;
    } catch (_) {
      return false;
    }
  }

  function _maybeShowApiMisconfigNudge(continueCb) {
    const proceed = () => {
      try {
        if (typeof continueCb === 'function') continueCb();
      } catch (_) { }
    };

    // 在线模式：API 由站点提供，离线自带密钥模式相关提示一律跳过
    try {
      if (window.accountStore?.isSignedIn?.() === true) return proceed();
    } catch (_) { }

    const signal = _hasApiMisconfigSignal();
    if (!signal) return proceed();

    let signature = '';
    try {
      const config = window.aiService?.getConfig?.() || {};
      signature = _buildApiMisconfigSignature(config);
      if (signature && localStorage.getItem(_MISCONFIG_NUDGE_DISMISSED_KEY) === signature) {
        return proceed();
      }
    } catch (_) { }

    if (typeof window.showConfirmModal !== 'function') return proceed();

    const isEn = isEnglishLauncherLocale();
    const customWithKey = signal.customWithKey;
    const first = customWithKey[0];
    const isSingle = customWithKey.length === 1;

    const esc = s =>
      String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const firstName = first?.name || first?.id || (isEn ? 'Custom provider' : '自定义服务商');

    const bodyParts = [];
    if (isSingle) {
      bodyParts.push(
        isEn
          ? `You added the custom provider "<b>${esc(firstName)}</b>", but the game is still pointed at the default <b>DeepSeek</b> — turns won't go through "${esc(firstName)}".`
          : `你配置了自定义服务商「<b>${esc(firstName)}</b>」，但游戏当前激活的还是默认的 <b>DeepSeek</b>——回合不会经过「${esc(firstName)}」。`
      );
      bodyParts.push(
        isEn
          ? `If "${esc(firstName)}" is the one you want to use, switch it in Settings → API.`
          : `如果「${esc(firstName)}」是你想用的，可以在设置 - API 设置中切换。`
      );
    } else {
      const optsHtml = customWithKey
        .map(
          (cp, i) =>
            `<option value="${esc(cp.id)}"${i === 0 ? ' selected' : ''}>${esc(cp.name || cp.id)}</option>`
        )
        .join('');
      bodyParts.push(
        isEn
          ? `You added <b>${customWithKey.length}</b> custom providers with API keys, but the game is still pointed at the default <b>DeepSeek</b> — turns won't go through any of them.`
          : `你配置了 <b>${customWithKey.length}</b> 个带 key 的自定义服务商，但游戏当前激活的还是默认的 <b>DeepSeek</b>——回合不会经过它们任何一个。`
      );
      bodyParts.push(
        (isEn ? 'Pick one to switch to:' : '选一个切换过去：') +
        `<div style="margin-top:8px"><select id="misconfig-nudge-pick" class="form-input">${optsHtml}</select></div>`
      );
    }

    const newbieHint = isEn
      ? 'This reminder is mainly for first-time setup — if you know what you’re doing, just dismiss it.'
      : '这个提醒是给新手准备的——如果你清楚自己在做什么，忽略即可。';
    bodyParts.push(
      `<div style="margin-top:14px;font-size:12px;color:var(--text-soft);font-style:italic">${esc(newbieHint)}</div>`
    );

    const dismissLabel = isEn ? "Don't remind me again" : '不再提醒';
    bodyParts.push(
      `<label style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:13px;color:var(--text-soft);cursor:pointer">` +
      `<input type="checkbox" id="misconfig-nudge-dismiss" style="margin:0" />` +
      `<span>${esc(dismissLabel)}</span>` +
      `</label>`
    );

    const switchLabel = isEn
      ? isSingle
        ? `Switch to "${firstName}"`
        : 'Switch to selected'
      : isSingle
        ? `切换到「${firstName}」`
        : '切换到所选';
    const keepLabel = isEn ? 'Keep current' : '保持现状';
    const title = isEn
      ? 'Your custom provider is not in use'
      : '刚配置的服务商没有被使用';

    const onConfirm = () => {
      let target = first;
      if (!isSingle) {
        try {
          const sel = document.getElementById('misconfig-nudge-pick');
          const chosenId = sel?.value;
          target = customWithKey.find(cp => cp.id === chosenId) || first;
        } catch (_) { }
      }
      _applyMisconfigSwitch(target);
      proceed();
    };
    const onCancel = () => {
      try {
        const dismiss = document.getElementById('misconfig-nudge-dismiss')?.checked;
        if (dismiss && signature) {
          localStorage.setItem(_MISCONFIG_NUDGE_DISMISSED_KEY, signature);
        }
      } catch (_) { }
      proceed();
    };

    try {
      window.showConfirmModal(title, '', onConfirm, onCancel, {
        icon: 'help',
        descriptionHtml: bodyParts.join('<br/>'),
        confirmLabel: switchLabel,
        cancelLabel: keepLabel,
      });
    } catch (_) {
      proceed();
    }
  }

  /**
   * Enter the main game after hiding the launcher.
   */
  function enterGame() {
    _maybeShowApiMisconfigNudge(() => {
      if (typeof window._launcherGameInit === 'function') {
        window._launcherGameInit();
      }
    });
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
    // 提前标记 design mode，让 sessionManager.resetSessionState 内部调的
    // refreshChatUI({scrollMode:'bottom'}) 走 design 闸（走 preserve 分支不滚到底）。
    // 完整 mode 切换在后面 activateDesignMode → modeToggle.click() 完成，
    // stageRouter._apply 会幂等地再写一次同样值。
    const _gameScreenForDesignFlag = document.getElementById('game-screen');
    if (_gameScreenForDesignFlag) {
      _gameScreenForDesignFlag.setAttribute('data-active-mode', 'design');
    }
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

      // f3「选了世界卡」：自定义/已存世界卡直接开局也算这一步（之前只有内置 intro 主题报 f3，这条路漏了 → 漏斗偏）
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

    // launcher 专属精简 dropdown：复用 #launcher-profile-bubble 弹层骨架，
    // 内容换成菜单。账户中心已迁为游戏内 stage，所以入口要先 enterGame 再切过去。
    function buildMenu() {
      const isEn = isEnglishLauncherLocale();
      const signed = !!(window.accountStore && !window.accountStore.isGuest());
      const acctLabel = isEn ? 'Account Center' : '账户中心';
      const signOutLabel = isEn ? 'Sign out' : '退出登录';
      const guideCn =
        '本游戏无需注册：离线模式下你的所有存档和 API Key 都保存在本地，永久免费。';
      const guideEn =
        'No signup needed — in offline mode all saves & API keys stay on your device, free forever.';
      let html = '<div class="launcher-profile-menu" role="menu">';
      if (signed) {
        html +=
          `<button class="launcher-profile-menu-item launcher-profile-menu-item--danger" data-lp-action="signout" role="menuitem" type="button">` +
          `<span class="material-symbols-outlined">logout</span><span>${signOutLabel}</span></button>`;
      } else {
        html += `<div class="launcher-profile-menu-hint">${isEn ? guideEn : guideCn}</div>`;
      }
      html += '</div>';
      return html;
    }

    // enterGame 后等游戏屏就绪再切到账户 stage（带重试，最多 ~2s）
    function goToAccountStage() {
      enterGame();
      let tries = 0;
      (function attempt() {
        tries += 1;
        const gs = document.getElementById('game-screen');
        const visible = gs && getComputedStyle(gs).display !== 'none';
        if (window.accountCenterUI && window.stageRouter && visible) {
          window.accountCenterUI.open();
          return;
        }
        if (tries < 20) setTimeout(attempt, 100);
      })();
    }

    function bindMenu() {
      bubble.querySelectorAll('[data-lp-action]').forEach(item => {
        item.addEventListener('click', ev => {
          ev.stopPropagation();
          const action = item.getAttribute('data-lp-action');
          hideBubble();
          if (action === 'account') {
            goToAccountStage();
          } else if (action === 'signout') {
            Promise.resolve(window.accountStore?.signOut?.()).catch(() => { });
          }
        });
      });
    }

    function showBubble() {
      bubble.innerHTML = buildMenu();
      bindMenu();
      bubble.classList.add('is-visible');
      bubble.setAttribute('aria-hidden', 'false');
      // 菜单不自动消失——靠点外部 / Esc / 选项关闭
      clearAutoHide();
    }

    function handleProfileAction(e) {
      if (e && typeof e.stopPropagation === 'function') {
        e.stopPropagation();
      }
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

    // changelog = 全量倒序平铺：每个版本一个块（v<版本> — <日期> + dot-point），最新在前。
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
   * 动态壁纸：在静态封面之上懒加载循环视频并淡入。
   * 三道门控，任一不满足即保持静态封面、不下载视频：
   *   1. 系统「减弱动态效果」(prefers-reduced-motion) — CSS 已隐藏，这里也不加载
   *   2. 省流量模式 / 极慢网络 (Network Information API: saveData / 2g)
   *   3. 浏览器拦截自动播放（如 iOS 低电量）— play() 静默失败，保持静态封面
   * 下载推迟到 requestIdleCallback，确保静态封面先出，绝不拖慢首屏。
   */
  function initLauncherBgVideo(overlay) {
    const video = overlay.querySelector('#launcher-bg-video');
    if (!video || !video.dataset.src) return;

    // 门控 0：已知会强制把 <video> 接管成全屏的国产内核（小米自带浏览器 / 腾讯 X5·TBS）
    // → 直接保持静态封面、根本不下载视频。标准 playsinline 在这些内核上无效，且小米端
    // 没有任何可关掉接管的属性（x5-*/t7-* 是别家内核专用、对小米惰性无效）。按"劫持内核"
    // 判定（TBS/MQQBrowser/MiuiBrowser），不按"App"(MicroMessenger) 判定——iOS 微信走
    // WebKit、遵守 playsinline、不劫持，误伤它等于白白关掉本可正常行内播放的视频。
    // 背景视频纯装饰，退回静态封面零功能损失。
    try {
      const ua = navigator.userAgent || '';
      if (/\bTBS\/\d/i.test(ua) || /MQQBrowser/i.test(ua) || /MiuiBrowser/i.test(ua)) {
        return;
      }
    } catch (_) { }

    // 门控 1：减弱动态效果
    try {
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
      }
    } catch (_) { }

    // 门控 2：省流量 / 极慢网络
    try {
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (conn) {
        if (conn.saveData) return;
        const et = conn.effectiveType || '';
        if (et === 'slow-2g' || et === '2g') return;
      }
    } catch (_) { }

    // 768px 以下（手机竖屏）用竖版片源；否则用横版
    let narrow = false;
    try { narrow = window.matchMedia('(max-width: 767.98px)').matches; }
    catch (_) { narrow = (window.innerWidth || 0) < 768; }
    const chosenSrc = (narrow && video.dataset.srcNarrow) ? video.dataset.srcNarrow : video.dataset.src;

    let started = false;
    const start = () => {
      if (started) return;
      // 用户已进游戏（launcher 已隐藏）→ idle 回调别再把整段 mp4 下进隐藏元素，纯浪费带宽/电量
      if (window._launcherVisible === false || overlay.classList.contains('launcher--hidden')) return;
      started = true;
      // 只在真正开始播放（playing）时揭示——不挂 canplay：canplay 只看缓冲、与 play() 是否成功无关，
      // 自动播放被拦时（如 iOS 低电量）canplay 仍会触发并露出一个暂停的冻结首帧，违反「被拦即退静态封面」。
      const reveal = () => video.classList.add('is-playing');
      video.addEventListener('playing', reveal, { once: true });
      // 部分浏览器需在 JS 侧再次确认 muted/playsInline 才放行自动播放
      video.muted = true;
      video.playsInline = true;
      // X5·TBS 同层「页面内播放」（与 HTML 属性呼应；非 X5 内核惰性忽略，无害）。
      // 用 h5-page 而非 h5：h5 是沉浸式同层全屏，会把视频层顶到最上盖住 launcher UI。
      try { video.setAttribute('x5-video-player-type', 'h5-page'); } catch (_) { }
      // 运行时安全网：任何漏过门控 0 的内核仍把视频顶全屏 → 暂停 + 退全屏 + 露出静态封面。
      // 这是有意的 degrade-to-cover：不尝试恢复播放（与劫持内核反复打架会闪屏，更糟）。
      const bailFullscreen = () => {
        try { video.pause(); } catch (_) { }
        // 标准 Fullscreen API（exitFullscreen 返回 promise，未在全屏时会 reject，需吞掉）
        try { const r = document.exitFullscreen && document.exitFullscreen(); if (r && r.catch) r.catch(() => { }); } catch (_) { }
        // iOS / 旧 WebKit 原生视频全屏：标准 API 不接管此路径，只能用元素级 webkitExitFullscreen
        try { if (video.webkitExitFullscreen) video.webkitExitFullscreen(); } catch (_) { }
        video.classList.remove('is-playing');
      };
      video.addEventListener('webkitbeginfullscreen', bailFullscreen); // iOS / 旧 WebKit
      document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement === video) bailFullscreen();
      });
      video.src = chosenSrc;
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        // 门控 3：自动播放被拦 → 不强求，保持静态封面
        p.catch(() => { });
      }
    };

    // 推迟到空闲：静态封面先渲染，视频不抢首屏带宽
    if (window.requestIdleCallback) {
      window.requestIdleCallback(start, { timeout: 1500 });
    } else {
      setTimeout(start, 300);
    }
  }

  /**
   * Initialize the launcher: check save state, bind handlers.
   */
  function initLauncher() {
    const overlay = document.getElementById(LAUNCHER_ID);
    if (!overlay) {
      try { window.dispatchEvent(new Event('launcher:ready')); } catch (_) { }
      return;
    }

    resetIntroSteps(overlay);
    ensureIntroSettingsObserver();
    bindProfileBubble(overlay);
    initLauncherBgVideo(overlay);

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

    try { window.dispatchEvent(new Event('launcher:ready')); } catch (_) { }
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
