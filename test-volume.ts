import { readFileSync } from 'fs';
import { loadVolume, supersample } from './src/core/volume.js';

const buffer = readFileSync('/Users/tegunovd/dev/euler-hunt/map.mrc').buffer;

console.log('=== Volume Loading ===');
const vol = loadVolume(buffer);
console.log(`Size: ${vol.size}³`);
console.log(`Pixel size: ${vol.pixelSize} Å`);
console.log(`Data length: ${vol.data.length} (expected ${vol.size ** 3})`);

// Stats
let min = Infinity, max = -Infinity, sum = 0;
for (let i = 0; i < vol.data.length; i++) {
  const v = vol.data[i];
  if (v < min) min = v;
  if (v > max) max = v;
  sum += v;
}
console.log(`Range: [${min.toFixed(4)}, ${max.toFixed(4)}]`);
console.log(`Mean: ${(sum / vol.data.length).toFixed(4)}`);

console.log('\n=== Supersampling ===');
const t0 = performance.now();
const ss = supersample(vol);
const t1 = performance.now();
console.log(`Supersampled: ${ss.size}³ in ${(t1 - t0).toFixed(0)}ms`);
console.log(`Pixel size: ${ss.pixelSize} Å`);
console.log(`Data length: ${ss.data.length} (expected ${ss.size ** 3})`);

// Stats of supersampled
let ssMin = Infinity, ssMax = -Infinity, ssSum = 0;
for (let i = 0; i < ss.data.length; i++) {
  const v = ss.data[i];
  if (v < ssMin) ssMin = v;
  if (v > ssMax) ssMax = v;
  ssSum += v;
}
console.log(`Range: [${ssMin.toFixed(4)}, ${ssMax.toFixed(4)}]`);
console.log(`Mean: ${(ssSum / ss.data.length).toFixed(4)}`);

// Compare: the mean should be roughly the same (within a factor from the scaling)
const origMean = sum / vol.data.length;
const ssMean = ssSum / ss.data.length;
console.log(`\nMean ratio (ss/orig): ${(ssMean / origMean).toFixed(4)}`);
console.log('Values reasonable:', ssMin < 0 && ssMax > 0 && Math.abs(ssMax) > 0.001 ? 'PASS' : 'FAIL');
