// ============================================
// World Card Info UI - 世界卡右侧栏世界卡信息
// ============================================
// 模仿沙盒 NPC 角色档案磁贴的视觉风格
// 展示 designConfig 中五个阶段的概要信息

const worldCardInfoUI = {
  // 五个阶段的配置
  STAGES: [
    { key: 'world_setting', label: '世界设定', icon: '🌍', index: 1 },
    { key: 'prompt_modules', label: '规则系统', icon: '⚙️', index: 2 },
    { key: 'character_database', label: '角色数据库', icon: '👥', index: 3 },
    { key: 'timeline', label: '时间线', icon: '📅', index: 4 },
    { key: 'character_timelines', label: '角色时间线', icon: '🔀', index: 5 },
  ],

  _isEnglish() {
    return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
  },

  _getStageLabel(stageKey, fallback) {
    const labels = this._isEnglish()
      ? {
          world_setting: 'World Setting',
          prompt_modules: 'Rules',
          character_database: 'Character Database',
          timeline: 'Timeline',
          character_timelines: 'Character Timelines',
        }
      : {};
    return labels[stageKey] || fallback;
  },

  _label(zh, en) {
    return this._isEnglish() ? en : zh;
  },

  _getDefaultStep3Fields() {
    const builder = window.step3SchemaBuilder;
    if (!builder) return null;
    const locale = this._isEnglish() ? 'en' : 'zh-CN';
    return {
      panel_status:
        typeof builder.getDefaultStatusFields === 'function'
          ? builder.getDefaultStatusFields(locale)
          : JSON.parse(JSON.stringify(builder.DEFAULT_STATUS_FIELDS)),
      panel_npc:
        typeof builder.getDefaultNpcFields === 'function'
          ? builder.getDefaultNpcFields(locale)
          : JSON.parse(JSON.stringify(builder.DEFAULT_NPC_FIELDS)),
    };
  },

  /**
   * 刷新世界卡信息面板
   */
  refresh() {
    const container = document.getElementById('worldcard-info-container');
    const phaseBadge = document.getElementById('worldcard-phase-badge');
    if (!container) return;

    const ds = window.designService;
    if (!ds) {
      container.innerHTML = `<div class="worldcard-empty">${this._isEnglish() ? 'Design service is not ready' : '设计服务未初始化'}</div>`;
      return;
    }

    const dc = ds.designConfig || {};
    const phase = ds.phase || 'p1';
    const p2Stage = ds.p2Stage || 0;

    // 更新阶段徽章
    if (phaseBadge) {
      const phaseLabels = this._isEnglish()
        ? { p1: 'P1 Gather', p2: 'P2 Build', p3: 'P3 Review', done: 'Done' }
        : { p1: 'P1 采集', p2: 'P2 生成', p3: 'P3 审阅', done: '✅ 完成' };
      phaseBadge.textContent = phaseLabels[phase] || phase.toUpperCase();
      phaseBadge.className = 'worldcard-phase-badge worldcard-phase-' + phase;
    }

    // Phase 1: 显示框架采集状态 + step3_fields 编辑卡片
    if (phase === 'p1') {
      const hasP1 = ds.p1Output !== null && ds.p1Output !== undefined;
      let html =
        this._renderMetaCard(ds) +
        '<div class="wci-divider"></div>' +
        this._renderP1Card(hasP1, ds.p1Output);
      // Phase 1 起即可查看/编辑 step3_fields
      html += '<div class="wci-divider"></div>';
      let p1Hint;
      if (!hasP1) {
        p1Hint = '框架就绪后将自动推断，也可提前手动配置';
      } else if (dc.step3_fields?._source === 'defaults') {
        p1Hint = 'ℹ️ 使用默认配置（未检测到世界术语），可手动调整';
      } else {
        // 'inferred' 或旧存档无 _source 属性时，视为已推断
        p1Hint = '✅ 已根据世界术语自动推断，可在【执行】前调整';
      }
      html += this._renderStep3FieldsCards(dc, p1Hint);
      container.innerHTML = html;
      this._bindMetaInputs(ds);
      this._bindStep3FieldsEvents(ds);
      return;
    }

    // Phase 2/3/done: 显示五个阶段的数据卡片（合并为一个卡片）
    let html = this._renderMetaCard(ds);
    html += '<div class="wci-divider"></div>';
    html += this._renderStagesCard(dc, phase, p2Stage, ds);
    // Step 3 字段编辑卡片（始终显示，Phase 2 自动生成期间锁定）
    const isGenerating = phase === 'p2' && ds.isAutoGenerating;
    const hint = isGenerating ? '🔒 生成中，字段已锁定' : null;
    html += '<div class="wci-divider"></div>';
    html += this._renderStep3FieldsCards(dc, hint, isGenerating);

    container.innerHTML =
      html ||
      `<div class="worldcard-empty">${this._isEnglish() ? 'No data yet' : '暂无数据'}</div>`;
    this._bindMetaInputs(ds);

    // 绑定字段编辑事件（自动生成期间不绑定，防止中途修改导致不一致）
    if (!isGenerating) {
      this._bindStep3FieldsEvents(ds);
    }
  },

  /**
   * 渲染世界卡元信息编辑卡片（名称 + 描述）
   */
  _renderMetaCard(ds) {
    const name = this._escape(ds.worldCardName || '');
    const desc = this._escape(ds.worldCardDescription || '');
    const isEnglish = this._isEnglish();
    return `
            <div class="wci-card wci-meta-card">
                <div class="wci-card-header">
                    <span class="wci-card-icon">🏷️</span>
                    <span class="wci-card-title">${isEnglish ? 'World Card' : '世界卡信息'}</span>
                </div>
                <div class="wci-card-body">
                    <div class="wci-meta-field">
                        <label class="wci-meta-label" for="wci-meta-name">${isEnglish ? 'Name' : '名称'}</label>
                        <input id="wci-meta-name" class="wci-meta-input" type="text"
                            placeholder="${isEnglish ? 'Name your world...' : '为你的世界起个名字…'}" value="${name}">
                    </div>
                    <div class="wci-meta-field">
                        <label class="wci-meta-label" for="wci-meta-desc">${isEnglish ? 'Description' : '描述'}</label>
                        <textarea id="wci-meta-desc" class="wci-meta-textarea wci-meta-textarea--auto"
                            placeholder="${isEnglish ? 'Describe this world...' : '简短描述这个世界…'}" rows="1">${desc}</textarea>
                    </div>
                </div>
            </div>`;
  },

  /**
   * 绑定元信息输入框的 blur 事件，自动保存到 designService
   */
  _bindMetaInputs(ds) {
    const nameInput = document.getElementById('wci-meta-name');
    const descInput = document.getElementById('wci-meta-desc');
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        ds.worldCardName = nameInput.value.trim();
        // 使用轻量保存，不触发 refresh 避免死循环
        this._saveMetaOnly(ds);
      });
    }
    if (descInput) {
      // 自动调整高度
      const autoResize = () => {
        descInput.style.height = 'auto';
        descInput.style.height = descInput.scrollHeight + 'px';
      };
      autoResize();
      descInput.addEventListener('input', () => {
        ds.worldCardDescription = descInput.value.trim();
        this._saveMetaOnly(ds);
        autoResize();
      });
    }
  },

  /**
   * 仅保存 meta（不触发 worldCardInfoUI.refresh 避免循环）
   */
  _saveMetaOnly(ds) {
    try {
      localStorage.setItem(
        'design_mode_meta',
        JSON.stringify({
          phase: ds.phase,
          p2Stage: ds.p2Stage,
          p1Output: ds.p1Output,
          worldCardName: ds.worldCardName,
          worldCardDescription: ds.worldCardDescription,
        })
      );
    } catch (_e) {
      void _e;
    }
  },

  /**
   * 渲染 Phase 1 状态卡片
   */
  _renderP1Card(hasP1, p1Output) {
    const isEnglish = this._isEnglish();
    if (!hasP1) {
      return `
                <div class="wci-card">
                    <div class="wci-card-header">
                        <span class="wci-card-icon">💬</span>
                        <span class="wci-card-title">${isEnglish ? 'Framework Gathering' : '框架采集'}</span>
                        <span class="wci-status wci-status-pending">${isEnglish ? 'In Progress' : '进行中'}</span>
                    </div>
                    <div class="wci-card-body">
                        <div class="wci-hint">${isEnglish ? 'Chat with the AI and describe your world...' : '与 AI 对话，描述你的世界设定…'}</div>
                    </div>
                </div>`;
    }

    // P1 已完成，显示框架概要
    let summaryHtml = '';
    if (p1Output && typeof p1Output === 'object') {
      const keys = Object.keys(p1Output).filter(k => !k.startsWith('_'));
      for (const key of keys.slice(0, 5)) {
        const val = p1Output[key];
        const preview =
          typeof val === 'string'
            ? val.length > 60
              ? val.slice(0, 60) + '…'
              : val
            : typeof val === 'object'
              ? JSON.stringify(val).slice(0, 60) + '…'
              : String(val);
        summaryHtml += `
                    <div class="wci-field">
                        <span class="wci-field-label">${this._escape(key)}</span>
                        <span class="wci-field-value">${this._escape(preview)}</span>
                    </div>`;
      }
    }

    return `
            <div class="wci-card">
                <div class="wci-card-header">
                    <span class="wci-card-icon">💬</span>
                    <span class="wci-card-title">${isEnglish ? 'Framework Gathering' : '框架采集'}</span>
                    <span class="wci-status wci-status-done">${isEnglish ? 'Ready' : '✅ 就绪'}</span>
                </div>
                <div class="wci-card-body">
                    ${summaryHtml || `<div class="wci-hint">${isEnglish ? 'Framework data is ready' : '框架数据已就绪'}</div>`}
                </div>
            </div>`;
  },

  /**
   * 渲染五个阶段合并为一个卡片（仅状态行，无预览）
   */
  _renderStagesCard(dc, phase, p2Stage, ds) {
    let rowsHtml = '';
    for (const stage of this.STAGES) {
      const data = dc[stage.key];
      const hasData =
        data !== null &&
        data !== undefined &&
        typeof data === 'object' &&
        Object.keys(data).length > 0;
      const isCurrentStage = phase === 'p2' && p2Stage === stage.index;
      const isGenerating = isCurrentStage && ds.isAutoGenerating;
      const isBeforeCurrentStage = phase === 'p2' && stage.index > p2Stage && !hasData;

      let statusHtml;
      if (isGenerating) {
        statusHtml = `<span class="wci-status wci-status-generating"><span class="wci-pulse"></span>${this._label('生成中', 'Building')}</span>`;
      } else if (hasData) {
        statusHtml = '<span class="wci-status wci-status-done">✅</span>';
      } else if (isBeforeCurrentStage) {
        statusHtml = '<span class="wci-status wci-status-waiting">⬜</span>';
      } else {
        statusHtml = '<span class="wci-status wci-status-pending">⬜</span>';
      }

      // 简要统计
      let briefHtml = '';
      if (hasData) {
        const brief = this._getStageBrief(stage.key, data);
        if (brief) briefHtml = `<span class="wci-stage-brief">${brief}</span>`;
      }

      const rowClass = `wci-stage-row${isGenerating ? ' wci-stage-generating' : ''}${!hasData ? ' wci-stage-empty' : ''}`;
      rowsHtml += `<div class="${rowClass}">
                <span class="wci-card-icon">${stage.icon}</span>
                <span class="wci-card-title">${this._getStageLabel(stage.key, stage.label)}</span>
                ${briefHtml}
                ${statusHtml}
            </div>`;
    }

    return `<div class="wci-card wci-stages-card">
            <div class="wci-card-header">
                <span class="wci-card-icon">📋</span>
                <span class="wci-card-title">${this._label('生成进度', 'Build Progress')}</span>
            </div>
            <div class="wci-card-body wci-stages-body">
                ${rowsHtml}
            </div>
        </div>`;
  },

  /**
   * 获取阶段的简要统计文字
   */
  _getStageBrief(key, data) {
    switch (key) {
      case 'world_setting': {
        if (data.settings && typeof data.settings === 'object') {
          const n = Object.keys(data.settings).filter(k => !k.startsWith('_')).length;
          return this._isEnglish() ? `${n} entities` : `${n} 个实体`;
        }
        return null;
      }
      case 'prompt_modules': {
        if (data.modules && typeof data.modules === 'object') {
          return this._isEnglish()
            ? `${Object.keys(data.modules).length} modules`
            : `${Object.keys(data.modules).length} 个模块`;
        }
        return null;
      }
      case 'character_database': {
        const chars = data.characters || data.npcs || data.npc_list;
        if (Array.isArray(chars))
          return this._isEnglish() ? `${chars.length} characters` : `${chars.length} 个角色`;
        const keys = Object.keys(data).filter(k => !k.startsWith('_'));
        return this._isEnglish() ? `${keys.length} entries` : `${keys.length} 个条目`;
      }
      case 'timeline': {
        const events = data.events || data.timeline_events;
        if (Array.isArray(events))
          return this._isEnglish() ? `${events.length} events` : `${events.length} 个事件`;
        const keys = Object.keys(data).filter(k => !k.startsWith('_'));
        return keys.length > 0
          ? this._isEnglish()
            ? `${keys.length} entries`
            : `${keys.length} 个条目`
          : null;
      }
      case 'character_timelines': {
        const charKeys = Object.keys(data).filter(k => !k.startsWith('_'));
        return charKeys.length > 0
          ? this._isEnglish()
            ? `${charKeys.length} characters`
            : `${charKeys.length} 个角色`
          : null;
      }
      default:
        return null;
    }
  },

  // ==========================================
  // Step 3 字段编辑
  // ==========================================

  /**
   * 获取当前的 step3_fields（从 designConfig 或使用默认值）
   */
  _getStep3Fields(dc) {
    if (dc.step3_fields) return dc.step3_fields;
    // 未编辑时返回完整默认值（状态栏 4 组 + NPC 14 字段）
    return this._getDefaultStep3Fields();
  },

  /**
   * 渲染 Step 3 字段编辑卡片（状态栏 + 角色档案）
   * @param {Object} dc - designConfig
   * @param {string|null} hint - 提示文字（如"框架就绪后将自动推断"）
   * @param {boolean} locked - 是否锁定（生成中禁用交互）
   */
  _renderStep3FieldsCards(dc, hint, locked) {
    const fields = this._getStep3Fields(dc);
    if (!fields) return '';
    const hintHtml = hint
      ? `<div class="wci-s3-hint${locked ? ' is-locked' : ''}">${hint}</div>`
      : '';
    const groupClass = locked ? 'wci-s3-group is-locked' : 'wci-s3-group';
    return (
      hintHtml +
      `<div class="${groupClass}">` +
      this._renderStatusFieldsCard(fields.panel_status || []) +
      this._renderNpcFieldsCard(fields.panel_npc || []) +
      '</div>'
    );
  },

  // ==========================================
  // 模板系统常量
  // ==========================================

  _TEMPLATES: {
    time: { icon: '📅', label: '时间', fixedKey: 'datetime', single: true },
    location: { icon: '📍', label: '地点', fixedKey: 'location', single: true },
    money: { icon: '💰', label: '金钱', fixedKey: 'money', single: true },
    objective: { icon: '🎯', label: '目标', fixedKey: 'objective', single: true },
    custom: { icon: '📋', label: '自定义', fixedKey: null, single: false },
  },

  /**
   * 旧数据兼容：根据 group.key 推断模板类型和参数
   */
  _detectTemplate(group) {
    if (group._template) return group;
    const g = Object.assign({}, group);
    const fl = (g.fields || []).length;

    if (g.key === 'datetime') {
      g._template = 'time';
      const precMap = { 1: 'year', 2: 'month', 3: 'day', 4: 'time' };
      g._precision = precMap[fl] || 'time';
      const yearField = (g.fields || []).find(f => f.key === 'year');
      if (
        yearField &&
        yearField.label &&
        yearField.label !== '年份' &&
        yearField.label.endsWith('年')
      ) {
        g._era = yearField.label.slice(0, -1);
      } else {
        g._era = '';
      }
    } else if (g.key === 'location') {
      g._template = 'location';
      if (fl === 2) g._format = '2-segment';
      else if (fl === 3) g._format = '3-segment';
      else g._format = 'custom';
    } else if (g.key === 'money') {
      g._template = 'money';
      const amountField = (g.fields || []).find(f => f.type === 'integer');
      if (amountField) g._currency = amountField.label;
    } else if (g.key === 'objective') {
      g._template = 'objective';
    } else {
      g._template = 'custom';
    }
    return g;
  },

  /**
   * 根据模板 ID 和参数生成标准 group 对象
   */
  _buildGroupFromTemplate(templateId, params) {
    const tmpl = this._TEMPLATES[templateId];
    if (!tmpl) return null;
    const isEnglish = this._isEnglish();

    switch (templateId) {
      case 'time': {
        const { era = '' } = params;
        const precision = 'time';
        const yearLabel = era ? `${era}${isEnglish ? ' Year' : '年'}` : isEnglish ? 'Year' : '年份';
        const fields = [{ key: 'year', label: yearLabel, type: 'integer' }];
        fields.push({ key: 'month', label: isEnglish ? 'Month' : '月份', type: 'integer' });
        fields.push({ key: 'day', label: isEnglish ? 'Day' : '日期', type: 'integer' });
        fields.push({ key: 'time_str', label: isEnglish ? 'Time' : '时间', type: 'string' });
        return {
          key: 'datetime',
          label: isEnglish ? 'Time' : '时间',
          icon: '📅',
          _template: 'time',
          _precision: precision,
          _era: era,
          fields,
        };
      }
      case 'location': {
        return {
          key: 'location',
          label: isEnglish ? 'Location' : '地点',
          icon: '📍',
          _template: 'location',
          _format: '3-segment',
          fields: [
            { key: 'country', label: isEnglish ? 'Region' : '国家/区域', type: 'string' },
            { key: 'site', label: isEnglish ? 'Place' : '地点', type: 'string' },
            { key: 'spot', label: isEnglish ? 'Spot' : '具体位置', type: 'string' },
          ],
        };
      }
      case 'money': {
        const { currency = isEnglish ? 'Silver' : '银币' } = params;
        return {
          key: 'money',
          label: isEnglish ? 'Money' : '金钱',
          icon: '💰',
          _template: 'money',
          _currency: currency,
          fields: [{ key: 'amount', label: currency, type: 'integer' }],
        };
      }
      case 'objective': {
        return {
          key: 'objective',
          label: isEnglish ? 'Objective' : '目标',
          icon: '🎯',
          _template: 'objective',
          fields: [
            {
              key: 'text',
              label: isEnglish ? 'Current Objective' : '当前目标',
              type: 'string',
              nullable: true,
            },
          ],
        };
      }
      case 'custom': {
        const { name = '', icon = '📋', subfields = [], existingKey = '' } = params;
        const key = existingKey || `custom_${Date.now() % 100000}`;
        return {
          key,
          label: name || (isEnglish ? 'Custom' : '自定义'),
          icon: icon || '📋',
          _template: 'custom',
          fields: subfields.map((sf, i) => ({
            key: sf.key || `field_${i}`,
            label: sf.label || '',
            type: 'string',
          })),
        };
      }
    }
    return null;
  },

  /**
   * 渲染状态栏字段卡片（模板驱动）
   */
  _renderStatusFieldsCard(statusFields) {
    const isEnglish = this._isEnglish();
    const allStatusFields = Array.isArray(statusFields) ? statusFields : [];
    const visibleStatusFields = allStatusFields.filter(g => !this._isHiddenStatusGroup(g));
    const count = visibleStatusFields.length;
    let bodyHtml = '';

    // 检测已使用的模板
    const usedTemplates = new Set();
    const enriched = visibleStatusFields.map(g => this._detectTemplate(g));

    for (let i = 0; i < enriched.length; i++) {
      const g = enriched[i];
      if (g._template && this._TEMPLATES[g._template]?.single) {
        usedTemplates.add(g._template);
      }
      bodyHtml += this._renderTemplateRow(g, i);
    }

    // 空状态提示
    if (count === 0) {
      bodyHtml += `<div class="wci-s3-empty">${isEnglish ? 'No fields added yet<br>Choose what should be shown:' : '还没有添加任何字段<br>选择要显示的信息：'}</div>`;
    }

    // 类别 chips
    bodyHtml += this._renderCategoryChips(usedTemplates);

    // 预览区
    const previewContent = this._generateStatusPreviewHTML(allStatusFields);

    return `
            <div class="wci-card wci-s3-card" data-card-type="panel_status">
                <div class="wci-card-header">
                    <span class="wci-card-icon">📊</span>
                    <span class="wci-card-title">${isEnglish ? 'Status Bar Fields' : '状态栏字段'}</span>
                    ${count > 0 ? `<span class="wci-s3-badge">${isEnglish ? `${count}` : `${count} 个`}</span>` : ''}
                </div>
                <div class="wci-s3-preview">
                    <div class="wci-s3-preview-label">${isEnglish ? 'Preview' : '预览'}</div>
                    <div class="sticky-status-bar">
                        <div class="sticky-status-inner">
                            <span class="sticky-turn-badge">T1</span>
                            <div class="sticky-status-items wci-s3-preview-items">${previewContent}</div>
                        </div>
                    </div>
                </div>
                <div class="wci-card-body wci-s3-card-body">
                    ${bodyHtml}
                </div>
            </div>`;
  },

  /**
   * 根据模板类型分发渲染
   */
  _renderTemplateRow(group, index) {
    const t = group._template || 'custom';
    switch (t) {
      case 'time':
        return this._renderTimeRow(group, index);
      case 'location':
        return this._renderLocationRow(group, index);
      case 'money':
        return this._renderMoneyRow(group, index);
      case 'objective':
        return this._renderObjectiveRow(group, index);
      default:
        return this._renderCustomRow(group, index);
    }
  },

  _renderTimeRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    const era = group._era || '';
    return `<div class="wci-s3-row" data-template="time" data-index="${i}" data-key="${e(group.key || 'datetime')}">
            <span class="wci-s3-row-icon">📅</span>
            <span class="wci-s3-row-name">${isEnglish ? 'Time' : '时间'}</span>
            <span class="wci-s3-row-param"><span class="wci-s3-param-label">${isEnglish ? 'Era' : '纪年'}</span><input class="wci-s3-param-input wci-s3-era-input" data-param="era" value="${e(era)}" placeholder="${isEnglish ? 'Common Era' : '公元'}"></span>
            <span class="wci-s3-row-param"><span class="wci-s3-param-fixed">${isEnglish ? 'Fixed format: YYYY.MM.DD HH:MM' : '固定格式：年月日 + HH:MM'}</span></span>
        </div>`;
  },

  _renderLocationRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    return `<div class="wci-s3-row" data-template="location" data-index="${i}" data-key="${e(group.key || 'location')}">
            <span class="wci-s3-row-icon">📍</span>
            <span class="wci-s3-row-name">${isEnglish ? 'Location' : '地点'}</span>
            <span class="wci-s3-row-param"><span class="wci-s3-param-fixed">${isEnglish ? 'Fixed 3-part format: region - place - spot' : '固定三段式：国家/区域 - 地点 - 具体位置'}</span></span>
        </div>`;
  },

  _renderMoneyRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    const currency = (group.fields && group.fields[0]?.label) || '';
    return `<div class="wci-s3-row" data-template="money" data-index="${i}" data-key="${e(group.key || 'money')}">
            <span class="wci-s3-row-icon">💰</span>
            <span class="wci-s3-row-name">${isEnglish ? 'Money' : '金钱'}</span>
            <span class="wci-s3-row-param"><span class="wci-s3-param-label">${isEnglish ? 'Currency' : '货币单位'}</span><input class="wci-s3-param-input" data-param="currency" value="${e(currency)}" placeholder="${isEnglish ? 'Credits, Dollars...' : '信用点、灵石…'}"></span>
        </div>`;
  },

  _renderObjectiveRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    return `<div class="wci-s3-row" data-template="objective" data-index="${i}" data-key="${e(group.key || 'objective')}">
            <span class="wci-s3-row-icon">🎯</span>
            <span class="wci-s3-row-name">${isEnglish ? 'Current Objective' : '当前目标'}</span>
        </div>`;
  },

  _renderCustomRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    const name = group.label || '';
    const icon = group.icon || '📋';

    let subHtml = '<div class="wci-s3-subfields">';
    for (let fi = 0; fi < (group.fields || []).length; fi++) {
      const f = group.fields[fi];
      subHtml += `<div class="wci-s3-subfield" data-sf-index="${fi}" data-sf-key="${e(f.key || `field_${fi}`)}">`;
      subHtml += `<input class="wci-s3-input wci-s3-sf-label" value="${e(f.label || '')}" placeholder="${isEnglish ? 'Example: HP, Max Value' : '如：HP、最大值'}" data-param="sf-label">`;
      subHtml += `<button class="btn-danger btn-icon btn-sm" data-action="del-subfield" title="${isEnglish ? 'Delete' : '删除'}">✕</button>`;
      subHtml += '</div>';
    }
    subHtml += `<button class="btn-ghost" data-action="add-subfield">${isEnglish ? '+ Add Subfield' : '+ 添加子字段'}</button>`;
    subHtml += '</div>';

    return `<div class="wci-s3-row" data-template="custom" data-index="${i}" data-key="${e(group.key || '')}">
            <span class="wci-s3-row-icon wci-s3-custom-icon">${e(icon)}</span>
            <input class="wci-s3-input wci-s3-custom-name" value="${e(name)}" placeholder="${isEnglish ? 'Label, for example: HP' : '名称，如：生命值'}" data-param="name">
            <input class="wci-s3-input wci-s3-custom-icon-input" value="${e(icon)}" placeholder="📋" data-param="icon">
            <button class="btn-danger btn-icon btn-sm" data-action="del-row" title="${isEnglish ? 'Delete' : '删除'}">✕</button>
            ${subHtml}
        </div>`;
  },

  _isHiddenStatusGroup(group) {
    return !!group && group.key === 'location';
  },

  _buildFixedLocationGroup(existingStatusFields = []) {
    const isEnglish = this._isEnglish();
    const existingLocation = Array.isArray(existingStatusFields)
      ? existingStatusFields.find(g => g && g.key === 'location')
      : null;
    const getLabel = (key, fallback) => {
      const label = existingLocation?.fields?.find(f => f && f.key === key)?.label;
      return typeof label === 'string' && label.trim() ? label.trim() : fallback;
    };
    return {
      key: 'location',
      label: isEnglish ? 'Location' : '地点',
      icon: '📍',
      _template: 'location',
      _format: '3-segment',
      fields: [
        {
          key: 'country',
          label: getLabel('country', isEnglish ? 'Region' : '国家/区域'),
          type: 'string',
        },
        { key: 'site', label: getLabel('site', isEnglish ? 'Place' : '地点'), type: 'string' },
        { key: 'spot', label: getLabel('spot', isEnglish ? 'Spot' : '具体位置'), type: 'string' },
      ],
    };
  },

  _ensureFixedLocationGroup(statusGroups, existingStatusFields = []) {
    let groups = Array.isArray(statusGroups) ? [...statusGroups] : [];

    // 1. 确保 location 存在（保持原有逻辑：替换为固定结构）
    groups = groups.filter(g => g && g.key !== 'location');
    const fixedLocation = this._buildFixedLocationGroup(existingStatusFields);
    const datetimeIndex = groups.findIndex(g => g && g.key === 'datetime');
    if (datetimeIndex >= 0) groups.splice(datetimeIndex + 1, 0, fixedLocation);
    else groups.unshift(fixedLocation);

    // 2. 确保 datetime / money / objective 存在（缺失时从默认字段补回）
    const coreKeys = ['datetime', 'money', 'objective'];
    const defaults = this._getDefaultStep3Fields()?.panel_status || [];
    for (const key of coreKeys) {
      if (!groups.some(g => g && g.key === key)) {
        const defaultGroup = defaults.find(d => d && d.key === key);
        if (defaultGroup) {
          if (key === 'datetime') {
            groups.unshift(defaultGroup);
          } else {
            // money / objective 放在 location 后面
            const locIdx = groups.findIndex(g => g && g.key === 'location');
            groups.splice(locIdx >= 0 ? locIdx + 1 : groups.length, 0, defaultGroup);
          }
        }
      }
    }

    return groups;
  },

  /**
   * 渲染类别 chips
   */
  _renderCategoryChips(usedTemplates) {
    const isEnglish = this._isEnglish();
    let html = '<div class="wci-s3-chips">';
    for (const [tid, tmpl] of Object.entries(this._TEMPLATES)) {
      if (tid === 'location') continue; // 地点固定存在，不提供添加入口
      const disabled = tmpl.single && usedTemplates.has(tid);
      html += `<button class="btn-secondary btn-pill${disabled ? ' is-disabled' : ''}" data-action="add-template" data-tid="${tid}"${disabled ? ' disabled' : ''}>`;
      const labelMap = {
        time: isEnglish ? 'Time' : tmpl.label,
        money: isEnglish ? 'Money' : tmpl.label,
        objective: isEnglish ? 'Objective' : tmpl.label,
        custom: isEnglish ? 'Custom' : tmpl.label,
      };
      html += `${tmpl.icon}${labelMap[tid] || tmpl.label}`;
      html += '</button>';
    }
    html += '</div>';
    return html;
  },

  /**
   * 渲染角色档案字段卡片
   */
  _renderNpcFieldsCard(npcFields) {
    const isEnglish = this._isEnglish();
    const editableCount = npcFields.filter(f => !f.fixed).length;
    let bodyHtml = '';

    for (let fi = 0; fi < npcFields.length; fi++) {
      const f = npcFields[fi];
      const isFixed = f.fixed;
      bodyHtml += `<div class="wci-s3-field${isFixed ? ' wci-s3-field-fixed' : ''}" data-field-index="${fi}" data-stable-key="${this._escape(f.key || '')}">`;
      bodyHtml += `<input class="wci-s3-input wci-s3-field-label" value="${this._escape(f.label || '')}" placeholder="${isEnglish ? 'Field Label' : '字段名称'}" data-field="label"${isFixed ? ' disabled' : ''}>`;
      if (!isFixed) {
        bodyHtml += `<input class="wci-s3-input wci-s3-field-desc" value="${this._escape(f.desc || '')}" placeholder="${isEnglish ? 'Description or example' : '说明或填写示例'}" data-field="desc">`;
        // type（string/integer）由 AI 在 P1/P3 全权决定，UI 不暴露切换入口
        bodyHtml += `<button class="btn-danger btn-icon btn-sm" data-action="del-npc-field" title="${isEnglish ? 'Delete Field' : '删除字段'}">\u2715</button>`;
      } else if (f.desc) {
        bodyHtml += `<span class="wci-s3-field-hint">${this._escape(f.desc)}</span>`;
      }
      bodyHtml += `</div>`;
    }

    bodyHtml += `<button class="btn-ghost" data-action="add-npc-field">${isEnglish ? '+ Add Field' : '+ 添加字段'}</button>`;

    return `
            <div class="wci-card wci-s3-card" data-card-type="panel_npc">
                <div class="wci-card-header">
                    <span class="wci-card-icon">👤</span>
                    <span class="wci-card-title">${isEnglish ? 'Character Panel Fields' : '角色档案字段'}</span>
                    <span class="wci-s3-badge">${isEnglish ? `${npcFields.length} (${editableCount} editable)` : `${npcFields.length} 个 (${editableCount} 可编辑)`}</span>
                </div>
                <div class="wci-card-body wci-s3-card-body">
                    ${bodyHtml}
                </div>
            </div>`;
  },

  /**
   * 绑定 Step 3 字段编辑事件（模板驱动版）
   */
  _bindStep3FieldsEvents(ds) {
    const container = document.getElementById('worldcard-info-container');
    if (!container) return;
    const self = this;

    container.querySelectorAll('.wci-s3-card').forEach(card => {
      const isStatusCard = card.dataset.cardType === 'panel_status';

      // ---- 输入/选择变更 → 自动保存 ----
      card.addEventListener('input', e => {
        // 自定义模板的 icon 实时同步到行首显示
        if (isStatusCard) {
          const row = e.target.closest('.wci-s3-row');
          if (row && e.target.dataset.param === 'icon') {
            const iconEl = row.querySelector('.wci-s3-custom-icon');
            if (iconEl) iconEl.textContent = e.target.value.trim() || '📋';
          }
        }
        self._collectAndSaveStep3Fields(ds);
      });

      card.addEventListener('change', e => {
        if (!isStatusCard) {
          self._collectAndSaveStep3Fields(ds);
          return;
        }
        const row = e.target.closest('.wci-s3-row');
        if (!row) {
          self._collectAndSaveStep3Fields(ds);
          return;
        }
        self._collectAndSaveStep3Fields(ds);
      });

      // ---- 按键/动作点击 ----
      card.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        // -- 模板 chip 点击 → 添加新模板行 --
        if (action === 'add-template' && isStatusCard) {
          const tid = btn.dataset.tid;
          if (!tid || btn.disabled) return;
          // 用默认参数创建 group
          const params = {};
          if (tid === 'custom') {
            params.subfields = [{ key: 'field_0', label: '' }];
          }
          const group = self._buildGroupFromTemplate(tid, params);
          if (!group) return;
          // 保存并重绘
          self._addStatusGroup(ds, group);
          return;
        }

        // -- 删除模板行（仅自定义组可删，核心4组不可删）--
        if (action === 'del-row' && isStatusCard) {
          const row = btn.closest('.wci-s3-row');
          if (row) {
            const tpl = row.dataset.template;
            if (['time', 'location', 'money', 'objective'].includes(tpl)) return;
            row.remove();
            self._collectAndSaveStep3Fields(ds);
            self._refreshChipStates(card);
          }
          return;
        }

        // -- 删除子字段 --
        if (action === 'del-subfield' && isStatusCard) {
          const sf = btn.closest('.wci-s3-subfield');
          if (sf) {
            sf.remove();
            self._collectAndSaveStep3Fields(ds);
          }
          return;
        }

        // -- 添加子字段 --
        if (action === 'add-subfield' && isStatusCard) {
          const subfields = btn.closest('.wci-s3-subfields');
          if (subfields) {
            const idx = subfields.querySelectorAll('.wci-s3-subfield').length;
            const newSf = document.createElement('div');
            newSf.className = 'wci-s3-subfield';
            newSf.dataset.sfIndex = String(idx);
            newSf.dataset.sfKey = `field_${idx}`;
            newSf.innerHTML =
              '<input class="wci-s3-input wci-s3-sf-label" value="" placeholder="如：HP、最大值" data-param="sf-label"><button class="btn-danger btn-icon btn-sm" data-action="del-subfield" title="删除">✕</button>';
            subfields.insertBefore(newSf, btn);
            self._collectAndSaveStep3Fields(ds);
            newSf.querySelector('input')?.focus();
          }
          return;
        }

        // -- NPC 字段删除 --
        if (action === 'del-npc-field') {
          const fieldEl = btn.closest('.wci-s3-field');
          if (fieldEl) {
            fieldEl.remove();
            self._collectAndSaveStep3Fields(ds);
          }
          return;
        }

        // -- NPC 添加字段 --
        if (action === 'add-npc-field') {
          const cardBody = card.querySelector('.wci-s3-card-body');
          if (cardBody) {
            const newField = document.createElement('div');
            newField.className = 'wci-s3-field';
            newField.innerHTML = `
                            <input class="wci-s3-input wci-s3-field-label" value="" placeholder="字段名称" data-field="label">
                            <input class="wci-s3-input wci-s3-field-desc" value="" placeholder="说明或填写示例" data-field="desc">
                            <button class="btn-danger btn-icon btn-sm" data-action="del-npc-field" title="删除字段">✕</button>`;
            cardBody.insertBefore(newField, btn);
            self._collectAndSaveStep3Fields(ds);
          }
          return;
        }
      });
    });
  },

  /**
   * 添加一个 status group 并重绘状态卡
   */
  _addStatusGroup(ds, group) {
    if (!ds.designConfig) ds.designConfig = {};
    if (!ds.designConfig.step3_fields) {
      const defaults = this._getDefaultStep3Fields();
      ds.designConfig.step3_fields = {
        panel_status: this._ensureFixedLocationGroup([], []),
        panel_npc: defaults?.panel_npc || [],
      };
    }
    ds.designConfig.step3_fields.panel_status.push(group);
    ds.designConfig.step3_fields.panel_status = this._ensureFixedLocationGroup(
      ds.designConfig.step3_fields.panel_status,
      ds.designConfig.step3_fields.panel_status
    );
    if (typeof ds._saveDesignConfig === 'function') {
      ds._saveDesignConfig({ skipRefresh: true });
    }
    this._refreshStatusCard(ds);
  },

  /**
   * 刷新状态栏字段卡片（不触发完整 refresh，仅重建 panel_status 卡）
   */
  _refreshStatusCard(ds) {
    const container = document.getElementById('worldcard-info-container');
    if (!container) return;
    const oldCard = container.querySelector('[data-card-type="panel_status"]');
    if (!oldCard) return;
    const dc = ds.designConfig || {};
    const fields = this._getStep3Fields(dc);
    const newHtml = this._renderStatusFieldsCard(fields.panel_status || []);
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    const newCard = tmp.firstElementChild;
    oldCard.replaceWith(newCard);
    // 重新绑定事件（只为新卡片）
    this._bindSingleCard(newCard, ds);
  },

  /**
   * 为单张卡片绑定事件（_refreshStatusCard 用）
   */
  _bindSingleCard(card, ds) {
    const self = this;
    const isStatusCard = card.dataset.cardType === 'panel_status';

    card.addEventListener('input', e => {
      if (isStatusCard) {
        const row = e.target.closest('.wci-s3-row');
        if (row && e.target.dataset.param === 'icon') {
          const iconEl = row.querySelector('.wci-s3-custom-icon');
          if (iconEl) iconEl.textContent = e.target.value.trim() || '📋';
        }
      }
      self._collectAndSaveStep3Fields(ds);
    });

    card.addEventListener('change', e => {
      if (!isStatusCard) {
        self._collectAndSaveStep3Fields(ds);
        return;
      }
      const row = e.target.closest('.wci-s3-row');
      if (!row) {
        self._collectAndSaveStep3Fields(ds);
        return;
      }
      self._collectAndSaveStep3Fields(ds);
    });

    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'add-template' && isStatusCard) {
        const tid = btn.dataset.tid;
        if (!tid || btn.disabled) return;
        const params = {};
        if (tid === 'custom') params.subfields = [{ key: 'field_0', label: '' }];
        const group = self._buildGroupFromTemplate(tid, params);
        if (!group) return;
        self._addStatusGroup(ds, group);
      } else if (action === 'del-row' && isStatusCard) {
        const row = btn.closest('.wci-s3-row');
        if (row) {
          row.remove();
          self._collectAndSaveStep3Fields(ds);
          self._refreshChipStates(card);
        }
      } else if (action === 'del-subfield' && isStatusCard) {
        const sf = btn.closest('.wci-s3-subfield');
        if (sf) {
          sf.remove();
          self._collectAndSaveStep3Fields(ds);
        }
      } else if (action === 'add-subfield' && isStatusCard) {
        const subfields = btn.closest('.wci-s3-subfields');
        if (subfields) {
          const idx = subfields.querySelectorAll('.wci-s3-subfield').length;
          const newSf = document.createElement('div');
          newSf.className = 'wci-s3-subfield';
          newSf.dataset.sfIndex = String(idx);
          newSf.dataset.sfKey = `field_${idx}`;
          newSf.innerHTML =
            '<input class="wci-s3-input wci-s3-sf-label" value="" placeholder="如：HP、最大值" data-param="sf-label"><button class="btn-danger btn-icon btn-sm" data-action="del-subfield" title="删除">✕</button>';
          subfields.insertBefore(newSf, btn);
          self._collectAndSaveStep3Fields(ds);
          newSf.querySelector('input')?.focus();
        }
      }
    });
  },

  /**
   * 更新 chip 禁用状态（删除行后调用）
   */
  _refreshChipStates(card) {
    const used = new Set();
    card.querySelectorAll('.wci-s3-row[data-template]').forEach(row => {
      const t = row.dataset.template;
      if (this._TEMPLATES[t]?.single) used.add(t);
    });
    card.querySelectorAll('.btn-secondary.btn-pill[data-tid]').forEach(chip => {
      const tid = chip.dataset.tid;
      const shouldDisable = this._TEMPLATES[tid]?.single && used.has(tid);
      chip.disabled = shouldDisable;
      chip.classList.toggle('is-disabled', shouldDisable);
    });
  },

  /**
   * 从 DOM 收集字段定义并保存到 designService（模板驱动版）
   */
  _collectAndSaveStep3Fields(ds) {
    const container = document.getElementById('worldcard-info-container');
    if (!container) return;

    const result = { panel_status: [], panel_npc: [] };
    const existingStep3Fields = this._getStep3Fields(ds.designConfig || {}) || {};
    const existingStatusFields = existingStep3Fields.panel_status || [];

    // 收集 panel_status：遍历模板行
    const statusCard = container.querySelector('[data-card-type="panel_status"]');
    if (statusCard) {
      statusCard.querySelectorAll('.wci-s3-row[data-template]').forEach(row => {
        const tid = row.dataset.template;
        const key = row.dataset.key || '';
        const params = {};

        switch (tid) {
          case 'time': {
            params.precision = 'time';
            params.era = row.querySelector('[data-param="era"]')?.value?.trim() || '';
            break;
          }
          case 'location': {
            // 地点固定三段式，不读取格式和子字段编辑参数
            break;
          }
          case 'money': {
            params.currency = row.querySelector('[data-param="currency"]')?.value?.trim() || '';
            break;
          }
          case 'objective':
            break;
          case 'custom': {
            params.name = row.querySelector('[data-param="name"]')?.value?.trim() || '';
            params.icon = row.querySelector('[data-param="icon"]')?.value?.trim() || '📋';
            params.existingKey = key;
            params.subfields = [];
            row.querySelectorAll('.wci-s3-subfield').forEach(sf => {
              const label = sf.querySelector('[data-param="sf-label"]')?.value?.trim() || '';
              const sfKey = sf.dataset.sfKey || `field_${params.subfields.length}`;
              params.subfields.push({ key: sfKey, label });
            });
            break;
          }
        }

        const group = this._buildGroupFromTemplate(tid, params);
        if (group) result.panel_status.push(group);
      });
    }
    result.panel_status = this._ensureFixedLocationGroup(result.panel_status, existingStatusFields);

    // 收集 panel_npc — key 从 data-stable-key 读取（已有字段）或从 label 生成（新字段）
    const npcCard = container.querySelector('[data-card-type="panel_npc"]');
    if (npcCard) {
      const existingNpcFields = Array.isArray(existingStep3Fields?.panel_npc)
        ? existingStep3Fields.panel_npc
        : [];
      const existingNpcFieldMap = new Map(
        existingNpcFields
          .filter(field => field && typeof field.key === 'string' && field.key.trim())
          .map(field => [field.key.trim(), field])
      );
      npcCard.querySelectorAll('.wci-s3-field').forEach(fieldEl => {
        const stableKey = fieldEl.dataset.stableKey;
        const label = fieldEl.querySelector('[data-field="label"]')?.value?.trim();
        const desc = fieldEl.querySelector('[data-field="desc"]')?.value?.trim();
        const isFixed = fieldEl.classList.contains('wci-s3-field-fixed');
        if (label || stableKey) {
          const key = stableKey || label;
          const baseField = stableKey ? existingNpcFieldMap.get(stableKey) : null;
          const fieldDef = baseField ? JSON.parse(JSON.stringify(baseField)) : { type: 'string' };
          fieldDef.key = key;
          fieldDef.label = label || key;
          // type 由 AI 在 P1/P3 决定；UI 不暴露切换入口，保留 baseField 原值
          fieldDef.type = fieldDef.type || 'string';
          if (desc) {
            fieldDef.desc = desc;
          } else if (!baseField?.desc) {
            delete fieldDef.desc;
          }
          if (isFixed) {
            fieldDef.fixed = true;
          } else {
            delete fieldDef.fixed;
          }
          if (!baseField || !('runtimeRequired' in baseField)) {
            delete fieldDef.runtimeRequired;
          }
          result.panel_npc.push(fieldDef);
        }
      });
    }

    // 保存到 designService（仅写 localStorage，不触发 refresh 以避免 DOM 重建丢失焦点）
    if (!ds.designConfig) ds.designConfig = {};
    ds.designConfig.step3_fields = result;

    // 增量刷新预览区
    this._updateStatusPreview(ds);

    // 反向同步到 p1Output.world_terms + 聊天预览
    this._syncStep3ToP1OutputAndChatPreview(ds, result);
  },

  // ==========================================
  // 状态栏预览
  // ==========================================

  /**
   * 根据模板类型为一个 group 生成示例数据
   */
  _getMockDataForGroup(group) {
    const isEnglish = this._isEnglish();
    const t = group._template || 'custom';
    switch (t) {
      case 'time': {
        const era = group._era || '';
        const p = group._precision || 'time';
        const obj = {};
        obj.year = 3;
        if (['month', 'day', 'time'].includes(p)) obj.month = 5;
        if (['day', 'time'].includes(p)) obj.day = 12;
        if (p === 'time') obj.time_str = '14:30';
        // 格式化为显示字符串
        let text = isEnglish
          ? `${era ? era + ' ' : ''}${obj.year}`
          : `${era ? era : ''}${obj.year}年`;
        if (obj.month !== null && obj.month !== undefined)
          text += isEnglish ? `.${obj.month}` : ` ${obj.month}月`;
        if (obj.day !== null && obj.day !== undefined)
          text += isEnglish ? `.${obj.day}` : `${obj.day}日`;
        if (obj.time_str) text += ` ${obj.time_str}`;
        return { icon: '📅', text };
      }
      case 'location': {
        const fmt = group._format || '3-segment';
        let parts;
        if (fmt === '2-segment') {
          parts = isEnglish ? ['Capital', 'Inn'] : ['王都', '酒馆'];
        } else if (fmt === '3-segment') {
          parts = isEnglish ? ['Heartland', 'Chang-an', 'City Gate'] : ['中原', '长安', '城门'];
        } else {
          // custom: 用字段 label 做占位
          parts = (group.fields || []).map(f => f.label || '…');
        }
        return { icon: '📍', text: parts.join(' · ') };
      }
      case 'money': {
        const currency = (group.fields && group.fields[0]?.label) || '';
        return { icon: '💰', text: currency ? `1500 ${currency}` : '1500' };
      }
      case 'objective':
        return { icon: '🎯', text: isEnglish ? 'Find the missing princess' : '寻找失踪的公主' };
      default: {
        // custom
        const icon = group.icon || '📋';
        const parts = (group.fields || []).map(f => f.label || '…');
        return {
          icon,
          text:
            parts.length > 0
              ? parts.join(' ')
              : group.label || (this._isEnglish() ? 'Custom' : '自定义'),
        };
      }
    }
  },

  /**
   * 根据字段定义生成预览区 HTML
   */
  _generateStatusPreviewHTML(statusFields) {
    if (!statusFields || statusFields.length === 0) {
      return `<div class="wci-s3-preview-empty">${this._isEnglish() ? 'Add fields to preview the result' : '添加字段后可预览效果'}</div>`;
    }
    const e = v => this._escape(v);
    let items = '';
    for (const group of statusFields) {
      const enriched = this._detectTemplate(group);
      const mock = this._getMockDataForGroup(enriched);
      items += `<div class="status-item"><span class="status-icon">${mock.icon}</span><span class="status-value">${e(mock.text)}</span></div>`;
    }
    return items;
  },

  /**
   * 增量更新预览区 DOM（不重建整卡）
   */
  _updateStatusPreview(ds) {
    const container = document.getElementById('worldcard-info-container');
    if (!container) return;
    const bar = container.querySelector('.wci-s3-preview-items');
    if (!bar) return;
    const dc = ds.designConfig || {};
    const fields = this._getStep3Fields(dc);
    bar.innerHTML = this._generateStatusPreviewHTML(fields.panel_status || []);
  },

  /**
   * 将 step3_fields 变更反向同步到 p1Output.world_terms 和聊天预览
   */
  _syncStep3ToP1OutputAndChatPreview(ds, step3Fields) {
    if (!ds?.p1Output) return;
    if (!ds.p1Output.world_terms) ds.p1Output.world_terms = {};
    const wt = ds.p1Output.world_terms;
    const CORE_STATUS_KEYS = new Set(['datetime', 'location', 'money', 'objective']);

    // 从 panel_status 提取 currency_name, calendar_era, extra_status_groups
    if (Array.isArray(step3Fields.panel_status)) {
      for (const group of step3Fields.panel_status) {
        if (!group) continue;
        if (group.key === 'money' && group._currency) {
          wt.currency_name = group._currency;
        } else if (group.key === 'money' && group.fields?.length > 0) {
          wt.currency_name = group.fields[0].label || wt.currency_name;
        }
        if (group.key === 'datetime' && group._era) {
          wt.calendar_era = group._era;
        }
      }
      // extra_status_groups: 非核心组
      wt.extra_status_groups = step3Fields.panel_status
        .filter(g => g && !CORE_STATUS_KEYS.has(g.key))
        .map(g => ({
          key: g.key,
          label: g.label,
          icon: g.icon || '📋',
          fields: (g.fields || []).map(f => ({
            key: f.key,
            label: f.label,
            type: f.type || 'string',
          })),
        }));
    }

    // 从 panel_npc 提取 extra_char_fields（排除固定字段）
    if (Array.isArray(step3Fields.panel_npc)) {
      const reservedKeys = ds._getNpcReservedKeySet ? ds._getNpcReservedKeySet() : new Set();
      wt.extra_char_fields = step3Fields.panel_npc
        .filter(f => f && !f.fixed && !reservedKeys.has(f.key))
        .map(f => ({
          key: f.key,
          label: f.label,
          type: f.type || 'string',
          ...(f.desc ? { desc: f.desc } : {}),
        }));
    }

    if (typeof ds._saveDesignConfig === 'function') {
      ds._saveDesignConfig({ skipRefresh: true });
    }

    // 更新聊天预览中的显示
    this._refreshChatPreviewTerms(wt);
  },

  /**
   * 刷新聊天区域 P1 框架预览中的术语显示（不重建整个预览）
   */
  _refreshChatPreviewTerms(wt) {
    const preview = document.querySelector('.design-p1-framework-preview:not(.is-disabled)');
    if (!preview) return;

    // 更新可编辑的 term inputs（currency_name, calendar_era）
    preview.querySelectorAll('.design-fw-term-input').forEach(input => {
      const key = input.dataset.termKey;
      if (key && wt[key] !== undefined) {
        input.value = typeof wt[key] === 'string' ? wt[key] : '';
      }
    });

    // 重建只读 extras 行（处理行的增删）
    // extras 行是 .design-fw-terms-section 的直接子元素（不在 .design-fw-terms-grid 内）
    const escapeHTML = str =>
      String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    const termsSection = preview.querySelector('.design-fw-terms-section');
    if (!termsSection) return;
    // 移除旧的 extras 行
    termsSection.querySelectorAll('.design-fw-extras-row').forEach(row => row.remove());

    // 在 guide 提示之前插入新的 extras 行
    const guideEl = termsSection.querySelector('.design-fw-extras-guide');
    const extrasEntries = [
      {
        key: 'calendar_units',
        label: '时间单位',
        data: wt.calendar_units,
        format: v => v.join('、'),
      },
      {
        key: 'location_levels',
        label: '地点层级',
        data: wt.location_levels,
        format: v => v.join('、'),
      },
      {
        key: 'extra_status_groups',
        label: '额外状态组',
        data: wt.extra_status_groups,
        format: v => v.map(g => g?.label || g?.key || '?').join('、'),
      },
      {
        key: 'extra_char_fields',
        label: '额外角色字段',
        data: wt.extra_char_fields,
        format: v => v.map(f => f?.label || f?.key || '?').join('、'),
      },
    ];
    for (const entry of extrasEntries) {
      if (!Array.isArray(entry.data) || entry.data.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'design-fw-extras-row';
      row.innerHTML = `<span class="design-fw-term-label">${escapeHTML(entry.label)}</span><span class="design-fw-extras-value" data-extras-key="${entry.key}">${escapeHTML(entry.format(entry.data))}</span>`;
      if (guideEl) {
        termsSection.insertBefore(row, guideEl);
      } else {
        termsSection.appendChild(row);
      }
    }
  },

  // ==========================================
  // 工具方法
  // ==========================================

  _escape(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  _truncate(text, maxLen) {
    if (!text || text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '…';
  },
};

// 暴露到全局
window.worldCardInfoUI = worldCardInfoUI;

window.addEventListener('ui-language-changed', () => {
  const tile = document.getElementById('worldcard-info-tile');
  const isVisible = tile && window.getComputedStyle(tile).display !== 'none';
  if (isVisible && window.worldCardInfoUI && typeof window.worldCardInfoUI.refresh === 'function') {
    window.worldCardInfoUI.refresh();
  }
});
