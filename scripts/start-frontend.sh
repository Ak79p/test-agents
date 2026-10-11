#!/usr/bin/env bash
# Starts the Vite dev server (http://localhost:5173).
set -euo pipefail
cd "$(dirname "$0")/../frontend"
exec npm run dev
