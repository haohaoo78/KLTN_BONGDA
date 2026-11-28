// Read-only source backup before Prompt 11's additive Match/Scheduling migrations.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),tag=process.argv[2]||'20261128-001';
if(!/^\d{8}-\d{3}$/.test(tag))throw Error('Invalid backup tag');
const dest=path.join(root,'backups','match-operation-prompt-11-'+tag);if(fs.existsSync(dest))throw Error('Never overwrite a backup');fs.mkdirSync(dest);
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')];}));
const docker='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const run=(...args)=>cp.execFileSync(docker,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const container=run('compose','ps','-q','postgres').trim();if(!container)throw Error('Postgres container is not running');
const files=[];
for(const name of ['auth','user','team','tournament','match','scheduling','discipline']){
 const database='sfl_'+name,temp=`/tmp/prompt11-backup-${tag}-${name}.dump`,file=name+'.dump';
 run('exec',container,'pg_dump','-U',env.POSTGRES_USER,'-Fc','-d',database,'-f',temp);
 run('exec',container,'pg_restore','--list',temp);
 run('cp',container+':'+temp,path.join(dest,file));
 const bytes=fs.readFileSync(path.join(dest,file));files.push({database,file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 console.log('Backed up and verified '+database);
}
const containers=JSON.parse('['+run('compose','ps','--format','json').trim().split(/\r?\n/).join(',')+']').map(c=>({service:c.Service,image:c.Image,container:c.ID,state:c.State,health:c.Health}));
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),purpose:'pre-Prompt-11 database backup; no restore or mutation',files,containers},null,2),{flag:'wx'});
console.log('Verified backup: '+dest);
