#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// "akinevz.com" rendered with REAL glyph shapes from resources/fonts/BAHNSCHRIFT.TTF.
// Bitmaps rasterized at a naive 10pt via scripts/font-to-glsl.py
// (ImageMagick, 50% coverage threshold, glyphs bottom-padded to a 7-row cell).

// Rows are TOP-DOWN (row 0 = top of glyph); the shader flips the row index
// because gl_FragCoord.y grows BOTTOM-UP — see SHADER-NOTES.md.

const int TEXT_LEN = 11;
const int TEXT[TEXT_LEN] = int[TEXT_LEN](97, 107, 105, 110, 101, 118, 122, 46, 99, 111, 109); // akinevz.com
const int GW[TEXT_LEN]   = int[TEXT_LEN](4, 4, 1, 4, 4, 5, 3, 1, 3, 4, 7); // glyph widths (px)

// 7 rows per glyph, concatenated; leftmost pixel = most significant bit.
const int GDATA[TEXT_LEN * 7] = int[TEXT_LEN * 7](
  // 'a' w=4
  0, 0, 14, 1, 15, 9, 15,
  // 'k' w=4
  8, 8, 11, 14, 14, 10, 9,
  // 'i' w=1
  0, 1, 1, 1, 1, 1, 1,
  // 'n' w=4
  0, 0, 14, 9, 9, 9, 9,
  // 'e' w=4
  0, 0, 14, 9, 15, 8, 14,
  // 'v' w=5
  0, 0, 17, 10, 10, 4, 4,
  // 'z' w=3
  0, 0, 7, 1, 2, 4, 7,
  // '.' w=1
  0, 0, 0, 0, 0, 0, 1,
  // 'c' w=3
  0, 0, 7, 4, 4, 4, 7,
  // 'o' w=4
  0, 0, 14, 9, 9, 9, 14,
  // 'm' w=7
  0, 0, 118, 73, 73, 73, 73
);

void main() {
  vec2 px = gl_FragCoord.xy;

  // Total size: sum of glyph widths + 1px gaps, 7px tall.
  float totalW = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) totalW += float(GW[i]);
  totalW += float(TEXT_LEN - 1); // gaps
  vec2 size = vec2(totalW, 7.0);

  float s = min(min(u_resolution.x * 0.7 / size.x, u_resolution.y * 0.7 / size.y), 12.0);
  vec2 origin = (u_resolution - size * s) * 0.5;

  vec2 gp = (px - origin) / s;
  bool on = false;
  float x = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) {
    int w = GW[i];
    if (gp.x >= x && gp.x < x + float(w) && gp.y >= 0.0 && gp.y < 7.0) {
      ivec2 c = ivec2(floor(gp) - vec2(x, 0.0));
      int row = 6 - c.y;                       // flip: bottom-up fragcoord
      on = ((GDATA[7 * i + row] >> (w - 1 - c.x)) & 1) == 1;
    }
    x += float(w) + 1.0;
  }

  vec3 bg = vec3(0.02, 0.03, 0.08);
  vec3 fg = vec3(0.55, 0.75, 1.0);
  vec3 col = mix(bg, fg, on ? 1.0 : 0.0);

  // Subtle animated glow behind the text.
  vec2 c = (px - (origin + size * s * 0.5)) / (size * s * 0.5);
  col += fg * exp(-dot(c, c) * 2.0) * (0.12 + 0.05 * sin(u_time * 0.8 + u_seed));

  outColor = vec4(col, 1.0);
}
