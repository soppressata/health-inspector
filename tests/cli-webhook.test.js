import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from '../src/cli.js';
import { buildWebhookPayload, sendWebhook } from '../src/webhook.js';

test('CLI parses safe local scan options and rejects invalid caps', () => {
  const options = parseArgs(['demo', '--offline', '--format', 'json', '--max-candidates', '4']);
  assert.equal(options.rootDir, 'demo');
  assert.equal(options.offline, true);
  assert.equal(options.maxCandidates, 4);
  assert.throws(() => parseArgs(['--max-candidates', '0']), /positive integer/);
});

test('webhook payload excludes source snippets', () => {
  const payload = buildWebhookPayload({
    repository: 'owner/repo', ref: 'abc',
    findings: [{ type: 'secret_like', file: 'config.js', line: 2, severity: 'high', reason: 'credential', snippet: 'secret=real-value' }],
  });
  assert.equal(payload.findings[0].snippet, undefined);
  assert.equal(payload.findings_count, 1);
  assert.match(payload.delivery_id, /^[a-f0-9]{32}$/);
});

test('webhook retries transient failures and succeeds', async () => {
  let attempts = 0;
  const result = await sendWebhook('https://example.test/hook', { delivery_id: 'delivery-1' }, {
    retries: 1,
    fetchImpl: async () => {
      attempts += 1;
      return { ok: attempts === 2, status: attempts === 1 ? 503 : 204 };
    },
  });
  assert.equal(result.delivered, true);
  assert.equal(attempts, 2);
});
