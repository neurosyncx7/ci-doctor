$ErrorActionPreference = 'Stop'

$docker = if ($env:DOCKER_BIN) { $env:DOCKER_BIN } else { 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' }
if (-not (Test-Path $docker)) { throw 'Docker CLI is not installed.' }
& $docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }

$api = Invoke-RestMethod 'http://127.0.0.1:4300/readyz'
if ($api.status -ne 'ready') { throw 'API is not ready' }
$dashboard = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:4311'
if ($dashboard.StatusCode -ne 200) { throw 'Dashboard is not serving' }
Write-Host 'CI Doctor live-demo prerequisites are ready.' -ForegroundColor Green
Write-Host 'Next: trigger a real failing workflow in the installed fixture repository. The dashboard will refresh its append-only event ledger every 2.5 seconds.' -ForegroundColor Cyan
