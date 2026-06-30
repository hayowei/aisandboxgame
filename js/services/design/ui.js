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
      applyBtn.addEventListener('click', () => {
        // 设计 stage 上 = 导航到预览；预览 stage 上 = 应用到游戏
        const stage = window.stageRouter?.getState?.()?.stage;
        if (stage === 'design') {
          window.stageRouter?.setStage?.('preview');
          return;
        }
        this.applyToGame();
      });
      // 初始化 + 监听 stage / 语言切换以更新按钮文案
      const refresh = () => this._refreshDesignApplyBtnLabel();
      window.eventBus?.on?.('stage:changed', refresh);
      window.addEventListener('ui-language-changed', refresh);
      refresh();
    }

    this._updatePreviewPanel();
  }

  _refreshDesignApplyBtnLabel() {
    const btn = document.getElementById('design-apply-btn');
    if (!btn) return;
    const isEn = (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
    const stage = window.stageRouter?.getState?.()?.stage;
    const onDesignStage = stage === 'design';
    const icon = onDesignStage ? 'arrow_forward' : 'play_arrow';
    const label = onDesignStage
      ? (isEn ? 'Review in preview' : '前往预览确认')
      : (isEn ? 'Apply to Game' : '应用到游戏');
    btn.innerHTML = `<span class="material-symbols-outlined">${icon}</span>${label}`;
  }

  /**
   * Switch visible panel: chat / card / code
   * 老三态 tabs 已拆（stage-router 接管视图切换）；本函数保留——
   * chatCore 程序化调用 _switchDesignView('chat') 做面板显隐 reset。
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
      displayConfig.panel_fields && displayConfig.character_database
        ? this._validateCharacterDatabasePanelConsistency(
            displayConfig.panel_fields,
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
      displayConfig.world_timeline ||
      displayConfig.timeline ||
      displayConfig.character_timelines
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

      // Stage2 校验提示徽标：与代码预览一模一样、共享展开态；徽标插到工具条最左（靠左对齐），
      // 提示面板落在工具条下方。无 issue 时 cardWarnControl 为 null，徽标/面板都不出现。
      const cardWarnControl = this._buildStage2WarnControl(stage2Validation, 'dcv-card-warning-panel');
      if (cardWarnControl) toolbar.insertBefore(cardWarnControl.toggleBtn, toolbar.firstChild);

      card.appendChild(toolbar);

      if (cardWarnControl?.warningPanel) card.appendChild(cardWarnControl.warningPanel);

      // Phase 3 提示栏：拖拽功能已删，统一文案
      if (isPhase3) {
        const hint = document.createElement('div');
        hint.className = 'dcv-drag-hint';
        hint.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">edit</span> 提示：点击「编辑」可直接编辑文本。`; /* ui-lint-allow */
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
          subItems: entities.map(([id, value]) => {
            // V2 entity（对象）/ V1 markdown 字符串分流
            let displayName = '';
            let subtitle = '';
            let previewText = '';
            let rawForExpand = '';
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              // V2：display_name + atmosphere 摘要
              displayName = (typeof value.display_name === 'string' && value.display_name.trim()) || '';
              subtitle = id;
              const atmo = typeof value.atmosphere === 'string' ? value.atmosphere : '';
              previewText = atmo || '（V2 实体）';
              // 派生 markdown 作 expand 视图
              rawForExpand = (typeof window !== 'undefined' && typeof window.renderV2EntityMarkdown === 'function')
                ? window.renderV2EntityMarkdown(value)
                : JSON.stringify(value, null, 2);
            } else if (typeof value === 'string') {
              const nameMatch = value.match(/[-—]{2,}\s*(.+?)\s*[（(]([^/）)]+)/);
              if (nameMatch) {
                displayName = nameMatch[1].trim();
                subtitle = nameMatch[2].trim();
              }
              previewText = value.replace(/\n/g, ' ').slice(0, 72);
              rawForExpand = value;
            } else {
              previewText = '（空）';
              rawForExpand = '（空）';
            }
            return {
              name: id,
              displayName: displayName || id.replace(/_/g, ' '),
              subtitle: subtitle || id,
              preview: previewText.slice(0, 72) || '（空）',
              editTarget: 'world_setting',
              editPath: `settings.${id}`,
              entityId: id,
              expandFields: [
                { label: '原始数据', value: rawForExpand || '（空）' },
              ],
            };
          }),
          isPhase3,
          // 实体增删改现在统一走 P3 对话（老 V2 适配器手动新增已随审阅框架退役；
          // 绝不指回 _showAddModal('world_setting')——那会写 V1 markdown 字符串）。
          onAdd: () => {
            if (typeof showToast === 'function') {
              showToast('想加地点实体？在「设计模式」对话里直接告诉 AI（例如「加一个废弃码头区」）');
            }
          },
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 规则系统（模块列表 + 末项「开场白」）──
      if (displayConfig.prompt_modules) {
        const pm = displayConfig.prompt_modules;
        const modules = pm.modules ? Object.entries(pm.modules) : [];
        const issues = stage2Validation && stage2Validation.fatalErrors.length > 0;
        const moduleSubItems = modules.map(([id, content]) => {
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
            editTarget: 'prompt_modules',
            editPath: `modules.${id}`,
            entityId: id,
            expandFields,
          };
        });

        // 开场白（snapshot.opening_greeting）：Wave 1C 从 prompt_modules 上移到顶层标量；按设计选择
        // 并进「规则系统」卡、作模块列表后的末项。editPath 留空 = 顶层字段本身
        //（_getNestedValue/_setNestedValue 识别空路径直接读写 config[target]）。
        if (typeof displayConfig.opening_greeting === 'string' && displayConfig.opening_greeting.trim()) {
          const og = displayConfig.opening_greeting.trim();
          moduleSubItems.push({
            name: '开场白',
            displayName: '开场白',
            subtitle: `开场白 · ${og.length} 字`,
            preview: og.replace(/\n/g, ' ').slice(0, 72),
            editTarget: 'opening_greeting',
            editPath: '', // 顶层标量：无子路径
            entityId: 'opening_greeting',
            noDelete: true, // 必填字段，不提供删除
            expandFields: [{ label: '全文', value: og }],
          });
        }

        const sectionEl = this._buildCardSection({
          icon: 'rule',
          label: '规则系统',
          summary: pm._summary || '',
          hasBadge: true,
          isOk: !issues,
          warnCount: issues ? stage2Validation.fatalErrors.length : 0,
          subItems: moduleSubItems,
          isPhase3,
          onAdd: () => this._showAddModal('prompt_modules'),
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 法则（V2.1 snapshot.laws：世界层法则，顶层数组）──
      if (Array.isArray(displayConfig.laws)) {
        const laws = displayConfig.laws;
        const sectionEl = this._buildCardSection({
          icon: 'gavel',
          label: '法则',
          isOk: true,
          subItems: laws.map((law, i) => {
            const body = typeof law.body === 'string' ? law.body : '';
            const binding = law.binding ? `【${law.binding}】` : '';
            return {
              name: law.name || law.id || `法则#${i + 1}`,
              subtitle: law.id || '',
              preview: [binding, body.replace(/\n/g, ' ').slice(0, 64)].filter(Boolean).join(' '),
              editTarget: 'laws',
              editPath: `[${i}]`,
              entityId: law.id || law.name,
              expandFields: [
                { label: '约束', value: law.binding || '—' },
                { label: '范围', value: law.scope || '—' },
                { label: '内容', value: body || '（空）' },
              ],
            };
          }),
          isPhase3,
          onAdd: () => {
            if (typeof showToast === 'function') {
              showToast('想加世界法则？在「设计模式」对话里直接告诉 AI（例如「加一条：夜里不能使用法术」）');
            }
          },
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 机制（V2.1 snapshot.mods：可挂记录变量/钩子的机制，顶层数组）──
      if (Array.isArray(displayConfig.mods)) {
        const mods = displayConfig.mods;
        const sectionEl = this._buildCardSection({
          icon: 'extension',
          label: '机制',
          isOk: true,
          subItems: mods.map((mod, i) => {
            const prose = typeof mod.prose === 'string' ? mod.prose : '';
            const varCount = Array.isArray(mod.owns_vars) ? mod.owns_vars.length : 0;
            return {
              name: mod.name || mod.id || (mod.ref ? `引用 ${mod.ref}` : `机制#${i + 1}`),
              subtitle: mod.id || '',
              preview:
                (prose.replace(/\n/g, ' ').slice(0, 64) || (mod.ref ? `官方引用：${mod.ref}` : '')),
              editTarget: 'mods',
              editPath: `[${i}]`,
              entityId: mod.id || mod.name,
              expandFields: [
                { label: '说明', value: prose || (mod.ref ? `官方机制引用：${mod.ref}` : '（空）') },
                ...(varCount
                  ? [{ label: '记录变量', value: JSON.stringify(mod.owns_vars, null, 2) }]
                  : []),
                ...(mod.hooks ? [{ label: '钩子', value: JSON.stringify(mod.hooks, null, 2) }] : []),
              ],
            };
          }),
          isPhase3,
          onAdd: () => {
            if (typeof showToast === 'function') {
              showToast('想加机制？在「设计模式」对话里直接告诉 AI（例如「加一个潜行检定机制」）');
            }
          },
        });
        card.appendChild(sectionEl);
        allSections.push(sectionEl);
      }

      // ── 关键道具（V2.1 snapshot.artifacts：authored 顶层关键道具，区别于通用背包）──
      if (Array.isArray(displayConfig.artifacts)) {
        const artifacts = displayConfig.artifacts;
        const sectionEl = this._buildCardSection({
          icon: 'diamond',
          label: '关键道具',
          isOk: true,
          subItems: artifacts.map((art, i) => {
            const desc = typeof art.desc === 'string' ? art.desc : '';
            // artifact.location 是自由文本（物品去向，可"在某人身上"/虚拟/方位未明）——刻意【不】三段化。
            // 仅作显示兼容：万一作者写成三段对象就格式化，字符串原样显示。
            const artLoc = (art.location && typeof art.location === 'object')
              ? (window.locationTriad ? window.locationTriad.formatEventLocation(art.location) : '')
              : (typeof art.location === 'string' ? art.location : '');
            const meta = [
              art.owner ? `持有：${art.owner}` : '',
              artLoc ? `位置：${artLoc}` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return {
              name: art.name || art.id || `道具#${i + 1}`,
              subtitle: art.id || '',
              preview: [desc.replace(/\n/g, ' ').slice(0, 56), meta].filter(Boolean).join(' — '),
              editTarget: 'artifacts',
              editPath: `[${i}]`,
              entityId: art.id || art.name,
              expandFields: [
                { label: '描述', value: desc || '（空）' },
                ...(art.owner ? [{ label: '持有者', value: String(art.owner) }] : []),
                ...(artLoc ? [{ label: '位置', value: artLoc }] : []),
                ...(art.attrs ? [{ label: '属性', value: JSON.stringify(art.attrs, null, 2) }] : []),
              ],
            };
          }),
          isPhase3,
          onAdd: () => {
            if (typeof showToast === 'function') {
              showToast('想加关键道具？在「设计模式」对话里直接告诉 AI（例如「加一把祖传的渡口钥匙」）');
            }
          },
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

      // ── 时间线（新字段 world_timeline；老卡 timeline 兜底） ──
      if (displayConfig.world_timeline || displayConfig.timeline) {
        const tl = displayConfig.world_timeline || displayConfig.timeline;
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
              editTarget: 'world_timeline',
              editPath: `events[${originalIndex}]`,
              entityId: `事件#${displayIndex + 1}`,
            };
          }),
          isPhase3,
          onAdd: () => this._showAddModal('world_timeline'),
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
      const warnControl = this._buildStage2WarnControl(stage2Validation, 'dcv-code-warning-panel');
      const warningPanel = warnControl ? warnControl.warningPanel : null;
      const cognitiveWarningPanel = this._buildCognitiveSemanticWarningPanel(
        cognitiveSemanticsValidation
      );

      // 可编辑 JSON 数据（排除派生字段）
      const codeData = { ...displayConfig };

      // ── 头部工具条：搜索栏（左，撑开）+ 操作按钮（右）。布局全走 CSS（.dcv-code-toolbar）──
      const toolbar = document.createElement('div');
      toolbar.className = 'dcv-code-toolbar';

      // 搜索栏（恒深色代码面板上用 sheen 叠白做输入框）
      const searchBar = document.createElement('div');
      searchBar.className = 'dcv-code-search';
      const searchIcon = document.createElement('span');
      searchIcon.className = 'material-symbols-outlined dcv-code-search-icon';
      searchIcon.textContent = 'search';
      const searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.className = 'dcv-code-search-input';
      searchInput.placeholder = '搜索 JSON…';
      searchInput.spellcheck = false;
      const searchCount = document.createElement('span');
      searchCount.className = 'dcv-code-search-count';
      const searchPrev = document.createElement('button');
      searchPrev.className = 'dcv-code-search-nav';
      searchPrev.title = '上一个匹配';
      searchPrev.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_up</span>';
      const searchNext = document.createElement('button');
      searchNext.className = 'dcv-code-search-nav';
      searchNext.title = '下一个匹配';
      searchNext.innerHTML = '<span class="material-symbols-outlined">keyboard_arrow_down</span>';
      searchBar.appendChild(searchIcon);
      searchBar.appendChild(searchInput);
      searchBar.appendChild(searchCount);
      searchBar.appendChild(searchPrev);
      searchBar.appendChild(searchNext);
      toolbar.appendChild(searchBar);

      // Stage2 提示折叠徽标：平时收进工具条只显示「⚠ 数量」，点开才在下面展开完整提示。
      // 徽标 + 面板由 _buildStage2WarnControl 统一构建（卡片式预览同款、共享展开态）。
      if (warnControl) toolbar.appendChild(warnControl.toggleBtn);

      // 只读模式按钮
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-secondary';
      editBtn.innerHTML =
        '<span class="material-symbols-outlined">edit</span><span class="dcv-act-label">编辑</span>';

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
      btnGroup.className = 'dcv-code-actions';
      btnGroup.appendChild(editBtn);
      btnGroup.appendChild(saveBtn);
      btnGroup.appendChild(resetBtn);
      toolbar.appendChild(btnGroup);

      codePanel.appendChild(toolbar);

      // Stage2 校验提示：整宽落在工具条下面（默认收起，由工具条「⚠」徽标展开；初始态已在 helper 内设好）
      if (warningPanel) codePanel.appendChild(warningPanel);

      if (cognitiveWarningPanel) {
        cognitiveWarningPanel.style.flexShrink = '0';
        codePanel.appendChild(cognitiveWarningPanel);
      }

      // ── 可编辑 textarea ──
      const textarea = document.createElement('textarea');
      textarea.id = 'design-code-editor';
      // 静态样式全部走 CSS（.design-code-editor），让 @container 查询能在窄屏/侧栏下
      // 切到自动换行 + 放大字号，无需 inline !important 覆盖。
      textarea.className = 'design-code-editor';
      textarea.spellcheck = false;
      textarea._dirty = false;
      textarea._latestCodeData = codeData;
      textarea.value = JSON.stringify(codeData, null, 2);
      codePanel.appendChild(textarea);

      // ── Monaco 懒升级配套：访问层统一走 _readJsonText / _writeJsonText ──
      // textarea 作 fallback 一直在场；Monaco load 成功后 swap-in，textarea 隐藏。
      let _monacoEditor = null;
      const _readJsonText = () => _monacoEditor ? _monacoEditor.getValue() : textarea.value;
      const _writeJsonText = (v) => {
        if (_monacoEditor) _monacoEditor.setValue(v);
        else textarea.value = v;
      };

      // ── 搜索：Monaco 走 findMatches；textarea 走 indexOf + 镜像 div 量位置（兼容自动换行）。
      //    两条路都自己驱动——慢网手机常落到 textarea，而 textarea 原生没有任何搜索。──
      const _searchState = { idx: -1 };
      const _collectMatches = (q) => {
        if (!q) return [];
        if (_monacoEditor) {
          const model = _monacoEditor.getModel();
          if (!model) return [];
          // findMatches(query, searchOnlyEditableRange, isRegex, matchCase, wordSeparators, captureMatches)
          return model.findMatches(q, false, false, false, null, false).map(m => ({ range: m.range }));
        }
        const hay = textarea.value.toLowerCase();
        const needle = q.toLowerCase();
        const out = [];
        let i = hay.indexOf(needle);
        while (i !== -1 && out.length < 5000) {
          out.push({ start: i, end: i + needle.length });
          i = hay.indexOf(needle, i + needle.length);
        }
        return out;
      };
      // textarea 滚动到匹配点：用同款样式的镜像 div 量出 y 像素，开启自动换行后仍准
      const _scrollTextareaToOffset = (offset) => {
        const cs = window.getComputedStyle(textarea);
        const mirror = document.createElement('div');
        [
          'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
          'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
          'whiteSpace', 'overflowWrap', 'wordBreak', 'tabSize', 'boxSizing',
        ].forEach(p => { mirror.style[p] = cs[p]; });
        mirror.style.position = 'absolute';
        mirror.style.visibility = 'hidden';
        mirror.style.top = '0';
        mirror.style.left = '-9999px';
        mirror.style.width = textarea.clientWidth + 'px';
        mirror.style.height = 'auto';
        mirror.appendChild(document.createTextNode(textarea.value.slice(0, offset)));
        const marker = document.createElement('span');
        marker.textContent = '​';
        mirror.appendChild(marker);
        document.body.appendChild(mirror);
        const y = marker.offsetTop;
        document.body.removeChild(mirror);
        textarea.scrollTop = Math.max(0, y - textarea.clientHeight / 2);
      };
      const _revealMatch = (m) => {
        if (!m) return;
        if (_monacoEditor && m.range) {
          _monacoEditor.setSelection(m.range);
          _monacoEditor.revealRangeInCenter(m.range);
        } else if (m.start != null) {
          // 不抢焦点：focus() 会把焦点从搜索框拉到 textarea，导致只能输入一个字符
          //（编辑态下还会把按键打进 JSON）。setSelectionRange + scrollTop 无需焦点即可定位，
          // 未聚焦时选区渲染成灰色 inactive 高亮，仍可见。
          textarea.setSelectionRange(m.start, m.end);
          _scrollTextareaToOffset(m.start);
        }
      };
      const _runSearch = (dir) => {
        const q = searchInput.value.trim();
        const matches = _collectMatches(q);
        if (!matches.length) {
          _searchState.idx = -1;
          searchCount.textContent = q ? '0' : '';
          return;
        }
        if (dir === 'reset' || _searchState.idx < 0) {
          _searchState.idx = 0;
        } else if (dir === 'next') {
          _searchState.idx = (_searchState.idx + 1) % matches.length;
        } else if (dir === 'prev') {
          _searchState.idx = (_searchState.idx - 1 + matches.length) % matches.length;
        }
        if (_searchState.idx >= matches.length) _searchState.idx = 0;
        _revealMatch(matches[_searchState.idx]);
        searchCount.textContent = (_searchState.idx + 1) + '/' + matches.length;
      };
      // isComposing 守卫 + compositionend：中文拼音输入法在选字过程中会连发 input，
      // 跳过中途的半成品，只在落字后搜一次。
      searchInput.addEventListener('input', e => {
        if (e.isComposing) return;
        _runSearch('reset');
      });
      searchInput.addEventListener('compositionend', () => _runSearch('reset'));
      searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          _runSearch(e.shiftKey ? 'prev' : 'next');
        } else if (e.key === 'Escape') {
          searchInput.value = '';
          _runSearch('reset');
        }
      });
      searchPrev.addEventListener('click', () => _runSearch('prev'));
      searchNext.addEventListener('click', () => _runSearch('next'));

      // 模式切换：isEdit=true 为编辑模式，false 为只读模式
      const setMode = isEdit => {
        textarea.readOnly = !isEdit;
        textarea.style.cursor = isEdit ? 'text' : 'default';
        textarea.style.caretColor = isEdit ? 'var(--text-secondary)' : 'transparent'; // ui-lint-allow
        if (_monacoEditor) _monacoEditor.updateOptions({ readOnly: !isEdit });
        editBtn.style.display = isEdit ? 'none' : '';
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
          if (_monacoEditor) _monacoEditor.focus();
          else textarea.focus();
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
          parsed = JSON.parse(_readJsonText());
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
        const fresh = JSON.stringify(textarea._latestCodeData || codeData, null, 2);
        _writeJsonText(fresh);
        textarea._dirty = false;
        setMode(false);
      });

      // ── Monaco 编辑器懒升级（CDN，失败静默回退到 textarea，零阻塞）──
      if (window.P3MonacoLoader && typeof window.P3MonacoLoader.load === 'function') {
        window.P3MonacoLoader.load().then((monaco) => {
          const host = document.createElement('div');
          host.id = 'design-code-editor-monaco';
          host.style.cssText = 'flex:1;width:100%;min-height:0;overflow:hidden;';
          textarea.parentNode.insertBefore(host, textarea);
          textarea.style.display = 'none';
          const theme = (document.documentElement.getAttribute('data-theme') === 'dark')
            ? 'vs-dark' : 'vs';
          // 窄屏/侧栏（pane ≤ 480px）放大字号，与 textarea fallback 的 @container 规则同向放大，
          // 手机上读 JSON 不再费劲。Monaco 本就 wordWrap:'on' 自动换行、无水平滚动；
          // wrappingIndent:'indent' 让折行后的续行保持缩进，深层嵌套的世界卡 JSON 不至于读乱。
          // 窄屏额外：隐藏行号 + 收掉左侧装订线/折叠列，把横向空间全留给代码
          //（手机上深层嵌套 JSON 不再被左侧 gutter 挤得拼命换行）。
          const _narrowOpts = narrow => ({
            fontSize: narrow ? 15 : 13,
            lineHeight: narrow ? 22 : 0, // 0 = Monaco 按字号自动算行高
            lineNumbers: narrow ? 'off' : 'on',
            lineNumbersMinChars: narrow ? 0 : 5,
            lineDecorationsWidth: narrow ? 0 : 10,
            folding: !narrow,
          });
          let _isNarrowPane = host.clientWidth > 0 && host.clientWidth <= 480;
          _monacoEditor = monaco.editor.create(host, {
            value: textarea.value,
            language: 'json',
            theme,
            automaticLayout: true,
            minimap: { enabled: false },
            wordWrap: 'on',
            wrappingIndent: 'indent',
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            readOnly: textarea.readOnly,
            readOnlyMessage: { value: '只读模式下无法编辑，点击上方「编辑」按钮即可修改' },
            ..._narrowOpts(_isNarrowPane),
          });
          _monacoEditor.onDidChangeModelContent(() => {
            textarea._dirty = true;
          });
          // 字号随 pane 宽度实时跟随（主↔侧栏 reparent / 手机旋转跨 480px 边界时），
          // 与 textarea fallback 的 @container 查询行为对齐。automaticLayout 只管尺寸不管字号。
          if (typeof ResizeObserver === 'function') {
            const ro = new ResizeObserver(() => {
              const narrow = host.clientWidth > 0 && host.clientWidth <= 480;
              if (narrow !== _isNarrowPane) {
                _isNarrowPane = narrow;
                _monacoEditor.updateOptions(_narrowOpts(narrow));
              }
            });
            ro.observe(host);
          }
        }).catch((err) => {
          console.warn('[design/ui] Monaco load failed, falling back to textarea:', err);
        });
      }
    }
  }
  // ──（角色卡牌审阅框架已随老 P2 流程退役，2026-06-10 PZWC 替换时拆除）──

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
   * @param {Array} opts.subItems - 子项数组 [{name, preview}]
   * @param {boolean} opts.isPhase3 - 是否处于 Phase 3（影响拖拽启用）
   */
  _buildCardSection({
    icon,
    label,
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

    const countBadge =
      subItems.length > 0 ? `<span class="dcv-count-badge">${subItems.length}</span>` : '';

    const fnTagHtml = headerAnnotation ? `<span class="dcv-fn-tag">${headerAnnotation}</span>` : '';

    const addBtnHtml =
      isPhase3 && onAdd
        ? `<span class="dcv-header-add" data-action="dcv-header-add-btn" title="新增">` +
          `<span class="material-symbols-outlined dcv-header-add-icon">add_circle</span>` +
          `<span class="dcv-header-add-label">新增</span></span>`
        : '';

    header.innerHTML = `
            <span class="material-symbols-outlined dcv-icon">${icon}</span>
            <span class="dcv-label">${label}</span>
            ${fnTagHtml}
            ${countBadge}
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
          annotation,
          editTarget,
          editPath,
          entityId,
          expandFields,
          noDelete,
        }) => {
          const item = document.createElement('div');
          item.className = 'dcv-subitem';
          let expandBtn = null;
          let actionsBar = null;

          item.title = '点击查看全文';

          // ── 操作按键（Phase 3）──
          if (isPhase3) {
            actionsBar = document.createElement('div');
            actionsBar.className = 'dcv-subitem-actions';

            // 删除
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-secondary btn-danger';
            deleteBtn.title = '删除';
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
            editBtn.title = '编辑';
            editBtn.innerHTML =
              '<span class="material-symbols-outlined">edit</span><span class="dcv-act-label">编辑</span>';
            editBtn.addEventListener('click', e => {
              e.stopPropagation();
              if (editTarget && editPath != null) this._showEditModal(name, editTarget, editPath);
            });

            // 展开/收起
            expandBtn = document.createElement('button');
            expandBtn.className = 'btn-secondary btn-ghost';
            expandBtn.title = '展开';
            expandBtn.innerHTML =
              '<span class="material-symbols-outlined">unfold_more</span><span class="dcv-act-label">展开</span>';
            expandBtn.addEventListener('click', e => {
              e.stopPropagation();
              const isExpanded = item.classList.toggle('dcv-subitem--expanded');
              expandBtn.title = isExpanded ? '收起' : '展开';
              expandBtn.innerHTML = isExpanded
                ? '<span class="material-symbols-outlined">unfold_less</span><span class="dcv-act-label">收起</span>'
                : '<span class="material-symbols-outlined">unfold_more</span><span class="dcv-act-label">展开</span>';
            });

            if (!noDelete) actionsBar.appendChild(deleteBtn);
            actionsBar.appendChild(editBtn);
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

          // 拖动图标已删（拖卡到输入框的功能废弃）

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
    // 默认全部收起；用 label 记住用户展开过的区块，重建（编辑/删除后 _updatePreviewPanel
    // 整树 innerHTML='' 重建）时保留展开态，避免编辑一下就被打回全收起。
    if (!this._expandedSectionLabels) this._expandedSectionLabels = new Set();
    let sectionCollapsed = !this._expandedSectionLabels.has(label);

    const collapseSection = () => {
      sectionCollapsed = true;
      this._expandedSectionLabels.delete(label);
      body.classList.add('dcv-section-body--collapsed');
      const icon = header.querySelector('.dcv-collapse-icon');
      if (icon) icon.textContent = 'chevron_right';
      section.classList.add('dcv-section--collapsed');
    };

    const expandSection = () => {
      sectionCollapsed = false;
      this._expandedSectionLabels.add(label);
      body.classList.remove('dcv-section-body--collapsed');
      const icon = header.querySelector('.dcv-collapse-icon');
      if (icon) icon.textContent = 'expand_more';
      section.classList.remove('dcv-section--collapsed');
    };

    // 应用初始折叠态（默认收起；header 模板里 icon 默认是 expand_more，收起时改成 chevron_right）
    if (sectionCollapsed) {
      body.classList.add('dcv-section-body--collapsed');
      const collapseIcon = header.querySelector('.dcv-collapse-icon');
      if (collapseIcon) collapseIcon.textContent = 'chevron_right';
      section.classList.add('dcv-section--collapsed');
    }

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

  /**
   * 把校验提示面板（Stage2 / 认知语义）做成可点击热区：点面板 → 切到设计对话 → p3Service.fixIssues。
   * 仅在 phase==='p3'、非 V1 锁卡、有 p3Service 时挂载（否则面板照常只展示提示，不可点）。
   * cursor / hover 高亮走 CSS（.is-fixable）——Stage2 面板背景已从内联挪到 .dcv-code-warning 规则，
   * 故 :hover 能生效；这里只挂 class / 语义属性 / CTA / 点击行为。
   */
  _makeWarningPanelFixable(wrapper, issueMessages) {
    const msgs = (issueMessages || []).map(m => String(m ?? '').trim()).filter(Boolean);
    if (!wrapper || msgs.length === 0) return;
    if (!window.p3Service) return;
    if (window.designService?.phase !== 'p3') return;
    try {
      if (window.p3Service._shouldGateAsV1?.(window.designService)) return;
    } catch (_) { /* defensive */ }

    wrapper.classList.add('is-fixable');
    wrapper.setAttribute('role', 'button');
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('aria-label', '点击让 AI 帮我修这些问题');

    // 底部 CTA 提示行（纯中文，与面板一致）
    const hint = document.createElement('div');
    hint.className = 'dcv-warning-fix-hint';
    hint.innerHTML =
      '<span class="material-symbols-outlined">auto_fix_high</span>' +
      '<span>点击此面板，让 AI 帮我一键修复</span>';
    wrapper.appendChild(hint);

    const trigger = () => {
      // 用户正在「本面板内」选中/复制文字时不触发（只看落在本面板里的选区，
      // 避免页面别处的残留选区把这次点击误吞掉）
      try {
        const sel = window.getSelection?.();
        if (sel && sel.toString().trim() && sel.anchorNode && wrapper.contains(sel.anchorNode)) return;
      } catch (_) { /* defensive */ }
      // AI 忙碌时不抢舞台，给提示
      if (window.p3Service?.busy) {
        try { window.showToast?.('AI 正在处理中，请稍候', 'warning', 2000); } catch (_) { /* defensive */ }
        return;
      }
      const runFix = () => {
        try { window.stageRouter?.setStage?.('design'); } catch (_) { /* defensive */ }
        try { window.p3Service?.fixIssues?.(msgs); }
        catch (e) { console.error('[design/ui] fixIssues failed:', e); }
      };
      // 确认弹窗（走项目统一 showConfirmModal，不用系统原生弹窗）
      if (typeof window.showConfirmModal === 'function') {
        window.showConfirmModal(
          '一键修复',
          '是否进入设计模式来一键修复？',
          runFix,
          null,
          { icon: 'auto_fix_high', confirmLabel: '进入修复' }
        );
      } else {
        runFix();
      }
    };
    wrapper.addEventListener('click', trigger);
    wrapper.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); trigger(); }
    });
  }

  /**
   * 把当前已挂载的两处 Stage2 徽标 + 面板（代码/卡片）一起同步到 this._codeWarningExpanded。
   * 双 pane（主+侧）下二者可能同时可见，单点一个徽标也要让另一个跟着动 → 真正「同步」。
   */
  _syncWarnToggles() {
    const on = this._codeWarningExpanded === true;
    // 排除 .is-ok（无报错静态徽标，无折叠面板，不参与展开同步）
    document.querySelectorAll('.dcv-code-warn-toggle:not(.is-ok)').forEach(btn => {
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
    ['dcv-code-warning-panel', 'dcv-card-warning-panel'].forEach(id => {
      const p = document.getElementById(id);
      if (p) p.style.display = on ? '' : 'none';
    });
  }

  /**
   * 构建 Stage2 校验提示的「折叠徽标 + 提示面板」一组，徽标与面板共享 this._codeWarningExpanded 展开态。
   * 代码预览 / 卡片式预览各调一次（panelId 不同）→ 两处徽标外观/计数/展开态一模一样且同步。
   * @returns {{ toggleBtn: HTMLElement, warningPanel: HTMLElement } | null} 无 issue 时返回 null。
   */
  _buildStage2WarnControl(stage2Validation, panelId) {
    // 没跑校验（无 prompt_modules）→ 不显示任何徽标
    if (!stage2Validation) return null;
    const fatalCount = stage2Validation?.fatalErrors?.length || 0;
    const warnCount = fatalCount + (stage2Validation?.warnings?.length || 0);

    // 无报错：静态「✓ 无报错」徽标（不可点、无面板）。代码 / 卡片两处都显示。
    if (warnCount === 0) {
      const okBtn = document.createElement('span');
      okBtn.className = 'dcv-code-warn-toggle is-ok';
      okBtn.title = 'Stage2 规则模块校验通过';
      okBtn.setAttribute('aria-label', 'Stage2 校验：无报错');
      okBtn.innerHTML =
        '<span class="material-symbols-outlined">check_circle</span>' +
        '<span class="dcv-code-warn-count">无报错</span>';
      return { toggleBtn: okBtn, warningPanel: null };
    }

    // 有报错：可折叠徽标 + 提示面板
    const warningPanel = this._buildPromptModuleWarningPanel(stage2Validation);
    if (!warningPanel) return null;
    warningPanel.id = panelId;
    // 首次默认收起；用户手动切过后尊重其选择（确定布尔值，跨重渲染保持）。
    if (this._codeWarningExpanded === undefined) this._codeWarningExpanded = false;

    const hasFatal = fatalCount > 0;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'dcv-code-warn-toggle' + (hasFatal ? '' : ' is-soft');
    toggleBtn.title = 'Stage2 规则模块提示';
    toggleBtn.setAttribute('aria-controls', panelId);
    toggleBtn.setAttribute('aria-label', 'Stage2 校验提示，' + warnCount + ' 条');
    toggleBtn.innerHTML =
      '<span class="material-symbols-outlined">' + (hasFatal ? 'error' : 'warning') + '</span>' +
      '<span class="dcv-code-warn-count">' + warnCount + '</span>' +
      '<span class="material-symbols-outlined dcv-code-warn-chevron">expand_more</span>';

    const applyState = () => {
      const on = this._codeWarningExpanded === true;
      warningPanel.style.display = on ? '' : 'none';
      toggleBtn.classList.toggle('is-active', on);
      toggleBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
    };
    toggleBtn.addEventListener('click', () => {
      this._codeWarningExpanded = !(this._codeWarningExpanded === true);
      // 同步两处（代码/卡片）徽标 + 面板——双 pane 下二者可能同时可见，不能只更新自己
      this._syncWarnToggles();
    });
    applyState(); // 初始态：此刻面板还未挂进 DOM，用闭包直接设（_syncWarnToggles 靠 DOM 查询，挂载后才有效）
    return { toggleBtn, warningPanel };
  }

  _buildPromptModuleWarningPanel(report) {
    if (!report) return null;
    const totalIssues = report.fatalErrors.length + report.warnings.length;
    if (totalIssues === 0) return null;

    const wrapper = document.createElement('div');
    // 布局/外边距走 class（.dcv-code-warning），由头部 CSS 按宽屏/窄屏分别控制
    wrapper.className = 'dcv-code-warning';
    wrapper.style.padding = '10px 12px';
    wrapper.style.border = '1px solid color-mix(in srgb, var(--status-danger) 70%, transparent)'; // ui-lint-allow
    // 背景挪到 .dcv-code-warning CSS 规则（不再内联）——好让 .is-fixable:hover 能覆盖
    wrapper.style.borderRadius = 'var(--radius-xs)'; // ui-lint-allow

    const title = document.createElement('div');
    // 字号走 class（.dcv-code-warning-title），让窄屏 @container 能一并放大
    title.className = 'dcv-code-warning-title';
    title.style.fontWeight = 'var(--weight-bold)';
    title.style.color = 'var(--status-danger)';
    title.textContent = `Stage2 规则模块提示：${totalIssues} 条提示`;
    wrapper.appendChild(title);

    const list = document.createElement('ul');
    list.className = 'dcv-code-warning-list';
    list.style.margin = '8px 0 0 18px';
    list.style.padding = '0';
    list.style.lineHeight = '1.45';
    list.style.color = 'var(--text-main)';

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
    // 可点击热区：把全部 issue（含截断的）原文 + moduleId 前缀交给 P3 修
    this._makeWarningPanelFixable(
      wrapper,
      issues.map(i => (i.moduleId ? i.moduleId + '：' : '') + i.message)
    );
    return wrapper;
  }

  _updatePhaseIndicator() {
    const indicator = document.getElementById('design-phase-indicator');
    if (!indicator) return;

    // PZWC 三拍：描述世界（pzwc 等待 brief/问答）→ 自动建造（pzwc 引擎跑）→ 编辑精修（p3）
    const phases = [
      { id: 'describe', name: '描述世界', desc: 'Describe' },
      { id: 'build', name: '自动建造', desc: 'Build' },
      { id: 'p3', name: '编辑精修', desc: 'Refine' },
    ];

    const phaseOrder = ['describe', 'build', 'p3'];
    const building = !!window.pzwcDesignController?.isBuilding?.();
    const normalizedPhase =
      this.phase === 'done' || this.phase === 'p3'
        ? 'p3'
        : building
          ? 'build'
          : 'describe';
    const currentIdx = phaseOrder.indexOf(normalizedPhase);

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
  }

}

_applyDesignServiceMixin(_DesignServiceUIMixin);
