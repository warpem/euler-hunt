import type { ScoreResult } from '../game/scoring';
import {
  getPlayerName,
  submitScore,
  getLeaderboard,
  getUid,
  type LeaderboardEntry,
} from '../firebase';

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

function renderLeaderboardTable(
  entries: LeaderboardEntry[],
  myUid: string | null,
): string {
  if (entries.length === 0) {
    return '<p style="color:var(--muted); font-size:13px">No scores yet. Be the first!</p>';
  }
  const rows = entries.map((e, i) => {
    const isMe = e.uid === myUid;
    const bg = isMe ? 'background:rgba(34,170,102,0.15);' : '';
    const bold = isMe ? 'font-weight:bold;' : '';
    return `<tr style="${bg}${bold}">
      <td style="padding:4px 10px; text-align:center">${i + 1}</td>
      <td style="padding:4px 10px; text-align:left">${e.name}</td>
      <td style="padding:4px 10px; text-align:right; font-family:monospace">${e.resolution.toFixed(3)} \u00c5</td>
    </tr>`;
  }).join('');

  return `
    <table style="border-collapse:collapse; width:100%; max-width:360px; font-size:14px">
      <thead>
        <tr style="border-bottom:1px solid var(--border); color:var(--muted); font-size:12px">
          <th style="padding:4px 10px; text-align:center">#</th>
          <th style="padding:4px 10px; text-align:left">Name</th>
          <th style="padding:4px 10px; text-align:right">Resolution</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function createScoreScreen(
  container: HTMLElement,
  result: ScoreResult,
  levelName: string,
  hasNextLevel: boolean,
  callbacks: ScoreScreenCallbacks,
  levelSlug: string | null,
): void {
  const stars = '\u2605'.repeat(result.stars) + '\u2606'.repeat(3 - result.stars);
  const resText = result.resolutionAngstrom === Infinity
    ? 'No resolution'
    : `${result.resolutionAngstrom.toFixed(1)} \u00c5`;

  const canSubmit = levelSlug !== null && result.stars > 0;
  const savedName = getPlayerName() ?? '';

  container.innerHTML = `
    <div style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:80vh; text-align:center; padding:24px 16px;
    ">
      <h2 style="margin-bottom:8px">${levelName}</h2>
      <div style="font-size:48px; margin:16px 0">${stars}</div>
      <p style="font-size:18px; color:var(--muted)">
        Resolution at FRC=0.5: <strong style="color:var(--fg)">${resText}</strong>
      </p>
      <canvas id="frcCanvas" width="400" height="220" style="margin-top:16px"></canvas>
      ${canSubmit ? `
        <div id="submitSection" style="margin-top:20px; display:flex; align-items:center; gap:8px">
          <input id="nameInput" type="text" maxlength="8" placeholder="Name" value="${savedName}" style="
            padding:8px 12px; font-size:14px; width:120px; text-align:center;
            background:var(--input-bg); color:var(--fg); border:1px solid var(--input-border);
            border-radius:4px;
          ">
          <button id="submitScoreBtn" style="
            padding:8px 20px; font-size:14px; cursor:pointer;
            background:var(--btn-primary-bg); color:var(--btn-primary-fg);
            border:none; border-radius:4px; font-weight:bold;
          ">Submit</button>
        </div>
        <p id="submitStatus" style="color:var(--muted); font-size:12px; min-height:18px; margin-top:4px"></p>
      ` : ''}
      <div id="leaderboardArea" style="margin-top:16px; width:100%; display:flex; flex-direction:column; align-items:center"></div>
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
        ">Back to Menu</button>
      </div>
    </div>
  `;

  // Draw FRC curve
  const frcCanvas = document.getElementById('frcCanvas') as HTMLCanvasElement;
  drawFrcCurve(frcCanvas, result.frcCurve, result.pixelSize);

  // Leaderboard submit + display
  if (canSubmit) {
    const nameInput = document.getElementById('nameInput') as HTMLInputElement;
    const submitBtn = document.getElementById('submitScoreBtn')!;
    const statusEl = document.getElementById('submitStatus')!;
    const lbArea = document.getElementById('leaderboardArea')!;

    async function showLeaderboard() {
      try {
        const entries = await getLeaderboard(levelSlug!);
        lbArea.innerHTML = renderLeaderboardTable(entries, getUid());
      } catch {
        lbArea.innerHTML = '<p style="color:var(--muted); font-size:12px">Could not load leaderboard.</p>';
      }
    }

    submitBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name || name.length < 1) {
        statusEl.textContent = 'Enter a name (1\u20138 characters).';
        return;
      }
      submitBtn.setAttribute('disabled', '');
      statusEl.textContent = 'Submitting\u2026';
      try {
        await submitScore(levelSlug!, name, result.resolutionAngstrom);
        statusEl.textContent = 'Score submitted!';
        await showLeaderboard();
      } catch (e) {
        statusEl.textContent = 'Submit failed. Try again.';
        console.error('Score submit error:', e);
        submitBtn.removeAttribute('disabled');
      }
    });

    // Load leaderboard on screen open
    showLeaderboard();
  }

  if (hasNextLevel) {
    document.getElementById('nextLevelBtn')!.addEventListener('click', callbacks.onNextLevel);
  }
  document.getElementById('backBtn')!.addEventListener('click', callbacks.onBackToTitle);
}
