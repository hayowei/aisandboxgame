/**
 * design/p2.js
 * Phase 2 (The Builders) — 串行 4 阶段生成
 *
 * 通过 mixin 模式扩展 DesignService.prototype。所有方法实现与原 class
 * DesignService 中的版本完全一致，仅以独立 class 形式承载，文件末尾通过
 * _applyDesignServiceMixin 合并到 DesignService 上。
 *
 * 内容：4 阶段串行生成 JSON（World → Rules → Chars → Timeline），含
 * stage prompt 构建、输出解析、修复重试与基础校验。
 *
 * 加载顺序：必须在 designService.js 之后加载。
 */

class _DesignServiceP2Mixin {
  // ========================================
  // Phase 2: The Builders — 串行4阶段生成
  // ========================================

  /**
   * 生成剩余阶段的空桩数据（用于用户提前停止时填充）
   */
  _generateStubsForRemainingStages(lastCompletedStage) {
    const dc = this.designConfig;

    // Stage 3 未完成：relationship_rules 为空
    if (lastCompletedStage < 3) {
      if (!dc.relationship_rules) {
        dc.relationship_rules = {};
      }
    }

    // Stage 4 未完成：timeline + character_timelines 为空桩
    if (lastCompletedStage < 4) {
      if (!dc.timeline) {
        dc.timeline = { events: [], _summary: '无时间线' };
      }
      if (!dc.character_timelines) {
        const charTimelines = {};
        // 从 character_database 的 default_cognitive_state 提取初始认知
        if (dc.character_database && typeof dc.character_database === 'object') {
          for (const [charId, charData] of Object.entries(dc.character_database)) {
            if (charId.startsWith('_') || !charData || typeof charData !== 'object') continue;
            charTimelines[charId] = {
              cognitive: [],
              relationships: [],
              status: [],
            };
          }
        }
        dc.character_timelines = charTimelines;
      }
    }

    this._saveDesignConfig();
  }

