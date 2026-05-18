/**
 * design/ui.js
 * 预览面板 — 世界卡右侧 Card View / Code View 渲染
 *
 * 通过 mixin 模式扩展 DesignService.prototype。所有方法实现与原 class
 * DesignService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyDesignServiceMixin 合并到 DesignService 上。
 *
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceUIMixin {
  // ========================================
  // 预览面板
  // ========================================

  _initPreviewPanel() {
    const applyBtn = document.getElementById('design-apply-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => this.applyToGame());
    }

    this._initViewToggle();
    this._updatePreviewPanel();
  }

  _getViewMode() {
    const activeTab = document.querySelector('#design-chat-header .design-chat-tabs-track .tab.is-active');
    return activeTab ? activeTab.dataset.view || 'chat' : 'chat';
  }

  _initViewToggle() {
    const header = document.getElementById('design-chat-header');
    if (!header) return;

    // 只取老的 chat/card/code tabs；preview substage tabs（data-substage-target）由 stageRouter 接管
    const tabs = header.querySelectorAll('.design-chat-tabs-track .tab');
    const slider = header.querySelector('.design-chat-tabs-slider');

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        // Update active tab
        tabs.forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');

        // Move slider
        if (slider) {
          slider.style.transform = `translateX(${index * 100}%)`;
        }

        // Switch visible panel
        this._switchDesignView(tab.dataset.view);
      });
    });
  }

  /**
   * Switch visible panel: chat / card / code
   */
  _switchDesignView(view) {
    const chatArea = document.querySelector('.chat-messages-area');
    const cardPanel = document.getElementById('design-card-panel');
    const codePanel = document.getElementById('design-code-panel');
    if (chatArea) chatArea.style.display = view === 'chat' ? '' : 'none';
    if (cardPanel) cardPanel.style.display = view === 'card' ? '' : 'none';
    if (codePanel) codePanel.style.display = view === 'code' ? '' : 'none';

    // Re-render the active preview
    if (view === 'card' || view === 'code') {
      this._renderPreviewContent();
    }
  }

  _updatePreviewPanel() {
    const cardPanel = document.getElementById('design-card-panel');
    const codePanel = document.getElementById('design-code-panel');
    if (!cardPanel && !codePanel) return;

    const displayConfig = {};
    for (const [key, value] of Object.entries(this.designConfig)) {
      if (value !== null && value !== undefined && value !== '' && !key.startsWith('_')) {
        displayConfig[key] = value;
      }
    }

    this._cachedDisplayConfig = displayConfig;

    if (Object.keys(displayConfig).length === 0) {
      this._cachedStage2Validation = null;
      this._cachedCharacterDatabaseValidation = null;
      this._cachedCognitiveSemanticsValidation = null;
      if (this.stageValidationReports?.prompt_modules)
        delete this.stageValidationReports.prompt_modules;
      if (this.stageValidationReports?.character_database)
        delete this.stageValidationReports.character_database;
      if (this.stageValidationReports?.cognitive_semantics)
        delete this.stageValidationReports.cognitive_semantics;
      if (this.stageValidationReports?.time_consistency)
        delete this.stageValidationReports.time_consistency;
      const emptyHtml = `
                <div class="design-left-preview-empty">
                    <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;">code_blocks</span>
                    <p>开始对话后<br>这里将预览生成的配置</p>
                </div>`;
      if (cardPanel) cardPanel.innerHTML = emptyHtml;
      if (codePanel) codePanel.innerHTML = emptyHtml;
      this._updatePhaseIndicator();
      return;
    }

    const stage2Validation = displayConfig.prompt_modules
      ? this._validateStage2PromptModules(displayConfig.prompt_modules, { context: 'preview' })
      : null;
    if (stage2Validation) {
      this.stageValidationReports.prompt_modules = stage2Validation;
    } else if (this.stageValidationReports?.prompt_modules) {
      delete this.stageValidationReports.prompt_modules;
    }
    this._cachedStage2Validation = stage2Validation;

    const characterDatabaseValidation =
      displayConfig.step3_fields && displayConfig.character_database
        ? this._validateCharacterDatabasePanelConsistency(
            displayConfig.step3_fields,
            displayConfig.character_database
          )
        : null;
    if (characterDatabaseValidation) {
      this.stageValidationReports.character_database = characterDatabaseValidation;
    } else if (this.stageValidationReports?.character_database) {
      delete this.stageValidationReports.character_database;
    }
    this._cachedCharacterDatabaseValidation = characterDatabaseValidation;

    const cognitiveSemanticsValidation =
      displayConfig.character_database || displayConfig.character_timelines
        ? this._validateCognitiveStateSemantics(displayConfig)
        : null;
    if (cognitiveSemanticsValidation) {
      this.stageValidationReports.cognitive_semantics = cognitiveSemanticsValidation;
    } else if (this.stageValidationReports?.cognitive_semantics) {
      delete this.stageValidationReports.cognitive_semantics;
    }
    this._cachedCognitiveSemanticsValidation = cognitiveSemanticsValidation;

    const timeConsistencyValidation =
      displayConfig.timeline || displayConfig.character_timelines
        ? this._validateTimeConsistencyForSnapshot(displayConfig)
        : null;
    if (timeConsistencyValidation) {
      this.stageValidationReports.time_consistency = timeConsistencyValidation;
    } else if (this.stageValidationReports?.time_consistency) {
      delete this.stageValidationReports.time_consistency;
    }

    this._renderPreviewContent();
    this._updatePhaseIndicator();
  }

  _renderPreviewContent() {
    const cardPanel = document.getElementById('design-card-panel');
    const codePanel = document.getElementById('design-code-panel');

    const displayConfig = this._cachedDisplayConfig || {};
    if (Object.keys(displayConfig).length === 0) return;

    const stage2Validation = this._cachedStage2Validation || null;
    const cognitiveSemanticsValidation = this._cachedCognitiveSemanticsValidation || null;

    // ── Card view → #design-card-panel ──
    if (cardPanel) {
      cardPanel.innerHTML = '';
    {
      const isPhase3 = this.phase === 'p3';
      const card = document.createElement('div');
      card.className = 'design-card-view';

      // ── 顶部固定控制栏（全部展开/收起） ──
      const toolbar = document.createElement('div');
      toolbar.className = 'dcv-toolbar';
      const expandAllBtn = document.createElement('button');
      expandAllBtn.className = 'btn-ghost';
    expandAllBtn.dataset.action = 'dcv-toolbar-btn';
      expandAllBtn.innerHTML = `<span class="material-symbols-outlined">unfold_more</span>全部展开`;
      const collapseAllBtn = document.createElement('button');
      collapseAllBtn.className = 'btn-ghost';
    collapseAllBtn.dataset.action = 'dcv-toolbar-btn';
      collapseAllBtn.innerHTML = `<span class="material-symbols-outlined">unfold_less</span>全部收起`;
      toolbar.appendChild(expandAllBtn);
      toolbar.appendChild(collapseAllBtn);
      card.appendChild(toolbar);

      // Phase 3 提示栏
      if (isPhase3) {
        const hint = document.createElement('div');
        hint.className = 'dcv-drag-hint';
        const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        if (isTouchDevice) {
          hint.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">touch_app</span> 提示：点击「完善」可借助 AI 修改局部内容；点击「编辑」可直接编辑文本。`; /* ui-lint-allow */
        } else {
          hint.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">drag_indicator</span> 提示：将卡片拖入输入框或点击「完善」，可借助 AI 修改局部内容；点击「编辑」可直接编辑文本。`; /* ui-lint-allow */
        }
        card.appendChild(hint);
      }

      const cognitiveWarningPanel = this._buildCognitiveSemanticWarningPanel(
        cognitiveSemanticsValidation
      );
      if (cognitiveWarningPanel) {
        card.appendChild(cognitiveWarningPanel);
      }

      // 收集所有 section 元素，供全局控制
      const allSections = [];

      // ── 世界设定 ──
      if (displayConfig.world_setting) {
        const ws = displayConfig.world_setting;
        const entities = ws.settings
          ? Object.entries(ws.settings).filter(([k]) => !k.startsWith('_'))
          : [];
        const sectionEl = this._buildCardSection({
          icon: 'public',
          label: '世界设定',
          summary: ws._summary || '',
          hasBadge: true,
          isOk: true,
          subItems: entities.map(([id, text]) => {
            // 尝试从文本中解析中文名/英文名
            let displayName = '';
            let subtitle = '';
            if (typeof text === 'string') {
              const nameMatch = text.match(/[-—]{2,}\s*(.+?)\s*[（(]([^/）)]+)/);
              if (nameMatch) {
                displayName = nameMatch[1].trim();
                subtitle = nameMatch[2].trim();
              }
            }
            return {
              name: id,
              displayName: displayName || id.replace(/_/g, ' '),
              subtitle: subtitle || id,
              preview: typeof text === 'string' ? text.replace(/\n/g, ' ').slice(0, 72) : '（空）',
              dragText: `[世界设定 > ${id}] 请修改/补充这个世界实体，具体要求：\n`,
              editTarget: 'world_setting',
              editPath: `settings.${id}`,
              entityId: id,
              expandFields: [
                { label: '原始数据', value: typeof text === 'string' ? text : '（空）' },
              ],
            };
          }),
          isPhase3,
          onAdd: () => this._showAddModal('world_setting'),
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 规则系统 ──
      if (displayConfig.prompt_modules) {
        const pm = displayConfig.prompt_modules;
        const modules = pm.modules ? Object.entries(pm.modules) : [];
        const issues = stage2Validation && stage2Validation.fatalErrors.length > 0;
        const sectionEl = this._buildCardSection({
          icon: 'rule',
          label: '规则系统',
          summary: pm._summary || '',
          hasBadge: true,
          isOk: !issues,
          warnCount: issues ? stage2Validation.fatalErrors.length : 0,
          subItems: modules.map(([id, content]) => {
            const meta = pm.module_meta && pm.module_meta[id];
            const desc =
              meta && meta.description
                ? meta.description.slice(0, 60)
                : typeof content === 'string'
                  ? content.replace(/\n/g, ' ').slice(0, 60)
                  : '';
            const metaLines = [
              meta && meta.description ? `模块描述: ${meta.description}` : '',
              meta && meta.when_to_call ? `调用时机: ${meta.when_to_call}` : '',
            ]
              .filter(Boolean)
              .join('\n');
            const expandFields =
              id === 'core_world_mechanics'
                ? [
                    { label: 'NAME', value: 'core_world_mechanics（常驻注入）' },
                    {
                      label: 'DESCRIPTION',
                      value: '此模块内容直接注入调查员 system prompt 常驻部分。',
                    },
                    { label: '原始数据', value: typeof content === 'string' ? content : '（空）' },
                    ...(metaLines ? [{ label: '模块信息', value: metaLines }] : []),
                  ]
                : [
                    { label: '原始数据', value: typeof content === 'string' ? content : '（空）' },
                    ...(metaLines ? [{ label: '模块信息', value: metaLines }] : []),
                  ];
            return {
              name: id,
              preview: desc,
              dragText: `[规则系统 > ${id}] 请修改这个规则模块，具体要求：\n`,
              editTarget: 'prompt_modules',
              editPath: `modules.${id}`,
              entityId: id,
              expandFields,
            };
          }),
          isPhase3,
          onAdd: () => this._showAddModal('prompt_modules'),
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 角色数据库 ──
      if (displayConfig.character_database) {
        const cdb = displayConfig.character_database;
        const chars = Object.entries(cdb).filter(
          ([k, v]) => !k.startsWith('_') && v && typeof v === 'object'
        );
        const sectionEl = this._buildCardSection({
          icon: 'group',
          label: '角色数据库',
          summary: cdb._summary || '',
          hasBadge: true,
          isOk: true,
          subItems: chars.map(([id, c]) => {
            const fullText = Object.entries(c)
              .filter(([k]) => !k.startsWith('_'))
              .map(([k, v]) => `${k}：${typeof v === 'object' ? JSON.stringify(v) : v}`)
              .join('\n');
            return {
              name: c.name || id,
              preview: [c.title, c.gender, c.personality].filter(Boolean).join(' · ').slice(0, 60),
              fullText,
              dragText: `[角色数据库 > ${id} (${c.name || id})] 请修改这个角色，具体要求：\n`,
              editTarget: 'character_database',
              editPath: id,
              entityId: id,
            };
          }),
          isPhase3,
          onAdd: () => this._showAddModal('character_database'),
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 时间线 ──
      if (displayConfig.timeline) {
        const tl = displayConfig.timeline;
        const events = Array.isArray(tl.events) ? tl.events : [];
        // 渲染层按时间临时排序（不动 designConfig 存储），保留 originalIndex 让 editPath 写入精准定位
        const sortedView = events.map((e, originalIndex) => ({ e, originalIndex }));
        if (
          sortedView.length > 1 &&
          typeof timelineService !== 'undefined' &&
          typeof timelineService._parseSnapshotEventDate === 'function'
        ) {
          sortedView.sort((a, b) => {
            const dateA = timelineService._parseSnapshotEventDate(a.e);
            const dateB = timelineService._parseSnapshotEventDate(b.e);
            if (!dateA && !dateB) return a.originalIndex - b.originalIndex;
            if (!dateA) return 1;
            if (!dateB) return -1;
            return timelineService.compareDates(dateA, dateB, 'time');
          });
        }
        const sectionEl = this._buildCardSection({
          icon: 'timeline',
          label: '时间线',
          summary: tl._summary || `${events.length} 个事件`,
          hasBadge: true,
          isOk: true,
          subItems: sortedView.map(({ e, originalIndex }, displayIndex) => {
            const fullText = Object.entries(e)
              .map(([k, v]) => `${k}：${v}`)
              .join('\n');
            return {
              name: `#${displayIndex + 1} ${e.time || ''}`,
              preview: [e.location, e.content ? e.content.slice(0, 50) : '']
                .filter(Boolean)
                .join(' — '),
              fullText,
              dragText: `[时间线 > 事件#${displayIndex + 1} (${e.time || ''} ${e.location || ''})] 请修改这个事件，具体要求：\n`,
              editTarget: 'timeline',
              editPath: `events[${originalIndex}]`,
              entityId: `事件#${displayIndex + 1}`,
            };
          }),
          isPhase3,
          onAdd: () => this._showAddModal('timeline'),
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 角色时间线 ──
      if (displayConfig.character_timelines) {
        const ct = displayConfig.character_timelines;
        const chars = Object.entries(ct).filter(
          ([k, v]) => !k.startsWith('_') && v && typeof v === 'object'
        );
        const sectionEl = this._buildCardSection({
          icon: 'swap_vert',
          label: '角色时间线',
          summary: ct._summary || `${chars.length} 个角色`,
          hasBadge: true,
          isOk: true,
          subItems: chars.map(([id, data]) => {
            const cogCount = Array.isArray(data.cognitive) ? data.cognitive.length : 0;
            const relCount = Array.isArray(data.relationships) ? data.relationships.length : 0;
            const statusCount = Array.isArray(data.status) ? data.status.length : 0;
            const preview = `认知(${cogCount}) 关系(${relCount}) 状态(${statusCount})`;
            const fullText = JSON.stringify(data, null, 2);
            return {
              name: id,
              preview,
              fullText,
              dragText: `[角色时间线 > ${id}] 请修改这个角色的时间线，具体要求：\n`,
              editTarget: 'character_timelines',
              editPath: id,
              entityId: id,
            };
          }),
          isPhase3,
          onAdd: () => this._showAddModal('character_timelines'),
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // 绑定全部展开/收起
      expandAllBtn.addEventListener('click', () => {
        allSections.forEach(s => s._expandSection && s._expandSection());
      });
      collapseAllBtn.addEventListener('click', () => {
        allSections.forEach(s => s._collapseSection && s._collapseSection());
      });

      cardPanel.appendChild(card);
    }
    }

    // ── Code view → #design-code-panel ──
    if (codePanel) {
      // 如果 code 面板不可见，标记需要刷新，等切换过来时再重建
      if (codePanel.style.display === 'none') {
        codePanel._needsRefresh = true;
        return;
      }

      // 如果 textarea 存在且用户正在编辑（有未保存的修改），不要覆盖
      const existingTextarea = document.getElementById('design-code-editor');
      if (existingTextarea && existingTextarea._dirty) {
        // 静默更新缓存的最新数据，供「重置」按钮使用
        existingTextarea._latestCodeData = { ...displayConfig };
        return;
      }

      const scrollTop = existingTextarea ? existingTextarea.scrollTop : 0;

      codePanel.innerHTML = '';
      const warningPanel = this._buildPromptModuleWarningPanel(stage2Validation);
      const cognitiveWarningPanel = this._buildCognitiveSemanticWarningPanel(
        cognitiveSemanticsValidation
      );

      // 可编辑 JSON 数据（排除派生字段）
      const codeData = { ...displayConfig };

      // ── 头部行（警告 + 操作按钮同行）──
      const headerRow = document.createElement('div');
      headerRow.style.cssText =
        'display:flex;align-items:flex-start;gap:8px;flex-shrink:0;' +
        'border-bottom:1px solid var(--sheen-10);';

      // 只读模式按钮
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-secondary';
      editBtn.innerHTML =
        '<span class="material-symbols-outlined">edit</span><span class="dcv-act-label">修改</span>';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-secondary';
      copyBtn.innerHTML =
        '<span class="material-symbols-outlined">content_copy</span><span class="dcv-act-label">复制</span>';

      // 编辑模式按钮
      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn-primary';
      saveBtn.innerHTML =
        '<span class="material-symbols-outlined">save</span><span class="dcv-act-label">保存</span>';

      const resetBtn = document.createElement('button');
      resetBtn.className = 'btn-secondary';
      resetBtn.innerHTML =
        '<span class="material-symbols-outlined">undo</span><span class="dcv-act-label">重置</span>';

      const btnGroup = document.createElement('div');
      btnGroup.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';
      btnGroup.appendChild(editBtn);
      btnGroup.appendChild(copyBtn);
      btnGroup.appendChild(saveBtn);
      btnGroup.appendChild(resetBtn);

      if (warningPanel) {
        // 警告面板占满剩余宽度，按钮靠右对齐
        warningPanel.style.flex = '1';
        warningPanel.style.margin = '0';
        btnGroup.style.alignSelf = 'flex-start';
        btnGroup.style.padding = '10px 12px 10px 0';
        headerRow.appendChild(warningPanel);
      } else {
        // 无警告时：加间距 + 右对齐
        headerRow.style.padding = '8px 12px';
        headerRow.style.justifyContent = 'flex-end';
      }
      headerRow.appendChild(btnGroup);
      codePanel.appendChild(headerRow);

      if (cognitiveWarningPanel) {
        cognitiveWarningPanel.style.flexShrink = '0';
        codePanel.appendChild(cognitiveWarningPanel);
      }

      // ── 可编辑 textarea ──
      const textarea = document.createElement('textarea');
      textarea.id = 'design-code-editor';
      textarea.spellcheck = false;
      textarea._dirty = false;
      textarea._latestCodeData = codeData;
      textarea.value = JSON.stringify(codeData, null, 2);
      textarea.style.cssText =
        'flex:1;width:100%;box-sizing:border-box;padding:12px;margin:0;border:none;' +
        'background:transparent;color:var(--code-text);font-family:monospace;font-size:var(--text-body-sm);' +
        'line-height:1.5;resize:none;outline:none;white-space:pre;overflow:auto;tab-size:2;';
      codePanel.appendChild(textarea);

      // 模式切换：isEdit=true 为编辑模式，false 为只读模式
      const setMode = isEdit => {
        textarea.readOnly = !isEdit;
        textarea.style.cursor = isEdit ? 'text' : 'default';
        textarea.style.caretColor = isEdit ? 'var(--text-secondary)' : 'transparent'; // ui-lint-allow
        editBtn.style.display = isEdit ? 'none' : '';
        copyBtn.style.display = isEdit ? 'none' : '';
        saveBtn.style.display = isEdit ? '' : 'none';
        resetBtn.style.display = isEdit ? '' : 'none';
      };

      // 默认只读模式
      setMode(false);

      // 恢复滚动位置
      textarea.scrollTop = scrollTop;

      // 标记 dirty 状态
      textarea.addEventListener('input', () => {
        textarea._dirty = true;
      });

      // Tab 键插入缩进而非切换焦点（只读模式下跳过）
      textarea.addEventListener('keydown', e => {
        if (e.key === 'Tab') {
          if (textarea.readOnly) return;
          e.preventDefault();
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          textarea.value =
            textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
          textarea.selectionStart = textarea.selectionEnd = start + 2;
          textarea._dirty = true;
        }
      });

      // 修改 — 确认后进入编辑模式
      editBtn.addEventListener('click', () => {
        const proceed = () => {
          setMode(true);
          textarea.focus();
        };
        if (typeof window.showConfirmModal === 'function') {
          window.showConfirmModal(
            '直接修改 JSON',
            '你即将直接修改世界卡底层 JSON 数据。请确保你完全了解设计模式的逻辑和流程，未遵守正确格式的修改可能会导致整个世界卡无法导出或损坏。\n\n确定要继续吗？',
            proceed,
            null,
            { icon: 'warning', confirmTone: 'danger', confirmLabel: '继续' }
          );
        } else {
          proceed();
        }
      });

      // 保存
      saveBtn.addEventListener('click', () => {
        let parsed;
        try {
          parsed = JSON.parse(textarea.value);
        } catch (e) {
          window.showAlertModal('JSON 格式错误', e.message, null, { icon: 'error' });
          return;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          window.showAlertModal('格式错误', '顶层必须是一个对象', null, { icon: 'error' });
          return;
        }
        // 写入新值
        for (const [k, v] of Object.entries(parsed)) {
          if (!k.startsWith('_')) this.designConfig[k] = v;
        }
        // 删除编辑后不存在的 key（跳过内部字段）
        for (const k of Object.keys(this.designConfig)) {
          if (!k.startsWith('_') && !(k in parsed)) {
            delete this.designConfig[k];
          }
        }
        textarea._dirty = false;
        this._saveDesignConfig();
        this._updatePreviewPanel();
      });

      // 重置 — 使用最新的配置数据，返回只读模式
      resetBtn.addEventListener('click', () => {
        textarea.value = JSON.stringify(textarea._latestCodeData || codeData, null, 2);
        textarea._dirty = false;
        setMode(false);
      });

      // 复制
      // sync handler + .then() 链：iOS Safari 在 async handler 下 user activation 跨 microtask 不可靠，
      // 历史上常见 NotAllowedError。保持同步入口让浏览器在调用瞬间能识别到 user gesture。
      copyBtn.addEventListener('click', () => {
        navigator.clipboard
          .writeText(textarea.value)
          .then(() => {
            copyBtn.classList.add('is-success');
            copyBtn.querySelector('.dcv-act-label').textContent = '已复制';
            setTimeout(() => {
              copyBtn.classList.remove('is-success');
              copyBtn.querySelector('.dcv-act-label').textContent = '复制';
            }, 1500);
          })
          .catch(err => {
            console.error('Copy failed', err);
          });
      });
    }
  }

  // ========================================
  // 角色卡牌审阅模式（Stage 3 完成后阻塞审阅）
  // ========================================

  // ==================================================================
  // Stage Review Framework — 通用卡牌审阅框架（stage-agnostic）
  // 各 stage 的具体行为通过 window.getReviewAdapter(stage) 拿到的 adapter 决定。
  // ==================================================================

  /**
   * 把任意 stage 的审阅 panel 挂到 chat 消息气泡里（plan-panel 模式：collapsible details）。
   * 被 chatCore 调用，targetMsgEl 是 "请审阅" AI 消息的 DOM 元素。
   * @param {number} stage
   * @param {HTMLElement} targetMsgEl
   */
  renderStageReviewPanel(stage, targetMsgEl) {
    if (!targetMsgEl) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) {
      console.warn('[DesignMode] no review adapter for stage', stage);
      return;
    }
    const contentEl = targetMsgEl.querySelector('.chat-message-content');
    if (!contentEl) return;

    const oldPanel = contentEl.querySelector('.character-review-panel');
    if (oldPanel) oldPanel.remove();

    const entries = adapter.getEntities(this.designConfig);

    const panel = document.createElement('details');
    panel.className = 'character-review-panel';
    panel.open = true;
    panel.dataset.reviewPanel = 'true';
    panel.dataset.reviewStage = String(stage);

    const summary = document.createElement('summary');
    summary.className = 'character-review-summary';
    const panelIcon = adapter.panelIcon || 'groups';
    summary.innerHTML = `
      <span class="character-review-summary-left">
        <span class="material-symbols-outlined">${this._escapeHtml(panelIcon)}</span>
        <span class="character-review-summary-title">${this._escapeHtml(adapter.panelTitle)} · ${this._escapeHtml(adapter.panelSubtitle)}</span>
        <span class="character-review-count">${this._escapeHtml(adapter.buildCountText(entries.length))}</span>
      </span>
      <span class="character-review-summary-chevron material-symbols-outlined">expand_more</span>
    `;
    panel.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'character-review-body';

    // 批量修复按钮（adapter 决定有没有需要修复的 entity；为空时不渲染按钮）
    const needsReroll =
      typeof adapter.findEntitiesNeedingReroll === 'function'
        ? adapter.findEntitiesNeedingReroll(this.designConfig) || []
        : [];
    const batchBtnHtml =
      needsReroll.length > 0
        ? `<button type="button" class="btn-secondary btn-cr-batch-fix" data-action="batch-reroll" title="对所有缺章/不合格的卡顺序调 AI 重抽">
             <span class="material-symbols-outlined">auto_fix_high</span>批量修复 (${needsReroll.length})
           </button>`
        : '';

    const toolbar = document.createElement('div');
    toolbar.className = 'character-review-toolbar';
    toolbar.innerHTML = `
      <div class="character-review-hint">
        每张卡可以<b>点笔 ✏️ 编辑</b>、<b>点 ⟳ 让 AI 重抽</b>、<b>点 ✕ 删除</b>；
        把卡<b>拖到下方输入框</b>可以做定向修改；也可以<b>直接在输入框描述</b>想改的内容。
      </div>
      <div class="character-review-actions">
        ${batchBtnHtml}
        <button type="button" class="btn-ghost btn-cr-add" data-action="add-entity">
          <span class="material-symbols-outlined">person_add</span>${this._escapeHtml(adapter.addButtonLabel)}
        </button>
        <button type="button" class="btn-primary btn-cr-confirm" data-action="confirm-resume">
          <span class="material-symbols-outlined">arrow_forward</span>${stage >= 4 ? '确认完成' : `确认 → Stage ${stage + 1}`}
        </button>
      </div>
    `;
    body.appendChild(toolbar);

    const grid = document.createElement('div');
    grid.className = 'character-review-grid';
    for (const [id, obj] of entries) {
      grid.appendChild(this._buildEntityCard(adapter, id, obj));
    }
    body.appendChild(grid);

    panel.appendChild(body);

    toolbar
      .querySelector('[data-action="add-entity"]')
      .addEventListener('click', () => this._handleAddEntityClick(stage));
    toolbar
      .querySelector('[data-action="confirm-resume"]')
      .addEventListener('click', () => this._handleConfirmStage4Click());
    const batchBtn = toolbar.querySelector('[data-action="batch-reroll"]');
    if (batchBtn) {
      batchBtn.addEventListener('click', () => this._handleBatchRerollClick(stage));
    }

    contentEl.appendChild(panel);
    this._activeReviewPanel = panel;
    this._activeReviewStage = stage;
  }

  /** 兼容旧调用：转发到通用入口（chatCore 改造前的过渡） */
  renderCharacterReviewPanel(targetMsgEl) {
    return this.renderStageReviewPanel(3, targetMsgEl);
  }

  _getActiveAdapter() {
    const stage = this._activeReviewStage;
    if (stage == null) return null;
    return window.getReviewAdapter && window.getReviewAdapter(stage);
  }

  _legacyRenderEntry(targetMsgEl) { return this.renderStageReviewPanel(3, targetMsgEl); }

  // ── 局部 DOM 定位 ──
  _getReviewGrid() {
    const panel = this._activeReviewPanel;
    if (!panel || !panel.isConnected) return null;
    return panel.querySelector('.character-review-grid');
  }
  _getEntityCardEl(stage, id) {
    const grid = this._getReviewGrid();
    if (!grid) return null;
    return grid.querySelector(
      `.character-review-card[data-entity-id="${CSS.escape(id)}"][data-review-stage="${stage}"]`
    );
  }
  _updateReviewCount(stage) {
    const panel = this._activeReviewPanel;
    if (!panel || !panel.isConnected) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const count = adapter.countEntities(this.designConfig);
    const countEl = panel.querySelector('.character-review-count');
    if (countEl) countEl.textContent = adapter.buildCountText(count);
  }

  // ── 局部刷新（reroll / add / delete / 单字段） ──
  _setEntityCardLoading(stage, id, isLoading) {
    const cardEl = this._getEntityCardEl(stage, id);
    if (!cardEl) return;
    if (isLoading) {
      cardEl.classList.add('character-review-card--loading');
      if (!cardEl.querySelector('.character-review-card-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'character-review-card-overlay';
        overlay.innerHTML =
          '<div class="character-review-card-overlay-spinner">' +
          '<span class="material-symbols-outlined">refresh</span>' +
          '<span>AI 重抽中…</span>' +
          '</div>';
        cardEl.appendChild(overlay);
      }
    } else {
      cardEl.classList.remove('character-review-card--loading');
      const overlay = cardEl.querySelector('.character-review-card-overlay');
      if (overlay) overlay.remove();
    }
  }
  _refreshEntityCard(stage, id) {
    const cardEl = this._getEntityCardEl(stage, id);
    if (!cardEl) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const obj = adapter.getEntity(this.designConfig, id);
    if (obj == null) return; // 注意：空字符串是合法的空白 entity（Stage 1）
    const newCard = this._buildEntityCard(adapter, id, obj);
    newCard.classList.add('character-review-card--just-updated');
    cardEl.replaceWith(newCard);
    setTimeout(() => newCard.classList.remove('character-review-card--just-updated'), 1200);
    // entity 的 warning 状态可能变了，同步刷新批量按钮 count
    this._refreshBatchButton(stage);
  }
  // 单字段刷新（自然语言改写 commit 后用，整卡编辑模式不走这个）
  _refreshEntityField(stage, id, _fieldKey) {
    // 简化：单字段刷新直接重渲整张卡，更稳（field row 构造在 adapter 内部，不易精准替换）
    this._refreshEntityCard(stage, id);
  }
  _addEntityCardToPanel(stage, id) {
    const grid = this._getReviewGrid();
    if (!grid) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const obj = adapter.getEntity(this.designConfig, id);
    if (obj == null) return; // 空字符串合法（Stage 1 空白 entity）
    if (this._getEntityCardEl(stage, id)) return;
    const newCard = this._buildEntityCard(adapter, id, obj);
    newCard.classList.add('character-review-card--just-added');
    grid.appendChild(newCard);
    this._updateReviewCount(stage);
    this._refreshBatchButton(stage);
    setTimeout(() => newCard.classList.remove('character-review-card--just-added'), 600);
  }
  _removeEntityCardFromPanel(stage, id) {
    const cardEl = this._getEntityCardEl(stage, id);
    if (!cardEl) {
      this._updateReviewCount(stage);
      return;
    }
    cardEl.classList.add('character-review-card--removing');
    setTimeout(() => {
      if (cardEl.isConnected) cardEl.remove();
      this._updateReviewCount(stage);
      this._refreshBatchButton(stage);
    }, 300);
  }

  // ── 单卡构造（adapter-driven） ──
  _buildEntityCard(adapter, id, obj) {
    const stage = adapter.stage;
    const card = document.createElement('div');
    card.className = 'character-review-card';
    card.dataset.entityId = id;
    card.dataset.reviewStage = String(stage);
    card.dataset.editMode = '0';

    // 拖拽到 chat 输入框
    card.draggable = true;
    card.addEventListener('dragstart', e => {
      if (card.dataset.editMode === '1') {
        e.preventDefault();
        return;
      }
      const cur = adapter.getEntity(this.designConfig, id) || obj;
      const dragText = adapter.getDragText(id, cur);
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', dragText);
      card.classList.add('character-review-card--dragging');
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('character-review-card--dragging');
    });

    // ── 头部 ──
    const head = document.createElement('div');
    head.className = 'character-review-card-head';
    const displayName = adapter.getDisplayName(id, obj);
    const headerPills = adapter.getHeaderPills(id, obj) || [];
    const pillsHtml = headerPills
      .map(p => {
        const cls =
          'cr-meta-pill' + (p.accent ? ` cr-meta-pill--${p.accent}` : '');
        return `<span class="${cls}" data-edit-field="${this._escapeHtml(p.field)}">${this._escapeHtml(p.value)}</span>`;
      })
      .join('');
    const idPillHtml = adapter.suppressIdPill
      ? ''
      : `<span class="cr-meta-id">#${this._escapeHtml(id)}</span>`;
    // 警告 chip（adapter 决定，例如 Stage 1 缺章节）
    const warning =
      typeof adapter.getEntityWarning === 'function'
        ? adapter.getEntityWarning(id, obj)
        : null;
    const warningHtml = warning
      ? `<span class="cr-meta-pill cr-meta-pill--warning" title="${this._escapeHtml(warning.tooltip || warning.label)}">⚠ ${this._escapeHtml(warning.label)}</span>`
      : '';
    if (warning) card.classList.add('character-review-card--has-warning');
    // adapter 决定该 entity 是否允许 reroll（默认允许；design_qna 之类系统模块不允许）
    const canReroll =
      typeof adapter.canReroll === 'function' ? adapter.canReroll(id, obj) : true;
    const rerollTooltip = canReroll
      ? this._escapeHtml(adapter.rerollTooltip || 'AI 重抽这张卡')
      : '此卡是系统生成，不支持 AI 重抽';
    head.innerHTML = `
      <span class="cr-drag-handle material-symbols-outlined" title="${this._escapeHtml(adapter.dragHandleTooltip || '拖拽到下方输入框')}">drag_indicator</span>
      <div class="character-review-card-id">
        <div class="character-review-card-name" data-edit-field="name">${this._escapeHtml(displayName)}</div>
        <div class="character-review-card-meta">
          ${warningHtml}
          ${pillsHtml}
          ${idPillHtml}
        </div>
      </div>
      <div class="character-review-card-actions">
        <button type="button" class="cr-icon-btn" data-action="edit" title="${this._escapeHtml(adapter.editTooltip || '编辑这张卡')}">
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button type="button" class="cr-icon-btn" data-action="reroll" title="${rerollTooltip}"${canReroll ? '' : ' disabled'}>
          <span class="material-symbols-outlined">refresh</span>
        </button>
        <button type="button" class="cr-icon-btn cr-icon-btn--danger" data-action="delete" title="${this._escapeHtml(adapter.deleteTooltip || '删除这张卡')}">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;
    card.appendChild(head);

    // ── 主体 (adapter 提供) ──
    const body = adapter.buildCardBody(id, obj);
    if (body) card.appendChild(body);

    // ── 折叠区"更多字段" (adapter 提供) ──
    const collapsibleItems =
      typeof adapter.getCollapsibleFields === 'function'
        ? adapter.getCollapsibleFields(id, obj) || []
        : [];
    if (collapsibleItems.length > 0) {
      const more = document.createElement('details');
      more.className = 'character-review-card-more';
      const summary = document.createElement('summary');
      summary.textContent = `更多字段（${collapsibleItems.length}）`;
      more.appendChild(summary);
      const moreBody = document.createElement('div');
      moreBody.className = 'character-review-card-more-body';
      for (const item of collapsibleItems) {
        if (item.rowEl) moreBody.appendChild(item.rowEl);
      }
      more.appendChild(moreBody);
      card.appendChild(more);
    }

    // ── 操作按钮事件绑定 ──
    head.querySelector('[data-action="edit"]').addEventListener('click', e => {
      e.stopPropagation();
      this._handleCardEditToggle(stage, id);
    });
    head.querySelector('[data-action="reroll"]').addEventListener('click', e => {
      e.stopPropagation();
      this._handleRerollEntityClick(stage, id);
    });
    head.querySelector('[data-action="delete"]').addEventListener('click', e => {
      e.stopPropagation();
      this._handleDeleteEntityClick(stage, id);
    });

    return card;
  }

  // ── 整卡编辑模式 ──
  _handleCardEditToggle(stage, id) {
    const cardEl = this._getEntityCardEl(stage, id);
    if (!cardEl) return;
    if (cardEl.dataset.editMode === '1') {
      this._exitCardEditMode(stage, id, true);
    } else {
      this._enterCardEditMode(stage, id);
    }
  }

  _enterCardEditMode(stage, id) {
    const cardEl = this._getEntityCardEl(stage, id);
    if (!cardEl) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const obj = adapter.getEntity(this.designConfig, id);
    if (!obj) return;

    cardEl.dataset.editMode = '1';
    cardEl.classList.add('character-review-card--editing');
    cardEl.draggable = false;

    // 头部 meta：编辑模式下 adapter 决定要显示哪些 pill 的 input（即使原值为空）
    const meta = cardEl.querySelector('.character-review-card-meta');
    const editablePills =
      typeof adapter.getHeaderEditableFields === 'function'
        ? adapter.getHeaderEditableFields() || []
        : [];
    if (meta && editablePills.length > 0) {
      const idPillHtml = meta.querySelector('.cr-meta-id')?.outerHTML || '';
      meta.innerHTML = '';
      for (const p of editablePills) {
        const editor = adapter.buildHeaderPillEditor(p.field, obj[p.field] || '', p.accent);
        meta.appendChild(editor);
      }
      meta.insertAdjacentHTML('beforeend', idPillHtml);
    }

    // name (head) → input 通过 adapter 提供
    const nameEl = cardEl.querySelector('.character-review-card-name');
    if (nameEl && typeof adapter.buildHeaderNameEditor === 'function') {
      const nameEditor = adapter.buildHeaderNameEditor(obj.name || '');
      nameEl.replaceWith(nameEditor);
    }

    // 把 body 内所有 view 态字段值替换为 adapter 提供的 editor
    cardEl
      .querySelectorAll('.character-review-field-value[data-edit-field]')
      .forEach(el => {
        const key = el.dataset.editField;
        // adapter 可能直接拿 entity 的 key 字段（Stage 3）；也可能用伪 key（如 __content__）需要 obj 整体作为 raw（Stage 1）
        const raw =
          typeof adapter.getEditableRaw === 'function'
            ? adapter.getEditableRaw(key, obj)
            : obj[key];
        const editor = adapter.buildEditableField(key, raw);
        el.replaceWith(editor);
        if (editor.tagName === 'TEXTAREA') {
          const grow = () => this._autoGrowTextarea(editor);
          editor.addEventListener('input', grow);
          requestAnimationFrame(grow);
        }
      });
    // 编辑模式下自动展开卡内所有 <details>（让折叠区在编辑时也可见）
    cardEl.querySelectorAll('details').forEach(d => {
      d.open = true;
    });

    // 笔图标 → 对勾
    const editBtn = cardEl.querySelector('[data-action="edit"]');
    if (editBtn) {
      editBtn.title = '保存修改';
      editBtn.classList.add('cr-icon-btn--save');
      const icon = editBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'check';
    }
  }

  async _exitCardEditMode(stage, id, save) {
    const cardEl = this._getEntityCardEl(stage, id);
    if (!cardEl) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const obj = adapter.getEntity(this.designConfig, id);
    if (obj == null) return;

    if (save) {
      // 收集编辑器值（按 [data-edit-field] 索引），把"还原 + 应用"细节交给 adapter.commitEdit
      const collected = {};
      cardEl.querySelectorAll('[data-edit-field]').forEach(ed => {
        if (!(ed instanceof HTMLInputElement) && !(ed instanceof HTMLTextAreaElement)) return;
        const key = ed.dataset.editField;
        const origKind = ed.dataset.editingOrigKind || 'string';
        collected[key] =
          typeof adapter.coerceFieldValue === 'function'
            ? adapter.coerceFieldValue(ed.value, origKind)
            : ed.value;
      });
      let result = null;
      if (typeof adapter.commitEdit === 'function') {
        try {
          result = adapter.commitEdit(this, id, obj, collected);
        } catch (err) {
          console.warn('[DesignMode] adapter.commitEdit failed:', err);
        }
      }
      if (result && result.changed) {
        this._saveDesignConfig();
        this._updatePreviewPanel();
        if (
          result.nameChanged &&
          typeof adapter.onAfterNameChange === 'function'
        ) {
          try {
            await adapter.onAfterNameChange(this, result.oldName, result.newName, id);
          } catch (e) {
            console.warn('[DesignMode] adapter.onAfterNameChange failed:', e);
          }
        }
      }
    }
    this._refreshEntityCard(stage, id);
  }

  // ── 顶部按钮 + 卡上按钮的 click 处理 ──
  _handleConfirmStage4Click() {
    if (typeof window.resumeDesignPhase2FromReview === 'function') {
      window.resumeDesignPhase2FromReview();
    } else {
      console.warn('[DesignMode] resumeDesignPhase2FromReview not exposed');
    }
  }

  async _handleAddEntityClick(stage) {
    if (typeof window.showDesignPrompt !== 'function') return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const choice = await window.showDesignPrompt(
      adapter.addPromptTitle,
      adapter.addPromptMessage,
      ''
    );
    if (choice === null) return;
    const hint = (choice || '').trim();
    if (hint === '') this._addBlankEntity(stage);
    else this._addEntityByAI(stage, hint);
  }

  async _handleRerollEntityClick(stage, id) {
    if (typeof window.showDesignPrompt !== 'function') return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const obj = adapter.getEntity(this.designConfig, id);
    // 防御：adapter 标记此 entity 不可 reroll（如 design_qna），按钮已 disabled，但万一被绕过
    if (typeof adapter.canReroll === 'function' && !adapter.canReroll(id, obj)) {
      if (typeof window.showToast === 'function') {
        window.showToast('此卡是系统生成，不支持 AI 重抽');
      }
      return;
    }
    const hint = await window.showDesignPrompt(
      adapter.rerollPromptTitle(id, obj),
      adapter.rerollPromptMessage,
      ''
    );
    if (hint === null) return;
    this._rerollEntity(stage, id, (hint || '').trim());
  }

  async _handleDeleteEntityClick(stage, id) {
    if (typeof window.showDesignConfirm !== 'function') return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const obj = adapter.getEntity(this.designConfig, id);
    // 长说明文案左对齐（短句仍居中）
    const ok = await window.showDesignConfirm(
      adapter.deleteConfirmTitle,
      adapter.deleteConfirmMessage(id, obj),
      { align: 'left' }
    );
    if (!ok) return;
    this._deleteEntity(stage, id);
  }

  /**
   * 批量重抽：对 adapter 标记为需要修复的所有 entity 顺序调 _rerollEntity。
   * Stage 1 用于一次性修复多个缺章的世界实体。
   */
  async _handleBatchRerollClick(stage) {
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter || typeof adapter.findEntitiesNeedingReroll !== 'function') return;
    if (typeof window.showDesignConfirm !== 'function') return;
    const ids = adapter.findEntitiesNeedingReroll(this.designConfig) || [];
    if (ids.length === 0) {
      if (typeof window.showToast === 'function') window.showToast('没有需要修复的卡');
      this._refreshBatchButton(stage);
      return;
    }
    const ok = await window.showDesignConfirm(
      `批量修复 ${ids.length} 张卡`,
      `将顺序调 AI 重抽这 <b>${ids.length}</b> 张卡（${ids.length} 次 API 调用，可能需要几分钟）。<br><br>` +
        `期间不要切换页面或操作其他卡。失败的卡会被跳过，最后给出汇总。<br><br>` +
        `确认开始？`
    );
    if (!ok) return;

    // 禁用按钮 + 加 loading 状态
    const panel = this._activeReviewPanel;
    const btn = panel?.querySelector('[data-action="batch-reroll"]');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('btn-cr-batch-fix--running');
      btn.innerHTML =
        '<span class="material-symbols-outlined cr-batch-spinning">progress_activity</span>修复中…';
    }

    let success = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this._rerollEntity(stage, id, '');
        // 检查是否真的修好了（adapter 决定）
        const obj = adapter.getEntity(this.designConfig, id);
        const stillBad =
          typeof adapter.getEntityWarning === 'function'
            ? !!adapter.getEntityWarning(id, obj)
            : false;
        if (stillBad) failed++;
        else success++;
      } catch (e) {
        console.warn('[DesignMode] batch reroll item failed:', id, e);
        failed++;
      }
    }

    // 完成 toast + 按钮刷新
    if (typeof window.showToast === 'function') {
      window.showToast(
        `批量修复完成：成功 ${success}，失败/未修复 ${failed}（共 ${ids.length} 张）`
      );
    }
    this._refreshBatchButton(stage);
  }

  // 批量按钮的状态刷新：count 变化时更新文案，0 则隐藏
  _refreshBatchButton(stage) {
    const panel = this._activeReviewPanel;
    if (!panel || !panel.isConnected) return;
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter || typeof adapter.findEntitiesNeedingReroll !== 'function') return;
    const ids = adapter.findEntitiesNeedingReroll(this.designConfig) || [];
    const btn = panel.querySelector('[data-action="batch-reroll"]');
    if (!btn) {
      // 之前没渲染按钮（初始无缺章），现在出现 → 不动态加按钮（下次 panel 重建会自动出现）
      return;
    }
    if (ids.length === 0) {
      btn.remove();
    } else {
      btn.disabled = false;
      btn.classList.remove('btn-cr-batch-fix--running');
      btn.innerHTML = `<span class="material-symbols-outlined">auto_fix_high</span>批量修复 (${ids.length})`;
    }
  }

  _escapeHtml(text) {
    if (text === null || text === undefined || text === '') return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
  }

  // textarea 自动按内容增高。
  // 高度 = scrollHeight + 上下 border —— scrollHeight 不含 border，box-sizing:border-box 时
  // 直接设 height=scrollHeight 会让实际可显示区少了 border 高度，导致 1-2px 内容溢出 → 短滚动条假象。
  // max-height 由 CSS 控制（character-review-edit-input 默认 16em；Stage 1 markdown 36em；Stage 2 meta 18em），
  // 超出时 CSS overflow: auto 自动给滚动条。
  _autoGrowTextarea(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return;
    ta.style.height = 'auto';
    const cs = window.getComputedStyle(ta);
    const borderH =
      (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    ta.style.height = ta.scrollHeight + borderH + 'px';
  }

  _charFieldEqual(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (_e) {
      return false;
    }
  }

  /**
   * 构建卡片视图中的单个可折叠区块（含可拖拽子项）
   * @param {object} opts
   * @param {string} opts.icon - Material Symbol 图标名
   * @param {string} opts.label - 区块标题
   * @param {string} opts.summary - 摘要文字（显示在标题行）
   * @param {boolean} opts.isOk - 是否通过验证
   * @param {number} [opts.warnCount] - 错误数量
   * @param {Array} opts.subItems - 子项数组 [{name, preview, dragText}]
   * @param {boolean} opts.isPhase3 - 是否处于 Phase 3（影响拖拽启用）
   */
  _buildCardSection({
    icon,
    label,
    isOk,
    warnCount = 0,
    subItems = [],
    isPhase3,
    _fullTextMap = {},
    headerAnnotation = '',
    onAdd,
  }) {
    const section = document.createElement('div');
    section.className = 'dcv-section';

    // ── 区块头部（点击折叠/展开区块） ──
    const header = document.createElement('div');
    header.className = 'dcv-section-header';

    const badgeHtml = isOk
      ? `<span class="dcv-ok-badge">✓</span>` /* ui-lint-allow */
      : `<span class="dcv-warn-badge">⚠ ${warnCount}</span>`; /* ui-lint-allow */

    const countBadge =
      subItems.length > 0 ? `<span class="dcv-count-badge">${subItems.length}</span>` : '';

    const fnTagHtml = headerAnnotation ? `<span class="dcv-fn-tag">${headerAnnotation}</span>` : '';

    const addBtnHtml =
      isPhase3 && onAdd
        ? `<span class="material-symbols-outlined" data-action="dcv-header-add-btn" title="新增">add_circle</span>`
        : '';

    header.innerHTML = `
            <span class="material-symbols-outlined dcv-icon">${icon}</span>
            <span class="dcv-label">${label}</span>
            ${fnTagHtml}
            ${countBadge}
            ${badgeHtml}
            ${addBtnHtml}
            <span class="material-symbols-outlined dcv-collapse-icon">expand_more</span>`;

    if (isPhase3 && onAdd) {
      const addEl = header.querySelector('[data-action~="dcv-header-add-btn"]');
      if (addEl) {
        addEl.addEventListener('click', e => {
          e.stopPropagation();
          onAdd();
        });
      }
    }

    // ── 子项列表 ──
    const body = document.createElement('div');
    body.className = 'dcv-section-body';

    if (subItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'dcv-subitem-empty';
      empty.textContent = '（暂无数据）';
      body.appendChild(empty);
    } else {
      subItems.forEach(
        ({
          name,
          displayName,
          subtitle,
          preview,
          fullText,
          dragText,
          annotation,
          editTarget,
          editPath,
          entityId,
          expandFields,
        }) => {
          const item = document.createElement('div');
          item.className = 'dcv-subitem';
          let expandBtn = null;
          let actionsBar = null;

          // ── 拖拽（Phase 3，仅当有 dragText 时） ──
          const isTouchDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
          if (isPhase3 && dragText) {
            if (!isTouchDevice) item.draggable = true;
            item.title = isTouchDevice ? '点击查看全文' : '点击查看全文 · 拖拽到输入框定向编辑';
            item.addEventListener('dragstart', e => {
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData('text/plain', dragText);
              item.classList.add('dcv-subitem--dragging');
            });
            item.addEventListener('dragend', () => {
              item.classList.remove('dcv-subitem--dragging');
            });
          } else {
            item.title = '点击查看全文';
          }

          // ── 操作按键（Phase 3）──
          if (isPhase3) {
            actionsBar = document.createElement('div');
            actionsBar.className = 'dcv-subitem-actions';

            // 删除
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-secondary btn-danger';
            deleteBtn.innerHTML =
              '<span class="material-symbols-outlined">delete</span><span class="dcv-act-label">删除</span>';
            deleteBtn.addEventListener('click', e => {
              e.stopPropagation();
              if (!editTarget || !editPath) return;
              const refs = this._searchReferences(entityId || name).filter(s => s !== label);
              let msg = `确定删除「${name}」吗？`;
              if (refs.length > 0) {
                msg += `\n\n⚠ 「${entityId || name}」在以下区域被引用：${refs.join('、')}\n删除后可能需要手动更新相关内容。`; /* ui-lint-allow */
              }
              const doDelete = () => {
                this._deleteNestedValue(this.designConfig, editTarget, editPath);
                if (editTarget === 'prompt_modules' && editPath.startsWith('modules.')) {
                  const metaPath = editPath.replace('modules.', 'module_meta.');
                  this._deleteNestedValue(this.designConfig, editTarget, metaPath);
                }
                this._saveDesignConfig();
                this._updatePreviewPanel();
              };
              if (typeof window.showConfirmModal === 'function') {
                window.showConfirmModal('删除确认', msg, doDelete, null, {
                  icon: 'delete',
                  confirmTone: 'danger',
                  confirmLabel: '删除',
                });
              } else {
                doDelete();
              }
            });

            // 编辑
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-secondary';
            editBtn.innerHTML =
              '<span class="material-symbols-outlined">edit</span><span class="dcv-act-label">编辑</span>';
            editBtn.addEventListener('click', e => {
              e.stopPropagation();
              if (editTarget && editPath) this._showEditModal(name, editTarget, editPath);
            });

            // 完善
            const refineBtn = document.createElement('button');
            refineBtn.className = 'btn-secondary';
            refineBtn.innerHTML =
              '<span class="material-symbols-outlined">auto_fix_high</span><span class="dcv-act-label">完善</span>';
            refineBtn.addEventListener('click', e => {
              e.stopPropagation();
              const input = document.querySelector('.chat-input-textbox');
              if (!input || !dragText) return;
              const sep = input.value && !input.value.endsWith('\n') ? '\n' : '';
              input.value += sep + dragText;
              input.focus();
              input.setSelectionRange(input.value.length, input.value.length);
              if (typeof autoResizeTextarea === 'function') autoResizeTextarea();
            });

            // 展开/收起
            expandBtn = document.createElement('button');
            expandBtn.className = 'btn-secondary btn-ghost';
            expandBtn.innerHTML =
              '<span class="material-symbols-outlined">unfold_more</span><span class="dcv-act-label">展开</span>';
            expandBtn.addEventListener('click', e => {
              e.stopPropagation();
              const isExpanded = item.classList.toggle('dcv-subitem--expanded');
              expandBtn.innerHTML = isExpanded
                ? '<span class="material-symbols-outlined">unfold_less</span><span class="dcv-act-label">收起</span>'
                : '<span class="material-symbols-outlined">unfold_more</span><span class="dcv-act-label">展开</span>';
            });

            actionsBar.appendChild(deleteBtn);
            actionsBar.appendChild(editBtn);
            actionsBar.appendChild(refineBtn);
            actionsBar.appendChild(expandBtn);
            actionsBar.addEventListener('mousedown', e => e.stopPropagation());
          }

          // ── 头部区域：左侧信息 + 右侧按键 ──
          const headerRow = document.createElement('div');
          headerRow.className = 'dcv-subitem-header';

          const infoArea = document.createElement('div');
          infoArea.className = 'dcv-subitem-info';

          // 第一行：显示名称（中文名 或 name）
          const nameEl = document.createElement('div');
          nameEl.className = 'dcv-subitem-name';
          nameEl.textContent = displayName || name;

          // 第二行：副标题（英文名 或 preview）
          const subtitleEl = document.createElement('div');
          subtitleEl.className = 'dcv-subitem-subtitle';
          subtitleEl.textContent = subtitle || preview || '—';

          infoArea.appendChild(nameEl);
          infoArea.appendChild(subtitleEl);

          // 第三行：函数注解（如有）
          if (annotation) {
            const annoEl = document.createElement('div');
            annoEl.className = 'dcv-subitem-fn';
            annoEl.textContent = annotation;
            infoArea.appendChild(annoEl);
          }

          headerRow.appendChild(infoArea);
          if (actionsBar) headerRow.appendChild(actionsBar);
          item.appendChild(headerRow);

          // preview 文字（header 下方，仅当 subtitle 与 preview 不同时显示）
          const subtitleText = subtitle || preview || '';
          if (preview && preview !== subtitleText) {
            const previewEl = document.createElement('div');
            previewEl.className = 'dcv-subitem-preview';
            previewEl.textContent = preview;
            item.appendChild(previewEl);
          }

          // 拖动图标（Phase 3，非触屏）
          if (isPhase3 && !isTouchDevice) {
            const dragIcon = document.createElement('span');
            dragIcon.className = 'material-symbols-outlined dcv-drag-icon';
            dragIcon.textContent = 'drag_indicator';
            item.appendChild(dragIcon);
          }

          // ── 全文展开面板 ──
          const expandPanel = document.createElement('div');
          expandPanel.className = 'dcv-subitem-expand';

          if (expandFields && expandFields.length > 0) {
            expandFields.forEach(field => {
              const fieldEl = document.createElement('div');
              fieldEl.className = 'dcv-expand-field';
              const labelEl = document.createElement('div');
              labelEl.className = 'dcv-expand-field-label';
              labelEl.textContent = field.label;
              const valueEl = document.createElement('div');
              valueEl.className = 'dcv-expand-field-value';
              valueEl.textContent = field.value;
              fieldEl.appendChild(labelEl);
              fieldEl.appendChild(valueEl);
              expandPanel.appendChild(fieldEl);
            });
          } else {
            const expandContent = document.createElement('div');
            expandContent.className = 'dcv-subitem-expand-content';
            expandContent.textContent = fullText || preview || '（无内容）';
            expandPanel.appendChild(expandContent);
          }

          item.appendChild(expandPanel);

          // ── 点击展开/收起 ──
          const toggleExpand = _e => {
            if (item.classList.contains('dcv-subitem--dragging')) return;
            const isExpanded = item.classList.toggle('dcv-subitem--expanded');
            if (expandBtn) {
              expandBtn.innerHTML = isExpanded
                ? '<span class="material-symbols-outlined">unfold_less</span><span class="dcv-act-label">收起</span>'
                : '<span class="material-symbols-outlined">unfold_more</span><span class="dcv-act-label">展开</span>';
            }
          };

          // 点击信息区域展开
          infoArea.addEventListener('click', toggleExpand);

          body.appendChild(item);
        }
      );
    }

    // ── 区块折叠逻辑 ──
    let sectionCollapsed = false;

    const collapseSection = () => {
      sectionCollapsed = true;
      body.classList.add('dcv-section-body--collapsed');
      const icon = header.querySelector('.dcv-collapse-icon');
      if (icon) icon.textContent = 'chevron_right';
      section.classList.add('dcv-section--collapsed');
    };

    const expandSection = () => {
      sectionCollapsed = false;
      body.classList.remove('dcv-section-body--collapsed');
      const icon = header.querySelector('.dcv-collapse-icon');
      if (icon) icon.textContent = 'expand_more';
      section.classList.remove('dcv-section--collapsed');
    };

    header.addEventListener('click', () => {
      sectionCollapsed ? expandSection() : collapseSection();
    });

    section.appendChild(header);
    section.appendChild(body);

    // 暴露接口给全局控制
    section._collapseSection = collapseSection;
    section._expandSection = expandSection;

    return section;
  }

  _buildPromptModuleWarningPanel(report) {
    if (!report) return null;
    const totalIssues = report.fatalErrors.length + report.warnings.length;
    if (totalIssues === 0) return null;

    const wrapper = document.createElement('div');
    wrapper.style.margin = '0 0 12px 0';
    wrapper.style.padding = '10px 12px';
    wrapper.style.border = '1px solid color-mix(in srgb, var(--status-danger) 70%, transparent)'; // ui-lint-allow
    wrapper.style.background = 'color-mix(in srgb, var(--status-danger) 8%, transparent)'; // ui-lint-allow
    wrapper.style.borderRadius = 'var(--radius-xs)'; // ui-lint-allow

    const title = document.createElement('div');
    title.style.fontSize = 'var(--text-body-sm)';
    title.style.fontWeight = 'var(--weight-bold)';
    title.style.color = 'color-mix(in srgb, var(--status-danger) 55%, #fff)'; // ui-lint-allow
    title.textContent = `Stage2 规则模块提示：${totalIssues} 条提示`;
    wrapper.appendChild(title);

    const list = document.createElement('ul');
    list.style.margin = '8px 0 0 18px';
    list.style.padding = '0';
    list.style.fontSize = 'var(--text-body-sm)';
    list.style.lineHeight = '1.45';
    list.style.color = 'var(--code-text)'; // ui-lint-allow

    const issues = [...report.fatalErrors, ...report.warnings];
    const limit = 12;
    issues.slice(0, limit).forEach(issue => {
      const li = document.createElement('li');
      li.style.marginBottom = '4px';

      if (issue.moduleId) {
        const tag = document.createElement('span');
        tag.textContent = issue.moduleId;
        tag.style.display = 'inline-block';
        tag.style.padding = '1px 6px';
        tag.style.marginRight = '6px';
        tag.style.borderRadius = 'var(--radius-pill)'; // ui-lint-allow
        tag.style.fontSize = 'var(--text-caption)';
        tag.style.fontWeight = 'var(--weight-bold)';
        tag.style.color = 'color-mix(in srgb, var(--status-danger) 80%, var(--text-primary))'; // ui-lint-allow
        tag.style.background = 'color-mix(in srgb, var(--status-danger) 50%, var(--surface-elevated))'; // ui-lint-allow
        li.appendChild(tag);
      }

      li.appendChild(document.createTextNode(issue.message));
      list.appendChild(li);
    });

    if (issues.length > limit) {
      const li = document.createElement('li');
      li.textContent = `其余 ${issues.length - limit} 条已省略（见调试 payload）。`;
      list.appendChild(li);
    }

    wrapper.appendChild(list);
    return wrapper;
  }

  _updatePhaseIndicator() {
    const indicator = document.getElementById('design-phase-indicator');
    if (!indicator) return;

    const phases = [
      { id: 'p1', name: '框架采集', desc: 'Phase 1' },
      { id: 'p2', name: '自动生成', desc: 'Phase 2' },
      { id: 'p3', name: '审阅编辑', desc: 'Phase 3' },
    ];

    const phaseOrder = ['p1', 'p2', 'p3'];
    const normalizedPhase = this.phase === 'done' ? 'p3' : this.phase;
    const currentIdx = phaseOrder.includes(normalizedPhase)
      ? phaseOrder.indexOf(normalizedPhase)
      : 0;

    const items = phases
      .map((p, i) => {
        const isDone = i < currentIdx;
        const isActive = phaseOrder[i] === normalizedPhase;

        let stepCls = 'dpi-step';
        if (isDone) stepCls += ' dpi-step--done';
        else if (isActive) stepCls += ' dpi-step--active';

        const circle = isDone
          ? `<span class="dpi-circle dpi-circle--done">✓</span>` /* ui-lint-allow */
          : `<span class="dpi-circle${isActive ? ' dpi-circle--active' : ''}">${i + 1}</span>`;

        const connector =
          i < phases.length - 1
            ? `<span class="dpi-line${isDone ? ' dpi-line--done' : ''}"></span>`
            : '';

        return `
                <span class="${stepCls}">
                    ${circle}
                    <span class="dpi-label">${p.name}</span>
                </span>${connector}`;
      })
      .join('');

    indicator.innerHTML = `<div class="dpi-track">${items}</div>`;

    if (this.phase === 'p3' || this.phase === 'done') {
      indicator.innerHTML += '<div class="dpi-p3-badge">Plan Mode · 描述修改需求，AI 生成计划</div>';
    }
  }

}

_applyDesignServiceMixin(_DesignServiceUIMixin);
