# Why finding outcomes are scored by human action, and where the threshold comes from

The quality pass is report-only, and a later step may let some finding types send work back to the build.
That step needs to know which types humans actually act on, per type, before any of them is trusted to cost a rebuild.

## Ground truth is only what a human did

An outcome comes from the code a human merged, never from the agent's own confidence, severity, or verdict.
A finding the agent rated "High" that the reviewer ignored is `dismissed`; the rating is not evidence.
Self-assessed confidence is the signal this loop exists to replace: a pass that graded its own findings would measure how sure it sounds, not how often it is right.
The merge is the human act being read: the reviewer chose to merge with or without a change to the flagged symbol or lines.

The window is the PR's opening head to its final head, which holds the review's changes and the author's follow-ups.
It does not start at the finding's `head_sha`: on Lite the pass runs before `create-pr`'s local `review-loop` and `polish simplify`, which edit the same new files with no human involved.
A finding those pre-PR edits already touched is `unknown`, because no human decided it; its lines are mapped through the pre-PR edits before the human window is read.
Agent commits after the PR opened, made on a human's instruction (a review thread applied by `implement-suggestion`), count, because a human asked for them.
The script cannot tell who typed a commit, so a change an agent made on its own after the PR opened also reads as `acted`; that bias raises precision, so it is the error to watch for when a type first turns `eligible`.

## Why the classification is structural

The fingerprint hashes the type, the path, and the symbol, or the line when there is no symbol, so two UX findings of one rule in one file stay two events.
A line-anchored fp moves when the line moves between runs; that splits one finding into two across runs, which is rarer and cheaper than merging two findings into one.


`acted` needs the flagged symbol on a changed line, or a hunk within three lines of the flagged line.
A looser rule ("the file changed") would count every unrelated edit to a busy file as agreement; a stricter one (an exact line match) would miss the usual fix, which rewrites the neighbourhood.
A deleted path is `unknown`, not `acted`: deleting a new file is the canonical answer to `reuse`, but it is also how a reviewer throws out a whole approach, and the diff cannot tell the two apart.
`unknown` events are kept and counted so a type that is mostly undecidable is visible, but they never enter precision.

## Where 0.6 and n ≥ 10 come from

They are a starting point, not a research-backed value.
0.6 means a type sends work back only when humans act on it more often than not, with margin; n ≥ 10 keeps one PR's batch of findings from deciding a type.
Revisit both once a few types cross n = 30, and change them only in the script's `PRECISION_THRESHOLD` and `MIN_SAMPLE` constants, with this section updated in the same change.

## Why 180 days, not the bus default of 30

A type reaches ten decided events only across many PRs, and most repos merge a handful of agent PRs a month.
At 30 days a slow type would expire faster than it accumulates, and its precision would never become computable.
