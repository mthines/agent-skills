#!/usr/bin/env node
// jev-call.mjs — the concrete, zero-dependency call path for jev-assert.
// Implements the receipt-mapping.md contract against TypeSafe's Jev API: build the
// fixed Noul question from an expectation, POST it, and map the returned probability
// onto exactly one verify-behavior receipt verdict. Node >= 20 (global fetch), ESM.
//
// Usage:
//   node ${CLAUDE_SKILL_DIR}/scripts/jev-call.mjs --expectation "<outcome>" [--state-file <path>]
//        [--threshold-high N] [--threshold-low N] [--target <label>]
//   node ${CLAUDE_SKILL_DIR}/scripts/jev-call.mjs --self-test
//
// State comes from --state-file, or from stdin when the flag is absent (the runners
// pipe captured page text in). The API key is read from TYPESAFE_API_KEY; when it is
// unset — or the API cannot be reached — the verdict is `unobtainable`, never a guess.
//
// Output is the verify-behavior receipt block; the last `[receipt] verdict: <token>`
// line is the machine-read one. Exit 0 when a receipt was produced (any verdict is a
// successful check), 2 on a usage error. `--self-test` exits 0/1 on its own contract.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const API = "https://api.typesafe.ai/v1/systemone"; // docs.typesafe.ai/api — POST evaluation endpoint
const MODEL = "jev-latest";                          // docs: the current Jev model tag
const DEFAULT_HIGH = 0.85;                            // receipt-mapping.md § Threshold calibration defaults
const DEFAULT_LOW = 0.15;
const VERDICTS = ["confirms", "contradicts", "ambiguous", "null", "unobtainable"]; // closed set (receipt-mapping.md)

/** Map a Noul probability to a verdict. `null`/`undefined` noul means the call ran but
 *  returned no probability — that is `null` (ran, no support), never `unobtainable`
 *  (which is a CALL failure, decided by the caller, not here). */
export function mapVerdict(noul, high = DEFAULT_HIGH, low = DEFAULT_LOW) {
  if (noul === null || noul === undefined || Number.isNaN(noul)) return "null";
  if (noul >= high) return "confirms";
  if (noul <= low) return "contradicts";
  return "ambiguous";
}

/** Thresholds are decision bands: each must be a finite number in [0, 1], and low must
 *  not sit above high (an inverted band would map every probability to `ambiguous`).
 *  A non-finite threshold — `Number("abc")` is `NaN` — otherwise silently turns every
 *  `confirms` into `ambiguous` (a high noul fails `>= NaN`) with no error, which is the
 *  confident-but-wrong failure Core Principle #4 forbids. */
export function validThresholds(high, low) {
  return Number.isFinite(high) && Number.isFinite(low)
    && high >= 0 && high <= 1 && low >= 0 && low <= 1 && low <= high;
}

/** Build the fixed Noul request body from the expectation and state. */
export function buildBody(pageText, expectation) {
  return {
    state: { page_text: pageText },
    model: MODEL,
    questions: {
      assertion: {
        type: "noul",
        instructions: `Does the page state show that ${expectation}?`,
        criteria: {
          true: `The page state shows that ${expectation}.`,
          false: `The page state does not show that ${expectation}.`,
        },
      },
    },
  };
}

async function callJev(pageText, expectation) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) return { verdict: "unobtainable", reason: "TYPESAFE_API_KEY unset" };
  if (!pageText || !pageText.trim()) return { verdict: "unobtainable", reason: "no page text state captured" };
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(pageText, expectation)),
    });
  } catch (e) {
    return { verdict: "unobtainable", reason: `network: ${e.message}` };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return { verdict: "unobtainable", reason: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
  }
  let json;
  try { json = await res.json(); } catch (e) { return { verdict: "unobtainable", reason: `bad JSON: ${e.message}` }; }
  // A response missing the whole `answers.assertion` object is a schema/contract drift —
  // the call could not be READ, so it is `unobtainable` (a tooling verdict), not `null`.
  // A present answer object without a `noul` is genuine "ran, no support" and falls through
  // to mapVerdict → `null`, exactly as documented.
  if (!json?.answers?.assertion) return { verdict: "unobtainable", reason: "unexpected response shape (no answers.assertion)" };
  const noul = json.answers.assertion.noul;
  return { noul, usage: json?.usage };
}

function printReceipt({ target, expectation, noul, verdict, reason, high, low }) {
  console.log(`[receipt] tier: 3 | tool: jev | target: ${target}`);
  console.log(`[receipt] question: Does the page state show that ${expectation}?`);
  if (noul !== undefined && noul !== null) console.log(`[receipt] jev: noul=${noul.toFixed(3)} (high=${high} low=${low})`);
  if (reason) console.log(`[receipt] reason: ${reason}`);
  console.log(`[receipt] verdict: ${verdict}`);
}

