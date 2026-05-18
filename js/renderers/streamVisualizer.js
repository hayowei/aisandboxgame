// ============================================
// Stream Visualizer - 流式输出可视化器 v2.2
// ============================================
// 支持 Agent 架构:
// - ReAct: 工具调用 + 纯创作阶段(流式输出纯文本叙事)
// - Step 3: 结构化提取阶段(非流式，提取 JSON)
//
// 功能特性:
// - 直接显示 ReAct 的纯文本叙事流
// - 智能 Markdown 修复(代码块、粗体、斜体等)
// - 骨架屏加载效果
// - 平滑过渡动画
// - 实时字符计数和速度显示
// - Step 3 完成后填充结构化槽位(状态栏、选项等)
// ============================================

// 块稳定增量渲染状态：每个 narrative 元素一条 { frozenLen, frozenPrefix }。
// 已冻结的段落渲染一次后永不重碰（增长点以上 DOM 不变 → 滚动不被 reflow 弹）。
// 见 内部设计文档 Part 1。
const _mdRenderState = new WeakMap();

const streamVisualizer = {
  supportedProviders: new Set([
    'gemini',
    'deepseek',
    'openai',
    'grok',
    'anthropic',
    'siliconflow',
    'sandbox',
  ]),

  // ========================================
  // 状态管理
  // ========================================
  state: {
    isActive: false, // 是否正在流式输出
    isNonStreaming: false, // 是否为非流式模式
    bubbleElement: null, // 流式气泡根元素
    contentElement: null, // 内容容器
    narrativeElement: null, // 叙事区域
    statsElement: null, // 统计信息元素
    requestPresentationConfig: null, // 当前气泡冻结的配置快照
    lastText: '', // 上次渲染的文本
    lastTextLength: 0, // 上次文本长度(防回退)
    charCount: 0, // 字符计数
    startTime: 0, // 开始时间(用于计算速度)
    lastChunkTime: 0, // 上次 chunk 时间
    updateTimer: null, // 节流定时器
    pendingText: null, // 待处理文本
  },

  // ========================================
  // 配置
  // ========================================
  config: {
    updateInterval: 50, // DOM 更新间隔(ms)，降低以提高响应性
    showStats: true, // 是否显示实时统计
    smoothTransition: true, // 是否启用平滑过渡
  },

  // ========================================
  // 预编译正则表达式
  // ========================================
  regex: {
    // 检测未闭合的 Markdown 语法
    unclosedCodeBlock: /```[^`]*$/,
    unclosedBold: /\*\*[^*]*$/,
    unclosedItalic: /(?<!\*)\*[^*]+$/,
    unclosedStrike: /~~[^~]*$/,
  },

  _escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  _captureRequestPresentationConfig() {
    return {
      apiSettingsMode:
        typeof aiService !== 'undefined' && typeof aiService.getEffectiveApiSettingsMode === 'function'
          ? aiService.getEffectiveApiSettingsMode()
          : '',
      reactModel:
        typeof aiService !== 'undefined' && typeof aiService.getModelForModule === 'function'
          ? aiService.getModelForModule('react')
          : '',
      reactProvider:
        typeof aiService !== 'undefined' && typeof aiService.getProviderForModule === 'function'
          ? aiService.getProviderForModule('react')
          : '',
      reactThinking:
        typeof aiService !== 'undefined' && typeof aiService.getModuleThinking === 'function'
          ? aiService.getModuleThinking('react')
          : '',
    };
  },

  // 推荐模式下，主聊天头部走"沙盒"门面（隐藏底层 deepseek 多 iter 切换）。
  // 一旦请求开始，apiSettingsMode 会被冻结进 requestPresentationConfig，避免用户中途
  // 切设置导致同一气泡的 model/thinking 标签前后不一致。
  _isRecommendedMode() {
    const frozen = this.state.requestPresentationConfig?.apiSettingsMode;
    if (typeof frozen === 'string' && frozen) return frozen === 'recommended';
    if (typeof aiService !== 'undefined' && typeof aiService.getEffectiveApiSettingsMode === 'function') {
      return aiService.getEffectiveApiSettingsMode() === 'recommended';
    }
    return false;
  },

  _getConfiguredReactModelLabel() {
    if (this._isRecommendedMode()) return 'deepseek-v4-沙盒';
    const frozenModel = this.state.requestPresentationConfig?.reactModel;
    if (typeof frozenModel === 'string' && frozenModel.trim()) {
      return frozenModel.trim();
    }
    if (typeof aiService !== 'undefined' && typeof aiService.getModelForModule === 'function') {
      const model = aiService.getModelForModule('react');
      if (typeof model === 'string' && model.trim()) return model.trim();
    }
    return '模型';
  },

  _normalizeProviderKey(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const value = raw.trim().toLowerCase();

    if (this.supportedProviders.has(value)) return value;
    if (value === 'chatgpt' || value === 'x.ai' || value === 'xai' || value === 'claude') {
      if (value === 'chatgpt') return 'openai';
      if (value === 'claude') return 'anthropic';
      return 'grok';
    }

    if (value.includes('deepseek')) return 'deepseek';
    if (value.includes('gemini')) return 'gemini';
    if (value.includes('siliconflow')) return 'siliconflow';
    if (value.includes('openai') || value.includes('chatgpt') || value.includes('gpt'))
      return 'openai';
    if (value.includes('grok') || value.includes('xai') || value.includes('x.ai')) return 'grok';
    if (value.includes('anthropic') || value.includes('claude')) return 'anthropic';

    return null;
  },

  _inferProviderKeyFromModelLabel(modelLabel) {
    if (typeof modelLabel !== 'string' || !modelLabel.trim()) return null;
    const value = modelLabel.trim().toLowerCase();

    if (value.includes('deepseek')) return 'deepseek';
    if (value.includes('gemini')) return 'gemini';
    if (value.includes('siliconflow')) return 'siliconflow';
    if (value.includes('claude') || value.includes('anthropic')) return 'anthropic';
    if (value.includes('grok') || value.includes('xai') || value.includes('x.ai')) return 'grok';
    if (value.includes('gpt') || value.includes('openai') || value.includes('chatgpt'))
      return 'openai';

    return null;
  },

  _getConfiguredReactProviderKey() {
    if (this._isRecommendedMode()) return 'sandbox';
    const frozenProvider = this.state.requestPresentationConfig?.reactProvider;
    if (typeof frozenProvider === 'string' && frozenProvider.trim()) {
      return this._normalizeProviderKey(frozenProvider);
    }
    if (typeof aiService !== 'undefined' && typeof aiService.getProviderForModule === 'function') {
      const provider = aiService.getProviderForModule('react');
      return this._normalizeProviderKey(provider);
    }
    return null;
  },

  // 思考徽章只对「官方 DeepSeek 服务商」显示（DeepSeek V4 hybrid 的 reasoning
  // 档位参数只有官方 deepseek provider 才真正生效；自定义服务商即便名字/模型名
  // 带 "deepseek" 也不吃这个参数）。
  //
  // 必须用**严格相等** `=== 'deepseek'`，绝不能用 _normalizeProviderKey /
  // _inferProviderKeyFromModelLabel 这类 `.includes('deepseek')` 松散匹配：
  // custom provider 的 getProviderLabel() 返回用户自取的名字（aiAdapters.js
  // OpenAIAdapter），命名成 "deepseek中转" 之类时松散匹配会误判回 'deepseek'；
  // metrics.providers.react 存的就是这个 label 的小写原文（react.js，未归一）。
  // 官方内置 provider 的 label 恒为 'DeepSeek'、config.provider 恒为字符串
  // 'deepseek'，custom provider 按架构约束 id 不能等于 'deepseek'，故严格相等可靠。
  _strictIsDeepSeek(raw) {
    return typeof raw === 'string' && raw.trim().toLowerCase() === 'deepseek';
  },

  _isReactOfficialDeepSeek(metrics = null) {
    if (this._isRecommendedMode()) return true; // 推荐模式底层即官方 DeepSeek，显示「思考：自动」
    const fromMetrics = metrics?.providers?.react || metrics?.providers?.step2;
    if (typeof fromMetrics === 'string' && fromMetrics.trim()) {
      return this._strictIsDeepSeek(fromMetrics);
    }
    const frozen = this.state.requestPresentationConfig?.reactProvider;
    if (typeof frozen === 'string' && frozen.trim()) {
      return this._strictIsDeepSeek(frozen);
    }
    if (typeof aiService !== 'undefined' && typeof aiService.getProviderForModule === 'function') {
      return this._strictIsDeepSeek(aiService.getProviderForModule('react'));
    }
    return false;
  },

  _resolveReactProviderKey(metrics = null, modelLabel = null) {
    if (this._isRecommendedMode()) return 'sandbox';
    const rawProviderFromMetrics = metrics?.providers?.react || metrics?.providers?.step2;
    if (typeof rawProviderFromMetrics === 'string' && rawProviderFromMetrics.trim()) {
      const normalized = this._normalizeProviderKey(rawProviderFromMetrics);
      return normalized || null;
    }

    const inferredProvider = this._inferProviderKeyFromModelLabel(
      modelLabel || this._resolveReactModelLabel(metrics)
    );
    if (inferredProvider) return inferredProvider;

    return this._getConfiguredReactProviderKey();
  },

  _applyAiProviderDataset(msgEl, providerKey) {
    if (!msgEl) return;
    const normalized = this._normalizeProviderKey(providerKey);
    if (normalized) {
      msgEl.dataset.aiProvider = normalized;
    } else {
      delete msgEl.dataset.aiProvider;
    }
  },

  _resolveReactModelLabel(metrics = null) {
    if (this._isRecommendedMode()) return 'deepseek-v4-沙盒';
    const modelFromMetrics = metrics?.models?.react || metrics?.models?.step2;
    if (typeof modelFromMetrics === 'string' && modelFromMetrics.trim()) {
      return modelFromMetrics.trim();
    }
    return this._getConfiguredReactModelLabel();
  },

  // 'auto' 是推荐模式 façade-only 档位，仅用于显示「思考：自动」
  // （底层实际由 aiService 根据 iter 在 off/high/max 间切换，参见
  // RECOMMENDED_PHASE_MAP）。真实 DeepSeek thinking 值仍只能是 off/high/max。
  thinkingLevels: ['off', 'high', 'max', 'auto'],

  _getConfiguredReactThinkingLevel() {
    if (this._isRecommendedMode()) return 'auto';
    const frozen = this.state.requestPresentationConfig?.reactThinking;
    if (typeof frozen === 'string' && this.thinkingLevels.includes(frozen)) {
      return frozen;
    }
    if (typeof aiService !== 'undefined' && typeof aiService.getModuleThinking === 'function') {
      const live = aiService.getModuleThinking('react');
      if (this.thinkingLevels.includes(live)) return live;
    }
    return null;
  },

  _resolveReactThinkingLevel(metrics = null) {
    if (this._isRecommendedMode()) return 'auto';
    const fromMetrics = metrics?.thinking?.react;
    if (typeof fromMetrics === 'string' && this.thinkingLevels.includes(fromMetrics)) {
      return fromMetrics;
    }
    return this._getConfiguredReactThinkingLevel();
  },

  _formatThinkingMarker(level) {
    if (!this.thinkingLevels.includes(level)) return '';
    if (level === 'auto') return '「思考：自动」';
    const display = level[0].toUpperCase() + level.slice(1);
    return `「思考：${display}」`;
  },

  _formatAiLabel(modelLabel, turnNumber, thinkingLevel = null, metrics = null /* , uid 已迁出，改用 appendTurnUidBadge 悬浮显示 */) {
    const normalizedModel =
      typeof modelLabel === 'string' && modelLabel.trim() ? modelLabel.trim() : '模型';
    const normalizedTurn = Number.isFinite(turnNumber) ? turnNumber : '?';
    const isDeepSeek = this._isReactOfficialDeepSeek(metrics);
    const thinkingPart = isDeepSeek ? this._formatThinkingMarker(thinkingLevel) : '';
    return thinkingPart
      ? `${normalizedModel} ${thinkingPart} Turn ${normalizedTurn}`
      : `${normalizedModel} Turn ${normalizedTurn}`;
  },

  appendTurnUidBadge(labelEl, uid) {
    if (!labelEl || !uid) return;
    if (labelEl.querySelector('.turn-uid-group')) return;

    // 把 label 文本里的 "Turn N" 子串本身包成悬浮触发点，hover/点击它显示 UID
    const textNodes = [];
    for (const node of labelEl.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) textNodes.push(node);
    }
    if (textNodes.length === 0) return;

    const fullText = textNodes.map(n => n.textContent).join('');
    // 「【Turn N】」整段一起染色：左括号若存在就一起吞掉，
    // \S+ 会把右括号顺带匹配到尾部，避免出现"右括号绿、左括号默认色"的不对称
    const turnMatch = fullText.match(/【?Turn\s+\S+/);
    if (!turnMatch) return;

    const thinkingMatch = fullText.match(/「思考：(Off|High|Max|自动)」/);

    const safeUid = this._escapeHtml(String(uid));
    const turnGroup = document.createElement('span');
    turnGroup.className = 'metric-group turn-uid-group';
    turnGroup.dataset.uid = uid;
    turnGroup.title = '点击复制 UID';
    // 注意：innerHTML 不能换行/缩进——turn-uid-group 是 inline，多余空白会被渲染成空格
    turnGroup.innerHTML
      = `<span class="turn-uid-text">${this._escapeHtml(turnMatch[0])}</span>`
      + `<span class="metrics-tooltip"><span class="tooltip-row">`
      + `<span class="tooltip-label">UID</span>`
      + `<span class="tooltip-value">${safeUid}</span>`
      + `</span></span>`;
    turnGroup.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.turn-uid-group.active').forEach(g => {
        if (g !== turnGroup) g.classList.remove('active');
      });
      turnGroup.classList.toggle('active');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(uid).then(() => {
          turnGroup.classList.add('copied');
          setTimeout(() => turnGroup.classList.remove('copied'), 800);
        }).catch(() => {});
      }
    });

    // 用一个 inline wrapper 把"前缀文本 + 思考徽章 + Turn 触发点 + 后缀文本"打包，
    // 避开 .chat-user-label flex + gap 把多个 text node/span 拉开的问题
    const inner = document.createElement('span');
    inner.className = 'chat-user-label-text';

    let cursor = 0;
    if (thinkingMatch && thinkingMatch.index < turnMatch.index) {
      const beforeThinking = fullText.slice(cursor, thinkingMatch.index);
      if (beforeThinking) inner.appendChild(document.createTextNode(beforeThinking));
      const thinkingSpan = document.createElement('span');
      thinkingSpan.className = 'label-thinking';
      thinkingSpan.textContent = thinkingMatch[0];
      inner.appendChild(thinkingSpan);
      cursor = thinkingMatch.index + thinkingMatch[0].length;
    }
    const beforeTurn = fullText.slice(cursor, turnMatch.index);
    if (beforeTurn) inner.appendChild(document.createTextNode(beforeTurn));
    inner.appendChild(turnGroup);
    const afterTurn = fullText.slice(turnMatch.index + turnMatch[0].length);
    if (afterTurn) inner.appendChild(document.createTextNode(afterTurn));

    textNodes.forEach(n => n.remove());
    labelEl.insertBefore(inner, labelEl.firstChild);
  },

  // ========================================
  // [Start] 初始化骨架屏(统一流式/非流式)
  // ========================================
  // streaming: true = 流式模式(带动态指示器)
  //            false = 非流式模式(显示"正在思考...")
  start(streaming = true) {
    this.reset();

    const messagesArea = document.querySelector('.chat-messages-area');
    if (!messagesArea) {
      console.warn('[StreamVisualizer] 未找到消息区域');
      return false;
    }

    // 记录开始时间和模式
    this.state.startTime = performance.now();
    this.state.isActive = true;
    this.state.isNonStreaming = !streaming;
    this.state.requestPresentationConfig = this._captureRequestPresentationConfig();

    // 根据模式选择不同的标签和 class
    const modeClass = streaming ? '' : ' non-streaming-mode';
    const indicator = streaming
      ? '<span class="streaming-indicator"></span>'
      : '<span class="thinking-indicator">正在思考...</span>';
    const statsSlot =
      streaming && this.config.showStats
        ? '<div class="streaming-stats"><div class="stream-progress-text" data-phase="initial">正在准备…</div></div>'
        : '';
    const resolvedModelLabel = this._resolveReactModelLabel();
    const modelLabel = this._escapeHtml(resolvedModelLabel);
    const providerKey = this._getConfiguredReactProviderKey();
    const thinkingLevel = this._resolveReactThinkingLevel();
    const isDeepSeek = this._isReactOfficialDeepSeek();
    const thinkingFragment = (isDeepSeek && thinkingLevel)
      ? `<span class="label-thinking">${this._escapeHtml(this._formatThinkingMarker(thinkingLevel))}</span> `
      : '';

    // 创建骨架屏气泡
    const bubble = document.createElement('div');
    bubble.className = `chat-message ai-message streaming-state${modeClass}`;
    bubble.innerHTML = `
            <div class="chat-user-label">
                ${modelLabel} ${thinkingFragment}${indicator}
            </div>

            <div class="chat-message-content streaming-content">
                <div class="game-output">
                    <!-- ReAct 交错显示区（工具组 + 叙事段落按迭代顺序交替）—— trace strip 一旦出现即接管骨架顶部"推理中"行 -->
                    <div class="react-interleaved" data-slot="reactInterleaved" style="display: none;"></div>

                    <!-- 骨架屏：顶部"推理中"行在 trace strip 出现后由 CSS 隐藏，下方叙事 shimmer 等待真叙事到来 -->
                    <div class="streaming-skeleton">
                        <div class="skeleton-thinking-row">
                            <span class="skeleton-thinking-dot"></span>
                            <span class="skeleton-thinking-label react-thinking-status--active" data-i18n="react.thinking">${(typeof i18nService !== 'undefined' && i18nService?.t?.('react.thinking')) || '推理中'}</span>
                        </div>
                        <div class="skeleton-line w-85"></div>
                        <div class="skeleton-line w-70"></div>
                        <div class="skeleton-line w-90"></div>
                    </div>

                    <!-- NPC 角色动态区 -->
                    <div class="stream-slot npc-actions-slot" data-slot="npcActions" style="display: none;"></div>

                    <!-- 状态栏占位 -->
                    <div class="stream-slot" data-slot="status">
                        <div class="skeleton-status-item"></div>
                        <div class="skeleton-status-item"></div>
                        <div class="skeleton-status-item"></div>
                    </div>
                    
                    <!-- 选项列表占位 -->
                    <div class="stream-slot" data-slot="choices">
                        <div class="choices-header skeleton-text">💭 <strong>你的选择？</strong></div>
                        <div class="choices-list">
                            <div class="skeleton-choice"></div>
                            <div class="skeleton-choice"></div>
                            <div class="skeleton-choice"></div>
                        </div>
                    </div>
                </div>
                
                ${statsSlot}
            </div>
            
            <!-- Footer 槽位：流式期间留空（不放 skeleton 占位），
                 finalize 时由 _fillFooterSlot 填入真实指标 + 操作按钮 -->
            <div class="message-footer stream-slot" data-slot="footer"></div>
        `;

    this._applyAiProviderDataset(bubble, providerKey);

    // 新流式开始前，撤回历史 Turn 的状态栏编辑态（硬编码 editable=true 的残留）
    document.querySelectorAll('#main-stage .status-field-value.status-editable').forEach(el => {
      el.classList.remove('status-editable');
      el.removeAttribute('contenteditable');
    });

    messagesArea.appendChild(bubble);

    // OOC 兜底注入：regenerate forced 复用 / subagent skip 复用 / ask 已答完后流式启动等场景，
    // 把 chatHistory 末尾连续的 ooc_qa question 拉进新气泡顶部（正向 turn 时 chatHistory 末尾不是 OOC，prefix 为空）
    try {
      if (typeof window._buildAdjacentOocPrefixHtml === 'function'
          && typeof chatHistory !== 'undefined'
          && Array.isArray(chatHistory)) {
        const oocPrefixHtml = window._buildAdjacentOocPrefixHtml(chatHistory.length);
        if (oocPrefixHtml) {
          const streamingContent = bubble.querySelector('.chat-message-content.streaming-content');
          if (streamingContent) {
            const wrapper = document.createElement('div');
            wrapper.innerHTML = oocPrefixHtml;
            Array.from(wrapper.children).reverse().forEach(child => {
              streamingContent.prepend(child);
            });
          }
        }
      }
    } catch (oocPrefixErr) {
      console.warn('[StreamVisualizer] OOC prefix injection failed:', oocPrefixErr);
    }

    // 缓存 DOM 引用
    this.state.bubbleElement = bubble;
    this.state.contentElement = bubble.querySelector('.streaming-content');
    this.state.narrativeElement = null; // 动态指向当前迭代的叙事段落
    this.state.statsElement = bubble.querySelector('.streaming-stats');

    // 缓存骨架槽位引用
    this.state.slots = {
      status: bubble.querySelector('[data-slot="status"]'),
      choices: bubble.querySelector('[data-slot="choices"]'),
      footer: bubble.querySelector('[data-slot="footer"]'),
      reactInterleaved: bubble.querySelector('[data-slot="reactInterleaved"]'),
    };

    console.log(`[StreamVisualizer] ${streaming ? '流式' : '非流式'}骨架屏已启动`);
    return true;
  },

  // 非流式模式的快捷方法
  startNonStreaming() {
    return this.start(false);
  },

  // ========================================
  // [Update] 接收新内容（含可选的 reasoning 通道）
  // ========================================
  update(fullRawText, reasoningText) {
    if (!this.state.isActive) {
      if (!this.start()) return;
    }

    // 记录最后 chunk 时间
    this.state.lastChunkTime = performance.now();

    // 节流控制 — 叙事内容
    this.state.pendingText = fullRawText;

    if (this.state.updateTimer !== null) {
      // 已有定时器等待，不重复调度叙事更新
    } else {
      // 立即执行或延迟执行
      const now = performance.now();
      const elapsed = now - (this._lastUpdateTime || 0);

      // 动态调整间隔：如果上次渲染耗时过高，增加间隔
      let dynamicInterval = this.config.updateInterval; // 默认 50ms
      const lastDuration = this.state.lastRenderDuration || 0;

      if (lastDuration > 10) {
        // 如果渲染耗时 > 10ms，间隔设为 (耗时*2 + 50)，上限 200ms
        dynamicInterval = Math.min(200, Math.floor(lastDuration * 2 + 50));
      }

      if (elapsed >= dynamicInterval) {
        this._lastUpdateTime = now;
        this._doUpdate();
      } else {
        this.state.updateTimer = setTimeout(() => {
          this._lastUpdateTime = performance.now();
          this.state.updateTimer = null;
          this._doUpdate();
        }, dynamicInterval - elapsed);
      }
    }

    // 独立节流 — Reasoning 面板（DeepSeek reasoning_content）
    if (reasoningText) {
      this.state.pendingReasoning = reasoningText;

      // 首次 reasoning 到达也触发首次内容事件
      if (!this.state.firstContentDisplayed) {
        this.state.firstContentDisplayed = true;
        if (window.eventBus && window.GameEvents) {
          window.eventBus.emit(window.GameEvents.AI_FIRST_CONTENT_DISPLAY, {
            timestamp: performance.now(),
          });
        }
      }

      if (this.state.reasoningUpdateTimer !== null) return;

      const now = performance.now();
      const elapsed = now - (this._lastReasoningUpdateTime || 0);
      const interval = 80;

      if (elapsed >= interval) {
        this._lastReasoningUpdateTime = now;
        this._doUpdateReasoning();
      } else {
        this.state.reasoningUpdateTimer = setTimeout(() => {
          this._lastReasoningUpdateTime = performance.now();
          this.state.reasoningUpdateTimer = null;
          this._doUpdateReasoning();
        }, interval - elapsed);
      }
    }
  },

  // ========================================
  // Reasoning 面板实际更新
  // ========================================
  _doUpdateReasoning() {
    const text = this.state.pendingReasoning;
    if (!text) return;
    this._updateStreamingPanel('reasoning', text, '🧠 推理中…');
  },

  // ========================================
  // 实际 DOM 更新
  // ========================================
  _doUpdate() {
    if (!this.state.narrativeElement || this.state.pendingText === null) return;

    const renderStartTime = performance.now();
    const rawText = this.state.pendingText;

    // 流式内容路由：将标签内容分发到对应面板
    const routed = this._routeStreamContent(rawText);
    const displayText = routed.narrative || null;

    if (!this.state.firstContentDisplayed && displayText) {
      this.state.firstContentDisplayed = true;
      if (window.eventBus && window.GameEvents) {
        window.eventBus.emit(window.GameEvents.AI_FIRST_CONTENT_DISPLAY, {
          timestamp: performance.now(),
        });
      }
      this._updateStreamProgressText('narrative');
    }

    const totalChars = displayText?.length || 0;

    if (!displayText) {
      this._updateStats(totalChars);
      return;
    }

    // 叙事防回退 + 去重（只比较路由后的叙事部分）
    if (displayText.length < this.state.lastTextLength) {
      return;
    }
    if (displayText === this.state.lastText) {
      return;
    }

    this.state.lastText = displayText;
    this.state.lastTextLength = displayText.length;
    this.state.charCount = totalChars;

    // 捕获元素引用（避免 reset() 后丢失引用）
    const narrativeEl = this.state.narrativeElement;
    const bubbleEl = this.state.bubbleElement;
    const charCount = this.state.charCount;
    const capturedRawText = rawText; // 捕获原始文本用于 RAF 过时检查

    // 使用 requestAnimationFrame 进行 DOM 更新
    requestAnimationFrame(() => {
      // 使用捕获的引用，而非 this.state（可能已被 reset）
      if (!narrativeEl) return;

      // 检查 pendingText 是否已被其他代码更新（用原始文本比较，非路由后文本）
      const currentPendingText = this.state.pendingText;
      if (currentPendingText !== null && currentPendingText !== capturedRawText) {
        return;
      }

      // 受控变更：隐藏骨架→首帧 + 流式每帧增长，pinned 焊底/非 pinned 钉阅读位
      this._withScrollScope(() => {
        // 锁住 game-output 当前高度防止骨架→narrative 短暂塌缩闪动
        const gameOutputEl = bubbleEl?.querySelector('.game-output');
        streamVisualizer._lockGameOutputHeight(gameOutputEl);
        const skeleton = bubbleEl?.querySelector('.streaming-skeleton');
        if (skeleton) skeleton.style.display = 'none';
        if (gameOutputEl) {
          gameOutputEl.classList.remove('react-phase');
          gameOutputEl.querySelectorAll('.stream-slot[data-slot="status"], .stream-slot[data-slot="choices"]').forEach(el => {
            el.style.display = '';
          });
        }
        narrativeEl.style.display = 'block';

        // 块稳定增量渲染：冻结已完成段落，只重渲末块（增长点以上 DOM 不动）
        this._renderIncrementalMarkdown(narrativeEl, displayText, { fixUnclosed: true });
      });

      // 更新统计信息
      this._updateStats(charCount);

      // 记录渲染耗时，用于自适应控制
      this.state.lastRenderDuration = performance.now() - renderStartTime;
    });
  },

  // ========================================
  // 文本提取(Step 2 直接输出纯文本叙事，无需 JSON 解析)
  // ========================================
  _extractNarrativeText(rawText) {
    // Step 2 流式输出的是纯文本叙事，直接返回
    // 只需要去除可能的前后空白
    if (!rawText || typeof rawText !== 'string') {
      return null;
    }

    const text = rawText.trim();
    return text.length > 0 ? text : null;
  },

  // ========================================
  // 流式内容路由器：剥离训练残留标签，返回叙事文本
  // ========================================
  _routeStreamContent(fullText) {
    if (!fullText) return { narrative: '' };

    // 剥离 <thinking>/<think> 标签（DeepSeek reasoner 训练残留）
    let cleaned = fullText
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '');
    // 未闭合的 <thinking>/<think>（流式中间状态）：截断到标签起始处
    const thinkOpenMatch = cleaned.match(/<(?:thinking|think)>/i);
    if (thinkOpenMatch && !/<\/(?:thinking|think)>/i.test(cleaned)) {
      cleaned = cleaned.substring(0, thinkOpenMatch.index);
    }

    return { narrative: cleaned.trim() };
  },

  // ========================================
  // 通用面板实时更新（Choices / Reasoning 复用）
  // ========================================
  _updateStreamingPanel(panelKey, text, streamingLabel) {
    if (!text || !this.state.bubbleElement) return;
    const bubble = this.state.bubbleElement;
    const slot = bubble.querySelector(`[data-slot="${panelKey}"]`);
    const tab = bubble.querySelector(`.tab[data-tab="${panelKey}"]`);
    if (!slot || !tab) return;

    tab.classList.remove('skeleton-row');
    tab.style.display = '';
    tab.innerHTML = `${streamingLabel} <span class="process-meta">${text.length} 字</span>`;

    const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    slot.innerHTML = `<div class="process-reasoning-wrap"><div class="process-phase-content">${escaped}</div></div>`;
  },

  // ========================================
  // 简易 HTML 净化 (防止 XSS)
  // ========================================
  _sanitizeHTML(html) {
    if (!html) return '';
    // 移除危险标签和事件属性
    return html
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
      .replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gim, '')
      .replace(/<object\b[^>]*>([\s\S]*?)<\/object>/gim, '')
      .replace(/<embed\b[^>]*>([\s\S]*?)<\/embed>/gim, '')
      .replace(/\s+on\w+="[^"]*"/gim, '') // remove on*="value"
      .replace(/\s+on\w+='[^']*'/gim, '') // remove on*='value'
      .replace(/\s+on\w+=[^>\s]*/gim, '') // remove on*=value
      .replace(/javascript:/gim, ''); // prevent javascript: protocol
  },

  // ========================================
  // 修复未闭合的 Markdown 语法
  // ========================================
  _fixUnclosedMarkdown(text) {
    if (!text) return '';
    let result = text;

    // 修复未闭合的代码块
    const codeBlockCount = (result.match(/```/g) || []).length;
    if (codeBlockCount % 2 !== 0) {
      result += '\n```';
    }

    // 修复未闭合的粗体 **
    const boldCount = (result.match(/\*\*/g) || []).length;
    if (boldCount % 2 !== 0) {
      result += '**';
    }

    // 修复未闭合的删除线 ~~
    const strikeCount = (result.match(/~~/g) || []).length;
    if (strikeCount % 2 !== 0) {
      result += '~~';
    }

    return result;
  },

  // ========================================
  // 块稳定增量 markdown 渲染（根治流式 reflow 弹跳）
  // ========================================
  // 把已到全文按 \n\n 段边界切成 [冻结块 head | 末块 tail]。
  // head 只在它增长时重渲一次（低频），tail 每 chunk 重渲。
  // 增长点以上 DOM 不变 → 浏览器无 reflow → 滚动不被弹。
  //
  // 铁律不变量：冻结点【只能】在 \n\n 段落硬边界，绝不段中切。
  // 着色器 narrativeColorizer 三个正则（「」/（）/说话人：）均为单行构造
  // （JS 正则 . 不匹配 \n），跨不过 \n\n；只要按段边界切，每个冻结块单独
  // 着色与全文着色逐字节一致（着色器无状态）。段中切会破坏这个一致性。
  _renderToSafeHtml(src) {
    if (window.htmlSecurity) return window.htmlSecurity.markdownToSafeHtml(src);
    return this._sanitizeHTML(src.replace(/\n/g, '<br>'));
  },

  // 把会改 DOM 高度的渲染段交给 scrollController 受控执行：
  // pinned → 变更后焊底跟随；非 pinned → 钉住阅读位。controller 缺失则直接执行。
  // 覆盖「骨架屏→首帧」交换 + 流式每帧增长（见计划 Part 2）。
  _withScrollScope(fn) {
    if (window.scrollController && typeof window.scrollController.runScoped === 'function') {
      window.scrollController.runScoped(fn);
    } else {
      fn();
    }
  },

  // 找新的冻结长度：>= minLen，且为 \n\n 段边界，且截至该点 ``` 配对偶数，
  // 且切点后首行不是 列表/引用/缩进续行（避免把跨界的同一 list/code 切两半）。
  // 找不到合格切点则返回 minLen（不前进；minLen=0 时等价整段重渲，安全）。
  _computeFrozenLen(text, minLen) {
    const re = /\n\n+/g;
    const cands = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      cands.push(m.index + m[0].length); // 空行之后正文开始处 = 候选切点
    }
    for (let i = cands.length - 1; i >= 0; i--) {
      const p = cands[i];
      if (p < minLen) break; // 更前的只会更小
      const head = text.slice(0, p);
      if (((head.match(/```/g) || []).length) % 2 !== 0) continue; // 在未闭合代码块内
      const after = text.slice(p);
      const nl = after.indexOf('\n');
      const firstLine = nl >= 0 ? after.slice(0, nl) : after;
      if (/^(\s{4,}|\t|[-*+] |\d+[.)] |> )/.test(firstLine)) continue; // 续行，别切
      return Math.max(p, minLen);
    }
    return minLen;
  },

  // 叙事归一化 —— 必须与 prompt-gm.js `_normalizeNarrative` 口径完全一致：
  // L1（emit 闸）与 L3（DOM 内容查重）共用同一判重标准。trim + 折叠连续空白 +
  // 去首尾标点，吸收弱模型二次吐同段时的轻微空白/标点漂移。
  _normalizeNarrativeText(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  },

  // el: narrative 容器；fullText: 累计全文；
  // opts.fixUnclosed: tail 是否补未闭合 markdown（非 ReAct=true，ReAct 增量=false）
  // opts.finalize: true=忽略增量，一次性产出【扁平 DOM】（与历史重建产物一致）
  _renderIncrementalMarkdown(el, fullText, opts) {
    if (!el) return;
    const options = opts || {};
    const fixUnclosed = options.fixUnclosed !== false;
    const finalize = options.finalize === true;
    const text = typeof fullText === 'string' ? fullText : '';

    if (finalize) {
      // 终态必须是扁平 DOM（无 md-frozen/md-tail 包装），否则与
      // gameOutputRenderer / refreshChatUI 历史重建结构不一致。
      _mdRenderState.delete(el);
      const safe = fixUnclosed ? this._fixUnclosedMarkdown(text) : text;
      el.innerHTML = text ? this._renderToSafeHtml(safe) : '';
      return;
    }

    let st = _mdRenderState.get(el);
    if (!st) {
      st = { frozenLen: 0, frozenPrefix: '' };
      _mdRenderState.set(el, st);
    }

    // 防回退（regenerate / provider 重发可能让文本变短或改写）：
    // 文本不再以已冻结前缀开头 → 整体重置（不可假设单调增长）。
    if (
      st.frozenLen > 0 &&
      (text.length < st.frozenLen || text.slice(0, st.frozenLen) !== st.frozenPrefix)
    ) {
      st.frozenLen = 0;
      st.frozenPrefix = '';
    }

    let frozenEl = el.querySelector(':scope > .md-frozen');
    let tailEl = el.querySelector(':scope > .md-tail');
    let structRebuilt = false;
    if (!frozenEl || !tailEl) {
      el.innerHTML = '';
      frozenEl = document.createElement('div');
      frozenEl.className = 'md-frozen';
      tailEl = document.createElement('div');
      tailEl.className = 'md-tail';
      el.appendChild(frozenEl);
      el.appendChild(tailEl);
      structRebuilt = true;
    }

    const newFrozenLen = this._computeFrozenLen(text, st.frozenLen);
    if (newFrozenLen !== st.frozenLen || structRebuilt) {
      const head = text.slice(0, newFrozenLen);
      // head 一定以 \n\n 收尾的完整段落集合，无需 _fixUnclosedMarkdown。
      frozenEl.innerHTML = head ? this._renderToSafeHtml(head) : '';
      st.frozenLen = newFrozenLen;
      st.frozenPrefix = head;
    }

    const tail = text.slice(st.frozenLen);
    const safeTail = fixUnclosed ? this._fixUnclosedMarkdown(tail) : tail;
    tailEl.innerHTML = tail ? this._renderToSafeHtml(safeTail) : '';
  },

  // ========================================
  // 更新底部阶段进度文本（幂等）
  // ========================================
  _updateStreamProgressText(phase) {
    if (!this.isStreaming()) return;
    const bubble = this.state.bubbleElement;
    if (!bubble) return;
    const el = bubble.querySelector('.stream-progress-text');
    if (!el) return;
    const labels = {
      react:     '正在推理与调用工具…',
      narrative: '正在生成叙事…',
      finishing: '正在生成状态与选项…',
    };
    const text = labels[phase];
    if (!text || el.dataset.phase === phase) return;
    el.dataset.phase = phase;
    el.textContent = text;
  },

  // ========================================
  // 更新统计信息
  // ========================================
  _updateStats(charCount) {
    if (!this.state.statsElement) return;

    const elapsed = (performance.now() - this.state.startTime) / 1000;
    const speed = elapsed > 0 ? Math.round(charCount / elapsed) : 0;

    this.state.statsElement.innerHTML = `
            <span class="stat-item">
                <span class="stat-icon">📝</span>
                <span class="stat-value">${charCount}</span> 字
            </span>
            <span class="stat-item">
                <span class="stat-icon">⚡</span>
                <span class="stat-value">${speed}</span> 字/秒
            </span>
        `;
  },

  // ========================================
  // 格式化 Token 数量（使用 k 单位简化大数字）
  // ========================================
  _formatTokenCount(count) {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return String(count);
  },

  // ========================================
  // 获取当前已积累的流式文本
  getCurrentText() {
    return this.state.pendingText || '';
  },

  // [Finish] 结束流式输出
  // @param {string} rawResponse - 原始 AI 响应(JSON 字符串)
  // ========================================
  finish(rawResponse, options = {}) {
    // 清理定时器
    if (this.state.updateTimer !== null) {
      clearTimeout(this.state.updateTimer);
      this.state.updateTimer = null;
    }
    if (this.state.reasoningUpdateTimer !== null) {
      clearTimeout(this.state.reasoningUpdateTimer);
      this.state.reasoningUpdateTimer = null;
    }

    if (!this.state.bubbleElement) {
      console.warn('[StreamVisualizer] finish() 调用但没有活跃的气泡');
      return;
    }

    // ★ 同步执行待处理的最终 DOM 更新（避免竞态条件）
    // 如果有待处理的文本，直接同步渲染到 DOM（不通过 RAF）
    if (this.state.pendingText && this.state.narrativeElement) {
      // 使用路由器提取纯叙事（避免标签闪现）
      const routed = this._routeStreamContent(this.state.pendingText);
      const displayText = routed.narrative || null;
      if (displayText && displayText.length >= this.state.lastTextLength) {
        // 受控最终化：pinned 焊底 / 非 pinned 钉阅读位
        this._withScrollScope(() => {
          // 锁住 game-output 当前高度防止骨架→narrative 短暂塌缩闪动
          const goEl = this.state.bubbleElement.querySelector('.game-output');
          this._lockGameOutputHeight(goEl);
          const skeleton = this.state.bubbleElement.querySelector('.streaming-skeleton');
          if (skeleton) skeleton.style.display = 'none';
          if (goEl) {
            goEl.classList.remove('react-phase');
            goEl.querySelectorAll('.stream-slot[data-slot="status"], .stream-slot[data-slot="choices"]').forEach(el => {
              el.style.display = '';
            });
          }
          this.state.narrativeElement.style.display = 'block';

          // 最终化：块稳定渲染产出扁平 DOM（与历史重建结构一致）
          this._renderIncrementalMarkdown(this.state.narrativeElement, displayText, {
            fixUnclosed: true,
            finalize: true,
          });
          this.state.charCount = displayText.length;
        });
      }
    }

    const bubble = this.state.bubbleElement;
    const isNonStreaming = this.state.isNonStreaming; // 保存状态(reset 前)

    // 计算总时间
    const totalStreamTime = performance.now() - this.state.startTime;
    console.log(
      `[StreamVisualizer] ${isNonStreaming ? '非流式' : '流式'}完成 - 总字符: ${this.state.charCount}, 耗时: ${(totalStreamTime / 1000).toFixed(2)}s`
    );

    // 优先使用事件 payload 中的 gameData，兜底解析原始文本
    const parsedJson = options.gameData || this._parseRawResponse(rawResponse);

    // 平滑过渡效果
    if (this.config.smoothTransition) {
      bubble.classList.add('streaming-finishing');
      requestAnimationFrame(() => {
        this._applyFinalContent(bubble, parsedJson, rawResponse, options, isNonStreaming);
      });
    } else {
      this._applyFinalContent(bubble, parsedJson, rawResponse, options, isNonStreaming);
    }

    // 重置状态
    this.reset();
  },

  // ========================================
  // 解析原始响应
  // ========================================
  // ========================================
  // 解析原始响应 (Robust JSON Extraction)
  // ========================================
  _parseRawResponse(rawResponse) {
    if (!rawResponse || typeof rawResponse !== 'string') return null;

    // 移除 markdown 代码块标记 (保留文本清理逻辑)
    const text = rawResponse.replace(/^```json\s*/i, '').replace(/```\s*$/, '');

    // 健壮提取：寻找最外层大括号 {...}
    // 应对情况：JSON 前后有杂乱文本，或者 JSON 是为了 Step 3 提取的
    const firstOpen = text.indexOf('{');
    const lastClose = text.lastIndexOf('}');

    if (firstOpen !== -1 && lastClose > firstOpen) {
      const jsonStr = text.substring(firstOpen, lastClose + 1);
      try {
        return JSON.parse(jsonStr);
      } catch (e) {
        console.debug('[StreamVisualizer] JSON 解析重试失败:', e.message);
        // Last ditch: attempt to find valid JSON if above failed (optional)
      }
    }

    // Fallback: 尝试直接解析 (可能已经是干净的)
    try {
      return JSON.parse(text);
    } catch (e) {
      console.debug('[StreamVisualizer] JSON 解析失败:', e.message);
      return null;
    }
  },

  // ========================================
  // 应用最终内容(使用解析后的 JSON 直接填充槽位)
  // ========================================
  _applyFinalContent(bubble, parsedJson, rawResponse, options, _isNonStreaming = false) {
    const { uid, metrics, turnNumber, narrativeText } = options;

    // 更新标签
    const labelEl = bubble.querySelector('.chat-user-label');
    if (labelEl) {
      const modelLabel = this._resolveReactModelLabel(metrics);
      const thinkingLevel = this._resolveReactThinkingLevel(metrics);
      labelEl.textContent = this._formatAiLabel(modelLabel, turnNumber, thinkingLevel, metrics);
      this.appendTurnUidBadge(labelEl, uid);
      this._applyAiProviderDataset(bubble, this._resolveReactProviderKey(metrics, modelLabel));
    } else {
      const modelLabel = this._resolveReactModelLabel(metrics);
      this._applyAiProviderDataset(bubble, this._resolveReactProviderKey(metrics, modelLabel));
    }

    // Finalize DOM 改动期间的 scroll 维持完全靠浏览器原生 overflow-anchor：
    // - .chat-message.streaming-state 已加 overflow-anchor:none 排除自己当锚（CSS）
    // - .game-choices 同样排除（防 _markStaleChoices 折叠/展开影响锚）
    // - 浏览器自动选稳定的旧 turn / 用户消息 / 叙事段落作为锚，并在 viewport 上方
    //   尺寸变化时自动调整 scrollTop 维持锚点视觉位置

    // 隐藏骨架屏，锁住 game-output 当前高度防止骨架→内容切换瞬间塌缩
    const goComplete = bubble.querySelector('.game-output');
    this._lockGameOutputHeight(goComplete);
    const skeleton = bubble.querySelector('.streaming-skeleton');
    if (skeleton) skeleton.style.display = 'none';
    if (goComplete) {
      goComplete.classList.remove('react-phase');
      goComplete.querySelectorAll('.stream-slot[data-slot="status"], .stream-slot[data-slot="choices"]').forEach(el => {
        el.style.display = '';
      });
    }

    // 隐藏统计信息
    const statsEl = bubble.querySelector('.streaming-stats');
    if (statsEl) statsEl.style.display = 'none';

    // 1. 处理叙事内容 — 优先使用交错段落，兜底渲染完整叙事
    const interleavedContainer = bubble.querySelector('[data-slot="reactInterleaved"]');
    const hasSegments = interleavedContainer?.querySelector('.react-narrative-segment');

    if (hasSegments) {
      // 交错段落已由迭代事件渲染，清理流式标记
      interleavedContainer.querySelectorAll('[data-streaming]').forEach(el => delete el.dataset.streaming);
      interleavedContainer.style.display = '';
    } else if (interleavedContainer) {
      // 兜底：无交错段落时，创建单一叙事块
      const finalNarrativeText = narrativeText || (parsedJson && parsedJson.panel_narrative);
      if (finalNarrativeText) {
        const fallbackNarrative = document.createElement('div');
        fallbackNarrative.className = 'game-narrative react-narrative-segment';
        if (window.htmlSecurity) {
          fallbackNarrative.innerHTML = window.htmlSecurity.markdownToSafeHtml(finalNarrativeText);
        } else {
          fallbackNarrative.textContent = finalNarrativeText;
        }
        interleavedContainer.appendChild(fallbackNarrative);
        interleavedContainer.style.display = '';
      }
    }

    // 折叠 ReAct trace（统一移除 streaming 标记 + 生成摘要栏）
    if (interleavedContainer) {
      interleavedContainer.classList.remove('react-trace-streaming');
      this._collapseReactTrace(interleavedContainer);
    }

    // ====== 填充结构化槽位（兼容 gameData 和 legacy JSON） ======
    // 2. 填充状态栏槽位
    const statusSlot = bubble.querySelector('[data-slot="status"]');
    if (statusSlot && parsedJson && parsedJson.panel_status) {
      statusSlot.classList.remove('game-status');
      statusSlot.innerHTML = this._renderStatus(parsedJson.panel_status);
      statusSlot.classList.add('filled');
    } else if (statusSlot) {
      statusSlot.style.display = 'none';
    }

    // 3. 填充选项槽位
    const choicesSlot = bubble.querySelector('[data-slot="choices"]');
    const allChoices = (parsedJson && parsedJson.choices) || [];
    if (choicesSlot && allChoices.length > 0) {
      choicesSlot.classList.remove('game-choices');
      choicesSlot.innerHTML = this._renderChoices(allChoices);
      choicesSlot.classList.add('filled');
    } else if (choicesSlot) {
      choicesSlot.style.display = 'none';
    }

    // 4. NPC 数据处理由 npcStore 的事件监听器处理（EventBus 单轨模式）

    // 移除 streaming-content 类
    const contentEl = bubble.querySelector('.chat-message-content');
    if (contentEl) contentEl.classList.remove('streaming-content');

    // 移除流式状态
    bubble.classList.remove('streaming-state', 'streaming-finishing');
    bubble.classList.add('streaming-complete');
    // 释放骨架→内容过渡期锁定的 min-height，让气泡回到自然终态高度。
    // CSS 上对 .game-output 设置了 min-height 过渡，最终化时高度变化会平滑收敛。
    this._releaseStreamingHeight(bubble);
    // 注意：finalize 不释放发送置顶——保持到下一次发送/用户手动滚动/
    // abort/重建才释放（ChatGPT 式：答完也留在原位），否则 finalize 后
    // _markStaleChoices 折叠旧 turn 会让置顶消息漂（preserveAnchor 会锚错
    // 到上方元素）。释放时机收敛到 scrollController 内部状态机管理。

    // 设置 originalIndex 用于消息操作(折叠模式支持)
    // 新消息刚被添加到 chatHistory 末尾，索引是 length - 1
    if (typeof chatHistory !== 'undefined' && chatHistory.length > 0) {
      bubble.dataset.originalIndex = chatHistory.length - 1;
    }

    // 交错区域的工具卡片已在迭代事件中追加，无需在此重建

    // 填充 NPC 角色动态区块（叙事下方的玩家可见卡片）
    const npcActionsSlot = bubble.querySelector('[data-slot="npcActions"]');
    if (npcActionsSlot) {
      const npcReactions = typeof aiService !== 'undefined' ? aiService.lastNpcReactions : null;
      if (npcReactions && npcReactions.some(r => r.decision)) {
        this._fillNpcActionsSection(npcActionsSlot, npcReactions);
        npcActionsSlot.style.display = '';
      }
    }

    // 填充 Footer 槽位
    const footerSlot = bubble.querySelector('[data-slot="footer"]');
    if (footerSlot) {
      this._fillFooterSlot(footerSlot, bubble, metrics);
      footerSlot.classList.add('filled');
    }

    // bindChoiceClickEvents 内部会 _markStaleChoices 折叠之前所有 turn 的 choices 块
    // （每个 -260px），是 finalize 时 viewport 上方最大量的内容缩水。交给
    // scrollController 受控：pinned 焊底 / 非 pinned 钉住阅读位（取代旧 3 段
    // 逐字复制、各自 rAF 时机互相打架的手写锚定兜底）。
    if (typeof window.bindChoiceClickEvents === 'function') {
      if (window.scrollController && typeof window.scrollController.runScoped === 'function') {
        window.scrollController.runScoped(() => window.bindChoiceClickEvents());
      } else {
        window.bindChoiceClickEvents();
      }
    }
    // bindMessageActionEvents 只挂事件监听器，不改 layout，无需 anchor 包裹
    if (typeof bindMessageActionEvents === 'function') {
      bindMessageActionEvents();
    }

    // 完成过渡动画后移除类
    setTimeout(() => {
      bubble.classList.remove('streaming-complete');
    }, 500);
  },

  // ========================================
  // 渲染状态栏(复用 gameOutputRenderer 的逻辑)
  // ========================================
  _renderStatus(status) {
    // 复用 gameOutputRenderer 的渲染逻辑
    // 流式渲染时肯定是最新的 Turn，所以 editable=true
    if (typeof gameOutputRenderer !== 'undefined') {
      const fieldDefs = gameOutputRenderer.resolveCustomStatusFieldDefs
        ? gameOutputRenderer.resolveCustomStatusFieldDefs(status)
        : window.worldMeta?.getStep3Fields?.()?.panel_status || [];
      return gameOutputRenderer.renderCustomStatus(status, fieldDefs, true);
    }
    return '';
  },

  // ========================================
  // 渲染选项列表
  // ========================================
  _renderChoices(choices) {
    // 复用 gameOutputRenderer 的渲染逻辑
    if (typeof gameOutputRenderer !== 'undefined') {
      return gameOutputRenderer.renderChoices(choices);
    }
    return '';
  },

  // ========================================
  // 填充 Function Calls 槽位
  // ========================================
  _fillFunctionCallsSlot(slot, functionCalls) {
    let allCalls = [];
    if (functionCalls[0] && functionCalls[0].step !== undefined) {
      functionCalls.forEach(stepData => {
        allCalls = allCalls.concat(stepData.calls || []);
      });
    } else {
      allCalls = functionCalls;
    }

    if (allCalls.length === 0) {
      return;
    }

    const esc = window.htmlSecurity ? window.htmlSecurity.escapeText : t => t;
    const fcTags = allCalls
      .map(fc => {
        const isDuplicate = fc.status === 'duplicate';
        const duplicateClass = isDuplicate ? ' fc-tag-duplicate' : '';
        const tooltip = isDuplicate ? 'title="重复请求 (已自动拦截)"' : '';
        const argsStr = Object.keys(fc.args || {})
          .sort()
          .map(k => {
            const v = fc.args[k];
            if (v === null || v === undefined) return '';
            if (typeof v === 'object') {
              const j = JSON.stringify(v);
              return esc(j.length > 60 ? j.slice(0, 57) + '\u2026' : j);
            }
            return esc(String(v));
          })
          .join(', ');
        const safeName = esc(fc.name || '');
        const displayName = argsStr ? `${safeName}(${argsStr})` : safeName;
        return `<span class="fc-tag${duplicateClass}" ${tooltip}>${displayName}</span>`;
      })
      .join('');

    slot.innerHTML = `<div class="process-fc-tags">${fcTags}</div>`;
  },

  // ========================================
  // 工具颜色分类（按前缀：get=绿, search=红, update=黄, send=蓝）
  // ========================================
  _TOOL_COLOR_PREFIX: {
    get_:    '--status-success',   // 绿
    search_: '--brand-accent',     // 红/橙
    update_: '--brand-yellow',     // 黄
    send_:   '--brand-primary',    // 蓝
  },

  _TOOL_COLOR_DEFAULT: '--brand-primary',

  // 根据工具名前缀返回颜色 token
  _resolveToolColor(name) {
    for (const [prefix, color] of Object.entries(this._TOOL_COLOR_PREFIX)) {
      if (name.startsWith(prefix)) return color;
    }
    return this._TOOL_COLOR_DEFAULT;
  },

  // 用每个工具自己的前缀色逐个填充 tools 容器；
  // 多工具同步显示时各自上色，而不是共用第一个工具的颜色。
  _fillToolNamesSpan(span, names) {
    span.textContent = '';
    const unique = [...new Set(names)];
    unique.forEach((name, idx) => {
      if (idx > 0) span.appendChild(document.createTextNode(', '));
      const sub = document.createElement('span');
      sub.textContent = name;
      sub.style.color = `var(${this._resolveToolColor(name)})`; /* ui-lint-allow: 动态 token 映射，按 CLAUDE.md JS 设色规范 */
      span.appendChild(sub);
    });
  },

  // ========================================
  // 创建 ReAct 工具调用卡片（内联 trace 用）
  // ========================================
  _createToolCard(call) {
    // 按前缀匹配颜色
    let toolColor = this._TOOL_COLOR_DEFAULT;
    for (const [prefix, color] of Object.entries(this._TOOL_COLOR_PREFIX)) {
      if (call.name.startsWith(prefix)) { toolColor = color; break; }
    }
    const card = document.createElement('div');
    card.className = 'react-tool-card';
    card.style.setProperty('--tool-color', `var(${toolColor})`);
    if (call.status === 'duplicate') card.classList.add('react-tool-duplicate');
    if (typeof call.result === 'string' && call.result.startsWith('Error')) {
      card.classList.add('react-tool-error');
    }

    const esc = window.htmlSecurity?.escapeText || (t => t);
    const argsStr = Object.entries(call.args || {})
      .map(([k, v]) => {
        let display;
        if (v === null || v === undefined) display = '';
        else if (typeof v === 'object') {
          const j = JSON.stringify(v);
          display = j.length > 80 ? j.slice(0, 77) + '\u2026' : j;
        } else {
          display = String(v);
        }
        return `${k}: ${esc(display)}`;
      })
      .join(', ');

    const resultText = call.result || '';
    const truncated = resultText.length > 300;
    const displayResult = truncated
      ? esc(resultText.slice(0, 300)) + '\u2026'
      : esc(resultText);

    card.innerHTML =
      `<span class="react-tool-name">${esc(call.name)}</span>` +
      (argsStr ? `<span class="react-tool-args">(${argsStr})</span>` : '') +
      `<span class="react-tool-arrow">\u2192</span>` +
      `<span class="react-tool-result">${displayResult}</span>`;

    // 可展开：结果被截断时，点击展开/收起
    if (truncated) {
      card.classList.add('react-tool-expandable');
      card.addEventListener('click', () => {
        card.classList.toggle('react-tool-expanded');
        const resultSpan = card.querySelector('.react-tool-result');
        if (card.classList.contains('react-tool-expanded')) {
          resultSpan.textContent = resultText;
        } else {
          resultSpan.innerHTML = displayResult;
        }
      });
    }

    return card;
  },

  // ========================================
  // 确保迭代包裹元素存在（时间线结构）
  // ========================================
  // 渲染 commentary segment：reasoning（若有）+ text。两者都是"THINKING"的一部分。
  _renderCommentarySegment(segment, text, reasoning) {
    // 纯文本转义 —— 不走 markdown。reasoning / text commentary 都是模型内部思考链，
    // 没有 markdown 语法意图，保留原始 \n 交给 CSS white-space: pre-wrap 处理即可。
    const safePlain = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const parts = [];
    if (reasoning && reasoning.trim()) {
      parts.push(`<div class="react-commentary-reasoning">${safePlain(reasoning)}</div>`);
    }
    if (text && text.trim()) {
      parts.push(`<div class="react-commentary-text">${safePlain(text)}</div>`);
    }
    if (parts.length === 0) return;
    segment.innerHTML = parts.join('');
  },

  _ensureIteration(container, iteration) {
    // 确保 trace-wrapper 存在
    let traceWrapper = container.querySelector('.react-trace-wrapper');
    if (!traceWrapper) {
      traceWrapper = document.createElement('div');
      traceWrapper.className = 'react-trace-wrapper';
      // 保险：若容器中已存在 narrative 段或分隔线（罕见的"narrative 先到"），把 wrapper 顶到最前
      const firstNarrative = container.querySelector('.react-narrative-segment, .react-trace-divider');
      if (firstNarrative) {
        container.insertBefore(traceWrapper, firstNarrative);
      } else {
        container.appendChild(traceWrapper);
      }
      container.classList.add('react-trace-streaming');
    }

    let iterEl = traceWrapper.querySelector(`.react-iteration[data-iteration="${iteration}"]`);
    if (!iterEl) {
      // 取消前一个活跃迭代，并自动收起其展开（除非用户手动 pin 过）
      traceWrapper.querySelectorAll('.react-iteration--active').forEach(el => {
        el.classList.remove('react-iteration--active');
        const prevHeader = el.querySelector('.react-thinking-header');
        if (prevHeader && !prevHeader.dataset.userPinned) {
          prevHeader.classList.remove('expanded');
        }
      });

      iterEl = document.createElement('div');
      iterEl.className = 'react-iteration react-iteration--active';
      iterEl.dataset.iteration = String(iteration);
      iterEl.dataset.startTime = String(performance.now());

      const node = document.createElement('div');
      node.className = 'react-timeline-node';
      const dot = document.createElement('div');
      dot.className = 'react-timeline-dot';
      // dot 的 label 由插入后的 DOM 位置决定（见下方 _relabelIterationDots 调用），
      // 不再用 iteration 数值映射——并行 pipeline 下 Branch A/B 事件到达顺序与 iteration
      // 数值不一致（B 的小 read 常先到），且 Branch B 链可提前终止跳过 iteration=4，
      // 用 iteration 数值映射会出现"II,I,III 顺序乱"和"III→V 漏 IV"。改用 DOM 位置后
      // 永远连号且语义顺序对齐（见下方 insertBefore 的升序插入）。
      node.appendChild(dot);

      const body = document.createElement('div');
      body.className = 'react-iteration-body';

      // Thinking header: [工具名] [推理中... / 已推理 Xs]
      // 默认展开当前活跃迭代，让用户实时看到工具调用细节
      const thinkingHeader = document.createElement('div');
      thinkingHeader.className = 'react-thinking-header expanded';

      const toolsSpan = document.createElement('span');
      toolsSpan.className = 'react-thinking-tools';

      const statusSpan = document.createElement('span');
      statusSpan.className = 'react-thinking-status react-thinking-status--active';
      const i18n = typeof i18nService !== 'undefined' ? i18nService : null;
      statusSpan.textContent = i18n?.t?.('react.thinking') || '推理中';

      const expandIcon = document.createElement('span');
      expandIcon.className = 'react-thinking-expand-icon';
      expandIcon.textContent = '\u25b8';

      thinkingHeader.appendChild(toolsSpan);
      thinkingHeader.appendChild(statusSpan);
      thinkingHeader.appendChild(expandIcon);

      // 可展开详情容器
      const details = document.createElement('div');
      details.className = 'react-thinking-details';

      thinkingHeader.addEventListener('click', () => {
        if (details.children.length > 0) {
          thinkingHeader.classList.toggle('expanded');
          // 标记为用户手动 pin，后续自动折叠会跳过此 header
          thinkingHeader.dataset.userPinned = '1';
        }
      });

      body.appendChild(thinkingHeader);
      body.appendChild(details);

      iterEl.appendChild(node);
      iterEl.appendChild(body);
      // 按 iteration 数值升序插入——并行 pipeline 下 Branch B 的小 read 可能先于 Branch A
      // 的 narrative 返回，事件到达顺序乱但语义顺序固定（iter 1 < 2 < 3 < ... < 7 < force(999)）。
      // 找第一个 iteration 数值 > 当前的兄弟节点，插在它之前；若没找到（当前是最大），追加到末尾。
      const siblings = traceWrapper.querySelectorAll('.react-iteration');
      let insertBeforeNode = null;
      for (const sib of siblings) {
        const sibIter = parseInt(sib.dataset.iteration, 10);
        if (Number.isFinite(sibIter) && sibIter > iteration) {
          insertBeforeNode = sib;
          break;
        }
      }
      if (insertBeforeNode) {
        traceWrapper.insertBefore(iterEl, insertBeforeNode);
      } else {
        traceWrapper.appendChild(iterEl);
      }
      // 重排后所有 dot 的 label 都要按 DOM 位置刷一遍，保证连号（不漏号、不错位）。
      this._relabelIterationDots(traceWrapper);

      // 仅在 strip 首次创建时设默认折叠态——后续新迭代到来不再覆盖用户的点击切换。
      // 这样流式中没有高度跳变，finalize 时也不会跳动；用户手动展开后保持展开。
      const firstTime = !container.querySelector('.react-trace-summary-strip');
      this._buildSummaryStrip(container, traceWrapper);
      if (firstTime) {
        container.classList.add('react-trace-collapsed');
      }
    }

    return iterEl.querySelector('.react-iteration-body');
  },

  // 按 DOM 位置重排所有 .react-timeline-dot 的 label。
  // 调用时机：每次 _ensureIteration 插入新 iter 节点后（可能是中间位置插入，导致后续节点 label 需顺移）。
  _relabelIterationDots(traceWrapper) {
    const romans = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
    const iters = traceWrapper.querySelectorAll('.react-iteration');
    iters.forEach((iter, idx) => {
      const dot = iter.querySelector('.react-timeline-dot');
      if (dot) dot.textContent = romans[idx] || String(idx + 1);
    });
  },

  // ========================================
  // 确保叙事分隔线存在
  // ========================================
  _ensureTraceDivider(container) {
    if (container.querySelector('.react-trace-divider')) return;
    // 仅在有 trace-wrapper（即有工具调用）时才插入分隔线
    if (!container.querySelector('.react-trace-wrapper')) return;
    const divider = document.createElement('div');
    divider.className = 'react-trace-divider';
    divider.textContent = '— Story —';
    container.appendChild(divider);
  },

  // 第一段叙事到达时调用一次：把所有非 user-pinned 的 expanded 收掉，
  // 让出垂直空间给叙事。容器上 dataset 标记防止重复触发。
  _onNarrativeStart(container) {
    if (!container || container.dataset.narrativeStarted) return;
    container.dataset.narrativeStarted = '1';
    container.querySelectorAll('.react-thinking-header.expanded').forEach(h => {
      if (!h.dataset.userPinned) h.classList.remove('expanded');
    });
    container.querySelectorAll('.react-iteration--active').forEach(
      el => el.classList.remove('react-iteration--active')
    );
  },

  // ========================================
  // 折叠 ReAct trace（完成后调用）
  // ========================================
  _collapseReactTrace(container) {
    if (!container) return;
    const traceWrapper = container.querySelector('.react-trace-wrapper');
    if (!traceWrapper || traceWrapper.children.length === 0) return;

    // 移除骨架摘要栏（如有）
    const skeleton = container.querySelector('.react-trace-summary');
    if (skeleton) skeleton.remove();

    // 兜底：将任何仍处于 active 的 thinking 状态切换为 done
    const i18n = typeof i18nService !== 'undefined' ? i18nService : null;
    traceWrapper.querySelectorAll('.react-thinking-status--active').forEach(s => {
      s.classList.remove('react-thinking-status--active');
      s.classList.add('react-thinking-status--done');
      const iterEl = s.closest('.react-iteration');
      const durationMs = parseFloat(iterEl?.dataset.durationMs || '');
      if (Number.isFinite(durationMs) && durationMs >= 0) {
        const template = i18n?.t?.('react.thoughtFor') || '已推理 {n}s';
        s.textContent = template.replace('{n}', this._formatThoughtSeconds(durationMs));
      } else {
        const startTime = parseFloat(iterEl?.dataset.startTime || '0');
        if (startTime > 0) {
          const template = i18n?.t?.('react.thoughtFor') || '已推理 {n}s';
          s.textContent = template.replace('{n}', this._formatThoughtSeconds(performance.now() - startTime));
        }
      }
    });

    // 移除活跃迭代标记
    traceWrapper.querySelectorAll('.react-iteration--active').forEach(
      el => el.classList.remove('react-iteration--active')
    );

    // 兜底移除非 user-pinned 的 expanded
    traceWrapper.querySelectorAll('.react-thinking-header.expanded').forEach(h => {
      if (!h.dataset.userPinned) h.classList.remove('expanded');
    });

    // 幂等创建/更新摘要条；
    // 不覆盖 collapsed 类——若用户在流式中点击展开过，保留其展开态，避免 finalize 时
    // 气泡骤缩、scrollTop 被浏览器 clamp 到小值导致页面跳到 bubble 顶部
    this._buildSummaryStrip(container, traceWrapper);
  },

  // 幂等构建/更新折叠态摘要条
  _buildSummaryStrip(container, traceWrapper) {
    const iterations = traceWrapper.querySelectorAll('.react-iteration');
    if (iterations.length === 0) return;

    let strip = container.querySelector('.react-trace-summary-strip');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'react-trace-summary-strip';
      strip.addEventListener('click', () => {
        container.classList.toggle('react-trace-collapsed');
      });
      container.insertBefore(strip, traceWrapper);
    }

    const romans = ['I','II','III','IV','V','VI','VII','VIII','IX','X'];
    const labels = [];
    iterations.forEach((_, idx) => labels.push(romans[idx] || String(idx + 1)));

    const i18n = typeof i18nService !== 'undefined' ? i18nService : null;
    // 使用容器流式标记（整轮流式状态），而非单个 iter 的 status——避免每 iter 完成时短暂闪烁
    const isStreaming = container.classList.contains('react-trace-streaming');

    // 最后一个迭代的工具名 span（含每个工具自带颜色的子 span）
    const lastIter = iterations[iterations.length - 1];
    const lastToolsSpan = lastIter?.querySelector('.react-thinking-tools');
    const hasTools = !!(lastToolsSpan && lastToolsSpan.childNodes.length > 0);

    // 重建内容。变长部分全装进单个 content 容器——CSS 给它单行+省略号，
    // ▸ 折叠箭头(::after)留在右侧不被挤掉；写不下自动 … 截断（铁律：从头到尾只占一行）
    strip.textContent = '';
    const contentEl = document.createElement('span');
    contentEl.className = 'react-trace-summary-content';

    const itersSpan = document.createElement('span');
    itersSpan.textContent = labels.join(' → ');
    contentEl.appendChild(itersSpan);

    if (isStreaming) {
      // 流式中：显示"推理中…"（复用 active 类的三点动画），后接当前工具名（空格分隔，自然阅读）
      contentEl.appendChild(document.createTextNode(' · '));
      const statusSpan = document.createElement('span');
      statusSpan.className = 'react-thinking-status--active';
      statusSpan.textContent = i18n?.t?.('react.thinking') || '推理中';
      contentEl.appendChild(statusSpan);
      if (hasTools) {
        contentEl.appendChild(document.createTextNode(' '));
        contentEl.appendChild(this._cloneToolNamesSpan(lastToolsSpan));
      }
    } else {
      // 完成态：累计耗时 · 工具名（历史回放无计时数据则跳过耗时）
      // 优先按 dataset.durationMs 在毫秒级累加（最精确）；无该属性的 iter 退回
      // 解析已渲染文本——正则放宽到带小数（否则「1.4s」会被旧 /(\d+)\s*s/ 误抓成 4）
      let totalMs = 0;
      iterations.forEach(iter => {
        const d = parseFloat(iter.dataset.durationMs || '');
        if (Number.isFinite(d) && d >= 0) {
          totalMs += d;
          return;
        }
        const status = iter.querySelector('.react-thinking-status--done');
        const m = status?.textContent?.match(/([\d.]+)\s*s/);
        if (m) totalMs += parseFloat(m[1]) * 1000;
      });
      if (totalMs > 0) {
        const thoughtTpl = i18n?.t?.('react.thoughtFor') || '已推理 {n}s';
        contentEl.appendChild(document.createTextNode(' · ' + thoughtTpl.replace('{n}', this._formatThoughtSeconds(totalMs))));
      }
      if (hasTools) {
        contentEl.appendChild(document.createTextNode(' · '));
        contentEl.appendChild(this._cloneToolNamesSpan(lastToolsSpan));
      }
    }

    strip.appendChild(contentEl);
  },

  // 把毫秒耗时格式化成「已推理 {n}s」的 {n}：<10s 一位小数（去尾零），≥10s 取整
  _formatThoughtSeconds(ms) {
    const s = ms / 1000;
    if (s >= 10) return String(Math.round(s));
    return s.toFixed(1).replace(/\.0$/, '');
  },

  // 克隆迭代里的 tools span（含已上色的子 span）到摘要条上，保留每个工具的独立颜色
  _cloneToolNamesSpan(source) {
    const clone = document.createElement('span');
    clone.className = 'react-thinking-tools';
    source.childNodes.forEach(n => clone.appendChild(n.cloneNode(true)));
    return clone;
  },

  // ========================================
  // 从 functionCalls 数据重建 ReAct trace 区域
  // ========================================
  _rebuildReactTrace(container, functionCalls) {
    if (!container || !functionCalls || functionCalls.length === 0) return false;
    const allCalls = [];
    functionCalls.forEach(group => {
      if (group.calls) allCalls.push(...group.calls);
    });
    // 只有包含 result 的数据才重建 trace
    if (!allCalls.some(c => c.result != null)) return false;
    container.innerHTML = '';
    allCalls.forEach(c => container.appendChild(this._createToolCard(c)));
    container.style.display = '';
    return true;
  },

  // ========================================
  // 从 reactSegments + functionCalls 重建交错显示区域
  // ========================================
  _rebuildInterleavedTrace(container, functionCalls, reactSegments) {
    if (!container) return false;
    container.innerHTML = '';
    container.classList.remove('react-trace-streaming', 'react-trace-collapsed');

    if (reactSegments && reactSegments.length > 0) {
      let hasNarrative = false;

      for (const seg of reactSegments) {
        if (seg.type === 'tools') {
          // 工具调用 → 进入迭代时间线（紧凑模式）
          const group = functionCalls?.find(g => g.iteration === seg.iteration);
          if (group?.calls) {
            const body = this._ensureIteration(container, seg.iteration);

            // 更新 thinking header 工具名（每个工具按自己的前缀上色）
            const toolsSpan = body.querySelector('.react-thinking-tools');
            if (toolsSpan) {
              this._fillToolNamesSpan(toolsSpan, group.calls.map(c => c.name));
            }

            // 历史数据无计时 — 移除 active 动画，清空状态文字
            const statusSpan = body.querySelector('.react-thinking-status');
            if (statusSpan) {
              statusSpan.classList.remove('react-thinking-status--active');
              statusSpan.classList.add('react-thinking-status--done');
              statusSpan.textContent = '';
            }

            // 工具卡片放入隐藏详情
            const details = body.querySelector('.react-thinking-details');
            const toolGroup = document.createElement('div');
            toolGroup.className = 'react-tool-group';
            toolGroup.dataset.iteration = seg.iteration;
            group.calls.forEach(c => toolGroup.appendChild(this._createToolCard(c)));
            if (details) {
              details.appendChild(toolGroup);
            } else {
              body.appendChild(toolGroup);
            }
          }
        } else if (seg.type === 'narrative' && seg.text?.trim()) {
          // 叙事 → 在 trace-wrapper 外面（不受折叠影响）
          if (!hasNarrative) {
            this._ensureTraceDivider(container);
            hasNarrative = true;
          }
          const narrativeBlock = document.createElement('div');
          narrativeBlock.className = 'game-narrative react-narrative-segment';
          narrativeBlock.dataset.iteration = seg.iteration;
          narrativeBlock.dataset.segmentType = 'narrative';
          narrativeBlock.dataset.srcText = seg.text;   // L3 判重源文本（与流式/finalize 路径口径一致）
          narrativeBlock.innerHTML = window.htmlSecurity
            ? window.htmlSecurity.markdownToSafeHtml(seg.text)
            : seg.text.replace(/\n/g, '<br>');
          container.appendChild(narrativeBlock);
        } else if ((seg.type === 'text' || seg.type === 'commentary') &&
                   (seg.text?.trim() || seg.reasoning?.trim())) {
          // 推理/评论 → 进入迭代时间线
          const body = this._ensureIteration(container, seg.iteration);
          const commentaryBlock = document.createElement('div');
          commentaryBlock.className = 'react-commentary-segment';
          commentaryBlock.dataset.iteration = seg.iteration;
          commentaryBlock.dataset.segmentType = 'commentary';
          this._renderCommentarySegment(commentaryBlock, seg.text, seg.reasoning);
          body.appendChild(commentaryBlock);
        }
      }

      // 移除流式标记，添加折叠摘要
      container.classList.remove('react-trace-streaming');
      this._collapseReactTrace(container);

      container.style.display = '';
      return container.children.length > 0;
    }

    // 旧数据回退：扁平化工具卡片（无 reactSegments 时，不创建时间线）
    if (!functionCalls || functionCalls.length === 0) return false;
    const allCalls = [];
    functionCalls.forEach(group => { if (group.calls) allCalls.push(...group.calls); });
    if (!allCalls.some(c => c.result != null)) return false;
    allCalls.forEach(c => container.appendChild(this._createToolCard(c)));
    container.style.display = '';
    return true;
  },

  // ========================================
  // 填充 Reasoning 槽位
  // ========================================
  _fillReasoningSlot(slot, reasoningContents) {
    const phaseNames = {
      react: '🔧 ReAct 流水线',
      gm_decision: '🎯 GM 决策',
      npc_reaction: '👥 NPC 反应',
      ooc: '🎙️ OOC 元指令',
    };
    const totalChars = reasoningContents.reduce((sum, item) => sum + item.content.length, 0);
    const allContent = reasoningContents
      .map((item, idx) => {
        const phaseName = phaseNames[item.phase] || `阶段 ${idx + 1}`;
        const escapedContent = item.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="process-phase-title">${phaseName}</div><div class="process-phase-content">${escapedContent}</div>`;
      })
      .join('<hr class="process-divider">');

    slot.innerHTML = `<div class="process-reasoning-wrap">${allContent}</div>`;

    const bar = slot.closest('.ai-process-bar');
    const tab = bar ? bar.querySelector('.tab[data-tab="reasoning"]') : null;
    if (tab) {
      tab.innerHTML = `🧠 推理过程 <span class="process-meta">${totalChars} 字</span>`;
      tab.classList.remove('skeleton-row');
    }
  },

  // ========================================
  // 填充 NPC 反应 debug 槽位（过程面板标签页）
  // ========================================
  _fillNpcReactionSlot(slot, reactions) {
    if (!Array.isArray(reactions) || reactions.length === 0) return;

    const esc = t => (t || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const content = reactions
      .map(r => {
        const d = r.decision;
        if (d) {
          // 结构化决策展示
          const lines = [`<strong class="npc-reaction-name">${esc(r.name)}</strong>`];
          if (d.action) lines.push(`<div>行动: ${esc(d.action)}</div>`);
          if (d.location) lines.push(`<div>位置: ${esc(d.location)}</div>`);
          if (d.social_target) lines.push(`<div>互动: ${esc(d.social_target)}</div>`);
          if (d.mood) lines.push(`<div>情绪: ${esc(d.mood)}</div>`);
          if (d.inner_thought) lines.push(`<div>内心: ${esc(d.inner_thought)}</div>`);
          return `<div class="npc-reaction-item">${lines.join('')}</div>`;
        }
        return (
          `<div class="npc-reaction-item">` +
          `<strong class="npc-reaction-name">${esc(r.name)}</strong>` +
          `<div class="npc-reaction-text">${esc(r.text)}</div></div>`
        );
      })
      .join('');
    slot.innerHTML = `<div class="process-reasoning-wrap">${content}</div>`;

    const bar = slot.closest('.ai-process-bar');
    const tab = bar ? bar.querySelector('.tab[data-tab="npcReaction"]') : null;
    if (tab) {
      const structured = reactions.filter(r => r.decision).length;
      const label = structured > 0 ? '🎭 NPC决策' : '🎭 NPC反应';
      tab.innerHTML = `${label} <span class="process-meta">${reactions.length}人</span>`;
      tab.classList.remove('skeleton-row');
    }
  },

  // ========================================
  // 填充 NPC 角色动态区块（叙事下方玩家可见）
  // ========================================
  _fillNpcActionsSection(slot, reactions) {
    if (!Array.isArray(reactions) || reactions.length === 0) return;

    const esc = t => (t || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const i18n = typeof i18nService !== 'undefined' ? i18nService : null;
    const headerText = i18n?.t?.('npc_actions_header') || '角色动态';
    const thoughtLabel = i18n?.t?.('npc_inner_thought') || '内心';

    const cards = reactions
      .filter(r => r.decision)
      .map(r => {
        const d = r.decision;
        const initial = (r.name || '?')[0].toUpperCase();
        const moodTag = d.mood ? `<span class="npc-action-mood">${esc(d.mood)}</span>` : '';
        const thought = d.inner_thought
          ? `<div class="npc-action-thought">${esc(thoughtLabel)}：${esc(d.inner_thought)}</div>`
          : '';
        const location = d.location ? `<span class="npc-action-location">${esc(d.location)}</span>` : '';

        return `<div class="npc-action-card" data-npc-id="${esc(r.npcId || '')}">
          <div class="npc-action-avatar">${esc(initial)}</div>
          <div class="npc-action-content">
            <div class="npc-action-header">
              <span class="npc-action-name">${esc(r.name)}</span>
              ${moodTag}
              ${location}
            </div>
            <div class="npc-action-desc">${esc(d.action || '')}</div>
            ${thought}
          </div>
        </div>`;
      })
      .join('');

    if (cards) {
      slot.innerHTML = `<div class="npc-actions-section">
        <div class="npc-actions-section-header">${esc(headerText)}</div>
        ${cards}
      </div>`;
    }
  },

  // ========================================
  // 填充 Step 2 选项槽位
  // ========================================
  _fillStep2ChoicesSlot(slot, choicesText) {
    const escaped = choicesText.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    slot.innerHTML = `<div class="process-pre-wrap">${escaped}</div>`;
  },

  // ========================================
  // 填充 Step 2 选项槽位（空状态）
  // ========================================
  _fillStep2ChoicesEmpty(slot) {
    slot.innerHTML = `<div class="process-empty-muted">暂无选项</div>`;
  },

  // ========================================
  // [废弃] 填充选项 - 已由 EventBus AI_NARRATIVE_COMPLETE 事件替代
  // ========================================
  fillStep2Choices(_narrativeText) {
    console.warn(
      '[StreamVisualizer] fillStep2Choices 已废弃，请使用 EventBus AI_NARRATIVE_COMPLETE 事件'
    );
    // 保留空实现以防旧代码调用
  },

  // ========================================
  // 渲染 Metrics Bar（公共函数，供 chatCore.js 复用）
  // 返回完整的 metrics-bar HTML 字符串
  // ========================================
  renderMetricsBar(metrics) {
    if (
      !metrics ||
      metrics.ttft === null ||
      metrics.ttft === undefined ||
      metrics.totalTime === null ||
      metrics.totalTime === undefined
    ) {
      return '';
    }

    const totalSec = (metrics.totalTime / 1000).toFixed(2);

    // phase 到显示标签和价格 key 的映射
    const phaseConfig = {
      react: { label: 'ReAct', priceKey: 'react' },
      // gm_decision 是纯代码步骤，不参与 token 和费用统计
    };
    // 子代理（与主循环并行）显示名——token/费用计入，耗时不计入总时间
    const subagentLabel = {
      npc_reaction: 'NPC 反应',
      npc_card_sync: 'NPC 卡片同步',
      npc_intro_audit: 'Him',
    };

    // 判断是否为单 step 多迭代（ReAct 架构）
    const singleStepIterations = metrics.steps?.length === 1 && metrics.steps[0].perIteration?.length > 1
      ? metrics.steps[0].perIteration : null;

    // 构建时间 tooltip HTML 内容（详细的阶段/迭代时间）
    const timeTooltipLines = [];
    if (singleStepIterations) {
      singleStepIterations.forEach(iter => {
        const label = iter.iteration === 9 ? '回合选项' : `轮次 ${iter.iteration}`;
        const stepTtft = (iter.ttft / 1000).toFixed(1);
        const stepTotal = (iter.totalTime / 1000).toFixed(1);
        timeTooltipLines.push(
          `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${label}</span><span class="tooltip-value">${stepTtft}s/${stepTotal}s</span></div>`
        );
      });
    } else if (metrics.steps && metrics.steps.length > 1) {
      metrics.steps.forEach(t => {
        const config = phaseConfig[t.phase] || { label: t.phase, priceKey: t.phase };
        const stepTtft = (t.ttft / 1000).toFixed(1);
        const stepTotal = (t.totalTime / 1000).toFixed(1);
        timeTooltipLines.push(
          `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${config.label}</span><span class="tooltip-value">${stepTtft}s/${stepTotal}s</span></div>`
        );
      });
    }
    const timeTooltipHtml =
      timeTooltipLines.length > 0
        ? `<div class="metrics-tooltip">${timeTooltipLines.join('')}</div>`
        : '';

    // Token 信息
    const totalInput = metrics.inputTokens || 0;
    const totalOutput = metrics.outputTokens || 0;
    const hasTokens = totalInput > 0 || totalOutput > 0;

    let tokenGroupHtml = '';
    if (hasTokens) {
      // 构建 token tooltip HTML 内容（详细的阶段/迭代 token，显示原始数字）
      const tokenTooltipLines = [];
      if (singleStepIterations) {
        singleStepIterations.forEach(iter => {
          const label = iter.iteration === 9 ? '回合选项' : `轮次 ${iter.iteration}`;
          const stepIn = iter.inputTokens || 0;
          const stepOut = iter.outputTokens || 0;
          tokenTooltipLines.push(
            `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${label}</span><span class="tooltip-value">${stepIn}/${stepOut}</span></div>`
          );
        });
      } else if (metrics.steps && metrics.steps.length > 1) {
        metrics.steps.forEach(t => {
          const config = phaseConfig[t.phase] || { label: t.phase, priceKey: t.phase };
          const stepIn = t.inputTokens || 0;
          const stepOut = t.outputTokens || 0;
          tokenTooltipLines.push(
            `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${config.label}</span><span class="tooltip-value">${stepIn}/${stepOut}</span></div>`
          );
        });
      }
      // 子代理 token 行（与上方逐迭代/逐阶段对齐，使 tooltip 求和 = 头部总数）
      if (Array.isArray(metrics.subagents)) {
        metrics.subagents.forEach(sa => {
          const label = subagentLabel[sa.phase] || sa.phase;
          tokenTooltipLines.push(
            `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${label}</span><span class="tooltip-value">${sa.inputTokens || 0}/${sa.outputTokens || 0}</span></div>`
          );
        });
      }
      const tokenTooltipHtml =
        tokenTooltipLines.length > 0
          ? `<div class="metrics-tooltip">${tokenTooltipLines.join('')}</div>`
          : '';

      tokenGroupHtml = `
                <span class="metric-group metric-group-tokens">
                    <span class="metric-item metric-tokens">📊 ${this._formatTokenCount(totalInput)}/${this._formatTokenCount(totalOutput)}</span>
                    ${tokenTooltipHtml}
                </span>
            `;
    }

    // 费用信息（需要价格配置和 token 数据）
    let costGroupHtml = '';
    if (metrics.prices && hasTokens && metrics.steps && metrics.steps.length > 0) {
      // 重要：所有计算使用精确浮点数，toFixed() 只在最终显示时使用
      let totalCost = 0; // 精确累加
      const costTooltipLines = [];

      // 确定费用明细的价格（取第一个 step 的 phase 对应价格）
      const mainStep = metrics.steps[0];
      const mainConfig = phaseConfig[mainStep.phase] || { label: mainStep.phase, priceKey: mainStep.phase };
      const mainPrices = metrics.prices[mainConfig.priceKey] || { in: 0, out: 0 };

      if (singleStepIterations) {
        // ReAct 多迭代：按迭代拆分费用明细
        singleStepIterations.forEach(iter => {
          const label = iter.iteration === 9 ? '回合选项' : `轮次 ${iter.iteration}`;
          const inCost = ((iter.inputTokens || 0) * mainPrices.in) / 1000000;
          const outCost = ((iter.outputTokens || 0) * mainPrices.out) / 1000000;
          const iterCost = inCost + outCost;
          totalCost += iterCost;
          costTooltipLines.push(
            `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${label}</span><span class="tooltip-value">$${inCost.toFixed(3)}/$${outCost.toFixed(3)}</span></div>`
          );
        });
      } else {
        metrics.steps.forEach(step => {
          const config = phaseConfig[step.phase] || { label: step.phase, priceKey: step.phase };
          const prices = metrics.prices[config.priceKey] || { in: 0, out: 0 };
          const inCost = ((step.inputTokens || 0) * prices.in) / 1000000;
          const outCost = ((step.outputTokens || 0) * prices.out) / 1000000;
          const stepCost = inCost + outCost;
          totalCost += stepCost;
          costTooltipLines.push(
            `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${config.label}</span><span class="tooltip-value">$${inCost.toFixed(3)}/$${outCost.toFixed(3)}</span></div>`
          );
        });
      }

      // 子代理费用（npc_reaction / npc_card_sync / npc_intro_audit）：
      // 各按自己 phase 的价计入总费用，不动 ReAct 主循环逐迭代明细
      if (Array.isArray(metrics.subagents)) {
        metrics.subagents.forEach(sa => {
          const p = (metrics.prices && metrics.prices[sa.phase]) || { in: 0, out: 0 };
          const inCost = ((sa.inputTokens || 0) * p.in) / 1000000;
          const outCost = ((sa.outputTokens || 0) * p.out) / 1000000;
          totalCost += inCost + outCost;
          const label = subagentLabel[sa.phase] || sa.phase;
          costTooltipLines.push(
            `<div class="tooltip-row tooltip-step"><span class="tooltip-label">${label}</span><span class="tooltip-value">$${inCost.toFixed(3)}/$${outCost.toFixed(3)}</span></div>`
          );
        });
      }

      // 人民币换算，固定汇率 7（基于精确的 totalCost）
      const rmbCost = totalCost * 7;

      const costTooltipHtml =
        costTooltipLines.length > 0
          ? `<div class="metrics-tooltip">${costTooltipLines.join('')}</div>`
          : '';

      costGroupHtml = `
                <span class="metric-group metric-group-cost">
                    <span class="metric-item metric-cost">💰 $${totalCost.toFixed(3)} (RMB ¥${rmbCost.toFixed(2)})</span>
                    ${costTooltipHtml}
                </span>
            `;
    }

    return `
            <div class="metrics-bar metrics-compact">
                <span class="metric-group metric-group-time">
                    <span class="metric-item metric-total">⏱️ ${totalSec}s</span>
                    ${timeTooltipHtml}
                </span>
                ${tokenGroupHtml}
                ${costGroupHtml}
            </div>
        `;
  },

  // ========================================
  // 绑定 Metrics 事件（点击显示/隐藏 tooltip）
  // ========================================
  bindMetricsEvents(container) {
    const metricsBar = container.querySelector('.metrics-bar');
    if (metricsBar) {
      metricsBar.addEventListener('click', e => {
        const group = e.target.closest('.metric-group');
        if (group) {
          // 关闭其他已打开的 tooltip
          document.querySelectorAll('.metric-group.active').forEach(g => {
            if (g !== group) g.classList.remove('active');
          });
          // 切换当前的
          group.classList.toggle('active');
          e.stopPropagation();
        }
      });
    }
  },

  // ========================================
  // 填充 Footer 槽位
  // ========================================
  _fillFooterSlot(slot, bubble, metrics) {
    // 使用 originalIndex（chatHistory 索引），而非 DOM 位置索引
    const msgIndex = bubble.dataset.originalIndex;

    const metricsHtml = this.renderMetricsBar(metrics);
    const actionsHtml =
      typeof window.renderMessageActionsHtml === 'function'
        ? window.renderMessageActionsHtml(msgIndex)
        : `
                <div class="message-actions" data-msg-index="${msgIndex}">
                    <button class="copy-action" data-action="msg-action-btn" title="复制"><span class="icon icon-copy"></span></button>
                    <button class="regenerate-action" data-action="msg-action-btn" title="重新生成"><span class="icon icon-regenerate"></span></button>
                    <button class="delete-action" data-action="msg-action-btn" title="删除"><span class="icon icon-delete"></span></button>
                    <button class="edit-action" data-action="msg-action-btn" title="编辑"><span class="icon icon-edit"></span></button>
                </div>
            `;

    slot.innerHTML = `
            <div class="metrics-placeholder">${metricsHtml}</div>
            ${actionsHtml}
        `;
    slot.style.cssText =
      'display: flex; justify-content: space-between; align-items: center; margin-top: 4px;';

    // 移动端触控支持：点击 metric-group 显示/隐藏 tooltip
    this.bindMetricsEvents(slot);
  },

  // ========================================
  // 渲染推理内容
  // ========================================
  _renderReasoningContent(bubble, reasoningContents) {
    const labelEl = bubble.querySelector('.chat-user-label');
    if (!labelEl || bubble.querySelector('.reasoning-content-bar')) return;

    const phaseNames = {
      react: '🔧 ReAct 流水线',
      gm_decision: '🎯 GM 决策',
      npc_reaction: '👥 NPC 反应',
      ooc: '🎙️ OOC 元指令',
    };
    const totalChars = reasoningContents.reduce((sum, item) => sum + item.content.length, 0);
    const allContent = reasoningContents
      .map((item, idx) => {
        const phaseName = phaseNames[item.phase] || `阶段 ${idx + 1}`;
        const escapedContent = item.content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="process-phase-title">${phaseName}</div><div class="process-phase-content">${escapedContent}</div>`;
      })
      .join('<hr class="process-divider">');

    const reasoningBar = document.createElement('div');
    reasoningBar.className = 'reasoning-content-bar';
    reasoningBar.innerHTML = `
            <details>
                <summary class="reasoning-summary">
                    🧠 推理过程 <span class="reasoning-summary-meta">(${totalChars} 字)</span>
                </summary>
                <div class="reasoning-detail">${allContent}</div>
            </details>
        `;

    const fcBar = bubble.querySelector('.function-calls-bar');
    if (fcBar) {
      fcBar.insertAdjacentElement('afterend', reasoningBar);
    } else {
      labelEl.insertAdjacentElement('afterend', reasoningBar);
    }
  },

  // ========================================
  // 视觉高度锁定/释放：骨架→内容切换瞬间防塌缩
  // 在隐藏骨架屏前调用 _lockGameOutputHeight 把当前 offsetHeight 写为 min-height（幂等），
  // 后续内容增长只会越过 min-height 不受约束，缩小则被 min-height 兜住。
  // 在 finalize / abort 时由 _releaseStreamingHeight 清掉。
  // ========================================
  _lockGameOutputHeight(goEl) {
    if (!goEl || goEl.dataset.heightLocked) return;
    const h = goEl.offsetHeight;
    if (h > 0) {
      goEl.style.minHeight = h + 'px';
      goEl.dataset.heightLocked = 'true';
    }
  },

  _releaseStreamingHeight(bubbleEl) {
    if (!bubbleEl) return;
    const goEl = bubbleEl.querySelector('.game-output');
    if (!goEl) return;
    goEl.style.minHeight = '';
    delete goEl.dataset.heightLocked;
  },

  // ========================================
  // 重置状态
  // ========================================
  reset() {
    if (this.state.updateTimer !== null) {
      clearTimeout(this.state.updateTimer);
    }
    if (this.state.reasoningUpdateTimer !== null) {
      clearTimeout(this.state.reasoningUpdateTimer);
    }

    this.state = {
      isActive: false,
      isNonStreaming: false, // 标记是否为非流式模式
      bubbleElement: null,
      contentElement: null,
      narrativeElement: null,
      statsElement: null,
      requestPresentationConfig: null,
      lastText: '',
      lastTextLength: 0,
      charCount: 0,
      startTime: 0,
      lastChunkTime: 0,
      updateTimer: null,
      pendingText: null,
      pendingReasoning: null,
      reasoningUpdateTimer: null,
      firstContentDisplayed: false, // 标记首次内容是否已显示（用于触发等待计时器停止）
    };

    this._lastUpdateTime = 0;
    this._lastReasoningUpdateTime = 0;
  },

  // ========================================
  // 状态检查
  // ========================================
  isStreaming() {
    return this.state.isActive;
  },

  // updateFunctionCalls — 已移除（fc tab 不再显示）

  // ========================================
  // 提前隐藏不需要的槽位
  // 如果确定没有 FC 或 Reasoning，可以提前隐藏以释放空间
  // ========================================
  hideSlot(slotName) {
    if (!this.state.bubbleElement) return;

    const slot = this.state.bubbleElement.querySelector(`[data-slot="${slotName}"]`);
    if (slot) {
      slot.style.display = 'none';
      slot.classList.remove('stream-slot-skeleton');
    }
  },

  // ========================================
  // 中止流式输出
  // ========================================
  abort() {
    if (this.state.bubbleElement) {
      const contentEl = this.state.bubbleElement.querySelector('.chat-message-content');
      if (contentEl) {
        // 保留已生成的内容，添加中断提示
        const existingNarrative = this.state.narrativeElement?.innerHTML || '';
        contentEl.innerHTML = `
                    <div class="game-output">
                        <div class="game-narrative">${existingNarrative}</div>
                        <div class="streaming-aborted-notice">
                            <span class="abort-icon">⚠️</span>
                            <span class="abort-text">生成已中断</span>
                        </div>
                    </div>
                `;
      }
      this.state.bubbleElement.classList.remove('streaming-state');
      this.state.bubbleElement.classList.add('streaming-aborted');
      this._releaseStreamingHeight(this.state.bubbleElement);
    }
    this.reset();
    console.log('[StreamVisualizer] 流式输出已中止');
  },

  // ========================================
  // 公开方法
  // ========================================
  renderReasoningContent(bubble, reasoningContents) {
    return this._renderReasoningContent(bubble, reasoningContents);
  },
};

// 暴露到全局
window.streamVisualizer = streamVisualizer;

// ========================================
// EventBus 监听器（Step 级别事件 + 整体事件）
// 流式 chunk 通过回调直接传递，Step 完成通知走 EventBus
// ========================================
if (window.eventBus && window.GameEvents) {
  // ReAct 工具调用完成 - 在交错容器中追加工具组（时间线结构）
  eventBus.on(GameEvents.AI_REACT_TOOL_CALL, ({ iteration, calls, durationMs }) => {
    if (!streamVisualizer.isStreaming()) return;
    streamVisualizer._updateStreamProgressText('react');
    const container = streamVisualizer.state.slots?.reactInterleaved;
    if (!container) return;
    // 进入 react-phase；scroll 由浏览器原生 anchoring 维持
    // 骨架屏 NOT 在此处隐藏：trace strip 替代顶部"推理中"行（CSS :has 处理），
    // 下方 shimmer 继续等待真叙事到来；只在叙事真正流式开始时才整体隐藏。
    container.style.display = '';
    const gameOutput = container.closest('.game-output');
    if (gameOutput && !gameOutput.classList.contains('react-phase')) {
      gameOutput.classList.add('react-phase');
      gameOutput.querySelectorAll('.stream-slot[data-slot="status"]:not(.filled), .stream-slot[data-slot="choices"]:not(.filled)').forEach(el => {
        el.style.display = 'none';
      });
    }

    // 创建该迭代的工具组，放入迭代时间线
    const body = streamVisualizer._ensureIteration(container, iteration);
    const iterEl = body.closest('.react-iteration');

    // 更新 thinking header 工具名（每个工具按自己的前缀上色）
    const toolsSpan = body.querySelector('.react-thinking-tools');
    if (toolsSpan) {
      streamVisualizer._fillToolNamesSpan(toolsSpan, calls.map(c => c.name));
    }

    // 工具名已知后立刻更新摘要条（让"推理中… get_state"实时呈现）
    const traceWrapper = container.querySelector('.react-trace-wrapper');
    if (traceWrapper) streamVisualizer._buildSummaryStrip(container, traceWrapper);

    // 计算耗时，更新状态为"已推理 Xs"
    const statusSpan = body.querySelector('.react-thinking-status');
    if (statusSpan) {
      let secText;
      if (typeof durationMs === 'number' && durationMs >= 0) {
        // 权威端到端耗时（adapter callAPI 入口→整段流读完），写 dataset 供摘要条/兜底复用
        if (iterEl) iterEl.dataset.durationMs = String(durationMs);
        secText = streamVisualizer._formatThoughtSeconds(durationMs);
      } else {
        // 兜底：异常/旧回放无 durationMs 时退回 now−startTime
        const startTime = parseFloat(iterEl?.dataset.startTime || '0');
        secText = startTime > 0
          ? streamVisualizer._formatThoughtSeconds(performance.now() - startTime)
          : '0';
      }
      statusSpan.classList.remove('react-thinking-status--active');
      statusSpan.classList.add('react-thinking-status--done');
      const i18n = typeof i18nService !== 'undefined' ? i18nService : null;
      const template = i18n?.t?.('react.thoughtFor') || '已推理 {n}s';
      statusSpan.textContent = template.replace('{n}', secText);
    }

    // 工具卡片放入隐藏的详情容器（点击展开）
    const details = body.querySelector('.react-thinking-details');
    const toolGroup = document.createElement('div');
    toolGroup.className = 'react-tool-group';
    toolGroup.dataset.iteration = iteration;
    for (const call of calls) {
      toolGroup.appendChild(streamVisualizer._createToolCard(call));
    }
    if (details) {
      details.appendChild(toolGroup);
    } else {
      body.appendChild(toolGroup);
    }
  });

  // ReAct 迭代内流式 chunk - 在迭代时间线中流式更新推理文本
  eventBus.on(GameEvents.AI_REACT_ITERATION_STREAM, ({ iteration, text, reasoning }) => {
    if (!streamVisualizer.isStreaming()) return;
    const hasText = !!(text && text.trim());
    const hasReasoning = !!(reasoning && reasoning.trim());
    if (!hasText && !hasReasoning) return;

    const container = streamVisualizer.state.slots?.reactInterleaved;
    if (!container) return;

    const gameOutput = container.closest('.game-output');

    // scroll 由浏览器原生 anchoring 维持
    container.style.display = '';
    if (gameOutput) gameOutput.classList.remove('react-phase');

    // 在迭代 body 中找到或创建推理段落
    const body = streamVisualizer._ensureIteration(container, iteration);
    let segment = body.querySelector(`.react-commentary-segment[data-iteration="${iteration}"]`);
    if (!segment) {
      segment = document.createElement('div');
      segment.className = 'react-commentary-segment';
      segment.dataset.iteration = String(iteration);
      segment.dataset.segmentType = 'commentary';
      body.appendChild(segment);
      // commentary 在折叠态下被隐藏（位于 .react-iteration 内部），
      // 因此不在此隐藏骨架屏；保留 shimmer 等待真叙事。
    }

    streamVisualizer._renderCommentarySegment(segment, text, reasoning);
    // 不更新 narrativeElement — commentary 不是正式叙事
  });

  // ReAct 迭代完成的最终文本段 - 最终化推理段落（移除光标）
  eventBus.on(GameEvents.AI_REACT_ITERATION_TEXT, ({ iteration, text }) => {
    if (!streamVisualizer.isStreaming()) return;
    const container = streamVisualizer.state.slots?.reactInterleaved;
    if (!container) return;

    const body = streamVisualizer._ensureIteration(container, iteration);
    let segment = body.querySelector(`.react-commentary-segment[data-iteration="${iteration}"]`);
    if (!segment) {
      segment = document.createElement('div');
      segment.className = 'react-commentary-segment';
      segment.dataset.iteration = String(iteration);
      segment.dataset.segmentType = 'commentary';
      body.appendChild(segment);
      container.style.display = '';
    }

    const safeHtml = window.htmlSecurity
      ? window.htmlSecurity.markdownToSafeHtml(text)
      : text.replace(/\n/g, '<br>');
    segment.innerHTML = safeHtml;
  });

  // (fc tab 已移除，AI_REACT_COMPLETE 不再需要更新 FC 槽位)

  // 叙事文本流式增量 - 打字机效果（来自 tool args 流式解析）
  let _narrativeStreamRafId = null;
  let _narrativeStreamPending = null;

  // Gemini 专属"假打字机"状态：Gemini 把整段 narrative 一次性塞进 functionCall.args.text，
  // 不像 OpenAI/DeepSeek 是 JSON delta 逐 token 抽出。这里按字符速率推进还原打字感。
  const _geminiTyper = { iteration: -1, target: '', revealed: 0, rafId: null, segment: null };

  function _renderTyperFrame() {
    _geminiTyper.rafId = null;
    if (!streamVisualizer.isStreaming()) {
      _geminiTyper.segment = null;
      return;
    }

    const container = streamVisualizer.state.slots?.reactInterleaved;
    if (!container) return;

    // 受控变更：骨架→首帧 + 假打字机每帧增长
    streamVisualizer._withScrollScope(() => {
      container.style.display = '';
      const gameOutput = container.closest('.game-output');
      if (gameOutput) gameOutput.classList.remove('react-phase');
      const sk = gameOutput?.querySelector('.streaming-skeleton');
      if (sk) {
        streamVisualizer._lockGameOutputHeight(gameOutput);
        sk.style.display = 'none';
      }

      let segment = container.querySelector('.react-narrative-segment[data-streaming]');
      if (!segment) {
        streamVisualizer._onNarrativeStart(container);
        streamVisualizer._ensureTraceDivider(container);
        segment = document.createElement('div');
        segment.className = 'game-narrative react-narrative-segment';
        segment.dataset.segmentType = 'narrative';
        segment.dataset.streaming = 'true';
        container.appendChild(segment);
      }
      _geminiTyper.segment = segment;

      const remaining = _geminiTyper.target.length - _geminiTyper.revealed;
      if (remaining > 0) {
        const step = Math.max(2, Math.ceil(remaining / 60));
        _geminiTyper.revealed = Math.min(_geminiTyper.target.length, _geminiTyper.revealed + step);
      }

      const slice = _geminiTyper.target.slice(0, _geminiTyper.revealed);
      streamVisualizer._renderIncrementalMarkdown(segment, slice, { fixUnclosed: false });
      streamVisualizer.state.narrativeElement = segment;
    });

    if (_geminiTyper.revealed < _geminiTyper.target.length) {
      _geminiTyper.rafId = requestAnimationFrame(_renderTyperFrame);
    }
  }

  eventBus.on(GameEvents.AI_NARRATIVE_STREAM, ({ iteration, text, isBlob }) => {
    if (!streamVisualizer.isStreaming()) return;
    if (!text) return;
    streamVisualizer._updateStreamProgressText('narrative');

    // Gemini 路径：整段 blob → 假打字机逐帧推进
    if (isBlob) {
      if (_geminiTyper.iteration !== iteration) {
        _geminiTyper.iteration = iteration;
        _geminiTyper.revealed = 0;
        _geminiTyper.segment = null;
      }
      _geminiTyper.target = text;
      if (_geminiTyper.rafId == null) {
        _geminiTyper.rafId = requestAnimationFrame(_renderTyperFrame);
      }
      return;
    }

    // OpenAI / DeepSeek 路径：逐 token 增量，原有 rAF 合并 + 整段替换逻辑
    _narrativeStreamPending = { iteration, text };
    if (_narrativeStreamRafId) return;

    _narrativeStreamRafId = requestAnimationFrame(() => {
      _narrativeStreamRafId = null;
      const pending = _narrativeStreamPending;
      if (!pending) return;
      _narrativeStreamPending = null;

      const container = streamVisualizer.state.slots?.reactInterleaved;
      if (!container) return;

      // 受控变更：骨架→首帧 + 增量每帧增长
      streamVisualizer._withScrollScope(() => {
        container.style.display = '';
        const gameOutput = container.closest('.game-output');
        if (gameOutput) gameOutput.classList.remove('react-phase');
        const sk = gameOutput?.querySelector('.streaming-skeleton');
        if (sk) {
          streamVisualizer._lockGameOutputHeight(gameOutput);
          sk.style.display = 'none';
        }

        // 进行中的流式节点 = 当前唯一带 [data-streaming] 的段（ReAct 顺序执行，同一
        // 时刻只有一个活跃流）。**不能**按 [data-iteration=N] 复用：一个 iteration 可
        // 合法产出多段（prompt-gm 的 callsToExecute 循环里可多次 update_narrative），
        // 第 1 段 finalize 删 streaming 后，第 2 段的流式 chunk 必须新建节点而非灌回
        // 第 1 段。仅在新建时写 dataset.iteration（身份/历史重建对齐，非复用 key）。
        const _it = pending.iteration;
        let segment = container.querySelector('.react-narrative-segment[data-streaming]');
        if (!segment) {
          streamVisualizer._onNarrativeStart(container);
          streamVisualizer._ensureTraceDivider(container);
          segment = document.createElement('div');
          segment.className = 'game-narrative react-narrative-segment';
          segment.dataset.segmentType = 'narrative';
          if (_it != null) segment.dataset.iteration = _it;
          segment.dataset.streaming = 'true';
          container.appendChild(segment);
        } else if (_it != null && !segment.dataset.iteration) {
          segment.dataset.iteration = _it;   // 回填：缺稳定 key 的旧瞬态（不跨段劫持）
        }

        streamVisualizer._renderIncrementalMarkdown(segment, pending.text, { fixUnclosed: false });
        streamVisualizer.state.narrativeElement = segment;
      });
    });
  });

  // 叙事显示完成 - 最终化流式段落或创建完整段落（Gemini 等不支持流式的兜底）
  eventBus.on(GameEvents.AI_NARRATIVE_DISPLAY, ({ text, iteration }) => {
    if (!streamVisualizer.isStreaming()) return;
    if (!text) return;
    streamVisualizer._updateStreamProgressText('narrative');

    // 取消 Gemini 假打字机 raf，避免下一帧覆盖即将写入的终态
    if (_geminiTyper.rafId != null) {
      cancelAnimationFrame(_geminiTyper.rafId);
      _geminiTyper.rafId = null;
    }
    _geminiTyper.iteration = -1;
    _geminiTyper.target = '';
    _geminiTyper.revealed = 0;
    _geminiTyper.segment = null;
    const container = streamVisualizer.state.slots?.reactInterleaved;
    if (!container) return;

    // 受控最终化：pinned 焊底 / 非 pinned 钉阅读位（含骨架→首帧兜底）
    streamVisualizer._withScrollScope(() => {
      container.style.display = '';
      const gameOutput = container.closest('.game-output');
      if (gameOutput) gameOutput.classList.remove('react-phase');
      const sk = gameOutput?.querySelector('.streaming-skeleton');
      if (sk) {
        streamVisualizer._lockGameOutputHeight(gameOutput);
        sk.style.display = 'none';
      }

      const _finalize = (el) => {
        streamVisualizer._renderIncrementalMarkdown(el, text, { fixUnclosed: false, finalize: true });
        delete el.dataset.streaming;
        el.dataset.srcText = text;              // L3 判重源文本（归一化前原文，不受 markdown 渲染影响）
        streamVisualizer.state.narrativeElement = el;
      };
      const _track = (reason) => {
        try {
          window.analyticsService?.track?.('ui.narrative_dom_dedupe', {
            iteration: iteration ?? null,
            reason,
          });
        } catch (_) { /* ignore — 正常防御行为，不污染 error.console 基线 */ }
      };

      // ── 正常路径：finalize 当前进行中的流式节点（唯一 [data-streaming]）。这是
      // 合法的本段产出（含一轮多段：每段各有自己的 [data-streaming]），不查重、不报。
      // 不按 [data-iteration] 复用——一个 iteration 可合法多段，按 iteration 复用会
      // 让第 2 段覆盖第 1 段。仅回填 dataset.iteration 作身份/历史对齐。
      const streamingSegment = container.querySelector('.react-narrative-segment[data-streaming]');
      if (streamingSegment) {
        if (iteration != null) streamingSegment.dataset.iteration = iteration;
        _finalize(streamingSegment);
      } else {
        // ── L3 兜底（核心防线）：无进行中流式段 = 要么非流式 provider 首段，要么
        // 是 finalize 之后的二次重复 emit（rescue/iter9 L3 漏过 L1）。append 新建前
        // 无条件扫同容器已有 narrative 段，归一化全文撞了就复用，不新建孤儿。
        // 仅整段完全相等才判重——不同续写段（_dedupeNarrativePrefix 已剥前缀）不会误撞。
        const norm = streamVisualizer._normalizeNarrativeText(text);
        let dup = null;
        if (norm) {
          const segs = container.querySelectorAll('.react-narrative-segment');
          for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            if (s.dataset.streaming) continue;   // 进行中段不参与判重
            const src = (s.dataset.srcText != null) ? s.dataset.srcText : s.textContent;
            if (streamVisualizer._normalizeNarrativeText(src) === norm) { dup = s; break; }
          }
        }
        if (dup) {
          _finalize(dup);
          _track('content-match');
        } else {
          // 非流式 provider 兜底：创建完整段落（行为与旧逻辑一致，仅多写身份属性，纯增益）
          streamVisualizer._onNarrativeStart(container);
          streamVisualizer._ensureTraceDivider(container);
          const segment = document.createElement('div');
          segment.className = 'game-narrative react-narrative-segment';
          segment.dataset.segmentType = 'narrative';
          if (iteration != null) segment.dataset.iteration = iteration;
          streamVisualizer._renderIncrementalMarkdown(segment, text, { fixUnclosed: false, finalize: true });
          segment.dataset.srcText = text;
          container.appendChild(segment);
          streamVisualizer.state.narrativeElement = segment;
        }
      }
    });
  });

  // 叙事完成 - 进入 Step 3（生成状态 + 选项）阶段
  eventBus.on(GameEvents.AI_NARRATIVE_COMPLETE, _payload => {
    streamVisualizer._updateStreamProgressText('finishing');
  });

  // Step 3 完成
  eventBus.on(GameEvents.AI_STEP3_COMPLETE, _payload => {
    // 不再处理选项分离，正文保持原样（含选项）
  });

  // 响应完成 - 填充最终内容（从 payload 直接获取数据）
  eventBus.on(GameEvents.AI_RESPONSE_COMPLETE, payload => {
    if (streamVisualizer.isStreaming()) {
      const {
        narrative,
        narrativeText,
        uid,
        turnNumber,
        metrics,
        functionCalls,
        reasoningContents,
      } = payload;

      streamVisualizer.finish(narrative, {
        uid,
        turnNumber,
        narrativeText,
        metrics,
        functionCalls,
        reasoningContents,
        gameData: payload.gameData,
      });
    }
  });

  // 错误处理 - 中止流式输出
  eventBus.on(GameEvents.AI_ERROR, () => {
    if (streamVisualizer.isStreaming()) {
      streamVisualizer.abort();
    }
  });

  console.log('[StreamVisualizer] EventBus 监听器已注册');
}

// ========================================
// 全局点击监听：点击其他地方关闭所有 metric tooltip
// ========================================
document.addEventListener('click', () => {
  document.querySelectorAll('.metric-group.active').forEach(g => {
    g.classList.remove('active');
  });
});
