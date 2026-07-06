---
title: 'Phase 4: Testing & Iteration'
impact: CRITICAL
tags:
  - testing
  - iteration
  - stuck-loop
  - phase-4
---

# Phase 4: Testing & Iteration

## Contents

- [Spec-Driven UI Verification (runs BEFORE this rule)](#spec-driven-ui-verification-runs-before-this-rule)
- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure](#procedure)
- [Executable Checks Loop](#executable-checks-loop)
- [Stuck-Loop Detection](#stuck-loop-detection)
- [Stuck Recovery](#stuck-recovery)
- [When to Stop and Ask (beyond stuck-loop)](#when-to-stop-and-ask-beyond-stuck-loop)
- [Testing Checklist](#testing-checklist)
- [References](#references)

## Spec-Driven UI Verification (runs BEFORE this rule)

If `.agent/{branch}/specs.md` exists and the plan touches UI files, the executor
runs **[`phase-4-spec-verification.md`](./phase-4-spec-verification.md)** first
— before this rule's lint/type/test loop. That sub-rule dispatches `aw-tester`
and iterates until the verdict is `green` or `inconclusive`. Only after it
completes (or self-skips) does the executor enter this rule's test loop.

The iteration cap below applies to **both** loops independently. See
[`phase-4-spec-verification.md#step-3-hot-loop--fast-iteration-on-red`](./phase-4-spec-verification.md#step-3-hot-loop--fast-iteration-on-red)
for the spec-verification hot-loop iteration and [`phase-4-spec-verification.md#step-4-cold-pass-escalation`](./phase-4-spec-verification.md#step-4-cold-pass-escalation)
for the escalation path.

---

## Overview

Run the project's test suite and iterate until tests pass — but with a **hard,
mode-aware iteration limit on the same failing area** before escalating. The
iteration limit is the single biggest cost-saver in the workflow: it stops the
agent burning tokens on hallucinated fixes when the root-cause analysis is wrong.

| Mode      | Same-area iteration cap | Rationale                                                           |
| --------- | ----------------------- | ------------------------------------------------------------------- |
| Lite Mode | 3                       | Simpler tasks should converge fast — keep the loop tight            |
| Full Mode | 5                       | Well-scoped complex tasks benefit from one extra attempt before escalation |

When the cap is hit, the **auto-replan protocol** (see [Stuck-Loop Detection](#stuck-loop-detection))
fires automatically — confidence gate, then conditional holistic-analysis, then
mandatory user escalation if recovery fails.

Companions invoked from this phase **skip silently if not installed** — see
[`companion-skills.md`](./companion-skills.md) for the full registry.

## Core Principles

| Principle                                       | What it means                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Iterate, but with a hard mode-aware limit       | 3 iterations (Lite) or 5 iterations (Full) on the same failing area, then escalate |
| Focus on ONE failing test at a time             | Don't fix multiple simultaneously — root causes get tangled         |
| Lightweight per-iteration self-reflection       | Brief self-check before each iteration — NOT a full `confidence` run |
| Fix root causes, not symptoms                   | A passing test on a wrong fix is worse than a red one               |
| Checks gate mechanically (Full Mode)            | Phase 4 exits when every `checks.yaml` check passes — not when "criteria feel met". Check definitions are executor-immutable; gaming a check is a hard stop |
| Auto-replan on low confidence                   | When stuck and confidence < 90%, trigger holistic-analysis and re-invoke `aw-create-plan` to produce the next `plan.v{N+1}.md` snapshot |
| One-shot retry only                             | After auto-replan, Phase 4 may resume at most ONCE before mandatory escalation |
| Track everything in `plan.md` Progress Log      | Auditable trail of attempts and outcomes                            |

---

## Procedure

### Step 1: Determine Test Strategy

| Changed                | Test type                       |
| ---------------------- | ------------------------------- |
| Pure functions         | Unit tests                      |
| React / UI components  | Component tests                 |
| API endpoints          | Integration tests               |
| Database operations    | Integration tests with test DB  |
| Cross-component flows  | End-to-end tests                |

### Step 2: Run Existing Tests

```bash
npm test
# Or scoped:
npm test -- --testPathPattern="<area>"
```

Expected outcomes:

| Outcome                          | Action                                              |
| -------------------------------- | --------------------------------------------------- |
| All pass                         | Skip to Step 5 (add new tests if needed)            |
| Existing tests fail              | Could be regression — fix before continuing         |
| New behaviour tests fail         | Expected — drive into Step 3 iteration loop         |

### Step 3: The Iteration Loop

**CRITICAL: focus on ONE failing test at a time.** Pick the most upstream
failure (the one whose root cause likely cascades into others) and resolve it
in isolation before moving to the next.

The same-area cap is mode-aware:

| Mode      | `iteration_cap` |
| --------- | --------------- |
| Lite Mode | 3               |
| Full Mode | 5               |

```
iteration_cap = 3 if Lite Mode else 5
iterations_on_same_area = 0
current_area = <descriptor of the failing test/file/symptom>
auto_replan_used = False   # one-shot guard — see Stuck-Loop Detection

while not all_tests_pass:
    iterations_on_same_area += 1

    if iterations_on_same_area == iteration_cap:
        goto: Stuck-Loop Detection (below)

    # Per-iteration lightweight self-reflection (R5)
    if iterations_on_same_area >= 2:
        meaningfully_different = "Is this attempt meaningfully different from the previous one?"
        understood_prior_failure = "Have I considered why my previous fix didn't work?"
        if not (meaningfully_different and understood_prior_failure):
            # Bias toward replanning early — don't waste the remaining cap.
            goto: Stuck-Loop Detection (below)

    1. Read failure output completely.
    2. Hypothesise root cause (one sentence).
    3. Apply the smallest fix that addresses that hypothesis.
    4. Re-run the focused test.
    5. Self-reflect:
       - Did the failure change shape? (progress)
       - Is the same assertion failing the same way? (no progress)
       - Did the fix introduce a new failure? (revert and rethink)
    6. Log the attempt in plan.md Progress Log.
```

When a test passes, reset `iterations_on_same_area = 0` and move to the next
failing test as a fresh area.

### Step 4: Self-Reflection

Two complementary checks run during the iteration loop:

#### 4a — Per-iteration lightweight self-check (BEFORE each iteration N >= 2)

This is intentionally **not** a full `Skill("confidence")` invocation —
running confidence per iteration would be token-expensive. Instead, the agent
performs a brief self-prompt:

| Self-check                                                       | Action if "no"                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Is this attempt meaningfully different from iteration N-1?       | Skip ahead to Stuck-Loop Detection (don't waste remaining cap)       |
| Have I considered why my previous fix didn't work?               | Skip ahead to Stuck-Loop Detection                                   |

If both answers are "yes", proceed with the iteration as normal.

#### 4b — In-iteration self-reflection (AFTER applying the fix)

Ask the following before deciding what to try next:

| Question                                                  | If "no" / "yes worryingly"                          |
| --------------------------------------------------------- | --------------------------------------------------- |
| Is the failure shape changing across attempts?            | Probably wrong mental model — slow down            |
| Am I editing the same lines repeatedly?                   | Yes — back out, re-read upstream context            |
| Is each fix smaller and more targeted than the last?      | No — you're piling on; revert and pick one cause   |
| Have I read the actual code path, not just the test?      | No — read it now                                    |

### Step 5: Add New Tests

For new functionality, add tests that validate the **requirement**, not the
implementation. Example:

```typescript
describe('DarkModeToggle', () => {
  it('toggles theme when clicked', () => {
    // ...
  });

  it('persists user preference across reloads', () => {
    // ...
  });
});
```

#### Step 5a: Test Provenance Guard

After any new `*.test.*` / `*.unit.*` / `*.spec.*` file has been written
(or an existing one extended), invoke the test-provenance-guard companion
to catch tests-by-construction *before* the loop declares Phase 4 done.
See [Test Provenance Trigger](#test-provenance-trigger) below for the full
invocation contract.

### Step 6: Final Validation

Run the full suite per `plan.md`'s pre-PR verification commands:

```bash
npm test -- --coverage
npm run lint
npm run build
```

All three must pass before exiting Phase 4.

### Step 6b: Run the Executable Checks (Full Mode)

After the suite is green, run every check in `.agent/{branch}/checks.yaml`
per the [Executable Checks Loop](#executable-checks-loop) below. **Phase 4 is
not complete until every check's `status` is `pass`** (or a check was declared
`unsatisfiable` and the user approved). Self-skips (one log line) when no
`checks.yaml` exists — legacy plans and non-aw authors gate on the Acceptance
Criteria by judgment, as before.

### Step 7: Update Progress Log (Full Mode)

Append to `.agent/{branch}/plan.md`:

```markdown
- [2026-04-29T16:14:02Z] Phase 4: ThemeToggle test failing — wrong default state (Full Mode, cap=5)
- [2026-04-29T16:16:48Z] Phase 4: Fix attempt 1 — initialised with stored value, still failing
- [2026-04-29T16:18:02Z] Phase 4: Self-check before attempt 2 — meaningfully different (yes), prior failure understood (yes)
- [2026-04-29T16:19:11Z] Phase 4: Fix attempt 2 — provider order, passed
- [2026-04-29T16:22:30Z] Phase 4: Full suite passing, coverage 87%
```

Example with auto-replan triggering on confidence < 90%:

```markdown
- [2026-04-29T16:30:00Z] Phase 4: AuthGuard test failing (Full Mode, cap=5)
- [2026-04-29T16:32:10Z] Phase 4: Fix attempt 1 — token check guard, still failing
- [2026-04-29T16:34:22Z] Phase 4: Fix attempt 2 — refresh token flow, still failing
- [2026-04-29T16:36:45Z] Phase 4: Fix attempt 3 — context propagation, still failing
- [2026-04-29T16:39:00Z] Phase 4: Fix attempt 4 — middleware order, still failing
- [2026-04-29T16:41:30Z] Phase 4: Cap hit (5) — confidence(analysis) — 62% (root cause unclear)
- [2026-04-29T16:42:05Z] Phase 4: Auto-replan triggered (confidence < 90%) — holistic-analysis() invoked
- [2026-04-29T16:44:50Z] Phase 4: plan.v2.md created (auto-replan, "Auth flow" rewritten); plan.md updated; counter reset; auto_replan_used=True
- [2026-04-29T16:48:12Z] Phase 4: Resumed — fix attempt 1 (post-replan), session middleware moved earlier, passing
```

Use full ISO 8601 timestamps with hours, minutes, seconds.

### Step 8: Commit Test Changes

```bash
git add <test-files>
git commit -m "test(scope): add coverage for <feature>

- Unit tests for X
- Integration tests for Y
- Edge case coverage for Z"
```

Never add `Co-Authored-By` lines. See [`safety-guardrails.md`](./safety-guardrails.md).

---

## Executable Checks Loop

**Anchor:** `executable-checks`

Full Mode plans ship with `.agent/{branch}/checks.yaml` — one runnable check
per `AC-{n}` acceptance criterion, authored by the planner via
[`aw-create-plan` Step 2b](../../aw-create-plan/SKILL.md#step-2b-derive-checksyaml-from-the-acceptance-criteria).
This loop replaces "the LLM judges whether the criteria are met" with "the
harness runs the checks": `checks.yaml` is the Phase 4 **termination condition
and progress ledger**.

**Self-skip:** if `checks.yaml` does not exist, log
`executable-checks — skipped (no checks.yaml)` and gate on the Acceptance
Criteria by judgment (the pre-v3.15 behavior). Never bail because it's absent.

### The loop

```
for each check in checks.yaml with status pending or fail:
    1. Run `setup` (if not "none"), then `run`.
    2. Compare the observed output / exit code against `expect`.
    3. Match     → set status: pass. Log: `[TS] Phase 4: check AC-n — pass`
       Mismatch  → set status: fail. The check joins the failing-area queue —
                   fix the IMPLEMENTATION, then re-run. Failing checks count
                   toward the same mode-aware iteration cap (3 Lite / 5 Full)
                   and stuck-loop protocol as failing tests.
    4. kind: judge → resolve by rubric-scored LLM judgment against the AC's
       text; record the verdict + one-line rationale in the Progress Log.
       A judge check NEVER gates alone: it cannot be the only evidence that
       an irreversible step is safe, and a plan whose checks are majority
       judge-kind should be flagged to the user as weakly verifiable.

Phase 4 exit gate: every check status == pass
                   (or unsatisfiable + user approval — see below).
```

### Check-integrity rules (NON-RELAXABLE)

Verifier-driven loops are gameable — agents demonstrably special-case test
inputs, overload comparisons, and edit tests to force green (evidence:
[`references/planning-quality-research.md#5-failure-modes-that-gate-the-loop-idea`](../references/planning-quality-research.md#5-failure-modes-that-gate-the-loop-idea)).
The rules:

1. **Check definitions are executor-immutable.** The executor may flip
   `status:` freely. It may amend `run:`/`setup:` ONLY to make the draft
   command runnable against the real code, and every amendment requires a
   Progress Log entry: `[TS] Phase 4: check-run-amended AC-n — <why>`.
   `id:`, `requirement:`, `ears:`, and `expect:` are **never** edited by the
   executor. A diff that changes them is a hard stop → user escalation.
2. **Forbidden strategies — never satisfy a check by:** (a) modifying the
   check or a test to match wrong behavior, (b) overloading operators /
   comparisons to fake equality, (c) recording or replaying state to bypass
   the real code path, (d) special-casing the check's exact inputs
   (hardcoding expected outputs). If the only way to green is one of these,
   the check is failing for a reason — go to the abort affordance.
3. **Abort affordance.** When a check is genuinely unsatisfiable as specified
   (the criterion is wrong, contradicts another, or the expected behavior is
   unreachable), set `status: unsatisfiable` and **escalate to the user**
   with the evidence — do not iterate toward a workaround. An explicit
   give-up path is the single most effective anti-gaming lever; use it.
4. **All-green is necessary, not sufficient.** Passing checks means the
   runnable contract holds — not that intent is met. The full test suite,
   `reviewer` dispatch, and Phase 7 verifier gates all still run unchanged.

### Logging

```markdown
- [2026-04-29T16:50:00Z] Phase 4: executable-checks — 5 checks loaded (4 command, 1 judge)
- [2026-04-29T16:51:10Z] Phase 4: check AC-1 — pass (expect 401, got 401)
- [2026-04-29T16:52:30Z] Phase 4: check AC-3 — fail (expect 401, got 500); joining iteration loop
- [2026-04-29T16:55:02Z] Phase 4: check-run-amended AC-3 — port 3000 → 4001 (dev server config)
- [2026-04-29T16:58:44Z] Phase 4: check AC-3 — pass; all 5 checks green
```

Disable: remove this section's invocation from Step 6b — but note the
check-integrity rules are a hard invariant in
[`diagnostic-surface.md`](./diagnostic-surface.md#hard-invariants); weakening
them (as opposed to disabling the loop) is never a valid customization.

---

## Stuck-Loop Detection

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).
It defines the **mode-aware iteration cap** on the same failing area and the
**auto-replan protocol** that fires when the cap is hit.

### Definition

`iterations_on_same_area` tracks consecutive fix attempts on the **same**
failing test, file, or symptom. It resets to 0 every time:

- A test in that area passes, or
- The agent intentionally moves to a new area, or
- The auto-replan protocol completes (one-shot — see below), or
- The user provides a course correction.

### Mode-Aware Limit

| Mode      | `iteration_cap` | At cap                                                                  |
| --------- | --------------- | ----------------------------------------------------------------------- |
| Lite Mode | 3               | **STOP iterating.** Run the auto-replan protocol below.                 |
| Full Mode | 5               | **STOP iterating.** Run the auto-replan protocol below.                 |

The auto-replan protocol fires at `iterations_on_same_area == iteration_cap`,
regardless of mode. Lite stays tight (3) because simpler tasks should converge
quickly; Full gets one extra attempt (5) because well-scoped complex tasks
benefit from a slightly higher cap before mandatory escalation.

### Auto-Replan Protocol (at the cap)

Replanning when stuck — not just "try a different fix" — is the right move
when the agent's mental model is off. This protocol runs **automatically** when
the iteration cap is hit. The user is escalated to **only** if recovery fails.

```
when iterations_on_same_area == iteration_cap:

    Skill("confidence", "analysis")

    if confidence_score >= 90%:
        # We understand the root cause; user decides whether to accept risk.
        goto: Mandatory User Escalation (below)

    if confidence_score < 90%:
        if auto_replan_used == True:
            # Already retried once after replan and still stuck.
            goto: Mandatory User Escalation (below)

        Skill("holistic-analysis")
        Skill("aw-create-plan")   # writes plan.v{N+1}.md + updates plan.md
        iterations_on_same_area = 0
        auto_replan_used = True
        Resume Phase 4 iteration loop ONCE MORE.
        # If the loop hits the cap again, the guard above forces escalation.
```

The `auto_replan_used` flag is the **one-shot guard** — it prevents an infinite
`analysis → holistic → replan → fail` cycle. After one replan-and-retry,
the next cap hit goes straight to user escalation.

### Companion Behavior

| Skill                       | Behavior                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `confidence("analysis")` installed | Returns confidence score + root-cause / outcome-confidence findings      |
| `confidence` missing        | Logs `not available, continuing`; treat as confidence < 90% (conservative default)  |
| `holistic-analysis` installed | Re-traces execution path end-to-end; output feeds the next `aw-create-plan` invocation, which writes `plan.v{N+1}.md` and updates `plan.md` |
| `holistic-analysis` missing | Logs `not available, continuing`; perform a manual end-to-end trace yourself        |

### Mandatory User Escalation

Reached when **either**:

- Confidence is >= 90% at the cap (we know what's wrong; user decides), **or**
- Confidence was < 90%, auto-replan ran, the loop resumed, and the cap was hit
  again.

**Step 1: Present to user**

A concise summary message containing:

- The failing test / area description
- All fix hypotheses tried (one line each — include both pre- and post-replan
  attempts when applicable)
- Confidence score and analysis findings
- Whether auto-replan was attempted, and the new mental model from
  `holistic-analysis` if so
- The current understanding of root cause

**Step 2: Ask the user**

Exactly three options, plain language:

| Option                | Meaning                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `continue`            | User accepts the risk; reset counter to 0 and try once more        |
| `try different approach` | User wants a fresh analysis path — go to [Stuck Recovery](#stuck-recovery) |
| `stop`                | Hand control back; do not iterate further                          |

**Step 3: Exit loop based on response.**

**Step 4: Capture the lesson.** Before or immediately after escalation, write a
lesson per [Lessons Write](#lessons-write) so the failing area, the hypotheses
tried, and the resolution are available to future runs. Skip silently if
`persistent-memory` is not installed.

### Logging

Log every step of the auto-replan protocol in `plan.md` Progress Log:

```markdown
- [2026-04-29T16:35:10Z] Phase 4: cap hit (3 iterations on ThemeToggle initial state, Lite Mode)
- [2026-04-29T16:35:42Z] Phase 4: confidence(analysis) — invoked (74%, suspects provider boundary)
- [2026-04-29T16:35:55Z] Phase 4: confidence < 90% — auto-replan triggered
- [2026-04-29T16:36:30Z] Phase 4: holistic-analysis() — re-traced provider chain, identified missing context default
- [2026-04-29T16:37:05Z] Phase 4: plan.v2.md created (auto-replan); plan.md updated; counter reset; auto_replan_used=True
- [2026-04-29T16:40:18Z] Phase 4: Resumed iteration — fix attempt 1 (post-replan), still failing through cap
- [2026-04-29T16:42:00Z] Phase 4: Cap hit again — auto_replan_used guard fires; escalating to user
```

Disable / adjust: change `iteration_cap` defaults or the 90% confidence
threshold in this file. Registry:
[`companion-skills.md`](./companion-skills.md#registry).

---

## Stuck Recovery

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).
It defines what happens when the user, after the **mandatory escalation**, asks
to **try a different approach**.

> **Note:** `holistic-analysis` also fires **automatically** during the
> [auto-replan protocol](#auto-replan-protocol-at-the-cap) when confidence is
> below 90%. This section covers the case where the user explicitly requests a
> further fresh-analysis pass after escalation — typically because auto-replan
> already ran once and hit the one-shot guard, or because the user wants a
> different framing than the one auto-replan produced.

### Trigger

User selected `try different approach` from the mandatory user escalation menu.

### Action

```bash
Skill("holistic-analysis")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Purpose                        | Step back, re-trace the **entire** execution path end-to-end before any further fix attempts |
| When invoked here              | After the mandatory user escalation, when the user requested a fresh analysis path |
| Also invoked automatically     | Inside the [auto-replan protocol](#auto-replan-protocol-at-the-cap) when `confidence(analysis) < 90%` |
| If skill missing               | Log `not available, continuing`; perform a manual end-to-end trace yourself: entry point → each contract boundary → data flow → exit |

### After Holistic Analysis

1. Reset `iterations_on_same_area = 0` (this is a genuinely new attempt).
2. **Re-invoke `Skill("aw-create-plan")`** with the new mental model — the
   skill writes the next `plan.v{N+1}.md` snapshot and overwrites `plan.md`.
   Replace the obsolete reasoning in the new content; do not just append.
   Earlier `plan.v*.md` snapshots are preserved untouched as audit trail.
3. Resume the iteration loop in [Step 3](#step-3-the-iteration-loop) — the
   mode-aware iteration cap applies again to the new area.

If a subsequent escalation also stalls at the cap, **do not** invoke
`holistic-analysis` again automatically from this path. The auto-replan
one-shot guard already governs in-loop replans; user-driven replans are
explicit and the user should decide whether to continue, refactor the
approach, or stop.

### Logging

```markdown
- [2026-04-29T16:42:18Z] Phase 4: holistic-analysis() — invoked (user-driven, re-traced provider chain, identified missing context default)
- [2026-04-29T16:45:50Z] Phase 4: plan.v3.md created — ThemeProvider must mount above StoreProvider; plan.md updated; counter reset to 0
```

Disable: remove the `Skill("holistic-analysis")` call from this section **and**
from the auto-replan protocol above. Registry:
[`companion-skills.md`](./companion-skills.md#registry).

---

## When to Stop and Ask (beyond stuck-loop)

| Situation                                              | Action                                                |
| ------------------------------------------------------ | ----------------------------------------------------- |
| Tests pass but don't actually validate the requirement | Stop — ask the user to confirm acceptance criteria    |
| Discovered requirement ambiguity                       | Stop — return to Phase 0 questions                    |
| Need an architectural decision                         | Stop — present options, do not pick one autonomously  |
| Same failure shape across two recovery cycles          | Stop — hand control back to the user                  |

See [`safety-guardrails.md`](./safety-guardrails.md) for the broader hard-stop
catalogue.

---

## Lessons Write

**Anchor:** `lessons-write`

When the stuck-loop hits the cap (and especially at mandatory user escalation),
capture what was learned so the next run does better. This is the **fast tier**
of the self-improvement loop — full contract in
[`self-improvement-loop.md`](./self-improvement-loop.md#fast-tier--write-lessons).

Classify the candidate lesson — see the table in
[`self-improvement-loop.md#fast-tier--write-lessons`](./self-improvement-loop.md#fast-tier--write-lessons).
Universal lessons land in `home`; project-bound lessons land in
`project-shared` only when the team has opted in (the directory exists),
otherwise fall back to `home` with an opt-in hint:

```
# Universal candidate — always home.
Skill("persistent-memory", "write aw-lessons --tier home --auto")

# Project-bound candidate — opt-in gated.
if [ -f memory/aw-lessons/INDEX.md ]; then
  Skill("persistent-memory", "write aw-lessons --tier project-shared --auto")
else
  Skill("persistent-memory", "write aw-lessons --tier home --auto")
  log "Project-bound lesson fell back to home (no committed memory/aw-lessons/). Opt in once with: Skill(\"persistent-memory\", \"write aw-lessons --tier project-shared\")"
fi
```

Capture: the failing area, every hypothesis tried, what finally worked (or that
it didn't), and the **earliest phase** that should have caught it. The lesson is
**procedural** — phrase *"What to do next time"* as a prescriptive, testable
instruction (see the schema in the loop file).

- `--auto` skips the consent preview (the loop cannot pause per write); the
  **privacy pre-flight still runs** — never store secrets / PII. The privacy
  bar is stricter for `--tier project-shared` writes (content lands in the
  repo and every collaborator sees it).
- A recurring lesson resolves to **UPDATE** and bumps `seen_count` — it does not
  duplicate. When `seen_count >= 3`, surface the tier-appropriate promotion
  suggestion from [`self-improvement-loop.md#lesson-promotion`](./self-improvement-loop.md#lesson-promotion)
  (skill source for `home`; repo rules for `project-shared`).

Log:

```markdown
- [TIMESTAMP] Phase 4: persistent-memory(write aw-lessons --tier home) — 1 lesson (UPDATE, seen_count→3); promotion suggested (skill source)
- [TIMESTAMP] Phase 4: persistent-memory(write aw-lessons --tier project-shared) — 1 lesson (ADD); repo opted in
- [TIMESTAMP] Phase 4: persistent-memory(write aw-lessons --tier home) — 1 project-bound lesson fell back to home (no committed memory/aw-lessons/)
- [TIMESTAMP] Phase 4: persistent-memory(write aw-lessons) — not available, continuing
```

Disable by removing this invocation (see
[`companion-skills.md`](./companion-skills.md#registry)).

---

## Test Provenance Trigger

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).
It defines when and how to invoke the `test-provenance-guard` companion to
catch tests-by-construction in the autonomous loop.

**When:** any new `*.test.*` / `*.unit.*` / `*.spec.*` file has been written
or extended in this Phase 4 iteration.

```bash
Skill("test-provenance-guard", "--diff --base $(git merge-base HEAD main) --fix")
```

> **Autofix is allowed inside the autonomous loop, but only behind a
> pre-heal confidence gate.** The skill MUST run `Skill("confidence", "code")`
> on its own proposed extract-and-rewrite **before** touching any file. The
> autofix proceeds only when **both** of these are true:
>
> 1. **Pre-heal:** `confidence(code) ≥ 90 %` on the proposed extraction.
> 2. **Post-heal:** the three existing mechanical gates in
>    `test-provenance-guard/rules/self-heal.md` Step 4 (build passes,
>    target test passes, mutation re-verifies) all pass.
>
> If pre-heal confidence is < 90 %, the skill **does not write any files**
> and emits the finding as `heal-skipped-low-confidence`. If a post-heal
> gate fails, the heal is reverted with `git restore` and the finding is
> emitted as `heal-failed`. In both cases, the autonomous-workflow
> stuck-loop protocol takes over (per-iteration self-check →
> `confidence(analysis)` → `holistic-analysis` auto-replan → user escalation).

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Frequency                      | Once per Phase 4 iteration after new tests are committed            |
| What it checks                 | (1) static — test file imports the SUT and does not shadow exported names. (2) mutation — sabotaging the SUT body makes the test FAIL |
| Self-heal authority            | **Confidence-gated autofix.** `--fix` is allowed in the autonomous loop, but the skill must clear `confidence(code) ≥ 90 %` before mutating files and the three post-heal mechanical gates after. Either failure ⇒ no autonomous refactor; the finding is reported to the Progress Log and the stuck-loop protocol handles it |
| If pre-heal confidence < 90 %  | Emit `heal-skipped-low-confidence`; do not write any files. Stuck-loop protocol takes over |
| If a post-heal gate fails      | Revert the heal with `git restore`; emit `heal-failed`. Stuck-loop protocol takes over     |
| If skill missing               | Log `test-provenance-guard() — not available, continuing` and proceed |
| Progress Log entry             | `[TIMESTAMP] Phase 4: test-provenance-guard — N file(s), M finding(s), K healed (confidence X%), L skipped-low-confidence` |

The skill addresses the failure mode where an LLM-authored test re-implements
the function under test as a local copy and asserts against that copy — tests
pass, CI is green, but no regression protection exists.
See the skill's [PR #12340 post-mortem](../../../quality/test-provenance-guard/references/pr-12340-postmortem.md)
for the origin case.

Disable: remove the `Skill("test-provenance-guard", ...)` invocation from
[Step 5a](#step-5a-test-provenance-guard) and from this section.
Registry: [`companion-skills.md`](./companion-skills.md#registry).

---

## Testing Checklist

- [ ] Test strategy chosen per change type
- [ ] Existing tests run, regressions fixed
- [ ] Iterated on **one** failing area at a time
- [ ] Mode-aware iteration cap honored — 3 (Lite) / 5 (Full), not 6 or 20
- [ ] Per-iteration lightweight self-check ran from iteration 2 onward (NOT a full `confidence` call)
- [ ] Per-iteration in-loop self-reflection completed after each fix
- [ ] `confidence(analysis)` invoked automatically when cap hit
- [ ] `holistic-analysis` invoked automatically when confidence < 90% (auto-replan)
- [ ] `plan.v{N+1}.md` snapshot created and `plan.md` updated after auto-replan (via `aw-create-plan`)
- [ ] One-shot guard respected — auto_replan_used not bypassed
- [ ] User escalation triggered when confidence >= 90% OR auto-replan exhausted
- [ ] `persistent-memory(write aw-lessons)` invoked at stuck-loop escalation; promotion suggested if `seen_count >= 3` (anchor: `lessons-write`)
- [ ] New tests added for new functionality
- [ ] `test-provenance-guard` invoked after new test files written; findings healed or escalated
- [ ] Full suite + lint + build all green
- [ ] Every `checks.yaml` check `status: pass` — or `unsatisfiable` escalated and user-approved; skip logged if no `checks.yaml` (anchor: `executable-checks`)
- [ ] No check definition edited (`id`/`requirement`/`ears`/`expect` untouched); every `run:`/`setup:` amendment has a `check-run-amended` Progress Log entry
- [ ] Progress Log updated in `.agent/{branch}/plan.md` (Full Mode)
- [ ] Ready for Phase 5 documentation

## References

- [`companion-skills.md`](./companion-skills.md) — full companion registry and disable instructions
- [`safety-guardrails.md`](./safety-guardrails.md) — hard stops and limits
- [`phase-3-implementation.md`](./phase-3-implementation.md) — prior phase (mirrors the 3-attempt cap on fast-check failures)
- [`phase-4-spec-verification.md`](./phase-4-spec-verification.md) — spec-driven UI verification sub-rule (runs before this loop for UI tasks)
- [`phase-5-documentation.md`](./phase-5-documentation.md) — next phase
- [Ralph Wiggum Pattern](https://ralph-wiggum.ai) — research origin of iterate-until-done
- [Fast Feedback Loops (Addy Osmani)](https://addyosmani.com/blog/ai-coding-workflow/) — research origin of self-reflection cadence
