// ============================================
// Game Output Renderer - 游戏输出渲染器
// ============================================
// 将AI返回的完整JSON结构渲染为游戏界面

const gameOutputRenderer = {
  name: 'game_output',
  priority: 100, // 最高优先级

  /**
   * HTML 转义函数 - 防止 XSS 攻击
   */
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * 属性安全转义 - 额外转义引号，用于 HTML 属性值（escapeHtml 不转引号，属性上下文会被击穿）
   */
  escapeAttr(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * 判断是否为游戏输出JSON
   * Step 3 输出:panel_npc、panel_status、choices
   */
  canRender(json) {
    return json.panel_status && json.choices;
  },

  /**
   * 判断是否是最新 Turn
   * @param {string} uid - 该轮对话的 UID
   * @returns {boolean}
   */
  isLatestTurn(uid) {
    if (!uid || typeof chatHistory === 'undefined') return false;
    // 跳过末尾未提交引擎状态的临时气泡（出错 / 已取消 —— 都无 uid、未走 processAIResponse、未写入
    // pzgmState）。它们会遮蔽真正可回退的最新回合：取消/失败一回合后屏幕末尾是「（已取消）/错误」气泡，
    // 它下面那条才是最新可回退的真回合。不跳过 → isLatestTurn 对真回合返回 false → 删除/重新生成按钮
    // 在本该出现时消失（B1）。
    const lastAiMsg = [...chatHistory]
      .reverse()
      .find(
        m =>
          m &&
          m.sender === 'ai' &&
          m.uid &&
          m.isError !== true &&
          !m.errorMeta &&
          m.isCancelled !== true
      );
    return lastAiMsg && lastAiMsg.uid === uid;
  },

  _inferCustomStatusFieldDefs(status) {
    if (!status || typeof status !== 'object') return [];
    const defs = [];

    for (const [groupKey, data] of Object.entries(status)) {
      if (groupKey === 'move_to') continue;
      if (data === null || data === undefined) continue;

      if (Array.isArray(data)) {
        const objectItems = data.filter(
          item => item && typeof item === 'object' && !Array.isArray(item)
        );
        let fields = [];
        if (objectItems.length > 0) {
          const fieldMap = new Map();
          for (const item of objectItems) {
            for (const [key, value] of Object.entries(item)) {
              const inferredType = typeof value === 'number' ? 'integer' : 'string';
              if (!fieldMap.has(key)) {
                fieldMap.set(key, { key, label: key, type: inferredType });
              } else if (fieldMap.get(key).type === 'integer' && inferredType !== 'integer') {
                fieldMap.get(key).type = 'string';
              }
            }
          }
          fields = Array.from(fieldMap.values());
        } else {
          // 非对象数组：兜底为单字段 value，确保内容可见
          fields = [{ key: 'value', label: 'value', type: 'string' }];
        }
        defs.push({ key: groupKey, label: groupKey, icon: '📋', type: 'array', fields });
        continue;
      }

      if (typeof data === 'object') {
        const fields = Object.keys(data).map(key => ({
          key,
          label: key,
          type: typeof data[key] === 'number' ? 'integer' : 'string',
        }));
        defs.push({ key: groupKey, label: groupKey, icon: '📋', fields });
      }
    }

    return defs;
  },

  resolveCustomStatusFieldDefs(status) {
    const runtimeFields = window.worldMeta?.getPanelFields?.()?.panel_status;
    if (Array.isArray(runtimeFields) && runtimeFields.length > 0) return runtimeFields;

    const inferred = this._inferCustomStatusFieldDefs(status);
    if (inferred.length > 0) return inferred;

    const locale =
      (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? 'en' : 'zh-CN';
    const fallbackDefaults =
      window.panelSchemaBuilder?.getDefaultStatusFields?.(locale) ||
      window.panelSchemaBuilder?.DEFAULT_STATUS_FIELDS;
    if (Array.isArray(fallbackDefaults) && fallbackDefaults.length > 0) return fallbackDefaults;

    return [];
  },

  _CORE_STATUS_GROUP_KEYS: new Set([
    'datetime',
    'location',
    'money',
    'objective',
    'player_state',
    'move_to',
  ]),

  _isCustomStatusGroup(group) {
    if (!group || typeof group !== 'object') return false;
    if (group._template === 'custom') return true;
    return !this._CORE_STATUS_GROUP_KEYS.has(group.key);
  },

  _getStatusGroupLabel(group) {
    if (typeof group?.label === 'string' && group.label.trim()) return group.label.trim();
    if (typeof group?.key === 'string' && group.key.trim()) return group.key.trim();
    return '自定义';
  },

  _getStatusFieldLabel(field) {
    if (typeof field?.label === 'string' && field.label.trim()) return field.label.trim();
    if (typeof field?.key === 'string' && field.key.trim()) return field.key.trim();
    return '';
  },

  _getFieldsForObjectGroup(group, data) {
    if (Array.isArray(group?.fields) && group.fields.length > 0) return group.fields;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    return Object.keys(data).map(key => ({
      key,
      label: key,
      type: typeof data[key] === 'number' ? 'integer' : 'string',
    }));
  },

  _getFieldsForArrayGroup(group, item) {
    if (Array.isArray(group?.fields) && group.fields.length > 0) return group.fields;
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.keys(item).map(key => ({
        key,
        label: key,
        type: typeof item[key] === 'number' ? 'integer' : 'string',
      }));
    }
    return [{ key: 'value', label: 'value', type: 'string' }];
  },

  _formatLocationFieldValue(fieldKey, value) {
    if (value === null || value === undefined || value === '') return value;
    if (!['country', 'site', 'spot'].includes(fieldKey)) return value;
    const store = window.entityStore;
    if (!store || typeof store.resolveDisplayName !== 'function') {
      return value;
    }
    return store.resolveDisplayName(String(value)) || value;
  },

  /**
   * 渲染完整游戏输出
   * @param {Object} json - 解析后的 JSON 数据
   * @param {string} uid - 该轮对话的唯一标识符
   */
  render(json, uid = null) {
    let html = '<div class="game-output">';

    // 1. NPC 卡片 - 由 npcStore 通过 EventBus 订阅 AI_RESPONSE_COMPLETE 事件处理
    // 不再在此处直接调用，避免重复处理

    // 2. 叙事文本 (panel_narrative) - 含选项，作为普通文本显示
    if (json.panel_narrative) {
      html += this.renderNarrative({ text: json.panel_narrative });
    }

    // 3. 状态栏（只有最新 Turn 可编辑）
    if (json.panel_status) {
      const editable = this.isLatestTurn(uid);
      const fieldDefs = this.resolveCustomStatusFieldDefs(json.panel_status);
      html += this.renderCustomStatus(json.panel_status, fieldDefs, editable);
    }

    // 4. 选项
    if (json.choices && json.choices.length > 0) {
      html += this.renderChoices(json.choices);
    }

    html += '</div>';
    return html;
  },

  /**
   * 渲染剧情正文
   */
  renderNarrative(panel) {
    let text = panel.text || '';

    // 处理换行
    text = text.replace(/\\n/g, '\n');
    // 使用安全渲染层解析 Markdown
    if (window.htmlSecurity) {
      text = window.htmlSecurity.markdownToSafeHtml(text);
    } else {
      text = text.replace(/\n/g, '<br>');
    }
    return `<div class="game-narrative">${text}</div>`;
  },

  /**
   * 渲染可编辑字段
   * @param {string} fieldName - 字段名称 (用于 data-field 属性)
   * @param {string} value - 字段值
   * @param {boolean} editable - 是否可编辑
   * @param {string} className - 额外的 CSS 类名
   */
  renderEditableField(fieldName, value, editable, className = '') {
    const e = text => this.escapeHtml(String(text ?? ''));
    // 解耦：editable 只标记「这字段可编辑」(status-editable class，最新回合)；
    // contenteditable 恒 false——是否进入编辑态由「✎编辑」开关 toggle 时切（不再常驻可编辑）。
    const editableClass = editable ? 'status-editable' : '';
    return `<span class="status-field-value ${editableClass} ${className}" contenteditable="false" data-field="${this.escapeAttr(fieldName)}">${e(value)}</span>`;
  },

  /**
   * 渲染状态栏
   * @param {Object} status - panel_status 对象
   * @param {boolean} editable - 是否可编辑（只有最新 Turn 可编辑）
   */
  renderStatus(status, editable = false) {
    const e = text => this.escapeHtml(String(text ?? '')); // 简写
    let html = '<div class="game-status">';

    // 日期时间
    if (status.datetime) {
      const dt = status.datetime;
      const timeTerms = window.worldMeta?.getActiveTimeTerms?.() || {
        era: '',
        precision: 'day',
        labels: { year: '年', month: '月', day: '日', hour: '时', minute: '分' },
      };
      const precision = timeTerms.precision || 'day';
      const labels = timeTerms.labels || { year: '年', month: '月', day: '日', hour: '时', minute: '分' };
      html += `<div class="status-item datetime">`;
      html += `<span class="status-icon">📅</span>`;
      html += `<span class="status-value">${e(timeTerms.era || '')}`;
      html += this.renderEditableField('datetime.year', dt.year, editable);
      html += `${e(labels.year || '年')}`;
      if (['month', 'day', 'time'].includes(precision)) {
        html += this.renderEditableField('datetime.month', dt.month, editable);
        html += `${e(labels.month || '月')}`;
      }
      if (['day', 'time'].includes(precision)) {
        html += this.renderEditableField('datetime.day', dt.day, editable);
        html += `${e(labels.day || '日')}`;
      }
      if (precision === 'time') {
        const fallbackClock =
          typeof dt.time_str === 'string'
            ? dt.time_str
            : typeof dt.timeStr === 'string'
              ? dt.timeStr
              : '00:00';
        const [fallbackHour, fallbackMinute] = fallbackClock.split(':');
        html += ` `;
        html += this.renderEditableField('datetime.hour', dt.hour ?? fallbackHour ?? '', editable);
        html += `<span class="time-separator">:</span>`;
        html += this.renderEditableField(
          'datetime.minute',
          dt.minute ?? fallbackMinute ?? '',
          editable
        );
      }
      html += `</span>`;
      html += `</div>`;
    }

    // 地点
    if (status.location) {
      const loc = status.location;
      const country = this._formatLocationFieldValue('country', loc.country || '');
      const site = this._formatLocationFieldValue('site', loc.site || '');
      const spot = this._formatLocationFieldValue('spot', loc.spot || '');
      html += `<div class="status-item location">`;
      html += `<span class="status-icon">📍</span>`;
      html += `<span class="status-value">`;
      // 使用 span 包裹分隔符，便于 CSS 控制和保持结构清晰
      html += this.renderEditableField('location.country', country, editable);
      html += `<span class="location-separator"> - </span>`;
      html += this.renderEditableField('location.site', site, editable);
      html += `<span class="location-separator"> - </span>`;
      html += this.renderEditableField('location.spot', spot, editable);
      html += `</span>`;
      html += `</div>`;
    }

    // 玩家状态（货币从 inventoryStore 派生，只读）
    if (status.player_state) {
      const ps = status.player_state;
      const liveMoney = window.inventoryStore?.getMoney?.();
      const moneyValue = typeof liveMoney === 'number' ? liveMoney : (ps.money ?? 0);
      html += `<div class="status-item money">`;
      html += `<span class="status-icon">💰</span>`;
      html += `<span class="status-value">${this.escapeHtml(String(moneyValue))} G</span>`;
      html += `</div>`;

      if (ps.current_objective) {
        html += `<div class="status-item objective">`;
        html += `<span class="status-icon">🎯</span>`;
        html += `<span class="status-value">`;
        html += this.renderEditableField(
          'player_state.current_objective',
          ps.current_objective,
          editable
        );
        html += `</span>`;
        html += `</div>`;
      }
    }

    html += '</div>';
    return html;
  },

  /**
   * 渲染自定义世界的状态栏（根据字段定义动态渲染）
   * @param {Object} status - panel_status 对象
   * @param {Array} fieldDefs - panel_status 字段定义
   * @param {boolean} editable - 是否可编辑
   */
  renderCustomStatus(status, fieldDefs, editable = false) {
    // 历史回合：扁平只读状态栏（不翻面、无控件）。
    if (!editable) {
      return `<div class="game-status">${this._renderStatusFaceInner(status, fieldDefs, false)}</div>`;
    }
    // 最新回合：翻面卡——正面纯只读数据（零按钮）；点一下翻到背面，才出现可编辑字段 + 每组「复核」键。
    const e = text => this.escapeHtml(String(text ?? ''));
    const en = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
    const hintTitle = en ? 'Tap to edit / recheck' : '点击翻面编辑 / 复核';
    const frontInner =
      this._renderStatusFaceInner(status, fieldDefs, false) + this._renderStatusFlipHint(en);
    // 无「完成」按钮：点背面任意空白处即翻回正面（仿角色卡）。底部 footer 提示。
    const backInner =
      `<div class="status-back-inner">` +
      this._renderStatusFaceInner(status, fieldDefs, true) +
      `<div class="status-back-foot" aria-hidden="true">${e(en ? 'Tap empty area to flip back' : '再点一次回正面')}</div>` +
      `</div>`;
    return (
      `<div class="game-status status-flippable">` +
        `<div class="status-flip">` +
          `<div class="status-face status-front" role="button" tabindex="0" title="${e(hintTitle)}">${frontInner}</div>` +
          `<div class="status-face status-back">${backInner}</div>` +
        `</div>` +
      `</div>`
    );
  },

  /** 正面右下角「✎ 点击修改」提示（非按钮、aria-hidden；仅作可翻面暗示）。 */
  _renderStatusFlipHint(en) {
    const label = en ? 'Edit' : '点击修改';
    const pencil =
      '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    return `<span class="status-flip-hint" aria-hidden="true">${pencil}<span class="status-flip-hint-label">${this.escapeHtml(label)}</span></span>`;
  },

  /**
   * 一个面（front/back）的内部 html：货币 tile（只读）+ 各字段组。
   * editable=true（背面）给可编辑 affordance（status-editable class）+ 每组「复核」键；
   * editable=false（正面/历史）纯只读、无按钮。
   */
  _renderStatusFaceInner(status, fieldDefs, editable) {
    const e = text => this.escapeHtml(String(text ?? ''));
    let html = '';
    // 货币（inventoryStore 派生，只读、无复核/编辑）。正面=内联 tile；背面=单独一行（无按钮）。
    const liveMoney = window.inventoryStore?.getMoney?.();
    if (typeof liveMoney === 'number' && liveMoney !== 0) {
      const currencyShort =
        window.worldMeta?.getActiveCurrencyTerms?.()?.currencyShort ||
        window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel ||
        '';
      const moneyVal = `${e(liveMoney)}${currencyShort ? ' ' + e(currencyShort) : ''}`;
      html += editable
        ? `<div class="status-back-row custom-status-money" data-group="money"><span class="status-icon">💰</span><span class="status-back-row-body">${moneyVal}</span></div>`
        : `<div class="status-item money"><span class="status-icon">💰</span><span class="status-value">${moneyVal}</span></div>`;
    }
    for (const group of Array.isArray(fieldDefs) ? fieldDefs : []) {
      // 货币组跳过：已由上面 inventoryStore 显示（避免双显示）。
      if (group.key === 'money' || group._template === 'money') continue;
      const data = status[group.key];
      if (data === null || data === undefined) continue;
      // 背面=每组一行（值 + 复核/编辑）；正面/历史=只读内联 .status-item。
      html += editable ? this._renderStatusBackRow(group, data) : this._renderStatusGroup(group, data, false);
    }
    return html;
  },

  /**
   * 单组 → 值 HTML 串数组（不含 .status-item 外壳/按钮）。供正面 .status-item 与背面行共用。
   * 数组组返回多条（每项一条）；对象/时间组返回一条。
   */
  _renderStatusGroupInners(group, data, editable = false) {
    if (!group || data === null || data === undefined) return [];
    if (group.key === 'money' || group._template === 'money') return [];
    const e = text => this.escapeHtml(String(text ?? ''));

    if (group.type === 'array' && Array.isArray(data)) {
      const inners = [];
      data.forEach((item, index) => {
        const isCustomGroup = this._isCustomStatusGroup(group);
        const fields = this._getFieldsForArrayGroup(group, item);
        const groupLabel = this._getStatusGroupLabel(group);
        const parts = [];
        for (const field of fields) {
          const value =
            item && typeof item === 'object' && !Array.isArray(item)
              ? item[field.key]
              : field.key === 'value'
                ? item
                : undefined;
          if (value === null || value === undefined || value === '') continue;
          const renderedValue = this.renderEditableField(`${group.key}.${index}.${field.key}`, value, editable);
          if (isCustomGroup && field.key !== 'value') {
            const fieldLabel = this._getStatusFieldLabel(field);
            if (fieldLabel) parts.push(`${e(fieldLabel)} ${renderedValue}`);
            else parts.push(renderedValue);
          } else {
            parts.push(renderedValue);
          }
        }
        if (parts.length === 0) return;
        inners.push(
          isCustomGroup ? `${e(groupLabel)}: ${parts.join(' / ')}` : `${e(group.label)}: ${parts.join(' ')}`
        );
      });
      return inners;
    }

    if (typeof data === 'object') {
      const isCustomGroup = this._isCustomStatusGroup(group);
      const timeTerms = window.panelSchemaBuilder?.getTimeTermsFromGroup?.(group);
      if (timeTerms && data.year !== null && data.year !== undefined && data.year !== '') {
        let timeHtml = '';
        if (timeTerms.era) timeHtml += `${e(timeTerms.era)}`;
        timeHtml += this.renderEditableField(`${group.key}.year`, data.year, editable);
        timeHtml += `${e(timeTerms.labels?.year || '年')}`;
        if (
          ['month', 'day', 'time'].includes(timeTerms.precision) &&
          data.month !== null &&
          data.month !== undefined &&
          data.month !== ''
        ) {
          timeHtml += this.renderEditableField(`${group.key}.month`, data.month, editable);
          timeHtml += `${e(timeTerms.labels?.month || '月')}`;
        }
        if (
          ['day', 'time'].includes(timeTerms.precision) &&
          data.day !== null &&
          data.day !== undefined &&
          data.day !== ''
        ) {
          timeHtml += this.renderEditableField(`${group.key}.day`, data.day, editable);
          timeHtml += `${e(timeTerms.labels?.day || '日')}`;
        }
        if (timeTerms.precision === 'time') {
          const fallbackClock =
            typeof data.time_str === 'string'
              ? data.time_str
              : typeof data.timeStr === 'string'
                ? data.timeStr
                : '00:00';
          const [fallbackHour, fallbackMinute] = fallbackClock.split(':');
          timeHtml += ` ${this.renderEditableField(`${group.key}.hour`, data.hour ?? fallbackHour ?? '', editable)}`;
          timeHtml += `<span class="time-separator">:</span>`;
          timeHtml += this.renderEditableField(`${group.key}.minute`, data.minute ?? fallbackMinute ?? '', editable);
        }
        return [timeHtml];
      }

      const parts = [];
      const currency =
        window.panelSchemaBuilder?.getCurrencyLabelFromGroup?.(group) ||
        window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel ||
        '';
      const fields = this._getFieldsForObjectGroup(group, data);
      for (const field of fields) {
        if (data[field.key] !== null && data[field.key] !== undefined && data[field.key] !== '') {
          const displayValue =
            group.key === 'location' ? this._formatLocationFieldValue(field.key, data[field.key]) : data[field.key];
          let rendered = this.renderEditableField(`${group.key}.${field.key}`, displayValue, editable);
          if (
            currency &&
            ((group.key === 'player_state' && field.key === 'money') ||
              (group._template === 'money' && field.key === 'amount'))
          ) {
            rendered += ` ${e(currency)}`;
          }
          if (isCustomGroup && field.key !== 'value') {
            const fieldLabel = this._getStatusFieldLabel(field);
            if (fieldLabel) parts.push(`${e(fieldLabel)} ${rendered}`);
            else parts.push(rendered);
          } else {
            parts.push(rendered);
          }
        }
      }
      if (parts.length === 0) return [];
      // 位置三段用 " - " 分隔（country - site - spot），与置顶状态栏一致。
      if (group.key === 'location') return [parts.join('<span class="location-separator"> - </span>')];
      return [isCustomGroup ? `${e(this._getStatusGroupLabel(group))}: ${parts.join(' / ')}` : parts.join(' ')];
    }

    return [];
  },

  /** 正面 / 历史：单组 → 只读 .status-item（无按钮；editable=false 时字段也无 contenteditable affordance）。 */
  _renderStatusGroup(group, data, editable = false) {
    if (!group || data === null || data === undefined) return '';
    if (group.key === 'money' || group._template === 'money') return '';
    const e = text => this.escapeHtml(String(text ?? ''));
    const icon = e(group.icon || '📋');
    const inners = this._renderStatusGroupInners(group, data, editable);
    if (!inners.length) return '';
    const isArray = group.type === 'array' && Array.isArray(data);
    return inners
      .map(
        (inner, i) =>
          `<div class="status-item custom-status-${e(group.key)}"${isArray ? ` data-array-item-index="${i}"` : ''}><span class="status-icon">${icon}</span><span class="status-value">${inner}</span></div>`
      )
      .join('');
  },

  /**
   * 背面：单组 → 一行（每行一个字段组）。布局：[图标][值（多子字段并排）] …右侧 [复核][编辑]。
   * 字段默认只读（contenteditable=false），点该行「编辑」才可改、按钮变「保存」。货币/不可复核组无按钮。
   */
  _renderStatusBackRow(group, data) {
    if (!group || data === null || data === undefined) return '';
    if (group.key === 'money' || group._template === 'money') return '';
    const e = text => this.escapeHtml(String(text ?? ''));
    const en = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
    const icon = e(group.icon || '📋');
    const inners = this._renderStatusGroupInners(group, data, true); // editable=true → 字段带 status-editable class（contenteditable 由逐行编辑切）
    if (!inners.length) return '';
    const body = inners.join('<span class="status-back-sep"> · </span>');
    const actions = this._isStatusGroupRecheckable(group)
      ? `<div class="status-back-row-actions">${this._renderStatusRecheckBtn(group.key, en)}${this._renderStatusRowEditBtn(en)}</div>`
      : '';
    return `<div class="status-back-row custom-status-${e(group.key)}" data-group="${this.escapeAttr(group.key)}"><span class="status-icon">${icon}</span><span class="status-back-row-body">${body}</span>${actions}</div>`;
  },

  /** 背面逐行「编辑 / 保存」键（点击由 _handleStatusRowEdit 切；铅笔 SVG 与复核键同风格，切换只换 label 不抹图标）。 */
  _renderStatusRowEditBtn(en) {
    const label = en ? 'Edit' : '编辑';
    const pencil =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    return `<button type="button" class="status-row-edit" data-action="status-row-edit" title="${this.escapeHtml(label)}" aria-label="${this.escapeHtml(label)}">${pencil}<span class="status-row-edit-label">${this.escapeHtml(label)}</span></button>`;
  },

  /** 「复核」小键（让 AI 据剧情重判该状态组）：单色刷新 SVG，无 emoji（feedback_no_emoji_monochrome_icons）。 */
  _renderStatusRecheckBtn(groupKey, en) {
    const title = en ? 'Recheck with AI (re-judge from the story)' : '让 AI 根据剧情重判此组';
    const label = en ? 'Recheck' : '复核';
    const icon =
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>';
    return `<button type="button" class="status-recheck-btn" data-action="status-recheck" data-group="${this.escapeAttr(groupKey)}" title="${this.escapeHtml(title)}" aria-label="${this.escapeHtml(title)}">${icon}<span class="status-recheck-label">${this.escapeHtml(label)}</span></button>`;
  },

  /** 该状态组是否给「复核」键：核心位置/时间/目标恒给；自定义组有可填子字段才给；货币/player_state 不给。 */
  _isStatusGroupRecheckable(group) {
    if (!group || typeof group !== 'object') return false;
    if (group.key === 'money' || group._template === 'money') return false;
    // player_state 在自定义世界里多是货币载体（objective 已单列为 objective 组）→ 不复核。
    if (group.key === 'player_state') return false;
    if (['datetime', 'location', 'objective'].includes(group.key)) return true;
    // 自定义组：有可填子字段才给复核键（与 buildCustomStatusToolProperties 跳过退化组对齐）。
    if (!this._isCustomStatusGroup(group)) return false;
    const fields = Array.isArray(group.fields) ? group.fields : [];
    return fields.some(f => f && f.key);
  },

  /**
   * 渲染选项
   */
  renderChoices(choices) {
    const e = text => this.escapeAttr(text); // 属性安全（含引号），choice.id/type_tag 进 data-* 属性
    let html = '<div class="game-choices">';
    const isEnglish = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
    html += `<div class="choices-header">💭 <strong>${isEnglish ? 'Your Choices' : '你的选择？'}</strong></div>`;
    html += '<div class="choices-list">';

    for (const choice of choices) {
      const typeClass = this.getChoiceTypeClass(choice.type_tag);
      const hasStructuredEffects =
        typeof choice.type_tag === 'string' && choice.type_tag.trim();
      const choicePayload = hasStructuredEffects
        ? encodeURIComponent(
            JSON.stringify({
              id: choice.id || '',
              type_tag: choice.type_tag || '',
              short_text: choice.short_text || choice.text || '',
              detail_text: choice.detail_text || '',
              cost_hint: choice.cost_hint || '',
              effect_days: Number.isInteger(choice.effect_days) ? choice.effect_days : null,
            })
          )
        : '';
      // 新两段交互：row-2 始终渲染（点选项体先展开，再点同项才发送）
      // 不预设 is-expanded —— 默认折叠，点 choice-item 或 chevron 加 is-expanded 展开 row-2
      html += `<div class="choice-item ${typeClass}" data-choice-id="${e(choice.id)}" data-type-tag="${e(choice.type_tag)}" data-choice-payload="${e(choicePayload)}">`;

      // 第一行:ID + 类型 + 标题 + chevron（所有选项都显示，作为可展开提示）
      html += `<div class="choice-row-1">`;
      html += `<span class="choice-id">${e(choice.id)}.</span>`;
      const typeLabel =
        window.i18nService?.getChoiceTypeLabel?.(choice.type_tag) || choice.type_tag;
      html += `<span class="choice-type">[${e(typeLabel)}]</span>`;
      html += `<span class="choice-short">${e(choice.short_text || choice.text)}</span>`;
      html += `<button class="choice-chevron" data-choice-collapse aria-label="${isEnglish ? 'Toggle details' : '展开/收起'}" tabindex="-1"><span class="material-symbols-outlined">expand_more</span></button>`;
      html += `</div>`;

      // 第二行：detail（或空时的 placeholder） + cost
      html += `<div class="choice-row-2">`;
      if (choice.detail_text) {
        html += `<span class="choice-detail">${e(choice.detail_text)}</span>`;
      } else {
        const placeholder =
          window.i18nService?.t?.('choices.detailEmptyPlaceholder') ||
          (isEnglish ? 'No detail. Click again to send.' : '无详细分析，再次点击可发送');
        html += `<span class="choice-detail choice-detail-empty">${e(placeholder)}</span>`;
      }
      if (choice.cost_hint) {
        html += `<span class="choice-cost">(${e(choice.cost_hint)})</span>`;
      }
      html += `</div>`;

      html += '</div>';
    }

    html += '</div></div>';
    return html;
  },

  /**
   * 获取选项类型的CSS类
   */
  getChoiceTypeClass(typeTag) {
    const typeMap = {
      explore: 'choice-explore',
      探索: 'choice-explore',
      trade: 'choice-trade',
      交易: 'choice-trade',
      travel: 'choice-travel',
      旅行: 'choice-travel',
      work: 'choice-work',
      打工: 'choice-work',
      耗时: 'choice-work',
      talk: 'choice-talk',
      交谈: 'choice-talk',
      action: 'choice-action',
      行动: 'choice-action',
      // 向后兼容
      social: 'choice-talk',
      社交: 'choice-talk',
    };
    return typeMap[typeTag] || 'choice-default';
  },
};

// 注册到核心渲染器
jsonRenderer.register(gameOutputRenderer);

// ============================================
// 选项点击事件处理
// ============================================

function _i18n(key, fallback) {
  return window.i18nService?.t?.(key) || fallback;
}

function _getLatestChoicesList() {
  const lists = document.querySelectorAll('.choices-list');
  return lists.length ? lists[lists.length - 1] : null;
}

function _markStaleChoices() {
  const lists = document.querySelectorAll('.choices-list');
  if (lists.length === 0) return;
  const latest = lists[lists.length - 1];
  document.querySelectorAll('.choice-item').forEach(item => {
    if (item.closest('.choices-list') === latest) {
      item.classList.remove('stale');
    } else {
      item.classList.add('stale');
    }
  });

  if (window.isDesignMode) return;
  lists.forEach(list => {
    const block = list.closest('.game-choices');
    if (!block) return;
    if (list === latest) return;
    _collapseChoicesBlock(block);
  });
}

function _collapseChoicesBlock(gameChoicesEl) {
  if (window.isDesignMode) return;
  if (gameChoicesEl.classList.contains('collapsed')) return;
  if (gameChoicesEl.querySelector(':scope > .choices-collapsed-summary')) return;

  const userText = _findFollowingUserMessageText(gameChoicesEl);
  const itemCount = gameChoicesEl.querySelectorAll('.choice-item').length;
  const summaryText =
    userText || _i18n('choices.collapsedFallback', `上一轮选项 (${itemCount})`);

  const summary = document.createElement('div');
  summary.className = 'choices-collapsed-summary';
  summary.innerHTML = `
    <span class="choices-collapsed-icon">💭</span>
    <span class="choices-collapsed-text"></span>
    <span class="choices-collapsed-expand">▶</span><!-- ui-lint-allow: 与 💭 emoji 配对的装饰三角 -->
  `;
  summary.querySelector('.choices-collapsed-text').textContent = summaryText;
  summary.addEventListener('click', () => {
    gameChoicesEl.classList.toggle('collapsed');
  });
  gameChoicesEl.insertBefore(summary, gameChoicesEl.firstChild);
  gameChoicesEl.classList.add('collapsed');
}

function _findFollowingUserMessageText(gameChoicesEl) {
  const aiMsg = gameChoicesEl.closest('.chat-message.ai-message');
  if (!aiMsg) return '';
  let sib = aiMsg.nextElementSibling;
  while (sib) {
    if (sib.classList?.contains('ai-message')) break;
    if (sib.classList?.contains('user-message')) {
      const idxRaw = sib.dataset?.originalIndex;
      const idx = idxRaw != null ? parseInt(idxRaw, 10) : NaN;
      if (
        Number.isInteger(idx) &&
        Array.isArray(window.chatHistory) &&
        window.chatHistory[idx]
      ) {
        const entry = window.chatHistory[idx];
        const t = (entry.displayText || entry.text || entry.content || '').trim();
        if (t) return t.replace(/\s+/g, ' ');
      }
      const node = sib.querySelector('.chat-message-content');
      const t = (node?.textContent || sib.textContent || '').trim();
      return t.replace(/\s+/g, ' ');
    }
    sib = sib.nextElementSibling;
  }
  return '';
}

// UI 诊断埋点（追"对话框卡住 / 模式横跳"症状用）。仅在 settlement 阶段开启
// 上报，避免砸 analytics。同 type 100ms 节流。零副作用，never throw。
window.__uiDiag = window.__uiDiag || {
  _settlementActive: false,
  _settlementStartTs: 0,
  _lastTs: {},
  _seq: 0,
  setSettlement(active) {
    this._settlementActive = !!active;
    if (active) this._settlementStartTs = performance.now();
  },
  track(type, extra) {
    try {
      if (!this._settlementActive) return;
      const now = performance.now();
      if (this._lastTs[type] && now - this._lastTs[type] < 100) return;
      this._lastTs[type] = now;
      const ds = window.analyticsService;
      if (!ds || typeof ds.track !== 'function') return;
      const stack = (new Error().stack || '').split('\n').slice(2, 5).map(s => s.trim()).join(' | ').slice(0, 280);
      ds.track(type, {
        seq: ++this._seq,
        t_settlement_ms: Math.round(now - this._settlementStartTs),
        is_design_mode: !!window.isDesignMode,
        is_sending: typeof window.isSending !== 'undefined' ? !!window.isSending : null,
        streaming: !!(window.streamVisualizer && typeof window.streamVisualizer.isStreaming === 'function' && window.streamVisualizer.isStreaming()),
        has_active_request: !!(window.aiService && typeof window.aiService.hasActiveRequest === 'function' && window.aiService.hasActiveRequest()),
        caller_stack: stack,
        ...(extra || {}),
      });
    } catch (_) { /* never throw */ }
  },
};

/**
 * 绑定选项点击事件
 * 需要在 DOM 更新后调用
 */
function bindChoiceClickEvents() {
  document.querySelectorAll('.choice-item').forEach(item => {
    if (item._choiceBound) return;
    item._choiceBound = true;

    item.addEventListener('click', function (ev) {
      // chevron 点击只切换折叠状态，不触发"选这个选项"
      const chevron = ev.target.closest('.choice-chevron');
      if (chevron && this.contains(chevron)) {
        ev.stopPropagation();
        this.classList.toggle('is-expanded');
        return;
      }
      // 历史回合的选项不响应
      if (this.classList.contains('stale')) return;
      const latest = _getLatestChoicesList();
      if (this.closest('.choices-list') !== latest) return;

      const choicePayload = this.dataset.choicePayload || '';
      const shortText = this.querySelector('.choice-short')?.textContent || '';
      const detailEl = this.querySelector('.choice-detail');
      const detailText =
        detailEl && !detailEl.classList.contains('choice-detail-empty')
          ? detailEl.textContent || ''
          : '';
      const costHint =
        this.querySelector('.choice-cost')?.textContent?.replace(/^\(|\)$/g, '') || '';

      const input = document.querySelector('.chat-input-textbox');
      if (!input) return;

      let fullText = shortText;
      if (detailText) fullText += ` - ${detailText}`;
      if (!choicePayload && costHint) fullText += ` (${costHint})`;

      // 「点击选项即发送」开关。默认开（只有显式 'off' 才关）。
      //   桌面 (≥768px)：detail CSS 默认展开 + chevron 隐藏 → 永远一段式（点一下就发或就填）。
      //   手机 (<768px) + autoSend on：两段式 —— 第一次点仅展开 detail（不动 input
      //     避免污染 E 自定义），第二次点同项填 input + 自动发。
      //   手机 + autoSend off：一段式 —— 点选项 = 展开 + 填 input，不自动发，玩家手动点发送。
      const autoSendEnabled = localStorage.getItem('click-to-send') !== 'off';
      const isDesktop = window.matchMedia('(min-width: 768px)').matches;
      const useTwoStep = !isDesktop && autoSendEnabled;
      const wasExpanded = this.classList.contains('is-expanded');

      // 1) 同轮唯一展开（仅手机有意义；桌面 CSS 已展开，不动 class）
      if (!isDesktop && !wasExpanded) {
        const list = this.closest('.choices-list');
        if (list) {
          list.querySelectorAll('.choice-item.is-expanded').forEach(el => {
            if (el !== this) el.classList.remove('is-expanded');
          });
        }
        this.classList.add('is-expanded');
      }

      // 2) 两段式纯展开 case（手机 + autoSend + 首次点）→ no-op，不动 input/不发
      if (useTwoStep && !wasExpanded) {
        return;
      }

      // 3) cancel-mode 守卫：autoSend 开但流式中发不出去 → no-op，避免污染 E 自定义
      const sendBtn = autoSendEnabled
        ? document.querySelector('[data-action~="chat-send-btn"]')
        : null;
      const canAutoSend = !!sendBtn && !sendBtn.classList.contains('cancel-mode');
      if (autoSendEnabled && !canAutoSend) {
        return;
      }

      // 4) 填 input + 写 dataset
      input.value = fullText;
      if (choicePayload) {
        input.dataset.selectedChoicePayload = choicePayload;
        input.dataset.selectedChoiceText = fullText.trim();
      } else {
        delete input.dataset.selectedChoicePayload;
        delete input.dataset.selectedChoiceText;
      }

      // 5) 自动发 or 仅 focus
      // 例外：输入栏已有「附加内容」——选了导演 tag，或 /ooc 场外行开着——本次不论
      //   是否开「点击即发送」都不自动发，填入后让玩家先看清 tag/场外 + 选项的组合再手动发送。
      const hasAttached =
        !!(window.directorTagsUI?.getActiveCandidate?.()) ||
        window.oocInputRow?.isActive?.() === true;
      // auto-send 路径不 focus 输入栏：iOS/Android 上 focus 会弹软键盘，preventScroll
      // 也挡不住；用户用「点」就是不想打字。autoResize 也跳过——handleSendMessage
      // 紧接着会清空 value 并 reset 高度。
      if (autoSendEnabled && canAutoSend && !hasAttached) {
        sendBtn.click();
      } else {
        input.focus({ preventScroll: true });
        if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
      }
    });
  });
  _markStaleChoices();
}

window.bindChoiceClickEvents = bindChoiceClickEvents;
// 暴露给 chatCore：finalize 时同步折叠 turn N-1 的 choices
window._markStaleChoices = _markStaleChoices;

// 使用 MutationObserver 自动绑定新出现的选项
const choiceObserver = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      const hasNewChoices = Array.from(mutation.addedNodes).some(node => {
        if (node.nodeType === 1) {
          return node.classList?.contains('choice-item') || node.querySelector?.('.choice-item');
        }
        return false;
      });
      if (hasNewChoices) {
        bindChoiceClickEvents();
      }
    }
  }
});

