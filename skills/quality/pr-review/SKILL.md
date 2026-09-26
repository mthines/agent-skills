---
name: pr-review
description: >
  One-shot read-only review of a GitHub PR — dispatches the `pr-reviewer` agent and
  reports its verdict and findings without touching your code. The short entry point
  for "review this PR" when you do not want an apply-and-converge loop. Also writes
  maintainer relevance rules via `/pr-review remember <fact>`. Invoke with /pr-review.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--fanout] [--critical] [--full] [--effort high] [--with a,b,c] [--no-holistic] [--no-escalate] [--no-optimize] [--no-standards] [--skip-gates] [--fix-links] | remember <fact>'
license: MIT
metadata:
  author: mthines
  version: '1.2.0'
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
- [`--fanout` — opt-in parallel orchestration](#--fanout--opt-in-parallel-orchestration)
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
A request to fix what the review found is [`/review-changes`](../review-changes/SKILL.md), below.

## Step 0: Parse the argument

Everything after the PR reference is a **pass-through flag**: forward it verbatim and interpret
none of it.
The agent owns its own flag grammar, so a flag this skill has never heard of must still reach it.

**One exception: `--fanout`.** It is the one flag this skill reads for itself, because it changes
which dispatch this skill performs (Step 2's single `pr-reviewer` dispatch vs. the parallel
orchestration below) rather than something the agent interprets. Strip it from the tail before
forwarding the rest — see [`--fanout`](#--fanout--opt-in-parallel-orchestration).

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

**This is the default and the fallback.** If `--fanout` was passed, run
[`--fanout`](#--fanout--opt-in-parallel-orchestration) instead of this single dispatch — unless that
section's own quick-tier or no-dispatch conditions send you back here.

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
Apply these: /review-changes <PR>   (or /implement-suggestion <PR>)
```

Surface **blocking findings and non-passing gates prominently**.
This command applies nothing, so an unsurfaced blocker is a blocker the user never sees — the
terminal summary is the only place the result reaches them in this flow.

Report the verdict **as returned**. Do not soften a `FAIL` because the findings look minor to you,
and do not upgrade a `PASS` because the diff looks risky: the gates and the verifier already made
that call with evidence, and re-adjudicating it here would make two disagreeing verdicts for one
run.

## `--fanout` — opt-in parallel orchestration

**Default OFF.** Pass `--fanout` to run the review as a parallel orchestration *from this skill*
instead of the single `pr-reviewer` dispatch in [Step 2](#step-2-dispatch-the-agent). Everything
else in this document — argument parsing, PR resolution, the terminal report, `remember` — is
unchanged; `--fanout` only replaces how the review itself gets done.

**Why this skill, and not the agent.** `pr-reviewer` runs as a sub-agent and holds no dispatch
tool, so it cannot fan further work out — a sub-agent cannot dispatch a sub-agent (the same
nested-dispatch ceiling `review-loop`'s caller contract and the `aw` dispatcher document). `/pr-review`
runs at the **top level**, wherever a session's own sub-agent dispatch tool lives, so it is the one
place in this pipeline that *can* be the orchestrator rather than another leaf.

### The capability test, first

Before doing anything else, establish **by capability** whether this session can dispatch a
sub-agent at all — **never** by checking for the literal tool name `Task`. The dispatch tool is
spelled `Task` in the Claude Code CLI, `Agent` in the Claude Agent SDK harness behind Claude Code
on the web, and `task` in OpenCode-based hosts such as Dash0 Agent0; a name-literal check reports
"unavailable" on every session that spells it another way, even though the capability is present.
Use whichever tool this session exposes that takes a `subagent_type` (or equivalent agent-name)
parameter.

Every finder, lens, verifier, and synthesis sub-agent below is a **generic** sub-agent. Hosts spell
that type differently too — `general-purpose` in Claude Code, `general` in OpenCode-based hosts —
so pass whichever the dispatch tool accepts; a missing `general-purpose` is a spelling difference,
never a reason to take the fallback.

| Capability | Action |
| --- | --- |
| present | run the orchestration below |
| **absent** | **fall back to [Step 2](#step-2-dispatch-the-agent)'s single `pr-reviewer` dispatch — this is a fallback, not a skip.** Say so in the terminal report: `` `--fanout` requested but no sub-agent dispatch tool is available — ran the single-dispatch `pr-reviewer` review instead. `` A caller that asked for the parallel path and silently got the serial one without being told has no way to know its concurrency assumptions did not hold. |

This is the one place `--fanout`'s fallback differs from Step 2's own no-dispatch case: Step 2 with
no `--fanout` has nothing to fall back to and reports a **skip**, because performing the review
in-context would be a self-review wearing a reviewer's label. Here, the single-context `pr-reviewer`
dispatch *is* the fallback and still runs — dispatching that one agent needs the same capability
`--fanout` needed and just failed to find, so if the capability is genuinely absent both paths report
the same skip; the distinction only matters when read carefully: `--fanout`'s absence-of-dispatch
case degrades one rung, not to nothing.

### Step a — build the review context

**Resolve the support tree first.** Every script this orchestration runs lives in the
`pr-reviewer` agent's support tree, not in the repository under review, so a bare
`node agents/…` exits `MODULE_NOT_FOUND` everywhere but this skill's own repository. Resolve it
the way the agent does (`pr-reviewer.md` § Locating this agent's own files), print it, and reuse
the printed string in every later Bash call — shell state does not survive between calls:

```bash
resolve() {  # portable readlink -f
  [ -e "$1" ] || return 1
  ( cd "$(dirname "$1")" && t=$(basename "$1")
    while [ -L "$t" ]; do d=$(readlink "$t"); cd "$(dirname "$d")" || return 1; t=$(basename "$d"); done
    printf '%s/%s\n' "$(pwd -P)" "$t" )
}
AGENT_MD=$(resolve "${CLAUDE_AGENT_FILE:-$HOME/.claude/agents/pr-reviewer.md}" || echo "")
[ -n "$AGENT_MD" ] || { echo "pr-review --fanout: pr-reviewer support tree unresolved" >&2; exit 1; }
echo "AGENT_SUPPORT=${AGENT_MD%/pr-reviewer.md}"
```

An unresolved tree is the same case as an absent dispatch capability: fall back to
[Step 2](#step-2-dispatch-the-agent)'s single dispatch and say why in the terminal report.

Then run [`prepare-review.mjs`](../../../agents/pr-reviewer/scripts/prepare-review.mjs) exactly as
`pr-reviewer.md` Step 1 does, writing `context.json` under
[`scratchRoot()`](../../../agents/pr-reviewer/scripts/prepare-review.mjs#L75) — `/tmp/workspace/.pr-reviewer-scratch/`
on Agent0 hosts (the workspace directory every dispatched sub-agent's file tools can read; a bare
`os.tmpdir()` path is refused for exactly that reason, per the script's own docstring), falling
back to `<cwd>/.pr-reviewer-scratch/` locally. Every artifact this orchestration writes lives under
one run directory:

```text
<scratchRoot()>/<run-id>/
  context.json
  candidates/<finder>.json         # step c
  lenses/<lens>.json                # step c
  verdicts/<n>.json                 # step e
  judgments.json                    # step f
  finalize/…                        # finalize.mjs --out-dir
```

Each dispatched sub-agent **writes its JSON to that path and returns only the path** — never the
payload inline. A finder or verifier's full output can run to tens of KB; returning it as the
dispatch result would spend the orchestrator's own context on data it only needs to hand to the next
mechanical step, exactly the cost this whole pipeline exists to cut.

### Step b — route: `quick` tier skips the fan-out

Read `context.routing.tier` off the `context.json` Step a just wrote
([`route-depth.mjs`](../../../agents/pr-reviewer/scripts/route-depth.mjs), per
[`depth-routing.md`](../../../agents/pr-reviewer/rules/depth-routing.md)).

**At `quick` tier, skip the fan-out entirely and fall back to [Step 2](#step-2-dispatch-the-agent)'s
single dispatch.** A `quick`-tier diff is, by `depth-routing.md`'s own override rule, one that
reaches nothing and needs no deep pass (`THREAD_OVERLAP ≥ 0.8` and `band == none`) — six parallel
sub-agent dispatches plus a verification wave to review a diff the routing already decided needs the
cheapest pass is concurrency spent on a review that was never going to be expensive. This is a
**routing decision**, not a capability fallback, and the terminal report should say which one fired
(`quick tier — ran single-dispatch pr-reviewer` vs. the no-dispatch wording above).

`standard` and `deep` tiers proceed to Step c.

### Step c — parallel finder + lens dispatch

Dispatch one sub-agent per finder, from [`finders.md`](../../../agents/pr-reviewer/rules/finders.md)'s
own table — the same six every `pr-reviewer` run uses, no more and no fewer:

```text
correctness · consumer-impact · dependency · intent · standards · quality
```

Each finder sub-agent receives **only**:

- its own finder rule file(s) — `finders.md` plus, for `consumer-impact` and `dependency`, their
  dedicated rule ([`finder-consumer-impact.md`](../../../agents/pr-reviewer/rules/finder-consumer-impact.md),
  [`finder-dependency.md`](../../../agents/pr-reviewer/rules/finder-dependency.md));
- `context.json`;
- the workspace path.

Never the other finders' output, never a running count of candidates so far — `finders.md`'s own
independence rule (a shared summary makes the next finder quieter). Each finder returns candidate
records in [`finders.md`](../../../agents/pr-reviewer/rules/finders.md#the-candidate-record)'s
**pre-verification** shape (`finder`, `defect_class`, `path`, `line`, `symbol`, `claim`,
`bad_outcome`, `evidence`, `severity_hint`, `fix`, `verify_by` — no `prefix`, no `body`; those are
the verifier's fields, added in Step e), written to `candidates/<finder>.json`.

**`--effort high` runs `correctness` as diversify-then-vote** exactly per `finders.md`'s existing
rule: N = 5 sub-agents (N = 3 by default) over the same hunks in permuted file order, each an
independent dispatch counted against the same concurrency cap below, with agreement recorded as
`votes` on the merged candidate.

**Lenses ride the same parallel wave**, each self-gating on the tier `route-depth.mjs` already
resolved — no separate wave, no separate cap accounting:

| Lens | Runs at | Rule |
| --- | --- | --- |
| holistic review | default ON in `full` mode; shape-gated in incremental | [`holistic-review.md`](../../../agents/shared/rules/holistic-review.md) |
| optimality | `deep` only | [`optimality-review.md`](../../../agents/shared/rules/optimality-review.md) |
| standards-conformance | `deep` and `standard` | [`standards-conformance.md`](../../../agents/shared/rules/standards-conformance.md) |
| measurability | `deep` and `standard` | [`measurability-review.md`](../../../agents/shared/rules/measurability-review.md) |

Each lens's output lands at `lenses/<lens>.json` and feeds `judgments.lenses.*` at assembly (Step f)
— unchanged from how `pr-reviewer.md` already shapes that object.

### Step d — deterministic dedupe

Concatenate every `candidates/<finder>.json` file and run:

```bash
node "$AGENT_SUPPORT/pr-reviewer/scripts/finalize.mjs" \
  --dedupe-candidates "<scratchRoot()>/<run-id>/all-candidates.json" \
  --out "<scratchRoot()>/<run-id>/deduped.json"
```

This is the **same** [`finalize/dedupe.mjs`](../../../agents/pr-reviewer/scripts/finalize/dedupe.mjs)
module `finalize.mjs` runs internally on the post-verification pool, adapted (never re-implemented)
to the finder-stage record shape: an exact `(path, line, defect_class)` match, or an adjacent-line
`(path, line±2, defect_class, same 40-char claim prefix)` fuzzy match, merges two finders'
candidates into one, recording every finder that flagged it in `_also_flagged_by`. Feed the finders'
outputs in `finders.md`'s own table order (`correctness, consumer-impact, dependency, intent,
standards, quality`) so the kept record is deterministic across runs. Only `deduped.json`'s `kept[]`
proceeds to verification — the `dropped[]` are cross-finder duplicates, not findings the run is
discarding.

**`_also_flagged_by` never reaches `judgments.json`** — it is not a field
[`judgments.schema.json`](../../../agents/pr-reviewer/schemas/judgments.schema.json)'s candidate
shape defines, and `validate-judgments.mjs` rejects it as an unknown property. Pass it to the
**verifier** in step e as context instead (`N independent finders flagged this`) and let it fold
that corroboration into its own `R`/`A`/`Ac` judgment, the same way `finders.md`'s
diversify-then-vote treats a unanimous `votes` count as verifier input rather than schema data —
strip `_also_flagged_by` (and `agreement_promoted`) from the record before assembling
`judgments.json`.

### Step e — parallel verification

Dispatch one verifier sub-agent per surviving candidate (batch small groups of unrelated candidates
together where the concurrency cap makes that necessary — never batch candidates that share a path,
since [`finding-verifier.md`](../../../agents/shared/rules/finding-verifier.md)'s adversarial framing
depends on seeing one claim at a time). Each verifier receives **only** the candidate record, the
workspace, and `impact.json` — never the finder's reasoning, never the other candidates, per
`finding-verifier.md`'s own exclusion table. Each returns the four-way verdict
(`confirmed`/`contradicted`/`ambiguous`/`unobtainable`) plus the `R`/`A`/`Ac` scores, `severity`,
`prefix`, `blocking`, `title`, `body`, `materiality`, and `category` — the remaining fields
`judgments.schema.json`'s candidate shape requires — written to `verdicts/<n>.json`. A `contradicted`
candidate is dropped here and never reaches `judgments.json`, with its contradicting evidence logged
per `finding-verifier.md`'s own rule.

### Step f — assemble, validate, finalize, write

One synthesis pass — a dedicated sub-agent, or the orchestrator itself; both are permitted, and
which one ran belongs in the run-mode line the same way `finding-verifier.md`'s own sub-agent
question does — does the parts of `judgments.json` no finder or verifier produces: `gate1`
(description-vs-diff), `gate5` (docs), `gate4` (the AI-stub pre-candidate dispositions, via
[`gate4-scan.mjs`](../../../agents/pr-reviewer/scripts/gate4-scan.mjs)'s own output already sitting
in `context.json`), and the open-thread classifications
([`thread-resolution.md`](../../../agents/shared/rules/thread-resolution.md), Step 2.9c). Assemble
these together with every surviving verified candidate into one `judgments.json` matching
[`judgments.schema.json`](../../../agents/pr-reviewer/schemas/judgments.schema.json).

Then the same three steps every `pr-reviewer` run takes, unchanged:

```bash
node "$AGENT_SUPPORT/pr-reviewer/scripts/validate-judgments.mjs" "<scratchRoot()>/<run-id>/judgments.json"
node "$AGENT_SUPPORT/pr-reviewer/scripts/finalize.mjs" \
  --context "<scratchRoot()>/<run-id>/context.json" \
  --judgments "<scratchRoot()>/<run-id>/judgments.json" \
  --out-dir "<scratchRoot()>/<run-id>/finalize"
```

`validate-judgments.mjs` exits non-zero on a schema violation and stops the run there — a malformed
`judgments.json` is a synthesis bug, not something `finalize.mjs` should try to interpret. Once
`finalize.mjs` has written `write-plan.json`, execute it exactly as `pr-reviewer.md` Step 4 does:
`execute-write-plan.mjs` where a `gh` access path exists, or the write-plan's ops walked one by one
against the `mcp__github__*` / `mcp__lorekit__*` mapping in
[`rules/pipeline.md`](../../../agents/pr-reviewer/rules/pipeline.md#write-plan-op--mcp-tool-map)
where it does not — resolved once, per [`github-access.md`](../../../agents/shared/rules/github-access.md)
Step 0, never per op.

**`--dry-run` stops before this execution step, exactly as it does for the agent.** The rendered
`report-body.md`, `inline/*.md`, and `write-plan.json` are written to scratch and nothing is posted —
[`rules/pipeline.md`](../../../agents/pr-reviewer/rules/pipeline.md#--dry-run) owns the full contract
this orchestration inherits unchanged.

**Steps d–f's mechanical glue is proven offline** in
[`scripts/eval/fanout-glue.mjs`](../../../scripts/eval/fanout-glue.mjs) (`--self-test`): a raw
finder-candidate fixture (with a cross-finder duplicate) through the real
`finalize.mjs --dedupe-candidates`, a deterministically stubbed verifier pass standing in for the
one dispatch this orchestration cannot exercise without a model, an assembled `judgments.json`,
and the real `validate-judgments.mjs` and `finalize.mjs` — through both writers. No live model
call; only the finder's and the verifier's own judgment are stubbed.

### Step g — concurrency cap

Batch every dispatch wave (finders + lenses in Step c, verifiers in Step e) in groups of
**`PR_REVIEW_MAX_PARALLEL` — default 6** — concurrent sub-agent dispatches at a time, never more.
This exists for the same reason `diversify-then-vote`'s N is a small fixed number rather than
"as many as helpful": a PR review dispatching one sub-agent per finding on a large diff can burst
past a harness's or GitHub's own rate limits, and a burst that gets throttled mid-run is worse than
a queued batch that finishes slightly later. Six finders plus up to four lenses is already at the
default cap for Step c's own wave on a `deep`-tier run; Step e's verifier wave batches similarly for
a diff with more than six surviving candidates.

### The default-flip gate

Single-dispatch `pr-reviewer` stays the default, and `--fanout` stays opt-in, until the fan-out
topology has been shown not to cost detection quality — fan-out is the one change in this pipeline
that moves the **judgment topology** itself (each finder now reasons in an isolated context instead
of one model producing all six passes in sequence), which can move recall and precision in either
direction and cannot be waved through by inspection. The documented gate: **arm B's (fan-out) recall
is ≥ arm A's (single-dispatch) and precision is ≥ arm A's − 0.05, measured across ≥ 8 manifest PRs at
N ≥ 3 runs each.** Flipping the default is a follow-up once that evidence exists, not a decision made
in this document.

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

```bash
node agents/pr-reviewer/scripts/fingerprint.mjs build \
  --finder <finder> --defect-class <class> --symbol <symbol|-> --path <repo-relative path>
```

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
| [`/review-changes <PR>`](../review-changes/SKILL.md) | yes | yes | yes | yes, via `review-loop` |
| [`/review-changes <PR> --report`](../review-changes/SKILL.md) | yes | no | no | no |
| [`review-loop`](../review-loop/SKILL.md) | yes | yes | yes | yes, cap 5, converges on threads + CI |
| [`/polish`](../polish/SKILL.md) | yes | mechanical only | no | no — one pass each |

`/pr-review <PR>` and `/review-changes <PR> --report` reach the same place by design.
This command is the direct name for it, and it is what the agent's own description, `depth-routing.md`,
and `memory.md` all already tell the user to type; `--report` stays a flag on the convergence
command for people already there.

## Hard rules

- **Read-only, always.** This command never edits a file, never commits, never pushes, and never resolves a thread. Applying is [`/implement-suggestion`](../../workflow/implement-suggestion/SKILL.md); applying-and-converging is [`review-loop`](../review-loop/SKILL.md).
- **Never write to GitHub.** The agent posts its own sticky report and inline findings. This skill adds a terminal summary only — a second comment would duplicate a report that is rewritten in place precisely so a PR does not accumulate copies.
- **Dispatch via the sub-agent dispatch tool, never `Skill()`.** `pr-reviewer` is an agent; `Skill("pr-reviewer", …)` errors with `Unknown skill`. The tool is named `Task` in some harnesses and `Agent` in others — use the one this session has.
- **One dispatch per invocation. Do not loop.** Re-reviewing an unchanged head produces the same report at full cost.
- **Absent sub-agent dispatch is a skip, not a fallback — and it is a CAPABILITY test, not a name test.** Conclude it only when no available tool dispatches a sub-agent under any name; the absence of `Task` alone is not evidence. Then never review in this context and label it a `pr-reviewer` review, and never retry the dispatch.
- **Never validate the pass-through flags.** Forward the tail verbatim; the agent owns that grammar and rejects what it does not know.
- **Never re-adjudicate the verdict.** Report `PASS` / `WARN` / `FAIL` as returned, with the blocking findings named.
- **`remember` writes an `fp`-keyed rule or asks.** A prose-slug key is unreadable by the read path and must never be invented to make a write appear to succeed.
- **`remember` cannot suppress a `standards` or `(blocking)` finding.** Refuse and name the reason; those exemptions belong to [`memory.md`](../../../agents/pr-reviewer/rules/memory.md#two-findings-memory-may-never-suppress) and this command only restates them.
