#!/usr/bin/env bash
# repl-session.sh — inside the container: rebuild the latest artifact, start
# the livereload server, run opencode, tear down.
#
# The config (/root/.config/opencode) and state (/root/.local/share/opencode)
# are mounted from the repo's .opencode/cache/ — they persist between runs
# and are maintained inside the container.
#
# Runs as the container's main process (spawned by `make repl`). opencode's
# own exit handling can take down its process group, so it is launched under
# setsid (its own session) — the shell below survives to report rc and kill
# the server. No `&&` chains across backgrounding: every step is sequential
# and explicit.
set -u

stem="$(cat project/output/.last-stem 2>/dev/null || true)"
stem="${stem:-output}"
echo "rebuilding latest artifact: $stem"
mkdir -p logs
CINNAMON_REBUILD=1 node scripts/compose.mjs png "$stem" >>logs/serve.log 2>&1 || true

node scripts/serve.mjs >>logs/serve.log 2>&1 &
server=$!

setsid opencode
rc=$?

echo "session ended (rc=$rc)"
kill "$server" 2>/dev/null || true
if [ "$rc" != 0 ]; then
    tail -n 20 logs/serve.log
fi
exit "$rc"
