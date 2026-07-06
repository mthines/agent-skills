---
title: Review outcomes — shared candidate/outcome bus
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - implement-suggestion
  - self-improvement
  - outcome-bus
  - resolution-rate
---

# Review outcomes

This file owns the **shared candidate/outcome bus** for the reviewer pipeline.
It is the single source of truth for the bus schema, fingerprint reuse, TTL, consolidation cadence, and provenance rules.
`outcome-learning.md` owns the promotion decision that consumes this bus — cross-reference it for the full promotion mechanics.

The bus mirrors Bugbot's "write cheap candidates, promote on accumulated signal" model:
outcomes are appended cheaply by `implement-suggestion` after each comment is processed, and promotion happens at consolidation time — not at write time.
This separates the high-frequency write path (per-comment, per-PR) from the low-frequency read path (promotion/consolidation), keeping per-review context costs near zero.

---

## Scope

`review-outcomes` is a `persistent-memory` scope with two tiers:

| Tier | Path | When written | When read |
| --- | --- | --- | --- |
| `home` | `~/.agent-memory/review-outcomes/` | Default — every `implement-suggestion` run | At promotion/consolidation time only |
| `project-shared` | `<repo>/memory/review-outcomes/` | Opt-in — when the directory has been created by the team | At promotion/consolidation time only |

The `review-outcomes` scope is **volatile**: every entry carries a TTL of **30 days**.
Unpromoted candidates that expire are pruned at consolidation time without review.
30 days is the default; repositories with faster feedback loops may lower it via a `memory/review-outcomes/CONFIG.md` file.

---

## Outcome record schema

Each entry appended to `review-outcomes` carries:

```json
{
  "fingerprint": "<category>:<claim-gist>:<code-pattern>",
  "verdict": "applied | rejected-at-validation | deferred | reverted-after-ci",
  "reason": "<one-line summary of why this verdict was reached>",
  "source": "our-reviewer | our-pr-reviewer | external-bot | human",
  "pr": "<owner>/<repo>#<n>",
  "timestamp": "<ISO 8601 UTC>"
}
```

### Verdict mapping

| Verdict | Meaning | Signal strength |
| --- | --- | --- |
| `applied` | Comment passed `/critical` + `/confidence`, patch landed | Strong positive — this class of finding gets acted on |
| `rejected-at-validation` | Comment failed `/critical` (Must-fix) or `/confidence` gate | Strong negative — this class of finding is over-flagged or mis-framed |
| `deferred` | Gate cleared but the change was scoped out or deferred for later | Weak — merit exists but framing or timing was off |
| `reverted-after-ci` | Patch landed but reverted after CI failure traced to it | Negative — the finding produced a net-harmful change |

The verdict is derived from `implement-suggestion`'s existing per-comment `/critical` + `/confidence` result.
Do not recompute it — reuse the result already in context.

### Source inference heuristic

Infer `source` from the review comment author login:

| Author pattern | Source |
| --- | --- |
| Current user's own `reviewer` / `pr-reviewer` agent session | `our-reviewer` or `our-pr-reviewer` |
| `claude[bot]`, `anthropic-bot`, or session-identified as this agent | `our-reviewer` |
| `coderabbitai[bot]`, `github-copilot[bot]`, any `*[bot]` suffix not above | `external-bot` |
| Human login (no `[bot]` suffix, not the current user) | `human` |

When the source is ambiguous, default to `external-bot` and log the uncertainty in `reason`.

---

## Fingerprint reuse

The `fingerprint` field MUST reuse the 2.5b fingerprint from `prior-comment-awareness.md`:

```
fingerprint = category + ":" + claim-gist + ":" + code-pattern
```

Where:
- `category` = the Conventional Comments prefix (e.g. `suggestion`, `issue`, `nitpick`).
- `claim-gist` = a 3–6 word distillation of the finding's claim (e.g. `missing-null-check-before-access`).
- `code-pattern` = a stable structural descriptor of the code shape being flagged (e.g. `optional-chaining-absent`, `async-await-missing-try-catch`).

The fingerprint must NOT use raw `file:line` coordinates — those drift across commits and produce false uniqueness.
The bus and the dedup set in `prior-comment-awareness.md` MUST fingerprint identically so that a dismissed comment is correctly correlated with its outcome record.
`prior-comment-awareness.md` is the authoritative definition of the fingerprint formula; this file only mandates reuse.

---

## Read discipline

The candidate bus is consumed ONLY at promotion/consolidation time.
It MUST NOT be loaded into the per-review lesson read (Step 0.7 in each agent).

