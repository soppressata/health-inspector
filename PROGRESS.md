# Build Progress — Health Inspector GitHub Action

Drives the autonomous build loop. Check items off `[x]` only after verifying, not just writing.
Do not stop the loop until every item is `[x]` AND item 9's Actions run is actually green.

- [x] 0. Repo scaffold: README stub, LICENSE (MIT), .gitignore, PROGRESS.md
- [x] 1. `gh repo create soppressata/health-inspector --public`, push initial scaffold (https://github.com/soppressata/health-inspector)
- [ ] 2. `action.yml` — composite/JS action definition with inputs: api-key, base-url (default
      https://api.deepseek.com), model (default deepseek-chat), probability (default 1.0),
      paths (default whole repo), max-candidates, label (default "health-inspector"),
      state-branch. Outputs: findings-count, report-url.
- [ ] 3. `src/scan.*` — Stage 0 free static pre-filter over the diff since last inspection
      (git diff against last-scanned ref stored in state; full scan if no prior state):
      TODO/FIXME debt, secret-looking strings (high-entropy / known key prefixes), missing
      tests for new/changed source files, oversized functions, bare except / swallowed
      errors, missing error handling on new I/O, stale docs vs changed public API.
      Ranked, capped candidate list. Unit tests in tests/.
- [ ] 4. `src/inspect.*` — Stage 1: skip entirely if scan.* found nothing (0 tokens). Else one
      batched HTTP POST to {base-url}/chat/completions (OpenAI-compatible schema) with only
      the top-N capped/truncated candidate snippets, asking for confirm/reject + severity +
      one concise markdown report. Hard max_tokens cap. Unit tests with mocked HTTP (no live
      network in unit tests).
- [ ] 5. `src/github.*` — dedup against existing open "health-inspector"-labeled issues by
      fingerprint before filing; create/update issue with bot-persona report. Unit tests.
- [ ] 6. `src/state.*` — persist last-scanned git ref + filed fingerprints (e.g. a small JSON
      blob committed to a dedicated state branch, or an issue-based ledger — pick the simpler
      one that doesn't require extra permissions beyond `contents:write`/`issues:write`).
- [ ] 7. `demo/health-inspector-demo/` — small fixture project with deliberate violations
      (a TODO, a bare except, a new function with no test, a hardcoded-looking fake secret)
      for the self-test to actually find.
- [ ] 8. `.github/workflows/ci.yml` — install deps, run unit tests + lint on push/PR. Must be
      green before touching self-test.
- [ ] 9. `.github/workflows/self-test.yml` — workflow_dispatch + on-push job that runs the
      action for real against `demo/health-inspector-demo/`, sourcing the API key from the
      already-authenticated local opencode-go Deepseek credential path agreed with the user
      (documented inline: this job is for maintainers only, real adopters use their own key).
      Assert a report is produced / issue filed. Push, then `gh run watch` until genuinely
      green — do not mark this done on a red or cancelled run.
- [ ] 10. README.md: badges, pitch (esp. the low-token-usage design), quickstart (12-line
      workflow snippet), how the two-stage pipeline keeps cost near zero on clean repos.
      CONTRIBUTING.md, CHANGELOG.md (Keep a Changelog format), MIT LICENSE finalized.
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
