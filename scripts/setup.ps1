# One-time setup on Windows: backend virtualenv + dependencies, frontend npm packages, .env files.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Write-Host '==> Backend' -ForegroundColor Cyan
Set-Location "$root\backend"
if (-not (Test-Path '.venv')) {
    if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv .venv } else { python -m venv .venv }
}
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path '.env')) { Copy-Item .env.example .env }

Write-Host '==> Frontend' -ForegroundColor Cyan
Set-Location "$root\frontend"
npm install
if (-not (Test-Path '.env')) { Copy-Item .env.example .env }

Set-Location $root
Write-Host 'Setup complete. Start with scripts\start-backend.ps1 and scripts\start-frontend.ps1' -ForegroundColor Green
