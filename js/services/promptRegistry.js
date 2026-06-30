// ============================================
// Prompt Registry — 项目里"一切 prompt 的唯一源"
// ============================================
// 集中管理所有 prompt block：
//   - 主 ReAct 21 块 system blocks（react 通道）
//   - 8 个独立 LLM 通道（panelSkill / inventorySkill / npcReaction / oocRound* / summary / sms / ...）
//   - 所有 tool description 五段（tool.<name>.description）
//   - 跨通道核心（'*' 通道，如 CORE_PROMPT_MERGED）
//
// 设计要点：
//   - 单例 + 自注册（与 toolRegistry 同模式）
//   - assembleChannel 是核心装配 API，自动处理 cacheable 分段、order 排序、condition 过滤
//   - snapshot 记录每次装配的实际注入情况，供 UI / 文档生成器消费
//   - registerToolWithPrompt 是与 toolRegistry 协作的 helper：
//     description 五段进 promptRegistry，schema/execute 留 toolRegistry
// ============================================

class PromptRegistry {
  constructor() {
    /** @type {Map<string, PromptBlock>} */
    this._blocks = new Map();
    /** 工具描述五段缓存：toolName → { description, when_to_call, avoid_when, input_focus, expected_output } */
    this._toolMetaCache = new Map();
    /** 每次 assembleChannel 后的快照，供 UI 消费 */
    this._lastSnapshots = {};
  }

  // ==========================================
  // 注册 / 注销
  // ==========================================

  /**
   * 注册一个 prompt block
   * @param {string} id 唯一 ID（'react.systemBlock.mapContext' / 'tool.update_item.description' / 'core.merged'）
   * @param {object} block PromptBlock schema（见 plan 文档）
   */
  register(id, block) {
    if (!id || typeof id !== 'string') {
      console.warn('[PromptRegistry] 注册失败: 缺少 id');
      return;
    }
    if (!block || typeof block !== 'object') {
      console.warn(`[PromptRegistry] 注册失败: ${id} 缺少 block`);
      return;
    }
    if (this._blocks.has(id)) {
      console.warn(`[PromptRegistry] 重名覆盖: ${id}`);
    }
    this._blocks.set(id, {
      id,
      channel: block.channel || '*',
      category: block.category || 'systemBlock',
      source: block.source || 'static-file',
      origin: block.origin || null,
      description: block.description || '',
      tags: Array.isArray(block.tags) ? block.tags : [],
      cacheable: block.cacheable === true,
      cacheBreakpoint: block.cacheBreakpoint === true,
      // 标记此 block 不参与 assembleChannel（仅供 .get(id).builder() 单独使用）
      // 用于 user trigger 消息 / message format 标签 / 其它 standalone 段
      // 既保留通道归属（inspector / promptviewer 可见），又防止泄漏到 system prompt
      excludeFromAssembly: block.excludeFromAssembly === true,
      condition: typeof block.condition === 'function' ? block.condition : null,
      conditionDesc: block.conditionDesc || (block.condition ? '<custom predicate>' : 'always'),
      builder: typeof block.builder === 'function' ? block.builder : () => '',
      relatedTools: Array.isArray(block.relatedTools) ? block.relatedTools : [],
      order: Number.isFinite(block.order) ? block.order : 0,
      language: block.language || 'auto',
    });
  }

  registerMany(blocks) {
    if (!Array.isArray(blocks)) return;
    for (const b of blocks) {
      if (b && b.id) this.register(b.id, b);
    }
  }

  /** 按 ID 前缀批量注销（动态 tools refresh 用） */
  unregisterByPrefix(prefix) {
    if (!prefix) return 0;
    let n = 0;
    for (const id of Array.from(this._blocks.keys())) {
      if (id.startsWith(prefix)) {
        this._blocks.delete(id);
        n++;
      }
    }
    return n;
  }

  unregister(id) {
    return this._blocks.delete(id);
  }

  // ==========================================
  // 查询
  // ==========================================

  get(id) {
    return this._blocks.get(id) || null;
  }
  has(id) {
    return this._blocks.has(id);
  }
  list() {
    return Array.from(this._blocks.keys());
  }
  get size() {
    return this._blocks.size;
  }

  /** 取指定通道（含 '*' 跨通道）的所有 block */
  getByChannel(channel) {
    if (!channel) return [];
    return Array.from(this._blocks.values()).filter(
      b => b.channel === channel || b.channel === '*'
    );
  }

  getAll() {
    return Array.from(this._blocks.values());
  }

  getByCategory(category) {
    return Array.from(this._blocks.values()).filter(b => b.category === category);
  }

  getByTag(tag) {
    return Array.from(this._blocks.values()).filter(b => b.tags.includes(tag));
  }

