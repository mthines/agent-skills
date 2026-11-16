# Criterion quality — why each test exists

A verify run is only as strong as its weakest criterion.
A run that passes every criterion proves the change works only when each criterion could have failed.
The five tests in [`rules/intent.md § Step 3b`](../rules/intent.md#step-3b--lint-every-criterion-and-map-the-surfaces) each close one way a criterion passes without proving anything.

## The five tests

| Test | Failure it prevents |
| --- | --- |
| Observable | A criterion nobody can observe becomes a verdict nobody can check, and the run reports `pass` on a guess |
| On the changed target | A sibling surface passes while the changed one stays unchecked; the report reads `✅` over a path no run exercised |
| Fails on base | The criterion passes before the change, so a green run does not distinguish the change from its absence |
| Reachable on this environment | The run finds a missing flag, seed record, or backend change at run time and then substitutes another surface to stay green |
| Not by construction | Reading the source satisfies it, so no run of the behavior is needed to pass |

## Why "fails on base" has four weak shapes

- **Absence only.** "No X is shown" is true wherever the feature does not exist, including before the change and on any backend that never offered it.
- **Attribute, not effect.** An `aria-pressed` or class value can change while the behavior stays wrong, so the criterion passes through the defect.
- **State reached, never checked.** A dialog visible after a key press says the key was handled, not that the selection moved.
- **Either / or.** A criterion that accepts two outcomes passes whichever one the defect produces.

A removal is the one legitimate absence.
It is paired with the removal's observable effect, such as a request that stops firing, because the UI alone cannot tell "removed" from "never rendered".

## Why substitution caps the verdict

A run that cannot reach the named surface and checks a sibling one is doing useful work, so the sibling result is kept.
Reporting it as the named criterion's pass is the failure: a reviewer reads `✅` and skips the surface that stayed unchecked.
The same reasoning covers unit tests, a scratch branch carrying commits the PR lacks, fixture data standing in for a live source, and a telemetry receipt that returned `ambiguous` or `null`.
Each is evidence of something else, so each is named under `witnesses` and caps the run at `⚠️`.

## Why the headline copies the receipt

A per-AC rollup and a receipt can disagree.
Re-deriving the telemetry word from the per-AC lines lets a missing signal turn into `confirms`.
The receipt is the witness's own word, so the report copies it.

## Why the lint covers derived criteria

Most runs write their own criteria from the PR and ticket, so the weak shapes enter at Step 3, not in a copied brief.
A brief's criterion keeps its ID and text because the IDs tie the brief, `checks.yaml`, the specs, and the report together; a failed test on it becomes a finding and a stronger probe beside it.

## Why the coverage table exists

A criterion list says what the run checks, not what the change touches.
The table maps each changed surface to a criterion or to a stated reason, so a performance, security, or event claim that only a UI screenshot "covers" shows as a gap.

## Alternatives rejected

- **A required `**Before:**` field on every spec.** The intent-spec grammar is owned by `autonomous-workflow`'s `templates/intent-spec.md.template`, and a new field changes every runner that parses it. The `(base: …)` ending on `**Changed:**` carries the same information in an existing field.
- **Running the criterion on the base build.** It is the strongest check, and most targets have no base to run against. The author states base behavior from the diff instead, and a run with a base available may confirm it.
- **Capping every run at `⚠️` when telemetry is `null`.** Sandboxes that cannot export telemetry would never reach `✅`. The cap applies to a `telemetry:` AC that no receipt confirmed, which is the claim that went unchecked.
