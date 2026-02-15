import { computeFRC, type FRCResult } from '../core/frc';

export interface ScoreResult {
  /** Resolution in Angstroms at FRC=0.5 */
  resolutionAngstrom: number;
  /** Star rating 0-3 */
  stars: number;
  /** Full FRC curve for optional display */
  frcCurve: number[];
  /** Pixel size in Angstroms (for FRC plot axis label) */
  pixelSize: number;
}

/**
 * Compute score based on FRC between noise-free target and player projections.
 * Both projections should be CTF-free and LP-free (raw volume projections).
 *
 * @param targetProjection  Noise-free target projection (Float32Array, size×size)
 * @param playerProjection  Player's projection at chosen angles (Float32Array, size×size)
 * @param size              Image dimension
 * @param pixelSize         Pixel size in Angstroms
 */
export function computeScore(
  targetProjection: Float32Array,
  playerProjection: Float32Array,
  size: number,
  pixelSize: number,
): ScoreResult {
  const frc = computeFRC(targetProjection, playerProjection, size, pixelSize);

  const nyquistRes = 2 * pixelSize;
  let stars: number;
  if (frc.resolutionAngstrom <= nyquistRes * 1.5) {
    stars = 3;
  } else if (frc.resolutionAngstrom <= nyquistRes * 3) {
    stars = 2;
  } else if (frc.resolutionAngstrom <= nyquistRes * 8) {
    stars = 1;
  } else {
    stars = 0;
  }

  return {
    resolutionAngstrom: frc.resolutionAngstrom,
    stars,
    frcCurve: frc.frcCurve,
    pixelSize,
  };
}
