---
title: Memory buckets — the canonical LoreKit bucket taxonomy
impact: HIGH
tags:
  - lorekit
  - memory
  - lessons
  - self-improvement
  - taxonomy
  - reference
---

# Memory buckets

This is the single map of every LoreKit bucket the skills and agents use.
Read it when a bucket name is unclear, when wiring a new read or write, or before proposing to rename one.

Every bucket is a LoreKit **tag** plus a **key namespace**, written to a **scope** (`global` or `repo::{owner}/{repo}`).
The shared record schema and the `seen_count` UPDATE contract are owned by [`write-pipeline.md § Lesson-scope entries`](../../../skills/authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries); the loop design (read step, promotion gate, entrenchment guards) is the `lorekit-setup` skill.
This file does not restate those — it only names the buckets and says which kind each one is.

---

## The three kinds

The names encode the **host** (which skill or agent owns the bucket), not the **kind**.
That is the one thing to internalize: a name like `reviewer-comment-relevance` tells you the host, so you must look up the kind here.
There are exactly three kinds.

| Kind | What it holds | Lifetime | Read cadence | Changes behavior? |
| --- | --- | --- | --- | --- |
| **Lessons** | Procedural "how to do better next time" rules, distilled from experience. | Durable (~90d, refreshed on re-sighting). | At the **start of every run** of the host. | No — advisory input only, until a human promotes one into source. |
| **Bus** | Raw, per-item outcome events awaiting distillation. | Volatile (short TTL, ~30d). | At **promotion time only** — never loaded per-run. | No — it is raw material, not a signal. |
| **Signal** | A durable, learned per-repo filter derived from resolved outcomes. | Durable (~60d). | At the **start of every run**, like lessons. | No — it biases which findings survive, advisory only. |

Only the **Lessons** kind follows the `loop::<host>-lessons` convention.
The single **Bus** and single **Signal** bucket are tagged `loop::…` too, but they are not lessons — that shared prefix is the main source of confusion.

---

## The `review*` trio (the confusing one)

Three buckets start with "review…" and are one pipeline, not three variants:

```
review-outcomes            reviewer-lessons
(raw per-comment verdicts) ──distilled at──▶ (how to review better)
   Bus · volatile 30d       promotion time     Lessons · durable 90d

reviewer-comment-relevance
(which comment patterns get fixed vs. ignored, per repo)
   Signal · durable 60d · read on every review
```

- **`review-outcomes`** is the **Bus**: `implement-suggestion` appends a verdict (applied / rejected / reverted) per comment; it is consumed only when promotion distills it into `reviewer-lessons`.
- **`reviewer-lessons`** are the **Lessons**: procedural review wisdom, read by `reviewer` and `pr-reviewer` at the start of every run.
- **`reviewer-comment-relevance`** is the **Signal**: a per-repo record of which comment *patterns* authors act on vs. ignore, read every run to suppress noise and reinforce reliable findings.

---

## Master table — all 13 buckets

### Lessons (`loop::<host>-lessons`, key `<host>-lessons::<slug>`)

