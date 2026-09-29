// @ts-check
/**
 * finalize/gates.mjs — agents/pr-reviewer.md § Gate states (Step 1.8) + § Verdict.
 * Pure. No I/O, clock, or env (D18).
 *
 * Gate 1 (Description vs. code): two-state, PASS/WARN only, never fails.
 * Gate 2 (CI): informational-in-Run — no status here at all, never in FAIL/WARN
 *   reasons, never part of the verdict (surfaced only via a CI_NOTE upstream).
 * Gate 3 (Prior review feedback): tri-state PASS/WARN/FAIL, FAIL only on a
 *   blocking-decorated open thread that is unanswered.
 * Gate 4 (Self-review signals): hard gate, PASS/FAIL, from Gate 4 pre-candidate
 *   dispositions + AI-stub findings (judgments.json — the model's own call,
 *   never re-derived here).
 * Gate 5 (Documentation adequacy): hard gate, PASS/FAIL, passthrough.
 * Gate 6 (Code review): tri-state PASS/WARN/FAIL, on the blocking bar —
 *   FAIL iff a blocking finding is inline.
 *
 * Verdict (agents/pr-reviewer.md line 233 / 2658):
 *   FAIL when Gate 4 or Gate 5 fails, or Gate 3 or Gate 6 is FAIL.
 *   WARN when not FAIL and Gate 1, 3, or 6 is WARN.
 *   PASS otherwise. Gate 2 never participates.
 */

export const SKIPPED = Object.freeze({ status: "SKIPPED", details: "--skip-gates" });

/** @param {{status: "PASS"|"WARN", details: string}} [g] */
export function gate1(g) {
  return g || { status: "WARN", details: "no Gate 1 judgment provided" };
}

/** @param {{status: "PASS"|"FAIL", details: string}} [g] */
export function gate5(g) {
  return g || { status: "FAIL", details: "no Gate 5 judgment provided" };
}

/**
 * @param {{ precandidate_dispositions?: any[], ai_stub_findings?: any[] }} [g4]
 */
export function gate4(g4) {
  const dispositions = g4?.precandidate_dispositions || [];
  const aiStubs = g4?.ai_stub_findings || [];
  const confirmed = dispositions.filter((d) => d.disposition === "confirm");
  const fail = confirmed.length > 0 || aiStubs.length > 0;
  return {
    status: fail ? "FAIL" : "PASS",
    details: fail
      ? `${confirmed.length} confirmed pre-candidate(s), ${aiStubs.length} AI-stub finding(s)`
      : "No debug logs, leftover TODOs, or unreviewed stubs.",
  };
}

const RESOLVE_CLASSES = new Set(["fixed", "declined", "acknowledged", "obsolete"]);
const BLOCKING_DECORATION_RE = /\(blocking\)|(?:^|\n)\s*issue:|severity:\s*(?:critical|high)/i;

/**
 * @param {any[]} contextThreads - review-context.json's threads[] (from prepare-review.mjs)
 * @param {any[]} judgmentThreads - judgments.json's threads[]
 */
