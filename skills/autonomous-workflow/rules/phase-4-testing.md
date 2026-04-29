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

Run the project's test suite and iterate until tests pass — but with a **hard
3-iteration limit on the same failing area** before escalating. The 3-iteration
limit is the single biggest cost-saver in the workflow: it stops the agent
burning tokens on hallucinated fixes when the root-cause analysis is wrong.

Companions invoked from this phase **skip silently if not installed** — see
[`companion-skills.md`](./companion-skills.md) for the full registry.

## Core Principles

| Principle                                       | What it means                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------- |
| Iterate, but with a hard limit                  | 3 iterations on the same failing area, then escalate                |
| Focus on ONE failing test at a time             | Don't fix multiple simultaneously — root causes get tangled         |
| Self-reflect every iteration                    | "Am I making progress, or repeating attempts?"                      |
| Fix root causes, not symptoms                   | A passing test on a wrong fix is worse than a red one               |
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

```
iterations_on_same_area = 0
current_area = <descriptor of the failing test/file/symptom>

while not all_tests_pass:
    iterations_on_same_area += 1

    if iterations_on_same_area == 3:
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

### Step 4: Self-Reflection (every iteration, not every 3)

Ask the following before applying the next fix:

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
- [2026-04-29T16:14:02Z] Phase 4: ThemeToggle test failing — wrong default state
- [2026-04-29T16:16:48Z] Phase 4: Fix attempt 1 — initialised with stored value, still failing
- [2026-04-29T16:19:11Z] Phase 4: Fix attempt 2 — provider order, passed
- [2026-04-29T16:22:30Z] Phase 4: Full suite passing, coverage 87%
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
It defines the **3-iteration hard limit** on the same failing area.

### Definition

`iterations_on_same_area` tracks consecutive fix attempts on the **same**
failing test, file, or symptom. It resets to 0 every time:

- A test in that area passes, or
- The agent intentionally moves to a new area, or
- The user provides a course correction.

### Limit

| `iterations_on_same_area` | Action                                                                  |
| ------------------------- | ----------------------------------------------------------------------- |
| 1                         | Apply fix, re-run, self-reflect                                         |
| 2                         | Apply fix, re-run, self-reflect — be explicit about hypothesis change   |
| 3                         | **STOP iterating.** Run the escalation sequence below.                  |

### Escalation Sequence (at iteration 3)

```bash
# Step 1: Run confidence gate in bug-analysis mode
Skill("confidence", "bug-analysis")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| If skill installed             | Returns confidence score + bug analysis findings                    |
| If skill missing               | Logs `not available, continuing`; you summarise attempts manually   |

**Step 2: Present to user**

A concise summary message containing:

- The failing test / area description
- The 3 fix hypotheses tried (one line each)
- The current understanding of root cause
- Confidence findings (if available)

**Step 3: Ask the user**

Exactly three options, plain language:

| Option                | Meaning                                                            |
| --------------------- | ------------------------------------------------------------------ |
| `continue`            | User accepts the risk; reset counter to 0 and try once more        |
| `try different approach` | User wants a fresh analysis — go to [Stuck Recovery](#stuck-recovery) |
| `stop`                | Hand control back; do not iterate further                          |

**Step 4: Exit loop based on response.**

### Logging

Log every step of the escalation in `plan.md` Progress Log:

```markdown
- [2026-04-29T16:35:10Z] Phase 4: stuck-loop hit (3 iterations on ThemeToggle initial state)
- [2026-04-29T16:35:42Z] Phase 4: confidence(bug-analysis) — invoked (74%, suspects provider boundary)
- [2026-04-29T16:38:04Z] Phase 4: User chose "try different approach" — entering Stuck Recovery
```

Disable / adjust: change the `== 3` threshold in this file. Registry:
[`companion-skills.md`](./companion-skills.md#registry).

---

## Stuck Recovery

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).
It defines what happens when the user, after the 3-iteration escalation, asks
to **try a different approach**.

### Trigger

User selected `try different approach` from the escalation menu above.

### Action

```bash
Skill("holistic-analysis")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Purpose                        | Step back, re-trace the **entire** execution path end-to-end before any further fix attempts |
| When invoked                   | Only after Stuck-Loop Detection has fired and user requested fresh analysis |
| If skill missing               | Log `not available, continuing`; perform a manual end-to-end trace yourself: entry point → each contract boundary → data flow → exit |

### After Holistic Analysis

1. Reset `iterations_on_same_area = 0` (this is a genuinely new attempt).
2. State the new mental model in one paragraph in `plan.md`.
3. Resume the iteration loop in [Step 3](#step-3-the-iteration-loop) — the 3-iteration
   limit applies again to the new area.

If the second escalation also stalls at 3 iterations, **do not** invoke
`holistic-analysis` a second time automatically. Hand control back to the user
and let them decide whether to continue, refactor the approach, or stop.

### Logging

```markdown
- [2026-04-29T16:42:18Z] Phase 4: holistic-analysis() — invoked (re-traced provider chain, identified missing context default)
- [2026-04-29T16:45:50Z] Phase 4: New mental model — ThemeProvider must mount above StoreProvider; counter reset to 0
```

Disable: remove the `Skill("holistic-analysis")` call from this section.
Registry: [`companion-skills.md`](./companion-skills.md#registry).

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
- [ ] 3-iteration limit honored — escalation triggered at 3, not 6 or 20
- [ ] Self-reflected every iteration
- [ ] `confidence(bug-analysis)` invoked when limit hit
- [ ] `holistic-analysis` invoked only when user asked for fresh analysis
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
