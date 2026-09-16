---
name: ci-auto-fix
description: >
  Diagnoses and fixes failing CI, verifies locally, pushes, and confirms the relevant
  checks pass on the resulting revision. Uses an evidence-gated mechanical
  path for narrow failures and deeper diagnosis for ambiguous or shared changes.
  Never weakens checks. Currently supports GitHub Actions through gh or GitHub
  MCP. Triggers on "CI is failing", "fix the CI", "the build is red",
  "auto-fix this PR's checks", or "/ci-auto-fix".
disable-model-invocation: false
argument-hint: '[<pr-url>|<run-id>]'
license: MIT
metadata:
  author: mthines
  version: '4.0.0'
  workflow_type: command
  tags: [ci, github-actions, auto-fix, evidence-gate, regression-detection]
---

# CI Auto-Fix

Find the cause, make the smallest justified fix, and verify CI on the resulting
revision. Investigation scales with uncertainty and blast radius; completion
checks apply to every path. Maximum four fix-push cycles per invocation.

Read [anti-patterns](./rules/anti-patterns.md) first. Load other references only
at the decision they support. Reuse evidence from a caller when its revision,
run attempt, and scope match; do not repeat discovery to satisfy phase labels.

## Phase 0 — Resolve access and target

Resolve GitHub access once using
[github-access](../../../agents/shared/rules/github-access.md). Commands below
show the `gh` path; use that reference's mapping for MCP and report capability gaps.

Accept a PR URL, Actions run URL/ID, or check-run ID. With no argument, resolve
the current branch's open PR; if none exists, look for a failed run on its current
SHA. Ask only if the target remains ambiguous. Do not choose an old failed run
when the current revision is already green. Resolve check-run IDs to their run;
do not assume check and workflow IDs are interchangeable.

Record repository, branch, PR (if any), baseline SHA, run IDs/attempts, and local
working-tree state. Verify that the checkout matches the target before editing.
For a fork, identify the head repository and push destination explicitly. Preserve
unrelated local changes; use an isolated worktree when needed. State the target.

## Phase 1 — Capture and group failures

List checks and jobs before fetching logs. Capture the complete baseline: failed,
passed, pending, skipped, and blocked jobs, including workflow and matrix identity.
For each distinct failing job, fetch logs once per run attempt, save them locally,
and extract the failing command, error, and enough surrounding context to explain
it. Expand excerpts if the cause remains unclear; do not dump entire logs into context.

Group matching failures by likely root cause. Inspect one representative of a
repeated signature, then confirm the other jobs share its command/environment;
a different runtime or signature deserves its own investigation. Record which
failures each proposed fix covers. Independent justified fixes may share a push;
do not serialize matrix duplicates into separate CI cycles.

## Phase 2 — Inspect the relevant surface

Start with the failed command, affected source/configuration, and the workflow
job that invokes it. Follow relevant `needs`, reusable workflows, composite
actions, caches, artifacts, runtime versions, and matrix inputs.

Expand to callers and sibling jobs when modifying shared configuration or when
failures suggest a common cause. Read all workflows only when the dependency
surface actually spans them or cannot yet be bounded. A source formatting fix
does not require unrelated workflow inspection.

## Phase 3 — Classify and choose a path

Record one [verdict](./rules/verdicts.md) per root-cause group. Classification
uncertainty calls for a targeted diagnostic step, not an immediate speculative fix.
An authorized `transient-infra` rerun goes directly to Phase 7 on the unchanged
SHA; skip edit/commit/push phases and do not consume a fix-push cycle.

**Mechanical path** requires all of the following:

- Logs identify the exact command and affected files, and inspection supports a
  single cause.
- The repository provides a deterministic correction (such as formatting), or
  the compiler error has a narrow correction with unambiguous intended behavior.
- No assertion, public API, runtime behavior, dependency selection, security
  boundary, or shared workflow behavior needs a judgment call.
- An appropriate local check can verify the correction.

