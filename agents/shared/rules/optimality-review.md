---
title: Optimality review — is this the best approach (default on)
impact: HIGH
tags:
  - pr-reviewer
  - optimize-approach
  - optimality
  - better-approach
---

# Optimality review

The line-level rubrics (`code-quality`, `ux`, `critical`, lenses) and the holistic pass (`intent-match` + `system-fit`) all assume the change's *approach* is a given and check it locally.
None of them asks the design-level question: **is this the most optimal way to do it, and if not what is?**

This rule routes that question through `Skill("optimize-approach", "<report|apply>")`, which returns 0–2 structured proposals (or nothing when the approach is already optimal).
A proposal is not a comment. It keeps the gates that test whether the claim is true (`finding-grounding`, `verification-receipt`) and surfaces as a card in a dedicated report section — see § Where proposals surface and § Gates.

## Default-on, opt-out via `--no-optimize`

Optimality review runs on **every** invocation of `pr-reviewer` unless disabled, with a **quiet early-exit**: on a well-built change the skill returns nothing and the step is a silent no-op.
The token cost is real (a holistic trace on any suboptimal unit), but the value asymmetry is large — catching one genuinely-better approach is worth many silent runs.

The flag is `--no-optimize`. Mention it in the run announcement only when set.

## Trivial-skip set

Reuse the `TRIVIAL_SKIP` value evaluated at Step 1.7b — do not recompute it and do not restate its conditions here.
The conditions are defined once in `agents/shared/rules/holistic-review.md` § Trivial-skip set; `TRIVIAL_SKIP == true` skips the call (the heuristic, not the flag).
Skipping reports as `Optimality review: skipped (trivial diff).` in the Quality Gate summary.

## When to run (the call)

Step **2.4c** — after the holistic pass (2.4) and its targeted escalation (2.4b), and **before** Step 2.5 (dedupe), so optimality proposals participate in dedupe and can collide-and-win against a line-level finding on the same `(file, line)`.

**2.4c always runs `report` mode — read-only, no file mutation.** This is deliberate: mutating files mid-pipeline would invalidate the diff snapshot the later gates (and, in `pr-reviewer`, line-validity) read.

```
Skill("optimize-approach", "report")
  intent_summary: <from Step 1.3>
  diff: <full unified diff>
  changed_files: <from /tmp/pr-files.json or git>
  caller: "pr-reviewer"
  review_relation: "self" | "cross"
```

Whether a proposal is *applied* is decided by the **caller**, never by `pr-reviewer`:

| Caller | Relation | Apply? | Where |
| --- | --- | --- | --- |
| `pr-reviewer` | cross | no | Cross-review never rewrites someone else's PR — proposals surface as prose cards in the review body |
| `pr-reviewer` | self | no | The agent is read-only in both relations (`agents/pr-reviewer.md` § What this agent does not do); an auto-fix attempt there is a guard failure |
| `polish` (`optimize` mode) | self only | yes | The standalone approach-rewrite pass — see below |

## Apply (`polish optimize` — never the reviewer)

`pr-reviewer` runs `report` mode only and stops at the proposal.
Applying is a separate, explicitly-invoked pass on your own branch:

```
Skill("polish", "optimize")           # dispatches optimize-approach apply
Skill("optimize-approach", "apply")   # one proposal only, when invoked directly
```

The skill applies it behind its own `apply_safe` + `confidence(code) ≥ 90 %` gate, with a scoped check and revert-on-failure (see [`../../../skills/quality/optimize-approach/rules/apply-mode.md`](../../../skills/quality/optimize-approach/rules/apply-mode.md)).
A rewrite that is not `apply_safe`, fails the gate, or reverts stays a proposal — it is **not** force-applied.
A proposal that `pr-reviewer` surfaced and that you want applied goes through `implement-suggestion` like any other review finding.

## Where proposals surface

A proposal is a **design argument**, not a line-level nit.
Its record carries a full structured comparison (`report-mode.md § Proposal record`) and all of its value is in that comparison — a one-line headline, current vs. better approach, why-better, trade-off, evidence, blast radius.
Routing that through the inline comment stream is what made the lens ineffective: `comment-shape.md` allows ≤ 240 characters and ≤ 2 sentences, so a proposal was trimmed to a slogan or dropped outright.

Proposals therefore leave the pipeline through a **dedicated long-form surface**:

| Caller + Relation | Surface | Rendering |
| --- | --- | --- |
| `pr-reviewer` (either relation) | `Optimality review` section in the GitHub review body | One card per proposal from [`proposal.template.md`](../../../skills/quality/optimize-approach/templates/proposal.template.md) |
| `pr-reviewer` (either relation) | `Optimality Review` section of the Step 3 terminal report | The same card |
| `polish` (`optimize` mode) | The pass's own terminal output | The same card, plus the apply outcome |

