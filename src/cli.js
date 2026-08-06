import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { resolveConfig, loadConfigFile } from './config.js';
import { runInspection } from './core.js';
import {
  loadLocalState,
  saveLocalState,
  recordDelivery,
  wasDelivered,
  fingerprintFinding,
} from './local-state.js';
import { notifyWebhook, buildWebhookPayload } from './webhook.js';
import { formatResult } from './output.js';

function usageError(message) {
  return Object.assign(new Error(message), { code: 2 });
}

function parseJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err instanceof SyntaxError)) return {};
    throw err;
  }
}

const VALUE_OPTIONS = new Map([
  ['--config', 'configPath'],
  ['--format', 'format'],
  ['--max-candidates', 'maxCandidates'],
  ['--model', 'model'],
  ['--base-url', 'baseUrl'],
  ['--api-key', 'apiKey'],
  ['--since', 'sinceRef'],
  ['--fail-on', 'failOn'],
  ['--rules', 'rules'],
  ['--exclude-rules', 'excludeRules'],
  ['--oversized-lines', 'oversizedFunctionLines'],
  ['--webhook-url', 'webhookUrl'],
  ['--webhook-signing-secret', 'webhookSigningSecret'],
  ['--webhook-signature-header', 'webhookSignatureHeader'],
  ['--state-file', 'stateFile'],
  ['--outbox-dir', 'outboxDir'],
]);

const BOOL_OPTIONS = new Map([
  ['--dry-run', 'dryRun'],
  ['--offline', 'offline'],
]);

const VALID_FORMATS = new Set(['json', 'markdown', 'sarif', 'github-annotation']);
const VALID_FAIL_ON = new Set(['none', 'low', 'medium', 'high', 'all']);

