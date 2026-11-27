const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
async function query(name,sql,args=[]){const p=new Pool({connectionString:`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/${name}`,options:'-c default_transaction_read_only=on'});try{return(await p.query(sql,args)).rows;}finally{await p.end();}}
const schema=async name=>query(name,"SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position");
async function main(){const result={at:new Date().toISOString()};
if(process.argv.includes('--demo')){
 console.log(JSON.stringify({demo:await query('sfl_match','SELECT * FROM match_demo_times'),history:await query('sfl_match','SELECT match_id,revision,action,actor_id,real_time,effective_time FROM match_demo_time_history ORDER BY id'),clock:await query('sfl_match',"SELECT m.id,m.status,c.phase,c.version FROM matches m LEFT JOIN match_clock_states c ON c.match_id=m.id WHERE m.id='8b8a61e2-4b83-4c8c-962e-580b4a594106'")},null,2));return;
}
if(process.argv.includes('--data')){
 result.tournaments=await query('sfl_tournament',"SELECT id,name,status,start_date,end_date,competition_format,football_format,created_by FROM tournaments WHERE name LIKE 'DEMO %' ORDER BY name");
 const ids=result.tournaments.map(t=>t.id);
 result.matches=await query('sfl_match',"SELECT m.id,m.tournament_id,m.home_team_id,m.away_team_id,m.round,m.status,m.match_date,c.phase,c.version FROM matches m LEFT JOIN match_clock_states c ON c.match_id=m.id WHERE m.tournament_id=ANY($1::uuid[]) ORDER BY m.match_date,m.round",[ids]);
 result.assignments=await query('sfl_scheduling',"SELECT s.match_id,s.status,s.scheduled_date,a.referee_id,a.position,a.is_final_authority,p.positions,p.revision FROM schedules s JOIN schedule_referee_assignments a ON a.schedule_id=s.id AND a.is_active JOIN LATERAL (SELECT * FROM schedule_referee_publications p WHERE p.schedule_id=s.id ORDER BY revision DESC LIMIT 1) p ON p.voided_at IS NULL WHERE s.tournament_id=ANY($1::uuid[]) ORDER BY s.scheduled_date",[ids]);
 result.teams=await query('sfl_team',"SELECT t.id,t.name,t.captain_id,COUNT(r.player_id)::int roster_size FROM teams t JOIN rosters r ON r.team_id=t.id WHERE r.tournament_id=ANY($1::uuid[]) GROUP BY t.id ORDER BY t.name",[ids]);
 result.accounts=await query('sfl_user',"SELECT u.id,u.email,u.full_name,u.is_active,u.email_verified,u.account_status,ARRAY_AGG(r.role) roles FROM users u JOIN user_roles r ON r.user_id=u.id WHERE u.id=ANY($1::uuid[]) GROUP BY u.id ORDER BY email",[[...new Set([...result.teams.map(t=>t.captain_id),...result.assignments.map(a=>a.referee_id),...result.tournaments.map(t=>t.created_by)])]]);
 fs.writeFileSync(path.join(__dirname,'current-data.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({tournaments:result.tournaments,assignments:result.assignments,assignedMatches:result.matches.filter(m=>result.assignments.some(a=>a.match_id===m.id)),accounts:result.accounts},null,2));return;
}
for(const name of ['sfl_auth','sfl_user','sfl_team','sfl_tournament','sfl_match','sfl_scheduling'])result[name]=await schema(name);
fs.writeFileSync(path.join(__dirname,'schema.json'),JSON.stringify(result,null,2));
for(const [name,rows]of Object.entries(result))if(Array.isArray(rows))console.log(name,JSON.stringify(Object.fromEntries([...new Set(rows.map(x=>x.table_name))].filter(t=>/user|account|team|player|roster|tournament|match|schedule|referee/.test(t)).map(t=>[t,rows.filter(r=>r.table_name===t).map(r=>r.column_name)]))));}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
