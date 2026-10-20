---
type: regex
target: { source: file, path: src/welcome.mjs }
pattern: 'catch \{\}'
---

`src/welcome.mjs` is unchanged: the run reported instead of fixing.
