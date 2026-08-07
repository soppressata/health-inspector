export async function completeClaude({
  apiKey,
  baseUrl = 'https://api.anthropic.com',
  model = 'claude-haiku-4-5',
  system,
  user,
  maxTokens,
  temperature = 0,
  timeoutMs = 30000,
  fetchImpl = fetch,
  anthropicVersion = '2023-06-01',
} = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
  };

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': anthropicVersion,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Claude provider error calling ${url}: ${err.message}`);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (err) {
    throw new Error(`Claude provider: failed to read response: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      `Claude provider error HTTP ${response.status}: ${String(rawText).slice(0, 300)}`,
    );
  }
  if (!data || !Array.isArray(data.content)) {
    throw new Error('Claude provider response had no content blocks');
  }

  const content = data.content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');

  const tokensUsed = (data.usage && ((data.usage.input_tokens || 0) + (data.usage.output_tokens || 0))) || 0;

  return { content, tokensUsed };
}
