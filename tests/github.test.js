import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileReport, makeGithubClient, isRetryable } from '../src/github.js';
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

function mockFetch(responses) {
  let count = 0;
  const fetchImpl = async (url, opts = {}) => {
    const index = count++;
    const entry = responses[index];
    if (typeof entry === 'function') {
      return entry(url, opts);
    }
    const { status = 200, body = {} } = entry;
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => text,
    };
  };
  return { count: () => count, fetchImpl };
}

test('isRetryable classifies transient and 5xx statuses as retryable', () => {
  assert.equal(isRetryable(200), false);
  assert.equal(isRetryable(404), false);
  assert.equal(isRetryable(408), true);
  assert.equal(isRetryable(425), true);
  assert.equal(isRetryable(429), true);
  assert.equal(isRetryable(500), true);
  assert.equal(isRetryable(503), true);
  assert.equal(isRetryable(599), true);
  assert.equal(isRetryable(600), false);
});

test('makeGithubClient retries on transient 503 then succeeds on 200', async () => {
  const { count, fetchImpl } = mockFetch([
    { status: 503, body: { message: 'transient failure' } },
    { status: 200, body: { id: 42 } },
  ]);
  const client = makeGithubClient('token', {
    timeoutMs: 1000,
    maxRetries: 3,
    retryBaseMs: 1,
    fetchImpl,
  });

  const result = await client.getRepo({ owner: 'o', repo: 'r' });
  assert.deepEqual(result, { id: 42 });
  assert.equal(count(), 2);
});

test('makeGithubClient throws immediately on non-retryable 404 without retrying', async () => {
  const { count, fetchImpl } = mockFetch([
    { status: 404, body: { message: 'not found' } },
  ]);
  const client = makeGithubClient('token', {
    timeoutMs: 1000,
    maxRetries: 3,
    retryBaseMs: 1,
    fetchImpl,
  });

  await assert.rejects(
    client.getRepo({ owner: 'o', repo: 'r' }),
    (err) => err.status === 404,
  );
  assert.equal(count(), 1);
});

test('makeGithubClient aborts and throws when fetch hangs', async () => {
  let count = 0;
  const fetchImpl = (url, { signal } = {}) => {
    count++;
    return new Promise((_, reject) => {
      const onAbort = () =>
        reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      // intentionally never resolves — hangs until aborted
    });
  };
  const client = makeGithubClient('token', { timeoutMs: 50, maxRetries: 0, fetchImpl });

  const start = Date.now();
  await assert.rejects(
    client.getRepo({ owner: 'o', repo: 'r' }),
    (err) => err && err.name === 'AbortError',
  );
  const elapsed = Date.now() - start;
  assert.equal(count, 1);
  assert.ok(elapsed >= 40, `expected abort within ~50ms, took ${elapsed}ms`);
});

test('fileReport still works with a plain in-memory client (no real fetch)', async () => {
  // Regression guard: fileReport takes an arbitrary octokitLike object and must
  // not depend on makeGithubClient internals.
  const { count, fetchImpl } = mockFetch([]);
  const client = makeGithubClient('token', { fetchImpl });
  // Sanity: the real client is *not* used by this path.
  assert.equal(count(), 0);

  const state = { lastScannedRef: 'sha', filedFingerprints: [] };
  const fresh = finding('secret_like', 'const api_key = "abcdefghijklm";');

  const result = await fileReport({
    octokitLike: {
      createIssue: async (payload) => ({
        html_url: 'https://github.com/o/r/issues/42',
        number: 42,
        ...payload,
      }),
    },
    owner: 'o',
    repo: 'r',
    label: 'health-inspector',
    reportMarkdown: 'one new thing',
    findings: [fresh],
    state,
  });

  assert.equal(result.filed, true);
  assert.equal(result.issueUrl, 'https://github.com/o/r/issues/42');
  assert.deepEqual(result.newFindings, [fresh]);
  assert.deepEqual(result.updatedState.filedFingerprints, [fingerprintFinding(fresh)]);
  assert.equal(count(), 0, 'no real fetch happened');
});
