declare module 'ndarray-fft' {
  import type { NdArray } from 'ndarray';
  function fft(dir: 1 | -1, real: NdArray, imag: NdArray): void;
  export = fft;
}

declare module 'ndarray-ops' {
  import type { NdArray } from 'ndarray';
  export function assign(dest: NdArray, src: NdArray): void;
  export function adds(dest: NdArray, src: NdArray, scalar: number): void;
  export function muls(dest: NdArray, src: NdArray, scalar: number): void;
  export function mul(dest: NdArray, a: NdArray, b: NdArray): void;
  export function random(dest: NdArray): NdArray;
  export function sup(arr: NdArray): number;
  export function inf(arr: NdArray): number;
}

declare module 'zeros' {
  import type { NdArray } from 'ndarray';
  function zeros(shape: number[]): NdArray;
  export = zeros;
}
