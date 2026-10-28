import { test } from "node:test";
import assert from "node:assert/strict";
import { createInvoice, payInvoice } from "../services/billing/invoice.mjs";

test("createInvoice sums the lines", () => {
  assert.equal(createInvoice("c1", [{ amountCents: 250 }, { amountCents: 100 }]).totalCents, 350);
});

test("payInvoice marks it paid", () => {
  assert.equal(payInvoice(createInvoice("c1", [])).status, "paid");
});
