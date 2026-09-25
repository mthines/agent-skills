#!/usr/bin/env node
// @ts-check
/**
 * execute-write-plan.mjs — executes a finalize.mjs write-plan.json over gh,
 * or reports which ops require MCP (R2, R7, D9).
 *
 * Op order mirrors prose (Step 2.9c runs before posting):
 *   1. thread.reply[] and thread.resolve[] run FIRST. On any resolve
 *      failure, `opts.resolveFailedHandler(failedIds)` runs — the caller's
 *      hook for `finalize.mjs --resolve-failed <ids>` — BEFORE sticky.upsert,
 *      so the posted report never claims a thread resolved that is not.
 *   2. sticky.upsert carries `comment_id` or null, the marker, `body_path`,
 *      and a precomputed `pointer_body_path` for the degraded case (an
 *      access path that cannot patch the sticky falls back to the pointer).
 *   3. review.create is emitted ONLY when inline comments are non-empty.
 *   4. lorekit.write[] is NEVER executed by this script — always returned
 *      for the caller to run over MCP (`mcp__lorekit__memory_write`).
 *
 * Capability is probed with `gh api repos/{repo} --jq .full_name` — this
 * script never shells out to locate the `gh` binary and never calls its
 * `auth`+`status` subcommand (F6: the credential proxy lies under a
 * per-call proxy, so that subcommand cannot be trusted as a capability
 * test). Failure exits 3: "no gh access path — execute over MCP per
 * rules/pipeline.md". The three GitHub writes (threads, sticky, review) fail
 * independently, exactly as in prose — one failing does not block the rest.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { run as defaultRun, scratchRoot } from "./prepare-review.mjs";

/**
 * The last pre-flight before a review.create POST — a check that survives the renderers being
 * BYPASSED, which is the one failure surface upstream construction cannot close: on the MCP path
 * (`add_issue_comment` / `add_comment_to_pending_review`), the rendered body has to be reproduced
 * into a tool-call ARGUMENT, a copy this pipeline does not perform and nothing else re-verifies —
 * `mthines/agent-skills#165` shipped all six artifacts of one run (the sticky and five inline
 * comments) with the button markup HTML-escaped and double-backtick-wrapped, every assertion
 * upstream having already passed on the pre-copy bytes. This is a straight port of the agent body's
 * former `payload_is_safe(payload)` (agents/pr-reviewer.md § 4b) — moved here so there is exactly
 * one executable copy, run on the ACTUAL bytes about to be posted rather than re-derived by the
 * model from a description of them. Every numeric literal and stripping order below is load-bearing
 * and asserted by the `payload-safety` L2-adjacent self-test cases (`G46l`'s script-level home).
 * @param {{event?: string, body?: string, comments?: Array<{side?: string, body?: string, path?: string, line?: number}>}} payload
 * @returns {{ok: boolean, reason: string}}
 */
