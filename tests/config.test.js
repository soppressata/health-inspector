import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { DEFAULT_CONFIG, loadConfigFile, resolveConfig, envToConfig, validateConfig } from '../src/config.js';

test('DEFAULT_CONFIG has the documented defaults', () => {
  assert.equal(DEFAULT_CONFIG.baseUrl, 'https://api.deepseek.com');
  assert.equal(DEFAULT_CONFIG.model, 'deepseek-chat');
  assert.equal(DEFAULT_CONFIG.maxCandidates, 15);
  assert.equal(DEFAULT_CONFIG.probability, 1.0);
  assert.equal(DEFAULT_CONFIG.paths, '.');
  assert.equal(DEFAULT_CONFIG.label, 'health-inspector');
  assert.equal(DEFAULT_CONFIG.stateBranch, 'health-inspector-state');
  assert.equal(DEFAULT_CONFIG.webhookSecretHeader, 'X-Health-Inspector-Secret');
  assert.equal(DEFAULT_CONFIG.webhookSignatureHeader, 'X-Health-Inspector-Signature');
  assert.equal(DEFAULT_CONFIG.webhookTimeoutMs, 5000);
  assert.equal(DEFAULT_CONFIG.webhookRetries, 3);
  assert.equal(DEFAULT_CONFIG.oversizedFunctionLines, 80);
  assert.equal(DEFAULT_CONFIG.failOn, 'all');
  assert.equal(DEFAULT_CONFIG.stateFile, '.health-inspector/state.json');
  assert.equal(DEFAULT_CONFIG.outboxDir, '.health-inspector/outbox');
  assert.equal(DEFAULT_CONFIG.apiKey, undefined);
  assert.equal(DEFAULT_CONFIG.githubToken, undefined);
  assert.equal(DEFAULT_CONFIG.webhookUrl, undefined);
  assert.equal(DEFAULT_CONFIG.webhookSigningSecret, undefined);
  assert.equal(DEFAULT_CONFIG.sinceRef, undefined);
  assert.equal(DEFAULT_CONFIG.rules, undefined);
  assert.deepEqual(DEFAULT_CONFIG.excludeRules, []);
  assert.deepEqual(DEFAULT_CONFIG.scanPaths, []);
});

test('loadConfigFile returns parsed object for a valid file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), JSON.stringify({ model: 'gpt-4', maxCandidates: 7 }));
  assert.deepEqual(loadConfigFile(dir), { model: 'gpt-4', maxCandidates: 7 });
});

test('loadConfigFile returns {} when the file is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  assert.deepEqual(loadConfigFile(dir), {});
});

test('loadConfigFile returns {} for invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), '{ not valid', 'utf8');
  assert.deepEqual(loadConfigFile(dir), {});
});

test('loadConfigFile returns {} for non-object JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), '["array"]', 'utf8');
  assert.deepEqual(loadConfigFile(dir), {});
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), '42', 'utf8');
  assert.deepEqual(loadConfigFile(dir), {});
});

test('envToConfig maps all known env vars with correct types', () => {
  const env = {
    HEALTH_INSPECTOR_API_KEY: 'sk-123',
    HEALTH_INSPECTOR_BASE_URL: 'https://api.example.com',
    HEALTH_INSPECTOR_MODEL: 'gemini',
    HEALTH_INSPECTOR_MAX_CANDIDATES: '42',
    HEALTH_INSPECTOR_PROBABILITY: '0.25',
    HEALTH_INSPECTOR_LABEL: 'custom-label',
    HEALTH_INSPECTOR_WEBHOOK_URL: 'https://hook.example.com',
    HEALTH_INSPECTOR_WEBHOOK_SECRET: 'secret',
    HEALTH_INSPECTOR_WEBHOOK_SIGNING_SECRET: 'signing',
    HEALTH_INSPECTOR_STATE_FILE: '/tmp/state.json',
    HEALTH_INSPECTOR_STATE_BRANCH: 'custom-branch',
    HEALTH_INSPECTOR_FAIL_ON: 'high',
    HEALTH_INSPECTOR_RULES: 'todo_fixme, secret_like',
    HEALTH_INSPECTOR_EXCLUDE_RULES: 'bare_except, oversized_function',
  };
  const cfg = envToConfig(env);
  assert.equal(cfg.apiKey, 'sk-123');
  assert.equal(cfg.baseUrl, 'https://api.example.com');
  assert.equal(cfg.model, 'gemini');
  assert.equal(cfg.maxCandidates, 42);
  assert.equal(cfg.probability, 0.25);
  assert.equal(cfg.label, 'custom-label');
  assert.equal(cfg.webhookUrl, 'https://hook.example.com');
  assert.equal(cfg.webhookSecret, 'secret');
  assert.equal(cfg.webhookSigningSecret, 'signing');
  assert.equal(cfg.stateFile, '/tmp/state.json');
  assert.equal(cfg.stateBranch, 'custom-branch');
  assert.equal(cfg.failOn, 'high');
  assert.deepEqual(cfg.rules, ['todo_fixme', 'secret_like']);
  assert.deepEqual(cfg.excludeRules, ['bare_except', 'oversized_function']);
});

