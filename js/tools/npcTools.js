// ============================================
// NPC Tools — 角色档案管理工具（动态注册）
// ============================================
// 三个独立工具，按 panel_npc 与 NPC 池状态动态注册：
//   - new_npc              : 创建原创新角色（永远注册，前提是 panel_npc 字段存在）
//   - update_npc           : 更新已登场角色字段（仅当 _npcs 非空时注册；id 用 enum 限定）
//   - load_predefined_npc  : 从世界卡预定义池激活角色（仅当 _predefinedPool 非空时注册；id 用 enum 限定）
// 每次 API 请求前通过 refreshNpcTools() 重新注册以保证 enum 与池状态同步。
// store 层 (npcStore.processNpcPanel) 仍按 trigger_type 字段路由，三个 execute 内部包装。
// ============================================

function _npcNormalize(s) {
  if (typeof s !== 'string') return '';
  return s.toLowerCase().replace(/[\s_\-]+/g, '');
}

const _NPC_GENERIC_TERMS = new Set([
  'npc', 'innkeeper', 'merchant', 'guard', 'stranger', 'villager',
  '老板', '商人', '守卫', '路人', '旅店老板',
]);

/**
 * 在 character_database 中定位预定义角色的 ID。
 * 顺序：exact_id → normalized_id → exact_name → id_primary → substring。
 * 任一层出现 ≥2 命中返回 { ambiguous, candidates }。
 * @param {string} lookup
 * @param {Object} charDB
 * @returns {{id:string, matchKind:string} | {ambiguous:true, candidates:string[]} | null}
 */
function resolvePredefinedMatch(lookup, charDB) {
  if (!lookup || !charDB) return null;
  const lookupStr = String(lookup).trim();
  if (!lookupStr) return null;

  const entries = Object.entries(charDB).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) return null;

  if (Object.prototype.hasOwnProperty.call(charDB, lookupStr) && !lookupStr.startsWith('_')) {
    return { id: lookupStr, matchKind: 'exact_id' };
  }

  const lookupNorm = _npcNormalize(lookupStr);
  if (!lookupNorm) return null;

  const normIdHits = entries.filter(([id]) => _npcNormalize(id) === lookupNorm);
  if (normIdHits.length === 1) return { id: normIdHits[0][0], matchKind: 'normalized_id' };
  if (normIdHits.length > 1) return { ambiguous: true, candidates: normIdHits.map(([id]) => id) };

  const lookupLower = lookupStr.toLowerCase();
  const nameHits = entries.filter(([, char]) =>
    char?.name && char.name.toLowerCase() === lookupLower
  );
  if (nameHits.length === 1) return { id: nameHits[0][0], matchKind: 'exact_name' };
  if (nameHits.length > 1) return { ambiguous: true, candidates: nameHits.map(([id]) => id) };

  // 以下为启发式匹配，拒绝过短或通用词
  // 中文等非 ASCII 字符单字信息量较大，门槛放宽到 2
  const _hasNonAscii = /[^\x00-\x7F]/.test(lookupStr);
  const _minLen = _hasNonAscii ? 2 : 3;
  if (lookupNorm.length < _minLen || _NPC_GENERIC_TERMS.has(lookupLower)) return null;

  const primaryHits = entries.filter(([id]) => {
    const primary = _npcNormalize(id.split('_')[0] || '');
    return primary && primary === lookupNorm;
  });
  if (primaryHits.length === 1) return { id: primaryHits[0][0], matchKind: 'id_primary' };
  if (primaryHits.length > 1) return { ambiguous: true, candidates: primaryHits.map(([id]) => id) };

  const substringHits = entries.filter(([id, char]) => {
    const idNorm = _npcNormalize(id);
    const nameNorm = _npcNormalize(char?.name || '');
    if (idNorm && (idNorm.includes(lookupNorm) || lookupNorm.includes(idNorm))) return true;
    if (nameNorm && (nameNorm.includes(lookupNorm) || lookupNorm.includes(nameNorm))) return true;
    return false;
  });
  if (substringHits.length === 1) return { id: substringHits[0][0], matchKind: 'substring' };
  if (substringHits.length > 1) return { ambiguous: true, candidates: substringHits.map(([id]) => id) };

  return null;
}

