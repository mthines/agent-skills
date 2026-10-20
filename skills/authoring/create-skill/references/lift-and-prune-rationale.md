# Why skills are lift-checked and pruned

Rationale for [`rules/lift-check.md`](../rules/lift-check.md) and [`rules/prune-mode.md`](../rules/prune-mode.md).

## Lift, not output quality, is the measure

A skill can produce good output and still be worthless if the agent produces the same output without it.
Only the difference between the with-skill and without-skill runs on the same task shows what the skill contributes.
`claude plugin eval` runs every case in both arms in a clean sandbox (no user settings, `CLAUDE.md`, or other plugins), so that difference is not polluted by the author's own setup.

## Why a dummy control

Adding any text to the context can move a score, independent of what the text says.
Independent testing of widely starred skill packs found that most of them scored no better than a dummy file of the same length.
Comparing against a same-length, same-frontmatter dummy separates the skill's content from the effect of merely loading something.

## Why prune in this order

Usage data is free and settles the most cases: a skill that is never invoked costs its listing tokens on every turn and helps nothing.
Lift checks cost model runs, so they are spent only on skills that are actually used, highest context cost first.
A decoration verdict often means a few lines carry the effect, so trimming is tried before deletion.

## Why callers are migrated before deletion

Skills call each other through `Skill()`, and in this repo evals read skill files.
Deleting a skill without repointing its callers turns a cleanup into a broken orchestrator or a red eval gate.
