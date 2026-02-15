import ndarray from 'ndarray';
import fft from 'ndarray-fft';

/**
 * Apply a low-pass filter to a 2D image in Fourier space.
 * Uses a raised-cosine (Hann) rolloff for smooth transition (no Gibbs ringing).
 *
 * @param image   Float32Array of size×size pixels
 * @param size    Image width/height
 * @param cutoffNyquist  Cutoff as fraction of Nyquist (0.5 cycles/pixel).
 *                       1.0 = Nyquist (no filtering), 0.0625 = very heavy LP.
 * @returns Filtered image as Float32Array
 */
export function applyLowPass(
  image: Float32Array,
  size: number,
  cutoffNyquist: number,
): Float32Array {
  if (cutoffNyquist >= 1.0) return image;

  const real = ndarray(new Float64Array(image), [size, size]);
  const imag = ndarray(new Float64Array(size * size), [size, size]);

  fft(1, real, imag);

  // Cutoff in FFT index units: cutoffNyquist × (size / 2)
  const cutoffIdx = cutoffNyquist * size / 2;
  // Rolloff width: 20% of cutoff, minimum 1 pixel
  const rolloffWidth = Math.max(1, cutoffIdx * 0.2);
  const rolloffStart = cutoffIdx - rolloffWidth;

  const halfSize = size / 2;
  const realData = real.data as Float64Array;
  const imagData = imag.data as Float64Array;

  for (let iy = 0; iy < size; iy++) {
    const fy = iy <= halfSize ? iy : iy - size;
    for (let ix = 0; ix < size; ix++) {
      const fx = ix <= halfSize ? ix : ix - size;
      const r = Math.sqrt(fx * fx + fy * fy);

      let weight: number;
      if (r <= rolloffStart) {
        weight = 1.0;
      } else if (r >= cutoffIdx) {
        weight = 0.0;
      } else {
        // Raised cosine rolloff
        weight = 0.5 * (1 + Math.cos(Math.PI * (r - rolloffStart) / rolloffWidth));
      }

      const idx = iy * size + ix;
      realData[idx] *= weight;
      imagData[idx] *= weight;
    }
  }

  fft(-1, real, imag);

  const result = new Float32Array(size * size);
  for (let i = 0; i < result.length; i++) {
    result[i] = realData[i];
  }
  return result;
}

/**
 * Compute the LP weight for a given frequency radius.
 * Exported for use in combined CTF+LP passes.
 */
export function lpWeight(freqRadius: number, cutoffIdx: number): number {
  const rolloffWidth = Math.max(1, cutoffIdx * 0.2);
  const rolloffStart = cutoffIdx - rolloffWidth;

  if (freqRadius <= rolloffStart) return 1.0;
  if (freqRadius >= cutoffIdx) return 0.0;
  return 0.5 * (1 + Math.cos(Math.PI * (freqRadius - rolloffStart) / rolloffWidth));
}
