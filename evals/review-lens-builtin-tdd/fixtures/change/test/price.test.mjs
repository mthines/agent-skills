import { test } from "node:test";
import assert from "node:assert/strict";

function applyDiscount(total, code) {
  if (code === "SAVE10") return Math.round(total * 0.9 * 100) / 100;
  if (code === "SAVE20") return Math.round(total * 0.8 * 100) / 100;
  return total;
}

test("SAVE20 takes 20% off", () => {
  assert.equal(applyDiscount(100, "SAVE20"), 80);
});
