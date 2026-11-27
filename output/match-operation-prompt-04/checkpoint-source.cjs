const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),beforeDir=path.join(__dirname,'checkpoint-before'),afterDir=path.join(__dirname,'checkpoint-after');
const git=(...args)=>cp.execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifestBeforeBytes=fs.readFileSync(path.join(beforeDir,'manifest.json'));
assert.equal(sha(manifestBeforeBytes),fs.readFileSync(path.join(beforeDir,'manifest.sha256'),'utf8').trim(),'Before manifest integrity');
const before=JSON.parse(manifestBeforeBytes),head=git('rev-parse','HEAD').trim();assert.equal(head,before.head,'HEAD must be preserved');
const allowed=new Set([
 'apps/web-client/scripts/refereePortal.test.cjs','apps/web-client/src/App.tsx','apps/web-client/src/api/client.ts','apps/web-client/src/api/refereePortal.ts','apps/web-client/src/api/matchSquad.ts',
 'apps/web-client/src/components/LiveMatchCenterPanel.tsx','apps/web-client/src/components/MatchOperationsPanel.tsx','apps/web-client/src/components/BtcPreparationPanel.tsx','apps/web-client/src/components/MatchSquadEditor.tsx','apps/web-client/src/components/match-squad.css',
 'apps/web-client/src/components/referee/RefereeMatchDetailPage.tsx','apps/web-client/src/components/referee/RefereeOperationPage.tsx','apps/web-client/src/components/referee/RefereePreparationPanel.tsx',
 'packages/shared/src/index.ts','packages/shared/src/matchSquad.ts',
 'services/organization-service/src/routes/teamRoutes.ts','services/organization-service/src/controllers/matchRosterController.ts','services/organization-service/src/repositories/matchRosterRepository.ts',
 'services/match-service/src/controllers/lineupController.ts','services/match-service/src/controllers/matchController.ts','services/match-service/src/controllers/matchSquadController.ts','services/match-service/src/db/migrate.ts','services/match-service/src/db/matchSquadMigration.ts',
 'services/match-service/src/discipline/services/disciplineService.ts','services/match-service/src/repositories/lineupRepository.ts','services/match-service/src/repositories/matchSquadRepository.ts','services/match-service/src/routes/matchRoutes.ts',
 'services/match-service/src/services/lineupService.ts','services/match-service/src/services/matchOperationReadinessService.ts','services/match-service/src/services/matchService.ts','services/match-service/src/services/matchSquadService.ts','services/match-service/src/services/matchSquadValidation.ts','services/match-service/src/services/refereePortalService.ts',
 'services/match-service/tests/refereePortal.test.cjs','services/match-service/tests/matchSquad.test.cjs','scripts/qa-match-squads.cjs',
 'docs/MATCH_OPERATION_BASELINE.md','docs/MATCH_RULES_MATRIX.md','docs/MATCH_OPERATION_PROMPT_04_REPORT.md'
]);
const preserved={head,checkedAt:new Date().toISOString(),beforeCapturedPaths:before.files.length,unchanged:[],changed:[],missing:[],newlyChangedOrAdded:[]};
for(const f of before.files){const current=path.join(root,f.path),backup=path.join(beforeDir,'files',f.path);assert.equal(sha(fs.readFileSync(backup)),f.sha256,'Before copy integrity: '+f.path);if(!fs.existsSync(current)){preserved.missing.push(f.path);continue;}const h=sha(fs.readFileSync(current));(h===f.sha256?preserved.unchanged:preserved.changed).push(f.path);}
assert.equal(preserved.missing.length,0,'No pre-existing source file may be lost');assert(preserved.changed.every(f=>allowed.has(f)),'Changed pre-existing paths must stay within Prompt 4');
const names=[...new Set([...before.files.map(f=>f.path),...git('diff','--name-only','-z','HEAD').split('\0'),...git('ls-files','--others','--exclude-standard','-z').split('\0')])].filter(f=>f&&!/^(output|backups)\//.test(f)).sort();
const beforeNames=new Set(before.files.map(f=>f.path));preserved.newlyChangedOrAdded=names.filter(f=>!beforeNames.has(f));assert(preserved.newlyChangedOrAdded.every(f=>allowed.has(f)),'New dirty paths must stay within Prompt 4');
assert(!fs.existsSync(afterDir),'Refuse to overwrite an existing after checkpoint');fs.mkdirSync(path.join(afterDir,'files'),{recursive:true});const files=[];
for(const name of names){const original=path.resolve(root,name);assert(original.startsWith(root+path.sep),'Source path escaped workspace');assert(fs.existsSync(original),'Source must exist: '+name);assert(fs.statSync(original).isFile());const bytes=fs.readFileSync(original),target=path.join(afterDir,'files',name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});files.push({path:name,sha256:sha(bytes)});}
const manifest={head,createdAt:new Date().toISOString(),kind:'Source copies and diffs; not a Git commit',files},manifestBytes=JSON.stringify(manifest,null,2)+'\n';
fs.writeFileSync(path.join(afterDir,'manifest.json'),manifestBytes,{flag:'wx'});fs.writeFileSync(path.join(afterDir,'manifest.sha256'),sha(manifestBytes)+'\n',{flag:'wx'});
fs.writeFileSync(path.join(afterDir,'HEAD.txt'),head+'\n',{flag:'wx'});fs.writeFileSync(path.join(afterDir,'HEAD-to-working-tree.patch'),git('diff','--binary','HEAD'),{flag:'wx'});fs.writeFileSync(path.join(afterDir,'index.patch'),git('diff','--cached','--binary'),{flag:'wx'});fs.writeFileSync(path.join(afterDir,'status.txt'),git('status','--short'),{flag:'wx'});
for(const f of files){assert.equal(sha(fs.readFileSync(path.join(afterDir,'files',f.path))),f.sha256);assert.equal(sha(fs.readFileSync(path.join(root,f.path))),f.sha256,'Source changed during checkpoint: '+f.path);}
preserved.afterCapturedPaths=files.length;preserved.afterManifestSha256=sha(manifestBytes);preserved.allCopiesVerified=true;preserved.headUnchanged=true;
fs.writeFileSync(path.join(__dirname,'source-preservation.json'),JSON.stringify(preserved,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({before:before.files.length,unchanged:preserved.unchanged.length,changedInScope:preserved.changed.length,missing:preserved.missing.length,newDirtyPaths:preserved.newlyChangedOrAdded.length,after:files.length,manifestSha256:preserved.afterManifestSha256,headUnchanged:true}));
