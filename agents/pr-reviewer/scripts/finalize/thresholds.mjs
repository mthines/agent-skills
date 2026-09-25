// @ts-check
/**
 * finalize/thresholds.mjs — review-config.md § Profile knob + § Severity-aware
 * thresholds, per-comment-confidence.md § Drop vs. defer, rubric-composition.md
 * § Cross-rubric agreement. Pure. No I/O, clock, or env (D18).
 *
 * ONE profile record, per D18 — no parallel threshold/cap maps.
 */

/** @type {Record<string, { thresholds: Record<string, number>, perFileCap: number }>} */
export const PROFILES = {
  chill: { thresholds: { critical: 75, high: 85, medium: 90, low: 95 }, perFileCap: 3 },
  balanced: { thresholds: { critical: 65, high: 70, medium: 80, low: 90 }, perFileCap: 5 },
  assertive: { thresholds: { critical: 60, high: 65, medium: 70, low: 85 }, perFileCap: 7 },
};

export const TOTAL_INLINE_CAP = 20;

/** rubric-composition.md § Cross-rubric agreement: agreement-promoted findings
 * get an effective bar of min(threshold, 70) rather than the profile's own bar. */
export const AGREEMENT_PROMOTED_CAP = 70;

const CLAIM_PREFIXES = new Set(["issue", "suggestion"]);

/**
 * @param {{ profile?: string, severityTier?: string, flatOverride?: number }} args
 * @returns {number}
 */
export function resolveThreshold({ profile = "balanced", severityTier = "medium", flatOverride }) {
  if (typeof flatOverride === "number") return flatOverride;
  const p = PROFILES[profile] || PROFILES.balanced;
  return p.thresholds[severityTier] ?? p.thresholds.medium;
}

/**
 * per-comment-confidence.md § Drop vs. defer — the near-miss band.
 * Floored at 50 (not threshold-15) so low severity tiers keep a non-empty band.
 * @param {number} threshold
 */
export function deferFloor(threshold) {
  return Math.max(threshold - 15, 50);
}

/**
 * @param {{ final: number, threshold: number, prefix: string, agreementPromoted?: boolean }} args
 * @returns {"clear"|"defer"|"drop"}
 */
export function dispose({ final, threshold, prefix, agreementPromoted = false }) {
  const effectiveThreshold = agreementPromoted ? Math.min(threshold, AGREEMENT_PROMOTED_CAP) : threshold;
  if (final >= effectiveThreshold) return "clear";
  const isClaim = CLAIM_PREFIXES.has(prefix);
  if (isClaim && final >= deferFloor(effectiveThreshold)) return "defer";
  return "drop";
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  check("PROFILES has exactly chill/balanced/assertive", Object.keys(PROFILES).sort().join(",") === "assertive,balanced,chill");
  check("balanced.thresholds.medium is 80 (today's default)", PROFILES.balanced.thresholds.medium === 80);
  check("balanced.perFileCap is 5", PROFILES.balanced.perFileCap === 5);
  check("TOTAL_INLINE_CAP is 20", TOTAL_INLINE_CAP === 20);

  // Defer band edges: threshold 80 -> band [65, 80).
  check("defer_floor(80) is 65", deferFloor(80) === 65);
  check("defer_floor is floored at 50, never threshold-15 below that (critical=65 -> floor 50, not 50)", deferFloor(65) === 50);
  check("defer_floor floors an assertive-critical (60) at 50, not an inverted [65,60)", deferFloor(60) === 50);

  // AC-10: defer band edges (t-15, the 50 floor, t).
  check("Final == threshold-15 (65, band lower edge) on an issue: defers", dispose({ final: 65, threshold: 80, prefix: "issue" }) === "defer");
  check("Final == 50 (absolute floor) on an issue at threshold 60 still defers (floor, not threshold-15)", dispose({ final: 50, threshold: 60, prefix: "issue" }) === "defer");
  check("Final == threshold (80) on an issue clears (not defer)", dispose({ final: 80, threshold: 80, prefix: "issue" }) === "clear");
  check("Final one point under the floor drops", dispose({ final: 49, threshold: 60, prefix: "issue" }) === "drop");

  // AC-10: praise, question, and nitpick drops (never deferred, regardless of score).
  check("a near-miss praise: is dropped, never deferred", dispose({ final: 70, threshold: 80, prefix: "praise" }) === "drop");
  check("a near-miss question: is dropped, never deferred", dispose({ final: 70, threshold: 80, prefix: "question" }) === "drop");
  check("a near-miss nitpick: is dropped, never deferred", dispose({ final: 70, threshold: 80, prefix: "nitpick" }) === "drop");
  check("a high-scoring praise: still clears", dispose({ final: 95, threshold: 80, prefix: "praise" }) === "clear");
  check("a near-miss issue: (not praise/question/nitpick) defers instead of dropping", dispose({ final: 70, threshold: 80, prefix: "issue" }) === "defer");

  // Agreement promotion: effective bar min(threshold, 70).
  check("agreement-promoted finding at 72 with base threshold 90 clears (min(90,70)=70)", dispose({ final: 72, threshold: 90, prefix: "issue", agreementPromoted: true }) === "clear");
  check("non-promoted finding at 72 with threshold 90 drops (defer_floor(90)=75, 72<75)", dispose({ final: 72, threshold: 90, prefix: "issue", agreementPromoted: false }) === "drop");

  if (failed > 0) {
    console.error(`\nthresholds self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ thresholds self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
