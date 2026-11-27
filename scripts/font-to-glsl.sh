#!/usr/bin/env bash
# font-to-glsl.sh — TTF → GLSL bitmap rows via headless chromium.
# Container-native replacement for font-to-glsl.py (which needs magick+python,
# host-only). Output format matches: per-char top-down rows, leftmost pixel =
# most significant bit; cells bottom-padded to the tallest glyph.
#
# Usage: scripts/font-to-glsl.sh <font.ttf> <text> [pointsize] [threshold]
set -euo pipefail

FONT=$1; TEXT=$2; POINTSIZE=${3:-10}; THRESHOLD=${4:-0.5}
HERE=$(cd "$(dirname "$0")" && pwd)
FONT_URL="file://$(realpath "$FONT")"
TMP=$(mktemp --tmpdir="${TMPDIR:-/tmp/opencode}" fontbits-XXXXXX.html)
DOM=$(mktemp --tmpdir="${TMPDIR:-/tmp/opencode}" fontbits-dom-XXXXXX.html)

node -e '
    const fs = require("fs");
    const [, template, out, fontUrl, text, pointsize, threshold] = process.argv;
    const html = fs.readFileSync(template, "utf8");
    const cfg = JSON.stringify({ font: fontUrl, text, pointsize: +pointsize, threshold: +threshold });
    fs.writeFileSync(out, html.replace("//CFG_PLACEHOLDER//", cfg));
  ' "$HERE/font-bits.html" "$TMP" "$FONT_URL" "$TEXT" "$POINTSIZE" "$THRESHOLD"

CHROME=${CHROME_BIN:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}
[ -n "$CHROME" ] || { echo "no chromium found (set CHROME_BIN)" >&2; exit 1; }

"$CHROME" --headless=new --no-sandbox --disable-gpu \
  --allow-file-access-from-files --virtual-time-budget=5000 \
  --dump-dom "file://$TMP" > "$DOM" 2>/dev/null || true

node -e '
  const fs = require("fs");
  const dom = fs.readFileSync(process.argv[1], "utf8");
  const m = dom.match(/<pre id="out"[^>]*>([\s\S]*?)<\/pre>/);
  const text = m ? m[1] : "";
  const err = text.match(/FONTBITS_ERROR:([\s\S]*?)(<\/|$)/);
  if (err) { console.error("font-to-glsl failed:\n" + err[1]); process.exit(1); }
  if (!text.trim()) { console.error("font-to-glsl failed: empty DOM dump (chromium crashed? rerun with CHROME_BIN set and without --headless to inspect)"); process.exit(1); }
  const bits = text.match(/FONTBITS:([\s\S]*)/);
  if (!bits) { console.error("font-to-glsl failed: no FONTBITS payload in DOM dump"); process.exit(1); }
  process.stdout.write(bits[1].replace(/&quot;/g, "\"").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&"));
' "$DOM"

rm -f "$TMP" "$DOM"
