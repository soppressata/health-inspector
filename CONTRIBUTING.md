# Contributing

Thanks for helping make Health Inspector better. This is a Node.js 20 project —
there is no other supported runtime.

## Repository layout

- `src/` — shared source. `index.js` is the Action entry point; `core.js` and
  `output.js` power the CLI; `scan.js` (Stage 0), `inspect.js` (Stage 1),
  `github.js` (report filing), `state.js` (state persistence), and `webhook.js`
  (sanitized outbound delivery) are focused adapters/modules.
- `bin/health-inspector.js` — local CLI executable.
- `tests/` — unit + integration tests, run with Node's built-in test runner.
- `demo/` — `health-inspector-demo/` (a fixture repo the scanner is asserted
  against) and `mock-llm-server.js` (a local OpenAI-compatible stub).
- `dist/` — **build output** from `ncc`. Do not hand-edit; run `npm run build`
  to regenerate.
- `.github/workflows/` — CI and the end-to-end self-test.

## Running tests

```bash
npm test
```

`npm test` runs the Node built-in test runner across scanner, inspector, GitHub,
state, CLI, and webhook tests. The LLM and webhook are stubbed in tests; there
is no live network.

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

## Pull requests

Every PR must keep both required checks green:

1. **CI** (`.github/workflows/ci.yml`): syntax checks, `npm test`, and the bundled
   Action build/drift check.
2. **Self-test** (`.github/workflows/self-test.yml`): the end-to-end run against
   `demo/health-inspector-demo/` with the mocked LLM.

When CI is green, run the linter/typecheck equivalent for this project:

```bash
npm test          # all tests
    node --check src/*.js bin/health-inspector.js
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

Do not edit `dist/` by hand. Tagging and `v1` promotion happen in item 11 of
[PROGRESS.md](./PROGRESS.md) via `git tag v1 && git push origin v1`; a floating
`v1` major tag is maintained per the Actions marketplace convention.
