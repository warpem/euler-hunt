import vertSrc from '../shaders/projection.vert';
import fragSrc from '../shaders/projection.frag';

export interface Renderer {
  /** The WebGL2 rendering context */
  gl: WebGL2RenderingContext;
  /** Upload a cubic volume as a 3D texture */
  uploadVolume(data: Float32Array, size: number): void;
  /**
   * Render a 2D projection at the given rotation.
   * @param rotation Column-major 3x3 rotation matrix (Float32Array of 9)
   * @param outputSize Output image width/height in pixels (typically original volume size)
   * @returns Float32Array of outputSize² pixel values (grayscale)
   */
  renderProjection(rotation: Float32Array, outputSize: number): Float32Array;
  /** Render the projection to the visible canvas for display */
  renderToScreen(rotation: Float32Array, outputSize: number): void;
  /** Resize the canvas */
  setCanvasSize(width: number, height: number): void;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

export function initRenderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    premultipliedAlpha: false,
  })!;
  if (!gl) throw new Error('WebGL2 not supported');

  // Required extensions for float textures
  const extColorFloat = gl.getExtension('EXT_color_buffer_float');
  if (!extColorFloat) {
    console.warn('EXT_color_buffer_float not available, readback may be limited');
  }
  // Required for LINEAR filtering on float textures — without this, sampling R32F returns 0
  const extFloatLinear = gl.getExtension('OES_texture_float_linear');
  if (!extFloatLinear) {
    console.warn('OES_texture_float_linear not available, falling back to NEAREST filtering');
  }

  const program = createProgram(gl, vertSrc, fragSrc);
  const uRotation = gl.getUniformLocation(program, 'uRotation')!;
  const uStepCount = gl.getUniformLocation(program, 'uStepCount')!;
  const uVolume = gl.getUniformLocation(program, 'uVolume')!;

  // Create an empty VAO for the fullscreen triangle (no vertex attributes needed)
  const vao = gl.createVertexArray()!;

  // Framebuffer + float texture for off-screen rendering + readback
  let fbo: WebGLFramebuffer | null = null;
  let fboTexture: WebGLTexture | null = null;
  let fboSize = 0;

  let volumeTexture: WebGLTexture | null = null;

  function ensureFBO(size: number) {
    if (fboSize === size && fbo) return;
    if (fbo) {
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(fboTexture);
    }
    fbo = gl.createFramebuffer()!;
    fboTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, fboTexture);
    // Use RGBA32F — readPixels only guarantees RGBA format support
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTexture, 0);
    const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer not complete: 0x${fbStatus.toString(16)}`);
    }
    fboSize = size;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  function draw(rotation: Float32Array, outputSize: number) {
    gl.useProgram(program);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
    gl.uniform1i(uVolume, 0);

    gl.uniformMatrix3fv(uRotation, false, rotation);
    gl.uniform1f(uStepCount, outputSize);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  return {
    gl,

    uploadVolume(data: Float32Array, size: number) {
      if (volumeTexture) gl.deleteTexture(volumeTexture);
      volumeTexture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
      gl.texImage3D(
        gl.TEXTURE_3D, 0, gl.R32F,
        size, size, size, 0,
        gl.RED, gl.FLOAT, data,
      );
      const filter = extFloatLinear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_3D, null);
    },

    renderProjection(rotation: Float32Array, outputSize: number): Float32Array {
      ensureFBO(outputSize);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, outputSize, outputSize);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      draw(rotation, outputSize);

      // Read RGBA, then extract just the R channel
      const rgba = new Float32Array(outputSize * outputSize * 4);
      gl.readPixels(0, 0, outputSize, outputSize, gl.RGBA, gl.FLOAT, rgba);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const pixels = new Float32Array(outputSize * outputSize);
      for (let i = 0; i < pixels.length; i++) {
        pixels[i] = rgba[i * 4]; // R channel
      }
      return pixels;
    },

    renderToScreen(rotation: Float32Array, outputSize: number) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      draw(rotation, outputSize);
    },

    setCanvasSize(width: number, height: number) {
      canvas.width = width;
      canvas.height = height;
    },
  };
}
