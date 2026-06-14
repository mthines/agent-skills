---
title: Confidence Gate
impact: HIGH
tags:
  - tests
  - confidence
  - quality-gate
---

# Confidence Gate

A wrong test fix corrupts the suite — the test stops asserting what it was
written to assert, and the regression it was guarding against can land silently.
The gate exists to make speculative fixes prove themselves before they touch
the test file.

The gate is non-negotiable.
Auto mode does not override it.

## When to run

After the verdict in [`verdicts.md`](./verdicts.md) lands on `test-bug` and the
plan artifact has been written (see [`../templates/plan-artifact.md`](../templates/plan-artifact.md)).
Before editing any file.

## How to run

Invoke the `confidence` skill in analysis mode:

```text
Skill("confidence", "analysis proposed fix: <one-line summary>; verdict: test-bug; surface: <surface-name>; risk: <test-only|prod-touch>")
```

Record the score in the plan artifact under `## Confidence`.

## Decision matrix

| Score | Action |
| --- | --- |
| ≥ 90 | Auto-apply. Continue to Phase 4 in [`../SKILL.md`](../SKILL.md). |
| 80–89 | Show the diff, ask the user once, apply on approval. |
| < 80 | Escalate. Do not write. |

## What the score is rating

The `confidence` skill is rating that the proposed fix fully solves the diagnosed
root cause — not that the verdict was correct.
If the verdict is wrong, no confidence score saves the run.
Re-classify before re-scoring.

## Risk tag guidance

The `risk:` tag in the prompt shapes the gate's strictness:

| Risk tag | When to use it | Effect on the gate |
| --- | --- | --- |
| `test-only` | Editing only test files and their direct fixtures | Slight downweight — a wrong test change may hide a real prod regression. |
| `prod-touch` | Editing production source files to fix a `prod-bug` or resolve a `test-bug` misclassification | Strong downweight — production behavior changes need stronger evidence. |

Tiebreaker: if a fix touches both a test file and a production fixture, use `test-only`.
If it touches a production module under `src/`, `lib/`, `apps/`, use `prod-touch`.

Rationale: a test change that weakens an assertion can silently re-open a regression
(blast radius: the project's integrity); a production change that misidentifies the root cause
ships incorrect behavior to users.
