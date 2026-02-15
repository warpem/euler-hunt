import { discToSphere } from './lambert';

export interface HexCell {
  /** Axial coordinate q */
  q: number;
  /** Axial coordinate r */
  r: number;
  /** Center position on disc, x in [-1, 1] */
  cx: number;
  /** Center position on disc, y in [-1, 1] */
  cy: number;
  /** Euler angle rot (radians) */
  rot: number;
  /** Euler angle tilt (radians) */
  tilt: number;
  /** Whether this cell is on the top hemisphere */
  isTop: boolean;
}

/**
 * Create a hexagonal grid on a disc (unit circle).
 * Uses flat-top hexagons with axial coordinates.
 *
 * @param angularSpacingDeg Approximate angular spacing in degrees (determines cell size)
 * @param isTop Whether this is the top (true) or bottom (false) hemisphere
 * @returns Array of hex cells whose centers fall within the unit disc
 */
export function createHexGrid(angularSpacingDeg: number, isTop: boolean): HexCell[] {
  // The angular spacing maps to a hex size on the disc.
  // At the equator (r=1 on disc), the angular spacing in radians should correspond
  // to approximately one hex diameter. The Lambert projection preserves area,
  // so a uniform hex grid on the disc gives roughly equal-area cells on the sphere.
  //
  // Hex "size" = distance from center to vertex.
  // For flat-top hexagons, width = 2*size, height = √3*size.
  // We want the hex width ≈ angularSpacing mapped through Lambert at mid-radius.
  const angularSpacing = (angularSpacingDeg * Math.PI) / 180;

  // At θ = 45° (mid-hemisphere), dr/dθ = cos(θ/2)/√2 ≈ 0.65
  // So disc distance ≈ angularSpacing * 0.65. Use this as hex size.
  const hexSize = angularSpacing * 0.65;

  // Flat-top hex: horizontal spacing = 1.5 * size, vertical spacing = √3 * size
  const horizSpacing = 1.5 * hexSize;
  const vertSpacing = Math.sqrt(3) * hexSize;

  const cells: HexCell[] = [];

  // Determine grid range to cover the unit disc
  const maxQ = Math.ceil(1.0 / horizSpacing) + 1;
  const maxR = Math.ceil(1.0 / vertSpacing) + 1;

  for (let q = -maxQ; q <= maxQ; q++) {
    for (let r = -maxR; r <= maxR; r++) {
      // Flat-top hex center in Cartesian:
      const cx = hexSize * (3 / 2) * q;
      const cy = hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r);

      // Keep cells that overlap the unit disc (center may be slightly outside)
      const dist = Math.sqrt(cx * cx + cy * cy);
      if (dist > 1.0 + hexSize) continue;

      // Map disc position to sphere angles (clamp to disc for border cells)
      const clamp = dist > 1.0 ? 1.0 / dist : 1;
      const { rot, tilt } = discToSphere(cx * clamp, cy * clamp, isTop);

      cells.push({ q, r, cx, cy, rot, tilt, isTop });
    }
  }

  return cells;
}

/**
 * Get the 6 vertices of a flat-top hexagon cell.
 * Returns array of [x, y] pairs.
 */
export function cellVertices(cell: HexCell, angularSpacingDeg: number): [number, number][] {
  const angularSpacing = (angularSpacingDeg * Math.PI) / 180;
  const hexSize = angularSpacing * 0.65;

  const vertices: [number, number][] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i; // flat-top: starts at 0°
    vertices.push([
      cell.cx + hexSize * Math.cos(angle),
      cell.cy + hexSize * Math.sin(angle),
    ]);
  }
  return vertices;
}

/**
 * Find which hex cell a disc point (x, y) falls in.
 * Uses cube coordinate rounding for accurate hit testing.
 */
export function hitTest(x: number, y: number, cells: HexCell[], angularSpacingDeg: number): HexCell | null {
  // Check if point is inside the unit disc
  if (x * x + y * y > 1.0) return null;

  const angularSpacing = (angularSpacingDeg * Math.PI) / 180;
  const hexSize = angularSpacing * 0.65;

  // Convert pixel position to fractional axial coordinates (flat-top)
  const q = (2 / 3) * x / hexSize;
  const r = (-1 / 3 * x + Math.sqrt(3) / 3 * y) / hexSize;

  // Round to nearest hex using cube coordinates
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }

  // Find matching cell
  return cells.find((c) => c.q === rq && c.r === rr) ?? null;
}
