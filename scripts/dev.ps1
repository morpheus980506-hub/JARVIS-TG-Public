$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendPython = Join-Path $projectRoot 'backend\.venv\Scripts\python.exe'
$logDirectory = Join-Path $projectRoot 'backend\logs'

if (-not (Test-Path -LiteralPath $backendPython)) {
    throw 'Backend virtual environment is missing. Follow README setup first.'
}

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

$backendRunning = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if (-not $backendRunning) {
    Start-Process `
        -FilePath $backendPython `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory (Join-Path $projectRoot 'backend') `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDirectory 'backend.stdout.log') `
        -RedirectStandardError (Join-Path $logDirectory 'backend.stderr.log')
}

$frontendRunning = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
if (-not $frontendRunning) {
    $pnpm = (Get-Command 'pnpm.cmd' -ErrorAction Stop).Source
    Start-Process `
        -FilePath $pnpm `
        -ArgumentList @('dev', '--host', '127.0.0.1') `
        -WorkingDirectory (Join-Path $projectRoot 'frontend') `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDirectory 'frontend.stdout.log') `
        -RedirectStandardError (Join-Path $logDirectory 'frontend.stderr.log')
}

Write-Host 'JARVIS-TG startup requested.'
Write-Host 'Frontend: http://127.0.0.1:5173'
Write-Host 'API docs: http://127.0.0.1:8000/docs'
Write-Host "Logs: $logDirectory"

foreach ($attempt in 1..20) {
    $frontendReady = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if ($frontendReady) {
        break
    }
    Start-Sleep -Milliseconds 500
}

if ($frontendReady) {
    Start-Process 'http://127.0.0.1:5173'
} else {
    Write-Warning 'Frontend did not become ready. Check the log files shown above.'
}

