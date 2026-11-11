$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $repo 'Frontend'
$python = Join-Path $repo '.venv-gru\Scripts\python.exe'
$cloudflared = (Get-Command cloudflared.exe).Source
$node = (Get-Command node.exe).Source
$npm = (Get-Command npm.cmd).Source

if (!(Test-Path $python) -or !(Test-Path (Join-Path $frontend 'node_modules\vite\bin\vite.js'))) {
    throw 'Set up the .venv-gru backend and run npm ci in Frontend before starting a remote test.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 8000,4173 -ErrorAction SilentlyContinue) {
    throw 'Stop the existing FastAPI and Vite preview processes on ports 8000 and 4173 first.'
}

$logDir = Join-Path ([System.IO.Path]::GetTempPath()) "signsync-remote-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $logDir | Out-Null
$children = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()

function Start-LoggedProcess($name, $program, $arguments, $directory) {
    $process = Start-Process -FilePath $program -ArgumentList $arguments -WorkingDirectory $directory `
        -RedirectStandardOutput (Join-Path $logDir "$name.out.log") `
        -RedirectStandardError (Join-Path $logDir "$name.err.log") -WindowStyle Hidden -PassThru
    $children.Add($process)
    return $process
}

function Wait-ProcessLog($name, $process, $stream, $pattern) {
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline -and !$process.HasExited) {
        # Vite can colorize parts of the URL even when output goes to a file.
        $log = (Get-Content -Raw -LiteralPath (Join-Path $logDir "$name.$stream.log")) -replace "\x1b\[[0-9;]*m", ''
        if ($log -match $pattern) {
            return $Matches[0]
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Could not start $name. Check the logs in $logDir."
}

try {
    Write-Host 'Starting Cloudflare tunnels...'
    $backendTunnel = Start-LoggedProcess 'backend-tunnel' $cloudflared 'tunnel --url http://127.0.0.1:8000' $repo
    $frontendTunnel = Start-LoggedProcess 'frontend-tunnel' $cloudflared 'tunnel --url http://127.0.0.1:4173' $repo
    $tunnelPattern = 'https://[a-z0-9-]+\.trycloudflare\.com'
    $backendUrl = Wait-ProcessLog 'backend-tunnel' $backendTunnel 'err' $tunnelPattern
    $frontendUrl = Wait-ProcessLog 'frontend-tunnel' $frontendTunnel 'err' $tunnelPattern

    $env:SIGNSYNC_CORS_ORIGINS = ConvertTo-Json -InputObject @($frontendUrl) -Compress
    $backend = Start-LoggedProcess 'backend' $python '-m uvicorn app.main:app --app-dir Backend --host 127.0.0.1 --port 8000' $repo

    $env:VITE_API_BASE_URL = "$backendUrl/api"
    $env:VITE_WS_URL = ($backendUrl -replace '^https:', 'wss:') + '/ws/translate'
    $env:VITE_USE_MOCKS = 'false'
    $env:VITE_USE_MOCK_CAMERA = 'false'
    $env:VITE_USE_MOCK_SPEECH = 'false'
    $env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = ([uri]$frontendUrl).Host

    Push-Location $frontend
    try {
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'The frontend build failed.' }
    } finally {
        Pop-Location
    }

    $preview = Start-LoggedProcess 'preview' $node 'node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort' $frontend
    $null = Wait-ProcessLog 'backend' $backend 'err' 'Uvicorn running on http://127\.0\.0\.1:8000'
    $null = Wait-ProcessLog 'preview' $preview 'out' 'http://127\.0\.0\.1:4173/'
    $null = Wait-ProcessLog 'backend-tunnel' $backendTunnel 'err' 'Registered tunnel connection'
    $null = Wait-ProcessLog 'frontend-tunnel' $frontendTunnel 'err' 'Registered tunnel connection'
    Write-Host "`nShare this link: $frontendUrl"
    Write-Host "Keep this terminal open. Press Ctrl+C to stop the test. Logs: $logDir"
    while ($true) {
        foreach ($process in $children) {
            if ($process.HasExited) { throw "A remote test process stopped. Check the logs in $logDir." }
        }
        Start-Sleep -Seconds 1
    }
} finally {
    foreach ($process in $children) {
        if (!$process.HasExited) { & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null }
    }
}
