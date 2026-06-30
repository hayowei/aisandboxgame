// ============================================
// JSON Renderer - 可扩展的 JSON 渲染器核心
// ============================================
// 插件式架构:各类渲染器独立注册，自动匹配

const jsonRenderer = {
  // 已注册的渲染器列表
  renderers: [],

  /**
   * 注册新的渲染器
   * @param {Object} renderer - 渲染器对象
   * @param {string} renderer.name - 渲染器名称
   * @param {Function} renderer.canRender - 判断是否能渲染此 JSON
   * @param {Function} renderer.render - 渲染 JSON 为 HTML
   * @param {number} [renderer.priority=0] - 优先级(越高越先匹配)
   */
  register(renderer) {
    if (!renderer.name || !renderer.canRender || !renderer.render) {
      console.error('[jsonRenderer] 渲染器缺少必要属性:', renderer);
      return;
    }
    renderer.priority = renderer.priority || 0;
    this.renderers.push(renderer);
    // 按优先级排序
    this.renderers.sort((a, b) => b.priority - a.priority);
    console.log(`[jsonRenderer] 已注册渲染器: ${renderer.name}`);
  },

  /**
   * 匹配合适的渲染器
   * @param {Object} json - 解析后的 JSON 对象
   * @returns {Object|null} 匹配的渲染器或 null
   */
  matchRenderer(json) {
    for (const renderer of this.renderers) {
      if (renderer.canRender(json)) {
        return renderer;
      }
    }
    return null;
  },

  /**
   * 渲染单个 JSON 对象
   * @param {Object} json - JSON 对象
   * @param {string} uid - 该轮对话的唯一标识符
   * @returns {string|null} HTML 字符串或 null
   */
  renderJson(json, uid = null) {
    const renderer = this.matchRenderer(json);
    if (renderer) {
      return renderer.render(json, uid);
    }
    return null;
  },

  /**
   * 包裹多个卡片
   * @param {string[]} cards - 卡片 HTML 数组
   * @returns {string} 包裹后的 HTML
   */
  wrapCards(cards) {
    if (cards.length === 1) {
      return cards[0];
    }
    return '<div class="json-cards-row">' + cards.join('') + '</div>';
  },

  /**
   * 尝试从文本中提取并解析 JSON
   * @param {string} text - 可能包含 JSON 的文本
   * @returns {Object|null} 解析后的 JSON 对象或 null
   */
  tryParseJson(text) {
    if (!text || typeof text !== 'string') return null;

    const trimmed = text.trim();

    // 必须以 { 开头并包含 }
    if (!trimmed.startsWith('{')) return null;

    // 找到最后一个 } 的位置
    const lastBrace = trimmed.lastIndexOf('}');
    if (lastBrace === -1) return null;

    // 提取 JSON 部分
    const jsonStr = trimmed.substring(0, lastBrace + 1);

    try {
      return JSON.parse(jsonStr);
    } catch (e) {
      return null;
    }
  },

  /**
   * 处理消息文本中的 JSON 代码块
   * 支持多种格式:
   * 1. 标准格式: ```json {...} ```
   * 2. 无标记格式: ``` {...} ```
   * 3. 裸露 JSON: {...}
   * @param {string} text - 原始消息文本
   * @param {string} uid - 该轮对话的唯一标识符
   * @returns {string} 处理后的文本
   */
  process(text, uid = null) {
    // 首先尝试标准的 ```json ... ``` 格式
    let result = this.processCodeBlocks(text, uid);

    // 如果没有变化，尝试处理裸露的 JSON
    if (result === text) {
      result = this.processRawJson(text, uid);
    }

    return result;
  },

  /**
   * 处理 ``` 代码块中的 JSON
   * @param {string} text - 原始消息文本
   * @param {string} uid - 该轮对话的唯一标识符
   * @returns {string} 处理后的文本
   */
  processCodeBlocks(text, uid = null) {
    // 入参守卫: undefined/null 直接返回, 避免 line ~135 的 text.slice() 炸。
    // RegExp.exec(undefined) 内部把 undefined 强转成字符串 'undefined' 跑通 regex,
    // 然后到 text.slice() 才在真正的 undefined 上抛 TypeError, 堆栈定位反而到这里。
    if (typeof text !== 'string') return text;
    // 匹配 ```json ... ``` 或 ``` {...} ``` 代码块
    const jsonBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
    const cards = [];
    let lastIndex = 0;
    let result = '';
    let match;
    let hasMatch = false;

    while ((match = jsonBlockRegex.exec(text)) !== null) {
      const beforeText = text.slice(lastIndex, match.index);
      const content = match[1].trim();

      // 检查内容是否看起来像 JSON
      if (!content.startsWith('{')) {
        // 不是 JSON，保留原样
        if (cards.length > 0) {
          result += this.wrapCards(cards);
          cards.length = 0;
        }
        result += beforeText + match[0];
        lastIndex = jsonBlockRegex.lastIndex;
        continue;
      }

      const json = this.tryParseJson(content);
      if (json) {
        const card = this.renderJson(json, uid);

        if (card) {
          hasMatch = true;
          const isConsecutive = cards.length > 0 && beforeText.trim() === '';
          if (isConsecutive) {
            cards.push(card);
          } else {
            if (cards.length > 0) {
              result += this.wrapCards(cards);
              cards.length = 0;
            }
            result += beforeText;
            cards.push(card);
          }
        } else {
          if (cards.length > 0) {
            result += this.wrapCards(cards);
            cards.length = 0;
          }
          result += beforeText + match[0];
        }
      } else {
        if (cards.length > 0) {
          result += this.wrapCards(cards);
          cards.length = 0;
        }
        result += beforeText + match[0];
      }
      lastIndex = jsonBlockRegex.lastIndex;
    }

    if (cards.length > 0) {
      result += this.wrapCards(cards);
    }
    result += text.slice(lastIndex);

    return hasMatch ? result : text;
  },

  /**
   * 处理裸露的 JSON(没有代码块包裹)
   * @param {string} text - 原始消息文本
   * @param {string} uid - 该轮对话的唯一标识符
   * @returns {string} 处理后的文本
   */
  processRawJson(text, uid = null) {
    if (typeof text !== 'string') return text;
    const trimmed = text.trim();

    // 快速检查:必须以 { 开头
    if (!trimmed.startsWith('{')) {
      return text;
    }

    // 尝试解析整个文本作为 JSON
    const json = this.tryParseJson(trimmed);
    if (!json) {
      return text;
    }

    // 尝试渲染
    const card = this.renderJson(json, uid);
    if (card) {
      console.log('[jsonRenderer] 成功处理裸露的 JSON');
      return card;
    }

    return text;
  },
};

window.jsonRenderer = jsonRenderer;
