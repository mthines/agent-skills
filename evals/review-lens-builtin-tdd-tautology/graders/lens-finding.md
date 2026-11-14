---
type: regex
pattern: '## Findings file[\s\S]*tax\.test\.mjs[\s\S]{0,600}(tautolog|re-?deriv|same formula|production formula|own return|returns? what (the|it) (mock|stub)|by construction|never (runs|exercises|calls))'
flags: i
---

A finding on `test/tax.test.mjs` says a test only asserts the value its mock was set up to return, or computes its expected value with the production formula, so it passes whatever the code does: rules the built-in `tdd` lens states ("asserts something the code produced", "expected values are literals, not re-derivations").
