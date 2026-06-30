/**
 * js/services/p3/p3PatchEngine.js
 *
 * Phase 3 patch 引擎：
 * - 用 fast-json-patch (RFC 6902) 应用 patch
 * - test op 失败 → 整组回滚（乐观锁）
 * - undo 栈：50 步内存（每次 apply 前压一份 designConfig 整张快照）
 * - per-op partial selection 由调用方传 selectedOps 数组实现
 *
 * 依赖：window.jsonpatch（fast-json-patch UMD，CDN 在 index.html 加载）
 */

(function () {
  'use strict';

  const UNDO_STACK_MAX = 50;

  class P3PatchEngine {
    constructor() {
      this.undoStack = []; // 每项 = 应用前的整张 designConfig JSON 快照（deep clone）
    }

    /**
     * 是否能 undo
     */
    canUndo() {
      return this.undoStack.length > 0;
    }

    undoCount() {
      return this.undoStack.length;
    }

    /**
     * 取栈顶（peek），不 pop。
     */
    peek() {
      return this.undoStack[this.undoStack.length - 1] || null;
    }

    /**
     * Undo 一步：弹栈、把快照写回 designConfig，并通知 design service / preview。
     * @param {object} designService
     * @returns {boolean} 是否成功 undo
     */
    undoOnce(designService) {
      if (!designService) return false;
      const snapshot = this.undoStack.pop();
      if (snapshot == null) return false;
      try {
        designService.designConfig = JSON.parse(snapshot);
      } catch (e) {
        console.error('[P3PatchEngine] undo failed: snapshot parse error', e);
        return false;
      }
      try { designService._saveDesignConfig?.({ skipIndicator: true }); } catch (_) {}
      try { designService._updatePreviewPanel?.(); } catch (_) {}
      return true;
    }

    /**
     * 清空 undo 栈（切卡 / 退出 P3 / 主动重置时调）。
     */
    clear() {
      this.undoStack = [];
    }

    /**
     * 应用一组 patch op 到 designConfig。
     *
     * @param {object} designService
     * @param {Array<{op:string,path:string,value?:any,from?:string}>} selectedOps
     * @returns {{
     *   ok: boolean,
     *   error?: string,
     *   isTestFail?: boolean,
     *   appliedCount?: number,
     * }}
     */
    apply(designService, selectedOps) {
      if (!Array.isArray(selectedOps) || selectedOps.length === 0) {
        return { ok: false, error: 'no ops to apply' };
      }
      if (!window.jsonpatch || typeof window.jsonpatch.applyPatch !== 'function') {
        return { ok: false, error: 'fast-json-patch 未加载（检查 index.html CDN）' };
      }
      if (!designService) return { ok: false, error: 'designService 未传入' };

      const before = designService.designConfig || {};
      let beforeJson;
      try {
        beforeJson = JSON.stringify(before);
      } catch (e) {
        return { ok: false, error: `当前 designConfig 序列化失败：${e?.message || e}` };
      }

      let currentDoc;
      try {
        currentDoc = JSON.parse(beforeJson);
      } catch (e) {
        return { ok: false, error: `当前 designConfig 解析失败：${e?.message || e}` };
      }

      let newDocument;
      try {
        // fast-json-patch: applyPatch(doc, patch, validate=true) 返回 { newDocument, results }
        const result = window.jsonpatch.applyPatch(currentDoc, selectedOps, /*validate*/ true, /*mutateDocument*/ true);
        newDocument = result.newDocument;
      } catch (err) {
        const msg = String(err?.message || err);
        const isTestFail = /test/i.test(msg) && /failed/i.test(msg);
        return { ok: false, error: msg, isTestFail };
      }

      // 防御：根级 remove/replace 等会让 newDocument 变 null/非对象——决不写回
      // （否则 designConfig=null 当场打挂 _updatePreviewPanel / _saveDesignConfig 草稿落盘）。
      if (!newDocument || typeof newDocument !== 'object' || Array.isArray(newDocument)) {
        return { ok: false, error: 'patch 结果不是合法的世界卡对象（疑似根级 remove/replace），已拒绝应用' };
      }

      // 入 undo 栈（应用前的快照）
      this._push(beforeJson);

      // 写回 designConfig
      designService.designConfig = newDocument;
      try { designService._saveDesignConfig?.({ skipIndicator: true }); } catch (_) {}
      try { designService._updatePreviewPanel?.(); } catch (_) {}

      return { ok: true, appliedCount: selectedOps.length };
    }

    /**
     * 不直接执行 patch、只读取 path 处当前值（diff 视图老值用）。
     * @returns {*} undefined 表示 path 不存在
     */
    static getValueByPointer(doc, pointer) {
      if (!window.jsonpatch?.getValueByPointer) return undefined;
      try {
        return window.jsonpatch.getValueByPointer(doc, pointer);
      } catch {
        return undefined;
      }
    }

    _push(snapshotJson) {
      this.undoStack.push(snapshotJson);
      while (this.undoStack.length > UNDO_STACK_MAX) {
        this.undoStack.shift();
      }
    }
  }

  window.P3PatchEngine = P3PatchEngine;
})();
