import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  validateHeaders,
  signPayload,
  verifySignature,
  buildWebhookPayload,
  sendWebhook,
  drainOutbox,
  notifyWebhook,
} from '../src/webhook.js';
import { DEFAULT_LOCAL_STATE } from '../src/local-state.js';

test('signPayload produces a consistent 64-char hex digest', () => {
  const payload = { delivery_id: 'd1', findings: [] };
  const sig1 = signPayload(payload, 'my-secret');
  const sig2 = signPayload(payload, 'my-secret');
  assert.equal(sig1, sig2);
  assert.match(sig1, /^[0-9a-f]{64}$/);
});

test('signPayload differs for different secrets', () => {
  const payload = { delivery_id: 'd1' };
  const sig1 = signPayload(payload, 'secret-a');
  const sig2 = signPayload(payload, 'secret-b');
  assert.notEqual(sig1, sig2);
});

test('signPayload differs for different payloads', () => {
  const secret = 's';
  const a = signPayload({ delivery_id: 'a' }, secret);
  const b = signPayload({ delivery_id: 'b' }, secret);
  assert.notEqual(a, b);
});

test('verifySignature accepts a valid signature', () => {
  const payload = { delivery_id: 'd1', findings: [] };
  const secret = 'my-secret';
  const sig = signPayload(payload, secret);
  assert.equal(verifySignature(payload, secret, sig), true);
});

test('verifySignature rejects a tampered payload', () => {
  const payload = { delivery_id: 'd1', findings: [] };
  const secret = 'my-secret';
  const sig = signPayload(payload, secret);
  const tampered = { ...payload, delivery_id: 'd2' };
  assert.equal(verifySignature(tampered, secret, sig), false);
});

test('verifySignature rejects a wrong secret', () => {
  const payload = { delivery_id: 'd1' };
  const sig = signPayload(payload, 'secret-1');
  assert.equal(verifySignature(payload, 'secret-2', sig), false);
});

test('verifySignature rejects a wrong signature', () => {
  const payload = { delivery_id: 'd1' };
  assert.equal(verifySignature(payload, 'secret', signPayload({ delivery_id: 'd2' }, 'secret')), false);
});

test('verifySignature returns false for non-string signatures', () => {
  const payload = { delivery_id: 'd1' };
  assert.equal(verifySignature(payload, 'secret', undefined), false);
  assert.equal(verifySignature(payload, 'secret', null), false);
  assert.equal(verifySignature(payload, 'secret', 12345), false);
});

test('verifySignature returns a boolean for mismatched-length signatures', () => {
  const payload = { delivery_id: 'd1' };
  assert.equal(typeof verifySignature(payload, 'secret', 'short'), 'boolean');
  assert.equal(verifySignature(payload, 'secret', 'short'), false);
  assert.equal(verifySignature(payload, 'secret', ''), false);
});

test('signingSecret adds a sha256 signature header', async () => {
  const payload = { delivery_id: 'sig-test-1', findings: [] };
  let capturedHeaders = {};
  const fetchImpl = async (url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, status: 204 };
  };

  const result = await sendWebhook('https://example.test/hook', payload, {
    fetchImpl, signingSecret: 'my-secret',
  });

  assert.equal(result.delivered, true);
  assert.ok(capturedHeaders['X-Health-Inspector-Signature']);
  assert.match(capturedHeaders['X-Health-Inspector-Signature'], /^sha256=[0-9a-f]{64}$/);
  assert.equal(
    capturedHeaders['X-Health-Inspector-Signature'],
    `sha256=${signPayload(payload, 'my-secret')}`,
  );
});

test('signatureHeader can be overridden', async () => {
  const payload = { delivery_id: 'sig-test-2', findings: [] };
  let capturedHeaders = {};
  const fetchImpl = async (url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, status: 204 };
  };

  await sendWebhook('https://example.test/hook', payload, {
    fetchImpl, signingSecret: 'secret', signatureHeader: 'X-Hub-Signature-256',
  });

  assert.ok(capturedHeaders['X-Hub-Signature-256']);
  assert.equal(capturedHeaders['X-Health-Inspector-Signature'], undefined);
});

