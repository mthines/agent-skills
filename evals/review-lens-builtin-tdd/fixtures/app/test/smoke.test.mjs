import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../lib/price.mjs";

test("an unknown code leaves the total unchanged", () => {
  assert.equal(applyDiscount(50, "NOPE"), 50);
});
