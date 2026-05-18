// ============================================
// Chat Actions - 消息操作功能
// ============================================

// 依赖: chat, chatHistory, aiService, saveManager (来自其他模块)
const CHAT_ACTIONS_INLINE_EXECUTE_ACTION_HTML =
  '<a class="chat-inline-action-execute" data-action="chat-inline-action-btn" href="#"><span class="material-symbols-outlined chat-inline-action-icon">check_circle</span><span class="chat-inline-action-label">执行</span></a>';

// 获取消息索引
function getMessageIndex(btn) {
  const actionsEl = btn.closest('.message-actions');
  return parseInt(actionsEl.dataset.msgIndex, 10);
}

function _extractAIFailureMetaForActions(error) {
  const info =
    error?.unifiedErrorInfo || error?.errorInfo || error?._aiErrorMeta?.errorInfo || null;

  return {
    errorInfo: info,
    traceId: error?.traceId || error?._aiErrorMeta?.traceId || info?.traceId || null,
    failedPhase: error?.failedPhase || error?._aiErrorMeta?.failedPhase || info?.phase || null,
  };
}

function _formatAIFailureMessageForActions(error) {
  const { errorInfo, failedPhase } = _extractAIFailureMetaForActions(error);
  const phaseMap = {
    react: 'ReAct',
    gm_decision: 'GM',
    summary: 'Summary',
    chapter: 'Chapter',
    sms: 'SMS',
    design: 'Design',
  };
  const providerMap = {
    openai: 'OpenAI',
    deepseek: 'DeepSeek',
    gemini: 'Gemini',
    anthropic: 'Anthropic',
    grok: 'Grok',
    siliconflow: 'SiliconFlow (CN)',
    custom: 'Custom',
    tool_engine: 'ToolEngine',
    codeengine: 'CodeEngine',
  };

  const phase = phaseMap[failedPhase || errorInfo?.phase] || '未知阶段';
  const providerRaw = errorInfo?.provider || '';
  const provider = providerMap[String(providerRaw).toLowerCase()] || providerRaw;
  const status = errorInfo?.httpStatus
    ? `HTTP ${errorInfo.httpStatus}`
    : errorInfo?.errorType || '';
  const reason = errorInfo?.rootCause || errorInfo?.message || error?.message || '未知错误';
  const details = [phase, provider, status].filter(Boolean).join(' / ');
  return `⚠️ 生成失败（${details}）：${reason}`;
}

function _buildErrorMetaForActions(error) {
  const { errorInfo, traceId, failedPhase } = _extractAIFailureMetaForActions(error);
  return { error, errorInfo, traceId, failedPhase };
}

// 复制消息内容
function copyMessage(msgIndex) {
  if (msgIndex < chatHistory.length) {
    const text = chatHistory[msgIndex].text;
    copyToClipboard(text);
  }
}

// 复制到剪贴板（兼容移动端）
function copyToClipboard(text) {
  // 优先使用现代 API
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        showToast('已复制到剪贴板');
      })
      .catch(() => {
        // 降级到传统方法
        fallbackCopy(text);
      });
  } else {
    // 降级到传统方法
    fallbackCopy(text);
  }
}

// 传统复制方法（兼容旧浏览器、非HTTPS环境和 iOS Safari）
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  // iOS Safari 需要 setSelectionRange
  textarea.setSelectionRange(0, text.length);

  try {
    const success = document.execCommand('copy');
    showToast(success ? '已复制到剪贴板' : '复制失败');
  } catch (e) {
    showToast('复制失败');
  }

  document.body.removeChild(textarea);
}

