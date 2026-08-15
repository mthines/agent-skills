---
title: Rubric composition — load, dedupe, consolidate
impact: HIGH
tags:
  - pr-reviewer
  - rubric
  - multi-skill
---

# Rubric composition

`pr-reviewer` loads multiple review rubrics: `code-quality` (always for substantive diffs), `ux` (UI files), `critical` (high-stakes diffs or `--critical`), and up to 3 user-supplied lenses via `--with`.

Without a consolidation step, each rubric emits findings independently and the agent has to inline-dedupe while also writing comments. Research grounding: Qodo's 2026 "Rule System" and Greptile's multi-agent architecture both add an explicit coordinator pass — the consolidation step is what turns multi-rubric findings from noise into signal.

## Load order

Strict order so dedup is deterministic:

1. `code-quality` (always, unless diff is trivial — single-line typo, ≤ 5 line whitespace fix).
2. `ux` (UI globs: `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `app/**/*.{ts,tsx}` for App-Router screens).
3. `critical` (`--critical` flag OR auto-engage heuristic — see below).
4. `--with` lenses (max 3, in the order given on the command line).

## Auto-engage heuristics for `critical`

| Heuristic | Rationale |
| --- | --- |
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
- Same `(file, line)` AND different prefix → keep both; humans benefit from seeing both lenses.
- Adjacent lines (`|line_a - line_b| ≤ 2`) AND same prefix AND same first 40 chars of body → **drop the new one** (likely the same finding, different rubric named it differently).

Dedupe runs **before** the per-comment confidence check (`per-comment-confidence.md`) — no point scoring a duplicate.

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

Everything above the inline caps goes into a **Deferred** list, rendered in the review body under an `Additional findings` section, one line each:

```text
- `src/api/client.ts:214` — issue: retry loop re-sends the request body after a 413. (confidence 92)
```

Rules:

- A finding that cleared 2.7 is **never** silently discarded. Deferral is the only overflow behaviour.
- **A `(blocking)` finding is never in the deferred list** — it is always inline (see the cap-exemption above), so the `Additional findings` section holds only non-blocking overflow.
- Each deferred entry carries file, line, prefix, the one-line body, and the confidence score.
- Deferred entries are excluded from `INLINE_COMMENTS_JSON` — they are body text, so they neither consume inline slots nor enlarge the review payload.
- Report the count as `Deferred (over inline cap): <N>` in the Quality Gate summary.
- On the next incremental run the deferred list is carried forward — see [`prior-comment-awareness.md § Carry-forward of deferred findings`](./prior-comment-awareness.md#carry-forward-of-deferred-findings).

Rationale for the inline cap: a PR comment with 12 inline annotations on the same file reads as a hostile review even when every individual finding is correct.
The 2026 CodeRabbit / Greptile field guide flags > 5 comments per file as the threshold above which authors start to dismiss the review wholesale.
That is an argument about **inline density**, not about how much the reviewer is allowed to report — hence deferral rather than a drop.

### Materiality routing

Non-blocking findings carry a **materiality** dimension, orthogonal to confidence: a finding can be correct (high confidence) and still not be worth surfacing.

- **material** — asserts a real defect the author would want to fix: a test or coverage gap, a *wrong* or *misleading* comment, doc, or name, a factual error, or a genuine simplification.
- **cosmetic** — asserts no defect, only a preference about *form*: wording parity between surfaces ("spell it out like the sibling"), reflow, whitespace, formatting, or restating the same rule more verbosely.

Cosmetic findings are the **lowest-priority** non-blocking findings: within their prefix they sort last in placement (§ Placement), so they are the last to occupy a scarce inline slot and the first to overflow the caps into `Additional findings`.
This routing needs no new counter and no new body section: it reuses the ordering and deferral the caps already apply.

On `incremental` and `incremental-quick` runs whose `REVIEW_DIFF` touches only Markdown (`.md` / `.mdx`) or comment lines, a cosmetic `nitpick` or `suggestion` is **dropped as noise**, the same disposition and accounting `per-comment-confidence.md` gives a below-bar nitpick, rather than posted.
This is the exact case where an inline cosmetic nit otherwise spawns another on the next push, because the reviewer re-runs on every push and aligning surface A makes sibling B read as uneven.
Dropping it breaks that cascade without a new counter or body section, and it still appears in the uncapped Step 3 terminal report.
A *factual* doc error is material and posts normally, and blocking findings are never cosmetic.

## Severity mapping

Each rubric uses its own severity vocabulary. Map to the 5-category Conventional-Comments enum once, here:

| Source rubric | Severity | Category |
| --- | --- | --- |
| `code-quality` | error / blocking | `issue` |
| `code-quality` | warn / non-blocking | `suggestion` |
| `code-quality` | info / nit | `nitpick` |
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
