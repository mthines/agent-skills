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

## When to Delete a Comment

Delete or replace with code if the comment is one of these:

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
