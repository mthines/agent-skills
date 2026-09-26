---
name: pr-review
description: >
  One-shot read-only review of a GitHub PR — dispatches the `pr-reviewer` agent and
  reports its verdict and findings without touching your code. The short entry point
  for "review this PR" when you do not want an apply-and-converge loop. Also writes
  maintainer relevance rules via `/pr-review remember <fact>`. Invoke with /pr-review.
disable-model-invocation: true
argument-hint: '[<pr-url>|#<n>] [--fanout] [--critical] [--full] [--effort high] [--thoroughness 0..1] [--with a,b,c] [--no-holistic] [--no-escalate] [--no-optimize] [--no-standards] [--skip-gates] [--fix-links] | remember <fact>'
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
spelled `Task` in the Claude Code CLI and `Agent` in the Claude Agent SDK harness behind Claude Code
on the web; a name-literal check reports "unavailable" on every session that spells it the other
way, even though the capability is present. Use whichever tool this session exposes that takes a
`subagent_type` (or equivalent agent-name) parameter.

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

### Worker preamble — every dispatch in Steps c, e, and f

Every sub-agent this orchestration dispatches — each finder and lens in Step c, each verifier in
Step e, and synthesis in Step f when it runs as its own dispatch — gets the SAME preamble prepended
to its prompt, verbatim:

```text
You are a worker in this pipeline's parallel orchestration, not the full pr-reviewer agent.
- Read ONLY the file(s) named below, by their ABSOLUTE path — never a bare relative path; your
  cwd is not guaranteed to be this repo's checkout.
- Do NOT read agents/pr-reviewer.md. It is the full agent's own document; you are one step of its
  pipeline, dispatched with exactly the context that step needs, and reading it would re-derive
  context this orchestration already isolated you from (and burn the tokens doing it).
- Do NOT call Skill() for anything this orchestration already resolved for you (deduping, the
  shape caps, rendering). Read the rule file(s) you were given instead.
- Read the review packet first (context.packet.path): the PR description and every hunk widened
  against the head file, with head line numbers you cite directly. Open a workspace file only for
  what it does not show — a caller, a definition, or a file its index marks "listed".
- Write your JSON output to the path you were given. Return ONLY that path in your final message
  — never the payload inline. The orchestrator reads the file from disk; a payload returned as
  text spends context neither side needs to spend, and is the difference between a worker costing
  tens of KB and one costing a few hundred bytes.
```

This is the one thing the fan-out orchestration's own dispatch prompts CAN still shrink, even
though they cannot touch what the harness auto-loads per session (`scripts/eval/benchmarks/README.md
§ Base overhead` — the ~245 KB `agents/pr-reviewer.md` and the repo's own `CLAUDE.md` are both
harness-loaded, not dispatch-prompt content). An explicit read-list plus a forbidden-file rule is
what stops a worker from re-reading the full agent document on top of whatever the harness already
loaded for that session.

### Step a — build the review context

Run [`prepare-review.mjs`](../../../agents/pr-reviewer/scripts/prepare-review.mjs) exactly as
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
  verdicts/<batch-id>.json          # step e, one file per verifier batch
  judgments.json                    # step f
  finalize/…                        # finalize.mjs --out-dir
