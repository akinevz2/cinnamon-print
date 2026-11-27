---
name: cinnamon-print
description: >
  Interactive composition workflow for the cinnamon-print project: scan
  fragment*.png components, compose and overlay them onto an output
  artifact (png or pdf) via the maintained Pandoc template, perform a
  linting pass with the user so every fragment has a logical assignment,
  and place custom fonts and custom text elements interactively. Also
  covers GENERATING new fragments intrinsically: GLSL shaders via the
  Frag Bench or the headless frag renderer, bitmap text via the font
  rasterizer, monte-carlo cloud fills — never by installing anything.
  Use whenever the user asks to compose, rebuild, lint, arrange, or
  GENERATE fragments/output artifacts in cinnamon-print.
---

# cinnamon-print compose

You are working inside the cinnamon-print container (nix-built, containing
pandoc, node, chromium and opencode). The project root is `/work`,
with `project/` holding the working files.

## Your responsibilities

1. **Maintain the Pandoc template.** The template at
   `project/templates/compose.html.tmpl` is yours to produce and keep
   correct for BOTH render targets: `png` (exact pixel canvas, windowed
   screenshot) and `pdf` (paginated print). When composition behaviour
   changes, update the template first, never hand-edit generated files
   (`compose.html`, `compose.body.html` are build products).

2. **Scan for fragments.** Enumerate every
   `resources/fragments/fragment*.png`
   (glob `fragment*.png`). Each one MUST end up with a logical assignment —
   an entry in `project/layout.json` under `elements` with
   `{"type": "fragment", "src": "<filename>", "x", "y", optionally "w"}`.

3. **Linting pass — always interactive with the user.** Before any render:
   - list every fragment on disk,
   - list every fragment assigned in `layout.json`,
   - report orphans in both directions and ASK the user where each
     unassigned fragment belongs (position, size, layering) rather than
     guessing. Composition is a collaborative decision, not automation.
   - exit non-zero on lint failure (compose.mjs already does this).

4. **Render both artifacts after any layout/template change.**
   ```
   node scripts/compose.mjs png <stem>   # -> project/output/<stem>.png
   node scripts/compose.mjs pdf <stem>   # -> project/output/<stem>.pdf
   ```
   The user's Makefile exposes this as `make png` / `make pdf`.

5. **Custom fonts.** Font files (.ttf/.otf/.woff) live in
   `resources/fonts/`.
   Activate one by adding to `layout.json`:
   `{"fonts": [{"file": "MyFont.ttf", "name": "MyFont"}]}` and referencing
   `{"font": "MyFont"}` on a text element. Offer the user available fonts
   whenever text styling comes up.

6. **Custom text elements.** Placeable via
   `{"type": "text", "text": "...", "x", "y", "font", "size", "color",
   "weight"}`. Confirm wording and placement with the user before rendering
   if the request is ambiguous.

7. **Geometric arrangement of text — DO NOT hand-place coordinates.**
   Hand-picked `x`/`y` values reliably overlap because rendered text
   height depends on wrapping and paragraph spacing that aren't visible
   in the JSON. Use the arranger instead:
   ```
   node scripts/layout.mjs check     # lint: reports OVERLAP / OVERFLOW (exit 2)
   node scripts/layout.mjs arrange   # re-stack all text: title + intro centered
                                     # on top, heading+body pairs flowed into
                                     # 3 balanced columns, canvas grown to fit
   ```
   - `arrange` measures REAL rendered boxes with headless chromium and
     re-stacks using measured heights, so its output doesn't collide.
     It is safe to run repeatedly (idempotent grouping).
   - Column grid and spacing are configurable via an optional
     `"arrange": {"margin", "gap", "columns": [{"x", "width"}...]}`
     block in `layout.json`.
   - Workflow for text-heavy layouts: write/edit text content in
     layout.json WITHOUT worrying about coordinates → run `arrange` →
     run `check` → render. Never nudge `y` values by hand to "fix" an
     overlap; re-run `arrange` instead (adjust `gap`/`columns` if the
     balance needs tuning).
   - If you must place a single element manually, verify with `check`
     before rendering.

8. **Live preview.** During interactive sessions you may run
   `node scripts/serve.mjs` (port 8899) so the user can watch the composed
   page live; layout/fragment/template changes trigger automatic reload.

## Generating NEW fragments — use the intrinsic machinery, never install

**HARD RULE: never install anything.** No `apt install`, no `npm install`,
no puppeteer, no chromium download. The container already ships headless
chromium (the compose pipeline drives it directly via CLI), ImageMagick
(`magick`), node, pandoc and opencode. "I need a browser to render this"
is always wrong here — the browser is already wired in.

New fragments are generated three intrinsic ways:

1. **GLSL shader → Frag Bench (live, user-in-the-loop).** Write a `.frag`
   file into `resources/shaders/` — it is picked up live by the Frag Bench
   tab (`localhost:8899/frag`), compiled in-browser into an `<img>` swatch.
   The user drags keepers straight into `resources/fragments/` as
   `fragment*.png` (native drag-out, or the per-swatch "→ fragments"
   button). Read `resources/shaders/SHADER-NOTES.md` FIRST — it documents
   the Y-axis flip gotcha, the available uniforms (`u_resolution`,
   `u_time`, `u_seed`) and the bitmap-text pattern (GLSL has no strings).
   Working examples: `example.frag`, `banner-title.frag`.

2. **GLSL shader → headless rasterization (agent-driven, no user needed).**
   Render any `.frag` to a transparent PNG without a browser session:
   ```
   scripts/frag-render.sh resources/shaders/foo.frag <width> <height> out.png [seed]
   ```
   (headless chromium + `scripts/frag-headless.html`; deterministic
   straight-alpha output). For text-bearing shaders, generate the GLSL
   from a TTF instead of hand-drawing glyphs:
   ```
   python3 scripts/gen-banner-frag.py <font.ttf> "text" out.frag <scale> <fill-rgb> <outline-rgb> [pointsize] [gap]
   ```
   (bitmap text, 1px outline, transparent bg — see the banner frags for
   output shape). Then `magick`-composite results, or move the PNG into
   `resources/fragments/fragment*.png` so it enters the normal layout flow.

3. **Monte-Carlo cloud fill (procedural texture backgrounds).**
   ```
   make cloud FILL_SRC=resources/<src>.png STEM=<stem> [COUNT=256] [CANVAS=3000] [BANNER_W=2560] [BANNER_H=1440]
   ```
   Stamps COUNT randomly-rotated instances onto black with per-step
   whole-canvas shear/rotate (progress logs to `project/output/cloud-progress.log`,
   live preview on `/cloud`), then center-crops to the banner size.
   `scripts/cloud-step.sh` holds the per-step logic — transparency is
   fuzz-blitted from black pixels only (never luminance-alpha: it dims
   the art), stamps carry soft silhouette shadows.

After generating: new files in `resources/fragments/` become lint subjects —
assign them placements in `layout.json` (see the responsibilities above).

## Session workflow

1. Scan fragments; run the lint comparison (disk vs layout.json).
2. Discuss orphan/unplaced fragments with the user; propose positions.
3. Edit `project/layout.json` (and the template if needed).
4. Rebuild both `png` and `pdf` outputs.
5. Show the user the rendered artifacts and iterate.

Do not delete or overwrite user fragments. Do not invent fragments that do
not exist on disk. Every change to the template must keep both png and pdf
targets rendering correctly — verify by rebuilding both.
