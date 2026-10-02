---
title: Agent0 runtime — running pr-reviewer inside a Dash0 Agent0 Automation
impact: HIGH
tags:
  - pr-reviewer
  - agent0
  - automation
  - bootstrap-cost
  - cross-harness
---

# Agent0 runtime

`pr-reviewer` runs on three harnesses. Two of them — the Claude Code CLI and the
Claude Agent SDK behind Claude Code on the web — read files natively, resolve
`Skill()` from the filesystem, and dispatch a named custom agent. The third, a
**Dash0 Agent0 Automation sandbox**, does none of those three, and every one of
its costs is paid *before Step 0 runs*.

This rule owns that harness. It changes no phase, no finding, no verdict and no
gate: the review is the same review. It changes only how the pipeline is
**delivered** into a session, and what a run there must not assume.

## Contents

- [The four host facts](#the-four-host-facts)
- [The install lives in the workspace, not in `$HOME`](#the-install-lives-in-the-workspace-not-in-home)
- [The setup script, not a first prompt step](#the-setup-script-not-a-first-prompt-step)
- [Enter at Step 1.2c, from a prepared context](#enter-at-step-12c-from-a-prepared-context)
- [Phase D: two workers in one message; never expect a second rung](#phase-d-two-workers-in-one-message-never-expect-a-second-rung)
- [The dispatch prompt is short on purpose](#the-dispatch-prompt-is-short-on-purpose)
- [Budget](#budget)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## The four host facts

Each is a measured property of the host, not a precaution, and each has a
recorded failure behind it.

| # | Fact | What it breaks if assumed away |
|---|---|---|
| 1 | The native file reader is scoped to the **workspace**. `$HOME/.claude/**` is outside it. | Every read of an installed file degrades to `sed -n 'a,bp'` through Bash against a ~50 KB output cap. `pr-reviewer.md` alone is ~277 KB, and a single `cat` is silently truncated — costing Steps 0 through 1.8. |
| 2 | The host's **skill tool resolves a fixed enum** of its own built-ins, never the filesystem. | Five of the six composed lenses error with `Skill "<name>" not found`; `measurable` silently name-collides with an unrelated built-in and returns the wrong recipe **with no error at all**. A week of runs showed 20/29 hitting this and a mandated retry recovering **0 of 26** across two weeks — because no retry can repopulate an enum that is not filesystem-derived. |
| 3 | **Custom agent types are not dispatchable.** `general` sub-agents are, and delegation is exactly **one level deep**. | A pipeline that plans to dispatch `pr-reviewer` and let it fan out further has no second rung. Dispatch from the top-level run or not at all. |
| 4 | The GitHub credential is **injected per request and repo-scoped**. `gh api /user` and `/rate_limit` return 401. | Identity comes from GraphQL `viewer { login }` (measured: `dash0-dev[bot]`), never `/user`. If that read fails too, treat it as *identity unknown* — never as an empty login, and never as a reason to retry. |

Fact 2's full resolution algorithm is
[`lens-invocation.md`](../../shared/rules/lens-invocation.md), which this rule
does not restate. What this rule adds is the **installation path** the algorithm
resolves against on this host: `$PR_REVIEWER_ROOT/skills/<name>/SKILL.md`, not
`$HOME/.claude/skills/<name>/SKILL.md`.

## The install lives in the workspace, not in `$HOME`

```
/tmp/workspace/pr-reviewer/                      AGENT_SUPPORT
/tmp/workspace/pr-reviewer/pr-reviewer.md        the agent definition
/tmp/workspace/pr-reviewer/pr-reviewer.agent0.md the compiled bundle
/tmp/workspace/pr-reviewer/pr-reviewer/rules/    deferred rules
/tmp/workspace/pr-reviewer/shared/rules/         shared rules
/tmp/workspace/pr-reviewer/skills/<lens>/        the six lenses, as files
/tmp/workspace/pr-reviewer/RUN-CONSTRAINTS.md    standing constraints
```

The path is the whole fix for fact 1. Nothing else changes: the tree is the
repo's `agents/` directory copied verbatim, so every `AGENT_SUPPORT`
self-resolution finds its `rules/`, `scripts/`, `templates/` and `shared/`
side by side exactly as it does under the CLI's install convention.

A run here **never** substitutes `cat` for the native reader, and never needs
to. The constraint that says otherwise is a constraint about `$HOME`, and it
retires with the path.

## The setup script, not a first prompt step

[`scripts/agent0-setup.sh`](../scripts/agent0-setup.sh) is the source of truth
for an automation's `sandbox.setupScript`. It runs once, **before the agent
starts**, and its result is cached between runs while the script text is
unchanged.

An install written into the prompt instead is re-executed on every run, in
session, non-deterministically — which is both the largest fixed cost in the run
and the reason a sandbox reset between turns silently produces a half-installed
agent. Verifying presence is still correct; *re-installing* is not.

The script fails **closed**. No rung of its acquisition ladder succeeding is
`exit 1` with the remediation named, because a review against a half-installed
agent is worse than no review — it reports phases it never had the procedure
for.

It exports `PR_REVIEWER_ROOT`, `PR_REVIEWER_BUNDLE`, `PR_REVIEWER_CONSTRAINTS`,
`PR_REVIEWER_PREPARE`, `AGENT_SUPPORT`, `PR_REVIEWER_PIN` and
`PR_REVIEWER_LOGIN`. Read the paths from those variables rather than
re-deriving them: `resolve()`'s three call sites in the agent body exist because
shell state does not persist between tool calls, and an exported variable does.

## Enter at Step 1.2c, from a prepared context

[`scripts/prepare-review.mjs`](../scripts/prepare-review.mjs) executes the
deterministic half of the pipeline in one process:

| Pipeline step | What the script does |
|---|---|
| Step 0 / 0.2 | resolves the PR reference (URL, `owner/repo#n`, bare `n`) and `RESOLVED_REPO` |
| Step 0.5 | PR metadata, author, `REVIEW_RELATION` from `PR_REVIEWER_LOGIN` — never from `/user` |
| Step 0.7 (partial) | the **GitHub fallback rung only**: the marker-keyed sticky and its footer SHA |
| Step 0.8 | the zero-delta pre-check, on a 7-char prefix |
| Step 1.1 | the five fetches, concurrently |
| Step 1.1b | the Phase A capability ladder, `DEPTH_CAPABILITY`, `TIER2_CHECKER`, `WORKDIR_CLEANUP` |
| Step 1.2 | the paginated patch list and the undiffable partition |
| Step 1.2 (shape) | `classify-shape.mjs`, with `high_stakes_paths` read from the review config |
| Phase B | `build-impact-graph.mjs` |

It emits a ~12 KB **index** plus sidecars (`pr-files.json`, `pr-diff.patch`,
`impact.json`, `pr-undiffable-paths.json`), so a step reads the payload it needs
and no more.

Two invariants hold over the context and both are load-bearing:

- **Take its values; do not re-derive them.** Re-running a fetch the context
  holds is not a safety check — it opens the torn-state window Step 1.2 exists
  to close. `headSha`, `baseSha`, the diff, the patch list and the impact graph
  are bound from one metadata read in one process.
- **`priorRun` is the fallback rung, not the record.** It carries `priorSha` and
  `priorDiagnostics: null`, and says so in the artifact. Step 0.8's fast path is
  gated on the LoreKit record (`STATE_STATUS == "read"`), so a run that has only
  this context must fall through to Step 1, where an empty `LAST_FULL_SHA`
  promotes it to `full` — never take the fast path off `priorSha` alone.

A degraded rung is never a non-zero exit. It is an entry in `anomalies[]`, which
the run carries into `RUN_ANOMALY`: a review that could not materialize a
checkout is a narrower review, not a failed one.

## Phase D: two workers in one message; never expect a second rung

The topology is [`dispatch-topology.md`](./dispatch-topology.md)'s, read from `context.budget`
exactly as on any other host: `in-context` below thoroughness 0.4, `hybrid` from 0.4, except a
small incremental re-review, which is `in-context` (`budget.topologyReason: "small-incremental"`).
This host changes only how `hybrid` runs. A sub-agent here runs while this run waits on it — the only
concurrency is several dispatches in one message — so `hybrid`'s "run the other finders while the
intent finder runs" cannot happen in this context, and dispatching the intent finder alone and
waiting would add its whole runtime (5–6 minutes on a 22-file PR) in series, against a timeout
whose stop gate fires at ~9 minutes.

So under `hybrid`, send **exactly two `general` sub-agents in one message**:

| Worker | Finders | Writes | Trace |
|---|---|---|---|
| intent | `intent` only | `<scratch>/intent.json` | none |
| other finders | every other finder active in `context.budget.finders` — `correctness` and `quality` always, `consumer-impact`, `dependency` and `standards` when the budget turns them on — in one context | `<scratch>/others.json` | `<scratch>/others.trace.json` — an `impact_trace` array, `[]` when neither `consumer-impact` nor `dependency` is on |

That keeps `hybrid`'s isolation — the intent finder alone, the other finders sharing one context —
and costs the slower worker's runtime instead of the sum. Both workers read the context this run
prepared; neither runs `prepare-review.mjs`, and the workspace cleanup stays this run's. Both files
exist when the message returns, so there is no intent wait to mark here. Everything after Phase D stays in this
run: read both files, pool their candidates for Step 2.5, run the lenses, and verify every candidate
here — marking `verify` with the pooled `--attr candidates=<n>` on the first verification command — under [`dispatch-topology.md § Verification — in your own context`](./dispatch-topology.md#verification--in-your-own-context),
shape self-check included. A candidate is not trusted because a worker raised it.

Fold `<scratch>/others.trace.json` into `judgments.impact_trace` when you write `judgments.json`,
beside any entry this run traced itself ([`impact-graph.md` § In the report](./impact-graph.md#in-the-report)).
A worker's trace is coverage, never a finding: it marks consumer files and usage sites as checked,
and nothing in it is posted. A missing or unreadable trace file folds as `[]`, so its consumers
render as not checked, never as verified.

**Never dispatch anything else.** Phase E verifies one candidate at a time in this turn, and Step
2.4b's targeted holistic traces are `Skill()` calls in this turn too. Neither is a fan-out, on this
host or any other: a dispatch per candidate pays a sub-agent's whole base cost for one verdict.

Each worker's prompt is short, for the reason in
[the next section](#the-dispatch-prompt-is-short-on-purpose), and names only absolute paths:

- its task — which finders to run, from `/tmp/workspace/pr-reviewer/pr-reviewer/rules/finders.md`,
  plus `finder-consumer-impact.md` and `finder-dependency.md` beside it for the other-finders
  worker when the budget turns those finders on;
- the prepared context (`review-context.json`) and the review packet it names (`packet.path`):
  read the packet first, and open a workspace file only for what the packet does not show;
- `/tmp/workspace/pr-reviewer/RUN-CONSTRAINTS.md`;
- its output path: write the candidates there as a JSON array of `finders.md` candidate records,
  and return only that path in the final message;
- for the other-finders worker, its trace path beside it: write `<scratch>/others.trace.json` as
  a JSON array of `impact_trace` entries, `[]` when neither `consumer-impact` nor `dependency` ran;
- do not read `pr-reviewer.md` or the bundle, and do not call the skill tool.

That is the discipline of `/pr-review`'s
[worker preamble](../../../skills/quality/pr-review/SKILL.md#worker-preamble--the-intent-worker),
which is not installed on this host, so the list above is the copy a run here uses. The sandbox
filesystem is shared with this run, so a worker reads its files itself rather than receiving them
inline.

Mark both workers on commands you already run ([`run-telemetry.md`](./run-telemetry.md)):
`worker intent start` and `worker other-finders start` on the command before the message, and the
two `end` markers on the command that reads the files. The `worker intent end` record is what tells
`finalize.mjs` the intent finder ran isolated.

If a worker returns no readable file, **do not dispatch it again**: here a retry runs in series,
against the same timeout. Run that worker's finders in this context and add
`<worker> worker returned no readable candidates — ran its finders in-context` to `RUN_ANOMALY`
through `context.render.RUN_ANOMALY`. The review never loses a finder.

Fact 3 still binds: a worker cannot dispatch further, so no worker prompt may ask it to.

**When `review-loop` dispatched you, there is no dispatch at all.** In a loop
automation the top-level run is the loop, and this review is its one `general`
sub-agent ([`review-loop/rules/agent0-runtime.md`](../../../skills/quality/review-loop/rules/agent0-runtime.md#sub-step-a--dispatch-a-general-reviewer-pointed-at-the-bundle)).
Run every finder, the intent finder included, and the verifier in this context — the `in-context`
topology, which the pipeline already permits — and return the verdict, the new-finding count, and
the sticky URL in the final message. Never attempt a dispatch to recover the isolation: the second
rung does not exist.

## The dispatch prompt is short on purpose

Four of 34 runs in one measured week were refused outright: the dispatched
`general` sub-agent read a dense prompt — a `HARD CONSTRAINTS` block, pre-filled
override IDs, an authorization note citing specific past incidents as precedent
— classified it as a probable prompt-injection or social-engineering attempt,
and declined twice without touching a tool. Two of the four were the same PRs
refused the week before. Every one of them reported `success` at the platform
level, because a refusal is a completed turn.

So the standing constraints live in `RUN-CONSTRAINTS.md` on disk, written by the
setup script, and the dispatch prompt **points at the file** instead of
restating it. The rules are identical; what changes is that the prompt reads as
a task rather than as a jailbreak.

Two consequences:

- Do not re-inline the constraints "for safety". That is the exact edit that
  reintroduces the refusal.
- A refusal is invisible in the platform's own run-status field. Detect it: a
  final response opening with a refusal or a `BLOCKED` line is a distinct
  outcome, and the run must report it as one rather than as a completed review.

## Budget

| Phase | Before | After |
|---|---|---|
| install | every run, in session | cached, `0 s` after the first |
| ingest the pipeline | ~16 bash slices | 3 native reads |
| Steps 0 → Phase B | ~20 model round-trips | 1 call, ~6 s measured |
| Phase D | serial | two workers in one message (intent; the other finders) |

Set the automation `timeout` to the budget you actually want rather than to a
ceiling: the agent's own stop condition fires at 75 % of the wall-clock budget,
so a 45 m timeout puts the self-truncation gate at 33 minutes and it never
bites. A 12 m timeout puts it at ~9 minutes, which is a gate.

`networkLevel` is `trusted_only`. The flow reaches `codeload.github.com`,
`github.com` and the language registries, all of which are on the allowlist;
nothing in it reaches an arbitrary third-party host, and `full` buys the run
nothing it cannot already do.

## What this rule does not do

- It does not change any phase, finding, score, gate or verdict. The review is
  the review.
- It does not replace [`lens-invocation.md`](../../shared/rules/lens-invocation.md).
  That rule owns lens resolution on **every** harness; this one only says where
  the files are installed on this one.
- It does not make the prepared context authoritative over the pipeline. Every
  value it carries is one the pipeline would have computed; it is a cache, and a
  field it does not carry is a step the run still owes.
