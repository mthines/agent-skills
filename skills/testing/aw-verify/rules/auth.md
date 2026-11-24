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
3. A repo-provided credentials file that the repo's own authed Playwright tooling reads, such as `.browser/credentials.json`.
   Use it only when `git check-ignore -q <file>` exits 0 (gitignored); a tracked credentials file is a finding, never a login source.
   Reference it in `refresh.command`, which passes its fields to the login script as `E2E_EMAIL` and `E2E_PASSWORD` in that command's environment only; never print, log, echo, or copy the file or a value from it.
   Who runs that command follows [The agent reads a session](#the-agent-reads-a-session-it-does-not-type-the-login): the user or a scheduler, or the agent only under [Pre-authorized sign-in](#pre-authorized-sign-in).

Scaffold only when nothing is found.

```bash
# ✓ refresh.command — the values go straight into the login command's environment; nothing is printed
git check-ignore -q .browser/credentials.json && \
  E2E_EMAIL="$(jq -r .email .browser/credentials.json)" E2E_PASSWORD="$(jq -r .password .browser/credentials.json)" \
  AUTH_LOGIN_URL="<login_url>" AUTH_POST_LOGIN_URL_PATTERN='^(?!.*/sign-in)' AUTH_STORAGE_STATE=.auth/local.json \
  node .agents/aw/scripts/auth/login-credentials.mjs
# ✗ Wrong — prints the secret into the transcript
cat .browser/credentials.json
```

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

## Several identities

Test one environment as more than one user (admin vs member) with `auth.identities`, a map keyed by role; the environment's URL, stack, and `bypass_header` stay shared.
The top-level `auth` fields are the default identity; each `identities.<role>` entry overrides only `storage_state`, `identity`, `credentials`, and `refresh`.

```yaml
# ✓ One environment, two roles — each role has its own state file and vault item
auth:
  strategy: storage-state
  storage_state: .auth/local-admin.json
  authed_check: '{role: "button", name: "Account menu"}'
  refresh: { when: missing-or-expired, command: node .agents/aw/scripts/auth/login-credentials.mjs, env: [E2E_EMAIL, E2E_PASSWORD] }
  identity: { email: test+admin@example.com, role: admin }
  credentials: { item: "aw admin" }
  identities:
    member:
      storage_state: .auth/local-member.json
      identity: { email: test+member@example.com, role: member }
      credentials: { item: "aw member" }
      refresh: { when: missing-or-expired, command: E2E_EMAIL= E2E_PASSWORD= AUTH_CREDENTIALS_ITEM="aw member" AUTH_STORAGE_STATE=.auth/local-member.json node .agents/aw/scripts/auth/login-credentials.mjs, env: [] }
# ✗ Wrong — a second environment named local-member: `run` accepts only local|preview and the stack is read from environments.local
environments:
  local-member: { url: http://localhost:5173, auth: { ... } }
```

| Rule | Detail |
| --- | --- |
| Selecting | `--as <role>` picks `identities.<role>`; no flag, or `--as default`, uses the top-level `auth` |
| Unknown role | `blocked (auth: no identity "<role>" in environments.<env>)`; never fall back to the default |
| Login | Per identity, the command in [the section below](#the-agent-reads-a-session-it-does-not-type-the-login) with that identity's `credentials.item` and `storage_state` |
| `refresh` | Every identity sets its own `refresh.command` that names its own `AUTH_STORAGE_STATE` and `AUTH_CREDENTIALS_ITEM`, never `AUTH_CREDENTIALS_PROVIDER` (the runner exports it from the personal `credentials.provider`, like `PREVIEW_URL`), and blanks `E2E_EMAIL=` and `E2E_PASSWORD=` (the login script uses the vault item only when both are unset or empty); never inherit one that reads `E2E_EMAIL` / `E2E_PASSWORD`, which would sign in as the default user while `authed_check` still passes |
| Reporting | Two roles are two runs, each judged on its own criteria, e.g. "member does not see the Delete button". Each run rewrites the PR's `aggregate` region, so the earlier role's proof collapses into a Previous runs entry and a differing verdict can post a regression notice: read it as a role change. Name the role in each run's summary line |
| Seed data | `fixtures.seed` must create every user an identity names |

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

The fixture test user's login is run by the user (`!` command) or a scheduler, never by the agent, unless the personal config sets `sign_in_host` for that environment ([below](#pre-authorized-sign-in)). A missing or expired state file → `blocked (auth: <state_file> expired)` plus the command below; after the user runs it, check the file's modified time changed and `authed_check` is visible.

```text
! cd <repo> && AUTH_CREDENTIALS_PROVIDER=<provider> AUTH_CREDENTIALS_ITEM="<item>" AUTH_LOGIN_URL="<login_url>" AUTH_STORAGE_STATE=<state_file> AUTH_POST_LOGIN_URL_PATTERN='^(?!.*/sign-in)' node .agents/aw/scripts/auth/login-credentials.mjs
```

- **Source:** `credentials.provider` (`env` | `bitwarden` | `1password`) is personal, in `~/.agents/aw/config.yml`; the item name is `auth.credentials.item`. Bitwarden needs `BW_SESSION` and a fresh `bw sync` (an item added since the last sync is invisible). A locked vault is `unconfirmed (unlock <provider> and re-run)`.
- **`auth.login_url` carries the org param** (`…/sign-in?org=<org>`). Without it a multi-org app bounces to a sign-in page for an org the user is not in, and the post-login check times out.
- **A failed login** prints `final page:` and `page errors:` and saves `<state_file>.fail.png`. "Incorrect password" → the stored item is wrong; another org in the URL → `login_url` lacks the org.
- **Unattended:** [`aw-refresh-auth.sh.template`](../templates/scripts/aw-refresh-auth.sh.template) and [`.plist.template`](../templates/scripts/aw-refresh-auth.plist.template) refresh the file every 6 h under the user's account (needs `bw unlock --raw > ~/.config/aw/bw-session`, `chmod 600`; use a vault that holds only the fixture user). The wrapper is untested; the login script is tested.

**Google SSO:** scripted Google logins are blocked. Use a password-capable test account against the app's own form, or a pre-captured state a human refreshes on a schedule; with neither, authed specs are `skipped` with the reason — never a faked pass.
Never put a real person's credentials in CI.

## Pre-authorized sign-in

`auth.sign_in_host` is personal: it is read only from `~/.agents/aw/config.yml` → `repos.<slug>.environments.environments.<env>.auth.sign_in_host` ([`config.md § Personal keys`](./config.md#personal-keys)); the same key in the committed `environments.yml` is ignored.
When it is set for the environment being run, the agent may sign in itself, in the browser or with the login script, as the repo's fixture or e2e test user.

| Rule | Detail |
| --- | --- |
| Identity | Only the fixture or e2e test user the repo already provides: `auth.credentials.item`, the env vars `refresh.env` names, or a gitignored credentials file found by [Reuse before you scaffold](#reuse-before-you-scaffold). Never a real person's account |
| Host | Type the credentials only on a page whose host equals `sign_in_host` exactly (no subdomain, no lookalike). A redirect to any other host → stop and report `blocked (auth: sign-in left <sign_in_host> for <host>)` |
| Accounts | Never create, register, invite, or reset an account, and never change a password or MFA setting |
| Secrets | Never print, log, screenshot, or write a credential; a screenshot of the sign-in form is taken before typing or after submitting, never with a field filled |
| Afterwards | Save the session to the environment's `storage_state` and confirm `authed_check`, the same as a user-run login |

No `sign_in_host` for the environment, or a host that does not match → the rule above stands: `blocked (auth: <state_file> expired)` plus the `!` command for the user.
**Why:** the user granted a sign-in on one host for one test user; anything wider is a credential the agent was never given ([`references/design.md § The agent signs in only where the user said`](../references/design.md#the-agent-signs-in-only-where-the-user-said)).

```yaml
# ✓ ~/.agents/aw/config.yml — personal, never committed
repos:
  acme/shop:
    environments:
      environments:
        local: { auth: { sign_in_host: shop-test.accounts.dev } }
# ✗ Wrong — committed .agents/aw/environments.yml: grants every clone's agent a sign-in the user never gave
environments:
  local: { auth: { sign_in_host: shop-test.accounts.dev } }
```
