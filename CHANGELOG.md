# [Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added
- Local CLI (`bin/health-inspector.js`) with JSON/Markdown output, offline and dry-run
  modes, safe defaults that omit snippets, validation, and CI-friendly exit codes.
- Shared inspection core and output renderers (`src/core.js`, `src/output.js`) so local
  scans do not require GitHub credentials or Actions environment variables.
- Outbound webhook delivery (`src/webhook.js`) with sanitized finding payloads, stable
  delivery IDs, header validation, secret headers, bounded timeout, and transient retries.
- Action webhook inputs (`webhook-url`, headers, secret, timeout, retries) and the
  `webhook-delivered` output. Notifications happen after issue/state persistence.
- `PLAN.md` documenting the architecture, delivered scope, next phases, and safety rules.
- Stage 0 static scanner (`src/scan.js`): `todo_fixme`, `secret_like`, `bare_except`,
  `untested_new_function`, `oversized_function`. Deterministic, no LLM calls. Supports
  git-diff-based scanning since the last inspected ref (`sinceRef`), falling back to a
  full scan; candidates ranked and capped at 15 by default (`max-candidates`).
- Stage 1 inspector (`src/inspect.js`): when Stage 0 finds candidates, one batched POST
  to the OpenAI-compatible chat completions API (`base-url`), snippets capped at 30 lines
  / 1200 chars, `temperature` 0, output token cap, JSON-fence-tolerant parsing.
- Issue filing (`src/github.js`): `fileReport` dedups via fingerprints; short-circuits
  with no API call when nothing new; files one issue per run labeled `health-inspector`
  (configurable `label`).
- State persistence (`src/state.js`): `loadState`/`saveState` round-trip `state.json` on
  a dedicated `state-branch` (default `health-inspector-state`) via GitHub contents API
  (404 → defaults); `fingerprintFinding` uses sha1, 12 hex chars, whitespace-normalized.
- GitHub Actions composite action (`action.yml`) — Node.js 20, entrypoint `dist/index.js`,
  15 inputs, including webhook delivery configuration, and 3 outputs.
- `demo/health-inspector-demo/` fixture (`payments.js`): a realistic demo repo with a
  TODO, a detuned fake secret, and a swallowed `catch (e) {}`.
- `demo/mock-llm-server.js`: local OpenAI-compatible stub used by the self-test workflow.
- CI workflow (`.github/workflows/ci.yml`): `node --check` on all `src` files + `npm test`.
- Self-test workflow (`.github/workflows/self-test.yml`): end-to-end run against the demo
  fixture using the mocked LLM.

> `dist/` is produced by `npm run build` (via `ncc`). The v1.0.0 tagged release will pin
> a `v1` major tag per the Actions marketplace convention.

<!-- TYPES: Generated -->
### Changed
### Deprecated
### Removed
### Fixed
- Preserve state when a run has no newly reportable findings, preventing repeated scans
  and duplicate work.
- Include standard untracked files in full scans, distinguish repeated findings by line,
  validate malformed model responses, enforce both snippet limits, and detect `catch {}`.
### Security
- Redact secret-looking values before model inspection and exclude snippets from webhook
  payloads by default. Webhook failures are best-effort after durable Action state writes.
