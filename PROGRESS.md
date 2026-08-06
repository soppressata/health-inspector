# Build Progress — Health Inspector

Drives the autonomous build loop. Check items off `[x]` only after verifying, not just writing.
Do not stop the loop until every item is `[x]` AND item 9's Actions run is actually green.

- [x] 0. Repo scaffold: README stub, LICENSE (MIT), .gitignore, PROGRESS.md
- [x] 1. `gh repo create soppressata/health-inspector --public`, push initial scaffold (https://github.com/soppressata/health-inspector)
- [x] 2. `action.yml` — node20 composite action, core inputs + outputs. package.json +
      placeholder src/index.js. Verified: action.yml parses, `node src/index.js` runs and
      exits 0. Runtime choice: Node.js (recorded for later items).
- [x] 3. `src/scan.js` — Stage 0 static scanner: todo_fixme, secret_like, bare_except (JS+Py),
      untested_new_function, oversized_function. Ranked + capped. git-diff-based when
      sinceRef given, falls back to full scan. Verified: 8/8 unit tests pass (`npm test`),
      real git fixtures via mkdtempSync.
- [x] 4. `src/inspect.js` — Stage 1: zero-fetch short-circuit on empty candidates, else one
      batched POST to {base-url}/chat/completions, snippets capped 30 lines/1200 chars,
      temperature 0, max_tokens cap, JSON-fence-tolerant parsing. Verified: 14/14 tests pass
      (`npm test`), fetch is stubbed in tests (no live network).
- [x] 5. `src/github.js` — `fileReport` dedups via fingerprints, no-API-call short circuit
      when nothing new, files one issue via thin `octokitLike.createIssue`. Verified in
      tests/github.test.js.
- [x] 6. `src/state.js` — `loadState`/`saveState` round-trip `state.json` on a dedicated
      `state-branch` via GitHub contents API (404 → defaults), `fingerprintFinding` (sha1,
      12 hex chars, whitespace-normalized). Verified: 26/26 total tests pass (`npm test`).
- [x] 7. `demo/health-inspector-demo/` — payments.js with a TODO, a fake-but-realistic secret
      (had to detune it once — GitHub's own push protection blocked the first, too-realistic
      version), and a swallowed `catch (e) {}`. Verified: `scanRepo` against this dir returns
      exactly [secret_like, bare_except, todo_fixme].
- [x] 8. `.github/workflows/ci.yml` — node --check on all src files + `npm test`. Verified:
      real run https://github.com/soppressata/health-inspector/actions/runs/31071274820 green
      (13s, `gh run watch --exit-status` exit 0).
- [x] 9. `.github/workflows/self-test.yml` — workflow_dispatch + on-push job that runs the
      action for real against `demo/health-inspector-demo/`, sourcing the API key from the
      already-authenticated local opencode-go Deepseek credential path agreed with the user
      (documented inline: this job is for maintainers only, real adopters use their own key).
      Assert a report is produced / issue filed. Push, then `gh watch` until genuinely
      green — do not mark this done on a red or cancelled run. Verified: real GH Actions run
      https://github.com/soppressata/health-inspector/actions/runs/31071618670 green (24s).
- [x] 10. README.md: badges, pitch (esp. the low-token-usage design), quickstart (12-line
      workflow snippet), how the two-stage pipeline keeps cost near zero on clean repos.
      CONTRIBUTING.md, CHANGELOG.md (Keep a Changelog format), MIT LICENSE finalized.
      Verified: rewrote README with CI/Self-test/MIT badges, refined pitch, full-input
      quickstart + how-it-works + complete input/output tables (cross-checked against
      action.yml: 9 inputs, 2 outputs); added CONTRIBUTING.md (npm test, local mock LLM
      self-test, code style, PR review) and CHANGELOG.md (Keep a Changelog, Unreleased
      pending v1.0.0). No inputs invented; LICENSE and workflows retained.
- [x] 13. Local CLI: shared inspection core, Markdown/JSON output, offline/dry-run modes,
      validation, safe defaults, and CI exit codes. Verified with CLI smoke tests and the
      full Node test suite.
- [x] 14. Webhooks: sanitized payloads, delivery IDs, strict headers, timeout, retries,
      Action inputs/output, and post-persistence best-effort delivery. Verified with mocked
      transient failures and the full Node test suite.
- [x] 15. Reliability hardening: preserve deduplication state on no-op reports, include
      untracked files in full scans, distinguish same-file findings by line, validate model
      responses, cap snippets, and detect `catch {}`. Verified by regression tests.
- [x] 16. `PLAN.md`: documented architecture, delivered scope, next phases, and safety rules.
      README, CHANGELOG, and CONTRIBUTING now describe the CLI and webhook surfaces.
- [ ] 11. Tag and push `v1` release (`git tag v1 && git push origin v1`), and a floating
      major tag `v1` per Actions marketplace convention (or `git tag -f v1` re-point pattern).
- [ ] 12. Final verification: fresh `git clone` into a scratch dir, follow README instructions
      literally, confirm nothing is missing (no undocumented local-only assumptions like the
      opencode credential leaking into the "for adopters" instructions).

## Notes for the executor (opencode/deepseek doing the work each iteration)
- Work in /home/sr/health-inspector. Commit + push after each completed, verified item.
- Keep commits small and scoped to one checklist item.
- The shipped Action must NOT depend on the opencode CLI or any credential specific to this
  machine — that's only used for our own Stage-9 self-test, and must be clearly commented as
  maintainer-only in self-test.yml.
- Prefer Node.js (actions/toolkit ecosystem) or Python — pick one and stay consistent; note the
  choice in the first commit message so later iterations don't mix runtimes.
