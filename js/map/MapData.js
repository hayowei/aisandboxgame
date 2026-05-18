/**
 * MapData — Map data structures
 * Supports per-country map storage: each world card entity = one country with its own 10×10 map.
 */
(function(global) {
  'use strict';

  class MapData {
    constructor() {
      this.currentCountryId = null; // entity ID of the current country
      this.countryMaps = {}; // per-country cache: { [entityId]: { worldMap, localMapCache, worldPlayerPos } }
      this.worldMap = [];
      this.localMap = [];
      this.localMapCache = {}; // key: landmarkId, value: localMap array (preserves LOCATION names across visits)
      this.layer = 'world'; // 'world' | 'local'
      this.worldPlayerPos = { row: 1, col: 1 };
      this.localPlayerPos = { row: 0, col: 0 };
      this.activeLandmark = null;
    }

    getCurrentMap() {
      return this.layer === 'world' ? this.worldMap : this.localMap;
    }

    getPlayerPosition() {
      return this.layer === 'world' ? this.worldPlayerPos : this.localPlayerPos;
    }

    setPlayerPosition(row, col) {
      if (this.layer === 'world') {
        this.worldPlayerPos = { row, col };
      } else {
        this.localPlayerPos = { row, col };
      }
    }

    /**
     * Switch to a different country.
     * Saves current country data to countryMaps, then loads the target country.
     * @param {string} entityId - target country entity ID
     * @returns {boolean} true if target country had cached data (restored), false if new (caller must generate)
     */
    switchCountry(entityId) {
      // Save current country data back to countryMaps
      if (this.currentCountryId) {
        this.countryMaps[this.currentCountryId] = {
          worldMap: this.worldMap,
          localMapCache: this.localMapCache,
          worldPlayerPos: { ...this.worldPlayerPos },
        };
      }

      this.currentCountryId = entityId;

      // Load target country if cached
      const cached = this.countryMaps[entityId];
      if (cached) {
        this.worldMap = cached.worldMap || [];
        this.localMapCache = cached.localMapCache || {};
        this.worldPlayerPos = cached.worldPlayerPos || { row: 1, col: 1 };
        return true;
      }

      // New country — reset to empty (caller must generate map)
      this.worldMap = [];
      this.localMapCache = {};
      this.worldPlayerPos = { row: 1, col: 1 };
      return false;
    }

    toJSON() {
      // Flush current country data to countryMaps before serializing
      if (this.currentCountryId) {
        this.countryMaps[this.currentCountryId] = {
          worldMap: this.worldMap,
          localMapCache: this.localMapCache,
          worldPlayerPos: { ...this.worldPlayerPos },
        };
      }

      return {
        currentCountryId: this.currentCountryId,
        countryMaps: this.countryMaps,
        localMap: this.localMap,
        layer: this.layer,
        localPlayerPos: this.localPlayerPos,
        activeLandmark: this.activeLandmark,
      };
    }

    static fromJSON(data) {
      const md = new MapData();
      if (!data) return md;

      // New format: has countryMaps
      if (data.countryMaps) {
        md.currentCountryId = data.currentCountryId || null;
        md.countryMaps = data.countryMaps || {};
        md.localMap = data.localMap || [];
        md.layer = data.layer || 'world';
        md.localPlayerPos = data.localPlayerPos || { row: 0, col: 0 };
        md.activeLandmark = data.activeLandmark || null;

        // Restore current country's direct properties from countryMaps
        const cached = md.currentCountryId ? md.countryMaps[md.currentCountryId] : null;
        if (cached) {
          md.worldMap = cached.worldMap || [];
          md.localMapCache = cached.localMapCache || {};
          md.worldPlayerPos = cached.worldPlayerPos || { row: 1, col: 1 };
        }
        return md;
      }

      // Legacy format: flat worldMap / localMapCache — wrap as single _legacy country
      md.worldMap = data.worldMap || [];
      md.localMap = data.localMap || [];
      md.localMapCache = data.localMapCache || {};
      md.layer = data.layer || 'world';
      md.worldPlayerPos = data.worldPlayerPos || { row: 1, col: 1 };
      md.localPlayerPos = data.localPlayerPos || { row: 0, col: 0 };
      md.activeLandmark = data.activeLandmark || null;

      // Wrap legacy data as a single country
      md.currentCountryId = '_legacy';
      md.countryMaps = {
        _legacy: {
          worldMap: md.worldMap,
          localMapCache: md.localMapCache,
          worldPlayerPos: { ...md.worldPlayerPos },
        },
      };

      return md;
    }
  }

  global.MapData = MapData;
})(typeof window !== 'undefined' ? window : this);
