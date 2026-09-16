---
title: Failure Verdicts
impact: HIGH
tags: [ci, diagnosis]
---

# Failure verdicts

Assign one verdict per root-cause group, based on evidence rather than error wording.
A registry error may be a bad constraint or an outage; distinguish them before fixing.

| Verdict           | Evidence to seek                                                                        | Action                                                                      |
| ----------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `code-bug`        | Failing command plus relevant source/test behavior                                      | Mechanical path only if all entry criteria hold; otherwise diagnose         |
| `workflow-bug`    | Wrong job wiring, action inputs/version, permissions, or secret reference               | Inspect affected dependencies and shared callers; validate the workflow     |
| `dep-bug`         | Demonstrated version/lockfile conflict or missing dependency                            | Reproduce with the CI package-manager/runtime versions; verify installation |
| `env-bug`         | Runner/toolchain/service mismatch                                                       | Compare declared and actual environments; validate affected consumers       |
| `transient-infra` | Evidence of an external interruption, such as runner loss or a temporary service outage | One bounded failed-job rerun under the conditions below                     |
| `flaky`           | Intermittent application/test behavior without an established cause                     | Diagnose the instability; do not rerun until lucky                          |
| `unsure`          | Multiple plausible causes                                                               | Gather discriminating evidence; escalate if no useful next check remains    |

For `code-bug`, read source before proposing edits. A type assertion, snapshot
update, or changed expected result needs behavioral justification. Use a relevant
test-debugging skill only when its specialized workflow is needed.

For `workflow-bug`, follow reusable workflows/composite actions and their callers
when shared behavior changes. Verify secret names and permission requirements;
do not invent credentials or broaden permissions speculatively. Action/dependency
version changes need evidence of the specific incompatibility and a supported pin.

For `env-bug`, respect the project's declared runtime versions. Validate a proposed
runner/runtime change against all affected jobs; do not silently change project policy.

## Bounded infrastructure rerun

A timeout or HTTP error alone does not establish a transient external cause.
Corroborate with runner/service diagnostics or comparable attempts, and rule out a
deterministic configuration failure. Record the evidence and rerun the failed jobs
once on the same revision. Count a caller's rerun of those jobs toward this limit;
if prior rerun history is unknown, inspect it before triggering another.

Keep the original failure and new attempt in the report. The rerun uses the same
CI wait budget and does not reset fix-cycle limits. If it fails again, diagnose or
escalate; do not change code just to provoke another run. This exception never
applies to unexplained test assertions, races, or reproducible resource exhaustion.
