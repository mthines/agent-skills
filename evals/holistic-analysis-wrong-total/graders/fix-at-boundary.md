---
type: llm
---

PASS if the reply (a) traces the data through `load.mjs` → `pricing.mjs` → `format.mjs`, (b) explains that the money fields arrive as strings from the export and `orderTotal` adds the string `shipping` to a number, and (c) recommends converting the money fields to numbers (or integer cents) once at the load boundary in `load.mjs`, and removing or not relying on the `parseFloat` patch in `format.mjs`.
FAIL if the reply's recommended fix is only another patch in `format.mjs` or only a local `Number(order.shipping)` in `pricing.mjs` without addressing the fact that every money field enters as a string.
