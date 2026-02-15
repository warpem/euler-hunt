import { parseMRC } from '@warpem/mrc-parser';
import ndarray from 'ndarray';
import fft from 'ndarray-fft';
import zeros from 'zeros';

export interface Volume {
  /** Voxel data as flat Float32Array, row-major (x fastest) */
  data: Float32Array;
  /** Size along each axis (cubic volumes only) */
  size: number;
  /** Pixel/voxel size in Angstroms */
  pixelSize: number;
}

/**
 * Parse an MRC file buffer into a Volume.
 * Expects a cubic volume (NX === NY === NZ).
 */
export function loadVolume(buffer: ArrayBuffer): Volume {
  const { header, data } = parseMRC(buffer);
  const { x: nx, y: ny, z: nz } = header.dimensions;
  if (nx !== ny || ny !== nz) {
    throw new Error(`Volume must be cubic, got ${nx}×${ny}×${nz}`);
  }
  const pixelSize = header.pixelSize.x;
  return { data, size: nx, pixelSize };
}

/** Max input size before supersampling — keeps (2N)³ arrays manageable */
const MAX_SIZE = 128;

/**
 * Downsample a volume from N³ to M³ using trilinear interpolation.
 * Uses O(M³) memory — safe for arbitrarily large inputs.
 */
function downsample(vol: Volume, targetSize: number): Volume {
  const N = vol.size;
  const M = targetSize;
  const result = new Float32Array(M * M * M);
  const scale = (N - 1) / (M - 1); // map [0, M-1] → [0, N-1]

  for (let iz = 0; iz < M; iz++) {
    const sz = iz * scale;
    const z0 = Math.floor(sz), z1 = Math.min(z0 + 1, N - 1);
    const fz = sz - z0;
    for (let iy = 0; iy < M; iy++) {
      const sy = iy * scale;
      const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, N - 1);
      const fy = sy - y0;
      for (let ix = 0; ix < M; ix++) {
        const sx = ix * scale;
        const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, N - 1);
        const fx = sx - x0;

        const v000 = vol.data[z0 * N * N + y0 * N + x0];
        const v100 = vol.data[z0 * N * N + y0 * N + x1];
        const v010 = vol.data[z0 * N * N + y1 * N + x0];
        const v110 = vol.data[z0 * N * N + y1 * N + x1];
        const v001 = vol.data[z1 * N * N + y0 * N + x0];
        const v101 = vol.data[z1 * N * N + y0 * N + x1];
        const v011 = vol.data[z1 * N * N + y1 * N + x0];
        const v111 = vol.data[z1 * N * N + y1 * N + x1];

        result[iz * M * M + iy * M + ix] =
          v000 * (1 - fx) * (1 - fy) * (1 - fz) +
          v100 * fx * (1 - fy) * (1 - fz) +
          v010 * (1 - fx) * fy * (1 - fz) +
          v110 * fx * fy * (1 - fz) +
          v001 * (1 - fx) * (1 - fy) * fz +
          v101 * fx * (1 - fy) * fz +
          v011 * (1 - fx) * fy * fz +
          v111 * fx * fy * fz;
      }
    }
  }

  return {
    data: result,
    size: M,
    pixelSize: vol.pixelSize * (N / M),
  };
}

/**
 * Supersample a cubic volume by 2× using Fourier-space zero-padding.
 * Input: N³ volume → Output: (2N)³ volume.
 *
 * If the volume exceeds MAX_SIZE, it is first Fourier-cropped down to MAX_SIZE.
 * The supersampled volume has the same real-space extent but 2× more voxels,
 * so trilinear GPU texture sampling gives better interpolation quality.
 */
export function supersample(vol: Volume): Volume {
  // Downsample large volumes first
  if (vol.size > MAX_SIZE) {
    console.log(`Volume ${vol.size}³ exceeds max ${MAX_SIZE}³, downsampling...`);
    vol = downsample(vol, MAX_SIZE);
  }

  const N = vol.size;
  const N2 = N * 2;

  // Create ndarray views of the input volume
  const real = ndarray(new Float64Array(vol.data), [N, N, N]);
  const imag = ndarray(new Float64Array(N * N * N), [N, N, N]);

  // Forward 3D FFT
  fft(1, real, imag);

  // Allocate padded arrays (2N)³
  const paddedReal = zeros([N2, N2, N2]);
  const paddedImag = zeros([N2, N2, N2]);

  // Copy Fourier coefficients with proper half-complex placement.
  // FFT output has DC at (0,0,0), positive frequencies at low indices,
  // negative frequencies at high indices. We need to place them so that
  // the same frequency mapping holds in the larger array.
  //
  // For each axis: indices 0..N/2 (positive freqs) stay at 0..N/2,
  // indices N/2+1..N-1 (negative freqs) go to N2-N/2+1..N2-1.
  const half = N / 2;
  for (let iz = 0; iz < N; iz++) {
    const dz = iz <= half ? iz : iz - N + N2;
    for (let iy = 0; iy < N; iy++) {
      const dy = iy <= half ? iy : iy - N + N2;
      for (let ix = 0; ix < N; ix++) {
        const dx = ix <= half ? ix : ix - N + N2;
        paddedReal.set(dz, dy, dx, real.get(iz, iy, ix));
        paddedImag.set(dz, dy, dx, imag.get(iz, iy, ix));
      }
    }
  }

  // Inverse 3D FFT (ndarray-fft with dir=-1 scales by 1/N automatically,
  // but for the padded array it scales by 1/(2N)³. We need to compensate:
  // the original forward FFT produced unnormalized coefficients for N³ points,
  // and the inverse will divide by (2N)³, so we need to multiply by (2N/N)³ = 8.
  fft(-1, paddedReal, paddedImag);

  // Scale to compensate for the larger IFFT normalization
  const scale = 8; // (2N)³ / N³
  const result = new Float32Array(N2 * N2 * N2);
  const pData = paddedReal.data as Float64Array;
  for (let i = 0; i < result.length; i++) {
    result[i] = pData[i] * scale;
  }

  return {
    data: result,
    size: N2,
    pixelSize: vol.pixelSize / 2, // half the voxel size
  };
}
