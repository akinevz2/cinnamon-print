# Shader Authoring Notes (Frag Bench)

Gotchas and conventions for GLSL fragment shaders in `resources/shaders/`.
Read this before writing or editing a `.frag` file here.

## Coordinate system: Y grows BOTTOM-UP

`gl_FragCoord` (and WebGL/NDC clip space generally) has its origin at the
**bottom-left** of the viewport: `y = 0` is the bottom edge, `y` increases
upward. This is the opposite of:

- bitmap font data and image files (row 0 = **top**)
- most 2D screen/UI coordinate systems (y increases **downward**)
- PNG pixel buffers

### Symptom: text/glyphs render upside down

If you encode bitmap glyphs top-down (row 0 = top of the letter) and index
them directly with `gl_FragCoord`-derived `cell.y`, every glyph appears
vertically mirrored. Fix by flipping the row index:

```glsl
int row = (rows.length - 1) - cell.y;   // e.g. 7-row font: int row = 6 - cell.y;
```

### Symptom: whole render is vertically mirrored

If a full-screen pattern (noise, gradients, images) appears flipped, convert
to "top-down" UVs once at the top of `main()`:

```glsl
vec2 uv = gl_FragCoord.xy / u_resolution;       // bottom-up (GLSL default)
vec2 uv_td = vec2(uv.x, 1.0 - uv.y);            // top-down (image-like)
```

Pick ONE convention per shader, state it in a comment, and stick to it.

## Other Frag Bench conventions

- **Host vs container tool split**: the container ships ONLY pandoc, node,
  chromium, jq, opencode, fontconfig — no ImageMagick, no python3, no
  google-chrome. `frag-render.sh` and `font-to-glsl.sh` are
  container-native (node + chromium, chromium auto-detected; override with
  `CHROME_BIN`). The magick/python pipeline (`font-to-glsl.py`,
  `gen-banner-frag.py`) is HOST-ONLY — run it outside the container.
- Shaders live in `resources/shaders/*.frag`; they appear live in the
  Frag Bench tab (`http://localhost:8899/frag`) — no registration needed.
- Available uniforms: `u_resolution` (vec2), `u_time` (float, seconds),
  `u_seed` (float). Use all three so shaders respond to the bench controls.
- GLSL ES 3.00 (`#version 300 es`) has **no string type**: store text as
  `int[]` ASCII codes and look glyphs up per fragment (see `example.frag`).
- For real font shapes, rasterize a TTF into bitmaps:
  - **inside the container**: `scripts/font-to-glsl.sh <font.ttf> <text> [pointsize]`
    (chromium-based — the container-native path)
  - **on the host**: `python3 scripts/font-to-glsl.py <font.ttf> <text> [pointsize]`
    (ImageMagick-based; richer threshold control)
  Both emit GLSL row data — see `example.font.frag` for the assembled result.
- Prefer vector/list constants declared as `const int NAME[N] = int[N](...);`
  over per-branch literals.

## Embedding image data in a .frag — the storage wall (measured)

A `.frag` has no texture support in the bench, so any image data must ride in
the shader source. On this container's chromium (ANGLE → SwiftShader) that
hits two hard walls — **both silent**: compile, link and draw all succeed,
but pixel reads return 0 (a black/transparent swatch).

1. **File-scope `const` arrays cannot be dynamically indexed.**
   `const uint PIX[N] = uint[N](...);` at file scope, read as `PIX[i]` with a
   runtime `i`, always yields 0. Only *local* arrays read correctly at dynamic
   indices — the same pattern as the bitmap font rows in `example.frag`.
2. **Total local-array storage caps out between 24,576 and 32,768 words.**
   Measured by packing real image words and rendering:

   | local `uint` words packed | result |
   |---:|---|
   | 8,192 | ✅ renders |
   | 16,384 | ✅ renders |
   | 24,576 | ✅ renders |
   | 32,768 | ❌ all reads return 0 |

   (A single *file-scope* array ≥ 16,384 fails earlier, with a visible compile
   error: "Size of declared private variable exceeds implementation-defined
   limit".)

Practical ceiling: ~24k packed RGBA8888 words ≈ a 155×155 image — fine for
glyph bitmaps and banners, hopeless for photos (a 804×718 scene needs ~144k
words even at half resolution; a native-res character cutout ~76k). **For real
images, don't smuggle pixels through GLSL source**: cut them into
`resources/fragments/fragment*.png` (see `scripts/trace-cutout.mjs` for
background/character separation) and let the compose pipeline place them.
