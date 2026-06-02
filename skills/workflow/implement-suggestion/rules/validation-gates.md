---
title: Validation Gates — `/critical` then `/confidence` per Comment
impact: HIGH
tags:
  - validation
  - critical
  - confidence
  - gate
---

# Validation Gates

Phase 4 runs each `actionable` or `nit` comment through two gates in order.
The order matters: `/critical`'s adversarial findings must feed
`/confidence`'s evidence, never the reverse.

## Gate 1 — `/critical`

```
Skill("critical", "<mode>")
```

Pick `mode` per the comment:

| Comment shape                                                          | `mode`    |
| ---------------------------------------------------------------------- | --------- |
| Has a `suggestion` block or names a specific file:line edit             | `code`    |
| Pure prose feedback ("rethink this caching strategy")                   | `analysis` |
| References an architectural question                                    | `analysis` |

`/critical` returns findings tagged by severity:

| Severity     | Treatment in the matrix below                       |
| ------------ | --------------------------------------------------- |
| `Critical`   | **Overrides matrix → force `surface`.**             |
| `High`       | **Overrides matrix → force `surface`.**             |
| `Medium`     | Recorded in pack; does not override matrix.         |
| `Low`        | Recorded in pack; does not override matrix.         |

Capture the full finding text — the worker subagent reads it when crafting
the commit message and the Phase 7 report cites it.

## Gate 2 — `/confidence`

```
Skill("confidence", "analysis")
```

Inputs the gate sees:

- The original comment body, author, and `path:line` context.
- The surrounding code (read by the gate from the worktree).
- The `/critical` findings from Gate 1.
- The proposed edit (suggestion block, or the agent's inferred change).

`/confidence` returns a score in `[0, 100]`. Use the decision matrix below.

## Decision matrix

| `/confidence` score | `nit` comment | `actionable` comment |
| ------------------- | ------------- | -------------------- |
| ≥ 90%               | `apply`       | `apply`              |
| 80%–89%             | `surface`     | `apply`              |
| 70%–79%             | `surface`     | `surface`            |
| < 70%               | `skip`        | `skip`               |

Override: **any `Critical` or `High` finding from `/critical` forces `surface`** regardless of score.

## Why `nit` has a higher bar

Nits are explicitly low-priority — the reviewer signalled "don't block on
this". Auto-applying a nit at 80% confidence risks shipping a change the
reviewer didn't strongly want; surfacing it preserves user control. Above
90% the nit is essentially mechanical and safe to apply.

## Per-comment output

Record per comment in the pack:

```json
{
  "commentId": 4567890123,
  "decision": "apply" | "surface" | "skip",
  "criticalFindings": [
    { "severity": "Medium", "title": "...", "evidence": "..." }
  ],
  "confidenceScore": 87,
  "confidenceBreakdown": {
    "evidence": 92,
    "rootCause": 84,
    "fix": 85
  },
  "reason": "actionable @ 87% → apply",
  "proposedEdit": {
    "file": "src/billing/format.ts",
    "lineRange": [40, 44],
    "before": "...",
    "after": "..."
  }
}
```

`proposedEdit` is present only when `decision == "apply"`. It is the
literal patch the worker subagent will apply.

## Sequencing

Per-comment gates run **sequentially within a PR**. A comment's gate result
may inform whether subsequent comments still apply — e.g. if comment A
says "extract helper X" and comment B says "rename X to Y", A's decision
feeds B's evidence.

Across PRs, Phase 4 fans out — each PR's per-comment loop is independent.

## When `/critical` or `/confidence` fail

If `Skill("critical")` or `Skill("confidence")` errors out for a single
comment (transient, malformed input, etc.):

1. Record the failure in the pack with `decision: "surface"` and
   `reason: "gate failure: <error>"`.
2. Continue with the next comment — do not abort the PR's run.
3. Phase 7's report lists every gate-failure surface so the user can decide.

Never default to `apply` when a gate failed. The default on failure is
always `surface` — the human reads, the human decides.

## Override behavior summary

Three things can force a `surface` decision regardless of score:

1. **`/critical` finding at `Critical` or `High`** — non-removable.
2. **Gate failure** — non-removable.
3. **Ambiguous classification** in Phase 3 (deferred to surface) — Phase 4
   never sees these comments, but the pack still references them.
