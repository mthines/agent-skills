---
title: The two-way memory loop — ui-verify-lessons + aw-tester-lessons
impact: HIGH
tags:
  - ui-verify
  - lorekit
  - lessons
  - self-improvement
  - two-way-loop
---

# The two-way memory loop

The point of this loop: what the **runner** learns about navigating the app becomes what the **author** knows before writing the next spec.
A spec that omitted a required step fails once; the runner records why; the next author reads that and writes the step in from the start.

Two buckets, split cleanly by concern.
The bucket taxonomy, the shared record schema, and the read/write shapes are owned by [`memory-buckets.md`](../../../../agents/shared/rules/memory-buckets.md) and [`write-pipeline.md § Lesson-scope entries`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries); this file states which bucket holds what and when this skill reads and writes.

| Bucket | Holds | Written by | Read by |
| --- | --- | --- | --- |
| **`ui-verify-lessons`** (new, `loop::ui-verify-lessons`) | Spec-quality and navigation knowledge — a required precondition, a route quirk, a preview-auth step. | the runner (this skill, `run`) | the author (this skill, `author`) |
| **`aw-tester-lessons`** (existing, `loop::aw-tester-lessons`) | Locator-healing and verification friction. | `aw-tester` | `aw-tester` at run start, **and the author at author time** (cross-bucket read) |

The cross-bucket read is the second half of the loop: locator friction `aw-tester` discovered informs which locators the author picks.
If `memory.*` is not connected, skip every step here silently and log one line: `ui-verify: memory.* not connected, continuing`.

## Read at author time

Before writing a spec (`author` Step 1), read both buckets narrow-to-broad — `repo::` first, then `global`:

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::ui-verify-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::ui-verify-lessons"], limit: 50 }
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-tester-lessons"],    limit: 50 }
memory.list { scope: "global",               tags: ["loop::aw-tester-lessons"],    limit: 50 }
```

Apply matched lessons as authoring constraints:

- A `ui-verify-lessons` navigation lesson → write its step into an intent spec's `**Steps:**` or `**Preconditions:**`, or its path into `**Start:**` (e.g. dismiss the cookie banner first, add `?tab=settings` to the start path); in a lifted grammar spec, the same lesson belongs in `preconditions:` or `flow:`.
- An `aw-tester-lessons` locator lesson → put the locator form that healed reliably under the intent spec's `**Hints:**`; never the one that drifted.

Lessons are **advisory**. They shape the spec; they never make you skip authoring a spec or invent a step you cannot justify from the diff.

## Read at run time

Before [`runner.md` Step 4b](./runner.md#step-4b-adversarial-pass--try-to-break-it), list `ui-verify-lessons` narrow-to-broad and pass the bodies whose **Applies when** line matches the probed specs on the adversarial pass's `Lessons:` input line — `none` when nothing matches or `memory.*` is not connected:

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::ui-verify-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::ui-verify-lessons"], limit: 50 }
```

## Write at run time

After the runner reports its verdict (`run` Step 6), write a `ui-verify-lessons` entry **only** when a spec failed for a reason a better spec would have avoided, or an adversarial probe hit a `probe-error` twice because of an app-wide quirk:

- A missing precondition every page needs (cookie banner, feature-flag cookie, org selector).
- A route that needs a query param or path segment to render the changed component.
- A preview-deployment access quirk (a protection-bypass header, an auth-refresh step specific to the preview environment).
- The spec's `Target: preview` resolved but the app required a navigation the spec did not encode.
- An adversarial probe ([`adversarial.md`](./adversarial.md)) hit a `probe-error` twice because of an app-wide quirk the next pass should plan around — inputs that debounce, an optimistic success toast that reverts on failure, a route that needs a query param. Pass the matched lessons to the next pass on its `Lessons:` input line.
- An intent spec passed with an `adapted` or `added` deviation the author could have written — a step the page always needs, or the real route to the changed control. Record the route the runner took, so the next author writes it as a step or a `**Hints:**` line.

