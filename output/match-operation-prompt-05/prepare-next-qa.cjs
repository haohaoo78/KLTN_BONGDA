const fs=require('node:fs');const p='scripts/qa-match-clock.cjs';let s=fs.readFileSync(p,'utf8');
const start=s.indexOf(" await check('a replaced referee loses clock authority"),end=s.indexOf(" await time(Date.parse(a.context.schedule.scheduledDate)+60000);",start);if(start<0||end<0)throw Error('Expected QA block not found');
const block=s.slice(start,end);s=s.slice(0,start)+s.slice(end);const marker=" const a=await prepare(aId,'IFAB_2026_27',11),clockUrl=`/matches/${aId}/clock-actions`;";
if(!s.includes(marker))throw Error('Expected preparation marker not found');s=s.replace(marker," const clockUrl=`/matches/${aId}/clock-actions`;\n"+block+" const a=await prepare(aId,'IFAB_2026_27',11);");fs.writeFileSync(p,s);
