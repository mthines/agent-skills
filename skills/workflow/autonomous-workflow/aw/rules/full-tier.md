---
title: 'Full tier — short brief, work here against checks, fresh-eyes review'
impact: HIGH
tags:
  - aw
  - full-tier
  - dispatch
---

# Full tier

Read when the tier is Full. This file and `corrections.md` (autonomous-workflow `rules/`) are the whole Full procedure: do not load the `autonomous-workflow` skill or the executor template on top of them.
You write a short brief, then do the work yourself in this session, iterating against the sealed checks until they pass; a context that did not write the code reviews it before the PR.
The brief says what done looks like and what must not change — never how to build it.
**Why:** [`../references/dispatcher-rationale.md`](../references/dispatcher-rationale.md#full-tier-short-brief-work-in-session-review-after).

## Contents

- [Step 1 — Brief (minutes)](#step-1--brief-minutes)
- [Step 2 — Work here until the checks pass](#step-2--work-here-until-the-checks-pass)
- [Step 3 — Fresh-eyes review](#step-3--fresh-eyes-review)
- [Step 4 — UI spec, walkthrough, PR, evidence](#step-4--ui-spec-walkthrough-pr-evidence)
- [Shared machines](#shared-machines)
- [When sub-agent dispatch is unavailable](#when-sub-agent-dispatch-is-unavailable)

## Step 1 — Brief (minutes)

1. **Phase 0, short.** Restate the request in 3–5 lines; ask only a `blocking` question (missing information that changes what done means). `--no-confirm` proceeds without waiting. Run `Skill("interview")` only with `--interview` or when two or more `blocking` questions remain.
2. **Worktree.** Create it with the repo's worktree tool (`gw checkout <branch>` when `gw` exists, else `git worktree add`); never work on the default branch.
3. **Read `corrections.md` (autonomous-workflow `rules/`)** in full — C1 shapes the brief; the rest shape the work.
4. **Read only what the brief needs:** the ticket, the repo's `CLAUDE.md`, and enough code to name the test commands and the likely starting files — at most 10 tool calls, no sub-agents, no design.
5. **Write the brief and checks:** `Skill("aw-create-plan")`. Requirements come from the user and the ticket; Guardrails come from the user, the ticket, and the repo's docs — never from a design you guessed.
6. **Validate deterministically:**

   ```bash
   D=".agent/$(git branch --show-current)"
   grep -cE '^## (Task|Requirements|Guardrails|Acceptance Criteria|Turn Cap|File Changes)' "$D/plan.md"   # 6
   grep -cE '^- \[ \] AC-[0-9]+' "$D/plan.md"; grep -c '^- id: AC-' "$D/checks.yaml"                    # equal
   test -f "$D/checks.lock" && echo sealed
   wc -l < "$D/plan.md"                                                                                   # ≤ 60
   ```

   Every `[user-stated]` requirement is covered by an AC, no `run:` holds an unfilled placeholder, and no Guardrail forbids something a requirement or AC needs.
7. **Print the brief and the goal line,** then start working:

   ```text
   /goal run-checks prints "CHECKS <M>/<M> PASS", the Before-PR command prints "exit=0", the review findings are printed as fixed or rejected, and the draft PR URL is printed — or stop after <turn_cap> turns or when a line starting "BLOCKED:" is printed.
   ```

   `<M>` is the number of checks. A user constraint that forbids the PR replaces the PR clause with `a line starting "PR: none —" is printed`. Follow it with: `Paste this line to let the session drive itself to done hands-off; the run continues normally if you do not.`

```text
✗ Wrong — a 160-line plan with edge cases, an approach, and "Keep markSessionExpired unchanged":
  a guessed design turned into a hard limit, and the worker followed it into a defect
✓ Right — Task, stated Requirements, sourced Guardrails, outcome ACs with sealed checks, Turn Cap,
  starting files; then start working
```

## Step 2 — Work here until the checks pass

Iterate: change, run the brief's After-editing command, run the checks, fix, repeat.

```bash
AW_SKILL_DIR="${AW_SKILL_DIR:-$HOME/.claude/skills/autonomous-workflow}"
D=".agent/$(git branch --show-current)"
node "$AW_SKILL_DIR/scripts/run-checks.mjs" "$D/checks.yaml" > "$D/checks.run.log" 2>&1; tail -1 "$D/checks.run.log"
```

1. `CHECKS p/M FAIL: <ids>` → fix the implementation for those IDs and re-run. `CHECKS M/M PASS (<sha>)` → run the Before-PR command (C4); this step ends when both pass on the same head — not on your judgment.
2. `id`, `requirement`, `ears`, `kind`, `expect`, and `checks.lock` are immutable; amend `run`/`setup` only to make a draft runnable, and log `check-run-amended` in the Progress Log. Never green a check by editing it or the test to match wrong behaviour.
3. Design decisions are yours, and the codebase's existing mechanisms win over the brief (C6). When the code shows the brief was wrong, fix it with `Skill("aw-create-plan")` (re-seals) and log why; a changed or dropped AC needs the user — print `BLOCKED: <the AC and the evidence>`.
4. Commit per coherent slice with the repo's commit format. When a pre-commit hook fails only on a failure already present on the base commit, show that it is present there, then commit with `--no-verify` and record it under `Degraded:`.
5. Sub-agents only when they save this context more than they cost: at most 3, run in the foreground, never polled with `sleep`.
6. Stuck: 5 attempts on the same failing area → re-trace the path end to end, write the finding to the Progress Log, try once more, then print `BLOCKED: <evidence>`.
7. **Run every gate in the foreground** — the checks, the Before-PR command, tests, and the reviewer — with a Bash timeout up to 600000 ms; split a suite that needs longer. Never end a turn while work you started in the background is unfinished: a headless or `/goal` run ends with the turn, and the result is lost. Send long output to a log and print its tail.

## Step 3 — Fresh-eyes review

After Step 2 ends, get one review from a context that did not write the code — in the foreground:

```text
Agent(subagent_type="branch-reviewer", prompt="--base <base sha> --head HEAD --out .agent/<branch>/findings.jsonl")
```

1. For every finding: fix it, or log `finding <id> rejected: <evidence>`. A finding about correctness, data loss, concurrency, or security is fixed unless the code refutes it.
2. After fixes, re-run the checks and the Before-PR command.
3. A second round only when round 1 produced a correctness fix; never a third.
4. No dispatch tool, or the reviewer fails → `review: not run (<reason>)` under `Degraded:`; never review your own diff and call it independent.

Once a PR exists, the reviewer is `Skill("review-loop", "<pr-url> --critical --no-ci --no-preview-run")` instead.

## Step 4 — UI spec, walkthrough, PR, evidence

1. **UI spec (C5)** when the diff touches UI files: write `specs.md` against the built UI and run it with `Agent(subagent_type="aw-tester", prompt="<specs.md path> --target <aw-target>")` when a target is reachable under [Shared machines](#shared-machines); else `UI spec: written, not run (<reason>)` under `Degraded:`.
2. **Walkthrough:** `Skill("aw-create-walkthrough")` — one page of what changed and what you assumed.
3. **PR:** `Skill("create-pr")` unless a user constraint forbids the push; then, only once you hold a PR URL, dispatch `feature-pr-verifier` once with the plan, walkthrough, head and base SHAs, and the Before-PR command, and watch CI (`ci-auto-fix` on failure, cap 2). No PR → `Verified: not run (no PR)`; the fresh-eyes review already covered the local diff.
4. **Lessons:** the exit write in [`lessons.md`](lessons.md), unless a user constraint forbids LoreKit writes.
5. **Evidence,** verbatim, then the terminal contract:

   ```text
   AW EVIDENCE
   <the run-checks sentinel line> | verify: <Before-PR command> exit=<code>
   review: <N> findings — <F> fixed, <R> rejected | not run (<reason>)
   PR: <draft PR URL | none — <the user constraint>>
   Changed files (git diff --name-only <base>...HEAD):
   <one path per line>
   UI spec: .agent/<branch>/specs.md — <N> specs, aw-tester <green|red|not run (<reason>)> · preview: /ui-verify run <pr-url> · local: /local-verify <pr-url>
   ```

   Omit the `UI spec:` line when no `specs.md` exists.

## Shared machines

A local stack, daemon, or dev server bound to another checkout belongs to someone else's work.
Never stop, kill, restart, or rebind it, and never run a repo skill or command that does — even when the prompt says a stack is "available".
Use a target that is already serving this worktree, or one you start on free ports without touching the other; otherwise the UI spec is `written, not run (stack bound to <checkout>)`.

## When sub-agent dispatch is unavailable

Steps 1, 2, and 4 run unchanged.
The review and the PR verifier become `review: not run (sub-agent dispatch unavailable)` and `Verified: not run (sub-agent dispatch unavailable)` — grading your own work in your own window is the self-grading they exist to remove.
The same holds when a harness depth limit withholds the dispatch tool.
Dispatch `aw-executor` as a sub-agent only when the user asks for a background worker or several briefs in parallel; it follows `templates/aw-executor.agent.md`.
