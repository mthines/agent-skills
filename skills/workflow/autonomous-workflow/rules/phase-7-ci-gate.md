---
title: 'Phase 7: CI Gate + Optional Cleanup'
impact: HIGH
tags:
  - ci
  - phase-7
  - ci-auto-fix
  - cleanup
---

# Phase 7: CI Gate + Optional Cleanup

## Contents

- [Overview](#overview)
- [Core Principles](#core-principles)
- [Procedure](#procedure)
- [Auto Fix](#auto-fix)
- [Parallel CI Fixes](#parallel-ci-fixes)
- [Spec Rehearsal (optional, UI tasks only)](#spec-rehearsal-optional-ui-tasks-only)
- [Auto Verify](#auto-verify)
- [Auto Review](#auto-review)
- [Observability Recheck](#observability-recheck)
- [Optional Post-Merge Cleanup](#optional-post-merge-cleanup)
- [Phase 7 Checklist](#phase-7-checklist)
- [References](#references)

## Overview

After the draft PR is open, watch CI until every check is green. If a check fails, dispatch `ci-auto-fix` (in parallel when independent failures pile up). Only after the PR is merged is worktree cleanup considered, and only when the user wants it.

The CI gate is the load-bearing part of this phase; cleanup is a tail step.

Gate: CI green OR user-approved stop. Worktree cleanup is optional and never automatic on an open PR.

## Core Principles

- **Watch until done**: don't mark Phase 7 complete on the first green check — watch the full run.
- **Auto-fix mechanical failures**: lint, format, generated artifacts, snapshots, type drift.
- **Escalate judgment failures**: real test failures, ambiguous build errors, infra issues — report to user.
- **Never disable checks to make CI green**: no `--no-verify`, no `continue-on-error`, no skipping suites.
- **Bound the loop**: hard cap of 2 `ci-auto-fix` handoffs per PR. Each handoff has its own internal retry budget; do not wrap it in another loop.
- **Cleanup is opt-in**: never remove an open PR's worktree (whether via `gw remove` or `git worktree remove`).

## Procedure

### Step 1: Identify the PR + Initial Watch

After Phase 6, you should already have the PR URL and number. Start watching:

**Ask CI what it is doing before watching it.** `create-pr` Step 7 already watched these checks, and the background `implement-suggestion --watch` and any `ci-auto-fix` subagents may have pushed since. Rather than inheriting a budget or a recorded verdict from those runs — which would be a claim about *some* commit, not necessarily the current head — make one cheap, stateless query:

```bash
# No --watch: returns immediately with the state of the CURRENT head.
gh pr checks <pr-number>
```

| What it reports | Phase 7 Step 1 does |
| --------------- | ------------------- |
| All checks terminal and passing | **Skip the watch** — go to Step 4 (report success). If the repo uses `workflow_run`-triggered checks, a merge queue, or re-run-on-comment, re-query once before reporting: a check can report terminal and then re-run |
| All terminal, some failing | **Skip the watch** — go to Step 2 (triage) |
| Any still pending | Watch, bounded, per the block below |
| Nothing, **and the query errored** (exit 127, or stderr naming auth / network / rate limit / not-logged-in) | **Tooling failure, not "no CI".** Report it and escalate. An error prints to stderr and nothing to stdout, so it is indistinguishable from "no checks" unless you look |
| Nothing, query succeeded, **and Phase 6 just pushed** | **Not registered yet, not "no CI".** Run the shared [registration poll](../../../delivery/create-pr/rules/registration-poll.md#the-poll), then map its outcome with the table below. Registration takes seconds, and Phase 7 runs immediately after a push |

**"No checks reported" is three different states**, and collapsing them into success is how a green report gets written for a PR whose CI was never observed.

The poll is a [shared rule with one owner](../../../delivery/create-pr/rules/registration-poll.md) — call it, never restate it. Map its [caller-neutral outcomes](../../../delivery/create-pr/rules/registration-poll.md#outcomes-caller-neutral) onto this phase:

| Poll outcome | Phase 7 does |
| ------------ | ------------ |
| `registered` | **Re-read the Step 1 table above** — checks now exist, so it can classify them. Terminal ones skip the watch; pending ones fall through to the bounded block below |
| `tooling-failure` | Report and escalate. Do **not** route to Auto Fix |
| `no-ci` | Genuinely no CI on this repo — note it and treat as success |

This replaces carrying watch state across the Phase 6 → Phase 7 boundary. A query is correct by construction at the current head; a remembered verdict is only correct until someone pushes, and several things in Phase 6/7 push in parallel.

```bash
# Watch all checks on the PR — one bounded attempt.
# Issue this Bash call with the tool parameter timeout: 600000.
# The tool's DEFAULT is 120000, which would kill the watch at 2 minutes and
# leave the exit-code handling below unreachable.
timeout 540 gh pr checks <pr-number> --watch

# Or watch a single workflow run by id.
# Same rule, restated rather than inherited: issue with tool timeout: 600000.
timeout 540 gh run watch <run-id>
```

| Exit | Next |
| ---- | ---- |
| 0 | All checks succeeded — go to Step 4 |
| 124 | Still running — watch again, **at most 4 attempts total** (≈ 36 min), counted within this phase. Then run `gh pr checks <pr-number>` once, report the pending checks, and escalate |
| 127, or stderr matching `command not found` / `could not resolve` / `authentication` / `rate limit` | **Tooling failure, not a CI failure** — `timeout` is absent on stock macOS (use `gtimeout`). Report the command failure; do **not** route to Auto Fix |
| Any other non-zero | A check genuinely failed — go to Step 2 |

**No budget is shared with `create-pr` or with any subagent.** Each counts its own attempts inside its own invocation. Phase 7 may therefore re-watch checks `create-pr` already watched — that costs time, never correctness, and the stateless query above makes it rare. An earlier design threaded a counter through a state file across both phases and the `ci-auto-fix` fan-out; it produced racing writers, a counter that could be read before it was written, and a skip that could report an unobserved commit as green. Do not reintroduce it.

| Outcome             | Next step                                                              |
| ------------------- | ---------------------------------------------------------------------- |
| All checks succeed  | Go to Step 4 (report success), then optional cleanup                   |
| One check fails     | Go to Auto Fix                                                         |
| Multiple fail       | Go to Parallel CI Fixes                                                |
| No checks at all    | Likely no CI configured — note in conversation, treat as success       |

### Step 2: Triage Failures (one-line classification)

Before invoking `ci-auto-fix`, decide whether the failure is mechanical or judgment-required. The PR is in your hand and you have the failed check name and log URL.

| Category                                 | Mechanical? | Path                                  |
| ---------------------------------------- | ----------- | ------------------------------------- |
| Lint / format                            | Yes         | Auto Fix                              |
| Generated artifact / snapshot drift      | Yes         | Auto Fix                              |
| Trivial type error                       | Yes         | Auto Fix                              |
| Real test failure                        | No          | Escalate (after one re-run on suspected flake) |
| Ambiguous build / type error             | No          | Escalate                              |
| Infra / workflow YAML failure            | No          | Escalate                              |
| Sensitive (secrets, perms, deploys)      | No          | Escalate, never auto-fix              |
| Suspected flake / unrelated              | Maybe       | Re-run failed jobs once, then re-classify |

```bash
# Re-run only failed jobs once if a flake is suspected
gh run rerun <run-id> --failed
```

## Auto Fix

For any failed check classified as mechanical, invoke `ci-auto-fix` with the run id or PR URL. The skill is provider-agnostic (currently targets GitHub Actions) and owns the full fix → commit → push → re-watch loop.

```
Skill("ci-auto-fix", "<run-id|pr-url>")
```

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — fall back to manual fix-and-push, log and continue               |
| Disable                   | Remove this section; the workflow then stops at first failure and reports to user |

Each `ci-auto-fix` invocation has its own internal retry budget. **Do not wrap it in another loop.** When it returns, accept its verdict and move on.

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 7: ci-auto-fix(<check>) — invoked
- [TIMESTAMP] Phase 7: ci-auto-fix(<check>) — fixed (commit <sha> pushed, CI re-running)
```

## Parallel CI Fixes

When **multiple independent checks** fail in the same CI run, fan out: spawn one `ci-auto-fix` sub-agent per failure, all in the same turn so they run concurrently. This mirrors the parallel pattern in [`create-pr` Step 8](../../../delivery/create-pr/SKILL.md) — align with it rather than duplicating.

Rules for fan-out:

| Rule                                                                  | Why                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Spawn all sub-agents in **one** turn                                  | Concurrency requires same-turn dispatch                            |
| One sub-agent per **independent** failure                             | Failures that share a root cause should be one handoff             |
| **Cap: 2 handoffs per PR** (total across the phase, not per turn)     | Each handoff already burns a full internal retry budget            |
| **Do not wrap each sub-agent in another retry loop**                  | The skill has its own retry budget; layering loops wastes tokens   |
| If 2-handoff cap is reached and CI is still red, **stop and report** | Beyond two handoffs it is no longer mechanical                     |

Sub-agent prompt template (one per failed check):

```
description: Run ci-auto-fix for <check-name>
subagent_type: general-purpose
prompt: |
  Drive the ci-auto-fix workflow end-to-end for this PR.

  PR: <pr-url>
  Failing check: <check-name>
  Run id: <run-id>

  Follow the ci-auto-fix skill's instructions. Apply the minimal fix, commit,
  push, and watch until CI completes. Honor its guardrails — no --no-verify,
  no continue-on-error, no disabling checks. Bound your own watch using the caps
  in your own skill — do not take a number from this prompt; you have no shared
  budget with this phase and write no shared state.

  Return only:
  - outcome: green | escalated | regression-reverted | max-iterations
    (ci-auto-fix's own Phase 9 Outcome values, verbatim — do not translate them.
     `regression-reverted` is safety-relevant: it means your fix made CI worse and
     was rolled back. It must reach the caller intact, not flattened into a failure.)
  - what_was_fixed: one line
  - remaining_error: one short paragraph if still red, else empty

  Sub-Agent Resource Discipline: use scoped commands only — narrow
  tsc/eslint/jest to the files/paths you touched. Do NOT run
  whole-project npm run lint, npx tsc --noEmit (without project refs), npm test
  (without --testPathPattern), or npm run build. The orchestrator runs
  whole-project verification after all sub-agents return.
```

Log to Progress Log:

```markdown
- [TIMESTAMP] Phase 7: ci-auto-fix fan-out — 3 sub-agents dispatched (lint, types, snapshots)
- [TIMESTAMP] Phase 7: ci-auto-fix fan-out — 2 fixed, 1 returned still-failing → escalating
```

### Step 3: Escalation

If `ci-auto-fix` returns **still-failing** or **gave-up**, or if the 2-handoff cap is hit, do **not** keep retrying. Stop the loop and report to the user.

Report must include:

| Field                       | Why                                                            |
| --------------------------- | -------------------------------------------------------------- |
| PR URL + check name(s)      | So the user can jump straight to logs                          |
| Failure category            | Lint, real-test, build, infra, sensitive, etc.                 |
| Short error excerpt         | Top of the failing log, not the whole thing                    |
| What was attempted          | Which sub-agents ran, what they tried                          |
| Why auto-fix stopped        | Cap reached, gave-up, judgment-required, sensitive area        |
| Suggested next step         | Manual fix path, or "this looks like a flake worth one rerun"  |

For judgment-required failures (real-test, ambiguous build, sensitive area), do not invoke `ci-auto-fix` at all. Surface the failure summary and let the user decide.

### Step 4: Report Success

Once all checks are green:

```markdown
- [TIMESTAMP] Phase 7: CI green — PR #XX ready for review
```

Tell the user: PR URL, all checks green, and that the worktree is preserved pending their review/merge.

Then proceed to [Auto Verify](#auto-verify) before any cleanup. Capture any
durable run lesson per [Lessons Write](#lessons-write) (also applies on a
user-approved stop, or when a post-merge bug surfaces in the same session).

## Spec Rehearsal (optional, UI tasks only)

After all CI checks are green and `.agent/{branch}/specs.md` exists, optionally
rehearse the specs against the preview deployment. This validates that the UI
change works end-to-end in the deployed environment, not just locally.

| Property | Value |
|----------|-------|
| Runs when | `specs.md` exists AND a preview URL is available (Vercel/Netlify preview comment, or similar) |
| Skips when | No preview URL, no `specs.md`, `aw-tester` agent not installed |
| Mode | `--all` (report all failures, not just the first) |
| Verdict effect | Advisory — does not block undraft; user makes final call |

### Step 1: Detect preview URL

```bash
# Try to find a preview URL from PR comments
gh pr view <pr-number> --json comments --jq '.comments[].body' \
  | grep -Eo 'https://[a-z0-9-]+\.(vercel\.app|netlify\.app|preview\.[a-z]+)[^ ]*' \
  | head -1
```

If no preview URL is found, log and skip:

```markdown
- [TIMESTAMP] Phase 7: spec-rehearsal — skipped (no preview URL found on PR)
```

### Step 2: Run aw-tester in --all mode

Dispatch `aw-tester` with an ephemeral aw-target override (base_url = preview URL,
auth.strategy: none — preview deployments typically have no captured auth state):

```
description: Rehearse specs against preview deployment
subagent_type: aw-tester
prompt: |
  Rehearse the specs at .agent/{branch}/specs.md against the preview deployment.
  
  Override aw-target base_url to: {preview_url}
  Auth strategy override: none (preview — no auth state available)
  Specs file: .agent/{branch}/specs.md
  Mode: --all
  
  Skip any spec whose preconditions require a logged-in user.
  Return the verdict block in the exact output schema format.
```

### Step 3: Surface verdict (advisory)

| Verdict | What to tell the user |
|---------|----------------------|
| `green` | "Preview rehearsal passed. All {N} specs green on {preview_url}." |
| `red` | "Preview rehearsal flagged {N} failing spec(s). Review before undrafting." |
| `inconclusive` | "Preview rehearsal: {N} specs skipped (auth required). Unauthed specs: {result}." |

Never auto-undraft based on the spec rehearsal verdict. Log:

```markdown
- [TIMESTAMP] Phase 7: spec-rehearsal — verdict: {green|red|inconclusive}
  ({N} specs on {preview_url})
```

---

## Auto Verify

After CI is green and **before** Auto Review, dispatch the `feature-pr-verifier` agent in fresh context to grade the PR against `plan.md`'s Acceptance Criteria, PASS_TO_PASS, diff sanity, and walkthrough integrity. This closes the same self-grading loophole `bug-fix-verifier` closes for bug fixes — Anthropic's harness research is explicit that "agents reliably skew positive when grading their own work."

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes (Lite Mode has no `plan.md` to verify against — skip)              |
| Runs in Lite Mode         | No                                                                     |
| Skips silently if missing | Yes — log one line and continue to Auto Review                         |
| Verdict effect            | Advisory — surfaced inline in chat. The user undrafts the PR.         |
| Disable                   | Remove this section; Auto Review then becomes the next step after CI green |

### Step 1: Detect the `feature-pr-verifier` agent

Stop at the first hit, in this order:

```bash
[ -f ".claude/agents/feature-pr-verifier.md" ] && VERIFIER_AVAILABLE=1
[ -z "$VERIFIER_AVAILABLE" ] && [ -f "$HOME/.agents/agents/feature-pr-verifier.md" ] && VERIFIER_AVAILABLE=1
[ -z "$VERIFIER_AVAILABLE" ] && [ -f "$HOME/.claude/agents/feature-pr-verifier.md" ] && VERIFIER_AVAILABLE=1
```

If none of the paths resolve, log and skip to Auto Review:

```markdown
- [TIMESTAMP] Phase 7: feature-pr-verifier — not available, continuing (install `agents/feature-pr-verifier.md` from agent-skills.git into one of: `.claude/agents/`, `~/.agents/agents/`, `~/.claude/agents/`)
```

If running in Lite Mode (no `plan.md`), also skip:

```markdown
- [TIMESTAMP] Phase 7: feature-pr-verifier — skipped (Lite Mode has no plan.md to verify against)
```

### Step 2: Dispatch the `feature-pr-verifier` sub-agent

Spawn one sub-agent with `subagent_type: feature-pr-verifier` and pass the inputs the agent's contract requires.

```
description: Verify PR after CI green
subagent_type: feature-pr-verifier
prompt: |
  Verify this feature PR. Inputs:

  - plan.md path: .agent/<branch>/plan.md
  - walkthrough.md path: .agent/<branch>/walkthrough.md
  - PR head SHA: <pr_head_sha>
  - Base SHA: <base_sha>
  - Project test command: <project_test_command>

  Follow the feature-pr-verifier agent's procedure end-to-end. Run all four
  checks. Return the verdict block in the exact format specified. Do not
  propose fixes; do not editorialise; do not request additional inputs.
```

Do **not** wrap the sub-agent call in a retry loop — the verifier owns its own validation and returns a single terminal verdict.

### Step 3: Surface the verdict

When the sub-agent returns:

```markdown
- [TIMESTAMP] Phase 7: feature-pr-verifier — verdict: <green|red> (<one-line summary>)
```

Show the user the verifier's full verdict block (it's terse). Then proceed to [Auto Review](#auto-review) regardless of green or red — the user makes the final call on undrafting:

| Verifier verdict | What to tell the user                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| green            | "Verifier passed all four checks. PR ready for your review and undraft."                                 |
| red              | "Verifier flagged Check N: <reason>. PR remains in draft. Recommend addressing the finding before undraft." |

Never auto-undraft. The verifier is advisory; the human is the gatekeeper.

## Auto Review

After CI is green, automatically run `review-loop` against the PR with `--critical`.
Because Phase 7 PRs are always self-authored (aw-executor opens them), `pr-reviewer`
sets `REVIEW_RELATION = self` automatically in Step 0.5.
The loop runs `pr-reviewer` → `implement-suggestion --resolve-all` → `polish simplify` up to 5 iterations
(or until every review thread is resolved via fix or reply), posts a visible `COMMENT` review, applies
findings inline, and answers-and-resolves the non-fix threads. On convergence it refreshes the PR description.
**`review-loop` is a skill companion**, invoked via `Skill()`.

| Property                  | Value                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| Runs in Full Mode         | Yes                                                                    |
| Runs in Lite Mode         | Yes                                                                    |
| Skips silently if missing | Yes — log one line and continue to cleanup step                        |
| Posts comments live?      | Yes — `pr-reviewer` posts one visible `COMMENT` review per iteration   |
| Args                      | `<pr-url> [--critical]` passed to `review-loop`                       |
| Disable                   | Remove this section; CI green becomes the terminal gate                |

**Why a post-CI review pass?** Phase 6 runs the review-loop before CI completes;
Phase 7 runs it again after CI is green, when the merged state is settled and CI feedback
may have prompted further commits. The two passes catch issues at different lifecycle points
and together ensure the PR is clean before the user undrafts.

### Step 1: Detect `review-loop`

Check for the skill in the standard locations:

```bash
[ -f "$HOME/.claude/skills/review-loop/SKILL.md" ] && REVIEW_LOOP_AVAILABLE=1
[ -z "$REVIEW_LOOP_AVAILABLE" ] && [ -f "$HOME/.agents/skills/review-loop/SKILL.md" ] && REVIEW_LOOP_AVAILABLE=1
```

If not found, log and skip:

```markdown
- [TIMESTAMP] Phase 7: review-loop — not available, continuing (install review-loop skill from agent-skills.git)
```

Then proceed to [Optional Post-Merge Cleanup](#optional-post-merge-cleanup).

### Step 2: Invoke `review-loop`

```
Skill("review-loop", "<pr-url> --critical --no-ci")
```

`pr-reviewer` detects self-authorship via `REVIEW_RELATION` in Step 0.5 automatically.
The loop applies findings via `implement-suggestion` and runs `polish simplify` each iteration.
Complex findings that the loop cannot apply are surfaced to the user inline.

Do **not** wrap in a retry loop — `review-loop` owns its own iteration cap.

**`--no-ci` is required here, and Step 2.5 is what makes it safe.** `review-loop`
has its own CI sub-step that would dispatch `ci-auto-fix` on a red check. Letting it
run would create a **second spender** of the per-PR handoff budget this phase owns —
the exact defect the CI-watch contract exists to prevent. So this phase keeps the
budget and does the re-check itself, immediately below.

### Step 2.5: Re-check CI if `review-loop` pushed

`review-loop` **pushes** — sub-step B commits applied findings and sub-step C commits
simplify recipes. Those commits land *after* the Step 1 watch already went green, so
the watch this phase performed says nothing about the current head. Handing back here
reports a green PR on an unobserved commit.

Skip this step only if `review-loop` pushed nothing. Its report carries no run
total — the `applied`, `answered/resolved`, and `simplify recipes` counts appear
**per iteration**, in the `Per-iteration summary:` block — so **sum each of the
three columns across every iteration row** and skip only when all three sums are
zero. A non-zero sum in any one of them means a commit landed. Otherwise:

```bash
# No --watch: returns immediately with the state of the CURRENT head.
gh pr checks <pr-number>
```

Classify with the **same** Step 1 table — "no checks reported" is still three states,
and a bare `gh pr checks` still exits non-zero while merely pending.

| Result | Phase 7 does |
| ------ | ------------ |
| All terminal and passing | Continue to Step 3 |
| Any failing | Route back into [Auto Fix](#auto-fix), **spending the same `attempts` budget** — do not reset it. If it is already exhausted, stop and surface the failing checks rather than starting a fresh budget |
| Any still pending | Watch, bounded, per the Step 1 block — reusing this phase's counters |
| Query errored | Tooling failure. Report and escalate; do **not** route to Auto Fix |

Because this phase never handed the budget to `review-loop`, `attempts` is spent by
this phase alone and still means what Step 1 set it to mean. The counter lives in this
phase's own transcript — no state file carries it across phases
([`diagnostic-surface.md`](./diagnostic-surface.md) — *watch state is queried, never
carried*).

### Step 3: Log and hand back

When the skill returns, log:

```markdown
- [TIMESTAMP] Phase 7: review-loop — self-review complete (N iterations; M findings applied; CI re-checked at <sha>: <green|fixed after K attempts|red>; inline report above)
```

Tell the user: PR URL, that the review-loop applied M findings and surfaced any remaining blockers inline, and that they should review before undrafting.
Then proceed to [Observability Recheck](#observability-recheck).

## Observability Recheck

This section is the anchor referenced from [`companion-skills.md`](./companion-skills.md#registry).

**Why this exists.** The Phase 4 [Observability Gate](./phase-4-testing.md#observability-gate)
audits telemetry before Step 6 — but `ci-auto-fix` ([Auto Fix](#auto-fix)) and
`review-loop` ([Auto Review](#auto-review)) both mutate code **after** that
point: a mechanical CI fix can delete an unused-looking `catch` log, and
`polish simplify` can refactor away a span or an error path Phase 3 added
in the name of cleanliness. Phase 4's audit has no visibility into either —
it already ran. This is the one point in the run, after every code-mutating
step has settled, where a final check can catch that drift before the run
is declared done.

**When:** once, after [Auto Review](#auto-review) completes (or is skipped
because `review-loop` is not installed), only on runs where the original
[Observability Trigger](./phase-3-implementation.md#observability-trigger)
condition matched in Phase 3 — i.e. only when there is coverage to have
lost. Skip entirely on a run where Phase 3 never touched a
`web`/`mobile`/`api`/`worker` path.

```bash
Skill("measurable", "audit --diff --base $(git merge-base HEAD main)")
```

Reuse whatever `--strict` setting the original `aw` invocation carried
(`--observability-strict` at the top level) — this is a recheck of the same
gate, not a new, stricter one:

```bash
Skill("measurable", "audit --diff --base $(git merge-base HEAD main) --strict")
```

| Behavior                       | Detail                                                              |
| ------------------------------ | ------------------------------------------------------------------- |
| Frequency                      | Once, after Auto Fix and Auto Review have both settled              |
| What it checks                 | Same checklist as the Phase 4 gate, against the **current** head — catches coverage Phase 4 confirmed but a later mechanical edit removed, not just coverage that was never added |
| Default behavior (no `--observability-strict`) | Advisory — log the finding, note it in the hand-back message, never block |
| `--observability-strict` behavior | A `missing` finding that **Phase 4 did not already flag** (i.e. newly introduced by Auto Fix or Auto Review) is a regression: fix it directly (it's a small, localized diff — restore the removed span/log/event) and re-run this recheck **once**. If it still reports `missing` after that one attempt, stop and escalate to the user rather than looping — this is a tail check, not a second stuck-loop instance. A `missing` finding that Phase 4 **already** flagged and the user accepted is not re-litigated here |
| Read-only until the regression fix | The recheck itself never writes files; only the one-shot regression fix (under `--observability-strict`) does |
| If skill missing               | Log `measurable() — not available, continuing`                      |
| Progress Log entry             | `[TIMESTAMP] Phase 7: measurable(audit) — recheck: N missing (K new since Phase 4), M unlinked` (or `— not available, continuing`) |

Disable: remove the `Skill("measurable", "audit", ...)` invocation from this
section (the Phase 3/4 companions are unaffected — this is the Phase 7
recheck only). Registry: [`companion-skills.md`](./companion-skills.md#registry).

Then proceed to [Optional Post-Merge Cleanup](#optional-post-merge-cleanup).

## Optional Post-Merge Cleanup

After the PR is merged (state `MERGED`), optionally tear the worktree down to reclaim disk and reduce branch clutter. **Skip if the user wants to keep it.**

### Step 1: Confirm PR Is Merged

```bash
gh pr view <pr-number> --json state,mergedAt
```

| State                | Action                                                       |
| -------------------- | ------------------------------------------------------------ |
| `MERGED`             | Cleanup eligible — proceed to confirm with user              |
| `CLOSED` (not merged)| Cleanup eligible only with explicit user confirmation        |
| `OPEN`               | **Never cleanup** — Phase 7 stays in CI watch                |

### Step 2: Confirm with User

If you don't have an explicit cleanup directive yet, ask:

> "PR #XX is merged. Should I remove the `<branch-name>` worktree?"

Wait for confirmation. Default is to keep the worktree if the user is silent.

### Step 3: Remove Worktree

**Deferred-verification guard.**
If the branch has a pending deferred verification — e.g. `/fix-bug` Phase 8 deferred mode awaiting `/fix-bug --verify-deploy <PR>` (look for a deferred-watch note on the PR / Linear ticket, or a Phase 8 "deferred" entry in `.agent/{branch}/bug-notes.md`) — copy `.agent/{branch}/` into the main checkout **before** removing the worktree, because removal deletes the gitignored `.agent/{branch}/` ledger the re-entry path depends on:

```bash
MAIN="$(git worktree list --porcelain | head -1 | sed 's/^worktree //')"
mkdir -p "$MAIN/.agent/<branch-name>"
cp -R ".agent/<branch-name>/." "$MAIN/.agent/<branch-name>/"
```

`--verify-deploy` later resolves the ledger at `.agent/<branch>/bug-notes.md` relative to the checkout it runs in, so the copy keeps the recovery handle alive after the worktree is gone.

```bash
# With gw (recommended — handles branch + worktree atomically)
gw remove <branch-name>

# Native git worktree fallback (when gw is not installed)
REPO_NAME="$(basename "$(git rev-parse --show-toplevel)")"
BRANCH_SLUG="$(echo "<branch-name>" | tr '/' '-')"
git worktree remove "../${REPO_NAME}-${BRANCH_SLUG}"
git branch -d "<branch-name>"
```

Validate:

| Check                                                     | Expected                       |
| --------------------------------------------------------- | ------------------------------ |
| `gw list` (or `git worktree list`) no longer shows branch | Yes                            |
| Worktree directory deleted                                | Yes                            |
| `.agent/{branch-name}/` artifacts                         | Removed alongside the worktree (copied to the main checkout first when a deferred verification is pending — see guard above) |

### Step 4: Navigate Back to Main

```bash
# With gw (shell integration required)
gw cd main

# Native fallback: cd back to the original repo path
cd "$(git rev-parse --show-toplevel)"
# or just `cd ../<repo>` from the worktree
```

### Step 5: Report Cleanup

```markdown
- [TIMESTAMP] Phase 7: Worktree <branch-name> removed (post-merge)
```

## Lessons Write

**Anchor:** `lessons-write`

At end-of-run — CI green, a user-approved stop, or a post-merge bug observed in
the same session — capture any durable lesson so future runs improve. This is
the **fast tier** of the self-improvement loop; full contract in
[`self-improvement-loop.md`](./self-improvement-loop.md#fast-tier--write-lessons).

Classify each candidate lesson per
[`self-improvement-loop.md#fast-tier--write-lessons`](./self-improvement-loop.md#fast-tier--write-lessons):
universal → `global`; project-bound → `repo::{owner}/{repo}`.

```
# Dedup first so a recurrence updates in place.
memory.search { q: "<lesson keywords>", scopes: ["repo::{owner}/{repo}", "global"], limit: 10 }

# Universal candidate → global.
memory.write { scope: "global", key: "aw-lessons::<slug>", value: "<body>", tags: ["loop::aw-lessons", "source::end-of-run"], source_agent: "aw", trigger: "end-of-run" }

# Project-bound candidate → this repo's scope.
memory.write { scope: "repo::{owner}/{repo}", key: "aw-lessons::<slug>", value: "<body>", tags: ["loop::aw-lessons", "source::end-of-run"], source_agent: "aw", trigger: "end-of-run" }
```

Good end-of-run lessons: a companion trigger that should have fired but didn't,
a plan gap that surfaced only during execution, a recurring fix pattern worth
encoding.

**Applied-lesson UPDATE contract.**
If a lesson read at the start of the run was applied and the failure it targets did not recur, write an UPDATE for that lesson — successful application counts as recurrence evidence.
An UPDATE to an entry that carries a `seen_count` field MUST increment `seen_count` by 1 and refresh `expires`.
Without this write, a lesson that works never accumulates the recurrence evidence the `seen_count >= 3` promotion gate requires.

**Retrospective prompt.**
Before writing, ask: was there friction, a surprise, a guess that paid off, a near-miss, or a companion that should have fired?
Phrase each capture as an **observation** ("last run hit X") not a **rule** ("always do Y") — the read step applies observations as considerations, not constraints.
Write nothing only when the retrospective surfaces nothing **and** no lesson was applied — empty lessons are noise.

- Autonomous writes skip consent, **not** the privacy pre-flight (never store
  secrets / PII). Lessons are workflow mechanics, never product data.
- Recurring lessons UPDATE (same scope + key) and bump `seen_count`. When a
  written or matched lesson reaches `seen_count >= 3` (or is tagged
  `structural`), surface the **scope-appropriate** promotion suggestion:
  `global` lessons promote to skill source via
  `/create-skill diagnose autonomous-workflow`; `repo::` lessons promote to
  repo rules via `Skill("docs", "update --add-rule …")`.
  See [`self-improvement-loop.md#lesson-promotion`](./self-improvement-loop.md#lesson-promotion).

Log:

```markdown
- [TIMESTAMP] Phase 7: lorekit(memory.write global aw-lessons::<slug>) — ADD; 1 promotion-eligible (seen_count=3) → suggested diagnose
- [TIMESTAMP] Phase 7: lorekit(memory.write repo::{owner}/{repo} aw-lessons::<slug>) — ADD; project-bound
- [TIMESTAMP] Phase 7: lorekit — memory.* not connected, continuing
```

Disable by removing this invocation (see
[`companion-skills.md`](./companion-skills.md#registry)).

## Phase 7 Checklist

- [ ] CI watch started after PR opened
- [ ] All failures triaged (mechanical vs judgment)
- [ ] `ci-auto-fix` invoked per mechanical failure (parallel when independent, cap 2)
- [ ] Judgment failures escalated to user with full report
- [ ] CI is green OR user has approved stopping
- [ ] (Optional, UI tasks) `aw-tester` spec rehearsal dispatched against preview URL; verdict surfaced or skip logged
- [ ] (Optional, Full Mode) `feature-pr-verifier` agent dispatched after CI green; verdict surfaced or skip logged
- [ ] (Optional) `review-loop` invoked after CI green with `--critical`; inline report surfaced or skip logged
- [ ] (If Phase 3's Observability Trigger matched) `measurable(audit)` recheck invoked after Auto Fix + Auto Review settle; findings surfaced (advisory) or, under `--observability-strict`, a newly-introduced `missing` finding fixed and re-checked once before escalating (anchor: `observability-recheck`)
- [ ] (Optional) PR merged → worktree removed with user confirmation
- [ ] `lorekit(memory.write aw-lessons)` invoked at end-of-run; promotion suggested if `seen_count >= 3` (anchor: `lessons-write`)
- [ ] Final status reported to user

## References

- Related rule: [phase-6-pr-creation](./phase-6-pr-creation.md)
- Related rule: [phase-4-spec-verification](./phase-4-spec-verification.md) — Phase 4 spec runner (local)
- Companion registry: [companion-skills.md](./companion-skills.md)
- Related skill: [ci-auto-fix](../../../delivery/ci-auto-fix/SKILL.md)
- Related skill: [review-loop](../../../quality/review-loop/SKILL.md) — optional Phase 7 auto-review (self-relation)
- Related skill: [create-pr — Step 8 parallel pattern](../../../delivery/create-pr/SKILL.md)
- Related agent: [aw-tester](../templates/aw-tester.agent.md) — optional Phase 7 spec rehearsal (UI tasks)
- Related agent: [feature-pr-verifier](../../../../agents/feature-pr-verifier.md) — optional Phase 7 auto-verify (Full Mode)
- Without `gw`, clean up natively: `git worktree remove <path>` then `git branch -d <branch>` (Step 3 above shows the full commands).
