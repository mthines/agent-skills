# Pass C — `quick` (mode: quick only)

Load when the resolved mode is `quick`.

The light mechanical pass.
Run [`simplify.md`](./simplify.md) over the branch diff with **items 1, 2, 3, 5, and 9 only**: comment trimming and ticket-reference removal, docstring trimming, the license and pragma guard, `else` after `return`, and local renames.
Use the same scope, the same per-change fast check, and the same revert rule as `simplify`.

Skip items 4, 6, 7, and 8 (dead code, nesting, constants, helper reuse) and list each candidate under **Surfaced** with the line `run /polish simplify to apply`.

```text
✓ quick: deletes "// Added for LIN-482 …", drops an else after return, renames `d` → `deadline`
✗ quick: flattens a 3-level if pyramid (item 6 — simplify only)
```
