#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// Assembled from scripts/font-to-glsl.sh (BAHNSCHRIFT.TTF) bitmap rows.
// Text: 'IT IS TIME.'
// The rasterizer emits a deduplicated glyph PALETTE; TEXT[] holds per-character
// palette indices. Infill #ffcd28 — 1px outline #200404. Transparent background.
// Rows are TOP-DOWN; the shader flips the row index because gl_FragCoord.y
// grows BOTTOM-UP — see resources/shaders/SHADER-NOTES.md.

const int PAL_LEN = 7;
const int GW[PAL_LEN] = int[PAL_LEN](4, 18, 19, 23, 17, 4, 7);
const int GDATA[PAL_LEN * 26] = int[PAL_LEN * 26](15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,262143,262143,262143,262143,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,1920,8160,32760,65534,131070,253980,245760,245760,245760,245760,245760,258048,130816,65520,16380,1022,62,31,15,15,15,196623,229438,524286,262140,131064,16352,7864335,7864351,8126495,8126527,8257599,8257599,8323199,8323199,8356095,8356079,8094191,8110575,7979983,7988175,7922575,7927695,7927567,7896847,7896847,7880207,7880207,7871503,7870479,7864335,7864335,7864335,131071,131071,131071,131071,122880,122880,122880,122880,122880,122880,122880,131068,131068,131068,131068,122880,122880,122880,122880,122880,122880,122880,131071,131071,131071,131071,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,15,15,15,15,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0
);

const int TEXT_LEN = 11;
const int TEXT[TEXT_LEN] = int[TEXT_LEN](0, 1, 6, 0, 2, 6, 1, 0, 3, 4, 5);

const float S = 9.0;                 // glyph pixel scale
const vec3 FILL = vec3(255,205,40) / 255.0;
const vec3 OUTLINE = vec3(32,4,4) / 255.0;

bool textOn(vec2 gp) {
  float x = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) {
    int gi = TEXT[i];
    int w = GW[gi];
    if (w > 0 && gp.x >= x && gp.x < x + float(w) && gp.y >= 0.0 && gp.y < 26.0) {
      ivec2 c = ivec2(floor(gp) - vec2(x, 0.0));
      int row = 25 - c.y;           // flip: bottom-up fragcoord
      return ((GDATA[26 * gi + row] >> (w - 1 - c.x)) & 1) == 1;
    }
    x += float(w) + 1.0;
  }
  return false;
}

void main() {
  float totalW = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) totalW += float(GW[TEXT[i]]);
  totalW += float(TEXT_LEN - 1);
  vec2 size = vec2(totalW, 26.0) * S;
  vec2 origin = (u_resolution - size) * 0.5;

  vec2 gp = (gl_FragCoord.xy - origin) / S;
  bool on = textOn(gp);
  bool edge = false;
  if (!on) {
    for (int dy = -1; dy <= 1; dy++) {
      for (int dx = -1; dx <= 1; dx++) {
        if (dx == 0 && dy == 0) continue;
        edge = edge || textOn(gp + vec2(float(dx), float(dy)));
      }
    }
  }

  vec3 col = on ? FILL : OUTLINE;
  float a = (on || edge) ? 1.0 : 0.0;
  outColor = vec4(col, a);
}
