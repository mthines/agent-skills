#!/usr/bin/env node
// @ts-check
/**
 * merge-memory-record.mjs — the ONE implementation of Step 4d's read-merge-write for the
 * `knowledge::<symbol>@<path>` and `hotspot::<path>` records (rules/memory.md § Write).
 *
 * A LoreKit write to an existing scope + key replaces the whole value, so a write composed from
 * the rule file's template, or from a `view="summary"` preview, resets `history[]` and every
 * counter the record had built. This script makes the merge mechanical: it takes the verbatim
 * result of ONE batch `mcp__lorekit__memory_read refs=[…]` call that named every key the run is
 * about to write, plus the run's own contribution per key, and prints the exact values to write.
 * Every write it emits carries `merged_from`:
 *
 *   "read"    the key was in the read's `entries[]` with a full `value`; the update was merged onto it
 *   "absent"  the key was in the read's `missing[]`; the update is written as the first record
 *
 * Anything else is skipped, never written blind:
 *
 *   - a key the read did not name (neither in `entries[]` nor in `missing[]`)
 *   - an entry without a full `value` (a `memory_list` / `memory_search` summary: `preview`, `value_bytes`)
 *   - an existing value that is not a JSON object (a prose record cannot be merged mechanically)
 *   - an update whose `symbol`/`path` does not match its key, or a knowledge update with `facts`
 *     but no `verified_at_sha`
 *
 * Usage:
 *   node merge-memory-record.mjs --read <read.json> --updates <updates.json> [--now <ISO>] [--out <file>]
 *   node merge-memory-record.mjs --self-test
 *
 *   read.json     the memory_read result verbatim: {"entries":[{scope,key,value,…}],"missing":["scope::key",…]}
 *                 (an array of such results is accepted, for a run whose refs needed two calls)
 *   updates.json  [{"scope":"repo::o/r","key":"hotspot::src/a.ts","update":{…}}, …]
 *
 * Output: {"writes":[{scope,key,value,merged_from}],"skipped":[{scope,key,reason}],"dropped_fields":[…]}
 * `value` is the serialised string to pass verbatim as memory_write's `value`.
 * Exit 0 when the inputs parsed (skipped ops are listed, not fatal: fail the op, not the run);
 * exit 2 with EMPTY stdout on unreadable input, so a caller cannot write from a half-built plan.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MERGED_FROM = Object.freeze(["read", "absent"]);
export const LIST_CAP = 20;
export const TTL_DAYS = 90;

/** Top-level fields each record may carry (rules/memory.md § Write). Anything else is dropped. */
export const HOTSPOT_FIELDS = Object.freeze([
  "v", "path", "confirmed", "missed", "regressed", "flaky", "classes",
  "confirmed_examples", "missed_examples", "regressed_examples", "last_touched_by", "expires",
]);
export const KNOWLEDGE_FIELDS = Object.freeze([
  "v", "symbol", "path", "kind", "verified_at_sha", "contract", "facts", "consumer_files",
  "cross_package", "covering_tests", "traffic_band", "sampled_at", "history",
]);
const KNOWLEDGE_CARRIED = Object.freeze([
  "kind", "contract", "consumer_files", "cross_package", "covering_tests", "traffic_band", "sampled_at",
]);
const COUNTERS = Object.freeze(["confirmed", "missed", "regressed"]);

/** @param {string} key @returns {"knowledge"|"hotspot"|null} */
export function recordKind(key) {
  if (key.startsWith("knowledge::")) return "knowledge";
  if (key.startsWith("hotspot::")) return "hotspot";
  return null;
}

/** @param {any} v @returns {boolean} */
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** @param {any} v @returns {any[]} */
const arr = (v) => (Array.isArray(v) ? v : []);

/** @param {any} v @returns {number} */
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/**
 * Identity of an example / history entry, so a replayed run does not append (or count) it twice.
 * @param {any} e @returns {string}
 */
export function entryId(e) {
  if (!isObject(e)) return `s:${String(e)}`;
  return ["pr", "sha", "fp", "line"].map((k) => String(e[k] ?? "")).join("|");
}

/** @param {any} e @returns {string} */
const touchId = (e) => (isObject(e) ? `#${e.pr ?? ""}` : String(e));

/**
 * Append the entries of `add` not already in `base`, keep the newest `cap`.
 * @param {any[]} base @param {any[]} add @param {(e: any) => string} id
 * @returns {{ list: any[], added: number }}
 */
