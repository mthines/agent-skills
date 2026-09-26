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

export const CLAIM_PREFIXES = new Set(["issue", "suggestion"]);

// finding-verifier.md § Step 4: Final = 0.4*Reproducible + 0.3*Attributable + 0.3*Actionable.
// judgments.schema.json's own `final` field description: "finalize.mjs recomputes and
// cross-checks this rather than trusting it blindly" — a promise the pipeline never kept
// (found while investigating ab/B/20230/1/meta.json's defect 9, the 3-vs-7 inline-count gap).
// It was NOT the cause of that gap — every one of the real run's 42 candidates already had a
// self-reported `final` exactly equal to this formula (0 mismatches, checked empirically) — but
// the schema's own words describe an integrity check finalize.mjs is supposed to perform and
// never did: a model that reports Reproducible/Attributable/Actionable honestly but a `final`
// that does not follow from them (whether by error or by gaming the threshold) was trusted
// blindly. This closes it at the pipeline's actual entry point rather than leaving the schema's
// promise unenforced.
const FINAL_WEIGHTS = Object.freeze({ R: 0.4, A: 0.3, Ac: 0.3 });

/**
 * Recomputes Final from the three scored axes, never from a model-reported `final` — the
 * authoritative source for every downstream disposal/placement/display use of a candidate's
 * score. Falls back to the reported `final` (never NaN, never a thrown error) when any axis is
 * not a finite 0-100 number — a candidate missing an axis (a lens outside the finder pipeline,
 * `ux`/`--with`, per per-comment-confidence.md's fallback path) is not silently zeroed out.
 * @param {{ R?: number, A?: number, Ac?: number, final?: number }} candidate
 * @returns {number}
 */
export function recomputeFinal(candidate) {
  const { R, A, Ac, final } = candidate || {};
  const axesValid = [R, A, Ac].every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);
  if (!axesValid) return typeof final === "number" ? final : 0;
  return FINAL_WEIGHTS.R * /** @type {number} */(R)
    + FINAL_WEIGHTS.A * /** @type {number} */(A)
    + FINAL_WEIGHTS.Ac * /** @type {number} */(Ac);
}

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

  // recomputeFinal — ab/B/20230/1/meta.json defect 9 investigation: the schema's own promise
  // ("finalize.mjs recomputes and cross-checks this rather than trusting it blindly") was never
  // implemented anywhere in the pipeline.
  {
    check("recomputeFinal reproduces finding-verifier.md's own formula (0.4R + 0.3A + 0.3Ac)",
      recomputeFinal({ R: 90, A: 80, Ac: 70 }) === 90 * 0.4 + 80 * 0.3 + 70 * 0.3);
    check("a candidate whose reported `final` agrees with R/A/Ac is unaffected",
      recomputeFinal({ R: 100, A: 100, Ac: 100, final: 100 }) === 100);
    check("a candidate whose reported `final` DISAGREES with R/A/Ac is overridden by the recomputed value — never trusted blindly",
      recomputeFinal({ R: 0, A: 0, Ac: 0, final: 99 }) === 0);
    check("a candidate missing an axis (e.g. a fallback-path lens with no R/A/Ac) falls back to the reported final, never NaN or zeroed",
      recomputeFinal({ final: 82 }) === 82);
    check("a candidate missing an axis AND a reported final falls back to 0, never NaN", recomputeFinal({}) === 0);
    check("an axis out of the schema's 0-100 range is treated as invalid, falling back to the reported final",
      recomputeFinal({ R: 150, A: 50, Ac: 50, final: 61 }) === 61);
    // Empirical proof this is a genuine no-op on well-formed input: every one of the 42 real
    // candidates in ab/B/20230/1/judgments.json already satisfied final === 0.4R+0.3A+0.3Ac
    // exactly (0 mismatches) — the 3-vs-7 gap was NOT caused by this gap.
    const realShaped = { R: 92, A: 90, Ac: 91, final: 0.4 * 92 + 0.3 * 90 + 0.3 * 91 };
    check("a well-formed, internally-consistent candidate (the real run's actual shape) recomputes to the same value",
      Math.abs(recomputeFinal(realShaped) - realShaped.final) < 0.01);
  }

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
