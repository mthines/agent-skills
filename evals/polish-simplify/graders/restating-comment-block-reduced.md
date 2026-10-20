---
type: regex
target: { source: file, path: src/shipping.mjs }
pattern: '(?:^[ \t]*//.*\n){4,}'
flags: m
match: not_contains
---

No run of four or more consecutive `//` line comments remains in `src/shipping.mjs`: the eight-line block restating what `shippingCost` does is removed or cut to at most three lines.
