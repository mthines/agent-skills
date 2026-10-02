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

Two spec formats. One verdict. Two runners.

A UI spec is written once — in `aw-tester`'s WHEN/THEN grammar, or as a Markdown
**intent spec** — and can be executed by either of two runners. This document is
the **engine-agnostic contract** they share: the locator ladder, the verdict
schema, the auth-strategy semantics, the spec-parsing rules, and how an intent
spec is executed and graded (§ 6). A runner owns only how it drives a browser;
everything a caller depends on lives here.

| Runner | Engine | Where it runs | Sees between steps? | Best for |
| --- | --- | --- | --- | --- |
| [`aw-tester`](../templates/aw-tester.agent.md) | Playwright | sub-agent (isolated) | No — batch-compiled script | CI, remote envs, the executor's Phase 4 hot loop |
| [`aw-tester-chrome`](../aw-tester-chrome/SKILL.md) | claude-in-chrome extension | the current session | Yes — navigate → read → act → assert | fast local runs, an already-logged-in Chrome |

Both read the same `specs.md` and `aw-target.yml`, walk the same locator ladder,
and emit the same verdict block. A caller picks a runner; the contract does not
change with the choice.

> [!IMPORTANT]
> This file is the source of truth for the sections below. Each runner
> restates them in engine terms for self-containment. When you change the verdict
> schema, the locator ladder, the auth semantics, the spec-parsing rules, or the
> intent-spec execution rules, edit them **here first**, then mirror into both
> runners. Do not fork them per runner.

## The formats are not here

Two formats exist, each with one owner, and this file defines neither's syntax:

| Format | Header line | Owner (single source of truth) | Written by |
| --- | --- | --- | --- |
| **Grammar** — `WHEN/THEN/AND`, the `{role/name}` locator mini-grammar, `url:`, `preconditions:`, `continues-from:`, `network:` | none (the default) | [`specs.md.template`](../templates/specs.md.template) | the aw planner (`specs.md`), and the compiled route of an intent spec (§ 6.6) |
| **Intent** — `**Changed:**`, `**Start:**`, `**Steps:**` with `[must-follow]` steps, `**Expected:**` | `Format: intent` | [`intent-spec.md.template`](../templates/intent-spec.md.template) | `ui-verify author`, and any human |

Both runners parse both formats exactly as their owner defines them.
Neither runner, nor any caller, invents syntax its owner does not define.

## 1. Spec parsing

**Detect the format first.** A spec file whose header (the lines before the first
`## Spec N:` heading) carries the line `Format: intent` is an intent spec — parse
it per § 6.1 and execute it per § 6. Every other file is a grammar spec, parsed as
follows.

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

An **intent spec**'s entries carry the shared keys above plus the shared
intent keys of § 6.7 (`format`, `route`, `changed`, `changed_evidence`,
`expected`, `deviations`), appended after `diagnostics`.
A grammar spec's entries carry none of them.

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
For an intent spec, a route heal (§ 6.6) and a locator that needed a detour to
resolve are worth an `aw-tester-lessons` entry; a guidance-step deviation the
spec's author could have avoided is the caller's lesson (`ui-verify-lessons`),
not the runner's.

## 6. Intent specs

An intent spec says what the user does and what must be true afterwards.
The runner works out the clicks against the live app, the way Playwright's planner → generator → healer loop does, under one rule: **the route is flexible, the outcome is not.**
Plain steps are guidance the runner may adapt; `[must-follow]` steps and every `**Expected:**` item are checked strictly, with evidence.
Why this shape: [`intent-specs-rationale.md`](../references/intent-specs-rationale.md).

### 6.1 Parsing

Parse each `## Spec N:` block of a `Format: intent` file into:

| Field | Source | Required |
| --- | --- | --- |
| `id` | `Spec-N` from the heading — the same id a grammar spec gets | yes |
| `title` | the heading text after `## Spec N:` | yes |
| `changed` | the `**Changed:**` line | yes |
| `start` | the `**Start:**` path; resolve `{placeholder}` against `fixtures.references` | yes |
| `preconditions` | the `**Preconditions:**` bullets | no |
| `steps` | the `**Steps:**` numbered list, in order; a step whose text starts with `[must-follow]` is must-follow | yes, with at least one must-follow step |
| `expected` | the `**Expected:**` bullets, in order, numbered `E1`, `E2`, …; a bullet matching `` `METHOD /path` returns NNN `` is a network item | yes, at least one |
| `hints` | the `**Hints:**` bullets | no |
| `out_of_scope` | the `**Out of scope:**` bullets | no |

A spec missing a required field, or with no `[must-follow]` step, is never guessed at.
Mark it `skipped` with reason `malformed intent spec: <missing field>` and run the rest.

### 6.2 Execution — explore the route

Run this for a spec with no usable route-cache entry (§ 6.6):