// 重新生成消息（常规模式会截断后续历史；世界卡 P2 走阶段重试，不截断历史）
async function regenerateMessage(msgIndex) {
  if (msgIndex >= chatHistory.length) {
    return;
  }

  const msg = chatHistory[msgIndex];

  // 世界卡 P2：走统一重试入口（不能截断 chatHistory，也不能被 isSending 早锁阻塞）
  if (isDesignMode && window.designService && designService.phase === 'p2') {
    // 卡牌审阅状态下禁用重新生成——审阅模式有自己的卡上操作，重跑会覆盖用户已做的修改
    if (designService.p2ReviewStage != null) {
      showToast('当前在角色卡牌审阅状态，请使用卡上的「重抽 / 删除」按钮，或在输入框直接描述改动');
      return;
    }
    if (isSending) {
      showToast('请等待当前自动生成任务完成');
      return;
    }

    const stageNameToIndex = {
      世界设定: 1,
      规则系统: 2,
      角色数据库: 3,
      时间线: 4,
      角色时间线: 5,
    };
    let preferredStage = null;
    const stageIndex = Number.parseInt(msg?.stageIndex, 10);
    if (Number.isFinite(stageIndex) && stageIndex >= 1 && stageIndex <= 5) {
      preferredStage = stageIndex;
    } else if (typeof msg?.stageName === 'string' && stageNameToIndex[msg.stageName]) {
      preferredStage = stageNameToIndex[msg.stageName];
    }

    if (typeof window.retryDesignPhase2FromPoint !== 'function') {
      showToast('重试入口未初始化，请刷新后重试');
      return;
    }
    const started = await window.retryDesignPhase2FromPoint({
      preferredStage,
      source: 'message-regenerate',
    });
    if (!started) {
      return;
    }
    return;
  }

  // 防止重复发送(isSending 定义在 chatCore.js)
  if (isSending) {
    showToast('请等待 AI 回复完成');
    return;
  }
  isSending = true;

  // 发送中灰禁用 textarea（设计/常规两条分支共用）。chatInputTextbox 是 chatCore.js
  // 的 module-private 变量，这里用 querySelector 取
  const _textboxForRegen = document.querySelector('.chat-input-textbox');
  if (_textboxForRegen) _textboxForRegen.disabled = true;

  // 暂存被重新生成的 AI 消息上的 OOC 写作准则（若存在），稍后透传给 aiService 复用，
  // 避免 regenerate 时丢失上一轮玩家通过反问敲定的写作风格。
  const reusedOoc = msg.sender === 'ai' && msg.ooc?.normalized ? msg.ooc : null;

  // 截断聊天历史
  if (msg.sender === 'ai') {
    chatHistory = chatHistory.slice(0, msgIndex);
  } else {
    chatHistory = chatHistory.slice(0, msgIndex + 1);
  }

  // 世界卡：使用 designService 重新生成
  if (isDesignMode) {
    refreshChatUI();
    try {
      if (!window.designService) throw new Error('设计服务未初始化');
      // 找到最后一条用户消息作为重新发送的内容
      const lastUserMsg = [...chatHistory].reverse().find(m => m.sender === 'user');
      if (lastUserMsg) {
        let aiText = '';
        let aiMessage = null;
        const providerKey =
          typeof window.resolveDesignProviderKey === 'function'
            ? window.resolveDesignProviderKey()
            : null;
        const designModelLabel =
          typeof window.resolveDesignModelLabel === 'function'
            ? window.resolveDesignModelLabel()
            : null;
        if (designService.phase === 'p1') {
          const result = await designService.sendP1Message(lastUserMsg.text, chatHistory);
          aiText = result.text;
          if (result.frameworkReady) {
            aiText += `\n\n---\n\n✅ 世界框架已整理完毕。点击输入栏的${CHAT_ACTIONS_INLINE_EXECUTE_ACTION_HTML}按键开始自动生成。`;
            if (typeof updateExecuteButtonState === 'function') {
              updateExecuteButtonState('p1');
            }
          }
          if (typeof window.buildDesignP1AiMessage === 'function') {
            aiMessage = window.buildDesignP1AiMessage(
              { ...result, text: aiText },
              designModelLabel,
              providerKey
            );
          }
        } else if (designService.phase === 'p3') {
          const result = await designService.sendP3Message(lastUserMsg.text);
          aiText = result.text;
          aiMessage = { sender: 'ai', text: aiText };
        } else {
          aiText = '当前阶段不支持重新生成。';
          aiMessage = { sender: 'ai', text: aiText };
        }
        if (!aiMessage) {
          aiMessage = { sender: 'ai', text: aiText };
        }
        if (providerKey) {
          aiMessage.providerKey = providerKey;
        }
        if (typeof designModelLabel === 'string' && designModelLabel.trim()) {
          aiMessage.modelLabel = designModelLabel.trim();
        }
        chatHistory.push(aiMessage);
      }
      refreshChatUI();
      showToast('已重新生成回复');
    } catch (error) {
      console.error('[DesignMode] Regenerate error:', error);
      const providerKey =
        typeof window.resolveDesignProviderKey === 'function'
          ? window.resolveDesignProviderKey()
          : null;
      const designModelLabel =
        typeof window.resolveDesignModelLabel === 'function'
          ? window.resolveDesignModelLabel()
          : null;
      const errMessage = {
        sender: 'ai',
        text: '⚠️ 重新生成失败: ' + error.message,
        isError: true,
        errorMeta: _buildErrorMetaForActions(error),
      };
      if (providerKey) {
        errMessage.providerKey = providerKey;
      }
      if (typeof designModelLabel === 'string' && designModelLabel.trim()) {
        errMessage.modelLabel = designModelLabel.trim();
      }
      chatHistory.push(errMessage);
      refreshChatUI();
    } finally {
      isSending = false;
      if (_textboxForRegen) _textboxForRegen.disabled = false;
    }
    return;
  }

  // 找到截断后最后一条 AI 消息的 UID（用于各服务回滚定位）
  const lastAiMsg = [...chatHistory].reverse().find(m => m.sender === 'ai');
  const targetUID = lastAiMsg?.uid || null;
  const turnNumber = chatHistory.filter(m => m.sender === 'ai').length;

  // 通过 EventBus 广播回滚事件，各服务自行处理
  if (typeof window.eventBus !== 'undefined' && window.GameEvents) {
    window.eventBus.emit(window.GameEvents.ROLLBACK_TO_TURN, {
      targetUID,
      turnNumber,
      truncatedHistory: chatHistory,
    });
    console.log(
      `[regenerateMessage] 已广播回滚事件: targetUID=${targetUID}, turnNumber=${turnNumber}`
    );
  }

  // 必须在 ROLLBACK_TO_TURN 广播之后存档：summaryService 等服务靠这事件 truncate
  // 自己的状态，先存会把陈旧 summaries 写盘，下次读档会出现"有 summary 但无 chat"
  // 的孤儿记录，并搞乱 pendingTurnCount 影响后续章节合并阈值
  window.autoSaveGame();

  // 立刻刷新界面显示删除后的状态。
  refreshChatUI({ scrollMode: 'bottom' });

  // 检查是否使用流式输出
  const useStreaming = aiService.getConfig().useStreaming;

  // 统一使用 streamVisualizer 创建骨架屏
  if (typeof streamVisualizer !== 'undefined') {
    setTimeout(() => streamVisualizer.start(useStreaming), 20);
  }

  if (typeof window.setSendBtnCancelMode === 'function') {
    window.setSendBtnCancelMode(true);
  }

  try {
    // 流式数据通过回调直接传递给 streamVisualizer（高频）
    // Step 完成通知通过 EventBus 广播，不再使用回调
    const onChunk = (text, reasoning) => {
      if (typeof streamVisualizer !== 'undefined' && streamVisualizer.isStreaming()) {
        streamVisualizer.update(text, reasoning);
      }
    };
    const aiResponse = await aiService.generateResponse(
      chatHistory,
      onChunk,
      reusedOoc
        ? {
            ooc: {
              forcedNormalized: reusedOoc.normalized,
              forcedRaw: Array.isArray(reusedOoc.raw) ? reusedOoc.raw : [],
            },
          }
        : undefined
    );
    processAIResponse(aiResponse);
    window.autoSaveGame(); // 成功后立即保存，避免 App 崩溃时数据丢失
    window.flushDeferredAiUiWork?.();
    showToast('已重新生成回复');
  } catch (error) {
    console.error(error);
    const { errorInfo, traceId, failedPhase } = _extractAIFailureMetaForActions(error);

    // EventBus 单轨模式：通过事件通知错误
    window.eventBus.emit(window.GameEvents.AI_ERROR, { error, errorInfo, traceId, failedPhase });

    chatHistory.push({
      sender: 'ai',
      text: _formatAIFailureMessageForActions(error),
      isError: true,
      errorMeta: _buildErrorMetaForActions(error),
    });
    window.autoSaveGame();
    window.aiService?.flushDeferredWorldCardActivation?.();
    refreshChatUI();
  } finally {
    isSending = false;
    if (_textboxForRegen) _textboxForRegen.disabled = false;
    if (typeof window.setSendBtnCancelMode === 'function') {
      window.setSendBtnCancelMode(false);
    }
    // 流式完成后同步折叠 turn N-1。交给 scrollController 受控：
    // pinned 焊底 / 非 pinned 钉住阅读位（取代旧手写 anchor 兜底）。
    if (!isDesignMode) {
      requestAnimationFrame(() => {
        if (window.isDesignMode) return;
        if (window.scrollController && typeof window.scrollController.runScoped === 'function') {
          window.scrollController.runScoped(() => window._markStaleChoices?.());
        } else {
          window._markStaleChoices?.();
        }
      });
    }
  }
}

