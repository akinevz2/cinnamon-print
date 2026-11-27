#!/usr/bin/env bash
# frag-render.sh — rasterize a .frag to a transparent PNG via headless Chrome.
# Usage: scripts/frag-render.sh <shader.frag> <width> <height> <out.png> [seed]
#
# Deterministic: the page renders the shader to an offscreen canvas and
# embeds the PNG as a dataURL; we extract it from chrome's DOM dump —
# no compositor/screenshot races.
set -euo pipefail

SHADER=$1; W=$2; H=$3; OUT=$4; SEED=${5:-}
HERE=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp --tmpdir="${TMPDIR:-/tmp/opencode}" frag-render-XXXXXX.html)
DOM=$(mktemp --tmpdir="${TMPDIR:-/tmp/opencode}" frag-dom-XXXXXX.html)

python3 - "$SHADER" "$HERE/frag-headless.html" "$TMP" "$W" "$H" "$SEED" <<'PY'
import json, sys, pathlib
shader, template, out, w, h, seed = sys.argv[1:7]
src = pathlib.Path(shader).read_text()
html = pathlib.Path(template).read_text()
cfg = json.dumps({"w": int(w), "h": int(h), "seed": float(seed) if seed else None})
html = html.replace("//FRAG_SRC_PLACEHOLDER//", src).replace("//CFG_PLACEHOLDER//", cfg)
pathlib.Path(out).write_text(html)
PY

google-chrome --headless --disable-gpu --no-sandbox \
  --virtual-time-budget=3000 \
  --dump-dom "file://$TMP" > "$DOM" 2>/dev/null || true

python3 - "$DOM" "$OUT" <<'PY'
import base64, re, sys
dom, out = sys.argv[1:3]
html = open(dom).read()
m = re.search(r'DATAURL:data:image/png;base64,([A-Za-z0-9+/=]+)', html)
if not m:
    err = re.search(r'RENDER_ERROR:(.*?)</', html, re.S)
    sys.exit("render failed:\n" + (err.group(1).strip() if err else "no dataURL in DOM dump"))
open(out, "wb").write(base64.b64decode(m.group(1)))
PY

rm -f "$TMP" "$DOM"
identify -format "wrote $OUT (%wx%h)\n" "$OUT"
