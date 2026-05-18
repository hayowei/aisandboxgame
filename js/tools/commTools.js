// ============================================
// Communication Tools — 通讯类工具（send_* 前缀）
// ============================================
// send_sms, send_notification

(function registerCommTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[commTools] toolRegistry 未加载，跳过注册');
    return;
  }
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // ----------------------------------------
  // send_sms — NPC 发短信给玩家
  // ----------------------------------------
  register('send_sms', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: null,
    description:
      '某个NPC给玩家发送一条短信/消息。',
    when_to_call:
      'NPC不在场但需要联系玩家时——发出警告、发送邀请、请求帮助、日常联络、传递情报等。',
    avoid_when:
      'NPC就在玩家面前可以直接对话时；同一回合已经发过短信且无新信息时。',
    input_focus:
      'from_npc_id 必须是 npcStore 中已注册的 NPC ID；message 应符合该NPC说话风格；mood 可选。',
    expected_output:
      '确认消息已送达。会触发未读消息提示。',
    parameters: {
      type: 'object',
      properties: {
        from_npc_id: {
          type: 'string',
          description: '发送者NPC ID（必须是已知的联系人或活跃NPC）',
        },
        message: { type: 'string', description: '短信内容' },
        mood: {
          type: 'string',
          description: '发送时的情绪标签（仅用于调试展示与历史标注，不影响后续 AI 行为）。可选填，如"焦急"、"调侃"、"冷淡"；不确定时省略。',
        },
      },
      required: ['from_npc_id', 'message'],
    },
    execute(args) {
      const sms = typeof smsService !== 'undefined' ? smsService : null;
      if (!sms) return JSON.stringify({ error: 'smsService 未加载' });

      const contactId = args.from_npc_id;

      if (!sms.conversations[contactId]) {
        sms.conversations[contactId] = [];
      }

      const ts = typeof timelineService !== 'undefined' ? timelineService : null;
      const gameTime = ts?.getCurrentDate?.() || null;

      const msg = {
        role: 'assistant',
        content: args.message,
        timestamp: Date.now(),
        gameTime: gameTime
          ? `${gameTime.year}年${gameTime.month}月${gameTime.day}日 ${gameTime.timeStr || ''}`
          : null,
        mood: args.mood || null,
        injectionStatus: 'new',
      };
      sms.conversations[contactId].push(msg);

      sms.unreadCounts[contactId] = (sms.unreadCounts[contactId] || 0) + 1;
      if (typeof sms.updateBadge === 'function') {
        sms.updateBadge();
      }

      if (window.eventBus && window.GameEvents) {
        window.eventBus.emit(window.GameEvents.SMS_UNREAD_UPDATED, {
          contactId,
          unreadCount: sms.unreadCounts[contactId],
        });
      }

      console.log(`[send_sms] ${contactId}: "${args.message}" (${args.mood || 'neutral'})`);

      return JSON.stringify({
        delivered: true,
        contact_id: contactId,
      });
    },
  });

  // ----------------------------------------
  // send_notification — 环境/系统通知
  // ----------------------------------------
  register('send_notification', {
    phase: null,
    required: false,
    trigger: (ctx) => {
      // 示例 trigger：玩家 HP 告急（customStatus.hp_percent < 20）
      // 如果 customStatus 未定义该字段则 undefined < 20 为 false，不会误触发
      const hp = Number(ctx?.customStatus?.hp_percent);
      if (!Number.isFinite(hp) || hp >= 20) return false;
      return { fire: true, hint: `玩家 HP 告急（${hp}%），建议发送警告通知` };
    },
    triggerHint: '玩家 HP 告急，建议发送警告通知',
    signal: null,
    description:
      '触发一条环境/系统通知。用于叙事之外的环境提示。',
    when_to_call:
      '需要在叙事文本之外提醒玩家注意某事时——天气变化、夜幕降临、危险预警等。',
    avoid_when:
      '信息已经在叙事文本中充分表达时；不要重复叙事内容作为通知。',
    input_focus:
      'type 选择通知类型：environment/system/danger；text 是通知内容，简短明确。',
    expected_output:
      '确认通知已触发。',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['environment', 'system', 'danger'],
          description: '通知类型',
        },
        text: { type: 'string', description: '通知内容' },
      },
      required: ['type', 'text'],
    },
    execute(args) {
      console.log(`[send_notification] [${args.type}] ${args.text}`);

      if (window.eventBus && window.GameEvents) {
        window.eventBus.emit(window.GameEvents.GAME_NOTIFICATION, {
          type: args.type,
          text: args.text,
          timestamp: Date.now(),
        });
      }

      return JSON.stringify({ shown: true });
    },
  });

  console.log('[commTools] 已注册 2 个通讯工具');
})();
