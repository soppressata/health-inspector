import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from './scan.js';
import { inspectCandidates } from './inspect.js';
import { loadState, saveState } from './state.js';
import { fileReport, makeGithubClient } from './github.js';
import { notifyWebhook } from './webhook.js';
import { resolveConfig, loadConfigFile, applyProviderDefaults } from './config.js';

/**
 * Read a GitHub Actions input from the environment. Input names are mapped
 * to process.env with the INPUT_ prefix and upper-cased dashes, e.g.
 * input `api-key` -> process.env['INPUT_API-KEY'].
 * @param {string} name
 * @returns {string | undefined}
 */
export function getInput(name) {
  return process.env[`INPUT_${String(name).toUpperCase()}`];
}

function log(...args) {
  console.log('[health-inspector]', ...args);
}

function parseOwnerRepo(value) {
  const [owner, repo] = String(value || '').split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_REPOSITORY: '${value}'`);
  return { owner, repo };
}

function headRef(rootDir) {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function writeOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  const line = `${name}=${value}`;
  if (file) {
    fs.appendFileSync(file, `${line}\n`, 'utf8');
  } else {
    log(line);
  }
}

function parseWebhookHeaders(value) {
  if (!value) return {};
  let parsed;
  try { parsed = JSON.parse(value); } catch { throw new Error('Invalid webhook-headers: expected a JSON object'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid webhook-headers: expected a JSON object');
  return parsed;
}

/**
 * Read a single Action input, returning `undefined` (not '') for empty values
 * so that `resolveConfig`'s `defineFrom` falls back to file/env/default values.
 * @param {string} name
 * @returns {string | undefined}
 */
function input(name) {
  const value = getInput(name);
  return value === undefined || value === '' ? undefined : value;
}

function intInput(name) {
  const value = input(name);
  return value === undefined ? undefined : Number.parseInt(value, 10);
}

function floatInput(name) {
  const value = input(name);
  return value === undefined ? undefined : Number.parseFloat(value);
}

/**
 * Build the resolved configuration the same way the CLI does: merge Action
 * inputs (flags) > environment variables > `.health-inspector.json` >
 * defaults. Extracted from `main()` so the merge logic is unit-testable.
 *
 * @param {string} rootDir - repository root (the `paths` input resolved).
 * @returns {object} fully-resolved, validated config.
 */
export function buildActionConfig(rootDir) {
  const webhookHeadersInput = input('webhook-headers');
  const flags = {
    apiKey: input('api-key'),
    provider: input('provider'),
    baseUrl: input('base-url'),
    model: input('model'),
    maxCandidates: intInput('max-candidates'),
    probability: floatInput('probability'),
    label: input('label'),
    stateBranch: input('state-branch'),
    githubToken: input('github-token'),
    webhookUrl: input('webhook-url'),
    webhookHeaders: webhookHeadersInput ? parseWebhookHeaders(webhookHeadersInput) : undefined,
    webhookSecret: input('webhook-secret'),
    webhookSecretHeader: input('webhook-secret-header'),
    webhookTimeoutMs: intInput('webhook-timeout-ms'),
    webhookRetries: intInput('webhook-retries'),
    webhookSigningSecret: input('webhook-signing-secret'),
    webhookSignatureHeader: input('webhook-signature-header'),
    scanPaths: (() => {
      const raw = input('scan-paths');
      if (!raw) return undefined;
      return raw.split(/\s+/).map(s => s.trim()).filter(Boolean);
    })(),
  };
  return resolveConfig({
    flags,
    env: process.env,
    fileConfig: loadConfigFile(rootDir),
    defaults: {},
  });
}

/**
 * Build the timeout/retry options for the GitHub client from Action inputs.
 * Extracted so the input parsing is unit-testable.
 * @returns {{timeoutMs: number, maxRetries: number}}
 */
export function buildGithubClientOptions() {
  return {
    timeoutMs: Number.parseInt(getInput('github-request-timeout-ms') || '15000', 10),
    maxRetries: Number.parseInt(getInput('github-max-retries') || '3', 10),
  };
}

export async function main() {
  const rootDir = path.resolve(input('paths') || '.');
  const config = buildActionConfig(rootDir);
  applyProviderDefaults(config);
  const { owner, repo } = parseOwnerRepo(process.env.GITHUB_REPOSITORY);

  if (!config.apiKey) throw new Error('Missing required input: api-key');
  if (!config.githubToken) throw new Error('Missing required input: github-token');

  if (Math.random() > config.probability) {
    log('Inspection skipped this cycle (unannounced by design).');
    writeOutput('findings-count', '0');
    return;
  }

  const githubToken = config.githubToken;
  const github = makeGithubClient(githubToken, buildGithubClientOptions());
  const loaded = await loadState({ octokitLike: github, owner, repo, stateBranch: config.stateBranch });

  const candidates = await scanRepo({
    rootDir,
    sinceRef: loaded.lastScannedRef,
    maxCandidates: config.maxCandidates,
    oversizedLines: config.oversizedFunctionLines,
    rules: config.rules,
    excludeRules: config.excludeRules,
  });
  const currentRef = headRef(rootDir);

  if (candidates.length === 0) {
    log(`Clean bill of health (${currentRef}); nothing to inspect.`);
    await saveState({
      octokitLike: github,
      owner,
      repo,
      stateBranch: config.stateBranch,
      state: { ...loaded, lastScannedRef: currentRef },
    });
    writeOutput('findings-count', '0');
    return;
  }

  log(`Found ${candidates.length} candidate(s); asking the model to inspect.`);
  const { findings, reportMarkdown } = await inspectCandidates({
    candidates,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    provider: config.provider || 'openai',
  });
  const state = { ...loaded, lastScannedRef: currentRef };
  const result = await fileReport({
    octokitLike: github,
    owner,
    repo,
    label: config.label,
    reportMarkdown,
    findings,
    state,
  });
  await saveState({
    octokitLike: github,
    owner,
    repo,
    stateBranch: config.stateBranch,
    state: result.updatedState,
  });

  if (config.webhookUrl && result.newFindings && result.newFindings.length > 0) {
    const webhook = await notifyWebhook({
      url: config.webhookUrl,
      repository: `${owner}/${repo}`,
      ref: currentRef,
      findings: result.newFindings,
      reportUrl: result.issueUrl || null,
      headers: config.webhookHeaders,
      secret: config.webhookSecret,
      secretHeader: config.webhookSecretHeader,
      timeoutMs: config.webhookTimeoutMs,
      retries: config.webhookRetries,
      signingSecret: config.webhookSigningSecret,
      signatureHeader: config.webhookSignatureHeader,
    });
    writeOutput('webhook-delivered', String(Boolean(webhook.delivered)));
    if (webhook.delivered) {
      writeOutput('webhook-delivery-id', webhook.deliveryId);
    }
    if (!webhook.delivered) log(`Webhook delivery failed after ${webhook.attempts || 1} attempt(s); continuing.`);
  }

  writeOutput('findings-count', String(findings.length));
  if (result.filed && result.issueUrl) writeOutput('report-url', result.issueUrl);
  log(
    result.filed
      ? `Filed report with ${findings.length} finding(s): ${result.issueUrl}`
      : `No new findings to report (all ${findings.length} already filed).`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error('[health-inspector]', err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
