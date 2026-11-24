---
title: Atelier design — why it only sequences, why the gate, why state lives in the PR, and what counts as ground truth
tags: [atelier, design, rationale]
---

# Atelier design

## Contents

- [Sequence, never re-implement](#sequence-never-re-implement)
- [The merge gate](#the-merge-gate)
- [State in the PR](#state-in-the-pr)
- [Ground truth](#ground-truth)
- [Out of scope](#out-of-scope)

## Sequence, never re-implement

`aw` builds and reviews, `prepare` resolves conflicts, CI, and threads and squash-merges, and `deployment-verify` rolls a flag out.
Atelier is the thread between them, so a fix to any stage lands in the skill that owns it and every caller gets it.
A second copy of any of that logic inside atelier would drift from the owner the first time the owner changed.
`aw` runs unchanged under atelier: atelier passes it the request and reads its printed PR URL.

## The merge gate

A merged change that users can see reaches them on the next deploy, and the only cheap undo after that is a flag.
`deployment-verify` already defines the contract that names the flag and the signals that judge it; requiring that contract before the merge means every user-visible change atelier merges can be rolled out and rolled back by `/deployment-verify` without a redeploy.
A change no user can see (docs, internal tooling, tests) has nothing to roll out, so the gate lets it through without a contract.
The gate reuses `ui-verify`'s `is-ui-diff.mjs` and `deployment-verify`'s `parseContract()` by path instead of copying them: the classifier and the contract parser each have one owner, and the gate agrees with them by construction.
It is a script with a self-test because a merge is the one step atelier cannot take back.

## State in the PR

The PR outlives the session, the worktree, and the machine that started the run.
A sticky comment marked `<!-- atelier:v1 -->` lets any later `/atelier <pr>` resume where the last one stopped, and shows a reviewer the same table the machine reads.
Ready is re-run when the head moved because a pushed fix can turn CI red or open a thread; a green result on an older head says nothing about the new one.

## Ground truth

Later steps will use the decision log to decide how much autonomy atelier earns, so only outcomes no agent can talk itself into count:

1. A human decision: a merge, a revert, a flag flip, or a refusal overridden by editing the PR.
2. A `deployment-verify` verdict from `decide.mjs` (`PASS`, `HOLD`, `ROLLBACK`).
3. A revert or hotfix of the merged change on the base branch, found by `outcomes.mjs`.

The agent's own confidence, its review verdicts, and its `proceed` decisions are never outcomes; they are the claims the outcomes grade.
A model that scored its own work would learn to score high, not to ship safely.
A `fix` commit on the same files within the window is a weak signal (it may fix a neighbour), so outcome events carry the evidence commits for a later reader to weigh, and atelier itself acts on none of them.

The decision log is `bus` kind with a 90-day TTL, longer than the 30-day `review-outcomes` bus, because an outcome only becomes final 14 days after its merge and a policy needs several merges per repo.
It is scoped `branch::{owner}/{repo}::{head-branch}`, like `pr-review-state`, so per-PR rows never crowd the lessons a `repo::` read injects; readers list it across scopes by `kind: bus` and `host: atelier`.

## Out of scope

This skeleton records evidence and stops after the merge.
These later steps will read the decision log and are not built here:

- Earned autonomy: atelier flipping the flag itself once a repo's record of clean outcomes earns it.
- The policy for that, in a `promotion:` block of `.agents/aw/release.yml`.
- The decision, in a pure `promote.mjs` that takes the events and the policy and returns whether to flip.
