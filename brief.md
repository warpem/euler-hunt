# Euler Hunt — Technical Brief

## Overview

Euler Hunt is a browser-based game for cryo-EM enthusiasts. The player is shown a noisy, CTF-convolved 2D projection of a 3D protein density map at an unknown orientation. They must rotate a clean copy of the same map to match the target projection's Euler angles. The game provides real-time feedback via normalized cross-correlation (NCC) and visualizes explored orientations as a heatmap.

Two modes: **Campaign** (5 preset levels with increasing difficulty) and **Free Play** (user uploads their own MRC map, sets difficulty).

---

## Tech Stack

| Component | Choice | Reason |
|---|---|---|
| Language | TypeScript | Type safety, IDE support |
| Build | Vite + vite-plugin-glsl | Fast dev, GLSL imports, single-file bundle |
| Rendering | WebGL2 (no framework) | Custom projection shader, 3D textures |
| FFT | ndarray-fft + ndarray ecosystem | N-dimensional FFT for both 3D supersampling and 2D CTF application |
| MRC parsing | @warpem/mrc-parser | Already published, handles all MRC modes |
| UI | Vanilla HTML/CSS + Canvas | No framework overhead for a single-screen game |
| Highscores | Firebase Firestore (future) | Client-side SDK, works from static hosting |
| Hosting | GitHub Pages | Static, free |

### npm dependencies

```
@warpem/mrc-parser    # MRC file loading
ndarray               # N-dimensional typed arrays
ndarray-fft           # N-dimensional FFT (forward + inverse)
ndarray-ops           # Array operations (fill, assign, etc.)
zeros                 # Create zero-filled ndarrays
```

---

## Architecture

### Rendering Pipeline

```
                        ONE-TIME (level start)
                        ─────────────────────
[MRC file] → parse → [Volume 3D float32]
                          │
                     3D FFT → zero-pad to 2x → 3D IFFT
                          │
                     [Supersampled volume] → upload as WebGL2 sampler3D
                          │
                     Pick random target (rot, tilt, psi) from quantized grid
                          │
                     GPU projection shader → [clean 2D projection]
                          │
                     2D FFT → multiply by CTF → 2D IFFT
                          │
                     Add Gaussian noise at difficulty SNR
                          │
                     [Target image] (stored, displayed to player)


                        PER-FRAME (player interaction)
                        ────────────────────────────
Player selects (rot, tilt, psi) via UI controls
          │
     GPU projection shader → gl.readPixels → [clean 2D projection]
          │
     2D FFT → multiply by CTF (same defocus as target) → 2D IFFT
          │
     [Player's CTF-applied projection] (displayed)
          │
     Compute NCC against target image → display value + update heatmap
```

### Projection Shader (GLSL fragment)

For each output pixel (u, v), cast a ray through the 3D texture along the viewing direction defined by the Euler-angle rotation matrix. Sum density along the ray:

```glsl
uniform sampler3D uVolume;
uniform mat3 uRotation;     // from Euler angles
uniform float uOriginalSize; // original volume size (e.g. 128)
uniform vec2 uResolution;    // output resolution = uOriginalSize × uOriginalSize

void main() {
    vec2 uv = gl_FragCoord.xy / uResolution - 0.5;  // centered [-0.5, 0.5]
    float halfSize = 0.5;
    float stepSize = 1.0 / uOriginalSize;  // N steps, not 2N
    float sum = 0.0;

    // Ray: origin at uRotation * (u, v, t), stepping t through the volume
    // Texture coords are [0,1]³ regardless of supersampled size
    for (float t = -halfSize; t <= halfSize; t += stepSize) {
        vec3 samplePos = uRotation * vec3(uv, t) + 0.5;
        if (all(greaterThanEqual(samplePos, vec3(0.0))) &&
            all(lessThanEqual(samplePos, vec3(1.0)))) {
            sum += texture(uVolume, samplePos).r;  // trilinear on 2N³ grid
        }
    }

    fragColor = vec4(vec3(sum), 1.0);
}
```

The projection output is N×N pixels (matching the original volume size, e.g. 128×128), with N ray steps per pixel. The volume is supersampled to (2N)³ but sampled at the original N resolution — this gives effectively better-than-trilinear interpolation of the original data.

### Volume Supersampling (2× via Fourier padding)

The purpose of supersampling is interpolation quality: when the GPU's trilinear filter samples the 3D texture, having 2× more voxels means the linear interpolation operates on a finer grid, approximating sinc interpolation. The projection itself stays at the original resolution.

