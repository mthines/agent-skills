---
title: Anti-Patterns
impact: HIGH
tags:
  - ci
  - guardrails
  - anti-patterns
---

# Anti-Patterns

The shortcuts this skill exists to prevent.
Every one of these makes CI green at the cost of correctness — they are rejected by contract, not by judgement.

If you find yourself reaching for any of these, the verdict in [`verdicts.md`](./verdicts.md) was wrong or the confidence gate in [`confidence-gate.md`](./confidence-gate.md) was bypassed.
Re-classify, do not justify.

## Hard refusals

| Anti-pattern | Why it is rejected |
| --- | --- |
| "Just retry the workflow" without diagnosis | `flaky` verdicts escalate. Auto-retry masks instability and re-bills the runner. |
| `continue-on-error: true` to unblock the merge | Hides the failure instead of fixing it. The next maintainer inherits a silent regression. |
| Adding `.skip` / `it.only` / `xit` to silence a failing test | Test deletion in disguise. Defer to a dedicated test-healing skill (e.g. `/test-healer`) when the failure is a real test. |
| Bumping an action to `@main` to see if it helps | Speculative. Requires verdict `workflow-bug` with evidence pointing at a known regression in the pinned version. |
| Pinning a new dependency version "because the resolver is angry" | Only allowed with verdict `dep-bug` AND a confidence-gated diff that names the conflict. |
| Stacking another fix on top after CI got worse | Rejected. [`regression-detection.md`](./regression-detection.md) requires reverting first. |
| `--no-verify` on the commit | Skips local hooks. Hooks fail for reasons; fix the reason. |
| `--force` push to recover from a bad fix | Rewrites shared history. Use `git revert` instead (see [`regression-detection.md`](./regression-detection.md)). |
| Disabling a lint rule or weakening a type to make the build pass | Weakens the project's invariants permanently to dodge a transient failure. |
| Removing a test, even temporarily, "to ship" | Loses the assertion. The fix is to make the test pass or escalate the diagnosis. |

## Soft refusals (require explicit user approval)

These are not hard-rejected, but they cannot be applied silently — surface them and ask once:

- Changing the runner image (`ubuntu-latest` → `ubuntu-24.04` or similar). Affects every job.
- Changing a major Node/Python/Deno version in the workflow. Affects every install step.
- Editing a reusable workflow or composite action under `.github/`. Cross-cuts every caller.
- Modifying `pnpm-lock.yaml` / `package-lock.json` outside of a `dep-bug` verdict.

## The shape of the trap

Every anti-pattern above shares the same shape: *make the red go away without understanding why it was red.*
The verdict + confidence-gate pair exists exactly to make that shape impossible to enter accidentally.
When the urge to take a shortcut appears, the urge is the signal — re-run [`verdicts.md`](./verdicts.md).
