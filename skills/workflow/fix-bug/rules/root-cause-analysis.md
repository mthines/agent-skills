---
title: Root-Cause Analysis — Phase 3 complex path
impact: HIGH
tags:
  - root-cause
  - execution-path
  - confidence-gate
  - phase-3
---

# Root-Cause Analysis

Read this at Phase 3 when triage is `complex`, when the `simple` path upgrades to `complex`, or when any other skill asks for a root-cause trace (aw's stuck loop, `critical` analysis mode).
Run it in your own context: there is no dispatch.

## Contents

- [Honesty guardrail](#honesty-guardrail)
- [Inputs](#inputs)
- [Step 1 — Trace the execution path](#step-1--trace-the-execution-path)
- [Step 2 — Confidence gate](#step-2--confidence-gate)
- [Step 3 — Write the Root-Cause Record](#step-3--write-the-root-cause-record)

## Honesty guardrail

Never guess or fabricate a root cause.

- When the evidence points two ways, record both hypotheses and what would disambiguate them, and set `Status: Tentative`.
- When you cannot follow the causal chain in the code you read, record an Information Gap instead of filling it in.
- Cite only `file:line` locations you opened and read, not paths you only grepped.
- Describe the direction of the fix, never the patch: patch authoring belongs to Phase 6, after the brief is written and validated.

## Inputs

1. The Phase 2 Evidence Record, including the `Bug class` hint.
2. Every bug-notes ledger hypothesis with `state = ruled-out` — state them first and do not re-explore them.
3. Any pre-flight or bisect finding (an offending commit, a regression window).
4. The Phase 2.5 repro path and command.

## Step 1 — Trace the execution path

1. Name the entry point (request handler, CLI command, event, test) and the exit where the symptom shows.
2. Read every file on the path between them, in call order, across file and package boundaries.
   Record each hop as `file:line — what it does — what it guarantees to the next hop`.
3. Mark the first hop where a guarantee breaks (a wrong value, a missing guard, a contract mismatch).
4. List **at least 2 alternative causes** and, for each, the concrete evidence that rules it in or out (`file:line`, test output, `git blame`).
5. Separate root cause from symptom: the root cause is the earliest hop whose fix makes the symptom impossible, not the hop where it surfaces.
   A fix at the symptom hop alone (a catch, a default, a retry) is a symptom patch — say so.

```text
✗ Root cause: `total.ts:42` renders "NaN".            (the symptom hop)
✓ Root cause: `load.ts:17` reads `price` as a string, so `total.ts:31` concatenates instead of adding.
```

Keep the hop-by-hop notes in the bug-notes ledger, not in the user-facing summary.
Append every alternative you ruled out to the ledger's hypothesis table with `state = ruled-out` and the evidence.

## Step 2 — Confidence gate

Score the conclusion:

```text
Skill("confidence", "analysis\n\n<root-cause conclusion + evidence>")
```

Record the score and its breakdown (evidence strength 40 % / root-cause certainty 30 % / fix confidence 30 %).
When the score is below 90 %, re-trace the weakest hop once and re-score; record the final score.
Never round up, and never self-grade: the number comes from `confidence`.
Phase 4 reuses this score.

## Step 3 — Write the Root-Cause Record

Append exactly this structure to the bug-notes ledger; Phase 4, Phase 6, and the output summary read it.

```markdown
## Root-Cause Record

### Symptom
<one paragraph: what is going wrong, in observable terms>

### Root cause
<one to three sentences naming the actual cause — not the symptom — anchored to file:line>
Falsifiable prediction: <what the repro shows once the root cause is fixed>

### Causal chain
1. [file:line] <what happens>
2. [file:line] <contract boundary where the guarantee breaks>
3. [file:line] <how that surfaces as the symptom>

### Key evidence
- For: <strongest concrete evidence — file:line, git blame, test output>
- Against (ruled out): <strongest counter-evidence and why it does not hold>

### Alternatives ruled out
| Hypothesis | Why rejected |
|------------|--------------|
| ...        | ...          |

### Proposed fix direction
<what must change and where — not a diff>

### Confidence (analysis)
- Score: <NN>%
- Evidence strength (40%): <brief>
- Root-cause certainty (30%): <brief>
- Fix confidence (30%): <brief>

### Information gaps
<each gap and what would disambiguate it, or "None">

### Status
<Ready | Tentative | Needs info>
```

| Status | Meaning |
|--------|---------|
| `Ready` | Confident root cause; continue to Phase 4. |
| `Tentative` | Leading hypothesis below the gate; Phase 5 stops and presents the gaps. |
| `Needs info` | Information gaps prevent a root cause; Phase 5 stops and asks for the missing evidence. |
