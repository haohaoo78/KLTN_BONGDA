// Read-only release verification. Credentials are read privately, never saved in evidence.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const { Pool } = require(path.join(root, 'services/match-service/node_modules/pg'));
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => {
  const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')];
}));
const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'database-before.json'), 'utf8'));
const url = 'http://localhost:5173';
function pool(database) { return new Pool({ host: '127.0.0.1', port: Number(env.POSTGRES_PORT || 5432), user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database }); }
async function databaseProof(database, prior, versions, table) {
  const p = pool(database), c = await p.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const migrations = (await c.query('SELECT version,name FROM sfl_schema_migrations WHERE version=ANY($1::int[]) ORDER BY version', [versions])).rows;
    assert.equal(migrations.length, versions.length);
    const rows = (await c.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    assert.equal(rows, 0, 'Official supplements/bindings must not be auto-created');
    const comparison = [];
    for (const [name, value] of Object.entries(prior)) {
      assert(/^[a-z_0-9]+$/.test(name));
      const current = (await c.query(`SELECT count(*)::int AS rows, md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) AS digest FROM "${name}" t`)).rows[0];
      comparison.push({ table: name, unchanged: JSON.stringify(current) === JSON.stringify(value), rowsBefore: value.rows, rowsAfter: current.rows });
    }
    const supplemental = database === 'sfl_match' ? { existingClockMatchIds: (await c.query('SELECT match_id FROM match_clock_states ORDER BY match_id')).rows.map(r => r.match_id) } : {};
    await c.query('COMMIT');
    return { migrations, newTable: table, rows, allOriginalTablesUnchanged: comparison.every(c => c.unchanged), comparison, ...supplemental };
  } finally { c.release(); await p.end(); }
}
function password() {
  for (const name of ['DEMO_ACCOUNTS_AND_TESTING.md', 'DEMO_TEST_ACCOUNTS.md', 'DEMO_ACCOUNT_CREDENTIALS.csv']) {
    const m = fs.readFileSync(path.join(root, 'docs', name), 'utf8').match(/Demo@\d{6}/);
    if (m) return m[0];
  }
  throw Error('No documented account credential');
}
async function login(email) {
  const r = await fetch(url + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: password() }) });
  assert.equal(r.status, 200, 'Normal Auth login');
  return r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
async function get(cookie, endpoint) {
  const r = await fetch(url + '/api' + endpoint, { headers: { cookie } });
  const body = await r.json();
  assert.equal(r.status, 200, endpoint + ' must return 200');
  return body;
}
async function main() {
  if (process.argv.includes('--browser-session')) {
    const cookie = await login('dataset.captain02@football.local');
    process.stdout.write(JSON.stringify({ cookie }));
    return;
  }
  const databases = {
    sfl_tournament: await databaseProof('sfl_tournament', before.tournament, [26, 27], 'regulation_operation_rules'),
    sfl_match: await databaseProof('sfl_match', before.match, [22], 'match_operation_rule_bindings')
  };
  fs.writeFileSync(path.join(__dirname, 'official-database-proof.json'), JSON.stringify({ createdAt: new Date().toISOString(), databases }, null, 2));
  const cookie = await login('dataset.btc01@football.local');
  const ids = [
    ['ROUND_ROBIN', '248006af-5af3-4ff5-8486-47b80fc269b9', 12, 'MISSING_DRAW_SNAPSHOT', null],
    ['KNOCKOUT', 'd9fe5a04-5e71-41ec-b85c-f4567b294c68', 15, 'MISSING_DRAW_SNAPSHOT', null],
    ['HYBRID', '9f765a91-b8ab-4716-a083-0cf8a113db1b', 31, 'DRAW_SNAPSHOT', 1]
  ];
  const tournaments = [];
  for (const [format, id, count, source, version] of ids) {
    const versions = await get(cookie, `/tournaments/${id}/regulation-operation-rules`);
    assert.equal(versions.versions.length, 0);
    const candidates = await get(cookie, `/tournaments/${id}/fixtures/operation-rules`);
    assert.equal(candidates.matches.length, count);
    const first = candidates.matches[0];
    const effective = await get(cookie, `/matches/${first.matchId}/operation-rules`);
    assert.equal(effective.rules.base.source, source);
    assert.equal(effective.rules.base.regulationVersion, version);
    assert.equal(effective.rules.supplement, null);
    tournaments.push({ format, tournamentId: id, matches: count, supplementCount: 0, source, baseVersion: version, missingClockRules: effective.rules.missing.CLOCK.length, status: 'PASS' });
  }
  const refereeCookie = await login('dataset.captain02@football.local');
  const workspace = await get(refereeCookie, '/my/schedules/workspace');
  const readable = workspace.items.find(item => databases.sfl_match.existingClockMatchIds.includes(item.match.id));
  let contextMatchesRulesApi = 'NOT TESTED - no assigned match with an existing clock';
  if (readable) {
    const effective = await get(refereeCookie, `/matches/${readable.match.id}/operation-rules`);
    const context = await get(refereeCookie, `/matches/${readable.match.id}/referee-context`);
    assert.deepEqual(context.operationRules, effective.rules, 'Context and rule API must resolve identically');
    contextMatchesRulesApi = true;
  }
  const html = await (await fetch(url + '/referee')).text();
  const script = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  assert(script, 'Production JS entry');
  const asset = Buffer.from(await (await fetch(url + script[1])).arrayBuffer());
  const local = fs.readFileSync(path.join(root, 'apps/web-client/dist', script[1]));
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  assert.equal(digest(asset), digest(local), 'Runtime bundle must match final local build');
  const proof = { createdAt: new Date().toISOString(), baseUrl: url, tournaments, contextMatchesRulesApi, refereeWorkspaceCount: workspace.items.length, asset: script[1], assetSha256: digest(asset), localBuildMatchesRuntime: true };
  fs.writeFileSync(path.join(__dirname, 'runtime-api-proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify({ tournaments, contextMatchesRulesApi, localBuildMatchesRuntime: true, allOriginalTablesUnchanged: Object.values(databases).every(d => d.allOriginalTablesUnchanged), changedTables: Object.entries(databases).flatMap(([db, d]) => d.comparison.filter(t => !t.unchanged).map(t => ({ database: db, ...t }))), officialSupplementsAndBindings: 0, refereeWorkspaceCount: workspace.items.length, readableMatchId: readable?.match.id ?? null, existingClockMatchIds: databases.sfl_match.existingClockMatchIds }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
