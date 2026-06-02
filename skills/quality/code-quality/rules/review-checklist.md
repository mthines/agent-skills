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

## Contents

- [Pre-Read](#pre-read)
- [Pass 1: Structure](#pass-1-structure)
- [Pass 2: Naming](#pass-2-naming)
- [Pass 3: Cognitive Complexity](#pass-3-cognitive-complexity)
- [Pass 4: Comments](#pass-4-comments)
- [Pass 5: Error Handling](#pass-5-error-handling)
- [Pass 6: Performance (only if relevant)](#pass-6-performance-only-if-relevant)
- [Pass 7: Maintainability & Reuse](#pass-7-maintainability--reuse)
- [Pass 8: Abstraction & Type-Driven Design](#pass-8-abstraction--type-driven-design)
- [Pass 9: Architecture](#pass-9-architecture)
- [Pass 10: API Design](#pass-10-api-design)
- [Pass 11: Correctness Hotspots](#pass-11-correctness-hotspots)
- [Pass 12: Testability](#pass-12-testability)
- [Pass 13: Collaboration](#pass-13-collaboration)
- [Pass 14: Future-Proofing Smell](#pass-14-future-proofing-smell)
- [Output Format](#output-format)
- [When to Stop](#when-to-stop)
- [Tone](#tone)

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
- [ ] **Verbosity.** Any multi-sentence, paragraph-style, or "preamble"
      comment whose WHY would survive being trimmed to one line? Any
      comment longer than the code it describes? Any bullet-list above a
      single function (usually means split the function)? Apply **R35
      (Trim Verbose Comment)**. There is no hard length cap — a genuinely
      subtle constraint may justify a paragraph — but the default is the
      shortest form that preserves the WHY. When in doubt, trim first,
      delete second, keep third.

## Pass 5: Error Handling

- [ ] Boundaries validated (input, external APIs, files)?
- [ ] Internal code trusts its callers (no defensive null checks for
      impossible states)?
- [ ] Errors fail loudly, not silently?
- [ ] Error messages include what failed and useful context?
- [ ] `catch` blocks scoped narrowly, catching specific exception types?
- [ ] No empty `catch` blocks or "log and continue" patterns?
- [ ] **Schema-first validation at boundaries.** Untrusted input parsed
      through a schema (Zod, Pydantic, valibot) at the boundary, not
      hand-rolled `if (typeof x === 'string')` checks scattered through
      the code?
- [ ] **Single source of truth for shape and type.** Where a schema
      exists, is the type inferred from it (`z.infer<typeof Schema>`),
      or is there a parallel hand-written `type` declaration that will
      drift?
- [ ] **No re-validation deep in the stack.** Once parsed at the
      boundary, internal code trusts the type — no defensive
      `Schema.parse(value)` calls inside trusted internals.
- [ ] **Sub-schemas split only with cause.** Nested schemas extracted
      only when reused, when they have their own boundary, or when a
      partial slice must be parsed independently — not "for tidiness".

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

## Pass 8: Abstraction & Type-Driven Design

Load `rules/abstraction.md` for the patterns referenced below.

- [ ] **One level of abstraction per function.** Body does not mix
      orchestration sentences with low-level mechanics. Apply R16 if it
      does.
- [ ] **Illegal states unrepresentable.** Optional fields that should
      never both be missing (or both set) modelled as a discriminated
      union, not enforced at runtime. Apply R15.
- [ ] **Branded primitives at boundaries.** `Email`, `UserId`, `OrderId`
      are branded types, not raw `string`. Apply R11.
- [ ] **Exhaustive matching.** `switch` over a union ends with
      `assertNever(x)` so adding a variant fails the build.
- [ ] **Generics earn their keep.** Type parameters introduced only
      where the same algorithm operates over different concrete types,
      not for one-caller "flexibility".
- [ ] **`any` and casts justified.** Every `any` / `as Foo` carries a
      one-line `// because:` comment. Apply R17.

## Pass 9: Architecture

Load `rules/architecture.md`.

- [ ] **Public surface intentional.** Module exports only what callers
      need; internals stay internal.
- [ ] **No barrel files** (or, if present, justified — and not creating
      circular imports).
- [ ] **Dependency direction.** Domain code imports nothing
      infrastructure-shaped; circular imports absent.
- [ ] **Functional core, imperative shell.** Pure decision logic
      separated from I/O. Apply R8.
- [ ] **DTO ↔ domain ↔ persistence.** Wire shapes parsed at boundaries;
      domain types used internally; persistence types do not leak into
      the UI.
- [ ] **Immutability defaults.** `const` over `let`; `readonly` on
      public fields; no shared mutable state without a single owner.
- [ ] **No side-effecting imports.** Importing a module does not trigger
      network calls, file writes, or singleton creation. Apply R20.

## Pass 10: API Design

Load `rules/api-design.md`.

- [ ] **Parameter order.** Subject first; required before optional;
      data before configuration.
- [ ] **Total functions.** No throws for "expected absence"; no
      sentinels (`-1`, `""`, `0`). Returns `null` / `Result` instead.
      Apply R10.
- [ ] **Error type system.** Discriminated `AppError` union (or
      equivalent), not `new Error('parse my message')`. Apply R12.
- [ ] **`Error.cause` preserved** through error transformations.
- [ ] **Tell, don't ask.** No `a.b.c.d.method()` chains for behaviour
      (records are exempt — walking pure data is fine).
- [ ] **File reading order.** Public surface at the top; helpers below
      in roughly the order they are called.

## Pass 11: Correctness Hotspots

Load `rules/correctness.md`. Apply when the code touches any of these
domains.

- [ ] **Idempotency.** Retryable operations (POST, queue handlers,
      external calls) safe to invoke twice. Apply R18.
- [ ] **Money.** Stored as integer minor units or decimal library;
      currency tagged. Never `number`. Apply R19.
- [ ] **Floats.** Equality compared with epsilon; or values converted to
      integers for exact comparison.
- [ ] **Dates.** UTC stored, local rendered; `Date` not mutated;
      durations distinguished from instants.
- [ ] **Identifiers.** Branded; not used as ordering proxies.
- [ ] **Encoding.** Escaping at the layer that interprets (HTML at
      render, SQL via parameters, URL-encoded at URL build).
- [ ] **Determinism.** No direct `Date.now()` / `Math.random()` /
      `process.env` reads inside core logic. Apply R9.
- [ ] **Async / concurrency.** Serial vs. parallel `await` chosen
      consciously; cancellation observed; no race conditions on shared
      state.
- [ ] **Resource management.** Every `open` has a `close` (try/finally
      or `using`); listeners and timers torn down.
- [ ] **Assertions.** Invariants encoded with `assert` / `assertNever`
      where the type system cannot enforce them.

## Pass 12: Testability

Load `rules/testability.md`.

- [ ] **Cheap to test.** A test for the public behaviour fits in <10
      lines for a function under 30 lines.
- [ ] **No hidden non-determinism.** Clock, RNG, IDs injected. Apply R9.
- [ ] **Pure core surfaced.** Decision logic separable from I/O; tests
      do not require real DB / network.
- [ ] **Behaviour, not implementation.** Tests bound to the public API;
      not pinned to internal helpers.
- [ ] **Exhaustive coverage of total functions** (present + absent
      branches for `T | null`).
- [ ] **For new code authored under this review:** was `tdd` invoked
      before implementation? If not, was the omission justified?

## Pass 13: Collaboration

Load `rules/collaboration.md`.

- [ ] **Symmetry with neighbours.** New code follows the patterns of
      sibling files (folder layout, error shape, import order, test
      style).
- [ ] **PR scope.** One logical change per PR; refactor and feature
      separated.
- [ ] **Migration discipline.** Breaking changes ship in two phases
      (additive, then subtractive); deprecations marked with
      `@deprecated` and a removal target.
- [ ] **Diff hygiene.** Format / whitespace changes separated from
      substantive changes.

## Pass 14: Future-Proofing Smell

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
