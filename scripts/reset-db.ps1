# Drops and re-seeds the SQLite database without the API running.
# (With the API running you can call POST http://127.0.0.1:8000/api/v1/dev/reset instead.)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'backend')
& .\.venv\Scripts\python.exe -m app.seed --reset
