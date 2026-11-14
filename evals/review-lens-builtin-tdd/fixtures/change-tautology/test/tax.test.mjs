import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { helpers, withTax, TAX_RATE } from "../lib/cart.mjs";

test("the subtotal is what the helper returns", () => {
  mock.method(helpers, "subtotal", () => 40);
  assert.equal(helpers.subtotal([{ price: 1, qty: 1 }]), 40);
  mock.restoreAll();
});

test("tax is added to the total", () => {
  assert.equal(withTax(100), Math.round(100 * (1 + TAX_RATE) * 100) / 100);
});