| Bucket | Host | Read → Write | Scope default | Notes |
| --- | --- | --- | --- | --- |
| `aw-lessons` | `aw` dispatcher (shared by `aw-planner` / `aw-executor`) | dispatcher start → on friction | `global` \| `repo::` | Universal loop hoisted to the dispatcher; promotes to `diagnose`. |
| `aw-tester-lessons` | `aw-tester` | spec run start → on spec-verify friction | `global` \| `repo::` | UI-verification lessons. |
| `fix-bug-lessons` | `fix-bug` | Phase 0.5 → Phase 5·7·8 | `global` \| `repo::` | Diagnostic-phase lessons; inherits `aw-lessons` via `aw-executor`. |
| `batch-lessons` | `batch-linear-tickets` | Phase 1 → Phase 5 | `global` \| `repo::` | Ticket classification + correlation. |
| `reviewer-lessons` | `reviewer`, `pr-reviewer` | Step 0.7 / Step 1.0 → `reviewer` end-of-run + promotion | `global` \| `repo::` | Distilled from the `review-outcomes` bus at promotion time. |
| `implement-suggestion-lessons` | `implement-suggestion` | Phase 3 → Phase 7 + `--watch` | `global` \| `repo::` | Classification, gate calibration, lane selection. |
| `ci-auto-fix-lessons` | `ci-auto-fix` | Phase 3 → Phase 8·9 | **`repo::`** | More conservative: `seen_count ≥ 5` promotion; regression lessons `volatile`, 30d. |
| `e2e-pr-stabilizer-lessons` | `e2e-pr-stabilizer` | Phase 4 → Phase 7 | `global` (race-shapes) \| `repo::` (locators) | Writes gated on telemetry ratification. |
| `test-auto-fix-lessons` | `test-auto-fix` | Phase 2 → Phase 6·7 | `global` \| `repo::` | Keyed `stack : failure-pattern : verdict-sub-class`. |
| `ideate-lessons` | `ideate` | Phase 0 → Phase 7 | `global` \| `repo::` | Mechanics only — divergence runs lessons-blind. |
| `optimize-approach-lessons` | `optimize-approach` | O0 → O5 | `global` \| `repo::` | Optimal/suboptimal bar + apply-safety calibration. |

### Bus (`loop::review-outcomes`, key `review-outcomes::<fingerprint-slug>`)

| Bucket | Owner rule | Producer → Consumer | Lifetime | Never |
| --- | --- | --- | --- | --- |
| `review-outcomes` | [`review-outcomes.md`](./review-outcomes.md) | `implement-suggestion` (Phase 7 + `--watch`) → promotion in [`outcome-learning.md`](./outcome-learning.md) | volatile 30d (`.review.yaml` `outcome-ttl`) | **Never loaded into a per-review run.** Fingerprint = `category:claim-gist:code-pattern`, reused from `prior-comment-awareness.md` 2.5b. |

### Signal (`loop::reviewer-comment-relevance`, key `reviewer-comment-relevance::<category>:<claim-gist>`)

| Bucket | Owner rule | Producer → Consumer | Lifetime | Read |
| --- | --- | --- | --- | --- |
| `reviewer-comment-relevance` | [`comment-relevance-memory.md`](./comment-relevance-memory.md) | GH Action `reviewer-comment-relevance.yml` (**not yet committed** — see below) + `implement-suggestion` + `reviewer`/`pr-reviewer` post-merge fallback → `reviewer`/`pr-reviewer` | durable 60d | Every review run (`reviewer` Step 0.7 / `pr-reviewer` Step 1.0); applied at Step 2.2. |

> **Availability note on the GH Action producer.** `.github/workflows/` in this repo currently contains only `evals-l1.yml` and `evals-l2.yml`; the reusable workflow `reviewer-comment-relevance.yml` that `plugins/pr-relevance-memory/templates/pr-relevance-caller.yml` and [`comment-relevance-memory.md`](./comment-relevance-memory.md) point at with `uses: mthines/agent-skills/.github/workflows/reviewer-comment-relevance.yml@main` has not been committed. Its classifier (`scripts/record-comment-relevance.mjs`) and the caller template both ship, so the write path is designed and callable once the workflow lands — but until it does, a caller repo wiring up that `uses:` reference will fail to resolve it, and the only live producers are `implement-suggestion` and the post-merge fallback. Re-check with `ls .github/workflows/` rather than trusting this note.

---

## First-class properties in LoreKit (`kind` + `host`)

`kind` and `host` are **first-class LoreKit properties** — tracked columns, not something inferred from the tag string on every read — as of lorekit #372 (migration `00056`). This document remains the authoritative enum for their values.

| Property | Values | Meaning |
| --- | --- | --- |
| `kind` | `lesson` \| `bus` \| `signal` | The memory's role — the three kinds above. |
| `host` | kebab slug (`aw`, `reviewer`, `fix-bug`, `ci-auto-fix`, `ideate`, … ; `review` for the shared **bus**, `reviewer` for the **signal** — see the inference table below) | The owning skill or agent. |

A loop's `memory.write` may set `kind` and `host` explicitly; when omitted, LoreKit infers them from the `loop::<host>-lessons` tag (below), so a tagged write records them without extra arguments. The `loop::<host>-lessons` **tags stay** — they remain the cross-tool read filter and the back-compat contract — so the property is additive, not a rename.