export function gate3(contextThreads, judgmentThreads) {
  const resolvedIds = new Set(
    (judgmentThreads || []).filter((t) => RESOLVE_CLASSES.has(t.classification)).map((t) => t.thread_id),
  );
  // A thread GitHub itself already marked resolved (buildThreads()'s `is_resolved`, straight off
  // the GraphQL `isResolved` field) is not "open" regardless of what THIS run's judgments say —
  // arm B's first live run (ab/B/20230/1/meta.json) counted 17 threads instead of 10 because this
  // filter only ever excluded threads the CURRENT run resolved, never ones already resolved on
  // GitHub (e.g. by a human clicking Resolve, or a prior run's thread.resolve op landing). Checked
  // both spellings — buildThreads() emits `is_resolved` (snake_case), but a hand-crafted or
  // GraphQL-shaped payload may carry `isResolved` (camelCase) instead.
  const isAlreadyResolved = (/** @type {any} */ t) => t.is_resolved === true || t.isResolved === true;
  const open = (contextThreads || []).filter((t) => !isAlreadyResolved(t) && !resolvedIds.has(t.thread_id));
  if (open.length === 0) return { status: "PASS", details: "Earlier review comments are resolved.", open };
  const blockingUnanswered = open.filter((t) => {
    const isBlocking = BLOCKING_DECORATION_RE.test(t.root_body || "");
    const answered = (t.replies || []).some((/** @type {any} */ r) => r.author !== t.author);
    return isBlocking && !answered;
  });
  // Both FAIL and WARN share one details template (report-body pass/warn/fail fixtures, AC-11) —
  // the count is every open thread, not just the blocking-unanswered subset, because the reader is
  // pointed at OPEN_THREADS_LIST right below either way, and that list always shows every open
  // thread.
  // `reason` is the SHORT noun phrase FAIL_REASONS/WARN_REASONS carries (render-report.mjs's
  // "Warnings:"/"FAIL:" summary line, AC-11) — distinct from `details`, which is the longer
  // sentence the gate TABLE cell shows. Every fixture that exercises either line uses this
  // shorter phrasing, never a copy of `details`.
  if (blockingUnanswered.length > 0) {
    const n = blockingUnanswered.length;
    return {
      status: "FAIL",
      details: `${open.length} unresolved review thread(s) — see the thread list below`,
      reason: `${n} unanswered blocking review thread${n === 1 ? "" : "s"}`,
      open,
    };
  }
  const n = open.length;
  return {
    status: "WARN",
    details: `${open.length} unresolved review thread(s) — see the thread list below`,
    reason: `${n} open review thread${n === 1 ? "" : "s"}`,
    open,
  };
}

/**
 * AC-11/D5: a tool-budget-exhausted PARTIAL_REVIEW run (report-rendering.md's
 * `PARTIAL_REVIEW` banner — `{calls, scanned, total}` with `scanned < total`) means the
 * code-review finders never completed a pass over the diff. Whatever partial findings DID
 * surface still post (FINDINGS[] / inline comments are untouched), but the GATE itself — a
 * claim that "the multi-lens review found no blocking issues" or found N — cannot be made
 * honestly from an incomplete scan, so it renders ⏭️ "not evaluated this run" instead of
 * PASS/WARN/FAIL. Distinct from `--skip-gates`'s SKIPPED (which carries "--skip-gates" or a
 * carried-forward reason and covers Gates 1/3/4/5, never 6) — this is Gate 6's own reason,
 * on Gate 6 alone, and participates in neither FAIL_REASONS/WARN_REASONS nor the verdict
 * (computeVerdict only matches literal "FAIL"/"WARN", so "SKIPPED" here is already excluded
 * with no special-casing needed).
 * @param {{ inline?: any[], deferred?: any[] }} [placement]
 * @param {boolean} [partialReview]
 */
export function gate6(placement, partialReview = false) {
  if (partialReview) {
    return { status: "SKIPPED", details: "not evaluated this run" };
  }
  const inline = placement?.inline || [];
  const deferred = placement?.deferred || [];
  const blockingInline = inline.filter((f) => f.blocking === true);
  // place() never defers a blocking finding; the only way one reaches `deferred` is finalize's
  // shape fallback (a verified blocker no truncation could make render inline) — it is still a
  // blocker, so it still FAILs, pointed at the report instead of an inline comment.
  const blockingDeferred = deferred.filter((f) => f.blocking === true);
  if (blockingInline.length > 0 || blockingDeferred.length > 0) {
    const n = blockingInline.length + blockingDeferred.length;
    const where = blockingDeferred.length > 0 ? "report" : "inline";
    return {
      status: "FAIL",
      details: `${n} blocking finding${n === 1 ? "" : "s"} — see ${where === "inline" ? "inline comments" : "the report"}.`,
      reason: `${n} blocking finding${n === 1 ? "" : "s"} (see ${where})`,
    };
  }
  if (inline.length > 0 || deferred.length > 0) {
    const n = inline.length + deferred.length;
    return {
      status: "WARN",
      details: `${n} non-blocking finding${n === 1 ? "" : "s"} — see inline comments.`,
      reason: `${n} non-blocking finding${n === 1 ? "" : "s"}`,
    };
  }
  return { status: "PASS", details: "The multi-lens review found no blocking issues." };
}

/**
 * @param {{ g1: {status:string}, g3: {status:string}, g4: {status:string}, g5: {status:string}, g6: {status:string} }} gates
 * @returns {"PASS"|"WARN"|"FAIL"}
 */
