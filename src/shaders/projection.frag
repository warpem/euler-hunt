#version 300 es
precision highp float;
precision highp sampler3D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler3D uVolume;
uniform mat3 uRotation;
uniform float uStepCount;

void main() {
    float stepSize = 1.0 / uStepCount;
    float sum = 0.0;

    // Ray-march through the rotated volume
    for (float t = -0.5; t < 0.5; t += stepSize) {
        vec3 local = vec3(vUV.x - 0.5, vUV.y - 0.5, t);
        vec3 pos = uRotation * local + 0.5;

        // Only accumulate within the unit cube
        if (all(greaterThanEqual(pos, vec3(0.0))) && all(lessThanEqual(pos, vec3(1.0)))) {
            sum += texture(uVolume, pos).r;
        }
    }

    fragColor = vec4(sum, sum, sum, 1.0);
}
