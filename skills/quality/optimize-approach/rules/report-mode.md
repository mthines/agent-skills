---
title: Report Mode — structured optimality proposal
impact: HIGH
tags:
  - optimize-approach
  - report
  - proposal
  - findings
---

# Report Mode

The default mode. Emit a structured proposal for each `suboptimal` approach unit, or nothing when every unit is `optimal`.
Report mode **never edits files** — it is the only mode used by `pr-reviewer` (cross-review) and the report path of the standalone command.

## Contents

- [Output cap](#output-cap)
- [Proposal record](#proposal-record)
- [Caller-aware framing](#caller-aware-framing)
- [Terminal output (standalone)](#terminal-output-standalone)
- [What report mode does not do](#what-report-mode-does-not-do)

## Output cap

Return at most **2** proposals per invocation, highest-impact first, and bias hard to **1**.
"What would be a better way?" is usually singular — a diff with three independent suboptimal approaches is rare, and above two the output reads as nitpicking.
If more than two units qualify, emit the top two and note the count of deferred units in one line.

## Proposal record

Each proposal is a structured record the calling agent consumes (parallel to `holistic-analysis` review-mode findings):

```yaml
- verdict: suboptimal
  axis: codebase-fit | simplicity | performance | robustness
  file: <path of the diff hunk most relevant to the unit>
  line: <RIGHT-side line number, or 0 if the unit is whole-file-scoped>
  headline: <imperative ≤ 12-word TL;DR — "do X instead of Y", the card's one-line summary>
  intent: <one sentence — what this approach unit is trying to achieve>
  current_approach: <one sentence — how the diff does it now>
  better_approach: <one to two sentences — the concretely better way>
  why_better: <one sentence tied to the firing axis>
  trade_off: <one sentence — the cost the switch introduces (what gets worse/harder/riskier), or "none material">
  evidence: <the existing util / pattern / caller / complexity fact that proves it — must grep-resolve or be a stated measurable>
  blast_radius: <files or call sites a switch would touch>
  analysis_confidence: <confidence(analysis) score from O4>
  apply_safe: <true | false — mechanical enough to auto-apply AND contained to the diff's files AND no public-API change>
```

The `headline` and `trade_off` fields make the card **decision-ready**: the headline gives the reader a one-line scan, and `trade_off` states the cost so "is this objectively better?" is answerable from the card alone. A proposal with no honest trade-off reads as a sales pitch — write `none material` when the switch genuinely costs nothing, never omit it.

When every unit is `optimal`, return an **empty list** plus a single marker line: `verdict: optimal — no materially better approach found`.
The empty result is a healthy outcome, not an error.

The `evidence` field is load-bearing: a proposal without a grep-resolvable util/pattern/caller or a stated measurable fact (complexity, query count) is unfounded — drop it rather than emit it.

## Caller-aware framing

A proposal is **not** a Conventional-Comments finding.
The calling agent renders it as a card in a dedicated report section, never as an inline comment — the full structured record does not survive a 240-character comment (see [`optimality-review.md § Where proposals surface`](../../../../agents/shared/rules/optimality-review.md)).

| Caller | Surface | Framing |
| --- | --- | --- |
| `pr-reviewer` (either relation) | `Optimality review` section of the GitHub review body | Ask: "Have you considered …?" |

`pr-reviewer` frames every proposal as a question unconditionally, in both relations, regardless of confidence — its Step 2.4c and `OPTIMALITY_SECTION` note carry no relation branch (`agents/pr-reviewer.md`).
The question framing respects the review context asymmetry (the reviewer has less context than the author).

An optimality proposal is **always non-blocking** — it never drives "Request changes", the same rule `holistic-review` applies to `scope-creep`.
Below 85 % `analysis_confidence` the proposal is dropped here, in this skill (the alternative is not understood well enough to assert as objectively better).
The bar is deliberately high: a proposal that surfaces is a claim the current approach *should* change, and a hedged "you could maybe also…" at 78 % is noise, not signal — silence costs nothing, a weak "better way" costs trust.
That is the **only** confidence gate a proposal passes: the calling agents do not re-score it with `per-comment-confidence`, and the card prints `analysis_confidence` so the reader can weigh it.

## Terminal output (standalone)

For `/optimize-approach report`, print each proposal as a card from [`../templates/proposal.template.md`](../templates/proposal.template.md), followed by a one-line summary:

```text
Optimality: <N> proposal(s) · <units> unit(s) judged · <O> optimal · <D> deferred (> cap)
```

A run that judged several units and emitted 0 proposals prints `Optimality: no materially better approach found` — the quiet early-exit outcome.

## What report mode does not do

- **It does not edit files.** That is apply mode ([`apply-mode.md`](./apply-mode.md)).
- **It does not score per-comment confidence for the caller.** The caller runs its own `confidence(code)` gate downstream; report mode supplies `analysis_confidence` from O4 only.
- **It does not block.** The verdict decision stays with the calling agent; optimality proposals are advisory.
- **It does not re-derive intent or system-fit findings.** Those are `holistic-review`'s output — see the anti-overlap guards in [`optimality-rubric.md`](./optimality-rubric.md).
