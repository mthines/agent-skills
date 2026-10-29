import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { checkout, helpers } from "../lib/cart.mjs";

test("checkout applies the discount code", () => {
  mock.method(helpers, "subtotal", () => 100);
  const discount = mock.method(helpers, "discount", () => 90);
  const result = checkout({ items: [], code: "SAVE10" });
  assert.equal(discount.mock.callCount(), 1);
  assert.deepEqual(discount.mock.calls[0].arguments, [100, "SAVE10"]);
  assert.equal(result.total, 90);
  mock.restoreAll();
});
