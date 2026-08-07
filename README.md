# Health Inspector

A GitHub Action that shows up unannounced, does a deep audit of your repo, and
files a report only when it finds real violations — like a real health
inspector. Bring your own LLM API key (DeepSeek Flash recommended: **$0.28 /
million tokens**); most runs on a healthy repo cost **zero tokens**.

[![CI](https://img.shields.io/github/actions/workflow/status/soppressata/health-inspector/ci.yml?branch=main&label=CI)](https://github.com/soppressata/health-inspector/actions/workflows/ci.yml)
[![Self-test](https://img.shields.io/github/actions/workflow/status/soppressata/health-inspector/self-test.yml?branch=main&label=Self-test)](https://github.com/soppressata/health-inspector/actions/workflows/self-test.yml)
[![Acceptance](https://img.shields.io/github/actions/workflow/status/soppressata/health-inspector/acceptance.yml?branch=main&label=Acceptance)](https://github.com/soppressata/health-inspector/actions/workflows/acceptance.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why it's cheap

Most repo-scanning bots dump your whole codebase into an LLM on every run.
Health Inspector doesn't:

1. **Stage 0 (free):** a deterministic static scan of only what changed since the
   last inspection — TODOs, swallowed exceptions, untested new code,
   secret-looking strings, oversized functions. No LLM call.
2. **Stage 1 (cheap, capped):** only if Stage 0 finds candidates, one single
   batched request with truncated snippets and a hard output-token cap asks the
   model to confirm, rank, and write one report.
3. Nothing found in Stage 0 → the whole run costs 0 tokens.

Scheduled runs are further throttled by `probability` (default `1.0`), so you can
make inspections feel genuinely unannounced.

## Quickstart

```yaml
name: Health Inspector
on:
  schedule: [{cron: '17 */6 * * *'}]
  workflow_dispatch: {}
jobs:
  inspect:
    runs-on: ubuntu-latest
    permissions:
      contents: write # state branch
      issues: write   # finding reports
    steps:
      - uses: actions/checkout@v4
      - uses: soppressata/health-inspector@v1
        with:
          api-key: ${{ secrets.INSPECTOR_API_KEY }}
          base-url: https://api.deepseek.com
          model: deepseek-chat
          probability: 1.0
          paths: .
          max-candidates: 15
          label: health-inspector
          state-branch: health-inspector-state
          webhook-signing-secret: ${{ secrets.INSPECTOR_WEBHOOK_SIGNING_SECRET }}
```

`api-key` is the only required input. The rest have sensible defaults.

For repositories that do not use GitHub Actions, install the package and run a
local scan:

```sh
npx health-inspector . --offline --format markdown
HEALTH_INSPECTOR_API_KEY=... npx health-inspector . --format json
```

The CLI exits `0` for a clean scan, `1` when findings are confirmed, `2` for
invalid options, and `3` for scan/provider failures. `--dry-run` and `--offline`
never call the LLM. JSON output intentionally omits source snippets by default;
use `--include-snippets` only in a trusted local environment.

For SARIF / code-scanning integration:

```sh
npx health-inspector . --offline --format sarif > results.sarif
```

## How it works

Health Inspector is a two-stage pipeline. The Action entry point is
`src/index.js`; the local CLI is powered by `src/core.js` + `src/output.js`.
Shared modules:

1. **`src/scan.js` — Stage 0.** A deterministic static scanner runs over the
   configured `paths`. It looks for `todo_fixme`, `secret_like`, `bare_except`,
   `untested_new_function`, and `oversized_function`. When the state holds a
   previously-inspected ref, the scan is diffed against it so only new or changed
   candidates are considered; otherwise it scans the whole tree. Candidates are
   ranked and capped at `max-candidates` (default `15`). This stage never calls
   the LLM.

2. **`src/inspect.js` — Stage 1.** If Stage 0 produced candidates, `inspect.js`
   sends one batched POST to the OpenAI-compatible chat completions endpoint at
   `base-url` (default `https://api.deepseek.com`), using `model`
   (default `deepseek-chat`). Snippets are truncated to 30 lines / 1200 chars,
   `temperature` is forced to 0, and the output is capped at a small
   `max_tokens`. The response is parsed with JSON-fence tolerance. If there are
   no candidates, this stage is skipped entirely — hence the 0-token cost on a
   clean repo.

3. **`src/github.js` — report filing + client.** Confirmed findings are grouped
   into a report and filed as a GitHub issue via `fileReport`, which dedups
   against the last run using fingerprints so the same findings don't re-open
   issues on every schedule. Issue labels are controlled by `label` (default
   `health-inspector`). When there is nothing new, `fileReport` short-circuits
   with no API call. `makeGithubClient` provides per-request timeouts,
   exponential-backoff retries for transient failures (`isRetryable`), and
   `isRetryable` classification.

4. **`src/state.js` — Action state persistence.** `saveState` writes a
   `state.json` (last-scanned ref plus the fingerprints of already-filed
   findings) to a dedicated `state-branch` (default `health-inspector-state`)
   via the GitHub contents API; `loadState` reads it back, treating a 404 as
   "first run". Finding fingerprints are sha1, 12 hex chars, whitespace-normalized.

5. **`src/local-state.js` — CLI local state.** The CLI persists state in
   `.health-inspector/state.json` with atomic writes (temp file + fsync + rename)
   and tracks webhook deliveries for replay protection.

6. **`src/webhook.js` — outbound notifications.** Optional webhook delivery with
   sanitized payloads, stable delivery IDs, HMAC-SHA256 signing, replay
   protection (7-day window), a bounded timeout, retries for transient failures,
   and a durable outbox for failed deliveries.

7. **`src/config.js` — config resolution.** Merges flags > env > `.health-inspector.json` >
   defaults with validation.

The Action exposes four outputs: `findings-count` (number of confirmed findings
this run), `report-url` (URL of the filed issue, if any), `webhook-delivered`
(`true` when an optional findings webhook was delivered), and
`webhook-delivery-id` (the delivery ID for the fired webhook).

## Providers

Health Inspector supports multiple LLM backends. Select one with `--provider` (CLI) or the `provider` input (Action). Each provider applies its own default `base-url` and `model` if you do not set them explicitly.

| provider | API | default base | default model | auth |
| --- | --- | --- | --- | --- |
| `openai` | OpenAI chat/completions | `api.deepseek.com` | `deepseek-chat` | Bearer |
| `claude` | Anthropic Messages `/v1/messages` | `api.anthropic.com` | `claude-haiku-4-5` | `x-api-key` |
| `kimi` | Moonshot OpenAI-compat | `api.moonshot.ai/v1` | `kimi-k2.5` | Bearer |
| `hermes` | OpenRouter OpenAI-compat | `openrouter.ai/api/v1` | `nousresearch/hermes-3-llama-3.1-70b` | Bearer |
| `opencode` | OpenCode server sessions API | `http://127.0.0.1:4096` | (server default) | optional Basic |

```sh
health-inspector . --provider claude --api-key $ANTHROPIC_API_KEY
health-inspector . --provider kimi --api-key $MOONSHOT_API_KEY
health-inspector . --provider hermes --api-key $OPENROUTER_API_KEY
health-inspector . --provider opencode --base-url http://127.0.0.1:4096
```

The `claude` and `anthropic` names both resolve to the Anthropic Messages backend; `kimi` and `moonshot` both resolve to the Moonshot OpenAI-compatible backend.

Health Inspector resolves configuration with a clear precedence:
**flags > env > `.health-inspector.json` > defaults**. This applies to both the
local CLI and the Action entrypoint.

### Configuration file

Place a `.health-inspector.json` in your repository root (or specify an
alternate path with `--config`). Keys use camelCase:

```json
{
  "model": "gpt-4",
  "baseUrl": "https://api.example.com",
  "maxCandidates": 10,
  "probability": 0.5,
  "failOn": "high",
  "oversizedFunctionLines": 120,
  "rules": ["todo_fixme", "secret_like"],
  "excludeRules": ["oversized_function"],
  "webhookSigningSecret": "..."
}
```

### Environment variables

Any key may also be set via environment variables (prefixed
`HEALTH_INSPECTOR_`):

| Variable | Config key | Type |
| --- | --- | --- |
| `HEALTH_INSPECTOR_API_KEY` | apiKey | string |
| `HEALTH_INSPECTOR_BASE_URL` | baseUrl | string |
| `HEALTH_INSPECTOR_MODEL` | model | string |
| `HEALTH_INSPECTOR_MAX_CANDIDATES` | maxCandidates | integer |
| `HEALTH_INSPECTOR_PROBABILITY` | probability | float (0–1) |
| `HEALTH_INSPECTOR_LABEL` | label | string |
| `HEALTH_INSPECTOR_STATE_BRANCH` | stateBranch | string |
| `HEALTH_INSPECTOR_WEBHOOK_URL` | webhookUrl | string |
| `HEALTH_INSPECTOR_WEBHOOK_SECRET` | webhookSecret | string |
| `HEALTH_INSPECTOR_WEBHOOK_SIGNING_SECRET` | webhookSigningSecret | string |
| `HEALTH_INSPECTOR_STATE_FILE` | stateFile | string |
| `HEALTH_INSPECTOR_FAIL_ON` | failOn | string |
| `HEALTH_INSPECTOR_RULES` | rules | comma-separated list |
| `HEALTH_INSPECTOR_EXCLUDE_RULES` | excludeRules | comma-separated list |

### Precedence rules

1. **Flags** (CLI options or Action `INPUT_*` env vars) win.
2. **Environment variables** override the config file.
3. **`.health-inspector.json`** beats built-in defaults.
4. **Built-in defaults** (`DEFAULT_CONFIG` in `src/config.js`) fill any remaining gaps.

## Local State

The CLI persists local state in `.health-inspector/state.json` (configurable via
`--state-file` or `HEALTH_INSPECTOR_STATE_FILE`). This file tracks:

- `lastScannedRef` — the last git ref scanned, enabling diff-based scanning
- `filedFingerprints` — sha1 fingerprints of already-reported findings (dedup)
- `deliveries` — delivery log for webhook replay protection
- `rules` — per-rule metadata

State is written **atomically**: writes go to a temp file, are `fsync`'d, then
renamed into place, so a crash mid-write never corrupts existing state.

The delivery log enforces a **7-day replay window** (`REPLAY_WINDOW_MS`): a
webhook payload with the same delivery ID delivered within 7 days is skipped to
prevent duplicate notifications.

## Output Formats

| `--format` | Description |
| --- | --- |
| `markdown` | Human-readable report (default). |
| `json` | Machine-readable JSON with counts, findings, and token usage. |
| `sarif` | SARIF 2.1.0 document for code-scanning integrations. |
| `github-annotation` | GitHub Actions workflow commands (`::error`/`::warning`). |
| `markdown-table` | Compact markdown table of findings. |

Use `--format markdown-table` for a compact CI table. JSON output omits source
snippets by default for safety; use `--include-snippets` to include them (only
in trusted local environments).

## `--fail-on`

Controls which finding severity triggers a non-zero exit code. Default is
`all` (any finding fails):

| `--fail-on` | Exit code 1 when |
| --- | --- |
| `none` | never (always exits 0 if scans succeed) |
| `low` | any finding (low, medium, or high) |
| `medium` | a medium or high finding |
| `high` | a high finding only |
| `all` | any finding (default) |

## Per-rule Controls

Health Inspector ships five static analysis rules (see `SCAN_RULES` in
`src/scan.js`; use `listRules()` at runtime to enumerate them):

| Rule | Severity hint | Description | File types |
| --- | --- | --- | --- |
| `todo_fixme` | 1 | TODO or FIXME comment found | js, jsx, ts, tsx, py, go, rb, rs, c, cpp, h, hpp |
| `oversized_function` | 2 | Function exceeds line threshold | js, jsx, ts, tsx, py |
| `untested_new_function` | 3 | New exported function has no test reference | js, jsx, ts, tsx |
| `bare_except` | 4 | Bare or empty catch block | js, jsx, ts, tsx, py |
| `secret_like` | 5 | Potential secret or credential | all |

Use `--rules a,b` to enable only specific rules, and `--exclude-rules a,b` to
disable specific ones. Both accept comma-separated rule names. When `--rules`
is empty, all rules are enabled.

## `--oversized-lines`

Sets the maximum line count for the `oversized_function` rule (default `80`).
Functions exceeding this many lines are flagged as candidates. Accepts a
positive integer.

## SARIF

The `--format sarif` flag emits a SARIF 2.1.0 document suitable for GitHub
code-scanning. Upload it directly in a workflow:

```yaml
- name: Run Health Inspector
  id: inspect
  run: npx health-inspector . --offline --format sarif > results.sarif
- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

## Webhook Signing

When `webhook-signing-secret` (Action) or `--webhook-signing-secret` (CLI) is
set, every webhook payload is signed with **HMAC-SHA256** and delivered in the
`X-Health-Inspector-Signature` header (configurable via
`webhook-signature-header` / `--webhook-signature-header`) as
`sha256=<hex-digest>`. Recipients can verify integrity with `verifySignature`.

Replay protection prevents duplicate deliveries: a payload with a matching
delivery ID delivered within the **7-day replay window** is skipped. Failed
deliveries are persisted to a durable outbox (`--outbox-dir` / `webhook-signing-secret`
is unrelated to the outbox path) — see Local State for details.

## CLI Webhook Delivery

The CLI can fire webhooks directly with `--webhook-url`. Unlike the Action (which
fetches a secret out of `secrets.*`), the CLI relies entirely on local state
for replay protection and on `--webhook-signing-secret` for HMAC signing. Set
`HEALTH_INSPECTOR_WEBHOOK_URL` to avoid passing the endpoint on the command line.
Webhooks are delivered only when newly confirmed findings exist.

## Inputs and outputs

### Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `api-key` | LLM API key (e.g. DeepSeek). Not required when `provider` is `opencode`. | yes | |
| `base-url` | Base URL of the OpenAI-compatible chat completions API. | no | `https://api.deepseek.com` |
| `model` | Model to use for the inspection report. | no | `deepseek-chat` |
| `probability` | Chance (0-1) that this run actually executes. | no | `1.0` |
| `paths` | Repository path to scan. | no | `.` |
| `scan-paths` | Space-separated list of paths to scan (defaults to `paths`). When set, Stage-0 only scans files under these paths. | no | `.` |
| `rules` | Comma-separated list of rule names to enable (defaults to all). | no | |
| `exclude-rules` | Comma-separated list of rule names to exclude. | no | |
| `oversized-lines` | Positive integer line threshold for oversized functions. | no | `80` |
| `max-candidates` | Maximum number of scan candidates to pass to the model. | no | `15` |
| `label` | Label used for filed issue reports. | no | `health-inspector` |
| `state-branch` | Branch used to persist state (last-scanned ref, filed fingerprints). | no | `health-inspector-state` |
| `github-token` | GitHub token used to authenticate REST API calls. | no | `${{ github.token }}` |
| `github-request-timeout-ms` | Per-request timeout (ms) for GitHub REST API calls. | no | `15000` |
| `github-max-retries` | Maximum number of retries for transient GitHub API failures. | no | `3` |
| `webhook-url` | Optional HTTPS endpoint to notify when new findings are reported. | no | |
| `webhook-headers` | Optional JSON object of additional webhook headers. | no | |
| `webhook-secret` | Optional secret value sent in the webhook secret header. | no | |
| `webhook-secret-header` | Header name used for `webhook-secret`. | no | `X-Health-Inspector-Secret` |
| `webhook-signing-secret` | Optional HMAC-SHA256 signing secret for webhook payloads. | no | |
| `webhook-signature-header` | Header name used to deliver the HMAC-SHA256 webhook signature. | no | `X-Health-Inspector-Signature` |
| `webhook-timeout-ms` | Webhook request timeout. | no | `5000` |
| `webhook-retries` | Retries for transient webhook failures. | no | `3` |

### Outputs

| Output | Description |
| --- | --- |
| `findings-count` | Number of confirmed findings reported. |
| `report-url` | URL of the filed issue report, if any. |
| `webhook-delivered` | `true` when an optional findings webhook was delivered. |
| `webhook-delivery-id` | Delivery ID for the fired findings webhook (empty if no webhook was sent). |

### Webhooks

Set `webhook-url` to receive a `POST` only when newly confirmed findings are
reported. The JSON payload has `schema_version`, `event`, `delivery_id`,
repository/ref metadata, sanitized finding locations/reasons, and the issue URL.
It never includes source snippets or the full Markdown report. Delivery uses a
bounded timeout and retries transient failures; a failed notification is logged
as a warning after the issue and state have already been persisted.

When `webhook-signing-secret` is set, payloads are signed with HMAC-SHA256 in
the `webhook-signature-header`. Replay protection skips deliveries already sent
within a 7-day window. Optional `webhook-headers` must be a JSON object, and
`webhook-secret` is sent through `webhook-secret-header` rather than placed in
the URL.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to run tests, the local
mock self-test, and the build/release flow.

## License

MIT
