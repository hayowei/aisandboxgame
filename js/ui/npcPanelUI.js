// ============================================
// NPC Panel UI - 左侧 NPC 角色面板 UI
// ============================================
// 纯 UI 模块，负责渲染和事件处理
// 数据存储和业务逻辑由 npcStore 负责

const npcPanelUI = {
  // ==========================================
  // Tab 状态（v1：全局单变量，所有 NPC 卡共享当前 tab；刷新页面回到默认）
  // ==========================================
  _activeTab: 'profile', // 'profile' | 'state'

  _applyTabToCard(cardWrapper) {
    if (!cardWrapper) return;
    cardWrapper.dataset.activeTab = this._activeTab;
    const buttons = cardWrapper.querySelectorAll('.npc-card-tab[data-tab-target]');
    buttons.forEach(btn => {
      const isActive = btn.dataset.tabTarget === this._activeTab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  },

  _applyTabToAllCards() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;
    container.querySelectorAll('.npc-card-wrapper').forEach(w => this._applyTabToCard(w));
  },

  setActiveTab(tab) {
    if (tab !== 'profile' && tab !== 'state') return;
    if (this._activeTab === tab) return;
    this._activeTab = tab;
    this._applyTabToAllCards();
  },

  // 翻面卡的 ResizeObserver（按 wrapper 存，避免重复挂）
  _flipRO: typeof WeakMap !== 'undefined' ? new WeakMap() : null,

  /**
   * 翻面时按当前面内容自适应卡高（平滑过渡）。
   * 关键：背面内容裹在 .npc-back-inner（自然高、不被 inset:0 约束），
   * 用它的 offsetHeight 当真高；并挂 ResizeObserver —— 字体/编辑/换行任何
   * 重排后自动校正高度，杜绝"一次性测量太早算少 → foot 被裁"。
   */
  _setFlipHeight(wrapper) {
    if (!wrapper) return;
    const flip = wrapper.querySelector('.npc-card-flip');
    if (!flip) return;
    const front = flip.querySelector('.npc-card-front');
    const back = flip.querySelector('.npc-card-back');
    if (!front || !back) return;
    const inner = back.querySelector('.npc-back-inner') || back;

    const measure = el => {
      // 子节点自然堆叠高（不受父定高压缩）+ 自身 padding，与 scrollHeight 取大
      let h = 0;
      for (const c of el.children) h += c.offsetHeight;
      const cs = getComputedStyle(el);
      h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      return Math.max(el.scrollHeight, h, 0);
    };

    const apply = () => {
      if (!flip.isConnected) return;
      const flipped = wrapper.classList.contains('is-flipped');
      // 背面：用不受约束的 inner 自然总高；正面在常规流里，scrollHeight 即真高
      const target = (flipped ? measure(inner) : front.scrollHeight) + 2;
      // 已是目标高就不写 —— 让高度稳定收敛，杜绝 RO 反复触发的 loop 警告
      const cur = parseFloat(flip.style.height);
      if (Number.isFinite(cur) && Math.abs(cur - target) <= 1) return;
      flip.style.height = `${target}px`;
    };

    const flipped = wrapper.classList.contains('is-flipped');

    // 移除上一次遗留的"收回后清高度"监听 —— 否则它会在下一次（翻到背面的）
    // 高度过渡结束时误触发，把背面高度清成正面高度（"翻面只显示一半"根因）
    if (flip._npcHeightClear) {
      flip.removeEventListener('transitionend', flip._npcHeightClear);
      flip._npcHeightClear = null;
    }

    // ResizeObserver：翻到背面时持续盯 inner，任何重排（字体/编辑/内容）后自动校正。
    // 回调里的 DOM 写延到下一帧（rAF），把写操作移出 RO 投递周期，
    // 否则同步改高会让浏览器报 "ResizeObserver loop completed..."。
    if (this._flipRO && typeof ResizeObserver !== 'undefined') {
      let ro = this._flipRO.get(wrapper);
      if (ro) ro.disconnect();
      if (flipped) {
        let roPending = false;
        ro = new ResizeObserver(() => {
          if (roPending) return;
          roPending = true;
          requestAnimationFrame(() => {
            roPending = false;
            if (wrapper.classList.contains('is-flipped')) apply();
          });
        });
        ro.observe(inner);
        this._flipRO.set(wrapper, ro);
      }
    }

    // 双 rAF 先量一次（动画起点），ResizeObserver 随后兜底校正
    requestAnimationFrame(() => requestAnimationFrame(() => {
      apply();
      if (!flipped) {
        const onEnd = ev => {
          if (ev.target !== flip || ev.propertyName !== 'height') return;
          flip.removeEventListener('transitionend', onEnd);
          if (flip._npcHeightClear === onEnd) flip._npcHeightClear = null;
          // 关键：过渡结束时若已被翻回背面，绝不清高度（清了背面就塌成正面高）
          if (wrapper.classList.contains('is-flipped')) return;
          flip.style.height = '';
        };
        flip._npcHeightClear = onEnd;
        flip.addEventListener('transitionend', onEnd);
      }
    }));
  },

  /**
   * 局部刷新某 NPC 卡的「动态」pane（state 字段变更时调用，避免整卡重建）
   */
  refreshStatePane(npcId) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;
    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;
    const npcData = npcStore.get(npcId);
    if (!npcData) return;
    // v3 卡：局部刷新正面状态区，保留翻面态、不重建整卡
    const front = cardWrapper.querySelector('.npc-front-state');
    if (front) {
      front.innerHTML = npcCardRenderer._renderFrontState(npcData);
    }
  },

  /**
   * 定点刷新主角卡背面的「状态栏数值镜像」段（.npc-hero-mirror）。仿 refreshStatePane：
   * 只换镜像节点、不整渲整卡 → 保留 is-flipped / is-editing。每回合 AI_STATE_PANEL_UPDATED 调用。
   */
  refreshHeroStatusMirror() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;
    const heroWrapper = container.querySelector('.npc-card-wrapper.npc-protagonist');
    // 编辑中不打断（输入态优先）
    if (!heroWrapper || heroWrapper.classList.contains('is-editing')) return;
    const heroId = heroWrapper.dataset.npcId;
    if (!heroId || !npcStore.get(heroId)) return;
    const newHtml = npcCardRenderer._renderHeroStatusMirror();
    const existing = heroWrapper.querySelector('.npc-hero-mirror');
    if (existing) {
      if (newHtml) existing.outerHTML = newHtml;
      else existing.remove();
    } else if (newHtml) {
      // 之前无镜像（状态空）、现在有了：追加进背面 body
      const backBody = heroWrapper.querySelector('.npc-card-back .npc-back-body');
      if (backBody) backBody.insertAdjacentHTML('beforeend', newHtml);
    }
    // 仅翻到背面时高度可能变 → 重算翻面高度
    if (heroWrapper.classList.contains('is-flipped')) this._setFlipHeight(heroWrapper);
  },

  /**
   * 定点刷新主角卡正面状态区（正面「位置」镜像状态栏真源 → 每回合跟刷）。仿 refreshHeroStatusMirror：
   * 只换 .npc-front-state、不整渲整卡 → 保留翻面态。主角正面无可编辑字段（编辑态字段都在背面），
   * 故不需 is-editing 守卫。主角不跑 NPC reaction → 不收 NPC_STATE_UPDATED，故挂在 AI_STATE_PANEL_UPDATED。
   */
  refreshHeroFrontState() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;
    const heroWrapper = container.querySelector('.npc-card-wrapper.npc-protagonist');
    if (!heroWrapper) return;
    const heroId = heroWrapper.dataset.npcId;
    if (!heroId || !npcStore.get(heroId)) return;
    this.refreshStatePane(heroId);
  },

  /**
   * 字段「复核」入口：让 AI 据当前剧情重判该字段。位置（current_location）走即时写路径；
   * 身份字段走 queueUpdate 待审批。复核值来自 AI 调用（非玩家手写），不破状态层红线。
   * per-NPC:field in-flight 守卫防连点；调用中按钮 disabled + loading。
   */
  async _handleFieldRecheck(npcId, field, btn) {
    if (!window.aiService) return;
    const key = `${npcId}:${field}`;
    this._recheckInFlight = this._recheckInFlight || new Set();
    if (this._recheckInFlight.has(key)) return;
    this._recheckInFlight.add(key);
    if (btn) { btn.disabled = true; btn.classList.add('is-loading'); }
    const cardWrapper = btn ? btn.closest('.npc-card-wrapper') : null;
    const en = window.i18nService?.getResolvedLanguage?.() === 'en';
    const toast = msg => { if (typeof showToast === 'function') showToast(msg); };
    const controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    // 复核要 await 一个 AI 调用（数秒）。期间玩家可能在存档台跳到别的时间线点 / 切档——若复核结果回来后还
    // 往【已被还原的】状态上写，会把陈旧复核烤进当前快照并存盘（对抗审查 #7）。捕获当前所在点，落定后比对、变了就丢弃。
    const baseUid = (typeof window.currentTurnChatUid === 'function') ? window.currentTurnChatUid() : null;
    try {
      if (field === 'current_location') {
        await this._recheckLocation(npcId, controller?.signal || null, en, toast, baseUid);
      } else if (field === 'recent_thoughts') {
        await this._recheckThought(npcId, controller?.signal || null, en, toast, baseUid);
      } else {
        await this._recheckIdentityField(npcId, field, cardWrapper, controller?.signal || null, en, toast, baseUid);
      }
    } catch (err) {
      console.warn('[Recheck] 失败:', err);
      toast(en ? 'Recheck failed' : '复核失败');
    } finally {
      this._recheckInFlight.delete(key);
      // 按钮可能已被 showPendingUI / refreshStatePane 重建（DOM detached）——对旧引用赋值是无害 no-op。
      if (btn) { btn.disabled = false; btn.classList.remove('is-loading'); }
    }
  },

  /** 位置复核（状态层 → 即时写）：① applyReactionToState 即时显示；② PZGM 写回引擎存档 states[id]，
   *  否则下回合投影盖回旧值；react 记一笔反应日志保回滚一致。绑当前回合 turnUID。 */
  async _recheckLocation(npcId, signal, en, toast, baseUid) {
    const result = await window.aiService._runNpcLocateRecheck(npcId, signal);
    // 落定后位置变了（玩家跳了时间线/切了档）→ 丢弃，绝不往已还原的状态上写陈旧复核。
    if (typeof window.currentTurnChatUid === 'function' && window.currentTurnChatUid() !== baseUid) return;
    if (!result || !result.location || (typeof result.confidence === 'number' && result.confidence < 0.4)) {
      toast(en ? "Couldn't determine a new location — left unchanged" : '未能确定新位置，已保持原状');
      return;
    }
    const npcData = npcStore.get(npcId);
    const name = npcData?.card?.name || npcData?.name || npcId;
    const turnUID = this._currentTurnUID();
    // ① 即时显示（唯一合法 AI 写状态字段入口；发 NPC_STATE_UPDATED → refreshStatePane 自动刷新卡片）
    npcStore.applyReactionToState(npcId, { location: result.location }, turnUID);
    // ② 熬过下回合的引擎投影
    const isPzgm = !!(window.StoryEngineFlag && window.StoryEngineFlag.isPzgm && window.StoryEngineFlag.isPzgm());
    if (isPzgm) {
      try {
        const store = window.ServiceRegistry?.get?.('pzgmState');
        const save = store?.get?.();
        if (save && save.npcState) {
          const st = save.npcState.states || (save.npcState.states = {});
          if (st[npcId]) {
            st[npcId].location = result.location;
          } else {
            // 引擎还没给它建 state（刚召唤/刚建卡的窗口）：建一条带复核位置的最小 state。
            // 引擎之后 load_predefined 走 execLoadPredefined 的 else 分支（states[id] 已存在），
            // 只补 ever_present/lastPresentTurn、【不动 location】→ 复核位置不被盖回（修 review #2）。
            st[npcId] = { mood: '', current_intention: null, location: result.location, memory: [] };
          }
          store.set(save);
        }
      } catch (err) { console.warn('[Recheck] 写引擎存档失败:', err); }
    } else {
      // react 老局：成对记反应日志（回滚 restoreAll 时与状态快照对同一 turnUID 一致）
      try { window.npcReactionStore?.addReaction?.(turnUID, npcId, name, '', { location: result.location }); } catch (_) {}
    }
    // NPC 复核是回合外改 store → 先刷新当前回合的时间线快照（否则回退会丢这次复核，见审查 M2），再存盘。
    try { window.repushCurrentTurnSnapshot?.(); } catch (_) {}
    if (typeof window.autoSaveGame === 'function') { try { window.autoSaveGame(); } catch (_) {} }
    const _locTxt = window.locationTriad ? window.locationTriad.formatTriad(result.location) : result.location;
    toast(en ? `Location updated: ${_locTxt}` : `已更新位置：${_locTxt}`);
  },

  /** 念头复核（状态层 → 即时写 + 替换累积）：让 AI 据当前剧情重算【一条】当前念头。
   *  ① applyReactionToState({inner_thought}) 写卡面（唯一合法 AI 写入口，cap 5，绑当前回合 UID、发
   *     NPC_STATE_UPDATED → refreshStatePane 自动刷新）；② PZGM 把引擎存档 states[id].memory 整个
   *     REPLACE 成 [thought]——既清掉残留记忆、又收住「念头无上限累积」，且不被下回合投影盖回。
   *  绑当前回合 turnUID → 与删除/重新生成回退一致（回退该回合会一并回退这次复核）。 */
  async _recheckThought(npcId, signal, en, toast, baseUid) {
    const result = await window.aiService._runNpcThoughtRecheck(npcId, signal);
    if (typeof window.currentTurnChatUid === 'function' && window.currentTurnChatUid() !== baseUid) return;
    if (!result || !result.thought) {
      toast(en ? "Couldn't determine a new thought — left unchanged" : '未能确定新念头，已保持原状');
      return;
    }
    const npcData = npcStore.get(npcId);
    const name = npcData?.card?.name || npcData?.name || npcId;
    const turnUID = this._currentTurnUID();
    // ① 卡面：唯一合法 AI 写状态字段入口（push + cap 5）。下回合引擎投影会按下面替换后的 memory 收敛成单条。
    npcStore.applyReactionToState(npcId, { inner_thought: result.thought }, turnUID);
    // ② 熬过下回合的引擎投影 + 收住累积：整个替换引擎 memory
    const isPzgm = !!(window.StoryEngineFlag && window.StoryEngineFlag.isPzgm && window.StoryEngineFlag.isPzgm());
    if (isPzgm) {
      try {
        const store = window.ServiceRegistry?.get?.('pzgmState');
        const save = store?.get?.();
        if (save && save.npcState) {
          const st = save.npcState.states || (save.npcState.states = {});
          if (st[npcId]) {
            st[npcId].memory = [result.thought]; // REPLACE：清残留 + 收住无上限累积
          } else {
            // 引擎还没给它建 state（刚召唤/刚建卡的窗口）：建一条带复核念头的最小 state。
            st[npcId] = { mood: '', current_intention: null, location: null, memory: [result.thought] };
          }
          store.set(save);
        }
      } catch (err) { console.warn('[Recheck] 写引擎念头失败:', err); }
    } else {
      // react 老局：成对记反应日志（回滚 restoreAll 时与状态快照对同一 turnUID 一致）
      try { window.npcReactionStore?.addReaction?.(turnUID, npcId, name, '', { inner_thought: result.thought }); } catch (_) {}
    }
    // NPC 复核是回合外改 store → 先刷新当前回合的时间线快照（否则回退会丢这次复核，见审查 M2），再存盘。
    try { window.repushCurrentTurnSnapshot?.(); } catch (_) {}
    if (typeof window.autoSaveGame === 'function') { try { window.autoSaveGame(); } catch (_) {} }
    toast(en ? 'Thought rechecked' : '已复核念头');
  },

  /** 身份字段复核（身份层）：玩家主动点的 → AI 重判后【直接生效】，不走审批（玩家此刻就是要换）。
   *  updateField 写 host 卡（合法写入口、自带主角白名单门）；PZGM 同步进引擎存档 card（否则下回合
   *  GM/引擎仍按旧值叙事，仿主角 host→引擎镜像）；定点刷新显示（不整渲、不丢翻面）。 */
  async _recheckIdentityField(npcId, field, cardWrapper, signal, en, toast, baseUid) {
    const npcData = npcStore.get(npcId);
    if (!npcData) return;
    let curVal = npcData.card?.[field];
    if (field === 'cognitive_state' && (curVal == null || curVal === '') && window.characterFields) {
      curVal = window.characterFields.readCognitiveState(npcData.card);
    }
    const label = (typeof npcCardRenderer._getFieldLabel === 'function') ? npcCardRenderer._getFieldLabel(field) : field;
    const result = await window.aiService._runNpcFieldRecheck(npcId, field, label, curVal ?? '', signal);
    // 落定后位置变了（玩家跳了时间线/切了档）→ 丢弃，绝不往已还原的状态上写陈旧复核。
    if (typeof window.currentTurnChatUid === 'function' && window.currentTurnChatUid() !== baseUid) return;
    if (!result || !result.newValue) {
      toast(en ? "Couldn't determine an update — left unchanged" : '未能确定，已保持原状');
      return;
    }
    if (!result.changed) {
      toast(en ? `No change needed for "${label}"` : `「${label}」无需更新`);
      return;
    }
    // 直接生效：updateField 是合法 host 写入口，主角非白名单字段会被它挡下返回 false。
    const ok = npcStore.updateField(npcId, field, result.newValue);
    if (!ok) {
      toast(en ? 'Recheck not applicable to this field' : '该字段不可复核');
      return;
    }
    // PZGM：同步进引擎存档 card，否则下回合 GM/引擎仍按旧值（仿主角 host→引擎镜像，patch 单字段保留其余键）。
    if (window.StoryEngineFlag && window.StoryEngineFlag.isPzgm && window.StoryEngineFlag.isPzgm()) {
      try {
        const store = window.ServiceRegistry?.get?.('pzgmState');
        const save = store?.get?.();
        if (save?.npcState?.cards?.[npcId]) {
          save.npcState.cards[npcId][field] = result.newValue;
          store.set(save);
        }
      } catch (err) { console.warn('[Recheck] 写引擎卡失败:', err); }
    }
    // NPC 复核是回合外改 store → 先刷新当前回合的时间线快照（否则回退会丢这次复核，见审查 M2），再存盘。
    try { window.repushCurrentTurnSnapshot?.(); } catch (_) {}
    if (typeof window.autoSaveGame === 'function') { try { window.autoSaveGame(); } catch (_) {} }
    // 定点刷新显示（不整渲 → 不丢翻面/编辑态）：换该字段 span 文本；cognitive_state 同步正面 banner 镜像。
    if (cardWrapper) {
      const sel = (window.CSS && CSS.escape) ? CSS.escape(field) : field;
      const span = cardWrapper.querySelector(`.npc-editable[data-field="${sel}"]`);
      if (span) span.textContent = result.newValue;
      if (field === 'cognitive_state') {
        const front = cardWrapper.querySelector('.npc-cognitive-text');
        if (front) front.textContent = result.newValue || '—';
      }
    }
    toast(en ? `Updated "${label}"` : `已更新「${label}」`);
  },

  /** 当前回合 UID = 最近一条 AI 消息的 uid（复核绑此回合，回退该回合时一起回退）。 */
  _currentTurnUID() {
    const hist = (typeof chatHistory !== 'undefined' && Array.isArray(chatHistory))
      ? chatHistory
      : (Array.isArray(window.chatHistory) ? window.chatHistory : []);
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i] && hist[i].sender === 'ai' && hist[i].uid) return hist[i].uid;
    }
    return null;
  },

  // ==========================================
  // 工具方法
  // ==========================================

  /**
   * 转义 HTML 属性值 - 防止 XSS 攻击
   */
  escapeAttr(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  },

  _formatPendingValue(value) {
    return value === null || value === undefined || value === '' ? '(空)' : String(value);
  },

  _getPendingHeaderText(pendingInfo) {
    const changes = pendingInfo?.changes || {};
    const turns = [
      ...new Set(
        Object.values(changes)
          .map(change => Number(change?.turn))
          .filter(turn => Number.isFinite(turn) && turn > 0)
      ),
    ].sort((a, b) => a - b);

    if (turns.length === 1) {
      return `AI 请求更新 (T${turns[0]})`;
    }
    if (turns.length > 1) {
      return 'AI 请求更新 (多轮更新)';
    }
    return 'AI 请求更新';
  },

  _getCardBadgeState(npcId) {
    const container = document.getElementById('npc-card-container');
    if (!container) return null;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    const badge = cardWrapper?.querySelector('.npc-badge');
    if (!badge) return null;

    const badgeType =
      ['new', 'update', 'approved', 'restore'].find(type => badge.classList.contains(type)) ||
      'new';
    const turnMatch = badge.textContent?.match(/T(\d+)/);

    return {
      badgeType,
      turn: turnMatch ? Number(turnMatch[1]) : 0,
      uid: badge.dataset.uid || null,
    };
  },

  refreshCard(npcId, options = {}) {
    const npcData = npcStore.get(npcId);
    if (!npcData) return;

    const currentBadge = this._getCardBadgeState(npcId);
    const badgeType = options.badgeType || currentBadge?.badgeType || 'new';
    const turn = options.turn ?? currentBadge?.turn ?? npcData._lastTurn ?? 0;
    const uid = options.uid ?? currentBadge?.uid ?? npcData._lastUID ?? null;
    const pendingInfo = npcStore.getPending(npcId);

    this.renderCard(npcId, npcData, turn, uid, false, badgeType, !!options.insertAtEnd);
    if (pendingInfo) {
      this.showPendingUI(npcId, pendingInfo);
    }
  },

  // ==========================================
  // 渲染方法
  // ==========================================

  /**
   * 渲染单个 NPC 卡片
   * @param {string} npcId - NPC ID
   * @param {Object} npcData - NPC 数据
   * @param {number} turn - 轮次
   * @param {string} uid - UID
   * @param {boolean} isUpdate - 是否为更新
   * @param {string} badgeType - 徽章类型 ('new', 'update', 'approved', 'restore')
   * @param {boolean} insertAtEnd - 是否插入到末尾（用于恢复时保持顺序）
   */
  renderCard(
    npcId,
    npcData,
    turn = 0,
    uid = null,
    _isUpdate = false,
    badgeType = 'new',
    insertAtEnd = false
  ) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    // 清除空状态提示
    const emptyMsg = container.querySelector('.npc-empty');
    if (emptyMsg) emptyMsg.remove();

    // 主角现在是一条真 NPC（card.is_protagonist === true）：渲染成 hero 卡、置顶、无徽章/勾选/拖拽
    const isProtagonist = npcData?.card?.is_protagonist === true;

    // 生成卡片 HTML（renderer 见 card.is_protagonist 自动走 isHero 样式）
    let cardHtml = npcCardRenderer.render(npcData);

    // 添加徽章
    const uidAttr = uid ? ` data-uid="${this.escapeAttr(uid)}"` : '';
    const badgeLabels = {
      new: 'NEW',
      update: 'UPDATE',
      approved: 'APPROVED',
      restore: 'RESTORE',
    };
    const badgeLabel = badgeLabels[badgeType] || 'NEW';
    const badgeHtml = `<span class="npc-badge ${badgeType}"${uidAttr}>${badgeLabel}: T${turn}</span>`;

    if (!isProtagonist) {
      cardHtml = cardHtml.replace(
        '<div class="npc-card-header">',
        '<div class="npc-card-header">' + badgeHtml
      );
    }

    const safeId = this.escapeAttr(npcId);
    const existingCard = container.querySelector(`[data-npc-id="${safeId}"]`);
    const isSelected = npcStore.isSelected(npcId);

    if (existingCard) {
      // 更新现有卡片
      existingCard.outerHTML = isProtagonist
        ? `<div class="npc-card-wrapper npc-protagonist" data-npc-id="${safeId}" draggable="false">${cardHtml}</div>`
        : `<div class="npc-card-wrapper${isSelected ? '' : ' unselected'}" data-npc-id="${safeId}" draggable="true">${cardHtml}</div>`;

      // 更新选中按键状态
      if (!isSelected) {
        const updatedCard = container.querySelector(`[data-npc-id="${safeId}"]`);
        const selectBtn = updatedCard?.querySelector('[data-action~="npc-select-btn"]');
        if (selectBtn) {
          selectBtn.classList.remove('selected');
          selectBtn.textContent = '⬜';
          selectBtn.title = '未选中 - 点击选中';
        }
      }
    } else {
      // 添加新卡片
      const wrapper = document.createElement('div');
      if (isProtagonist) {
        // 主角卡：永远置顶、不可拖拽、不参与勾选（无 insertAtEnd 语义）
        wrapper.className = 'npc-card-wrapper npc-protagonist';
        wrapper.dataset.npcId = npcId;
        wrapper.draggable = false;
        wrapper.innerHTML = cardHtml;
        container.insertBefore(wrapper, container.firstChild);
      } else {
        wrapper.className = `npc-card-wrapper${isSelected ? '' : ' unselected'}`;
        wrapper.dataset.npcId = npcId;
        wrapper.draggable = true;
        wrapper.innerHTML = cardHtml;

        // insertAtEnd 用于恢复时保持顺序，否则插入到顶部（但永远在主角卡之下）
        if (insertAtEnd) {
          container.appendChild(wrapper);
        } else {
          // 插到第一张「普通 NPC 卡」之前 = 新 NPC 落在 NPC 区顶部、却永远在主角卡之下。
          // 没有其他普通 NPC 卡时（只剩主角卡 / 空容器）一律 appendChild：主角卡在场 → 落其后，
          // 空容器 → 成为唯一卡。绝不能 insertBefore(container.firstChild) —— 主角卡是唯一/末位
          // 子节点时 nextSibling 为 null，旧的 `nextSibling || firstChild` 兜底会指回主角卡本身，
          // 把新 NPC 插到主角之上（开局先登记主角、随后首个 NPC 登场时主角被挤到第二的根因）。
          const firstNpc = container.querySelector(
            '.npc-card-wrapper:not(.npc-protagonist)'
          );
          if (firstNpc) {
            container.insertBefore(wrapper, firstNpc);
          } else {
            container.appendChild(wrapper);
          }
        }
      }

      // 如果未选中，更新按键状态（npcCardRenderer 默认是选中状态）
      if (!isSelected) {
        const selectBtn = wrapper.querySelector('[data-action~="npc-select-btn"]');
        if (selectBtn) {
          selectBtn.classList.remove('selected');
          selectBtn.textContent = '⬜';
          selectBtn.title = '未选中 - 点击选中';
        }
      }
    }

    // 应用当前 active tab（profile / state）到这张卡
    const finalWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (finalWrapper) this._applyTabToCard(finalWrapper);
  },

  /**
   * 移除卡片
   * @param {string} npcId - NPC ID
   * @param {boolean} animate - 是否动画
   */
  removeCard(npcId, animate = true) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;

    if (animate) {
      cardWrapper.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      cardWrapper.style.opacity = '0';
      cardWrapper.style.transform = 'scale(0.9)';

      setTimeout(() => {
        cardWrapper.remove();
        this._checkEmpty(container);
      }, 300);
    } else {
      cardWrapper.remove();
      this._checkEmpty(container);
    }
  },

  /**
   * 显示待审批 UI
   * @param {string} npcId - NPC ID
   * @param {Object} pendingInfo - 待审批信息
   */
  showPendingUI(npcId, pendingInfo) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;

    // 移除已有的待审批 UI
    const existingUI = cardWrapper.querySelector('.npc-pending-update');
    if (existingUI) existingUI.remove();

    if (!pendingInfo || !pendingInfo.changes) {
      cardWrapper.classList.remove('has-pending-update');
      return;
    }

    const pendingFields = Object.keys(pendingInfo.changes);
    if (pendingFields.length === 0) {
      cardWrapper.classList.remove('has-pending-update');
      return;
    }

    // 生成变更列表 HTML
    let changesHtml = '';
    for (const field of pendingFields) {
      const change = pendingInfo.changes[field];
      const oldVal = this._formatPendingValue(change.old);
      const newVal = this._formatPendingValue(change.new);
      const safeField = this.escapeAttr(field);
      changesHtml += `<div class="pending-change-item" data-field="${safeField}">
                <div class="pending-change-info">
                    <span class="pending-field">${safeField}:</span>
                    <span class="pending-old">${this.escapeAttr(oldVal)}</span>
                    <span class="pending-arrow">-></span>
                    <span class="pending-new">${this.escapeAttr(newVal)}</span>
                </div>
                <div class="pending-field-actions">
                    <button class="btn-ghost btn-icon btn-sm" data-action="approve-pending-field" data-npc-id="${safeId}" data-field="${safeField}" title="接受此项"><span class="material-symbols-outlined">check</span></button>
                    <button class="btn-danger btn-icon btn-sm" data-action="reject-pending-field" data-npc-id="${safeId}" data-field="${safeField}" title="拒绝此项"><span class="material-symbols-outlined">close</span></button>
                </div>
            </div>`;
    }

    // 创建待审批 UI
    const pendingUI = document.createElement('div');
    pendingUI.className = 'npc-pending-update';
    pendingUI.innerHTML = `
            <div class="pending-header">
                <span class="pending-icon">⚠️</span>
                <span class="pending-title">${this._getPendingHeaderText(pendingInfo)}</span>
                <span class="pending-count">${pendingFields.length} 项待审</span>
            </div>
            <div class="pending-changes">${changesHtml}</div>
        `;

    cardWrapper.appendChild(pendingUI);
    cardWrapper.classList.add('has-pending-update');
    // 有待审批：自动翻到背面（审批字段多在身份层），审批 diff 段已接在卡下方
    cardWrapper.classList.add('is-flipped');
    this._setFlipHeight(cardWrapper);
  },

  /**
   * 移除待审批 UI
   * @param {string} npcId - NPC ID
   */
  removePendingUI(npcId) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (cardWrapper) {
      const pendingUI = cardWrapper.querySelector('.npc-pending-update');
      if (pendingUI) pendingUI.remove();
      cardWrapper.classList.remove('has-pending-update');
    }
  },

  /**
   * 更新卡片选中状态样式
   * @param {string} npcId - NPC ID
   * @param {boolean} selected - 是否选中
   */
  updateCardSelection(npcId, selected) {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const safeId = this.escapeAttr(npcId);
    const cardWrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
    if (!cardWrapper) return;

    cardWrapper.classList.toggle('unselected', !selected);

    const selectBtn = cardWrapper.querySelector('[data-action~="npc-select-btn"]');
    if (selectBtn) {
      selectBtn.classList.toggle('selected', selected);
      const emoji = selected ? '✅' : '⬜';
      // v3 卡按钮带文字标签；旧内联卡保持纯 emoji
      if (selectBtn.classList.contains('npc-back-btn')) {
        const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
        const label = selected ? (isEn ? 'Selected' : '选中') : (isEn ? 'Select' : '选择');
        selectBtn.textContent = `${emoji} ${label}`;
      } else {
        selectBtn.textContent = emoji;
      }
      selectBtn.title = selected ? '已选中 - 点击取消' : '未选中 - 点击选中';
    }
  },

  /**
   * 清空面板 UI
   */
  clearUI() {
    const container = document.getElementById('npc-card-container');
    if (container) {
      const emptyText = window.i18nService?.t?.('sidebar.npcEmpty') || '暂无角色信息';
      container.innerHTML = `<div class="npc-empty">${emptyText}</div>`;
    }
  },

  /**
   * 从存档恢复 UI (根据 store 数据重新渲染)
   */
  restoreUI() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    container.innerHTML = '';

    const order = npcStore.getOrder();
    if (order.length === 0) {
      if (!container.querySelector('.npc-card-wrapper')) {
        const emptyText = window.i18nService?.t?.('sidebar.npcEmpty') || '暂无角色信息';
        container.innerHTML = `<div class="npc-empty">${emptyText}</div>`;
      }
      return;
    }

    for (const npcId of order) {
      const npcData = npcStore.get(npcId);
      if (!npcData) continue;

      const turn = npcData._lastTurn || 0;
      const uid = npcData._lastUID || null;

      // insertAtEnd=true 保持存档中的顺序
      this.renderCard(npcId, npcData, turn, uid, false, 'restore', true);
    }
  },

  /**
   * 检查是否为空并显示提示
   */
  _checkEmpty(container) {
    if (!container.querySelector('.npc-card-wrapper')) {
      const emptyText = window.i18nService?.t?.('sidebar.npcEmpty') || '暂无角色信息';
      container.innerHTML = `<div class="npc-empty">${emptyText}</div>`;
    }
  },

  /**
   * 从 DOM 更新排序到 store
   */
  _updateOrderFromDOM() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    const cards = container.querySelectorAll('.npc-card-wrapper');
    const newOrder = Array.from(cards)
      .map(card => card.dataset.npcId)
      .filter(id => id);
    npcStore.reorder(newOrder);
  },

  // ==========================================
  // 初始化
  // ==========================================

  /**
   * 初始化 - 绑定事件和订阅 store
   */
  init() {
    const container = document.getElementById('npc-card-container');
    if (!container) return;

    // ========================================
    // 通过 EventBus 订阅 NPC 事件
    // ========================================

    eventBus.on(GameEvents.NPC_ADDED, ({ npcId, data, turn, uid, isUpdate }) => {
      this.renderCard(npcId, data, turn, uid, isUpdate, isUpdate ? 'update' : 'new');
    });

    eventBus.on(GameEvents.NPC_DELETED, ({ npcId, npcName }) => {
      this.removeCard(npcId, true);
      if (npcName && typeof showToast === 'function') {
        showToast(`已删除角色: ${npcName}`);
      }
    });

    eventBus.on(GameEvents.NPC_PENDING, ({ npcId, pendingInfo }) => {
      this.showPendingUI(npcId, pendingInfo);
    });

    eventBus.on(GameEvents.NPC_PENDING_CLEARED, ({ npcId }) => {
      this.removePendingUI(npcId);
    });

    eventBus.on(GameEvents.NPC_APPROVED, ({ npcId, turn, uid }) => {
      if (!npcStore.get(npcId)) return;
      // 编辑中不整渲：refreshCard 走 outerHTML 重建会抹掉未保存的 contenteditable 文本（autoApprove +
      // 正编辑主角卡 + 同回合 GM 提案落地三者同时命中时）。对齐下方 AI_STATE_PANEL_UPDATED 的守卫；
      // 退出编辑后由 focusout/保存路径补刷。
      const safeId = this.escapeAttr(npcId);
      const wrapper = container.querySelector(`[data-npc-id="${safeId}"]`);
      if (wrapper && wrapper.classList.contains('is-editing')) return;
      this.refreshCard(npcId, { badgeType: 'approved', turn, uid });
    });

    eventBus.on(GameEvents.NPC_SELECTED, ({ npcId, selected }) => {
      this.updateCardSelection(npcId, selected);
    });

    eventBus.on(GameEvents.NPC_CLEARED, () => {
      this.clearUI();
    });

    eventBus.on(GameEvents.NPC_RESTORED, () => {
      this.restoreUI();
    });

    // state 层更新（NPC reaction 落地）：只刷该 NPC 卡的「动态」pane，不重建整卡
    if (GameEvents.NPC_STATE_UPDATED) {
      eventBus.on(GameEvents.NPC_STATE_UPDATED, ({ npcId }) => {
        this.refreshStatePane(npcId);
      });
    }

    // 状态栏面板更新：定点刷新主角卡的状态栏数值镜像（只读）。主角不跑 NPC reaction → 不会收到
    // NPC_STATE_UPDATED，故单独挂此事件。用定点刷新（不整渲）→ 不丢翻面/编辑态（≈每回合都发此事件，
    // 整渲会把正翻看背面的用户弹回正面）。
    if (GameEvents.AI_STATE_PANEL_UPDATED) {
      eventBus.on(GameEvents.AI_STATE_PANEL_UPDATED, () => {
        this.refreshHeroStatusMirror();
        this.refreshHeroFrontState(); // 主角正面「位置」镜像状态栏真源 → 每回合跟刷
      });
    }

    // Tab 切换（事件委托）：点击任一卡上的 tab，所有卡同步切换（旧版兼容，v3 卡无 tab）
    container.addEventListener('click', e => {
      const tabBtn = e.target.closest('.npc-card-tab[data-tab-target]');
      if (!tabBtn) return;
      const target = tabBtn.dataset.tabTarget;
      this.setActiveTab(target);
    });

    // v3 卡：点击翻面（排除可编辑/按钮/审批段/折叠 details）
    container.addEventListener('click', e => {
      if (e.target.closest('button, [data-action], a, summary, details, .npc-pending-update')) {
        return;
      }
      const wrapper = e.target.closest('.npc-card-wrapper');
      if (!wrapper || !wrapper.querySelector('.npc-card--v3')) return;
      // 编辑态：卡片锁定在反面，点任何非按钮处都不翻
      if (wrapper.classList.contains('is-editing')) return;
      // 非编辑态：点任意处（含字段文字）都翻面
      wrapper.classList.toggle('is-flipped');
      this._setFlipHeight(wrapper);
    });

    // ========================================
    // 事件委托: 编辑/保存 切换（仅 v3 卡背面）
    // ========================================

    container.addEventListener('click', e => {
      const editBtn = e.target.closest('[data-action~="npc-edit-toggle"]');
      if (!editBtn) return;

      const cardWrapper = editBtn.closest('.npc-card-wrapper');
      if (!cardWrapper) return;

      const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
      const fields = cardWrapper.querySelectorAll('.npc-card-back .npc-editable');

      if (cardWrapper.classList.contains('is-editing')) {
        // 保存：先提交当前聚焦字段（focusout 先于本 click 已触发提交），再退出编辑态
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
          document.activeElement.blur();
        }
        cardWrapper.classList.remove('is-editing');
        fields.forEach(el => el.setAttribute('contenteditable', 'false'));
        editBtn.classList.remove('is-saving');
        editBtn.textContent = `✎ ${isEn ? 'Edit' : '编辑'}`;
        editBtn.title = isEn ? 'Edit' : '编辑';
      } else {
        cardWrapper.classList.add('is-editing');
        fields.forEach(el => el.setAttribute('contenteditable', 'true'));
        editBtn.classList.add('is-saving');
        editBtn.textContent = `✓ ${isEn ? 'Save' : '保存'}`; // ui-lint-allow: 编辑保存按钮装饰勾
        editBtn.title = isEn ? 'Save' : '保存';
        if (fields[0]) fields[0].focus();
      }
    });

    // ========================================
    // 事件委托: 删除按键
    // ========================================

    container.addEventListener('click', e => {
      const deleteBtn = e.target.closest('[data-action~="npc-btn-danger"]');
      if (!deleteBtn) return;

      const cardWrapper = deleteBtn.closest('.npc-card-wrapper');
      if (!cardWrapper) return;
      const npcId = cardWrapper.dataset.npcId;
      if (!npcId) return;

      const isEn = window.i18nService?.getResolvedLanguage?.() === 'en';
      const npcData = npcStore.get(npcId);
      const npcName = npcData?.card?.name || npcData?.name || npcId;
      const doDelete = () => npcStore.delete(npcId);
      // 活世界（PZGM）下删除=不可逆销毁，但后续剧情若 AI 判定该角色仍相关会「空白重建」其档案
      // （丢失原记忆/恩怨，回来是同名陌生人）。如实告知、不阻止（设计 §2：不留墓碑）。react 老局不适用此语义。
      const isPzgm = !!(window.StoryEngineFlag && window.StoryEngineFlag.isPzgm && window.StoryEngineFlag.isPzgm());

      if (typeof window.showConfirmModal === 'function') {
        const title = isEn ? 'Delete character' : '删除角色';
        const rebuildHint = isEn
          ? ' Note: if this character stays relevant later, the AI may rebuild their profile from scratch.'
          : '提示：后续剧情中若 AI 判定该角色依然相关，可能会重新建立其档案。';
        const desc = (isEn
          ? `Delete “${npcName}”? This action cannot be undone.`
          : `确定删除「${npcName}」？此操作不可撤销。`) + (isPzgm ? rebuildHint : '');
        window.showConfirmModal(title, desc, doDelete, null, {
          icon: '🗑️',
          confirmTone: 'danger',
          confirmLabel: isEn ? 'Delete' : '删除',
          cancelLabel: isEn ? 'Cancel' : '取消',
        });
      } else {
        doDelete();
      }
    });

    // ========================================
    // 事件委托: 选中按键
    // ========================================

    container.addEventListener('click', e => {
      const selectBtn = e.target.closest('[data-action~="npc-select-btn"]');
      if (!selectBtn) return;

      const cardWrapper = selectBtn.closest('.npc-card-wrapper');
      if (cardWrapper) {
        const npcId = cardWrapper.dataset.npcId;
        if (npcId) {
          npcStore.toggleSelected(npcId);
        }
      }
    });

    // ========================================
    // 事件委托: 在场三档（是/AI/否，活世界 §2，PZGM）
    // ========================================

    container.addEventListener('click', e => {
      const presBtn = e.target.closest('[data-action~="npc-presence-set"]');
      if (!presBtn) return;

      const cardWrapper = presBtn.closest('.npc-card-wrapper');
      const npcId = cardWrapper?.dataset.npcId;
      const mode = presBtn.dataset.presenceMode;
      if (!npcId || !mode) return;

      npcStore.setPresenceMode(npcId, mode);
      // 即时更新本组按钮 active 态（不重建整张卡，避免翻面态丢失）
      const seg = presBtn.closest('.npc-presence-seg');
      if (seg) {
        seg.querySelectorAll('.npc-presence-opt').forEach(b => {
          const on = b === presBtn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      }
      // 正面在场徽章随手动覆盖即时翻转（present/absent 加锁、auto 回到 AI 判定）。
      // 只换 .npc-front-state innerHTML，不动正在显示的背面、不丢翻面态。
      this.refreshStatePane(npcId);
    });

    // ========================================
    // 事件委托: 「在场」说明面板展开/收起（三档尾随的 ?）
    // ========================================

    container.addEventListener('click', e => {
      const helpBtn = e.target.closest('[data-action~="npc-presence-help"]');
      if (!helpBtn) return;

      const foot = helpBtn.closest('.npc-back-foot');
      const panel = foot?.querySelector('.npc-presence-help');
      if (!panel) return;

      panel.hidden = !panel.hidden;
      helpBtn.classList.toggle('is-open', !panel.hidden);
      helpBtn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');

      // 展开/收起改变背面内容高度 → 重算翻面卡高（背面正显时立即生效）
      const wrapper = helpBtn.closest('.npc-card-wrapper');
      if (wrapper) this._setFlipHeight(wrapper);
    });

    // ========================================
    // 事件委托: 字段「复核」（让 AI 据当前剧情重判该字段；值来自 AI、非手写）
    // ========================================

    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-action~="npc-field-recheck"]');
      if (!btn) return;
      const cardWrapper = btn.closest('.npc-card-wrapper');
      const npcId = cardWrapper?.dataset.npcId;
      const field = btn.dataset.field;
      if (!npcId || !field) return;
      this._handleFieldRecheck(npcId, field, btn);
    });

    // ========================================
    // 事件委托: 可编辑字段
    // ========================================

    container.addEventListener('focusout', e => {
      const editableField = e.target;
      if (!editableField || !editableField.classList.contains('npc-editable')) return;

      const cardWrapper = editableField.closest('.npc-card-wrapper');
      if (!cardWrapper) return;

      const npcId = cardWrapper.dataset.npcId;
      const fieldName = editableField.dataset.field;
      let newValue = editableField.textContent.trim();

      // 处理 cognitive_state 前缀
      if (fieldName === 'cognitive_state') {
        newValue = newValue.replace(/^⚜\s*/, '');
      }

      // 校验统一由 npcStore.updateField() 处理（integer / enum）

      // 更新到 store
      if (npcId && fieldName) {
        const updated = npcStore.updateField(npcId, fieldName, newValue);
        if (!updated) {
          // 校验失败：恢复旧值到 DOM + toast 提示
          const restoreValue = npcStore.getFieldValue(npcId, fieldName);
          editableField.textContent = restoreValue == null ? '' : String(restoreValue);
          const npcFields = window.worldMeta?.getPanelFields?.()?.panel_npc;
          const fieldDef = Array.isArray(npcFields) && npcFields.find(f => f.key === fieldName);
          if (typeof showToast === 'function') {
            showToast(`${fieldDef?.label || fieldName} 输入无效`);
          }
          return;
        }

        // 编辑成功：回写规范化后的值（如 "001" → "1"）
        const savedValue = npcStore.getFieldValue(npcId, fieldName);
        const displayValue = savedValue == null ? '' : String(savedValue);
        if (editableField.textContent !== displayValue) {
          editableField.textContent = displayValue;
        }

        if (fieldName === 'cognitive_state') {
          // 定点更新正面 banner 副标题（cognitive_state 在背面编辑、正面 .npc-cognitive-text 镜像显示）。
          // 不整渲 → 不丢翻面/编辑态（主角卡 cognitive_state 可编辑，整渲会把保存后的卡弹回正面）。
          // 显示口径与渲染一致：空值 '—'（背面 .npc-back-v 即用户编辑处，已是新值，无需再动）。
          const front = cardWrapper.querySelector('.npc-cognitive-text');
          if (front) front.textContent = displayValue || '—';
        } else if (fieldName === 'birthday') {
          this.refreshCard(npcId);
        } else {
          // 更新宽度类名（CSS Grid 自动重排相邻字段）
          const itemEl = editableField.closest('.npc-item');
          if (itemEl) {
            const label = npcCardRenderer._getFieldLabel(fieldName);
            const widthClass = npcCardRenderer.getFieldWidthClass(label, displayValue);
            itemEl.classList.remove('half', 'full');
            itemEl.classList.add(widthClass);
          }
        }
      }
    });

    // 防止回车换行
    container.addEventListener('keydown', e => {
      const editableField = e.target;
      if (!editableField || !editableField.classList.contains('npc-editable')) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        editableField.blur();
      }
    });

    // ========================================
    // 事件委托: 审批按键
    // ========================================

    container.addEventListener('click', e => {
      // 单字段批准
      const fieldApproveBtn = e.target.closest('[data-action="approve-pending-field"]');
      if (fieldApproveBtn) {
        const npcId = fieldApproveBtn.dataset.npcId;
        const field = fieldApproveBtn.dataset.field;
        if (npcId && field) {
          npcStore.approveField(npcId, field);
        }
        return;
      }

      // 单字段拒绝
      const fieldRejectBtn = e.target.closest('[data-action="reject-pending-field"]');
      if (fieldRejectBtn) {
        const npcId = fieldRejectBtn.dataset.npcId;
        const field = fieldRejectBtn.dataset.field;
        if (npcId && field) {
          npcStore.rejectField(npcId, field);
        }
        return;
      }
    });

    // ========================================
    // 拖拽排序
    // ========================================

    this._initDragAndDrop(container);
  },

  /**
   * 初始化拖拽排序
   */
  _initDragAndDrop(container) {
    let draggedItem = null;
    let placeholder = null;

    const createPlaceholder = () => {
      const el = document.createElement('div');
      el.className = 'npc-card-placeholder';
      return el;
    };

    container.addEventListener('dragstart', e => {
      const cardWrapper = e.target.closest('.npc-card-wrapper');
      if (!cardWrapper) return;

      if (e.target.closest('.npc-editable') || e.target.closest('button')) {
        e.preventDefault();
        return;
      }

      draggedItem = cardWrapper;
      draggedItem.classList.add('dragging');

      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', cardWrapper.dataset.npcId);

      setTimeout(() => {
        if (draggedItem) {
          draggedItem.style.opacity = '0.5';
        }
      }, 0);
    });

    container.addEventListener('dragend', () => {
      if (!draggedItem) return;

      draggedItem.classList.remove('dragging');
      draggedItem.style.opacity = '';

      if (placeholder && placeholder.parentNode) {
        placeholder.parentNode.removeChild(placeholder);
      }
      placeholder = null;

      // 更新排序到 store
      this._updateOrderFromDOM();

      draggedItem = null;
    });

    container.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      if (!draggedItem) return;

      // 拖拽期间若后端推送 NPC 变更触发 refreshCard/outerHTML 替换，或玩家的
      // draggedItem 被删除，原 DOM 节点会脱离 container。继续 insertBefore 会
      // 导致 "Cannot read properties of null" 或把 placeholder 插到孤儿节点旁。
      // 这里统一校验：draggedItem / placeholder / afterElement 必须仍是 container
      // 的直接子节点，否则放弃本次操作并清掉过期引用。
      if (draggedItem.parentNode !== container) {
        draggedItem = null;
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
        }
        placeholder = null;
        return;
      }

      // 若 placeholder 被外部（如 refreshCard 重绘）从 DOM 摘除，重置引用
      if (placeholder && placeholder.parentNode !== container) {
        placeholder = null;
      }

      const afterElement = this._getDragAfterElement(container, e.clientY);

      const ensurePlaceholder = () => {
        if (!placeholder) {
          placeholder = createPlaceholder();
          placeholder.style.height = `${draggedItem.offsetHeight}px`;
        }
        return placeholder;
      };

      if (afterElement === null || afterElement === undefined) {
        if (
          container.lastElementChild !== placeholder &&
          container.lastElementChild !== draggedItem
        ) {
          container.appendChild(ensurePlaceholder());
        }
      } else if (
        afterElement !== draggedItem &&
        afterElement !== placeholder &&
        afterElement.parentNode === container
      ) {
        container.insertBefore(ensurePlaceholder(), afterElement);
      }
    });

    container.addEventListener('drop', e => {
      e.preventDefault();

      if (!draggedItem || !placeholder) return;

      // 同步校验 placeholder 仍挂在 container 上（异步刷新可能摘除）
      if (placeholder.parentNode === container && draggedItem.parentNode) {
        placeholder.parentNode.insertBefore(draggedItem, placeholder);
        placeholder.parentNode.removeChild(placeholder);
      }
      placeholder = null;
    });

    container.addEventListener('dragleave', e => {
      if (e.target === container && !container.contains(e.relatedTarget)) {
        if (placeholder && placeholder.parentNode) {
          placeholder.parentNode.removeChild(placeholder);
          placeholder = null;
        }
      }
    });
  },

  /**
   * 获取拖拽后插入位置
   */
  _getDragAfterElement(container, y) {
    // 排除主角卡：它永远置顶，任何 NPC 都不能拖到它上面（保持 pinned）。
    // 把它移出候选后，拖到最顶端时落点 = 第一张非主角卡之前 = 主角之下。
    const draggableElements = [
      ...container.querySelectorAll('.npc-card-wrapper:not(.dragging):not(.npc-protagonist)'),
    ];

    return draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;

        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child };
        } else {
          return closest;
        }
      },
      { offset: Number.NEGATIVE_INFINITY }
    ).element;
  },
};

// 暴露到全局
window.npcPanelUI = npcPanelUI;

// 页面加载后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => npcPanelUI.init());
} else {
  queueMicrotask(() => npcPanelUI.init());
}
