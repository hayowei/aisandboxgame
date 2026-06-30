(function () {
  'use strict';

  const OPTIONS = Object.freeze({
    1: Object.freeze({
      choice: 1,
      label: '赛博朋克风格',
      labelEn: 'Cyberpunk',
      hint: '你刚才选择了「赛博朋克风格」，接下来我会优先按高科技都市、公司势力和义体改造这类方向给你建议。',
      hintEn:
        'You chose a cyberpunk style in the welcome flow, so I will prioritize high-tech cities, corporate factions, and augmentation themes in my suggestions.',
      worldCardId: 'wc_builtin_cyberpunk',
      themeSkin: 'cyberpunk',
      themeMode: 'dark',
      placeholder: false,
    }),
    2: Object.freeze({
      choice: 2,
      label: '修仙世界风格',
      labelEn: 'Cultivation World',
      hint: '你刚才选择了「修仙世界风格」，接下来我会优先按宗门争斗、底层求生和秘境机缘这类方向给你建议。',
      hintEn:
        'You chose a cultivation world style in the welcome flow, so I will prioritize sect conflict, bottom-tier survival, and secret-realm opportunities in my suggestions.',
      worldCardId: 'wc_builtin_cultivation',
      themeSkin: 'cultivation',
      themeMode: 'light',
      placeholder: false,
    }),
    3: Object.freeze({
      choice: 3,
      label: '轻奇幻风格',
      labelEn: 'Light Fantasy',
      hint: '你刚才选择了「轻奇幻风格」，接下来我会优先按边境城镇、日常冒险和轻悬念这类方向给你建议。',
      hintEn:
        'You chose a light fantasy style in the welcome flow, so I will prioritize border towns, grounded adventures, and light mystery in my suggestions.',
      worldCardId: 'wc_builtin_default',
      themeSkin: 'metro',
      themeMode: 'light',
      placeholder: false,
    }),
  });

  function getLauncherWorldChoiceMeta(choice) {
    return OPTIONS[Number(choice)] || null;
  }

  function getLauncherWorldChoiceOptions() {
    return Object.values(OPTIONS).map(option => ({ ...option }));
  }

  window.getLauncherWorldChoiceMeta = getLauncherWorldChoiceMeta;
  window.getLauncherWorldChoiceOptions = getLauncherWorldChoiceOptions;
})();
