import ndarray from 'ndarray';
import fft from 'ndarray-fft';

export interface FRCResult {
  /** FRC values per ring (index = ring radius in pixels, 0 = DC) */
  frcCurve: number[];
  /** Resolution in Angstroms where FRC crosses 0.5 (Infinity if completely wrong) */
  resolutionAngstrom: number;
  /** Spatial frequency (cycles/pixel) at the 0.5 crossing, or null */
  crossingFreq: number | null;
}

/**
 * Compute Fourier Ring Correlation between two 2D images.
 *
 * FRC(r) = Re(Σ_ring F1 · conj(F2)) / sqrt(Σ_ring |F1|² · Σ_ring |F2|²)
 *
 * @param a         First image (Float32Array, size×size)
 * @param b         Second image (Float32Array, size×size)
 * @param size      Image dimension
 * @param pixelSize Pixel size in Angstroms (for resolution calculation)
 */
export function computeFRC(
  a: Float32Array,
  b: Float32Array,
  size: number,
  pixelSize: number,
): FRCResult {
  // Forward FFT both images
  const realA = ndarray(new Float64Array(a), [size, size]);
  const imagA = ndarray(new Float64Array(size * size), [size, size]);
  fft(1, realA, imagA);

  const realB = ndarray(new Float64Array(b), [size, size]);
  const imagB = ndarray(new Float64Array(size * size), [size, size]);
  fft(1, realB, imagB);

  const halfSize = size / 2;
  const maxRing = halfSize;

  // Accumulate per ring
  const crossReal = new Float64Array(maxRing + 1);
  const powerA = new Float64Array(maxRing + 1);
  const powerB = new Float64Array(maxRing + 1);

  const rA = realA.data as Float64Array;
  const iA = imagA.data as Float64Array;
  const rB = realB.data as Float64Array;
  const iB = imagB.data as Float64Array;

  for (let iy = 0; iy < size; iy++) {
    const fy = iy <= halfSize ? iy : iy - size;
    for (let ix = 0; ix < size; ix++) {
      const fx = ix <= halfSize ? ix : ix - size;
      const ring = Math.round(Math.sqrt(fx * fx + fy * fy));
      if (ring > maxRing) continue;

      const idx = iy * size + ix;
      const ra = rA[idx], ia = iA[idx];
      const rb = rB[idx], ib = iB[idx];

      // F1 · conj(F2) = (ra + i·ia)(rb - i·ib)
      crossReal[ring] += ra * rb + ia * ib;
      powerA[ring] += ra * ra + ia * ia;
      powerB[ring] += rb * rb + ib * ib;
    }
  }

  // Compute FRC per ring
  const frcCurve: number[] = [];
  for (let r = 0; r <= maxRing; r++) {
    const denom = Math.sqrt(powerA[r] * powerB[r]);
    frcCurve.push(denom > 0 ? crossReal[r] / denom : 0);
  }

  // Find 0.5 crossing (skip DC at r=0)
  let crossingFreq: number | null = null;
  for (let r = 1; r < frcCurve.length; r++) {
    if (frcCurve[r] < 0.5 && frcCurve[r - 1] >= 0.5) {
      // Linear interpolation
      const t = (0.5 - frcCurve[r - 1]) / (frcCurve[r] - frcCurve[r - 1]);
      const crossingRing = (r - 1) + t;
      crossingFreq = crossingRing / size; // cycles per pixel
      break;
    }
  }

  // Convert to resolution in Angstroms
  let resolutionAngstrom: number;
  if (crossingFreq !== null && crossingFreq > 0) {
    resolutionAngstrom = pixelSize / crossingFreq;
  } else if (frcCurve[frcCurve.length - 1] >= 0.5) {
    // FRC never drops below 0.5 — resolution at Nyquist (best possible)
    resolutionAngstrom = 2 * pixelSize;
  } else {
    // FRC starts below 0.5 — completely wrong orientation
    resolutionAngstrom = Infinity;
  }

  return { frcCurve, resolutionAngstrom, crossingFreq };
}
