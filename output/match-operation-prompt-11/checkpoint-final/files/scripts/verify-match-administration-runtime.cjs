// Read-only proof for the official Prompt 10 Docker rollout. Never logs secrets.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/match-operation-prompt-10/runtime-verification-final.json');
if(fs.existsSync(out))throw Error('Do not overwrite runtime evidence');
const docker='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',compose=['compose','-f','docker-compose.yml','-f','output/demo-match-testing/compose.demo.yml','--profile','apps'];
const run=(...args)=>cp.execFileSync(docker,args,{cwd:root,encoding:'utf8',maxBuffer:12*1024*1024}),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const {Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const prior=JSON.parse(fs.readFileSync(path.join(root,'output/match-operation-prompt-10/database-before-011.json'),'utf8'));
async function main(){
 run(...compose,'config','--quiet');
 const containers=run(...compose,'ps','--format','json').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).map(c=>({service:c.Service,id:c.ID,image:c.Image,state:c.State,health:c.Health,ports:c.Ports}));
 assert.equal(containers.length,9);assert(containers.every(c=>c.state==='running'&&(!c.health||c.health==='healthy')));
 const configuration=JSON.parse(run(...compose,'config','--format','json')),buildContexts={},compiled=[];
 const files={
  'match-service':['controllers/matchController.js','repositories/matchAdministrationRepository.js','services/matchAdministrationDelivery.js','services/tournamentOperationsService.js','db/matchAdministrationMigration.js','scheduling/repositories/matchOperationReadinessRepository.js'],
  'tournament-service':['controllers/tournamentController.js','repositories/matchOperationRulesRepository.js'],
  'api-gateway':['index.js']
 };
 for(const [service,items]of Object.entries(files))for(const file of items){const prefix=service==='api-gateway'?'apps/api-gateway':'services/'+service,local=sha(fs.readFileSync(path.join(root,prefix,'dist',file))),deployed=run(...compose,'exec','-T',service,'sha256sum','/app/'+prefix+'/dist/'+file).split(/\s/)[0];assert.equal(deployed,local,'Compiled source mismatch '+service+'/'+file);compiled.push({service,file,sha256:local});}
 for(const service of ['match-service','tournament-service','api-gateway','web-client']){const c=containers.find(v=>v.service===service);assert(c);const running=run('inspect','--format','{{.Image}}',c.id).trim(),built=run('image','inspect','--format','{{.Id}}',c.image).trim();assert.equal(running,built,'Running image mismatch '+service);c.imageId=running;buildContexts[service]=configuration.services[service].build;}
 const index=await fetch('http://localhost:5173/').then(r=>{assert(r.ok);return r.text();}),assets=[];
 for(const asset of [...new Set(index.match(/\/assets\/[^"']+\.(?:js|css)/g))]){const local=sha(fs.readFileSync(path.join(root,'apps/web-client/dist',asset))),served=sha(Buffer.from(await fetch('http://localhost:5173'+asset).then(r=>{assert(r.ok);return r.arrayBuffer();})));assert.equal(served,local,'Served frontend asset mismatch');assets.push({file:asset,sha256:local});}assert.equal(assets.length,2);
 const health={};for(const url of ['http://localhost:5173/api/health','http://127.0.0.1:3005/health']){const r=await fetch(url);assert(r.ok);health[url]={status:r.status,body:await r.json()};}
 const dbs={},businessChanges=[];
 for(const name of ['tournament','match','scheduling','discipline','team']){const url=new URL(`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT||5432}/sfl_${name}`);url.searchParams.set('options','-c default_transaction_read_only=on');const p=new Pool({connectionString:url.toString()});try{
  const tables=(await p.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename),state={migrationVersions:(await p.query('SELECT version,name FROM sfl_schema_migrations ORDER BY version DESC LIMIT 3')).rows,tableCount:tables.length,changedExistingTables:[]};
  for(const table of tables){assert(/^[a-z_0-9]+$/.test(table));const digest=(await p.query(`SELECT COUNT(*)::int AS rows,md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${table}" t`)).rows[0],old=prior[name]?.[table];if(old&&(old.rows!==digest.rows||old.digest!==digest.digest)){state.changedExistingTables.push({table,before:old,after:digest});businessChanges.push({database:name,table,before:old,after:digest});}}
  if(name==='match')assert((await p.query('SELECT 1 FROM sfl_schema_migrations WHERE version=30')).rowCount===1);
  if(name==='scheduling')assert((await p.query('SELECT 1 FROM sfl_schema_migrations WHERE version=1014')).rowCount===1);
  if(name==='discipline')assert((await p.query('SELECT 1 FROM sfl_schema_migrations WHERE version=1005')).rowCount===1);
  dbs[name]=state;
 }finally{await p.end();}}
 const result={at:new Date().toISOString(),head:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),compose:compose.slice(1),buildContexts,containers,compiled,assets,health,databases:dbs,changedExistingTables:businessChanges,baselineSnapshot:'QA harness official snapshot captured before deployment at output/match-operation-prompt-10/database-before-011.json'};
 fs.writeFileSync(out,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify({containers:containers.length,healthy:containers.filter(c=>c.health==='healthy').length,compiled:compiled.length,assets:assets.length,dbMigrations:{match:30,scheduling:1014,discipline:1005},changedExistingTables:businessChanges.map(x=>x.database+'.'+x.table)}));
}main().catch(e=>{console.error(e.message);process.exitCode=1;});
