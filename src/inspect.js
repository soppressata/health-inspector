import {
  SYSTEM_PROMPT,
  redactCandidate,
  buildUserContent,
  parseJsonContent,
  buildReport,
  DEFAULT_MAX_OUTPUT_TOKENS,
  mapModelFindings,
} from './providers/shared.js';
import { resolveProvider } from './providers/index.js';

export async function inspectCandidates({
  candidates,
  apiKey,
  baseUrl,
  model,
  maxOutputTokens,
  timeoutMs = 30000,
  provider = 'openai',
  fetchImpl,
  ...providerOpts
} = {}) {
  const list = Array.isArray(candidates) ? candidates.map(redactCandidate) : [];
  if (list.length === 0) {
    return { findings: [], reportMarkdown: null, tokensUsed: 0 };
  }

  if (provider !== 'opencode') {
    if (!apiKey) throw new Error('inspectCandidates: apiKey is required');
    if (!baseUrl) throw new Error('inspectCandidates: baseUrl is required');
    if (!model) throw new Error('inspectCandidates: model is required');
  }

  const maxTokens =
    Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? maxOutputTokens
      : DEFAULT_MAX_OUTPUT_TOKENS;

  const complete = resolveProvider(provider);
  const { content, tokensUsed } = await complete({
    apiKey,
    baseUrl,
    model,
    system: SYSTEM_PROMPT,
    user: buildUserContent(list),
    maxTokens,
    timeoutMs,
    fetchImpl,
    ...providerOpts,
  });

  const parsed = parseJsonContent(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('inspectCandidates: model response JSON must be an object');
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error('inspectCandidates: model response findings must be an array');
  }

  const findings = mapModelFindings(list, parsed);
  const reportMarkdown = buildReport(findings, parsed.summary_markdown);
  return { findings, reportMarkdown, tokensUsed };
}
