import { getSymmetryMatrices, symmetryOrder, isInAsymmetricUnit } from './src/core/symmetry';

// Test group sizes
const groups = ['C1', 'C4', 'D2', 'D7', 'T', 'O', 'I'];
const expectedOrders = [1, 4, 4, 14, 12, 24, 60];

for (let i = 0; i < groups.length; i++) {
  const order = symmetryOrder(groups[i]);
  const pass = order === expectedOrders[i];
  console.log(`${groups[i]}: order=${order} (expected ${expectedOrders[i]}) ${pass ? 'PASS' : 'FAIL'}`);
}

// Test ASU for D2: should be rot in [0, π), tilt in [0, π/2]
const d2Tests = [
  { rot: 0, tilt: 0, expected: true },
  { rot: 0, tilt: Math.PI / 4, expected: true },
  { rot: 0, tilt: Math.PI * 0.6, expected: false }, // tilt > π/2
  { rot: Math.PI * 1.5, tilt: Math.PI / 4, expected: false }, // rot > π
];
console.log('\nD2 ASU tests:');
for (const t of d2Tests) {
  const result = isInAsymmetricUnit(t.rot, t.tilt, 'D2');
  const pass = result === t.expected;
  console.log(`  rot=${(t.rot * 180 / Math.PI).toFixed(0)}° tilt=${(t.tilt * 180 / Math.PI).toFixed(0)}°: ${result} (expected ${t.expected}) ${pass ? 'PASS' : 'FAIL'}`);
}
