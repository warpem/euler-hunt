import { eulerToMatrix, deg2rad } from './src/core/euler.js';
import { ncc } from './src/core/ncc.js';
import { computeCTF } from './src/core/ctf.js';

// === Test Euler matrix ===
console.log('=== Euler Matrix Tests ===');

// Identity: rot=0, tilt=0, psi=0 should give identity matrix
const I = eulerToMatrix(0, 0, 0);
// Column-major identity: [1,0,0, 0,1,0, 0,0,1]
console.log('Identity:', Array.from(I).map(v => v.toFixed(4)).join(', '));
const isIdentity = Math.abs(I[0] - 1) < 1e-6 && Math.abs(I[4] - 1) < 1e-6 && Math.abs(I[8] - 1) < 1e-6;
console.log('  Is identity:', isIdentity ? 'PASS' : 'FAIL');

// rot=90°, tilt=0, psi=0
const R90 = eulerToMatrix(deg2rad(90), 0, 0);
console.log('rot=90°:', Array.from(R90).map(v => v.toFixed(4)).join(', '));
// Expected (col-major): col0=[0,-1,0], col1=[1,0,0], col2=[0,0,1]
// i.e. rotation about Z by 90°
const r90ok = Math.abs(R90[0]) < 1e-6 && Math.abs(R90[1] - (-1)) < 1e-6 &&
              Math.abs(R90[3] - 1) < 1e-6 && Math.abs(R90[4]) < 1e-6 &&
              Math.abs(R90[8] - 1) < 1e-6;
console.log('  rot=90° correct:', r90ok ? 'PASS' : 'FAIL');

// tilt=90° with rot=0, psi=0
const T90 = eulerToMatrix(0, deg2rad(90), 0);
console.log('tilt=90°:', Array.from(T90).map(v => v.toFixed(4)).join(', '));
// Expected (col-major): col0=[0,0,1], col1=[0,1,0], col2=[-1,0,0]
const t90ok = Math.abs(T90[2] - 1) < 1e-6 && Math.abs(T90[4] - 1) < 1e-6 &&
              Math.abs(T90[6] - (-1)) < 1e-6;
console.log('  tilt=90° correct:', t90ok ? 'PASS' : 'FAIL');

// === Test NCC ===
console.log('\n=== NCC Tests ===');

const a = new Float32Array([1, 2, 3, 4, 5]);
const b = new Float32Array([1, 2, 3, 4, 5]);
console.log('ncc(x, x):', ncc(a, b).toFixed(6), ncc(a, b) > 0.999 ? 'PASS' : 'FAIL');

const c = new Float32Array([-1, -2, -3, -4, -5]);
console.log('ncc(x, -x):', ncc(a, c).toFixed(6), ncc(a, c) < -0.999 ? 'PASS' : 'FAIL');

const noise = new Float32Array(1000);
const signal = new Float32Array(1000);
for (let i = 0; i < 1000; i++) {
  signal[i] = Math.sin(i * 0.1);
  noise[i] = (Math.random() - 0.5) * 10;
}
const nccNoise = ncc(signal, noise);
console.log('ncc(signal, noise):', nccNoise.toFixed(6), Math.abs(nccNoise) < 0.15 ? 'PASS' : 'FAIL (expected ~0)');

// === Test CTF ===
console.log('\n=== CTF Tests ===');
const ctf = computeCTF(64, 64, {
  pixelSize: 4.0,
  voltage: 300,
  cs: 2.7,
  amplitude: 0.07,
  defocus: 2.0,
});
console.log('CTF size:', ctf.length, ctf.length === 64 * 64 ? 'PASS' : 'FAIL');
console.log('CTF at DC (0,0):', ctf[0].toFixed(4));
// DC should be -sin(-K3) = sin(K3). K3 = atan(0.07/sqrt(1-0.07^2)) ≈ 0.07
console.log('  DC ≈ sin(atan(0.07/...)):', Math.abs(ctf[0] - Math.sin(Math.atan(0.07 / Math.sqrt(1 - 0.07 * 0.07)))) < 0.001 ? 'PASS' : 'FAIL');

// CTF should oscillate: check that we have both positive and negative values
let hasPos = false, hasNeg = false;
for (let i = 0; i < ctf.length; i++) {
  if (ctf[i] > 0.1) hasPos = true;
  if (ctf[i] < -0.1) hasNeg = true;
}
console.log('CTF oscillates (has + and -):', hasPos && hasNeg ? 'PASS' : 'FAIL');

console.log('\nAll core tests complete.');
