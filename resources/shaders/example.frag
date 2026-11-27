#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// fBm plasma — an example texture fragment for Frag Bench.
// Edit or drop more .frag files in resources/shaders/ and they appear live
// in the Frag Bench (http://localhost:8899/frag).

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec2 p = uv * 3.0 + u_seed * 0.13;
  float n = 0.0, a = 1.0;
  for (int i = 0; i < 5; i++) { n += a * noise(p); p *= 2.03; a *= 0.55; }
  vec3 col = mix(vec3(0.02, 0.03, 0.08), vec3(0.35, 0.55, 0.85), n);
  col += pow(clamp(n - 0.4, 0.0, 1.0), 3.0) * vec3(0.9, 0.7, 0.4);
  outColor = vec4(col, 1.0);
}