export function appendCapped(base, add, id, cap = LIST_CAP) {
  const seen = new Set(base.map(id));
  const fresh = add.filter((e) => {
    const k = id(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { list: [...base, ...fresh].slice(-cap), added: fresh.length };
}

/** @param {any[]} a @param {any[]} b @returns {any[]} */
const union = (a, b) => [...new Set([...a, ...b].filter((x) => typeof x === "string" && x.length > 0))];

/**
 * Keep only the fields a record may carry, in the documented order; report the rest.
 * @param {Record<string, any>} rec @param {readonly string[]} allowed
 * @returns {{ rec: Record<string, any>, dropped: string[] }}
 */
function closeFields(rec, allowed) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const k of allowed) if (rec[k] !== undefined) out[k] = rec[k];
  return { rec: out, dropped: Object.keys(rec).filter((k) => !allowed.includes(k)) };
}

/**
 * Merge a hotspot update onto the existing record (or onto nothing, for a first write).
 * A counter rises by the number of NEW examples the update carries for it — never by a literal —
 * so an untouched counter carries through and a replayed run adds nothing.
 * @param {Record<string, any>|null} existing @param {Record<string, any>} update @param {string} now
 * @returns {{ value: Record<string, any>, dropped: string[] }}
 */
export function mergeHotspot(existing, update, now) {
  const base = existing || {};
  /** @type {Record<string, any>} */
  const rec = { v: 1, path: update.path, flaky: count(base.flaky) };
  const legacy = arr(base.examples);
  for (const c of COUNTERS) {
    const field = `${c}_examples`;
    const prior = c === "confirmed" ? [...legacy, ...arr(base[field])] : arr(base[field]);
    const { list, added } = appendCapped(prior, arr(update[field]), entryId);
    rec[c] = count(base[c]) + added;
    if (list.length > 0) rec[field] = list;
  }
  rec.classes = union(arr(base.classes), arr(update.classes));
  rec.last_touched_by = appendCapped(arr(base.last_touched_by), arr(update.last_touched_by), touchId).list;
  rec.expires = new Date(Date.parse(now) + TTL_DAYS * 86400000).toISOString();
  const { dropped } = closeFields({ ...base }, [...HOTSPOT_FIELDS, "examples"]);
  return { value: closeFields(rec, HOTSPOT_FIELDS).rec, dropped };
}

/**
 * Merge a knowledge update onto the existing record. `history[]` accumulates (capped); `facts[]`
 * and `verified_at_sha` move together and only when the update carries `facts` — an update that
 * verified nothing keeps the existing facts at the sha they were verified at.
 * @param {Record<string, any>|null} existing @param {Record<string, any>} update
 * @returns {{ value: Record<string, any>, dropped: string[] }}
 */
export function mergeKnowledge(existing, update) {
  const base = existing || {};
  const verifying = Array.isArray(update.facts);
  /** @type {Record<string, any>} */
  const rec = {
    v: 1,
    symbol: update.symbol,
    path: update.path,
    verified_at_sha: verifying ? update.verified_at_sha : base.verified_at_sha,
    facts: verifying ? update.facts : arr(base.facts),
  };
  for (const k of KNOWLEDGE_CARRIED) rec[k] = update[k] !== undefined ? update[k] : base[k];
  rec.history = appendCapped(arr(base.history), arr(update.history), entryId).list;
  const { dropped } = closeFields({ ...base }, KNOWLEDGE_FIELDS);
  return { value: closeFields(rec, KNOWLEDGE_FIELDS).rec, dropped };
}

/**
 * Index one or more batch memory_read results by `scope::key`.
 * @param {any} read
 * @returns {{ entries: Map<string, any>, missing: Set<string> }}
 */
export function indexRead(read) {
  const results = Array.isArray(read) ? read : [read];
  const entries = new Map();
  const missing = new Set();
  for (const r of results) {
    if (!isObject(r)) continue;
    for (const e of arr(r.entries)) {
      if (isObject(e) && typeof e.scope === "string" && typeof e.key === "string") entries.set(`${e.scope}::${e.key}`, e);
    }
    for (const m of arr(r.missing)) if (typeof m === "string") missing.add(m);
  }
  return { entries, missing };
}

/**
 * @param {{ read: any, updates: any[], now: string }} args
 * @returns {{ writes: Array<{scope: string, key: string, value: string, merged_from: string}>,
 *   skipped: Array<{scope: string, key: string, reason: string}>, dropped_fields: Array<{key: string, fields: string[]}> }}
 */
export function planMemoryWrites({ read, updates, now }) {
  const { entries, missing } = indexRead(read);
  /** @type {Map<string, {scope: string, key: string, value: Record<string, any>, merged_from: string}>} */
  const merged = new Map();
  /** @type {Array<{scope: string, key: string, reason: string}>} */
  const skipped = [];
  /** @type {Array<{key: string, fields: string[]}>} */
  const droppedFields = [];
  for (const u of updates) {
    const scope = isObject(u) && typeof u.scope === "string" ? u.scope : "";
    const key = isObject(u) && typeof u.key === "string" ? u.key : "";
    const update = isObject(u) && isObject(u.update) ? u.update : null;
    const skip = (/** @type {string} */ reason) => { skipped.push({ scope, key, reason }); };
    const kind = recordKind(key);
    if (!scope || !key || !update) { skip("malformed update (needs scope, key, update)"); continue; }
    if (!kind) { skip("not a knowledge:: or hotspot:: key"); continue; }
    const expectedKey = kind === "hotspot" ? `hotspot::${update.path}` : `knowledge::${update.symbol}@${update.path}`;
    if (key !== expectedKey) { skip(`key does not match the update (expected ${expectedKey})`); continue; }
    if (kind === "knowledge" && Array.isArray(update.facts) && !update.verified_at_sha) {
      skip("facts without verified_at_sha"); continue;
    }
    const ref = `${scope}::${key}`;
    /** @type {Record<string, any>|null} */
    let existing = null;
    let from = "absent";
    const prior = merged.get(ref);
    if (prior) {
      existing = prior.value;
      from = prior.merged_from;
    } else if (entries.has(ref)) {
      const e = entries.get(ref);
      if (typeof e.value !== "string") { skip("summary-only read (no full value); read the key with memory_read"); continue; }
      try { existing = JSON.parse(e.value); } catch { existing = null; }
      if (!isObject(existing)) { skip("existing value is not a JSON record; left untouched"); continue; }
      from = "read";
    } else if (!missing.has(ref)) {
      skip("not read before the write; name it in the Step 4d memory_read refs"); continue;
    }
    const r = kind === "hotspot" ? mergeHotspot(existing, update, now) : mergeKnowledge(existing, update);
    if (!prior && r.dropped.length > 0) droppedFields.push({ key, fields: r.dropped });
    merged.set(ref, { scope, key, value: r.value, merged_from: from });
  }
  const writes = [...merged.values()].map((m) => ({
    scope: m.scope, key: m.key, value: JSON.stringify(m.value), merged_from: m.merged_from,
  }));
  return { writes, skipped, dropped_fields: droppedFields };
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  /** @type {Array<[string, () => boolean]>} */
  const cases = [];
  const t = (/** @type {string} */ name, /** @type {() => boolean} */ fn) => cases.push([name, fn]);
  const NOW = "2026-10-30T00:00:00.000Z";
  const S = "repo::o/r";
  const hotspotExisting = {
    v: 1, path: "src/a.ts", window_days: 90, confirmed: 6, missed: 1, regressed: 0, flaky: 2,
    classes: ["nil-deref"], confirmed_examples: [{ pr: 1, sha: "aaa", fp: "x" }],
    missed_examples: [{ pr: 2, line: 9 }], last_touched_by: ["#1", { pr: 2, at: "t" }], checklist: "advice",
  };
  const hotUpdate = {
    path: "src/a.ts", classes: ["contract-break"], confirmed_examples: [{ pr: 3, sha: "ccc", fp: "y" }], last_touched_by: ["#3"],
  };
  const read = {
    entries: [
      { scope: S, key: "hotspot::src/a.ts", value: JSON.stringify(hotspotExisting) },
      { scope: S, key: "knowledge::f@src/b.ts", value: JSON.stringify({
        v: 1, symbol: "f", path: "src/b.ts", kind: "function", verified_at_sha: "old", contract: "Pure.",
        facts: [{ claim: "c1" }], history: [{ pr: 1, sha: "aaa", fp: "x", verdict: "confirmed", outcome: "posted" }],
      }) },
      { scope: S, key: "hotspot::src/summary.ts", preview: "{\"v\":1,…", value_bytes: 900 },
      { scope: S, key: "hotspot::src/prose.ts", value: "## hotspot: prose, not JSON" },
    ],
    missing: [`${S}::hotspot::src/new.ts`, `${S}::knowledge::g@src/c.ts`],
  };
  const run = (/** @type {any[]} */ updates) => planMemoryWrites({ read, updates, now: NOW });
  const val = (/** @type {any} */ r, /** @type {string} */ key) => {
    const w = r.writes.find((/** @type {any} */ x) => x.key === key);
    return w ? { ...JSON.parse(w.value), _from: w.merged_from } : null;
  };

  t("an existing hotspot is merged: the earned counter rises by its new examples, the rest carry through", () => {
    const v = val(run([{ scope: S, key: "hotspot::src/a.ts", update: hotUpdate }]), "hotspot::src/a.ts");
    return v._from === "read" && v.confirmed === 7 && v.missed === 1 && v.regressed === 0 && v.flaky === 2
      && v.confirmed_examples.length === 2 && v.missed_examples.length === 1
      && JSON.stringify(v.classes) === JSON.stringify(["nil-deref", "contract-break"])
      && v.last_touched_by.length === 3 && v.expires === "2027-01-28T00:00:00.000Z";
  });
  t("fields outside the closed hotspot set are dropped and reported", () => {
    const r = run([{ scope: S, key: "hotspot::src/a.ts", update: hotUpdate }]);
    const v = val(r, "hotspot::src/a.ts");
    return !("window_days" in v) && !("checklist" in v)
      && JSON.stringify(r.dropped_fields) === JSON.stringify([{ key: "hotspot::src/a.ts", fields: ["window_days", "checklist"] }]);
  });
  t("a replayed hotspot update adds no example and no count", () => {
    const again = { ...hotUpdate, confirmed_examples: [{ pr: 1, sha: "aaa", fp: "x" }], last_touched_by: ["#1"] };
    const v = val(run([{ scope: S, key: "hotspot::src/a.ts", update: again }]), "hotspot::src/a.ts");
    return v.confirmed === 6 && v.confirmed_examples.length === 1 && v.last_touched_by.length === 2;
  });
  t("a legacy `examples` list is carried into confirmed_examples, never lost", () => {
    const legacyRead = { entries: [{ scope: S, key: "hotspot::src/l.ts", value: JSON.stringify({ v: 1, path: "src/l.ts", confirmed: 3, examples: [{ pr: 7, fp: "z" }] }) }], missing: [] };
    const r = planMemoryWrites({ read: legacyRead, updates: [{ scope: S, key: "hotspot::src/l.ts", update: { path: "src/l.ts" } }], now: NOW });
    const v = JSON.parse(r.writes[0].value);
    return v.confirmed === 3 && v.confirmed_examples.length === 1 && !("examples" in v);
  });
  t("an absent hotspot is written fresh, marked absent, counting only its own examples", () => {
    const v = val(run([{ scope: S, key: "hotspot::src/new.ts", update: { ...hotUpdate, path: "src/new.ts" } }]), "hotspot::src/new.ts");
    return v._from === "absent" && v.confirmed === 1 && v.missed === 0 && v.regressed === 0 && v.flaky === 0;
  });
  t("an existing knowledge record keeps its history and appends the new entry", () => {
    const v = val(run([{ scope: S, key: "knowledge::f@src/b.ts", update: {
      symbol: "f", path: "src/b.ts", verified_at_sha: "new", facts: [{ claim: "c2", tier: 1 }],
      history: [{ pr: 3, sha: "ccc", fp: "y", verdict: "confirmed", outcome: "posted" }],
    } }]), "knowledge::f@src/b.ts");
    return v._from === "read" && v.history.length === 2 && v.verified_at_sha === "new"
      && v.facts.length === 1 && v.facts[0].claim === "c2" && v.contract === "Pure." && v.kind === "function";
  });
  t("a knowledge update with no facts keeps the existing facts at their own sha", () => {
    const v = val(run([{ scope: S, key: "knowledge::f@src/b.ts", update: {
      symbol: "f", path: "src/b.ts", verified_at_sha: "new", history: [{ pr: 3, sha: "ccc", fp: "y" }],
    } }]), "knowledge::f@src/b.ts");
    return v.verified_at_sha === "old" && v.facts[0].claim === "c1" && v.history.length === 2;
  });
  t("history is capped at 20, oldest dropped", () => {
    const hist = Array.from({ length: 20 }, (_, i) => ({ pr: i, sha: `s${i}`, fp: "f" }));
    const big = { entries: [{ scope: S, key: "knowledge::h@x.ts", value: JSON.stringify({ v: 1, symbol: "h", path: "x.ts", history: hist }) }] };
    const r = planMemoryWrites({ read: big, updates: [{ scope: S, key: "knowledge::h@x.ts", update: { symbol: "h", path: "x.ts", history: [{ pr: 99, sha: "z", fp: "f" }] } }], now: NOW });
    const v = JSON.parse(r.writes[0].value);
    return v.history.length === 20 && v.history[0].pr === 1 && v.history[19].pr === 99;
  });
  t("a summary-only entry is rejected, never written", () => {
    const r = run([{ scope: S, key: "hotspot::src/summary.ts", update: { path: "src/summary.ts" } }]);
    return r.writes.length === 0 && r.skipped.length === 1 && /summary-only/.test(r.skipped[0].reason);
  });
  t("a key the read never named is rejected, never written", () => {
    const r = run([{ scope: S, key: "hotspot::src/unread.ts", update: { path: "src/unread.ts" } }]);
    return r.writes.length === 0 && /not read before the write/.test(r.skipped[0].reason);
  });
  t("a prose (non-JSON) record is left untouched", () => {
    const r = run([{ scope: S, key: "hotspot::src/prose.ts", update: { path: "src/prose.ts" } }]);
    return r.writes.length === 0 && /not a JSON record/.test(r.skipped[0].reason);
  });
  t("a key that does not match its update, or facts without a sha, is rejected", () => {
    const r = run([
      { scope: S, key: "hotspot::src/new.ts", update: { path: "src/other.ts" } },
      { scope: S, key: "knowledge::g@src/c.ts", update: { symbol: "g", path: "src/c.ts", facts: [{ claim: "c" }] } },
      { scope: S, key: "state::x", update: {} },
    ]);
    return r.writes.length === 0 && r.skipped.length === 3;
  });
  t("two updates to one key compose instead of the second clobbering the first", () => {
    const r = run([
      { scope: S, key: "hotspot::src/a.ts", update: hotUpdate },
      { scope: S, key: "hotspot::src/a.ts", update: { path: "src/a.ts", missed_examples: [{ pr: 3, line: 4 }] } },
    ]);
    const v = val(r, "hotspot::src/a.ts");
    return r.writes.length === 1 && v.confirmed === 7 && v.missed === 2 && v._from === "read";
  });
  t("every emitted write names how it was merged", () =>
    run([{ scope: S, key: "hotspot::src/a.ts", update: hotUpdate }, { scope: S, key: "hotspot::src/new.ts", update: { path: "src/new.ts" } }])
      .writes.every((w) => MERGED_FROM.includes(w.merged_from)));
  t("an array of read results (two refs calls) is indexed as one", () => {
    const r = planMemoryWrites({ read: [{ entries: [], missing: [`${S}::hotspot::p.ts`] }, { entries: read.entries.slice(0, 1) }],
      updates: [{ scope: S, key: "hotspot::p.ts", update: { path: "p.ts" } }, { scope: S, key: "hotspot::src/a.ts", update: hotUpdate }], now: NOW });
    return r.writes.length === 2 && r.skipped.length === 0;
  });

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch (err) { console.log(`  threw: ${/** @type {Error} */ (err).message}`); }
    if (!ok) failed += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}`);
  }
  console.log(failed === 0 ? `\nmerge-memory-record self-test: ${cases.length}/${cases.length} passed` : `\nmerge-memory-record self-test: ${failed} FAIL`);
  return failed === 0 ? 0 : 1;
}

/** @param {string[]} args @param {string} name @returns {string|undefined} */
function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) process.exit(selfTest());
  const readPath = flag(args, "read");
  const updatesPath = flag(args, "updates");
  if (!readPath || !updatesPath) {
    process.stderr.write("usage: merge-memory-record.mjs --read <read.json> --updates <updates.json> [--now <ISO>] [--out <file>] | --self-test\n");
    process.exit(2);
  }
  let read;
  let updates;
  try {
    read = JSON.parse(readFileSync(readPath, "utf8"));
    updates = JSON.parse(readFileSync(updatesPath, "utf8"));
  } catch (err) {
    process.stderr.write(`merge-memory-record: ${/** @type {Error} */ (err).message}\n`);
    process.exit(2);
  }
  if (!Array.isArray(updates)) {
    process.stderr.write("merge-memory-record: updates must be a JSON array\n");
    process.exit(2);
  }
  const now = flag(args, "now") || new Date().toISOString();
  if (Number.isNaN(Date.parse(now))) {
    process.stderr.write(`merge-memory-record: --now is not a date: ${now}\n`);
    process.exit(2);
  }
  const plan = planMemoryWrites({ read, updates, now });
  const out = `${JSON.stringify(plan, null, 2)}\n`;
  const outPath = flag(args, "out");
  if (outPath) writeFileSync(outPath, out); else process.stdout.write(out);
  const n = (/** @type {string} */ f) => plan.writes.filter((w) => w.merged_from === f).length;
  process.stderr.write(`merge-memory-record: ${plan.writes.length} write(s) (${n("read")} merged, ${n("absent")} new), ${plan.skipped.length} skipped\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
