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

/**
 * Restrict an intact compare's file list to the PR's own diff (`pulls/{n}/files`, i.e.
 * base...head). An intact range (`ahead`, `behind_by` 0) is NOT proof that every file in it is
 * authored by the PR: a head that merges the base branch in keeps PRIOR an ancestor of HEAD, so
 * `compare/PRIOR...HEAD` stays `ahead` while carrying every file the merged-in base commits
 * touched (dash0#20655: 1355 lines, CODEOWNERS.bak and gradle files, against 97 authored ones).
 * Those files are not in the PR's own diff, so they are dropped here and reported, never routed on.
 * @param {PrFile[]} compareFiles @param {PrFile[]} prFiles
 * @returns {{files: PrFile[], dropped: string[], note: string|null}}
 */
export function restrictToPrFiles(compareFiles, prFiles) {
  const inPr = new Set((prFiles || []).map((f) => f.filename));
  /** @type {PrFile[]} */
  const files = [];
  /** @type {string[]} */
  const dropped = [];
  for (const f of compareFiles || []) {
    if (inPr.has(f.filename)) files.push(f);
    else dropped.push(f.filename);
  }
  const note = dropped.length
    ? `delta compare included ${dropped.length} file(s) outside the PR's own diff (merged-in base commits) — dropped`
    : null;
  return { files, dropped, note };
}

/**
 * Cumulative churn lines over the PR's own files only — the same restriction as
 * `restrictToPrFiles`, applied to the churn compare's per-file `{filename, lines}` rows.
 * @param {{filename: string, lines?: number}[] | undefined} perFile @param {PrFile[]} prFiles @returns {number}
 */
export function prChurnLines(perFile, prFiles) {
  const inPr = new Set((prFiles || []).map((f) => f.filename));
  return (perFile || []).reduce((n, f) => n + (inPr.has(f.filename) ? Number(f.lines) || 0 : 0), 0);
}

/** GitHub truncates a compare's `files` at 300 entries; a list that long cannot be trusted as complete. */
export const COMPARE_FILES_CAP = 300;

/** @typedef {{mergeCommits?: number, totalCommits?: number, listedCommits?: number}} CompareHistory */

/**
 * The commit-history fields compareTrust() reads, from a compare read projected with
 * `merge_commits` / `total_commits` / `listed_commits` (prepare-review.mjs's compare jq).
 * @param {any} v @returns {CompareHistory}
 */
export function compareHistory(v) {
  return { mergeCommits: v?.merge_commits, totalCommits: v?.total_commits, listedCommits: v?.listed_commits };
}

/**
 * Whether an INTACT compare's file list may be used as the delta. It may not when it is
 * truncated (length >= COMPARE_FILES_CAP — the authored files can be the ones cut off: on
 * dash0#20655 the 300 returned were main's, and the 4 authored files were absent), nor when
 * `restrictToPrFiles()` dropped anything (a merged-in base polluted the range, and the kept rows
 * are PR files the base ALSO touched, not the author's delta), nor when the range holds a merge
 * commit, or lists fewer commits than it has (GitHub lists 250) so one cannot be ruled out: a
 * merged-in base that touched ONLY files the PR also touches drops nothing, and would otherwise
 * pass as the author's delta. An untrusted list is never filtered into a delta; the caller
 * recomputes it from local git or the blob-SHA route.
 * @param {PrFile[]} compareFiles @param {PrFile[]} prFiles @param {CompareHistory} [history]
 * @returns {{trusted: true, files: PrFile[], reason: null} | {trusted: false, files: null, reason: string}}
 */
export function compareTrust(compareFiles, prFiles, history = {}) {
  const list = compareFiles || [];
  const own = restrictToPrFiles(list, prFiles);
  const truncated = list.length >= COMPARE_FILES_CAP;
  const merges = Number(history.mergeCommits) || 0;
  const { totalCommits: total, listedCommits: listed } = history;
  const unlisted = Number.isInteger(total) && Number.isInteger(listed) && /** @type {number} */ (total) > /** @type {number} */ (listed);
  if (!truncated && !own.note && !merges && !unlisted) return { trusted: true, files: own.files, reason: null };
  const parts = [];
  if (truncated) parts.push(`delta compare returned ${list.length} files (GitHub's ${COMPARE_FILES_CAP}-file cap) — truncated`);
  if (own.note) parts.push(own.note);
  if (merges) parts.push(`delta range holds ${merges} merge commit(s) — a merged-in base can touch the PR's own files`);
  if (unlisted) parts.push(`delta range has ${total} commits but the compare listed ${listed} — a merge commit cannot be ruled out`);
  return { trusted: false, files: null, reason: parts.join("; ") };
}

