// ============================================
// 地点三段式工具（host 侧唯一真源）
// ============================================
// 标准 §2.1（内部设计文档）：所有地点 = { country, site, spot } 三段，
// 缺段用保留值 '未知'（显示"未知"、匹配时当通配），缺只能从右往左连续地缺。
//
// ⚠️ 引擎（内部内核 + canonical 内部目录 JS 的 npcEngine.js）内有一份【逐字对齐】的
//    等价实现（normLoc/locMatch/toTriad/formatTriad）——两个 bundle 无法共享代码，改这里
//    必须同步改引擎那份，哨兵恒 '未知'、匹配规则一致（单一真源·被迫双份，见 plan 红线 3）。
//
// 哨兵 = 字符串 '未知'（与 chatCore 玩家侧形状审查 chatCore.js:2140、panelSchemaBuilder
//   prompt 提示一致）。比对复用 entityStore.normalizeLocationForCompare（三段各 resolveCanonicalKey）。
// ============================================

const LOC_UNKNOWN = '未知';

const locationTriad = {
  UNKNOWN: LOC_UNKNOWN,

  /**
   * 字符串/对象 → 规范三段对象 { country, site, spot }。
   * - 对象：取三段，缺段从右往左补 '未知'（country 缺则整体未知；site 缺则 site+spot 未知）。
   * - 字符串升格：旧档自由文本位置 / AI 漏写对象 / 旧引擎 "site > spot" 串 → 当最具体的 spot，
   *   country/site 填 '未知'。这是 V1 兼容 + 过渡兜底，绝不丢值、绝不报错。
   * - 空/异常 → 全 '未知'。
   */
  toTriad(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const seg = k => (typeof v[k] === 'string' && v[k].trim() ? v[k].trim() : '');
      const country = seg('country');
      let site = seg('site');
      let spot = seg('spot');
      if (!country) return { country: LOC_UNKNOWN, site: LOC_UNKNOWN, spot: LOC_UNKNOWN };
      if (!site) { site = LOC_UNKNOWN; spot = LOC_UNKNOWN; }
      else if (!spot) { spot = LOC_UNKNOWN; }
      return { country, site, spot };
    }
    if (typeof v === 'string' && v.trim()) {
      const str = v.trim();
      // 多段串升格：旧引擎 "site > spot"、老档/旧 AI 自由文本常写成 "A·B·C"、"A / B / C"。
      // 按常见地点分隔符切，映射三段（≥3 段→country/site/spot；2 段→site/spot；1 段→spot），
      // 统一显示 + 让老档也能逐段匹配。不含 '-'（避免切断带连字符的名字）。
      const parts = str.split(/\s*[·・‧/>、]\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 3) return { country: parts[0], site: parts[1], spot: parts.slice(2).join(' ') };
      if (parts.length === 2) return { country: LOC_UNKNOWN, site: parts[0], spot: parts[1] };
      return { country: LOC_UNKNOWN, site: LOC_UNKNOWN, spot: parts[0] || str };
    }
    return { country: LOC_UNKNOWN, site: LOC_UNKNOWN, spot: LOC_UNKNOWN };
  },

  /** 显示：非 '未知' 段用 ' - ' 连；全未知显 '未知'。仿主角 _formatHeroLocation。 */
  formatTriad(v) {
    const t = this.toTriad(v);
    const parts = [t.country, t.site, t.spot].filter(s => s && s !== LOC_UNKNOWN);
    return parts.length ? parts.join(' - ') : LOC_UNKNOWN;
  },

  /**
   * 逐段 + 通配匹配："同处一地"判定。
   * 规则：把两边都【已知】（非 '未知'、非空）的每一段都比一遍——任一段不等 → 不同处；
   * 至少有一段两边都已知且全部相等 → 同处；没有任何一段两边都已知（一方信息太少）→ false。
   * '未知' 当通配（不参与比，也不单独构成"同处"）。绝不按整串字面比。
   */
  triadMatch(a, b) {
    const norm = loc => {
      const t = this.toTriad(loc);
      if (window.entityStore && typeof window.entityStore.normalizeLocationForCompare === 'function') {
        // entity id/名 → canonical（'未知'/空原样返回）
        return window.entityStore.normalizeLocationForCompare(t);
      }
      return t;
    };
    const na = norm(a), nb = norm(b);
    const known = (x, k) => !!x[k] && x[k] !== LOC_UNKNOWN;
    let comparedAny = false;
    for (const k of ['country', 'site', 'spot']) {
      if (known(na, k) && known(nb, k)) {
        comparedAny = true;
        if (na[k] !== nb[k]) return false; // 任一两边都已知的段不等 → 不同处
      }
    }
    return comparedAny; // 有共同已知段且全等 → 同处；无共同已知段 → false
  },

  // 事件地点（world_timeline event.location）→ 规范三段对象。
  // 新卡 = {country,site,spot} 对象 → 直接 toTriad；老卡 = LEFT-anchored 分隔串 "country / site / spot"
  //（含 '-' 分隔、country 在最左 —— 与 toTriad 处理裸串的 RIGHT-anchored 规则不同，故单列）。
  // 拆 ≤3 段、左起对齐、缺段从右补 '未知'。
  eventToTriad(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return this.toTriad(v);
    if (typeof v === 'string' && v.trim()) {
      const parts = v.split(/\s*(?:-|—|·|\/)\s*/).map(s => s.trim()).filter(Boolean);
      return this.toTriad({ country: parts[0] || '', site: parts[1] || '', spot: parts[2] || '' });
    }
    return this.toTriad(v); // null/空 → 全 '未知'
  },

  // 事件地点 → 显示串：entity id/名 解析成 display_name、跳过 '未知'、用 ' - ' 连；全未知 → ''。
  // 给 prompt / 搜索索引 / 显示 各处统一用，吃对象或老分隔串都行。
  formatEventLocation(v) {
    const t = this.eventToTriad(v);
    const eStore = (typeof window !== 'undefined') ? window.entityStore : null;
    const seg = s => {
      if (!s || s === LOC_UNKNOWN) return '';
      return (eStore && typeof eStore.resolveDisplayName === 'function') ? (eStore.resolveDisplayName(s) || s) : s;
    };
    return [seg(t.country), seg(t.site), seg(t.spot)].filter(Boolean).join(' - ');
  },
};

if (typeof window !== 'undefined') {
  window.locationTriad = locationTriad;
}
