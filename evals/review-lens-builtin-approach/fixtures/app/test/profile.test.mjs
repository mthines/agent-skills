import { test } from "node:test";
import assert from "node:assert/strict";
import { teamNames } from "../services/accounts/profile.mjs";

test("team names come back in member order", async () => {
  assert.deepEqual(await teamNames([2, 1]), ["Linus", "Ada"]);
});
