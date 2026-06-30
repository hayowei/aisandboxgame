// 剧情模式 GM 大脑选择 —— 'react'（旧 react.js iter1–9）| 'pzgm'（PZGM 引擎岛）。
//
// 【按局选择，非全局开关】每个游戏记住自己用哪个大脑：
//   - 新游戏 → 'pzgm'（新大脑，sessionManager.startNewGame 调 selectForNewGame）。
//   - 读档 → 看存档里有没有 PZGM 引擎数据（saveData.pzgmState）：有→'pzgm'，没有→'react'（老 react 存档
//     继续用旧大脑、不被打断，sessionManager.loadGame 调 selectForSave）。
// 这样「新游戏走新大脑、老存档继续走旧的」——切换不打断任何正在玩的老局。
// isPzgm() 额外要求引擎岛 + 控制器都已加载，缺任一则安全回落 react（岛加载失败也不崩）。
//
// 选择落在 localStorage（单一真源，记住「当前这局」用哪个）；dev 仍可控制台 `StoryEngineFlag.set('react'|'pzgm')`
// 临时强切（下次新游戏/读档会被 select* 覆盖回该局应有的大脑）。顶层只暴露 window.StoryEngineFlag。

(function () {
  'use strict';
  const KEY = 'pzgm_story_engine';

  function get() {
    try {
      return localStorage.getItem(KEY) === 'pzgm' ? 'pzgm' : 'react';
    } catch (_) {
      return 'react';
    }
  }

  function set(v) {
    const next = v === 'pzgm' ? 'pzgm' : 'react';
    try {
      localStorage.setItem(KEY, next);
    } catch (_) {
      /* ignore */
    }
    // 大脑选择变化 → 骰子栏可见性要重判（开新游戏 selectForNewGame / 读档 selectForSave / dev 切换都经此）。
    // 派发事件而非直接调 UI，保持 config→UI 解耦；pzgmDiceBar 监听后延迟 render（让 enterGame 先切到游戏屏再渲染）。
    try { window.eventBus?.emit?.('story-engine:changed', { engine: next }); } catch (_) {}
  }

  function isPzgm() {
    return get() === 'pzgm' && !!window.pzgmEngine && !!window.pzgmStoryController;
  }

  // 新游戏 → 新大脑（PZGM）。
  function selectForNewGame() {
    set('pzgm');
  }

  // 读档 → 按存档内容选：有 PZGM 引擎数据（pzgmState.current 或 history）= pzgm 局；否则 = 老 react 局。
  // 老 react 存档（无 pzgmState）继续用旧大脑，读档不被打断。
  function selectForSave(saveData) {
    try {
      const ps = saveData && saveData.pzgmState;
      // 有引擎快照（current/history）或显式引擎标记（engine:'pzgm'，新建未玩的 PZGM 存档靠它）= 继续用新大脑；
      // 三者皆无 = 老 react 存档，继续用旧大脑、读档不被打断（新大脑读不懂老存档，强切会把老局打回开头）。
      const hasPzgm = !!(ps && (ps.engine === 'pzgm' || ps.current || (Array.isArray(ps.history) && ps.history.length)));
      set(hasPzgm ? 'pzgm' : 'react');
    } catch (_) {
      set('react');
    }
  }

  window.StoryEngineFlag = { get, set, isPzgm, selectForNewGame, selectForSave };
})();
