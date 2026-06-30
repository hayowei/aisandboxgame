// ============================================
// Opening Button Sentinels（开局选择按钮 sentinel 文案）
// ============================================
// 玩家点开局按钮 = 发这段【固定文本】作为消息 → starter 据此把判别式（existing/generated）定死。
// 这里是单一真源：chatCore.renderOpeningChoiceButtonsHtml 渲染按钮 + starterSubagent._starterForcedSource
// 反向判别都引用本常量，防两处各写一份硬编码悄悄漂移（曾把"随机主角"误判成 existing、套了作者推荐主角）。
//
// 每项：{ zh, en, source }。source = 该按钮对应的 starter 判别式（existing=用作者主角 / generated=现造）。
// 加载顺序：放在 chatCore.js / starterSubagent.js 之前（index.html 的 config 段）。
(function () {
  const OPENING_BUTTON_SENTINELS = Object.freeze({
    recommended: Object.freeze({ zh: '以推荐主角开场', en: 'Start as the recommended protagonist', source: 'existing' }),
    plain: Object.freeze({ zh: '以「普通人」身份开场', en: 'Start as an ordinary person', source: 'generated' }),
    random: Object.freeze({ zh: '随机主角开场', en: 'Start with a random protagonist', source: 'generated' }),
  });
  if (typeof window !== 'undefined') window.OPENING_BUTTON_SENTINELS = OPENING_BUTTON_SENTINELS;
})();
