// @ts-check
import { match, normalizeFull, renderTable, usageLine, TOLERANCE } from "./lite-compare.mjs";

const checks = /** @type {{name:string,fn:()=>void}[]} */ ([]);
const check = (/** @type {string} */ name, /** @type {()=>void} */ fn) => checks.push({ name, fn });
const eq = (/** @type {any} */ a, /** @type {any} */ b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

check("overlap: same path within the tolerance matches, one beyond does not", () => {
  const m = match([{ path: "a.ts", line: 10 }, { path: "a.ts", line: 50 }], [{ path: "a.ts", line: 13 }, { path: "a.ts", line: 54 }]);
  eq([m.overlap.length, m.liteOnly.length, m.fullOnly.length], [1, 1, 1]);
  eq(TOLERANCE, 3);
});

check("lite-only: a finding on another path is lite-only and the other side is full-only", () => {
  const m = match([{ path: "a.ts", line: 5 }], [{ path: "b.ts", line: 5 }]);
  eq([m.overlap.length, m.liteOnly.length, m.fullOnly.length], [0, 1, 1]);
});

check("full-only: unmatched full comments are listed with their first body line", () => {
  const m = match([], [{ path: "a.ts", line: 1, body: "first\nsecond" }]);
  eq(m.fullOnly.length, 1);
  const t = renderTable(m, null);
  if (!t.includes("full-only `a.ts:1` first") || t.includes("second")) throw new Error(t);
});

check("one-to-one: two lite findings near one full comment match once, nearest first", () => {
  const m = match([{ path: "a.ts", line: 12 }, { path: "a.ts", line: 10 }], [{ path: "a.ts", line: 10 }]);
  eq([m.overlap.length, m.liteOnly.length], [1, 1]);
  eq(m.overlap[0].lite.line, 10);
});

check("deterministic: the same input gives the same output", () => {
  const l = [{ path: "a", line: 1 }, { path: "a", line: 2 }]; const f = [{ path: "a", line: 2 }, { path: "a", line: 1 }];
  eq(match(l, f), match(l, f));
});

check("normalize: drops replies, outdated comments, and filters by author", () => {
  const raw = [{ path: "a", line: 4, body: "x", user: { login: "bot" } }, { path: "a", line: null, original_line: null, body: "y", user: { login: "bot" } }, { path: "b", line: 7, body: "z", user: { login: "human" } }];
  eq(normalizeFull(raw).map((c) => `${c.path}:${c.line}`), ["a:4", "b:7"]);
  eq(normalizeFull(raw, "bot").length, 1);
  const withReply = [{ path: "a", line: 4, body: "finding", user: { login: "bot" } }, { path: "a", line: 4, in_reply_to_id: 1, body: "Fixed in abc", user: { login: "me" } }, { path: "a", line: null, original_line: 9, body: "outdated", user: { login: "bot" } }];
  eq(normalizeFull(withReply).map((c) => c.body), ["finding"]);
});

check("usage: the table carries per-stage usage, and says so when absent", () => {
  const u = { review: { calls: 3, input: 1, cache_read: 2, cache_write: 3, output: 4, usd: null }, reflect: { calls: 1, input: 0, cache_read: 0, cache_write: 0, output: 5, usd: 0.5 } };
  const t = renderTable(match([], []), u);
  if (!t.includes("review: 3 calls") || !t.includes("$0.5")) throw new Error(t);
  eq(usageLine(null), "usage: not recorded");
});

export function selfTest() {
  let failed = 0;
  for (const c of checks) {
    try { c.fn(); process.stdout.write(`✓ ${c.name}\n`); } catch (e) { failed++; process.stdout.write(`✗ ${c.name}: ${/** @type {any} */ (e)?.message || e}\n`); }
  }
  if (failed) { process.stdout.write(`✗ lite-compare self-test: ${failed} of ${checks.length} failed\n`); return 1; }
  process.stdout.write(`✓ lite-compare self-test: all ${checks.length} checks passed\n`);
  return 0;
}