const _initChoiceObserver = () => {
  const chatContainer = document.querySelector('#main-stage');
  if (chatContainer) {
    choiceObserver.observe(chatContainer, {
      childList: true,
      subtree: true,
    });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initChoiceObserver);
} else {
  queueMicrotask(_initChoiceObserver);
}

// ============================================
// 状态栏编辑事件处理
// ============================================

/**
 * 判断当前是否是 Turn 1（开局）
 * @returns {boolean}
 */
function isFirstTurn() {
  if (typeof chatHistory === 'undefined') return true;
  return chatHistory.filter(m => m.sender === 'ai').length === 1;
}

/**
 * 非法编辑回滚：恢复原值 + 加抖动动画
 */
function _rejectFieldEdit(field) {
  if (!field) return;
  const original = field.dataset.originalValue;
  if (original !== undefined) field.textContent = original;
  field.classList.add('invalid');
  field.addEventListener(
    'animationend',
    () => field.classList.remove('invalid'),
    { once: true }
  );
}

/**
 * 整数范围校验
 */
function _isIntInRange(str, min, max) {
  if (!/^-?\d+$/.test(String(str).trim())) return false;
  const n = parseInt(str, 10);
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * 把 buildTurnResult 的最新快照回填到最后一个 AI 消息的 gameData，
 * 防止 rebuild 时视觉回退到编辑前的值。
 */
function _syncLatestAiGameData() {
  if (typeof chatHistory === 'undefined') return;
  if (typeof window.buildTurnResult !== 'function') return;
  let lastAiIdx = -1;
  for (let i = chatHistory.length - 1; i >= 0; i--) {
    if (chatHistory[i]?.sender === 'ai') { lastAiIdx = i; break; }
  }
  if (lastAiIdx < 0) return;
  const snap = window.buildTurnResult();
  if (!snap?.panel_status) return;

  const aiMsg = chatHistory[lastAiIdx];
  aiMsg.gameData = {
    ...(aiMsg.gameData || {}),
    panel_status: snap.panel_status,
  };

  if (typeof aiMsg.text === 'string' && aiMsg.text.trim()) {
    try {
      const raw = aiMsg.text;
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonContent = jsonMatch ? jsonMatch[1] : raw.trim();
      const parsed = JSON.parse(jsonContent);
      parsed.panel_status = snap.panel_status;
      const rebuilt = JSON.stringify(parsed, null, 2);
      aiMsg.text = jsonMatch
        ? raw.replace(/```json\s*[\s\S]*?\s*```/, '```json\n' + rebuilt + '\n```')
        : rebuilt;
    } catch (_e) {
      // ReAct 纯文本路径：aiMsg.text 不是 JSON，cleanHistoryForGeneration
      // 也提取不到 panel_status（lastGameState 为 null），无需 patch。
    }
  }
}

/**
 * 处理状态栏字段编辑
 * @param {HTMLElement} field - 被编辑的字段元素
 */
function handleStatusFieldEdit(field) {
  const fieldName = field.dataset.field;
  if (!fieldName) return;

  // 流式中不允许编辑（与 CSS pointer-events 双保险）
  if (window.streamVisualizer?.isStreaming?.()) return;

  const newValue = field.textContent.trim();
  console.log(`[StatusEdit] 字段 ${fieldName} 编辑为:`, newValue);

  // 根据字段类型分发到专用 Service；handler 返回 false 表示校验失败已回滚
  let ok = true;
  if (fieldName.startsWith('datetime.')) {
    ok = handleDatetimeEdit(fieldName, newValue, field);
  } else if (fieldName.startsWith('location.')) {
    ok = handleLocationEdit(fieldName, newValue, field);
  } else if (fieldName.startsWith('player_state.')) {
    ok = handlePlayerStateEdit(fieldName, newValue, field);
  } else if (fieldName.startsWith('objective.')) {
    ok = handleObjectiveEdit(fieldName, newValue, field);
  }
  if (ok === false) return;

  // 所有字段都同步到 customStatusStore（保持双轨一致）
  if (typeof customStatusStore !== 'undefined') {
    customStatusStore.updateField(fieldName, newValue);
  }

  // PZGM 引擎存档补写：让手编熬过下回合投影（否则 projectTurn 用引擎旧值盖回 → 手编下回合消失、GM 不认账）。
  // 分类对应引擎 save 字段：datetime→save.time、location→save.location、objective→save.objective、其余→save.customStatus.<path>。
  if (fieldName.startsWith('datetime.')) {
    _pzgmWriteStatus('time', typeof timelineService !== 'undefined' ? timelineService.getCurrentDate() : null);
  } else if (fieldName.startsWith('location.')) {
    _pzgmWriteStatus('location', typeof locationTracker !== 'undefined' ? locationTracker.getLocation() : null);
  } else if (fieldName.startsWith('player_state.') || fieldName.startsWith('objective.')) {
    _pzgmWriteStatus('objective', typeof playerStateService !== 'undefined' ? playerStateService.getObjective() : '');
  } else {
    _pzgmWriteStatus('customLeaf', { path: fieldName, value: newValue });
  }

  _afterStatusWrite();
}

/**
 * 状态写入后的统一收口：回填最新 AI 消息 gameData（防 rebuild 视觉回退）+ 失效置顶状态栏缓存 + 自动存档。
 * 手编 focusout 路径与复核路径共用。
 */
function _afterStatusWrite() {
  _syncLatestAiGameData();
  window.invalidateLatestStickyStatusCache?.();
  if (window.isDesignMode) return; // 世界卡下走设计态自己的持久化
  // 状态栏复核/手编是回合外改 store → 先刷新当前回合的时间线快照（否则回退会丢这些改动，见审查 M2），再存盘。
  window.repushCurrentTurnSnapshot?.();
  window.sessionManager?.autoSaveGame?.();
}

/** dot-path 写入（仿 customStatusStore.updateField）：'health.hp' / 'reputation.0.faction'。 */
function _setDotPath(root, path, value) {
  const parts = String(path).split('.');
  let obj = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = isNaN(parts[i]) ? parts[i] : parseInt(parts[i], 10);
    if (obj[key] === null || obj[key] === undefined || typeof obj[key] !== 'object') {
      obj[key] = isNaN(parts[i + 1]) ? {} : [];
    }
    obj = obj[key];
  }
  const lastKey = parts[parts.length - 1];
  obj[isNaN(lastKey) ? lastKey : parseInt(lastKey, 10)] = value;
}

