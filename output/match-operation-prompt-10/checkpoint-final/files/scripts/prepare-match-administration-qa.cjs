// Prompt 10 QA: restore the preserved pre-reset business dataset into NEW databases.
// Never mutates or drops an official database; every destination name is guarded.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),run=process.argv[2]||'001';assert(/^\d{3}$/.test(run));
const docker='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const call=(...args)=>cp.execFileSync(docker,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
const container=call('compose','ps','-q','postgres').trim();assert(container);
for(const domain of ['auth','user','team','tournament','match','scheduling','discipline']){
 const qa=`sfl_prompt10_qa_${domain}_20261128_${run}`;assert(/^sfl_prompt10_qa_[a-z]+_20261128_\d{3}$/.test(qa));
 const dump=path.join(root,'backups','match-operation-prompt-07-001',domain+'.dump');assert(fs.existsSync(dump));
 const temp=`/tmp/prompt10-${domain}-${run}.dump`;
 call('cp',dump,container+':'+temp);call('exec',container,'createdb','-U',env.POSTGRES_USER,qa);
 call('exec',container,'pg_restore','-U',env.POSTGRES_USER,'--no-owner','--exit-on-error','-d',qa,temp);
 console.log('Restored '+qa+' from preserved Prompt 7 backup; original database unchanged');
}
