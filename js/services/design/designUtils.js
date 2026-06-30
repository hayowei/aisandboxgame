/**
 * design/designUtils.js
 * 通用 designConfig 工具集——卡片编辑底层、modal 流、abort handle。
 *
 * 由 mixin 模式扩展 DesignService.prototype，加载顺序在 designService.js 之后。
 *
 * 起源：Phase 3 重写时把旧 design/p3.js 整文件删了，但里面除了「P3 chat session
 * + pending operations + 流式渲染」（已永久废除）以外，还混杂着一组**生产路径**
 * 用的工具——卡片预览面板的删除/编辑/新增按钮、Stage 3 review 的结构化操作 applicator、
 * P1 panel 字段的术语变更回填、abort handle 等：
 *
 *   _addNestedValue / _getNestedValue / _setNestedValue / _deleteNestedValue / _parsePath
 *     ↑ ui.js（删除按钮），_applyP3Operations 内部
 *   _searchReferences                  ↑ ui.js（删除按钮的引用检查）
 *   _showEditModal                     ↑ ui.js（编辑按钮）
 *   _showAddModal                      ↑ ui.js（5 处「新增」按钮）
 *   _buildCharacterDatabaseAddConfig   ↑ _showAddModal 内部
 *   _generateId                        ↑ _showAddModal 内部
 *   _ensureCoreStatusGroups            ↑ p1.js（panel_status 兜底）
 *   _patchStep3FieldFromTermChange     ↑ p1.js（world_terms 单字段回填）
 *   cancelP1Request                    ↑ chatCore.js（取消按钮）
 *   _applyP3Operations + _sanitizeP3Operations + _isDisallowedTimelineIndexedOperation
 *     ↑ reviewAdapters.js（Stage 3 角色卡 commit edit）、design2.js（Stage 3 review 自然语言改写）
 *
 * 文件内方法签名与原 _DesignServiceP3Mixin 中的版本一字不动。
 *
 * 与 P3 chat 状态 (`pendingOperations` / `p3Session.enrichedOps`) 无关——那部分
 * 随 P3 重写永久删除。
 */

class _DesignServiceDesignUtilsMixin {
  // ============================================
  // 嵌套路径访问器
  // ============================================

