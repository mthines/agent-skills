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

/* ------------------------------ resolveBudget ------------------------------ */
// A/B round 1 delta. `routeDepth` still decides the tier (deep/standard/quick)
// from the D1-D13 rules above, unchanged. `resolveBudget` is a SECOND pure
// function, layered on top, that turns a continuous 0..1 THOROUGHNESS value
// (defaulted from the routed tier, or an explicit override) into every
// dispatch/scope lever this pipeline used to leave to model discretion.
// depth-routing.md § Thoroughness budget is the single source of TRUTH for
// the breakpoints below and the WHY each one sits where it does; this is the
// EXECUTION, same split as routeDepth/depth-routing.md above. An L1 guard
// (G84e) asserts the two agree.

/** Tier -> default thoroughness when no explicit override is given. */
export const TIER_DEFAULT_THOROUGHNESS = { quick: 0.2, standard: 0.5, deep: 0.8 };

/** `--effort high` / `effort: high` is an alias for the ceiling. */
export const EFFORT_HIGH_THOROUGHNESS = 1;

/** A diff carrying any of these shapes floors the EFFECTIVE thoroughness — an
 *  explicit low override never under-reviews a high-stakes diff. This is a
 *  safety net for an override, not a duplicate of D7/D9: those already force
 *  `routedTier = "deep"` (so the default thoroughness is already 0.8) for the
 *  same shapes; the floor only ever matters when something (a user, a config
 *  default) asks for less than 0.5 anyway. */
const HIGH_STAKES_SHAPES = new Set(["auth", "payments", "schema-migration", "secrets", "infra"]);
export const RISK_FLOOR = 0.5;

/** A/B round 2 item 2: the original spec named `blast_radius.band == "high"`
 *  (impact.json's own field — `resolveBudget`'s caller reads it as `i.band`,
 *  the same shape `routeDepth`'s D9 already consumes) as a risk-floor input,
 *  and it was missing — at `t=0.3` on a band-high PR (61 exports),
 *  consumer-impact never activated (`T_FINDERS_MID` is 0.5) and the run found
 *  nothing. `band == "high"` now floors exactly like a high-stakes SHAPE:
 *  the floor is a safety net for an override on a diff D9 already routes to
 *  `deep` by default, so it only bites when something asks for less than 0.5
 *  anyway. */

/** Breakpoints. Each is a `t >=` threshold. Chosen so the three tier defaults
 *  (0.2 / 0.5 / 0.8) reproduce today's per-tier behaviour on every lever
 *  EXCEPT the holistic-escalation cap, which is `round(10 * t)` by design —
 *  8 at deep's 0.8 default instead of the flat 10 the pipeline used before
 *  this delta. That is a deliberate, small, reported deviation: it is what
 *  "escalation SCALES with thoroughness" means, and `--effort high` (t = 1)
 *  restores 10 exactly. */
const T_TOPOLOGY = 0.4;
const T_FINDERS_MID = 0.5; // consumer-impact(delta) + dependency + standards(delta) join
const T_FINDERS_HIGH = 0.8; // consumer-impact/standards widen delta -> all
const T_VOTES_3 = 0.8;
const T_VOTES_5 = 0.95;
const T_VERIFY_TIER_2 = 0.5;
const T_VERIFY_TIER_3 = 0.95;
const T_OPTIMALITY = 0.7;
const T_MEASURABILITY = 0.4;
/** A/B round 2 item 3: Step 2.4's holistic broad pass had no explicit lever —
 *  it ran unconditionally (gated only by holistic-review.md's five
 *  TRIVIAL_SKIP conditions, never by thoroughness), so whether it ran on a
 *  given budget was ambiguous. `T_TOPOLOGY`'s own breakpoint (0.4) is reused
 *  here deliberately: below it there is no parallel dispatch to run the pass
 *  as a sub-agent, so tying the two together is not a second independent
 *  guess. This is a reported, deliberate deviation from "always on" at the
 *  very bottom of the quick tier (t=0.2) — `routedTier === "deep"` still
 *  forces it on regardless of any override, same shape as the risk floor. */
