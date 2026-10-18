---
title: 'Auth bootstrap scripts (strategies a and b)'
impact: MEDIUM
tags:
  - aw-setup
  - auth
---

# Auth bootstrap scripts

Read when the user picks strategy (a) or (b) in Phase B.
Both scripts in [`../templates/`](../templates/) produce the same Playwright `storageState` JSON; aw-tester does not care which one wrote it.

## Choose

```text
Is the login form plain HTML (email + password + submit, no redirects)?
├─ Yes → Can the password live in a CI secret / .env.local safely?
│        ├─ Yes → (b) Automated credentials
│        └─ No  → (a) Interactive headful capture
└─ No (SSO, OAuth, magic link, MFA) → (a) Interactive headful capture
```

Switching later: re-run `/aw-setup` and pick the other strategy; rewrite the script and `refresh.command` together.

## (a) Interactive headful capture — `auth-bootstrap-headful.template.mjs`

Opens a headful Chromium at `AUTH_LOGIN_URL` and saves the storage state when the URL matches `AUTH_POST_LOGIN_URL_PATTERN` or the user closes the window.

| Var | Required | Purpose |
| --- | --- | --- |
| `AUTH_LOGIN_URL` | Yes | The page to open |
| `AUTH_STORAGE_STATE` | Yes | Output path (`./.auth/<name>.json`) |
| `AUTH_POST_LOGIN_URL_PATTERN` | No | JS regex source; auto-save and close when matched |
| `AUTH_TIMEOUT_MS` | No | Max wait for the pattern (default 10 min) |

```yaml
auth:
  strategy: storage-state
  storage_state: ./.auth/local.json
  refresh:
    when: missing-or-expired
    command: |
      AUTH_LOGIN_URL=http://localhost:3000/login \
        AUTH_STORAGE_STATE=./.auth/local.json \
        AUTH_POST_LOGIN_URL_PATTERN='/dashboard' \
        node scripts/auth-bootstrap-headful.mjs
    timeout_seconds: 600   # user-driven step
```

## (b) Automated credentials — `auth-bootstrap-credentials.template.mjs`

Headless login that fills the form with `E2E_EMAIL` / `E2E_PASSWORD`, waits for `AUTH_POST_LOGIN_URL_PATTERN`, and saves the state.
The locator block marked `>>> CUSTOMIZE <<<` must match the project's form; show it to the user for review.
Not for SSO, OAuth redirects, magic links, or required MFA — use (a).

| Var | Required | Purpose |
| --- | --- | --- |
| `AUTH_LOGIN_URL` | Yes | The page hosting the login form |
| `AUTH_STORAGE_STATE` | Yes | Output path (`./.auth/<name>.json`) |
| `AUTH_POST_LOGIN_URL_PATTERN` | Yes | JS regex source matched after submit |
| `E2E_EMAIL` | Yes | Test user's email or username |
| `E2E_PASSWORD` | Yes | Test user's password — env var, never committed |
| `AUTH_TIMEOUT_MS` | No | Max wait for the post-login URL (default 30 s) |

```yaml
auth:
  strategy: storage-state
  storage_state: ./.auth/local.json
  refresh:
    when: missing-or-expired
    command: |
      AUTH_LOGIN_URL=http://localhost:3000/login \
        AUTH_STORAGE_STATE=./.auth/local.json \
        AUTH_POST_LOGIN_URL_PATTERN='/dashboard' \
        node scripts/auth-bootstrap-credentials.mjs
    timeout_seconds: 60
```

```bash
# .env.local — gitignored, never committed
export E2E_EMAIL="test+aw@example.com"
export E2E_PASSWORD="<from-your-secret-store>"
```

The most common probe failure is a locator mismatch in the `CUSTOMIZE` block: show the failing locator and offer a one-shot Playwright probe that prints the form's real labels.

## Runtime dependency

Both scripts `import { chromium } from 'playwright'`.
aw-tester's pinned Playwright resolution (project install → branch-local install → install once) provides it when the project has no install.
