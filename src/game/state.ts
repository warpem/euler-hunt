import type { HexCell } from '../core/hex-grid';
import { SUBDIVISION_STEPS, type SubdivisionStep } from './campaign';

/** Key for a (rot, tilt) cell */
function cellKey(cell: HexCell): string {
  return `${cell.isTop ? 'T' : 'B'}_${cell.q}_${cell.r}`;
}

/** Key for a psi value at a cell */
function psiKey(cell: HexCell, psiDeg: number): string {
  return `${cellKey(cell)}_${psiDeg}`;
}

/** Great-circle distance between two points on the sphere (radians). */
export function greatCircleDistance(
  rot1: number, tilt1: number,
  rot2: number, tilt2: number,
): number {
  const cosDist =
    Math.cos(tilt1) * Math.cos(tilt2) +
    Math.sin(tilt1) * Math.sin(tilt2) * Math.cos(rot1 - rot2);
  return Math.acos(Math.min(1, Math.max(-1, cosDist)));
}

export interface ExploredEntry {
  ncc: number;
  rot: number;
  tilt: number;
  psiDeg: number;
}

export class GameState {
  /** Target Euler angles (continuous, not quantized) */
  targetRot: number;
  targetTilt: number;
  targetPsiDeg: number;

  /** Current subdivision level (0-based index into SUBDIVISION_STEPS) */
  subdivisionIndex = 0;

  /** Currently selected angles */
  currentCell: HexCell | null = null;
  currentPsiDeg = 0;

  /** All explored NCC values at the current subdivision level */
  private explored = new Map<string, ExploredEntry>();

  /** Best NCC per cell (across all psi) at the current subdivision level */
  private bestPerCell = new Map<string, number>();

  /** Global min/max NCC for color scale */
  nccMin = Infinity;
  nccMax = -Infinity;

  constructor(
    targetRot: number,
    targetTilt: number,
    targetPsiDeg: number,
  ) {
    this.targetRot = targetRot;
    this.targetTilt = targetTilt;
    this.targetPsiDeg = targetPsiDeg;
  }

  /** Current subdivision step configuration */
  get currentStep(): SubdivisionStep {
    return SUBDIVISION_STEPS[this.subdivisionIndex];
  }

  /** Whether another subdivision level is available */
  get canSubdivide(): boolean {
    return this.subdivisionIndex < SUBDIVISION_STEPS.length - 1;
  }

  /** Number of psi steps at current subdivision */
  get psiSteps(): number {
    return Math.round(360 / this.currentStep.angularSpacingDeg);
  }

  /** Psi angle increment in degrees at current subdivision */
  get psiIncrement(): number {
    return 360 / this.psiSteps;
  }

  /** Advance to the next subdivision level. Clears all exploration data. */
  subdivide(): SubdivisionStep {
    if (!this.canSubdivide) throw new Error('Already at finest subdivision');

    this.subdivisionIndex++;

    // Fresh start at the new resolution
    this.explored.clear();
    this.bestPerCell.clear();
    this.nccMin = Infinity;
    this.nccMax = -Infinity;

    return this.currentStep;
  }

  /** Record an NCC value for the given cell and psi */
  explore(cell: HexCell, psiDeg: number, ncc: number): void {
    const key = psiKey(cell, psiDeg);
    this.explored.set(key, {
      ncc,
      rot: cell.rot,
      tilt: cell.tilt,
      psiDeg,
    });

    // Update best per cell
    const ck = cellKey(cell);
    const prev = this.bestPerCell.get(ck);
    if (prev === undefined || ncc > prev) {
      this.bestPerCell.set(ck, ncc);
    }

    // Update global min/max
    if (ncc < this.nccMin) this.nccMin = ncc;
    if (ncc > this.nccMax) this.nccMax = ncc;
  }

  /** Get best NCC for a cell (across all explored psi), or null if unexplored */
  getBestNccForCell(cell: HexCell): number | null {
    return this.bestPerCell.get(cellKey(cell)) ?? null;
  }

  /** Get all explored psi → NCC values for a specific cell */
  getPsiNccValues(cell: HexCell): Map<number, number> {
    const result = new Map<number, number>();
    const prefix = cellKey(cell);
    for (const [key, entry] of this.explored) {
      if (key.startsWith(prefix + '_')) {
        result.set(entry.psiDeg, entry.ncc);
      }
    }
    return result;
  }

  /** Check if any exploration has been done */
  get hasExplored(): boolean {
    return this.explored.size > 0;
  }
}
