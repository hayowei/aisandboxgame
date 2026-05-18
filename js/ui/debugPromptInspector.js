// ============================================
// Debug Prompt Inspector — debugUI 的 "Prompt Inspector" tab
// ============================================
// 职责：把 promptRegistry 的所有 prompt block 在 UI 中可视化
//   - 通道选择器：列出所有 channel（react / panelSkill / inventorySkill / summary / sms / ...）
//   - 模式切换：「实际注入 (last snapshot)」 vs 「所有可能注入 (registry full)」
//   - 左栏：block 树（按 category 分组），每条目显示 id / 长度 / source / cacheable / condition
//   - 右栏：选中 block 的完整文本 + meta + 复制按钮
// ============================================

(function initDebugPromptInspector() {
  let selectedChannel = 'all';
  let selectedMode = 'snapshot'; // 'snapshot' | 'registry'
  let selectedBlockId = null;

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAllChannels() {
    const reg = window.promptRegistry;
    if (!reg) return [];
    const set = new Set();
    for (const b of reg.getAll()) set.add(b.channel);
    // 包含 react（即使 registry 没注册任何 react block，react snapshot 仍可能存在）
    set.add('react');
    return Array.from(set).sort();
  }

  /**
   * 获取当前模式 + 通道下要展示的 block 列表（含 text）
   * snapshot 模式：从 promptRegistry.getLastSnapshot(channel).injected 取
   * registry 模式：从 promptRegistry.getByChannel(channel) 取，builder dryRun 拿 sample
   */
  function getDisplayBlocks(channel, mode) {
    const reg = window.promptRegistry;
    if (!reg) return [];

    if (mode === 'snapshot') {
      // 从 snapshot 取（兼容累积通道：snap 可能是数组）
      const expandSnap = (snap, ch) => {
        const out = [];
        if (!snap?.injected) return out;
        for (const inj of snap.injected) {
          out.push({
            channel: ch,
            blockId: inj.blockId,
            cacheable: inj.cacheable,
            length: inj.length,
            text: inj.text,
            source: 'snapshot',
            category: reg.get(inj.blockId)?.category || 'systemBlock',
            contextLabel: snap.contextLabel || null,
          });
        }
        return out;
      };

      if (channel === 'all') {
        const snapshots = reg.getAllSnapshots();
        const all = [];
        for (const [ch, val] of Object.entries(snapshots)) {
          const snapList = Array.isArray(val) ? val : [val];
          for (const snap of snapList) {
            all.push(...expandSnap(snap, ch));
          }
        }
        return all;
      } else {
        const snapList = reg.getAllSnapshotsForChannel
          ? reg.getAllSnapshotsForChannel(channel)
          : [reg.getLastSnapshot(channel)].filter(Boolean);
        const all = [];
        for (const snap of snapList) {
          all.push(...expandSnap(snap, channel));
        }
        return all;
      }
    } else {
      // registry 模式：从 promptRegistry 取，builder() 拿样本
      const blocks = channel === 'all' ? reg.getAll() : reg.getByChannel(channel);
      return blocks.map(b => {
        let text = '';
        try {
          text = b.builder({}) || '';
        } catch (e) {
          text = `<builder error: ${e?.message || e}>`;
        }
        return {
          channel: b.channel,
          blockId: b.id,
          cacheable: b.cacheable,
          length: text.length,
          text,
          source: b.source,
          category: b.category,
          description: b.description,
          conditionDesc: b.conditionDesc,
          origin: b.origin,
          relatedTools: b.relatedTools,
        };
      });
    }
  }

  function sourceBadgeClass(source) {
    // 返回 CSS class，颜色定义在 components.css 中（design token-driven）
    switch (source) {
      case 'static-file': return 'source-badge-static';
      case 'dynamic-runtime': return 'source-badge-dynamic';
      case 'tool-meta': return 'source-badge-tool';
      case 'world-card': return 'source-badge-world';
      case 'snapshot': return 'source-badge-snapshot';
      default: return 'source-badge-other';
    }
  }

  function renderSidebar(sidebar) {
    const channels = getAllChannels();
    const blocks = getDisplayBlocks(selectedChannel, selectedMode);

    // 按 category 分组
    const grouped = {};
    for (const b of blocks) {
      const cat = b.category || 'other';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(b);
    }

    const channelOpts = ['all', ...channels]
      .map(ch => `<option value="${escapeHtml(ch)}" ${ch === selectedChannel ? 'selected' : ''}>${escapeHtml(ch)}</option>`)
      .join('');

    let html = `
      <div class="prompt-inspector-controls">
        <div class="prompt-inspector-control-row">
          <label>通道</label>
          <select id="prompt-inspector-channel">${channelOpts}</select>
        </div>
        <div class="prompt-inspector-control-row">
          <label>模式</label>
          <div class="prompt-inspector-toggle">
            <button class="prompt-inspector-mode-btn ${selectedMode === 'snapshot' ? 'active' : ''}" data-mode="snapshot">实际注入</button>
            <button class="prompt-inspector-mode-btn ${selectedMode === 'registry' ? 'active' : ''}" data-mode="registry">可能注入</button>
          </div>
        </div>
        <div class="prompt-inspector-stats">
          ${blocks.length} block ${selectedMode === 'snapshot' ? '已注入本次' : '已注册'}
        </div>
      </div>
      <div class="prompt-inspector-blocks">
    `;

    if (blocks.length === 0) {
      html += `<div class="prompt-inspector-empty">${selectedMode === 'snapshot' ? '尚未跑过该通道，无 snapshot 数据' : '该通道未注册任何 block'}</div>`;
    } else {
      for (const [cat, list] of Object.entries(grouped)) {
        html += `<div class="prompt-inspector-category">
          <div class="prompt-inspector-category-title">${escapeHtml(cat)} (${list.length})</div>`;
        for (const b of list) {
          const isSelected = b.blockId === selectedBlockId;
          const badge = `<span class="prompt-inspector-badge ${sourceBadgeClass(b.source)}">${escapeHtml(b.source || '?')}</span>`;
          const cacheIcon = b.cacheable ? '🔒' : '🔓';
          const labelSuffix = b.contextLabel
            ? ` <span class="prompt-inspector-context-label">(${escapeHtml(b.contextLabel)})</span>`
            : '';
          html += `
            <div class="prompt-inspector-block-row ${isSelected ? 'selected' : ''}" data-block-id="${escapeHtml(b.blockId)}" data-context-label="${escapeHtml(b.contextLabel || '')}">
              <div class="prompt-inspector-block-id">${escapeHtml(b.blockId)}${labelSuffix}</div>
              <div class="prompt-inspector-block-meta">
                ${badge}
                <span class="prompt-inspector-cache-icon" title="${b.cacheable ? 'cacheable' : 'volatile'}">${cacheIcon}</span>
                <span class="prompt-inspector-length">${b.length}</span>
              </div>
            </div>`;
        }
        html += `</div>`;
      }
    }
    html += `</div>`;

    sidebar.innerHTML = html;
    sidebar.classList.remove('hidden');

    // 事件：通道切换
    const channelSel = sidebar.querySelector('#prompt-inspector-channel');
    if (channelSel) {
      channelSel.addEventListener('change', e => {
        selectedChannel = e.target.value;
        selectedBlockId = null;
        rerender();
      });
    }
    // 模式切换
    sidebar.querySelectorAll('.prompt-inspector-mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        selectedMode = e.target.dataset.mode;
        selectedBlockId = null;
        rerender();
      });
    });
    // block 选中
    sidebar.querySelectorAll('.prompt-inspector-block-row').forEach(row => {
      row.addEventListener('click', () => {
        selectedBlockId = row.dataset.blockId;
        rerender();
      });
    });
  }

  function renderDetail(detail) {
    if (!selectedBlockId) {
      detail.innerHTML = '<div class="debug-empty-state">从左侧选择一个 prompt block 查看详情</div>';
      return;
    }

    const blocks = getDisplayBlocks(selectedChannel, selectedMode);
    const block = blocks.find(b => b.blockId === selectedBlockId);

    if (!block) {
      detail.innerHTML = `<div class="debug-empty-state">未找到 block: ${escapeHtml(selectedBlockId)}（可能切换了通道/模式）</div>`;
      return;
    }

    const reg = window.promptRegistry;
    const meta = reg?.get?.(block.blockId) || null;

    const originStr = meta?.origin
      ? [meta.origin.file, meta.origin.symbol].filter(Boolean).join(' :: ')
      : '—';

    let html = `
      <div class="prompt-inspector-detail">
        <div class="prompt-inspector-detail-header">
          <div class="prompt-inspector-detail-id">${escapeHtml(block.blockId)}</div>
          <button class="prompt-inspector-copy-btn" data-action="copy">复制文本</button>
        </div>
        <div class="prompt-inspector-meta-grid">
          <div><b>Channel</b></div><div>${escapeHtml(block.channel || '?')}</div>
          <div><b>Category</b></div><div>${escapeHtml(block.category || '?')}</div>
          <div><b>Source</b></div><div>${escapeHtml(block.source || '?')}</div>
          <div><b>Origin</b></div><div>${escapeHtml(originStr)}</div>
          <div><b>Cacheable</b></div><div>${block.cacheable ? '✓ (Anthropic prompt cache 可命中)' : '✗ (volatile)'}</div><!-- ui-lint-allow: debug 视图装饰勾叉 -->
          <div><b>Condition</b></div><div>${escapeHtml(meta?.conditionDesc || 'always')}</div>
          <div><b>Description</b></div><div>${escapeHtml(meta?.description || '—')}</div>
          ${meta?.relatedTools?.length ? `<div><b>Related tools</b></div><div>${meta.relatedTools.map(t => `<code>${escapeHtml(t)}</code>`).join(', ')}</div>` : ''}
          <div><b>Length</b></div><div>${block.length} 字符</div>
        </div>
        <div class="prompt-inspector-text-label">文本内容</div>
        <pre class="prompt-inspector-text">${escapeHtml(block.text || '')}</pre>
      </div>
    `;

    detail.innerHTML = html;

    // 复制按钮
    const copyBtn = detail.querySelector('[data-action="copy"]');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const ta = document.createElement('textarea');
        ta.value = block.text || '';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          copyBtn.textContent = '已复制 ✓'; /* ui-lint-allow: 复制成功反馈装饰勾 */
          setTimeout(() => { copyBtn.textContent = '复制文本'; }, 1500);
        } catch (e) {
          console.warn('复制失败', e);
        }
        document.body.removeChild(ta);
      });
    }
  }

  let _lastSidebar = null;
  let _lastDetail = null;

  function rerender() {
    if (_lastSidebar && _lastDetail) {
      renderSidebar(_lastSidebar);
      renderDetail(_lastDetail);
    }
  }

  function render(sidebar, detail) {
    _lastSidebar = sidebar;
    _lastDetail = detail;
    renderSidebar(sidebar);
    renderDetail(detail);
  }

  window.debugPromptInspector = { render };

  console.log('[debugPromptInspector] Initialized');
})();
