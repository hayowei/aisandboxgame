// ============================================
// Compute Tools — 判定/计算类工具
// ============================================
// get_roll — 通用检定（general-check MVP）：引擎掷一颗真随机 d20、引擎判定成败，
// 结果作为 AI 改不了的硬事实回写（verdict 祈使句，类比 itemTools 的 [失败] 文案）。
//
// 随机源铁律（内部设计文档 §5.0）：随机源只有硬币 + 一颗 1d20，
// 最细 5% 一档，每次判定只掷一次。此工具只产出"成/败"硬事实，不掷伤害骰、不优势劣势、
// 无自动暴击/大失败。
//
// 接入：AI 在 checkpoint 里声明 type='check' + next_tool='get_roll'（主路径在 iter1
// 起笔段声明，iter5 执行掷骰拿到结果，iter6 续写承接结果——与 hidden_state 同款 latch
// 通道，react.js 主循环零改动）。execute 返回 JSON 字符串：既进 tool_result 给 AI 必须
// 承接，又经 signal 'roll:complete' 广播给掷骰报告 UI（明示点数）。

(function registerComputeTools() {
  const registry = window.toolRegistry;
  if (!registry) {
    console.warn('[computeTools] toolRegistry 未加载，跳过注册');
    return;
  }
  const register = window.registerToolWithPrompt || ((name, cfg) => registry.register(name, cfg));

  // 拒绝采样的真随机 d20：crypto.getRandomValues 取字节，丢弃 [240,255]（256 % 20 = 16），
  // 剩 [0,239] = 12×20 整除 → 每个点数概率恰好 1/20，消除朴素取模偏置，严守 5% 刻度。
  // crypto 不可用时降级 Math.random（仍均匀，仅密码学强度降低）。
  const _rollD20 = () => {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const buf = new Uint8Array(1);
        let r;
        do {
          crypto.getRandomValues(buf);
          r = buf[0];
        } while (r >= 240);
        return (r % 20) + 1;
      }
    } catch (_) {
      /* 落到下方降级 */
    }
    return Math.floor(Math.random() * 20) + 1;
  };

  // 玩家自定义四档难度（设置页写 localStorage['pzgm_tier_dc']）→ 拼进给 AI 的难度锚点话术。
  // ⚠️ 软建议：老 get_roll 路径里 DC 由 AI 自己填整数、引擎不强制；且此串在注册（页面加载）时求值
  // 一次，改设置需刷新页面才反映。真·硬生效在新 PZGM 引擎（config.tierDC → modEngine.resolveTierDC）。
  const _tierDcAnchors = () => {
    const def = { easy: 10, medium: 15, hard: 20, extreme: 25 };
    let m = {};
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('pzgm_tier_dc') : null;
      const o = JSON.parse(raw || '{}');
      if (o && typeof o === 'object') m = o;
    } catch (_) { /* 非法 → 全默认 */ }
    const g = (k) => {
      const v = Math.round(Number(m[k]));
      return Number.isInteger(v) ? Math.max(1, Math.min(30, v)) : def[k];
    };
    return `易 ${g('easy')} / 中 ${g('medium')} / 难 ${g('hard')} / 极难 ${g('extreme')}`;
  };

  register('get_roll', {
    phase: null,
    required: false,
    trigger: null,
    triggerHint: null,
    signal: 'roll:complete',
    description:
      '通用检定：掷一颗 d20 + 加值 对难度 DC，由引擎判定成功/失败。结果由引擎随机生成，AI 无法预知也无法改写——你只能在后续叙事里承接这个结果。用于玩家能力/技能/运气类、结果不确定的动作（撬锁、潜行、说服、攀爬、躲避、出手命中等）。一次判定只掷一次。',
    when_to_call:
      '当 checkpoint 声明了 type="check"、需要裁定一个由能力/技能/运气决定成败的动作时调用。',
    avoid_when:
      '物品/货币是否足够（用 update_item）；查隐藏世界事实（用 get_state / search_world）；结果已确定或纯叙事描写时；同一个动作已经掷过一次时（绝不为同一判定二次掷骰）。',
    input_focus:
      `reason 用一句话写清这次检定代表玩家的什么动作（给玩家看的语境）；dc 是你作为 GM 判断的难度（像人类 GM 设 DC：${_tierDcAnchors()}，1-30）；modifier 只放情境调整值（玩家明显的优势/劣势/装备加成，可正可负），没有就省略。`,
    expected_output:
      '返回 { d20, modifier, dc, total, success, verdict }。verdict 是你必须服从的硬事实：成功就写成功、失败就写失败（失败按 fail-forward 引入新麻烦），不得在叙事里翻盘。',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: '这次检定代表玩家的什么动作（一句话，给玩家看的语境，如"撬开生锈的铁锁"）',
        },
        dc: {
          type: 'integer',
          description: `难度阈值（1-30；GM 当人类 GM 设：${_tierDcAnchors()}）`,
          minimum: 1,
          maximum: 30,
        },
        modifier: {
          type: 'integer',
          description: '情境调整值（默认 0；玩家优势/装备加成为正，劣势/恶劣环境为负）。不要把 dc 重复塞进这里。',
        },
      },
      required: ['reason', 'dc'],
      additionalProperties: false,
    },
    execute(args) {
      try {
        const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
        if (!reason) return '[错误] get_roll 需要非空 reason';

        // dc 缺失/非法不抛错中断回合——clamp 到合法区间并继续（10 为中等默认）
        let dc = parseInt(args?.dc);
        if (!Number.isInteger(dc)) dc = 10;
        dc = Math.max(1, Math.min(30, dc));

        let modifier = parseInt(args?.modifier);
        if (!Number.isInteger(modifier)) modifier = 0;

        const d20 = _rollD20();
        const total = d20 + modifier;
        const success = total >= dc;

        const modStr = modifier === 0 ? '' : (modifier > 0 ? ` + ${modifier}` : ` − ${Math.abs(modifier)}`);
        const verdict = success
          ? `检定成功（掷出 ${d20}${modStr} = ${total} ≥ DC ${dc}）。这是已判定的硬事实——后续叙事必须叙述「成功」，不得改写为失败或未发生。`
          : `检定失败（掷出 ${d20}${modStr} = ${total} < DC ${dc}）。这是已判定的硬事实——后续叙事必须叙述「失败」，并按 fail-forward 让失败推动剧情（引入新麻烦/代价/岔路；高风险动作失败可致命）；不得改写为成功。`;

        // return 字符串既写进 tool_result 给 AI（硬事实），又经 signal 'roll:complete'
        // 被引擎 JSON.parse 后广播给掷骰报告 UI（明示点数）。见 prompt-gm.js 工具执行后 emit。
        return JSON.stringify({
          tool: 'get_roll',
          reason,
          d20,
          modifier,
          dc,
          total,
          success,
          verdict,
        });
      } catch (e) {
        // 绝不抛错中断回合——兜底返回一个保守失败硬事实
        console.warn('[get_roll] execute 异常，返回兜底失败:', e?.message || e);
        return JSON.stringify({
          tool: 'get_roll',
          reason: typeof args?.reason === 'string' ? args.reason : '',
          d20: 1,
          modifier: 0,
          dc: 20,
          total: 1,
          success: false,
          verdict: '检定失败（系统兜底）。后续叙事按失败处理，并按 fail-forward 推动剧情。',
        });
      }
    },
    source: 'compute',
  });

  console.log('[computeTools] 已注册 get_roll 工具');
})();
