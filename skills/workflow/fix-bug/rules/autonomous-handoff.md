---
title: Autonomous Handoff — aw-planner / aw-executor Dispatch
impact: HIGH
tags:
  - handoff
  - autonomous-workflow
  - aw-planner
  - aw-executor
  - draft-pr
  - fast-lane
  - standard-lane
---

# Autonomous Handoff

Loads when Phase 5 of `/fix-bug` cleared at >= 92 % (or the user
force-proceeded after 70–91 %). Dispatches the autonomous-workflow agents to
ship the fix as a draft PR.

There are **two lanes**, picked by the Phase 0.5 complexity triage and
confirmed at Phase 5:

| Lane | Trigger | Path |
|------|---------|------|
| [Fast-lane](#fast-lane) | triage = `simple` AND confidence ≥ 92 % AND non-best-effort repro | `/fix-bug` → `aw-create-plan` → `aw-executor` (no aw-planner) |
| [Standard-lane](#standard-lane) | triage = `complex` (default) OR fast-lane preconditions not met OR force-proceed used | `/fix-bug` → `aw-planner` → `aw-executor` (current canonical path) |

Both lanes share Phase 7 (independent verification) and Phase 8 (telemetry
verification) unchanged.

## Contents

- [Lane selection](#lane-selection)
- [Fast-lane](#fast-lane)
  - [Step 6a (fast) — Create worktree + plan.md](#step-6a-fast--create-worktree--planmd)
  - [Step 6b (fast) — Dispatch `aw-executor`](#step-6b-fast--dispatch-aw-executor)
  - [Fast-lane round-3 fallback](#fast-lane-round-3-fallback)
- [Standard-lane](#standard-lane)
  - [Step 6a (std) — Spawn `aw-planner`](#step-6a-std--spawn-aw-planner)
  - [Step 6b (std) — Spawn `aw-executor`](#step-6b-std--spawn-aw-executor)
- [Step 6c — CEGIS refinement contract](#step-6c--cegis-refinement-contract)
- [Step 6c — Report back](#step-6c--report-back)
- [Failure modes](#failure-modes)

---

## Lane selection

At the entry of Phase 6, read the bug-notes ledger and pick the lane:

1. If `Complexity triage → Phase 6 lane (provisional) = standard-lane` → use
   [Standard-lane](#standard-lane).
2. If `Complexity triage → Phase 6 lane (provisional) = fast-lane`:
   - Re-check the fast-lane preconditions (see
     [`fast-lane-plan-contract.md`](./fast-lane-plan-contract.md#when-this-rule-loads)).
   - If all hold → use [Fast-lane](#fast-lane).
   - If any fail → downgrade to [Standard-lane](#standard-lane); log the
     downgrade reason in the ledger.
3. If the user force-proceeded after 70–91 % confidence (Phase 5) → always
   [Standard-lane](#standard-lane), regardless of triage. The planner's
   `confidence(plan)` gate is the extra safety net when analysis
   confidence is marginal.

Print one line:

```text
Phase 6 lane: fast-lane | standard-lane (reason: <triage | downgrade <signal> | force-proceed>)
```

---

## Fast-lane

Triggers when triage said `simple` AND the four preconditions in
[`fast-lane-plan-contract.md`](./fast-lane-plan-contract.md#when-this-rule-loads)
all hold. `/fix-bug` becomes the plan author; `aw-planner` does not run.

### Step 6a (fast) — Create worktree + plan.md

1. **Create the worktree** using `gw checkout fix/<slug>`. Capture path as
   `.agent/fix/<slug>/`.
2. **Move the bug-notes ledger** into the worktree if it was initialised
   under a pre-worktree slug. Append `Phase 6 lane: fast-lane` to the ledger.
3. **Compose the plan body** following every required section in
   [`fast-lane-plan-contract.md`](./fast-lane-plan-contract.md#section-by-section-spec).
4. **Invoke `aw-create-plan`**:

   ```text
   Skill("aw-create-plan", "<full plan.md body>")
   ```

   This writes `.agent/fix/<slug>/plan.md` plus the next `plan.vN.md`
   snapshot.
5. **Validate plan.md** — re-read the file and confirm all 14 required
   sections are present. On any missing section, fail loudly, log to the
   ledger, and stop. Do NOT dispatch the executor against an under-specified
   plan.

### Step 6b (fast) — Dispatch `aw-executor`

Use the Agent tool with `subagent_type: "aw-executor"` and
`isolation: "worktree"` pointing at `.agent/fix/<slug>/`. Minimal prompt:

```text
Execute the plan at .agent/fix/<slug>/plan.md in the current worktree.

This plan was authored directly by /fix-bug (fast-lane); aw-planner did not
run. The CEGIS refinement contract in the plan is binding. On round-3
failure, the orchestrator (/fix-bug) handles the fallback — do not retry
beyond 3 rounds.
```

The executor runs autonomous-workflow Phases 3–7 (implement, test, document,
draft PR, watch CI). Do not wait for CI to finish before reporting back —
the executor owns CI watching.

### Fast-lane round-3 fallback

The CEGIS contract caps at 3 refinement rounds for both lanes. On the
standard-lane, round-3 failure escalates to `confidence(analysis fix)`
and the existing branch-decision tiers. On the **fast-lane**, round-3
failure additionally **re-dispatches via aw-planner with the captured
counterexamples**, because round-3 failure is the strongest signal the bug
was not actually simple.

Procedure when `aw-executor` reports `CEGIS round 3 failed`:

1. **Read the bug-notes ledger** — every counterexample captured during the
   3 fast-lane rounds is already there under `Counterexamples`.
2. **Append a triage upgrade** to the ledger:

   ```markdown
   ## Triage upgrade

   - Trigger: fast-lane CEGIS round 3 failure
   - New classification: complex
   - Lane: standard-lane (via fallback)
   - Counterexamples to carry forward: <list of round 1–3 capture entries>
   ```

3. **Compose a standard-lane bug-fix-pack** per
   [`templates/bug-fix-pack.md`](../templates/bug-fix-pack.md), with two
   modifications:
   - The `Root cause` section now reads "Fast-lane lightweight analysis
     produced `<original root cause>`; CEGIS rounds 1–3 falsified this.
     Re-analyse with the captured counterexamples."
   - A new `Counterexamples` section embeds the round 1–3 captures verbatim.
4. **Dispatch `aw-planner`** per the standard-lane Step 6a (std) below,
   pointed at the **same worktree** the fast-lane created. The planner
   re-runs validation + planning + its own `confidence(plan)` gate against
   the enriched evidence.
5. If `aw-planner` returns "Below gate", surface its concerns and stop —
   round-3 fallback does not loop further.

The fallback is **single-shot** — there is no fast-lane round-4 and no
second fallback. After fallback, the flow is identical to standard-lane.

---

## Standard-lane

The canonical path. Used for `complex` bugs, downgrades from fast-lane, and
all force-proceed cases. Identical to the pre-upgrade Phase 6.

### Step 6a (std) — Spawn `aw-planner`

Use the Agent tool with `subagent_type: "aw-planner"` and
`isolation: "worktree"`. Pass the **Bug Fix Pack** from
[`templates/bug-fix-pack.md`](../templates/bug-fix-pack.md), filled in from
the Evidence Record (Phase 2) and holistic-analysis output (Phase 3).

The planner runs autonomous-workflow Phases 0–2 (validation, planning,
worktree + `plan.md`), gated by its own internal `confidence(plan) >= 90 %`.
It returns one of:

| Result | Meaning | Next |
|--------|---------|------|
| **Plan ready** | Worktree created, `plan.md` cleared the gate. | Proceed to Step 6b (std). |
| **Below gate** | Confidence < 90 % after retries; concerns surfaced. | Stop. Present concerns. Do not auto-dispatch the executor. |

### Step 6b (std) — Spawn `aw-executor`

Only if Step 6a (std) returned **Plan ready**.

Use the Agent tool with `subagent_type: "aw-executor"` and
`isolation: "worktree"` pointing at the **same worktree the planner used**.
Minimal prompt:

```text
Execute the plan at .agent/<branch>/plan.md in the current worktree.
```

The executor runs autonomous-workflow Phases 3–7 (implement, test, document,
draft PR, watch CI). Do not wait for CI to finish before reporting back —
the executor owns CI watching.

---

## Step 6c — CEGIS refinement contract

Identical for both lanes. Every plan.md (whether authored by `aw-planner` on
the standard-lane or by `aw-create-plan` on the fast-lane) includes the
contract verbatim. After each executor edit:

1. Run the repro. If it passes, continue to other test runs.
2. If it fails: capture the failing input/output verbatim, append to
   `.agent/<branch>/bug-notes.md` under `Counterexamples`, then refine the
   patch using the captured input as concrete evidence.
3. Cap at **3 refinement rounds**. After the third failure, stop refining.
   - On **standard-lane**: return to `confidence(analysis fix)` for
     re-analysis rather than guessing further.
   - On **fast-lane**: trigger the
     [fast-lane round-3 fallback](#fast-lane-round-3-fallback) — re-dispatch
     via aw-planner with the captured counterexamples.

Source: [LLM-CEGIS-Repair (AAAI 2025)](https://github.com/pmorvalho/LLM-CEGIS-Repair).
Reports +15-30 % on Defects4J vs single-shot generation.

---

## Step 6c — Report back

Print the final status block. Same shape for both lanes; the `Lane` row
distinguishes them.

```markdown
## Fix-bug result

| Field | Value |
|-------|-------|
| Source | <Dash0 link / stack trace / code pointer> |
| Lane | fast-lane | standard-lane (downgrade <reason>) | standard-lane (force-proceed) |
| Root cause | <one line> |
| Confidence (analysis) | <X%> |
| Plan confidence | <Y%> if standard-lane, "n/a (fast-lane)" otherwise |
| PR | <url> (draft — verifier pending) |
| Branch | fix/<slug> |
| Worktree | .agent/fix/<slug>/ |
| CI | watching (aw-executor still running) |
```

Do **not** undraft the PR here — that is Phase 7 (independent verification)'s
decision after the executor completes.

---

## Failure modes

| Failure | Lane | Action |
|---------|------|--------|
| `aw-planner` returns "Below gate" | standard | Stop. Present the planner's concerns. Offer: refine (re-spawn planner), force-proceed (NOT recommended, only if user explicitly requests), or abandon. |
| `aw-planner` returns an error (tool / worktree creation failed) | standard | Surface the error. Do not retry silently — worktree state may be inconsistent. |
| `aw-executor` fails before opening a PR | both | Report the worktree path and the failure. The user can resume from the worktree manually or re-spawn the executor. |
| `aw-executor` opens a PR but CI fails immediately | both | The executor handles its own CI gate (Phase 7). Do not intervene from this skill. |
| Fast-lane plan.md validation fails (missing section) | fast | Stop. Log to the ledger. Do NOT dispatch the executor. Offer: re-author the plan, or downgrade to standard-lane. |
| Fast-lane CEGIS round 3 failure | fast | [Fast-lane round-3 fallback](#fast-lane-round-3-fallback). Single-shot — no further loops. |
| Fast-lane preconditions fail at Phase 6 entry (e.g. repro turned best-effort late) | fast | Downgrade to standard-lane silently; log the downgrade reason. The user does not need to intervene. |
| `aw-create-plan` returns an error (worktree missing, branch detection failed) | fast | Surface the error. Worktree state may be inconsistent — do NOT retry blindly. |
