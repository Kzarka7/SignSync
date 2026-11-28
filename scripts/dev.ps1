# Starts the FastAPI backend and the Vite frontend with one command.
# Usage (from the SignSync folder):  npm run dev     or     .\scripts\dev.ps1
# Press Ctrl+C to stop both.
param(
  [int]$BackendPort = 8000,
  [switch]$NoReload
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root 'Backend'
$frontendDir = Join-Path $root 'Frontend'

# Prefer the GRU environment (matches the README), fall back to the Backend venv.
$python = @(
  (Join-Path $root '.venv-gru\Scripts\python.exe'),
  (Join-Path $backendDir '.venv\Scripts\python.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $python) { throw 'No Python environment found (.venv-gru or Backend\.venv).' }

if (-not (Test-Path (Join-Path $frontendDir 'node_modules'))) {
  Write-Host 'Installing frontend dependencies...' -ForegroundColor Yellow
  Push-Location $frontendDir; npm install; Pop-Location
}

# Free the backend port if a previous run left something behind.
$busy = Get-NetTCPConnection -LocalPort $BackendPort -State Listen -ErrorAction SilentlyContinue
if ($busy) { throw "Port $BackendPort is already in use (PID $($busy[0].OwningProcess)). Stop it and try again." }

$uvicornArgs = @('-m', 'uvicorn', 'app.main:app', '--app-dir', $backendDir,
  '--host', '127.0.0.1', '--port', $BackendPort)
if (-not $NoReload) { $uvicornArgs += @('--reload', '--reload-dir', $backendDir) }

Write-Host "Backend  -> http://127.0.0.1:$BackendPort  (docs: /docs)" -ForegroundColor Cyan
Write-Host 'Frontend -> http://localhost:5173' -ForegroundColor Cyan

$backend = Start-Process -FilePath $python -ArgumentList $uvicornArgs `
  -WorkingDirectory $root -NoNewWindow -PassThru
try {
  Push-Location $frontendDir
  npm run dev
} finally {
  Pop-Location
  if ($backend -and -not $backend.HasExited) {
    taskkill /PID $backend.Id /T /F | Out-Null
  }
  Write-Host 'Stopped backend and frontend.' -ForegroundColor Yellow
}
