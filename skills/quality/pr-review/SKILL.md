---
name: pr-review
description: >
  One-shot read-only review of a GitHub PR — dispatches the `pr-reviewer` agent and
  reports its verdict and findings without touching your code. The short entry point
  for "review this PR" when you do not want an apply-and-converge loop. Also writes
  maintainer relevance rules via `/pr-review remember <fact>`. Invoke with /pr-review.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--critical] [--full] [--effort high] [--thoroughness 0..1] [--with a,b,c] [--no-holistic] [--no-escalate] [--no-optimize] [--no-standards] [--skip-gates] [--fix-links] | remember <fact>'
license: MIT
metadata:
  author: mthines
  version: '2.0.1'
  workflow_type: command
---

# /pr-review — one-shot read-only PR review

This is the thin entry point the [`pr-reviewer`](../../../agents/pr-reviewer.md) agent's own
documentation already promises (`Trigger with /pr-review <PR-URL|#n>`), and it does exactly one
thing: dispatch that agent at a PR and report what came back.

It **never applies a finding, never pushes, and never resolves a thread**.
That is the whole distinction from its neighbours, and it is the reason to reach for this command
rather than one of them: you get a review, and your working tree is exactly where you left it.

## Contents

- [Operations](#operations)
- [Step 0: Parse the argument](#step-0-parse-the-argument)
- [Step 1: Resolve the PR](#step-1-resolve-the-pr)
- [Step 2: Dispatch the agent](#step-2-dispatch-the-agent)
- [Step 3: Report](#step-3-report)
- [`remember` — write a maintainer relevance rule](#remember--write-a-maintainer-relevance-rule)
- [Which review command do I want?](#which-review-command-do-i-want)
- [Hard rules](#hard-rules)

---

## Operations

Parse the **first token** of `$ARGUMENTS`.

| First token | Operation | Runs |
| --- | --- | --- |
| `remember` | [memory write](#remember--write-a-maintainer-relevance-rule) | one `mcp__lorekit__memory_write`, no review |
| anything else (or empty) | [review](#step-2-dispatch-the-agent) | one `pr-reviewer` dispatch, read-only |

There is no third operation, and no mode flag that turns this command into an apply pass.
A request to fix what the review found is `review-loop` (convergence) or [`/implement-suggestion`](../../workflow/implement-suggestion/SKILL.md), below.

## Step 0: Parse the argument

Everything after the PR reference is a **pass-through flag**: forward it verbatim and interpret
none of it.
The agent owns its own flag grammar, so a flag this skill has never heard of must still reach it.

```bash
# Known agent flags, listed for the argument-hint only — NOT a validation allowlist.
#   --critical --full --effort high --with a,b,c --no-holistic --no-escalate
#   --no-optimize --no-standards --skip-gates --fix-links
```

**Never validate the flag list.** A skill that rejects an unrecognised flag has to be edited every
time the agent gains one, and the failure mode is silent: the user's flag is dropped and the review
runs without it. Forward the tail unchanged and let the agent reject what it does not know.

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

`pr-reviewer` has no PR-less mode — it reads threads, gates, and its own prior state from the PR
object — so there is nothing to degrade to here.

**Where `gh` is unavailable** (a sandbox with only the GitHub MCP server, for instance), resolve the
reference with `mcp__github__pull_request_read` instead of failing.
The agent itself is MCP-capable, so a missing `gh` is a resolution problem in this step and never a
reason to skip the review.

## Step 2: Dispatch the agent

`pr-reviewer` is an **agent, not a skill**.

```text
✅ RIGHT — through the harness's sub-agent dispatch tool
Task(subagent_type="pr-reviewer", prompt="<PR_REF> <pass-through flags>")

❌ WRONG — there is no skill by that name; this errors with `Unknown skill: pr-reviewer`
Skill("pr-reviewer", …)
```

**That tool's NAME varies by harness — `Task` in the Claude Code CLI, `Agent` in
the Claude Agent SDK harness behind Claude Code on the web.** Use whichever one
this session exposes; the call shape is identical. A tool taking a
`subagent_type` (or equivalent agent-name) parameter is the dispatch tool
whatever it is spelled.

Dispatch **once**. This command does not loop: a second pass over an unchanged head re-reads the
same code and re-posts the same report, and iterating a review against fixes is what
[`review-loop`](../review-loop/SKILL.md) exists for.

**Prepare once, then send the intent worker in the same message when the budget says `hybrid`.**
The dispatched agent holds no dispatch tool of its own, so the one sub-agent its budget isolates —
the intent finder — is dispatched from here, alongside it.
In A/B rounds 7–8 on sync-tray#72 the isolated intent finder flagged the highest-severity agreed
defect in 3 of 3 runs, where the default setting in one context had missed it in 4 of 4.
The two share one `prepare-review.mjs` run: a worker that ran its own repeated 8–30 s of GitHub reads
and left a worktree behind.

1. Settle [dispatch availability](#when-sub-agent-dispatch-is-unavailable) first: a skip must not
   leave a prepared workspace behind.
   Pick a run directory, `<scratchRoot()>/review-<PR number>-<unix seconds>/`, and create it.
   Resolve `$AGENT_SUPPORT` as [`remember`](#the-key-must-be-an-fp-or-there-is-no-rule-to-write) does.
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

   Write seconds: BSD `date` on macOS has no `%N`, so `%s%3N` there prints a literal `3N`.
   The `dispatch` record and the stamp put the agent's definition read and the worker's own span in
   the trace ([`run-telemetry.md`](../../../agents/pr-reviewer/rules/run-telemetry.md)).
4. On `hybrid`, in **one message**, dispatch both:
   - `pr-reviewer` with `<PR_REF> <pass-through flags> --context <dir>/context.json --intent-from <dir>/intent/intent.json`;
   - a general-purpose worker (the harness's general sub-agent type) with the [worker preamble](#worker-preamble--the-intent-worker),
     told to read `<dir>/context.json`, `finders.md`, and the review packet the context names, act as
     the `intent` finder only, and write its candidates to `<dir>/intent/intent.json` as a JSON array.
     It never runs `prepare-review.mjs`.
5. On `in-context` — below thoroughness 0.4, or a small incremental re-review — dispatch
   `pr-reviewer` alone with `--context <dir>/context.json`. The budget isolates nothing, so a worker
   would be a sub-agent's base cost for a candidate list the reviewer builds itself.
6. When every dispatch has returned, release the workspace: you ran prepare, so the cleanup is yours,
   never the reviewer's.

   ```bash
   node "$AGENT_SUPPORT/pr-reviewer/scripts/prepare-review.mjs" --cleanup <dir>/context.json
   ```

If prepare exits non-zero, dispatch `pr-reviewer` alone with no `--context`: it runs prepare
itself, owns that workspace's cleanup, and runs intent in-context.

The agent reads the intent file only after verifying its own candidates, and runs intent itself if
the worker failed
([`dispatch-topology.md` § The two topologies](../../../agents/pr-reviewer/rules/dispatch-topology.md#the-two-topologies)).
The two run concurrently, so the wall time is the reviewer's own.

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

An explicit read-list plus a forbidden-file rule is what stops the worker from re-reading the full
agent document on top of whatever the harness already loaded for that session — the dispatch prompt
is the one part of a worker's context this skill controls.

### When sub-agent dispatch is unavailable

Some harnesses expose no sub-agent dispatch tool at all. Establish that by
capability — **no** available tool dispatches a sub-agent under **any** name —
never from the absence of the single name `Task`, which would skip the review on
every harness that spells it `Agent`. When the capability is genuinely absent,
report the skip and stop:

```markdown
/pr-review — skipped (sub-agent dispatch unavailable; pr-reviewer requires it).
```

**Do not play the reviewer role in this context, and do not retry the dispatch.**
The agent's review independence comes from running in a fresh, isolated context; performing it
inline produces a self-review wearing a reviewer's label, which is worse than no review because it
is reported as one.
One absent-dispatch return is conclusive — the capability's absence is a property of the dispatch
topology, settled before any code is read, so a retry costs a round trip and returns the same answer.

Where another process reviews the PR instead (a review bot, a CI-triggered agent), the supported
path is `Skill("review-loop", "<PR> --external-review")`, which waits on that reviewer rather than
dispatching one.

### On a Dash0 Agent0 host

Agent0 cannot dispatch the custom `pr-reviewer` type, and its import can hold this `SKILL.md` alone.
Settle this before step 1 above, by file presence and never from a failed dispatch:

- **Prepared** — `/tmp/workspace/agent-skills/env.sh` exists. Source it (`. /tmp/workspace/agent-skills/env.sh`) in every Bash call; it exports `AGENT_SUPPORT`, `AGENT_SKILLS_ROOT`, and `AGENT_SKILLS_COMMIT`.
  **Read linked files from the install, never from the imported folder:** a sibling skill from `$AGENT_SKILLS_ROOT/skills/<name>/`, and every `agents/<path>` link from `$AGENT_SKILLS_ROOT/<path>`.
  When `$AGENT_SKILLS_ROOT/skills/pr-review/SKILL.md` differs from the copy you are running, or you cannot compare them, follow the installed copy: **the installed copy at `$AGENT_SKILLS_COMMIT` wins**, because the files it links come from that commit.
  Then make the dispatch substitutions in `$AGENT_SKILLS_ROOT/shared/rules/agent0-host.md`: `pr-reviewer` becomes a `general` sub-agent that reads `$AGENT_SKILLS_ROOT/pr-reviewer.agent0.md`, and the intent worker's type is `general`.
- **Unprepared** — no `env.sh`, but `/tmp/workspace`, `/tmp/.opencode/skills/`, or `/tmp/.opencode/agents/general.md` exists. This skill does not install. Stop with `/pr-review — skipped (Agent0 sandbox not prepared; run /review-loop <PR> --no-feedback, which installs on demand and reviews once)`. After that install, `/pr-review` takes the prepared branch.
- **Neither** — not Agent0. Continue as above.

## Step 3: Report

The agent posts its own sticky report comment and its inline findings.
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

Surface **blocking findings and non-passing gates prominently**.
This command applies nothing, so an unsurfaced blocker is a blocker the user never sees — the
terminal summary is the only place the result reaches them in this flow.

Report the verdict **as returned**. Do not soften a `FAIL` because the findings look minor to you,
and do not upgrade a `PASS` because the diff looks risky: the gates and the verifier already made
that call with evidence, and re-adjudicating it here would make two disagreeing verdicts for one
run.

## `remember` — write a maintainer relevance rule

`/pr-review remember <fact>` is the maintainer's direct write into the relevance memory the reviewer
reads on every run — the local equivalent of leaving the same comment on a PR, and the one write
path that needs no corroboration.
[`memory.md`](../../../agents/pr-reviewer/rules/memory.md#pr-review-remember--an-explicit-instruction-needs-no-corroboration)
owns the semantics; this section owns only the invocation.

Classify the direction from the wording:

| Wording | `direction` |
| --- | --- |
| "don't flag …", "stop flagging …", "we don't care about …" | `suppress` |
| "always check …", "watch for …", "this repo cares about …" | `amplify` |

### The key must be an `fp`, or there is no rule to write

The reviewer matches rules **by fingerprint** at read time, so a rule stored under any other key is
never read again.

The script lives in the `pr-reviewer` agent's support tree, not in the repository you are standing
in, so a bare `node agents/…` exits `MODULE_NOT_FOUND` everywhere but this skill's own repository.
Resolve the tree in the same Bash call. A Dash0 Agent0 install exports it from its `env.sh`;
everywhere else resolve it the way the agent does (its § Locating this agent's own files):

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
[ -f "$AGENT_SUPPORT/pr-reviewer/scripts/fingerprint.mjs" ] || {
  echo "pr-review remember: support tree unresolved (tried env.sh, ${CLAUDE_AGENT_FILE:-\$HOME/.claude/agents/pr-reviewer.md})" >&2; exit 1; }
node "$AGENT_SUPPORT/pr-reviewer/scripts/fingerprint.mjs" build \
  --finder <finder> --defect-class <class> --symbol <symbol|-> --path <repo-relative path>
```

An unresolved tree stops the write: without the script there is no `fp`, and a hand-built key is the
failure the next paragraph forbids.

That needs three things the prose may not carry: a `finder`, a `defect-class`, and a `path`
(`--symbol -` covers a whole-file rule).
Infer what the fact determines, then:

- **All three resolved** → build the `fp` and write the rule.
- **Any one missing** → ask for it in one question, naming the candidates from the enums the script
  validates against (`FINDERS` and `DEFECT_CLASSES` in `fingerprint.mjs`).

**Never invent a key to make the write succeed.** A prose-slug key writes a record the read path
cannot see, which is indistinguishable from having stored nothing while looking like success — the
exact failure the structural `fp_v: 2` space replaced.

```text
✅ RIGHT
/pr-review remember don't flag maintainability in scripts/eval/golden/
→ fp = quality:maintainability:-@scripts/eval/golden/   → write suppress

❌ WRONG
/pr-review remember stop being so picky
→ no finder, no class, no path. Ask which finder and where; never write `rule::stop-being-so-picky`.
```

### The write

```text
mcp__lorekit__memory_write
  tag:    loop::reviewer-comment-relevance
  key:    rule::<fp>
  scope:  repo::{owner}/{repo}
  ttl:    60d
  body:   { direction, status: "active",
            source: { type: "human", agent: "other", explicit: true },
            reason: "<the fact, verbatim>", scope_globs: [<glob>] }
```

`status: active` immediately, with no corroboration threshold: a maintainer saying "don't flag this"
**is** the evidence, and requiring three PRs' worth of it would be requiring them to say it three
times.

**`explicit: true` is required.** The agent filters every relevance-rule read on
`source.agent == "pr-reviewer" ∨ source.explicit == true`
([`memory.md`](../../../agents/pr-reviewer/rules/memory.md#every-read-filters-on-sourceagent)), and
without the flag this record is byte-identical to the incidental human comment that filter exists to
reject. Omitting it writes a rule the reviewer will never read — the same
looks-like-success-stores-nothing failure as inventing a prose key, arriving through the body
instead of the key.

### Two rules `remember` cannot write

A `suppress` rule can never silence a **`standards`** finding or a **`(blocking)`** one.
Refuse those two and say which:

```text
/pr-review: `standards` findings are not suppressible — they come from this repo's own governing
docs, so the fix is to change the doc (CLAUDE.md, AGENTS.md, .claude/rules/*.md), not to stop
enforcing it. Nothing was written.
```

The repo's written rule outranks its reviewers' fatigue, and a blocking finding is the one class
where a silent drop is most costly.
Both exemptions are the agent's, not this command's, so this refusal is a restatement of
`memory.md` and must not diverge from it.

## Which review command do I want?

| Command | Reviews | Applies findings | Pushes | Loops |
| --- | --- | --- | --- | --- |
| **`/pr-review <PR>`** | yes | **no** | no | no — one dispatch |
| [`/implement-suggestion <PR>`](../../workflow/implement-suggestion/SKILL.md) | no — applies existing comments | yes | yes | no (`--watch` repeats) |
| [`review-loop`](../review-loop/SKILL.md) | yes | yes | yes | yes, cap 5, converges on threads + CI |
| [`/polish`](../polish/SKILL.md) | yes | mechanical only | no | no — one pass each |

`/pr-review <PR>` is the one read-only entry point, and it is what the agent's own description,
`depth-routing.md`, and `memory.md` all already tell the user to type. Inside the loop,
`review-loop --no-feedback` is its report-only counterpart.

## Hard rules

- **Read-only, always.** This command never edits a file, never commits, never pushes, and never resolves a thread. Applying is [`/implement-suggestion`](../../workflow/implement-suggestion/SKILL.md); applying-and-converging is [`review-loop`](../review-loop/SKILL.md).
- **Never write to GitHub.** The agent posts its own sticky report and inline findings. This skill adds a terminal summary only — a second comment would duplicate a report that is rewritten in place precisely so a PR does not accumulate copies.
- **Dispatch via the sub-agent dispatch tool, never `Skill()`.** `pr-reviewer` is an agent; `Skill("pr-reviewer", …)` errors with `Unknown skill`. The tool is named `Task` in some harnesses and `Agent` in others — use the one this session has.
- **One prepare, one review dispatch per invocation, plus the intent worker in the same message when the budget is `hybrid`. Do not loop.** The caller that ran prepare runs `--cleanup`. Re-reviewing an unchanged head produces the same report at full cost.
- **Absent sub-agent dispatch is a skip, not a fallback — and it is a CAPABILITY test, not a name test.** Conclude it only when no available tool dispatches a sub-agent under any name; the absence of `Task` alone is not evidence. Then never review in this context and label it a `pr-reviewer` review, and never retry the dispatch.
- **Never validate the pass-through flags.** Forward the tail verbatim; the agent owns that grammar and rejects what it does not know.
- **Never re-adjudicate the verdict.** Report `PASS` / `WARN` / `FAIL` as returned, with the blocking findings named.
- **`remember` writes an `fp`-keyed rule or asks.** A prose-slug key is unreadable by the read path and must never be invented to make a write appear to succeed.
- **`remember` cannot suppress a `standards` or `(blocking)` finding.** Refuse and name the reason; those exemptions belong to [`memory.md`](../../../agents/pr-reviewer/rules/memory.md#two-findings-memory-may-never-suppress) and this command only restates them.