export function computeVerdict({ g1, g3, g4, g5, g6 }) {
  if (g4.status === "FAIL" || g5.status === "FAIL" || g3.status === "FAIL" || g6.status === "FAIL") {
    return "FAIL";
  }
  if (g1.status === "WARN" || g3.status === "WARN" || g6.status === "WARN") {
    return "WARN";
  }
  return "PASS";
}

/**
 * @param {{ skipGates?: boolean, judgmentsGates?: any, contextThreads?: any[], judgmentThreads?: any[], placement?: any, partialReview?: boolean }} args
 */
export function computeGates({ skipGates, judgmentsGates, contextThreads, judgmentThreads, placement, partialReview }) {
  if (skipGates) {
    return { g1: SKIPPED, g3: { ...SKIPPED, open: [] }, g4: SKIPPED, g5: SKIPPED, g6: SKIPPED, verdict: "SKIPPED" };
  }
  const g1 = gate1(judgmentsGates?.gate1);
  const g4 = gate4(judgmentsGates?.gate4);
  const g5 = gate5(judgmentsGates?.gate5);
  const g3 = gate3(contextThreads || [], judgmentThreads || []);
  const g6 = gate6(placement, partialReview);
  const verdict = computeVerdict({ g1, g3, g4, g5, g6 });
  return { g1, g3, g4, g5, g6, verdict };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // AC-10: Gate 3 ✅ / ⚠️ / ❌.
  {
    const g = gate3([], []);
    check("Gate 3 PASS (✅) — no open threads", g.status === "PASS");
  }
  {
    const contextThreads = [{ thread_id: "t1", root_body: "just a passing observation", author: "bot", replies: [] }];
    const g = gate3(contextThreads, []);
    check("Gate 3 WARN (⚠️) — an open thread with no blocking decoration", g.status === "WARN");
  }
  {
    const contextThreads = [{ thread_id: "t1", root_body: "issue: this breaks the auth flow (blocking)", author: "bot", replies: [] }];
    const g = gate3(contextThreads, []);
    check("Gate 3 FAIL (❌) — an open, unanswered, blocking-decorated thread", g.status === "FAIL");
  }
  {
    const contextThreads = [{ thread_id: "t1", root_body: "issue: this breaks the auth flow (blocking)", author: "bot", replies: [{ author: "human-author" }] }];
    const g = gate3(contextThreads, []);
    check("Gate 3 WARN, not FAIL — a blocking thread WITH a reply from someone else is answered", g.status === "WARN");
  }
  {
    const contextThreads = [{ thread_id: "t1", root_body: "issue: this breaks the auth flow (blocking)", author: "bot", replies: [] }];
    const judgmentThreads = [{ thread_id: "t1", classification: "declined", reply: "not a real issue" }];
    const g = gate3(contextThreads, judgmentThreads);
    check("a thread this run resolves is removed from the open set before Gate 3 grades", g.status === "PASS");
  }
  {
    // ab/B/20230/1/meta.json: Gate 3 counted 17 threads instead of 10 because a thread GitHub
    // already marked resolved (e.g. by a human, or a prior run's thread.resolve landing) was
    // still counted as open — this run's judgments never classified it, so the old filter (keyed
    // only on judgmentThreads) never excluded it.
    const contextThreads = [
      { thread_id: "t1", root_body: "issue: already resolved on GitHub (blocking)", author: "bot", replies: [], is_resolved: true },
      { thread_id: "t2", root_body: "just an observation", author: "human", replies: [] },
    ];
    const g = gate3(contextThreads, []);
    check("a thread already resolved on GitHub (is_resolved) is excluded from the open set, even with no judgment for it",
      g.open.length === 1 && g.open[0].thread_id === "t2" && g.status === "WARN");
  }
  {
    const contextThreads = [{ thread_id: "t1", root_body: "issue: x (blocking)", author: "bot", replies: [], isResolved: true }];
    const g = gate3(contextThreads, []);
    check("the camelCase isResolved spelling is honored too, not only is_resolved", g.status === "PASS" && g.open.length === 0);
  }
  {
    const contextThreads = [{ thread_id: "t1", root_body: "issue: x (blocking)", author: "bot", replies: [], is_resolved: false }];
    const g = gate3(contextThreads, []);
    check("is_resolved: false does not suppress an otherwise-open blocking thread", g.status === "FAIL" && g.open.length === 1);
  }

  // AC-10: Gate 2 red CI -> PASS (i.e. CI never participates in gates/verdict at all).
  {
    const gates = computeGates({
      skipGates: false,
      judgmentsGates: { gate1: { status: "PASS", details: "" }, gate4: {}, gate5: { status: "PASS", details: "" } },
      contextThreads: [], judgmentThreads: [],
      placement: { inline: [], deferred: [] },
    });
    // Nothing here ever reads a "ci" field — computeGates has no CI parameter at all,
    // so a red/pending CI status literally cannot flip this verdict off PASS.
    check("Gate 2 (CI) has no input to computeGates at all — verdict is PASS regardless of CI state", gates.verdict === "PASS");
  }

  // AC-10: --skip-gates -> ⏭️.
  {
    const gates = computeGates({ skipGates: true });
    check("--skip-gates renders every gate SKIPPED (⏭️) and a SKIPPED verdict",
      gates.g1.status === "SKIPPED" && gates.g3.status === "SKIPPED" && gates.g4.status === "SKIPPED"
      && gates.g5.status === "SKIPPED" && gates.g6.status === "SKIPPED" && gates.verdict === "SKIPPED");
  }

  // Gate 4 / Gate 6 / Gate 5 / verdict composition (supporting coverage beyond AC-10's named list).
  {
    const g = gate4({ precandidate_dispositions: [{ disposition: "confirm" }], ai_stub_findings: [] });
    check("Gate 4 FAILs on a confirmed pre-candidate", g.status === "FAIL");
  }
  {
    const g = gate4({ precandidate_dispositions: [{ disposition: "exempt" }], ai_stub_findings: [] });
    check("Gate 4 PASSes when every pre-candidate is exempt and there are no AI-stub findings", g.status === "PASS");
  }
  {
    const g = gate6({ inline: [{ blocking: true }], deferred: [] });
    check("Gate 6 FAILs when a blocking finding is inline", g.status === "FAIL");
  }
  {
    const g = gate6({ inline: [{ blocking: false }], deferred: [] });
    check("Gate 6 WARNs on a non-blocking inline finding", g.status === "WARN");
  }
  {
    // finalize's shape fallback can put a verified blocker in `deferred`; it must still FAIL.
    const g = gate6({ inline: [], deferred: [{ blocking: true }] });
    check("Gate 6 FAILs when a blocking finding was routed to the report body", g.status === "FAIL" && /report/.test(g.details));
  }
  {
    const g = gate6({ inline: [], deferred: [] });
    check("Gate 6 PASSes with no findings at all", g.status === "PASS");
  }
  {
    // AC-11: a tool-budget-exhausted PARTIAL_REVIEW run skips Gate 6, even with blocking
    // findings already inline (they still post — the GATE just can't claim complete coverage).
    const g = gate6({ inline: [{ blocking: true }], deferred: [] }, true);
    check("Gate 6 is SKIPPED (⏭️, \"not evaluated this run\") under a partial review, regardless of inline findings",
      g.status === "SKIPPED" && g.details === "not evaluated this run");
    const verdict = computeVerdict({
      g1: { status: "WARN" }, g3: { status: "FAIL" }, g4: { status: "PASS" }, g5: { status: "PASS" }, g6: g,
    });
    check("a SKIPPED Gate 6 never itself selects WARN or FAIL — the verdict here is driven by Gate 3 alone", verdict === "FAIL");
  }
  {
    const verdict = computeVerdict({
      g1: { status: "PASS" }, g3: { status: "PASS" }, g4: { status: "PASS" }, g5: { status: "PASS" }, g6: { status: "WARN" },
    });
    check("verdict is WARN (not FAIL) when only a graded gate warns", verdict === "WARN");
  }
  {
    const verdict = computeVerdict({
      g1: { status: "PASS" }, g3: { status: "PASS" }, g4: { status: "FAIL" }, g5: { status: "PASS" }, g6: { status: "PASS" },
    });
    check("verdict is FAIL when Gate 4 fails, even with every other gate clean", verdict === "FAIL");
  }

  if (failed > 0) {
    console.error(`\ngates self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ gates self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