/**
 * Paths the author touched in `prior..head` (non-merge commits not reachable from the base tip,
 * plus files a merge among them resolved by hand, i.e. conflict resolutions), kept to the PR's
 * own files when that list is complete. A complete PR list excludes a file the author touched and
 * later reverted out of the PR; an incomplete one would wrongly drop authored files, so it is not
 * applied then. Order follows the PR list, then the rest sorted, so output is stable.
 * @param {Iterable<string>} touched @param {PrFile[]} prFiles @param {boolean} prFilesComplete
 * @returns {string[]}
 */
export function authoredPrPaths(touched, prFiles, prFilesComplete) {
  const t = new Set([...touched].filter(Boolean));
  if (!prFilesComplete) return [...t].sort();
  return (prFiles || []).map((f) => f.filename).filter((n) => t.has(n));
}

/**
 * `git diff --numstat` + `--name-status` + the patch text (all `--no-renames`) → the PR-files row
 * shape `{filename, status, additions, deletions, patch}`. `patch` starts at the first `@@`, like
 * the API's; a binary file (`-` counts, no hunk) gets 0/0 and a null patch. The patch must come from
 * a diff run with `a/`/`b/` prefixes (the caller forces them over `diff.noprefix`).
 * @param {string} numstat @param {string} nameStatus @param {string} patch @returns {PrFile[]}
 */
export function parseLocalDiff(numstat, nameStatus, patch) {
  /** @type {Record<string, string>} */
  const STATUS = { A: "added", D: "removed", M: "modified", T: "changed" };
  /** @type {Map<string, string>} */
  const statusOf = new Map();
  for (const line of String(nameStatus || "").split("\n")) {
    const m = /^([A-Z])\d*\t(.+)$/.exec(line);
    if (m) statusOf.set(m[2], STATUS[m[1]] || "modified");
  }
  /** @type {Map<string, string>} */
  const patchOf = new Map();
  for (const chunk of String(patch || "").split(/^(?=diff --git )/m)) {
    // git appends a TAB to a ---/+++ header whose path contains a space; the path ends before it.
    const path = /^\+\+\+ b\/(.+?)\t?$/m.exec(chunk)?.[1] ?? /^--- a\/(.+?)\t?$/m.exec(chunk)?.[1];
    const at = chunk.search(/^@@/m);
    if (path && at >= 0) patchOf.set(path, chunk.slice(at).replace(/\n$/, ""));
  }
  /** @type {PrFile[]} */
  const rows = [];
  for (const line of String(numstat || "").split("\n")) {
    const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
    if (!m) continue;
    const filename = m[3];
    rows.push({
      filename,
      status: statusOf.get(filename) || "modified",
      additions: m[1] === "-" ? 0 : Number(m[1]),
      deletions: m[2] === "-" ? 0 : Number(m[2]),
      patch: patchOf.get(filename) ?? null,
    });
  }
  return rows;
}

/**
 * `pulls/{n}/files` is paginated and capped at 3000 files; a short or partially-parsed list is
 * reported, never silently trusted as the PR's whole diff.
 * @param {number} listed @param {number|undefined} changedFiles @param {string|null} parseError
 * @returns {{complete: boolean, note: string|null}}
 */
export function prFilesCompleteness(listed, changedFiles, parseError) {
  if (parseError) return { complete: false, note: `PR files list partially unreadable (${parseError}) — delta restriction treats it as incomplete` };
  if (Number.isInteger(changedFiles) && listed < /** @type {number} */ (changedFiles)) {
    return { complete: false, note: `PR files list incomplete: ${listed} of ${changedFiles} changed files (pulls/{n}/files caps at 3000) — delta restriction treats it as incomplete` };
  }
  return { complete: true, note: null };
}

import { FULL_REFRESH_DELTA, CHURN_OVER_THRESHOLD } from "./route-depth.mjs";
export { FULL_REFRESH_DELTA, CHURN_OVER_THRESHOLD };
/** @typedef {{ok: true, files: PrFile[]} | {ok: false, reason: string}} LocalDeltaResult */
/** @typedef {{ok: true, tree: TreeEntry[]} | {ok: false, reason: string}} PriorTreeResult */

