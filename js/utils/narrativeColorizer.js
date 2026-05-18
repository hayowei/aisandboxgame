/**
 * narrativeColorizer.js — 叙事文字着色模块
 *
 * 自动识别故事文本中的对话、心理活动、说话人等并用不同颜色渲染。
 * 通过 localStorage 'narrative-colorize' 开关控制，默认关闭。
 */
(function () {
  'use strict';

  // 着色规则：优先级从高到低
  // 说话人：中文名 + 可选动词 + 冒号（后接引号）
  var SPEAKER_RE = /([\u4e00-\u9fff]{1,6}[说道喊叫问答笑哭嘟嚷吼]?[：:])(?=\s*[「"\u201c'])/g;
  // 对话：「」 "" "" ''
  var DIALOGUE_RE = /([「\u300c].*?[」\u300d]|[\u201c"].*?[\u201d"]|[\u2018'].*?[\u2019'])/g;
  // 心理活动：（）()
  var THOUGHT_RE = /([（(].*?[）)])/g;

  /**
   * 对单个文本节点内容应用着色规则，返回带 <span> 的 HTML 片段。
   * 如果没有任何匹配，返回 null 表示无需替换。
   */
  function colorizeTextContent(text) {
    if (!text || !text.trim()) return null;

    // 合并所有匹配项，记录位置和类型
    var matches = [];

    function collect(re, cls) {
      re.lastIndex = 0;
      var m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, cls: cls, text: m[0] });
      }
    }

    collect(SPEAKER_RE, 'narrative-speaker');
    collect(DIALOGUE_RE, 'narrative-dialogue');
    collect(THOUGHT_RE, 'narrative-thought');

    if (matches.length === 0) return null;

    // 按起始位置排序
    matches.sort(function (a, b) {
      return a.start - b.start;
    });

    // 去除重叠：保留先出现的（优先级已通过 collect 顺序体现）
    var filtered = [];
    var lastEnd = 0;
    for (var i = 0; i < matches.length; i++) {
      if (matches[i].start >= lastEnd) {
        filtered.push(matches[i]);
        lastEnd = matches[i].end;
      }
    }

    // 构建 HTML 片段
    var result = '';
    var cursor = 0;
    for (var j = 0; j < filtered.length; j++) {
      var seg = filtered[j];
      if (seg.start > cursor) {
        result += escapeHtml(text.substring(cursor, seg.start));
      }
      result += '<span class="' + seg.cls + '">' + escapeHtml(seg.text) + '</span>';
      cursor = seg.end;
    }
    if (cursor < text.length) {
      result += escapeHtml(text.substring(cursor));
    }

    return result;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * 主入口：对已经 sanitize 过的 HTML 字符串进行叙事着色。
   * 使用 DOM TreeWalker 安全地只处理文本节点。
   */
  function colorize(html) {
    if (!html || typeof html !== 'string') return html;

    // 开关检查：默认关闭
    if (localStorage.getItem('narrative-colorize') !== 'on') return html;

    var container = document.createElement('div');
    container.innerHTML = html;

    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var textNodes = [];
    var node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    for (var i = 0; i < textNodes.length; i++) {
      var textNode = textNodes[i];
      var colored = colorizeTextContent(textNode.textContent);
      if (colored !== null) {
        var span = document.createElement('span');
        span.innerHTML = colored;
        textNode.parentNode.replaceChild(span, textNode);
      }
    }

    return container.innerHTML;
  }

  window.narrativeColorizer = {
    colorize: colorize,
  };
})();
