import type { GameState } from '../game/state';

export interface PsiRing {
  canvas: HTMLCanvasElement;
  nccText: string;
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

function isDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export interface PsiRingCallbacks {
  onPsiSelected(psiDeg: number): void;
}

export function createPsiRing(
  canvas: HTMLCanvasElement,
  psiSteps: number,
  state: GameState,
  callbacks: PsiRingCallbacks,
): PsiRing {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.style.width ? parseInt(canvas.style.width) : canvas.width;
  const cssH = canvas.style.height ? parseInt(canvas.style.height) : canvas.height;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const psiIncrement = 360 / psiSteps;
  let dragging = false;
  const ac = new AbortController();

  // Magnifier constants and state
  const zoom = psiSteps / 12; // 1× at 12 steps, 2× at 24, etc.
  const magnifierEnabled = zoom > 1;
  const magnifierRadiusCSS = 80;
  let magnifierActive = false;
  let logicalAngle = 0; // derived angle in radians [0, 2π), 0 = top of ring
  let logicalPos = { x: 0, y: 0 }; // logical position relative to ring center (CSS coords)
  let prevMousePos = { x: 0, y: 0 }; // previous mouse position for Cartesian delta
  let mouseClientPos = { x: 0, y: 0 };

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

  /** Get pointer position relative to ring center in CSS canvas coords. */
  function eventToRingXY(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width * cssW - cssW / 2,
      y: (e.clientY - rect.top) / rect.height * cssH - cssH / 2,
    };
  }

  function eventToPsi(e: { clientX: number; clientY: number }): number | null {
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * cssW - cssW / 2;
    const py = (e.clientY - rect.top) / rect.height * cssH - cssH / 2;
    const dist = Math.sqrt(px * px + py * py);
    const outerR = Math.min(cssW, cssH) / 2 - 4;
    const innerR = outerR * 0.6;

    if (dist < innerR * 0.8 || dist > outerR + 8) return null;

    let angle = Math.atan2(py, px) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    return Math.round((angle * 180) / Math.PI / psiIncrement) * psiIncrement % 360;
  }

  function selectPsiAtAngle(angle: number) {
    let psiDeg = Math.round((angle * 180 / Math.PI) / psiIncrement) * psiIncrement % 360;
    if (psiDeg < 0) psiDeg += 360;
    if (psiDeg !== state.currentPsiDeg) {
      callbacks.onPsiSelected(psiDeg);
    }
  }

  function trySelect(e: { clientX: number; clientY: number }) {
    const psi = eventToPsi(e);
    if (psi !== null && psi !== state.currentPsiDeg) {
      callbacks.onPsiSelected(psi);
    }
  }

  /** Render the magnifier content into the floating overlay canvas (spatial zoom). */
  function drawMagnifier(dark: boolean) {
    const mc = magCanvas;
    if (!mc) return;
    const mctx = mc.getContext('2d')!;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const size = magnifierRadiusCSS * 2;
    const mcx = magnifierRadiusCSS;
    const mcy = magnifierRadiusCSS;
    const magR = magnifierRadiusCSS;

    const outerR = Math.min(cssW, cssH) / 2 - 4;
    const innerR = outerR * 0.6;
    const midR = (outerR + innerR) / 2;

    // Canvas angle for the logical position (-π/2 = top of ring)
    const canvasAngle = -Math.PI / 2 + logicalAngle;

    // Logical point on the ring (at mid-radius, relative to ring center)
    const logX = midR * Math.cos(canvasAngle);
    const logY = midR * Math.sin(canvasAngle);

    // Spatially-zoomed ring: center displaced, radii scaled
    const magCX = mcx - logX * zoom;
    const magCY = mcy - logY * zoom;
    const magOuterR = outerR * zoom;
    const magInnerR = innerR * zoom;

    mctx.clearRect(0, 0, size, size);

    // Clip to circle
    mctx.save();
    mctx.beginPath();
    mctx.arc(mcx, mcy, magR, 0, 2 * Math.PI);
    mctx.clip();

    // Fill background
    mctx.fillStyle = dark ? '#1a1a1a' : '#f8f8f8';
    mctx.fillRect(0, 0, size, size);

    // Draw spatially-zoomed segments (only those near the logical angle)
    const segAngle = (2 * Math.PI) / psiSteps;
    const visibleArcRange = magR / (outerR * zoom) + segAngle * 2;
    const psiNcc = state.currentCell ? state.getPsiNccValues(state.currentCell) : new Map<number, number>();
    const hasRange = state.nccMin < state.nccMax;
    const range = state.nccMax - state.nccMin || 1;

    for (let i = 0; i < psiSteps; i++) {
      const psiDeg = i * psiIncrement;
      const segCenterAngle = -Math.PI / 2 + (psiDeg / 360) * 2 * Math.PI;

      // Skip segments far from the logical angle
      let dAngle = segCenterAngle - canvasAngle;
      if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
      if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
      if (Math.abs(dAngle) > visibleArcRange) continue;

      const startAngle = segCenterAngle - segAngle / 2;
      const endAngle = segCenterAngle + segAngle / 2;

      const ncc = psiNcc.get(psiDeg);
      const isSelected = state.currentPsiDeg === psiDeg;

      mctx.beginPath();
      mctx.arc(magCX, magCY, magOuterR, startAngle, endAngle);
      mctx.arc(magCX, magCY, magInnerR, endAngle, startAngle, true);
      mctx.closePath();

      if (ncc !== undefined && hasRange) {
        const norm = (ncc - state.nccMin) / range;
        mctx.fillStyle = nccColor(norm);
        mctx.globalAlpha = 0.8;
        mctx.fill();
        mctx.globalAlpha = 1.0;
      }

      if (isSelected) {
        mctx.strokeStyle = dark ? '#fff' : '#000';
        mctx.lineWidth = 2;
        mctx.stroke();
      } else {
        mctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
        mctx.lineWidth = 0.5;
        mctx.stroke();
      }
    }

    // Draw zoomed ring borders
    mctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
    mctx.lineWidth = 1;
    mctx.beginPath();
    mctx.arc(magCX, magCY, magOuterR, 0, 2 * Math.PI);
    mctx.stroke();
    mctx.beginPath();
    mctx.arc(magCX, magCY, magInnerR, 0, 2 * Math.PI);
    mctx.stroke();

    mctx.restore(); // remove circle clip

    // Crosshair at magnifier center (rotated to align with ring)
    mctx.strokeStyle = dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';
    mctx.lineWidth = 1;
    const ch = 8;
    // Radial direction
    const rx = Math.cos(canvasAngle), ry = Math.sin(canvasAngle);
    // Tangential direction
    const tx = -ry, ty = rx;
    mctx.beginPath();
    mctx.moveTo(mcx - rx * ch, mcy - ry * ch);
    mctx.lineTo(mcx + rx * ch, mcy + ry * ch);
    mctx.moveTo(mcx - tx * ch, mcy - ty * ch);
    mctx.lineTo(mcx + tx * ch, mcy + ty * ch);
    mctx.stroke();

    // Magnifier rim
    mctx.strokeStyle = dark ? '#888' : '#555';
    mctx.lineWidth = 2.5;
    mctx.beginPath();
    mctx.arc(mcx, mcy, magR - 1.5, 0, 2 * Math.PI);
    mctx.stroke();
  }

