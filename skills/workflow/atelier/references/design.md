---
title: Atelier design — why it only sequences, why the gate, why state lives in the PR, and what counts as ground truth
tags: [atelier, design, rationale]
---

# Atelier design

## Contents

- [Sequence, never re-implement](#sequence-never-re-implement)
- [The merge gate](#the-merge-gate)
- [Ready on real CI](#ready-on-real-ci)
- [Approval is the repo's choice](#approval-is-the-repos-choice)
- [Preflight](#preflight)
- [A skipped companion holds Build](#a-skipped-companion-holds-build)
- [State in the PR](#state-in-the-pr)
- [Ground truth](#ground-truth)
- [Out of scope](#out-of-scope)

## Sequence, never re-implement

`aw` builds and reviews, `prepare` resolves conflicts, CI, and threads and squash-merges, and `deployment-verify` rolls a flag out.
Atelier is the thread between them, so a fix to any stage lands in the skill that owns it and every caller gets it.
A second copy of any of that logic inside atelier would drift from the owner the first time the owner changed.
`aw` runs unchanged under atelier: atelier passes it the request plus a fixed suffix asking for a flag and a contract, and reads its `AW RUN COMPLETE` block and the sealed checks' sentinel.
A Build that ends on `unsatisfiable` checks alone proceeds, because only a human can satisfy them, and they ride to the final `Needs you:` line instead of being lost.

## The merge gate

A merged change that users can see reaches them on the next deploy, and the only cheap undo after that is a flag.
`deployment-verify` already defines the contract that names the flag and the signals that judge it; requiring that contract before the merge means every user-visible change atelier merges can be rolled out and rolled back by `/deployment-verify` without a redeploy.
A change no user can see (docs, internal tooling, tests) has nothing to roll out, so the gate lets it through without a contract.
The gate reuses `ui-verify`'s `is-ui-diff.mjs` and `deployment-verify`'s `parseContract()` by path instead of copying them: the classifier and the contract parser each have one owner, and the gate agrees with them by construction.
It is a script with a self-test because a merge is the one step atelier cannot take back.

The gate's question is "does a user-visible change ship behind a flag a human can turn off", not "can `/deployment-verify` step this flag".
A repo can declare `flags.providers: []` on purpose, when its flag evaluations are logs rather than span attributes and no cohort exists to compare.
Refusing there would block every user-visible change in that repo and send the author after a provider that does not exist, so a contract with `flag.key` and no matching provider passes with a warning, and the warning travels into the reason and the human's next step.
Every other contract defect `validateContract()` finds still refuses, and `cohort` is waived only there, because only a provider splits traffic on it.

The gate runs right after Build as well as before the merge.
A contract is the author's, so the cheapest place to fix a missing one is while `aw` still holds the branch; one fix round bounds the cost, and a second refusal is a human's call.
The early gate also asks for the verify report, because a report that was never written is otherwise found only at Ready, after the CI wait and `prepare`, and a run can spend hours reaching that refusal.
It asks for the report's shape, not `--proven`: the verdict belongs to the head Ready ends on, and `prepare` may still push to it.
The fix is one `aw-verify` run rather than a second `aw` round, since `aw-verify` is the only writer of the report.

## Ready on real CI

Atelier exists to merge, so Ready marks a draft ready for review before `prepare`: many repos skip most CI jobs on drafts, and a draft whose checks were skipped reads as green while proving nothing.
`--keep-draft` is for a caller that must not undraft; it trades the merge for a `hold` that says why.
"CI ran" is one rule in one script, `prepare`'s `ci-ran.mjs`, so `prepare` and atelier cannot disagree about it: a required check, or with none required a GitHub Actions check run, completed without being skipped.
An external status counts only when the repo marks it required, because preview deployers such as Vercel report success on drafts whose real CI was skipped, so "any check passed" certifies nothing.
The helper lives with `prepare` because `prepare` must stand alone; atelier calls it by path.
A Ready `proceed` stores the verdict it was based on, and the merge gate reads CI again at the head right before the merge, because a state comment is data anyone can edit and a comment written before the evidence existed must not be trusted on resume.

## Approval is the repo's choice

A passing merge gate is not a review.
Some repos block the merge on a required review that an automatic check gives, such as an auto-approval app or a policy check; that check is usually not a required status, so CI never waits for it, and a merge attempted right after the gate meets `REVIEW_REQUIRED`.
Atelier waits for it before merging and holds for a person when it does not approve, because the alternative is a bypass (`--admin`) or a run that ends at a hold the user must resume for a verdict that arrives in minutes.
Which check approves is the repo's fact, so it lives in `.agents/aw/merge.yml` (`approval.wait_for`, regexes on check names), with `--check` as a one-run override; atelier names no vendor, and a required review with nothing configured is a person's job at once, with no wait.
A check that passes is not the review: a bot can finish its check before its review lands, and the merge is refused until the review decision is `APPROVED`, so the wait ends only on that decision.
A named check that finished without approving (neutral, skipped, failed) ends the wait immediately: its verdict will not change, so waiting out `--max-wait` would only delay the hold.
An approval of an older head proves nothing about the one being merged, so the wait takes `--head` and ends as `moved` when the PR's head differs.
The wait lives in its own script, `approval-wait.mjs`, because its states (approved, manual, pending) differ from CI's (green, red, not-run); it shares the loop's shape with `ci-wait.mjs`, not its code.

## Preflight

A run that cannot prove a criterion should say so before it spends hours building, not in the last line after the merge.
The common gaps are a repo with no flag provider, so the rollout is a human flip; no telemetry config, so a `telemetry:` criterion cannot be graded; and workflows that skip drafts, so Ready must undraft and notify reviewers.
`preflight.mjs` reads only committed config, so its answer is reproducible and needs no network; whether an MCP tool answers depends on the session, so the agent checks that one call itself.
It reuses `deployment-verify`'s `loadConfig()` and YAML reader instead of parsing `release.yml` a second time, so a config the preflight calls healthy is one `/deployment-verify` loads.
A gap blocks only when a stated criterion depends on it, because most runs need only part of the suite, and a preflight that stopped on every missing file would teach users to pass `--accept-gaps` by reflex.
Its line rides in the state comment so a reviewer reading the PR sees what the run could not prove.

A gap a repo will always have (no flag system, no browser sign-in) is an answer, not missing setup, and repeating it on every run trains readers to skip the line.
`.agents/aw/preflight.yml` records that answer once, with a reason, in a committed file a reviewer can read; the line then names only new gaps, and an accepted one stays visible after them.
Accepting a gap never makes a criterion provable, so a stated criterion that needs it still blocks.

A repo with no workflow that runs on a PR reports no checks on any PR, so Ready's "CI ran green" can never hold and every run ends at a hold no one can clear.
`no checks reported` there is the truth about the repo, not a failure, so Ready and the merge gate accept it, and each checks the repo's workflows itself instead of trusting the agent's flag.
A repo that has CI and reports nothing is refused as before: a path filter or a broken trigger is exactly the case the CI half exists to catch.

## A skipped companion holds Build

`aw` names every companion it did not run in its `Degraded:` line, but a line in a long terminal block is easy to miss, and a nested sub-agent that runs short skips the review, `create-pr`, and the quality pass to save context.
Atelier merges, so a review that did not happen must stop the run where a human sees it: a Build `hold` with `skipped: <names>` shows on the state comment's status card and its `Needs you:` line.
The waiver is the user's alone (`--accept-skip`), recorded in the decision log, because an agent that could waive its own skipped review would learn to.
Running `/atelier` at the top level prevents most skips: the nested context is what runs short.

## State in the PR

The PR outlives the session, the worktree, and the machine that started the run.
A sticky comment marked `<!-- atelier:v1 -->` lets any later `/atelier <pr>` resume where the last one stopped, and shows a reviewer the same table the machine reads.
The comment leads with a pre-rendered status card because GitHub cannot draw an image per comment, and a fixed set of 27 states × 2 themes keeps every run's comment identical in shape; the table stays, collapsed, for the details.
The card follows the last recorded stage, not the furthest, because a re-run (Ready after a refused merge) leaves later entries behind; `record()` refuses a stage and decision pair with no card, and a Deliver before a merge.
Ready is re-run when the head moved because a pushed fix can turn CI red or open a thread; a green result on an older head says nothing about the new one.

The after-Build checklist runs before Build is recorded, so it cannot live in the comment: the card set has no state for "PR open, nothing recorded".
Its checkpoints go beside the telemetry ledger, keyed by the PR URL, so a resume on the same clone starts at the step that did not finish, and a run resumed with the PR URL no longer records Build `skipped` over a checklist that never ran.
The companions check stores aw's hand-back because the session that held it is gone; the sentinel and the early gate hold only for their head, because a push after them can break either.

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

## Delivery

A merge is not the end of the change: the default-branch pipeline versions, builds, and releases it, and it can fail where PR CI passed (a release job that runs only on `main`; a missing tag on a version step).
Deliver reads that run with a script (`pipeline.mjs`), treats a skipped required job as red, and starts one fix PR when the merged change caused the failure; when the fix is red too, it reverts through a PR, as `policies.rollback` allows (`pipeline.on_red: revert-first` swaps the order).
Tags, force pushes, and release re-runs stay with the user, because they change shared release state and a wrong one is hard to undo.
Once the pipeline is green, it verifies a change with no flag on the deploy itself (`verify-deploy.mjs` → `deployment-verify`'s `tick.mjs`): a green build says the release shipped, not that the service still works, and nobody else watches a change that has no flag to roll out.
That is why a repo with a hosted service needs a contract (or an explicit opt-out) on every PR before the merge: `--draft-contract` refuses a merged PR, so a contract cannot be added after the fact.
Deliver runs the controller in the background or as one scheduled tick, never as a foreground loop, so a clean deploy costs no model tokens; a flag contract stays with a human, because atelier never flips a flag, and an ESCALATE that asks a human to roll back goes to the same revert lane as a red pipeline.
It is a step, not a stage the machine resumes: its result is recorded on the PR state comment for display (`--stage deliver`), while `--next` and the run trace keep their three-stage shape.

## Out of scope

This skeleton records evidence and stops after the merge, its pipeline, and the verify of a no-flag deploy.
These later steps will read the decision log and are not built here:

- Earned autonomy: atelier flipping the flag itself once a repo's record of clean outcomes earns it.
- The policy for that, in a `promotion:` block of `.agents/aw/release.yml`.
- The decision, in a pure `promote.mjs` that takes the events and the policy and returns whether to flip.
