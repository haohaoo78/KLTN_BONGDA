$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
Push-Location $root
try {
  $compose = @("-f", "docker-compose.yml")
  & docker compose @compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Compose configuration is invalid" }

  $nodeEnvLine = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match '^NODE_ENV=' } | Select-Object -First 1
  $nodeEnv = if ($nodeEnvLine) { ($nodeEnvLine -split "=", 2)[1].Trim('"') } else { "development" }
  if ($nodeEnv -eq "production") { throw "This additive fixture is restricted to the current development system; production was detected." }
  $password = $env:DEMO_ACCOUNT_PASSWORD
  if (-not $password) {
    $passwordLine = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match '^DEMO_ACCOUNT_PASSWORD=' } | Select-Object -First 1
    if ($passwordLine) { $password = ($passwordLine -split "=", 2)[1].Trim('"') }
  }
  if (-not $password) { $password = "SflTest@2026!" }

  $running = @(& docker compose @compose --profile apps ps --status running --services)
  if ($LASTEXITCODE -ne 0 -or "postgres" -notin $running -or "tournament-service" -notin $running -or "organization-service" -notin $running -or "api-gateway" -notin $running) {
    throw "The existing development stack is not running. This script does not create or reset another environment."
  }

  Write-Host "Building the current app's Web Client, Organization and Tournament services; no volume or existing records will be reset."
  & docker compose @compose --profile apps --profile demo-dataset --profile approval-demo build web-client auth-service organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Build failed" }

  foreach ($migration in @("organization-migrate", "tournament-migrate")) {
    & docker compose @compose --profile apps run --rm --no-deps $migration
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $migration" }
  }
  & docker compose @compose --profile apps up -d --no-deps organization-service tournament-service web-client
  if ($LASTEXITCODE -ne 0) { throw "Could not restart the updated services" }

  foreach ($service in @("organization-service", "tournament-service")) {
    $deadline = (Get-Date).AddMinutes(2)
    do {
      $state = @(& docker compose @compose --profile apps ps --status running --services)
      if ($LASTEXITCODE -eq 0 -and $service -in $state) { break }
      Start-Sleep -Seconds 3
    } while ((Get-Date) -lt $deadline)
    if ($service -notin $state) { throw "$service did not return to running state" }
  }
  $healthDeadline = (Get-Date).AddMinutes(2)
  do {
    try { $null = Invoke-RestMethod -Uri "http://localhost:8080/health" -TimeoutSec 4; break } catch { Start-Sleep -Seconds 3 }
  } while ((Get-Date) -lt $healthDeadline)
  if ((Get-Date) -ge $healthDeadline) { throw "API Gateway did not become healthy after restart" }

  Write-Host "Adding the Seed 1 overlap pair and one fresh demo team with the same pending roster in both tournaments."
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $accountSeedOutput = @(& docker compose @compose --profile apps --profile demo-dataset run --rm --no-deps -e DEMO_TEAM_COUNT=13 -e DEMO_PLAYERS_PER_TEAM=20 -e DEMO_INTER_SCHOOL=false -e DEMO_ACCOUNT_PASSWORD=$password tournament-demo-account-seed 2>&1)
    $accountSeedExitCode = $LASTEXITCODE
    $accountSeedOutput | ForEach-Object { Write-Host $_ }
    if ($accountSeedExitCode -ne 0) { throw "Could not add demo captain/player accounts for team 13" }
    $clubSeedOutput = @(& docker compose @compose --profile apps --profile demo-dataset run --rm --no-deps -e DEMO_TEAM_COUNT=13 -e DEMO_PLAYERS_PER_TEAM=20 -e DEMO_INTER_SCHOOL=false tournament-demo-club-seed 2>&1)
    $clubSeedExitCode = $LASTEXITCODE
    $clubSeedOutput | ForEach-Object { Write-Host $_ }
    if ($clubSeedExitCode -ne 0) { throw "Could not add demo club 13 and its roster" }
    $tournamentOutput = @(& docker compose @compose --profile apps --profile approval-demo run --rm --no-deps -e TEST_SEED_VARIANT=overlap-1 approval-workflow-demo-tournament-seed 2>&1)
    $tournamentExitCode = $LASTEXITCODE
    $tournamentOutput | ForEach-Object { Write-Host $_ }
    if ($tournamentExitCode -ne 0) { throw "Could not seed the overlapping tournament dates" }
    $registrationOutput = @(& docker compose @compose --profile apps --profile approval-demo run --rm --no-deps -e TEST_SEED_VARIANT=overlap-1 approval-workflow-demo-registration-seed 2>&1)
    $registrationExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  if ($registrationExitCode -ne 0) { $registrationOutput | ForEach-Object { Write-Host $_ }; throw "Could not seed the shared team roster" }
  $registrationOutput | ForEach-Object { Write-Host $_ }

  $tournamentAId = (& docker compose @compose exec -T tournament-service node -e "const c=require('crypto');const b=c.createHash('sha256').update('sftms-demo-dataset-v1:sftms-test-seed-1-overlap-a-2026').digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');console.log([h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'))" | Select-Object -Last 1).Trim()
  $overlapId = (& docker compose @compose exec -T tournament-service node -e "const c=require('crypto');const b=c.createHash('sha256').update('sftms-demo-dataset-v1:sftms-test-seed-1-overlap-2026').digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');console.log([h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'))" | Select-Object -Last 1).Trim()
  $null = Invoke-WebRequest -Uri "http://localhost:5173/" -TimeoutSec 15 -UseBasicParsing

  $captain = "dataset.captain13@football.local"
  Write-Host "Ready in the existing development system. Tournament A ID: $tournamentAId"
  Write-Host "Tournament B ID: $overlapId"
  Write-Host "Shared pending team: 13 ($captain); the same 14-player roster is pending in both overlapping tournaments."
  Write-Host "Captain 13 password for this demo account: $password. No database or volume was reset."
} finally {
  Pop-Location
}
