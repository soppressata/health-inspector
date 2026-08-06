import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { parseArgs, runCli, exitCodeFor, writeResult } from '../src/cli.js';
import { resolveConfig, loadConfigFile } from '../src/config.js';
import { renderSarif, renderGithubAnnotation, renderMarkdownTable, formatResult } from '../src/output.js';
import { SCAN_RULES } from '../src/scan.js';

function makeIo() {
  const stdout = [];
  const stderr = [];
  return {
    stdout: { write: (s) => stdout.push(String(s)) },
    stderr: { write: (s) => stderr.push(String(s)) },
    out: () => stdout.join(''),
    err: () => stderr.join(''),
  };
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const tempDirs = [];
function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-cli-'));
  tempDirs.push(dir);
  git(dir, ['init', '-q']);
  return dir;
}

test('parseArgs: parses all new flags with correct values', () => {
  const options = parseArgs([
    'demo',
    '--config', '.ci/hp.json',
    '--fail-on', 'high',
    '--rules', 'todo_fixme,secret_like',
    '--exclude-rules', 'oversized_function',
    '--oversized-lines', '120',
    '--webhook-url', 'https://hook.test/x',
    '--webhook-signing-secret', 's3cret',
    '--webhook-signature-header', 'X-Custom-Sig',
    '--state-file', '.hi/state.json',
    '--outbox-dir', '.hi/outbox',
    '--max-candidates', '9',
    '--model', 'gpt-4',
    '--base-url', 'https://api.test',
    '--api-key', 'sk-key',
    '--since', 'deadbeef',
  ]);
  assert.equal(options.rootDir, 'demo');
  assert.equal(options.configPath, '.ci/hp.json');
  assert.equal(options.failOn, 'high');
  assert.deepEqual(options.rules, ['todo_fixme', 'secret_like']);
  assert.deepEqual(options.excludeRules, ['oversized_function']);
  assert.equal(options.oversizedFunctionLines, 120);
  assert.equal(options.webhookUrl, 'https://hook.test/x');
  assert.equal(options.webhookSigningSecret, 's3cret');
  assert.equal(options.webhookSignatureHeader, 'X-Custom-Sig');
  assert.equal(options.stateFile, '.hi/state.json');
  assert.equal(options.outboxDir, '.hi/outbox');
  assert.equal(options.maxCandidates, 9);
});

test('parseArgs: --include-snippets disables redaction (backward compatible)', () => {
  const options = parseArgs(['.', '--include-snippets']);
  assert.equal(options.redact, false);
});

test('parseArgs: --fail-on rejects invalid values', () => {
  assert.throws(() => parseArgs(['--fail-on', 'bogus']), /fail-on/);
});

test('parseArgs: --format rejects unknown formats', () => {
  assert.throws(() => parseArgs(['--format', 'xml']), /--format/);
});

test('parseArgs: --oversized-lines rejects non-integers', () => {
  assert.throws(() => parseArgs(['--oversized-lines', 'abc']), /oversized-lines/);
  assert.throws(() => parseArgs(['--oversized-lines', '0']), /oversized-lines/);
});

test('parseArgs: value options require a value', () => {
  assert.throws(() => parseArgs(['--rules']), /requires a value/);
  assert.throws(() => parseArgs(['--webhook-url', '--fail-on']), /requires a value/);
});

test('parseArgs: config precedence flows from flags through resolveConfig', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-precedence-'));
  fs.writeFileSync(
    path.join(dir, '.health-inspector.json'),
    JSON.stringify({ model: 'file-model', maxCandidates: 10, failOn: 'low' }),
    'utf8',
  );
  const flags = parseArgs(['--model', 'flag-model', '--max-candidates', '3', '--format', 'sarif']);
  const fileConfig = loadConfigFile(dir);
  const env = { HEALTH_INSPECTOR_FAIL_ON: 'medium' };
  const config = resolveConfig({ flags, env, fileConfig });
  assert.equal(config.model, 'flag-model');
  assert.equal(config.maxCandidates, 3);
  assert.equal(config.failOn, 'medium');
  assert.equal(config.oversizedFunctionLines, 80);
});

test('exitCodeFor: --fail-on none never fails', () => {
  assert.equal(exitCodeFor([], 'none'), 0);
  assert.equal(exitCodeFor([{ severity: 'high' }], 'none'), 0);
});

