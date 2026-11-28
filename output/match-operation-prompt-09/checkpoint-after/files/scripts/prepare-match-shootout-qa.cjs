const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),run=process.argv[2]||'001';assert(/^\d{3}$/.test(run));
const docker='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const call=(...args)=>cp.execFileSync(docker,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024});
const container=call('compose','ps','-q','postgres').trim();assert(container);const reuse=process.argv[3]==='reuse001',dest=path.join(root,'backups','match-operation-prompt-07-'+run);if(!reuse)fs.mkdirSync(dest,{recursive:false});
for(const domain of ['auth','user','team','tournament','match','scheduling','discipline']){const db='sfl_'+domain,qa=`sfl_prompt07_qa_${domain}_20261127_${run}`,dump=`/tmp/prompt07-${domain}-${run}.dump`;
 if(!reuse){call('exec',container,'pg_dump','-U',env.POSTGRES_USER,'-Fc','-d',db,'-f',dump);call('cp',container+':'+dump,path.join(dest,domain+'.dump'));}
 call('exec',container,'createdb','-U',env.POSTGRES_USER,qa);call('exec',container,'pg_restore','-U',env.POSTGRES_USER,'--no-owner','--exit-on-error','-d',qa,reuse?`/tmp/prompt07-${domain}-001.dump`:dump);console.log('Restored '+qa+(reuse?' from preserved backup 001':''));
}

