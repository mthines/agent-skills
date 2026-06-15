---
name: aw-setup
description: >
  One-time (but safely re-runnable) setup flow that scaffolds a project's
  aw-tester aw-target: detects auth strategy, captures storage state, writes
  .claude/aw-targets/local.yml, and validates with a smoke spec. Re-runs detect
  the existing aw-target and only re-prompt for what broke or changed.
  Triggers on "/aw-setup", "setup aw-tester", "scaffold aw-target".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
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
2. How does auth work? Options:
   - Storage state (recommended) — provide a bootstrap command that captures login
   - Test backdoor — provide a dev token or test cookie name
   - None — no auth required
   - Manual — SSO/MFA/CAPTCHA prevents automation (aw-tester will skip authed specs)
3. What email/role should the test user have?
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

Run the proposed login flow once in a headless browser (or headed if the user
prefers) to validate that auth works:

```bash
# Example: run the bootstrap command with a timeout
timeout 30 pnpm run auth:bootstrap \
  && echo "bootstrap succeeded" \
  || echo "bootstrap failed"
```

Then:
1. Verify `.auth/local.json` was written.
2. Load one fixture URL (base_url + `/`) and confirm it renders (HTTP 200 and
   the page title is not an error page).
3. If the probe fails, report the error and loop back to Phase B.

### Phase D — Write

Write the aw-target file and ensure the auth file is gitignored.

**First run:**

```bash
mkdir -p .claude/aw-targets
# write .claude/aw-targets/local.yml from the template
```

Show the complete aw-target YAML to the user for review before writing.

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
| Auth storage state | `.auth/local.json` | No — gitignored |

The aw-target file is committed so teammates can see the aw-target configuration.
The auth storage state is gitignored — it contains session tokens.

---

## Compatibility notes

- **No dependency on `playwright.config.ts`** — aw-setup probes via `npx playwright@latest`.
- **No dependency on `aw-tester` being installed** — aw-setup brings its own probe.
- If `playwright` is already installed locally, aw-setup uses the local binary;
  otherwise it falls back to `npx playwright@latest`.

---

## Definition of done

- [ ] `.claude/aw-targets/local.yml` written and reviewed by the user.
- [ ] `.auth/local.json` exists (or `auth.strategy: manual` is set).
- [ ] `.auth/` is in `.gitignore`.
- [ ] Smoke spec returned `green` (or `inconclusive` for `manual` auth strategy).
- [ ] User told what to do next:
  - "Run an autonomous task that touches UI — the executor's Phase 4 will
    now run `aw-tester` automatically."
  - "Re-run `/aw-setup` when auth expires or fixtures change."