/**
 * PZGM 下把状态改动补写进引擎存档 pzgmState（仿 npcPanelUI 位置/卡复核：写 host 不够，下回合引擎用
 * save 旧值当 prev 喂 GM → 盖回；写进 save 后引擎读回作 prev、GM 认账）。react 老局 isPzgm()=false 直接 return。
 * @param {'location'|'time'|'objective'|'customLeaf'|'customGroup'} kind
 * @param {*} payload
 */
function _pzgmWriteStatus(kind, payload) {
  try {
    if (!(window.StoryEngineFlag && typeof window.StoryEngineFlag.isPzgm === 'function' && window.StoryEngineFlag.isPzgm())) return;
    const store = window.ServiceRegistry?.get?.('pzgmState');
    const save = store?.get?.();
    if (!save) return;
    if (kind === 'location') {
      // 引擎 save.location 是字符串（turnEngine 落库 "site > spot"，无 country 段；显示层靠 locationTracker 保三段）。
      const triad = window.locationTriad ? window.locationTriad.toTriad(payload) : (payload || {});
      const segs = [triad.site, triad.spot].filter(s => s && s !== '未知');
      save.location = segs.length ? segs.join(' > ') : (triad.spot && triad.spot !== '未知' ? triad.spot : '');
    } else if (kind === 'time') {
      const d = payload || {};
      save.time = { year: d.year, month: d.month, day: d.day, hour: d.hour, minute: d.minute };
    } else if (kind === 'objective') {
      save.objective = payload || '';
    } else if (kind === 'customLeaf') {
      save.customStatus = save.customStatus || {};
      _setDotPath(save.customStatus, payload.path, payload.value);
    } else if (kind === 'customGroup') {
      save.customStatus = save.customStatus || {};
      save.customStatus[payload.groupKey] = payload.value;
    }
    store.set(save);
  } catch (err) {
    console.warn('[StatusEdit] 写引擎存档失败:', err);
  }
}

