import { extractTokens } from './shared.js';

export async function completeOpenAI({
  apiKey,
  baseUrl,
  model,
  system,
  user,
  maxTokens,
  temperature = 0,
  timeoutMs = 30000,
  fetchImpl = fetch,
} = {}) {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  };

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`OpenAI provider error calling ${url}: ${err.message}`);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (err) {
    throw new Error(`OpenAI provider: failed to read response: ${err.message}`);
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
      `OpenAI provider error HTTP ${response.status}: ${String(rawText).slice(0, 300)}`,
    );
  }
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('OpenAI provider response had no choices');
  }

  const choice = data.choices[0];
  if (!choice || typeof choice !== 'object' || !choice.message || typeof choice.message !== 'object') {
    throw new Error('OpenAI provider response had a malformed choice');
  }

  return {
    content: choice.message.content,
    tokensUsed: extractTokens(data.usage),
  };
}
