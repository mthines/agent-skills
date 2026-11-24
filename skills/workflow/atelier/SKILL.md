---
name: atelier
description: >
  Takes one change from request to merged PR by sequencing existing skills —
  aw builds the draft PR, prepare gets it green, a deterministic gate allows
  the squash-merge only when a user-visible diff ships behind a
  deployment-verify flag contract — then stops and says what a human does
  next. Resumable from a sticky PR comment; invoke with /atelier.
argument-hint: '<request> | <pr-url|#n>'
license: MIT
disable-model-invocation: true
metadata:
  author: mthines
  version: '0.1.0'
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

## Step 0 — Setup

1. Resolve the GitHub path per `agents/shared/rules/github-access.md` in this repo and bind `ACCESS_PATH`.
   The scripts' `--pr`, `--fetch`, and `--upsert` modes need `gh`; on the `mcp` path read the PR and comments with the MCP tools, then pass files and bodies to the scripts' offline flags.
   `none` → print the terminal contract with `Needs you: GitHub access` and stop.
2. Probe LoreKit: `memory.*` tools present and one call answers.
   Absent or failing → one line `Degraded: lorekit unreachable — decision log and outcomes skipped`, and every LoreKit step below is a no-op; no stage waits on it.
3. Run the outcome sweep in [`rules/decision-log.md` § Outcomes](./rules/decision-log.md#outcomes) once, before any stage.
4. With a PR: read its state (`node "${CLAUDE_SKILL_DIR}/scripts/state.mjs" --fetch --pr <n> > state.md`) and its head (`gh pr view <n> --json headRefOid -q .headRefOid`), then `node "${CLAUDE_SKILL_DIR}/scripts/state.mjs" --next --head <sha> --body-file state.md` names the stage to run.
   With a request: the stage is `build`.

## Stages

Run the stage `--next` named, then the ones after it, in order.
After **every** stage decision, do both, in this order:

1. Record it: `node "${CLAUDE_SKILL_DIR}/scripts/state.mjs" --record --stage <s> --decision <d> --head <sha> --reason "<r>" --pr <url> --body-file state.md > next.md && node "${CLAUDE_SKILL_DIR}/scripts/state.mjs" --upsert --pr <n> --body-file next.md && mv next.md state.md` ([`rules/state.md`](./rules/state.md)).
2. Write one `bus` event ([`rules/decision-log.md`](./rules/decision-log.md)).

A decision of `refuse`, `hold`, or `failed` ends the run at Step 4.

| Stage | Delegation | `proceed` when | Otherwise |
| --- | --- | --- | --- |
| **build** | `Skill("aw", "<request>")` | it printed a draft PR URL; bind `PR` and its head sha | `failed`, reason = aw's `Needs you:` line |
| **ready** | `Skill("prepare", "<pr-url> --single")` | it printed `Already green` or fixed every PR it touched | `failed`, reason = prepare's blocker line |
| **merge** | gate first: `node "${CLAUDE_SKILL_DIR}/scripts/merge-gate.mjs" --pr <n>`; exit 0 → `Skill("prepare", "<pr-url> --merge --single")` | the PR state is `MERGED`; reason = `merged <squash sha>` | gate exit 1 → `refuse`, reason = the `MERGE_GATE:` line; prepare blocked → `hold`, reason = its line |

- Ready records the head it ran on; re-read the head before the gate, and a head that moved since Ready runs Ready again (`--next` returns `ready`).
- `--single` keeps atelier to its one PR; prepare's stack walk would merge PRs atelier never built.
- Never run the merge with a gate that exited 1 or 2, and never edit the PR body to make the gate pass: the contract is the author's ([`rules/merge-gate.md`](./rules/merge-gate.md)).

```text
✗ MERGE_GATE: refuse — … → add a placeholder flag to the contract, re-run the gate, merge
✓ MERGE_GATE: refuse — … → record refuse, print the gate's how-to under Needs you:, stop
```

## Step 4 — Stop

Atelier never flips a flag and never runs `deployment-verify`.
After a merge, put the next human step under `Needs you:`:

| The merged PR | `Needs you:` |
| --- | --- |
| has a contract with a flag | `flip <flag> on per release.yml, or run /deployment-verify <pr> to roll it out` |
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
