// characterDialogue — 角色对话字段统一读取层（compat helper）
//
// V2 schema: dialogue_tone (string) + dialogue_examples { in_person: [], sms: [] }
// V1 schema: msg_reply_tone (string, 兼容老卡/内置卡/老存档)
//
// 所有需要读 NPC 说话风格 / 示例对话的位置统一走这里，让老卡 V1 字段自动兜底。

(function () {
  'use strict';

  const characterDialogue = {
    // 读 tone：dialogue_tone 优先 → msg_reply_tone 兜底 → ''
    readTone(char) {
      if (!char || typeof char !== 'object') return '';
      const v2 = typeof char.dialogue_tone === 'string' ? char.dialogue_tone.trim() : '';
      if (v2) return v2;
      const v1 = typeof char.msg_reply_tone === 'string' ? char.msg_reply_tone.trim() : '';
      return v1;
    },

    // 判定是否有 tone（非空）
    hasTone(char) {
      return this.readTone(char).length > 0;
    },

    // 读 examples：按 medium 取；缺失返空数组
    // medium: 'in_person' | 'sms'
    readExamples(char, medium) {
      if (!char || typeof char !== 'object') return [];
      const bucket = char.dialogue_examples && char.dialogue_examples[medium];
      if (!Array.isArray(bucket)) return [];
      return bucket.filter(e => e && typeof e === 'object' && (e.context || e.line));
    },

    // 渲染成 prompt 用的 bullet list；空数组返 ''（让上层优雅跳过整段）
    renderExamplesText(char, medium) {
      const exs = this.readExamples(char, medium);
      if (!exs.length) return '';
      return exs
        .map(e => {
          const ctx = (e.context || '').trim();
          const line = (e.line || '').trim();
          if (!line) return '';
          return ctx ? `  · [${ctx}] ${line}` : `  · ${line}`;
        })
        .filter(s => s.length > 0)
        .join('\n');
    },

    // 给 prompt 拼装用：返完整的"对话基调 + 示例"段，空时返 ''
    // mediumLabel = '面对面' / '短信' 用作 section 标题
    buildDialogueSection(char, medium, mediumLabel) {
      const tone = this.readTone(char);
      const examplesText = this.renderExamplesText(char, medium);
      const toneLine = tone ? `- 对话基调: ${tone}` : `- 对话基调: 普通`;
      if (!examplesText) return toneLine;
      const label = mediumLabel || (medium === 'sms' ? '短信' : '面对面');
      return `${toneLine}\n- 说话示例（${label}）：\n${examplesText}`;
    },
  };

  if (typeof window !== 'undefined') {
    window.characterDialogue = characterDialogue;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = characterDialogue;
  }
})();
