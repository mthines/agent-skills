#!/usr/bin/env node
// @ts-check
// delta-triage.mjs — pure delta-triage functions (pr-reviewer deterministic
// pipeline, R4). Ports the Step 1.2b jq/bash idioms in agents/pr-reviewer.md
// (guarded, before this file existed, by L1's G35 — which executed the
// SHIPPED prose snippets against these same fixtures) into typed,
// unit-testable JS. Same fixtures, same expectations: `scripts/eval/fixtures/
// delta-triage/`. No I/O — the caller (prepare-review.mjs, D10) does the
// `gh api compare` / tree reads and passes the JSON in.
//
// Divergence pre-check (agents/pr-reviewer.md § "Divergence pre-check — never
// trust compare/<PRIOR>...<HEAD> blind"): `compare/PRIOR...HEAD` is an
// authored delta ONLY while history is intact. A rebased/force-pushed branch
// degenerates the range into "the PR plus everything reachable from the new
// base"; a merge-commit head sweeps in the whole merged base. Fetch the
// summary fields first (status, behind_by) and branch on them — never trust
// the full comparison body blind.

/** @typedef {{status?: string, behind_by?: number}} CompareMeta */
/** @typedef {{filename: string, status?: string, additions?: number, deletions?: number, sha?: string, patch?: string|null}} PrFile */
/** @typedef {{path: string, sha: string}} TreeEntry */

/**
 * "intact" when the range is a real incremental delta (status ahead, behind
 * 0); "diverged" for everything else — diverged, behind, a non-zero
 * behind_by, or an erroring compare (an orphaned PRIOR_SHA). "diverged" is
 * the SAFE default: an unrecognised status classifies as diverged rather
 * than as intact, because trusting a compare that isn't provably intact is
 * exactly the failure this pre-check exists to prevent.
 * @param {CompareMeta} meta @returns {"intact"|"diverged"}
 */
export function classifyDivergence(meta) {
  if (meta && meta.status === "ahead" && (meta.behind_by ?? 0) === 0) return "intact";
  return "diverged";
}

/**
 * The blob-SHA authored delta (rebase-immune), for diverged history. Mirrors
 * the shipped jq exactly:
 *   ($prior[0] | map({key: .path, value: .sha}) | from_entries) as $was
 *   | [ .[] | select(.status == "removed" or ($was[.filename] // "") != .sha) ]
 * A removed file is kept UNCONDITIONALLY — `pulls/{n}/files` reports a
 * removed row with the DELETED blob's sha, which equals its sha in the prior
 * tree, so a blob-equality test alone would read every deletion as
 * "unchanged" and a deletion-only push as a zero delta.
 * @param {PrFile[]} prFiles @param {TreeEntry[]} priorTree @returns {PrFile[]}
 */
export function blobDelta(prFiles, priorTree) {
  /** @type {Map<string, string>} */
  const was = new Map();
  for (const e of priorTree || []) was.set(e.path, e.sha);
  return (prFiles || []).filter((f) => f.status === "removed" || (was.get(f.filename) ?? "") !== f.sha);
}

/**
 * `{delta_lines, new_files}` from a file list — shared shape between the
 * intact-compare route and the blob-diff route, since both produce the same
 * `{filename, additions, deletions, status}` rows.
 * @param {PrFile[]} files @returns {{deltaLines: number, newFiles: number}}
 */
export function deltaCounts(files) {
  const list = files || [];
  const deltaLines = list.reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0);
  const newFiles = list.filter((f) => f.status === "added").length;
  return { deltaLines, newFiles };
}

export const FULL_REFRESH_DELTA = 150;

/**
 * Cumulative churn since the last full pass (the deep-lens-refresh input,
 * D4). Three states, matching the shipped bash exactly:
 *   - no last-full SHA on record -> 0 (nothing to accumulate against)
 *   - intact compare -> the real summed delta
 *   - diverged compare -> FULL_REFRESH_DELTA + 1, i.e. treated as OVER the
 *     threshold rather than guessed — "diverged history ⇒ refresh, never
 *     guess" (agents/pr-reviewer.md § Cumulative churn since the last full pass).
 * @param {{hasLastFull: boolean, meta?: CompareMeta, deltaLinesIfIntact?: number}} input
 * @returns {number}
 */
