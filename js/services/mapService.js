/**
 * mapService — Map management service
 * Wraps MapData, MapGenerator, MapRenderer, MapInteraction
 * Each world card entity = one country with its own 10×10 map.
 * Sites within a country are named by AI.
 */
const mapService = {
  mapData: null,
  initialized: false,
  _initPromise: null, // promise lock to prevent double-init race

  /**
   * Initialize map with world card integration.
   * Each entity = one country. Generates a map for the starting country only (lazy).
   */
  async init() {
    if (this.initialized) return;
    // Prevent concurrent init calls (e.g., rapid map panel opens)
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  },

  async _doInit() {

    const entities = window.entityStore?.list?.() || [];

    this.mapData = new MapData();

    if (entities.length > 0) {
      // First entity = starting country
      const startEntityId = entities[0];
      const siteCount = Math.floor(Math.random() * 3) + 4; // 4-6 sites

      this.mapData.currentCountryId = startEntityId;
      this.mapData.worldMap = MapGenerator.generateWorldMap(siteCount);

      // AI-name the sites based on country entity description
      await this._nameSitesForCurrentCountry(startEntityId);

      // Cache this country's map
      this.mapData.countryMaps[startEntityId] = {
        worldMap: this.mapData.worldMap,
        localMapCache: {},
        worldPlayerPos: { ...this.mapData.worldPlayerPos },
      };
    } else {
      // No entities — fallback: single map with no country
      this.mapData.worldMap = MapGenerator.generateWorldMap(6);
    }

    this.initialized = true;
    console.log(`[MapService] Initialized. Country: ${this.mapData.currentCountryId || 'none'}`);
  },

  /**
   * Name SITE landmarks on the current world map via AI.
   * Uses the country entity description as context.
   */
  async _nameSitesForCurrentCountry(countryEntityId) {
    const sites = this.mapData.worldMap.filter(c => c.landmark === 'SITE');
    if (sites.length === 0) return;

    // Set siteCountryId on all sites
    sites.forEach(s => { s.siteCountryId = countryEntityId; });

    try {
      await this.nameSitesViaAI(sites, countryEntityId);
    } catch (e) {
      console.warn('[MapService] AI site naming failed, using fallback:', e);
      sites.forEach((s, i) => {
        if (!s.siteName) {
          s.siteName = `Site ${i + 1}`;
        }
      });
    }

    console.log('[MapService] Site names:', sites.map(s => s.siteName).join(', '));
  },

  /**
   * Call AI to name SITE landmarks within a country.
   * Uses Step2 model to generate names based on the country entity description.
   * @param {Array} sites - SITE cell objects to name
   * @param {string} countryEntityId - country entity ID for context
   */
  async nameSitesViaAI(sites, countryEntityId) {
    if (!sites || sites.length === 0) return;

    const ai = window.aiService;
    if (!ai || typeof ai._callSummaryAPI !== 'function') {
      throw new Error('aiService not available');
    }

    const countryName = window.entityStore?.getDisplayName?.(countryEntityId) || '';
    const countryDesc = window.entityStore?.get?.(countryEntityId) || '';

    // Truncate long descriptions for prompt efficiency
    const descTruncated = countryDesc.length > 600
      ? countryDesc.substring(0, 600) + '...'
      : countryDesc;

    const { parts } = window.promptRegistry.assembleChannel('mapNaming.sites', {
      countryName,
      descTruncated,
      sitesCount: sites.length,
    });
    const systemPrompt = parts.map(p => p.text).join('\n');

    const messages = [{
      role: 'user',
      content: window.promptRegistry
        .get('mapNaming.sites.triggerMessage')
        .builder({ countryName, sitesCount: sites.length }),
    }];

    const rawResponse = await ai._callSummaryAPI(messages, systemPrompt, 'map_naming');
    const responseText = typeof rawResponse === 'string' ? rawResponse : rawResponse?.text || '';

    let parsed;
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('[MapService] Failed to parse AI SITE naming response:', e);
    }

    if (Array.isArray(parsed)) {
      sites.forEach((site, i) => {
        if (parsed[i]) {
          site.siteName = parsed[i].name || `Site ${i + 1}`;
          site.siteDescription = parsed[i].description || '';
        }
      });
      console.log('[MapService] AI named sites:', parsed.map(p => p.name).join(', '));
    } else {
      // Fallback
      sites.forEach((site, i) => {
        site.siteName = `Site ${i + 1}`;
        site.siteDescription = '';
      });
      console.warn('[MapService] AI response not parseable, used fallback site names');
    }
  },

  /**
   * Switch to a different country.
   * Generates map + AI-names sites if not yet cached.
   * @param {string} entityId - target country entity ID
   */
  async switchToCountry(entityId) {
    if (!this.mapData) return;

    const restored = this.mapData.switchCountry(entityId);

    // Reset local map state
    this.mapData.localMap = [];
    this.mapData.activeLandmark = null;
    this.mapData.layer = 'world';
    this.mapData.localPlayerPos = { row: 0, col: 0 };

    if (restored) {
      console.log(`[MapService] Restored cached map for country: ${entityId}`);
      return;
    }

    // Generate new map for this country
    const siteCount = Math.floor(Math.random() * 3) + 4; // 4-6
    this.mapData.worldMap = MapGenerator.generateWorldMap(siteCount);
    this.mapData.worldPlayerPos = { row: 1, col: 1 };

    await this._nameSitesForCurrentCountry(entityId);

    // Cache the newly generated map
    this.mapData.countryMaps[entityId] = {
      worldMap: this.mapData.worldMap,
      localMapCache: {},
      worldPlayerPos: { ...this.mapData.worldPlayerPos },
    };

    console.log(`[MapService] Generated new map for country: ${entityId}`);
  },

  getMapData() {
    return this.mapData;
  },

  getPlayerPosition() {
    if (!this.mapData) return null;
    return this.mapData.getPlayerPosition();
  },

  getSaveData() {
    if (!this.mapData) return null;
    return this.mapData.toJSON();
  },

  restore(data) {
    if (!data) {
      this.mapData = null;
      this.initialized = false;
      return;
    }
    this.mapData = MapData.fromJSON(data);
    this.initialized = true;
  },

  /**
   * Regenerate world map for the current country.
   * Clears local map cache for this country.
   */
  async regenerateWorldMap() {
    if (!this.mapData) {
      await this.init();
      return;
    }

    const siteCount = Math.floor(Math.random() * 3) + 4; // 4-6
    this.mapData.worldMap = MapGenerator.generateWorldMap(siteCount);
    this.mapData.localMapCache = {};

    const countryEntityId = this.mapData.currentCountryId;
    if (countryEntityId) {
      await this._nameSitesForCurrentCountry(countryEntityId);

      // Update cache
      this.mapData.countryMaps[countryEntityId] = {
        worldMap: this.mapData.worldMap,
        localMapCache: {},
        worldPlayerPos: { ...this.mapData.worldPlayerPos },
      };
    }

    console.log('[MapService] Regenerated world map for country:', countryEntityId || 'none');
  },

  clear() {
    this.mapData = null;
    this.initialized = false;
    this._initPromise = null;
  },

  /**
   * Call AI to name LOCATIONs within a SITE.
   * Uses Step2 model to generate names and descriptions based on SITE context.
   * @param {Array} locations - LOCATION cell objects to name
   * @param {string} siteName - Parent SITE display name
   */
  async nameLocationsViaAI(locations, siteName) {
    if (!locations || locations.length === 0) return;

    const ai = window.aiService;
    if (!ai || typeof ai._callSummaryAPI !== 'function') {
      throw new Error('aiService not available');
    }

    // Build context from current country entity
    const countryEntityId = this.mapData?.currentCountryId;
    const worldName = countryEntityId
      ? (window.entityStore?.getDisplayName?.(countryEntityId) || '')
      : '';

    const { parts } = window.promptRegistry.assembleChannel('mapNaming.locations', {
      worldName,
      siteName,
      locationsCount: locations.length,
    });
    const systemPrompt = parts.map(p => p.text).join('\n');

    const messages = [{
      role: 'user',
      content: window.promptRegistry
        .get('mapNaming.locations.triggerMessage')
        .builder({ siteName, locationsCount: locations.length }),
    }];

    const rawResponse = await ai._callSummaryAPI(messages, systemPrompt, 'map_naming');
    const responseText = typeof rawResponse === 'string' ? rawResponse : rawResponse?.text || '';

    // Parse JSON from response (handle markdown code blocks)
    let parsed;
    try {
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.warn('[MapService] Failed to parse AI LOCATION naming response:', e);
    }

    if (Array.isArray(parsed)) {
      locations.forEach((loc, i) => {
        if (parsed[i]) {
          loc.locationName = parsed[i].name || `Location ${i + 1}`;
          loc.locationDescription = parsed[i].description || '';
        }
      });
      console.log('[MapService] AI named locations:', parsed.map(p => p.name).join(', '));
    } else {
      // Fallback
      locations.forEach((loc, i) => {
        loc.locationName = `Location ${i + 1}`;
        loc.locationDescription = '';
      });
      console.warn('[MapService] AI response not parseable, used fallback names');
    }
  }
};

// promptRegistry 的 mapNaming 注册已抽出到 js/services/mapServicePromptBootstrap.js
// （让浏览器 / headless / promptviewer 三处共享同一份 register，避免 mirror drift）

// No longer auto-init on DOMContentLoaded — init is called explicitly
// after world card is loaded (e.g., from game.js or session restore)

// Export
window.mapService = mapService;

// Register with ServiceRegistry
ServiceRegistry.register('mapData', mapService);

console.log('[MapService] Loaded');