// per-group in-flight 防连点（复核异步期间禁止同组重复点）。
const _statusRecheckInFlight = new Set();

/**
 * 「复核」点击落地：调对应 subagent → 落库（host service + customStatusStore + PZGM 引擎存档）→ 定点刷新该组 → toast。
 * @param {string} groupKey - datetime / location / objective / 自定义组 key
 * @param {HTMLElement} btn
 */
async function handleStatusGroupRecheck(groupKey, btn) {
  if (!groupKey || !window.aiService) return;
  if (window.streamVisualizer?.isStreaming?.()) return;
  if (_statusRecheckInFlight.has(groupKey)) return;
  _statusRecheckInFlight.add(groupKey);
  if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
  const en = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  const toast = msg => { if (typeof showToast === 'function') showToast(msg); };
  const statusEl = btn ? btn.closest('.game-status') : null;
  // 复核键在翻面背面：定点刷新限定在背面（.status-back），别动正面只读副本（正面在翻回时整刷）。
  const backFace = btn ? (btn.closest('.status-back') || statusEl) : null;
  const signal = window.aiService._currentAbortSignal || null;
  // 复核要 await AI（数秒），期间玩家可能跳了时间线/切了档——落定后若所在点变了就丢弃，绝不往已还原的状态上写
  // 陈旧复核（否则会烤进当前快照并存盘，同 npcPanelUI 审查 #7）。
  const baseUid = (typeof window.currentTurnChatUid === 'function') ? window.currentTurnChatUid() : null;
  const _jumpedAway = () =>
    typeof window.currentTurnChatUid === 'function' && window.currentTurnChatUid() !== baseUid;
  try {
    if (groupKey === 'location') {
      const res = await window.aiService._runStatusLocationRecheck?.(signal);
      if (_jumpedAway()) return;
      if (!res || !res.location || (typeof res.confidence === 'number' && res.confidence < 0.4)) {
        toast(en ? "Couldn't determine a location — left unchanged" : '未能确定位置，已保持原状');
        return;
      }
      const triad = res.location;
      if (typeof locationTracker !== 'undefined') locationTracker.updateManually(triad);
      if (typeof customStatusStore !== 'undefined') customStatusStore.updateField('location', triad);
      _pzgmWriteStatus('location', triad);
      _afterStatusWrite();
      _refreshStatusBackRow(backFace, 'location');
      const locTxt = window.locationTriad ? window.locationTriad.formatTriad(triad) : '';
      toast(en ? `Location updated: ${locTxt}` : `已更新位置：${locTxt}`);
    } else if (groupKey === 'objective') {
      const res = await window.aiService._runStatusObjectiveRecheck?.(signal);
      if (_jumpedAway()) return;
      if (!res || !res.objective) { toast(en ? "Couldn't determine an update — left unchanged" : '未能确定，已保持原状'); return; }
      if (!res.changed) { toast(en ? 'No change needed' : '无需更新'); return; }
      if (typeof playerStateService !== 'undefined') playerStateService.setObjective(res.objective);
      if (typeof customStatusStore !== 'undefined') customStatusStore.updateField('objective.text', res.objective);
      _pzgmWriteStatus('objective', res.objective);
      _afterStatusWrite();
      _refreshStatusBackRow(backFace, 'objective');
      toast(en ? 'Objective updated' : '已更新目标');
    } else if (groupKey === 'datetime') {
      const res = await window.aiService._runStatusDatetimeRecheck?.(signal);
      if (_jumpedAway()) return;
      if (!res || !res.date) { toast(en ? "Couldn't determine the time — left unchanged" : '未能确定时间，已保持原状'); return; }
      if (!res.changed) { toast(en ? 'No change needed' : '无需更新'); return; }
      const d = res.date;
      if (typeof timelineService !== 'undefined' && timelineService.setCurrentDateManual) {
        const prevTurnDate = typeof playerStateService !== 'undefined' ? playerStateService.getPreviousTurnDate() : null;
        timelineService.setCurrentDateManual(d.year, d.month, d.day, d.hour, d.minute, prevTurnDate, isFirstTurn());
      }
      if (typeof customStatusStore !== 'undefined') {
        ['year', 'month', 'day', 'hour', 'minute'].forEach(k => {
          if (d[k] !== null && d[k] !== undefined) customStatusStore.updateField(`datetime.${k}`, d[k]);
        });
      }
      _pzgmWriteStatus('time', typeof timelineService !== 'undefined' ? timelineService.getCurrentDate() : d);
      _afterStatusWrite();
      _refreshStatusBackRow(backFace, 'datetime');
      toast(en ? 'Time updated' : '已更新时间');
    } else {
      // 自定义组
      const res = await window.aiService._runStatusCustomGroupRecheck?.(groupKey, signal);
      if (_jumpedAway()) return;
      if (!res || res.value === undefined || res.value === null) {
        toast(en ? "Couldn't determine an update — left unchanged" : '未能确定，已保持原状');
        return;
      }
      // 落库护栏：缺子字段用当前值补全（对象组浅合并；数组组逐项合并）。
      const cur = typeof customStatusStore !== 'undefined' ? customStatusStore.getStatus?.()?.[groupKey] : undefined;
      let val = res.value;
      if (Array.isArray(val)) {
        val = val.map((item, i) =>
          item && typeof item === 'object' && !Array.isArray(item)
            ? { ...(Array.isArray(cur) && cur[i] && typeof cur[i] === 'object' ? cur[i] : {}), ...item }
            : item
        );
      } else if (val && typeof val === 'object') {
        val = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}), ...val };
      }
      if (typeof customStatusStore !== 'undefined') customStatusStore.updateField(groupKey, val);
      _pzgmWriteStatus('customGroup', { groupKey, value: val });
      _afterStatusWrite();
      _refreshStatusBackRow(backFace, groupKey);
      toast(en ? `Updated "${res.label || groupKey}"` : `已更新「${res.label || groupKey}」`);
    }
  } catch (err) {
    console.warn('[StatusRecheck] 复核失败:', err);
    toast(en ? 'Recheck failed' : '复核失败');
  } finally {
    _statusRecheckInFlight.delete(groupKey);
    if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    if (statusEl) _setStatusFlipHeight(statusEl); // 背面内容可能变高 → 重测翻面高度
  }
}

