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
| `in-context` | `t < 0.4`, or no dispatch capability | none | A review this light — below `quick`'s 0.4 default, so only an explicit override — is cheaper than one dispatch's base cost. |
| `in-context` | a small incremental re-review: run mode `incremental`, `incremental-quick`, or `zero-delta`, tier `standard` or `quick`, thoroughness **defaulted** (`budget.topologyReason: "small-incremental"`) | none | **Unmeasured.** The A/B evidence in the next row is one deep, full, 22-file review; no A/B round ran an incremental re-review. On dash0#20655 the reviewer idled ~125 s waiting for the worker. An explicit `--thoroughness` or `--effort high` keeps `hybrid`. |
| `in-context` | a lean budget: tier `quick`, thoroughness **defaulted**, any run mode — including a size-scaled first run ([`depth-routing.md` § Size scaling](./depth-routing.md#size-scaling)) (`budget.topologyReason: "lean"`) | none | A `quick` routing found nothing that reaches past the hunks; the intent finder still runs, in this context. An explicit `--thoroughness` or `--effort high` keeps `hybrid`. |
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
- **`budget.finderPasses`** — `1`, or `2` when the review config sets `finder_passes: 2` (see
  [*Two finder passes*](#two-finder-passes) below). At `2`, `budget.secondPassUnits` names pass 2's
  workers and `budget.toolCalls` already includes the ×1.5. Like `topology`, it assumes a dispatch:
  with no dispatch tool there is no pass 2, and `finalize.mjs` names the missing units.
- **`budget.maxVerificationTier`** — the ceiling on `verify-behavior`'s Tier 1–3 evidence ladder
  verification may reach for this run (`finding-verifier.md`'s own per-candidate judgment still
  decides whether a given candidate needs it).
- **`budget.holisticEscalationCap`** — replaces the flat "cap 10" / "cap 3" language at 2.4b with
  `budget.holisticEscalationCap` directly; `2.4b`'s own incremental-mode gate (`ESCALATE_IN_INCREMENTAL`)
  is unchanged and still decides *whether* 2.4b runs at all in incremental mode.
- **`budget.measurabilityLens`** — replaces the flat `DEPTH_TIER != "quick"` gate at 2.4e with
  this boolean directly. `budget.optimalityLens` is still computed but nothing reads it.

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

## Two finder passes

`budget.finderPasses` is `2` when the PR's base commit sets `finder_passes: 2` in `.github/review.yaml` (or `prepare-review.mjs` got `--finder-passes 2`) and the run is not zero-delta against a prior SHA from the PR-state record (`--state`); otherwise it is `1` and `budget.finderPassesReason` says why.
Such a run takes `pr-reviewer.md` Step 0.8's gates-only path, so it has no finders to repeat.
A zero-delta run on the GitHub fallback rung (no `--state`, or a record with no prior SHA) keeps `2`: it falls through to Step 1.2b, which promotes it to `full` ([`agent0-runtime.md`](./agent0-runtime.md#enter-at-step-12c-from-a-prepared-context)).
`prepare-review.mjs` cannot see the caller's dispatch tool, so the budget in `context.json` assumes
one, exactly as it does for `topology`: a run with no dispatch still reads `2` and the ×1.5
`budget.toolCalls`, sends no pass-2 worker, and `finalize.mjs` names both pass-2 units in
`RUN_ANOMALY` (step 7).
Pass 1 is the run this file already describes, on `budget.topology`, unchanged.
Pass 2 runs the same active finders again, in the two workers `budget.secondPassUnits` names:

| Unit | Finders | Writes |
| --- | --- | --- |
| `intent-2` | `intent` only | `<run-dir>/pass2/intent.json` |
| `other-finders-2` | every other finder `budget.finders` turns on, in one context | `<run-dir>/pass2/others.json` |

`<run-dir>` is the directory holding `context.json`.
Pass 2 writes no `impact_trace`: coverage is recorded once, by pass 1.
**Why:** independent passes over the same diff raise different confirmed defects; a union before
verification keeps the extra recall without verifying any defect twice.

1. **Dispatch.** Whoever dispatches pass 1's intent worker also sends both pass-2 workers, in the
   same message: `/pr-review` and `review-loop` on a harness with a dispatch tool, or on a Dash0 Agent0
   Automation the top-level reviewer, as two more workers in its Phase D message
   ([`agent0-runtime.md`](./agent0-runtime.md#phase-d-two-workers-in-one-message-never-expect-a-second-rung)).
   When `budget.topology` is `in-context` and `budget.finderPasses` is `2`, the two pass-2 workers
   are still sent.
2. **Independence.** Each pass-2 worker gets the intent worker's preamble, the same context file, the
   review packet, and its output path — never pass 1's candidates, a count of them, or notes from the
   reviewer. It never runs `prepare-review.mjs`.
3. **Record each worker.** The caller stamps the dispatch with `date +%s > <run-dir>/pass2/dispatched_at`.
   The reader folds each worker in on the command that reads its file:
   `node "$TELEMETRY" worker intent-2 import --from <run-dir>/pass2 --done <run-dir>/pass2/intent.json --wait 540 --run-dir "$RUN_DIR"`,
   and the same for `other-finders-2` with `--done <run-dir>/pass2/others.json`.
   On Agent0, mark `worker intent-2 start` / `worker other-finders-2 start` as for pass 1's workers,
   and give each `end` marker `--done` naming the file that command reads.
   `review-telemetry.mjs` stamps `delivered: true` on an `end` or `import` record only when its
   `--done` file parses as a candidate array, and `finalize.mjs` counts a pass-2 unit as run from that
   stamp alone: a bare `end`, or a file that is missing or does not parse, leaves the unit undelivered.
   **Why:** the marker rides the command that reads the file, so on its own it records that the
   worker returned, not that it left a readable file.

   ```bash
   # correct (Agent0): the end marker names the file the same command reads
   node "$TELEMETRY" worker intent-2 end --done <run-dir>/pass2/intent.json --run-dir "$RUN_DIR"; cat <run-dir>/pass2/intent.json

   # incorrect: a bare end marker — intent-2 stays undelivered and finalize.mjs names it in RUN_ANOMALY
   node "$TELEMETRY" worker intent-2 end --run-dir "$RUN_DIR"; cat <run-dir>/pass2/intent.json
   ```

4. **Union before verification.** Run the union once, after every readable file exists, and always with `--run-dir`.
   Its run-ledger record is how `finalize.mjs` knows the union ran: a pass-2 unit that delivered with no union record is named in `RUN_ANOMALY` as never unioned.

   ```bash
   # correct: --run-dir records the union on the run ledger finalize.mjs reads
   node "$AGENT_SUPPORT/pr-reviewer/scripts/finalize.mjs" \
     --first-pass <pass-1 candidate files> --second-pass <run-dir>/pass2/intent.json,<run-dir>/pass2/others.json \
     --out <run-dir>/union.json --run-dir "$RUN_DIR"

   # incorrect: no --run-dir — no union record, so finalize.mjs names every delivered pass-2 unit as never unioned
   node "$AGENT_SUPPORT/pr-reviewer/scripts/finalize.mjs" \
     --first-pass <pass-1 candidate files> --second-pass <run-dir>/pass2/intent.json,<run-dir>/pass2/others.json \
     --out <run-dir>/union.json
   ```

   - Where the reviewer verifies its own pass-1 candidates before reading any worker file (the
     `--intent-from` path), write that verified pool to `<run-dir>/pass1/own.json` and pass
     `<run-dir>/pass1/own.json,<intent file>` as pass 1.
     This replaces the `--dedupe-candidates` call in step 3 of [*Running `hybrid`*](#the-two-topologies): one merge covers the intent worker and pass 2.
   - Where every finder ran as a worker (Agent0), pass 1 is `<scratch>/intent.json,<scratch>/others.json`.
5. **Verify** only the kept candidates with `_needs_verification: true`.
   A kept candidate with `_needs_verification: false` is the candidate you already verified, with
   every field it had (`verdict`, scores, `prefix`, `body`); the rest of its group is in `dropped`.
   Carry it into `judgments.json` as it is, without verifying it again.
   When a group holds several verified candidates, the union keeps the strongest verdict:
   `confirmed`, then `ambiguous`, `unobtainable`, and `contradicted`.
6. **Write `judgments.json` without the union's fields.** Drop `_pass`, `_found_in_passes`,
   `_needs_verification`, and `_semantic_merged` (the semantic pass's audit record, on a merged
   group's survivor only) from every candidate; the judgments schema rejects unknown keys.
   `_found_in_passes: [1, 2]` is not agreement: it never lowers a confidence bar, and the union
   strips `agreement_promoted` and `_also_flagged_by` from every record it writes.
7. **A pass-2 worker with no readable file** is left out of `--second-pass` and is neither retried nor
   run in your context — you have seen pass 1, so a pass 2 run by you is not independent.
   `finalize.mjs` reads the run ledger and names in `RUN_ANOMALY` every planned unit with no `end` record stamped `delivered: true` (step 3), and every delivered unit when the ledger holds no union record (step 4), so the report never claims two passes it did not run.

```text
# correct (finder_passes: 2, /pr-review): one message, four dispatches; one union before verifying worker candidates
dispatch pr-reviewer + intent + intent-2 + other-finders-2 → reviewer verifies its own pass-1 candidates
→ imports intent, intent-2, other-finders-2 → finalize.mjs --first-pass own.json,intent.json
  --second-pass pass2/intent.json,pass2/others.json --run-dir "$RUN_DIR" → verify _needs_verification: true → finalize

# incorrect: pass 2 run by the reviewer after reading pass 1 — correlated, not independent
reviewer runs its finders → reads intent.json → "runs the finders again" → unions them
```

Cost: two more sub-agents per run (each ~110–160k tokens before it reads the diff) and 1.5× the
reviewer's tool-call budget for the extra verification. **Unmeasured:** no A/B round has compared a
two-pass union with one pass; measure confirmed recall before raising the default from `1`.

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
