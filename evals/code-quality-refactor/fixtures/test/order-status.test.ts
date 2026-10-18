import test from "node:test";
import assert from "node:assert/strict";
import { statusLabel, statusColor, canRefund } from "../src/order-status.ts";

test("labels", () => {
  assert.equal(statusLabel("pending"), "Awaiting payment");
  assert.equal(statusLabel("paid"), "Paid");
  assert.equal(statusLabel("shipped"), "On its way");
  assert.equal(statusLabel("cancelled"), "Cancelled");
});

test("colors", () => {
  assert.equal(statusColor("pending"), "amber");
  assert.equal(statusColor("cancelled"), "grey");
});

test("refund window", () => {
  assert.equal(canRefund({ status: "paid", total: 10, daysSincePaid: 3 }), true);
  assert.equal(canRefund({ status: "shipped", total: 10, daysSincePaid: 30 }), true);
  assert.equal(canRefund({ status: "shipped", total: 10, daysSincePaid: 31 }), false);
  assert.equal(canRefund({ status: "pending", total: 10, daysSincePaid: null }), false);
  assert.equal(canRefund({ status: "cancelled", total: 10, daysSincePaid: 1 }), false);
  assert.equal(canRefund({ status: "paid", total: 0, daysSincePaid: 1 }), false);
});
