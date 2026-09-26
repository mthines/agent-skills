#!/usr/bin/env node
// @ts-check
// route-depth.mjs — Phase C depth routing (pr-reviewer deterministic pipeline,
// R4). A PURE function: `routeDepth(i)` takes the five inputs
// (agents/pr-reviewer/rules/depth-routing.md § Five inputs, as scalars/arrays
// rather than their upstream sources) and returns a tier with the reasons
// that produced it. No I/O, no clock, no env — `prepare-review.mjs` gathers
// the inputs; this file only decides.
//
// depth-routing.md is the single source of TRUTH for the routing rules —
// read it for the WHY. This file is the single source of EXECUTION. An L1
// guard (G60-series, later extended) asserts the D-IDs and the two refresh
// thresholds below equal what that rule file states, so the two cannot drift
// apart silently.
//
// Order of decisions, matching the rule file's own "first match wins, top to
// bottom, with two rules that run BEFORE the table":
//   1. The quick override (THREAD_OVERLAP >= 0.8 AND band == none) — fires
//      before anything else, "whatever the table would say".
//   2. The size exclusion (shapes exclusively docs-only/test-only/generated
//      AND band == none) — waives ONLY D12/D13 and the standard row's size
//      band; every other row still applies.
//   3. D1-D13: ANY fires -> deep.
//   4. The standard row's five OR-conditions.
//   5. Otherwise -> quick.
//   6. The capability cap: DEPTH_CAPABILITY == diff-only caps deep -> standard.

import { readFileSync } from "node:fs";

/** @typedef {{delta: "major"|"minor"|"patch"|string, usageSites: number}} SemverDelta */
/** @typedef {{traffic_band?: string, change?: string}} ChangedSymbol */
/**
 * `zeroDelta` is accepted for forward compatibility with prepare-review.mjs's
 * context shape, but is NOT a routing input — a zero authored delta is Step
 * 0.8's short-circuit, decided BEFORE Phase C is ever reached
 * (depth-routing.md § Zero-delta: "downgrades cost; it never predicts a
 * clean pass" is a statement about what still runs, not a fourth tier this
 * function owns).
 * @typedef {{
 *   firstRun?: boolean, full?: boolean, effortHigh?: boolean,
 *   cumDeltaLines?: number, incrRunsSinceFull?: number, priorDeepRecorded?: boolean,
 *   highStakesFiles?: string[], propagation?: boolean, band?: string,
 *   semverDeltas?: SemverDelta[], symbols?: ChangedSymbol[],
 *   deltaLines?: number, newFiles?: number,
 *   deltaShapes?: string[], deltaRiskyShapes?: string[],
 *   sameSymbolOverlap?: boolean, threadOverlap?: number,
 *   depthCapability?: string,
 *   zeroDelta?: boolean,
 * }} RouteDepthInput
 * @typedef {{tier: "deep"|"standard"|"quick", triggers: string[],
 *   override: "quick"|null, sizeExcluded: boolean, capApplied: boolean,
 *   why: string[]}} RouteDepthResult
 */

export const FULL_REFRESH_DELTA = 150;
export const FULL_REFRESH_RUNS = 3;

/** D1-D13, in order — the checklist depth-routing.md enumerates rather than
 *  packing into one table cell (the shape lesson: a 13-clause cell gets
 *  scanned until something matches and the tail clauses get missed). */
export const TRIGGERS = [
  "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13",
];

const SIZE_EXCLUDED_SHAPES = new Set(["docs-only", "test-only", "generated"]);

/**
 * The size exclusion: shapes are a non-empty subset drawn EXCLUSIVELY from
 * {docs-only, test-only, generated}, and band == none.
 * @param {string[]} deltaShapes @param {string} band
 */
function isSizeExcluded(deltaShapes, band) {
  if (band !== "none") return false;
  if (!deltaShapes || deltaShapes.length === 0) return false;
  return deltaShapes.every((s) => SIZE_EXCLUDED_SHAPES.has(s));
}