export function payloadIsSafe(payload) {
  if (payload.event !== "COMMENT") return { ok: false, reason: "event must be 'COMMENT'" };
  if (typeof payload.body !== "string" || payload.body.length === 0) {
    return { ok: false, reason: "body must be a non-empty string (pointer line)" };
  }
  if (payload.body.includes("<!-- PR_REVIEWER_REPORT -->")) {
    return { ok: false, reason: "review body carries the report marker — the report belongs in the sticky" };
  }
  // A pointer is prose only. Nothing machine-readable rides on a review body any more — the run
  // state is a LoreKit record (Step 4c) — so there is no ledger block to exempt from this budget.
  if (payload.body.includes("<!-- PR_REVIEWER_LEDGER")) {
    return { ok: false, reason: "review body carries a ledger block — run state lives in the PR-state record" };
  }
  // The body MUST be a `render-pointer.mjs` output, not hand-composed. Every pointer form opens
  // with the pointer marker (render-pointer.mjs's own post-condition), and NO form carries a link —
  // the report and its links live in the sticky. Without these two checks an improvised "Review
  // findings posted — see the [report comment](url)" body sailed through (dash0hq/dash0#18451):
  // no report marker, no ledger, under budget, and the hand-built permalink came out as
  // `https://github.com//pull/<n>#…` with an empty owner/repo slug.
  if (!payload.body.startsWith("<!-- PR_REVIEWER_POINTER -->")) {
    return {
      ok: false,
      reason: "review body is not a render-pointer output — it must open with "
        + "<!-- PR_REVIEWER_POINTER -->; do not hand-compose the body (§ POINTER_BODY)",
    };
  }
  if (/\[[^\]]*\]\([^)]*\)/.test(payload.body)) {
    return {
      ok: false,
      reason: "review body carries a markdown link — a pointer carries no links; the report and "
        + "its links live in the sticky (use the sticky's html_url, never a hand-built permalink)",
    };
  }
  if (payload.body.trim().length > 600) {
    return { ok: false, reason: `review body is a pointer, not a report: ${payload.body.length} chars` };
  }
  for (const c of payload.comments || []) {
    if (c.side !== "RIGHT" && c.side !== "LEFT") {
      return { ok: false, reason: `comment missing side field: ${c.path}:${c.line}` };
    }
    const cBody = c.body || "";
    // Tolerate the optional severity label decoration (e.g. "issue (high):"). A bare
    // startsWith("issue:") would reject the reviewer's own tiered comments and abort the post.
    if (!/^(praise|nitpick|suggestion|issue|question)( \((critical|high|medium|low)\))?:/.test(cBody)) {
      return { ok: false, reason: `comment body missing Conventional-Comments prefix: ${cBody.slice(0, 40)}` };
    }
    // The shared attribution footer. Like the marker, only the renderer writes it, so its
    // absence means this body did not come from `render-comment.mjs`.
    if (!cBody.includes("<sup>`pr-reviewer` · commit `")) {
      return { ok: false, reason: `comment body has no attribution footer (not rendered): ${c.path}` };
    }
    // Measure the PROSE, exactly as comment-shape.md does — not the whole body. Measuring the raw
    // body would reject every finding carrying the fix fence that same rule requires for an
    // `issue:` / `suggestion:`, and because this assertion aborts the WHOLE post rather than
    // dropping one comment, one well-formed finding with a 10-line patch would take the entire
    // review down.
    let prose = cBody.replace(/```[a-zA-Z0-9_+-]*\n[\s\S]*?\n```/g, "");
    prose = prose.replace(/^Evidence:.*$/gm, "");
    prose = prose.replace(/^<sup>`pr-reviewer`.*$/gm, "");
    // The Fix-with-Agent0 button — strip it BEFORE measuring: its <picture> markup is theme-
    // switching boilerplate that on its own pushes a well-formed finding past any prose ceiling.
    // It is a rendered affordance, not argument, exactly like the fence.
    prose = prose.replace(/^<a href="https:\/\/app\.dash0(?:-dev)?\.com\/.*$/gm, "");
    prose = prose.replace(/^_Pseudo-code — verify before applying\._$/gm, "");
    // The `(unverified: …)` tag, same class as the fence and the button: a rendered decoration,
    // not argument. Stripped rather than re-bounded — render-comment.mjs's own UNVERIFIED_MAX
    // already bounds it, and a second bound here would be the same stale copy again.
    prose = prose.replace(/\s*\(unverified: [^)]*\)/g, "");
    prose = prose.replace(/<!--\s*fp:v\d+:[^\s>]+?\s*-->/g, "").trim();
    // A LOOSE ceiling, deliberately — not a re-implementation of render-comment.mjs's real per-
    // field caps (title ≤ 60, prose ≤ 200). This pre-flight cannot see the field boundaries, only
    // the rendered text, so it bounds the sum generously (60 title + ~25 decoration + 200 prose)
    // and lets the renderer own precision.
    if (prose.length > 320) {
      return { ok: false, reason: `comment prose > 320 chars: ${prose.length}` };
    }
    // An absolute ceiling on the REST of the body still applies, generously. The button is
    // stripped first, exactly as for the prose measurement and for the same reason: its length is
    // the deep link's, not the finding's.
    const body2000 = cBody.replace(/^<a href="https:\/\/app\.dash0(?:-dev)?\.com\/.*$/gm, "");
    if (body2000.length > 2000) {
      return { ok: false, reason: `comment body > 2000 chars, fix button excluded: ${body2000.length}` };
    }
    if ((cBody.match(/<!--\s*fp:v\d+:/g) || []).length > 1) {
      return { ok: false, reason: `comment carries more than one fingerprint marker: ${c.path}` };
    }
  }
  return { ok: true, reason: "" };
}