1. Load volume as ndarray (N³, e.g. 64³ or 128³)
2. 3D FFT (forward): `fft(1, real, imag)` where real = volume data, imag = zeros
3. Allocate (2N)³ arrays, zero-filled
4. Copy Fourier coefficients to center of padded array (with proper FFT shift)
5. 3D IFFT: `fft(-1, paddedReal, paddedImag)`
6. Upload `paddedReal` as the WebGL2 3D texture

Result: 128³ input → 256³ supersampled texture, but projection output stays 128×128 with 128 ray steps. The shader's `stepSize` and output resolution are based on the original N, not 2N.

### CTF Application (ported from ctf.cs)

The CTF is computed per-pixel in Fourier space. Key parameters:

```typescript
interface CTFParams {
    pixelSize: number;       // Å, from MRC header
    voltage: number;         // kV (typically 300)
    cs: number;              // mm (typically 2.7)
    amplitude: number;       // amplitude contrast (typically 0.07)
    defocus: number;         // μm, set per level (0.5 = hard, 5.0 = easy)
    defocusDelta?: number;   // μm, astigmatism (0 for easy levels)
    defocusAngle?: number;   // degrees, astigmatism angle
}
```

For each pixel in 2D Fourier space at polar coordinates (r, angle):

```typescript
// Convert units
const lambda = 12.2643247 / Math.sqrt(voltage * 1e3 * (1 + voltage * 1e3 * 0.978466e-6));
const defocusVal = -defocus * 1e4;           // Å
const K1 = Math.PI * lambda;
const K2 = Math.PI * 0.5 * cs * 1e7 * lambda ** 3;
const K3 = Math.atan(amplitude / Math.sqrt(1 - amplitude * amplitude));

// r = spatial frequency at this pixel (1/Å)
const r = spatialFreq / pixelSize;
const deltaf = defocusVal + defocusDelta * Math.cos(2 * (angle - astigAngle));
const argument = K1 * deltaf * r * r + K2 * r ** 4 - K3;
const ctfValue = -Math.sin(argument);
```

Apply by multiplying each Fourier coefficient by `ctfValue`.

### Euler Angles → Rotation Matrix (ported from euler.cs)

ZYZ convention (RELION standard). Input: rot, tilt, psi in radians.

```typescript
function eulerToMatrix(rot: number, tilt: number, psi: number): Float32Array {
    const ca = Math.cos(rot),  sa = Math.sin(rot);
    const cb = Math.cos(tilt), sb = Math.sin(tilt);
    const cg = Math.cos(psi),  sg = Math.sin(psi);
    const cc = cb * ca, cs = cb * sa, sc = sb * ca, ss = sb * sa;

    // Column-major for WebGL (mat3)
    return new Float32Array([
        cg * cc - sg * sa,  -sg * cc - cg * sa,   sc,    // col 0
        cg * cs + sg * ca,  -sg * cs + cg * ca,   ss,    // col 1
       -cg * sb,             sg * sb,              cb     // col 2
    ]);
}
```

### Normalized Cross-Correlation

```typescript
function ncc(a: Float32Array, b: Float32Array): number {
    const n = a.length;
    let sumA = 0, sumB = 0;
    for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
    const meanA = sumA / n, meanB = sumB / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
        const da = a[i] - meanA, db = b[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
    }
    return num / Math.sqrt(denA * denB);
}
```

For a 128×128 image (16K pixels), this takes <1ms on any modern CPU.

---

## UI Components

### Title Screen

```
┌─────────────────────────────┐
│                             │
│        EULER HUNT           │
│                             │
│    [ Campaign ]             │
│    [ Free Play ]            │
│                             │
└─────────────────────────────┘
```

- **Campaign**: starts level 1, progresses through 5 levels
- **Free Play**: shows file picker for MRC upload + difficulty settings (noise SNR, defocus, symmetry, angular grid resolution)

### Game Screen Layout

```
┌───────────────────────────────────────────────────────────────┐
│  Level 1: Apoferritin (O)                     NCC: 0.847     │
│                                                               │
│  ┌─────────────┐    ┌─────────────┐                          │
│  │             │    │             │                          │
│  │   TARGET    │    │   PLAYER    │                          │
│  │  (noisy +   │    │  (clean +   │                          │
│  │    CTF)     │    │    CTF)     │                          │
│  │             │    │             │                          │
│  └─────────────┘    └─────────────┘                          │
│                                                               │
│  ┌────────┐  ┌────────┐     ┌──────┐                         │
│  │  TOP   │  │ BOTTOM │     │ PSI  │     [SUBMIT]            │
│  │  HEMI  │  │  HEMI  │     │RING  │                         │
│  │  DISC  │  │  DISC  │     │      │                         │
│  └────────┘  └────────┘     └──────┘                         │
└───────────────────────────────────────────────────────────────┘
```

