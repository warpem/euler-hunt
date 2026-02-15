/**
 * Lambert azimuthal equal-area projection for mapping sphere hemispheres to discs.
 *
 * Top hemisphere (tilt 0–90°): center = north pole
 * Bottom hemisphere (tilt 90–180°): center = south pole
 *
 * Disc coordinates are in [-1, 1]² with the unit circle as the boundary.
 */

/**
 * Forward projection: (rot, tilt) → disc (x, y) + which hemisphere.
 * rot in [0, 2π), tilt in [0, π].
 * Returns { x, y } in [-1, 1] and isTop boolean.
 */
export function sphereToDisc(rot: number, tilt: number): { x: number; y: number; isTop: boolean } {
  const isTop = tilt <= Math.PI / 2;

  // Lambert equal-area: r = √2 · sin(θ/2) where θ = colatitude from pole
  // Top hemisphere: θ = tilt (colatitude from north pole)
  // Bottom hemisphere: θ = π - tilt (colatitude from south pole)
  const theta = isTop ? tilt : Math.PI - tilt;
  const r = Math.sqrt(2) * Math.sin(theta / 2);

  // Normalize so the equator (θ = π/2) maps to r = 1
  // At θ = π/2: r = √2 · sin(π/4) = √2 · √2/2 = 1 ✓ (already normalized)

  return {
    x: r * Math.cos(rot),
    y: r * Math.sin(rot),
    isTop,
  };
}

/**
 * Inverse projection: disc (x, y) on a hemisphere → (rot, tilt).
 * Returns rot in [0, 2π) and tilt in [0, π].
 */
export function discToSphere(x: number, y: number, isTop: boolean): { rot: number; tilt: number } {
  const r = Math.sqrt(x * x + y * y);

  let rot = Math.atan2(y, x);
  if (rot < 0) rot += 2 * Math.PI;

  // Inverse Lambert: θ = 2 · arcsin(r / √2)
  const theta = 2 * Math.asin(Math.min(1, r / Math.sqrt(2)));

  const tilt = isTop ? theta : Math.PI - theta;

  return { rot, tilt };
}
