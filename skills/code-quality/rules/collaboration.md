---
title: 'Collaboration — Code as Something Other People Maintain'
impact: MEDIUM
tags:
  - collaboration
  - pr-scope
  - migration
  - symmetry
  - legacy
---

# Collaboration

Code is read and changed by other people, including future you.
This rule covers the practices that keep the collaboration loop fast: matching neighbours, keeping changes reviewable, evolving safely, and working with code you did not write.

## 1. Symmetry with Neighbours

Before writing a new file in an existing module, **read 2–3 neighbour files** and match their structure.
New code that looks like a stranger forces every reader to context-switch.

### What to match

- Folder layout and file naming convention.
- Import order (external first, then internal, then relative — or whatever the convention is).
- Error shape (`Result<T, E>` vs. throw; custom error class names).
- Test framework, test file location, test naming pattern.
- Logging / telemetry shape.
- Default export vs. named exports.
- Function declaration vs. arrow expression for top-level functions.

### When to deviate

Deviation requires a reason that holds up in code review.
"I prefer X" is not a reason.
"The existing pattern blocks the type system from catching Y" is.

If the surrounding pattern is genuinely worse, the right move is usually a separate refactor PR that updates the neighbours, then the new code matches the new pattern.

## 2. PR Scope: One Logical Change Per PR

A PR that mixes "rename `UserService` to `AccountService`" and "add billing reminder" gets either rubber-stamped or rejected on the wrong grounds.

### Rules

- **Refactor PR ≠ feature PR.**
  A refactor that changes structure but not behaviour is reviewable in its own right.
  A feature that builds on the refactor is reviewable in its own right.
  Mixed, neither is.
- **Cap diffs.**
  Above ~500 lines, the review quality drops sharply.
  Split into smaller PRs that each make sense independently.
- **One concept per commit.**
  Squash noise; keep meaningful commits.
- **Format / whitespace changes go in their own commit** if unavoidable, so the substantive review surface is clean.

### Splitting strategies

- Refactor → tests still green → ship.
- Add the new code path behind a flag → tests for both → ship.
- Migrate callers in batches → ship each batch.

## 3. Migration & Evolution Discipline

Code lives longer than the people who write it.
Changes that break callers must be planned to ship safely.

### Two-phase rule for breaking changes

1. **Add** the new shape; both old and new work.
2. **Remove** the old shape after callers migrate.

Never break-and-remove in the same release.

### Deprecation path

```typescript
/**
 * @deprecated Use {@link parseOrderV2} — this signature loses currency information.
 * Will be removed in v3.0.
 */
export function parseOrder(input: string): OrderV1 { /* ... */ }
```

- Mark with `@deprecated` JSDoc so editors warn the caller.
- Provide the replacement and a clear migration note.
- Optionally `console.warn` once per process — do not warn per call.
- Set a removal target (version or date) and stick to it.

### Schema evolution

- **Additive changes** (new optional field, new enum variant) are usually safe.
- **Subtractive changes** (removing a field, narrowing a type) require a deprecation pass first.
- Every consumer of a wire schema must validate (`Schema.parse`) — otherwise schema evolution silently breaks consumers.
  See `error-handling.md` Schema-First Validation.

## 4. Working with Legacy Code

Different rules apply when modifying code you did not write.
A clean-code rewrite of a 5-year-old module is rarely the right move.

### Order of operations

1. **Characterise.**
   Add tests that capture what the code currently does — bugs included.
   Without these, refactoring is gambling.
2. **Make it safe to change.**
   Extract small seams (a function, a parameter, an interface) that let you test the part you need to touch.
3. **Make the change.**
   Apply the rules in this skill to the part you are touching.
4. **Stop.**
   Out-of-scope cleanup belongs in a separate PR.

### Boy Scout Rule (with limits)

Leave the file slightly better than you found it — but do not rewrite it.
A renamed variable, a deleted dead branch, a guard clause unstacked — these are fine.
A wholesale restructure mid-feature-PR is not.

### Anti-patterns

- "While I'm here, let me also..." — scope creep that makes review impossible.
- "The whole module is bad; let me start over" — usually loses behavioural details that turn into bug reports.
- Deleting tests because they "look outdated" — the tests are the only documentation of the prior behaviour.

## 5. Diff Hygiene

Make the review easier on the reviewer.

- **Logical commits.**
  Each commit makes sense on its own and could be reverted independently.
- **Self-explanatory commit messages.**
  The first line summarises *why*; the body fills in the *how* if non-obvious.
  See the repo's existing commit style.
- **Do not reformat files you are touching for substance.**
  Reformat in a separate, label-only commit (or PR) so the substantive diff is reviewable.
- **One concern per file change.**
  If a file change touches three concerns, the PR probably should have been three PRs.

## 6. Communication in Reviews

Lifted from `review-checklist.md` "Tone" — repeated here because reviewing is collaboration:

- Lead with the *why*, not the prescription.
- Show the change with a concrete diff, not a paragraph.
- Acknowledge what is working.
- Match severity to impact — do not mark stylistic preferences "high priority".

## 7. Future-Proofing Smell (Cross-Reference)

The collaboration counterpart to "do not pre-build for futures that haven't arrived":

- Unused parameters / options "for future use" → delete.
- Abstractions with one concrete implementation → inline.
- Feature flags wrapping non-released code paths → justified or removed.
- Backwards-compatibility shims for code nobody calls → delete.

Code that lives forever despite no caller is a maintainability tax compounding silently.