/**
 * 复核后定点刷新背面【某一组那一行】（不整渲 → 不丢其它行的逐行编辑态）。
 * 数据从 buildTurnResult() 取（各 store 合并后的权威 panel_status），支持数组组项数变化。
 * 刷新后该行回到只读（复核非手编，重渲即退出该行编辑态）。
 */
function _refreshStatusBackRow(backFace, groupKey) {
  if (!backFace) return;
  const snap = typeof window.buildTurnResult === 'function' ? window.buildTurnResult() : null;
  const status = snap?.panel_status || (typeof customStatusStore !== 'undefined' ? customStatusStore.getStatus() : null) || {};
  const fieldDefs = gameOutputRenderer.resolveCustomStatusFieldDefs(status);
  const group = Array.isArray(fieldDefs) ? fieldDefs.find(g => g && g.key === groupKey) : null;
  if (!group) return;
  const newHtml = gameOutputRenderer._renderStatusBackRow(group, status[groupKey]);
  const inner = backFace.querySelector('.status-back-inner') || backFace;
  const old = Array.from(inner.querySelectorAll('.status-back-row')).find(el => el.dataset.group === groupKey);
  const tmp = document.createElement('div');
  tmp.innerHTML = newHtml;
  const newNode = tmp.firstElementChild;
  if (!newNode) { if (old) old.remove(); return; }
  if (old) { old.replaceWith(newNode); return; }
  // 该组原本为空、复核后新增：追加到背面末尾。
  inner.append(newNode);
}

