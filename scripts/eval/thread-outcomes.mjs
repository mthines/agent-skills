#!/usr/bin/env node
// @ts-check
/**
 * thread-outcomes.mjs — read-only PR review-thread outcome extractor for the
 * A/B benchmark harness (`ab-review.mjs score`, AC-20/AC-21).
 *
 * GET/graphql-query only. No mutation verbs anywhere in this file (AC-23) —
 * `ghApi`/`ghApiAll`/`fetchReviewThreads` all wrap `gh api` with no `-X`, and
 * the one GraphQL query `fetchReviewThreads` issues is a `query`, never a
 * `mutation`.
 *
 * For every review thread on a PR, classifies the outcome by reusing the
 * SAME decision tables `record-comment-relevance.mjs` already ships and is
 * L1-tested (G24f) — never a re-derivation:
 *   - a RESOLVED thread routes through `decideResolvedThread` (declined via a
 *     wont-fix reply/reaction, or fixed if a later commit touched its region,
 *     or fixed on a live anchor with no decline detected);
 *   - a thread still OPEN at the PR's current state routes through
 *     `decideMergeSweep` (declined, or `ignored-at-merge` if untouched and
 *     undeclined, or a documented skip when the evidence cannot decide).
 *
 * Output is one label per root-comment thread: `{fingerprint, path, line,
 * author, is_bot, outcome, reason}`, where `outcome` is `"fixed"` (TP
 * material — the plan's "fixed-in-later-commit = TP"), `"declined"` (FP
 * material — "declined-with-rationale = FP"), or `null` (the decision table
 * returned a `skip` — the plan's "the rest labelled by a manual/judge
 * file": `ab-review.mjs score` routes these to a manual-review bucket
 * instead of guessing a label from evidence that cannot support one).
 * `fingerprint` is `extractFingerprint(body)`'s result when the comment
 * carries a recoverable `fp:v{1,2}:...` marker, else `null` — a comment with
 * no marker (a human's, or a bot with no fingerprinting convention) is still
 * labeled and still useful to `ab-review.mjs score`'s path/line-proximity
 * fallback match, per l2-detection.mjs's own `LINE_TOLERANCE` precedent.
 *
 * Usage:
 *   node thread-outcomes.mjs --repo <owner/repo> --pr <number> --out <path.json>
 *   node thread-outcomes.mjs --self-test
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ghApi, ghApiAll, fetchReviewThreads, hasFixCommit,
  decideResolvedThread, decideMergeSweep,
} from "../record-comment-relevance.mjs";
import { extractFingerprint } from "../../agents/pr-reviewer/scripts/fingerprint.mjs";

/**
 * Pure — the per-thread classification, given already-fetched inputs. Split out from
 * `extractOutcomes()`'s I/O loop so the self-test can exercise the labeling logic
 * without a network call.
 * @param {{ root: any, threadReplies: any[], thread: any, touch: {touched:boolean,granularity:string}|null, thumbsDownBy: string|null }} args
 */
export function classifyThread({ root, threadReplies, thread, touch, thumbsDownBy }) {
  const commentPath = root.path ?? "";
  const commentLine = root.line ?? root.original_line ?? 0;
  const fpInfo = extractFingerprint(root.body ?? "");
  // extractFingerprint() ALWAYS returns something — a plain-prose body with no marker
  // still gets a v1 "derived" slug (fingerprint.mjs's own legacy-comment fallback). A
  // derived slug is not a stable ground-truth key (finalize.mjs's real candidates carry
  // structural v2 finder:defectClass:symbol@path fingerprints, which a body-prefix slug
  // will essentially never match), so only a genuine recovered `<!-- fp:v... -->` marker
  // counts here; everything else reports `fingerprint: null` and falls back to
  // ab-review.mjs score's path/line-proximity match (the same LINE_TOLERANCE precedent
  // l2-detection.mjs already uses), never a slug that would silently never match.
  const base = {
    fingerprint: fpInfo?.source === "marker" ? fpInfo.fp : null,
    path: commentPath || null,
    line: commentLine || null,
    author: root.user?.login ?? null,
    is_bot: root.user?.type === "Bot",
  };

  if (thread?.isResolved) {
    const verdict = decideResolvedThread({
      thumbsDownBy, replies: threadReplies, thread, commentPath, commentLine,
      regionTouched: !!touch?.touched,
    });
    return {
      ...base,
      outcome: verdict.skip ? null : (verdict.relevance === "relevant" ? "fixed" : "declined"),
      reason: verdict.reason,
    };
  }

  const verdict = decideMergeSweep({
    thread, replies: threadReplies, thumbsDownBy, commentPath, commentLine, touch,
  });
  return {
    ...base,
    outcome: verdict.skip ? null : (verdict.relevance === "relevant" ? "fixed" : "declined"),
    reason: verdict.reason,
  };
}

