# [Changelog](https://keepachangelog.com/en/1.1.0/)

## [Unreleased]

### Added
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
  10 inputs (`api-key`, `base-url`, `model`, `probability`, `paths`, `max-candidates`,
  `label`, `state-branch`, `github-token`) and 2 outputs (`findings-count`, `report-url`).
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
### Security
