// Read-only business backup before the additive Prompt 9 migration.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),tag=process.argv[2]||'20261128-001';
if(!/^\d{8}-\d{3}$/.test(tag))throw Error('Invalid backup tag');
const dest=path.join(root,'backups','match-operation-prompt-09-'+tag);if(fs.existsSync(dest))throw Error('Never overwrite backup');fs.mkdirSync(dest);
const env=Object.fromEntries(fs.readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1).replace(/^['"]|['"]$/g,'')];}));
const docker='C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe',run=(...args)=>cp.execFileSync(docker,args,{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
const container=run('compose','ps','-q','postgres').trim();if(!container)throw Error('Postgres container missing');
const files=[];
for(const name of ['match','scheduling','discipline','tournament','team']){
 const temp=`/tmp/prompt09-backup-${tag}-${name}.dump`,file=name+'.dump';
 run('exec',container,'pg_dump','-U',env.POSTGRES_USER,'-Fc','-d','sfl_'+name,'-f',temp);run('cp',container+':'+temp,path.join(dest,file));
 const bytes=fs.readFileSync(path.join(dest,file));files.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
 // Verify each archive can at least be read before any migration is admitted.
 run('exec',container,'pg_restore','--list',temp);console.log('Backed up and listed sfl_'+name);
}
fs.writeFileSync(path.join(dest,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),files,compose:JSON.parse('['+run('compose','ps','--format','json').trim().split(/\r?\n/).join(',')+']').map(c=>({service:c.Service,image:c.Image,container:c.ID,state:c.State,health:c.Health}))},null,2),{flag:'wx'});
console.log('Backup verified: '+dest);
