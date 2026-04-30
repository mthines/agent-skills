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
| Auto-replan on low confidence                   | When stuck and confidence < 90%, trigger holistic-analysis + plan.md update |
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

### Step 6: Final Validation

Run the full suite per `plan.md`'s pre-PR verification commands:

```bash
npm test -- --coverage
npm run lint
npm run build
```

All three must pass before exiting Phase 4.

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
- [2026-04-29T16:41:30Z] Phase 4: Cap hit (5) — confidence(bug-analysis) — 62% (root cause unclear)
- [2026-04-29T16:42:05Z] Phase 4: Auto-replan triggered (confidence < 90%) — holistic-analysis() invoked
- [2026-04-29T16:44:50Z] Phase 4: plan.md "Auth flow" section regenerated; counter reset; auto_replan_used=True
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

    Skill("confidence", "bug-analysis")

    if confidence_score >= 90%:
        # We understand the root cause; user decides whether to accept risk.
        goto: Mandatory User Escalation (below)

    if confidence_score < 90%:
        if auto_replan_used == True:
            # Already retried once after replan and still stuck.
            goto: Mandatory User Escalation (below)

        Skill("holistic-analysis")
        Update affected sections of plan.md with the new mental model.
        iterations_on_same_area = 0
        auto_replan_used = True
        Resume Phase 4 iteration loop ONCE MORE.
        # If the loop hits the cap again, the guard above forces escalation.
```

The `auto_replan_used` flag is the **one-shot guard** — it prevents an infinite
`bug-analysis → holistic → replan → fail` cycle. After one replan-and-retry,
the next cap hit goes straight to user escalation.

### Companion Behavior

| Skill                       | Behavior                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `confidence("bug-analysis")` installed | Returns confidence score + bug analysis findings                         |
| `confidence` missing        | Logs `not available, continuing`; treat as confidence < 90% (conservative default)  |
| `holistic-analysis` installed | Re-traces execution path end-to-end; output drives plan.md regeneration           |
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
- Confidence score and bug-analysis findings
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

### Logging

Log every step of the auto-replan protocol in `plan.md` Progress Log:

```markdown
- [2026-04-29T16:35:10Z] Phase 4: cap hit (3 iterations on ThemeToggle initial state, Lite Mode)
- [2026-04-29T16:35:42Z] Phase 4: confidence(bug-analysis) — invoked (74%, suspects provider boundary)
- [2026-04-29T16:35:55Z] Phase 4: confidence < 90% — auto-replan triggered
- [2026-04-29T16:36:30Z] Phase 4: holistic-analysis() — re-traced provider chain, identified missing context default
- [2026-04-29T16:37:05Z] Phase 4: plan.md "Theming" section regenerated; counter reset; auto_replan_used=True
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
| Also invoked automatically     | Inside the [auto-replan protocol](#auto-replan-protocol-at-the-cap) when `confidence(bug-analysis) < 90%` |
| If skill missing               | Log `not available, continuing`; perform a manual end-to-end trace yourself: entry point → each contract boundary → data flow → exit |

### After Holistic Analysis

1. Reset `iterations_on_same_area = 0` (this is a genuinely new attempt).
2. **Update affected sections of `plan.md`** with the new mental model — replace
   the obsolete reasoning, don't just append a paragraph.
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
- [2026-04-29T16:45:50Z] Phase 4: plan.md "Theming" section regenerated — ThemeProvider must mount above StoreProvider; counter reset to 0
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

## Testing Checklist

- [ ] Test strategy chosen per change type
- [ ] Existing tests run, regressions fixed
- [ ] Iterated on **one** failing area at a time
- [ ] Mode-aware iteration cap honored — 3 (Lite) / 5 (Full), not 6 or 20
- [ ] Per-iteration lightweight self-check ran from iteration 2 onward (NOT a full `confidence` call)
- [ ] Per-iteration in-loop self-reflection completed after each fix
- [ ] `confidence(bug-analysis)` invoked automatically when cap hit
- [ ] `holistic-analysis` invoked automatically when confidence < 90% (auto-replan)
- [ ] `plan.md` regenerated for affected sections after auto-replan
- [ ] One-shot guard respected — auto_replan_used not bypassed
- [ ] User escalation triggered when confidence >= 90% OR auto-replan exhausted
- [ ] New tests added for new functionality
- [ ] Full suite + lint + build all green
- [ ] Progress Log updated in `.agent/{branch}/plan.md` (Full Mode)
- [ ] Ready for Phase 5 documentation

## References

- [`companion-skills.md`](./companion-skills.md) — full companion registry and disable instructions
- [`safety-guardrails.md`](./safety-guardrails.md) — hard stops and limits
- [`phase-3-implementation.md`](./phase-3-implementation.md) — prior phase (mirrors the 3-attempt cap on fast-check failures)
- [`phase-5-documentation.md`](./phase-5-documentation.md) — next phase
- [Ralph Wiggum Pattern](https://ralph-wiggum.ai) — research origin of iterate-until-done
- [Fast Feedback Loops (Addy Osmani)](https://addyosmani.com/blog/ai-coding-workflow/) — research origin of self-reflection cadence
