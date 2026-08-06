import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  apiKey: undefined,
  maxCandidates: 15,
  probability: 1.0,
  paths: '.',
  label: 'health-inspector',
  stateBranch: 'health-inspector-state',
  githubToken: undefined,
  webhookUrl: undefined,
  webhookHeaders: {},
  webhookSecret: undefined,
  webhookSecretHeader: 'X-Health-Inspector-Secret',
  webhookTimeoutMs: 5000,
  webhookRetries: 3,

  webhookSignatureHeader: 'X-Health-Inspector-Signature',
  webhookSigningSecret: undefined,
  scanPaths: [],
  sinceRef: undefined,
  rules: undefined,
  excludeRules: [],
  oversizedFunctionLines: 80,
  failOn: 'all',
  stateFile: '.health-inspector/state.json',
  outboxDir: '.health-inspector/outbox',
};

const CONFIG_FILE = '.health-inspector.json';

export function loadConfigFile(cwd) {
  const file = path.resolve(cwd || process.cwd(), CONFIG_FILE);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return {};
    throw err;
  }
}

const ENV_MAP = [
  ['HEALTH_INSPECTOR_API_KEY', 'apiKey', (v) => v],
  ['HEALTH_INSPECTOR_BASE_URL', 'baseUrl', (v) => v],
  ['HEALTH_INSPECTOR_MODEL', 'model', (v) => v],
  ['HEALTH_INSPECTOR_MAX_CANDIDATES', 'maxCandidates', (v) => Number.parseInt(v, 10)],
  ['HEALTH_INSPECTOR_PROBABILITY', 'probability', (v) => Number.parseFloat(v)],
  ['HEALTH_INSPECTOR_LABEL', 'label', (v) => v],
  ['HEALTH_INSPECTOR_WEBHOOK_URL', 'webhookUrl', (v) => v],
  ['HEALTH_INSPECTOR_WEBHOOK_SECRET', 'webhookSecret', (v) => v],
  ['HEALTH_INSPECTOR_WEBHOOK_SIGNING_SECRET', 'webhookSigningSecret', (v) => v],
  ['HEALTH_INSPECTOR_STATE_FILE', 'stateFile', (v) => v],
  ['HEALTH_INSPECTOR_STATE_BRANCH', 'stateBranch', (v) => v],
  ['HEALTH_INSPECTOR_FAIL_ON', 'failOn', (v) => v],
  ['HEALTH_INSPECTOR_RULES', 'rules', (v) => v.split(',').map((s) => s.trim()).filter(Boolean)],
  ['HEALTH_INSPECTOR_EXCLUDE_RULES', 'excludeRules', (v) => v.split(',').map((s) => s.trim()).filter(Boolean)],
];

export function envToConfig(env) {
  const out = {};
  const src = env || {};
  for (const [envVar, key, transform] of ENV_MAP) {
    const raw = src[envVar];
    if (raw === undefined || raw === '') continue;
    out[key] = transform(raw);
  }
  return out;
}

function defineFrom(target, source) {
  if (!source) return target;
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

export function validateConfig(config) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('config must be an object');
  }
  if (config.maxCandidates !== undefined) {
    if (!Number.isInteger(config.maxCandidates) || config.maxCandidates <= 0) {
      throw new Error(`maxCandidates must be a positive integer, got ${config.maxCandidates}`);
    }
  }
  if (config.probability !== undefined) {
    if (typeof config.probability !== 'number' || !Number.isFinite(config.probability) || config.probability < 0 || config.probability > 1) {
      throw new Error(`probability must be a number in [0, 1], got ${config.probability}`);
    }
  }
  if (config.oversizedFunctionLines !== undefined) {
    if (!Number.isInteger(config.oversizedFunctionLines) || config.oversizedFunctionLines <= 0) {
      throw new Error(`oversizedFunctionLines must be a positive integer, got ${config.oversizedFunctionLines}`);
    }
  }
  if (config.webhookTimeoutMs !== undefined) {
    if (!Number.isInteger(config.webhookTimeoutMs) || config.webhookTimeoutMs <= 0) {
      throw new Error(`webhookTimeoutMs must be a positive integer, got ${config.webhookTimeoutMs}`);
    }
  }
  if (config.webhookRetries !== undefined) {
    if (!Number.isInteger(config.webhookRetries) || config.webhookRetries < 0) {
      throw new Error(`webhookRetries must be a non-negative integer, got ${config.webhookRetries}`);
    }
  }
  if (config.failOn !== undefined) {
    const valid = new Set(['none', 'low', 'medium', 'high', 'all']);
    if (!valid.has(config.failOn)) {
      throw new Error(`failOn must be one of none|low|medium|high|all, got ${config.failOn}`);
    }
  }
  if (config.rules !== undefined && config.rules !== null) {
    if (!Array.isArray(config.rules)) {
      throw new Error(`rules must be an array, got ${typeof config.rules}`);
    }
    if (!config.rules.every((r) => typeof r === 'string')) {
      throw new Error('rules must be an array of strings');
    }
  }
  if (config.excludeRules !== undefined && config.excludeRules !== null) {
    if (!Array.isArray(config.excludeRules)) {
      throw new Error(`excludeRules must be an array, got ${typeof config.excludeRules}`);
    }
    if (!config.excludeRules.every((r) => typeof r === 'string')) {
      throw new Error('excludeRules must be an array of strings');
    }
  }
  return config;
}

export function resolveConfig({ flags, env, fileConfig, defaults } = {}) {
  const base = Object.assign({}, DEFAULT_CONFIG, defaults || {});
  const envConfig = envToConfig(env);
  const out = Object.assign({}, base);
  defineFrom(out, fileConfig);
  defineFrom(out, envConfig);
  defineFrom(out, flags);
  validateConfig(out);
  return out;
}
