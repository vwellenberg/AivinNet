#!/usr/bin/env bash
# Season rehearsal: one day of the year, played on the seeded demo instance with BOTH clocks
# moved there, the server's (faketime) and the browser's (Playwright). See README.md,
# "Season rehearsal".
#
#   scripts/demo/rehearsal.sh <name> "<YYYY-MM-DD HH:MM:SS>" [rehearsal.js flags ...]
#
# Needs: faketime (apt: faketime), Playwright, the seeded demo from steps 1-4 of README.md
# (config in $DEMO/config, built client in $DEMO/client). Every run starts from a fresh copy
# of that config, so the days do not leak into each other. Run it from the repository root.
set -euo pipefail

NAME=$1
WHEN=$2
shift 2

DEMO=${DEMO:-$HOME/aivinnet-demo}
PORT=${PORT:-19800}
OUT=${OUT:-$DEMO/rehearsal}
mkdir -p "$OUT"

if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
    echo "port $PORT is taken: stop the other server first (an old one would answer for this day)" >&2
    exit 1
fi

rm -rf "$DEMO/config-rehearsal"
cp -a "$DEMO/config" "$DEMO/config-rehearsal"

# uv runs BEFORE faketime, never under it: a uv that has to sync reaches PyPI, and with the
# clock in the future every TLS certificate reads as expired. Only the server gets the fake time.
uv sync --frozen --quiet
PYTHON=$(uv run --frozen python -c 'import sys; print(sys.executable)')

# Its own process group, so the stop below takes the server and anything it started: a server
# left running would quietly answer for the NEXT day.
setsid env AIVINNET_CONFIG_DIR="$DEMO/config-rehearsal" AIVINNET_ADMIN_PASSWORD=demo-pass-713 \
    faketime "$WHEN" "$PYTHON" run.py --port "$PORT" --client "$DEMO/client" \
    > "$OUT/$NAME-server.log" 2>&1 &
GROUP=$!
trap 'kill -INT -- -$GROUP 2>/dev/null || true; sleep 4; kill -9 -- -$GROUP 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 1; done
sleep 6 # the start-up jobs (Home rows, stations, Advent) run in the background

# The browser's clock: the same moment, in the ISO form Date() reads as UTC.
node scripts/demo/rehearsal.js "$OUT" "$NAME" "${WHEN/ /T}Z" --url "http://127.0.0.1:$PORT" "$@"

if grep -qiE "traceback" "$OUT/$NAME-server.log"; then
    echo "server log of $NAME has a traceback: $OUT/$NAME-server.log" >&2
fi
