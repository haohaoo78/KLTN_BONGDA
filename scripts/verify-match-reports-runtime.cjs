// Read-only verification of the official Prompt 8 deployment; never emits secrets.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'output/match-operation-prompt-08/runtime-verification.json');
if (fs.existsSync(out)) throw Error('Do not overwrite deployment evidence');
const docker = 'C:/Users/win/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe';
const compose = ['compose', '-f', 'docker-compose.yml', '-f', 'output/demo-match-testing/compose.demo.yml', '--profile', 'apps'];
const run = (...args) => cp.execFileSync(docker, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
const { Pool } = require(path.join(root, 'services/match-service/node_modules/pg'));
async function main() {
  run(...compose, 'config', '--quiet');
  const containers = run(...compose, 'ps', '--format', 'json').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse).map(c => ({ service: c.Service, id: c.ID, image: c.Image, state: c.State, health: c.Health, ports: c.Ports }));
  assert(containers.every(c => c.state === 'running' && (!c.health || c.health === 'healthy')));
  const compiled = [];
  for (const relative of ['repositories/matchReportRepository.js', 'repositories/lineupRepository.js', 'controllers/lineupController.js', 'services/lineupService.js', 'db/matchReportWorkflowMigration.js']) {
    const local = sha(fs.readFileSync(path.join(root, 'services/match-service/dist', relative)));
    const deployed = run(...compose, 'exec', '-T', 'match-service', 'sha256sum', '/app/services/match-service/dist/' + relative).split(/\s/)[0];
    assert.equal(deployed, local, 'Compiled backend differs: ' + relative); compiled.push({ file: relative, sha256: local });
  }
  const index = await fetch('http://localhost:5173/').then(r => { assert(r.ok); return r.text(); });
  const assets = [];
  for (const asset of [...new Set(index.match(/\/assets\/[^"']+\.(?:js|css)/g))]) {
    const local = sha(fs.readFileSync(path.join(root, 'apps/web-client/dist', asset)));
    const deployed = sha(Buffer.from(await fetch('http://localhost:5173' + asset).then(r => { assert(r.ok); return r.arrayBuffer(); })));
    assert.equal(deployed, local, 'Served frontend differs: ' + asset); assets.push({ file: asset, sha256: local });
  }
  assert.equal(assets.length, 2);
  const health = {};
  for (const url of ['http://localhost:5173/api/health', 'http://127.0.0.1:3005/health']) {
    const response = await fetch(url); assert(response.ok, url); health[url] = { status: response.status, body: await response.json() };
  }
  const url = new URL(`postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@127.0.0.1:${env.POSTGRES_PORT || 5432}/sfl_match`);
  url.searchParams.set('options', '-c default_transaction_read_only=on');
  const p = new Pool({ connectionString: url.toString() });
  let database;
  try {
    const migration = (await p.query('SELECT version,name FROM sfl_schema_migrations WHERE version=28')).rows;
    assert.equal(migration.length, 1);
    database = { migration, reports: (await p.query('SELECT status,COUNT(*)::int AS count FROM match_reports GROUP BY status ORDER BY status')).rows, operations: (await p.query('SELECT COUNT(*)::int AS count FROM match_report_operations')).rows[0].count };
  } finally { await p.end(); }
  const result = { at: new Date().toISOString(), head: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), compose: compose.slice(1), containers, compiled, assets, health, database };
  fs.writeFileSync(out, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ containers: containers.length, healthy: containers.filter(c => c.health === 'healthy').length, compiled: compiled.length, assets: assets.length, migration: 28, reports: database.reports }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
