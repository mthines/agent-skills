---
name: code-quality
description: >
  Code quality skill for writing and reviewing code optimized for low cognitive
  complexity, readability, and maintainability. Applies guard clauses, early
  returns, clear naming, single-responsibility functions, and pragmatic
  performance choices grounded in research from SonarSource (Cognitive
  Complexity), Robert C. Martin's Clean Code, and Knuth's guidance on
  optimization. Use this skill whenever writing, refactoring, or reviewing code
  — especially during the GREEN and REFACTOR phases of TDD, code reviews, or
  whenever the user asks to "improve quality", "make this readable", "reduce
  complexity", "clean this up", "refactor for clarity", or "/code-quality".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.0.0'
  workflow_type: advisory-and-applied
  tags:
    - code-quality
    - readability
    - cognitive-complexity
    - clean-code
    - refactoring
    - guard-clauses
    - maintainability
---

# Code Quality Skill

Write code that is easy to understand on first read. Optimize for the next
developer's mental load before optimizing for machine performance, because
readable code is cheaper to change, debug, and trust — and most performance
wins come from algorithmic choices and profiling, not micro-optimizations.

This skill applies in two modes:

1. **Authoring mode** — when writing new code (e.g., GREEN phase of TDD, new
   features). Apply principles inline so the first version already meets the
   bar.
2. **Review mode** — when refactoring, reviewing PRs, or being asked to
   "clean this up". Diagnose against the rules and propose targeted changes.

Detect the mode from context. If the user says "review" or "audit" or
references existing code, use review mode. Otherwise default to authoring
mode and apply principles silently while you write.

---

## The Core Bet

Cognitive complexity — how hard code is to understand — is the single best
proxy for long-term maintainability. SonarSource's research showed that
cyclomatic complexity (path counting) misses what actually hurts humans:
nesting, broken linear flow, and decisions that compound. So the rules below
target cognitive load, not theoretical complexity scores.

When in doubt, the heuristic is: **can a reader understand this function
top-to-bottom on one pass without backtracking?** If yes, ship it. If they
have to scroll, jump, or hold a stack of conditions in their head, fix it.

---

## Quick Reference (load these patterns into working memory)

| Smell | Refactor To | Why |
|---|---|---|
| Nested `if` (3+ levels) | Guard clauses + early return | Each indent adds mental load; flat is easier |
| Long function (50+ lines, multiple responsibilities) | Extract by intent, name by what not how | One function = one reason to change |
| Cryptic name (`d`, `tmp`, `data`) | Domain noun (`priceDifference`, `pendingOrders`) | Names ARE documentation |
| Boolean parameter | Two named functions or an enum | `send(true, false, true)` is unreadable |
| Comment explaining WHAT | Rename or extract function | Comments rot; names get refactored with code |
| Comment explaining WHY (non-obvious constraint) | Keep it | The one comment that earns its place |
| Defensive checks for impossible states | Delete | Trust your callers; validate at boundaries |
| Flag/option cluster (4+ params) | Object parameter or builder | Working memory holds ~4 chunks |
| `else` after `return`/`throw` | Drop the `else` | Linear flow beats branching |
| Magic number/string | Named constant | Future-you will not remember what `7` meant |

---

## Procedure

### Authoring Mode

While writing code, apply these in order of impact:

1. **Naming first** — before writing the body, name the function and its
   parameters so they describe *what* it does and *what* it returns. If you
   can't name it crisply, the responsibility is unclear; rethink the
   boundary, not the implementation.
2. **Guard clauses up top** — handle errors, edge cases, and early-exit
   conditions at the start of the function. Reserve the indented body for
   the happy path.
3. **One job per function** — if you find yourself writing "and" in a
   docstring or commit message ("validates and persists"), split it.
4. **Limit nesting to 2 levels** — beyond that, extract a helper or invert a
   condition. SonarQube's research uses nesting as the primary cognitive
   load multiplier.
5. **Keep parameter count low (≤3 ideally, ≤5 hard cap)** — past that, group
   into an object/struct so callers don't need to memorize positional order.
6. **Defer abstraction** — three similar lines is fine. Wait for a third
   real use case before extracting a generic helper.

