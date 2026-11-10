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

## Fixture test-user login is pre-authorized (every driver)

The login uses a fixture test user, not a person's account and not SSO. The user has authorized it for every `aw-verify` run, so do not ask first and do not hand the step back:

- **Playwright / headless:** a missing, expired, or login-page state file → run `refresh.command` (it reads the test user's credentials from env vars or `.browser/credentials.json`), wait for `authed_check`, and carry on. Do not stop to ask the user to run a login script.
- **Chrome driver:** see the next section.

**Credential source.** `credentials.provider` in `~/.agents/aw/config.yml` (`env`, `bitwarden`, `1password`; set by `/aw-verify setup`) says where `refresh.command` reads the login. The item name lives in the environment's `auth.credentials.item`. The runner exports `AUTH_CREDENTIALS_PROVIDER` and `AUTH_CREDENTIALS_ITEM`, and `login-credentials` reads the item from the unlocked manager at run time, so no password file is needed. A locked vault is `unconfirmed (unlock <provider> and re-run)`; never ask for the master password.

**Unattended refresh.** For a run with no human, schedule the login outside the agent: copy [`aw-refresh-auth.sh.template`](../templates/scripts/aw-refresh-auth.sh.template) to `~/.config/aw/aw-refresh-auth.sh` and fill [`aw-refresh-auth.plist.template`](../templates/scripts/aw-refresh-auth.plist.template) into `~/Library/LaunchAgents/`. The user installs it (`launchctl load`) and writes the Bitwarden key once (`bw unlock --raw > ~/.config/aw/bw-session`, `chmod 600`). The agent never loads it. It refreshes the state file every 6 hours; the agent only reads it. Untested until the first successful run is confirmed.

The limits stay: only the environment's `auth.identity` test user, never a real person's password, never SSO, never repeat a credential value in chat, a report, or a log, and never write one to a tracked file.

## Sign in inside Chrome (chrome driver)

When the run drives the user's own Chrome and the tab lands on the login page, sign in there yourself with the environment's test identity. Do not hand the step back to the user.
The user has authorized this for every `aw-verify` run, with no per-host confirmation: the credentials are fixture test-user data, not personal auth data, so reading and entering them is not sensitive.

- Credentials: the test user that `refresh.command` reads (for example `.browser/credentials.json`). Never use a real person's password, and never use SSO.
- Never repeat a credential value in chat, a report, or a log.
- Only the login page of the environment under test (its `url`, or the sign-in host its app redirects to, such as the Clerk host). A sign-in page the run was not sent to, or one that asks for a real person's account, is not covered: stop and report it.

**Google SSO:** scripted Google logins are blocked. Use a password-capable test account against the app's own form, or a pre-captured state a human refreshes on a schedule; with neither, authed specs are `skipped` with the reason — never a faked pass.
Never put a real person's credentials in CI.
