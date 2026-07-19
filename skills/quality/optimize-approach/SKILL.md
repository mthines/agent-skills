---
name: optimize-approach
description: >
  Reviews whether a change takes the most optimal approach for its stated
  intent and, when it does not, researches the code, validates a concretely
  better approach via holistic analysis, and either proposes it (report mode)
  or applies it behind a confidence gate (apply mode). Judges four axes —
  codebase-fit, simplicity, performance, robustness — at the approach level,
  deferring line-level and failure-mode findings to code-quality, critical,
  and holistic-review. Stays silent when the approach is already optimal
  (quiet early-exit). A `plan` mode reviews a drafted plan's approach at plan
  time (aw-planner Phase 1) — the cheapest moment to switch. Called by the
  reviewer and pr-reviewer agents, the polish skill, and aw-planner as a
  default-on lens; also runnable standalone. Triggers on
  "is this the best approach", "better way to do this", "is this optimal",
  "optimize this approach", "rethink the approach", "/optimize-approach".
disable-model-invocation: false
argument-hint: '[report|apply|plan] [--no-confidence-gate]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory
  tags:
    - optimize-approach
    - review
    - optimality
    - better-approach
    - intent
    - refactor
    - auto-fix
    - self-improvement
---

# Optimize Approach

Given a change and its intent, decide whether it takes the **most optimal approach** — and if not, propose or apply a concretely better one.

This skill is the fourth review lens in this repo, distinct from the three that already exist:

| Lens | Question | Applies? |
| --- | --- | --- |
| `holistic-analysis` review | Does the diff *do what it claims* and *fit the system*? | No |
| `critical` | How could this *fail*? | No |
| `code-quality` simplify | Can this be *mechanically* simpler? | Yes — Class M only |
| **`optimize-approach`** *(this skill)* | Is this the *most optimal approach*, and if not what is? | Yes — gated |

> **This `SKILL.md` is a thin index.** Detailed rules live in `rules/*.md` and load on demand.

---

## Mode Detection

Parse the **first token** of `$ARGUMENTS`.

| Mode | Default | Trigger | What it does |
| --- | --- | --- | --- |
| `report` | **yes** | No mode token, or `report` | Emit a structured proposal (or nothing when optimal). Never edits files. |
| `apply` | | First token `apply` | Same analysis, then apply the top proposal behind a confidence gate. Own-work contexts only. |
| `plan` | | First token `plan` | Review a drafted plan's approach at plan time (aw-planner Phase 1). Returns plan-level proposals; the planner revises the plan. See [`rules/plan-mode.md`](./rules/plan-mode.md). |

## Flags

| Flag | Applies to | Effect |
| --- | --- | --- |
| `--no-confidence-gate` | `apply` | **Human-only override.** Bypasses the `confidence(code) ≥ 90 %` gate for a single `apply` run. Reserved for explicit human slash invocations — a calling agent (`reviewer`, `polish`, `aw-planner`) **never** sets it. The other apply-mode guards are **not** waived: `apply_safe`, the forbidden-targets list, the scoped check, and revert-on-failure all still apply. See [`rules/apply-mode.md`](./rules/apply-mode.md). |

## Inputs

When a calling agent (reviewer / pr-reviewer / polish) invokes this skill, it passes:

