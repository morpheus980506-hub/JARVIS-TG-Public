$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $projectRoot 'UI\travelagent'
$backend = Join-Path $projectRoot 'backend'
$python = Join-Path $backend '.venv\Scripts\python.exe'
$toolchain = Join-Path $desktop '.local\toolchain'
$localNode = Join-Path $toolchain 'node\package\bin\node.exe'
$localPnpm = Join-Path $toolchain 'pnpm\package\bin\pnpm.mjs'
$servicesUrl = 'http://127.0.0.1:8000/api/v1/travel/services'

if (-not (Test-Path -LiteralPath $python)) {
    throw 'Set up the JARVIS-TG backend virtual environment first. See README.md.'
}
if (-not (Test-Path -LiteralPath (Join-Path $desktop 'node_modules\electron\package.json'))) {
    throw 'Install the desktop dependencies first. See UI\travelagent\README.md.'
}

function Get-JarvisHealth {
    try {
        $services = Invoke-RestMethod -Uri $servicesUrl -TimeoutSec 3
        return ('fliggy' -in $services.id -and 'meituan' -in $services.id)
    } catch { return $false }
}

if (-not (Get-JarvisHealth)) {
    if (Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 8000 is already in use and the JARVIS-TG health check failed.'
    }
    $logs = Join-Path $backend 'logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $service = Start-Process -FilePath $python `
        -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') `
        -WorkingDirectory $backend -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $logs 'desktop.stdout.log') `
        -RedirectStandardError (Join-Path $logs 'desktop.stderr.log')
    for ($attempt = 0; $attempt -lt 20 -and -not $service.HasExited; $attempt++) {
        if (Get-JarvisHealth) { break }
        Start-Sleep -Milliseconds 250
    }
    if (-not (Get-JarvisHealth)) {
        throw "JARVIS-TG startup failed. See $(Join-Path $logs 'desktop.stderr.log')."
    }
}

Push-Location $desktop
try {
    if ((Test-Path -LiteralPath $localNode) -and (Test-Path -LiteralPath $localPnpm)) {
        $previousPath = $env:Path
        try {
            $env:Path = "$(Join-Path $toolchain 'bin');$(Split-Path -Parent $localNode);$previousPath"
            & $localNode $localPnpm start @args
        } finally {
            $env:Path = $previousPath
        }
    } else {
        & pnpm start @args
    }
    if ($LASTEXITCODE -ne 0) { throw "TravelAgent exited with code $LASTEXITCODE." }
} finally {
    Pop-Location
}
