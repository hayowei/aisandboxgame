/**
 * design/import-export.js
 * 应用与导出 — 把世界卡产物应用到游戏 / 导出为世界卡 / 从世界卡导入
 *
 * 通过 mixin 模式扩展 DesignService.prototype。所有方法实现与原 class
 * DesignService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyDesignServiceMixin 合并到 DesignService 上。
 *
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceImportExportMixin {
  // ========================================
  // 应用与导出
  // ========================================

  _validateWorldEntityDisplayNames(dc) {
    const settings = dc?.world_setting?.settings;
    if (!settings || typeof settings !== 'object') {
      return { ok: true };
    }

    const eStore = typeof window !== 'undefined' ? window.entityStore : null;
    if (!eStore || typeof eStore.inspectDisplayNames !== 'function') {
      return { ok: true };
    }

    const inspection = eStore.inspectDisplayNames(settings);
    const conflicts = Array.isArray(inspection?.conflicts) ? inspection.conflicts : [];
    const parseFailures = Array.isArray(inspection?.parseFailures) ? inspection.parseFailures : [];

    if (parseFailures.length > 0) {
      const failedIds = parseFailures
        .map(f => f.entityId)
        .filter(Boolean)
        .slice(0, 3);
      const suffix = parseFailures.length > failedIds.length ? ' 等' : '';
      const detail = failedIds.length > 0 ? `：${failedIds.join('、')}${suffix}` : '';
      return {
        ok: false,
        reason: `部分世界实体缺少标准首行，无法解析显示名${detail}`,
      };
    }

    if (conflicts.length === 0) {
      return { ok: true };
    }

    const duplicateNames = conflicts
      .map(group => group?.[0]?.parsedDisplayName || group?.[0]?.displayName || '')
      .filter(Boolean)
      .slice(0, 3);
    const suffix = conflicts.length > duplicateNames.length ? ' 等' : '';
    const detail = duplicateNames.length > 0 ? `：${duplicateNames.join('、')}${suffix}` : '';

    return {
      ok: false,
      reason: `世界实体显示名重复${detail}，请先改成不同名称`,
    };
  }

  _validateCharacterDatabaseForSnapshot(snapshot) {
    const report = this._validateCharacterDatabasePanelConsistency(
      snapshot?.step3_fields,
      snapshot?.character_database
    );
    const settings =
      snapshot?.world_setting?.settings && typeof snapshot.world_setting.settings === 'object'
        ? snapshot.world_setting.settings
        : {};
    const characterIds =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? Object.keys(snapshot.character_database).filter(
            id =>
              !id.startsWith('_') &&
              snapshot.character_database[id] &&
              typeof snapshot.character_database[id] === 'object'
          )
        : [];
    const entityIds = Object.keys(settings).filter(entityId => !entityId.startsWith('_'));
    const usesEntityPrefixes = entityIds.some(entityId =>
      characterIds.some(characterId => characterId.startsWith(`${entityId}_`))
    );
    if (usesEntityPrefixes) {
      entityIds.forEach(entityId => {
        const count = characterIds.filter(characterId =>
          characterId.startsWith(`${entityId}_`)
        ).length;
        if (count < 2) {
          report.warnings.push({
            message: `实体 ${entityId} 当前仅有 ${count} 个角色，建议至少 2 个角色支撑叙事`,
          });
        }
      });
    }
    this.stageValidationReports.character_database = report;
    return report;
  }

  _validateSnapshotBeforePersist(snapshot) {
    const workingSnapshot = JSON.parse(JSON.stringify(snapshot || {}));
    if (workingSnapshot.random_opening !== undefined) {
      delete workingSnapshot.random_opening;
    }
    const repairReport = this._repairSnapshotBeforePersist(workingSnapshot);
    this._syncRepairedSnapshotSections(snapshot, workingSnapshot);
    return { repairReport, rangeInfo: null };
  }

  /**
   * 将设计配置应用到游戏
   * 将4个结构化数据块转换为引擎可消费的格式
   */
  applyToGame() {
    const dc = this.designConfig;

    if (Object.keys(dc).length === 0) {
      showToast('没有可应用的配置');
      return;
    }

    const mgr = window.worldCardManager;
    if (!mgr) {
      showToast('worldCardManager 未加载');
      return;
    }
    const hasSubstantialContent =
      typeof mgr.hasSubstantialContent === 'function'
        ? mgr.hasSubstantialContent(dc)
        : typeof mgr._hasSubstantialContent === 'function'
          ? mgr._hasSubstantialContent(dc)
          : false;
    if (!hasSubstantialContent) {
      showToast('当前配置为空，无法应用到游戏');
      return;
    }

    const requestNameThenApply = createNew => {
      this._showWorldCardNameModal((name, description) => {
        this.worldCardName = name;
        this.worldCardDescription = description;
        this._doApplyToGame(createNew);
      });
    };

    if (this.forceCreateNewOnNextApply) {
      requestNameThenApply(true);
      return;
    }

    const sourceId = this._reimportSourceCardId;
    const sourceCard = sourceId ? mgr.get(sourceId) : null;
    const canOfferOverwrite = !!(this._allowOverwriteFromCardEdit && sourceId && sourceCard);
    if (canOfferOverwrite) {
      this._showReimportApplyModal(
        sourceCard.name,
        () => {
          // 仅“在世界卡中编辑”入口允许覆盖
          this._doApplyToGame(false);
        },
        () => {
          requestNameThenApply(true);
        }
      );
      return;
    }
    if (sourceId && !sourceCard) {
      this._reimportSourceCardId = null;
    }

    const activeId = mgr.getActiveCardId();
    const activeCard = activeId ? mgr.get(activeId) : null;

    // 游戏中改规则场景：当前激活卡 == 存档绑定卡（非内置卡）时，主动弹窗让用户选择覆盖或另存，
    // 避免默默创建新卡导致存档与卡解绑（规则丢失 bug）
    const sessionBindingId =
      window.sessionManager?.getCurrentSaveBindingWorldCardId?.() || null;
    const canOfferSessionUpdate =
      !canOfferOverwrite &&
      !!sessionBindingId &&
      !!activeId &&
      activeId === sessionBindingId &&
      !!activeCard &&
      !mgr.isBuiltInCard(sessionBindingId);
    if (canOfferSessionUpdate) {
      this._showReimportApplyModal(
        activeCard.name || '',
        () => {
          this._reimportSourceCardId = sessionBindingId;
          this._allowOverwriteFromCardEdit = true;
          this._doApplyToGame(false);
        },
        () => {
          requestNameThenApply(true);
        },
        { mode: 'session-update' }
      );
      return;
    }
    if (activeId && !activeCard) {
      console.warn('[DesignService] applyToGame 状态异常：activeId 存在但卡片不存在', { activeId });
      showToast('应用失败：当前世界卡状态异常，请刷新后重试');
      return;
    }
    // 防御性检查：疑似新建空卡但状态标志异常时，阻止假成功
    const looksLikeBrokenBlankCard =
      !!activeCard &&
      !this._reimportSourceCardId &&
      (activeCard.name || '') === '新世界' &&
      (activeCard.description || '') === '' &&
      activeCard.isEmpty !== true &&
      (activeCard.designMeta === null || activeCard.designMeta === undefined) &&
      Array.isArray(activeCard.designChatHistory) &&
      activeCard.designChatHistory.length === 0 &&
      activeCard.snapshot &&
      typeof activeCard.snapshot === 'object' &&
      Object.keys(activeCard.snapshot).length === 0;
    if (looksLikeBrokenBlankCard) {
      console.warn('[DesignService] applyToGame 状态异常：新世界空卡标志丢失', {
        activeId,
        activeCard,
      });
      showToast('应用失败：新世界卡状态异常，请重新进入“设计新世界”后重试');
      return;
    }
    // 非“在世界卡中编辑”入口：统一新建流程（空白卡则写回当前空白卡）
    const shouldUpdateActiveEmptyCard = !!(activeCard && activeCard.isEmpty === true);
    requestNameThenApply(!shouldUpdateActiveEmptyCard);
  }

  /**
   * 弹出世界卡命名弹窗
   * @param {function} onConfirm - 确认回调 (name, description) => void
   */
  _showWorldCardNameModal(onConfirm) {
    const modal = document.getElementById('worldcard-name-modal');
    const nameInput = document.getElementById('worldcard-name-input');
    const descInput = document.getElementById('worldcard-desc-input');
    const confirmBtn = document.getElementById('worldcard-name-confirm-btn');
    const cancelBtn = document.getElementById('worldcard-name-cancel-btn');
    if (!modal || !nameInput || !descInput || !confirmBtn || !cancelBtn) {
      showToast('命名弹窗未加载，无法应用');
      return;
    }

    // 预填侧栏已有的值
    nameInput.value = this.worldCardName || '';
    descInput.value = this.worldCardDescription || '';
    modal.classList.remove('hidden');
    nameInput.focus();

    // 清理旧监听器（防止重复绑定）
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newConfirmBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
      const name = nameInput.value.trim();
      const desc = descInput.value.trim();
      onConfirm(name, desc);
    });

    newCancelBtn.addEventListener('click', () => {
      modal.classList.add('hidden');
    });
  }

  /**
   * 弹出应用方式选择弹窗（覆盖原卡 / 另存为新卡）
   * @param {string} sourceCardName - 源卡名称
   * @param {function} onUpdate - 覆盖原卡回调
   * @param {function} onCreateNew - 另存为新卡回调
   * @param {{ mode?: 'reimport'|'session-update' }} [options] - mode 切换弹窗文案
   */
  _showReimportApplyModal(sourceCardName, onUpdate, onCreateNew, options = {}) {
    const modal = document.getElementById('reimport-apply-modal');
    const titleEl = modal?.querySelector('.modal-title-with-icon');
    const textEl = document.getElementById('reimport-apply-text');
    const updateBtn = document.getElementById('reimport-apply-update-btn');
    const newBtn = document.getElementById('reimport-apply-new-btn');
    const cancelBtn = document.getElementById('reimport-apply-cancel-btn');

    if (!modal || !updateBtn || !newBtn) {
      showToast('覆盖/新建弹窗未加载，无法应用');
      return;
    }

    const mode = options.mode === 'session-update' ? 'session-update' : 'reimport';
    const uiLocale = window.i18nService?.getResolvedLanguage?.() || 'zh-CN';
    const isEn = uiLocale === 'en';

    const copy = (() => {
      if (mode === 'session-update') {
        return isEn
          ? {
              title: 'Update current world rules',
              body: `You are currently playing [${sourceCardName}]. Apply the new rules to this world? All saves of this world card will use the new rules.`,
              update: 'Update current world',
              createNew: 'Save as new world',
              cancel: 'Cancel',
            }
          : {
              title: '更新当前世界的规则',
              body: `你当前正在玩【${sourceCardName}】。应用新规则到这个世界？同一个世界卡的所有存档都会使用新规则。`,
              update: '更新当前世界',
              createNew: '另存为新世界',
              cancel: '取消',
            };
      }
      return isEn
        ? {
            title: 'Save edit result',
            body: `Overwrite the edit result onto [${sourceCardName}], or save as a new world card?`,
            update: 'Overwrite original card',
            createNew: 'Save as new card',
            cancel: 'Cancel',
          }
        : {
            title: '保存编辑结果',
            body: `将编辑结果覆盖回「${sourceCardName}」，还是另存为新世界卡？`,
            update: '覆盖原世界卡',
            createNew: '另存为新世界卡',
            cancel: '取消',
          };
    })();

    if (titleEl) {
      const iconEl = titleEl.querySelector('.modal-title-icon');
      titleEl.textContent = '';
      if (iconEl) titleEl.appendChild(iconEl);
      titleEl.appendChild(document.createTextNode(' ' + copy.title));
    }
    if (textEl) {
      textEl.textContent = copy.body;
    }
    modal.classList.remove('hidden');

    // 清理旧监听器（防止重复绑定）
    const newUpdateBtn = updateBtn.cloneNode(true);
    updateBtn.parentNode.replaceChild(newUpdateBtn, updateBtn);
    const newNewBtn = newBtn.cloneNode(true);
    newBtn.parentNode.replaceChild(newNewBtn, newBtn);
    newUpdateBtn.textContent = copy.update;
    newNewBtn.textContent = copy.createNew;

    const close = () => modal.classList.add('hidden');

    newUpdateBtn.addEventListener('click', () => {
      close();
      onUpdate();
    });
    newNewBtn.addEventListener('click', () => {
      close();
      onCreateNew();
    });

    if (cancelBtn) {
      const newCancelBtn2 = cancelBtn.cloneNode(true);
      cancelBtn.parentNode.replaceChild(newCancelBtn2, cancelBtn);
      newCancelBtn2.textContent = copy.cancel;
      newCancelBtn2.addEventListener('click', close);
    }
  }

  /**
   * 实际执行应用到游戏的逻辑（由 applyToGame 或弹窗回调调用）
   * @param {boolean} forceCreateNew - 强制创建新卡（"另存为新卡"场景）
   */
  _doApplyToGame(forceCreateNew = false) {
    const dc = this.designConfig;
    const mustCreateNew = forceCreateNew || this.forceCreateNewOnNextApply;
    this.pendingGameBootstrap = null;

    // 确保 step3_fields 始终存在（用户未编辑时填充默认值）
    if (!dc.step3_fields) {
      dc.step3_fields = _cloneDefaultStep3Fields();
    }

    const snapshotValidation = this._validateSnapshotBeforePersist(dc);

    try {
      if (typeof aiService === 'undefined') {
        showToast('aiService 未加载');
        return;
      }

      // 通过 worldCardManager 创建/更新世界卡
      const mgr = window.worldCardManager;
      if (!mgr) {
        throw new Error('worldCardManager 未加载');
      }
      const chatHist = this._filterPersistableHistory(
        typeof designChatHistory !== 'undefined' ? designChatHistory : []
      );
      const meta = { phase: this.phase, p2Stage: this.p2Stage, p1Output: this.p1Output };
      const designLocale = window.i18nService?.getDesignLanguage?.() || 'zh-CN';
      const activeId = mgr.getActiveCardId();
      const activeCard = activeId ? mgr.get(activeId) : null;
      const sourceId = this._reimportSourceCardId;
      const canOverwriteSource = !!(
        this._allowOverwriteFromCardEdit &&
        sourceId &&
        mgr.get(sourceId)
      );
      const sourceRawCard = sourceId ? mgr.get(sourceId) : null;
      let shouldBootstrapNewGameOnModeExit = false;
      let createdNewCardSuccessfully = false;

      if (!mustCreateNew && canOverwriteSource) {
        // ★ reimport 覆盖路径：更新源卡（而非 activeId 卡）
        const updatePayload = {
          snapshot: dc,
          localizedContentLocale: designLocale,
          localizedName: this.worldCardName || undefined,
          localizedDescription: this.worldCardDescription || undefined,
          designChatHistory: chatHist,
          designMeta: meta,
        };
        if ((sourceRawCard?.contentLocale || 'zh-CN') === designLocale) {
          if (this.worldCardName) updatePayload.name = this.worldCardName;
          if (this.worldCardDescription) updatePayload.description = this.worldCardDescription;
        }
        const updated = mgr.update(sourceId, updatePayload);
        if (!updated) {
          showToast('应用失败：存储空间不足，世界卡未更新');
          return;
        }
        // 源卡可能不是当前激活卡，需要激活它以更新 runtime
        if (activeId !== sourceId) {
          const activateResult = mgr.setActiveCard(sourceId);
          if (!activateResult?.ok) {
            showToast(`应用失败：激活世界卡失败（${activateResult?.reason || '未知错误'}）`);
            return;
          }
        }
      } else if (!mustCreateNew && activeId && activeCard && activeCard.isEmpty === true) {
        // 仅当当前卡是空白新卡时，写回当前卡；其余场景一律新建
        const updatePayload = {
          snapshot: dc,
          localizedContentLocale: designLocale,
          localizedName: this.worldCardName || undefined,
          localizedDescription: this.worldCardDescription || undefined,
          designChatHistory: chatHist,
          designMeta: meta,
        };
        // 同步用户编辑的名称/描述到世界卡
        if ((activeCard?.contentLocale || 'zh-CN') === designLocale) {
          if (this.worldCardName) updatePayload.name = this.worldCardName;
          if (this.worldCardDescription) updatePayload.description = this.worldCardDescription;
        }
        const updated = mgr.update(activeId, updatePayload);
        if (!updated) {
          showToast('应用失败：存储空间不足，世界卡未更新');
          this.pendingGameBootstrap = null;
          return;
        }
        shouldBootstrapNewGameOnModeExit = true;
      } else {
        // 创建新卡
        const description = this.worldCardDescription || dc.world_setting?._summary || '';
        const name =
          this.worldCardName ||
          (designLocale === 'en'
            ? 'Custom World ' + new Date().toLocaleString('en-US')
            : '自定义世界 ' + new Date().toLocaleString('zh-CN'));
        const card = mgr.create(name, dc, description, {
          contentLocale: designLocale,
          designChatHistory: chatHist,
          designMeta: meta,
        });
        if (!card) {
          showToast('创建世界卡失败（存储空间不足）');
          this.pendingGameBootstrap = null;
          return;
        }
        const activateResult = mgr.setActiveCard(card.id);
        if (!activateResult?.ok) {
          showToast(`应用失败：激活新世界卡失败（${activateResult?.reason || '未知错误'}）`);
          this.pendingGameBootstrap = null;
          return;
        }
        createdNewCardSuccessfully = true;
        shouldBootstrapNewGameOnModeExit = true;
        try {
          window.analyticsService?.track?.('feature.world_card_created', {
            card_id: card.id,
            source: 'design_mode',
          });
        } catch (_) { /* noop */ }
      }

      // 清理 legacy 配置 + 刷新缓存（runtime stores 已由 worldCardManager 激活）
      this._applyStructuredConfig(dc);

      aiService.saveConfig(aiService.config);
      this._reimportSourceCardId = null; // 清空源卡引用，防止残留
      this._allowOverwriteFromCardEdit = false;
      this.forceCreateNewOnNextApply = false;
      this.phase = 'p3';
      this.resetP3History();
      this.markCompletionBaseline();
      this.clearPersistedDraft();
      this._draftSourceType = DESIGN_DRAFT_SOURCE_CARD_EDIT;
      this._saveDesignConfig({ skipIndicator: true });
      if (shouldBootstrapNewGameOnModeExit) {
        const latestActiveWorldId = mgr.getActiveCardId();
        if (latestActiveWorldId) {
          this.pendingGameBootstrap = {
            worldCardId: latestActiveWorldId,
            createdAt: new Date().toISOString(),
          };
        }
      } else {
        this.pendingGameBootstrap = null;
      }
      // 覆盖绑定卡路径：触发一次 autosave 同步存档进度与 UI（仅刷新元数据，不污染游戏内容）
      if (!shouldBootstrapNewGameOnModeExit) {
        try {
          window.sessionManager?.tryAutoSaveForTransition?.({ source: 'design_apply' });
        } catch (autosaveErr) {
          console.warn('[DesignService] apply 后 autosave 失败:', autosaveErr);
        }
      }
      // 边界约束：应用世界卡不会写入游戏存档；
      // 游戏存档仅由聊天流程或手动保存触发（autosave 由 sessionManager 自行采集，不直接拼装 saveData）。
      const repairNote = this._formatSnapshotRepairSummary(snapshotValidation.repairReport);
      showToast(repairNote ? `${repairNote}，并已应用到游戏` : '设计配置已应用到游戏');
      if (createdNewCardSuccessfully) {
        try {
          this.resetDesignConfig({ preservePendingGameBootstrap: true });
        } catch (resetErr) {
          console.error('[DesignService] 应用成功后自动重置失败:', resetErr);
        }
      }
    } catch (e) {
      console.error('[DesignService] 应用配置失败:', e);
      this.pendingGameBootstrap = null;
      showToast('应用配置失败: ' + e.message);
    }
  }

  /**
   * 应用结构化配置到引擎
   */
  _applyStructuredConfig(_dc) {
    // runtime stores 激活已由 worldCardManager.setActiveCard/update 完成，此处仅做 legacy 清理和缓存刷新

    // 兼容旧版”自定义函数接管”路径：
    // 仅当检测到 legacy 全量替换函数时才重置，避免清空用户自己的函数配置

    // prompt_modules 仅维护 Stage2 产出的规则数据（modules + module_meta + _summary）。
    // 其余 AI 服务参数（如 system_prompt_addon/step3_schema）由设置 UI 单独维护，不在此覆写。

    // 清理缓存，确保后续读取使用新数据快照
    if (typeof clearAIServiceCaches === 'function') {
      clearAIServiceCaches();
    } else {
      aiService._gmStaticCache = null;
      aiService._gmDirectiveHistory = [];
      aiService._eventsDeliveredThisScene = [];
      aiService._lastSceneLocation = null;
    }

    if (typeof timelineService !== 'undefined' && timelineService) {
      if (typeof timelineService.clearTriggeredEvents === 'function') {
        timelineService.clearTriggeredEvents();
      }
    }

    if (typeof archiveService !== 'undefined' && archiveService) {
      if (typeof archiveService.resetLoadedModules === 'function') {
        archiveService.resetLoadedModules();
      }
    }
  }

  exportConfig() {
    const config = this.getDesignConfig();

    if (Object.keys(config).length === 0) {
      showToast('没有可导出的配置');
      return;
    }

    // 使用与 worldCardManager.exportCard 一致的 envelope 格式
    const mgr = window.worldCardManager;
    const activeId = mgr?.getActiveCardId?.();
    // 如果当前有激活的世界卡，直接使用 worldCardManager.exportCard
    if (mgr && activeId) {
      const activeCard = mgr.get(activeId);
      const exportSnapshot = activeCard?.snapshot
        ? JSON.parse(JSON.stringify(activeCard.snapshot))
        : {};
      const exportValidation = this._validateSnapshotBeforePersist(exportSnapshot);
      if (activeCard?.isBuiltIn) {
        const envelope = {
          exportVersion: 1,
          exportedAt: new Date().toISOString(),
          card: {
            ...activeCard,
            snapshot: exportSnapshot,
          },
        };
        const blob = new Blob([JSON.stringify(envelope, null, 2)], {
          type: 'application/json;charset=utf-8',
        });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = `${(activeCard.name || 'worldcard').replace(/[\\/:*?"<>|]+/g, '_')}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        const repairNote = this._formatSnapshotRepairSummary(exportValidation.repairReport);
        showToast(repairNote ? `${repairNote}，并已导出世界卡` : '世界卡已导出');
        return;
      }
      const updatedCard = mgr.update(activeId, { snapshot: exportSnapshot });
      if (!updatedCard) {
        showToast('导出失败：写回随机开局时间窗失败');
        return;
      }
      mgr.exportCard(activeId);
      return;
    }

    this._validateSnapshotBeforePersist(config);

    // 尚未应用到游戏（无激活卡），手动构建 envelope
    const name = this.worldCardName || '自定义世界 ' + new Date().toLocaleString('zh-CN');
    const description = this.worldCardDescription || config.world_setting?._summary || '';
    const envelope = {
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      card: {
        id: null,
        name: name,
        description: description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isBuiltIn: false,
        snapshot: config,
        designChatHistory: this._filterPersistableHistory(
          typeof designChatHistory !== 'undefined' ? designChatHistory : []
        ),
        designMeta: { phase: this.phase, p2Stage: this.p2Stage, p1Output: this.p1Output },
      },
    };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    a.download = `worldcard_${safeName}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 获取当前阶段的开场问候语
   */
  getGreeting() {
    return _getDesignPromptValue(
      'PHASE1_GREETING',
      typeof PHASE1_GREETING !== 'undefined' ? PHASE1_GREETING : '欢迎来到设计模式。'
    );
  }

  // 向后兼容旧接口
  getGuidedGreeting() {
    return this.getGreeting();
  }
}

_applyDesignServiceMixin(_DesignServiceImportExportMixin);
