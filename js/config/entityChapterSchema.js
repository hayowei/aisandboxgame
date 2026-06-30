(function () {
  'use strict';

  // ============================================================
  // Entity 章节 schema 配置中枢（设计模式 Phase 2 Stage 1）
  //
  // V1（已发版老卡） = 整段五章 markdown 字符串
  //   [Geopolitics] / [History_Culture] / [System_Hierarchy] / [Economy_Environment] / [Narrative_Core]
  //   game runtime 整段 markdown 进 prompt；设计模式入口屏蔽（不允许二次编辑）。
  //
  // V2（plan-floating-engelbart, 本期重定义）= 结构化对象
  //   { entity_id, display_name, atmosphere, chapters{}, sites[], narrative_core_characters[] }
  //   章节锚 tag: [Here_Now] / [Social_Fabric] / [Order] / [World_Law] / [Rhythm] / [Narrative_Core]
  //   markdown 由 v2EntityMarkdown.js 从字段拼装供 runtime / search_world 使用。
  //
  // detectEntitySchema 现按数据形态判定：对象 → v2，字符串 → v1（按章节锚识别 v1 五章）。
  // ============================================================

  const ENTITY_CHAPTER_SCHEMA = Object.freeze({
    v1: Object.freeze({
      version: 'v1',
      chapters: Object.freeze([
        { idx: 1, tag: 'Geopolitics', zh: '第一章：基础地缘与世界定位', key: 'geopolitics' },
        { idx: 2, tag: 'History_Culture', zh: '第二章：历史起源与文化基调', key: 'history' },
        { idx: 3, tag: 'System_Hierarchy', zh: '第三章：社会治理与军事体系', key: 'system' },
        { idx: 4, tag: 'Economy_Environment', zh: '第四章：经济生态与环境场景', key: 'economy' },
        { idx: 5, tag: 'Narrative_Core', zh: '第五章：核心人物与当前局势', key: 'narrative' },
      ]),
    }),
    v2: Object.freeze({
      version: 'v2',
      chapters: Object.freeze([
        { idx: 1, tag: 'Here_Now', zh: '第一章：环境与场景', key: 'here_now' },
        { idx: 2, tag: 'Social_Fabric', zh: '第二章：势力分布', key: 'social_fabric' },
        { idx: 3, tag: 'Order', zh: '第三章：秩序与规则', key: 'order' },
        { idx: 4, tag: 'World_Law', zh: '第四章：世界法则', key: 'world_law' },
        { idx: 5, tag: 'Rhythm', zh: '第五章：日常节奏', key: 'rhythm' },
        { idx: 6, tag: 'Narrative_Core', zh: '第六章：当前剧情', key: 'narrative_core' },
      ]),
    }),
  });

  // V2 章节 key 列表（chapters 对象的属性名），按章顺序。
  const V2_CHAPTER_KEYS = Object.freeze(
    ENTITY_CHAPTER_SCHEMA.v2.chapters.map(c => c.key)
  );

  // keystone：锚基正则，章号不限——同时命中 v1 第五章 [Narrative_Core] 与 v2 第六章。
  // 主要给 V1 老卡的 runtime 读取路径用；V2 优先读结构化 narrative_core_characters 字段。
  const NARRATIVE_CORE_ANCHOR_RE = /###[^\n]*\[Narrative_Core\]([\s\S]*?)(?=###|$)/i;

  // V1 markdown 章节专属锚（V2 已脱离 markdown 形态，对象探测先于锚探测）。
  const V1_ONLY_TAGS = ['Geopolitics', 'History_Culture', 'System_Hierarchy', 'Economy_Environment'];

  // 探测 entity 形态：对象 → 'v2'，字符串 → 按锚识别 'v1'/'v2'（兼容工作树残留路径，
  // 但发版后所有新 V2 entity 都是对象、所有字符串 entity 都判为 V1）。
  function detectEntitySchema(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return 'v2';
    if (typeof value !== 'string' || !value) return 'v2';
    if (V1_ONLY_TAGS.some(t => value.indexOf('[' + t + ']') !== -1)) return 'v1';
    // 字符串但不是 V1 老锚 → 工作树未发版的 v2 markdown 残骸或空串，按 v1 兜底（设计模式入口屏蔽）。
    return 'v1';
  }

  function isV2Entity(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
  }

  // 取某格式的章节 tag 列表（inspection 等用）。
  function getChapterTags(version) {
    const schema = ENTITY_CHAPTER_SCHEMA[version] || ENTITY_CHAPTER_SCHEMA.v2;
    return schema.chapters.map(c => c.tag);
  }

  window.ENTITY_CHAPTER_SCHEMA = ENTITY_CHAPTER_SCHEMA;
  window.V2_CHAPTER_KEYS = V2_CHAPTER_KEYS;
  window.NARRATIVE_CORE_ANCHOR_RE = NARRATIVE_CORE_ANCHOR_RE;
  window.detectEntitySchema = detectEntitySchema;
  window.isV2Entity = isV2Entity;
  window.getEntityChapterTags = getChapterTags;
})();
