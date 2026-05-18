// ============================================
// Debug UI - Two-Column Layout (Refactored)
// ============================================

// 依赖: aiService (来自 aiService.js), JsonViewer (来自 utils/jsonViewer.js)

// ── State ────────────────────────────────────
let currentDebugPayload = null;
let currentDebugTab = 'api';
let currentSelectionMode = 'overview'; // 'overview' | 'step' | 'react-group' | 'settlement-group'
let currentSelectedStepIndex = null;   // step index for 'step' mode
let currentReactGroupIndex = null;     // group index for 'react-group' mode
let currentSettlementGroupIndex = null; // group index for 'settlement-group' mode
let _cachedSidebarGroups = null;       // cached groupStepsForSidebar result
let jsonViewerInstance = null;
let _stepsRendererEnabled = true;
let _stepTokenRenderGeneration = 0;
let _stepTokenRefreshQueued = false;

function _debugIsEnglish() {
    return (window.i18nService?.getResolvedLanguage?.() || 'zh-CN') === 'en';
}

function _debugText(key) {
    const zh = {
        gm: 'GM: 决策层',
        npc: 'NPC 反应',
        npcCardSync: 'NPC 卡片同步',
        npcIntroAudit: 'Him',
        ooc: 'OOC 元指令',
        empty: '暂无记录',
        copy: '复制',
        copied: '已复制',
        copyFailed: '复制失败',
        export: '导出',
        exported: '已导出',
        exportFailed: '导出失败',
        overview: 'Overview',
        request: '请求',
        response: '响应',
        rawJsonShow: '查看完整原始 JSON',
        rawJsonHide: '隐藏原始 JSON',
        reasoning: '推理过程',
        noTextOutput: '此步骤没有文本输出',
        warningCwm: 'warning cwm',
        apiFailed: 'API 调用失败',
        runtimePrefix: 'RuntimeWorldStore',
        critical: 'Critical Debug Error: ',
        reactLoop: 'ReAct 循环',
        iteration: '迭代',
        toolsCalled: '工具调用',
        narrativeOutput: '叙事输出',
        inputSummary: '输入摘要',
        outputSummary: '输出摘要',
        systemChars: '系统提示',
        userMessage: '用户消息',
        toolArgs: '参数',
        toolResult: '结果',
        skipped: '已跳过',
        parallel: '并行',
        phase1: 'Phase 1 — 并行执行',
        phase2: 'Phase 2 — GM 决策',
        phase3: 'Phase 3 — ReAct 循环',
        gmDecision: 'GM 决策',
        actionClassify: '行动分类',
        npcReactionsLabel: 'NPC 反应',
        expandResult: '展开结果',
        collapseResult: '收起结果',
        rawData: '原始数据',
        emptyIteration: '空迭代（无工具调用）',
        textOutput: '文本输出',
        phase4: 'Phase 4 — 结算调度',
        settlementDispatch: '结算调度',
        skillLabel: 'Skill',
        skillCount: '个 skill',
        round: '轮次',
        oocDirectiveLabel: 'OOC 准则（本轮生效 / regenerate 复用）',
    };
    const en = {
        gm: 'GM: Decision Layer',
        npc: 'NPC Reactions',
        npcCardSync: 'NPC Card Sync',
        npcIntroAudit: 'Him',
        ooc: 'OOC Directive',
        empty: 'No records yet',
        copy: 'Copy',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        export: 'Export',
        exported: 'Exported',
        exportFailed: 'Export failed',
        overview: 'Overview',
        request: 'Request',
        response: 'Response',
        rawJsonShow: 'Show full raw JSON',
        rawJsonHide: 'Hide raw JSON',
        reasoning: 'Reasoning',
        noTextOutput: 'No text output for this step',
        warningCwm: 'warning cwm',
        apiFailed: 'API request failed',
        runtimePrefix: 'RuntimeWorldStore',
        critical: 'Critical Debug Error: ',
        reactLoop: 'ReAct Loop',
        iteration: 'Iteration',
        toolsCalled: 'Tools Called',
        narrativeOutput: 'Narrative Output',
        inputSummary: 'Input Summary',
        outputSummary: 'Output Summary',
        systemChars: 'System Prompt',
        userMessage: 'User Message',
        toolArgs: 'Args',
        toolResult: 'Result',
        skipped: 'Skipped',
        parallel: 'Parallel',
        phase1: 'Phase 1 — Parallel Execution',
        phase2: 'Phase 2 — GM Decision',
        phase3: 'Phase 3 — ReAct Loop',
        gmDecision: 'GM Decision',
        actionClassify: 'Action Classify',
        npcReactionsLabel: 'NPC Reactions',
        expandResult: 'Expand Result',
        collapseResult: 'Collapse Result',
        rawData: 'Raw Data',
        emptyIteration: 'Empty iteration (no tool calls)',
        textOutput: 'Text Output',
        phase4: 'Phase 4 — Settlement Dispatch',
        settlementDispatch: 'Settlement Dispatch',
        skillLabel: 'Skill',
        skillCount: 'skills',
        round: 'Round',
        oocDirectiveLabel: 'OOC Directive (active this turn / reused on regenerate)',
    };
    return (_debugIsEnglish() ? en : zh)[key] || key;
}

function _translateDebugSource(source = '') {
    if (!_debugIsEnglish()) return source;
    return String(source)
        .replace('之前剧情的总结', 'Previous Summary')
        .replace('最近的主线剧情', 'Recent Main Story')
        .replace('当前角色档案(权威数据源)', 'Current Character Profile (Authoritative)')
        .replace('对话历史', 'Conversation History')
        .replace('本轮叙事', 'Current Narrative')
        .replace('已检索的参考资料', 'Retrieved References')
        .replace('上一轮游戏状态', 'Previous Turn State')
        .replace('短信记录(新消息)', 'SMS Records (New Messages)')
        .replace('当前游戏时间', 'Current Game Time')
        .replace('今日发生的事件', 'Events Today')
        .replace('最近的剧情原文', 'Recent Story Text')
        .replace('最近的剧情总结', 'Recent Story Summaries')
        .replace('与玩家的短信记录', 'SMS History with Player')
        .replace('消息间隔', 'Message Interval')
        .replace('当前角色', 'Current Character')
        .replace('开场引导规则', 'Opening Rules')
        .replace('Step2 选项（待解析）', 'Step2 Choices (Pending Parse)')
        .replace('预定义角色档案', 'Predefined Character Profiles')
        .replace('NPC 生成规范', 'NPC Generation Rules')
        .replace('额外指令(用户自定义)', 'Extra Instructions (User)')
        .replace('GM 写作指导', 'GM Writing Notes')
        .replace('GM 决策层核心指令', 'GM Core Decision Prompt')
        .replace('GM 静态数据(世界设定)', 'GM Static World Data')
        .replace('GM 时间线', 'GM Timeline')
        .replace('GM 世界设定', 'GM World Setting')
        .replace('GM 角色数据库', 'GM Character Database')
        .replace('GM 地图数据', 'GM Map Data')
        .replace('GM 动态数据(本局游戏)', 'GM Runtime State')
        .replace('GM 节奏统计', 'GM Pacing Stats')
        .replace('世界设定 -> ', 'World Setting -> ')
        .replace('规则模块 -> ', 'Rule Module -> ')
        .replace('NPC规范 -> ', 'NPC Rules -> ')
        .replace('其他内容', 'Other Content')
        .replace(/（(\d+) 条匹配）/, '($1 matches)');
}

// ── Phase Name Mapping ───────────────────────
const PHASE_NAMES = {
    'react': 'ReAct 流水线',
    'gm_decision': _debugText('gm'),
    'npc_reaction': _debugText('npc'),
    'npc_card_sync': _debugText('npcCardSync'),
    'npc_intro_audit': _debugText('npcIntroAudit'),
    'ooc': _debugText('ooc'),
};

/**
 * 动态解析 step 的阶段显示名（支持 skill:* 格式）
 */
function resolveStepPhaseName(step, fallbackIndex) {
    if (step.phase && step.phase.startsWith('skill:')) {
        const skillName = step.phase.slice(6);
        return `${_debugText('skillLabel')}: ${skillName}`;
    }
    return PHASE_NAMES[step.phase] || step.stageName || `Step ${fallbackIndex + 1}`;
}

// ══════════════════════════════════════════════
// Part Type Identification (preserved)
// ══════════════════════════════════════════════

