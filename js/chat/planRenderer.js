/**
 * PlanRenderer - Plan Mode 渲染模块
 * 用简洁的 checklist 替代复杂的 diff 卡片
 * 支持逐项勾选、展开预览、一键执行
 */
(function () {
  'use strict';

  const { P3DiffEngine } = window;

  /**
   * 渲染 plan panel
   * @param {Array} enrichedOps - enriched 操作数组
   * @param {HTMLElement} containerEl - 插入目标容器
   * @param {Object} options
   * @param {boolean} options.streaming - 是否处于流式阶段
   * @param {boolean} options.canUndo
   * @param {Function} options.onToggle - checkbox 切换 (opId, checked)
   * @param {Function} options.onToggleAll - 全选/全不选 (checked)
   * @param {Function} options.onApply - 执行计划
   * @param {Function} options.onUndo - 撤销
   */
  function renderPlanPanel(enrichedOps, containerEl, options = {}) {
    // 检测完成态
    const allTerminal = enrichedOps.every(op =>
      op.status === 'applied' || op.status === 'rejected' || op.status === 'undone' || op.status === 'skipped'
    );
    const appliedCount = enrichedOps.filter(op => op.status === 'applied').length;
    if (allTerminal && appliedCount > 0 && !options.streaming) {
      return renderCompletionPanel(enrichedOps, containerEl, options);
    }

    const panel = document.createElement('div');
    panel.className = 'plan-panel';
    panel.dataset.planPanel = 'true';
    if (options.streaming) panel.classList.add('plan-streaming');

    // Header
    const header = renderHeader(enrichedOps, options);
    panel.appendChild(header);

    // Items
    const list = document.createElement('div');
    list.className = 'plan-list';
    for (const op of enrichedOps) {
      const item = renderPlanItem(op, options);
      list.appendChild(item);
    }
    panel.appendChild(list);

    // Footer
    const footer = renderFooter(enrichedOps, options);
    panel.appendChild(footer);

    // 事件委托
    setupEventDelegation(panel, enrichedOps, options);

    // 替换或追加
    const existing = containerEl.querySelector('[data-plan-panel]');
    if (existing) {
      existing.replaceWith(panel);
    } else {
      containerEl.appendChild(panel);
    }

    return panel;
  }

  /**
   * 渲染 header
   */
  function renderHeader(enrichedOps, options) {
    const header = document.createElement('div');
    header.className = 'plan-header';

    const title = document.createElement('span');
    title.className = 'plan-title';
    const applied = enrichedOps.filter(op => op.status === 'applied').length;
    title.textContent = applied > 0
      ? `修改计划 (${applied}/${enrichedOps.length} 已应用)`
      : `修改计划 (${enrichedOps.length} 项)`;
    header.appendChild(title);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    header.appendChild(spacer);

    // 全选 checkbox
    const allAccepted = enrichedOps.every(op =>
      op.status === 'accepted' || op.status === 'applied' || op.status === 'undone'
    );
    const selectAllLabel = document.createElement('label');
    selectAllLabel.className = 'plan-select-all';

    const selectAllCb = document.createElement('input');
    selectAllCb.type = 'checkbox';
    selectAllCb.checked = allAccepted;
    selectAllCb.dataset.planAction = 'toggle-all';
    if (options.streaming) selectAllCb.disabled = true;
    selectAllLabel.appendChild(selectAllCb);

    const selectAllText = document.createElement('span');
    selectAllText.textContent = '全选';
    selectAllLabel.appendChild(selectAllText);

    header.appendChild(selectAllLabel);

    return header;
  }

  /**
   * 渲染单个 plan item
   */
  function renderPlanItem(op, options) {
    const item = document.createElement('div');
    item.className = `plan-item ${op.status}`;
    item.dataset.opId = op.id;

    const isInteractive = op.status !== 'applied' && op.status !== 'undone' && op.status !== 'skipped';
    const isDisabled = options.streaming || !isInteractive;

    // Checkbox
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'plan-item-cb';
    cb.checked = op.status === 'accepted' || op.status === 'applied';
    cb.dataset.planAction = 'toggle';
    cb.dataset.opId = op.id;
    if (isDisabled) cb.disabled = true;
    item.appendChild(cb);

    // Action 图标
    const icon = document.createElement('span');
    icon.className = `plan-item-icon ${op.action}`;
    icon.textContent = op.action === 'update' ? '\u270E' : op.action === 'add' ? '+' : '\u2212';
    item.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'plan-item-label';
    label.textContent = op.displayLabel;
    item.appendChild(label);

    // 验证警告图标
    if (op._validationIssues?.length > 0) {
      const warn = document.createElement('span');
      warn.className = 'plan-item-warning';
      warn.title = op._validationIssues.map(i => i.message).join('\n');
      warn.textContent = '\u26A0';
      item.appendChild(warn);
    }

    // skipped 状态原因
    if (op.status === 'skipped') {
      item.dataset.skipReason = op._skipReason || '已跳过';
    }

    // 展开箭头
    const chevron = document.createElement('span');
    chevron.className = 'plan-item-chevron';
    chevron.dataset.planAction = 'toggle-preview';
    chevron.dataset.opId = op.id;
    chevron.textContent = '\u25B8'; // ▸
    item.appendChild(chevron);

    // 预览区域（默认折叠）
    const preview = renderPreview(op);
    preview.classList.add('collapsed');
    item.appendChild(preview);

    return item;
  }

  /**
   * 渲染预览内容
   */
  function renderPreview(op) {
    const preview = document.createElement('div');
    preview.className = 'plan-preview';

    const previewData = P3DiffEngine.getPreviewData(op);
    if (!previewData) {
      preview.innerHTML = '<span class="plan-preview-empty">无变化</span>';
      return preview;
    }

    const { oldText, newText, action, isLong } = previewData;

    if (action === 'delete') {
      // 删除：只显示旧值
      const block = document.createElement('div');
      block.className = 'plan-preview-block delete';
      const blockLabel = document.createElement('div');
      blockLabel.className = 'plan-preview-label';
      blockLabel.textContent = '将删除:';
      block.appendChild(blockLabel);
      const content = document.createElement('div');
      content.className = 'plan-preview-content';
      content.textContent = oldText;
      block.appendChild(content);
      preview.appendChild(block);
    } else if (action === 'add') {
      // 新增：只显示新值
      const block = document.createElement('div');
      block.className = 'plan-preview-block add';
      const blockLabel = document.createElement('div');
      blockLabel.className = 'plan-preview-label';
      blockLabel.textContent = '新增内容:';
      block.appendChild(blockLabel);
      const content = document.createElement('div');
      content.className = 'plan-preview-content';
      content.textContent = newText;
      block.appendChild(content);
      preview.appendChild(block);
    } else {
      // 更新：显示修改前/修改后
      if (!isLong) {
        // 短文本 inline
        const row = document.createElement('div');
        row.className = 'plan-preview-inline';
        if (oldText) {
          const oldSpan = document.createElement('span');
          oldSpan.className = 'plan-preview-old';
          oldSpan.textContent = oldText;
          row.appendChild(oldSpan);
        }
        if (oldText && newText) {
          const arrow = document.createElement('span');
          arrow.className = 'plan-preview-arrow';
          arrow.textContent = '\u2192';
          row.appendChild(arrow);
        }
        if (newText) {
          const newSpan = document.createElement('span');
          newSpan.className = 'plan-preview-new';
          newSpan.textContent = newText;
          row.appendChild(newSpan);
        }
        preview.appendChild(row);
      } else {
        // 长文本：修改前/修改后两块
        if (oldText) {
          const oldBlock = document.createElement('div');
          oldBlock.className = 'plan-preview-block before';
          const oldLabel = document.createElement('div');
          oldLabel.className = 'plan-preview-label';
          oldLabel.textContent = '修改前:';
          oldBlock.appendChild(oldLabel);
          const oldContent = document.createElement('div');
          oldContent.className = 'plan-preview-content';
          oldContent.textContent = truncateText(oldText, 200);
          oldBlock.appendChild(oldContent);
          if (oldText.length > 200) {
            const expand = document.createElement('button');
            expand.className = 'plan-preview-expand btn-ghost';
            expand.textContent = '展开全部';
            expand.dataset.planAction = 'expand-text';
            expand.dataset.fullText = oldText;
            oldBlock.appendChild(expand);
          }
          preview.appendChild(oldBlock);
        }

        if (newText) {
          const newBlock = document.createElement('div');
          newBlock.className = 'plan-preview-block after';
          const newLabel = document.createElement('div');
          newLabel.className = 'plan-preview-label';
          newLabel.textContent = '修改后:';
          newBlock.appendChild(newLabel);
          const newContent = document.createElement('div');
          newContent.className = 'plan-preview-content';
          newContent.textContent = truncateText(newText, 200);
          newBlock.appendChild(newContent);
          if (newText.length > 200) {
            const expand = document.createElement('button');
            expand.className = 'plan-preview-expand btn-ghost';
            expand.textContent = '展开全部';
            expand.dataset.planAction = 'expand-text';
            expand.dataset.fullText = newText;
            newBlock.appendChild(expand);
          }
          preview.appendChild(newBlock);
        }
      }
    }

    return preview;
  }

  /**
   * 渲染 footer
   */
  function renderFooter(enrichedOps, options) {
    const footer = document.createElement('div');
    footer.className = 'plan-footer';

    const accepted = enrichedOps.filter(op => op.status === 'accepted').length;
    const isDisabled = options.streaming || accepted === 0;

    // 执行按钮
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-primary';
    applyBtn.dataset.action = 'plan-apply-btn';
    applyBtn.textContent = `执行计划 (${accepted})`;
    applyBtn.dataset.planAction = 'apply';
    if (isDisabled) applyBtn.disabled = true;
    footer.appendChild(applyBtn);

    // 撤销按钮
    const undoBtn = document.createElement('button');
    undoBtn.className = 'btn-secondary';
    undoBtn.dataset.action = 'plan-undo-btn';
    undoBtn.textContent = '撤销';
    undoBtn.dataset.planAction = 'undo';
    if (!options.canUndo) undoBtn.disabled = true;
    footer.appendChild(undoBtn);

    return footer;
  }

  /**
   * 事件委托
   */
  function setupEventDelegation(panel, enrichedOps, options) {
    panel.addEventListener('click', (e) => {
      const target = e.target.closest('[data-plan-action]');
      if (!target || target.disabled) return;

      const action = target.dataset.planAction;

      switch (action) {
        case 'toggle-preview': {
          const item = target.closest('.plan-item');
          if (!item) return;
          const preview = item.querySelector('.plan-preview');
          if (preview) {
            const isCollapsed = preview.classList.toggle('collapsed');
            target.textContent = isCollapsed ? '\u25B8' : '\u25BE'; // ▸ or ▾
          }
          break;
        }
        case 'apply':
          if (options.onApply) options.onApply();
          break;
        case 'undo':
          if (options.onUndo) options.onUndo();
          break;
        case 'expand-text': {
          const content = target.previousElementSibling;
          if (content && target.dataset.fullText) {
            content.textContent = target.dataset.fullText;
            target.remove();
          }
          break;
        }
      }
    });

    // checkbox change 需要单独监听（click 事件在 checkbox 上不可靠）
    panel.addEventListener('change', (e) => {
      const target = e.target;
      if (!target.dataset.planAction) return;

      if (target.dataset.planAction === 'toggle') {
        if (options.onToggle) options.onToggle(target.dataset.opId, target.checked);
      } else if (target.dataset.planAction === 'toggle-all') {
        if (options.onToggleAll) options.onToggleAll(target.checked);
      }
    });
  }

  /**
   * 渲染完成态面板
   */
  function renderCompletionPanel(enrichedOps, containerEl, options) {
    const panel = document.createElement('div');
    panel.className = 'plan-panel plan-complete';
    panel.dataset.planPanel = 'true';

    const appliedCount = enrichedOps.filter(op => op.status === 'applied').length;
    const skippedCount = enrichedOps.filter(op => op.status === 'skipped').length;

    // Header
    const header = document.createElement('div');
    header.className = 'plan-header plan-header--complete';
    const title = document.createElement('span');
    title.className = 'plan-title';
    title.textContent = '\u2713 修改计划已全部执行';
    header.appendChild(title);
    const subtitle = document.createElement('span');
    subtitle.className = 'plan-complete-count';
    subtitle.textContent = skippedCount > 0
      ? `${appliedCount} 项已应用，${skippedCount} 项已跳过`
      : `${appliedCount} 项已应用`;
    header.appendChild(subtitle);
    panel.appendChild(header);

    // 查看详情 toggle
    const toggle = document.createElement('button');
    toggle.className = 'btn-ghost';
    toggle.dataset.action = 'plan-details-toggle';
    toggle.textContent = '查看详情 \u25B8';
    toggle.dataset.planAction = 'toggle-details';
    panel.appendChild(toggle);

    // Items (collapsed by default)
    const list = document.createElement('div');
    list.className = 'plan-list collapsed';
    for (const op of enrichedOps) {
      list.appendChild(renderPlanItem(op, { ...options, streaming: true }));
    }
    panel.appendChild(list);

    // Footer: 只有撤销全部
    const footer = document.createElement('div');
    footer.className = 'plan-footer';
    const undoAllBtn = document.createElement('button');
    undoAllBtn.className = 'btn-secondary';
    undoAllBtn.dataset.action = 'plan-undo-btn';
    undoAllBtn.textContent = '撤销全部';
    undoAllBtn.dataset.planAction = 'undo-all';
    if (!options.canUndo) undoAllBtn.disabled = true;
    footer.appendChild(undoAllBtn);
    panel.appendChild(footer);

    // 事件
    panel.addEventListener('click', (e) => {
      const target = e.target.closest('[data-plan-action]');
      if (!target) return;
      if (target.dataset.planAction === 'toggle-details') {
        const isCollapsed = list.classList.toggle('collapsed');
        target.textContent = isCollapsed ? '查看详情 \u25B8' : '收起 \u25BE';
      }
      if (target.dataset.planAction === 'undo-all') {
        if (options.onUndoAll) options.onUndoAll();
      }
    });

    // 替换或追加
    const existing = containerEl.querySelector('[data-plan-panel]');
    if (existing) existing.replaceWith(panel);
    else containerEl.appendChild(panel);
    return panel;
  }

  /**
   * 渲染过期占位
   */
  function renderExpiredPlaceholder(containerEl) {
    const el = document.createElement('div');
    el.className = 'plan-expired';
    el.textContent = '修改计划已过期，请重新发送指令';
    containerEl.appendChild(el);
    return el;
  }

  // 工具函数
  function truncateText(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '...';
  }

  // 导出
  window.PlanRenderer = {
    renderPlanPanel,
    renderExpiredPlaceholder,
  };
})();
