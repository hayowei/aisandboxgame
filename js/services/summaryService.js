// ============================================
// Summary Service - 总结助手服务
// ============================================

// 依赖: aiService (来自 aiService.js)

// stage-router 重构后总结红点存在两处：老 #summary-btn-badge（hidden 侧栏内）+ 新
// #stage-summary-badge（剧情舞台 sub-tab 上）。两份共用一份显隐逻辑，每次调用现查 DOM
// 避免初次构造时新 ID 还没渲染的时序坑
function _toggleSummaryBadge(hidden) {
  const nodes = [
    document.getElementById('summary-btn-badge'),
    document.getElementById('stage-summary-badge'),
  ];
  nodes.forEach(n => n && n.classList.toggle('hidden', hidden));
}

class SummaryService {
  constructor() {
    this.summaries = []; // 混合存储:{ type: 'turn' | 'chapter', ... }
    this.listEl = document.getElementById('summary-list');
    this.tileEl = document.getElementById('summary-tile');
    this.pendingTurnCount = 0; // 当前待合并的单轮总结数量
    this._generationEpoch = 0; // 回滚/清空时递增，用于丢弃过期的异步总结结果
    this._chapterGenSuppressed = false; // _runAuditFix 期间设 true，summarize() 末尾跳过 chapter 自动触发
    this._chapterRetryAfter = 0; // chapter 生成失败后的退避阈值（pendingTurnCount 必须 ≥ 此值才重试）
    this._lastAbortReason = ''; // 一键修复因连续失败熔断时的提示文案，下一次修复成功后清空
  }

  // 当前活跃的 chatHistory 引用：世界卡 → designChatHistory（即 window.chatHistory），
  // 沙盒 → 原 game chat。和 _collectAuditResult 的取法一致，避免在两种模式下查错历史
  _getActiveChatHistory() {
    if (typeof isDesignMode !== 'undefined' && isDesignMode) {
      return Array.isArray(window._gameChatHistory) ? window._gameChatHistory : [];
    }
    return Array.isArray(window.chatHistory) ? window.chatHistory : [];
  }

  // 统一重算 pendingTurnCount（只计成功的非 chapter 条目）
  _recalcPendingTurnCount() {
    this.pendingTurnCount = this.summaries.filter(
      s => s.type !== 'chapter' && s.text !== null
    ).length;
  }

  // chapter 锚点重排：保持 chapter 原始相对顺序（数组中的位置 == 生成时间序），
  // 把所有 turn 按 turnNumber 升序归位到对应 chapter 区间。
  // 用于 _runAuditFix Step D 修复后的整理 —— 不依赖 turnRange，对老 chapter（缺 turnRange）也安全
  _reorderSummariesByChapterAnchors(summaries) {
    const chapters = [];
    const turns = [];
    for (const s of summaries) {
      (s.type === 'chapter' ? chapters : turns).push(s);
    }
    turns.sort((a, b) => (a.turnNumber ?? 0) - (b.turnNumber ?? 0));

    // 每个 chapter 的"管辖上限 turnNumber"：bucket[i] 接住 turnNumber > thresholds[i] 的 turn
    //   - 优先用自身 turnRange[1]
    //   - 缺则用下一个 chapter.turnRange[0] - 1（推断管辖到下一个 chapter 之前）
    //   - 都没有兜底 (idx + 1) * CHAPTER_SIZE（按"每 20 turn 一章"假设给老 chapter 一个虚拟上界）
    const thresholds = chapters.map((c, i) => {
      if (Number.isFinite(c.turnRange?.[1])) return c.turnRange[1];
      const next = chapters[i + 1];
      if (Number.isFinite(next?.turnRange?.[0])) return next.turnRange[0] - 1;
      return (i + 1) * SummaryService.CHAPTER_SIZE;
    });

    // 对每个 turn，找最大的 i 使 thresholds[i] < turnNumber —— 该 turn 排到 chapter[i] 之后。
    // 找不到（即 turn 比所有 chapter 的上界都小）则归 head（chapter[0] 之前）
    const head = [];
    const buckets = chapters.map(() => []);
    for (const t of turns) {
      const tn = t.turnNumber ?? 0;
      let placed = -1;
      for (let i = thresholds.length - 1; i >= 0; i--) {
        if (thresholds[i] < tn) {
          placed = i;
          break;
        }
      }
      if (placed === -1) head.push(t);
      else buckets[placed].push(t);
    }

    const merged = [...head];
    chapters.forEach((c, i) => {
      merged.push(c);
      merged.push(...buckets[i]);
    });
    return merged;
  }

  // 总结失败时的视觉反馈
  flashErrorBorder() {
    // 桌面端：边框闪烁
    if (this.tileEl) {
      this.tileEl.classList.remove('summary-tile-flash-error');
      void this.tileEl.offsetWidth;
      this.tileEl.classList.add('summary-tile-flash-error');
      this.tileEl.addEventListener(
        'animationend',
        () => {
          this.tileEl.classList.remove('summary-tile-flash-error');
        },
        { once: true }
      );
    }
    // 移动端 + stage-nav 剧情/章节总结子页：3 处共用一份红点
    _toggleSummaryBadge(false /* hidden=false → show */);
  }

  clearErrorBadge() {
    _toggleSummaryBadge(true /* hidden=true → hide */);
  }

  // 从 turnUID 中解析真实的轮次编号
  // turnUID 格式: turn_{turnNumber}_{timestamp}_{random}
  parseTurnNumberFromUID(turnUID) {
    if (!turnUID) return null;
    const match = turnUID.match(/^turn_(\d+)_/);
    return match ? parseInt(match[1], 10) : null;
  }

  _buildStatusSummaryText(status) {
    if (!status || typeof status !== 'object') return '';

    const formatLocationValue = value => {
      if (value === null || value === undefined || value === '') return value;
      const eStore = window.entityStore;
      if (!eStore || typeof eStore.resolveDisplayName !== 'function') {
        return value;
      }
      return eStore.resolveDisplayName(String(value)) || value;
    };

    const step3Fields = window.worldMeta?.getStep3Fields?.();
    if (step3Fields && typeof window.step3SchemaBuilder !== 'undefined') {
      const raw = window.step3SchemaBuilder.buildLastGameStateText(
        status,
        step3Fields.panel_status || []
      );
      return raw
        .split('\n')
        .map(line => line.replace(/^\*\s*/, '').trim())
        .filter(Boolean)
        .join('; ');
    }

    // step3_fields 缺失时的宽松兜底
    const parts = [];
    for (const [groupKey, data] of Object.entries(status)) {
      if (data === null || data === undefined) continue;
      if (Array.isArray(data)) {
        const items = data
          .map(item => {
            if (!item || typeof item !== 'object') return '';
            return Object.values(item)
              .filter(v => v !== null && v !== undefined && v !== '')
              .join('/');
          })
          .filter(Boolean);
        if (items.length > 0) parts.push(`${groupKey}: ${items.join(', ')}`);
        continue;
      }
      if (typeof data === 'object') {
        const values = Object.entries(data)
          .map(([, value]) => (groupKey === 'location' ? formatLocationValue(value) : value))
          .filter(v => v !== null && v !== undefined && v !== '');
        if (values.length > 0) parts.push(`${groupKey}: ${values.join(' ')}`);
        continue;
      }
      parts.push(`${groupKey}: ${data}`);
    }
    return parts.join('; ');
  }

