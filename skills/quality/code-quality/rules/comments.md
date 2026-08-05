---
title: 'Comments — Earn Their Place'
impact: MEDIUM
tags:
  - comments
  - documentation
---

# Comments

The default is no comment. Most comments are noise: they restate the code,
go stale as the code changes, and lull readers into trusting documentation
that no longer matches reality. A comment must earn its place by saying
something the code itself cannot.

## Contents

- [When a Comment Earns Its Place](#when-a-comment-earns-its-place)
- [Brevity — Trim to the WHY](#brevity--trim-to-the-why)
- [When to Delete a Comment](#when-to-delete-a-comment)
- [Docstrings / API Documentation](#docstrings--api-documentation)
- [Comments in Tests](#comments-in-tests)
- [Block Comments / Section Headers](#block-comments--section-headers)
- [Commented-Out Code](#commented-out-code)
- [TODO / FIXME / HACK](#todo--fixme--hack)
- [Why-Heavy, Not What-Heavy](#why-heavy-not-what-heavy)

## When a Comment Earns Its Place

Keep a comment if it captures one of these:

1. **A non-obvious WHY.** "We retry 3× because the upstream service
   occasionally drops connections during deployment windows."
2. **A hidden constraint.** "Order matters here — `applyDiscount` must run
   before `applyTax` because tax is computed on the discounted price."
3. **A subtle invariant.** "This list is always sorted; callers depend on
   that."
4. **A workaround for a specific bug or limitation.** "Workaround for
   [link to upstream issue]; remove when the fix lands in v2.4."
5. **A surprising performance choice.** "Using a `Map` here even though
   the list is small — measured 30% faster than `Array.find` on real input
   profiles."

## Brevity — Trim to the WHY

A comment that earns its place still has to stay short. There is no hard
length cap — a genuinely subtle constraint may justify a paragraph — but
the default is **the shortest form that preserves the WHY**. Multi-sentence
narration, paragraph blocks above a 3-line function, and friendly
"introductions" to obvious code are noise, even if every sentence is true.

Heuristics, in order:

1. **One line by default.** If you cannot say it in one line, ask whether
   half of what you wrote is the WHAT (which the code already says) and
   delete that half.
2. **Cut the preamble.** "This function does X. The reason we do it this
   way is Y." → "Y." The reader is already reading the function.
3. **No restating the diff.** "Added Z to fix bug N." belongs in the commit
   message and PR description, not in the source.
4. **Two paragraphs ⇒ docstring or design doc.** If the explanation
   genuinely needs paragraphs, it is API documentation (move to the
   docstring) or design rationale (move to `docs/`, an ADR, or a linked
   issue) — not an inline comment.
5. **Bullet lists in comments are a smell.** Three bullets above one
   function usually means three separate things are happening in that
   function — split the function instead.

```javascript
// Bad: paragraph above a 3-line function, mostly restating the code
// This function computes the discounted total for a cart. It walks each
// line item, applies the per-item discount, then sums the result. We do
// this on the server so the client cannot tamper with the price. Note
// that tax is applied after this step, not here.
function discountedTotal(items) {
  return items.reduce((sum, i) => sum + i.price * (1 - i.discount), 0);
}

// Good: one line, captures the only thing the code doesn't say
// Tax applied later — keep this in sync with applyTax().
function discountedTotal(items) {
  return items.reduce((sum, i) => sum + i.price * (1 - i.discount), 0);
}
```

When in doubt, **trim first, delete second, keep third**. See refactor
recipe **R35: Trim Verbose Comment** for the mechanical procedure.

## What to Never Delete (trim instead)

Before you reach for the delete key, these categories are **always trimmed, never removed**:

1. **Docstring / JSDoc / TSDoc / Python docstring / KDoc / JavaDoc blocks attached to a function, method, class, type, interface, hook, or exported constant.** Even if the block currently restates the code, it is structured API documentation that tools (IDE hover, type generators, doc sites, LSP completions) read. Apply **R35 step 4**: keep the one-sentence summary plus `@param` / `@returns` / `@throws` (or the language equivalent), drop the prose essay and any restated WHAT. Do not delete the block to get to zero comments — the reader loses hover docs.
2. **License / copyright / SPDX headers** at the top of a file. These are policy artefacts.
3. **`@deprecated`, `@internal`, `@experimental`, `@since`, `@see`** and other contract-bearing JSDoc tags. They participate in tooling contracts even when the surrounding prose is verbose.
4. **Linter or type-checker pragmas** (`eslint-disable-next-line`, `@ts-expect-error`, `# noqa`, `# type: ignore`). These are behaviour, not commentary.

The category test is structural, not semantic: if the block sits directly above an exported or otherwise documented declaration and uses the language's doc-comment syntax (`/** … */`, `"""…"""`, `///`), it is in this category. Trim verbosely; never delete.

## When to Delete a Comment

Delete or replace with code if the comment is one of these — **and** it is not in the "never delete" categories above:

1. **Restates what the code obviously does.**
   ```javascript
   // Increment count
   count++;
   ```
   Delete.
2. **Says what a name could say.** Rename instead.
   ```javascript
   // The user's full name including title
   const n = `${title} ${firstName} ${lastName}`;
   // Better:
   const fullNameWithTitle = `${title} ${firstName} ${lastName}`;
   ```
3. **References the current task / PR / ticket.** That's PR description
   territory; comments rot when the PR ships.
   ```javascript
   // Added for PR-1234 to fix login bug
   ```
   Delete. Git blame and the commit message preserve this.
4. **Is a TODO without a date or owner.** A TODO with no plan is just
   ambient guilt. Either fix it now, file an issue with a link, or delete.
5. **Describes a removed thing.**
   ```javascript
   // Removed: legacy auth flow
   ```
   Just remove the code; git keeps history.

## Docstrings / API Documentation

Public APIs (libraries, exported functions, anything other teams call)
benefit from docstrings that document:

- **What it does** in one sentence.
- **Parameters and return type** if not obvious from types.
- **Errors thrown** and conditions that trigger them.
- **Examples** for non-trivial usage.

For private/internal functions, types and good names usually suffice; a
docstring is overhead.

### Hard rule for auto-fix runs

When the skill runs as part of an automated pass (e.g. `create-pr` Step 6.5,
the `tdd` REFACTOR phase, or any non-interactive review): **never delete a
docstring/JSDoc block as a noise-removal action**. The block is part of
the function's API surface — IDEs read it, type stripping tools read it,
documentation generators read it, and the next reader hovers it.

What the auto-fix runner is allowed to do to a docstring block:

- **Trim verbose prose** down to a one-sentence summary plus the structured
  tags (`@param`, `@returns`, `@throws`, `@example`, `@see`, `@deprecated`,
  `@since`, `@internal`, `@experimental`).
- **Remove restated-WHAT sentences** inside the block (the prose that just
  paraphrases the code), but keep at least the summary line.
- **Rewrite a paragraph essay** into one or two terse sentences using
  **R35 step 4**.

What the auto-fix runner must **not** do:

- Delete the whole `/** … */` (or `"""…"""`, `///`) block, even if the
  current contents look like pure WHAT. Trim it instead. A one-line
  summary is fine; zero is not.
- Strip the structured tags. `@deprecated` and `@param` outlive the
  surrounding prose and feed tooling contracts.
- Merge two adjacent function-level docstrings into a file-level comment.

If the docstring is genuinely empty after trimming (no summary, no tags,
no contract-bearing content remains), surface it to the human reviewer as
a judgment-required finding — do not silently remove it.

## Comments in Tests

Tests can occasionally use comments to mark sections (`// Arrange`, `// Act`,
`// Assert`) when the structure isn't obvious. But if the test is named
well and small, the structure is visible. Don't paste this template into
every test reflexively.

## Block Comments / Section Headers

```javascript
// =====================================
// VALIDATION
// =====================================
```

These usually indicate the function or file is too large. Split into
smaller units instead of using comments to navigate.

## Commented-Out Code

Delete it. Always. Git history exists. Commented code accumulates and
nobody knows whether it's important. If a future-you needs to recover it,
`git log -S` finds it instantly.

## TODO / FIXME / HACK

These are useful when used sparingly and with discipline:

- **TODO**: a known improvement, ideally with a link to a tracking issue.
- **FIXME**: known broken, with a description of how it breaks.
- **HACK**: known suboptimal, with the reason and a path forward.

Without a tracker link or a date, these comments become permanent
furniture. Better: file the issue, link to it, then delete the comment
when the issue closes.

## Why-Heavy, Not What-Heavy

The reader can read the code; you don't need to translate it. They
*can't* read the constraints, history, and tradeoffs that shaped the code.
That's what comments are for.

```javascript
// Bad: restates the code
// Loop through users and send emails
for (const user of users) sendEmail(user);

// Good: explains the why
// Sequential (not parallel) because the email provider rate-limits at 5/sec
// and we don't have a queue yet — see TICKET-432
for (const user of users) await sendEmail(user);
```