/**
 * 序列化 NPC 档案为 tool result 用嵌套对象 { card, state }
 * 接受三种入参：
 *   (a) 新嵌套 {card:{...}, state:{...}}
 *   (b) {id, name, card:{...}}（new_npc/update_npc 执行时构造）
 *   (c) 老平铺 {gender, msg_reply_tone, ...}（NEW_PREDEFINED 装配后或老存档）
 * 统一输出 { card, state? }；过滤 NPC_DROP_KEYS 字段
 */
function _collectNpcCardKeys() {
  const keys = new Set();
  const schema = window.step3SchemaBuilder;

  // baseline
  const baseline = schema?.getDefaultNpcFields?.() || [];
  for (const f of baseline) {
    if (f?.key && f.key !== 'trigger_type') keys.add(f.key);
  }

  // 世界卡扩展
  const panelNpc = window.worldMeta?.getStep3Fields?.()?.panel_npc;
  if (Array.isArray(panelNpc)) {
    for (const f of panelNpc) {
      if (f?.key && f.key !== 'trigger_type') keys.add(f.key);
    }
  }

  // 剔除 drop / state keys
  const DROP = new Set(schema?.NPC_DROP_KEYS || []);
  const STATE = new Set(schema?.NPC_STATE_KEYS || []);
  for (const k of DROP) keys.delete(k);
  for (const k of STATE) keys.delete(k);

  return keys;
}

function _serializeNpcCardFields(source) {
  if (!source || typeof source !== 'object') return null;
  const allowed = _collectNpcCardKeys();

  // 取 card 来源：嵌套（source.card）或平铺（source 本身）
  const cardSource = (source.card && typeof source.card === 'object' && !Array.isArray(source.card))
    ? source.card
    : source;

  const card = {};
  for (const key of allowed) {
    const v = cardSource[key];
    if (v === undefined || v === null) continue;
    card[key] = v;
  }
  // id/name 兜底（card 可能没带 id；id 顶层传过来）
  if (!card.id && source.id) card.id = source.id;
  if (!card.name && source.name) card.name = source.name;

  const out = { card };
  if (source.state && typeof source.state === 'object' && !Array.isArray(source.state)) {
    out.state = { ...source.state };
  }
  return out;
}

/**
 * 把未登场预定义池格式化为 tool description 里一行式名单
 * @returns {string|null} - 空池返回 null
 */
function _formatPredefinedListForPrompt(pool) {
  const entries = Object.entries(pool || {}).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) return null;
  const MAX = 20;
  const shown = entries.slice(0, MAX).map(([id, data]) => {
    const summary = data?.role || data?.occupation || data?.default_cognitive_state || '';
    const name = data?.name || '?';
    return summary ? `${id}(${name}, ${summary})` : `${id}(${name})`;
  });
  const suffix = entries.length > MAX ? ` …共 ${entries.length} 个` : '';
  return shown.join(' | ') + suffix;
}

/**
 * iter1 专用名单格式化：仅"显示名（一句身份）"，去掉 ID 与工具操作指引。
 * 用于 iter1 system prompt 的"已存在角色名单（仅供叙事引用）"块。
 * iter1 不能调 load_predefined_npc，因此既不需要 id 也不需要工具措辞，
 * 避免让模型从 prompt 文本"幻觉"出实际未暴露的工具。
 * @returns {string|null} - 空池返回 null
 */
function _formatPredefinedListForIter1(pool) {
  const entries = Object.entries(pool || {}).filter(([k]) => !k.startsWith('_'));
  if (entries.length === 0) return null;
  const MAX = 20;
  const shown = entries.slice(0, MAX).map(([, data]) => {
    const summary = data?.role || data?.occupation || data?.default_cognitive_state || '';
    const name = data?.name || '?';
    return summary ? `- ${name}（${summary}）` : `- ${name}`;
  });
  const suffix = entries.length > MAX ? `\n…共 ${entries.length} 个` : '';
  return shown.join('\n') + suffix;
}

/**
 * 从世界卡 panel_npc schema 构建动态 card.* 字段 properties
 * 剔除 trigger_type / id / name（顶层主键单独处理）+ NPC_DROP_KEYS（current_goal 等野字段）
 * @returns {{ props: Object, count: number } | null}
 */
