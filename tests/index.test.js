import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { getInput, buildActionConfig, buildGithubClientOptions, requiresApiKey } from '../src/index.js';
import { DEFAULT_CONFIG } from '../src/config.js';

/**
 * Save, assign, and restore process.env keys around a test body. Accepts
 * `undefined` values to explicitly clear a key.
 */
function withEnv(assign, fn) {
  const keys = Object.keys(assign);
  const saved = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(process.env, k)) saved[k] = process.env[k];
  }
  for (const [k, v] of Object.entries(assign)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(saved)) process.env[k] = v;
  }
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hi-cfg-'));
}

test('getInput maps dashed input names to INPUT_<NAME> env vars', () => {
  process.env['INPUT_API-KEY'] = 'sk-secret';
  process.env['INPUT_STATE-BRANCH'] = 'inspector-state';
  process.env['INPUT_MAX-CANDIDATES'] = '7';
  try {
    assert.equal(getInput('api-key'), 'sk-secret');
    assert.equal(getInput('state-branch'), 'inspector-state');
    assert.equal(getInput('max-candidates'), '7');
  } finally {
    delete process.env['INPUT_API-KEY'];
    delete process.env['INPUT_STATE-BRANCH'];
    delete process.env['INPUT_MAX-CANDIDATES'];
  }
});

test('getInput returns undefined for unset inputs', () => {
  delete process.env['INPUT_API-KEY'];
  assert.equal(getInput('api-key'), undefined);
});

test('buildActionConfig reads .health-inspector.json from rootDir', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, '.health-inspector.json'),
    JSON.stringify({ model: 'file-model', maxCandidates: 7, oversizedFunctionLines: 120 }),
  );
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.model, 'file-model');
  assert.equal(config.maxCandidates, 7);
  assert.equal(config.oversizedFunctionLines, 120);
});

test('buildActionConfig returns {} when the config file is missing, falling back to defaults', () => {
  const dir = tmpDir();
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.maxCandidates, DEFAULT_CONFIG.maxCandidates);
  assert.equal(config.baseUrl, DEFAULT_CONFIG.baseUrl);
  assert.equal(config.label, DEFAULT_CONFIG.label);
  assert.equal(config.stateBranch, DEFAULT_CONFIG.stateBranch);
});

test('buildActionConfig returns {} for invalid JSON in the config file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), '{ not valid', 'utf8');
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.model, DEFAULT_CONFIG.model);
});

test('buildActionConfig merges Action inputs (INPUT_* env vars)', () => {
  const dir = tmpDir();
  withEnv(
    {
      'INPUT_API-KEY': 'sk-from-input',
      'INPUT_MODEL': 'input-model',
      'INPUT_MAX-CANDIDATES': '9',
      'INPUT_PROBABILITY': '0.5',
      'INPUT_LABEL': 'custom-label',
      'INPUT_STATE-BRANCH': 'custom-state-branch',
    },
    () => {
      const config = buildActionConfig(dir);
      assert.equal(config.apiKey, 'sk-from-input');
      assert.equal(config.model, 'input-model');
      assert.equal(config.maxCandidates, 9);
      assert.equal(config.probability, 0.5);
      assert.equal(config.label, 'custom-label');
      assert.equal(config.stateBranch, 'custom-state-branch');
    },
  );
});

test('buildActionConfig precedence: inputs > env > file > defaults', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, '.health-inspector.json'),
    JSON.stringify({ model: 'file-model', maxCandidates: 10 }),
  );
  withEnv(
    {
      'INPUT_MODEL': 'input-model',
      'HEALTH_INSPECTOR_MAX_CANDIDATES': '5',
    },
    () => {
      const config = buildActionConfig(dir);
      assert.equal(config.model, 'input-model');
      assert.equal(config.maxCandidates, 5);
    },
  );
});

test('buildActionConfig flags beat env vars', () => {
  const dir = tmpDir();
  withEnv(
    {
      'INPUT_MODEL': 'flag-model',
      'HEALTH_INSPECTOR_MODEL': 'env-model',
    },
    () => {
      const config = buildActionConfig(dir);
      assert.equal(config.model, 'flag-model');
    },
  );
});

test('buildActionConfig env beats file when no input present', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, '.health-inspector.json'),
    JSON.stringify({ model: 'file-model' }),
  );
  withEnv(
    { 'HEALTH_INSPECTOR_MODEL': 'env-model' },
    () => {
      const config = buildActionConfig(dir);
      assert.equal(config.model, 'env-model');
    },
  );
});

test('buildActionConfig file beats default when no env or input', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, '.health-inspector.json'),
    JSON.stringify({ maxCandidates: 9 }),
  );
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.maxCandidates, 9);
});

test('buildActionConfig uses documented defaults (backward compatible)', () => {
  const dir = tmpDir();
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.maxCandidates, 15);
  assert.equal(config.baseUrl, 'https://api.deepseek.com');
  assert.equal(config.model, 'deepseek-chat');
  assert.equal(config.probability, 1.0);
  assert.equal(config.label, 'health-inspector');
  assert.equal(config.stateBranch, 'health-inspector-state');
  assert.equal(config.oversizedFunctionLines, 80);
  assert.deepEqual(config.excludeRules, []);
  assert.equal(config.webhookSecretHeader, 'X-Health-Inspector-Secret');
  assert.equal(config.webhookTimeoutMs, 5000);
  assert.equal(config.webhookRetries, 3);
});

