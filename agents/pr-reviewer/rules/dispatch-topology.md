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

It governs the single-dispatch review — `/pr-review`, or `Task(subagent_type="pr-reviewer", …)` —
including the one sub-agent its default budget isolates.

`finders.md` and `finding-verifier.md` stay byte-identical — this file is orchestration, not rubric.
Neither finder candidates nor verifier verdicts change shape; only *how many dispatches produce them,
and in what grouping* is prescribed here.

## The two topologies

`resolveBudget()` returns one of two values in `budget.topology`:

| Topology | When | Sub-agents | Why |
| --- | --- | --- | --- |
| `in-context` | `t < 0.4`, or no dispatch capability | none | A quick review is cheaper than one dispatch's base cost. |
| `in-context` | a small incremental re-review: run mode `incremental`, `incremental-quick`, or `zero-delta`, tier `standard` or `quick`, thoroughness **defaulted** (`budget.topologyReason: "small-incremental"`) | none | **Unmeasured.** The A/B evidence in the next row is one deep, full, 22-file review; no A/B round ran an incremental re-review. On dash0#20655 the reviewer idled ~125 s waiting for the worker. An explicit `--thoroughness` or `--effort high` keeps `hybrid`. |
| `hybrid` | **the default at `t ≥ 0.4`**, except the row above | the intent finder only (`budget.isolatedFinders`) | A/B rounds 7–8 on sync-tray#72: isolated, the intent finder flagged the highest-severity agreed defect in 3 of 3 runs, in 5–6 minutes each; in one context with the other finders, the default setting had missed it in 4 of 4 rounds. |

There is no third, fully parallel topology.
In A/B round 8 every finder as its own sub-agent, sharded per file group and followed by batched
verifier dispatches (the removed `/pr-review --fanout`), raised every known defect but projected to
~57 minutes against 9–13 for one context; the hybrid split kept the one finder whose isolation paid.

**Running `hybrid`.** Read the intent candidates as late as possible: the worker runs 5–6 minutes
on a 22-file PR, and every minute of your own work done before you read its file is a minute you do
not wait. Your own candidates never wait on the intent worker's.

