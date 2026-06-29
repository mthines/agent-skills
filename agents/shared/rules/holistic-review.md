---
title: Holistic review — intent match + system fit (default on)
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - holistic-analysis
  - intent
  - system-fit
---

# Holistic review

Line-level rubrics (`code-quality`, `ux`, `critical`, lenses) evaluate each hunk locally. They cannot catch two classes of failure that matter most:

1. **Intent mismatch** — the diff does not implement what its PR description claims.
2. **System fit** — the change makes sense in isolation but is wrong in the bigger picture (callers in a loop, missing cache invalidation, neighbouring patterns it diverges from, contract breaks the local view doesn't see).

This rule routes both checks through `Skill("holistic-analysis", "review")`, which returns 0–3 structured findings. Findings flow through the rest of the pipeline (`finding-grounding`, `per-comment-confidence`, `comment-shape`, `conventional-comments`) like any other rubric output.

## Default-on, opt-out via `--no-holistic`

Holistic review runs on **every** invocation of `reviewer` or `pr-reviewer` unless explicitly disabled. The token cost is real (~20–60 s and one extra `Skill()` call per PR), but PR review is async and the value asymmetry is large: catching one system-fit bug is worth dozens of unnecessary holistic runs.

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
HIGH_STAKES=$(git diff --name-only origin/main...HEAD | grep -E '/(auth|billing|payments|migrations|infra)/' | head -1)

if [[ "$LINES_CHANGED" -lt 10 ]] && [[ -z "$HIGH_STAKES" ]]; then
  echo "trivial-skip"
fi

# Whitespace-only check
WHITESPACE_ONLY=$(git diff -w --shortstat origin/main...HEAD | grep -c "0 insertions\|0 files changed")

# Test-only check
NON_TEST_FILES=$(git diff --name-only origin/main...HEAD | grep -vE '(\.test\.|\.spec\.|/test/|/tests/|/__tests__/)' | head -1)
```

Any single trivial-skip condition triggers skip. If in doubt, run holistic — the cost of a redundant run is bounded; the cost of a missed system-fit bug is not.

## When to run (the call)

After the rubrics produce raw findings and **before** Step 2.5 (Dedupe + consolidate), so holistic findings participate in dedupe and can collide-and-win against line-level findings on the same `(file, line)`. The new step is **2.4 Holistic review** in both agents.

```
Skill("holistic-analysis", "review")
  intent_summary: <2–3 lines from Step 1.3>
  diff: <full unified diff>
  changed_files: <list of {path, patch} entries from /tmp/pr-files.json or git>
  caller: "reviewer" | "pr-reviewer"
```

Inputs:

- `intent_summary` — produced by Step 1.3 of the calling agent.
- `diff` — full unified diff (already in scope by Step 1.1).
- `changed_files` — list of file objects with `path` and `patch`. In `pr-reviewer`, `/tmp/pr-files.json` is the source. In `reviewer`, derive from `git diff --name-only` + `git show`.
- `caller` — the calling agent's name (`reviewer` or `pr-reviewer`). Determines the recommended Conventional-Comments category mapping (see below).

## Targeted escalation (Step 2.4b)

The Step 2.4 pass above is **broad and shallow**: one whole-PR scan, capped at 3 findings, spreading attention across the entire diff. It catches PR-wide intent mismatch and obvious system-fit, but it cannot deep-trace any single changed function's call graph. That deep trace is exactly the class the user cares about — *a function change that is clean in isolation but wrong for how the function is actually used*.

Step 2.4b adds the deep tier. It runs **after** the broad 2.4 pass and the rubric findings are collected, and **before** Step 2.5 (dedupe). It takes the line-level findings that look context-dependent and fans out **parallel, single-target** holistic traces — one per finding — each scoped to that finding's symbol via the `focus` input (see `review-mode.md § Inputs`). This is the pipeline analogue of an agentic reviewer that "decides which areas need deeper investigation and follows code paths across files."

It is **default-on for `pr-reviewer`** and **opt-in for `reviewer`** (the `--escalate` flag). It is suppressed by `--no-escalate` (finer than `--no-holistic`, which also skips 2.4) and skipped wholesale when 2.4 itself was trivial-skipped.

### Selection (the agentic decision point)

Walk the collected findings (both the rubric output and the broad 2.4 findings). Select a finding for escalation only if **all** hold:

1. It sits on a **changed export** — a function, method, class, hook, or component defined (or signature-changed) in the diff. Not a local variable, comment, or string literal.
2. Its correctness is **context-dependent** — at least one of: a return-type change, a newly thrown / rejected error, a side-effect-ordering change, caching or transaction semantics, a signature / contract change, a loop-or-batch caller — **OR** the symbol has **≥ 2 call sites** (cheap `grep -c` of the symbol across the repo).
3. It is **not** an already-high-confidence trivial nit (style, naming, formatting).

A finding that fails any test is left untouched and flows on to 2.5 as-is. Selection is logged.

### Fan-out (the parallel mechanism)

For each selected finding, emit one `Skill("holistic-analysis", "review")` call **with a `focus` block**. Emit the calls **in a single turn** so they run concurrently — this is the parallelism; no `Task` tool is required, and both agents already have `Skill`.

```
# one call per selected finding, all emitted together
Skill("holistic-analysis", "review")
  intent_summary: <from Step 1.3>
  diff: <full unified diff>
  changed_files: <from /tmp/pr-files.json or git>
  caller: "reviewer" | "pr-reviewer"
  focus:
    file: <finding file>
    line: <finding RIGHT-side line>
    symbol: <changed export name>
    finding: <the line-level claim being deepened>
```

Each focused call returns **≤ 1 finding** — the verdict on the seeded finding (`confirm` / `enrich` / `reshape` / `clear`; see `review-mode.md § Phase R2`). A `clear` returns nothing and the original line-level finding is **dropped** (the context proved it a false positive — this is the signal-to-noise win, not a loss).

### Cost bound

Escalate up to **10** findings per PR, highest-severity first. Ten — not three — because a focused single-symbol trace is far cheaper than the broad whole-PR pass, and the real ceilings already live downstream: the per-file cap (5 for `pr-reviewer`, 10 for `reviewer`), the total cap (20 for `pr-reviewer`), and the `per-comment-confidence` ≥ 80 gate that drops weak findings regardless of how many were escalated. If more than 10 qualify, run a **second parallel batch**; stop only once the surviving-comment total would exceed the posting cap (further findings cannot be posted anyway). Never silently drop a qualifying candidate — defer it and log it.

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

`holistic-analysis` returns at most 3 findings with `type` ∈ {`intent-mismatch`, `scope-creep`, `system-fit`} and `severity` ∈ {`blocker`, `major`, `minor`}.

Map each finding to the calling agent's Conventional-Comments category:

| Caller | Holistic type | Category | Severity |
| --- | --- | --- | --- |
| `reviewer` (own work) | `intent-mismatch` | `issue` | blocker |
| `reviewer` | `system-fit` (major) | `issue` | blocker |
| `reviewer` | `system-fit` (minor) | `suggestion` | non-blocker |
| `reviewer` | `scope-creep` | `nitpick` | non-blocker |
| `pr-reviewer` (cross-review) | `intent-mismatch` | `issue` | blocker |
| `pr-reviewer` | `system-fit` (any severity) | **`question`** | non-blocker |
| `pr-reviewer` | `scope-creep` | `question` | non-blocker |

**Why the framing differs.** In `reviewer`, the agent is reviewing your own work — you have context but may have a blind spot; an assertion ("this needs cache invalidation") is the right shape. In `pr-reviewer`, the agent has *less* context than the PR author; a question ("Does this need to invalidate the cache when admin endpoints write to the user table?") respects that asymmetry and reads as collaborative, not as bot-knows-better.

## Wiring into the rest of the pipeline

Holistic findings are not exempt from the downstream gates:

1. **dedupe + consolidate** (`rubric-composition.md § Consolidation`) — holistic findings enter the same dedupe pass as rubric findings; on a `(file, line)` collision with a line-level finding, the holistic claim wins (broader context).
2. **finding-grounding** — every backticked symbol must grep-resolve in the changed file or in a caller surfaced during Phase R1.
3. **per-comment-confidence** — `Skill("confidence", "code")` ≥ 80, same threshold as line-level findings.
4. **comment-shape** — ≤ 240 chars, ≤ 2 sentences. A holistic finding that needs more space than this either (a) gets trimmed once and re-checked, or (b) gets dropped and listed in the terminal Quality Gate summary so the user can paste manually.

A holistic finding that survives all four gates is emitted as a card in the local proposal (`pr-reviewer`) or the Self-Review report (`reviewer`).

## Blocking verdict

Only `intent-mismatch` findings can drive a "Request changes" verdict, via the existing "Misimplemented intent" category in the strict blocking-finding rules. `system-fit` and `scope-creep` are advisory regardless of severity — they emit findings, but do not block the verdict.

This is intentional. System-fit findings are powerful but more error-prone than line-level checks; gating "Request changes" on them would propagate any holistic false-positive into a hard block. Intent-mismatch is the only holistic class strict enough to block.

## Logging

The Quality Gate summary in the terminal output reports:

```
Holistic review:
  Status:             ran | skipped (trivial diff) | skipped (--no-holistic)
  Findings produced:  0–3
  Drops:              <N> at grounding / <M> at confidence / <K> at shape
  Final:              <F> emitted
```

A run that ran holistic and emitted 0 findings is healthy — most PRs have neither intent mismatch nor obvious system-fit gaps. A run that emitted 3 findings on a 5-file PR is suspicious — verify the holistic skill's output before posting.

## When holistic is unavailable

If `Skill("holistic-analysis", "review")` returns an unknown-mode error (skill version predates the `review` mode), log once and continue without the step:

```
Holistic review: skipped (holistic-analysis skill predates `review` mode — update the skill to enable)
```

Do not block the run. Holistic review is an enhancement; the rest of the pipeline still produces useful comments.

## What this rule does not do

- It does not run holistic itself. It dispatches to the skill, accepts the structured findings, and routes them through the pipeline.
- It does not set the blocker rules — those live in each agent's verdict step.
- It does not change the per-file cap (5 for `pr-reviewer`, 10 for `reviewer`) — holistic findings count against the same cap; if dedupe consolidates a holistic finding with a line-level finding on the same file:line, the holistic claim wins (it has the broader context).
