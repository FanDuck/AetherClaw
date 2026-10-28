#!/usr/bin/env bash
set -e
echo "============================================================"
echo "🦅 Starting AetherClaw (灵爪) Autonomous Agent Console (Linux)..."
echo "============================================================"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$DIR/src/index.js" --open
