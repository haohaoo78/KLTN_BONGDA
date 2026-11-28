const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/readiness_unit';
process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;
const {crewReadiness,assertOperationActor}=require('../dist/services/matchOperationReadinessService');
const {refereeScheduleSignature}=require('../dist/scheduling/services/refereeScheduleSignature');
const {assertCanManageMatch}=require('../dist/scheduling/authorization');
const repository=require('../dist/scheduling/repositories/matchOperationReadinessRepository');
function context(count=1){
  const schedule={id:'schedule',matchId:'match',venueId:'venue',tournamentId:'tour',scheduledDate:'2026-12-18T01:15:00Z',durationMinutes:90,status:'PUBLISHED',refereeId:null};
  const positions=Array.from({length:count},(_,i)=>({code:i?'SUPPORT_'+i:'REFEREE',label:'Position '+i,required:true,capabilities:i?['RECORD_EVENT']:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE']}));
  const crew=positions.map((p,i)=>({refereeId:'person-'+i,position:p.code,isFinalAuthority:i===0}));
  return {schedule,crew,publication:{revision:1,positions,slots:crew.map(({refereeId,position})=>({refereeId,position})),scheduleSignature:refereeScheduleSignature(schedule),voided:false},hasDraft:true,draftSlotCount:count};
}
for(const n of [1,2,3,4])test(`published configuration for ${n} official(s) is ready independently of legacy referee_id`,()=>assert.equal(crewReadiness(context(n)).valid,true));
test('a saved draft is not an official crew',()=>{const c=context();c.publication=null;assert.equal(crewReadiness(c).valid,false);});
test('a published schedule without a crew is not ready',()=>assert.equal(crewReadiness({...context(),publication:null,hasDraft:false,crew:[]}).valid,false));
test('void publication never falls back to the legacy referee_id',()=>{const c=context();c.publication.voided=true;c.schedule.refereeId='person-0';assert.equal(crewReadiness(c).valid,false);});
test('a changed kickoff invalidates the publication signature',()=>{const c=context();c.schedule.scheduledDate='2026-12-19T01:15:00Z';assert.equal(crewReadiness(c).valid,false);});
test('a missing required support position is rejected',()=>{const c=context(2);c.crew.pop();assert.equal(crewReadiness(c).valid,false);});
test('multiple final authorities are rejected',()=>{const c=context(2);c.crew[1].isFinalAuthority=true;assert.equal(crewReadiness(c).valid,false);});
test('changed active people do not inherit an earlier published crew',()=>{const c=context();c.crew[0].refereeId='replacement';assert.equal(crewReadiness(c).valid,false);});
test('duplicate person across two positions is rejected',()=>{const c=context(2);c.crew[1].refereeId=c.crew[0].refereeId;c.publication.slots[1].refereeId=c.crew[0].refereeId;assert.equal(crewReadiness(c).valid,false);});
test('locking a schedule does not change the published kickoff signature',()=>{const c=context();c.schedule.isLocked=true;assert.equal(crewReadiness(c).valid,true);});
async function withAccount(run,overrides={}){const original=global.fetch;global.fetch=async()=>({ok:true,status:200,json:async()=>({userId:'person-0',roles:['REFEREE'],isActive:true,emailVerified:true,accountStatus:'ACTIVE',...overrides})});try{await run();}finally{global.fetch=original;}}
test('one appointed final authority has the configured operation rights',()=>withAccount(()=>assert.doesNotReject(assertOperationActor(context(),'person-0','FINALIZE'))));
test('a support official cannot start a match',()=>assert.rejects(assertOperationActor(context(2),'person-1','FINALIZE'),{code:'FINAL_AUTHORITY_REQUIRED'}));
test('a replaced official loses rights immediately',()=>assert.rejects(assertOperationActor(context(),'old-person','READ'),{code:'REFEREE_MATCH_FORBIDDEN'}));
test('a locked account is denied even if its assignment remains present',()=>withAccount(()=>assert.rejects(assertOperationActor(context(),'person-0','FINALIZE'),{code:'REFEREE_ACCOUNT_INACTIVE'}),{accountStatus:'LOCKED'}));
test('BTC plus REFEREE does not bypass appointment or configured capability',async()=>{
  const original=repository.readOperationSchedule;repository.readOperationSchedule=async()=>context();
  try{await assert.rejects(assertCanManageMatch({userId:'outsider',userRoles:['BTC','REFEREE']},'match','FINALIZE'),{code:'REFEREE_MATCH_FORBIDDEN'});
    await assert.rejects(assertCanManageMatch({userId:'person-0',userRoles:['BTC']},'match','FINALIZE'),{code:'REFEREE_MATCH_FORBIDDEN'});
    await withAccount(()=>assert.doesNotReject(assertCanManageMatch({userId:'person-0',userRoles:['BTC','REFEREE']},'match','FINALIZE')));
  }finally{repository.readOperationSchedule=original;}
});
test('BTC plus REFEREE with a published READ-only position cannot record or edit events',async()=>{
 const original=repository.readOperationSchedule,c=context(2);c.publication.positions[1].capabilities=[];repository.readOperationSchedule=async()=>c;
 try{await withAccount(async()=>{await assert.doesNotReject(assertOperationActor(c,'person-1','READ'));for(const capability of ['RECORD_EVENT','EDIT_EVENT'])await assert.rejects(assertCanManageMatch({userId:'person-1',userRoles:['BTC','REFEREE']},'match',capability),{code:'EVENT_PERMISSION_REQUIRED'});},{userId:'person-1',roles:['BTC','REFEREE']});}finally{repository.readOperationSchedule=original;}
});
