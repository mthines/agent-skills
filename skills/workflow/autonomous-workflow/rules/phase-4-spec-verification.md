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
- [Step 2: Cold pass — full aw-tester sub-agent](#step-2-cold-pass--full-aw-tester-sub-agent)
- [Step 3: Hot loop — fast iteration on red](#step-3-hot-loop--fast-iteration-on-red)
- [Step 4: Cold-pass escalation](#step-4-cold-pass-escalation)
- [Step 5: Spec promotion](#step-5-spec-promotion)
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

### Cold pass vs. hot loop (the iteration model)

Verification runs in two passes with very different costs:

| Pass | When | Mechanism | Approx cost per cycle |
| ---- | ---- | --------- | --------------------- |
| **Cold pass** | Phase 4 entry, hot-loop escalation, Phase 7 rehearsal | Full `aw-tester` sub-agent dispatch — reads lessons, parses specs, resolves Playwright binary, generates `last-run.spec.ts`, runs all specs, returns structured verdict, writes lessons | 20–40 s + LLM tokens for the verdict block |
| **Hot loop** | Every executor iteration on the same failing spec | Executor runs `last-run.spec.ts` directly via Bash with `--grep <failing-spec-id>`. Exit code 0 = green, non-zero = red. No sub-agent dispatch, no `npx`, no spec re-generation | 2–6 s, zero sub-agent LLM tokens |

The cold pass is for **structured handoff** (verdict, lessons, spec promotion).
The hot loop is for **the executor asking "did my fix work?"** Use the cold
pass sparingly — once per Phase 4 entry, plus the explicit escalation triggers
in [Step 4](#step-4-cold-pass-escalation).

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

## Step 2: Cold pass — full aw-tester sub-agent

Dispatch `aw-tester` as a sub-agent **once** at Phase 4 entry. Pass the specs
path and aw-target name.

```
description: Run spec-driven UI verification before lint/type/test gates
subagent_type: aw-tester
prompt: |
  Run the specs at .agent/{branch}/specs.md against aw-target "{aw_target_name}".
  Mode: --bail-on-first-red
  
  Aw-Target file: .claude/aw-targets/{aw_target_name}.yml
  Specs file: .agent/{branch}/specs.md
  
  Persist the generated spec to .agent/{branch}/.aw-tester/last-run.spec.ts
  and resolve a stable Playwright binary path so the hot loop can re-run
  without re-dispatching. Return the verdict block in the exact output
  schema format, including the hot_loop: section. Do not include browser
  logs unless a spec failed.
```

Wait for the verdict block. It will be one of:

| Verdict | Meaning |
|---------|---------|
| `green` | All specs pass. Proceed to lint/type/test. |
| `red` | At least one spec failed. Read `hot_loop:` from the verdict and go to [Step 3](#step-3-hot-loop--fast-iteration-on-red). |
| `inconclusive` | Some specs skipped (e.g. `auth.strategy: manual`). Proceed with a note. |

Capture the `hot_loop:` block from the verdict — the `spec_file`,
`playwright_bin`, and `failing_spec_id` fields drive Step 3. Log to plan.md
Progress Log:

```markdown
- [TIMESTAMP] Phase 4: aw-tester (cold) — verdict: {green|red|inconclusive}
  ({N} specs: {pass_count} pass, {fail_count} fail, {skip_count} skipped)
- [TIMESTAMP] Phase 4: aw-tester (cold) — hot-loop ready at .agent/<branch>/.aw-tester/last-run.spec.ts (playwright: <bin>)
```

---

## Step 3: Hot loop — fast iteration on red

When `verdict: red` came back from the cold pass:

1. Read the failing spec's `diagnostics` blob from the verdict (≤ 30 lines).
2. Identify the failing step — locator, network assertion, or visibility
   assertion.
3. **Fix the implementation** (NOT the spec). Specs describe user-observable
   behavior — they are the truth. Code is what changes.
4. **Re-run the persisted spec directly** — no sub-agent dispatch:

   ```bash
   # Re-run only the failing spec. Exit code 0 = green, non-zero = red.
   "$(cat .agent/$(git branch --show-current)/.aw-tester/playwright-bin)" \
     test --reporter=line --workers=1 \
     --grep "<failing_spec_id>" \
     .agent/$(git branch --show-current)/.aw-tester/last-run.spec.ts
   ```

   Read the exit code and the last ~15 lines of stdout — that is enough to
   know which line / locator / assertion still fails. Do **not** dispatch the
   sub-agent for this read.
5. If exit 0 → either all specs are green (proceed) or only the targeted
   spec is green and others were skipped by `--grep`. To confirm full green,
   run once without `--grep`:

   ```bash
   "$(cat .agent/$(git branch --show-current)/.aw-tester/playwright-bin)" \
     test --reporter=line --workers=1 \
     .agent/$(git branch --show-current)/.aw-tester/last-run.spec.ts
   ```

   Exit 0 here means the full batch is green. Proceed to lint/type/test.
6. If exit non-zero → another iteration. Go to Step 4 to decide whether to
   stay in the hot loop or escalate.

**Iteration cap:** the Phase 4 mode-aware cap (3 in Lite, 5 in Full) counts
**hot-loop iterations**, not cold-pass dispatches. A cold-pass escalation
(Step 4) resets the inner counter once.

**Common failure patterns and their fixes:**

| Failing step shape | Likely cause | Fix |
|-------------------|--------------|-----|
| Locator not found | Component not rendered or role/name changed | Check the component, verify aria attributes |
| Network assertion mismatch | Handler returning wrong status | Check the API route handler |
| Visible assertion failed | Element rendered but not in viewport | Check layout, scroll, z-index |
| Auth failure (401) | Storage state expired | Escalate to cold pass — aw-tester will auto-refresh |

**Do NOT:**
- Edit `specs.md` to make specs easier to pass. Specs describe the acceptance
  criteria — changing them is changing the requirement.
- Edit `last-run.spec.ts` directly. It is regenerated on every cold pass; any
  hand-edit is lost. If a locator needs healing, escalate.
- Skip the spec-verification loop and go directly to unit tests hoping they
  cover the same ground.

---

## Step 4: Cold-pass escalation

The hot loop stays cheap by NOT dispatching the sub-agent. But some failures
genuinely need the sub-agent's reasoning (locator healing, lesson application,
auth refresh). Escalate back to a cold pass when **any** of these trigger:

| Trigger | Why |
|---------|-----|
| Same locator error two iterations in a row | Hot loop can't heal — need aw-tester's locator-ladder logic |
| `specs.md` mtime > `.aw-tester/last-run.meta.json` `specs_mtime` | Specs changed; the persisted spec is stale |
| HTTP 401 in spec output | Auth refresh needed; aw-tester owns that flow |
| Hot-loop iteration cap hit (3 Lite / 5 Full) on the same failing spec | One last cold pass before invoking parent stuck-loop detection |
| Phase 7 rehearsal | Always cold (full verdict, `--all` mode, lesson capture) |

Escalation is one cold-pass dispatch, then **resume** the hot loop (the cap
counter resets once per Phase 4 entry — second escalation on the same spec
goes straight to [`phase-4-testing.md` stuck-loop detection](./phase-4-testing.md#stuck-loop-detection)).

If fixing the implementation is blocked by a UI framework issue or an unclear
spec, stop and escalate per the parent rule's "Stop and Ask" guidance.

---

## Step 5: Spec promotion

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

Full Phase 4 spec-verification log example (note the cold/hot split):

```markdown
- [2026-06-15T10:00:00Z] Phase 4: spec-verification — aw-target: local (.claude/aw-targets/local.yml)
- [2026-06-15T10:00:02Z] Phase 4: aw-tester (cold) — dispatched (2 specs, --bail-on-first-red)
- [2026-06-15T10:00:18Z] Phase 4: aw-tester (cold) — verdict: red
  (Spec-1: pass, Spec-2: fail — locator {role: "button", name: "Add Widget"} not found)
- [2026-06-15T10:00:18Z] Phase 4: aw-tester (cold) — hot-loop ready at .agent/feat-x/.aw-tester/last-run.spec.ts
- [2026-06-15T10:00:20Z] Phase 4: hot-loop iter 1 — fix attempt 1 (component aria-label)
- [2026-06-15T10:00:25Z] Phase 4: hot-loop iter 1 — exit 1 (locator still not found)
- [2026-06-15T10:00:27Z] Phase 4: hot-loop iter 2 — fix attempt 2 (button label text)
- [2026-06-15T10:00:32Z] Phase 4: hot-loop iter 2 — exit 0 (Spec-2 green via --grep)
- [2026-06-15T10:00:34Z] Phase 4: hot-loop confirm — full batch exit 0 (2/2 pass)
- [2026-06-15T10:00:34Z] Phase 4: spec promotion — 0 critical-path specs (all verify-only)
- [2026-06-15T10:00:34Z] Phase 4: spec-verification — complete; proceeding to lint/type/test
```

The same flow under the old turn-by-turn pattern would have cost two cold
dispatches (~30 s + sub-agent tokens × 2). Two hot-loop iterations cost
~10 s combined with no sub-agent tokens.

---

## Checklist

- [ ] UI files detected in plan (or sub-rule skipped with `no UI files in plan`)
- [ ] Aw-Target file located at `.claude/aw-targets/{aw_target_name}.yml`
- [ ] `aw-tester` agent detected at `.claude/agents/aw-tester.md` or `~/.claude/agents/aw-tester.md`
- [ ] Cold pass dispatched once at Phase 4 entry with `--bail-on-first-red`
- [ ] `hot_loop:` block captured from the cold-pass verdict (`spec_file`, `playwright_bin`, `failing_spec_id`)
- [ ] Subsequent iterations use the **hot loop** (direct Bash on `last-run.spec.ts`), NOT re-dispatching `aw-tester`
- [ ] Cold-pass escalation triggered only on: same-locator 2× / specs.md changed / 401 / hot-cap hit / Phase 7 rehearsal
- [ ] Verdict `green` or `inconclusive` before proceeding to lint/type/test
- [ ] Iterations on red applied to implementation (not specs, not `last-run.spec.ts`)
- [ ] Mode-aware iteration cap counts hot-loop iterations; cold-pass escalation resets the counter once
- [ ] `critical-path` specs handed to `e2e-testing` Generator (or skip logged)
- [ ] Verdict logged in plan.md Progress Log (cold + hot lines distinct)

---

## References

- Parent rule: [`phase-4-testing.md`](./phase-4-testing.md) — stuck-loop detection and mode-aware cap
- Agent: [`aw-tester.agent.md`](../templates/aw-tester.agent.md) — the spec runner
- Skill: [`e2e-testing`](../../../testing/e2e-testing/SKILL.md) — Generator for critical-path spec promotion
- Setup: [`aw-setup/SKILL.md`](../aw-setup/SKILL.md) — aw-target scaffolding (user-run prerequisite)
- Templates: [`aw-target.yml.template`](../templates/aw-target.yml.template), [`specs.md.template`](../templates/specs.md.template)
- Planning: [`phase-1-planning.md`](./phase-1-planning.md) — where specs.md is emitted
