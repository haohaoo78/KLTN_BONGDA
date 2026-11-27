$ErrorActionPreference='Stop'
$root=(Resolve-Path 'T:/DO AN/BONG DA').Path
$backup=Join-Path $root 'backups/match-operation-prompt-05-20261127-001'
if(Test-Path -LiteralPath $backup){throw 'Refuse to overwrite the backup directory'}
New-Item -ItemType Directory -Path $backup | Out-Null
$dockerPath='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
foreach($domain in @('tournament','match','scheduling','discipline','team')){
 $dump="/tmp/prompt05-$domain-001.dump"
 $target=Join-Path $backup "$domain.dump"
 if(-not ([IO.Path]::GetFullPath($target)).StartsWith($backup+[IO.Path]::DirectorySeparatorChar)){throw 'Backup path escaped target'}
 $ErrorActionPreference='Continue'
 & $dockerPath compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc --dbname "$1" -f "$2"' sh "sfl_$domain" $dump
 if($LASTEXITCODE -ne 0){throw "pg_dump failed for $domain"}
 & $dockerPath compose cp "postgres:$dump" $target
 if($LASTEXITCODE -ne 0){throw "Copy failed for $domain"}
 $database="sfl_prompt05_qa_${domain}_20261127_001"
 & $dockerPath compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh $database
 if($LASTEXITCODE -ne 0){throw "Refuse to reuse/overwrite $database"}
 & $dockerPath compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" --no-owner --dbname "$1" "$2"' sh $database $dump
 if($LASTEXITCODE -ne 0){throw "Restore failed for $domain"}
 $ErrorActionPreference='Stop'
}
Get-ChildItem -LiteralPath $backup | Select-Object Name,Length
