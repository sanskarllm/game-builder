param([string]$Distribution = 'PCMClawUbuntu', [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$scriptText = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'prepare-local.py') -Raw
if ($CheckOnly) {
  $scriptText | wsl.exe --distribution $Distribution --exec python3 -
} else {
  $scriptText | wsl.exe --distribution $Distribution --exec python3 - --fetch-sources
}
if ($LASTEXITCODE -ne 0) { throw 'Local preparation failed. Read the error above; no model inference was run.' }
