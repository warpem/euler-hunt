/**
 * CTF parameters for a single projection.
 */
export interface CTFParams {
  /** Pixel size in Angstroms */
  pixelSize: number;
  /** Accelerating voltage in kV */
  voltage: number;
  /** Spherical aberration in mm */
  cs: number;
  /** Amplitude contrast fraction (typically 0.07) */
  amplitude: number;
  /** Defocus in micrometers */
  defocus: number;
  /** Defocus delta (astigmatism) in micrometers. Default 0. */
  defocusDelta?: number;
  /** Astigmatism angle in degrees. Default 0. */
  defocusAngle?: number;
}

/**
 * Compute CTF values for a 2D Fourier-space grid.
 * Returns a Float32Array of size width*height with the CTF value at each pixel.
 * The DC component is at (0,0); frequencies follow standard FFT layout
 * (not fftshifted).
 */
export function computeCTF(
  width: number,
  height: number,
  params: CTFParams,
): Float32Array {
  const output = new Float32Array(width * height);

  const pixelSize = params.pixelSize;
  const voltage = params.voltage * 1e3; // V
  const lambda = 12.2643247 / Math.sqrt(voltage * (1.0 + voltage * 0.978466e-6));
  const defocus = -params.defocus * 1e4; // Angstroms
  const defocusDelta = -(params.defocusDelta ?? 0) * 1e4 * 0.5;
  const astigmatismAngle = ((params.defocusAngle ?? 0) / 180) * Math.PI;
  const cs = params.cs * 1e7; // Angstroms
  const amplitude = params.amplitude;

  const K1 = Math.PI * lambda;
  const K2 = Math.PI * 0.5 * cs * lambda * lambda * lambda;
  const K3 = Math.atan(amplitude / Math.sqrt(1 - amplitude * amplitude));

  const halfW = width / 2;
  const halfH = height / 2;

  for (let iy = 0; iy < height; iy++) {
    // FFT frequency index: 0..N/2, -(N/2-1)..-1
    const fy = iy <= halfH ? iy : iy - height;
    for (let ix = 0; ix < width; ix++) {
      const fx = ix <= halfW ? ix : ix - width;

      // Spatial frequency in 1/px, then convert to 1/Å
      const angle = Math.atan2(fy, fx);
      const rPx = Math.sqrt(fx * fx + fy * fy) / width; // cycles per pixel (Nyquist = 0.5)
      const r = rPx / pixelSize; // 1/Å
      const r2 = r * r;
      const r4 = r2 * r2;

      const deltaf = defocus + defocusDelta * Math.cos(2.0 * (angle - astigmatismAngle));
      const argument = K1 * deltaf * r2 + K2 * r4 - K3;
      const ctfValue = -Math.sin(argument);

      output[iy * width + ix] = ctfValue;
    }
  }

  return output;
}