function parseArgs(argv) {
  const args = { high: DEFAULT_HIGH, low: DEFAULT_LOW, target: "page" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--expectation") args.expectation = argv[++i];
    else if (a === "--state-file") args.stateFile = argv[++i];
    else if (a === "--threshold-high") args.high = Number(argv[++i]);
    else if (a === "--threshold-low") args.low = Number(argv[++i]);
    else if (a === "--target") args.target = argv[++i];
  }
  return args;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest() ? 0 : 1);

  const args = parseArgs(argv);
  if (!args.expectation) { console.error("usage: jev-call.mjs --expectation \"<outcome>\" [--state-file <path>]"); process.exit(2); }
  if (!validThresholds(args.high, args.low)) {
    console.error(`error: --threshold-high/--threshold-low must be numbers in [0,1] with low <= high (got high=${args.high} low=${args.low})`);
    process.exit(2);
  }

  let pageText = "";
  if (args.stateFile) {
    try { pageText = readFileSync(args.stateFile, "utf8"); }
    catch (e) { console.error(`cannot read --state-file: ${e.message}`); process.exit(2); }
  } else if (!process.stdin.isTTY) {
    pageText = readFileSync(0, "utf8"); // stdin
  }

  const r = await callJev(pageText, args.expectation);
  const verdict = r.verdict ?? mapVerdict(r.noul, args.high, args.low);
  printReceipt({ target: args.target, expectation: args.expectation, noul: r.noul, verdict, reason: r.reason, high: args.high, low: args.low });
  process.exit(0);
}

// ── --self-test (offline: exercises the pure mapping + body builder, no network) ──
function selfTest() {
  let fails = 0, asserts = 0;
  const t = (label, ok) => { asserts++; if (!ok) { fails++; console.error(`  ✗ ${label}`); } };

  // Boundaries of the mapping (receipt-mapping.md § The mapping).
  t("0.98 → confirms", mapVerdict(0.98) === "confirms");
  t("0.85 is inclusive → confirms", mapVerdict(0.85) === "confirms");
  t("0.84 → ambiguous", mapVerdict(0.84) === "ambiguous");
  t("0.50 → ambiguous", mapVerdict(0.5) === "ambiguous");
  t("0.16 → ambiguous", mapVerdict(0.16) === "ambiguous");
  t("0.15 is inclusive → contradicts", mapVerdict(0.15) === "contradicts");
  t("0.02 → contradicts", mapVerdict(0.02) === "contradicts");
  t("undefined noul → null (ran, no support)", mapVerdict(undefined) === "null");
  t("null noul → null", mapVerdict(null) === "null");
  t("NaN noul → null", mapVerdict(NaN) === "null");

  // Custom thresholds shift the bands.
  t("custom high 0.95: 0.9 → ambiguous", mapVerdict(0.9, 0.95, 0.05) === "ambiguous");
  t("custom low 0.30: 0.25 → contradicts", mapVerdict(0.25, 0.85, 0.3) === "contradicts");

  // Threshold validation (Core Principle #4 — reject a band that would silently misgrade).
  t("defaults are valid", validThresholds(DEFAULT_HIGH, DEFAULT_LOW));
  t("0/1 boundaries are valid", validThresholds(1, 0));
  t("NaN high is rejected", !validThresholds(NaN, 0.15));
  t("NaN low is rejected", !validThresholds(0.85, NaN));
  t("out-of-range high is rejected", !validThresholds(1.5, 0.15));
  t("negative low is rejected", !validThresholds(0.85, -0.1));
  t("inverted band (low > high) is rejected", !validThresholds(0.2, 0.8));

  // Every mapping output is in the closed verdict set.
  for (const p of [0.99, 0.5, 0.01, undefined]) t(`mapVerdict(${p}) ∈ closed set`, VERDICTS.includes(mapVerdict(p)));

  // The body builder produces the fixed Noul shape the API contract expects.
  const b = buildBody("Order confirmed. Number 12931.", "the user sees an order-confirmation number");
  t("body.model is jev-latest", b.model === MODEL);
  t("body question is a noul", b.questions.assertion.type === "noul");
  t("body instructions embed the expectation", b.questions.assertion.instructions.includes("order-confirmation number"));
  t("body has true/false criteria", !!b.questions.assertion.criteria.true && !!b.questions.assertion.criteria.false);
  t("body carries the page text as state", b.state.page_text.includes("12931"));

  console.log(fails === 0 ? `jev-call self-test: PASS (${asserts} assertions)` : `jev-call self-test: FAIL (${fails} failure(s))`);
  return fails === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
