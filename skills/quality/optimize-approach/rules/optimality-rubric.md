---
title: Optimality Rubric — the four axes, anti-overlap guards, and the materiality bar
impact: HIGH
tags:
  - optimize-approach
  - optimality
  - rubric
  - anti-overlap
---

# Optimality Rubric

How to reach a `optimal` | `suboptimal` verdict for one **approach unit** (a cohesive way of solving one sub-goal in the diff).
This rule is loadable in isolation: given the diff, the intent, and this file, an agent can score a unit and decide whether to escalate it to a proposal.

## Contents

- [The four axes](#the-four-axes)
- [Anti-overlap guards](#anti-overlap-guards)
- [The materiality bar](#the-materiality-bar)
- [Verdict procedure](#verdict-procedure)
- [Examples](#examples)
- [Common mistakes](#common-mistakes)

## The four axes

Judge each approach unit on all four. A unit is a candidate for `suboptimal` when a **materially better alternative** exists on at least one axis and none of the anti-overlap guards fires.

| Axis | Fires when a better approach would… | Signal to look for |
| --- | --- | --- |
| **Codebase-fit / idiomatic** | reuse an existing utility, hook, or established pattern the diff reinvents | a hand-rolled helper that duplicates an exported util; a bespoke pattern where an adjacent module already has a shared one |
| **Simplicity / maintainability** | remove a structural layer — an abstraction, indirection, or state machine the goal does not need | a class where a function suffices; a callback chain where a single pass works; premature generality |
| **Performance / efficiency** | change algorithmic complexity or cut redundant work the current shape forces | O(n²) where O(n) is natural; per-item queries where one batched query works; recompute-in-loop |
| **Robustness / correctness** | pick a shape that structurally cannot hit a failure class the current shape invites | manual invariant upkeep a type/DB constraint would enforce; a race the current concurrency shape allows |

The axis is recorded on the proposal so the caller and the reader can see *why* the current approach is suboptimal.

## Anti-overlap guards

The dominant failure mode is producing noise the other three lenses already own.
**Drop the candidate (verdict stays `optimal`) when any guard fires:**

1. **Mechanical-tidy guard (vs `code-quality simplify`).** If the improvement is a Class M mechanical refactor — rename, guard-clause flip, dead-code removal, magic-number extraction, comment trim — it is *not* an approach change. `code-quality` owns it. Only escalate when the *shape of the solution* changes, not its surface.
2. **Failure-mode guard (vs `critical`).** If the finding is "this could fail because X" without a better *approach* that structurally avoids X, it is a `critical` concern, not an optimality proposal. Only the robustness axis escalates, and only when it names the safer approach.
3. **Intent / system-fit guard (vs `holistic-review`).** If the finding is "the diff does not do what it claims" or "a caller breaks", that is `intent-mismatch` / `system-fit` — `holistic-review` owns it. Optimize-approach assumes the diff is correct and asks whether a *better correct* approach exists.
4. **Rewrite-for-taste guard.** If the alternative is a lateral move (equally good, just different style), the verdict is `optimal`. A proposal must be *materially* better, not merely a preference.

## The materiality bar

Even when an axis fires and no guard blocks it, escalate to `suboptimal` **only** when the alternative clears all three:

- **Material** — the win is real and namable (a reused util, a complexity class dropped, a race removed), not marginal.
- **Safe-enough to state** — the alternative is understood well enough to describe in one or two sentences with concrete evidence, not hand-waved.
- **Worth the switch** — the benefit outweighs the blast radius of changing the approach at this stage. A large-blast rewrite for a small win stays `optimal` (say nothing).

If any of the three fails, the verdict is `optimal`. When in doubt, prefer `optimal` — silence on a decent approach costs nothing; a weak "better way" costs trust.

## Verdict procedure

For each approach unit:

1. Score the four axes. Note the strongest firing axis (if any).
2. If no axis fires → `optimal`.
3. If an axis fires, run the four anti-overlap guards. If any fires → `optimal`.
4. If the candidate survives, apply the three-part materiality bar. If it clears → `suboptimal` (escalate to O4 deep understanding). Otherwise → `optimal`.

`optimal` on every unit means the O3 quiet early-exit fires and the run returns nothing.

## Examples

### Good — a codebase-fit proposal that escalates

```text
Unit: new `retryWithBackoff` helper added in src/api/client.ts
Axis: codebase-fit — src/lib/retry.ts already exports `withRetry` with the same semantics.
Guards: none fire (this is a shape/reuse change, not a rename; not a failure mode; diff is correct).
Materiality: material (removes a duplicate), safe to state, low blast (one call site).
Verdict: suboptimal → propose reusing `withRetry`.
```

### Bad — a candidate that a guard correctly drops

```text
Unit: `const timeoutMs = 5000` inline in the new fetch call
Axis: simplicity — could be a named constant.
Guard 1 (mechanical-tidy) FIRES: magic-number extraction is a Class M code-quality fix.
Verdict: optimal (drop — code-quality owns this).
```

## Common mistakes

- Escalating a rename or dead-code removal. **Fix:** anti-overlap guard 1 — that is `code-quality`, verdict `optimal`.
- Escalating "this might throw" with no better approach. **Fix:** anti-overlap guard 2 — that is `critical`, verdict `optimal`.
- Escalating a lateral style preference. **Fix:** rewrite-for-taste guard — a proposal must be materially better.
- Proposing a large-blast rewrite for a marginal win. **Fix:** the materiality bar's "worth the switch" test — verdict `optimal`.
