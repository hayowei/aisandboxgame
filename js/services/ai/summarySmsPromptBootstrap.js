// ============================================
// summary-sms prompt bootstrap — extracted from summary-sms.js
// ============================================
// 注册 eventSms / proactiveSms 完整通道（body + dynamic context + trigger + messageFormat）
// 三个消费者（浏览器 / build-prompt-index / promptviewer）共享，无 mirror。
// ============================================


// ============================================
// promptRegistry 注册：eventSms / proactiveSms 主体 prompt
// 注：completeSystemParts 中的 characterInfo / eventInfo / smsHistoryContext 等是运行时数据，
// 保留在 generateEventSMS / generateProactiveSMS 内部拼接。这里只注册"硬编码的主体 prompt"。
// ============================================
(function bootstrapEventProactiveSmsPrompts() {
  if (!window.promptRegistry) {
    console.warn('[promptRegistry] eventSms bootstrap 失败：promptRegistry 未加载');
    return;
  }
  const reg = window.promptRegistry;

  const EVENT_SMS_PROMPT = `你是一个短信对话模拟器。你需要模拟一个角色**主动**给玩家发送一条短信。

## 背景
角色正在经历一个重要事件，他/她决定给玩家发一条短信。这条短信应该:
1. **与事件相关**:短信内容应该反映角色正在经历的事件，但不需要直接描述事件细节
2. **符合角色性格**:根据角色的性格和回复风格来写
3. **考虑与玩家的关系**:根据剧情总结判断角色与玩家的关系
4. **自然主动**:这是角色主动发起的消息，可能是分享、求助、炫耀、暗示等

## ⚠️ 关系判断(必须执行)
在"最近的剧情总结"中搜索角色名字:
- **如果找到**:根据内容判断关系，选择合适的语气和称呼
- **如果没找到**:角色与玩家是陌生人，需要先自我介绍或说明来意

## 回复规则
1. **简短**:1-3句话，最多50字
2. **口语化**:像真人发短信，可以用表情符号
3. **角色一致**:符合角色性格和回复风格
4. **事件驱动**:短信要与正在发生的事件有关联

## 输出格式
请输出以下 JSON 格式(不要添加任何其他内容):

\`\`\`json
{
  "location": "角色当前所在位置",
  "cognitive_state": "[归属] 的 [身份]",
  "relationship": "与玩家的当前关系",
  "message": "短信内容"
}
\`\`\`

`;

  const PROACTIVE_SMS_PROMPT = `你是一个短信对话模拟器。你需要模拟一个角色**主动**给玩家发送一条短信。

## 背景
这是一个时间节点，角色决定主动联系玩家。你需要基于以下信息生成一条自然的主动消息:
1. **角色与玩家的短信历史**(最重要的参考)
2. **玩家的剧情经历**(从剧情总结中了解)
3. **角色的性格和当前状态**

## ⚠️ 核心原则
- **不要凭空编造事件**:只根据短信历史和剧情总结中已知的信息
- **延续之前的话题**:如果有未完成的对话，可以继续
- **符合关系深度**:根据短信历史判断亲密程度，调整语气
- **自然主动**:可能是问候、分享近况、关心对方、或延续之前的话题

## 回复规则
1. **简短**:1-3句话，最多50字
2. **口语化**:像真人发短信，可以用表情符号
3. **角色一致**:符合角色性格和回复风格
4. **基于已知信息**:不要编造角色正在经历的事件

## 输出格式
请输出以下 JSON 格式(不要添加任何其他内容):

\`\`\`json
{
  "location": "角色当前所在位置(根据已知信息推断)",
  "cognitive_state": "[归属] 的 [身份]",
  "relationship": "与玩家的当前关系",
  "message": "短信内容"
}
\`\`\`

`;

  reg.register('eventSms.bodyPrompt', {
    channel: 'eventSms',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    order: 0,
    description: 'Event SMS（基于事件触发的主动短信）的主体 prompt（背景 + 关系判断 + 输出格式）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'EVENT_SMS_PROMPT' },
    builder: () => EVENT_SMS_PROMPT,
  });

  reg.register('eventSms.characterInfo', {
    channel: 'eventSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 10,
    description: '事件短信：当前角色的运行时档案（名字/年龄/性格/认知状态/关系/回复风格）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'characterInfo' },
    builder: ctx => ctx?.characterInfo || '',
  });

  reg.register('eventSms.eventInfo', {
    channel: 'eventSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 20,
    description: '事件短信：触发本条短信的事件描述（时间/地点/相关角色/事件内容）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'eventInfo' },
    builder: ctx => ctx?.eventInfo || '',
  });

  reg.register('eventSms.currentTimeInfo', {
    channel: 'eventSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 30,
    description: '事件短信：当前游戏时间',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'currentTimeInfo' },
    builder: ctx => ctx?.currentTimeInfo || '',
  });

  reg.register('eventSms.storySummary', {
    channel: 'eventSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 40,
    description: '事件短信：最近的剧情总结（玩家视角，用于关系判断）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'storySummaryContext' },
    builder: ctx => ctx?.storySummaryContext || '',
  });

  reg.register('eventSms.smsHistory', {
    channel: 'eventSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 50,
    description: '事件短信：与玩家最近的短信记录',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'smsHistoryContext' },
    builder: ctx => ctx?.smsHistoryContext || '',
  });

  reg.register('proactiveSms.bodyPrompt', {
    channel: 'proactiveSms',
    category: 'core',
    source: 'static-file',
    cacheable: true,
    order: 0,
    description: 'Proactive SMS（基于时间节点的主动短信）的主体 prompt',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'PROACTIVE_SMS_PROMPT' },
    builder: () => PROACTIVE_SMS_PROMPT,
  });

  reg.register('proactiveSms.characterInfo', {
    channel: 'proactiveSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 10,
    description: '主动短信：当前角色的运行时档案',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'characterInfo' },
    builder: ctx => ctx?.characterInfo || '',
  });

  reg.register('proactiveSms.currentTimeInfo', {
    channel: 'proactiveSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 20,
    description: '主动短信：当前游戏时间',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'currentTimeInfo' },
    builder: ctx => ctx?.currentTimeInfo || '',
  });

  reg.register('proactiveSms.smsHistory', {
    channel: 'proactiveSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 30,
    description: '主动短信：与玩家的短信记录（最重要参考）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'smsHistoryContext' },
    builder: ctx => ctx?.smsHistoryContext || '',
  });

  reg.register('proactiveSms.storySummary', {
    channel: 'proactiveSms',
    category: 'context',
    source: 'dynamic-runtime',
    cacheable: false,
    order: 40,
    description: '主动短信：最近的剧情总结（玩家视角）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'storySummaryContext' },
    builder: ctx => ctx?.storySummaryContext || '',
  });

  // ── trigger user messages（不在 systemParts，是 user role 的触发消息，但同样影响 AI 输出）──
  reg.register('eventSms.triggerMessage', {
    channel: 'eventSms',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user 触发消息，不进 system prompt
    description: '事件短信：发给 LLM 的 user 触发消息（"请根据上述事件，以角色的身份给玩家发一条短信"）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'event SMS user trigger' },
    builder: () => '请根据上述事件，以角色的身份给玩家发一条短信。',
  });

  reg.register('proactiveSms.triggerMessage', {
    channel: 'proactiveSms',
    category: 'directive',
    source: 'static-file',
    cacheable: false,
    excludeFromAssembly: true, // user 触发消息，不进 system prompt
    description: '主动短信：发给 LLM 的 user 触发消息（基于历史 + 剧情主动联系玩家）',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'proactive SMS user trigger' },
    builder: () => '请以角色的身份，基于之前的短信记录和剧情上下文，给玩家发一条主动消息。',
  });

  // ── 消息格式标签（messageFormat）──
  // 这些是包裹 dynamic content 的 label 前缀，影响 AI 对消息的解读
  // （例如：[系统提示，非角色消息] 让 AI 知道这条消息是引擎注入而非角色发的）
  reg.register('sms.format.systemMessageTag', {
    channel: 'sms',
    category: 'messageFormat',
    source: 'static-file',
    cacheable: false,
    description: 'SMS 回复流：把 system role 消息包成 user role 时的标签前缀（提示 AI 这是引擎注入，非角色对话）',
    origin: { file: 'js/services/ai/react.js', symbol: 'formatMsgWithTime - system' },
    builder: ctx => `[系统提示，非角色消息] ${ctx?.content || '<content>'}`,
  });

  reg.register('sms.format.timestampPrefix', {
    channel: 'sms',
    category: 'messageFormat',
    source: 'static-file',
    cacheable: false,
    description: 'SMS 历史消息的时间前缀（让 AI 理解时间流逝，例如：[6月15日 14:30] xxx）',
    origin: { file: 'js/services/ai/react.js', symbol: 'formatMsgWithTime - timestamp' },
    builder: ctx => {
      const month = ctx?.month ?? '<月>';
      const day = ctx?.day ?? '<日>';
      const timeStr = ctx?.timeStr || '<时刻>';
      const content = ctx?.content || '<content>';
      return `[${month}月${day}日 ${timeStr}] ${content}`;
    },
  });

  reg.register('sms.format.eventDrivenTag', {
    channel: 'sms',
    category: 'messageFormat',
    source: 'static-file',
    cacheable: false,
    description: 'SMS 历史中事件驱动消息的标签（"角色主动发送，玩家未回复不代表是陌生人"）',
    origin: { file: 'js/services/ai/react.js', symbol: 'formatMsgWithTime - eventDriven' },
    builder: ctx => `[角色主动发送] ${ctx?.content || '<content>'}`,
  });

  reg.register('sms.format.timelineSystemNotification', {
    channel: 'sms',
    category: 'messageFormat',
    source: 'static-file',
    cacheable: false,
    description: 'TimelineService 模式 A：把 timeline 事件注入 SMS 历史的系统提示格式（陌生角色第一次出现）',
    origin: { file: 'js/services/timelineService.js', symbol: 'systemMessage' },
    builder: ctx => {
      const dateStr = ctx?.dateStr || '<dateStr>';
      const characterName = ctx?.characterName || '<characterName>';
      const eventContent = ctx?.eventContent || '<event.content>';
      return `[系统提示]${dateStr}，${characterName} 的动态:${eventContent}`;
    },
  });

  reg.register('proactiveSms.format.historySystemTag', {
    channel: 'proactiveSms',
    category: 'messageFormat',
    source: 'static-file',
    cacheable: false,
    description: '主动 SMS 历史渲染时，对 system role 历史项的标签前缀',
    origin: { file: 'js/services/ai/summary-sms.js', symbol: 'history.slice - system' },
    builder: ctx => `[系统提示]: ${ctx?.content || '<content>'}`,
  });

  console.log('[promptRegistry] 已注册 eventSms / proactiveSms 完整通道（body + 5 dynamic context + trigger + 5 messageFormat labels）');
})();
