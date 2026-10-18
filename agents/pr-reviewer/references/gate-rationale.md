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