- `intent_summary` — 2–3 line intent (the caller's Step 1.3 output).
- `diff` — the full unified diff under review.
- `changed_files` — list of `{path, patch}` entries.
- `caller` — `reviewer` | `pr-reviewer` | `polish` | `aw-planner` (affects framing and whether apply is allowed).

For `plan` mode the caller (`aw-planner`) passes a drafted plan's approach and its Existing Code Survey verdicts instead of a diff — see [`rules/plan-mode.md`](./rules/plan-mode.md) for that input shape.

Standalone (`/optimize-approach [report|apply]`) derives the diff-mode inputs from the current branch diff against `origin/main`.

## Workflow

| Phase | Name | Rule file | Gate |
| --- | --- | --- | --- |
| O0 | Read lessons | [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md) | Fast-tier read; skips silently if `persistent-memory` absent |
| O1 | Intent capture | this file | 1–2 line intent per changed approach unit |
| O2 | Optimality judgment | [`rules/optimality-rubric.md`](./rules/optimality-rubric.md) | Verdict `optimal` \| `suboptimal` per the 4-axis rubric + materiality bar |
| O3 | Quiet early-exit | [`rules/optimality-rubric.md`](./rules/optimality-rubric.md) | If `optimal`, return empty and stop |
| O4 | Deep understanding | this file + [`rules/optimality-rubric.md`](./rules/optimality-rubric.md) | `Skill("holistic-analysis", "refactor")` + `confidence(analysis)` on the alternative |
| O5 | Deliver | [`rules/report-mode.md`](./rules/report-mode.md) / [`rules/apply-mode.md`](./rules/apply-mode.md) | Report a proposal, or apply behind `confidence(code) ≥ 90 %` |

### O1 — Intent capture

Use `intent_summary` verbatim when supplied.
Standalone, derive it from PR title / body / commit messages / branch name.
For a multi-file diff, name each distinct **approach unit** (one cohesive way of solving one sub-goal) — the judgment in O2 runs per unit, not per line.

### O2 — Optimality judgment

Score each approach unit against the four axes in [`rules/optimality-rubric.md`](./rules/optimality-rubric.md): codebase-fit, simplicity, performance, robustness.
Reach one verdict per unit: `optimal` or `suboptimal`.
A unit is `suboptimal` **only** when a materially better alternative exists and clears the anti-overlap and materiality bars in the rubric — otherwise it is `optimal`.

### O3 — Quiet early-exit

If every approach unit is `optimal`, return an empty finding list and stop.
Silence on a well-built change is the expected outcome, not a failure — it is the same "quality over quantity" contract the reviewer agents follow.
Still run the O5 end-of-run lesson write (a clean run is recurrence evidence for any lesson applied in O0).

### O4 — Deep understanding (suboptimal units only)

Before proposing, understand the change completely — never propose a "better way" from a shallow read.

1. Grep the relevant files, callers, and any existing utility or pattern the alternative would reuse.
2. Invoke `Skill("holistic-analysis", "refactor")` to trace the execution path of the affected unit and generate + compare approaches.
3. Gate the chosen alternative on `Skill("confidence", "analysis")`.
   Below 90 %, downgrade the finding to a `question` (report) or drop the apply (report instead) — never apply an approach change the analysis is unsure about.

### O5 — Deliver

- **report mode** → emit the proposal per [`rules/report-mode.md`](./rules/report-mode.md).
- **apply mode** → apply the top proposal per [`rules/apply-mode.md`](./rules/apply-mode.md), behind `confidence(code) ≥ 90 %`, scoped check, and revert-on-failure.

Then run the fast-tier lesson write + promotion check in [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md).

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files |
| --- | --- |
| O0, O5 | [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md) |
| O2, O3, O4 | [`rules/optimality-rubric.md`](./rules/optimality-rubric.md) |
| O5 (report) | [`rules/report-mode.md`](./rules/report-mode.md), [`templates/proposal.template.md`](./templates/proposal.template.md) |
| O5 (apply) | [`rules/apply-mode.md`](./rules/apply-mode.md) |
| plan mode | [`rules/plan-mode.md`](./rules/plan-mode.md) — approach review at plan time (aw-planner Phase 1) |
| wiring | [`agents/shared/rules/optimality-review.md`](../../../agents/shared/rules/optimality-review.md) — how the review agents call this skill |
| diagnose | [`rules/diagnostic-surface.md`](./rules/diagnostic-surface.md) |

## Self-Improvement

This skill runs a two-tier self-improvement loop keyed by the `optimize-approach-lessons` scope.
The fast tier (`persistent-memory`) reads lessons at O0 and writes them at O5 to calibrate the optimal-vs-suboptimal bar and the apply-safety judgment.
A lesson reaching `seen_count >= 3` becomes promotion-eligible for the slow tier (`/create-skill diagnose optimize-approach`).
Full contract: [`rules/self-improvement-loop.md`](./rules/self-improvement-loop.md).

## Core Principles

1. **Approach-level only.** Judge the *shape of the solution*, not lines. Line-level cleanups belong to `code-quality`; failure modes to `critical`; intent/system-fit to `holistic-review`.
2. **Silence is the default outcome.** Most changes are already optimal enough — say nothing rather than manufacture a "better way".
3. **Understand before proposing.** A proposal requires a holistic trace and a `confidence(analysis)` gate — never a shallow "you could also…".
4. **Apply only behind the gate.** An approach rewrite is applied only at `confidence(code) ≥ 90 %`, scoped to the diff's files, with revert-on-failure. Otherwise it is proposed, not applied.
5. **Never block the verdict.** An optimality proposal is advisory (`suggestion` / `question`), like `scope-creep` — it never drives "Request changes".

## Anti-patterns (one-liners — full list in the rules)

- Proposing a "better way" that just restates a `code-quality` mechanical refactor.
- Manufacturing a suboptimal verdict on a change that clears the materiality bar.
- Applying an approach change across files outside the diff, or without the confidence gate.
- Emitting more than the cap of proposals — approach review is quality-over-quantity.
- Blocking the review verdict on an optimality finding.

## Definition of Done

- [ ] Verdict reached per approach unit (`optimal` → empty; `suboptimal` → proposal).
- [ ] Every `suboptimal` proposal carries a holistic trace and a `confidence(analysis)` score.
- [ ] apply mode gated on `confidence(code) ≥ 90 %` + scoped check + revert-on-failure.
- [ ] Fast-tier lesson write + promotion check ran at O5.
