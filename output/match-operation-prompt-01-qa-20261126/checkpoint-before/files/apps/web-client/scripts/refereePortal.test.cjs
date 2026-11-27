const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../src');
const cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  // Environment substitution is restricted to this test loader; production uses Vite.
  const source = readFileSync(file, 'utf8').replaceAll('import.meta.env', '({})');
  const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const localRequire = (name) => {
    if (name.endsWith('.css')) return {};
    if (!name.startsWith('.')) return require(name);
    const base = path.resolve(path.dirname(file), name);
    const target = [base, `${base}.ts`, `${base}.tsx`].find((entry) => existsSync(entry));
    if (!target) throw new Error(`Missing test module ${base}`);
    return load(target);
  };
  new Function('require', 'module', 'exports', compiled)(localRequire, module, module.exports);
  return module.exports;
}
const modules = (file) => load(path.join(root, 'components/referee', file));
const matchId = '11111111-1111-4111-8111-111111111111';
const item = { match: { id: matchId, status: 'SCHEDULED', stage: 'GROUP' }, schedule: { scheduledDate: '2026-12-17T18:30:00Z' },
  home: { id: 'h', name: 'Đội A', logoUrl: null }, away: { id: 'a', name: 'Đội B', logoUrl: null },
  tournament: { id: 't', name: 'Giải sinh viên', footballFormat: 7 }, roundLabel: 'Vòng 1', groupName: 'Bảng A', venueName: 'Sân 1',
  assignment: { position: 'REFEREE', label: 'Trọng tài chính', isFinalAuthority: true, capabilities: ['READ','RECORD_EVENT','EDIT_EVENT','MANAGE_REPORT','FINALIZE'] }, result: null, report: null };

