import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { completeOpenAI } from '../src/providers/openai.js';
import { completeClaude } from '../src/providers/claude.js';
import { completeKimi } from '../src/providers/kimi.js';
import { completeHermes } from '../src/providers/hermes.js';
import { completeOpenCode } from '../src/providers/opencode.js';
import { resolveProvider, listProviders, PROVIDERS } from '../src/providers/index.js';
import { inspectCandidates } from '../src/inspect.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function mockFetch(impl) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options, calls);
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

const SAMPLE_CANDIDATES = [
  { type: 'secret_like', file: 'src/a.js', line: 3, snippet: 'const api_key = "0123456789abcdef";' },
  { type: 'bare_except', file: 'src/b.py', line: 4, snippet: 'except:' },
];

const SAMPLE_MODEL_JSON = JSON.stringify({
  findings: [
    { index: 1, confirmed: true, severity: 'high', reason: 'real secret' },
    { index: 2, confirmed: true, severity: 'medium', reason: 'swallows errors' },
  ],
  summary_markdown: '**2 confirmed issues** found.',
});

test('openai: hits /chat/completions with correct headers and body shape', async () => {
  const calls = mockFetch(() => modelResponse({ content: SAMPLE_MODEL_JSON, totalTokens: 123 }));

  const result = await completeOpenAI({
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4',
    system: 'sys',
    user: 'user-content',
    maxTokens: 500,
    fetchImpl: globalThis.fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk-test');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'gpt-4');
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 500);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages[0].content, 'sys');
  assert.equal(body.messages[1].role, 'user');
  assert.equal(body.messages[1].content, 'user-content');

  assert.equal(result.tokensUsed, 123);
  assert.equal(typeof result.content, 'string');
});

test('openai: throws on non-2xx with HTTP status in message', async () => {
  mockFetch(() => jsonResponse(500, { error: 'boom' }));
  await assert.rejects(
    () =>
      completeOpenAI({
        apiKey: 'k',
        baseUrl: 'https://x',
        model: 'm',
        system: 's',
        user: 'u',
        maxTokens: 10,
        fetchImpl: globalThis.fetch,
      }),
    /HTTP 500/,
  );
});

test('claude: hits /v1/messages with x-api-key, anthropic-version, system top-level', async () => {
  const calls = mockFetch(() =>
    jsonResponse(200, {
      content: [{ type: 'text', text: SAMPLE_MODEL_JSON }],
      usage: { input_tokens: 50, output_tokens: 75 },
    }),
  );

  const result = await completeClaude({
    apiKey: 'sk-ant-xxx',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    system: 'sys',
    user: 'user-content',
    maxTokens: 800,
    fetchImpl: globalThis.fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['x-api-key'], 'sk-ant-xxx');
  assert.equal(calls[0].options.headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0].options.headers['content-type'], 'application/json');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'claude-haiku-4-5');
  assert.equal(body.max_tokens, 800);
  assert.equal(body.temperature, 0);
  assert.equal(body.system, 'sys');
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, 'user');
  assert.equal(body.messages[0].content, 'user-content');

  assert.equal(result.tokensUsed, 125);
  assert.equal(result.content, SAMPLE_MODEL_JSON);
});

test('claude: joins multiple text blocks', async () => {
  mockFetch(() =>
    jsonResponse(200, {
      content: [
        { type: 'thinking', text: 'hidden' },
        { type: 'text', text: '{"findings":[' },
        { type: 'text', text: '],"summary_markdown":"ok"}' },
      ],
      usage: { input_tokens: 10, output_tokens: 20 },
    }),
  );

  const result = await completeClaude({
    apiKey: 'k',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    system: 's',
    user: 'u',
    maxTokens: 100,
    fetchImpl: globalThis.fetch,
  });

  assert.equal(result.content, '{"findings":[],"summary_markdown":"ok"}');
  assert.equal(result.tokensUsed, 30);
});