test('signatureHeader with CR/LF is rejected (prevents header injection)', async () => {
  const payload = { delivery_id: 'inj-test', findings: [] };
  const fetchImpl = async () => ({ ok: true, status: 204 });

  await assert.rejects(
    () => sendWebhook('https://example.test/hook', payload, {
      fetchImpl, signingSecret: 'secret', signatureHeader: 'X-Bad\r\nHeader',
    }),
    /invalid webhook signature header/,
  );
});

test('validateHeaders still rejects header injection', () => {
  assert.throws(() => validateHeaders({ 'X-Bad\r\nHeader': 'value' }), /invalid webhook header/);
  assert.throws(() => validateHeaders({ 'X-Bad': 'bad\r\nvalue' }), /invalid webhook header/);
  assert.throws(() => validateHeaders({ host: 'evil' }), /invalid webhook header/);
});

test('second delivery with same payload and state is skipped as replay', async () => {
  const payload = { delivery_id: 'replay-test-1', findings: [] };
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { ok: true, status: 204 };
  };
  const state = { ...DEFAULT_LOCAL_STATE };

  const first = await sendWebhook('https://example.test/hook', payload, {
    state, fetchImpl,
  });
  assert.equal(first.delivered, true);
  assert.equal(attempts, 1);
  assert.ok(first.updatedState, 'first delivery should return updatedState');
  assert.equal(first.deliveryId, 'replay-test-1');

  const second = await sendWebhook('https://example.test/hook', payload, {
    state: first.updatedState, fetchImpl,
  });
  assert.equal(second.delivered, false);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'replay');
  assert.equal(second.deliveryId, 'replay-test-1');
  assert.equal(attempts, 1);
});

test('replay detection works without explicit delivery_id (uses makeDeliveryId)', async () => {
  const payload = buildWebhookPayload({
    repository: 'o/r', ref: 'abc',
    findings: [{ type: 'todo', file: 'a.js', line: 1, severity: 'low', reason: 'x' }],
  });
  let attempts = 0;
  const fetchImpl = async () => { attempts += 1; return { ok: true, status: 204 }; };
  const state = { ...DEFAULT_LOCAL_STATE };

  const first = await sendWebhook('https://example.test/hook', payload, { state, fetchImpl });
  assert.equal(first.delivered, true);
  assert.ok(first.updatedState);

  const second = await sendWebhook('https://example.test/hook', payload, {
    state: first.updatedState, fetchImpl,
  });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'replay');
});

test('sendWebhook without state does not return updatedState (backward compatible)', async () => {
  const payload = { delivery_id: 'compat-1', findings: [] };
  const fetchImpl = async () => ({ ok: true, status: 204 });

  const result = await sendWebhook('https://example.test/hook', payload, { fetchImpl });
  assert.equal(result.delivered, true);
  assert.equal(result.updatedState, undefined);
  assert.equal(result.attempts, 1);
});

test('failed delivery writes payload to outbox', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-wh-outbox-'));
  const outboxDir = path.join(dir, 'outbox');
  const payload = { delivery_id: 'outbox-write-1', findings: [] };
  const fetchImpl = async () => ({ ok: false, status: 500 });

  const result = await sendWebhook('https://example.test/hook', payload, {
    retries: 0, fetchImpl, outboxDir,
  });

  assert.equal(result.delivered, false);
  const file = path.join(outboxDir, 'outbox-write-1.json');
  assert.equal(fs.existsSync(file), true);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(written.delivery_id, 'outbox-write-1');
});

test('failed delivery does not write to outbox when outboxDir is absent', async () => {
  const payload = { delivery_id: 'outbox-no-dir', findings: [] };
  const fetchImpl = async () => ({ ok: false, status: 500 });

  const result = await sendWebhook('https://example.test/hook', payload, {
    retries: 0, fetchImpl,
  });

  assert.equal(result.delivered, false);
});