/**
 * 翻面：正面只读 ⇄ 背面（每行一字段 + 复核/编辑）。翻面【不】整体进编辑态——字段默认只读，
 * 由各行「编辑」键逐行开。翻回正面 = blur 落库 + 退出所有逐行编辑 + 用最新数据整刷正面只读副本。
 * 照搬 npcPanelUI 卡片翻面范式（rotateX 适配横条）。
 * @param {HTMLElement} statusEl - .game-status.status-flippable
 * @param {boolean} toBack
 */
function _flipStatusBar(statusEl, toBack) {
  if (!statusEl) return;
  if (toBack) {
    statusEl.classList.add('is-flipped');
    _setStatusFlipHeight(statusEl);
  } else {
    // 先 blur 当前字段（focusout 已落库），退出所有逐行编辑态，再整刷正面（正面此时正转回可见）。
    if (document.activeElement && typeof document.activeElement.blur === 'function') document.activeElement.blur();
    statusEl.querySelectorAll('.status-back-row.is-editing').forEach(row => _exitStatusRowEdit(row));
    statusEl.classList.remove('is-flipped');
    _renderStatusFront(statusEl);
    _setStatusFlipHeight(statusEl);
  }
}

/** 背面逐行「编辑 ⇄ 保存」：点编辑 → 该行字段 contenteditable=true、按钮变「保存」；点保存 → blur 落库、回只读。 */
function _handleStatusRowEdit(btn) {
  const row = btn.closest('.status-back-row');
  if (!row) return;
  if (row.classList.contains('is-editing')) {
    _exitStatusRowEdit(row);
    return;
  }
  const en = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  row.classList.add('is-editing');
  const fields = row.querySelectorAll('.status-editable');
  fields.forEach(el => el.setAttribute('contenteditable', 'true'));
  const labelEl = btn.querySelector('.status-row-edit-label');
  if (labelEl) labelEl.textContent = en ? 'Save' : '保存';
  btn.title = en ? 'Save' : '保存';
  if (fields[0]) fields[0].focus({ preventScroll: true }); // 红线：gameOutputRenderer 内 focus 必须 preventScroll
  _setStatusFlipHeight(row.closest('.game-status'));
}

