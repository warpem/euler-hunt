import { loadVolume, supersample } from '../core/volume';
import { initRenderer } from '../core/renderer';
import { eulerToMatrix, deg2rad } from '../core/euler';
import { displayProjection } from '../core/display';
import { applyCtf, applyCtfAndLowPass, addNoise } from '../core/projection-pipeline';
import { applyLowPass } from '../core/low-pass';
import { ncc } from '../core/ncc';
import type { CTFParams } from '../core/ctf';
import type { HexCell } from '../core/hex-grid';
import { isInAsymmetricUnit } from '../core/symmetry';
import { GameState, greatCircleDistance } from '../game/state';
import { computeScore, type ScoreResult } from '../game/scoring';
import { createHemisphereDisc } from './hemisphere-disc';
import { createPsiRing } from './psi-ring';
import { SUBDIVISION_STEPS, type LevelConfig } from '../game/campaign';

export interface GameScreenCallbacks {
  onSubmit(result: ScoreResult): void;
  onBack(): void;
}

/**
 * Pick a random target orientation uniformly within the ASU on the sphere.
 * Uses rejection sampling with uniform cos(tilt) for area-preserving sampling.
 */
function pickRandomTargetInASU(symmetry: string): { rot: number; tilt: number; psiDeg: number } {
  for (let i = 0; i < 10000; i++) {
    const rot = Math.random() * 2 * Math.PI;
    const cosTilt = 2 * Math.random() - 1;
    const tilt = Math.acos(cosTilt);

    if (isInAsymmetricUnit(rot, tilt, symmetry)) {
      // Reject orientations too close to the north pole (player starts there)
      if (tilt < deg2rad(15)) continue;
      const psiDeg = Math.random() * 360;
      return { rot, tilt, psiDeg };
    }
  }
  // Fallback (should never happen)
  return { rot: 0.5, tilt: 0.5, psiDeg: 45 };
}

