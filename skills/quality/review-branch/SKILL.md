---
name: review-branch
description: >
  Converges a LOCAL branch with no pull request through a bounded
  review-apply-simplify loop. Dispatches the branch-reviewer agent, which runs
  the same impact graph, finders, verifier, and confidence/severity gates as
  pr-reviewer, but carries findings in a local findings.jsonl instead of GitHub
  review threads — so a run makes zero GitHub API calls, posts nothing, and
  works on an un-pushed branch or offline. Stops when every finding is applied
  or honestly declined AND the repo's own fast checks are green; a finding it
  can neither fix nor honestly decline stays flagged and visible, never quietly
  resolved. Use it to iterate before opening a PR, or when the comment round
  trip on your own PR is pure overhead. Once a PR exists use /review-loop
  instead — threads are the right bus when other people read them. Invoke with
  /review-branch [--base <ref>] [--cap N] [--effort high] [--no-simplify]
  [--no-checks] [--report] [--include-untracked].
disable-model-invocation: false
argument-hint: '[--base <ref>] [--head <ref>] [--cap N] [--effort high] [--no-simplify] [--no-checks] [--report] [--include-untracked]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: command
  tags:
    - review
    - code-quality
    - convergence
    - local
    - pre-pr
    - orchestrator
---

# review-branch — local convergence, no PR required

Drive a branch to a clean state by iterating **review → apply → simplify → re-review**, with every
finding carried in a local file instead of a GitHub review thread.

This is [`review-loop`](../review-loop/SKILL.md) with the GitHub round trip removed. The findings
are the same findings — the [`branch-reviewer`](../../../agents/branch-reviewer.md) agent runs the
same detection core `pr-reviewer` does, by reference rather than by copy — but nothing is posted,
nothing is fetched, and the loop's state lives in
[`.agent/{branch}/findings.jsonl`](./rules/findings-bus.md).

**When to use which:**

| | `review-branch` | [`review-loop`](../review-loop/SKILL.md) |
| --- | --- | --- |
| Needs a PR | no | yes |
| Bus | local `findings.jsonl` | GitHub review threads |
| GitHub calls | **zero** | many |
| Green gate | the repo's own fast checks | CI |
| Right when | iterating on your own work, pre-PR, offline | a PR exists and other people read the threads |

The thread is not overhead once someone else is reading it — it is the record, and it is how a human
reviewer sees what the agent already handled. Reach for `review-loop` the moment a PR exists.

## Modes

| Flag | Effect |
| --- | --- |
| `--base <ref>` | Base of the comparison. Default: upstream → `origin/HEAD` → `main`, and the loop announces which rung answered. |
| `--head <ref>` | Head of the comparison. Default: **the working tree**, so uncommitted work is reviewed. |
| `--cap N` | Iteration cap. Default 5. |
| `--effort high` | Forces the `deep` tier and raises diversify-then-vote from 3 finders to 5. |
| `--no-simplify` | Skip sub-step C (`polish simplify`). |
| `--no-checks` | Skip sub-step D. Convergence then means findings-clean only, and the report says so. |
| `--report` | Report-only. Forces `CAP=1`, skips B/C/D, applies nothing. The local counterpart of `review-loop`'s `--no-feedback`. |
| `--include-untracked` | Treat untracked, non-ignored files as added. Off by default. |

## Dispatch mechanics

`branch-reviewer` is an **agent**. Dispatch it with the harness's sub-agent dispatch tool; never
`Skill("branch-reviewer", …)`, which errors with `Unknown skill`.

**The check is a capability, never a tool name.** `Task` is the Claude Code CLI's spelling and
`Agent` is the Claude Agent SDK's; a tool taking a `subagent_type` (or equivalent) parameter is the
capability whatever it is called.

```text
# WRONG — a name check. Skips the review on every harness that spells it `Agent`.
if "Task" not in available_tools: skip

# RIGHT — a capability check, name-agnostic.
if no available tool dispatches a sub-agent (Task, Agent, or another spelling): skip
```

**Absent dispatch is a skip, not a fallback.** Reviewing in this context would be a self-review
wearing a reviewer's label — the same reasoning [`pr-review`](../pr-review/SKILL.md) applies. Report
it and stop:

```markdown
- [TIMESTAMP] review-branch — skipped (sub-agent dispatch unavailable; branch-reviewer requires it)
```

One absent-dispatch return is **conclusive**; never retry. And this loop, like `review-loop`, must
run at the **top level** — its first sub-step is a delegation, so dispatching the loop itself into a
sub-agent spends the budget one rung too high and leaves it nothing to review with. There is no
`--external-review` counterpart here: an out-of-process reviewer would have nowhere to publish to.

