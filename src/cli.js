import fs from 'node:fs';

import { runInspection } from './core.js';
import { renderJson, renderMarkdown } from './output.js';

function usageError(message) { return Object.assign(new Error(message), { code: 2 }); }

export function parseArgs(argv = []) {
  const options = { rootDir: '.', format: 'markdown', redact: true };
  const values = new Map([
    ['--format', 'format'], ['--max-candidates', 'maxCandidates'], ['--model', 'model'],
    ['--base-url', 'baseUrl'], ['--api-key', 'apiKey'], ['--since', 'sinceRef'],
  ]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--dry-run') { options.dryRun = true; continue; }
    if (arg === '--offline') { options.offline = true; continue; }
    if (arg === '--include-snippets') { options.redact = false; continue; }
    if (values.has(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw usageError(`${arg} requires a value`);
      options[values.get(arg)] = value;
      continue;
    }
    if (arg.startsWith('-')) throw usageError(`Unknown option: ${arg}`);
    if (options.rootDir !== '.') throw usageError('Only one repository path may be supplied');
    options.rootDir = arg;
  }
  if (!['json', 'markdown'].includes(options.format)) throw usageError('--format must be json or markdown');
  if (options.maxCandidates !== undefined) {
    options.maxCandidates = Number(options.maxCandidates);
    if (!Number.isInteger(options.maxCandidates) || options.maxCandidates <= 0) throw usageError('--max-candidates must be a positive integer');
  }
  return options;
}

export async function runCli(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const options = parseArgs(argv);
    if (options.help) { io.stdout.write('Usage: health-inspector [path] [options]\n\n--format json|markdown --dry-run --offline --since REF\n'); return 0; }
    const result = await runInspection({ ...options, apiKey: options.apiKey || process.env.HEALTH_INSPECTOR_API_KEY });
    const output = options.format === 'json' ? renderJson(result, options) : renderMarkdown(result, options);
    io.stdout.write(`${output}\n`);
    return result.findings.length ? 1 : 0;
  } catch (error) {
    io.stderr.write(`health-inspector: ${error.message}\n`);
    return error.code === 2 ? 2 : 3;
  }
}

export function writeResult(file, result, format = 'json') {
  fs.writeFileSync(file, format === 'json' ? renderJson(result) : renderMarkdown(result), 'utf8');
}
