$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path -Parent $PSScriptRoot
$recordFile = Join-Path $studioRoot 'data\studio-process.json'
if (-not (Test-Path -LiteralPath $recordFile)) { Write-Host 'No launcher-owned studio process recorded.'; exit 0 }
$record = Get-Content -LiteralPath $recordFile -Raw | ConvertFrom-Json
$expectedServer = Join-Path $studioRoot 'server.mjs'
if ($record.server -ne $expectedServer) { throw 'The saved process belongs to another studio folder.' }
$ownedProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$record.processId)"
if ($ownedProcess) {
  if ($ownedProcess.Name -ne 'node.exe' -or -not $ownedProcess.CommandLine.Contains($expectedServer)) { throw 'Process identity changed. Refusing to stop an unrelated app.' }
  Stop-Process -Id ([int]$record.processId)
}
Remove-Item -LiteralPath $recordFile
Write-Host 'Studio stopped. Saved projects and completed images remain in data.'