/** @param {RouteDepthInput} i @returns {RouteDepthResult} */
export function routeDepth(i) {
  const band = i.band ?? "none";
  const threadOverlap = i.threadOverlap ?? 0;
  const deltaShapes = i.deltaShapes ?? [];
  const deltaRiskyShapes = i.deltaRiskyShapes ?? [];
  const semverDeltas = i.semverDeltas ?? [];
  const symbols = i.symbols ?? [];
  const highStakesFiles = i.highStakesFiles ?? [];
  const deltaLines = i.deltaLines ?? 0;
  const newFiles = i.newFiles ?? 0;
  const cumDeltaLines = i.cumDeltaLines ?? 0;
  const incrRunsSinceFull = i.incrRunsSinceFull ?? 0;

  /** @type {string[]} */
  const why = [];

  // 1. The quick override — before the table, "whatever the table would say".
  if (threadOverlap >= 0.8 && band === "none") {
    why.push(`quick override: THREAD_OVERLAP=${threadOverlap} >= 0.8 and band=none`);
    return { tier: "quick", triggers: [], override: "quick", sizeExcluded: false, capApplied: false, why };
  }

  // 2. The size exclusion — computed before the deep checklist so D12/D13
  // and the standard row's size band can both consult it.
  const sizeExcluded = isSizeExcluded(deltaShapes, band);
  if (sizeExcluded) why.push(`size exclusion: shapes=[${deltaShapes.join(",")}] band=none — D12/D13 and the standard size band are waived`);

  // 3. D1-D13 — ANY fires -> deep.
  /** @type {string[]} */
  const triggers = [];
  if (i.firstRun) triggers.push("D1");
  if (i.full) triggers.push("D2");
  if (i.effortHigh) triggers.push("D3");
  if (cumDeltaLines > FULL_REFRESH_DELTA) triggers.push("D4");
  if (incrRunsSinceFull >= FULL_REFRESH_RUNS) triggers.push("D5");
  if (i.priorDeepRecorded === false) triggers.push("D6");
  if (highStakesFiles.length > 0) triggers.push("D7");
  if (i.propagation) triggers.push("D8");
  if (band === "medium" || band === "high") triggers.push("D9");
  if (semverDeltas.some((d) => d.delta === "major")) triggers.push("D10");
  if (symbols.some((s) => s.traffic_band === "high" && (s.change === "signature" || s.change === "removed"))) triggers.push("D11");
  if (!sizeExcluded && deltaLines > 100) triggers.push("D12");
  if (!sizeExcluded && newFiles > 0) triggers.push("D13");

  if (triggers.length > 0) {
    why.push(`deep triggers: ${triggers.join(", ")}`);
    let tier = /** @type {"deep"|"standard"} */ ("deep");
    let capApplied = false;
    if (i.depthCapability === "diff-only") {
      tier = "standard";
      capApplied = true;
      why.push("capability cap: DEPTH_CAPABILITY=diff-only caps deep -> standard");
    }
    return { tier, triggers, override: null, sizeExcluded, capApplied, why };
  }

  // 4. The standard row — five OR-conditions, any one fires.
  const usedSemverDelta = semverDeltas.find((d) => d.usageSites >= 1);
  const inSizeBand = !sizeExcluded && deltaLines >= 11 && deltaLines <= 100;
  if (deltaRiskyShapes.length > 0) why.push(`standard: DELTA_RISKY_SHAPES=[${deltaRiskyShapes.join(",")}]`);
  if (band === "low") why.push("standard: blast_radius.band=low");
  if (usedSemverDelta) why.push(`standard: semver_delta=${usedSemverDelta.delta} with ${usedSemverDelta.usageSites} usage site(s)`);
  if (i.sameSymbolOverlap) why.push("standard: overlaps[].kind=same-symbol");
  if (inSizeBand) why.push(`standard: 11 <= DELTA_LINES(${deltaLines}) <= 100`);

  if (deltaRiskyShapes.length > 0 || band === "low" || usedSemverDelta || i.sameSymbolOverlap || inSizeBand) {
    return { tier: "standard", triggers: [], override: null, sizeExcluded, capApplied: false, why };
  }

  // 5. Otherwise -> quick.
  why.push("otherwise: no row above matched");
  return { tier: "quick", triggers: [], override: null, sizeExcluded, capApplied: false, why };
}

/* --------------------------------- self-test --------------------------------- */

function selfTest() {
  const fails = [];
  let total = 0;
  let passed = 0;

  const path = new URL("../../../scripts/eval/fixtures/route-depth/cases.json", import.meta.url);
  /** @type {{id: string, inputs: RouteDepthInput, expected: string, notes?: string}[]} */
  let cases;
  try {
    cases = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.log(`✗ route-depth self-test: could not read fixtures — ${/** @type {Error} */ (e).message}`);
    process.exit(1);
  }

  for (const c of cases) {
    total++;
    const r = routeDepth(c.inputs);
    if (r.tier === c.expected) {
      passed++;
    } else {
      fails.push(`${c.id}: expected ${c.expected}, got ${r.tier} (${r.why.join(" | ")})`);
    }
  }

  // A few additional shape assertions beyond the golden 22, on the pure API
  // itself — the constants and the D-id set the L1 cross-file equality guard
  // (G60-series, extended) checks against depth-routing.md.
  const constOk = FULL_REFRESH_DELTA === 150 && FULL_REFRESH_RUNS === 3 && TRIGGERS.length === 13;
  if (!constOk) fails.push("FULL_REFRESH_DELTA/FULL_REFRESH_RUNS/TRIGGERS drifted from depth-routing.md's stated values");

  const capped = routeDepth({ firstRun: true, depthCapability: "diff-only" });
  if (!(capped.tier === "standard" && capped.capApplied === true)) fails.push("capability cap did not downgrade a deep-triggering diff-only run to standard");

  console.log(`route-depth self-test: ${passed}/${total}`);
  if (fails.length) {
    console.log(`✗ route-depth self-test: ${fails.length} failed`);
    for (const f of fails) console.log(`    ✗ ${f}`);
    process.exit(1);
  }
  console.log(`✓ route-depth self-test: all ${total} cases passed`);
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("route-depth.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
  selfTest();
}
