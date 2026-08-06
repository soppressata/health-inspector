# Contributing

Thanks for helping make Health Inspector better. This is a Node.js 20 project —
there is no other supported runtime.

## Repository layout

- `src/` — shared source. `index.js` is the Action entry point; `core.js` and
  `output.js` power the CLI; `scan.js` (Stage 0), `inspect.js` (Stage 1),
  `github.js` (report filing + retryable REST client), `state.js` (GitHub
  contents-API state persistence) are focused adapters. `config.js` resolves
  flags > env > `.health-inspector.json` > defaults; `local-state.js` provides
  atomic file-backed state for the CLI; `webhook.js` handles signed, replay-safe
  outbound delivery.
- `bin/health-inspector.js` — local CLI executable.
- `tests/` — unit + integration tests, run with Node's built-in test runner.
- `demo/` — `health-inspector-demo/` (a fixture repo the scanner is asserted
  against) and `mock-llm-server.js` (a local OpenAI-compatible stub).
- `dist/` — **build output** from `ncc`. Do not hand-edit; run `npm run build`
  to regenerate.
- `.github/workflows/` — CI, acceptance, self-test, and release workflows.

## Running tests

```bash
npm test
```

`npm test` runs the Node built-in test runner (169 tests) across scanner,
inspector, GitHub client, config, local state, CLI, and webhook modules. The
LLM, GitHub API, and webhooks are stubbed in tests; there is no live network.

### Testing the new features

Each new surface has dedicated test coverage:

- **Config resolution** (`tests/config.test.js`): tests
  `DEFAULT_CONFIG`, `loadConfigFile`, `envToConfig`, `resolveConfig` precedence
  (flags > env > file > defaults), and `validateConfig` for `maxCandidates`,
  `probability`, `oversizedFunctionLines`, `failOn`, `rules`, and `excludeRules`.
- **Local state** (`tests/local-state.test.js`): tests
  `loadLocalState`/`saveLocalState` round-trips, atomic writes with no leftover
  temp files, corrupt-file fallback, delivery replay window (7 days), and
  `recordDelivery`/`wasDelivered`.
- **Webhook HMAC signing** (`tests/webhook.test.js`): tests `signPayload` /
  `verifySignature` (HMAC-SHA256, timing-safe, tampered/wrong-secret rejection,
  header-injection prevention, accepts both raw hex and `sha256=<hex>` header
  forms), replay protection, durable outbox, `drainOutbox`, and `notifyWebhook`
  pass-through.
- **GitHub client** (`tests/github.test.js`): tests `isRetryable`
  classification, `makeGithubClient` timeout/retry-with-backoff behaviour, and
  `fileReport` dedup short-circuit.
- **Action config** (`tests/index.test.js`): tests `buildActionConfig` and
  `buildGithubClientOptions` reading from `INPUT_*` env vars with file/env/fallback
  precedence, and the `scan-repo` / config pass-through.

To exercise the local CLI:

```bash
npm install
npx health-inspector . --offline --format json
```

Use `--dry-run` or `--offline` when testing scanner behavior without an API key.
The CLI returns `1` for confirmed findings, so CI can gate on that status.

## Local self-test (mocked LLM)

The self-test workflow uses `demo/mock-llm-server.js` as a stand-in for an
OpenAI-compatible `/chat/completions` endpoint. To run the same end-to-end path
locally:

```bash
# 1. Start the mock LLM in one terminal (defaults to port 8842)
node demo/mock-llm-server.js &
MOCK_PID=$!

# 2. Wait until the mock is responding
for i in $(seq 1 20); do
  if curl -sf -X POST http://localhost:8842/chat/completions -d '{}' \
       -H 'content-type: application/json' >/dev/null; then
    echo "mock server is up"
    break
  fi
  sleep 0.5
done

# 3. Run this repo's action against the demo fixture. The action reads
#    INPUT_* env vars (see action.yml); several of those names contain dashes
#    (e.g. INPUT_GITHUB-TOKEN), which bash `export` cannot set, so `env` is
#    used to pass them. The mock substitutes for a real LLM, so no provider
#    key is needed.
env \
  GITHUB_REPOSITORY=soppressata/health-inspector \
  INPUT_GITHUB-TOKEN="$(gh auth token)" \
  INPUT_API-KEY=mock-key-local \
  INPUT_BASE-URL=http://localhost:8842 \
  INPUT_MODEL=mock-model \
  INPUT_PROBABILITY=1.0 \
  INPUT_MAX-CANDIDATES=15 \
  INPUT_LABEL=health-inspector \
  INPUT_STATE-BRANCH=health-inspector-state \
  INPUT_PATHS=demo/health-inspector-demo \
  node src/index.js

# 4. Stop the mock LLM
kill "$MOCK_PID" 2>/dev/null
```

The mock confirms every candidate with `severity: medium`, so a green run
should produce a report issue (only for findings not already filed — see
`src/github.js`) and persist state on `health-inspector-state`.

## Code style

- Node.js 20 only. Do not introduce a second runtime.
- ES modules (`"type": "module"` in `package.json`). Use `import`/`export`.
- Keep modules focused: one concern per file under `src/`.
- Keep individual functions short; cap function length.
- Prefer `node:test` + native `assert` over adding new test dependencies.

## Gitignore

Local runtime state is written outside version control. The following entries
in `.gitignore` are important:

```
# Local state and outbox (written by the CLI; not committed)
.health-inspector/
```

The `.health-inspector/` directory holds `state.json` (last-scanned ref, filed
fingerprints, delivery log) and the optional outbox directory. These are
per-developer and per-run artifacts and should not be committed.

## Pull requests

Every PR must keep both required checks green:

1. **CI** (`.github/workflows/ci.yml`): `node --check` on all `src` files +
   `npm test` + dist drift check.
2. **Acceptance** (`.github/workflows/acceptance.yml`): CLI smoke test
   (exit code 0 or 1, valid JSON) on a fresh checkout.
3. **Self-test** (`.github/workflows/self-test.yml`): the end-to-end run against
   `demo/health-inspector-demo/` with the mocked LLM.

When CI is green, run the linter/typecheck equivalent for this project:

```bash
npm test          # all tests
node --check src/*.js bin/health-inspector.js
npm run build    # regenerate dist/
git diff --exit-code -- dist/  # dist must be in sync
```

Reviewers should confirm the Action and CLI behavior has not regressed against the
fixture repo (`demo/health-inspector-demo/`) — a clean repo should produce zero
candidates and zero tokens spent; a fixture dirty repo should produce exactly
the expected candidate set.

## Building and releasing

`dist/index.js` is produced by:

```bash
npm run build    # ncc build src/index.js -o dist
```

Do not edit `dist/` by hand. After any `src/` change, run `npm run build` and
re-commit the regenerated `dist/`.

### Release process

1. Ensure all CI checks are green on `main`.
2. Create a version tag:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   Pushing a `v*` tag triggers `.github/workflows/release.yml`, which creates a
   GitHub Release from `CHANGELOG.md`.
3. Maintain a floating `v1` major tag per the Actions marketplace convention:
   ```bash
   git tag -f v1
   git push origin --force v1
   ```
   The `release.yml` workflow also promotes `v1` automatically on each tagged
   release.
