param([int]$Port = 8977, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$serverFile = Join-Path $studioRoot 'server.mjs'
$dataFolder = Join-Path $studioRoot 'data'
$url = "http://127.0.0.1:$Port"
$state = $null
try { $state = Invoke-RestMethod "$url/api/state" -TimeoutSec 2 } catch { }
if ($state) {
  if ($state.application -ne 'game-builder') { throw "Port $Port belongs to another app." }
  if (-not $NoBrowser) { Start-Process $url }
  Write-Host "Game Builder is already running at $url"
  exit 0
}
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath -and (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe')) { $nodePath = 'C:\Program Files\nodejs\node.exe' }
if (-not $nodePath) { throw 'Install Node.js 22 or newer, then run this launcher again.' }
New-Item -ItemType Directory -Path $dataFolder -Force | Out-Null
$previousPort = $env:PORT
$previousData = $env:ASSET_STUDIO_DATA
try {
  $env:PORT = [string]$Port
  $env:ASSET_STUDIO_DATA = $dataFolder
  $studioProcess = Start-Process -FilePath $nodePath -ArgumentList @(('"' + $serverFile + '"')) -WorkingDirectory $studioRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $dataFolder 'studio.log') -RedirectStandardError (Join-Path $dataFolder 'studio-errors.log') -PassThru
} finally {
  $env:PORT = $previousPort
  $env:ASSET_STUDIO_DATA = $previousData
}
@{ processId = $studioProcess.Id; server = $serverFile; port = $Port } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $dataFolder 'studio-process.json') -Encoding UTF8
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $state = Invoke-RestMethod "$url/api/state" -TimeoutSec 1
    if ($state.application -eq 'game-builder') { break }
  } catch { }
  Start-Sleep -Milliseconds 500
}
if ($state.application -ne 'game-builder') { throw 'Game Builder did not start. Read data\studio-errors.log.' }
if (-not $NoBrowser) { Start-Process $url }
Write-Host "Game Builder ready at $url. Run Stop-Game-Builder.cmd when finished."
