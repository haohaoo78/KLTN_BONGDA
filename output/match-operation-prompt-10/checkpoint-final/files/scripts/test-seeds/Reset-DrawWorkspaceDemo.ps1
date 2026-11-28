$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$dockerCandidates = @(
  (Get-Command docker -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue),
  (Join-Path $env:LOCALAPPDATA "Programs/DockerDesktop/resources/bin/docker.exe"),
  (Join-Path $env:ProgramFiles "Docker/Docker/resources/bin/docker.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
if (-not $dockerCandidates) { throw "Docker CLI was not found. Start Docker Desktop and verify its CLI installation." }
$docker = $dockerCandidates[0]

function Invoke-Compose([string[]]$Arguments) {
  & $docker compose @Arguments
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed with exit code $LASTEXITCODE" }
}

Push-Location $repoRoot
try {
  Invoke-Compose @("--profile", "apps", "up", "--build", "-d")
  Invoke-Compose @("--profile", "apps", "--profile", "demo-dataset", "--profile", "approval-demo", "run", "--build", "--rm", "-e", "TEST_SEED_VARIANT=draw-demo-reset", "approval-workflow-demo-tournament-seed")
  Invoke-Compose @("--profile", "apps", "--profile", "demo-dataset", "--profile", "approval-demo", "run", "--build", "--rm", "-e", "DEMO_TEAM_COUNT=32", "-e", "DRAW_WORKSPACE_DEMO=true", "-e", "DEMO_ACCOUNT_PASSWORD", "tournament-demo-account-seed")
  Invoke-Compose @("--profile", "apps", "--profile", "demo-dataset", "--profile", "approval-demo", "run", "--build", "--rm", "-e", "DEMO_TEAM_COUNT=32", "-e", "DRAW_WORKSPACE_DEMO=true", "tournament-demo-club-seed")
  Invoke-Compose @("--profile", "apps", "--profile", "demo-dataset", "--profile", "approval-demo", "run", "--build", "--rm", "-e", "TEST_SEED_VARIANT=draw-demo-reset", "approval-workflow-demo-registration-seed")
} finally { Pop-Location }
