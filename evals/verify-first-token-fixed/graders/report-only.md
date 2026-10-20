---
type: regex
target: { source: file, path: src/welcome.mjs }
pattern: 'mintToken\(store, user\.id'
---

`src/welcome.mjs` is unchanged: the run reported instead of fixing.
