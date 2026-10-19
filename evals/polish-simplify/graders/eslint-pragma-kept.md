---
type: regex
target: { source: file, path: src/cart.mjs }
pattern: '// eslint-disable-next-line max-params[ \t]*\n[ \t]*export function lineTotal\(unitCents, qty, discountPct, taxPct\)'
---

The `eslint-disable-next-line max-params` pragma still sits directly above the unchanged four-parameter `lineTotal` signature.