Omit the section entirely when the skill returned no proposals — the quiet early-exit must stay quiet.
Never render a proposal as an inline comment.

### Framing (caller-aware)

The card is prose, so framing replaces category mapping:

| Relation | Framing | Blocks verdict? |
| --- | --- | --- |
| `self` (own PR) | Assert: "A better approach here is …" | no |
| `cross` (someone else's PR) | Ask: "Have you considered …?" — the reviewer has less context than the author | no |

An optimality proposal is **always non-blocking** — it never drives "Request changes", the same way `scope-creep` never does.
A rewrite applied later by `polish optimize` is recorded in that pass's own output as an approach change, not as a comment.

## Gates

Proposals keep the gates that test whether the claim is *true*, and skip the ones that only shape an inline comment.

**Still applied:**

1. **dedupe + consolidate (2.5)** — a proposal restating a line-level finding on the same `(file, line)` is deduped; the proposal wins the collision (broader context).
2. **finding-grounding (2.6)** — every backticked symbol in `evidence` must grep-resolve in the changed file or in a caller surfaced by the skill's O4 trace; an ungrounded proposal is dropped.
3. **verification-receipt (2.6b)** — a proposal making a behavioral claim ("this issues N queries per request") needs executed proof; a null result drops it.
4. **`analysis_confidence` ≥ 85** — enforced upstream by the skill; this is the confidence gate for proposals. The bar is deliberately high so only decision-ready proposals surface — a hedged sub-85 % "better way" is dropped, not softened into a question.

**Not applied:**

| Gate | Why exempt |
| --- | --- |
| `per-comment-confidence` (2.7) | Double-gating — see below |
| `comment-shape` (2.8) | Body content has no length limit; a 240-char cap on a ten-field record guarantees the loss |
| `conventional-comments` (2.9) | The card has its own structure; a category prefix on a section heading is noise |
| Placement caps (2.9b) | Body content consumes no inline slot; the skill's own cap of 2 proposals per run is the only quantity limit |

### Why not per-comment-confidence

`pr-reviewer` used to map every proposal to `question`, and its per-type table sets `question` at 90 %.
A proposal the skill had already validated at, say, 86 % `analysis_confidence` then had to clear an unrelated 90 % bar, computed by a scorer that never saw the O4 trace.
Two independent gates on one claim, the stricter of which is the less informed, is why the lens almost never reached the author.
One gate, owned by the analysis that produced the claim, is the correct design.
The card still prints `analysis_confidence`, so the reader weighs it directly.

## Blocking verdict

Optimality proposals never block. They emit `suggestion` / `question` findings only.
This is intentional and matches `holistic-review`'s treatment of `system-fit` and `scope-creep`: an approach preference, even a well-grounded one, is advisory — gating "Request changes" on it would let one debatable design call hard-block a correct change.

## Logging

Every report that carries a Quality Gate summary **must** render this block, in `pr-reviewer`'s terminal report and review-body diagnostics and in the `polish optimize` pass output:

```text
Optimality review (2.4c):
  Status:             ran | skipped (trivial diff) | skipped (--no-optimize) | skipped (incremental-quick) | skipped (skill not installed)
  Units judged:       <N>
  Optimal:            <O>
  Proposals:          <P> (cap 2)
  Applied:            <A>  (`polish optimize` only — always 0 under `pr-reviewer`)
  Withheld/reverted:  <W>
```

Emit the block **even when `P = 0`**.
A silent run and a skipped run are different outcomes, and without the block the reader cannot tell them apart — which is how an unwired lens goes unnoticed.
Only the `Optimality review` **section** is conditional on `P > 0`; the log block is unconditional.

A run that judged several units and emitted 0 proposals is healthy — most changes are already optimal enough.
A run that proposes on every unit is suspicious; spot-check the anti-overlap guards before trusting it.

## When optimize-approach is unavailable

If `Skill("optimize-approach", …)` is not installed, log once and continue without the step:

```text
Optimality review: skipped (optimize-approach skill not installed)
```

Do not block the run. Optimality review is an enhancement; the rest of the pipeline still produces useful comments.

## What this rule does not do

- It does not run the optimality analysis itself — it dispatches to the skill and routes the structured proposals.
- It does not set the blocker rules — those live in each agent's verdict step (and optimality never blocks).
- It does not apply anything in `pr-reviewer` — cross-review is report-only.
- It does not emit inline comments. Proposals surface only through the sections listed in § Where proposals surface.
- It does not re-run the trivial-skip computation — it reads the `TRIVIAL_SKIP` cache written at Step 1.7b.