1. At the start of Phase D, dispatch the intent finder with the worker preamble, the review packet,
   and an output path.
   Where the dispatch tool can return before the sub-agent finishes (a background option), use it,
   so the intent finder runs while you run the other finders.
   Where it cannot, dispatch it first and wait: the wait is what made the default catch the top
   defect.
   On a Dash0 Agent0 Automation, where a dispatch always blocks the turn, run the other finders as
   a second worker in the same message instead of waiting
   ([`agent0-runtime.md`](./agent0-runtime.md#phase-d-two-workers-in-one-message-never-expect-a-second-rung)).
2. Run every other active finder, every lens, Step 2.5 consolidation, and Step 2.6b verification of
   **your own** candidates in your own context, exactly as `in-context` does — including the
   self-check under *Verification* below. Mark `verify` with `--attr candidates=<n>` on the first
   verification command ([`run-telemetry.md`](./run-telemetry.md#verify-opens-before-the-verification-it-measures)).
3. Only then read the intent finder's output file.
   Dedupe its candidates against the verified pool by Step 2.5's rules
   ([`rubric-composition.md § Dedupe`](../../shared/rules/rubric-composition.md#dedupe), the
   semantic pass included — `finalize.mjs --dedupe-candidates` over the pool plus the intent
   candidates), and verify only the intent candidates that remain, each in your context like any
   other; none is trusted because it came from a sub-agent.
   An intent candidate merged with a verified one takes that verdict and is not verified again.
4. If the dispatch returned no readable output file, retry it once, and never a third time.
   A second failure is a `RUN_ANOMALY` naming the unit — and the intent finder then runs in-context,
   so the review never loses the finder itself.

**Running `hybrid` when the reviewer holds no dispatch tool.**
`/pr-review` dispatches this agent as a sub-agent, and a sub-agent cannot dispatch another, so on
that path the caller orchestrates the split: it runs `prepare-review.mjs` once, dispatches the
intent worker only when `context.budget.topology` is `hybrid`, sends it and this agent in one
message, and passes `--context <path>` and `--intent-from <path>`
([`skills/quality/pr-review/SKILL.md` § Step 2](../../../skills/quality/pr-review/SKILL.md#step-2-dispatch-the-agent)).
With `--context <path>`, skip your own `prepare-review.mjs` and read `<path>` wherever the pipeline
reads the context; the caller ran prepare, so the caller owns the workspace cleanup, never you.
With `--intent-from <path>`:

1. Do not run the intent finder in this context.
2. Run every other finder, lens, and gate, then Step 2.5 and Step 2.6b over your own candidates,
   marking `verify` with `--attr candidates=<n>` on the first verification command — never chained
   onto the `intent-wait` marker below.
3. Then wait for `<path>` and fold the worker into this run's telemetry on one command, marking the
   wait as its own step:

   ```bash
   node "$TELEMETRY" step intent-wait --attr tool_calls_so_far=<N> --run-dir "$RUN_DIR"; node "$TELEMETRY" worker intent import --from "$(dirname "$INTENT_FROM")" --done "$INTENT_FROM" --wait 540 --run-dir "$RUN_DIR"; cat "$INTENT_FROM"
   ```

   It prints `intent: ready after <s>s wait` once the file exists and is non-empty, polling every 2
   seconds, for at most 10 minutes in total, and records the time as `intent_wait_ms`
   ([`run-telemetry.md`](./run-telemetry.md#what-you-mark-the-model-steps)).
   Give the shell call a 600000 ms timeout; where the harness caps it lower, pass `--wait` under the
   cap and re-issue the command on `intent: not ready` — the 10 minutes are counted across calls.
4. On `intent: timed out`, or a file that does not parse, run the intent finder in this context and
   add `intent worker returned no readable candidates — ran intent in-context` to `RUN_ANOMALY`
   through `context.render.RUN_ANOMALY`.
   The review never loses the finder itself.
5. Otherwise mark `intent-verify`, then dedupe and verify its candidates as in step 3 above.
   The worker read the same context and workspace you did, so its line numbers cite your head; a
   line that fails line validity is dropped, never trusted.

```text
# correct (hybrid): the intent file is read after your own verification
dispatch intent (background) → run correctness, consumer-impact, dependency, standards, quality,
lenses → consolidate → verify own candidates → read intent's file → dedupe → verify new intent
candidates → finalize

# incorrect: reading the intent file before Step 2.5 — the reviewer idles until the worker ends
dispatch intent → other finders → wait for intent → consolidate → verify   # ~125 s idle on dash0#20655
```

## Reading a budget into dispatch

Bind the budget once, right after `DEPTH_TIER` — `resolveBudget({ thoroughness, routedTier:
DEPTH_TIER, runMode: RUN_MODE, shape: DELTA_SHAPES, dispatchAvailable: <Task held?> })` — and every downstream step
reads it, never re-derives it:

- **`budget.finders`** — which of the six finders are active at all (`correctness`, `intent`,
  `quality` always are; `consumer-impact` / `dependency` / `standards` activate together once
  thoroughness clears the mid breakpoint). Skip an inactive finder exactly as `finders.md`'s own
  availability table already instructs; nothing here changes *which* finders exist, only whether
  each one runs this pass.
- **`budget.finderScope`** — `"delta"` vs `"all"` for `consumer-impact` and `standards`, same
  meaning `pr-reviewer.md`'s Step 2.4d/2.4e scope language already uses.
- **`budget.correctnessVotes`** — always `1` (votes retired; see *Diversify then vote* below). A
  single pass, with `votes` omitted.
- **`budget.topology`** — `"in-context"` or `"hybrid"` (see *The two topologies* above).
  `"hybrid"` dispatches only `budget.isolatedFinders` and runs everything else in the reviewer's own
  turn; `"in-context"` dispatches nothing. `budget` already folds `dispatchAvailable` into this field — a
  caller never checks `Task` separately.
- **`budget.maxVerificationTier`** — the ceiling on `verify-behavior`'s Tier 1–3 evidence ladder
  verification may reach for this run (`finding-verifier.md`'s own per-candidate judgment still
  decides whether a given candidate needs it).
- **`budget.holisticEscalationCap`** — replaces the flat "cap 10" / "cap 3" language at 2.4b with
  `budget.holisticEscalationCap` directly; `2.4b`'s own incremental-mode gate (`ESCALATE_IN_INCREMENTAL`)
  is unchanged and still decides *whether* 2.4b runs at all in incremental mode.
- **`budget.optimalityLens`** / **`budget.measurabilityLens`** — replace the flat `DEPTH_TIER ==
  "deep"` / `DEPTH_TIER != "quick"` gates at 2.4c/2.4e with these booleans directly. 2.4c's own
  incremental-mode skip is unchanged and still wins: `standard`'s 0.7 default sets
  `optimalityLens`, and the lens still never runs on an incremental re-review.

**`prepare-review.mjs` cannot know whether the agent reading `context.json` holds `Task`**, so the
`budget` it writes there always assumes `dispatchAvailable: true` — so it says `hybrid` at `t ≥ 0.4`. The agent re-derives the real value itself:
`topology = <Task held?> ? context.budget.topology : "in-context"`. Every other field
on `budget` (finders, scope, votes, verifier tier, the two lens booleans, the escalation cap) is
unaffected by dispatch availability and is read straight off `context.json`.

## Verification — in your own context

Verification runs sequentially in the reviewer's own turn under both topologies.
You are then your own verifier, so take the two steps a separate verifier would, and record each one:

1. Read the live shape caps once, before writing any candidate's `title`, `body`, or
   `evidence_anchors`:

   ```bash
   node "$AGENT_SUPPORT/pr-reviewer/scripts/comment-spine.mjs" --shape-caps
   ```

   Never write against a remembered 60/200-character limit; the renderer enforces what this prints.
2. Before `finalize.mjs`, run the shape check on the judgments file you wrote for it:

   ```bash
   node "$AGENT_SUPPORT/pr-reviewer/scripts/validate-judgments.mjs" --shape-only /tmp/judgments.json
   ```

   - Exit 0 with `OK`: continue.
   - Exit 1: stderr names each violation by candidate index and field. Edit only the named fields,
     then run it again — at most 2 fix-and-rerun rounds. A third failure goes to `finalize.mjs` as
     is.
   - Exit 2 (the check could not run): continue, and name it in `RUN_ANOMALY`.
   - Never change a verdict, severity, `blocking`, `R`, `A`, or `Ac` to pass the check, and never
     delete a candidate: the check governs how a finding is written, not whether it is true.
   - One exception: `"blocking": true` requires severity `high` or `critical`. That is the severity
     crosswalk, not a shape rule — re-apply it: raise the tier only if the base impact is broken
     behaviour, security, data loss, or misimplemented intent; otherwise set `blocking` to `false`.

`--shape-only` validates each candidate against `judgments.schema.json`'s `$defs.candidate`, the
candidate-level domain rules, and `finalize.mjs`'s own `checkShape()`, imported rather than copied;
it accepts a bare array of candidates or `{ "candidates": [...] }`.
A candidate still over a cap after the two rounds is not dropped: `finalize.mjs`'s `coerceShape()`
routes it, so a verified finding is never lost over its shape.
In A/B rounds 3–5 the in-context arms skipped both steps and spent up to four validate rounds on
evidence notes over the cap.

**No-dispatch fallback is a degrade, not a silent equivalence — name it.** `resolveBudget()` already
returns `topology: "in-context"` whenever `dispatchAvailable` is `false`, whatever thoroughness
requested — it never silently reports a shape it could not run. When that happened on a run whose
thoroughness would otherwise have crossed the 0.4 breakpoint, set:

```text
RUN_ANOMALY: no sub-agent dispatch available — the intent finder ran in-context with the other
finders at effective thoroughness <t>, instead of as its own sub-agent
```

Set it by passing **`--no-dispatch`** to `finalize.mjs`, never by hand-writing it.
`finalize.mjs` renders the line from `context.budget` (only when the budget's topology was `hybrid`
and no intent worker delivered, with its own effective thoroughness) and merges it with every other anomaly it
computes.
A value you also supply in `context.render.RUN_ANOMALY` is merged in, never a replacement: in A/B
iteration 2 every in-context arm hand-wrote this line there, which dropped `prepare-review.mjs`'s
own anomalies until the arm noticed and re-merged them.

```text
# correct
finalize.mjs --context … --judgments … --out-dir … --dry-run --no-dispatch

# incorrect: the hand-written line replaced finalize's computed anomalies before iteration 2
jq '.render.RUN_ANOMALY = "no sub-agent dispatch available — …"' context.json
```

This is the same `RUN_ANOMALY` slot every other capability cap in this pipeline uses
([`report-rendering.md § Run slots`](./report-rendering.md)) — never a quiet downgrade a reader has
to infer from a shorter run.

## Diversify then vote (moved here from the agent body) — retired

`budget.correctnessVotes` is `1` at every thoroughness, so the correctness finder runs once and
`votes` is omitted on every path.
`finders.md`'s *Diversify then vote* section describes the mechanism; this budget decides `N`, and
`N` is now 1.
The mechanism was meant to corroborate: a candidate raised by ≥ 2 votes over permuted file order
carries `votes`.
Round 8 measured the opposite — two votes raised 24 and 25 candidates and dedupe merged few of them
across the two, so the votes added work for the verifier rather than agreement, at ~10 minutes of
one worker each.
Reintroduce votes only with a run that shows them adding **confirmed** recall, and change
`route-depth.mjs`'s `CORRECTNESS_VOTES` and `depth-routing.md` together.

## Worker prompts

The intent worker gets the worker preamble, whether you dispatch it yourself or `/pr-review`
dispatches it alongside you:
[`skills/quality/pr-review/SKILL.md § Worker preamble`](../../../skills/quality/pr-review/SKILL.md#worker-preamble--the-intent-worker).
It tells the worker to read only the files it was handed by absolute path, never to read
`agents/pr-reviewer.md` itself, to read the review packet (`context.packet.path`) before opening any
workspace file, and to write its JSON output to a path and return only that path — never the payload
inline.

**The dispatch names the review packet by absolute path.** It is the largest single cut in the
worker's turn count: an isolated intent finder on sync-tray#72 spent 21–40 tool calls and 5–6
minutes, most of them paging a 5,260-line diff and opening files around hunks to see context and
find a line number to cite — all of which `review-packet.mjs` assembles once, before any model turn,
with head line numbers on every line.
