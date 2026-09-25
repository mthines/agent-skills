// @ts-check
/**
 * finalize/payload.mjs — assembles the render-report.mjs / render-comment.mjs
 * payload from the finalize pipeline's own outputs. Pure. No I/O (D18).
 *
 * SCOPE NOTE (honest, not a silent gap): this module produces a real,
 * internally-consistent payload from finalize's own computed state — verdict,
 * gates, findings, quality counters — but has NOT been verified byte-identical
 * against the existing `scripts/eval/fixtures/report-body/*.expected.md`
 * fixtures render-report.mjs already ships (that is AC-11's own job, deferred
 * — see the plan's Progress Log). Treat every field below as "confidently
 * sourced from a rule file" (gate scalars, FINDINGS, FAIL_REASONS/WARN_REASONS,
 * the Quality Gate counters — per-comment-confidence.md § Logging's own
 * documented text shape) EXCEPT for MEMORIES_SUMMARY, INTEGRATIONS, and
 * SKIPPED_FILES, whose exact rendered shape this module has not cross-checked
 * against render-report.mjs's validator and should not be trusted as final
 * until AC-11 lands.
 */

const GATE_FIELD = { g1: "GATE_DESCRIPTION", g3: "GATE_PRIOR", g4: "GATE_SELFREVIEW", g5: "GATE_DOCS", g6: "GATE_CODEREVIEW" };

/**
 * @param {{ dedupeDropped: number, produced: number, confidenceDrops: number, confidenceDeferred: number, suppressed: number, cleared: number, deferredOverCap: number, posted: number }} counters
 */
export function buildQualitySummary(counters) {
  const {
    produced, dedupeDropped, confidenceDrops, confidenceDeferred,
    suppressed, cleared, deferredOverCap, posted,
  } = counters;
  return [
    "Quality Gate:",
    `  Findings produced:        ${produced}`,
    `  Dedupe drops:              ${dedupeDropped}`,
    `  Confidence drops:          ${confidenceDrops}`,
    `  Confidence-deferred (advisory): ${confidenceDeferred}`,
    `  Memory suppressions:       ${suppressed}`,
    `  Findings cleared:          ${cleared}`,
    `  Deferred (over inline cap): ${deferredOverCap}`,
    `  Final findings posted:     ${posted}`,
  ].join("\n");
}

/**
 * @param {{ gates: any, run: any, findings: any[], deferred: any[], lowConfidence: any[], quality: string, ciNote?: string }} args
 * @returns {any} a render-report.mjs-shaped payload (subject to AC-11's verification)
 */
export function buildReportPayload({ gates, run, findings, deferred, lowConfidence, quality, ciNote }) {
  const failReasons = [];
  const warnReasons = [];
  for (const [key, field] of Object.entries(GATE_FIELD)) {
    const g = gates[key];
    if (!g) continue;
    if (g.status === "FAIL") failReasons.push(`${field}: ${g.details}`);
    if (g.status === "WARN") warnReasons.push(`${field}: ${g.details}`);
  }

  /** @type {Record<string, any>} */
  const payload = {
    VERDICT: gates.verdict,
    SUMMARY: run.summary || "",
    MEMORIES_SUMMARY: run.memoriesSummary || "no relevance rules or lessons consulted",
    QUALITY: quality,
    INTEGRATIONS: run.integrations || "none",
    OPTIMALITY_LOG: run.optimalityLog || "skipped",
    STANDARDS_LOG: run.standardsLog || "skipped",
    MEASURABILITY_LOG: run.measurabilityLog || "skipped",
    SKIPPED_FILES: run.skippedFiles || "",
    RUN: run,
    FINDINGS: findings,
    FAIL_REASONS: failReasons,
    WARN_REASONS: warnReasons,
    OPEN_THREADS: gates.g3?.open || [],
    ADDITIONAL_FINDINGS: deferred,
    LOW_CONFIDENCE_FINDINGS: lowConfidence,
  };
  for (const [key, field] of Object.entries(GATE_FIELD)) {
    const g = gates[key];
    payload[`${field}_STATUS`] = g?.status ?? "SKIPPED";
    payload[`${field}_DETAILS`] = g?.details ?? "--skip-gates";
  }
  if (ciNote) payload.CI_NOTE = ciNote;
  return payload;
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  const gates = {
    verdict: "FAIL",
    g1: { status: "PASS", details: "matches" },
    g3: { status: "PASS", details: "no open threads", open: [] },
    g4: { status: "FAIL", details: "1 confirmed pre-candidate(s), 0 AI-stub finding(s)" },
    g5: { status: "PASS", details: "docs updated" },
    g6: { status: "WARN", details: "1 inline, 0 deferred non-blocking finding(s)" },
  };
  const run = { mode: "full", sha: "abc1234", delta_lines: 10, tier: "deep", depth: "checkout", summary: "one blocking issue" };
  const quality = buildQualitySummary({
    produced: 5, dedupeDropped: 1, confidenceDrops: 1, confidenceDeferred: 0,
    suppressed: 0, cleared: 3, deferredOverCap: 0, posted: 3,
  });
  const payload = buildReportPayload({ gates, run, findings: [{ id: 1 }], deferred: [], lowConfidence: [], quality });

  check("VERDICT passes through from gates.verdict", payload.VERDICT === "FAIL");
  check("GATE_SELFREVIEW_STATUS maps from gate4", payload.GATE_SELFREVIEW_STATUS === "FAIL");
  check("GATE_PRIOR_STATUS maps from gate3", payload.GATE_PRIOR_STATUS === "PASS");
  check("GATE_DOCS_STATUS maps from gate5", payload.GATE_DOCS_STATUS === "PASS");
  check("GATE_CODEREVIEW_STATUS maps from gate6", payload.GATE_CODEREVIEW_STATUS === "WARN");
  check("FAIL_REASONS names the failing gate", payload.FAIL_REASONS.some((/** @type {string} */ r) => r.startsWith("GATE_SELFREVIEW")));
  check("WARN_REASONS names the warning gate", payload.WARN_REASONS.some((/** @type {string} */ r) => r.startsWith("GATE_CODEREVIEW")));
  check("FINDINGS passes through", payload.FINDINGS.length === 1);
  check("QUALITY carries the documented Quality Gate summary shape", /^Quality Gate:\n  Findings produced:/.test(payload.QUALITY));

  if (failed > 0) {
    console.error(`\npayload self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ payload self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
