// ============================================
// Theme UI - 主题管理
// ============================================

(function () {
  const STORAGE_KEY = 'ai_adventure_settings';
  const DEFAULT_THEME = 'metro';
  const VALID_MODES = new Set(['light', 'dark']);
  const UI_SCALE_MIN = 0.9;
  const UI_SCALE_MAX = 1.5;
  const UI_SCALE_VALUES = [0.9, 0.95, 1, 1.2, 1.5];
  const VALID_UI_SCALE_MODES = new Set(['auto', 'manual']);
  const VALID_BG_MODES = new Set(['solid', 'parchment', 'world-card', 'custom']);
  // 自定义背景参数（与分辨率无关，任意视口都能复算）：
  //   zoom    — cover 基线之上的放大倍数（1=刚好铺满，最大 3）
  //   offsetX — 横向平移，-1~1，0=居中，+1=露出图片左缘，-1=露出右缘
  //   offsetY — 纵向平移，-1~1，0=居中，+1=露出图片上缘，-1=露出下缘
  //   dim     — 压暗蒙层浓度 0~0.85（0=不压暗）
  const ZOOM_MIN = 1;
  const ZOOM_MAX = 3;
  const DIM_MAX = 0.7; // 与编辑器滑块 max=70% / settingsUI BG_EDIT_DIM_MAX 一致
  const DEFAULT_BG_CUSTOM = { zoom: 1, offsetX: 0, offsetY: 0, dim: 0 };

  function _normalizeBgMode(mode) {
    return VALID_BG_MODES.has(mode) ? mode : 'solid';
  }

  function _clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function _normalizeBgCustom(custom) {
    const src = custom && typeof custom === 'object' && !Array.isArray(custom) ? custom : {};
    // 旧格式迁移（V1：background-position 百分比 + 100~300 的 scale）→ 新 zoom/offset 模型。
    // 老卡承诺：旧自定义背景仍能正确显示。绝大多数用户停在默认 50/50/100，迁移后 = 居中铺满，零变化。
    const isLegacy = !('zoom' in src) && !('offsetX' in src) &&
      ('positionX' in src || 'positionY' in src || 'scale' in src);
    if (isLegacy) {
      const posX = _clampNum(src.positionX, 0, 100, 50);
      const posY = _clampNum(src.positionY, 0, 100, 50);
      const scale = _clampNum(src.scale, 100, 300, 100);
      return {
        zoom: _clampNum(scale / 100, ZOOM_MIN, ZOOM_MAX, 1),
        offsetX: _clampNum((50 - posX) / 50, -1, 1, 0),
        offsetY: _clampNum((50 - posY) / 50, -1, 1, 0),
        dim: 0,
      };
    }
    return {
      zoom: _clampNum(src.zoom, ZOOM_MIN, ZOOM_MAX, 1),
      offsetX: _clampNum(src.offsetX, -1, 1, 0),
      offsetY: _clampNum(src.offsetY, -1, 1, 0),
      dim: _clampNum(src.dim, 0, DIM_MAX, 0),
    };
  }

  // 把图片在 cover 基线上按 zoom 放大再按 offset 平移，算出落在 frame 里的像素尺寸与位移。
  // 编辑器预览框与实景渲染层共用同一套公式 → 所见即所得，不存在两套换算偏差。
  function _coverLayout(frameW, frameH, imgW, imgH, custom) {
    const c = _normalizeBgCustom(custom);
    if (!frameW || !frameH || !imgW || !imgH) {
      return { width: frameW || 0, height: frameH || 0, tx: 0, ty: 0, zoom: c.zoom };
    }
    const coverScale = Math.max(frameW / imgW, frameH / imgH);
    const width = imgW * coverScale * c.zoom;
    const height = imgH * coverScale * c.zoom;
    const overflowX = width - frameW; // zoom>=1 时 >=0
    const overflowY = height - frameH;
    const tx = (frameW - width) / 2 + c.offsetX * (overflowX / 2);
    const ty = (frameH - height) / 2 + c.offsetY * (overflowY / 2);
    return { width, height, tx, ty, zoom: c.zoom };
  }

  function _normalizeMode(mode) {
    return VALID_MODES.has(mode) ? mode : 'light';
  }

  function _normalizeThemeName(name) {
    return (typeof name === 'string' && name) ? name : DEFAULT_THEME;
  }

  function _normalizeUIScaleMode(mode) {
    return VALID_UI_SCALE_MODES.has(mode) ? mode : 'auto';
  }

  function _normalizeUIScale(value, fallback = 1) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    // 吸附到最接近的离散档位（与 settingsUI 保持一致）
    let nearest = UI_SCALE_VALUES[0];
    let bestDiff = Math.abs(parsed - nearest);
    for (let i = 1; i < UI_SCALE_VALUES.length; i++) {
      const diff = Math.abs(parsed - UI_SCALE_VALUES[i]);
      if (diff < bestDiff) {
        bestDiff = diff;
        nearest = UI_SCALE_VALUES[i];
      }
    }
    return nearest;
  }

  function _readStoredSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      return JSON.parse(raw) || {};
    } catch (e) {
      return {};
    }
  }

  function _applyAttrs(themeName, mode) {
    // Theme switch is instant — no View Transitions ceremony.
    const root = document.documentElement;
    root.setAttribute('data-theme-mode', mode);
    root.setAttribute('data-theme', mode);
    root.setAttribute('data-skin', themeName);
  }

  function _readAvailableSkins() {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--available-skins')
      .replace(/[" ]/g, '');
    return raw ? raw.split(',').filter(Boolean) : [];
  }

  function _getAutoUIScale(width = null) {
    const viewportWidth =
      Number(width) || window.innerWidth || document.documentElement.clientWidth || 0;
    if (viewportWidth >= 3840) return 1.5;
    if (viewportWidth >= 2560) return 1.2;
    return 1;
  }

  window.themeUI = {
    _themeName: DEFAULT_THEME,
    _uiScaleMode: 'auto',
    _manualUIScale: 1,
    _uiScaleResizeBound: false,
    _persistentCustomBgUrl: null,
    _customBgImageSize: null,
    _customBg: { zoom: 1, offsetX: 0, offsetY: 0, dim: 0 },

    init() {
      const saved = _readStoredSettings();
      const bgMode = _normalizeBgMode(saved?.backgroundMode);
      const mode = bgMode === 'parchment' ? 'light' : _normalizeMode(saved?.themeMode);
      this._themeName = _normalizeThemeName(saved?.themeName);
      const availableSkins = _readAvailableSkins();
      if (availableSkins.length && !availableSkins.includes(this._themeName)) {
        this._themeName = DEFAULT_THEME;
      }
      this._uiScaleMode = _normalizeUIScaleMode(saved?.uiScaleMode);
      this._manualUIScale = _normalizeUIScale(saved?.uiScale, 1);
      this.applyThemeMode(mode);
      this.applyBgMode(bgMode, { custom: saved?.backgroundCustom });
      if (bgMode === 'custom' && window.backgroundImageStore?.get) {
        window.backgroundImageStore.get().then(blob => {
          if (blob) this.adoptCustomBgUrl(URL.createObjectURL(blob));
        }).catch(() => { /* ignore */ });
      }
      this.applyUIScaleSettings({
        mode: this._uiScaleMode,
        scale: this._manualUIScale,
      });

      if (!this._uiScaleResizeBound) {
        window.addEventListener('resize', () => {
          if (this._uiScaleMode === 'auto') {
            this._applyUIScale();
          }
          if (document.documentElement.getAttribute('data-bg-mode') === 'custom') {
            this._renderCustomBg();
          }
        });
        this._uiScaleResizeBound = true;
      }
    },

    applyThemeMode(mode) {
      const normalizedMode = _normalizeMode(mode);
      _applyAttrs(this._themeName, normalizedMode);
    },

    setThemeName(name) {
      this._themeName = _normalizeThemeName(name);
      const currentMode = this.getThemeMode();
      _applyAttrs(this._themeName, currentMode);
    },

    getThemeName() {
      return this._themeName;
    },

    getThemeMode() {
      const mode = document.documentElement.getAttribute('data-theme-mode');
      return _normalizeMode(mode || _readStoredSettings()?.themeMode);
    },

    getAutoUIScale(width = null) {
      return _getAutoUIScale(width);
    },

    _dispatchUIScaleChanged(effectiveScale) {
      window.dispatchEvent(
        new CustomEvent('ui-scale-changed', {
          detail: {
            mode: this._uiScaleMode,
            scale: this._manualUIScale,
            effectiveScale,
          },
        })
      );
    },

    _applyUIScale() {
      const effectiveScale =
        this._uiScaleMode === 'manual' ? this._manualUIScale : _getAutoUIScale();
      const root = document.documentElement;
      root.style.setProperty('--ui-scale', String(effectiveScale));
      root.setAttribute('data-ui-scale-mode', this._uiScaleMode);
      this._dispatchUIScaleChanged(effectiveScale);
      return effectiveScale;
    },

    applyUIScaleSettings(options = {}) {
      this._uiScaleMode = _normalizeUIScaleMode(options.mode);
      this._manualUIScale = _normalizeUIScale(options.scale, 1);
      return this._applyUIScale();
    },

    getUIScaleSettings() {
      const effectiveScale =
        this._uiScaleMode === 'manual' ? this._manualUIScale : _getAutoUIScale();
      return {
        mode: this._uiScaleMode,
        scale: this._manualUIScale,
        effectiveScale,
      };
    },

    applyBgMode(mode, options = {}) {
      const normalized = _normalizeBgMode(mode);
      const root = document.documentElement;
      root.setAttribute('data-bg-mode', normalized);

      if (normalized === 'custom') {
        this._customBg = _normalizeBgCustom(options.custom);
        this._renderCustomBg();
        if (typeof options.url === 'string' && options.url) {
          this.setBgCustomUrl(options.url);
        } else if (options.url === null) {
          this.setBgCustomUrl(null);
        }
      }

      if (normalized === 'parchment' && this.getThemeMode() !== 'light') {
        this.applyThemeMode('light');
      }

      return normalized;
    },

    // 更新 zoom/offset/dim 并立即重渲染（编辑器实时调用）。
    setBgCustomTransform(custom) {
      this._customBg = _normalizeBgCustom(custom);
      this._renderCustomBg();
      return { ...this._customBg };
    },

    setBgCustomUrl(url) {
      const img = document.getElementById('custom-bg-img');
      if (typeof url === 'string' && url) {
        if (img) img.src = url;
        this._loadCustomBgImageSize(url);
      } else {
        if (img) img.removeAttribute('src');
        this._customBgImageSize = null;
        this._renderCustomBg();
      }
    },

    adoptCustomBgUrl(url) {
      if (this._persistentCustomBgUrl && this._persistentCustomBgUrl !== url) {
        try { URL.revokeObjectURL(this._persistentCustomBgUrl); } catch (_) { /* ignore */ }
      }
      this._persistentCustomBgUrl = url || null;
      this.setBgCustomUrl(this._persistentCustomBgUrl);
    },

    _reloadPersistentCustomBgFromIDB() {
      if (!window.backgroundImageStore?.get) return;
      window.backgroundImageStore.get().then(blob => {
        this.adoptCustomBgUrl(blob ? URL.createObjectURL(blob) : null);
      }).catch(() => { /* ignore */ });
    },

    _loadCustomBgImageSize(url) {
      if (!url) { this._customBgImageSize = null; this._renderCustomBg(); return; }
      const probe = new Image();
      probe.onload = () => {
        this._customBgImageSize = { width: probe.naturalWidth, height: probe.naturalHeight };
        this._renderCustomBg();
        window.dispatchEvent(new CustomEvent('custom-bg-image-size-loaded', {
          detail: { width: probe.naturalWidth, height: probe.naturalHeight },
        }));
      };
      probe.onerror = () => { this._customBgImageSize = null; };
      probe.src = url;
    },

    // 把当前 _customBg 渲染到 #custom-bg-layer：img 的 width/height/transform + dim 浓度。
    // frame 取渲染层自身尺寸（≈视口），与编辑器预览框用同一套 _coverLayout 公式。
    _renderCustomBg() {
      const root = document.documentElement;
      root.style.setProperty('--custom-bg-dim', String(this._customBg.dim || 0));
      const img = document.getElementById('custom-bg-img');
      if (!img) return;
      const size = this._customBgImageSize;
      if (!size || !size.width || !size.height) {
        img.style.width = '';
        img.style.height = '';
        img.style.transform = '';
        return;
      }
      const layer = document.getElementById('custom-bg-layer');
      const frameW = (layer && layer.clientWidth) || window.innerWidth;
      const frameH = (layer && layer.clientHeight) || window.innerHeight;
      const layout = _coverLayout(frameW, frameH, size.width, size.height, this._customBg);
      // ceil 防亚像素留缝（浮点尺寸取整后可能比 frame 小 <1px，露出底层发丝线）
      img.style.width = `${Math.ceil(layout.width)}px`;
      img.style.height = `${Math.ceil(layout.height)}px`;
      img.style.transform = `translate(${layout.tx}px, ${layout.ty}px)`;
    },

    getCustomBgImageSize() {
      return this._customBgImageSize ? { ...this._customBgImageSize } : null;
    },

    getBgCustom() {
      return { ...this._customBg };
    },

    normalizeBgMode: _normalizeBgMode,
    normalizeBgCustom: _normalizeBgCustom,
    computeCustomBgLayout: _coverLayout,
    DEFAULT_BG_CUSTOM,
  };

  window.themeUI.init();
})();