function _buildDynamicFieldProps() {
  const step3Fields = window.worldMeta?.getStep3Fields?.();
  const npcFields = (step3Fields && Array.isArray(step3Fields.panel_npc) && step3Fields.panel_npc.length > 0)
    ? step3Fields.panel_npc
    : (window.step3SchemaBuilder?.getDefaultNpcFields?.() || []);

  if (npcFields.length === 0) return null;

  const DROP = new Set(window.step3SchemaBuilder?.NPC_DROP_KEYS || []);
  const props = {};
  let count = 0;
  for (const field of npcFields) {
    const key = field?.key;
    if (!key) continue;
    if (key === 'trigger_type' || key === 'id' || key === 'name') continue;
    if (DROP.has(key)) continue;

    let description = field.label || key;
    if (field.desc) description += `（${field.desc}）`;

    const prop = { type: field.type || 'string', description };
    if (Array.isArray(field.enum) && field.enum.length > 0) {
      prop.enum = [...field.enum];
    }
    props[key] = prop;
    count++;
  }
  return { props, count };
}

function _registerNewNpc(register, dynamicFieldProps) {
  register('new_npc', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '创建原创新角色档案（不在世界卡预定义名单内的全新 NPC）。一次调用处理一个角色。',
    when_to_call:
      '叙事中全新 NPC 首次登场，且确认该角色不在 system 提供的预定义名单中（不含玩家角色）。',
    avoid_when:
      '角色已登场（应改用 update_npc）；角色 id/name 命中预定义名单（应改用 load_predefined_npc）；纯对话未引入新角色。错误示例：用 new_npc 创建 "John" 而预定义池里已有 elder_john(John) → 会被预检拒绝并引导至 load_predefined_npc；用 new_npc 传一个已登场的 id → 同样被预检拒绝。',
    input_focus:
      'id 必须蛇形小写英文，不与预定义池任一 id 冲突；name 为角色显示名；其他字段塞进 card 子对象内，优先标签式（如"沉稳/克制/隐忍"），关键字段（personality / appearance / role）需要细节时也可写一句话，单字段 ≤30 字。',
    expected_output:
      '返回 JSON {status:"created", card:{card:{...}, state:{...}}}。card 即可直接用于叙事，无需再调读取工具。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: '角色唯一标识符（蛇形小写英文），不得与预定义池 id 冲突。',
        },
        name: {
          type: 'string',
          description: '角色显示名。',
        },
        card: {
          type: 'object',
          description: 'NPC 身份/档案字段（DM 写、审批可改）',
          properties: dynamicFieldProps,
          required: [],
          additionalProperties: false,
        },
      },
      required: ['id', 'name', 'card'],
      additionalProperties: false,
    },
    execute(args) {
      const npcStore = window.npcStore;
      if (!npcStore) return '[错误] npcStore 未加载';

      const id = args?.id;
      const name = args?.name;
      const card = (args?.card && typeof args.card === 'object') ? args.card : {};
      if (!id || !name) {
        return '[错误] new_npc 需要同时提供 id 和 name';
      }

      // 预检 1：id/name 是否落在预定义池 → 引导改用 load_predefined_npc
      const pool = npcStore.getPredefinedPool?.() || {};
      const _SAFE_KINDS = new Set(['exact_id', 'normalized_id', 'exact_name']);
      for (const lookup of [id, name].filter(Boolean)) {
        const m = resolvePredefinedMatch(lookup, pool);
        if (m && !m.ambiguous && _SAFE_KINDS.has(m.matchKind)) {
          return window.promptRegistry
            .get('react.directive.npcRedirectToLoadPredefined')
            .builder({ lookup, predefinedId: m.id });
        }
      }

      // 预检 2：id 是否已登场 → 引导改用 update_npc
      const spawned = npcStore.getAllMap?.() || {};
      if (Object.prototype.hasOwnProperty.call(spawned, id)) {
        return window.promptRegistry
          .get('react.directive.npcRedirectToUpdate')
          .builder({ id });
      }

      window._npcToolCalledThisTurn = true;
      const turn = (npcStore.currentTurn || 0) + 1;
      npcStore.processNpcPanel(
        [{ trigger_type: 'NEW', id, name, card }],
        turn,
        null
      );

      const serialized = _serializeNpcCardFields({ id, name, card });
      return JSON.stringify({ status: 'created', card: serialized });
    },
    source: 'npc',
  });
}

