#!/usr/bin/env bash
set -e
echo "============================================================"
echo "  AetherClaw (灵爪) - Starting Autonomous Agent Console (Linux)..."
echo "============================================================"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js (>= 18) is not installed. Install it from https://nodejs.org or your package manager." >&2
  exit 1
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/src/index.js" --open
