import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanRepo } from '../src/scan.js';

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

const tempDirs = [];

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-test-'));
  tempDirs.push(dir);
  git(dir, ['init', '-q']);
  return dir;
}

function commitAll(cwd, message) {
  git(cwd, ['add', '-A']);
  git(cwd, ['-c', 'user.name=scan-test', '-c', 'user.email=scan@test', 'commit', '-q', '-m', message]);
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('todo_fixme: only reports TODO/FIXME in files changed since sinceRef', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'README.md'), '# demo\n');
  write(path.join(repo, 'src/base.js'), '// TODO: pre-existing, must NOT show up\n');
  commitAll(repo, 'baseline');
  const base = git(repo, ['rev-parse', 'HEAD']).trim();

  write(path.join(repo, 'src/work.js'), '// TODO: implement the thing\nfunction a() {}\n// FIXME: slow path\n');
  commitAll(repo, 'add work');

  const result = await scanRepo({ rootDir: repo, sinceRef: base, maxCandidates: 50 });
  const todos = result.filter((c) => c.type === 'todo_fixme');

  assert.equal(todos.length, 2);
  assert.ok(todos.every((c) => c.file === 'src/work.js'));
  assert.ok(!result.some((c) => c.file === 'src/base.js'), 'unchanged file excluded by diff');
  assert.ok(todos.some((c) => c.snippet.includes('TODO')));
  assert.ok(todos.some((c) => c.snippet.includes('FIXME')));
  assert.ok(todos.some((c) => c.line === 3));
});

test('todo_fixme: full scan when sinceRef is null', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'src/a.js'), '// TODO: full scan sees me\n');
  commitAll(repo, 'todo only');

  const result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  assert.ok(result.some((c) => c.type === 'todo_fixme' && c.file === 'src/a.js'));
});

test('secret_like: catches AWS keys, private key headers, and key= string assignments', async () => {
  const repo = makeRepo();
  write(
    path.join(repo, 'src/config.js'),
    [
      'const awsKey = "AKIAIOSFODNN7EXAMPLE";',
      'const apiKey = "abcdefghijklm";',
      'const password = "supersecretpassword";',
      'const notSecret = "short";',
    ].join('\n') + '\n',
  );
  write(
    path.join(repo, 'keys.pem'),
    '-----BEGIN RSA PRIVATE KEY-----\nMII...\n-----END RSA PRIVATE KEY-----\n',
  );
  commitAll(repo, 'secrets');

  const result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  const secrets = result.filter((c) => c.type === 'secret_like');
  const lines = new Set(secrets.map((c) => c.line));

  assert.ok(lines.has(1), 'aws key line');
  assert.ok(lines.has(2), 'api_key assignment');
  assert.ok(lines.has(3), 'password assignment');
  assert.ok(secrets.some((c) => c.file === 'keys.pem'), 'private key header');
  assert.ok(!lines.has(4), 'short value is not a secret');
});

test('bare_except: flags empty and comment-only catch blocks, not real handlers', async () => {
  const repo = makeRepo();
  write(
    path.join(repo, 'src/handlers.js'),
    [
      'export function emptyCatch() {',
      '  try { doThing() } catch (e) {}',
      '}',
      'export function commented() {',
      '  try { doThing() } catch (e) {',
      '    // silence is golden',
      '  }',
      '}',
      'export function realHandler() {',
      '  try { doThing() } catch (e) {',
      '    throw e;',
      '  }',
      '}',
    ].join('\n') + '\n',
  );
  write(path.join(repo, 'swallow.py'), 'try:\n    pass\nexcept:\n    pass\n');
  commitAll(repo, 'catches');

  const result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  const catches = result.filter((c) => c.type === 'bare_except');
  const lines = catches.map((c) => c.line);

  assert.ok(lines.includes(2), 'empty catch');
  assert.ok(lines.includes(5), 'comment-only catch');
  assert.ok(!lines.includes(10), 'real handler not flagged');
  assert.ok(catches.some((c) => c.file === 'swallow.py'), 'python bare except');
});

test('untested_new_function: flags exported functions with no test referencing the file', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'src/math.js'), 'export function add(a, b) { return a + b; }\n');
  commitAll(repo, 'math only');

  let result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  assert.ok(result.some((c) => c.type === 'untested_new_function' && c.file === 'src/math.js'));

  write(
    path.join(repo, 'tests/math.test.js'),
    "import { add } from '../src/math.js';\nassert(add(1, 2) === 3);\n",
  );
  commitAll(repo, 'add test');

  result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  assert.ok(!result.some((c) => c.type === 'untested_new_function' && c.file === 'src/math.js'));
});

test('oversized_function: flags JS and Python functions spanning more than 80 lines', async () => {
  const repo = makeRepo();
  const body = ['export function big() {'];
  for (let i = 0; i < 85; i++) body.push(`  const v${i} = ${i};`);
  body.push('}');
  body.push('');
  body.push('export function small() {');
  body.push('  return 1;');
  body.push('}');
  write(path.join(repo, 'src/big.js'), body.join('\n') + '\n');

  const pyLines = ['def bigpy():'];
  for (let i = 0; i < 85; i++) pyLines.push(`    x${i} = ${i}`);
  write(path.join(repo, 'big.py'), pyLines.join('\n') + '\n');
  commitAll(repo, 'big funcs');

  const result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  const big = result.filter((c) => c.type === 'oversized_function');

  assert.ok(big.some((c) => c.file === 'src/big.js' && c.line === 1), 'big js function');
  assert.ok(big.some((c) => c.file === 'big.py' && c.line === 1), 'big python function');
  assert.ok(!big.some((c) => c.file === 'src/big.js' && c.line === 89), 'small js function not flagged');
});

test('ranking and cap: sorts by severity_hint and limits results to maxCandidates', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'src/todo.js'), '// TODO: low priority\n');
  write(path.join(repo, 'src/secret.js'), 'const api_key = "0123456789abcdef";\n');
  write(path.join(repo, 'src/catch.js'), 'function f() { try { g() } catch (e) {} }\n');
  write(path.join(repo, 'src/util.js'), 'export function helper() { return 1; }\n');
  write(path.join(repo, 'src/big.js'), 'function huge() {\n' + '  let x = 1;\n'.repeat(85) + '}\n');
  commitAll(repo, 'all violations');

  const result = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 3 });
  assert.equal(result.length, 3);
  assert.deepEqual(
    result.map((c) => c.type),
    ['secret_like', 'bare_except', 'untested_new_function'],
  );

  const all = await scanRepo({ rootDir: repo, sinceRef: null, maxCandidates: 50 });
  assert.deepEqual(
    all.map((c) => c.type),
    ['secret_like', 'bare_except', 'untested_new_function', 'oversized_function', 'todo_fixme'],
  );
});

test('falls back to a full scan when sinceRef is invalid and git diff fails', async () => {
  const repo = makeRepo();
  write(path.join(repo, 'src/only.js'), '// TODO: still found on fallback\n');
  commitAll(repo, 'only');

  const result = await scanRepo({ rootDir: repo, sinceRef: 'does-not-exist-ref', maxCandidates: 50 });
  assert.ok(result.some((c) => c.type === 'todo_fixme' && c.file === 'src/only.js'));
});
