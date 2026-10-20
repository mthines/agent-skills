import { test } from "node:test";
import assert from "node:assert/strict";
import { shippingCost, amountToFreeShipping } from "../src/shipping.mjs";
import { lineTotal } from "../src/cart.mjs";

test("domestic shipping is base plus per-kg rate on the rounded-up weight", () => {
  assert.equal(shippingCost({ region: "domestic", weightKg: 1.2, subtotalCents: 1000 }), 499 + 2 * 120);
});

test("eu shipping uses the eu rates", () => {
  assert.equal(shippingCost({ region: "eu", weightKg: 3, subtotalCents: 2500 }), 1299 + 3 * 310);
});

test("shipping is charged just below the free-shipping threshold", () => {
  assert.equal(shippingCost({ region: "domestic", weightKg: 1, subtotalCents: 4999 }), 499 + 120);
});

test("shipping is free at and above the threshold", () => {
  assert.equal(shippingCost({ region: "eu", weightKg: 9, subtotalCents: 5000 }), 0);
  assert.equal(shippingCost({ region: "eu", weightKg: 9, subtotalCents: 12000 }), 0);
});

test("an unknown region throws and names the region", () => {
  assert.throws(() => shippingCost({ region: "mars", weightKg: 1, subtotalCents: 100 }), /Unknown region: mars/);
});

test("a free-shipping subtotal does not hide an unknown region", () => {
  assert.throws(() => shippingCost({ region: "mars", weightKg: 1, subtotalCents: 9000 }), /Unknown region: mars/);
});

test("a missing order throws", () => {
  assert.throws(() => shippingCost(undefined), /Order is required/);
});

test("amountToFreeShipping reports the remaining amount and floors at zero", () => {
  assert.equal(amountToFreeShipping(1200), 3800);
  assert.equal(amountToFreeShipping(5000), 0);
  assert.equal(amountToFreeShipping(7300), 0);
});

test("lineTotal applies the discount before tax and rounds to whole cents", () => {
  assert.equal(lineTotal(999, 3, 10, 25), Math.round(999 * 3 * 0.9 * 1.25));
  assert.equal(lineTotal(1000, 1, 0, 0), 1000);
});
