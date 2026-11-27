const fs=require('node:fs');
let host=fs.readFileSync('scripts/qa-clock-runtime.cjs','utf8').replaceAll('prompt05_qa_','prompt06_qa_');
host=host.replace("else if(message.op==='close')", "else if(message.op==='outbox'){const count=await require(path.join(root,'services/match-service/dist/discipline/services/matchEventDisciplineOutbox')).processMatchEventDisciplineOutbox();process.send({id:message.id,count});}else if(message.op==='close')");fs.writeFileSync('scripts/qa-events-runtime.cjs',host,{flag:'wx'});
let s=fs.readFileSync('scripts/qa-match-clock.cjs','utf8').replaceAll('prompt-05','prompt-06').replaceAll('prompt05_qa_','prompt06_qa_').replaceAll('qa-clock-runtime.cjs','qa-events-runtime.cjs');
s=s.replace("const migrate=require(path.join(root,'services/match-service/dist/db/matchClockTimingMigration')).applyMatchClockTimingMigration;","const migrate=require(path.join(root,'services/match-service/dist/db/matchEventWorkflowMigration')).applyMatchEventWorkflowMigration;");s=s.replaceAll('migration 24','migration 25').replace('version=24','version=25');
s=s.replace("maxSubstitutes:format===11?9:5,shirtNumbers", "...(law==='IFAB_2026_27'?{substitutionMode:'LIMITED',maxSubstitutions:5,substitutionOpportunities:3,returnSubstitutes:'NO'}:{}),maxSubstitutes:format===11?9:5,shirtNumbers");
s=s.replace('.slice(0,format-1)', '.slice(0,format+2)').replace('isStarting:true','isStarting:i<format');
const start=s.indexOf(' const clockUrl=`/matches/${aId}/clock-actions`;'),end=s.indexOf('\n}\nmain().catch',start);if(start<0||end<0)throw Error('QA boundary not found');
s=s.slice(0,start)+fs.readFileSync('scripts/qa-events-cases.inc','utf8')+s.slice(end);fs.writeFileSync('scripts/qa-match-events.cjs',s,{flag:'wx'});
