import http from 'node:http';

/**
 * Minimal stand-in for an OpenAI-compatible /chat/completions endpoint, used
 * only by .github/workflows/self-test.yml so the end-to-end pipeline can be
 * proven on real GitHub Actions infrastructure without a paid LLM key.
 * Confirms every candidate the real prompt lists, with severity 'medium'.
 */
const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) {
    res.writeHead(404).end();
    return;
  }
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let candidateCount = 0;
    try {
      const parsed = JSON.parse(raw);
      const content = parsed.messages?.map((m) => m.content).join('\n') || '';
      const matches = content.match(/^\d+\.\s/gm) || [];
      candidateCount = matches.length;
    } catch {
      candidateCount = 0;
    }

    const findings = Array.from({ length: candidateCount }, (_, i) => ({
      index: i + 1,
      confirmed: true,
      severity: 'medium',
      reason: 'mock-llm-server: confirmed for self-test',
    }));

    const payload = {
      findings,
      summary_markdown: `Mock inspection confirmed ${findings.length} finding(s) during self-test.`,
    };

    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { total_tokens: 0 },
    });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(body);
  });
});

const port = process.env.MOCK_LLM_PORT || 8842;
server.listen(port, () => {
  console.log(`[mock-llm-server] listening on ${port}`);
});
