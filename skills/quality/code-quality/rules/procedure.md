---
title: Procedure — Authoring and Review Modes
impact: HIGH
tags:
  - procedure
  - authoring
  - review
---

# Procedure

This file covers the two foundational modes — authoring (writing new code) and review (refactoring or auditing existing code, findings only). The skill also has **plan mode** ([`plan-mode.md`](./plan-mode.md)) and **simplify mode** ([`simplify-mode.md`](./simplify-mode.md), which runs the review pass below and then auto-applies the mechanical findings behind a confidence gate). Detect the mode from `$ARGUMENTS`: `plan` → plan-mode.md, `code`/`review` → use this file's *Review Mode* section, `simplify` → simplify-mode.md, anything else → use this file's *Authoring Mode* section.

## Authoring Mode

While writing code, apply these in order of impact:

1. **Compose with the `tdd` skill for new code** — when authoring a new function, module, or behaviour from scratch, invoke the `tdd` skill (`Skill('tdd')`) to drive the implementation through a strict RED → GREEN → REFACTOR cycle. Apply the rules below in GREEN and REFACTOR. Skip the handoff for trivial edits (typos, config tweaks), refactors of existing code (no new behaviour), or when the user explicitly opts out. See `testability.md` for the integration.
2. **Compose with the `ux` skill for UI files** — when authoring `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, or React Native screens, invoke the `ux` skill (`Skill('ux')`) for WCAG 2.2, semantic HTML, and platform guidelines (Apple HIG, Material Design 3). Accessibility lives in `ux`. The subset that affects E2E locator stability lives in `testability.md` (UI Testability section). Skip only for non-UI files. When this skill is invoked under `autonomous-workflow` Phase 3, do **not** call `ux` from here — Phase 3 already invokes `ux` once at the right moment.
3. **Match the neighbours** — before writing a new file in an existing module, read 2–3 sibling files and mimic their structure (folder layout, error shape, import order, test style, naming convention). Outlier code forces every reader to context-switch. See `collaboration.md` §1.
4. **Reuse before creating** — before writing a helper, type, constant, formatter, or hook, search the codebase for one that already exists. Grep the domain noun and a synonym; check neighbour files; check the standard library and existing dependencies. A second implementation of the same concept is worse than the first. See `maintainability.md` §1.
5. **Naming first** — before writing the body, name the function and its parameters so they describe *what* it does and *what* it returns. If you can't name it crisply, the responsibility is unclear; rethink the boundary, not the implementation.
6. **Design the type before the body** — model the inputs and outputs so illegal states cannot be represented (discriminated unions, branded primitives, total return types, `Result<T, E>` for expected failures). The cheapest place to catch a bug is the place the bug cannot exist. See `abstraction.md` §2 and `api-design.md` §4–§5.
7. **Guard clauses up top** — handle errors, edge cases, and early-exit conditions at the start of the function. Reserve the indented body for the happy path.
8. **One job per function, one level of abstraction per body** — if you find yourself writing "and" in a docstring or mixing orchestration sentences with low-level mechanics, split. See `abstraction.md` §1.
9. **Limit nesting to 2 levels** — beyond that, extract a helper or invert a condition.
10. **Keep parameter count low (≤3 ideally, ≤5 hard cap)** — past that, group into an object/struct.
11. **One source of truth for union-type metadata** — when a union has associated data (labels, colours, icons, flags), use one record keyed by the union with structured values, not N parallel maps. Adding a variant must be a single edit. See `maintainability.md` §2.
12. **Push impurity outward** — keep decision logic pure; push I/O, time, randomness, and ID generation to the edges. Inject the clock / RNG / fetcher; do not call them directly from core logic. See `architecture.md` §3 and `correctness.md` §7.
13. **Defer *generic* abstraction, not reuse** — wait for a third real use case before extracting a flag-driven generic helper. Always reuse utilities that already exist, and always consolidate parallel maps over the same union the moment they appear — those are not "premature".

Cross-references: `cognitive-complexity.md` and `control-flow.md` for 7 and 9; `naming.md` for 5; `functions.md` for 8 and 10; `maintainability.md` for 4, 11, and 13; `abstraction.md`, `architecture.md`, `api-design.md`, `correctness.md`, `testability.md`, `collaboration.md`, and `refactor-recipes.md` for the deeper patterns.

## Review Mode

When asked to review or refactor:

1. **Read all of the target code first** — don't critique what you haven't read.
2. **Score by cognitive load, not style** — pick the function that took you the longest to understand; that's your highest-priority refactor.
3. **Score by change footprint** — for each new concept (a union, a constant, a piece of metadata), count how many files would need to change if a new variant were added. Anything beyond ~3 files, or that the type system cannot enforce, is a maintainability finding.
4. **Check for existing utilities** — grep for similar helpers, formatters, or constants that the new code could have reused instead of duplicating.
5. **Cite recipes by name** — use `refactor-recipes.md` so reviews read as "apply R1 (Consolidate Parallel Maps)" rather than free-form prose.
6. **Suggest changes with the diff inline** — don't just say "this is complex"; show the before/after.
7. **Prioritize by impact** — fix the thing that hurts readers and future maintainers most, not the thing that's easiest to nitpick. Ignore stylistic preferences if a linter would catch them.
8. **Stop when good enough** — perfect is a moving target. If the function reads top-to-bottom, names match the domain, and the change footprint for the next variant is small, leave it.

Load `review-checklist.md` for the structured review pass.
