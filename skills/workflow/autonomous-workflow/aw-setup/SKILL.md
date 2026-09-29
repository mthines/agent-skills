---
name: aw-setup
description: >
  One-time (but safely re-runnable) setup flow that scaffolds a project's
  aw-tester aw-target: detects auth strategy, captures storage state, writes
  .claude/aw-targets/<target>.yml, and validates with a smoke spec. `--target
  local` (default) scaffolds the local dev target; `--target preview` scaffolds
  the PR-preview target ui-verify runs against (and is what `/ui-verify setup`
  delegates to). Also records the repo's UI surface (what counts as a UI change)
  so the is-ui-diff gate is accurate per repo, and the preview auth profile.
  Re-runs detect the existing aw-target and only re-prompt for what broke or
  changed. Triggers on "/aw-setup", "setup aw-tester", "scaffold aw-target".
disable-model-invocation: false
argument-hint: '[--target local|preview]'
license: MIT
metadata:
  author: mthines
  version: '1.3.0'
  workflow_type: slash-command
  tags:
    - aw-tester
    - aw-target
    - auth
    - setup
    - autonomous-workflow
---

# aw-setup — Aw-Target Scaffolding for aw-tester

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
- **Never auto-triggered by the planner.** The planner no longer halts on a
  missing aw-target — it degrades to localhost defaults and suggests `/aw-setup`
  in one non-blocking line. Running it is what upgrades those defaults to a
  pinned `base_url`, real auth, and fixtures, so specs run reliably instead of
  best-effort. The user runs it explicitly.

---

## Idempotency contract

**First run:** full guided scaffolding (Phases A–E).

