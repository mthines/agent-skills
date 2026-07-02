---
title: Surface Validation — Validate on Every Entry
impact: HIGH
tags:
  - surface
  - validation
  - staleness
---

# Surface Validation

## Contents

- [When to run](#when-to-run)
- [Validation steps](#validation-steps)
- [On stale or invalid surface](#on-stale-or-invalid-surface)
- [Skipping validation (not recommended)](#skipping-validation-not-recommended)

Every time the skill enters Phase 0 with an existing surface file, it validates
that the surface's commands still resolve.
A stale surface produces misleading "no failures found" results or broken single-test re-runs.

Validation runs fast — it checks whether binaries and scripts resolve, not
whether the tests actually pass.

## When to run

In Phase 0 of [`../SKILL.md`](../SKILL.md), immediately after loading the
surface file (or the `--surface` override file).

## Validation steps

### Step 1 — Parse the surface file

Load the YAML frontmatter:
- `project-key`
- `stack`
- `detect-command`
- `single-test-command`
- `failure-parser`
- `cache-bust-flag` (optional)

If the frontmatter is missing required fields, mark the surface invalid immediately.
Required fields: `project-key`, `stack`, `detect-command`, `single-test-command`, `failure-parser`.

### Step 2 — Check the detect-command binary

Extract the first word (the executable) from `detect-command` and verify it resolves:

```bash
which <executable>
```

Or for multi-word invocations (`pnpm exec vitest`, `npx jest`, `deno test`):
```bash
which <first-word>
```

A resolved binary is sufficient — do not run the full detect command during validation.

### Tool-version-manager edge case

If `which <executable>` fails but the project uses a tool-version manager
(`mise`, `asdf`, `nvm`, `volta`, `pyenv`), the binary is real but not on the
agent's PATH. Detect this case before treating the surface as stale:

| Signal in repo | Tool manager | Treat `which` miss as |
| --- | --- | --- |
| `.tool-versions` / `mise.toml` / `.mise.toml` | mise / asdf | **valid** (suggest `--skip-validation`) |
| `.nvmrc` | nvm | **valid** (suggest `--skip-validation`) |
| `package.json#volta` | volta | **valid** (suggest `--skip-validation`) |
| `.python-version` | pyenv | **valid** (suggest `--skip-validation`) |
| (none of the above) | — | **stale** (propose update diff) |

When the surface is treated as valid via this exemption, log:
`Surface validation: binary not on PATH, but <tool-manager> detected. Suggest --skip-validation for this project.`
Do not auto-add `--skip-validation` to the surface or the invocation — the user owns that choice.

### Step 3 — Check the single-test-command binary

Same check as Step 2 for the `single-test-command` executable.

### Step 4 — Check the project key matches

Recompute the project key for the current working directory per
[`project-keying.md`](./project-keying.md) and compare it to the `project-key`
field in the surface file.

If the keys differ:
- If `--surface <path>` was passed: the mismatch is intentional. Log a warning and continue.
- Otherwise: surface a mismatch warning and include it in the proposed update diff.

### Step 5 — Decide: valid or stale

| Check result | Surface state |
| --- | --- |
| All checks pass | **Valid** — continue to Phase 1 |
| Missing required field | **Invalid** — must update before continuing |
| Binary not found | **Stale** — propose update diff |
| Project key mismatch (no `--surface` flag) | **Stale** — propose update diff |

## On stale or invalid surface

1. Compute a diff showing only the affected fields.
2. Present it to the user:
   ```
   Surface validation failed: <reason>
   
   Proposed update to surfaces/<key>.md:
   ---
   <diff>
   ---
   
   Confirm with "yes" to update, or provide corrections.
   ```
3. **Ask once.** If the user declines, escalate — do not run with an invalid surface.
4. On approval, write the updated surface file and re-validate.

## Skipping validation (not recommended)

The user may pass `--skip-validation` to bypass surface validation.
This is not recommended — use it only when the validation check itself is failing
due to a PATH issue in the agent's shell environment (e.g., nvm not loaded).

When `--skip-validation` is passed, log:
```
Surface validation skipped (--skip-validation). Commands assumed valid.
```