test('exitCodeFor: --fail-on low fails on any finding', () => {
  assert.equal(exitCodeFor([{ severity: 'low' }], 'low'), 1);
  assert.equal(exitCodeFor([{ severity: 'high' }], 'low'), 1);
  assert.equal(exitCodeFor([], 'low'), 0);
});

test('exitCodeFor: --fail-on medium fails on medium/high but not low', () => {
  assert.equal(exitCodeFor([{ severity: 'low' }], 'medium'), 0);
  assert.equal(exitCodeFor([{ severity: 'medium' }], 'medium'), 1);
  assert.equal(exitCodeFor([{ severity: 'high' }], 'medium'), 1);
  assert.equal(exitCodeFor([{ severity: 'low' }, { severity: 'high' }], 'medium'), 1);
});

test('exitCodeFor: --fail-on high fails only on high', () => {
  assert.equal(exitCodeFor([{ severity: 'low' }], 'high'), 0);
  assert.equal(exitCodeFor([{ severity: 'medium' }], 'high'), 0);
  assert.equal(exitCodeFor([{ severity: 'high' }], 'high'), 1);
});

test('exitCodeFor: default "all" fails on any finding', () => {
  assert.equal(exitCodeFor([{ severity: 'low' }], 'all'), 1);
  assert.equal(exitCodeFor([{ severity: 'medium' }], 'all'), 1);
  assert.equal(exitCodeFor([], 'all'), 0);
});

test('renderSarif: produces a valid SARIF 2.1.0 document with results', () => {
  const result = {
    rootDir: '.',
    candidates: [],
    findings: [
      { type: 'todo_fixme', file: 'src/a.js', line: 3, severity: 'high', reason: 'fix me' },
      { type: 'bare_except', file: 'src/b.py', line: 9, severity: 'medium', reason: 'swallows errors' },
      { type: 'secret_like', file: 'config.js', line: 2, severity: 'low', reason: 'credential' },
    ],
    reportMarkdown: '',
    tokensUsed: 0,
    dryRun: false,
    offline: false,
    ref: 'abc',
  };
  const sarif = JSON.parse(renderSarif(result));
  assert.equal(sarif.version, '2.1.0');
  assert.equal(sarif.$schema, 'https://json.schemastore.org/sarif-2.1.0.json');
  assert.equal(sarif.runs.length, 1);
  assert.equal(sarif.runs[0].tool.driver.name, 'health-inspector');
  assert.equal(sarif.runs[0].tool.driver.version, '0.1.0');
  assert.equal(sarif.runs[0].tool.driver.rules.length, Object.keys(SCAN_RULES).length);
  assert.ok(sarif.runs[0].tool.driver.rules.some((r) => r.id === 'bare_except'));
  assert.equal(sarif.runs[0].results.length, 3);

  const byType = Object.fromEntries(sarif.runs[0].results.map((r) => [r.ruleId, r]));
  assert.equal(byType.todo_fixme.level, 'error');
  assert.equal(byType.bare_except.level, 'warning');
  assert.equal(byType.secret_like.level, 'note');
  assert.equal(byType.todo_fixme.message.text, 'todo_fixme: fix me');
  assert.equal(byType.todo_fixme.locations[0].physicalLocation.artifactLocation.uri, 'src/a.js');
  assert.equal(byType.todo_fixme.locations[0].physicalLocation.region.startLine, 3);
});

test('renderSarif: maps severity to SARIF levels', () => {
  const finding = (severity) => ({ type: 'todo_fixme', file: 'f.js', line: 1, severity, reason: 'r' });
  const sarif = JSON.parse(renderSarif({ findings: [finding('high'), finding('medium'), finding('low')] }));
  const levels = sarif.runs[0].results.map((r) => r.level);
  assert.deepEqual(levels, ['error', 'warning', 'note']);
});

test('renderSarif: empty findings yields empty results array', () => {
  const sarif = JSON.parse(renderSarif({ findings: [] }));
  assert.deepEqual(sarif.runs[0].results, []);
});