/**
 * Probes gh access with one `gh api` call — never a binary-location shell-out,
 * never gh's `auth`+`status` subcommand (F6).
 * @param {string} repo - owner/name
 * @param {Function} runner
 * @returns {Promise<boolean>}
 */
export async function probeGhAccess(repo, runner = defaultRun) {
  const r = await runner("gh", ["api", `repos/${repo}`, "--jq", ".full_name"]);
  return r.ok;
}

/**
 * Pure: decides what steps WOULD run, in order, from a write-plan. No I/O.
 * Used by --dry-run and by the self-test to assert ordering without
 * spawning anything.
 * @param {any} writePlan
 * @returns {any[]}
 */
export function planExecutionSteps(writePlan) {
  /** @type {any[]} */
  const steps = [];
  for (const reply of writePlan.thread_reply || []) {
    steps.push({ kind: "thread.reply", thread_id: reply.thread_id });
  }
  for (const resolve of writePlan.thread_resolve || []) {
    steps.push({ kind: "thread.resolve", thread_id: resolve.thread_id });
  }
  if (writePlan.sticky_upsert) {
    steps.push({ kind: "sticky.upsert", comment_id: writePlan.sticky_upsert.comment_id ?? null });
  }
  const inlineCount = writePlan.review_create?.comments?.length || 0;
  if (writePlan.review_create && inlineCount > 0) {
    steps.push({ kind: "review.create", count: inlineCount });
  }
  // lorekit.write is deliberately never a step here.
  return steps;
}

/**
 * @param {any} writePlan
 * @param {{ runner?: Function, dryRun?: boolean, repo?: string, resolveFailedHandler?: Function }} [opts]
 */
