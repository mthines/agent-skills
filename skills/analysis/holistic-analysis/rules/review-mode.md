---
title: review mode — PR-validation flow
impact: HIGH
tags:
  - holistic-analysis
  - review
  - reviewer
  - pr-reviewer
  - intent
  - system-fit
---

# Review Mode (PR-validation flow)

`review` is a focused variant of `holistic-analysis` designed to be invoked from the `reviewer` and `pr-reviewer` agents as part of their per-PR pipeline. It validates **two orthogonal things** the line-level rubrics in those agents can't see:

1. **Intent match** — does the diff actually implement what the PR description / commit messages claim?
2. **System fit** — does the change make sense given how the changed code is used in the wider system? A function change that looks clean in isolation may be wrong in the bigger picture (callers in a loop, missing cache invalidation, neighbouring patterns it diverges from).

The output is **structured findings** the calling agent consumes — not root-cause analysis, not a plan, not a confidence score.

## Relationship to `fix` and `refactor` modes

`fix` and `refactor` walk the full 8-phase protocol in [`SKILL.md`](../SKILL.md). They share that flow because the work is the same — full context gathering, execution-path walk, hypothesis generation, plan, verify. They differ only in framing.

`review` is structurally different: different inputs (caller-supplied intent + diff, not user-supplied problem), different output (structured 3-finding YAML, not analysis report), and a streamlined 3-phase flow that skips Phases 2–8 of the main protocol. That is why it lives in its own rule file rather than inline.

## Inputs

The calling agent passes:

- `intent_summary` — 2–3 line summary the reviewer produced at its Step 1.3 (PR title / body / commit messages / branch name).
- `diff` — the full unified diff of the PR or branch under review.
- `changed_files` — list of files in the diff (path + patch).
- `caller` — `reviewer` (own work) or `pr-reviewer` (cross-review). Affects the framing of system-fit findings (see Output framing).

## Phase R1 — Scope the execution paths

For each changed file's changed regions, identify the smallest set of execution paths that exercises the changed code. Walk **upstream** to entry points (route handlers, event handlers, scheduled jobs, UI actions) and **downstream** to side effects (DB writes, network calls, render outputs). Reuse the Phase 1 walkthrough technique from `SKILL.md` — same map shape, scoped to the diff rather than the whole flow.

For non-trivial changes, dispatch parallel `Explore` agents per changed file to trace callers and dependents. The goal is not to find a bug — it is to assemble enough context to evaluate the two questions in Phase R2.

## Phase R2 — Two checks

Run both in order. Each emits 0–N raw findings; the calling agent will gate them through `finding-grounding` + `per-comment-confidence` + `comment-shape` downstream.

**Intent match.** Walk the diff against the `intent_summary` and the PR body. For each claim in the intent (`"add cache to reduce DB load"`, `"validate input length before insert"`):

- Does some part of the diff implement it? If no claim has corresponding changes, that is an `intent-mismatch` finding.
- Are there changes in the diff that the intent does **not** account for? If a hunk modifies behaviour the description does not mention, that is a `scope-creep` finding.

**System fit.** For each changed export (function, class, type, component) walk every caller / consumer surfaced in Phase R1. For each caller, ask:

- Does the caller's expectation still hold after this change? (Return type, exceptions thrown, side-effect ordering, caching semantics, transactional guarantees.)
- Does the change require a coordinated update at the call site that the diff does not include? Missing cache invalidations, missing migrations on the consumer side, broken backwards-compat contracts.
- Does the change diverge from the neighbouring pattern used by adjacent code without justification?

Each system-fit gap is one finding.

## Phase R3 — Emit findings

Return at most **3 findings** (intent-match + system-fit combined). Above 3 the output is noise — pick the highest-impact items.

Each finding is a structured record:

```yaml
- type: intent-mismatch | scope-creep | system-fit
  file: <path of the diff hunk most relevant to the finding>
  line: <RIGHT-side line number, or 0 if the finding is whole-PR-scoped>
  claim: <one-sentence statement of the problem — what is wrong or missing>
  evidence: <one-sentence pointer to the caller / contract / pattern that proves it>
  severity: blocker | major | minor
```

Severity rules:

- `intent-mismatch` is always `blocker` — by definition the diff does not do what its description claims.
- `system-fit` defaults to `major`; downgrade to `minor` only when the missing update is a follow-up the caller can do without breaking production.
- `scope-creep` defaults to `minor` — surface but rarely block.

## Output framing (caller-aware)

The calling agent maps these findings into its own Conventional Comments categories. Recommended mapping:

| Caller | Type | Conventional category |
|---|---|---|
| `reviewer` (own work) | `intent-mismatch` | `issue` (blocker) |
| `reviewer` | `system-fit` | `suggestion` or `issue` (major) |
| `reviewer` | `scope-creep` | `nitpick` |
| `pr-reviewer` (cross-review) | `intent-mismatch` | `issue` (blocker) |
| `pr-reviewer` | `system-fit` | `question` — the agent has less context than the author; framing as a question respects that |
| `pr-reviewer` | `scope-creep` | `question` |

This is a recommendation; the calling agent makes the final mapping. See `agents/shared/rules/holistic-review.md` for the wiring.

## What review mode does NOT do

- **It does not score.** Findings are emitted with severity but no 0–100 confidence. Per-comment confidence runs downstream in the calling agent.
- **It does not propose fixes.** A `system-fit` finding names the gap; it does not write the cache invalidation code.
- **It does not block.** The verdict decision remains with the calling agent — the four strict blocking categories in `reviewer.md` and `pr-reviewer.md` (broken behaviour, security, data loss, **misimplemented intent**) gate "Request changes". Review mode supplies evidence for the fourth.

## Skipping

Review mode is opt-out at the calling agent's layer (the calling agent enables it by default). This skill executes whenever invoked — the trivial-skip heuristic lives in `agents/shared/rules/holistic-review.md`, not here.

## Anti-patterns

- Do NOT return more than 3 findings — above that the output is noise.
- Do NOT produce findings that overlap with line-level rubrics (`code-quality`, `ux`). Those are the caller's job and would be deduped out anyway.
- Do NOT propose fixes — `system-fit` finding describes the gap; the calling agent or PR author decides how to close it.
- Do NOT emit a confidence score per finding — that's `Skill("confidence", "code")`'s job, downstream.
- Do NOT walk the full 8-phase protocol — `review` mode is streamlined R1 → R2 → R3 only. Reach for `fix` mode if the work is actually root-cause analysis.
