# [Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added

### Changed

### Fixed

### Security

## [1.1.0] - 2026-08-07

### Added
- `buildCliWebhookOptions` helper for testable CLI webhook option assembly.
- Action `scan-paths` input is read into `config.scanPaths`.

### Fixed
- CLI webhook delivery maps HMAC via `signingSecret`/`signatureHeader`; plain `webhookSecret`/`webhookSecretHeader` stay separate.
- Failed webhook deliveries are no longer recorded as delivered; `outboxDir` and local state are passed for retry/replay.
- `fileReport` no longer mutates caller state; returns new `updatedState` with copied fingerprints.
- `verifySignature` accepts raw hex and `sha256=<hex>` (matching `sendWebhook`).
- `inspectCandidates` `tokensUsed` is `0` (not `null`) when model omits usage.
- GitHub Contents API paths encode segments individually so nested paths keep slashes.

### Changed
- CI installs actionlint from a pinned direct release tarball (v1.7.7) instead of scraping the GitHub Releases API.
- Workflow shell scripts cleaned for actionlint/shellcheck SC2034.

### Security
- CLI no longer places the HMAC signing secret into the plain shared-secret header.

## [1.0.0] - 2026-08-06

### Added
- **Local CLI** (`bin/health-inspector.js`) with `--format json|markdown|sarif|github-annotation|markdown-table`, `--offline`, `--dry-run`, `--include-snippets`, validation, safe defaults that omit snippets, and CI-friendly exit codes (0 clean, 1 findings, 2 invalid options, 3 failures).
- **Shared inspection core** and output renderers (`src/core.js`, `src/output.js`) so local scans do not require GitHub credentials or Actions environment variables.
- **Config file support** (`.health-inspector.json`) with precedence `flags > env > file > defaults` (`src/config.js`): `loadConfigFile`, `envToConfig` mapping `HEALTH_INSPECTOR_*` env vars, `resolveConfig`, and `validateConfig` for `maxCandidates`, `probability`, `oversizedFunctionLines`, `failOn`, `rules`, and `excludeRules`.
- **Local state** (`.health-inspector/state.json` via `src/local-state.js`) with atomic writes (temp file + fsync + rename), `lastScannedRef`, `filedFingerprints`, delivery log, and a 7-day replay window (`REPLAY_WINDOW_MS`). `--state-file` and `--outbox-dir` configure it.
- **Durable webhook outbox**: failed deliveries are persisted to `--outbox-dir` and drained on the next run via `drainOutbox`; `drainPrevious` option drains the outbox before the current delivery.
- **Outbound webhook delivery** (`src/webhook.js`) with sanitized finding payloads (`buildWebhookPayload` omits snippets), stable delivery IDs (`makeDeliveryId`), header validation (`validateHeaders`), secret headers, bounded timeout, transient retries, and replay protection.
- **Webhook HMAC-SHA256 signing** (`signPayload` / `verifySignature`): payloads signed with `sha256=<hex>` in `X-Health-Inspector-Signature` (configurable via `webhook-signature-header` / `--webhook-signature-header`), timing-safe comparison, header-injection prevention.
- **CLI webhook delivery**: `--webhook-url` fires webhooks from the local CLI, using local state for replay protection and `--webhook-signing-secret` for HMAC signing.
- **`--fail-on` severity threshold** (`none|low|medium|high|all`, default `all`) controlling which findings trigger a non-zero CLI exit code.
- **Per-rule controls**: `--rules` and `--exclude-rules` (comma-separated, also via `HEALTH_INSPECTOR_RULES` / `HEALTH_INSPECTOR_EXCLUDE_RULES`), `SCAN_RULES` export with severity hints and file-type coverage, `listRules()`, and rule-name validation in `scanRepo`.
- **Configurable oversized-function threshold**: `--oversized-lines` / `oversizedFunctionLines` (default 80 lines).
- **SARIF output** (`--format sarif`) — SARIF 2.1.0 document for GitHub code-scanning integration.
- **GitHub annotation output** (`--format github-annotation`) — emits `::error`/`::warning` workflow commands.
- **GitHub client hardening** (`src/github.js`): `makeGithubClient` with per-request timeout (AbortController), exponential-backoff retries for transient failures, and `isRetryable` classification (408, 425, 429, 5xx).
- **Action inputs**: `webhook-signing-secret`, `webhook-signature-header`, `github-request-timeout-ms`, `github-max-retries`, `scan-paths`.
- **Action outputs**: `webhook-delivered` and `webhook-delivery-id` for webhook delivery tracking.
- **Action config pass-through**: `buildActionConfig` and `buildGithubClientOptions` resolve Action inputs using the same `flags > env > file > defaults` precedence as the CLI.
- **Stage 0 static scanner** (`src/scan.js`): `todo_fixme`, `secret_like`, `bare_except`, `untested_new_function`, `oversized_function`. Deterministic, no LLM calls. Supports git-diff-based scanning since the last inspected ref (`sinceRef`), falling back to a full scan; candidates ranked and capped at 15 by default (`max-candidates`).
- **Stage 1 inspector** (`src/inspect.js`): when Stage 0 finds candidates, one batched POST to the OpenAI-compatible chat completions API (`base-url`), snippets capped at 30 lines / 1200 chars, `temperature` 0, output token cap, JSON-fence-tolerant parsing.
- **Issue filing** (`src/github.js`): `fileReport` dedups via fingerprints; short-circuits with no API call when nothing new; files one issue per run labeled `health-inspector` (configurable `label`).
- **State persistence** (`src/state.js`): `loadState`/`saveState` round-trip `state.json` on a dedicated `state-branch` (default `health-inspector-state`) via GitHub contents API (404 → defaults); `fingerprintFinding` uses sha1, 12 hex chars, whitespace-normalized.
- **GitHub Actions composite action** (`action.yml`) — Node.js 20, entrypoint `dist/index.js`, 20 inputs, and 4 outputs.
- **`demo/health-inspector-demo/`** fixture (`payments.js`): a realistic demo repo with a TODO, a detuned fake secret, and a swallowed `catch (e) {}`.
- **`demo/mock-llm-server.js`**: local OpenAI-compatible stub used by the self-test workflow.
- **CI workflow** (`.github/workflows/ci.yml`): `node --check` on all `src` files + `npm test` + dist drift check + CLI smoke test.
- **Acceptance workflow** (`.github/workflows/acceptance.yml`): CLI smoke test on a fresh checkout (exit code 0 or 1, valid JSON, clean local state).
- **Self-test workflow** (`.github/workflows/self-test.yml`): end-to-end run against the demo fixture using the mocked LLM.
- **Release workflow** (`.github/workflows/release.yml`): tag-triggered GitHub Release from `CHANGELOG.md` and `v1` major-tag promotion.
- **`PLAN.md`**: documented architecture, delivered scope, next phases, and safety rules.

### Changed
- `package.json` is now `private: false` with a `prepare` script that runs `npm run build`.
- `dist/index.js` is rebuilt and in sync with all `src/` changes.

### Fixed
- Preserve state when a run has no newly reportable findings, preventing repeated scans and duplicate work.
- Include standard untracked files in full scans, distinguish repeated findings by line, validate malformed model responses, enforce both snippet limits, and detect `catch {}`.

### Security
- Redact secret-looking values before model inspection and exclude snippets from webhook payloads by default. Webhook failures are best-effort after durable Action state writes.

[Unreleased]: https://github.com/soppressata/health-inspector/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/soppressata/health-inspector/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/soppressata/health-inspector/releases/tag/v1.0.0
