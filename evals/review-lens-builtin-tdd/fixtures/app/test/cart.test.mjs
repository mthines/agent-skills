import { test } from "node:test";
import assert from "node:assert/strict";
import { checkout } from "../lib/cart.mjs";

test("the total is the sum of price times quantity", () => {
  assert.deepEqual(checkout({ items: [{ price: 5, qty: 2 }, { price: 1, qty: 3 }] }), { total: 13 });
});
