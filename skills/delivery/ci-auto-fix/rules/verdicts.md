---
title: Failure Verdicts
impact: HIGH
tags:
  - ci
  - classification
  - guardrails
---

# Failure Verdicts

Every failure gets exactly one verdict before any fix is drafted.
The verdict binds behavior — `flaky` and `unsure` escalate; the four `*-bug` verdicts continue to the confidence gate.

Do not skip this step.
Do not leave the verdict implicit.
Record it in the plan artifact (see [`../templates/plan-artifact.md`](../templates/plan-artifact.md)).

## Decision table

| Verdict | What it means | Action |
| --- | --- | --- |
| `code-bug` | Lint, type check, test failure, build error in the project's own code | Continue to the confidence gate ([`confidence-gate.md`](./confidence-gate.md)) |
| `workflow-bug` | Bad YAML, wrong action version, missing/misnamed secret, broken `needs:` graph | Continue to the confidence gate |
| `dep-bug` | Lockfile mismatch, missing package, version conflict, registry resolution failure | Continue to the confidence gate |
| `env-bug` | Wrong Node/Python/Deno version, missing system dependency, runner image regression | Continue to the confidence gate |
| `flaky` | Network timeout, rate limit, resource exhaustion, intermittent test with no code change | **Escalate.** Do not auto-retry — that masks the underlying instability. Report to the user with the log excerpt and stop. |
| `unsure` | Diagnostic confidence < 80%, or the failure could plausibly be in more than one bucket | **Escalate.** Surface what you saw and what you couldn't decide between. Stop. |

## Per-verdict notes

### `code-bug`

Read the relevant source files before proposing a fix.
Never propose a code change from the log alone.
If the failure is a test, classify whether the test or the production code is wrong (defer to a dedicated test-healing skill, e.g. `/test-healer`, when the local repo has it installed).

### `workflow-bug`

Read every workflow file in `.github/workflows/` before editing one.
Job dependencies (`needs:`), composite actions, and reusable workflows mean a one-file change can break a sibling job — see Phase 2 in [`../SKILL.md`](../SKILL.md).

### `dep-bug`

Reproduce the resolution failure locally.
A lockfile fix that works in CI but not locally usually means the runner is using a different Node/pnpm/Deno version (re-classify as `env-bug`).

### `env-bug`

Pin versions in the workflow, not in the project's runtime config, unless the project intentionally pins a version (e.g. `.nvmrc`, `.tool-versions`).
Bumping the runner image (`ubuntu-latest` → `ubuntu-24.04`) is a workflow edit, not a project edit.

### `flaky`

Escalate.
Do not auto-retry, do not add `continue-on-error: true`, do not add `retry-on-failure` to mask the issue.
The user owns the call to either rerun the workflow manually, mark the test as known-flaky in their tracking system, or invest in a fix.

### `unsure`

Escalate with three things:
1. The log excerpt that prevented classification.
2. The two (or more) verdicts that fit.
3. The disambiguating evidence you would need to decide.

Asking once is cheaper than a wrong fix that burns a CI run.
