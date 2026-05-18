// ============================================
// SMS Prompt - 短信回复提示词
// ============================================
// 角色数据通过 npcStore 读取

// 联系人类型常量
const CONTACT_TYPE = {
  SYSTEM: 'system', // 预定义角色（在 CHARACTER_DATABASE 中定义）
  DYNAMIC: 'dynamic', // 临时角色（AI 动态生成，来自 npcStore）
};

/**
 * 按名字查找预定义角色（大小写不敏感）
 * @param {string} name - 角色名字
 * @returns {object|null} - 角色数据对象，或 null
 */
function findByName(name) {
  if (!name || typeof name !== 'string') return null;
  const _charDB = window.npcStore?.getCharacterDatabase() || {};
  const needle = name.toLowerCase();
  for (const id in _charDB) {
    if (id.startsWith('_')) continue;
    const char = _charDB[id];
    if (char && typeof char.name === 'string' && char.name.toLowerCase() === needle) {
      return char;
    }
  }
  return null;
}

/**
 * 获取联系人完整信息（统一接口，支持预定义角色和临时角色）
 */
function getContactInfo(contactId) {
  const currentTime =
    typeof AnalyzerUtils !== 'undefined' ? AnalyzerUtils.getCurrentGameTime() : null;
  // 优先检查预定义角色（从 npcStore 读取）
  const _charDB = window.npcStore?.getCharacterDatabase() || {};
  if (_charDB[contactId]) {
    const char = _charDB[contactId];
    // 只有有 SMS 配置的角色才算预定义角色
    if (char.msg_reply_tone || char.default_cognitive_state) {
      const dynamicAge =
        typeof AnalyzerUtils !== 'undefined'
          ? AnalyzerUtils.calculateAgeFromBirthday(char.birthday, currentTime)
          : null;
      return {
        id: char.id,
        name: char.name || contactId,
        age: dynamicAge || '—',
        personality: char.personality || '未知',
        cognitive_state: char.cognitive_state || char.default_cognitive_state || '未知',
        default_cognitive_state: char.default_cognitive_state || '未知',
        cognitive_state_timeline: char.cognitive_state_timeline || [],
        appearance: char.appearance,
        clothing: char.clothing,
        msg_reply_tone: char.msg_reply_tone,
        type: CONTACT_TYPE.SYSTEM,
      };
    }
  }

  // 检查临时角色（来自 npcStore）
  // 临时角色不使用预设的 msg_reply_tone，而是从主聊天历史中学习说话风格
  // 适配：npcStore 数据是新嵌套结构 {card, state}；这里 facade flatten 出平铺 contact 给下游
  if (typeof npcStore !== 'undefined') {
    const npcData = npcStore.get(contactId);
    if (npcData) {
      // 新嵌套结构：从 npc.card 取字段；fallback 兼容老平铺
      const c = (npcData.card && typeof npcData.card === 'object') ? npcData.card : npcData;
      const dynamicAge =
        typeof AnalyzerUtils !== 'undefined'
          ? AnalyzerUtils.calculateAgeFromBirthday(c.birthday, currentTime)
          : null;
      return {
        id: c.id || contactId,
        name: c.name || contactId,
        age: dynamicAge || '—',
        personality: c.personality || '未知',
        cognitive_state: c.cognitive_state || '未知',
        default_cognitive_state: c.cognitive_state || '未知',
        cognitive_state_timeline: [],
        appearance: c.appearance,
        clothing: c.clothing,
        type: CONTACT_TYPE.DYNAMIC,
        // 注意：临时角色没有 msg_reply_tone，回复风格从剧情原文学习
      };
    }
  }

  return null;
}

/**
 * 获取所有可用联系人列表（预定义角色 + 临时角色）
 */
function getAllContacts() {
  const contacts = [];

  // 获取当前游戏时间（用于计算动态年龄）
  const currentTime =
    typeof AnalyzerUtils !== 'undefined' ? AnalyzerUtils.getCurrentGameTime() : null;

  // 添加预定义角色（从 npcStore 读取有 SMS 配置的角色）
  const _charDB = window.npcStore?.getCharacterDatabase() || {};
  for (const id in _charDB) {
    const char = _charDB[id];
    // 只有有 SMS 配置的角色才加入列表
    if (char.msg_reply_tone || char.default_cognitive_state) {
      const dynamicAge =
        typeof AnalyzerUtils !== 'undefined'
          ? AnalyzerUtils.calculateAgeFromBirthday(char.birthday, currentTime)
          : null;
      contacts.push({
        id: char.id,
        name: char.name,
        age: dynamicAge || '—',
        personality: char.personality || '未知',
        cognitive_state: char.cognitive_state || char.default_cognitive_state || '未知',
        default_cognitive_state: char.default_cognitive_state || '未知',
        cognitive_state_timeline: char.cognitive_state_timeline || [],
        appearance: char.appearance,
        clothing: char.clothing,
        msg_reply_tone: char.msg_reply_tone,
        type: CONTACT_TYPE.SYSTEM,
      });
    }
  }

  // 添加临时角色（排除已在预定义角色中的）
  if (typeof npcStore !== 'undefined') {
    const allNpcs = npcStore.getAllMap();
    const systemIds = contacts.map(c => c.id);

    for (const id in allNpcs) {
      if (!systemIds.includes(id)) {
        const npcData = allNpcs[id];
        // 新嵌套结构：从 npc.card 取字段；fallback 兼容老平铺
        const c = (npcData.card && typeof npcData.card === 'object') ? npcData.card : npcData;
        const dynamicAge =
          typeof AnalyzerUtils !== 'undefined'
            ? AnalyzerUtils.calculateAgeFromBirthday(c.birthday, currentTime)
            : null;
        contacts.push({
          id: c.id || id,
          name: c.name,
          age: dynamicAge || '—',
          personality: c.personality || '未知',
          cognitive_state: c.cognitive_state || '未知',
          default_cognitive_state: c.cognitive_state || '未知',
          cognitive_state_timeline: [],
          appearance: c.appearance,
          clothing: c.clothing,
          type: CONTACT_TYPE.DYNAMIC,
        });
      }
    }
  }

  return contacts;
}

