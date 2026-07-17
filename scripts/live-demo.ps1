param(
  [string]$PublicWebhookUrl = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# Support either the direct OpenAI API or the locally authenticated Codex CLI provider.
& node.exe --env-file=.env -e "const p=process.env.CI_DOCTOR_MODEL_PROVIDER || 'openai'; process.exit(p === 'codex_cli' || (p === 'openai' && Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length >= 20)) ? 0 : 1)" 2>$null
if ($LASTEXITCODE -ne 0) {
  throw "Set CI_DOCTOR_MODEL_PROVIDER=codex_cli, or supply OPENAI_API_KEY when using the direct OpenAI provider. Never commit .env."
}

$docker = if ($env:DOCKER_BIN) { $env:DOCKER_BIN } else { 'C:\Program Files\Docker\Docker\resources\bin\docker.exe' }
if (-not (Test-Path $docker)) { throw "Docker CLI was not found. Start Docker Desktop, then rerun this script." }
& $docker version --format '{{.Server.Version}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Desktop is not ready. Open Docker Desktop and wait until its engine is running, then rerun this script." }

function Start-DemoProcess([string]$Name, [string]$NpmScript) {
  $process = Start-Process -FilePath 'npm.cmd' -WorkingDirectory $root -ArgumentList @('run', $NpmScript) -PassThru
  Write-Host "Started $Name (PID $($process.Id))" -ForegroundColor Green
}

function Wait-ForHttp([string]$Name, [string]$Url) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $exitCode = 1
    try {
      & curl.exe --silent --show-error --fail --max-time 2 $Url 2>$null | Out-Null
      $exitCode = $LASTEXITCODE
    } catch {
      $exitCode = $LASTEXITCODE
    }
    if ($exitCode -eq 0) {
      Write-Host "$Name is ready" -ForegroundColor Green
      return
    }
    Start-Sleep -Milliseconds 750
  } while ((Get-Date) -lt $deadline)

  throw "$Name did not become ready at $Url. Inspect the process with the printed PID."
}

Write-Host "CI Doctor - real live demo launcher" -ForegroundColor Cyan
Write-Host "This launches real services. It does not fabricate incidents, diagnoses, patches, or PRs." -ForegroundColor Yellow

npm.cmd run db:up
npm.cmd run db:migrate

$null = Start-DemoProcess 'API' 'dev:api'
Wait-ForHttp 'API' 'http://127.0.0.1:4300/readyz'
$null = Start-DemoProcess 'ingestion worker' 'worker:ingest'
$null = Start-DemoProcess 'diagnosis worker' 'worker:diagnose'
$null = Start-DemoProcess 'repair worker' 'worker:repair'
$null = Start-DemoProcess 'operator console' 'dev:dashboard'
Wait-ForHttp 'Dashboard' 'http://127.0.0.1:4311/'

Write-Host "`nOpen the dashboard: http://127.0.0.1:4311" -ForegroundColor Cyan
Write-Host "Wait for the API to report ready before triggering GitHub CI." -ForegroundColor Cyan

if ($PublicWebhookUrl) {
  $normalized = $PublicWebhookUrl.TrimEnd('/')
  Write-Host "`nConfigure your GitHub App webhook URL as:" -ForegroundColor Yellow
  Write-Host "$normalized/webhooks/github" -ForegroundColor White
  Write-Host "Subscribe to workflow_run events and keep the existing webhook secret." -ForegroundColor Yellow
} else {
  Write-Host "`nGitHub cannot reach localhost. Start an HTTPS tunnel first, for example:" -ForegroundColor Yellow
  Write-Host "cloudflared tunnel --url http://127.0.0.1:4300" -ForegroundColor White
  Write-Host "Then rerun this script with -PublicWebhookUrl https://your-tunnel.example" -ForegroundColor Yellow
}

Write-Host "`nTo create a real demo incident: open ci-doctor-fixtures in GitHub and rerun its failing workflow, or push a commit that causes a test to fail." -ForegroundColor Yellow
Write-Host "A harmless random file will not create an incident because CI Doctor only acts on real failed CI." -ForegroundColor Yellow
