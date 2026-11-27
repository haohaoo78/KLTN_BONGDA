const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),data=JSON.parse(fs.readFileSync(path.join(__dirname,'current-data.json')));
const password=fs.readFileSync(path.join(root,'docs/DEMO_ACCOUNTS_AND_TESTING.md'),'utf8').match(/Demo@\d{6}/)?.[0];assert(password);
async function login(email){const r=await fetch('http://127.0.0.1:5173/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password})});assert.equal(r.status,200,`Demo login ${email}`);return r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');}
async function get(cookie,url){const r=await fetch('http://127.0.0.1:5173/api'+url,{headers:{cookie}});return{status:r.status,body:await r.json()};}
async function main(){const match=data.matches.find(m=>m.id==='8b8a61e2-4b83-4c8c-962e-580b4a594106'),teams=[match.home_team_id,match.away_team_id].map(id=>data.teams.find(t=>t.id===id));
const ref=await login('dataset.captain02@football.local'),btc=await login('dataset.btc01@football.local');
const result={at:new Date().toISOString(),demoPassword:password,match,teams:[],context:await get(ref,`/matches/${match.id}/referee-context`),readiness:await get(btc,`/matches/${match.id}/operation-readiness`)};
for(const team of teams){const account=data.accounts.find(a=>a.id===team.captain_id),cookie=await login(account.email);result.teams.push({team,account:account.email,workspace:await get(cookie,`/matches/${match.id}/squads/${team.id}`)});}
// The known demo password is deliberately not persisted in evidence; the existing demo account document owns it.
delete result.demoPassword;fs.writeFileSync(path.join(__dirname,'current-api.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({contextStatus:result.context.status,readiness:result.readiness.body,teams:result.teams.map(t=>({name:t.team.name,email:t.account,roster:t.workspace.body.roster?.players.length,rules:t.workspace.body.rules,issues:t.workspace.body.squad?.issues})),contextIssues:result.context.body.context?.readiness},null,2));}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
