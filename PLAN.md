# Expansion Plan

## Product Shape

Keep one provider-agnostic inspection pipeline and put integrations at its
edges:

1. Scanner: deterministic, bounded candidate generation.
2. Inspector: one OpenAI-compatible model request, with strict response validation.
3. Result: stable findings, fingerprints, counts, token usage, and Markdown.
4. Adapters: GitHub issue/state, local CLI output/state, and outbound webhooks.

The CLI and Action should share scanner and inspector behavior but must not share
authentication or persistence assumptions.

## Delivered In This Iteration

- Local executable with Markdown/JSON output, offline/dry-run modes, validation,
  secret-safe default output, and CI-friendly exit codes.
- Webhook POST adapter with sanitized payloads, delivery IDs, header validation,
  timeout, bounded retries, and best-effort failure handling.
- Action webhook inputs and output, delivered after issue/state persistence.
- State preservation when a run has no new findings.
- Fingerprints that distinguish repeated findings on different lines.
- Safer model-response validation, snippet bounds, `catch {}` detection, and
  standard untracked-file inclusion in full scans.

## Next Phases

### Phase 1: Local Tooling

- Add `.health-inspector.json` configuration with precedence `flags > env > file > defaults`.
- Add local state with atomic writes and an explicit `--since`/state policy.
- Add `--fail-on`, SARIF, GitHub annotation, and per-rule enable/disable controls.
- Add parser-backed JavaScript/Python rules once scanner noise justifies the dependency.

### Phase 2: Reliable Delivery

- Add workflow concurrency and optimistic state-update retries for concurrent Actions.
- Persist a candidate backlog so `max-candidates` cannot permanently skip findings.
- Add webhook HMAC signing, replay windows, and an optional durable outbox.
- Add direct GitHub client timeouts and retry classification.

### Phase 3: Distribution

- Publish the CLI package and maintain an immutable Action release tag plus floating
  major tag.
- Add fresh-clone acceptance tests, actionlint/YAML validation, and a bundled CLI smoke test.
- Add SARIF/check-run output for code-scanning integrations.

## Safety Rules

- Never send raw secret-looking snippets to the model, issue body, webhook, or logs.
- Never expose write-capable GitHub credentials to untrusted fork code.
- Keep notifications after durable issue/state work and include an idempotency key.
- Bound every external request and every model prompt/response.
