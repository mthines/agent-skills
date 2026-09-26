# Dispatch topology (Phase D/E) — driven by the budget, never model discretion

This rule owns *how* the single-dispatch `pr-reviewer` agent itself runs Phase D (finders) and
Phase E (verification) when it holds `Task` for further nested dispatch — a decision the agent body
used to leave to in-the-moment judgment. That freedom was measured, not assumed: an A/B dry run of
two arms reviewing the same PR at the same commit found the arm that ran `intent`, `standards`, and
`quality` in-context missed the best-corroborated bug in the diff, while the arm that ran them as
sub-agents caught it — same rubric, same finders, same verifier, different topology, different
outcome. The fix is to stop treating topology as a free variable.

The variable it now reads from is the **thoroughness budget** —
[`depth-routing.md § Thoroughness budget`](./depth-routing.md#thoroughness-budget) owns the
continuous 0–1 knob and the breakpoints; [`route-depth.mjs`](../scripts/route-depth.mjs)'s
`resolveBudget(i)` is its pure executable form, the same routing-vs-execution split
`depth-routing.md`/`route-depth.mjs` already use for tier selection. This file governs only what a
budget's `topology` field *means in practice* — nothing here hard-codes a tier's topology, because
there is no longer a fixed per-tier table to hard-code: `resolveBudget()` is what decides.

This is **not** a restatement of [`skills/quality/pr-review/SKILL.md`](../../../skills/quality/pr-review/SKILL.md)'s
`--fanout` orchestration, which already prescribes its own Steps c/e explicitly for that opt-in flag.
It governs the *ordinary* single-dispatch review (`/pr-review`, or `Task(subagent_type="pr-reviewer", …)`
with no `--fanout`) on a harness where that one dispatch can itself still hold `Task` and fan out
further. The two independently converge on a similar shape because this file's design follows that
one's precedent by reference, not by copy.

`finders.md` and `finding-verifier.md` stay byte-identical — this file is orchestration, not rubric.
Neither finder candidates nor verifier verdicts change shape; only *how many dispatches produce them,
and in what grouping* is prescribed here.

## `PR_REVIEW_MAX_PARALLEL`

The concurrency cap for this pipeline is **6** sub-agent dispatches per message.
Never put two candidates sharing a `path` in the same verifier dispatch.
That is the same rule `skills/quality/pr-review/SKILL.md` Step e states for `--fanout`, restated here
because it is load-bearing for the single-dispatch path too: batching same-path candidates together
is the shared-summary problem `finders.md`'s independence rule forbids at the finder stage, moved one
step downstream, and it makes the verifier quieter on each claim in the batch instead of adversarial
on one.

## Packing — how units become dispatches

A/B round 2 measured wall-clock and tokens as driven by **sub-agent count**: every dispatch pays a
base of roughly 110–160k tokens before it reads a line of the diff, and round 2's arms ran 22
(`t = 0.8`) and 33 (`t = 1.0`) sub-agents.
[`plan-dispatch.mjs`](../scripts/plan-dispatch.mjs) is the executable form of the grouping below;
never group by hand.

| Unit | Dispatches | Why |
| --- | --- | --- |
| each active finder | one each | A/B round 1: the arm that ran `intent`/`standards`/`quality` in one context missed the best-corroborated bug. |
| each `correctness` vote | one each | Diversify-then-vote needs each vote in its own context, or it is one opinion counted `N` times. |
| holistic broad pass, optimality, measurability | **one lens-bundle dispatch** for whichever of the three are active | The three lenses read the same whole-change context and none reads another's output, so separate contexts buy nothing. |
| standards-conformance lens | one, never in the bundle | `SKILL.md` Step c: the lens and the `standards` finder are two separate dispatches. |
| verification | one per batch of at most **`VERIFY_BATCH_MAX` (8)** candidates, no two sharing a `path` | One dispatch per candidate paid the full base for each verdict. |

Plan the verification batches from the deduped candidates, then dispatch one verifier per batch:

```bash
node agents/pr-reviewer/scripts/plan-dispatch.mjs --verifier-batches <deduped-candidates.json>
```

It prints each batch's candidate indexes and paths, plus the messages to send them in.
The batch count is `max(⌈V / 8⌉, largest same-path group)`, so a file carrying many candidates still
gets one dispatch per candidate on it.
A batched verifier judges each candidate as if it were the only one: it writes one verdict per
candidate, in the order given, and never lets one candidate's evidence or verdict inform another's.
The expected count per thoroughness band is
[`depth-routing.md § Expected sub-agents per band`](./depth-routing.md#expected-sub-agents-per-band).

**Messages, queueing, and no re-dispatch.**

1. A message carries at most `PR_REVIEW_MAX_PARALLEL` (6) dispatches.
   Units beyond the cap wait in the queue `plan-dispatch.mjs` printed.
2. Send the next message only after every dispatch in the current one has returned.
   Phase D (finders, the lens bundle, the standards lens) goes first; Phase E (verifier batches)
   starts after dedupe, because its input is Phase D's output.
3. Dispatch each unit exactly once.
   A unit that returned a readable output path is done and is never re-dispatched.
4. The only second dispatch of a unit is one retry when it returned no readable output file.
   A second failure is recorded as a `RUN_ANOMALY` naming the unit, never retried a third time.
   Step f's one shape-repair round in `SKILL.md` is a separate, already-bounded case.

```text
# correct: 12 Phase D units at a cap of 6
message 1: correctness#1..#5, consumer-impact    → wait for all 6
message 2: dependency, intent, standards, quality, lens-bundle, standards-conformance

# incorrect: 12 dispatches in one message, then re-dispatching the ones the harness queued
message 1: all 12 → 4 come back late → dispatch those 4 again
```

## Reading a budget into dispatch

Bind the budget once, right after `DEPTH_TIER` — `resolveBudget({ thoroughness, routedTier:
DEPTH_TIER, shape: DELTA_SHAPES, dispatchAvailable: <Task held?> })` — and every downstream step
reads it, never re-derives it:

- **`budget.finders`** — which of the six finders are active at all (`correctness`, `intent`,
  `quality` always are; `consumer-impact` / `dependency` / `standards` activate together once
  thoroughness clears the mid breakpoint). Skip an inactive finder exactly as `finders.md`'s own
  availability table already instructs; nothing here changes *which* finders exist, only whether
  each one runs this pass.
- **`budget.finderScope`** — `"delta"` vs `"all"` for `consumer-impact` and `standards`, same
  meaning `pr-reviewer.md`'s Step 2.4d/2.4e scope language already uses.
- **`budget.correctnessVotes`** — `1`, `3`, or `5`. `1` means a single pass with `votes` omitted.
  `3`/`5` mean `N` diversify-then-vote sub-agents over permuted file order — see below.
- **`budget.topology`** — `"in-context"` or `"parallel"`. This is the field that replaces the old
  fixed per-tier table: `"parallel"` means every active finder (correctness's `N` votes included)
  dispatches as its own sub-agent, in as few messages as the cap allows (see *Packing* above);
  `"in-context"` means every active finder runs
  sequentially in the orchestrator's own turn, no sub-agent dispatch, `votes` always `1`. `budget`
  already folds `dispatchAvailable` into this field — a caller never checks `Task` separately.
- **`budget.maxVerificationTier`** — the ceiling on `verify-behavior`'s Tier 1–3 evidence ladder a
  verifier dispatch may reach for this run (`finding-verifier.md`'s own per-candidate judgment still
  decides whether a given candidate needs it).
- **`budget.holisticEscalationCap`** — replaces the flat "cap 10" / "cap 3" language at 2.4b with
  `budget.holisticEscalationCap` directly; `2.4b`'s own incremental-mode gate (`ESCALATE_IN_INCREMENTAL`)
  is unchanged and still decides *whether* 2.4b runs at all in incremental mode.
- **`budget.optimalityLens`** / **`budget.measurabilityLens`** — replace the flat `DEPTH_TIER ==
  "deep"` / `DEPTH_TIER != "quick"` gates at 2.4c/2.4e with these booleans directly.
  Under `"parallel"`, the active ones and the holistic broad pass (`budget.holisticBroadPass`) run
  together in **one lens-bundle dispatch** that writes each lens's output separately; the
  standards-conformance lens is its own dispatch (see *Packing* above).

**`prepare-review.mjs` cannot know whether the agent reading `context.json` holds `Task`**, so the
`budget` it writes there always assumes `dispatchAvailable: true`. The agent re-derives the real
value itself: `topology = <Task held?> ? context.budget.topology : "in-context"`. Every other field
on `budget` (finders, scope, votes, verifier tier, the two lens booleans, the escalation cap) is
unaffected by dispatch availability and is read straight off `context.json`.

**Verification dispatch, when `budget.topology == "parallel"`:** one verifier per batch that
`plan-dispatch.mjs --verifier-batches` planned — at most `VERIFY_BATCH_MAX` (8) candidates, no two
sharing a `path` — sent at most `PR_REVIEW_MAX_PARALLEL` (6) per message.
**When `budget.topology == "in-context"`:** sequential, in the orchestrator's own turn.

**No-dispatch fallback is a degrade, not a silent equivalence — name it.** `resolveBudget()` already
returns `topology: "in-context"` whenever `dispatchAvailable` is `false`, whatever thoroughness
requested — it never silently reports the parallel shape it could not run. When that happened on a
run whose thoroughness would otherwise have crossed the parallel breakpoint (0.4), set:

```text
RUN_ANOMALY: no sub-agent dispatch available — finders and verification ran in-context, serially,
at effective thoroughness <t>, instead of the parallel topology that value would otherwise dispatch
```

This is the same `RUN_ANOMALY` slot every other capability cap in this pipeline uses
([`report-rendering.md § Run slots`](./report-rendering.md)) — never a quiet downgrade a reader has
to infer from a shorter run.

## Diversify then vote (moved here from the agent body)

The correctness finder runs as **`budget.correctnessVotes`** sub-agents over the same hunks in
**permuted file order** whenever that value is `> 1` (`3` at deep's default thoroughness, `5` at the
ceiling — `--effort high` or an explicit `thoroughness: 1`), and a candidate corroborated at the
same `(path, line ± 3)` and defect class by ≥ 2 of them carries `votes`. Permuting the order matters
because a single pass over a long diff attends unevenly and the tail gets less. At
`budget.correctnessVotes == 1` (below the deep breakpoint, or `budget.topology == "in-context"`) the
finder runs once and `votes` is omitted — not a degraded mode to apologize for: the verifier is a
genuine independent check, and voting amplifies it rather than substituting for it.

## Worker prompts

Every sub-agent this topology dispatches — each finder in Phase D, each verifier in Phase E — gets
the **same worker preamble** `skills/quality/pr-review/SKILL.md`'s `--fanout` orchestration already
defines, reused verbatim by reference rather than restated here:
[`skills/quality/pr-review/SKILL.md § Worker preamble`](../../../skills/quality/pr-review/SKILL.md#worker-preamble--every-dispatch-in-steps-c-e-and-f).
It tells the worker to read only the files it was handed by absolute path, never to read
`agents/pr-reviewer.md` itself, and to write its JSON output to a path and return only that path —
never the payload inline.

Every verifier dispatch's prompt additionally carries the live shape caps, pasted verbatim, never
restated as fixed numbers:

```bash
node agents/pr-reviewer/scripts/comment-spine.mjs --shape-caps
```

so `title`, `body`, `evidence[]`, and the fenced-suggestion line cap a verifier writes against are
checked against the caps the renderer will actually enforce, never a value someone remembered.

Every verifier dispatch's prompt also ends with the **verifier self-check** block, appended after the
preamble and the shape caps, verbatim and by reference:
[`skills/quality/pr-review/SKILL.md § Verifier self-check`](../../../skills/quality/pr-review/SKILL.md#verifier-self-check--appended-to-every-verifier-dispatch-in-step-e).
It tells the verifier to run `validate-judgments.mjs --shape-only` on its own output file before
returning, fix only the fields the check names, and stop after 2 fix-and-rerun rounds.
It must never change a verdict, a severity, or `blocking` to pass the check.
The single-dispatch path uses the same block as `--fanout`, for the same reason it uses the same
preamble: one copy, so a verifier dispatched by either path runs the same check.
A verifier that returns `SHAPE-UNRESOLVED` changes nothing downstream.
`finalize.mjs`'s `coerceShape()` still routes the candidate, and never drops it.
