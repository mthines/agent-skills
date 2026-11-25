---
title: Deliver — follow the merge into the default-branch pipeline; fix a red one once, then revert
impact: HIGH
tags: [atelier, deliver, pipeline, post-merge, ci, release, revert]
---

# Deliver

A merged PR is not delivered until the pipeline GitHub starts for the merge commit on the default branch has gone green.
That pipeline builds, versions, and releases the change, and PR CI does not exercise all of it: a release job that only runs on `main` can fail on a PR that was green.
Deliver runs after the merge, reads that pipeline with `scripts/pipeline.mjs`, and starts one bounded fix when it is red; when the fix does not turn it green, it reverts the merge through a PR.
**Why:** [`../references/design.md`](../references/design.md#delivery).

## Run

```bash
P="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/pipeline.mjs"
node "$P" --pr <pr-url>               # PIPELINE: green|pending|cancelled|red|none — <reason>
```

`--pr` resolves the merge commit and base branch from the merged PR; the config comes from `.agents/aw/release.yml` → `pipeline:` (the `deployment-verify` skill's `rules/config.md`, § Pipeline).
The wait is `pipeline.timeout_minutes` (default 20; `--wait <minutes>` overrides it), polled every 30 seconds; `none` right after a merge also waits, because GitHub registers the run a few seconds late.

| Exit | Line | Deliver decision |
| --- | --- | --- |
| 0 | `PIPELINE: green` | `proceed`, reason `pipeline green <run url>` |
| 3 | `PIPELINE: cancelled` | `hold`, reason = the line: a concurrency group usually cancelled it for a later push; `Needs you:` names that later run to read, never a fix |
| 3 | `PIPELINE: pending` after `--wait` | `hold`, reason = the line, `Needs you:` names the run to watch |
| 1 | `PIPELINE: none` | `hold`, reason `no pipeline run for <sha>`: the repo may not run one on merge; the user confirms |
| 1 | `PIPELINE: red — <workflow › job › step>` | read the cause, then follow the [order](#order): the fix start records `hold` (reason `fix PR <url>`), a revert start records `hold` (reason `revert PR <url>`), and the last PR's own green result records `proceed` |
| 2 | stderr | `failed`, reason = stderr; never fix on a read that errored |

A required job that is `skipped` counts as red: a job that should always run but skipped means a step before it failed, and a green run hides that.
Name a job in `required_jobs` only when it runs on every merge: a job gated on "a release is due" also skips when nothing is due, and would read red.
A repo with no `pipeline:` block reads every run of the merge commit and requires none by name, so only a failed run or job is red.

## Fix lane

One round, never more.
The lane exists because the pipeline broke after review, so the fix gets its own PR with its own gates; atelier never pushes to the default branch.

1. Read the failing job's log (`gh run view <id> --log-failed`) and decide the cause class:

   | Cause | Do |
   | --- | --- |
   | The merged change broke the build or a test only `main` runs | fix lane below |
   | A flake, an expired secret, a runner outage, a rate limit | no fix: `hold`, reason = the cause, `Needs you:` names the re-run (`gh run rerun <id> --failed`) or the secret to rotate |
   | The pipeline's own state: a missing tag, a version already bumped, a protected-branch push, a release that needs credentials | no fix: `hold`, `Needs you:` carries the exact command, never run by atelier |

2. Fix lane: a new branch from the updated default branch, `Skill("aw", "fix the default-branch pipeline failure of <pr-url>: <failing job and step, log excerpt> <build suffix>")`, which opens its own PR.
   After a `revert-first` revert, the default branch no longer holds the change, so the request reads `re-apply the change <pr-url> reverted in <revert PR url>, with a fix for <failing job and step, log excerpt> <build suffix>`.
   Take that PR through Ready and Merge with the same gates as the first one (`prepare`, `ci-ran.mjs`, the Ready [proof](../SKILL.md#proof) step, `merge-gate.mjs`); then run `pipeline.mjs` against the fix PR.
3. A second red result goes to the [revert lane](#revert-lane), as [Order](#order) says; there is no second fix round.

## Order

`.agents/aw/release.yml` → `pipeline.on_red` sets the order of the two lanes; only the cause class "the merged change broke it" reaches either.

| `on_red` | First red (the merged PR) | Second red |
| --- | --- | --- |
| `fix-first` (default) | fix lane | the fix PR is red: revert lane on the fix PR's and the merged PR's squash shas, newest first |
| `revert-first` | revert lane; once its PR is green, the fix lane re-applies the change with the fix. A revert the policy blocks (`never`, a declined or unattended `ask`) goes straight to the fix lane, as under `fix-first` | the re-apply PR is red: revert lane on the re-apply PR's squash sha alone. The revert PR is red: `failed` |

`revert-first` suits a repo where a red default branch blocks other people's merges or releases; `fix-first` keeps the change live when a small fix is likely.

## Revert lane

Each merged PR is reverted at most once, and a revert PR is never reverted: the lane backs out the merged change through a PR with the same gates, never a push to the default branch.
Atelier never runs `deployment-verify` and never flips a flag: a flag or platform rollback of a rolled-out change stays with `deployment-verify`, and a code revert stays here.

The rollback policy decides whether the lane acts: `~/.agents/aw/config.yml` → `policies.rollback`, overridden by `repos.<slug>.policies.rollback` (the same setting `deployment-verify` reads; its `rules/config.md`, § Policy, which spells out what `auto` means for a code revert).

| `policies.rollback` | Do |
| --- | --- |
| `ask` (default) | Print the `PIPELINE:` line, the cause, and the revert plan, ask once, and revert on yes; on no, `hold` with the revert command under `Needs you:`. Under `--unattended`, do not revert: `hold`, reason `revert needs a human (policies.rollback: ask)` |
| `auto` | Revert without asking |
| `never` | Do not revert: `failed`, reason = the `PIPELINE:` line, with the revert command under `Needs you:` |

On a `revert-first` first red, a row that does not revert (`never`, a declined or unattended `ask`) runs the fix lane instead of stopping ([Order](#order)); the `hold` or `failed` above applies only when there is no fix round left.

When the policy allows it:

1. Revert on a new branch from the updated default branch, never on the default branch itself:

   ```bash
   git fetch origin <base> && git switch -c revert/<newest reverted pr-number> origin/<base>
   git revert --no-edit <sha> …   # the squash shas the Order row names, newest first; -m 1 for a merge commit
   git push -u origin revert/<newest reverted pr-number>
   gh pr create --base <base> --title "Revert \"<pr title>\"" --body-file revert-body.md   # "Reverts #<pr-number>: <PIPELINE line>" + the merged PR's contract and ui-verify spec blocks
   ```

   A conflict in `git revert` means later merges touched the same lines: abort (`git revert --abort`), `hold`, and put the revert command under `Needs you:`.
2. Take the revert PR through Ready and Merge with the same gates as the first one (`prepare`, `ci-ran.mjs`, `merge-gate.mjs`); a revert of a user-visible change touches the same UI files, so `revert-body.md` copies the merged PR's `deployment-verify:v1` contract block and its `ui-verify` spec block when it has them (the proof half asks a UI diff for the spec block), and a gate refusal is a `hold` with the `MERGE_GATE:` line, never a body edit.
   The proof half needs the revert's one criterion proven: write `.agent/revert-<n>/plan.md` with `## Acceptance Criteria` and `- [ ] AC-1 — The revert commit shall undo exactly the change <squash sha> made.`, run `diff <(git diff <squash sha> <squash sha>^) <(git diff <revert sha>^ <revert sha>)` on the revert branch (exit 0; it compares the two changes, so a later merge to the same files does not break it), and publish it with aw-verify's `verify-comment.mjs --checks '{"AC-1":{"command":"diff <(git diff <squash> <squash>^) <(git diff <revert>^ <revert>)","before":"n/a","after":"pass","evidence":"inverse diff identical"}}' --from-plan .agent/revert-<n>/plan.md --pr <revert PR url> --head <revert sha>`.
   Then run `pipeline.mjs` against the revert PR: green records `proceed`, reason `reverted <revert PR url>`; red ends the run as `failed`: once every merged lane PR is reverted, a pipeline that is still red failed for a reason the change did not cause.

```text
✗ fix PR red again → git revert on main and git push origin main
✓ fix PR red again, policies.rollback: auto → revert/<n> branch → revert PR → Ready → Merge → pipeline green → Deliver: reverted <url>
```

## Never automatic

These change shared release state and stay with the user, each as an exact command under `Needs you:`:

- creating, moving, or deleting a tag or a GitHub release
- a force push, or a push to the default branch
- re-running a release job that publishes artifacts (`gh workflow run`, `gh run rerun` on a release job)
- editing a secret, a protected-branch rule, or a workflow's permissions

```text
✗ pipeline red: "tag v1.108.0 already exists" → git tag -d / git push origin :refs/tags/v1.108.0 / re-run
✓ hold, reason "version job: tag exists"; Needs you: git -C <repo> tag -a v1.108.0 <sha> -m "Release v1.108.0" && git push origin v1.108.0
```

## Reporting

Record the result on the state comment: `state.mjs --record --stage deliver --decision <proceed|hold|failed|skipped> --head <merge sha> --reason "<r>"`, then `--upsert`, so the PR shows whether it was delivered.
It is display-only: `--next` never reads it, and it writes no telemetry span.

```text
✗ main red, revert PR merged, comment still reads "Merged. Delivering…"
✓ state.mjs --record --stage deliver --decision failed --head 4f1c2d9 --reason "main red after one fix; reverted by #202"
```

Write one `bus` event per decision ([`decision-log.md`](./decision-log.md)) and print the terminal contract's `- Deliver: [green <run url> | red: <reason> | fix PR <url> | revert PR <url> | reverted <revert PR url> | skipped: <reason> | not reached]` line.
A `hold` or `failed` result also goes under `Needs you:`.
Re-running `/atelier <merged-pr-url>` runs Deliver on the merge commit, which is how a session that died mid-wait resumes.
Skip Deliver, printing `skipped: <reason>`, when the merge was refused or held, when the PR has no merge commit, or when the user passes `--no-deliver`.
Record that skip on the comment only after a merge recorded `proceed` (`--no-deliver`, or no merge commit): `record()` refuses Deliver before a merge, and an unrecorded Deliver after a merge leaves the card on "Delivering…".
After a refused or held merge, record nothing for Deliver; the comment already shows the merge's own result.

```text
✗ merge refused → state.mjs --record --stage deliver --decision skipped   # exit 2: deliver needs a merge recorded proceed first
✓ merged, --no-deliver → state.mjs --record --stage deliver --decision skipped --head <merge sha> --reason "--no-deliver"
```
