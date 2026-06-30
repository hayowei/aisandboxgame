// characterFields — 角色字段统一读取层（compat helper for Stage 3 v2 字段收敛）
//
// V2 schema:
//   cognitive_state (string)         - 此刻自我认知（替代 V1 default_cognitive_state）
//   initial_status (string)          - 此刻具体状态（身体/情绪/在场/动作；Stage 3 必填新增）
//   origin (string)                  - 过去（V1 V2 同名）
//   birthday (string|null)           - 不变
//
// V1 schema 兼容：
//   default_cognitive_state → 通过 readCognitiveState 兜底
//   status: null → 老字段历史上死字段、不读取，新卡走 initial_status
//
// 注：dialogue 字段（dialogue_tone / dialogue_examples）走 window.characterDialogue 单独 helper

(function () {
  'use strict';

  const characterFields = {
    // ====== cognitive_state ======
    // V2: cognitive_state 优先 → V1 default_cognitive_state 兜底 → ''
    readCognitiveState(char) {
      if (!char || typeof char !== 'object') return '';
      const v2 = typeof char.cognitive_state === 'string' ? char.cognitive_state.trim() : '';
      if (v2) return v2;
      const v1 = typeof char.default_cognitive_state === 'string'
        ? char.default_cognitive_state.trim()
        : '';
      return v1;
    },

    hasCognitiveState(char) {
      return this.readCognitiveState(char).length > 0;
    },

    // ====== initial_status ======
    // V2 only：老卡无此字段，返空字符串（不兜底到任何 V1 字段）
    readInitialStatus(char) {
      if (!char || typeof char !== 'object') return '';
      return typeof char.initial_status === 'string' ? char.initial_status.trim() : '';
    },

    hasInitialStatus(char) {
      return this.readInitialStatus(char).length > 0;
    },

    // ====== 主角标记（Wave 3C：is_protagonist 布尔为单一真源）======
    // 规范：is_protagonist === true → 是主角（GM 经 new_npc 产出、内置卡、migration 归一后都用它）。
    // 老卡读时回退（不删，红线）：role_marker === '主角'（Wave 1A）/ role === '主角'（V1）。
    isProtagonist(char) {
      if (!char || typeof char !== 'object') return false;
      if (char.is_protagonist === true) return true;
      if (char.role_marker === '主角') return true;
      if (char.role === '主角') return true;
      return false;
    },

    // ====== narrative_core_characters resolve（Wave 1B）======
    // entity.narrative_core_characters[i] 可能是 ID（V2 normalize 后）或姓名（V1 / Stage 1 刚生成的中间态）。
    // 此 helper 统一解析为角色对象：
    //   ① val 在 character_database 中作为 ID 存在 → 直接返回 db[val]
    //   ② 在 character_database 中按 name 找到 → 返回 char
    //   ③ 找不到 → 返回 null
    resolveCoreCharacter(val, characterDatabase) {
      if (typeof val !== 'string' || !val.trim() || !characterDatabase || typeof characterDatabase !== 'object') {
        return null;
      }
      if (characterDatabase[val]) return characterDatabase[val];
      for (const id of Object.keys(characterDatabase)) {
        if (id.startsWith('_')) continue;
        const c = characterDatabase[id];
        if (c && typeof c === 'object' && c.name === val) return c;
      }
      return null;
    },

    // 返回 narrative_core_characters[i] 对应的角色姓名（用于 UI 显示）
    resolveCoreCharacterName(val, characterDatabase) {
      const c = this.resolveCoreCharacter(val, characterDatabase);
      return c && typeof c.name === 'string' ? c.name : (typeof val === 'string' ? val : '');
    },
  };

  if (typeof window !== 'undefined') {
    window.characterFields = characterFields;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = characterFields;
  }
})();
