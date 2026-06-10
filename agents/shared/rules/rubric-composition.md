---
title: Rubric composition — load, dedupe, consolidate
impact: HIGH
tags:
  - reviewer
  - pr-reviewer
  - rubric
  - multi-skill
---

# Rubric composition

Both agents load multiple review rubrics: `code-quality` (always for substantive diffs), `ux` (UI files), `critical` (high-stakes diffs or `--critical`), and up to 3 user-supplied lenses via `--with`.

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

## Consolidation pass

After dedupe, run one explicit consolidation step:

1. Group surviving findings by file.
2. Within a file, sort by `(prefix priority, line)`. Prefix priority: `issue > suggestion > question > nitpick > praise`.
3. Cap at **N findings per file**:
   - `pr-reviewer` (cross-review): N = 5
   - `reviewer` (self-review): N = 10
4. When the cap fires, keep the top-priority findings and surface the dropped ones in the terminal output as `Cap drops: <N>` so the user knows.
5. Cap at **20 findings total** across all files in `pr-reviewer`. No total cap in `reviewer` — local terminal output, no posting cost.

Rationale for per-file cap: a PR comment with 12 inline annotations on the same file reads as a hostile review even when every individual finding is correct. The 2026 CodeRabbit / Greptile field guide flags > 5 comments per file as the threshold above which authors start to dismiss the review wholesale.

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
