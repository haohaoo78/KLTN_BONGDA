const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {parseRefereePublication,parseRefereeReplacement}=require('../dist/scheduling/services/refereePublicationValidation');
const selection=()=>({matchId:randomUUID(),expectedRevision:2,configurationRevision:6,scheduleSignature:'a'.repeat(64)});
test('official publication rejects zero people even though draft configuration validation allows it',()=>{
 const {validateOfficialRefereeCrew}=require('../dist/scheduling/services/refereePublicationValidation');const positions=[{code:'REFEREE',label:'Chính',required:true,capabilities:['FINALIZE']}];
 assert.throws(()=>validateOfficialRefereeCrew(positions,[]),{code:'REFEREE_CONFIG_ASSIGNMENT_CONFLICT'});assert.throws(()=>validateOfficialRefereeCrew([],[]),{code:'REFEREE_CONFIG_ASSIGNMENT_CONFLICT'});
 assert.doesNotThrow(()=>validateOfficialRefereeCrew(positions,[{position:'REFEREE',refereeId:randomUUID()}]));
});
test('publication scope is explicit, canonical and contains only saved revisions',()=>{
 const matches=[selection(),selection()];const result=parseRefereePublication({requestId:randomUUID(),matches});assert.equal(result.matches.length,2);assert.deepEqual(result.matches.map(x=>x.matchId),matches.map(x=>x.matchId).sort());
});
test('publication rejects empty/duplicate scope, protected fields and unsaved revisions',()=>{
 const row=selection(),requestId=randomUUID();for(const body of [{requestId,matches:[]},{requestId,matches:[row,row]},{requestId,matches:[{...row,expectedRevision:0}]},{requestId,matches:[{...row,status:'PUBLISHED'}]},{requestId,matches:[row],force:true},{requestId,matches:[{...row,scheduleSignature:'invalid'}]}])assert.throws(()=>parseRefereePublication(body));
});
test('replacement requires a different person, a reason and the exact official revision',()=>{
 const body={requestId:randomUUID(),expectedPublicationRevision:1,scheduleSignature:'b'.repeat(64),position:'REFEREE',oldRefereeId:randomUUID(),newRefereeId:randomUUID(),reason:' Thay theo quyết định BTC '};
 assert.equal(parseRefereeReplacement(body).reason,'Thay theo quyết định BTC');for(const extra of [{reason:''},{reason:'x'.repeat(1001)},{newRefereeId:body.oldRefereeId},{expectedPublicationRevision:0},{scheduledDate:'2027-01-01'},{position:'invalid code'}])assert.throws(()=>parseRefereeReplacement({...body,...extra}));
});
