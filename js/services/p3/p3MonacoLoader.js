/**
 * js/services/p3/p3MonacoLoader.js
 *
 * Monaco editor lazy-loader（CDN，仅 preview/code substage 用户点击「编辑/打开」
 * 才加载）。
 *
 * 用法：
 *   const monaco = await window.P3MonacoLoader.load();
 *   const editor = monaco.editor.create(host, {...});
 *
 * 失败兜底：load() reject → 调用方降级回 textarea 模式（design/ui.js 现有 code
 * 面板会兜底展示纯文本编辑器 + 提示「编辑器加载失败」）。
 */

(function () {
  'use strict';

  const MONACO_VERSION = '0.45.0';
  const LOADER_URL =
    `https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/${MONACO_VERSION}/min/vs/loader.min.js`;
  const VS_PATH =
    `https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/${MONACO_VERSION}/min/vs`;

  let _monacoPromise = null;

  function _loadScript(src) {
    return new Promise((resolve, reject) => {
      // 已加载？
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        // 移除失败的 <script>，否则下次 _loadScript 会因 querySelector 命中死标签而误判「已加载」、
        // 直接 resolve 但 window.require 仍缺失 → 报错，永久阻断重试（load() 的 _monacoPromise 重置就失效了）。
        s.remove();
        reject(new Error(`Failed to load script: ${src}`));
      };
      document.head.appendChild(s);
    });
  }

  async function load() {
    if (window.monaco) return window.monaco;
    if (_monacoPromise) return _monacoPromise;

    _monacoPromise = (async () => {
      // 1. 加载 vs/loader.min.js（提供全局 require）
      if (!window.require || typeof window.require.config !== 'function') {
        await _loadScript(LOADER_URL);
      }
      if (!window.require || typeof window.require.config !== 'function') {
        throw new Error('Monaco loader script 未注入 require');
      }
      window.require.config({ paths: { vs: VS_PATH } });

      // 2. 用 AMD-style require 加载 editor.main
      await new Promise((resolve, reject) => {
        try {
          window.require(['vs/editor/editor.main'], () => resolve(), (err) => reject(err));
        } catch (e) {
          reject(e);
        }
      });

      if (!window.monaco) throw new Error('Monaco editor.main 加载完成但 window.monaco 未就绪');
      return window.monaco;
    })().catch((err) => {
      // 失败重置 promise，让下次调用可重试
      _monacoPromise = null;
      throw err;
    });

    return _monacoPromise;
  }

  function isReady() {
    return !!window.monaco;
  }

  window.P3MonacoLoader = { load, isReady };
})();
