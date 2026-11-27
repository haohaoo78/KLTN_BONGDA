// Compare existing official rows with the restored pre-change QA copy, using read-only connections.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),{Pool}=require(path.join(root,'services/match-service/node_modules/pg'));
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const pool=database=>new Pool({host:'127.0.0.1',port:Number(env.POSTGRES_PORT||5432),user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database,options:'-c default_transaction_read_only=on'});
async function main(){
 const original=pool('sfl_tournament'),restored=pool('sfl_prompt04_qa_tournament_20261126_003'),tables=[];
 try{for(const table of ['tournament_player_participation_claims','tournament_registration_reservations']){
  const [current,before]=await Promise.all([original.query(`SELECT to_jsonb(t) AS r FROM "${table}" t`),restored.query(`SELECT to_jsonb(t) AS r FROM "${table}" t`)]);
  const key=r=>JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='updated_at').sort(([a],[b])=>a.localeCompare(b))));
  const sorted=rows=>rows.map(v=>key(v.r)).sort();assert.deepEqual(sorted(current.rows),sorted(before.rows),'Business content must match restored data: '+table);
  const oldByContent=new Map(before.rows.map(v=>[key(v.r),v.r]));
  tables.push({table,rowsBefore:before.rowCount,rowsAfter:current.rowCount,businessContentUnchanged:true,missingRows:0,addedRows:0,onlyChangedColumn:'updated_at',updatedTimestampRows:current.rows.filter(v=>v.r.updated_at!==oldByContent.get(key(v.r)).updated_at).length});
 }
 const table='tournament_workflow_state';
 const [current,before]=await Promise.all([original.query(`SELECT to_jsonb(t) AS r FROM "${table}" t`),restored.query(`SELECT to_jsonb(t) AS r FROM "${table}" t`)]);
 const oldById=new Map(before.rows.map(v=>[v.r.tournament_id,v.r]));const changed=[];
 for(const {r}of current.rows){const old=oldById.get(r.tournament_id);assert(old,'No unrecognized workflow row');const fields=Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(old[k]));if(fields.length)changed.push({tournamentId:r.tournament_id,fields,values:fields.map(field=>({field,before:old[field],after:r[field]}))});}
 const workflow={table,rowsBefore:before.rowCount,rowsAfter:current.rowCount,changed};
 fs.writeFileSync(path.join(__dirname,'workflow-row-comparison.json'),JSON.stringify(workflow,null,2)+'\n');
 }finally{await original.end();await restored.end();}
 const result={createdAt:new Date().toISOString(),comparisonSource:'Restored pre-Prompt-4 dump in QA 003; no registration mutations were part of the squad tests',tables};
 fs.writeFileSync(path.join(__dirname,'registration-row-preservation.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
