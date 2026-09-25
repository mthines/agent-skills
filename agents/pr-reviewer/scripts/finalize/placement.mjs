// @ts-check
/**
 * finalize/placement.mjs — rubric-composition.md § Placement (Step 2.9b).
 * Pure. No I/O, clock, or env (D18). Runs last, after every quality gate;
 * discards nothing — overflow is DEFERRED, never dropped.
 *
 * Blocking findings are exempt from both the per-file and the total cap:
 * always inline, never deferred, regardless of the cap.
 *
 * Ordering for the remaining (non-blocking) inline slots:
 *   1. Prefix priority: issue > suggestion > question > nitpick.
 *   2. Material before cosmetic.
 *   3. Descending per-comment-confidence Final score.
 *   4. Ascending line number.
 */

import { PROFILES, TOTAL_INLINE_CAP } from "./thresholds.mjs";

/** @type {Record<string, number>} */
const PREFIX_PRIORITY = { issue: 0, suggestion: 1, question: 2, nitpick: 3 };

/** @param {any} a @param {any} b */
function compareForPlacement(a, b) {
  const pa = PREFIX_PRIORITY[a.prefix] ?? 99;
  const pb = PREFIX_PRIORITY[b.prefix] ?? 99;
  if (pa !== pb) return pa - pb;
  // material (materiality !== false) sorts before cosmetic (materiality === false)
  const ma = a.materiality === false ? 1 : 0;
  const mb = b.materiality === false ? 1 : 0;
  if (ma !== mb) return ma - mb;
  const fa = typeof a.final === "number" ? a.final : 0;
  const fb = typeof b.final === "number" ? b.final : 0;
  if (fa !== fb) return fb - fa; // descending
  return (a.line ?? 0) - (b.line ?? 0); // ascending
}

/**
 * @param {any[]} findings - already cleared (dispose === "clear"), post-suppression
 * @param {{ profile?: string }} [opts]
 * @returns {{ inline: any[], deferred: any[] }}
 */
export function place(findings, { profile = "balanced" } = {}) {
  const perFileCap = (PROFILES[profile] || PROFILES.balanced).perFileCap;

  const blocking = findings.filter((f) => f.blocking === true);
  const nonBlocking = findings.filter((f) => f.blocking !== true).slice().sort(compareForPlacement);

  const inline = [...blocking];
  /** @type {any[]} */
  const deferred = [];

  /** @type {Map<string, number>} */
  const perFileCount = new Map();
  for (const f of blocking) {
    perFileCount.set(f.path, (perFileCount.get(f.path) || 0) + 1);
  }

  let totalNonBlockingPlaced = 0;
  for (const f of nonBlocking) {
    const fileCount = perFileCount.get(f.path) || 0;
    if (fileCount < perFileCap && totalNonBlockingPlaced < TOTAL_INLINE_CAP) {
      inline.push(f);
      perFileCount.set(f.path, fileCount + 1);
      totalNonBlockingPlaced++;
    } else {
      deferred.push(f);
    }
  }

  return { inline, deferred };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  const mk = (over = {}) => ({ path: "a.ts", line: 1, prefix: "suggestion", final: 80, blocking: false, ...over });

  // AC-10: the per-file and 20-total caps with blocking exempt.
  {
    const findings = Array.from({ length: 10 }, (_, i) => mk({ line: i + 1, path: "a.ts" }));
    const { inline, deferred } = place(findings, { profile: "balanced" }); // perFileCap 5
    check("per-file cap (balanced: 5) defers the overflow within one file", inline.length === 5 && deferred.length === 5);
  }
  {
    const files = Array.from({ length: 6 }, (_, f) => `f${f}.ts`);
    const findings = files.flatMap((path, f) => Array.from({ length: 5 }, (_, i) => mk({ path, line: i + 1, final: 90 - f })));
    // 6 files * 5 per file = 30 candidates, all within per-file cap, but TOTAL_INLINE_CAP=20.
    const { inline, deferred } = place(findings, { profile: "balanced" });
    check("total inline cap (20) defers the remainder across files", inline.length === 20 && deferred.length === 10);
  }
  {
    const findings = [
      mk({ path: "a.ts", line: 1, blocking: true }),
      mk({ path: "a.ts", line: 2, blocking: true }),
      mk({ path: "a.ts", line: 3, blocking: true }),
      mk({ path: "a.ts", line: 4, blocking: true }),
      mk({ path: "a.ts", line: 5, blocking: true }),
      mk({ path: "a.ts", line: 6, blocking: true }), // 6th blocking in the SAME file, cap is 5
      mk({ path: "a.ts", line: 7, blocking: false }), // one non-blocking, should be deferred (cap already exceeded by blocking alone)
    ];
    const { inline, deferred } = place(findings, { profile: "balanced" });
    check("blocking findings are exempt from the per-file cap — all 6 post inline", inline.filter((f) => f.blocking).length === 6);
    check("a non-blocking finding in a file already over-cap on blocking alone is deferred, not silently posted", deferred.length === 1 && deferred[0].blocking === false);
  }

  // Ordering.
  {
    const findings = [
      mk({ path: "a.ts", line: 5, prefix: "nitpick", final: 99 }),
      mk({ path: "a.ts", line: 1, prefix: "issue", final: 60 }),
    ];
    const { inline } = place(findings);
    check("issue: outranks nitpick: regardless of confidence score", inline[0].prefix === "issue");
  }
  {
    const findings = [
      mk({ path: "a.ts", line: 1, prefix: "suggestion", final: 70, materiality: false }), // cosmetic
      mk({ path: "a.ts", line: 2, prefix: "suggestion", final: 65, materiality: true }), // material
    ];
    const { inline } = place(findings);
    check("material sorts before cosmetic within the same prefix, even at a lower score", inline[0].materiality === true);
  }
  {
    const findings = [
      mk({ path: "a.ts", line: 1, prefix: "suggestion", final: 70 }),
      mk({ path: "a.ts", line: 2, prefix: "suggestion", final: 90 }),
    ];
    const { inline } = place(findings);
    check("descending confidence score breaks ties within the same prefix/materiality", inline[0].final === 90);
  }
  {
    const findings = [
      mk({ path: "a.ts", line: 5, prefix: "suggestion", final: 80 }),
      mk({ path: "a.ts", line: 1, prefix: "suggestion", final: 80 }),
    ];
    const { inline } = place(findings);
    check("ascending line number is the final tiebreaker", inline[0].line === 1);
  }

  // Discards nothing.
  {
    const findings = Array.from({ length: 25 }, (_, i) => mk({ path: "a.ts", line: i + 1 }));
    const { inline, deferred } = place(findings, { profile: "assertive" }); // perFileCap 7
    check("placement discards nothing — inline + deferred == input", inline.length + deferred.length === 25);
  }

  if (failed > 0) {
    console.error(`\nplacement self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ placement self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