test('buildActionConfig parses numeric webhook timeout/retries from inputs', () => {
  const dir = tmpDir();
  withEnv(
    {
      'INPUT_WEBHOOK-TIMEOUT-MS': '8000',
      'INPUT_WEBHOOK-RETRIES': '7',
      'INPUT_API-KEY': 'sk-x',
      'INPUT_GITHUB-TOKEN': 'ghp-x',
    },
    () => {
      const config = buildActionConfig(dir);
      assert.equal(config.webhookTimeoutMs, 8000);
      assert.equal(config.webhookRetries, 7);
      assert.equal(config.webhookSecretHeader, 'X-Health-Inspector-Secret');
    },
  );
});

test('buildActionConfig throws for an invalid probability', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_PROBABILITY': '2' }, () => {
    assert.throws(() => buildActionConfig(dir), /probability/);
  });
});

test('buildActionConfig throws for a non-integer max-candidates', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_MAX-CANDIDATES': 'abc' }, () => {
    assert.throws(() => buildActionConfig(dir), /maxCandidates/);
  });
});

test('buildActionConfig passes the webhook signing secret through', () => {
  const dir = tmpDir();
  withEnv(
    {
      'INPUT_WEBHOOK-SIGNING-SECRET': 'sign-123',
      'INPUT_WEBHOOK-SIGNATURE-HEADER': 'X-My-Signature',
    },
    () => {
      const config = buildActionConfig(dir);
      assert.equal(config.webhookSigningSecret, 'sign-123');
      assert.equal(config.webhookSignatureHeader, 'X-My-Signature');
    },
  );
});

test('buildActionConfig defaults the webhook signature header', () => {
  const dir = tmpDir();
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.webhookSigningSecret, undefined);
  assert.equal(config.webhookSignatureHeader, 'X-Health-Inspector-Signature');
});

test('buildActionConfig reads the signing secret from the HEALTH_INSPECTOR_WEBHOOK_SIGNING_SECRET env var', () => {
  const dir = tmpDir();
  withEnv({ 'HEALTH_INSPECTOR_WEBHOOK_SIGNING_SECRET': 'env-sign' }, () => {
    const config = buildActionConfig(dir);
    assert.equal(config.webhookSigningSecret, 'env-sign');
  });
});

test('buildActionConfig reads the signing secret from the config file', () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, '.health-inspector.json'),
    JSON.stringify({ webhookSigningSecret: 'file-sign' }),
  );
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.webhookSigningSecret, 'file-sign');
});

test('buildGithubClientOptions defaults to 15000ms and 3 retries', () => {
  const opts = withEnv({}, () => buildGithubClientOptions());
  assert.equal(opts.timeoutMs, 15000);
  assert.equal(opts.maxRetries, 3);
});

test('buildActionConfig reads INPUT_PROVIDER', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_PROVIDER': 'kimi' }, () => {
    const config = buildActionConfig(dir);
    assert.equal(config.provider, 'kimi');
  });
});

test('buildActionConfig parses INPUT_SCAN-PATHS into array', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_SCAN-PATHS': 'src tests' }, () => {
    const config = buildActionConfig(dir);
    assert.deepEqual(config.scanPaths, ['src', 'tests']);
  });
});

test('buildActionConfig parses INPUT_RULES into a comma-separated array', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_RULES': 'todo_fixme,secret_like' }, () => {
    const config = buildActionConfig(dir);
    assert.deepEqual(config.rules, ['todo_fixme', 'secret_like']);
  });
});

test('buildActionConfig parses INPUT_RULES with surrounding whitespace', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_RULES': ' todo_fixme ,  secret_like ' }, () => {
    const config = buildActionConfig(dir);
    assert.deepEqual(config.rules, ['todo_fixme', 'secret_like']);
  });
});

test('buildActionConfig falls back to all rules when INPUT_RULES is unset', () => {
  const dir = tmpDir();
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.rules, undefined);
});

test('buildActionConfig parses INPUT_EXCLUDE-RULES into a comma-separated array', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_EXCLUDE-RULES': 'bare_except,oversized_function' }, () => {
    const config = buildActionConfig(dir);
    assert.deepEqual(config.excludeRules, ['bare_except', 'oversized_function']);
  });
});

test('buildActionConfig parses INPUT_OVERSIZED-LINES into an int', () => {
  const dir = tmpDir();
  withEnv({ 'INPUT_OVERSIZED-LINES': '120' }, () => {
    const config = buildActionConfig(dir);
    assert.equal(config.oversizedFunctionLines, 120);
  });
});

test('buildActionConfig falls back to the default oversized-lines when unset', () => {
  const dir = tmpDir();
  const config = withEnv({}, () => buildActionConfig(dir));
  assert.equal(config.oversizedFunctionLines, 80);
});

test('requiresApiKey is required for non-opencode providers', () => {
  assert.equal(requiresApiKey({ provider: 'openai' }), true);
  assert.equal(requiresApiKey({ provider: 'claude' }), true);
});

test('requiresApiKey is bypassed for the opencode provider', () => {
  assert.equal(requiresApiKey({ provider: 'opencode' }), false);
});

test('requiresApiKey defaults to required when no provider is set', () => {
  assert.equal(requiresApiKey({}), true);
  assert.equal(requiresApiKey(undefined), true);
});

test('buildGithubClientOptions reads INPUT_GITHUB-REQUEST-TIMEOUT-MS / GITHUB-MAX-RETRIES', () => {
  withEnv(
    { 'INPUT_GITHUB-REQUEST-TIMEOUT-MS': '20000', 'INPUT_GITHUB-MAX-RETRIES': '5' },
    () => {
      const opts = buildGithubClientOptions();
      assert.equal(opts.timeoutMs, 20000);
      assert.equal(opts.maxRetries, 5);
    },
  );
});