export function churnState({ hasLastFull, meta, deltaLinesIfIntact }) {
  if (!hasLastFull) return 0;
  if (classifyDivergence(meta || {}) === "intact") return deltaLinesIfIntact ?? 0;
  return FULL_REFRESH_DELTA + 1;
}

/* --------------------------------- self-test --------------------------------- */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "scripts", "eval", "fixtures", "delta-triage");

function selfTest() {
  /** @type {string[]} */
  const fails = [];
  /** @param {string} label @param {boolean} cond @param {string} [detail] */
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? " — " + detail : ""}`); };

  // classifyDivergence
  ok("intact: status=ahead, behind_by=0", classifyDivergence({ status: "ahead", behind_by: 0 }) === "intact");
  ok("diverged: status=diverged", classifyDivergence({ status: "diverged", behind_by: 0 }) === "diverged");
  ok("diverged: status=ahead but behind_by>0 (merge-commit sweep shape)", classifyDivergence({ status: "ahead", behind_by: 3 }) === "diverged");
  ok("diverged: status=behind", classifyDivergence({ status: "behind" }) === "diverged");
  ok("diverged: empty/erroring compare (orphaned PRIOR_SHA) defaults safe", classifyDivergence({}) === "diverged");

  // deltaCounts against compare-intact.json (mirrors G35c: delta_lines=8, new_files=1)
  const compareIntact = JSON.parse(readFileSync(join(FIX, "compare-intact.json"), "utf8"));
  ok("compare-intact.json classifies intact", classifyDivergence(compareIntact) === "intact");
  const intactCounts = deltaCounts(compareIntact.files);
  ok("deltaCounts over compare-intact.json: delta_lines=8, new_files=1, files=2",
    intactCounts.deltaLines === 8 && intactCounts.newFiles === 1 && compareIntact.files.length === 2,
    JSON.stringify(intactCounts));

  // blobDelta against tree-prior.json + pr-files.ndjson (mirrors G35f: keeps
  // changed + added + removed, drops the identical blob).
  const priorTree = JSON.parse(readFileSync(join(FIX, "tree-prior.json"), "utf8"));
  const prFiles = readFileSync(join(FIX, "pr-files.ndjson"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const delta = blobDelta(prFiles, priorTree);
  const names = delta.map((f) => f.filename).sort();
  ok("blobDelta keeps changed + added + removed files and drops the identical blob",
    JSON.stringify(names) === JSON.stringify(["assets/logo.png", "src/legacy/cleanup.ts", "src/util.ts"]),
    JSON.stringify(names));
  const blobCounts = deltaCounts(delta);
  ok("deltaCounts over the blob delta: new_files=1 (assets/logo.png)", blobCounts.newFiles === 1, JSON.stringify(blobCounts));

  // A pure-identical prior tree yields a zero authored delta (the rebase/amend case).
  const identical = blobDelta(
    [{ filename: "a.ts", status: "modified", additions: 1, deletions: 0, sha: "same" }],
    [{ path: "a.ts", sha: "same" }],
  );
  ok("blobDelta returns empty when every blob is identical to the prior tree (zero authored delta)", identical.length === 0);

  // A removed file is kept even though `pulls/{n}/files` reports its DELETED
  // blob sha, which equals the prior tree's sha for that path — the case a
  // naive blob-equality test would misread as "unchanged".
  const removedKept = blobDelta(
    [{ filename: "gone.ts", status: "removed", additions: 0, deletions: 10, sha: "same-as-prior" }],
    [{ path: "gone.ts", sha: "same-as-prior" }],
  );
  ok("blobDelta keeps a removed file even when its blob sha matches the prior tree", removedKept.length === 1);

  // churnState
  ok("churnState: no last-full SHA -> 0", churnState({ hasLastFull: false }) === 0);
  ok("churnState: intact compare -> the real summed delta", churnState({ hasLastFull: true, meta: { status: "ahead", behind_by: 0 }, deltaLinesIfIntact: 42 }) === 42);
  ok("churnState: diverged compare -> FULL_REFRESH_DELTA + 1, never guessed",
    churnState({ hasLastFull: true, meta: { status: "diverged" }, deltaLinesIfIntact: 5 }) === FULL_REFRESH_DELTA + 1);

  console.log(`${fails.length === 0 ? "✓" : "✗"} delta-triage self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  if (fails.length) process.exit(1);
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("delta-triage.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
  selfTest();
}
