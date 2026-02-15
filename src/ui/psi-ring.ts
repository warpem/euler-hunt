import type { GameState } from '../game/state';

export interface PsiRing {
  canvas: HTMLCanvasElement;
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
  const psiIncrement = 360 / psiSteps;
  let dragging = false;
  const ac = new AbortController();

  function eventToPsi(e: MouseEvent): number | null {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const px = (e.clientX - rect.left) * scaleX - canvas.width / 2;
    const py = (e.clientY - rect.top) * scaleY - canvas.height / 2;
    const dist = Math.sqrt(px * px + py * py);
    const outerR = Math.min(canvas.width, canvas.height) / 2 - 4;
    const innerR = outerR * 0.6;

    if (dist < innerR * 0.8 || dist > outerR + 8) return null;

    let angle = Math.atan2(py, px) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    return Math.round((angle * 180) / Math.PI / psiIncrement) * psiIncrement % 360;
  }

  function trySelect(e: MouseEvent) {
    const psi = eventToPsi(e);
    if (psi !== null && psi !== state.currentPsiDeg) {
      callbacks.onPsiSelected(psi);
    }
  }

  function redraw() {
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const outerR = Math.min(w, h) / 2 - 4;
    const innerR = outerR * 0.6;
    const dark = isDark();

    ctx.clearRect(0, 0, w, h);

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
  }, { signal: ac.signal });

  canvas.addEventListener('mouseup', () => {
    dragging = false;
  }, { signal: ac.signal });

  canvas.addEventListener('mouseleave', () => {
    dragging = false;
  }, { signal: ac.signal });

  return {
    canvas,
    redraw,
    destroy: () => ac.abort(),
  };
}
