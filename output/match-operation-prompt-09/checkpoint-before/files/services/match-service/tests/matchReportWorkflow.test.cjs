const test=require('node:test'),assert=require('node:assert/strict');
process.env.DATABASE_URL='postgresql://unused@127.0.0.1:1/report_unit';process.env.SCHEDULING_DATABASE_URL=process.env.DATABASE_URL;process.env.DISCIPLINE_DATABASE_URL=process.env.DATABASE_URL;
const {validateReportInput,sameReportScore}=require('../dist/repositories/matchReportRepository');
const id='11111111-1111-4111-8111-111111111111';
test('report score comparison survives PostgreSQL jsonb property ordering without accepting changed values',()=>{
 const current={homeScore:2,awayScore:1,homeExtraTimeScore:null,awayExtraTimeScore:null,homePenaltyScore:null,awayPenaltyScore:null};
 const reversed=Object.fromEntries(Object.entries(current).reverse());assert.equal(sameReportScore(reversed,current),true);assert.equal(sameReportScore({...reversed,awayScore:2},current),false);assert.equal(sameReportScore(null,current),false);
});
test('report weather, notes, attendance and paired concurrency fields use authoritative limits',()=>{
 const base={matchId:id,refereeId:id,weather:'x'.repeat(100),notes:'x'.repeat(2000),attendance:0,operationId:id,expectedVersion:0};assert.doesNotThrow(()=>validateReportInput(base));
 for(const patch of [{weather:'x'.repeat(101)},{notes:'x'.repeat(2001)},{attendance:-1},{attendance:1.2},{expectedVersion:-1},{operationId:'bad'},{action:'APPROVE'}])assert.throws(()=>validateReportInput({...base,...patch}),e=>e.status===400);
 assert.throws(()=>validateReportInput({matchId:id,refereeId:id,expectedVersion:1}),e=>e.code==='REPORT_CONCURRENCY_REQUIRED');
});
test('new migration keeps existing submissions and introduces transactional versioned report operations',()=>{
 const {matchReportWorkflowSql}=require('../dist/db/matchReportWorkflowMigration');assert.match(matchReportWorkflowSql,/match_report_operations/);assert.match(matchReportWorkflowSql,/append-only/);assert.doesNotMatch(matchReportWorkflowSql,/DELETE FROM|TRUNCATE|UPDATE match_reports/i);
});
