#!/usr/bin/env bash
# progress.sh — record a build step for a project stem (the generic progress
# primitive: cloud fills emit one per stamped step; simple agent projects
# emit 0/1 on prompt submission and 1/1 when the output is ready).
#
# Usage: scripts/progress.sh <stem> <step> <total> [label]
# Writes output/<stem>.progress (overwrites — it's state, not history):
#   {"stem":"...","step":N,"total":T,"pct":P,"label":"..."}
set -euo pipefail

stem=${1:?stem}; step=${2:?step}; total=${3:?total}; label=${4:-}

dir="$(cd "$(dirname "$0")/.." && pwd)/project/output"
mkdir -p "$dir"
pct=$(( total > 0 ? step * 100 / total : 0 ))

# label may contain quotes/newlines — strip them for the one-line JSON
label=${label//\"/\'}
label=${label//$'\n'/ }

printf '{"stem":"%s","step":%d,"total":%d,"pct":%d,"label":"%s"}\n' \
    "$stem" "$step" "$total" "$pct" "$label" > "$dir/$stem.progress"
