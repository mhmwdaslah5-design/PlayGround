#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"

START_MS=$(date +%s%3N)
: "${CAPTURE_URL:?Set CAPTURE_URL to the preview URL.}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to an output directory outside the source.}"
export CAPTURE_URL CAPTURE_DIR
export CAPTURE_READY_SELECTOR="${CAPTURE_READY_SELECTOR:-#game}"
export CAPTURE_START_SELECTOR="${CAPTURE_START_SELECTOR:-#start-btn}"

echo "[capture] url=$CAPTURE_URL"
echo "[capture] output=$CAPTURE_DIR"

MKDIR_START=$(date +%s%3N)
mkdir -p "$CAPTURE_DIR"
echo "[timing] ensure capture directory $(( $(date +%s%3N) - MKDIR_START ))ms"

NODE_START=$(date +%s%3N)
node capture.mjs
RC=$?
echo "[timing] playwright capture $(( $(date +%s%3N) - NODE_START ))ms (exit $RC)"

if [ "$RC" -eq 0 ]; then
  VERIFY_START=$(date +%s%3N)
  for name in desktop mobile; do
    file="$CAPTURE_DIR/final-$name.png"
    if [ ! -s "$file" ]; then
      echo "[capture] missing or empty screenshot: $file" >&2
      RC=1
      break
    fi
    size=$(wc -c < "$file")
    if [ "$size" -lt 5000 ]; then
      echo "[capture] screenshot looks empty: $file ($size bytes)" >&2
      RC=1
      break
    fi
    echo "[capture] verified $file ($size bytes)"
  done
  echo "[timing] verify screenshots $(( $(date +%s%3N) - VERIFY_START ))ms"
fi

echo "[timing] capture.sh total $(( $(date +%s%3N) - START_MS ))ms"
exit "$RC"