### Hemisphere Discs (rot, tilt selection)

**Projection**: Lambert azimuthal equal-area. Each hemisphere of the unit sphere maps to a disc:

- **Top disc** (tilt 0–90°): `r = √2 · sin(θ/2)`, normalized to unit disc
- **Bottom disc** (tilt 90–180°): `r = √2 · cos(θ/2)`, normalized to unit disc
- `x = r · cos(rot)`, `y = r · sin(rot)`

**Inverse** (click position → Euler angles):
- `rot = atan2(y, x)`
- Top: `tilt = 2 · arcsin(r / √2)`
- Bottom: `tilt = π − 2 · arcsin(r / √2)`

**Hexagonal tessellation**: Tile each disc with a hex grid. Cell size scales with difficulty:

| Difficulty | Hex cell angular size | Approx cells/hemisphere | Psi steps |
|---|---|---|---|
| Level 1 (easy) | ~18° | ~60 | 20 (18° steps) |
| Level 2 | ~15° | ~90 | 24 (15° steps) |
| Level 3 | ~12° | ~140 | 30 (12° steps) |
| Level 4 | ~9° | ~250 | 40 (9° steps) |
| Level 5 (hard) | ~6° | ~550 | 60 (6° steps) |

Each hex cell maps to a quantized (rot, tilt) pair via its center's inverse Lambert projection. Cell borders are **not drawn** — cells are only visible when colored by NCC.

**Symmetry highlighting**: For proteins with symmetry > C1, only the asymmetric unit cells are active (clickable). The rest are dimmed/grayed. Asymmetric units:

| Symmetry | Asymmetric unit |
|---|---|
| C1 | Full sphere (both discs) |
| Cn | 360°/n wedge in rot, both hemispheres |
| Dn | 360°/n wedge in rot, top hemisphere only |
| T | 1/12 of sphere (spherical triangle) |
| O | 1/24 of sphere (spherical triangle) |
| I | 1/60 of sphere (spherical triangle) |

### Psi Ring (in-plane rotation selection)

A circle with quantized tick marks. The player clicks/drags to select a psi angle. Explored psi values at the current (rot, tilt) are shown as colored arcs/segments using the NCC color scale.

### NCC Heatmap Logic

- **Color scale**: dynamic, maps linearly from min(all encountered NCC values) → blue to max → red. Updates as the player explores.
- **Hemisphere discs**: each explored hex cell shows the **best NCC found at that (rot, tilt) across all explored psi values**. Unexplored cells remain neutral/transparent.
- **Psi ring**: each explored psi segment shows the NCC value at that psi **for the currently selected (rot, tilt)**. When the player selects a new (rot, tilt), the ring updates to show only the psi values explored at that cell.
- **Text display**: current NCC value shown prominently (e.g. top-right of game screen).

### Quantization

All player-selectable parameters are quantized. The target orientation is sampled from the **same quantized grid**, guaranteeing an exact match exists. This means:
- Target (rot, tilt) = center of a random hex cell in the asymmetric unit
- Target psi = one of the quantized psi steps

---

## Game Mechanics

### Level Flow

1. Load volume + supersample + generate target image
2. Player explores orientations via disc/ring controls
3. Each parameter change triggers: projection → CTF → NCC computation → heatmap update
4. Player clicks **Submit** when satisfied
5. Score calculated based on angular distance to target

### Scoring

**Angular distance** between player's and target's orientations on SO(3), measured as the geodesic angle:

```typescript
// R_player and R_target are 3x3 rotation matrices
// Angular distance = arccos((trace(R_player^T · R_target) - 1) / 2)
function angularDistance(R1: Float32Array, R2: Float32Array): number {
    // R1^T · R2
    const trace = R1[0]*R2[0] + R1[1]*R2[1] + R1[2]*R2[2]
               + R1[3]*R2[3] + R1[4]*R2[4] + R1[5]*R2[5]
               + R1[6]*R2[6] + R1[7]*R2[7] + R1[8]*R2[8];
    return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
}
```

**With symmetry**: compute angular distance to all symmetry-equivalent orientations of the target, take the minimum.

**Star rating** (per level):
- 3 stars: within 1 quantization step of target
- 2 stars: within 3 steps
- 1 star: within 6 steps
- 0 stars: further away

### Campaign Levels

