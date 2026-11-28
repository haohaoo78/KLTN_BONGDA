const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { parseRefereeConfiguration, effectiveRefereePositions, validateRefereeScopes, crewConfigurationIssues } = require('../dist/scheduling/services/refereeConfigurationValidation');
const { configuredCrewHasCapability, validateCrewAssignments } = require('../dist/scheduling/crewValidation');
const main = () => ({ code:'REFEREE',label:'Trọng tài chính',required:true,capabilities:['RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE'] });
const extra = (index) => ({ code:`CUSTOM_${index}`,label:`Vị trí ${index}`,required:false,capabilities:['RECORD_EVENT'] });
const parse = (configuration, expectedRevision=0) => parseRefereeConfiguration({configuration,expectedRevision});

for (const count of [1,2,3,4,5,16]) test(`accepts ${count} editable positions with a single final authority`, () => {
  const configuration = {defaultPositions:[main(),...Array.from({length:count-1},(_,i)=>extra(i))],overrides:[]};
  const result = parse(configuration);
  assert.equal(result.configuration.defaultPositions.length,count);
  assert.equal(result.configuration.defaultPositions.filter(p=>p.capabilities.includes('FINALIZE')).length,1);
  assert.doesNotThrow(()=>validateCrewAssignments(result.configuration.defaultPositions.map((position,index)=>({refereeId:`official-${index}`,position:position.code,isFinalAuthority:position.capabilities.includes('FINALIZE')})),result.configuration.defaultPositions));
});
test('rejects missing, overlapping or optional final authority and duplicate codes', () => {
  for (const positions of [[],[{...main(),capabilities:[]}],[main(),{...extra(1),capabilities:['FINALIZE']}],[{...main(),required:false}],[main(),main()]]) {
    assert.throws(()=>parse({defaultPositions:positions,overrides:[]}),{code:'REFEREE_CONFIG_INVALID'});
  }
});
test('rejects unknown capabilities, unsafe codes, stale/invalid payload shape and overlarge input', () => {
  for (const patch of [{capabilities:['ADMIN']},{code:'referee'},{label:''},{required:'true'},{admin:true}]) assert.throws(()=>parse({defaultPositions:[{...main(),...patch}],overrides:[]}),{code:'REFEREE_CONFIG_INVALID'});
  assert.throws(()=>parse({defaultPositions:[main()],overrides:[]},-1),{code:'REFEREE_CONFIG_INVALID'});
  assert.throws(()=>parse({defaultPositions:[main(),...Array.from({length:64},(_,i)=>extra(i))],overrides:[]}),{code:'REFEREE_CONFIG_INVALID'});
});
test('resolves match > round > stage > tournament and isolates stages', () => {
  const matchId=randomUUID();
  const configuration={defaultPositions:[main()],overrides:[
    {id:randomUUID(),scope:'STAGE',stage:'GROUP',positions:[main(),extra(1)]},
    {id:randomUUID(),scope:'ROUND',stage:'GROUP',roundNumber:2,positions:[main(),extra(1),extra(2)]},
    {id:randomUUID(),scope:'MATCH',matchId,positions:[main(),extra(1),extra(2),extra(3)]},
  ]};
  const normalized=parse(configuration).configuration;
  assert.equal(effectiveRefereePositions(normalized,{id:matchId,stage:'GROUP',roundNumber:2}).positions.length,4);
  assert.equal(effectiveRefereePositions(normalized,{id:randomUUID(),stage:'GROUP',roundNumber:2}).source,'ROUND');
  assert.equal(effectiveRefereePositions(normalized,{id:randomUUID(),stage:'GROUP',roundNumber:1}).source,'STAGE');
  assert.equal(effectiveRefereePositions(normalized,{id:randomUUID(),stage:'KNOCKOUT',roundNumber:2}).source,'TOURNAMENT');
  assert.doesNotThrow(()=>validateRefereeScopes(normalized,[{id:matchId,stage:'GROUP',roundNumber:2}]));
  assert.throws(()=>validateRefereeScopes(normalized,[{id:randomUUID(),stage:'KNOCKOUT',roundNumber:2}]),{code:'REFEREE_CONFIG_SCOPE_INVALID'});
});
test('rejects duplicate targets and mixed or foreign scope identifiers', () => {
  const row={id:randomUUID(),scope:'ROUND',stage:'GROUP',roundNumber:1,positions:[main()]};
  assert.throws(()=>parse({defaultPositions:[main()],overrides:[row,{...row,id:randomUUID()}]}),{code:'REFEREE_CONFIG_INVALID'});
  assert.throws(()=>parse({defaultPositions:[main()],overrides:[{...row,matchId:randomUUID()}]}),{code:'REFEREE_CONFIG_INVALID'});
  assert.throws(()=>parse({defaultPositions:[main()],overrides:[{...row,scope:'MATCH',stage:undefined,roundNumber:undefined,matchId:'invalid'}]}),{code:'REFEREE_CONFIG_INVALID'});
});
test('custom final position and independent event/report permissions are enforced', () => {
  const positions=[{...main(),code:'LEAD_OFFICIAL',label:'Người điều hành'},{...extra(1),required:true,capabilities:['MANAGE_REPORT']}];
  const crew=[{refereeId:'one',position:'LEAD_OFFICIAL',isFinalAuthority:true},{refereeId:'two',position:'CUSTOM_1',isFinalAuthority:false}];
  assert.doesNotThrow(()=>validateCrewAssignments(crew,positions));
  assert.deepEqual(crewConfigurationIssues(positions,crew),[]);
  assert.ok(crewConfigurationIssues(positions,[crew[0]]).length);
  assert.equal(configuredCrewHasCapability('CUSTOM_1',false,'MANAGE_REPORT',positions),true);
  assert.equal(configuredCrewHasCapability('CUSTOM_1',false,'RECORD_EVENT',positions),false);
  assert.equal(configuredCrewHasCapability('CUSTOM_1',false,'FINALIZE',positions),false);
  assert.equal(configuredCrewHasCapability('LEAD_OFFICIAL',false,'FINALIZE',positions),false);
  assert.equal(configuredCrewHasCapability('LEAD_OFFICIAL',true,'FINALIZE',positions),true);
  assert.equal(configuredCrewHasCapability('ADMIN',true,'READ',positions),false);
  assert.equal(configuredCrewHasCapability('REFEREE',true,'MANAGE_REPORT',null),true);
});
