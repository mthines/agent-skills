# Pre-push branch convergence (`create-pr` Step 5.5)

Full procedure for the step `SKILL.md` routes to.
The branch is still local at Step 5.5, so there is no PR and no review thread — which is exactly the
gap [`review-branch`](../../../quality/review-branch/SKILL.md) fills.
It dispatches `branch-reviewer`, which runs the same detection core as `pr-reviewer` (same impact
graph, same finders, same verifier, same confidence and severity gates) and carries findings in
`.agent/{branch}/findings.jsonl` instead of GitHub threads.
Zero GitHub calls, no PR required.

## When it runs

Run this step when either holds:

- `--pre-review` is in `$ARGUMENTS`; or
- `--split` is in `$ARGUMENTS` (default-on there).

Skip it when any of these hold, and record which:

- `--no-pre-review` or `--no-quality` is in `$ARGUMENTS`.
- Neither trigger above fired — the plain default-mode run.
- `--no-review` is in `$ARGUMENTS`.
  That flag means "no reviewer pass", and this step is a reviewer pass.
- The branch diff is non-code only (docs, generated artefacts, lockfiles, asset binaries) — the same exclusion Step 6.5 applies.

## Why it is opt-in in default mode

Step 6.5 already reviews the same diff with the same detection core once the draft PR exists, so
running both is two full review passes for one change.
Whether the pre-push pass pays for itself — fewer post-draft iterations, fewer force-pushes, less PR
noise — is a claim about cost this repo has not measured, and shipping it default-on would bill
every PR for an unproven trade.

In split mode there is no such duplication: Step 6.5 is post-draft and split mode never reaches it,
so nothing reviews the whole branch otherwise.
That slot previously ran `Skill("polish", "simplify")` — mechanical refactors and **no review at
all**, because no reviewer could run without a PR.
That is now the *fallback*, taken only on `--no-pre-review` or an absent-dispatch skip.

## How to invoke it

Both invocations run at the **top level** of the session, never inside a sub-agent.
`review-branch`'s first sub-step is a delegation, so dispatching the loop itself into a sub-agent
leaves it nothing to review with — its own caller contract, the same one `review-loop` states.

| Mode | Invoke | Cap rationale |
| --- | --- | --- |
| default (`--pre-review`) | `Skill("review-branch", "--cap 3")` | Step 6.5's `review-loop` still runs after the push with its own cap of 5. This pass exists to make that one cheap, not to replace it. |
| split (`--split`) | `Skill("review-branch", "")` | Nothing reviews the whole branch after this. Take the full default cap of 5. |

Pass `--no-simplify` through if the user passed it to `create-pr`, and `--effort high` if they passed
`--critical`.
Pass nothing else: `review-branch` owns its own grammar.

## Acting on what comes back

| Return | Do |
| --- | --- |
| **Converged** | Continue to Step 6. The pushed branch is already review-clean, so Step 6.5 should find little; that is the point, not a reason to skip it. |
| **`flagged` findings** | Surface every one to the user **before** pushing. They are the reason a human is still needed, and a run that pushes past them silently has converted the safety valve into a green-wash. Continue only after surfacing. |
| **Skipped (sub-agent dispatch unavailable)** | The branch has **not** been reviewed here. One absent-dispatch return is conclusive; never retry. In split mode, fall back to `Skill("polish", "simplify")` on the full branch. In default mode just continue — Step 6.5 is the reviewer of record there. |
| **`checks-red`** | The repo's own fast checks are failing on your branch. Fix that before pushing; opening a PR on a locally-red branch spends a CI run to learn what you already knew. |

## Record the outcome before continuing

Step 10 has a mandatory slot for it, for the same reason Step 6.4 does — a degraded path that
reports as a legitimate outcome is never fixed.
Write down exactly one value as you leave this step:

| What happened here | Record |
| --- | --- |
| Ran, every finding applied or declined | `converged (<N> iterations, <A> applied, <D> declined)` |
| Ran, findings the loop could not honestly resolve | `flagged (<G> findings — listed below)` |
| Ran, hit the cap with findings open | `cap-reached (<O> open)` |
| Ran, local fast checks red at exit | `checks-red (<failing checks>)` |
| Not triggered (plain default-mode run) | `not run (default mode — pass --pre-review)` |
| Skipped: `--no-pre-review` / `--no-quality` / `--no-review` | `skipped (<the flag>)` |
| Skipped: non-code diff | `skipped (non-code diff)` |
| Dispatch unavailable | `NOT REVIEWED (sub-agent dispatch unavailable)` + which fallback ran |

The last row must never be softened into a skip.
In split mode it is the difference between sub-PRs that were reviewed and sub-PRs that were only
simplified.
