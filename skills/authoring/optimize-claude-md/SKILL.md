---
name: optimize-claude-md
description: >
  Audits CLAUDE.md files (root, nested, `.claude/rules/*.md`) for context
  bloat and emits ranked suggestions across two levers — (1) shrink
  inventory entries, (2) flag rarely-used agent-invokable skills that
  should become slash-only to drop their description from the always-on
  available-skills list. Triggers on Claude Code's "Large CLAUDE.md will
  impact performance" warning (> 40k chars), inventory entries duplicating
  harness-loaded skill descriptions, "CLAUDE.md is too big", "shrink
  CLAUDE.md", "optimize CLAUDE.md", "/optimize-claude-md". Three modes —
  `audit` (read-only ranked report + slash-conversion candidates), `trim`
  (interactive one-line hook + diff approval), `extract` (moves sections
  to linked files preserving content). Composes with `docs`
  (Placement Resolver) and `create-skill` (invocation matrix). Hard rules:
  refuses files < 10k chars; never deletes silently; never edits any
  skill's canonical `SKILL.md` frontmatter — routes to `/create-skill`.
disable-model-invocation: true
argument-hint: '[audit|trim|extract] [<path>]'
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: slash-command
  tags:
    - claude-md
    - context-bloat
    - optimization
    - documentation
    - hot-path
    - cold-path
    - audit
    - performance
    - slash-command
---

# Optimize CLAUDE.md

Reduces the recurring token cost of `CLAUDE.md` (and its nested + linked
siblings) by identifying paragraph-length entries, redundant content, and
hot-path bloat — then trimming or extracting them while preserving the
canonical source.

> **This `SKILL.md` is a thin index.** Detailed rules live in `rules/*.md`
> and load on demand. Worked examples live in `references/*.md`. Reading
> them all up-front would burn tokens you do not need yet.

---

## When to run

Run when **any** of these hold:

- Claude Code prints `Large CLAUDE.md will impact performance (Xk chars > 40.0k)` at session start.
- The user asks "shrink", "optimize", "reduce", or "trim" CLAUDE.md.
- A paragraph in CLAUDE.md exceeds 6 lines and is not a code block.
- An inventory section duplicates content already loaded by the harness
  (e.g. skill `description` frontmatter, which is preloaded automatically).
- A nested package `CLAUDE.md` repeats content from the root.

Refuse if the target file is < 10k chars — see [`rules/hard-rules.md`](./rules/hard-rules.md).

---

## Mode Detection

Parse `$ARGUMENTS` and detect the mode. First positional is mode; second is
optional path (default `./CLAUDE.md`).

| Mode      | Default | Trigger                                                          |
| --------- | ------- | ---------------------------------------------------------------- |
| `audit`   | **yes** | Default. Or `audit`, "review", "report", no mode argument.       |
| `trim`    |         | `trim`, "shorten", "condense", "make entries one-liners".        |
| `extract` |         | `extract`, "move to file", "split out", "externalize inventory". |

State the detected mode and target file in one line before continuing:

```
Mode: audit
Target: /abs/path/to/CLAUDE.md (43,012 chars / ~10,750 tokens)
```

---

## Workflow

| Phase | Name                | Rule file                                                       | Gate                                                                 |
| ----- | ------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0     | Preflight           | [`rules/hard-rules.md`](./rules/hard-rules.md)                  | File exists, ≥ 10k chars, readable, in a project root or `.claude/`. |
| 1     | Measure             | [`rules/measurement.md`](./rules/measurement.md)                | Chars, approx tokens, line counts per section captured.              |
| 2     | Classify content    | [`rules/classification.md`](./rules/classification.md)          | Every section labelled hot-path / cold-path / borderline.            |
| 2.5   | Invocation review   | [`rules/invocation-review.md`](./rules/invocation-review.md)    | Slash-conversion candidates (if any) listed with baseline-savings estimate. Skipped if the repo doesn't own `skills/`. |
| 3     | Mode-specific run   | [`audit-mode.md`](./rules/audit-mode.md), [`trim-mode.md`](./rules/trim-mode.md), [`extract-mode.md`](./rules/extract-mode.md) | Report emitted or diff applied with user approval.                   |
| 4     | Verify              | [`rules/hard-rules.md`](./rules/hard-rules.md)                  | Before/after metrics shown; no content lost in `trim` or `extract`.  |

---

## Required Reading by Phase

