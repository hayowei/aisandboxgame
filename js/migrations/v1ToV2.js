// migrations/v1ToV2 — V1 世界卡 → V2 形态的内存翻译器
//
// V1 兼容承诺 = 「可以继续玩，但不能再编辑」(内部设计文档)。
// 玩家手里的 V1 卡进游戏时由 migrations.migrateInMemory 一次性翻译成 V2 形态，runtime / store / wizard
// 等所有下游只看 V2，不需要知道 V1 存在。
//
// 本翻译器只处理"现有散落兜底链覆盖不到"的两个半能点：
//   1. player_anchor V1 单值 { mode: 'above_world' | 其他 } → V2 多选 { allowed_modes:[...], compliance, recommended_role }
//   2. snapshot.frozen_moment 顶层（最老 V1 形态）→ designMeta.p1Output.frozen_moment
//
// 其余 V1 字段（character.default_cognitive_state / msg_reply_tone / character_timelines /
// relationship_rules / snapshot.timeline 等）继续走各下游消费点的散落兜底链——这些位置已经
// 写进 项目内部规范「V1 兼容代码永不删」红线，不要在这里再做一次。
//
// 入参：原始 card 对象（深拷贝后的）。返回：原对象（就地写入；调用方应已传深拷贝副本）。

(function () {
  'use strict';

  // 旧 mode 字面值 → V2 allowed_modes / compliance / recommended_role
  // 参考 js/chat/chatCore.js:6374-6375 既有 in-place 迁移逻辑。
  function _migratePlayerAnchor(card) {
    const p1 = card && card.designMeta && card.designMeta.p1Output;
    if (!p1 || typeof p1 !== 'object') return;
    const anchor = p1.player_anchor;
    if (!anchor || typeof anchor !== 'object') return;
    if (Array.isArray(anchor.allowed_modes)) return; // 已是 V2 形态

    const oldMode = typeof anchor.mode === 'string' ? anchor.mode : null;
    let migrated;
    if (oldMode === 'above_world') {
      migrated = { allowed_modes: ['director'], compliance: 'conditional', recommended_role: null };
    } else if (oldMode === 'assigned') {
      migrated = {
        allowed_modes: ['assigned'],
        compliance: null,
        recommended_role: typeof anchor.recommended_role === 'string' ? anchor.recommended_role : null,
      };
    } else {
      // any_role 或其他未知 → 沙盒默认
      migrated = { allowed_modes: ['any_role'], compliance: null, recommended_role: null };
    }
    p1.player_anchor = migrated;
  }

  // V2 → 新 V2 形态（Wave 1E）：snapshot.step3_fields → snapshot.panel_fields，
  // designConfig.step3_fields → designConfig.panel_fields。运行时其他代码只读 panel_fields。
  function _migrateStep3FieldsName(card) {
    if (!card || typeof card !== 'object') return;
    if (card.snapshot && card.snapshot.step3_fields && !card.snapshot.panel_fields) {
      card.snapshot.panel_fields = card.snapshot.step3_fields;
      delete card.snapshot.step3_fields;
    }
    if (card.designConfig && card.designConfig.step3_fields && !card.designConfig.panel_fields) {
      card.designConfig.panel_fields = card.designConfig.step3_fields;
      delete card.designConfig.step3_fields;
    }
  }

  // Wave 2A+2B: panel_fields 新形态（system_fields + custom_fields 拆开）。
  // 旧形态：panel_fields = { panel_status: [...], panel_npc: [...], _worldTermsSource: {...} }
  // 新形态：panel_fields = { status: { system_fields, custom_fields }, npc: { system_fields, custom_fields }, _worldTermsSource }
  // 同时把 trigger_type 从 npc 字段列表移除（GM 工具协议字段，不是角色属性）。
  //
  // 兼容策略：old panel_status / panel_npc 数组保留（不删除），新形态作为派生视图加上。
  // 下游消费代码可以渐进迁移到新形态读取；老代码继续读 panel_status / panel_npc 也能工作。
  function _migratePanelFieldsShape(card) {
    if (!card || !card.snapshot) return;
    const pf = card.snapshot.panel_fields;
    if (!pf || typeof pf !== 'object') return;

    // panel_status[] → status.system_fields (default 5 templates) + custom_fields (作者额外加的)
    if (Array.isArray(pf.panel_status) && !pf.status) {
      const SYSTEM_TEMPLATES = new Set(['time', 'location', 'money', 'objective']);
      const systemFields = [];
      const customFields = [];
      for (const group of pf.panel_status) {
        if (!group || typeof group !== 'object') continue;
        const tmpl = group._template;
        if (SYSTEM_TEMPLATES.has(tmpl)) {
          systemFields.push(group);
        } else {
          customFields.push(group);
        }
      }
      pf.status = { system_fields: systemFields, custom_fields: customFields };
    }

    // panel_npc[] → npc.system_fields (引擎硬字段) + custom_fields (Stage 2 注入)
    // 同时过滤 trigger_type（Wave 2B：移到 GM 工具协议层）
    if (Array.isArray(pf.panel_npc) && !pf.npc) {
      const ENGINE_HARD = new Set([
        'id', 'name', 'gender', 'origin', 'birthday',
        'cognitive_state', 'initial_status',
        'dialogue_tone', 'dialogue_examples',
        'role', 'role_marker',
      ]);
      const systemFields = [];
      const customFields = [];
      for (const field of pf.panel_npc) {
        if (!field || typeof field !== 'object' || !field.key) continue;
        if (field.key === 'trigger_type') continue; // Wave 2B: 移出 panel_npc
        if (ENGINE_HARD.has(field.key)) {
          systemFields.push(field);
        } else {
          customFields.push(field);
        }
      }
      pf.npc = { system_fields: systemFields, custom_fields: customFields };
    }
  }

  // Wave 1B: narrative_core_characters 从姓名字符串 → 角色 ID。
  // 解决问题：①两个 NPC 重名时分辨不出 ②玩家改了角色名字这个清单不会自动跟着改。
  // 翻译策略：扫每个 entity.narrative_core_characters[]，对每个值，
  //   如果值已在 character_database 中存在（作为 ID），保留；
  //   否则，按 name 在 character_database 中查找，找到则替换为 ID；
  //   找不到则保留原值（姓名字符串）—— 留给 inspection K cross-cut 警告。
  // 顶层 _narrativeCoreCharacters fallback 不动（V1 兼容兜底，永久保留）。
  function _migrateNarrativeCoreCharactersToIds(card) {
    if (!card || !card.snapshot) return;
    const settings = card.snapshot.world_setting?.settings;
    const db = card.snapshot.character_database;
    if (!settings || typeof settings !== 'object') return;
    if (!db || typeof db !== 'object') return;
    // 建立 name → id 反查表（同名角色仅记录第一个，其余手动）
    const nameToId = {};
    for (const id of Object.keys(db)) {
      if (id.startsWith('_')) continue;
      const c = db[id];
      if (c && typeof c === 'object' && typeof c.name === 'string') {
        if (!nameToId[c.name]) nameToId[c.name] = id;
      }
    }
    for (const entityId of Object.keys(settings)) {
      if (entityId.startsWith('_')) continue;
      const ent = settings[entityId];
      if (!ent || typeof ent !== 'object' || Array.isArray(ent)) continue;
      const list = ent.narrative_core_characters;
      if (!Array.isArray(list)) continue;
      ent.narrative_core_characters = list.map(val => {
        if (typeof val !== 'string' || !val.trim()) return val;
        // 已是 ID（character_database 中有键）→ 保留
        if (db[val]) return val;
        // 否则按 name 查
        if (nameToId[val]) return nameToId[val];
        return val; // 解析失败，留原值
      });
    }
  }

  // Wave 1A: character.role 双义解耦。
  // V1 形态：主角字面值放在 character.role 字段（"主角"两字），同字段也用来写真职业。
  // V2 形态：role_marker 标记主角，role 恢复纯职业自由文本。
  // 翻译：role === "主角" → role_marker = "主角"，role = null（不留占位避免新旧语义混着）。
  function _migrateRoleMarker(card) {
    if (!card || !card.snapshot) return;
    const db = card.snapshot.character_database;
    if (!db || typeof db !== 'object') return;
    for (const id of Object.keys(db)) {
      if (id.startsWith('_')) continue;
      const c = db[id];
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
      // 已是新形态则跳过
      if (c.role_marker !== undefined) continue;
      if (c.role === '主角') {
        c.role_marker = '主角';
        c.role = null;
      }
    }
  }

  // Wave 3C: 主角标记归一到布尔 is_protagonist（单一真源）。
  // 新规范：is_protagonist === true 标记主角；读取统一走 characterFields.isProtagonist。
  // role_marker:"主角"（Wave 1A）/ role:"主角"（V1）仅作老卡读时回退（不删，红线）。
  function _migrateRoleMarkerToIsProtagonist(card) {
    if (!card || !card.snapshot) return;
    const db = card.snapshot.character_database;
    if (!db || typeof db !== 'object') return;
    for (const id of Object.keys(db)) {
      if (id.startsWith('_')) continue;
      const c = db[id];
      if (!c || typeof c !== 'object' || Array.isArray(c)) continue;
      if (c.is_protagonist === true) continue;
      const marker = String(c.role_marker || '');
      const role = String(c.role || '');
      if (marker === '主角' || role === '主角' || role.toLowerCase() === 'protagonist') {
        c.is_protagonist = true;
      }
    }
  }

  // Wave 1C: opening_greeting 上移到 snapshot 顶层。
  // 老位置 snapshot.prompt_modules.opening_greeting → 新位置 snapshot.opening_greeting。
  function _migrateOpeningGreeting(card) {
    if (!card || !card.snapshot || typeof card.snapshot !== 'object') return;
    const pm = card.snapshot.prompt_modules;
    if (!pm || typeof pm !== 'object') return;
    if (typeof pm.opening_greeting !== 'string') return;
    // 优先保留新位置（如果作者已经写在新位置）
    if (typeof card.snapshot.opening_greeting === 'string' && card.snapshot.opening_greeting.trim()) {
      return;
    }
    card.snapshot.opening_greeting = pm.opening_greeting;
    // 保留老位置作为兜底（V1 兼容承诺：不删字段）
  }

  // Wave 1D：entity.schema_version 子级格式号已废，只保留 snapshot._schema_version 顶层。
  function _stripEntitySchemaVersion(card) {
    if (!card || !card.snapshot) return;
    const settings = card.snapshot.world_setting && card.snapshot.world_setting.settings;
    if (!settings || typeof settings !== 'object') return;
    for (const k of Object.keys(settings)) {
      const ent = settings[k];
      if (ent && typeof ent === 'object' && !Array.isArray(ent) && 'schema_version' in ent) {
        delete ent.schema_version;
      }
    }
  }

  // 最老 V1 形态：frozen_moment 在 snapshot 顶层。挪到 designMeta.p1Output.frozen_moment 让下游统一从那里读。
  function _migrateFrozenMoment(card) {
    if (!card || !card.snapshot || typeof card.snapshot !== 'object') return;
    const topLevel = card.snapshot.frozen_moment;
    if (!topLevel || typeof topLevel !== 'object') return;

    if (!card.designMeta || typeof card.designMeta !== 'object') card.designMeta = {};
    if (!card.designMeta.p1Output || typeof card.designMeta.p1Output !== 'object') card.designMeta.p1Output = {};
    if (card.designMeta.p1Output.frozen_moment && typeof card.designMeta.p1Output.frozen_moment === 'object') return;

    card.designMeta.p1Output.frozen_moment = {
      datetime: typeof topLevel.datetime === 'string' ? topLevel.datetime : '',
      label: typeof topLevel.label === 'string' ? topLevel.label : '',
      source: typeof topLevel.source === 'string' ? topLevel.source : 'inferred',
    };
  }

  // ──────────────────────────────────────────
  // 公开入口：返回的对象 _schema_version 已是 2（标记"已经过 V1→V2 翻译"）
  // ──────────────────────────────────────────
  function v1ToV2(card) {
    if (!card || typeof card !== 'object') return card;

    _migratePlayerAnchor(card);
    _migrateFrozenMoment(card);
    _migrateStep3FieldsName(card);
    _migrateOpeningGreeting(card);
    _migrateRoleMarker(card);
    _migrateRoleMarkerToIsProtagonist(card);
    _migrateNarrativeCoreCharactersToIds(card);
    _migratePanelFieldsShape(card);
    _stripEntitySchemaVersion(card);

    if (!card.snapshot || typeof card.snapshot !== 'object') card.snapshot = {};
    // _origin_schema_version 标记"这张卡进游戏前的原始格式"——给 V1 编辑 gate 用。
    // 写在 schema_version 之前；如果链上还有 v2ToV3 之类后续翻译器，要保留这个 origin 字段不动。
    if (typeof card.snapshot._origin_schema_version !== 'number') {
      card.snapshot._origin_schema_version = 1;
    }
    card.snapshot._schema_version = 2;

    return card;
  }

  const api = { v1ToV2 };

  if (typeof window !== 'undefined') {
    window.migrationsV1ToV2 = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
