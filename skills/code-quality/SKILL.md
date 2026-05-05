---
name: code-quality
description: >
  Code quality skill for writing and reviewing code optimized for low cognitive
  complexity, readability, and long-term maintainability. Applies guard clauses,
  early returns, clear naming, single-responsibility functions, reuse of
  existing utilities, single source of truth for union-type metadata (one map
  instead of N parallel maps), small change footprints, and pragmatic
  performance choices grounded in research from SonarSource (Cognitive
  Complexity), Robert C. Martin's Clean Code, and Knuth's guidance on
  optimization. Use this skill whenever writing, refactoring, or reviewing code
  — especially during the GREEN and REFACTOR phases of TDD, code reviews, or
  whenever the user asks to "improve quality", "make this readable", "reduce
  complexity", "make this easier to maintain", "deduplicate", "clean this up",
  "refactor for clarity", or "/code-quality".
disable-model-invocation: true
license: MIT
metadata:
  author: mthines
  version: '1.1.0'
  workflow_type: advisory-and-applied
  tags:
    - code-quality
    - readability
    - cognitive-complexity
    - clean-code
    - refactoring
    - guard-clauses
    - maintainability
    - reuse
    - single-source-of-truth
---

# Code Quality Skill

Write code that is easy to **review, understand, and change**. Optimize for the
next developer's mental load before optimizing for machine performance, because
readable code is cheaper to change, debug, and trust — and most performance
wins come from algorithmic choices and profiling, not micro-optimizations.

The three quality axes this skill targets, in priority order:

1. **Readability** — a reader understands the code top-to-bottom on first pass.
2. **Maintainability** — the next variant of a concept is a one-file, one-edit
   change; existing utilities are reused rather than re-invented; one concept
   has one canonical home.
3. **Pragmatic performance** — algorithmic wins by default, micro-optimizations
   only when a profiler points at them.

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

The maintainability counterpart: **if I add the next obvious variant of this
concept, how many files do I have to edit, and will the type system catch me
if I miss one?** One file with full type coverage is excellent; four
hand-synchronised maps in four files is shotgun surgery — fix the structure
before adding the variant. See `rules/maintainability.md`.

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
| Parallel maps over the same union (`LABELS`, `COLORS`, `ICONS` keyed by `Status`) | One `Record<Status, { label, color, icon }>` | Adding a variant becomes one edit, not N |
| Reimplementing a helper that already exists | Search first; use the existing one | Two implementations drift; bugs get fixed in one copy only |
| `if/else if` chain dispatching on a value | Lookup table or single source-of-truth record | Data structure beats control flow; easy to extend |
| Same constant (`MAX_RETRIES`, status strings) duplicated across files | Hoist to one shared module | One concept, one home |
| Adding a new variant requires editing 4+ files | Consolidate before adding the variant | Shotgun surgery compounds with every variant |

---

## Procedure

### Authoring Mode

While writing code, apply these in order of impact:

1. **Reuse before creating** — before writing a helper, type, constant,
   formatter, or hook, search the codebase for one that already exists.
   Grep the domain noun and a synonym; check neighbour files; check the
   standard library and existing dependencies. A second implementation of
   the same concept is worse than the first — behaviour drifts and bugs
   get fixed in only one copy. See `rules/maintainability.md` §1.
2. **Naming first** — before writing the body, name the function and its
   parameters so they describe *what* it does and *what* it returns. If you
   can't name it crisply, the responsibility is unclear; rethink the
   boundary, not the implementation.
3. **Guard clauses up top** — handle errors, edge cases, and early-exit
   conditions at the start of the function. Reserve the indented body for
   the happy path.
4. **One job per function** — if you find yourself writing "and" in a
   docstring or commit message ("validates and persists"), split it.
5. **Limit nesting to 2 levels** — beyond that, extract a helper or invert a
   condition. SonarQube's research uses nesting as the primary cognitive
   load multiplier.
6. **Keep parameter count low (≤3 ideally, ≤5 hard cap)** — past that, group
   into an object/struct so callers don't need to memorize positional order.
7. **One source of truth for union-type metadata** — when a union has
   associated data (labels, colours, icons, flags), use one record keyed by
   the union with all metadata as the value, not N parallel maps. Adding a
   variant must be a single edit. See `rules/maintainability.md` §2.
