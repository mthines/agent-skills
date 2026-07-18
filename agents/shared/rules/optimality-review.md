---
title: Optimality review — is this the best approach (default on)
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - optimize-approach
  - optimality
  - better-approach
---

# Optimality review

The line-level rubrics (`code-quality`, `ux`, `critical`, lenses) and the holistic pass (`intent-match` + `system-fit`) all assume the change's *approach* is a given and check it locally.
None of them asks the design-level question: **is this the most optimal way to do it, and if not what is?**

This rule routes that question through `Skill("optimize-approach", "<report|apply>")`, which returns 0–2 structured proposals (or nothing when the approach is already optimal).
Proposals flow through the rest of the pipeline (`finding-grounding`, `per-comment-confidence`, `comment-shape`, `conventional-comments`) like any other finding.

## Default-on, opt-out via `--no-optimize`

Optimality review runs on **every** invocation of `reviewer` or `pr-reviewer` unless disabled, with a **quiet early-exit**: on a well-built change the skill returns nothing and the step is a silent no-op.
The token cost is real (a holistic trace on any suboptimal unit), but the value asymmetry is large — catching one genuinely-better approach is worth many silent runs.

The flag is `--no-optimize`. Mention it in the run announcement only when set.

## Trivial-skip set

Skip the call (not the flag — the heuristic) on the same trivial diffs `holistic-review` skips: pure whitespace / formatting, dependency-bump-only, test-only, and `< 10 lines changed` with no high-stakes path (`**/auth/**`, `**/billing/**`, `**/payments/**`, `**/migrations/**`, `**/infra/**`).
Reuse the heuristic already computed for `holistic-review` — do not recompute it.
Skipping reports as `Optimality review: skipped (trivial diff).` in the Quality Gate summary.

## When to run (the call)

Step **2.4c** — after the holistic pass (2.4) and its targeted escalation (2.4b), and **before** Step 2.5 (dedupe), so optimality proposals participate in dedupe and can collide-and-win against a line-level finding on the same `(file, line)`.

**2.4c always runs `report` mode — read-only, no file mutation.** This is deliberate: mutating files mid-pipeline would invalidate the diff snapshot the later gates (and, in `pr-reviewer`, line-validity) read.

```
Skill("optimize-approach", "report")
  intent_summary: <from Step 1.3>
  diff: <full unified diff>
  changed_files: <from /tmp/pr-files.json or git>
  caller: "reviewer" | "pr-reviewer"
```

The proposals join the pipeline like any other finding. Whether any is *applied* is decided later, per caller:

| Caller | Sub-mode | Apply? | Where |
| --- | --- | --- | --- |
| `pr-reviewer` | any | no | Cross-review never rewrites someone else's PR — proposals map to `question` |
| `reviewer` | Report Mode (`--report`) | no | No auto-fix in Report Mode |
| `reviewer` | Fix Mode / Self-Review | yes | Deferred to the reviewer's **Step 4 auto-fix phase** (see below) |

## Apply (reviewer Fix / Self-Review only — Step 4)

Applying happens in the reviewer's dedicated auto-fix phase, **after** the review pipeline has finished computing findings — never mid-pipeline.

For the highest-impact proposal flagged `apply_safe: true`, the reviewer invokes:

```
Skill("optimize-approach", "apply")   # one proposal only
```

The skill applies it behind its own `apply_safe` + `confidence(code) ≥ 90 %` gate, with a scoped check and revert-on-failure (see [`../../../skills/quality/optimize-approach/rules/apply-mode.md`](../../../skills/quality/optimize-approach/rules/apply-mode.md)).
A rewrite that is not `apply_safe`, fails the gate, or reverts stays a proposal — it is **not** force-applied.
An applied rewrite is recorded in the Step 4 auto-fix log as an approach change, not as a comment.

## Output mapping (caller-aware)

`optimize-approach` returns proposals with `axis` ∈ {codebase-fit, simplicity, performance, robustness} and `analysis_confidence`.
Map each to the calling agent's Conventional-Comments category:

| Caller | analysis_confidence | Category | Blocks verdict? |
| --- | --- | --- | --- |
| `reviewer` (own work) | ≥ 90 % | `suggestion` | no |
| `reviewer` | 70–89 % | `question` | no |
| `pr-reviewer` (cross-review) | any | `question` | no |

An applied rewrite (reviewer Fix / Self-Review) is reported in the auto-fix log as an approach change, not as a comment.
An optimality proposal is **always non-blocking** — it never drives "Request changes", the same way `scope-creep` never does.
Below 70 % analysis confidence the proposal is dropped upstream in the skill (the alternative is not understood well enough to state).

## Wiring into the rest of the pipeline

Optimality proposals are not exempt from the downstream gates:

1. **dedupe + consolidate** — proposals enter the same dedupe pass; on a `(file, line)` collision, the broader-context claim wins.
2. **finding-grounding** — every backticked symbol (util, pattern, caller) must grep-resolve in the changed file or a caller surfaced during the skill's O4 trace.
3. **per-comment-confidence** — `Skill("confidence", "code")` ≥ profile threshold, same as any finding.
4. **comment-shape** — ≤ 240 chars, ≤ 2 sentences; a proposal that needs more space is trimmed once or dropped and listed in the Quality Gate summary.

## Blocking verdict

Optimality proposals never block. They emit `suggestion` / `question` findings only.
This is intentional and matches `holistic-review`'s treatment of `system-fit` and `scope-creep`: an approach preference, even a well-grounded one, is advisory — gating "Request changes" on it would let one debatable design call hard-block a correct change.

## Logging

The Quality Gate summary reports:

```text
Optimality review (2.4c):
  Status:             ran | skipped (trivial diff) | skipped (--no-optimize)
  Units judged:       <N>
  Optimal:            <O>
  Proposals:          <P> (cap 2)
  Applied:            <A>  (reviewer Fix / Self-Review only)
  Withheld/reverted:  <W>
```

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
- It does not re-run the trivial-skip computation — it reuses `holistic-review`'s.
