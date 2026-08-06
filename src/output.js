function safeFinding(finding, redact = true) {
  const value = { type: finding.type, file: finding.file, line: finding.line, severity: finding.severity, reason: finding.reason };
  if (!redact && finding.snippet) value.snippet = finding.snippet;
  return value;
}

export function renderJson(result, { redact = true } = {}) {
  return JSON.stringify({
    root: result.rootDir,
    candidatesCount: result.candidates.length,
    findingsCount: result.findings.length,
    findings: result.findings.map((finding) => safeFinding(finding, redact)),
    tokensUsed: result.tokensUsed,
    dryRun: result.dryRun,
    reportMarkdown: redact ? undefined : result.reportMarkdown,
  }, null, 2);
}

export function renderMarkdown(result, { redact = true } = {}) {
  const lines = [`# Health Inspector`, '', `Scanned: \`${result.rootDir}\``, ''];
  if (result.dryRun) lines.push('Dry run: candidates were collected but not sent to an LLM.', '');
  if (result.findings.length === 0) {
    lines.push(result.candidates.length ? `Found ${result.candidates.length} candidate(s); no findings were confirmed.` : 'No findings.');
  } else {
    lines.push(`## Confirmed findings (${result.findings.length})`, '');
    for (const finding of result.findings) {
      lines.push(`- **${finding.file}:${finding.line}** [${finding.severity}] ${finding.type}${finding.reason ? ` - ${finding.reason}` : ''}`);
    }
  }
  if (!redact && result.reportMarkdown) lines.push('', result.reportMarkdown);
  return lines.join('\n');
}