## Procedure

### Step 0 — resolve the range and preconditions

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
BASE=${BASE_FLAG:-$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null \
      || git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null \
      || echo main)}
BUS=".agent/${BRANCH}/findings.jsonl"
mkdir -p "$(dirname "$BUS")"
```

Abort before any work if the range is empty — `git diff --quiet "$BASE"` — with
`review-branch: no changes against <base>.` **An empty range is never a pass**; reporting one as a
converged branch is the local spelling of green-washing.

Do **not** create the bus file yet. Its absence is how iteration 1 knows `FINDING_OVERLAP` is 0.

### Step 1 — the loop

```text
ITERATION = 0
APPLIED = DECLINED = FLAGGED = 0
CHECKS  = "unread"
STOP_REASON = "cap-reached"    # only correct if the WHILE CONDITION ends the loop;
                               # every break below overwrites it. Never re-derive a
                               # stop reason from the iteration count — a report-only
                               # run and a last-iteration convergence look identical.

while ITERATION < CAP:
    ITERATION += 1

    # A — review. Always first, so a pass validates the previous iteration's fixes
    #     before anything else touches the tree.
    <dispatch>(subagent_type="branch-reviewer",
               prompt="--base $BASE --out $BUS <flags>")
    # The FULL range every iteration, never narrowed to "since the last pass".
    # That is what lets this pass validate the previous one's fixes, and the bus —
    # keyed by fingerprint, not by line — is what keeps the re-review from
    # re-reporting what it already saw. A narrowed range would do the opposite:
    # hide a regression the last iteration's fix introduced outside the new delta.
    NEW = findings raised this pass that are not already in the bus

    if REPORT_ONLY:
        STOP_REASON = "report-only"; break

    if NEW == 0 and open_findings(BUS) == 0 and checks_are_green():
        STOP_REASON = "converged"; break

    open_before = open_findings(BUS)

    # B — apply. In-context, one commit per finding, highest severity first.
    #     Each finding leaves `open` through a fix OR a written rationale.
    apply_findings(BUS)          # → appends `applied` / `declined` / `flagged`

    # C — simplify
    if not NO_SIMPLIFY:
        Skill("polish", "simplify")

    # D — the local green gate
    if not NO_CHECKS:
        CHECKS = run_fast_checks()        # green | red | none
        if CHECKS == "red":
            fix the regression this loop just introduced, then re-run once
            if still red: STOP_REASON = "checks-red"; break

    if APPLIED_THIS_ITER == 0 and DECLINED_THIS_ITER == 0
       and open_findings(BUS) >= open_before:
        STOP_REASON = "no-progress"; break
```

### Sub-step B — apply, in this context

Unlike `review-loop`, the apply runs **here**, not in a worker sub-agent. There is no bus to hand a
worker and no thread for it to resolve, and the round trip buys nothing once the findings are
already on disk.

That is safe in a way the *review* is not: applying a finding is not judging it. The judgment
already happened in an isolated context, and its verdict, score, and severity are in the bus and
[reviewer-immutable](./rules/findings-bus.md#the-record).

Work highest severity first. Per finding:

1. Read the finding's `path:line` and its `evidence[]` **in the code**, not from the record.
2. Apply the smallest change that addresses the claim. Never widen it.
3. Commit it alone, so a bad fix reverts without taking a good one with it.
4. Append the new state — `applied`, `declined` with a `note`, or `flagged` — per
   [`findings-bus.md`](./rules/findings-bus.md#the-lifecycle).

**A finding you disagree with is `declined` with a rationale, never deleted.** A finding that is real
and out of scope is `flagged`, never declined. If you cannot write an honest rationale, that is the
signal you should be flagging it.

### Sub-step D — the local green gate

CI's local analogue. Run the repo's own fast checks — the ones a contributor runs before pushing —
discovered in this order, first hit wins:

1. A `check` / `verify` / `precommit` script in `package.json`, `Makefile`, `justfile`, or `Taskfile`.
2. The lint + typecheck + test targets the repo documents in `CLAUDE.md` / `AGENTS.md` / `README.md`.
3. Nothing found ⇒ `CHECKS = "none"`, which counts as green for convergence **and is reported as
   `none` rather than `green`** — a loop that ran no checks must not claim a clean build.

Scope them to the touched packages where the repo supports it; run them unscoped at least once
before the loop exits, because a scoped pass cannot see a consumer the edit broke elsewhere. That is
the same lesson [`implement-suggestion`](../../workflow/implement-suggestion/SKILL.md)'s Phase 6
pre-push gate encodes.

**Red checks are this loop's own mess to clean.** There is no `ci-auto-fix` handoff here: nothing
was pushed, so a red check is a regression this loop just wrote. Fix it, or revert the commit that
caused it. Never weaken a check, skip a test, or push past it — every
[`ci-auto-fix` anti-pattern](../../delivery/ci-auto-fix/rules/anti-patterns.md) holds.

### Step 2 — report

```text
review-branch on <branch> (<base>..<head>)

