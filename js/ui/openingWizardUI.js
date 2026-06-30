// ============================================
// Opening Wizard UI
// ============================================
// 新卡（有 frozen_moment）开局问答 wizard：
//   Step 0 顶部「世界氛围引言」(opening_greeting) + 「点击开始」按钮
//   Step 1 身份选择（仅 player_anchor.allowed_modes.length>1 时出现）
//   Step 2 你扮演谁（C=director 跳过）
//   Step 3 选择开场地点（"随机" 盲选 / "我来指定" 下拉）
//
// 完成 → playerOpeningLockStore.set(draft) → sessionManager.saveGame() → onComplete()
// 取消 → onCancel()（把玩家踢回卡片选择页，避免反复触发死循环）
// 老卡（无 frozen_moment）→ 不应该调用此 wizard（openingController 不会触发）

(function () {
  'use strict';

  const MODAL_ID = 'opening-wizard-modal';
  const RANDOM_SENTINEL = '__RANDOM__';

  // ────── 内部 state ──────
  let _state = null;
  let _options = null; // { onComplete, onCancel }
  let _isOpen = false; // F-3 M2 守卫：防止 wizard 已显示时被重入 openWizard 重置 state

  function _lang() {
    try {
      return window.i18nService?.getLanguage?.() === 'en' ? 'en' : 'zh';
    } catch (_) {
      return 'zh';
    }
  }

  function _T(zh, en) {
    return _lang() === 'en' ? en : zh;
  }

  function _escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ────── 数据收集 ──────
  function _readPlayerAnchor() {
    try {
      const card = window.worldCardManager?.getActiveCardRaw?.();
      const anchor = card?.designMeta?.p1Output?.player_anchor;
      if (anchor && typeof anchor === 'object' && Array.isArray(anchor.allowed_modes)) {
        return {
          allowed_modes: anchor.allowed_modes.slice(),
          compliance: anchor.compliance || null,
          recommended_role: anchor.recommended_role || null,
        };
      }
    } catch (_) {}
    // 兜底：Phase 1 player_anchor 未实现/卡里没该字段 → 默认 any_role 沙盒（与 p1.js 一致）
    return { allowed_modes: ['any_role'], compliance: null, recommended_role: null };
  }

  function _readEntitySettings() {
    try {
      const card = window.worldCardManager?.getActiveCardRaw?.();
      const settings = card?.snapshot?.world_setting?.settings;
      if (settings && typeof settings === 'object') return settings;
    } catch (_) {}
    return {};
  }

  // 查找 character_database 中 role==='主角' 的角色名（Stage 3 assigned 锚定角色）
  // 找不到（老卡 / 非 assigned 卡 / Stage 3 没遵守约束）返回 null，调用方回落到 recommended_role 描述
  function _readProtagonistName() {
    try {
      const card = window.worldCardManager?.getActiveCardRaw?.();
      const db = card?.snapshot?.character_database;
      if (!db || typeof db !== 'object') return null;
      for (const [k, v] of Object.entries(db)) {
        if (k.startsWith('_')) continue;
        if (v && typeof v === 'object' && window.characterFields?.isProtagonist?.(v) && typeof v.name === 'string' && v.name.trim()) {
          return v.name.trim();
        }
      }
    } catch (_) {}
    return null;
  }

  function _readEntityDisplayNames() {
    try {
      return window.entityStore?.listDisplayNames?.() || [];
    } catch (_) {
      return [];
    }
  }

  // Step 3 site 列表：直接读 V2 entity.sites 结构化字段。
  // V1 老卡不在设计模式编辑路径，此 wizard 也用于游玩侧；V1 卡若到达此处只产空列表。
  // 返回每条 = { entityId, country, site, spot, atmosphere?, fullPath }
  // 三段式 = country (= entity.display_name) / site / spot，对齐 panel_status.location 三字段
  // fullPath = '{country} / {site} / {spot}'，作为 location_site 写入存档的字符串
  function _readSitesForActiveEntities() {
    const settings = _readEntitySettings();
    const entityIds = Object.keys(settings).filter(id => !id.startsWith('_'));
    if (entityIds.length === 0) return { sites: [], entities: [] };

    const out = [];
    for (const eid of entityIds) {
      const val = settings[eid];
      if (!val || typeof val !== 'object' || Array.isArray(val)) continue; // V1 字符串跳过
      // 经 flattenEntitySites 容错展开（吃旧扁平 / 新 site 树都行），保持三段候选输出契约不变。
      const rows = typeof window.flattenEntitySites === 'function'
        ? window.flattenEntitySites(val, eid)
        : [];
      for (const r of rows) {
        if (!r.site && !r.spot) continue;
        out.push({
          entityId: eid,
          country: r.country,
          site: r.site,
          spot: r.spot,
          atmosphere: r.atmosphere,
          fullPath: r.fullPath,
        });
      }
    }
    return { sites: out, entities: entityIds };
  }

  // ────── 渲染 ──────
  function _ensureModalContainer() {
    let modal = document.getElementById(MODAL_ID);
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.className = 'modal opening-wizard-modal hidden';
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML = `
      <div class="modal-content themed-modal opening-wizard-content" role="dialog" aria-modal="true">
        <div class="opening-wizard-body"></div>
      </div>
    `;
    document.body.appendChild(modal);

    // 点击遮罩 ≠ 取消（避免误触；只用 ESC 或显式取消按钮）
    modal.addEventListener('click', e => {
      if (e.target === modal) {
        // 不退出；防误触。退出走 ESC 或显式取消按钮
      }
    });
    // 注意：ESC 监听不在这里挂——必须每次 openWizard 都重新挂（防 F-1b：modal 复用时漏挂）
    return modal;
  }

  function _onKeydown(e) {
    const modal = document.getElementById(MODAL_ID);
    if (!modal || modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      _doCancel();
    }
  }

  function _render() {
    const modal = _ensureModalContainer();
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    const body = modal.querySelector('.opening-wizard-body');
    if (!body) return;

    const totalSteps = _computeTotalSteps();
    const stepLabel = _T(`第 ${_state.step + 1} / ${totalSteps} 步`, `Step ${_state.step + 1} / ${totalSteps}`);

    if (_state.step === 0) {
      body.innerHTML = _renderStep0(stepLabel);
      _bindStep0(body);
    } else if (_state.step === 1) {
      body.innerHTML = _renderStep1(stepLabel);
      _bindStep1(body);
    } else if (_state.step === 2) {
      body.innerHTML = _renderStep2(stepLabel);
      _bindStep2(body);
    } else if (_state.step === 3) {
      body.innerHTML = _renderStep3(stepLabel);
      _bindStep3(body);
    }
  }

  function _computeTotalSteps() {
    // Step 0 始终 + Step 3 始终；Step 1 仅 allowed_modes 多选时；Step 2 仅 mode!==director 时
    let n = 2; // step 0 + step 3
    if (_state.anchor.allowed_modes.length > 1) n++;
    if (_state.draft.mode !== 'director') n++;
    return n;
  }

  // ────── Step 0：opening_greeting + 「点击开始」──────
  function _renderStep0(stepLabel) {
    const greeting = (window.worldMeta?.getOpeningGreeting?.() || '').trim();
    const placeholder = _T(
      '（这张卡尚未生成"世界氛围引言"——可在设计模式 Phase 2 Stage 2 编辑 opening_greeting 字段补全。）',
      '(This card has no "world atmosphere preamble" yet — edit opening_greeting in Phase 2 Stage 2 of design mode.)'
    );
    const introText = greeting ? _escapeHtml(greeting).replace(/\n/g, '<br>') : `<em>${_escapeHtml(placeholder)}</em>`;
    return `
      <div class="opening-wizard-header">
        <span class="opening-wizard-step-label">${_escapeHtml(stepLabel)}</span>
        <button class="btn-ghost btn-icon opening-wizard-cancel" data-action="cancel" aria-label="${_escapeHtml(_T('取消', 'Cancel'))}">×</button>
      </div>
      <h2 class="modal-title-with-icon">${_escapeHtml(_T('开局', 'Opening'))}</h2>
      <div class="opening-wizard-greeting">${introText}</div>
      <div class="modal-actions">
        <button class="btn-primary" data-action="enter">${_escapeHtml(_T('点击开始', 'Click to Start'))}</button>
      </div>
    `;
  }

  function _bindStep0(body) {
    body.querySelector('[data-action="cancel"]')?.addEventListener('click', _doCancel);
    body.querySelector('[data-action="enter"]')?.addEventListener('click', () => {
      // 从 Step 0 进 Step 1（若多 mode）或 Step 2（若单 mode 且非 director）或 Step 3（director）
      _advanceFromStep0();
    });
  }

  function _advanceFromStep0() {
    if (_state.anchor.allowed_modes.length > 1) {
      _state.step = 1;
    } else {
      _state.draft.mode = _state.anchor.allowed_modes[0];
      if (_state.draft.mode === 'director') {
        _state.draft.player_role = null;
        _state.step = 3;
      } else {
        _state.step = 2;
      }
    }
    _render();
  }

  // ────── Step 1：身份选择（多 mode 时） ──────
  function _renderStep1(stepLabel) {
    const modes = _state.anchor.allowed_modes;
    const modeLabels = {
      assigned: _T('扮演指定角色', 'Play a specified role'),
      any_role: _T('任意角色', 'Any role'),
      director: _T('导演（上帝视角）', 'Director (god view)'),
    };
    const modeHints = {
      assigned: _T('作者推荐了一个主角，你可以接受默认也可以改写。', 'The author recommends a protagonist; you may accept it or rewrite.'),
      any_role: _T('你描述任何想扮演的角色，或交给随机。', 'Describe any role you want to play, or roll randomly.'),
      director: _T('不绑定具体角色，以全景视角观察这个世界。', 'No specific PC — observe the world in panoramic view.'),
    };
    const radios = modes.map(m => {
      const checked = _state.draft.mode === m ? 'checked' : '';
      return `
        <label class="opening-wizard-radio">
          <input type="radio" name="ow-mode" value="${m}" ${checked}>
          <span class="opening-wizard-radio-main">${_escapeHtml(modeLabels[m] || m)}</span>
          <span class="opening-wizard-radio-hint">${_escapeHtml(modeHints[m] || '')}</span>
        </label>
      `;
    }).join('');

    return `
      <div class="opening-wizard-header">
        <span class="opening-wizard-step-label">${_escapeHtml(stepLabel)}</span>
        <button class="btn-ghost btn-icon opening-wizard-cancel" data-action="cancel" aria-label="${_escapeHtml(_T('取消', 'Cancel'))}">×</button>
      </div>
      <h2 class="modal-title-with-icon">${_escapeHtml(_T('你想以什么身份进场？', 'How do you want to enter?'))}</h2>
      <div class="opening-wizard-radios">${radios}</div>
      <div class="modal-actions">
        <button class="btn-secondary" data-action="back">${_escapeHtml(_T('上一步', 'Back'))}</button>
        <button class="btn-primary" data-action="next" ${_state.draft.mode ? '' : 'disabled'}>${_escapeHtml(_T('下一步', 'Next'))}</button>
      </div>
    `;
  }

  function _bindStep1(body) {
    body.querySelector('[data-action="cancel"]')?.addEventListener('click', _doCancel);
    body.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      _state.step = 0;
      _render();
    });
    body.querySelectorAll('input[name="ow-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        _state.draft.mode = r.value;
        // 若进入 assigned 模式，默认填 recommended_role
        if (_state.draft.mode === 'assigned' && !_state.draft.player_role) {
          _state.draft.player_role = _state.anchor.recommended_role || '';
        }
        if (_state.draft.mode === 'director') {
          _state.draft.player_role = null;
        }
        _render();
      });
    });
    body.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      if (!_state.draft.mode) return;
      if (_state.draft.mode === 'director') {
        _state.draft.player_role = null;
        _state.step = 3;
      } else {
        _state.step = 2;
      }
      _render();
    });
  }

  // ────── Step 2：你扮演谁（C 模式跳过） ──────
  function _renderStep2(stepLabel) {
    // F-2-1：A 模式（mode='assigned'）输入框只读显示 recommended_role + 「改」按钮；
    //        点改 → mode 切到 any_role + UI 重渲染为 B 模式（空 input + 🎲）。
    //        B 模式（mode='any_role'）：空 input + 🎲 + 不显示「改」（已是任意）。
    //        玩家身份的 mode 语义跟 wizard UI 视觉严格对齐：
    //          assigned ↔ 只读推荐主角；any_role ↔ 输入框+🎲；director 不走 Step 2。
    const isAssigned = _state.draft.mode === 'assigned';
    const recommended = _state.anchor.recommended_role || '';
    const isRandom = _state.draft.player_role === RANDOM_SENTINEL;
    // assigned 模式优先用 character_database role==='主角' 的角色名作为主显示（Stage 3 锚定角色）；
    // 描述（recommended_role）退到副标行展示，让玩家既看到具体名字又看到角色定位
    const protagonistName = isAssigned ? _readProtagonistName() : null;

    const title = isAssigned
      ? _T('你扮演（作者推荐的主角）', 'You play (author-recommended protagonist)')
      : _T('你想扮演什么角色？', 'What role do you want to play?');

    let bodyHtml;
    if (isAssigned) {
      // A 模式：只读显示推荐主角 + 「改成自由描述」按钮（不出 🎲；A 不允许随机）
      // 优先显示 character_database role==='主角' 的具体角色名；副标行显示作者写的 recommended_role 描述
      const displayValue =
        protagonistName ||
        recommended ||
        _T('（作者未指定推荐主角）', '(author did not specify a recommended role)');
      const subline =
        protagonistName && recommended
          ? `<div class="opening-wizard-locked-sub">${_escapeHtml(recommended)}</div>`
          : '';
      bodyHtml = `
        <div class="opening-wizard-assigned-block">
          <div class="opening-wizard-locked">${_escapeHtml(displayValue)}</div>
          ${subline}
          <button class="btn-ghost" data-action="switch-to-any">${_escapeHtml(_T('改成自由描述', 'Switch to free description'))}</button>
        </div>
      `;
    } else {
      // B 模式：输入框 + 🎲；写「随机」=按钮触发，不是手写两字
      const currentValue = isRandom
        ? ''
        : (typeof _state.draft.player_role === 'string' ? _state.draft.player_role : '');
      const inputDisabled = isRandom ? 'disabled' : '';
      const randomDisplay = isRandom
        ? `<div class="opening-wizard-locked">${_escapeHtml(_T('🎲 随机（由 AI 在 Turn 1 决定）', '🎲 Random (AI decides at Turn 1)'))}</div>`
        : '';
      bodyHtml = `
        ${randomDisplay}
        <div class="opening-wizard-role-row">
          <input type="text" class="field opening-wizard-role-input" data-field="role" placeholder="${_escapeHtml(_T('请描述你想扮演的角色，或点🎲随机', 'Describe the role you want to play, or roll 🎲'))}" value="${_escapeHtml(currentValue)}" ${inputDisabled}>
          <button class="btn-secondary opening-wizard-random-btn" data-action="random" title="${_escapeHtml(_T('随机由 AI Turn 1 决定', 'Random (AI Turn 1 decides)'))}">🎲 ${_escapeHtml(_T('随机', 'Random'))}</button>
        </div>
        ${isRandom ? `<div class="modal-actions"><button class="btn-ghost" data-action="clear-random">${_escapeHtml(_T('改回手动描述', 'Back to manual'))}</button></div>` : ''}
      `;
    }

    return `
      <div class="opening-wizard-header">
        <span class="opening-wizard-step-label">${_escapeHtml(stepLabel)}</span>
        <button class="btn-ghost btn-icon opening-wizard-cancel" data-action="cancel" aria-label="${_escapeHtml(_T('取消', 'Cancel'))}">×</button>
      </div>
      <h2 class="modal-title-with-icon">${_escapeHtml(title)}</h2>
      ${bodyHtml}
      <div class="modal-actions">
        <button class="btn-secondary" data-action="back">${_escapeHtml(_T('上一步', 'Back'))}</button>
        <button class="btn-primary" data-action="next" ${(isAssigned || isRandom || (typeof _state.draft.player_role === 'string' && _state.draft.player_role.trim() !== '')) ? '' : 'disabled'}>${_escapeHtml(_T('下一步', 'Next'))}</button>
      </div>
    `;
  }

  function _bindStep2(body) {
    body.querySelector('[data-action="cancel"]')?.addEventListener('click', _doCancel);
    body.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      // 多 mode 时回 Step 1，否则回 Step 0
      _state.step = _state.anchor.allowed_modes.length > 1 ? 1 : 0;
      _render();
    });

    // F-2-1：A 模式「改成自由描述」→ 切 mode 到 any_role、清 input、重渲染
    body.querySelector('[data-action="switch-to-any"]')?.addEventListener('click', () => {
      _state.draft.mode = 'any_role';
      _state.draft.player_role = '';
      _render();
    });

    // B 模式 input 监听（A 模式无 input）
    const input = body.querySelector('[data-field="role"]');
    if (input) {
      input.addEventListener('input', () => {
        _state.draft.player_role = input.value;
        // 实时切「下一步」可用性：B 模式空值禁用（红线：必须填角色或主动点🎲随机）
        const nextBtn = body.querySelector('[data-action="next"]');
        if (nextBtn) nextBtn.disabled = input.value.trim() === '';
      });
    }
    body.querySelector('[data-action="random"]')?.addEventListener('click', () => {
      _state.draft.player_role = RANDOM_SENTINEL;
      _render();
    });
    body.querySelector('[data-action="clear-random"]')?.addEventListener('click', () => {
      _state.draft.player_role = '';
      _render();
    });
    body.querySelector('[data-action="next"]')?.addEventListener('click', () => {
      // A 模式：用 recommended_role（作者推荐主角；可为空，Turn 1 时 lock.player_role 会是空串）
      if (_state.draft.mode === 'assigned') {
        _state.draft.player_role = _state.anchor.recommended_role || '';
      } else {
        // B 模式：必须已填角色描述或主动点过🎲随机。空值不前进——红线：系统不替用户默认随机，
        // 「下一步」此时本应已禁用；这里再兜一层，绝不偷偷塞 RANDOM_SENTINEL。
        const v = _state.draft.player_role;
        if (!v || (typeof v === 'string' && !v.trim())) return;
      }
      _state.step = 3;
      _render();
    });
  }

  // ────── Step 3：选择开场地点 ──────
  function _renderStep3(stepLabel) {
    const isRandom = _state.draft.location_site === RANDOM_SENTINEL;
    const isManual = !isRandom && _state.draft.location_site;
    const data = _readSitesForActiveEntities();
    const noSitesAvailable = data.sites.length === 0;

    // 无可用 sites（V1 老卡或 V2 漏产 sites）→「我来指定」禁用 + 警告
    const manualDisabled = noSitesAvailable ? 'disabled' : '';
    const manualHint = noSitesAvailable
      ? `<div class="opening-wizard-hint opening-wizard-hint--warn">${_escapeHtml(_T('当前世界卡未提供结构化 sites，本卡此时只能用「随机」。', 'No structured sites available in this card; only "Random" is available.'))}</div>`
      : '';

    let manualSection = '';
    if ((_state.step3SubMode === 'manual' || isManual) && !noSitesAvailable) {
      const options = data.sites
        .map(({ fullPath, entityId }) => {
          const selected = _state.draft.location_site === fullPath ? 'selected' : '';
          return `<option value="${_escapeHtml(fullPath)}" ${selected}>${_escapeHtml(fullPath)} [${_escapeHtml(entityId)}]</option>`;
        })
        .join('');
      manualSection = `
        <div class="opening-wizard-manual-block">
          <select class="field opening-wizard-site-select" data-field="site">
            <option value="">${_escapeHtml(_T('— 请选择 site —', '— Pick a site —'))}</option>
            ${options}
          </select>
        </div>
      `;
    }

    return `
      <div class="opening-wizard-header">
        <span class="opening-wizard-step-label">${_escapeHtml(stepLabel)}</span>
        <button class="btn-ghost btn-icon opening-wizard-cancel" data-action="cancel" aria-label="${_escapeHtml(_T('取消', 'Cancel'))}">×</button>
      </div>
      <h2 class="modal-title-with-icon">${_escapeHtml(_T('选择开场地点', 'Choose Opening Site'))}</h2>
      <p class="modal-description">${_escapeHtml(_T('只能在世界卡已有的地点中开场。', 'You can only open at sites that exist in the world card.'))}</p>
      <div class="opening-wizard-loc-choices">
        <button class="btn-secondary opening-wizard-loc-choice ${isRandom ? 'is-selected' : ''}" data-action="random">🎲 ${_escapeHtml(_T('随机', 'Random'))}</button>
        <button class="btn-secondary opening-wizard-loc-choice ${(_state.step3SubMode === 'manual' || isManual) && !noSitesAvailable ? 'is-selected' : ''}" data-action="manual" ${manualDisabled}>${_escapeHtml(_T('我来指定', 'Let me choose'))}</button>
      </div>
      ${manualHint}
      ${manualSection}
      <div class="modal-actions">
        <button class="btn-secondary" data-action="back">${_escapeHtml(_T('上一步', 'Back'))}</button>
        <button class="btn-primary" data-action="start" ${_canStart() ? '' : 'disabled'}>${_escapeHtml(_T('开始游戏', 'Start Game'))}</button>
      </div>
    `;
  }

  function _canStart() {
    if (_state.draft.location_site === RANDOM_SENTINEL) return true;
    if (typeof _state.draft.location_site === 'string' && _state.draft.location_site.trim()) return true;
    return false;
  }

  function _bindStep3(body) {
    body.querySelector('[data-action="cancel"]')?.addEventListener('click', _doCancel);
    body.querySelector('[data-action="back"]')?.addEventListener('click', () => {
      // director 模式回 Step 1 或 Step 0；非 director 回 Step 2
      if (_state.draft.mode === 'director') {
        _state.step = _state.anchor.allowed_modes.length > 1 ? 1 : 0;
      } else {
        _state.step = 2;
      }
      _render();
    });
    body.querySelector('[data-action="random"]')?.addEventListener('click', () => {
      _state.draft.location_site = RANDOM_SENTINEL;
      _state.step3SubMode = 'random';
      _render();
    });
    body.querySelector('[data-action="manual"]')?.addEventListener('click', () => {
      _state.step3SubMode = 'manual';
      _state.draft.location_site = null;
      _render();
    });
    const sel = body.querySelector('[data-field="site"]');
    if (sel) {
      sel.addEventListener('change', () => {
        _state.draft.location_site = sel.value || null;
        _render();
      });
    }
    body.querySelector('[data-action="start"]')?.addEventListener('click', _doComplete);
  }

  // ────── 提交 / 取消 ──────
  function _doComplete() {
    if (!_canStart()) return;
    const lock = {
      mode: _state.draft.mode,
      player_role:
        _state.draft.mode === 'director'
          ? null
          : _state.draft.player_role || RANDOM_SENTINEL,
      location_site: _state.draft.location_site,
    };
    try {
      window.playerOpeningLockStore?.set?.(lock);
    } catch (e) {
      console.warn('[openingWizardUI] 写 lock 失败', e);
    }
    // 立即 persist（不阻塞 onComplete）
    try {
      window.sessionManager?.saveGame?.({ silent: true, saveSource: 'live' });
    } catch (e) {
      console.warn('[openingWizardUI] saveGame 失败', e);
    }
    _closeModal();
    const cb = _options?.onComplete;
    _state = null;
    _options = null;
    if (typeof cb === 'function') {
      try { cb(lock); } catch (e) { console.warn('[openingWizardUI] onComplete 回调失败', e); }
    }
  }

  function _doCancel() {
    _closeModal();
    const cb = _options?.onCancel;
    _state = null;
    _options = null;
    if (typeof cb === 'function') {
      try { cb(); } catch (e) { console.warn('[openingWizardUI] onCancel 回调失败', e); }
    }
  }

  function _closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', _onKeydown);
    _isOpen = false;
  }

  // ────── 公开 API ──────
  function openWizard(options = {}) {
    // F-3 M2 守卫：wizard 已显示时拒绝重入（防止 state 被覆盖、玩家被"突然回到 Step 0"）
    if (_isOpen) {
      console.warn('[openingWizardUI] openWizard reentry rejected — wizard is already open');
      return;
    }
    _options = {
      onComplete: typeof options.onComplete === 'function' ? options.onComplete : null,
      onCancel: typeof options.onCancel === 'function' ? options.onCancel : null,
    };
    _state = {
      step: 0,
      step3SubMode: null, // 'random' | 'manual' | null
      anchor: _readPlayerAnchor(),
      draft: {
        mode: null,
        player_role: null,
        location_site: null,
      },
    };
    _isOpen = true;
    // F-1b：ESC 监听每次 openWizard 都重挂（先 remove 防重复 + add）；老的 modal-create-once 注册已删
    document.removeEventListener('keydown', _onKeydown);
    document.addEventListener('keydown', _onKeydown);
    // 若只有一个 mode，预先填进 draft（保持 Step 0「点击开始」语义不变；进 Step 0 之后自动跳过 Step 1）
    _render();
  }

  function closeWizard() {
    _doCancel();
  }

  window.openingWizardUI = {
    openWizard,
    closeWizard,
    RANDOM_SENTINEL,
  };
})();
