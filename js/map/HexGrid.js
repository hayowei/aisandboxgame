/**
 * HexGrid — Hex geometry utilities (pointy-top, offset coordinates)
 * Ported from hex-map-generator App.tsx
 */
(function(global) {
  'use strict';

  const HEX_SIZE = 28;
  const HEX_WIDTH = Math.sqrt(3) * HEX_SIZE;
  const HEX_HEIGHT = 2 * HEX_SIZE;

  // Pointy-top polygon vertices (6 points), as SVG points string
  const hexPoints = [
    [HEX_WIDTH / 2, HEX_HEIGHT / 4],
    [0, HEX_HEIGHT / 2],
    [-HEX_WIDTH / 2, HEX_HEIGHT / 4],
    [-HEX_WIDTH / 2, -HEX_HEIGHT / 4],
    [0, -HEX_HEIGHT / 2],
    [HEX_WIDTH / 2, -HEX_HEIGHT / 4],
  ].map(p => `${p[0]},${p[1]}`).join(' ');

  /**
   * Check if two hex cells are adjacent (offset coordinates, odd-row right shift)
   */
  function isAdjacent(r1, c1, r2, c2) {
    if (r1 === r2) return Math.abs(c1 - c2) === 1;
    if (Math.abs(r1 - r2) === 1) {
      if (r1 % 2 === 0) return c2 === c1 || c2 === c1 - 1;
      else return c2 === c1 || c2 === c1 + 1;
    }
    return false;
  }

  /**
   * Convert hex (row, col) to pixel center position for SVG rendering
   */
  function hexToPixel(row, col) {
    const cx = (col + 0.5) * HEX_WIDTH + (row % 2 === 1 ? HEX_WIDTH / 2 : 0);
    const cy = (row * 0.75 + 0.5) * HEX_HEIGHT;
    return { x: cx, y: cy };
  }

  /**
   * Get all adjacent cells for a given position from a map cell array
   */
  function getAdjacentCells(row, col, mapCells) {
    return mapCells.filter(cell => isAdjacent(row, col, cell.row, cell.col));
  }

  global.HexGrid = {
    HEX_SIZE,
    HEX_WIDTH,
    HEX_HEIGHT,
    hexPoints,
    isAdjacent,
    hexToPixel,
    getAdjacentCells,
  };
})(typeof window !== 'undefined' ? window : this);