/**
 * The delta for an INTACT compare, with the I/O injected so the decision is testable. A trusted
 * compare list is the delta as-is. An untrusted one (compareTrust) is replaced — never filtered —
 * by the local-git authored delta when a checkout holds both SHAs (no truncation), else by the
 * blob-SHA route over the PR's own files (safe over-count), else the full PR list. Every
 * replacement returns an anomaly naming the route and why.
 * @param {{compareFiles: PrFile[], prFiles: PrFile[], history?: CompareHistory, readLocal: () => Promise<LocalDeltaResult>,
 *   readPriorTree: () => Promise<PriorTreeResult>}} input
 * @returns {Promise<{files: PrFile[], route: "compare"|"local-git"|"blob-diff"|"full-pr", anomaly: string|null}>}
 */
export async function resolveIntactDelta({ compareFiles, prFiles, history, readLocal, readPriorTree }) {
  const trust = compareTrust(compareFiles, prFiles, history);
  if (trust.trusted) return { files: trust.files, route: "compare", anomaly: null };
  const local = await readLocal();
  if (local.ok) {
    return { files: local.files, route: "local-git", anomaly: `${trust.reason}; delta computed from local git (authored commits in prior..head not on the base branch, over the PR's files)` };
  }
  if ((prFiles || []).every((f) => f.sha)) {
    const tree = await readPriorTree();
    if (tree.ok) {
      return { files: blobDelta(prFiles, tree.tree), route: "blob-diff", anomaly: `${trust.reason}; local git unavailable (${local.reason}) — delta from the blob-SHA route (over-counts toward full)` };
    }
    return { files: prFiles, route: "full-pr", anomaly: `${trust.reason}; local git unavailable (${local.reason}) and prior tree read failed (${tree.reason}) — full-PR delta` };
  }
  return { files: prFiles, route: "full-pr", anomaly: `${trust.reason}; local git unavailable (${local.reason}) and PR rows lack sha — full-PR delta` };
}

/**
 * Cumulative churn lines (D4) from the churn compare's per-file `{filename, lines}` rows. A
 * trusted list sums over the PR's files; an untrusted one (truncated or polluted) is replaced by
 * the local-git authored delta's lines, else read as OVER the refresh threshold — never guessed.
 * Either replacement returns an anomaly naming the route and the reason.
 * @param {{perFile: {filename: string, lines?: number}[], prFiles: PrFile[], history?: CompareHistory, readLocal: () => Promise<LocalDeltaResult>}} input
 * @returns {Promise<{lines: number, anomaly: string|null}>}
 */
export async function resolveChurnLines({ perFile, prFiles, history, readLocal }) {
  const trust = compareTrust(/** @type {PrFile[]} */ (perFile), prFiles, history);
  if (trust.trusted) return { lines: prChurnLines(perFile, prFiles), anomaly: null };
  const local = await readLocal();
  if (local.ok) {
    return { lines: deltaCounts(local.files).deltaLines, anomaly: `cumulative-churn compare untrusted (${trust.reason}) — churn computed from local git (authored commits since the last full pass, over the PR's files)` };
  }
  return { lines: CHURN_OVER_THRESHOLD, anomaly: `cumulative-churn compare untrusted (${trust.reason}) and local git unavailable (${local.reason}) — treated as over the refresh threshold` };
}

/**
 * Cumulative churn since the last full pass (the deep-lens-refresh input,
 * D4). Three states, matching the shipped bash exactly:
 *   - no last-full SHA on record -> 0 (nothing to accumulate against)
 *   - intact compare -> the real summed delta
 *   - diverged compare -> CHURN_OVER_THRESHOLD, i.e. treated as OVER every
 *     threshold rather than guessed — "diverged history ⇒ refresh, never
 *     guess" (agents/pr-reviewer.md § Cumulative churn since the last full pass).
 * @param {{hasLastFull: boolean, meta?: CompareMeta, deltaLinesIfIntact?: number}} input
 * @returns {number}
 */
export function churnState({ hasLastFull, meta, deltaLinesIfIntact }) {
  if (!hasLastFull) return 0;
  if (classifyDivergence(meta || {}) === "intact") return deltaLinesIfIntact ?? 0;
  return CHURN_OVER_THRESHOLD;
}

/* --------------------------------- self-test --------------------------------- */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, "..", "..", "..", "scripts", "eval", "fixtures", "delta-triage");

