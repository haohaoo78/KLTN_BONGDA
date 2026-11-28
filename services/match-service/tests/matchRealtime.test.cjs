const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRealtimeReplay } = require('../dist/realtime/matchRealtime.js');

test('realtime without a cursor asks the client to use its fresh snapshot', () => {
  assert.deepEqual(classifyRealtimeReplay(null, '500', '301', 0), { kind: 'snapshot' });
});

test('realtime replays up to the configured limit in ascending cursor range', () => {
  assert.deepEqual(classifyRealtimeReplay('100', '300', '1', 200), { kind: 'replay' });
});

test('realtime requires a new snapshot when replay exceeds 200 events', () => {
  assert.deepEqual(classifyRealtimeReplay('100', '302', '1', 201), { kind: 'sync-required', reason: 'replay-limit' });
});

test('realtime requires a new snapshot when retention removed the cursor history', () => {
  assert.deepEqual(classifyRealtimeReplay('300', '500', '302', 0), { kind: 'sync-required', reason: 'retention-gap' });
});

test('realtime rejects a cursor ahead of the committed event log', () => {
  assert.deepEqual(classifyRealtimeReplay('501', '500', '302', 0), { kind: 'sync-required', reason: 'cursor-ahead' });
});
