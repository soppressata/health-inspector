import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { scanRepo } from './scan.js';
import { inspectCandidates } from './inspect.js';
import { loadState, saveState } from './state.js';
import { fileReport, makeGithubClient } from './github.js';
import { notifyWebhook } from './webhook.js';

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

export async function main() {
  const apiKey = getInput('api-key');
  const baseUrl = getInput('base-url') || 'https://api.deepseek.com';
  const model = getInput('model') || 'deepseek-chat';
  const probability = Number.parseFloat(getInput('probability') || '1.0');
  const maxCandidates = Number.parseInt(getInput('max-candidates') || '15', 10);
  const label = getInput('label') || 'health-inspector';
  const stateBranch = getInput('state-branch') || 'health-inspector-state';
  const githubToken = getInput('github-token');
  const webhookUrl = getInput('webhook-url');
  const rootDir = path.resolve(getInput('paths') || '.');
  const { owner, repo } = parseOwnerRepo(process.env.GITHUB_REPOSITORY);

  if (!apiKey) throw new Error('Missing required input: api-key');
  if (!githubToken) throw new Error('Missing required input: github-token');
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new Error(`Invalid probability '${getInput('probability')}': expected a number in [0, 1]`);
  }

  if (Math.random() > probability) {
    log('Inspection skipped this cycle (unannounced by design).');
    writeOutput('findings-count', '0');
    return;
  }

  const github = makeGithubClient(githubToken);
  const loaded = await loadState({ octokitLike: github, owner, repo, stateBranch });
  const candidates = await scanRepo({ rootDir, sinceRef: loaded.lastScannedRef, maxCandidates });
  const currentRef = headRef(rootDir);

  if (candidates.length === 0) {
    log(`Clean bill of health (${currentRef}); nothing to inspect.`);
    await saveState({
      octokitLike: github,
      owner,
      repo,
      stateBranch,
      state: { ...loaded, lastScannedRef: currentRef },
    });
    writeOutput('findings-count', '0');
    return;
  }

  log(`Found ${candidates.length} candidate(s); asking the model to inspect.`);
  const { findings, reportMarkdown } = await inspectCandidates({ candidates, apiKey, baseUrl, model });
  const state = { ...loaded, lastScannedRef: currentRef };
  const result = await fileReport({
    octokitLike: github,
    owner,
    repo,
    label,
    reportMarkdown,
    findings,
    state,
  });
  await saveState({
    octokitLike: github,
    owner,
    repo,
    stateBranch,
    state: result.updatedState,
  });

  if (webhookUrl && result.newFindings && result.newFindings.length > 0) {
    const webhook = await notifyWebhook({
      url: webhookUrl,
      repository: `${owner}/${repo}`,
      ref: currentRef,
      findings: result.newFindings,
      reportUrl: result.issueUrl || null,
      headers: parseWebhookHeaders(getInput('webhook-headers')),
      secret: getInput('webhook-secret'),
      secretHeader: getInput('webhook-secret-header') || 'X-Health-Inspector-Secret',
      timeoutMs: Number.parseInt(getInput('webhook-timeout-ms') || '5000', 10),
      retries: Number.parseInt(getInput('webhook-retries') || '3', 10),
    });
    writeOutput('webhook-delivered', String(Boolean(webhook.delivered)));
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
