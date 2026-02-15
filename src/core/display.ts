/**
 * Draw a grayscale Float32Array image onto a 2D canvas with auto-contrast normalization.
 * Maps [min, max] → [0, 255].
 */
export function displayProjection(
  canvas: HTMLCanvasElement,
  data: Float32Array,
  size: number,
): void {
  const ctx = canvas.getContext('2d')!;
  canvas.width = size;
  canvas.height = size;

  // Find min/max for normalization
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }

  const range = max - min || 1;
  const imageData = ctx.createImageData(size, size);
  const pixels = imageData.data;

  for (let i = 0; i < data.length; i++) {
    // Flip Y: WebGL origin is bottom-left, canvas is top-left
    const srcRow = size - 1 - Math.floor(i / size);
    const srcCol = i % size;
    const srcIdx = srcRow * size + srcCol;

    const normalized = ((data[srcIdx] - min) / range) * 255;
    const byte = Math.max(0, Math.min(255, normalized)) | 0;
    const j = i * 4;
    pixels[j] = byte;
    pixels[j + 1] = byte;
    pixels[j + 2] = byte;
    pixels[j + 3] = 255;
  }

  ctx.putImageData(imageData, 0, 0);
}