1. Navigate to `start`, absolute against `base_url`.
2. For each step, in order, resolve its target on the live page by the [locator ladder](#2-locator-ladder), trying any `hints` locator first.
   A locator must resolve to exactly one element.
   When it matches several, name the instance — a role and name, or scope it within a container — and never take the first match.
3. **A plain step is guidance.**
   Perform it as written when you can.
   When you cannot, reach the state it intends another way, with at most **3 detour actions** for that step, and record a deviation (`adapted`).
   An action the page needs that no step names — dismissing a banner, expanding a closed section — is a deviation `added`.
   A step whose intended state already holds is a deviation `skipped`.
4. **A `[must-follow]` step is performed exactly as written** — the named action on the named target, with no detour.
   When its target is missing or the action cannot be performed, stop the spec: it fails with reason `must-follow step <n>: <what was missing>`, unless § 6.4 applies.
5. **Detours never mutate.**
   A detour or `added` action may navigate, open, expand, close, dismiss, scroll, or focus.
   It never submits, saves, creates, deletes, or sends unless that action is the step's own wording.
6. After the last step, judge every `expected` item against the current page, and each network item against the requests recorded since `start` loaded.
   Grade each one `observed`, `not-observed`, or `unreachable`, with evidence (§ 6.3).
7. Record whether the run interacted with or observed the `changed` target: `changed: exercised` with the evidence line that shows it, else `changed: not-exercised`.

**Budget.** At most **25 actions per spec**, detours and `added` actions included.
When the budget runs out, stop: the remaining items are `unreachable` with cause `explore budget exhausted` (§ 6.4).

**Mutations run once.**
A step that saves, submits, creates, deletes, sends, or changes a persisted setting — a toggle, a star, an auto-saving select — is a *mutating step*; when the wording or the control leaves it unclear, treat it as mutating until it is performed.
A control that only opens a confirmation, menu, or dialog is not the mutation — the confirming control is.
Performing a step settles it: a step that fired a `POST`, `PUT`, `PATCH`, or `DELETE` was a mutation; one that fired none and only opened a dialog, menu, or popover was not, and may be replayed.
Perform each mutating step exactly once per exploration.
A runner that explores by re-launching from `start` replays only the non-mutating steps since the last mutation it performed, never a mutation it already performed.

The ladder's never-rung holds here too: never a CSS selector, `nth-child`, or XPath, in exploration or in a compiled route.
Never type a credential, and never navigate off the `base_url` origin.

### 6.3 Evidence

An `observed` item carries at least one evidence line in one of these forms:

| Form | Example |
| --- | --- |
| `locator: <single-braces locator> — <state>` | `locator: {role: "heading", name: "Q3 revenue"} — visible` |
| `network: METHOD /path → NNN` | `network: PATCH /api/dashboards/d-42 → 200` |
| `text: "<excerpt ≤ 200 chars>" in <single-braces locator>` | `text: "Saved 2 seconds ago" in {role: "status"}` |
| `capture: <path> — <what the image shows>` | `capture: .agent/feat-x/.aw-tester/captures/spec-1-auto-final.png — the title no longer overlaps the toolbar at 320 px` |

The `capture:` form alone is evidence **only** for an item about visual layout — overflow, overlap, alignment, clipping.
Every other item needs a `locator:`, `network:`, or `text:` line.

An item graded `observed` without admissible evidence is graded `not-observed`.
Evidence must sit on the `changed` target or its direct effect: an outcome observed on a different instance — another row, the nav entry with the same name, a step other than the one the diff touches — is `not-observed`.

```yaml
# ✅ RIGHT — names the instance the change touches
- id: E1
  result: observed
  evidence: 'text: "1,402 px" in {role: "region", name: "List all services in catalog"}'

# ❌ WRONG — the first tool step, not the one whose output the diff changed
- id: E1
  result: observed
  evidence: 'locator: {testid: "agent_activity.tool_step"} — visible'
```

### 6.4 Unreachable — the closed list

An `expected` item or a `[must-follow]` step is `unreachable` only for one of these causes, named in the spec's `reason`:

1. **auth** — the session could not be established (`auth-refresh-failed`, or a login screen on the Chrome driver).
2. **feature flag** — a flag the `preconditions` name is off on the target.
3. **seed data** — a record the `preconditions` name does not exist, and no step creates it.
4. **environment** — the target origin is unreachable, or an endpoint the change does not touch returned a 5xx.
5. **budget** — `explore budget exhausted` (§ 6.2), or `transient state lost`: a step after a performed mutation acts on UI the mutation left open — a toast's action, a success dialog — which a runner that re-launches cannot reach again without repeating the mutation.

Every other reason the runner could not observe an item is `not-observed`, and fails the spec.

### 6.5 Grading

Grade each intent spec by the first row that matches:

| # | Condition | `result` | `reason` |
| --- | --- | --- | --- |
| 1 | a `[must-follow]` step was missing or not performed as written, for a cause outside § 6.4 | `fail` | `must-follow step <n>: <what happened>` |
| 2 | an `expected` item is `not-observed` | `fail` | `E<n> not observed: <what was seen instead>` |
| 3 | an item or must-follow step is `unreachable` | `skipped` | `unreachable: <cause>` |
| 4 | `changed: not-exercised` | `fail` | `changed target not exercised: <changed>` |
| 5 | otherwise | `pass` | — |

A § 6.4 cause therefore grades `skipped` even when it stopped the run before the `[must-follow]` step or the `**Changed:**` target, while a real non-observation still fails whatever else was unreachable.
Deviations on plain steps never fail a spec; they are listed so a reviewer can see the route differed from the written steps.
The run-level `verdict` follows § 4 unchanged.

### 6.6 Route cache — replay first, heal on failure

The route a passing exploration took is compiled and cached, so the next run replays it instead of exploring again.

**Compile on pass.**
When a spec passes by exploration, write its route as one `## Spec N:` block in the grammar of [`specs.md.template`](../templates/specs.md.template): a `url:` of `start`, one `WHEN` per action performed (detours included, each with the locator that resolved), and one `THEN` per `expected` item whose evidence was a `locator:` or `network:` line.
List the items judged by `text:` or `capture:` evidence on an `# uncompiled:` line.
Write `url:` and `network:` paths with the spec's own `{placeholder}`s, never their resolved values.
When an action's locator had to be scoped to a container to match one element, or the route navigated by URL after `start` (a `goto` detour), do not cache the route: the grammar has no scoping form and no mid-flow navigation step, and an unscoped locator could replay against the wrong instance.
That spec explores on every run; say so in `notes`.
Write it to `.agent/{branch}/.aw-tester/routes/<spec-id>-<sha8>.md`, where `<sha8>` is the first 8 hex characters of the SHA-256 of the spec's block text — from its `## Spec N:` line through the line before the next `## ` heading, trailing blank lines removed:

```bash
# Spec 1's key; replace both 1s for Spec N.
awk '/^## Spec 1:/{f=1;print;next} f&&/^## /{exit} f' "$SPECS" \
  | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' \
  | { command -v sha256sum >/dev/null && sha256sum || shasum -a 256; } | cut -c1-8
```

Start the file with these comment lines:

```text
# route-for: Spec-1
# source-sha: 3fa9c2e1
# deviations: step 1 added — dismissed the cookie banner
# uncompiled: E3
```

**Replay.**
On the next run, when a route file with the spec's current `<sha8>` exists, run its block through the grammar path (§ 1, § 2), then judge each `# uncompiled:` item by observation as § 6.2 step 6 does.
Every assertion passes → the spec passes with `route: replayed` and the route file's `deviations` copied into the verdict.

**Heal.**
A replay that fails is not yet a fail.
Explore the spec once from its Markdown (§ 6.2), grade it (§ 6.5), and report that grade with `route: healed`; on a pass, overwrite the route file.
Heal at most once per spec per run.

Rules that keep the cache honest:

- **The Markdown spec is the source of truth; the route is a speed path.** Healing may change the route, never an `expected` item and never a `[must-follow]` step.
- **A changed spec is a cache miss.** Its block text changes, so `<sha8>` changes, and the old file is never read.
- **Never edit a route file by hand.** Delete it to force exploration.
- **The cache is local.** It lives in the gitignored `.agent/` of one worktree; a fresh checkout or sandbox starts empty and explores.

### 6.7 Verdict keys

Each intent spec's entry in the § 4 verdict carries these keys after its shared keys:

```yaml
  - id: Spec-1
    title: A user renames a dashboard from its header
    result: pass
    format: intent
    route: explored | replayed | healed
    changed: exercised | not-exercised
    changed_evidence: 'locator: {role: "button", name: "Rename"} — clicked'
    expected:
      - id: E1
        result: observed | not-observed | unreachable
        evidence: 'locator: {role: "heading", name: "Q3 revenue"} — visible'
      - id: E2
        result: observed
        evidence: 'network: PATCH /api/dashboards/d-42 → 200'
    deviations:                  # omit the key when there are none
      - step: 1
        kind: adapted | added | skipped
        note: dismissed the cookie banner before opening the dashboard
```

- `expected` lists every item, in spec order, by its `E<n>` id.
- `evidence` is required on every item: the § 6.3 line on `observed`, what was seen instead on `not-observed`, and the § 6.4 cause on `unreachable`.
- `deviations` lists plain steps only; a `[must-follow]` deviation is a fail and is stated in `reason` and `diagnostics`.
- A spec that stopped before step 6 lists every item it never reached as `unreachable` (§ 6.4 cause) or `not-observed` (a must-follow fail) — never omits it.