function _registerUpdateNpc(register, dynamicFieldProps, spawnedIds) {
  // 锁定字段：UPDATE 语义下不可改的身份字段。从 dynamicFieldProps 再过一遍。
  // _buildDynamicFieldProps 已剔除 trigger_type/id/name + NPC_DROP_KEYS；此处再剔除 gender/origin/birthday/age。
  const lockedKeys = Array.isArray(window.step3SchemaBuilder?.NPC_RUNTIME_LOCKED_UPDATE_KEYS)
    ? window.step3SchemaBuilder.NPC_RUNTIME_LOCKED_UPDATE_KEYS
    : ['trigger_type', 'id', 'name', 'gender', 'origin', 'birthday', 'age'];
  const updatableProps = { ...dynamicFieldProps };
  for (const k of lockedKeys) delete updatableProps[k];

  register('update_npc', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '更新已登场角色 card.* 内的字段。一次调用处理一个角色。',
    when_to_call:
      '已存在角色的外观/心理/关系/语气/阵营等 card 域字段发生明显变化时。',
    avoid_when:
      '角色未登场（id 不在 enum 内 schema 自动拒绝）；纯对话未改变角色状态；试图修改 id/name/gender/origin/birthday/age（schema 不暴露这些字段，无法修改）；试图修改 state.* 字段（current_location/current_mood/intent_toward_player 等——这些归 NPC 自治）。错误示例：传 id="陌生 id" → schema enum 拒绝；传 card.gender="女" 想改性别 → schema 不暴露 gender 字段，根本无法填写。',
    input_focus:
      '只传 id + card 内实际变化的字段；字段值标签式 ≤3 词；变更进入待审批队列由玩家逐字段批准。',
    expected_output:
      '返回 JSON {status:"pending_review", id, requested_changes:[字段名...], current_card:{card:{...}, state:{...}}}。变更需玩家批准，current_card 仍是审批前状态。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: [...spawnedIds],
          description: '已登场角色 id（仅可从已登场列表中选择）。',
        },
        card: {
          type: 'object',
          description: '只填发生变化的 card 字段',
          properties: updatableProps,
          required: [],
          additionalProperties: false,
        },
      },
      required: ['id', 'card'],
      additionalProperties: false,
    },
    execute(args) {
      const npcStore = window.npcStore;
      if (!npcStore) return '[错误] npcStore 未加载';

      const id = args?.id;
      const card = (args?.card && typeof args.card === 'object') ? args.card : {};
      if (!id) return '[错误] update_npc 缺少 id';

      window._npcToolCalledThisTurn = true;
      const turn = (npcStore.currentTurn || 0) + 1;
      npcStore.processNpcPanel(
        [{ trigger_type: 'UPDATE', id, card }],
        turn,
        null
      );

      const changedFields = Object.keys(card);
      const currentCard = _serializeNpcCardFields(npcStore.get(id));
      return JSON.stringify({
        status: 'pending_review',
        id,
        requested_changes: changedFields,
        current_card: currentCard,
      });
    },
    source: 'npc',
  });
}

