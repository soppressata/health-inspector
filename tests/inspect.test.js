import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectCandidates } from '../src/inspect.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };
  return calls;
}

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

function modelResponse({ content, totalTokens = 42 } = {}) {
  return jsonResponse(200, {
    choices: [{ message: { content } }],
    usage: { total_tokens: totalTokens },
  });
}

test('empty candidates short-circuits with no fetch and trivial return', async () => {
  const calls = mockFetch(() => {
    throw new Error('fetch must not be called for empty candidates');
  });
  const result = await inspectCandidates({
    candidates: [],
    apiKey: 'k',
    baseUrl: 'https://x',
    model: 'm',
    maxOutputTokens: 10,
  });
  assert.deepEqual(result, { findings: [], reportMarkdown: null, tokensUsed: 0 });
  assert.equal(calls.length, 0);
});

test('confirmed findings are mapped back to candidates and reportMarkdown is built', async () => {
  const candidates = [
    { type: 'secret_like', file: 'src/a.js', line: 3, snippet: 'const api_key = "0123456789abcdef";', severity_hint: 5 },
    { type: 'todo_fixme', file: 'src/a.js', line: 9, snippet: '// TODO: harmless note', severity_hint: 1 },
    { type: 'bare_except', file: 'src/b.py', line: 4, snippet: 'except:', severity_hint: 4 },
  ];
  const modelJson = JSON.stringify({
    findings: [
      { index: 1, confirmed: true, severity: 'high', reason: 'real secret' },
      { index: 2, confirmed: false, severity: 'low', reason: 'false positive' },
      { index: 3, confirmed: true, severity: 'medium', reason: 'swallows errors' },
      { index: 99, confirmed: true, severity: 'high', reason: 'out of range index' },
    ],
    summary_markdown: '**1 confirmed issue** found.',
  });
  const calls = mockFetch(() => modelResponse({ content: modelJson, totalTokens: 321 }));

  const result = await inspectCandidates({
    candidates,
    apiKey: 'secret-key',
    baseUrl: 'https://api.deepseek.com/',
    model: 'deepseek-chat',
    maxOutputTokens: 500,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-key');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');

  const sent = JSON.parse(calls[0].options.body);
  assert.equal(sent.model, 'deepseek-chat');
  assert.equal(sent.temperature, 0);
  assert.equal(sent.max_tokens, 500);
  assert.equal(sent.messages.length, 2);
  assert.ok(sent.messages[0].content.includes('code auditor'));
  assert.ok(sent.messages[0].content.includes('confirmed'));
  assert.ok(sent.messages[1].content.includes('src/a.js:3'));
  assert.ok(sent.messages[1].content.includes('bare_except'));

  assert.deepEqual(
    result.findings.map((f) => [f.file, f.line, f.severity]),
    [
      ['src/a.js', 3, 'high'],
      ['src/b.py', 4, 'medium'],
    ],
  );
  assert.equal(result.tokensUsed, 321);
  assert.ok(result.reportMarkdown.includes('**1 confirmed issue** found.'));
  assert.ok(result.reportMarkdown.includes('src/a.js:3'));
  assert.ok(result.reportMarkdown.includes('src/b.py:4'));
  assert.ok(result.reportMarkdown.includes('[medium] bare_except'));
});

test('strips markdown json code fences around the model JSON', async () => {
  const calls = mockFetch(() =>
    modelResponse({
      content: 'Sure, here you go:\n```json\n{"findings":[{"index":1,"confirmed":true,"severity":"low","reason":"real"}],"summary_markdown":"hi"}\n```\n',
    }),
  );
  const result = await inspectCandidates({
    candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: '// TODO: x' }],
    apiKey: 'k',
    baseUrl: 'https://x',
    model: 'm',
    maxOutputTokens: 100,
  });
  assert.equal(calls.length, 1);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].file, 'f.js');
  assert.equal(result.findings[0].line, 1);
  assert.equal(result.findings[0].severity, 'low');
  assert.equal(result.tokensUsed, 42);
});

test('throws when the model response content is not valid JSON', async () => {
  mockFetch(() => modelResponse({ content: 'I am not JSON at all' }));
  await assert.rejects(
    () =>
      inspectCandidates({
        candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: 'x' }],
        apiKey: 'k',
        baseUrl: 'https://x',
        model: 'm',
        maxOutputTokens: 100,
      }),
    /not valid JSON/,
  );
});

test('throws on non-2xx API responses', async () => {
  mockFetch(() => jsonResponse(500, { error: 'boom' }));
  await assert.rejects(
    () =>
      inspectCandidates({
        candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: 'x' }],
        apiKey: 'k',
        baseUrl: 'https://x',
        model: 'm',
        maxOutputTokens: 100,
      }),
    /HTTP 500/,
  );
});

test('tokensUsed is null when usage.total_tokens is absent', async () => {
  mockFetch(() =>
    jsonResponse(200, {
      choices: [{ message: { content: JSON.stringify({ findings: [], summary_markdown: '' }) } }],
    }),
  );
  const result = await inspectCandidates({
    candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: 'x' }],
    apiKey: 'k',
    baseUrl: 'https://x',
    model: 'm',
    maxOutputTokens: 100,
  });
  assert.equal(result.tokensUsed, null);
  assert.equal(result.findings.length, 0);
});

test('rejects malformed findings entries without an incidental TypeError', async () => {
  mockFetch(() => modelResponse({ content: JSON.stringify({ findings: [null], summary_markdown: '' }) }));
  const result = await inspectCandidates({
    candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: 'x' }],
    apiKey: 'k', baseUrl: 'https://x', model: 'm', maxOutputTokens: 100,
  });
  assert.deepEqual(result.findings, []);
});

test('rejects a model response with malformed findings', async () => {
  mockFetch(() => modelResponse({ content: JSON.stringify({ summary_markdown: '' }) }));
  await assert.rejects(
    () => inspectCandidates({ candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: 'x' }], apiKey: 'k', baseUrl: 'https://x', model: 'm' }),
    /findings must be an array/,
  );
});

test('rejects a malformed choice without an incidental TypeError', async () => {
  mockFetch(() => jsonResponse(200, { choices: [null] }));
  await assert.rejects(
    () => inspectCandidates({ candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: 'x' }], apiKey: 'k', baseUrl: 'https://x', model: 'm' }),
    /malformed choice/,
  );
});

test('caps snippets by both lines and characters', async () => {
  let sent;
  mockFetch((url, options) => {
    sent = JSON.parse(options.body);
    return modelResponse({ content: JSON.stringify({ findings: [], summary_markdown: '' }) });
  });
  await inspectCandidates({
    candidates: [{ type: 'todo_fixme', file: 'f.js', line: 1, snippet: Array(40).fill('x'.repeat(100)).join('\n') }],
    apiKey: 'k', baseUrl: 'https://x', model: 'm',
  });
  const snippet = sent.messages[1].content.match(/```\n([\s\S]*)\n```/)[1];
  assert.ok(snippet.length <= 1200);
  assert.ok(snippet.split('\n').length <= 30);
});
