import { test } from "node:test";
import assert from "node:assert/strict";
import { subtotal } from "../src/cart.mjs";

test("subtotal sums unit price times quantity", () => {
  assert.equal(subtotal([{ unitCents: 250, qty: 2 }, { unitCents: 100, qty: 1 }]), 600);
});
