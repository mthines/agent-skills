---
title: The two-way memory loop — preview-spec-lessons + aw-tester-lessons
impact: HIGH
tags:
  - preview-spec
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
| **`preview-spec-lessons`** (new, `loop::preview-spec-lessons`) | Spec-quality and navigation knowledge — a required precondition, a route quirk, a preview-auth step. | the runner (this skill, `run`) | the author (this skill, `author`) |
| **`aw-tester-lessons`** (existing, `loop::aw-tester-lessons`) | Locator-healing and verification friction. | `aw-tester` | `aw-tester` at run start, **and the author at author time** (cross-bucket read) |

The cross-bucket read is the second half of the loop: locator friction `aw-tester` discovered informs which locators the author picks.
If `memory.*` is not connected, skip every step here silently and log one line: `preview-spec: memory.* not connected, continuing`.

## Read at author time

Before writing a spec (`author` Step 1), read both buckets narrow-to-broad — `repo::` first, then `global`:

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::preview-spec-lessons"], limit: 50 }
memory.list { scope: "global",               tags: ["loop::preview-spec-lessons"], limit: 50 }
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::aw-tester-lessons"],    limit: 50 }
memory.list { scope: "global",               tags: ["loop::aw-tester-lessons"],    limit: 50 }
```

Apply matched lessons as authoring constraints:

- A `preview-spec-lessons` navigation lesson → write its step into the spec's `preconditions:` or `flow:` (e.g. dismiss the cookie banner first, add `?tab=settings` to the `url:`).
- An `aw-tester-lessons` locator lesson → prefer the locator form that healed reliably; avoid the one that drifted.

Lessons are **advisory**. They shape the spec; they never make you skip authoring a spec or invent a step you cannot justify from the diff.

## Write at run time

After the runner reports its verdict (`run` Step 6), write a `preview-spec-lessons` entry **only** when a spec failed for a reason a better spec would have avoided:

- A missing precondition every page needs (cookie banner, feature-flag cookie, org selector).
- A route that needs a query param or path segment to render the changed component.
- A preview-deployment access quirk (a protection-bypass header, an auth-refresh step specific to the preview environment).
- The spec's `Target: preview` resolved but the app required a navigation the spec did not encode.

**Do not write** when:

- The only failure was a locator miss `aw-tester` healed — that is `aw-tester-lessons`, and `aw-tester` writes it.
- Every spec passed cleanly.
- The run stopped at `inconclusive` because the preview was not deployed — that is a timing outcome, not a lesson.
- `memory.*` is not connected.

Dedup, then write:

```text
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }
memory.write {
  scope: "<global | repo::{owner}/{repo}>",
  key:   "preview-spec-lessons::<kebab-slug>",
  value: "<lesson body — see schema below>",
  tags:  ["loop::preview-spec-lessons", "source::run"],
  source_agent: "preview-spec",
  trigger: "spec-navigation-friction"
}
```

Classify the scope: a quirk true of any app (dismiss a cookie banner before asserting) → `global`; a quirk of this app (`/dashboards` needs `?view=grid`) → `repo::{owner}/{repo}`.
A repeat of an existing lesson is an UPDATE to the same `scope` + `key`, which increments `seen_count` and refreshes `expires` — that is how a recurring quirk reaches the `seen_count >= 3` promotion gate.

## Lesson body schema

The five mandatory fields travel in a `meta:` comment, mirroring `aw-tester-lessons`:

```markdown
<!-- meta: phase=author seen_count=1 status=active expires=<ISO 8601 — created + 90 days> trigger-context="<concrete signal: route glob, component, aw-target 'preview'>" source=system -->

# <one-line lesson title>

**What failed:** <the spec step that failed, and the observable>
**Why:** <the navigation / precondition cause, or "unknown">
**What to write next time:** <prescriptive, testable authoring instruction>
**Promotion target:** <where this would harden preview-spec authoring, or "none">
```

Omitting any of the five `meta:` fields makes the write a defect — do not persist it.
`trigger-context` must be a concrete matching signal (a route glob, a component name, the `preview` target), never a subjective condition.

## Entrenchment guards

The same five guards that govern `aw-tester-lessons` apply here: lessons are advisory (they never change the verdict or the grammar); recurrence gates promotion (`seen_count >= 3` or `status: structural`); every lesson expires (default 90 days); a contradicting lesson is surfaced, not overwritten; the privacy pre-flight is never bypassed — never store credentials, tokens, preview-auth secrets, customer names, or product data.
