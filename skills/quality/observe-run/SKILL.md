---
name: observe-run
description: >
  Runs a command and reads the telemetry that run just emitted, returning a
  `verify-behavior` receipt (confirms/contradicts/ambiguous/null) that grades a
  behavioral assertion — span count, parent/child structure, duration, error-path
  status, fan-out, attribute cardinality, ordering — against the observed spans,
  never against the diff read back. Inputs are a command plus an expectation
  set. Walks two cheapest-first rungs (an in-memory/file exporter, then
  `dash0 -X otlp proxy --agent-mode` plus `dash0 spans query`), stamps two-layer
  run identity, and self-skips genuinely when the repo has no Observability
  Profile dev target. Vendor-neutral: OTLP is the contract, Dash0 is one
  implementation of the read. Use when a fan-out count, a retry that fired more
  than once, an error swallowed into a 200, an N+1, or an unbounded cardinality
  needs proof from an actual run rather than a plausible reading of the code.
  Triggers only on an explicit ask — "observe this run's telemetry", "check
  what this run emitted", "prove this behavior with a trace", "does this
  actually fan out the way I think", "/observe-run".
disable-model-invocation: false
argument-hint: '<command> <expectation...> [--rung 1|2] [--run-id <id>] [--caller <name>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - observability
    - telemetry
    - otlp
    - opentelemetry
    - verification
    - receipt
    - dash0
---

# Observe Run

Run a command, then read the telemetry **that run** just emitted, and grade a stated behavioral
claim against it.

A test asserts through a keyhole. A trace of the same execution exposes the whole thing: fan-out
that went from 2 calls to 14, a retry that fired 5 times, an error swallowed into a 200, an N+1
query, a user ID landing as unbounded metric cardinality — none of which turns a test red. This
skill closes that gap by giving the dev loop a fourth telemetry role this repo did not have:
telemetry as **verification evidence**, read seconds after the run that produced it, rather than
telemetry read as coverage, as yesterday's production exposure, or as a post-deploy confirmation.

> **This `SKILL.md` is a thin index.** Detailed rules live in `rules/*.md` and load on demand.

---

## Inputs

The inputs are **a command plus an expectation set** — nothing else.

```text
Skill("observe-run")
  command:      <the command that runs the code under test>      # required
  expectations: <one or more behavioral assertions>              # required; by-construction ones are refused
  rung:         1 | 2                                            # optional; default resolved by rules/rungs.md
  run_id:       <string>                                         # optional; defaults to a generated dev.run.id
  caller:       <invoking skill or agent>                        # logging only
```

Return value is exactly one `verify-behavior` receipt, whose final line is
`[receipt] verdict: <confirms|contradicts|ambiguous|null>` — or **nothing at all** when the
self-skip gate below fires.

This skill has **zero dependency on any `aw` artifact**. It takes no worktree for granted, reads no
plan artifact, and checks no acceptance-criteria ledger. It runs anywhere a command can run.

---

## The self-skip gate

