/**
 * TerrainTypes — 5 abstract terrain types
 * Ported from hex-map-generator App.tsx
 */
(function(global) {
  'use strict';

  const TERRAIN_COLORS = { /* ui-lint-allow */
    A: '#22c55e', // Base/Clear (Green)  /* ui-lint-allow */
    B: '#71717a', // Block/Highland (Gray)  /* ui-lint-allow */
    C: '#3b82f6', // Liquid/Special (Blue)  /* ui-lint-allow */
    D: '#ef4444', // Danger/Obstacle (Red)  /* ui-lint-allow */
    E: '#ffffff', // Border (White)
  };

  const TERRAIN_NAMES = {
    A: 'Type A (常规/通行区域)',
    B: 'Type B (阻隔/不可通行)',
    C: 'Type C (流体/介质区域)',
    D: 'Type D (特殊/异常区域)',
    E: 'Type E (边界/未知区域)',
  };

  const TERRAIN_DESCRIPTIONS = {
    A: '常规地形，可正常通行与活动的区域。',
    B: '阻隔地形，无法通行的障碍或虚空区域。',
    C: '流体介质，河流、岩浆、星云等流动性区域。',
    D: '特殊地形，存在潜在危险或异常效应的区域。',
    E: '边界区域，地图边缘，可通往其他区域。',
  };

  function getTerrainColor(terrain) {
    return TERRAIN_COLORS[terrain] || TERRAIN_COLORS.A;
  }

  function getTerrainName(terrain) {
    return TERRAIN_NAMES[terrain] || terrain;
  }

  function getTerrainDescription(terrain) {
    return TERRAIN_DESCRIPTIONS[terrain] || '';
  }

  global.TerrainTypes = {
    TERRAIN_COLORS,
    TERRAIN_NAMES,
    TERRAIN_DESCRIPTIONS,
    getTerrainColor,
    getTerrainName,
    getTerrainDescription
  };
})(typeof window !== 'undefined' ? window : this);
