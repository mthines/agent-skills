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
(`WHEN` = action, `THEN`/`AND` = assertion, `CAPTURE` = documentation
screenshot), and `continues-from`. A `THEN`/`AND` assertion is one of three
forms: a `{locator}` assertion (resolved via the locator ladder), a `network:`
assertion, or a `semantic:` assertion (§ Semantic assertions below).

## Semantic assertions

A `THEN`/`AND` step of the form `semantic: <user-observable outcome>` asserts an
outcome a person looking at the screen could confirm, where an exact locator or
string match would be brittle:

```text
- WHEN {role: "button", name: "Place order"} is clicked
  THEN semantic: the user sees an order-confirmation number
```

Both runners resolve it identically, delegating the judgment to the
[`jev-assert`](../../../quality/jev-assert/SKILL.md) skill:

1. Capture the current page **text** state (accessibility tree preferred, then
   page text) — never a screenshot; a screenshot-only capture is not usable
   input.
2. Call `Skill("jev-assert")` with that state and the expectation.
3. Read its receipt's final `[receipt] verdict: <token>` line and map it to the
   step result (table in § 4).

The expectation must be a **user-observable outcome**, not a restatement of the
captured text — `jev-assert`'s provenance guard refuses a literal-string or
structural claim, and such a claim belongs in a `{text: …}` locator assertion,
which verifies it deterministically. When `jev-assert` is not installed or
`TYPESAFE_API_KEY` is unset, the step is `unobtainable` → the spec is
`inconclusive` (§ 4), never a silent pass.

**`CAPTURE` semantics** are identical for both runners. `CAPTURE "<label>"`
(optionally `... fullPage`) takes a screenshot of the current page state,
labelled for later use as documentation — a before/after, a rendered-state
artifact for the PR or the walkthrough. It is **neither an action nor an
assertion**: it never resolves a locator, never changes verdict, and a capture
that cannot be written is a `notes` line, never a `fail`. Write captures under
`.agent/{branch}/.aw-tester/captures/` named `<spec-id>-<slug-of-label>.png`
(`fullPage` sets the full-page flag), and list each one in the verdict's
`captures:` array (§ 4). Because a `CAPTURE` step cannot fail, it is exempt from
bail: an `--bail-on-first-red` run still records captures that ran before the
first red step.

### Auto-capture (a run option)

**Auto-capture** is a run-level option — the mode flag `--auto-capture`, **off
by default** at the runner level; a caller such as [`ui-verify run`](../../../testing/ui-verify/rules/runner.md)
turns it on so a run always yields screenshots for a PR description. When
enabled, the runner takes a **full-page** screenshot automatically — *in
addition to* any explicit `CAPTURE` steps — at exactly two points:

1. the **final rendered state of every spec** (after its last flow step, whether
   the spec passed or failed), named `<spec-id>-auto-final.png`; and
2. **after each `WHEN` action that navigated** (the URL changed or a full page
   load occurred), named `<spec-id>-auto-<seq>.png` (`seq` from `1`) —
   **deduped**: skip when the URL is unchanged since the last auto-capture, so
   several assertions reading one screen never reshoot it.

Auto-captures obey the same rules as `CAPTURE`: written under the same
`.agent/{branch}/.aw-tester/captures/` directory, listed in the verdict's
`captures:` array (each entry carries `auto: true`), never an action or an
assertion, exempt from bail, and a write failure is a `notes` line, never a
`fail`. They are **capped at 30 per run** (`AUTO_CAPTURE_CAP = 30`); on reaching
the cap the runner stops auto-capturing and records
`notes: auto-capture cap (30) reached — <N> further states not shot`.
Per-assertion capture is deliberately **not** a mode — consecutive assertions
read one visual state, so the two triggers above already cover every *distinct*
state a PR description needs; a spec that wants one specific intermediate frame
adds an explicit `CAPTURE` step.

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
captures:                       # omit the key entirely when no capture was written
  - spec: Spec-1                 # (no CAPTURE step ran AND auto-capture is off)
    label: hero after submit
    path: .agent/<branch>/.aw-tester/captures/spec-1-hero-after-submit.png
    full_page: false
  - spec: Spec-1                 # an auto-capture entry carries auto: true
    label: final state
    path: .agent/<branch>/.aw-tester/captures/spec-1-auto-final.png
    full_page: true
    auto: true
notes: <optional one-paragraph context; omit if nothing notable>
```

A runner may add engine-specific keys **after** the shared keys — `aw-tester`
appends a `hot_loop:` block for the executor's Playwright re-run; a caller that
does not use them ignores them. The shared keys above never change shape.

`captures:` is a shared optional key (both runners can screenshot). Omit it when
nothing was written — no `CAPTURE` step ran **and** auto-capture is off;
otherwise list one entry per capture with its `spec`, `label`, written `path`,
and `full_page` flag, plus `auto: true` on an auto-capture entry (§ Auto-capture).
A capture that failed to write is reported in `notes`, and its absence from
`captures:` is the only signal — it never appears as a failed spec.

**Semantic assertion results.** A `semantic:` assertion's `jev-assert` receipt
maps to the step result by its verdict token — the mapping is total, and
`ambiguous` / `unobtainable` never pass:

| `[receipt] verdict:` | Step result | Effect on the spec |
| -------------------- | ----------- | ------------------ |
| `confirms`           | pass        | contributes to `pass` like any assertion |
| `contradicts`        | fail        | fails the step; capture the Noul in `diagnostics` |
| `null`               | fail        | the state ran but did not support the outcome |
| `ambiguous`          | inconclusive | the spec is `skipped` with reason `semantic-ambiguous`, never a pass |
| `unobtainable`       | inconclusive | the spec is `skipped` with reason `semantic-unobtainable` (e.g. no `TYPESAFE_API_KEY`), never a pass |

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