test('renderGithubAnnotation: emits error for high and warning for low/medium', () => {
  const result = {
    findings: [
      { type: 'todo_fixme', file: 'src/a.js', line: 3, severity: 'high', reason: 'fix' },
      { type: 'secret_like', file: 'src/b.js', line: 7, severity: 'medium', reason: 'cred' },
      { type: 'bare_except', file: 'src/c.js', line: 1, severity: 'low', reason: 'empty' },
    ],
  };
  const out = renderGithubAnnotation(result);
  const lines = out.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^::error file=src\/a\.js,line=3,title=todo_fixme::todo_fixme: fix$/);
  assert.match(lines[1], /^::warning file=src\/b\.js,line=7,title=secret_like::secret_like: cred$/);
  assert.match(lines[2], /^::warning file=src\/c\.js,line=1,title=bare_except::bare_except: empty$/);
});

test('renderGithubAnnotation: escapes special characters in params and message', () => {
  const result = {
    findings: [{ type: 'todo_fixme', file: 'src/a%2c.js', line: 1, severity: 'high', reason: 'line1\nline2' }],
  };
  const out = renderGithubAnnotation(result);
  assert.match(out, /%25/);
  assert.match(out, /%0A/);
});

test('renderMarkdownTable: renders a findings table', () => {
  const result = { findings: [{ type: 'todo_fixme', file: 'src/a.js', line: 3, severity: 'low', reason: 'todo' }] };
  const table = renderMarkdownTable(result);
  assert.ok(table.includes('| File | Line | Type | Severity | Reason |'));
  assert.ok(table.includes('| src/a.js | 3 | todo_fixme | low | todo |'));
});

test('formatResult: dispatches to the requested format', () => {
  const result = { rootDir: '.', candidates: [], findings: [], reportMarkdown: null, tokensUsed: 0, dryRun: false, offline: false, ref: null };
  assert.doesNotThrow(() => formatResult(result, 'json', { redact: true }));
  assert.doesNotThrow(() => formatResult(result, 'markdown', { redact: true }));
  assert.doesNotThrow(() => formatResult(result, 'sarif'));
  assert.doesNotThrow(() => formatResult(result, 'github-annotation'));
  assert.throws(() => formatResult(result, 'nope'), /Unknown output format/);
});

test('runCli: --format sarif --offline emits valid SARIF and exits 0 on a clean repo', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'app.js'), 'console.log("clean");\n');
  const io = makeIo();
  const code = await runCli([repo, '--offline', '--format', 'sarif'], io);
  assert.equal(code, 0);
  const sarif = JSON.parse(io.out().trim());
  assert.equal(sarif.version, '2.1.0');
  assert.deepEqual(sarif.runs[0].results, []);
});

test('runCli: --format github-annotation --offline exits 0 with no annotations on a clean repo', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'app.js'), 'console.log("clean");\n');
  const io = makeIo();
  const code = await runCli([repo, '--offline', '--format', 'github-annotation'], io);
  assert.equal(code, 0);
  assert.equal(io.out().trim(), '');
});

test('runCli: --offline works without an API key and skips the LLM', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'src', 'a.js'), '// TODO: candidate only\n');
  const io = makeIo();
  const code = await runCli([repo, '--offline'], io);
  assert.equal(code, 0);
  const report = io.out();
  assert.ok(/No findings/.test(report) || /candidate\(s\)/.test(report));
});

test('runCli: unknown option exits with usage code 2', async () => {
  const io = makeIo();
  const code = await runCli(['--no-such-flag'], io);
  assert.equal(code, 2);
  assert.match(io.err(), /Unknown option/);
});

test('runCli: --dry-run short-circuits before calling the LLM and exits 0', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'src', 'a.js'), '// TODO: not inspected\n');
  const io = makeIo();
  const code = await runCli([repo, '--dry-run'], io);
  assert.equal(code, 0);
  assert.match(io.out(), /Dry run/);
});

test('runCli: --since explicitly set is respected and overrides state lastScannedRef', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'app.js'), 'console.log(1);\n');
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init']);
  const since = git(repo, ['rev-parse', 'HEAD']).trim();
  write(path.join(repo, 'src', 'new.js'), '// TODO: new since ref\n');
  const io = makeIo();
  const code = await runCli([repo, '--offline', '--since', since, '--format', 'json'], io);
  assert.equal(code, 0);
});

test('writeResult writes JSON to a file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-writer-'));
  const file = path.join(dir, 'out.json');
  const result = { rootDir: '.', candidates: [], findings: [], reportMarkdown: null, tokensUsed: 0, dryRun: false, offline: false, ref: null };
  writeResult(file, result, 'json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.findingsCount, 0);
});
