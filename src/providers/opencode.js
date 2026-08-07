export async function completeOpenCode({
  apiKey,
  baseUrl = 'http://127.0.0.1:4096',
  model,
  system,
  user,
  maxTokens,
  timeoutMs = 60000,
  fetchImpl = fetch,
  username = 'opencode',
} = {}) {
  const authHeaders = {};
  if (apiKey) {
    authHeaders['Authorization'] = `Basic ${Buffer.from(`${username}:${apiKey}`).toString('base64')}`;
  }

  const base = baseUrl.replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  let sessionId;
  try {
    let response;
    try {
      response = await fetchImpl(`${base}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ title: 'health-inspector' }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(`OpenCode provider error creating session: ${err.message}`);
    }

    let rawText;
    try {
      rawText = await response.text();
    } catch (err) {
      throw new Error(`OpenCode provider: failed to read session response: ${err.message}`);
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok || !data) {
      throw new Error(
        `OpenCode provider error creating session HTTP ${response.status}: ${String(rawText).slice(0, 300)}`,
      );
    }

    sessionId = data.id || (data.data && data.data.id);
    if (!sessionId) {
      throw new Error('OpenCode provider: no session id in response');
    }
  } finally {
    clearTimeout(timeout);
  }

  try {
    const messageBody = {
      system,
      parts: [{ type: 'text', text: user }],
    };
    if (typeof model === 'string' && model.includes('/')) {
      const [providerID, modelID] = model.split('/');
      messageBody.model = { providerID, modelID };
    } else if (model && typeof model === 'object' && !Array.isArray(model)) {
      messageBody.model = model;
    }

    let response;
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), Math.max(1, timeoutMs));
    try {
      response = await fetchImpl(`${base}/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(messageBody),
        signal: controller2.signal,
      });
    } catch (err) {
      throw new Error(`OpenCode provider error sending message: ${err.message}`);
    }

    let rawText;
    try {
      rawText = await response.text();
    } catch (err) {
      throw new Error(`OpenCode provider: failed to read message response: ${err.message}`);
    } finally {
      clearTimeout(timeout2);
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }

    if (!response.ok || !data) {
      throw new Error(
        `OpenCode provider error sending message HTTP ${response.status}: ${String(rawText).slice(0, 300)}`,
      );
    }

    const parts = data.parts || (data.data && data.data.parts) || [];
    const content = parts
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');

    const tokensUsed = (data.usage && Number(data.usage.total_tokens)) || 0;

    return { content, tokensUsed };
  } finally {
    try {
      await fetchImpl(`${base}/session/${sessionId}`, {
        method: 'DELETE',
        headers: { ...authHeaders },
      });
    } catch {
      // ignore cleanup errors
    }
  }
}
