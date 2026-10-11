#!/usr/bin/env bash
# One-time setup on macOS/Linux: backend virtualenv + dependencies, frontend npm packages, .env files.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Backend"
cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
[ -f .env ] || cp .env.example .env

echo "==> Frontend"
cd "$ROOT/frontend"
npm install
[ -f .env ] || cp .env.example .env

echo "Setup complete. Start with scripts/start-backend.sh and scripts/start-frontend.sh"
