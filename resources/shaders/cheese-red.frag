#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// "CHEDDAR STATIC" — bright-red livestream underlay for the cheese intro.
// Drifting fbm smoke in deep maroon over a bright red base, scorch patches,
// sporadic horizontal glitch bands and faint scanlines. Opaque (alpha 1).
// Coordinate convention: bottom-up (gl_FragCoord default); noise is
// orientation-agnostic so no top-down flip is needed.

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45) + u_seed * 7.13);
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;             // bottom-up
  vec2 asp = vec2(u_resolution.x / u_resolution.y, 1.0);
  float t = u_time * 0.06 + u_seed * 13.7;

  // slow drifting smoke + finer grain layer
  float n  = fbm(uv * asp * 3.0 + vec2(t, -t * 0.6));
  float n2 = fbm(uv * asp * 7.0 - vec2(t * 1.7, t * 0.9));

  // sporadic horizontal glitch bands (per scanline row, stepped in time)
  float rowKey = hash(vec2(floor(uv.y * 90.0), floor(u_time * 7.0) + u_seed));
  float band = step(0.992 - 0.004 * sin(u_time * 3.1 + u_seed), rowKey);

  // palette: bright red base, deep maroon smoke, near-black scorch
  vec3 base   = vec3(0.86, 0.08, 0.09);
  vec3 maroon = vec3(0.36, 0.015, 0.03);
  vec3 scorch = vec3(0.10, 0.000, 0.01);

  vec3 col = mix(base, maroon, smoothstep(0.25, 0.9, n * 0.75 + n2 * 0.35));
  col = mix(col, scorch, smoothstep(0.65, 0.98, n2) * 0.55);

  // faint CRT scanlines + slow global flicker
  col *= 1.0 - 0.045 * (0.5 + 0.5 * sin(gl_FragCoord.y * 2.1));
  col *= 1.0 + 0.03 * sin(u_time * 2.0 + u_seed * 5.0);
  col += vec3(0.10, 0.01, 0.01) * band;

  // vignette pulls the corners down so the title pops
  float d = length((uv - 0.5) * vec2(1.6, 1.15));
  col *= 1.0 - 0.38 * smoothstep(0.45, 1.05, d);

  outColor = vec4(col, 1.0);
}
