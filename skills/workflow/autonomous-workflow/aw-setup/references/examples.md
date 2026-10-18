# aw-setup session examples

Illustrative transcripts; nothing here is a rule.

## First run (Next.js, existing bootstrap command)

```text
[A] Detecting project configuration...
    ✓ Base URL: http://localhost:3000 (from .env.local: NEXT_PUBLIC_URL)
    ✓ Auth: next-auth detected at /api/auth/[...nextauth]
    ? No test backdoor found. Will ask.
    ✓ Seed script: pnpm run db:seed:aw (from package.json)

[B] A few questions:
    1. Confirm base URL: http://localhost:3000 (detected) [enter to confirm]
    2. Auth strategy: I found next-auth. Do you have a bootstrap command that
       logs in and captures storage state? (e.g. `pnpm run auth:bootstrap`)
    3. Test user email + role?

    User: [confirmed base URL] [pnpm run auth:bootstrap] [test+aw@example.com, admin]

[C] Probing...
    Running: pnpm run auth:bootstrap (timeout: 30s)
    ✓ .auth/local.json written (12kb)
    Loading http://localhost:3000/ ... ✓ HTTP 200, title: "Dashboard"

[D] Writing aw-target:
    Creating .claude/aw-targets/local.yml ... [shows YAML preview]
    Adding .auth/ to .gitignore
    Confirm? [y/N] y
    ✓ .claude/aw-targets/local.yml written

[E] Smoke spec... verdict: green
    ✓ Aw-Target validated. aw-tester is ready.
```

## Re-run (storage state expired)

```text
[Re-run detected] .claude/aw-targets/local.yml exists.
Validating...
    ✓ base_url: http://localhost:3000 — reachable
    ✗ auth.storage_state: .auth/local.json — missing (deleted or expired)
    ✓ fixtures.seed: pnpm run db:seed:aw — script exists
[C] Re-running auth bootstrap... ✓ .auth/local.json written (12kb)
[D] No changes to aw-target.yml needed.
[E] Smoke spec... verdict: green
✓ Aw-Target re-validated.
```
