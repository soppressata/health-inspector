# Contributing

Thanks for helping make Health Inspector better. This is a Node.js 20 project —
there is no other supported runtime.

## Repository layout

- `src/` — action source. `index.js` is the entry point; `scan.js` (Stage 0),
  `inspect.js` (Stage 1), `github.js` (report filing), `state.js` (state
  persistence).
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

`npm test` runs `node --test tests/`, which exercises `src/scan.js` (8 tests),
`src/inspect.js` (14 tests), `src/github.js`, and `src/state.js`. The LLM is
stubbed in tests — there is no live network.

## Local self-test (mocked LLM)

The self-test workflow uses `demo/mock-llm-server.js` as a stand-in for an
OpenAI-compatible `/chat/completions` endpoint. To run the same end-to-end path
locally:

```bash
# 1. Start the mock LLM in one terminal (defaults to port 8842)
node demo/mock-llm-server.js

# 2. In another terminal, run this repo's action against the demo fixture.
#    Point BASE_URL at the mock so no real API key is needed, and set a
#    local GH_TOKEN with repo scope for issue/state operations:
export GH_TOKEN=ghp_...
export MOCK_BASE_URL=http://127.0.0.1:8842

# 3. Invoke the action against demo/health-inspector-demo/
node src/index.js
```

The mock confirms every candidate with `severity: medium`, so a green run
should produce a report issue and persist state on `health-inspector-state`.

## Code style

- Node.js 20 only. Do not introduce a second runtime.
- ES modules (`"type": "module"` in `package.json`). Use `import`/`export`.
- Keep modules focused: one concern per file under `src/`.
- Keep individual functions short; cap function length.
- Prefer `node:test` + native `assert` over adding new test dependencies.

## Pull requests

Every PR must keep both required checks green:

1. **CI** (`.github/workflows/ci.yml`): `node --check` on all `src` files plus
   `npm test`.
2. **Self-test** (`.github/workflows/self-test.yml`): the end-to-end run against
   `demo/health-inspector-demo/` with the mocked LLM.

When CI is green, run the linter/typecheck equivalent for this project:

```bash
npm test          # all tests
node --check src/*.js   # syntax check, mirrors CI
```

Reviewers should confirm the action's behavior has not regressed against the
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
