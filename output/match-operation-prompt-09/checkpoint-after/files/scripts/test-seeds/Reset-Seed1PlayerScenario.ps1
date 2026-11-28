param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('P01','P02','P03','P04','P05','P06','P07','P08')]
  [string]$Player
)

$ErrorActionPreference = 'Stop'
$docker = 'C:\Users\win\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$composeFile = Join-Path $projectRoot 'docker-compose.yml'
$envFile = Join-Path $projectRoot '.env'
$nodeEnv = 'development'
$internalApiKey = 'dev-internal-api-key-change-in-production'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile) {
    if ($line -match '^NODE_ENV=(.*)$') { $nodeEnv = $Matches[1].Trim('"') }
    if ($line -match '^INTERNAL_API_KEY=(.*)$') { $internalApiKey = $Matches[1].Trim('"') }
  }
}
if ($nodeEnv -eq 'production') { throw 'Scenario reset is forbidden in production.' }

function Get-SeedId([string]$key) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("sftms-demo-dataset-v1:$key"))[0..15] }
  finally { $sha.Dispose() }
  $bytes[6] = ($bytes[6] -band 0x0f) -bor 0x50
  $bytes[8] = ($bytes[8] -band 0x3f) -bor 0x80
  $hex = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
  return '{0}-{1}-{2}-{3}-{4}' -f $hex.Substring(0,8),$hex.Substring(8,4),$hex.Substring(12,4),$hex.Substring(16,4),$hex.Substring(20,12)
}

function Invoke-TeamDb([string]$sql) {
  $result = @(& $docker exec sfl-postgres psql -U sfl -d sfl_team -v ON_ERROR_STOP=1 -Atc $sql)
  if ($LASTEXITCODE -ne 0) { throw 'The Seed 1 scenario database operation failed.' }
  return $result
}

$teamId = Get-SeedId 'dataset-team-31'
$jersey = @{ P01=12; P02=13; P03=16; P04=17; P05=18; P06=19; P07=20; P08=11 }[$Player]
$playerId = Get-SeedId ("dataset-player-{0:d4}" -f (600 + $jersey))
$eventA = Get-SeedId 'sftms-player-invite-overlap-a-2026'
$eventB = Get-SeedId 'sftms-player-invite-overlap-b-2026'
$eventC = Get-SeedId 'sftms-player-invite-nonoverlap-c-2026'
$baselineP08Decline = Get-SeedId 'seed1-manual-sftms-player-invite-overlap-a-2026-team31-jersey-11'

$revertTournaments = switch ($Player) {
  'P01' { @($eventA,$eventB) }
  'P02' { @($eventA,$eventB) }
  'P03' { @($eventC) }
  'P04' { @($eventA,$eventB,$eventC) }
  'P05' { @($eventA,$eventB) }
  'P06' { @($eventA) }
  'P07' { @() }
  'P08' { @($eventA) }
}

foreach ($tournamentId in $revertTournaments) {
  $exclude = if ($Player -eq 'P08') { " AND id <> '$baselineP08Decline'" } else { '' }
  $acceptedIds = Invoke-TeamDb "SELECT id FROM tournament_player_invitations WHERE team_id='$teamId' AND player_id='$playerId' AND tournament_id='$tournamentId' AND status='ACCEPTED'$exclude"
  foreach ($invitationId in $acceptedIds) {
    $uri = "http://localhost:3003/internal/player-participation/invitations/$invitationId/release"
    $null = Invoke-RestMethod -Method Post -Uri $uri -Headers @{ 'x-gateway-internal-key' = $internalApiKey } -TimeoutSec 15
  }
}

if ($Player -eq 'P08') {
  $sql = @"
UPDATE tournament_player_invitations SET status='CANCELLED',responded_at=COALESCE(responded_at,NOW()),status_reason='P08 scenario reset',updated_at=NOW()
 WHERE team_id='$teamId' AND player_id='$playerId' AND tournament_id='$eventA' AND id<>'$baselineP08Decline' AND status IN ('PENDING','ACCEPTED','DECLINED','INVALIDATED');
UPDATE tournament_player_invitations SET status='DECLINED',responded_at=COALESCE(responded_at,NOW()),updated_at=NOW()
 WHERE id='$baselineP08Decline' AND team_id='$teamId' AND player_id='$playerId' AND tournament_id='$eventA';
"@
} elseif ($Player -eq 'P03') {
  $sql = "UPDATE tournament_player_invitations SET status='PENDING',responded_at=NULL,status_reason=NULL,updated_at=NOW() WHERE team_id='$teamId' AND player_id='$playerId' AND tournament_id='$eventC' AND status IN ('ACCEPTED','DECLINED','INVALIDATED','CANCELLED');"
} elseif ($Player -eq 'P07') {
  $sql = 'SELECT 1;'
} else {
  $tournamentList = switch ($Player) {
    'P01' { "'$eventA','$eventB'" }
    'P02' { "'$eventA','$eventB'" }
    'P04' { "'$eventA','$eventB','$eventC'" }
    'P05' { "'$eventA','$eventB'" }
    'P06' { "'$eventA'" }
  }
  $sql = "UPDATE tournament_player_invitations SET status='PENDING',responded_at=NULL,status_reason=NULL,updated_at=NOW() WHERE team_id='$teamId' AND player_id='$playerId' AND tournament_id IN ($tournamentList) AND status IN ('ACCEPTED','DECLINED','INVALIDATED','CANCELLED');"
}
$null = Invoke-TeamDb $sql
Write-Host "$Player was reset to its Seed 1 starting invitations only. Other players, registrations and volumes were not changed."
