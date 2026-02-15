/**
 * Symmetry group handling for cryo-EM, ported from RELION symmetries.cpp.
 *
 * For each symmetry group, we compute the full set of rotation matrices (the subgroup).
 * These are used for:
 * 1. Computing symmetric angular distance (minimum over all equivalent orientations)
 * 2. Checking if a viewing direction is in the asymmetric unit
 */

/** A 3x3 rotation matrix stored as a flat Float64Array in row-major order */
type Mat3 = number[];

/**
 * Rodrigues' rotation formula: rotation by `angleDeg` degrees about `axis`.
 * Returns a 3x3 matrix in row-major order.
 */
function rotationAboutAxis(angleDeg: number, axis: [number, number, number]): Mat3 {
  const theta = (angleDeg * Math.PI) / 180;
  const [ax, ay, az] = axis;
  const len = Math.sqrt(ax * ax + ay * ay + az * az);
  const nx = ax / len, ny = ay / len, nz = az / len;

  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const t = 1 - c;

  return [
    t * nx * nx + c,      t * nx * ny - s * nz, t * nx * nz + s * ny,
    t * nx * ny + s * nz, t * ny * ny + c,      t * ny * nz - s * nx,
    t * nx * nz - s * ny, t * ny * nz + s * nx, t * nz * nz + c,
  ];
}

/** Multiply two 3x3 row-major matrices */
function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] =
        a[i * 3 + 0] * b[0 * 3 + j] +
        a[i * 3 + 1] * b[1 * 3 + j] +
        a[i * 3 + 2] * b[2 * 3 + j];
    }
  }
  return r;
}

/** Check if a 3x3 matrix is the identity (within tolerance) */
function isIdentity(m: Mat3, eps = 1e-6): boolean {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let i = 0; i < 9; i++) {
    if (Math.abs(m[i] - id[i]) > eps) return false;
  }
  return true;
}

/** Check if two 3x3 matrices are equal (within tolerance) */
function mat3Equal(a: Mat3, b: Mat3, eps = 1e-6): boolean {
  for (let i = 0; i < 9; i++) {
    if (Math.abs(a[i] - b[i]) > eps) return false;
  }
  return true;
}

/** Clean up near-zero values */
function cleanMatrix(m: Mat3): Mat3 {
  return m.map((v) => (Math.abs(v) < 1e-10 ? 0 : v));
}

/** Generator definition: rotation axis with fold */
interface RotAxisGenerator {
  fold: number;
  axis: [number, number, number];
}

/**
 * Get the generator definitions for a symmetry group.
 * These match RELION's fill_symmetry_class exactly.
 */
function getGenerators(group: string): RotAxisGenerator[] {
  const g = group.toUpperCase();

  if (g === 'C1') return [];

  // CN: N-fold around Z
  const cnMatch = g.match(/^C(\d+)$/);
  if (cnMatch) {
    return [{ fold: parseInt(cnMatch[1]), axis: [0, 0, 1] }];
  }

  // DN: N-fold around Z + 2-fold around X
  const dnMatch = g.match(/^D(\d+)$/);
  if (dnMatch) {
    const n = parseInt(dnMatch[1]);
    const gens: RotAxisGenerator[] = [];
    if (n > 1) gens.push({ fold: n, axis: [0, 0, 1] });
    gens.push({ fold: 2, axis: [1, 0, 0] });
    return gens;
  }

  if (g === 'T') {
    return [
      { fold: 3, axis: [0, 0, 1] },
      { fold: 2, axis: [0, 0.816496, 0.577350] },
    ];
  }

  if (g === 'O') {
    return [
      { fold: 3, axis: [0.5773502, 0.5773502, 0.5773502] },
      { fold: 4, axis: [0, 0, 1] },
    ];
  }

  if (g === 'I') {
    return [
      { fold: 2, axis: [0, 0, 1] },
      { fold: 5, axis: [0.525731114, 0, 0.850650807] },
      { fold: 3, axis: [0, 0.356822076, 0.934172364] },
    ];
  }

  throw new Error(`Unknown symmetry group: ${group}`);
}

/**
 * Generate all symmetry matrices for a group (excluding identity).
 * Uses RELION's approach: generate from axis/fold, then compute subgroup closure.
 */
function generateSymmetryMatrices(generators: RotAxisGenerator[]): Mat3[] {
  const matrices: Mat3[] = [];

  // Generate initial matrices from each axis/fold
  for (const gen of generators) {
    const angIncr = 360 / gen.fold;
    for (let j = 1; j < gen.fold; j++) {
      const m = cleanMatrix(rotationAboutAxis(angIncr * j, gen.axis));
      matrices.push(m);
    }
  }

  // Compute subgroup closure: multiply all pairs until no new matrices appear
  let changed = true;
  while (changed) {
    changed = false;
    const n = matrices.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const product = cleanMatrix(mat3Mul(matrices[i], matrices[j]));
        if (isIdentity(product)) continue;
        if (!matrices.some((m) => mat3Equal(m, product))) {
          matrices.push(product);
          changed = true;
        }
      }
    }
  }

  return matrices;
}

/**
 * Get all symmetry rotation matrices for a group (excluding identity).
 * Results are cached.
 */
const cache = new Map<string, Mat3[]>();

export function getSymmetryMatrices(group: string): Mat3[] {
  const key = group.toUpperCase();
  if (cache.has(key)) return cache.get(key)!;

  const generators = getGenerators(key);
  const matrices = generateSymmetryMatrices(generators);
  cache.set(key, matrices);
  return matrices;
}

