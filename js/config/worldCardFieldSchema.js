/**
 * js/config/worldCardFieldSchema.js
 *
 * 世界卡 V2 高频字段结构化 schema——给 P3 lookup_schema 工具用的 L1 数据源。
 *
 * 覆盖 ~40 个高频字段。未命中的字段会 fallback 到 __rfb_data（V2.md 全文）grep。
 *
 * Path 形态：JSON Pointer + `{id}` / `{idx}` 占位符。
 *   - `{id}` 代表非数字动态 key（NPC 名字 / entity id 等）
 *   - `{idx}` 代表数组数字索引
 *
 * lookup(path) 做路径标准化：把实际路径中的动态段替换成占位符再查。
 *
 * 文档来源：内部设计文档 + prompts/designmode.js + designConfig 现状
 * 字段定义"快照"于 2026-05-27 工作树状态。若 schema 演进，更新本文件。
 *
 * 暴露 window.worldCardFieldSchema.lookup(path)。
 */

(function () {
  'use strict';

  const SCHEMA = {
    // ============================================
    // 顶层结构
    // ============================================
    '/_schema_version': {
      type: 'integer',
      label: 'schema 格式号',
      desc: 'V2 卡固定为 2；V1 → V2 迁移会写本字段。读 isOriginallyV1() 用 _origin_schema_version 不是这个。',
      examples: [2],
      related: ['_origin_schema_version'],
    },
    '/_origin_schema_version': {
      type: 'integer',
      label: '原始 schema 格式',
      desc: 'V1 卡迁移到 V2 时记录原始格式（=1）；新卡直接 V2 时不写或写 2。判断"老卡 V1 编辑 gate"的关键字段。',
      examples: [1, 2],
    },

    // ============================================
    // designMeta + p1Output（Phase 1 产物）
    // ============================================
    '/designMeta': {
      type: 'object',
      label: '设计元数据容器',
      desc: '存 Phase 1 / Phase 2 各阶段的中间产物。p1Output 在此层级下。',
      related: ['p1Output'],
    },
    '/designMeta/p1Output': {
      type: 'object',
      label: 'Phase 1 输出',
      desc: 'Phase 1 confirm 页确认后的产物。含 frozen_moment / player_anchor / world_terms / narrative_core_characters。',
      related: ['frozen_moment', 'player_anchor', 'world_terms'],
    },
    '/designMeta/p1Output/frozen_moment': {
      type: 'object',
      label: '时间锚定',
      desc: '世界卡的"此刻" — 玩家进入沙盒的开局时间点。datetime 必填 ISO-like 形式，label 是人话描述，world_tense 是此刻世界的叙事张力态。',
      constraint: '不再含 location 字段（V2 1E 后挪到 wizard 由玩家选）；datetime 格式 "YYYY-MM-DD HH:MM" 或纪年文本',
      examples: [
        { datetime: '道历3年 5月12日 14:30', label: '初春午后，城门外', source: 'inferred', world_tense: 'imminent' },
      ],
      related: ['datetime', 'label', 'source', 'world_tense'],
    },
    '/designMeta/p1Output/frozen_moment/datetime': {
      type: 'string',
      label: '此刻时间',
      desc: '必含 HH:MM 时分（V2 fatal 校验）。年月日可以用纪年文本或公历。',
      constraint: '格式必须含可解析的 HH:MM 时间段',
      examples: ['2024-03-15 14:30', '道历3年 5月12日 14:30'],
    },
    '/designMeta/p1Output/frozen_moment/source': {
      type: 'string',
      label: '来源标记',
      desc: 'explicit=作者改过；inferred=Phase 1 AI 抽取；defaulted=系统兜底。',
      enum: ['explicit', 'inferred', 'defaulted'],
    },
    '/designMeta/p1Output/frozen_moment/world_tense': {
      type: 'string',
      label: '张力时态',
      desc: '此刻世界的叙事张力态：calm=平静（祥和稳态、看不到变天迹象）/ imminent=将临（某事即将发生，量级不限）/ aftermath=事后（某事刚发生完、世界在余波里）。开场白据此定基调。',
      enum: ['calm', 'imminent', 'aftermath'],
    },
    '/designMeta/p1Output/player_anchor': {
      type: 'object',
      label: '玩家施力点',
      desc: 'Phase 1 必问的多选 A/B/C 题——玩家在世界里如何施加意志。assigned=指定人选；any_role=任意角色沙盒；director=导演/上帝视角。每卡必有，allowed_modes 至少含 any_role 兜底。',
      constraint: 'allowed_modes 必须是非空数组（V2 schema 强约束）',
      examples: [
        { allowed_modes: ['assigned', 'any_role'], compliance: 'medium', recommended_role: '陆青渊' },
      ],
      related: ['allowed_modes', 'compliance', 'recommended_role'],
    },
    '/designMeta/p1Output/world_terms': {
      type: 'object',
      label: '世界纪年/货币术语',
      desc: 'Wave 3B 单一真源——P1 产出。era_name（纪年名）+ currency_unit（货币单位）+ atmospheric_modifiers。各处取 era 名都从这里 derive。',
      examples: [
        { era_name: '道历', currency_unit: '灵石', atmospheric_modifiers: ['仙侠', '修真'] },
      ],
    },
    '/designMeta/p1Output/narrative_core_characters': {
      type: 'array',
      label: '叙事核心角色 ID 数组',
      desc: 'V2 Wave 1B 后从姓名 string[] 升级为 ID array。元素是 character_database 里的 key（id）。',
      constraint: '只能填实际存在于 character_database 的 id；3-5 个为佳',
      examples: [['陆青渊', '白薇师姐', '玄机子']],
    },

    // ============================================
    // world_setting（entity 数组容器）
    // ============================================
    '/world_setting': {
      type: 'object',
      label: '世界设定容器',
      desc: 'V2 中 settings 数组放在这里。',
      related: ['settings'],
    },
    '/world_setting/settings': {
      type: 'array',
      label: 'Entity 数组',
      desc: 'Phase 2 Stage 1 产物——世界级地点 entity（B 强读法：必须是地点类，势力/家族不能做 entity）。',
      constraint: 'V2 后 entity 是结构化对象（非 V1 markdown 字符串）。每个 entity 必须地点类',
      related: ['display_name', 'atmosphere', 'chapters', 'sites'],
    },
    '/world_setting/settings/{id}': {
      type: 'object',
      label: '单个 entity',
      desc: '一个世界地点。含 display_name / atmosphere / chapters（六章锚） / sites（地点子列表） / narrative_core_characters。',
      related: ['display_name', 'chapters', 'sites'],
    },
    '/world_setting/settings/{id}/display_name': {
      type: 'string',
      label: 'Entity 显示名',
      desc: '地点的展示名（人话）。',
      examples: ['玄机阁', '王都长安'],
    },
    '/world_setting/settings/{id}/atmosphere': {
      type: 'string',
      label: '氛围模板',
      desc: '为这个 entity 在 prompt 中选用的语气基调标签。',
      examples: ['仙侠', '蒸汽朋克', '现代都市'],
    },
    '/world_setting/settings/{id}/chapters': {
      type: 'object',
      label: 'Entity 6 章节内容',
      desc: 'V2 Wave 2A 后 entity 内容按 6 章组织：Here_Now / Social_Fabric / Order / World_Law / Rhythm / Narrative_Core。每章值是 string[]（句子数组）。',
      constraint: 'chapter key 全小写（here_now，不是 Here_Now；PascalCase 仅是 markdown 锚点 tag）；value 是 string[]',
      examples: [
        {
          here_now: ['此刻药圃静谧', '弟子在打扫'],
          social_fabric: ['玄机子门下三名弟子'],
          order: ['门规森严'],
          world_law: ['修真法则盛行'],
          rhythm: ['每月初一长老下山'],
          narrative_core: ['陆青渊是隐藏的关键'],
        },
      ],
    },
    '/world_setting/settings/{id}/sites': {
      type: 'array',
      label: 'Entity 内地点（site 树）',
      desc: '每个 entity 的地点是 site 树：[{ site, atmosphere?, spots: [{ spot, atmosphere? }] }]。中段名 site 每个只写一次；末段 spot 挂在该 site 的 spots 数组里。三段式 = display_name(country) / site / spot。每 site ≥1 spot、每 entity ≥3 spot（跨 site 合计），树内禁 {?Unknown?}/未知 占位。详见 内部设计文档 §2.1。',
      constraint: 'site 树形：[{site, spots:[{spot, atmosphere?}], atmosphere?}]，不是扁平 {site, spot} 对',
      examples: [[{ site: '太阿城', spots: [{ spot: '城门交易广场', atmosphere: '人声鼎沸' }, { spot: '悦来客栈' }] }]],
    },

    // ============================================
    // prompt_modules（4 必填模块）
    // ============================================
    '/prompt_modules': {
      type: 'object',
      label: 'prompt 模块容器',
      desc: 'V2 prompt 模块容器。注意（Wave 1C）：opening_greeting 已上移到 snapshot 顶层 /opening_greeting，本容器内仅作 V1 兜底、不再是必含 key；必备模块在 modules 子对象内。',
      constraint: '必备模块缺失会被体检报错；opening_greeting 缺失与否按顶层判定（C5 双源）',
      related: ['core_world_mechanics', 'character_setup_rules', 'system_rules'],
    },
    '/prompt_modules/core_world_mechanics': {
      type: 'string',
      label: '核心世界机制',
      desc: '世界运行的关键机制 prompt——给 runtime GM 的世界观核心规则。fatal 字段，V2 后升级整合主角能力（不再单独字段）。',
      constraint: '非空字符串；含世界本质机制 + 主角能力',
    },
    '/opening_greeting': {
      type: 'string',
      label: '开场白',
      desc: 'V2 正位（Wave 1C 从 prompt_modules 上移到 snapshot 顶层）。150-350 字 in-medias-res 段落：第一句开在 frozen_moment 已进行中的动作上（禁静态全景起手）；画面各阶层同被事件压住、威胁不指向预设身份；结尾停在悬而未决的空位——不发问、不替玩家做动作或说台词（身份由正文下方开场按钮决定）。',
      constraint: '150-350 字；必含世界纪年词（world_terms.calendar_era，体检 I5）；禁止含 HH:MM / 具体角色名；不写死玩家身份与玩家位置；禁止结尾问句串与"而你也在…"枢轴',
    },
    '/prompt_modules/opening_greeting': {
      type: 'string',
      label: '开场白（V1 老位置）',
      desc: 'V1 老位置——V2 Wave 1C 已上移到 snapshot 顶层 /opening_greeting（运行时顶层优先、本位置兜底，详 getOpeningGreeting）。写法规格同顶层条目。',
      constraint: '同 /opening_greeting：150-350 字；必含世界纪年词；禁止 HH:MM / 具体角色名 / 结尾问句串',
    },
    '/prompt_modules/character_setup_rules': {
      type: 'string',
      label: '角色塑造规则',
      desc: '给 runtime GM 的角色塑造指导。',
    },
    '/prompt_modules/system_rules': {
      type: 'string',
      label: '系统规则',
      desc: '游戏机制层规则（骰子、面板、推断逻辑等）。',
    },

    // ============================================
    // character_database（角色数据库）
    // ============================================
    '/character_database': {
      type: 'object',
      label: '角色数据库',
      desc: 'key = 角色 id（通常是姓名），value = 角色完整对象。',
      related: ['role_marker', 'cognitive_state', 'dialogue_tone'],
    },
    '/character_database/{id}': {
      type: 'object',
      label: '单个角色',
      desc: '所有字段层级。core fields = name/role_marker/cognitive_state/dialogue_tone/initial_status/dialogue_examples/relationships。',
      related: ['cognitive_state', 'dialogue_tone', 'dialogue_examples', 'initial_status'],
    },
    '/character_database/{id}/is_protagonist': {
      type: 'boolean',
      label: '是否主角',
      desc: 'Wave 3C 主角标记的**单一真源**：true = 该角色是主角（主角 = 带此标记的普通 NPC）。判定优先读它；role_marker/role 仅作老卡读时回退（[[isProtagonist]] helper 三层兼容）。新卡标主角请写 is_protagonist:true。',
      examples: [true, false],
      related: ['role_marker'],
    },
    '/character_database/{id}/role_marker': {
      type: 'string',
      label: '角色标记（legacy）',
      desc: 'V2 Wave 1A 双义解耦——标"主角"/"配角"。**Wave 3C 后主角判定的单一真源是 is_protagonist（布尔）**，role_marker 仅作老卡回退保留。**不能用 role 字段判断（V1 双义历史包袱）**——用 [[isProtagonist]] helper 三查兼容。',
      enum: ['主角', '配角'],
      examples: ['主角', '配角'],
    },
    '/character_database/{id}/aliases': {
      type: 'array',
      label: '别名/职衔',
      desc: '活世界·三态：叙事中指代该角色的别名/职衔/绰号（如"烈火峰首座"/"李长老"）。引擎 findRosterCharacter 精确命中别名 → 叙事用别名提到时直接命中作者档案，避免建出重复角色卡（runtime NPC 去重）。可选；缺省只按规范名匹配。',
      constraint: '字符串数组；只填该角色真实会被叫到的专属称呼，别填会撞到别人的泛称（如"长老""前辈"）。',
      examples: [['烈火峰首座', '李长老', '李师叔']],
    },
    '/character_database/{id}/cognitive_state': {
      type: 'string',
      label: '此刻自我认知',
      desc: '角色在 frozen_moment 这一刻认为自己是谁。runtime NPC 行为驱动字段（CognitiveAnalyzer 用）。',
      constraint:
        '禁包含：对玩家的态度（"对外人警惕"）/ 情绪化变量（"今天很生气"）/ 剧情进展（"刚刚发现真相"）。要写持久的认知框架。',
      examples: ['被罚守渡口的外门弟子', '王都骑士', '隐姓埋名的前太子'],
      related: ['frozen_moment', 'initial_status', 'dialogue_tone'],
    },
    '/character_database/{id}/dialogue_tone': {
      type: 'string',
      label: '说话语气',
      desc: 'V2 Wave 改名（V1 = msg_reply_tone）。runtime NPC 对话风格。',
      examples: ['谨慎低调，少言简语', '热情自来熟，称呼亲昵'],
      related: ['dialogue_examples'],
    },
    '/character_database/{id}/dialogue_examples': {
      type: 'object',
      label: '对话示例（few-shot）',
      desc: 'V2 双桶 schema：{in_person: [...], sms: [...]}。每条形态 = {context, line}。in_person ≥6 条 / sms ≥4 条。',
      constraint: '形态严格 {in_person: [{context, line}], sms: [{context, line}]}',
      examples: [
        {
          in_person: [
            { context: '被问及来历', line: '不过路过此地，借宿一晚。' },
          ],
          sms: [{ context: '收到约见', line: '可以。地点说一下。' }],
        },
      ],
      related: ['dialogue_tone'],
    },
    '/character_database/{id}/initial_status': {
      type: 'string',
      label: '初始状态',
      desc: 'V2 Stage 3 必填字段。frozen_moment 一刻角色身体 + 情绪 + 在场 + 动作的单行描述。',
      constraint: '单行字符串（不是多字段对象）',
      examples: ['在药圃打扫，神色专注，对外界毫无察觉'],
      related: ['cognitive_state', 'frozen_moment'],
    },
    '/character_database/{id}/relationships': {
      type: 'object',
      label: '人物关系',
      desc: 'V2 Stage 4 重构：每个角色的关系字典放在自己 schema 下。key = 对方 id；value = 关系描述文本（夹叙时间维度）。',
      constraint: 'key 必须是另一个 character_database 里实际存在的 id；双向写（两边都填）',
      examples: [{ 玄机子: '名义师父，实为囚禁者。半年前察觉真相但隐忍。' }],
    },
    '/character_database/{id}/personality': {
      type: 'string',
      label: '性格',
      desc: '角色性格特征。属 npc 动态字段（panel_fields.npc.custom_fields 定义形态）。',
    },
    '/character_database/{id}/appearance': {
      type: 'string',
      label: '外貌',
      desc: '外貌描述。',
    },
    '/character_database/{id}/clothing': {
      type: 'string',
      label: '衣着',
      desc: '当前服饰。',
    },
    '/character_database/{id}/backstory': {
      type: 'string',
      label: '背景故事',
      desc: '角色背景。',
    },
    '/character_database/{id}/age': {
      type: 'integer',
      label: '年龄',
      desc: 'V2 Stage 3 后字段。允许 null（未知）。age=0 防御已删（V2）。',
    },
    '/character_database/{id}/birthday': {
      type: 'string',
      label: '生日',
      desc: '"YYYY-MM-DD" 或纪年文本。',
    },
    '/character_database/{id}/gender': {
      type: 'string',
      label: '性别',
      desc: '中文写"男"/"女"/"未知"。',
    },
    '/character_database/{id}/name': {
      type: 'string',
      label: '姓名',
      desc: '展示姓名（一般 == id；可不同）。',
    },
    '/character_database/{id}/id': {
      type: 'string',
      label: '角色 ID',
      desc: '一般同 key（character_database 的 key）。',
    },

    // ============================================
    // world_timeline（重命名自 timeline）
    //
    // 真实卡里有两种形态共存（V2 schema 未一致）：
    //   A. dict 形态：{events: [...], _summary: ...}  ← 多数内置卡是这种
    //   B. 直接数组：[...]                            ← 少数样本
    // SCHEMA 两种都覆盖，diff 翻译都能识别。
    // ============================================
    '/world_timeline': {
      type: 'object|array',
      label: '世界时间线',
      desc: 'V2 重命名（V1 = timeline）。Stage 4 硬聚合产物：≥10 条事件。形态既可能是 {events:[...]} dict、也可能是直接数组。',
      constraint: '≥10 条；按时间序；character_timelines 顶层字段已废，全并入此处',
      related: ['entity_refs', 'character_refs'],
    },
    // dict 形态：/world_timeline/events/{idx}/...
    '/world_timeline/events': {
      type: 'array',
      label: '时间线事件列表',
      desc: 'world_timeline dict 形态下的事件数组（events 子字段）。',
    },
    '/world_timeline/events/{idx}': {
      type: 'object',
      label: '单个时间线事件',
      desc: '形态 = {date, location, description, entity_refs, character_refs}。',
    },
    '/world_timeline/events/{idx}/date': {
      type: 'string',
      label: '事件日期',
      desc: '可用纪年或公历。',
    },
    '/world_timeline/events/{idx}/location': {
      type: 'object',
      label: '事件地点',
      desc: '三段式对象 { country, site, spot }（§2.1）：country = entity display_name，site/spot 为其下地点；缺段从右往左补 "未知"。老卡可能是 "country / site / spot" 分隔串，运行时自动升格。',
      examples: [{ country: '东荒', site: '太阿城', spot: '城门交易广场' }],
    },
    '/world_timeline/events/{idx}/description': {
      type: 'string',
      label: '事件描述',
      desc: '事件具体经过（叙事性段落）。',
    },
    '/world_timeline/events/{idx}/entity_refs': {
      type: 'array',
      label: '涉及 entity 列表',
      desc: 'string[]，引 world_setting.settings 里的 display_name。',
    },
    '/world_timeline/events/{idx}/character_refs': {
      type: 'array',
      label: '涉及角色列表',
      desc: 'string[]，引 character_database 里的 id。',
    },
    // 直接数组形态：/world_timeline/{idx}/...（兼容保留）
    '/world_timeline/{idx}': {
      type: 'object',
      label: '单个时间线事件',
      desc: '形态 = {date, location, description, entity_refs, character_refs}。',
    },
    '/world_timeline/{idx}/date': {
      type: 'string',
      label: '事件日期',
      desc: '可用纪年或公历。',
    },
    '/world_timeline/{idx}/location': {
      type: 'string',
      label: '事件地点',
      desc: '指 entity display_name 或 site name。',
    },
    '/world_timeline/{idx}/description': {
      type: 'string',
      label: '事件描述',
      desc: '事件具体经过（叙事性段落）。',
    },
    '/world_timeline/{idx}/entity_refs': {
      type: 'array',
      label: '涉及 entity 列表',
      desc: 'string[]，引 world_setting.settings 里的 display_name。',
    },
    '/world_timeline/{idx}/character_refs': {
      type: 'array',
      label: '涉及角色列表',
      desc: 'string[]，引 character_database 里的 id。',
    },

    // ============================================
    // panel_fields（面板字段配置）
    // ============================================
    '/panel_fields': {
      type: 'object',
      label: '面板字段配置容器',
      desc: 'V2 Wave 1E 改名（V1 = step3_fields）。两个 sub-key：status / npc。',
      related: ['status', 'npc'],
    },
    '/panel_fields/status': {
      type: 'object',
      label: '状态栏字段',
      desc: 'V2 Wave 2A 新形态 = {system_fields: [], custom_fields: []}。',
    },
    '/panel_fields/status/system_fields': {
      type: 'array',
      label: '系统状态字段',
      desc: '4 个固定字段：datetime / location / money / objective。形态见 [[panelFieldDefaults]]。',
      constraint: '4 个 key 固定，不能增删；只能改 label/icon 等显示属性',
    },
    '/panel_fields/status/custom_fields': {
      type: 'array',
      label: '自定义状态字段',
      desc: '作者自定义的状态字段（如"灵力值"/"声望"）。',
    },
    '/panel_fields/npc': {
      type: 'object',
      label: 'NPC 字段配置',
      desc: '形态同 status：{system_fields, custom_fields}。',
    },
    '/panel_fields/npc/system_fields': {
      type: 'array',
      label: '系统 NPC 字段',
      desc: 'V2 Wave 2B 后**不再含 trigger_type**（移到 GM 工具协议层）。系统字段 = name/id/gender/appearance/clothing 等。',
      constraint: 'V2 禁止含 trigger_type',
    },
    '/panel_fields/npc/custom_fields': {
      type: 'array',
      label: '自定义 NPC 字段',
      desc: '作者自定义的 NPC 字段（如"门派"/"修为等级"）。',
    },
  };

  /**
   * 按 path 查 schema 定义。
   *
   * 命中策略：
   * 1. 直接查 SCHEMA[path]（精确匹配）
   * 2. **Reverse lookup**：对每个 SCHEMA key 按 segment 跟 path 比对，
   *    `{id}` 段通配任意非数字 segment、`{idx}` 段通配数字 segment。
   *    精确命中第一个匹配。
   * 3. 都不命中 → 返 null（caller 走 markdown grep fallback）
   *
   * 旧实现用 normalizePath 把所有中段当 `{id}`，会把 fixed key（如 settings、
   * system_fields）也错替换 → SCHEMA 找不到。Reverse lookup 不会有这个问题：
   * fixed key 段必须 ===，{id}/{idx} 才走通配。
   */
  function lookup(path) {
    if (typeof path !== 'string') return null;
    if (SCHEMA[path]) return SCHEMA[path];

    const pathParts = path.split('/');
    for (const schemaKey of Object.keys(SCHEMA)) {
      const schemaParts = schemaKey.split('/');
      if (schemaParts.length !== pathParts.length) continue;
      let match = true;
      for (let i = 0; i < schemaParts.length; i++) {
        const s = schemaParts[i];
        const p = pathParts[i];
        if (s === p) continue;
        if (s === '{idx}') {
          if (!/^\d+$/.test(p)) { match = false; break; }
          continue;
        }
        if (s === '{id}') {
          // {id} 通配任意非空 segment（含中文 NPC 名 / entity id）
          if (!p) { match = false; break; }
          continue;
        }
        match = false;
        break;
      }
      if (match) return SCHEMA[schemaKey];
    }
    return null;
  }

  /** 列出所有已知 path（debug / 测试用） */
  function listPaths() {
    return Object.keys(SCHEMA).sort();
  }

  // ============================================
  // Diff 翻译 helpers（P3 diff UI 用）
  // ============================================

  const OP_LABELS = {
    zh: { add: '新增', remove: '删除', replace: '修改', move: '移动', copy: '复制', test: '校验' },
    en: { add: 'Add',  remove: 'Remove', replace: 'Modify', move: 'Move', copy: 'Copy', test: 'Test' },
  };

  /** 数组元素摘要 fallback 字段链（按序找第一个非空 string）。 */
  const PEEK_FALLBACK_FIELDS = ['name', 'title', 'display_name', 'label', 'description', 'text', 'date'];

  /** JSON Pointer 转义反解：~1 → /，~0 → ~（RFC 6901） */
  function decodePointer(seg) {
    return String(seg).replace(/~1/g, '/').replace(/~0/g, '~');
  }

  /**
   * 按 JSON Pointer 取值。优先用 window.jsonpatch.getValueByPointer 一致行为；
   * 没加载就手写解析（不依赖 p3Tools，p3.css/p3UI 加载早于 p3Tools 也能用）。
   */
  function _getByPointer(root, pointer) {
    if (!pointer || pointer === '/') return root;
    if (typeof pointer !== 'string' || pointer[0] !== '/') return undefined;
    if (window.jsonpatch?.getValueByPointer) {
      try { return window.jsonpatch.getValueByPointer(root, pointer); }
      catch (_) { return undefined; }
    }
    const segs = pointer.slice(1).split('/').map(decodePointer);
    let cur = root;
    for (const seg of segs) {
      if (cur == null) return undefined;
      if (Array.isArray(cur)) {
        const i = parseInt(seg, 10);
        if (Number.isNaN(i) || i < 0 || i >= cur.length) return undefined;
        cur = cur[i];
      } else if (typeof cur === 'object') {
        if (!(seg in cur)) return undefined;
        cur = cur[seg];
      } else return undefined;
    }
    return cur;
  }

  /** 把数组元素提炼成 20 字以内的摘要（用于 deep peek）。 */
  function _peekArrayElement(elem) {
    if (elem == null) return '';
    if (typeof elem === 'string') return _truncate(elem, 20);
    if (typeof elem !== 'object') return _truncate(String(elem), 20);
    for (const k of PEEK_FALLBACK_FIELDS) {
      const v = elem[k];
      if (typeof v === 'string' && v.trim()) return _truncate(v.trim(), 20);
    }
    return '';
  }

  function _truncate(s, n) {
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /**
   * 翻译 op 动词为本地化字符串。
   * @param {string} op  add / remove / replace / move / copy / test
   * @param {'zh'|'en'} [lang='zh']
   */
  function formatOp(op, lang) {
    const dict = (lang === 'en' ? OP_LABELS.en : OP_LABELS.zh);
    return dict[op] || op;
  }

  /**
   * 把 JSON Pointer 翻译成人话面包屑。
   *
   * 算法：
   *   1. split path 成 segments
   *   2. 累积前缀，逐段查 SCHEMA 拿 label；命中用 label，不命中用 raw segment
   *   3. 纯数字 segment → 「第 N+1 个」（1-based）+ deep peek 拿元素摘要
   *   4. 段间用 ` · ` 分隔
   *
   * @param {string} path - JSON Pointer（如 "/world_timeline/events/3/location"）
   * @param {object} [currentDoc] - designConfig，给 deep peek 用；不传不 peek
   * @param {'zh'|'en'} [lang='zh']
   * @returns {string} 「世界时间线 · 时间线事件列表 · 第 4 个事件「上一任守阁人失踪」 · 事件地点」
   */
  function formatPathBreadcrumb(path, currentDoc, lang) {
    if (typeof path !== 'string' || !path || path === '/') return '（根）';
    if (path[0] !== '/') return path; // 异常 path，原样返
    const segs = path.split('/').slice(1).map(decodePointer); // 去掉空头
    const parts = [];
    let prefix = '';
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const prevPrefix = prefix;
      prefix = prefix + '/' + escapePointerSegment(seg);

      const isNumeric = /^\d+$/.test(seg);
      if (isNumeric) {
        // 数组数字索引
        const idx = parseInt(seg, 10);
        let label = `第 ${idx + 1} 个`;
        // deep peek：从 currentDoc 拿这个数组元素的关键字段做摘要
        if (currentDoc) {
          const elem = _getByPointer(currentDoc, prefix);
          const peek = _peekArrayElement(elem);
          if (peek) label = `第 ${idx + 1} 个「${peek}」`;
        }
        parts.push(label);
      } else {
        // 字段名 / 中文 key / entity id 等：查 schema 取 label
        const def = lookup(prefix);
        if (def && def.label) {
          parts.push(def.label);
        } else {
          // schema 未命中：直接用原 segment（中文 NPC 名等本身就是人话）
          parts.push(seg);
        }
      }
    }
    return parts.join(' · ');
  }

  /** JSON Pointer 段编码（formatPathBreadcrumb 内拼前缀用，对应 RFC 6901）。 */
  function escapePointerSegment(seg) {
    return String(seg).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  window.worldCardFieldSchema = {
    lookup,
    listPaths,
    formatOp,
    formatPathBreadcrumb,
    _SCHEMA: SCHEMA,
    _peekArrayElement, // 测试 / debug
  };
})();
