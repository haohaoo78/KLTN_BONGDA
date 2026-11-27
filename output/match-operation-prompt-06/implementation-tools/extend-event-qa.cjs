const fs=require('node:fs'),p='scripts/qa-match-events.cjs';let s=fs.readFileSync(p,'utf8');
s=s.replace("officialEmail='dataset.captain02@football.local'){","officialEmail='dataset.captain02@football.local',crewMode=null){");
s=s.replace("  if(!assignment.publication){\n",`  let support;
  if(crewMode){
   const supportEmail='dataset.captain01@football.local';
   if(!team.some(p=>p.identity.email===supportEmail))await ok(btc,\`/tournaments/\${t}/referee-team\`,'POST',{email:supportEmail,requestId:randomUUID(),profile:{organization:'Controlled QA event crew',formats:[format],positions:['MATCH_SECRETARY']}},201);
   team=(await ok(btc,\`/tournaments/\${t}/referee-team\`)).members;support=team.find(p=>p.identity.email===supportEmail);
   await ok(btc,\`/tournaments/\${t}/referee-team/\${support.id}\`,'PATCH',{profile:{...support.profile,formats:[...new Set([...support.profile.formats,format])],positions:[...new Set([...support.profile.positions,'MATCH_SECRETARY'])]}});
  }
  if(!assignment.publication){
`);
s=s.replace("const positions=[{code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']}];","const positions=[{code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']},...(crewMode?[{code:'MATCH_SECRETARY',label:'Thư ký trận',required:true,capabilities:crewMode==='READ'?[]:['RECORD_EVENT']}]:[])];");
s=s.replace("slots:[{position:'REFEREE',refereeId:member.userId}]","slots:[{position:'REFEREE',refereeId:member.userId},...(crewMode?[{position:'MATCH_SECRETARY',refereeId:support.userId}]:[])]");
const marker=" await check('official five business databases remain unchanged'";
s=s.replace(marker,fs.readFileSync('scripts/qa-events-extra.inc','utf8')+'\n'+marker);fs.writeFileSync(p,s);
