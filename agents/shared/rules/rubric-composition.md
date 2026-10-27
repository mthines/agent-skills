---
title: Rubric composition — load, dedupe, consolidate
impact: HIGH
tags:
  - pr-reviewer
  - rubric
  - multi-skill
---

# Rubric composition

`pr-reviewer` loads multiple review rubrics: `quality` (always for substantive diffs — the inline checklist under [Load order](#load-order)), `ux` (UI files), the `animations` lens (diffs that add motion), `critical` (high-stakes diffs or `--critical`), and up to 3 user-supplied lenses via `--with`.

Without a consolidation step, each rubric emits findings independently and the agent has to inline-dedupe while also writing comments. Research grounding: Qodo's 2026 "Rule System" and Greptile's multi-agent architecture both add an explicit coordinator pass — the consolidation step is what turns multi-rubric findings from noise into signal.

## Contents

- [Load order](#load-order)
- [Auto-engage heuristics for `critical`](#auto-engage-heuristics-for-critical)
- [Dedupe](#dedupe)
- [Cross-rubric agreement](#cross-rubric-agreement)
- [Consolidation pass](#consolidation-pass)
- [Placement (Step 2.9b)](#placement-step-29b)
- [Memory suppression (`pr-reviewer`)](#memory-suppression-pr-reviewer)
- [Severity mapping](#severity-mapping)
- [A lens cannot block on its own](#a-lens-cannot-block-on-its-own)

---

## Load order

Strict order so dedup is deterministic:

1. `quality` (always, unless diff is trivial — single-line typo, ≤ 5 line whitespace fix).
   Walk each changed hunk against this checklist:
   - **Readability:** the code reads top-to-bottom in one pass; no comment restates what the code does.
   - **Nesting:** no `if` nested 3 or more levels deep where guard clauses would flatten it.
   - **Naming:** names state intent (`pendingOrders`, not `data2`).
   - **Duplication and reuse:** no new helper or block that duplicates an existing one in the repo.
   - **Neighbour patterns:** the change matches the structure and conventions of neighbouring files.
   - **Approach:** is there a materially simpler approach or an existing utility that does this?
     Flag it as a `suggestion:` naming the simpler approach or the utility's `path:line`; never flag a matter of taste.
2. `ux` (UI globs: `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `app/**/*.{ts,tsx}` for App-Router screens).
3. `animations` lens — only when the motion gate below prints `MOTION_DIFF: yes`.
4. `critical` (`--critical` flag, OR `context.reviewConfig.critical == "always"`, OR auto-engage heuristic — see below).
   `--no-critical` suppresses the config and the heuristic.
5. `--with` lenses (max 3, in the order given on the command line); `--with animations` is a no-op when step 3 loaded it.

### The motion gate (step 3)

Run the deterministic detector against the full PR's patches in every run mode, never the incremental delta; never decide from file names or by reading the diff yourself.
Motion anywhere in the PR loads the lens, so an incremental run never loses it.
Read the patches from `context.paths.files` (the `prepare-review.mjs` sidecar, one JSON object per line), else `/tmp/pr-files.json` when this run did its own Step 1.2 fetch.
`<animations>` is the installed skill directory: `$HOME/.claude/skills/animations`, or `$AGENT_SKILLS_ROOT/skills/animations` on Agent0 ([`agent0-host.md`](./agent0-host.md)).

```bash
CONTEXT="<the --context path this run received, or empty>"   # review-context.json from prepare-review.mjs
PR_FILES=$(jq -r '.paths.files // empty' "$CONTEXT" 2>/dev/null); PR_FILES=${PR_FILES:-/tmp/pr-files.json}
if OUT=$(node "<animations>/scripts/is-motion-diff.mjs" --patches-json "$PR_FILES"); then
  MOTION_FILES=$(head -1 <<< "$OUT")   # JSON: the files the lens walks
  MOTION=$(tail -1 <<< "$OUT")         # MOTION_DIFF: yes|no
fi                                     # exit 2 → the skip row below
```

| Output | Do |
| --- | --- |
| `MOTION_DIFF: yes` | Read `<animations>/lens.md` — that file only, never the skill's `SKILL.md` or `rules/` — and walk its checklist against the files in `MOTION_FILES`. Announce `Auto-loading animations lens: <n> files with motion.` |
| `MOTION_DIFF: no` | Load nothing; announce nothing. |
| script or `lens.md` absent, or exit 2 | Skip the lens and announce `animations lens: skipped (<reason>)`. A motion diff reviewed without it is a smaller review, not a wrong one. |

```text
✅ RIGHT — the detector prints MOTION_DIFF: yes for `+ transition: width 300ms` → read lens.md, flag the layout-property animation.
❌ WRONG — reading animations/SKILL.md "for context", or loading the lens because a file is named Modal.tsx.
```

The lens's findings are tagged `[lens:animations]` and follow the `any lens` severity mapping below.

## Auto-engage heuristics for `critical`

| Heuristic | Rationale |
| --- | --- |
| `critical: always` in the base commit's review config (`context.reviewConfig.critical`) | The repo opted every review into the pre-mortem ([`review-config.md` § Run-level knobs](./review-config.md#run-level-knobs)) |
| Path matches `**/migrations/**`, `**/migrate/**`, `**/prisma/migrations/**` | Schema / data migrations are not easily reverted |
| Path matches `**/auth/**`, contains `authz`, `rbac`, or `iam` | Security-sensitive |
| Path matches `**/billing/**`, `**/payments/**`, `**/stripe/**` | Money-touching |
| Path matches `**/infra/**`, `terraform/`, `helm/`, `kustomize/` | Shared infrastructure |
| PR labelled `risk:high` or `breaking-change` | Author-flagged |
| Diff > 800 lines changed | Attention budget exceeded |

Announce auto-engagement in one line: `Auto-engaging critical: <reason>.` User can suppress with `--no-critical`.

## Dedupe

Walk findings in load order. For each new finding, if a prior finding has:

- Same `(file, line)` AND same Conventional-Comments prefix → **drop the new one**, append `(also flagged by <new-rubric>)` to the prior body.
  The annotation is added only when the new finding came from a **different** rubric; a rubric repeating its own finding is a duplicate, not agreement.
- Same `(file, line)` AND different prefix → keep both; humans benefit from seeing both lenses.
- Adjacent lines (`|line_a - line_b| ≤ 2`) AND same prefix AND same first 40 chars of body → **drop the new one** (likely the same finding, different rubric named it differently).
- **Distinct claims never merge.** When both findings carry claim text and their claim-token Jaccard similarity is below `0.21` (the calibrated floor in the semantic pass below), keep both, even at the same `(file, line)` with the same prefix.
  A/B round 3 lost a verified finding at confidence 96.5 this way: two different defects confirmed on one line merged on the anchor alone.
  A finding with no claim text keeps the anchor-only rule, since there is nothing to compare.

Dedupe runs **before** the per-comment confidence check (`per-comment-confidence.md`) — no point scoring a duplicate.

**The SEMANTIC pass over the pre-verification pool (plan feat/pr-reviewer-shrink-fanout-ab, D5).** The rule
above requires the SAME Conventional-Comments prefix, which independent finders can never
satisfy for the same underlying defect: pre-verification, the prefix stand-in is each finder's own
`defect_class`, and finders name the same issue differently by construction (`edge-case` vs.
`contract-break` vs. `scope-creep` vs. `missing-update` — the real failure on dash0hq/dash0#20230,
where one issue posted as four separate findings). `finalize/dedupe.mjs`'s `semanticDedupe()` runs
as a SECOND pass, after the exact/adjacent pass above, over a
pre-verification candidate pool only (`finalize.mjs --dedupe-candidates`) (`dedupeCandidates()`, never `finalizeReview()`'s
post-verification path): two candidates merge iff same `path`, both `symbol` non-null and equal,
both `line` within 3 of each other, and a claim-token Jaccard similarity `>= 0.21` (calibrated on
the real run: true duplicates scored 0.23–0.46, every distinct pair on the same path scored
`<= 0.19`; 0.21 is the midpoint of that gap). Grouping is the single-linkage transitive closure of those pairwise matches
(union-find), so a candidate bridging two clusters merges both and the partition does not depend
on input order; the kept representative is picked by a total order (highest `severity_hint`, then
earliest `line`, then lexical `finder` / `defect_class` / `claim`), so it does not either. The kept
record carries a `_semantic_merged` entry per merged candidate as an audit record for the report
only — the verifier sees the representative alone, never the merged members.
**Never agreement-promoted** — a semantic merge is a lower-confidence, threshold-calibrated
heuristic match, not the exact `(file, line, prefix)` agreement the section below defines, and
promoting it would change `## Cross-rubric agreement`'s threshold semantics on the strength of a
pass no live run has verified against that rubric.

## Cross-rubric agreement

After the dedupe pass, walk the surviving findings. For each finding that was
retained (not dropped) in the dedupe pass with an `(also flagged by <rubric>)`
annotation — meaning ≥ 2 rubrics independently fingerprinted the same
`(file, line)` with the same Conventional-Comments prefix — mark the finding
as **agreement-promoted**.

Agreement-promoted findings use a lowered `per-comment-confidence` drop threshold
of **70** (instead of the default **80 → 70**) when the finding reaches the
per-comment-confidence gate. Single-rubric findings keep the 80 threshold.

The count of agreement-promoted findings is tracked for the Quality Gate log as
`agreement-promoted: <N>`. A run with `agreement-promoted: 0` is healthy — most
PRs will not have multi-rubric overlap.

**Threshold reference:**
- Default (single-rubric): ≥ 80 (`per-comment-confidence.md` standard)
- Agreement-promoted (multi-rubric): ≥ 70 (this section)
- Tuning fallback: raise to 75 if noise emerges in practice

## Consolidation pass

After dedupe, run one explicit consolidation step:

1. Group surviving findings by file.
2. Within a file, sort by `(prefix priority, line)`. Prefix priority: `issue > suggestion > question > nitpick > praise`.
3. **No cap fires here.** Consolidation orders findings; it never discards them.
   Every surviving finding continues to the quality gates (2.6 grounding → 2.6b receipt → 2.7 confidence → 2.8 shape), and only those gates may drop one.
4. **Collapse parity findings across sibling surfaces.**
   When a finding's basis is *cross-surface consistency* — "X is documented but sibling Y is not", "spell out the rule like the neighbour does", the same constant, rule, or annotation restated in several places — emit **one** finding that enumerates every surface to align, never one finding per surface.
   A consistency finding must grep its sibling surfaces before it is emitted and name all of them.
   Reporting the first instance alone makes the author fix surface A, which then reads as uneven against surface B on the next review, and because the reviewer re-runs on every push, that is a self-perpetuating cascade of one cosmetic round per commit.
   The single enumerated finding is fixed once, and the cascade never starts.

**Why the cap is not here.** Capping at 2.5 discarded findings *before* they were scored.
A correct, high-confidence finding could lose its slot to a weaker one that the 2.7 confidence gate then dropped anyway — so the review posted fewer findings than its own cap allowed, and the loss was invisible.
Quantity now governs **placement**, never survival.

## Placement (Step 2.9b)

Runs last, after every quality gate.
Its input is the set of findings that already cleared grounding, receipt, confidence, and shape — every one of them is worth telling the author about.
Placement decides *where* each finding is shown. It discards nothing.

| Surface | Inline per file | Inline total | Overflow behaviour |
| --- | --- | --- | --- |
| `pr-reviewer` Step 3 terminal report (both relations) | unlimited | unlimited | n/a — print every finding |
| `pr-reviewer` Step 4 GitHub review (both relations) | **N per profile (non-blocking only)** (`chill` 3 / **`balanced` 5** / `assertive` 7) | **20 (non-blocking only)** | **Deferred**, never dropped — listed in the review body |

**Blocking findings are exempt from both caps.** A finding decorated `(blocking)` (`conventional-comments.md`) — broken behaviour, security, data loss, or misimplemented intent — is **always** posted inline and is **never** deferred, regardless of the per-file or the total cap. The caps govern **non-blocking** findings only.
This is the point of the caps: they exist to stop a wall of nitpicks reading as a hostile review, not to hide a blocker. A genuinely weak PR should surface *every* blocker at the code, however many there are — capping those would bury exactly the findings the author most needs to see. Only non-blocking overflow is deferred to the body.

Ordering — blocking findings are placed first (never deferred), then the remaining inline slots are filled by non-blocking findings under the caps, applied per file and then globally:

1. Prefix priority: `issue > suggestion > question > nitpick`.
2. Then **material** before **cosmetic** (§ Materiality routing), so a scarce inline slot goes to a real defect before a matter of form.
3. Then descending `per-comment-confidence` Final score.
4. Then ascending line number.

The split is terminal-vs-GitHub, not self-vs-cross.
`pr-reviewer` runs the identical pipeline in both relations (Step 0.5) and always posts at Step 4, so the inline caps apply to every run.
The Step 3 terminal report is uncapped in both relations: local output has no posting cost and no hostile-review effect, so the confidence threshold is the only thing that decides what the author sees there.

### Deferred findings (`pr-reviewer`)

Everything above the inline caps goes into a **Deferred** list, rendered in the review body's `<N> more findings` accordion, one table row each ([`report-rendering.md`](../../pr-reviewer/rules/report-rendering.md)):

```markdown
| ⚪&nbsp;**5** | issue: retry loop re-sends the request body after a 413.<br><sub>Confidence 92</sub> | `src/api/client.ts:214` |
```

Rules:

- A finding that cleared 2.7 is **never** silently discarded. Deferral is the only overflow behaviour.
- **A `(blocking)` finding is never in the deferred list** — it is always inline (see the cap-exemption above), so the more-findings accordion holds only non-blocking overflow.
- Each deferred entry carries file, line, prefix, the one-line body, and the confidence score.
- Deferred entries are excluded from `INLINE_COMMENTS_JSON` — they are body text, so they neither consume inline slots nor enlarge the review payload.
- Report the count as `Deferred (over inline cap): <N>` in the Quality Gate summary.
- On the next incremental run the deferred list is carried forward — see [`prior-comment-awareness.md § Carry-forward of deferred findings`](./prior-comment-awareness.md#carry-forward-of-deferred-findings).

Rationale for the inline cap: a PR comment with 12 inline annotations on the same file reads as a hostile review even when every individual finding is correct.
The 2026 CodeRabbit / Greptile field guide flags > 5 comments per file as the threshold above which authors start to dismiss the review wholesale.
That is an argument about **inline density**, not about how much the reviewer is allowed to report — hence deferral rather than a drop.

### Memory suppression (`pr-reviewer`)

An `active suppress` relevance rule is applied **here**, at placement, on findings that have already
cleared the verifier — never at find time and never before the confidence gate.

The ordering is the whole point:

| Suppressed before verification | Suppressed at placement |
| --- | --- |
| a candidate nobody looked at | a **verified** finding this repo has repeatedly declined |
| possibly a real defect, dropped on a fingerprint match | a recorded maintainer preference |

Two findings are **never** suppressible by memory, however many times they have been declined:

- A **`standards`** finding. The repo's own written rule outranks its reviewers' fatigue; the remedy for repeated dismissals is to change the governing doc, and this agent does not get to make that call.
- A **`(blocking)`** finding. It always posts, with the rule match surfaced as context instead of applied — "previously declined on #88, #91 — re-raised because blocking."

A memory suppression is a **pre-placement drop** of a cleared finding, so unlike every other drop in
this rule it *is* a drop of something that cleared 2.7. It is therefore counted separately in the
Quality Gate summary as `Memory suppressions: <N>` and each one is listed in the report's `Memory`
block with its rule id and the evidence PRs, exactly so the `<CL> − <DEF> == <F>` identity stays
auditable rather than quietly absorbing them. A suppression that cannot name its evidence PRs is a
bug, not a preference — see [`memory.md`](../../pr-reviewer/rules/memory.md).

### Materiality routing

Non-blocking findings carry a **materiality** dimension, orthogonal to confidence: a finding can be correct (high confidence) and still not be worth surfacing.

- **material** — asserts a real defect the author would want to fix: a test or coverage gap, a *wrong* or *misleading* comment, doc, or name, a factual error, or a genuine simplification.
- **cosmetic** — asserts no defect, only a preference about *form*: wording parity between surfaces ("spell it out like the sibling"), reflow, whitespace, formatting, or restating the same rule more verbosely.

Materiality changes routing in two ways, neither of which touches the `<CL> − <DEF> == <F>` identity.

At **placement** (§ Placement), material findings sort before cosmetic ones within a prefix, so a scarce inline slot goes to a real defect first and cosmetic findings overflow into `Additional findings` first.
This is an ordering tiebreak only: it drops nothing and defers nothing new.

On `incremental` and `incremental-quick` runs whose `REVIEW_DIFF` touches only Markdown (`.md` / `.mdx`) or comment lines, a cosmetic `nitpick` or `suggestion` is **dropped at the filtering stage** (2.3), before it reaches the confidence gate, and logged as a `Materiality drops` count.
Because it never clears 2.7 it never enters `<CL>`, so the identity holds and the "a cleared finding is never silently discarded" rule (§ Deferred findings) — which governs findings that *did* clear — is not engaged.
This is a pre-clearing drop, the same disposition class as a `review-config` filter suppression, not a drop of a cleared finding at placement.
It targets the exact case where an inline cosmetic nit otherwise spawns another on the next push, because the reviewer re-runs on every push and aligning surface A makes sibling B read as uneven.
A *factual* doc error is material and is never dropped, and blocking findings are never cosmetic.

## Severity mapping

Each rubric uses its own severity vocabulary. Map to the 5-category Conventional-Comments enum once, here:

| Source rubric | Severity | Category |
| --- | --- | --- |
| `quality` | error / blocking | `issue` |
| `quality` | warn / non-blocking | `suggestion` |
| `quality` | info / nit | `nitpick` |
| `ux` | Critical | `issue` |
| `ux` | High | `issue` |
| `ux` | Medium | `suggestion` |
| `ux` | Low | `nitpick` |
| `critical` | Must-fix | `issue` |
| `critical` | Should-fix | `suggestion` |
| `critical` | Nice-to-have | `nitpick` |
| any lens | Must-fix | `issue` |
| any lens | Should-fix | `suggestion` |
| any lens | Nice-to-have | `nitpick` |

`praise` and `question` are never produced by a rubric — they only come from the agent's first-pass review.

## A lens cannot block on its own

Mapped `issue` from a lens still goes through the blocking-finding rules in the agent's verdict step. A lens-only blocker does not cause "Request changes" — only the strict set (broken behaviour, security, data loss, misimplemented intent) does.