**Re-run:** detect `.claude/aw-targets/{target}.yml` exists (the file named by
`--target`, default `local`), validate each field:
- Auth storage state: does the file exist? Is it fresh (< N days old)?
- Fixtures: does the seed command resolve? Do references point to env vars that exist?
- Smoke spec: run it. If green, done — no prompts needed.
- Only prompt for what broke or is missing.
- Show a unified diff before overwriting any field in the aw-target file.
- Never silently overwrite the auth storage-state file (`.auth/*.json`, or the
  repo's own convention such as `.browser/auth-state*.json`).

---

## Target selection

Each run scaffolds **one** aw-target. Which one is the `--target` argument
(default `local` when absent, preserving the pre-1.3 behaviour):

| `--target` | File written | `base_url` | Consumed by | Phase E smoke |
| --- | --- | --- | --- | --- |
| `local` (default) | `.claude/aw-targets/local.yml` | a real localhost URL (Phase A detects it) | autonomous-workflow Phase 4, local author→run loops | runs against localhost |
| `preview` | `.claude/aw-targets/preview.yml` | `RESOLVED_AT_RUNTIME` — ui-verify resolves the PR's branch-alias URL per run | `ui-verify run` / `verify` against PR previews (and `/ui-verify setup` delegates here) | skipped — no preview URL exists until a PR is open; **Phase G's confirming login validates instead** |

The two coexist — a repo commonly commits both a `local.yml` and a `preview.yml`.
Everything below is written for `local`; the **`preview`** deltas are called out
inline under each phase. Both files are committed (they carry no secrets) and are
the source of truth the tools execute; the LoreKit records (UI surface, auth
profile) are agent-facing discovery indexes layered on top — see Phases F and G.

## Phases

### Phase A — Detect

Read the project to guess the aw-target configuration. Look for:

| Signal | What to look for |
|--------|-----------------|
| Base URL | `next.config.*`, `vite.config.*`, `package.json` scripts (dev port), env files (`.env`, `.env.local`) |
| Auth strategy | `next-auth` / `auth.js` imports, custom `/api/auth` routes, OAuth config |
| Test backdoors | Dev-only cookies (`__e2e_token`), test env vars (`E2E_AUTH_TOKEN`), seed scripts in `package.json` |
| Fixtures / seed | `db:seed`, `db:reset`, `seed:aw`, `test:setup` scripts |
| Existing aw-target | `.claude/aw-targets/*.yml` (re-run path) |
| Existing auth convention | A storage-state file or login script the repo already uses — see [Reuse before you scaffold](#reuse-before-you-scaffold) |

Detection confidence level:
- **High:** base URL found in env, auth strategy clear, seed script named explicitly.
- **Medium:** base URL guessed from port, auth strategy inferred.
- **Low:** nothing found — fall through to Ask with all questions.

**`--target preview` delta:** do **not** detect a base URL — a preview has no
fixed URL; it is resolved per-PR at run time by ui-verify (the branch-alias
URL), so `base_url` is written as the literal `RESOLVED_AT_RUNTIME` marker. Still
detect the **auth** signals (that is the whole point of a preview target), and
detect whether the preview sits behind host deployment protection (a Vercel
`vercel.json`, a `VERCEL_AUTOMATION_BYPASS_SECRET` in CI config) so Phase B can
offer the outer-wall bypass header.

#### Reuse before you scaffold

`.auth/<name>.json` + `scripts/auth-bootstrap-*.mjs` is this skill's **fallback
scaffold**, not a mandate. If the repo already has an auth convention, reuse it
instead of creating a parallel one — a second location silently drifts from the
one the rest of the repo maintains.

Probe in this order and stop at the first hit:

1. **An existing aw-target** — any `.claude/aw-targets/*.yml` that sets
   `auth.storage_state`. Reuse its `storage_state` path and `refresh.command`
   verbatim; do not rewrite them.
2. **A captured storage-state file** already in the repo:
   `.browser/auth-state*.json` (the dash0 / `playwright-cli-authed` convention),
   else `.auth/*.json` (this skill's default).
3. **A login / refresh script** already in the repo:
   `.claude/aw-targets/scripts/refresh-auth*.mjs` or `.browser/refresh-auth*.mjs`
   (dash0), else `scripts/auth-bootstrap-*.mjs` (this skill's default).

When a convention is found, substitute its paths for `.auth/<name>.json` and
`scripts/auth-bootstrap-*.mjs` everywhere below — the Phase C probe, the Phase D
write, the gitignore guard, and the file-location table — and match the repo's
existing gitignore entry (`.browser/` vs `.auth/`). Only when nothing is found do
you scaffold the generic `.auth/` setup.

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
| (a) Interactive headful capture | `AUTH_LOGIN_URL=... AUTH_STORAGE_STATE=<storage_state path> node scripts/auth-bootstrap-headful.mjs` | Headful browser opens. User logs in. `<storage_state path>` is written when the user closes the browser (or hits a `POST_LOGIN_URL_PATTERN`). |
| (b) Automated credentials | `AUTH_LOGIN_URL=... AUTH_STORAGE_STATE=<storage_state path> AUTH_POST_LOGIN_URL_PATTERN='/dashboard' E2E_EMAIL=... E2E_PASSWORD=... node scripts/auth-bootstrap-credentials.mjs` | Headless run. `<storage_state path>` written on success. Script exits non-zero with a diagnostic if locators or credentials are wrong. |
| (c) Existing bootstrap command | `timeout 30 <user-provided command>` | The user's command produces `<storage_state path>`. |
| (d) None | (skip — no auth) | n/a |
| (e) Manual | (skip — aw-tester will skip authed specs) | n/a |

`<storage_state path>` is `.auth/local.json` by default. When
[Reuse before you scaffold](#reuse-before-you-scaffold) detected an existing
convention, substitute its path instead (e.g. `.browser/auth-state.json`) —
do not probe against the default path when a convention was found.

Then for every strategy except (d) / (e):
1. Verify `<storage_state path>` was written.
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

**`--target preview` delta:** write `.claude/aw-targets/preview.yml` from
[`ui-verify/templates/preview-target.yml.template`](../../../testing/ui-verify/templates/preview-target.yml.template)
(not the local template), keeping `base_url: RESOLVED_AT_RUNTIME`. For a
non-interactive preview login, scaffold `refresh-auth.mjs` from
[`ui-verify/templates/refresh-auth.mjs.template`](../../../testing/ui-verify/templates/refresh-auth.mjs.template)
rather than an `auth-bootstrap-*.mjs`, and when the preview is behind host
deployment protection, uncomment and fill the `bypass_header` block (the outer
wall). The full flow is [`ui-verify/rules/preview-auth.md`](../../../testing/ui-verify/rules/preview-auth.md).

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

**Gitignore guard:** ensure the auth directory actually in use is ignored — the
reused convention's dir when one was detected (e.g. `.browser/`), otherwise the
`.auth/` default:
```bash
# AUTH_DIR is the directory of auth.storage_state — .browser/ when a convention
# was reused, else .auth/ for a fresh scaffold.
AUTH_DIR="$(dirname "${AUTH_STORAGE_STATE:-.auth/local.json}")/"
grep -q "^${AUTH_DIR}" .gitignore 2>/dev/null || echo "${AUTH_DIR}" >> .gitignore
```

Never overwrite the auth storage-state file silently. If it exists and a new one
would be produced by the bootstrap command, ask: "Overwrite existing auth state
at `<storage_state path>`?"

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

**`--target preview` delta:** skip this phase — there is no preview URL to smoke
against until a PR is open. The end-to-end validation for a preview target is
**Phase G's confirming login** (exercise `refresh.command`, confirm
`authed_check`), which runs next. A `preview` run therefore goes A → B → C → D →
G, with E omitted and F run when memory is connected.

### Phase F — Learn the repo's UI surface (optional, one LoreKit record)

The `is-ui-diff` gate (run by `ui-verify author`, `aw-planner` Phase 1,
`create-pr`, and `review-loop`) decides mechanically whether a diff touches UI.
Its broad defaults already serve a fresh repo, so this phase is a **refinement**,
not a prerequisite — it teaches the gate what *this* repo counts as UI, once, for
every future PR.

Skip this phase silently and log one line if LoreKit's `memory.*` tools are not
connected: `aw-setup: memory.* not connected — UI surface not recorded, gate uses defaults`.

Otherwise, propose a surface from what Phase A already detected — the framework,
the source layout, whether it is a frontend-only app or a monorepo — and confirm
with the user before writing. Only ask when the defaults would get this repo
wrong:

- A **frontend-only** repo where plain `.ts`/`.js` are UI → add them to
  `extensions`.
- A **monorepo** where only some packages are UI → pin `dirs` to those packages,
  and `exclude` the backend ones (or use `mode: "replace"`).
- A repo whose components live under a non-default directory → add it to `dirs`.

Write the record exactly as [`ui-verify/rules/memory.md § The UI surface
record`](../../../testing/ui-verify/rules/memory.md#the-ui-surface-record)
defines it — scope `repo::{owner}/{repo}`, key `ui-verify-lessons::ui-surface`,
tags `loop::ui-verify-lessons` + `kind::config`, body the surface JSON:

```text
memory.write {
  scope: "repo::{owner}/{repo}",
  key:   "ui-verify-lessons::ui-surface",
  value: "{ \"mode\": \"extend\", \"dirs\": [\"src/web\"], \"exclude\": [\"packages/api/**\"] }",
  tags:  ["loop::ui-verify-lessons", "kind::config"],
  source_agent: "aw-setup"
}
```

Re-run behaviour: read the existing record first (`memory.read` same scope+key)
and show a diff before overwriting, exactly like the aw-target write. Never store
a path that reveals a secret — a directory layout is not sensitive; a token
embedded in a path would be.

Log:

```markdown
- [TIMESTAMP] aw-setup: UI surface recorded (repo::{owner}/{repo}) — {summary}
- [TIMESTAMP] aw-setup: UI surface unchanged — defaults fit this repo
- [TIMESTAMP] aw-setup: memory.* not connected — UI surface not recorded
```

### Phase G — Confirm the preview auth flow and record its shape (optional, one LoreKit record)

This phase runs **only** when Phase B/D configured a gated preview — an
`auth.strategy` of `bypass-header` or `storage-state` on the `preview` aw-target.
It does the one thing a scaffold cannot: **prove the login actually
authenticates**, then record the confirmed shape so the runner, the author, and
the next teammate never rediscover it. The full flow (the two walls, the CI
env-var path, `authed_check`) is [`ui-verify/rules/preview-auth.md`](../../../testing/ui-verify/rules/preview-auth.md).

Skip it and log one line when it does not apply:

- Preview auth is `none` / `manual` → `aw-setup: preview auth is <strategy> — nothing to confirm`.
- `memory.*` not connected → `aw-setup: memory.* not connected — auth profile not recorded`.
- The required credential env vars (`refresh.env`) are **not** set in this shell →
  do **not** prompt for them and do **not** read them from a file. Scaffold the
  record with `confirmed_at_setup: false` and log
  `aw-setup: auth env vars absent — profile scaffolded unconfirmed (set <names> and re-run)`.

**Never accept a password pasted into the session, and never read a credential
from a tracked file.** Credentials come from the environment only; this phase
reads their *names*, never their values.

**Step 1 — establish `authed_check`.** Ask the user for a locator that is present
**only when signed in** (an account menu, an avatar, a sign-out control), in the
spec locator grammar: `{role: "button", name: "Account menu"}`. If the app has no
such stable element, record `authed_check: null` and note that the run will fall
back to the URL-not-login signal.

**Step 2 — exercise the login once.** With the env vars present, run the repo's
`refresh.command` (the non-interactive `refresh-auth.mjs`), then load the preview
and confirm `authed_check` is visible:

| Result | `confirmed_at_setup` | Action |
| --- | --- | --- |
| `refresh.command` wrote the state **and** `authed_check` is visible | `true` | The flow works end-to-end. Record it. |
| Login ran but `authed_check` never appeared | `false` | The selector or the login is wrong. Show the diagnostic; offer to loop back to Step 1 or Phase B. |
| `refresh.command` failed (missing env, Google-SSO block) | `false` | Report the failure verbatim; record the scaffolded shape so a later run can retry. |

**Step 3 — record the auth profile.** The committed `preview.yml` written in
Phase D stays the source of truth the tools execute; this record is a
**discovery index** so an agent knows the shape (walls, `authed_check`,
`confirmed_at_setup`) without reopening the YAML — see
[`ui-verify/rules/memory.md § The auth profile record`](../../../testing/ui-verify/rules/memory.md#the-auth-profile-record)
for the authority rule. Write it exactly as that section defines — scope
`repo::{owner}/{repo}`, key `ui-verify-lessons::auth-profile`, tags
`loop::ui-verify-lessons` + `kind::config`, body the auth JSON of **names and
selectors only, never a secret value**:

```text
memory.write {
  scope: "repo::{owner}/{repo}",
  key:   "ui-verify-lessons::auth-profile",
  value: "{ \"walls\": [\"bypass-header\", \"app-login\"], \"strategy\": \"storage-state\", \"authed_check\": \"{role: \\\"button\\\", name: \\\"Account menu\\\"}\", \"storage_state\": \".browser/auth-state.preview.json\", \"refresh_command\": \"node .claude/aw-targets/refresh-auth.mjs\", \"env\": [\"PREVIEW_USER\", \"PREVIEW_PASSWORD\", \"VERCEL_AUTOMATION_BYPASS_SECRET\"], \"confirmed_at_setup\": true, \"notes\": \"Clerk email-password test account; Vercel protection bypass on the outer wall\" }",
  tags:  ["loop::ui-verify-lessons", "kind::config"],
  source_agent: "aw-setup"
}
```

Re-run behaviour: read the existing record first (`memory.read` same scope+key)
and show a diff before overwriting, exactly like the aw-target and UI-surface
writes. Never store a credential value, a token, or a captured `storageState` in
this record — only the *path* to the gitignored state and the env-var *names*.

Log:

```markdown
- [TIMESTAMP] aw-setup: auth profile recorded, confirmed (repo::{owner}/{repo}) — {walls}
- [TIMESTAMP] aw-setup: auth profile recorded, UNCONFIRMED (env vars absent / login unverified)
- [TIMESTAMP] aw-setup: preview auth is none — nothing to confirm
- [TIMESTAMP] aw-setup: memory.* not connected — auth profile not recorded
```

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

> When the repo already has an auth convention (see
> [Reuse before you scaffold](#reuse-before-you-scaffold)), these paths follow it
> instead of the defaults shown — e.g. `.browser/auth-state.json` for the storage
> state and `.claude/aw-targets/scripts/refresh-auth.mjs` for the script.

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
- [ ] The auth storage-state file exists (or `auth.strategy: manual` is set).
- [ ] The auth directory in use is in `.gitignore` — the reused convention's dir
      (e.g. `.browser/`) or the `.auth/` default. If strategy (b), `.env.local`
      (or whichever file holds `E2E_PASSWORD`) is also in `.gitignore`.
- [ ] Smoke spec returned `green` (or `inconclusive` for `manual` auth strategy).
- [ ] UI surface recorded to LoreKit (or skipped with a logged line when
      `memory.*` is not connected, or left unchanged when defaults fit).
- [ ] User told what to do next:
  - "Run an autonomous task that touches UI — the executor's Phase 4 will
    now run `aw-tester` automatically."
  - "Re-run `/aw-setup` when auth expires or fixtures change."
  - For strategy (b): "If the login form changes, edit the `CUSTOMIZE` block
    in `scripts/auth-bootstrap-credentials.mjs`. The locator ladder is
    role/label-based so it tolerates most CSS / DOM changes."
