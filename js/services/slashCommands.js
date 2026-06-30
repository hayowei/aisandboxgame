// js/services/slashCommands.js
// 斜杠命令框架（架子）：注册表 + 解析 + 分发。
// 玩家在输入框打 /xxx → 这里查表执行。第一个真命令是 /ooc（显式场外发言）。
// 未来的动作命令（/move <地点>、/sms <角色> <内容>）和工坊/mod 命令往这里 register 即可。
// 设计见 内部设计文档
//
// 命令定义形态：
//   { id, trigger, aliases?, group?, icon?,
//     labelZh, labelEn, descZh, descEn,
//     takesArgs?:bool, runOnSelect?:bool,
//     run(argsText, ctx) → { ooc:'<内容>' } | { handled:true } | null }

(function () {
  'use strict';

  const _commands = []; // 注册顺序即菜单显示顺序

  function isEnglish() {
    return window.i18nService?.getResolvedLanguage?.() === 'en';
  }

  // 命令层只在游戏模式生效；设计（世界卡）模式保留输入中字面斜杠。
  function _isDesignMode() {
    return typeof window.isDesignMode !== 'undefined' && window.isDesignMode === true;
  }

  // ───────────────────────────────────────────────────────────
  // 注册 / 查询
  // ───────────────────────────────────────────────────────────

  function register(def) {
    if (!def || !def.trigger) return;
    const trigger = String(def.trigger).toLowerCase();
    const normalized = {
      id: def.id || trigger,
      trigger,
      aliases: (def.aliases || []).map(a => String(a).toLowerCase()),
      group: def.group || '',
      icon: def.icon || 'chevron_right',
      labelZh: def.labelZh || ('/' + trigger),
      labelEn: def.labelEn || ('/' + trigger),
      descZh: def.descZh || '',
      descEn: def.descEn || '',
      takesArgs: def.takesArgs === true,
      runOnSelect: def.runOnSelect === true,
      run: typeof def.run === 'function' ? def.run : () => null,
    };
    const existing = _commands.findIndex(c => c.trigger === trigger);
    if (existing >= 0) _commands[existing] = normalized;
    else _commands.push(normalized);
  }

  function getAll() {
    return _commands.slice();
  }

  // 显示用标签 / 描述（按当前语言）
  function label(cmd) {
    return isEnglish() ? (cmd.labelEn || cmd.labelZh) : (cmd.labelZh || cmd.labelEn);
  }
  function desc(cmd) {
    return isEnglish() ? (cmd.descEn || cmd.descZh) : (cmd.descZh || cmd.descEn);
  }

  // 按命令名前缀过滤（给菜单用）。空 token → 全部。
  function match(partialToken) {
    const t = String(partialToken || '').toLowerCase();
    if (!t) return getAll();
    return _commands.filter(
      c => c.trigger.startsWith(t) || c.aliases.some(a => a.startsWith(t))
    );
  }

  function _find(trigger) {
    const t = String(trigger || '').toLowerCase();
    return _commands.find(c => c.trigger === t || c.aliases.includes(t)) || null;
  }

  // 解析输入文本 → { isCommand, trigger, args, command }
  //   命令形态：以 / 开头，第一段是 trigger，其余（去掉首个空白）是 args。
  function parse(text) {
    const raw = String(text || '');
    const m = raw.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) return { isCommand: false };
    const trigger = m[1].toLowerCase();
    const args = (m[2] || '').trim();
    return { isCommand: true, trigger, args, command: _find(trigger) };
  }

  // 分发（chatCore 在发送前调用）。返回：
  //   null              → 不是（已知）命令 → 按普通文本发送（未知 /xxx 也走这条，不吞）
  //   { handled:true }  → 命令已自行处理（开面板/设置等）→ 调用方清空输入并 return，不触发 AI 回合
  //   { ooc:'<内容>' }  → 路由到 OOC 流水线 → 调用方等价于玩家打了 【内容】
  function dispatch(text, ctx) {
    if (_isDesignMode()) return null;
    const parsed = parse(text);
    if (!parsed.isCommand || !parsed.command) return null;
    try {
      const result = parsed.command.run(parsed.args, ctx || {});
      return result || { handled: true };
    } catch (err) {
      console.warn('[slashCommands] 命令执行出错:', parsed.trigger, err);
      window.showToast?.(isEnglish() ? 'Command failed' : '命令执行失败');
      return { handled: true };
    }
  }

  window.slashCommands = { register, getAll, match, parse, dispatch, label, desc };

  // ═══════════════════════════════════════════════════════════
  // 内置命令注册
  // ═══════════════════════════════════════════════════════════

  // ── 核心：/ooc <内容> —— 显式场外发言 ──
  // 返回 { ooc } 后，chatCore 把它等价成玩家打 【内容】，完全复用现有括号 OOC 流水线
  //（子代理判定 → 必要时反问 → directive 注入），不引入任何新 OOC 语义。
  register({
    id: 'ooc',
    trigger: 'ooc',
    group: 'interact',
    icon: 'forum',
    labelZh: '/ooc　场外发言',
    labelEn: '/ooc',
    descZh: '对 AI 说一句场外话（跳出角色扮演，给出创作指示）',
    descEn: 'Speak to the AI out of character',
    takesArgs: true,
    run(argsText) {
      const content = String(argsText || '').trim();
      if (!content) {
        // 只打了 /ooc 没内容：给提示并保留输入框（让玩家接着打），不静默吞掉
        return {
          handled: true,
          keepInput: true,
          notice: isEnglish() ? 'Type your out-of-character note after /ooc' : '请在 /ooc 后输入要对 AI 说的话',
        };
      }
      return { ooc: content };
    },
  });

  // 目前只注册 /ooc 这一个命令。框架（register/parse/dispatch/match + 菜单）保留可扩展，
  // 未来要加动作命令（/move /sms 等）按上面 /ooc 的形态 register 即可。
})();
