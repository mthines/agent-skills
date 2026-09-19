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
**Promotion target:** <where this would harden preview-spec authoring, or "none">
```

Schema authority: [`write-pipeline.md#lesson-scope-entries`](../../../authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries).
The **Applies when** line must be a concrete matching signal (a route glob, a component name, the `preview` target), never a subjective condition — a lesson without one cannot be matched mechanically, so do not persist it.

## The UI surface record

This is the "learns what counts as UI, per repo" half of the loop. It is a **config record, not a friction lesson** — it carries a JSON body the `is-ui-diff` gate consumes, so it is the one record under this tag that is not markdown-only.

| Field | Value |
| --- | --- |
| Scope | `repo::{owner}/{repo}` — a UI surface is repo-specific by definition. |
| Key | `preview-spec-lessons::ui-surface` (exactly one per repo). |
| Tag | `loop::preview-spec-lessons` (so it is discoverable alongside the friction lessons) plus `kind::config`. |
| Written by | `/aw-setup` at setup time, and refined when the gate misclassifies (below). |
| Read by | `author` Step 0 — forwarded to the gate as `--surface-json`. |

The body is the surface JSON the gate accepts (every field optional):

```json
{
  "mode": "extend",
  "extensions": [".ts"],
  "dirExtensions": [],
  "dirs": ["src/web", "packages/ui/src"],
  "globs": [],
  "exclude": ["packages/api/**"]
}
```

`mode: "extend"` (default) merges with the gate's broad defaults; `mode: "replace"` pins the surface exactly (use for a repo whose layout the defaults get wrong). See the gate's own header for each field's meaning.

**The refine loop — this is how it learns.** The gate is deterministic, so a wrong answer is always a surface gap, never a coin toss:

- A **UI change classified `no`** (a spec that should have been authored was not) → widen the surface: add the missing `dirs` entry or promote the extension (e.g. a frontend-only repo adds `.ts` to `extensions`). Then re-run `author`.
- A **non-UI change classified `yes`** (a backend-only PR got a spec) → narrow it: add the path to `exclude`, or switch to `mode: "replace"` with the real UI dirs.

Write the correction back to this record (`memory.write` same scope + key updates it in place). The next PR in the repo — anyone's — decides correctly from the start. Never store a path that reveals a secret; a directory layout is not sensitive, a token embedded in one would be.

## Entrenchment guards

The same five guards that govern `aw-tester-lessons` apply here: lessons are advisory (they never change the verdict or the grammar); recurrence (the store's own `seen_count >= 3`, or the `status::structural` tag) gates promotion; every lesson expires (`ttl_days: 90` on every write, re-passed on a recurrence); a contradicting lesson is surfaced, not overwritten; the privacy pre-flight is never bypassed — never store credentials, tokens, preview-auth secrets, customer names, or product data.
