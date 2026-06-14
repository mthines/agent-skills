---
title: Confidence Gate
impact: HIGH
tags:
  - ci
  - confidence
  - quality-gate
---

# Confidence Gate

A wrong CI fix burns a full workflow run to discover the mistake — much more expensive than asking once.
The gate exists to make speculative fixes pay for themselves before they cost a runner.

The gate is non-negotiable.
Auto mode does not override it.

## When to run

After the verdict in [`verdicts.md`](./verdicts.md) lands on a `*-bug` (continue) outcome and the plan artifact has been written (see [`../templates/plan-artifact.md`](../templates/plan-artifact.md)).
Before editing any file.

## How to run

Invoke the `confidence` skill in analysis mode:

```text
Skill("confidence", "analyze proposed fix: <one-line summary>; verdict: <code-bug|workflow-bug|dep-bug|env-bug>; surface: ci; risk: <workflow-touch|prod-code-touch|lockfile-touch>")
```

Record the score in the plan artifact under `## Confidence`.

## Decision matrix

| Score | Action |
| --- | --- |
| ≥ 90 | Auto-apply. Continue to Step 4 in [`../SKILL.md`](../SKILL.md). |
| 80–89 | Show the diff, ask the user once, apply on approval. |
| < 80 | Escalate. Do not write. |

## What the score is rating

The `confidence` skill is rating that the proposed fix fully solves the diagnosed root cause — not that the verdict was correct.
If the verdict is wrong, no confidence score saves the run.
Re-classify before re-scoring.

## Risk tag guidance

The `risk:` tag in the prompt shapes the gate's strictness:

| Risk tag | When to use it | Effect on the gate |
| --- | --- | --- |
| `workflow-touch` | Editing files under `.github/workflows/` | Slight downweight — workflow changes affect every future run. |
| `prod-code-touch` | Editing source under `src/`, `apps/`, `libs/`, etc. | Strong downweight — production behavior changes need stronger evidence. |
| `lockfile-touch` | Editing `pnpm-lock.yaml`, `package-lock.json`, `Cargo.lock`, etc. | Slight downweight — a wrong pin reproduces in every environment. |

Pick the dominant risk if the fix touches multiple surfaces.
Do not stack risk tags.
