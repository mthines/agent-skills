---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: '/\*\*[ \t]*\n(?:[ \t]*\*(?!/)[^\n]*\n){1,6}[ \t]*\*/\s*export function shippingCost\b'
---

The `shippingCost` JSDoc block is at most six lines between its delimiters (it was twelve): the restating prose paragraph is trimmed.
