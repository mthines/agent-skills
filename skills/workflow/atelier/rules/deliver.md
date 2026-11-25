---
title: Deliver — follow the merge into the default-branch pipeline and fix a red one once
impact: HIGH
tags: [atelier, deliver, pipeline, post-merge, ci, release]
---

# Deliver

A merged PR is not delivered until the pipeline GitHub starts for the merge commit on the default branch has gone green.
That pipeline builds, versions, and releases the change, and PR CI does not exercise all of it: a release job that only runs on `main` can fail on a PR that was green.
Deliver runs after the merge, reads that pipeline with `scripts/pipeline.mjs`, and starts one bounded fix when it is red.
**Why:** [`../references/design.md`](../references/design.md#delivery).

## Run

```bash
P="${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/pipeline.mjs"
node "$P" --pr <pr-url>               # PIPELINE: green|pending|red|none — <reason>
```

`--pr` resolves the merge commit and base branch from the merged PR; the config comes from `.agents/aw/release.yml` → `pipeline:` ([`deployment-verify` `rules/config.md`](../../../testing/deployment-verify/rules/config.md#pipeline)).
The wait is `pipeline.timeout_minutes` (default 20; `--wait <minutes>` overrides it), polled every 30 seconds; `none` right after a merge also waits, because GitHub registers the run a few seconds late.

| Exit | Line | Deliver decision |
| --- | --- | --- |
| 0 | `PIPELINE: green` | `proceed`, reason `pipeline green <run url>` |
| 3 | `PIPELINE: pending` after `--wait` | `hold`, reason = the line, `Needs you:` names the run to watch |
| 1 | `PIPELINE: none` | `hold`, reason `no pipeline run for <sha>`: the repo may not run one on merge; the user confirms |
| 1 | `PIPELINE: red — <workflow › job › step>` | start the [fix lane](#fix-lane) once |
| 2 | stderr | `failed`, reason = stderr; never fix on a read that errored |

A required job that is `skipped` counts as red: when the release job skips, the version step before it failed, and a green run hides that.
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
   Take that PR through Ready and Merge with the same gates as the first one (`prepare`, `ci-ran.mjs`, `merge-gate.mjs`); then run `pipeline.mjs` against the fix PR.
3. A second red result ends the run as `failed`, reason = the `PIPELINE:` line; there is no second fix round.

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

Deliver is not a stage in the state comment (`state.mjs` knows `build|ready|merge`, and recording another throws).
Write one `bus` event per decision ([`decision-log.md`](./decision-log.md)) and print the terminal contract's `- Deliver: [green <run url> | red: <reason> | fix PR <url> | skipped: <reason> | not reached]` line.
A `hold` or `failed` result also goes under `Needs you:`.
Re-running `/atelier <merged-pr-url>` runs Deliver on the merge commit, which is how a session that died mid-wait resumes.
Skip Deliver, printing `skipped: <reason>`, when the merge was refused or held, when the PR has no merge commit, or when the user passes `--no-deliver`.
