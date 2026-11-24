---
name: atelier
description: >
  Takes one change from request to merged PR by sequencing existing skills —
  aw builds the draft PR, prepare gets it green, a deterministic gate allows
  the squash-merge only when a user-visible diff ships behind a
  deployment-verify flag contract — then stops and says what a human does
  next. Resumable from a sticky PR comment; invoke with /atelier.
argument-hint: '<request> | <pr-url|#n> [--unattended] [--keep-draft]'
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '0.3.0'
  workflow_type: orchestrator
  tags: [workflow, orchestrator, merge, gate, deployment-verify, lorekit, resumable]
---

# Atelier

Sequences existing skills from a request to a merged PR, then stops.
It owns no build, review, verify, or deploy logic: each stage is one delegation, and every decision between stages is a script.
**Why:** [`references/design.md`](./references/design.md).

## Contents

- [Arguments](#arguments)
- [Step 0 — Setup](#step-0--setup)
- [Stages](#stages)
- [Step 4 — Stop](#step-4--stop)
- [Terminal contract](#terminal-contract)
- [Hard rules](#hard-rules)

## Arguments

| Argument | Effect |
| --- | --- |
| `<request>` | Free text: start at Build. |
| `<pr-url\|#n>` | An existing PR: skip Build (`skipped`, reason `existing PR`) and resume from its state comment. |
| `--unattended` | No human is present: Build forwards `--no-confirm` to `aw` and tells it to run `interview` with `--non-interactive`, so a `blocking` question ends the run as `failed` instead of waiting. |
| `--keep-draft` | Ready leaves the PR a draft; when CI did not run on the draft (`ci-ran.mjs` prints `CI: not-run`), Ready records `hold` (reason `CI not run: draft — <its reason>`). |

## Step 0 — Setup

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
3. Probe LoreKit: `memory.*` tools present and one call answers.
   Absent or failing → one line `Degraded: lorekit unreachable — decision log and outcomes skipped`, and every LoreKit step below is a no-op; no stage waits on it.
4. Run the outcome sweep in [`rules/decision-log.md` § Outcomes](./rules/decision-log.md#outcomes) once, before any stage.
5. With a PR: read its state (`node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs" --fetch --pr <pr-url> > state.md`) and its head (`gh pr view <pr-url> --json headRefOid -q .headRefOid`), then `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs" --next --head <sha> --body-file state.md` names the stage to run.
   Pass the PR URL, not a bare number: `state.mjs` takes owner/repo from the URL, and from cwd's `origin` only for a number.
   No atelier comment yet: record Build as `skipped` (reason `existing PR`) before `--next`, so it returns `ready` and `aw` never runs on a PR that exists.
   With a request: the stage is `build`.

## Stages

Run the stage `--next` named, then the ones after it, in order.
After **every** stage decision, do both, in this order:

1. Record it: `S="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/state.mjs"; node "$S" --record --stage <s> --decision <d> --head <sha> --reason "<r>" --pr <pr-url> --body-file state.md > next.md && node "$S" --upsert --pr <pr-url> --body-file next.md && mv next.md state.md` ([`rules/state.md`](./rules/state.md)).
   Ready `proceed` also takes `--ci-file ci.json`, the CI evidence below; `state.mjs` refuses Ready `proceed` without green evidence at `--head` (exit 2).
2. Write one `bus` event ([`rules/decision-log.md`](./rules/decision-log.md)).

A decision of `refuse`, `hold`, or `failed` ends the run at Step 4.
A Build that fails before a PR exists has nowhere to record: skip step 1, write the bus event, and stop.

| Stage | Delegation | `proceed` when | Otherwise |
| --- | --- | --- | --- |
| **build** | `Skill("aw", "<request> <build suffix>")` (the suffix on its own paragraph), adding `--no-confirm` under `--unattended`; then the [after-Build checklist](#after-build-returns) | aw's `AW RUN COMPLETE` block names a PR URL, the [sentinel](#after-build-returns) passes, and the early gate passes | `failed` (reason = aw's `Needs you:` line or the failing check IDs), or `refuse` after a second early-gate refusal |
| **ready** | unless `--keep-draft`: `gh pr ready <pr-url>` when the PR is a draft, then [wait for the fresh CI run](#after-undrafting); then `Skill("prepare", "<pr-url> --single")`; then the [CI evidence](#ci-evidence) | prepare printed `Already green` or fixed every PR it touched, and `ci-ran.mjs` printed `CI: green` | `CI: not-run` → `hold`, reason = its `CI not run …` text (prefixed `CI not run: draft — ` under `--keep-draft`); `CI: pending` → watch once more, then `hold`; `CI: red` or prepare blocked → `failed`, reason = that line |
| **merge** | gate first, on the live head: `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/merge-gate.mjs" --pr <pr-url>`; exit 0 → `Skill("prepare", "<pr-url> --merge --single")` right away; merged → [finding outcomes](#after-the-merge) | the PR state is `MERGED`; reason = `merged <squash sha>`, plus the gate's `warning:` line when it printed one | gate exit 1 (no contract, or CI not green at the head) → `refuse`, reason = the `MERGE_GATE:` line; prepare blocked → `hold`, reason = its line |

The build suffix, appended verbatim to every request:

```text
Atelier merges this PR. A user-visible change must sit behind a feature flag (reuse an existing flag when one fits), and the PR body must carry a deployment-verify:v1 contract naming it: draft it with `node <deployment-verify>/scripts/tick.mjs --draft-contract --pr <n>`, then fill "flag": {"key": "<flag>"}, adding "provider" and "cohort" only when .agents/aw/release.yml declares a provider (format: deployment-verify rules/contract.md).
```

Under `--unattended` add the line `No human is present: run interview with --non-interactive; a blocking question ends the run.`

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

### CI evidence

After `prepare` returns, read CI at the head with `prepare`'s own helper, and keep its output as the Ready evidence:

```bash
node "${PREPARE_DIR:-$HOME/.claude/skills/prepare}/scripts/ci-ran.mjs" --pr <pr-url> --head <sha> > ci.json; tail -1 ci.json
```

`CI: green` is the only line that allows Ready `proceed`, recorded with `--ci-file ci.json`.
"CI ran" is the helper's rule, the same one `prepare` uses: a required check, or with none required a GitHub Actions check run, completed without being skipped; external statuses (Vercel) never count.

```text
✗ 16 checks SKIPPED, 2 Vercel statuses SUCCESS → prepare "Already green" → Ready proceed
✓ ci-ran.mjs → CI: not-run — CI not run at b56dfb5: every required check skipped (4) → Ready hold
```

### After undrafting

Run the [CI evidence](#ci-evidence) command before `gh pr ready`.
`CI: green`, `red`, or `pending` → CI already ran on the draft (and a workflow without a `ready_for_review` trigger will not run again): go straight to `prepare`.
`CI: not-run` → CI has not run on this head: the checks listed right after `gh pr ready` are none or the draft's skipped ones, which `prepare` would read as green.
Re-read `gh pr checks <pr-url> --json name,state,startedAt` until at least one check started after the undraft, then `gh pr checks <pr-url> --watch`, then call `prepare`.
No new check within 5 minutes → Ready `hold`, reason `CI not run: no checks started after undraft`.

```text
✗ gh pr ready <pr-url>; Skill("prepare", …)                 # reads 2 passed + 16 skipped from the draft → Already green
✓ gh pr ready <pr-url>; a check started after the undraft; gh pr checks --watch; Skill("prepare", …)
```

### After Build returns

`aw` can run for hours in this context; do these in order before anything else, and re-read this section when unsure where the run is:

1. **Hand-back.** Find aw's terminal block, the hand-back marker `AW RUN COMPLETE`.
   Take the PR URL from the block's `Delivered:` line, or from the one-line form Micro and Lite may print (`AW RUN COMPLETE — Lite, PR <url>, …`).
   No block, or no PR URL in either form → Build `failed`, reason = its `Needs you:` line (or `no AW RUN COMPLETE block`); bind `PR` and its head sha otherwise.
2. **Sentinel.** In the PR branch's worktree (`git worktree list` names it), when `.agent/<branch>/checks.yaml` exists (Full tier), run the checks fresh; Micro and Lite have none and skip this:

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

3. **Early gate.** `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/merge-gate.mjs" --pr <pr-url> --contract-only` — the contract half only, because CI on a fresh draft has not run yet.
   Exit 0 → continue.
   Exit 1 → send Build back once, for that fix only: `Skill("aw", "<pr-url>: make the merge gate pass — <MERGE_GATE line> <the gate's how-to lines> <build suffix>")` (one paragraph each), then run the gate again; a second exit 1 → Build `refuse`, reason = the `MERGE_GATE:` line.
   Exit 2 → Build `failed`, reason = its stderr.
4. **Record** Build `proceed` (or the decision above) on the PR, write the bus event with this gate JSON's `user_visible` and `has_flag_contract`, then run Ready.

A resumed `build` on a PR that exists (the state comment shows Build `refuse` or `failed` after a PR URL was bound) skips `aw` and starts at step 3, so a contract a human added is gated, not rebuilt.

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

## Step 4 — Stop

Atelier never flips a flag and never runs `deployment-verify`.
After a merge, put the next human step under `Needs you:`:

| The merged PR | `Needs you:` |
| --- | --- |
| has a contract whose flag provider `release.yml` declares | `run /deployment-verify <pr> to roll <flag> out; when release.yml sets hold_after, the rollout waits there for /deployment-verify approve <pr> (tick.mjs --approve) or override <pr> (--override)` |
| has a contract the gate passed with the no-provider warning | `flip <flag> on by hand — deployment-verify cannot step it here (no provider)` |
| has no user-visible diff | `nothing — not user-visible` |

## Terminal contract

Emit this block on every exit:

```text
ATELIER RUN
- Stage reached: [build | ready | merge | stop]
- PR: [URL | none]
- Merge: [merged <sha> | refused: <reason> | not reached]
- Degraded: [steps skipped and why, or "none"]
- Needs you: [the next human step, or "nothing"]
```

## Hard rules

- **Delegate, never re-implement.** A stage that needs build, fix, review, verify, or merge logic calls the owning skill.
- **Scripts decide.** The next stage comes from `state.mjs --next`, the merge from `merge-gate.mjs`, outcomes from `outcomes.mjs`; never from your judgment.
- **LoreKit is evidence, never a gate.** A failed write is one `Degraded:` line; the stage outcome stands.
- **No flag flips, no deploys.** Those belong to a human or `/deployment-verify`.
