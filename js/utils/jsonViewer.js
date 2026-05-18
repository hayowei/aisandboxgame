/**
 * jsonViewer.js
 * A lightweight, vanilla JS JSON tree viewer.
 * Supports custom renderers for specific keys or values.
 */

class JsonViewer {
  constructor(options = {}) {
    this.options = {
      theme: 'dark', // 'dark' or 'light'
      indentSize: 20, // pixels
      initialDepth: 1, // depth to expand initially
      maxDepth: 50, // max depth to prevent infinite recursion
      customRenderers: [], // array of { test: (key, value) => bool, render: (key, value) => HTMLElement }
      ...options,
    };
    this.container = document.createElement('div');
    this.container.className = `json-viewer theme-${this.options.theme}`;
  }

  /**
   * Renders the JSON data into the container.
   * @param {any} data - The JSON data to render.
   * @returns {HTMLElement} - The container element.
   */
  render(data) {
    this.container.innerHTML = '';
    const tree = this._createNode(null, data, 0);
    this.container.appendChild(tree);
    return this.container;
  }

  /**
   * Internal method to create a tree node.
   * @param {string|null} key
   * @param {any} value
   * @param {number} depth
   * @param {boolean} skipCustom - Skip custom renderers (used for raw JSON fallback inside custom renderers)
   */
  _createNode(key, value, depth, skipCustom = false) {
    if (depth > this.options.maxDepth) {
      const el = document.createElement('div');
      el.className = 'jv-item';
      el.textContent = '... (Max Depth Reached)';
      el.style.marginLeft = `${this.options.indentSize}px`;
      return el;
    }

    // Check for custom renderers first (unless skipped)
    if (!skipCustom) {
      for (const renderer of this.options.customRenderers) {
        if (renderer.test(key, value)) {
          const customEl = renderer.render(key, value);
          if (customEl) return customEl;
        }
      }
    }

    const type = this._getType(value);
    const element = document.createElement('div');
    element.className = 'jv-node';
    element.style.marginLeft = depth === 0 ? '0' : `${this.options.indentSize}px`;

    if (type === 'object' || type === 'array') {
      return this._createCollapsibleNode(key, value, type, depth);
    } else {
      return this._createSimpleNode(key, value, type);
    }
  }

  _createCollapsibleNode(key, value, type, depth) {
    const details = document.createElement('details');
    details.className = 'jv-details';

    // Initial expansion logic
    if (depth < this.options.initialDepth) {
      details.open = true;
    }

    const summary = document.createElement('summary');
    summary.className = 'jv-summary';

    // Key (if exists)
    if (key !== null) {
      const keySpan = document.createElement('span');
      keySpan.className = 'jv-key';
      keySpan.textContent = `${key}: `;
      summary.appendChild(keySpan);
    }

    // Preview (e.g., Object { ... } or Array [ ... ])
    const preview = document.createElement('span');
    preview.className = 'jv-preview';
    const size = Object.keys(value).length;
    const typeLabel = type === 'array' ? `Array[${size}]` : `Object{${size}}`;
    preview.textContent = typeLabel;
    summary.appendChild(preview);

    // Copy button for this object/array
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-secondary btn-sm';
    copyBtn.dataset.action = 'jv-copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy this ' + type;
    // sync handler + .then() 链（iOS Safari user activation 跨 microtask 不可靠的 hardening）
    copyBtn.onclick = e => {
      e.stopPropagation();
      let text;
      try {
        text = JSON.stringify(value, null, 2);
      } catch (err) {
        console.error('JSON Stringify failed', err);
        copyBtn.textContent = 'Error!';
        setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
        return;
      }
      this._copyToClipboard(text)
        .then(() => {
          copyBtn.classList.add('is-success');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('is-success');
            copyBtn.textContent = 'Copy';
          }, 1500);
        })
        .catch(err => {
          console.error('Copy failed', err);
          copyBtn.textContent = 'Error!';
          setTimeout(() => (copyBtn.textContent = 'Copy'), 1500);
        });
    };
    summary.appendChild(copyBtn);

    details.appendChild(summary);

    // Children container
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'jv-children';

    // We defer rendering children until expansion if strictly needed for performance,
    // but for now we render them immediately to keep it simple.
    // Actually, for large payloads, lazy rendering is better.
    // Let's implement simple immediate rendering first.

    // Render children
    const keys = Object.keys(value);
    for (const childKey of keys) {
      childrenContainer.appendChild(this._createNode(childKey, value[childKey], depth + 1));
    }

    details.appendChild(childrenContainer);
    return details;
  }

  _createSimpleNode(key, value, type) {
    const div = document.createElement('div');
    div.className = 'jv-item';

    if (key !== null) {
      const keySpan = document.createElement('span');
      keySpan.className = 'jv-key';
      keySpan.textContent = `${key}: `;
      div.appendChild(keySpan);
    }

    const valueSpan = document.createElement('span');
    valueSpan.className = `jv-value jv-${type}`;

    if (type === 'string') {
      valueSpan.textContent = `"${value}"`;
    } else if (type === 'null') {
      valueSpan.textContent = 'null';
    } else {
      valueSpan.textContent = String(value);
    }

    div.appendChild(valueSpan);
    return div;
  }

  _getType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // 返回 Promise（不再 async），由调用方用 .then().catch() 链消费，保留 user gesture 上下文
  _copyToClipboard(text) {
    return navigator.clipboard.writeText(text).catch(err => {
      console.error('Failed to copy via Clipboard API: ', err);
      // Fallback to execCommand（同步 copy，兼容旧环境）
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.focus({ preventScroll: true });
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (e) {
        console.error('Fallback copy failed', e);
        document.body.removeChild(textArea);
        throw err;
      }
      document.body.removeChild(textArea);
    });
  }
}

// Export for module systems or global for simple script tags
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JsonViewer;
} else {
  window.JsonViewer = JsonViewer;
}
