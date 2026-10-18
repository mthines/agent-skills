---
name: pr-review
description: >
  One-shot read-only review of a GitHub PR: dispatches the `pr-reviewer` agent once
  and reports its verdict and findings without touching your code. Also writes
  maintainer relevance rules via `/pr-review remember <fact>`; invoke with /pr-review.
disable-model-invocation: false
argument-hint: '[<pr-url>|#<n>] [--critical] [--full] [--effort high] [--thoroughness 0..1] [--with a,b,c] [--no-holistic] [--no-escalate] [--no-optimize] [--no-standards] [--skip-gates] [--fix-links] | remember <fact>'
license: MIT
metadata:
  author: mthines
  version: '2.0.3'
  workflow_type: command
---

# /pr-review — one-shot read-only PR review

Dispatch the [`pr-reviewer`](../../../agents/pr-reviewer.md) agent at a PR and report what came back.
It **never applies a finding, never pushes, and never resolves a thread**.
Why each choice below exists: [`references/design-rationale.md`](./references/design-rationale.md).

## Contents

- [Operations](#operations)
- [Before Step 0: on a Dash0 Agent0 host](#before-step-0-on-a-dash0-agent0-host)
- [Step 0: Parse the argument](#step-0-parse-the-argument) · [Step 1: Resolve the PR](#step-1-resolve-the-pr)
- [Step 2: Dispatch the agent](#step-2-dispatch-the-agent) · [Worker preamble](#worker-preamble--the-intent-worker) · [When sub-agent dispatch is unavailable](#when-sub-agent-dispatch-is-unavailable)
- [Step 3: Report](#step-3-report)
- [Locating the support tree](#locating-the-support-tree)
- [Hard rules](#hard-rules)

## Operations

Parse the **first token** of `$ARGUMENTS`.

| First token | Operation | Runs |
| --- | --- | --- |
| `remember` | memory write — read [`rules/remember.md`](./rules/remember.md) | one `mcp__lorekit__memory_write`, no review |
| anything else (or empty) | [review](#step-2-dispatch-the-agent) | one `pr-reviewer` dispatch, read-only |

No mode turns this command into an apply pass; a request to fix findings is `review-loop` or [`/implement-suggestion`](../../workflow/implement-suggestion/SKILL.md) ([which command](./references/design-rationale.md#which-review-command)). Inside `review-loop`, `--no-feedback` is this command's report-only counterpart.

## Before Step 0: on a Dash0 Agent0 host

Agent0 cannot dispatch the custom `pr-reviewer` type, and its import can hold this `SKILL.md` alone.
Settle this before Step 0 and before any dispatch, by file presence and never from a failed dispatch.
It governs the review operation; `remember` dispatches nothing and resolves its tree on its own.

- **Prepared** — `/tmp/workspace/agent-skills/env.sh` exists. Source it (`. /tmp/workspace/agent-skills/env.sh`) in every Bash call; it exports `AGENT_SUPPORT`, `AGENT_SKILLS_ROOT`, and `AGENT_SKILLS_COMMIT`.
  **Read linked files from the install, never from the imported folder:** this skill's `rules/` and `references/` from `$AGENT_SKILLS_ROOT/skills/pr-review/`, a sibling skill from `$AGENT_SKILLS_ROOT/skills/<name>/`, and every `agents/<path>` link from `$AGENT_SKILLS_ROOT/<path>`.
  When `$AGENT_SKILLS_ROOT/skills/pr-review/SKILL.md` differs from the copy you are running, or you cannot compare them, follow the installed copy: **the installed copy at `$AGENT_SKILLS_COMMIT` wins**, because the files it links come from that commit.
  Then make the dispatch substitutions in `$AGENT_SKILLS_ROOT/shared/rules/agent0-host.md`: `pr-reviewer` becomes a `general` sub-agent that reads `$AGENT_SKILLS_ROOT/pr-reviewer.agent0.md`, and the intent worker's type is `general`.
- **Unprepared** — no `env.sh`, but `/tmp/workspace`, `/tmp/.opencode/skills/`, or `/tmp/.opencode/agents/general.md` exists. This skill does not install. Stop with `/pr-review — skipped (Agent0 sandbox not prepared; run /review-loop <PR> --no-feedback, which installs on demand and reviews once)`. After that install, `/pr-review` takes the prepared branch.
- **Neither** — not Agent0. Continue with Step 0.

## Step 0: Parse the argument

Everything after the PR reference is a **pass-through flag**: forward it verbatim and interpret none of it.

```bash
# Known agent flags, listed for the argument-hint only — NOT a validation allowlist.
#   --critical --full --effort high --with a,b,c --no-holistic --no-escalate
#   --no-optimize --no-standards --skip-gates --fix-links
```

**Never validate the flag list.** Let the agent reject what it does not know.

## Step 1: Resolve the PR

```bash
case "$ARGUMENTS" in
  *github.com/*/pull/*|*\#[0-9]*) PR_REF="<the reference as given>" ;;
  *) PR_REF=$(gh pr view --json url -q .url 2>/dev/null) ;;   # current branch's open PR
esac
```

If no reference was given **and** the current branch has no open PR, stop with one line:

```text
/pr-review: no PR reference given and no open PR on this branch. Pass a URL or #<n>, or open a draft PR first (/create-pr).
```

`pr-reviewer` has no PR-less mode.
Where `gh` is unavailable, resolve the reference with `mcp__github__pull_request_read` instead; a missing `gh` is never a reason to skip the review.

## Step 2: Dispatch the agent

`pr-reviewer` is an **agent, not a skill**.

```text
✅ RIGHT — through the harness's sub-agent dispatch tool
Task(subagent_type="pr-reviewer", prompt="<PR_REF> <pass-through flags>")

❌ WRONG — there is no skill by that name; this errors with `Unknown skill: pr-reviewer`
Skill("pr-reviewer", …)
```

The dispatch tool is named `Task` in the Claude Code CLI and `Agent` in the Claude Agent SDK harness behind Claude Code on the web; use whichever this session exposes — any tool taking a `subagent_type` parameter is it.
Dispatch **once**; iterating against fixes is [`review-loop`](../review-loop/SKILL.md)'s job.

**Prepare once, then send the intent worker in the same message when the budget says `hybrid`.**

1. Settle [dispatch availability](#when-sub-agent-dispatch-is-unavailable) first: a skip must not
   leave a prepared workspace behind.
   Pick a run directory, `<scratchRoot()>/review-<PR number>-<unix seconds>/`, and create it.
   Resolve `$AGENT_SUPPORT` per [Locating the support tree](#locating-the-support-tree).
2. Read the PR-state record exactly as the agent's Step 0.7 does — `mcp__lorekit__memory_read`,
   scope `branch::<owner>/<repo>::<headRefName>`, key `ci-state::pr-review-<n>` — and save a hit to
   `<dir>/state.json`. Skip it under `--isolated`; on a miss, or with no LoreKit tool, pass no `--state`.
3. Run prepare once, forwarding only the pass-through flags it takes (`--full`, `--effort`,
   `--thoroughness`, `--isolated`, `--pin-head`, `--repo-dir`; add `--review-sha <sha> --isolated`
   when the pass-through flags carry `--review-sha`), and read the topology on the same command:

   ```bash
   node "$AGENT_SUPPORT/pr-reviewer/scripts/prepare-review.mjs" --pr <PR_REF> --out <dir>/context.json [--state <dir>/state.json] <prepare flags> \
     && jq -r '.budget.topology' <dir>/context.json && node "$AGENT_SUPPORT/pr-reviewer/scripts/review-telemetry.mjs" dispatch --run-dir <dir> \
     && mkdir -p <dir>/intent && date +%s > <dir>/intent/dispatched_at
   ```

   Write whole seconds (`%s`); BSD `date` has no `%N`.
4. On `hybrid`, in **one message**, dispatch both:
   - `pr-reviewer` with `<PR_REF> <pass-through flags> --context <dir>/context.json --intent-from <dir>/intent/intent.json`;
   - a general-purpose worker (the harness's general sub-agent type) with the [worker preamble](#worker-preamble--the-intent-worker),
     told to read `<dir>/context.json`, `finders.md`, and the review packet the context names, act as
     the `intent` finder only, and write its candidates to `<dir>/intent/intent.json` as a JSON array.
     It never runs `prepare-review.mjs`.
5. On `in-context` — below thoroughness 0.4, or a small incremental re-review — dispatch
   `pr-reviewer` alone with `--context <dir>/context.json`, and no worker.
6. When every dispatch has returned, release the workspace: you ran prepare, so the cleanup is yours,
   never the reviewer's.

   ```bash
   node "$AGENT_SUPPORT/pr-reviewer/scripts/prepare-review.mjs" --cleanup <dir>/context.json
   ```

If prepare exits non-zero, dispatch `pr-reviewer` alone with no `--context`: it runs prepare itself, owns that workspace's cleanup, and runs intent in-context.
The agent reads the intent file only after verifying its own candidates, and runs intent itself if the worker failed ([`dispatch-topology.md` § The two topologies](../../../agents/pr-reviewer/rules/dispatch-topology.md#the-two-topologies)).

```text
✅ RIGHT — prepare once, then one message, two dispatches
Task(subagent_type="pr-reviewer", prompt="<PR_REF> --context /…/context.json --intent-from /…/intent/intent.json")
Task(subagent_type="general-purpose", prompt="<worker preamble> … read /…/context.json … act as the intent finder … write /…/intent/intent.json")

❌ WRONG — the worker in a second message: the reviewer's wait becomes the worker's full runtime
❌ WRONG — a worker told to run prepare-review.mjs: a second set of GitHub reads, and a leaked worktree
```

### Worker preamble — the intent worker

The intent worker Step 2 dispatches gets this preamble prepended to its prompt, verbatim:

```text
You are the intent worker for one pr-reviewer run, not the full pr-reviewer agent.
- Read ONLY the file(s) named below, by their ABSOLUTE path — never a bare relative path; your
  cwd is not guaranteed to be this repo's checkout.
- Do NOT read agents/pr-reviewer.md. It is the full agent's own document; you are one finder of
  its pipeline, dispatched with exactly the context that finder needs, and reading it would
  re-derive context the dispatch already isolated you from (and burn the tokens doing it).
- Do NOT call Skill(). Read the rule file(s) you were given instead.
- Do NOT run prepare-review.mjs. The context file you were given is already prepared; read
  context.packet.path from it.
- Read the review packet first (context.packet.path): the PR description and every hunk widened
  against the head file, with head line numbers you cite directly. Open a workspace file only for
  what it does not show — a caller, a definition, or a file its index marks "listed".
- Write your JSON output to the path you were given. Return ONLY that path in your final message
  — never the payload inline. The reviewer reads the file from disk; a payload returned as text
  spends context neither side needs to spend.
```

### When sub-agent dispatch is unavailable

Conclude this by capability — **no** available tool dispatches a sub-agent under **any** name — never from the absence of the name `Task`.
Then report the skip and stop:

```markdown
/pr-review — skipped (sub-agent dispatch unavailable; pr-reviewer requires it).
```

**Do not play the reviewer role in this context, and do not retry the dispatch.**
Where another process reviews the PR instead (a review bot, a CI-triggered agent), the supported path is `/implement-suggestion <PR> --watch`.

## Step 3: Report

The agent posts its own sticky report comment and inline findings.
This skill adds a terminal summary and nothing else — never a second GitHub write.

```text
/pr-review on PR #<n> (<owner>/<repo>)

Verdict: <PASS | WARN | FAIL>
Run mode: <full | incremental | incremental-quick | zero-delta> · <deep | standard | quick> · <checkout | tarball | diff-only>
Findings: <N inline (<K> blocking)>, <D deferred (low-confidence, advisory)>
Gates: <one line naming any non-passing gate, or "all passing">

<one line per blocking finding: path:line — the ask>

Report: <URL of the sticky comment>
Apply these: /implement-suggestion <PR>   (or Skill("review-loop", "<PR>") to converge)
```

Surface blocking findings and non-passing gates prominently — this summary is the only place the result reaches the user.
Report the verdict **as returned**: never soften a `FAIL` or upgrade a `PASS`.

## Locating the support tree

The scripts live in the `pr-reviewer` agent's support tree, not in the repository you are standing in, so a bare `node agents/…` exits `MODULE_NOT_FOUND` everywhere but this skill's own repository.
Resolve it in the same Bash call that uses it — Agent0 exports it from `env.sh`; elsewhere resolve it the way the agent does (its § Locating this agent's own files):

```bash
[ -f /tmp/workspace/agent-skills/env.sh ] && . /tmp/workspace/agent-skills/env.sh   # Agent0: exports AGENT_SUPPORT
if [ -z "$AGENT_SUPPORT" ]; then
  resolve() {  # portable readlink -f
    [ -e "$1" ] || return 1
    ( cd "$(dirname "$1")" && t=$(basename "$1")
      while [ -L "$t" ]; do d=$(readlink "$t"); cd "$(dirname "$d")" || return 1; t=$(basename "$d"); done
      printf '%s/%s\n' "$(pwd -P)" "$t" )
  }
  AGENT_MD=$(resolve "${CLAUDE_AGENT_FILE:-$HOME/.claude/agents/pr-reviewer.md}" || echo "")
  AGENT_SUPPORT="${AGENT_MD%/pr-reviewer.md}"
fi
```

## Hard rules

- **Read-only, always.** Never edit a file, commit, push, resolve a thread, or write to GitHub — the agent posts its own sticky report and inline findings.
- **One prepare, one review dispatch per invocation, plus the intent worker in the same message when the budget is `hybrid`. Do not loop.** The caller that ran prepare runs `--cleanup`.
- **Absent sub-agent dispatch is a skip, not a fallback — and it is a capability test, not a name test.** Never review in this context and label it a `pr-reviewer` review, and never retry the dispatch.
- **Never re-adjudicate the verdict.** Report `PASS` / `WARN` / `FAIL` as returned, with the blocking findings named.
- **`remember` writes an `fp`-keyed rule with `explicit: true`, or asks** — never an invented key — and never suppresses a `standards` or `(blocking)` finding ([`rules/remember.md`](./rules/remember.md)).
