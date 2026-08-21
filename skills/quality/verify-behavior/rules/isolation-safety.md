---
title: verify-behavior — isolation safety and the trust split
impact: HIGH
tags:
  - verify-behavior
  - isolation
  - safety
  - trust-split
---

# Isolation safety

Tier 3 executes real code.
That is powerful and dangerous in equal measure — these five constraints are non-negotiable whenever this skill runs a Tier 3 execution.

## The five safety constraints

1. **Throwaway worktree.** Tier 3 execution happens in a disposable `git worktree` (or an equivalently isolated scratch directory), never directly in the caller's working tree.
   A repro that crashes, hangs, or corrupts state does so in a container the caller can discard.
2. **Tracked files are never modified.** Whatever Tier 3 needs to write — a synthesized repro file, a scratch harness, a temp fixture — is written outside the set of files `git` already tracks on the branch, or in the throwaway worktree only.
   A Tier 3 run that leaves a diff on the caller's tracked files is a guard failure.
3. **Scratch is deleted after.** Any synthesized repro file or scratch harness created to decide a claim is deleted once the receipt is captured.
   Nothing intended as disposable persists past the run that needed it.
4. **No network by default.** Tier 3 execution runs with no network access unless the claim explicitly requires it (e.g. verifying an HTTP client's retry behavior against a local mock server the caller controls).
   Default-deny, not default-allow.
5. **Never `curl | sh`.** Never pipe a remotely-fetched script directly into a shell, regardless of how trusted the source looks.
   Download, read, then decide whether to run it — or don't run it at all.

```bash
# The throwaway-worktree pattern for a Tier 3 synthesized repro.
SCRATCH=$(mktemp -d)
git worktree add --detach "$SCRATCH" HEAD >/dev/null
trap 'git worktree remove --force "$SCRATCH" 2>/dev/null; rm -rf "$SCRATCH"' EXIT

# Write the minimal repro INSIDE the scratch worktree, never in the caller's tree.
cat > "$SCRATCH/verify_behavior_repro_test.go" <<'EOF'
// minimal repro — deleted on trap EXIT
EOF

( cd "$SCRATCH" && go test ./... -run TestVerifyBehaviorRepro )
```

## The relation-keyed trust split

Tier 3 executes real code, so who wrote that code matters.
The split is keyed on `review_relation`, the same discriminant `pr-reviewer` already uses:

| Tier | `self` (own branch / own code) | `cross` (someone else's PR) | `untrusted` |
| --- | --- | --- | --- |
| Tier 1 (syntactic) | Always available | Always available | Always available |
| Tier 2 (semantic-no-execution) | Always available | Always available — **safe for anyone**, it never executes the code under test | Always available |
| Tier 3 (execution) | **Default-on** | Opt-in only, behind an explicit sandbox | Opt-in only, behind an explicit sandbox |

- **`self` — default-on.** `aw-executor` verifying its own branch's change, or `pr-reviewer` in the `self` relation verifying its own PR, may run Tier 3 without an extra opt-in — the caller already has full write access to this code and is accountable for it.
- **`cross` / `untrusted` — opt-in behind a sandbox.** Executing someone else's code by default is a real risk (a malicious or merely buggy PR could do anything a test can do — read secrets, make network calls, spawn processes).
  Cross-review defaults to Tier 2 only; running Tier 3 against cross/untrusted code requires the caller to pass an explicit sandbox flag and accept that the execution happens with the same throwaway-worktree, no-network-by-default constraints above, in addition to whatever sandbox boundary the opt-in provides.

This is a **hard safety boundary, not a tuning knob** — a caller cannot raise the trust level for a single run by simply asking; the opt-in is a deliberate, logged decision, not a default a lesson or a confidence score can silently widen.

## What this rule does not do

- It does not decide which tier a claim needs — see [`ladder.md`](./ladder.md).
- It does not decide what "confirms" or "contradicts" means for the result — see [`receipt.md`](./receipt.md).
- It does not grant an exception for a "trusted-looking" cross PR — the split is keyed on `review_relation`, not on a judgment call about the PR's contents.