| Level | Protein | Symmetry | Defocus (μm) | SNR | Grid size |
|---|---|---|---|---|---|
| 1 | Apoferritin | O (24-fold) | 5.0 | 0.5 | ~18° |
| 2 | GroEL | D7 | 3.5 | 0.3 | ~15° |
| 3 | Ribosome 80S | C1 | 2.5 | 0.2 | ~12° |
| 4 | β-galactosidase | D2 | 1.5 | 0.1 | ~9° |
| 5 | TRPV1 | C4 | 0.5 | 0.05 | ~6° |

Each level bundles its MRC file (downsampled to 64³ or 128³).

---

## Project Structure

```
euler-hunt/
├── src/
│   ├── shaders/
│   │   ├── projection.vert      # fullscreen quad
│   │   └── projection.frag      # ray-sum through 3D texture
│   ├── core/
│   │   ├── renderer.ts          # WebGL2 context, shader program, 3D texture, draw
│   │   ├── ctf.ts               # CTF computation (from ctf.cs)
│   │   ├── euler.ts             # Euler → rotation matrix (from euler.cs)
│   │   ├── ncc.ts               # normalized cross-correlation
│   │   ├── volume.ts            # MRC loading, supersampling via 3D FFT, texture upload
│   │   └── symmetry.ts          # symmetry group definitions, equivalent orientations
│   ├── ui/
│   │   ├── hemisphere-disc.ts   # Lambert projection, hex grid, click handling, NCC overlay
│   │   ├── psi-ring.ts          # psi angle selector, NCC segments
│   │   ├── game-screen.ts       # main game layout, image displays, NCC text
│   │   └── title-screen.ts      # campaign/free play selection, file picker
│   ├── game/
│   │   ├── campaign.ts          # level definitions (protein, symmetry, params)
│   │   ├── state.ts             # game state: current params, explored cells, NCC values
│   │   └── scoring.ts           # angular distance, symmetry min, star rating
│   ├── hex-grid.ts              # hexagonal grid math (axial coordinates, layout, hit testing)
│   ├── lambert.ts               # Lambert azimuthal equal-area forward/inverse
│   └── main.ts                  # entry point, mount/unmount
├── public/
│   ├── index.html               # standalone page
│   └── maps/                    # bundled MRC files for campaign levels
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## Key Implementation Details

### Hex Grid (axial coordinates)

Use axial hex coordinates (q, r) with flat-top hexagons. Given a target angular spacing, compute the hex size on the unit disc. For each hex cell:

1. Compute center in disc coordinates (x, y)
2. If center is inside the unit disc, the cell is valid
3. Inverse Lambert → (rot, tilt): these are the quantized Euler angles for this cell
4. For symmetry: check if (rot, tilt) is inside the asymmetric unit; if not, mark as inactive

**Hit testing**: given a click at (x, y) on the disc, convert to axial coords → snap to nearest hex center → look up the quantized (rot, tilt).

### Performance Budget

| Operation | Size | Expected time |
|---|---|---|
| GPU projection | 128² output, 128 samples/ray | <1ms |
| gl.readPixels | 128² float32 | <1ms |
| 2D FFT (ndarray-fft) | 128² | ~2-5ms |
| CTF multiply | 128² | <1ms |
| 2D IFFT | 128² | ~2-5ms |
| NCC computation | 128² = 16K pixels | <1ms |
| **Total per interaction** | | **~5-12ms** |

Comfortably interactive. The supersampling 3D FFT is one-time (~100-500ms for 128³ → 256³) and happens at level load. For 64³ volumes (like the test map), supersampling to 128³ is near-instant.

### Noise Generation

Target image noise: additive Gaussian noise scaled by the difficulty SNR.

```typescript
// After CTF application, add noise
const signal = ctfAppliedProjection;
const signalStd = std(signal);
const noiseStd = signalStd / snr;  // SNR = signal_std / noise_std
for (let i = 0; i < signal.length; i++) {
    signal[i] += gaussianRandom() * noiseStd;
}
```

### Offline/Embed Compatibility

The game is built as a self-contained ES module. For the Blazor disconnect screen:
- Bundle all campaign maps + code into a single JS file (or JS + binary assets)
- Import and call `EulerHunt.mount(element)` from the disconnect overlay
- No network requests needed during gameplay (Firebase highscores are optional and deferred)

---

## Symmetry Implementation (from RELION)

### Approach

Each symmetry group is defined by a set of **generator** rotation axes. The full set of symmetry-equivalent rotation matrices is computed by:
1. For each `rot_axis n ax ay az`: generate n-1 rotation matrices at angles 360°/n, 2×360°/n, ..., (n-1)×360°/n about the axis (ax, ay, az), using Rodrigues' rotation formula.
2. Multiply all pairs of generated matrices, adding any new results.
3. Repeat until closed (no new matrices produced).

The identity is implicit and not stored. For a group of order N, there are N-1 non-identity matrices.

### Generator Definitions (from RELION symmetries.cpp)

For the game, we support these groups (the ones relevant to cryo-EM):

| Group | Generators |
|---|---|
| C1 | (none — no symmetry) |
| Cn | `rot_axis n 0 0 1` |
| Dn | `rot_axis n 0 0 1` + `rot_axis 2 1 0 0` |
| T | `rot_axis 3 0 0 1` + `rot_axis 2 0 0.816496 0.577350` |
| O | `rot_axis 3 0.577350 0.577350 0.577350` + `rot_axis 4 0 0 1` |
| I (I2) | `rot_axis 2 0 0 1` + `rot_axis 5 0.525731 0 0.850651` + `rot_axis 3 0 0.356822 0.934172` |

### Rodrigues' Rotation Formula

Given rotation angle θ about unit axis (ux, uy, uz):

```typescript
function rotationMatrix(angleDeg: number, axis: [number, number, number]): number[] {
    const theta = angleDeg * Math.PI / 180;
    const c = Math.cos(theta), s = Math.sin(theta), t = 1 - c;
    const [ux, uy, uz] = normalize(axis);
    // Row-major 3x3
    return [
        t*ux*ux + c,     t*ux*uy - s*uz,  t*ux*uz + s*uy,
        t*ux*uy + s*uz,  t*uy*uy + c,     t*uy*uz - s*ux,
        t*ux*uz - s*uy,  t*uy*uz + s*ux,  t*uz*uz + c
    ];
}
```

### Subgroup Closure

```typescript
function computeSubgroup(generators: number[][]): number[][] {
    const matrices = [...generators];
    let changed = true;
    while (changed) {
        changed = false;
        const n = matrices.length;
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                const product = multiply3x3(matrices[i], matrices[j]);
                if (!isIdentity(product) && !isDuplicate(product, matrices)) {
                    matrices.push(product);
                    changed = true;
                }
            }
        }
    }
    return matrices;
}
```

### Angular Distance with Symmetry

To score with symmetry, compute the minimum angular distance over all symmetry-equivalent orientations:

```typescript
function symmetricAngularDistance(
    R_player: number[], R_target: number[], symMatrices: number[][]
): number {
    let minDist = angularDistance(R_player, R_target);
    for (const S of symMatrices) {
        const R_equiv = multiply3x3(R_target, S);  // R * S (right multiply)
        const dist = angularDistance(R_player, R_equiv);
        minDist = Math.min(minDist, dist);
    }
    return minDist;
}
```

### Asymmetric Unit for Hemisphere Discs

For each hex cell on the disc, check if its (rot, tilt) falls in the asymmetric unit:

| Group | ASU test |
|---|---|
| C1 | Always true |
| Cn | `rot ∈ [0, 360°/n)` |
| Dn | `rot ∈ [0, 360°/n)` AND `tilt ∈ [0°, 90°]` (top hemisphere only) |
| T, O, I | Check if the viewing direction vector `(sin(tilt)cos(rot), sin(tilt)sin(rot), cos(tilt))` is closer to the north pole than to any symmetry-equivalent pole. This is equivalent to checking that the angular distance to (0,0,1) is ≤ the angular distance to any S·(0,0,1). |

The T/O/I test can be precomputed: generate all symmetry-equivalent Z-axis directions, and for any viewing direction, check it's closest to the original Z-axis.

### Non-redundant Ewald sphere area (from RELION)

Useful for display — fraction of sphere that is the asymmetric unit:

| Group | Fraction of 4π |
|---|---|
| C1 | 1 |
| Cn | 1/n |
| Dn | 1/(2n) |
| T | 1/12 |
| O | 1/24 |
| I | 1/60 |

---

## Verification / Testing

1. **Shader correctness**: render a known volume (e.g., sphere) at identity rotation → should produce a circle. Rotate 90° → should match expected projection.
2. **CTF correctness**: compare TS CTF output against C# reference for known parameters.
3. **Euler matrix correctness**: compare TS output against C# reference for known angles.
4. **NCC correctness**: NCC of an image with itself = 1.0. NCC of an image with noise-only ≈ 0.
5. **Supersampling**: compare projection of supersampled vs. non-supersampled volume — supersampled should show smoother, more detailed features.
6. **Quantization round-trip**: hex cell center → (rot, tilt) → Lambert projection → should land back in the same cell.
7. **Symmetry**: for a known symmetry group, verify that all equivalent orientations produce the same projection.
