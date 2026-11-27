const fs=require('fs');
let runtime=fs.readFileSync('scripts/qa-events-runtime.cjs','utf8').replaceAll('prompt06','prompt07');fs.writeFileSync('scripts/qa-shootout-runtime.cjs',runtime,{flag:'wx'});
let s=fs.readFileSync('scripts/qa-match-events.cjs','utf8').replaceAll('prompt-06','prompt-07').replaceAll('prompt06','prompt07').replaceAll('qa-events-runtime','qa-shootout-runtime');
s=s.replace('matchEventWorkflowMigration','matchShootoutMigration').replaceAll('applyMatchEventWorkflowMigration','applyMatchShootoutMigration').replaceAll('version=25','version=26').replace('migration 25','migration 26');
const start=s.indexOf(' const a=await prepare(aId'),end=s.indexOf('\n}\nmain().catch',start);if(start<0||end<0)throw Error('Harness markers');
s=s.slice(0,start)+fs.readFileSync('scripts/shootout-qa-cases.txt','utf8')+s.slice(end);
fs.writeFileSync('scripts/qa-match-shootout.cjs',s,{flag:'wx'});
