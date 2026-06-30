/**
 * MapGenerator — Simplex noise map generation
 * Ported from hex-map-generator App.tsx
 */
(function(global) {
  'use strict';

  const WORLD_ROWS = 10;
  const WORLD_COLS = 10;
  const LOCAL_ROWS = 4;
  const LOCAL_COLS = 4;

  function generateWorldMap(siteCount = 6) {
    const map = [];
    const noise2D = createNoise2D();
    const scale = 0.25;

    for (let row = 0; row < WORLD_ROWS; row++) {
      for (let col = 0; col < WORLD_COLS; col++) {
        if (row === 0 || row === WORLD_ROWS - 1 || col === 0 || col === WORLD_COLS - 1) {
          map.push({ id: `world-${row}-${col}`, row, col, terrain: 'E' });
          continue;
        }

        const noiseValue = noise2D((col - 1) * scale, (row - 1) * scale);

        let terrain;
        if (noiseValue < -0.3) {
          terrain = 'C';
        } else if (noiseValue < 0.3) {
          terrain = 'A';
        } else if (noiseValue < 0.65) {
          terrain = 'B';
        } else {
          terrain = 'D';
        }

        map.push({ id: `world-${row}-${col}`, row, col, terrain });
      }
    }

    const getCell = (r, c) => map.find(cell => cell.row === r && cell.col === c);

    // Place SITE landmarks (count driven by world card)
    let smallLandmarksPlaced = 0;
    let attempts = 0;
    while (smallLandmarksPlaced < siteCount && attempts < 100) {
      attempts++;
      const row = Math.floor(Math.random() * (WORLD_ROWS - 2)) + 1;
      const col = Math.floor(Math.random() * (WORLD_COLS - 2)) + 1;
      const cell = getCell(row, col);

      if (cell && !cell.landmark) {
        cell.landmark = 'SITE';
        cell.landmarkId = `site-${smallLandmarksPlaced}`;
        smallLandmarksPlaced++;
      }
    }

    return map;
  }

  function generateLocalMap(baseTerrain, locationCount = 3) {
    const map = [];
    for (let row = 0; row < LOCAL_ROWS; row++) {
      for (let col = 0; col < LOCAL_COLS; col++) {
        map.push({ id: `local-${row}-${col}`, row, col, terrain: baseTerrain });
      }
    }

    const getCell = (r, c) => map.find(cell => cell.row === r && cell.col === c);

    // Place LOCATION landmarks (count driven by caller)
    let smallLandmarksPlaced = 0;
    let attempts = 0;
    while (smallLandmarksPlaced < locationCount && attempts < 50) {
      attempts++;
      const row = Math.floor(Math.random() * LOCAL_ROWS);
      const col = Math.floor(Math.random() * LOCAL_COLS);
      const cell = getCell(row, col);

      if (cell && !cell.landmark) {
        cell.landmark = 'LOCATION';
        cell.landmarkId = `local-location-${smallLandmarksPlaced}`;
        smallLandmarksPlaced++;
      }
    }

    return map;
  }

  global.MapGenerator = {
    WORLD_ROWS,
    WORLD_COLS,
    LOCAL_ROWS,
    LOCAL_COLS,
    generateWorldMap,
    generateLocalMap
  };
})(typeof window !== 'undefined' ? window : this);
