import type { ScoreResult } from '../game/scoring';

export interface ScoreScreenCallbacks {
  onNextLevel(): void;
  onBackToTitle(): void;
}

function isDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function drawFrcCurve(canvas: HTMLCanvasElement, frcCurve: number[], pixelSize: number): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = 400, cssH = 220;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;

  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const w = cssW, h = cssH;
  const dark = isDark();

  const pad = { top: 12, right: 16, bottom: 32, left: 44 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = dark ? '#1a1a1a' : '#fafafa';
  ctx.fillRect(pad.left, pad.top, plotW, plotH);

  // Grid lines
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
  ctx.lineWidth = 0.5;
  for (let y = 0; y <= 1; y += 0.25) {
    const py = pad.top + plotH * (1 - y);
    ctx.beginPath();
    ctx.moveTo(pad.left, py);
    ctx.lineTo(pad.left + plotW, py);
    ctx.stroke();
  }

  // 0.5 threshold line
  const threshY = pad.top + plotH * 0.5;
  ctx.strokeStyle = dark ? 'rgba(255,100,100,0.6)' : 'rgba(200,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.left, threshY);
  ctx.lineTo(pad.left + plotW, threshY);
  ctx.stroke();
  ctx.setLineDash([]);

  // FRC curve (skip DC at index 0, plot from ring 1 to end)
  const n = frcCurve.length - 1; // number of points to plot (excluding DC)
  if (n < 2) return;

  ctx.strokeStyle = dark ? '#6cf' : '#2266cc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 1; i < frcCurve.length; i++) {
    const x = pad.left + ((i - 1) / (n - 1)) * plotW;
    const val = Math.max(0, Math.min(1, frcCurve[i]));
    const y = pad.top + plotH * (1 - val);
    if (i === 1) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = dark ? '#666' : '#999';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  // Tick at 50% Nyquist
  const halfX = pad.left + plotW / 2;
  ctx.beginPath();
  ctx.moveTo(halfX, pad.top + plotH);
  ctx.lineTo(halfX, pad.top + plotH + 4);
  ctx.stroke();

  // Labels
  const denom = 2 * pixelSize;
  const denomStr = Number.isInteger(denom) ? `${denom}` : denom.toFixed(1);
  const halfDenom = 4 * pixelSize;
  const halfDenomStr = Number.isInteger(halfDenom) ? `${halfDenom}` : halfDenom.toFixed(1);
  ctx.fillStyle = dark ? '#aaa' : '#555';
  ctx.font = '11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Spatial frequency (\u212b\u207b\u00b9)', pad.left + plotW / 2, h - 4);
  ctx.fillText('0', pad.left, pad.top + plotH + 14);
  ctx.fillText(`1/${halfDenomStr}`, halfX, pad.top + plotH + 14);
  ctx.fillText(`1/${denomStr}`, pad.left + plotW, pad.top + plotH + 14);

  ctx.textAlign = 'right';
  ctx.fillText('0', pad.left - 4, pad.top + plotH + 4);
  ctx.fillText('0.5', pad.left - 4, threshY + 4);
  ctx.fillText('1', pad.left - 4, pad.top + 10);
}

export function createScoreScreen(
  container: HTMLElement,
  result: ScoreResult,
  levelName: string,
  hasNextLevel: boolean,
  callbacks: ScoreScreenCallbacks,
): void {
  const stars = '\u2605'.repeat(result.stars) + '\u2606'.repeat(3 - result.stars);
  const resText = result.resolutionAngstrom === Infinity
    ? 'No resolution'
    : `${result.resolutionAngstrom.toFixed(1)} \u00c5`;

  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:80vh; text-align:center;
    ">
      <h2 style="margin-bottom:8px">${levelName}</h2>
      <div style="font-size:48px; margin:16px 0">${stars}</div>
      <p style="font-size:18px; color:var(--muted)">
        Resolution at FRC=0.5: <strong style="color:var(--fg)">${resText}</strong>
      </p>
      <canvas id="frcCanvas" width="400" height="220" style="margin-top:16px"></canvas>
      <div style="display:flex; gap:12px; margin-top:24px">
        ${hasNextLevel ? `
          <button id="nextLevelBtn" style="
            padding:12px 36px; font-size:16px; cursor:pointer;
            background:var(--btn-primary-bg); color:var(--btn-primary-fg);
            border:none; border-radius:6px; font-weight:bold;
          ">Next Level</button>
        ` : ''}
        <button id="backBtn" style="
          padding:12px 36px; font-size:16px; cursor:pointer;
          background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
          border:none; border-radius:6px; font-weight:bold;
        ">Back to Title</button>
      </div>
    </div>
  `;

  // Draw FRC curve
  const frcCanvas = document.getElementById('frcCanvas') as HTMLCanvasElement;
  drawFrcCurve(frcCanvas, result.frcCurve, result.pixelSize);

  if (hasNextLevel) {
    document.getElementById('nextLevelBtn')!.addEventListener('click', callbacks.onNextLevel);
  }
  document.getElementById('backBtn')!.addEventListener('click', callbacks.onBackToTitle);
}
