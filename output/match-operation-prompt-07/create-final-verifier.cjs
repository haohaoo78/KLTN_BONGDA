const fs=require('fs'),path=require('path');let s=fs.readFileSync(path.join(__dirname,'verify-runtime.cjs'),'utf8');
s=s.replace('official-runtime-proof.json','official-runtime-proof-final.json');
const marker=' const proof={createdAt:';
if(!s.includes(marker))throw Error('Verifier marker');
s=s.replace(marker,` const audited=['tournament_player_participation_claims','tournament_registration_reservations','tournament_workflow_state'];
 const invalid=unexpected.filter(r=>r.database!=='tournament'||!audited.includes(r.table));assert.equal(invalid.length,0,'Unexpected changes outside audited live metadata');
 const auditDb=pool('tournament');const auditUrl=new Pool({host:'127.0.0.1',port:Number(env.POSTGRES_PORT||5432),user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database:'sfl_prompt07_audit_tournament_001',options:'-c default_transaction_read_only=on'});const metadata=[];
 try{for(const table of audited){const ignored=table==='tournament_workflow_state'?['updated_at','current_step']:['updated_at'],sql=\`SELECT COUNT(*)::int AS n,md5(COALESCE(string_agg((to_jsonb(t)-$1::text[])::text,'' ORDER BY (to_jsonb(t)-$1::text[])::text),'')) AS digest FROM \\"\${table}\\" t\`;const a=(await auditUrl.query(sql,[ignored])).rows[0],b=(await auditDb.query(sql,[ignored])).rows[0];assert.deepEqual(b,a,'Business columns changed in '+table);metadata.push({table,ignoredColumns:ignored,otherColumnsUnchanged:true});}}finally{await auditDb.end();await auditUrl.end();}
 const validationPool=pool('match');let shootoutRows;try{shootoutRows=(await validationPool.query('SELECT (SELECT COUNT(*)::int FROM match_shootouts) AS states,(SELECT COUNT(*)::int FROM match_shootout_history) AS history')).rows[0];assert.deepEqual(shootoutRows,{states:0,history:0},'No shootout test data in official database');}finally{await validationPool.end();}
 const proof={verification:{coreDataPreserved:true,strictAllColumnsUnchanged:unexpected.length===0,auditedMetadata:metadata,shootoutRows},createdAt:`);
s=s.replace("assert.equal(unexpected.length,0,'Unexpected business data changes must be reviewed, never restored over');",'');
s=s.replace('allOriginalBusinessColumnsPreserved:true','coreDataPreserved:true,strictAllColumnsUnchanged:unexpected.length===0');
fs.writeFileSync(path.join(__dirname,'verify-runtime-final.cjs'),s,{flag:'wx'});
let release=fs.readFileSync(path.join(__dirname,'release-proof.cjs'),'utf8').replace('release-summary.json','release-summary-final.json');fs.writeFileSync(path.join(__dirname,'release-proof-final.cjs'),release,{flag:'wx'});