Load on demand — do not preload.

| Phase | Files                                                                                                                                                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | [`rules/hard-rules.md`](./rules/hard-rules.md)                                                                                                                                              |
| 1     | [`rules/measurement.md`](./rules/measurement.md)                                                                                                                                            |
| 2     | [`rules/classification.md`](./rules/classification.md), [`references/bloat-patterns.md`](./references/bloat-patterns.md) (optional, for pattern matching)                                   |
| 2.5   | [`rules/invocation-review.md`](./rules/invocation-review.md), and the canonical [`create-skill/rules/invocation-control.md`](../create-skill/rules/invocation-control.md) for the matrix.   |
| 3     | One of [`rules/audit-mode.md`](./rules/audit-mode.md), [`rules/trim-mode.md`](./rules/trim-mode.md), [`rules/extract-mode.md`](./rules/extract-mode.md) — by mode.                          |
| 4     | [`rules/hard-rules.md`](./rules/hard-rules.md) (preservation invariant check)                                                                                                               |

---

## Core Principles

1. **The context window is a public good.** Every line in `CLAUDE.md` is a
   recurring token cost once loaded, and survives compaction at a per-session
   slice. Optimize for the smallest hot-path footprint that still preserves
   the rules an agent must follow.
2. **Do not duplicate what the harness already loads.** A skill's
   `description` frontmatter is preloaded by Claude Code automatically. An
   inventory paragraph in `CLAUDE.md` that restates it pays the token cost
   twice. Replace with a one-line hook + link.
3. **Two levers, not one.** (a) Shrink the file via `trim` / `extract`.
   (b) Convert rarely-used agent-invokable skills to slash-only via Phase
   2.5 — removes their description from the always-on available-skills
   list. Both reduce per-session context cost.
4. **Hot-path stays terse; cold-path moves.** Project commands, file
   pointers, hard invariants → keep in `CLAUDE.md`. Design rationale,
   feature history, verbose descriptions → move to linked files.
5. **Never delete silently.** `trim` and `extract` always preserve content
   somewhere reachable. If you cannot find a destination, abort and ask.
6. **The canonical source wins.** A skill's own `SKILL.md` frontmatter is
   the authority for that skill. Never edit it from this skill — route
   invocation-flag changes to `/create-skill review`.

---

## Anti-patterns (one-liners — full list in [`rules/classification.md`](./rules/classification.md))

- Inventory entry that restates a skill's `description` frontmatter verbatim.
- Paragraph longer than 6 lines describing a single skill or agent.
- Design rationale ("we chose X because Y") in root `CLAUDE.md` — belongs in the skill's own `CLAUDE.md` or a rule file.
- Nested package `CLAUDE.md` that repeats root content.
- Examples of correct/incorrect patterns in `CLAUDE.md` itself — examples belong in skill files.
- Time-sensitive narrative ("as of 2026-05", "we just added"). Decays into noise.

---

## Composition

- Calls [`docs` skill](../docs/SKILL.md)'s Placement
  Resolver via `Skill("docs", "pattern <glob>")` when an extraction
  needs cross-cutting placement (e.g. a rule applies to multiple subtrees).
- References [`create-skill`](../create-skill/SKILL.md)'s
  [`token-economics.md`](../create-skill/rules/token-economics.md) and
  [`progressive-disclosure.md`](../create-skill/rules/progressive-disclosure.md)
  for the underlying conciseness principles — do not duplicate that
  guidance here.

---

## Definition of Done

A **run** is complete when:

- [ ] Mode and target file stated in one line.
- [ ] Phase 1 metrics captured (total chars, approx tokens, top-10 longest entries).
- [ ] Phase 2 classification covers every H2 section.
- [ ] Phase 2.5 invocation review run if `skills/` exists in the repo; candidates listed with baseline-savings estimates.
- [ ] For `audit`: ranked report emitted with top-N concrete suggestions (lever 1 + lever 2), each tagged hot-path / cold-path or slash-conversion.
- [ ] For `trim` and `extract`: every applied change shows before/after chars + estimated tokens saved.
- [ ] No content silently deleted. No canonical `SKILL.md` frontmatter edited (route to `/create-skill` for invocation flag changes).
- [ ] If the file is now < 40k chars, report "below performance warning threshold".
- [ ] If invocation candidates were suggested, report total estimated baseline savings separately from CLAUDE.md savings.