const T_HOLISTIC_BROAD = 0.4;

/** A/B iterations 1–3 (sync-tray#72, 22 files): the tool-call budget scaled with FILE COUNT only
 *  (pr-reviewer.md § Stop conditions), so every thoroughness paid for its extra finders, votes and
 *  lenses out of the same 60 calls. Arms at t=0.8 skipped whole files to stay inside it — one
 *  declared a partial review after reading 13 of 22 files, and the file it only grepped held the
 *  highest-severity corroborated defect, which that arm missed in all three rounds. The budget is
 *  a ceiling, not a target, so raising it costs nothing on a run that does not need it. */
export const TOOL_CALL_BANDS = Object.freeze([
  { maxFiles: 10, calls: 30 },
  { maxFiles: 30, calls: 60 },
  { maxFiles: Infinity, calls: 100 },
]);
const T_TOOLCALLS_1_5 = 0.8;
const T_TOOLCALLS_2 = 0.95;

/** @param {string[]} shape @param {string} band */
function highStakesReason(shape, band) {
  const hit = (shape ?? []).find((s) => HIGH_STAKES_SHAPES.has(s));
  if (hit) return hit;
  return band === "high" ? "blast_radius:high" : null;
}

/**
 * @typedef {{
 *   thoroughness?: number, routedTier?: "deep"|"standard"|"quick",
 *   shape?: string[], band?: string, depthCapability?: string,
 *   dispatchAvailable?: boolean, effortHigh?: boolean, changedFiles?: number,
 * }} ResolveBudgetInput
 * @typedef {{
 *   effectiveThoroughness: number, requestedThoroughness: number,
 *   riskFloorApplied: boolean, riskFloorReason: string|null, inputError: string|null,
 *   finders: {correctness: boolean, intent: boolean, quality: boolean,
 *     "consumer-impact": boolean, dependency: boolean, standards: boolean},
 *   finderScope: {"consumer-impact": "none"|"delta"|"all", standards: "none"|"delta"|"all"},
 *   correctnessVotes: 1|3|5, topology: "in-context"|"parallel",
 *   maxVerificationTier: 1|2|3, holisticEscalationCap: number,
 *   optimalityLens: boolean, measurabilityLens: boolean, holisticBroadPass: boolean,
 *   toolCallMultiplier: 1|1.5|2, toolCalls: number|null,
 *   capabilityNotes: string[],
 * }} Budget
 */

