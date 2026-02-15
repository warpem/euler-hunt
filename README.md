# Euler Hunt

A browser game that teaches cryo-EM orientation determination. You're shown a noisy 2D projection of a protein — your job is to find the 3D orientation (Euler angles) that produced it.

This mirrors what software like RELION does automatically: given a particle image, search over all possible orientations to find the best match. Here, you do it by hand.

## How it works

Each level gives you a **target projection** on the left (with CTF distortion and noise, just like a real micrograph) and a **player projection** on the right that updates in real-time as you explore orientations.

You navigate orientation space through **progressive subdivision**, mimicking RELION's multi-resolution refinement:

| Step | Angular grid | Low-pass filter | Psi steps |
|------|-------------|-----------------|-----------|
| 1 | 30.0° | 6.25% Nyquist | 12 |
| 2 | 15.0° | 12.5% Nyquist | 24 |
| 3 | 7.5° | 25% Nyquist | 48 |
| 4 | 3.75° | 50% Nyquist | 96 |
| 5 | 1.875° | No filter | 192 |

Start coarse (blurry projections, few cells to check), find the rough orientation using the NCC heatmap, then click **Subdivide** to refine. Each subdivision doubles the angular resolution and reveals more high-frequency detail in the projections. This is irreversible — commit to a region before refining.

The two hemisphere discs show a Lambert equal-area projection of orientation space, colored by best NCC at each cell. The psi ring controls in-plane rotation. Psi auto-compensates when you change the viewing direction to account for the ZYZ Euler angle coupling.

**Scoring** uses Fourier Ring Correlation (FRC) between the noise-free target and your final projection. The resolution where FRC crosses 0.5 determines your score — the same metric used to assess real cryo-EM reconstructions.

## Campaign

Five levels of increasing difficulty using real EMDB structures:

| # | Protein | PDB/EMDB | Symmetry | CTF | Noise |
|---|---------|----------|----------|-----|-------|
| 1 | Apoferritin | EMD-51612 | O (24-fold) | — | — |
| 2 | GroEL | EMD-31310 | D7 | 4.0 μm | — |
| 3 | β-galactosidase | EMD-72471 | D2 | 3.0 μm | SNR 0.8 |
| 4 | Ribosome 80S | — | C1 | 2.0 μm | SNR 0.3 |
| 5 | TRPV3 | EMD-44645 | C4 | 1.0 μm | SNR 0.1 |

High-symmetry proteins are easier (smaller search space). Adding CTF creates contrast reversals at certain frequencies. Low SNR buries the signal in noise — you'll need the LP-filtered coarse steps to find the orientation before refining.

## Free Play

Upload any MRC density map (128³ recommended) and configure:
- Symmetry group (C1–C6, D2–D7, T, O, I)
- CTF on/off with adjustable defocus
- Noise on/off with adjustable SNR

## Technical overview

**Rendering**: WebGL2 ray-marching through a 3D texture (supersampled 2× via Fourier zero-padding for interpolation quality). Projection readback via `readPixels` into Float32Array.

**Image processing** (all in JS via ndarray-fft):
- CTF: standard cryo-EM contrast transfer function applied in Fourier space
- Low-pass: raised-cosine rolloff filter, applied jointly with CTF in a single FFT pass when both are active
- NCC: normalized cross-correlation between LP-filtered target and player projections
- FRC: Fourier Ring Correlation in 1-pixel annular rings, 0.5 crossing → resolution in Å

**Orientation space**: Lambert azimuthal equal-area projection maps hemispheres to discs. Hexagonal grid in axial coordinates with hit-testing via cube coordinate rounding. Symmetry-aware: only cells within the asymmetric unit are shown.

**Symmetry**: Generator-based construction of rotation groups via Rodrigues' formula, with subgroup closure. ASU detection per symmetry type (Cn/Dn by angle bounds, T/O/I by closest-to-pole test among all equivalent directions).

## Development

```bash
npm install
npm run dev      # Vite dev server with HMR
npm run build    # TypeScript check + production build
npm run preview  # Preview production build locally
```

Requires Node.js 18+ and a browser with WebGL2 support.

## Dependencies

- **@warpem/mrc-parser** — MRC file format parsing
- **ndarray** + **ndarray-fft** — N-dimensional arrays and FFT
- **vite** + **vite-plugin-glsl** — Build tooling with GLSL shader imports
