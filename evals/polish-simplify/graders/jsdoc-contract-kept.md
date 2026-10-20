---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: '/\*\*[ \t]*\n[ \t]*\*[ \t]*[A-Za-z][^\n]*\n(?:(?!\*/)[\s\S])*@param\b(?:(?!\*/)[\s\S])*@returns?\b(?:(?!\*/)[\s\S])*\*/\s*export function shippingCost\b'
---

`shippingCost` still has a JSDoc block directly above it that opens with a summary line and keeps an `@param` and an `@returns` tag.
