---
title: Standards conformance — does the diff respect the repo's own governing docs (default on)
impact: HIGH
tags:
  - pr-reviewer
  - standards-conformance
  - governing-docs
---

# Standards conformance

The line-level rubrics (`code-quality`, `ux`, `critical`, lenses), the holistic pass, and the
optimality lens all assume the change's code-level quality and approach are the concern.
None of them asks the governance question: **does the diff violate a normative rule the repo
has already written down?**

This rule produces findings when a changed file violates the repository's own governing
documents — `CLAUDE.md`, `AGENTS.md`, path-scoped `.claude/rules/*.md` files, and explicit
`standards:` entries in the review config (`.github/review.yaml`, or a subtree `.review.yaml`).
The governing-doc line `path:line` is the grounding evidence; findings that cannot cite one
are dropped at Step 2.6.

## Contents

- [Default-on, opt-out via `--no-standards`](#default-on-opt-out-via---no-standards)
- [Two input sources](#two-input-sources)
- [Trivial-skip set](#trivial-skip-set)
- [When to run (the call)](#when-to-run-the-call)
- [Signal strength mapping](#signal-strength-mapping)
- [Grounding and gates](#grounding-and-gates)
- [Precedence and conflict](#precedence-and-conflict)
- [Logging](#logging)
- [What this rule does not do](#what-this-rule-does-not-do)

---

## Default-on, opt-out via `--no-standards`

Standards-conformance runs on **every** invocation of `pr-reviewer` unless disabled, with a
**quiet early-exit**: when no normative statements are found for the changed paths, when the
`TRIVIAL_SKIP` cache from Step 1.7b is true, or when `RUN_MODE == "incremental-quick"`, the step
is a silent no-op.
Those are the same three conditions Step 1.7b and Step 2.4d skip on, and the same three the
§ Logging `Status` field reports.
The token cost is the discovery walk (one pass, cached) plus the comparison itself; the value
asymmetry is large — catching a diff that contradicts a well-documented project rule is worth
many silent runs.

The flag is `--no-standards`.
Mention it in the run announcement only when set.

## Two input sources

### Source 1 — Auto-discovery (zero config)

For each changed file, the rule reuses **`review-config.md`'s upward walk** (§ Hierarchical
discovery / § Loading algorithm) to discover governing documents.
The walk is not restated here: it is the same traversal that collects subtree `.review.yaml` files
and the `.github/review.yaml` base (legacy root `.review.yaml` still honoured), re-run on the same
directory tree to collect the governing docs below.

Load, in nearest-ancestor-first order, these document types:

a. Nearest-package `CLAUDE.md` — the closest `CLAUDE.md` at or above the changed file's directory,
   **excluding** the repo-root `CLAUDE.md`, which is always loaded via (d) instead.
b. Any `.claude/rules/*.md` files whose frontmatter `globs:` field matches the changed file path
   (or, absent `globs:`, treat as applying to all paths).
c. `AGENTS.md` at the repo root (if it exists).
d. A bounded slice of the root `CLAUDE.md` (first 8,000 characters), to stay within the token
   budget while capturing project-wide prose rules.

**(a) vs. (d) — the root `CLAUDE.md` is always bounded.**
When a changed file lives at the repo root, or its nearest `CLAUDE.md` *is* the root one, (d)
governs: load the 8,000-character slice, never the whole file, and never both.
(a) covers non-root package `CLAUDE.md` files only.
This is not a style preference — an unbounded root `CLAUDE.md` routinely exceeds the 30,000-character
total cap on its own (this repository's is ~38,000 characters), which would drop every other
governing document for the run.

**Extraction filter:** from each loaded document, extract only **normative statements** —
sentences or bullet points that contain "must", "always", "never", "prefer X over Y",
"do not", or "forbidden".
Narrative prose, aspirational descriptions, and factual explanations are silently skipped.
The distinction is intentional: this rule enforces written rules, not editorial preferences.

Discovery runs **once per changed file at Step 1** (cached as `STANDARDS_DOCS`), not per finding.

### Source 2 — Opt-in via the review config's `standards:` block

When the review config (`.github/review.yaml`, or a subtree `.review.yaml`) defines a `standards:`
block, each matching entry's `docs:` files are
loaded as standards for the globs that cover the changed file, and `must:` entries are treated as
inline normative rules.
The merge follows the same concatenation rule as `path_instructions`: closer-file entries are
listed first (higher precedence in conflict).
See `agents/shared/rules/review-config.md` § Standards for the full schema.

### Token budget

The combined standards text (Source 1 + Source 2, nearest-first) is capped at **30,000
characters** total across all loaded documents for the entire review run.
A document that governs several changed files is listed under each of them but loaded and counted
once.

When the cap is reached:

- Keep documents that arrived earlier in the nearest-first ordering (keep nearest, drop further).
- **Log the dropped documents** by path and reason — never silently truncate.
  Log line: `[standards-conformance] DROP <path> — cap exceeded (budget: 30,000 chars)`.
- Continue with the loaded subset.
- Emit one diagnostics note listing the paths dropped.

Never silently truncate a document mid-content.

## Trivial-skip set

Reuse the `TRIVIAL_SKIP` value evaluated at Step 1.7b — do not recompute it and do not restate its
conditions here.
The conditions are defined once in `agents/shared/rules/holistic-review.md` § Trivial-skip set;
`TRIVIAL_SKIP == true` skips this rule (the heuristic, not the flag).
In `incremental` modes, discovery keys on the delta paths only.

Skipping reports as `Standards conformance: skipped (trivial diff).` in the Quality Gate summary.

## When to run (the call)

### Step 1.7b — Standards discovery

Runs **immediately after Step 1.7** (review-config load), before Step 2 begins.
Reuse the same upward-walk from `review-config.md` on the changed-file list from Step 1.1 /
Step 1.2.

```bash
# Step 1.7b — Standards discovery
declare -A STANDARDS_DOCS  # changed_file -> [(doc_path, normative_bullets[])] cache
                           # must be associative: the key is a path, not an integer index
STANDARDS_CHAR_COUNT=0     # running total
STANDARDS_DROPPED=()       # paths dropped due to cap (indexed: a list, not a map)

for f in $CHANGED_FILES; do
  # Reuse review-config upward walk logic for governing docs:
  discover_governing_docs "$f"   # → nearest CLAUDE.md, .claude/rules/*.md, AGENTS.md, root slice
  # Load review-config standards: entries matching the file's path
  # (.github/review.yaml base + subtree .review.yaml files)
  load_review_config_standards "$f"
  # Apply 30,000-char cap nearest-first; log drops
done
```

### Step 2.4d — Standards-conformance lens

Runs **after Step 2.4c** (optimality review) and **before Step 2.5** (dedupe), so
standards findings participate in dedupe and can collide-and-win against a line-level finding on
the same `(file, line)`.

For each changed file in `REVIEW_DIFF`:

1. Retrieve the `STANDARDS_DOCS[<changed file>]` entry list (built in Step 1.7b).
2. If the cache is empty (no governing docs discovered, no matching review-config `standards:`),
   skip quietly.
3. Compare the diff's additions (`+`-prefixed lines) against the normative statements in the cache.
4. Emit a raw finding for each **clearly violated** statement (see § Signal strength mapping).

**2.4d always runs in report mode — no file mutation.**

## Signal strength mapping

| Statement type | Finding prefix | Notes |
|---|---|---|
| Violated "never" or "must" | `issue:` | May become `(blocking)` only through the existing blocking bar (`conventional-comments.md` + Step 3); never automatically blocking |
| Violated "always" | `issue:` | Same as above |
| Violated "prefer X over Y" | `suggestion:` | Non-blocking |
| Violated "do not" or "forbidden" | `issue:` | Same as "never"/"must" |
| Narrative, aspirational, or descriptive prose | **Never flagged** | Extraction filter prevents these from reaching comparison |
| Factual, explanatory, or contextual statements | **Never flagged** | Same |

The lens maps findings to **`issue:` or `suggestion:` prefixes only**.
`(blocking)` decoration is applied by the existing blocking bar, not by this rule.
This rule introduces no new blocking class.

**Enforcement threshold:** a standards finding is emitted only when the violation is **clear and
high-confidence**, at or above the Step 2.7 bar for the prefix the finding will carry — `issue:` at
the resolved profile threshold (80 on `balanced`), `suggestion:` at 90 — and never below the
profile threshold when that threshold is higher.
Emitting below the downstream bar only produces a finding that Step 2.7 drops.
Uncertain or borderline interpretations of a normative statement are not flagged.

## Grounding and gates

Every standards finding **must** carry the governing-doc `path:line` as its grounding evidence.
A finding that cannot cite a specific `path:line` in a loaded governing document is dropped at
Step 2.6 (`finding-grounding.md`).

After emission, standards findings join the **same raw finding stream** and pass through every
downstream gate unchanged:

```text
→ 2.5  rubric-composition § Consolidation (dedupe + group + sort)
→ 2.5a cross-rubric agreement
→ 2.5b prior-comment-awareness.md § Dedup
→ 2.6  finding-grounding.md   (doc path:line must grep-resolve)
→ 2.6b verification-receipt.md
→ 2.7  per-comment-confidence.md
→ 2.8  comment-shape.md
→ 2.9  conventional-comments.md
→ 2.9b rubric-composition § Placement
```

Standards findings receive no exemptions from these gates.
They are subject to the same grounding, confidence, shape, and placement rules as every other
finding in the pipeline.

## Precedence and conflict

When a standards finding conflicts with the PR author's stated intent or an explicit review-config
`path_instructions` / `standards` entry (`.github/review.yaml` or a subtree `.review.yaml`), the
author's intent and the explicit config **win**.

The conflict is **surfaced, not silently enforced**: emit a note in the diagnostics block —
`[standards-conformance] CONFLICT: <doc path:line> conflicts with author intent / review-config entry — skipped.`

Auto-discovered governing-doc statements are enforced only when:
- The violation is clearly against the text (not a matter of interpretation), and
- The confidence meets the Step 2.7 bar for the finding's prefix (§ Signal strength mapping), and
- No explicit author-intent or review-config entry overrides it.

## Logging

Every run that reaches this step (not trivially skipped and not `--no-standards`) **must** render
this block in the terminal Quality Gate summary:

```text
Standards conformance (2.4d):
  Status:             ran | skipped (trivial diff) | skipped (--no-standards) | skipped (incremental-quick) | skipped (no governing docs found)
  Docs discovered:    <N> (total normative bullets: <B>)
  Docs dropped (cap): <D> (listed above)
  Conflicts surfaced: <CON>
  Findings emitted:   <FE>
```

Emit the block **even when `FE = 0`**.
A silent run and a skipped run are different outcomes; without the block the reader cannot tell
them apart.
A run that discovered governing docs and emitted 0 findings is healthy — most diffs conform.

The `Review details` `<details>` block in Step 4 carries a standards diagnostics line on all
three bodies (PASS, WARN, FAIL):

```text
**Standards (2.4d)** — <ran | skipped (reason)> · <N> docs · <FE> finding(s)
```

## What this rule does not do

- It does not enforce **all** content in a governing doc — only explicitly normative statements
  (must / always / never / prefer / do not / forbidden).
  Narrative, aspirational, and explanatory prose is never turned into a finding.
- It does not build a parallel doc-discovery system.
  It references and reuses `review-config.md`'s upward walk — one walk, one system.
- It does not apply any fix — the rule is read-only, consistent with `pr-reviewer`'s read-only
  contract.
- It does not emit inline comments that bypass grounding — every finding needs a `path:line` cite.
- It does not introduce a new blocking class — `(blocking)` is decorated by the existing bar only.
- It does not re-run the trivial-skip computation — it reads the `TRIVIAL_SKIP` cache written at
  Step 1.7b.
- It does not truncate silently — over-cap drops are logged by path.
- It does not override the author's intent or review-config entries on conflict — those win, and
  the conflict is surfaced explicitly.