8. **Defer *generic* abstraction, not reuse** — wait for a third real use
   case before extracting a flag-driven generic helper. But always reuse
   utilities that already exist, and always consolidate parallel maps over
   the same union the moment they appear — those are not "premature".

See `rules/cognitive-complexity.md` and `rules/control-flow.md` for the
mechanics behind 3 and 5. See `rules/naming.md` for 2. See
`rules/functions.md` for 4 and 6. See `rules/maintainability.md` for 1, 7,
and 8.

### Review Mode

When asked to review or refactor:

1. **Read all of the target code first** — don't critique what you haven't
   read.
2. **Score by cognitive load, not style** — pick the function that took you
   the longest to understand, that's your highest-priority refactor.
3. **Score by change footprint** — for each new concept (a union, a
   constant, a piece of metadata), count how many files would need to
   change if a new variant were added. Anything beyond ~3 files, or that
   the type system cannot enforce, is a maintainability finding.
4. **Check for existing utilities** — grep for similar helpers, formatters,
   or constants that the new code could have reused instead of duplicating.
5. **Suggest changes with the diff inline** — don't just say "this is
   complex"; show the before/after.
6. **Prioritize by impact** — fix the thing that hurts readers and future
   maintainers most, not the thing that's easiest to nitpick. Ignore
   stylistic preferences if a linter would catch them.
7. **Stop when good enough** — perfect is a moving target. If the function
   reads top-to-bottom, names match the domain, and the change footprint
   for the next variant is small, leave it.

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
| Union types with associated data, parallel maps, duplicated constants, "where should this live", reuse decisions | `rules/maintainability.md` |

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

### 8. Reuse before creating
Before writing a helper, type, constant, or formatter, search the codebase
for one that already exists. A second implementation of the same concept
is worse than the first — behaviours drift, bugs get fixed in only one
copy, and the next reader does not know which one is canonical. Reusing
existing code is never premature.

### 9. One source of truth for union-type metadata
When a union or enum has associated data (labels, colours, icons, flags,
defaults), put it in one record keyed by the union with structured values
— not in N parallel maps. Adding a new variant must be a single edit, and
the type system must catch you if you miss a field. Four hand-synchronised
maps over `OrderStatus` are a bug waiting to ship.

### 10. Minimise the change footprint
A maintainable change touches few files, all type-checked. Before adding a
new variant of a concept, ask: "if I add the next one, how many places do
I need to edit, and will the compiler tell me if I miss one?" If the
answer is "many" or "no", restructure first — usually by consolidating
parallel maps, hoisting a duplicated constant, or co-locating data with
the operations on it. See `rules/maintainability.md` §3.

---

## When Things Conflict

These principles will sometimes pull against each other. Defaults:

- **Readability vs. performance** → readability wins until a profile says
  otherwise.
- **DRY vs. clarity** → clarity wins **for code shapes that happen to look
  alike**: two slightly-different 5-line blocks beat one 12-line generic
  helper that takes flags. But DRY wins **for the same concept** —
  duplicated constants, parallel maps over the same union, and
  re-implementations of an existing utility must be consolidated. The test
  is *meaning*, not *appearance*: if the two pieces must always change
  together to stay correct, they are one thing; if they merely share a
  shape, they are two.
- **Reuse vs. premature abstraction** → reuse existing utilities always;
  extract a *new* generic helper only on the third real caller. See the
  decision tree in `rules/maintainability.md` §4.
- **Short name vs. clear name** → clear name. `userPendingApproval` beats
  `usr`.
- **Guard clause vs. single-return-style** → guard clauses, unless the
  language/team strongly enforces single-return (e.g., some functional
  styles).
- **Co-location vs. layered folders** → co-locate the type, its metadata,
  and the functions that operate on it. A reader who lands on a union
  should not have to grep across `types/`, `constants/`, and `utils/` to
  understand it.

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

### Maintainability findings
- [file:line] [duplicated concept / parallel maps / shotgun-surgery risk] → [proposed consolidation]
- [estimated change footprint for the next obvious variant: N files, type-checked? yes/no]

### What's already good
- [brief notes on what to preserve]
```

The Maintainability findings section is required when the reviewed code
introduces or extends union types, enums, shared constants, or new
utilities. Skip it only when the change is purely local (a single
function's internals).

When invoked in authoring mode, just write the code. Apply the principles
silently. Don't narrate every guard clause — the user will see clean code
in the diff.
