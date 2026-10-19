---
type: llm
focus: { source: file, path: src/shipping.mjs }
---

This is a JavaScript module after a cleanup pass. Judge only the code, not the comments.

PASS only if ALL of the following hold:
1. `shippingCost` uses early-return / guard-clause style: no `if` is nested more than one level deep inside it, and no `else` follows a `return`.
2. `shippingCost` still behaves exactly like this original logic: throws `Error("Order is required")` when the order is falsy; otherwise throws `Error(\`Unknown region: ${order.region}\`)` when the region is not in the rate table, even if the subtotal would qualify for free shipping; otherwise returns 0 when `subtotalCents >= 5000`; otherwise returns `rate.base + Math.ceil(order.weightKg) * rate.perKg`.
3. `amountToFreeShipping` still returns 0 for subtotals at or above 5000 and `5000 - subtotalCents` below it.
4. The exported names `shippingCost` and `amountToFreeShipping` and their parameter lists are unchanged.

FAIL if any of these does not hold, for example a remaining three-level `if` pyramid, a reordered check that makes a free-shipping subtotal skip the unknown-region error, or a changed threshold comparison.