  /**
   * Phase 2 串行管线：World → Rules → Chars+Relations → Timeline+CharTimelines
   * @param {Function} onStageComplete - 每阶段完成回调
   * @param {Function|null} onStreamChunk - 流式文本回调
   * @param {Function|null} onProgressUpdate - 进度更新回调
   * @param {Function|null} onInspectionMessage - 检查消息回调
   */
  async runPhase2Pipeline(
    onStageComplete,
    onStreamChunk = null,
    onProgressUpdate = null,
    onInspectionMessage = null
  ) {
    if (!this.p1Output) throw new Error('Phase 1 框架未就绪');
    this._assertDesignApiKeyConfigured();
    const runToken = ++this.phase2RunToken;
    if (this.phase2AbortController) {
      try {
        this.phase2AbortController.abort(new Error('Phase 2 已中止'));
      } catch (_e) {
        /* ignore */
      }
    }
    const runAbortController = new AbortController();
    this.phase2AbortController = runAbortController;
    this.activePhase2RunToken = runToken;
    this.isAutoGenerating = true;

    const stageNames = ['世界设定', '规则系统', '角色与关系', '时间线与演变'];
    const designSteps = [];

    // Phase 1 最后一次调用的快照（在 P2 API 调用覆写前保存）
    const p1Snapshot = aiService.lastDesignPayload ? { ...aiService.lastDesignPayload } : null;

    // 构建并写入 lastDesignPayload（每阶段完成后实时更新，方便调试时查看进度）
    const _updateDebugPayload = () => {
      const allSteps = [];
      if (p1Snapshot) {
        allSteps.push({
          phase: 'phase1_final',
          provider: p1Snapshot.provider,
          request: p1Snapshot.payload,
          response: p1Snapshot.response || null,
        });
      }
      allSteps.push(...designSteps);
      aiService.lastDesignPayload = { mode: 'full_auto_generate', steps: allSteps };
    };

    try {
      const startStage = this._resolvePhase2StartStage({ mutate: true });

      // Determine target stages based on complexity
      const targetStages = this.designTargetStages || this.designConfig._targetStages || PHASE2_TOTAL_STAGES;
      const complexity = this._normalizeComplexity(this.designComplexity || this.designConfig._complexity) || 'full';
      const STAGE_MODES = {
        lite: ['minimal', 'simplified', 'full', 'skip'],
        full: ['full', 'full', 'full', 'full'],
      };

      for (let stage = startStage; stage <= PHASE2_TOTAL_STAGES; stage++) {
        // Skip stage if mode is 'skip' (e.g., Stage 4 for lite)
        const stageMode = (STAGE_MODES[complexity] || STAGE_MODES.full)[stage - 1] || 'full';
        if (stageMode === 'skip') {
          // 直接生成空桩，跳过此阶段
          this._generateStubsForRemainingStages(stage - 1);
          this._updatePreviewPanel();
          try {
            onStageComplete({
              text: `${stageNames[stage - 1]}（本次选择的是快速开始模式，已跳过此环节）`,
              stageName: stageNames[stage - 1],
              stageIndex: stage,
              isLast: stage === PHASE2_TOTAL_STAGES,
              skipped: true,
            });
          } catch (_cbErr) { /* ignore */ }
          continue;
        }
        if (!this._isPhase2RunActive(runToken)) {
          throw this._createPhase2AbortError('Phase 2 在阶段开始前被中止');
        }
        this.p2Stage = stage;
        this._saveDesignConfig();

        // 构建阶段专用 prompt（传入 p1Output + 已生成的上下文 + mode）
        const stagePrompt = this._buildP2StagePrompt(stage, stageMode);
        const messages = [{ role: 'user', content: window.promptRegistry.get('design.phase2.triggerMessage').builder({}) }];
        const stageStartTs =
          typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        let stageResponse = '';
        let jsonFailureKind = null;
        let stage2Normalization = null;
        const stageRepairLog = [];

        try {
          // API 调用
          stageResponse = await aiService._callSummaryAPI(messages, stagePrompt, 'p2', {
            onChunk:
              typeof onStreamChunk === 'function'
                ? chunkText => {
                    if (!this._isPhase2RunActive(runToken)) return;
                    onStreamChunk(chunkText, stage);
                  }
                : null,
            abortSignal: runAbortController.signal,
          });
          if (!this._isPhase2RunActive(runToken)) {
            throw this._createPhase2AbortError('Phase 2 在 API 返回后被中止');
          }

          // 立即捕获本次 API 调用的请求 payload（自愈会再次覆写 lastDesignPayload，所以要在前面取）
          let apiCallSnapshot = aiService.lastDesignPayload
            ? { ...aiService.lastDesignPayload }
            : {};

          // JSON 提取（Stage 2 不做自动重试；其余阶段保留 JSON 自愈）
          const extractResult = this._extractJSON(stageResponse, {
            includeMeta: true,
            silent: true,
          });
          let parsed = extractResult.parsed;
          jsonFailureKind = extractResult.failureKind;
          if (!parsed) {
            const repaired = await this._repairJSON(stageResponse, stageNames[stage - 1], {
              abortSignal: runAbortController.signal,
              repairMode: stage === 2 ? 'stage2_modules' : '',
            });
            if (Array.isArray(repaired?.repairLog) && repaired.repairLog.length > 0) {
              stageRepairLog.push(...repaired.repairLog);
            }
            parsed = repaired.parsed;
            if (parsed) {
              jsonFailureKind = null; // 修复成功，清除失败标记，避免后续非 parse 错误被错误分类
            } else {
              jsonFailureKind = repaired.failureKind || jsonFailureKind;
            }
          }
          if (!parsed) {
            const reason = this._formatJSONFailureReason(jsonFailureKind);
            throw new Error(`${stageNames[stage - 1]} 遇到错误【原因：${reason}】`);
          }
          if (!this._isPhase2RunActive(runToken)) {
            throw this._createPhase2AbortError('Phase 2 在解析结果后被中止');
          }

          let stageValidation = null;
          let compactStageValidation = null;
          if (stage === 2) {
            stage2Normalization = this._normalizeStage2PromptModules(parsed);
            stageValidation = this._validateStage2PromptModules(parsed);
            if (stage2Normalization?.applied) {
              stageValidation.autoFixes = stage2Normalization.fixes;
            }

            // 校验失败 → 反馈重试（最多 2 次）
            const STAGE2_MAX_RETRY = 2;
            let stage2RetryAttempt = 0;
            while (!stageValidation.ok && stage2RetryAttempt < STAGE2_MAX_RETRY) {
              stage2RetryAttempt++;
              if (!this._isPhase2RunActive(runToken)) {
                throw this._createPhase2AbortError('Phase 2 在 Stage2 重试前被中止');
              }

              // 记录本次失败尝试到 debug payload
              designSteps.push({
                phase: `phase2_stage2_attempt${stage2RetryAttempt}`,
                stageName: stageNames[1],
                provider: apiCallSnapshot?.provider,
                request: apiCallSnapshot?.payload || null,
                response: stageResponse,
                parsed,
                validation: this._compactStage2Validation(stageValidation),
                normalization: stage2Normalization?.applied
                  ? { applied: true, fixes: stage2Normalization.fixes }
                  : null,
                retryTriggered: true,
              });
              _updateDebugPayload();

              // 构建修正提示 + 重试消息
              const fatalMessages = stageValidation.fatalErrors.map(e => e.message);
              const correctionPrompt = this._buildStage2CorrectionPrompt(fatalMessages);
              const retryMessages = [
                { role: 'user', content: window.promptRegistry.get('design.phase2.triggerMessage').builder({}) },
                { role: 'assistant', content: stageResponse },
                { role: 'user', content: correctionPrompt },
              ];

              console.warn(
                `[DesignService] Stage2 校验失败（第 ${stage2RetryAttempt}/${STAGE2_MAX_RETRY} 次），启动反馈重试...`,
                { fatalMessages }
              );

              // 重试 API 调用（使用相同 system prompt）
              stageResponse = await aiService._callSummaryAPI(
                retryMessages,
                stagePrompt,
                'p2',
                {
                  onChunk:
                    typeof onStreamChunk === 'function'
                      ? chunkText => {
                          if (this._isPhase2RunActive(runToken)) onStreamChunk(chunkText, stage);
                        }
                      : null,
                  abortSignal: runAbortController.signal,
                }
              );

              if (!this._isPhase2RunActive(runToken)) {
                throw this._createPhase2AbortError('Phase 2 在 Stage2 重试后被中止');
              }

              // 重新捕获 API 快照
              apiCallSnapshot = aiService.lastDesignPayload
                ? { ...aiService.lastDesignPayload }
                : {};

              // 解析重试结果
              const retryExtract = this._extractJSON(stageResponse, {
                includeMeta: true,
                silent: true,
              });
              if (!retryExtract.parsed) {
                const reason = this._formatJSONFailureReason(retryExtract.failureKind);
                jsonFailureKind = retryExtract.failureKind;
                throw new Error(
                  `${stageNames[1]} 反馈重试后 JSON 解析仍失败（${reason}）`
                );
              }
              parsed = retryExtract.parsed;

              // 重新走 normalize → validate（while 条件下次检查会决定是否再重试）
              stage2Normalization = this._normalizeStage2PromptModules(parsed);
              stageValidation = this._validateStage2PromptModules(parsed);
              if (stage2Normalization?.applied) {
                stageValidation.autoFixes = stage2Normalization.fixes;
              }
            }

            this.stageValidationReports.prompt_modules = stageValidation;
            compactStageValidation = this._compactStage2Validation(stageValidation);
            if (!stageValidation.ok) {
              const fatalSummary = stageValidation.fatalErrors.map(e => e.message).join('；');
              throw this._createDesignValidationError(
                `规则系统结构校验失败（反馈重试后仍不通过）：${fatalSummary}`,
                {
                  report: stageValidation,
                  rootCause: fatalSummary,
                  failedFields: stageValidation.fatalErrors.map(item => ({
                    moduleId: item.moduleId || null,
                    message: item.message,
                  })),
                }
              );
            }
          }

          if (stage === 3) {
            // Stage 3 now outputs { character_database: {...}, relationship_rules: {...}, _summary: "..." }
            // Extract character_database and relationship_rules from combined output
            let charDbData = parsed;
            let relationshipRulesData = null;

            if (parsed.character_database && typeof parsed.character_database === 'object') {
              // New combined format
              charDbData = parsed.character_database;
              charDbData._summary = parsed._summary || charDbData._summary;
              relationshipRulesData = parsed.relationship_rules || {};
              console.log('[DesignService] Stage3: 从合并输出中提取 character_database 和 relationship_rules');
            } else {
              // Fallback: AI output old format (flat character_database without wrapper)
              console.warn('[DesignService] Stage3: AI 输出了旧格式（无 character_database 包装），按旧格式处理');
            }

            const normalizedResult = this._normalizeStage3CharacterDatabase(charDbData);
            charDbData = normalizedResult.normalized;
            if (normalizedResult.changedCount > 0 || normalizedResult.conflictCount > 0) {
              console.warn(
                `[DesignService] Stage3 角色 ID 规范化完成: changed=${normalizedResult.changedCount}, conflicts=${normalizedResult.conflictCount}`
              );
            }
            stageValidation = this._validateCharacterDatabasePanelConsistency(
              this.designConfig.step3_fields,
              charDbData
            );
            if (
              !stageValidation.ok &&
              this._isRepairableCharacterDatabaseValidation(stageValidation)
            ) {
              const patchRepair = await this._repairCharacterDatabaseMissingFields(
                charDbData,
                stageValidation,
                {
                  abortSignal: runAbortController.signal,
                }
              );
              if (Array.isArray(patchRepair?.repairLog) && patchRepair.repairLog.length > 0) {
                stageRepairLog.push(...patchRepair.repairLog);
              }
              if (patchRepair?.repairedDatabase) {
                charDbData = patchRepair.repairedDatabase;
                stageValidation = this._validateCharacterDatabasePanelConsistency(
                  this.designConfig.step3_fields,
                  charDbData
                );
              }
            }
            // 修补 API 跑完仍 fail：把问题角色从 character_database 中删除，让创世可以继续
            if (!stageValidation.ok && Array.isArray(stageValidation.errors)) {
              const failedCharacterIds = new Set();
              for (const err of stageValidation.errors) {
                if (err && typeof err.characterId === 'string' && err.characterId.trim()) {
                  failedCharacterIds.add(err.characterId.trim());
                }
              }
              if (failedCharacterIds.size > 0) {
                const removedNames = [];
                for (const cid of failedCharacterIds) {
                  const display =
                    charDbData?.[cid]?.name || charDbData?.[cid]?.nickname || cid;
                  removedNames.push(display);
                  if (charDbData && typeof charDbData === 'object') delete charDbData[cid];
                  stageRepairLog.push({
                    kind: 'character_removed_after_repair_failure',
                    characterId: cid,
                    displayName: display,
                  });
                }
                console.warn(
                  '[DesignService] Stage3 修补仍失败，删除问题角色继续创世:',
                  [...failedCharacterIds]
                );
                // 重新校验（剩余角色应该都 ok）
                stageValidation = this._validateCharacterDatabasePanelConsistency(
                  this.designConfig.step3_fields,
                  charDbData
                );
                // 推 warning 到现有渠道（stageValidationReports 调试可见）
                if (Array.isArray(stageValidation.warnings)) {
                  stageValidation.warnings.push({
                    kind: 'character_creation_failed',
                    message: `因 AI 反复出错，以下角色未能完整创建：${removedNames.join('、')}。可稍后在角色面板手动添加。`,
                    affectedCharacters: [...failedCharacterIds],
                  });
                }
                // 立即给玩家一次 toast 提示
                if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                  window.showToast(
                    `部分角色（${removedNames.length} 个）未能创建，详见调试报告`
                  );
                }
              }
            }
            this.stageValidationReports.character_database = stageValidation;
            compactStageValidation = this._compactCharacterDatabaseValidation(stageValidation);
            if (!stageValidation.ok) {
              const validationSummary =
                this._formatCharacterDatabaseValidationSummary(stageValidation);
              throw this._createDesignValidationError(validationSummary, {
                report: stageValidation,
                rootCause: validationSummary,
                failedFields: stageValidation.errors.map(item => ({
                  characterId: item.characterId || null,
                  fieldKey: item.fieldKey || null,
                  fieldLabel: item.fieldLabel || null,
                  message: item.message,
                })),
              });
            }

            // Store character_database as the parsed result for PHASE2_STAGE_KEYS
            parsed = charDbData;

            // Store relationship_rules separately at top level
            if (relationshipRulesData && typeof relationshipRulesData === 'object') {
              this.designConfig.relationship_rules = relationshipRulesData;
              console.log('[DesignService] Stage3: relationship_rules 已存储到顶层');
            }
          }

          // 存入 designConfig
          this.designConfig[PHASE2_STAGE_KEYS[stage - 1]] = parsed;

          // Stage 3 完成后：尝试回填 init 模块中的角色占位符
          if (stage === 3) {
            const backfillResult = this._backfillInitPlaceholders();
            if (backfillResult?.replaced > 0) {
              stageRepairLog.push(
                `init 模块占位符回填: ${backfillResult.replaced} 处已替换为角色名`
              );
            }
            if (backfillResult?.remaining > 0) {
              stageRepairLog.push(
                `init 模块仍有 ${backfillResult.remaining} 处未匹配的角色占位符，可在 P3 阶段手动处理`
              );
            }
          }

          // Stage 1 完成后：确定核心人物名列表
          // 优先使用 AI 在 JSON 中自声明的 _narrativeCoreCharacters，
          // 若 AI 未输出则回退到正则提取（不可靠，仅作兜底）
          if (stage === 1 && parsed.settings && typeof parsed.settings === 'object') {
            const aiDeclared = parsed._narrativeCoreCharacters;
            if (
              aiDeclared &&
              typeof aiDeclared === 'object' &&
              !Array.isArray(aiDeclared) &&
              Object.keys(aiDeclared).filter(k => !k.startsWith('_')).length > 0
            ) {
              console.log(
                '[DesignService] Stage1: 使用 AI 自声明的 Narrative_Core 人名:',
                JSON.stringify(aiDeclared)
              );
            } else {
              parsed._narrativeCoreCharacters = this._extractNarrativeCoreCharacters(
                parsed.settings
              );
              console.log(
                '[DesignService] Stage1: AI 未声明 _narrativeCoreCharacters，回退到正则提取:',
                JSON.stringify(parsed._narrativeCoreCharacters)
              );
            }
          }

          if (stage === 2) {
            if (parsed.random_opening !== undefined) {
              delete parsed.random_opening;
            }
            delete this.designConfig.random_opening;
            if (this.designConfig.prompt_modules?.modules?.random_opening !== undefined) {
              delete this.designConfig.prompt_modules.modules.random_opening;
            }
            if (this.designConfig.prompt_modules?.random_opening !== undefined) {
              delete this.designConfig.prompt_modules.random_opening;
            }
          }

          // Stage 2 完成后：从 npc_fields 构建 step3_fields.panel_npc
          if (stage === 2 && Array.isArray(parsed.npc_fields)) {
            this._applyNpcFieldsToStep3Fields(parsed.npc_fields);
          }

          // Stage 4 完成后：从合并输出中提取 timeline 和 character_timelines
          if (stage === 4) {
            // Stage 4 outputs { timeline: {...}, character_timelines: {...}, _summary: "..." }
            if (parsed.timeline && typeof parsed.timeline === 'object') {
              this.designConfig.timeline = parsed.timeline;
              if (
                Array.isArray(this.designConfig.timeline.events) &&
                typeof timelineService !== 'undefined' &&
                timelineService.sortEventsByDate
              ) {
                timelineService.sortEventsByDate(this.designConfig.timeline.events);
              }
              if (parsed.character_timelines && typeof parsed.character_timelines === 'object') {
                this.designConfig.character_timelines = parsed.character_timelines;
                console.log('[DesignService] Stage4: timeline 和 character_timelines 已分别存储');
              }
              // Update parsed to just timeline for the PHASE2_STAGE_KEYS storage
              parsed = this.designConfig.timeline;
            } else {
              // Fallback: AI output old format (just timeline events)
              console.warn('[DesignService] Stage4: AI 输出了旧格式，按旧格式处理');
            }
            this._repairRecommendedOpeningTextForSnapshot(this.designConfig);
          }

          // 记录 debug step（标准化结构：phase / request / response / parsed）
          designSteps.push({
            phase: `phase2_stage${stage}`,
            stageName: stageNames[stage - 1],
            provider: apiCallSnapshot.provider,
            request: apiCallSnapshot.payload,
            response: stageResponse,
            parsed,
            validation: compactStageValidation,
            repair:
              stageRepairLog.length > 0
                ? { count: stageRepairLog.length, attempts: stageRepairLog }
                : null,
            normalization: stage2Normalization?.applied
              ? {
                  applied: true,
                  fixes: stage2Normalization.fixes,
                }
              : null,
          });
          _updateDebugPayload();

          this._saveDesignConfig();
          if (stage === 2) {
            try {
              this._writeDesignQnaModule();
            } catch (qnaErr) {
              console.warn('[DesignMode] design_qna write failed (non-fatal):', qnaErr);
            }
          }
          try {
            this._updatePreviewPanel();
          } catch (previewErr) {
            console.warn('[DesignMode] _updatePreviewPanel failed (non-fatal):', previewErr);
          }

          // 通知 UI
          const stageText =
            stage === 2
              ? this._buildStage2ValidationMessage(parsed, stageValidation)
              : stage === 3
                ? this._buildCharacterDatabaseValidationMessage(parsed, stageValidation)
                : parsed._summary || `${stageNames[stage - 1]} 生成完成`;

          const isLastStage = stage === PHASE2_TOTAL_STAGES;
          try {
            onStageComplete({
              text: stageText,
              stageName: stageNames[stage - 1],
              stageIndex: stage,
              isLast: isLastStage,
            });
          } catch (cbErr) {
            console.warn('[DesignMode] onStageComplete callback failed (non-fatal):', cbErr);
          }

          // 卡牌审阅暂停点：当前 stage 注册了 review adapter 就停下让用户审阅。
          // resume 时 p2Stage 推进到 next，loop 直接跳过此分支；用户主动 retry 当前 stage 时会再次进入暂停——预期。
          if (typeof window.hasReviewAdapter === 'function' && window.hasReviewAdapter(stage)) {
            this.p2ReviewStage = stage;
            this._saveDesignConfig();
            try {
              this._updatePreviewPanel();
            } catch (e) {
              console.warn('[DesignMode] preview update on review pause failed:', e);
            }
            return { paused: true, reviewStage: stage };
          }

        } catch (error) {
          if (this._isPhase2AbortError(error)) {
            throw error;
          }
          const apiCallSnapshot = aiService.lastDesignPayload
            ? { ...aiService.lastDesignPayload }
            : null;
          const stageEndTs =
            typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now();
          const stageElapsedMs = Math.max(0, Math.round(stageEndTs - stageStartTs));
          const phaseName = `phase2_stage${stage}`;
          const providerName =
            apiCallSnapshot?.provider ||
            (typeof aiService?.getProviderForModule === 'function'
              ? aiService.getProviderForModule('p2')
              : null) ||
            '';
          const modelName =
            typeof aiService?.getModelForModule === 'function'
              ? aiService.getModelForModule('p2')
              : null;
          const stageResponseBody =
            typeof stageResponse === 'string' && stageResponse.trim() !== ''
              ? stageResponse
              : (apiCallSnapshot?.response ?? null);
          const validationMeta = error?.designValidation || null;
          let unifiedErrorInfo = null;
          if (typeof aiService?._buildUnifiedErrorInfo === 'function') {
            unifiedErrorInfo = aiService._buildUnifiedErrorInfo(error, {
              traceId: aiService?.lastPayload?.traceId || null,
              phase: phaseName,
              module: 'p2',
              provider: providerName || null,
              model: modelName,
              url: apiCallSnapshot?.url || '',
              defaultErrorType: jsonFailureKind ? 'parse' : undefined,
              responseBody: stageResponseBody,
            });
          }
          const stageErrorInfo = {
            ...(unifiedErrorInfo || {
              phase: phaseName,
              module: 'p2',
              provider: providerName || null,
              model: modelName || null,
              message: error?.message || '未知错误',
              errorType: jsonFailureKind ? 'parse' : error?.apiErrorInfo?.errorType || 'unknown',
              responseBody: stageResponseBody,
            }),
            failureKind: jsonFailureKind,
            repairCount: stageRepairLog.length,
            repairAttempts: stageRepairLog.length > 0 ? stageRepairLog : null,
            stageElapsedMs,
            timestamp: new Date().toISOString(),
          };
          if (validationMeta) {
            stageErrorInfo.errorType = 'validation';
            stageErrorInfo.rootCause = validationMeta.rootCause || error?.message || '字段校验失败';
            stageErrorInfo.failedFields = validationMeta.failedFields || null;
          }

          // 将失败 step 写入 debug payload，使 debug 面板可见
          designSteps.push({
            phase: phaseName,
            stageName: stageNames[stage - 1],
            provider: providerName,
            request: apiCallSnapshot?.payload || null,
            response: stageResponse || null,
            parsed: null,
            normalization: stage2Normalization?.applied
              ? {
                  applied: true,
                  fixes: stage2Normalization.fixes,
                }
              : null,
            repair:
              stageRepairLog.length > 0
                ? { count: stageRepairLog.length, attempts: stageRepairLog }
                : null,
            failed: true,
            errorInfo: stageErrorInfo,
          });
          _updateDebugPayload();

          error.unifiedErrorInfo = stageErrorInfo;
          error.errorInfo = stageErrorInfo;
          error.traceId = stageErrorInfo.traceId || error.traceId || null;
          error.failedPhase = stageErrorInfo.phase || error.failedPhase || null;

          // 附加阶段上下文到 error，供 chatCore 显示
          error.designFailure = {
            stageIndex: stage,
            stageName: stageNames[stage - 1],
            provider: providerName,
            stageElapsedMs,
            httpStatus: stageErrorInfo.httpStatus || error.apiErrorInfo?.httpStatus || null,
          };

          this._logPhase2FailureToConsole({
            stageIndex: stage,
            stageName: stageNames[stage - 1],
            error,
            apiCallSnapshot,
            messages,
            stageElapsedMs,
            stageResponse,
            failureKind: jsonFailureKind,
          });
          throw error;
        }
      }

      if (!this._isPhase2RunActive(runToken)) {
        throw this._createPhase2AbortError('Phase 2 在完成收尾前被中止');
      }

      this.p2Stage = PHASE2_TOTAL_STAGES;

      // 后处理阶段：用 try-catch 包裹，确保错误写入 debug payload，
      // 并在 _runInspectionTriage 的 _callSummaryAPI 覆盖 lastDesignPayload 后恢复
      try {
        // adapter onFinalize hook：用户从 review 暂停点击"确认完成"进入 finalize 路径时，
        // 对应 adapter 可能要做收尾工作（例如 Stage 4 用最新 events 重新生成 character_timelines）
        const finalizingFromStage = this._phase2FinalizingFromStage;
        this._phase2FinalizingFromStage = null;
        if (finalizingFromStage != null) {
          const finalizingAdapter =
            window.getReviewAdapter && window.getReviewAdapter(finalizingFromStage);
          if (finalizingAdapter && typeof finalizingAdapter.onFinalize === 'function') {
            try {
              await finalizingAdapter.onFinalize(this, { onProgressUpdate });
            } catch (finalizeErr) {
              console.warn(
                '[DesignMode] adapter.onFinalize failed (non-fatal):',
                finalizingFromStage,
                finalizeErr
              );
            }
          }
        }

        // 时间一致性修复与检查：自动修复 AI 生成的异常，检测用户指定的异常
        this._postPhase2ConsistencyCheck();
        this._saveDesignConfig();

        // 质量检测 + AI 修正
        if (typeof onProgressUpdate === 'function') {
          onProgressUpdate('正在质量检测...');
        }
        const inspectionReport =
          typeof window.inspectWorldCard === 'function'
            ? window.inspectWorldCard(this.designConfig)
            : null;

        if (
          inspectionReport &&
          (inspectionReport.summary.errors > 0 || inspectionReport.summary.warnings > 0)
        ) {
          if (!this._isPhase2RunActive(runToken)) {
            throw this._createPhase2AbortError('Phase 2 在检测阶段被中止');
          }
          await this._runInspectionTriage(
            inspectionReport,
            runToken,
            onProgressUpdate,
            onInspectionMessage
          );
        }

        // 所有检测+修正完成后才切换 phase
        this.phase = 'p3';
        this.p2ReviewStage = null; // 防止残留导致 P3 误渲染卡牌审阅 UI
        this.resetP3History();
        this._saveDesignConfig();
        this._updatePreviewPanel();

        // 恢复 debug payload：_runInspectionTriage 内的 _callSummaryAPI('design')
        // 会覆盖 lastDesignPayload 为简单格式，这里恢复为包含所有 stage 的完整格式
        _updateDebugPayload();
      } catch (postErr) {
        // 将后处理错误追加到 debug payload，使 debug 下载可见
        designSteps.push({
          phase: 'post_processing',
          stageName: '后处理',
          failed: true,
          errorInfo: {
            message: postErr.message,
            errorType: postErr.name || 'Error',
            stack: postErr.stack,
            timestamp: new Date().toISOString(),
          },
        });
        _updateDebugPayload();
        throw postErr;
      }
    } finally {
      if (this.phase2AbortController === runAbortController) {
        this.phase2AbortController = null;
      }
      if (this.activePhase2RunToken === runToken) {
        this.isAutoGenerating = false;
        this.activePhase2RunToken = null;
      }
    }
  }

  /**
   * 从卡牌审阅暂停状态恢复 Phase 2，从指定 stage 继续跑。
   * 调用方负责后续触发 handleDesignModePhase2() 来重新进入管线。
   * @param {number} fromStage - 从哪个 stage 继续（默认 4）
   * @returns {boolean} 是否成功转入 resume 状态
   */
  requestResumePhase2(fromStage = null) {
    if (this.p2ReviewStage == null) return false;
    // 默认从 review stage + 1 继续；调用方可传 fromStage 覆盖
    const target = fromStage != null ? fromStage : this.p2ReviewStage + 1;
    // 不 clamp：target 可以超过 PHASE2_TOTAL_STAGES 表示 finalize
    // （如 stage 4 commit 后用户点"确认完成" → target = 5 → for 循环跳过 → 直接走后处理）
    // 同时记录 finalize 来源 stage，让后处理段可调对应 adapter.onFinalize
    if (target > PHASE2_TOTAL_STAGES) {
      this._phase2FinalizingFromStage = this.p2ReviewStage;
    }
    this.p2Stage = target;
    this.p2ReviewStage = null;
    this._saveDesignConfig();
    return true;
  }

  // ==================================================================
  // 卡牌审阅：单卡 AI 重抽 / 增删 / 自然语言改写
  // 暴露为 designService 实例方法，由 ui.js 的卡牌操作和 chatCore 输入路由调用。
  // ==================================================================

  // ==================================================================
  // 卡牌审阅 — adapter-driven entity 操作
  // adapter 提供 stage 特定的 prompt / 字段集 / hooks
  // ==================================================================

  /**
   * 扫描 prompt_modules.modules 中所有提到 oldName 的模块。
   * 由 adapter.onAfterNameChange 通过 designService 实例调用。
   */
  _findCharacterNameReferences(oldName) {
    if (!oldName || typeof oldName !== 'string' || oldName.length < 2) return [];
    const pm = this.designConfig?.prompt_modules?.modules;
    if (!pm || typeof pm !== 'object') return [];
    const hits = [];
    for (const [moduleId, content] of Object.entries(pm)) {
      if (typeof content === 'string' && content.includes(oldName)) {
        hits.push(moduleId);
      }
    }
    return hits;
  }

  // 通用 JSON 提取（从 reroll / addByAI 复用）：先 _extractJSON，失败 → _repairJSON
  async _extractEntityJSON(response, label) {
    const extract = this._extractJSON(response, { includeMeta: true, silent: true });
    if (extract.parsed) return extract.parsed;
    const repaired = await this._repairJSON(response, label, {});
    return repaired?.parsed || null;
  }

  /**
   * 单卡 AI 重抽：让 AI 替换指定 entity 的对象。
   */
  async _rerollEntity(stage, id, hint = '') {
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    if (!adapter.hasEntity(this.designConfig, id)) {
      console.warn('[DesignMode] reroll target not found:', stage, id);
      return;
    }
    if (this.isProcessing) {
      if (typeof window.showToast === 'function') window.showToast(adapter.busyMessage);
      return;
    }
    this._assertDesignApiKeyConfigured?.();
    this.isProcessing = true;
    if (typeof this._setEntityCardLoading === 'function') {
      this._setEntityCardLoading(stage, id, true);
    }
    try {
      const oldObj = adapter.getEntity(this.designConfig, id);
      const { systemPrompt, userMessage } = adapter.buildRerollPrompts(this, id, oldObj, hint);
      const response = await aiService._callSummaryAPI(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        'p2',
        {}
      );
      // adapter 决定怎么解析 AI 响应（Stage 3 = JSON, Stage 1 = markdown text）
      const newObj =
        typeof adapter.parseAIResponse === 'function'
          ? await adapter.parseAIResponse(this, response, id)
          : adapter.ensureEntityShape(
              await this._extractEntityJSON(response, '重抽'),
              id
            );
      if (newObj == null) {
        if (typeof window.showToast === 'function')
          window.showToast(adapter.parseFailMessage);
        return;
      }
      const oldName = oldObj?.name || '';
      const newName = newObj?.name || '';
      adapter.setEntity(this, id, newObj);
      this._saveDesignConfig();
      this._updatePreviewPanel();
      if (typeof this._refreshEntityCard === 'function') {
        this._refreshEntityCard(stage, id);
      }
      if (typeof adapter.onAfterNameChange === 'function') {
        try {
          await adapter.onAfterNameChange(this, oldName, newName, id);
        } catch (e) {
          console.warn('[DesignMode] adapter.onAfterNameChange failed:', e);
        }
      }
    } catch (err) {
      console.error('[DesignMode] reroll failed:', err);
      if (typeof window.showToast === 'function')
        window.showToast(adapter.rerollFailMessage(err));
    } finally {
      this.isProcessing = false;
      if (typeof this._setEntityCardLoading === 'function') {
        this._setEntityCardLoading(stage, id, false);
      }
    }
  }

  /** 创建一张空白卡，由 adapter 决定字段集 */
  _addBlankEntity(stage) {
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    const id = adapter.nextEntityId(this.designConfig);
    const blank = adapter.newBlankEntity(this.designConfig, id);
    adapter.setEntity(this, id, blank);
    if (typeof adapter.onAfterRosterChange === 'function') {
      try {
        adapter.onAfterRosterChange(this, 'add_blank', id);
      } catch (e) {
        console.warn('[DesignMode] adapter.onAfterRosterChange failed:', e);
      }
    }
    this._saveDesignConfig();
    this._updatePreviewPanel();
    if (typeof this._addEntityCardToPanel === 'function') {
      this._addEntityCardToPanel(stage, id);
    }
  }

  /** AI 生成一张新卡（adapter 提供 prompt） */
  async _addEntityByAI(stage, hint) {
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    if (this.isProcessing) {
      if (typeof window.showToast === 'function') window.showToast(adapter.busyMessage);
      return;
    }
    this._assertDesignApiKeyConfigured?.();
    this.isProcessing = true;
    try {
      const newId = adapter.nextEntityId(this.designConfig);
      const { systemPrompt, userMessage } = adapter.buildAddPrompts(this, newId, hint);
      const response = await aiService._callSummaryAPI(
        [{ role: 'user', content: userMessage }],
        systemPrompt,
        'p2',
        {}
      );
      const newObj =
        typeof adapter.parseAIResponse === 'function'
          ? await adapter.parseAIResponse(this, response, newId)
          : adapter.ensureEntityShape(
              await this._extractEntityJSON(response, '新增'),
              newId
            );
      if (newObj == null) {
        if (typeof window.showToast === 'function')
          window.showToast(adapter.parseFailMessage);
        return;
      }
      adapter.setEntity(this, newId, newObj);
      if (typeof adapter.onAfterRosterChange === 'function') {
        try {
          adapter.onAfterRosterChange(this, 'add_by_ai', newId);
        } catch (e) {
          console.warn('[DesignMode] adapter.onAfterRosterChange failed:', e);
        }
      }
      this._saveDesignConfig();
      this._updatePreviewPanel();
      if (typeof this._addEntityCardToPanel === 'function') {
        this._addEntityCardToPanel(stage, newId);
      }
    } catch (err) {
      console.error('[DesignMode] add by AI failed:', err);
      if (typeof window.showToast === 'function')
        window.showToast(adapter.addFailMessage(err));
    } finally {
      this.isProcessing = false;
    }
  }

  /** 删除一张卡：优先用 adapter.commitDelete（array-based adapter 用），否则走 P3 op */
  _deleteEntity(stage, id) {
    const adapter = window.getReviewAdapter && window.getReviewAdapter(stage);
    if (!adapter) return;
    if (!adapter.hasEntity(this.designConfig, id)) return;
    if (typeof this._removeEntityCardFromPanel === 'function') {
      this._removeEntityCardFromPanel(stage, id);
    }
    if (typeof adapter.commitDelete === 'function') {
      try {
        adapter.commitDelete(this, id);
      } catch (err) {
        console.warn('[DesignMode] adapter.commitDelete failed:', err);
      }
    } else {
      try {
        this._applyP3Operations([
          { target: adapter.configKey, action: 'delete', path: id },
        ]);
      } catch (err) {
        console.warn('[DesignMode] delete via op failed, fallback to direct:', err);
        const data = this.designConfig[adapter.configKey];
        if (data) delete data[id];
      }
    }
    if (typeof adapter.onAfterRosterChange === 'function') {
      try {
        adapter.onAfterRosterChange(this, 'delete', id);
      } catch (e) {
        console.warn('[DesignMode] adapter.onAfterRosterChange failed:', e);
      }
    }
    this._saveDesignConfig();
    this._updatePreviewPanel();
  }

  /**
   * 卡牌审阅模式下的自然语言改写：复用 sendP3Message，限定为当前 review stage 的 target。
   * @param {string} userText - 原始用户输入
   * @returns {Promise<{text: string, applied: number, discardedByTarget: object}>}
   */
  async _reviewModeNaturalEdit(userText) {
    const stage = this.p2ReviewStage;
    const adapter = stage != null && window.getReviewAdapter ? window.getReviewAdapter(stage) : null;
    const targetKey = adapter?.natEditTargetConstraint || adapter?.configKey;
    if (!targetKey) {
      // 无 adapter 时降级为直接 P3 chat
      const result = await this.sendP3Message(userText);
      return { text: result?.text || '', applied: 0, discardedByTarget: {} };
    }
    const constrainedMessage =
      `[卡牌审阅模式 · 仅作用于 ${targetKey}] ${userText}\n\n` +
      `重要约束：你的 EDIT_OPERATIONS 中所有 target 必须是 "${targetKey}"。` +
      `不要修改其他 target。如果用户的请求超出 ${targetKey} 范围，` +
      `请只在自然语言中说明而不输出任何 EDIT_OPERATIONS。`;
    const result = await this.sendP3Message(constrainedMessage);
    let applied = 0;
    const discardedByTarget = {};
    if (Array.isArray(result?.operations) && result.operations.length > 0) {
      const stageOps = [];
      for (const op of result.operations) {
        if (op?.target === targetKey) {
          stageOps.push(op);
        } else if (op?.target) {
          discardedByTarget[op.target] = (discardedByTarget[op.target] || 0) + 1;
        }
      }
      if (stageOps.length > 0) {
        try {
          this._applyP3Operations(stageOps);
          // roster 变化：调 adapter hook（Stage 3 用来清 relationship_rules）
          const rosterChanged = stageOps.some(
            op =>
              (op.action === 'add' || op.action === 'delete') &&
              typeof op.path === 'string' &&
              !op.path.includes('.') &&
              !op.path.includes('[')
          );
          if (rosterChanged && typeof adapter.onAfterRosterChange === 'function') {
            try {
              adapter.onAfterRosterChange(this, 'natural_edit', null);
            } catch (e) {
              console.warn('[DesignMode] adapter.onAfterRosterChange failed:', e);
            }
          }
          this._saveDesignConfig();
          this._updatePreviewPanel();
          // 按 op 类型分别做 chat 气泡内的局部刷新
          for (const op of stageOps) {
            const path = typeof op.path === 'string' ? op.path : '';
            const isEntityLevel = path && !path.includes('.') && !path.includes('[');
            if (op.action === 'delete' && isEntityLevel) {
              this._removeEntityCardFromPanel?.(stage, path);
            } else if (op.action === 'add' && isEntityLevel) {
              this._addEntityCardToPanel?.(stage, path);
            } else if (op.action === 'update' && isEntityLevel) {
              this._refreshEntityCard?.(stage, path);
            } else if (op.action === 'update' && path.includes('.')) {
              const dotIdx = path.indexOf('.');
              const eId = path.slice(0, dotIdx);
              const fKey = path.slice(dotIdx + 1);
              this._refreshEntityField?.(stage, eId, fKey);
            }
          }
          applied = stageOps.length;
        } catch (err) {
          console.error('[DesignMode] review-mode apply ops failed:', err);
        }
      }
    }
    return { text: result?.text || '', applied, discardedByTarget };
  }

  _serializeErrorForConsole(error) {
    if (!error) {
      return { name: 'Error', message: '未知错误', stack: '', causeMessage: null };
    }
    const name = typeof error.name === 'string' ? error.name : 'Error';
    const message = typeof error.message === 'string' ? error.message : String(error);
    const stack = typeof error.stack === 'string' ? error.stack : '';
    let causeMessage = null;
    if (error.cause) {
      causeMessage =
        typeof error.cause?.message === 'string' ? error.cause.message : String(error.cause);
    }
    return { name, message, stack, causeMessage };
  }

  _sanitizeRequestUrlForConsole(url) {
    if (typeof url !== 'string' || !url) return '';
    return url.replace(/([?&](?:key|api_key|token|access_token)=)[^&]*/gi, '$1***');
  }

  _summarizeDesignRequestForConsole(apiCallSnapshot, messages) {
    const payload = apiCallSnapshot?.payload;
    let payloadBytes = 0;
    try {
      payloadBytes = payload ? JSON.stringify(payload).length : 0;
    } catch (_e) {
      payloadBytes = 0;
    }
    const messageCount = Array.isArray(payload?.messages)
      ? payload.messages.length
      : Array.isArray(payload?.contents)
        ? payload.contents.length
        : Array.isArray(messages)
          ? messages.length
          : 0;
    const model =
      typeof payload?.model === 'string'
        ? payload.model
        : typeof payload?.model_id === 'string'
          ? payload.model_id
          : '';

    return {
      provider: apiCallSnapshot?.provider || '',
      model,
      url: this._sanitizeRequestUrlForConsole(apiCallSnapshot?.url || ''),
      messageCount,
      payloadBytes,
    };
  }

  _logPhase2FailureToConsole({
    stageIndex,
    stageName,
    error,
    apiCallSnapshot,
    messages,
    stageElapsedMs,
    stageResponse = '',
    failureKind = null,
  }) {
    const err = this._serializeErrorForConsole(error);
    const requestSummary = this._summarizeDesignRequestForConsole(apiCallSnapshot, messages);
    const state = {
      phase: this.phase,
      p2Stage: this.p2Stage,
      isAutoGenerating: this.isAutoGenerating,
    };
    const responseText = typeof stageResponse === 'string' ? stageResponse : '';
    const responseLength = responseText.length;
    const responseTail = responseText ? responseText.slice(-200) : '';
    const title = `[DesignMode][P2][失败] stage=${stageIndex}/${PHASE2_TOTAL_STAGES} ${stageName} | ${err.message}`;

    console.groupCollapsed(title);
    console.log('phase:', 'p2');
    console.log('stageIndex:', stageIndex);
    console.log('stageName:', stageName);
    console.log(
      'provider/model:',
      `${requestSummary.provider || 'unknown'} / ${requestSummary.model || 'unknown'}`
    );
    console.log('requestSummary:', {
      url: requestSummary.url || 'unknown',
      messageCount: requestSummary.messageCount,
      payloadBytes: requestSummary.payloadBytes,
    });
    console.log('responseMeta:', {
      failureKind: failureKind || 'unknown',
      responseLength,
      responseTail,
    });
    console.log('state:', state);
    console.log('stageElapsedMs:', stageElapsedMs);
    console.log('error:', err);
    console.error(error);
    console.groupEnd();
  }

  /**
   * 将 step3_fields 序列化为 AI 可读的提示词文本
   * @returns {{ statusText: string, npcText: string, charDbExtraEntries: string, charDbExtraFieldsText: string, fullText: string }}
   */
  _serializeStep3FieldsForPrompt() {
    const fields = this.designConfig.step3_fields || _cloneDefaultStep3Fields();
    if (!fields)
      return {
        statusText: '',
        npcText: '',
        charDbExtraEntries: '',
        charDbExtraFieldsText: '',
        fullText: '',
      };

    // --- panel_status 序列化 ---
    const statusLines = ['## 游戏状态栏字段配置（世界术语参考）', ''];
    for (const group of fields.panel_status || []) {
      const typeTag = group.type === 'array' ? ', 数组' : '';
      statusLines.push(`### ${group.label} (${group.key}${typeTag})`);
      for (const f of group.fields || []) {
        const nullable = f.nullable ? ', 可空' : '';
        statusLines.push(`- ${f.key} → ${f.label} (${f.type || 'string'}${nullable})`);
      }
      if (group._era) statusLines.push(`- _纪年名称：${group._era}`);
      if (group._precision) statusLines.push(`- _时间精度：${group._precision}`);
      if (Array.isArray(group._time_segments) && group._time_segments.length > 0) {
        statusLines.push(`- _时段名称：${group._time_segments.join('/')}`);
      }
      if (group._currency) statusLines.push(`- _货币名称：${group._currency}`);
      statusLines.push('');
    }
    const statusText = statusLines.join('\n');

    // --- panel_npc 序列化 ---
    const fixedKeys = this._getNpcReservedKeySet();
    const aiDefinedFields = (fields.panel_npc || []).filter(f => !fixedKeys.has(f.key));

    const npcLines = ['## 运行时角色追踪字段（Step 3 提取面板）', ''];
    for (const f of aiDefinedFields) {
      const enumTag =
        Array.isArray(f.enum) && f.enum.length > 0 ? ` [枚举: ${f.enum.join('/')}]` : '';
      const desc = f.desc ? ` (${f.desc})` : '';
      npcLines.push(`- ${f.key}: ${f.label}${desc}${enumTag}`);
    }
    npcLines.push('');
    npcLines.push(
      '注意：这些是游戏运行时 UI 面板追踪的字段。角色数据库（CHARACTER_DATABASE）中也应包含这些字段的初始值。'
    );
    const npcText = npcLines.join('\n');

    // --- charDb 面板字段（用于 Stage 3 CHARACTER_DATABASE 模板动态扩展） ---
    // 所有 AI 定义的面板字段都注入到角色模板中
    let charDbExtraEntries = '';
    let charDbExtraFieldsText = '';
    if (aiDefinedFields.length > 0) {
      const escJson = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
      charDbExtraEntries = aiDefinedFields
        .map(f => {
          const enumHint =
            Array.isArray(f.enum) && f.enum.length > 0
              ? `（枚举：${f.enum.map(v => `"${escJson(String(v))}"`).join('、')}）`
              : '';
          const desc = f.desc ? `（${escJson(f.desc)}）` : '';
          return `    "${f.key}": "${escJson(f.label)}${desc}${enumHint}"`;
        })
        .join(',\n');

      const docLines = [
        '',
        '## CHARACTER_DATABASE 面板字段',
        '',
        '本世界的角色对象中应包含以下面板追踪字段（由 Stage 2 npc_fields 定义）：',
      ];
      for (const f of aiDefinedFields) {
        const enumTag =
          Array.isArray(f.enum) && f.enum.length > 0 ? ` [枚举: ${f.enum.map(v => `"${v}"`).join(' | ')}]` : '';
        const desc = f.desc ? `：${f.desc}` : '';
        docLines.push(`- ${f.key}${desc} (${f.type || 'string'})${enumTag}`);
      }
      docLines.push('', '请为每个角色填入符合其设定的值。有 enum 约束的字段必须从枚举值中选择。');
      charDbExtraFieldsText = docLines.join('\n');
    }

    // 提取纪年名称和货币名称，供 prompt 模板直接引用
    let eraName = '';
    let currencyName = '';
    for (const group of fields.panel_status || []) {
      if (group._era && !eraName) eraName = group._era;
      if (group._currency && !currencyName) currencyName = group._currency;
    }

    return {
      statusText,
      npcText,
      charDbExtraEntries,
      charDbExtraFieldsText,
      fullText: statusText + '\n' + npcText,
      eraName,
      currencyName,
    };
  }

  /**
   * 构建 Phase 2 各阶段的 prompt
   * 依赖链：World → Rules(+World) → Chars(+World+Rules) → Timeline(+World+Rules+Chars) → CharTimelines(+World+Rules+Chars+Timeline)
   */
  _buildP2StagePrompt(stage, mode = 'full') {
    const p1 = this.p1Output;
    const dc = this.designConfig;
    const s3 = this._serializeStep3FieldsForPrompt();
    const p1History = dc._p1ChatHistory;

    switch (stage) {
      case 1: // World Setting
        if (mode === 'minimal') {
          return _getDesignPromptValue('PHASE2_STAGE1_MINIMAL', PHASE2_STAGE1_MINIMAL)(p1, s3, p1History);
        }
        return _getDesignPromptValue('PHASE2_STAGE_PROMPTS', PHASE2_STAGE_PROMPTS)[0](p1, s3, p1History);

      case 2: // Prompt Modules (Rules) — 依赖 World
        if (mode === 'simplified') {
          return _getDesignPromptValue('PHASE2_STAGE2_SIMPLIFIED', PHASE2_STAGE2_SIMPLIFIED)(
            p1,
            dc.world_setting,
            s3,
            p1History
          );
        }
        return _getDesignPromptValue('PHASE2_STAGE_PROMPTS', PHASE2_STAGE_PROMPTS)[1](
          p1,
          dc.world_setting,
          s3,
          p1History
        );

      case 3: // Character Database + Relationship Rules — 依赖 World + Rules
        return _getDesignPromptValue('PHASE2_STAGE_PROMPTS', PHASE2_STAGE_PROMPTS)[2](
          p1,
          dc.world_setting,
          dc.prompt_modules,
          s3,
          p1History
        );

      case 4: // Timeline + Character Timelines — 依赖 World + Rules + Chars
        if (mode === 'light') {
          return _getDesignPromptValue('PHASE2_STAGE4_LIGHT', PHASE2_STAGE4_LIGHT)(
            p1,
            dc.world_setting,
            dc.prompt_modules,
            dc.character_database,
            s3,
            p1History
          );
        }
        return _getDesignPromptValue('PHASE2_STAGE_PROMPTS', PHASE2_STAGE_PROMPTS)[3](
          p1,
          dc.world_setting,
          dc.prompt_modules,
          dc.character_database,
          s3,
          p1History
        );

      default:
        throw new Error(`无效的 Phase 2 阶段: ${stage}`);
    }
  }

  _pushStage2Issue(report, type, message, moduleId = null) {
    const issue = { message, moduleId };
    if (type === 'fatal') {
      report.fatalErrors.push(issue);
    } else {
      report.warnings.push(issue);
    }
  }

  _normalizeStage2PromptModules(parsed) {
    const result = {
      normalized: parsed,
      applied: false,
      fixes: [],
    };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

    const modules = parsed.modules;
    if (!modules || typeof modules !== 'object' || Array.isArray(modules)) return result;

    const initText = modules.init;
    if (typeof initText === 'string' && initText.trim()) {
      const normalizedInit = this._normalizeStage2InitRecommendationLine(initText);
      if (normalizedInit.changed) {
        modules.init = normalizedInit.text;
        result.applied = true;
        result.fixes = normalizedInit.fixes;
      }
    }

    // opening_greeting 时间格式修复：补全缺失的 HH:MM
    const og = parsed.opening_greeting;
    const precision =
      this.designConfig?.step3_fields?._worldTermsSource?.time_precision || 'time';
    if (typeof og === 'string' && og.trim() && !this._hasConcreteTimeExample(og, precision)) {
      if (precision === 'time') {
        let fixed = og;
        const calendarEra =
          this.designConfig?.step3_fields?._worldTermsSource?.calendar_era || '';
        const sep = '[.。·\\-\\/]';
        const datePattern = '\\d+' + sep + '\\d+' + sep + '\\d+';
        const noTimeLookahead = '(?![\\s\\u3000]*\\d{1,2}[:：]\\d{2})';

        // 策略1: calendarEra 精确匹配（如 星历200.05.12 → 星历200.05.12 09:00）
        if (calendarEra) {
          const escapedEra = calendarEra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*';
          const partialRE = new RegExp(
            '(' + escapedEra + datePattern + ')' + noTimeLookahead,
            'g'
          );
          fixed = fixed.replace(partialRE, '$1 09:00');
        }

        // 策略2: 通用匹配兜底（需要至少一个非数字字符作为纪年前缀，避免误匹配纯数字）
        if (fixed === og) {
          const genericRE = new RegExp(
            '([^\\s\\d][^\\d]*?' + datePattern + ')' + noTimeLookahead,
            'g'
          );
          fixed = fixed.replace(genericRE, '$1 09:00');
        }

        // 策略3: 全角冒号归一化（如 09：00 → 09:00）
        fixed = fixed.replace(/(\d{1,2})：(\d{2})/g, '$1:$2');

        if (fixed !== og) {
          parsed.opening_greeting = fixed;
          result.applied = true;
          result.fixes.push('opening_greeting 中不完整的时间已自动补充 HH:MM');
        }
      }
    }

    return result;
  }

  // ==================================================================
  // design_qna 模块构建器
  // 在 stage 2 (prompt_modules) commit 之后注入，把 P1 阶段的 Q&A 原稿
  // 与用户编辑后的 5 维度框架封装为 on-demand 的 prompt module。
  // ==================================================================
  _isDesignWelcomeGreeting(msg) {
    if (!msg || msg.sender !== 'ai') return false;
    const text = typeof msg.text === 'string' ? msg.text.trimStart() : '';
    // PHASE1_GREETING 欢迎横幅是 game.js 在进入世界卡时硬塞的工具操作说明，
    // 不是真正的设计助手发言，从 design_qna 里剔除以免污染创作语料。
    return text.startsWith('欢迎来到**世界卡设计工坊**');
  }

  _buildDesignQnaModule(p1Output, p1ChatHistory) {
    const HARD_CAP = 50 * 1024;
    const USER_LONG_THRESHOLD = 2000;
    const PREVIEW_LEN = 200;

    const safe = this._filterPersistableHistory(p1ChatHistory || []);
    const lines = [];
    for (const msg of safe) {
      if (this._isDesignWelcomeGreeting(msg)) continue;
      const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
      if (!text) continue;
      if (msg.sender === 'user') {
        if (text.length > USER_LONG_THRESHOLD) {
          lines.push(
            `【创作者】[创作者粘贴长文 ${text.length} 字：开头 ${PREVIEW_LEN} 字摘录…]\n${text.slice(0, PREVIEW_LEN)}…`
          );
        } else {
          lines.push(`【创作者】${text}`);
        }
      } else if (msg.sender === 'ai') {
        lines.push(`【设计助手】${text}`);
      }
    }

    const fwBlock =
      '## 创作者最终确认的 5 维度框架\n\n```json\n' +
      JSON.stringify(p1Output || {}, null, 2) +
      '\n```';
    const buildText = (arr) =>
      '# 设计阶段问答记录\n\n' + arr.join('\n\n') + '\n\n' + fwBlock;

    let working = lines.slice();
    let text = buildText(working);
    while (text.length > HARD_CAP && working.length > 1) {
      working.splice(1, 1); // 保留首条，丢次旧
      text = buildText(working);
    }
    if (text.length > HARD_CAP) {
      text = text.slice(0, HARD_CAP - 8) + '\n...(截断)';
    }

    return {
      text,
      meta: {
        description:
          '世界卡创造阶段的设计思路——创作者与设计助手的原始问答 + 创作者确认的 5 维度框架',
        when_to_call:
          '当叙事风格、命名意象、氛围语感拿不准时；当需要确认创作者最初的世界观意图、规则边界、角色定位的「为什么」而非「是什么」时；当 snapshot 结构化字段不足以传达世界灵魂时',
        avoid_when:
          '已经从 core_world_mechanics / character_database 等结构化字段获取了所需的事实信息时；不要拿来替代具体规则查询',
      },
    };
  }

  // 注意：_designQnaPending 保持耐久——每次 stage 2 commit 后都从 pending 重写，
  // 直到 P1 重新跑（覆盖）或 resetDesignConfig（清空）。
  // 这样 stage 2 重试 / 用户从 stage 2 重启都能保住 design_qna。
  _writeDesignQnaModule() {
    const pending = this._designQnaPending;
    if (!pending || typeof pending !== 'object') return;
    if (typeof pending.text !== 'string' || !pending.text) return;
    const pm = this.designConfig?.prompt_modules;
    if (!pm || typeof pm !== 'object') return;
    if (!pm.modules || typeof pm.modules !== 'object') pm.modules = {};
    if (!pm.module_meta || typeof pm.module_meta !== 'object') pm.module_meta = {};
    pm.modules.design_qna = pending.text;
    if (pending.meta && typeof pending.meta === 'object') {
      pm.module_meta.design_qna = pending.meta;
    }
    this._saveDesignConfig();
  }

  _normalizeStage2InitRecommendationLine(text) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim()) {
      return { text: source, changed: false, fixes: [] };
    }

    if (/(?:推荐剧情|Recommended Opening)[：:]/i.test(source)) {
      return { text: source, changed: false, fixes: [] };
    }

    return { text: source, changed: false, fixes: [] };
  }

  _extractInitRecommendedOpeningText(initText) {
    if (typeof initText !== 'string' || !initText.trim()) return '';
    const match = initText.match(
      /^\s*(?:[-*]\s+|\d+[.)、]\s*)?(?:推荐剧情|Recommended Opening)[：:]\s*(.+?)\s*$/im
    );
    return match && typeof match[1] === 'string' ? match[1].trim() : '';
  }

  _replaceInitRecommendedOpeningText(initText, recommendationText) {
    if (
      typeof initText !== 'string' ||
      !initText.trim() ||
      typeof recommendationText !== 'string'
    ) {
      return initText;
    }
    const normalizedText = recommendationText.trim();
    if (!normalizedText) return initText;
    const linePattern = /^(\s*(?:[-*]\s+|\d+[.)、]\s*)?)(?:推荐剧情|Recommended Opening)[：:].*$/im;
    const recommendationLabel =
      (window.i18nService?.getDesignLanguage?.() || 'zh-CN') === 'en'
        ? 'Recommended Opening'
        : '推荐剧情';
    if (linePattern.test(initText)) {
      return initText.replace(
        linePattern,
        (_, prefix) => `${prefix || ''}${recommendationLabel}：${normalizedText}`
      );
    }
    return `${initText.trim()}\n${recommendationLabel}：${normalizedText}`;
  }

  _normalizeRecommendedOpeningText(text = '') {
    if (typeof text !== 'string') return '';
    return text
      .toLowerCase()
      .replace(/[，。！？；：“”‘’、（）《》【】…·,.!?;:'"(){}\[\]<>~`@#$%^&*_\-+=|\\/]/g, '')
      .replace(/\s+/g, '');
  }

  _extractRecommendedOpeningPhrases(text = '') {
    if (typeof text !== 'string' || !text.trim()) return [];
    const phrases = [];
    const seen = new Set();
    const pushPhrase = value => {
      if (typeof value !== 'string') return;
      const trimmed = value.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      phrases.push(trimmed);
    };

    const quotedPattern = /[“"「『《](.+?)[”"」』》]/g;
    let match = null;
    while ((match = quotedPattern.exec(text))) {
      pushPhrase(match[1]);
    }

    text
      .split(/[，。！？；：、,.!?;:\n]+/)
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => pushPhrase(part));

    return phrases.slice(0, 8);
  }

  _getLongestCommonSubstringLength(textA = '', textB = '') {
    if (!textA || !textB) return 0;
    const rows = new Array(textB.length + 1).fill(0);
    let longest = 0;
    for (let i = 1; i <= textA.length; i++) {
      let previous = 0;
      for (let j = 1; j <= textB.length; j++) {
        const temp = rows[j];
        if (textA[i - 1] === textB[j - 1]) {
          rows[j] = previous + 1;
          if (rows[j] > longest) longest = rows[j];
        } else {
          rows[j] = 0;
        }
        previous = temp;
      }
    }
    return longest;
  }

  _extractSnapshotEntityDisplayNameFromText(text, entityId = '') {
    if (typeof text !== 'string') return '';
    const raw = text.trim();
    if (!raw) return '';
    const headerMatch = raw.match(
      /^\s*##\s*(?:实体设定|实体|Entity(?:\s+Setting)?)\s*--\s*([^\n（(]+?)(?:\s*[（(][^\n）)]+[）)])?\s*(?:\n|$)/im
    );
    if (headerMatch && headerMatch[1]?.trim()) {
      return headerMatch[1].trim();
    }
    const firstLine = raw
      .split('\n')
      .map(line => line.trim())
      .find(Boolean);
    const source = (firstLine || raw)
      .replace(/^#{1,6}\s*/, '')
      .replace(/^(?:实体设定|实体|Entity(?:\s+Setting)?)\s*--\s*/i, '');
    const candidate = source.split(/(?:——+|—+|--+|:|：|\n)/)[0].trim();
    if (!candidate || candidate === '实体设定' || /^entity(?:\s+setting)?$/i.test(candidate))
      return '';
    if (entityId && candidate === entityId.trim()) return '';
    return candidate;
  }

  _getSnapshotEntityDisplayMap(snapshot) {
    const map = new Map();
    const settings = snapshot?.world_setting?.settings;
    if (!settings || typeof settings !== 'object') return map;

    const eStore = typeof window !== 'undefined' ? window.entityStore : null;
    if (eStore && typeof eStore.inspectDisplayNames === 'function') {
      const inspection = eStore.inspectDisplayNames(settings);
      const records = Array.isArray(inspection?.records) ? inspection.records : [];
      records.forEach(record => {
        if (!record?.entityId) return;
        map.set(record.entityId, record.displayName || record.entityId);
      });
      return map;
    }

    Object.entries(settings).forEach(([entityId, text]) => {
      if (!entityId || entityId.startsWith('_')) return;
      map.set(entityId, this._extractSnapshotEntityDisplayNameFromText(text, entityId) || entityId);
    });
    return map;
  }

  _formatSnapshotOpeningLocationText(location = null) {
    if (!location || typeof location !== 'object') return '';
    return [location.country || '', location.site || '', location.spot || '']
      .filter(Boolean)
      .join(' · ');
  }

  _isSnapshotOpeningLocationTooBroad(locationStr) {
    if (typeof locationStr !== 'string') return false;
    const normalized = locationStr.replace(/\s+/g, '');
    if (!normalized) return true;
    return /^(?:全空间站|全城|全国|全境|全域|全大陆|全世界|全区域|整个空间站|整个城市|整个大陆|整个世界)/.test(
      normalized
    );
  }

  _buildSnapshotOpeningLocationFromEventLocation(locationStr, snapshot, entityDisplayMap = null) {
    if (typeof locationStr !== 'string') {
      return { country: '', site: '', spot: '' };
    }
    const displayMap =
      entityDisplayMap instanceof Map
        ? entityDisplayMap
        : this._getSnapshotEntityDisplayMap(snapshot);
    const toDisplayName = value => {
      if (typeof value !== 'string') return '';
      const trimmed = value.trim();
      if (!trimmed) return '';
      return displayMap.get(trimmed) || trimmed;
    };
    const parts = locationStr
      .split(/\s*(?:-|—|·|\/)\s*/)
      .map(part => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return { country: '', site: '', spot: '' };
    if (parts.length === 1) return { country: toDisplayName(parts[0]), site: '', spot: '' };
    if (parts.length === 2) {
      return { country: toDisplayName(parts[0]), site: toDisplayName(parts[1]), spot: '' };
    }
    return {
      country: toDisplayName(parts[0]),
      site: toDisplayName(parts[1]),
      spot: toDisplayName(parts[2]),
    };
  }

  _isSnapshotOpeningEventLocationUsable(locationStr, snapshot, entityDisplayMap = null) {
    if (typeof locationStr !== 'string') return false;
    const trimmed = locationStr.trim();
    if (!trimmed) return false;
    if (/(未知|不详)/.test(trimmed)) return false;
    if (this._isSnapshotOpeningLocationTooBroad(trimmed)) return false;
    const parsed = this._buildSnapshotOpeningLocationFromEventLocation(
      trimmed,
      snapshot,
      entityDisplayMap
    );
    return Boolean(parsed.country || parsed.site || parsed.spot);
  }

  _getSnapshotAvailableOpeningNpcCandidates(
    snapshot,
    targetDate,
    runtime,
    precision,
    timeSegments
  ) {
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const candidates = [];
    for (const [characterId, character] of Object.entries(characterDatabase)) {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') continue;
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      if (!name) continue;
      const birthday =
        typeof runtime?._parseBirthdayDate === 'function'
          ? runtime._parseBirthdayDate(character.birthday)
          : runtime.parseTimeString?.(character.birthday);
      if (birthday && runtime.compareDates(targetDate, birthday, precision, timeSegments) < 0) {
        continue;
      }
      candidates.push({ id: characterId, name });
    }
    return candidates;
  }

  _getSnapshotOpeningEventCandidates(snapshot, runtime) {
    if (!snapshot || typeof snapshot !== 'object' || !runtime) return [];
    const { precision, timeSegments } = this._getSnapshotTimeConfig(snapshot);
    const entityDisplayMap = this._getSnapshotEntityDisplayMap(snapshot);
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const birthdaysByName = new Map();
    Object.entries(characterDatabase).forEach(([characterId, character]) => {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') return;
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      const birthday =
        typeof runtime?._parseBirthdayDate === 'function'
          ? runtime._parseBirthdayDate(character.birthday)
          : runtime.parseTimeString?.(character.birthday);
      if (name && birthday) birthdaysByName.set(name, birthday);
    });

    const events = Array.isArray(snapshot?.timeline?.events) ? snapshot.timeline.events : [];
    const candidates = [];
    events.forEach((event, index) => {
      if (!event || typeof event !== 'object') return;
      const dayText = typeof event.day === 'string' ? event.day.trim() : '';
      if (dayText === '无日期') return;
      if (typeof event.content !== 'string' || !event.content.trim()) return;
      const eventDate =
        typeof runtime._parseSnapshotEventDate === 'function'
          ? runtime._parseSnapshotEventDate(event)
          : null;
      if (!eventDate || eventDate.year <= 0) return;
      const normalizedDate =
        typeof runtime.normalizeDateForPrecision === 'function'
          ? runtime.normalizeDateForPrecision(eventDate, precision, timeSegments)
          : eventDate;
      if (!normalizedDate) return;
      const characters = this._splitTimelineCharacters(event.characters);
      const violatesBirthday = characters.some(name => {
        const birthday = birthdaysByName.get(name);
        return (
          birthday && runtime.compareDates(normalizedDate, birthday, precision, timeSegments) < 0
        );
      });
      if (violatesBirthday) return;
      if (!this._isSnapshotOpeningEventLocationUsable(event.location, snapshot, entityDisplayMap)) {
        return;
      }

      const availableNpcCandidates = this._getSnapshotAvailableOpeningNpcCandidates(
        snapshot,
        normalizedDate,
        runtime,
        precision,
        timeSegments
      );
      if (availableNpcCandidates.length === 0) return;

      const preferredNpcCandidates = availableNpcCandidates.filter(candidate =>
        characters.includes(candidate.name)
      );
      candidates.push({
        event,
        eventIndex: index,
        eventId:
          typeof runtime.getEventId === 'function'
            ? runtime.getEventId(event)
            : `${event.time}_${event.day}_${event.characters}_${(event.content || '').substring(0, 30)}`,
        eventDate: normalizedDate,
        location: this._buildSnapshotOpeningLocationFromEventLocation(
          event.location,
          snapshot,
          entityDisplayMap
        ),
        availableNpcCandidates,
        preferredNpcCandidates,
      });
    });

    candidates.sort((a, b) => {
      const diff = runtime.compareDates(a.eventDate, b.eventDate, precision, timeSegments);
      if (diff !== 0) return diff;
      return a.eventIndex - b.eventIndex;
    });
    return candidates;
  }

  _buildSnapshotRecommendedOpeningEventText(candidate, snapshot, entityDisplayMap = null) {
    const event = candidate?.event;
    if (!event || typeof event !== 'object') return '';
    const rawLocation = typeof event.location === 'string' ? event.location.trim() : '';
    const rawLocationParts = rawLocation
      ? rawLocation
          .split(/\s*(?:-|—|·|\/)\s*/)
          .map(part => part.trim())
          .filter(Boolean)
      : [];
    const displayMap =
      entityDisplayMap instanceof Map
        ? entityDisplayMap
        : this._getSnapshotEntityDisplayMap(snapshot);
    const displayLocationParts = rawLocationParts.map(part => displayMap.get(part) || part);
    const parsedLocationText = candidate?.location
      ? this._formatSnapshotOpeningLocationText(candidate.location)
      : '';
    return this._normalizeRecommendedOpeningText(
      [
        rawLocation,
        rawLocationParts.join(' '),
        displayLocationParts.join(' '),
        parsedLocationText,
        event.characters || '',
        event.content || '',
        event.time || '',
        event.day || '',
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  _scoreSnapshotRecommendedOpeningEvent(
    recommendationText,
    candidate,
    snapshot,
    entityDisplayMap = null
  ) {
    const normalizedRecommendation = this._normalizeRecommendedOpeningText(recommendationText);
    if (!normalizedRecommendation) {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }
    const eventText = this._buildSnapshotRecommendedOpeningEventText(
      candidate,
      snapshot,
      entityDisplayMap
    );
    if (!eventText) {
      return { score: 0, phraseHits: 0, fullMatch: false, longestCommon: 0 };
    }

    let score = 0;
    let phraseHits = 0;
    const fullMatch =
      eventText.includes(normalizedRecommendation) || normalizedRecommendation.includes(eventText);
    if (fullMatch) {
      score += 100 + Math.min(normalizedRecommendation.length, 40);
    }

    const phrases = this._extractRecommendedOpeningPhrases(recommendationText);
    phrases.forEach(phrase => {
      const normalizedPhrase = this._normalizeRecommendedOpeningText(phrase);
      if (!normalizedPhrase || normalizedPhrase.length < 2) return;
      if (eventText.includes(normalizedPhrase)) {
        phraseHits += 1;
        score += 30 + Math.min(normalizedPhrase.length * 3, 24);
      }
    });

    const longestCommon = this._getLongestCommonSubstringLength(
      normalizedRecommendation,
      eventText
    );
    score += Math.min(longestCommon * 2, 24);

    return { score, phraseHits, fullMatch, longestCommon };
  }

  _findSnapshotRecommendedOpeningEvent(
    snapshot,
    recommendationText,
    candidateEvents,
    entityDisplayMap = null
  ) {
    if (!recommendationText || !Array.isArray(candidateEvents) || candidateEvents.length === 0) {
      return null;
    }
    const scored = candidateEvents
      .map(candidate => ({
        candidate,
        ...this._scoreSnapshotRecommendedOpeningEvent(
          recommendationText,
          candidate,
          snapshot,
          entityDisplayMap
        ),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.candidate.eventIndex - a.candidate.eventIndex;
      });
    if (scored.length === 0) return null;
    const best = scored[0];
    const second = scored[1] || null;
    const isStrongMatch =
      best.fullMatch || best.phraseHits > 0 || best.longestCommon >= 5 || best.score >= 18;
    const isUniqueMatch = !second || best.score >= second.score + 5;
    if (!isStrongMatch || !isUniqueMatch) return null;
    return best.candidate;
  }

  _buildRecommendedOpeningSnippet(content = '') {
    if (typeof content !== 'string') return '';
    let snippet = content.replace(/\s+/g, ' ').trim();
    if (!snippet) return '';
    const sentenceMatch = snippet.match(/^[^。！？!?]+/);
    snippet = sentenceMatch ? sentenceMatch[0].trim() : snippet;
    if (snippet.length > 18) {
      snippet = snippet.slice(0, 18).trim();
    }
    return snippet.replace(/[。！？!?…]+$/g, '').trim();
  }

  _buildRecommendedOpeningTextForCandidate(candidate) {
    if (!candidate?.event) return '';
    const locationText = this._formatSnapshotOpeningLocationText(candidate.location) || '现场';
    const snippet = this._buildRecommendedOpeningSnippet(candidate.event.content || '');
    if (!snippet) return '';
    const characters = this._splitTimelineCharacters(candidate.event.characters);
    const leadName = characters[0] || '';
    if (leadName) {
      return `从${locationText}里${leadName}牵出的「${snippet}」开始。`;
    }
    return `从${locationText}里「${snippet}」开始。`;
  }

  _repairRecommendedOpeningTextForSnapshot(snapshot, report = null) {
    const runtime = this._getTimeValidationRuntime();
    if (!snapshot || typeof snapshot !== 'object' || !runtime) {
      return { applied: false, fixes: [] };
    }
    const initText = snapshot?.prompt_modules?.modules?.init;
    if (typeof initText !== 'string' || !initText.trim()) {
      return { applied: false, fixes: [] };
    }
    const recommendationText = this._extractInitRecommendedOpeningText(initText);
    if (!recommendationText) {
      return { applied: false, fixes: [] };
    }

    const entityDisplayMap = this._getSnapshotEntityDisplayMap(snapshot);
    const candidateEvents = this._getSnapshotOpeningEventCandidates(snapshot, runtime);
    if (candidateEvents.length === 0) {
      return { applied: false, fixes: [] };
    }

    const matchedCandidate = this._findSnapshotRecommendedOpeningEvent(
      snapshot,
      recommendationText,
      candidateEvents,
      entityDisplayMap
    );
    if (matchedCandidate) {
      return { applied: false, fixes: [] };
    }

    const targetCandidate = candidateEvents[candidateEvents.length - 1];
    const nextRecommendationText = this._buildRecommendedOpeningTextForCandidate(targetCandidate);
    if (!nextRecommendationText) {
      return { applied: false, fixes: [] };
    }

    const nextInitText = this._replaceInitRecommendedOpeningText(initText, nextRecommendationText);
    if (nextInitText === initText) {
      return { applied: false, fixes: [] };
    }

    snapshot.prompt_modules.modules.init = nextInitText;
    this._recordSnapshotRepair(
      report,
      'prompt_modules.modules.init',
      `推荐剧情已自动改写为可命中最新开场事件：${nextRecommendationText}`
    );
    return {
      applied: true,
      fixes: [
        {
          path: 'prompt_modules.modules.init',
          message: `推荐剧情已自动改写为 ${nextRecommendationText}`,
        },
      ],
    };
  }

  _validateStage2PromptModules(parsed, { context = 'stage2-raw' } = {}) {
    const report = {
      ok: true,
      checkedAt: new Date().toISOString(),
      fatalErrors: [],
      warnings: [],
      autoFixes: [],
    };

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this._pushStage2Issue(report, 'fatal', 'Stage2 输出必须是 JSON 对象');
      report.ok = false;
      return report;
    }

    const modules = parsed.modules;
    if (!modules || typeof modules !== 'object' || Array.isArray(modules)) {
      this._pushStage2Issue(report, 'fatal', '`modules` 必须是对象');
    }
    const moduleIds =
      modules && typeof modules === 'object' && !Array.isArray(modules) ? Object.keys(modules) : [];
    if (moduleIds.length === 0) {
      this._pushStage2Issue(report, 'fatal', '`modules` 不能为空对象');
    }
    if (moduleIds.includes('random_opening')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`random_opening` 只能出现在顶层 JSON，不能写进 `modules`'
      );
    }

    const moduleMeta = parsed.module_meta;
    if (!moduleMeta || typeof moduleMeta !== 'object' || Array.isArray(moduleMeta)) {
      this._pushStage2Issue(report, 'fatal', '`module_meta` 必须是对象（用于参数级描述）');
    }

    if (report.fatalErrors.length > 0) {
      report.ok = false;
      return report;
    }

    const metaIds = Object.keys(moduleMeta);

    if (typeof parsed._summary !== 'string' || !parsed._summary.trim()) {
      this._pushStage2Issue(report, 'warning', '`_summary` 缺失或为空');
    }

    const openingGreeting = parsed.opening_greeting;
    if (typeof openingGreeting !== 'string' || !openingGreeting.trim()) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`opening_greeting` 缺失或为空（必须提供 Turn 0 开场白）'
      );
    } else if (openingGreeting.trim().length < STAGE2_OPENING_GREETING_MIN_LENGTH) {
      this._pushStage2Issue(
        report,
        'warning',
        `opening_greeting 过短（< ${STAGE2_OPENING_GREETING_MIN_LENGTH} 字）`
      );
    } else if (
      !this._hasConcreteTimeExample(
        openingGreeting,
        this.designConfig?.step3_fields?._worldTermsSource?.time_precision || 'time'
      )
    ) {
      // 从抽象描述升级为带具体示例的 correction prompt: 第二轮反馈时 AI 收到的就是这条消息,
      // 给个完整时间戳样例几乎一定能照着写, 解决 "AI 重试一次仍不通过" 的循环。
      const precision = this.designConfig?.step3_fields?._worldTermsSource?.time_precision || 'time';
      const eraName = this.designConfig?.step3_fields?._worldTermsSource?.eraName || '纪年名';
      const exampleByPrecision = {
        time: `\`${eraName}214.02.14 09:30\`（完整年.月.日 时:分）`,
        day: `\`${eraName}214.02.14\`（年.月.日）`,
        month: `\`${eraName}214.02\`（年.月）`,
        year: `\`${eraName}214\`（仅年）`,
      };
      const example = exampleByPrecision[precision] || exampleByPrecision.time;
      this._pushStage2Issue(
        report,
        'fatal',
        `\`opening_greeting\` 缺少符合当前设定精度（${precision}）的时间戳示例。请在开场白中至少包含一个形如 ${example} 的完整时间戳，让玩家能选择不同时代起点。`
      );
    }

    if (typeof openingGreeting === 'string' && openingGreeting.trim()) {
      const timeOptionRE = /[\u4e00-\u9fff]+\s*\d+[\.。]\d+[\.。]\d+/g;
      const timeOptions = openingGreeting.match(timeOptionRE) || [];
      if (timeOptions.length > 1 && new Set(timeOptions).size < timeOptions.length) {
        this._pushStage2Issue(
          report,
          'warning',
          `opening_greeting 时间选项重复（${timeOptions.join(' / ')}），玩家无法选择不同时代起点`
        );
      }
    }

    const initModule = typeof modules.init === 'string' ? modules.init : '';
    if (!/(?:推荐剧情|Recommended Opening)[：:]/i.test(initModule)) {
      this._pushStage2Issue(
        report,
        'warning',
        (window.i18nService?.getDesignLanguage?.() || 'zh-CN') === 'en'
          ? '`modules.init` is missing the standard `Recommended Opening: ...` line (Stage 4 will try to fill it)'
          : '`modules.init` 缺少标准行 `推荐剧情：...`（将在 Stage 4 尝试补齐）',
        'init'
      );
    }

    const lazyTemplateRe = /执行\s*[Cc]ase\s*[A-D]|依照模板|按模板|严格依照模板|见上文/i;
    if (lazyTemplateRe.test(initModule)) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`modules.init` 包含偷懒模板引用（如“执行 Case A-D”），必须写出完整分支逻辑',
        'init'
      );
    }

    if (parsed.random_opening !== undefined) {
      this._pushStage2Issue(
        report,
        'warning',
        '`random_opening` 已废弃，系统会在保存时自动忽略该字段'
      );
    }

    const extraMetaIds = metaIds.filter(id => !moduleIds.includes(id));
    extraMetaIds.forEach(id => {
      this._pushStage2Issue(
        report,
        'warning',
        '`module_meta` 存在未在 `modules` 中声明的额外 key',
        id
      );
    });

    moduleIds.forEach(id => {
      if (!STAGE2_MODULE_ID_RE.test(id)) {
        this._pushStage2Issue(report, 'warning', '模块 ID 不是 snake_case', id);
      }
      if (id === 'world_mechanics') {
        this._pushStage2Issue(
          report,
          'warning',
          '`world_mechanics` 不应单独成模块，应并入 `narrative_base`',
          id
        );
      }
      if (id === 'job_board') {
        this._pushStage2Issue(
          report,
          'warning',
          '`job_board` 为不建议模块（除非明确需要打工玩法）',
          id
        );
      }

      const content = modules[id];
      if (typeof content !== 'string') {
        this._pushStage2Issue(report, 'warning', '模块正文必须是字符串', id);
      } else {
        const text = content.trim();
        if (!text) {
          this._pushStage2Issue(report, 'warning', '模块正文为空', id);
        } else {
          if (text.length < STAGE2_MODULE_MIN_LENGTH) {
            this._pushStage2Issue(
              report,
              'warning',
              `模块正文过短（< ${STAGE2_MODULE_MIN_LENGTH} 字）`,
              id
            );
          }
          if (STAGE2_PLACEHOLDER_RE.test(text)) {
            this._pushStage2Issue(
              report,
              'warning',
              '模块正文包含占位词（TODO/TBD/待补充 等）',
              id
            );
          }
        }
      }

      const meta = moduleMeta[id];
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
        this._pushStage2Issue(report, 'warning', '`module_meta` 缺少该模块的描述对象', id);
        return;
      }

      STAGE2_META_FIELDS.forEach(field => {
        const value = meta[field];
        if (typeof value !== 'string') {
          this._pushStage2Issue(report, 'warning', `module_meta.${field} 必须是字符串`, id);
          return;
        }
        const text = value.trim();
        if (!text) {
          this._pushStage2Issue(report, 'warning', `module_meta.${field} 不能为空`, id);
          return;
        }
        if (STAGE2_PLACEHOLDER_RE.test(text)) {
          this._pushStage2Issue(report, 'warning', `module_meta.${field} 包含占位词`, id);
        }
      });
    });

    // npc_gen 模块必须存在
    if (!moduleIds.includes('npc_gen')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`npc_gen` 模块缺失（必须生成，用于 NPC 面板格式规范）'
      );
    }
    // init 模块必须存在
    if (!moduleIds.includes('init')) {
      this._pushStage2Issue(report, 'fatal', '`init` 模块缺失（必须生成，用于 Turn 1 开场引导）');
    }
    // narrative_base 模块必须存在
    if (!moduleIds.includes('narrative_base')) {
      this._pushStage2Issue(
        report,
        'fatal',
        '`narrative_base` 模块缺失（必须生成，用于叙事基线与文风规范）'
      );
    }

    // npc_fields 验证：仅校验 AI 的 Stage 2 原始输出。
    // 快照里 npc_fields 已被搬进 step3_fields.panel_npc，
    // 由 _validateCharacterDatabasePanelConsistency / worldCardInspection 负责。
    if (context === 'stage2-raw') {
      const npcFields = parsed.npc_fields;
      if (!Array.isArray(npcFields)) {
        this._pushStage2Issue(report, 'fatal', '`npc_fields` 必须是数组（NPC 面板字段定义）');
      } else if (npcFields.length === 0) {
        this._pushStage2Issue(report, 'fatal', '`npc_fields` 不能为空数组');
      } else {
        const seenKeys = new Set();
        const fixedKeys = this._getNpcReservedKeySet();
        for (let i = 0; i < npcFields.length; i++) {
          const f = npcFields[i];
          if (!f || typeof f !== 'object') {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] 不是有效对象`);
            continue;
          }
          if (typeof f.key !== 'string' || !f.key.trim()) {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] 缺少 key`);
            continue;
          }
          if (typeof f.label !== 'string' || !f.label.trim()) {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] (${f.key}) 缺少 label`);
          }
          if (fixedKeys.has(f.key)) {
            this._pushStage2Issue(
              report,
              'warning',
              `npc_fields[${i}] (${f.key}) 与引擎固定字段冲突，将被忽略`
            );
          }
          if (seenKeys.has(f.key)) {
            this._pushStage2Issue(report, 'warning', `npc_fields[${i}] (${f.key}) key 重复`);
          }
          seenKeys.add(f.key);
        }
      }
    }

    report.ok = report.fatalErrors.length === 0;
    return report;
  }

  _compactStage2Validation(report) {
    if (!report) return null;
    const compact = {
      ok: report.ok,
      checkedAt: report.checkedAt,
      fatalErrors: report.fatalErrors.map(e => ({
        moduleId: e.moduleId || null,
        message: e.message,
      })),
      warnings: report.warnings.map(e => ({ moduleId: e.moduleId || null, message: e.message })),
      issueCount: report.fatalErrors.length + report.warnings.length,
    };
    if (Array.isArray(report.autoFixes) && report.autoFixes.length > 0) {
      compact.autoFixes = report.autoFixes.map(item => ({
        moduleId: item?.moduleId || null,
        field: item?.field || '',
        message: item?.message || '',
        value: item?.value || '',
      }));
      compact.autoFixCount = compact.autoFixes.length;
    }
    return compact;
  }

  _buildStage2CorrectionPrompt(fatalMessages) {
    const calendarEra =
      this.designConfig?.step3_fields?._worldTermsSource?.calendar_era || '纪元名';
    const precision =
      this.designConfig?.step3_fields?._worldTermsSource?.time_precision || 'time';

    const errorList = fatalMessages.map((msg, i) => `${i + 1}. ${msg}`).join('\n');

    let timeHint = '';
    if (fatalMessages.some(m => m.includes('opening_greeting') || m.includes('时间'))) {
      const fmt =
        precision === 'time'  ? `${calendarEra}数字.数字.数字 HH:MM` :
        precision === 'day'   ? `${calendarEra}数字.数字.数字` :
        precision === 'month' ? `${calendarEra}数字.数字` : `${calendarEra}数字`;
      const ex =
        precision === 'time'  ? `${calendarEra}200.05.12 09:00` :
        precision === 'day'   ? `${calendarEra}200.05.12` :
        precision === 'month' ? `${calendarEra}200.05` : `${calendarEra}200`;
      timeHint =
        `\n\n**特别注意**：opening_greeting 中必须包含完整时间标记，格式为「${fmt}」` +
        `（如「${ex}」）。不要使用"鼎盛期""初期"等模糊描述代替。`;
    }

    // opening_greeting 缺失/为空类硬约束：上次模型直接漏掉了字段
    let missingFieldHint = '';
    if (fatalMessages.some(m => m.includes('opening_greeting') && (m.includes('缺失') || m.includes('为空')))) {
      missingFieldHint =
        `\n\n**强制要求**：opening_greeting 是必填字段，必须出现在 JSON 顶层且为非空字符串。` +
        `请在 JSON 顶层补上 "opening_greeting": "..." ，内容为 Turn 0 的开场白文本（≥ 30 字），` +
        `绝对不能省略、不能为空字符串、不能为 null。`;
    }

    return (
      `你上一次输出的 JSON 未通过校验，存在以下致命问题：\n${errorList}${timeHint}${missingFieldHint}` +
      `\n\n请修正以上问题，重新输出**完整的** JSON 对象。保持与上次相同的整体结构，只修正上述问题。`
    );
  }

  _buildStage2ValidationMessage(parsed, report) {
    const summary = parsed?._summary || '规则系统生成完成';
    if (!report) return summary;

    const issueCount = report.fatalErrors.length + report.warnings.length;
    if (issueCount === 0) {
      return `${summary}\n\n✅ Stage2 校验通过（0 条问题）`;
    }

    const lines = report.warnings.slice(0, 3).map(issue => {
      const prefix = issue.moduleId ? `\`${issue.moduleId}\` ` : '';
      return `- ${prefix}${issue.message}`;
    });
    const remains = issueCount - lines.length;
    if (remains > 0) {
      lines.push(`- 其余 ${remains} 条见【代码预览】标红提示`);
    }

    return `${summary}\n\n⚠️ Stage2 校验通过（${issueCount} 条质量提示，稍注意即可）\n${lines.join('\n')}`;
  }

  _getTimeValidationRuntime() {
    if (typeof timelineService !== 'undefined' && timelineService) return timelineService;
    return null;
  }

  _getSnapshotTimeConfig(snapshot) {
    const runtime = this._getTimeValidationRuntime();
    if (runtime && typeof runtime.getTimeConfigFromSnapshot === 'function') {
      return runtime.getTimeConfigFromSnapshot(snapshot);
    }
    return {
      precision: 'time',
      timeSegments: [],
    };
  }

  _pushSnapshotValidationIssue(target, message, path = null) {
    if (!Array.isArray(target)) return;
    const issue = path ? { path, message } : { message };
    target.push(issue);
  }

  _normalizeValidationPrecision(precision = 'time') {
    return ['year', 'month', 'day', 'time'].includes(precision) ? precision : 'time';
  }

  _normalizeClockTimeString(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{2}):(\d{2})$/);
    if (!match) return '';
    const hour = Number.parseInt(match[1], 10);
    const minute = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  _validateDateValueRange(date, precision = 'time', path = '', target = [], options = {}) {
    const normalizedPrecision = this._normalizeValidationPrecision(precision);
    const allowNegativeYear = options.allowNegativeYear !== false;
    const hasMonth =
      date && date.month !== undefined && date.month !== null && `${date.month}`.trim() !== '';
    const hasDay =
      date && date.day !== undefined && date.day !== null && `${date.day}`.trim() !== '';
    let valid = true;

    const year = Number.parseInt(date?.year, 10);
    if (!Number.isFinite(year) || year === 0 || (!allowNegativeYear && year < 0)) {
      this._pushSnapshotValidationIssue(target, `${path || '日期'} 的 year 非法`, path || null);
      return false;
    }

    if (['month', 'day', 'time'].includes(normalizedPrecision) || hasMonth) {
      const month = Number.parseInt(date?.month, 10);
      if (!Number.isFinite(month) || month < 1 || month > 12) {
        this._pushSnapshotValidationIssue(
          target,
          `${path || '日期'} 的 month=${date?.month} 超出范围（1-12）`,
          path || null
        );
        valid = false;
      }
    }

    if (['day', 'time'].includes(normalizedPrecision) || hasDay) {
      const day = Number.parseInt(date?.day, 10);
      if (!Number.isFinite(day) || day < 1 || day > 30) {
        this._pushSnapshotValidationIssue(
          target,
          `${path || '日期'} 的 day=${date?.day} 超出范围（1-30）`,
          path || null
        );
        valid = false;
      }
    }

    if (normalizedPrecision === 'time') {
      const timeStr = this._normalizeClockTimeString(date?.time_str || date?.timeStr || '');
      if (!timeStr) {
        this._pushSnapshotValidationIssue(
          target,
          `${path || '日期'} 的 time_str 必须是严格 HH:MM 格式`,
          path || null
        );
        valid = false;
      }
    }

    return valid;
  }

  _splitTimelineCharacters(characters) {
    if (typeof characters !== 'string') return [];
    return characters
      .split(/\s*\/\s*|\s*,\s*|\s+/)
      .map(name => name.trim())
      .filter(Boolean);
  }

  _extractConcreteTimeExamplesFromText(text, precision = 'time', runtime = null) {
    const source = typeof text === 'string' ? text : '';
    if (!source.trim() || !runtime || typeof runtime.parseTimeString !== 'function') return [];

    const normalizedPrecision = this._normalizeValidationPrecision(precision);
    const patterns =
      normalizedPrecision === 'year'
        ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d{3,}/g]
        : normalizedPrecision === 'month'
          ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+/g]
          : normalizedPrecision === 'time'
            ? [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+\s+\d{2}:\d{2}/g]
            : [/(?:Pre-|前)?[A-Za-z\u4e00-\u9fa5_-]*\s*\d+[\.。]\d+[\.。]\d+/g];

    const results = [];
    const seen = new Set();
    for (const pattern of patterns) {
      const matches = source.match(pattern) || [];
      for (const rawMatch of matches) {
        const value = typeof rawMatch === 'string' ? rawMatch.trim() : '';
        if (!value || seen.has(value)) continue;
        const parsed = runtime.parseTimeString(value);
        if (!parsed) continue;
        seen.add(value);
        results.push({ text: value, date: parsed });
      }
    }
    return results;
  }

  _resolvePromptTimeReferenceWindow(
    report,
    parsedTimelineDates,
    precision = 'day',
    timeSegments = [],
    runtime = null
  ) {
    if (!runtime || typeof runtime.compareDates !== 'function') return null;
    const dates = Array.isArray(parsedTimelineDates) ? parsedTimelineDates.slice() : [];
    if (dates.length === 0) return null;
    dates.sort((a, b) => runtime.compareDates(a, b, precision, timeSegments));
    const tail = dates.slice(-3);
    return {
      start: tail[0],
      end: tail[tail.length - 1],
      label: '主时间线末段',
    };
  }

  _isDateInsideWindow(date, window, precision = 'day', timeSegments = [], runtime = null) {
    if (
      !date ||
      !window?.start ||
      !window?.end ||
      !runtime ||
      typeof runtime.compareDates !== 'function'
    ) {
      return false;
    }
    return (
      runtime.compareDates(date, window.start, precision, timeSegments) >= 0 &&
      runtime.compareDates(date, window.end, precision, timeSegments) <= 0
    );
  }

  _validatePromptModuleTimeConsistency(
    snapshot,
    report,
    parsedTimelineDates,
    precision,
    timeSegments,
    runtime
  ) {
    const promptModules = snapshot?.prompt_modules;
    if (!promptModules || typeof promptModules !== 'object') return;

    const referenceWindow = this._resolvePromptTimeReferenceWindow(
      report,
      parsedTimelineDates,
      precision,
      timeSegments,
      runtime
    );
    if (!referenceWindow) return;

    const openingExamples = this._extractConcreteTimeExamplesFromText(
      promptModules?.opening_greeting,
      precision,
      runtime
    );
    if (openingExamples.length > 0) {
      const validExamples = openingExamples.filter(item =>
        this._validateDateValueRange(
          item.date,
          precision,
          'prompt_modules.opening_greeting 时间示例',
          report.errors,
          { timeSegments }
        )
      );
      if (
        validExamples.length > 0 &&
        !validExamples.some(item =>
          this._isDateInsideWindow(item.date, referenceWindow, precision, timeSegments, runtime)
        )
      ) {
        const preview = validExamples
          .slice(0, 3)
          .map(item => item.text)
          .join(' / ');
        this._pushSnapshotValidationIssue(
          report.errors,
          `opening_greeting 的具体时间示例（${preview}）不在${referenceWindow.label}内`,
          'prompt_modules.opening_greeting'
        );
      }
    }
  }

  _validateTimeLabelSemantics(snapshot, observedDates, report) {
    const panelStatus = Array.isArray(snapshot?.step3_fields?.panel_status)
      ? snapshot.step3_fields.panel_status
      : [];
    const timeGroup = panelStatus.find(
      group => group && (group._template === 'time' || group.key === 'datetime')
    );
    if (!timeGroup || !Array.isArray(timeGroup.fields)) return;

    const yearField = timeGroup.fields.find(field => field?.key === 'year');
    const monthField = timeGroup.fields.find(field => field?.key === 'month');
    const dates = Array.isArray(observedDates) ? observedDates : [];
    const positiveYears = dates
      .map(item => Number.parseInt(item?.year, 10))
      .filter(value => Number.isFinite(value) && value > 0);
    const months = dates
      .map(item => Number.parseInt(item?.month, 10))
      .filter(value => Number.isFinite(value) && value > 0);
    const maxYear = positiveYears.length > 0 ? Math.max(...positiveYears) : null;
    const maxMonth = months.length > 0 ? Math.max(...months) : null;

    if (
      yearField?.label &&
      /世纪/.test(yearField.label) &&
      Number.isFinite(maxYear) &&
      maxYear >= 100
    ) {
      this._pushSnapshotValidationIssue(
        report.warnings,
        `时间字段 year 标签为「${yearField.label}」，但世界实际使用 ${maxYear} 这类年份值，语义容易误导`,
        'step3_fields.panel_status.datetime.year'
      );
    }

    if (
      monthField?.label &&
      /季(节)?/.test(monthField.label) &&
      Number.isFinite(maxMonth) &&
      maxMonth > 4
    ) {
      this._pushSnapshotValidationIssue(
        report.warnings,
        `时间字段 month 标签为「${monthField.label}」，但世界实际出现 ${maxMonth} 这类月份值，语义容易误导`,
        'step3_fields.panel_status.datetime.month'
      );
    }
  }

  _recordSnapshotRepair(report, path, message) {
    if (!report || typeof report !== 'object') return;
    if (!Array.isArray(report.fixes)) report.fixes = [];
    report.applied = true;
    report.fixes.push(path ? { path, message } : { message });
  }

  _getSnapshotTimeEra(snapshot) {
    const panelStatus = Array.isArray(snapshot?.step3_fields?.panel_status)
      ? snapshot.step3_fields.panel_status
      : [];
    const timeGroup = panelStatus.find(
      group => group && (group._template === 'time' || group.key === 'datetime')
    );
    if (typeof timeGroup?._era === 'string' && timeGroup._era.trim()) {
      return timeGroup._era.trim();
    }
    const worldTermsEra = snapshot?.step3_fields?._worldTermsSource?.calendar_era;
    return typeof worldTermsEra === 'string' ? worldTermsEra.trim() : '';
  }

  _formatSnapshotDateText(date, snapshot, options = {}) {
    if (!date || !Number.isFinite(Number.parseInt(date.year, 10))) return '';
    const precision = this._normalizeValidationPrecision(
      typeof options.precision === 'string'
        ? options.precision
        : this._getTimePrecisionFromStep3Fields(snapshot?.step3_fields)
    );
    const era = this._getSnapshotTimeEra(snapshot);
    const spaced = options.spaced === true;
    const prefix = era ? `${era}${spaced ? ' ' : ''}` : '';
    const year = `${Number.parseInt(date.year, 10)}`;
    const month = String(Math.max(1, Math.min(12, Number.parseInt(date.month, 10) || 1))).padStart(
      2,
      '0'
    );
    const day = String(Math.max(1, Math.min(30, Number.parseInt(date.day, 10) || 1))).padStart(
      2,
      '0'
    );
    let text = `${prefix}${year}`;
    if (['month', 'day', 'time'].includes(precision)) text += `.${month}`;
    if (['day', 'time'].includes(precision)) text += `.${day}`;
    if (precision === 'time') {
      const timeStr = typeof date.time_str === 'string' ? date.time_str.trim() : '';
      if (timeStr) text += ` ${timeStr}`;
    }
    return text.trim();
  }

  _clampDateForSnapshotRepair(date, precision = 'day', timeSegments = []) {
    if (!date || typeof date !== 'object') return { date: null, changed: false };
    const normalizedPrecision = this._normalizeValidationPrecision(precision);
    const year = Number.parseInt(date.year, 10);
    if (!Number.isFinite(year) || year === 0) {
      return { date: null, changed: false };
    }

    const next = { year };
    let changed = false;

    const rawMonth = Number.parseInt(date.month, 10);
    if (['month', 'day', 'time'].includes(normalizedPrecision) || date.month !== undefined) {
      const month = Number.isFinite(rawMonth) ? Math.max(1, Math.min(12, rawMonth)) : 1;
      next.month = month;
      if (!Number.isFinite(rawMonth) || rawMonth !== month) changed = true;
    }

    const rawDay = Number.parseInt(date.day, 10);
    if (['day', 'time'].includes(normalizedPrecision) || date.day !== undefined) {
      const day = Number.isFinite(rawDay) ? Math.max(1, Math.min(30, rawDay)) : 1;
      next.day = day;
      if (!Number.isFinite(rawDay) || rawDay !== day) changed = true;
    }

    if (normalizedPrecision === 'time') {
      const timeStr = this._normalizeClockTimeString(date.time_str || date.timeStr || '');
      next.time_str = timeStr || '00:00';
      if (timeStr !== next.time_str) changed = true;
    }

    return { date: next, changed };
  }

  _repairCharacterTimelineDates(snapshot, precision, timeSegments, runtime, repairReport, options) {
    const skipCharIds = options?.skipCharIds;
    const characterTimelines =
      snapshot?.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    for (const [characterId, timelineGroup] of Object.entries(characterTimelines)) {
      if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
        continue;
      if (skipCharIds?.has(characterId)) continue;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : null;
        if (!entries || entries.length === 0) continue;

        entries.forEach((entry, index) => {
          if (!entry || typeof entry !== 'object') return;
          const fixed = this._clampDateForSnapshotRepair(entry, precision, timeSegments);
          if (!fixed.date || !fixed.changed) return;
          entry.year = fixed.date.year;
          if (fixed.date.month !== undefined) entry.month = fixed.date.month;
          if (fixed.date.day !== undefined) entry.day = fixed.date.day;
          if (fixed.date.time_str !== undefined) entry.time_str = fixed.date.time_str;
          this._recordSnapshotRepair(
            repairReport,
            `character_timelines.${characterId}.${section}[${index}]`,
            `${characterId}.${section}[${index}] 的时间已自动修正到合法范围`
          );
        });

        const sorted = entries
          .map((entry, index) => ({
            entry,
            index,
            date: runtime._parseTimelineNodeDate?.(entry),
          }))
          .sort((a, b) => {
            if (!a.date && !b.date) return a.index - b.index;
            if (!a.date) return 1;
            if (!b.date) return -1;
            return runtime.compareDates(a.date, b.date, precision, timeSegments);
          })
          .map(item => item.entry);

        const changedOrder = sorted.some((entry, index) => entry !== entries[index]);
        if (changedOrder) {
          timelineGroup[section] = sorted;
          this._recordSnapshotRepair(
            repairReport,
            `character_timelines.${characterId}.${section}`,
            `${characterId}.${section} 已按时间自动排序`
          );
        }
      }
    }
  }

  _repairCharacterBirthdays(snapshot, precision, timeSegments, runtime, repairReport, options) {
    const skipCharIds = options?.skipCharIds;
    const characterDatabase =
      snapshot?.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    const timelineEvents = Array.isArray(snapshot?.timeline?.events)
      ? snapshot.timeline.events
      : [];
    const characterTimelines =
      snapshot?.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    const earliestById = new Map();
    const earliestByName = new Map();

    const rememberEarliest = (map, key, date) => {
      if (!key || !date) return;
      const prev = map.get(key);
      if (!prev || runtime.compareDates(date, prev, precision, timeSegments) < 0) {
        map.set(key, date);
      }
    };

    timelineEvents.forEach(event => {
      const eventDate = runtime._parseSnapshotEventDate?.(event);
      const fixed = this._clampDateForSnapshotRepair(eventDate, precision, timeSegments);
      if (!fixed.date) return;
      this._splitTimelineCharacters(event?.characters).forEach(name => {
        rememberEarliest(earliestByName, name, fixed.date);
      });
    });

    Object.entries(characterTimelines).forEach(([characterId, timelineGroup]) => {
      if (characterId.startsWith('_') || !timelineGroup || typeof timelineGroup !== 'object')
        return;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(timelineGroup[section]) ? timelineGroup[section] : [];
        entries.forEach(entry => {
          const entryDate = runtime._parseTimelineNodeDate?.(entry);
          const fixed = this._clampDateForSnapshotRepair(entryDate, precision, timeSegments);
          if (!fixed.date) return;
          rememberEarliest(earliestById, characterId, fixed.date);
        });
      }
    });

    Object.entries(characterDatabase).forEach(([characterId, character]) => {
      if (characterId.startsWith('_') || !character || typeof character !== 'object') return;
      if (skipCharIds?.has(characterId)) return;
      if (typeof character.birthday === 'string') {
        const rawBirthday = character.birthday.trim();
        if (/^null$/i.test(rawBirthday)) {
          character.birthday = null;
          this._recordSnapshotRepair(
            repairReport,
            `character_database.${characterId}.birthday`,
            `${characterId}.birthday 已自动改为 null`
          );
        } else if (rawBirthday) {
          const normalizedBirthday = this._normalizeBirthdayStringForPrecision(
            rawBirthday,
            precision,
            snapshot
          );
          if (normalizedBirthday !== rawBirthday) {
            character.birthday = normalizedBirthday;
            this._recordSnapshotRepair(
              repairReport,
              `character_database.${characterId}.birthday`,
              `${characterId}.birthday 已自动规范为纯日期`
            );
          }
        }
      }
      const name = typeof character.name === 'string' ? character.name.trim() : '';
      const earliest = earliestById.get(characterId) || earliestByName.get(name) || null;
      const parsedBirthday = runtime._parseBirthdayDate?.(character.birthday);
      const fixedBirthday = this._clampDateForSnapshotRepair(
        parsedBirthday,
        precision,
        timeSegments
      );

      if (fixedBirthday.date && fixedBirthday.changed) {
        const nextBirthdayText = this._formatSnapshotDateText(fixedBirthday.date, snapshot, {
          precision: 'day',
        });
        if (nextBirthdayText && character.birthday !== nextBirthdayText) {
          character.birthday = nextBirthdayText;
          this._recordSnapshotRepair(
            repairReport,
            `character_database.${characterId}.birthday`,
            `${characterId}.birthday 已自动修正到合法范围`
          );
        }
      }

      const currentBirthday = runtime._parseBirthdayDate?.(character.birthday);
      if (
        earliest &&
        (!currentBirthday ||
          runtime.compareDates(currentBirthday, earliest, precision, timeSegments) > 0)
      ) {
        // 在首次登场时间基础上减去 20 年，确保角色至少 20 岁
        const offsetYear = Math.max(1, earliest.year - 20);
        const offsetEarliest = { ...earliest, year: offsetYear };
        const repairedBirthday = this._formatSnapshotDateText(offsetEarliest, snapshot, {
          precision: 'day',
        });
        if (repairedBirthday && character.birthday !== repairedBirthday) {
          character.birthday = repairedBirthday;
          this._recordSnapshotRepair(
            repairReport,
            `character_database.${characterId}.birthday`,
            `${characterId}.birthday 已自动前移到首次登场前20年`
          );
        }
      }
    });
  }

  _repairPromptModuleTimeTexts(
    snapshot,
    precision,
    timeSegments,
    runtime,
    repairReport,
    referenceWindow
  ) {
    const promptModules = snapshot?.prompt_modules;
    if (!promptModules || typeof promptModules !== 'object' || !referenceWindow?.end) return;

    const fixedTimeText = this._formatSnapshotDateText(referenceWindow.end, snapshot, {
      precision,
      spaced: true,
    });
    if (!fixedTimeText) return;

    if (typeof promptModules.opening_greeting === 'string') {
      const openingExamples = this._extractConcreteTimeExamplesFromText(
        promptModules.opening_greeting,
        precision,
        runtime
      );
      let nextGreeting = promptModules.opening_greeting;
      const replaced = [];
      openingExamples.forEach(item => {
        if (this._isDateInsideWindow(item.date, referenceWindow, precision, timeSegments, runtime))
          return;
        nextGreeting = nextGreeting.split(item.text).join(fixedTimeText);
        replaced.push(item.text);
      });
      if (nextGreeting !== promptModules.opening_greeting) {
        promptModules.opening_greeting = nextGreeting;
        this._recordSnapshotRepair(
          repairReport,
          'prompt_modules.opening_greeting',
          `opening_greeting 的时间示例已自动改为 ${fixedTimeText}${replaced.length > 1 ? `（替换 ${replaced.length} 处）` : ''}`
        );
      }
    }
  }

  _repairSnapshotBeforePersist(snapshot, options) {
    const runtime = this._getTimeValidationRuntime();
    const report = {
      applied: false,
      fixes: [],
    };
    if (!snapshot || typeof snapshot !== 'object') return report;
    if (!runtime || typeof runtime.compareDates !== 'function') return report;

    const { precision, timeSegments } = this._getSnapshotTimeConfig(snapshot);
    this._repairCharacterTimelineDates(snapshot, precision, timeSegments, runtime, report, options);
    this._repairCharacterBirthdays(snapshot, precision, timeSegments, runtime, report, options);

    const timeReport = this._validateTimeConsistencyForSnapshot(snapshot);
    const referenceWindow = this._resolvePromptTimeReferenceWindow(
      timeReport,
      timeReport?.parsedTimelineDates || [],
      precision,
      timeSegments,
      runtime
    );
    if (referenceWindow?.start && referenceWindow?.end) {
      this._repairPromptModuleTimeTexts(snapshot, precision, timeSegments, runtime, report, {
        start: referenceWindow.start,
        end: referenceWindow.end,
        label: referenceWindow.label || '主时间线末段',
      });
    }
    this._repairRecommendedOpeningTextForSnapshot(snapshot, report);
    this._sanitizeSnapshotStructureSemantic(snapshot, report);

    return report;
  }

  _sanitizeSnapshotStructureSemantic(snapshot, report) {
    if (!snapshot) return;

    // 1. 确保 relationship_rules 存在，防止引发游戏内解析崩溃
    if (
      !snapshot.relationship_rules ||
      typeof snapshot.relationship_rules !== 'object' ||
      Array.isArray(snapshot.relationship_rules)
    ) {
      snapshot.relationship_rules = {};
      this._recordSnapshotRepair(
        report,
        'relationship_rules',
        '补充缺失的 relationship_rules 节点'
      );
    }

    // 1b. 若 relationship_rules 为空，尝试从 character_timelines 的最早 relationship 条目自动提取默认关系
    if (
      snapshot.relationship_rules &&
      typeof snapshot.relationship_rules === 'object' &&
      !Array.isArray(snapshot.relationship_rules)
    ) {
      const rr = snapshot.relationship_rules;
      const ct = snapshot.character_timelines;
      if (ct && typeof ct === 'object' && !Array.isArray(ct)) {
        const rrIds = Object.keys(rr).filter(k => !k.startsWith('_'));
        if (rrIds.length === 0) {
          // 从每个角色的 relationships 时间线中取最早一条作为默认关系
          let extracted = 0;
          for (const charId of Object.keys(ct).filter(k => !k.startsWith('_'))) {
            const relTimeline = ct[charId]?.relationships;
            if (!Array.isArray(relTimeline) || relTimeline.length === 0) continue;
            // 取时间最早的一条
            const earliest = relTimeline.reduce((a, b) => {
              const ay = a.year ?? 0,
                by = b.year ?? 0;
              if (ay !== by) return ay < by ? a : b;
              const am = a.month ?? 0,
                bm = b.month ?? 0;
              return am <= bm ? a : b;
            });
            if (earliest?.relations && typeof earliest.relations === 'object') {
              rr[charId] = { default: { ...earliest.relations } };
              extracted++;
            }
          }
          if (extracted > 0) {
            this._recordSnapshotRepair(
              report,
              'relationship_rules',
              `从 character_timelines 最早关系条目自动补全 relationship_rules（${extracted} 个角色）`
            );
          }
        }
      }
    }

    // 1c. relationship_rules 对称性自动修复
    // 若 A.default 定义了对 B 的关系，但 B.default 中缺少对 A 的定义，则自动补充反向关系为"未定义"。
    // 这样至少保证引擎能正常查找，而不是抛出 undefined。
    {
      const rr = snapshot.relationship_rules;
      if (rr && typeof rr === 'object' && !Array.isArray(rr)) {
        const rrIds = Object.keys(rr).filter(k => !k.startsWith('_'));
        let symmetryRepaired = 0;
        for (const charId of rrIds) {
          const rule = rr[charId];
          if (!rule?.default || typeof rule.default !== 'object') continue;
          for (const targetId of Object.keys(rule.default)) {
            if (!rrIds.includes(targetId)) continue;
            const targetRule = rr[targetId];
            if (!targetRule?.default) {
              rr[targetId] = { default: {} };
            }
            if (!rr[targetId].default[charId]) {
              rr[targetId].default[charId] = '未定义';
              symmetryRepaired++;
            }
          }
        }
        if (symmetryRepaired > 0) {
          this._recordSnapshotRepair(
            report,
            'relationship_rules',
            `自动补全 ${symmetryRepaired} 处单向关系的反向定义（值为"未定义"，建议在 P3 阶段补充实际关系描述）`
          );
        }
      }
    }

    // 2. 确保 timeline.events 均有 id 属性，且 day 字段为 "X日" 字符串
    if (snapshot.timeline && Array.isArray(snapshot.timeline.events)) {
      let repairedIds = 0;
      let repairedDays = 0;
      snapshot.timeline.events.forEach((event, idx) => {
        if (!event.id) {
          event.id = `evt_${String(idx + 1).padStart(3, '0')}`;
          repairedIds++;
        }
        if (typeof event.day === 'number') {
          event.day = `${event.day}日`;
          repairedDays++;
        }
      });
      if (repairedIds > 0) {
        this._recordSnapshotRepair(
          report,
          'timeline.events.id',
          `为 ${repairedIds} 个时间线事件补充独立 ID`
        );
      }
      if (repairedDays > 0) {
        this._recordSnapshotRepair(
          report,
          'timeline.events.day',
          `为 ${repairedDays} 个时间线事件的 day 字段补充 "日" 后缀`
        );
      }
    }

    // 3. 删除 prompt_modules 下误生成的局部 npc_fields 节点
    if (snapshot.prompt_modules && snapshot.prompt_modules.npc_fields) {
      delete snapshot.prompt_modules.npc_fields;
      this._recordSnapshotRepair(
        report,
        'prompt_modules.npc_fields',
        '剥离 prompt_modules 中非法的自定义 npc_fields 污染'
      );
    }

    // 4. 对 location_levels 做合法性语义回退
    const worldTerms = snapshot.step3_fields?._worldTermsSource;
    if (worldTerms && Array.isArray(worldTerms.location_levels)) {
      const ws = snapshot.world_setting?.settings || {};
      const entityNames = Object.values(ws)
        .filter(v => typeof v === 'string')
        .map(v => {
          const match = v.match(/(?:设定|Entity(?:\s+Setting)?)\s*--\s*(.+?)\s*[（(]/i);
          return match ? match[1].trim() : '';
        })
        .filter(Boolean);

      // 如果 location_levels 直接就是写死了大实体名字，则退回通用安全标签
      const hasEntityName = worldTerms.location_levels.some(
        l => entityNames.includes(l) || l.includes('实体') || /entity/i.test(l)
      );
      if (hasEntityName && worldTerms.location_levels.length > 0) {
        const safeFallbacks =
          (window.i18nService?.getDesignLanguage?.() || 'zh-CN') === 'en'
            ? ['Region', 'Location', 'Spot']
            : ['地区', '地点', '具体位置'];
        worldTerms.location_levels = safeFallbacks.slice(0, worldTerms.location_levels.length);
        this._recordSnapshotRepair(
          report,
          'worldTermsSource.location_levels',
          '修正 location_levels 直接使用了实体名的问题，已重置为通用回退词'
        );
      }
    }

    // 5. year 标签语义修正
    if (
      worldTerms &&
      Array.isArray(worldTerms.calendar_units) &&
      worldTerms.calendar_units.length > 0
    ) {
      const yearUnit = worldTerms.calendar_units[0];
      if (/(世纪|世代|纪元|期)/.test(yearUnit)) {
        // 跳过 Pre- 前缀的远古事件，取第一个非 Pre- 事件校验年份数字
        const events = snapshot.timeline?.events || [];
        const checkTL = events.find(e => e?.time && !/^Pre-/i.test(e.time));
        if (checkTL) {
          const stripped = (checkTL.time || '').replace(/^[^\d]+/, '');
          if (/^\d+/.test(stripped)) {
            worldTerms.calendar_units[0] = '年';
            this._recordSnapshotRepair(
              report,
              'worldTermsSource.calendar_units',
              "检测到普通年份数字配以'世纪'修饰符的冲突，已自动规范为'年'"
            );
          }
        }
      }
    }

    // 6. extra_char_fields 过滤重复或无效的通用字段
    if (worldTerms && Array.isArray(worldTerms.extra_char_fields)) {
      const originalLen = worldTerms.extra_char_fields.length;
      const invalidKeys = new Set([
        'personality',
        'appearance',
        'clothing',
        'name',
        'gender',
        'origin',
        'birthday',
        'cognitive_state',
        'msg_reply_tone',
        'trigger_type',
        'id',
      ]);
      worldTerms.extra_char_fields = worldTerms.extra_char_fields.filter(field => {
        return field && typeof field === 'object' && field.key && !invalidKeys.has(field.key);
      });
      if (worldTerms.extra_char_fields.length < originalLen) {
        this._recordSnapshotRepair(
          report,
          'worldTermsSource.extra_char_fields',
          '过滤了 extra_char_fields 中与系统自带字段重复冲突的废弃定义'
        );
      }
    }
  }

  _syncRepairedSnapshotSections(targetSnapshot, sourceSnapshot) {
    if (
      !targetSnapshot ||
      typeof targetSnapshot !== 'object' ||
      !sourceSnapshot ||
      typeof sourceSnapshot !== 'object'
    ) {
      return;
    }
    if (targetSnapshot.random_opening !== undefined) {
      delete targetSnapshot.random_opening;
    }
    const keys = ['character_database', 'character_timelines', 'prompt_modules', 'timeline'];
    keys.forEach(key => {
      if (sourceSnapshot[key] === undefined) {
        delete targetSnapshot[key];
        return;
      }
      targetSnapshot[key] = JSON.parse(JSON.stringify(sourceSnapshot[key]));
    });
  }

  _formatSnapshotRepairSummary(repairReport, prefix = '已自动修复') {
    if (
      !repairReport?.applied ||
      !Array.isArray(repairReport.fixes) ||
      repairReport.fixes.length === 0
    ) {
      return '';
    }
    return `${prefix} ${repairReport.fixes.length} 项`;
  }

  // ── Phase 2→3 时间一致性检查 ──────────────────────────────────

  /**
   * Phase 2 完成后执行：自动修复 AI 生成的时间异常，检测用户指定的时间异常并推入 Phase 3 问答。
   */
  _postPhase2ConsistencyCheck() {
    const dc = this.designConfig;
    const runtime = this._getTimeValidationRuntime();
    if (!dc || typeof dc !== 'object' || !runtime) return;

    // 跳过空桩数据的一致性检查
    const timelineEvents = Array.isArray(dc.timeline?.events) ? dc.timeline.events : [];
    if (timelineEvents.length === 0) {
      console.log('[DesignService] 时间线为空桩，跳过时间一致性检查');
      return;
    }

    // 1. 检测异常值（修复之前，保留原始值用于比对）
    const outliers = this._detectTimeOutliers(dc, runtime);

    // 2. 判定哪些异常是用户在 P1 中指定的
    const userSpecifiedCharIds = new Set();
    const userSpecifiedEventIndices = new Set();
    const userFindings = [];
    let findingCounter = 0;

    for (const outlier of outliers) {
      const isUserSpecified = this._isValueUserSpecified(outlier);
      if (isUserSpecified) {
        findingCounter++;
        const finding = {
          id: `finding_${findingCounter}`,
          type: outlier.type,
          characterId: outlier.characterId || null,
          eventIndex: outlier.eventIndex ?? null,
          fieldPath: outlier.fieldPath,
          currentValue: outlier.displayValue,
          expectedRange: outlier.expectedRange,
          resolved: false,
          resolution: null,
        };
        userFindings.push(finding);
        if (outlier.type === 'birthday' || outlier.type === 'character_timeline') {
          userSpecifiedCharIds.add(outlier.characterId);
        }
        if (outlier.type === 'event') {
          userSpecifiedEventIndices.add(outlier.eventIndex);
        }
      }
    }

    // 3. 运行修复，跳过用户指定的项目
    this._repairSnapshotBeforePersist(dc, { skipCharIds: userSpecifiedCharIds });

    // 4. 如有用户指定的异常项，推入 designChatHistory
    if (userFindings.length > 0) {
      this._pendingConsistencyFindings = userFindings;
      const message = this._formatConsistencyFindingsMessage(userFindings);
      if (typeof designChatHistory !== 'undefined') {
        designChatHistory.push({
          sender: 'ai',
          text: message,
          consistencyFindings: userFindings,
        });
      }
    }
  }

  /**
   * 检测快照中所有时间字段的异常值。
   * 返回异常列表，每项包含 type, characterId, eventIndex, fieldPath, year, displayValue, expectedRange。
   */
  _detectTimeOutliers(snapshot, runtime) {
    const outliers = [];
    const events = Array.isArray(snapshot.timeline?.events) ? snapshot.timeline.events : [];
    if (events.length < 3) return outliers; // 样本不足

    // 提取所有事件年份
    const eventYears = [];
    events.forEach((event, index) => {
      const parsed =
        runtime._parseSnapshotEventDate?.(event) || runtime.parseTimeString?.(event?.time);
      if (parsed && Number.isFinite(parsed.year)) {
        eventYears.push({ year: parsed.year, index });
      }
    });
    if (eventYears.length < 3) return outliers;

    const years = eventYears.map(e => e.year).sort((a, b) => a - b);
    const minYear = years[0];
    const maxYear = years[years.length - 1];
    const range = maxYear - minYear;
    const threshold = Math.max(range * 0.5, 50); // 至少 ±50 年余量
    const lowerBound = minYear - threshold;
    const upperBound = maxYear + threshold;
    const eraName = snapshot.step3_fields?._worldTermsSource?.calendar_era || '';

    const formatYear = year => (eraName ? `${eraName}${year}` : `${year}`);

    // 检查事件本身是否有异常（用中位数判断）
    eventYears.forEach(({ year, index }) => {
      if (year < lowerBound || year > upperBound) {
        const event = events[index];
        outliers.push({
          type: 'event',
          characterId: null,
          eventIndex: index,
          fieldPath: `timeline.events[${index}].time`,
          year,
          displayValue: event?.time || `${year}`,
          expectedRange: formatYear(minYear) + ' - ' + formatYear(maxYear),
        });
      }
    });

    // 检查角色生日
    const charDb =
      snapshot.character_database && typeof snapshot.character_database === 'object'
        ? snapshot.character_database
        : {};
    for (const [charId, character] of Object.entries(charDb)) {
      if (charId.startsWith('_') || !character || typeof character !== 'object') continue;
      const birthday =
        runtime._parseBirthdayDate?.(character.birthday) ||
        runtime.parseTimeString?.(character.birthday);
      if (!birthday || !Number.isFinite(birthday.year)) continue;
      if (birthday.year < lowerBound || birthday.year > upperBound) {
        outliers.push({
          type: 'birthday',
          characterId: charId,
          eventIndex: null,
          fieldPath: `character_database.${charId}.birthday`,
          year: birthday.year,
          displayValue: character.birthday || `${birthday.year}`,
          expectedRange: formatYear(minYear) + ' - ' + formatYear(maxYear),
          characterName: character.name || charId,
        });
      }
    }

    // 检查角色时间线条目
    const charTimelines =
      snapshot.character_timelines && typeof snapshot.character_timelines === 'object'
        ? snapshot.character_timelines
        : {};
    for (const [charId, group] of Object.entries(charTimelines)) {
      if (charId.startsWith('_') || !group || typeof group !== 'object') continue;
      for (const section of ['cognitive', 'relationships', 'status']) {
        const entries = Array.isArray(group[section]) ? group[section] : [];
        entries.forEach((entry, idx) => {
          const entryDate = runtime._parseTimelineNodeDate?.(entry);
          if (!entryDate || !Number.isFinite(entryDate.year)) return;
          if (entryDate.year < lowerBound || entryDate.year > upperBound) {
            const charName = charDb[charId]?.name || charId;
            outliers.push({
              type: 'character_timeline',
              characterId: charId,
              eventIndex: null,
              fieldPath: `character_timelines.${charId}.${section}[${idx}]`,
              year: entryDate.year,
              displayValue: `${entryDate.year}`,
              expectedRange: formatYear(minYear) + ' - ' + formatYear(maxYear),
              characterName: charName,
              section,
            });
          }
        });
      }
    }

    return outliers;
  }

  /**
   * 判断异常值是否为用户在 Phase 1 中指定。
   * 通过在 p1Output 文本中搜索年份数字来判定。
   */
  _isValueUserSpecified(outlier) {
    if (!this.p1Output || typeof this.p1Output !== 'object') return false;
    const yearStr = String(outlier.year);
    if (!yearStr || yearStr === 'NaN') return false;

    // 根据异常类型搜索对应的 P1 文本
    const searchTexts = [];
    if (outlier.type === 'birthday' || outlier.type === 'character_timeline') {
      if (this.p1Output.context_chars) searchTexts.push(this.p1Output.context_chars);
      if (this.p1Output.context_timeline) searchTexts.push(this.p1Output.context_timeline);
    } else if (outlier.type === 'event') {
      if (this.p1Output.context_timeline) searchTexts.push(this.p1Output.context_timeline);
      if (this.p1Output.context_world) searchTexts.push(this.p1Output.context_world);
    }

    return searchTexts.some(text => typeof text === 'string' && text.includes(yearStr));
  }

  /**
   * 格式化一致性发现为 Phase 3 聊天消息文本。
   */
  _formatConsistencyFindingsMessage(findings) {
    const lines = ['世界卡已生成完毕！在检查过程中发现以下时间设定可能需要您确认：\n'];
    findings.forEach((f, i) => {
      if (f.type === 'birthday') {
        lines.push(
          `${i + 1}. 角色「${f.characterName || f.characterId}」的生日为 **${f.currentValue}**，但世界主要事件发生在 **${f.expectedRange}**。`
        );
      } else if (f.type === 'event') {
        lines.push(
          `${i + 1}. 事件的时间为 **${f.currentValue}**，与其他事件（**${f.expectedRange}**）相差较大。`
        );
      } else if (f.type === 'character_timeline') {
        lines.push(
          `${i + 1}. 角色「${f.characterName || f.characterId}」的时间线条目在 **${f.displayValue}** 年，超出主要事件范围（**${f.expectedRange}**）。`
        );
      }
    });
    lines.push('\n请使用下方按钮处理，或忽略此提示直接开始编辑。');
    return lines.join('\n');
  }

  /**
   * 处理用户对一致性发现的响应（按钮点击）。
   * @param {string} findingId - finding 的 ID
   * @param {'fix'|'keep'|'custom'|'edit'} action - 用户选择的操作
   * @param {string} [customValue] - 自定义值（仅 action='custom' 时使用）
   */
  _resolveConsistencyFinding(findingId, action, customValue) {
    const findings = this._pendingConsistencyFindings;
    if (!Array.isArray(findings)) return;
    const finding = findings.find(f => f.id === findingId);
    if (!finding || finding.resolved) return;

    const dc = this.designConfig;

    if (action === 'keep') {
      finding.resolved = true;
      finding.resolution = 'keep';
    } else if (action === 'fix') {
      const runtime = this._getTimeValidationRuntime();
      if (runtime && finding.characterId) {
        // 构建 skipSet：跳过其他未处理的用户指定角色，只修复当前角色
        const otherUnresolved = new Set(
          findings
            .filter(f => !f.resolved && f.characterId && f.characterId !== finding.characterId)
            .map(f => f.characterId)
        );
        const { precision, timeSegments } = this._getSnapshotTimeConfig(dc);
        const tempReport = { applied: false, fixes: [] };
        if (finding.type === 'birthday') {
          this._repairCharacterBirthdays(dc, precision, timeSegments, runtime, tempReport, {
            skipCharIds: otherUnresolved,
          });
        } else if (finding.type === 'character_timeline') {
          this._repairCharacterTimelineDates(dc, precision, timeSegments, runtime, tempReport, {
            skipCharIds: otherUnresolved,
          });
        }
      }
      finding.resolved = true;
      finding.resolution = 'fix';
    } else if (action === 'custom' && customValue) {
      if (finding.type === 'birthday' && finding.characterId) {
        const char = dc.character_database?.[finding.characterId];
        if (char) {
          char.birthday = customValue;
        }
      }
      finding.resolved = true;
      finding.resolution = 'custom';
    } else if (action === 'edit') {
      // 预填 Phase 3 输入框（事件修改交给 AI 处理）
      const inputEl = document.querySelector('#design-chat-input, #chat-input');
      if (inputEl) {
        inputEl.value = `请修改时间线中第 ${(finding.eventIndex || 0) + 1} 个事件的时间到合理范围（当前为 ${finding.currentValue}，预期在 ${finding.expectedRange} 之间）`;
        inputEl.focus();
      }
      finding.resolved = true;
      finding.resolution = 'edit';
    }

    // 保存并刷新
    this._saveDesignConfig();
    this._updatePreviewPanel();

    // 更新聊天中的按钮状态
    this._updateConsistencyFindingUI(findingId, finding.resolution);
  }

  /**
   * 更新聊天消息中某个 finding 的按钮状态为已处理。
   */
  _updateConsistencyFindingUI(findingId, resolution) {
    const container = document.querySelector(`[data-finding-id="${findingId}"]`);
    if (!container) return;
    const buttons = container.querySelectorAll('button');
    buttons.forEach(btn => {
      btn.disabled = true;
      btn.style.opacity = '0.5';
    });
    const labels = { fix: '已修改', keep: '已保持', custom: '已自定义', edit: '已转至编辑' };
    const badge = document.createElement('span');
    badge.className = 'consistency-resolved-badge';
    badge.textContent = `✓ ${labels[resolution] || '已处理'}`; /* ui-lint-allow */
    badge.style.cssText = 'color: var(--status-success); font-size: var(--text-caption); margin-left: 8px;'; // ui-lint-allow
    container.appendChild(badge);
  }

}

_applyDesignServiceMixin(_DesignServiceP2Mixin);
