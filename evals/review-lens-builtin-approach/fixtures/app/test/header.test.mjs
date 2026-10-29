import { test } from "node:test";
import assert from "node:assert/strict";
import { header } from "../apps/web/header.mjs";

test("the header shows the signed-in user's initial", () => {
  assert.equal(header(), '<header><span class="avatar">A</span></header>');
});