/**
 * 获取预定义角色 ID 列表（有 SMS 配置的角色）
 */
function getPredefinedContactIds() {
  const ids = [];
  const _charDB = window.npcStore?.getCharacterDatabase() || {};
  for (const id in _charDB) {
    const char = _charDB[id];
    if (char.msg_reply_tone || char.default_cognitive_state) {
      ids.push(id);
    }
  }
  return ids;
}

const SMS_PROMPT = `你是一个高拟真的短信对话模拟器。请基于当前导入的【世界观】、【角色设定】及【剧情上下文】回复玩家短信。

## 1. 核心逻辑：关系判断（最高优先级）
在生成回复前，必须先在「剧情总结/上下文」中检索玩家身份：

### A. 判定流程
1. **检索关系**：剧情中是否有该角色与玩家（当前号码）互动的记录？
2. **特殊标记检查**：
   - 是否有 [角色主动发送] 标记？ → 若有，视为**已知/熟人**（或者角色有目的的主动联系）。
   - 是否有 [系统提示]？ → 忽略，不影响关系判断。

### B. 判定结果
- **✅ 结果：有交集** → 严格遵循剧情中的具体人际关系（如恋人、仇敌、上下级）。
- **❌ 结果：无交集** → **绝对陌生人**（执行下方陌生人规则）。

---

## 2. 陌生人规则（严格执行）
当判定为“陌生人”时，必须触发【防御/疑惑机制】：
1. **质疑身份**：必须包含“你是谁？”“怎么有我号码？”或“发错人了”等含义。
2. **社交距离**：禁止使用任何亲昵称呼、服从性语气或默认熟络的态度。
3. **⛔ 认知隔离原则（通用防穿帮）**：
   - 角色的**内在状态**（如：奴隶、间谍、机器人、下属）≠ 对玩家的**外在表现**。
   - **示例**：即使角色设定是“绝对服从的仆人”，在不知道发短信的人是“主人”之前，她只会把玩家当成骚扰者或陌生路人。
   - 除非剧情明确写明“玩家号码 = 角色心中特定之人的号码”，否则默认**号码未知**。

---

## 3. 回复风格（拟真短信化）
请完全脱离“AI感”或“小说描写感”，模拟真实的手机打字习惯。

### ❌ 绝对禁止
- 书面语、翻译腔、过度文学化的描写。
- 除非角色设定为严苛的旧时代仆从，否则禁止用“您”。
- 令人尴尬的深情独白（如“你是我的光”），除非剧情推进到该地步。
- 像问答机器一样回答完整。

### ✅ 真人特征
- **语境感知**：被质问时可能不爽，忙碌时可能敷衍，开心时可能废话多。
- **不完美表达**：可以是碎片化的句子、反问、或者直接忽略对方的问题。
- **口语化**：按当前世界与角色身份的语言习惯说话——不堆砌书面语、不译腔；同一角色多轮间保持口癖一致（普通现代角色可用”啥/咋/嗯”等，赛博/古风/修真等世界改用各自自然的表达，不要硬塞当代北方口语）。
- **语气助词**：可适度使用本世界自然的语气词。
- **情绪导向**：烦躁时可短促回应、回避问题或冷处理，**具体形式按角色身份选**——市井痞子可能直接骂回去，企业高层可能冷淡敷衍，仙门弟子可能用古意词冷哼。

---

## 4. 内容引用源
- **优先级 1**：【回复风格】（若用户指定）。
- **优先级 2**：【角色语录/剧情原文】（提取口癖、说话节奏）。
- **优先级 3**：【角色设定】（性格关键词）。

---

## 5. 多轮对话一致性

- **关系渐进**：relationship 字段应反映累积交互的变化（陌生人→试探中→认识→熟人等），禁止跳跃式升级。
- **语气锚定**：dynamic 类型角色（无 msg_reply_tone）应从剧情原文中提取口癖和说话节奏，并在多轮中保持一致。
- **记忆连续性**：后续消息必须记住前几条短信的内容，不可自相矛盾。

---

## 输出格式
\`\`\`json
{
  "location": "角色当前所处地理位置（基于剧情推断）",
  "cognitive_state": "角色当前认为自己是谁（如：渡口收费员、被放逐的学徒、主人的骑士）",
  "relationship": "与玩家的当前关系（如：陌生人/试探中/恋人）",
  "message": "短信正文（纯文本，无动作描写，无时间戳）"
}
\`\`\`
`;

Object.assign(globalThis, {
  findByName,
  getContactInfo,
  getAllContacts,
  getPredefinedContactIds,
  SMS_PROMPT,
});
