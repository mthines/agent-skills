---
name: test-provenance-guard
description: >
  Detects tests that pass by construction — tests that define a private
  copy of the function under test instead of importing the production
  module — and self-heals by extracting the inline logic to an exported
  function, updating production callers, and rewriting the test to
  import the export. Two checks: (1) static — the test file must import
  the SUT and must not shadow its exported names; (2) mutation —
  blanking the production function body re-runs the test and expects
  failure. Runs autonomously inside autonomous-workflow Phase 4 and as
  a slash command for human-driven PR review. Use when adding new tests
  for existing or refactored code, when CI is green but you are unsure
  whether the tests actually exercise production, or when reviewing a
  PR for tests-by-construction. Triggers on "test provenance", "tests
  by construction", "verify tests cover real code", "tests duplicate
  logic", "mutation sanity check", "are these tests fake",
  "/test-provenance-guard".
disable-model-invocation: false
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: applied
  tags:
    - testing
    - test-quality
    - mutation-testing
    - tests-by-construction
    - self-heal
    - autonomous-workflow
    - phase-4
    - regression-protection
---

# Test Provenance Guard

Catches the failure mode where a new test file *re-implements* the function it claims to test, then asserts against its own copy.
The tests pass.
The CI is green.
The tests provide zero regression protection.

This skill detects that pattern and, when invoked autonomously, fixes it without user intervention.

> **This `SKILL.md` is a thin index.**
> Detailed procedures live in `rules/*.md` and load on demand.
> The case-study post-mortem and failure-mode taxonomy live in `references/*.md`.

---

## Contents