function identifyPartType(text) {
    if (!text) return { type: 'unknown', source: 'Empty', sourceClass: 'segment-other' };

    const rules = [
        { pattern: /^## 之前剧情的总结/, type: 'summary', source: '之前剧情的总结', sourceClass: 'segment-summary' },
        { pattern: /^## 最近的主线剧情/, type: 'recent_mainline', source: '最近的主线剧情', sourceClass: 'segment-mainline' },
        { pattern: /^## 当前角色档案/, type: 'npc_archive', source: '当前角色档案(权威数据源)', sourceClass: 'segment-npc-archive' },
        { pattern: /^## 对话历史/, type: 'conversation_history', source: '对话历史(Step2 Contents)', sourceClass: 'segment-conversation' },
        { pattern: /^## 本轮叙事/, type: 'current_narrative', source: '本轮叙事(Step2 Output)', sourceClass: 'segment-narrative' },
        { pattern: /^## 已检索的参考资料/, type: 'references_header', source: '已检索的参考资料', sourceClass: 'segment-reference' },
        { pattern: /^### \[get_world_entity\]/, type: 'get_country', source: 'get_world_entity', sourceClass: 'segment-country' },
        { pattern: /^### \[get_rule\]/, type: 'get_module', source: 'get_rule', sourceClass: 'segment-module' },
        { pattern: /^### \[get_character_database\]/, type: 'get_character_database', source: 'get_character_database', sourceClass: 'segment-npc-archive' },
        { pattern: /^### \[get_country_[ABXC]\]/, type: 'get_country', source: 'get_country', sourceClass: 'segment-country' },
        { pattern: /^### \[get_soul_rules\]/, type: 'get_module', source: 'get_soul_rules', sourceClass: 'segment-module' },
        { pattern: /^### \[get_economy_rules\]/, type: 'get_module', source: 'get_economy_rules', sourceClass: 'segment-module' },
        { pattern: /^### \[get_job_board\]/, type: 'get_module', source: 'get_job_board', sourceClass: 'segment-module' },
        { pattern: /^### \[get_time_protocol\]/, type: 'get_module', source: 'get_time_protocol', sourceClass: 'segment-module' },
        { pattern: /^### \[get_narrative_rules\]/, type: 'get_module', source: 'get_narrative_rules', sourceClass: 'segment-module' },
        { pattern: /^### \[get_timeline/, type: 'get_timeline', source: 'get_timeline', sourceClass: 'segment-timeline' },
        { pattern: /^### \[search_world\]/, type: 'search_world', source: 'search_world', sourceClass: 'segment-timeline' },
        { pattern: /^## 上一轮游戏状态/, type: 'last_game_state', source: '上一轮游戏状态', sourceClass: 'segment-game-state' },
        { pattern: /^## 短信记录/, type: 'sms_injection', source: '短信记录(新消息)', sourceClass: 'segment-sms' },
        { pattern: /^## 当前游戏时间/, type: 'game_time', source: '当前游戏时间', sourceClass: 'segment-timeline' },
        { pattern: /^## 今日发生的事件/, type: 'today_events', source: '今日发生的事件', sourceClass: 'segment-game-state' },
        { pattern: /^## 最近的剧情原文/, type: 'recent_story_raw', source: '最近的剧情原文', sourceClass: 'segment-mainline' },
        { pattern: /^## 最近的剧情总结/, type: 'recent_story_summary', source: '最近的剧情总结', sourceClass: 'segment-summary' },
        { pattern: /^## 与玩家的短信记录/, type: 'sms_history', source: '与玩家的短信记录', sourceClass: 'segment-sms' },
        { pattern: /^## 消息间隔/, type: 'message_interval', source: '消息间隔', sourceClass: 'segment-timeline' },
        { pattern: /^## 当前角色[^档]/, type: 'current_character', source: '当前角色', sourceClass: 'segment-npc-archive' },
        { pattern: /^## 开场引导规则/, type: 'init_module', source: '开场引导规则', sourceClass: 'segment-module' },
        { pattern: /^## Step2 生成的选项/, type: 'step2_choices', source: 'Step2 选项（待解析）', sourceClass: 'segment-step2-choices' },
        { pattern: /^## 预定义角色档案/, type: 'predefined_characters', source: '预定义角色档案', sourceClass: 'segment-predefined-chars' },
        { pattern: /^## NPC 生成规范/, type: 'npc_gen', source: 'NPC 生成规范', sourceClass: 'segment-module' },
        { pattern: /^## 额外指令/, type: 'custom_prompt', source: '额外指令(用户自定义)', sourceClass: 'segment-custom' },
        { pattern: /^## GM 写作指导/, type: 'gm_directive', source: 'GM 写作指导', sourceClass: 'segment-gm' },
        { pattern: /^# GM 决策层/, type: 'gm_core_prompt', source: 'GM 决策层核心指令', sourceClass: 'segment-gm' },
        { pattern: /^# 静态数据（世界设定）/, type: 'gm_static_data', source: 'GM 静态数据(世界设定)', sourceClass: 'segment-gm-static' },
        { pattern: /^## 世界历史时间线/, type: 'gm_timeline', source: 'GM 时间线', sourceClass: 'segment-gm-static' },
        { pattern: /^## (四国设定|世界设定实体)/, type: 'gm_world_setting', source: 'GM 世界设定', sourceClass: 'segment-gm-static' },
        { pattern: /^## 角色数据库/, type: 'gm_characters', source: 'GM 角色数据库', sourceClass: 'segment-gm-static' },
        { pattern: /^## 地图数据/, type: 'gm_maps', source: 'GM 地图数据', sourceClass: 'segment-gm-static' },
        { pattern: /^# 动态数据（本局游戏）/, type: 'gm_dynamic_data', source: 'GM 动态数据(本局游戏)', sourceClass: 'segment-gm-dynamic' },
        { pattern: /^## 节奏统计/, type: 'gm_pacing_stats', source: 'GM 节奏统计', sourceClass: 'segment-gm-dynamic' },
        { pattern: /^# 调查员 - 上下文构建阶段/, type: 'core_prompt_react', source: 'ReAct: 调查员', sourceClass: 'segment-react' },
        { pattern: /^# 讲述者 - 纯创作阶段/, type: 'core_prompt_step2', source: 'Step2: 讲述者', sourceClass: 'segment-core' },
        { pattern: /^# 分析师 - 结构化提取阶段/, type: 'core_prompt_step3', source: 'Step3: 分析师', sourceClass: 'segment-step3' },
    ];

    for (const rule of rules) {
        if (rule.pattern.test(text)) {
            let source = rule.source;
            if (rule.type === 'get_country') {
                const titleMatch = text.match(/### \[(?:get_country_[ABXC]?\w*|get_world_entity)\]\s*\n([^\n]+)/);
                if (titleMatch) source = `世界设定 -> ${titleMatch[1].trim()}`;
            } else if (rule.type === 'get_module') {
                const funcMatch = text.match(/### \[get_(\w+)\]/);
                const titleMatch = text.match(/\n# ([^\n]+)/);
                if (funcMatch && titleMatch) source = `${funcMatch[1]} -> ${titleMatch[1].trim()}`;
                else if (titleMatch) source = `规则模块 -> ${titleMatch[1].trim()}`;
            } else if (rule.type === 'search_world') {
                const countMatch = text.match(/\(共 (\d+) 条匹配\)/);
                if (countMatch) source = `search_world (${countMatch[1]} 条匹配)`;
            } else if (rule.type === 'npc_gen') {
                const titleMatch = text.match(/# ([^\n(]+)/);
                if (titleMatch) source = `NPC规范 -> ${titleMatch[1].trim()}`;
            }
            return { type: rule.type, source: _translateDebugSource(source), sourceClass: rule.sourceClass };
        }
    }
    return { type: 'unknown', source: _translateDebugSource('其他内容'), sourceClass: 'segment-other' };
}

function segmentLongText(text) {
    const markerDefinitions = [
        { pattern: /## 之前剧情的总结/g, type: 'summary' },
        { pattern: /## 最近的主线剧情/g, type: 'recent_mainline' },
        { pattern: /## 当前角色档案[^\n]*/g, type: 'npc_archive' },
        { pattern: /## 对话历史/g, type: 'conversation_history' },
        { pattern: /## 本轮叙事/g, type: 'current_narrative' },
        { pattern: /## 已检索的参考资料/g, type: 'references_header' },
        { pattern: /### \[get_world_entity\]/g, type: 'get_country' },
        { pattern: /### \[get_rule\]/g, type: 'get_module' },
        { pattern: /### \[get_character_database\]/g, type: 'get_character_database' },
        { pattern: /### \[get_country_[ABXC]\]/g, type: 'get_country' },
        { pattern: /### \[get_soul_rules\]/g, type: 'get_module' },
        { pattern: /### \[get_economy_rules\]/g, type: 'get_module' },
        { pattern: /### \[get_job_board\]/g, type: 'get_module' },
        { pattern: /### \[get_time_protocol\]/g, type: 'get_module' },
        { pattern: /### \[get_narrative_rules\]/g, type: 'get_module' },
        { pattern: /### \[get_timeline[^\]]*\]/g, type: 'get_timeline' },
        { pattern: /### \[search_world\]/g, type: 'search_world' },
        { pattern: /## 上一轮游戏状态/g, type: 'last_game_state' },
        { pattern: /## 短信记录/g, type: 'sms_injection' },
        { pattern: /## 当前游戏时间/g, type: 'game_time' },
        { pattern: /## 今日发生的事件/g, type: 'today_events' },
        { pattern: /## 最近的剧情原文/g, type: 'recent_story_raw' },
        { pattern: /## 最近的剧情总结/g, type: 'recent_story_summary' },
        { pattern: /## 与玩家的短信记录/g, type: 'sms_history' },
        { pattern: /## 消息间隔/g, type: 'message_interval' },
        { pattern: /## 当前角色[^档]/g, type: 'current_character' },
        { pattern: /## 开场引导规则/g, type: 'init_module' },
        { pattern: /## Step2 生成的选项/g, type: 'step2_choices' },
        { pattern: /## 预定义角色档案/g, type: 'predefined_characters' },
        { pattern: /## NPC 生成规范/g, type: 'npc_gen' },
        { pattern: /## 额外指令/g, type: 'custom_prompt' },
        { pattern: /# 调查员 - 上下文构建阶段/g, type: 'core_prompt_step1' },
        { pattern: /# 讲述者 - 纯创作阶段/g, type: 'core_prompt_step2' },
        { pattern: /# 分析师 - 结构化提取阶段/g, type: 'core_prompt_step3' },
        { pattern: /# 静态数据（世界设定）/g, type: 'gm_static_header' },
        { pattern: /## 世界历史时间线/g, type: 'gm_timeline' },
        { pattern: /## (四国设定|世界设定实体)/g, type: 'gm_world_setting_header' },
        { pattern: /### A国/g, type: 'gm_country_a' },
        { pattern: /### B国/g, type: 'gm_country_b' },
        { pattern: /### X国/g, type: 'gm_country_x' },
        { pattern: /### C国/g, type: 'gm_country_c' },
        { pattern: /## 角色数据库/g, type: 'gm_characters' },
        { pattern: /## 地图数据/g, type: 'gm_maps' },
        { pattern: /# 动态数据（本局游戏）/g, type: 'gm_dynamic_header' },
        { pattern: /## GM 对话历史/g, type: 'gm_chat_history' },
        { pattern: /## GM 短信记录/g, type: 'gm_sms' },
        { pattern: /## NPC 当前状态/g, type: 'gm_npc_states' },
        { pattern: /## 玩家状态/g, type: 'gm_player_state' },
        { pattern: /## 地图状态/g, type: 'gm_map_state' },
        { pattern: /## 节奏统计/g, type: 'gm_pacing_stats' },
    ];

    const allMatches = [];
    for (const def of markerDefinitions) {
        def.pattern.lastIndex = 0;
        let match;
        while ((match = def.pattern.exec(text)) !== null) {
            allMatches.push({ index: match.index, type: def.type, fullMatch: match[0] });
        }
    }
    if (allMatches.length === 0) return null;
    allMatches.sort((a, b) => a.index - b.index);

    const segments = [];
    for (let i = 0; i < allMatches.length; i++) {
        const startIndex = allMatches[i].index;
        const endIndex = (i + 1 < allMatches.length) ? allMatches[i + 1].index : text.length;
        let sectionContent = text.substring(startIndex, endIndex).trim();
        sectionContent = sectionContent.replace(/\n---\s*$/, '').trim();
        segments.push({ type: allMatches[i].type, content: sectionContent });
    }
    return segments.length > 0 ? segments : null;
}

// ══════════════════════════════════════════════
// Data Layer — ReAct Grouping & Tool Results
// ══════════════════════════════════════════════

/**
 * Groups consecutive react steps into collapsible groups.
 * Returns: [{ type: 'react_group', steps: [{step, originalIndex}], toolNames: [] } | { type: 'single', step, originalIndex }]
 */
function groupStepsForSidebar(steps) {
    const groups = [];
    let currentReactGroup = null;
    let currentSettlementGroup = null;

    const flushReact = () => {
        if (currentReactGroup) { groups.push(currentReactGroup); currentReactGroup = null; }
    };
    const flushSettlement = () => {
        if (currentSettlementGroup) { groups.push(currentSettlementGroup); currentSettlementGroup = null; }
    };

    steps.forEach((step, index) => {
        const isReact = step.phase === 'react';
        const isSkill = step.phase && step.phase.startsWith('skill:');

        if (isReact) {
            flushSettlement();
            if (!currentReactGroup) {
                currentReactGroup = { type: 'react_group', steps: [], startIndex: index, toolNames: [] };
            }
            currentReactGroup.steps.push({ step, originalIndex: index });
            if (Array.isArray(step.executionResults)) {
                step.executionResults.forEach(r => {
                    if (r.name && !currentReactGroup.toolNames.includes(r.name)) {
                        currentReactGroup.toolNames.push(r.name);
                    }
                });
            }
        } else if (isSkill) {
            flushReact();
            if (!currentSettlementGroup) {
                currentSettlementGroup = { type: 'settlement_group', steps: [], startIndex: index, skillNames: [] };
            }
            currentSettlementGroup.steps.push({ step, originalIndex: index });
            const skillName = step.phase.slice(6);
            if (skillName && !currentSettlementGroup.skillNames.includes(skillName)) {
                currentSettlementGroup.skillNames.push(skillName);
            }
        } else {
            flushReact();
            flushSettlement();
            groups.push({ type: 'single', step, originalIndex: index });
        }
    });
    flushReact();
    flushSettlement();
    return groups;
}

/**
 * Cross-reference aiService.lastFunctionCalls to get full tool results.
 * Returns the matching calls array for a given iteration, or all calls flattened.
 */
function getToolResultsForIteration(iteration) {
    const fc = (typeof aiService !== 'undefined') ? aiService.lastFunctionCalls : null;
    if (!fc || !Array.isArray(fc)) return [];
    if (iteration != null) {
        const match = fc.find(f => f.iteration === iteration);
        return match?.calls || [];
    }
    // Return all calls flattened
    const all = [];
    fc.forEach(f => { if (f.calls) all.push(...f.calls); });
    return all;
}

/**
 * Get all tool calls with full results for a react group (all iterations combined).
 */
function getToolResultsForReactGroup(group) {
    const results = [];
    group.steps.forEach(({ step }) => {
        const iter = step.iteration;
        const calls = getToolResultsForIteration(iter);
        results.push({ iteration: iter, calls, step });
    });
    return results;
}

/**
 * Extract input/output summary from a step for Zone A display.
 */
function getStepIOSummary(step) {
    const summary = { systemChars: 0, userMessagePreview: '', outputPreview: '', toolCallCount: 0, outputType: 'unknown' };

    // Input: count system instruction chars, find user message
    const request = step?.request;
    if (request) {
        // Gemini format
        if (request.system_instruction?.parts) {
            summary.systemChars = request.system_instruction.parts.reduce((sum, p) => sum + (p.text?.length || 0), 0);
        }
        // OpenAI format
        if (Array.isArray(request.messages)) {
            const sysMsg = request.messages.find(m => m.role === 'system');
            if (sysMsg) summary.systemChars = (typeof sysMsg.content === 'string') ? sysMsg.content.length : 0;
            const userMsgs = request.messages.filter(m => m.role === 'user');
            const lastUser = userMsgs[userMsgs.length - 1];
            if (lastUser) {
                const text = typeof lastUser.content === 'string' ? lastUser.content : JSON.stringify(lastUser.content);
                summary.userMessagePreview = text.substring(0, 80);
            }
        }
        // Gemini contents
        if (Array.isArray(request.contents)) {
            const userParts = request.contents.filter(c => c.role === 'user');
            const lastUser = userParts[userParts.length - 1];
            if (lastUser?.parts?.[0]?.text) {
                summary.userMessagePreview = lastUser.parts[0].text.substring(0, 80);
            }
        }
        // Anthropic format
        if (typeof request.system === 'string') {
            summary.systemChars = request.system.length;
        }
    }

    // Output
    const response = getStepResponse(step);
    const toolCalls = extractToolCalls(response);
    if (toolCalls.length > 0) {
        summary.toolCallCount = toolCalls.length;
        summary.outputType = 'tools';
        summary.outputPreview = toolCalls.map(tc => tc.name).join(', ');
    } else {
        const text = getStepOutputText(step, response);
        if (text) {
            summary.outputType = 'text';
            summary.outputPreview = text.substring(0, 120);
        }
    }

    return summary;
}

/**
 * Format tool call args as key:value display pairs.
 */
function formatToolArgs(args) {
    if (!args || typeof args !== 'object') return [];
    return Object.entries(args).map(([key, value]) => {
        const valStr = typeof value === 'string' ? value
            : typeof value === 'number' || typeof value === 'boolean' ? String(value)
            : JSON.stringify(value);
        return { key, value: valStr };
    });
}

// ══════════════════════════════════════════════
// Setup
// ══════════════════════════════════════════════

function setupDebugUI() {
    jsonViewerInstance = new JsonViewer({
        theme: 'dark',
        indentSize: 20,
        initialDepth: 1,
        customRenderers: [
            {
                test: (key, value) => key === 'systemPartsDebug' && Array.isArray(value),
                render: (key, value) => renderSystemPartsDebugViewer(key, value)
            },
            {
                test: (key, value) => key === 'parts' && Array.isArray(value) && value.length > 0 && value[0].text,
                render: (key, value) => renderSystemInstructionPartsViewer(key, value)
            },
            {
                test: (key, value) => key === 'steps' && Array.isArray(value) && _stepsRendererEnabled,
                render: (key, value) => renderStepsArrayCompact(key, value)
            },
            {
                test: (key, value) => key === 'metrics' && typeof value === 'object' && value !== null && ('inputTokens' in value || 'totalTime' in value),
                render: (key, value) => renderMetricsCard(key, value)
            },
            {
                test: (key, value) => key === 'promptManifest' && Array.isArray(value),
                render: (key, value) => renderPromptManifest(key, value)
            },
            {
                test: (key, value) => key === 'executionResults' && Array.isArray(value) && value.length > 0,
                render: (key, value) => renderExecutionResults(key, value)
            }
        ]
    });

    // Header controls
    const selector = document.getElementById('debug-payload-selector');
    if (selector) {
        selector.addEventListener('change', (e) => {
            currentDebugTab = e.target.value;
            currentSelectionMode = 'overview';
            currentSelectedStepIndex = null;
            currentReactGroupIndex = null;
            currentSettlementGroupIndex = null;
            _cachedSidebarGroups = null;
            refreshDebugContent();
        });
    }

    document.getElementById('debug-btn').addEventListener('click', () => openDebugModal('api'));
    document.getElementById('close-debug-btn').addEventListener('click', closeDebugModal);
    document.getElementById('copy-debug-btn').addEventListener('click', copyDebugPayload);
    document.getElementById('export-debug-btn').addEventListener('click', exportDebugPayload);

    // Quick entry points from other UI
    const summaryDebugBtn = document.getElementById('summary-debug-btn');
    if (summaryDebugBtn) summaryDebugBtn.addEventListener('click', () => openDebugModal('summary'));
    const smsDebugBtn = document.getElementById('sms-debug-btn');
    if (smsDebugBtn) smsDebugBtn.addEventListener('click', () => openDebugModal('sms'));

    // Auto-refresh via EventBus
    if (window.eventBus && window.GameEvents) {
        const refreshIfVisible = () => {
            const modal = document.getElementById('debug-modal');
            if (modal && !modal.classList.contains('hidden')) {
                console.log('[DebugUI] Auto-refreshing content...');
                refreshDebugContent();
            }
        };
        window.eventBus.on(window.GameEvents.AI_REACT_COMPLETE, refreshIfVisible);
        window.eventBus.on(window.GameEvents.AI_NARRATIVE_COMPLETE, refreshIfVisible);
        window.eventBus.on(window.GameEvents.AI_STEP3_COMPLETE, refreshIfVisible);
        window.eventBus.on(window.GameEvents.AI_NPC_REACTIONS_COMPLETE, refreshIfVisible);
        window.eventBus.on(window.GameEvents.AI_ERROR, refreshIfVisible);
        window.eventBus.on(window.GameEvents.SETTLEMENT_SKILL_COMPLETE, refreshIfVisible);
        window.eventBus.on(window.GameEvents.SETTLEMENT_DISPATCH_COMPLETE, refreshIfVisible);
    }
}

// ══════════════════════════════════════════════
// Open / Close / Copy
// ══════════════════════════════════════════════

function openDebugModal(tab = 'api') {
    currentDebugTab = tab;
    currentSelectionMode = 'overview';
    currentSelectedStepIndex = null;
    currentReactGroupIndex = null;
    currentSettlementGroupIndex = null;
    _cachedSidebarGroups = null;
    const selector = document.getElementById('debug-payload-selector');
    if (selector) selector.value = tab;
    refreshDebugContent();
    document.getElementById('debug-modal').classList.remove('hidden');
}

function closeDebugModal() {
    document.getElementById('debug-modal').classList.add('hidden');
}

function _traceProcessToolResult(result, isErrorContext) {
    if (isErrorContext) return result;
    if (result == null) return result;
    if (typeof result !== 'string') return result;
    if (/^\[(未找到|错误)\]/.test(result)) return result;
    if (result.length <= 100) return result;
    return { preview: result.slice(0, 100), length: result.length, truncated: true };
}

function _traceProcessToolCall(name, args, executionResult, isErrorContext) {
    const out = { name };
    if (!isErrorContext && name === 'update_narrative') {
        const text = (args && typeof args.text === 'string') ? args.text : '';
        out.argsStat = {
            textLength: text.length,
            textPreview: text.slice(0, 30) + (text.length > 30 ? '...' : ''),
        };
    } else {
        out.args = args;
    }
    out.result = _traceProcessToolResult(executionResult?.result, isErrorContext);
    return out;
}

function buildTraceDebugPayload(full) {
    if (!full) return full;
    const isErrorRun = !!full.failedPhase || !!full.errorInfo;

    const firstReact = (full.steps || []).find(s => s?.phase === 'react');
    const toolNames = (firstReact?.request?.tools || [])
        .map(t => t?.function?.name)
        .filter(Boolean);
    const systemPartsDebug = firstReact?.systemPartsDebug;

    let userInput = '';
    const reactMessages = firstReact?.request?.messages || [];
    for (let i = reactMessages.length - 1; i >= 0; i--) {
        if (reactMessages[i]?.role === 'user') {
            userInput = reactMessages[i].content || '';
            break;
        }
    }

    const traceSteps = (full.steps || []).map(step => {
        if (step?.phase === 'gm_decision') {
            const dir = step.response?.result?.directive || {};
            const loc = step.request?.currentLocation;
            const locStr = (loc && typeof loc === 'object')
                ? `${loc.country || ''}${loc.site ? ' - ' + loc.site : ''}`.trim()
                : undefined;
            const durationMs = (step.endedAt && step.startedAt)
                ? new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime()
                : undefined;
            return {
                step: step.step,
                phase: 'gm_decision',
                durationMs,
                result: {
                    action: dir.action,
                    eventId: dir.event_id,
                    location: locStr,
                    characters: step.request?.openingEvent?.event?.characters,
                    timestamp: dir.date,
                },
            };
        }

        const stepIsError = isErrorRun
            || step.failed === true
            || (step.executionResults || []).some(r =>
                r?.result && typeof r.result === 'object' && 'error' in r.result
            );

        const choice0 = step.response?.choices?.[0]?.message;
        const toolCalls = choice0?.tool_calls || [];
        let calls = toolCalls.map((tc, idx) => {
            let parsedArgs = {};
            try {
                const raw = tc.function?.arguments;
                parsedArgs = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
            } catch {
                parsedArgs = { _rawArguments: tc.function?.arguments };
            }
            return _traceProcessToolCall(
                tc.function?.name,
                parsedArgs,
                step.executionResults?.[idx],
                stepIsError
            );
        });
        if (!calls.length && Array.isArray(step.executionResults)) {
            calls = step.executionResults.map(r =>
                _traceProcessToolCall(r.name, r.args, r, stepIsError)
            );
        }

        const usage = step.response?.usage || {};
        return {
            step: step.step,
            phase: step.phase,
            iter: step.iteration,
            model: step.model,
            durationMs: step.metrics?.totalTime,
            tokens: {
                in: usage.prompt_tokens,
                out: usage.completion_tokens,
                cached: usage.prompt_tokens_details?.cached_tokens,
            },
            reasoning: choice0?.content || undefined,
            calls,
        };
    });

    const sd = full.settlementDispatch;
    const settlementDispatch = sd ? {
        status: sd.status,
        completedTools: sd.completedTools,
        failedSkills: sd.failedSkills,
        duration: sd.duration,
    } : sd;

    return {
        traceId: full.traceId,
        failedPhase: full.failedPhase,
        errorInfo: full.errorInfo,
        models: full.models,
        userInput,
        openingTimeContext: full.openingTimeContext,
        toolNames,
        systemPartsDebug,
        steps: traceSteps,
        settlementDispatch,
    };
}
window.buildTraceDebugPayload = buildTraceDebugPayload;

function copyDebugPayload() {
    if (!currentDebugPayload) return;
    const trace = buildTraceDebugPayload(currentDebugPayload);
    const textToCopy = JSON.stringify(trace, null, 2);
    const btn = document.getElementById('copy-debug-btn');
    const originalHTML = btn.innerHTML;

    const showResult = (msg) => {
        btn.innerHTML = msg;
        setTimeout(() => btn.innerHTML = originalHTML, 1500);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(textToCopy)
            .then(() => showResult(`<span class="material-symbols-outlined">content_copy</span> ${_debugText('copied')}`))
            .catch((err) => { console.error('[Debug] Copy failed:', err); showResult(`<span class="material-symbols-outlined">content_copy</span> ${_debugText('copyFailed')}`); });
    } else {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try { document.execCommand('copy'); showResult(`<span class="material-symbols-outlined">content_copy</span> ${_debugText('copied')}`); }
        catch (err) { console.error('[Debug] Copy failed:', err); showResult(`<span class="material-symbols-outlined">content_copy</span> ${_debugText('copyFailed')}`); }
        document.body.removeChild(textArea);
    }
}

function exportDebugPayload() {
    if (!currentDebugPayload) return;
    const btn = document.getElementById('export-debug-btn');
    const originalHTML = btn.innerHTML;
    const showResult = (msg) => {
        btn.innerHTML = msg;
        setTimeout(() => btn.innerHTML = originalHTML, 1500);
    };
    try {
        const jsonText = JSON.stringify(currentDebugPayload, null, 2);
        const markdown = '```json\n' + jsonText + '\n```\n';

        const rawName = window.worldCardManager?.getActiveCard?.()?.name || 'Unknown';
        const safeName = rawName.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
        const turnCount = Array.isArray(window.chatHistory)
            ? window.chatHistory.filter(m => m && m.sender === 'ai'
                && !(typeof m.uid === 'string' && m.uid.startsWith('turn_0_'))).length
            : 0;
        const filename = `debug-${safeName}-turn${turnCount}.md`;

        const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showResult(`<span class="material-symbols-outlined">download</span> ${_debugText('exported')}`);
    } catch (err) {
        console.error('[Debug] Export failed:', err);
        showResult(`<span class="material-symbols-outlined">download</span> ${_debugText('exportFailed')}`);
    }
}

// ══════════════════════════════════════════════
// Core Refresh Logic
// ══════════════════════════════════════════════

function hasSteps(payload) {
    return payload && Array.isArray(payload.steps) && payload.steps.length > 0;
}

function getPayloadForTab(tab = currentDebugTab) {
    if (typeof aiService === 'undefined') return { payload: null, emptyMessage: 'Error: aiService not initialized' };

    let payload, emptyMessage;
    if (tab === 'gm') {
        payload = aiService.lastGMPayload;
        emptyMessage = _debugIsEnglish() ? 'No GM requests yet. Send a message first.' : '暂无 GM 请求记录。发送一条消息后再查看。';
    } else if (tab === 'summary') {
        payload = aiService.lastSummaryPayload;
        emptyMessage = _debugIsEnglish() ? 'No summary requests yet. Summaries appear after AI replies.' : '暂无总结请求记录。AI 回复后会自动生成总结。';
    } else if (tab === 'sms') {
        payload = aiService.lastSMSPayload;
        emptyMessage = _debugIsEnglish() ? 'No SMS requests yet. Send a text first.' : '暂无短信请求记录。发送一条短信后再查看。';
    } else if (tab === 'npc') {
        const NPC_TAB_PHASES = new Set(['npc_reaction', 'npc_card_sync', 'npc_intro_audit']);
        const npcSteps = (aiService.lastPayload?.steps || []).filter(s => NPC_TAB_PHASES.has(s.phase));
        const reactions = aiService.lastNpcReactions;
        if (npcSteps.length > 0 || (reactions && reactions.length > 0)) {
            payload = { reactions: reactions || [], steps: npcSteps };
        } else {
            payload = null;
        }
        emptyMessage = _debugIsEnglish() ? 'No NPC reactions yet. Enable NPC Reaction and send a message first.' : '暂无 NPC 反应记录。启用 NPC Reaction 并发送一条消息后再查看。';
    } else if (tab === 'design') {
        payload = aiService.lastDesignPayload;
        emptyMessage = _debugIsEnglish() ? 'No design-mode requests yet. Send a design-mode message first.' : '暂无设计模式请求记录。在设计模式下发送一条消息后再查看。';
    } else {
        payload = aiService.lastPayload;
        emptyMessage = _debugIsEnglish() ? 'No API requests yet. Send a message first.' : '暂无 API 请求记录。发送一条消息后再查看。';
    }
    return { payload, emptyMessage };
}

function getDebugPayloadSnapshot(tab = currentDebugTab) {
    const { payload } = getPayloadForTab(tab);
    if (!payload) return '';
    try {
        return JSON.stringify(payload, null, 2);
    } catch (error) {
        console.error('[DebugUI] Failed to stringify debug payload:', error);
        return '';
    }
}

function refreshDebugContent() {
    try {
        const sidebar = document.getElementById('debug-sidebar');
        const detail = document.getElementById('debug-detail');
        if (!sidebar || !detail) return;

        // Prompt Inspector tab — 单独 dispatcher（不使用 lastPayload，从 promptRegistry 取数据）
        if (currentDebugTab === 'prompts') {
            if (window.debugPromptInspector && typeof window.debugPromptInspector.render === 'function') {
                window.debugPromptInspector.render(sidebar, detail);
            } else {
                sidebar.classList.add('hidden');
                detail.innerHTML = '<div class="debug-empty-state">Prompt Inspector 未加载</div>';
            }
            return;
        }

        const { payload, emptyMessage } = getPayloadForTab();
        currentDebugPayload = payload;

        if (!payload) {
            sidebar.classList.add('hidden');
            sidebar.innerHTML = '';
            detail.innerHTML = '';
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'debug-empty-state';
            emptyDiv.textContent = emptyMessage;
            detail.appendChild(emptyDiv);
            return;
        }

        // Only API tab gets the enhanced sidebar/detail treatment
        const isApiTab = currentDebugTab === 'api';

        if (hasSteps(payload) && isApiTab) {
            sidebar.classList.remove('hidden');
            _cachedSidebarGroups = groupStepsForSidebar(payload.steps);
            renderSidebar(sidebar, payload);

            // Validate selection
            if (currentSelectionMode === 'step' && (currentSelectedStepIndex === null || currentSelectedStepIndex >= payload.steps.length)) {
                currentSelectionMode = 'overview';
                currentSelectedStepIndex = null;
            }
            if (currentSelectionMode === 'react-group' && currentReactGroupIndex !== null) {
                const reactGroups = _cachedSidebarGroups.filter(g => g.type === 'react_group');
                if (currentReactGroupIndex < 0 || currentReactGroupIndex >= reactGroups.length) {
                    currentSelectionMode = 'overview';
                    currentReactGroupIndex = null;
                }
            }
            if (currentSelectionMode === 'settlement-group' && currentSettlementGroupIndex !== null) {
                const settlementGroups = _cachedSidebarGroups.filter(g => g.type === 'settlement_group');
                if (currentSettlementGroupIndex < 0 || currentSettlementGroupIndex >= settlementGroups.length) {
                    currentSelectionMode = 'overview';
                    currentSettlementGroupIndex = null;
                }
            }

            if (currentSelectionMode === 'overview') {
                renderPipelineOverview(detail, payload);
            } else if (currentSelectionMode === 'react-group') {
                const reactGroups = _cachedSidebarGroups.filter(g => g.type === 'react_group');
                const group = reactGroups[currentReactGroupIndex];
                if (group) {
                    renderReactGroupDetail(detail, group);
                } else {
                    renderPipelineOverview(detail, payload);
                }
            } else if (currentSelectionMode === 'settlement-group') {
                const settlementGroups = _cachedSidebarGroups.filter(g => g.type === 'settlement_group');
                const group = settlementGroups[currentSettlementGroupIndex];
                if (group) {
                    renderSettlementGroupDetail(detail, group, payload);
                } else {
                    renderPipelineOverview(detail, payload);
                }
            } else {
                renderStepDetail(detail, payload.steps[currentSelectedStepIndex], currentSelectedStepIndex);
            }
        } else if (hasSteps(payload)) {
            // Non-API tabs with steps (NPC) — use old two-column layout
            sidebar.classList.remove('hidden');
            renderSidebarLegacy(sidebar, payload);
            if (currentSelectedStepIndex === null) {
                renderOverviewLegacy(detail, payload);
            } else if (currentSelectedStepIndex < payload.steps.length) {
                renderStepDetail(detail, payload.steps[currentSelectedStepIndex], currentSelectedStepIndex);
            } else {
                currentSelectedStepIndex = null;
                renderOverviewLegacy(detail, payload);
            }
        } else {
            sidebar.classList.add('hidden');
            sidebar.innerHTML = '';
            renderSinglePayload(detail, payload);
        }
    } catch (e) {
        console.error('[DebugUI] refreshDebugContent critical error:', e);
        const detail = document.getElementById('debug-detail');
        if (detail) detail.textContent = _debugText('critical') + e.message;
    }
}

// ══════════════════════════════════════════════
// Sidebar Rendering
// ══════════════════════════════════════════════

/**
 * Legacy sidebar for non-API tabs that have steps (NPC tab).
 */
function renderSidebarLegacy(container, payload) {
    container.innerHTML = '';
    const steps = payload.steps;
    const renderGeneration = ++_stepTokenRenderGeneration;

    let totalIn = 0, totalOut = 0, totalTime = 0;
    const models = [];
    steps.forEach(s => {
        const m = getStepMetrics(s) || {};
        const tokenState = getStepDisplayTokenState(s, m);
        totalIn += tokenState.inputTokens;
        totalOut += tokenState.outputTokens;
        totalTime += m.totalTime || 0;
        if (s.model && !models.includes(s.model)) models.push(s.model);
    });

    const statsDiv = document.createElement('div');
    statsDiv.className = 'sidebar-stats';
    const statItems = [
        `<span class="sidebar-stat"><span class="sidebar-stat-label">IN</span> <span class="sidebar-stat-value sidebar-stat-token">${formatNumber(totalIn)}</span></span>`,
        `<span class="sidebar-stat"><span class="sidebar-stat-label">OUT</span> <span class="sidebar-stat-value sidebar-stat-token">${formatNumber(totalOut)}</span></span>`,
        `<span class="sidebar-stat"><span class="sidebar-stat-label">Time</span> <span class="sidebar-stat-value sidebar-stat-time">${(totalTime / 1000).toFixed(1)}s</span></span>`,
    ];
    if (models.length > 0) {
        statItems.push(`<span class="sidebar-stat"><span class="sidebar-stat-value sidebar-stat-model">${models.map(m => escapeHtml(m)).join(', ')}</span></span>`);
    }
    statsDiv.innerHTML = statItems.join('');
    container.appendChild(statsDiv);

    const listDiv = document.createElement('div');
    listDiv.className = 'sidebar-step-list';

    const overviewItem = document.createElement('div');
    overviewItem.className = 'sidebar-step-item is-overview' + (currentSelectedStepIndex === null ? ' is-active' : '');
    overviewItem.innerHTML = `<div class="sidebar-step-phase">${_debugText('overview')}</div>`;
    overviewItem.addEventListener('click', () => {
        currentSelectedStepIndex = null;
        refreshDebugContent();
    });
    listDiv.appendChild(overviewItem);

    steps.forEach((step, index) => {
        const item = document.createElement('div');
        const isFailed = !!step.failed;
        const isActive = currentSelectedStepIndex === index;
        const metrics = getStepMetrics(step) || {};
        const tokenState = getStepDisplayTokenState(step, metrics);
        item.className = 'sidebar-step-item' + (isActive ? ' is-active' : '') + (isFailed ? ' is-failed' : '');

        const phaseName = resolveStepPhaseName(step, index);
        const runnerText = getStepRunnerBadgeText(step);
        const totalTimeSec = metrics.totalTime ? (metrics.totalTime / 1000).toFixed(1) + 's' : '';

        let metaHTML = '';
        if (runnerText) metaHTML += `<span class="sidebar-step-model">${escapeHtml(runnerText)}</span>`;
        if (totalTimeSec) metaHTML += `<span class="sidebar-step-time">${totalTimeSec}</span>`;
        metaHTML += `<span class="sidebar-step-tokens" data-render-generation="${renderGeneration}">${formatNumber(tokenState.inputTokens)}/${formatNumber(tokenState.outputTokens)}</span>`;
        if (isFailed) metaHTML += `<span class="sidebar-step-failed-badge">FAILED</span>`;

        item.innerHTML = `<div class="sidebar-step-phase">${phaseName}</div><div class="sidebar-step-meta">${metaHTML}</div>`;
        item.addEventListener('click', () => {
            currentSelectedStepIndex = index;
            refreshDebugContent();
        });

        const tokensNode = item.querySelector('.sidebar-step-tokens');
        if (tokensNode) {
            updateStepTokenBadge(tokensNode, tokenState.inputTokens, tokenState.outputTokens, tokenState.inputSource, tokenState.outputSource);
            if (tokenState.inputSource !== 'usage' || tokenState.outputSource !== 'usage') {
                scheduleOfficialStepEstimate(step, metrics, tokensNode, renderGeneration);
            }
        }
        listDiv.appendChild(item);
    });
    container.appendChild(listDiv);
}

/**
 * New sidebar with ReAct grouping (API tab only).
 */
function renderSidebar(container, payload) {
    container.innerHTML = '';
    const steps = payload.steps;
    const groups = _cachedSidebarGroups || groupStepsForSidebar(steps);
    const renderGeneration = ++_stepTokenRenderGeneration;

    // Aggregate stats
    let totalIn = 0, totalOut = 0, totalTime = 0;
    const models = [];
    steps.forEach(s => {
        const m = getStepMetrics(s) || {};
        const tokenState = getStepDisplayTokenState(s, m);
        totalIn += tokenState.inputTokens;
        totalOut += tokenState.outputTokens;
        totalTime += m.totalTime || 0;
        if (s.model && !models.includes(s.model)) models.push(s.model);
    });

    const statsDiv = document.createElement('div');
    statsDiv.className = 'sidebar-stats';
    const statItems = [
        `<span class="sidebar-stat"><span class="sidebar-stat-label">IN</span> <span class="sidebar-stat-value sidebar-stat-token">${formatNumber(totalIn)}</span></span>`,
        `<span class="sidebar-stat"><span class="sidebar-stat-label">OUT</span> <span class="sidebar-stat-value sidebar-stat-token">${formatNumber(totalOut)}</span></span>`,
        `<span class="sidebar-stat"><span class="sidebar-stat-label">Time</span> <span class="sidebar-stat-value sidebar-stat-time">${(totalTime / 1000).toFixed(1)}s</span></span>`,
    ];
    if (models.length > 0) {
        statItems.push(`<span class="sidebar-stat"><span class="sidebar-stat-value sidebar-stat-model">${models.map(m => escapeHtml(m)).join(', ')}</span></span>`);
    }
    statsDiv.innerHTML = statItems.join('');
    container.appendChild(statsDiv);

    const listDiv = document.createElement('div');
    listDiv.className = 'sidebar-step-list';

    // Overview item
    const overviewItem = document.createElement('div');
    overviewItem.className = 'sidebar-step-item is-overview' + (currentSelectionMode === 'overview' ? ' is-active' : '');
    overviewItem.innerHTML = `<div class="sidebar-step-phase">${_debugText('overview')}</div>`;
    overviewItem.addEventListener('click', () => {
        currentSelectionMode = 'overview';
        currentSelectedStepIndex = null;
        currentReactGroupIndex = null;
        currentSettlementGroupIndex = null;
        refreshDebugContent();
    });
    listDiv.appendChild(overviewItem);

    // Track react group index for selection
    let reactGroupCounter = 0;
    let settlementGroupCounter = 0;

    groups.forEach(group => {
        if (group.type === 'react_group') {
            const groupIdx = reactGroupCounter++;
            const isGroupActive = currentSelectionMode === 'react-group' && currentReactGroupIndex === groupIdx;
            const iterCount = group.steps.length;
            const totalToolCount = group.steps.reduce((sum, { step }) =>
                sum + (Array.isArray(step.executionResults) ? step.executionResults.length : 0), 0);

            // Group time
            let groupTime = 0;
            group.steps.forEach(({ step }) => {
                const m = getStepMetrics(step) || {};
                groupTime += m.totalTime || 0;
            });

            // Group container
            const groupDiv = document.createElement('div');
            groupDiv.className = 'sidebar-react-group' + (isGroupActive ? ' is-active' : '');

            // Group header
            const header = document.createElement('div');
            header.className = 'sidebar-react-group-header' + (isGroupActive ? ' is-active' : '');
            const hasFailed = group.steps.some(({ step }) => step.failed);
            header.innerHTML = `
                <span class="sidebar-step-phase">${_debugText('reactLoop')}</span>
                <div class="sidebar-step-meta">
                    <span class="sidebar-step-time">${iterCount} iter, ${totalToolCount} tools</span>
                    <span class="sidebar-step-time">${(groupTime / 1000).toFixed(1)}s</span>
                    ${hasFailed ? '<span class="sidebar-step-failed-badge">FAILED</span>' : ''}
                </div>
            `;
            header.addEventListener('click', () => {
                currentSelectionMode = 'react-group';
                currentReactGroupIndex = groupIdx;
                currentSelectedStepIndex = null;
                currentSettlementGroupIndex = null;
                refreshDebugContent();
            });
            groupDiv.appendChild(header);

            // Iteration children
            group.steps.forEach(({ step, originalIndex }, iterIdx) => {
                const isIterActive = currentSelectionMode === 'step' && currentSelectedStepIndex === originalIndex;
                const iterItem = document.createElement('div');
                iterItem.className = 'sidebar-react-iteration' + (isIterActive ? ' is-active' : '') + (step.failed ? ' is-failed' : '');

                const iterNum = step.iteration || (iterIdx + 1);
                const toolNames = Array.isArray(step.executionResults)
                    ? step.executionResults.map(r => r.name).join(', ')
                    : '';
                const response = getStepResponse(step);
                const outputText = getStepOutputText(step, response);
                const hasText = outputText && outputText.length > 0;
                const respToolCalls = extractToolCalls(response);

                let label = '';
                if (toolNames) {
                    label = toolNames;
                } else if (respToolCalls.length > 0) {
                    label = respToolCalls.map(tc => tc.name).join(', ');
                } else if (hasText) {
                    label = `${_debugText('textOutput')} (${outputText.length})`;
                } else {
                    label = _debugText('emptyIteration');
                }

                iterItem.innerHTML = `
                    <span class="sidebar-iteration-num">#${iterNum}</span>
                    <span class="sidebar-iteration-tools">${escapeHtml(label)}</span>
                `;
                iterItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentSelectionMode = 'step';
                    currentSelectedStepIndex = originalIndex;
                    currentReactGroupIndex = null;
                    currentSettlementGroupIndex = null;
                    refreshDebugContent();
                });
                groupDiv.appendChild(iterItem);
            });

            listDiv.appendChild(groupDiv);
        } else if (group.type === 'settlement_group') {
            // Settlement dispatch group
            const groupIdx = settlementGroupCounter++;
            const isGroupActive = currentSelectionMode === 'settlement-group' && currentSettlementGroupIndex === groupIdx;
            const skillCount = group.skillNames.length;

            let groupTime = 0;
            group.steps.forEach(({ step }) => {
                const m = getStepMetrics(step) || {};
                groupTime += m.totalTime || 0;
            });

            const groupDiv = document.createElement('div');
            groupDiv.className = 'sidebar-settlement-group' + (isGroupActive ? ' is-active' : '');

            const header = document.createElement('div');
            header.className = 'sidebar-settlement-group-header' + (isGroupActive ? ' is-active' : '');
            const hasFailed = group.steps.some(({ step }) => step.failed);
            header.innerHTML = `
                <span class="sidebar-step-phase">${_debugText('settlementDispatch')}</span>
                <div class="sidebar-step-meta">
                    <span class="sidebar-step-time">${skillCount} ${_debugText('skillCount')}</span>
                    <span class="sidebar-step-time">${(groupTime / 1000).toFixed(1)}s</span>
                    ${hasFailed ? '<span class="sidebar-step-failed-badge">FAILED</span>' : ''}
                </div>
            `;
            header.addEventListener('click', () => {
                currentSelectionMode = 'settlement-group';
                currentSettlementGroupIndex = groupIdx;
                currentSelectedStepIndex = null;
                currentReactGroupIndex = null;
                refreshDebugContent();
            });
            groupDiv.appendChild(header);

            // Child items: one per skill step
            group.steps.forEach(({ step, originalIndex }) => {
                const isIterActive = currentSelectionMode === 'step' && currentSelectedStepIndex === originalIndex;
                const iterItem = document.createElement('div');
                iterItem.className = 'sidebar-react-iteration' + (isIterActive ? ' is-active' : '') + (step.failed ? ' is-failed' : '');

                const skillName = step.phase ? step.phase.slice(6) : '?';
                iterItem.innerHTML = `
                    <span class="sidebar-iteration-num">${_debugText('skillLabel')}</span>
                    <span class="sidebar-iteration-tools">${escapeHtml(skillName)}</span>
                `;
                iterItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    currentSelectionMode = 'step';
                    currentSelectedStepIndex = originalIndex;
                    currentSettlementGroupIndex = null;
                    currentReactGroupIndex = null;
                    refreshDebugContent();
                });
                groupDiv.appendChild(iterItem);
            });

            listDiv.appendChild(groupDiv);
        } else {
            // Single step item
            const { step, originalIndex } = group;
            const isActive = currentSelectionMode === 'step' && currentSelectedStepIndex === originalIndex;
            const isFailed = !!step.failed;
            const metrics = getStepMetrics(step) || {};
            const tokenState = getStepDisplayTokenState(step, metrics);
            const item = document.createElement('div');
            item.className = 'sidebar-step-item' + (isActive ? ' is-active' : '') + (isFailed ? ' is-failed' : '');

            const phaseName = resolveStepPhaseName(step, originalIndex);
            const runnerText = getStepRunnerBadgeText(step);
            const totalTimeSec = metrics.totalTime ? (metrics.totalTime / 1000).toFixed(1) + 's' : '';
            const warnings = getStepSystemPartsWarning(step);

            let metaHTML = '';
            if (runnerText) metaHTML += `<span class="sidebar-step-model">${escapeHtml(runnerText)}</span>`;
            if (totalTimeSec) metaHTML += `<span class="sidebar-step-time">${totalTimeSec}</span>`;
            metaHTML += `<span class="sidebar-step-tokens" data-render-generation="${renderGeneration}">${formatNumber(tokenState.inputTokens)}/${formatNumber(tokenState.outputTokens)}</span>`;
            if (isFailed) metaHTML += `<span class="sidebar-step-failed-badge">FAILED</span>`;
            if (warnings.coreWorldMechanicsMissing) {
                metaHTML += `<span class="sidebar-step-warning-badge">${escapeHtml(_debugText('warningCwm'))}</span>`;
            }

            item.innerHTML = `<div class="sidebar-step-phase">${phaseName}</div><div class="sidebar-step-meta">${metaHTML}</div>`;
            item.addEventListener('click', () => {
                currentSelectionMode = 'step';
                currentSelectedStepIndex = originalIndex;
                currentReactGroupIndex = null;
                currentSettlementGroupIndex = null;
                refreshDebugContent();
            });

            const tokensNode = item.querySelector('.sidebar-step-tokens');
            if (tokensNode) {
                updateStepTokenBadge(tokensNode, tokenState.inputTokens, tokenState.outputTokens, tokenState.inputSource, tokenState.outputSource);
                if (tokenState.inputSource !== 'usage' || tokenState.outputSource !== 'usage') {
                    scheduleOfficialStepEstimate(step, metrics, tokensNode, renderGeneration);
                }
            }
            listDiv.appendChild(item);
        }
    });

    container.appendChild(listDiv);
}

// ══════════════════════════════════════════════
// Legacy Overview (for non-API tabs with steps)
// ══════════════════════════════════════════════

function renderOverviewLegacy(container, payload) {
    container.innerHTML = '';
    const overview = document.createElement('div');
    overview.className = 'debug-overview';

    // Runtime status
    const runtimeStatus = getRuntimeWorldDebugStatus();
    if (runtimeStatus) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'debug-runtime-status';
        statusDiv.textContent = `${_debugText('runtimePrefix')}: active=${runtimeStatus.hasActiveSnapshot} | world=${runtimeStatus.worldCount} | rules=${runtimeStatus.moduleCount} | chars=${runtimeStatus.characterCount} | timeline=${runtimeStatus.timelineCount}`;
        overview.appendChild(statusDiv);
    }

    // Error banner for failed steps
    const failedSteps = payload.steps.filter(s => s.failed);
    if (failedSteps.length > 0) {
        renderDesignErrorBanner(overview, failedSteps);
    }

    // Stats cards
    const steps = payload.steps;
    let totalIn = 0, totalOut = 0, totalTime = 0;
    const ttfts = [];
    steps.forEach(s => {
        const m = getStepMetrics(s) || {};
        const tokenState = getStepDisplayTokenState(s, m);
        totalIn += tokenState.inputTokens;
        totalOut += tokenState.outputTokens;
        totalTime += m.totalTime || 0;
        if (m.ttft) ttfts.push(m.ttft);
    });

    const statsGrid = document.createElement('div');
    statsGrid.className = 'debug-overview-stats';
    const cards = [
        { label: 'Steps', value: steps.length, cls: 'is-count' },
        { label: 'Input Tokens', value: formatNumber(totalIn), cls: 'is-token' },
        { label: 'Output Tokens', value: formatNumber(totalOut), cls: 'is-token' },
        { label: 'Total Time', value: (totalTime / 1000).toFixed(1) + 's', cls: 'is-time' },
    ];
    if (ttfts.length > 0) {
        const avgTtft = ttfts.reduce((a, b) => a + b, 0) / ttfts.length;
        cards.push({ label: 'Avg TTFT', value: (avgTtft / 1000).toFixed(2) + 's', cls: 'is-time' });
    }
    const failedCount = failedSteps.length;
    if (failedCount > 0) {
        cards.push({ label: 'Failed', value: failedCount, cls: '' });
    }

    statsGrid.innerHTML = cards.map(c =>
        `<div class="overview-stat-card">
            <div class="overview-stat-label">${c.label}</div>
            <div class="overview-stat-value ${c.cls}">${c.value}</div>
        </div>`
    ).join('');
    overview.appendChild(statsGrid);

    // Raw JSON toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-ghost';
    toggleBtn.dataset.action = 'debug-raw-json-toggle';
    toggleBtn.textContent = _debugText('rawJsonShow');
    let rawJsonContainer = null;
    let rawJsonExpanded = false;

    toggleBtn.addEventListener('click', () => {
        if (!rawJsonExpanded) {
            rawJsonExpanded = true;
            toggleBtn.textContent = _debugText('rawJsonHide');
            if (!rawJsonContainer) {
                rawJsonContainer = document.createElement('div');
                rawJsonContainer.className = 'debug-raw-json-container json-viewer-container';
                _stepsRendererEnabled = false;
                try {
                    rawJsonContainer.appendChild(jsonViewerInstance.render(payload));
                } catch (err) {
                    console.error('[DebugUI] Raw JSON render error:', err);
                    rawJsonContainer.textContent = 'JSON 渲染失败: ' + err.message;
                }
                _stepsRendererEnabled = true;
                toggleBtn.after(rawJsonContainer);
            } else {
                rawJsonContainer.style.display = '';
            }
        } else {
            rawJsonExpanded = false;
            toggleBtn.textContent = _debugText('rawJsonShow');
            if (rawJsonContainer) rawJsonContainer.style.display = 'none';
        }
    });
    overview.appendChild(toggleBtn);

    container.appendChild(overview);
}

// ══════════════════════════════════════════════
// Step Detail Rendering
// ══════════════════════════════════════════════

function renderStepDetail(container, step, stepIndex) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-step-detail';

    // ═══ Zone A: Summary Bar ═══
    const phaseName = resolveStepPhaseName(step, stepIndex);
    const executionTitle = getStepExecutionTitle(step);

    const summaryBar = document.createElement('div');
    summaryBar.className = 'step-summary-bar';

    // Phase + Model + Status
    let headerHTML = `<span class="step-summary-phase">${phaseName}</span>`;
    if (executionTitle) headerHTML += `<span class="step-summary-model">${escapeHtml(executionTitle)}</span>`;
    if (step.phase === 'ooc' && (step.round === 1 || step.round === 2)) {
        headerHTML += `<span class="step-summary-model">${escapeHtml(_debugText('round'))} ${step.round}</span>`;
    }
    if (step.failed) headerHTML += `<span class="sidebar-step-failed-badge">FAILED</span>`;

    // Metrics pills inline
    const metrics = getStepMetrics(step);
    if (metrics) {
        const pills = [];
        if (metrics.inputTokens != null) pills.push(`<span class="metrics-pill metrics-pill-token"><span class="metrics-pill-label">IN</span>${formatNumber(metrics.inputTokens)}</span>`);
        if (metrics.outputTokens != null) pills.push(`<span class="metrics-pill metrics-pill-token"><span class="metrics-pill-label">OUT</span>${formatNumber(metrics.outputTokens)}</span>`);
        if (metrics.totalTime != null) pills.push(`<span class="metrics-pill metrics-pill-time"><span class="metrics-pill-label">Total</span>${(metrics.totalTime / 1000).toFixed(2)}s</span>`);
        if (metrics.ttft != null) pills.push(`<span class="metrics-pill metrics-pill-time"><span class="metrics-pill-label">TTFT</span>${(metrics.ttft / 1000).toFixed(2)}s</span>`);
        headerHTML += `<span class="step-summary-metrics">${pills.join('')}</span>`;
    }

    // I/O strip
    const ioSummary = getStepIOSummary(step);
    let ioHTML = '';
    if (ioSummary.systemChars > 0) {
        ioHTML += `<span class="step-summary-item"><span class="step-summary-label">${_debugText('systemChars')}</span><span class="step-summary-value">${formatNumber(ioSummary.systemChars)} chars</span></span>`;
    }
    if (ioSummary.userMessagePreview) {
        ioHTML += `<span class="step-summary-item"><span class="step-summary-label">${_debugText('userMessage')}</span><span class="step-summary-value" title="${escapeHtml(ioSummary.userMessagePreview)}">${escapeHtml(ioSummary.userMessagePreview.substring(0, 50))}${ioSummary.userMessagePreview.length > 50 ? '...' : ''}</span></span>`;
    }
    if (ioSummary.outputType === 'tools') {
        ioHTML += `<span class="step-summary-item"><span class="step-summary-label">${_debugText('toolsCalled')}</span><span class="step-summary-value">${ioSummary.toolCallCount} (${escapeHtml(ioSummary.outputPreview)})</span></span>`;
    } else if (ioSummary.outputPreview) {
        ioHTML += `<span class="step-summary-item"><span class="step-summary-label">${_debugText('textOutput')}</span><span class="step-summary-value" title="${escapeHtml(ioSummary.outputPreview)}">${escapeHtml(ioSummary.outputPreview.substring(0, 60))}${ioSummary.outputPreview.length > 60 ? '...' : ''}</span></span>`;
    }

    summaryBar.innerHTML = `<div class="step-summary-header">${headerHTML}</div>${ioHTML ? `<div class="step-summary-io">${ioHTML}</div>` : ''}`;
    wrapper.appendChild(summaryBar);

    // Error banner
    if (step.failed && step.errorInfo) {
        renderDesignErrorBanner(wrapper, [step]);
    }

    // ═══ Zone B: Structured Content ═══
    const zoneB = document.createElement('div');
    zoneB.className = 'step-detail-zone-b';

    const isReact = step.phase === 'react';
    const response = getStepResponse(step);

    if (isReact) {
        // Tool Call Timeline for this single iteration
        const iterCalls = getToolResultsForIteration(step.iteration);
        if (iterCalls.length > 0) {
            zoneB.appendChild(renderToolCallTimeline(iterCalls));
        }
        // Text output (AI internal reasoning)
        const outputText = getStepOutputText(step, response);
        if (outputText) {
            const textBlock = document.createElement('div');
            textBlock.className = 'step-detail-text-block';
            const textLabel = document.createElement('div');
            textLabel.className = 'step-detail-section-title';
            textLabel.textContent = _debugText('textOutput');
            textBlock.appendChild(textLabel);
            const pre = document.createElement('pre');
            pre.className = 'step-detail-text-output';
            pre.textContent = outputText;
            textBlock.appendChild(pre);
            zoneB.appendChild(textBlock);
        }
    } else {
        // Generic: show text output if available
        const responseForView = response || step.responseBody;
        const outputText = getStepOutputText(step, responseForView);
        if (outputText) {
            const pre = document.createElement('pre');
            pre.className = 'step-detail-text-output';
            pre.textContent = outputText;
            zoneB.appendChild(pre);
        }
    }

    // SystemPartsDebug + PromptManifest (below structured content)
    if (Array.isArray(step.systemPartsDebug) && step.systemPartsDebug.length > 0) {
        zoneB.appendChild(renderSystemPartsDebugViewer('systemPartsDebug', step.systemPartsDebug));
    }
    if (Array.isArray(step.promptManifest) && step.promptManifest.length > 0) {
        zoneB.appendChild(renderPromptManifest('promptManifest', step.promptManifest));
    }

    wrapper.appendChild(zoneB);

    // ═══ Zone C: Raw Data (collapsed by default) ═══
    const zoneC = document.createElement('details');
    zoneC.className = 'step-detail-zone-c';

    const zoneCLabel = document.createElement('summary');
    zoneCLabel.className = 'step-detail-section-title zone-c-label';
    zoneCLabel.textContent = _debugText('rawData');
    zoneC.appendChild(zoneCLabel);

    // Lazy-render Zone C contents on first expand
    let zoneCRendered = false;
    zoneC.addEventListener('toggle', () => {
        if (zoneC.open && !zoneCRendered) {
            zoneCRendered = true;
            if (step.request) {
                zoneC.appendChild(createCollapsibleSection(_debugText('request'), step.request, 'request'));
            }
            if (response || step.responseBody || step.responseText) {
                const responseForView = response || step.responseBody;
                const outputText = getStepOutputText(step, responseForView);
                const reasoningText = getStepReasoningText(step, responseForView);
                zoneC.appendChild(createResponseSection(responseForView, outputText, reasoningText, step.provider));
            }
            if (Array.isArray(step.executionResults) && step.executionResults.length > 0) {
                zoneC.appendChild(renderExecutionResults('executionResults', step.executionResults));
            }
        }
    });

    wrapper.appendChild(zoneC);
    container.appendChild(wrapper);
}

/**
 * Render a timeline of tool calls with args and results.
 */
function renderToolCallTimeline(calls) {
    const timeline = document.createElement('div');
    timeline.className = 'tool-call-timeline';

    calls.forEach(call => {
        const card = document.createElement('div');
        card.className = 'tool-call-card' + (call.status === 'duplicate' ? ' is-duplicate' : '');
        if (typeof call.result === 'string' && call.result.startsWith('Error')) {
            card.classList.add('is-error');
        }

        // Header: name + result length
        const header = document.createElement('div');
        header.className = 'tool-call-card-header';
        const resultLen = typeof call.result === 'string' ? call.result.length : 0;
        header.innerHTML = `
            <span class="tool-call-name">${escapeHtml(call.name || '?')}</span>
            ${call.status === 'duplicate' ? '<span class="tool-call-status-badge">duplicate</span>' : ''}
            <span class="tool-call-result-len">${resultLen > 0 ? formatNumber(resultLen) + ' chars' : ''}</span>
        `;

        // Args formatted as key:value
        const argsDiv = document.createElement('div');
        argsDiv.className = 'tool-call-args';
        const formattedArgs = formatToolArgs(call.args);
        if (formattedArgs.length > 0) {
            formattedArgs.forEach(({ key, value }) => {
                const row = document.createElement('div');
                row.className = 'tool-call-arg-row';
                row.innerHTML = `<span class="tool-call-arg-key">${escapeHtml(key)}</span><span class="tool-call-arg-value">${escapeHtml(value.length > 100 ? value.substring(0, 100) + '...' : value)}</span>`;
                argsDiv.appendChild(row);
            });
        }

        // Result preview (expandable)
        const resultDiv = document.createElement('div');
        resultDiv.className = 'tool-call-result-preview';
        if (typeof call.result === 'string' && call.result.length > 0) {
            const truncated = call.result.length > 300;
            resultDiv.textContent = truncated ? call.result.substring(0, 300) + '...' : call.result;
            if (truncated) {
                resultDiv.style.cursor = 'pointer';
                let expanded = false;
                resultDiv.addEventListener('click', () => {
                    expanded = !expanded;
                    resultDiv.textContent = expanded ? call.result : call.result.substring(0, 300) + '...';
                });
            }
        } else {
            resultDiv.textContent = '(no result)';
            resultDiv.classList.add('is-empty');
        }

        card.appendChild(header);
        if (formattedArgs.length > 0) card.appendChild(argsDiv);
        card.appendChild(resultDiv);
        timeline.appendChild(card);
    });

    return timeline;
}

/**
 * Render the combined ReAct group detail (all iterations as a timeline).
 */
function renderReactGroupDetail(container, group) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-step-detail';

    // Summary bar for the entire group
    const totalIterations = group.steps.length;
    const totalTools = group.steps.reduce((sum, { step }) =>
        sum + (Array.isArray(step.executionResults) ? step.executionResults.length : 0), 0);
    let totalTime = 0, totalIn = 0, totalOut = 0;
    group.steps.forEach(({ step }) => {
        const m = getStepMetrics(step) || {};
        totalTime += m.totalTime || 0;
        const ts = getStepDisplayTokenState(step, m);
        totalIn += ts.inputTokens;
        totalOut += ts.outputTokens;
    });

    const summaryBar = document.createElement('div');
    summaryBar.className = 'step-summary-bar';
    summaryBar.innerHTML = `
        <div class="step-summary-header">
            <span class="step-summary-phase">${_debugText('reactLoop')}</span>
            <span class="step-summary-model">${totalIterations} ${_debugText('iteration')}, ${totalTools} ${_debugText('toolsCalled')}</span>
            <span class="step-summary-metrics">
                <span class="metrics-pill metrics-pill-token"><span class="metrics-pill-label">IN</span>${formatNumber(totalIn)}</span>
                <span class="metrics-pill metrics-pill-token"><span class="metrics-pill-label">OUT</span>${formatNumber(totalOut)}</span>
                <span class="metrics-pill metrics-pill-time"><span class="metrics-pill-label">Total</span>${(totalTime / 1000).toFixed(1)}s</span>
            </span>
        </div>
    `;
    wrapper.appendChild(summaryBar);

    // Error banner for any failed iterations
    const failedSteps = group.steps.filter(({ step }) => step.failed);
    if (failedSteps.length > 0) {
        renderDesignErrorBanner(wrapper, failedSteps.map(({ step }) => step));
    }

    // Combined timeline — all iterations
    const allIterations = getToolResultsForReactGroup(group);
    allIterations.forEach(({ iteration, calls, step }) => {
        const iterSection = document.createElement('div');
        iterSection.className = 'react-iteration-section';

        const iterHeader = document.createElement('div');
        iterHeader.className = 'react-iteration-header';
        const iterMetrics = getStepMetrics(step) || {};
        const timeStr = iterMetrics.totalTime ? `${(iterMetrics.totalTime / 1000).toFixed(1)}s` : '';
        iterHeader.innerHTML = `
            <span class="react-iteration-label">${_debugText('iteration')} ${iteration || '?'}</span>
            ${timeStr ? `<span class="react-iteration-time">${timeStr}</span>` : ''}
            ${step.failed ? '<span class="sidebar-step-failed-badge">FAILED</span>' : ''}
        `;
        iterSection.appendChild(iterHeader);

        if (calls.length > 0) {
            iterSection.appendChild(renderToolCallTimeline(calls));
        }

        // Text output if present
        const response = getStepResponse(step);
        const outputText = getStepOutputText(step, response);
        if (outputText) {
            const textBlock = document.createElement('div');
            textBlock.className = 'step-detail-text-block';
            const textLabel = document.createElement('div');
            textLabel.className = 'step-detail-section-title';
            textLabel.textContent = _debugText('textOutput');
            textBlock.appendChild(textLabel);
            const pre = document.createElement('pre');
            pre.className = 'step-detail-text-output';
            pre.textContent = outputText.length > 500 ? outputText.substring(0, 500) + '...' : outputText;
            textBlock.appendChild(pre);
            iterSection.appendChild(textBlock);
        }

        if (calls.length === 0 && !outputText) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'react-iteration-empty';
            emptyDiv.textContent = _debugText('emptyIteration');
            iterSection.appendChild(emptyDiv);
        }

        wrapper.appendChild(iterSection);
    });

    // SystemPartsDebug from first iteration (only stored on first)
    const firstStep = group.steps[0]?.step;
    if (firstStep && Array.isArray(firstStep.systemPartsDebug) && firstStep.systemPartsDebug.length > 0) {
        wrapper.appendChild(renderSystemPartsDebugViewer('systemPartsDebug', firstStep.systemPartsDebug));
    }
    if (firstStep && Array.isArray(firstStep.promptManifest) && firstStep.promptManifest.length > 0) {
        wrapper.appendChild(renderPromptManifest('promptManifest', firstStep.promptManifest));
    }

    // Raw JSON toggle for full group data
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-ghost';
    toggleBtn.dataset.action = 'debug-raw-json-toggle';
    toggleBtn.textContent = _debugText('rawJsonShow');
    let rawContainer = null;
    let rawExpanded = false;
    toggleBtn.addEventListener('click', () => {
        rawExpanded = !rawExpanded;
        toggleBtn.textContent = rawExpanded ? _debugText('rawJsonHide') : _debugText('rawJsonShow');
        if (rawExpanded) {
            if (!rawContainer) {
                rawContainer = document.createElement('div');
                rawContainer.className = 'debug-raw-json-container json-viewer-container';
                const groupData = group.steps.map(({ step }) => step);
                _stepsRendererEnabled = false;
                try {
                    rawContainer.appendChild(jsonViewerInstance.render(groupData));
                } catch (err) {
                    rawContainer.textContent = 'JSON render failed: ' + err.message;
                }
                _stepsRendererEnabled = true;
                toggleBtn.after(rawContainer);
            } else {
                rawContainer.style.display = '';
            }
        } else if (rawContainer) {
            rawContainer.style.display = 'none';
        }
    });
    wrapper.appendChild(toggleBtn);

    container.appendChild(wrapper);
}

/**
 * Settlement Dispatch 分组详情渲染
 */
function renderSettlementGroupDetail(container, group, payload) {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-step-detail';

    // Summary bar
    const skillCount = group.skillNames.length;
    let totalTime = 0, totalIn = 0, totalOut = 0;
    group.steps.forEach(({ step }) => {
        const m = getStepMetrics(step) || {};
        totalTime += m.totalTime || 0;
        const ts = getStepDisplayTokenState(step, m);
        totalIn += ts.inputTokens;
        totalOut += ts.outputTokens;
    });

    const summaryBar = document.createElement('div');
    summaryBar.className = 'step-summary-bar';
    summaryBar.innerHTML = `
        <div class="step-summary-header">
            <span class="step-summary-phase">${_debugText('settlementDispatch')}</span>
            <span class="step-summary-model">${skillCount} ${_debugText('skillCount')}</span>
            <span class="step-summary-metrics">
                <span class="metrics-pill metrics-pill-token"><span class="metrics-pill-label">IN</span>${formatNumber(totalIn)}</span>
                <span class="metrics-pill metrics-pill-token"><span class="metrics-pill-label">OUT</span>${formatNumber(totalOut)}</span>
                <span class="metrics-pill metrics-pill-time"><span class="metrics-pill-label">Total</span>${(totalTime / 1000).toFixed(1)}s</span>
            </span>
        </div>
    `;
    wrapper.appendChild(summaryBar);

    // Settlement dispatch metadata (from lastPayload.settlementDispatch)
    const sd = payload?.settlementDispatch;
    if (sd) {
        const metaDiv = document.createElement('div');
        metaDiv.className = 'settlement-dispatch-meta';

        const statusClass = sd.status === 'succeeded' ? 'status-ok' : sd.status === 'failed' ? 'status-failed' : 'status-skipped';
        const statusIcon = sd.status === 'succeeded' ? '✓' : sd.status === 'failed' ? '✗' : '○'; // ui-lint-allow

        let skillResultsHTML = '';
        if (sd.skillResults) {
            skillResultsHTML = Object.entries(sd.skillResults).map(([name, info]) => {
                const sIcon = info.status === 'succeeded' ? '✓' : '✗'; // ui-lint-allow
                const sCls = info.status === 'succeeded' ? 'status-ok' : 'status-failed';
                const dur = info.duration ? `${(info.duration / 1000).toFixed(1)}s` : '';
                return `<span class="settlement-skill-result"><span class="${sCls}">${sIcon}</span> ${escapeHtml(name)} ${dur}</span>`;
            }).join('');
        }

        metaDiv.innerHTML = `
            <div class="settlement-dispatch-status">
                <span class="${statusClass}">${statusIcon} ${escapeHtml(sd.status)}</span>
                ${sd.retryCount > 0 ? `<span class="settlement-retry-count">retry: ${sd.retryCount}</span>` : ''}
                ${sd.duration ? `<span class="settlement-duration">${(sd.duration / 1000).toFixed(1)}s</span>` : ''}
            </div>
            ${sd.completedTools?.length ? `<div class="settlement-completed-tools">Completed: ${sd.completedTools.map(t => escapeHtml(t)).join(', ')}</div>` : ''}
            ${sd.failedSkills?.length ? `<div class="settlement-failed-skills">Failed: ${sd.failedSkills.map(t => escapeHtml(t)).join(', ')}</div>` : ''}
            ${skillResultsHTML ? `<div class="settlement-skill-results">${skillResultsHTML}</div>` : ''}
        `;
        wrapper.appendChild(metaDiv);
    }

    // Error banner for failed steps
    const failedSteps = group.steps.filter(({ step }) => step.failed);
    if (failedSteps.length > 0) {
        renderDesignErrorBanner(wrapper, failedSteps.map(({ step }) => step));
    }

    // Per-skill step sections
    group.steps.forEach(({ step, originalIndex }) => {
        const skillSection = document.createElement('div');
        skillSection.className = 'react-iteration-section';

        const skillName = step.phase ? step.phase.slice(6) : '?';
        const stepMetrics = getStepMetrics(step) || {};
        const timeStr = stepMetrics.totalTime ? `${(stepMetrics.totalTime / 1000).toFixed(1)}s` : '';

        const skillHeader = document.createElement('div');
        skillHeader.className = 'react-iteration-header';
        skillHeader.innerHTML = `
            <span class="react-iteration-label">${_debugText('skillLabel')}: ${escapeHtml(skillName)}</span>
            ${timeStr ? `<span class="react-iteration-time">${timeStr}</span>` : ''}
            ${step.failed ? '<span class="sidebar-step-failed-badge">FAILED</span>' : ''}
        `;
        skillSection.appendChild(skillHeader);

        // Tool call timeline from response
        const response = getStepResponse(step);
        const toolCalls = extractToolCalls(response);
        if (toolCalls.length > 0) {
            skillSection.appendChild(renderToolCallTimeline(toolCalls));
        }

        // Text output
        const outputText = getStepOutputText(step, response);
        if (outputText) {
            const textBlock = document.createElement('div');
            textBlock.className = 'step-detail-text-block';
            const textLabel = document.createElement('div');
            textLabel.className = 'step-detail-section-title';
            textLabel.textContent = _debugText('textOutput');
            textBlock.appendChild(textLabel);
            const pre = document.createElement('pre');
            pre.className = 'step-detail-text-output';
            pre.textContent = outputText.length > 500 ? outputText.substring(0, 500) + '...' : outputText;
            textBlock.appendChild(pre);
            skillSection.appendChild(textBlock);
        }

        if (toolCalls.length === 0 && !outputText) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'react-iteration-empty';
            emptyDiv.textContent = _debugText('emptyIteration');
            skillSection.appendChild(emptyDiv);
        }

        wrapper.appendChild(skillSection);
    });

    // Raw JSON toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-ghost';
    toggleBtn.dataset.action = 'debug-raw-json-toggle';
    toggleBtn.textContent = _debugText('rawJsonShow');
    let rawContainer = null;
    let rawExpanded = false;
    toggleBtn.addEventListener('click', () => {
        rawExpanded = !rawExpanded;
        toggleBtn.textContent = rawExpanded ? _debugText('rawJsonHide') : _debugText('rawJsonShow');
        if (rawExpanded) {
            if (!rawContainer) {
                rawContainer = document.createElement('div');
                rawContainer.className = 'debug-raw-json-container json-viewer-container';
                const groupData = {
                    steps: group.steps.map(({ step }) => step),
                    settlementDispatch: payload?.settlementDispatch || null,
                };
                _stepsRendererEnabled = false;
                try {
                    rawContainer.appendChild(jsonViewerInstance.render(groupData));
                } catch (err) {
                    rawContainer.textContent = 'JSON render failed: ' + err.message;
                }
                _stepsRendererEnabled = true;
                toggleBtn.after(rawContainer);
            } else {
                rawContainer.style.display = '';
            }
        } else if (rawContainer) {
            rawContainer.style.display = 'none';
        }
    });
    wrapper.appendChild(toggleBtn);

    container.appendChild(wrapper);
}

/**
 * Render structured extraction output as a formatted card.
 */
function renderStructuredOutputCard(parsed) {
    const card = document.createElement('div');
    card.className = 'structured-output-card';

    if (parsed && typeof parsed === 'object') {
        // Render key-value pairs
        const renderObj = (obj, container, depth = 0) => {
            Object.entries(obj).forEach(([key, value]) => {
                const row = document.createElement('div');
                row.className = 'structured-output-row';
                row.style.paddingLeft = (depth * 12) + 'px';

                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    row.innerHTML = `<span class="structured-output-key">${escapeHtml(key)}:</span>`;
                    container.appendChild(row);
                    renderObj(value, container, depth + 1);
                } else if (Array.isArray(value)) {
                    row.innerHTML = `<span class="structured-output-key">${escapeHtml(key)}:</span> <span class="structured-output-value">[${value.length} items]</span>`;
                    container.appendChild(row);
                    value.forEach((item, idx) => {
                        if (typeof item === 'object' && item !== null) {
                            const itemRow = document.createElement('div');
                            itemRow.className = 'structured-output-row';
                            itemRow.style.paddingLeft = ((depth + 1) * 12) + 'px';
                            itemRow.innerHTML = `<span class="structured-output-key">[${idx}]</span>`;
                            container.appendChild(itemRow);
                            renderObj(item, container, depth + 2);
                        } else {
                            const itemRow = document.createElement('div');
                            itemRow.className = 'structured-output-row';
                            itemRow.style.paddingLeft = ((depth + 1) * 12) + 'px';
                            itemRow.innerHTML = `<span class="structured-output-value">${escapeHtml(String(item))}</span>`;
                            container.appendChild(itemRow);
                        }
                    });
                } else {
                    row.innerHTML = `<span class="structured-output-key">${escapeHtml(key)}:</span> <span class="structured-output-value">${escapeHtml(String(value))}</span>`;
                    container.appendChild(row);
                }
            });
        };
        renderObj(parsed, card);
    }

    return card;
}

function createCollapsibleSection(title, data, _dataKey) {
    const section = document.createElement('div');
    section.className = 'step-detail-section';

    const header = document.createElement('div');
    header.className = 'step-detail-section-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'step-detail-section-title';
    titleSpan.textContent = title;
    header.appendChild(titleSpan);

    const actions = document.createElement('div');
    actions.className = 'step-detail-section-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary';
    copyBtn.dataset.action = 'step-section-copy-btn';
    copyBtn.textContent = _debugText('copy');
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = JSON.stringify(data, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.classList.add('is-success');
            copyBtn.textContent = _debugText('copied');
            setTimeout(() => {
                copyBtn.classList.remove('is-success');
                copyBtn.textContent = _debugText('copy');
            }, 1500);
        }).catch(err => {
            console.error('[Debug] Copy failed:', err);
            copyBtn.textContent = _debugText('copyFailed');
            setTimeout(() => copyBtn.textContent = _debugText('copy'), 1500);
        });
    });
    actions.appendChild(copyBtn);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'step-detail-section-body json-viewer-container';

    let collapsed = true;
    body.classList.add('is-collapsed');
    header.addEventListener('click', () => {
        collapsed = !collapsed;
        body.classList.toggle('is-collapsed', collapsed);
        if (!collapsed && body.childElementCount === 0) {
            try {
                body.appendChild(jsonViewerInstance.render(data));
            } catch (err) {
                body.textContent = 'JSON 渲染失败: ' + err.message;
            }
        }
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
}

function createResponseSection(response, outputText, reasoningText, _provider) {
    const section = document.createElement('div');
    section.className = 'step-detail-section';

    const header = document.createElement('div');
    header.className = 'step-detail-section-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'step-detail-section-title';
    titleSpan.textContent = _debugText('response');
    header.appendChild(titleSpan);

    const actions = document.createElement('div');
    actions.className = 'step-detail-section-actions';

    // View mode toggle (only if text output exists)
    let viewMode = 'json';
    if (outputText) {
        const toggle = document.createElement('div');
        toggle.className = 'tab-strip';
        toggle.dataset.action = 'response-view-toggle';
        toggle.innerHTML = `
            <button class="tab is-active" data-action="response-view-btn" data-mode="json">JSON</button>
            <button class="tab" data-action="response-view-btn" data-mode="text">纯文本</button>
        `;
        actions.appendChild(toggle);
    }

    // Copy button — is-success 仅在点击成功后短暂应用作为反馈
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary';
    copyBtn.dataset.action = 'step-section-copy-btn';
    copyBtn.textContent = _debugText('copy');
    copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = viewMode === 'text' && outputText ? outputText : JSON.stringify(response, null, 2);
        navigator.clipboard.writeText(text).then(() => {
            copyBtn.classList.add('is-success');
            copyBtn.textContent = _debugText('copied');
            setTimeout(() => {
                copyBtn.classList.remove('is-success');
                copyBtn.textContent = _debugText('copy');
            }, 1500);
        }).catch(err => {
            console.error('[Debug] Copy failed:', err);
            copyBtn.textContent = _debugText('copyFailed');
            setTimeout(() => copyBtn.textContent = _debugText('copy'), 1500);
        });
    });
    actions.appendChild(copyBtn);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'step-detail-section-body';

    // JSON view (default, lazy-rendered)
    const jsonView = document.createElement('div');
    jsonView.className = 'json-viewer-container';
    let jsonRendered = false;

    // Text view
    const textView = document.createElement('div');
    textView.style.display = 'none';
    if (reasoningText) {
        const reasoningDetails = document.createElement('details');
        reasoningDetails.className = 'scp-reasoning debug-reasoning';

        const reasoningSummary = document.createElement('summary');
        reasoningSummary.className = 'scp-section-title';
        reasoningSummary.textContent = `${_debugText('reasoning')} (${reasoningText.length} chars)`;

        const reasoningPre = document.createElement('pre');
        reasoningPre.className = 'step-detail-text-output';
        reasoningPre.textContent = reasoningText;

        reasoningDetails.appendChild(reasoningSummary);
        reasoningDetails.appendChild(reasoningPre);
        textView.appendChild(reasoningDetails);
    }
    if (outputText) {
        const pre = document.createElement('pre');
        pre.className = 'step-detail-text-output';
        pre.textContent = outputText;
        textView.appendChild(pre);
    } else {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'debug-empty-state debug-empty-state--compact';
        emptyMsg.style.minHeight = '60px';
        emptyMsg.textContent = _debugText('noTextOutput');
        textView.appendChild(emptyMsg);
    }

    body.appendChild(jsonView);
    body.appendChild(textView);

    // Default: expanded, show JSON
    const renderJsonIfNeeded = () => {
        if (!jsonRendered) {
            jsonRendered = true;
            try {
                jsonView.appendChild(jsonViewerInstance.render(response));
            } catch (err) {
                jsonView.textContent = 'JSON 渲染失败: ' + err.message;
            }
        }
    };
    renderJsonIfNeeded();

    // Toggle handler
    header.addEventListener('click', (e) => {
        const modeBtn = e.target.closest('[data-action~="response-view-btn"]');
        if (modeBtn) {
            e.stopPropagation();
            const newMode = modeBtn.dataset.mode;
            if (newMode === viewMode) return;
            viewMode = newMode;

            header.querySelectorAll('[data-action~="response-view-btn"]').forEach(b => b.classList.toggle('is-active', b.dataset.mode === viewMode));

            if (viewMode === 'text') {
                jsonView.style.display = 'none';
                textView.style.display = '';
            } else {
                jsonView.style.display = '';
                textView.style.display = 'none';
                renderJsonIfNeeded();
            }
            return;
        }
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
}

// ══════════════════════════════════════════════
// Live Pipeline Overview (API tab)
// ══════════════════════════════════════════════

function renderPipelineOverview(container, payload) {
    container.innerHTML = '';
    const overview = document.createElement('div');
    overview.className = 'pipeline-overview';

    const steps = payload.steps || [];
    const groups = _cachedSidebarGroups || groupStepsForSidebar(steps);

    // Classify steps by phase
    const npcSteps = steps.filter(s => s.phase === 'npc_reaction');
    const oocSteps = steps.filter(s => s.phase === 'ooc');
    const reactSteps = steps.filter(s => s.phase === 'react');
    const skillSteps = steps.filter(s => s.phase && s.phase.startsWith('skill:'));
    const gmPayload = (typeof aiService !== 'undefined') ? aiService.lastGMPayload : null;

    // Helper: create a phase box
    const createPhaseBox = (label, phaseSteps, opts = {}) => {
        const box = document.createElement('div');
        box.className = 'pipeline-step-box';
        if (opts.isReact) box.classList.add('is-react');
        if (opts.isEngine) box.classList.add('is-engine');
        if (opts.isSettlement) box.classList.add('is-settlement');

        const hasData = phaseSteps && phaseSteps.length > 0;
        const hasFailed = hasData && phaseSteps.some(s => s.failed);
        const isSkipped = !hasData && !opts.forceShow;

        if (hasFailed) box.classList.add('is-failed');
        if (isSkipped) box.classList.add('is-skipped');

        let metaText = '';
        if (isSkipped) {
            metaText = _debugText('skipped');
        } else if (hasData) {
            let totalTime = 0;
            phaseSteps.forEach(s => { totalTime += (getStepMetrics(s) || {}).totalTime || 0; });
            const timeStr = (totalTime / 1000).toFixed(1) + 's';

            if (opts.isReact) {
                const totalTools = phaseSteps.reduce((sum, s) =>
                    sum + (Array.isArray(s.executionResults) ? s.executionResults.length : 0), 0);
                metaText = `${phaseSteps.length} iter, ${totalTools} tools — ${timeStr}`;
            } else if (opts.isSettlement) {
                metaText = `${phaseSteps.length} ${_debugText('skillCount')} — ${timeStr}`;
            } else if (phaseSteps.length > 1) {
                const isOocPhase = phaseSteps.every(s => s && s.phase === 'ooc');
                if (isOocPhase) {
                    metaText = `${phaseSteps.length} rounds — ${timeStr}`;
                } else {
                    metaText = `${phaseSteps.length} calls — ${timeStr}`;
                }
            } else {
                metaText = timeStr;
            }
        }

        const statusIcon = isSkipped ? '○' : hasFailed ? '✗' : '✓'; // ui-lint-allow
        const statusClass = isSkipped ? 'status-skipped' : hasFailed ? 'status-failed' : 'status-ok';

        box.innerHTML = `
            <div class="pipeline-step-label">${escapeHtml(label)}</div>
            <div class="pipeline-step-status ${statusClass}">${statusIcon} ${escapeHtml(metaText)}</div>
        `;

        // Click handler: navigate to corresponding step/group
        if (hasData && !isSkipped) {
            box.style.cursor = 'pointer';
            box.addEventListener('click', () => {
                if (opts.isReact) {
                    const reactGroupIdx = groups.findIndex(g => g.type === 'react_group');
                    if (reactGroupIdx >= 0) {
                        const reactGroupCounter = groups.slice(0, reactGroupIdx + 1).filter(g => g.type === 'react_group').length - 1;
                        currentSelectionMode = 'react-group';
                        currentReactGroupIndex = reactGroupCounter;
                        currentSelectedStepIndex = null;
                        currentSettlementGroupIndex = null;
                    }
                } else if (opts.isSettlement) {
                    const settlementGroupIdx = groups.findIndex(g => g.type === 'settlement_group');
                    if (settlementGroupIdx >= 0) {
                        const settlementGroupCounter = groups.slice(0, settlementGroupIdx + 1).filter(g => g.type === 'settlement_group').length - 1;
                        currentSelectionMode = 'settlement-group';
                        currentSettlementGroupIndex = settlementGroupCounter;
                        currentSelectedStepIndex = null;
                        currentReactGroupIndex = null;
                    }
                } else {
                    const stepIdx = steps.indexOf(phaseSteps[0]);
                    if (stepIdx >= 0) {
                        currentSelectionMode = 'step';
                        currentSelectedStepIndex = stepIdx;
                        currentReactGroupIndex = null;
                        currentSettlementGroupIndex = null;
                    }
                }
                refreshDebugContent();
            });
        }

        return box;
    };

    // GM box (special — not from steps)
    const createGMBox = () => {
        const box = document.createElement('div');
        box.className = 'pipeline-step-box is-engine';
        const gmFailed = gmPayload && gmPayload.failed;
        const isSkipped = !gmPayload;

        if (gmFailed) box.classList.add('is-failed');
        if (isSkipped) box.classList.add('is-skipped');

        let metaText = '';
        if (isSkipped) {
            metaText = _debugText('skipped');
        } else if (gmFailed) {
            metaText = 'ERROR';
        } else {
            const directive = gmPayload.directive;
            metaText = directive ? directive.substring(0, 40) + (directive.length > 40 ? '...' : '') : '✓'; // ui-lint-allow
        }

        const statusIcon = isSkipped ? '○' : gmFailed ? '✗' : '✓'; // ui-lint-allow
        const statusClass = isSkipped ? 'status-skipped' : gmFailed ? 'status-failed' : 'status-ok';

        box.innerHTML = `
            <div class="pipeline-step-label">${_debugText('gmDecision')}</div>
            <div class="pipeline-step-status ${statusClass}">${statusIcon} ${escapeHtml(metaText)}</div>
        `;

        return box;
    };

    // ── Phase 1: Parallel ──
    const phase1Label = document.createElement('div');
    phase1Label.className = 'pipeline-phase-label';
    phase1Label.textContent = _debugText('phase1');
    overview.appendChild(phase1Label);

    const phase1Row = document.createElement('div');
    phase1Row.className = 'pipeline-parallel-row';
    phase1Row.appendChild(createPhaseBox(_debugText('npcReactionsLabel'), npcSteps));
    phase1Row.appendChild(createPhaseBox(_debugText('actionClassify'), [], { forceShow: false }));
    phase1Row.appendChild(createPhaseBox(_debugText('ooc'), oocSteps, { forceShow: false }));
    overview.appendChild(phase1Row);

    // Arrow
    overview.appendChild(createPipelineArrow());

    // ── Phase 2: GM ──
    const phase2Label = document.createElement('div');
    phase2Label.className = 'pipeline-phase-label';
    phase2Label.textContent = _debugText('phase2');
    overview.appendChild(phase2Label);
    overview.appendChild(createGMBox());

    // Arrow
    overview.appendChild(createPipelineArrow());

    // ── Phase 3: ReAct ──
    const phase3Label = document.createElement('div');
    phase3Label.className = 'pipeline-phase-label';
    phase3Label.textContent = _debugText('phase3');
    overview.appendChild(phase3Label);
    overview.appendChild(createPhaseBox(_debugText('reactLoop'), reactSteps, { isReact: true }));

    // Arrow
    overview.appendChild(createPipelineArrow());

    // ── Phase 4: Settlement Dispatch ──
    const phase4Label = document.createElement('div');
    phase4Label.className = 'pipeline-phase-label';
    phase4Label.textContent = _debugText('phase4');
    overview.appendChild(phase4Label);
    overview.appendChild(createPhaseBox(_debugText('settlementDispatch'), skillSteps, { isSettlement: true }));

    // ── Stats Grid (below flow) ──
    let totalIn = 0, totalOut = 0, totalTime = 0;
    const ttfts = [];
    steps.forEach(s => {
        const m = getStepMetrics(s) || {};
        const tokenState = getStepDisplayTokenState(s, m);
        totalIn += tokenState.inputTokens;
        totalOut += tokenState.outputTokens;
        totalTime += m.totalTime || 0;
        if (m.ttft) ttfts.push(m.ttft);
    });

    const statsGrid = document.createElement('div');
    statsGrid.className = 'debug-overview-stats';
    const cards = [
        { label: 'Steps', value: steps.length, cls: 'is-count' },
        { label: 'Input Tokens', value: formatNumber(totalIn), cls: 'is-token' },
        { label: 'Output Tokens', value: formatNumber(totalOut), cls: 'is-token' },
        { label: 'Total Time', value: (totalTime / 1000).toFixed(1) + 's', cls: 'is-time' },
    ];
    if (ttfts.length > 0) {
        const avgTtft = ttfts.reduce((a, b) => a + b, 0) / ttfts.length;
        cards.push({ label: 'Avg TTFT', value: (avgTtft / 1000).toFixed(2) + 's', cls: 'is-time' });
    }
    const failedCount = steps.filter(s => s.failed).length;
    if (failedCount > 0) {
        cards.push({ label: 'Failed', value: failedCount, cls: '' });
    }

    statsGrid.innerHTML = cards.map(c =>
        `<div class="overview-stat-card">
            <div class="overview-stat-label">${c.label}</div>
            <div class="overview-stat-value ${c.cls}">${c.value}</div>
        </div>`
    ).join('');
    overview.appendChild(statsGrid);

    // Runtime status
    const runtimeStatus = getRuntimeWorldDebugStatus();
    if (runtimeStatus) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'debug-runtime-status';
        statusDiv.textContent = `${_debugText('runtimePrefix')}: active=${runtimeStatus.hasActiveSnapshot} | world=${runtimeStatus.worldCount} | rules=${runtimeStatus.moduleCount} | chars=${runtimeStatus.characterCount} | timeline=${runtimeStatus.timelineCount}`;
        overview.appendChild(statusDiv);
    }

    // Raw JSON toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-ghost';
    toggleBtn.dataset.action = 'debug-raw-json-toggle';
    toggleBtn.textContent = _debugText('rawJsonShow');
    let rawJsonContainer = null;
    let rawJsonExpanded = false;
    toggleBtn.addEventListener('click', () => {
        rawJsonExpanded = !rawJsonExpanded;
        toggleBtn.textContent = rawJsonExpanded ? _debugText('rawJsonHide') : _debugText('rawJsonShow');
        if (rawJsonExpanded) {
            if (!rawJsonContainer) {
                rawJsonContainer = document.createElement('div');
                rawJsonContainer.className = 'debug-raw-json-container json-viewer-container';
                _stepsRendererEnabled = false;
                try { rawJsonContainer.appendChild(jsonViewerInstance.render(payload)); }
                catch (err) { rawJsonContainer.textContent = 'JSON render failed: ' + err.message; }
                _stepsRendererEnabled = true;
                toggleBtn.after(rawJsonContainer);
            } else {
                rawJsonContainer.style.display = '';
            }
        } else if (rawJsonContainer) {
            rawJsonContainer.style.display = 'none';
        }
    });
    overview.appendChild(toggleBtn);

    container.appendChild(overview);
}

function createPipelineArrow() {
    const arrow = document.createElement('div');
    arrow.className = 'pipeline-arrow';
    arrow.innerHTML = '<span class="pipeline-arrow-icon">▼</span>';
    return arrow;
}

// ══════════════════════════════════════════════
// Single Payload Rendering (no steps)
// ══════════════════════════════════════════════

function renderSinglePayload(container, payload) {
    container.innerHTML = '';

    // Runtime status
    const runtimeStatus = getRuntimeWorldDebugStatus();
    if (runtimeStatus) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'debug-runtime-status';
        statusDiv.style.marginBottom = '12px';
        statusDiv.textContent = `RuntimeWorldStore: active=${runtimeStatus.hasActiveSnapshot} | world=${runtimeStatus.worldCount} | rules=${runtimeStatus.moduleCount} | chars=${runtimeStatus.characterCount} | timeline=${runtimeStatus.timelineCount}`;
        container.appendChild(statusDiv);
    }

    // Error banner
    if (payload.errorInfo) {
        renderDesignErrorBanner(container, [{ errorInfo: payload.errorInfo, phase: 'single_call' }]);
    }

    // JSON viewer
    const viewerDiv = document.createElement('div');
    viewerDiv.className = 'json-viewer-container';
    try {
        viewerDiv.appendChild(jsonViewerInstance.render(payload));
    } catch (err) {
        console.error('[DebugUI] JsonViewer render error:', err);
        viewerDiv.textContent = 'JSON 渲染失败: ' + err.message;
    }
    container.appendChild(viewerDiv);
}

// ══════════════════════════════════════════════
// Custom Renderers (preserved)
// ══════════════════════════════════════════════

function renderSystemPartsDebugViewer(key, rows) {
    const container = document.createElement('details');
    container.className = 'jv-details';
    container.open = true;

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';
    summary.innerHTML = `<span class="jv-key">${key}: </span><span class="jv-preview">PartsDebug [${rows.length}]</span>`;
    container.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'system-parts-debug-list';

    if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'system-parts-debug-row';
        empty.textContent = 'No system parts metadata';
        body.appendChild(empty);
    } else {
        rows.forEach(row => {
            const status = row?.status || 'n/a';
            const rowEl = document.createElement('div');
            rowEl.className = 'system-parts-debug-row';
            if (status === 'missing') rowEl.classList.add('is-missing');

            const statusClass = `status-${status.toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;
            const meta = [];
            if (typeof row?.length === 'number') meta.push(`${row.length} chars`);
            if (row?.type) meta.push(`type:${row.type}`);
            if (row?.condition) meta.push(`when:${row.condition}`);
            if (row?.worldMechanics) meta.push(`world:${row.worldMechanics}`);
            if (row?.info) meta.push(row.info);

            rowEl.innerHTML = `
                <span class="system-parts-debug-order">#${row?.order || '?'}</span>
                <span class="system-parts-debug-name">${escapeHtml(row?.name || 'unknown')}</span>
                <span class="system-parts-debug-meta">${escapeHtml(meta.join(' | '))}</span>
                <span class="system-parts-debug-status ${statusClass}">${escapeHtml(status)}</span>
            `;
            body.appendChild(rowEl);
        });
    }

    container.appendChild(body);
    return container;
}

function renderSystemInstructionPartsViewer(key, parts) {
    const container = document.createElement('details');
    container.className = 'jv-details';
    container.open = true;

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';
    summary.innerHTML = `<span class="jv-key">${key}: </span><span class="jv-preview">System Parts [${parts.length}]</span>`;
    container.appendChild(summary);

    const children = document.createElement('div');
    children.className = 'jv-children';

    parts.forEach((part, index) => {
        const text = part.text || '';
        const { source, sourceClass } = identifyPartType(text);

        const partDiv = document.createElement('div');
        partDiv.className = `debug-segment ${sourceClass} collapsible collapsed`;

        const header = document.createElement('div');
        header.className = 'segment-header';
        header.onclick = () => partDiv.classList.toggle('collapsed');

        const collapseIcon = document.createElement('span');
        collapseIcon.className = 'collapse-icon material-symbols-outlined';
        collapseIcon.textContent = 'chevron_right';
        collapseIcon.setAttribute('aria-hidden', 'true');

        const label = document.createElement('span');
        label.textContent = `Part ${index + 1}: ${source}`;

        const size = document.createElement('span');
        size.className = 'segment-size';
        size.textContent = `(${text.length} chars)`;

        header.appendChild(collapseIcon);
        header.appendChild(label);
        header.appendChild(size);
        partDiv.appendChild(header);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'segment-content';

        if (text.length > 3000) {
            const subSegments = segmentLongText(text);
            if (subSegments) {
                subSegments.forEach(seg => {
                    const segDisplay = identifyPartType(seg.content);
                    const subDiv = document.createElement('div');
                    subDiv.className = `debug-segment ${segDisplay.sourceClass}`;
                    subDiv.style.marginLeft = '10px';
                    subDiv.innerHTML = `
                        <div class="segment-header">${escapeHtml(segDisplay.source)}</div>
                        <div class="segment-content">${escapeHtml(seg.content)}</div>
                    `;
                    contentDiv.appendChild(subDiv);
                });
            } else {
                contentDiv.textContent = text;
            }
        } else {
            contentDiv.textContent = text;
        }

        partDiv.appendChild(contentDiv);
        children.appendChild(partDiv);
    });

    container.appendChild(children);
    return container;
}

/**
 * Compact steps renderer for Raw JSON view.
 * Shows a simple summary instead of full navigation.
 */
function renderStepsArrayCompact(key, steps) {
    const container = document.createElement('details');
    container.className = 'jv-details';
    container.open = false;

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';
    summary.innerHTML = `<span class="jv-key">${key}: </span><span class="jv-preview">Array [${steps.length} steps]</span>`;
    container.appendChild(summary);

    const children = document.createElement('div');
    children.className = 'jv-children';

    steps.forEach((step, index) => {
        const stepDiv = document.createElement('details');
        stepDiv.className = 'jv-details';
        stepDiv.open = false;

        const stepSummary = document.createElement('summary');
        stepSummary.className = 'jv-summary';
        const phaseLabel = step.stageName ? `${step.phase} (${step.stageName})` : step.phase;
        stepSummary.innerHTML = `<span class="jv-key">[${index}]: </span><span class="jv-preview">{ phase: "${escapeHtml(phaseLabel)}" }</span>`;
        stepDiv.appendChild(stepSummary);

        const stepChildren = document.createElement('div');
        stepChildren.className = 'jv-children';

        for (const [stepKey, stepValue] of Object.entries(step)) {
            stepChildren.appendChild(jsonViewerInstance._createNode(stepKey, stepValue, 2));
        }

        stepDiv.appendChild(stepChildren);
        children.appendChild(stepDiv);
    });

    container.appendChild(children);
    return container;
}

function renderMetricsCard(key, value) {
    const container = document.createElement('details');
    container.className = 'jv-details';
    container.open = true;

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';
    summary.innerHTML = `<span class="jv-key">${key}: </span><span class="jv-preview">Metrics</span>`;
    container.appendChild(summary);

    const card = document.createElement('div');
    card.className = 'metrics-card';

    const pills = [];
    if (value.inputTokens !== null && value.inputTokens !== undefined) pills.push({ label: 'IN', value: formatNumber(value.inputTokens), cls: 'metrics-pill-token' });
    if (value.outputTokens !== null && value.outputTokens !== undefined) pills.push({ label: 'OUT', value: formatNumber(value.outputTokens), cls: 'metrics-pill-token' });
    if (value.ttfb !== null && value.ttfb !== undefined) pills.push({ label: 'TTFB', value: (value.ttfb / 1000).toFixed(2) + 's', cls: 'metrics-pill-time' });
    if ((value.ttft !== null && value.ttft !== undefined) && value.ttft !== value.ttfb) pills.push({ label: 'TTFT', value: (value.ttft / 1000).toFixed(2) + 's', cls: 'metrics-pill-time' });
    if (value.downloadTime !== null && value.downloadTime !== undefined) pills.push({ label: 'DL', value: (value.downloadTime / 1000).toFixed(2) + 's', cls: 'metrics-pill-time' });
    if (value.totalTime !== null && value.totalTime !== undefined) pills.push({ label: 'Total', value: (value.totalTime / 1000).toFixed(2) + 's', cls: 'metrics-pill-time' });

    card.innerHTML = pills.map(p =>
        `<span class="metrics-pill ${p.cls}"><span class="metrics-pill-label">${p.label}</span>${escapeHtml(p.value)}</span>`
    ).join('');

    container.appendChild(card);

    const rawDetails = document.createElement('details');
    rawDetails.className = 'jv-details metrics-raw';
    const rawSummary = document.createElement('summary');
    rawSummary.className = 'jv-summary';
    rawSummary.innerHTML = '<span class="jv-preview">▾ Raw JSON</span>';
    rawDetails.appendChild(rawSummary);
    rawDetails.appendChild(jsonViewerInstance._createNode(key, value, 2, true));
    container.appendChild(rawDetails);

    return container;
}

function renderPromptManifest(key, value) {
    const container = document.createElement('details');
    container.className = 'jv-details';
    container.open = true;

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';
    summary.innerHTML = `<span class="jv-key">${key}: </span><span class="jv-preview">PromptManifest [${value.length}]</span>`;
    container.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'prompt-manifest-list';

    value.forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'prompt-manifest-row';

        const typeClassMap = { 'static': 'pm-type-static', 'dynamic': 'pm-type-dynamic', 'world_card': 'pm-type-world-card' };
        const typeClass = typeClassMap[item.type] || 'pm-type-dynamic';
        const statusHTML = item.status
            ? `<span class="system-parts-debug-status status-${(item.status || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-')}">${escapeHtml(item.status)}</span>`
            : '';

        const lengthStr = typeof item.length === 'number' ? `${item.length.toLocaleString()} chars` : '';
        const modulesStr = typeof item.modules === 'number' ? ` (${item.modules} modules)` : '';
        const infoStr = item.condition ? `when: ${item.condition}` : '';
        const componentStr = item.componentCount ? `${item.componentCount} components` : '';
        const meta = [lengthStr, modulesStr, infoStr, componentStr].filter(Boolean).join(' | ');

        row.innerHTML = `
            <span class="pm-index">${idx + 1}</span>
            <span class="pm-name">${escapeHtml(item.name || 'unknown')}</span>
            <span class="pm-type ${typeClass}">${escapeHtml(item.type || '?')}</span>
            <span class="pm-meta">${escapeHtml(meta)}</span>
            ${statusHTML}
        `;
        list.appendChild(row);
    });

    container.appendChild(list);

    const rawDetails = document.createElement('details');
    rawDetails.className = 'jv-details metrics-raw';
    const rawSummary = document.createElement('summary');
    rawSummary.className = 'jv-summary';
    rawSummary.innerHTML = '<span class="jv-preview">▾ Raw JSON</span>';
    rawDetails.appendChild(rawSummary);
    rawDetails.appendChild(jsonViewerInstance._createNode(key, value, 2, true));
    container.appendChild(rawDetails);

    return container;
}

function renderExecutionResults(key, value) {
    const container = document.createElement('details');
    container.className = 'jv-details';
    container.open = true;

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';
    summary.innerHTML = `<span class="jv-key">${key}: </span><span class="jv-preview">Tools [${value.length}]</span>`;
    container.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'exec-results-list';

    value.forEach(item => {
        const row = document.createElement('details');
        row.className = 'exec-results-row';

        const argsStr = item.args ? JSON.stringify(item.args) : '{}';
        const argsPreview = argsStr.length > 60 ? argsStr.substring(0, 60) + '...' : argsStr;
        const resultLen = typeof item.resultLength === 'number' ? item.resultLength.toLocaleString() : '?';

        const rowSummary = document.createElement('summary');
        rowSummary.className = 'exec-results-summary';
        rowSummary.innerHTML = `
            <span class="exec-name">${escapeHtml(item.name || '?')}</span>
            <span class="exec-args-preview">${escapeHtml(argsPreview)}</span>
            <span class="exec-result-len">${resultLen} chars</span>
        `;
        row.appendChild(rowSummary);

        if (item.args && Object.keys(item.args).length > 0) {
            const argsBlock = document.createElement('pre');
            argsBlock.className = 'exec-args-full';
            argsBlock.textContent = JSON.stringify(item.args, null, 2);
            row.appendChild(argsBlock);
        }

        list.appendChild(row);
    });

    container.appendChild(list);

    const rawDetails = document.createElement('details');
    rawDetails.className = 'jv-details metrics-raw';
    const rawSummary = document.createElement('summary');
    rawSummary.className = 'jv-summary';
    rawSummary.innerHTML = '<span class="jv-preview">▾ Raw JSON</span>';
    rawDetails.appendChild(rawSummary);
    rawDetails.appendChild(jsonViewerInstance._createNode(key, value, 2, true));
    container.appendChild(rawDetails);

    return container;
}

// ══════════════════════════════════════════════
// Error Banner (preserved for chatCore.js compat)
// ══════════════════════════════════════════════

function _debugExtractServerErrorText(responseBody) {
    if (responseBody == null) return null;
    let body = responseBody;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); }
        catch { return body.length > 200 ? body.slice(0, 200) + '…' : body; }
    }
    if (typeof body !== 'object') return String(body);
    if (typeof body.error === 'string') return body.error;
    if (body.error && typeof body.error.message === 'string') return body.error.message;
    if (typeof body.message === 'string') return body.message;
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
        const msgs = body.detail.map(d => d?.msg || d?.message).filter(Boolean);
        if (msgs.length) return msgs.join('; ');
    }
    try {
        const s = JSON.stringify(body);
        return s.length > 200 ? s.slice(0, 200) + '…' : s;
    } catch { return null; }
}

function renderDesignErrorBanner(container, failedSteps) {
    const banner = document.createElement('div');
    banner.className = 'debug-design-error-banner';

    const failedStep = failedSteps[failedSteps.length - 1];
    const info = failedStep.errorInfo || {};

    const lines = [];
    lines.push(`<div class="design-error-title">${escapeHtml(_debugText('apiFailed'))}</div>`);

    const phaseText = info.phase || failedStep.phase || '';
    const stageText = failedStep.stageName || '';
    const moduleText = info.module || '';
    const providerText = info.provider || failedStep.provider || '';
    const modelText = info.model || failedStep.model || '';
    const engineText = info.engine || failedStep.engine || '';

    const mergedPhase = (phaseText && moduleText && phaseText !== moduleText)
        ? `${phaseText} / ${moduleText}`
        : (phaseText || moduleText);
    const stageDisplay = stageText && mergedPhase
        ? `${stageText} (${mergedPhase})`
        : (stageText || mergedPhase);
    if (stageDisplay) lines.push(`<div class="design-error-row"><span class="design-error-label">阶段</span>${escapeHtml(stageDisplay)}</div>`);
    if (providerText) lines.push(`<div class="design-error-row"><span class="design-error-label">Provider</span>${escapeHtml(providerText)}</div>`);
    if (modelText) lines.push(`<div class="design-error-row"><span class="design-error-label">模型</span>${escapeHtml(modelText)}</div>`);
    if (engineText) lines.push(`<div class="design-error-row"><span class="design-error-label">引擎</span>${escapeHtml(engineText)}</div>`);
    if (info.httpStatus) lines.push(`<div class="design-error-row"><span class="design-error-label">HTTP 状态</span>${info.httpStatus} ${escapeHtml(info.httpStatusText || '')}</div>`);
    const serverErrorText = _debugExtractServerErrorText(info.responseBody);
    if (serverErrorText) lines.push(`<div class="design-error-row"><span class="design-error-label">服务端返回</span>${escapeHtml(serverErrorText)}</div>`);
    if (info.errorType && info.errorType !== 'http') lines.push(`<div class="design-error-row"><span class="design-error-label">错误类型</span>${escapeHtml(info.errorType)}</div>`);
    const rawMsg = info.message || failedStep.error || '';
    const msgIsHttpRestate = info.httpStatus && /^HTTP\s*\d+/i.test(rawMsg);
    if (rawMsg && !msgIsHttpRestate) lines.push(`<div class="design-error-row"><span class="design-error-label">错误消息</span>${escapeHtml(rawMsg)}</div>`);
    if (info.stageElapsedMs !== null && info.stageElapsedMs !== undefined) lines.push(`<div class="design-error-row"><span class="design-error-label">耗时</span>${(info.stageElapsedMs / 1000).toFixed(1)}s</div>`);
    else if (info.elapsedMs !== null && info.elapsedMs !== undefined) lines.push(`<div class="design-error-row"><span class="design-error-label">耗时</span>${(info.elapsedMs / 1000).toFixed(1)}s</div>`);
    if (info.url) lines.push(`<div class="design-error-row"><span class="design-error-label">请求地址</span>${escapeHtml(info.url)}</div>`);

    banner.innerHTML = lines.join('');
    container.appendChild(banner);
}

// ══════════════════════════════════════════════
// Utility Functions (preserved)
// ══════════════════════════════════════════════

function getStepSystemPartsWarning(step) {
    const parts = Array.isArray(step?.systemPartsDebug) ? step.systemPartsDebug : [];
    const coreWorldMechanics = parts.find(p => p?.name === 'PROMPT_MODULE_core_world_mechanics');
    return { coreWorldMechanicsMissing: !!(coreWorldMechanics && coreWorldMechanics.status === 'missing') };
}

function getStepRunnerBadgeText(step) {
    const engine = typeof step?.engine === 'string' ? step.engine.trim() : '';
    if (engine) return engine;
    const model = typeof step?.model === 'string' ? step.model.trim() : '';
    if (model) return model;
    return typeof step?.provider === 'string' ? step.provider.trim() : '';
}

function getStepExecutionTitle(step) {
    const engine = typeof step?.engine === 'string' ? step.engine.trim() : '';
    if (engine) return engine;
    const provider = typeof step?.provider === 'string' ? step.provider.trim() : '';
    const model = typeof step?.model === 'string' ? step.model.trim() : '';
    if (provider && model) return `${provider} / ${model}`;
    return model || provider || '';
}

function getStepResponse(step) {
    if (!step || typeof step !== 'object') return null;
    if (step.response) return step.response;

    const body = step.responseBody;
    if (!body || typeof body !== 'object') return null;
    if (body.raw) return body.raw;
    return body;
}

function getStepMetrics(step) {
    if (step?.metrics) return step.metrics;
    const bodyMetrics = step?.responseBody?.metrics;
    return bodyMetrics && typeof bodyMetrics === 'object' ? bodyMetrics : null;
}

function getCachedStepEstimate(step) {
    const tokenEstimateService = window.tokenEstimateService;
    if (!tokenEstimateService || typeof tokenEstimateService.getCachedStepEstimate !== 'function') {
        return null;
    }
    return tokenEstimateService.getCachedStepEstimate(step);
}

function getStepDisplayTokenState(step, metrics = null) {
    const resolvedMetrics = metrics || getStepMetrics(step) || {};
    const cachedEstimate = getCachedStepEstimate(step);
    const hasUsageInput = resolvedMetrics.inputTokens !== null && resolvedMetrics.inputTokens !== undefined;
    const hasUsageOutput = resolvedMetrics.outputTokens !== null && resolvedMetrics.outputTokens !== undefined;
    const response = getStepResponse(step);

    return {
        inputTokens: hasUsageInput
            ? resolvedMetrics.inputTokens
            : cachedEstimate?.inputTokens ?? estimateTokens(step?.request),
        outputTokens: hasUsageOutput
            ? resolvedMetrics.outputTokens
            : cachedEstimate?.outputTokens ?? estimateTokens(response),
        inputSource: hasUsageInput ? 'usage' : (cachedEstimate?.inputSource || 'heuristic'),
        outputSource: hasUsageOutput ? 'usage' : (cachedEstimate?.outputSource || 'heuristic'),
    };
}

function getTokenSourceLabel(source) {
    if (source === 'usage') return 'API usage 真值';
    if (source === 'official-deepseek') return 'DeepSeek 官方 tokenizer 估算';
    if (source === 'official-deepseek-with-tools') return 'DeepSeek 官方模板 + tools JSON 估算';
    if (source === 'mixed') return '混合来源估算';
    return '长度/4 兜底估算';
}

function updateStepTokenBadge(node, inputTokens, outputTokens, inputSource, outputSource) {
    if (!node) return;
    node.textContent = `${formatNumber(inputTokens)}/${formatNumber(outputTokens)}`;
    node.dataset.inputSource = inputSource || 'heuristic';
    node.dataset.outputSource = outputSource || 'heuristic';
    node.title = `IN: ${getTokenSourceLabel(node.dataset.inputSource)}\nOUT: ${getTokenSourceLabel(node.dataset.outputSource)}`;
}

function scheduleOfficialStepEstimate(step, metrics, node, renderGeneration) {
    const tokenEstimateService = window.tokenEstimateService;
    if (!node || !tokenEstimateService || typeof tokenEstimateService.estimateStep !== 'function') return;
    const cachedBefore = getCachedStepEstimate(step);

    Promise.resolve(tokenEstimateService.estimateStep(step))
        .then(result => {
            if (!result || !document.contains(node)) return;
            if (node.dataset.renderGeneration !== String(renderGeneration)) return;

            const hasUsageInput = metrics.inputTokens !== null && metrics.inputTokens !== undefined;
            const hasUsageOutput = metrics.outputTokens !== null && metrics.outputTokens !== undefined;
            const inputTokens = hasUsageInput ? metrics.inputTokens : result.inputTokens;
            const outputTokens = hasUsageOutput ? metrics.outputTokens : result.outputTokens;
            const inputSource = hasUsageInput ? 'usage' : (result.inputSource || result.source || 'heuristic');
            const outputSource = hasUsageOutput ? 'usage' : (result.outputSource || result.source || 'heuristic');

            updateStepTokenBadge(node, inputTokens, outputTokens, inputSource, outputSource);

            const cachedAfter = getCachedStepEstimate(step);
            if (
                !cachedBefore &&
                cachedAfter &&
                (cachedAfter.inputSource !== 'heuristic' || cachedAfter.outputSource !== 'heuristic')
            ) {
                queueTokenEstimateRefresh();
            }
        })
        .catch(error => {
            console.warn('[DebugUI] step token estimate failed:', error);
        });
}

function queueTokenEstimateRefresh() {
    if (_stepTokenRefreshQueued) return;
    _stepTokenRefreshQueued = true;

    const scheduler = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : callback => setTimeout(callback, 0);

    scheduler(() => {
        _stepTokenRefreshQueued = false;
        refreshDebugContent();
    });
}

function getStepOutputText(step, response) {
    if (typeof step?.responseText === 'string' && step.responseText.trim()) {
        return step.responseText.trim();
    }
    if (typeof step?.responseBody?.text === 'string' && step.responseBody.text.trim()) {
        return step.responseBody.text.trim();
    }
    return extractOutputText(response, step?.provider);
}

function getStepReasoningText(step, response) {
    if (typeof step?.responseBody?.reasoningContent === 'string' && step.responseBody.reasoningContent.trim()) {
        return step.responseBody.reasoningContent.trim();
    }
    if (typeof response?.reasoningContent === 'string' && response.reasoningContent.trim()) {
        return response.reasoningContent.trim();
    }
    if (typeof response?.choices?.[0]?.message?.reasoning_content === 'string') {
        return response.choices[0].message.reasoning_content;
    }
    return null;
}

function extractOutputText(response, _provider) {
    if (!response) return null;
    if (typeof response === 'string') return response;
    if (typeof response.text === 'string') return response.text;
    if (response.candidates) {
        const parts = response.candidates?.[0]?.content?.parts || [];
        const textPart = parts.find(p => p.text);
        return textPart?.text || null;
    }
    if (response.choices) {
        return response.choices?.[0]?.message?.content || null;
    }
    if (response.content && Array.isArray(response.content)) {
        const textBlocks = response.content.filter(b => b.type === 'text');
        if (textBlocks.length > 0) return textBlocks.map(b => b.text).join('\n');
    }
    return null;
}

function extractToolCalls(response) {
    if (!response) return [];
    if (Array.isArray(response.toolCalls)) {
        return response.toolCalls.map(tc => ({ name: tc.name, args: tc.args }));
    }
    if (response.candidates) {
        const parts = response.candidates?.[0]?.content?.parts || [];
        return parts.filter(p => p.functionCall).map(p => ({ name: p.functionCall.name, args: p.functionCall.args }));
    }
    if (response.choices) {
        const toolCalls = response.choices?.[0]?.message?.tool_calls || [];
        return toolCalls.map(tc => ({
            name: tc.function?.name,
            args: tc.function?.arguments ? (() => { try { return JSON.parse(tc.function.arguments); } catch { return tc.function.arguments; } })() : {}
        }));
    }
    if (response.content && Array.isArray(response.content)) {
        return response.content.filter(b => b.type === 'tool_use').map(b => ({ name: b.name, args: b.input }));
    }
    return [];
}

function getRuntimeWorldDebugStatus() {
    const meta = (typeof window !== 'undefined') ? window.worldMeta : null;
    if (!meta) return null;

    const worldCount = window.entityStore?.list?.()?.length || 0;
    const modules = meta.listRuleModules?.() || [];
    const moduleCount = modules.length;
    const characterCount = window.npcStore?.hasCharacterDatabase?.() ? Object.keys(window.npcStore.getCharacterDatabase()).length : 0;
    const timelineCount = window.timelineStore?.hasEvents?.() ? window.timelineStore.getEvents().length : 0;

    return { hasActiveSnapshot: true, worldCount, moduleCount, characterCount, timelineCount };
}

function estimateTokens(obj) {
    if (!obj) return 0;
    const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
    return Math.ceil(str.length / 4);
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ══════════════════════════════════════════════
// Export
// ══════════════════════════════════════════════
window.setupDebugUI = setupDebugUI;
window.getDebugPayloadSnapshot = getDebugPayloadSnapshot;
