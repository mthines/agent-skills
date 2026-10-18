---
title: '`--target preview` deltas'
impact: MEDIUM
tags:
  - aw-setup
  - preview
---

# `--target preview` deltas

Read when `aw-setup` runs with `--target preview` (including via `/ui-verify setup`).
Each row replaces the `local` behaviour of the named phase; phases not listed run unchanged.
A preview run goes A → B → C → D → G, with E omitted and F run when `memory.*` is connected.

| Phase | Preview behaviour |
| --- | --- |
| A — Detect | Do not detect a base URL: write the literal `base_url: RESOLVED_AT_RUNTIME`; `ui-verify` resolves the PR's branch-alias URL per run. Still detect the auth signals, and detect host deployment protection (a `vercel.json`, a `VERCEL_AUTOMATION_BYPASS_SECRET` in CI config) so Phase B can offer the bypass header. |
| B — Ask | Skip the base-URL question. Ask whether the preview sits behind deployment protection. |
| D — Write | Write `.claude/aw-targets/preview.yml` from [`ui-verify/templates/preview-target.yml.template`](../../../../testing/ui-verify/templates/preview-target.yml.template), keeping `base_url: RESOLVED_AT_RUNTIME`. For a non-interactive login scaffold `refresh-auth.mjs` from [`ui-verify/templates/refresh-auth.mjs.template`](../../../../testing/ui-verify/templates/refresh-auth.mjs.template) instead of an `auth-bootstrap-*.mjs`. Behind deployment protection, uncomment and fill the `bypass_header` block (the outer wall). |
| E — Smoke | Skip: no preview URL exists until a PR is open. Phase G's confirming login is the end-to-end validation. |

The full two-wall flow (bypass header outside, app login inside, the CI env-var path, `authed_check`) is [`ui-verify/rules/preview-auth.md`](../../../../testing/ui-verify/rules/preview-auth.md).
