export const VALID_SEVERITIES = new Set(['low', 'medium', 'high']);
export const DEFAULT_MAX_OUTPUT_TOKENS = 1000;

export const SYSTEM_PROMPT = `You are a terse code auditor. A static scanner produced the numbered candidate list below. For each candidate decide whether it is a genuine code problem or a false positive (for example a harmless TODO, a placeholder value, or a misdetected test fixture).

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

export function truncateSnippet(snippet, maxLines = 30, maxChars = 1200) {
  const text = String(snippet ?? '');
  const lines = text.split('\n');
  const marker = '... (truncated)';
  const lineLimit = Math.max(1, maxLines);
  const lineTruncated = lines.length > lineLimit;
  let result = lineTruncated ? lines.slice(0, lineLimit).join('\n') : text;
  const truncated = lineTruncated || result.length > maxChars;
  if (!truncated) return result;
  if (maxChars <= marker.length) return marker.slice(0, Math.max(0, maxChars));
  result = result.slice(0, maxChars - marker.length);
  return `${result}${marker}`;
}

export function buildUserContent(candidates) {
  const entries = candidates.map((c, i) => {
    const snippet = truncateSnippet(c.snippet);
    return `${i + 1}. [${c.type}] ${c.file}:${c.line}\n\`\`\`\n${snippet}\n\`\`\``;
  });
  return `Audit these ${candidates.length} candidates:\n\n${entries.join('\n\n')}`;
}

export function redactCandidate(candidate) {
  if (candidate.type !== 'secret_like') return candidate;
  return {
    ...candidate,
    snippet: String(candidate.snippet ?? '')
      .replace(/(AKIA)[0-9A-Z]{16}/g, '$1[REDACTED]')
      .replace(/(-----BEGIN )[A-Z0-9 ]+(PRIVATE KEY-----)/g, '$1[REDACTED]$2')
      .replace(/((?:api[_-]?key|apikey|secret|password)\s*[:=]\s*["'])[^"']+/gi, '$1[REDACTED]'),
  };
}

export function parseJsonContent(content) {
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

export function buildReport(findings, summaryMarkdown) {
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

export function mapModelFindings(list, parsed) {
  if (!parsed || !Array.isArray(parsed.findings)) {
    return [];
  }
  const findings = [];
  for (const f of parsed.findings) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
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
  return findings;
}

export function extractTokens(usage) {
  const n = Number(usage && usage.total_tokens);
  return Number.isFinite(n) ? n : 0;
}
