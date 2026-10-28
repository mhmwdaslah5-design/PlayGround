#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PROJECT_DIR="$(pwd -P)"
WEB_DIR="${OPENCODE_WEB_DIR:-/home/runner/work/_temp/omgithub-web}"
DIST_DIR="$PROJECT_DIR/dist"
PORT="${PORT:-3000}"
export PORT

echo "[start] project=$PROJECT_DIR"
echo "[start] port=$PORT"

START_MS=$(date +%s%3N)
mkdir -p "$WEB_DIR"
echo "[timing] ensure web metadata dir $(( $(date +%s%3N) - START_MS ))ms"

if [ -f package.json ]; then
  INSTALL_START=$(date +%s%3N)
  npm install --no-audit --no-fund
  echo "[timing] install dependencies $(( $(date +%s%3N) - INSTALL_START ))ms"
else
  echo "[timing] install dependencies 0ms (no package.json; zero runtime dependencies)"
fi

BUILD_START=$(date +%s%3N)
/usr/bin/time -p node build.mjs
echo "[timing] static build $(( $(date +%s%3N) - BUILD_START ))ms"

DEPLOY_START=$(date +%s%3N)
printf '{"project":"%s","directory":"%s"}\n' "$PROJECT_DIR" "$DIST_DIR" > "$WEB_DIR/deployment-output.json"
DEPLOY_MS=$(( $(date +%s%3N) - DEPLOY_START ))
printf '{"project":"%s","directory":"%s"}\n' "$PROJECT_DIR" "$DIST_DIR" > "$WEB_DIR/deployment-output.pretty.json"
echo "[timing] deployment-output $DEPLOY_MS""ms"
echo "[start] deployment directory $DIST_DIR"

echo "[start] serving in foreground on 0.0.0.0:$PORT"
/usr/bin/time -p node server.mjs
