---
type: regex
pattern: 'concatenat|string \+|29\.54\.99'
flags: i
---

The reply identifies the mechanism: `subtotal + order.shipping` concatenates the number with the string `"4.99"` (giving `"29.54.99"`, which `parseFloat` truncates to `29.54`).