test('drainOutbox re-delivers and removes files on success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-wh-drain-'));
  const outboxDir = path.join(dir, 'outbox');
  const payload = { delivery_id: 'drain-ok-1', findings: [] };
  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(path.join(outboxDir, 'drain-ok-1.json'), JSON.stringify(payload), 'utf8');

  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return { ok: true, status: 204 }; };

  const result = await drainOutbox(outboxDir, {
    url: 'https://example.test/hook', fetchImpl,
  });

  assert.equal(result.delivered, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.remaining, 0);
  assert.equal(fetched, 1);
  assert.equal(fs.existsSync(path.join(outboxDir, 'drain-ok-1.json')), false);
});

test('drainOutbox leaves failed files in place', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-wh-drain-fail-'));
  const outboxDir = path.join(dir, 'outbox');
  const payload = { delivery_id: 'drain-fail-1', findings: [] };
  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(path.join(outboxDir, 'drain-fail-1.json'), JSON.stringify(payload), 'utf8');

  const fetchImpl = async () => ({ ok: false, status: 500 });

  const result = await drainOutbox(outboxDir, {
    url: 'https://example.test/hook', fetchImpl, retries: 0,
  });

  assert.equal(result.delivered, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(fs.existsSync(path.join(outboxDir, 'drain-fail-1.json')), true);
});

test('drainOutbox returns zeros for a non-existent directory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-wh-drain-missing-'));
  const result = await drainOutbox(path.join(dir, 'does-not-exist'), {});
  assert.deepEqual(result, { delivered: 0, failed: 0, remaining: 0 });
});

test('drainPrevious drains outbox before the current delivery', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-wh-drain-prev-'));
  const outboxDir = path.join(dir, 'outbox');
  const oldPayload = { delivery_id: 'drain-prev-old', findings: [] };
  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(path.join(outboxDir, 'drain-prev-old.json'), JSON.stringify(oldPayload), 'utf8');

  const newPayload = { delivery_id: 'drain-prev-new', findings: [] };
  let fetched = 0;
  const fetchImpl = async () => { fetched += 1; return { ok: true, status: 204 }; };

  const result = await sendWebhook('https://example.test/hook', newPayload, {
    retries: 0, fetchImpl, outboxDir, drainPrevious: true,
  });

  assert.equal(result.delivered, true);
  assert.equal(result.deliveryId, 'drain-prev-new');
  assert.equal(fetched, 2);
  assert.equal(fs.existsSync(path.join(outboxDir, 'drain-prev-old.json')), false);
});

test('drainOutbox does not recurse into outboxDir', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-wh-no-recurse-'));
  const outboxDir = path.join(dir, 'outbox');
  const payload = { delivery_id: 'no-recurse-1', findings: [] };
  fs.mkdirSync(outboxDir, { recursive: true });
  fs.writeFileSync(path.join(outboxDir, 'no-recurse-1.json'), JSON.stringify(payload), 'utf8');

  let writeCalls = 0;
  const fetchImpl = async () => ({ ok: false, status: 500 });

  const result = await drainOutbox(outboxDir, {
    url: 'https://example.test/hook', fetchImpl, retries: 0,
  });

  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(fs.readdirSync(outboxDir).length, 1);
});

test('notifyWebhook passes through signingSecret and state', async () => {
  const findings = [{ type: 'todo_fixme', file: 'a.js', line: 1, severity: 'low', reason: 'test' }];
  let capturedHeaders = {};
  let attempts = 0;
  const fetchImpl = async (url, opts) => {
    attempts += 1;
    capturedHeaders = opts.headers;
    return { ok: true, status: 204 };
  };
  const state = { ...DEFAULT_LOCAL_STATE };

  const result = await notifyWebhook({
    url: 'https://example.test/hook', findings, signingSecret: 'secret', state, fetchImpl,
  });

  assert.equal(result.delivered, true);
  assert.ok(capturedHeaders['X-Health-Inspector-Signature']);
  assert.match(capturedHeaders['X-Health-Inspector-Signature'], /^sha256=[0-9a-f]{64}$/);
  assert.ok(result.updatedState);
  assert.equal(attempts, 1);
});

test('notifyWebhook skips when no findings', async () => {
  const result = await notifyWebhook({ url: 'https://example.test/hook', findings: [] });
  assert.equal(result.delivered, false);
  assert.equal(result.skipped, true);
});