Use a short evidence note in the transcript: cause, files, correction, and check.
No separate plan file or confidence-skill invocation is needed. Inspect the
resulting diff; a supposedly mechanical tool that changes broader behavior exits
this path. Snapshot regeneration and a compiler-silencing cast are not inherently
mechanical fixes.

**Diagnostic path** applies otherwise. Follow the
[evidence gate](./rules/confidence-gate.md) and record the hypothesis, supporting
and conflicting evidence, affected consumers, and verification in the compact
[plan](./templates/plan-artifact.md). Use a targeted reproduction or discriminating
check to resolve competing explanations before editing.

Any contradictory evidence, failed local verification, wider-than-expected diff,
or unexplained CI failure moves a mechanical fix into the diagnostic path.

**Optional memory:** check whether LoreKit `memory.*` tools are connected before
loading [self-improvement-loop](./rules/self-improvement-loop.md). If available,
query only the current failure signature and touched paths; reuse results until
the hypothesis or surface changes. Lessons never substitute for current evidence.

## Phase 4 — Apply the justified fix

Fix the cause in the appropriate surface: source, workflow, dependency constraint/
lockfile, or environment. Keep changes limited to the diagnosed cause. For tests,
establish whether the assertion or production behavior is wrong; preserve coverage.
Apply the evidence gate and anti-patterns to every path, including tool-generated
edits. Do not change unrelated failures just because their files are nearby.

## Phase 5 — Verify locally

Run the smallest check that can falsify the diagnosis, then the affected CI command
or equivalent scope before pushing. Broaden validation for shared callers,
platform/matrix differences, and changed behavior. Reuse still-valid results;
repeat checks when the fix, dependencies, environment, or rebased changes invalidate them.

A local failure returns to diagnosis. For CI-only conditions (runner permissions,
services, platform), document why reproduction is unavailable, validate what is
possible, and use one justified CI run as the missing verification. This exception
requires the diagnostic path; it cannot turn an untested guess into a mechanical fix.

## Phase 6 — Commit and push

Review the diff, stage only relevant files, and commit with a root-cause summary.
Record the exact fix commit and its parent. Fetch and rebase onto the target remote
branch before pushing; if changes arrive, inspect them and repeat invalidated
checks. Abort a conflicting rebase and report the conflicting files.

Push to the resolved head repository/branch. On a non-fast-forward rejection,
resync and retry once; never force-push. After a rebase, update the recorded fix
commit and baseline. Record the pushed SHA and increment the fix-push counter.

## Phase 7 — Verify CI on the pushed revision

Follow [CI verification](./rules/ci-verification.md). Monitor all relevant checks,
including the originally failing workflows and required PR checks. One successful
run is insufficient. Missing, pending, or inaccessible checks are not green.

Record bounded wait attempts and outcomes. Preserve full results locally; report
status changes and actionable errors rather than repeated watch output. If another
worker advances the branch, reconcile the new revision before declaring success.

## Phase 8 — Interpret the result

Use [regression detection](./rules/regression-detection.md) to distinguish an
unchanged failure, a newly exposed failure, unrelated breakage, and an introduced
regression. A new error signature alone does not prove the fix caused it.

Continue only with new evidence and remaining budget. Revert a demonstrated
regression using the recorded fix SHA, preserving others' commits. After four
fix-push cycles, two introduced regressions, or an unresolved diagnosis with no
useful next check, stop with the remaining evidence and next action.

## Phase 9 — Report

Report outcome (`green`, `escalated`, `regression-reverted`, or `max-iterations`),
target and final SHA, causes/verdicts, fixes, local verification (including gaps),
fix-push and wait counts, and CI links. Link a plan only if one was needed. On
failure, state what remains and the evidence/action needed to proceed.

Declare green only after the complete verification scope passes on the current
revision. Distinguish a scoped run-only success from all PR checks passing. With
memory connected, record supported outcomes through the optional lessons rule;
an escalation or revert alone does not prove a diagnosis.