/**
 * Angular distance between two rotation matrices on SO(3).
 * Returns angle in radians: arccos((trace(R1^T · R2) - 1) / 2)
 *
 * Both matrices should be in column-major Float32Array format (as from eulerToMatrix).
 */
export function angularDistance(r1: Float32Array, r2: Float32Array): number {
  // R1^T * R2 trace = sum of element-wise products (for column-major matrices)
  let trace = 0;
  for (let i = 0; i < 9; i++) {
    trace += r1[i] * r2[i];
  }
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
}

/**
 * Symmetric angular distance: minimum angular distance over all symmetry-equivalent
 * orientations of R2.
 *
 * Both R1, R2 are column-major Float32Array(9) as from eulerToMatrix.
 */
export function symmetricAngularDistance(
  r1: Float32Array,
  r2: Float32Array,
  group: string,
): number {
  let minDist = angularDistance(r1, r2);

  if (group.toUpperCase() === 'C1') return minDist;

  const symMatrices = getSymmetryMatrices(group);

  for (const sym of symMatrices) {
    // Apply symmetry: R2_equiv = sym * R2 (convert sym to column-major and multiply)
    const r2equiv = applySymmetry(r2, sym);
    const dist = angularDistance(r1, r2equiv);
    if (dist < minDist) minDist = dist;
  }

  return minDist;
}

/**
 * Apply a symmetry matrix (row-major Mat3) to a rotation (column-major Float32Array).
 * Returns a new column-major Float32Array.
 *
 * sym (row-major) * R (column-major) = result (column-major)
 */
function applySymmetry(r: Float32Array, sym: Mat3): Float32Array {
  // Convert sym from row-major to column-major, then multiply
  // Or: compute (sym * R) where sym is row-major and R is column-major
  // For column-major storage: result_col_j = sym * R_col_j
  const result = new Float32Array(9);
  for (let j = 0; j < 3; j++) {
    // Column j of R: r[j*3+0], r[j*3+1], r[j*3+2]
    for (let i = 0; i < 3; i++) {
      result[j * 3 + i] =
        sym[i * 3 + 0] * r[j * 3 + 0] +
        sym[i * 3 + 1] * r[j * 3 + 1] +
        sym[i * 3 + 2] * r[j * 3 + 2];
    }
  }
  return result;
}

/**
 * Check if a viewing direction (rot, tilt) is in the asymmetric unit for a given symmetry.
 * This is a simplified check based on the symmetry type:
 * - C1: all directions valid
 * - Cn: rot in [0, 2π/n)
 * - Dn: rot in [0, 2π/n), tilt in [0, π/2] (top hemisphere only)
 * - T: 1/12 of sphere
 * - O: 1/24 of sphere
 * - I: 1/60 of sphere
 *
 * For T, O, I we use a general approach: check if this direction is the
 * canonical representative (smallest under symmetry operations).
 */
export function isInAsymmetricUnit(rot: number, tilt: number, group: string): boolean {
  const g = group.toUpperCase();

  if (g === 'C1') return true;

  const cnMatch = g.match(/^C(\d+)$/);
  if (cnMatch) {
    const n = parseInt(cnMatch[1]);
    const maxRot = (2 * Math.PI) / n;
    return rot >= 0 && rot < maxRot;
  }

  const dnMatch = g.match(/^D(\d+)$/);
  if (dnMatch) {
    const n = parseInt(dnMatch[1]);
    const maxRot = (2 * Math.PI) / n;
    return rot >= 0 && rot < maxRot && tilt <= Math.PI / 2;
  }

  // For T, O, I: use the general approach — this (rot, tilt) is in the ASU
  // if no symmetry operation maps it to a "smaller" direction.
  // We define "smaller" by comparing (tilt, rot) lexicographically.
  if (g === 'T' || g === 'O' || g === 'I') {
    return isCanonicalDirection(rot, tilt, g);
  }

  return true;
}

/**
 * For a viewing direction (rot, tilt), check if it's the canonical
 * (smallest) representative under the symmetry group.
 *
 * A direction is represented as a unit vector on S2:
 * v = (sin(tilt)*cos(rot), sin(tilt)*sin(rot), cos(tilt))
 *
 * We apply all symmetry operations and check if any produces a
 * "smaller" direction (by comparing z first, then y, then x — so
 * the canonical direction is the one closest to the north pole).
 */
function isCanonicalDirection(rot: number, tilt: number, group: string): boolean {
  const vx = Math.sin(tilt) * Math.cos(rot);
  const vy = Math.sin(tilt) * Math.sin(rot);
  const vz = Math.cos(tilt);

  const symMatrices = getSymmetryMatrices(group);

  for (const sym of symMatrices) {
    // Apply sym (row-major) to [vx, vy, vz]
    const sx = sym[0] * vx + sym[1] * vy + sym[2] * vz;
    const sy = sym[3] * vx + sym[4] * vy + sym[5] * vz;
    const sz = sym[6] * vx + sym[7] * vy + sym[8] * vz;

    // Compare: prefer higher z (closer to north pole), then lower rot angle
    const eps = 1e-8;
    if (sz > vz + eps) return false;
    if (Math.abs(sz - vz) < eps) {
      const sRot = Math.atan2(sy, sx);
      const oRot = Math.atan2(vy, vx);
      if (sRot < oRot - eps) return false;
    }
  }

  return true;
}

/**
 * Get the total number of symmetry operations (including identity).
 */
export function symmetryOrder(group: string): number {
  if (group.toUpperCase() === 'C1') return 1;
  return getSymmetryMatrices(group).length + 1;
}
