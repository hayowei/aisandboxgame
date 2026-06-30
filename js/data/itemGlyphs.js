// js/data/itemGlyphs.js
// 物品 icon 单一事实源：picker UI 列表 + 启发式映射 + 默认 fallback
// 字体子集 allowlist 在 tools/fonts/material-icons-items-allowlist.json， /* ui-lint-allow: 历史命名，文件 path 字面量 */
// 两边的 glyph name 集合必须同步（否则 picker 选到的 icon 渲染空白）

(function () {
  'use strict';

  // 完整可选 glyph 列表（与字体子集 allowlist 同步）
  const ITEM_GLYPHS = [
    { glyph: 'inventory_2', label: '通用物品', category: '默认' },
    // 武器
    { glyph: 'gavel', label: '剑/裁决', category: '武器' },
    { glyph: 'handyman', label: '工具/匕首', category: '武器' },
    { glyph: 'construction', label: '重武器', category: '武器' },
    // 防具
    { glyph: 'shield', label: '盾/护甲', category: '防具' },
    { glyph: 'security', label: '锁盾', category: '防具' },
    { glyph: 'sports_motorsports', label: '头盔', category: '防具' },
    // 消耗
    { glyph: 'medication', label: '药丸', category: '消耗' },
    { glyph: 'science', label: '试剂', category: '消耗' },
    { glyph: 'water_drop', label: '液体', category: '消耗' },
    { glyph: 'nutrition', label: '果实', category: '消耗' },
    { glyph: 'restaurant', label: '食物', category: '消耗' },
    { glyph: 'bakery_dining', label: '面包', category: '消耗' },
    { glyph: 'local_drink', label: '饮料', category: '消耗' },
    { glyph: 'emoji_food_beverage', label: '热饮', category: '消耗' },
    // 钥匙/锁
    { glyph: 'key', label: '钥匙', category: '钥匙' },
    { glyph: 'lock', label: '锁', category: '钥匙' },
    // 书/卷
    { glyph: 'menu_book', label: '书', category: '书卷' },
    { glyph: 'auto_stories', label: '翻开的书', category: '书卷' },
    { glyph: 'description', label: '纸卷', category: '书卷' },
    { glyph: 'contract', label: '契约', category: '书卷' },
    { glyph: 'history_edu', label: '羊皮卷', category: '书卷' },
    // 钱币/宝物
    { glyph: 'paid', label: '硬币', category: '钱币' },
    { glyph: 'payments', label: '钞票', category: '钱币' },
    { glyph: 'savings', label: '存钱罐', category: '钱币' },
    { glyph: 'diamond', label: '宝石', category: '钱币' },
    { glyph: 'token', label: '令牌', category: '钱币' },
    { glyph: 'stars', label: '星辉', category: '钱币' },
    // 科技/赛博
    { glyph: 'memory', label: '内存', category: '科技' },
    { glyph: 'developer_board', label: '芯片', category: '科技' },
    { glyph: 'bolt', label: '能量', category: '科技' },
    { glyph: 'battery_full', label: '电池', category: '科技' },
    { glyph: 'battery_charging_full', label: '充电中', category: '科技' },
    { glyph: 'usb', label: 'USB', category: '科技' },
    { glyph: 'sd_card', label: 'SD 卡', category: '科技' },
    { glyph: 'cable', label: '线缆', category: '科技' },
    { glyph: 'network_node', label: '网络节点', category: '科技' },
    { glyph: 'cell_tower', label: '信号塔', category: '科技' },
    { glyph: 'router', label: '路由', category: '科技' },
    // 容器/杂
    { glyph: 'backpack', label: '背包', category: '杂项' },
    { glyph: 'luggage', label: '行李箱', category: '杂项' },
    { glyph: 'folder', label: '文件夹', category: '杂项' },
    { glyph: 'headphones', label: '耳机', category: '杂项' },
    { glyph: 'camera', label: '相机', category: '杂项' },
    { glyph: 'pets', label: '宠物', category: '杂项' },
    { glyph: 'local_florist', label: '花草', category: '杂项' },
  ];

  // 启发式映射：物品名命中正则 → 默认 glyph（玩家无手动覆盖时使用）
  const HEURISTIC_RULES = [
    { match: /剑|刀|枪|戟|斧|锤|sword|blade|axe|hammer/, glyph: 'gavel' },
    { match: /药|丹|剂|pill|potion|drug|medic/,           glyph: 'medication' },
    { match: /试剂|烧瓶|flask|reagent/,                    glyph: 'science' },
    { match: /甲|护|盾|shield|armor/,                       glyph: 'shield' },
    { match: /头盔|helmet|hat/,                             glyph: 'sports_motorsports' },
    { match: /书|卷|轴|book|tome/,                          glyph: 'menu_book' },
    { match: /契约|协议|contract/,                          glyph: 'contract' },
    { match: /钥|匙|key/,                                   glyph: 'key' },
    { match: /锁|lock/,                                     glyph: 'lock' },
    { match: /电|能|火|bolt|charge|算力|T算/,               glyph: 'bolt' },
    { match: /电池|battery/,                                glyph: 'battery_full' },
    { match: /银|金|币|钱|coin|money|cash/,                 glyph: 'paid' },
    { match: /宝|玉|珠|gem|jewel|diamond|crystal/,          glyph: 'diamond' },
    { match: /令牌|凭证|token|voucher/,                     glyph: 'token' },
    { match: /星|stars/,                                    glyph: 'stars' },
    { match: /芯|片|chip|board|circuit/,                    glyph: 'developer_board' },
    { match: /内存|memory|ram/,                             glyph: 'memory' },
    { match: /线|缆|接口|cable|wire|cord|usb/,              glyph: 'cable' },
    { match: /网络|信号|塔|tower|node|network/,             glyph: 'network_node' },
    { match: /路由|router/,                                 glyph: 'router' },
    { match: /sd|存储卡/,                                   glyph: 'sd_card' },
    { match: /包|箱|袋|backpack|bag|box/,                   glyph: 'backpack' },
    { match: /面包|bread/,                                  glyph: 'bakery_dining' },
    { match: /食|肉|果|food|meal/,                          glyph: 'restaurant' },
    { match: /水|液|drink|water/,                           glyph: 'water_drop' },
    { match: /酒|tea|coffee|beverage/,                      glyph: 'local_drink' },
    { match: /营养|nutrition|fruit/,                        glyph: 'nutrition' },
    { match: /工具|tool|wrench/,                            glyph: 'handyman' },
    { match: /宠物|pet|beast/,                              glyph: 'pets' },
    { match: /花|草|植物|flower|plant|herb/,                glyph: 'local_florist' },
    { match: /相机|摄|camera/,                              glyph: 'camera' },
    { match: /耳机|耳麦|headphone/,                         glyph: 'headphones' },
  ];

  const FALLBACK_GLYPH = 'inventory_2';

  function resolveItemGlyph(item) {
    if (!item) return FALLBACK_GLYPH;
    if (typeof item.icon === 'string' && item.icon.trim()) return item.icon.trim();
    if (!item.name) return FALLBACK_GLYPH;
    for (const rule of HEURISTIC_RULES) {
      if (rule.match.test(item.name)) return rule.glyph;
    }
    return FALLBACK_GLYPH;
  }

  window.ItemGlyphs = Object.freeze({
    LIST: ITEM_GLYPHS,
    HEURISTIC_RULES,
    FALLBACK_GLYPH,
    resolveItemGlyph,
  });

  console.log('[ItemGlyphs] Initialized — ' + ITEM_GLYPHS.length + ' glyphs available');
})();
