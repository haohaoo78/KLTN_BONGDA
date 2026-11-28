const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parseRefereeDraft,refereeEligibility,draftCompleteness}=require('../dist/scheduling/services/refereeAssignmentValidation');
const {parseRefereeConfiguration}=require('../dist/scheduling/services/refereeConfigurationValidation');
const position={code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']};
const candidate=()=>({userId:randomUUID(),identity:{fullName:'QA',email:'qa@example.test',phone:null,accountStatus:'ACTIVE',isActive:true,emailVerified:true,roles:['REFEREE']},profile:{organization:'QA',club:'',formats:[11],positions:['REFEREE'],unavailablePeriods:[],level:'ENTRY',experienceYears:1,notes:''}});
const context=()=>({scheduleId:randomUUID(),venueId:randomUUID(),format:11,occupiedFrom:'2026-12-18T01:40:00Z',occupiedTo:'2026-12-18T04:00:00Z',minimumRestMinutes:20,travelMinutes:10,duties:[]});
test('draft parsing accepts empty and partial crews without pretending completion',()=>{
 assert.equal(draftCompleteness([],[]).complete,false,'A match without referee configuration is still incomplete');
 const input={slots:[],expectedRevision:0,configurationRevision:1,scheduleSignature:'a'.repeat(64)};
 assert.deepEqual(parseRefereeDraft(input).slots,[]);
 assert.equal(draftCompleteness([position],[]).complete,false);
 assert.equal(draftCompleteness([position],[{position:'REFEREE',refereeId:randomUUID()}]).complete,true);
});
for(const n of [1,2,3,4])test(`${n}-position model accepts partial drafts and detects required completion`,()=>{
 const positions=[position,...Array.from({length:n-1},(_,i)=>({code:`CUSTOM_${i}`,label:`Trợ lý ${i}`,required:true,capabilities:['RECORD_EVENT']}))];
 const slots=positions.map(p=>({position:p.code,refereeId:randomUUID()}));
 assert.equal(draftCompleteness(positions,slots).complete,true);
 assert.equal(draftCompleteness(positions,slots.slice(0,-1)).complete,false);
 const parsed=parseRefereeDraft({slots,expectedRevision:0,configurationRevision:1,scheduleSignature:'b'.repeat(64),matchPositions:positions});
 assert.equal(parsed.matchPositions.length,n);
});
test('draft payload cannot change schedule, publish or grant arbitrary permissions',()=>{
 const input={slots:[],expectedRevision:0,configurationRevision:1,scheduleSignature:'a'.repeat(64)};
 for(const extra of [{scheduledDate:'2026-01-01'},{venueId:randomUUID()},{publishedAt:'now'},{status:'PUBLISHED'},{refereeId:randomUUID()}])assert.throws(()=>parseRefereeDraft({...input,...extra}),{code:'REFEREE_DRAFT_INVALID'});
 for(const slots of [[{position:'REFEREE',refereeId:'invalid'}],[{position:'REFEREE',refereeId:randomUUID(),isFinalAuthority:true}]])assert.throws(()=>parseRefereeDraft({...input,slots}),{code:'REFEREE_DRAFT_INVALID'});
 const id=randomUUID();assert.throws(()=>parseRefereeDraft({...input,slots:[{position:'REFEREE',refereeId:id},{position:'SECRETARY',refereeId:id}]}),{code:'REFEREE_DRAFT_DUPLICATE'});
});
test('eligible suggestions do not create assignments or fill slots',()=>{
 const person=candidate(),ctx=context(),result=refereeEligibility(person,position,ctx);
 assert.equal(result.eligible,true);assert.equal(result.totalAssignments,0);assert.deepEqual(ctx.duties,[]);
 assert.deepEqual(draftCompleteness([position],[]).missing,['Trọng tài chính']);
});
test('inactive, unverified, wrong role, format and specialization are hard blocks',()=>{
 for(const patch of [{isActive:false},{emailVerified:false},{accountStatus:'LOCKED'},{roles:['TEAM_CAPTAIN']}]){const person=candidate();Object.assign(person.identity,patch);assert.equal(refereeEligibility(person,position,context()).eligible,false);}
 const format=candidate();format.profile.formats=[7];assert.ok(refereeEligibility(format,position,context()).issues.some(i=>i.code==='FORMAT_MISMATCH'));
 const skill=candidate();skill.profile.positions=['MATCH_SECRETARY'];assert.ok(refereeEligibility(skill,position,context()).issues.some(i=>i.code==='POSITION_MISMATCH'));
});
test('unavailability and duties use occupied time including preparation, across tournaments',()=>{
 const person=candidate(),ctx=context();person.profile.unavailablePeriods=[{id:randomUUID(),startAt:'2026-12-18T01:45:00Z',endAt:'2026-12-18T01:55:00Z',reason:'QA'}];
 assert.ok(refereeEligibility(person,position,ctx).issues.some(i=>i.code==='UNAVAILABLE'));
 person.profile.unavailablePeriods=[];
 ctx.duties=[{scheduleId:randomUUID(),matchId:randomUUID(),tournamentId:randomUUID(),refereeId:person.userId,startsAt:'2026-12-18T01:00:00Z',endsAt:'2026-12-18T01:50:00Z',venueId:randomUUID(),minimumRestMinutes:0}];
 assert.ok(refereeEligibility(person,position,ctx).issues.some(i=>i.code==='DUTY_OVERLAP'));
});
test('mandatory rest and travel use the stronger requirement of the two tournaments',()=>{
 const person=candidate(),ctx=context();ctx.duties=[{scheduleId:randomUUID(),matchId:randomUUID(),tournamentId:randomUUID(),refereeId:person.userId,startsAt:'2026-12-18T00:00:00Z',endsAt:'2026-12-18T01:10:00Z',venueId:randomUUID(),minimumRestMinutes:30}];
 assert.ok(refereeEligibility(person,position,ctx).issues.some(i=>i.code==='REST_REQUIRED'));
 ctx.duties[0].endsAt='2026-12-18T01:00:00Z';assert.equal(refereeEligibility(person,position,ctx).eligible,true);
 ctx.duties[0].scheduleId=ctx.scheduleId;assert.equal(refereeEligibility(person,position,ctx).totalAssignments,0);
});
test('custom roles match professional duties without inventing a new seed or official account',()=>{
 const person=candidate();assert.equal(refereeEligibility(person,{...position,code:'MATCH_LEAD'},context()).eligible,true);
 person.profile.positions=['MATCH_SECRETARY'];assert.equal(refereeEligibility(person,{code:'REPORT_KEEPER',label:'Biên bản',required:true,capabilities:['MANAGE_REPORT']},context()).eligible,true);
 assert.equal(refereeEligibility(person,{...position,code:'MATCH_LEAD'},context()).eligible,false);
});
test('optional positions do not block completion, and referee rest is explicitly validated',()=>{
 assert.equal(draftCompleteness([position,{code:'OPTIONAL',label:'Tùy chọn',required:false,capabilities:[]}],[{position:'REFEREE',refereeId:randomUUID()}]).complete,true);
 const config={defaultPositions:[position],overrides:[],minimumRestMinutes:30};
 assert.equal(parseRefereeConfiguration({configuration:config,expectedRevision:0}).configuration.minimumRestMinutes,30);
 assert.throws(()=>parseRefereeConfiguration({configuration:{...config,minimumRestMinutes:-1},expectedRevision:0}),{code:'REFEREE_CONFIG_INVALID'});
});