test('kimi: defaults to moonshot base and kimi-k2.5 with thinking disabled', async () => {
  const calls = mockFetch(() => modelResponse({ content: SAMPLE_MODEL_JSON, totalTokens: 88 }));

  const result = await completeKimi({
    apiKey: 'kimi-key',
    system: 'sys',
    user: 'u',
    maxTokens: 300,
    fetchImpl: globalThis.fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.moonshot.ai/v1/chat/completions');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'kimi-k2.5');
  assert.deepEqual(body.thinking, { type: 'disabled' });
  assert.equal(result.tokensUsed, 88);
});

test('kimi: omits thinking when disableThinking is false', async () => {
  const calls = mockFetch(() => modelResponse({ content: '{}' }));

  await completeKimi({
    apiKey: 'k',
    system: 's',
    user: 'u',
    maxTokens: 100,
    disableThinking: false,
    fetchImpl: globalThis.fetch,
  });

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.thinking, undefined);
});

test('hermes: defaults to openrouter base and hermes-3 model', async () => {
  const calls = mockFetch(() => modelResponse({ content: SAMPLE_MODEL_JSON, totalTokens: 200 }));

  const result = await completeHermes({
    apiKey: 'or-key',
    system: 'sys',
    user: 'u',
    maxTokens: 400,
    fetchImpl: globalThis.fetch,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'nousresearch/hermes-3-llama-3.1-70b');
  assert.equal(result.tokensUsed, 200);
});

test('hermes: adds HTTP-Referer and X-Title headers when provided', async () => {
  const calls = mockFetch(() => modelResponse({ content: '{}' }));

  await completeHermes({
    apiKey: 'k',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'm',
    system: 's',
    user: 'u',
    maxTokens: 100,
    httpReferer: 'https://myapp.example.com',
    xTitle: 'My App',
    fetchImpl: globalThis.fetch,
  });

  assert.equal(calls[0].options.headers['HTTP-Referer'], 'https://myapp.example.com');
  assert.equal(calls[0].options.headers['X-Title'], 'My App');
});

test('opencode: session create -> message -> delete flow with text part extraction', async () => {
  const calls = mockFetch((url, options, allCalls) => {
    if (url.endsWith('/session') && options.method === 'POST') {
      return jsonResponse(200, { id: 'sess-123' });
    }
    if (url.includes('/session/sess-123/message')) {
      return jsonResponse(200, {
        parts: [{ type: 'text', text: 'pre' }, { type: 'text', text: SAMPLE_MODEL_JSON }],
      });
    }
    if (url.includes('/session/sess-123') && options.method === 'DELETE') {
      return jsonResponse(200, {});
    }
    throw new Error(`unexpected call: ${url}`);
  });

  const result = await completeOpenCode({
    baseUrl: 'http://127.0.0.1:4096',
    model: 'anthropic/claude-sonnet-4-20250514',
    system: 'sys',
    user: 'user-content',
    maxTokens: 500,
    fetchImpl: globalThis.fetch,
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, 'http://127.0.0.1:4096/session');
  assert.equal(calls[1].url, 'http://127.0.0.1:4096/session/sess-123/message');
  assert.equal(calls[2].url, 'http://127.0.0.1:4096/session/sess-123');

  const msgBody = JSON.parse(calls[1].options.body);
  assert.deepEqual(msgBody.model, { providerID: 'anthropic', modelID: 'claude-sonnet-4-20250514' });
  assert.deepEqual(msgBody.parts, [{ type: 'text', text: 'user-content' }]);
  assert.equal(msgBody.system, 'sys');

  assert.equal(result.content, `pre${SAMPLE_MODEL_JSON}`);
  assert.equal(result.tokensUsed, 0);
});

test('opencode: uses Basic auth when apiKey provided', async () => {
  const calls = mockFetch((url) => {
    if (url.endsWith('/session')) return jsonResponse(200, { id: 'sess-1' });
    if (url.includes('/message')) return jsonResponse(200, { parts: [{ type: 'text', text: '{}' }] });
    return jsonResponse(200, {});
  });

  await completeOpenCode({
    baseUrl: 'http://127.0.0.1:4096',
    model: 'm',
    apiKey: 'secret',
    system: 's',
    user: 'u',
    maxTokens: 100,
    fetchImpl: globalThis.fetch,
  });

  const expected = `Basic ${Buffer.from('opencode:secret').toString('base64')}`;
  assert.equal(calls[0].options.headers.Authorization, expected);
});

test('opencode: DELETE failure is ignored (best-effort cleanup)', async () => {
  mockFetch((url, options) => {
    if (url.endsWith('/session') && (!options.method || options.method === 'POST')) {
      return jsonResponse(200, { id: 'sess-clean' });
    }
    if (url.includes('/message')) {
      return jsonResponse(200, { parts: [{ type: 'text', text: '{}' }] });
    }
    if (options && options.method === 'DELETE') {
      throw new Error('network down during delete');
    }
    return jsonResponse(200, {});
  });

  const result = await completeOpenCode({
    baseUrl: 'http://127.0.0.1:4096',
    model: 'm',
    system: 's',
    user: 'u',
    maxTokens: 100,
    fetchImpl: globalThis.fetch,
  });

  assert.ok(result);
});

test('opencode: object model passed through as-is', async () => {
  const calls = mockFetch((url) => {
    if (url.endsWith('/session')) return jsonResponse(200, { id: 'sess-obj' });
    if (url.includes('/message')) return jsonResponse(200, { parts: [{ type: 'text', text: '{}' }] });
    return jsonResponse(200, {});
  });

  await completeOpenCode({
    baseUrl: 'http://127.0.0.1:4096',
    model: { providerID: 'openai', modelID: 'gpt-4o' },
    system: 's',
    user: 'u',
    maxTokens: 100,
    fetchImpl: globalThis.fetch,
  });

  const msgBody = JSON.parse(calls[1].options.body);
  assert.deepEqual(msgBody.model, { providerID: 'openai', modelID: 'gpt-4o' });
});

test('resolveProvider: resolves primary names', () => {
  assert.equal(resolveProvider('openai'), PROVIDERS.openai);
  assert.equal(resolveProvider('claude'), PROVIDERS.claude);
  assert.equal(resolveProvider('kimi'), PROVIDERS.kimi);
  assert.equal(resolveProvider('hermes'), PROVIDERS.hermes);
  assert.equal(resolveProvider('opencode'), PROVIDERS.opencode);
});

test('resolveProvider: resolves aliases', () => {
  assert.equal(resolveProvider('anthropic'), PROVIDERS.claude);
  assert.equal(resolveProvider('moonshot'), PROVIDERS.kimi);
});

test('resolveProvider: is case-insensitive', () => {
  assert.equal(resolveProvider('OpenAI'), PROVIDERS.openai);
  assert.equal(resolveProvider('CLAUDE'), PROVIDERS.claude);
});

test('resolveProvider: defaults to openai', () => {
  assert.equal(resolveProvider(), PROVIDERS.openai);
  assert.equal(resolveProvider(undefined), PROVIDERS.openai);
});

test('resolveProvider: throws on unknown provider with supported list', () => {
  assert.throws(() => resolveProvider('nonexistent'), /Unknown provider 'nonexistent'/);
  try {
    resolveProvider('foo');
  } catch (err) {
    assert.ok(err.message.includes('openai'));
    assert.ok(err.message.includes('claude'));
    assert.ok(err.message.includes('kimi'));
    assert.ok(err.message.includes('hermes'));
    assert.ok(err.message.includes('opencode'));
    assert.ok(!err.message.includes('anthropic'));
    assert.ok(!err.message.includes('moonshot'));
  }
});

test('listProviders returns primary names only', () => {
  assert.deepEqual(listProviders(), ['openai', 'claude', 'kimi', 'hermes', 'opencode']);
});

test('inspectCandidates: end-to-end with claude provider returns findings', async () => {
  mockFetch(() =>
    jsonResponse(200, {
      content: [{ type: 'text', text: SAMPLE_MODEL_JSON }],
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  );

  const result = await inspectCandidates({
    candidates: SAMPLE_CANDIDATES,
    apiKey: 'sk-ant-key',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-haiku-4-5',
    maxOutputTokens: 600,
    provider: 'claude',
  });

  assert.equal(result.findings.length, 2);
  assert.equal(result.findings[0].file, 'src/a.js');
  assert.equal(result.findings[0].severity, 'high');
  assert.equal(result.findings[0].reason, 'real secret');
  assert.equal(result.findings[1].file, 'src/b.py');
  assert.equal(result.findings[1].severity, 'medium');
  assert.equal(result.tokensUsed, 150);
  assert.ok(result.reportMarkdown.includes('**2 confirmed issues** found.'));
});

test('inspectCandidates: opencode provider does not require apiKey', async () => {
  mockFetch((url, options) => {
    if (url.endsWith('/session') && (!options.method || options.method === 'POST')) {
      return jsonResponse(200, { id: 'sess-opencode' });
    }
    if (url.includes('/message')) {
      return jsonResponse(200, {
        parts: [{ type: 'text', text: SAMPLE_MODEL_JSON }],
      });
    }
    return jsonResponse(200, {});
  });

  const result = await inspectCandidates({
    candidates: SAMPLE_CANDIDATES,
    baseUrl: 'http://127.0.0.1:4096',
    model: 'm',
    provider: 'opencode',
  });

  assert.equal(result.findings.length, 2);
});