test('envToConfig skips empty string values', () => {
  assert.deepEqual(envToConfig({ HEALTH_INSPECTOR_API_KEY: '' }), {});
});

test('envToConfig ignores unrelated env vars', () => {
  assert.deepEqual(envToConfig({ FOO_BAR: 'baz', HEALTH_INSPECTOR_MODEL: 'x' }), { model: 'x' });
});

test('envToConfig trims and filters comma-separated lists', () => {
  assert.deepEqual(envToConfig({ HEALTH_INSPECTOR_RULES: 'a, b , c,' }).rules, ['a', 'b', 'c']);
  assert.deepEqual(envToConfig({ HEALTH_INSPECTOR_EXCLUDE_RULES: ' , ' }).excludeRules, []);
});

test('resolveConfig returns the full default set with no overrides', () => {
  const config = resolveConfig({});
  assert.equal(config.maxCandidates, 15);
  assert.equal(config.failOn, 'all');
  assert.equal(config.oversizedFunctionLines, 80);
  assert.equal(config.webhookSignatureHeader, 'X-Health-Inspector-Signature');
  assert.equal(config.outboxDir, '.health-inspector/outbox');
  assert.equal(config.apiKey, undefined);
  assert.deepEqual(config.excludeRules, []);
  assert.deepEqual(config.scanPaths, []);
});

test('precedence: flags > env vars > file config > defaults', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), JSON.stringify({ model: 'file-model', maxCandidates: 10 }));
  const config = resolveConfig({
    flags: { model: 'flag-model' },
    env: { HEALTH_INSPECTOR_MAX_CANDIDATES: '5' },
    fileConfig: loadConfigFile(dir),
  });
  assert.equal(config.model, 'flag-model');
  assert.equal(config.maxCandidates, 5);
});

test('env beats file when no flag present', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), JSON.stringify({ model: 'file-model' }));
  const config = resolveConfig({
    env: { HEALTH_INSPECTOR_MODEL: 'env-model' },
    fileConfig: loadConfigFile(dir),
  });
  assert.equal(config.model, 'env-model');
});

test('file beats default when no env or flag', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-'));
  fs.writeFileSync(path.join(dir, '.health-inspector.json'), JSON.stringify({ maxCandidates: 9 }));
  const config = resolveConfig({ fileConfig: loadConfigFile(dir) });
  assert.equal(config.maxCandidates, 9);
});

test('an undefined flag does not clobber an env value', () => {
  const config = resolveConfig({
    flags: { apiKey: undefined },
    env: { HEALTH_INSPECTOR_API_KEY: 'env-key' },
  });
  assert.equal(config.apiKey, 'env-key');
});

test('resolveConfig validates and throws on a bad env value', () => {
  assert.throws(() => resolveConfig({ env: { HEALTH_INSPECTOR_MAX_CANDIDATES: 'abc' } }), /maxCandidates/);
  assert.throws(() => resolveConfig({ env: { HEALTH_INSPECTOR_PROBABILITY: '2' } }), /probability/);
});

test('resolveConfig accepts a custom defaults parameter', () => {
  const config = resolveConfig({ defaults: { maxCandidates: 99, label: 'x' } });
  assert.equal(config.maxCandidates, 99);
  assert.equal(config.label, 'x');
  assert.equal(config.model, DEFAULT_CONFIG.model);
});

test('validateConfig accepts the default config', () => {
  assert.doesNotThrow(() => validateConfig({ ...DEFAULT_CONFIG }));
});

test('validateConfig rejects probability out of range', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, probability: 1.5 }), /probability/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, probability: -0.1 }), /probability/);
});

test('validateConfig rejects non-positive or non-integer maxCandidates', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, maxCandidates: 0 }), /maxCandidates/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, maxCandidates: -3 }), /maxCandidates/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, maxCandidates: 2.5 }), /maxCandidates/);
});

test('validateConfig rejects invalid failOn', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, failOn: 'bogus' }), /failOn/);
  for (const v of ['none', 'low', 'medium', 'high', 'all']) {
    assert.doesNotThrow(() => validateConfig({ ...DEFAULT_CONFIG, failOn: v }));
  }
});

test('validateConfig rejects non-array rules', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, rules: 'todo_fixme' }), /rules/);
});

test('validateConfig accepts rules: undefined', () => {
  assert.doesNotThrow(() => validateConfig({ ...DEFAULT_CONFIG, rules: undefined }));
});

test('validateConfig rejects excludeRules with non-string entries', () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, excludeRules: ['ok', 3] }), /excludeRules/);
});

test('validateConfig rejects a non-object config', () => {
  assert.throws(() => validateConfig(null), /object/);
  assert.throws(() => validateConfig([]), /object/);
});

test('envToConfig returns {} for no env', () => {
  assert.deepEqual(envToConfig({}), {});
  assert.deepEqual(envToConfig(), {});
});
