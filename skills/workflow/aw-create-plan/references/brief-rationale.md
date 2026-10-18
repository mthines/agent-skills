# Why plan.md is a brief

Read on demand; nothing here is a rule an agent must load to act.

## Contents

- [The brief replaces the up-front plan](#the-brief-replaces-the-up-front-plan)
- [Why each Core section exists](#why-each-core-section-exists)
- [Why Requirements and Acceptance Criteria keep their headings](#why-requirements-and-acceptance-criteria-keep-their-headings)
- [Why the Definition of Done is a sentinel line](#why-the-definition-of-done-is-a-sentinel-line)
- [Why snapshots are opt-in](#why-snapshots-are-opt-in)

## The brief replaces the up-front plan

With current models an exhaustive up-front plan buys less than it costs: the executor re-derives most of it from the code anyway, and planner mistakes pinned in detail cascade into the implementation.
A good brief carries three things the executor cannot re-derive — the task, the guardrails (what must not change), and an executable definition of done — and the human reviews the result afterwards, from the walkthrough's one-page summary, instead of approving a long plan beforehand.
The research behind the diminishing returns of planning length lives in the `autonomous-workflow` skill's `references/anthropic-architecture-research.md` § 5 and `references/planning-quality-research.md`.

## Why each Core section exists

| Section | The failure it prevents |
| --- | --- |
| Task | A reviewer cannot agree or disagree with the direction in under a minute |
| Requirements | A user-stated requirement is silently dropped (rule #9 traces each to a criterion) |
| Guardrails | The executor "improves" code outside the task, or weakens a test to go green |
| Acceptance Criteria (Definition of Done) | "Done" is judged by the model instead of measured by a command |
| Turn Cap | A goal-driven loop runs indefinitely on an unreachable condition |
| File Changes | Scope is unbounded, so the out-of-bounds guardrail has nothing to compare against |

Everything else — decisions, ordering, risks, research notes — is Extended: useful on a complex Full-tier task, noise on a simple one.

## Why Requirements and Acceptance Criteria keep their headings

The brief names are Task, Guardrails, Definition of Done, Turn cap, and File Changes.
Two of them keep a second heading for compatibility: `confidence(plan)` rules #3, #5, #9, and #11, L1 Check C, and the `checks.yaml` derivation all key on the literal headings `## Requirements` and `## Acceptance Criteria`.
`## Acceptance Criteria (Definition of Done)` satisfies those prefix-matching `awk` ranges while naming the brief's role, so no deterministic gate had to move to adopt the brief.

## Why the Definition of Done is a sentinel line

"Double-check your work" instructions do not verify anything; an executable pass/fail check does.
`run-checks.mjs` prints exactly one line — `CHECKS n/n PASS (<sha>)` or `CHECKS p/n FAIL: <ids>` — so the executor, the `aw` dispatcher, and a `/goal` judge that reads only the transcript all decide "done" from the same evidence.
`checks.lock` makes the immutability of `id`, `requirement`, `ears`, `kind`, and `expect` mechanical instead of a promise.

## Why snapshots are opt-in

`.agent/` is gitignored scratch, the `version:` frontmatter already counts iterations, and the immutable `plan.vN.md` chain is rarely re-read.
Writing it on every iteration costs a redundant write with no measured effect on task success, so it is written only on request.
