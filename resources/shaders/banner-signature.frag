#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// "akinevz.dev" — the hand-tuned glyphs and kerning from example.frag,
// on a transparent background (alpha set) so it composites onto the
// Bernoulli cloud banner as a bottom-right signature. Color: #feef69.

const int TEXT_LEN = 11;
const int TEXT[TEXT_LEN] = int[TEXT_LEN](97, 107, 105, 110, 101, 118, 122, 46, 100, 101, 118); // akinevz.dev
const int GW[TEXT_LEN]   = int[TEXT_LEN](4, 4, 1, 4, 4, 5, 3, 1, 4, 4, 5); // 6px for 'd' pre-fix; uniform 5 below

// 8-row bitmap font cells, rows top-down (flipped at lookup — SHADER-NOTES.md).
bool glyph(int c, ivec2 cell, int w) {
  if (cell.x < 0 || cell.x >= w || cell.y < 0 || cell.y >= 8) return false;
  int row = 7 - cell.y;
  int rows[8];
  if (c == 97)      { rows = int[8](0, 14, 17, 17, 31, 17, 17, 0);  } // a
  else if (c == 107){ rows = int[8](0, 17, 18, 20, 24, 20, 18, 17); } // k
  else if (c == 105){ rows = int[8](0, 4, 0, 4, 4, 4, 4, 0);        } // i
  else if (c == 110){ rows = int[8](0, 22, 25, 17, 17, 17, 17, 0);  } // n
  else if (c == 101){ rows = int[8](0, 14, 17, 17, 30, 16, 14, 0);  } // e
  else if (c == 118){ rows = int[8](0, 17, 17, 17, 17, 10, 4, 0);   } // v
  else if (c == 122){ rows = int[8](0, 31, 2, 4, 8, 16, 31, 0);     } // z
  else if (c == 46) { rows = int[8](0, 0, 0, 0, 0, 0, 1, 0);        } // .
  else if (c == 100){ rows = int[8](1, 1, 15, 17, 17, 17, 15, 0);   } // d — vertical stem doubles as the bowl's right wall
  else return false;
  int shift = w - 1 - cell.x;
  return ((rows[row] >> shift) & 1) == 1;
}

// Kerning: "ki" and "in" tight (0px), everything else 1px.
float gapAfter(int i) {
  if (i >= TEXT_LEN - 1) return 0.0;
  int a = TEXT[i];
  int b = TEXT[i + 1];
  bool tight = (a == 107 && b == 105)   // "ki"
            || (a == 105 && b == 110);  // "in"
  return tight ? 0.0 : 1.0;
}

// Glyph advance width: 1px for the '.', 5px for everything else.
float glyphW(int c) {
  return c == 46 ? 1.0 : 5.0;
}

const float S = 3.0;                    // glyph pixel scale
const vec3 FG = vec3(254.0, 239.0, 105.0) / 255.0; // #feef69

bool textOn(vec2 gp) {
  float x = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) {
    float w = glyphW(TEXT[i]);
    if (gp.x >= x && gp.x < x + w && gp.y >= 0.0 && gp.y < 8.0) {
      ivec2 cell = ivec2(floor(gp) - vec2(x, 0.0));
      return glyph(TEXT[i], cell, int(w));
    }
    x += w + gapAfter(i);
  }
  return false;
}

void main() {
  float totalW = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) totalW += glyphW(TEXT[i]) + gapAfter(i);
  vec2 size = vec2(totalW, 8.0) * S;
  vec2 origin = (u_resolution - size) * 0.5;

  vec2 gp = (gl_FragCoord.xy - origin) / S;
  bool on = textOn(gp);

  outColor = vec4(FG, on ? 1.0 : 0.0);
}