  /**
   * 新增嵌套路径的值
   * 如果最终目标是数组，push 新元素；否则直接赋值（与 update 相同）
   */
  _addNestedValue(config, target, path, value) {
    const data = config[target];
    if (!data) return;

    const parts = this._parsePath(path);

    // 找到倒数第二层
    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = (typeof parts[i + 1] === 'number') ? [] : {};
      current = current[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (Array.isArray(current[lastKey])) {
      // 目标是数组：push 新元素
      if (Array.isArray(value)) {
        current[lastKey].push(...value);
      } else {
        current[lastKey].push(value);
      }
    } else {
      // 目标不是数组（或不存在）：直接赋值
      current[lastKey] = value;
    }
  }

  /**
   * 读取嵌套路径的值
   */
  _getNestedValue(config, target, path) {
    const data = config[target];
    if (!path) return data; // 顶层标量字段（如 opening_greeting，Wave 1C 顶层）：editTarget 即字段、无子路径
    if (!data) return undefined;

    const parts = this._parsePath(path);
    let current = data;
    for (const part of parts) {
      if (current === undefined || current === null) return undefined;
      current = current[part];
    }
    return current;
  }

  /**
   * 设置嵌套路径的值
   * 支持 "settings.entity_id" 和 "events[3]" 格式
   */
  _setNestedValue(config, target, path, value) {
    if (!path) { config[target] = value; return; } // 顶层标量字段：直接写 config[target]
    const data = config[target];
    if (!data) return;

    const parts = this._parsePath(path);
    if (parts.length === 1) {
      data[parts[0]] = value;
      return;
    }

    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = (typeof parts[i + 1] === 'number') ? [] : {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  /**
   * 删除嵌套路径的值
   */
  _deleteNestedValue(config, target, path) {
    if (!path) { delete config[target]; return; } // 顶层标量字段（开场白用 noDelete 不走此路径）
    const data = config[target];
    if (!data) return;

    const parts = this._parsePath(path);
    if (parts.length === 1) {
      if (Array.isArray(data) && typeof parts[0] === 'number') {
        data.splice(parts[0], 1);
      } else {
        delete data[parts[0]];
      }
      return;
    }

    let current = data;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) return;
      current = current[parts[i]];
    }

    const lastKey = parts[parts.length - 1];
    if (Array.isArray(current) && typeof lastKey === 'number') {
      current.splice(lastKey, 1);
    } else {
      delete current[lastKey];
    }
  }

  /**
   * 解析路径字符串为数组
   * "settings.entity_id" → ["settings", "entity_id"]
   * "events[3]" → ["events", 3]
   * "[3]" → [3]（顶层数组：editTarget 本身就是数组，如 laws/mods/artifacts）
   */
  _parsePath(path) {
    const parts = [];
    for (const segment of path.split('.')) {
      const bareIndex = segment.match(/^\[(\d+)\]$/);
      if (bareIndex) {
        parts.push(parseInt(bareIndex[1], 10));
        continue;
      }
      const arrayMatch = segment.match(/^(\w+)\[(\d+)\]$/);
      if (arrayMatch) {
        parts.push(arrayMatch[1]);
        parts.push(parseInt(arrayMatch[2], 10));
      } else {
        parts.push(segment);
      }
    }
    return parts;
  }

  /**
   * 在所有 designConfig section 中搜索对指定 ID 的文本引用
   * @returns {string[]} 包含引用的 section 标签列表
   */
  _searchReferences(entityId) {
    const refs = [];
    const dc = this.designConfig;
    const searchIn = (obj, sectionLabel) => {
      if (!obj) return;
      const text = JSON.stringify(obj);
      if (text.includes(entityId)) refs.push(sectionLabel);
    };
    searchIn(dc.world_setting, '世界设定');
    searchIn(dc.prompt_modules, '规则系统');
    searchIn(dc.laws, '法则');
    searchIn(dc.mods, '机制');
    searchIn(dc.artifacts, '关键道具');
    searchIn(dc.character_database, '角色数据库');
    searchIn(dc.world_timeline || dc.timeline, '时间线');
    searchIn(dc.character_timelines, '角色时间线');
    return refs;
  }

  // ============================================
  // 核心状态字段兜底
  // ============================================

  /**
   * 确保核心状态字段（datetime/location/money/objective）存在于 panel_status 中
   * 如果被整组 update 或 delete 误删，从默认字段中补回
   */
  _ensureCoreStatusGroups() {
    const s3 = this.designConfig?.step3_fields;
    if (!s3 || !Array.isArray(s3.panel_status)) return;

    const CORE_KEYS = ['datetime', 'location', 'money', 'objective'];
    const builder = window.panelSchemaBuilder;
    if (!builder) return;

    const locale = window.i18nService?.getDesignLanguage?.() || 'zh-CN';
    const defaults =
      typeof builder.getDefaultStatusFields === 'function'
        ? builder.getDefaultStatusFields(locale)
        : JSON.parse(JSON.stringify(builder.DEFAULT_STATUS_FIELDS));
    if (!Array.isArray(defaults)) return;

    for (const key of CORE_KEYS) {
      if (!s3.panel_status.some(g => g && g.key === key)) {
        const fallback = defaults.find(d => d && d.key === key);
        if (fallback) {
          if (key === 'datetime') {
            s3.panel_status.unshift(fallback);
          } else if (key === 'location') {
            const dtIdx = s3.panel_status.findIndex(g => g && g.key === 'datetime');
            s3.panel_status.splice(dtIdx >= 0 ? dtIdx + 1 : 0, 0, fallback);
          } else {
            const locIdx = s3.panel_status.findIndex(g => g && g.key === 'location');
            s3.panel_status.splice(locIdx >= 0 ? locIdx + 1 : s3.panel_status.length, 0, fallback);
          }
          console.warn(`[DesignService] 核心状态字段 "${key}" 被自动恢复`);
        }
      }
    }
  }

  // ============================================
  // 结构化操作 applicator（被 Stage 3 review 共用，不是 P3 chat 专属）
  // ============================================

  _isDisallowedTimelineIndexedOperation(op) {
    if (!op || op.target !== 'timeline') return false;
    if (op.action !== 'update' && op.action !== 'delete') return false;
    if (typeof op.path !== 'string') return false;
    return /^events\[\d+\](?:\.|$)/.test(op.path.trim());
  }

  _sanitizeP3Operations(operations) {
    if (!Array.isArray(operations)) return [];

    const sanitized = [];
    for (const op of operations) {
      if (!op || typeof op !== 'object') {
        console.warn('[DesignService] 跳过非法操作（非对象）:', op);
        continue;
      }

      const target = typeof op.target === 'string' ? op.target : '';
      const action = typeof op.action === 'string' ? op.action : '';
      const path = typeof op.path === 'string' ? op.path : '';

      if (!target || !action || !path) {
        console.warn('[DesignService] 跳过非法操作（缺少 target/action/path）:', op);
        continue;
      }

      // _summary 在 Stage 3 review adapter / P2 review 用例下不一定带；
      // P3 chat 已废除（曾经强校验），保留 warn 不阻拦——其余调用方都不写 _summary 也正常。
      const summaryRaw = typeof op._summary === 'string' ? op._summary.trim() : '';
      if (summaryRaw && !summaryRaw.startsWith('[原始]') && !summaryRaw.startsWith('[级联]')) {
        // 旧 P3 chat prompt 约定 [原始]/[级联] 前缀；外部调用方无此约定不阻拦
      }

      const normalizedOp = {
        ...op,
        target,
        action,
        path,
      };

      if (this._isDisallowedTimelineIndexedOperation(normalizedOp)) {
        console.warn(
          '[DesignService] 拒绝时间线索引 patch，请改用完整 events 数组更新:',
          normalizedOp
        );
        continue;
      }

      if (
        target === 'timeline' &&
        action === 'update' &&
        path === 'events' &&
        !Array.isArray(op.value)
      ) {
        console.warn(
          '[DesignService] 拒绝非法时间线更新：path=events 时 value 必须是完整数组:',
          normalizedOp
        );
        continue;
      }

      // events update 时每条 event 必须含 time/day/location/characters/content
      if (
        target === 'timeline' &&
        action === 'update' &&
        path === 'events' &&
        Array.isArray(op.value)
      ) {
        const REQUIRED_EVENT_FIELDS = ['time', 'day', 'location', 'characters', 'content'];
        const invalidIdx = op.value.findIndex(
          e => !e
            || typeof e !== 'object'
            || REQUIRED_EVENT_FIELDS.some(f => !(f in e) || e[f] === undefined || e[f] === null)
        );
        if (invalidIdx >= 0) {
          console.warn(
            `[DesignService] 拒绝非法时间线更新：events[${invalidIdx}] 缺必填字段（time/day/location/characters/content）:`,
            normalizedOp
          );
          continue;
        }
      }

      if (target === 'timeline' && action === 'delete' && path === 'events') {
        console.warn(
          '[DesignService] 拒绝删除整个 events；请使用 update + events + 完整新数组:',
          normalizedOp
        );
        continue;
      }

      // meta 仅允许 update + name/description
      if (target === 'meta' && action !== 'update') {
        console.warn('[DesignService] meta 仅支持 update 操作:', normalizedOp);
        continue;
      }
      if (target === 'meta' && path !== 'name' && path !== 'description') {
        console.warn('[DesignService] meta 仅支持 path=name 或 path=description:', normalizedOp);
        continue;
      }

      // step3_fields 整组更新时 value 必须是数组
      if (
        target === 'step3_fields' &&
        action === 'update' &&
        (path === 'panel_status' || path === 'panel_npc') &&
        !Array.isArray(op.value)
      ) {
        console.warn('[DesignService] step3_fields 整组更新时 value 必须是数组:', normalizedOp);
        continue;
      }

      // character_database / character_timelines entity-level update: value must be object
      if (
        (target === 'character_database' || target === 'character_timelines') &&
        action === 'update' &&
        !path.includes('.') &&
        !path.includes('[') &&
        (typeof op.value !== 'object' || op.value === null || Array.isArray(op.value))
      ) {
        console.warn(`[DesignService] ${target} 实体更新 value 必须是对象:`, normalizedOp);
        continue;
      }

      sanitized.push(normalizedOp);
    }

    return sanitized;
  }

  /**
   * 应用结构化操作数组到 designConfig（命名是历史遗留——其实不只是 P3 用，
   * Stage 3 review adapter / P2 review 自然语言改写都靠它）
   *
   * ⚠️ 现状（2026-06，新 P3 重写后）：本方法及其私有辅助
   * （_sanitizeP3Operations / _ensureCoreStatusGroups / _isDisallowedTimelineIndexedOperation）
   * 已无 live 调用方——旧 ui.js 删除按钮改调 _deleteNestedValue，p1.js/老 P3 已删，
   * 新 P3 走 js/services/p3/ 的 patchEngine（JSON Patch）。保留作历史参考，未删。
   * （window.step3SchemaBuilder→window.panelSchemaBuilder 的悬空全局已随重写一并改正。）
   */
  _applyP3Operations(operations) {
    const safeOperations = this._sanitizeP3Operations(operations);

    // 备份 step3_fields 元数据，防止被操作覆盖
    const savedWorldTermsSource = this.designConfig.step3_fields?._worldTermsSource;
    const savedSource = this.designConfig.step3_fields?._source;
    let hasStep3FieldsOps = false;

    for (const op of safeOperations) {
      const { target, action, path, value } = op;

      // meta 存储在 designService 实例上，不在 designConfig 中
      if (target === 'meta') {
        if (action === 'update') {
          if (path === 'name') this.worldCardName = typeof value === 'string' ? value : '';
          else if (path === 'description')
            this.worldCardDescription = typeof value === 'string' ? value : '';
        }
        continue;
      }

      // step3_fields 首次被修改时确保有基础结构
      if (target === 'step3_fields') {
        hasStep3FieldsOps = true;
        if (!this.designConfig.step3_fields && action !== 'delete') {
          this.designConfig.step3_fields = { panel_status: [], panel_npc: [] };
        }
      }

      const data = this.designConfig[target];
      if (!data && action !== 'add') {
        console.warn(`[DesignService] 操作目标不存在: ${target}`);
        continue;
      }

      switch (action) {
        case 'update':
          // Character database / timelines entity-level update: merge to prevent field loss
          if (
            (target === 'character_database' || target === 'character_timelines') &&
            typeof path === 'string' &&
            !path.includes('.') &&
            !path.includes('[')
          ) {
            const existing = data?.[path];
            if (
              existing &&
              typeof existing === 'object' &&
              typeof value === 'object' &&
              value !== null
            ) {
              data[path] = { ...existing, ...value };
              break;
            }
          }
          // 保护：整组替换 panel_status 时，保留核心字段
          if (
            target === 'step3_fields' &&
            path === 'panel_status' &&
            Array.isArray(value)
          ) {
            const CORE_KEYS = ['datetime', 'location', 'money', 'objective'];
            const existing = this.designConfig.step3_fields?.panel_status;
            if (Array.isArray(existing)) {
              for (const ck of CORE_KEYS) {
                if (!value.some(g => g && g.key === ck)) {
                  const original = existing.find(g => g && g.key === ck);
                  if (original) value.unshift(original);
                }
              }
            }
          }
          this._setNestedValue(this.designConfig, target, path, value);
          break;

        case 'add':
          if (!this.designConfig[target]) this.designConfig[target] = {};
          this._addNestedValue(this.designConfig, target, path, value);
          break;

        case 'delete':
          // 保护核心状态字段不被删除
          if (target === 'step3_fields' && typeof path === 'string') {
            const m = path.match(/^panel_status\[(\d+)\]$/);
            if (m) {
              const idx = parseInt(m[1], 10);
              const groups = this.designConfig.step3_fields?.panel_status;
              if (Array.isArray(groups) && groups[idx]) {
                const PROTECTED = new Set(['datetime', 'location', 'money', 'objective']);
                if (PROTECTED.has(groups[idx].key)) {
                  console.warn(`[DesignService] 核心状态字段 "${groups[idx].key}" 不可删除，跳过`);
                  break;
                }
              }
            }
          }
          this._deleteNestedValue(this.designConfig, target, path);
          break;

        default:
          console.warn(`[DesignService] 未知操作类型: ${action}`);
      }
    }

    // 回填 step3_fields 元数据（防止整组 update 时丢失）
    if (hasStep3FieldsOps && this.designConfig.step3_fields) {
      this._ensureCoreStatusGroups();
      this.designConfig.step3_fields.panel_npc = this._normalizePanelNpcFields(
        this.designConfig.step3_fields.panel_npc
      );
      if (
        savedWorldTermsSource !== undefined &&
        !this.designConfig.step3_fields._worldTermsSource
      ) {
        this.designConfig.step3_fields._worldTermsSource = savedWorldTermsSource;
      }
      if (savedSource !== undefined && !this.designConfig.step3_fields._source) {
        this.designConfig.step3_fields._source = savedSource;
      }
    }
  }

  // ============================================
  // ID 生成
  // ============================================

  /**
   * 从名称自动生成合法 ID
   * 优先提取括号内英文名，否则用原文做 key
   */
  _generateId(name) {
    if (!name || !name.trim()) return '';
    const trimmed = name.trim();
    // 尝试提取括号中的英文名: "永夜帝国 (The Empire of Evernight)" → "The Empire of Evernight"
    const bracketMatch = trimmed.match(/[（(]\s*([A-Za-z][\w\s'-]+?)\s*[）)]/);
    if (bracketMatch) {
      return bracketMatch[1]
        .trim()
        .toLowerCase()
        .replace(/[\s'-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    }
    // 尝试用纯英文部分
    const englishWords = trimmed.match(/[A-Za-z][\w'-]*/g);
    if (englishWords && englishWords.length > 0) {
      return englishWords
        .join('_')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '');
    }
    // 全中文：直接用中文做 key（designConfig 支持中文 key）
    return trimmed.replace(/[\s\t]+/g, '_').replace(/[()（）/\\]/g, '');
  }

  // ============================================
  // 编辑 Modal（卡片预览的「编辑」按钮）
  // ============================================

  /**
   * 弹出编辑 Modal，直接修改 designConfig 中的值
   */
  _showEditModal(name, editTarget, editPath) {
    // 移除已有 modal
    const existing = document.getElementById('dcv-edit-modal');
    if (existing) existing.remove();

    const rawValue = this._getNestedValue(this.designConfig, editTarget, editPath);
    const isObj = typeof rawValue === 'object' && rawValue !== null;
    const textValue = isObj ? JSON.stringify(rawValue, null, 2) : rawValue || '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'dcv-edit-modal';

    const content = document.createElement('div');
    content.className = 'modal-content dcv-edit-modal-content';

    const title = document.createElement('h2');
    title.className = 'modal-title-with-icon';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'material-symbols-outlined modal-title-icon';
    titleIcon.textContent = 'edit_note';
    const titleText = document.createElement('span');
    titleText.textContent = `编辑：${name}`;
    title.appendChild(titleIcon);
    title.appendChild(titleText);

    const textarea = document.createElement('textarea');
    textarea.id = 'dcv-edit-textarea';
    textarea.value = textValue;

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    // 统一关闭函数（清理监听器 + 移除 DOM）
    const onEsc = e => {
      if (e.key === 'Escape') closeModal();
    };
    const closeModal = () => {
      modal.remove();
      document.removeEventListener('keydown', onEsc);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => {
      let newValue = textarea.value;
      if (isObj) {
        try {
          newValue = JSON.parse(newValue);
        } catch (e) {
          window.showAlertModal('JSON 格式错误', '请检查后重试', null, { icon: 'error' });
          return;
        }
      }
      if (
        editTarget === 'character_database' &&
        newValue &&
        typeof newValue === 'object' &&
        !Array.isArray(newValue)
      ) {
        if ('age' in newValue) {
          delete newValue.age;
        }
        if (
          !Object.prototype.hasOwnProperty.call(newValue, 'birthday') ||
          newValue.birthday === ''
        ) {
          newValue.birthday = null;
        }
        const birthdayValidation = this._validateBirthdayValueForCurrentWorld(newValue.birthday);
        if (!birthdayValidation.ok) {
          window.showAlertModal('生日格式错误', birthdayValidation.message, null, { icon: 'error' });
          return;
        }
      }
      this._setNestedValue(this.designConfig, editTarget, editPath, newValue);
      if (
        editTarget === 'timeline' &&
        this.designConfig?.timeline?.events &&
        typeof timelineService !== 'undefined' &&
        timelineService.sortEventsByDate
      ) {
        timelineService.sortEventsByDate(this.designConfig.timeline.events);
      }
      this._saveDesignConfig();
      this._updatePreviewPanel();
      closeModal();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    content.appendChild(title);
    content.appendChild(textarea);
    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);

    // 点击遮罩关闭
    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });

    // Escape 关闭
    document.addEventListener('keydown', onEsc);

    // 聚焦 textarea
    setTimeout(() => textarea.focus(), 50);
  }

  // ============================================
  // 新增 Modal（卡片预览的「新增」按钮，5 处入口）
  // ============================================

  _buildCharacterDatabaseAddConfig() {
    // Wave 1E 改名：读 panel_fields（旧名 step3_fields 在 live designConfig 永远 undefined → 精度/纪年取不到）
    const timePrecision = this._getTimePrecisionFromStep3Fields(this.designConfig?.panel_fields);
    const timeGroup = Array.isArray(this.designConfig?.panel_fields?.panel_status)
      ? this.designConfig.panel_fields.panel_status.find(group => group?.key === 'datetime')
      : null;
    const timeEra = typeof timeGroup?._era === 'string' ? timeGroup._era : '';
    const fields = [
      { section: '基本信息' },
      { key: 'name', label: '角色名称', type: 'input', placeholder: '例如：Alice、Godwin' },
      { key: 'gender', label: '性别', type: 'input', placeholder: '例如：男、女' },
      {
        key: 'title',
        label: '头衔 / 职称',
        type: 'input',
        placeholder: '例如：永夜女皇、圣骑士团长',
      },
      {
        key: 'birthday',
        label: '生日',
        type: 'input',
        placeholder: this._getBirthdayPlaceholderFromPrecision(timePrecision, timeEra),
      },
      { key: 'origin', label: '出身 / 来源', type: 'input', placeholder: '例如：A国、X国圣城' },
      { section: '外貌与性格' },
      {
        key: 'personality',
        label: '性格特征',
        type: 'input',
        placeholder: '例如：沉稳、忠诚、开朗',
      },
      {
        key: 'appearance',
        label: '外貌描述',
        type: 'input',
        placeholder: '例如：30岁冻龄/苍白/灰瞳/麻木',
      },
      {
        key: 'clothing',
        label: '服装',
        type: 'input',
        placeholder: '例如：破旧黑裙/铅斗篷/铁冠',
      },
    ];

    const fieldMap = new Map();
    for (const field of fields) {
      if (field.key) fieldMap.set(field.key, field);
    }

    // Wave 1E 改名：读 panel_fields（旧名取不到 → 新增角色弹窗的动态字段 meta 全丢）
    const panelNpcFields = Array.isArray(this.designConfig?.panel_fields?.panel_npc)
      ? this.designConfig.panel_fields.panel_npc
      : [];
    const fixedKeys = this._getNpcRuntimeRequiredKeySet();
    let injectedExtraSection = false;

    const applyDynamicMeta = (targetField, panelField) => {
      const desc = typeof panelField.desc === 'string' ? panelField.desc.trim() : '';
      if (Array.isArray(panelField.enum) && panelField.enum.length > 0) {
        targetField.type = 'select';
        targetField.options = panelField.enum.map(option => ({
          value: String(option),
          label: String(option),
        }));
      } else if (panelField.type === 'integer') {
        targetField.type = 'number';
      }
      if (desc) {
        targetField.placeholder = desc;
      }
    };

    const ensureExtraSection = () => {
      if (injectedExtraSection) return;
      fields.push({ section: '角色档案扩展' });
      injectedExtraSection = true;
    };

    for (const panelField of panelNpcFields) {
      if (!panelField || typeof panelField.key !== 'string' || !panelField.key.trim()) continue;
      const rawKey = panelField.key.trim();
      if (fixedKeys.has(rawKey)) continue;

      let saveKey = rawKey;
      let displayKey = rawKey;
      let displayLabel =
        typeof panelField.label === 'string' && panelField.label.trim()
          ? panelField.label.trim()
          : rawKey;

      if (rawKey === 'cognitive_state') {
        saveKey = 'default_cognitive_state';
        displayKey = 'default_cognitive_state';
        displayLabel = '初始认知状态';
      }

      const existingField = fieldMap.get(displayKey);
      if (existingField) {
        existingField.saveKey = saveKey;
        applyDynamicMeta(existingField, panelField);
        continue;
      }

      ensureExtraSection();
      const newField = {
        key: displayKey,
        saveKey,
        label: displayLabel,
        type: 'input',
        placeholder: typeof panelField.desc === 'string' ? panelField.desc.trim() : '',
      };
      applyDynamicMeta(newField, panelField);
      fields.push(newField);
      fieldMap.set(displayKey, newField);
    }

    return {
      title: '新增角色',
      fields,
      save: values => {
        const name = (values.name || '').trim();
        if (!name) {
          window.showAlertModal('提示', '请输入角色名称', null, { icon: 'warning' });
          return false;
        }
        const id = this._generateId(name);
        if (!id) {
          window.showAlertModal('错误', '无法从名称生成有效 ID', null, { icon: 'error' });
          return false;
        }
        if (!this.designConfig.character_database) this.designConfig.character_database = {};
        if (this.designConfig.character_database[id] !== undefined) {
          window.showAlertModal('ID 冲突', `角色「${id}」已存在，请使用不同的名称`, null, { icon: 'error' });
          return false;
        }

        const charObj = {};
        for (const field of fields) {
          if (!field || field.section || !field.key) continue;
          const saveKey = field.saveKey || field.key;
          const rawValue = values[field.key];
          if (field.type === 'number') {
            if (rawValue === '' || rawValue === null || rawValue === undefined) continue;
            const parsed = Number(rawValue);
            if (!Number.isFinite(parsed)) {
              window.showAlertModal('字段错误', `字段「${field.label}」必须是数字`, null, { icon: 'error' });
              return false;
            }
            charObj[saveKey] = Math.trunc(parsed);
            continue;
          }

          const text =
            typeof rawValue === 'string' ? rawValue.trim() : String(rawValue || '').trim();
          if (field.key === 'birthday' && text) {
            const birthdayValidation = this._validateBirthdayValueForCurrentWorld(text);
            if (!birthdayValidation.ok) {
              window.showAlertModal('生日格式错误', birthdayValidation.message, null, { icon: 'error' });
              return false;
            }
          }
          if (field.key === 'birthday') {
            charObj[saveKey] = text || null;
            continue;
          }
          if (text) charObj[saveKey] = text;
        }

        if (!Object.prototype.hasOwnProperty.call(charObj, 'birthday')) {
          charObj.birthday = null;
        }
        this.designConfig.character_database[id] = charObj;
        return true;
      },
    };
  }

  /**
   * 弹出新增 Modal，根据 sectionType 展示结构化表单
   */
  _showAddModal(sectionType) {
    const existing = document.getElementById('dcv-edit-modal');
    if (existing) existing.remove();

    // ── 各区块表单配置 ──
    const configs = {
      prompt_modules: {
        title: '新增规则模块',
        fields: [
          {
            key: 'name',
            label: '模块名称',
            type: 'input',
            placeholder: '例如：战斗系统、魔法规则、社交机制',
          },
          { section: '模块信息' },
          {
            key: 'description',
            label: '模块描述',
            type: 'input',
            placeholder: '简要描述这个规则模块的核心功能',
          },
          {
            key: 'when_to_call',
            label: '调用时机',
            type: 'input',
            placeholder: '什么情况下 AI 应该参考这个规则？',
          },
          {
            key: 'avoid_when',
            label: '避免场景',
            type: 'input',
            placeholder: '什么情况下不应调用这个规则？',
          },
          {
            key: 'input_focus',
            label: '输入重点',
            type: 'input',
            placeholder: '调用时需要关注哪些输入信息？',
          },
          {
            key: 'expected_output',
            label: '预期输出',
            type: 'input',
            placeholder: '调用后应该产生什么样的输出效果？',
          },
          { section: '规则内容' },
          {
            key: 'content',
            label: '详细规则',
            type: 'textarea',
            tall: true,
            placeholder: '详细描述规则的具体内容、机制、数值、触发条件...',
          },
        ],
        save: values => {
          const name = (values.name || '').trim();
          if (!name) {
            window.showAlertModal('提示', '请输入模块名称', null, { icon: 'warning' });
            return false;
          }
          const id = this._generateId(name);
          if (!id) {
            window.showAlertModal('错误', '无法从名称生成有效 ID', null, { icon: 'error' });
            return false;
          }
          if (!this.designConfig.prompt_modules)
            this.designConfig.prompt_modules = { modules: {}, module_meta: {} };
          if (!this.designConfig.prompt_modules.modules)
            this.designConfig.prompt_modules.modules = {};
          if (!this.designConfig.prompt_modules.module_meta)
            this.designConfig.prompt_modules.module_meta = {};
          if (this.designConfig.prompt_modules.modules[id] !== undefined) {
            window.showAlertModal('ID 冲突', `模块「${id}」已存在，请使用不同的名称`, null, { icon: 'error' });
            return false;
          }
          this.designConfig.prompt_modules.modules[id] = values.content || '';
          this.designConfig.prompt_modules.module_meta[id] = {
            description: values.description || '',
            when_to_call: values.when_to_call || '',
            avoid_when: values.avoid_when || '',
            input_focus: values.input_focus || '',
            expected_output: values.expected_output || '',
          };
          return true;
        },
      },
      character_database: this._buildCharacterDatabaseAddConfig(),
      timeline: {
        title: '新增时间线事件',
        fields: [
          { section: '事件信息' },
          { key: 'time', label: '时间', type: 'input', placeholder: '例如：星历118.08' },
          { key: 'day', label: '日期', type: 'input', placeholder: '例如：10日' },
          { key: 'time_str', label: '时刻', type: 'input', placeholder: '例如：09:30' },
          { key: 'location', label: '地点', type: 'input', placeholder: '例如：X国-圣城-大教堂' },
          {
            key: 'characters',
            label: '相关角色',
            type: 'input',
            placeholder: '例如：Godwin / Amelia',
          },
          { section: '事件内容' },
          {
            key: 'content',
            label: '事件描述',
            type: 'textarea',
            tall: true,
            placeholder: '描述事件的详细经过、起因、结果和影响...',
          },
        ],
        save: values => {
          if (!this.designConfig.timeline) this.designConfig.timeline = { events: [] };
          if (!Array.isArray(this.designConfig.timeline.events))
            this.designConfig.timeline.events = [];
          const event = {};
          const eventFields = ['time', 'day', 'location', 'characters', 'content'];
          for (const key of eventFields) {
            const val = (values[key] || '').trim();
            if (val) event[key] = val;
          }
          if (!event.time && !event.content) {
            window.showAlertModal('提示', '请至少填写时间或事件内容', null, { icon: 'warning' });
            return false;
          }
          this.designConfig.timeline.events.push(event);
          if (typeof timelineService !== 'undefined' && timelineService.sortEventsByDate) {
            timelineService.sortEventsByDate(this.designConfig.timeline.events);
          }
          return true;
        },
      },
      // V2 世界时间线（snapshot.world_timeline.events）——卡片预览「时间线」区块的「新增」走这里。
      world_timeline: {
        title: '新增时间线事件',
        fields: [
          { section: '事件信息' },
          { key: 'time', label: '时间', type: 'input', placeholder: '例如：星历118.08' },
          { key: 'day', label: '日期', type: 'input', placeholder: '例如：10日' },
          { key: 'time_str', label: '时刻', type: 'input', placeholder: '例如：09:30' },
          { key: 'location', label: '地点', type: 'input', placeholder: '例如：X国-圣城-大教堂' },
          { key: 'characters', label: '相关角色', type: 'input', placeholder: '例如：Godwin / Amelia' },
          { section: '事件内容' },
          {
            key: 'content',
            label: '事件描述',
            type: 'textarea',
            tall: true,
            placeholder: '描述事件的详细经过、起因、结果和影响...',
          },
        ],
        save: values => {
          if (!this.designConfig.world_timeline || typeof this.designConfig.world_timeline !== 'object')
            this.designConfig.world_timeline = { events: [] };
          if (!Array.isArray(this.designConfig.world_timeline.events))
            this.designConfig.world_timeline.events = [];
          const event = {};
          const eventFields = ['time', 'day', 'time_str', 'location', 'characters', 'content'];
          for (const key of eventFields) {
            const val = (values[key] || '').trim();
            if (val) event[key] = val;
          }
          if (!event.time && !event.content) {
            window.showAlertModal('提示', '请至少填写时间或事件内容', null, { icon: 'warning' });
            return false;
          }
          this.designConfig.world_timeline.events.push(event);
          if (typeof timelineService !== 'undefined' && timelineService.sortEventsByDate) {
            timelineService.sortEventsByDate(this.designConfig.world_timeline.events);
          }
          return true;
        },
      },
      // 角色时间线（snapshot.character_timelines[charId] = {cognitive,relationships,status}）——
      // 新增一个空骨架，作者/AI 之后再填具体条目。
      character_timelines: {
        title: '新增角色时间线',
        fields: [
          { section: '角色' },
          {
            key: 'character',
            label: '角色 ID 或姓名',
            type: 'input',
            placeholder: '例如：amelia（须与角色数据库一致）',
          },
        ],
        save: values => {
          const cid = (values.character || '').trim();
          if (!cid) {
            window.showAlertModal('提示', '请输入角色 ID 或姓名', null, { icon: 'warning' });
            return false;
          }
          if (
            !this.designConfig.character_timelines ||
            typeof this.designConfig.character_timelines !== 'object'
          )
            this.designConfig.character_timelines = {};
          if (this.designConfig.character_timelines[cid] !== undefined) {
            window.showAlertModal('ID 冲突', `角色时间线「${cid}」已存在`, null, { icon: 'error' });
            return false;
          }
          this.designConfig.character_timelines[cid] = {
            cognitive: [],
            relationships: [],
            status: [],
          };
          return true;
        },
      },
    };

    const cfg = configs[sectionType];
    if (!cfg) return;

    // ── 构建 Modal DOM ──
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'dcv-edit-modal';

    const content = document.createElement('div');
    content.className = 'modal-content dcv-edit-modal-content dcv-add-modal-scrollable';

    const title = document.createElement('h2');
    title.className = 'modal-title-with-icon';
    const titleIcon = document.createElement('span');
    titleIcon.className = 'material-symbols-outlined modal-title-icon';
    titleIcon.textContent = 'add_circle';
    const titleText = document.createElement('span');
    titleText.textContent = cfg.title;
    title.appendChild(titleIcon);
    title.appendChild(titleText);
    content.appendChild(title);

    // ── 渲染字段 ──
    const fieldElements = {};
    for (const field of cfg.fields) {
      // 分组标题
      if (field.section) {
        const sectionTitle = document.createElement('div');
        sectionTitle.className = 'dcv-add-section-title';
        sectionTitle.textContent = field.section;
        content.appendChild(sectionTitle);
        continue;
      }

      const label = document.createElement('label');
      label.textContent = field.label;
      label.className = 'dcv-add-modal-label';
      content.appendChild(label);

      if (field.type === 'input' || field.type === 'number') {
        const input = document.createElement('input');
        input.type = field.type === 'number' ? 'number' : 'text';
        input.placeholder = field.placeholder || '';
        input.className = 'dcv-add-modal-input';
        content.appendChild(input);
        fieldElements[field.key] = input;
      } else if (field.type === 'select') {
        const select = document.createElement('select');
        select.className = 'dcv-add-modal-input';
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = field.placeholder || '请选择';
        select.appendChild(emptyOption);
        for (const option of field.options || []) {
          const optionEl = document.createElement('option');
          optionEl.value = option.value;
          optionEl.textContent = option.label;
          select.appendChild(optionEl);
        }
        content.appendChild(select);
        fieldElements[field.key] = select;
      } else {
        const textarea = document.createElement('textarea');
        textarea.placeholder = field.placeholder || '';
        textarea.className = 'dcv-add-modal-textarea';
        if (field.tall) textarea.classList.add('dcv-add-modal-textarea--tall');
        textarea.rows = 1;
        const autoGrow = () => {
          textarea.style.height = 'auto';
          textarea.style.height = textarea.scrollHeight + 'px';
        };
        textarea.addEventListener('input', autoGrow);
        content.appendChild(textarea);
        fieldElements[field.key] = textarea;
      }
    }

    // ── 操作按键 ──
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const onEsc = e => {
      if (e.key === 'Escape') closeModal();
    };
    const closeModal = () => {
      modal.remove();
      document.removeEventListener('keydown', onEsc);
    };

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', closeModal);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.textContent = '创建';
    saveBtn.addEventListener('click', () => {
      const values = {};
      for (const [key, el] of Object.entries(fieldElements)) {
        values[key] = el.value;
      }
      if (cfg.save(values)) {
        this._saveDesignConfig();
        this._updatePreviewPanel();
        closeModal();
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    content.appendChild(actions);
    modal.appendChild(content);
    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target === modal) closeModal();
    });
    document.addEventListener('keydown', onEsc);

    const firstField = Object.values(fieldElements)[0];
    if (firstField) setTimeout(() => firstField.focus(), 50);
  }

  // ============================================
  // NPC 面板字段族 + 时间精度（2026-06-10 P1/P2 拆除时自 p1.js 移入——
  // 这些是 validators/_normalizePanelNpcFields/snapshotInfra 仍在用的活体）
  // ============================================

  _getNpcDisplayCoreFields() {
    const builderFields = Array.isArray(window.panelSchemaBuilder?.NPC_DISPLAY_CORE_FIELDS)
      ? window.panelSchemaBuilder.NPC_DISPLAY_CORE_FIELDS
      : null;
    if (builderFields && builderFields.length > 0) {
      return JSON.parse(JSON.stringify(builderFields));
    }
    return [
      {
        key: 'trigger_type',
        label: '触发类型',
        desc: 'NEW=首次登场；UPDATE=状态变化；NEW_PREDEFINED=预定义角色首次登场',
        type: 'string',
        enum: ['NEW', 'UPDATE', 'NEW_PREDEFINED'],
        fixed: true,
        runtimeRequired: true,
      },
      { key: 'id', label: '标识符', type: 'string', fixed: true, runtimeRequired: true },
      { key: 'name', label: '角色名', type: 'string', fixed: true, runtimeRequired: true },
      {
        key: 'gender',
        label: '性别',
        desc: '如：女/男/未知',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'origin',
        label: '来历',
        desc: '一句话说明出身或来源',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'birthday',
        label: '生日',
        desc: '纯时间值，格式必须符合当前世界历法',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
        nullable: true,
      },
      {
        key: 'cognitive_state',
        label: '认知状态',
        desc: '角色当前认为自己是谁',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
      {
        key: 'msg_reply_tone',
        label: '说话语气',
        desc: '稳定说话风格，不写当前情绪',
        type: 'string',
        fixed: true,
        runtimeRequired: false,
      },
    ];
  }

  _getNpcDisplayCoreKeySet() {
    return new Set(this._getNpcDisplayCoreFields().map(field => field.key));
  }

  _getNpcReservedKeySet() {
    return new Set([...this._getNpcDisplayCoreKeySet(), 'age']);
  }

  _getNpcRuntimeRequiredKeySet() {
    const builderKeys = Array.isArray(window.panelSchemaBuilder?.NPC_RUNTIME_REQUIRED_KEYS)
      ? window.panelSchemaBuilder.NPC_RUNTIME_REQUIRED_KEYS
      : null;
    return new Set(
      builderKeys && builderKeys.length > 0 ? builderKeys : ['trigger_type', 'id', 'name']
    );
  }

  _normalizePanelNpcFields(panelNpcFields) {
    const coreFields = this._getNpcDisplayCoreFields();
    const coreKeySet = this._getNpcReservedKeySet();
    const seenKeys = new Set(coreKeySet);
    const customFields = [];
    const sourceFields = Array.isArray(panelNpcFields) ? panelNpcFields : [];

    for (const field of sourceFields) {
      if (!field || typeof field !== 'object') continue;
      if (typeof field.key !== 'string' || !field.key.trim()) continue;
      if (typeof field.label !== 'string' || !field.label.trim()) continue;
      const key = field.key.trim();
      if (coreKeySet.has(key)) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const normalizedField = {
        key,
        label: field.label.trim(),
        type: field.type || 'string',
      };
      if (typeof field.desc === 'string' && field.desc.trim()) {
        normalizedField.desc = field.desc.trim();
      }
      if (Array.isArray(field.enum) && field.enum.length > 0) {
        normalizedField.enum = field.enum;
      }
      if (field.nullable === true) {
        normalizedField.nullable = true;
      }
      customFields.push(normalizedField);
    }

    return [...coreFields, ...customFields];
  }

  // 从 panel_fields 推时间精度（语义忠实重建：timelineService.getTimeConfigFromSnapshot
  // 只读 snapshot.panel_fields.panel_status，这里用 envelope 复刻同一条查找路径）。
  _getTimePrecisionFromPanelFields(panelFields) {
    const cfg = this._getSnapshotTimeConfig(panelFields ? { panel_fields: panelFields } : null);
    return cfg && typeof cfg.precision === 'string' ? cfg.precision : 'time';
  }
}

_applyDesignServiceMixin(_DesignServiceDesignUtilsMixin);
