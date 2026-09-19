---
title: Preview auth — reaching a gated preview from a human and from CI
impact: HIGH
tags:
  - ui-verify
  - auth
  - storage-state
  - vercel-protection
  - ci
---

# Preview auth

A spec run needs a browser context that can actually load the preview. A preview is gated in up to two independent layers, and the flow must clear whichever are present:

- **Outer wall — host deployment protection** (Vercel Deployment Protection, Netlify password, Cloudflare Access). The protection page loads *before* the app. Cleared with a **bypass header/token**, never a login.
- **Inner wall — app login** (Clerk, Auth.js, a custom SSO). The app loads, then demands a signed-in session. Cleared with a **`storageState`** (saved session cookies), never by shipping the password to the browser on every run.

The strategies compose: a preview behind **both** walls needs the bypass header to reach the app's own login page, then the app login to get a session.

## The one rule that never bends: secrets never touch a tracked file

Credentials live in **environment variables** or the **OS keychain**. This repo's committed files — `aw-target.yml`, any spec, any lesson — name **which** env var to read, never a value. The only artifact a run writes is a Playwright `storageState` JSON, which is **gitignored** and holds a session (not the password) — still treat it as a secret: short-lived, never committed, never pasted.

Do not accept a password pasted into a chat/prompt either: it would persist in the transcript, and anything derived from it into a file would persist too.

## Contents

- [Strategy `none`](#strategy-none)
- [Strategy `bypass-header` (outer wall)](#strategy-bypass-header-outer-wall)
- [Strategy `storage-state` (inner wall)](#strategy-storage-state-inner-wall)
- [Both walls](#both-walls)
- [Local (human) vs CI (non-interactive)](#local-human-vs-ci-non-interactive)
- [The Google-SSO caveat](#the-google-sso-caveat)

## Strategy `none`

Public preview, no gate. `auth.strategy: none`, nothing else. The runner opens a plain context.

## Strategy `bypass-header` (outer wall)

The preview URL is behind host deployment protection. Send a bypass header on **every** request — the runner applies it to the Playwright context (`extraHTTPHeaders`), so it rides the login navigation and every spec navigation alike.

```yaml
auth:
  strategy: bypass-header
  bypass_header:
    name: x-vercel-protection-bypass
    env: VERCEL_AUTOMATION_BYPASS_SECRET   # names the env var; NO value here
    set_cookie: true                        # also do the one-time set-bypass-cookie GET
```

Vercel: mint the secret at Project → Settings → Deployment Protection → *Protection Bypass for Automation*, store it as a CI secret, expose it to the job as `VERCEL_AUTOMATION_BYPASS_SECRET`. `set_cookie: true` makes the runner hit `?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=<secret>` once so the bypass persists as a cookie for the session; the header alone also works.

## Strategy `storage-state` (inner wall)

The app requires a login. A `storageState` JSON carries the post-login session; the runner loads it into the context so the app sees an authenticated user. It is produced by `refresh.command` — a **non-interactive** login script that reads credentials from env vars.

```yaml
auth:
  strategy: storage-state
  storage_state: .browser/auth-state.preview.json    # gitignored
  refresh:
    when: always            # a per-PR/per-push preview session is short-lived; re-capture each run
    env: [PREVIEW_USER, PREVIEW_PASSWORD]
    command: |
      PREVIEW_URL="${PREVIEW_URL}" \
        AUTH_STORAGE_STATE=.browser/auth-state.preview.json \
        node .claude/aw-targets/refresh-auth.mjs
    timeout_seconds: 180
```

Scaffold `refresh-auth.mjs` from [`templates/refresh-auth.mjs.template`](../templates/refresh-auth.mjs.template) and customize only its selector block. `PREVIEW_URL` is exported by the runner (the resolved branch-alias URL). Reuse an existing repo convention (`.browser/`, an existing `refresh-auth*.mjs`) before scaffolding a parallel one — see [aw-setup § Reuse before you scaffold](../../../workflow/autonomous-workflow/aw-setup/SKILL.md#reuse-before-you-scaffold).

## Both walls

Layer them: `strategy: storage-state` **plus** a `bypass_header` block. The bypass header is applied in two places, and `refresh-auth.mjs` and the runner each own one:

1. `refresh-auth.mjs` sets `extraHTTPHeaders: { <name>: <env value> }` on its own context, so it can reach the app's login page *through* the protection layer to produce the `storageState`.
2. The runner sets the same header on the **spec-run** context, so every spec navigation gets through the protection layer too — the `storageState` handles the inner login, the header handles the outer wall.

```yaml
auth:
  strategy: storage-state
  storage_state: .browser/auth-state.preview.json
  bypass_header:
    name: x-vercel-protection-bypass
    env: VERCEL_AUTOMATION_BYPASS_SECRET
    set_cookie: true
  refresh:
    when: always
    env: [PREVIEW_USER, PREVIEW_PASSWORD, VERCEL_AUTOMATION_BYPASS_SECRET]
    command: |
      PREVIEW_URL="${PREVIEW_URL}" \
        AUTH_STORAGE_STATE=.browser/auth-state.preview.json \
        node .claude/aw-targets/refresh-auth.mjs
    timeout_seconds: 180
```

## Local (human) vs CI (non-interactive)

The two contexts differ only in **how the `storageState` is produced**; everything downstream is identical.

| | Local (a human is present) | CI (no human) |
| --- | --- | --- |
| Outer wall | same bypass header from an env var (or a local `.env` not committed) | bypass header from a CI secret env var |
| Inner login | Either run `refresh.command` with env vars, **or** log in once by hand in a headed browser and save the `storageState` — the human option Google SSO forces | `refresh.command` reads CI-secret env vars and logs in headless; **or** a pre-captured `storageState` provided as a secret and materialized at runtime |
| The run | loads the `storageState` + applies the header | identical |

CI checklist: store `VERCEL_AUTOMATION_BYPASS_SECRET`, `PREVIEW_USER`, `PREVIEW_PASSWORD` (or a `PREVIEW_STORAGE_STATE_B64`) as CI secrets; expose them to the job as env vars; the runner's Step 3 runs `refresh.command` (or decodes the pre-captured state) and applies the bypass header. No secret is ever written to a tracked file.

## The Google-SSO caveat

**Scripting a Google SSO login is unreliable** — Google actively blocks automated logins (bot detection, device checks, 2FA), so a `refresh-auth.mjs` that types into Google's own form will flake or hard-fail in CI. When the inner wall is Google SSO, pick one of:

1. **A dedicated password-capable test account** that authenticates against the *app's* own credential form (Clerk/Auth.js email-password), bypassing Google entirely. This is the CI-friendly path and what `refresh-auth.mjs` assumes.
2. **A pre-captured `storageState`**: a human logs in once via Google in a headed browser, saves the session, and stores it as a CI secret (base64). It expires, so refresh it on a schedule. Non-interactive at run time, manual only at refresh time.
3. If neither is available, mark the authed specs `skipped` with the reason — never fake a pass. A public-page `CAPTURE` still works without a session.

Never put a real user's personal Google credentials in CI. Use a service/test account provisioned for automation.