/**
 * @param {{ repo: string, prNumber: string|number }} args
 * @returns {{ complete: boolean, labels: any[] }}
 */
export function extractOutcomes({ repo, prNumber }) {
  const { complete, byRootComment } = fetchReviewThreads({ repo, prNumber });
  if (!complete) {
    return { complete: false, labels: [] };
  }

  const allComments = ghApiAll(`/repos/${repo}/pulls/${prNumber}/comments`);
  const roots = allComments.filter((c) => !c.in_reply_to_id);
  const replies = allComments.filter((c) => !!c.in_reply_to_id);

  /** @type {any[]} */
  const labels = [];
  for (const root of roots) {
    const threadReplies = replies.filter((r) => String(r.in_reply_to_id) === String(root.id));
    const thread = byRootComment.get(String(root.id)) ?? null;
    const commentPath = root.path ?? "";
    const commentLine = root.line ?? root.original_line ?? 0;

    if (thread?.isOutdated) {
      // Both decision tables treat an outdated anchor as undecidable (defect 3 /
      // the `anchor-gone` skip) — skip the touch-detection API call entirely.
      labels.push(classifyThread({ root, threadReplies, thread, touch: null, thumbsDownBy: null }));
      continue;
    }

    const touch = commentPath
      ? hasFixCommit({ repo, prNumber, path: commentPath, line: commentLine, since: root.created_at })
      : { touched: false, granularity: "file" };

    labels.push(classifyThread({ root, threadReplies, thread, touch, thumbsDownBy: null }));
  }

  return { complete: true, labels };
}