  // ==========================================
  // 核心装配
  // ==========================================

  /**
   * 装配指定通道的所有 prompt block
   * @param {string} channel
   * @param {object} ctx 上下文（透传给 builder）
   * @returns {{ parts: Array, snapshot: object }}
   *   parts: [{ text, cacheable, cacheBreakpoint, tag, blockId }]
   *   snapshot: PromptSnapshot（同时存入 _lastSnapshots[channel]）
   */
  assembleChannel(channel, ctx = {}) {
    // 排除规则（仅供 .get(id).builder() 单独使用，不参与 system prompt 装配）：
    //   1. category === 'messageFormat'：天生是包裹 dynamic content 的 wrapper 模板
    //   2. excludeFromAssembly === true：显式标记的 standalone block（如 user trigger 消息）
    const blocks = this.getByChannel(channel).filter(
      b => b.category !== 'messageFormat' && !b.excludeFromAssembly
    );

    // 排序：cacheable=true 先（按 order/注册顺序），cacheable=false 后（按 order/注册顺序）
    const sorted = blocks.slice().sort((a, b) => {
      if (a.cacheable !== b.cacheable) return a.cacheable ? -1 : 1;
      return (a.order || 0) - (b.order || 0);
    });

    const parts = [];
    const injected = [];
    const skipped = [];
    let cacheableChars = 0;
    let volatileChars = 0;

    for (const block of sorted) {
      // condition 过滤
      if (block.condition && typeof block.condition === 'function') {
        try {
          if (!block.condition(ctx)) {
            skipped.push({ blockId: block.id, reason: 'condition_false' });
            continue;
          }
        } catch (e) {
          skipped.push({ blockId: block.id, reason: `condition_error: ${e?.message || e}` });
          continue;
        }
      }

      // builder 调用
      let text = '';
      try {
        const result = block.builder(ctx);
        text = result == null ? '' : String(result);
      } catch (e) {
        console.warn(`[PromptRegistry] builder 抛错: ${block.id}`, e);
        skipped.push({ blockId: block.id, reason: `builder_error: ${e?.message || e}` });
        continue;
      }

      // 空文本跳过
      if (!text || !text.trim()) {
        skipped.push({ blockId: block.id, reason: 'empty_text' });
        continue;
      }

      parts.push({
        text,
        cacheable: block.cacheable,
        cacheBreakpoint: block.cacheBreakpoint,
        tag: block.id,
        blockId: block.id,
      });
      injected.push({
        blockId: block.id,
        length: text.length,
        cacheable: block.cacheable,
        text,
      });
      if (block.cacheable) cacheableChars += text.length;
      else volatileChars += text.length;
    }

    const snapshot = {
      channel,
      timestamp: Date.now(),
      ctxHash: this._hashCtx(ctx),
      // 可选 label：用于累积通道（如 npcReaction）区分多个并发 snapshot；ctx.label 或 ctx.npcId 透传
      contextLabel: ctx?.label || ctx?.npcId || null,
      injected,
      skipped,
      totalChars: cacheableChars + volatileChars,
      cacheable: { count: injected.filter(b => b.cacheable).length, chars: cacheableChars },
      volatile: { count: injected.filter(b => !b.cacheable).length, chars: volatileChars },
    };

    this.recordSnapshot(channel, snapshot);
    return { parts, snapshot };
  }

  // ==========================================
  // 运行时审计
  // ==========================================
  //
  // 普通通道：snapshot 覆盖式，最后一次 assembleChannel 的 snapshot 留下
  // 累积通道（CUMULATIVE_CHANNELS）：snapshot 数组累积，UI 能看到本回合所有调用
  //   - npcReaction：Promise.allSettled 并发多 NPC，覆盖式会让前面 NPC 的 snapshot 丢失

  /**
   * 标记需要累积式 snapshot 的通道
   * 这些通道的 _lastSnapshots[channel] 是数组，每次调用 push 而非覆盖
   * @returns {Set<string>}
   */
  static get CUMULATIVE_CHANNELS() {
    return new Set(['npcReaction']);
  }

  recordSnapshot(channel, snapshot) {
    if (PromptRegistry.CUMULATIVE_CHANNELS.has(channel)) {
      if (!Array.isArray(this._lastSnapshots[channel])) {
        this._lastSnapshots[channel] = [];
      }
      this._lastSnapshots[channel].push(snapshot);
    } else {
      this._lastSnapshots[channel] = snapshot;
    }
  }

  /**
   * 取最后一次 snapshot
   * 累积通道返回数组中最新一个；普通通道返回单 snapshot
   */
  getLastSnapshot(channel) {
    const v = this._lastSnapshots[channel];
    if (Array.isArray(v)) return v[v.length - 1] || null;
    return v || null;
  }

