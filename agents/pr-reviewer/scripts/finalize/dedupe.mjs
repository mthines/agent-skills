// @ts-check
/**
 * finalize/dedupe.mjs — rubric-composition.md § Dedupe + § Cross-rubric agreement.
 * Pure. No I/O, clock, or env (D18).
 *
 * Walk findings in finder load order. For each new finding, if a prior KEPT
 * finding has:
 *   - same (path, line) AND same prefix -> drop the new one, record agreement.
 *   - adjacent lines (|line_a - line_b| <= 2) AND same prefix AND same first
 *     40 chars of body -> drop the new one (NOT agreement-promoted — this is
 *     the fuzzy near-duplicate case, not the exact-match case § Cross-rubric
 *     agreement defines).
 *   - same (path, line) AND different prefix -> keep both.
 */

/** @param {any} a @param {any} b */
function exactMatch(a, b) {
  return a.path === b.path && a.line === b.line && a.prefix === b.prefix;
}

/** @param {any} a @param {any} b */
function adjacentFuzzyMatch(a, b) {
  if (a.path !== b.path || a.prefix !== b.prefix) return false;
  if (typeof a.line !== "number" || typeof b.line !== "number") return false;
  if (Math.abs(a.line - b.line) > 2) return false;
  const bodyA = (a.body || "").slice(0, 40);
  const bodyB = (b.body || "").slice(0, 40);
  return bodyA === bodyB;
}

/**
 * @param {any[]} candidates - in finder load order
 * @returns {{ kept: any[], dropped: any[] }}
 */
export function dedupe(candidates) {
  /** @type {any[]} */
  const kept = [];
  /** @type {any[]} */
  const dropped = [];

  for (const c of candidates) {
    let mergedInto = null;
    let reason = "";
    for (const k of kept) {
      if (exactMatch(k, c)) { mergedInto = k; reason = "exact"; break; }
      if (adjacentFuzzyMatch(k, c)) { mergedInto = k; reason = "adjacent"; break; }
    }
    if (mergedInto) {
      if (reason === "exact") {
        if (!mergedInto._also_flagged_by) mergedInto._also_flagged_by = [];
        if (!mergedInto._also_flagged_by.includes(c.finder)) mergedInto._also_flagged_by.push(c.finder);
      }
      dropped.push({ ...c, _dedupe_dropped_for: mergedInto.finder, _dedupe_reason: reason });
    } else {
      kept.push({ ...c });
    }
  }

  return { kept, dropped };
}

/**
 * Cross-rubric agreement (exact-match dedupe only): the finding's effective
 * confidence threshold becomes min(threshold, 70) — see thresholds.mjs.
 * @param {any[]} kept
 * @returns {any[]}
 */
export function markAgreementPromoted(kept) {
  return kept.map((k) => ({
    ...k,
    agreement_promoted: Array.isArray(k._also_flagged_by) && k._also_flagged_by.length > 0,
  }));
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "unguarded null deref here in this function" };
    const c2 = { finder: "quality", path: "a.ts", line: 10, prefix: "issue", body: "different wording entirely for the same defect claim" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("exact (path,line,prefix) match drops the second finding", kept.length === 1 && dropped.length === 1);
    check("the kept finding records the dropped rubric in _also_flagged_by", kept[0]._also_flagged_by?.includes("quality"));
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "unguarded null deref reachable from the exported caller" };
    const c2 = { finder: "quality", path: "a.ts", line: 11, prefix: "issue", body: "unguarded null deref reachable from the exported caller too" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("adjacent line (<=2) + same prefix + same 40-char prefix drops the second", kept.length === 1 && dropped.length === 1 && dropped[0]._dedupe_reason === "adjacent");
    check("adjacent-line drop does NOT mark agreement-promoted", !kept[0]._also_flagged_by);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const c2 = { finder: "quality", path: "a.ts", line: 10, prefix: "suggestion", body: "x" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("same (path,line), different prefix keeps both", kept.length === 2 && dropped.length === 0);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const c2 = { finder: "quality", path: "b.ts", line: 10, prefix: "issue", body: "x" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("different path never merges", kept.length === 2 && dropped.length === 0);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const c2 = { finder: "quality", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const { kept } = dedupe([c1, c2]);
    const promoted = markAgreementPromoted(kept);
    check("markAgreementPromoted flags the merged-into finding true", promoted[0].agreement_promoted === true);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const { kept } = dedupe([c1]);
    const promoted = markAgreementPromoted(kept);
    check("a single-rubric finding is NOT agreement-promoted", promoted[0].agreement_promoted === false);
  }

  if (failed > 0) {
    console.error(`\ndedupe self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ dedupe self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
