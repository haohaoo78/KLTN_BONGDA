$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $root
try {
  $compose = @("--profile", "apps")
  $env:TEST_SEED_VARIANT = "review-1"
  $env:DEMO_TEAM_COUNT = "12"
  $env:DEMO_PLAYERS_PER_TEAM = "20"
  $env:DEMO_INTER_SCHOOL = "false"
  $env:DEMO_ACCOUNT_PASSWORD = if ($env:SEED_TEST_PASSWORD) { $env:SEED_TEST_PASSWORD } else { "Demo@123456" }
  $captainEmails = 1..12 | ForEach-Object { "dataset.captain{0:D2}@football.local" -f $_ }
  $env:DEMO_RESET_ACCOUNT_EMAILS = (@("dataset.btc01@football.local") + $captainEmails) -join ","

  Write-Host "Building only the affected application services; no database or volume reset will run."
  & docker compose @compose build web-client auth-service organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Could not build affected services" }
  & docker compose @compose up -d --no-deps web-client auth-service organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Could not update affected services" }

  $steps = @(
    @{ Profile = "demo-dataset"; Service = "tournament-demo-account-seed"; Args = @("-e", "DEMO_TEAM_COUNT=12", "-e", "DEMO_ACCOUNT_PASSWORD=$env:DEMO_ACCOUNT_PASSWORD", "-e", "DEMO_RESET_ACCOUNT_EMAILS=$env:DEMO_RESET_ACCOUNT_EMAILS") },
    @{ Profile = "demo-dataset"; Service = "tournament-demo-club-seed"; Args = @("-e", "DEMO_TEAM_COUNT=12", "-e", "DEMO_PLAYERS_PER_TEAM=20", "-e", "DEMO_INTER_SCHOOL=false") },
    @{ Profile = "approval-demo"; Service = "approval-workflow-demo-tournament-seed"; Args = @("-e", "TEST_SEED_VARIANT=review-1") },
    @{ Profile = "approval-demo"; Service = "approval-workflow-demo-registration-seed"; Args = @("-e", "TEST_SEED_VARIANT=review-1") }
  )
  foreach ($step in $steps) {
    Write-Host "Preparing isolated review fixture stage: $($step.Service)"
    $runArgs = @($compose) + @("--profile", $step.Profile, "run", "--rm", "--build", "--no-deps") + @($step.Args) + @($step.Service)
    & docker compose @runArgs
    if ($LASTEXITCODE -ne 0) { throw "Fixture stage failed: $($step.Service)" }
  }
  Write-Host "Seed 1 review fixture is ready at http://localhost:5173. BTC: dataset.btc01@football.local / $env:DEMO_ACCOUNT_PASSWORD. Captains: dataset.captain01@football.local through dataset.captain12@football.local / same password."
} finally { Pop-Location }
