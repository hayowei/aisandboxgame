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

// 时间线回退公用：把某快照的 stores 还原到 16 个 store——「并到当前活态之上」，即采集时抛错漏掉的 store
// 保留当前值、不被 restoreAll 的缺键 clear 清空（部分采集失败兜底）。全量快照下与直接 restoreAll(stores) 等价。
function _restoreStoresMergedOverLive(stores) {
  if (
    !stores ||
    typeof window.ServiceRegistry === 'undefined' ||
    typeof window.ServiceRegistry.restoreAll !== 'function'
  ) {
    return false;
  }
  let merged = stores;
  try {
    const live =
      typeof window.ServiceRegistry.collectSaveData === 'function'
        ? window.ServiceRegistry.collectSaveData().data || {}
        : {};
    merged = { ...live, ...stores };
  } catch (_) {
    merged = stores;
  }
  // v2 自由跳转：还原侧【必须深拷贝】。{...live,...stores} 是浅展开，merged.<store> 仍是池里那条快照的嵌套对象
  // （如 npc.state）。restoreAll 直接把这些引用交给 store，后续回合 in-place 改（npcStore.applyAutonomyDecision /
  // 在场投影）会污染仍可跳回的快照 → 再跳回该点 store↔history 错位。写入侧(pushTurnSnapshot)已深拷贝、history 也已深拷贝，这里补齐对称。
  try {
    merged = JSON.parse(JSON.stringify(merged));
  } catch (_) {
    /* 不可序列化时退回共享引用（极罕见；存档本就走 JSON）*/
  }
  window.ServiceRegistry.restoreAll(merged);
  return true;
}

