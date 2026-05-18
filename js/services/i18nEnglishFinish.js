(function () {
  'use strict';

  function isEnglish() {
    return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  }

  function setText(selector, zh, en) {
    document.querySelectorAll(selector).forEach(node => {
      node.textContent = isEnglish() ? en : zh;
    });
  }

  function setHtml(selector, zh, en) {
    document.querySelectorAll(selector).forEach(node => {
      node.innerHTML = isEnglish() ? en : zh;
    });
  }

  function setAttr(selector, attr, zh, en) {
    document.querySelectorAll(selector).forEach(node => {
      node.setAttribute(attr, isEnglish() ? en : zh);
    });
  }

  function applyStaticEnglishFinish() {
    setText('#info-tile-btn span:not(.material-symbols-outlined):not(.header-badge)', '信息', 'Info');
    setAttr('#info-tile-btn', 'title', '角色 / 主角 / 总结', 'Characters / Protagonist / Summary');
    setText('#phone-btn span:last-child', '短信', 'Messages');
    setText('#save-manager-btn span:last-child', '存档', 'Saves');
    setText('#reset-btn span:last-child', '重置', 'Reset');
    // v3.5：原 #avatar-btn 已删，dropdown trigger 改由 .avatar-trigger（设计 mode header /
    // 手机底栏 stage-nav 最右那个）承担
    setText('.avatar-trigger > span:not(.material-symbols-outlined)', '账户', 'Account');
    setAttr('.avatar-trigger', 'title', '账户与设置', 'Account & Settings');

    setHtml(
      '#design-chat-header .tab[data-view="chat"]',
      '<span class="material-symbols-outlined">chat</span>对话模式',
      '<span class="material-symbols-outlined">chat</span>Chat'
    );
    setHtml(
      '#design-chat-header .tab[data-view="card"]',
      '<span class="material-symbols-outlined">dashboard</span>卡片式预览',
      '<span class="material-symbols-outlined">dashboard</span>Card Preview'
    );
    setHtml(
      '#design-chat-header .tab[data-view="code"]',
      '<span class="material-symbols-outlined">data_object</span>代码预览',
      '<span class="material-symbols-outlined">data_object</span>Code Preview'
    );
    setHtml(
      '#design-apply-btn',
      '<span class="material-symbols-outlined">play_arrow</span>应用到游戏',
      '<span class="material-symbols-outlined">play_arrow</span>Apply to Game'
    );

    setText('#summary-tile .sidebar-tile-title', '剧情总结', 'Story Summary');
    setHtml(
      '#summary-stats-inline',
      '章节：<strong id="stat-chapters">0</strong>&emsp;剧情：<strong id="stat-turns">0</strong>',
      'Chapters: <strong id="stat-chapters">0</strong>&emsp;Turns: <strong id="stat-turns">0</strong>'
    );
    setHtml(
      '.summary-empty-text',
      '开始冒险后<br />这里会显示每次剧情的总结',
      'Once your adventure starts,<br />story summaries will appear here'
    );

    setText('#confirm-modal-title-text', '重置冒险', 'Reset Adventure');
    setText(
      '#confirm-modal .modal-description',
      '确定要重置吗？所有对话记录将被清除。',
      'Reset now? All chat history will be cleared.'
    );
    setText('#transition-autosave-title', '自动保存冲突', 'Auto-save Conflict');
    setText(
      '#transition-autosave-text',
      '当前流程自动保存失败，请选择处理方式。',
      'Automatic save failed for the current flow. Choose how to continue.'
    );
    setText('#transition-autosave-overwrite-btn', '手动选槽位覆盖', 'Choose a Slot to Overwrite');
    setText('#debug-modal #close-debug-btn', '关闭', 'Close');
    setHtml(
      '#debug-modal #copy-debug-btn',
      '<span class="icon icon-copy"></span> 复制',
      '<span class="icon icon-copy"></span> Copy'
    );
    setHtml(
      '#debug-modal #export-debug-btn',
      '<span class="material-symbols-outlined">download</span> 导出',
      '<span class="material-symbols-outlined">download</span> Export'
    );
    setAttr('#sms-debug-btn', 'title', '查看 SMS Payload', 'View SMS Payload');
    setText('#phone-title', '短信', 'Messages');
    setText(
      '#sms-delete-confirm-modal .sms-confirm-text',
      '确定要删除这条消息吗？',
      'Delete this message?'
    );
    setText('#sms-delete-cancel-btn', '取消', 'Cancel');
    setText('#sms-delete-confirm-btn', '删除', 'Delete');
    setText('#sms-delete-conv-cancel-btn', '取消', 'Cancel');
    setText('#sms-delete-conv-confirm-btn', '删除', 'Delete');

    setText('#map-modal h2', '世界地图', 'World Map');
    setText('#map-stat-locations', '地点: 0', 'Locations: 0');
    setText('#map-info-panel .terrain-type', '自然地形', 'Natural Terrain');
    setText(
      '#map-info-panel .map-info-description',
      '广袤的草原，适合行走和放牧',
      'Wide open grassland, good for travel and grazing'
    );
    setText('#map-legend h4', '自然地形', 'Natural Terrain');
    setText('#map-legend h4[style]', '人造地形', 'Built Terrain');
    setText('#map-legend .map-legend-item:nth-of-type(1) span', '草地', 'Grassland');
    setText('#map-legend .map-legend-item:nth-of-type(2) span', '森林', 'Forest');
    setText('#map-legend .map-legend-item:nth-of-type(3) span', '山地/丘陵', 'Mountain / Hills');
    setText('#map-legend .map-legend-item:nth-of-type(4) span', '深水', 'Deep Water');
    setText('#map-legend .map-legend-item:nth-of-type(5) span', '浅水', 'Shallow Water');
    setText('#map-legend .map-legend-item:nth-of-type(6) span', '沙漠', 'Desert');
    setText('#map-legend .map-legend-item:nth-of-type(7) span', '雪地', 'Snowfield');
    setText('#map-legend .map-legend-item:nth-of-type(8) span', '废墟', 'Ruins');
    setText('#map-legend .map-legend-item:nth-of-type(9) span', '首都', 'Capital');
    setText('#map-legend .map-legend-item:nth-of-type(10) span', '城市', 'City');
    setText('#map-legend .map-legend-item:nth-of-type(11) span', '村庄', 'Village');
    setText('#map-legend .map-legend-item:nth-of-type(12) span', '道路', 'Road');

    // Saves stage（V2 手风琴）静态文案——saves 是 stage，不再有 #save-manager-modal scope
    setHtml(
      '.saves-head-title',
      '<span>世界卡</span><span class="saves-head-sep">·</span><span>存档</span>',
      '<span>World Cards</span><span class="saves-head-sep">·</span><span>Saves</span>'
    );
    setAttr('[data-saves-sort]', 'title', '切换排序', 'Switch sort order');
    setText('#import-world-card-btn .saves-import-label', '导入世界卡', 'Import World Card');
    setAttr('#import-world-card-btn', 'title', '导入世界卡', 'Import World Card');
    setText('[data-saves-filter="all"]', '全部', 'All');
    setText('[data-saves-filter="purchased"]', '已购买', 'Purchased');
    setText('[data-saves-filter="local"]', '本地', 'Local');
    setText('[data-saves-filter="builtin"]', '内置', 'Built-in');

    // Stage Router: 5 + 4 stage（v3.5 起 design mode 不再有 account stage——它被改成 .avatar-trigger
    // dropdown trigger，文字"账户"由上面 .avatar-trigger selector 单独翻译）。
    // 两份（header + 手机底栏）querySelectorAll 一次都覆盖
    const stageNavLabels = [
      ['sms', '短信', 'Messages'],
      ['cast', '角色', 'Cast'],
      ['story', '剧情', 'Story'],
      ['inventory', '物品', 'Inventory'],
      ['map', '地图', 'Map'],
      ['preview', '预览', 'Preview'],
      ['design', '设计模式', 'Design Mode'],
      ['saves', '存档', 'Saves'],
      ['square', '广场', 'Square'],
    ];
    stageNavLabels.forEach(([target, zh, en]) => {
      setText(
        `.stage-nav-btn[data-stage-target="${target}"] > span:not(.material-symbols-outlined):not(.header-badge):not(.square-btn-lock)`,
        zh,
        en
      );
      // 侧栏 stage 切换 tab（v3.5）—— 复用同一组 zh/en
      setText(
        `.side-stage-tab[data-side-stage-target="${target}"] > span:not(.material-symbols-outlined)`,
        zh,
        en
      );
    });
    // sub-tab：剧情舞台 dialog/summary + 预览舞台 worldcard/card/code
    // 主舞台用全名；侧栏 380px 装不下全名，card/code 缩到 2 字
    const substageLabels = [
      ['dialog',    '当前对话',   'Current',    '当前对话',   'Current'],
      ['summary',   '章节总结',   'Chapters',   '章节总结',   'Chapters'],
      ['worldcard', '世界卡信息', 'World Card', '世界卡信息', 'World Card'],
      ['card',      '卡片式预览', 'Card',       '卡片',       'Card'],
      ['code',      '代码预览',   'Code',       '代码',       'Code'],
    ];
    substageLabels.forEach(([target, mainZh, mainEn, sideZh, sideEn]) => {
      setText(
        `[data-substage-target="${target}"] > span:not(.material-symbols-outlined):not(.header-badge):not(.tab-label-short)`,
        mainZh,
        mainEn
      );
      setText(
        `[data-side-substage-target="${target}"] > span:not(.material-symbols-outlined):not(.tab-label-short)`,
        sideZh,
        sideEn
      );
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStaticEnglishFinish, { once: true });
  } else {
    queueMicrotask(applyStaticEnglishFinish);
  }

  if (window.i18nService && typeof window.i18nService.translateLegacyText === 'function') {
    const originalTranslateLegacyText = window.i18nService.translateLegacyText.bind(
      window.i18nService
    );
    window.i18nService.translateLegacyText = function (text) {
      if (!isEnglish() || typeof text !== 'string') {
        return originalTranslateLegacyText(text);
      }

      const extraRules = [
        [/^切换失败：(.+)$/, 'Switch failed: $1'],
        [/^已切换到「(.+)」$/, 'Switched to "$1".'],
        [/^文件读取失败，请重试$/, 'File read failed. Please try again.'],
        [/^导入成功$/, 'Import Successful'],
        [/^已导入世界卡「(.+)」$/, 'Imported world card "$1".'],
        [/^已删除「(.+)」$/, 'Deleted "$1".'],
        [/^请等待回复完成后再切换世界$/, 'Wait for the current reply before switching worlds.'],
        [
          /^默认世界卡初始化失败，请刷新重试$/,
          'Default world initialization failed. Refresh and try again.',
        ],
        [/^自动保存冲突$/, 'Auto-save Conflict'],
        [/^无法进入覆盖流程$/, 'Could not enter the overwrite flow.'],
        [/^打开覆盖流程失败$/, 'Failed to open the overwrite flow.'],
        [/^请先完成当前流程（(.+)）$/, 'Finish the current flow first ($1).'],
        [/^请先完成当前流程$/, 'Finish the current flow first.'],
        [/^进入设计新世界失败：(.+)$/, 'Failed to enter Design New World: $1'],
        [/^返回失败：开始界面未加载$/, 'Return failed: the start screen is not loaded.'],
        [/^返回失败：自动保存失败（(.+)）$/, 'Return failed: auto-save failed ($1).'],
        [
          /^请等待回复完成后再返回开始界面$/,
          'Wait for the current reply before returning to the start screen.',
        ],
        [/^已全部重置$/, 'Everything was reset.'],
        [/^请等待回复完成后再切换模式$/, 'Wait for the current reply before switching modes.'],
        [
          /^已取消自动新开局：你已切换到其他世界卡$/,
          'Auto new-game cancelled because you switched to another world card.',
        ],
        [/^自动新开局失败：(.+)$/, 'Auto new-game failed: $1'],
        [
          /^已进入新开局，但当前世界无空存档槽，未自动创建存档$/,
          'Entered a new run, but there was no empty save slot in the current world, so no save was created automatically.',
        ],
        [
          /^已进入新开局，但自动创建存档失败：(.+)$/,
          'Entered a new run, but automatic save creation failed: $1',
        ],
        [
          /^请先展开该消息所在的折叠组$/,
          'Expand the collapsed group that contains this message first.',
        ],
        [/^叙事文本已保存$/, 'Narrative text saved.'],
        [/^配置已保存$/, 'Settings saved.'],
        [/^连接错误：没有 API Key$/, 'Connection error: no API key.'],
        [/^文件过大 \((.+)\)，上限 (.+)$/, 'File is too large ($1). Limit: $2.'],
        [
          /^不支持二进制文件，请上传文本文件$/,
          'Binary files are not supported. Please upload a text file.',
        ],
        [/^请使用最新问题卡片$/, 'Use the latest question card first.'],
        [/^当前没有可回答的问题$/, 'There is no active question to answer.'],
        [
          /^当前问题状态异常，请刷新后重试$/,
          'The current question state is invalid. Refresh and try again.',
        ],
        [/^输入框未就绪，请稍后重试$/, 'The input box is not ready. Please try again later.'],
        [
          /^选项内容异常，请手动输入$/,
          'The option content is invalid. Please type your answer manually.',
        ],
        [
          /^请先选择一个选项，或输入你的想法，或点“跳过”$/,
          'Choose an option, type your own answer, or press "Skip".',
        ],
        [
          /^重试入口未初始化，请刷新后重试$/,
          'The retry entry is not ready. Refresh and try again.',
        ],
        [/^已重新生成回复$/, 'Reply regenerated.'],
      ];

      for (const [pattern, replacement] of extraRules) {
        if (!pattern.test(text)) continue;
        return text.replace(pattern, replacement);
      }

      return originalTranslateLegacyText(text);
    };
  }

  window.addEventListener('ui-language-changed', applyStaticEnglishFinish);
})();
