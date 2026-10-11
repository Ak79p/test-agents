# Starts the Vite dev server (http://localhost:5173).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend')
npm run dev
