#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// hec.112 cat-cube drop shadow — procedural isometric-hexagon silhouette,
// soft gaussian falloff, offset 3px below the cube. The per-vertex radii were
// ray-cast from the real hec.112.png by scripts/hec-plaster.mjs.
//
// Rasterize with the container-native pipeline:
//   scripts/frag-render.sh resources/shaders/hec-cube-shadow.frag 144 144 out.png
// then scripts/hec-plaster.mjs composites it under every cube (the shadow
// rotates/scales along with its cube, like cloud-step's shadowed stamps).
//
// Space: IMAGE space (y down, matching the cube PNG and the plaster stamp
// coordinates). gl_FragCoord grows bottom-up, so flip once at the top of
// main() — see SHADER-NOTES.md. u_time/u_seed are declared for bench parity
// but intentionally unused: a shadow asset must stay deterministic.

const float S = 144.0;                 // canvas = 112px cube frame + 16px margin
const vec2 CUBE_C = vec2(72.0, 72.0);  // cube-frame centre, image space
const vec2 SH_C = vec2(72.0, 75.0);    // shadow centre: 3px below the cube
const float SIGMA = 5.0;               // gaussian falloff, cube px
const float ALPHA = 0.45;              // peak opacity right under the cube

const int NV = 6;
// fitted per-vertex circumradii (vertices at 30° + 60k, pointy-top hexagon)
const float RV[NV] = float[NV](56.5, 53.8, 43.8, 50.8, 51.8, 53.8);
const float D2R = 0.017453292519943295;

void main() {
  vec2 p = vec2(gl_FragCoord.x, S - gl_FragCoord.y);  // image space, y down
  float unused = u_time + u_seed;                     // bench-parity only
  unused += u_resolution.x * 0.0;

  // fitted hexagon vertices
  vec2 V[NV];
  for (int k = 0; k < NV; k++) {
    float a = (30.0 + 60.0 * float(k)) * D2R;
    V[k] = CUBE_C + RV[k] * vec2(cos(a), sin(a));
  }

  // unsigned distance to the hexagon boundary (point/segment loop)
  float d = 1e9;
  bool inside = true;
  for (int k = 0; k < NV; k++) {
    vec2 a0 = V[k], b0 = V[(k + 1) % NV];
    vec2 e = b0 - a0, w = p - a0;
    float t = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, length(w - e * t));
    float cr = e.x * w.y - e.y * w.x;   // convex inside test: sign consistency
    if (cr < 0.0) inside = false;
  }

  // fully dark under the cube, gaussian tail outside the silhouette
  float alpha = ALPHA * mix(exp(-d * d / (2.0 * SIGMA * SIGMA)), 1.0, inside ? 1.0 : 0.0);
  outColor = vec4(0.0, 0.0, 0.0, alpha);
}
