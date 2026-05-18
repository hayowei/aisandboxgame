/**
 * mapPanelUI — Map panel UI (SVG-based)
 * Integrates MapRenderer and MapInteraction
 */
const mapPanelUI = {
  isOpen: false,
  renderer: null,
  interaction: null,
  legendPopulated: false,

  init() {
    this.bindEvents();
    console.log('[MapPanelUI] Initialized');
  },

  bindEvents() {
    const closeBtn = document.getElementById('map-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    // Border prompt buttons
    document.getElementById('map-border-confirm')?.addEventListener('click', async () => {
      if (this.interaction) await this.interaction.crossBorder();
    });
    document.getElementById('map-border-cancel')?.addEventListener('click', () => {
      if (this.interaction) this.interaction.cancelBorderCrossing();
    });

    // Landmark modal buttons
    document.getElementById('map-landmark-enter')?.addEventListener('click', async () => {
      if (this.interaction) await this.interaction.enterLocalMap();
    });
    document.getElementById('map-landmark-close')?.addEventListener('click', () => {
      if (this.interaction) this.interaction.closeLandmark();
    });

    // Return to world button
    document.getElementById('map-return-world')?.addEventListener('click', () => {
      if (this.interaction) this.interaction.returnToWorld();
    });

    // Regenerate button
    document.getElementById('map-regenerate-btn')?.addEventListener('click', async () => {
      if (this.interaction) await this.interaction.regenerate();
    });

    // Move bubble buttons
    document.getElementById('map-move-confirm')?.addEventListener('click', async () => {
      if (this.interaction) await this.interaction.confirmMove();
    });
    document.getElementById('map-move-cancel')?.addEventListener('click', () => {
      if (this.interaction) this.interaction.dismissBubble();
    });
  },

  async open() {
    const modal = document.getElementById('map-modal');
    if (!modal) return;

    modal.classList.remove('hidden');
    this.isOpen = true;

    // Lazy init: ensure mapService is initialized (async, may call AI for site naming)
    if (!mapService.initialized) {
      await mapService.init();
    }

    const mapData = mapService.getMapData();
    const container = document.getElementById('map-svg-container');
    if (!container || !mapData) return;

    // Create renderer if needed
    if (!this.renderer) {
      this.renderer = new MapRenderer(container);
    }

    // Create interaction handler (only once, like renderer)
    if (!this.interaction) {
      this.interaction = new MapInteraction(mapData, this.renderer, event => {
        this.onStateChange(event);
      });
    } else {
      // Update mapData reference in case it changed (e.g., after save/load restore)
      this.interaction.mapData = mapData;
    }

    this.populateLegend();
    this.renderMap();
  },

  close() {
    const modal = document.getElementById('map-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    this.isOpen = false;
    this.hideMoveBubble();
    this.hideBorderPrompt();
    this.hideLandmarkModal();
  },

  renderMap(animate) {
    if (!this.renderer || !this.interaction) return;

    const mapData = mapService.getMapData();
    if (!mapData) return;

    const currentMap = mapData.getCurrentMap();
    const playerPos = mapData.getPlayerPosition();
    const rows = mapData.layer === 'world' ? MapGenerator.WORLD_ROWS : MapGenerator.LOCAL_ROWS;
    const cols = mapData.layer === 'world' ? MapGenerator.WORLD_COLS : MapGenerator.LOCAL_COLS;

    this.hideMoveBubble();

    this.renderer.render(
      currentMap,
      playerPos,
      rows,
      cols,
      (cell, isAdj, isPlayerHere, rect) => {
        this.interaction.handleHexClick(cell, isAdj, isPlayerHere, rect);
      },
      !!animate
    );

    this.updateLayerIndicator();
    this.updateReturnButton();
  },

  onStateChange(event) {
    const regenBtn = document.getElementById('map-regenerate-btn');

    switch (event) {
      case 'playerMoved':
      case 'enteredLocal':
      case 'returnedWorld':
      case 'crossedBorder':
      case 'regenerated':
        this.hideMoveBubble();
        this.hideBorderPrompt();
        this.hideLandmarkModal();
        this.renderMap();
        this.updateLegendDesc();
        if (regenBtn) regenBtn.classList.remove('generating');
        break;
      case 'bubblePrompt':
        this.showMoveBubble();
        break;
      case 'bubbleDismissed':
        this.hideMoveBubble();
        break;
      case 'siteEntering':
        this.hideMoveBubble();
        this.close();
        break;
      case 'landmarkSelected':
        this.renderMap();
        this.showLandmarkModal();
        break;
      case 'borderPrompt':
        this.showBorderPrompt();
        break;
      case 'borderCancelled':
        this.hideBorderPrompt();
        break;
      case 'landmarkClosed':
        this.hideLandmarkModal();
        this.renderMap();
        break;
      case 'generating':
        if (regenBtn) regenBtn.classList.add('generating');
        break;
    }
  },

  // --- Move/Info bubble ---
  showMoveBubble() {
    const bubble = document.getElementById('map-move-bubble');
    const container = document.getElementById('map-svg-container');
    if (!bubble || !container || !this.interaction) return;

    const cell = this.interaction.pendingBubbleCell;
    const hexRect = this.interaction.pendingBubbleRect;
    const isAdj = this.interaction.pendingBubbleIsAdj;
    const isPlayerHere = this.interaction.pendingBubbleIsPlayerHere;
    if (!cell || !hexRect) return;

    // Fill content
    const titleEl = bubble.querySelector('.map-bubble-title');
    const descEl = bubble.querySelector('.map-bubble-desc');
    const metaEl = bubble.querySelector('.map-bubble-meta');
    const landmarkEl = bubble.querySelector('.map-bubble-landmark');
    const landmarkNameEl = bubble.querySelector('.map-bubble-landmark-name');
    const landmarkDescEl = bubble.querySelector('.map-bubble-landmark-desc');
    const buttonsEl = bubble.querySelector('.map-bubble-buttons');
    const cancelBtn = document.getElementById('map-move-cancel');
    const confirmBtn = document.getElementById('map-move-confirm');

    if (titleEl) titleEl.textContent = TerrainTypes.getTerrainName(cell.terrain);
    if (descEl) descEl.textContent = TerrainTypes.getTerrainDescription(cell.terrain);
    if (metaEl) metaEl.textContent = `坐标: (${cell.col}, ${cell.row})`;

    // Landmark info
    if (cell.landmark && landmarkEl) {
      landmarkEl.classList.remove('hidden');
      const lmName = cell.siteName || cell.locationName || '未知地标';
      const lmDesc = cell.siteDescription || cell.locationDescription || '';
      if (landmarkNameEl) landmarkNameEl.textContent = lmName;
      if (landmarkDescEl) landmarkDescEl.textContent = lmDesc;
    } else if (landmarkEl) {
      landmarkEl.classList.add('hidden');
    }

    // Button logic: 3 states
    if (isAdj) {
      // Adjacent cell → show [取消] [前往/前往并进入]
      if (buttonsEl) buttonsEl.classList.remove('hidden');
      if (cancelBtn) cancelBtn.classList.remove('hidden');
      if (confirmBtn) confirmBtn.textContent = cell.landmark === 'SITE' ? '前往并进入' : '前往';
    } else if (isPlayerHere && cell.landmark === 'SITE') {
      // Standing on SITE → show [探索此地] only
      if (buttonsEl) buttonsEl.classList.remove('hidden');
      if (cancelBtn) cancelBtn.classList.add('hidden');
      if (confirmBtn) confirmBtn.textContent = '探索此地';
    } else {
      // Info only → hide all buttons
      if (buttonsEl) buttonsEl.classList.add('hidden');
    }

    // AI busy → disable confirm button with hint
    if (window.isSending && confirmBtn && buttonsEl && !buttonsEl.classList.contains('hidden')) {
      confirmBtn.disabled = true;
      confirmBtn.textContent += '（AI回答中…）';
    } else if (confirmBtn) {
      confirmBtn.disabled = false;
    }

    // Position: show invisible first to measure
    bubble.classList.remove('hidden', 'entering', 'arrow-top');
    bubble.style.visibility = 'hidden';
    bubble.style.left = '0';
    bubble.style.top = '0';

    const containerRect = container.getBoundingClientRect();
    const bubbleH = bubble.offsetHeight;
    const bubbleW = bubble.offsetWidth;
    const arrowH = 8;

    // Calculate position relative to container
    let left = hexRect.left - containerRect.left + hexRect.width / 2;
    let top = hexRect.top - containerRect.top - bubbleH - arrowH;

    // Edge: if bubble goes above container, flip to below
    if (top < 0) {
      top = hexRect.bottom - containerRect.top + arrowH;
      bubble.classList.add('arrow-top');
    }

    // Left/right clamping (account for translateX(-50%))
    const minLeft = bubbleW / 2;
    const maxLeft = containerRect.width - bubbleW / 2;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
    bubble.style.visibility = '';
    bubble.classList.add('entering');
  },

  hideMoveBubble() {
    const bubble = document.getElementById('map-move-bubble');
    if (!bubble) return;
    bubble.classList.add('hidden');
    bubble.classList.remove('entering', 'arrow-top');
  },

  // --- Border prompt (with animation) ---
  showBorderPrompt() {
    const el = document.getElementById('map-border-prompt');
    if (!el) return;

    // Update border prompt text with destination country name
    const destTextEl = el.querySelector('.border-destination');
    if (destTextEl && this.interaction) {
      const nextInfo = this.interaction.getNextCountryInfo();
      if (nextInfo) {
        destTextEl.textContent = `前往「${nextInfo.displayName}」？`;
      } else {
        destTextEl.textContent = '没有其他可前往的区域。';
        // Disable confirm button if no destination
        const confirmBtn = document.getElementById('map-border-confirm');
        if (confirmBtn) confirmBtn.disabled = true;
      }
    }

    el.classList.remove('hidden');
    // Trigger entrance animation
    el.classList.add('entering');
    const content = el.querySelector('.map-modal-content');
    if (content) content.classList.add('entering');
    // Clean up after animation
    const cleanup = () => {
      el.classList.remove('entering');
      if (content) content.classList.remove('entering');
      el.removeEventListener('animationend', cleanup);
    };
    el.addEventListener('animationend', cleanup);
  },

  hideBorderPrompt() {
    const el = document.getElementById('map-border-prompt');
    if (!el || el.classList.contains('hidden')) return;
    // Re-enable confirm button (may have been disabled if no destination)
    const confirmBtn = document.getElementById('map-border-confirm');
    if (confirmBtn) confirmBtn.disabled = false;
    // Trigger exit animation
    el.classList.add('exiting');
    const content = el.querySelector('.map-modal-content');
    if (content) content.classList.add('exiting');
    const cleanup = () => {
      el.classList.add('hidden');
      el.classList.remove('exiting');
      if (content) content.classList.remove('exiting');
      el.removeEventListener('animationend', cleanup);
    };
    el.addEventListener('animationend', cleanup);
  },

  // --- Landmark modal (with animation) ---
  showLandmarkModal() {
    if (!this.interaction?.selectedLandmark) return;
    const lm = this.interaction.selectedLandmark;
    const modal = document.getElementById('map-landmark-modal');
    if (!modal) return;

    // Update modal content
    const titleEl = modal.querySelector('.landmark-title');
    if (titleEl) {
      if (lm.landmark === 'SITE' && lm.siteName) {
        titleEl.textContent = lm.siteName;
      } else if (lm.landmark === 'LOCATION' && lm.locationName) {
        titleEl.textContent = lm.locationName;
      } else {
        titleEl.textContent = lm.landmark === 'SITE' ? '未知地点' : '未知位置';
      }
    }

    const descEl = modal.querySelector('.landmark-desc');
    if (descEl) {
      if (lm.landmark === 'LOCATION' && lm.locationDescription) {
        descEl.textContent = lm.locationDescription;
      } else if (lm.landmark === 'SITE' && lm.siteDescription) {
        descEl.textContent = lm.siteDescription;
      } else {
        descEl.textContent =
          lm.landmark === 'SITE' ? '一处可探索的地点。' : '局部地图中的一个地点。';
      }
    }

    const coordsEl = modal.querySelector('.landmark-coords');
    if (coordsEl) {
      coordsEl.textContent = `坐标: (${lm.col}, ${lm.row})`;
    }

    const terrainEl = modal.querySelector('.landmark-terrain');
    if (terrainEl) {
      terrainEl.textContent = `地形: ${lm.terrain}`;
    }

    // Enter button visibility
    const enterBtn = document.getElementById('map-landmark-enter');
    if (enterBtn) {
      const mapData = mapService.getMapData();
      const playerPos = mapData?.getPlayerPosition();
      const canEnter =
        lm.landmark === 'SITE' && playerPos && playerPos.row === lm.row && playerPos.col === lm.col;
      enterBtn.disabled = !canEnter;
      enterBtn.textContent = canEnter ? '进入' : '需移动至该地块方可进入';
    }

    modal.classList.remove('hidden');
    // Trigger entrance animation
    modal.classList.add('entering');
    const content = modal.querySelector('.map-modal-content');
    if (content) content.classList.add('entering');
    const cleanup = () => {
      modal.classList.remove('entering');
      if (content) content.classList.remove('entering');
      modal.removeEventListener('animationend', cleanup);
    };
    modal.addEventListener('animationend', cleanup);
  },

  hideLandmarkModal() {
    const modal = document.getElementById('map-landmark-modal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('exiting');
    const content = modal.querySelector('.map-modal-content');
    if (content) content.classList.add('exiting');
    const cleanup = () => {
      modal.classList.add('hidden');
      modal.classList.remove('exiting');
      if (content) content.classList.remove('exiting');
      modal.removeEventListener('animationend', cleanup);
    };
    modal.addEventListener('animationend', cleanup);
  },

  // --- Legend panel ---
  populateLegend() {
    // Terrain types A-D (exclude E per original)
    const terrainsEl = document.getElementById('map-legend-terrains');
    if (terrainsEl && !this.legendPopulated) {
      const types = ['A', 'B', 'C', 'D', 'E'];
      terrainsEl.innerHTML = types
        .map(t => {
          const name = TerrainTypes.getTerrainName(t);
          const desc = TerrainTypes.getTerrainDescription(t);
          return `<div class="map-legend-item">
          <span class="material-symbols-outlined map-legend-marker map-legend-marker--terrain-${t.toLowerCase()}" aria-hidden="true">stop</span>
          <div class="map-legend-item-text">
            <span class="map-legend-item-name">${name}</span>
            <span class="map-legend-item-desc">${desc}</span>
          </div>
        </div>`;
        })
        .join('');

      // Landmark types
      const landmarksEl = document.getElementById('map-legend-landmarks');
      if (landmarksEl) {
        landmarksEl.innerHTML = `
          <div class="map-legend-landmark-item">
            <span class="material-symbols-outlined map-legend-landmark-symbol">explore</span>
            <div class="map-legend-item-text">
              <span class="map-legend-item-name">探索点 (Site / Location)</span>
              <span class="map-legend-item-desc">大地图上为 Site（可进入），局部地图上为 Location（仅查看信息）。</span>
            </div>
          </div>
          <div class="map-legend-landmark-item">
            <span class="material-symbols-outlined map-legend-landmark-symbol">person_pin_circle</span>
            <div class="map-legend-item-text">
              <span class="map-legend-item-name">主角</span>
              <span class="map-legend-item-desc">点击相邻的高亮地块进行移动，每次只能移动一格。</span>
            </div>
          </div>`;
      }

      this.legendPopulated = true;
    }

    this.updateLegendDesc();
  },

  updateLegendDesc() {
    const descEl = document.getElementById('map-legend-desc');
    if (!descEl) return;
    const mapData = mapService.getMapData();
    if (mapData?.layer === 'local') {
      descEl.textContent =
        '这是一个 4x4 的局部地图。地形与外部哨站所在的地块一致，内部可能包含更多资源点。';
    } else {
      descEl.textContent =
        '生成一个 10x10 的六边形网格地图（含边界格），内部 8x8 可探索区域包含四种地形类型。';
    }
  },

  // --- Layer indicator ---
  updateLayerIndicator() {
    const el = document.getElementById('map-layer-indicator');
    if (!el) return;
    const mapData = mapService.getMapData();
    if (!mapData) return;

    // Build layer indicator with country name
    const countryId = mapData.currentCountryId;
    const countryName =
      countryId && countryId !== '_legacy'
        ? window.entityStore?.getDisplayName?.(countryId) || ''
        : '';

    if (mapData.layer === 'local') {
      const siteName = mapData.activeLandmark?.siteName || '';
      const parts = ['局部地图', countryName, siteName].filter(Boolean);
      el.textContent = parts.join(' · ');
    } else {
      const parts = ['世界地图', countryName].filter(Boolean);
      el.textContent = parts.join(' · ');
    }
  },

  updateReturnButton() {
    const btn = document.getElementById('map-return-world');
    if (!btn) return;
    const mapData = mapService.getMapData();
    if (mapData?.layer === 'local') {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  },

  // --- Public ---
  refresh() {
    if (this.isOpen) this.renderMap();
  },
};

const _bootMapPanelUI = () => {
  setTimeout(() => mapPanelUI.init(), 200);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _bootMapPanelUI);
} else {
  queueMicrotask(_bootMapPanelUI);
}

window.mapPanelUI = mapPanelUI;
console.log('[MapPanelUI] Loaded');
