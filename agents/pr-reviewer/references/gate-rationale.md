# Why the gates are graded the way they are

Rationale for [`rules/gates.md`](../rules/gates.md). A run never needs this file; read it when
changing a gate's grading.

## Gate 2 (CI) is out of the verdict

**Gate 2 (CI) is informational, never part of the grade.** Red CI is a fact about the branch, not a
finding about the diff, and this agent neither diagnosed it nor can it tell a real regression from a
flaky job, an infrastructure quota, a check that does not run on this base branch, or a draft with no
workflow wired up — all four observed in practice. GitHub already blocks the merge on a required
check, and the orchestrators (`create-pr`, `review-loop`, `autonomous-workflow`) already own CI
convergence, so letting CI move this review's own verdict as well added no signal and mislabelled it:
`mthines/lorekit#490` led with `CI failing, 1 error, 2 warnings` and `Blocking: CI checks failing`,
which reads as *the reviewer found something* when it had not. The state is still reported in full —
see `CI_NOTE` in `Run` — and a red check that the *diff* demonstrably causes is a Gate 6 finding on
this reviewer's own evidence, where it blocks properly.

## Gate 3 grades by blocking and answered, not by the resolved flag alone

Reading the flag alone was the older, stricter rule, and it fails a PR for something the author
cannot fix: a bot's `nitpick:` nobody clicked Resolve on, a suggestion already declined
on-thread with a rationale, a finding fixed in a later commit whose thread this run had no
permission to resolve. Gate 3 already refuses to fail on a thread whose state it could not read,
for exactly that reason (*an unknown thread never fails it either*, below); grading by severity
applies the same principle to threads whose state it can read.

## An incomplete review caps Gate 6

Gate 6 reads PASS when the placed findings hold no blocker, and before this check it could not tell a review that looked and found nothing from one that never looked.
A deep run that skipped its holistic pass and its consolidation posted the same WARN with zero findings as a full review, and its only trace of the gap was the `Reach` row, which no verdict reader opens.

The ledger's step markers are the only machine evidence of what ran, and `prepare-review.mjs` already writes the plan they are measured against, so the check needs no new signal.
It caps instead of failing: the steps that did run still found or cleared what they found or cleared, and a missing marker can be a forgotten marker rather than skipped work.
It never lifts a FAIL, because a verified blocker stands whether or not the rest of the review ran.

The phrase `review incomplete` is the same on every surface (the Warnings reason, `RUN_ANOMALY`, and the CLI line) so a caller can match it without parsing the report: the aw `/goal` template treats it as not done.
The alternative of a fourth verdict value was rejected: it would change the `VERDICTS` contract every renderer, orchestrator, and eval label reads, for a state WARN plus a named reason already expresses.