async function selfTest() {
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

  // restrictToPrFiles — dash0#20655: a head that merges main in keeps the compare `ahead`, but
  // the range carries main's files too; only the PR's own files may reach the delta.
  const prOwn = [{ filename: "src/a.ts" }, { filename: "src/b.ts" }];
  const merged = restrictToPrFiles(
    [{ filename: "src/a.ts", additions: 5, deletions: 2 }, { filename: "CODEOWNERS.bak", additions: 900, deletions: 0 },
      { filename: "build.gradle", additions: 400, deletions: 53 }],
    prOwn,
  );
  ok("restrictToPrFiles drops intact-compare files outside the PR's own diff",
    merged.files.length === 1 && merged.files[0].filename === "src/a.ts" && deltaCounts(merged.files).deltaLines === 7,
    JSON.stringify(merged.files.map((f) => f.filename)));
  ok("restrictToPrFiles names the dropped files and notes the count",
    JSON.stringify(merged.dropped) === JSON.stringify(["CODEOWNERS.bak", "build.gradle"])
      && merged.note === "delta compare included 2 file(s) outside the PR's own diff (merged-in base commits) — dropped",
    String(merged.note));
  const clean = restrictToPrFiles(compareIntact.files, compareIntact.files);
  ok("restrictToPrFiles leaves an intact compare with no extra files unchanged (no note)",
    clean.files.length === compareIntact.files.length && clean.files.every((f, i) => f === compareIntact.files[i])
      && clean.dropped.length === 0 && clean.note === null);

  // prChurnLines — the cumulative-churn compare (D4) gets the same restriction.
  ok("prChurnLines sums only the PR's own files",
    prChurnLines([{ filename: "src/a.ts", lines: 30 }, { filename: "src/b.ts", lines: 12 }, { filename: "build.gradle", lines: 1300 }], prOwn) === 42);
  ok("prChurnLines is 0 for an empty/absent list", prChurnLines([], prOwn) === 0 && prChurnLines(undefined, prOwn) === 0);

  // compareTrust — dash0#20655 read-only re-check: the compare returned exactly 300 files, all
  // main's but 4 PR files main also touched; the 4 authored files were cut off. Filtering that list
  // produced a small, WRONG delta. A truncated or polluted list must never become the delta.
  const pr20655 = [{ filename: "agent0/store.ts", status: "modified", sha: "new1" }, { filename: "agent0/page.tsx", status: "modified", sha: "new2" },
    { filename: "gen/attributes.gen.ts", status: "modified", sha: "new3" }];
  const truncatedCmp = Array.from({ length: 299 }, (_, i) => ({ filename: `main/f${i}.ts`, additions: 1, deletions: 0 }))
    .concat([{ filename: "gen/attributes.gen.ts", additions: 400, deletions: 94 }]);
  const tr = compareTrust(truncatedCmp, pr20655);
  ok("compareTrust: a 300-file compare is untrusted (truncated), never filtered into a delta",
    tr.trusted === false && tr.files === null && /300-file cap/.test(tr.reason || ""), JSON.stringify(tr.reason));
  const polluted = compareTrust([{ filename: "agent0/store.ts" }, { filename: "CODEOWNERS.bak" }], pr20655);
  ok("compareTrust: an under-cap compare that dropped a non-PR file is untrusted (polluted) and says so",
    polluted.trusted === false && /outside the PR's own diff/.test(polluted.reason || ""), JSON.stringify(polluted.reason));
  const trusted = compareTrust(compareIntact.files, compareIntact.files);
  ok("compareTrust: an under-cap compare with no extra files is trusted and unchanged",
    trusted.trusted === true && trusted.files.length === compareIntact.files.length && trusted.files.every((f, i) => f === compareIntact.files[i]));

  // PR #213 (Less certain): a merged-in base that touches ONLY files the PR also touches drops
  // nothing, so the list looked clean. A merge commit in the range, or a commit list shorter than
  // the range, makes it untrusted — and it then routes to local git like any untrusted list.
  const onlyPrFiles = [{ filename: "agent0/store.ts", additions: 9, deletions: 1 }];
  const viaMerge = compareTrust(onlyPrFiles, pr20655, compareHistory({ merge_commits: 1, total_commits: 3, listed_commits: 3 }));
  ok("compareTrust: a range holding a merge commit is untrusted even when every file is a PR file",
    viaMerge.trusted === false && /holds 1 merge commit/.test(viaMerge.reason || ""), JSON.stringify(viaMerge.reason));
  const viaUnlisted = compareTrust(onlyPrFiles, pr20655, compareHistory({ merge_commits: 0, total_commits: 400, listed_commits: 250 }));
  ok("compareTrust: a range with more commits than the compare listed is untrusted (a merge cannot be ruled out)",
    viaUnlisted.trusted === false && /has 400 commits but the compare listed 250/.test(viaUnlisted.reason || ""), JSON.stringify(viaUnlisted.reason));
  const linear = compareTrust(onlyPrFiles, pr20655, compareHistory({ merge_commits: 0, total_commits: 2, listed_commits: 2 }));
  ok("compareTrust: a linear, fully-listed range of PR files stays trusted; absent history fields change nothing",
    linear.trusted === true && compareTrust(onlyPrFiles, pr20655, compareHistory({})).trusted === true && compareTrust(onlyPrFiles, pr20655).trusted === true);

  // authoredPrPaths / parseLocalDiff / prFilesCompleteness
  ok("authoredPrPaths keeps touched PR files in PR order, drops touched non-PR files",
    JSON.stringify(authoredPrPaths(["agent0/page.tsx", "main/x.ts", "agent0/store.ts"], pr20655, true)) === JSON.stringify(["agent0/store.ts", "agent0/page.tsx"]));
  ok("authoredPrPaths skips the PR restriction when the PR list is incomplete",
    JSON.stringify(authoredPrPaths(["b.ts", "a.ts"], [{ filename: "a.ts" }], false)) === JSON.stringify(["a.ts", "b.ts"]));
  const rows = parseLocalDiff("3\t1\tsrc/a.ts\n-\t-\tlogo.png\n5\t0\tsrc/new.ts\n", "M\tsrc/a.ts\nM\tlogo.png\nA\tsrc/new.ts\n",
    "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,3 @@\n-x\n+y\n+z\n+w\n"
    + "diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n"
    + "diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,5 @@\n+1\n+2\n+3\n+4\n+5\n");
  ok("parseLocalDiff builds API-shaped rows (counts, status, @@-first patch, binary null)",
    rows.length === 3 && rows[0].additions === 3 && rows[0].deletions === 1 && rows[0].status === "modified"
      && (rows[0].patch || "").startsWith("@@ -1,1 +1,3 @@") && rows[1].patch === null && rows[1].additions === 0
      && rows[2].status === "added" && (rows[2].patch || "").startsWith("@@ -0,0 +1,5 @@") && deltaCounts(rows).deltaLines === 9,
    JSON.stringify(rows));
  // PR #213 (Less certain): a path with a space gets a TAB after its `+++ b/` header, which the
  // header regex swallowed into the key, so the row's patch came back null.
  const spaced = parseLocalDiff("1\t0\tsrc/my file.ts\n", "A\tsrc/my file.ts\n",
    "diff --git a/src/my file.ts b/src/my file.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/my file.ts\t\n@@ -0,0 +1 @@\n+x\n");
  ok("parseLocalDiff attaches the patch to a path containing a space (header ends in a TAB)",
    spaced.length === 1 && (spaced[0].patch || "").startsWith("@@ -0,0 +1 @@"), JSON.stringify(spaced));
  ok("prFilesCompleteness flags a short list and a partial parse, passes a full one",
    prFilesCompleteness(30, 45, null).complete === false && prFilesCompleteness(45, 45, null).complete === true
      && prFilesCompleteness(45, 45, "1 unparseable line(s)").complete === false && prFilesCompleteness(10, undefined, null).complete === true);

  // churnState
  ok("churnState: no last-full SHA -> 0", churnState({ hasLastFull: false }) === 0);
  ok("churnState: intact compare -> the real summed delta", churnState({ hasLastFull: true, meta: { status: "ahead", behind_by: 0 }, deltaLinesIfIntact: 42 }) === 42);
  ok("churnState: diverged compare -> CHURN_OVER_THRESHOLD, never guessed",
    churnState({ hasLastFull: true, meta: { status: "diverged" }, deltaLinesIfIntact: 5 }) === CHURN_OVER_THRESHOLD);

  // resolveIntactDelta — the decision prepare-review.mjs runs, with the I/O injected.
  const priorTree20655 = [{ path: "agent0/store.ts", sha: "old1" }, { path: "agent0/page.tsx", sha: "old2" }, { path: "gen/attributes.gen.ts", sha: "new3" }];
  /** @type {string[]} */
  let calls = [];
  const noLocal = async () => { calls.push("local"); return /** @type {LocalDeltaResult} */ ({ ok: false, reason: "no checkout" }); };
  const tree = async () => { calls.push("tree"); return /** @type {PriorTreeResult} */ ({ ok: true, tree: priorTree20655 }); };
  const viaBlob = await resolveIntactDelta({ compareFiles: truncatedCmp, prFiles: pr20655, readLocal: noLocal, readPriorTree: tree });
  ok("truncated compare, no local git: the blob route runs and keeps every PR file whose blob changed",
    viaBlob.route === "blob-diff" && ["agent0/store.ts", "agent0/page.tsx"].every((n) => viaBlob.files.some((f) => f.filename === n))
      && !viaBlob.files.some((f) => f.filename.startsWith("main/")) && /300-file cap.*blob-SHA route/.test(viaBlob.anomaly || ""),
    JSON.stringify({ route: viaBlob.route, files: viaBlob.files.map((f) => f.filename), anomaly: viaBlob.anomaly }));
  calls = [];
  const authored = [{ filename: "agent0/store.ts", status: "modified", additions: 60, deletions: 10, patch: "@@ -1 +1 @@" }];
  const viaLocal = await resolveIntactDelta({
    compareFiles: [{ filename: "gen/attributes.gen.ts" }, { filename: "CODEOWNERS.bak" }], prFiles: pr20655,
    readLocal: async () => { calls.push("local"); return { ok: true, files: authored }; }, readPriorTree: tree,
  });
  ok("polluted (dropped) compare routes to the truncation-immune local-git delta and names it",
    viaLocal.route === "local-git" && viaLocal.files === authored && JSON.stringify(calls) === JSON.stringify(["local"])
      && /outside the PR's own diff.*local git/.test(viaLocal.anomaly || ""), JSON.stringify(viaLocal));
  calls = [];
  const viaCompare = await resolveIntactDelta({ compareFiles: compareIntact.files, prFiles: compareIntact.files, readLocal: noLocal, readPriorTree: tree });
  ok("clean intact compare: used as-is, no local or tree read, no anomaly",
    viaCompare.route === "compare" && viaCompare.anomaly === null && calls.length === 0 && viaCompare.files.length === compareIntact.files.length);

  const mergeLocal = await resolveIntactDelta({ compareFiles: onlyPrFiles, prFiles: pr20655, history: { mergeCommits: 1 },
    readLocal: async () => ({ ok: true, files: authored }), readPriorTree: tree });
  ok("an all-PR-files compare over a merge commit routes to local git and says why",
    mergeLocal.route === "local-git" && mergeLocal.files === authored && /merge commit/.test(mergeLocal.anomaly || ""), JSON.stringify(mergeLocal));

  // resolveChurnLines
  const churnTrusted = await resolveChurnLines({ perFile: [{ filename: "agent0/store.ts", lines: 30 }], prFiles: pr20655, readLocal: noLocal });
  ok("resolveChurnLines: trusted list sums PR files", churnTrusted.lines === 30 && churnTrusted.anomaly === null);
  const churnTrunc = await resolveChurnLines({ perFile: truncatedCmp.map((f) => ({ filename: f.filename, lines: 1 })), prFiles: pr20655, readLocal: noLocal });
  ok("resolveChurnLines: truncated list with no local git reads as over the threshold",
    churnTrunc.lines === CHURN_OVER_THRESHOLD && /untrusted/.test(churnTrunc.anomaly || ""));
  const churnLocal = await resolveChurnLines({ perFile: [{ filename: "CODEOWNERS.bak", lines: 900 }, { filename: "agent0/store.ts", lines: 5 }], prFiles: pr20655,
    readLocal: async () => ({ ok: true, files: authored }) });
  ok("resolveChurnLines: polluted list uses the local-git authored lines and names the route and the reason",
    churnLocal.lines === 70 && /cumulative-churn compare untrusted \(.*outside the PR's own diff.*\) — churn computed from local git/.test(churnLocal.anomaly || ""),
    String(churnLocal.anomaly));

  console.log(`${fails.length === 0 ? "✓" : "✗"} delta-triage self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  if (fails.length) process.exit(1);
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("delta-triage.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
  selfTest();
}