Rationale: each review run loads `reviewer-lessons` at Step 0.7 — the small, promoted, high-signal lesson set.
Loading the full candidate bus per review would add O(N×30days) volatile records to every review context, degrading performance without improving signal quality.
Promotion acts as the quality gate that keeps `reviewer-lessons` small and high-fidelity.

The Step 0.7 read pattern for each agent remains:

```
Skill("persistent-memory", "read reviewer-lessons --tier home")
if [ -f memory/reviewer-lessons/INDEX.md ]; then
  Skill("persistent-memory", "read reviewer-lessons --tier project-shared")
fi
```

`review-outcomes` is NOT added to this call.

---

## Promotion rule

When a fingerprint class accumulates **≥ 3 concordant verdicts** (same-direction agreements — either all positive or all negative), the bus promotes to an active lesson:

| Direction | Promotion action |
| --- | --- |
| ≥ 3 `applied` verdicts for the same fingerprint | Promote to `reviewer-lessons` as a positive detection lesson — reinforce this finding class |
| ≥ 3 `rejected-at-validation` verdicts for the same fingerprint | Promote as a calibration candidate — emit a `filters:` / confidence-threshold entry in `review-config.md` or `reviewer-lessons` |
| ≥ 3 `reverted-after-ci` verdicts | Promote as a hard-negative lesson — add to the `filters:` suppression list |
| Mixed direction (no ≥ 3 concordant) | No promotion; keep accumulating |

The default threshold is 3 concordant verdicts.
Repositories with higher signal volume may lower this to 2 via `memory/review-outcomes/CONFIG.md`.

Cross-reference `outcome-learning.md` for the full promotion decision procedure — this file owns the threshold and directionality; `outcome-learning.md` owns the mechanics of writing the promoted lesson.

---

## Consolidation cadence

Consolidation prunes the bus and triggers promotion checks.
Three triggers, in priority order:

1. **Volatile TTL auto-expiry** — entries older than 30 days are pruned automatically by `persistent-memory consolidate`.
   No agent action needed; the store handles this passively.

2. **Opportunistic consolidation** — when the `review-outcomes` INDEX exceeds **180 lines**, invoke immediately after any write:

   ```
   Skill("persistent-memory", "consolidate review-outcomes --tier home --auto")
   # Project-shared, if opted in:
   if [ -f memory/review-outcomes/INDEX.md ]; then
     Skill("persistent-memory", "consolidate review-outcomes --tier project-shared --auto")
   fi
   ```

   This prunes expired and low-confidence entries and surfaces promotion candidates.

3. **Manual invocation** — `Skill("persistent-memory", "consolidate review-outcomes")` on demand for retrospective audits or before a team review session.

No new infrastructure or cron job is needed.
All three triggers use the existing `persistent-memory consolidate` operation.

---

## Provenance honesty

Mixed-source records are valid for codebase/user calibration (e.g. "in this repo, defensive-null-check findings get rejected 4 out of 5 times across all reviewer types").

Hard rule: **accuracy scorecards MUST filter by `source`** before drawing precision conclusions.
Never present mixed-source data as the precision of `our-reviewer` or `our-pr-reviewer` specifically.

Example of a correct provenance-filtered summary:

```
our-reviewer null-check findings: 8 applied / 2 rejected (80% resolution rate)
external-bot null-check findings: 3 applied / 6 rejected (33% resolution rate)
```

Do NOT collapse these into "11 applied / 8 rejected (58% resolution rate)" and attribute it to this agent's precision.

---

## Graceful degradation

If `implement-suggestion` is not installed or does not emit outcome records, no records reach the bus.
The reviewers fall back to the `outcome-learning.md` conservative write path from the gh-api resolution signals (signals a/b/c) — nothing breaks.
Learning is slower but the pipeline is not blocked.

If `persistent-memory` is absent, the entire bus is a no-op — no writes, no reads, no promotion.
All review runs continue normally.

The bus is an optional enrichment, not a hard dependency.

---

## What this file does not do

- Define the promotion decision mechanics — that is `outcome-learning.md`.
- Define the per-review lesson read pattern — that is `reviewer.md` / `pr-reviewer.md` Step 0.7.
- Define the fingerprint formula authoritatively — that is `prior-comment-awareness.md` (Step 2.5b).
  This file only mandates reuse of the same formula.
- Replace the `reviewer-lessons` scope — `review-outcomes` is a volatile intake bus; promoted lessons land in `reviewer-lessons`.