  function redraw() {
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = cssW / 2, cy = cssH / 2;
    const outerR = Math.min(cssW, cssH) / 2 - 4;
    const innerR = outerR * 0.6;
    const dark = isDark();

    ctx.clearRect(0, 0, cssW, cssH);

    const hasRange = state.nccMin < state.nccMax;
    const range = state.nccMax - state.nccMin || 1;
    const psiNcc = state.currentCell ? state.getPsiNccValues(state.currentCell) : new Map<number, number>();

    const segAngle = (2 * Math.PI) / psiSteps;
    for (let i = 0; i < psiSteps; i++) {
      const psiDeg = i * psiIncrement;
      const startAngle = -Math.PI / 2 + i * segAngle - segAngle / 2;
      const endAngle = startAngle + segAngle;

      const ncc = psiNcc.get(psiDeg);
      const isSelected = state.currentPsiDeg === psiDeg;

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();

      if (ncc !== undefined && hasRange) {
        const norm = (ncc - state.nccMin) / range;
        ctx.fillStyle = nccColor(norm);
        ctx.globalAlpha = 0.8;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      if (isSelected) {
        ctx.strokeStyle = dark ? '#fff' : '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (psiSteps <= 96) {
        ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    // Draw outer and inner ring borders (always visible)
    ctx.strokeStyle = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, innerR, 0, 2 * Math.PI);
    ctx.stroke();

    // Draw NCC text in center
    ctx.fillStyle = dark ? '#aaa' : '#666';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('NCC', cx, cy - 8);
    ctx.fillStyle = dark ? '#fff' : '#000';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(ring.nccText, cx, cy + 10);
    ctx.textBaseline = 'alphabetic';

    // Dim and update magnifier when active
    if (magnifierActive) {
      ctx.fillStyle = dark ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)';
      ctx.fillRect(0, 0, cssW, cssH);
      drawMagnifier(dark);
    }
  }

  // Shared magnifier drag logic
  function handleMagMove(clientX: number, clientY: number) {
    const pos = eventToRingXY({ clientX, clientY });
    logicalPos.x += (pos.x - prevMousePos.x) / zoom;
    logicalPos.y += (pos.y - prevMousePos.y) / zoom;
    prevMousePos = pos;
    logicalAngle = Math.atan2(logicalPos.y, logicalPos.x) + Math.PI / 2;
    if (logicalAngle < 0) logicalAngle += 2 * Math.PI;
    mouseClientPos = { x: clientX, y: clientY };
    positionMagCanvas();
    selectPsiAtAngle(logicalAngle);
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
    if (magnifierEnabled) {
      magnifierActive = true;
      const pos = eventToRingXY({ clientX, clientY });
      logicalPos = { x: pos.x, y: pos.y };
      prevMousePos = { x: pos.x, y: pos.y };
      logicalAngle = Math.atan2(pos.y, pos.x) + Math.PI / 2;
      if (logicalAngle < 0) logicalAngle += 2 * Math.PI;
      mouseClientPos = { x: clientX, y: clientY };
      createMagCanvas();
      positionMagCanvas();
      canvas.style.cursor = 'none';
      document.addEventListener('mousemove', onMagMouseMove);
      document.addEventListener('mouseup', onMagMouseUp);
      document.addEventListener('touchmove', onMagTouchMove, { passive: false });
      document.addEventListener('touchend', onMagTouchEnd);
      selectPsiAtAngle(logicalAngle);
    } else {
      trySelect({ clientX, clientY });
    }
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
  }, { signal: ac.signal });

  const ring: PsiRing = {
    canvas,
    nccText: '\u2014',
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
  return ring;
}
