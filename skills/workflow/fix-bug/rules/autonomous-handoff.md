---
title: Autonomous Handoff — Brief + In-Session Work
impact: HIGH
tags:
  - handoff
  - autonomous-workflow
  - in-session
  - draft-pr
  - fast-lane
  - standard-lane
---

# Autonomous Handoff

Loads when Phase 5 of `/fix-bug` cleared at >= 92 % (or the user
force-proceeded after 70–91 %). Writes the brief, then works it to a draft PR
**in this session**, the way `aw`'s Full tier does: the context that holds the
repro, the Evidence Record, and the Root-Cause Record writes the fix.

There are **two lanes**, picked by the Phase 0.5 complexity triage and
confirmed at Phase 5:

| Lane | Trigger | Path |
|------|---------|------|
| [Fast-lane](#fast-lane) | triage = `simple` AND confidence ≥ 92 % AND non-best-effort repro | `/fix-bug` → `aw-create-plan` (fast-lane plan) → [work it here](#step-6b--work-the-plan-here) |
| [Standard-lane](#standard-lane) | triage = `complex` (default) OR fast-lane preconditions not met OR force-proceed used | `/fix-bug` → `aw-create-plan` (six-Core brief) → [work it here](#step-6b--work-the-plan-here) (canonical path) |

Both lanes share Phase 7 (independent verification) and Phase 8 (telemetry
verification) unchanged.

## Contents

- [Lane selection](#lane-selection)
- [Fast-lane](#fast-lane)
  - [Step 6a (fast) — Create worktree + plan.md](#step-6a-fast--create-worktree--planmd)
  - [Fast-lane round-3 fallback](#fast-lane-round-3-fallback)
- [Standard-lane](#standard-lane)
  - [Step 6a (std) — Write the brief](#step-6a-std--write-the-brief)
- [Step 6b — Work the plan here](#step-6b--work-the-plan-here)
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
   [Standard-lane](#standard-lane), regardless of triage. The six-Core brief
   with sealed checks is the extra safety net when analysis confidence is
   marginal.

Print one line:

```text
Phase 6 lane: fast-lane | standard-lane (reason: <triage | downgrade <signal> | force-proceed>)
```

---

## Fast-lane

Triggers when triage said `simple` AND the four preconditions in
[`fast-lane-plan-contract.md`](./fast-lane-plan-contract.md#when-this-rule-loads)
all hold. `/fix-bug` authors the fast-lane plan, which keeps the pre-brief section set.

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

   This writes `.agent/fix/<slug>/plan.md`. The arg is a plan body, not the
   `snapshot` mode flag, so `aw-create-plan` runs in default mode and writes
   **no** `plan.vN.md` snapshot (the fast lane does not need one).
5. **Validate plan.md** — re-read the file and confirm all 20 required
   sections (the 8 `aw-create-plan` Core sections plus the bug-specific ones,
   per [`fast-lane-plan-contract.md`](./fast-lane-plan-contract.md#required-sections))
   are present. On any missing section, fail loudly, log to the ledger, and
   stop. Do NOT start work against an under-specified plan.
6. Continue at [Step 6b — Work the plan here](#step-6b--work-the-plan-here).

### Fast-lane round-3 fallback

The CEGIS contract caps at 3 refinement rounds for both lanes. On the
standard-lane, round-3 failure escalates to `confidence(analysis fix)`
and the existing branch-decision tiers. On the **fast-lane**, round-3
failure additionally **re-enters the standard-lane with the captured
counterexamples**, because round-3 failure is the strongest signal the bug
was not actually simple.

Procedure when your third CEGIS round fails on the fast-lane:

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

3. **Update the Bug Fix Pack** per
   [`templates/bug-fix-pack.md`](../templates/bug-fix-pack.md), with two
   modifications:
   - The `Root cause` section now reads "Fast-lane lightweight analysis
     produced `<original root cause>`; CEGIS rounds 1–3 falsified this.
     Re-analyse with the captured counterexamples."
   - A new `Counterexamples` section embeds the round 1–3 captures verbatim.
4. **Re-run the standard-lane** from [Step 6a (std)](#step-6a-std--write-the-brief),
   in the **same worktree** the fast-lane created: the brief replaces the
   fast-lane `plan.md` (version N+1) and its checks are re-sealed.
5. If the brief cannot pass validation from the enriched evidence, surface
   the gaps and stop — round-3 fallback does not loop further.

The fallback is **single-shot** — there is no fast-lane round-4 and no
second fallback. After fallback, the flow is identical to standard-lane.

---

## Standard-lane

The canonical path. Used for `complex` bugs, downgrades from fast-lane, and
all force-proceed cases. `/fix-bug` writes the brief itself — the same brief
the `aw` dispatcher writes on a Full task — then works it here.

### Step 6a (std) — Write the brief

1. **Create the worktree** with `gw checkout fix/<slug>` (or `git worktree add`)
   and move the bug-notes ledger into it. Append `Phase 6 lane: standard-lane`
   to the ledger.
2. **Fill the Bug Fix Pack** from
   [`templates/bug-fix-pack.md`](../templates/bug-fix-pack.md), using the
   Evidence Record (Phase 2) and Root-Cause Record (Phase 3).
3. **Write the brief and checks** with `Skill("aw-create-plan", "<brief body>")`.
   The brief is the six Core headings (Task, Requirements, Guardrails,
   Acceptance Criteria, Turn Cap, File Changes) seeded from the pack:
   - **Task** — the symptom and the proposed change, in 1–3 sentences.
   - **Requirements** — the fix, plus every behaviour the repro and the
     Root-Cause Record say must hold, tagged `[user-stated]` / `[inferred]`.
   - **Acceptance Criteria** — one `AC-{n}` for the repro passing
     (`FAIL_TO_PASS`), one for the existing suite (`PASS_TO_PASS`), and one per
     further requirement.
   - **File Changes** — the files the Root-Cause Record names.
   - Under a `## Context artefacts` section: the bug-notes ledger path and the
     [CEGIS refinement contract](#step-6c--cegis-refinement-contract) verbatim.

   Once File Changes is drafted, issue the `codebase-knowledge` read per
   [`self-improvement-loop.md`](./self-improvement-loop.md#cross-bucket-read--codebase-knowledge-fast-lane-plan-seam)
   for exactly those paths.
4. **Validate the brief deterministically** before dispatch:

   ```bash
   D=".agent/$(git branch --show-current)"
   grep -cE '^## (Task|Requirements|Guardrails|Acceptance Criteria|Turn Cap|File Changes)' "$D/plan.md"   # 6
   grep -cE '^- \[ \] AC-[0-9]+' "$D/plan.md"; grep -c '^- id: AC-' "$D/checks.yaml"                    # equal
   test -f "$D/checks.lock" && echo sealed
   ```

   On any failure, fix the brief and re-run; do NOT start work against a
   brief that fails validation.
5. Continue at [Step 6b — Work the plan here](#step-6b--work-the-plan-here).

---

## Step 6b — Work the plan here

Both lanes, after their Step 6a validation passed.
`cd` into the worktree from Step 6a and stay there; you are the worker.
Follow `aw`'s Full tier Steps 2–4 (`$HOME/.claude/skills/aw/rules/full-tier.md`)
with the lane's done condition and the [CEGIS contract](#step-6c--cegis-refinement-contract):

| Lane | Step 2 is done when, on the same head | Step 2's inner loop |
| --- | --- | --- |
| Standard | `run-checks.mjs` prints `CHECKS M/M PASS (<sha>)` and the Before-PR command passes | change → After-editing (the repro) → run-checks |
| Fast | the plan's After-editing command (the repro) and Before-PR command both pass | change → repro → Before-PR |

0. **Lessons.** Run the `aw-lessons` intake read in `$HOME/.claude/skills/aw/rules/lessons.md`
   with keywords from the root cause; apply matches as constraints. Step 4's
   lessons exit write runs unchanged.
1. **Step 2 — work.** Every failing repro run is a CEGIS round: capture it in
   the ledger before refining. Round 3 failing ends Step 2 for that lane — the
   [fast-lane fallback](#fast-lane-round-3-fallback) or, on the standard-lane,
   `confidence(analysis fix)`.
2. **Step 3 — local review.** `Skill("review-loop", "--base <base sha> --cap 2")`:
   `branch-reviewer` reviews the diff from a context that did not write it.
3. **Step 4 — PR.** Walkthrough, `Skill("create-pr", "--no-pre-review --no-post-review")`
   as a draft, then `feature-pr-verifier` once with the PR URL, and the CI watch
   (`ci-auto-fix` on failure, cap 2). Then Phase 7 runs.

```text
# correct — the context that found the root cause writes the fix
6a validated → cd <worktree> → edit → repro (CEGIS round on red) → checks → review-loop (local) → create-pr --draft → feature-pr-verifier → Phase 7

# incorrect — a dispatched executor re-reads the ledger, the repro, and the root cause from files
Agent(subagent_type="aw-executor", prompt="Execute the plan at .agent/fix/<slug>/plan.md …")
```

Dispatch `aw-executor` only when the user asks for a background worker; then
do not edit while it runs, and Phase 7 waits for its draft PR.
**Why:** [`../references/design-rationale.md` § In-session implementation](../references/design-rationale.md#in-session-implementation).

---

## Step 6c — CEGIS refinement contract

Identical for both lanes. Every plan.md (the six-Core brief on the
standard-lane or the fast-lane plan) includes the contract verbatim. After each edit:

1. Run the repro. If it passes, continue to other test runs.
2. If it fails: capture the failing input/output verbatim, append to
   `.agent/<branch>/bug-notes.md` under `Counterexamples`, then refine the
   patch using the captured input as concrete evidence.
3. Cap at **3 refinement rounds**. After the third failure, stop refining.
   - On **standard-lane**: return to `confidence(analysis fix)` for
     re-analysis rather than guessing further.
   - On **fast-lane**: trigger the
     [fast-lane round-3 fallback](#fast-lane-round-3-fallback) — re-enter
     the standard-lane with the captured counterexamples.

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
| Checks | <`CHECKS M/M PASS (<sha>)` (standard) \| repro + Before-PR pass (fast)> |
| PR | <url> (draft — Phase 7 verification pending) |
| Branch | fix/<slug> |
| Worktree | .agent/fix/<slug>/ |
| CI | <green \| red: <checks> \| pending> |
| Review | <branch-reviewer: N findings — F fixed, R rejected, G flagged \| not run (<reason>)> |
| Verified | <feature-pr-verifier green \| red \| not run (<reason>)> |
```

Do **not** undraft the PR here or anywhere else — `/fix-bug` never undrafts.
Phase 7 writes the verification evidence into the PR body and a human undrafts.

---

## Failure modes

| Failure | Lane | Action |
|---------|------|--------|
| Standard-lane brief fails validation | standard | Fix the brief and re-run validation. If a requirement cannot be turned into a check, stop and ask the user. |
| Worktree creation or `aw-create-plan` fails | standard | Surface the error. Do not retry silently — worktree state may be inconsistent. |
| Work stops before a PR opens (`BLOCKED`, stuck loop, turn cap) | both | Report the worktree path, the ledger, and the evidence. The user resumes in the worktree or re-runs Phase 6. |
| CI fails on the draft PR | both | `ci-auto-fix`, cap 2, per `aw` Full tier Step 4; then Phase 7. |
| Fast-lane plan.md validation fails (missing section) | fast | Stop. Log to the ledger. Do NOT start work. Offer: re-author the plan, or downgrade to standard-lane. |
| Fast-lane CEGIS round 3 failure | fast | [Fast-lane round-3 fallback](#fast-lane-round-3-fallback). Single-shot — no further loops. |
| Fast-lane preconditions fail at Phase 6 entry (e.g. repro turned best-effort late) | fast | Downgrade to standard-lane silently; log the downgrade reason. The user does not need to intervene. |
| `aw-create-plan` returns an error (worktree missing, branch detection failed) | fast | Surface the error. Worktree state may be inconsistent — do NOT retry blindly. |
