---
name: aw-setup
description: >
  Scaffolds and validates the aw-tester target `.claude/aw-targets/<target>.yml` — detects auth,
  captures storage state, smoke-tests it, and records the repo's UI surface and preview auth profile;
  re-runs re-prompt only for what broke. `--target local` (default) or `--target preview` (what
  `/ui-verify setup` delegates to); triggers on "/aw-setup", "setup aw-tester", "scaffold aw-target".
disable-model-invocation: false
argument-hint: '[--target local|preview]'
license: MIT
metadata:
  author: mthines
  version: '2.0.0'
  workflow_type: slash-command
  tags:
    - aw-tester
    - aw-target
    - auth
    - setup
    - autonomous-workflow
---

# aw-setup — Aw-Target Scaffolding for aw-tester

Interactive, idempotent setup that writes the `.claude/aw-targets/` file `aw-tester` needs to run specs.
Without it, `aw-tester` cannot run and the executor's Phase 4 spec verification skips.

## Contents

- [When to run](#when-to-run)
- [Idempotency contract](#idempotency-contract)
- [Target selection](#target-selection)
- [Phases](#phases)
- [Files written](#files-written)
- [Definition of done](#definition-of-done)

## When to run

| Situation | Action |
| --- | --- |
| First autonomous task that touches UI | Run once |
| `aw-tester` reports `auth-refresh-failed`, the base URL moved, or fixtures changed | Re-run |
| Planner finds no aw-target | The planner suggests `/aw-setup`; the user runs it — never auto-triggered |

## Idempotency contract

First run: Phases A–E (plus F, and G for a gated preview).
Re-run on an existing `.claude/aw-targets/{target}.yml`:

1. Validate each field: storage state exists and is fresh; the seed command resolves; references point to env vars that exist; the smoke spec passes.
2. Prompt only for fields that failed, and state which fields passed.
3. Show a unified diff before overwriting any aw-target field.
4. Never silently overwrite the auth storage-state file (`.auth/*.json`, or the repo's convention such as `.browser/auth-state*.json`).

## Target selection

| `--target` | File | `base_url` | Consumed by | Phase E smoke |
| --- | --- | --- | --- | --- |
| `local` (default) | `.claude/aw-targets/local.yml` | a localhost URL from Phase A | autonomous-workflow Phase 4 | runs against localhost |
| `preview` | `.claude/aw-targets/preview.yml` | `RESOLVED_AT_RUNTIME` | `ui-verify run` / `verify` | skipped — Phase G validates |

Both files may coexist and are committed (no secrets).
Preview deltas per phase: [`rules/preview-target.md`](rules/preview-target.md) — read when `--target preview`.

## Phases

### Phase A — Detect

| Signal | Where to look |
| --- | --- |
| Base URL | `next.config.*`, `vite.config.*`, `package.json` dev port, `.env`, `.env.local` |
| Auth strategy | `next-auth` / `auth.js` imports, `/api/auth` routes, OAuth config |
| Test backdoors | Dev-only cookies (`__e2e_token`), `E2E_AUTH_TOKEN`, seed scripts |
| Fixtures / seed | `db:seed`, `db:reset`, `seed:aw`, `test:setup` scripts |
| Existing aw-target | `.claude/aw-targets/*.yml` (re-run path) |
| Existing auth convention | See [Reuse before you scaffold](#reuse-before-you-scaffold) |

Confidence: **High** — base URL in env, auth clear, seed script named. **Medium** — base URL guessed from a port, auth inferred. **Low** — nothing found; ask every question in Phase B.

#### Reuse before you scaffold

`.auth/<name>.json` + `scripts/auth-bootstrap-*.mjs` is the fallback scaffold, not a mandate: a second auth location drifts from the one the repo maintains.
Probe in order and stop at the first hit:

1. An existing `.claude/aw-targets/*.yml` that sets `auth.storage_state` — reuse its `storage_state` and `refresh.command` verbatim.
2. A captured storage-state file: `.browser/auth-state*.json`, else `.auth/*.json`.
3. A login script: `.claude/aw-targets/scripts/refresh-auth*.mjs` or `.browser/refresh-auth*.mjs`, else `scripts/auth-bootstrap-*.mjs`.

On a hit, substitute its paths everywhere below (probe, write, gitignore guard, file table) and match its gitignore entry; scaffold `.auth/` only when nothing is found.

### Phase B — Ask

One batched `AskUserQuestion`; 3–4 questions when detection is High, more only when it is not or a re-run found broken fields.

1. Base URL for local development (e.g. `http://localhost:3000`).
2. How aw-tester gets an authenticated session:

   | # | Strategy | Pick when | aw-setup writes |
   | --- | --- | --- | --- |
   | a | Interactive headful capture (default) | Any login you can do by hand once — SSO, OAuth, passwordless | `scripts/auth-bootstrap-headful.mjs` + `auth.refresh.command` |
   | b | Automated credentials (env vars) | Plain email + password form, no MFA or CAPTCHA, unattended re-auth | `scripts/auth-bootstrap-credentials.mjs` + `auth.refresh.command` |
   | c | Existing bootstrap command | The repo already has a login script | aw-target referencing it |
   | d | None | Public or pre-authed target | `auth.strategy: none` |
   | e | Manual | Hardware MFA, mandatory CAPTCHA, SSO without a test mode | `auth.strategy: manual` — aw-tester skips authed specs |

   Script details for (a) and (b): [`rules/auth-flow-templates.md`](rules/auth-flow-templates.md) — read when the user picks (a) or (b).
3. Test user email and role (used in the smoke spec and as the `E2E_EMAIL` default).
4. Seed command for fixtures (e.g. `pnpm run db:seed:aw`).

For strategy (e), warn: `Auth strategy set to "manual". aw-tester will skip authed specs and mark them "skipped" with reason "auth.strategy: manual". Add a test-mode login backdoor and re-run /aw-setup to enable them.`

### Phase C — Probe

Run the chosen flow once; `<storage_state path>` is `.auth/local.json` unless a reused convention names another.

| Strategy | Probe command | Expected |
| --- | --- | --- |
| (a) | `AUTH_LOGIN_URL=... AUTH_STORAGE_STATE=<storage_state path> node scripts/auth-bootstrap-headful.mjs` | The user logs in; the state is written on close or on `AUTH_POST_LOGIN_URL_PATTERN` |
| (b) | `AUTH_LOGIN_URL=... AUTH_STORAGE_STATE=<storage_state path> AUTH_POST_LOGIN_URL_PATTERN='/dashboard' E2E_EMAIL=... E2E_PASSWORD=... node scripts/auth-bootstrap-credentials.mjs` | Headless; state written, or a non-zero exit naming the failing locator |
| (c) | `timeout 30 <user command>` | The command writes `<storage_state path>` |
| (d), (e) | skip | — |

For (a)–(c): confirm the state file was written, load `base_url + /` and confirm HTTP 200 with a non-error title, and on failure report it and return to Phase B.

### Phase D — Write

```bash
mkdir -p .claude/aw-targets scripts
# write .claude/aw-targets/local.yml from templates/aw-target.yml.template
# (a): copy templates/auth-bootstrap-headful.template.mjs     → scripts/auth-bootstrap-headful.mjs
# (b): copy templates/auth-bootstrap-credentials.template.mjs → scripts/auth-bootstrap-credentials.mjs
AUTH_DIR="$(dirname "${AUTH_STORAGE_STATE:-.auth/local.json}")/"   # .browser/ when a convention was reused
grep -q "^${AUTH_DIR}" .gitignore 2>/dev/null || echo "${AUTH_DIR}" >> .gitignore
```

1. Show the full YAML and any script before writing; for (b), point at the `CUSTOMIZE` block and confirm the user reviewed the locators.
2. On a re-run show a unified diff and require confirmation; an empty diff → "No changes needed — aw-target is up to date."
3. If a storage-state file already exists, ask "Overwrite existing auth state at `<storage_state path>`?" before replacing it.

### Phase E — Smoke-test

Dispatch `aw-tester` with one spec:

```text
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
| --- | --- |
| `green` | Done |
| `red` | Show the diagnostics; return to Phase B with the specific failure |
| `inconclusive` | Expected for `manual` auth; the target is written, authed specs will skip |

### Phase F — Learn the repo's UI surface (optional, one LoreKit record)

Record what this repo counts as UI for the `is-ui-diff` gate: [`rules/lorekit-records.md`](rules/lorekit-records.md) — read after Phase D.

### Phase G — Confirm the preview auth flow and record its shape (optional, one LoreKit record)

For a gated `preview` target, prove the login authenticates and record the auth profile: [`rules/lorekit-records.md`](rules/lorekit-records.md) — read when `--target preview` set `auth.strategy` to `bypass-header` or `storage-state`.

## Files written

| File | Path | Committed? |
| --- | --- | --- |
| Aw-target | `.claude/aw-targets/<target>.yml` | Yes |
| Bootstrap script (a or b) | `scripts/auth-bootstrap-headful.mjs` / `scripts/auth-bootstrap-credentials.mjs` | Yes |
| Storage state | `.auth/<target>.json` (or the reused convention) | No — gitignored |
| Credentials (b) | `E2E_EMAIL` / `E2E_PASSWORD` in `.env.local` or a CI secret | No — gitignored |

aw-setup needs neither `playwright.config.ts` nor an installed `aw-tester`: it probes with the project's Playwright, falling back to `npx playwright@latest`.
Example transcripts: [`references/examples.md`](references/examples.md).

## Definition of done

- [ ] `.claude/aw-targets/<target>.yml` written and reviewed by the user.
- [ ] For (a) or (b): the bootstrap script written and reviewed (the `CUSTOMIZE` block for b).
- [ ] The storage-state file exists, or `auth.strategy` is `manual` / `none`.
- [ ] The auth directory in use (and, for b, the credentials file) is in `.gitignore`.
- [ ] The smoke spec returned `green` (`inconclusive` for manual auth), or, for `preview`, Phase G ran or logged its skip.
- [ ] The UI surface was recorded, left unchanged, or skipped with its log line.
- [ ] The user was told the next step: run an autonomous UI task (Phase 4 now runs `aw-tester`), and re-run `/aw-setup` when auth expires or fixtures change.
