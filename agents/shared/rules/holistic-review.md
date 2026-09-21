---
title: Holistic review — intent match + system fit (default on)
impact: HIGH
tags:
  - pr-reviewer
  - holistic-analysis
  - intent
  - system-fit
---

# Holistic review

Line-level rubrics (`code-quality`, `ux`, `critical`, lenses) evaluate each hunk locally. They cannot catch two classes of failure that matter most:

1. **Intent mismatch** — the diff does not implement what its PR description claims.
2. **System fit** — the change makes sense in isolation but is wrong in the bigger picture (callers in a loop, missing cache invalidation, neighbouring patterns it diverges from, contract breaks the local view doesn't see).

This rule routes both checks through `Skill("holistic-analysis", "review")`, which returns structured findings — every one that clears the severity floor in § When to run, with no count budget. Findings flow through the rest of the pipeline (`finding-grounding`, `per-comment-confidence`, `comment-shape`, `conventional-comments`) like any other rubric output.

## Contents

- [Default-on, opt-out via `--no-holistic`](#default-on-opt-out-via---no-holistic)
- [Trivial-skip set](#trivial-skip-set)
- [When to run (the call)](#when-to-run-the-call)
- [Targeted escalation (Step 2.4b)](#targeted-escalation-step-24b)
- [Relationship to the consumer-impact finder](#relationship-to-the-consumer-impact-finder)
- [Output mapping (caller-aware)](#output-mapping-caller-aware)
- [Wiring into the rest of the pipeline](#wiring-into-the-rest-of-the-pipeline)
- [Blocking verdict](#blocking-verdict)
- [Logging](#logging)
- [When holistic is unavailable](#when-holistic-is-unavailable)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Default-on, opt-out via `--no-holistic`

Holistic review is **default-on** for `pr-reviewer` in `full` mode. The token cost is real (~20–60 s and one extra `Skill()` call per PR), but PR review is async and the value asymmetry is large: catching one system-fit bug is worth dozens of unnecessary holistic runs.

Five conditions decide whether the broad pass runs, and each skip has its own logged token. A skip that cannot name its own reason is indistinguishable from a clean run, which is the whole point of the third column:

| Condition | Behaviour | Logged `Status` |
| --- | --- | --- |
| `--no-holistic` passed | Skip | `skipped (--no-holistic)` |
| `TRIVIAL_SKIP` (Step 1.7b) is true | Skip | `skipped (trivial diff)` |
| Step 1.8 token-economy skip (≥ 3 failing gates) | Skip | `skipped (gates)` |
| `RUN_MODE` is `incremental` or `incremental-quick` | Skip | `skipped (incremental)` |
| None of the above | Run | `ran` |

The last two are **not** interchangeable with the trivial-skip row, and two other rules read the difference. Step 2.4b skips only on the *triviality* branch, so an incremental run still escalates under `ESCALATE_IN_INCREMENTAL` (§ Risky-shape incremental escalation). And the deep-lens refresh in [`depth-routing.md`](../../pr-reviewer/rules/depth-routing.md) exists precisely because the run-mode row would otherwise starve this pass forever on a PR that lands as a long series of small commits.

The flag is `--no-holistic`. Mention it in the run announcement only when set.

## Trivial-skip set

Skip the call (not the flag — the heuristic) when the diff is genuinely trivial. Skipping reports as `Holistic review: skipped (trivial diff).` in the Quality Gate summary.

| Condition | Reason |
| --- | --- |
| Pure whitespace / formatting changes | No semantics to validate |
| Dependency-bump-only PRs (`package-lock.json` + `package.json` version field, or equivalent for other ecosystems) | Intent is mechanical; system fit is the lockfile resolver's job |
| Test-only changes (no source touched) | Tests do not change system contracts |
| `< 10 lines changed` AND no path matches `**/auth/**`, `**/billing/**`, `**/payments/**`, `**/migrations/**`, `**/infra/**` | Below this threshold, holistic-analysis over-engages |

Heuristic implementation:

```bash
LINES_CHANGED=$(git diff --shortstat origin/main...HEAD | grep -oE '[0-9]+' | head -1)
# (^|/) matters: git paths carry no leading slash, so an interior-only '/token/' regex
# misses a TOP-LEVEL auth/ or migrations/ directory entirely. In pr-reviewer this whole
# check is superseded by the shape classifier's output (PR_HIGH_STAKES_FILES /
# PR_RISKY_SHAPES from agents/pr-reviewer/scripts/classify-shape.mjs — the single source
# of the high-stakes list); this grep is the reference fallback for callers without it.
HIGH_STAKES=$(git diff --name-only origin/main...HEAD | grep -E '(^|/)(auth|billing|payments|migrations|infra)(/|$)' | head -1)

if [[ "$LINES_CHANGED" -lt 10 ]] && [[ -z "$HIGH_STAKES" ]]; then
  echo "trivial-skip"
fi

# Whitespace-only check
WHITESPACE_ONLY=$(git diff -w --shortstat origin/main...HEAD | grep -c "0 insertions\|0 files changed")

# Test-only check
NON_TEST_FILES=$(git diff --name-only origin/main...HEAD | grep -vE '(\.test\.|\.spec\.|/test/|/tests/|/__tests__/)' | head -1)
```

Any single trivial-skip condition triggers skip. If in doubt, run holistic — the cost of a redundant run is bounded; the cost of a missed system-fit bug is not.

This section owns the **conditions**; it does not own their evaluation point. In `pr-reviewer` the set is evaluated exactly once, at Step 1.7b (the earliest consumer), and cached as `TRIVIAL_SKIP`; Steps 2.4, 2.4c, and 2.4d read that cache and never recompute the heuristic. The snippet above is the reference implementation of the conditions, not a per-step recomputation.

## When to run (the call)

After the rubrics produce raw findings and **before** Step 2.5 (Dedupe + consolidate), so holistic findings participate in dedupe and can collide-and-win against line-level findings on the same `(file, line)`. The new step is **2.4 Holistic review** in `pr-reviewer`.

```
Skill("holistic-analysis", "review")
  intent_summary: <2–3 lines from Step 1.3>
  diff: <full unified diff>
  changed_files: <list of {path, patch} entries from /tmp/pr-files.json or git>
  caller: "pr-reviewer"
  review_relation: "self" | "cross"
```

### No count budget — a severity floor instead

The pass returns **every** finding that clears this floor, however many that is:

| Severity | Emit |
| --- | --- |
| `blocker` | always |
| `major` | always |
| `minor` | only when it names a specific surface to change — a file, a symbol, a contract. A `minor` that generalises ("consider revisiting the caching strategy") is not a finding. |

A size-scaled count ceiling used to sit here (3 / 6 / 10 by changed-file count). It was the same defect [`rubric-composition.md § Consolidation pass`](./rubric-composition.md#consolidation-pass) removed from Step 2.5, one step earlier in the pipeline: it discarded findings **before** anything scored them, so a real blocker could lose its slot to a `minor` the 2.7 confidence gate would have dropped anyway, and the loss left no trace. Quantity is governed at placement (Step 2.9b), where overflow is **deferred** to the review body rather than dropped, and never at generation.

The floor is stated in **severity** because severity is the only bar available here. Review mode does not score — per-comment confidence runs downstream at Step 2.7 (§ What review mode does NOT do in [`review-mode.md`](../../../skills/analysis/holistic-analysis/rules/review-mode.md)) — so a generator pruning against the confidence bar would be prejudging a number it cannot compute. That is the same polarity rule [`finders.md`](../../pr-reviewer/rules/finders.md) holds every finder to: flag, and let the verifier filter.

**Cost, stated plainly.** Every emitted finding costs one Phase E verification at Step 2.6b, so removing the ceiling does raise the worst-case bill. The floor is what bounds it: a pass that emits a dozen `minor` findings on a 60-file PR has mis-set the floor, and the fix is the floor, never a ceiling that hides the mis-set by truncating it. Never pad — a clean 40-file PR returns zero findings.
Everything the pass returns re-enters the pipeline at 2.5 and is subject to grounding, receipt, confidence, and shape exactly like a rubric finding.

Inputs:

- `intent_summary` — produced by Step 1.3 of the calling agent.
- `diff` — full unified diff (already in scope by Step 1.1).
- `changed_files` — list of file objects with `path` and `patch`. Source is `/tmp/pr-files.json`, cached by `pr-reviewer` Step 1.2 in both relations.
- `caller` — always `"pr-reviewer"` (the only reviewer agent). Determines the recommended Conventional-Comments category mapping (see below).
- `review_relation` — `"self"` (own PR) or `"cross"` (someone else's PR). Determines assertion vs. question framing.

## Targeted escalation (Step 2.4b)

The Step 2.4 pass above is **broad and shallow**: one whole-PR scan spreading attention across the entire diff. It catches PR-wide intent mismatch and obvious system-fit, but it cannot deep-trace any single changed function's call graph. That deep trace is exactly the class the user cares about — *a function change that is clean in isolation but wrong for how the function is actually used*.

Step 2.4b adds the deep tier. It runs **after** the broad 2.4 pass and the rubric findings are collected, and **before** Step 2.5 (dedupe). It takes the line-level findings that look context-dependent and fans out **parallel, single-target** holistic traces — one per finding — each scoped to that finding's symbol via the `focus` input (see `review-mode.md § Inputs`). This is the pipeline analogue of an agentic reviewer that "decides which areas need deeper investigation and follows code paths across files."

It is **default-on for `pr-reviewer`** and **opt-in for `reviewer`** (the `--escalate` flag). It is suppressed by `--no-escalate` (finer than `--no-holistic`, which also skips 2.4) and skipped wholesale when 2.4 itself was trivial-skipped.

### Relationship to the consumer-impact finder

The escalation's core motive — *a function change that is clean in isolation but wrong for how the
function is actually used* — is now served **first** by the consumer-impact finder
([`finder-consumer-impact.md`](../../pr-reviewer/rules/finder-consumer-impact.md)), which traces
every changed export's callers mechanically off the impact graph and does not need a finding to
already exist before it looks.

The two are complementary, and the division is what stops them duplicating each other:

| | consumer-impact finder | 2.4b escalation |
| --- | --- | --- |
| Trigger | a changed export with ≥ 1 consumer | an existing **finding** that looks context-dependent |
| Scope | the six caller expectations, per consumer | the full execution path, entry to exit |
| Cost | one read per consumer | one holistic trace per finding |
| Finds | a caller whose expectation the diff broke | a system-fit problem no single caller shows |

So when the consumer-impact finder ran on a symbol, **do not escalate a finding about that symbol's
callers** — the trace already happened, and re-running it produces a second finding on the same
evidence for dedupe to collapse. Escalate on that symbol only for a claim the caller-expectation
list does not cover: an ordering assumption across three files, a state machine, a transaction
boundary.

Where the consumer-impact finder did **not** run — `quick` tier, or `DEPTH_CAPABILITY = diff-only`
— 2.4b is the only deep trace available and its selection rules below apply unchanged.

### Risky-shape incremental escalation

One exception to "skipped when 2.4 was skipped": in `pr-reviewer`'s incremental modes, 2.4 is
skipped by run-mode policy rather than by triviality — and a small delta can still be a dangerous
one. When Step 1.2b's shape classifier flags a **risky content shape** in the delta (concurrency,
api-contract, or schema-migration arriving by patch content rather than by path —
`ESCALATE_IN_INCREMENTAL`), 2.4b runs anyway: cap **3** traces (not 10), seeded from the rubric
and persona findings on the delta, highest-severity first — there is no broad-pass output to seed
from, and none is synthesized. Selection, fan-out, re-entry, and logging are otherwise identical.
This spends one to three focused traces to give a 15-line mutex or contract change its call-graph
check without paying for a full-mode pass; `--no-escalate` suppresses it like any other 2.4b run.

### Selection (the agentic decision point)

Walk the collected findings (both the rubric output and the broad 2.4 findings). Select a finding for escalation only if **all** hold:

1. It sits on a **changed export** — a function, method, class, hook, or component defined (or signature-changed) in the diff. Not a local variable, comment, or string literal.
2. Its correctness is **context-dependent** — at least one of: a return-type change, a newly thrown / rejected error, a side-effect-ordering change, caching or transaction semantics, a signature / contract change, a loop-or-batch caller — **OR** the symbol has **≥ 2 call sites** (cheap `grep -c` of the symbol across the repo).
3. It is **not** an already-high-confidence trivial nit (style, naming, formatting).

A finding that fails any test is left untouched and flows on to 2.5 as-is. Selection is logged.

### Fan-out (the parallel mechanism)

For each selected finding, emit one `Skill("holistic-analysis", "review")` call **with a `focus` block**. Emit the calls **in a single turn** so they run concurrently — this is the parallelism; no `Task` tool is required, and `pr-reviewer` already has `Skill`.

```
# one call per selected finding, all emitted together
Skill("holistic-analysis", "review")
  intent_summary: <from Step 1.3>
  diff: <full unified diff>
  changed_files: <from /tmp/pr-files.json or git>
  caller: "pr-reviewer"
  review_relation: "self" | "cross"
  focus:
    file: <finding file>
    line: <finding RIGHT-side line>
    symbol: <changed export name>
    finding: <the line-level claim being deepened>
```

Each focused call returns **≤ 1 finding** — the verdict on the seeded finding (`confirm` / `enrich` / `reshape` / `clear`; see `review-mode.md § Phase R2`). A `clear` returns nothing and the original line-level finding is **dropped** (the context proved it a false positive — this is the signal-to-noise win, not a loss).

### Cost bound

Escalate up to **10** findings per PR, highest-severity first. Ten — not three — because a focused single-symbol trace is far cheaper than the broad whole-PR pass, and the real ceiling lives downstream: the `per-comment-confidence` ≥ threshold gate, which drops weak findings regardless of how many were escalated. If more than 10 qualify, run a **second parallel batch**; keep batching while candidates remain and the tool budget allows. Never silently drop a qualifying candidate — defer it and log it.

The placement caps in `rubric-composition.md § Placement (Step 2.9b)` are **not** a reason to stop escalating. They only decide whether a cleared finding is posted inline or listed in the review body; nothing that clears the confidence gate is discarded, so an escalation is never wasted work.

### Re-entry into the pipeline

A `confirm` / `enrich` / `reshape` result **replaces** the original line-level finding in the stream (same `(file, line)`, now carrying caller evidence and possibly an upgraded `type`). It then flows through the unchanged downstream gates exactly like any other finding: 2.5 dedupe + consolidate → 2.6 grounding → 2.7 per-comment-confidence → 2.8 shape → 2.9 conventional-comments → (PR mode) line-validity. The escalation adds **no new gate** — it makes the existing `confidence(code)` check sharper by handing it caller evidence the line-level view never had.

Type → category mapping is the same as the 2.4 table below (caller-aware): for `pr-reviewer`, an escalated `system-fit` becomes a **`question`**, respecting the cross-review context asymmetry.

### Logging

The Quality Gate summary reports a dedicated block:

```
Targeted escalation (2.4b):
  Status:             ran | skipped (--no-escalate) | skipped (2.4 trivial-skip) | skipped (opt-in not set)
  Candidates:         <N qualifying findings>
  Escalated:          <M> in <B> batch(es)
  Deferred (>cap):    <K>
  Verdicts:           <confirm> confirm / <enrich> enrich / <reshape> reshape / <clear> clear (dropped)
```

A run with several `clear` verdicts is healthy — escalation earning its cost by removing false positives. A run where every escalation `confirm`s with no `clear` or `enrich` is suspicious; spot-check the focused traces before trusting them.

## Output mapping (caller-aware)

`holistic-analysis` returns every finding clearing the severity floor (§ No count budget), each with `type` ∈ {`intent-mismatch`, `scope-creep`, `system-fit`} and `severity` ∈ {`blocker`, `major`, `minor`}.

Map each finding to the calling agent's Conventional-Comments category:

| Caller + Relation | Holistic type | Category | Severity |
| --- | --- | --- | --- |
| `pr-reviewer` (self — own PR) | `intent-mismatch` | `issue` | blocker |
| `pr-reviewer` (self — own PR) | `system-fit` (major) | `issue` | blocker |
| `pr-reviewer` (self — own PR) | `system-fit` (minor) | `suggestion` | non-blocker |
| `pr-reviewer` (self — own PR) | `scope-creep` | `nitpick` | non-blocker |
| `pr-reviewer` (cross — someone else's PR) | `intent-mismatch` | `issue` | blocker |
| `pr-reviewer` (cross — someone else's PR) | `system-fit` (any severity) | **`question`** | non-blocker |
| `pr-reviewer` (cross — someone else's PR) | `scope-creep` | `question` | non-blocker |

**Why the framing differs.** In the `self` relation, the agent reviews your own work — you have full context but may have a blind spot; an assertion ("this needs cache invalidation") is the right shape. In the `cross` relation, the agent has *less* context than the PR author; a question ("Does this need to invalidate the cache when admin endpoints write to the user table?") respects that asymmetry and reads as collaborative, not as bot-knows-better.

## Wiring into the rest of the pipeline

Holistic findings are not exempt from the downstream gates:

1. **dedupe + consolidate** (`rubric-composition.md § Consolidation`) — holistic findings enter the same dedupe pass as rubric findings; on a `(file, line)` collision with a line-level finding, the holistic claim wins (broader context).
2. **finding-grounding** — every backticked symbol must grep-resolve in the changed file or in a caller surfaced during Phase R1.
3. **per-comment-confidence** — `Skill("confidence", "code")` ≥ 80, same threshold as line-level findings.
4. **comment-shape** — a ≤ 60-char title plus ≤ 200 chars of prose, ≤ 2 sentences. A holistic finding that needs more space than this either (a) gets trimmed once and re-checked, or (b) gets dropped and listed in the terminal Quality Gate summary so the user can paste manually.

A holistic finding that survives all four gates is emitted as a card in the review body and posted to GitHub at Step 4, in both relations. It is also printed in the Step 3 terminal report, which is uncapped in both relations.

## Blocking verdict

Only `intent-mismatch` findings can drive a "Request changes" verdict, via the existing "Misimplemented intent" category in the strict blocking-finding rules. `system-fit` and `scope-creep` are advisory regardless of severity — they emit findings, but do not block the verdict.

This is intentional. System-fit findings are powerful but more error-prone than line-level checks; gating "Request changes" on them would propagate any holistic false-positive into a hard block. Intent-mismatch is the only holistic class strict enough to block.

## Logging

The Quality Gate summary in the terminal output reports:

```
Holistic review:
  Status:             ran | skipped (trivial diff) | skipped (gates) | skipped (incremental) | skipped (--no-holistic)
  Findings produced:  <N>
  Drops:              <N> at grounding / <M> at confidence / <K> at shape
  Final:              <F> emitted
```

Every skip condition in § Default-on has a token here, and no other value is legal — a skip rendered as the nearest-fitting wrong token is how a policy skip comes to read as a triviality verdict.

A run that ran holistic and emitted 0 findings is healthy — most PRs have neither intent mismatch nor obvious system-fit gaps. The shape to spot-check is not the raw count, which no longer has a ceiling to be measured against, but the **survival ratio**: `Findings produced` well above `Final` means the pass made claims it could not ground or could not support at confidence, and that is worth reading whether it produced two or twelve. A high produced count with a high `Final` on a large diff is unremarkable.

## When holistic is unavailable

Resolution follows [`lens-invocation.md`](./lens-invocation.md): try `$HOME/.claude/skills/holistic-analysis/SKILL.md` on disk (file-presence, never an error string) before trusting any host resolution.
`holistic-analysis` is classified **enhancement** in that rule — a genuine skip is logged loudly via `RUN_ANOMALY` and the rest of the pipeline still produces useful comments; it never caps the review tier.

A local file predating the `review` mode is a distinct case from an absent one: the file-presence check passes, the in-context follow succeeds, and only then does the loaded skill itself return an unknown-mode error — no host `Skill()` call happens at all in this branch. When that happens, log the skip and move on:

```
Holistic review: skipped (holistic-analysis skill predates `review` mode — update the skill to enable)
```

Do not block the run.

## What this rule does not do

- It does not run holistic itself. It dispatches to the skill, accepts the structured findings, and routes them through the pipeline.
- It does not set the blocker rules — those live in each agent's verdict step.
- It does not change the inline placement caps (`rubric-composition.md § Placement (Step 2.9b)`) — holistic findings compete for the same inline slots, and like any other cleared finding they are deferred to the review body rather than dropped when the slots run out. If dedupe consolidates a holistic finding with a line-level finding on the same file:line, the holistic claim wins (it has the broader context).
