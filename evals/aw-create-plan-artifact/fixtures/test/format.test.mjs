import test from "node:test";
import assert from "node:assert/strict";
import { formatTable } from "../src/format.mjs";

test("formatTable pads columns", () => {
  assert.equal(formatTable([{ name: "api", p95: 1 }]), "api             1");
});
