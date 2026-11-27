$ErrorActionPreference='Continue'
$dockerPath='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
$backup=(Resolve-Path 'backups/match-operation-prompt-05-20261127-001').Path
foreach($domain in @('auth','user')){
 $target=Join-Path $backup "$domain.dump"
 if(Test-Path -LiteralPath $target){throw 'Refuse to overwrite an existing backup'}
 $dump="/tmp/prompt05-$domain-001.dump"
 & $dockerPath compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc --dbname "$1" -f "$2"' sh "sfl_$domain" $dump
 if($LASTEXITCODE -ne 0){throw "Backup failed for $domain"}
 & $dockerPath compose cp "postgres:$dump" $target
 if($LASTEXITCODE -ne 0){throw "Copy failed for $domain"}
}
