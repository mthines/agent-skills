---
title: 'Review Checklist — Structured Walkthrough'
impact: HIGH
tags:
  - review
  - refactor
  - checklist
---

# Review Checklist

Use this when invoked in review mode (refactoring, PR review, or "clean
this up" requests). Walk through the file methodically; surface findings
prioritized by impact.

## Pre-Read

Before forming opinions:

1. **Read every line of the target.** Skipping leads to surface-level
   feedback.
2. **Identify the entry points.** What's the public API? Reviews on
   internals matter less than reviews on the boundary.
3. **Note the domain.** A render loop is reviewed differently than a
   migration script.

## Pass 1: Structure

For each function:

- [ ] Does the name describe exactly what the function does?
- [ ] Is the function under ~50 lines? If not, can it split into named
      sub-steps?
- [ ] Is nesting capped at 2 levels?
- [ ] Are guard clauses used for edge cases / errors?
- [ ] Does it have a single, describable responsibility?
- [ ] Could parameters group into a parameter object (if 4+)?
- [ ] Are there boolean parameters that should be separate functions?

## Pass 2: Naming

Scan all identifiers:

- [ ] Are variables nouns, functions verbs?
- [ ] Are booleans named as questions/assertions (`isX`, `hasX`)?
- [ ] Any noise words (`data`, `info`, `manager`, `util`) without context?
- [ ] Any single-letter names outside trivial scopes?
- [ ] Consistent vocabulary (one of `get`/`fetch`/`load` per concept)?
- [ ] Domain words match what the team actually says?

## Pass 3: Cognitive Complexity

For each non-trivial function (rough mental score per `cognitive-complexity.md`):

- [ ] Top-to-bottom readability — can you understand it in one pass?
- [ ] Score under 15? If over, what's the dominant contributor (nesting?
      branching? boolean ops?)
- [ ] Any deeply nested blocks that could be extracted?
- [ ] Any long `if/else if` chains that could be lookup tables?

## Pass 4: Comments

- [ ] Does every comment say something the code doesn't?
- [ ] Any comments that just restate what the code does — delete or rename.
- [ ] Any commented-out code — delete.
- [ ] Any TODO/FIXME without a tracking link or owner?
- [ ] Are non-obvious WHYs documented (constraints, workarounds, tradeoffs)?

## Pass 5: Error Handling

- [ ] Boundaries validated (input, external APIs, files)?
- [ ] Internal code trusts its callers (no defensive null checks for
      impossible states)?
- [ ] Errors fail loudly, not silently?
- [ ] Error messages include what failed and useful context?
- [ ] `catch` blocks scoped narrowly, catching specific exception types?
- [ ] No empty `catch` blocks or "log and continue" patterns?

## Pass 6: Performance (only if relevant)

Skip unless the code is in a known hot path or the user flagged a
performance concern.

- [ ] Any nested loops that could be hash lookups?
- [ ] Any repeated work inside hot loops that could be hoisted?
- [ ] Any N+1 queries against a database?
- [ ] If micro-optimizations exist, are they documented with measurement
      rationale?

## Pass 7: Maintainability & Reuse

Load `rules/maintainability.md` for the patterns referenced below.

- [ ] **Reuse check.** Did the author write a helper / formatter /
      validator / constant that already exists in this codebase, the
      standard library, or an installed dependency? Grep for the domain
      noun and a synonym before accepting a new helper.
- [ ] **Single source of truth for union-type data.** If the change adds
      labels, colours, icons, permissions, or other metadata for a union
      / enum, is there one record keyed by the union with structured
      values, or are there parallel maps (`LABELS`, `COLORS`, `ICONS`,
      `IS_TERMINAL`)? Parallel maps over the same union are a refactor
      finding regardless of how few values they hold today.
- [ ] **Change-footprint test.** If the next variant of this concept were
      added (one more `OrderStatus`, one more role, one more feature
      flag), how many files would need to change? Anything beyond ~3, or
      any change the type system cannot enforce, is a maintainability
      finding.
- [ ] **Co-location.** Are the type, its metadata, and the operations on
      it in one module, or scattered across `types/`, `constants/`,
      `utils/`, and the call sites?
- [ ] **Shotgun surgery.** Does the same business rule, constant, or
      schema appear in multiple places that must be kept in sync by
      hand? Hoist to one shared module or schema.
- [ ] **Pattern consistency.** Does the new code look like its
      neighbours? New code that adopts a different style or a parallel
      utility forces every reader to context-switch.
- [ ] **Illegal states.** Could the type system make the bug class
      impossible (discriminated union, branded type, exhaustive `switch`)
      instead of relying on runtime checks?

## Pass 8: Future-Proofing Smell

- [ ] Any unused parameters / options "for future use"? Delete.
- [ ] Any abstractions with one concrete implementation? Inline.
- [ ] Any feature flags wrapping non-released code paths? Justified?
- [ ] Any backwards-compatibility shims for code nobody calls? Delete.

## Output Format

Group findings by impact. Use specific line numbers and propose concrete
diffs when feasible.

```
## Code Quality Review: <file path>

### High Impact
- <file>:<line> — [what's wrong] → [proposed change with diff]

### Medium Impact
- ...

### Low / Style
- ...

### What's already good
- <brief notes>

### Estimated cognitive complexity scores
- functionA: ~6 (acceptable)
- functionB: ~18 (refactor recommended)

### Estimated change footprint
- Adding a new OrderStatus today: 4 files (parallel maps) — refactor to one record
- Adding a new role: 1 file (already a single source of truth) — fine
```

## When to Stop

A review can always go deeper. Stop when:

- The function reads top-to-bottom on first pass.
- Names match the domain.
- No critical or high-impact issues remain.
- Remaining items are stylistic or subjective preferences.

Don't manufacture findings to look thorough. "Looks good, here's why"
is a valid review outcome.

## Tone

When delivering review feedback:

- Lead with the *why*, not the prescription. "This nests 4 levels, which
  forces the reader to track 3 conditions simultaneously" beats "too
  nested."
- Show the change, don't just describe it. A concrete diff is faster than
  a paragraph.
- Acknowledge what's working. Reviewers who only critique miss patterns
  worth replicating.
- Match severity to impact. Don't mark a stylistic preference "high
  priority" — it dilutes the signal when something genuinely matters.
