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
  const DEFAULT_BG_CUSTOM = { positionX: 50, positionY: 50, scale: 100 };

  function _normalizeBgMode(mode) {
    return VALID_BG_MODES.has(mode) ? mode : 'solid';
  }

  function _normalizeBgCustom(custom) {
    const src = custom && typeof custom === 'object' ? custom : {};
    const clamp = (v, min, max, fallback) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };
    return {
      positionX: clamp(src.positionX, 0, 100, 50),
      positionY: clamp(src.positionY, 0, 100, 50),
      scale: clamp(src.scale, 100, 300, 100),
    };
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
    _customBgScale: 100,

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
            this._applyCustomBgSize();
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
        const custom = _normalizeBgCustom(options.custom);
        this._customBgScale = custom.scale;
        root.style.setProperty('--custom-bg-position', `${custom.positionX}% ${custom.positionY}%`);
        this._applyCustomBgSize();
        if (typeof options.url === 'string' && options.url) {
          root.style.setProperty('--custom-bg-url', `url("${options.url}")`);
        } else if (options.url === null) {
          root.style.removeProperty('--custom-bg-url');
        }
      }

      if (normalized === 'parchment' && this.getThemeMode() !== 'light') {
        this.applyThemeMode('light');
      }

      return normalized;
    },

    setBgCustomTransform(custom) {
      const normalized = _normalizeBgCustom(custom);
      this._customBgScale = normalized.scale;
      const root = document.documentElement;
      root.style.setProperty('--custom-bg-position', `${normalized.positionX}% ${normalized.positionY}%`);
      this._applyCustomBgSize();
      return normalized;
    },

    setBgCustomUrl(url) {
      const root = document.documentElement;
      if (typeof url === 'string' && url) {
        root.style.setProperty('--custom-bg-url', `url("${url}")`);
      } else {
        root.style.removeProperty('--custom-bg-url');
      }
    },

    adoptCustomBgUrl(url) {
      if (this._persistentCustomBgUrl && this._persistentCustomBgUrl !== url) {
        try { URL.revokeObjectURL(this._persistentCustomBgUrl); } catch (_) { /* ignore */ }
      }
      this._persistentCustomBgUrl = url || null;
      this.setBgCustomUrl(this._persistentCustomBgUrl);
      if (url) {
        this._loadCustomBgImageSize(url);
      } else {
        this._customBgImageSize = null;
        this._applyCustomBgSize();
      }
    },

    _reloadPersistentCustomBgFromIDB() {
      if (!window.backgroundImageStore?.get) return;
      window.backgroundImageStore.get().then(blob => {
        this.adoptCustomBgUrl(blob ? URL.createObjectURL(blob) : null);
      }).catch(() => { /* ignore */ });
    },

    _loadCustomBgImageSize(url) {
      const img = new Image();
      img.onload = () => {
        this._customBgImageSize = { width: img.naturalWidth, height: img.naturalHeight };
        if (document.documentElement.getAttribute('data-bg-mode') === 'custom') {
          this._applyCustomBgSize();
        }
        window.dispatchEvent(new CustomEvent('custom-bg-image-size-loaded', {
          detail: { width: img.naturalWidth, height: img.naturalHeight },
        }));
      };
      img.onerror = () => { this._customBgImageSize = null; };
      img.src = url;
    },

    _applyCustomBgSize() {
      const root = document.documentElement;
      const scale = this._customBgScale || 100;
      const imageSize = this._customBgImageSize;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (!imageSize || !vw || !vh) {
        root.style.setProperty('--custom-bg-size', `${scale}%`);
        return;
      }
      const imageRatio = imageSize.width / Math.max(1, imageSize.height);
      const viewportRatio = vw / Math.max(1, vh);
      const sizeValue = imageRatio < viewportRatio
        ? `${scale}% auto`
        : `auto ${scale}%`;
      root.style.setProperty('--custom-bg-size', sizeValue);
    },

    getCustomBgImageSize() {
      return this._customBgImageSize ? { ...this._customBgImageSize } : null;
    },

    normalizeBgMode: _normalizeBgMode,
    normalizeBgCustom: _normalizeBgCustom,
    DEFAULT_BG_CUSTOM,
  };

  window.themeUI.init();
})();
