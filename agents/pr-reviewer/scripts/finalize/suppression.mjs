// @ts-check
/**
 * finalize/suppression.mjs — agents/pr-reviewer/rules/memory.md § Lifecycle +
 * rubric-composition.md § Memory suppression. Pure. No I/O, clock, or env (D18).
 *
 * Lifecycle is RECOMPUTED AT READ TIME from evidence[], never trusted from a
 * stored `status` field (memory.md: "it does not delete anything ... a rule
 * that should stop firing goes disabled, which is a write, not a delete" —
 * i.e. the write records evidence; the read derives the state).
 *
 * Applied at PLACEMENT (after verification, after confidence) — never at
 * find time. A standards finding or a (blocking) finding is NEVER
 * suppressible, however many concordant signals exist.
 */

import { buildFingerprint } from "../fingerprint.mjs";

/**
 * @param {{ evidence?: { pr: string|number, concordant?: boolean }[] }} rule
 * @returns {"candidate"|"active"|"disabled"}
 */
export function computeRuleStatus(rule) {
  const evidence = Array.isArray(rule?.evidence) ? rule.evidence : [];
  const concordant = evidence.filter((e) => e && e.concordant !== false);
  const contradicting = evidence.filter((e) => e && e.concordant === false);
  const distinctPRs = new Set(concordant.map((e) => e.pr)).size;
  if (concordant.length >= 3 && distinctPRs >= 2) {
    return contradicting.length >= 2 ? "disabled" : "active";
  }
  return "candidate";
}

/** @param {any} candidate */
export function isNeverSuppressible(candidate) {
  return candidate.defect_class === "standards" || candidate.blocking === true;
}

/**
 * @param {any[]} findings - already verified and confidence-cleared
 * @param {any[]} relevanceRules - judgments.memory.relevance_rules, copied verbatim from MCP
 * @returns {{ findings: any[], suppressed: any[] }}
 */
export function applySuppression(findings, relevanceRules) {
  const rules = Array.isArray(relevanceRules) ? relevanceRules : [];
  /** @type {Map<string, any>} */
  const ruleByFp = new Map();
  for (const r of rules) {
    if (r && typeof r.fp === "string") ruleByFp.set(r.fp, r);
  }

  /** @type {any[]} */
  const kept = [];
  /** @type {any[]} */
  const suppressed = [];

  for (const c of findings) {
    const fp = buildFingerprint({
      finder: c.finder,
      defectClass: c.defect_class,
      symbol: c.symbol || "",
      path: c.path,
    });
    const rule = ruleByFp.get(fp);
    const status = rule ? computeRuleStatus(rule) : "candidate";
    if (rule && rule.kind === "suppress" && status === "active" && !isNeverSuppressible(c)) {
      suppressed.push({ ...c, _suppressed_by_fp: fp, _suppression_evidence: rule.evidence || [] });
    } else {
      kept.push(c);
    }
  }

  return { findings: kept, suppressed };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // Lifecycle table (memory.md § Lifecycle).
  check("candidate: fewer than 3 concordant signals", computeRuleStatus({ evidence: [{ pr: 1 }, { pr: 2 }] }) === "candidate");
  check("candidate: 3+ concordant signals but from a single PR", computeRuleStatus({ evidence: [{ pr: 1 }, { pr: 1 }, { pr: 1 }] }) === "candidate");
  check("active: >=3 concordant signals from >=2 distinct PRs", computeRuleStatus({ evidence: [{ pr: 1 }, { pr: 1 }, { pr: 2 }] }) === "active");
  check("disabled: an otherwise-active rule with >=2 contradicting signals", computeRuleStatus({
    evidence: [{ pr: 1 }, { pr: 1 }, { pr: 2 }, { pr: 3, concordant: false }, { pr: 4, concordant: false }],
  }) === "disabled");
  check("1 contradicting signal alone does not disable an active rule", computeRuleStatus({
    evidence: [{ pr: 1 }, { pr: 1 }, { pr: 2 }, { pr: 3, concordant: false }],
  }) === "active");

  const makeCandidate = (over = {}) => ({
    finder: "quality", defect_class: "naming", path: "src/a.ts", line: 10, symbol: "foo",
    blocking: false, ...over,
  });
  const fp = buildFingerprint({ finder: "quality", defectClass: "naming", symbol: "foo", path: "src/a.ts" });
  const activeRule = { fp, kind: "suppress", evidence: [{ pr: 1 }, { pr: 1 }, { pr: 2 }] };

  {
    const { findings, suppressed } = applySuppression([makeCandidate()], [activeRule]);
    check("an active suppress rule drops a matching, non-never-suppressible finding", findings.length === 0 && suppressed.length === 1);
  }
  {
    const { findings, suppressed } = applySuppression([makeCandidate({ blocking: true })], [activeRule]);
    check("a (blocking) finding is NEVER suppressed, even under an active rule", findings.length === 1 && suppressed.length === 0);
  }
  {
    const standardsCandidate = makeCandidate({ defect_class: "standards" });
    const standardsFp = buildFingerprint({ finder: "quality", defectClass: "standards", symbol: "foo", path: "src/a.ts" });
    const rule = { fp: standardsFp, kind: "suppress", evidence: [{ pr: 1 }, { pr: 1 }, { pr: 2 }] };
    const { findings, suppressed } = applySuppression([standardsCandidate], [rule]);
    check("a standards finding is NEVER suppressed, even under an active rule", findings.length === 1 && suppressed.length === 0);
  }
  {
    const candidateStatusRule = { fp, kind: "suppress", evidence: [{ pr: 1 }, { pr: 2 }] }; // only 2 signals
    const { findings, suppressed } = applySuppression([makeCandidate()], [candidateStatusRule]);
    check("a candidate-status rule (not yet active) never suppresses", findings.length === 1 && suppressed.length === 0);
  }
  {
    const { findings, suppressed } = applySuppression([makeCandidate()], []);
    check("no matching rule at all leaves the finding untouched", findings.length === 1 && suppressed.length === 0);
  }

  if (failed > 0) {
    console.error(`\nsuppression self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ suppression self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
