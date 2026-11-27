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

// 5x7 bitmap font, one row per entry, bit 4 = leftmost column.
bool glyph(int c, ivec2 cell) {
  if (cell.x < 0 || cell.x >= 5 || cell.y < 0 || cell.y >= 7) return false;
  // Bitmap rows are authored top-down, but gl_FragCoord.y grows bottom-up:
  // flip the row index or every glyph renders upside down (see SHADER-NOTES.md).
  int row = 6 - cell.y;
  int rows[7];
  if (c == 97)      { rows = int[7](14, 17, 17, 31, 17, 17, 0);  } // a
  else if (c == 107){ rows = int[7](17, 18, 20, 24, 20, 18, 17); } // k
  else if (c == 105){ rows = int[7](4, 0, 4, 4, 4, 4, 0);        } // i
  else if (c == 110){ rows = int[7](22, 25, 17, 17, 17, 17, 0);  } // n
  else if (c == 101){ rows = int[7](14, 17, 17, 30, 16, 14, 0);  } // e
  else if (c == 118){ rows = int[7](17, 17, 17, 17, 10, 4, 0);   } // v
  else if (c == 122){ rows = int[7](31, 2, 4, 8, 16, 31, 0);     } // z
  else if (c == 46) { rows = int[7](0, 0, 0, 0, 0, 4, 0);        } // .
  else if (c == 100){ rows = int[7](14, 17, 17, 17, 17, 14, 0);  } // d
  else return false;
  int shift = 4 - cell.x;
  return ((rows[row] >> shift) & 1) == 1;
}

void main() {
  // Pixel-space coordinates (1 unit = 1 pixel).
  vec2 px = gl_FragCoord.xy;

  float cw = 6.0;               // advance per character (5px glyph + 1px gap)
  vec2 size = vec2(float(TEXT_LEN) * cw - 1.0, 7.0);

  // Scale so the text spans ~70% of the smaller viewport axis; clamp for huge sizes.
  float s = min(min(u_resolution.x * 0.7 / size.x, u_resolution.y * 0.7 / size.y), 12.0);
  vec2 origin = (u_resolution - size * s) * 0.5; // centered

  vec2 gp = (px - origin) / s;  // glyph-space coordinates
  ivec2 cell = ivec2(floor(gp));
  int idx = cell.x / 6;
  bool on = false;
  if (idx >= 0 && idx < TEXT_LEN && mod(float(cell.x), 6.0) < 5.0) {
    on = glyph(TEXT[idx], ivec2(cell.x - idx * 6, cell.y));
  }

  vec3 bg = vec3(0.02, 0.03, 0.08);
  vec3 fg = vec3(0.55, 0.75, 1.0);
  vec3 col = mix(bg, fg, on ? 1.0 : 0.0);

  // Subtle animated glow behind the text.
  vec2 c = (px - (origin + size * s * 0.5)) / (size * s * 0.5);
  float glow = exp(-dot(c, c) * 2.0) * (0.12 + 0.05 * sin(u_time * 0.8 + u_seed));
  col += fg * glow;

  outColor = vec4(col, 1.0);
}
