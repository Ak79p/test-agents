#!/usr/bin/env bash
# Drops and re-seeds the SQLite database without the API running.
# (With the API running you can call POST http://127.0.0.1:8000/api/v1/dev/reset instead.)
set -euo pipefail
cd "$(dirname "$0")/../backend"
exec .venv/bin/python -m app.seed --reset
