---
title: Merge gate — a user-visible diff merges only behind a deployment-verify flag contract
impact: HIGH
tags: [atelier, merge, gate, deployment-verify, ui]
---

# Merge gate

Run `node "${CLAUDE_SKILL_DIR}/scripts/merge-gate.mjs" --pr <n>` before the merge stage, on the current head; its exit code is the decision.
**Why:** [`../references/design.md` § The merge gate](../references/design.md#the-merge-gate).

| Diff | PR body | Exit | Decision |
| --- | --- | --- | --- |
| not user-visible (docs, tooling, tests) | anything | 0 | `pass` |
| user-visible | a valid `deployment-verify:v1` contract with `flag.key` | 0 | `pass` |
| user-visible | no contract, a contract that does not parse, one with no `flag`, or one `deployment-verify` would refuse | 1 | `refuse` |
| — | — | 2 | error: record `failed`, never merge |

1. **User-visible** is `ui-verify`'s `scripts/is-ui-diff.mjs` answer, run by path, with the `surface` from the repo's `.agents/aw/ui.yml` when it has one (the gate reads it; run the gate from the repo root or pass `--repo-dir`).
2. **The contract** is the block `deployment-verify` reads, parsed by its own `parseContract()` and checked by its own `validateContract()`, against `.agents/aw/release.yml` when it exists; its format is `deployment-verify`'s `rules/contract.md`.
3. On a refusal, print the gate's how-to lines verbatim under `Needs you:`.

```text
✗ src/components/Header.tsx changed, PR body has a contract with no "flag"   → merge
✓ MERGE_GATE: refuse — user-visible diff, the deployment-verify:v1 contract names no flag
```

```text
✗ docs/guide.md only, no contract → refuse
✓ MERGE_GATE: pass — not user-visible — no UI file in the diff
```