**Do not write** when:

- The only failure was a locator miss `aw-tester` healed — that is `aw-tester-lessons`, and `aw-tester` writes it.
- Every spec passed cleanly — no failure, no `adapted` or `added` deviation — and no adversarial probe hit a repeated `probe-error`.
- The run stopped at `inconclusive` because the preview was not deployed — that is a timing outcome, not a lesson.
- `memory.*` is not connected.

Dedup, then write:

```text
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write {
  scope: "<global | repo::{owner}/{repo}>",
  key:   "ui-verify-lessons::<kebab-slug>",
  value: "<lesson body — see schema below>",
  tags:  ["loop::ui-verify-lessons", "source::run"],
  source_agent: "ui-verify",
  trigger: "spec-navigation-friction",
  ttl_days: 90
}
```

Classify the scope: a quirk true of any app (dismiss a cookie banner before asserting) → `global`; a quirk of this app (`/dashboards` needs `?view=grid`) → `repo::{owner}/{repo}`.
A recurrence resolves to an UPDATE: the store increments `seen_count` by 1 for you, and re-passing `ttl_days` refreshes the expiry.
Never hand-write a count into the body.
That is how a recurring quirk reaches the store's own `seen_count >= 3` promotion gate.

## Lesson body schema

The body is **markdown and nothing else** — never a `<!-- meta: … -->` block, and never a hand-written count or expiry date.
Every store-backed fact has its own first-class `memory.write` field: the store owns `seen_count`, `ttl_days` sets the expiry, and `status::<value>` / `source::<trigger>` are tags; the concrete matching signal travels as a visible **Applies when:** line directly under the title.

```markdown
# <one-line lesson title>

**Applies when:** <concrete signal: route glob, component name, the `preview` target>

**What happened:** <the spec step that failed, and the observable>
**Why:** <the navigation / precondition cause, or "unknown">
**Do this instead:** <prescriptive, testable authoring instruction>
**Promotion target:** <where this would harden ui-verify authoring, or "none">
```

Schema authority: [`write-pipeline.md#lesson-scope-entries`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries).
The **Applies when** line must be a concrete matching signal (a route glob, a component name, the `preview` target), never a subjective condition — a lesson without one cannot be matched mechanically, so do not persist it.

## The UI surface

What counts as UI for the `is-ui-diff` gate is config, not a lesson: `surface` in the committed `.agents/aw/ui.yml`, written by `/aw-verify setup`.
`author` Step 0 forwards it to the gate as `--surface-json`; its fields are the gate's (`mode`, `extensions`, `dirExtensions`, `dirs`, `globs` or `include`, `exclude`).

```yaml
surface:
  mode: extend            # extend (default) merges with the gate's defaults; replace pins the surface exactly
  dirs: [src/web, packages/ui/src]
  exclude: ['packages/api/**']
```

The gate is deterministic, so a wrong answer is a surface gap:

- A UI change classified `no` → widen `surface` (add the `dirs` entry, or promote an extension), then re-run `author`.
- A non-UI change classified `yes` → add the path to `exclude`, or switch to `mode: replace` with the real UI dirs.

Edit `ui.yml` in the PR that found the gap, so the next PR in the repo decides correctly.
Login shape is config too: `.agents/aw/environments.yml` → `<env>.auth`, including `authed_check`.

## Entrenchment guards

The same five guards that govern `aw-tester-lessons` apply here: lessons are advisory (they never change the verdict or the grammar); recurrence (the store's own `seen_count >= 3`, or the `status::structural` tag) gates promotion; every lesson expires (`ttl_days: 90` on every write, re-passed on a recurrence); a contradicting lesson is surfaced, not overwritten; the privacy pre-flight is never bypassed — never store credentials, tokens, preview-auth secrets, customer names, or product data.
