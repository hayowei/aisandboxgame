/**
 * designmode.js
 * 设计模式提示词残卷（2026-06-10 PZWC 替换 P1/P2 后）
 *
 * 老 P1（框架采集 FSM）/ P2（四阶段串行生成）的全部提示词已随流程拆除——
 * 世界卡生成现在由 PZWC 引擎承担（内部内核，提示词 = systemPrompt + schema.md +
 * craft-guide.md，esbuild 打进 dist/pzwc-engine.js 岛）。
 * Phase 3 提示词一直在 prompts/p3SystemPrompt.js / p3SchemaDoc.js 独立维护。
 *
 * 仅存导出：
 * 1. PHASE1_GREETING — 设计模式欢迎语（保留历史符号名；import-export / promptBootstrap /
 *    design/utils 的 _getDesignPromptValue 仍按这个名字读取，EN 版在 i18n_prompts.js）
 */

const PHASE1_GREETING = `欢迎来到世界卡设计工坊。
在这里，你可以设计一张属于自己的世界卡。我会一步步引导你——先确立一个大的方向，再围绕它逐层展开。
不妨先告诉我，你想从哪个角度出发？`;
