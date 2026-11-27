$ErrorActionPreference='Continue'
$dockerPath='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe'
foreach($domain in @('tournament','match','scheduling','discipline','team')){
 $database="sfl_prompt05_qa_${domain}_20261127_003"
 & $dockerPath compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" "$1"' sh $database
 if($LASTEXITCODE -ne 0){throw "Refuse to reuse/overwrite $database"}
 & $dockerPath compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" --no-owner --dbname "$1" "$2"' sh $database "/tmp/prompt05-$domain-001.dump"
 if($LASTEXITCODE -ne 0){throw "Restore failed for $domain"}
}

