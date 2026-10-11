# Starts the FastAPI backend (http://127.0.0.1:8000, Swagger at /docs).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'backend')
& .\.venv\Scripts\python.exe run.py
