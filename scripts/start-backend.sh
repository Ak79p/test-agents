#!/usr/bin/env bash
# Starts the FastAPI backend (http://127.0.0.1:8000, Swagger at /docs).
set -euo pipefail
cd "$(dirname "$0")/../backend"
exec .venv/bin/python run.py
