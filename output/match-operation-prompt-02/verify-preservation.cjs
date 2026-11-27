const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '../..');
const { Pool } = require(path.join(root, 'services/match-service/node_modules/pg'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
}));
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const connect = database => new Pool({ host:'127.0.0.1',port:Number(env.POSTGRES_PORT||5432),user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD,database });
async function read(database) {
  const p=connect(database), c=await p.connect(), result={};
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables=(await c.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
    for(const {tablename:table} of tables){
      if(['sfl_schema_migrations','regulation_operation_rules','match_operation_rule_bindings','match_realtime_events'].includes(table))continue;
      if(!/^[a-z_0-9]+$/.test(table))throw Error('Invalid table');
      const keys=(await c.query("SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY a.attnum",[table])).rows.map(r=>r.attname);
      result[table]={keys,rows:(await c.query(`SELECT to_jsonb(t) AS data FROM "${table}" t`)).rows.map(r=>r.data)};
    }
    await c.query('COMMIT'); return result;
  }finally{c.release();await p.end();}
}
async function main(){
  const report={createdAt:new Date().toISOString(),comparisonBasis:'Restored backup QA clone; QA writes were isolated to new rules/binding tables and realtime logs',databases:{}};
  for(const domain of ['tournament','match']){
    const old=await read(`sfl_prompt02_qa_${domain}_20261126_002`),current=await read(`sfl_${domain}`),tables=[];
    for(const [table,before] of Object.entries(old)){
      const after=current[table], key=row=>before.keys.length?JSON.stringify(before.keys.map(k=>row[k])):canonical(row);
      const left=new Map(before.rows.map(r=>[key(r),r])),right=new Map(after.rows.map(r=>[key(r),r]));
      const changed=[],removed=[];
      for(const [id,row]of left){const next=right.get(id);if(!next){removed.push(id);continue;}const fields=Object.keys(row).filter(k=>JSON.stringify(row[k])!==JSON.stringify(next[k]));if(fields.length)changed.push({key:id,fields});}
      tables.push({table,originalRows:before.rows.length,currentRows:after.rows.length,addedRows:[...right.keys()].filter(k=>!left.has(k)).length,removedRows:removed.length,changedRows:changed.length,changes:changed});
    }
    report.databases[domain]={allOriginalRowsPreserved:tables.every(t=>!t.removedRows),allOriginalRowsUnchanged:tables.every(t=>!t.removedRows&&!t.changedRows),tables};
  }
  fs.writeFileSync(path.join(__dirname,'official-row-preservation.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.databases).map(([name,value])=>[name,{...value,tables:value.tables.filter(t=>t.addedRows||t.removedRows||t.changedRows)}]))));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
