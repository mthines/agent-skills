---
title: Merge gate — green CI, proven criteria, a flag contract for a user-visible diff, and a contract or opt-out for every diff to a hosted service
impact: HIGH
tags: [atelier, merge, gate, deployment-verify, ui]
---

# Merge gate

Run `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/merge-gate.mjs" --pr <pr-url>` in the merge stage, on the current head, immediately before `prepare --merge`; its exit code is the decision.
After Build, run it with `--early`: the contract half, and the proof half without `--proven` (the report must exist in its template shape), but no CI read, since CI on a fresh draft has not run.
A missing report is then caught while Build can still fix it, by one `aw-verify` run, instead of at Ready after CI and review.
`--contract-only` judges the contract half alone; only the decision log's `user_visible` fill uses it.
**Why:** [`../references/design.md` § The merge gate](../references/design.md#the-merge-gate).

Once the contract half passes, CI decides: unless `--early` or `--contract-only`, the gate reads the head's checks through `prepare`'s `scripts/ci-ran.mjs` and refuses (exit 1) on anything but `CI: green` — `not-run` (every required check, or with none required every GitHub Actions run, skipped or absent; an external status counts only when required), `pending`, or `red`.
One `not-run` passes: `no checks reported` in a repo whose `--repo-dir` has no workflow on pull_request, push, or merge_group (`preflight.mjs` `repoHasCi()`); the reason then ends `no CI in this repo`, and the JSON's `ci.no_ci` is `true`.
A repo that has such a workflow and reports no checks (a path filter, a broken trigger) is still refused.
Once CI is green, proof decides: unless `--contract-only`, the gate runs `aw-verify`'s own end-of-run gate (`checkReport()` and `provenProblems()` from `scripts/verify-comment.mjs`, what `verify-comment.mjs --pr <pr> --check --proven` prints) over the PR body and comments, with `--ui` when the diff is user-visible, and refuses on any problem: no `intent` region, a criterion still `⬜` or without a Proof cell, no `aggregate` in `report.md.template`'s shape, a UI diff with no `ui-verify` spec block, a criterion marked `❌`, or a `❌ Not verified` / `⛔ Blocked` verdict.
The JSON's `refused_by` names which half refused (`contract`, `ci`, or `proof`); a `pending` refusal is first waited out with `scripts/ci-wait.mjs` (SKILL.md, *Waiting for CI*) and the gate runs again once; every other `ci` refusal, and a wait that ends `pending`, is recorded on Ready, not Merge (`hold` for `not-run` or `pending`, `failed` for `red`), and so is a `proof` refusal (`failed`), so the next run re-runs Ready (`prepare`, then the proof step's `aw-verify`) instead of refusing at Merge again.
A passing gate is not an approval: the merge stage then runs `scripts/approval-wait.mjs` (SKILL.md, *Waiting for approval*) and merges only when the review the repo requires is given, by a person or by the automatic check `.agents/aw/merge.yml` names; otherwise it records Merge `hold` for a person.
Offline (`--files … --body-file …`) it needs `--rollup-file <json>` (a saved response of `ci-ran.mjs`'s query), `--early`, or `--contract-only`; the proof half reads the body file, plus `--comments-file <json array of bodies>` when the report is a comment.

```text
✗ Ready proceed in the state comment → skip the CI read → prepare --merge on a head whose checks all skipped
✓ MERGE_GATE: refuse — CI not run at b56dfb5: every required check skipped (4)
```

```text
✗ docs-only diff, CI green, no verify report → merge                 # nothing shows the criteria hold
✓ MERGE_GATE: refuse — no proof the criteria hold: no intent region: publish the criteria (intent.md § Step 6) (+1 more)
```

## Contract half

The diff, the body, and the repo decide the contract half.
A repo is **hosted** when `.agents/aw/release.yml` loads a `production` environment whose `deploy.detect` is set and is not `manual`: there is a deployed service `deployment-verify` can watch, and Deliver [verifies](./deliver.md#verify) every no-flag change on it.

| Diff | PR body | Exit | Decision |
| --- | --- | --- | --- |
| not user-visible (docs, tooling, tests), repo not hosted (`detect: manual`, no `release.yml`) | anything | 0 | `pass` |
| not user-visible, hosted | a valid `deployment-verify:v1` contract, with a `flag` or without one (measured before/after the deploy) | 0 | `pass` |
| not user-visible, hosted | no contract and `<!-- deployment-verify:none — <reason> -->` with a non-empty reason | 0 | `pass`, the reason quoted |
| not user-visible, hosted | neither, an opt-out with no reason, or a contract `deployment-verify` would refuse | 1 | `refuse`, naming both fixes |
| user-visible | a valid `deployment-verify:v1` contract with `flag.key` whose `flag.provider` `release.yml` declares | 0 | `pass` |
| user-visible | a contract with `flag.key` and no provider to step it (no `release.yml`, `providers: []`, or no `flag.provider`) | 0 | `pass` + `warning: deployment-verify cannot step this flag here: no provider; a human flips it` |
| user-visible | no contract, a contract that does not parse, one with no `flag`, a `flag.provider` that a non-empty `providers` list lacks (a typo), or any other `deployment-verify` refusal | 1 | `refuse` |
| — | — | 2 | error: record `failed`, never merge |

1. **User-visible** is `ui-verify`'s `scripts/is-ui-diff.mjs` answer, run by path, with the `surface` from the repo's `.agents/aw/ui.yml` when it has one (the gate reads it; run the gate from the repo root or pass `--repo-dir`).
2. **The contract** is the block `deployment-verify` reads, parsed by its own `parseContract()` and checked by its own `validateContract()`, against `.agents/aw/release.yml` when it exists; its format is `deployment-verify`'s `rules/contract.md`.
   With no matching provider, `cohort` is not required: only a provider splits traffic on it.
3. On a refusal, print the gate's how-to lines verbatim under `Needs you:`; they name a provider only when `release.yml` declares one.
4. On a pass with a `warning:`, carry the warning into the stage reason and the Step 4 `Needs you:` line.

```text
✗ src/components/Header.tsx changed, PR body has a contract with no "flag"   → merge
✓ MERGE_GATE: refuse — user-visible diff, the deployment-verify:v1 contract names no flag
```

```text
✗ docs/guide.md only, no contract, repo not hosted → refuse
✓ MERGE_GATE: pass — not user-visible — no UI file in the diff
```

The opt-out is the author's word that nothing deployed can change: docs, CI config, a skill file. It never passes a user-visible diff, which still needs a flag.

```text
✗ hosted repo, worker change, no contract → merge          # Deliver has nothing to verify the deploy against
✓ MERGE_GATE: refuse — hosted production service, neither a deployment-verify:v1 contract nor a deployment-verify:none marker in the PR body
✓ hosted repo, README only, <!-- deployment-verify:none — docs only, nothing deploys --> → MERGE_GATE: pass — deploys nothing to verify: docs only, nothing deploys
✗ <!-- deployment-verify:none — -->                          # refuse: an opt-out says why
```

```text
✗ release.yml has providers: [] → refuse, "add \"provider\": \"<release.yml provider>\""   # no provider exists to add
✓ MERGE_GATE: pass — user-visible, behind flag newHeader; deployment-verify cannot step this flag here: no provider; a human flips it
```