/** Find the nearest cell in a grid to the given (rot, tilt). */
function snapToNearestCell(rot: number, tilt: number, grid: HexCell[]): HexCell {
  let best = grid[0];
  let bestDist = Infinity;
  for (const c of grid) {
    const d = greatCircleDistance(rot, tilt, c.rot, c.tilt);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/** Snap a psi angle to the nearest quantized step. */
function snapPsi(psiDeg: number, psiIncrement: number): number {
  return Math.round(psiDeg / psiIncrement) * psiIncrement % 360;
}

export async function createGameScreen(
  container: HTMLElement,
  levelConfig: LevelConfig,
  callbacks: GameScreenCallbacks,
): Promise<void> {
  // Compute responsive canvas sizes
  const vw = window.innerWidth;
  const isMobile = vw <= 768;
  // 24px padding + 16px gap + 4px borders + 8px buffer for projections
  const projSize = isMobile ? Math.floor((vw - 52) / 2) : 384;
  // 24px padding + 16px gap + 8px buffer for discs
  const discSize = isMobile ? Math.floor((vw - 48) / 2) : 250;

  container.innerHTML = `
    <style>
      #gameTopBar { display: none; align-items: center; margin-bottom: 8px; }
      #psiWrapper { text-align: center; }
      @media (max-width: 768px) {
        #gameTopBar { display: flex; }
        .desktop-only { display: none !important; }
        #targetCanvas, #playerCanvas,
        #topDisc, #bottomDisc, #psiRing {
          width: calc(50vw - 22px) !important;
          height: calc(50vw - 22px) !important;
        }
        #controlsRow { row-gap: 0 !important; margin-top: 8px !important; }
        #psiWrapper {
          flex-basis: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-top: -40px;
        }
        #buttonBar {
          display: flex !important;
          justify-content: center !important;
          grid-template-columns: unset !important;
        }
      }
    </style>
    <div id="loadingOverlay" style="
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:80vh; gap:16px;
    ">
      <div class="spinner"></div>
      <p id="loadingStatus" style="color:var(--muted); font-size:14px">Loading volume...</p>
    </div>
    <div id="gameContent" style="display:none; text-align:center; padding:12px">
      <div id="gameTopBar">
        <button id="mobileBackBtn" style="
          padding:8px 16px; font-size:14px; cursor:pointer;
          background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
          border:none; border-radius:6px; font-weight:bold;
        ">\u2190 Menu</button>
      </div>
      <h2 style="margin:0 auto 12px auto" id="levelTitle"></h2>
      <div style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap; align-items:start">
        <div>
          <div style="margin-bottom:4px; font-size:13px; color:var(--muted)">Target</div>
          <canvas id="targetCanvas" width="1" height="1" style="
            border:1px solid var(--canvas-border); image-rendering:pixelated;
            width:${projSize}px; height:${projSize}px;
          "></canvas>
        </div>
        <div>
          <div style="margin-bottom:4px; font-size:13px; color:var(--muted)">Your projection</div>
          <canvas id="playerCanvas" width="1" height="1" style="
            border:1px solid var(--canvas-border); image-rendering:pixelated;
            width:${projSize}px; height:${projSize}px; background:var(--bg);
          "></canvas>
        </div>
      </div>
      <div id="controlsRow" style="display:flex; justify-content:center; gap:16px; flex-wrap:wrap; align-items:start; margin-top:16px">
        <div>
          <div style="margin-bottom:4px; font-size:13px; color:var(--muted)">Top hemisphere</div>
          <canvas id="topDisc" width="${discSize}" height="${discSize}" style="width:${discSize}px; height:${discSize}px; cursor:crosshair"></canvas>
        </div>
        <div>
          <div style="margin-bottom:4px; font-size:13px; color:var(--muted)">Bottom hemisphere</div>
          <canvas id="bottomDisc" width="${discSize}" height="${discSize}" style="width:${discSize}px; height:${discSize}px; cursor:crosshair"></canvas>
        </div>
        <div id="psiWrapper">
          <div style="margin-bottom:4px; font-size:13px; color:var(--muted)">Psi (in-plane)</div>
          <canvas id="psiRing" width="${discSize}" height="${discSize}" style="width:${discSize}px; height:${discSize}px; cursor:crosshair"></canvas>
        </div>
      </div>
      <div style="margin-top:8px; font-family:monospace; font-size:13px; color:var(--muted)" id="anglesDisplay">
        rot=\u2014 tilt=\u2014 psi=\u2014
      </div>
      <div id="buttonBar" style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; margin:16px auto 0; max-width:784px">
        <button id="backToMenuBtn" class="desktop-only" style="
          justify-self:start;
          padding:10px 32px; font-size:16px; cursor:pointer;
          background:var(--btn-secondary-bg); color:var(--btn-secondary-fg);
          border:none; border-radius:6px; font-weight:bold;
        ">\u2190 Menu</button>
        <div style="display:flex; gap:12px">
          <button id="subdivideBtn" style="
            padding:10px 32px; font-size:16px; cursor:pointer;
            border:none; border-radius:6px; font-weight:bold;
          ">Subdivide</button>
          <button id="submitBtn" style="
            padding:10px 32px; font-size:16px; cursor:pointer;
            border:none; border-radius:6px; font-weight:bold;
          ">Submit</button>
        </div>
      </div>
    </div>
  `;

  const loadingOverlay = document.getElementById('loadingOverlay')!;
  const loadingStatus = document.getElementById('loadingStatus')!;
  const gameContent = document.getElementById('gameContent')!;
  const targetCanvas = document.getElementById('targetCanvas') as HTMLCanvasElement;
  const playerCanvas = document.getElementById('playerCanvas') as HTMLCanvasElement;
  const topDiscEl = document.getElementById('topDisc') as HTMLCanvasElement;
  const bottomDiscEl = document.getElementById('bottomDisc') as HTMLCanvasElement;
  const psiRingEl = document.getElementById('psiRing') as HTMLCanvasElement;
  const anglesDisplay = document.getElementById('anglesDisplay')!;
  const subdivideBtn = document.getElementById('subdivideBtn') as HTMLButtonElement;
  const submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
  const titleEl = document.getElementById('levelTitle')!;
  const backToMenuBtn = document.getElementById('backToMenuBtn') as HTMLButtonElement;
  const mobileBackBtn = document.getElementById('mobileBackBtn') as HTMLButtonElement;

  backToMenuBtn.addEventListener('click', () => { stopFadeLoop(); callbacks.onBack(); });
  mobileBackBtn.addEventListener('click', () => { stopFadeLoop(); callbacks.onBack(); });

  // Load volume
  loadingStatus.textContent = 'Loading volume...';
  const response = await fetch(levelConfig.mapUrl);
  const buffer = await response.arrayBuffer();
  const vol = loadVolume(buffer);

  loadingStatus.textContent = 'Preparing volume...';
  await new Promise((r) => setTimeout(r, 0));
  const ssVol = supersample(vol);
  // Working resolution = half the supersampled size
  const originalSize = ssVol.size / 2;
  const workingPixelSize = ssVol.pixelSize * 2;

  const ctfParams: CTFParams | null = levelConfig.defocus !== null ? {
    pixelSize: workingPixelSize,
    voltage: 300,
    cs: 2.7,
    amplitude: 0.07,
    defocus: levelConfig.defocus,
  } : null;

  // Create offscreen GL canvas
  const glCanvas = document.createElement('canvas');
  glCanvas.width = 256;
  glCanvas.height = 256;
  const renderer = initRenderer(glCanvas);
  renderer.uploadVolume(ssVol.data, ssVol.size);

  // Set canvas data resolution to match volume
  targetCanvas.width = originalSize;
  targetCanvas.height = originalSize;
  playerCanvas.width = originalSize;
  playerCanvas.height = originalSize;

  // Pick random continuous target within ASU
  loadingStatus.textContent = 'Generating target...';
  await new Promise((r) => setTimeout(r, 0));
  const target = pickRandomTargetInASU(levelConfig.symmetry);
  // Object.assign(target, { rot: 0, tilt: 0, psiDeg: 1 }); // DEBUG: fixed target
  const targetMatrix = eulerToMatrix(target.rot, target.tilt, deg2rad(target.psiDeg));

  // Generate target images:
  // - targetClean: raw projection (no CTF, no noise) — for FRC scoring
  // - targetWithEffects: CTF + noise at full resolution — LP-filtered for display
  const targetClean = renderer.renderProjection(targetMatrix, originalSize);
  let targetWithEffects: Float32Array = targetClean;
  if (ctfParams) {
    targetWithEffects = applyCtf(targetWithEffects, originalSize, ctfParams);
  }
  if (levelConfig.snr !== null) {
    targetWithEffects = addNoise(targetWithEffects, levelConfig.snr);
  }

  // Initialize game state with continuous target angles
  const state = new GameState(target.rot, target.tilt, target.psiDeg, levelConfig.fadeHalfLife);

  // Mutable references to current widgets (rebuilt on subdivide)
  let topDisc = createHemisphereDisc(topDiscEl, state.currentStep.angularSpacingDeg, true, levelConfig.symmetry, state, {
    onCellSelected: (cell) => selectCell(cell),
  });
  let bottomDisc = createHemisphereDisc(bottomDiscEl, state.currentStep.angularSpacingDeg, false, levelConfig.symmetry, state, {
    onCellSelected: (cell) => selectCell(cell),
  });
  let psiRing = createPsiRing(psiRingEl, state.psiSteps, state, {
    onPsiSelected: (psiDeg) => selectPsi(psiDeg),
  });

  let currentTargetDisplayed: Float32Array;
  let projectionRafId = 0;

  // Continuous psi (degrees) tracks the ideal compensated value to avoid
  // rounding-error accumulation when dragging across many cells.
  let continuousPsi = 0;

  function updateTargetDisplay() {
    const lpCutoff = state.currentStep.lpCutoffNyquist;
    currentTargetDisplayed = applyLowPass(targetWithEffects, originalSize, lpCutoff);
    displayProjection(targetCanvas, currentTargetDisplayed, originalSize);
  }

  function updateSubdivisionUI() {
    const stepNum = state.subdivisionIndex + 1;
    const spacing = state.currentStep.angularSpacingDeg;
    titleEl.textContent = `${levelConfig.name} (${levelConfig.symmetry}): Step ${stepNum}/${SUBDIVISION_STEPS.length} \u2014 ${spacing}\u00b0`;

    const canSub = state.canSubdivide;
    subdivideBtn.disabled = !canSub;
    subdivideBtn.style.background = canSub ? 'var(--btn-primary-bg)' : 'var(--btn-secondary-bg)';
    subdivideBtn.style.color = canSub ? 'var(--btn-primary-fg)' : 'var(--btn-secondary-fg)';
    subdivideBtn.style.cursor = canSub ? 'pointer' : 'default';
    subdivideBtn.style.opacity = canSub ? '1' : '0.5';

    submitBtn.disabled = canSub;
    submitBtn.style.background = canSub ? 'var(--btn-secondary-bg)' : 'var(--btn-primary-bg)';
    submitBtn.style.color = canSub ? 'var(--btn-secondary-fg)' : 'var(--btn-primary-fg)';
    submitBtn.style.cursor = canSub ? 'default' : 'pointer';
    submitBtn.style.opacity = canSub ? '0.5' : '1';
  }

  function selectCell(cell: HexCell) {
    // Compensate psi for the change in rot (ZYZ convention: changing rot
    // rotates the image plane, so subtract Δrot from psi to cancel it out).
    if (state.currentCell) {
      const deltaRotDeg = (cell.rot - state.currentCell.rot) * 180 / Math.PI;
      continuousPsi -= deltaRotDeg;
      continuousPsi = ((continuousPsi % 360) + 360) % 360;
      state.currentPsiDeg = snapPsi(continuousPsi, state.psiIncrement);
    }
    state.currentCell = cell;
    redrawAll();
    scheduleProjectionUpdate();
  }

  function selectPsi(psiDeg: number) {
    continuousPsi = psiDeg;
    state.currentPsiDeg = psiDeg;
    redrawAll();
    scheduleProjectionUpdate();
  }

  function scheduleProjectionUpdate() {
    if (projectionRafId) return;
    projectionRafId = requestAnimationFrame(() => {
      projectionRafId = 0;
      updateProjection();
    });
  }

  function updateProjection() {
    if (!state.currentCell) return;

    const rot = state.currentCell.rot;
    const tilt = state.currentCell.tilt;
    const psi = deg2rad(state.currentPsiDeg);
    const lpCutoff = state.currentStep.lpCutoffNyquist;

    const matrix = eulerToMatrix(rot, tilt, psi);
    const rawProjection = renderer.renderProjection(matrix, originalSize);

    // Apply CTF + LP in a single FFT pass, or just LP if no CTF
    let playerImage: Float32Array;
    if (ctfParams) {
      playerImage = applyCtfAndLowPass(rawProjection, originalSize, ctfParams, lpCutoff);
    } else {
      playerImage = applyLowPass(rawProjection, originalSize, lpCutoff);
    }

    displayProjection(playerCanvas, playerImage, originalSize);

    const nccValue = ncc(currentTargetDisplayed, playerImage);
    psiRing.nccText = nccValue.toFixed(3);

    state.explore(state.currentCell, state.currentPsiDeg, nccValue);

    const rotDeg = Math.round((rot * 180) / Math.PI);
    const tiltDeg = Math.round((tilt * 180) / Math.PI);
    anglesDisplay.textContent = `rot=${rotDeg}\u00b0 tilt=${tiltDeg}\u00b0 psi=${state.currentPsiDeg}\u00b0`;

    redrawAll();
  }

  function redrawAll() {
    topDisc.redraw();
    bottomDisc.redraw();
    psiRing.redraw();
  }

  // Continuous animation loop for memory fade
  let fadeRafId = 0;
  function fadeLoop() {
    state.refreshFadeRange();
    redrawAll();
    fadeRafId = requestAnimationFrame(fadeLoop);
  }
  function stopFadeLoop() {
    if (fadeRafId) { cancelAnimationFrame(fadeRafId); fadeRafId = 0; }
  }

  // Subdivide button handler
  subdivideBtn.addEventListener('click', () => {
    if (!state.canSubdivide) return;

    // Advance state (clears exploration data for fresh start)
    state.subdivide();

    // Destroy old widgets
    topDisc.destroy();
    bottomDisc.destroy();
    psiRing.destroy();

    // Create new widgets at finer spacing
    topDisc = createHemisphereDisc(topDiscEl, state.currentStep.angularSpacingDeg, true, levelConfig.symmetry, state, {
      onCellSelected: (cell) => selectCell(cell),
    });
    bottomDisc = createHemisphereDisc(bottomDiscEl, state.currentStep.angularSpacingDeg, false, levelConfig.symmetry, state, {
      onCellSelected: (cell) => selectCell(cell),
    });
    psiRing = createPsiRing(psiRingEl, state.psiSteps, state, {
      onPsiSelected: (psiDeg) => selectPsi(psiDeg),
    });

    // Snap current selection to nearest finer cell
    if (state.currentCell) {
      const allNew = [...topDisc.grid, ...bottomDisc.grid];
      if (allNew.length > 0) {
        const snapped = snapToNearestCell(state.currentCell.rot, state.currentCell.tilt, allNew);
        state.currentCell = snapped;
      }
      state.currentPsiDeg = snapPsi(continuousPsi, state.psiIncrement);
    }

    // Update target display with new LP cutoff
    updateTargetDisplay();
    updateSubdivisionUI();

    // Trigger projection update for snapped cell
    scheduleProjectionUpdate();
    redrawAll();
  });

  // Submit button handler
  submitBtn.addEventListener('click', () => {
    if (!state.currentCell) return;

    // Render clean projections (no CTF, no LP, no noise) for FRC scoring
    const playerMatrix = eulerToMatrix(
      state.currentCell.rot,
      state.currentCell.tilt,
      deg2rad(state.currentPsiDeg),
    );
    const playerClean = renderer.renderProjection(playerMatrix, originalSize);

    const result = computeScore(
      targetClean,
      playerClean,
      originalSize,
      workingPixelSize,
    );

    stopFadeLoop();
    callbacks.onSubmit(result);
  });

  // Auto-select initial cell closest to pole in ASU
  const allAsuCells = [...topDisc.grid, ...bottomDisc.grid];
  if (allAsuCells.length > 0) {
    const initialCell = allAsuCells.reduce((best, c) => (c.tilt < best.tilt ? c : best), allAsuCells[0]);
    selectCell(initialCell);
  }

  // Generate initial target display with LP filter
  updateTargetDisplay();
  updateSubdivisionUI();

  // Show game, hide loading
  loadingOverlay.style.display = 'none';
  gameContent.style.display = '';

  // Start fade animation loop if memory fade is active
  if (levelConfig.fadeHalfLife !== null) fadeLoop();
}