```

Each dispatched sub-agent **writes its JSON to that path and returns only the path** — never the
payload inline. A finder or verifier's full output can run to tens of KB; returning it as the
dispatch result would spend the orchestrator's own context on data it only needs to hand to the next
mechanical step, exactly the cost this whole pipeline exists to cut.

**`--review-sha <sha>` pass-through.** When the orchestration is invoked with `--review-sha <sha>`
in its own argument tail, forward it to `prepare-review.mjs` verbatim, together with the
`--isolated` flag it requires alongside it and `--dry-run` (mandatory for the whole run, not just
this step, since a historical context is never current enough to post a write against). This is a
pass-through, not a re-implementation: `prepare-review.mjs` owns `--review-sha`'s verification and
its `--isolated`/`--pin-head` refusals (`rules/pipeline.md#--review-sha`), and this orchestration's
only job is to route the flag through to Steps a and f unmodified and to never construct a
historical run that omits `--dry-run`.

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
- the review packet (`context.packet.path`, written by `prepare-review.mjs`), which each finder reads
  before opening any workspace file;
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
resolved — no separate wave. Holistic review, optimality, and measurability run together in **one
lens-bundle dispatch** for whichever of the three are active; standards-conformance is its own
dispatch ([`dispatch-topology.md § Packing`](../../../agents/pr-reviewer/rules/dispatch-topology.md#packing--how-units-become-dispatches)
owns the grouping and why):

| Lens | Runs at | Dispatch | Rule |
| --- | --- | --- | --- |
| holistic review | default ON in `full` mode; shape-gated in incremental | lens bundle | [`holistic-review.md`](../../../agents/shared/rules/holistic-review.md) |
| optimality | `deep` only | lens bundle | [`optimality-review.md`](../../../agents/shared/rules/optimality-review.md) |
| measurability | `deep` and `standard` | lens bundle | [`measurability-review.md`](../../../agents/shared/rules/measurability-review.md) |
| standards-conformance | `deep` and `standard` | its own | [`standards-conformance.md`](../../../agents/shared/rules/standards-conformance.md) |

The lens bundle receives each active lens's rule file and runs them one after another, never letting
one lens's output inform another's.
Each lens's output lands at `lenses/<lens>.json` — the bundle writes one file per lens it ran — and
feeds `judgments.lenses.*` at assembly (Step f), unchanged from how `pr-reviewer.md` already shapes
that object.

**`standards-conformance` (a lens, Step c) and `standards` (a finder, also Step c) are two separate
dispatches, never one folded into the other.** One live arm-C run merged them — ran the
governing-docs check once and used its output for both — which is a deviation from the pipeline
this section documents, not a shortcut it condones: the finder answers "does this diff violate a
written rule" per `finders.md`'s pre-verification candidate shape, the lens answers the same
governing-docs question but through `standards-conformance.md`'s own lens contract feeding
`judgments.lenses.standards`, and `report-rendering.md` reads both independently. Dispatch both,
every run.

**Lens instruction — `optimality`'s `card_body` carries no heading.** Tell the optimality lens
dispatch explicitly: write `card_body` as the proposal's prose only, with no leading
`### Optimality proposal — <path>:<line>` line — `finalize/payload.mjs`'s `buildOptimalityCard()`
builds that heading itself from the candidate's own `path`/`line` fields and strips a leading
echoed one from `card_body`, so an instruction that lets the lens omit it from the start avoids
relying on the strip path at all.

### Step d — deterministic dedupe

Concatenate every `candidates/<finder>.json` file and run:

```bash
node agents/pr-reviewer/scripts/finalize.mjs \
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

**A second, semantic pass runs after the exact/adjacent one, on the survivors.** Different finders
describe the same defect in different words far more often than they describe it at the same
`(path, line, defect_class)` — the exact/adjacent pass above catches the second, not the first.
`finalize/dedupe.mjs`'s `semanticDedupe()` groups candidates that share a path, a resolvable and
matching `symbol`, a line within 3, and a Jaccard token-set overlap over its own calibrated
threshold on the `claim` + `bad_outcome` text; the surviving head record carries a
`_semantic_merged` array (one entry per merged member: `finder`, `defect_class`, `line`, `claim`)
that is an **audit record only**: it stays on `deduped.json` for the report, is stripped before
assembly, and is **never handed to the Step e verifier and never counted as agreement**. The
verifier gets the representative candidate alone — showing it the merged members would show it
other finders' claims (excluded by `finding-verifier.md`), and counting them would be the
cross-finder promotion `rubric-composition.md ## Dedupe` forbids for a heuristic match.

### Step e — parallel verification

Plan the verifier batches from `deduped.json`'s `kept[]`, then dispatch one verifier sub-agent per
batch:

```bash
node agents/pr-reviewer/scripts/plan-dispatch.mjs \
  --verifier-batches "<scratchRoot()>/<run-id>/deduped.json"
```

Each batch holds at most `VERIFY_BATCH_MAX` (8) candidates.
**Never batch candidates that share a path** into one dispatch, since
[`finding-verifier.md`](../../../agents/shared/rules/finding-verifier.md)'s adversarial framing
depends on seeing one claim at a time.
A batched verifier judges each candidate as if it were the only one, in the order given, and writes
`verdicts/<batch-id>.json` as `{ "candidates": [...] }` — one entry per candidate in its batch. **This is a hard rule, not a preference: one live arm-C run
batched several same-path candidates into one verifier dispatch to save a wave, and it is a
deviation from the pipeline this section documents — batching by path is exactly the shared-summary
problem `finders.md`'s independence rule already forbids at the finder stage, moved one step
downstream, and it makes the verifier quieter on each claim in the batch instead of adversarial on
one.** Two candidates that share a path always land in different verifier dispatches, each batched with
*unrelated-path* candidates only, never with each other; `plan-dispatch.mjs` guarantees it. Each verifier receives **only** the
candidate record, the workspace, and `impact.json` — never the finder's reasoning, never the other
candidates, per `finding-verifier.md`'s own exclusion table; a semantically merged candidate is
verified as its representative alone, its `_semantic_merged` members withheld. Each returns the
four-way verdict (`confirmed`/`contradicted`/`ambiguous`/`unobtainable`) plus the `R`/`A`/`Ac`
scores, `severity`, `prefix`, `blocking`, `title`, `body`, `materiality`, and `category` — the
remaining fields `judgments.schema.json`'s candidate shape requires — written to its batch's
`verdicts/<batch-id>.json`.
A `contradicted` candidate is dropped here and never reaches `judgments.json`, with its
contradicting evidence logged per `finding-verifier.md`'s own rule.

**Every verifier dispatch's prompt includes the live shape caps, pasted verbatim — never
restated as fixed numbers in this document**, since a number copied into prose here would drift the
moment `comment-spine.mjs`'s constants change and nothing would catch it:

```bash
node agents/pr-reviewer/scripts/comment-spine.mjs --shape-caps
```

Paste that command's output into the verifier's prompt (alongside the worker preamble) so `title`,
`body`, `evidence[]`, and the fenced-suggestion line cap it produces are checked against the caps
the renderer will actually enforce, not against a value someone remembered.

### Verifier self-check — appended to every verifier dispatch in Step e

The caps above tell a verifier what the limits are; this block makes it check its own file against
them before it returns.
In A/B round 1 the orchestrator hand-trimmed 6 verifier bodies on one arm and 16 on another, because
nothing ran the renderer's shape check until every verifier had already returned.
Append this block, verbatim, after the worker preamble and the pasted shape caps in every verifier
dispatch, with `<REPO>` replaced by the absolute path of this repository's checkout and `<OUT>` by
the verifier's own output path:

```text
Before you return, self-check the file you wrote:
  node <REPO>/agents/pr-reviewer/scripts/validate-judgments.mjs --shape-only <OUT>
- Exit 0 with "OK" on stdout: return <OUT>.
- Exit 1: stderr names each violation by candidate index and field. Edit ONLY the named fields in
  <OUT>, then run the command again.
- At most 2 fix-and-rerun rounds (3 runs in total). If the third run still exits 1, return <OUT>
  followed by one line: SHAPE-UNRESOLVED: <first stderr line>.
- Exit 2 (the check itself could not run): return <OUT> followed by one line:
  SHAPE-CHECK-UNAVAILABLE: <first stderr line>.
- Never change verdict, severity, blocking, R, A, or Ac to make the check pass, and never delete a
  candidate. The check governs how a finding is written, not whether it is true.
- One named exception: "blocking": true requires severity high or critical. That is the severity
  crosswalk, not a shape rule. Re-apply it: raise the tier only if the base impact is broken
  behaviour, security, data loss, or misimplemented intent; otherwise set blocking to false.
```

`--shape-only` validates each candidate against `judgments.schema.json`'s `$defs.candidate`, the
candidate-level domain rules, and `finalize.mjs`'s own `checkShape()`, imported rather than copied.
It needs no `gates`/`threads`/`memory` wrapper, which a single verifier's output never has.
It accepts the two shapes a verifier writes: a bare JSON array of candidates, or
`{ "candidates": [...] }`.
A file holding one bare candidate object is rejected, so `<OUT>` always holds an array, even for a
single candidate.
The bound is two rounds for the same reason Step f allows one repair round: a verifier that
miscounted against a cap it was given fixes it in one pass, and one that cannot follow the
instruction will not fix it in a fifth.
A `SHAPE-UNRESOLVED` or `SHAPE-CHECK-UNAVAILABLE` line changes nothing downstream.
Step f's `--check-shape` pre-flight and `finalize.mjs`'s `coerceShape()` routing still run on every
candidate, so a verified finding is still never dropped over its shape.

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

Then, before the three steps every `pr-reviewer` run takes, one this orchestration adds because it
is the only path where verifiers write shape-bearing prose in N independent, un-cross-checked
dispatches:

```bash
node agents/pr-reviewer/scripts/finalize.mjs --check-shape "<scratchRoot()>/<run-id>/judgments.json"
```

`--check-shape` runs every candidate's `title`/`body`/`evidence[]` through the real
`render-comment.mjs` shape validation and reports each violation's `index`, `finder`, and `field`
without writing anything. **On a violation, re-dispatch only the named verifier(s)** — one repair
round, with the caps pasted (Step e) and the specific violation named in the prompt — then re-run
`--check-shape` once more. There is exactly one repair round, never a loop — one catches a
verifier that miscounted against a cap it was given; a second would be chasing a verifier that
cannot follow the instruction. **A candidate still violating shape after that round is never
dropped**: a verified
finding is not less true for a 61-char title. Proceed to `finalize.mjs`, which routes it
mechanically — a **non-blocking** one lands in the report body's deferred section (`N more
findings`) instead of inline, and a **blocking** one posts inline with a renderer-legal truncated
title and body (`coerceShape()`: the claim, severity, and blocking flag never change; a fix fence
is removed rather than truncated into a wrong patch). If even that cannot render, the blocker joins
the deferred section and Gate 6 still FAILs on it. Every such routing is listed in
`finalize`'s `shapeCoerced[]`.

Then the same three steps every `pr-reviewer` run takes, unchanged:

```bash
node agents/pr-reviewer/scripts/validate-judgments.mjs "<scratchRoot()>/<run-id>/judgments.json"
node agents/pr-reviewer/scripts/finalize.mjs \
  --context "<scratchRoot()>/<run-id>/context.json" \
  --judgments "<scratchRoot()>/<run-id>/judgments.json" \
  --out-dir "<scratchRoot()>/<run-id>/finalize"
```

`validate-judgments.mjs` exits non-zero on a schema violation and stops the run there — a malformed
`judgments.json` is a synthesis bug, not something `finalize.mjs` should try to interpret.
`validate-judgments.mjs` also calls `finalize.mjs`'s own `checkShape()` (the same function
`--check-shape` above wraps — imported, never a second copy of its caps), so a candidate a schema
alone would let through — an over-`PROSE_MAX` `body` with no `maxLength` in the schema, or
`evidence_anchors` on a one-liner prefix, both real A/B round-1 workarounds — now fails validate
too, on EVERY run, not only a `--fanout` one that reached the pre-flight above. The pre-flight is
still worth running first here: it names which VERIFIER to re-dispatch, one repair round, before
assembly — `validate-judgments.mjs` only tells the orchestrator the assembled file is unpostable.
Once
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
a queued batch that finishes slightly later.
Step c's wave on a `deep`-tier run is up to eight finder dispatches (three `correctness` votes) plus
the lens bundle and the standards-conformance lens, so it already spans two messages; Step e's
verifier batches queue the same way.
Send the next message only after every dispatch in the current one has returned, dispatch each unit
exactly once, and retry a unit only once when it returned no readable output file —
[`dispatch-topology.md § Packing`](../../../agents/pr-reviewer/rules/dispatch-topology.md#packing--how-units-become-dispatches)
owns those rules and the expected sub-agent count per thoroughness band.
`plan-dispatch.mjs` prints the messages in the order to send them.

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
