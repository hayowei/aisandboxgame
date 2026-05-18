// ============================================
// Location Tracker Service - 位置追踪服务
// ============================================

class LocationTracker {
  constructor() {
    this.currentLocation = null; // { country, site, spot }
    this.mapCoordinates = null; // { row, col, terrain, layer, landmark, landmarkId, siteName, locationName }
    this.locationEnterTurn = 0; // 进入当前位置时的 turn
    this.scenesToday = 1; // 今日经过的场景数
    this.currentDay = null; // 当前日期字符串 (用于检测日期变化)
  }

  // 从 AI 回复的 panel_status.location 更新位置
  // 检测位置变化，如有变化则重置停留计数
  // datetime: { year, month, day } 用于检测日期变化
  updateFromResponse(location, currentTurn, datetime) {
    // 检测日期变化，重置今日场景计数
    let dayChanged = false;
    if (datetime) {
      const safeMonth = Number.isFinite(Number.parseInt(datetime.month, 10))
        ? Number.parseInt(datetime.month, 10)
        : 1;
      const safeDay = Number.isFinite(Number.parseInt(datetime.day, 10))
        ? Number.parseInt(datetime.day, 10)
        : 1;
      const dayStr = `${datetime.year}-${safeMonth}-${safeDay}`;
      if (this.currentDay && this.currentDay !== dayStr) {
        this.scenesToday = 1;
        dayChanged = true;
        console.log(`[LocationTracker] 日期变化 (${this.currentDay} → ${dayStr})，重置今日场景数`);
      }
      this.currentDay = dayStr;
    }

    // 检测位置变化
    const hasChanged = this._hasLocationChanged(location);
    if (hasChanged) {
      this.locationEnterTurn = currentTurn;
      // 只有当之前已有位置、且不是日期变化导致的重置时，才增加计数
      // （首次设置位置不算"切换场景"，跨日到达新地点算"今日第1个场景"）
      if (this.currentLocation && !dayChanged) {
        this.scenesToday++;
        console.log(
          `[LocationTracker] 位置变化，今日第${this.scenesToday}个场景 (Turn ${currentTurn})`
        );
      } else if (!this.currentLocation) {
        console.log(`[LocationTracker] 首次设置位置 (Turn ${currentTurn})`);
      } else {
        console.log(`[LocationTracker] 跨日到达新地点，今日第1个场景 (Turn ${currentTurn})`);
      }
    }
    if (location && (location.country || location.site || location.spot)) {
      this.currentLocation = location;
      console.log('[LocationTracker] 位置已更新:', this.currentLocation);
    }
  }

  // 手动编辑位置（不重置停留计数）
  updateManually(location) {
    if (location && (location.country || location.site || location.spot)) {
      this.currentLocation = location;
      console.log('[LocationTracker] 手动更新位置（不重置计数）');
    }
  }

  // 从地图位置更新（地图是位置权威源）
  // 同步更新 mapCoordinates 和 currentLocation（映射到 country/site/spot）
  updateFromMapPosition(mapPosition) {
    if (!mapPosition) return;

    this.mapCoordinates = {
      row: mapPosition.row,
      col: mapPosition.col,
      terrain: mapPosition.terrain,
      layer: mapPosition.layer,
      landmark: mapPosition.landmark || null,
      landmarkId: mapPosition.landmarkId || null,
      siteName: mapPosition.siteName || null,
      locationName: mapPosition.locationName || null,
    };

    // Map position → {country, site, spot} mapping
    const countryEntityId = window.mapService?.getMapData?.()?.currentCountryId;
    const countryName = countryEntityId
      ? (window.entityStore?.getDisplayName?.(countryEntityId) || '')
      : '';

    let newLocation;
    if (mapPosition.layer === 'local' && mapPosition.landmark === 'LOCATION') {
      // In local map on a LOCATION → have spot
      const activeLandmark = window.mapService?.getMapData?.()?.activeLandmark;
      newLocation = {
        country: countryName,
        site: activeLandmark?.siteName || mapPosition.siteName || '',
        spot: mapPosition.locationName || '',
      };
    } else if (mapPosition.layer === 'local') {
      // In local map but not on a LOCATION
      const activeLandmark = window.mapService?.getMapData?.()?.activeLandmark;
      newLocation = {
        country: countryName,
        site: activeLandmark?.siteName || '',
        spot: '',
      };
    } else if (mapPosition.landmark === 'SITE') {
      // On world map at a SITE
      newLocation = {
        country: countryName,
        site: mapPosition.siteName || '',
        spot: '',
      };
    } else {
      // On world map, no landmark
      newLocation = {
        country: countryName,
        site: '',
        spot: '',
      };
    }

    this.currentLocation = newLocation;
    console.log('[LocationTracker] 从地图更新位置:', this.currentLocation);
  }

