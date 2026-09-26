// @ts-check
/**
 * finalize/write-plan.mjs — builds the write-plan.json artifact rules/pipeline.md's "Artifact
 * flow" documents (`… + write-plan.json (finalize.mjs) → write-result.json (execute-write-plan.mjs
 * or the agent over MCP)`) but that finalize.mjs never actually emitted (ab/B/20230/1/meta.json,
 * defect 8 — a hand run had to hand-assemble this file to invoke execute-write-plan.mjs at all).
 * Pure. No I/O, clock, or env (D18) — every path/body this function places into the plan is a
 * value the CLI layer already computed or rendered; this module only shapes them into the exact
 * op vocabulary execute-write-plan.mjs's `planExecutionSteps`/`executeWritePlan` consume
 * (rules/pipeline.md § Write-plan op → MCP tool map).
 *
 * Thread ops (D9's Step 2.9c ordering: threads run before the sticky and the review) are derived
 * from judgments.threads[]'s classification alone — the same RESOLVE_CLASSES
 * (fixed/declined/acknowledged/obsolete) finalize/gates.mjs's gate3() already uses, so a thread
 * this run's write-plan resolves is exactly the thread gate3() already treated as no-longer-open.
 * persisting/unaddressed threads get neither op (judgments.schema.json's own thread definition:
 * "persisting/unaddressed leave the thread open with no reply").
 *
 * Every review comment posts to the RIGHT side only (execute-write-plan.mjs's own payloadIsSafe
 * and every one of its self-test fixtures hardcode "RIGHT") — this pipeline reviews the diff's new
 * state, never the base/LEFT side, and judgments.schema.json's candidate shape carries no `side`
 * field for the model to (mis)supply one.
 */

const RESOLVE_CLASSES = new Set(["fixed", "declined", "acknowledged", "obsolete"]);

/**
 * @param {any[]} threads - judgments.json's threads[] (finding-verifier.md / thread-resolution.md
 *   classifications), the SAME array finalizeReview() passes to computeGates()'s gate3().
 * @returns {{ thread_reply: Array<{thread_id: string, body: string}>, thread_resolve: Array<{thread_id: string}> }}
 */
export function buildThreadOps(threads) {
  /** @type {Array<{thread_id: string, body: string}>} */
  const thread_reply = [];
  /** @type {Array<{thread_id: string}>} */
  const thread_resolve = [];
  for (const t of threads || []) {
    if (!t || !RESOLVE_CLASSES.has(t.classification)) continue;
    if (typeof t.reply === "string" && t.reply.length > 0) {
      thread_reply.push({ thread_id: t.thread_id, body: t.reply });
    }
    thread_resolve.push({ thread_id: t.thread_id });
  }
  return { thread_reply, thread_resolve };
}

/**
 * @param {{
 *   repo: string,
 *   prNumber: number,
 *   commitSha: string,
 *   threads?: any[],
 *   stickyCommentId?: string|number|null,
 *   reportBodyPath: string,
 *   pointerBodyPath: string,
 *   inlineComments?: Array<{path: string, line?: number|null, body: string}>,
 *   lorekitWrite?: any[],
 *   dryRun?: boolean,
 *   historical?: {review_sha: string}|null,
 * }} args
 * @returns {any}
 */