export async function executeWritePlan(writePlan, opts = {}) {
  const runner = opts.runner || defaultRun;
  const dryRun = Boolean(opts.dryRun);
  const repo = opts.repo || writePlan.repo;
  const lorekitOps = writePlan.lorekit_write || [];

  if (dryRun) {
    return { executed: [], dryRun: true, plannedSteps: planExecutionSteps(writePlan), lorekitOps, ghAccess: null };
  }

  const hasGhAccess = await probeGhAccess(repo, runner);
  if (!hasGhAccess) {
    return {
      executed: [], dryRun: false, ghAccess: false, lorekitOps,
      error: "no gh access path — execute over MCP per rules/pipeline.md", code: 3,
    };
  }

  /** @type {any[]} */
  const executed = [];
  /** @type {string[]} */
  const resolveFailed = [];

  for (const reply of writePlan.thread_reply || []) {
    const r = await runner("gh", [
      "api", "graphql",
      "-f", "query=mutation($id:ID!,$body:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$id,body:$body}){comment{id}}}",
      "-f", `id=${reply.thread_id}`, "-f", `body=${reply.body}`,
    ]);
    executed.push({ kind: "thread.reply", thread_id: reply.thread_id, ok: r.ok });
  }
  for (const resolve of writePlan.thread_resolve || []) {
    const r = await runner("gh", [
      "api", "graphql",
      "-f", "query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id}}}",
      "-f", `id=${resolve.thread_id}`,
    ]);
    executed.push({ kind: "thread.resolve", thread_id: resolve.thread_id, ok: r.ok });
    if (!r.ok) resolveFailed.push(resolve.thread_id);
  }

  if (resolveFailed.length > 0 && typeof opts.resolveFailedHandler === "function") {
    await opts.resolveFailedHandler(resolveFailed);
  }

  if (writePlan.sticky_upsert) {
    const su = writePlan.sticky_upsert;
    const args = su.comment_id
      ? ["api", `repos/${repo}/issues/comments/${su.comment_id}`, "-X", "PATCH", "-f", `body=@${su.body_path}`]
      : ["api", `repos/${repo}/issues/${writePlan.pr_number}/comments`, "-f", `body=@${su.body_path}`];
    const r = await runner("gh", args);
    if (!r.ok && su.pointer_body_path) {
      const rp = await runner("gh", ["api", `repos/${repo}/issues/${writePlan.pr_number}/comments`, "-f", `body=@${su.pointer_body_path}`]);
      executed.push({ kind: "sticky.upsert", degraded: true, ok: rp.ok });
    } else {
      executed.push({ kind: "sticky.upsert", degraded: false, ok: r.ok });
    }
  }

  const inlineCount = writePlan.review_create?.comments?.length || 0;
  if (writePlan.review_create && inlineCount > 0) {
    // `review_create.body` is not yet a write-plan.json field (finalize.mjs does not build one
    // today), so the pointer marker is a stand-in until it is — payloadIsSafe's body checks are
    // real and exercised by the self-test either way; they just cannot fail on a field this
    // caller does not supply yet. `event` is passed literally as the same hardcoded "COMMENT"
    // the POST call below sends, never a plan-supplied value.
    const safety = payloadIsSafe({
      event: "COMMENT",
      body: writePlan.review_create.body ?? "<!-- PR_REVIEWER_POINTER -->",
      comments: writePlan.review_create.comments,
    });
    if (!safety.ok) {
      executed.push({ kind: "review.create", ok: false, count: inlineCount, aborted: true, reason: safety.reason });
    } else {
      // `gh api -f`/`--raw-field` always serialize their value as a JSON STRING — there is no
      // flag that sends one as a JSON array or object, so `-f comments=<json>` 422s with
      // `For 'properties/comments', "[...]" is not an array` (5 independent reviewer-lessons
      // converged on this fix; L1 G36a locks it). Write the whole payload to a scratch file and
      // POST it with `--input`, which
      // sends the file verbatim as the request body and keeps `comments` a real array.
      const reviewPayloadPath = join(scratchRoot(), `review-payload-${Date.now()}.json`);
      writeFileSync(reviewPayloadPath, JSON.stringify({
        commit_id: writePlan.review_create.commit_id,
        body: writePlan.review_create.body ?? "<!-- PR_REVIEWER_POINTER -->",
        event: "COMMENT",
        comments: writePlan.review_create.comments,
      }));
      const r = await runner("gh", [
        "api", `repos/${repo}/pulls/${writePlan.pr_number}/reviews`, "-X", "POST",
        "--input", reviewPayloadPath,
      ]);
      executed.push({ kind: "review.create", ok: r.ok, count: inlineCount });
    }
  }

  return { executed, dryRun: false, ghAccess: true, lorekitOps };
}