  // Rollback 恢复（保守估计，假设刚进入该位置）
  restoreToTurn(location, targetTurn) {
    this.currentLocation = location;
    this.locationEnterTurn = targetTurn;
    console.log(`[LocationTracker] Rollback 到 Turn ${targetTurn}:`, location);
  }

  // 检测位置是否发生变化
  _hasLocationChanged(newLocation) {
    if (!this.currentLocation || !newLocation) return true;
    const eStore = typeof window !== 'undefined' ? window.entityStore : null;
    const normalize =
      typeof eStore?.normalizeLocationForCompare === 'function'
        ? eStore.normalizeLocationForCompare.bind(eStore)
        : location => ({
            country: (location?.country || '').trim(),
            site: (location?.site || '').trim(),
            spot: (location?.spot || '').trim(),
          });

    const current = normalize(this.currentLocation);
    const next = normalize(newLocation);

    return (
      current.country !== next.country || current.site !== next.site || current.spot !== next.spot
    );
  }

  // 获取当前位置
  getLocation() {
    return this.currentLocation;
  }

  // 获取在当前位置停留的回合数
  getTurnsAtLocation(currentTurn) {
    if (!this.currentLocation) return 0;
    return Math.max(1, currentTurn - this.locationEnterTurn + 1);
  }

  // 获取今日经过的场景数
  getScenesToday() {
    return this.scenesToday;
  }

  // 获取存档数据（新格式）
  getSaveData() {
    return {
      current: this.currentLocation,
      mapCoordinates: this.mapCoordinates,
      enterTurn: this.locationEnterTurn,
      scenesToday: this.scenesToday,
      currentDay: this.currentDay,
    };
  }

  // 从存档恢复位置（兼容新旧格式）
  restore(savedData) {
    // 先清空，避免旧状态残留
    this.clear();

    if (!savedData || typeof savedData !== 'object') {
      return;
    }

    const hasOwn = key => Object.prototype.hasOwnProperty.call(savedData, key);

    if (hasOwn('current')) {
      // 新格式：{ current, enterTurn, scenesToday, currentDay }；允许 current 为 null
      this.currentLocation = savedData.current ?? null;

      const parsedEnterTurn = Number.parseInt(savedData.enterTurn, 10);
      if (hasOwn('enterTurn') && Number.isFinite(parsedEnterTurn)) {
        this.locationEnterTurn = parsedEnterTurn;
      }

      const parsedScenesToday = Number.parseInt(savedData.scenesToday, 10);
      if (hasOwn('scenesToday') && Number.isFinite(parsedScenesToday)) {
        this.scenesToday = parsedScenesToday;
      }

      if (hasOwn('currentDay')) {
        this.currentDay = savedData.currentDay ?? null;
      }
      if (hasOwn('mapCoordinates')) {
        this.mapCoordinates = savedData.mapCoordinates ?? null;
      }
    } else if (savedData.country || savedData.site || savedData.spot) {
      // 旧格式：savedData 直接是 location 对象
      this.currentLocation = savedData;
    }

    console.log(
      '[LocationTracker] 已从存档恢复:',
      this.currentLocation,
      '进入回合:',
      this.locationEnterTurn,
      '今日场景:',
      this.scenesToday
    );
  }

  // 清空位置(重置游戏时调用)
  clear() {
    this.currentLocation = null;
    this.mapCoordinates = null;
    this.locationEnterTurn = 0;
    this.scenesToday = 1;
    this.currentDay = null;
  }
}

// 创建全局实例
const locationTracker = new LocationTracker();

// 注册到服务中心
ServiceRegistry.register('location', locationTracker);