/** 退出某行编辑态：blur 落库（focusout）+ 锁回只读 + 按钮复位「编辑」。 */
function _exitStatusRowEdit(row) {
  if (!row) return;
  const en = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  if (document.activeElement && row.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  row.classList.remove('is-editing');
  row.querySelectorAll('.status-editable').forEach(el => el.setAttribute('contenteditable', 'false'));
  const btn = row.querySelector('.status-row-edit');
  if (btn) {
    const labelEl = btn.querySelector('.status-row-edit-label');
    if (labelEl) labelEl.textContent = en ? 'Edit' : '编辑';
    btn.title = en ? 'Edit' : '编辑';
  }
}

/** 用最新数据整刷正面只读副本（正面无 caret，整刷无副作用；翻回正面时调）。 */
function _renderStatusFront(statusEl) {
  const front = statusEl?.querySelector('.status-front');
  if (!front) return;
  const snap = typeof window.buildTurnResult === 'function' ? window.buildTurnResult() : null;
  const status = snap?.panel_status || (typeof customStatusStore !== 'undefined' ? customStatusStore.getStatus() : null) || {};
  const fieldDefs = gameOutputRenderer.resolveCustomStatusFieldDefs(status);
  const en = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  front.innerHTML =
    gameOutputRenderer._renderStatusFaceInner(status, fieldDefs, false) +
    gameOutputRenderer._renderStatusFlipHint(en);
}

/** 翻面高度同步（仿 npcPanelUI._setFlipHeight 轻量版）：未翻=正面高，翻面=背面 inner 自然高。 */
function _setStatusFlipHeight(statusEl) {
  const flip = statusEl?.querySelector('.status-flip');
  const front = statusEl?.querySelector('.status-front');
  const back = statusEl?.querySelector('.status-back');
  if (!flip || !front || !back) return;
  const inner = back.querySelector('.status-back-inner') || back;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!flip.isConnected) return;
    const flipped = statusEl.classList.contains('is-flipped');
    let target;
    if (flipped) {
      // 背面 inner 在带 padding 的 .status-face 里：内容高 + 背面上下 padding。
      const cs = getComputedStyle(back);
      const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      target = Math.max(inner.scrollHeight, inner.offsetHeight) + pad;
    } else {
      target = front.scrollHeight; // 正面在常规流、scrollHeight 含自身 padding
    }
    flip.style.height = `${target + 2}px`;
  }));
}