**Back-compat inference.** When a stored memory lacks `kind`/`host` (written before `00056`, or by an older client), LoreKit derives them from the tag so old memories gain the properties without a data migration:

| Tag | Inferred `kind` | Inferred `host` |
| --- | --- | --- |
| `loop::<x>-lessons` | `lesson` | `<x>` |
| `loop::review-outcomes` | `bus` | `review` |
| `loop::reviewer-comment-relevance` | `signal` | `reviewer` |

**What the property unlocks:**

- Query by kind/host directly — `GET /memories?kind=lesson&host=reviewer` (both parameters, plus `kind_mode` / `host_mode`, are in the published OpenAPI spec at `https://lorekit.io/api-docs/spec`), or `npx @lorekit/cli list --kind signal --host reviewer` (implemented in `1.32.0`, but **not listed in `list --help`** — do not read its absence from the help text as the flag not existing).
  **The MCP `memory.list` tool is the exception: it accepts only `scope`, `tags`, and `limit`, so kind/host filtering is not reachable from an MCP client.** Filter client-side, or use the REST route. Re-check with the live tool schema before relying on it.
- **Usage tracking** — memory operations are recorded per `kind` and per `host` (on `usage_events`), so reads, writes, and searches are attributable to a family and an owner instead of an opaque tag. LoreKit resolves the pair identically for the stored row and the analytics event (`resolveKindHost`), so an untagged-but-explicit write and a tag-only write are attributed the same way.
- Dashboard grouping by kind. **Filtering by kind in the Explorer is not exposed yet** — its filter dimensions are still the six that [Tags & scopes](https://lorekit.io/docs/tags) enumerates (label, agent, trigger, repository, branch, pull request); neither `kind` nor `host` is among them.

---

## Why the tags are not kind-prefixed

It is tempting to rename these to a kind-first scheme (`lesson::reviewer`, `bus::review-outcomes`, `signal::comment-relevance`) so the kind is legible at a glance.
Do not, unless the whole ecosystem moves together.

The bucket names are a **cross-tool contract**, not internal identifiers:

- The `loop::<host>-lessons` tag convention is defined by the external `lorekit-setup` and `lorekit-memory` skills — renaming forks from it.
- `reviewer-comment-relevance` is written verbatim by `scripts/record-comment-relevance.mjs`, by the caller template in `plugins/pr-relevance-memory/`, and by the `reviewer-comment-relevance.yml` GitHub Action those two are built around (not yet committed — see the availability note above). A rename would have to land in the shipped script and template regardless.
- The L1 eval enumerates the lessons bucket names: Check E (`scripts/eval/l1.mjs`) asserts that no `memory/<bucket>/` directory is committed here, one assertion per bucket, so a rename must be mirrored into that array. Note what it does **not** do — it keys on the bucket *name*, never on the `loop::…` tag, so no check would catch a tag rename that left the names alone. Nothing in the evals pins the tag strings.
- LoreKit keys memories by `scope` + `key`; a rename orphans every memory already written under the old name — it does not migrate them.

The clarity fix is the first-class `kind` + `host` **property** (lorekit #372) plus **this document** as the enum — not a tag rename.
The property adds kind-first querying and usage tracking without forking the tag contract or orphaning stored memories.
If a tag rename is ever undertaken anyway, it must land in one change across the rules, the agents, the workflow, the script, the evals, and a documented migration of existing memories — and should be discussed as an ecosystem decision, not a local cleanup.

---

## See also

- [`write-pipeline.md § Lesson-scope entries`](../../../skills/authoring/persistent-memory/rules/write-pipeline.md#lesson-scope-entries) — the shared record schema (`trigger-context`, `seen_count`, `status`, `expires`).
- [`review-outcomes.md`](./review-outcomes.md) — the Bus schema, fingerprint, TTL, and consolidation.
- [`comment-relevance-memory.md`](./comment-relevance-memory.md) — the Signal read/apply/write contract.
- [`outcome-learning.md`](./outcome-learning.md) — how the Bus is distilled into Lessons at promotion time.