test('six referee routes resolve without matching an invalid or unrelated path', () => {
  const { parseRefereeRoute, refereePaths } = modules('refereeRoutes.ts');
  for (const page of ['overview','assignments','reports']) assert.equal(parseRefereeRoute(refereePaths[page]).page, page);
  for (const page of ['assignment','operation','report']) assert.deepEqual(parseRefereeRoute(refereePaths[page](matchId)), {page, matchId});
  assert.equal(parseRefereeRoute('/referee/assignments/not-a-match').page, 'notFound');
  assert.equal(parseRefereeRoute('/btc').page, 'notFound');
});
test('overview has four real-data metric cards and no match operation inputs', () => {
  const { RefereeOverviewPage } = modules('RefereeOverviewPage.tsx');
  const html = renderToStaticMarkup(React.createElement(RefereeOverviewPage, { items: [item], fullName: 'Tên trọng tài' }));
  assert.equal((html.match(/class="rf-metric"/g) || []).length, 4);
  assert.match(html, /Tên trọng tài/); assert.match(html, /Đội A/);
  assert.doesNotMatch(html, /<(form|input|select|textarea)\b/);
  assert.doesNotMatch(html, /Bắt đầu trận|Ghi nhận bàn thắng|LINEUP_CONFIRMED|PUBLISHED/);
});
test('assignment filters intersect all fields and use Vietnamese local calendar dates', () => {
  const { filterRefereeAssignments: filter, emptyAssignmentFilters: defaults } = modules('RefereeAssignmentsPage.tsx');
  assert.equal(filter([item], {...defaults, from:'2026-12-18',to:'2026-12-18'}).length, 1);
  for (const value of [{ search:'không tồn tại' }, {tournamentId:'other'}, {position:'OTHER'}, {status:'FINISHED'}, {to:'2026-12-17'}, {from:'2026-12-19'}]) assert.equal(filter([item], {...defaults,...value}).length, 0);
  assert.equal(filter([item], {...defaults,search:'đội a',position:'REFEREE',status:'SCHEDULED',tournamentId:'t'}).length, 1);
});
test('assignment page links details and never offers accept/refuse assignment', () => {
  const { RefereeAssignmentsPage } = modules('RefereeAssignmentsPage.tsx');
  const html = renderToStaticMarkup(React.createElement(RefereeAssignmentsPage, {items:[item]}));
  assert.match(html, /Lịch phân công/); assert.match(html, new RegExp(`/referee/assignments/${matchId}`));
  assert.doesNotMatch(html, /Chấp nhận|Từ chối nhiệm vụ|Xác nhận nhận/);
});
test('match details show identity, rules, lineup and own duty without operation forms', () => {
  const { RefereeMatchDetailPage } = modules('RefereeMatchDetailPage.tsx');
  const context = {...item, rules:{matchDurationMinutes:50,knockoutDecisionMethod:'PENALTIES_ONLY'}, crew:[{refereeId:'u',fullName:'Trọng tài thử',label:'Trọng tài chính',isFinalAuthority:true,isMe:true}],lineups:[]};
  const html=renderToStaticMarkup(React.createElement(RefereeMatchDetailPage,{context}));
  for (const text of ['Điều lệ áp dụng','Tổ trọng tài','Đội hình thi đấu','Nhiệm vụ của bạn']) assert.match(html,new RegExp(text));
  assert.match(html,/Vào không gian tác nghiệp/); assert.doesNotMatch(html,/<(form|input|select)\b|Bắt đầu trận/);
});
test('operation permissions come from capabilities and final authority, never from a role selector', () => {
  const {clockActions,canRecordEvents}=modules('refereeOperation.ts');
  const context={...item,match:{...item.match,status:'IN_PROGRESS'},clock:{phase:'FIRST_HALF',isRunning:true}};
  assert.deepEqual(clockActions(context),['PAUSE','END_PERIOD']); assert.equal(canRecordEvents(context),true);
  const assistant={...context,assignment:{...item.assignment,isFinalAuthority:false,capabilities:['READ','RECORD_EVENT']}};
  assert.deepEqual(clockActions(assistant),[]); assert.equal(canRecordEvents(assistant),true);
  const observer={...context,assignment:{...item.assignment,isFinalAuthority:false,capabilities:['READ']}};
  assert.deepEqual(clockActions(observer),[]); assert.equal(canRecordEvents(observer),false);
});
test('kickoff and decision rules constrain operation actions', () => {
  const {clockActions}=modules('refereeOperation.ts');
  const waiting={...item,match:{...item.match,status:'LINEUP_CONFIRMED'},clock:{phase:'NOT_STARTED',isRunning:false}};
  assert.deepEqual(clockActions(waiting,Date.parse('2026-01-01')),[]);
  assert.deepEqual(clockActions(waiting,Date.parse('2027-01-01')),['START_MATCH']);
  const completed={...item,match:{...item.match,stage:'KNOCKOUT',status:'IN_PROGRESS'},clock:{phase:'REGULATION_COMPLETE',isRunning:false},rules:{knockoutDecisionMethod:'PENALTIES_ONLY'}};
  assert.deepEqual(clockActions(completed),['END_MATCH','START_PENALTIES']);
  assert.deepEqual(clockActions({...completed,rules:{knockoutDecisionMethod:'EXTRA_TIME_THEN_PENALTIES'}}),['END_MATCH','START_EXTRA_TIME']);
});
test('score aggregation counts own goals against the event team and respects halftime', () => {
  const {scoreFromEvents}=modules('refereeOperation.ts');
  const events=[{eventType:'GOAL',teamId:'h',minute:10},{eventType:'OWN_GOAL',teamId:'h',minute:20},{eventType:'PENALTY_GOAL',teamId:'a',minute:60},{eventType:'RED_CARD',teamId:'h',minute:15}];
  assert.deepEqual(scoreFromEvents(events,'h','a'),{home:1,away:2});
  assert.deepEqual(scoreFromEvents(events,'h','a',25),{home:1,away:1});
});
test('event minute continues across halves and includes running delta', () => {
  const {eventMinuteForClock,clockSeconds}=modules('refereeOperation.ts');
  assert.equal(eventMinuteForClock(45*60+5*60,30),50);
  assert.equal(eventMinuteForClock(119*60,120),120);
  assert.equal(clockSeconds(61),'01:01');
});
test('operation initially shows only pre-match and no event entry forms', () => {
  const {RefereeOperationPage}=modules('RefereeOperationPage.tsx');
  const {DialogProvider}=load(path.join(root,'components/DialogProvider.tsx'));
  const context={...item,rules:{},lineups:[],events:[],crew:[],clock:{phase:'NOT_STARTED',isRunning:false,elapsedSeconds:0,version:0},playerNames:{}};
  const html=renderToStaticMarkup(React.createElement(DialogProvider,null,React.createElement(RefereeOperationPage,{context,refresh:()=>{}})));
  assert.match(html,/Chuẩn bị trận đấu/);assert.doesNotMatch(html,/rf-scoreboard|rf-event-form|rf-report-form|role="dialog"/);
  assert.doesNotMatch(html,/Chuyển nhiệm vụ|Phân công tự động/);
});
test('report list contains finished/recorded reports only and has no operation form', () => {
  const {RefereeReportsPage,reportableAssignments}=modules('RefereeReportsPage.tsx');
  assert.equal(reportableAssignments([item]).length,0);
  const finished={...item,match:{...item.match,status:'FINISHED'}};
  assert.equal(reportableAssignments([finished]).length,1);
  const html=renderToStaticMarkup(React.createElement(RefereeReportsPage,{items:[finished]}));
  assert.match(html,/Xem biên bản/);assert.doesNotMatch(html,/rf-event-form|Bắt đầu trận|rf-scoreboard/);
});
test('report detail is read-only and does not invent a report before the match', () => {
  const {RefereeReportDetailPage}=modules('RefereeReportsPage.tsx');
  const context={...item,rules:{},lineups:[],events:[],crew:[],clock:{phase:'NOT_STARTED',isRunning:false,elapsedSeconds:0,version:0},playerNames:{}};
  const html=renderToStaticMarkup(React.createElement(RefereeReportDetailPage,{context}));
  assert.match(html,/Biên bản chưa được gửi/);assert.doesNotMatch(html,/<(form|input|textarea)\b|Xác nhận kết quả &amp;/);
});
test('live operation shows capability tools with event modal closed initially', () => {
  const {RefereeOperationPage}=modules('RefereeOperationPage.tsx');const {DialogProvider}=load(path.join(root,'components/DialogProvider.tsx'));
  const context={...item,match:{...item.match,status:'IN_PROGRESS'},rules:{},lineups:[],events:[],crew:[],clock:{phase:'FIRST_HALF',isRunning:true,elapsedSeconds:60,totalElapsedSeconds:60,version:1},playerNames:{}};
  const render=(value)=>renderToStaticMarkup(React.createElement(DialogProvider,null,React.createElement(RefereeOperationPage,{context:value,refresh:()=>{}})));
  const html=render(context);assert.match(html,/rf-scoreboard/);assert.match(html,/Ghi nhận diễn biến/);assert.match(html,/Kết thúc hiệp/);assert.doesNotMatch(html,/rf-event-form|rf-report-form|Chuẩn bị trận đấu/);
  const observer=render({...context,assignment:{...item.assignment,isFinalAuthority:false,capabilities:['READ']}});
  assert.doesNotMatch(observer,/Kết thúc hiệp|Ghi nhận diễn biến<|>Bàn thắng</);assert.match(observer,/chỉ cho phép theo dõi/);
});
test('post-match draft is initialized from recorded events and has no live toolbox', () => {
  const {RefereeOperationPage}=modules('RefereeOperationPage.tsx');const {DialogProvider}=load(path.join(root,'components/DialogProvider.tsx'));
  const context={...item,match:{...item.match,status:'FINISHED'},rules:{matchDurationMinutes:50},lineups:[],events:[{id:'g',teamId:'h',eventType:'GOAL',minute:10}],crew:[],clock:{phase:'ENDED',isRunning:false,elapsedSeconds:1500,totalElapsedSeconds:3000,version:5},playerNames:{}};
  const html=renderToStaticMarkup(React.createElement(DialogProvider,null,React.createElement(RefereeOperationPage,{context,refresh:()=>{}})));
  assert.match(html,/rf-report-form/);assert.match(html,/Lưu nháp kết quả/);assert.match(html,/Xác nhận kết quả &amp; biên bản/);assert.doesNotMatch(html,/rf-toolbox|rf-event-form|rf-scoreboard/);
});
test('crew detail handles one to more than four people without creating new duty enums', () => {
  const {RefereeCrewCard}=modules('RefereeMatchDetailPage.tsx');
  for(const count of [1,2,3,4,5]){const crew=Array.from({length:count},(_,index)=>({refereeId:`u${index}`,fullName:`Người ${index}`,label:`Vị trí ${index}`,isMe:index===0,isFinalAuthority:index===0}));const html=renderToStaticMarkup(React.createElement(RefereeCrewCard,{context:{...item,crew}}));assert.equal((html.match(/<li /g)||[]).length,count);assert.equal((html.match(/class="is-me"/g)||[]).length,1);}
});
module.exports = { load, modules, item, matchId };
