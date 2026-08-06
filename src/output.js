import { SCAN_RULES } from './scan.js';

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

export function renderMarkdownTable(result, { redact = true } = {}) {
  const lines = ['| File | Line | Type | Severity | Reason |', '| --- | --- | --- | --- | --- |'];
  for (const finding of result.findings) {
    let reason = finding.reason || '';
    if (!redact && finding.snippet) reason += `\n\`\`\`\n${finding.snippet}\n\`\`\``;
    lines.push(`| ${finding.file} | ${finding.line} | ${finding.type} | ${finding.severity} | ${reason} |`);
  }
  return lines.join('\n');
}

const SARIF_LEVEL = { high: 'error', medium: 'warning', low: 'note' };

export function renderSarif(result) {
  const rules = Object.entries(SCAN_RULES).map(([id, meta]) => ({ id, name: meta.description }));
  const results = result.findings.map((finding) => ({
    ruleId: finding.type,
    level: SARIF_LEVEL[finding.severity] || 'note',
    message: { text: finding.reason ? `${finding.type}: ${finding.reason}` : finding.type },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: finding.file },
        region: { startLine: finding.line },
      },
    }],
  }));
  return JSON.stringify({
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: {
        driver: { name: 'health-inspector', version: '0.1.0', rules },
      },
      results,
    }],
  }, null, 2);
}

function escapeGhParam(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
    .replace(/,/g, '%2C')
    .replace(/:/g, '%3A');
}

function escapeGhMessage(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

export function renderGithubAnnotation(result) {
  const lines = [];
  for (const finding of result.findings) {
    const level = finding.severity === 'high' ? 'error' : 'warning';
    const message = finding.reason ? `${finding.type}: ${finding.reason}` : finding.type;
    lines.push(
      `::${level} file=${escapeGhParam(finding.file)},line=${finding.line},title=${escapeGhParam(finding.type)}::${escapeGhMessage(message)}`,
    );
  }
  return lines.join('\n');
}

export function formatResult(result, format, opts = {}) {
  switch (format) {
    case 'json': return renderJson(result, opts);
    case 'markdown': return renderMarkdown(result, opts);
    case 'markdown-table': return renderMarkdownTable(result, opts);
    case 'sarif': return renderSarif(result);
    case 'github-annotation': return renderGithubAnnotation(result);
    default: throw new Error(`Unknown output format: ${format}`);
  }
}
