#!/usr/bin/env bash
# imagework helper for non-unix users. Usage:
#   ./run.sh build   # build the container (first time)
#   ./run.sh repl    # interactive agent session
#   ./run.sh serve   # livereload preview
#   ./run.sh png|pdf [FILE]
set -euo pipefail
cd "$(dirname "$0")"
IMAGE=imagework
VOL="-v $(pwd):/work -w /work"
PORT_FWD="-p 8899:8899"

ensure_image() { docker image inspect "$IMAGE" >/dev/null 2>&1 || docker build -t "$IMAGE" .; }

run() { ensure_image; docker run --rm -it $VOL "$IMAGE" bash -c "$1"; }

case "${1:-help}" in
  build) ensure_image ;;
  repl)  run "opencode" ;;
  serve) ensure_image; docker run --rm -it $VOL $PORT_FWD "$IMAGE" bash -c "node ./scripts/serve.mjs" ;;
  png)   run "./scripts/compose.mjs png ${2:-output}" ;;
  pdf)   run "./scripts/compose.mjs pdf ${2:-output}" ;;
  *) echo "usage: ./run.sh build|repl|serve|png|pdf [FILE]" ;;
esac
