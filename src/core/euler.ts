/**
 * Euler angles to 3x3 rotation matrix (ZYZ convention, RELION standard).
 * Input angles in radians.
 * Output is column-major Float32Array(9) for direct use as WebGL mat3 uniform.
 */
export function eulerToMatrix(rot: number, tilt: number, psi: number): Float32Array {
  const ca = Math.cos(rot), sa = Math.sin(rot);
  const cb = Math.cos(tilt), sb = Math.sin(tilt);
  const cg = Math.cos(psi), sg = Math.sin(psi);
  const cc = cb * ca, cs = cb * sa;
  const sc = sb * ca, ss = sb * sa;

  // The C# euler.cs produces R^T. We need R = Rz(rot) * Ry(tilt) * Rz(psi)
  // so that psi = in-plane rotation and (rot, tilt) = viewing direction.
  // Column-major layout for WebGL mat3, transposed from the C# output:
  return new Float32Array([
     cg * cc - sg * sa,  cg * cs + sg * ca, -cg * sb,   // col 0
    -sg * cc - cg * sa, -sg * cs + cg * ca,  sg * sb,   // col 1
     sc,                 ss,                 cb,         // col 2
  ]);
}

/**
 * Convert degrees to radians.
 */
export function deg2rad(deg: number): number {
  return deg * Math.PI / 180;
}
