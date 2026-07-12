---
name: aw-setup
description: >
  One-time (but safely re-runnable) per-project setup flow with two modes.
  aw-target mode scaffolds a project's aw-tester aw-target (detects auth
  strategy, captures storage state, writes .claude/aw-targets/local.yml,
  validates with a smoke spec). repo-profile mode scans the repo (including
  monorepo layout), detects each area's stack, and scaffolds committed
  path-scoped .claude/rules/*.md convention rules (React for UI, API for
  backend) via the docs skill, so aw applies per-area best practices
  consistently. Both modes re-run idempotently — detect the existing state and
  only re-prompt for what broke or changed. Triggers on "/aw-setup", "setup
  aw-tester", "scaffold aw-target", "aw-setup repo-profile", "scaffold repo
  conventions".
disable-model-invocation: false
argument-hint: '[aw-target|repo-profile]'
license: MIT
metadata:
  author: mthines
  version: '1.2.0'
  workflow_type: slash-command
  tags:
    - aw-tester
    - aw-target
    - auth
    - setup
    - repo-profile
    - conventions
    - autonomous-workflow
---

# aw-setup — Per-Project Scaffolding for the autonomous-workflow

Interactive, idempotent setup flow with **two modes**. Run either once per
project; re-run when the underlying state drifts.

## Mode detection

Parse `$ARGUMENTS` (first token) and select the mode. When no token is given,
ask once which mode the user wants — never guess.

| Mode | Default token | What it scaffolds | Where it goes | Committed? |
| ---- | ------------- | ----------------- | ------------- | ---------- |
| **aw-target** (this file) | `aw-target` (default) | aw-tester auth/base-URL/fixtures | `.claude/aw-targets/local.yml` | Yes (secrets gitignored) |
| **repo-profile** | `repo-profile` | Committed per-area convention rules ([`rules/repo-profile.md`](./rules/repo-profile.md)) | `.claude/rules/*.md` (via the `docs` skill) | Yes (learned layer gitignored) |

The **repo-profile** mode is the setup half of the two-layer repo-convention
system: it seeds the **committed** convention rules (Layer 1), while the
runtime **learned** layer (Layer 2, gitignored `aw-conventions` deltas that
promote up into these rules) is owned by
[`../rules/convention-memory.md`](../rules/convention-memory.md). Its full
procedure is in [`rules/repo-profile.md`](./rules/repo-profile.md); the rest of
*this* file documents the **aw-target** mode.

---

# aw-target mode — Aw-Target Scaffolding for aw-tester

Interactive, idempotent setup flow that scaffolds the `.claude/aw-targets/` config
that `aw-tester` needs to run specs. Run it **once** before the first autonomous
PR that touches UI. Re-run it when auth drifts, fixtures change, or base URL moves.

> **This is the prerequisite for spec-driven UI verification in the
> autonomous-workflow.** Without an aw-target file, `aw-tester` cannot run and
> the executor's Phase 4 spec verification step skips cleanly.

---

## When to run

- **First time:** before running any autonomous feature that touches UI.
- **Re-run:** when `aw-tester` reports `auth-refresh-failed`, when the base URL
  changes, or when seed fixtures are restructured.
- **Never auto-triggered by the planner.** The planner halts and tells the user
  to run `/aw-setup`. The user runs it explicitly.

---

## Idempotency contract

**First run:** full guided scaffolding (Phases A–E).

**Re-run:** detect `.claude/aw-targets/local.yml` exists, validate each field:
- Auth storage state: does the file exist? Is it fresh (< N days old)?
- Fixtures: does the seed command resolve? Do references point to env vars that exist?
- Smoke spec: run it. If green, done — no prompts needed.
- Only prompt for what broke or is missing.
- Show a unified diff before overwriting any field in the aw-target file.
- Never silently overwrite `.auth/*.json`.

---

## Phases

### Phase A — Detect

Read the project to guess the aw-target configuration. Look for:

| Signal | What to look for |
|--------|-----------------|
| Base URL | `next.config.*`, `vite.config.*`, `package.json` scripts (dev port), env files (`.env`, `.env.local`) |
| Auth strategy | `next-auth` / `auth.js` imports, custom `/api/auth` routes, OAuth config |
| Test backdoors | Dev-only cookies (`__e2e_token`), test env vars (`E2E_AUTH_TOKEN`), seed scripts in `package.json` |
| Fixtures / seed | `db:seed`, `db:reset`, `seed:aw`, `test:setup` scripts |
| Existing aw-target | `.claude/aw-targets/local.yml` (re-run path) |

Detection confidence level:
- **High:** base URL found in env, auth strategy clear, seed script named explicitly.
- **Medium:** base URL guessed from port, auth strategy inferred.
- **Low:** nothing found — fall through to Ask with all questions.

### Phase B — Ask

Use `AskUserQuestion` with a single batched message. Default is 3–4 questions
when detection confidence is high; expand only when detection is uncertain or
for a re-run that detected broken fields.

**Questions (lean set — skip any the detector answered with high confidence):**

1. What is the base URL for local development? (e.g. `http://localhost:3000`)
2. **How should aw-tester get an authenticated session?** Five strategies, in
   order from "best default" to "last resort" (see [Auth flow templates](#auth-flow-templates)
   for the full mechanics of each):

   | # | Strategy | When to pick | aw-setup writes |
   |---|----------|--------------|-----------------|
   | a | **Interactive headful capture** (recommended for first-time setup, SSO, OAuth, passwordless) | You can log in by hand once and reuse the session for days/weeks | `scripts/auth-bootstrap-headful.mjs` + `auth.refresh.command` in aw-target.yml |
   | b | **Automated credentials (env vars)** (CI / unattended re-auth) | Plain HTML email+password form, no MFA, no CAPTCHA | `scripts/auth-bootstrap-credentials.mjs` + `auth.refresh.command` in aw-target.yml |
   | c | **Existing bootstrap command** (you already have `pnpm run auth:bootstrap` or similar) | You've already invested in a login script | aw-target.yml referencing your command |
   | d | **None** | The aw-target is public or pre-authed | aw-target.yml with `auth.strategy: none` |
   | e | **Manual** (SSO with no test mode, hardware MFA, mandatory CAPTCHA) | Automation is genuinely impossible | aw-target.yml with `auth.strategy: manual` — aw-tester will skip authed specs |

   When in doubt, pick (a) — it works for nearly every login flow and produces
   the same `storage_state` artifact the other strategies converge to.
3. What email/role should the test user have? (informational — used in smoke
   spec description and as the default for `E2E_EMAIL` if you picked strategy b)
4. Is there a seed command that creates test fixtures? (e.g. `pnpm run db:seed:aw`)

**Re-run:** only ask about fields that failed validation. State which fields were
validated successfully so the user knows what was checked.

**Incompatible auth detection:**
If the project uses hardware MFA, mandatory CAPTCHA, or SSO without a test mode,
set `auth.strategy: manual` and warn:
```
Auth strategy set to "manual". aw-tester will skip authed specs autonomously
and mark them "skipped" with reason "auth.strategy: manual". To enable
authed spec verification, add a test-mode login backdoor (e.g. a dev token
accepted via cookie) and re-run /aw-setup.
```

### Phase C — Probe

Run the chosen auth flow once to validate it produces a working storage state.
Behaviour depends on the strategy picked in Phase B:

| Strategy | Probe command | Expected outcome |
|----------|---------------|------------------|
| (a) Interactive headful capture | `AUTH_LOGIN_URL=... AUTH_STORAGE_STATE=./.auth/local.json node scripts/auth-bootstrap-headful.mjs` | Headful browser opens. User logs in. `.auth/local.json` is written when the user closes the browser (or hits a `POST_LOGIN_URL_PATTERN`). |
| (b) Automated credentials | `AUTH_LOGIN_URL=... AUTH_STORAGE_STATE=./.auth/local.json AUTH_POST_LOGIN_URL_PATTERN='/dashboard' E2E_EMAIL=... E2E_PASSWORD=... node scripts/auth-bootstrap-credentials.mjs` | Headless run. `.auth/local.json` written on success. Script exits non-zero with a diagnostic if locators or credentials are wrong. |
| (c) Existing bootstrap command | `timeout 30 <user-provided command>` | The user's command produces `.auth/local.json`. |
| (d) None | (skip — no auth) | n/a |
| (e) Manual | (skip — aw-tester will skip authed specs) | n/a |

Then for every strategy except (d) / (e):
1. Verify `.auth/local.json` was written.
2. Load one fixture URL (base_url + `/`) and confirm it renders (HTTP 200 and
   the page title is not an error page).
3. If the probe fails, report the error and loop back to Phase B.

For strategy (b), the most common probe failure is a locator mismatch — the
script's default `getByLabel(/email/i)` / `getByLabel(/password/i)` / submit
button regex don't match the project's form. The fix is a 3-line edit to the
`CUSTOMIZE` block in `scripts/auth-bootstrap-credentials.mjs`. aw-setup
shows the failing locator and offers to surface the form's actual labels via
a one-shot Playwright probe so the user can paste them into the script.

### Phase D — Write

Write the aw-target file, the chosen bootstrap script (if applicable), and
ensure the auth file is gitignored.

**First run:**

```bash
mkdir -p .claude/aw-targets scripts
# write .claude/aw-targets/local.yml from the template
# if strategy is (a): copy auth-bootstrap-headful.template.mjs → scripts/auth-bootstrap-headful.mjs
# if strategy is (b): copy auth-bootstrap-credentials.template.mjs → scripts/auth-bootstrap-credentials.mjs
```

Show the complete aw-target YAML AND the bootstrap script to the user for
review before writing. For strategy (b), explicitly call out the `CUSTOMIZE`
block in the script and confirm the user has reviewed the locators.

**Re-run:** show a unified diff:
```
--- .claude/aw-targets/local.yml (existing)
+++ .claude/aw-targets/local.yml (proposed)
@@ ...
```

Require user confirmation before writing. If the diff is empty, say "No changes
needed — aw-target is up to date."

**Gitignore guard:**
```bash
# Add .auth/ to .gitignore if not already present
grep -q "^\.auth/" .gitignore 2>/dev/null || echo ".auth/" >> .gitignore
```

Never overwrite `.auth/*.json` silently. If the file exists and a new one would
be produced by the bootstrap command, ask: "Overwrite existing auth state at
`.auth/local.json`?"

### Phase E — Smoke-test

Call `aw-tester` with a one-spec smoke to validate the aw-target end-to-end:

```
aw-tester:
  specs: |
    # Specs: Smoke Test
    Target: local
    
    ## Spec 1: Homepage loads as the identified test user
    persist: verify-only
    url: /
    preconditions:
      - User is logged in as {auth.identity.email}
    flow:
      - WHEN page loads
        THEN page title is not "Error" and not "404"
        AND page does not contain {text: "Sign in"}
  aw-target: local
  mode: --bail-on-first-red
```

| Verdict | Action |
|---------|--------|
| `green` | Done. Aw-Target is scaffolded and validated. |
| `red` | Show the diagnostic blob. Loop back to Phase B with the specific failure. |
| `inconclusive` | Auth strategy is `manual` — expected. Aw-Target is written, authed specs will be skipped. |

---

## Dry-run example

Here is what a first-run session looks like for a Next.js project:

```
[A] Detecting project configuration...
    ✓ Base URL: http://localhost:3000 (from .env.local: NEXT_PUBLIC_URL)
    ✓ Auth: next-auth detected at /api/auth/[...nextauth]
    ? No test backdoor found. Will ask.
    ✓ Seed script: pnpm run db:seed:aw (from package.json)

[B] A few questions:
    1. Confirm base URL: http://localhost:3000 (detected) [enter to confirm]
    2. Auth strategy: I found next-auth. Do you have a bootstrap command that
       logs in and captures storage state? (e.g. `pnpm run auth:bootstrap`)
       If not, I can set auth.strategy: manual.
    3. Test user email + role?

    User: [confirmed base URL] [provides: pnpm run auth:bootstrap] [test+aw@example.com, admin]

[C] Probing...
    Running: pnpm run auth:bootstrap (timeout: 30s)
    ✓ .auth/local.json written (12kb)
    Loading http://localhost:3000/ ... ✓ HTTP 200, title: "Dashboard"

[D] Writing aw-target:
    Creating .claude/aw-targets/local.yml ...
    [shows YAML preview]
    Adding .auth/ to .gitignore
    Confirm? [y/N] y
    ✓ .claude/aw-targets/local.yml written

[E] Smoke spec...
    Running aw-tester smoke spec...
    verdict: green
    ✓ Aw-Target validated. aw-tester is ready.
```

---

## Re-run example

```
[Re-run detected] .claude/aw-targets/local.yml exists.
Validating...
    ✓ base_url: http://localhost:3000 — reachable
    ✗ auth.storage_state: .auth/local.json — missing (deleted or expired)
    ✓ fixtures.seed: pnpm run db:seed:aw — script exists

One field needs attention: auth storage state is missing.
[C] Re-running auth bootstrap...
    Running: pnpm run auth:bootstrap (timeout: 30s)
    ✓ .auth/local.json written (12kb)
[D] No changes to aw-target.yml needed.
[E] Smoke spec... verdict: green
✓ Aw-Target re-validated.
```

---

## Aw-Target file location

| File | Path | Committed? |
|------|------|-----------|
| Aw-Target definition | `.claude/aw-targets/local.yml` | Yes |
| Bootstrap script (strategy a or b) | `scripts/auth-bootstrap-headful.mjs` or `scripts/auth-bootstrap-credentials.mjs` | Yes |
| Auth storage state | `.auth/local.json` | **No — gitignored** |
| Credentials (strategy b) | `E2E_EMAIL` / `E2E_PASSWORD` env vars (e.g. `.env.local`) | **No — gitignored** |

The aw-target file and bootstrap script are committed so teammates can use the
same flow. The auth storage state and credentials are gitignored — they
contain secrets.

---

## Auth flow templates

aw-setup ships two ready-to-copy bootstrap scripts under
[`templates/`](./templates/). Both produce the same artifact (a Playwright
`storageState` JSON) but get there differently:

### (a) Interactive headful capture — `auth-bootstrap-headful.template.mjs`

**What it does.** Launches a headful Chromium pointed at `AUTH_LOGIN_URL`,
prints "log in then close the window" to stderr, and saves storage state
when either:
- the page URL matches `AUTH_POST_LOGIN_URL_PATTERN` (if provided), or
- the user closes the browser window (via a `browser.on('disconnected')`
  handler — the save is idempotent).

**When to pick this.** SSO, OAuth, passwordless flows, anything that's hard
to script. Also a fine default for first-time setup — log in once, reuse the
session for days. To refresh, run the script again.

**Env contract.**
| Var | Required | Purpose |
|-----|----------|---------|
| `AUTH_LOGIN_URL` | Yes | The page to open |
| `AUTH_STORAGE_STATE` | Yes | Output path (`./.auth/<name>.json`) |
| `AUTH_POST_LOGIN_URL_PATTERN` | No | JS regex source; auto-save + close when matched |
| `AUTH_TIMEOUT_MS` | No | Max wait for the pattern (default 10 min) |

**Bootstrap command in aw-target.yml:**
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
    timeout_seconds: 600   # generous — user-driven step
```

### (b) Automated credentials — `auth-bootstrap-credentials.template.mjs`

**What it does.** Headless Chromium logs in by filling a plain HTML form with
`E2E_EMAIL` / `E2E_PASSWORD`, waits for `AUTH_POST_LOGIN_URL_PATTERN`, and
saves storage state. The locator block at the top of the script is marked
`>>> CUSTOMIZE <<<` because every project's login form has different labels.

**When to pick this.** Plain HTML email+password form, no MFA / CAPTCHA, you
want unattended refreshes (CI, scheduled re-auth, mass test execution).
**Skip this** if your login is SSO, OAuth-redirect, magic-link, or has
required MFA — those need (a).

**Env contract.**
| Var | Required | Purpose |
|-----|----------|---------|
| `AUTH_LOGIN_URL` | Yes | The page that hosts the login form |
| `AUTH_STORAGE_STATE` | Yes | Output path (`./.auth/<name>.json`) |
| `AUTH_POST_LOGIN_URL_PATTERN` | Yes | JS regex source matched after submit |
| `E2E_EMAIL` | Yes | The test user's email/username |
| `E2E_PASSWORD` | Yes | The test user's password (env var, never committed) |
| `AUTH_TIMEOUT_MS` | No | Max wait for the post-login URL (default 30s) |

**Bootstrap command in aw-target.yml:**
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

Then declare the credentials env vars in `.env.local` (gitignored) or your
CI secret store:
```bash
# .env.local — DO NOT COMMIT
export E2E_EMAIL="test+aw@example.com"
export E2E_PASSWORD="<from-1password-or-similar>"
```

### Which one wins for your project?

A quick decision aid (the same logic aw-setup uses in Phase B):

```
Is the login form plain HTML (email + password + submit, no redirects)?
├─ Yes → Can you store the password in a CI secret / .env.local safely?
│        ├─ Yes → (b) Automated credentials
│        └─ No  → (a) Interactive headful capture
└─ No (SSO, OAuth, magic link, MFA) → (a) Interactive headful capture
```

Both flows produce the same `.auth/<name>.json` — aw-tester does not care
which one created it. You can switch later by re-running `/aw-setup` and
picking a different strategy; aw-setup detects the change and offers to
rewrite the bootstrap script + the `refresh.command` line in lockstep.

---

## Compatibility notes

- **No dependency on `playwright.config.ts`** — aw-setup probes via `npx playwright@latest`.
- **No dependency on `aw-tester` being installed** — aw-setup brings its own probe.
- If `playwright` is already installed locally, aw-setup uses the local binary;
  otherwise it falls back to `npx playwright@latest`.
- The bootstrap scripts (`scripts/auth-bootstrap-*.mjs`) `import { chromium } from 'playwright'`,
  so they need Playwright available at runtime. aw-tester's pinned binary
  resolution covers this transparently (see [`templates/aw-tester.agent.md`](../templates/aw-tester.agent.md#pinned-playwright-resolution-replaces-npx---yes-playwrightlatest))
  — if no project install is found, the cached branch-local install is reused.

---

## Definition of done

- [ ] `.claude/aw-targets/local.yml` written and reviewed by the user.
- [ ] If strategy (a) or (b): the matching bootstrap script written under
      `scripts/auth-bootstrap-*.mjs` and reviewed by the user (especially
      the `CUSTOMIZE` block for strategy b).
- [ ] `.auth/local.json` exists (or `auth.strategy: manual` is set).
- [ ] `.auth/` is in `.gitignore`. If strategy (b), `.env.local` (or whichever
      file holds `E2E_PASSWORD`) is also in `.gitignore`.
- [ ] Smoke spec returned `green` (or `inconclusive` for `manual` auth strategy).
- [ ] User told what to do next:
  - "Run an autonomous task that touches UI — the executor's Phase 4 will
    now run `aw-tester` automatically."
  - "Re-run `/aw-setup` when auth expires or fixtures change."
  - For strategy (b): "If the login form changes, edit the `CUSTOMIZE` block
    in `scripts/auth-bootstrap-credentials.mjs`. The locator ladder is
    role/label-based so it tolerates most CSS / DOM changes."