/** @param {ResolveBudgetInput} i @returns {Budget} */
export function resolveBudget(i = {}) {
  const dispatchAvailable = i.dispatchAvailable ?? true;
  const shape = i.shape ?? [];

  // --- resolve the BASE thoroughness value, fail-closed on garbage input ---
  let inputError = null;
  let base;
  if (i.effortHigh) {
    base = EFFORT_HIGH_THOROUGHNESS;
  } else if (i.thoroughness === undefined || i.thoroughness === null) {
    base = i.routedTier ? (TIER_DEFAULT_THOROUGHNESS[i.routedTier] ?? null) : null;
    if (base === null) {
      // No explicit value AND no (recognised) routed tier to default from —
      // fail CLOSED means the safe direction here is maximum scrutiny, not
      // silently reviewing at zero.
      inputError = `no thoroughness given and routedTier "${i.routedTier}" has no default`;
      base = 1;
    }
  } else if (typeof i.thoroughness !== "number" || !Number.isFinite(i.thoroughness)) {
    inputError = `thoroughness "${i.thoroughness}" is not a finite number`;
    base = 1; // fail closed: maximum scrutiny, never a silent under-review
  } else {
    base = Math.min(1, Math.max(0, i.thoroughness));
    if (i.thoroughness < 0 || i.thoroughness > 1) inputError = `thoroughness ${i.thoroughness} out of [0,1] — clamped to ${base}`;
  }

  // --- risk floor ---
  const band = i.band ?? "none";
  const floorReason = highStakesReason(shape, band);
  const riskFloorApplied = floorReason !== null && base < RISK_FLOOR;
  const t = riskFloorApplied ? RISK_FLOOR : base;

  const findersMid = t >= T_FINDERS_MID;
  const findersHigh = t >= T_FINDERS_HIGH;

  // --- item 3: budget vs. capability. A `deep`-thoroughness budget whose
  // materialized workspace cannot support a finder is not a smaller budget —
  // it is the SAME budget with a finder that cannot run turned off, and the
  // reason recorded rather than left ambiguous (A/B round 2 observed defect:
  // "under diff-only it still activated consumer-impact, which
  // finder-consumer-impact.md excludes"). Only consumer-impact excludes
  // diff-only today (finder-consumer-impact.md § DEPTH_CAPABILITY = diff-only);
  // dependency and standards carry no such exclusion in their own rule files.
  const depthCapability = i.depthCapability;
  /** @type {string[]} */
  const capabilityNotes = [];
  let consumerImpactActive = findersMid;
  /** @type {"none"|"delta"|"all"} */
  let consumerImpactScope = findersMid ? (findersHigh ? "all" : "delta") : "none";
  if (depthCapability === "diff-only" && consumerImpactActive) {
    consumerImpactActive = false;
    consumerImpactScope = "none";
    capabilityNotes.push(
      "consumer-impact deactivated: DEPTH_CAPABILITY=diff-only (finder-consumer-impact.md excludes diff-only)",
    );
  }

  /** @type {1|1.5|2} */
  const toolCallMultiplier = t >= T_TOOLCALLS_2 ? 2 : t >= T_TOOLCALLS_1_5 ? 1.5 : 1;

  return {
    effectiveThoroughness: t,
    requestedThoroughness: base,
    riskFloorApplied,
    riskFloorReason: riskFloorApplied ? floorReason : null,
    inputError,
    finders: {
      correctness: true,
      intent: true,
      quality: true,
      "consumer-impact": consumerImpactActive,
      dependency: findersMid,
      standards: findersMid,
    },
    finderScope: {
      "consumer-impact": consumerImpactScope,
      standards: findersMid ? (findersHigh ? "all" : "delta") : "none",
    },
    correctnessVotes: t >= T_VOTES_5 ? 5 : t >= T_VOTES_3 ? 3 : 1,
    topology: dispatchAvailable && t >= T_TOPOLOGY ? "parallel" : "in-context",
    maxVerificationTier: t >= T_VERIFY_TIER_3 ? 3 : t >= T_VERIFY_TIER_2 ? 2 : 1,
    holisticEscalationCap: Math.round(10 * t),
    optimalityLens: t >= T_OPTIMALITY,
    measurabilityLens: t >= T_MEASURABILITY,
    holisticBroadPass: t >= T_HOLISTIC_BROAD || i.routedTier === "deep",
    toolCallMultiplier,
    toolCalls: typeof i.changedFiles === "number" && Number.isFinite(i.changedFiles) && i.changedFiles >= 0
      ? Math.round(toolCallBand(i.changedFiles) * toolCallMultiplier) : null,
    capabilityNotes,
  };
}

