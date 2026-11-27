const fs=require('node:fs');const p='apps/web-client/src/components/referee/RefereeOperationPage.tsx';let s=fs.readFileSync(p,'utf8');
function replace(a,b){if(!s.includes(a))throw Error('Missing UI marker: '+a.slice(0,80));s=s.replace(a,b);}
replace('[...context.events].sort((a,b) => (b.minute ?? 0)-(a.minute ?? 0))','[...context.events].sort((a,b) => compareMatchEventTiming(b,a))');
replace('{event.minute ?? "—"}′','{eventTimeLabel(event)}′');
replace('<strong>{eventLabels[event.eventType]}</strong>','<strong>{eventLabels[event.eventType]}</strong>{event.phase?<small>{phaseLabels[event.phase]}</small>:null}');
replace('scoreFromEvents(context.events,context.home.id,context.away.id,(context.rules?.matchDurationMinutes??0)/2)','scoreFromEvents(context.events,context.home.id,context.away.id,"FIRST_HALF")');
const a=s.indexOf('    {stage==="live"?'),b=s.indexOf('    {stage==="post"?');if(a<0||b<a)throw Error('Live region');s=s.slice(0,a)+fs.readFileSync('output/match-operation-prompt-05/live-fragment.txt','utf8')+'\n'+s.slice(b);
replace('<input type="number" min="0" max="120" step="1" required value={eventMinute} onChange={(e)=>setEventMinute(e.target.value)}/>','<input type="number" min="0" step="1" required value={eventMinute} onChange={(e)=>{setEventMinute(e.target.value);const t=periodTiming(eventTiming.phase,Number(context.operationRules?.rules.values.periodMinutes),context.operationRules?.extraTimeMinutes??null);if(t)setEventTiming(old=>({...old,periodElapsedSeconds:(Number(e.target.value)-t.baseMinute)*60}));}}/>');
replace('<label className="rf-field">Phút thi đấu','<p>{phaseLabels[eventTiming.phase]} · {clockSeconds(eventTiming.periodElapsedSeconds)} trong hiệp</p>{error?<p className="rf-inline-error" role="alert">{error}</p>:null}<label className="rf-field">Phút thi đấu');
fs.writeFileSync(p,s);
