/**
 * MapRenderer — SVG-based hex map renderer
 * Ported from hex-map-generator App.tsx
 */
(function(global) {
  'use strict';

  // SVG namespace
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // SVG path for flag icon (simplified from lucide Flag)
  const FLAG_PATH = 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7';
  // SVG path for user icon (simplified from lucide User)
  const USER_PATH = 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';

  class MapRenderer {
    constructor(container) {
      this.container = container;
      this.svg = null;
      this.mapData = [];
      this.playerPos = { row: 0, col: 0 };
      this.onHexClick = null;
    }

    /**
     * Render the map into the container
     */
    render(mapData, playerPos, rows, cols, onHexClick, animate) {
      this.mapData = mapData;
      this.playerPos = playerPos;
      this.onHexClick = onHexClick;

      // Clear previous SVG
      this.container.innerHTML = '';

      const { HEX_WIDTH, HEX_HEIGHT, hexPoints } = HexGrid;

      const svgWidth = (cols + 0.5) * HEX_WIDTH + 20;
      const svgHeight = (rows * 0.75 + 0.25) * HEX_HEIGHT + 20;

      // Create SVG element
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', svgWidth);
      svg.setAttribute('height', svgHeight);
      svg.setAttribute('viewBox', `-10 -10 ${svgWidth} ${svgHeight}`);
      svg.classList.add('hex-map-svg');

      // Render each hex cell
      mapData.forEach((cell, index) => {
        const { x: cx, y: cy } = HexGrid.hexToPixel(cell.row, cell.col);
        const isPlayerHere = playerPos.row === cell.row && playerPos.col === cell.col;
        const isAdj = HexGrid.isAdjacent(playerPos.row, playerPos.col, cell.row, cell.col);

        // Outer group for positioning (SVG transform attribute)
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('transform', `translate(${cx}, ${cy})`);

        // Inner group for CSS animation (keeps position separate from animation transform)
        const inner = document.createElementNS(SVG_NS, 'g');
        if (animate) {
          inner.classList.add('hex-cell-enter');
          inner.style.animationDelay = `${index * 0.005}s`;
        }

        // Hex polygon
        const polygon = document.createElementNS(SVG_NS, 'polygon');
        polygon.setAttribute('points', hexPoints);
        polygon.setAttribute('fill', TerrainTypes.getTerrainColor(cell.terrain));

        let stroke, strokeWidth;
        if (cell.terrain === 'E') {
          stroke = isAdj ? 'var(--overlay-20)' : 'var(--overlay-8)';
        } else {
          stroke = isAdj ? 'var(--sheen-80)' : 'var(--sheen-20)';
        }
        strokeWidth = isAdj ? '3' : '2';

        polygon.style.stroke = stroke; // ui-lint-allow
        polygon.setAttribute('stroke-width', strokeWidth);

        polygon.style.cursor = 'pointer';
        polygon.classList.add('hex-polygon');

        inner.appendChild(polygon);

        // Landmark flag icon + name label
        if (cell.landmark) {
          const flagG = document.createElementNS(SVG_NS, 'g');
          if (isPlayerHere) {
            flagG.setAttribute('transform', 'translate(6, -18)');
          } else {
            flagG.setAttribute('transform', 'translate(-10, -10)');
          }

          const flagSvg = document.createElementNS(SVG_NS, 'svg');
          const flagSize = isPlayerHere ? 16 : 20;
          flagSvg.setAttribute('width', flagSize);
          flagSvg.setAttribute('height', flagSize);
          flagSvg.setAttribute('viewBox', '0 0 24 24');
          flagSvg.setAttribute('fill', 'none');
          flagSvg.style.stroke = 'var(--brand-yellow)'; // ui-lint-allow
          flagSvg.setAttribute('stroke-width', '2');
          flagSvg.setAttribute('stroke-linecap', 'round');
          flagSvg.setAttribute('stroke-linejoin', 'round');

          const flagPath = document.createElementNS(SVG_NS, 'path');
          flagPath.setAttribute('d', FLAG_PATH);
          flagSvg.appendChild(flagPath);
          flagG.appendChild(flagSvg);
          inner.appendChild(flagG);

          // Name label below the hex
          const labelText = cell.siteName || cell.locationName || null;
          if (labelText) {
            const label = document.createElementNS(SVG_NS, 'text');
            label.setAttribute('x', '0');
            label.setAttribute('y', String(HEX_HEIGHT * 0.38));
            label.setAttribute('text-anchor', 'middle');
            label.style.fill = 'var(--brand-yellow)'; // ui-lint-allow
            label.setAttribute('font-size', '9');
            label.setAttribute('font-weight', '600');
            label.style.stroke = 'var(--overlay-60)'; // ui-lint-allow
            label.setAttribute('stroke-width', '2.5');
            label.setAttribute('paint-order', 'stroke');
            // Truncate long names
            const displayLabel = labelText.length > 6 ? labelText.substring(0, 5) + '…' : labelText;
            label.textContent = displayLabel;
            inner.appendChild(label);
          }
        }

        // Player icon
        if (isPlayerHere) {
          const playerCircle = document.createElementNS(SVG_NS, 'circle');
          playerCircle.setAttribute('cx', '0');
          playerCircle.setAttribute('cy', '0');
          playerCircle.setAttribute('r', '14');
          playerCircle.setAttribute('fill', 'white');
          playerCircle.classList.add('hex-player-circle');
          inner.appendChild(playerCircle);

          const userSvg = document.createElementNS(SVG_NS, 'svg');
          userSvg.setAttribute('x', '-10');
          userSvg.setAttribute('y', '-10');
          userSvg.setAttribute('width', '20');
          userSvg.setAttribute('height', '20');
          userSvg.setAttribute('viewBox', '0 0 24 24');
          userSvg.setAttribute('fill', 'none');
          userSvg.style.stroke = 'var(--brand-primary)'; // ui-lint-allow
          userSvg.setAttribute('stroke-width', '2');
          userSvg.setAttribute('stroke-linecap', 'round');
          userSvg.setAttribute('stroke-linejoin', 'round');

          const userPath = document.createElementNS(SVG_NS, 'path');
          userPath.setAttribute('d', USER_PATH);
          userSvg.appendChild(userPath);
          inner.appendChild(userSvg);
        }

        g.appendChild(inner);

        // Click handler — deferred to next frame so the click event fully
        // propagates before render() tears down and recreates the SVG DOM
        g.addEventListener('click', () => {
          if (this.onHexClick) {
            const rect = g.getBoundingClientRect();
            requestAnimationFrame(() => {
              this.onHexClick(cell, isAdj, isPlayerHere, rect);
            });
          }
        });

        svg.appendChild(g);
      });

      this.container.appendChild(svg);
      this.svg = svg;
    }
  }

  global.MapRenderer = MapRenderer;
})(typeof window !== 'undefined' ? window : this);
