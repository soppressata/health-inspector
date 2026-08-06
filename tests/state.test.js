import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprintFinding, loadState, saveState } from '../src/state.js';

function memoryClient(initialByBranch = {}) {
  const store = new Map();
  let rev = 0;
  for (const [branch, { content }] of Object.entries(initialByBranch)) {
    store.set(branch, { content, sha: `sha-${branch}` });
  }
  return {
    store,
    getContent: async ({ path, ref }) => {
      assert.equal(path, 'state.json');
      const entry = store.get(ref);
      if (!entry) throw { status: 404 };
      return { content: entry.content, sha: entry.sha };
    },
    createOrUpdateFile: async ({ path, content, sha, branch, message }) => {
      assert.equal(path, 'state.json');
      assert.ok(message.length > 0);
      const entry = store.get(branch);
      if (entry) assert.equal(sha, entry.sha);
      const next = { content, sha: `sha-${++rev}` };
      store.set(branch, next);
      return { content: next };
    },
  };
}

const DEFAULT = { lastScannedRef: null, filedFingerprints: [] };

test('loadState returns defaults when branch or state.json is missing (404)', async () => {
  const client = memoryClient();
  const result = await loadState({
    octokitLike: client,
    owner: 'o',
    repo: 'r',
    stateBranch: 'health-inspector-state',
  });
  assert.deepEqual(result, DEFAULT);
});

test('loadState returns defaults when another error shape carries status 404', async () => {
  const client = memoryClient();
  client.getContent = async () => {
    const err = new Error('Not Found');
    err.status = 404;
    throw err;
  };
  const result = await loadState({ octokitLike: client, owner: 'o', repo: 'r', stateBranch: 'b' });
  assert.deepEqual(result, DEFAULT);
});

test('save then load round trips state through the contents API', async () => {
  const client = memoryClient();
  const state = { lastScannedRef: 'abc123def456', filedFingerprints: ['a1b2c3d4e5f6', '001122334455'] };

  await saveState({ octokitLike: client, owner: 'o', repo: 'r', stateBranch: 'b', state });

  const loaded = await loadState({ octokitLike: client, owner: 'o', repo: 'r', stateBranch: 'b' });
  assert.deepEqual(loaded, state);

  const entry = client.store.get('b');
  const decoded = JSON.parse(Buffer.from(entry.content, 'base64').toString('utf8'));
  assert.deepEqual(decoded, state);
});

test('saveState updates an existing file with its sha (no duplicate create)', async () => {
  const existing = Buffer.from(JSON.stringify(DEFAULT)).toString('base64');
  const client = memoryClient({ 'health-state': { content: existing } });
  const calls = [];

  await saveState({
    octokitLike: {
      ...client,
      createOrUpdateFile: async (args) => {
        calls.push(args);
        return { content: {} };
      },
    },
    owner: 'o',
    repo: 'r',
    stateBranch: 'health-state',
    state: { lastScannedRef: 'ref1', filedFingerprints: ['ff'] },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].sha, 'sha-health-state');
  assert.equal(calls[0].branch, 'health-state');
  assert.ok(calls[0].content.length > 0);
});

test('saveState creates the state branch from the default branch when it does not exist yet', async () => {
  const client = memoryClient();
  const refs = new Map([['heads/main', { object: { sha: 'main-sha' } }]]);
  const createdRefs = [];
  const richClient = {
    ...client,
    getRef: async ({ ref }) => {
      const entry = refs.get(ref);
      if (!entry) throw { status: 404 };
      return entry;
    },
    createRef: async ({ ref, sha }) => {
      createdRefs.push({ ref, sha });
      refs.set(ref.replace(/^refs\//, ''), { object: { sha } });
      return { ref, object: { sha } };
    },
    getRepo: async () => ({ default_branch: 'main' }),
  };

  await saveState({
    octokitLike: richClient,
    owner: 'o',
    repo: 'r',
    stateBranch: 'health-inspector-state',
    state: { lastScannedRef: 'abc', filedFingerprints: [] },
  });

  assert.equal(createdRefs.length, 1);
  assert.equal(createdRefs[0].ref, 'refs/heads/health-inspector-state');
  assert.equal(createdRefs[0].sha, 'main-sha');
  assert.ok(client.store.get('health-inspector-state'));
});

test('saveState does not create a branch that already exists', async () => {
  const client = memoryClient({ 'health-inspector-state': { content: Buffer.from(JSON.stringify(DEFAULT)).toString('base64') } });
  const createdRefs = [];
  const richClient = {
    ...client,
    getRef: async () => ({ object: { sha: 'already-there' } }),
    createRef: async (args) => {
      createdRefs.push(args);
      throw new Error('should not be called');
    },
    getRepo: async () => ({ default_branch: 'main' }),
  };

  await saveState({
    octokitLike: richClient,
    owner: 'o',
    repo: 'r',
    stateBranch: 'health-inspector-state',
    state: { lastScannedRef: 'def', filedFingerprints: [] },
  });

  assert.equal(createdRefs.length, 0);
});

test('fingerprintFinding is stable for identical findings', () => {
  const a = fingerprintFinding({ file: 'src/a.js', type: 'todo_fixme', snippet: '// TODO: hi' });
  const b = fingerprintFinding({ file: 'src/a.js', type: 'todo_fixme', snippet: '// TODO: hi' });
  assert.equal(a, b);
  assert.equal(a.length, 12);
  assert.match(a, /^[0-9a-f]{12}$/);
});

test('fingerprintFinding differs across file, type, and snippet', () => {
  const base = { file: 'src/a.js', type: 'todo_fixme', snippet: '// TODO: hi' };
  const diffFile = fingerprintFinding({ ...base, file: 'src/b.js' });
  const diffType = fingerprintFinding({ ...base, type: 'secret_like' });
  const diffSnippet = fingerprintFinding({ ...base, snippet: '// TODO: hello' });
  const fp = fingerprintFinding(base);
  assert.notEqual(diffFile, fp);
  assert.notEqual(diffType, fp);
  assert.notEqual(diffSnippet, fp);
});

test('fingerprintFinding normalizes snippet whitespace', () => {
  const a = fingerprintFinding({ file: 'f', type: 't', snippet: '  const  x = 1;' });
  const b = fingerprintFinding({ file: 'f', type: 't', snippet: 'const x = 1;\n' });
  assert.equal(a, b);
});