function _registerLoadPredefined(register, predefinedIds) {
  register('load_predefined_npc', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '从世界卡预定义池激活角色，完整档案与时间线状态自动回填。一次调用处理一个角色。',
    when_to_call:
      '预定义名单中的角色首次登场；id 必须从 system 提供的未登场名单（也即本工具 enum）中挑选。',
    avoid_when:
      '池为空（本工具不会注册）；角色已登场（应改用 update_npc）；非预定义角色（应改用 new_npc）。错误示例：传 id="原创角色名" → schema enum 拒绝；同回合先调 load_predefined_npc(X) 再调 update_npc(X) → update_npc 的 enum 还是回合开始时的旧值，不含 X，schema 拒绝（应等下一回合再 update）。',
    input_focus:
      '仅 id；其他字段无须传，会被忽略（档案从预定义池回填，AnalyzerManager 注入动态时间线状态）。激活后档案在本回合即生效，无需再调 update_npc 补字段；如确需修改字段，等下一回合（届时 update_npc 的 enum 会包含此 id）。',
    expected_output:
      '返回 JSON {status:"loaded", card:{完整角色档案}}。card 含 personality/appearance/msg_reply_tone 等全部叙事用字段，可直接用于叙事，无需再调 get_npc_card 等读取工具。',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          enum: [...predefinedIds],
          description: '未登场预定义角色 id（仅可从未登场名单中选择）。',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute(args) {
      const npcStore = window.npcStore;
      if (!npcStore) return '[错误] npcStore 未加载';

      const id = args?.id;
      if (!id) return '[错误] load_predefined_npc 缺少 id';

      const pool = npcStore.getPredefinedPool?.() || {};
      const predefined = pool[id];
      if (!predefined) {
        return window.promptRegistry
          .get('react.directive.npcLoadPredefinedNotFound')
          .builder({ id });
      }

      window._npcToolCalledThisTurn = true;
      const turn = (npcStore.currentTurn || 0) + 1;
      npcStore.processNpcPanel([{ trigger_type: 'NEW_PREDEFINED', id }], turn, null);

      // 共享 helper：与 npcStore.processNpcPanel(NEW_PREDEFINED) 分支用同一份白名单装配逻辑。
      // 这样 tool result 能立刻反映即将落库的最终档案——而不必等异步 setTimeout 之后再读。
      const composed = typeof npcStore._buildPredefinedComposed === 'function'
        ? npcStore._buildPredefinedComposed(id, predefined)
        : { card: { id, name: predefined.name }, state: {} };

      return JSON.stringify({ status: 'loaded', card: composed });
    },
    source: 'npc',
  });
}

/**
 * 刷新 NPC 工具的动态注册
 * 根据当前世界卡的 panel_npc 字段定义 + NPC 池状态动态注册三个工具。
 * 应在每次 API 请求前调用。
 */
function refreshNpcTools() {
  const registry = window.toolRegistry;
  if (!registry) return;

  const store = window.npcStore;
  if (!store) return;

  // 清除上一次的动态注册（toolRegistry + promptRegistry）
  registry.unregisterBySource('npc');
  if (window.promptRegistry) {
    window.promptRegistry.unregisterByPrefix('tool.new_npc.');
    window.promptRegistry.unregisterByPrefix('tool.update_npc.');
    window.promptRegistry.unregisterByPrefix('tool.load_predefined_npc.');
  }

  // 双写 helper：promptRegistry + toolRegistry
  const register =
    window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // 读取动态字段定义（剔除 trigger_type/id/name）
  const dyn = _buildDynamicFieldProps();
  if (!dyn) {
    console.warn('[npcTools] 无 NPC 字段定义，跳过注册');
    return;
  }

  const spawnedIds = Object.keys(store.getAllMap?.() || {}).filter(k => !k.startsWith('_'));
  const predefinedIds = Object.keys(store.getPredefinedPool?.() || {}).filter(k => !k.startsWith('_'));

  _registerNewNpc(register, dyn.props);
  if (spawnedIds.length > 0) _registerUpdateNpc(register, dyn.props, spawnedIds);
  if (predefinedIds.length > 0) _registerLoadPredefined(register, predefinedIds);

  const registered = ['new_npc']
    .concat(spawnedIds.length > 0 ? ['update_npc'] : [])
    .concat(predefinedIds.length > 0 ? ['load_predefined_npc'] : [])
    .join(' + ');
  console.log(
    `[npcTools] 已刷新: ${registered} (动态字段 ${dyn.count}, 已登场 ${spawnedIds.length}, 未登场 ${predefinedIds.length})`
  );
}

// 暴露到全局供 aiService 调用
window.refreshNpcTools = refreshNpcTools;
window.resolvePredefinedMatch = resolvePredefinedMatch;
window._formatPredefinedNpcListForPrompt = _formatPredefinedListForPrompt;
window._formatPredefinedNpcListForIter1 = _formatPredefinedListForIter1;
