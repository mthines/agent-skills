---
title: Consultative Completeness — Pressure-Test Whether It Is Thought Through
impact: HIGH
tags:
  - completeness
  - non-goals
  - success-criteria
  - anti-overlap
---

# Consultative Completeness

The "is it thought-through" half of the interview.
A request can be perfectly clear about *what* the user wants and still be under-thought — missing its non-goals, its edge cases, or a definition of done.
This rule is the checklist Phase 2 enumerates against and Phase 3 confirms.
It is consultative, not adversarial: it surfaces what a good engineer would raise in a scoping conversation, then stops.

## The completeness checklist

Walk every row. For each, either the request already answers it (note the answer) or it becomes a Phase 2 unknown.

| Dimension        | The question to resolve                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| Intent           | What outcome does the user actually want — the job, not the feature request?    |
| Non-goals        | What is explicitly *out* of scope? What should this change deliberately not do? |
| Success criteria | How do we know it works? What is observably true when it is done?               |
| Edge cases       | Empty / null / large / concurrent / error inputs; the unhappy paths.            |
| Constraints      | Performance, compatibility, security, platform, governing-doc rules it must honor. |
| Dependencies     | What must exist first? What does this block or get blocked by?                  |
| Reversibility    | If we guess wrong, how expensive is the correction? (Feeds the `blocking` test.) |

Non-goals and success criteria are the two most-skipped and highest-value rows — always resolve them.

## Anti-overlap — stay in your lane

This skill is convergent and pre-plan. It does not do these neighbors' jobs:

| Neighbor      | Their job                                                        | This skill's boundary                                                    |
| ------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `/ideate`     | Diverge — generate multiple solution options.                   | Converge — pin the one scope. If the user needs options, point to `/ideate`. |
| `/critical`   | Adversarially red-team an existing plan or change.              | Pressure-test the *request's* completeness, before a plan exists. Deep failure-mode analysis waits for `/critical` post-plan. |
| `/confidence` | Score readiness on a rubric.                                    | Elicit the inputs a score would need. Do not emit a percentage.          |
| `holistic-analysis` | Trace an execution path to root-cause a failure.          | Locate affected areas for grounding, not a full end-to-end trace.        |

Surface completeness gaps as questions or recorded assumptions. Do not escalate a gap into a full adversarial review — hand that to `/critical` once there is a plan to attack.

## Examples

### Good — completeness surfaced

```text
Request: "Add a retry to the PR poller."
Completeness pass:
- Non-goals: not changing the 90s cadence, not adding backoff config UI. (confirm)
- Success criteria: a transient gh error no longer flips a cached pr-merged to error. (confirm)
- Edge case: what if gh is uninstalled — retry or fall through to JSONL status? (blocking)
```

### Bad — over-reaching into /critical

```text
Request: "Add a retry to the PR poller."
Skill output: a 12-point pre-mortem on race conditions, blast radius, and rollback...
Fix: that is /critical's job, and it needs a plan. Here, ask the one blocking edge case and move on.
```

## Common mistakes

- Skipping non-goals. **Fix:** always resolve what the change should *not* do — it prevents scope creep downstream.
- Turning completeness into an adversarial audit. **Fix:** raise gaps, then stop; `/critical` owns the pre-mortem.
- Inventing edge cases the request rules out. **Fix:** ground edge cases in the researched code paths, not hypotheticals.
