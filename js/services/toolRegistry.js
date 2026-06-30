// ============================================
// Tool Registry — 统一工具注册/执行中心
// ============================================
// 仅持有 schema (parameters) + execute + framework metadata (phase / required / trigger / signal / dispatcherManaged)
// 工具描述五段（description / when_to_call / avoid_when / input_focus / expected_output）
// 由 promptRegistry 统一管理；getDeclarations / getReactLoopDeclarations 从 promptRegistry 取 description
// ============================================

class ToolRegistry {
  constructor() {
    /** @type {Map<string, {declaration: Object, execute: Function, source: string, phase, required, ...}>} */
    this._tools = new Map();
  }

  /**
   * 注册一个工具
   * @param {string} name
   * @param {Object} config
   *   description / when_to_call / avoid_when / input_focus / expected_output 字段被本函数忽略
   *   （它们由 registerToolWithPrompt 已写入 promptRegistry._toolMetaCache）
   *   schema + execute + framework meta 才存这里
   * @param {Object} config.parameters - JSON Schema
   * @param {Function} config.execute
   * @param {string} [config.source='static']
   * @param {string|null} [config.phase]
   * @param {boolean} [config.required=false]
   * @param {Function|null} [config.trigger]
   * @param {string|null} [config.triggerHint]
   * @param {string|null} [config.signal]
   * @param {boolean} [config.dispatcherManaged=false]
   */
  register(name, config) {
    if (!name || typeof config?.execute !== 'function') {
      console.warn(`[ToolRegistry] 注册失败: ${name} — 缺少 name 或 execute`);
      return;
    }
    const {
      parameters, execute, source, phase, required,
      trigger, triggerHint, signal, dispatcherManaged,
      // description 等 5 段被忽略（promptRegistry 管理）
    } = config;
    this._tools.set(name, {
      declaration: {
        name,
        parameters: parameters || { type: 'object', properties: {} },
      },
      phase: phase || null,
      required: required === true,
      trigger: typeof trigger === 'function' ? trigger : null,
      triggerHint: typeof triggerHint === 'string' ? triggerHint : null,
      signal: typeof signal === 'string' ? signal : null,
      dispatcherManaged: dispatcherManaged === true,
      execute,
      source: source || 'static',
    });
  }

  /**
   * 工具描述：从 promptRegistry 取（兜底返回空串）
   */
  _getToolDescription(name) {
    const reg = (typeof window !== 'undefined' ? window.promptRegistry : null);
    if (reg && typeof reg._renderToolDescription === 'function') {
      return reg._renderToolDescription(name) || '';
    }
    return '';
  }

  /**
   * 返回所有已注册工具的声明（供 AI 使用）
   * description 从 promptRegistry 取
   * @returns {Array<{name: string, description: string, parameters: Object}>}
   */
  getDeclarations() {
    return Array.from(this._tools.values()).map(t => ({
      name: t.declaration.name,
      description: this._getToolDescription(t.declaration.name),
      parameters: t.declaration.parameters,
    }));
  }

  /**
   * 执行工具
   * @param {string} name - 工具名称
   * @param {Object} args - 参数
   * @returns {Promise<any>} 执行结果，未找到返回 null
   */
  async execute(name, args = {}) {
    const tool = this._tools.get(name);
    if (!tool) return null;
    return tool.execute(args);
  }

  /**
   * 检查工具是否已注册
   */
  has(name) {
    return this._tools.has(name);
  }

  /**
   * 列出所有已注册工具名
   */
  list() {
    return Array.from(this._tools.keys());
  }

  /**
   * 获取已注册工具数量
   */
  get size() {
    return this._tools.size;
  }

  /**
   * 获取单个工具的结构化元数据（从 promptRegistry._toolMetaCache 取）
   */
  getMetadata(name) {
    if (!this._tools.has(name)) return null;
    const cache = window.promptRegistry?._toolMetaCache;
    if (cache && cache.has(name)) {
      return { ...cache.get(name) };
    }
    return {
      description: '',
      when_to_call: '',
      avoid_when: '',
      input_focus: '',
      expected_output: '',
    };
  }

  /**
   * 获取所有工具的结构化元数据
   */
  getAllMetadata() {
    const result = {};
    for (const name of this._tools.keys()) {
      result[name] = this.getMetadata(name);
    }
    return result;
  }

  /**
   * 获取工具的 phase 声明（未声明返回 null）
   */
  getPhase(name) {
    const tool = this._tools.get(name);
    return tool ? tool.phase : null;
  }

  /**
   * 查询工具是否为 required（该阶段结束前必调）
   */
  isRequired(name) {
    const tool = this._tools.get(name);
    return tool ? tool.required === true : false;
  }

  /**
   * 聚合指定阶段所有 required 工具名
   */
  getRequiredToolsForPhase(phase) {
    const result = [];
    for (const [name, tool] of this._tools) {
      if (tool.phase === phase && tool.required === true) {
        result.push(name);
      }
    }
    return result;
  }

  /**
   * 获取工具 trigger 谓词（未声明返回 null）
   */
  getTrigger(name) {
    const tool = this._tools.get(name);
    return tool ? tool.trigger : null;
  }

  /**
   * 获取工具 triggerHint 默认文案（未声明返回 null）
   */
  getTriggerHint(name) {
    const tool = this._tools.get(name);
    return tool ? tool.triggerHint : null;
  }

  /**
   * 获取工具专属 signal 事件名（未声明返回 null）
   */
  getSignal(name) {
    const tool = this._tools.get(name);
    return tool ? tool.signal : null;
  }

  /**
   * 迭代所有已注册工具的完整元数据（含 phase/required/trigger/triggerHint/signal）
   * 供 triggerScanner 等消费者使用
   * @returns {Iterable<[string, {phase, required, trigger, triggerHint, signal}]>}
   */
  *iterMetadata() {
    for (const [name, tool] of this._tools) {
      yield [name, {
        phase: tool.phase,
        required: tool.required,
        trigger: tool.trigger,
        triggerHint: tool.triggerHint,
        signal: tool.signal,
      }];
    }
  }

  /**
   * 返回工具的完整展示元数据（供 toolviewer 显示）
   */
  getDisplayMetadata(name) {
    const tool = this._tools.get(name);
    if (!tool) return null;
    return {
      phase: tool.phase,
      required: tool.required,
      trigger: tool.trigger,
      triggerHint: tool.triggerHint,
      signal: tool.signal,
      dispatcherManaged: tool.dispatcherManaged,
    };
  }

  /**
   * 返回主 ReAct 循环可见的工具声明（排除 dispatcherManaged 工具）
   * description 从 promptRegistry 取
   * @returns {Array<{name: string, description: string, parameters: Object}>}
   */
  getReactLoopDeclarations() {
    return Array.from(this._tools.values())
      .filter(t => !t.dispatcherManaged)
      .map(t => ({
        name: t.declaration.name,
        description: this._getToolDescription(t.declaration.name),
        parameters: t.declaration.parameters,
      }));
  }

  /**
   * 查询工具是否由 SkillDispatcher 管理
   */
  isDispatcherManaged(name) {
    const tool = this._tools.get(name);
    return tool ? tool.dispatcherManaged === true : false;
  }

  /**
   * 按 source 标签批量清除工具（用于动态工具刷新前清理）
   */
  unregisterBySource(source) {
    for (const [name, tool] of this._tools) {
      if (tool.source === source) {
        this._tools.delete(name);
      }
    }
  }
}

const toolRegistry = new ToolRegistry();
window.toolRegistry = toolRegistry;