// 待删除消息的索引
let _pendingDeleteMsgIndex = null;

// 删除单条消息 - 显示确认弹窗
function deleteMessage(msgIndex) {
  if (msgIndex >= chatHistory.length) return;

  _pendingDeleteMsgIndex = msgIndex;
  document.getElementById('chat-delete-confirm-modal').classList.remove('hidden');
}

// 确认删除消息
function confirmDeleteChatMessage() {
  const msgIndex = _pendingDeleteMsgIndex;
  if (msgIndex === null) return;

  // 保存被删消息引用（splice 前），用于清理关联的总结
  const deletedMsg = chatHistory[msgIndex];

  // 只删除这一条消息
  chatHistory.splice(msgIndex, 1);

  // 如果删除的是有 UID 的 AI 消息，同步清理对应的总结
  if (
    deletedMsg &&
    deletedMsg.sender === 'ai' &&
    deletedMsg.uid &&
    typeof window.summaryService !== 'undefined'
  ) {
    window.summaryService.removeSummaryByUID(deletedMsg.uid);
  }

  if (!isDesignMode) {
    window.autoSaveGame();
  }

  // 刷新聊天界面
  refreshChatUI();
  showToast('消息已删除');

  cancelDeleteChatMessage();
}

// 取消删除消息
function cancelDeleteChatMessage() {
  _pendingDeleteMsgIndex = null;
  document.getElementById('chat-delete-confirm-modal').classList.add('hidden');
}

