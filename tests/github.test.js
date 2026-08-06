import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileReport } from '../src/github.js';
import { fingerprintFinding } from '../src/state.js';

function memoryClient() {
  const issues = [];
  return {
    issues,
    createIssue: async (payload) => {
      issues.push(payload);
      return { html_url: 'https://github.com/o/r/issues/9', number: 9 };
    },
  };
}

function finding(type, snippet) {
  return { type, file: 'src/a.js', line: 3, snippet, severity_hint: 1 };
}

test('files one issue for all new findings and records their fingerprints', async () => {
  const client = memoryClient();
  const state = { lastScannedRef: 'sha', filedFingerprints: [] };
  const f1 = finding('todo_fixme', '// TODO: one');
  const f2 = finding('bare_except', 'catch (e) {}');
  const reportMarkdown = '## Health Inspector findings\n- issue 1\n- issue 2';

  const result = await fileReport({
    octokitLike: client,
    owner: 'o',
    repo: 'r',
    label: 'health-inspector',
    reportMarkdown,
    findings: [f1, f2],
    state,
  });

  assert.equal(result.filed, true);
  assert.equal(result.issueUrl, 'https://github.com/o/r/issues/9');
  assert.equal(client.issues.length, 1);
  assert.equal(client.issues[0].title, '[Health Inspector] 2 new finding(s)');
  assert.equal(client.issues[0].body, reportMarkdown);
  assert.deepEqual(client.issues[0].labels, ['health-inspector']);
  assert.equal(client.issues[0].owner, 'o');
  assert.equal(client.issues[0].repo, 'r');
  assert.deepEqual(result.updatedState.filedFingerprints, [fingerprintFinding(f1), fingerprintFinding(f2)]);
  assert.equal(result.updatedState, state, 'mutates and returns the passed-in state');
});

test('does not call the API when every finding was already reported', async () => {
  const client = memoryClient();
  const f = finding('todo_fixme', '// TODO: already seen');
  const state = { lastScannedRef: 'sha', filedFingerprints: [fingerprintFinding(f)] };

  const result = await fileReport({
    octokitLike: client,
    owner: 'o',
    repo: 'r',
    label: 'health-inspector',
    reportMarkdown: 'irrelevant',
    findings: [f],
    state,
  });

  assert.deepEqual(result, {
    filed: false,
    reason: 'all findings already reported',
    newFindings: [],
    updatedState: state,
  });
  assert.equal(client.issues.length, 0);
});

test('returns only new findings and preserves state when there is nothing new', async () => {
  const client = memoryClient();
  const f = finding('todo_fixme', '// TODO: already seen');
  const state = { lastScannedRef: 'sha', filedFingerprints: [fingerprintFinding(f)] };

  const result = await fileReport({ octokitLike: client, owner: 'o', repo: 'r', label: 'l', reportMarkdown: '', findings: [f], state });

  assert.deepEqual(result.newFindings, []);
  assert.equal(result.updatedState, state);
  assert.deepEqual(state, { lastScannedRef: 'sha', filedFingerprints: [fingerprintFinding(f)] });
});

test('dedups already-filed findings and only files the new ones', async () => {
  const client = memoryClient();
  const old = finding('todo_fixme', '// TODO: seen before');
  const fresh = finding('secret_like', 'const api_key = "abcdefghijklm";');
  const state = { lastScannedRef: 'sha', filedFingerprints: [fingerprintFinding(old)] };

  const result = await fileReport({
    octokitLike: client,
    owner: 'o',
    repo: 'r',
    label: 'health-inspector',
    reportMarkdown: 'one new thing',
    findings: [old, fresh],
    state,
  });

  assert.equal(result.filed, true);
  assert.equal(client.issues.length, 1);
  assert.equal(client.issues[0].title, '[Health Inspector] 1 new finding(s)');
  assert.deepEqual(result.newFindings, [fresh]);
  assert.deepEqual(result.updatedState.filedFingerprints, [fingerprintFinding(old), fingerprintFinding(fresh)]);
});

test('duplicate findings within a run are counted but stored once in state', async () => {
  const client = memoryClient();
  const f = finding('todo_fixme', '// TODO: dup');
  const state = { lastScannedRef: null, filedFingerprints: [] };

  const result = await fileReport({
    octokitLike: client,
    owner: 'o',
    repo: 'r',
    label: 'health-inspector',
    reportMarkdown: 'body',
    findings: [f, f],
    state,
  });

  assert.equal(client.issues.length, 1);
  assert.equal(client.issues[0].title, '[Health Inspector] 2 new finding(s)');
  assert.deepEqual(result.updatedState.filedFingerprints, [fingerprintFinding(f)]);
});

test('empty findings short-circuit without touching the API', async () => {
  const client = memoryClient();
  const state = { lastScannedRef: null, filedFingerprints: [] };

  const result = await fileReport({
    octokitLike: client,
    owner: 'o',
    repo: 'r',
    label: 'health-inspector',
    reportMarkdown: 'body',
    findings: [],
    state,
  });

  assert.deepEqual(result, {
    filed: false,
    reason: 'all findings already reported',
    newFindings: [],
    updatedState: state,
  });
  assert.equal(client.issues.length, 0);
});