export function parseArgs(argv = []) {
  const options = { rootDir: '.', format: 'markdown', redact: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--include-snippets') {
      options.redact = false;
      continue;
    }
    if (BOOL_OPTIONS.has(arg)) {
      options[BOOL_OPTIONS.get(arg)] = true;
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw usageError(`${arg} requires a value`);
      options[VALUE_OPTIONS.get(arg)] = value;
      continue;
    }
    if (arg.startsWith('-')) throw usageError(`Unknown option: ${arg}`);
    if (options.rootDir !== '.') throw usageError('Only one repository path may be supplied');
    options.rootDir = arg;
  }

  if (!VALID_FORMATS.has(options.format)) {
    throw usageError('--format must be one of json, markdown, sarif, github-annotation');
  }
  if (options.maxCandidates !== undefined) {
    options.maxCandidates = Number(options.maxCandidates);
    if (!Number.isInteger(options.maxCandidates) || options.maxCandidates <= 0) {
      throw usageError('--max-candidates must be a positive integer');
    }
  }
  if (options.oversizedFunctionLines !== undefined) {
    options.oversizedFunctionLines = Number(options.oversizedFunctionLines);
    if (!Number.isInteger(options.oversizedFunctionLines) || options.oversizedFunctionLines <= 0) {
      throw usageError('--oversized-lines must be a positive integer');
    }
  }
  if (options.failOn !== undefined && !VALID_FAIL_ON.has(options.failOn)) {
    throw usageError('--fail-on must be one of none|low|medium|high|all');
  }
  if (options.rules !== undefined) {
    options.rules = options.rules.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (options.excludeRules !== undefined) {
    options.excludeRules = options.excludeRules.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return options;
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const FAIL_THRESHOLDS = { none: Infinity, low: 1, medium: 2, high: 3, all: 1 };

export function exitCodeFor(findings, failOn) {
  const threshold = FAIL_THRESHOLDS[failOn];
  if (!threshold || !findings || findings.length === 0) return 0;
  if (threshold === Infinity) return 0;
  return findings.some((f) => (SEVERITY_RANK[f.severity] || 0) >= threshold) ? 1 : 0;
}

function gitRemoteRepo(rootDir) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    const match = url.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    return match ? `${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const flags = parseArgs(argv);

    if (flags.help) {
      io.stdout.write(
        'Usage: health-inspector [path] [options]\n\n' +
          'Outputs:  --format json|markdown|sarif|github-annotation\n' +
          'Run mode: --dry-run --offline\n' +
          'Inspect:  --since REF --max-candidates N --model M --base-url U --api-key K\n' +
          'Rules:    --rules a,b --exclude-rules a,b --oversized-lines N\n' +
          'Failure:  --fail-on none|low|medium|high|all\n' +
          'Config:   --config PATH --state-file PATH --outbox-dir PATH\n' +
          'Webhook:  --webhook-url URL --webhook-signing-secret S --webhook-signature-header H\n' +
          '          --include-snippets (disable snippet redaction)\n',
      );
      return 0;
    }

    const rootDir = path.resolve(flags.rootDir);

    let fileConfig;
    if (flags.configPath) {
      fileConfig = parseJsonFile(flags.configPath);
    } else {
      fileConfig = loadConfigFile(rootDir);
    }

    const config = resolveConfig({ flags, env: process.env, fileConfig });

    const stateFile = path.isAbsolute(config.stateFile)
      ? config.stateFile
      : path.resolve(rootDir, config.stateFile);
    const localState = loadLocalState(stateFile);

    if (config.sinceRef == null) {
      config.sinceRef = localState.lastScannedRef ?? null;
    }

    const result = await runInspection(config);

    const newFindings = result.findings.filter(
      (f) => !localState.filedFingerprints.includes(fingerprintFinding(f)),
    );

    let updatedState = { ...localState, lastScannedRef: result.ref ?? null };
    let stateChanged = updatedState.lastScannedRef !== localState.lastScannedRef;
    for (const f of result.findings) {
      const fp = fingerprintFinding(f);
      if (!updatedState.filedFingerprints.includes(fp)) {
        updatedState.filedFingerprints.push(fp);
        stateChanged = true;
      }
    }
    if (stateChanged) saveLocalState(stateFile, updatedState);

    if (config.webhookUrl && newFindings.length > 0) {
      const repository = gitRemoteRepo(rootDir);
      const payload = buildWebhookPayload({ repository, ref: result.ref, findings: newFindings });
      if (!wasDelivered(localState, payload)) {
        const webhookResult = await notifyWebhook(buildCliWebhookOptions(config, {
          repository,
          ref: result.ref,
          findings: newFindings,
          updatedState,
          rootDir,
        }));
        if (webhookResult.delivered) {
          updatedState = webhookResult.updatedState || recordDelivery(updatedState, payload);
          saveLocalState(stateFile, updatedState);
        } else if (!webhookResult.skipped) {
          io.stderr.write(`health-inspector: webhook delivery failed after ${webhookResult.attempts || 1} attempt(s)\n`);
        }
      }
    }

    const output = formatResult(result, config.format, { redact: config.redact });
    io.stdout.write(`${output}\n`);

    return exitCodeFor(result.findings, config.failOn);
  } catch (error) {
    io.stderr.write(`health-inspector: ${error.message}\n`);
    return error.code === 2 ? 2 : 3;
  }
}

export function writeResult(file, result, format = 'json') {
  fs.writeFileSync(file, formatResult(result, format), 'utf8');
}

export function buildCliWebhookOptions(config, { repository, ref, findings, updatedState, rootDir }) {
  return {
    url: config.webhookUrl,
    repository,
    ref,
    findings,
    reportUrl: null,
    secret: config.webhookSecret,
    secretHeader: config.webhookSecretHeader,
    signingSecret: config.webhookSigningSecret,
    signatureHeader: config.webhookSignatureHeader,
    headers: config.webhookHeaders || {},
    timeoutMs: config.webhookTimeoutMs,
    retries: config.webhookRetries,
    state: updatedState,
    outboxDir: path.isAbsolute(config.outboxDir) ? config.outboxDir : path.resolve(rootDir, config.outboxDir),
  };
}
