$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$source = Join-Path $workspace 'out\TravelAgent-win32-x64'
$destination = Join-Path $workspace 'out\make\TravelAgent-win32-x64-portable.zip'
if (-not (Test-Path -LiteralPath (Join-Path $source 'TravelAgent.exe'))) { throw 'Run pnpm package first.' }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($source, $destination, [System.IO.Compression.CompressionLevel]::Optimal, $true)
Write-Output $destination
