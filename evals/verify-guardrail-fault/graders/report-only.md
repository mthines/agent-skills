---
type: regex
target: { source: file, path: src/welcome.mjs }
pattern: 'await ctx\.audit'
---

The run reported instead of fixing: the code under test is unchanged.
