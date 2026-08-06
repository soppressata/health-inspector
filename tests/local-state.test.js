import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  DEFAULT_LOCAL_STATE,
  REPLAY_WINDOW_MS,
  loadLocalState,
  saveLocalState,
  fingerprintFinding,
  recordDelivery,
  wasDelivered,
} from '../src/local-state.js';

test('DEFAULT_LOCAL_STATE has the expected shape', () => {
  assert.deepEqual(DEFAULT_LOCAL_STATE, {
    lastScannedRef: null,
    filedFingerprints: [],
    deliveries: [],
    rules: {},
  });
  assert.equal(REPLAY_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
});

test('loadLocalState returns defaults when the file is missing', () => {
  const file = path.join(os.tmpdir(), `hi-missing-${process.pid}-${Date.now()}.json`);
  assert.deepEqual(loadLocalState(file), DEFAULT_LOCAL_STATE);
});

test('loadLocalState returns defaults when JSON is corrupt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, '.health-inspector', 'state.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ not valid json', 'utf8');
  assert.deepEqual(loadLocalState(file), DEFAULT_LOCAL_STATE);
});

test('saveLocalState then loadLocalState round-trips state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, '.health-inspector', 'state.json');
  const state = {
    lastScannedRef: 'abc123',
    filedFingerprints: ['f1', 'f2'],
    deliveries: [{ id: 'd1', timestamp: 100, payloadHash: 'h' }],
    rules: { foo: 1 },
  };
  saveLocalState(file, state);
  const loaded = loadLocalState(file);
  assert.equal(loaded.lastScannedRef, 'abc123');
  assert.deepEqual(loaded.filedFingerprints, ['f1', 'f2']);
  assert.deepEqual(loaded.deliveries, [{ id: 'd1', timestamp: 100, payloadHash: 'h' }]);
  assert.deepEqual(loaded.rules, { foo: 1 });
});

test('saveLocalState leaves no leftover temp files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, '.health-inspector', 'state.json');
  saveLocalState(file, { ...DEFAULT_LOCAL_STATE, lastScannedRef: 'r' });
  const entries = fs.readdirSync(path.dirname(file));
  assert.ok(entries.every((e) => !e.endsWith('.tmp')));
  assert.deepEqual(entries, ['state.json']);
});

test('saveLocalState creates the .health-inspector directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, '.health-inspector', 'state.json');
  assert.equal(fs.existsSync(file), false);
  saveLocalState(file, { ...DEFAULT_LOCAL_STATE, lastScannedRef: 'r' });
  assert.equal(fs.existsSync(file), true);
});

test('loadLocalState fills missing keys with defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ lastScannedRef: 'ref' }), 'utf8');
  const state = loadLocalState(file);
  assert.equal(state.lastScannedRef, 'ref');
  assert.deepEqual(state.filedFingerprints, []);
  assert.deepEqual(state.deliveries, []);
  assert.deepEqual(state.rules, {});
});

test('loadLocalState returns defaults for non-object JSON shapes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, '12345', 'utf8');
  assert.deepEqual(loadLocalState(file), DEFAULT_LOCAL_STATE);
  fs.writeFileSync(file, '["a","b"]', 'utf8');
  assert.deepEqual(loadLocalState(file), DEFAULT_LOCAL_STATE);
});

test('loadLocalState does not mutate the DEFAULT_LOCAL_STATE singleton', () => {
  const file = path.join(os.tmpdir(), `hi-missing2-${process.pid}-${Date.now()}.json`);
  const state = loadLocalState(file);
  state.filedFingerprints.push('mutated');
  assert.deepEqual(loadLocalState(file).filedFingerprints, []);
});

test('loadLocalState coerces a wrong-typed lastScannedRef to null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ lastScannedRef: 123 }), 'utf8');
  const state = loadLocalState(file);
  assert.equal(state.lastScannedRef, null);
  assert.deepEqual(state.filedFingerprints, []);
});

test('fingerprintFinding is re-exported, stable, and 12 hex chars', () => {
  const f = { file: 'src/a.js', type: 'todo_fixme', snippet: '// TODO: hi' };
  const fp = fingerprintFinding(f);
  assert.equal(fp, fingerprintFinding({ ...f }));
  assert.match(fp, /^[0-9a-f]{12}$/);
});

test('recordDelivery adds an entry with id, timestamp, and payloadHash', () => {
  const payload = { delivery_id: 'delivery-1', repository: 'o/r', ref: 'abc', findings: [] };
  const state = recordDelivery({ ...DEFAULT_LOCAL_STATE }, payload);
  assert.equal(state.deliveries.length, 1);
  const d = state.deliveries[0];
  assert.equal(d.id, 'delivery-1');
  assert.equal(typeof d.timestamp, 'number');
  assert.equal(typeof d.payloadHash, 'string');
  assert.ok(d.payloadHash.length > 0);
});

test('recordDelivery does not mutate the input state', () => {
  const payload = { delivery_id: 'd', repository: 'o/r', ref: 'r', findings: [] };
  const original = { ...DEFAULT_LOCAL_STATE };
  const next = recordDelivery(original, payload);
  assert.equal(original.deliveries.length, 0);
  assert.equal(next.deliveries.length, 1);
  assert.notEqual(next, original);
});

test('wasDelivered returns true for a recently recorded delivery', () => {
  const payload = { delivery_id: 'x' };
  const state = recordDelivery({ ...DEFAULT_LOCAL_STATE }, payload);
  assert.equal(wasDelivered(state, payload), true);
});

test('wasDelivered returns false for an unseen payload', () => {
  assert.equal(wasDelivered({ ...DEFAULT_LOCAL_STATE, deliveries: [] }, { delivery_id: 'x' }), false);
});

test('wasDelivered returns false outside the replay window', () => {
  const now = Date.now();
  const old = now - REPLAY_WINDOW_MS - 1;
  const state = { ...DEFAULT_LOCAL_STATE, deliveries: [{ id: 'd', timestamp: old, payloadHash: 'h' }] };
  assert.equal(wasDelivered(state, { delivery_id: 'd' }, now), false);
});

test('wasDelivered returns true within the replay window', () => {
  const now = Date.now();
  const recent = now - 1000;
  const state = { ...DEFAULT_LOCAL_STATE, deliveries: [{ id: 'd', timestamp: recent, payloadHash: 'h' }] };
  assert.equal(wasDelivered(state, { delivery_id: 'd' }, now), true);
});

test('wasDelivered uses makeDeliveryId when delivery_id is absent', () => {
  const payload = { repository: 'o/r', ref: 'abc', findings: [{ type: 'x', file: 'a', line: 1 }] };
  const state = recordDelivery({ ...DEFAULT_LOCAL_STATE }, payload);
  assert.equal(wasDelivered(state, payload), true);
});

test('different payloads produce distinct delivery ids', () => {
  const a = recordDelivery({ ...DEFAULT_LOCAL_STATE }, { delivery_id: 'a1' });
  const b = recordDelivery({ ...DEFAULT_LOCAL_STATE }, { delivery_id: 'a2' });
  assert.equal(a.deliveries[0].id, 'a1');
  assert.equal(b.deliveries[0].id, 'a2');
  assert.equal(wasDelivered(a, { delivery_id: 'a2' }), false);
});

test('saveLocalState handles a state with only the required keys', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  const file = path.join(dir, '.health-inspector', 'state.json');
  saveLocalState(file, { lastScannedRef: null, filedFingerprints: [], deliveries: [], rules: {} });
  const loaded = loadLocalState(file);
  assert.deepEqual(loaded, { lastScannedRef: null, filedFingerprints: [], deliveries: [], rules: {} });
});
