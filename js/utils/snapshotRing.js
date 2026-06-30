// js/utils/snapshotRing.js
// 存档时间线「快照池」的纯数组操作（零浏览器依赖 → 可 headless 单测）。
// v2「自由跳转池」：身份 = chatUid（每次创建唯一；turn 仅作显示标签，回退后会重复）。
// 条目 = { turn, kind:'auto'|'manual', name?, savedAt, chatUid, stores, history }（history = 该回合为止的
// 自包含聊天记录，使读取后不依赖 live 历史）。读取/载入【永不删】快照；只有压入新自动点才淘汰：
// 非钉点超 cap 时挤掉 savedAt 最旧的非钉点（turn 顺序回退后无意义）。钉点不计 cap、永不被挤。
// chatCore 的 ring API 一律委托到这里，业务文件不再内联这套易错逻辑。
(function () {
  // 已提交的 AI 消息谓词（跳过错误/取消气泡）——身份/回退基定位的单一真源。
  function _isCommittedAi(m) {
    return !!(m && m.sender === 'ai' && m.uid && m.isError !== true && !m.errorMeta && m.isCancelled !== true);
  }

  // 压入一个自动快照：同 chatUid【就地替换】（回合内复核 re-push 对同一回合反复提交，不堆叠；替换时保留
  // 已有的钉点标记 pinned/name，savedAt 用新 entry 的以刷新最近度）。不同 chatUid（含回退后重玩出的同 turn）
  // = 新条目。之后若【非钉点】数超过 autoCap，逐个挤掉 savedAt 最旧的非钉点（相等按数组靠前，保证测试稳定）。
  function pushAuto(ring, entry, autoCap) {
    const out = Array.isArray(ring) ? ring.slice() : [];
    const existIdx =
      entry && entry.chatUid != null ? out.findIndex(s => s && s.chatUid === entry.chatUid) : -1;
    if (existIdx >= 0) {
      const prev = out[existIdx];
      out[existIdx] = prev && prev.pinned ? { ...entry, pinned: true, name: prev.name } : entry;
    } else {
      out.push(entry);
    }
    while (out.filter(s => s && !s.pinned).length > autoCap) {
      let oldestIdx = -1;
      let oldestAt = Infinity;
      for (let i = 0; i < out.length; i++) {
        const s = out[i];
        if (!s || s.pinned) continue;
        const at = Number.isFinite(s.savedAt) ? s.savedAt : 0;
        if (at < oldestAt) {
          oldestAt = at;
          oldestIdx = i;
        }
      }
      if (oldestIdx < 0) break;
      out.splice(oldestIdx, 1);
    }
    return out;
  }

  // 钉点 = 在【已有的那条快照】上打 pinned 标记（不新建条目）。pinned=false 取消钉点（清 pinned/name，
  // 条目回归普通自动点、继续受滚动驱逐管理）。
  function setPinned(ring, chatUid, pinned, name) {
    if (!Array.isArray(ring) || !chatUid) return Array.isArray(ring) ? ring.slice() : [];
    return ring.map(s => {
      if (!s || s.chatUid !== chatUid) return s;
      const next = { ...s };
      if (pinned) {
        next.pinned = true;
        if (name != null) next.name = String(name);
      } else {
        delete next.pinned;
        delete next.name;
      }
      return next;
    });
  }

  // 精确移走一条快照（删除/重生「只删被退掉的那一个」用；非破坏性截断，只动这一条）。
  function removeByChatUid(ring, chatUid) {
    if (!Array.isArray(ring) || !chatUid) return Array.isArray(ring) ? ring.slice() : [];
    return ring.filter(s => !(s && s.chatUid === chatUid));
  }

  // 按 chatUid 精确取一个快照。
  function byChatUid(ring, chatUid) {
    if (!Array.isArray(ring) || !chatUid) return null;
    return ring.find(s => s && s.chatUid === chatUid) || null;
  }

  // 游戏历史里最后一条已提交 AI 消息的 uid = 当前所在位置（"当前点"）。空/无 → null。
  function lastCommittedAiUid(history) {
    if (!Array.isArray(history)) return null;
    for (let i = history.length - 1; i >= 0; i--) {
      if (_isCommittedAi(history[i])) return history[i].uid;
    }
    return null;
  }

  // 回退基：删/重生回合 chatUid 要还原到它【上一条已提交 AI 消息】对应的快照（按传入 history 定位，
  // 不靠 turn——回退后 turn 会重复）。无（turn 1 / 上一条没快照）→ null。
  function prevAiSnapshot(ring, history, chatUid) {
    if (!Array.isArray(ring) || !Array.isArray(history) || !chatUid) return null;
    const idx = history.findIndex(m => m && m.uid === chatUid);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
      if (_isCommittedAi(history[i])) return byChatUid(ring, history[i].uid);
    }
    return null;
  }

  const API = {
    pushAuto,
    setPinned,
    removeByChatUid,
    byChatUid,
    lastCommittedAiUid,
    prevAiSnapshot,
    _isCommittedAi,
  };
  if (typeof window !== 'undefined') window.SnapshotRing = API;
})();