Iterations: <N> of <CAP>
Stop reason: <converged | no-progress (flags remain) | cap-reached | checks-red
              | report-only (--report) | skipped (sub-agent dispatch unavailable)>
Review: branch-reviewer, tier <deep|standard|quick>, intent <checked vs plan.md | not run>

Per-iteration:
  1: <F found>, <A applied>, <D declined>, <S simplify recipes>, <O still open>
  2: ...

Findings: <A> applied · <D> declined · <G> flagged · <K> deferred
Flagged (needs you):
  - <path:line> — <title> — <why the loop could not resolve it>

Checks at exit: <green | red (<failing>) | none found | skipped (--no-checks)>
Bus: .agent/<branch>/findings.jsonl
Head: <sha>
```

Report the `STOP_REASON` the loop set. Never infer it from the iteration count — `1 of 1` is what
report-only, a first-iteration convergence, and a `--cap 1` run all look like from outside.

**Surface every `flagged` finding prominently.** They are the reason a human is still needed, and a
run that buries them has converted the safety valve back into a green-wash.

## Hard rules

- **Zero GitHub calls.** Not `gh`, not `mcp__github__*`, in this skill or the agent it dispatches.
  That promise is the whole point; a run that quietly reaches for `gh` is a `review-loop` run with a
  misleading name.
- **The review is dispatched; the apply is not.** Reviewing in this context is a self-review wearing
  a reviewer's label. Applying in this context is fine — the judgment already happened elsewhere.
- **The dispatch precondition tests a capability, never the literal name `Task`.**
- **Absent dispatch is a skip, never an in-context review**, and one such return is conclusive.
- **Never green-wash.** A finding leaves `open` only via a fix that landed or a rationale that was
  written. Never by deletion, never at the cap, never to reach zero.
- **`flagged` is reported, always.** Converging with flags is an honest outcome; hiding them is not.
- **An empty diff is not a pass.** Report *no changes* and exit.
- **Never rewrite the bus.** Append; the last record for an `fp` is its state
  ([`findings-bus.md`](./rules/findings-bus.md#append-only-and-why)).
- **Never edit a reviewer-written field.** Claim, score, severity, and verdict are immutable to this
  loop — the same discipline `checks.yaml` applies to the executor.
- **Only `Skill("polish", "simplify")`.** Any other `polish` mode dispatches a reviewer pass and
  creates a cycle — the same anti-circularity guarantee `review-loop` holds.
- **Cap is a hard limit.** Surface what is open and stop; never extend it silently.
- **Hand off at the PR boundary.** Once a PR exists, `review-loop` owns convergence. Do not re-run
  this loop against a branch whose PR is open and being read.

## Relationship to other skills

| Skill | Relationship |
| --- | --- |
| [`branch-reviewer`](../../../agents/branch-reviewer.md) | Sub-step A — the PR-less reviewer, dispatched per iteration. Composes the detection core by reference. |
| [`review-loop`](../review-loop/SKILL.md) | **Sibling, never nested.** Same loop shape over a different bus. This one runs pre-PR; that one runs once a PR exists. |
| [`polish`](../polish/SKILL.md) | Sub-step C (`simplify` only). `polish`'s own review pass needs a PR; this loop is what makes a pre-PR review possible at all. |
| [`create-pr`](../../delivery/create-pr/SKILL.md) | **Caller**, at its pre-push Step 5.5 — opt-in via `--pre-review` in default mode, default-on under `--split`, where its post-draft `review-loop` cannot run at all and the slot otherwise gets `polish simplify` with no review. Converge here, then open the PR with less left for the post-draft loop to find. |
| [`pr-review`](../pr-review/SKILL.md) | The one-shot read-only counterpart, for a PR. `--report` is this skill's equivalent for a branch. |
| [`findings-bus.md`](./rules/findings-bus.md) | Owns the record, the lifecycle, and the convergence predicate. Read it; never restate it. |
