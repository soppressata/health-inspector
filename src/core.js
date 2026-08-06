import path from 'node:path';
import fs from 'node:fs';

import { inspectCandidates } from './inspect.js';
import { scanRepo } from './scan.js';

function redactSnippet(snippet) {
  return String(snippet ?? '')
    .replace(/(AKIA)[0-9A-Z]{16}/g, '$1[REDACTED]')
    .replace(/(-----BEGIN )[A-Z0-9 ]+(PRIVATE KEY-----)/g, '$1[REDACTED]$2')
    .replace(/((?:api[_-]?key|apikey|secret|password)\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]');
}

export async function runInspection(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) throw new Error(`Repository path is not a directory: ${rootDir}`);
  const candidates = await scanRepo({
    rootDir,
    sinceRef: options.sinceRef || null,
    maxCandidates: options.maxCandidates,
  });
  const safeCandidates = options.redact === false ? candidates : candidates.map((candidate) => ({ ...candidate, snippet: redactSnippet(candidate.snippet) }));
  const result = { rootDir, candidates: safeCandidates, findings: [], reportMarkdown: null, tokensUsed: 0, dryRun: Boolean(options.dryRun) };
  if (safeCandidates.length === 0 || options.dryRun || options.offline) return result;
  if (!options.apiKey) throw new Error('An API key is required unless --offline or --dry-run is used');
  const inspected = await inspectCandidates({
    candidates: safeCandidates,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl || 'https://api.deepseek.com',
    model: options.model || 'deepseek-chat',
  });
  return { ...result, ...inspected };
}
