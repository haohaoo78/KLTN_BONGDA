const fs=require('node:fs');
const data=JSON.parse(fs.readFileSync('output/demo-match-testing/current-api.json'));
for(const t of data.teams){const people=t.workspace.body.roster.players.filter(p=>p.eligible),keeper=people.find(p=>p.position==='GK');const chosen=[keeper,...people.filter(p=>p.id!==keeper.id).slice(0,12)];console.log(t.team.name,JSON.stringify(chosen.map((p,i)=>({name:p.fullName,jersey:p.jerseyNumber,position:p.position,selection:i<11?'Xuất phát':'Dự bị'}))));}
