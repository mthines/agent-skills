---
title: 'Naming — Names Are the Documentation'
impact: HIGH
tags:
  - naming
  - readability
  - clean-code
---

# Naming

Names are the most important readability lever. Code is read 10–100× more
than it's written; investing 30 seconds on a name saves hours of
"what was this?" later. A precise name removes the need for a comment.

## Principles

1. **Name by intent, not implementation.** `userIdsToNotify` beats
   `filteredArray`. The first explains *why*; the second only restates *what*.
2. **Length should match scope.** A loop index `i` is fine in a 3-line loop;
   a module-level export should be a full descriptive name. Long-lived =
   long-named.
3. **Avoid noise words.** `data`, `info`, `value`, `manager`, `helper`,
   `util` carry no meaning. If you must use them, prefix or suffix with the
   domain noun: `customerInfo` is at least slightly better than `info`.
4. **Be searchable.** A name that appears in the codebase 30 times is much
   easier to refactor than one that's a generic word like `process`. Prefer
   distinct, googleable names.
5. **One concept, one word.** Don't mix `fetch`/`get`/`retrieve` for the
   same operation in the same codebase. Pick one and stick with it.

## Functions: Verbs

Function names should be verbs or verb phrases that describe what the
function *does* or *returns*.

| Pattern | Example | When |
|---|---|---|
| `getX` | `getUserById` | Retrieves a value, may compute |
| `fetchX` | `fetchOrder` | Asynchronous, usually network/IO |
| `loadX` | `loadConfig` | Reads from disk/cache |
| `buildX` | `buildRequest` | Pure construction |
| `isX` / `hasX` / `canX` | `isAuthenticated`, `hasPermission` | Returns boolean |
| `computeX` / `calculateX` | `calculateTotal` | Pure transformation |
| `toX` | `toJson` | Conversion |
| `ensureX` | `ensureDirectory` | Idempotent setup |
| `createX` / `deleteX` / `updateX` | CRUD operations | Side effects |

Avoid vague verbs: `handle`, `process`, `manage`, `do`. They mean nothing
on their own. `handleClick` is OK in a UI framework where the convention is
established; `handleOrder` is not.

## Variables: Nouns

Variable names should be nouns or noun phrases describing the value they
hold.

| Antipattern | Why Bad | Fix |
|---|---|---|
| `data`, `result`, `tmp` | No meaning | Use the domain noun |
| `arr`, `list`, `obj` | Type-hungarian | The type system already tells you |
| `myUser` | The `my` prefix is noise | `currentUser` |
| `userObj` | Type suffix is noise | `user` |
| `e` (in catch) | OK if scope is tiny; otherwise `error` | Match scope |

### Booleans

Boolean names should read like questions or assertions:

- `isActive`, `hasPermission`, `canEdit`, `shouldRetry`, `wasSuccessful`
- Avoid negatives: `isNotActive` becomes a double-negative when used in
  conditions (`if (!isNotActive)`). Use `isActive` and let callers negate.

### Collections

Plural for collections, singular for items:

```javascript
const users = await fetchUsers();
for (const user of users) { ... }
```

If the collection has a specific shape, name it: `userById`, `errorsByField`.

## Avoid Mental Mapping

If a reader has to translate the name to understand it, the name is wrong.

```javascript
// Forces mental mapping
const r = await db.query('select * from users');
const arr = r.rows;
for (let i = 0; i < arr.length; i++) {
  const u = arr[i];
  send(u.e);
}

// Self-documenting
const result = await db.query('select * from users');
for (const user of result.rows) {
  sendNotification(user.email);
}
```

## Domain Vocabulary

Use the words the business uses. If the team calls them "tickets," don't
rename them to "issues" in code. Consistency between code and conversation
is a productivity multiplier — Slack discussions, support tickets, and
the codebase all become greppable as one corpus.

## Renaming Is Cheap

Modern editors rename across a project safely. If you find a bad name, fix
it. Bad names compound: every reader pays the cost forever, and the
"workarounds" (comments, helper functions named after the bad name)
multiply.

## Anti-Patterns to Watch For

- **Encoded names** (`strUserName`, `arrItems`, `m_count`) — your type
  system / IDE already conveys this.
- **Disinformation** (`accountList` that's actually a `Map`) — match the
  noun to the actual structure.
- **Number suffixes** (`user1`, `user2`) — there's a real distinction;
  surface it (`existingUser`, `incomingUser`).
- **Made-up abbreviations** (`usrCnt`, `mngr`) — type the four extra
  characters.
- **Cute names** (`unicornify`, `magicSauce`) — funny once, confusing
  forever.

## When Single-Letter Names Are Fine

- Loop indices in tight scope: `for (let i = 0; i < n; i++)`
- Math formulas where letters match the equation: `f(x) = a*x^2 + b*x + c`
- Lambda parameters in trivial transforms: `users.map(u => u.id)` — though
  even here `users.map(user => user.id)` is barely more typing and reads
  better.
