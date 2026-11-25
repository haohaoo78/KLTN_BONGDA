$ErrorActionPreference = "Stop"
$project = "sftms-test-seed-1"
$env:TEST_CONTAINER_PREFIX = $project
$compose = @("-p", $project, "-f", "docker-compose.yml", "-f", "docker-compose.test-seed.yml")
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $root
try {
  $env:NODE_ENV = "test"
  $env:EMAIL_VERIFICATION_REQUIRED = "false"
  $env:MAIL_DELIVERY_MODE = "disabled"
  $env:DEMO_ACCOUNT_PASSWORD = if ($env:SEED_TEST_PASSWORD) { $env:SEED_TEST_PASSWORD } else { "SflTest@2026!" }
  $env:ENABLE_MANUAL_REGISTRATION_CONTROL = "true"
  $env:TEST_SEED_VARIANT = "expanded-1"
  $env:DEMO_TEAM_COUNT = "12"
  $env:DEMO_PLAYERS_PER_TEAM = "20"
  $env:DEMO_INTER_SCHOOL = "false"

  & docker compose @compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Compose test configuration is invalid" }
  $running = @(& docker compose @compose --profile apps ps --status running --services)
  if ($LASTEXITCODE -ne 0 -or "postgres" -notin $running -or "tournament-service" -notin $running -or "api-gateway" -notin $running) {
    throw "Seed 1 test services are not running. Start the isolated project first; this script never resets its volumes."
  }

  Write-Host "Rebuilding web-client and the two services that own cross-tournament registration; retaining existing Seed 1 data."
  & docker compose @compose --profile apps build web-client organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Could not build web-client, organization-service and tournament-service" }
  foreach ($migration in @("organization-migrate", "tournament-migrate")) {
    & docker compose @compose run --rm --no-deps $migration
    if ($LASTEXITCODE -ne 0) { throw "Could not apply migration through $migration" }
  }
  & docker compose @compose --profile apps up -d --no-deps web-client organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Could not restart rebuilt services" }

  $steps = @(
    @{ Profile = "demo-dataset"; Service = "tournament-demo-account-seed" },
    @{ Profile = "demo-dataset"; Service = "tournament-demo-club-seed" },
    @{ Profile = "approval-demo"; Service = "approval-workflow-demo-tournament-seed" },
    @{ Profile = "approval-demo"; Service = "approval-workflow-demo-registration-seed" }
  )
  foreach ($step in $steps) {
    Write-Host "Adding expanded fixture with $($step.Service)"
    & docker compose @compose --profile apps --profile $step.Profile run --rm --build --no-deps $step.Service
    if ($LASTEXITCODE -ne 0) { throw "Seed stage failed: $($step.Service)" }
  }

  $tournamentId = (& docker compose @compose exec -T tournament-service node -e "const crypto=require('crypto');const b=crypto.createHash('sha256').update('sftms-demo-dataset-v1:sftms-test-seed-1-expanded-2026').digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');console.log([h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'))" | Select-Object -Last 1).Trim()
  if (-not $tournamentId) { throw "Could not resolve expanded Seed 1 tournament ID" }

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $loginBody = @{ email = "dataset.btc01@football.local"; password = $env:DEMO_ACCOUNT_PASSWORD } | ConvertTo-Json
  $null = Invoke-RestMethod -Method Post -Uri "http://localhost:18080/api/auth/login" -ContentType "application/json" -Body $loginBody -WebSession $session -TimeoutSec 20
  $pending = Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$tournamentId/registrations?status=PENDING" -WebSession $session -TimeoutSec 20
  if (@($pending.registrations).Count -ne 12) { throw "Expanded Seed 1 should show 12 pending applications; found $(@($pending.registrations).Count)" }
  $overlapTournamentId = (& docker compose @compose exec -T tournament-service node -e "const crypto=require('crypto');const b=crypto.createHash('sha256').update('sftms-demo-dataset-v1:sftms-test-seed-1-overlap-2026').digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');console.log([h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'))" | Select-Object -Last 1).Trim()
  $overlap = Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$overlapTournamentId/registrations?status=PENDING" -WebSession $session -TimeoutSec 20
  if (@($overlap.registrations).Count -ne 1) { throw "Overlap tournament should contain one pending application for the shared demo team" }
  $availability = Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$tournamentId/registration-control" -WebSession $session -TimeoutSec 20
  if (-not $availability.enabled -or -not $availability.canClose) { throw "Manual registration test control is not enabled for this DEV/TEST tournament" }
  $closed = Invoke-RestMethod -Method Post -Uri "http://localhost:18080/api/tournaments/$tournamentId/registration-control" -ContentType "application/json" -Body (@{ action = "TEST_CLOSE" } | ConvertTo-Json) -WebSession $session -TimeoutSec 20
  if ($closed.tournament.status -ne "REGISTRATION_CLOSED") { throw "Manual test close did not persist in the database" }
  $stillPending = Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$tournamentId/registrations?status=PENDING" -WebSession $session -TimeoutSec 20
  if (@($stillPending.registrations).Count -ne 12) { throw "Closing intake changed existing applications" }
  $reopened = Invoke-RestMethod -Method Post -Uri "http://localhost:18080/api/tournaments/$tournamentId/registration-control" -ContentType "application/json" -Body (@{ action = "TEST_REOPEN" } | ConvertTo-Json) -WebSession $session -TimeoutSec 20
  if ($reopened.tournament.status -ne "OPEN_REGISTRATION") { throw "Manual test reopen did not persist in the database" }
  Write-Host "Expanded test fixture is ready: tournament A has 12 applications (8 max / 4 min); tournament B has the same team 01 and roster pending, with overlapping dates. Manual close/reopen on A, audit and application retention were checked."
  Write-Host "Tournament A ID: $tournamentId"
  Write-Host "Tournament B ID: $overlapTournamentId"
  Write-Host "Login: http://localhost:15173 | dataset.btc01@football.local / $env:DEMO_ACCOUNT_PASSWORD"
} finally { Pop-Location }
