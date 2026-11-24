---
title: Merge gate — a user-visible diff merges only behind a deployment-verify flag contract
impact: HIGH
tags: [atelier, merge, gate, deployment-verify, ui]
---

# Merge gate

Run `node "${CLAUDE_SKILL_DIR:-$HOME/.claude/skills/atelier}/scripts/merge-gate.mjs" --pr <pr-url>` in the merge stage, on the current head, immediately before `prepare --merge`; its exit code is the decision.
After Build, run it with `--contract-only`: CI on a fresh draft has not run, so only the contract half is judged there.
**Why:** [`../references/design.md` § The merge gate](../references/design.md#the-merge-gate).

CI comes first: unless `--contract-only`, the gate reads the head's checks through `prepare`'s `scripts/ci-ran.mjs` and refuses (exit 1) on anything but `CI: green` — `not-run` (every required check, or with none required every GitHub Actions run, skipped or absent; external statuses never count), `pending`, or `red`.
A CI refusal is recorded on Ready, not Merge (`hold` for `not-run` or `pending`, `failed` for `red`), so the next run re-runs Ready and `prepare` instead of refusing at Merge again.
Offline (`--files … --body-file …`) it needs `--rollup-file <json>` (a saved response of `ci-ran.mjs`'s query) or `--contract-only`.

```text
✗ Ready proceed in the state comment → skip the CI read → prepare --merge on a head whose checks all skipped
✓ MERGE_GATE: refuse — CI not run at b56dfb5: every required check skipped (4)
```

With CI green, the diff and the body decide:

| Diff | PR body | Exit | Decision |
| --- | --- | --- | --- |
| not user-visible (docs, tooling, tests) | anything | 0 | `pass` |
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
✗ docs/guide.md only, no contract → refuse
✓ MERGE_GATE: pass — not user-visible — no UI file in the diff
```

```text
✗ release.yml has providers: [] → refuse, "add \"provider\": \"<release.yml provider>\""   # no provider exists to add
✓ MERGE_GATE: pass — user-visible, behind flag newHeader; deployment-verify cannot step this flag here: no provider; a human flips it
```