  /**
   * 取累积通道的所有 snapshot 数组（普通通道返回单元素数组）
   */
  getAllSnapshotsForChannel(channel) {
    const v = this._lastSnapshots[channel];
    if (Array.isArray(v)) return [...v];
    if (v) return [v];
    return [];
  }

  getAllSnapshots() {
    // 返回浅拷贝；累积通道仍是数组
    const result = {};
    for (const [ch, val] of Object.entries(this._lastSnapshots)) {
      result[ch] = Array.isArray(val) ? [...val] : val;
    }
    return result;
  }

  /**
   * 清空指定通道的 snapshot（累积通道清数组）
   */
  clearSnapshot(channel) {
    if (PromptRegistry.CUMULATIVE_CHANNELS.has(channel)) {
      this._lastSnapshots[channel] = [];
    } else {
      delete this._lastSnapshots[channel];
    }
  }

  clearSnapshots() {
    this._lastSnapshots = {};
  }

  // ==========================================
  // 工具描述渲染（与 toolRegistry 协作）
  // ==========================================

  /**
   * 渲染单个工具的完整描述（5 段拼合）
   * 与 toolRegistry.getReactLoopDeclarations 当前的拼接逻辑对齐
   */
  _renderToolDescription(toolName) {
    const meta = this._toolMetaCache.get(toolName);
    if (!meta) return '';
    const parts = [meta.description || ''];
    if (meta.when_to_call) parts.push(`调用时机：${meta.when_to_call}`);
    if (meta.avoid_when) parts.push(`避免：${meta.avoid_when}`);
    if (meta.input_focus) parts.push(`输入关注：${meta.input_focus}`);
    if (meta.expected_output) parts.push(`预期输出：${meta.expected_output}`);
    return parts.filter(Boolean).join('\n');
  }

  // ==========================================
  // 内部辅助
  // ==========================================

  _hashCtx(ctx) {
    // 极简 hash：仅用于 UI 显示快照差异（不需密码学强度）
    try {
      const keys = Object.keys(ctx || {}).sort();
      return keys.map(k => `${k}:${typeof ctx[k]}`).join('|');
    } catch {
      return 'hash_err';
    }
  }
}

// 单例
const promptRegistry = new PromptRegistry();
window.promptRegistry = promptRegistry;

// ============================================
// 顶层 helper：registerToolWithPrompt
// 双写：description 五段进 promptRegistry，schema/execute 留 toolRegistry
// ============================================

window.registerToolWithPrompt = function registerToolWithPrompt(name, config) {
  if (!name || !config) {
    console.warn('[registerToolWithPrompt] 缺少 name 或 config');
    return;
  }
  const {
    description,
    when_to_call,
    avoid_when,
    input_focus,
    expected_output,
    parameters,
    execute,
    source,
    phase,
    required,
    trigger,
    triggerHint,
    signal,
    dispatcherManaged,
  } = config;

  // 1. 描述五段进 promptRegistry
  promptRegistry._toolMetaCache.set(name, {
    description: description || '',
    when_to_call: when_to_call || '',
    avoid_when: avoid_when || '',
    input_focus: input_focus || '',
    expected_output: expected_output || '',
  });

  // 注：tool description 的 channel 是 'tool'（独立通道），
  // 不进 'react' 通道的 system prompt 装配——因为 LLM 调用中 tool description
  // 是 payload.tools 字段（adapter 单独处理），不属于 system parts。
  // 但 toolRegistry.getReactLoopDeclarations 用 ID 直接取（promptRegistry.get），
  // 不依赖 channel 装配。
  promptRegistry.register(`tool.${name}.description`, {
    channel: 'tool',
    category: 'toolDescription',
    source: 'tool-meta',
    cacheable: false,
    relatedTools: [name],
    description: `Tool description for ${name}`,
    builder: () => promptRegistry._renderToolDescription(name),
    origin: { symbol: name },
  });

  // 2. schema + execute + 元数据 进 toolRegistry
  if (!window.toolRegistry) {
    console.warn(`[registerToolWithPrompt] toolRegistry 未加载，无法注册 ${name}`);
    return;
  }
  // 注：toolRegistry.register 仍保留接收 description 等参数（暂未瘦身），
  // 这里也把它们传过去保持兼容。后续 toolRegistry 瘦身后改为不传。
  window.toolRegistry.register(name, {
    description,
    when_to_call,
    avoid_when,
    input_focus,
    expected_output,
    parameters,
    execute,
    source,
    phase,
    required,
    trigger,
    triggerHint,
    signal,
    dispatcherManaged,
  });
};

console.log('[PromptRegistry] Initialized');
