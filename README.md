# 🕵️ Health Inspector

A GitHub Action that shows up unannounced, does a deep audit of your repo, and
files a report only when it finds real violations — like a real health
inspector. Bring your own LLM API key (DeepSeek Flash recommended: **$0.28 /
million tokens**); most runs on a healthy repo cost **zero tokens**.

> Status: under active construction. See [PROGRESS.md](./PROGRESS.md).

## Why it's cheap

Most repo-scanning bots dump your whole codebase into an LLM on every run.
Health Inspector doesn't:

1. **Stage 0 (free):** deterministic static scan of only what changed since
   the last inspection — TODOs, swallowed exceptions, untested new code,
   secret-looking strings, stale docs. No LLM call.
2. **Stage 1 (cheap, capped):** only if Stage 0 finds candidates, one single
   batched request with truncated snippets and a hard output-token cap asks
   the model to confirm, rank, and write one report.
3. Nothing found in Stage 0 → the whole run costs 0 tokens.

## Quickstart

```yaml
on:
  schedule: [{cron: '17 */6 * * *'}]
  workflow_dispatch: {}
jobs:
  inspect:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: soppressata/health-inspector@v1
        with:
          api-key: ${{ secrets.INSPECTOR_API_KEY }}
          base-url: https://api.deepseek.com
          model: deepseek-chat
```

## License

MIT
