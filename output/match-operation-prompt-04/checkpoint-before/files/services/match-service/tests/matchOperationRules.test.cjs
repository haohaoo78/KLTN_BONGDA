const test=require('node:test');const assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/rules_unit';
process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;
const {resolveMatchOperationRules,selectMatchLaw}=require('@sfl/shared');
const {assertRuleOperation,assertClockRuleAction,assertResultRulePolicy}=require('../dist/services/matchOperationRulesService');
function resolved(method='PENALTIES_ONLY',stage='KNOCKOUT'){
  const rules=selectMatchLaw('IFAB_2026_27');Object.assign(rules.values,{halfTimeMinutes:10,groupDrawPolicy:'ALLOW_DRAW'});
  return resolveMatchOperationRules({regulationVersion:1,footballFormat:11,competitionFormat:'GROUP_AND_KNOCKOUT',rankingCriteria:[],rules:{matchDurationMinutes:90,knockoutDecisionMethod:method,extraTimeMinutes:30}},{id:'v1',rules},stage);
}
test('penalty-only knockout cannot start extra time',()=>assert.throws(()=>assertClockRuleAction(resolved(),'START_EXTRA_TIME','REGULATION_COMPLETE'),{code:'EXTRA_TIME_NOT_ALLOWED'}));
test('extra-time knockout cannot skip directly to penalties',()=>{assert.throws(()=>assertClockRuleAction(resolved('EXTRA_TIME_THEN_PENALTIES'),'START_PENALTIES','REGULATION_COMPLETE'),{code:'EXTRA_TIME_REQUIRED'});assert.doesNotThrow(()=>assertClockRuleAction(resolved('EXTRA_TIME_THEN_PENALTIES'),'START_PENALTIES','EXTRA_TIME_COMPLETE'));});
test('group draw permits neither extra time nor shootout',()=>{const r=resolved('EXTRA_TIME_THEN_PENALTIES','GROUP');assert.throws(()=>assertClockRuleAction(r,'START_EXTRA_TIME'),{code:'EXTRA_TIME_NOT_ALLOWED'});assert.throws(()=>assertClockRuleAction(r,'START_PENALTIES'),{code:'SHOOTOUT_NOT_ALLOWED'});});
test('unknown substitution rules do not prevent known clock operation',()=>{const r=resolved();assert.doesNotThrow(()=>assertRuleOperation(r,'CLOCK'));assert.throws(()=>assertRuleOperation(r,'SUBSTITUTION'),{code:'MATCH_RULES_UNDEFINED'});});
test('missing rulebook is not treated as a default allowed configuration',()=>{const r=resolveMatchOperationRules({regulationVersion:1,footballFormat:5,competitionFormat:'ROUND_ROBIN',rankingCriteria:[],rules:{}},null,'GROUP');assert.throws(()=>assertClockRuleAction(r,'START_MATCH','NOT_STARTED'),{code:'MATCH_RULES_UNDEFINED'});});
test('result checks use stage rules, not a generic tournament knockout flag',()=>{assert.doesNotThrow(()=>assertResultRulePolicy(resolved('EXTRA_TIME_THEN_PENALTIES','GROUP'),{homeScore:0,awayScore:0},true));assert.throws(()=>assertResultRulePolicy(resolved(),{homeScore:0,awayScore:0,homeExtraTimeScore:0,awayExtraTimeScore:0}),{code:'EXTRA_TIME_NOT_ALLOWED'});assert.throws(()=>assertResultRulePolicy(resolved(),{homeScore:0,awayScore:0},true),{code:'MATCH_WINNER_REQUIRED'});});
test('rule application rejects draft fixtures before reading or writing a supplement',async()=>{
  const db=require('../dist/lib/db'),original=db.getPool;
  const queries=[];db.getPool=()=>({connect:async()=>({release(){},query:async(sql)=>{queries.push(sql);if(sql.includes('m.tournament_id'))return{rowCount:1,rows:[{id:'match',tournament_id:'tour',publication_status:'DRAFT'}]};return{rowCount:0,rows:[]};}})});
  try{await assert.rejects(require('../dist/services/matchOperationRulesService').applyOperationRuleVersion({tournamentId:'tour',supplementId:'version',matches:[{matchId:'match',expectedBindingRevision:0}],reason:'QA draft rejection',actorId:'actor'}),{code:'PUBLISHED_FIXTURES_REQUIRED'});assert.equal(queries.some(s=>s.startsWith('INSERT')),false);assert.ok(queries.includes('ROLLBACK'));}finally{db.getPool=original;}
});
test('missing historical snapshot is explicit unknown data, not a current-rules fallback',async()=>{
  const original=global.fetch;global.fetch=async()=>({ok:true,status:200,json:async()=>({base:{regulationVersion:null,footballFormat:5,competitionFormat:null,rankingCriteria:[],rules:null,source:'MISSING_DRAW_SNAPSHOT'},supplement:null})});
  const query={query:async(sql)=>sql.includes('FROM matches')?{rowCount:1,rows:[{id:'match',tournament_id:'tour',draw_version_id:'draw',stage:'GROUP',regulation_version:null,publication_status:'PUBLISHED'}]}:{rowCount:0,rows:[]}};
  try{const r=await require('../dist/services/matchOperationRulesService').getEffectiveMatchRules('match',query);assert.equal(r.base.regulationVersion,null);assert.equal(r.base.rules,null);assert.ok(r.missing.CLOCK.length);}finally{global.fetch=original;}
});
test('upstream failure stays an error instead of returning an empty or fabricated rule source',async()=>{
  const original=global.fetch;global.fetch=async()=>{throw Error('Unavailable')};const query={query:async(sql)=>sql.includes('FROM matches')?{rowCount:1,rows:[{id:'match',tournament_id:'tour',draw_version_id:'draw',stage:'GROUP',regulation_version:1}]}:{rowCount:0,rows:[]}};
  try{await assert.rejects(require('../dist/services/matchOperationRulesService').getEffectiveMatchRules('match',query),{code:'MATCH_RULES_UNAVAILABLE'});}finally{global.fetch=original;}
});
