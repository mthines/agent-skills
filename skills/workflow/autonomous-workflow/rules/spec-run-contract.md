---
title: Spec-run contract — the engine-agnostic contract both runners implement
impact: HIGH
tags:
  - aw-tester
  - aw-tester-chrome
  - spec-run
  - contract
---

# Spec-run contract

One spec grammar. One verdict. Two runners.

A UI spec is written once in `aw-tester`'s grammar and can be executed by either
of two runners. This document is the **engine-agnostic contract** they share: the
locator ladder, the verdict schema, the auth-strategy semantics, and the
spec-parsing rules. A runner owns only how it drives a browser; everything a
caller depends on lives here.

| Runner | Engine | Where it runs | Sees between steps? | Best for |
| --- | --- | --- | --- | --- |
| [`aw-tester`](../templates/aw-tester.agent.md) | Playwright | sub-agent (isolated) | No — batch-compiled script | CI, remote envs, the executor's Phase 4 hot loop |
| [`aw-tester-chrome`](../aw-tester-chrome/SKILL.md) | claude-in-chrome extension | the current session | Yes — navigate → read → act → assert | fast local runs, an already-logged-in Chrome |

Both read the same `specs.md` and `aw-target.yml`, walk the same locator ladder,
and emit the same verdict block. A caller picks a runner; the contract does not
change with the choice.

> [!IMPORTANT]
> This file is the source of truth for the four sections below. Each runner
> restates them in engine terms for self-containment. When you change the verdict
> schema, the locator ladder, the auth semantics, or the spec-parsing rules, edit
> them **here first**, then mirror into both runners. Do not fork them per runner.

## The grammar is not here

The spec grammar itself — `WHEN/THEN/AND`, the `{role/name}` locator mini-grammar,
`url:`, `preconditions:`, `continues-from:`, `network:` — is owned by
[`specs.md.template`](../templates/specs.md.template) and is the single source of
truth for how a spec is written. Both runners parse exactly that grammar. Neither
runner, nor any caller, invents syntax it does not define.

## 1. Spec parsing

Parse each `## Spec N:` block into: title, `persist` level, `url` (resolve
`{placeholder}` against `fixtures.references`), `preconditions` (log; do not
re-check what auth or seed already guarantees), the ordered `flow` steps
(`WHEN` = action, `THEN`/`AND` = assertion), and `continues-from`.

**`continues-from` semantics** are identical for both runners: the prior spec's
page, cookies, and local storage are the starting state for this spec. The prior
spec must have passed in this same invocation. If it failed or was skipped, skip
this spec too with reason `continues-from: Spec N — prior spec did not pass`. A
runner that starts a fresh context per spec (`reset_between_specs: true`) cannot
honor `continues-from` — skip the chained spec and say so.

## 2. Locator ladder

Resolve every locator by walking this ladder in order. Never skip a rung, never
step below it:

1. **Role + accessible name** — `getByRole(role, { name })` / the accessibility
   tree. Preferred.
2. **User-facing strings** — `getByLabel` / `getByPlaceholder` / `getByText`.
3. **Test id** — `getByTestId`. Escape hatch only.
4. **Never** CSS selectors, `nth-child`, or XPath.

Each runner maps these rungs to its engine: Playwright calls the `getBy*` methods
directly; the Chrome runner reads the accessibility tree and matches by role and
name, then by visible text, then by `data-testid`. The rungs and their order do
not change.

**Healing.** When a locator does not resolve, apply a matching fast-tier lesson
first (loaded at start from `aw-tester-lessons`), then retry one rung looser
(role with `exact: false`, then partial text) — never drop to CSS. Record a
healing that worked in the run's working notes and in the verdict `notes` field.
Do not write it to cross-run memory mid-run; the caller writes lessons after
reading the verdict.

## 3. Auth-strategy semantics

The `aw-target.yml` `auth.strategy` means the same thing to both runners; only the
mechanism differs.

| Strategy | Meaning | Playwright mechanism | Chrome mechanism |
| --- | --- | --- | --- |
| `storage-state` | Start authenticated from a captured session | `storageState` option | Reuse the live logged-in Chrome; refresh only if a login screen appears |
| `none` | No auth; public or pre-authed target | skip auth setup | skip auth setup |
| `manual` | Automated login impossible (SSO, hardware MFA, CAPTCHA) | skip authed specs, log the skip | skip authed specs, log the skip |
| `env-credentials` | Legacy alias for `storage-state` + credentials bootstrap | headless login, ephemeral state | prefer the live session; else run the refresh command |

For `storage-state`, when the session is missing or a first authed page returns
HTTP 401, run `auth.refresh.command` with its `timeout_seconds`, retry the spec
once, and if it still 401s mark the spec `skipped` with reason
`auth-refresh-failed` rather than failing the whole run. **Never** put a
credential in the spec, the target file, or a lesson — auth lives in the refresh
command or the environment.

## 4. Verdict schema (MANDATORY — do not deviate)

Every runner's terminal deliverable is this exact YAML block and nothing after it:

```yaml
verdict: green | red | inconclusive
specs:
  - id: Spec-1
    title: <one-line from spec header>
    result: pass | fail | skipped
    reason: <one-line on fail or skipped; omit on pass>
    diagnostics: |
      <only on fail; hard cap 30 lines>
      failing step: WHEN {role: "button", name: "X"} is clicked
      locator: getByRole('button', { name: 'X' }) — not found after 5000ms
      attempted healing: getByText('X') — found 0 elements
      last network response: POST /api/foo → 500 {"error":"db timeout"}
      console errors: TypeError: Cannot read property 'id' of undefined (app.js:142)
notes: <optional one-paragraph context; omit if nothing notable>
```

A runner may add engine-specific keys **after** the shared keys — `aw-tester`
appends a `hot_loop:` block for the executor's Playwright re-run; a caller that
does not use them ignores them. The shared keys above never change shape.

**Hard rules for the verdict block:**

- `verdict: green` only when ALL specs are `pass`.
- `verdict: red` when ANY spec is `fail`.
- `verdict: inconclusive` when all non-skipped specs pass but some were skipped
  (manual auth, bail from a prior failure, auth-refresh-failed).
- `diagnostics` appears ONLY on `result: fail` specs, hard-capped at 30 lines,
  truncated with `... (truncated)` past that.
- `reason` is a single line. No multi-line reasons.
- No silent skips. Every skipped spec has a `reason`.

## 5. The lessons loop

Both runners read `aw-tester-lessons` at start and write to it at end, per the
[self-improvement loop](./self-improvement-loop.md) and the mechanics in each
runner. A locator healing, an auth refresh, an `inconclusive` verdict, or a new
failure pattern is worth a lesson; a clean pass is not. Lessons are advisory —
they bias healing, never change the verdict schema or silently skip a spec.
