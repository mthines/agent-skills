---
title: observe-run — the dev-run lessons loop (LoreKit, global + repo)
impact: HIGH
tags:
  - observe-run
  - lorekit
  - lessons
  - self-improvement
  - loop
---

# The dev-run lessons loop

A run teaches things the profile can never hold: that a package's rung-1 exporter
needs an env var set before it emits anything, that a command's spans are not
queryable until a few seconds after the process exits, that one reader adapter is
blind to a given stack and another is not, that a service's meter provider needs
`dev.run.id` stamped SDK-side. None of that is interview-answerable and none of it
is deterministic — it is **learned from the run that just happened**. This file
gives `observe-run` a place to accrue that knowledge and read it back on the next
run.

It is a standard LoreKit self-improvement loop, and it reuses the canonical
contract verbatim rather than inventing a second one — see the external
`lorekit-setup` skill's `rules/self-improvement-loops.md`.
Everything below is the `observe-run`-specific instantiation of that contract; the
schema, the recurrence mechanics, and the promotion path all live there.

## Why this is a loop and the profile is not — the load-bearing boundary

The [Observability Profile](../SKILL.md#the-self-skip-gate) and this loop look
adjacent and are opposites, and conflating them is the mistake this section
exists to prevent.

| | Observability Profile | Dev-run lessons |
| --- | --- | --- |
| **Nature** | Config — interview-derived, deterministic | Experience — accreted from what runs discover |
| **Changes when** | A human re-runs `measurable setup` | A run hits friction, automatically |
| **Home** | Committed markdown at `<repo>/memory/observability-profile/` (`persistent-memory`, `project-shared` tier) | LoreKit `memory.*` (the bucket below) |
| **Why that home** | Must be **diffable in a PR and visible to every teammate** — a wrong package map silently misroutes every future call, so it belongs in review | Must **auto-update in place and merge two scopes at read** — a living record, not a reviewed artifact |

The profile stays committed **on purpose**. Moving the package map or the dev-run
command into LoreKit-only storage would lose both PR-diffability and
teammate-visibility — a regression, not an upgrade. This loop is strictly
**additive**: it does not relocate one field of the profile. It adds a second,
experiential layer beside it. The profile answers *what to run and where its
telemetry goes*; the loop answers *what this repo — and the user across every
repo — has already learned about running and reading it*.

The "living markdown that auto-updates" is precisely this loop's records: in
LoreKit `local` mode a lesson **is** a markdown file (home tier `~/.lorekit/`,
project tier `<repo>/.lorekit/`), and a recurrence overwrites the same
`scope` + `key` in place rather than piling up — the auto-update is the
overwrite, not a separate mechanism.

## The bucket

Give the loop its own bucket so its lessons never collide with another loop's on
the same scopes:

- **Tag:** `loop::observe-run-lessons` — reads filter by it; writes always carry it.
- **Key:** `observe-run-lessons::<kebab-slug>` — same `scope` + `key` overwrites
  in place, which is what makes recurrence countable.

## The two scopes, and which lesson goes where

This is the global-vs-repo split the loop exists to serve. Classify each lesson by
whether it binds to *this codebase* or follows *the user everywhere*:

| Scope | Holds | Examples |
| --- | --- | --- |
| `repo::{owner}/{repo}` | Lessons bound to a concrete package, command, service, or dataset in **this** repo | "`api` package's rung-1 exporter emits nothing until `OTEL_SDK_DISABLED` is unset" · "spans from `pnpm dev:seed` are queryable ~4 s after exit — wait before rung-2 query" · "`worker` service emits metrics, so rung 2 must stamp `dev.run.id` SDK-side on the tracer/logger providers only" |
| `global` | Cross-repo dev-loop conventions that hold regardless of codebase | "prefer `otel-desktop-viewer` for a quick visual rung-1 read when no Dash0 CLI is installed" · "`dash0 spans query` filters with `is`, not `=`" · "default to rung 1 for a tight inner loop; escalate only for cross-process fan-out" |

On a `repo::` vs `global` collision at read time, the `repo::` lesson wins (closer
scope). When a lesson's scope is genuinely ambiguous, default to `global` — the
same default the canonical contract sets.

## Read step — before the run, after the self-skip gate

Placement is load-bearing. The read happens **after** the [self-skip
gate](../SKILL.md#the-self-skip-gate) has passed (so a genuine skip still spends
nothing — [Core Principle 4](../SKILL.md#core-principles)) and **before** rung
selection and the run itself (so a lesson can bias the rung, the run-identity
mechanism, and the reader choice — the three things a lesson most often corrects).

```text
memory.list { scope: "repo::{owner}/{repo}", tags: ["loop::observe-run-lessons"], limit: 50 }   # skips silently if memory.* not connected
memory.list { scope: "global",               tags: ["loop::observe-run-lessons"], limit: 50 }
# when the expectation set or command names a package/service/error, add:
memory.search { q: "<keywords>", scopes: ["repo::{owner}/*", "global"], limit: 10 }
```

Then match each lesson's **Applies when** line against the current run and apply
the matches as **considerations, not commands** — a lesson biases the run unless
it conflicts with the user's stated intent or the expectation set, in which case
intent wins and you surface the conflict. Expiry is LoreKit's job (`ttl_days`);
a stale lesson has already aged out of the list, so there is nothing to skip by
hand.

**If LoreKit's `memory.*` tools are not connected, this whole step is a silent
no-op** — log one line and proceed to rung selection. The loop never blocks a run,
exactly as the profile's `persistent-memory` fallback never blocks setup.

## Write step — after the verdict, on friction only

Trigger on friction, never on a smooth run. For this skill the concrete friction
signals are:

- A reader adapter returned nothing on a stack where the run *did* emit — a
  reader-blindness lesson.
- The telemetry was not yet queryable at read time and a retry/wait was needed — a
  timing lesson.
- Rung 2 was forced back to rung 1 (unstampable `dev.run.id`, non-exclusive proxy
  port) — a rung-fallback lesson.
- A stamping mechanism had to be SDK-side to honour the per-signal `dev.run.id`
  constraint — a run-identity lesson.
- A lesson applied at the start of this run *worked* (the friction did not recur) —
  still write the UPDATE; successful application is recurrence evidence.

Do **not** write a lesson for the verdict itself — `confirms`/`contradicts`/
`ambiguous`/`null` is the receipt's job ([`receipt-mapping.md`](./receipt-mapping.md)),
not a lesson. A lesson is about *how to run and read better next time*, never about
what a given claim graded to.

```text
memory.search { q: "<key words of the lesson>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }   # dedupe first
memory.write {
  scope:   "<global | repo::{owner}/{repo}>",   # classified per the table above
  key:     "observe-run-lessons::<slug>",
  value:   "<the lesson body — pure markdown, schema below>",
  tags:    ["loop::observe-run-lessons", "source::<trigger>"],
  trigger: "<stuck-loop | command-failure | gotcha | near-miss | assumption-wrong | paid-off | manual>",
  ttl_days: 90                                   # expiry is a structured field, not a body stamp
}
```

**The `value` is pure markdown — nothing else.** Do not stamp `seen_count`,
`status`, `expires`, or a `trigger-context` string into a `<!-- meta: -->`
comment at the top of the body. Those are LoreKit's to own: recurrence follows
from the `scope` + `key` overwrite, expiry from `ttl_days`, provenance and
matching from `tags` and `trigger`. Hand-authored metadata in the body is
redundant the moment it is written and stale the moment the server disagrees.

```markdown
# <one-line lesson title>

**What failed:** <concrete observable from the run>
**Why:** <root cause, if known; "unknown" is allowed>
**What to do next time:** <prescriptive, actionable, testable instruction>
**Applies when:** <concrete signal — package glob, command, service, rung, error shape>
**Promotion target:** <the observe-run rule/step this would harden if promoted, or "none">
```

The **Applies when** line must be **concrete** — a package glob, a command, a
service name, a rung, an error shape — never "when it feels relevant", so the
read step can match it. It replaces the `trigger-context` metadata field: same
job, in the readable body, not a machine comment.

> **Divergence from the upstream contract, on purpose.** The external
> `lorekit-setup` skill's `self-improvement-loops.md`
> still prescribes a `<!-- meta: … -->` block in the `value`. This loop does not
> follow that part: a lesson body is prose a human reads, and the metadata it
> duplicates already lives in LoreKit's structured fields.

The privacy pre-flight is never skipped: a candidate lesson containing a secret,
token, credential, dataset auth token, or PII is **dropped, not written**. The bar
is stricter for `repo::` writes — a repo scope is team-visible, and a dev-run
command line is a common place for a token to hide.

## Promotion — the slow tier

A lesson that recurs across runs — the same `scope` + `key` written again — has
earned a **permanent** edit to `observe-run` itself: a reader-blindness lesson
seen several times belongs in
[`reader-adapters.md`](./reader-adapters.md)'s table, a recurring timing gotcha
belongs as a wait step in [`reader-adapters.md`](./reader-adapters.md). That
promotion is the slow tier and it is **human-gated** — recurrence proposes it, a
person approves it. This file does not automate the edit; it names the target in
each lesson's `Promotion target` so the proposal writes itself.

## What this rule does not do

- It does not relocate any field of the Observability Profile — the profile stays
  committed and repo-scoped. See the boundary table above.
- It does not gate the run — a missing LoreKit connection costs the loop, and the
  run, nothing.
- It does not redefine the lesson schema, the recurrence mechanics, or the
  promotion gate — those are `lorekit-setup`'s, cited above and reused verbatim.
