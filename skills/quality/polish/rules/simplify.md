---
title: Simplify — apply mechanical cleanups to the branch diff
impact: HIGH
tags: [simplify, comments, dead-code, guard-clauses, refactor]
---

# Simplify

Load for Pass B (`simplify`) and Pass C (`quick`).
This rule applies cleanups to the code the branch changed, one change at a time, each behind a fast check.
It is the only simplify engine in this repo; callers reach it through `Skill("polish", "simplify")`.

| Invocation | Scope | Items | Writes |
| --- | --- | --- | --- |
| `simplify` | branch diff | 1–9 | yes |
| `simplify <path>` | files under `<path>` | 1–9 | yes |
| `simplify dry-run` | branch diff | 1–9 | no, report only |
| `quick` | branch diff | 1, 2, 3, 5, 9 | yes |

## Step 1 — Resolve scope and the fast check

```bash
git diff --name-only origin/main...HEAD   # files in scope
git diff -U0 origin/main...HEAD           # hunks in scope
```

Only files and hunks in this diff are in scope.
Never touch a line the branch did not add or change.

Pick the fast check from the project, in this order: the test command (`package.json` `scripts.test`, `Makefile` `test`, `pytest`, `go test ./...`, `cargo test`), then a `lint` and a `typecheck` script when present.
Scope the test run to the affected files when the runner supports it.
Run the fast check once before any change.
If it is red before you start, stop and report `simplify: checks are red before any change — not simplifying.`
If no fast check exists, run as `dry-run`.

## Step 2 — Apply the items, one change at a time

Walk the scoped files in order, and within each file walk the items below in order.
Apply an item only when it leaves observable behaviour unchanged: same return values, same thrown errors, same error precedence, same side effects, same exported names and signatures.
These items are mechanical: apply them, do not propose them.

1. **Restating comments.**
   Delete a comment that says WHAT the next lines do.
   Keep a WHY comment (constraint, invariant, workaround, surprising choice), cut to at most 3 lines.
   Delete every internal ticket or task reference (`ENG-1234`, `LIN-482`, `TODO(AI-12)`, "added for …", "fixes PR …"); delete the comment when nothing else is left.
   An upstream vendor or library issue link on a workaround stays.
2. **Docstrings** (JSDoc, TSDoc, Python docstrings) on functions, classes, types, and exported constants.
   Never delete the block.
   Trim it to a one-sentence summary plus the contract tags: `@param`, `@returns`, `@throws`, `@deprecated`, `@since`, `@example`, `@see`, `@internal`, `@experimental`.
   If trimming would leave it empty, surface it instead.
3. **Never remove** a license or SPDX header, or a linter or type pragma (`eslint-disable-next-line`, `@ts-expect-error`, `# noqa`, `# type: ignore`).
4. **Dead code the branch introduced** — unused functions, imports, variables, and unreachable branches.
   Grep the whole repo for the name first (`git grep -n '\bname\b'`); remove it only when the definition is the sole hit and the name is not exported.
5. **`else` after `return`, `throw`, `continue`, or `break`** — drop the `else` and outdent its body.
6. **Nesting of 3 or more levels** — flatten into guard clauses and early returns.
   Keep the original order of checks, so the same input still hits the same error first.
7. **A magic number or string used 2 or more times in the diff** — extract one named `const` at module scope and use it at every site.
8. **A helper the branch added that duplicates an existing one** — grep for the existing helper, and replace the new one when signatures are compatible.
   Match the naming and structure of neighbouring files.
9. **A cryptic local name** (`d`, `tmp`, `data`, `res`) — rename it to a domain noun when it is local to one function.

```js
// ✗ Before — restating comments, ticket ref, 3-level pyramid, else after return, repeated literal
// Check the user exists, then check the plan, then return the limit.
// TODO(ENG-77): keep in sync with billing.
function seatLimit(user) {
  if (user) {
    if (PLANS[user.plan]) {
      if (user.seats >= 50) {
        return 50;
      } else {
        return PLANS[user.plan].seats;
      }
    }
    throw new Error(`Unknown plan: ${user.plan}`);
  }
  throw new Error("User is required");
}

// ✓ After — same checks in the same order, same errors, one constant
const MAX_SEATS = 50;

function seatLimit(user) {
  if (!user) throw new Error("User is required");
  const plan = PLANS[user.plan];
  if (!plan) throw new Error(`Unknown plan: ${user.plan}`);
  if (user.seats >= MAX_SEATS) return MAX_SEATS;
  return plan.seats;
}
```

```js
// ✗ Wrong — reordering the guards changes which error wins
function seatLimit(user) {
  if (user?.seats >= MAX_SEATS) return MAX_SEATS; // now skips the unknown-plan error
  // ...
}
```

```js
// ✗ Wrong — the whole docstring deleted because its prose restated the code
export function total(items) { /* … */ }

// ✓ Right — the prose paragraph trimmed; summary and contract tags kept
/**
 * Sums the line totals in cents.
 * @param {Item[]} items - The cart lines.
 * @returns {number} The total in cents.
 */
export function total(items) { /* … */ }
```

## Step 3 — Gate every change

After each single change, run the fast check from Step 1.

- Green: keep the change and move on.
- Red: undo exactly that change (restore the previous text with Edit; never `git checkout` a file that holds earlier accepted changes), record it under **Reverted** with the failing check, and move on.
- Stop applying after 3 reverts in a row; list what remains under **Surfaced**.

Never fix a red check by editing, skipping, or deleting a test.
After the last change, run the full test command once and confirm it is green.

## Surface only — never apply

- A change to a public API, an exported name, an exported type, or a signature.
- A restructuring that spans files, or any edit outside the branch diff.
- Anything that would require editing a test.
- A behaviour change of any size, including reordering checks with side effects or different errors.

When unsure whether a change is in the list above or in Step 2, surface it.

## Step 4 — Report

```text
Simplify pass on <branch> (<N> files, <mode>)
Applied:
  - <file:line> [item <n>] <one line>
Reverted (check failed):
  - <file:line> [item <n>] <one line> — <failing check>
Surfaced (not applied):
  - <file:line> <one line> — <why it needs judgment>
Checks: <commands run> → <pass | fail>
```

Polish Step 3 commits the applied changes as one commit: `chore: simplify pass (mechanical refactors)` for `simplify`, `chore: quick pass (comments, naming)` for `quick`.
