---
type: regex
target: { source: file, path: src/welcome.mjs }
pattern: 'await ctx\.audit'
---

`src/welcome.mjs` still awaits the audit write: the run reported instead of fixing.
