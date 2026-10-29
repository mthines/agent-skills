---
type: regex
pattern: '## Findings file[\s\S]*\[lens:tdd\][\s\S]{0,400}(import|re-?declar|cop(y|ies)|by construction|own (copy|version)|duplicat)'
flags: i
---

A finding tagged `[lens:tdd]` says `test/price.test.mjs` tests its own copy of `applyDiscount` instead of importing `lib/price.mjs`, so it passes whatever production does.
