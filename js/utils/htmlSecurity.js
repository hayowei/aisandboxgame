/**
 * htmlSecurity.js — 统一安全渲染层
 *
 * 所有 HTML 渲染入口都应经由此模块，禁止直接使用 marked.parse + innerHTML。
 * 依赖: marked (UMD), DOMPurify (UMD) — 必须在本文件之前加载。
 */
(function () {
  'use strict';

  const PURIFY_CONFIG = {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'del',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'span',
      'div',
      'sub',
      'sup',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'id'],
    ALLOW_DATA_ATTR: false,
  };

  function escapeText(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function sanitizeHTML(html) {
    if (typeof html !== 'string') return '';
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(html, PURIFY_CONFIG);
    }
    // Fallback: strip all tags
    return escapeText(html);
  }

  // 初始化 marked 配置（仅执行一次）
  if (typeof marked !== 'undefined') {
    marked.setOptions({ breaks: true, gfm: true });
  }

  function markdownToSafeHtml(markdown) {
    if (typeof markdown !== 'string' || !markdown.trim()) return '';
    let raw;
    if (typeof marked !== 'undefined') {
      raw = marked.parse(markdown);
    } else {
      raw = escapeText(markdown).replace(/\n/g, '<br>');
    }
    let safe = sanitizeHTML(raw);
    if (window.narrativeColorizer) {
      safe = window.narrativeColorizer.colorize(safe);
    }
    return safe;
  }

  function plainTextToSafeHtml(text) {
    if (typeof text !== 'string') return '';
    return escapeText(text).replace(/\n/g, '<br>');
  }

  window.htmlSecurity = {
    escapeText: escapeText,
    sanitizeHTML: sanitizeHTML,
    markdownToSafeHtml: markdownToSafeHtml,
    plainTextToSafeHtml: plainTextToSafeHtml,
  };
})();
