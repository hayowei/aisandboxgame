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
    const lastAiMsg = [...chatHistory].reverse().find(m => m.sender === 'ai');
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
    const runtimeFields = window.worldMeta?.getStep3Fields?.()?.panel_status;
    if (Array.isArray(runtimeFields) && runtimeFields.length > 0) return runtimeFields;

    const inferred = this._inferCustomStatusFieldDefs(status);
    if (inferred.length > 0) return inferred;

    const locale =
      (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en' ? 'en' : 'zh-CN';
    const fallbackDefaults =
      window.step3SchemaBuilder?.getDefaultStatusFields?.(locale) ||
      window.step3SchemaBuilder?.DEFAULT_STATUS_FIELDS;
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
    const editableAttr = editable ? 'contenteditable="true"' : '';
    const editableClass = editable ? 'status-editable' : '';
    return `<span class="status-field-value ${editableClass} ${className}" ${editableAttr} data-field="${fieldName}">${e(value)}</span>`;
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
    const e = text => this.escapeHtml(String(text ?? ''));
    let html = '<div class="game-status">';

    // 独立注入货币 tile（不依赖 fieldDefs，从 inventoryStore 派生）
    const liveMoney = window.inventoryStore?.getMoney?.();
    if (typeof liveMoney === 'number' && liveMoney !== 0) {
      const currencyShort =
        window.worldMeta?.getActiveCurrencyTerms?.()?.currencyShort ||
        window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel ||
        '';
      html += `<div class="status-item money">`;
      html += `<span class="status-icon">💰</span>`;
      html += `<span class="status-value">${e(liveMoney)}${currencyShort ? ' ' + e(currencyShort) : ''}</span>`;
      html += `</div>`;
    }

    for (const group of fieldDefs) {
      const data = status[group.key];
      if (data === null || data === undefined) continue;

      const icon = group.icon || '📋';

      if (group.type === 'array' && Array.isArray(data)) {
        // 数组类型：每项一行
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

            const renderedValue = this.renderEditableField(
              `${group.key}.${index}.${field.key}`,
              value,
              editable
            );

            if (isCustomGroup && field.key !== 'value') {
              const fieldLabel = this._getStatusFieldLabel(field);
              if (fieldLabel) parts.push(`${e(fieldLabel)} ${renderedValue}`);
              else parts.push(renderedValue);
            } else {
              parts.push(renderedValue);
            }
          }

          if (parts.length === 0) return;

          html += `<div class="status-item custom-status-${e(group.key)}" data-array-item-index="${index}">`;
          html += `<span class="status-icon">${icon}</span>`;
          html += `<span class="status-value">`;
          if (isCustomGroup) {
            html += `${e(groupLabel)}: ${parts.join(' / ')}`;
          } else {
            html += `${e(group.label)}: ${parts.join(' ')}`;
          }
          html += `</span></div>`;
        });
      } else if (typeof data === 'object') {
        const isCustomGroup = this._isCustomStatusGroup(group);

        const timeTerms = window.step3SchemaBuilder?.getTimeTermsFromGroup?.(group);
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
            timeHtml += ` ${this.renderEditableField(
              `${group.key}.hour`,
              data.hour ?? fallbackHour ?? '',
              editable
            )}`;
            timeHtml += `<span class="time-separator">:</span>`;
            timeHtml += this.renderEditableField(
              `${group.key}.minute`,
              data.minute ?? fallbackMinute ?? '',
              editable
            );
          }

          html += `<div class="status-item custom-status-${e(group.key)}">`;
          html += `<span class="status-icon">${icon}</span>`;
          html += `<span class="status-value">${timeHtml}</span>`;
          html += `</div>`;
          continue;
        }

        // 对象类型：一行显示所有子字段
        const parts = [];
        const currency =
          window.step3SchemaBuilder?.getCurrencyLabelFromGroup?.(group) ||
          window.worldMeta?.getActiveCurrencyTerms?.()?.currencyLabel ||
          '';
        const fields = this._getFieldsForObjectGroup(group, data);
        for (const field of fields) {
          if (data[field.key] !== null && data[field.key] !== undefined && data[field.key] !== '') {
            const displayValue =
              group.key === 'location'
                ? this._formatLocationFieldValue(field.key, data[field.key])
                : data[field.key];
            let rendered = this.renderEditableField(
              `${group.key}.${field.key}`,
              displayValue,
              editable
            );
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
        if (parts.length > 0) {
          html += `<div class="status-item custom-status-${e(group.key)}">`;
          html += `<span class="status-icon">${icon}</span>`;
          html += `<span class="status-value">`;
          if (isCustomGroup) {
            html += `${e(this._getStatusGroupLabel(group))}: ${parts.join(' / ')}`;
          } else {
            html += parts.join(' ');
          }
          html += `</span></div>`;
        }
      }
    }

    html += '</div>';
    return html;
  },

  /**
   * 渲染选项
   */
  renderChoices(choices) {
    const e = text => this.escapeHtml(String(text ?? '')); // 简写
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
      // auto-send 路径不 focus 输入栏：iOS/Android 上 focus 会弹软键盘，preventScroll
      // 也挡不住；用户用「点」就是不想打字。autoResize 也跳过——handleSendMessage
      // 紧接着会清空 value 并 reset 高度。
      if (autoSendEnabled && canAutoSend) {
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

  // 回填最新 AI 消息的 gameData，避免 rebuild 时视觉回退
  _syncLatestAiGameData();

  // 失效置顶状态栏缓存，避免浮动状态栏继续显示旧值
  window.invalidateLatestStickyStatusCache?.();

  // 世界卡下不触发游戏槽位 autoSave（走设计态自己的持久化）
  if (window.isDesignMode) return;

  // 立即静默自动存档：消除"编辑后关页面丢失"隐患
  window.sessionManager?.autoSaveGame?.();
}

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

  // 防止回车换行
  chatContainer.addEventListener('keydown', e => {
    const field = e.target;
    if (!field || !field.classList.contains('status-editable')) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      field.blur();
    }
  });

  console.log('[StatusEdit] 状态栏编辑事件已绑定');
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bindStatusEditEvents);
} else {
  queueMicrotask(_bindStatusEditEvents);
}
