---
type: regex
pattern: '## Findings file[\s\S]*discount\.test\.mjs[\s\S]{0,600}(mock|stub|call ?count|callCount|implementation|internal|own helper)'
flags: i
---

A finding on `test/discount.test.mjs` says the test mocks the module's own helpers and asserts their call count and arguments, so it checks the implementation and never runs the real discount: a rule the built-in `tdd` lens states ("mocks only at the boundary", "survives a refactor").
