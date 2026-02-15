import { createHexGrid, hitTest, cellVertices, type HexCell } from '../core/hex-grid';
import { isInAsymmetricUnit } from '../core/symmetry';
import type { GameState } from '../game/state';

export interface HemisphereDisc {
  canvas: HTMLCanvasElement;
  grid: HexCell[];
  isTop: boolean;
  redraw(): void;
  destroy(): void;
}

/**
 * NCC value → RGB color. Blue (low) → Yellow (mid) → Red (high).
 */
function nccColor(nccNorm: number): string {
  let r: number, g: number, b: number;
  if (nccNorm < 0.5) {
    const t = nccNorm * 2;
    r = Math.round(66 + t * (255 - 66));
    g = Math.round(66 + t * (220 - 66));
    b = Math.round(220 - t * 170);
  } else {
    const t = (nccNorm - 0.5) * 2;
    r = 255;
    g = Math.round(220 - t * 180);
    b = Math.round(50 - t * 50);
  }
  return `rgb(${r},${g},${b})`;
}

export interface DiscCallbacks {
  onCellSelected(cell: HexCell): void;
}

function isDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function createHemisphereDisc(
  canvas: HTMLCanvasElement,
  gridSpacingDeg: number,
  isTop: boolean,
  symmetry: string,
  state: GameState,
  callbacks: DiscCallbacks,
): HemisphereDisc {
  const grid = createHexGrid(gridSpacingDeg, isTop);
  const asuGrid = grid.filter((c) => isInAsymmetricUnit(c.rot, c.tilt, symmetry));
  let hoveredCell: HexCell | null = null;
  let dragging = false;
  const ac = new AbortController();

  function discLayout() {
    const radius = Math.min(canvas.width, canvas.height) / 2 - 4;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return { cx, cy, radius };
  }

  function eventToDisc(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX;
    const py = (e.clientY - rect.top) * scaleY;
    const { cx, cy, radius } = discLayout();
    const x = (px - cx) / radius;
    const y = -(py - cy) / radius;
    return { x, y };
  }

  function trySelect(e: MouseEvent) {
    const { x, y } = eventToDisc(e);
    const cell = hitTest(x, y, asuGrid, gridSpacingDeg);
    if (cell && !(state.currentCell?.q === cell.q && state.currentCell?.r === cell.r && state.currentCell?.isTop === cell.isTop)) {
      callbacks.onCellSelected(cell);
    }
  }

  function redraw() {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    const { cx, cy, radius } = discLayout();
    const dark = isDark();

    ctx.clearRect(0, 0, w, h);

    // Clip to disc circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.clip();

    const hasRange = state.nccMin < state.nccMax;
    const range = state.nccMax - state.nccMin || 1;

    // Only draw ASU cells
    for (const cell of asuGrid) {
      const verts = cellVertices(cell, gridSpacingDeg);
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        const px = cx + verts[i][0] * radius;
        const py = cy - verts[i][1] * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      const isSelected =
        state.currentCell &&
        state.currentCell.q === cell.q &&
        state.currentCell.r === cell.r &&
        state.currentCell.isTop === cell.isTop;

      const isHovered =
        hoveredCell &&
        hoveredCell.q === cell.q &&
        hoveredCell.r === cell.r;

      const bestNcc = state.getBestNccForCell(cell);

      if (bestNcc !== null && hasRange) {
        const norm = (bestNcc - state.nccMin) / range;
        ctx.fillStyle = nccColor(norm);
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      } else if (isHovered) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
        ctx.fill();
      }

      // Cell outline
      ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 0.5;
      ctx.stroke();

      if (isSelected) {
        ctx.strokeStyle = dark ? '#fff' : '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.restore(); // remove clip

    // Draw disc border on top
    ctx.strokeStyle = dark ? '#555' : '#bbb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      dragging = true;
      trySelect(e);
    }
  }, { signal: ac.signal });

  canvas.addEventListener('mousemove', (e) => {
    if (dragging) {
      trySelect(e);
    }
    const { x, y } = eventToDisc(e);
    const cell = hitTest(x, y, asuGrid, gridSpacingDeg);
    const prev = hoveredCell;
    hoveredCell = cell;
    if (prev?.q !== cell?.q || prev?.r !== cell?.r) {
      redraw();
    }
  }, { signal: ac.signal });

  canvas.addEventListener('mouseup', () => {
    dragging = false;
  }, { signal: ac.signal });

  canvas.addEventListener('mouseleave', () => {
    dragging = false;
    hoveredCell = null;
    redraw();
  }, { signal: ac.signal });

  return {
    canvas,
    grid: asuGrid,
    isTop,
    redraw,
    destroy: () => ac.abort(),
  };
}