// ── CLI ──

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") { opts["self-test"] = true; continue; }
    if (a.startsWith("--")) { opts[a.slice(2)] = argv[i + 1]; i++; continue; }
  }
  return opts;
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // classifyThread reuses decideResolvedThread/decideMergeSweep verbatim — these cases
  // mirror record-comment-relevance.mjs's own self-test fixtures, proving the wrapper
  // does not silently reinterpret their verdicts.
  {
    const root = { id: 1, path: "a.ts", line: 10, body: "issue: x", user: { login: "pr-reviewer", type: "Bot" }, created_at: "2026-01-01T00:00:00Z" };
    const thread = { isResolved: true, isOutdated: false };
    const r = classifyThread({ root, threadReplies: [], thread, touch: { touched: true, granularity: "line" }, thumbsDownBy: null });
    check("a resolved thread with a region touch classifies fixed", r.outcome === "fixed");
  }
  {
    const root = { id: 2, path: "a.ts", line: 10, body: "issue: x", user: { login: "pr-reviewer", type: "Bot" }, created_at: "2026-01-01T00:00:00Z" };
    const thread = { isResolved: true, isOutdated: false };
    const r = classifyThread({ root, threadReplies: [{ body: "out of scope" }], thread, touch: null, thumbsDownBy: null });
    check("a resolved thread with a won't-fix reply classifies declined", r.outcome === "declined");
  }
  {
    const root = { id: 3, path: "a.ts", line: 10, body: "issue: x", user: { login: "pr-reviewer", type: "Bot" }, created_at: "2026-01-01T00:00:00Z" };
    const thread = { isResolved: true, isOutdated: true };
    const r = classifyThread({ root, threadReplies: [], thread, touch: null, thumbsDownBy: null });
    check("an outdated resolved thread is left unlabeled (null outcome), not guessed", r.outcome === null);
  }
  {
    const root = { id: 4, path: "a.ts", line: 0, body: "nitpick: x", user: { login: "cursor", type: "Bot" }, created_at: "2026-01-01T00:00:00Z" };
    const thread = { isResolved: false, isOutdated: false };
    const r = classifyThread({ root, threadReplies: [], thread, touch: { touched: false, granularity: "file" }, thumbsDownBy: null });
    check("an open, untouched, undeclined thread classifies declined (ignored-at-merge maps to the FP bucket)", r.outcome === "declined");
  }
  {
    const root = { id: 5, path: "a.ts", line: 10, body: "issue: x", user: { login: "cursor", type: "Bot" }, created_at: "2026-01-01T00:00:00Z" };
    const thread = { isResolved: false, isOutdated: false };
    const r = classifyThread({ root, threadReplies: [], thread, touch: { touched: true, granularity: "line" }, thumbsDownBy: null });
    check("an open thread whose region was touched (fixed without resolving the thread) is left unlabeled — evidence points both ways", r.outcome === null);
  }
  {
    const root = { id: 6, path: "a.ts", line: 5, body: "<!-- fp:v2:correctness:logic:foo@a.ts -->issue: x", user: { login: "pr-reviewer", type: "Bot" }, created_at: "2026-01-01T00:00:00Z" };
    const thread = { isResolved: true, isOutdated: false };
    const r = classifyThread({ root, threadReplies: [], thread, touch: { touched: true, granularity: "line" }, thumbsDownBy: null });
    check("a marker-carrying comment's fingerprint is extracted verbatim", r.fingerprint === "correctness:logic:foo@a.ts");
  }
  {
    const root = { id: 7, path: null, line: null, body: "just prose, no marker", user: { login: "alice", type: "User" } };
    const thread = { isResolved: true, isOutdated: false };
    const r = classifyThread({ root, threadReplies: [], thread, touch: null, thumbsDownBy: null });
    check("a human comment with no marker still yields a record with fingerprint: null, not a crash", r.fingerprint === null && r.is_bot === false);
  }

  // Read-only surface: no mutation verb anywhere in this file's own source.
  {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const mutationRe = /-X\s+(?:POST|PATCH|PUT|DELETE)|--method[\s=]+(?:POST|PATCH|PUT|DELETE)|\bmutation\s*[({]/i;
    check("this file's own source contains no GitHub mutation verb", !mutationRe.test(src));
  }

  if (failed > 0) {
    console.error(`\nthread-outcomes self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ thread-outcomes self-test: all checks passed");
}

function usage() {
  console.error("usage: thread-outcomes.mjs --repo <owner/repo> --pr <number> --out <path.json> | --self-test");
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts["self-test"]) { await selfTest(); return; }

  if (!opts.repo || !opts.pr || !opts.out) {
    usage();
    process.exit(2);
  }

  const { complete, labels } = extractOutcomes({ repo: /** @type {string} */(opts.repo), prNumber: /** @type {string} */(opts.pr) });
  if (!complete) {
    console.error("thread-outcomes: thread-state walk incomplete — refusing to write a partial labels file (mirrors record-comment-relevance.mjs's own sweep guard).");
    process.exit(1);
  }

  writeFileSync(/** @type {string} */(opts.out), JSON.stringify({ repo: opts.repo, pr: opts.pr, labels }, null, 2));
  const fixed = labels.filter((l) => l.outcome === "fixed").length;
  const declined = labels.filter((l) => l.outcome === "declined").length;
  const unlabeled = labels.filter((l) => l.outcome === null).length;
  console.log(`thread-outcomes: ${labels.length} thread(s) — ${fixed} fixed, ${declined} declined, ${unlabeled} unlabeled → ${opts.out}`);
}

import { readFileSync } from "node:fs";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
