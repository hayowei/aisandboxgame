(function () {
  'use strict';

  const STORAGE_KEY = 'ai_adventure_settings';
  const VALID_UI_LANGUAGES = new Set(['auto', 'zh-CN', 'en']);
  const VALID_CONTENT_LANGUAGES = new Set(['zh-CN', 'en']);

  const TRANSLATIONS = {
    'meta.title': {
      'zh-CN': 'AI Sandbox Game',
      en: 'AI Sandbox Game',
    },
    'meta.description': {
      'zh-CN': '在持续演化的世界中推动分支剧情，体验沉浸式 AI 文本冒险。',
      en: 'Drive branching stories in a living world and play an immersive AI text adventure.',
    },
    'meta.appName': {
      'zh-CN': 'AI Sandbox Game',
      en: 'AI Sandbox Game',
    },
    'meta.appleTitle': {
      'zh-CN': 'AI Sandbox',
      en: 'AI Sandbox',
    },
    'launcher.profileName': {
      'zh-CN': 'Player One',
      en: 'Player One',
    },
    'launcher.profileStatus': {
      'zh-CN': '在线',
      en: 'Online',
    },
    'launcher.profileBubble': {
      'zh-CN':
        '想登录？本游戏目前没有后台服务器，也不需要注册账号。你所有的存档和API Key都保存在本地 ^_^',
      en: 'Want to sign in? This game has no backend server and does not need an account. Your saves and API keys stay on this device.^_^',
    },
    'launcher.newsLatestTitle': {
      'zh-CN': '最新消息',
      en: 'Latest News',
    },
    'launcher.newsLatestBody': {
      'zh-CN': 'AI沙盒游戏持续更新中，更多世界与冒险等待探索。',
      en: 'AI Sandbox Game is still evolving, with more worlds and adventures on the way.',
    },
    'launcher.newsCommunityTitle': {
      'zh-CN': '社区动态',
      en: 'Community',
    },
    'launcher.newsCommunityBody': {
      'zh-CN': '加入官方QQ群与其他冒险者交流心得与创意。',
      en: 'Join the official community group to share ideas and notes with other players.',
    },
    'launcher.creditsClose': {
      'zh-CN': '关闭',
      en: 'Close',
    },
    'launcher.creditsThanksTitle': {
      'zh-CN': '特别感谢',
      en: 'Special Thanks',
    },
    'launcher.creditsThanksBody': {
      'zh-CN':
        '感谢在开发过程中给予我支持和帮助的每一位朋友与家人，是你们的鼓励让这个项目从想法变为现实。',
      en: 'Thanks to every friend and family member who supported this project during development. Your encouragement helped turn the idea into something real.',
    },
    'launcher.creditsPlanTitle': {
      'zh-CN': '未来计划',
      en: 'Future Plans',
    },
    'launcher.creditsPlanBody': {
      'zh-CN':
        'AI 沙盒游戏将持续更新迭代。未来将推出 iOS 与 Android 版应用。本项目已在 GitHub 正式开源，欢迎大家提交 PR！',
      en: 'AI Sandbox Game will continue to evolve. Future work includes iOS and Android releases. The project is now open-source on GitHub, and PRs are welcome!',
    },
    'launcher.creditsPromiseTitle': {
      'zh-CN': '承诺',
      en: 'Promise',
    },
    'launcher.creditsPromiseBody': {
      'zh-CN': '网页版将永久保持免费。欢迎大家游玩、分享与反馈，你的每一条建议都是我前进的动力 ❤️',
      en: 'The web version will remain free. Play, share, and send feedback. Every suggestion helps move the project forward.',
    },
    'launcher.backToStart': {
      'zh-CN': '返回开始界面',
      en: 'Back to Start',
    },
    'launcher.titleTips': {
      'zh-CN': '点击查看小贴士',
      en: 'Click to view a tip',
    },
    'launcher.modeToggleTitle': {
      'zh-CN': '切换沙盒/世界卡',
      en: 'Switch Sandbox / World Cards',
    },
    'launcher.modeGame': {
      'zh-CN': '沙盒',
      en: 'Sandbox',
    },
    'launcher.modeDesign': {
      'zh-CN': '世界卡',
      en: 'World Cards',
    },
    'launcher.settingsTitle': {
      'zh-CN': '设置',
      en: 'Settings',
    },
    'launcher.settingsText': {
      'zh-CN': '设置',
      en: 'Settings',
    },
    'launcher.mapTitle': {
      'zh-CN': '世界地图',
      en: 'World Map',
    },
    'launcher.mapText': {
      'zh-CN': '世界地图',
      en: 'World Map',
    },
    'launcher.summaryTitle': {
      'zh-CN': '剧情总结',
      en: 'Summary',
    },
    'launcher.npcTitle': {
      'zh-CN': '角色档案',
      en: 'Characters',
    },
    'launcher.worldCardTitle': {
      'zh-CN': '世界卡信息',
      en: 'World Card',
    },
    'launcher.worldCardText': {
      'zh-CN': '世界卡',
      en: 'World Card',
    },
    'launcher.phoneTitle': {
      'zh-CN': '短信',
      en: 'Messages',
    },
    'launcher.saveManagerTitle': {
      'zh-CN': '存档管理',
      en: 'Saves',
    },
    'launcher.resetTitle': {
      'zh-CN': '重置冒险',
      en: 'Reset Adventure',
    },
    'launcher.chatPlaceholder': {
      'zh-CN': '输入你的行动...',
      en: 'Describe your action...',
    },
    'choices.detailEmptyPlaceholder': {
      'zh-CN': '无详细分析，再次点击可发送',
      en: 'No detail. Click again to send.',
    },
    'launcher.designExecuteTitle': {
      'zh-CN': '执行',
      en: 'Execute',
    },
    'launcher.sendTitle': {
      'zh-CN': '发送',
      en: 'Send',
    },
    'narrow.title': {
      'zh-CN': '屏幕宽度不足',
      en: 'Screen Too Narrow',
    },
    'narrow.body': {
      'zh-CN': '当前屏幕太窄，无法正常显示内容。<br />请旋转设备或使用更大的屏幕。',
      en: 'The screen is too narrow to display the interface correctly.<br />Rotate your device or use a larger screen.',
    },
    'sidebar.npcTitle': {
      'zh-CN': '角色档案',
      en: 'Characters',
    },
    'sidebar.npcEmpty': {
      'zh-CN': '暂无角色信息',
      en: 'No character data yet',
    },
    'npc_actions_header': {
      'zh-CN': '角色动态',
      en: 'Character Actions',
    },
    'npc_inner_thought': {
      'zh-CN': '内心',
      en: 'Thought',
    },
    'sidebar.worldCardTitle': {
      'zh-CN': '世界卡信息',
      en: 'World Card',
    },
    'sidebar.worldCardEmpty': {
      'zh-CN': '尚未开始设计',
      en: 'Design has not started yet',
    },
    'settings.title': {
      'zh-CN': '设置',
      en: 'Settings',
    },
    'settings.mobileTitle': {
      'zh-CN': '⚙️设置',
      en: 'Settings',
    },
    'settings.basicTab': {
      'zh-CN': '基础设置',
      en: 'Basic',
    },
    'settings.apiTab': {
      'zh-CN': 'API设置',
      en: 'API',
    },
    'settings.promptsTab': {
      'zh-CN': '提示词设置',
      en: 'Prompts',
    },
    'settings.cancel': {
      'zh-CN': '取消',
      en: 'Cancel',
    },
    'settings.save': {
      'zh-CN': '保存',
      en: 'Save',
    },
    'settings.advanced': {
      'zh-CN': '高级设置',
      en: 'Advanced',
    },
    'settings.languageLabel': {
      'zh-CN': '界面语言',
      en: 'Language',
    },
    'settings.languageAuto': {
      'zh-CN': '跟随浏览器',
      en: 'Follow Browser',
    },
    'settings.languageZh': {
      'zh-CN': '简体中文',
      en: 'Simplified Chinese',
    },
    'settings.languageEn': {
      'zh-CN': 'English',
      en: 'English',
    },
    'settings.languageToggleToZh': {
      'zh-CN': '切换到中文',
      en: 'Switch to Chinese',
    },
    'settings.languageToggleToEn': {
      'zh-CN': '切换到英文',
      en: 'Switch to English',
    },
    'save.importWorld': {
      'zh-CN': '导入世界卡',
      en: 'Import World',
    },
    'save.importSave': {
      'zh-CN': '导入存档',
      en: 'Import Save',
    },
    'save.worldCardsTitle': {
      'zh-CN': '世界卡',
      en: 'World Cards',
    },
    'save.managementTitle': {
      'zh-CN': '存档管理',
      en: 'Save Management',
    },
    'save.gameSavesTitle': {
      'zh-CN': '游戏存档',
      en: 'Game Saves',
    },
    'save.deleteWorldTitle': {
      'zh-CN': '删除世界卡',
      en: 'Delete World Card',
    },
    'save.reimportTitle': {
      'zh-CN': '选择导入方式',
      en: 'Choose Import Mode',
    },
    'save.reimportBody': {
      'zh-CN': '将此文件导入到世界卡列表，还是直接载入到设计模式进行编辑？',
      en: 'Do you want to add this file to the world-card list or load it directly into design mode for editing?',
    },
    'save.reimportToList': {
      'zh-CN': '导入到世界卡列表',
      en: 'Import to World Cards',
    },
    'save.reimportToDesign': {
      'zh-CN': '载入到设计模式编辑',
      en: 'Open in Design Mode',
    },
    'save.applyResultTitle': {
      'zh-CN': '保存编辑结果',
      en: 'Save Edited Result',
    },
    'save.applyUpdate': {
      'zh-CN': '覆盖原世界卡',
      en: 'Overwrite Original',
    },
    'save.applyNew': {
      'zh-CN': '另存为新世界卡',
      en: 'Save as New World',
    },
    'save.saveTitle': {
      'zh-CN': '保存存档',
      en: 'Save Game',
    },
    'save.savePlaceholder': {
      'zh-CN': '输入存档名称',
      en: 'Enter save name',
    },
    'save.worldNameTitle': {
      'zh-CN': '命名你的世界',
      en: 'Name Your World',
    },
    'save.worldNameBody': {
      'zh-CN': '为你的自定义世界起个名字和描述。留空将使用默认名称。',
      en: 'Give your custom world a name and a short description. Empty fields will use defaults.',
    },
    'save.worldNameLabel': {
      'zh-CN': '世界名称',
      en: 'World Name',
    },
    'save.worldNamePlaceholder': {
      'zh-CN': '自定义世界',
      en: 'Custom World',
    },
    'save.worldDescLabel': {
      'zh-CN': '世界描述',
      en: 'World Description',
    },
    'save.worldDescPlaceholder': {
      'zh-CN': '简短描述你的世界…',
      en: 'Describe your world...',
    },
    'save.deleteSaveTitle': {
      'zh-CN': '删除存档',
      en: 'Delete Save',
    },
    'save.deleteMessageTitle': {
      'zh-CN': '删除消息',
      en: 'Delete Message',
    },
    'save.deleteMessageBody': {
      'zh-CN': '确定要删除这条消息吗？',
      en: 'Delete this message?',
    },
    'save.deleteConversationBody': {
      'zh-CN': '确定要删除整个对话吗？',
      en: 'Delete this whole conversation?',
    },
    'common.delete': {
      'zh-CN': '删除',
      en: 'Delete',
    },
    'common.confirm': {
      'zh-CN': '确认',
      en: 'Confirm',
    },
    'common.close': {
      'zh-CN': '关闭',
      en: 'Close',
    },
    'common.cancel': {
      'zh-CN': '取消',
      en: 'Cancel',
    },
    'common.skip': {
      'zh-CN': '跳过',
      en: 'Skip',
    },
    'common.retry': {
      'zh-CN': '重试',
      en: 'Retry',
    },
    'common.testing': {
      'zh-CN': '测试',
      en: 'Test',
    },
    'common.failed': {
      'zh-CN': '失败',
      en: 'Failed',
    },
    'common.inputSms': {
      'zh-CN': '输入短信...',
      en: 'Type a message...',
    },
    'common.centerOnPlayer': {
      'zh-CN': '居中到玩家',
      en: 'Center on Player',
    },
    'common.zoomIn': {
      'zh-CN': '放大',
      en: 'Zoom In',
    },
    'common.zoomOut': {
      'zh-CN': '缩小',
      en: 'Zoom Out',
    },
    'common.toggleBorders': {
      'zh-CN': '显示/隐藏国界',
      en: 'Toggle Borders',
    },
    'common.toggleTransitions': {
      'zh-CN': '地形过渡效果',
      en: 'Terrain Transitions',
    },
    'common.toggleGrid': {
      'zh-CN': '显示/隐藏网格',
      en: 'Toggle Grid',
    },
    'common.legend': {
      'zh-CN': '图例',
      en: 'Legend',
    },
    'common.center': {
      'zh-CN': '居中',
      en: 'Center',
    },
    'common.currentQuestion': {
      'zh-CN': '当前题：Q{current}/{total}',
      en: 'Current: Q{current}/{total}',
    },
    'common.questionProgress': {
      'zh-CN': '问题 {current}/{total}',
      en: 'Question {current}/{total}',
    },
    'react.thinking': {
      'zh-CN': '推理中',
      en: 'Reasoning',
    },
    'react.thoughtFor': {
      'zh-CN': '已推理 {n}s',
      en: 'Reasoned for {n}s',
    },
    'react.toolCalls': {
      'zh-CN': '{n} 次工具',
      en: '{n} tool calls',
    },
    'common.expandThinking': {
      'zh-CN': '展开完整思考',
      en: 'Show Full Thinking',
    },
    'common.collapseThinking': {
      'zh-CN': '收起完整思考',
      en: 'Hide Full Thinking',
    },
    'common.noData': {
      'zh-CN': '暂无数据',
      en: 'No data yet',
    },
    'offline.title': {
      'zh-CN': '离线中 | AI Sandbox Game',
      en: 'Offline | AI Sandbox Game',
    },
    'offline.heading': {
      'zh-CN': '信号中断，世界暂时静止',
      en: 'Connection Lost, World Paused',
    },
    'offline.body': {
      'zh-CN': '网络恢复后即可继续冒险。',
      en: 'Reconnect to continue your adventure.',
    },
    'offline.reload': {
      'zh-CN': '重新连接',
      en: 'Reconnect',
    },
  };

  const LEGACY_TERM_TRANSLATIONS = {
    设置: 'Settings',
    重置: 'Reset',
    存档: 'Save',
    默认世界卡: 'Default World',
    执行: 'Execute',
    应用到游戏: 'Apply to Game',
    沙盒: 'Sandbox',
    设计模式: 'Design Mode',
    世界卡: 'World Card',
    角色档案: 'Character Panel',
  };

  const LEGACY_PATTERNS = [
    {
      test: /^创建世界卡失败：内容为空$/,
      values: {
        'zh-CN': '创建世界卡失败：内容为空',
        en: 'Failed to create world card: content is empty',
      },
    },
    {
      test: /^创建世界卡失败：存储空间不足$/,
      values: {
        'zh-CN': '创建世界卡失败：存储空间不足',
        en: 'Failed to create world card: storage quota exceeded',
      },
    },
    {
      test: /^更新世界卡失败：内容为空$/,
      values: {
        'zh-CN': '更新世界卡失败：内容为空',
        en: 'Failed to update world card: content is empty',
      },
    },
    {
      test: /^导出失败：世界卡数据无效$/,
      values: { 'zh-CN': '导出失败：世界卡数据无效', en: 'Export failed: invalid world-card data' },
    },
    {
      test: /^内置世界卡不可导出$/,
      values: { 'zh-CN': '内置世界卡不可导出', en: 'Built-in world card cannot be exported' },
    },
    {
      test: /^内置世界卡不可修改$/,
      values: { 'zh-CN': '内置世界卡不可修改', en: 'Built-in world card cannot be edited' },
    },
    {
      test: /^内置世界卡不可删除$/,
      values: { 'zh-CN': '内置世界卡不可删除', en: 'Built-in world card cannot be deleted' },
    },
    {
      test: /^默认世界卡按钮不可用$/,
      values: { 'zh-CN': '默认世界卡按钮不可用', en: 'Default-world button unavailable' },
    },
    {
      test: /^连接错误：没有 API Key$/,
      values: { 'zh-CN': '连接错误：没有 API Key', en: 'Connection error: no API key' },
    },
    {
      test: /^请等待回复完成后再进入默认世界$/,
      values: {
        'zh-CN': '请等待回复完成后再进入默认世界',
        en: 'Wait for the current reply before entering the default world',
      },
    },
    {
      test: /^请先选择或新建一个存档$/,
      values: { 'zh-CN': '请先选择或新建一个存档', en: 'Choose or create a save first' },
    },
    {
      test: /^未找到(?:自动恢复点|临时恢复点)$/,
      values: { 'zh-CN': '未找到临时恢复点', en: 'Temporary recovery not found' },
    },
    {
      test: /^旧自动恢复进度需要先迁移，请先删除一个存档槽位$/,
      values: {
        'zh-CN': '旧自动恢复进度需要先迁移，请先删除一个存档槽位',
        en: 'Legacy temporary recovery data must be organized first. Delete one save slot before continuing.',
      },
    },
    {
      test: /^发现旧版临时恢复数据，请先整理后再恢复$/,
      values: {
        'zh-CN': '发现旧版临时恢复数据，请先整理后再恢复',
        en: 'Legacy temporary recovery data was found. Organize it before recovering.',
      },
    },
    {
      test: /^该世界存在待迁移的旧自动恢复进度，请先删除一个存档槽位后再继续$/,
      values: {
        'zh-CN': '该世界存在待迁移的旧自动恢复进度，请先删除一个存档槽位后再继续',
        en: 'This world has legacy temporary recovery data waiting to be organized. Delete one save slot before continuing.',
      },
    },
    {
      test: /^saveManager 未加载$/,
      values: { 'zh-CN': 'saveManager 未加载', en: 'Save manager is unavailable' },
    },
    {
      test: /^当前没有可自动保存的世界上下文$/,
      values: {
        'zh-CN': '当前没有可自动保存的世界上下文',
        en: 'There is no active world context available for automatic recovery saving',
      },
    },
    {
      test: /^当前世界存在未整理的旧恢复数据，请先整理或放弃后再继续$/,
      values: {
        'zh-CN': '当前世界存在未整理的旧恢复数据，请先整理或放弃后再继续',
        en: 'This world still has legacy recovery data waiting to be organized. Organize or discard it before continuing.',
      },
    },
    {
      test: /^已复制到剪贴板$/,
      values: { 'zh-CN': '已复制到剪贴板', en: 'Copied to clipboard' },
    },
    {
      test: /^复制失败$/,
      values: { 'zh-CN': '复制失败', en: 'Copy failed' },
    },
    {
      test: /^消息已删除$/,
      values: { 'zh-CN': '消息已删除', en: 'Message deleted' },
    },
    {
      test: /^叙事文本已保存$/,
      values: { 'zh-CN': '叙事文本已保存', en: 'Narrative saved' },
    },
    {
      test: /^已保存修改$/,
      values: { 'zh-CN': '已保存修改', en: 'Changes saved' },
    },
    {
      test: /^设计服务未初始化，请重新进入设计模式$/,
      values: {
        'zh-CN': '设计服务未初始化，请重新进入设计模式',
        en: 'Design service is not ready. Re-enter design mode and try again.',
      },
    },
    {
      test: /^当前不在自动生成阶段$/,
      values: {
        'zh-CN': '当前不在自动生成阶段',
        en: 'The app is not currently in the auto-generation stage',
      },
    },
    {
      test: /^请等待当前自动生成任务完成$/,
      values: {
        'zh-CN': '请等待当前自动生成任务完成',
        en: 'Wait for the current auto-generation task to finish',
      },
    },
    {
      test: /^重试确认进行中，请先完成当前确认$/,
      values: {
        'zh-CN': '重试确认进行中，请先完成当前确认',
        en: 'Retry confirmation is already open. Finish it first.',
      },
    },
    {
      test: /^未能启动自动生成，请稍后重试$/,
      values: {
        'zh-CN': '未能启动自动生成，请稍后重试',
        en: 'Could not start auto-generation. Please try again later.',
      },
    },
    {
      test: /^应用失败：存储空间不足，世界卡未更新$/,
      values: {
        'zh-CN': '应用失败：存储空间不足，世界卡未更新',
        en: 'Apply failed: storage quota exceeded and the world card was not updated',
      },
    },
    {
      test: /^创建世界卡失败（存储空间不足）$/,
      values: {
        'zh-CN': '创建世界卡失败（存储空间不足）',
        en: 'Failed to create world card (storage quota exceeded)',
      },
    },
    {
      test: /^发送失败，请重试$/,
      values: { 'zh-CN': '发送失败，请重试', en: 'Send failed. Please try again.' },
    },
    {
      test: /^框架提取失败，请重试$/,
      values: {
        'zh-CN': '框架提取失败，请重试',
        en: 'Framework extraction failed. Please try again.',
      },
    },
    {
      test: /^框架提取失败：(.+)$/,
      toLocale(locale, match) {
        if (locale === 'en') return `Framework extraction failed: ${match[1]}`;
        return `框架提取失败：${match[1]}`;
      },
    },
    {
      test: /^AI 输出格式异常，请重试$/,
      values: {
        'zh-CN': 'AI 输出格式异常，请重试',
        en: 'The AI response format was invalid. Please try again.',
      },
    },
    {
      test: /^网络连接失败，请检查网络连接或代理设置$/,
      values: {
        'zh-CN': '网络连接失败，请检查网络连接或代理设置',
        en: 'Network request failed. Check your network or proxy settings.',
      },
    },
    {
      test: /^API 调用频率超限，请稍后重试或更换 API Key$/,
      values: {
        'zh-CN': 'API 调用频率超限，请稍后重试或更换 API Key',
        en: 'API rate limit exceeded. Retry later or use another API key.',
      },
    },
    {
      test: /^API 认证失败，请检查 API Key 是否正确$/,
      values: {
        'zh-CN': 'API 认证失败，请检查 API Key 是否正确',
        en: 'API authentication failed. Check whether the API key is correct.',
      },
    },
    {
      test: /^API 服务端错误，请稍后重试$/,
      values: {
        'zh-CN': 'API 服务端错误，请稍后重试',
        en: 'API server error. Please try again later.',
      },
    },
    {
      test: /^网络恢复后即可继续冒险。$/,
      values: { 'zh-CN': '网络恢复后即可继续冒险。', en: 'Reconnect to continue your adventure.' },
    },
    {
      test: /^步骤模型已保存$/,
      values: { 'zh-CN': '步骤模型已保存', en: 'Module model saved' },
    },
    {
      test: /^价格已保存$/,
      values: { 'zh-CN': '价格已保存', en: 'Pricing saved' },
    },
    {
      test: /^保存价格失败$/,
      values: { 'zh-CN': '保存价格失败', en: 'Failed to save pricing' },
    },
    {
      test: /^所有 Step 内容已重置，点击"保存"生效$/,
      values: {
        'zh-CN': '所有 Step 内容已重置，点击"保存"生效',
        en: 'All step content has been reset. Click "Save" to apply.',
      },
    },
    {
      test: /^已删除 (.+)$/,
      toLocale(locale, match) {
        if (locale === 'en') return `Deleted ${match[1]}`;
        return `已删除 ${match[1]}`;
      },
    },
    {
      test: /^导入世界卡失败: (.+)$/,
      toLocale(locale, match) {
        if (locale === 'en') return `World-card import failed: ${match[1]}`;
        return `导入世界卡失败: ${match[1]}`;
      },
    },
    {
      test: /^创建世界卡失败（存储空间不足）$/,
      values: {
        'zh-CN': '创建世界卡失败（存储空间不足）',
        en: 'Failed to create world card (storage quota exceeded)',
      },
    },
    {
      test: /^进入默认世界失败：(.+)$/,
      toLocale(locale, match) {
        if (locale === 'en') return `Failed to enter default world: ${match[1]}`;
        return `进入默认世界失败：${match[1]}`;
      },
    },
    {
      test: /^重置按钮不可用$/,
      values: { 'zh-CN': '重置按钮不可用', en: 'Reset button unavailable' },
    },
    {
      test: /^存档按钮不可用$/,
      values: { 'zh-CN': '存档按钮不可用', en: 'Save button unavailable' },
    },
    {
      test: /^执行按钮不可用$/,
      values: { 'zh-CN': '执行按钮不可用', en: 'Execute button unavailable' },
    },
    {
      test: /^应用到游戏按钮不可用$/,
      values: { 'zh-CN': '应用到游戏按钮不可用', en: 'Apply-to-game button unavailable' },
    },
    {
      test: /^再试一次按键不可用$/,
      values: { 'zh-CN': '再试一次按键不可用', en: 'Retry button unavailable' },
    },
    {
      test: /^设置按钮不可用$/,
      values: { 'zh-CN': '设置按钮不可用', en: 'Settings button unavailable' },
    },
    {
      test: /^打开覆盖流程失败$/,
      values: { 'zh-CN': '打开覆盖流程失败', en: 'Failed to open overwrite flow' },
    },
  ];

  const STATIC_BINDINGS = [
    { selector: '.launcher-profile-name', key: 'launcher.profileName', prop: 'textContent' },
    {
      selector: '.launcher-profile-status',
      key: 'launcher.profileStatus',
      prop: 'textContent',
      prefix: '<span class="launcher-profile-status-dot"></span> ',
    },
    { selector: '#launcher-profile-bubble', key: 'launcher.profileBubble', prop: 'textContent' },
    {
      selector: '.launcher-news-card:nth-of-type(1) h4',
      key: 'launcher.newsLatestTitle',
      prop: 'textContent',
    },
    {
      selector: '.launcher-news-card:nth-of-type(1) p',
      key: 'launcher.newsLatestBody',
      prop: 'textContent',
    },
    {
      selector: '.launcher-news-card:nth-of-type(2) h4',
      key: 'launcher.newsCommunityTitle',
      prop: 'textContent',
    },
    {
      selector: '.launcher-news-card:nth-of-type(2) p',
      key: 'launcher.newsCommunityBody',
      prop: 'textContent',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-close',
      key: 'launcher.creditsClose',
      attr: 'aria-label',
    },
    {
      selector: '#launcher-changelog-modal .launcher-credits-close',
      key: 'launcher.creditsClose',
      attr: 'aria-label',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-section:nth-of-type(1) h3',
      key: 'launcher.creditsThanksTitle',
      prop: 'textContent',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-section:nth-of-type(1) p',
      key: 'launcher.creditsThanksBody',
      prop: 'textContent',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-section:nth-of-type(2) h3',
      key: 'launcher.creditsPlanTitle',
      prop: 'textContent',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-section:nth-of-type(2) p',
      key: 'launcher.creditsPlanBody',
      prop: 'textContent',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-section:nth-of-type(3) h3',
      key: 'launcher.creditsPromiseTitle',
      prop: 'textContent',
    },
    {
      selector: '#launcher-credits-modal .launcher-credits-section:nth-of-type(3) p',
      key: 'launcher.creditsPromiseBody',
      prop: 'textContent',
    },
    { selector: '#narrow-screen-overlay h2', key: 'narrow.title', prop: 'textContent' },
    { selector: '#narrow-screen-overlay p', key: 'narrow.body', prop: 'innerHTML' },
    { selector: '#mode-toggle', key: 'launcher.modeToggleTitle', attr: 'title' },
    { selector: '#mode-toggle .tab[data-mode="game"]', key: 'launcher.modeGame', prop: 'textContent' },
    {
      selector: '#mode-toggle .tab[data-mode="design"]',
      key: 'launcher.modeDesign',
      prop: 'textContent',
    },
    { selector: '#settings-btn', key: 'launcher.settingsTitle', attr: 'title' },
    { selector: '#settings-btn', key: 'launcher.settingsTitle', attr: 'aria-label' },
    {
      selector: '#settings-btn span:last-child',
      key: 'launcher.settingsText',
      prop: 'textContent',
    },
    { selector: '#map-btn', key: 'launcher.mapTitle', attr: 'title' },
    { selector: '#map-btn span:last-child', key: 'launcher.mapText', prop: 'textContent' },
    { selector: '#worldcard-tile-btn', key: 'launcher.worldCardTitle', attr: 'title' },
    {
      selector: '#worldcard-tile-btn span:last-child',
      key: 'launcher.worldCardText',
      prop: 'textContent',
    },
    { selector: '#phone-btn', key: 'launcher.phoneTitle', attr: 'title' },
    { selector: '#save-manager-btn', key: 'launcher.saveManagerTitle', attr: 'title' },
    { selector: '#reset-btn', key: 'launcher.resetTitle', attr: 'title' },
    { selector: '#chat-input', key: 'launcher.chatPlaceholder', attr: 'placeholder' },
    { selector: '#design-execute-btn', key: 'launcher.designExecuteTitle', attr: 'title' },
    { selector: '[data-action~="chat-send-btn"]', key: 'launcher.sendTitle', attr: 'title' },
    {
      selector: '#side-panel .sidebar-tile-title',
      key: 'sidebar.npcTitle',
      prop: 'textContent',
      index: 0,
    },
    { selector: '#npc-tile .npc-empty', key: 'sidebar.npcEmpty', prop: 'textContent' },
    {
      selector: '#worldcard-info-tile .sidebar-tile-title',
      key: 'sidebar.worldCardTitle',
      prop: 'textContent',
    },
    {
      selector: '#worldcard-info-container .worldcard-empty',
      key: 'sidebar.worldCardEmpty',
      prop: 'textContent',
    },
    { selector: '.settings-title', key: 'settings.title', prop: 'textContent' },
    {
      selector: '.tab.tab-mobile-first[data-tab="basic"]',
      key: 'settings.mobileTitle',
      prop: 'textContent',
    },
    {
      selector: '.tab:not(.tab-mobile-first)[data-tab="basic"]',
      key: 'settings.basicTab',
      prop: 'textContent',
    },
    {
      selector: '.tab[data-tab="api"]',
      key: 'settings.apiTab',
      prop: 'textContent',
    },
    {
      selector: '.tab[data-tab="prompts"]',
      key: 'settings.promptsTab',
      prop: 'textContent',
    },
    { selector: '.api-advanced-toggle-label:not(.api-advanced-toggle-label--recommended)', key: 'settings.advanced', prop: 'textContent' },
    { selector: '#import-world-card-btn', key: 'save.importWorld', attr: 'title' },
    { selector: '#import-save-btn', key: 'save.importSave', attr: 'title' },
    { selector: '#confirm-cancel-btn', key: 'common.cancel', prop: 'textContent' },
    { selector: '#confirm-ok-btn', key: 'common.confirm', prop: 'textContent' },
    { selector: '#transition-autosave-cancel-btn', key: 'common.cancel', prop: 'textContent' },
    { selector: '#transition-autosave-skip-btn', key: 'common.skip', prop: 'textContent' },
    { selector: '#save-name-cancel-btn', key: 'common.cancel', prop: 'textContent' },
    { selector: '#delete-cancel-btn', key: 'common.cancel', prop: 'textContent' },
    { selector: '#delete-confirm-btn', key: 'common.delete', prop: 'textContent' },
    { selector: '#wc-delete-cancel-btn', key: 'common.cancel', prop: 'textContent' },
    { selector: '#wc-delete-confirm-btn', key: 'common.delete', prop: 'textContent' },
    {
      selector: '#delete-worldcard-modal h2',
      key: 'save.deleteWorldTitle',
      prop: 'textContent',
      htmlWrap: '<span class="icon icon-delete"></span> ',
    },
    { selector: '#reimport-choice-modal h2', key: 'save.reimportTitle', prop: 'textContent' },
    {
      selector: '#reimport-choice-modal .modal-description',
      key: 'save.reimportBody',
      prop: 'textContent',
    },
    { selector: '#reimport-choice-list-btn', key: 'save.reimportToList', prop: 'textContent' },
    { selector: '#reimport-choice-design-btn', key: 'save.reimportToDesign', prop: 'textContent' },
    { selector: '#reimport-apply-modal-title', key: 'save.applyResultTitle', prop: 'textContent' },
    { selector: '#reimport-apply-update-btn', key: 'save.applyUpdate', prop: 'textContent' },
    { selector: '#reimport-apply-new-btn', key: 'save.applyNew', prop: 'textContent' },
    {
      selector: '#save-name-modal-title',
      key: 'save.saveTitle',
      prop: 'textContent',
      htmlWrap: '<span class="icon icon-save"></span> ',
    },
    { selector: '#save-name-input', key: 'save.savePlaceholder', attr: 'placeholder' },
    { selector: '#worldcard-name-modal h2', key: 'save.worldNameTitle', prop: 'textContent' },
    {
      selector: '#worldcard-name-modal .modal-description',
      key: 'save.worldNameBody',
      prop: 'textContent',
    },
    {
      selector: 'label[for="worldcard-name-input"]',
      key: 'save.worldNameLabel',
      prop: 'textContent',
    },
    { selector: '#worldcard-name-input', key: 'save.worldNamePlaceholder', attr: 'placeholder' },
    {
      selector: 'label[for="worldcard-desc-input"]',
      key: 'save.worldDescLabel',
      prop: 'textContent',
    },
    { selector: '#worldcard-desc-input', key: 'save.worldDescPlaceholder', attr: 'placeholder' },
    {
      selector: '#delete-save-modal h2',
      key: 'save.deleteSaveTitle',
      prop: 'textContent',
      htmlWrap: '<span class="icon icon-delete"></span> ',
    },
    {
      selector: '#chat-delete-modal h2',
      key: 'save.deleteMessageTitle',
      prop: 'textContent',
      htmlWrap: '<span class="icon icon-delete"></span> ',
    },
    {
      selector: '#chat-delete-modal .modal-description',
      key: 'save.deleteMessageBody',
      prop: 'textContent',
    },
    { selector: '#chat-delete-confirm-btn', key: 'common.delete', prop: 'textContent' },
    { selector: '#sms-delete-text', key: 'save.deleteMessageBody', prop: 'textContent' },
    { selector: '#sms-delete-conv-text', key: 'save.deleteConversationBody', prop: 'textContent' },
    { selector: '#sms-delete-confirm-btn', key: 'common.delete', prop: 'textContent' },
    { selector: '#sms-delete-conv-confirm-btn', key: 'common.delete', prop: 'textContent' },
    { selector: '#sms-input', key: 'common.inputSms', attr: 'placeholder' },
    { selector: '#map-center-btn', key: 'common.centerOnPlayer', attr: 'title' },
    { selector: '#map-zoom-in-btn', key: 'common.zoomIn', attr: 'title' },
    { selector: '#map-zoom-out-btn', key: 'common.zoomOut', attr: 'title' },
    { selector: '#map-territory-btn', key: 'common.toggleBorders', attr: 'title' },
    { selector: '#map-transitions-btn', key: 'common.toggleTransitions', attr: 'title' },
    { selector: '#map-grid-btn', key: 'common.toggleGrid', attr: 'title' },
    { selector: '#map-legend-btn', key: 'common.legend', attr: 'title' },
    { selector: '#map-ctrl-zoomin', key: 'common.zoomIn', attr: 'title' },
    { selector: '#map-ctrl-zoomout', key: 'common.zoomOut', attr: 'title' },
    { selector: '#map-ctrl-center', key: 'common.center', attr: 'title' },
  ];

  const BILINGUAL_BINDINGS = [
    { selector: '#cancel-settings-btn', key: 'common.cancel' },
    { selector: '#save-settings-btn', key: 'settings.save' },
    { selector: '#save-manager-cancel-btn', key: 'common.cancel' },
    { selector: '#save-manager-confirm-btn', key: 'common.confirm' },
  ];

  function _safeReadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function _safeWriteSettings(nextSettings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function _normalizeUiLanguage(value) {
    return VALID_UI_LANGUAGES.has(value) ? value : 'auto';
  }

  function _normalizeContentLanguage(value) {
    return VALID_CONTENT_LANGUAGES.has(value) ? value : 'zh-CN';
  }

  function _detectBrowserLanguage() {
    const candidates = []
      .concat(Array.isArray(navigator.languages) ? navigator.languages : [])
      .concat(typeof navigator.language === 'string' ? [navigator.language] : []);
    const matched = candidates.find(locale => typeof locale === 'string' && locale.trim());
    if (!matched) return 'zh-CN';
    return matched.toLowerCase().startsWith('en') ? 'en' : 'zh-CN';
  }

  function _resolveUiLanguage(explicitValue = null) {
    const normalized = _normalizeUiLanguage(explicitValue || _safeReadSettings().uiLanguage);
    if (normalized === 'auto') return _detectBrowserLanguage();
    return normalized;
  }

  function _formatText(template, params) {
    if (typeof template !== 'string') return '';
    if (!params || typeof params !== 'object') return template;
    return template.replace(/\{(\w+)\}/g, (_, key) => {
      if (!Object.prototype.hasOwnProperty.call(params, key)) return `{${key}}`;
      return String(params[key]);
    });
  }

  function _translateKey(key, params = null, locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    const entry = TRANSLATIONS[key];
    if (!entry) return key;
    const text = entry[resolvedLocale] || entry['zh-CN'] || '';
    return _formatText(text, params);
  }

  function _applyBinding(binding, locale) {
    const nodes = document.querySelectorAll(binding.selector);
    if (!nodes || nodes.length === 0) return;
    const value = _translateKey(binding.key, null, locale);
    const targetNodes =
      typeof binding.index === 'number' ? [nodes[binding.index]] : Array.from(nodes);
    targetNodes.filter(Boolean).forEach(node => {
      if (binding.attr) {
        node.setAttribute(binding.attr, value);
        return;
      }
      if (binding.prop === 'innerHTML') {
        node.innerHTML = value;
        return;
      }
      if (binding.prefix) {
        node.innerHTML = binding.prefix + value;
        return;
      }
      if (binding.htmlWrap) {
        node.innerHTML = binding.htmlWrap + value;
        return;
      }
      node.textContent = value;
    });
  }

  function _setBilingualText(target, zhText, enText, options = {}) {
    const rootNode = typeof target === 'string' ? document.querySelector(target) : target;
    if (!rootNode) return;

    const zhSelector = options.zhSelector || '.ui-label-cn';
    const enSelector = options.enSelector || '.ui-label-en';
    const zhNodes = rootNode.querySelectorAll(zhSelector);
    const enNodes = rootNode.querySelectorAll(enSelector);

    if (zhNodes.length === 0 && enNodes.length === 0) {
      rootNode.textContent = _formatBilingualText(zhText, enText, options.locale);
      return;
    }

    zhNodes.forEach(node => {
      node.textContent = zhText;
    });
    enNodes.forEach(node => {
      node.textContent = enText;
    });
  }

  function _applyBilingualBinding(binding, locale = null) {
    const nodes = document.querySelectorAll(binding.selector);
    if (!nodes || nodes.length === 0) return;

    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    const zhText = _translateKey(binding.key, binding.params || null, 'zh-CN');
    const enText = _translateKey(binding.key, binding.params || null, 'en');
    const targetNodes =
      typeof binding.index === 'number' ? [nodes[binding.index]] : Array.from(nodes);
    targetNodes.filter(Boolean).forEach(node => {
      _setBilingualText(node, zhText, enText, { ...binding, locale: resolvedLocale });
    });
  }

  function _applyBilingualTranslations(locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    BILINGUAL_BINDINGS.forEach(binding => _applyBilingualBinding(binding, resolvedLocale));
  }

  function _applyStaticTranslations(locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    STATIC_BINDINGS.forEach(binding => _applyBinding(binding, resolvedLocale));
  }

  function _formatBilingualText(zhText, enText, locale = null) {
    // 单语显示（按 spec §2.2.2 标签 i18n 规则）：中文模式返回中文，英文模式返回英文，
    // 不再拼「中文 (English)」括号双显
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    return resolvedLocale === 'en' ? enText : zhText;
  }

  function _applyDocumentLanguage(locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    const root = document.documentElement;
    root.lang = resolvedLocale;
    root.setAttribute('data-ui-language', resolvedLocale);
    document.title = _translateKey('meta.title', null, resolvedLocale);

    const descEl = document.querySelector('meta[name="description"]');
    if (descEl)
      descEl.setAttribute('content', _translateKey('meta.description', null, resolvedLocale));

    const appNameEl = document.querySelector('meta[name="application-name"]');
    if (appNameEl)
      appNameEl.setAttribute('content', _translateKey('meta.appName', null, resolvedLocale));

    const appleTitleEl = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitleEl)
      appleTitleEl.setAttribute('content', _translateKey('meta.appleTitle', null, resolvedLocale));
  }

  function _getManifestHref(locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    return resolvedLocale === 'en'
      ? 'assets/pwa/manifest.en.webmanifest'
      : 'assets/pwa/manifest.zh-CN.webmanifest';
  }

  function _applyManifest(locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    let manifestLink = document.querySelector('link[rel="manifest"]');
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    }
    manifestLink.href = _getManifestHref(resolvedLocale);
  }

  function _translateTerm(term, locale) {
    if (locale !== 'en') return term;
    return LEGACY_TERM_TRANSLATIONS[term] || term;
  }

  function _translateLegacyText(text, locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    if (resolvedLocale === 'zh-CN') return text;
    if (typeof text !== 'string' || !text.trim()) return text;

    for (const rule of LEGACY_PATTERNS) {
      const match = text.match(rule.test);
      if (!match) continue;
      if (typeof rule.toLocale === 'function') {
        return rule.toLocale(resolvedLocale, match);
      }
      return rule.values?.[resolvedLocale] || rule.values?.['zh-CN'] || text;
    }

    const unavailableMatch = text.match(/^(.+?)按钮不可用$/);
    if (unavailableMatch) {
      return `${_translateTerm(unavailableMatch[1], resolvedLocale)} button unavailable`;
    }

    const currentFlowMatch = text.match(/^请先完成当前流程（(.+)）$/);
    if (currentFlowMatch) {
      return `Finish the current flow first (${currentFlowMatch[1]})`;
    }

    return text;
  }

  function _getContentLanguageFromCard(card) {
    if (!card || typeof card !== 'object') return 'zh-CN';
    return _normalizeContentLanguage(card.contentLocale);
  }

  function _getResolvedWorldContentLanguage() {
    const meta = window.worldMeta;
    if (meta && typeof meta.getActiveContentLocale === 'function') {
      return _normalizeContentLanguage(meta.getActiveContentLocale());
    }
    const mgr = window.worldCardManager;
    if (mgr && typeof mgr.getActiveCard === 'function') {
      return _getContentLanguageFromCard(mgr.getActiveCard());
    }
    return _resolveUiLanguage();
  }

  function _refresh(locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    _applyDocumentLanguage(resolvedLocale);
    _applyManifest(resolvedLocale);
    if (document.readyState !== 'loading') {
      _applyStaticTranslations(resolvedLocale);
      _applyBilingualTranslations(resolvedLocale);
    }
  }

  function _setUiLanguage(value) {
    const normalized = _normalizeUiLanguage(value);
    const nextSettings = {
      ..._safeReadSettings(),
      uiLanguage: normalized,
    };
    _safeWriteSettings(nextSettings);
    const resolvedLocale = _resolveUiLanguage(normalized);
    _refresh(resolvedLocale);
    window.dispatchEvent(
      new CustomEvent('ui-language-changed', {
        detail: {
          configured: normalized,
          resolved: resolvedLocale,
        },
      })
    );
    return resolvedLocale;
  }

  function _getLocalizedCorePromptName(name, locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _getResolvedWorldContentLanguage());
    if (resolvedLocale !== 'en') return name;
    return `${name}_EN`;
  }

  function _getOpeningModeKeyword(mode, locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    if (mode === 'recommended') {
      return resolvedLocale === 'en' ? 'Start with the Recommended Opening' : '以推荐剧情开始';
    }
    return resolvedLocale === 'en' ? 'Random Start' : '随机开始';
  }

  function _normalizeOpeningModeInput(text) {
    if (typeof text !== 'string') return null;
    const normalized = text.trim().toLowerCase();
    if (!normalized) return null;
    if (/^(随机开始|全随机|随机|随便|random start|random|start randomly)$/.test(normalized)) {
      return 'random';
    }
    if (
      /^(以推荐剧情开始|recommended opening|start with the recommended opening|recommended start)$/.test(
        normalized
      )
    ) {
      return 'recommended';
    }
    return null;
  }

  function _normalizeChoiceTypeTag(tag) {
    const normalized = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
    const map = {
      explore: 'explore',
      探索: 'explore',
      trade: 'trade',
      交易: 'trade',
      travel: 'travel',
      旅行: 'travel',
      work: 'work',
      打工: 'work',
      耗时: 'work',
      'long task': 'work',
      talk: 'talk',
      交谈: 'talk',
      action: 'action',
      行动: 'action',
      // 向后兼容：旧存档中的 social/社交 映射到 talk
      social: 'talk',
      社交: 'talk',
    };
    return map[normalized] || '';
  }

  function _getChoiceTypeLabel(tag, locale = null) {
    const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
    const normalized = _normalizeChoiceTypeTag(tag);
    const labels = {
      explore: { 'zh-CN': '探索', en: 'Explore' },
      trade: { 'zh-CN': '交易', en: 'Trade' },
      travel: { 'zh-CN': '旅行', en: 'Travel' },
      work: { 'zh-CN': '耗时', en: 'Long Task' },
      talk: { 'zh-CN': '交谈', en: 'Talk' },
      action: { 'zh-CN': '行动', en: 'Action' },
    };
    return labels[normalized]?.[resolvedLocale] || tag;
  }

  window.i18nService = {
    STORAGE_KEY,
    normalizeUiLanguage: _normalizeUiLanguage,
    normalizeContentLanguage: _normalizeContentLanguage,
    getConfiguredUiLanguage() {
      return _normalizeUiLanguage(_safeReadSettings().uiLanguage);
    },
    getResolvedLanguage() {
      return _resolveUiLanguage();
    },
    getDesignLanguage() {
      return _resolveUiLanguage();
    },
    getContentLanguageFromCard: _getContentLanguageFromCard,
    getGameContentLanguage() {
      return _getResolvedWorldContentLanguage();
    },
    getLocalizedCorePromptName: _getLocalizedCorePromptName,
    t: _translateKey,
    translateLegacyText: _translateLegacyText,
    refresh: _refresh,
    setUiLanguage: _setUiLanguage,
    applyStaticTranslations(locale = null) {
      const resolvedLocale = _normalizeContentLanguage(locale || _resolveUiLanguage());
      _applyStaticTranslations(resolvedLocale);
      _applyBilingualTranslations(resolvedLocale);
    },
    applyDocumentLanguage: _applyDocumentLanguage,
    applyManifest: _applyManifest,
    getManifestHref: _getManifestHref,
    normalizeOpeningModeInput: _normalizeOpeningModeInput,
    getOpeningModeKeyword: _getOpeningModeKeyword,
    normalizeChoiceTypeTag: _normalizeChoiceTypeTag,
    getChoiceTypeLabel: _getChoiceTypeLabel,
    formatBilingualText: _formatBilingualText,
    setBilingualText: _setBilingualText,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => _refresh(), { once: true });
  } else {
    queueMicrotask(_refresh);
  }
})();