// 重新生成消息（常规模式会截断后续历史；世界卡 P2 走阶段重试，不截断历史）
async function regenerateMessage(msgIndex) {
  if (msgIndex >= chatHistory.length) {
    return;
  }

  const msg = chatHistory[msgIndex];

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

  // PZWC 引擎建造运行中：重新生成会截断历史 + refreshChatUI 重建 DOM，把引擎的
  // 流式气泡全打成离屏节点——先拦下，让用户暂停后再操作。
  if (
    isDesignMode &&
    window.designService?.phase === 'pzwc' &&
    window.pzwcDesignController?.isBuilding?.()
  ) {
    showToast('引擎正在建造中——先点暂停，再重新生成');
    isSending = false;
    if (_textboxForRegen) _textboxForRegen.disabled = false;
    return;
  }

  // 暂存被重新生成的 AI 消息上的 OOC 写作准则（若存在），稍后透传给 aiService 复用，
  // 避免 regenerate 时丢失上一轮玩家通过反问敲定的写作风格。
  // 含 raw?.length：PZGM 导演单发回合 normalized 为空、raw 有导演标签，重生需复用 raw 重扩导演块。
  const reusedOoc = msg.sender === 'ai' && (msg.ooc?.normalized || msg.ooc?.raw?.length) ? msg.ooc : null;

  // 末回合重新生成 = 还原回退基（restoreAll 退到 end-of-(N-1)）+ 重跑。无回退基（老档 / 未满 2 回合 / 采集抛错）时，
  // 非错误 AI 回合**绝不**静默重跑——那会在当前（N）态上重复施加（物品双计 / NPC 双进 / 引擎写成 N+1
  // → 引擎与叙事永久错位、级联后续每回合）。错误回合（generateResponse 抛过、未落任何 store）例外，照常重试。
  const _isErrorTurn = msg.isError === true || Boolean(msg.errorMeta);
  // 回退基 = 被重生回合【上一条已提交 AI】对应的快照（按 chatUid 在游戏历史里定位，不靠 turn——回退后 turn 会重复）。
  // 错误回合从当前态重跑、不需基。
  const _rollbackBase =
    !_isErrorTurn && msg.sender === 'ai' && msg.uid && typeof window.getPrevAiSnapshot === 'function'
      ? window.getPrevAiSnapshot(msg.uid)
      : null;
  if (!isDesignMode && !_isErrorTurn && !_rollbackBase) {
    showToast('这一回合之前没有可回退的存档点了（只保留最近若干回合的回退点）');
    isSending = false;
    if (_textboxForRegen) _textboxForRegen.disabled = false;
    return;
  }

  // 截断聊天历史
  if (msg.sender === 'ai') {
    chatHistory = chatHistory.slice(0, msgIndex);
  } else {
    chatHistory = chatHistory.slice(0, msgIndex + 1);
  }

  // 世界卡：建造/编辑阶段都不支持单条重新生成（PZWC 替换 P1/P2 后）
  if (isDesignMode) {
    refreshChatUI();
    const providerKey =
      typeof window.resolveDesignProviderKey === 'function'
        ? window.resolveDesignProviderKey()
        : null;
    const designModelLabel =
      typeof window.resolveDesignModelLabel === 'function'
        ? window.resolveDesignModelLabel()
        : null;
    const aiMessage = {
      sender: 'ai',
      text:
        window.designService?.phase === 'pzwc'
          ? '建造阶段不支持单条重新生成——直接发送新的世界描述即可整体重开一次建造。'
          : '当前阶段不支持重新生成。',
    };
    if (providerKey) aiMessage.providerKey = providerKey;
    if (typeof designModelLabel === 'string' && designModelLabel.trim()) {
      aiMessage.modelLabel = designModelLabel.trim();
    }
    chatHistory.push(aiMessage);
    refreshChatUI();
    isSending = false;
    if (_textboxForRegen) _textboxForRegen.disabled = false;
    return;
  }

  // 还原回退基：把 16 个 store 退回上一回合末（N-1）。错误回合 _rollbackBase 为 null、无需还原（从当前态重跑）。
  // restoreAll 只覆盖已注册的 16 个 store，**不碰 chatHistory**——截断后的 chatHistory 末尾已是玩家这回合
  // 的输入，直接喂回 generateResponse 即重跑。
  if (_rollbackBase && _rollbackBase.stores) {
    _restoreStoresMergedOverLive(_rollbackBase.stores);
  }
  // v2：只从池里移走被重生的那一条旧快照（不截断其后——读取/回退永不删点；用户拍板「立即删那一个」）。
  // 重跑成功后 processAIResponse 会压一条新的 end-of-N（新 chatUid）；重跑失败则该回合从池消失、真末回合 N-1 仍可退。
  if (msg.sender === 'ai' && msg.uid && typeof window.removeRingByChatUid === 'function') {
    window.removeRingByChatUid(msg.uid);
  }

  // 固化退回后的状态。此刻活态 == _priorStores == N-1，是正确的重跑基线（非坏状态；工程无 current==prior 传感器）。
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
    // 重新生成失败：刚才已 restoreAll 把 store 退回 N-1、截掉了被重生回合的 AI 回复、并把时间线环截到 ≤N-1。
    // 此刻末尾是「玩家输入 + 无 uid 错误气泡」的半截回合：错误气泡被 isLatestTurn 跳过，真末回合 N-1 仍可退
    // （其回退基 end-of-(N-2) 仍在环里）。错误气泡的「重试」从当前态（已是 N-1）重跑、不依赖快照。无需额外处理。
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
    // pinned 贴住底部 / 非 pinned 保持阅读位（取代旧手写 anchor 兜底）。
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
// 本次删除是否走「真回退」（删最新一回合 = restoreAll 退回 N-1）。false = 仅擦显示。
let _pendingDeleteWillRewind = false;

// 删除单条消息 - 显示确认弹窗
function deleteMessage(msgIndex) {
  if (msgIndex >= chatHistory.length) return;

  const msg = chatHistory[msgIndex];

  // 「删最新一回合 = 真回退」判定：游戏模式 + 非错误/非取消的 AI 消息 + 它是最新 AI 回合 + 有可回退的
  // 1-deep 快照。等价于「这条消息此刻能重新生成」——复用同一套 restoreAll(上一份快照) 把 16 个 store
  // （含 pzgmState 的 narrativeLog/chapters/npcState，这才是 AI 真正读的「记忆」）退回 N-1，区别只是
  // 删除不重跑。
  const _isErrTurn = !!(msg && (msg.isError === true || msg.errorMeta));
  const _isCancelledBubble = !!(msg && msg.isCancelled === true);
  const _hasPrior =
    (typeof window.getPriorStoresSnapshot === 'function' ? window.getPriorStoresSnapshot() : null) !=
    null;
  // gameOutputRenderer 是裸全局（const，非 window 属性）——按 chatCore._shouldShowRegenerateButton 的
  // fail-closed 写法引用：取不到判定就当「不是末回合」，宁可退化成不可删，绝不在非末回合误触发回退。
  const _isLatestAiTurn =
    typeof gameOutputRenderer !== 'undefined' &&
    typeof gameOutputRenderer.isLatestTurn === 'function' &&
    !!msg &&
    gameOutputRenderer.isLatestTurn(msg.uid) === true;
  _pendingDeleteWillRewind =
    !isDesignMode &&
    !!msg &&
    msg.sender === 'ai' &&
    !_isErrTurn &&
    !_isCancelledBubble &&
    _isLatestAiTurn &&
    _hasPrior;

  // 删除只在「能真回退的最新回合」或「末尾出错/取消的临时气泡」上提供（与按钮门控 _shouldShowDeleteButton
  // 一致）。中间/老回合、玩家消息走到这里只可能是 DOM 残留的旧按钮——直接拒绝、连弹窗都不开，绝不退化成
  // 「只 splice chatHistory、不动引擎记忆」的泄漏路径（删了 AI 还记得正是要修的 bug）。
  const _isTrailingTransient =
    !!msg &&
    msg.sender === 'ai' &&
    (_isErrTurn || _isCancelledBubble) &&
    msgIndex === chatHistory.length - 1;
  if (!_pendingDeleteWillRewind && !_isTrailingTransient) {
    // 末回合但更早快照被「只保留最近 5 个回退点」驱逐掉了（禁用态按钮被点）→ 解释上限，而不是静默无反应。
    if (_isLatestAiTurn && !_isErrTurn && !_isCancelledBubble && !_hasPrior) {
      showToast('只保留最近 5 个回退点——这一回合之前的已经退不回去了');
    }
    return;
  }

  // 按场景写弹窗文案：真回退要讲清「整回合移除 + AI 会忘」；删临时气泡只是消除一条无剧情内容的
  // 出错/取消提示（此分支已不会落到中间/老回合，无需再写「不会让 AI 忘记」那句免责声明）。
  const _en = (function () {
    try {
      return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
    } catch (_) {
      return false;
    }
  })();
  const descEl = document.querySelector('#chat-delete-confirm-modal .modal-description');
  const confirmBtn = document.getElementById('chat-delete-confirm-btn');
  if (descEl) {
    if (_pendingDeleteWillRewind) {
      descEl.textContent = _en
        ? "Delete the latest turn? Your action and the AI's reply this turn are both removed and the game rewinds to before it — the AI will forget this part of the story."
        : '删除最新一回合？你这一回合的行动和 AI 的回复都会移除，游戏退回这一回合之前，AI 也会忘记这段剧情。';
    } else {
      descEl.textContent = _en ? 'Delete this message?' : '删除这条消息？';
    }
  }
  if (confirmBtn) {
    confirmBtn.textContent = _pendingDeleteWillRewind
      ? _en
        ? 'Delete & rewind'
        : '删除并回退'
      : _en
        ? 'Delete'
        : '删除';
  }

  _pendingDeleteMsgIndex = msgIndex;
  document.getElementById('chat-delete-confirm-modal').classList.remove('hidden');
}

// 确认删除消息
function confirmDeleteChatMessage() {
  const msgIndex = _pendingDeleteMsgIndex;
  if (msgIndex === null) return;

  // 保存被删消息引用（splice 前），用于清理关联的总结
  const deletedMsg = chatHistory[msgIndex];

  // ───── 真回退分支：删最新一回合 ─────
  // 复用时间线回退：取 turn===N-1 的快照（回退基），restoreAll 把 16 个 store 退回 N-1（含 pzgmState 的
  // narrativeLog/chapters/npcState —— 这才是 AI 真正读的「记忆」，光删 chatHistory 治不了泄漏），再把这一
  // 回合（玩家行动 + AI 回复）整段从 chatHistory 截掉，并把时间线环截到 ≤N-1。区别于 regenerate：不重跑。
  if (_pendingDeleteWillRewind) {
    // 流式进行中绝不回退：此刻 store 仍在 N-1、in-flight 回复尚未落入 chatHistory，回退+截断会与流式
    // 结束后的 processAIResponse 抢同一份 chatHistory/环 → 错乱。同 regenerate 的 isSending 闸门。
    if (isSending) {
      showToast('请等待 AI 回复完成');
      cancelDeleteChatMessage();
      return;
    }
    // TOCTOU：确认时按被删回合【重新解析】回退基（它上一条已提交 AI 的快照），不靠弹窗打开那一刻的旧引用。
    // 取不到基（已驱逐 / 已非末回合）→ 绝不半截截断（只截 history 不退 store = 正是要修的 store↔history 错位）。提示重试。
    const base =
      deletedMsg && deletedMsg.uid && typeof window.getPrevAiSnapshot === 'function'
        ? window.getPrevAiSnapshot(deletedMsg.uid)
        : null;
    const canRestore =
      base &&
      base.stores &&
      typeof window.ServiceRegistry !== 'undefined' &&
      typeof window.ServiceRegistry.restoreAll === 'function';
    if (!canRestore) {
      showToast('回退快照暂不可用，请重试');
      cancelDeleteChatMessage();
      return;
    }
    _restoreStoresMergedOverLive(base.stores); // 16 个 store（含 pzgmState narrativeLog/chapters）退回 N-1，缺席键保活态
    // v2：把聊天历史设为回退基【自带的自包含 history】（正好停在上一回合末——天然不含本回合玩家输入 + OOC 反问串）。
    // 缺 history（漏迁的老 entry）才回退老法：手搓向前截（含 OOC 串 + 触发本回合的玩家行动消息）。
    if (Array.isArray(base.history)) {
      try {
        chatHistory = JSON.parse(JSON.stringify(base.history));
      } catch (_) {
        chatHistory = base.history.slice();
      }
    } else {
      let cut = msgIndex;
      while (cut > 0 && chatHistory[cut - 1] && chatHistory[cut - 1].meta === 'ooc_qa') cut -= 1;
      if (cut > 0 && chatHistory[cut - 1] && chatHistory[cut - 1].sender === 'user') cut -= 1;
      chatHistory = chatHistory.slice(0, cut);
    }
    // v2：只从池里移走被删的那一条快照（不截断其后——读取永不删点；用户拍板「立即删那一个」）。
    if (deletedMsg && deletedMsg.uid && typeof window.removeRingByChatUid === 'function') {
      window.removeRingByChatUid(deletedMsg.uid);
    }
    window.autoSaveGame(); // 此刻 chatHistory / stores / 池 一致；被删回合那条快照已移除
    refreshChatUI({ scrollMode: 'bottom' });
    // N-1 成为新末回合：其选项块随 refreshChatUI 重建后应恢复可点（_markStaleChoices 纯按 DOM 位置判定）。
    if (window.scrollController && typeof window.scrollController.runScoped === 'function') {
      window.scrollController.runScoped(() => window._markStaleChoices?.());
    } else {
      window._markStaleChoices?.();
    }
    showToast('已删除最新一回合并回退');
    cancelDeleteChatMessage();
    return;
  }

  // ───── 仅擦显示分支：中间/老回合 / 错误消息 / 玩家消息 / 设计模式 ─────
  // 只从 chatHistory 抠掉这一条 + 清掉对应总结。**故意不回退引擎/派生状态**：1-deep 快照只够退末回合，
  // 中间/老回合无法真回退；这点已在删除弹窗文案明确告知玩家（删除≠让 AI 忘记）。
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
  _pendingDeleteWillRewind = false;
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
        delete chatHistory[msgIndex].p1Naming;
        delete chatHistory[msgIndex].p1Confirm;
        delete chatHistory[msgIndex].p1Anchor;
        delete chatHistory[msgIndex].frontFilter;
        delete chatHistory[msgIndex].p1PanelVersion;
        if (typeof newText === 'string') {
          chatHistory[msgIndex].promptText = newText.slice(0, 400);
        }
      }
      if (!isDesignMode) {
        // v2：把改后内容同步进【所有含这条消息的自包含快照】（按 uid）——否则跳回那些点会显示编辑前文本。
        // 无 uid 的消息（部分玩家消息）退回刷新当前回合快照（至少 head 一致）。
        try {
          const _eu = chatHistory[msgIndex] && chatHistory[msgIndex].uid;
          if (_eu && window.patchEditedMessageInPool) window.patchEditedMessageInPool(_eu);
          else window.repushCurrentTurnSnapshot?.();
        } catch (_) {}
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
        // v2：把改后叙事同步进【所有含这条 AI 消息的自包含快照】（按 uid），否则跳回那些点会显示编辑前文本。
        try {
          const _eu = chatHistory[msgIndex] && chatHistory[msgIndex].uid;
          if (_eu && window.patchEditedMessageInPool) window.patchEditedMessageInPool(_eu);
          else window.repushCurrentTurnSnapshot?.();
        } catch (_) {}
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

Object.assign(window, {
  getMessageIndex,
  copyMessage,
  regenerateMessage,
  deleteMessage,
  confirmDeleteChatMessage,
  cancelDeleteChatMessage,
  editMessage,
});
