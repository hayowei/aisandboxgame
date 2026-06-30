/**
 * mapMovementHandler — Glue layer: map movement → AI narrative turn
 * Subscribes to MAP_PLAYER_MOVED and MAP_CROSSED_BORDER events and triggers AI response.
 * Only responds to player-initiated map clicks (source: 'map_click').
 */
const mapMovementHandler = {
  _initialized: false,

  init() {
    if (this._initialized) return;
    if (!window.eventBus || !window.GameEvents) {
      console.warn('[MapMovementHandler] EventBus not available, skipping init');
      return;
    }

    window.eventBus.on(window.GameEvents.MAP_PLAYER_MOVED, (payload) => {
      this._onMapPlayerMoved(payload);
    });

    window.eventBus.on(window.GameEvents.MAP_CROSSED_BORDER, (payload) => {
      this._onMapCrossedBorder(payload);
    });

    this._initialized = true;
    console.log('[MapMovementHandler] Initialized');
  },

  /**
   * Handle MAP_PLAYER_MOVED event.
   * Updates location tracker, closes map panel, triggers AI turn.
   */
  _onMapPlayerMoved(payload) {
    // Only trigger AI for player-initiated map clicks
    if (payload.source !== 'map_click') return;

    // Skip if AI is already processing
    if (window.isSending) {
      console.log('[MapMovementHandler] Skipped: AI is busy');
      return;
    }

    // Skip in design mode
    if (window.isDesignMode) return;

    // Update location tracker with map position
    if (typeof locationTracker !== 'undefined') {
      locationTracker.updateFromMapPosition(payload);
    }

    // Close map panel
    if (typeof mapPanelUI !== 'undefined' && mapPanelUI.isOpen) {
      mapPanelUI.close();
    }

    // Build display message based on terrain/landmark
    const displayMessage = this._buildDisplayMessage(payload);
    const fullMessage = this._buildFullMessage(payload);

    // Trigger AI turn via handleSendMessage flow
    this.triggerAITurn(fullMessage, displayMessage);
  },

  /**
   * Handle MAP_CROSSED_BORDER event.
   * Closes map panel, triggers AI turn with border crossing context.
   */
  _onMapCrossedBorder(payload) {
    if (payload.source !== 'map_click') return;
    if (window.isSending) return;
    if (window.isDesignMode) return;

    // Close map panel
    if (typeof mapPanelUI !== 'undefined' && mapPanelUI.isOpen) {
      mapPanelUI.close();
    }

    const displayMessage = `越境前往 ${payload.countryName}`;
    const fullMessage = this._buildBorderCrossMessage(payload);
    this.triggerAITurn(fullMessage, displayMessage);
  },

  /**
   * Build the user-visible display message for the chat.
   */
  _buildDisplayMessage(payload) {
    if (payload.landmark === 'SITE' && payload.siteName) {
      return `前往 ${payload.siteName}`;
    }
    if (payload.landmark === 'LOCATION' && payload.locationName) {
      return `前往 ${payload.locationName}`;
    }
    const terrainName = typeof TerrainTypes !== 'undefined'
      ? TerrainTypes.getTerrainName(payload.terrain)
      : payload.terrain;
    return `前往 ${terrainName}`;
  },

  /**
   * Build the full message sent to AI for regular movement (includes structured data).
   */
  _buildFullMessage(payload) {
    const lines = ['[地图移动]'];
    lines.push(`- 目的地坐标：(${payload.col}, ${payload.row})`);

    // 地形类型 + 描述
    const terrainDesc = typeof TerrainTypes !== 'undefined'
      ? TerrainTypes.getTerrainDescription(payload.terrain) : '';
    lines.push(`- 地形类型：${payload.terrain}（${terrainDesc}）`);

    // 地标信息
    if (payload.siteName) lines.push(`- 地点：${payload.siteName}`);
    if (payload.locationName) lines.push(`- 位置：${payload.locationName}`);
    if (payload.siteDescription) lines.push(`- 地点描述：${payload.siteDescription}`);
    if (payload.locationDescription) lines.push(`- 位置描述：${payload.locationDescription}`);

    lines.push(`- 层级：${payload.layer === 'world' ? '世界地图' : '局部地图'}`);

    // 目的地周围环境（从地图数据获取）
    if (typeof mapService !== 'undefined' && typeof HexGrid !== 'undefined') {
      const mapData = mapService.getMapData();
      if (mapData) {
        const currentMap = mapData.getCurrentMap();
        const adjCells = HexGrid.getAdjacentCells(payload.row, payload.col, currentMap);

        // 周围地形
        const adjTerrains = [...new Set(adjCells.map(c => c.terrain))];
        if (adjTerrains.length > 0) {
          lines.push(`- 周围地形：${adjTerrains.join(', ')}`);
        }

        // 周围地标
        const nearbyLandmarks = adjCells.filter(c => c.landmark);
        if (nearbyLandmarks.length > 0) {
          const names = nearbyLandmarks.map(c => c.siteName || c.locationName || c.landmark);
          lines.push(`- 附近地标：${names.join('、')}`);
        }
      }
    }

    return lines.join('\n');
  },

  /**
   * Build the full message sent to AI for SITE entry.
   * Called from MapInteraction.js for both "standing on SITE" and "adjacent SITE" flows.
   */
  _buildSiteEntryMessage(cell) {
    const siteName = cell.siteName || '未知地点';
    const terrainDesc = typeof TerrainTypes !== 'undefined'
      ? TerrainTypes.getTerrainDescription(cell.terrain) : '';

    const lines = ['[地图移动]'];
    lines.push(`- 动作：进入「${siteName}」的局部地图`);
    lines.push(`- 坐标：(${cell.col}, ${cell.row})`);
    lines.push(`- 地形类型：${cell.terrain}（${terrainDesc}）`);
    if (cell.siteDescription) lines.push(`- 地点描述：${cell.siteDescription}`);
    lines.push(`- 层级：局部地图`);

    return { message: lines.join('\n'), displayMessage: `进入 ${siteName}` };
  },

  /**
   * Build the full message sent to AI for border crossing.
   */
  _buildBorderCrossMessage(payload) {
    const fromName = window.entityStore?.getDisplayName?.(payload.fromCountryId) || payload.fromCountryId;

    const lines = ['[地图移动]'];
    lines.push(`- 动作：越境`);
    lines.push(`- 出发地：${fromName}`);
    lines.push(`- 目的地：${payload.countryName}`);

    // 获取新位置的地形信息
    if (typeof mapService !== 'undefined') {
      const mapData = mapService.getMapData();
      if (mapData) {
        const playerPos = mapData.getPlayerPosition();
        const currentMap = mapData.getCurrentMap();
        const playerCell = currentMap.find(c => c.row === playerPos.row && c.col === playerPos.col);
        if (playerCell) {
          const terrainDesc = typeof TerrainTypes !== 'undefined'
            ? TerrainTypes.getTerrainDescription(playerCell.terrain) : '';
          lines.push(`- 入境地形：${playerCell.terrain}（${terrainDesc}）`);
        }
      }
    }

    // 新国家背景
    const countryDesc = window.entityStore?.get?.(payload.toCountryId);
    if (countryDesc) {
      const truncated = countryDesc.length > 200 ? countryDesc.substring(0, 200) + '...' : countryDesc;
      lines.push(`- 区域背景：${truncated}`);
    }

    lines.push(`- 层级：世界地图`);
    return lines.join('\n');
  },

  /**
   * Trigger AI turn programmatically (public API for MapInteraction SITE flow).
   * Mirrors the isSending lifecycle of handleSendMessage.
   */
  async triggerAITurn(message, displayMessage) {
    // Guard: check isSending again (in case of race)
    if (window.isSending) return;

    // Set isSending (mirrors handleSendMessage line 1615)
    window.isSending = true;

    try {
      // handleMainlineSendMessage doesn't manage isSending
      if (typeof handleMainlineSendMessage === 'function') {
        await handleMainlineSendMessage(message, displayMessage, {
          actionInputText: message,
          selectedChoicePayload: '',
          selectedChoiceText: '',
        });
      }
    } catch (e) {
      console.error('[MapMovementHandler] AI turn failed:', e);
    } finally {
      // Clear isSending (mirrors handleSendMessage line 1679)
      window.isSending = false;
    }
  },
};

// Auto-init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => mapMovementHandler.init());
} else {
  queueMicrotask(() => mapMovementHandler.init());
}

window.mapMovementHandler = mapMovementHandler;
