---
title: Auth — reach a gated app locally and on the preview, with no secret in a tracked file
impact: HIGH
tags:
  - auth
  - storage-state
  - bypass-header
  - preview
  - setup
---

# Auth

Read during `/aw-verify setup` when an environment needs a login, and when a run's login fails.
Every environment's `auth` block in `.agents/aw/environments.yml` uses the fields below; `aw-tester` and the scripts read the same names.

**Secrets never touch a tracked file.** Credentials live in env vars or the OS keychain; config names *which* env var, never a value.
The only artifact a login writes is a Playwright `storageState` JSON, which is gitignored and still treated as a secret.
Never accept a password pasted into the session.

## Walls and strategies

An app can be gated by two independent walls; clear whichever are present.

| Wall | Example | Cleared by |
| --- | --- | --- |
| Outer — host deployment protection | Vercel Deployment Protection, Netlify password, Cloudflare Access | `bypass_header`: a header from an env var on every request |
| Inner — app login | Clerk, Auth.js, custom SSO | `storage_state` produced by `refresh.command` |

| `strategy` | Use when | Fields |
| --- | --- | --- |
| `none` | Public app | — |
| `bypass-header` | Outer wall only | `bypass_header: { name, env }` |
| `storage-state` | Inner wall (add `bypass_header` for both walls) | `storage_state`, `authed_check`, `refresh: { when, env, command, timeout_seconds }`, `identity` |
| `manual` | Hardware MFA, mandatory CAPTCHA, SSO with no test mode | — ; `aw-tester` marks authed specs `skipped (auth.strategy: manual)` |

```yaml
# ✓ Both walls on a preview — names env vars, holds no value
auth:
  strategy: storage-state
  bypass_header: { name: x-vercel-protection-bypass, env: VERCEL_AUTOMATION_BYPASS_SECRET }
  storage_state: .auth/preview.json
  authed_check: '{role: "button", name: "Account menu"}'
  refresh:
    when: always            # preview sessions differ per PR and push
    env: [PREVIEW_USER, PREVIEW_PASSWORD, VERCEL_AUTOMATION_BYPASS_SECRET]
    command: AUTH_STORAGE_STATE=.auth/preview.json node .agents/aw/scripts/auth/refresh-preview.mjs
    timeout_seconds: 180
# ✗ Wrong — a value in a committed file
  bypass_header: { name: x-vercel-protection-bypass, value: "abc123" }
```

`bypass_header` is applied twice: the login script sets it on its own context to reach the login page, and `aw-tester` sets it on the run context (`extraHTTPHeaders`) so every navigation gets through.
The runner exports `PREVIEW_URL` (the resolved URL) to `refresh.command`; locally it exports the environment's `url` the same way.

## Reuse before you scaffold

A second login location drifts from the one the repo maintains. Probe in order; stop at the first hit and use its paths everywhere:

1. A captured state file: `.browser/auth-state*.json`, else `.auth/*.json`.
2. A login script: `.agents/aw/scripts/auth/*.mjs`, `.browser/refresh-auth*.mjs`, `scripts/*login*.mjs` or `scripts/*auth*.mjs`.

Scaffold only when nothing is found.

## Pick the login script

```text
Is the login form plain (email + password + submit, no redirects, no MFA)?
├─ Yes, and the password can live in .env.local or a CI secret → login-credentials (headless)
└─ No (SSO, OAuth, magic link, MFA)                           → login-headful (a human logs in once)
Preview in CI, no human                                       → refresh-preview (headless, env credentials)
The repo already has a login command                          → reference it in refresh.command
```

| Template ([`templates/scripts/`](../templates/scripts/)) | Copy to | Env it reads |
| --- | --- | --- |
| `login-headful.mjs.template` | `.agents/aw/scripts/auth/login-headful.mjs` | `AUTH_LOGIN_URL`, `AUTH_STORAGE_STATE`, optional `AUTH_POST_LOGIN_URL_PATTERN`, `AUTH_TIMEOUT_MS` (default 10 min) |
| `login-credentials.mjs.template` | `.agents/aw/scripts/auth/login-credentials.mjs` | the above plus `E2E_EMAIL`, `E2E_PASSWORD`; `AUTH_POST_LOGIN_URL_PATTERN` required |
| `refresh-preview.mjs.template` | `.agents/aw/scripts/auth/refresh-preview.mjs` | `PREVIEW_URL`, `AUTH_STORAGE_STATE`, `PREVIEW_USER`, `PREVIEW_PASSWORD`, optional bypass secret |

Show the user the script's `CUSTOMIZE` / `SELECTORS` block before writing; a locator mismatch there is the most common failure.
The scripts import `playwright`; `aw-tester`'s pinned resolution provides it when the project has none.

## Confirm a session — `authed_check`

A state file existing does not prove a valid session: a stale one renders the login page on a `200`.
`authed_check` is a locator present only when signed in (account menu, avatar, sign-out), in the spec locator grammar.

1. **Setup** runs `refresh.command` once and waits for `authed_check` before declaring the environment `ok`.
2. **The login script** waits for it after submitting.
3. **`aw-tester`** checks it before authed specs; absent → run `refresh.command`, retry once.

No stable element → omit it; the run falls back to "URL is not the login page".

## Local vs CI

| | Local | CI |
| --- | --- | --- |
| Outer wall | bypass secret from an untracked `.env` | bypass secret from a CI secret |
| Inner wall | `refresh.command`, or log in once with `login-headful` | `refresh.command` from CI-secret env vars, or a pre-captured state stored as a base64 secret |

## The agent reads a session; it does not type the login

The fixture test user's login is run by the user (`!` command) or a scheduler, never by the agent. A missing or expired state file → `blocked (auth: <state_file> expired)` plus the command below; after the user runs it, check the file's modified time changed and `authed_check` is visible.

```text
! cd <repo> && AUTH_CREDENTIALS_PROVIDER=<provider> AUTH_CREDENTIALS_ITEM="<item>" AUTH_LOGIN_URL="<login_url>" AUTH_STORAGE_STATE=<state_file> AUTH_POST_LOGIN_URL_PATTERN='^(?!.*/sign-in)' node .agents/aw/scripts/auth/login-credentials.mjs
```

- **Source:** `credentials.provider` (`env` | `bitwarden` | `1password`) is personal, in `~/.agents/aw/config.yml`; the item name is `auth.credentials.item`. Bitwarden needs `BW_SESSION` and a fresh `bw sync` (an item added since the last sync is invisible). A locked vault is `unconfirmed (unlock <provider> and re-run)`.
- **`auth.login_url` carries the org param** (`…/sign-in?org=<org>`). Without it a multi-org app bounces to a sign-in page for an org the user is not in, and the post-login check times out.
- **A failed login** prints `final page:` and `page errors:` and saves `<state_file>.fail.png`. "Incorrect password" → the stored item is wrong; another org in the URL → `login_url` lacks the org.
- **Unattended:** [`aw-refresh-auth.sh.template`](../templates/scripts/aw-refresh-auth.sh.template) and [`.plist.template`](../templates/scripts/aw-refresh-auth.plist.template) refresh the file every 6 h under the user's account (needs `bw unlock --raw > ~/.config/aw/bw-session`, `chmod 600`; use a vault that holds only the fixture user). The wrapper is untested; the login script is tested.

**Google SSO:** scripted Google logins are blocked. Use a password-capable test account against the app's own form, or a pre-captured state a human refreshes on a schedule; with neither, authed specs are `skipped` with the reason — never a faked pass.
Never put a real person's credentials in CI.
