// prompts/[Fixed]template.js
// design_config 模板文档生成函数

/**
 * 生成 design_config 创建指南 Markdown
 * @param {Object} data
 * @param {string} data.date 导出日期
 * @param {string} data.jsonExample design_config JSON 示例
 * @returns {string}
 */
window.generateWorldGuide = function (data) {
  const { date, jsonExample } = data;

  return `# 🎨 Design Config 创建指南

> 导出日期：${date}

---

## 一、目标

本模板只用于创建 **\`design_config.json\`**。

该文件用于设计模式下的世界构建与应用，不再包含旧的废弃配置体系内容。

---

## 二、使用方式

1. 在设计模式中点击输入栏左下角“上传文档”。
2. 上传你的 \`design_config.json\`。
3. 发送给设计助手，由系统进行配置审计与框架整理。
4. 进入自动生成与审阅编辑流程，最终点击“应用到游戏”。

---

## 三、文件结构

\`design_config.json\` 由以下 4 个顶层字段组成（按需提供）：

\`\`\`
design_config.json
├── world_setting.settings    世界设定（每个势力/区域一个条目）
├── prompt_modules            规则与引擎配置
├── character_database        角色数据库（可选）
└── timeline.events           历史事件（可选）
\`\`\`

---

## 四、字段说明

### 1) world_setting.settings

- 类型：object
- key：势力/区域 ID（建议 snake_case）
- value：Markdown 文本设定

建议覆盖：地理、历史、社会结构、经济生态、当前局势。

### 2) prompt_modules

- \`modules\`：规则模块字典（如 init/economy/combat 等）
- \`step3_schema\`：Step3 输出结构 Schema
- \`system_prompt_addon\`：Step2 附加规则
- \`greeting\`：开场白
- \`init_module\`：首轮初始化规则

### 3) character_database（可选）

- 类型：object
- key：角色唯一 ID
- value：角色档案对象（字段可扩展）

### 4) timeline.events（可选）

- 类型：array
- 每个元素是一条历史事件
- 建议包含：time、location、characters、content

---

## 五、一致性检查清单

- [ ] \`character_database\` 中的角色归属与 \`world_setting.settings\` 一致。
- [ ] \`timeline.events\` 中引用的角色与地点在前述字段中可对应。
- [ ] \`prompt_modules.modules\` 的规则术语与世界设定一致。
- [ ] \`step3_schema\` 与你希望渲染的 UI 数据结构一致。

---

## 六、完整示例

\`\`\`json
${jsonExample}
\`\`\`

---

## 七、注意事项

1. 这是 design_config 专用模板，不包含历史废弃字段。
2. 字段允许渐进迭代，可先提交最小可用版本再逐步补全。
3. 文本建议用清晰的 Markdown 编写，便于后续生成与审阅。
`;
};