// 编辑消息
function editMessage(msgIndex) {
  if (msgIndex >= chatHistory.length) return;

  const msg = chatHistory[msgIndex];
  // 使用 data-original-index 查找正确的消息元素(支持折叠模式)
  const targetMsg = document.querySelector(`.chat-message[data-original-index="${msgIndex}"]`);

  if (!targetMsg) {
    showToast('请先展开该消息所在的折叠组');
    return;
  }

  const contentEl = targetMsg.querySelector('.chat-message-content');
  // message-actions 现在在 contentEl 外面(是兄弟元素)
  const actionsEl = targetMsg.querySelector('.message-actions');

  // 隐藏操作按键
  if (actionsEl) actionsEl.style.display = 'none';

  // 检查是否是 AI 消息且有 game-narrative 元素（只编辑叙事部分）
  const narrativeEl = targetMsg.querySelector('.game-narrative');
  if (msg.sender === 'ai' && narrativeEl) {
    // AI 消息：只编辑叙事文本部分，保留状态栏和选项
    editNarrativeOnly(msgIndex, msg, narrativeEl, actionsEl);
    return;
  }

  // 非 AI 消息或没有 narrative：使用原来的整体编辑逻辑
  contentEl.innerHTML = '';

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-textarea chat-edit-textarea';
  textarea.value = msg.text;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'chat-edit-button-row';
  buttonContainer.innerHTML = `
        <button class="btn-primary" data-action="edit-save-btn" type="button">保存</button>
        <button class="btn-secondary" data-action="edit-cancel-btn" type="button">取消</button>
    `;

  contentEl.appendChild(textarea);
  contentEl.appendChild(buttonContainer);

  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  // 恢复内容的辅助函数
  const restoreContent = text => {
    // AI 消息重新添加水印（世界卡下不添加）
    const watermarkHtml =
      msg.sender === 'ai' && !isDesignMode
        ? '<span class="material-symbols-outlined metro-watermark">auto_stories</span>'
        : '';
    if (typeof formatMessageContent === 'function') {
      contentEl.innerHTML = watermarkHtml + formatMessageContent(text);
    } else if (window.htmlSecurity) {
      contentEl.innerHTML = watermarkHtml + window.htmlSecurity.markdownToSafeHtml(text);
    } else {
      contentEl.textContent = text;
    }
    if (actionsEl) actionsEl.style.display = '';
  };

  // 保存按键
  buttonContainer.querySelector('[data-action~="edit-save-btn"]').addEventListener('click', () => {
    const newText = textarea.value.trim();
    if (newText) {
      chatHistory[msgIndex].text = newText;
      if (chatHistory[msgIndex].sender === 'ai') {
        delete chatHistory[msgIndex].p1ThinkingFull;
        delete chatHistory[msgIndex].p1ThinkingPreview;
        delete chatHistory[msgIndex].p1Questions;
        delete chatHistory[msgIndex].p1QuestionGoal;
        delete chatHistory[msgIndex].p1FlowState;
        delete chatHistory[msgIndex].p1PanelVersion;
        if (typeof newText === 'string') {
          chatHistory[msgIndex].promptText = newText.slice(0, 400);
        }
      }
      if (!isDesignMode) {
        window.autoSaveGame();
      }
      restoreContent(newText);
      showToast('已保存修改');
    }
  });

  // 取消按键
  buttonContainer.querySelector('[data-action~="edit-cancel-btn"]').addEventListener('click', () => {
    restoreContent(msg.text);
  });
}