export function buildWritePlan({
  repo, prNumber, commitSha, threads, stickyCommentId,
  reportBodyPath, pointerBodyPath, inlineComments, lorekitWrite,
  dryRun = false, historical = null,
}) {
  const { thread_reply, thread_resolve } = buildThreadOps(threads || []);
  return {
    repo,
    pr_number: prNumber,
    // D8/D9 (plan feat/pr-reviewer-shrink-fanout-ab): a historical (`--review-sha`) run's
    // write-plan carries both markers explicitly, even though `main()` above already refuses
    // to reach this function at all for a historical context without `--dry-run` — a plan
    // that reached execute-write-plan.mjs some other way (a hand-assembled one, a future
    // caller) still self-identifies as historical/dry-run so that script's OWN refusal
    // (AC-18) does not have to trust a caller that got here correctly.
    dry_run: Boolean(dryRun),
    historical: historical || null,
    thread_reply,
    thread_resolve,
    sticky_upsert: {
      comment_id: stickyCommentId ?? null,
      body_path: reportBodyPath,
      pointer_body_path: pointerBodyPath,
    },
    review_create: {
      commit_id: commitSha,
      // The ordinary review body is marker-only (render-pointer.mjs's "pointer" FORM) — GitHub
      // accepts an empty/marker-only COMMENT review body when inline comments are attached, and
      // the report's own content lives in the sticky, never duplicated onto the review.
      comments: (inlineComments || []).map((c) => ({
        path: c.path, line: c.line ?? null, side: "RIGHT", body: c.body,
      })),
    },
    // D9: never executed by this pipeline — always returned for the caller (execute-write-plan.mjs
    // never runs these either) to issue over mcp__lorekit__memory_write. This pipeline does not yet
    // build PR-state / knowledge / relevance-rule records (Step 4c and memory.md's writes are a
    // separate, not-yet-implemented deliverable — see plan.md's Progress Log), so this is `[]`
    // unless a caller supplies its own queued ops.
    lorekit_write: lorekitWrite || [],
  };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // buildThreadOps
  {
    const threads = [
      { thread_id: "t1", classification: "fixed", reply: "fixed in a1b2c3d" },
      { thread_id: "t2", classification: "declined", reply: "not a real issue — see the linked doc" },
      { thread_id: "t3", classification: "persisting" },
      { thread_id: "t4", classification: "unaddressed" },
      { thread_id: "t5", classification: "obsolete" }, // no reply supplied
    ];
    const { thread_reply, thread_resolve } = buildThreadOps(threads);
    check("only Resolve-with-reply classes (fixed/declined/acknowledged/obsolete) produce a resolve op",
      thread_resolve.map((r) => r.thread_id).join(",") === "t1,t2,t5");
    check("persisting/unaddressed threads get neither a reply nor a resolve op (schema: 'leave the thread open with no reply')",
      !thread_resolve.some((r) => r.thread_id === "t3" || r.thread_id === "t4"));
    check("a reply op carries the judgment's own reply text verbatim, one per resolve-class thread that supplied one",
      thread_reply.length === 2
      && thread_reply[0].thread_id === "t1" && thread_reply[0].body === "fixed in a1b2c3d"
      && thread_reply[1].thread_id === "t2" && thread_reply[1].body === "not a real issue — see the linked doc");
    check("a resolve-class thread with no reply text still resolves, just with no reply op (t5)",
      thread_resolve.some((r) => r.thread_id === "t5") && !thread_reply.some((r) => r.thread_id === "t5"));
  }
  {
    const { thread_reply, thread_resolve } = buildThreadOps([]);
    check("no threads -> both arrays empty, never undefined", Array.isArray(thread_reply) && Array.isArray(thread_resolve)
      && thread_reply.length === 0 && thread_resolve.length === 0);
  }

  // buildWritePlan — end-to-end shape, matching execute-write-plan.mjs's own consumed fields
  // exactly (planExecutionSteps / executeWritePlan / payloadIsSafe).
  {
    const plan = buildWritePlan({
      repo: "o/r", prNumber: 42, commitSha: "906a74781990f75607f0234de963fdbbc3953f2c",
      threads: [{ thread_id: "t1", classification: "fixed", reply: "fixed" }],
      stickyCommentId: 999,
      reportBodyPath: "/tmp/out/report-body.md",
      pointerBodyPath: "/tmp/out/pointer-body.md",
      inlineComments: [{ path: "a.ts", line: 12, body: "issue: x" }],
    });
    check("repo/pr_number pass through verbatim", plan.repo === "o/r" && plan.pr_number === 42);
    check("thread ops are present and ordered the way buildThreadOps returns them",
      plan.thread_reply.length === 1 && plan.thread_resolve.length === 1);
    check("sticky_upsert carries a real comment_id (update, not create) and both rendered paths",
      plan.sticky_upsert.comment_id === 999
      && plan.sticky_upsert.body_path === "/tmp/out/report-body.md"
      && plan.sticky_upsert.pointer_body_path === "/tmp/out/pointer-body.md");
    check("review_create.commit_id is the FULL sha, never truncated to 7 chars (that's RUN.sha's job, not the write-plan's)",
      plan.review_create.commit_id === "906a74781990f75607f0234de963fdbbc3953f2c");
    check("every review comment is forced to side: RIGHT — this pipeline never comments on LEFT",
      plan.review_create.comments.length === 1 && plan.review_create.comments[0].side === "RIGHT");
    check("review comment fields match execute-write-plan.mjs's payloadIsSafe shape exactly (path/line/side/body)",
      JSON.stringify(Object.keys(plan.review_create.comments[0]).sort()) === JSON.stringify(["body", "line", "path", "side"]));
    check("lorekit_write defaults to an empty array — this pipeline queues no ops yet, and D9 forbids executing them here regardless",
      Array.isArray(plan.lorekit_write) && plan.lorekit_write.length === 0);
    check("dry_run and historical both default to false/null on an ordinary (live, non-historical) plan",
      plan.dry_run === false && plan.historical === null);
  }
  {
    // A historical (--review-sha) plan under --dry-run (D8/D9, AC-17): dry_run true, historical
    // names review_sha, lorekit_write stays empty (no caller-supplied ops in this case either).
    const plan = buildWritePlan({
      repo: "o/r", prNumber: 1, commitSha: "abc1234",
      reportBodyPath: "/tmp/report-body.md", pointerBodyPath: "/tmp/pointer-body.md",
      dryRun: true, historical: { review_sha: "906a74781990f75607f0234de963fdbbc3953f2" },
    });
    check("a historical, dry-run plan carries dry_run: true", plan.dry_run === true);
    check("a historical, dry-run plan carries historical.review_sha verbatim",
      plan.historical && plan.historical.review_sha === "906a74781990f75607f0234de963fdbbc3953f2");
    check("a historical, dry-run plan's lorekit_write is still empty (no ops queued, no ops executed)",
      Array.isArray(plan.lorekit_write) && plan.lorekit_write.length === 0);
  }
  {
    // A first-run sticky (no prior comment) — comment_id must be null (create), never omitted or
    // a hand-typed placeholder, so execute-write-plan.mjs's `su.comment_id ? PATCH : POST` branch
    // takes the create path.
    const plan = buildWritePlan({
      repo: "o/r", prNumber: 1, commitSha: "abc1234",
      reportBodyPath: "/tmp/report-body.md", pointerBodyPath: "/tmp/pointer-body.md",
    });
    check("no priorRun sticky -> comment_id is null, not undefined or 0", plan.sticky_upsert.comment_id === null);
    check("no threads/inlineComments supplied -> both op arrays and comments default to empty, not throw",
      plan.thread_reply.length === 0 && plan.thread_resolve.length === 0 && plan.review_create.comments.length === 0);
  }
  {
    // A caller that DOES have queued LoreKit ops (a future Step 4c integration) can still pass
    // them through — this module shapes them, it never invents or drops them.
    const ops = [{ op: "state", scope: "branch::o/r::abc1234" }];
    const plan = buildWritePlan({
      repo: "o/r", prNumber: 1, commitSha: "abc1234",
      reportBodyPath: "/tmp/report-body.md", pointerBodyPath: "/tmp/pointer-body.md",
      lorekitWrite: ops,
    });
    check("a caller-supplied lorekit_write array passes through verbatim, never mutated",
      JSON.stringify(plan.lorekit_write) === JSON.stringify(ops));
  }

  if (failed > 0) {
    console.error(`\nwrite-plan self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ write-plan self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
