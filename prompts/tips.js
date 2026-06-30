/**
 * Tips 集合
 * 点击主界面标题 "AI Sandbox Game" 时随机显示一条
 */
const GAME_TIPS = [
  // 基础操作
  'Tips：点击左上角 Logo 可返回开始界面',
  'Tips：设置里可调整界面大小（90%~140%）',
  'Tips：设置中的月亮图标可切换深色/浅色主题',
  'Tips：界面大小默认按屏幕宽度自动适配',
  // API 与模型配置
  'Tips：API Key 完全保存在本地，不经过服务器',
  'Tips：高级设置可为每个步骤单独配置模型',
  'Tips：支持添加兼容 OpenAI 接口的自定义服务商',
  'Tips：开启流式输出可让回复逐字实时显示',
  // 存档管理
  'Tips：每个世界卡有独立的存档槽位',
  'Tips：存档可导出为 JSON 文件备份分享',
  'Tips：存档管理中可导入他人分享的存档',
  'Tips：返回开始界面时会自动保存进度',
  // 聊天交互
  'Tips：消息气泡右下方有复制、编辑、删除、重新生成按键',
  'Tips：重新生成会截断该条之后的历史',
  'Tips：支持上传 txt、md、json 等文档附件',
  // 剧情总结
  'Tips：剧情总结支持手动编辑和重新生成',
  'Tips：每 20 轮会自动生成一次章节总结',
  'Tips：总结不满意？点重新生成让 AI 重写',
  // 角色系统
  'Tips：角色档案自动更新，新属性需审批通过',
  'Tips：可拖拽角色卡片调整排列顺序',
  'Tips：角色档案中的任意字段都可手动编辑',
  // 世界卡
  'Tips：设计模式可从零创建自己的世界设定',
  'Tips：已有世界卡可导入设计模式二次编辑',
  'Tips：世界卡支持导出分享给其他玩家',
  // 自定义内容
  'Tips：自定义设置可修改开场白和 Init 模块',
  'Tips：自定义 Prompt 可改变 AI 写作风格',
  // 🥚 彩蛋
  'Tips：你在找什么？',
  'Tips：今晚吃什么？',
  'Tips：这条 Tips 没什么用，但你还是看完了',
  'Tips：你已经是成熟的冒险者了，该自己做选择了',
];

const GAME_TIPS_EN = [
  'Tip: Click the top-left logo to return to the start screen',
  'Tip: You can change the UI scale in Settings (90% to 140%)',
  'Tip: Use the moon icon in Settings to switch between light and dark themes',
  'Tip: UI scale defaults to automatic width-based scaling',
  'Tip: API keys stay on this device and never go through this app server',
  'Tip: Advanced settings let you choose a model for each step',
  'Tip: You can add custom providers compatible with the OpenAI API',
  'Tip: Streaming mode shows replies token by token',
  'Tip: Each world card has its own save slots',
  'Tip: Saves can be exported as JSON for backup or sharing',
  'Tip: Save Manager can import save files from other players',
  'Tip: Returning to the start screen will auto-save your progress',
  'Tip: Message bubbles have copy, edit, delete, and regenerate actions',
  'Tip: Regenerate truncates the history after that message',
  'Tip: You can upload txt, md, and json documents as attachments',
  'Tip: Summaries can be edited or regenerated',
  'Tip: A chapter summary is generated every 20 turns',
  'Tip: If a summary is weak, regenerate it and let the AI rewrite it',
  'Tip: Character panels update automatically and new fields require approval',
  'Tip: Drag character cards to reorder them',
  'Tip: Any field in the character panel can be edited manually',
  'Tip: Design Mode lets you build a world from scratch',
  'Tip: Existing world cards can be imported back into Design Mode',
  'Tip: World cards can be exported and shared with other players',
  'Tip: Custom settings can change the opening greeting and init module',
  'Tip: Custom prompts can change the AI writing style',
  'Tip: What are you looking for?',
  'Tip: So, what are we eating tonight?',
  'Tip: This tip is not useful, but you still read it',
  'Tip: You are already a grown adventurer. Make the choice yourself',
];

/**
 * 获取一条随机 Tip（避免连续重复）
 */
let _lastTipIndex = -1;
function getRandomTip() {
  const locale = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
  const tips = locale === 'en' ? GAME_TIPS_EN : GAME_TIPS;
  if (tips.length <= 1) return tips[0] || '';
  let idx;
  do {
    idx = Math.floor(Math.random() * tips.length);
  } while (idx === _lastTipIndex);
  _lastTipIndex = idx;
  return tips[idx];
}

window.getRandomTip = getRandomTip;