// 只编辑 AI 消息的叙事文本部分
function editNarrativeOnly(msgIndex, msg, narrativeEl, actionsEl) {
  // 保存原始 HTML 用于取消时恢复
  const originalNarrativeHtml = narrativeEl.innerHTML;

  // 尝试从 msg.text 解析 JSON 获取 panel_narrative
  let narrativeText = '';
  let jsonData = null;

  try {
    // 移除 markdown 代码块标记
    let jsonStr = msg.text.trim();
    jsonStr = jsonStr.replace(/^```json\s*/i, '').replace(/```\s*$/, '');
    jsonData = JSON.parse(jsonStr);
    narrativeText = jsonData.panel_narrative || '';
  } catch (e) {
    // 解析失败，直接使用纯文本
    narrativeText = narrativeEl.textContent || '';
  }

  // 清空叙事区域并创建编辑界面
  narrativeEl.innerHTML = '';
  narrativeEl.style.padding = '0'; // 移除 padding 避免双重间距

  const textarea = document.createElement('textarea');
  textarea.className = 'edit-narrative-textarea chat-edit-textarea chat-edit-textarea--narrative';
  textarea.value = narrativeText;

  const buttonContainer = document.createElement('div');
  buttonContainer.className = 'chat-edit-button-row chat-edit-button-row--spacious';
  buttonContainer.innerHTML = `
        <button class="btn-primary" data-action="edit-save-btn" type="button">保存</button>
        <button class="btn-secondary" data-action="edit-cancel-btn" type="button">取消</button>
    `;

  narrativeEl.appendChild(textarea);
  narrativeEl.appendChild(buttonContainer);

  textarea.focus({ preventScroll: true });
  // 光标放到开头方便阅读
  textarea.setSelectionRange(0, 0);
  textarea.scrollTop = 0;

  // 恢复叙事区域的辅助函数
  const restoreNarrative = newText => {
    narrativeEl.style.padding = ''; // 恢复原 padding
    if (window.htmlSecurity) {
      narrativeEl.innerHTML = window.htmlSecurity.markdownToSafeHtml(newText);
    } else {
      narrativeEl.innerHTML = newText.replace(/\n/g, '<br>');
    }
    if (actionsEl) actionsEl.style.display = '';
  };

  // 保存按键
  buttonContainer.querySelector('[data-action~="edit-save-btn"]').addEventListener('click', () => {
    const newNarrative = textarea.value.trim();
    if (newNarrative) {
      // 更新 JSON 中的 panel_narrative
      if (jsonData) {
        jsonData.panel_narrative = newNarrative;
        // 重新序列化为带代码块的 JSON 字符串
        chatHistory[msgIndex].text = '```json\n' + JSON.stringify(jsonData, null, 2) + '\n```';
      } else {
        // 无法解析 JSON 时直接替换文本
        chatHistory[msgIndex].text = newNarrative;
      }
      // 同步 gameData 中的叙事文本
      if (chatHistory[msgIndex].gameData) {
        chatHistory[msgIndex].gameData.panel_narrative = newNarrative;
      }
      if (!isDesignMode) {
        window.autoSaveGame();
      }
      restoreNarrative(newNarrative);
      showToast('叙事文本已保存');
    }
  });

  // 取消按键
  buttonContainer.querySelector('[data-action~="edit-cancel-btn"]').addEventListener('click', () => {
    narrativeEl.style.padding = '';
    narrativeEl.innerHTML = originalNarrativeHtml;
    if (actionsEl) actionsEl.style.display = '';
  });
}

/**
 * 从聊天历史中回滚时间/位置/地图状态
 * 找到最后一条 AI 消息，解析其 panel_status 来恢复状态
 * @param {Array} history - 截断后的聊天历史
 */