// ── CLI ──

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test" || a === "--dry-run") { opts[a.slice(2)] = true; continue; }
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

  // payloadIsSafe — the Step 4b pre-flight ported from agents/pr-reviewer.md (Phase 5).
  {
    const FOOTER = "<sup>`pr-reviewer` · commit `abc1234`</sup>";
    const okComment = { path: "a.ts", line: 1, side: "RIGHT", body: `nitpick: fine. ${FOOTER}` };
    const okPayload = { event: "COMMENT", body: "<!-- PR_REVIEWER_POINTER -->", comments: [okComment] };
    check("a well-formed payload is safe", payloadIsSafe(okPayload).ok === true, payloadIsSafe(okPayload).reason);
    check("a non-COMMENT event is rejected", payloadIsSafe({ ...okPayload, event: "APPROVE" }).ok === false);
    check("an empty body is rejected", payloadIsSafe({ ...okPayload, body: "" }).ok === false);
    check("a body carrying the report marker is rejected",
      payloadIsSafe({ ...okPayload, body: "<!-- PR_REVIEWER_POINTER -->\n<!-- PR_REVIEWER_REPORT -->" }).ok === false);
    check("a body carrying a ledger block is rejected",
      payloadIsSafe({ ...okPayload, body: "<!-- PR_REVIEWER_POINTER -->\n<!-- PR_REVIEWER_LEDGER" }).ok === false);
    check("a body not opening with the pointer marker is rejected",
      payloadIsSafe({ ...okPayload, body: "Review findings posted — see the report." }).ok === false);
    check("a body carrying a markdown link is rejected",
      payloadIsSafe({ ...okPayload, body: "<!-- PR_REVIEWER_POINTER -->\nsee the [report](https://x)" }).ok === false);
    check("a body over 600 chars is rejected",
      payloadIsSafe({ ...okPayload, body: `<!-- PR_REVIEWER_POINTER -->\n${"x".repeat(601)}` }).ok === false);
    check("a comment with no side is rejected",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment, side: undefined }] }).ok === false);
    check("a comment missing the Conventional-Comments prefix is rejected",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment, body: `no prefix. ${FOOTER}` }] }).ok === false);
    check("a comment with no attribution footer is rejected",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment, body: "nitpick: no footer." }] }).ok === false);
    check("a comment over the 320-char prose ceiling is rejected",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment, body: `nitpick: ${"p".repeat(321)} ${FOOTER}` }] }).ok === false);
    check("a comment over the 2000-char body ceiling (button excluded) is rejected",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment, body: `nitpick: x ${FOOTER}${"y".repeat(2000)}` }] }).ok === false);
    check("a comment carrying more than one fingerprint marker is rejected",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment,
        body: `nitpick: x ${FOOTER}<!-- fp:v1:a@b.ts --><!-- fp:v1:c@d.ts -->` }] }).ok === false);
    check("the `(unverified: …)` tag is stripped before the prose measurement, not counted against it",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment,
        body: `suggestion: x (unverified: ${"u".repeat(300)}) ${FOOTER}` }] }).ok === true,
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment,
        body: `suggestion: x (unverified: ${"u".repeat(300)}) ${FOOTER}` }] }).reason);
    check("the fix-with-agent0 button is stripped before the body measurement, not counted against it",
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment,
        body: `nitpick: x ${FOOTER}\n<a href="https://app.dash0.com/${"z".repeat(1900)}">fix</a>` }] }).ok === true,
      payloadIsSafe({ ...okPayload, comments: [{ ...okComment,
        body: `nitpick: x ${FOOTER}\n<a href="https://app.dash0.com/${"z".repeat(1900)}">fix</a>` }] }).reason);
  }

  const mkSpy = () => {
    /** @type {any[]} */
    const calls = [];
    const spy = async (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
      calls.push({ cmd, args });
      if (cmd === "gh" && args[0] === "api" && args[1]?.startsWith("repos/") && args.includes("--jq")) {
        return { ok: true, code: 0, stdout: '"owner/repo"', stderr: "" };
      }
      return { ok: true, code: 0, stdout: "{}", stderr: "" };
    };
    return { spy, calls };
  };

  // AC-3 case: --dry-run spawns zero gh processes.
  {
    const { spy, calls } = mkSpy();
    const writePlan = {
      repo: "owner/repo", pr_number: 1,
      thread_reply: [{ thread_id: "t1", body: "fixed" }],
      sticky_upsert: { comment_id: null, body_path: "/tmp/body.md" },
      review_create: { commit_id: "abc", comments: [{ path: "a.ts", line: 1, body: "x" }] },
      lorekit_write: [{ op: "state" }],
    };
    const result = await executeWritePlan(writePlan, { runner: spy, dryRun: true });
    check("--dry-run spawns zero gh processes", calls.length === 0, `${calls.length} calls made`);
    check("--dry-run still reports the planned steps (threads, sticky, review, in order)",
      (result.plannedSteps || []).map((/** @type {any} */ s) => s.kind).join(",") === "thread.reply,sticky.upsert,review.create");
  }

  // AC-3 case: a plan with empty inline comments emits no review.create.
  {
    const { spy, calls } = mkSpy();
    const writePlan = {
      repo: "owner/repo", pr_number: 1,
      sticky_upsert: { comment_id: null, body_path: "/tmp/body.md" },
      review_create: { commit_id: "abc", comments: [] },
      lorekit_write: [],
    };
    const result = await executeWritePlan(writePlan, { runner: spy });
    check("empty inline comments -> no review.create in executed[]", !result.executed.some((/** @type {any} */ e) => e.kind === "review.create"));
    check("empty inline comments -> no review POST call was made", !calls.some((c) => c.args.some((/** @type {string} */ a) => a.includes("/reviews"))));
  }

  // review.create posts via --input (a real JSON array on disk), never `-f comments=<json>` —
  // `gh api -f`/`--raw-field` always serialize as a JSON STRING, which 422s the reviews endpoint
  // (the bug this case guards against; L1 G36a locks it statically too).
  {
    const { spy, calls } = mkSpy();
    const writePlan = {
      repo: "owner/repo", pr_number: 1,
      review_create: {
        commit_id: "abc1234",
        comments: [{
          path: "a.ts", line: 1, side: "RIGHT",
          body: "nitpick: minor. <sup>`pr-reviewer` · commit `abc1234`</sup>",
        }],
      },
    };
    await executeWritePlan(writePlan, { runner: spy });
    const reviewCall = calls.find((c) => c.args.some((/** @type {string} */ a) => a.includes("/reviews")));
    check("review.create call is made", Boolean(reviewCall));
    check("review.create never uses -f comments=<json-string>",
      !(reviewCall?.args || []).some((/** @type {string} */ a) => a.startsWith("comments=")));
    check("review.create uses --input with a file", (reviewCall?.args || []).includes("--input"));
    const inputPath = reviewCall?.args[reviewCall.args.indexOf("--input") + 1];
    const posted = JSON.parse(readFileSync(inputPath, "utf8"));
    check("the posted payload's comments field is a real array, not a string",
      Array.isArray(posted.comments) && posted.comments.length === 1);
    check("the posted payload carries event=COMMENT and the commit_id verbatim",
      posted.event === "COMMENT" && posted.commit_id === "abc1234");
  }

  // AC-3 case: ops run threads -> sticky -> review, with a resolve failure
  // triggering the handler BEFORE the sticky call.
  {
    /** @type {string[]} */
    const order = [];
    const spy = async (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
      if (args[0] === "api" && args[1]?.startsWith("repos/") && args.includes("--jq")) return { ok: true, code: 0, stdout: '"o/r"', stderr: "" };
      if (args.some((/** @type {string} */ a) => a.includes("resolveReviewThread"))) { order.push("resolve"); return { ok: false, code: 1, stdout: "", stderr: "boom" }; }
      if (args.some((/** @type {string} */ a) => a.includes("issues/") && !a.includes("comments/"))) { order.push("sticky"); return { ok: true, code: 0, stdout: "{}", stderr: "" }; }
      if (args.some((/** @type {string} */ a) => a.includes("/reviews"))) { order.push("review"); return { ok: true, code: 0, stdout: "{}", stderr: "" }; }
      return { ok: true, code: 0, stdout: "{}", stderr: "" };
    };
    const writePlan = {
      repo: "o/r", pr_number: 1,
      thread_resolve: [{ thread_id: "t1" }],
      sticky_upsert: { comment_id: null, body_path: "/tmp/body.md" },
      // A payloadIsSafe-legal comment — this case tests op ORDERING, not payload safety, and a
      // synthetic "x" body would now (correctly) abort review.create before it ever posts.
      review_create: {
        commit_id: "abc",
        comments: [{
          path: "a.ts", line: 1, side: "RIGHT",
          body: "nitpick: minor. <sup>`pr-reviewer` · commit `abc1234`</sup>",
        }],
      },
    };
    let handlerCalledBeforeSticky = false;
    await executeWritePlan(writePlan, {
      runner: spy,
      resolveFailedHandler: async (/** @type {string[]} */ ids) => {
        order.push("resolve-failed-handler");
        handlerCalledBeforeSticky = !order.includes("sticky");
      },
    });
    check("order is resolve -> resolve-failed-handler -> sticky -> review",
      order.join(",") === "resolve,resolve-failed-handler,sticky,review", order.join(","));
    check("the resolve-failed handler runs strictly before the sticky call", handlerCalledBeforeSticky);
  }

  // AC-3 case: LoreKit ops are returned, never executed.
  {
    const { spy, calls } = mkSpy();
    const lorekitOps = [{ op: "state", scope: "branch::x" }, { op: "knowledge", scope: "repo::x" }];
    const writePlan = { repo: "owner/repo", pr_number: 1, lorekit_write: lorekitOps };
    const result = await executeWritePlan(writePlan, { runner: spy });
    check("lorekit ops are returned verbatim in the result", JSON.stringify(result.lorekitOps) === JSON.stringify(lorekitOps));
    check("no runner call ever mentions lorekit", !calls.some((c) => c.args.some((/** @type {string} */ a) => /lorekit/i.test(a))));
  }

  // Capability probe: the runtime behavior — a failed probe response must
  // route to the exit-3 MCP-handoff path, never to a binary-location
  // shell-out or gh's auth+status subcommand as a fallback. AC-14's static
  // source scan (no literal instance of either forbidden invocation
  // anywhere in this file) runs from L1 (scripts/eval/l1.mjs) and from
  // checks.yaml's own AC-14 grep, both of which read this file from the
  // OUTSIDE — a same-file scan is self-referential, since the scan's own
  // check labels would have to name the forbidden phrases in prose to
  // describe what they assert, and then trip on themselves.
  {
    const spy = async () => ({ ok: false, code: 1, stdout: "", stderr: "" });
    const result = await executeWritePlan({ repo: "o/r", pr_number: 1 }, { runner: spy });
    check("a failed capability probe routes to exit-3 MCP handoff, not a which/auth-status fallback",
      result.code === 3 && result.ghAccess === false);
  }

  // No gh access -> exit-3-shaped result, lorekit ops still returned.
  {
    const spy = async () => ({ ok: false, code: 1, stdout: "", stderr: "401" });
    const writePlan = { repo: "owner/repo", pr_number: 1, lorekit_write: [{ op: "state" }] };
    const result = await executeWritePlan(writePlan, { runner: spy });
    check("no gh access -> code 3 and the documented error message", result.code === 3 && result.error === "no gh access path — execute over MCP per rules/pipeline.md");
    check("no gh access -> lorekit ops are still returned", JSON.stringify(result.lorekitOps) === JSON.stringify([{ op: "state" }]));
  }

  if (failed > 0) {
    console.error(`\nexecute-write-plan self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ execute-write-plan self-test: all checks passed");
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts["self-test"]) { await selfTest(); return; }

  if (!opts.plan || !opts.repo) {
    console.error("usage: execute-write-plan.mjs --plan <write-plan.json> --repo <owner/name> [--dry-run] [--self-test]");
    process.exit(2);
  }
  const writePlan = JSON.parse(readFileSync(/** @type {string} */(opts.plan), "utf8"));
  const result = await executeWritePlan(writePlan, { repo: /** @type {string} */(opts.repo), dryRun: Boolean(opts["dry-run"]) });
  if (result.code === 3) {
    console.error(result.error);
    process.exit(3);
  }
  console.log(JSON.stringify(result, null, 2));
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
