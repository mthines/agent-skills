# Delta re-review

A re-review of a large PR used to read the whole PR again whenever one push was over 100 lines, added a file, or pushed cumulative churn past 150 lines.
The delta is what changed, so the delta is what the review buys information about.

## Why the whole-PR re-read was the cost

A later review of a PR costs about as much as the first and posts fewer findings, because the first review already read the unchanged code.
A 180-line push to a 563-line PR is the common shape: `D12` (over 100 lines) and `D4` (over 150 cumulative lines) both fire, and `deep` re-reads all 563 lines.
The run span did not record which trigger fired, so the split between size triggers and a missing state record was not measurable; `pr_review.triggers` and `pr_review.state_status` close that gap.

## The rule

[Delta scaling](../rules/depth-routing.md#delta-scaling) waives `D12` and `D13` on a re-review of a PR over 400 changed lines when nothing else fired, and routes `standard` over the delta.
The refresh counters stay: `D4` scales with the PR, and `D5` still sends the third incremental run to `deep`.

Bound on what a delta run cannot see: the holistic broad pass is skipped in every incremental mode, so cross-file interactions with untouched code are only re-checked at the next refresh.
The refresh arrives after at most `MAX_REFRESH_DELTA` (500) cumulative lines or three incremental runs, whichever comes first, and immediately on any risk trigger.
The constants `BIG_PR_LINES`, `BIG_PUSH_LINES`, `REFRESH_PR_FRACTION`, and `MAX_REFRESH_DELTA` are chosen, not measured; the span attributes are how a later change measures them.

## Why only a big PR

A PR of up to 400 changed lines is cheap to read again, and its first review already routes by size scaling.
A new file on a small PR keeps `D13`: it has no prior version and no consumers yet, so nothing else measures it.
An unknown PR size is treated as small.

## The alternative this beat

Raise `D12` and `D4` to a flat 400 and add no new input.
It is two constants, and it leaves the `finalize` and render path alone.
It lets a 200-line PR absorb 400 lines of churn, twice its own size, before the next whole-PR pass, and it still sends every push that adds a file to `deep`.
Scaling `D4` with the PR keeps the refresh proportional, and gating on PR size keeps the new-file rationale for the PRs where it still pays.

## What delta scaling does not do

It does not apply when no state record is passed: `D6` fires on every run then, because no prior `deep` pass is recorded, and the report says so in `RUN_ANOMALY`.
Read `pr_review.state_status` on the run span before expecting the saving: `none` means the automation is not passing `--state`.