Before doing any work, resolve the repo's committed **Observability Profile**
(`<repo>/memory/observability-profile/INDEX.md`, written by `measurable setup` — see
[`skills/quality/measurable/rules/setup-profile.md`](../measurable/rules/setup-profile.md)) and
check it names a **dev run target** (the field `measurable setup` now asks for — see
[Integration: `measurable`](#integration-measurable-implement)).

| State | Action |
| --- | --- |
| No profile at all | **Self-skip.** No tokens spent, no report line emitted — not "ran and reported skipped." |
| A profile exists but names no dev run target | Same self-skip. If this was an **explicit** `/observe-run` invocation (not a composed call from another skill), also emit one line pointing at `Skill("measurable", "setup")` — an explicit human ask deserves an answer; a composed call stays silent. |
| A profile exists and names a dev run target | Proceed to [Workflow](#workflow). |

This mirrors the quiet-exit shape of the `pr-reviewer` measurability lens
([`agents/shared/rules/measurability-review.md`](../../../agents/shared/rules/measurability-review.md)):
a clean state produces nothing, not a line saying so.

The expectation set is checked too: an **empty** expectation set has nothing to assert, so this
skill returns the same quiet self-skip rather than a vacuous `confirms`.

---

## Workflow

| Step | Name | Rule file | Gate |
| --- | --- | --- | --- |
| 1 | Self-skip gate | (this file, above) | Dev run target resolvable, expectation set non-empty |
| 2 | Assertion provenance | [`rules/assertion-provenance.md`](./rules/assertion-provenance.md) | Every expectation is behavioral, never by-construction |
| 3 | Read dev-run lessons | [`rules/lessons.md`](./rules/lessons.md) | Merged repo+global lessons bias the run; a missing LoreKit costs nothing |
| 4 | Rung selection | [`rules/rungs.md`](./rules/rungs.md) | Cheapest rung that can decide the claim; rung 1 default |
| 5 | Run identity | [`rules/run-identity.md`](./rules/run-identity.md) | Dataset + the three resource attributes stamped |
| 6 | Read | [`rules/reader-adapters.md`](./rules/reader-adapters.md) | Reader resolved; a missing Dash0 CLI costs rung 1 nothing |
| 7 | Verdict | [`rules/receipt-mapping.md`](./rules/receipt-mapping.md) | Proxy-stream state (or rung-1 span list) mapped to one of the four canonical tokens |
| 8 | Write dev-run lesson | [`rules/lessons.md`](./rules/lessons.md) | On friction only; never blocks the receipt; drops secrets |

### Step-by-step

1. **Self-skip gate** (above) — resolve the profile, resolve the dev run target, check the
   expectation set is non-empty.
2. **Reject by-construction expectations.** For each expectation, apply
   [`rules/assertion-provenance.md`](./rules/assertion-provenance.md)'s discriminator. Refuse any
   expectation satisfiable by reading the source alone, and name the behavioral alternative — never
   run it, never grade it.
3. **Read dev-run lessons.** After the gate has passed (so a genuine skip still spends nothing) and
   before rung selection, read the merged `repo::` + `global` lessons in the
   `loop::observe-run-lessons` bucket and apply the matches as considerations that bias the rung,
   the run-identity mechanism, and the reader choice. A missing LoreKit connection makes this a
   silent no-op. See [`rules/lessons.md`](./rules/lessons.md).
4. **Select a rung.** Default to rung 1 (in-memory/file exporter) for a tight inner loop; escalate
   to rung 2 (the proxy plus `dash0 spans query`) only for cross-process fan-out, multi-service
   claims, or a baseline comparison. See [`rules/rungs.md`](./rules/rungs.md).
5. **Stamp run identity.** Resolve or generate `dev.run.id`; stamp it alongside
   `deployment.environment.name` and `vcs.ref.head.name`. See
   [`rules/run-identity.md`](./rules/run-identity.md).
6. **Run the command**, then read the telemetry via the selected rung's reader. See
   [`rules/reader-adapters.md`](./rules/reader-adapters.md).
7. **Grade the verdict.** Map the observed stream state (or the rung-1 span list) to one of
   `confirms` / `contradicts` / `ambiguous` / `null`, per
   [`rules/receipt-mapping.md`](./rules/receipt-mapping.md), and return the receipt.
8. **Write a dev-run lesson — on friction only.** If the run hit friction (a blind reader, a
   timing wait, a forced rung fallback, an SDK-side stamping need), write one lesson to the bucket
   at the scope the [classification table](./rules/lessons.md#the-two-scopes-and-which-lesson-goes-where)
   picks. This is a side effect after the receipt is returned — it never changes, delays, or blocks
   the verdict, and it drops any candidate carrying a secret. See [`rules/lessons.md`](./rules/lessons.md).

---

## What this skill reuses

| Concern | Owner |
| --- | --- |
| The four canonical receipt verdicts and their shape | `verify-behavior` — [`rules/receipt.md`](../verify-behavior/rules/receipt.md). This skill maps into it and never redefines it. |
| The cheapest-first ladder vocabulary (Tier 1/2/3) | `verify-behavior` — [`rules/ladder.md`](../verify-behavior/rules/ladder.md). This skill's two rungs live inside that ladder's Tier 3. |
| The by-construction framing | `test-provenance-guard` — cited by
[`rules/assertion-provenance.md`](./rules/assertion-provenance.md), never forked. |
| The self-improvement lesson loop (bucket, schema, recurrence, promotion gate) | `lorekit-setup` — [`rules/self-improvement-loops.md`](../lorekit-setup/rules/self-improvement-loops.md). [`rules/lessons.md`](./rules/lessons.md) instantiates it for dev-run lessons; it never redefines it. |

## Integration: `measurable implement`

`measurable`'s implement mode calls this skill as a prove-it step after writing instrumentation,
turning a static `file:line` claim into an executed one. Skips silently when this skill (or its
prerequisite dev run target) is unavailable — advisory, consistent with `measurable`'s own Core
Principle 6.

## Integration: `verify-behavior` Tier 3

`verify-behavior/rules/ladder.md`'s Tier 3 table gains a third approach delegating here, alongside
"run the covering test" and "synthesize a minimal repro." Skips silently when this skill is not
installed.

## Integration: `fix-bug`

For a telemetry-sourced bug, `fix-bug`'s Phase 2.5 reproduction step checks repro fidelity, and the
division of labour is the important half: **`fix-bug` reads the originating production span's shape
out of its own Evidence Record and passes it in as literal expectations; this skill then grades the
local run against them.**

`observe-run` never fetches the production span and cannot. Both rungs read only the telemetry the
run they just executed emitted, scoped to that run's `dev.run.id` in the dev dataset
([`rules/run-identity.md`](./rules/run-identity.md)) — so an expectation phrased as "matches the
production span" asks this skill to assert on data its reader is structurally unable to see, and it
would return `null` every time.

---

## Core Principles

1. **Behavioral, never by-construction.** An assertion satisfiable by reading the diff alone is
   refused, not graded.
2. **Cheapest rung first.** Rung 1 (in-memory/file exporter) is the default; rung 2 (the proxy) is
   for the deliberate cross-process pass.
3. **OTLP is the contract, not Dash0.** A missing Dash0 CLI costs rung 1 nothing, and rung 2 has
   portable fallback readers.
4. **Self-skip is genuine.** No profile, no dev run target, or an empty expectation set means no
   tokens spent and no report line — never "ran and reported skipped."
5. **Zero `aw` coupling.** No autonomous-workflow workspace artifact, no plan document, no worktree
   assumption. This skill runs anywhere a command runs.
6. **Reuse the receipt vocabulary verbatim.** `confirms` / `contradicts` / `ambiguous` / `null` —
   never a fifth token.
7. **Lessons accrete, config stays committed.** The dev-run lessons loop
   ([`rules/lessons.md`](./rules/lessons.md)) is additive over the Observability Profile, never a
   relocation of it: the profile stays committed and repo-scoped so it is diffable and
   teammate-visible; lessons live in LoreKit (`global` + `repo::`) so they auto-update and merge at
   read. A missing LoreKit connection costs the loop, and the run, nothing.

## Anti-patterns

- Asserting "a span named `X` exists" instead of a behavioral claim about what the run did.
- Escalating straight to rung 2 for a claim a rung-1 in-memory exporter could already decide.
- Reading a `dash0.cli.otlp_proxy.forwarded` delivery-receipt event as proof of span content —
  content comes only from `dash0 spans query`.
- Treating a degraded proxy state (an `error` event, `*.failed > 0`, a deadline-hit shutdown) as
  `contradicts` — it is `ambiguous`, never proof of absence.
- Stamping `dev.run.id` as a metric dimension.
- Assuming a dev dataset already exists instead of recommending one be created.
- Moving a profile field (the package map, the dev-run command, a dataset name) into the LoreKit
  lessons loop — that loses PR-diffability and teammate-visibility. The loop is additive beside the
  committed profile, never a relocation of it ([`rules/lessons.md`](./rules/lessons.md)).
- Writing a lesson for the verdict itself. `confirms`/`contradicts`/`ambiguous`/`null` is the
  receipt's job; a lesson is only about running and reading better next time.

## Definition of Done

- [ ] The self-skip gate resolved before any other work, with no tokens spent and no report line
      on a genuine skip.
- [ ] Every expectation passed the assertion-provenance discriminator; any by-construction claim
      was refused, not graded.
- [ ] The cheapest rung that could decide the claim was used.
- [ ] Run identity (dataset + the three resource attributes) was stamped, each on the signals
      `rules/run-identity.md` scopes it to — `dev.run.id` on spans and logs only, never metrics.
      At rung 2 that attribute is a **requirement**, not a best effort: a run that cannot stamp it
      falls back to rung 1 rather than proceeding without it.
- [ ] The receipt's verdict is one of the four canonical tokens, mapped per
      `rules/receipt-mapping.md`.
- [ ] Dev-run lessons were read (merged `repo::` + `global`) before rung selection, and a lesson
      was written only on genuine friction, at the scope its classification picks, with any
      secret-bearing candidate dropped. A missing LoreKit connection left both steps silent and did
      not block the receipt.