function _rollbackStatusFromHistory(history) {
  // 找到所有 AI 消息
  const aiMessages = history.filter(m => m.sender === 'ai');
  const lastAiMsg = aiMessages.length > 0 ? aiMessages[aiMessages.length - 1] : null;
  const secondLastAiMsg = aiMessages.length > 1 ? aiMessages[aiMessages.length - 2] : null;

  if (!lastAiMsg) {
    // 没有 AI 消息了，清空状态
    if (typeof timelineService !== 'undefined') {
      timelineService.clear();
    }
    if (typeof locationTracker !== 'undefined') {
      locationTracker.clear();
    }
    if (typeof playerStateService !== 'undefined') {
      playerStateService.clear();
    }
    return;
  }

  // 尝试解析 panel_status
  try {
    const jsonMatch = lastAiMsg.text.match(/```json\s*([\s\S]*?)\s*```/);
    if (!jsonMatch) return;

    const gameData = JSON.parse(jsonMatch[1]);
    if (!gameData.panel_status) return;

    const status = gameData.panel_status;

    // 恢复时间
    if (status.datetime && typeof timelineService !== 'undefined') {
      const dt = status.datetime;
      const hour = Number.parseInt(dt.hour, 10);
      const minute = Number.parseInt(dt.minute, 10);
      const timeInput =
        Number.isFinite(hour) && Number.isFinite(minute)
          ? hour
          : typeof dt.time_str === 'string'
            ? dt.time_str
            : dt.timeStr || null;
      timelineService.setCurrentDate(
        dt.year,
        dt.month,
        dt.day,
        timeInput,
        Number.isFinite(hour) && Number.isFinite(minute) ? minute : null
      );
      console.log('[Rollback] 时间已回滚到:', dt);
    }

    // 恢复位置追踪器
    if (status.location && typeof locationTracker !== 'undefined') {
      // 计算回滚后的目标 turn（回滚后剩余的 AI 消息数）
      const targetTurn = chatHistory.filter(m => m.sender === 'ai').length;
      locationTracker.restoreToTurn(status.location, targetTurn);
      console.log('[Rollback] 位置追踪已回滚到:', status.location, 'Turn:', targetTurn);
    }

    // 恢复 playerStateService（金钱、目标）
    if (typeof playerStateService !== 'undefined') {
      playerStateService.syncFromAIResponse(status);
      console.log('[Rollback] 玩家状态已回滚');
    }

    // 重新计算 previousTurn 状态（从倒数第二条 AI 消息获取）
    if (typeof playerStateService !== 'undefined') {
      if (secondLastAiMsg) {
        try {
          const prevJsonMatch = secondLastAiMsg.text.match(/```json\s*([\s\S]*?)\s*```/);
          if (prevJsonMatch) {
            const prevGameData = JSON.parse(prevJsonMatch[1]);
            if (prevGameData.panel_status) {
              const prevStatus = prevGameData.panel_status;
              const prevDate = prevStatus.datetime
                ? {
                    year: prevStatus.datetime.year,
                    month: prevStatus.datetime.month,
                    day: prevStatus.datetime.day,
                    hour: prevStatus.datetime.hour,
                    minute: prevStatus.datetime.minute,
                    timeStr:
                      typeof prevStatus.datetime.time_str === 'string'
                        ? prevStatus.datetime.time_str
                        : prevStatus.datetime.timeStr || null,
                  }
                : null;
              const prevLocation = prevStatus.location || null;
              playerStateService.setPreviousTurnState(prevDate, prevLocation);
              console.log('[Rollback] previousTurn 状态已恢复');
            }
          }
        } catch (e) {
          console.warn('[Rollback] 解析 previousTurn 消息失败:', e);
        }
      } else {
        // 只有一条 AI 消息，没有 previousTurn
        playerStateService.setPreviousTurnState(null, null);
      }
    }
  } catch (e) {
    console.warn('[Rollback] 解析历史消息失败:', e);
  }
}

// ============================================
// EventBus 订阅 - 状态回滚
// ============================================
if (typeof window.eventBus !== 'undefined' && window.GameEvents) {
  window.eventBus.on(window.GameEvents.ROLLBACK_TO_TURN, ({ truncatedHistory }) => {
    _rollbackStatusFromHistory(truncatedHistory);
  });
  console.log('[chatActions] 已订阅 ROLLBACK_TO_TURN 事件（状态回滚）');
}

Object.assign(window, {
  getMessageIndex,
  copyMessage,
  regenerateMessage,
  deleteMessage,
  confirmDeleteChatMessage,
  cancelDeleteChatMessage,
  editMessage,
});
