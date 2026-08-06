# Health Inspector

A GitHub Action that shows up unannounced, does a deep audit of your repo, and
files a report only when it finds real violations — like a real health
inspector. Bring your own LLM API key (DeepSeek Flash recommended: **$0.28 /
million tokens**); most runs on a healthy repo cost **zero tokens**.

[![CI](https://img.shields.io/github/actions/workflow/status/soppressata/health-inspector/ci.yml?branch=main&label=CI)](https://github.com/soppressata/health-inspector/actions/workflows/ci.yml)
[![Self-test](https://img.shields.io/github/actions/workflow/status/soppressata/health-inspector/self-test.yml?branch=main&label=Self-test)](https://github.com/soppressata/health-inspector/actions/workflows/self-test.yml)
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
```

`api-key` is the only required input. The rest have sensible defaults.

For repositories that do not use GitHub Actions, install the package and run a
local scan:

```sh
npx health-inspector . --offline --format markdown
HEALTH_INSPECTOR_API_KEY=... npx health-inspector . --format json
```

The CLI exits `0` for a clean scan, `1` when findings are confirmed, `2` for
invalid options, and `3` for scan/provider failures. `--dry-run` and
`--offline` never call the LLM. JSON output intentionally omits source snippets
by default; use `--include-snippets` only in a trusted local environment.

## How it works

Health Inspector is a two-stage pipeline. The action entry point is
`src/index.js`; it delegates to four focused modules:

1. **`src/scan.js` — Stage 0.** A deterministic static scanner runs over the
   configured `paths`. It looks for `todo_fixme`, `secret_like`, `bare_except`,
   `untested_new_function`, and `oversized_function`. When the `state-branch`
   holds a previously-inspected ref, the scan is diffed against it so only new
   or changed candidates are considered; otherwise it scans the whole tree.
   Candidates are ranked and capped at `max-candidates` (default `15`). This
   stage never calls the LLM.

2. **`src/inspect.js` — Stage 1.** If Stage 0 produced candidates, `inspect.js`
   sends one batched POST to the OpenAI-compatible chat completions endpoint at
   `base-url` (default `https://api.deepseek.com`), using `model`
   (default `deepseek-chat`). Snippets are truncated to 30 lines / 1200 chars,
   `temperature` is forced to 0, and the output is capped at a small
   `max_tokens`. The response is parsed with JSON-fence tolerance. If there are
   no candidates, this stage is skipped entirely — hence the 0-token cost on a
   clean repo.

3. **`src/github.js` — report filing.** Confirmed findings are grouped into a
   report and filed as a GitHub issue via `fileReport`, which dedups against the
   last run using fingerprints so the same findings don't re-open issues on every
   schedule. Issue labels are controlled by `label` (default `health-inspector`).
   When there is nothing new, `fileReport` short-circuits with no API call.

4. **`src/state.js` — state persistence.** `saveState` writes a `state.json`
   (last-scanned ref plus the fingerprints of already-filed findings) to a
   dedicated `state-branch` (default `health-inspector-state`) via the GitHub
   contents API; `loadState` reads it back, treating a 404 as "first run".
   Finding fingerprints are sha1, 12 hex chars, whitespace-normalized.

The action exposes two outputs: `findings-count` (number of confirmed findings
this run) and `report-url` (URL of the filed issue, if any).

## Inputs and outputs

### Inputs

| Input | Description | Required | Default |
| --- | --- | --- | --- |
| `api-key` | LLM API key (e.g. DeepSeek). | yes | |
| `base-url` | Base URL of the OpenAI-compatible chat completions API. | no | `https://api.deepseek.com` |
| `model` | Model to use for the inspection report. | no | `deepseek-chat` |
| `probability` | Chance (0-1) that this run actually executes. | no | `1.0` |
| `paths` | Glob or directory to scan. | no | `.` |
| `max-candidates` | Maximum number of scan candidates to pass to the model. | no | `15` |
| `label` | Label used for filed issue reports. | no | `health-inspector` |
| `state-branch` | Branch used to persist state (last-scanned ref, filed fingerprints). | no | `health-inspector-state` |
| `github-token` | GitHub token used to authenticate REST API calls. | no | `${{ github.token }}` |
| `webhook-url` | Optional endpoint notified for newly confirmed findings. | no | |
| `webhook-headers` | Optional JSON object of additional webhook headers. | no | |
| `webhook-secret` | Optional secret sent in the configured secret header. | no | |
| `webhook-secret-header` | Header name for `webhook-secret`. | no | `X-Health-Inspector-Secret` |
| `webhook-timeout-ms` | Webhook request timeout. | no | `5000` |
| `webhook-retries` | Retries for transient webhook failures. | no | `3` |

### Outputs

| Output | Description |
| --- | --- |
| `findings-count` | Number of confirmed findings reported. |
| `report-url` | URL of the filed issue report, if any. |
| `webhook-delivered` | `true` when an optional findings webhook was delivered. |

### Webhooks

Set `webhook-url` to receive a `POST` only when newly confirmed findings are
reported. The JSON payload has `schema_version`, `event`, `delivery_id`,
repository/ref metadata, sanitized finding locations/reasons, and the issue URL.
It never includes source snippets or the full Markdown report. Delivery uses a
bounded timeout and retries transient failures; a failed notification is logged
as a warning after the issue and state have already been persisted. Optional
`webhook-headers` must be a JSON object, and `webhook-secret` is sent through
`webhook-secret-header` rather than placed in the URL.

## Expansion Plan

The shared pipeline is intentionally split into scanner, inspector, and output
adapters. The current release provides the Action, a local CLI, and outbound
webhooks. The next safe expansion is to add local state and config-file
precedence to the CLI, then a durable webhook outbox and HMAC signatures for
deployments that require guaranteed delivery. GitHub issue/state access remains
an Action adapter so local scans do not require GitHub credentials.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to run tests, the local
mock self-test, and the build/release flow.

## License

MIT
