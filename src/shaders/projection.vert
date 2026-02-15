#version 300 es

// Fullscreen quad: 3 vertices covering the entire clip space
// Vertex ID 0: (-1, -1), 1: (3, -1), 2: (-1, 3)
out vec2 vUV;

void main() {
    float x = float((gl_VertexID & 1) << 2) - 1.0;
    float y = float((gl_VertexID & 2) << 1) - 1.0;
    vUV = vec2(x, y) * 0.5 + 0.5;
    gl_Position = vec4(x, y, 0.0, 1.0);
}
