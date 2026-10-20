---
title: Lessons — a LoreKit loop so the next run does not repeat this run's mistakes
impact: MEDIUM
tags:
  - lorekit
  - lessons
  - self-improvement
---

# Lessons

`aw-verify` runs a two-tier LoreKit lessons loop, wired from the `lorekit-setup` skill's code-changing-agent recipe card.
Fast tier: advisory lessons read at the start of every run and written at the run's failure points.
Slow tier: a lesson that recurs is promoted, by a human-reviewed edit, into one of this skill's `rules/` files.
Without the `memory.*` tools the loop is a silent no-op; the run proceeds unchanged.

| Bucket | Value |
| --- | --- |
| Tag | `loop::verify-lessons` |
| Key | `verify-lessons::<kebab-slug>` |
| Scope | `repo::<slug>` (the repo slug from setup, e.g. `repo::acme/shop`) when the lesson names a path, component, route, or service; `global` otherwise |
| Injection cap | 5 per scope |
| TTL | 90 days, refreshed on recurrence |

## Read step

In pre-flight, before Phase 1:

```text
memory.list   { scope: "repo::<slug>", tags: ["loop::verify-lessons"], limit: 5 }
memory.list   { scope: "global",              tags: ["loop::verify-lessons"], limit: 5 }
memory.search { q: "<surfaces from the diff: component names, routes>", scopes: ["repo::<owner>/*", "global"], limit: 5 }
```

At the start of Phase 4, once the files to change are known:

```text
memory.list { scope: "repo::<slug>", tags: ["codebase-knowledge"], limit: 100 }
# keep only hotspot::<path> / knowledge::<symbol>@<path> records for files this run will touch
```

Match each lesson's **Applies when** against this run and treat matching **Do this instead** lines as considerations, not commands.
`repo::` wins over `global` on a conflict.
Re-verify against the code before relying on a lesson; an absent lesson is never evidence that something is safe.

## Write step

Write at these failure points — not on smooth runs:

Never write a lesson whose fix works around a defect in the code under verification ("start without `--turbopack`"): that is a finding for `findings.jsonl`, and as a lesson it hides the defect from the next run.

| Failure point | `trigger` | Example lesson |
| --- | --- | --- |
| Stack start or takeover failed, or needed an undocumented step | `command-failure` | Daemon bound to another worktree; `--repo-root` teardown was required |
| Setup guessed the driver, port, or test command wrong | `assumption-wrong` | Vite app served on `5174` because `5173` was taken; set `port` explicitly |
| Login or locator friction in `ui-verify` that cost a retry | `gotcha` | The identity provider's sign-in on localhost needed `/aw-verify setup` to capture a local login |
| Telemetry query returned nothing for a known reason | `assumption-wrong` | The assumed span-status key matched nothing; the real key came from `getAttributeKeys` |
| A fix took ≥ 2 attempts | `stuck-loop` | Views form state resets on remount; fix lives in the store, not the component |
| A finding was missed until telemetry caught it | `near-miss` | Spec passed while api logged a 500 on retry |
| A precedent search settled an unclear expectation fast | `paid-off` | Empty states in the UI package use `<EmptyState>` with a primary action |

```text
memory.search { q: "<key words of the lesson>", scopes: ["repo::<slug>", "global"], limit: 10 }   # dedup first

memory.write {
  scope:    "repo::<slug>",
  key:      "verify-lessons::daemon-bound-to-other-worktree",
  value:    "<lesson body below>",
  tags:     ["loop::verify-lessons", "source::command-failure"],
  trigger:  "command-failure",
  ttl_days: 90
}
```

The same scope and key updates the lesson in place; the store increments `seen_count`.
Never write counts, dates, or metadata into the body.

When a fix verified a structural fact (an invariant a symbol must hold, a file that produced the defect), also write it to `codebase-knowledge` under the shared multi-writer contract that `lorekit-setup` documents.

## Lesson body

```markdown
# <one-line takeaway — what to do>

**Applies when:** <concrete signal — component, route, tool, error text>

**What happened:** <the observable>
**Why:** <root cause, or "unknown">
**Do this instead:** <prescriptive, testable instruction>
**Promotion target:** <rules/<file>.md § <section>, or "none">
```

## Promotion

A lesson with `seen_count >= 3`, or tagged `status::structural`, is promotion-eligible.
List eligible lessons in the report's **Lessons** section with a one-line suggested edit to the promotion target.
Never edit `rules/` from inside a run.
