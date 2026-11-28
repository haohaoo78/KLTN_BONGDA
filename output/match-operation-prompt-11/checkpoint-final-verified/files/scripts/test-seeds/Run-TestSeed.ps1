param(
  [ValidateRange(1, 4)][int]$Seed = 1,
  [switch]$Expanded1,
  [string]$ConfirmReset = ""
)

if ($Expanded1 -and $Seed -ne 1) { throw "Expanded1 is available only with Seed 1" }

$ErrorActionPreference = "Stop"
$project = "sftms-test-seed-$Seed"
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
  $env:TEST_SEED_VARIANT = if ($Expanded1) { "expanded-1" } else { "$Seed" }
  $teamCount = if ($Expanded1) { 12 } elseif ($Seed -le 2) { 8 } else { 16 }
  $env:DEMO_TEAM_COUNT = "$teamCount"
  $env:DEMO_PLAYERS_PER_TEAM = "20"
  $env:DEMO_INTER_SCHOOL = if ($Seed -ge 3) { "true" } else { "false" }

  & docker compose @compose config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Compose test configuration is invalid" }

  $volumeNames = @(& docker volume ls --filter "label=com.docker.compose.project=$project" --format "{{.Name}}") | Where-Object { $_ }
  if ($volumeNames.Count -gt 0) {
    Write-Host "The following volumes belong only to $project and will be reset:"
    $volumeNames | ForEach-Object { Write-Host "  $_" }
    $confirmation = $ConfirmReset
    if (-not $confirmation) { $confirmation = Read-Host "Type RESET $project to remove only these test volumes" }
    if ($confirmation -cne "RESET $project") { throw "Reset cancelled; no test data was removed" }
    & docker compose @compose down --volumes --remove-orphans
  } else {
    & docker compose @compose down --remove-orphans
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not stop the isolated test project" }

  Write-Host "Starting isolated test project $project (host URLs: http://localhost:15173 and http://localhost:18080)"
  & docker compose @compose up -d postgres redis
  if ($LASTEXITCODE -ne 0) { throw "Could not start the isolated PostgreSQL and Redis containers" }
  $postgresUserLine = Get-Content -LiteralPath ".env" -ErrorAction SilentlyContinue | Where-Object { $_ -match '^POSTGRES_USER=' } | Select-Object -First 1
  $postgresUser = if ($postgresUserLine) { ($postgresUserLine -split "=", 2)[1].Trim('"') } else { "sfl" }
  $databaseDeadline = (Get-Date).AddMinutes(2)
  $databaseCount = 0
  do {
    try {
      $databaseCountText = & docker compose @compose exec -T postgres psql -U $postgresUser -d postgres -Atc "SELECT COUNT(*) FROM pg_database WHERE datname <> 'postgres' AND datistemplate = false" 2>$null
      if ($LASTEXITCODE -eq 0 -and [int]::TryParse(($databaseCountText | Select-Object -Last 1), [ref]$databaseCount) -and $databaseCount -ge 8) { break }
    } catch { }
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $databaseDeadline)
  if ($databaseCount -lt 8) { throw "PostgreSQL did not finish creating the eight service databases" }
  Write-Host "PostgreSQL initialized $databaseCount service databases; applying migrations and starting services."
  & docker compose @compose --profile apps up --build -d
  if ($LASTEXITCODE -ne 0) { throw "Application startup or migrations failed" }

  $deadline = (Get-Date).AddMinutes(3)
  do {
    try { $null = Invoke-RestMethod -Uri "http://localhost:18080/health" -TimeoutSec 4; break } catch { Start-Sleep -Seconds 3 }
  } while ((Get-Date) -lt $deadline)
  if ((Get-Date) -ge $deadline) { throw "Gateway health check timed out" }

  $steps = @(
    @{ Profile = "demo-dataset"; Service = "tournament-demo-account-seed" },
    @{ Profile = "demo-dataset"; Service = "tournament-demo-club-seed" },
    @{ Profile = "approval-demo"; Service = "approval-workflow-demo-tournament-seed" },
    @{ Profile = "approval-demo"; Service = "approval-workflow-demo-registration-seed" }
  )
  foreach ($step in $steps) {
    Write-Host "Running $($step.Service)"
    & docker compose @compose --profile apps --profile $step.Profile run --rm --build --no-deps $step.Service
    if ($LASTEXITCODE -ne 0) { throw "Seed stage failed: $($step.Service)" }
    if ($step.Service -eq "tournament-demo-account-seed") {
      $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
      $adminLogin = @{ email = "dataset.admin01@football.local"; password = $env:DEMO_ACCOUNT_PASSWORD } | ConvertTo-Json
      $null = Invoke-RestMethod -Method Post -Uri "http://localhost:18080/api/auth/login" -ContentType "application/json" -Body $adminLogin -WebSession $adminSession -TimeoutSec 15
      $drafts = Invoke-RestMethod -Uri "http://localhost:18080/api/institutions/manage?status=DRAFT" -WebSession $adminSession -TimeoutSec 15
      $knownCodes = @("SFL-HCM-IUH", "SFL-HCM-HUTECH", "SFL-HCM-UEF", "SFL-HCM-UEH", "SFL-HCM-CAOTHANG", "SFL-HCM-HITU", "SFL-HCM-TDC", "SFL-HCM-HCMCT")
      $requiredSchoolCount = if ($Seed -le 2) { 1 } else { 4 }
      $requiredCodes = @($knownCodes | Select-Object -First $requiredSchoolCount)
      foreach ($institution in @($drafts.institutions)) {
        if ($requiredCodes -contains $institution.code) {
          $body = @{ status = "ACTIVE" } | ConvertTo-Json
          $null = Invoke-RestMethod -Method Patch -Uri "http://localhost:18080/api/institutions/$($institution.id)/status" -ContentType "application/json" -Body $body -WebSession $adminSession -TimeoutSec 15
        }
      }
      $active = Invoke-RestMethod -Uri "http://localhost:18080/api/institutions/manage?status=ACTIVE" -WebSession $adminSession -TimeoutSec 15
      $activeCodes = @($active.institutions | Where-Object { $requiredCodes -contains $_.code } | ForEach-Object { $_.code } | Sort-Object -Unique)
      if ($activeCodes.Count -ne $requiredSchoolCount) { throw "Expected to activate $requiredSchoolCount catalog test schools through ADMIN API; found $($activeCodes.Count)" }
    }
  }

  Write-Host "Rebuilding the changed application services after creating the seed data."
  & docker compose @compose --profile apps build web-client organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Could not rebuild web-client, organization-service and tournament-service" }
  foreach ($migration in @("organization-migrate", "tournament-migrate")) {
    & docker compose @compose --profile apps run --rm --no-deps $migration
    if ($LASTEXITCODE -ne 0) { throw "Could not apply migrations through $migration" }
  }
  & docker compose @compose --profile apps up -d --no-deps web-client organization-service tournament-service
  if ($LASTEXITCODE -ne 0) { throw "Could not restart rebuilt services" }

  $tournamentKey = if ($Expanded1) { "sftms-test-seed-1-expanded-2026" } else { "sftms-test-seed-$Seed-2026" }
  $tournamentId = (& docker compose @compose exec -T tournament-service node -e "const crypto=require('crypto');const b=crypto.createHash('sha256').update('sftms-demo-dataset-v1:$tournamentKey').digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');console.log([h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'))" | Select-Object -Last 1).Trim()
  if (-not $tournamentId) { throw "Could not resolve the seeded tournament ID" }

  $roles = @(
    @{ Email = "dataset.admin01@football.local"; Role = "ADMIN" },
    @{ Email = "dataset.btc01@football.local"; Role = "BTC" },
    @{ Email = "dataset.btc02@football.local"; Role = "BTC (cross-scope check)" },
    @{ Email = "dataset.captain01@football.local"; Role = "TEAM_CAPTAIN" },
    @{ Email = "dataset.player0001@football.local"; Role = "PLAYER" },
    @{ Email = "dataset.referee01@football.local"; Role = "REFEREE" },
    @{ Email = "dataset.viewer01@football.local"; Role = "VIEWER" }
  )
  foreach ($account in $roles) {
    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $loginBody = @{ email = $account.Email; password = $env:DEMO_ACCOUNT_PASSWORD } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "http://localhost:18080/api/auth/login" -ContentType "application/json" -Body $loginBody -WebSession $session
    if (-not $login.user -or $session.Cookies.Count -eq 0) { throw "Login/session check failed for $($account.Role) ($($account.Email))" }
    $me = Invoke-RestMethod -Uri "http://localhost:18080/api/auth/me" -WebSession $session
    if (-not $me.user -and -not $me.email) { throw "Session did not persist for $($account.Role) ($($account.Email))" }
    if ($account.Email -eq "dataset.btc01@football.local") {
      $btcSession = $session
      $pending = Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$tournamentId/registrations?status=PENDING" -WebSession $session
      $items = @($pending.registrations)
      $expected = $teamCount
      if ($items.Count -ne $expected) { throw "BTC saw $($items.Count) pending registrations; expected $expected" }
    }
    if ($account.Email -eq "dataset.btc02@football.local") {
      try {
        Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$tournamentId/registrations" -WebSession $session | Out-Null
        throw "An unassigned BTC account could read this tournament's registrations"
      } catch {
        if ($_.Exception.Message -match "unassigned BTC account") { throw }
        if ($_.Exception.Response.StatusCode.value__ -ne 403) { throw }
      }
    }
  }

  if ($Expanded1) {
    $overlapTournamentId = (& docker compose @compose exec -T tournament-service node -e "const crypto=require('crypto');const b=crypto.createHash('sha256').update('sftms-demo-dataset-v1:sftms-test-seed-1-overlap-2026').digest().subarray(0,16);b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString('hex');console.log([h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-'))" | Select-Object -Last 1).Trim()
    $overlap = Invoke-RestMethod -Uri "http://localhost:18080/api/tournaments/$overlapTournamentId/registrations?status=PENDING" -WebSession $btcSession -TimeoutSec 20
    if (@($overlap.registrations).Count -ne 1) { throw "Overlap tournament should contain one pending application for the shared demo team" }
    Write-Host "Overlap scenario: tournament A $tournamentId has 12 applications; tournament B $overlapTournamentId has team 01 with the same 14-player roster. Both tournament dates overlap."
  }

  $web = Invoke-WebRequest -Uri "http://localhost:15173/" -TimeoutSec 10 -UseBasicParsing
  if ($web.StatusCode -ne 200) { throw "Web client is not responding" }
  $seedLabel = if ($Expanded1) { "Seed 1 mở rộng" } else { "Seed $Seed" }
  Write-Host "$seedLabel is ready. Tournament ID: $tournamentId"
  Write-Host "Login: http://localhost:15173 | API: http://localhost:18080"
  Write-Host "Password for this isolated test dataset: $env:DEMO_ACCOUNT_PASSWORD"
  Write-Host "Accounts: dataset.admin01@football.local; dataset.btc01@football.local; dataset.btc02@football.local; dataset.captain01@football.local; dataset.player0001@football.local; dataset.referee01@football.local; dataset.viewer01@football.local"
  Write-Host "Team captains are dataset.captain01..$('{0:D2}' -f $teamCount)@football.local; 20 players per team are numbered consecutively in dataset.playerNNNN@football.local."
} finally {
  Pop-Location
}
