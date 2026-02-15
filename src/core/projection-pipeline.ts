import ndarray from 'ndarray';
import fft from 'ndarray-fft';
import { computeCTF, type CTFParams } from './ctf';
import { lpWeight } from './low-pass';
import type { Renderer } from './renderer';

/**
 * Apply CTF to a 2D projection image.
 * projection → 2D FFT → multiply by CTF → 2D IFFT → return real part.
 */
export function applyCtf(
  projection: Float32Array,
  size: number,
  ctfParams: CTFParams,
): Float32Array {
  // Compute CTF values (in FFT layout, not shifted)
  const ctf = computeCTF(size, size, ctfParams);

  // Create ndarray views for 2D FFT
  const real = ndarray(new Float64Array(projection), [size, size]);
  const imag = ndarray(new Float64Array(size * size), [size, size]);

  // Forward 2D FFT
  fft(1, real, imag);

  // Multiply complex Fourier coefficients by real CTF values
  const realData = real.data as Float64Array;
  const imagData = imag.data as Float64Array;
  for (let i = 0; i < ctf.length; i++) {
    realData[i] *= ctf[i];
    imagData[i] *= ctf[i];
  }

  // Inverse 2D FFT
  fft(-1, real, imag);

  // Return real part as Float32Array
  const result = new Float32Array(size * size);
  for (let i = 0; i < result.length; i++) {
    result[i] = realData[i];
  }
  return result;
}

/**
 * Apply CTF and low-pass filter in a single FFT pass.
 * Saves one FFT round-trip compared to calling applyCtf + applyLowPass separately.
 */
export function applyCtfAndLowPass(
  projection: Float32Array,
  size: number,
  ctfParams: CTFParams,
  lpCutoffNyquist: number,
): Float32Array {
  const ctf = computeCTF(size, size, ctfParams);

  const real = ndarray(new Float64Array(projection), [size, size]);
  const imag = ndarray(new Float64Array(size * size), [size, size]);

  fft(1, real, imag);

  const halfSize = size / 2;
  const cutoffIdx = lpCutoffNyquist * halfSize;
  const realData = real.data as Float64Array;
  const imagData = imag.data as Float64Array;

  for (let iy = 0; iy < size; iy++) {
    const fy = iy <= halfSize ? iy : iy - size;
    for (let ix = 0; ix < size; ix++) {
      const fx = ix <= halfSize ? ix : ix - size;
      const r = Math.sqrt(fx * fx + fy * fy);

      const idx = iy * size + ix;
      const w = ctf[idx] * (lpCutoffNyquist >= 1.0 ? 1.0 : lpWeight(r, cutoffIdx));
      realData[idx] *= w;
      imagData[idx] *= w;
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
 * Add Gaussian noise to an image at a given SNR level.
 * SNR = var(signal) / var(noise).
 * Lower SNR = more noise = harder difficulty.
 */
export function addNoise(image: Float32Array, snr: number): Float32Array {
  const n = image.length;

  // Compute signal variance
  let mean = 0;
  for (let i = 0; i < n; i++) mean += image[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = image[i] - mean;
    variance += d * d;
  }
  variance /= n;

  // Noise std = sqrt(var(signal) / SNR)
  const noiseStd = Math.sqrt(variance / snr);

  const result = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    result[i] = image[i] + gaussianRandom() * noiseStd;
  }
  return result;
}

/** Box-Muller transform for Gaussian random numbers */
function gaussianRandom(): number {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Generate a target image: project → apply CTF → add noise.
 * This is used at level start to create the image the player must match.
 */
export function generateTarget(
  renderer: Renderer,
  rotation: Float32Array,
  originalSize: number,
  ctfParams: CTFParams | null,
  snr: number | null,
): Float32Array {
  let image = renderer.renderProjection(rotation, originalSize);
  if (ctfParams) {
    image = applyCtf(image, originalSize, ctfParams);
  }
  if (snr !== null) {
    image = addNoise(image, snr);
  }
  return image;
}
