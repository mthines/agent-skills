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

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { run as defaultRun } from "./prepare-review.mjs";

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
    const r = await runner("gh", [
      "api", `repos/${repo}/pulls/${writePlan.pr_number}/reviews`, "-X", "POST",
      "-f", `commit_id=${writePlan.review_create.commit_id}`, "-f", "event=COMMENT",
      "-f", `comments=${JSON.stringify(writePlan.review_create.comments)}`,
    ]);
    executed.push({ kind: "review.create", ok: r.ok, count: inlineCount });
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
      review_create: { commit_id: "abc", comments: [{ path: "a.ts", line: 1, body: "x" }] },
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
