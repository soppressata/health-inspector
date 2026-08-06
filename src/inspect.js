const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
const DEFAULT_MAX_OUTPUT_TOKENS = 1000;

const SYSTEM_PROMPT = `You are a terse code auditor. A static scanner produced the numbered candidate list below. For each candidate decide whether it is a genuine code problem or a false positive (for example a harmless TODO, a placeholder value, or a misdetected test fixture).

Rules:
- Reject false positives with "confirmed": false and move on.
- Only confirm real issues; give each confirmed issue one concise reason and a severity of "low", "medium", or "high".
- Keep reasons to one sentence.

Reply with STRICT JSON only, using exactly this shape:
{
  "findings": [
    { "index": 1, "confirmed": true, "severity": "medium", "reason": "why this is a real problem" }
  ],
  "summary_markdown": "one short markdown report covering all confirmed findings"
}`;

function truncateSnippet(snippet, maxLines = 30, maxChars = 1200) {
  const text = String(snippet ?? '');
  const lines = text.split('\n');
  if (lines.length > maxLines) {
    return `${lines.slice(0, maxLines).join('\n')}\n... (truncated)`;
  }
  if (text.length > maxChars) {
    return `${text.slice(0, maxChars)}... (truncated)`;
  }
  return text;
}

function buildUserContent(candidates) {
  const entries = candidates.map((c, i) => {
    const snippet = truncateSnippet(c.snippet);
    return `${i + 1}. [${c.type}] ${c.file}:${c.line}\n\`\`\`\n${snippet}\n\`\`\``;
  });
  return `Audit these ${candidates.length} candidates:\n\n${entries.join('\n\n')}`;
}

function parseJsonContent(content) {
  const text = String(content ?? '').trim();
  if (!text) throw new Error('Model response was empty');
  try {
    return JSON.parse(text);
  } catch {
    // fall through to fence / brace extraction
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // fall through to brace extraction
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      // fall through
    }
  }
  throw new Error('Model response was not valid JSON');
}

function buildReport(findings, summaryMarkdown) {
  const out = ['## Health Inspector findings', ''];
  if (typeof summaryMarkdown === 'string' && summaryMarkdown.trim()) {
    out.push(summaryMarkdown.trim(), '');
  }
  if (findings.length > 0) {
    out.push('### Confirmed findings', '');
    for (const f of findings) {
      const reason = f.reason ? ` — ${f.reason}` : '';
      out.push(`- **${f.file}:${f.line}** [${f.severity}] ${f.type}${reason}`);
    }
  }
  return out.join('\n').trim();
}

export async function inspectCandidates({ candidates, apiKey, baseUrl, model, maxOutputTokens } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) {
    return { findings: [], reportMarkdown: null, tokensUsed: 0 };
  }
  if (!apiKey) throw new Error('inspectCandidates: apiKey is required');
  if (!baseUrl) throw new Error('inspectCandidates: baseUrl is required');
  if (!model) throw new Error('inspectCandidates: model is required');

  const maxTokens =
    Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : DEFAULT_MAX_OUTPUT_TOKENS;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const body = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(list) },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  };

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(`inspectCandidates: network error calling ${url}: ${err.message}`);
  }

  let rawText;
  try {
    rawText = await response.text();
  } catch (err) {
    throw new Error(`inspectCandidates: failed to read LLM API response: ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(
      `inspectCandidates: LLM API error HTTP ${response.status}: ${String(rawText).slice(0, 300)}`,
    );
  }
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('inspectCandidates: LLM API response had no choices');
  }

  const content = data.choices[0].message && data.choices[0].message.content;
  const parsed = parseJsonContent(content);

  const modelFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
  const findings = [];
  for (const f of modelFindings) {
    if (f.confirmed !== true) continue;
    const index = Number(f.index);
    const candidate = list[index - 1];
    if (!candidate) continue;
    findings.push({
      ...candidate,
      confirmed: true,
      severity: VALID_SEVERITIES.has(f.severity) ? f.severity : 'medium',
      reason: String(f.reason ?? '').trim(),
    });
  }

  const tokensUsed = Number.isFinite(Number(data.usage && data.usage.total_tokens))
    ? Number(data.usage.total_tokens)
    : null;

  const reportMarkdown = buildReport(findings, parsed.summary_markdown);
  return { findings, reportMarkdown, tokensUsed };
}
