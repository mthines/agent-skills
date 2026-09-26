// @ts-check
/**
 * finalize/findings-bus.mjs — D16: finalize.mjs --writer findings-bus emits
 * .agent/{branch}/findings.jsonl records for branch-reviewer reuse, instead
 * of a GitHub write plan. Pure. No I/O (D18) — the CLI layer does the append.
 *
 * Record shape is skills/quality/review-branch/rules/findings-bus.md's own
 * worked example, verbatim field set:
 *   fp, iteration, state, prefix, severity, blocking, score, verdict,
 *   path, line, title, body, fix, evidence[], note, sha
 *
 * Every field except `note` is reviewer-immutable once written; `note` is
 * null at emission time (only the convergence loop's replies populate it).
 */

import { buildFingerprint } from "../fingerprint.mjs";

export const FINDINGS_BUS_FIELDS = Object.freeze([
  "fp", "iteration", "state", "prefix", "severity", "blocking", "score", "verdict",
  "path", "line", "title", "body", "fix", "evidence", "note", "sha",
]);

/**
 * @param {any[]} findings - post-placement, cleared candidates (inline + deferred)
 * @param {{ iteration: number, sha: string }} args
 * @returns {any[]}
 */
export function toFindingsBusRecords(findings, { iteration, sha }) {
  return findings.map((f) => ({
    fp: buildFingerprint({ finder: f.finder, defectClass: f.defect_class, symbol: f.symbol || "", path: f.path }),
    iteration,
    state: "open",
    prefix: f.prefix,
    severity: f.severity,
    blocking: f.blocking === true,
    score: f.final,
    verdict: f.verdict,
    path: f.path,
    line: f.line ?? null,
    title: f.title ?? null,
    body: f.body,
    fix: f.fix ?? null,
    evidence: Array.isArray(f.evidence) ? f.evidence : [],
    note: null,
    sha,
  }));
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  const finding = {
    finder: "consumer-impact", defect_class: "contract-break", symbol: "retryRequest", path: "src/jobs/sync.ts",
    line: 88, prefix: "issue", severity: "high", blocking: true, final: 91, verdict: "confirmed",
    title: "Caller still checks === null after the throw",
    body: "retryRequest now throws instead of returning null; this caller never catches it.",
    fix: "catch RetryExhausted explicitly",
    evidence: ["src/api/client.ts:214 (throw added)", "src/jobs/sync.ts:88 (null check)"],
  };
  const records = toFindingsBusRecords([finding], { iteration: 1, sha: "a1b2c3d" });

  check("emits exactly one record per finding", records.length === 1);
  check("record keys equal findings-bus.md's documented field set exactly",
    JSON.stringify(Object.keys(records[0]).sort()) === JSON.stringify([...FINDINGS_BUS_FIELDS].sort()));
  check("fp is built via the shared fingerprint.mjs builder", records[0].fp === "consumer-impact:contract-break:retryRequest@src/jobs/sync.ts");
  check("state defaults to open at emission", records[0].state === "open");
  check("note is null at emission (reviewer-immutable field the loop alone fills)", records[0].note === null);
  check("blocking coerces to a real boolean", records[0].blocking === true);
  check("score reads from the finding's Final verifier score", records[0].score === 91);

  if (failed > 0) {
    console.error(`\nfindings-bus self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ findings-bus self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
