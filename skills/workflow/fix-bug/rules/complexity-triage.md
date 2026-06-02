---
title: Complexity Triage — Pick the Fast Lane When the Bug Is Small
impact: HIGH
tags:
  - triage
  - complexity
  - fast-lane
  - holistic-analysis
  - bypass
---

# Complexity Triage

Phase 0.5. Runs after Phase 0 (intake + classification) and **before** Phase 1
(evidence resolution). Classifies the bug as **`simple`** or **`complex`** so
later phases can pick the right lane.

The goal is honest economy: holistic-analysis is the right tool for a
schema-mismatch across three services; it is the wrong tool for a stack trace
that lands on one specific line of one file with a missing null check. Running
the full eight-phase pipeline on a one-liner is wasted tokens and wasted
seconds.

Triage is a routing decision, not a quality decision. **The confidence gate at
Phase 4 still owns the auto-implement decision.** Simple bugs at low
confidence still stop and hand back to the user.

Source: [Effective harnesses for long-running agents (Anthropic)](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
— "match the harness to the task; do not run heavy machinery on small jobs."

## Contents

- [When this rule loads](#when-this-rule-loads)
- [Inputs](#inputs)
- [Signal table](#signal-table)
- [Decision procedure](#decision-procedure)
- [Outputs](#outputs)
- [Failure modes](#failure-modes)
- [Override](#override)

---

## When this rule loads

Phase 0.5 of `/fix-bug`. Loads unconditionally unless `--force-holistic` was
detected in Phase 0 step 0a — in which case triage is skipped and the bug is
treated as `complex` by definition.

`--analyse-only` runs triage **the same way**; the classification is logged in
the ledger but does not change the analyse-only output path.

---

## Inputs

Triage reads the artifacts already produced by Phase 0:

- Classified input shape (Dash0 URL, Linear, video, code pointer, stack
  trace, error message, free text)
- Inferred `bugClass` (`null-deref`, `race`, `off-by-one`,
  `contract-mismatch`, `perf`, `config`, `regression`, `logic`, `unknown`)
- Raw symptom text from `$ARGUMENTS`

Triage **does not** run Phase 1 probes — those are deliberately deferred so
the pre-flight short-circuit (Phase 1b) can still upgrade a `complex`
classification to fast-lane after the fact.

---

## Signal table

Walk the table once. Count signals on both sides. Decision rule lives in the
next section.

| # | Signal | Side | Why |
|---|--------|------|-----|
| 1 | Input is a code pointer (`file:line` or `file#L<n>`) | simple | Localisation is free; the suspect line is already known |
| 2 | Input is a stack trace whose top frame lands in **this** repo on a specific `file:line` | simple | Same as 1 — the frame names the suspect line |
| 3 | `bugClass ∈ {null-deref, off-by-one, contract-mismatch}` AND the stack trace / pointer is single-file | simple | Three classes with high "obvious from the line" base rates per [RepairAgent (ICSE 2025)](https://software-lab.org/publications/icse2025_RepairAgent.pdf) |
| 4 | `bugClass = regression` AND pre-flight will plausibly produce a `last_green_sha` (Dash0 URL or recent deploy tag in repo) | simple | Bisect fast-path is likely; aw-planner adds little |
| 5 | Symptom is one paragraph, no ambiguity, expected vs actual is concrete | simple | The Evidence Record will be small and self-contained |
| 6 | Linear ticket with single reproducible scenario, single failing assertion | simple | `linear-ticket-investigator` already produces a focused Evidence Record |
| 7 | `bugClass ∈ {race, perf, config, unknown}` | complex | None of these are usually "the line is the bug" |
| 8 | Stack trace top frame is in a vendored / framework file, not user code | complex | Real cause is upstream; needs holistic analysis |
| 9 | Symptom contains "intermittent", "sometimes", "only on prod", "after deploy X", "after Y users" | complex | Race / cohort / release-attribution signals |
| 10 | Multiple files implicated across modules or services | complex | Cross-cutting; planner's structural analysis adds value |
| 11 | Input is free text without a stack trace / code pointer / Dash0 URL | complex | No anchor; holistic analysis needed to even pick a hypothesis |
| 12 | Video / screen-recording input that has not yet been resolved to a stack trace | complex | Resolution may surface unexpected structure |
| 13 | Symptom mentions "regression" but no `last_green_sha` recoverable | complex | Bisect won't help; needs holistic root-cause work |
| 14 | Diff scope (where known) > 3 files or > 100 LOC | complex | Single-shot fix unlikely |

A signal that is **not present** is not a signal — do not count absence as
evidence on either side.

---

## Decision procedure

1. **Walk the signal table.** Mark each row with `simple`, `complex`, or
   `n/a`. A row is `n/a` if the evidence for it is genuinely absent — do not
   guess.

2. **Apply the decision rule.** In strict order:

   - If `--force-holistic` was set → **complex**. Stop.
   - If **any** `complex` signal fires AND **no** `simple` signal fires →
     **complex**.
   - If **any** `simple` signal fires AND **no** `complex` signal fires →
     **simple**.
   - If both sides have signals → **complex** (conservative default: when in
     doubt, holistic analysis is the safe choice).
   - If no signals fire at all → **complex** (same reasoning: under-specified
     input).

3. **Record the decision** in the bug-notes ledger under a new
   `Complexity triage` section (see [Outputs](#outputs) below).

The decision is **not reversible from inside the same run** — once triage
commits, later phases do not re-triage. The single exception is the pre-flight
short-circuit in Phase 1b: if all three short-circuit conditions hold, the
classification is upgraded to `simple` regardless of triage output. The
upgrade is logged.

The decision **is** reversible across runs — if the user reruns `/fix-bug` on
the same input with `--force-holistic`, the new run picks `complex`.

---

## Outputs

Append to `.agent/<branch-or-slug>/bug-notes.md`:

```markdown
## Complexity triage

- Classification: simple | complex
- Decision rule applied: <one of the four rules above>
- Signals — simple: [<row numbers>]
- Signals — complex: [<row numbers>]
- Phase 6 lane (provisional): fast-lane | standard-lane | n/a (analyse-only)
- Bypassed phases (provisional): [<list, e.g. Phase 3>] | none
- Override flag: --force-holistic | none
```

`Phase 6 lane (provisional)` is what triage *would* route to assuming Phase
4 clears at ≥ 92 %. Phase 5 (branch decision) confirms or downgrades.

The triage section is **append-only** like every other ledger section.

---

## What `simple` actually skips

The Phase pipeline for a `simple` bug:

| Phase | Simple | Complex |
|-------|--------|---------|
| 0 | run | run |
| 0.5 (triage) | run | run |
| 1a (evidence resolution) | run | run |
| 1b (pre-flight) | run | run |
| 2a (evidence record) | run | run |
| 2b (reproduction lock) | run | run |
| 2c (bisect fast-path) | run if regression class | run if regression class |
| 2d (ledger init) | run | run |
| **3 (holistic analysis)** | **SKIP** — in-skill lightweight analysis instead | run |
| 4 (confidence gate) | run | run |
| 5 (branch decision) | run with 92 % auto-threshold | run with 92 % auto-threshold |
| 6 (handoff) | **fast-lane** — see [`autonomous-handoff.md`](./autonomous-handoff.md#fast-lane) | **standard-lane** — see [`autonomous-handoff.md`](./autonomous-handoff.md#standard-lane) |
| 7 (verifier) | run | run |
| 8 (telemetry) | run | run |

The lightweight analysis the simple path runs **in place of** Phase 3:

1. Read the suspect file at the suspect line + 30 lines of context.
2. Identify the minimal change that satisfies the failing repro (Phase 2b)
   and does not break neighbours.
3. Write the proposed change to the Evidence Record as plain prose, exactly
   the way `holistic-analysis` would have written its root-cause paragraph.
4. Invoke `Skill("confidence", "analysis")` directly — same gate as
   Phase 4 for the complex path. **No self-grading; the score is from
   confidence as a separate skill.**

If the lightweight analysis cannot propose a fix at all — e.g. the suspect
file isn't actually in the failing path — escalate to `complex` with a note
in the ledger: `triage upgrade: simple → complex (lightweight analysis
under-determined)`.

---

## Failure modes

| Failure | How it shows up | Action |
|---------|-----------------|--------|
| Triage classified `simple` but the bug is actually cross-cutting | Lightweight analysis produces a fix that doesn't satisfy the repro; CEGIS rounds 1–3 fail on the fast-lane | [Fast-lane round-3 fallback](./autonomous-handoff.md#fast-lane-round-3-fallback) — re-dispatch via aw-planner with counterexamples |
| Triage classified `complex` but the bug is actually trivial | Holistic analysis runs and the standard lane succeeds — wasted tokens, but no correctness loss | Acceptable; the conservative default is **on purpose** |
| Override (`--force-holistic`) used when triage would have picked `simple` | Standard lane runs on a trivial bug | Acceptable; user opted in to the slower path |
| Triage signals contradict (both sides fire) | Decision rule picks `complex` | This is the designed behaviour, not a failure |
| Ledger missing or read-only | Triage cannot write the classification | Fail loudly — every later phase reads the ledger; running without it breaks recovery |

---

## Override

Two override paths:

- **`--force-holistic`** (CLI flag in `$ARGUMENTS`) — set in Phase 0 step
  0a. Triage runs but the decision is hard-coded to `complex`. Logged in the
  ledger as `override flag: --force-holistic`.
- **User-interactive override** — after triage prints its decision, the user
  can reply with `force-complex` or `force-simple` before Phase 1 starts.
  Logged in the ledger as `override interactive: <choice> by user`.

Interactive `force-simple` is **not allowed** if any of these complex signals
fire:

- Signal 11 (free-text without anchor) — there is no suspect line to read.
- Signal 12 (unresolved video input) — the input shape isn't ready.

Print the refusal in one line: `force-simple refused: <signal> fires; resolve
the input first`.
