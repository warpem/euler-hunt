import { createHexGrid, hitTest, cellVertices, type HexCell } from '../core/hex-grid';
import { discToSphere } from '../core/lambert';
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

/**
 * Compute the ASU boundary as a polygon in disc coordinates ([-1,1]).
 * Uses radial scanning + binary search from the pole outward.
 * Returns null if the full disc is the ASU (C1) or the pole isn't in the ASU.
 */
function computeAsuBoundary(isTop: boolean, symmetry: string): [number, number][] | null {
  if (symmetry.toUpperCase() === 'C1') return null;

  // If the disc center (pole) is not in the ASU, skip clipping
  const { rot: cRot, tilt: cTilt } = discToSphere(0, 0, isTop);
  if (!isInAsymmetricUnit(cRot, cTilt, symmetry)) return null;

  const n = 720;
  const points: [number, number][] = [];

  for (let i = 0; i <= n; i++) {
    const angle = (2 * Math.PI * i) / n;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    // Check if the disc edge in this direction is in the ASU
    const { rot: eRot, tilt: eTilt } = discToSphere(dx * 0.999, dy * 0.999, isTop);
    if (isInAsymmetricUnit(eRot, eTilt, symmetry)) {
      points.push([dx, dy]);
      continue;
    }

    // Binary search for the boundary radius
    let lo = 0, hi = 1;
    for (let iter = 0; iter < 24; iter++) {
      const mid = (lo + hi) / 2;
      const { rot, tilt } = discToSphere(dx * mid, dy * mid, isTop);
      if (isInAsymmetricUnit(rot, tilt, symmetry)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    points.push([dx * lo, dy * lo]);
  }

  return points;
}

export function createHemisphereDisc(
  canvas: HTMLCanvasElement,
  gridSpacingDeg: number,
  isTop: boolean,
  symmetry: string,
  state: GameState,
  callbacks: DiscCallbacks,
): HemisphereDisc {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.style.width ? parseInt(canvas.style.width) : canvas.width;
  const cssH = canvas.style.height ? parseInt(canvas.style.height) : canvas.height;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const grid = createHexGrid(gridSpacingDeg, isTop);
  const asuGrid = grid.filter((c) => {
    if (isInAsymmetricUnit(c.rot, c.tilt, symmetry)) return true;
    // Include boundary cells: keep if any vertex maps into the ASU
    const verts = cellVertices(c, gridSpacingDeg);
    return verts.some(([vx, vy]) => {
      if (vx * vx + vy * vy > 1.0) return false;
      const { rot, tilt } = discToSphere(vx, vy, isTop);
      return isInAsymmetricUnit(rot, tilt, symmetry);
    });
  });
  const asuBoundary = computeAsuBoundary(isTop, symmetry);
  let hoveredCell: HexCell | null = null;
  let dragging = false;
  const ac = new AbortController();

  // Magnifier constants and state
  const zoom = 30 / gridSpacingDeg;
  const magnifierEnabled = zoom > 1;
  const magnifierRadiusCSS = 80;
  const angSpacingRad = (gridSpacingDeg * Math.PI) / 180;
  const hexSize = angSpacingRad * 0.65;
  let magnifierActive = false;
  let logicalDiscPos = { x: 0, y: 0 };
  let mouseClientPos = { x: 0, y: 0 };
  let prevMouseDisc = { x: 0, y: 0 };

  // Floating magnifier overlay canvas
  let magCanvas: HTMLCanvasElement | null = null;

  function createMagCanvas(): HTMLCanvasElement {
    const mc = document.createElement('canvas');
    const size = magnifierRadiusCSS * 2;
    mc.width = size * dpr;
    mc.height = size * dpr;
    mc.style.width = `${size}px`;
    mc.style.height = `${size}px`;
    mc.style.position = 'fixed';
    mc.style.pointerEvents = 'none';
    mc.style.zIndex = '9999';
    document.body.appendChild(mc);
    magCanvas = mc;
    return mc;
  }

  function removeMagCanvas() {
    if (magCanvas) {
      magCanvas.remove();
      magCanvas = null;
    }
  }

  function positionMagCanvas() {
    if (!magCanvas) return;
    magCanvas.style.left = `${mouseClientPos.x - magnifierRadiusCSS}px`;
    magCanvas.style.top = `${mouseClientPos.y - magnifierRadiusCSS}px`;
  }

  function discLayout() {
    const radius = Math.min(cssW, cssH) / 2 - 4;
    const cx = cssW / 2;
    const cy = cssH / 2;
    return { cx, cy, radius };
  }

  function eventToDisc(e: { clientX: number; clientY: number }) {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * cssW;
    const py = (e.clientY - rect.top) / rect.height * cssH;
    const { cx, cy, radius } = discLayout();
    const x = (px - cx) / radius;
    const y = -(py - cy) / radius;
    return { x, y };
  }

  function selectCell(discX: number, discY: number) {
    const cell = hitTest(discX, discY, asuGrid, gridSpacingDeg);
    if (cell && !(state.currentCell?.q === cell.q && state.currentCell?.r === cell.r && state.currentCell?.isTop === cell.isTop)) {
      callbacks.onCellSelected(cell);
    }
  }

  function trySelect(e: { clientX: number; clientY: number }) {
    const { x, y } = eventToDisc(e);
    selectCell(x, y);
  }

  /** Draw hex cells with configurable transform for normal and magnifier views. */
  function drawCells(
    ctx: CanvasRenderingContext2D,
    cells: HexCell[],
    centerX: number,
    centerY: number,
    radius: number,
    offsetX: number,
    offsetY: number,
    scale: number,
    dark: boolean,
    forceOutlines: boolean,
  ) {
    const hasRange = state.nccMin < state.nccMax;
    const range = state.nccMax - state.nccMin || 1;

    for (const cell of cells) {
      const verts = cellVertices(cell, gridSpacingDeg);
      ctx.beginPath();
      for (let i = 0; i < verts.length; i++) {
        const px = centerX + (verts[i][0] - offsetX) * scale * radius;
        const py = centerY - (verts[i][1] - offsetY) * scale * radius;
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
      const fadeAlpha = state.getCellFadeAlpha(cell);

      if (bestNcc !== null && hasRange && fadeAlpha >= 0.05) {
        const norm = (bestNcc - state.nccMin) / range;
        ctx.fillStyle = nccColor(norm);
        ctx.globalAlpha = 0.8 * fadeAlpha;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      } else if (isHovered) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)';
        ctx.fill();
      }

      if (forceOutlines || gridSpacingDeg > 2) {
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      if (isSelected) {
        ctx.strokeStyle = dark ? '#fff' : '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  /** Render the magnifier content into the floating overlay canvas. */
  function drawMagnifier(dark: boolean) {
    const mc = magCanvas;
    if (!mc) return;
    const mctx = mc.getContext('2d')!;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = magnifierRadiusCSS * 2;
    const mcx = magnifierRadiusCSS;
    const mcy = magnifierRadiusCSS;
    const magR = magnifierRadiusCSS;
    const { radius } = discLayout();

    mctx.clearRect(0, 0, size, size);

    // Clip to circle
    mctx.save();
    mctx.beginPath();
    mctx.arc(mcx, mcy, magR, 0, 2 * Math.PI);
    mctx.clip();

    // Fill background
    mctx.fillStyle = dark ? '#1a1a1a' : '#f8f8f8';
    mctx.fillRect(0, 0, size, size);

    // Sub-clip to transformed ASU boundary (or disc circle)
    mctx.beginPath();
    if (asuBoundary) {
      mctx.moveTo(
        mcx + (asuBoundary[0][0] - logicalDiscPos.x) * zoom * radius,
        mcy - (asuBoundary[0][1] - logicalDiscPos.y) * zoom * radius,
      );
      for (let i = 1; i < asuBoundary.length; i++) {
        mctx.lineTo(
          mcx + (asuBoundary[i][0] - logicalDiscPos.x) * zoom * radius,
          mcy - (asuBoundary[i][1] - logicalDiscPos.y) * zoom * radius,
        );
      }
      mctx.closePath();
    } else {
      mctx.arc(
        mcx - logicalDiscPos.x * zoom * radius,
        mcy + logicalDiscPos.y * zoom * radius,
        radius * zoom,
        0, 2 * Math.PI,
      );
    }
    mctx.clip();

    // Draw zoomed cells (only those near the logical position)
    const viewRadius = magR / (radius * zoom) + hexSize * 2;
    const viewR2 = (viewRadius + hexSize) * (viewRadius + hexSize);
    const nearbyCells = asuGrid.filter((c) => {
      const dx = c.cx - logicalDiscPos.x;
      const dy = c.cy - logicalDiscPos.y;
      return dx * dx + dy * dy < viewR2;
    });
    drawCells(mctx, nearbyCells, mcx, mcy, radius, logicalDiscPos.x, logicalDiscPos.y, zoom, dark, true);

    mctx.restore(); // remove circle + ASU clip

    // Draw transformed borders (re-clip to circle only)
    mctx.save();
    mctx.beginPath();
    mctx.arc(mcx, mcy, magR, 0, 2 * Math.PI);
    mctx.clip();

    // Disc border (transformed)
    mctx.strokeStyle = dark ? '#555' : '#bbb';
    mctx.lineWidth = 1.5;
    mctx.beginPath();
    mctx.arc(
      mcx - logicalDiscPos.x * zoom * radius,
      mcy + logicalDiscPos.y * zoom * radius,
      radius * zoom,
      0, 2 * Math.PI,
    );
    mctx.stroke();

    // ASU boundary (transformed)
    if (asuBoundary) {
      mctx.strokeStyle = dark ? '#888' : '#999';
      mctx.lineWidth = 1;
      mctx.beginPath();
      mctx.moveTo(
        mcx + (asuBoundary[0][0] - logicalDiscPos.x) * zoom * radius,
        mcy - (asuBoundary[0][1] - logicalDiscPos.y) * zoom * radius,
      );
      for (let i = 1; i < asuBoundary.length; i++) {
        mctx.lineTo(
          mcx + (asuBoundary[i][0] - logicalDiscPos.x) * zoom * radius,
          mcy - (asuBoundary[i][1] - logicalDiscPos.y) * zoom * radius,
        );
      }
      mctx.closePath();
      mctx.stroke();
    }

    mctx.restore(); // remove circle clip

    // Magnifier rim
    mctx.strokeStyle = dark ? '#888' : '#555';
    mctx.lineWidth = 2.5;
    mctx.beginPath();
    mctx.arc(mcx, mcy, magR - 1.5, 0, 2 * Math.PI);
    mctx.stroke();

    // Crosshair at center
    mctx.strokeStyle = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
    mctx.lineWidth = 1;
    const ch = 8;
    mctx.beginPath();
    mctx.moveTo(mcx - ch, mcy); mctx.lineTo(mcx + ch, mcy);
    mctx.moveTo(mcx, mcy - ch); mctx.lineTo(mcx, mcy + ch);
    mctx.stroke();
  }

  function redraw() {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { cx, cy, radius } = discLayout();
    const dark = isDark();

    ctx.clearRect(0, 0, cssW, cssH);

    // Clip to ASU boundary (or full disc if no boundary)
    ctx.save();
    ctx.beginPath();
    if (asuBoundary) {
      ctx.moveTo(cx + asuBoundary[0][0] * radius, cy - asuBoundary[0][1] * radius);
      for (let i = 1; i < asuBoundary.length; i++) {
        ctx.lineTo(cx + asuBoundary[i][0] * radius, cy - asuBoundary[i][1] * radius);
      }
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    }
    ctx.clip();

    // Draw all ASU cells (normal view)
    drawCells(ctx, asuGrid, cx, cy, radius, 0, 0, 1, dark, false);

    ctx.restore(); // remove clip

    // Always draw disc border
    ctx.strokeStyle = dark ? '#555' : '#bbb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw ASU boundary on top if it differs from the disc
    if (asuBoundary) {
      ctx.strokeStyle = dark ? '#888' : '#999';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + asuBoundary[0][0] * radius, cy - asuBoundary[0][1] * radius);
      for (let i = 1; i < asuBoundary.length; i++) {
        ctx.lineTo(cx + asuBoundary[i][0] * radius, cy - asuBoundary[i][1] * radius);
      }
      ctx.closePath();
      ctx.stroke();
    }

    // Dim the main canvas when magnifier is active
    if (magnifierActive) {
      ctx.fillStyle = dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, 0, cssW, cssH);
      drawMagnifier(dark);
    }
  }

  // Shared magnifier drag logic
  function handleMagMove(clientX: number, clientY: number) {
    const { x, y } = eventToDisc({ clientX, clientY });
    logicalDiscPos.x += (x - prevMouseDisc.x) / zoom;
    logicalDiscPos.y += (y - prevMouseDisc.y) / zoom;
    prevMouseDisc = { x, y };
    mouseClientPos = { x: clientX, y: clientY };
    positionMagCanvas();
    selectCell(logicalDiscPos.x, logicalDiscPos.y);
    hoveredCell = hitTest(logicalDiscPos.x, logicalDiscPos.y, asuGrid, gridSpacingDeg);
    redraw();
  }

  function handleMagEnd() {
    document.removeEventListener('mousemove', onMagMouseMove);
    document.removeEventListener('mouseup', onMagMouseUp);
    document.removeEventListener('touchmove', onMagTouchMove);
    document.removeEventListener('touchend', onMagTouchEnd);
    dragging = false;
    magnifierActive = false;
    removeMagCanvas();
    canvas.style.cursor = '';
    redraw();
  }

  function onMagMouseMove(e: MouseEvent) { handleMagMove(e.clientX, e.clientY); }
  function onMagMouseUp() { handleMagEnd(); }
  function onMagTouchMove(e: TouchEvent) { e.preventDefault(); handleMagMove(e.touches[0].clientX, e.touches[0].clientY); }
  function onMagTouchEnd() { handleMagEnd(); }

  function handleDown(clientX: number, clientY: number) {
    dragging = true;
    const { x, y } = eventToDisc({ clientX, clientY });
    if (magnifierEnabled) {
      magnifierActive = true;
      logicalDiscPos = { x, y };
      prevMouseDisc = { x, y };
      mouseClientPos = { x: clientX, y: clientY };
      createMagCanvas();
      positionMagCanvas();
      canvas.style.cursor = 'none';
      document.addEventListener('mousemove', onMagMouseMove);
      document.addEventListener('mouseup', onMagMouseUp);
      document.addEventListener('touchmove', onMagTouchMove, { passive: false });
      document.addEventListener('touchend', onMagTouchEnd);
    }
    selectCell(x, y);
    redraw();
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) handleDown(e.clientX, e.clientY);
  }, { signal: ac.signal });

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    handleDown(e.touches[0].clientX, e.touches[0].clientY);
  }, { signal: ac.signal });

  canvas.addEventListener('mousemove', (e) => {
    if (magnifierActive) return;
    if (dragging) trySelect(e);
    const { x, y } = eventToDisc(e);
    const cell = hitTest(x, y, asuGrid, gridSpacingDeg);
    const prev = hoveredCell;
    hoveredCell = cell;
    if (prev?.q !== cell?.q || prev?.r !== cell?.r) redraw();
  }, { signal: ac.signal });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (magnifierActive) return;
    if (dragging) {
      const t = e.touches[0];
      trySelect({ clientX: t.clientX, clientY: t.clientY });
    }
  }, { signal: ac.signal });

  canvas.addEventListener('mouseup', () => {
    if (magnifierActive) return;
    dragging = false;
  }, { signal: ac.signal });

  canvas.addEventListener('touchend', () => {
    if (magnifierActive) return;
    dragging = false;
  }, { signal: ac.signal });

  canvas.addEventListener('mouseleave', () => {
    if (magnifierActive) return;
    dragging = false;
    hoveredCell = null;
    redraw();
  }, { signal: ac.signal });

  return {
    canvas,
    grid: asuGrid,
    isTop,
    redraw,
    destroy: () => {
      ac.abort();
      document.removeEventListener('mousemove', onMagMouseMove);
      document.removeEventListener('mouseup', onMagMouseUp);
      document.removeEventListener('touchmove', onMagTouchMove);
      document.removeEventListener('touchend', onMagTouchEnd);
      removeMagCanvas();
    },
  };
}