- [Inputs](#inputs)
- [Workflow](#workflow)
- [Quick Decision Flow](#quick-decision-flow)
- [Required Reading by Phase](#required-reading-by-phase)
- [Output Contract](#output-contract)
- [Core Principles](#core-principles)
- [Anti-patterns](#anti-patterns)
- [Definition of Done](#definition-of-done)
- [Related Skills](#related-skills)

---

## Inputs

Parse `$ARGUMENTS`:

| Argument                     | Default                                    | Meaning                                                                                |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `--diff`                     | off                                        | Discover changed test files via `git diff --name-only <base>...HEAD`.                  |
| `--base <ref>`               | `main`                                     | Base ref for `--diff`.                                                                 |
| `<positional paths>`         | —                                          | Explicit test files to check (overrides `--diff`).                                     |
| `--mode static\|mutate\|both` | `both`                                     | Which checks to run.                                                                   |
| `--fix`                      | **on** when called from autonomous-workflow; **off** for slash invocation | Apply self-heal: extract logic, rewrite tests, re-verify. **Gated by `confidence(code) ≥ 90 %`** unless `--no-confidence-gate` is passed. |
| `--report-only`              | off                                        | Force off `--fix` even when called from autonomous-workflow.                           |
| `--no-confidence-gate`       | off                                        | Manual override — skip the pre-heal confidence gate. Reserved for human-driven slash invocations; never set inside the autonomous loop. |

The skill defaults to `--fix` in the autonomous loop, but **autofix is gated by `Skill("confidence", "code") ≥ 90 %`** before any file is mutated (see [Self-Heal Step 3](./rules/self-heal.md#step-3--pre-heal-confidence-gate-mandatory-when-running-inside-autonomous-workflow)). Below the threshold, the heal is **skipped**, the finding is emitted as `heal-skipped-low-confidence`, and the autonomous-workflow's stuck-loop protocol takes over.

Manual slash invocation defaults to report-only so a human can review the proposed extraction first; pass `--fix` explicitly to apply. The confidence gate is recommended for manual invocations too, but a human can pass `--no-confidence-gate` to override.

If no test files resolve from either `--diff` or positional args, exit cleanly with `no test files in scope, skipping`.

---

## Workflow

| Phase | Name                       | Rule file                                                          | Gate                                                                              |
| ----- | -------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 1     | Static check               | [`rules/static-check.md`](./rules/static-check.md)                 | Every test file imports the SUT; no shadowed exports                              |
| 2     | Mutation check             | [`rules/mutation-check.md`](./rules/mutation-check.md)             | Sabotaged production code makes the test FAIL                                     |
| 3     | Self-heal (if `--fix`)     | [`rules/self-heal.md`](./rules/self-heal.md)                       | `confidence(code) ≥ 90 %` on the proposed extraction; extracted helper exists, test imports it, mutation check now passes |

Phase 1 is mandatory.
Phase 2 runs only when Phase 1 passes (a static-shadow finding already explains the failure — no need to mutate).
Phase 3 runs only on detected findings *and* only when `--fix` is on *and* the pre-heal confidence gate clears (≥ 90 %).

---

## Quick Decision Flow

```
for each test file in scope:
    finding = static_check(file)                 # rules/static-check.md
    if finding.kind == "shadowed-export":
        if --fix: gated_self_heal(finding)        # rules/self-heal.md
        else:    record(finding)
        continue

    if finding.kind == "no-sut-import":
        record(finding)                           # cannot mutate without an SUT
        continue

    if mode in {"mutate", "both"}:
        finding = mutation_check(file)            # rules/mutation-check.md
        if finding.kind == "test-survives-sabotage":
            if --fix: gated_self_heal(finding)
            else:    record(finding)

report(findings)
exit code = 0 if all healed or no findings, else 1


def gated_self_heal(finding):
    proposal = plan_extraction(finding)            # Step 1+2 of self-heal
    if not --no-confidence-gate:
        score = Skill("confidence", "code", proposal)
        if score < 90:
            record(finding, status="heal-skipped-low-confidence", score=score)
            return
    self_heal(finding, proposal)                    # Steps 4-6 of self-heal
```

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                                           |
| ----- | ------------------------------------------------------------------------------- |
| 1     | [`rules/static-check.md`](./rules/static-check.md)                              |
| 2     | [`rules/mutation-check.md`](./rules/mutation-check.md)                          |
| 3     | [`rules/self-heal.md`](./rules/self-heal.md)                                    |
| —     | [`references/failure-modes.md`](./references/failure-modes.md) — taxonomy        |
| —     | [`references/pr-12340-postmortem.md`](./references/pr-12340-postmortem.md) — origin case |

---

## Output Contract

After every run, emit a structured report.
The autonomous-workflow Phase 4 logger consumes the JSON line; humans read the Markdown summary.

```
TEST PROVENANCE REPORT
======================
Files checked: <N>
Findings:
  - <test-file>:<line> — <kind> — <one-line evidence>
    Action: <healed | reported | skipped | skipped-low-confidence>
    Confidence (if gated): <N>%

Self-heal summary (if --fix):
  - Pre-heal confidence: <N>% (gate ≥ 90 %)
  - Extracted <symbol> from <prod-file>:<line> → <new-export-file>:<line>
  - Rewrote <test-file> to import <symbol>
  - Mutation check after heal: PASS

Exit: <0 | 1>
```

When called from `autonomous-workflow` Phase 4, also append one line to `.agent/{branch}/plan.md`'s Progress Log:

```markdown
- [<ISO-8601>] Phase 4: test-provenance-guard — <N> file(s) checked, <M> finding(s), <K> healed (confidence ≥ 90 %), <L> skipped-low-confidence
```

---

## Core Principles

1. **A test that does not import the production module is not a test of that module.**
   The static check is the cheapest, strongest signal.
2. **A test that survives sabotage of its claimed target is by-construction.**
   Mutation is the second-line evidence — slow but conclusive.
3. **Self-heal is a refactor, not a rewrite.**
   Extract the inline logic verbatim; do not redesign the function while moving it.
4. **Never silently change test assertions.**
   Self-heal moves logic and rewrites imports; assertions are preserved unchanged.
5. **Report, then act.**
   Even when `--fix` is on, the report is emitted before the heal so the audit trail survives.
6. **Skip cleanly when out of scope.**
   No test files? Exit 0.
   Test files in unsupported languages?
   Skip them with a one-line note and continue.

---

## Anti-patterns

- **Treating a passing test as proof the test is correct.**
  A test can pass for the wrong reason — that is the entire raison d'être of this skill.
- **Mutating without restoring.**
  Every sabotage step is paired with a restore — `git restore <sut-file>` when the file was clean, or moving the recorded backup over it when it was dirty — see `rules/mutation-check.md`.
- **Self-healing with a redesign.**
  Moving logic and improving it in the same step is two refactors masquerading as one — split them.
- **Running mutation when static already failed.**
  Wasted tokens.
  Skip Phase 2 when Phase 1 already produced a finding.
- **Asking the user during autonomous runs.**
  This skill self-heals when `--fix` is on; if it cannot, it reports the finding and exits — the autonomous-workflow stuck-loop protocol takes over.

---

## Definition of Done

- [ ] Every test file in scope passed Phase 1 (or was healed).
- [ ] Every test file in scope passed Phase 2 (or was healed).
- [ ] Self-heal summary lists the extraction(s) with file paths and line numbers.
- [ ] All originally passing tests still pass after self-heal (`<TEST_CMD>` re-run is green).
- [ ] Report emitted in the structured format above.
- [ ] When called from autonomous-workflow, the Progress Log line is appended.

---

## Related Skills

- [`autonomous-workflow`](../../workflow/autonomous-workflow/SKILL.md) — invokes this skill from Phase 4 Step 5.
- [`tdd`](../../quality/tdd/SKILL.md) — Test-After Mode's "mutate to verify" rule is the conceptual ancestor of Phase 2 here.
- [`code-quality`](../code-quality/SKILL.md) — Pass 12 ("Testability") covers adjacent design issues; this skill targets the specific by-construction failure.
- [`confidence`](../confidence/SKILL.md) — when self-heal cannot resolve a finding, the autonomous-workflow Phase 4 stuck-loop protocol calls `confidence(analysis)` next.