/** 主动翻回正面（发送/回合切换时调，避免旧栏残留在背面编辑态）。 */
function _exitStatusEditMode() {
  document.querySelectorAll('.game-status.is-flipped').forEach(statusEl => _flipStatusBar(statusEl, false));
}
window._exitStatusEditMode = _exitStatusEditMode;

/**
 * 处理日期时间编辑
 */
function handleDatetimeEdit(fieldName, newValue, field) {
  if (typeof timelineService === 'undefined') return false;
  if (typeof playerStateService === 'undefined') return false;

  const subField = fieldName.replace('datetime.', '');
  const ranges = {
    year: [-999999, 999999],
    month: [1, 12],
    day: [1, 31],
    hour: [0, 23],
    minute: [0, 59],
  };
  const range = ranges[subField];
  if (range && !_isIntInRange(newValue, range[0], range[1])) {
    _rejectFieldEdit(field);
    return false;
  }

  // 获取当前日期
  const currentDate = timelineService.getCurrentDate() || {};
  const fallbackClock =
    typeof currentDate.timeStr === 'string'
      ? currentDate.timeStr
      : typeof currentDate.time_str === 'string'
        ? currentDate.time_str
        : '00:00';
  const [currentHour, currentMinute] = fallbackClock.split(':').map(value => parseInt(value, 10));

  // 更新对应字段
  const updatedDate = {
    ...currentDate,
    hour: Number.isFinite(currentDate.hour) ? currentDate.hour : currentHour || 0,
    minute: Number.isFinite(currentDate.minute) ? currentDate.minute : currentMinute || 0,
  };
  if (subField === 'year') {
    updatedDate.year = parseInt(newValue, 10);
  } else if (subField === 'month') {
    updatedDate.month = parseInt(newValue, 10);
  } else if (subField === 'day') {
    updatedDate.day = parseInt(newValue, 10);
  } else if (subField === 'hour') {
    updatedDate.hour = parseInt(newValue, 10);
  } else if (subField === 'minute') {
    updatedDate.minute = parseInt(newValue, 10);
  }

  // 判断是否跳过副作用（开局时跳过）
  const skipSideEffects = isFirstTurn();
  const previousTurnDate = playerStateService.getPreviousTurnDate();

  // 调用手动编辑专用方法
  timelineService.setCurrentDateManual(
    updatedDate.year,
    updatedDate.month,
    updatedDate.day,
    updatedDate.hour,
    updatedDate.minute,
    previousTurnDate,
    skipSideEffects
  );
  return true;
}

/**
 * 处理地点编辑
 */
function handleLocationEdit(fieldName, newValue /*, field */) {
  if (typeof locationTracker === 'undefined') return false;
  if (typeof playerStateService === 'undefined') return false;

  // 获取当前地点
  const currentLocation = locationTracker.getLocation() || {};
  const subField = fieldName.replace('location.', '');

  // 更新对应字段
  const updatedLocation = { ...currentLocation };
  if (subField === 'country') {
    updatedLocation.country = newValue;
  } else if (subField === 'site') {
    updatedLocation.site = newValue;
  } else if (subField === 'spot') {
    updatedLocation.spot = newValue;
  }

  // 更新 locationTracker（手动编辑不重置停留计数）
  locationTracker.updateManually(updatedLocation);
  return true;
}

/**
 * 处理玩家状态编辑（仅 current_objective；货币已迁移到物品栏，不可手动编辑）
 */
function handlePlayerStateEdit(fieldName, newValue /*, field */) {
  if (typeof playerStateService === 'undefined') return false;

  const subField = fieldName.replace('player_state.', '');

  if (subField === 'current_objective') {
    playerStateService.setObjective(newValue || null);
    return true;
  }
  // money 不再可手动编辑（请通过物品栏 UI 接受/拒绝 update_item）
  return false;
}

/**
 * 处理目标编辑（新结构 objective.text）
 */
function handleObjectiveEdit(fieldName, newValue /*, field */) {
  if (typeof playerStateService === 'undefined') return false;
  const subField = fieldName.replace('objective.', '');
  if (subField === 'text') {
    playerStateService.setObjective(newValue || null);
  }
  return true;
}

// 事件委托：监听状态栏字段编辑
const _bindStatusEditEvents = () => {
  const chatContainer = document.querySelector('#main-stage');
  if (!chatContainer) return;

  // focusin 记录原值，用于非法输入时回滚
  chatContainer.addEventListener('focusin', e => {
    const field = e.target;
    if (!field?.classList?.contains('status-editable')) return;
    field.dataset.originalValue = field.textContent;
  });

  // focusout 事件处理编辑完成
  chatContainer.addEventListener('focusout', e => {
    const field = e.target;
    if (!field || !field.classList.contains('status-editable')) return;
    handleStatusFieldEdit(field);
  });

  // 防止回车换行；正面 Enter/Space 翻面（a11y）
  chatContainer.addEventListener('keydown', e => {
    const field = e.target;
    if (field?.classList?.contains('status-editable')) {
      if (e.key === 'Enter') { e.preventDefault(); field.blur(); }
      return;
    }
    const front = e.target.closest?.('.status-front');
    if (front && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      _flipStatusBar(front.closest('.game-status'), true);
    }
  });

  // 翻面 + 逐行编辑 + 复核（委托同容器；仿角色卡点卡片翻面）。
  chatContainer.addEventListener('click', e => {
    // 逐行「编辑 / 保存」
    const rowEdit = e.target.closest('[data-action="status-row-edit"]');
    if (rowEdit) { _handleStatusRowEdit(rowEdit); return; }
    // 复核键（在背面）
    const recheckBtn = e.target.closest('[data-action="status-recheck"]');
    if (recheckBtn) { handleStatusGroupRecheck(recheckBtn.dataset.group, recheckBtn); return; }
    // 正面任意非交互处 → 翻到背面
    const front = e.target.closest('.status-front');
    if (front) {
      if (e.target.closest('button, a, [data-action]')) return;
      _flipStatusBar(front.closest('.game-status'), true);
      return;
    }
    // 背面任意非交互处 → 翻回正面（仿角色卡点任意处翻回）。
    const back = e.target.closest('.status-back');
    if (back) {
      if (e.target.closest('button, a, [data-action]')) return;
      // 正在编辑的那一行内点击不翻（点字段=放光标、点标签也不误翻）；行外/空白处才翻回（顺带 blur 落库）。
      if (e.target.closest('.status-back-row.is-editing')) return;
      _flipStatusBar(back.closest('.game-status'), false);
    }
  });

  console.log('[StatusEdit] 状态栏编辑事件已绑定');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bindStatusEditEvents);
} else {
  queueMicrotask(_bindStatusEditEvents);
}