See `rules/cognitive-complexity.md` and `rules/control-flow.md` for the
mechanics behind 2 and 4. See `rules/naming.md` for 1. See
`rules/functions.md` for 3 and 5.

### Review Mode

When asked to review or refactor:

1. **Read all of the target code first** — don't critique what you haven't
   read.
2. **Score by cognitive load, not style** — pick the function that took you
   the longest to understand, that's your highest-priority refactor.
3. **Suggest changes with the diff inline** — don't just say "this is
   complex"; show the before/after.
4. **Prioritize by impact** — fix the thing that hurts readers most, not
   the thing that's easiest to nitpick. Ignore stylistic preferences if a
   linter would catch them.
5. **Stop when good enough** — perfect is a moving target. If the function
   reads top-to-bottom and the names match the domain, leave it.

Load `rules/review-checklist.md` for the structured review pass.

---

## Rule Files

Load only what's relevant to the code in front of you. Reading every rule
file every time is wasted context.

| When the code involves... | Load |
|---|---|
| Conditionals, branching, nesting | `rules/control-flow.md` |
| Long or multi-purpose functions | `rules/functions.md` |
| Variable, function, class names | `rules/naming.md` |
| Comments, docstrings, doc | `rules/comments.md` |
| Performance concerns or hot paths | `rules/performance.md` |
| Error handling, validation, defensive code | `rules/error-handling.md` |
| Reviewing existing code | `rules/review-checklist.md` |
| Cognitive complexity scoring | `rules/cognitive-complexity.md` |

---

## Critical Rules (apply always)

These are non-negotiable because they reflect human cognitive limits, not
style preferences.

### 1. Linear flow beats branching
A function that flows top-to-bottom — guards, then logic, then return — is
always easier than one with deep branching. If you have `if/else if/else`
spanning 30 lines, restructure.

### 2. Names carry the load
Code is read 10× more than it's written. A 30-character name that explains
intent saves more time than the keystrokes it costs to type. Conversely,
single-letter names are fine for tight scopes (loop indices, math
formulas) where the meaning is unambiguous from context.

### 3. Functions describe one thing
The function name should be a complete description of what it does. If the
honest name is `validateAndPersistAndNotifyUser`, you have three functions.

### 4. Don't pre-build for futures that haven't arrived
Configuration parameters, abstraction layers, and feature flags for
hypothetical needs all add cognitive load *today* with no benefit until the
hypothetical arrives — and most never do. Build for the case in front of
you; refactor when the second case shows up.

### 5. Comments explain WHY, never WHAT
A comment that restates the code is noise. A comment that captures a
non-obvious constraint, a subtle invariant, or "we tried X and it broke
because Y" is gold. If you're tempted to write a comment, first try to
rename or extract until the code says it itself.

### 6. Optimize after measuring
Knuth: "premature optimization is the root of all evil." Until a profiler
points at a hot path, prefer the readable version. Only ~3% of code drives
performance; the other 97% should be optimized for the human reader.

### 7. Validate at boundaries, trust internally
Validate user input, external API responses, and untrusted data at the
edge. Don't add defensive null checks throughout internal code — they hide
real bugs by silently swallowing impossible states. If a value can't be
null at this point in the code, don't pretend it can.

---

## When Things Conflict

These principles will sometimes pull against each other. Defaults:

- **Readability vs. performance** → readability wins until a profile says
  otherwise.
- **DRY vs. clarity** → clarity wins. Two slightly-different 5-line blocks
  beat one 12-line generic helper that takes flags.
- **Short name vs. clear name** → clear name. `userPendingApproval` beats
  `usr`.
- **Guard clause vs. single-return-style** → guard clauses, unless the
  language/team strongly enforces single-return (e.g., some functional
  styles).

---

## Output Contract

When invoked in review mode, structure findings as:

```
## Code Quality Review: [target]

### High Impact (fix these)
- [file:line] [issue] → [proposed change]

### Medium Impact (consider)
- [file:line] [issue] → [proposed change]

### Low Impact / Style (optional)
- [file:line] [issue]

### What's already good
- [brief notes on what to preserve]
```

When invoked in authoring mode, just write the code. Apply the principles
silently. Don't narrate every guard clause — the user will see clean code
in the diff.
