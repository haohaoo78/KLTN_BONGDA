// Read-only proof for the official Prompt 9 deployment. Never logs environment secrets.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const suffix=process.argv[2]||'';assert(!suffix||/^[a-z0-9-]+$/.test(suffix));
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/match-operation-prompt-09/runtime-verification'+(suffix?'-'+suffix:'')+'.json');
if(fs.existsSync(out))throw Error('Do not overwrite deployment evidence');
const docker='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const compose=['compose','-f','docker-compose.yml','-f','output/demo-match-testing/compose.demo.yml','--profile','apps'];
const run=(...args)=>cp.execFileSync(docker,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
async function main(){
 run(...compose,'config','--quiet');
 const containers=run(...compose,'ps','--format','json').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).map(c=>({service:c.Service,id:c.ID,image:c.Image,state:c.State,health:c.Health,ports:c.Ports}));
 assert(containers.every(c=>c.state==='running'&&(!c.health||c.health==='healthy')));
 const configuration=JSON.parse(run(...compose,'config','--format','json')),buildContexts={};
 const compiled=[];
 for(const [service,files]of Object.entries({
  'match-service':['repositories/competitionProjectionRepository.js','repositories/matchRepository.js','services/hybridQualification.js','services/officialStatisticsService.js','services/competitionPolicies.js','discipline/services/disciplineProjection.js','discipline/services/matchEventDisciplineOutbox.js','db/competitionProjectionMigration.js'],
  'tournament-service':['repositories/tournamentRepository.js'],'api-gateway':['index.js']
 })){
  const base=service==='api-gateway'?'apps/api-gateway':'services/'+service;
  for(const relative of files){const local=sha(fs.readFileSync(path.join(root,base,'dist',relative))),deployed=run(...compose,'exec','-T',service,'sha256sum','/app/'+base+'/dist/'+relative).split(/\s/)[0];assert.equal(deployed,local,'Compiled source mismatch: '+service+'/'+relative);compiled.push({service,file:relative,sha256:local});}
 }
 for(const service of ['match-service','tournament-service','api-gateway','web-client']){
  const c=containers.find(c=>c.service===service);assert(c);
  const running=run('inspect','--format','{{.Image}}',c.id).trim(),built=run('image','inspect','--format','{{.Id}}',c.image).trim();assert.equal(running,built,'Running image mismatch: '+service);c.imageId=running;
  buildContexts[service]=configuration.services[service].build;
 }
 const index=await fetch('http://localhost:5173/').then(r=>{assert(r.ok);return r.text();}),assets=[];
 for(const asset of [...new Set(index.match(/\/assets\/[^"']+\.(?:js|css)/g))]){
  const local=sha(fs.readFileSync(path.join(root,'apps/web-client/dist',asset))),served=sha(Buffer.from(await fetch('http://localhost:5173'+asset).then(r=>{assert(r.ok);return r.arrayBuffer();})));assert.equal(served,local,'HTTP frontend mismatch');assets.push({file:asset,sha256:local});
 }assert.equal(assets.length,2);
 const health={};for(const url of ['http://localhost:5173/api/health','http://127.0.0.1:3005/health']){const r=await fetch(url);assert(r.ok);health[url]={status:r.status,body:await r.json()};}
 const databases={};
 for(const [name,version]of [['match',29],['discipline',1004]]){
  const url=new URL(`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/sfl_${name}`);url.searchParams.set('options','-c default_transaction_read_only=on');const p=new Pool({connectionString:url.toString()});
  try{const migration=(await p.query('SELECT version,name FROM sfl_schema_migrations WHERE version=$1',[version])).rows;assert.equal(migration.length,1);databases[name]={migration};
   if(name==='match'){databases[name].projectionConflicts=(await p.query('SELECT COUNT(*)::int AS n FROM competition_projection_conflicts')).rows[0].n;databases[name].pendingDiscipline=(await p.query('SELECT COUNT(*)::int AS n FROM match_event_discipline_outbox WHERE processed_at IS NULL')).rows[0].n;}
   else databases[name].projectionHistory=(await p.query('SELECT COUNT(*)::int AS n FROM discipline_projection_history')).rows[0].n;
  }finally{await p.end();}
 }
 const result={at:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),compose:compose.slice(1),buildContexts,containers,compiled,assets,health,databases};
 fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({containers:containers.length,healthy:containers.filter(c=>c.health==='healthy').length,compiled:compiled.length,assets:assets.length,databases}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