  // 触发总结并添加到面板
  // @param {string} aiResponse - AI 回复的原始文本(Step 3 的 JSON)
  // @param {string} turnUID - 该轮对话的唯一标识符
  // @param {string} narrativeText - Step 2 生成的叙事文本(可选，优先使用)
  async summarize(aiResponse, turnUID = null, narrativeText = null, gameData = null) {
    // 提取 panel_status(状态面板)和叙事文本
    let contentToSummarize = '';

    // 优先使用侧带 gameData，兜底从 aiResponse 文本解析
    let panelStatus = gameData?.panel_status || null;
    if (!panelStatus) {
      try {
        const jsonMatch = aiResponse.match(/```(?:json|typescript)?\s*([\s\S]*?)```/i);
        if (jsonMatch) {
          const json = JSON.parse(jsonMatch[1]);
          panelStatus = json.panel_status || null;
        }
      } catch (e) {
        console.debug('[SummaryService] JSON 解析失败，使用叙事文本兜底:', e.message);
      }
    }

    if (panelStatus) {
      const statusText = this._buildStatusSummaryText(panelStatus);
      if (statusText) contentToSummarize += '[状态] ' + statusText + '\n\n';
    }

    if (narrativeText) {
      contentToSummarize += '[剧情] ' + narrativeText;
    }

    // 如果没有提取到内容，跳过总结
    if (!contentToSummarize) {
      console.log('No content found for summary, skipping');
      return;
    }

    // 清空空状态提示
    const emptyEl = this.listEl.querySelector('.summary-empty');
    if (emptyEl) {
      emptyEl.remove();
    }

    // 如果没有提供 UID，生成一个新的(fallback，正常不应该走到这里)
    const uid =
      turnUID || (typeof generateTurnUID === 'function' ? generateTurnUID() : `turn_${Date.now()}`);

    // 从 UID 中解析真实的轮次编号，如果解析失败则使用旧逻辑作为 fallback
    let turnNumber = this.parseTurnNumberFromUID(uid);
    if (turnNumber === null) {
      // fallback: 使用当前非 chapter 条目数量 + 1
      turnNumber = this.summaries.filter(s => s.type !== 'chapter').length + 1;
    }
    const itemEl = document.createElement('div');
    itemEl.className = 'summary-item loading';
    itemEl.dataset.turn = turnNumber;
    itemEl.dataset.uid = uid; // 保存 UID 到 DOM
    itemEl.innerHTML =
      '<div class="summary-item-header"><span class="summary-index">T' +
      turnNumber +
      '</span></div><span class="summary-text">总结中...</span>';
    this.listEl.appendChild(itemEl);

    // 滚动到底部
    this.listEl.scrollTop = this.listEl.scrollHeight;

    const epochBefore = this._generationEpoch;

    try {
      // 调用 AI 生成总结。包了一层网络重试避免 Safari "Load failed" 单次抖动直接报失败,
      // 用户没必要为一次网络毛刺手动点重试。只对网络类错误重试 (不重试用户取消/4xx)。
      const summary = await this._generateSummaryWithRetry(contentToSummarize);

      // 异步期间发生了回滚，丢弃结果
      if (this._generationEpoch !== epochBefore) {
        console.log('[SummaryService] 总结生成期间发生了回滚，丢弃结果');
        itemEl.remove();
        return;
      }

      // 防御：异步期间外部调用 renderSummaries（如 _runAuditFix Step D）会清空 listEl，
      // itemEl 此时已脱离 DOM，更新它没有视觉效果。把它挂回去，确保用户能看见
      if (!itemEl.parentNode && this.listEl) {
        this.listEl.appendChild(itemEl);
      }

      // 更新总结项(包含操作按键)
      itemEl.classList.remove('loading');
      itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, summary);

      // 保存到数组(UID 用于从 chatHistory 重建原始内容)
      this.summaries.push({
        type: 'turn',
        uid: uid,
        turnNumber: turnNumber,
        text: summary,
      });
      this.pendingTurnCount++;
      // 异步落定后立刻持久化，避免 race：autoSaveGame 由 mainLoop 同步触发，
      // 那一刻本轮 summary 还在 LLM 调用中，磁盘上的 summaries 永远会缺最新一轮
      if (typeof window.autoSaveGame === 'function') window.autoSaveGame();

      // 绑定按键事件
      this.bindItemEvents(itemEl, turnNumber);

      // 更新统计信息
      this.updateStats();

      // 检查是否需要生成章节总结
      // 修复期间（_runAuditFix 进行中）跳过：此时 summaries 数组未排序，
      // 在乱序状态下生成 chapter 会让 turnRange 与最终位置对不上
      if (!this._chapterGenSuppressed) {
        await this.checkAndGenerateChapterSummary();
      }
    } catch (error) {
      // 异步期间发生了回滚，丢弃错误结果
      if (this._generationEpoch !== epochBefore) {
        console.log('[SummaryService] 总结生成期间发生了回滚，丢弃错误结果');
        itemEl.remove();
        return;
      }
      console.error('Summary generation failed:', error);
      this.flashErrorBorder();
      // 防御：itemEl 期间被外部 renderSummaries 摘掉了 → 挂回去
      if (!itemEl.parentNode && this.listEl) {
        this.listEl.appendChild(itemEl);
      }
      itemEl.classList.remove('loading');
      itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, '总结失败(点击重试)');
      // 绑定按键事件以支持重试
      this.bindItemEvents(itemEl, turnNumber);
      // 保存失败的记录(重试时通过 UID 从 chatHistory 重建内容)
      this.summaries.push({
        type: 'turn',
        uid: uid,
        turnNumber: turnNumber,
        text: null,
      });
      // 不增加 pendingTurnCount，失败的总结不参与章节合并
      // 失败记录也要落盘，否则 autoSaveGame 之后存档里看不到这轮的失败状态，
      // 重试入口（点失败条目）也无法在重新加载存档后恢复
      if (typeof window.autoSaveGame === 'function') window.autoSaveGame();
    }

    // 滚动到底部
    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  // 创建总结项的 HTML
  createSummaryItemHTML(turnNumber, summaryText) {
    // 转义 HTML 防止 XSS
    const escapedText = this.escapeHtml(summaryText);
    return (
      '<div class="summary-item-header">' +
      '<span class="summary-index">T' +
      turnNumber +
      '</span>' +
      '<div class="summary-actions">' +
      '<button class="btn-ghost btn-icon" data-action="summary-action-btn" data-summary-action="edit" title="编辑"><span class="icon icon-edit"></span></button>' +
      '<button class="btn-ghost btn-icon" data-action="summary-action-btn" data-summary-action="regenerate" title="重新生成"><span class="icon icon-regenerate"></span></button>' +
      '<button class="btn-danger btn-icon" data-action="summary-action-btn" data-summary-action="delete" title="删除"><span class="icon icon-delete"></span></button>' +
      '</div>' +
      '</div>' +
      '<span class="summary-text">' +
      escapedText +
      '</span>'
    );
  }

  // HTML 转义函数
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 网络抖动自动重试。针对 bug-0011 ("Summary Load failed" Safari 网络毛刺) 加的兜底,
  // 只重试网络类错误, 不重试用户取消/4xx 业务错误。指数退避 800ms / 1600ms。
  async _generateSummaryWithRetry(content, maxRetries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await aiService.generateSummary(content);
      } catch (err) {
        lastErr = err;
        const msg = String(err?.message || err || '');
        const isNetwork = /Load failed|NetworkError|Failed to fetch|network error/i.test(msg);
        if (!isNetwork || attempt === maxRetries) throw lastErr;
        const delay = 800 * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  // 绑定总结项的按键事件
  bindItemEvents(itemEl, turnNumber) {
    const editBtn = itemEl.querySelector('[data-summary-action="edit"]');
    const regenerateBtn = itemEl.querySelector('[data-summary-action="regenerate"]');
    const deleteBtn = itemEl.querySelector('[data-summary-action="delete"]');

    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.editTurn(turnNumber, itemEl);
      });
    }

    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.regenerateSingleTurn(turnNumber);
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.deleteTurn(turnNumber);
      });
    }
  }

  // 编辑单个 turn 的总结
  editTurn(turnNumber, itemEl) {
    const index = this.getTurnArrayIndex(turnNumber);
    if (index === -1) return;

    const summaryData = this.summaries[index];
    const textEl = itemEl.querySelector('.summary-text');
    const actionsEl = itemEl.querySelector('.summary-actions');

    if (!textEl) return;

    // 保存原始文本
    const originalText = summaryData.text || '';

    // 隐藏操作按键
    if (actionsEl) actionsEl.style.display = 'none';

    // 创建编辑界面
    const editContainer = document.createElement('div');
    editContainer.className = 'summary-edit-container';
    editContainer.innerHTML = `
            <textarea class="summary-edit-textarea"></textarea>
            <div class="summary-edit-buttons">
                <button class="summary-edit-save">保存</button>
                <button class="summary-edit-cancel">取消</button>
            </div>
        `;

    // 隐藏原文本，显示编辑框
    textEl.style.display = 'none';
    textEl.after(editContainer);

    // 使用 .value 设置内容（安全，不会有 HTML 注入风险）
    const textarea = editContainer.querySelector('.summary-edit-textarea');
    textarea.value = originalText;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // 保存按键
    editContainer.querySelector('.summary-edit-save').addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (newText) {
        // 更新数据
        this.summaries[index].text = newText;
        // 编辑可能让 text=null 的失败 turn 转为有效（应计入 pendingTurnCount），
        // 反之亦然。避免漂移，统一重算
        this._recalcPendingTurnCount();
        // 更新 UI
        textEl.textContent = newText;
        if (typeof window.autoSaveGame === 'function') window.autoSaveGame();
      }
      // 恢复显示
      textEl.style.display = '';
      if (actionsEl) actionsEl.style.display = '';
      editContainer.remove();
    });

    // 取消按键
    editContainer.querySelector('.summary-edit-cancel').addEventListener('click', () => {
      textEl.style.display = '';
      if (actionsEl) actionsEl.style.display = '';
      editContainer.remove();
    });
  }

  // 重新生成单个 turn 的总结
  async regenerateSingleTurn(turnNumber) {
    // 找到 turnNumber 对应的 summaries 数组索引
    const index = this.getTurnArrayIndex(turnNumber);
    if (index === -1) return;

    const summaryData = this.summaries[index];
    if (!summaryData || !summaryData.uid) {
      console.warn('No UID for regeneration');
      return;
    }

    // 从 chatHistory 重建原始内容
    const content = this._rebuildContentFromUID(summaryData.uid);
    if (!content) {
      console.warn('Cannot rebuild content from chatHistory for UID:', summaryData.uid);
      return;
    }

    // 找到对应的 DOM 元素
    const itemEl = this.listEl.querySelector(`.summary-item[data-turn="${turnNumber}"]`);
    if (!itemEl) return;

    // 显示加载状态
    itemEl.classList.add('loading');
    itemEl.innerHTML =
      '<div class="summary-item-header"><span class="summary-index">T' +
      turnNumber +
      '</span></div><span class="summary-text">重新生成中...</span>';

    const epochBefore = this._generationEpoch;

    try {
      const summary = await aiService.generateSummary(content);

      if (this._generationEpoch !== epochBefore) {
        console.log('[SummaryService] 单轮总结重新生成期间发生了回滚，丢弃结果');
        return;
      }

      // 更新数据
      this.summaries[index].text = summary;
      if (typeof window.autoSaveGame === 'function') window.autoSaveGame();

      // 更新 UI
      itemEl.classList.remove('loading');
      itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, summary);
      this.bindItemEvents(itemEl, turnNumber);
    } catch (error) {
      console.error('Regenerate summary failed:', error);
      this.flashErrorBorder();
      itemEl.classList.remove('loading');
      itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, '重新生成失败(点击重试)');
      this.bindItemEvents(itemEl, turnNumber);
    }
  }

  // 删除单个 turn 的总结
  deleteTurn(turnNumber) {
    // 找到 turnNumber 对应的 summaries 数组索引
    const arrayIndex = this.getTurnArrayIndex(turnNumber);
    if (arrayIndex === -1) return;

    // 检查是否是成功的总结（有有效文本）
    const deletedItem = this.summaries[arrayIndex];
    const wasSuccessful = deletedItem && deletedItem.text !== null;

    // 从数组中删除
    this.summaries.splice(arrayIndex, 1);

    // 只有成功的总结才计入 pendingTurnCount，所以只有删除成功的才减少
    if (wasSuccessful) {
      this.pendingTurnCount = Math.max(0, this.pendingTurnCount - 1);
    }

    // 从 DOM 中删除
    const itemEl = this.listEl.querySelector(`.summary-item[data-turn="${turnNumber}"]`);
    if (itemEl) {
      itemEl.remove();
    }

    // 重新编号后续的总结项
    this.renumberItems();

    // 如果没有剩余总结，显示空状态
    if (this.summaries.length === 0) {
      this.listEl.innerHTML = this.createEmptyStateHTML();
    }

    // 更新统计信息
    this.updateStats();
    if (typeof window.autoSaveGame === 'function') window.autoSaveGame();
  }

  // 按 UID 删除单条总结（供 deleteMessage 调用）
  removeSummaryByUID(uid) {
    const index = this.summaries.findIndex(s => s.uid === uid);
    if (index === -1) return;

    this.summaries.splice(index, 1);
    this._recalcPendingTurnCount();
    this.renderSummaries();
  }

  // 根据章节 DOM 元素动态找到它在 summaries 数组中的索引。
  // 旧设计在 summaryData 上存了 chapterNumber 字段并直接按字段查找，但删除/重排后该字段
  // 跟 DOM dataset.chapter 失同步（renderSummaries 用动态计数刷 DOM 但不写回数据），
  // 导致 editChapter/regenerateChapter/deleteChapter 找错对象。改成动态推算：
  // DOM 里第 N 个 .summary-chapter 对应 summaries 中第 N 个 type=chapter 的项
  _getChapterArrayIndexByEl(itemEl) {
    const allChapters = this.listEl?.querySelectorAll('.summary-chapter');
    if (!allChapters) return -1;
    let domPos = -1;
    for (let i = 0; i < allChapters.length; i++) {
      if (allChapters[i] === itemEl) {
        domPos = i;
        break;
      }
    }
    if (domPos === -1) return -1;
    let count = 0;
    for (let j = 0; j < this.summaries.length; j++) {
      if (this.summaries[j].type === 'chapter') {
        if (count === domPos) return j;
        count++;
      }
    }
    return -1;
  }

  // 根据 turnNumber 找到对应的 summaries 数组索引
  getTurnArrayIndex(turnNumber) {
    for (let i = 0; i < this.summaries.length; i++) {
      const item = this.summaries[i];
      if (item.type !== 'chapter' && item.turnNumber === turnNumber) {
        return i;
      }
    }
    return -1;
  }

  // 检查并生成章节总结（每 CHAPTER_SIZE 轮触发一次）
  // 触发后合并最早的 20 条 unmerged turn；如果合并后还 ≥ 20 继续合并下一组（用 setTimeout 避免栈深）。
  // 失败退避：失败后 _chapterRetryAfter 抬高一档，pendingTurnCount 长够了再重试，避免每个新 turn 都重发同一份失败请求
  async checkAndGenerateChapterSummary() {
    if (this.pendingTurnCount < SummaryService.CHAPTER_SIZE) return;
    if (this.pendingTurnCount < this._chapterRetryAfter) return;

    // 收集 valid（text 非空）的 turn，按数组顺序保留位置信息
    const turnsToMerge = [];
    for (const item of this.summaries) {
      if (item.type !== 'chapter' && item.text) {
        turnsToMerge.push({
          uid: item.uid,
          text: item.text,
          turnNumber: item.turnNumber,
        });
      }
    }

    // 取最早的 CHAPTER_SIZE 个：旧实现是 slice(-CHAPTER_SIZE) 取末尾 20，
    // 在 unmerged > 20 时最早的 N-20 永远不入章。改 slice(0, CHAPTER_SIZE) 配合末尾自递归
    const toMerge = turnsToMerge.slice(0, SummaryService.CHAPTER_SIZE);
    if (toMerge.length < SummaryService.CHAPTER_SIZE) return;

    // 删除前记录 toMerge[0] 当前所在的数组 index —— 这就是新 chapter 应该插入的位置
    const firstUid = toMerge[0].uid;
    const insertIndex = this.summaries.findIndex(s => s.uid === firstUid);
    if (insertIndex === -1) {
      console.warn('[SummaryService] toMerge[0] not found in summaries, abort chapter');
      return;
    }

    // UI 加载占位（DOM dataset.chapter 用动态序号 = 当前已有 chapter 数 + 1）
    const chapterDisplayNumber = this.summaries.filter(s => s.type === 'chapter').length + 1;
    const chapterEl = document.createElement('div');
    chapterEl.className = 'summary-item summary-chapter loading';
    chapterEl.dataset.chapter = chapterDisplayNumber;
    chapterEl.innerHTML = `<span class="summary-index">C${chapterDisplayNumber}</span><span class="summary-text">章节总结生成中...</span>`;

    const epochBefore = this._generationEpoch;

    try {
      const chapterSummary = await aiService.generateChapterSummary(toMerge.map(t => t.text));

      if (this._generationEpoch !== epochBefore) {
        console.log('[SummaryService] 章节总结生成期间发生了回滚，丢弃结果');
        return;
      }

      // 异步期间用户可能删了 turn / 编辑过 / 改过结构 —— 不能信任旧的 arrayIndex。
      // 按 uid 重新定位每条 toMerge 项的当前 idx，从大到小 splice 删（避免下标漂移）
      const idxToDelete = [];
      for (const item of toMerge) {
        const idx = this.summaries.findIndex(s => s.uid === item.uid);
        if (idx !== -1) idxToDelete.push(idx);
      }
      idxToDelete.sort((a, b) => b - a);
      for (const idx of idxToDelete) {
        this.summaries.splice(idx, 1);
      }

      // 重新定位 insertIndex：原 insertIndex 来自删除前的快照，删完后位置可能漂。
      // 实际上 insertIndex 是 toMerge[0] 之前的位置，前面被删的元素数 = 在 idxToDelete 中 < insertIndex 的数量
      const shift = idxToDelete.filter(i => i < insertIndex).length;
      const finalInsertIndex = insertIndex - shift;

      const firstRealTurn = toMerge[0].turnNumber;
      const lastRealTurn = toMerge[toMerge.length - 1].turnNumber;
      this.summaries.splice(finalInsertIndex, 0, {
        type: 'chapter',
        turnRange: [firstRealTurn, lastRealTurn],
        text: chapterSummary,
      });
      // 章节合并替换了 20 条 turn 记录，必须立刻落盘；
      // 否则刷新页面会把 chapter 丢回 20 条独立 turn（其实存档里那 20 条早就没了）
      if (typeof window.autoSaveGame === 'function') window.autoSaveGame();

      // 整体重渲：DOM 顺序与 summaries 数组同步，chapter 编号统一由 renderSummaries 动态生成
      this.renderSummaries();

      // 计数按实际剩余重算 —— 旧实现是 pendingTurnCount = 0 硬复位，
      // 与 unmerged > 20 时的剩余条数失同步，导致后续不会再触发合并
      this._recalcPendingTurnCount();

      // 成功后清失败退避标记
      this._chapterRetryAfter = 0;

      console.log(`Chapter C${chapterDisplayNumber} generated successfully (${firstRealTurn}-${lastRealTurn})`);

      // 自递归：如果还有 ≥ 20 条 unmerged，继续合并下一组（用 setTimeout 避免栈深 + 让浏览器喘口气）。
      // 调度时再次检查 _chapterGenSuppressed —— 如果用户期间又点了"一键修复"，
      // suppressed 会变 true，递归调用要跳过避免与新 audit fix 并发改 summaries
      if (this.pendingTurnCount >= SummaryService.CHAPTER_SIZE) {
        setTimeout(() => {
          if (!this._chapterGenSuppressed) this.checkAndGenerateChapterSummary();
        }, 0);
      }
    } catch (error) {
      console.error('Chapter summary generation failed:', error);
      this.flashErrorBorder();
      // 失败退避：要等 pendingTurnCount 再涨 N 才重试。
      // 否则恒定失败时（如 prompt 太长），每个新 turn 都会重发一次失败请求
      this._chapterRetryAfter = this.pendingTurnCount + 2;
    }
  }

  // 创建章节总结项的 HTML
  createChapterItemHTML(chapterNumber, summaryText) {
    const escapedText = this.escapeHtml(summaryText);
    return (
      '<div class="summary-item-header">' +
      '<span class="summary-index summary-chapter-index">C' +
      chapterNumber +
      '</span>' +
      '<div class="summary-actions">' +
      '<button class="" data-action="summary-action-btn edit-chapter-btn" title="编辑"><span class="icon icon-edit"></span></button>' +
      '<button class="" data-action="summary-action-btn regenerate-chapter-btn" title="重新生成章节"><span class="icon icon-regenerate"></span></button>' +
      // 删除按钮已移除：用户主动删 chapter 会让对应 20 条 turn 永久丢失（现行 deleteChapter 不还原 turn）。
      // 为避免误删整段历史，UI 入口禁用；deleteChapter 函数本体保留作为内部 API 兜底
      '</div>' +
      '</div>' +
      '<span class="summary-text">' +
      escapedText +
      '</span>'
    );
  }

  // 绑定章节总结的按键事件
  // 不再传 chapterNumber 参数 —— 回调内部通过 itemEl 在 DOM 中的位置动态查 arrayIndex
  bindChapterEvents(itemEl) {
    const editBtn = itemEl.querySelector('[data-action~="edit-chapter-btn"]');
    const regenerateBtn = itemEl.querySelector('[data-action~="regenerate-chapter-btn"]');
    // delete-chapter 按钮已从 createChapterItemHTML 移除（用户决定禁用此入口），
    // 此处不再绑定；deleteChapter 函数本体保留作为内部 API

    if (editBtn) {
      editBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.editChapter(itemEl);
      });
    }

    if (regenerateBtn) {
      regenerateBtn.addEventListener('click', e => {
        e.stopPropagation();
        this.regenerateChapter(itemEl);
      });
    }
  }

  // 编辑章节总结
  editChapter(itemEl) {
    const index = this._getChapterArrayIndexByEl(itemEl);
    if (index === -1) return;

    const summaryData = this.summaries[index];
    const textEl = itemEl.querySelector('.summary-text');
    const actionsEl = itemEl.querySelector('.summary-actions');

    if (!textEl) return;

    // 保存原始文本
    const originalText = summaryData.text || '';

    // 隐藏操作按键
    if (actionsEl) actionsEl.style.display = 'none';

    // 创建编辑界面
    const editContainer = document.createElement('div');
    editContainer.className = 'summary-edit-container';
    editContainer.innerHTML = `
            <textarea class="summary-edit-textarea"></textarea>
            <div class="summary-edit-buttons">
                <button class="summary-edit-save">保存</button>
                <button class="summary-edit-cancel">取消</button>
            </div>
        `;

    // 隐藏原文本，显示编辑框
    textEl.style.display = 'none';
    textEl.after(editContainer);

    // 使用 .value 设置内容（安全，不会有 HTML 注入风险）
    const textarea = editContainer.querySelector('.summary-edit-textarea');
    textarea.value = originalText;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    // 保存按键
    editContainer.querySelector('.summary-edit-save').addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (newText) {
        // 更新数据
        this.summaries[index].text = newText;
        // 更新 UI
        textEl.textContent = newText;
        if (typeof window.autoSaveGame === 'function') window.autoSaveGame();
      }
      // 恢复显示
      textEl.style.display = '';
      if (actionsEl) actionsEl.style.display = '';
      editContainer.remove();
    });

    // 取消按键
    editContainer.querySelector('.summary-edit-cancel').addEventListener('click', () => {
      textEl.style.display = '';
      if (actionsEl) actionsEl.style.display = '';
      editContainer.remove();
    });
  }

  // 重新生成章节总结。
  // 旧实现：用 chapterData.text 做 prompt（二次精炼现成总结），信息越压越糊。
  // 新实现：按 turnRange 从 chatHistory 拉范围内的原始 AI 消息，重建每条的 [状态]+[剧情]，
  //   重新跑 aiService.generateChapterSummary。chatHistory 找不到时（消息被删了）退化到旧二次精炼路径
  async regenerateChapter(itemEl) {
    const index = this._getChapterArrayIndexByEl(itemEl);
    if (index === -1) return;
    const chapterData = this.summaries[index];
    if (!chapterData.turnRange) {
      console.warn('[SummaryService] No turn range for chapter regeneration');
      return;
    }
    const [firstTurn, lastTurn] = chapterData.turnRange;

    // 显示编号 = DOM 中此 itemEl 在所有 chapter 元素里的位置 + 1
    const allChapterEls = this.listEl.querySelectorAll('.summary-chapter');
    const displayNumber = Array.from(allChapterEls).indexOf(itemEl) + 1;

    itemEl.classList.add('loading');
    itemEl.innerHTML =
      '<div class="summary-item-header"><span class="summary-index summary-chapter-index">C' +
      displayNumber +
      '</span></div><span class="summary-text">重新生成中...</span>';

    const epochBefore = this._generationEpoch;

    try {
      // 从 chatHistory 拉 turnRange 内的原始 AI 消息
      const chat = this._getActiveChatHistory();
      const turnTexts = [];
      for (const msg of chat) {
        if (!msg || msg.sender !== 'ai' || !msg.uid) continue;
        if (msg.isError || msg.isCancelled) continue;
        const turnNumber = this.parseTurnNumberFromUID(msg.uid);
        if (!Number.isFinite(turnNumber)) continue;
        if (turnNumber < firstTurn || turnNumber > lastTurn) continue;
        const content = this._rebuildContentFromUID(msg.uid);
        if (content) turnTexts.push(content);
      }

      let newSummary;
      if (turnTexts.length > 0) {
        newSummary = await aiService.generateChapterSummary(turnTexts);
      } else {
        // 边界：chatHistory 内 turnRange 里一条原始消息都拉不到 —— 可能用户手动删了那段消息
        // 退化为旧的"二次精炼 chapterData.text"。打 warn 但不阻塞用户
        console.warn(
          `[SummaryService] regenerateChapter: turnRange [${firstTurn},${lastTurn}] 没有可用的 chatHistory 内容，回退到二次精炼模式`
        );
        const prompt = `请基于以下章节总结，重新生成一个更简洁精炼的版本：\n\n${chapterData.text}`;
        newSummary = await aiService.generateSummary(prompt);
      }

      if (this._generationEpoch !== epochBefore) {
        console.log('[SummaryService] 章节总结重新生成期间发生了回滚，丢弃结果');
        return;
      }

      // 异步期间 summaries 可能被并发修改，按 itemEl 重新查
      const currentIndex = this._getChapterArrayIndexByEl(itemEl);
      if (currentIndex === -1) {
        console.warn('[SummaryService] chapter itemEl 已脱离 DOM，丢弃重生成结果');
        return;
      }
      this.summaries[currentIndex].text = newSummary;
      if (typeof window.autoSaveGame === 'function') window.autoSaveGame();

      itemEl.classList.remove('loading');
      itemEl.innerHTML = this.createChapterItemHTML(displayNumber, newSummary);
      this.bindChapterEvents(itemEl);
    } catch (error) {
      console.error('Regenerate chapter failed:', error);
      this.flashErrorBorder();
      itemEl.classList.remove('loading');
      itemEl.innerHTML = this.createChapterItemHTML(
        displayNumber,
        chapterData.text || '重新生成失败'
      );
      this.bindChapterEvents(itemEl);
    }
  }

  // 删除章节总结（内部 API；UI 入口已禁用，避免用户误删整段历史）。
  // 接收 itemEl，按 DOM 位置动态查 arrayIndex
  deleteChapter(itemEl) {
    const index = this._getChapterArrayIndexByEl(itemEl);
    if (index === -1) return;

    this.summaries.splice(index, 1);
    if (itemEl?.parentNode) itemEl.remove();

    if (this.summaries.length === 0) {
      this.listEl.innerHTML = this.createEmptyStateHTML();
    } else {
      // 整体重渲：chapter 编号靠动态计数，不需要 renumberItems 单独刷
      this.renderSummaries();
    }

    this.updateStats();
    if (typeof window.autoSaveGame === 'function') window.autoSaveGame();
  }

  // 重新编号所有总结项(仅重新编号章节，turn 保持真实编号)
  renumberItems() {
    const items = this.listEl.querySelectorAll('.summary-item');
    let chapterCounter = 1;
    let summaryIndex = 0; // 用于遍历 summaries 数组

    items.forEach(item => {
      const indexEl = item.querySelector('.summary-index');
      if (item.classList.contains('summary-chapter')) {
        // 章节总结:重新编号
        item.dataset.chapter = chapterCounter;
        if (indexEl) {
          indexEl.textContent = `C${chapterCounter}`;
        }
        chapterCounter++;
        summaryIndex++;
      } else {
        // 单轮总结:使用保存的真实 turnNumber
        const summaryData = this.summaries[summaryIndex];
        if (summaryData && summaryData.turnNumber) {
          item.dataset.turn = summaryData.turnNumber;
          if (indexEl) {
            indexEl.textContent = `T${summaryData.turnNumber}`;
          }
        }
        summaryIndex++;
      }
    });
  }

  // 清空所有总结(重置游戏时调用)
  clear() {
    this._generationEpoch++;
    this.summaries = [];
    this.pendingTurnCount = 0;
    if (this.listEl) {
      this.listEl.innerHTML = this.createEmptyStateHTML();
    }
    this.updateStats();
    // 清空时也关掉旧 audit banner（新游戏 / 切换世界卡时上一份的提示要消掉）
    this._auditResult = null;
    if (this._auditBannerEl) this._auditBannerEl.hidden = true;
  }

  // 创建空状态 HTML
  createEmptyStateHTML() {
    return `
            <div class="summary-empty">
                <div class="summary-empty-icon">📖</div>
                <div class="summary-empty-text">
                    开始冒险后<br>这里会显示每次剧情的总结
                </div>
            </div>
        `;
  }

  // 更新统计信息
  updateStats() {
    const chaptersEl = document.getElementById('stat-chapters');
    const turnsEl = document.getElementById('stat-turns');
    if (!chaptersEl && !turnsEl) return;

    const chapters = this.summaries.filter(s => s.type === 'chapter').length;
    const turns = this.summaries.filter(s => s.type === 'turn' || !s.type).length;

    if (chaptersEl) chaptersEl.textContent = String(chapters);
    if (turnsEl) turnsEl.textContent = String(turns);
  }

  // 从存档恢复总结
  restore(savedSummaries) {
    // 先清空
    this.clear();

    if (!savedSummaries || !Array.isArray(savedSummaries) || savedSummaries.length === 0) {
      this.updateStats();
      // 即便存档里 summaries 为空，也要审计 chatHistory ——
      // race condition 时代的旧存档典型形态就是 summaries=[]，
      // 但 chat 已有多个 turn，不在这里跑 audit 就永远不会弹 banner
      this._auditAndRenderBanner();
      return;
    }

    // 清空空状态提示
    const emptyEl = this.listEl.querySelector('.summary-empty');
    if (emptyEl) {
      emptyEl.remove();
    }

    // 恢复每个总结(支持混合的章节和单轮总结)
    let chapterCounter = 1;

    savedSummaries.forEach(summaryData => {
      const itemEl = document.createElement('div');

      if (summaryData.type === 'chapter') {
        // 恢复章节总结。chapterCounter 仅用于 DOM 显示（CN 标签和 dataset），
        // 不写回 summaryData.chapterNumber —— 该字段已废弃，所有内部查找走 _getChapterArrayIndexByEl
        itemEl.className = 'summary-item summary-chapter';
        itemEl.dataset.chapter = chapterCounter;
        itemEl.innerHTML = this.createChapterItemHTML(chapterCounter, summaryData.text);
        // 绑定章节事件（不再传 chapterNumber，回调内部按 itemEl 动态查 arrayIndex）
        this.bindChapterEvents(itemEl);
        chapterCounter++;
      } else {
        // 恢复单轮总结
        let turnNumber = summaryData.turnNumber;
        if (!turnNumber && summaryData.uid) {
          turnNumber = this.parseTurnNumberFromUID(summaryData.uid);
        }

        itemEl.className = 'summary-item';
        itemEl.dataset.turn = turnNumber;
        if (summaryData.uid) {
          itemEl.dataset.uid = summaryData.uid;
        }

        if (summaryData.text) {
          itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, summaryData.text);
          this.bindItemEvents(itemEl, turnNumber);
        } else {
          itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, '总结失败(点击重试)');
          this.bindItemEvents(itemEl, turnNumber);
        }

        // 确保 summaryData 也有 turnNumber(用于后续操作)
        if (!summaryData.turnNumber) {
          summaryData.turnNumber = turnNumber;
        }

        if (summaryData.text !== null) {
          this.pendingTurnCount++; // 恢复待合并计数（仅成功的总结）
        }
      }

      this.listEl.appendChild(itemEl);
      this.summaries.push(summaryData);
    });

    // 更新统计信息
    this.updateStats();

    // 旧存档可能存在 race condition 留下的损坏：缺失 / 重复 / 孤儿
    // 扫描并在面板顶部弹 banner 提示，由用户点"一键修复"补救
    this._auditAndRenderBanner();
  }

  // ============================================
  // 存档总结健康度审计与一键修复
  // ============================================
  // 三类异常：
  //   missing   —— chatHistory 里有 turn_N_*（N>=1）但 summaries 没对应 uid
  //   duplicate —— summaries 同一 uid 出现多次
  //   orphan    —— summaries 里的 uid 在 chatHistory 找不到对应 AI 消息

  _collectAuditResult() {
    // 世界卡下 window.chatHistory 指向 designChatHistory，游戏 chat 在 _gameChatHistory；
    // 不挑对会把整套游戏 summary 误判成 orphan，一键修复将清空它们 —— 数据丢失风险
    const chat = this._getActiveChatHistory();

    // 1. chatHistory 里"应当有 summary"的 AI 轮（uid=turn_N_*, N>=1, 非 error/cancelled）
    const chatTurns = new Map(); // uid -> aiMsg
    for (const msg of chat) {
      if (!msg || msg.sender !== 'ai' || !msg.uid) continue;
      if (msg.isError || msg.isCancelled) continue;
      const turnNumber = this.parseTurnNumberFromUID(msg.uid);
      if (!Number.isFinite(turnNumber) || turnNumber < 1) continue;
      chatTurns.set(msg.uid, msg);
    }

    // 2. summaries 里所有 turn 条目（按 uid 分组下标，捕获重复）
    const summaryUidMap = new Map(); // uid -> indices[]
    this.summaries.forEach((s, idx) => {
      if (s.type === 'chapter' || !s.uid) return;
      if (!summaryUidMap.has(s.uid)) summaryUidMap.set(s.uid, []);
      summaryUidMap.get(s.uid).push(idx);
    });

    // 3. 四类比对
    const missing = [];
    for (const [uid, aiMsg] of chatTurns) {
      if (!summaryUidMap.has(uid)) {
        const turnNumber = this.parseTurnNumberFromUID(uid);
        missing.push({ uid, turnNumber, aiMsg });
      }
    }
    missing.sort((a, b) => a.turnNumber - b.turnNumber);

    const duplicate = [];
    for (const [uid, indices] of summaryUidMap) {
      if (indices.length > 1) duplicate.push(uid);
    }

    const orphan = [];
    for (const uid of summaryUidMap.keys()) {
      if (!chatTurns.has(uid)) orphan.push(uid);
    }

    // failed: chat 里 uid 仍在、但 summaries 中所有同 uid 条目都是 text:null（之前补全失败留下的占位）
    // 这类不算缺失（uid 存在），但需要被一键修复重新尝试 —— 否则用户中途 API 没钱后，
    // 占位永远卡在那里，不会被任何后续审计算入待修复
    const failed = [];
    for (const [uid, indices] of summaryUidMap) {
      if (!chatTurns.has(uid)) continue; // chatHistory 里没了 → 已经在 orphan 里
      const allFailed = indices.every(i => this.summaries[i].text === null);
      if (allFailed) {
        const turnNumber = this.parseTurnNumberFromUID(uid);
        failed.push({ uid, turnNumber, aiMsg: chatTurns.get(uid) });
      }
    }
    failed.sort((a, b) => a.turnNumber - b.turnNumber);

    // 4. 排序健康度：检查 summaries 数组每对相邻项的语义顺序。
    //   - chapter→chapter 应该 prev.turnRange[1] < next.turnRange[0]
    //   - chapter→turn 应该 turn.turnNumber > chapter.turnRange[1]
    //   - turn→chapter 应该 turn.turnNumber < chapter.turnRange[0]
    //   - turn→turn 应该 prev.turnNumber < next.turnNumber 严格升序
    // 任一边的 turnRange / turnNumber 缺失就跳过该对（老 chapter 没 turnRange 时不算异常）。
    // ordering 类（不含 chapter-chapter）由 _runAuditFix Step D 的 _reorderSummariesByChapterAnchors 自动修；
    // chapterOverlap 类（chapter 自身 turnRange 重叠）一键修复无法处理 —— 重排不改 chapter 位置，
    // 内容融合需要 LLM 重总结，超出 Step C 的范围 —— 只在 banner 提示用户人工处理
    const { ordering, chapterOverlap } = this._verifyOrdering();

    return {
      missing,
      duplicate,
      orphan,
      failed,
      ordering,
      chapterOverlap,
      total:
        missing.length +
        duplicate.length +
        orphan.length +
        failed.length +
        ordering.length +
        chapterOverlap.length,
    };
  }

  // 排序自检：扫 summaries 相邻项，返回所有违反顺序的位置描述。
  // 拆分两类：
  //   - ordering: 涉及 turn 的位置错乱，Step D 的重排能自动修
  //   - chapterOverlap: 两 chapter 自身 turnRange 重叠，一键修复修不了（chapter 顺序不动），
  //     单独标记让 banner 用不同措辞告知用户
  _verifyOrdering() {
    const ordering = [];
    const chapterOverlap = [];
    for (let i = 0; i < this.summaries.length - 1; i++) {
      const prev = this.summaries[i];
      const next = this.summaries[i + 1];
      const prevIsCh = prev.type === 'chapter';
      const nextIsCh = next.type === 'chapter';

      if (prevIsCh && nextIsCh) {
        const prevHi = prev.turnRange?.[1];
        const nextLo = next.turnRange?.[0];
        if (Number.isFinite(prevHi) && Number.isFinite(nextLo) && prevHi >= nextLo) {
          chapterOverlap.push(`相邻 chapter 区间重叠（${prev.turnRange[0]}-${prevHi} vs ${nextLo}-${next.turnRange[1]}）`);
        }
      } else if (prevIsCh && !nextIsCh) {
        const prevHi = prev.turnRange?.[1];
        if (Number.isFinite(prevHi) && Number.isFinite(next.turnNumber) && next.turnNumber <= prevHi) {
          ordering.push(`T${next.turnNumber} 落在前 chapter（覆盖到 ${prevHi}）后面但编号倒挂`);
        }
      } else if (!prevIsCh && nextIsCh) {
        const nextLo = next.turnRange?.[0];
        if (Number.isFinite(nextLo) && Number.isFinite(prev.turnNumber) && prev.turnNumber >= nextLo) {
          ordering.push(`T${prev.turnNumber} 编号已进入后 chapter 区间（从 ${nextLo} 开始）`);
        }
      } else {
        if (Number.isFinite(prev.turnNumber) && Number.isFinite(next.turnNumber) && prev.turnNumber >= next.turnNumber) {
          ordering.push(`T${prev.turnNumber} 紧跟 T${next.turnNumber}（顺序错乱）`);
        }
      }
    }
    return { ordering, chapterOverlap };
  }

  _ensureAuditBannerInjected() {
    if (this._auditBannerEl && this._auditBannerEl.isConnected) return this._auditBannerEl;
    if (!this.tileEl) return null;

    const banner = document.createElement('div');
    banner.id = 'summary-audit-banner';
    banner.className = 'summary-audit-banner';
    banner.hidden = true;
    banner.innerHTML =
      '<div data-state="idle" hidden>' +
      '<strong>⚠️ 似乎你的存档总结有一些损坏</strong>' +
      '<p class="summary-audit-banner-detail"></p>' +
      '<p class="summary-audit-banner-abort" hidden></p>' +
      '<button class="primary-btn btn-sm" data-action="summary-audit-fix">一键修复</button>' +
      '</div>' +
      '<div data-state="fixing" hidden>' +
      '<strong>⏳ 正在修复中，期间可正常游玩不影响</strong>' +
      '<div class="summary-audit-progress-row">' +
      '<progress class="summary-audit-progress" value="0" max="1"></progress>' +
      '<span class="summary-audit-progress-text">0 / 0</span>' +
      '</div>' +
      '</div>';

    // 插到 #summary-tile 第一个子节点之前（stats-bar 之上）
    this.tileEl.insertBefore(banner, this.tileEl.firstChild);

    banner.querySelector('[data-action="summary-audit-fix"]').addEventListener('click', () => {
      this._runAuditFix();
    });

    this._auditBannerEl = banner;
    return banner;
  }

  _renderAuditBanner(mode) {
    // mode: 'hidden' | 'idle' | 'fixing'
    const banner = this._ensureAuditBannerInjected();
    if (!banner) return;

    if (mode === 'hidden') {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;

    const idleEl = banner.querySelector('[data-state="idle"]');
    const fixingEl = banner.querySelector('[data-state="fixing"]');

    if (mode === 'idle') {
      idleEl.hidden = false;
      fixingEl.hidden = true;

      const audit = this._auditResult || {
        missing: [],
        duplicate: [],
        orphan: [],
        failed: [],
        ordering: [],
        chapterOverlap: [],
      };
      const parts = [];
      if (audit.missing.length) parts.push(`${audit.missing.length} 条缺失`);
      if (audit.failed?.length) parts.push(`${audit.failed.length} 条失败待补`);
      if (audit.duplicate.length) parts.push(`${audit.duplicate.length} 条重复`);
      if (audit.orphan.length) parts.push(`${audit.orphan.length} 条孤儿`);
      if (audit.ordering?.length) parts.push(`${audit.ordering.length} 条排序错乱`);
      if (audit.chapterOverlap?.length)
        parts.push(`${audit.chapterOverlap.length} 条章节区间重叠（需人工删除重复章节）`);
      banner.querySelector('.summary-audit-banner-detail').textContent = parts.join(' · ');

      const abortEl = banner.querySelector('.summary-audit-banner-abort');
      if (this._lastAbortReason) {
        abortEl.textContent = this._lastAbortReason;
        abortEl.hidden = false;
      } else {
        abortEl.textContent = '';
        abortEl.hidden = true;
      }
    } else if (mode === 'fixing') {
      idleEl.hidden = true;
      fixingEl.hidden = false;
    }
  }

  _auditAndRenderBanner() {
    this._auditResult = this._collectAuditResult();
    this._renderAuditBanner(this._auditResult.total === 0 ? 'hidden' : 'idle');
  }

  async _runAuditFix() {
    if (this._auditFixRunning) return;
    this._auditFixRunning = true;
    // 修复期间暂停 chapter 自动生成 —— Step C 内串行 summarize() 会让 pendingTurnCount 攀过阈值，
    // 若此时触发 chapter 合并，turnRange 是按"乱序状态下的末尾 20 条"算的，跟 Step D 排序后位置对不上
    this._chapterGenSuppressed = true;

    // 整个流程包在 try-finally 里：前置代码（_collectAuditResult / _getActiveChatHistory）
    // 抛异常时也能确保 _auditFixRunning / _chapterGenSuppressed 复位，避免 service 永久卡死
    try {
      // 始终重新审计 —— 用户在 banner 出现后可能做过 rollback / regenerate / delete，
      // 缓存的 _auditResult 会过期，对过期数据做修复会引入新的孤儿
      const audit = this._collectAuditResult();
      this._auditResult = audit;
      const banner = this._ensureAuditBannerInjected();
      const progressBar = banner?.querySelector('.summary-audit-progress');
      const progressText = banner?.querySelector('.summary-audit-progress-text');

      // 本次开始时清掉上次的熔断提示
      this._lastAbortReason = '';

      // 安全护栏：拒绝在"看起来像 chat 还没加载完"的状态下做修复
      //   - 全清场景：chat 里一条 ai turn 都没有，但 summaries 数组有 turn → race，
      //     此时 orphan 检测会把所有 summary 算成 orphan 然后清空 → 数据全丢
      //   - 半清场景：orphan 占非 chapter summary 总数 ≥ 50% 且 orphan ≥ 5 → 数据可疑
      // 拦下后让用户自己刷新页面 / 切回正确世界卡再决定
      const turnSummaryCount = this.summaries.filter(s => s.type !== 'chapter' && s.uid).length;
      const chat = this._getActiveChatHistory();
      const chatHasAnyTurn = chat.some(
        m => m && m.sender === 'ai' && m.uid && !m.isError && !m.isCancelled
      );
      const orphanRatio = turnSummaryCount > 0 ? audit.orphan.length / turnSummaryCount : 0;
      const looksLikeRace =
        (turnSummaryCount > 0 && !chatHasAnyTurn) ||
        (audit.orphan.length >= 5 && orphanRatio >= 0.5);
      if (looksLikeRace) {
        console.warn('[SummaryAudit] 拒绝修复：chat 状态可疑', {
          turnSummaryCount,
          chatHasAnyTurn,
          orphan: audit.orphan.length,
          orphanRatio,
        });
        this._lastAbortReason = `已拒绝修复：检测到 ${audit.orphan.length} 条总结在当前对话历史里找不到对应回合（${Math.round(orphanRatio * 100)}%），可能是页面未加载完毕或选错了世界卡。请刷新页面或切回原世界卡后重试，避免数据丢失。`;
        this._renderAuditBanner('idle');
        return; // finally 会重置 flag
      }

      // missing + failed 都需要走一次 summarize 来补 —— 合并去重，按 turnNumber 排序
      const toGenerateMap = new Map();
      for (const item of audit.missing) toGenerateMap.set(item.uid, item);
      for (const item of audit.failed) {
        if (!toGenerateMap.has(item.uid)) toGenerateMap.set(item.uid, item);
      }
      const toGenerate = [...toGenerateMap.values()].sort((a, b) => a.turnNumber - b.turnNumber);

      // Step 0: banner 切 fixing
      if (progressBar) {
        progressBar.max = Math.max(toGenerate.length, 1);
        progressBar.value = 0;
      }
      if (progressText) progressText.textContent = `0 / ${toGenerate.length}`;
      this._renderAuditBanner('fixing');

      // Step A & B: 同步处理 duplicate / orphan / failed 占位
      // 重新构建 uid → indices 映射（复用一份，省得重算两次）
      const summaryUidMap = new Map();
      this.summaries.forEach((s, idx) => {
        if (s.type === 'chapter' || !s.uid) return;
        if (!summaryUidMap.has(s.uid)) summaryUidMap.set(s.uid, []);
        summaryUidMap.get(s.uid).push(idx);
      });

      const indicesToDelete = new Set();
      // duplicate: 保留 text 非 null 的最早一条；都失败就保留最早
      for (const uid of audit.duplicate) {
        const indices = summaryUidMap.get(uid) || [];
        let keepIdx = indices.find(i => this.summaries[i].text !== null);
        if (keepIdx === undefined) keepIdx = indices[0];
        for (const idx of indices) {
          if (idx !== keepIdx) indicesToDelete.add(idx);
        }
      }
      // orphan: 全删
      for (const uid of audit.orphan) {
        const indices = summaryUidMap.get(uid) || [];
        for (const idx of indices) indicesToDelete.add(idx);
      }
      // failed: 删占位让 Step C 干净重补（否则 Step C 的 push 会跟它撞成 duplicate）
      for (const item of audit.failed) {
        const indices = summaryUidMap.get(item.uid) || [];
        for (const idx of indices) {
          if (this.summaries[idx]?.text === null) indicesToDelete.add(idx);
        }
      }
      // 数组+DOM 同步删除：DOM 不删的话，Step C 的 summarize append 新 itemEl 后，
      // 用户会同时看到旧"总结失败"和新"总结中..."两行，错乱。Step D 末尾 renderSummaries
      // 虽会重建，但中途用户已经看了几分钟双份 itemEl
      const sortedDelete = [...indicesToDelete].sort((a, b) => b - a);
      const deletedUids = new Set();
      for (const idx of sortedDelete) {
        const item = this.summaries[idx];
        if (item?.uid) deletedUids.add(item.uid);
        this.summaries.splice(idx, 1);
      }
      for (const uid of deletedUids) {
        const itemEl = this.listEl?.querySelector(`.summary-item[data-uid="${uid}"]`);
        if (itemEl) itemEl.remove();
      }

      // Step C: 串行补 missing + failed —— 失败兜底，永远不卡循环
      // summarize() 内部会自己创建 loading itemEl 并 append（见 summarize 内 L168-176），
      // 不需要再额外注入 placeholder，否则同一 turn 会在 DOM 里出现两条 loading 行
      //
      // 熔断：连续失败 N 次自动暂停。常见触发场景是 API 余额耗尽 / key 失效 / 网络断 ——
      // 这种状态下继续往下刷只会把所有 turn 都变成新的 text:null 占位（用户截图里的惨状）
      //
      // Epoch 检查：修复期间用户可能 rollback / 载入存档 / 切世界卡 / 重置游戏，
      // 这些都会让 _generationEpoch 递增。一旦 epoch 变，summaries 数组已是新状态，
      // 继续 push fallback 占位会污染新数据 —— 必须立即放弃后续步骤
      const fixEpoch = this._generationEpoch;
      let done = 0;
      let consecutiveFails = 0;
      const MAX_CONSECUTIVE_FAILS = 3;
      let abortIndex = -1;
      let epochInvalidated = false;
      for (let i = 0; i < toGenerate.length; i++) {
        if (this._generationEpoch !== fixEpoch) {
          epochInvalidated = true;
          break;
        }
        const item = toGenerate[i];
        let succeeded = false;
        try {
          await this.summarize(
            item.aiMsg.text,
            item.uid,
            item.aiMsg.gameData?.panel_narrative ?? item.aiMsg.text,
            item.aiMsg.gameData
          );
          // await 期间 epoch 可能变 —— summarize 内部已丢弃结果，但 fallback 在外面
          if (this._generationEpoch !== fixEpoch) {
            epochInvalidated = true;
            break;
          }
          // 验证是否真补上（summarize 失败时内部 catch 会 push text:null，不算成功）
          succeeded = this.summaries.some(s => s.uid === item.uid && s.text !== null);
        } catch (e) {
          console.error('[SummaryAudit] summarize threw for', item.uid, e);
          if (this._generationEpoch !== fixEpoch) {
            epochInvalidated = true;
            break;
          }
        }
        // 失败兜底：按 uid 检查这条是否真的进了 summaries（不能用 length 比对 ——
        // 修复期间用户可能打新回合，新回合的 summarize 也会 push，造成长度变化误导）
        // summarize 内部 catch 会 push {text:null}；但"空内容早返回"或 try 前 throw
        // 既不 push 也不抛，会留下幽灵进度。此处显式补齐失败记录
        if (!this.summaries.some(s => s.uid === item.uid)) {
          this.summaries.push({
            type: 'turn',
            uid: item.uid,
            turnNumber: item.turnNumber,
            text: null,
          });
        }
        done++;
        if (progressBar) progressBar.value = done;
        if (progressText) progressText.textContent = `${done} / ${toGenerate.length}`;

        if (succeeded) {
          consecutiveFails = 0;
        } else {
          consecutiveFails++;
          if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
            abortIndex = i;
            break;
          }
        }
      }

      // Epoch 失效 → summaries 已被外部覆盖，不能跑 Step D（renderSummaries 会刷掉新状态）
      // 也不能 autoSave（会用旧逻辑覆盖新状态）。直接 return，让触发 epoch 变化的那个动作
      // (restore / truncateAfterUID / clear) 自己负责后续 banner 状态
      if (epochInvalidated) {
        console.log('[SummaryAudit] epoch 失效（rollback / 载入 / 切世界卡），中止后续步骤');
        // truncateAfterUID 不会自动刷 banner，但它改了 summaries —— 重新审计一次让 banner 同步
        this._auditAndRenderBanner();
        return;
      }

      if (abortIndex !== -1) {
        const remaining = toGenerate.length - done;
        this._lastAbortReason = `连续失败 ${MAX_CONSECUTIVE_FAILS} 次已自动暂停（剩 ${remaining} 条未补）。请检查 API 余额/网络后再次点击修复。`;
      }

      // Step D: chapter 顺序保持原数组中的相对位置（生成时间序，可信），
      // 只把 turn 按 turnNumber 归位到正确的 chapter 区间之间。
      // 老版本生成的 chapter 可能没 turnRange —— 不能用 turnRange 当排序键，否则
      // 会全部沉到数组开头，把后补的 turn 卡到 chapter 之间（曾出现过的 c24/c25 + T119-122 现象）
      this.summaries = this._reorderSummariesByChapterAnchors(this.summaries);

      this.renderSummaries();
      this._recalcPendingTurnCount();
      if (typeof window.autoSaveGame === 'function') window.autoSaveGame();

      // Step E: 排序到位后解除 chapter 暂停，按"合并最早 20 + 循环"补齐落下的章节。
      //   - Step C 期间 suppressed，可能积累了大量 pending turn
      //   - 这里 await 直到 pendingTurnCount < CHAPTER_SIZE
      // 熔断退出时跳过：剩余 turn 还是 text:null，硬合 chapter 会让缺失内容被锁进章节
      this._chapterGenSuppressed = false;
      if (abortIndex === -1) {
        await this.checkAndGenerateChapterSummary();
      }

      // Step F: 复检 + banner 复位
      this._auditAndRenderBanner();
    } catch (e) {
      console.error('[SummaryAudit] _runAuditFix unexpected error:', e);
      this._renderAuditBanner('idle');
    } finally {
      this._chapterGenSuppressed = false;
      this._auditFixRunning = false;
    }
  }

  // 截断到指定 turn(删除该 turn 及之后的所有总结)
  truncateToTurn(turnNumber) {
    this._generationEpoch++;

    // 找到该 turnNumber 对应的数组索引
    const arrayIndex = this.getTurnArrayIndex(turnNumber);
    if (arrayIndex === -1) return;

    // 保留该索引之前的所有内容
    this.summaries = this.summaries.slice(0, arrayIndex);

    // 重新计算 pendingTurnCount
    this._recalcPendingTurnCount();

    // 更新 UI - 删除对应的 DOM 元素
    // 删除所有 turnNumber >= 指定值的 turn 元素
    const turnEls = this.listEl.querySelectorAll('.summary-item:not(.summary-chapter)');
    turnEls.forEach(el => {
      const elTurn = parseInt(el.dataset.turn, 10);
      if (elTurn >= turnNumber) {
        el.remove();
      }
    });

    // 重新编号
    this.renumberItems();

    // 如果没有剩余总结，显示空状态
    if (this.summaries.length === 0 && !this.listEl.querySelector('.summary-empty')) {
      this.listEl.innerHTML =
        '<div class="summary-empty">开始冒险后，这里会显示每次剧情的总结</div>';
    }
  }

  /**
   * 基于 UID 截断（保留 targetUID 对应的总结，删除之后的）
   * @param {string} targetUID - 目标 UID
   */
  truncateAfterUID(targetUID) {
    this._generationEpoch++;

    // 找到 targetUID 对应的索引
    let targetIndex = -1;
    for (let i = 0; i < this.summaries.length; i++) {
      if (this.summaries[i].uid === targetUID) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex === -1) {
      if (targetUID === null) {
        // targetUID 为 null 意味着回滚到首条 AI 回复之前，清空所有总结
        this.summaries = [];
        this.pendingTurnCount = 0;
        this.renderSummaries();
        console.log('[SummaryService] targetUID 为 null，清空所有总结');
        return;
      }
      // UID 提供但未找到时，保持现状（可能是总结未被保存/恢复）
      console.log(`[SummaryService] UID ${targetUID} 未找到，保持总结不变`);
      return;
    }

    // 保留 targetIndex 及之前的内容
    this.summaries = this.summaries.slice(0, targetIndex + 1);
    this._recalcPendingTurnCount();

    // 重新渲染
    this.renderSummaries();

    console.log(`[SummaryService] 回滚到 UID ${targetUID}, 保留 ${this.summaries.length} 条总结`);
  }

  // 重新生成指定 turn 的总结
  // @param {number} turnNumber - 轮次编号
  // @param {string} aiResponse - AI 回复文本
  // @param {string} turnUID - 该轮对话的唯一标识符
  // @param {string} narrativeText - Step 2 生成的叙事文本(可选)
  async regenerateTurn(turnNumber, aiResponse, turnUID = null, narrativeText = null) {
    // 先截断到该 turn(删除该 turn 及之后的)
    this.truncateToTurn(turnNumber);

    // 然后重新生成该 turn 的总结，传递 UID 和叙事文本
    await this.summarize(aiResponse, turnUID, narrativeText);
  }

  /**
   * 重新渲染所有总结到 DOM
   * 用于回滚后更新 UI
   */
  renderSummaries() {
    if (!this.listEl) return;

    // 清空 DOM
    this.listEl.innerHTML = '';

    if (this.summaries.length === 0) {
      this.listEl.innerHTML = this.createEmptyStateHTML();
      this.updateStats();
      return;
    }

    // 重新渲染每个总结
    let chapterCounter = 1;

    this.summaries.forEach(summaryData => {
      const itemEl = document.createElement('div');

      if (summaryData.type === 'chapter') {
        // 渲染章节总结：动态计数显示，不依赖 summaryData.chapterNumber 字段
        itemEl.className = 'summary-item summary-chapter';
        itemEl.dataset.chapter = chapterCounter;
        itemEl.innerHTML = this.createChapterItemHTML(chapterCounter, summaryData.text);
        this.bindChapterEvents(itemEl);
        chapterCounter++;
      } else {
        // 渲染单轮总结
        const turnNumber = summaryData.turnNumber;
        itemEl.className = 'summary-item';
        itemEl.dataset.turn = turnNumber;
        if (summaryData.uid) {
          itemEl.dataset.uid = summaryData.uid;
        }

        if (summaryData.text) {
          itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, summaryData.text);
          this.bindItemEvents(itemEl, turnNumber);
        } else {
          itemEl.innerHTML = this.createSummaryItemHTML(turnNumber, '总结失败(点击重试)');
          this.bindItemEvents(itemEl, turnNumber);
        }
      }

      this.listEl.appendChild(itemEl);
    });

    // 更新统计信息
    this.updateStats();
  }

  // 获取所有总结(返回文本数组)
  getSummaries() {
    return this.summaries.map(s => s.text).filter(Boolean);
  }

  // 获取所有总结数据(包含原始内容)
  getSummaryData() {
    return this.summaries;
  }

  /**
   * 从 chatHistory 中按 UID 重建总结所需的原始内容
   * 用于替代存储 originalContent，按需从 chatHistory 提取
   * @param {string} uid - 轮次 UID
   * @returns {string|null} 重建的内容，失败返回 null
   */
  _rebuildContentFromUID(uid) {
    if (!uid) return null;
    const chat = this._getActiveChatHistory();
    if (!chat.length) return null;

    const aiMsg = chat.find(m => m.sender === 'ai' && m.uid === uid);
    if (!aiMsg) return null;

    let content = '';
    try {
      const jsonMatch = aiMsg.text.match(/```(?:json|typescript)?\s*([\s\S]*?)```/i);
      if (!jsonMatch) return null;

      const json = JSON.parse(jsonMatch[1]);

      // 提取状态面板
      if (json.panel_status) {
        const statusText = this._buildStatusSummaryText(json.panel_status);
        if (statusText) content += '[状态] ' + statusText + '\n\n';
      }

      // 提取叙事文本
      if (json.panel_narrative) {
        content += '[剧情] ' + json.panel_narrative;
      }
    } catch (e) {
      console.warn('[SummaryService] Failed to rebuild content from UID:', uid, e);
    }

    return content || null;
  }
}

// 每多少轮触发一次章节总结
SummaryService.CHAPTER_SIZE = 20;

// 创建全局实例
const summaryService = new SummaryService();
window.summaryService = summaryService;

// ========================================
// EventBus 监听器
// 监听 AI_RESPONSE_COMPLETE 事件，自动触发总结
// ========================================
if (window.eventBus && window.GameEvents) {
  // 监听 AI 响应完成事件
  eventBus.on(GameEvents.AI_RESPONSE_COMPLETE, payload => {
    const { narrative, narrativeText, uid, gameData } = payload;

    // narrative: 完整的 AI 响应; gameData: 侧带结构化数据
    if ((narrative || gameData) && uid) {
      summaryService.summarize(narrative, uid, narrativeText, gameData);
    }
  });

  // 监听回滚事件
  eventBus.on(GameEvents.ROLLBACK_TO_TURN, ({ targetUID }) => {
    summaryService.truncateAfterUID(targetUID);
  });

  console.log('[SummaryService] EventBus 监听器已注册');
}

// 生命周期别名（供 ServiceRegistry 统一调用）
summaryService.getSaveData = summaryService.getSummaryData.bind(summaryService);

// 注册到服务中心
ServiceRegistry.register('summaries', summaryService);
