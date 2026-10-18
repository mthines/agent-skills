---
title: 'aw-tester — auth handling'
impact: HIGH
tags:
  - aw-tester
  - auth
---

# aw-tester — auth handling

Part of the [`aw-tester`](../templates/aw-tester.agent.md) agent definition. Read before the first spec whenever the aw-target sets `auth.bypass_header` or an `auth.strategy` other than `none`.

## Outer wall: `auth.bypass_header` (composes with ANY strategy)

Independent of `auth.strategy`. When the aw-target sets `auth.bypass_header`, the
preview URL is behind host deployment protection (Vercel/etc.) that gates every
request *before* the app. Apply the header to the browser **context** so it rides
every navigation — including the authed-page checks below:

```js
// name + env come from auth.bypass_header; the VALUE is read from the environment,
// never from the aw-target file (which carries only the env-var NAME).
extraHTTPHeaders: { [auth.bypass_header.name]: process.env[auth.bypass_header.env] }
```

If `auth.bypass_header.env` is unset in the environment, the protection layer will
serve its own page instead of the app and every spec will look broken. Do not
guess — mark the run `inconclusive` with reason `bypass-secret-missing (set $<env>)`
and stop, exactly as a missing storage-state env var is handled. Log:
```
auth: bypass-header {name} applied to context (value from $<env>)
```
Never log the secret's value. This is the outer half of a two-wall preview
([`preview-auth.md`](../../../testing/ui-verify/rules/preview-auth.md)); the inner
login is still handled by the strategy below.

## Strategy: `storage-state`

Before the first spec, verify the storage state file exists:

```bash
test -f "<auth.storage_state>" && echo "exists" || echo "missing"
```

**Confirm the session is valid — do not trust the file's mere existence.**
When `auth.authed_check` is set (a locator present ONLY when signed in), load the
storage state, open the first authed page, and check that selector. Present →
the session is valid, proceed. This is the reliable signal: a stale session lets
an SPA render its own login page on a `200`, which an HTTP-status check misses.
Fall back to the HTTP 401 heuristic only when no `authed_check` is configured.

**Missing or stale:**
If the file does not exist, or `auth.authed_check` is absent from the first authed
page (or, without it, the page returns HTTP 401):
1. Read `auth.refresh.command` from the aw-target.
2. Run it with `auth.refresh.timeout_seconds` as the timeout (it reads its
   credentials from the env vars named in `auth.refresh.env`, never from a file).
3. Retry the failed spec once — re-checking `auth.authed_check` if configured.
4. If the session is still invalid, mark the spec `skipped` with reason
   `auth-refresh-failed` and continue (do not block the whole run).

Write a slow-tier lesson if auth refresh was needed:
```
auth refresh triggered on aw-target "{aw_target_name}" — command: {command}
```

Log:
```
auth: storage-state loaded from {path}
auth: refresh triggered (missing-or-expired) — command ran in Xs
```

## Strategy: `none`

Skip auth setup entirely.

## Strategy: `manual`

Skip ALL specs that have an authed precondition. Log:
```
auth.strategy: manual — skipping {N} authed spec(s) autonomously
```

## Strategy: `env-credentials`

Run a short headless login flow using `auth.identity.email` and an env-var
password before the first spec. Capture the resulting storage state to a
temporary file and use it for the run (do not persist it).

```bash
# Example: read password from env, run login script
E2E_EMAIL="${auth.identity.email}"
E2E_PASSWORD="${E2E_CREDENTIALS_PASSWORD}"  # resolved from process env
```

If the credentials env var is unset or the login flow fails, fall back to
`auth.strategy: manual` behaviour for this run and log:
```
auth.strategy: env-credentials — login failed ({reason}); treating as manual for this run
```
