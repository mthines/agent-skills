---
title: 'Phase 4: Spec-Driven UI Verification (aw-tester sub-rule)'
impact: HIGH
tags:
  - phase-4
  - aw-tester
  - spec-verification
  - ui
  - aw-targets
---

# Phase 4: Spec-Driven UI Verification

## Contents

- [Overview](#overview)
- [When this sub-rule applies](#when-this-sub-rule-applies)
- [Prerequisites](#prerequisites)
- [Step 1: Detect the aw-target](#step-1-detect-the-aw-target)
- [Step 2: Run aw-tester](#step-2-run-aw-tester)
- [Step 3: Iterate on red](#step-3-iterate-on-red)
- [Step 4: Spec promotion](#step-4-spec-promotion)
- [No-UI-surface escape](#no-ui-surface-escape)
- [Logging](#logging)
- [Checklist](#checklist)
- [References](#references)

---

## Overview

This sub-rule slots into Phase 4 **before** the lint/type/test gates. It
gives the executor a deterministic, spec-driven check on UI correctness —
a middle layer between English acceptance criteria in `plan.md` and saved
Playwright test files.

Specs are authored by the planner in `specs.md` alongside `plan.md` (see
[`phase-1-planning.md` — Spec Emission](#spec-emission-anchor)). Most specs
are `verify-only` (ephemeral); a small subset are `critical-path` and get
promoted to saved `*.spec.ts` via the `e2e-testing` skill's Generator.

**This sub-rule is separate from the main `phase-4-testing.md` rule.** It runs
before the unit/integration test loop, not as a replacement for it.

---

## When this sub-rule applies

Run this sub-rule when ALL of the following are true:

1. `.agent/{branch}/specs.md` exists (the planner emitted it).
2. `.claude/aw-targets/` contains at least one aw-target file.
3. The plan's `## File changes` table includes at least one UI file (`*.tsx`,
   `*.jsx`, `*.css`, `*.vue`, `*.svelte`, a route/page file, or a layout file).
4. The aw-target's auth state is valid (see [Prerequisites](#prerequisites)).

If any condition is false, skip this sub-rule entirely — log one line and
proceed to the normal Phase 4 test loop:

```markdown
- [TIMESTAMP] Phase 4: spec-verification — skipped ({reason})
```

Valid skip reasons:
- `no specs.md found`
- `no aw-target defined at .claude/aw-targets/`
- `no UI files in plan`
- `auth.strategy: manual — authed specs will be skipped by aw-tester`
- `aw-tester agent not available`

---

## Prerequisites

### Aw-Target file

The aw-target file must exist at `.claude/aw-targets/{aw_target_name}.yml`, where
`aw_target_name` comes from the `Target:` header in `specs.md`.

If the aw-target file is missing, **halt and tell the user**:

```
Spec verification cannot run: no aw-target defined at .claude/aw-targets/{aw_target_name}.yml.
Run /aw-setup to scaffold the aw-target (one-time setup, ~2 minutes).
Spec verification will be skipped until the aw-target is configured.
```

Do NOT attempt to scaffold the aw-target yourself. `/aw-setup` is the user-run
setup flow.

### Auth storage state freshness

If `auth.strategy: storage-state` and the storage state file is missing or its
`mtime` is older than 7 days, warn but do not block:

```markdown
- [TIMESTAMP] Phase 4: spec-verification — auth state at {path} is {missing|N days old};
  aw-tester will attempt a refresh via {auth.refresh.command}.
  If refresh fails, authed specs will be skipped.
```

`aw-tester` performs the actual refresh; the executor does not touch auth files.

---

## Step 1: Detect the aw-target

```bash
# Resolve aw-target name from specs.md header
AW_TARGET=$(grep "^Target:" .agent/$(git branch --show-current)/specs.md | awk '{print $2}')
AW_TARGET_FILE=".claude/aw-targets/${AW_TARGET}.yml"
test -f "$AW_TARGET_FILE" && echo "aw-target found: $AW_TARGET_FILE" || echo "aw-target missing"
```

Also detect the `aw-tester` agent:

```bash
[ -f ".claude/agents/aw-tester.md" ] && AW_TESTER=1
[ -z "$AW_TESTER" ] && [ -f "$HOME/.claude/agents/aw-tester.md" ] && AW_TESTER=1
```

If `aw-tester` is not installed at either location, log and skip:

```markdown
- [TIMESTAMP] Phase 4: aw-tester — not available, skipping spec verification
  (install aw-tester.md from agent-skills.git into .claude/agents/ or ~/.claude/agents/)
```

---

## Step 2: Run aw-tester

Dispatch `aw-tester` as a sub-agent. Pass the specs path and aw-target name.

```
description: Run spec-driven UI verification before lint/type/test gates
subagent_type: aw-tester
prompt: |
  Run the specs at .agent/{branch}/specs.md against aw-target "{aw_target_name}".
  Mode: --bail-on-first-red
  
  Aw-Target file: .claude/aw-targets/{aw_target_name}.yml
  Specs file: .agent/{branch}/specs.md
  
  Return the verdict block in the exact output schema format.
  Do not include browser logs unless a spec failed.
```

Wait for the verdict block. It will be one of:

| Verdict | Meaning |
|---------|---------|
| `green` | All specs pass. Proceed to lint/type/test. |
| `red` | At least one spec failed. Go to Step 3. |
| `inconclusive` | Some specs skipped (e.g. `auth.strategy: manual`). Proceed with a note. |

Log to plan.md Progress Log:

```markdown
- [TIMESTAMP] Phase 4: aw-tester — verdict: {green|red|inconclusive}
  ({N} specs: {pass_count} pass, {fail_count} fail, {skip_count} skipped)
```

---

## Step 3: Iterate on red

When `verdict: red`:

1. Read the `diagnostics` blob from the failing spec (≤ 30 lines).
2. Identify the failing step — it will point to a locator, a network assertion,
   or a visibility assertion.
3. Fix the implementation (NOT the spec). Specs describe user-observable
   behavior — they are the truth. Code is what changes.
4. Re-run `aw-tester` (Step 2).

**Iteration cap:** the Phase 4 mode-aware cap applies to this loop too.
If the spec-verification loop hits the cap on the same failing spec, invoke the
normal [stuck-loop detection](./phase-4-testing.md#stuck-loop-detection) from
the parent rule. Do NOT route around the cap by running `--all` mode to see if
other specs pass.

**Common failure patterns and their fixes:**

| Failing step shape | Likely cause | Fix |
|-------------------|--------------|-----|
| Locator not found | Component not rendered or role/name changed | Check the component, verify aria attributes |
| Network assertion mismatch | Handler returning wrong status | Check the API route handler |
| Visible assertion failed | Element rendered but not in viewport | Check layout, scroll, z-index |
| Auth failure (401) | Storage state expired | aw-tester will auto-refresh; if it fails, run `/aw-setup` |

**Do NOT:**
- Edit `specs.md` to make specs easier to pass. Specs describe the acceptance
  criteria — changing them is changing the requirement.
- Skip the spec-verification loop and go directly to unit tests hoping they
  cover the same ground.

If fixing the implementation is blocked by a UI framework issue or an unclear
spec, stop and escalate per the parent rule's "Stop and Ask" guidance.

---

## Step 4: Spec promotion

After `verdict: green`, check `specs.md` for `critical-path` specs. For each:

```
Skill("e2e-testing")
```

Pass the critical-path spec to the `e2e-testing` skill's Generator. The
Generator produces a saved `tests/{flow}.spec.ts`. Follow the Generator's
locator ladder and ensure the test imports production code (not a local copy).

After generation, invoke `test-provenance-guard`:
```bash
Skill("test-provenance-guard", "--diff --base $(git merge-base HEAD main) --fix")
```

`verify-only` specs are NOT promoted. They served their purpose (verifying the
change) and are discarded with the run.

Log:

```markdown
- [TIMESTAMP] Phase 4: spec promotion — {N} critical-path specs passed to e2e-testing Generator
- [TIMESTAMP] Phase 4: spec promotion — 0 critical-path specs (all verify-only; no promotion)
- [TIMESTAMP] Phase 4: e2e-testing — not available, critical-path specs not promoted
  (install e2e-testing skill to enable automatic promotion)
```

---

## No-UI-surface escape

This sub-rule self-skips when the task touches **zero UI files**. The check
is based on the plan's `## File changes` table:

```bash
# Check if any file in plan.md matches UI patterns
grep -E "\.(tsx|jsx|css|vue|svelte)$|/(pages|app|routes|layouts)/" \
  .agent/$(git branch --show-current)/plan.md | head -1
```

If this returns empty, skip cleanly:

```markdown
- [TIMESTAMP] Phase 4: spec-verification — skipped (no UI files in plan; task is non-UI)
```

The planner's decision to emit or skip `specs.md` (see `phase-1-planning.md`)
is the primary signal. This check is a safety net for cases where the planner
skipped `specs.md` correctly but specs.md was left from a prior run.

---

## Logging

Full Phase 4 spec-verification log example:

```markdown
- [2026-06-15T10:00:00Z] Phase 4: spec-verification — aw-target: local (.claude/aw-targets/local.yml)
- [2026-06-15T10:00:02Z] Phase 4: aw-tester — dispatched (2 specs, --bail-on-first-red)
- [2026-06-15T10:00:18Z] Phase 4: aw-tester — verdict: red
  (Spec-1: pass, Spec-2: fail — locator {role: "button", name: "Add Widget"} not found)
- [2026-06-15T10:00:20Z] Phase 4: spec-verification — iterating (fix attempt 1)
- [2026-06-15T10:01:05Z] Phase 4: aw-tester — dispatched (2 specs, --bail-on-first-red)
- [2026-06-15T10:01:22Z] Phase 4: aw-tester — verdict: green (2/2 pass)
- [2026-06-15T10:01:23Z] Phase 4: spec promotion — 0 critical-path specs (all verify-only)
- [2026-06-15T10:01:23Z] Phase 4: spec-verification — complete; proceeding to lint/type/test
```

---

## Checklist

- [ ] UI files detected in plan (or sub-rule skipped with `no UI files in plan`)
- [ ] Aw-Target file located at `.claude/aw-targets/{aw_target_name}.yml`
- [ ] `aw-tester` agent detected at `.claude/agents/aw-tester.md` or `~/.claude/agents/aw-tester.md`
- [ ] aw-tester invoked with `--bail-on-first-red`
- [ ] Verdict `green` or `inconclusive` before proceeding to lint/type/test
- [ ] Iterations on red applied to implementation (not specs)
- [ ] Mode-aware iteration cap honoured (same cap as parent Phase 4 loop)
- [ ] `critical-path` specs handed to `e2e-testing` Generator (or skip logged)
- [ ] Verdict logged in plan.md Progress Log

---

## References

- Parent rule: [`phase-4-testing.md`](./phase-4-testing.md) — stuck-loop detection and mode-aware cap
- Agent: [`aw-tester.agent.md`](../templates/aw-tester.agent.md) — the spec runner
- Skill: [`e2e-testing`](../../../testing/e2e-testing/SKILL.md) — Generator for critical-path spec promotion
- Setup: [`aw-setup/SKILL.md`](../aw-setup/SKILL.md) — aw-target scaffolding (user-run prerequisite)
- Templates: [`aw-target.yml.template`](../templates/aw-target.yml.template), [`specs.md.template`](../templates/specs.md.template)
- Planning: [`phase-1-planning.md`](./phase-1-planning.md) — where specs.md is emitted
