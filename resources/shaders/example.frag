#version 300 es
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_seed;
out vec4 outColor;

// "akinevz.dev" text renderer — an example fragment for Frag Bench.
// Edit or drop more .frag files in resources/shaders/ and they appear live
// in the Frag Bench (http://localhost:8899/frag).

// ASCII codes of the message, one entry per character.
const int TEXT_LEN = 11;
const int TEXT[TEXT_LEN] = int[TEXT_LEN](
  97, 107, 105, 110, 101, 118, 122, 46, 100, 101, 118 // "akinevz.dev"
);

// 8-row bitmap font cells, one row per entry, leftmost pixel = top bit.
// Row 7 is the "underline" row: glyphs bottom out on row 6 (the baseline) —
// 'k' descends into row 7, 'd' stem tips into row 0 (one above the overline).
bool glyph(int c, ivec2 cell, int w) {
  if (cell.x < 0 || cell.x >= w || cell.y < 0 || cell.y >= 8) return false;
  // Bitmap rows are authored top-down, but gl_FragCoord.y grows bottom-up:
  // flip the row index or every glyph renders upside down (see SHADER-NOTES.md).
  int row = 7 - cell.y;
  int rows[8];
  if (c == 97)      { rows = int[8](0, 14, 17, 17, 31, 17, 17, 0);  } // a
  else if (c == 107){ rows = int[8](0, 17, 18, 20, 24, 20, 18, 17); } // k — descends one below baseline
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

// Glyph advance width: 1px for the '.', 5px for everything else.
float glyphW(int c) {
  return c == 46 ? 1.0 : 5.0;
}

// Kerning: pairs that get a tight (0px) gap; everything else keeps 1px.
float gapAfter(int i) {
  if (i >= TEXT_LEN - 1) return 0.0;
  int a = TEXT[i];
  int b = TEXT[i + 1];
  bool tight = (a == 107 && b == 105)   // "ki"
            || (a == 105 && b == 110);  // "in"
  // ".d" intentionally keeps the default 1px gap so "dev" floats off the dot.
  return tight ? 0.0 : 1.0;
}

void main() {
  // Pixel-space coordinates (1 unit = 1 pixel).
  vec2 px = gl_FragCoord.xy;

  // Glyphs are 5px wide except the '.' (1px); gap varies per pair (see gapAfter).
  float totalW = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) totalW += glyphW(TEXT[i]) + gapAfter(i);
  vec2 size = vec2(totalW, 8.0);

  // Scale so the text spans ~70% of the smaller viewport axis; clamp for huge sizes.
  float s = min(min(u_resolution.x * 0.7 / size.x, u_resolution.y * 0.7 / size.y), 12.0);
  vec2 origin = (u_resolution - size * s) * 0.5; // centered

  vec2 gp = (px - origin) / s;  // glyph-space coordinates
  bool on = false;
  float x = 0.0;
  for (int i = 0; i < TEXT_LEN; i++) {
    float w = glyphW(TEXT[i]);
    if (gp.x >= x && gp.x < x + w && gp.y >= 0.0 && gp.y < 8.0) {
      ivec2 cell = ivec2(floor(gp) - vec2(x, 0.0));
      on = glyph(TEXT[i], cell, int(w));
    }
    x += w + gapAfter(i);
  }

  vec3 bg = vec3(0.02, 0.03, 0.08);
  vec3 fg = vec3(254.0, 239.0, 105.0) / 255.0; // #feef69
  vec3 col = mix(bg, fg, on ? 1.0 : 0.0);

  // Subtle animated glow behind the text.
  vec2 c = (px - (origin + size * s * 0.5)) / (size * s * 0.5);
  float glow = exp(-dot(c, c) * 2.0) * (0.12 + 0.05 * sin(u_time * 0.8 + u_seed));
  col += fg * glow;

  outColor = vec4(col, 1.0);
}
