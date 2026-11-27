#!/usr/bin/env bash
# frag-render.sh — rasterize a .frag to a transparent PNG via headless chromium.
# Usage: scripts/frag-render.sh <shader.frag> <width> <height> <out.png> [seed]
#
# Container-native: node + chromium only (no python/imagemagick). The page
# renders the shader to an offscreen canvas and embeds the PNG as a dataURL;
# we extract it from chromium's DOM dump — no compositor/screenshot races.
set -euo pipefail

SHADER=$1; W=$2; H=$3; OUT=$4; SEED=${5:-}
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp --tmpdir="${TMPDIR:-/tmp/opencode}" frag-render-XXXXXX.html)
DOM=$(mktemp --tmpdir="${TMPDIR:-/tmp/opencode}" frag-dom-XXXXXX.html)

node -e '
  const fs = require("fs");
  const [template, out, shader, w, h, seed] = process.argv.slice(1);
  const src = fs.readFileSync(shader, "utf8");
  let html = fs.readFileSync(template, "utf8");
  const cfg = JSON.stringify({ w: +w, h: +h, seed: seed ? +seed : null });
  html = html.replace("//FRAG_SRC_PLACEHOLDER//", src).replace("//CFG_PLACEHOLDER//", cfg);
  fs.writeFileSync(out, html);
' "$HERE/frag-headless.html" "$TMP" "$SHADER" "$W" "$H" "$SEED"

CHROME=${CHROME_BIN:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}
[ -n "$CHROME" ] || { echo "no chromium found (set CHROME_BIN)" >&2; exit 1; }

"$CHROME" --headless --disable-gpu --no-sandbox \
  --virtual-time-budget=3000 \
  --dump-dom "file://$TMP" > "$DOM" 2>/dev/null || true

node -e '
  const fs = require("fs");
  const dom = fs.readFileSync(process.argv[1], "utf8");
  const m = dom.match(/DATAURL:data:image\/png;base64,([A-Za-z0-9+\/=]+)/);
  if (!m) {
    const err = dom.match(/RENDER_ERROR:([\s\S]*?)(<\/|$)/);
    console.error("render failed:\n" + (err ? err[1].trim() : "no dataURL in DOM dump (chromium crashed?)"));
    process.exit(1);
  }
  const png = Buffer.from(m[1], "base64");
  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") {
    console.error("render failed: output is not a valid PNG"); process.exit(1);
  }
  fs.writeFileSync(process.argv[2], png);
  console.log(`wrote ${process.argv[2]} (${png.readUInt32BE(16)}x${png.readUInt32BE(20)})`);
' "$DOM" "$OUT"

rm -f "$TMP" "$DOM"
