const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/report_authority_unit';process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;process.env.DISCIPLINE_DATABASE_URL=process.env.DATABASE_URL;
const scheduling=require('../dist/scheduling/repositories/matchOperationReadinessRepository'),repo=require('../dist/repositories/lineupRepository');
const {confirmSubmittedMatchReport}=require('../dist/services/lineupService');
test('BTC plus REFEREE outside the current published crew cannot confirm a report',async()=>{
 const lock=scheduling.withOperationScheduleLock,find=repo.findMatchReportById;
 scheduling.withOperationScheduleLock=async(id,task)=>task({crew:[{refereeId:'other',position:'REFEREE',isFinalAuthority:true}],publication:{positions:[],slots:[{refereeId:'other',position:'REFEREE'}],voided:false}});
 repo.findMatchReportById=async()=>({id:'report',matchId:'match'});
 try{await assert.rejects(()=>confirmSubmittedMatchReport('report',{userId:'outside',userRoles:['BTC','REFEREE']},{expectedVersion:1,operationId:'11111111-1111-4111-8111-111111111111'}),e=>e.status===403&&e.code==='REFEREE_MATCH_FORBIDDEN');}
 finally{scheduling.withOperationScheduleLock=lock;repo.findMatchReportById=find;}
});
