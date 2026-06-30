/**
 * MapInteraction — Hex click handling and layer navigation
 * Emits EventBus events for map-game integration
 */
(function(global) {
  'use strict';

  const WORLD_ROWS = 10;
  const WORLD_COLS = 10;

  class MapInteraction {
    constructor(mapData, renderer, onStateChange) {
      this.mapData = mapData;
      this.renderer = renderer;
      this.onStateChange = onStateChange; // callback when state changes
      this.isGenerating = false;
      this.selectedLandmark = null;
      this.showBorderPrompt = false;
      this.pendingBorderCell = null;
      // Bubble state
      this.pendingBubbleCell = null;
      this.pendingBubbleRect = null;
      this.pendingBubbleIsAdj = false;
      this.pendingBubbleIsPlayerHere = false;
    }

    /**
     * Handle hex click — show info/action bubble for any cell
     */
    handleHexClick(cell, isAdj, isPlayerHere, rect) {
      if (this.isGenerating) return;

      // Adjacent border cell — close any bubble, show existing full-screen prompt
      if (isAdj && cell.terrain === 'E') {
        if (this.pendingBubbleCell) this.dismissBubble();
        this.pendingBorderCell = { row: cell.row, col: cell.col };
        this.showBorderPrompt = true;
        this.onStateChange('borderPrompt');
        return;
      }

      // All other cells → show bubble (replaces any existing bubble immediately)
      this.pendingBubbleCell = cell;
      this.pendingBubbleRect = rect || null;
      this.pendingBubbleIsAdj = isAdj;
      this.pendingBubbleIsPlayerHere = isPlayerHere;
      this.onStateChange('bubblePrompt');
    }

    /**
     * Confirm action from bubble — move to cell, enter SITE, etc.
     */
    async confirmMove() {
      const cell = this.pendingBubbleCell;
      const isPlayerHere = this.pendingBubbleIsPlayerHere;
      if (!cell) return;
      if (this.isGenerating) return;
      if (window.isSending) return;

      // Clear pending state
      this.pendingBubbleCell = null;
      this.pendingBubbleRect = null;
      this.pendingBubbleIsAdj = false;
      this.pendingBubbleIsPlayerHere = false;

      // Case 1: Player standing on SITE → enter local map (no movement needed)
      if (isPlayerHere && cell.landmark === 'SITE') {
        this.selectedLandmark = cell;
        this.onStateChange('siteEntering');

        await this.enterLocalMap();

        if (!window.isDesignMode) {
          if (typeof mapMovementHandler !== 'undefined' && typeof mapMovementHandler.triggerAITurn === 'function') {
            const { message, displayMessage } = mapMovementHandler._buildSiteEntryMessage(cell);
            await mapMovementHandler.triggerAITurn(message, displayMessage);
          }
        }
        return;
      }

      // Case 2: Adjacent SITE → move + enter local map
      if (cell.landmark === 'SITE') {
        this.mapData.setPlayerPosition(cell.row, cell.col);

        if (typeof locationTracker !== 'undefined') {
          locationTracker.updateFromMapPosition({
            row: cell.row,
            col: cell.col,
            terrain: cell.terrain,
            landmark: cell.landmark,
            landmarkId: cell.landmarkId || null,
            siteName: cell.siteName || null,
            locationName: cell.locationName || null,
            layer: this.mapData.layer,
          });
        }

        this.selectedLandmark = cell;
        this.onStateChange('siteEntering');

        await this.enterLocalMap();

        if (!window.isDesignMode) {
          if (typeof mapMovementHandler !== 'undefined' && typeof mapMovementHandler.triggerAITurn === 'function') {
            const { message, displayMessage } = mapMovementHandler._buildSiteEntryMessage(cell);
            await mapMovementHandler.triggerAITurn(message, displayMessage);
          }
        }
        return;
      }

      // Case 3: Adjacent regular / LOCATION cell → move + emit event
      this.mapData.setPlayerPosition(cell.row, cell.col);

      this._emitEvent(window.GameEvents?.MAP_PLAYER_MOVED, {
        row: cell.row,
        col: cell.col,
        terrain: cell.terrain,
        landmark: cell.landmark || null,
        landmarkId: cell.landmarkId || null,
        siteName: cell.siteName || null,
        locationName: cell.locationName || null,
        siteDescription: cell.siteDescription || null,
        locationDescription: cell.locationDescription || null,
        layer: this.mapData.layer,
        source: 'map_click',
      });

      this.onStateChange('playerMoved');
    }

    /**
     * Dismiss bubble — hide without action
     */
    dismissBubble() {
      this.pendingBubbleCell = null;
      this.pendingBubbleRect = null;
      this.pendingBubbleIsAdj = false;
      this.pendingBubbleIsPlayerHere = false;
      this.onStateChange('bubbleDismissed');
    }

    /**
     * Enter local map from a SITE landmark.
     * Uses localMapCache to preserve LOCATION names across visits.
     * Calls AI to name LOCATIONs on first visit.
     */
    async enterLocalMap() {
      if (!this.selectedLandmark) return;
      if (this.isGenerating) return;

      const playerPos = this.mapData.getPlayerPosition();
      if (playerPos.row !== this.selectedLandmark.row || playerPos.col !== this.selectedLandmark.col) return;

      this.isGenerating = true;
      this.onStateChange('generating');

      try {
        const landmarkId = this.selectedLandmark.landmarkId;
        const cached = this.mapData.localMapCache[landmarkId];

        if (cached) {
          // Restore from cache
          this.mapData.localMap = cached;
          console.log(`[MapInteraction] Restored local map from cache: ${landmarkId}`);
        } else {
          // Generate new local map with random 3-6 LOCATIONs
          const locationCount = Math.floor(Math.random() * 4) + 3;
          this.mapData.localMap = MapGenerator.generateLocalMap(
            this.selectedLandmark.terrain, locationCount
          );

          // Call AI to name LOCATIONs
          const locations = this.mapData.localMap.filter(c => c.landmark === 'LOCATION');
          const siteName = this.selectedLandmark.siteName || 'Unknown Site';
          await this._nameLocationsViaAI(locations, siteName);

          // Cache for future visits
          this.mapData.localMapCache[landmarkId] = this.mapData.localMap;
          console.log(`[MapInteraction] Generated and cached local map: ${landmarkId} (${locations.length} locations)`);
        }

        this.mapData.activeLandmark = this.selectedLandmark;
        this.mapData.layer = 'local';
        this.mapData.localPlayerPos = { row: 0, col: 0 };

        // Emit MAP_ENTERED_LOCAL event
        this._emitEvent(window.GameEvents?.MAP_ENTERED_LOCAL, {
          landmarkId: this.selectedLandmark.landmarkId,
          siteName: this.selectedLandmark.siteName || null,
          source: 'map_click',
        });

        this.selectedLandmark = null;
      } finally {
        this.isGenerating = false;
      }

      this.onStateChange('enteredLocal');
    }

    /**
     * Return to world map — cache local map before clearing
     */
    returnToWorld() {
      if (this.isGenerating) return;

      this.isGenerating = true;
      this.onStateChange('generating');

      setTimeout(() => {
        // Cache current local map before leaving (already cached on enter, but update in case of changes)
        if (this.mapData.activeLandmark?.landmarkId && this.mapData.localMap.length > 0) {
          this.mapData.localMapCache[this.mapData.activeLandmark.landmarkId] = this.mapData.localMap;
        }

        this.mapData.layer = 'world';
        this.mapData.activeLandmark = null;
        this.mapData.localMap = [];
        this.isGenerating = false;

        // Emit MAP_RETURNED_WORLD event
        this._emitEvent(window.GameEvents?.MAP_RETURNED_WORLD, {
          source: 'map_click',
        });

        this.onStateChange('returnedWorld');
      }, 300);
    }

    /**
     * Cross border — switch to the next country in entity list (cyclic).
     * If only 1 entity exists, cancels and notifies.
     */
    async crossBorder() {
      if (!this.pendingBorderCell) return;
      if (this.isGenerating) return;

      this.showBorderPrompt = false;

      const entities = window.entityStore?.list?.() || [];
      const currentCountryId = this.mapData.currentCountryId;

      // Single or no entity — cannot cross
      if (entities.length <= 1) {
        console.log('[MapInteraction] Only one country, border crossing cancelled');
        this.pendingBorderCell = null;
        this.onStateChange('borderCancelled');
        return;
      }

      // Find next country (cyclic)
      const currentIndex = entities.indexOf(currentCountryId);
      const nextIndex = (currentIndex + 1) % entities.length;
      const nextEntityId = entities[nextIndex];
      const nextCountryName = window.entityStore?.getDisplayName?.(nextEntityId) || nextEntityId;

      // Calculate entry position on opposite border
      let nextRow = 1;
      let nextCol = 1;
      if (this.pendingBorderCell) {
        nextRow = this.pendingBorderCell.row === 0 ? WORLD_ROWS - 2
                : (this.pendingBorderCell.row === WORLD_ROWS - 1 ? 1 : this.pendingBorderCell.row);
        nextCol = this.pendingBorderCell.col === 0 ? WORLD_COLS - 2
                : (this.pendingBorderCell.col === WORLD_COLS - 1 ? 1 : this.pendingBorderCell.col);
      }

      this.isGenerating = true;
      this.onStateChange('generating');

      try {
        const fromCountryId = currentCountryId;

        // Switch to next country (generates map + AI naming if new)
        await window.mapService.switchToCountry(nextEntityId);

        // Set player position at opposite border edge
        this.mapData.worldPlayerPos = { row: nextRow, col: nextCol };

        this.pendingBorderCell = null;

        // Emit MAP_CROSSED_BORDER event with country info
        this._emitEvent(window.GameEvents?.MAP_CROSSED_BORDER, {
          fromCountryId,
          toCountryId: nextEntityId,
          countryName: nextCountryName,
          source: 'map_click',
        });

        // Update location tracker with new country position
        const newCell = this.mapData.worldMap.find(
          c => c.row === nextRow && c.col === nextCol
        );
        if (typeof locationTracker !== 'undefined') {
          locationTracker.updateFromMapPosition({
            row: nextRow,
            col: nextCol,
            terrain: newCell?.terrain || 'A',
            landmark: newCell?.landmark || null,
            landmarkId: newCell?.landmarkId || null,
            siteName: newCell?.siteName || null,
            locationName: null,
            layer: 'world',
          });
        }
      } finally {
        this.isGenerating = false;
      }

      this.onStateChange('crossedBorder');
    }

    /**
     * Cancel border crossing
     */
    cancelBorderCrossing() {
      this.showBorderPrompt = false;
      this.pendingBorderCell = null;
      this.onStateChange('borderCancelled');
    }

    /**
     * Close landmark modal
     */
    closeLandmark() {
      this.selectedLandmark = null;
      this.onStateChange('landmarkClosed');
    }

    /**
     * Regenerate current map.
     * For local maps: async — calls AI to name LOCATIONs, then updates cache.
     */
    async regenerate() {
      if (this.isGenerating) return;

      this.isGenerating = true;
      this.onStateChange('generating');

      try {
        if (this.mapData.layer === 'world') {
          // Regenerate via mapService (handles AI naming + country cache)
          await window.mapService.regenerateWorldMap();
          this.mapData.worldPlayerPos = { row: 1, col: 1 };
        } else if (this.mapData.activeLandmark) {
          // Regenerate local map with random 3-6 LOCATIONs + AI naming
          const locationCount = Math.floor(Math.random() * 4) + 3;
          this.mapData.localMap = MapGenerator.generateLocalMap(
            this.mapData.activeLandmark.terrain, locationCount
          );
          this.mapData.localPlayerPos = { row: 0, col: 0 };

          // Call AI to name LOCATIONs
          const locations = this.mapData.localMap.filter(c => c.landmark === 'LOCATION');
          const siteName = this.mapData.activeLandmark.siteName || 'Unknown Site';
          await this._nameLocationsViaAI(locations, siteName);

          // Update cache so future visits use the new named map
          const landmarkId = this.mapData.activeLandmark.landmarkId;
          if (landmarkId) {
            this.mapData.localMapCache[landmarkId] = this.mapData.localMap;
          }
        }
      } finally {
        this.isGenerating = false;
      }
      this.onStateChange('regenerated');
    }

    /**
     * Get info about the next country for border crossing UI.
     * Returns { entityId, displayName } or null if crossing not possible.
     */
    getNextCountryInfo() {
      const entities = window.entityStore?.list?.() || [];
      if (entities.length <= 1) return null;

      const currentIndex = entities.indexOf(this.mapData.currentCountryId);
      const nextIndex = (currentIndex + 1) % entities.length;
      const nextEntityId = entities[nextIndex];
      return {
        entityId: nextEntityId,
        displayName: window.entityStore?.getDisplayName?.(nextEntityId) || nextEntityId,
      };
    }

    /**
     * Call AI to name LOCATIONs within a SITE.
     * Uses ReAct model via mapService.nameLocationsViaAI (delegated to aiService).
     * Falls back to generic names on failure.
     */
    async _nameLocationsViaAI(locations, siteName) {
      if (!locations || locations.length === 0) return;

      try {
        // Delegate to mapService which calls aiService
        if (typeof window.mapService?.nameLocationsViaAI === 'function') {
          await window.mapService.nameLocationsViaAI(locations, siteName);
          return;
        }
      } catch (e) {
        console.warn('[MapInteraction] AI LOCATION naming failed, using fallback:', e);
      }

      // Fallback: assign generic names
      locations.forEach((loc, i) => {
        if (!loc.locationName) {
          loc.locationName = `Location ${i + 1}`;
          loc.locationDescription = '';
        }
      });
    }

    /**
     * Emit EventBus event (safe — no-op if EventBus unavailable)
     */
    _emitEvent(eventType, payload) {
      if (window.eventBus && eventType) {
        window.eventBus.emit(eventType, payload);
      }
    }
  }

  global.MapInteraction = MapInteraction;
})(typeof window !== 'undefined' ? window : this);
