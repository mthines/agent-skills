---
name: atelier
description: >
  Takes one change from request to merged PR by sequencing existing skills —
  aw builds the draft PR, prepare gets it green, a deterministic gate allows
  the squash-merge only when a user-visible diff ships behind a
  deployment-verify flag contract — then reads the default-branch pipeline and fixes a red one once, and says
  what a human does next. Resumable from a sticky PR comment; invoke with /atelier.
argument-hint: 'setup | <request> | <pr-url|#n> [--ticket <id|url>] [--unattended] [--keep-draft] [--accept-gaps] [--accept-skip <name,…>] [--no-deliver]'
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '0.7.0'
  workflow_type: orchestrator
  tags: [workflow, orchestrator, merge, gate, deployment-verify, lorekit, resumable, telemetry]
---

# Atelier

Sequences existing skills from a request to a merged PR, checks the default-branch pipeline it started, then stops.
It owns no build, review, verify, or deploy logic: each stage is one delegation, and every decision between stages is a script.
**Why:** [`references/design.md`](./references/design.md).

## Contents

- [Arguments](#arguments)
- [`setup`](#setup)
- [Step 0 — Setup](#step-0--setup)
- [Stages](#stages)
- [Step 4 — Stop](#step-4--stop)
- [Terminal contract](#terminal-contract)
- [Hard rules](#hard-rules)

## Arguments

| Argument | Effect |
| --- | --- |
| `setup` | Only as the sole argument (`/atelier setup SSO for admins` is a request). Ready the repo for runs: preflight, then each gap handed to the skill that fixes it, then a before/after table ([`setup`](#setup)). Runs no stage. |
| `<request>` | Free text: start at Build. |
| `<pr-url\|#n>` | An existing PR: skip Build (`skipped`, reason `existing PR`) and resume from its state comment. |
| `--ticket <id\|url>` | The ticket this work belongs to; [Step 0](#step-0--setup) links it instead of asking. |
| `--unattended` | No human is present: Build forwards `--no-confirm` to `aw` and tells it to run `interview` with `--non-interactive`, so a `blocking` question ends the run as `failed` instead of waiting. |
| `--keep-draft` | Ready leaves the PR a draft; when CI did not run on the draft (`ci-ran.mjs` prints `CI: not-run`), Ready records `hold` (reason `CI not run: draft — <its reason>`). |
| `--max-wait <minutes>` | The longest one [wait for CI](#waiting-for-ci) or [wait for approval](#waiting-for-approval) lasts (default 30). `0` never waits: pending CI or a pending approval records a `hold`, as before. |
| `--no-deliver` | Stop at the merge: skip the [Deliver](#after-the-merge) step (the default-branch pipeline read, its one fix, and the revert). |
| `--accept-gaps` | The user accepts every [preflight](#preflight) gap: Build runs even when a gap leaves a stated criterion unprovable; the gaps ride into `Degraded:`. |
| `--accept-skip <name,…>` | The user accepts that these [companions](#after-build-returns) did not run (`review-loop`, `create-pr`, `quality-pass`, `aw-verify`); only the user passes it, never an agent, and the decision event records it. |

## `setup`

`/atelier setup` readies a repo for atelier runs: it reads preflight, hands each gap to the skill that owns the fix, and shows what changed.
It writes no config itself, records no stage, and starts no trace.
The setup skills it calls ask the user questions, so it runs interactively only: under `--unattended`, print `Needs you: run /atelier setup interactively` and stop.
`preflight.mjs --setup` prints the plan from this table, in this order (`deployment-verify`'s setup reads the `telemetry.yml` that `aw-verify`'s writes):

| Gap | `--setup` prints |
| --- | --- |
| `sign-in`, `telemetry` | `SETUP: Skill("aw-verify", "setup") — fixes <gaps>` (one call for both) |
| `flag-provider`, or `release.yml` without `pipeline:` | `SETUP: Skill("deployment-verify", "setup") — fixes <what is missing>` (one call for both) |
| no `memory/observability-profile/INDEX.md` | `SETUP: Skill("measurable", "setup") — fixes observability-profile (…)`; with `telemetry.yml` → `backend: logs` or `none`, `DECIDED: observability-profile — …` instead (no OpenTelemetry to profile) |
| no `.agents/aw/tracker.yml` | `SETUP: Skill("ticket", "setup") — fixes tracker (…)` |
| `ci-on-draft` | `MANUAL: ci-on-draft — <the workflows that skip drafts> — <the fix>` |
| `flag-provider` with `release.yml` → `providers: []` | `DECIDED: flag-provider — …`: an answer, not missing setup; never delegated, never under `Needs you:` |

```text
✗ release.yml declares providers: [] → Skill("deployment-verify", "setup") on every /atelier setup   # it cannot invent a provider
✓ release.yml declares providers: [] → DECIDED: flag-provider — …                                     # printed, not re-asked
```

1. Resolve script paths and probe GitHub as [Step 0](#step-0--setup) items 1–2, with `A="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts"`.
   `ACCESS_PATH` is `mcp` or `none` → keep `MANUAL: github — run gh auth login for <owner/repo>; the scripts' --pr, --fetch, and --upsert modes need gh` for the end, and continue: setup itself needs no GitHub.
2. Before: run `node "$A/preflight.mjs" --setup --json > setup-before.json`, then `node "$A/preflight.mjs" --setup`, and print its table and lines.
3. Run each `SETUP:` line's call, one at a time, in the printed order, at the top level of this session.
   The called skill owns its questions, its files, and its validation; never write `.agents/aw/*` or the observability profile yourself, and never answer its questions for the user.
   A call that stops or that the user declines → note it for `Ran:` and run the next one.
4. Print every `MANUAL:` line, with the GitHub one from step 1, for `Needs you:`; never edit `.github/workflows/` here.
5. After: run `node "$A/preflight.mjs" --compare setup-before.json` and print its table, adding its `MANUAL: pipeline` line, when printed, to `Needs you:`; when the `telemetry` row is `ok`, call the tool it names once, as Step 0 item 4 does.
6. Commit nothing: pass on the paths the setup skills printed for the user to review and commit.

```text
✗ telemetry gap → write .agents/aw/telemetry.yml with backend: dash0-mcp      # re-implements aw-verify setup and skips its smoke probe
✓ telemetry gap → Skill("aw-verify", "setup") → its Phase E smoke validates what it wrote
```

Emit this block on every exit of `setup`, in place of the run's terminal contract:

```text
ATELIER SETUP
- Before: [the PREFLIGHT line from step 2]
- After: [the PREFLIGHT line from step 5] · [its SETUP: <n> fixed, <m> remaining line]
- Ran: [each Skill call: done | stopped: <reason> | declined, or "nothing to delegate"]
- Files to review and commit: [the paths the setup skills printed, or "none"]
- Needs you: [the MANUAL: lines and each remaining gap with its fix, or "nothing"]
```

## Step 0 — Setup

Run `/atelier` at the top level of a session, never inside a dispatched sub-agent: a nested context runs short and drops companions (`create-pr`, the quality pass, the review) to save itself, and only says so in a `Degraded:` line.

```text
✗ Agent(prompt: "run /atelier <request>")        # nested: aw skips review-loop and create-pr, PR opened unreviewed
✓ /atelier <request>                             # top level: aw and its companions run in this context
```

1. **Script paths.** `CLAUDE_SKILL_DIR` is the directory holding this `SKILL.md`.
   A model that follows this file without `Skill()` (a sub-agent, or a parent that read it) has it unset, so every command below uses `"${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}"`; when this file was read from another path, export `CLAUDE_SKILL_DIR` to its directory first.

   ```text
   ✗ node "$CLAUDE_SKILL_DIR/scripts/state.mjs" …                            # unset → /scripts/state.mjs
   ✓ node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs" …
   ```

2. **GitHub path.** Run from the target repo's checkout, then probe that repo, never `gh auth status`:

   ```bash
   TARGET_REPO="${TARGET_REPO:-$(git remote get-url origin 2>/dev/null | sed 's#\.git$##' | awk -F'[/:]' 'NF>1 {print $(NF-1)"/"$NF}')}"
   command -v gh >/dev/null 2>&1 && [ -n "$TARGET_REPO" ] && gh api "repos/$TARGET_REPO" --jq .full_name >/dev/null 2>&1 && echo GH_OK
   ```

   `GH_OK` → `ACCESS_PATH=gh`; no output with `mcp__github__*` tools present → `mcp`: read the PR and comments with the MCP tools, then pass files and bodies to the scripts' offline flags; neither → `none`: print the terminal contract with `Needs you: GitHub access` and stop.
   The scripts' `--pr`, `--fetch`, and `--upsert` modes need `gh`.
3. **Ticket.** Decide the run's ticket with the `ticket` skill's `ticket.mjs --decide`, from the target repo's checkout (no `tracker.yml` → it only links a named ticket):

   ```bash
   TK="${TICKET_DIR:-$HOME/.claude/skills/ticket}/scripts/ticket.mjs"
   node "$TK" --decide --request "<the request>" [--ticket <id|url the user passed>] [--unattended under --unattended]
   ```

   | Prints | Do |
   | --- | --- |
   | `TICKET: link <id>` | `TICKET=<id>` |
   | `TICKET: ask` | Ask once: "Create a ticket for this?" — yes → `Skill("ticket", "create \"<request>\"")`, `TICKET=` its id; no → `TICKET=none` |
   | `TICKET: create` | `Skill("ticket", "create \"<request>\"")`, `TICKET=` its id |
   | `TICKET: skip — <why>` | `TICKET=none`; a `require: ask` skip goes under `Needs you:` (`no ticket — <why>`) |

   A resumed PR keeps the ticket its PR body links; the script is absent or exits 1 → `TICKET=none` and `Degraded: ticket — <reason>`.
4. **Preflight.** From the target repo's checkout, run `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/preflight.mjs" --model "<your model id>" --ticket "$TICKET" --task "<request title, ≤ 120 chars>"` (add `--pr <pr-url>` when resuming a PR; drop `--ticket` when `TICKET=none`), print its table, and keep its last line (`PREFLIGHT: ok|limited — <n> gaps (…)`) for the first `--record` (`--preflight "<line>"`).
   When the `telemetry` row is `ok`, call the telemetry tool it names once (a cheap list or query); no tool or an error makes `telemetry` a gap, added to the line.
   Then decide with the [preflight table](#preflight).
   Preflight also starts the run's trace; the scripts below record every stage, and [`rules/telemetry.md`](./rules/telemetry.md) lists the three things you add (**Why:** [`references/telemetry.md`](./references/telemetry.md)).
5. Probe LoreKit: `memory.*` tools present and one call answers.
   Absent or failing → one line `Degraded: lorekit unreachable — decision log and outcomes skipped`, and every LoreKit step below is a no-op; no stage waits on it.
6. Run the outcome sweep in [`rules/decision-log.md` § Outcomes](./rules/decision-log.md#outcomes) once, before any stage.
7. With a PR: read its state (`node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs" --fetch --pr <pr-url> > state.md`) and its head (`gh pr view <pr-url> --json headRefOid -q .headRefOid`), then `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs" --next --head <sha> --body-file state.md` names the stage to run.
   A merged PR makes `--next` print `stop`: run [Deliver](#after-the-merge) on it unless `--no-deliver`, so a session that died during the pipeline wait resumes there.
   Pass the PR URL, not a bare number: `state.mjs` takes owner/repo from the URL, and from cwd's `origin` only for a number.
   No atelier comment yet: record Build as `skipped` (reason `existing PR`) before `--next`, so it returns `ready` and `aw` never runs on a PR that exists.
   With a request: the stage is `build`.

### Preflight

Preflight never blocks on its own; a gap blocks only when it leaves a criterion the request (or the existing PR's brief or intent spec) states unprovable.

| Preflight | A stated criterion needs the missing capability | `--accept-gaps` | Do |
| --- | --- | --- | --- |
| `ok` | — | — | run Build |
| `limited` | no | — | run Build; name each gap once under `Degraded:` |
| `limited` | yes: a `telemetry:` criterion with no `telemetry`, a signed-in UI criterion with no `sign-in`, a rollout criterion with no `flag-provider` | no | stop before Build: no stage is recorded; end the trace with `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/telemetry.mjs" finish --outcome stopped --reason "<gap>"`; terminal contract with `Needs you: <gap> — <its fix> (/atelier setup runs it), or re-run with --accept-gaps` |
| `limited` | yes | yes | run Build; the gap goes into the Build reason and `Needs you:` |

A row whose value reads `unknown (could not parse …)` is not a gap and decides nothing.
`ci-on-draft: no` decides nothing here: Ready undrafts to get CI (that notifies reviewers), and under `--keep-draft` Ready holds.

```text
✗ PREFLIGHT: limited — 1 gap (flag-provider) → stop       # no criterion is about the rollout; a human flips the flag
✓ PREFLIGHT: limited — 1 gap (telemetry), request "prove the span is emitted", no --accept-gaps → stop, Needs you:
```

## Stages

Run the stage `--next` named, then the ones after it, in order.
After **every** stage decision, do both, in this order:

1. Record it: `S="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs"; node "$S" --record --stage <s> --decision <d> --head <sha> --reason "<r>" --pr <pr-url> --body-file state.md > next.md && node "$S" --upsert --pr <pr-url> --body-file next.md && mv next.md state.md` ([`rules/state.md`](./rules/state.md)).
   Build's record also takes `--memory "lorekit=<ok|unreachable>,lessons_used=<n>"` ([`rules/telemetry.md` § What you add](./rules/telemetry.md#what-you-add)).
   Ready `proceed` also takes `--ci-file ci.json`, the CI evidence below; `state.mjs` refuses Ready `proceed` without green evidence at `--head` (exit 2).
2. Write one `bus` event ([`rules/decision-log.md`](./rules/decision-log.md)).
3. On a `proceed` with a ticket: `Skill("ticket", "move <TICKET> <stage>")`; on Build also `Skill("ticket", "link <TICKET> <pr-url>")`. A tracker failure is one `Degraded:` line, never a stage outcome.

A decision of `refuse`, `hold`, or `failed` ends the run at Step 4.
A Build that fails before a PR exists has nowhere to record: skip step 1, write the bus event, end the trace (`node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/telemetry.mjs" finish --stage build --decision failed --reason "<r>"`), and stop.

| Stage | Delegation | `proceed` when | Otherwise |
| --- | --- | --- | --- |
| **build** | `Skill("aw", "<request> <build suffix>")` (the suffix on its own paragraph), adding `--no-confirm` under `--unattended`; then the [after-Build checklist](#after-build-returns) | aw's `AW RUN COMPLETE` block names a PR URL, every required companion ran (or the user accepted its skip), the [sentinel](#after-build-returns) passes, and the early gate passes | `hold` (reason `skipped: <companions>`), `failed` (reason = aw's `Needs you:` line or the failing check IDs), or `refuse` after a second early-gate refusal |
| **ready** | unless `--keep-draft`: `gh pr ready <pr-url>` when the PR is a draft, then [wait for the fresh CI run](#after-undrafting); then `Skill("prepare", "<pr-url> --single")`; then the [CI evidence](#ci-evidence); then the [proof](#proof) | prepare printed `Already green` or fixed every PR it touched, `ci-ran.mjs` printed `CI: green`, and `verify-comment.mjs --check --proven` printed `report complete` | `CI: not-run` → `hold`, reason = its `CI not run …` text (prefixed `CI not run: draft — ` under `--keep-draft`); `CI: pending` → [wait](#waiting-for-ci), then `hold` only when still pending after `--max-wait`; `CI: red` or prepare blocked → `failed`, reason = that line; proof still incomplete after one `aw-verify` run → `failed`, reason = `proof: <first problem>` |
| **merge** | gate first, on the live head: `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/merge-gate.mjs" --pr <pr-url>`; exit 0 → [wait for approval](#waiting-for-approval) on the same head; `approved` → `Skill("prepare", "<pr-url> --merge --single")` right away; merged → [finding outcomes](#after-the-merge) | the PR state is `MERGED`; reason = `merged <squash sha>`, plus the gate's `warning:` line when it printed one | gate exit 1 with the JSON's `refused_by` = `ci` and `pending` → [wait for CI](#waiting-for-ci), then run the gate again once; any other `ci` refusal, or a wait that ended `pending`, records **Ready** (not Merge) `hold` (`not-run`, `pending`) or `failed` (`red`), reason = the `MERGE_GATE:` line, so `--next` runs Ready again; `refused_by` = `proof` → record **Ready** `failed`, reason = the `MERGE_GATE:` line, so `--next` runs Ready, whose [proof](#proof) step runs `aw-verify`; `refused_by` = `contract` → `refuse`, reason = the `MERGE_GATE:` line; approval `manual` or `pending` → `hold`, reason = the `APPROVAL_WAIT:` line, with `Needs you:` a person's review; approval `moved` → run the gate again on the new head; prepare blocked → `hold`, reason = its line |

The build suffix, appended verbatim to every request:

```text
Atelier merges this PR. A user-visible change must sit behind a feature flag (reuse an existing flag when one fits), and the PR body must carry a deployment-verify:v1 contract naming it: draft it with `node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>`, then fill "flag": {"key": "<flag>"}, adding "provider" and "cohort" only when .agents/aw/release.yml declares a provider (format: deployment-verify rules/contract.md).
```

Under `--unattended` add the line `No human is present: run interview with --non-interactive; a blocking question ends the run.`
With a ticket, add the line `Link ticket <TICKET>: put "<node "$TK" --pr-line --ticket <TICKET>>" in the PR body.`

- Ready records the head it ran on and the CI evidence; `--next` returns `ready` when the head moved, or when the Ready `proceed` carries no green evidence for this head (a comment written before evidence existed, or by hand).
- The merge gate reads CI again at the head, right before the merge: a Ready `proceed` never stands in for CI that is not green now.
- The gate judges one head, `GATED`; prepare can still push a fix before it merges.
  After the merge, read `gh pr view <pr-url> --json headRefOid -q .headRefOid`; when it differs from `GATED`, run the gate again on the merged PR, and a refusal goes into the merge reason and under `Needs you:` (`merged unchecked head <sha>: <MERGE_GATE line> — add the contract or revert`).
- `--single` keeps atelier to its one PR; prepare's stack walk would merge PRs atelier never built.
- Never run the merge with a gate that exited 1 or 2, and never edit the PR body to make the gate pass: the contract is the author's ([`rules/merge-gate.md`](./rules/merge-gate.md)).

```text
✗ MERGE_GATE: refuse — … → add a placeholder flag to the contract, re-run the gate, merge
✓ MERGE_GATE: refuse — … → record refuse, print the gate's how-to under Needs you:, stop
```

```text
✗ prepare: Already green (draft, 16 of 18 checks skipped) → record ready proceed
✓ gh pr ready <pr-url> → prepare watches the real CI → proceed; under --keep-draft → hold "CI not run: draft"
```

### Proof

We no longer read every line of an autonomous PR; we read what it claims and the proof that the claim holds.
So a PR merges only when its verify report lists every acceptance criterion with a final status and proof, none failed, under a `✅` or `⚠️` verdict (`aw-verify`'s `--check --proven` gate, also the merge gate's proof half; `--proven` refuses the `❌ Not verified` or `⛔ Blocked` report plain `--check` accepts as complete):

```bash
VC="${AW_VERIFY_DIR:-$HOME/.claude/skills/aw-verify}/scripts/verify-comment.mjs"
node "$VC" --pr <pr-url> --check --proven [--ui]   # --ui when the gate's user_visible is true; last line: report complete
```

Exit 0 → Ready continues.
Exit 1 → run `Skill("aw-verify", "run checks <pr-url>")` for a non-UI diff (recorded test runs prove each criterion; no browser) or `Skill("aw-verify", "run preview <pr-url>")` for a UI diff, then check again; still exit 1 → Ready `failed`, reason `proof: <first problem it printed>`.
Never write the report or tick a criterion by hand to pass it: only `verify-comment.mjs` writes the regions, from a run.

```text
✗ Windows-only fix, tests green, no verify report → Ready proceed → merge
✓ verify-comment --check → "no intent region" → aw-verify run checks <pr> → report complete → Ready proceed
```

### CI evidence

After `prepare` returns, re-read the head (`prepare` may have pushed a fix), read CI at that head with `prepare`'s own helper, and keep its output as the Ready evidence:

```bash
SHA=$(gh pr view <pr-url> --json headRefOid -q .headRefOid)
node "${PREPARE_DIR:-$HOME/.claude/skills/prepare}/scripts/ci-ran.mjs" --pr <pr-url> --head "$SHA" > ci.json; tail -1 ci.json
```

`CI: pending` here goes to [Waiting for CI](#waiting-for-ci), which rewrites `ci.json` when the wait ends.

`CI: green` is the only line that allows Ready `proceed`, recorded with `--head "$SHA" --ci-file ci.json`.
"CI ran" is the helper's rule, the same one `prepare` uses: a required check, or with none required a GitHub Actions check run, completed without being skipped; an external status (Vercel) counts only when the repo marks it required.

```text
✗ 16 checks SKIPPED, 2 Vercel statuses SUCCESS → prepare "Already green" → Ready proceed
✓ ci-ran.mjs → CI: not-run — CI not run at b56dfb5: every required check skipped (4) → Ready hold
```

### After undrafting

Run the [CI evidence](#ci-evidence) command before `gh pr ready`.
`CI: green`, `red`, or `pending` → CI already ran on the draft (and a workflow without a `ready_for_review` trigger will not run again): go straight to `prepare`.
`CI: not-run` → CI has not run on this head: the checks listed right after `gh pr ready` are none or the draft's skipped ones, which `prepare` would read as green.
Re-read `gh pr checks <pr-url> --json name,state,startedAt` until at least one check started after the undraft, then [wait for CI](#waiting-for-ci), then call `prepare`.
No new check within 5 minutes → Ready `hold`, reason `CI not run: no checks started after undraft`.

```text
✗ gh pr ready <pr-url>; Skill("prepare", …)                 # reads 2 passed + 16 skipped from the draft → Already green
✓ gh pr ready <pr-url>; a check started after the undraft; wait for CI; Skill("prepare", …)
```

### Waiting for CI

A run that stops at `CI: pending` leaves the user to resume it, so atelier waits for the checks itself, up to `--max-wait` minutes per wait, and carries on.
`ci-wait.mjs` polls `ci-ran.mjs` (the same "CI ran" rule as everywhere else) every 30 seconds; run it through the telemetry wrapper so the trace books the time as waiting:

```bash
T="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/telemetry.mjs"
W="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/ci-wait.mjs"
node "$T" wait ci -- node "$W" --pr <pr-url> --head "$SHA" --max-wait <minutes> --out ci.json; tail -1 ci.json
```

| Exit | Last line | Do |
| --- | --- | --- |
| 0 | `CI_WAIT: green` | carry on: Ready `proceed` with `--ci-file ci.json`, or the gate again before a merge |
| 1 | `CI_WAIT: red` | Ready `failed`, reason = that line; `prepare` fixes it on the next Ready |
| 1 | `CI_WAIT: not-run` | no check started within 5 minutes: Ready `hold`, reason = its `CI not run …` text |
| 3 | `CI_WAIT: pending` | still running after `--max-wait`: Ready `hold`, reason = that line, `Needs you: re-run /atelier <pr-url> when CI finishes` |
| 4 | `CI_WAIT: moved` | the head changed while waiting: read it again, then re-run the stage on the new head |
| 2 | stderr | `failed`, reason = stderr |

`--head` is the sha the evidence is for, so a push during the wait is never mistaken for green.
Deliver has its own bounded wait (`pipeline.mjs --wait`); this one covers PR CI.

### Waiting for approval

A repo can block the merge on a required review that something other than a person gives: an auto-approval app, a policy check.
Which one is the repo's choice, so it is configuration, not something atelier knows.
After the merge gate passes, atelier waits for the named checks to approve, up to `--max-wait` minutes, and merges only on an approval; otherwise the merge is a person's job and the run says so.

The repo names them in `.agents/aw/merge.yml` (committed, no secrets; every field optional), or a run passes `--check <regex>` (repeatable), which wins:

```yaml
version: 1
approval:
  wait_for: ["Darkplane auto-approval"]   # regexes, case-insensitive, on check-run or status names; all must pass
  max_wait_minutes: 30                    # default for --max-wait
  start_grace_minutes: 5                  # how long a named check may take to show up
```

No `merge.yml` and no `--check` → a required review is a person's job at once (`manual`), with no wait; nothing about the repo is assumed.
`approval-wait.mjs` reads the live PR every 30 seconds; run it through the telemetry wrapper so the trace books the time as waiting:

```bash
T="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/telemetry.mjs"
W="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/approval-wait.mjs"
node "$T" wait review -- node "$W" --pr <pr-url> --head "$GATED" [--max-wait <minutes>] [--check <regex>]...
```

| Exit | Last line | Do |
| --- | --- | --- |
| 0 | `APPROVAL_WAIT: approved` | the review decision is `APPROVED`, no review is required, or every named check passed: run `Skill("prepare", "<pr-url> --merge --single")` right away |
| 0 | `APPROVAL_WAIT: merged` | already merged: carry on with [After the merge](#after-the-merge) |
| 1 | `APPROVAL_WAIT: manual` | a named check finished without approving or never ran, changes were requested, or a review is required and none is configured: Merge `hold`, reason = that line, `Needs you:` a person's review of `<pr-url>`; never use `--admin` or `--force` |
| 3 | `APPROVAL_WAIT: pending` | a named check was still running after `--max-wait`: Merge `hold`, reason = that line, `Needs you: re-run /atelier <pr-url> when <the check> finishes` |
| 4 | `APPROVAL_WAIT: moved` | the head changed while waiting: run the merge gate again on the new head |
| 2 | stderr | `failed`, reason = stderr |

Only an approval of the head the gate judged counts (`--head`), so a push during the wait is never mistaken for an approval.
Atelier never approves a PR itself and never asks a bot to; it only waits for the repo's own automatic approval.
`/atelier setup` does not write `merge.yml`: add it by hand when the repo has an auto-approval to wait for.

```text
✗ gate passed, reviewDecision REVIEW_REQUIRED → gh pr merge --admin                   # skips the review the repo requires
✗ approval-wait names one vendor's check in the script itself                          # another repo has a different bot, or none
✗ the named check already finished NEUTRAL → wait the full 30 minutes                 # it did not approve, and will not change
✓ gate passed → approval-wait (merge.yml names the check) → approved → prepare --merge
✓ gate passed → approval-wait (nothing named) → manual → Merge hold, "Needs you: review <pr>"
```

### After Build returns

`aw` can run for hours in this context; do these in order before anything else, and re-read this section when unsure where the run is:

1. **Hand-back.** Find aw's terminal block, the hand-back marker `AW RUN COMPLETE`.
   Take the PR URL from the block's `Delivered:` line, or from the one-line form Micro and Lite may print (`AW RUN COMPLETE — Lite, PR <url>, …`).
   No block, or no PR URL in either form → Build `failed`, reason = its `Needs you:` line (or `no AW RUN COMPLETE block`); bind `PR` and its head sha otherwise.
2. **Companions.** Save aw's hand-back block to `aw.txt`, run the contract half of the gate once (step 4 judges the same output and exit code), then check the companions:

   ```bash
   A="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts"
   node "$A/merge-gate.mjs" --pr <pr-url> --contract-only > gate.json; echo $? > gate.exit
   node "$A/state.mjs" --companions --aw-file aw.txt [--accept-skip <the user's names>]
   ```

   `COMPANIONS: proceed` → continue; `COMPANIONS: hold — skipped: <names>` → Build `hold` with that reason, and `Needs you: run <names> on <pr-url>, or re-run /atelier <pr-url> --accept-skip <names>`.
   Required: `review-loop` and `create-pr` on every tier, plus `quality-pass` on Lite and Full, plus `aw-verify` on every Lite or Full diff (browser on a UI diff, checks-only otherwise).

   ```text
   ✗ Degraded: review-loop skipped (context budget) → Build proceed     # an unreviewed PR walks to the merge
   ✓ Degraded: review-loop skipped (context budget) → Build hold "skipped: review-loop"
   ```

3. **Sentinel.** In the PR branch's worktree (`git worktree list` names it), when `.agent/<branch>/checks.yaml` exists (Full tier), run the checks fresh; Micro and Lite have none and skip this:

   ```bash
   AW_SKILL_DIR="${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}"
   D=".agent/$(git branch --show-current)"
   node "$AW_SKILL_DIR/scripts/run-checks.mjs" "$D/checks.yaml" --no-write | tail -1    # the sentinel
   node "$AW_SKILL_DIR/scripts/run-checks.mjs" "$D/checks.yaml" --statuses              # each check's stored status
   ```

   | Sentinel | Build |
   | --- | --- |
   | `CHECKS M/M PASS` | continue |
   | `CHECKS p/M FAIL: <ids>`, every listed id `unsatisfiable` in `--statuses` | continue; carry each id into the final `Needs you:` (`AC-4 unsatisfiable: <why>`) and into the Build reason |
   | any other `FAIL` | `failed`, reason = the sentinel line |

4. **Early gate.** Judge step 2's `merge-gate.mjs --contract-only` result — the contract half only, because CI on a fresh draft has not run yet; on a resumed Build, or when the head moved since step 2, run that gate command again first.
   Exit 0 → continue.
   Exit 1 → send Build back once, for that fix only: `Skill("aw", "<pr-url>: make the merge gate pass — <MERGE_GATE line> <the gate's how-to lines> <build suffix>")` (one paragraph each), then run the gate again; a second exit 1 → Build `refuse`, reason = the `MERGE_GATE:` line.
   Exit 2 → Build `failed`, reason = its stderr.
5. **Record** Build `proceed` (or the decision above) on the PR, passing `--preflight "<PREFLIGHT line>"`, write the bus event with this gate JSON's `user_visible` and `has_flag_contract`, then run Ready.

A resumed `build` on a PR that exists (the state comment shows Build `refuse` or `failed` after a PR URL was bound) skips `aw` and starts at step 4, so a contract a human added is gated, not rebuilt.
A resumed Build `hold` whose reason starts `skipped:` continues at step 3 only when the user's `--accept-skip` names every listed companion (reason `accepted skip: <names> (user)`); otherwise it records the same hold again.

### After the merge

Only once the PR state is `MERGED`, score the quality findings per autonomous-workflow's `rules/finding-outcomes.md` § When it runs, before any worktree is removed:

```bash
AW_SKILL_DIR="${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}"
F="<the PR branch's worktree>/.agent/<head-branch>/quality-findings.jsonl"
HEAD_SHA=$(gh pr view <pr-url> --json headRefOid -q .headRefOid)
OPENED_SHA=$(gh pr view <pr-url> --json createdAt,commits \
  -q '.createdAt as $c | [.commits[] | select(.committedDate <= $c)] | last | .oid')
git fetch -q origin "pull/<n>/head"
if [ -z "$OPENED_SHA" ] || [ "$OPENED_SHA" = null ]; then
  echo "Degraded: quality finding outcomes — not recorded (opening head not found: PR rebased)"
elif test -s "$F"; then
  node "$AW_SKILL_DIR/scripts/finding-outcomes.mjs" --record --findings "$F" \
    --since "$OPENED_SHA" --later "$HEAD_SHA" --repo <owner/repo> --pr <n> --model "<your model id>"
fi
```

1. No worktree for the branch, or no findings file → skip it and print nothing.
2. Exit 2, or no LoreKit → `Degraded: quality finding outcomes — not recorded (<stderr or lorekit unreachable>)`; the merge decision stands.
3. Never run it on a merge that did not happen: a refused or held merge scores nothing.

Then run Deliver ([`rules/deliver.md`](./rules/deliver.md)) unless `--no-deliver`: the merge is not the end while the default-branch pipeline is red.
Deliver is not a recorded stage (`state.mjs` knows `build|ready|merge`); it reports through a `bus` event and the terminal contract's `Deliver:` line.

## Step 4 — Stop

Atelier never flips a flag and never runs `deployment-verify`.
After a merge, put the next human step under `Needs you:`:

| The merged PR | `Needs you:` |
| --- | --- |
| has a contract whose flag provider `release.yml` declares | `run /deployment-verify <pr> to roll <flag> out; when release.yml sets hold_after, the rollout waits there for /deployment-verify approve <pr> (tick.mjs --approve) or override <pr> (--override)` |
| has a contract the gate passed with the no-provider warning | `flip <flag> on by hand — deployment-verify cannot step it here (no provider)` |
| has no user-visible diff | `nothing — not user-visible` |
| held at Merge because approval was `manual` or `pending` | `review and approve <pr-url> (<the APPROVAL_WAIT reason>); it merges afterwards where auto-merge or a merge queue is on` |

## Terminal contract

Emit this block on every exit:

```text
ATELIER RUN
- Stage reached: [build | ready | merge | stop]
- PR: [URL | none]
- Ticket: [<id> | none — <why>]
- Merge: [merged <sha> | refused: <reason> | not reached]
- Deliver: [green <run url> | red: <reason> | fix PR <url> | revert PR <url> | reverted <revert PR url> | skipped: <reason> | not reached]
- Degraded: [steps skipped and why, or "none"]
- Needs you: [the next human step, or "nothing"]
```

## Hard rules

- **Delegate, never re-implement.** A stage that needs build, fix, review, verify, or merge logic calls the owning skill.
- **Scripts decide.** The next stage comes from `state.mjs --next`, the merge from `merge-gate.mjs`, outcomes from `outcomes.mjs`; never from your judgment.
- **LoreKit is evidence, never a gate.** A failed write is one `Degraded:` line; the stage outcome stands.
- **No flag flips, no deploys.** Those belong to a human or `/deployment-verify`.
- **Top level only.** Never dispatch `/atelier` or its Build into a sub-agent; a nested run drops companions.
- **Telemetry never decides.** The trace records stages; no stage reads it, and a failed export is never a `Degraded:` item.
- **Only the user waives.** A skipped companion or a blocking preflight gap is overridden only by the user's `--accept-skip` or `--accept-gaps`, never by your judgment.
