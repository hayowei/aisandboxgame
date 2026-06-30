// ============================================
// World Card Info UI - 世界卡右侧栏世界卡信息
// ============================================
// 模仿沙盒 NPC 角色档案磁贴的视觉风格
// 展示 designConfig 中五个阶段的概要信息

const WCI_META_NAME_MAX = 15;
const WCI_META_DESC_MAX = 100;

const worldCardInfoUI = {
  // 五个阶段的配置
  STAGES: [
    { key: 'world_setting', label: '世界设定', icon: '🌍', index: 1 },
    { key: 'prompt_modules', label: '规则系统', icon: '⚙️', index: 2 },
    { key: 'character_database', label: '角色数据库', icon: '👥', index: 3 },
    { key: 'world_timeline', label: '世界时间线', icon: '📅', index: 4 },
    { key: 'relationships_overview', label: '角色关系总览', icon: '🔀', index: 5 },
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
          world_timeline: 'World Timeline',
          relationships_overview: 'Relationship Overview',
        }
      : {};
    return labels[stageKey] || fallback;
  },

  _label(zh, en) {
    return this._isEnglish() ? en : zh;
  },

  _getDefaultPanelFields() {
    const builder = window.panelSchemaBuilder;
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
   * 刷新"应用到游戏"按钮状态 + 首次挂 click
   * - p1: 灰显 "完成设计后可应用"
   * - p2: 灰显 "生成中…"
   * - p3 / done: 亮起 "应用到游戏"，点击走 designService.applyToGame()
   */
  _refreshApplyButton(phase, ds) {
    const btn = document.getElementById('worldcard-apply-btn');
    if (!btn) return;

    if (!btn._wciApplyBound) {
      btn.addEventListener('click', () => {
        const svc = window.designService;
        if (!svc || typeof svc.applyToGame !== 'function') return;
        if (btn.disabled) return;
        svc.applyToGame();
      });
      btn._wciApplyBound = true;
    }

    const labelEl = btn.querySelector('.worldcard-apply-label');
    const isEn = this._isEnglish();
    let label;
    let enabled = false;
    if (phase === 'pzwc') {
      // PZWC 建造阶段：卡未落地（finish → loadCardIntoDesignMode 切 p3 后才可应用）
      const building = !!window.pzwcDesignController?.isBuilding?.();
      label = building
        ? (isEn ? 'Building…' : '建造中…')
        : (isEn ? 'Available after build' : '完成建造后可应用');
    } else if (phase === 'p2') {
      label = isEn ? 'Building…' : '生成中…';
    } else if (phase === 'p1') {
      label = isEn ? 'Available after design' : '完成设计后可应用';
    } else {
      // p3 / done / 其它
      label = isEn ? 'Apply to game' : '应用到游戏';
      enabled = true;
    }
    if (labelEl) labelEl.textContent = label;
    btn.disabled = !enabled;
    btn.dataset.phase = phase;
  },

  /**
   * 刷新世界卡信息面板
   */
  _crossRefreshTimer: null,
  // M3：累积所有编辑源容器（不止最后一个），120ms 去抖后一次刷新、跳过全部源（保各自焦点）。
  // 旧版单一 srcContainer 会被后一次编辑覆盖，导致在两个容器间快速切换编辑时漏刷其一。
  _scheduleCrossRefresh(ds, srcContainer) {
    if (!this._crossRefreshSources) this._crossRefreshSources = new Set();
    if (srcContainer) this._crossRefreshSources.add(srcContainer);
    if (this._crossRefreshTimer) clearTimeout(this._crossRefreshTimer);
    this._crossRefreshTimer = setTimeout(() => {
      this._crossRefreshTimer = null;
      const skip = this._crossRefreshSources;
      this._crossRefreshSources = new Set();
      this.refresh(skip);
    }, 120);
  },
  // C2：聊天区内的 DOM 改高度操作必须经 scrollController（铁律：主聊天区滚动只它管）。
  // 宿主不在聊天区（侧栏）时直接执行。单层包裹——调用方不要再嵌套。
  _domMutateScoped(container, fn) {
    const inChat = container && typeof container.closest === 'function' && container.closest('.chat-messages-area');
    if (inChat && window.scrollController && typeof window.scrollController.runScoped === 'function') {
      window.scrollController.runScoped(fn);
    } else {
      fn();
    }
  },

  // skipContainer 可为单个元素或 Set（多源去抖时跳过所有正在编辑的源容器，保焦点）
  refresh(skipContainer) {
    const skipSet = skipContainer instanceof Set ? skipContainer : (skipContainer ? new Set([skipContainer]) : new Set());
    const sidebar = document.getElementById('worldcard-info-container');
    if (sidebar && !skipSet.has(sidebar)) this._refreshSidebar(sidebar);
  },

  _refreshSidebar(container) {
    if (!container) return;

    // 整卡重建前清掉可能开着的 emoji 弹层 + 其 document 监听（否则随 innerHTML 丢弃后泄漏）
    this._removeIconPops(document);

    const ds = window.designService;
    if (!ds) {
      container.innerHTML = `<div class="worldcard-empty">${this._isEnglish() ? 'Design service is not ready' : '设计服务未初始化'}</div>`;
      return;
    }

    const dc = ds.designConfig || {};
    // phase 现只会是 'pzwc' / 'p3'（老 'p1' 分支随 PZWC 替换拆除）
    const phase = ds.phase || 'pzwc';
    const p2Stage = ds.p2Stage || 0;

    this._refreshApplyButton(phase, ds);

    // 显示阶段数据卡片（合并为一个卡片）
    let html = this._renderMetaCard(ds);
    html += '<div class="wci-divider"></div>';
    html += this._renderStagesCard(dc, phase, p2Stage, ds);
    // Step 3 字段编辑卡片（始终显示，Phase 2 自动生成期间锁定）
    const isGenerating = phase === 'p2' && ds.isAutoGenerating;
    const hint = isGenerating ? '🔒 生成中，字段已锁定' : null;
    html += '<div class="wci-divider"></div>';
    html += this._renderPanelFieldsCards(dc, hint, isGenerating);

    container.innerHTML =
      html ||
      `<div class="worldcard-empty">${this._isEnglish() ? 'No data yet' : '暂无数据'}</div>`;
    this._bindMetaInputs(ds);

    // 绑定字段编辑事件（自动生成期间不绑定，防止中途修改导致不一致）
    if (!isGenerating) {
      this._bindPanelFieldsEvents(ds, container);
    }
  },

  /**
   * 渲染世界卡元信息编辑卡片（名称 + 描述）
   */
  _renderMetaCard(ds) {
    const nameRaw = ds.worldCardName || '';
    const descRaw = ds.worldCardDescription || '';
    const name = this._escape(nameRaw);
    const desc = this._escape(descRaw);
    const isEnglish = this._isEnglish();
    const nameOver = [...nameRaw].length > WCI_META_NAME_MAX;
    const descOver = [...descRaw].length > WCI_META_DESC_MAX;
    return `
            <div class="wci-card wci-meta-card">
                <div class="wci-card-header">
                    <span class="wci-card-icon">🏷️</span>
                    <span class="wci-card-title">${isEnglish ? 'World Card' : '世界卡信息'}</span>
                </div>
                <div class="wci-card-body">
                    <div class="wci-meta-field">
                        <div class="wci-meta-label-row">
                            <label class="wci-meta-label" for="wci-meta-name">${isEnglish ? 'Name' : '名称'}</label>
                            <span class="wci-meta-count${nameOver ? ' is-over' : ''}" data-meta-count-for="wci-meta-name">${[...nameRaw].length} / ${WCI_META_NAME_MAX}</span>
                        </div>
                        <input id="wci-meta-name" class="wci-meta-input" type="text" maxlength="${WCI_META_NAME_MAX}"
                            placeholder="${isEnglish ? 'Name your world...' : '为你的世界起个名字…'}" value="${name}">
                    </div>
                    <div class="wci-meta-field">
                        <div class="wci-meta-label-row">
                            <label class="wci-meta-label" for="wci-meta-desc">${isEnglish ? 'Description' : '描述'}</label>
                            <span class="wci-meta-count${descOver ? ' is-over' : ''}" data-meta-count-for="wci-meta-desc">${[...descRaw].length} / ${WCI_META_DESC_MAX}</span>
                        </div>
                        <textarea id="wci-meta-desc" class="wci-meta-textarea wci-meta-textarea--auto" maxlength="${WCI_META_DESC_MAX}"
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
    const updateCount = (input, max) => {
      const counter = document.querySelector(`[data-meta-count-for="${input.id}"]`);
      if (!counter) return;
      const len = [...input.value].length;
      counter.textContent = `${len} / ${max}`;
      counter.classList.toggle('is-over', len > max);
    };
    if (nameInput) {
      nameInput.addEventListener('input', () => {
        ds.worldCardName = nameInput.value.trim();
        updateCount(nameInput, WCI_META_NAME_MAX);
        // 使用轻量保存，不触发 refresh 避免死循环
        this._saveMetaOnly(ds);
      });
    }
    if (descInput) {
      // 自动调整高度。textarea 是 box-sizing:border-box，而 scrollHeight 不含上下 border，
      // 直接令 height=scrollHeight 会差出 border 那点（~2px），末行底部被 overflow:hidden 削掉。
      // offsetHeight-clientHeight 即 border（+ 可能的横向滚动条，本处无），补上才量准。
      const autoResize = () => {
        descInput.style.height = 'auto';
        const chrome = descInput.offsetHeight - descInput.clientHeight;
        descInput.style.height = descInput.scrollHeight + chrome + 'px';
      };
      autoResize();
      descInput.addEventListener('input', () => {
        ds.worldCardDescription = descInput.value.trim();
        updateCount(descInput, WCI_META_DESC_MAX);
        this._saveMetaOnly(ds);
        autoResize();
      });
      // 宽度变化后重新量高。本面板（worldcard-info-tile）会被 stageEmbed 在不同宽度的 pane
      // 之间 reparent，且常在 display:none 的源位置先 bind——此时 scrollHeight 偏小（甚至为 0），
      // 首次算出的高度会过小，描述被 overflow:hidden 截断（无滚动条）。监听文本框自身宽度变化
      // （含 隐藏→可见 的 0→实宽、reparent 换宽、窗口/容器缩放）重量。仅在宽度真变化时触发，
      // 避免 autoResize 改高度反过来触发观察器形成回环。
      if (typeof ResizeObserver === 'function') {
        let lastWidth = descInput.clientWidth;
        let raf = 0;
        const ro = new ResizeObserver(() => {
          const w = descInput.clientWidth;
          if (w === lastWidth) return;
          lastWidth = w;
          // autoResize 会写 height —— 直接在 RO 回调里写布局会触发
          // "ResizeObserver loop completed with undelivered notifications"。
          // 把写操作推迟到下一帧（rAF），移出 RO 派发周期即可消除；多次宽度变化合并成一次。
          if (raf) cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            raf = 0;
            autoResize();
          });
        });
        ro.observe(descInput);
      }
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
   * 渲染五个阶段合并为一个卡片（仅状态行，无预览）
   */
  _renderStagesCard(dc, phase, p2Stage, ds) {
    const isEnglish = this._isEnglish();
    let rowsHtml = '';
    let doneCount = 0;
    let running = false;
    for (const stage of this.STAGES) {
      // relationships_overview 不是独立顶层字段，从 character_database 派生
      let data;
      if (stage.key === 'relationships_overview') {
        // 老卡：用 character_timelines 兜底；新卡：用 character_database
        data = dc.character_timelines || dc.character_database;
      } else {
        data = dc[stage.key];
      }
      const hasData =
        data !== null &&
        data !== undefined &&
        typeof data === 'object' &&
        Object.keys(data).length > 0;
      const isCurrentStage = phase === 'p2' && p2Stage === stage.index;
      const isGenerating = isCurrentStage && ds.isAutoGenerating;
      const isBeforeCurrentStage = phase === 'p2' && stage.index > p2Stage && !hasData;

      let status;
      if (isGenerating) {
        status = 'generating';
        running = true;
      } else if (hasData) {
        status = 'done';
        doneCount++;
      } else if (isBeforeCurrentStage) {
        status = 'waiting';
      } else {
        status = 'pending';
      }

      // 简要统计
      let briefHtml = '';
      if (hasData) {
        const brief = this._getStageBrief(stage.key, data);
        if (brief) briefHtml = `<span class="wci-stage-brief">${brief}</span>`;
      }

      rowsHtml += `<div class="wci-stage-row wci-stage-${status}">
                <span class="wci-stage-icon wci-stage-icon-${status}">${stage.icon}</span>
                <span class="wci-stage-main">
                    <span class="wci-stage-name">${this._getStageLabel(stage.key, stage.label)}</span>
                    ${briefHtml}
                </span>
                ${this._renderStageBadge(status)}
            </div>`;
    }

    const total = this.STAGES.length;
    const pct = Math.round(((doneCount + (running ? 0.5 : 0)) / total) * 100);
    const runningHtml = running
      ? `<span class="wci-stages-running"><span class="wci-pulse"></span>${this._label('进行中', 'Running')}</span>`
      : '';

    return `<div class="wci-card wci-stages-card">
            <div class="wci-card-header">
                <span class="wci-card-icon">📋</span>
                <span class="wci-card-title">${this._label('生成进度', 'Build Progress')}</span>
                <span class="wci-badge wci-badge-neutral">${doneCount}/${total}</span>
                ${runningHtml}
            </div>
            <div class="wci-progress">
                <div class="wci-progress-head">
                    <span class="wci-progress-label">${isEnglish ? 'Overall' : '总体完成度'}</span>
                    <span class="wci-progress-pct">${pct}%</span>
                </div>
                <div class="wci-progress-track"><div class="wci-progress-fill${running ? ' is-running' : ''}" style="width: ${pct}%"></div></div>
            </div>
            <div class="wci-card-body wci-stages-body">
                ${rowsHtml}
            </div>
        </div>`;
  },

  /**
   * 渲染单个阶段的状态徽标（已完成 / 生成中脉冲 / 等待 / 未开始）
   */
  _renderStageBadge(status) {
    const map = {
      done: { cls: 'success', icon: '✓', zh: '已完成', en: 'Done' },
      generating: { cls: 'warning', pulse: true, zh: '生成中', en: 'Building' },
      waiting: { cls: 'azure', icon: '○', zh: '等待', en: 'Waiting' },
      pending: { cls: 'neutral', icon: '○', zh: '未开始', en: 'Idle' },
    };
    const m = map[status] || map.pending;
    const lead = m.pulse
      ? '<span class="wci-pulse"></span>'
      : `<span class="wci-badge-icon">${m.icon}</span>`;
    return `<span class="wci-badge wci-badge-${m.cls}">${lead}${this._label(m.zh, m.en)}</span>`;
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
      case 'timeline':
      case 'world_timeline': {
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
      case 'character_timelines':
      case 'relationships_overview': {
        // 新版：从 character_database.{id}.relationships 聚合计数
        // 老版（character_timelines）仅作老卡兼容
        let count = 0;
        if (data && typeof data === 'object') {
          for (const [k, v] of Object.entries(data)) {
            if (k.startsWith('_')) continue;
            // 老卡 character_timelines: { 角色ID: { cognitive/relationships/status } }
            // 新卡 character_database: { 角色ID: { ..., relationships: { 目标ID: 文本 } } }
            if (v && typeof v === 'object') {
              if (v.relationships && typeof v.relationships === 'object') count++;
              else if (v.cognitive || v.status) count++;
            }
          }
        }
        return count > 0
          ? this._isEnglish()
            ? `${count} characters`
            : `${count} 个角色`
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
   * 获取当前的 panel_fields（从 designConfig 或使用默认值）。
   * 顺手做一遍脏数据清洗：老版本可能把 panel_status / panel_npc 写成 `{ref: '…'}` 占位对象，
   * 当前代码里没有任何路径再消费这种 ref 形式，直接回退默认数组，让 UI/校验/序列化全部走正常路径。
   * 清洗后立刻持久化，下次刷新就不再重复清洗。
   */
  _getPanelFields(dc) {
    if (!dc.panel_fields) return this._getDefaultPanelFields();
    const raw = dc.panel_fields;
    const defaults = this._getDefaultPanelFields();
    let dirty = false;
    if (!Array.isArray(raw.panel_npc)) {
      raw.panel_npc = defaults?.panel_npc || [];
      dirty = true;
    }
    if (!Array.isArray(raw.panel_status)) {
      raw.panel_status = defaults?.panel_status || [];
      dirty = true;
    }
    if (dirty && window.designService && typeof window.designService._saveDesignConfig === 'function') {
      console.warn('[worldCardInfoUI] panel_fields 含脏数据，已重置为默认值并落盘');
      try { window.designService._saveDesignConfig({ skipRefresh: true }); } catch (_e) { /* ignore */ }
    }
    return raw;
  },

  /**
   * 渲染 Step 3 字段编辑卡片（状态栏 + 角色档案）
   * @param {Object} dc - designConfig
   * @param {string|null} hint - 提示文字（如"框架就绪后将自动推断"）
   * @param {boolean} locked - 是否锁定（生成中禁用交互）
   */
  _renderPanelFieldsCards(dc, hint, locked) {
    const fields = this._getPanelFields(dc);
    if (!fields) return '';
    const isEnglish = this._isEnglish();
    // locked（p2 生成中）→ 锁定横幅 + 蒙层；否则 hint 作来源提示行
    let bannerHtml = '';
    if (locked) {
      const lockText = hint || (isEnglish ? 'Building, fields locked' : '生成中，字段已锁定');
      bannerHtml = `<div class="wci-lock-banner"><span class="wci-lock-banner-icon">🔒</span><span>${lockText.replace(/^🔒\s*/, '')}</span></div>`;
    } else if (hint) {
      bannerHtml = `<div class="wci-pf-hint">${hint}</div>`;
    }
    const groupClass = locked ? 'wci-pf-group is-locked' : 'wci-pf-group';
    const overlayHtml = locked
      ? `<div class="wci-lock-overlay"><div class="wci-lock-chip"><span class="wci-lock-chip-icon">🔒</span><span>${isEnglish ? 'Locked while building' : '生成中，字段已锁定'}</span></div></div>`
      : '';
    // M4：locked 时给外壳挂原生 inert —— 子树整体不可聚焦/点击/编辑（比纯 CSS 蒙层更硬，
    // 防 devtools 改 pointer-events 误编辑只读旧卡；事件本就没绑，inert 再加一层保险）。
    const inertAttr = locked ? ' inert' : '';
    return (
      bannerHtml +
      `<div class="${groupClass}"${inertAttr}>` +
      overlayHtml +
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
          // 子字段 key 一律按位置重编（不沿用 DOM 传入的 sf.key）——否则删中间子字段再新增会
          // 撞出重复 data-sf-key（field_${count}），下游 panelSchemaBuilder 同名 properties 后者覆盖
          // 前者、required 重复，导致一个子字段在 schema 里静默消失。按 i 重编保证落库 key 唯一。
          fields: subfields.map((sf, i) => ({
            key: `field_${i}`,
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

    // 检测已使用的模板
    const usedTemplates = new Set();
    const enriched = visibleStatusFields.map(g => this._detectTemplate(g));

    // 全部字段（时间/金钱/自定义）都渲染成常驻输入行——无胶囊、无折叠，直接可见可编辑。
    // 当前目标（objective）无可配置项 → 编辑区不渲染（数据由 _ensureFixedLocationGroup 保留、预览/游戏顶栏仍展示）。
    let rowsHtml = '';
    for (let i = 0; i < enriched.length; i++) {
      const g = enriched[i];
      const t = g._template || 'custom';
      if (g._template && this._TEMPLATES[g._template]?.single) {
        usedTemplates.add(g._template);
      }
      if (t === 'objective') continue;
      rowsHtml += this._renderTemplateRow(g, i);
    }

    // 空状态提示
    const emptyHtml =
      count === 0
        ? `<div class="wci-pf-empty">${isEnglish ? 'No fields added yet<br>Choose what should be shown:' : '还没有添加任何字段<br>选择要显示的信息：'}</div>`
        : '';

    // 类别 chips
    const chipsHtml = this._renderCategoryChips(usedTemplates);

    // 预览区
    const previewContent = this._generateStatusPreviewHTML(allStatusFields);

    return `
            <div class="wci-card wci-pf-card" data-card-type="panel_status">
                <div class="wci-card-header">
                    <span class="wci-card-icon">📊</span>
                    <span class="wci-card-title">${isEnglish ? 'Status Bar Fields' : '状态栏字段'}</span>
                    ${count > 0 ? `<span class="wci-pf-badge">${isEnglish ? `${count}` : `${count} 个`}</span>` : ''}
                </div>
                <div class="wci-pf-preview">
                    <div class="wci-pf-preview-label">${isEnglish ? 'Preview (sample)' : '预览（示例效果）'}</div>
                    <div class="wci-pf-preview-caption">${isEnglish ? 'The numbers and text below are just examples to show the layout — not your actual settings.' : '下面的数字和内容都是举例，方便你看排版，不是你的实际设置。'}</div>
                    <div class="sticky-status-bar">
                        <div class="sticky-status-inner">
                            <span class="sticky-turn-badge">T1</span>
                            <div class="sticky-status-items wci-pf-preview-items">${previewContent}</div>
                        </div>
                    </div>
                </div>
                <div class="wci-card-body wci-pf-card-body">
                    <div class="wci-pf-rows">${rowsHtml}</div>
                    ${emptyHtml}
                    ${chipsHtml}
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
    return `<div class="wci-pf-row" data-template="time" data-index="${i}" data-key="${e(group.key || 'datetime')}">
            <span class="wci-pf-row-icon">📅</span>
            <span class="wci-pf-row-name">${isEnglish ? 'Time' : '时间'}</span>
            <span class="wci-pf-row-param"><span class="wci-pf-param-label">${isEnglish ? 'Era' : '纪年'}</span><input class="wci-pf-param-input wci-pf-era-input" data-param="era" value="${e(era)}" maxlength="16" placeholder="${isEnglish ? 'Common Era' : '公元'}"></span>
            <span class="wci-pf-row-param"><span class="wci-pf-param-fixed">${isEnglish ? 'Fixed format: YYYY.MM.DD HH:MM' : '固定格式：年月日 + HH:MM'}</span></span>
            <span class="wci-pf-row-hint">${isEnglish ? 'Just the era name here (e.g. Common Era). The date and time are not set here.' : '只填纪年名称（如：公元、木叶历），年月日不用在这里填。'}</span>
        </div>`;
  },

  _renderLocationRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    return `<div class="wci-pf-row" data-template="location" data-index="${i}" data-key="${e(group.key || 'location')}">
            <span class="wci-pf-row-icon">📍</span>
            <span class="wci-pf-row-name">${isEnglish ? 'Location' : '地点'}</span>
            <span class="wci-pf-row-param"><span class="wci-pf-param-fixed">${isEnglish ? 'Fixed 3-part format: region - place - spot' : '固定三段式：国家/区域 - 地点 - 具体位置'}</span></span>
        </div>`;
  },

  _renderMoneyRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    const currency = (group.fields && group.fields[0]?.label) || '';
    return `<div class="wci-pf-row" data-template="money" data-index="${i}" data-key="${e(group.key || 'money')}">
            <span class="wci-pf-row-icon">💰</span>
            <span class="wci-pf-row-name">${isEnglish ? 'Money' : '金钱'}</span>
            <span class="wci-pf-row-param"><span class="wci-pf-param-label">${isEnglish ? 'Currency' : '货币单位'}</span><input class="wci-pf-param-input" data-param="currency" value="${e(currency)}" placeholder="${isEnglish ? 'Credits, Dollars...' : '信用点、灵石…'}"></span>
        </div>`;
  },

  _renderObjectiveRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    return `<div class="wci-pf-row" data-template="objective" data-index="${i}" data-key="${e(group.key || 'objective')}">
            <span class="wci-pf-row-icon">🎯</span>
            <span class="wci-pf-row-name">${isEnglish ? 'Current Objective' : '当前目标'}</span>
        </div>`;
  },

  _renderCustomRow(group, i) {
    const isEnglish = this._isEnglish();
    const e = v => this._escape(v);
    const name = group.label || '';
    const icon = group.icon || '📋';

    let subHtml = '<div class="wci-pf-subfields">';
    for (let fi = 0; fi < (group.fields || []).length; fi++) {
      const f = group.fields[fi];
      subHtml += `<div class="wci-pf-subfield" data-sf-index="${fi}" data-sf-key="${e(f.key || `field_${fi}`)}">`;
      subHtml += `<input class="wci-pf-input wci-pf-sf-label" value="${e(f.label || '')}" placeholder="${isEnglish ? 'Example: HP, Max Value' : '如：HP、最大值'}" data-param="sf-label">`;
      subHtml += `<button class="btn-danger btn-icon btn-sm" data-action="del-subfield" title="${isEnglish ? 'Delete' : '删除'}">✕</button>`;
      subHtml += '</div>';
    }
    subHtml += `<button class="btn-ghost" data-action="add-subfield">${isEnglish ? '+ Add Subfield' : '+ 添加子字段'}</button>`;
    subHtml += '</div>';

    return `<div class="wci-pf-row" data-template="custom" data-index="${i}" data-key="${e(group.key || '')}">
            <button type="button" class="wci-pf-row-icon wci-pf-custom-icon" data-action="toggle-icon-pop" title="${isEnglish ? 'Change icon' : '更换图标'}">${e(icon)}</button>
            <input class="wci-pf-input wci-pf-custom-name" value="${e(name)}" placeholder="${isEnglish ? 'Label, for example: HP' : '名称，如：生命值'}" data-param="name">
            <input class="wci-pf-input wci-pf-custom-icon-input" value="${e(icon)}" placeholder="📋" data-param="icon" aria-hidden="true" tabindex="-1">
            <button class="btn-danger btn-icon btn-sm" data-action="del-row" title="${isEnglish ? 'Delete' : '删除'}">✕</button>
            ${subHtml}
        </div>`;
  },

  // emoji 图标选择器候选（游戏顶栏把 icon 当文本渲染，必须是 emoji 而非 Material Symbols 名）
  _EMOJI_CHOICES: [
    '🌍', '⏰', '📍', '💰', '🎯', '👤',
    '🏆', '❤️', '⚡', '🛡️', '📖', '🔬',
    '👥', '🔀', '📅', '🎒', '🧠', '🔥',
    '💧', '📶', '🧩', '🔑', '⭐', '😀',
  ],

  /**
   * 构建 emoji 选择弹层内部 HTML（current = 当前选中图标，高亮）
   */
  _buildIconPopHtml(current) {
    const e = v => this._escape(v);
    let cells = '';
    for (const emo of this._EMOJI_CHOICES) {
      const active = emo === current ? ' is-active' : '';
      cells += `<button type="button" class="wci-pf-icon-cell${active}" data-action="pick-icon" data-emoji="${e(emo)}">${e(emo)}</button>`;
    }
    return `<div class="wci-pf-icon-grid">${cells}</div>`;
  },

  /**
   * 移除所有打开的 emoji 弹层并清掉它们挂的 document 监听（防泄漏）
   */
  _removeIconPops(scope) {
    // 先注销跟踪的 document 监听——不能只遍历"还在 DOM 里"的弹层：整卡重建/refresh 会把
    // 弹层 DOM 直接丢弃却不经过这里，靠 querySelector 永远找不到那个 detached 弹层 → 监听器泄漏，
    // 且残留的旧 closer 会在下次开弹层时把新弹层提前销毁、令"换图标"静默失效。用单一字段跟踪根治。
    if (this._iconPopCloser) {
      document.removeEventListener('mousedown', this._iconPopCloser, true);
      this._iconPopCloser = null;
    }
    // M1：清理聊天区 fixed 弹层挂的一次性 scroll 监听（once 通常已自摘，这里兜底防早关泄漏）
    if (this._iconPopScrollCloser) {
      try { this._iconPopScrollCloser.cma.removeEventListener('scroll', this._iconPopScrollCloser.onScroll); } catch (_e) { void _e; }
      this._iconPopScrollCloser = null;
    }
    // M1：弹层可能挂在 row 内（侧栏）或 document.body（聊天区 fixed）——统一用 document 清，别用 scope（会漏 body 上的）
    void scope;
    document.querySelectorAll('.wci-pf-icon-pop').forEach(pop => pop.remove());
  },

  /**
   * 打开某个自定义行的 emoji 选择弹层（懒创建，挂一次性外点关闭；同一时刻只一个）
   */
  _openIconPop(row) {
    if (!row) return;
    this._removeIconPops(document);
    const input = row.querySelector('[data-param="icon"]');
    const current = (input?.value || '').trim() || '📋';
    const pop = document.createElement('div');
    pop.className = 'wci-pf-icon-pop';
    pop.innerHTML = this._buildIconPopHtml(current);
    const trigger = row.querySelector('.wci-pf-custom-icon');
    const closer = ev => {
      if (pop.contains(ev.target)) return;
      if (trigger && (ev.target === trigger || trigger.contains(ev.target))) return;
      this._removeIconPops(document);
    };
    this._iconPopCloser = closer;
    const cma = row.closest('.chat-messages-area');
    if (cma) {
      // M1：聊天区内，弹层祖先容器有 overflow:hidden，absolute 会被裁切。
      // 改挂 document.body + position:fixed，按 trigger 视口坐标定位，彻底脱离裁切。
      // 只读 rect、写 body 子元素 fixed 坐标，不碰 .chat-messages-area 滚动，不违反滚动锁。
      pop.style.position = 'fixed';
      pop.style.zIndex = '2147483000';
      pop.style.visibility = 'hidden';
      document.body.appendChild(pop);
    } else {
      row.appendChild(pop);
    }
    setTimeout(() => {
      // M2：仅当本 closer 仍是当前 closer 才挂——快速连点不同行时，后一次 _openIconPop 已
      // _removeIconPops 改写 _iconPopCloser，旧 setTimeout 不应再挂（否则泄漏死监听器）。
      if (this._iconPopCloser !== closer) return;
      document.addEventListener('mousedown', closer, true);
      if (!cma) {
        // 侧栏：原行为——把弹层带进视野（.worldcard-info-list 自身滚动，不受 chat 锁）
        pop.scrollIntoView({ block: 'nearest' });
        return;
      }
      // 聊天区：据 trigger 视口位置放置 fixed 弹层；下方空间不足则上翻
      const r = (trigger || row).getBoundingClientRect();
      const popH = pop.offsetHeight || 180;
      const popW = pop.offsetWidth || 220;
      let top = r.bottom + 4;
      if (window.innerHeight - r.bottom < popH + 8 && r.top > popH + 8) top = r.top - popH - 4;
      let left = r.left;
      if (left + popW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popW - 8);
      pop.style.top = Math.round(top) + 'px';
      pop.style.left = Math.round(left) + 'px';
      pop.style.visibility = '';
      // fixed 弹层不跟随滚动 → 聊天区一滚就关，避免悬浮错位（once + _removeIconPops 兜底清）
      const onScroll = () => this._removeIconPops(document);
      cma.addEventListener('scroll', onScroll, { passive: true, once: true });
      this._iconPopScrollCloser = { cma, onScroll };
    }, 0);
  },

  /**
   * 选 emoji：写回隐藏的 [data-param=icon] 并派发冒泡 input 事件——
   * 复用 card 既有 input 委托（同步 .wci-pf-custom-icon 行首 + 胶囊 + collect 落盘），零额外接线。
   */
  _applyIconPick(row, emoji) {
    if (!row) return;
    const input = row.querySelector('[data-param="icon"]');
    if (input) {
      input.value = emoji;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this._removeIconPops(document);
  },

  /**
   * 处理状态卡的图标选择器 click 动作（打开/关闭弹层、选 emoji）。
   * 在 _bindPanelFieldsEvents 与 _bindSingleCard 两处 click 委托里都先调它（命中即 return）。
   * @returns {boolean} 是否已处理
   */
  _handleStatusExtraClick(action, btn, card) {
    if (action === 'toggle-icon-pop') {
      const row = btn.closest('.wci-pf-row');
      const existing = row?.querySelector('.wci-pf-icon-pop');
      if (existing) {
        this._removeIconPops(card);
      } else {
        this._openIconPop(row);
      }
      return true;
    }
    if (action === 'pick-icon') {
      const row = btn.closest('.wci-pf-row');
      this._applyIconPick(row, btn.dataset.emoji);
      return true;
    }
    return false;
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
    const defaults = this._getDefaultPanelFields()?.panel_status || [];
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
    let html = '<div class="wci-pf-chips">';
    for (const [tid, tmpl] of Object.entries(this._TEMPLATES)) {
      // 只保留"自定义"添加入口：时间/金钱常驻为输入行、当前目标/地点固定常显，
      // 它们的"添加"按钮永远置灰、纯属冗余，不再渲染。
      if (tid !== 'custom') continue;
      const disabled = tmpl.single && usedTemplates.has(tid);
      html += `<button class="btn-secondary btn-pill${disabled ? ' is-disabled' : ''}" data-action="add-template" data-tid="${tid}"${disabled ? ' disabled' : ''}>`;
      html += `+ ${isEnglish ? 'Custom Field' : '自定义字段'}`;
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
    // 防御：designConfig.panel_fields.panel_npc 在某些坏状态下可能不是数组
    // （e.g. P2 stage 2 写出非预期结构）。直接信任会 throw 切断整个 design mode 初始化。
    if (!Array.isArray(npcFields)) {
      console.warn('[worldCardInfoUI] npcFields 不是数组，降级为空数组渲染:', npcFields);
      npcFields = [];
    }
    const editableCount = npcFields.filter(f => !f.fixed).length;
    let bodyHtml = '';

    for (let fi = 0; fi < npcFields.length; fi++) {
      const f = npcFields[fi];
      const isFixed = f.fixed;
      bodyHtml += `<div class="wci-pf-field${isFixed ? ' wci-pf-field-fixed' : ''}" data-field-index="${fi}" data-stable-key="${this._escape(f.key || '')}">`;
      // 第一行：字段名 + 右侧标识（🔒固定 / ✨自定义）（+ 可编辑字段的删除按钮）
      bodyHtml += `<div class="wci-pf-field-top">`;
      bodyHtml += `<input class="wci-pf-input wci-pf-field-label" value="${this._escape(f.label || '')}" placeholder="${isEnglish ? 'Field Label' : '字段名称'}" data-field="label"${isFixed ? ' disabled' : ''}>`;
      if (isFixed) {
        bodyHtml += `<span class="wci-badge wci-badge-neutral wci-pf-field-marker">🔒 ${isEnglish ? 'Fixed' : '固定'}</span>`;
      } else {
        bodyHtml += `<span class="wci-badge wci-badge-azure wci-pf-field-marker">✨ ${isEnglish ? 'Custom' : '自定义'}</span>`;
        // type（string/integer）由 AI 在 P1/P3 全权决定，UI 不暴露切换入口
        bodyHtml += `<button class="btn-danger btn-icon btn-sm" data-action="del-npc-field" title="${isEnglish ? 'Delete Field' : '删除字段'}">\u2715</button>`;
      }
      bodyHtml += `</div>`;
      // 第二行：字段介绍（可编辑=输入框 / 固定=只读说明）
      if (!isFixed) {
        bodyHtml += `<input class="wci-pf-input wci-pf-field-desc" value="${this._escape(f.desc || '')}" placeholder="${isEnglish ? 'Description or example' : '说明或填写示例'}" data-field="desc">`;
      } else if (f.desc) {
        bodyHtml += `<span class="wci-pf-field-hint">${this._escape(f.desc)}</span>`;
      }
      bodyHtml += `</div>`;
    }

    bodyHtml += `<button class="btn-ghost" data-action="add-npc-field">${isEnglish ? '+ Add Field' : '+ 添加字段'}</button>`;

    return `
            <div class="wci-card wci-pf-card" data-card-type="panel_npc">
                <div class="wci-card-header">
                    <span class="wci-card-icon">👤</span>
                    <span class="wci-card-title">${isEnglish ? 'Character Panel Fields' : '角色档案字段'}</span>
                    <span class="wci-pf-badge">${isEnglish ? `${npcFields.length} (${editableCount} editable)` : `${npcFields.length} 个 (${editableCount} 可编辑)`}</span>
                </div>
                <div class="wci-card-body wci-pf-card-body">
                    ${bodyHtml}
                </div>
            </div>`;
  },

  /**
   * 绑定 Step 3 字段编辑事件（模板驱动版）
   */
  _bindPanelFieldsEvents(ds, container) {
    container = container || document.getElementById('worldcard-info-container');
    if (!container) return;
    const self = this;

    container.querySelectorAll('.wci-pf-card').forEach(card => {
      const isStatusCard = card.dataset.cardType === 'panel_status';

      // ---- 输入/选择变更 → 自动保存 ----
      card.addEventListener('input', e => {
        // 自定义行的 icon 实时同步到行首显示
        if (isStatusCard) {
          const row = e.target.closest('.wci-pf-row');
          if (row && e.target.dataset.param === 'icon') {
            const iconEl = row.querySelector('.wci-pf-custom-icon');
            if (iconEl) iconEl.textContent = e.target.value.trim() || '📋';
          }
        }
        self._collectAndSavePanelFields(ds, container);
      });

      card.addEventListener('change', e => {
        if (!isStatusCard) {
          self._collectAndSavePanelFields(ds, container);
          return;
        }
        const row = e.target.closest('.wci-pf-row');
        if (!row) {
          self._collectAndSavePanelFields(ds, container);
          return;
        }
        self._collectAndSavePanelFields(ds, container);
      });

      // ---- 按键/动作点击 ----
      card.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;

        // -- 变体 B 胶囊展开 / emoji 图标弹层（命中即处理完）--
        if (isStatusCard && self._handleStatusExtraClick(action, btn, card)) return;

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
          self._addStatusGroup(ds, group, container);
          return;
        }

        // -- 删除模板行（仅自定义组可删，核心4组不可删）--
        if (action === 'del-row' && isStatusCard) {
          const row = btn.closest('.wci-pf-row');
          if (row) {
            const tpl = row.dataset.template;
            if (['time', 'location', 'money', 'objective'].includes(tpl)) return;
            self._domMutateScoped(container, () => {
              row.remove();
              self._collectAndSavePanelFields(ds, container);
              // 删自定义字段后整卡重建，保行/chip 一致
              self._refreshStatusCard(ds, container);
            });
          }
          return;
        }

        // -- 删除子字段 --
        if (action === 'del-subfield' && isStatusCard) {
          const sf = btn.closest('.wci-pf-subfield');
          if (sf) {
            self._domMutateScoped(container, () => {
              sf.remove();
              self._collectAndSavePanelFields(ds, container);
            });
          }
          return;
        }

        // -- 添加子字段 --
        if (action === 'add-subfield' && isStatusCard) {
          const subfields = btn.closest('.wci-pf-subfields');
          if (subfields) {
            const idx = subfields.querySelectorAll('.wci-pf-subfield').length;
            const newSf = document.createElement('div');
            newSf.className = 'wci-pf-subfield';
            newSf.dataset.sfIndex = String(idx);
            newSf.dataset.sfKey = `field_${idx}`;
            newSf.innerHTML =
              '<input class="wci-pf-input wci-pf-sf-label" value="" placeholder="如：HP、最大值" data-param="sf-label"><button class="btn-danger btn-icon btn-sm" data-action="del-subfield" title="删除">✕</button>';
            self._domMutateScoped(container, () => {
              subfields.insertBefore(newSf, btn);
              self._collectAndSavePanelFields(ds, container);
            });
            newSf.querySelector('input')?.focus({ preventScroll: true });
          }
          return;
        }

        // -- NPC 字段删除 --
        if (action === 'del-npc-field') {
          const fieldEl = btn.closest('.wci-pf-field');
          if (fieldEl) {
            self._domMutateScoped(container, () => {
              fieldEl.remove();
              self._collectAndSavePanelFields(ds, container);
            });
          }
          return;
        }

        // -- NPC 添加字段 --
        if (action === 'add-npc-field') {
          const cardBody = card.querySelector('.wci-pf-card-body');
          if (cardBody) {
            const newField = document.createElement('div');
            newField.className = 'wci-pf-field';
            newField.innerHTML = `
                            <div class="wci-pf-field-top">
                                <input class="wci-pf-input wci-pf-field-label" value="" placeholder="字段名称" data-field="label">
                                <span class="wci-badge wci-badge-azure wci-pf-field-marker">✨ 自定义</span>
                                <button class="btn-danger btn-icon btn-sm" data-action="del-npc-field" title="删除字段">✕</button>
                            </div>
                            <input class="wci-pf-input wci-pf-field-desc" value="" placeholder="说明或填写示例" data-field="desc">`;
            self._domMutateScoped(container, () => {
              cardBody.insertBefore(newField, btn);
              self._collectAndSavePanelFields(ds, container);
            });
            // L1：与 add-subfield 一致，新增字段标签输入框自动获焦（带 preventScroll）
            newField.querySelector('.wci-pf-field-label')?.focus({ preventScroll: true });
          }
          return;
        }
      });
    });
  },

  /**
   * 添加一个 status group 并重绘状态卡
   */
  _addStatusGroup(ds, group, container) {
    container = container || document.getElementById('worldcard-info-container');
    if (!ds.designConfig) ds.designConfig = {};
    if (!ds.designConfig.panel_fields) {
      const defaults = this._getDefaultPanelFields();
      ds.designConfig.panel_fields = {
        panel_status: this._ensureFixedLocationGroup([], []),
        panel_npc: defaults?.panel_npc || [],
      };
    }
    ds.designConfig.panel_fields.panel_status.push(group);
    ds.designConfig.panel_fields.panel_status = this._ensureFixedLocationGroup(
      ds.designConfig.panel_fields.panel_status,
      ds.designConfig.panel_fields.panel_status
    );
    // H2：新增自定义组立刻反向同步到 world_terms.extra_status_groups（内部会 _saveDesignConfig({skipRefresh})），
    // 否则用户加完组直接提交时，submit handler 的 _applyWorldTermsToPanelFields 从不含该组的 world_terms
    // 重建 panel_status、把它覆盖丢失。
    this._syncPanelFieldsToP1OutputAndChatPreview(ds, ds.designConfig.panel_fields);
    this._domMutateScoped(container, () => this._refreshStatusCard(ds, container));
    this._scheduleCrossRefresh(ds, container);
  },

  /**
   * 刷新状态栏字段卡片（不触发完整 refresh，仅重建 panel_status 卡）
   */
  _refreshStatusCard(ds, container) {
    container = container || document.getElementById('worldcard-info-container');
    if (!container) return;
    // 替换旧卡前清掉它里面可能开着的 emoji 弹层 + document 监听（随 replaceWith 丢弃后会泄漏）
    this._removeIconPops(document);
    const oldCard = container.querySelector('[data-card-type="panel_status"]');
    if (!oldCard) return;
    const dc = ds.designConfig || {};
    const fields = this._getPanelFields(dc);
    const newHtml = this._renderStatusFieldsCard(fields.panel_status || []);
    const tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    const newCard = tmp.firstElementChild;
    oldCard.replaceWith(newCard);
    // 重新绑定事件（只为新卡片）
    this._bindSingleCard(newCard, ds, container);
  },

  /**
   * 为单张卡片绑定事件（_refreshStatusCard 用）
   */
  _bindSingleCard(card, ds, container) {
    const self = this;
    container = container || document.getElementById('worldcard-info-container');
    const isStatusCard = card.dataset.cardType === 'panel_status';

    card.addEventListener('input', e => {
      if (isStatusCard) {
        const row = e.target.closest('.wci-pf-row');
        if (row && e.target.dataset.param === 'icon') {
          const iconEl = row.querySelector('.wci-pf-custom-icon');
          if (iconEl) iconEl.textContent = e.target.value.trim() || '📋';
        }
      }
      self._collectAndSavePanelFields(ds, container);
    });

    card.addEventListener('change', e => {
      if (!isStatusCard) {
        self._collectAndSavePanelFields(ds, container);
        return;
      }
      const row = e.target.closest('.wci-pf-row');
      if (!row) {
        self._collectAndSavePanelFields(ds, container);
        return;
      }
      self._collectAndSavePanelFields(ds, container);
    });

    card.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (isStatusCard && self._handleStatusExtraClick(action, btn, card)) return;
      if (action === 'add-template' && isStatusCard) {
        const tid = btn.dataset.tid;
        if (!tid || btn.disabled) return;
        const params = {};
        if (tid === 'custom') params.subfields = [{ key: 'field_0', label: '' }];
        const group = self._buildGroupFromTemplate(tid, params);
        if (!group) return;
        self._addStatusGroup(ds, group, container);
      } else if (action === 'del-row' && isStatusCard) {
        const row = btn.closest('.wci-pf-row');
        if (row) {
          self._domMutateScoped(container, () => {
            row.remove();
            self._collectAndSavePanelFields(ds, container);
            // 删自定义字段后整卡重建，保行/chip 一致
            self._refreshStatusCard(ds, container);
          });
        }
      } else if (action === 'del-subfield' && isStatusCard) {
        const sf = btn.closest('.wci-pf-subfield');
        if (sf) {
          self._domMutateScoped(container, () => {
            sf.remove();
            self._collectAndSavePanelFields(ds, container);
          });
        }
      } else if (action === 'add-subfield' && isStatusCard) {
        const subfields = btn.closest('.wci-pf-subfields');
        if (subfields) {
          const idx = subfields.querySelectorAll('.wci-pf-subfield').length;
          const newSf = document.createElement('div');
          newSf.className = 'wci-pf-subfield';
          newSf.dataset.sfIndex = String(idx);
          newSf.dataset.sfKey = `field_${idx}`;
          newSf.innerHTML =
            '<input class="wci-pf-input wci-pf-sf-label" value="" placeholder="如：HP、最大值" data-param="sf-label"><button class="btn-danger btn-icon btn-sm" data-action="del-subfield" title="删除">✕</button>';
          self._domMutateScoped(container, () => {
            subfields.insertBefore(newSf, btn);
            self._collectAndSavePanelFields(ds, container);
          });
          newSf.querySelector('input')?.focus({ preventScroll: true });
        }
      }
    });
  },

  /**
   * 更新 chip 禁用状态（删除行后调用）
   */
  _refreshChipStates(card) {
    const used = new Set();
    card.querySelectorAll('.wci-pf-row[data-template]').forEach(row => {
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
  _collectAndSavePanelFields(ds, container) {
    container = container || document.getElementById('worldcard-info-container');
    if (!container) return;
    // H1：容器里还没渲染出任一字段卡时直接返回，避免把空结果反向同步、清空 world_terms.extra_*。
    if (!container.querySelector('[data-card-type="panel_status"]') &&
        !container.querySelector('[data-card-type="panel_npc"]')) return;

    const result = { panel_status: [], panel_npc: [] };
    const existingPanelFields = this._getPanelFields(ds.designConfig || {}) || {};
    const existingStatusFields = existingPanelFields.panel_status || [];

    // 收集 panel_status：遍历模板行
    const statusCard = container.querySelector('[data-card-type="panel_status"]');
    if (statusCard) {
      statusCard.querySelectorAll('.wci-pf-row[data-template]').forEach(row => {
        const tid = row.dataset.template;
        const key = row.dataset.key || '';
        const params = {};

        switch (tid) {
          case 'time': {
            params.precision = 'time';
            // 纪年归一：去数字/日期分隔符 + 限长，防作者把整段日期塞进纪年污染运行时时间解析
            const rawEra = row.querySelector('[data-param="era"]')?.value || '';
            params.era = window.panelSchemaBuilder?.normalizeEraName
              ? window.panelSchemaBuilder.normalizeEraName(rawEra)
              : rawEra.trim();
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
            row.querySelectorAll('.wci-pf-subfield').forEach(sf => {
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
      const existingNpcFields = Array.isArray(existingPanelFields?.panel_npc)
        ? existingPanelFields.panel_npc
        : [];
      const existingNpcFieldMap = new Map(
        existingNpcFields
          .filter(field => field && typeof field.key === 'string' && field.key.trim())
          .map(field => [field.key.trim(), field])
      );
      npcCard.querySelectorAll('.wci-pf-field').forEach(fieldEl => {
        const stableKey = fieldEl.dataset.stableKey;
        const label = fieldEl.querySelector('[data-field="label"]')?.value?.trim();
        const desc = fieldEl.querySelector('[data-field="desc"]')?.value?.trim();
        const isFixed = fieldEl.classList.contains('wci-pf-field-fixed');
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
    // result 只含 {panel_status, panel_npc}；整体替换会抹掉 panel_fields 上的下划线口袋元数据
    // （_worldTermsSource 给重导入/纪年回退/校验用，_source 给 P1 提示文案用）。这里把已有的
    // _ 前缀键回挂，避免玩家在 P1 编辑任意字段后这些元数据被静默清掉。
    const prevPanelFields = existingPanelFields || {};
    Object.keys(prevPanelFields).forEach(k => {
      if (k.startsWith('_') && result[k] === undefined) result[k] = prevPanelFields[k];
    });
    ds.designConfig.panel_fields = result;

    // 增量刷新预览区
    this._updateStatusPreview(ds, container);

    // 反向同步到 p1Output.world_terms + 聊天预览
    this._syncPanelFieldsToP1OutputAndChatPreview(ds, result);

    // 实时双向：把变更同步到其它容器（step3 ↔ 侧栏预览）
    this._scheduleCrossRefresh(ds, container);
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
    // 返回 { icon, segments }。segment.sample=true 的部分是写死的举例值（渲染成灰色弱化），
    // sample=false 的是作者真填进去的内容（纪年名 / 货币单位 / 自定义字段名，正常色）。
    switch (t) {
      case 'time': {
        const era = group._era || '';
        const p = group._precision || 'time';
        const obj = {};
        obj.year = 3;
        if (['month', 'day', 'time'].includes(p)) obj.month = 5;
        if (['day', 'time'].includes(p)) obj.day = 12;
        if (p === 'time') obj.time_str = '14:30';
        // 示例日期串（年月日时间全是举例，灰色占位）
        let sample = isEnglish ? `${obj.year}` : `${obj.year}年`;
        if (obj.month !== null && obj.month !== undefined)
          sample += isEnglish ? `.${obj.month}` : ` ${obj.month}月`;
        if (obj.day !== null && obj.day !== undefined)
          sample += isEnglish ? `.${obj.day}` : `${obj.day}日`;
        if (obj.time_str) sample += ` ${obj.time_str}`;
        const segments = [];
        if (era) segments.push({ text: isEnglish ? era + ' ' : era, sample: false });
        segments.push({ text: sample, sample: true });
        return { icon: '📅', segments };
      }
      case 'location': {
        const fmt = group._format || '3-segment';
        let parts, isSample;
        if (fmt === '2-segment') {
          parts = isEnglish ? ['Capital', 'Inn'] : ['王都', '酒馆'];
          isSample = true;
        } else if (fmt === '3-segment') {
          parts = isEnglish ? ['Heartland', 'Chang-an', 'City Gate'] : ['中原', '长安', '城门'];
          isSample = true;
        } else {
          // custom 段数（非 2/3 段）：用字段 label 做占位。这些是结构字段名而非作者填的真实地名，
          // 与其它示例一致灰化（且此分支基本不可达——地点恒被 _ensureFixedLocationGroup 重建为三段）。
          parts = (group.fields || []).map(f => f.label || '…');
          isSample = true;
        }
        return { icon: '📍', segments: [{ text: parts.join(' · '), sample: isSample }] };
      }
      case 'money': {
        const currency = (group.fields && group.fields[0]?.label) || '';
        const segments = [{ text: '1500', sample: true }];
        if (currency) segments.push({ text: ` ${currency}`, sample: false });
        return { icon: '💰', segments };
      }
      case 'objective':
        return {
          icon: '🎯',
          segments: [
            { text: isEnglish ? 'Find the missing princess' : '寻找失踪的公主', sample: true },
          ],
        };
      default: {
        // custom：显示的是作者自定义的字段名（正常色，非举例）
        const icon = group.icon || '📋';
        const parts = (group.fields || []).map(f => f.label || '…');
        const text =
          parts.length > 0 ? parts.join(' ') : group.label || (isEnglish ? 'Custom' : '自定义');
        return { icon, segments: [{ text, sample: false }] };
      }
    }
  },

  /**
   * 根据字段定义生成预览区 HTML
   */
  _generateStatusPreviewHTML(statusFields) {
    if (!statusFields || statusFields.length === 0) {
      return `<div class="wci-pf-preview-empty">${this._isEnglish() ? 'Add fields to preview the result' : '添加字段后可预览效果'}</div>`;
    }
    const e = v => this._escape(v);
    let items = '';
    for (const group of statusFields) {
      const enriched = this._detectTemplate(group);
      const mock = this._getMockDataForGroup(enriched);
      const valueHtml = (mock.segments || [])
        .map(seg =>
          seg.sample ? `<span class="wci-pf-mock-sample">${e(seg.text)}</span>` : e(seg.text)
        )
        .join('');
      items += `<div class="status-item"><span class="status-icon">${e(mock.icon)}</span><span class="status-value">${valueHtml}</span></div>`;
    }
    return items;
  },

  /**
   * 增量更新预览区 DOM（不重建整卡）
   */
  _updateStatusPreview(ds, container) {
    container = container || document.getElementById('worldcard-info-container');
    if (!container) return;
    const bar = container.querySelector('.wci-pf-preview-items');
    if (!bar) return;
    const dc = ds.designConfig || {};
    const fields = this._getPanelFields(dc);
    bar.innerHTML = this._generateStatusPreviewHTML(fields.panel_status || []);
  },

  /**
   * 将 panel_fields 变更反向同步到 p1Output.world_terms 和聊天预览
   */
  _syncPanelFieldsToP1OutputAndChatPreview(ds, panelFields) {
    if (!ds?.p1Output) return;
    if (!ds.p1Output.world_terms) ds.p1Output.world_terms = {};
    const wt = ds.p1Output.world_terms;
    const CORE_STATUS_KEYS = new Set(['datetime', 'location', 'money', 'objective']);

    // 从 panel_status 提取 currency_name, calendar_era, extra_status_groups
    if (Array.isArray(panelFields.panel_status)) {
      for (const group of panelFields.panel_status) {
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
      wt.extra_status_groups = panelFields.panel_status
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
    if (Array.isArray(panelFields.panel_npc)) {
      const reservedKeys = ds._getNpcReservedKeySet ? ds._getNpcReservedKeySet() : new Set();
      wt.extra_char_fields = panelFields.panel_npc
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
  // 不再用侧栏 tile 是否可见做闸门：聊天区的设计字段面板（含预览标题/纪年说明等内联中英文案）
  // 是独立挂载，tile 在 stage-router 下常 display:none，旧闸门会让聊天区面板停在旧语言（手机窄屏必现）。
  // refresh() 内部刷新侧栏（不存在则跳过）+ 所有已注册挂载（跳过断开的），幂等便宜，直接无条件调。
  if (window.worldCardInfoUI && typeof window.worldCardInfoUI.refresh === 'function') {
    window.worldCardInfoUI.refresh();
  }
});