/** @param {number} changedFiles @returns {number} the base call budget for that many files */
export function toolCallBand(changedFiles) {
  const band = TOOL_CALL_BANDS.find((b) => changedFiles <= b.maxFiles);
  return (band ?? TOOL_CALL_BANDS[TOOL_CALL_BANDS.length - 1]).calls;
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

  // ---- resolveBudget: defaults reproduce today's per-tier behaviour ----
  total++;
  const q = resolveBudget({ routedTier: "quick" });
  if (q.effectiveThoroughness === 0.2 && q.correctnessVotes === 1 && q.topology === "in-context"
    && q.maxVerificationTier === 1 && q.optimalityLens === false && q.measurabilityLens === false
    && q.finders["consumer-impact"] === false && q.finders.dependency === false && q.finders.standards === false
    && q.holisticEscalationCap === 2
    // Deliberate, reported deviation (item 3): today Step 2.4 ran unconditionally; the
    // new explicit lever turns it off at quick's bottom-of-range default.
    && q.holisticBroadPass === false) passed++;
  else fails.push(`resolveBudget(quick) drifted from today's quick budget: ${JSON.stringify(q)}`);

  total++;
  const st = resolveBudget({ routedTier: "standard" });
  if (st.effectiveThoroughness === 0.5 && st.correctnessVotes === 1 && st.topology === "parallel"
    && st.maxVerificationTier === 2 && st.optimalityLens === false && st.measurabilityLens === true
    && st.finders["consumer-impact"] === true && st.finderScope["consumer-impact"] === "delta"
    && st.finders.standards === true && st.finderScope.standards === "delta"
    && st.holisticEscalationCap === 5 && st.holisticBroadPass === true) passed++;
  else fails.push(`resolveBudget(standard) drifted from today's standard budget: ${JSON.stringify(st)}`);

  total++;
  const dp = resolveBudget({ routedTier: "deep" });
  if (dp.effectiveThoroughness === 0.8 && dp.correctnessVotes === 3 && dp.topology === "parallel"
    && dp.maxVerificationTier === 2 && dp.optimalityLens === true && dp.measurabilityLens === true
    && dp.finderScope["consumer-impact"] === "all" && dp.finderScope.standards === "all"
    && dp.holisticEscalationCap === 8 && dp.holisticBroadPass === true) passed++;
  else fails.push(`resolveBudget(deep) drifted from today's deep budget: ${JSON.stringify(dp)}`);

  // ---- resolveBudget: holisticBroadPass "always on when routed deep" holds even
  // under a low explicit override (a deep-routed PR with an under-thoroughness override
  // must not lose the broad pass) ----
  total++;
  const deepLowOverride = resolveBudget({ thoroughness: 0.1, routedTier: "deep" });
  if (deepLowOverride.holisticBroadPass === true) passed++;
  else fails.push(`holisticBroadPass was not forced on for routedTier=deep under a low override: ${JSON.stringify(deepLowOverride)}`);

  // ---- resolveBudget: risk floor — band high (item 2) ----
  total++;
  const bandFloored = resolveBudget({ thoroughness: 0.3, band: "high" });
  if (bandFloored.riskFloorApplied === true && bandFloored.effectiveThoroughness === RISK_FLOOR
    && bandFloored.riskFloorReason === "blast_radius:high"
    && bandFloored.finders["consumer-impact"] === true) passed++;
  else fails.push(`risk floor did not fire on blast_radius.band=high: ${JSON.stringify(bandFloored)}`);

  total++;
  const bandNotFloored = resolveBudget({ thoroughness: 0.8, band: "high" });
  if (bandNotFloored.riskFloorApplied === false) passed++;
  else fails.push(`risk floor fired on band=high when the override was already above the floor: ${JSON.stringify(bandNotFloored)}`);

  total++;
  const bandMedium = resolveBudget({ thoroughness: 0.1, band: "medium" });
  if (bandMedium.riskFloorApplied === false) passed++;
  else fails.push(`risk floor fired on band=medium, which is not in the floor's band set: ${JSON.stringify(bandMedium)}`);

  // ---- resolveBudget: budget vs. capability (item 3) ----
  total++;
  const capBudget = resolveBudget({ routedTier: "deep", depthCapability: "diff-only" });
  if (capBudget.finders["consumer-impact"] === false && capBudget.finderScope["consumer-impact"] === "none"
    && capBudget.capabilityNotes.length === 1 && /diff-only/.test(capBudget.capabilityNotes[0])
    // dependency/standards carry no diff-only exclusion in their own rule files — unaffected.
    && capBudget.finders.dependency === true && capBudget.finders.standards === true) passed++;
  else fails.push(`depthCapability=diff-only did not deactivate consumer-impact with a recorded reason: ${JSON.stringify(capBudget)}`);

  total++;
  const notCapped = resolveBudget({ routedTier: "deep", depthCapability: "checkout" });
  if (notCapped.finders["consumer-impact"] === true && notCapped.capabilityNotes.length === 0) passed++;
  else fails.push(`depthCapability=checkout wrongly deactivated a finder: ${JSON.stringify(notCapped)}`);

  total++;
  const cappedBelowMid = resolveBudget({ thoroughness: 0.3, depthCapability: "diff-only" });
  if (cappedBelowMid.finders["consumer-impact"] === false && cappedBelowMid.capabilityNotes.length === 0) passed++;
  else fails.push(`depthCapability=diff-only should be a no-op (and log nothing) when consumer-impact was already off: ${JSON.stringify(cappedBelowMid)}`);

  total++;
  const eh = resolveBudget({ effortHigh: true, routedTier: "deep" });
  if (eh.effectiveThoroughness === 1 && eh.correctnessVotes === 5 && eh.maxVerificationTier === 3
    && eh.holisticEscalationCap === 10) passed++;
  else fails.push(`resolveBudget(--effort high) did not reach the ceiling on every lever: ${JSON.stringify(eh)}`);

  // ---- resolveBudget: risk floor ----
  total++;
  const floored = resolveBudget({ thoroughness: 0.1, shape: ["auth"] });
  if (floored.riskFloorApplied === true && floored.effectiveThoroughness === RISK_FLOOR
    && floored.riskFloorReason === "auth") passed++;
  else fails.push(`risk floor did not lift a low override on a high-stakes shape: ${JSON.stringify(floored)}`);

  total++;
  const notFloored = resolveBudget({ thoroughness: 0.8, shape: ["auth"] });
  if (notFloored.riskFloorApplied === false && notFloored.effectiveThoroughness === 0.8) passed++;
  else fails.push(`risk floor fired when the override was already above the floor: ${JSON.stringify(notFloored)}`);

  total++;
  const noShapeFloor = resolveBudget({ thoroughness: 0.1, shape: ["test-only"] });
  if (noShapeFloor.riskFloorApplied === false && noShapeFloor.effectiveThoroughness === 0.1) passed++;
  else fails.push(`risk floor fired on a shape that is not in the high-stakes set: ${JSON.stringify(noShapeFloor)}`);

  // ---- resolveBudget: fails closed on garbage/out-of-range input ----
  total++;
  const nanIn = resolveBudget({ thoroughness: NaN, routedTier: "quick" });
  if (nanIn.effectiveThoroughness === 1 && typeof nanIn.inputError === "string") passed++;
  else fails.push(`NaN thoroughness did not fail closed to maximum scrutiny: ${JSON.stringify(nanIn)}`);

  total++;
  const tooHigh = resolveBudget({ thoroughness: 5, routedTier: "quick" });
  if (tooHigh.effectiveThoroughness === 1 && typeof tooHigh.inputError === "string") passed++;
  else fails.push(`out-of-range (>1) thoroughness was not clamped: ${JSON.stringify(tooHigh)}`);

  total++;
  const tooLow = resolveBudget({ thoroughness: -3, routedTier: "quick" });
  if (tooLow.effectiveThoroughness === 0 && typeof tooLow.inputError === "string") passed++;
  else fails.push(`out-of-range (<0) thoroughness was not clamped: ${JSON.stringify(tooLow)}`);

  total++;
  const noInput = resolveBudget({});
  if (noInput.effectiveThoroughness === 1 && typeof noInput.inputError === "string") passed++;
  else fails.push(`no thoroughness and no routedTier did not fail closed to maximum scrutiny: ${JSON.stringify(noInput)}`);

  // ---- resolveBudget: tool-call budget scales with thoroughness (A/B iterations 1–3) ----
  total++;
  {
    const q22 = resolveBudget({ routedTier: "quick", changedFiles: 22 });
    const s22 = resolveBudget({ routedTier: "standard", changedFiles: 22 });
    const d22 = resolveBudget({ routedTier: "deep", changedFiles: 22 });
    const c22 = resolveBudget({ effortHigh: true, routedTier: "deep", changedFiles: 22 });
    const d5 = resolveBudget({ routedTier: "deep", changedFiles: 5 });
    const d40 = resolveBudget({ routedTier: "deep", changedFiles: 40 });
    const unknown = resolveBudget({ routedTier: "deep" });
    if (q22.toolCalls === 60 && s22.toolCalls === 60 && d22.toolCalls === 90 && c22.toolCalls === 120
      && d5.toolCalls === 45 && d40.toolCalls === 150 && unknown.toolCalls === null
      && q22.toolCallMultiplier === 1 && d22.toolCallMultiplier === 1.5 && c22.toolCallMultiplier === 2) passed++;
    else fails.push(`tool-call budget drifted: ${JSON.stringify({ q: q22.toolCalls, s: s22.toolCalls, d: d22.toolCalls, c: c22.toolCalls, d5: d5.toolCalls, d40: d40.toolCalls, u: unknown.toolCalls })}`);
  }

  // ---- resolveBudget: monotonicity — for any t1 < t2, budget(t2) is a
  // superset of budget(t1) on every lever. No lever may ever regress as
  // thoroughness rises. ----
  total++;
  const grid = Array.from({ length: 11 }, (_, n) => Math.round(n * 10) / 100);
  const scopeRank = { none: 0, delta: 1, all: 2 };
  let monotonicityBroken = null;
  for (let a = 0; a < grid.length && !monotonicityBroken; a++) {
    for (let b = a + 1; b < grid.length && !monotonicityBroken; b++) {
      const lo = resolveBudget({ thoroughness: grid[a] });
      const hi = resolveBudget({ thoroughness: grid[b] });
      const checks = [
        [!lo.finders["consumer-impact"] || hi.finders["consumer-impact"], "consumer-impact activation regressed"],
        [!lo.finders.dependency || hi.finders.dependency, "dependency activation regressed"],
        [!lo.finders.standards || hi.finders.standards, "standards activation regressed"],
        [scopeRank[lo.finderScope["consumer-impact"]] <= scopeRank[hi.finderScope["consumer-impact"]], "consumer-impact scope narrowed"],
        [scopeRank[lo.finderScope.standards] <= scopeRank[hi.finderScope.standards], "standards scope narrowed"],
        [lo.correctnessVotes <= hi.correctnessVotes, "correctnessVotes regressed"],
        [lo.topology !== "parallel" || hi.topology === "parallel", "topology regressed from parallel to in-context"],
        [lo.maxVerificationTier <= hi.maxVerificationTier, "maxVerificationTier regressed"],
        [lo.holisticEscalationCap <= hi.holisticEscalationCap, "holisticEscalationCap regressed"],
        [!lo.optimalityLens || hi.optimalityLens, "optimalityLens regressed"],
        [!lo.measurabilityLens || hi.measurabilityLens, "measurabilityLens regressed"],
        [!lo.holisticBroadPass || hi.holisticBroadPass, "holisticBroadPass regressed"],
        [lo.toolCallMultiplier <= hi.toolCallMultiplier, "toolCallMultiplier regressed"],
      ];
      const broke = checks.find(([ok]) => !ok);
      if (broke) monotonicityBroken = `t=${grid[a]} -> t=${grid[b]}: ${broke[1]}`;
    }
  }
  if (!monotonicityBroken) passed++;
  else fails.push(`monotonicity violated: ${monotonicityBroken}`);

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
