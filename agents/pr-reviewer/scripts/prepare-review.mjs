#!/usr/bin/env node
/**
 * prepare-review.mjs — execute the deterministic half of the pr-reviewer
 * pipeline in ONE process and hand the model a single JSON context.
 *
 * Why this exists
 * ---------------
 * Steps 0, 0.5, 1.1, 1.1b, 1.2, 1.2b's inputs, Phase B and the shape
 * classification contain no judgment. They are argument parsing, five GitHub
 * reads, a git ladder, a jq partition and two existing scripts. Run from the
 * agent body they cost ~20 sequential model round-trips before a single finding
 * is produced, and each one is a place a run can stall, truncate, or re-read a
 * head that has since moved.
 *
 * Run here they cost one call and ~30 s of I/O, and the torn-state window
 * Step 1.2 warns about closes by construction: `headSha`, `baseSha`, the diff,
 * the patch list and the impact graph are all bound from ONE metadata read in
 * ONE process.
 *
 * What it deliberately does NOT do
 * --------------------------------
 *   - No LoreKit. The memory reads (Steps 0.7, 1.0, 1.2c, 1.2d) need the
 *     caller's own MCP grant and are judgment-adjacent — which lessons matter is
 *     not mechanical. This script emits only the GitHub FALLBACK rung's
 *     `priorSha`, and says so, so a caller cannot mistake it for the record.
 *   - No finding, no score, no verdict, no write. Nothing here reaches GitHub
 *     except five GETs.
 *   - No `gh api /user`. That endpoint 401s under a repo-scoped credential, which
 *     is an ordinary hosted setup rather than an exotic one, so identity comes
 *     from `--reviewer-login` / `PR_REVIEWER_LOGIN` and an unset value is
 *     recorded as `unknown` — never as an empty login.
 *
 * Usage
 *   node prepare-review.mjs --pr <url|owner/repo#n|n> [--repo owner/repo]
 *        [--out <file>] [--workdir <dir>] [--repo-dir <dir>] [--reviewer-login <login>]
 *        [--no-workspace] [--no-impact] [--no-telemetry] [--inline-payloads]
 *        [--timeout-ms N] [--quiet] [--pin-head <sha>] [--isolated] [--full]
 *        [--state <file>] [--effort high] [--thoroughness 0..1] [--no-threads]
 *        [--review-sha <sha>]
 *   node prepare-review.mjs --cleanup <context.json>
 *   node prepare-review.mjs --self-test
 *
 * Exit codes: 0 ok · 1 unrecoverable (no PR reference resolved, metadata
 * unreadable) · 2 usage. A degraded rung is NEVER an exit code — it is an entry
 * in `anomalies[]`, because a review that could not materialize a checkout is a
 * narrower review, not a failed one.
 */

import { execFile, execFileSync, spawn } from "node:child_process";
import { writeFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, openSync, closeSync, statSync, rmSync, rmdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Timing, beginRun, appendRecord, hostFacts, ledgerPath, markerCommand, modelSteps } from "./review-telemetry.mjs";
import { classifyDivergence, blobDelta, deltaCounts, churnState, resolveIntactDelta, resolveChurnLines, compareHistory, authoredPrPaths, parseLocalDiff, prFilesCompleteness, FULL_REFRESH_DELTA } from "./delta-triage.mjs";
import { routeDepth, resolveBudget } from "./route-depth.mjs";
import { buildReviewPacket, consumersByFile } from "./review-packet.mjs";
import { discoverStandards, trivialSkip } from "./discover-standards.mjs";
import { scanGate4 } from "./gate4-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_MARKER = "<!-- PR_REVIEWER_REPORT -->";
const POINTER_MARKER = "<!-- PR_REVIEWER_POINTER -->";

/* ----------------------------- small helpers ----------------------------- */

/**
 * Where a materialized checkout is allowed to live.
 *
 * NOT `os.tmpdir()`. The host's file tools are scoped to the agent workspace, and
 * a path outside it is denied rather than merely awkward — measured on the first
 * fan-out run against `mthines/lorekit#679`, where the workspace landed in
 * `/tmp/prr-clone-X9bL2B` and the `standards` finder's sub-agent had `read`,
 * `glob` AND `cat` all refused against it. It returned zero findings and said so;
 * a finder that had not disclosed the refusal would have reported a clean
 * conformance pass over files it never opened.
 *
 * So the checkout goes under the workspace, where every agent in the run can read
 * it. `os.tmpdir()` stays as the last rung for a host with no workspace at all.
 */
export function scratchRoot() {
  for (const candidate of [process.env.PR_REVIEWER_SCRATCH, "/tmp/workspace", process.cwd()]) {
    if (!candidate) continue;
    try {
      if (!existsSync(candidate)) continue;
      const dir = join(candidate, ".pr-reviewer-scratch");
      mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* try the next rung */
    }
  }
  return tmpdir();
}

export function run(cmd, args, { timeoutMs = 60000, cwd = process.cwd(), maxBuffer = 64 * 1024 * 1024, env } = {}) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: timeoutMs, cwd, maxBuffer, encoding: "utf8", env: env || process.env }, (err, stdout, stderr) => {
      // A/B round 2 item 1(a): `execFile`'s own `timeout` kills the child with `err.killed ===
      // true` and a signal, but reports NO stderr of its own — the process never got to write
      // one. Losing that distinction is exactly what produced "workspace rung 1 clone failed: "
      // with an empty message: a caller reading `stderr` alone cannot tell a killed process from
      // one that failed fast and silently. `timedOut` makes the distinction explicit so a caller
      // can report "timed out after Ns" instead of nothing.
      const timedOut = !!(err && err.killed === true);
      res({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "", timedOut });
    });
  });
}

/**
 * Like `run()`, but streams stdout straight into `filePath` instead of buffering it. For binary
 * payloads (the rung-2 tarball): `run()` decodes stdout as UTF-8, which corrupts every non-UTF-8
 * byte of a `.tgz`, and buffers it under `maxBuffer`, which a large repo's tarball overflows.
 * Resolves with `run()`'s result shape; `stdout` is always empty and `bytes` is the file's size.
 * @param {string} cmd @param {string[]} args @param {string} filePath
 * @param {{ timeoutMs?: number, cwd?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ ok: boolean, code: number|string, stdout: string, stderr: string, timedOut: boolean, bytes: number }>}
 */
export function runToFile(cmd, args, filePath, { timeoutMs = 60000, cwd = process.cwd(), env } = {}) {
  return new Promise((res) => {
    const fd = openSync(filePath, "w");
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (/** @type {number|string} */ code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      closeSync(fd);
      const bytes = existsSync(filePath) ? statSync(filePath).size : 0;
      res({ ok: code === 0 && !timedOut, code, stdout: "", stderr, timedOut, bytes });
    };
    const child = spawn(cmd, args, { cwd, env: env || process.env, stdio: ["ignore", fd, "pipe"] });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
    child.stderr.on("data", (d) => { if (stderr.length < 64 * 1024) stderr += String(d); });
    child.on("error", (e) => { stderr += String(e.message || e); done(/** @type {any} */ (e).code ?? 1); });
    child.on("close", (code) => done(code ?? 1));
  });
}

/**
 * Turns a failed `run()` result into a caller-facing anomaly string, never blank. A/B round 2
 * item 1(a): "report a killed or timed-out process explicitly (`timed out after Ns`), never as
 * empty stderr" — and the same fix closes the more general case of ANY failure with empty
 * stderr (not only a timeout), which read exactly the same way before this: nothing.
 * @param {{ ok: boolean, code: number, stderr: string, timedOut?: boolean }} result
 * @param {number} timeoutMs
 * @returns {string}
 */
export function describeFailure(result, timeoutMs) {
  if (result.timedOut) return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  const stderr = (result.stderr || "").trim();
  return stderr ? stderr.slice(0, 200) : `failed with exit code ${result.code}`;
}

/**
 * A/B round 1 delta. Every `git` invocation below that talks to a remote
 * (`clone`, `fetch`) passes these FIRST, before the subcommand — git's own
 * `-c` ordering rule. Clearing `credential.helper` before re-setting it
 * (rather than only appending a second one) matters: git tries every
 * configured helper in order and stops at the first that answers, so an
 * ambient one left in place (an expired keychain entry, a helper for a
 * different host) can still win and either prompt or answer wrong. Routing
 * through `gh auth git-credential` reuses whatever token `gh` is already
 * authenticated with, so a private-repo fetch here needs no separate login.
 */
export const GIT_CREDENTIAL_ARGS = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"];

/**
 * `GIT_TERMINAL_PROMPT=0` is the belt to `GIT_CREDENTIAL_ARGS`' suspenders:
 * if `gh` itself is not authenticated, git falls back to trying an
 * interactive username/password prompt on a TTY nothing here is reading,
 * which hangs the whole pipeline instead of failing the fetch. This env
 * makes that failure immediate and visible in `stderr` instead.
 */
export const GIT_NONINTERACTIVE_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

/**
 * Parse a PR reference into { repo, number }.
 *
 * Accepts the three forms the agent's Step 0 accepts, and nothing else. A bare
 * number carries no repo, so it is returned with `repo: null` for the caller's
 * `--repo` (or the cwd's origin) to supply — never guessed.
 */
export function parsePrRef(ref, fallbackRepo = null) {
  if (!ref || typeof ref !== "string") return null;
  const s = ref.trim();

  const url = s.match(/^https?:\/\/[^/]*github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (url) return { repo: `${url[1]}/${url[2]}`, number: Number(url[3]) };

  const hash = s.match(/^([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#(\d+)$/);
  if (hash) return { repo: hash[1], number: Number(hash[2]) };

  const bare = s.match(/^#?(\d+)$/);
  if (bare) return { repo: fallbackRepo, number: Number(bare[1]) };

  return null;
}

/**
 * Pull the prior reviewed SHA out of a sticky report body.
 *
 * Anchored on `commit \`<sha>\`` ALONE, never on "review for commit": the footer
 * appears in three run-mode forms ("Reviewed for commit", "Incremental review
 * for commit", "… gate checks only for commit") and anchoring on the phrase
 * missed two of the three. `comment-spine.mjs` renders exactly 7 lowercase hex
 * chars, so that is what this accepts.
 */
export function priorShaFromBody(body) {
  if (!body) return null;
  const m = String(body).match(/commit\s+`([0-9a-f]{7,40})`/);
  return m ? m[1] : null;
}

/**
 * The jq projection the issue-comments fetch applies. It flattens the author to a STRING
 * (`user: .user.login`), so a matched sticky carries `user: "<login>"`, not `user: { login }`.
 * Exported so the self-test builds its fixtures from the same projection the fetch uses.
 */
export const ISSUE_COMMENTS_JQ = ".[] | {id: .id, user: .user.login, body: .body, html_url: .html_url, created_at: .created_at}";

/**
 * The login of whoever posted a matched sticky, or null.
 * Accepts both shapes: the flattened string the `ISSUE_COMMENTS_JQ` fetch emits, and the raw
 * API object (`{ login }`). Reading only `user.login` made the prior-report-author rung dead,
 * because the fetch never produces that shape.
 * @param {{ user?: string | { login?: string } | null } | null | undefined} sticky
 * @returns {string|null}
 */
export function stickyAuthorLogin(sticky) {
  const u = sticky?.user;
  if (typeof u === "string") return u || null;
  return u?.login ?? null;
}

/**
 * Find the sticky report among the issue comments.
 *
 * Matched by MARKER ONLY, never by author login. The marker is the identity;
 * `ME` is unavailable on every access path where `/user` 401s, and a
 * login-keyed filter there silently matches nothing — after which every run
 * creates a fresh report instead of rewriting the one that exists.
 * `last` is defensive: there must only ever be one.
 */
export function findSticky(comments) {
  const hits = (comments || []).filter((c) => String(c.body || "").includes(REPORT_MARKER));
  if (hits.length) return { ...hits[hits.length - 1], kind: "report", duplicates: hits.length - 1 };
  const ptr = (comments || []).filter((c) => String(c.body || "").includes(POINTER_MARKER));
  if (ptr.length) return { ...ptr[ptr.length - 1], kind: "pointer", duplicates: ptr.length - 1 };
  return null;
}

/**
 * Compare two SHAs on a 7-char prefix.
 *
 * Never a raw `===`. The GitHub fallback rung recovers the prior SHA from the
 * sticky footer, which the renderer pins to exactly 7 chars, while `headRefOid`
 * is the full 40 — so a raw comparison can never match and the zero-delta fast
 * path is permanently dead.
 */
export function sameCommit(a, b) {
  if (!a || !b) return false;
  return String(a).slice(0, 7) === String(b).slice(0, 7);
}

/**
 * Normalize a GitHub login for identity comparison.
 *
 * One GitHub App answers to three spellings and the API hands back a different
 * one per endpoint: `gh pr view --json author` reports an App author as
 * `app/dash0-dev`, the REST comment and review payloads report the same actor as
 * `dash0-dev[bot]`, and a human configuring the automation types `dash0-dev`.
 * Comparing them raw makes `REVIEW_RELATION` `cross` on the agent's own PR —
 * which is not cosmetic: it is the flag that decides whether findings are framed
 * with context-asymmetry hedging.
 */
export function normalizeLogin(login) {
  return String(login || "")
    .trim()
    .toLowerCase()
    .replace(/^app\//, "")
    .replace(/\[bot\]$/, "");
}

/**
 * `--pin-head <sha>` comparability check (R3, D13, AC-5). A pinned head that
 * has moved since the caller chose it is NOT a narrower review — it is a
 * review of a different commit wearing the pinned one's label, which is
 * exactly what an A/B or shadow run must never silently do. Compared as a
 * shared prefix (7+ chars) so a caller may pin either the short or full SHA.
 */
export function verifyPinnedHead(pinnedSha, liveHeadSha) {
  if (!pinnedSha) return { ok: true };
  if (!liveHeadSha) return { ok: false, message: `head moved: pinned ${pinnedSha} live (unreadable)` };
  const n = Math.min(pinnedSha.length, liveHeadSha.length, 40);
  if (pinnedSha.slice(0, n) !== liveHeadSha.slice(0, n)) {
    return { ok: false, message: `head moved: pinned ${pinnedSha} live ${liveHeadSha}` };
  }
  return { ok: true };
}

/**
 * A GitHub login: 1–39 alphanumerics or single hyphens, not starting or ending with a hyphen, with
 * an optional `[bot]` suffix for App identities. Anything else — an error body, a URL, whitespace —
 * is not a login and must never be compared against a PR author.
 * @param {unknown} s
 */
export function isGithubLogin(s) {
  return typeof s === "string" && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/.test(s);
}

/**
 * The exact input `prepare()` hands `resolveReviewerIdentity`, built in one place so the self-test
 * exercises the real call site rather than a hand-assembled copy of it. Under `--isolated` the
 * sticky is never read as prior-run state, so its author is `null`.
 * @param {{ opts: { reviewerLogin?: string }, state: { botLogin?: string|null }, sticky: any, isolated: boolean, env?: Record<string, string|undefined> }} input
 * @returns {{ suppliedLogin: string, fromFlag: boolean, stateBotLogin: string|null, stickyAuthorLogin: string|null }}
 */
export function identityInputs({ opts, state, sticky, isolated, env = process.env }) {
  return {
    suppliedLogin: opts.reviewerLogin || env.PR_REVIEWER_LOGIN || "",
    fromFlag: Boolean(opts.reviewerLogin),
    stateBotLogin: state.botLogin ?? null,
    stickyAuthorLogin: isolated ? null : stickyAuthorLogin(sticky),
  };
}

/**
 * The reviewer identity, first match wins: a valid supplied login (`--reviewer-login`, then
 * PR_REVIEWER_LOGIN), then the state record's `bot_login` (pr-reviewer.md's identity ladder),
 * then the matched prior sticky's author login (the GitHub fallback rung — `ISSUE_COMMENTS_JQ`
 * flattens it to `user: "<login>"`, read via `stickyAuthorLogin`; whoever posted the
 * report is the reviewer, so a re-review with no `--state` still knows itself and still builds
 * Fix-this buttons), else unknown. A supplied login always outranks the record, and the record
 * outranks the sticky's author. The caller passes `null` for the sticky author under `--isolated`,
 * where the sticky is never read as prior-run state.
 * @param {{ suppliedLogin: string, fromFlag: boolean, stateBotLogin: string|null, stickyAuthorLogin?: string|null }} input
 * @returns {{ me: string, identitySource: string }}
 */
export function resolveReviewerIdentity({ suppliedLogin, fromFlag, stateBotLogin, stickyAuthorLogin = null }) {
  if (isGithubLogin(suppliedLogin)) return { me: suppliedLogin, identitySource: fromFlag ? "--reviewer-login" : "PR_REVIEWER_LOGIN" };
  if (isGithubLogin(stateBotLogin)) return { me: /** @type {string} */ (stateBotLogin), identitySource: "state-record" };
  if (isGithubLogin(stickyAuthorLogin)) return { me: /** @type {string} */ (stickyAuthorLogin), identitySource: "prior-report-author" };
  return { me: "", identitySource: "unknown" };
}

/**
 * `--isolated` run-mode resolution (R3, D10, D13, AC-5). Isolated repeat
 * runs (the A/B harness, the shadow run) need first-run semantics on every
 * invocation — no LoreKit state-record read, `--full` forced, so a run's
 * behaviour depends only on its pinned head, never on what a PRIOR run in
 * the same series left behind. `--state <file>` itself is wired in Phase 1
 * (D10); this resolves the flag's SEMANTICS now so `--isolated` already
 * ignores whatever is passed and callers do not have to wait for Phase 1 to
 * get comparable runs.
 */
export function resolveRunMode({ isolated = false, full = false, statePath = null } = {}) {
  const effectiveFull = !!(isolated || full);
  return {
    isolated: !!isolated,
    full: effectiveFull,
    // "full" here only means "the D1/D6 first-run trigger is forced" — the
    // actual tier (deep/standard/quick) is Phase C's decision (route-depth.mjs,
    // Phase 1), unavailable yet at Phase 0. `mode` mirrors RUN.mode's two
    // states this phase can already determine; route-depth.mjs supplies the
    // rest once it exists.
    mode: effectiveFull ? "full" : null,
    stateIgnored: !!(isolated && statePath),
  };
}

/** render-report.mjs's `TIER_FOR_MODE`, inverted: the grammar-field mode a routed tier renders as. */
const MODE_FOR_TIER = { deep: "full", standard: "incremental", quick: "incremental-quick" };

/**
 * The context's top-level `mode` — RUN.mode for finalize.mjs — once Phase C has routed.
 * `resolveRunMode` can only decide the forced-full case at Phase 0; every other run's mode
 * follows from the routed tier. Without this, a re-review that routing promotes to `deep`
 * (D4–D6) carried `mode: null`, finalize rendered `"unknown"`, and the render failed closed.
 * A capability cap (`deep` → `standard` under `diff-only`) keeps `full`: render-report.mjs's
 * carve-out expects exactly that pair, alongside the RUN_ANOMALY naming the cap.
 * @param {{ runMode: { mode: string|null }, zeroDelta: boolean, routing: { tier: string, capApplied?: boolean } }} args
 * @returns {string}
 */
export function resolveContextMode({ runMode, zeroDelta, routing }) {
  if (runMode.mode) return runMode.mode;
  if (zeroDelta) return "zero-delta";
  if (routing.capApplied) return "full";
  const mode = MODE_FOR_TIER[routing.tier];
  if (!mode) throw new Error(`resolveContextMode: routed tier ${JSON.stringify(routing.tier)} maps to no mode`);
  return mode;
}

/**
 * `--isolated`'s "no fallback to the sticky's footer SHA either" rule (pipeline.md §
 * --isolated item 1), extracted as a pure function so it is self-testable without a
 * live `gh` call. Under isolated, this run never treats an existing sticky as a prior
 * run to diff against — `priorSha` is null and `zeroDelta` is false unconditionally,
 * regardless of whether a sticky (from an earlier, non-comparability review of the
 * same PR) is physically present.
 * @param {{ isolated: boolean, stickyBody: string|null, headSha: string }} args
 * @returns {{ priorSha: string|null, zeroDelta: boolean }}
 */
/**
 * Where `priorSha` came from, stated in the artifact's own words. A non-isolated run whose
 * `--state` record supplied `priorSha` must not be told that value is the GitHub fallback rung
 * — the two rungs carry different guarantees, and a consumer reads these strings literally.
 * @param {{ fromState: boolean }} args
 * @returns {{ loreKitNotCovered: string, note: string }}
 */
export function priorShaProvenance({ fromState }) {
  return fromState
    ? {
      loreKitNotCovered: "LoreKit reads (Steps 1.0, 1.2c, 1.2d) — priorSha below is from the --state record (Step 0.7), and carries no PRIOR_DIAGNOSTICS",
      note: "priorSha is from the --state record. PRIOR_DIAGNOSTICS is not carried into context.json — read it off that record before taking Step 0.8's fast path.",
    }
    : {
      loreKitNotCovered: "LoreKit reads (Steps 0.7, 1.0, 1.2c, 1.2d) — priorSha below is the GitHub FALLBACK rung only, and carries no PRIOR_DIAGNOSTICS",
      note: "PRIOR_DIAGNOSTICS is NOT recoverable from the fallback rung. Read the LoreKit state record before taking Step 0.8's fast path.",
    };
}

export function resolvePriorRun({ isolated, stickyBody, headSha, statePriorSha = null }) {
  if (isolated) return { priorSha: null, zeroDelta: false };
  // The state record is the primary source (Step 0.7); the sticky's footer is the fallback rung.
  const priorSha = statePriorSha || (stickyBody ? priorShaFromBody(stickyBody) : null);
  return { priorSha, zeroDelta: sameCommit(headSha, priorSha) };
}

/**
 * `--review-sha <sha>` resolution (D8/D9, plan feat/pr-reviewer-shrink-fanout-ab, AC-15/16).
 *
 * A pure prefix-resolution helper over a candidate list — the SAME shape `git` itself uses
 * to resolve an abbreviated SHA — never a live network call. The caller supplies the
 * candidate list (this PR's own commit OIDs, read from the SAME `gh pr view --json commits`
 * fetch the metadata read already makes, at no extra round trip) so this function is fully
 * self-testable without `gh`.
 *
 * Three ways a `--review-sha` can fail to name exactly one commit, each refused rather than
 * guessed: too short to disambiguate (below `MIN_SHA_LEN`), matching nothing in the PR's own
 * history (not-in-list), or matching more than one commit (ambiguous — an 8-char prefix can
 * collide on a large enough PR). Only an exact match or a UNIQUE prefix match resolves.
 * @param {string} reviewSha
 * @param {string[]} candidates - full-length commit OIDs, e.g. this PR's own commit list
 * @returns {{ ok: boolean, resolved: string|null, message: string }}
 */
const MIN_SHA_LEN = 7;
export function verifyReviewSha(reviewSha, candidates) {
  const sha = String(reviewSha || "").trim().toLowerCase();
  if (!sha) return { ok: false, resolved: null, message: "--review-sha is empty" };
  if (sha.length < MIN_SHA_LEN) {
    return {
      ok: false,
      resolved: null,
      message: `--review-sha ${sha} is shorter than ${MIN_SHA_LEN} chars — cannot prove which commit this names`,
    };
  }
  const list = (candidates || []).map((c) => String(c || "").toLowerCase()).filter(Boolean);
  const exact = list.find((c) => c === sha);
  if (exact) return { ok: true, resolved: exact, message: "exact match" };
  const matches = [...new Set(list.filter((c) => c.startsWith(sha)))];
  if (matches.length === 1) return { ok: true, resolved: matches[0], message: "unique prefix match" };
  if (matches.length > 1) {
    return {
      ok: false,
      resolved: null,
      message: `--review-sha ${sha} is ambiguous — matches ${matches.length} commits on this PR (${matches.map((m) => m.slice(0, 10)).join(", ")})`,
    };
  }
  return {
    ok: false,
    resolved: null,
    message: `--review-sha ${sha} does not match any commit on this PR — cannot prove it exists`,
  };
}

/**
 * Filter a list of GitHub-sourced, timestamped items to only those that existed AS OF a
 * given instant — used to keep a historical (`--review-sha`) run from reading anything that
 * postdates the commit it is reviewing (`historicalThreads()` below is the caller). Three
 * cases, stated separately because they fail in different directions:
 *   - no cutoff (`null` / `""`) filters NOTHING — the live-review path. This is a pass-through,
 *     not a fail-closed default, so a historical caller must never reach it: `historicalThreads()`
 *     refuses to call this without a resolved cutoff.
 *   - a non-empty but unparseable cutoff fails CLOSED: nothing is returned.
 *   - an item with no readable own timestamp is dropped rather than assumed to qualify.
 * @param {any[]} items
 * @param {string|null} asOfIso - ISO 8601 instant, e.g. review_sha's commit timestamp
 * @param {string} [dateField]
 * @returns {any[]}
 */
export function filterAsOf(items, asOfIso, dateField = "created_at") {
  if (!asOfIso) return items || [];
  const cutoff = Date.parse(asOfIso);
  if (Number.isNaN(cutoff)) return [];
  return (items || []).filter((it) => {
    const t = Date.parse(it?.[dateField]);
    return Number.isNaN(t) ? false : t <= cutoff;
  });
}

/**
 * `--review-sha` thread state (D9): keep only the threads whose ROOT comment existed at the
 * reviewed commit's committer date, and within them only the replies that did. The cutoff is
 * the resolved commit's `committedDate` from the SAME `gh pr view --json commits` read that
 * `verifyReviewSha` used. A missing or unparseable date fails CLOSED — zero threads plus an
 * anomaly — because reading present-day threads into a past review is exactly the leak this
 * exists to stop. Resolution / outdated flags cannot be reconstructed from the API and stay
 * as of now (`historical.thread_state_as_of: "now"`); only the thread SET and its replies are
 * filtered (`historical.threads_created_as_of`).
 * @param {{ threads: any[], commits: any[], reviewSha: string }} args
 * @returns {{ threads: any[], asOf: string|null, anomaly: string|null }}
 */
export function historicalThreads({ threads, commits, reviewSha }) {
  const sha = String(reviewSha || "").toLowerCase();
  const commit = (commits || []).find((c) => String(c?.oid || "").toLowerCase() === sha);
  const asOf = commit?.committedDate || null;
  if (!asOf || Number.isNaN(Date.parse(asOf))) {
    return {
      threads: [],
      asOf: null,
      anomaly: `--review-sha ${sha.slice(0, 7)}: no committedDate for the reviewed commit — thread state dropped (fail closed) rather than read as of now`,
    };
  }
  const kept = filterAsOf(threads, asOf).map((t) => ({ ...t, replies: filterAsOf(t.replies || [], asOf) }));
  return { threads: kept, asOf, anomaly: null };
}

/**
 * The `historical` block embedded in `context.json` whenever `--review-sha` is set (D8/D9).
 * Every field either IS `review_sha` or is explicitly marked `"now"` / `"not-read"` — never
 * silently presented as contemporaneous with `review_sha`:
 *
 *   - `thread_state_as_of` / `description_as_of` are `"now"`: GitHub's API has no way to
 *     reconstruct either as of an arbitrary past commit, so a historical run reads the
 *     CURRENT thread state and CURRENT description against the PAST code — an honest
 *     mixed-time view, not a simulated past PR page.
 *   - `ci` is `"not-read"`: `gh pr checks` reports the CURRENT check run for the CURRENT
 *     head, which has no relationship to `review_sha`'s own (likely long-superseded) check
 *     runs — reporting it would silently misattribute today's CI result to a commit reviewed
 *     days or weeks ago. `finalize.mjs` and `execute-write-plan.mjs` both refuse to POST
 *     anything for a context carrying this block outside `--dry-run` (D9, AC-17/AC-18).
 * @param {{ reviewSha: string }} args
 * @returns {{ review_sha: string, thread_state_as_of: string, description_as_of: string, ci: string }}
 */
export function historicalBlock({ reviewSha }) {
  return {
    review_sha: reviewSha,
    thread_state_as_of: "now",
    description_as_of: "now",
    ci: "not-read",
  };
}

/** Total changed lines across the patch list. */
export function deltaLines(files) {
  return (files || []).reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0);
}

/**
 * Partition the file list into diffable and undiffable.
 *
 * GitHub returns `"patch": null` for any binary file while still listing it with
 * a status and a change count, so it looks reviewable right up to the last gate.
 * Computing the split once, here, is what lets a downstream candidate be marked
 * ANCHORLESS-BY-CONSTRUCTION at birth instead of dying at line-validity.
 */
export function partitionUndiffable(files) {
  const undiffable = [];
  const diffable = [];
  for (const f of files || []) {
    if (f.patch === null || f.patch === undefined) undiffable.push(f.filename);
    else diffable.push(f.filename);
  }
  return { diffable, undiffable };
}

/* ------------------------------ gh fetches ------------------------------ */

export async function ghJson(args, opts) {
  const r = await run("gh", args, opts);
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout).trim().slice(0, 500), value: null };
  try {
    return { ok: true, error: null, value: JSON.parse(r.stdout) };
  } catch (err) {
    return { ok: false, error: `unparseable JSON from gh ${args.join(" ")}: ${err.message}`, value: null };
  }
}

/**
 * Read a paginated list endpoint as NDJSON.
 *
 * `--paginate` is mandatory on every list endpoint here: `pulls/{n}/files` pages
 * at 30, and a silent first-page read makes line validity, the classifier and
 * the blob fallback all blind to the tail of a large PR — while a first-page
 * read of the issue comments loses the sticky on any PR with a long thread,
 * after which prior-run detection reports a first run and the report is posted
 * twice.
 *
 * `--paginate` combined with `--jq` emits one JSON value PER LINE rather than a
 * single array, and `--slurp` cannot be used to re-assemble it: this `gh` rejects
 * `--slurp` alongside `--jq` outright ("the `--slurp` option is not supported
 * with `--jq`"), and the rejection arrives on stderr with exit 1, which reads
 * exactly like an unreadable endpoint. Parse the stream line-wise instead.
 */
async function ghNdjson(args, timeoutMs) {
  const r = await run("gh", args, { timeoutMs });
  if (!r.ok) return { ok: false, error: (r.stderr || r.stdout).trim().slice(0, 300), value: [] };
  const out = [];
  let dropped = 0;
  for (const line of r.stdout.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch {
      // A truncated tail line is counted, never silently repaired: a partial
      // read that reports as complete is the failure this whole script exists
      // to remove, not one to reintroduce here.
      dropped++;
    }
  }
  return { ok: true, error: dropped ? `${dropped} unparseable line(s)` : null, value: out };
}

function fetchFiles(repo, number, timeoutMs) {
  return ghNdjson(
    [
      "api",
      `repos/${repo}/pulls/${number}/files`,
      "--paginate",
      "--jq",
      ".[] | {filename, patch, status, additions, deletions, sha}",
    ],
    timeoutMs,
  );
}

/**
 * The SAME `reviewThreads` query `thread-resolution.md § Resolve the thread`
 * and `prior-comment-awareness.md § fetch existing PR comment state` walk
 * (D10) — widened to also carry `path`, `line`, `originalLine`, `url`,
 * `body`, `createdAt`, and author identity, which this pipeline's
 * `threads[]` context field needs and those two rule files' minimal
 * `{id isResolved isOutdated comments{nodes{databaseId}}}` shape does not.
 * A strict superset: a consumer reading only the narrower fields still
 * matches. `author{ login __typename }` is the graphql equivalent of the
 * REST `user.type == "Bot"` field agents/pr-reviewer.md Step 1.0 requires
 * `is_bot` to be read from — never a login-pattern guess.
 */
const THREADS_QUERY = `
  query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
    repository(owner:$owner,name:$repo){
      pullRequest(number:$pr){
        reviewThreads(first:100, after:$cursor){
          pageInfo{ hasNextPage endCursor }
          nodes{
            id isResolved isOutdated
            comments(first:100){
              nodes{ databaseId path line originalLine url body createdAt author{ login __typename } }
            }
          }
        }
      }
    }
  }`;

/**
 * Pages `THREADS_QUERY` to completion. `complete: false` means the walk
 * stopped early (an API error, or an unreadable page) — the caller must
 * treat that as an INCOMPLETE thread map, never as "no more threads"
 * (`prior-comment-awareness.md § Pagination guard`).
 */
async function fetchReviewThreads(owner, repoName, number, timeoutMs) {
  const nodes = [];
  let cursor = null;
  let complete = true;
  for (;;) {
    const r = await ghJson(
      [
        "api",
        "graphql",
        "-f",
        `query=${THREADS_QUERY}`,
        "-F",
        `owner=${owner}`,
        "-F",
        `repo=${repoName}`,
        "-F",
        `pr=${number}`,
        "-F",
        `cursor=${cursor ?? "null"}`,
      ],
      { timeoutMs },
    );
    if (!r.ok) {
      complete = false;
      break;
    }
    const conn = r.value?.data?.repository?.pullRequest?.reviewThreads;
    if (!conn) {
      complete = false;
      break;
    }
    nodes.push(...(conn.nodes || []));
    if (conn.pageInfo?.hasNextPage) cursor = conn.pageInfo.endCursor;
    else break;
  }
  return { complete, nodes };
}

/**
 * Normalizes the paginated `reviewThreads` response into the pipeline's
 * `threads[]` context shape (D10). `root_comment_id` is the thread's FIRST
 * comment — GraphQL returns a thread's comments in creation order, and a
 * review thread's first comment is its root by GitHub's own model; every
 * other comment in the thread is a reply.
 * @param {any[]} rawNodes @returns {any[]}
 */
export function buildThreads(rawNodes) {
  const out = [];
  for (const node of rawNodes || []) {
    const comments = (node.comments && node.comments.nodes) || [];
    if (comments.length === 0) continue;
    const [root, ...replies] = comments;
    out.push({
      thread_id: node.id,
      root_comment_id: root.databaseId ?? null,
      path: root.path ?? null,
      line: root.line ?? null,
      original_line: root.originalLine ?? null,
      is_resolved: !!node.isResolved,
      is_outdated: !!node.isOutdated,
      url: root.url ?? null,
      author: root.author ? root.author.login : null,
      created_at: root.createdAt ?? null,
      is_bot: !!(root.author && root.author.__typename === "Bot"),
      root_body: root.body ?? null,
      replies: replies.map((r) => ({ author: r.author ? r.author.login : null, created_at: r.createdAt ?? null })),
    });
  }
  return out;
}

/**
 * Right-side hunk anchors for one file's patch — the `DELTA_HUNKS` the
 * THREAD_OVERLAP formula walks (agents/pr-reviewer.md § "Bind DEPTH_TIER").
 * Anchor = the hunk's right-side START line, a single point rather than a
 * range, matching the ±5-line proximity convention this pipeline already
 * applies elsewhere.
 * @param {string|null|undefined} patch @returns {{start: number}[]}
 */
export function hunksOf(patch) {
  if (!patch) return [];
  const out = [];
  for (const raw of patch.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (m) out.push({ start: parseInt(m[1], 10) });
  }
  return out;
}

/**
 * THREAD_OVERLAP (agents/pr-reviewer.md § "Bind DEPTH_TIER") — the fraction
 * of this delta's hunks that sit on top of existing review conversation,
 * any author, open or resolved. `t.anchor = t.line ?? t.original_line`
 * (never `line` alone — GitHub nulls it on an outdated thread, which is
 * precisely the population a review-answering push produces); a
 * file-level thread (`anchor == null`) matches every hunk in its file.
 * @param {{filename: string, patch?: string|null}[]} files
 * @param {{path: string|null, line: number|null, original_line: number|null}[]} threads
 * @returns {number}
 */
export function computeThreadOverlap(files, threads) {
  const hunks = [];
  for (const f of files || []) {
    for (const h of hunksOf(f.patch)) hunks.push({ path: f.filename, anchor: h.start });
  }
  if (hunks.length === 0 || !threads || threads.length === 0) return 0;
  const byPath = new Map();
  for (const t of threads) {
    if (!t.path) continue;
    const anchor = t.line ?? t.original_line ?? null;
    if (!byPath.has(t.path)) byPath.set(t.path, []);
    byPath.get(t.path).push(anchor);
  }
  let matched = 0;
  for (const hunk of hunks) {
    const anchors = byPath.get(hunk.path);
    if (!anchors) continue;
    if (anchors.some((a) => a === null || Math.abs(a - hunk.anchor) <= 5)) matched++;
  }
  return matched / hunks.length;
}

/** `gh pr checks` exits 1 when a check failed and 8 while one is pending, printing the table
 *  either way — a red CI is a read, not a failure to read. On dash0#20655 a failing "Generate
 *  types" check was reported as "gh pr checks unreadable".
 *  @param {{ ok: boolean, code?: number|string, stdout?: string, timedOut?: boolean }} r */
export function checksReadable(r) {
  if (r.ok) return true;
  return !r.timedOut && (r.code === 1 || r.code === 8) && String(r.stdout || "").trim().length > 0;
}

/**
 * Reads the `--state` file (D10) — the caller's already-fetched LoreKit
 * state record `data`, read by the AGENT before invoking this script
 * (Steps 0.7/1.0; this script does no LoreKit I/O itself, per its own
 * "What it deliberately does NOT do" note above). Absent or unreadable
 * degrades to "no prior deep pass on record" — the SAFE direction per
 * depth-routing.md's D6 ("no prior full review is recorded").
 * Accepts the record as Step 4c writes it (`{v, commit, data: {runs[]}}`, or a LoreKit read's
 * `{value: "<that JSON>"}`), or the flat `{priorSha, lastFullSha, incrRunsSinceFull}` shape.
 * `rounds` is the worklist each recorded run left (`runs[].open`/`.blocking`, Step 4c), oldest
 * first and capped at the last four; a run recorded before those fields existed is skipped, never
 * guessed. It feeds the report's `**Progress:**` line.
 * @param {string|null} path @returns {{priorSha: string|null, lastFullSha: string|null, incrRunsSinceFull: number, stickyCommentId?: number|null, botLogin?: string|null, rounds?: {sha: string, open: number, blocking: number}[]}}
 */
export function readStateFile(path) {
  const none = { priorSha: null, lastFullSha: null, incrRunsSinceFull: 0 };
  if (!path) return none;
  try {
    let raw = JSON.parse(readFileSync(path, "utf8"));
    // A LoreKit read returns the record's value as a string; accept the envelope as well.
    if (typeof raw?.value === "string") raw = JSON.parse(raw.value);
    // The record itself (Step 4c's shape): the same three bindings Step 0.7 derives with jq.
    // On dash0#20655 a re-review that had read this record still ran as a first run, because the
    // script took the prior SHA only from the sticky and could not read `data.runs[]` at all.
    const runs = Array.isArray(raw?.data?.runs) ? raw.data.runs : null;
    if (runs) {
      const lastFull = runs.map((r) => r?.mode).lastIndexOf("full");
      return {
        stickyCommentId: raw.data.sticky_comment_id ?? null,
        // pr-reviewer.md's identity ladder falls back to the record's bot_login when no login was
        // supplied; without it the Fix-this links (which need a login) were never built. Validated
        // with isGithubLogin — an unvalidated record value must never become the reviewer identity.
        botLogin: isGithubLogin(raw.data.bot_login) ? raw.data.bot_login : null,
        priorSha: runs.length ? String(runs[runs.length - 1]?.sha || "") || null : null,
        lastFullSha: lastFull < 0 ? null : String(runs[lastFull]?.sha || "") || null,
        incrRunsSinceFull: lastFull < 0 ? runs.length : runs.length - 1 - lastFull,
        rounds: runs
          .filter((r) => /^[0-9a-f]{7,40}$/.test(String(r?.sha || "").toLowerCase())
            && Number.isInteger(r?.open) && r.open >= 0
            && Number.isInteger(r?.blocking) && r.blocking >= 0 && r.blocking <= r.open)
          .map((r) => ({ sha: String(r.sha).toLowerCase().slice(0, 7), open: r.open, blocking: r.blocking }))
          .slice(-4),
      };
    }
    return {
      priorSha: raw.priorSha || raw.prior_sha || null,
      lastFullSha: raw.lastFullSha || raw.last_full_sha || null,
      incrRunsSinceFull: Number(raw.incrRunsSinceFull ?? raw.incr_runs_since_full ?? 0) || 0,
    };
  } catch {
    return none;
  }
}

/* ---------------------------- workspace ladder ---------------------------- */

// A/B round 2 item 1(a): rung 1's clone was observed timing out at ~145s under 4 CONCURRENT
// clones of a 368 MB repo against the old 120s floor, with the tarball rung then ALSO exhausted
// and depth routing paying 205s to discover DEPTH_CAPABILITY=diff-only. Two fixes, both applied
// to rung 1 and rung 2 alike: a clone timeout floor of >= 300s (never the caller's shorter
// `timeoutMs`), and `--filter=blob:none` (a partial clone — trees and commits eagerly, blob
// content lazily on checkout) to cut the bytes a slow/contended clone has to move before it can
// even fail informatively.
const CLONE_TIMEOUT_FLOOR_MS = 300000;

/**
 * Walk the Phase A capability ladder once and bind DEPTH_CAPABILITY.
 *
 * Rung 0 (worktree over the local object store) is tried first and needs no
 * network: it is available whenever the cwd is a clone of the PR's repo. The
 * precondition is the clone plus a fetch of `pull/<n>/head` — a fork PR's head
 * branch is absent from origin, so branch-fetching would silently restrict this
 * rung to same-repo PRs.
 *
 * `WORKDIR_CLEANUP` is three-valued on purpose. `rm -rf` is correct ONLY for a
 * temp clone or tarball: on a worktree it leaves a stale entry in the parent
 * repo's `.git/worktrees`, so the review breaks the repo it was reviewing.
 */
/** Both compare reads' jq: the divergence fields plus what an intact range needs, in one call. */
/** The commit-history fields compareTrust() reads: merges in the range, and whether the (250-row) commit list is whole. */
const COMPARE_HISTORY_JQ = "total_commits, listed_commits: ((.commits // []) | length), merge_commits: ([(.commits // [])[] | select(((.parents // []) | length) > 1)] | length)";
const DELTA_COMPARE_JQ = `{status, ahead_by, behind_by, ${COMPARE_HISTORY_JQ}, files: [(.files // [])[] | {filename, additions, deletions, status, patch}]}`;
/** Per-file lines, not a pre-summed total: resolveChurnLines() needs the list to judge truncation/pollution. */
const CHURN_COMPARE_JQ = `{status, behind_by, ${COMPARE_HISTORY_JQ}, files: [(.files // [])[] | {filename, lines: (.additions + .deletions)}]}`;

/** One `compare/<from>...<to>` read that returns the divergence fields and the file data together.
 *  A range too large to return with files still has to classify, so a failed combined read falls
 *  back to the fields-only read, and the result says the file data is missing (`files`/`lines`
 *  absent, `filesError` set) — the caller then degrades exactly as it did when that was a
 *  second call.
 *  @param {string} repo @param {string} from @param {string} to @param {string} jq
 *  @param {string} metaJq @param {number} timeoutMs */
async function compareRange(repo, from, to, jq, metaJq, timeoutMs) {
  const path = `repos/${repo}/compare/${from}...${to}`;
  const both = await ghJson(["api", path, "--jq", jq], { timeoutMs: Math.max(timeoutMs, 120000) });
  if (both.ok) return both;
  const meta = await ghJson(["api", path, "--jq", metaJq], { timeoutMs });
  return meta.ok ? { ...meta, filesError: both.error } : meta;
}

/**
 * The authored delta `from..to` read from a LOCAL git checkout — no 300-file compare cap. Tries
 * each candidate dir in order and uses the first whose object store holds `from`, `to` and the
 * PR's base tip (`baseSha`) with `from` an ancestor of `to`. Authored = files changed by the
 * non-merge commits in `from..to` NOT reachable from the base tip (`rev-list --no-merges from..to
 * --not base`) — so a teammate's commit pulled in, or a sibling branch merged in, counts on either
 * parent, while the base branch's own commits never do — plus files each merge in that set resolved
 * differently from git's automatic re-merge (conflicts, hand edits), kept to the PR's own files
 * (authoredPrPaths). Residual: a PR file the author and the merged-in base both touched carries
 * the base's hunks too (the diff is `from..to` per file), which over-counts — the safe direction.
 * @param {{dirs: (string|null|undefined)[], from: string, to: string, baseSha: string, prFiles: any[], prFilesComplete: boolean, timeoutMs?: number}} input
 * @returns {Promise<{ok: true, files: any[], dir: string} | {ok: false, reason: string}>}
 */
export async function localAuthoredDelta({ dirs, from, to, baseSha, prFiles, prFilesComplete, timeoutMs = 60000 }) {
  if (!baseSha) return { ok: false, reason: "no base SHA — base-branch commits cannot be told from authored ones" };
  const candidates = [...new Set(dirs.filter((d) => d && existsSync(/** @type {string} */ (d))))];
  if (!candidates.length) return { ok: false, reason: "no local git checkout" };
  /** @param {string} out */
  const lines = (out) => out.split("\n").map((l) => l.trim()).filter(Boolean);
  let lastReason = "no candidate checkout holds both SHAs";
  for (const dir of /** @type {string[]} */ (candidates)) {
    /** @param {string[]} args */
    const g = (args) => run("git", ["-C", dir, "-c", "core.quotePath=false", "--literal-pathspecs", ...args], { timeoutMs });
    const have = async (/** @type {string} */ sha) => (await g(["cat-file", "-e", `${sha}^{commit}`])).ok;
    // PR #213 r4134545772: no workspace rung fetches the base tip (rung 0 fetches only
    // pull/<n>/head, rung 1 is head-only, --repo-dir fetches nothing), so once main moves the
    // PR's baseRefOid — and an old prior SHA — are usually absent. Fetch a missing one by SHA
    // from origin, once; a successful fetch is silent, a failed one is the reason returned.
    /** @param {string} sha @returns {Promise<string|null>} null when present, else why not */
    const haveOrFetch = async (sha) => {
      if (await have(sha)) return null;
      const f = await run("git", [...GIT_CREDENTIAL_ARGS, "-C", dir, "fetch", "-q", "--no-tags", "origin", sha], { timeoutMs, env: GIT_NONINTERACTIVE_ENV });
      if (f.ok && (await have(sha))) return null;
      return `not in ${dir}'s object store and fetching it from origin failed (${f.ok ? "fetched, still absent" : describeFailure(f, timeoutMs)})`;
    };
    if (!(await have(to))) { lastReason = `${to.slice(0, 7)} not in ${dir}'s object store`; continue; }
    const fromMiss = await haveOrFetch(from);
    if (fromMiss) { lastReason = `${from.slice(0, 7)} ${fromMiss}`; continue; }
    const baseMiss = await haveOrFetch(baseSha);
    if (baseMiss) { lastReason = `base ${baseSha.slice(0, 7)} ${baseMiss}`; continue; }
    if (!(await g(["merge-base", "--is-ancestor", from, to])).ok) { lastReason = `${from.slice(0, 7)} is not an ancestor of ${to.slice(0, 7)} in ${dir}`; continue; }
    const range = [`${from}..${to}`, "--not", baseSha];
    const own = await g(["log", "--no-merges", "--no-renames", "--format=", "--name-only", ...range]);
    const merges = await g(["rev-list", "--merges", "--parents", ...range]);
    if (!own.ok || !merges.ok) return { ok: false, reason: `git log failed in ${dir}: ${(own.stderr || merges.stderr).trim().slice(0, 160)}` };
    const touched = new Set(lines(own.stdout));
    for (const [m, ...parents] of lines(merges.stdout).map((l) => l.split(/\s+/))) {
      // `--remerge-diff` (git >= 2.36) names only files the recorded merge differs from git's own
      // automatic re-merge — conflict resolutions and hand edits. `--cc` also lists every file a
      // CLEAN merge combined from both sides (dash0#20655: dozens of main's files), so it is only
      // the fallback, over-counting in the safe direction: for an older git, and for an octopus
      // merge, where remerge-diff prints a warning, lists nothing, and still exits 0.
      let res = parents.length > 2 ? null : await g(["show", "--remerge-diff", "--no-renames", "--format=", "--name-only", m]);
      if (res && res.ok && !res.stdout.trim() && res.stderr.trim()) res = null;
      if (!res || !res.ok) res = await g(["diff-tree", "--cc", "--no-commit-id", "--name-only", "-r", m]);
      if (!res.ok) return { ok: false, reason: `reading merge ${m.slice(0, 7)} failed` };
      for (const f of lines(res.stdout)) touched.add(f);
    }
    const paths = authoredPrPaths(touched, prFiles, prFilesComplete);
    if (!paths.length) return { ok: true, files: [], dir };
    // Fixed a/ and b/ prefixes and repo-root paths whatever the user's config says (diff.noprefix,
    // diff.mnemonicPrefix, diff.relative): parseLocalDiff keys each patch on its `+++ b/` header.
    const base = ["-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "diff.relative=false",
      "diff", "--no-color", "--no-ext-diff", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/"];
    const [numstat, nameStatus, patch] = await Promise.all([
      g([...base, "--numstat", from, to, "--", ...paths]),
      g([...base, "--name-status", from, to, "--", ...paths]),
      g([...base, from, to, "--", ...paths]),
    ]);
    if (!numstat.ok || !nameStatus.ok || !patch.ok) return { ok: false, reason: `git diff failed in ${dir}` };
    return { ok: true, files: parseLocalDiff(numstat.stdout, nameStatus.stdout, patch.stdout), dir };
  }
  return { ok: false, reason: lastReason };
}

/**
 * Dispose of a context's workspace by the method its `workspace.cleanup` names — the scripted form
 * of workspace.md § Cleanup, so the process that ran prepare can release what prepare made.
 * Whoever ran prepare owns this call: under `/pr-review` and `review-loop` that is the CALLER (it
 * prepares once for the reviewer and the intent worker), never the reviewer it hands `--context`
 * to. `none` is left alone; `worktree` goes through `git worktree remove` (an `rm -rf` leaves a stale
 * `.git/worktrees` entry in the repo under review); `rm` is `rm -rf`. A `worktree`/`rm` directory
 * outside the scratch root is refused, never deleted: a context that names one was not written by
 * this script. Idempotent — a directory already gone is success.
 * @param {{ dir?: string|null, worktreeParent?: string|null, cleanup?: string }} ws
 * @returns {{ ok: boolean, action: string, message: string }}
 */
export function cleanupWorkspace(ws) {
  const action = String(ws?.cleanup || "none");
  const dir = ws?.dir ? pathResolve(ws.dir) : "";
  if (action === "none" || !dir) return { ok: true, action: "none", message: "nothing to clean (cleanup: none)" };
  if (action !== "worktree" && action !== "rm") return { ok: false, action, message: `unknown cleanup ${JSON.stringify(action)} — refused` };
  const roots = [tmpdir()];
  try { roots.push(realpathSync(tmpdir())); } catch { /* keep the unresolved form */ }
  const inScratch = dir.includes("/.pr-reviewer-scratch/") || roots.some((r) => dir.startsWith(`${r}/`));
  if (!inScratch) return { ok: false, action, message: `${dir} is outside the scratch root — refused, nothing deleted` };
  if (!existsSync(dir)) return { ok: true, action, message: `${dir} already gone` };
  try {
    if (action === "worktree") {
      execFileSync("git", ["-C", dir, "worktree", "remove", "--force", dir], { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
      // workspace.md: `git worktree add` refused an existing path, so the parent is a mkdtemp dir
      // holding only the worktree, and its `run-*` parent holds only that. rmdir, never rm -rf.
      for (const d of [ws.worktreeParent, ws.worktreeParent ? dirname(ws.worktreeParent) : null]) {
        if (d && /\/(wt-[^/]+|run-[^/]+)$/.test(d)) { try { rmdirSync(d); } catch { /* not empty: leave it */ } }
      }
    } else {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (e) {
    return { ok: false, action, message: `${action} cleanup of ${dir} failed: ${String(/** @type {any} */ (e)?.stderr || /** @type {any} */ (e)?.message || e).trim().slice(0, 200)}` };
  }
  return { ok: !existsSync(dir), action, message: existsSync(dir) ? `${dir} still exists after ${action}` : `removed ${dir} (${action})` };
}

async function materializeWorkspace({ repo, number, headSha, timeoutMs, anomalies, isolated = false, repoDir = null }) {
  // Rung 0's local clone. `--repo-dir` names it explicitly; otherwise it is the process's own cwd,
  // which is only right when the caller happens to run inside a clone of the PR's repo — a
  // `review-loop` session started in another repo skipped rung 0 and fell to the network rungs.
  const cloneCwd = repoDir ? pathResolve(repoDir) : process.cwd();
  if (repoDir && !existsSync(cloneCwd)) anomalies.push(`workspace --repo-dir ${repoDir} does not exist — rung 0 skipped`);
  const originRepo = repoDir && !existsSync(cloneCwd) ? null : await currentRepoSlug(cloneCwd);
  if (repoDir && originRepo && originRepo.toLowerCase() !== repo.toLowerCase()) {
    anomalies.push(`workspace --repo-dir ${repoDir} is a clone of ${originRepo}, not ${repo} — rung 0 skipped`);
  }
  const cloneTimeoutMs = Math.max(timeoutMs, CLONE_TIMEOUT_FLOOR_MS);

  // A/B round 2 item 1(b): every worktree this ladder can create lands under ONE run-scoped
  // scratch directory, generated fresh per `materializeWorkspace()` call. Under `--isolated`
  // this is what makes reuse impossible across separate runs — a sibling run's `wt-XXXX` never
  // falls under THIS run's own `run-<id>/` prefix, however identical the PR/head/repo are.
  const runScratchDir = join(scratchRoot(), `run-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Rung 0 — worktree over the local object store.
  if (originRepo && originRepo.toLowerCase() === repo.toLowerCase()) {
    // Reuse before creating. This script is re-run — a retry, a second pass, a
    // re-review on the same head — and a fresh `worktree add` per run leaves the
    // parent repo carrying one registered worktree per invocation. Reusing one
    // already checked out at this exact head is also the only disposal-safe
    // answer: the reused one is not ours to remove, so it is `cleanup: none`.
    //
    // `--isolated` narrows this: D10 (A/B round 2) observed one isolated run reuse a WORKTREE
    // ANOTHER RUN (arm B) had created, because reuse scanned every worktree registered against
    // the shared repo with no notion of which run made which — breaking `--isolated`'s own
    // independence promise. `runScratchDir` below is this scoping.
    const existing = await findWorktreeAt(headSha, { isolated, runScratchDir, cwd: cloneCwd });
    if (existing) {
      return {
        dir: existing,
        worktreeParent: null,
        depthCapability: "checkout",
        rung: "0 (reused an existing worktree at this head)",
        cleanup: "none",
      };
    }

    // A clone that already has the head commit needs no fetch: on dash0 the `pull/<n>/head`
    // fetch cost 2.6 s of a 14.7 s workspace phase for a commit that was already local.
    const present = await run("git", ["cat-file", "-e", `${headSha}^{commit}`], { timeoutMs, cwd: cloneCwd });
    const fetched = present.ok ? present : await run(
      "git",
      [...GIT_CREDENTIAL_ARGS, "fetch", "-q", "origin", `pull/${number}/head`],
      { timeoutMs, cwd: cloneCwd, env: GIT_NONINTERACTIVE_ENV },
    );
    if (fetched.ok) {
      mkdirSync(runScratchDir, { recursive: true });
      const parent = mkdtempSync(join(runScratchDir, "wt-"));
      const dir = join(parent, "w");
      const added = await run("git", ["worktree", "add", "--detach", dir, headSha], { timeoutMs, cwd: cloneCwd });
      if (added.ok) {
        return {
          dir,
          worktreeParent: parent,
          depthCapability: "checkout",
          rung: "0 (worktree over local object store, full history)",
          cleanup: "worktree",
        };
      }
      anomalies.push(`workspace rung 0 failed: ${describeFailure(added, timeoutMs)}`);
    } else {
      anomalies.push(`workspace rung 0 skipped: could not fetch pull/${number}/head`);
    }
  }

  // Rung 1 — shallow, partial clone of the head ref. `--filter=blob:none` (trees/commits eagerly,
  // blob content lazily) and a >= 300s timeout floor — see CLONE_TIMEOUT_FLOOR_MS's docstring.
  const cloneDir = mkdtempSync(join(scratchRoot(), "clone-"));
  const cloned = await run(
    "git",
    [...GIT_CREDENTIAL_ARGS, "clone", "-q", "--filter=blob:none", "--depth", "50", `https://github.com/${repo}.git`, cloneDir],
    { timeoutMs: cloneTimeoutMs, env: GIT_NONINTERACTIVE_ENV },
  );
  if (cloned.ok) {
    await run("git", [...GIT_CREDENTIAL_ARGS, "fetch", "-q", "--depth", "50", "origin", `pull/${number}/head`], {
      timeoutMs: cloneTimeoutMs,
      cwd: cloneDir,
      env: GIT_NONINTERACTIVE_ENV,
    });
    const co = await run("git", ["checkout", "-q", "--detach", headSha], { timeoutMs, cwd: cloneDir });
    if (co.ok) {
      return {
        dir: cloneDir,
        worktreeParent: null,
        depthCapability: "checkout",
        rung: "1 (shallow clone, 50 commits)",
        cleanup: "rm",
      };
    }
    anomalies.push(`workspace rung 1 checkout failed: ${describeFailure(co, timeoutMs)}`);
  } else {
    anomalies.push(`workspace rung 1 clone failed: ${describeFailure(cloned, cloneTimeoutMs)}`);
  }

  // Rung 2 — tarball at the head. Same extended timeout floor as rung 1 ("apply the same to the
  // tarball rung", A/B round 2 item 1(a)) — a tarball fetch of the same repo is no smaller than
  // the clone it falls back from, and the old 120s-floor-less timeout starved it identically.
  const tarDir = mkdtempSync(join(scratchRoot(), "tar-"));
  const tarball = join(tarDir, "head.tgz");
  const got = await runToFile("gh", ["api", `repos/${repo}/tarball/${headSha}`], tarball, { timeoutMs: cloneTimeoutMs });
  if (got.ok && got.bytes > 0) {
    const untarred = await run("tar", ["-xzf", tarball, "-C", tarDir, "--strip-components", "1"], { timeoutMs });
    if (untarred.ok) {
      return {
        dir: tarDir,
        worktreeParent: null,
        depthCapability: "tarball",
        rung: "2 (tarball at head, no git history)",
        cleanup: "rm",
      };
    }
    anomalies.push(`workspace rung 2 untar failed: ${describeFailure(untarred, timeoutMs)}`);
  } else if (!got.ok) {
    anomalies.push(`workspace rung 2 tarball fetch failed: ${describeFailure(got, cloneTimeoutMs)}`);
  }
  anomalies.push("workspace ladder exhausted — DEPTH_CAPABILITY=diff-only, tier capped at standard");

  // A failed ladder is not a failed run.
  return { dir: null, worktreeParent: null, depthCapability: "diff-only", rung: "none", cleanup: "none" };
}

/**
 * A/B round 2 item 1(b): pure predicate behind rung-0 reuse. Not isolated — any matching
 * worktree in the repo is fair game (today's behaviour, a retry/re-review reusing its own prior
 * checkout). Isolated — only a directory that falls under THIS run's own `runScratchDir` may be
 * reused; a null `runScratchDir` (nothing bound yet) fails closed to "never reuse", never to
 * "reuse anything".
 * @param {string} dir @param {{ isolated?: boolean, runScratchDir?: string|null }} opts
 * @returns {boolean}
 */
export function isReusableWorktreeDir(dir, { isolated = false, runScratchDir = null } = {}) {
  if (!isolated) return true;
  if (!runScratchDir) return false;
  const normalizedDir = pathResolve(dir);
  const normalizedRoot = pathResolve(runScratchDir);
  return normalizedDir === normalizedRoot || normalizedDir.startsWith(`${normalizedRoot}/`);
}

/**
 * Find an existing worktree already checked out at `sha`.
 *
 * Parses `git worktree list --porcelain`, whose records are blank-line
 * separated and whose `HEAD` line carries the full 40-char OID. The main
 * worktree is excluded: reviewing inside it would put the review in the tree the
 * user is sitting in, and disposal there is never ours.
 */
async function findWorktreeAt(sha, { isolated = false, runScratchDir = null, cwd = process.cwd() } = {}) {
  if (!sha) return null;
  const r = await run("git", ["worktree", "list", "--porcelain"], { timeoutMs: 10000, cwd });
  if (!r.ok) return null;
  let dir = null;
  let head = null;
  let detached = false;
  const records = [];
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      dir = line.slice(9).trim();
      head = null;
      detached = false;
    } else if (line.startsWith("HEAD ")) {
      head = line.slice(5).trim();
    } else if (line.trim() === "detached") {
      detached = true;
    } else if (line.trim() === "" && dir) {
      records.push({ dir, head, detached });
      dir = null;
    }
  }
  if (dir) records.push({ dir, head, detached });
  // records[0] is the main worktree; only the detached ones we could have made.
  const hit = records.slice(1).find((w) => w.detached && sameCommit(w.head, sha) && existsSync(w.dir)
    && isReusableWorktreeDir(w.dir, { isolated, runScratchDir }));
  return hit ? hit.dir : null;
}

async function currentRepoSlug(cwd = process.cwd()) {
  const r = await run("git", ["remote", "get-url", "origin"], { timeoutMs: 10000, cwd });
  if (!r.ok) return null;
  const m = r.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Bind TIER2_CHECKER from what the materialized workspace actually has.
 *
 * Presence of a manifest, not presence of a global binary: a repo without a
 * tsconfig gains nothing from a globally installed `tsc`, and claiming the rung
 * would make every Tier 2 receipt `unobtainable` at the moment it is needed.
 */
function detectTier2Checker(dir) {
  if (!dir) return null;
  const probes = [
    ["tsconfig.json", "tsc"],
    ["go.mod", "go vet"],
    ["Cargo.toml", "cargo check"],
    ["pyproject.toml", "pyright"],
  ];
  for (const [manifest, checker] of probes) {
    if (existsSync(join(dir, manifest))) return checker;
  }
  return null;
}

/* ------------------------------ review config ------------------------------ */

/**
 * Extract `high_stakes_paths:` from the review config, in the documented lookup
 * order. Entries are regexes in block-list form; everything from ` #` on is an
 * inline comment, which review-config.md's own worked example relies on.
 */
export function extraHighStakes(yamlText) {
  if (!yamlText) return [];
  const out = [];
  let inBlock = false;
  for (const raw of yamlText.split("\n")) {
    if (/^high_stakes_paths:/.test(raw)) {
      inBlock = true;
      continue;
    }
    if (inBlock && /^[^ \t]/.test(raw)) break;
    if (!inBlock) continue;
    const m = raw.match(/^\s*-\s*(.+)$/);
    if (!m) continue;
    const v = m[1].replace(/\s+#.*$/, "").replace(/"/g, "").trim();
    if (v) out.push(v);
  }
  return out;
}

/**
 * The three run-level Agent0 fix-link keys (review-config.md § Run-level fields), top-level only —
 * a nested or subtree key never governs the run. `fixLinks` is null when the key is absent, so
 * finalize.mjs can tell "said nothing" (buttons on) from "said false" (buttons off).
 */
export function agent0Config(yamlText) {
  const out = { fixLinks: null, environment: null, org: null };
  if (!yamlText) return out;
  for (const raw of yamlText.split("\n")) {
    const m = /^(agent0_fix_links|agent0_environment|agent0_org):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const v = m[2].replace(/\s+#.*$/, "").replace(/["']/g, "").trim();
    if (m[1] === "agent0_fix_links") out.fixLinks = v === "true" ? true : v === "false" ? false : null;
    else if (m[1] === "agent0_environment") out.environment = v || null;
    else out.org = v || null;
  }
  return out;
}

function readReviewConfig(dir) {
  if (!dir) return "";
  for (const p of [join(dir, ".github", "review.yaml"), join(dir, ".review.yaml")]) {
    if (existsSync(p)) {
      try {
        return readFileSync(p, "utf8");
      } catch {
        return "";
      }
    }
  }
  return "";
}

/* --------------------------------- main --------------------------------- */

async function prepare(opts) {
  const anomalies = [];
  const t0 = Date.now();
  const timing = new Timing();

  const fallbackRepo = opts.repo || (await currentRepoSlug());
  const ref = parsePrRef(opts.pr, fallbackRepo);
  if (!ref || !ref.number) {
    throw new Error(`could not resolve a PR reference from ${JSON.stringify(opts.pr)} — do not invent one`);
  }
  if (!ref.repo) {
    throw new Error("PR reference is a bare number and no repository could be resolved — pass --repo owner/repo");
  }
  const { repo, number } = ref;
  const [owner, name] = repo.split("/");
  const timeoutMs = opts.timeoutMs;

  const runMode = resolveRunMode({ isolated: opts.isolated, full: opts.full, statePath: opts.state || null });

  // `--review-sha` (D8/D9): live pr-diff / pr-checks / pulls-files are all tied to the
  // CURRENT head, not an arbitrary past commit, so a historical run skips them here and
  // fetches a compare-based equivalent below, once `review_sha` is verified against this
  // PR's own commit list — which is why `commits` rides the SAME metadata read rather than
  // a second round trip.
  const wantHistorical = Boolean(opts.reviewSha);

  // Step 1.1 — the five (six under --review-sha) fetches, concurrently. One await, one
  // moment in time.
  timing.start("fetch");
  const [metaR, diffR0, checksR0, reviewsR, commentsR, filesR0] = await Promise.all([
    ghJson(
      [
        "pr",
        "view",
        String(number),
        "--repo",
        repo,
        "--json",
        "title,body,headRefName,baseRefName,headRefOid,baseRefOid,author,additions,deletions,changedFiles,state,labels,isDraft,createdAt,url,commits",
      ],
      { timeoutMs },
    ),
    wantHistorical
      ? Promise.resolve({ ok: false, code: 0, stdout: "", stderr: "" })
      : run("gh", ["pr", "diff", String(number), "--repo", repo], { timeoutMs }),
    wantHistorical
      ? Promise.resolve({ ok: false, code: 0, stdout: "", stderr: "not-read (historical — gh pr checks reports the current head, not review_sha)" })
      : run("gh", ["pr", "checks", String(number), "--repo", repo], { timeoutMs }),
    ghNdjson(
      [
        "api",
        `repos/${owner}/${name}/pulls/${number}/reviews`,
        "--paginate",
        "--jq",
        '.[] | select(.state != "DISMISSED") | {user: .user.login, state: .state, body: .body, submitted_at: .submitted_at}',
      ],
      timeoutMs,
    ),
    ghNdjson(
      [
        "api",
        `repos/${owner}/${name}/issues/${number}/comments`,
        "--paginate",
        "--jq",
        ISSUE_COMMENTS_JQ,
      ],
      timeoutMs,
    ),
    wantHistorical ? Promise.resolve({ ok: false, error: null, value: [] }) : fetchFiles(repo, number, timeoutMs),
  ]);
  /** @type {any} */ let diffR = diffR0;
  /** @type {any} */ let checksR = checksReadable(checksR0) ? { ...checksR0, ok: true } : checksR0;
  /** @type {any} */ let filesR = filesR0;

  timing.end(); // fetch
  // Head/base binding, the --review-sha compare fetch, and identity — timed, so the trace shows it
  // rather than leaving an unexplained gap between `fetch` and `workspace`.
  timing.start("resolve");

  if (!metaR.ok) {
    throw new Error(`PR metadata unreadable for ${repo}#${number}: ${metaR.error}`);
  }
  const meta = metaR.value;

  // Bound from THIS response's headRefOid / baseRefOid — never from a second
  // read. One read, one head; the diff and the SHAs describe the same moment.
  const headSha = meta.headRefOid || "";
  const baseSha = meta.baseRefOid || "";
  if (!headSha) anomalies.push("headRefOid empty — every downstream consumer runs blind");
  if (!baseSha) anomalies.push("baseRefOid empty — merge-base and --base-ref both fail quietly; impact graph will be base-blind");

  // `--pin-head` comparability check (R3, D13). A mismatch is NOT an anomaly —
  // it is a hard stop, because an A/B or shadow run silently reviewing a
  // commit other than the one it was pinned to would poison every metric it
  // feeds. No review; no context is written.
  const pinCheck = verifyPinnedHead(opts.pinHead, headSha);
  if (!pinCheck.ok) {
    throw new Error(pinCheck.message);
  }

  // `--review-sha` (D8/D9): resolve the historical review target against this PR's own
  // commit list, then fetch the compare-based diff/files it needs in place of the
  // live-head fetches skipped above. `checkoutSha` is what the workspace ladder and the
  // impact graph materialize/diff against below — `headSha` above stays the LIVE head
  // throughout (still what `--pin-head` compares against, still what a non-historical
  // run's `context.headSha` reports).
  let historical = null;
  let checkoutSha = headSha;
  if (wantHistorical) {
    const commitShas = (meta.commits || []).map((/** @type {any} */ c) => c.oid).filter(Boolean);
    const verified = verifyReviewSha(opts.reviewSha, commitShas);
    if (!verified.ok) {
      throw new Error(`--review-sha ${opts.reviewSha}: ${verified.message}`);
    }
    checkoutSha = /** @type {string} */ (verified.resolved);
    historical = { ...historicalBlock({ reviewSha: checkoutSha }), live_head_sha: headSha };

    const compareRange = `${baseSha}...${checkoutSha}`;
    const [cDiff, cFiles] = await Promise.all([
      run("gh", ["api", "-H", "Accept: application/vnd.github.v3.diff", `repos/${repo}/compare/${compareRange}`], { timeoutMs }),
      ghNdjson(
        ["api", `repos/${repo}/compare/${compareRange}`, "--jq", ".files[] | {filename, patch, status, additions, deletions, sha}"],
        timeoutMs,
      ),
    ]);
    diffR = cDiff;
    filesR = cFiles;
  }

  if (!filesR.ok) anomalies.push(`patch list unreadable: ${filesR.error}`);
  if (!checksR.ok && !wantHistorical) anomalies.push("gh pr checks unreadable — CI state is informational only, so this never grades");
  if (!reviewsR.ok) anomalies.push(`prior reviews unreadable: ${reviewsR.error}`);
  if (!commentsR.ok) anomalies.push(`issue comments unreadable: ${commentsR.error} — prior-run detection degrades to first run`);

  const files = filesR.value || [];
  // pulls/{n}/files is paginated and capped at 3000: a short list would make the delta's PR-file
  // restriction drop authored files, so it is reported and the restriction is relaxed.
  const prFilesState = wantHistorical || !filesR.ok ? { complete: false, note: null } : prFilesCompleteness(files.length, meta.changedFiles, filesR.error);
  if (prFilesState.note) anomalies.push(prFilesState.note);
  const { diffable, undiffable } = partitionUndiffable(files);
  const comments = commentsR.value || [];
  const sticky = findSticky(comments);
  if (sticky && sticky.duplicates > 0) {
    anomalies.push(`${sticky.duplicates + 1} sticky comments found — there must only ever be one`);
  }

  // `--isolated` (R3, D13, pipeline.md § --isolated item 1): first-run semantics on
  // EVERY invocation, with NO fallback to the sticky's footer SHA either — that
  // fallback is itself a form of carried state, and an A/B / shadow run that read
  // it would silently compute a polluted delta against whatever a PRIOR run in the
  // series (or, worse, an entirely earlier review of the same PR) left behind. A
  // sticky can still EXIST on the PR (duplicate-sticky detection above still runs),
  // but under `--isolated` this run never treats it as a prior run to diff against.
  const state = readStateFile(runMode.stateIgnored ? null : (opts.state || null));
  const { priorSha, zeroDelta } = resolvePriorRun({
    isolated: runMode.isolated,
    stickyBody: sticky ? sticky.body : null,
    headSha,
    statePriorSha: state.priorSha,
  });

  // Step 0.5 — review relation. Never from `gh api /user`: it is not repo-scoped
  // and 401s under an installation token, which is an ordinary hosted setup.
  // A/B iteration 4: validated, never trusted. Round 6 on sync-tray#72 passed a 401 JSON error
  // body as `--reviewer-login` (the agent body's `ME=$(gh api user … || echo "")` captures gh's
  // stdout error payload, then appends the empty fallback) and this script accepted it as a login.
  // Anything that is not a GitHub login shape is treated as unknown, and says so.
  const identityInput = identityInputs({ opts, state, sticky, isolated: runMode.isolated });
  const { suppliedLogin } = identityInput;
  const { me, identitySource } = resolveReviewerIdentity(identityInput);
  const authorLogin = meta.author?.login || "";
  const reviewRelation = me ? (normalizeLogin(me) === normalizeLogin(authorLogin) ? "self" : "cross") : "cross";
  if (suppliedLogin && !isGithubLogin(suppliedLogin)) {
    anomalies.push(
      `reviewer login rejected — ${JSON.stringify(String(suppliedLogin).slice(0, 40))} is not a GitHub login; ${me ? `identity taken from ${identitySource === "state-record" ? "the state record's bot_login" : "the prior report's author"}` : "relation defaulted to cross"}`,
    );
  } else if (!me) {
    anomalies.push(
      "reviewer identity unknown (no --reviewer-login / PR_REVIEWER_LOGIN; /user 401s here) — relation defaulted to cross",
    );
  }

  // Step 1.1b — the workspace ladder. `checkoutSha` is `headSha` on a live run and
  // `review_sha` on a historical one (D9) — the impact graph below diffs whatever this
  // workspace is checked out to, so materializing it at the historical target is the whole
  // fix for "merge-base impact graph": build-impact-graph.mjs needs no separate awareness
  // of `--review-sha` at all.
  timing.start("workspace");
  let workspace = { dir: null, worktreeParent: null, depthCapability: "diff-only", rung: "skipped", cleanup: "none" };
  if (opts.workspace && checkoutSha) {
    workspace = opts.workdir
      ? { dir: opts.workdir, worktreeParent: null, depthCapability: "checkout", rung: "caller-supplied", cleanup: "none" }
      : await materializeWorkspace({ repo, number, headSha: checkoutSha, timeoutMs, anomalies, isolated: runMode.isolated, repoDir: opts.repoDir || null });
  }
  const tier2Checker = detectTier2Checker(workspace.dir);
  timing.end(); // workspace

  // Write the patch list where the two existing scripts expect to read it, and
  // park the other bulk payloads beside it.
  //
  // The context is an INDEX, not an archive. Embedding the diff text, every
  // file's patch and the whole impact graph in it produced a 250 KB JSON — which
  // the model then pays for in full on a run whose first question is "how big is
  // the delta". Each bulk payload gets its own sidecar and the context carries
  // its path plus a summary, so a step reads only what that step needs.
  // `--inline-payloads` restores the single-blob form for a caller that wants it.
  const outPath = pathResolve(opts.out);
  const sidecarDir = dirname(outPath);
  // Create it. `--out` names a file in a directory the caller has not
  // necessarily made, and the first write into it is a sidecar rather than the
  // context itself — so an absent directory surfaced as
  // `ENOENT … open '<dir>/pr-files.json'`, which reads as a missing INPUT
  // (the patch list the two downstream scripts consume) rather than as an
  // absent output directory. Observed on the first run against a repo whose
  // review directory did not already exist from an earlier invocation.
  mkdirSync(sidecarDir, { recursive: true });
  const prFilesPath = join(sidecarDir, "pr-files.json");
  const diffPath = join(sidecarDir, "pr-diff.patch");
  const impactPath = join(sidecarDir, "impact.json");
  const undiffablePath = join(sidecarDir, "pr-undiffable-paths.json");
  writeFileSync(prFilesPath, files.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
  if (diffR.ok) writeFileSync(diffPath, diffR.stdout, "utf8");
  writeFileSync(undiffablePath, JSON.stringify(undiffable, null, 2), "utf8");

  // Shape classification — a pure local computation, no API calls.
  timing.start("classify-shape");
  let shape = null;
  const reviewConfigText = readReviewConfig(workspace.dir);
  const hsArgs = extraHighStakes(reviewConfigText).flatMap((r) => ["--extra-high-stakes", r]);
  const classify = await run("node", [join(HERE, "classify-shape.mjs"), prFilesPath, ...hsArgs], { timeoutMs });
  if (classify.ok) {
    try {
      shape = JSON.parse(classify.stdout);
    } catch {
      anomalies.push("shape classifier returned unparseable output — depth routing degrades to size-only");
    }
  } else {
    anomalies.push(`shape classifier failed: ${(classify.stderr || "").trim().slice(0, 200)}`);
  }
  timing.end(); // classify-shape

  // Phase B — the impact graph. A script invocation, never a judgment call.
  timing.start("impact-graph");
  let impact = null;
  if (opts.impact && workspace.dir && baseSha) {
    const graphArgs = [
      join(HERE, "build-impact-graph.mjs"),
      prFilesPath,
      "--workdir",
      workspace.dir,
      "--base-ref",
      baseSha,
      "--repo",
      repo,
      "--pr",
      String(number),
    ];
    const built = await run("node", graphArgs, { timeoutMs: Math.max(timeoutMs, 180000), cwd: workspace.dir });
    if (built.ok) {
      try {
        impact = JSON.parse(built.stdout);
        writeFileSync(impactPath, JSON.stringify(impact, null, 2), "utf8");
      } catch {
        anomalies.push("impact graph returned unparseable output — Phase C loses blast_radius as an input");
      }
    } else {
      anomalies.push(`impact graph failed: ${(built.stderr || "").trim().slice(0, 300)}`);
    }
  } else if (opts.impact) {
    anomalies.push(
      `impact graph skipped — ${!workspace.dir ? "no materialized workspace" : "no baseSha"}; Phase B is unavailable, not clean`,
    );
  }
  timing.end(); // impact-graph
  timing.start("packet");

  // A/B iteration 4 (speed): the review packet — the PR description, a priority-ordered file
  // index, and every hunk widened against the head file with head line numbers — so a finder or
  // verifier reads one file instead of the raw diff plus a dozen workspace reads
  // (review-packet.mjs). Deterministic and never a gate: a failure is an anomaly, and the diff
  // sidecar is still there.
  const packetPath = join(sidecarDir, "review-packet.md");
  let packet = null;
  try {
    const packetInput = {
      title: meta.title, body: meta.body, repo, number, headSha: checkoutSha, files,
      consumers: consumersByFile(impact), workspaceDir: workspace.dir || null,
    };
    const built = buildReviewPacket(packetInput);
    writeFileSync(packetPath, built.text, "utf8");
    packet = { path: packetPath, lines: built.lines, files: built.files, maxLines: built.maxLines, contextLines: built.contextLines };
  } catch (e) {
    anomalies.push(`review packet not built: ${String(e && e.message || e).slice(0, 200)} — read the diff sidecar instead`);
  }

  // A/B iteration 4 (speed): Step 1.7b's two halves as functions (discover-standards.mjs) — the
  // TRIVIAL_SKIP conditions and Source-1 standards discovery with normative-line extraction. The
  // full bullet list is a sidecar; the context carries the summary Step 1.7b announces.
  timing.start("standards");
  let trivial = null;
  try {
    trivial = trivialSkip({ files, highStakesFiles: (shape && shape.high_stakes_files) || [] });
  } catch (e) {
    anomalies.push(`trivial-skip not evaluated: ${String(e && e.message || e).slice(0, 200)}`);
  }
  const standardsPath = join(sidecarDir, "standards.json");
  let standards = null;
  if (workspace.dir) {
    try {
      const found = discoverStandards({ root: workspace.dir, changed: files.map((f) => f.filename) });
      writeFileSync(standardsPath, JSON.stringify(found, null, 2), "utf8");
      standards = {
        path: standardsPath, docs: found.docs.map((d) => ({ path: d.path, bullets: d.bullets.length })),
        bulletCount: found.bulletCount, chars: found.chars, capChars: found.capChars, dropped: found.dropped,
        reviewConfigStandards: found.reviewConfigStandards, announce: found.announce,
      };
    } catch (e) {
      anomalies.push(`standards discovery not run: ${String(e && e.message || e).slice(0, 200)} — Step 1.7b falls back to the manual walk`);
    }
  }

  // Delta triage + Phase C depth routing + Gate 4 pre-candidates (D10). Depth
  // routing binds EVERY run's tier (agents/pr-reviewer.md § "Bind DEPTH_TIER
  // … all modes, including full and zero-delta"); delta TRIAGE itself (the
  // compare/blob-diff route below) applies only when there is a real prior
  // run to diff against — a genuine first run or --full has no PRIOR_SHA to
  // triage against, so "the delta" collapses to the full PR, exactly as
  // RUN_MODE=full's REVIEW_DIFF is the full PR diff.
  timing.start("triage-routing");

  // `--isolated` (pipeline.md § --isolated item 1) ignores any `--state` path
  // unconditionally (`resolveRunMode`'s `stateIgnored`) — a caller-supplied state
  // file is itself carried state from a prior run, exactly the class of input an
  // isolated comparability run must not depend on.
  if (!opts.state && !runMode.isolated) {
    anomalies.push(
      "no --state file supplied — routing computed with lastFullSha=none, incrRunsSinceFull=0 " +
        "(forces the D6 'no prior deep pass on record' trigger every run); pass --state after " +
        "reading the LoreKit state record for an accurate routing decision",
    );
  } else if (runMode.stateIgnored) {
    anomalies.push(
      "--isolated ignores --state (first-run semantics on every invocation, per pipeline.md § --isolated) " +
        "— routing computed with lastFullSha=none, incrRunsSinceFull=0",
    );
  }

  // The graphql reviewThreads read — every mode, always: THREAD_OVERLAP needs
  // it even on a full run, and the context's threads[] field is a caller
  // input regardless of tier.
  // The threads read and both compares are independent GitHub calls; they run concurrently and
  // are awaited where each result is needed (5.7 s of sequential calls on dash0#20655).
  const threadsRead = opts.threads !== false ? fetchReviewThreads(owner, name, number, timeoutMs) : null;
  const hasPriorRun = !!priorSha && !zeroDelta && !runMode.full;
  const deltaCompare = hasPriorRun ? compareRange(repo, priorSha, headSha, DELTA_COMPARE_JQ, "{status, ahead_by, behind_by}", timeoutMs) : null;
  const churnCompare = hasPriorRun && state.lastFullSha ? compareRange(repo, state.lastFullSha, headSha, CHURN_COMPARE_JQ, "{status, behind_by}", timeoutMs) : null;
  let threads = [];
  if (threadsRead) {
    const tr = await threadsRead;
    threads = buildThreads(tr.nodes);
    if (!tr.complete) {
      anomalies.push("review threads read incomplete — THREAD_OVERLAP and open-thread data may undercount");
    }
    // `--review-sha` (D9): never read the future — only threads (and replies) that existed at
    // the reviewed commit's committer date survive into THREAD_OVERLAP and context.threads[].
    if (historical) {
      const ht = historicalThreads({ threads, commits: meta.commits || [], reviewSha: historical.review_sha });
      threads = ht.threads;
      historical = { ...historical, threads_created_as_of: ht.asOf };
      if (ht.anomaly) anomalies.push(ht.anomaly);
    }
  }

  let deltaFiles = diffable.length ? files.filter((f) => diffable.includes(f.filename)) : files;
  /** @type {string} */ let deltaRoute = hasPriorRun ? "full-pr" : "none";
  // Checkouts that may hold both SHAs for the truncation-immune local-git delta: the materialized
  // workspace (rung 0 worktree / caller --workdir), then the --repo-dir clone.
  const localGitDirs = [workspace.depthCapability === "checkout" ? workspace.dir : null, opts.repoDir ? pathResolve(opts.repoDir) : null];
  let deltaShape = shape;
  let deltaCountsResult = { deltaLines: deltaLines(files), newFiles: files.filter((f) => f.status === "added").length };
  let cumDeltaLines = 0;

  // `priorSha` is already null under `--isolated` (above), so this is naturally false
  // there too — `runMode.full` (not the raw `opts.full`) so a plain `--full` (no
  // `--isolated`) gets the same treatment.
  if (hasPriorRun) {
    const cmp = await /** @type {Promise<any>} */ (deltaCompare);
    if (cmp.ok) {
      const divergence = classifyDivergence(cmp.value);
      if (divergence === "intact") {
        if (Array.isArray(cmp.value.files)) {
          // An intact range is not proof the list is the author's delta: a head that merges the
          // base in stays `ahead` while sweeping in the base's files, and GitHub cuts the list at
          // 300 — on dash0#20655 the authored files were the ones cut off. A truncated or polluted
          // list is REPLACED (local git, else blob route), never filtered (resolveIntactDelta).
          const resolved = await resolveIntactDelta({
            compareFiles: cmp.value.files,
            prFiles: files,
            history: compareHistory(cmp.value),
            readLocal: () => localAuthoredDelta({ dirs: localGitDirs, from: /** @type {string} */ (priorSha), to: headSha, baseSha, prFiles: files, prFilesComplete: prFilesState.complete, timeoutMs }),
            readPriorTree: async () => {
              const tree = await ghJson(
                ["api", `repos/${repo}/git/trees/${priorSha}?recursive=1`, "--jq", '[.tree[] | select(.type == "blob") | {path, sha}]'],
                { timeoutMs },
              );
              return tree.ok ? { ok: true, tree: tree.value || [] } : { ok: false, reason: String(tree.error) };
            },
          });
          deltaFiles = resolved.files;
          deltaRoute = resolved.route;
          if (resolved.anomaly) anomalies.push(resolved.anomaly);
        } else {
          anomalies.push(`delta compare fetch failed: ${cmp.filesError} — falling back to full-PR delta`);
        }
      } else {
        // Diverged history — the blob-SHA authored delta, rebase-immune.
        if (files.every((f) => f.sha)) {
          const tree = await ghJson(
            ["api", `repos/${repo}/git/trees/${priorSha}?recursive=1`, "--jq", '[.tree[] | select(.type == "blob") | {path, sha}]'],
            { timeoutMs },
          );
          if (tree.ok) {
            deltaFiles = blobDelta(files, tree.value || []);
            deltaRoute = "blob-diff";
          } else {
            anomalies.push(`diverged-history tree read failed: ${tree.error} — upgrading to full-PR delta, never trusting the diverged compare`);
          }
        } else {
          anomalies.push("pr-files rows missing sha — diverged-history blob diff unavailable, upgrading to full-PR delta");
        }
      }
    } else {
      anomalies.push(`divergence pre-check failed: ${cmp.error} — falling back to full-PR delta`);
    }

    deltaCountsResult = deltaCounts(deltaFiles);

    // Re-classify shape over the delta file list specifically — the full-PR
    // shape can carry risky content the delta itself never touches.
    if (deltaFiles.length) {
      const deltaFilesPath = join(sidecarDir, "pr-delta.json");
      writeFileSync(deltaFilesPath, deltaFiles.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
      const deltaClassify = await run("node", [join(HERE, "classify-shape.mjs"), deltaFilesPath, ...hsArgs], { timeoutMs });
      if (deltaClassify.ok) {
        try {
          deltaShape = JSON.parse(deltaClassify.stdout);
        } catch {
          anomalies.push("delta shape classifier returned unparseable output — depth routing degrades to the full-PR shape");
        }
      } else {
        anomalies.push(`delta shape classifier failed: ${(deltaClassify.stderr || "").trim().slice(0, 200)}`);
      }
    } else {
      deltaShape = { shapes: [], risky: false, risky_shapes: [], high_stakes_files: [], propagation: false };
    }

    // Cumulative churn since the last full pass (deep-lens refresh, D4/D5/D6).
    if (churnCompare) {
      const cum = await churnCompare;
      if (cum.ok) {
        let cumLines = 0;
        if (classifyDivergence(cum.value) === "intact") {
          if (Array.isArray(cum.value.files)) {
            const churn = await resolveChurnLines({
              perFile: cum.value.files,
              prFiles: files,
              history: compareHistory(cum.value),
              readLocal: () => localAuthoredDelta({ dirs: localGitDirs, from: /** @type {string} */ (state.lastFullSha), to: headSha, baseSha, prFiles: files, prFilesComplete: prFilesState.complete, timeoutMs }),
            });
            cumLines = churn.lines;
            if (churn.anomaly) anomalies.push(churn.anomaly);
          } else {
            cumLines = FULL_REFRESH_DELTA + 1;
          }
        }
        cumDeltaLines = churnState({ hasLastFull: true, meta: cum.value, deltaLinesIfIntact: cumLines });
      } else {
        anomalies.push(`cumulative-churn compare failed: ${cum.error} — treated as over the refresh threshold`);
        cumDeltaLines = FULL_REFRESH_DELTA + 1;
      }
    }
  }

  const threadOverlap = computeThreadOverlap(deltaFiles, threads);

  const routing = routeDepth({
    // D1's first-run trigger must fire on EVERY `--isolated` invocation (pipeline.md §
    // --isolated item 2), regardless of whether a sticky happens to already exist on
    // the PR from an earlier, non-comparability review — `!sticky` alone missed exactly
    // that case (a re-review of an already-reviewed PR run under `--isolated`).
    // A state record with runs is a prior review even when no sticky carries the marker
    // (dash0#20655's sticky held a file path, not a report, and D1 fired on its seventh run).
    firstRun: runMode.isolated || (!sticky && !state.priorSha),
    full: runMode.full,
    effortHigh: opts.effort === "high",
    cumDeltaLines,
    incrRunsSinceFull: state.incrRunsSinceFull,
    priorDeepRecorded: !!state.lastFullSha,
    highStakesFiles: (deltaShape && deltaShape.high_stakes_files) || [],
    propagation: !!(deltaShape && deltaShape.propagation),
    band: impact?.blast_radius?.band ?? "none",
    semverDeltas: (impact?.dependencies || []).map((d) => ({ delta: d.semver_delta, usageSites: (d.usage_sites || []).length })),
    symbols: (impact?.symbols || []).map((s) => ({ traffic_band: s.production?.traffic_band ?? "unknown", change: s.change })),
    deltaLines: deltaCountsResult.deltaLines,
    newFiles: deltaCountsResult.newFiles,
    deltaShapes: (deltaShape && deltaShape.shapes) || [],
    deltaRiskyShapes: (deltaShape && deltaShape.risky_shapes) || [],
    sameSymbolOverlap: (impact?.overlaps || []).some((o) => o.kind === "same-symbol"),
    threadOverlap,
    depthCapability: workspace.depthCapability,
  });

  // resolveBudget() layers the continuous thoroughness knob on top of the routed tier
  // (depth-routing.md § Thoroughness budget). This script cannot know whether the agent
  // reading this context holds `Task`, so `budget.topology` here assumes dispatch IS
  // available — the agent re-derives it as `dispatchAvailable ? budget.topology :
  // "in-context"` and logs RUN_ANOMALY when that downgrades it
  // (dispatch-topology.md § Reading a budget into dispatch).
  const thoroughnessOverride = opts.thoroughness === "" ? undefined : Number(opts.thoroughness);
  const contextMode = resolveContextMode({ runMode, zeroDelta, routing });
  const budget = resolveBudget({
    runMode: contextMode, // a small incremental re-review skips the intent worker (route-depth.mjs SMALL_INCREMENTAL_MODES)
    thoroughness: thoroughnessOverride,
    routedTier: routing.tier,
    shape: (deltaShape && deltaShape.shapes) || [],
    band: impact?.blast_radius?.band ?? "none",
    depthCapability: workspace.depthCapability,
    effortHigh: opts.effort === "high",
    changedFiles: files.length,
  });

  // Item 3: a capability-deactivated finder is exactly the class of "something changed what this
  // run actually reviewed" RUN_ANOMALY exists for — folded into the same anomalies[] every other
  // workspace/routing degrade already flows through, rather than a second, easy-to-miss channel.
  for (const note of budget.capabilityNotes) anomalies.push(note);

  const gate4Precandidates = scanGate4(deltaFiles);

  timing.end(); // triage-routing

  const context = {
    v: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "prepare-review.mjs",
    elapsedMs: Date.now() - t0,
    timing: timing.block(),
    isolated: runMode.isolated,
    runMode,
    // finalize.mjs reads a top-level `mode` (RUN.mode for the renderer) — this is that field,
    // derived from runMode and the routed tier (resolveContextMode). Without it, finalize.mjs's
    // `context?.mode` fallback silently renders "unknown", which is not a member of
    // render-report.mjs's VALID_MODES and fails closed only at render time, not here.
    mode: contextMode,

    // What the caller must still do itself. Stated in the artifact, not only in
    // the docs, so a consumer cannot read a partial context as a complete one.
    notCovered: [
      runMode.isolated
        ? "LoreKit reads — Step 0.7 (the state record) is SKIPPED entirely under --isolated, and priorSha below is null (pipeline.md § --isolated). Steps 1.0/1.2c/1.2d (codebase-knowledge/lesson reads) are NOT skipped by --isolated — those are project memory, not run-comparability state, and persist by design across PRs and across runs; a comparability run (A/B, shadow) that wants a clean memory baseline must arrange that itself, --isolated does not guarantee it."
        : priorShaProvenance({ fromState: !!state.priorSha }).loreKitNotCovered,
      "routing{} below is only as accurate as the --state file the caller passed — no --state means lastFullSha/incrRunsSinceFull default to none/0 (see anomalies[] when this fired)",
      "Phases D and E, Steps 2.4*, 2.7, 2.9c — the Gate 4 SCAN below is mechanical pre-candidates only; confirm/exempt disposition and any AI-stub findings are judgment",
      "every write: the sticky, the review, the state record",
      "files[].patch — stripped from the inline context (see `inline`) to keep the context an index, not an archive; the full per-file patch text lives in the `paths.files` sidecar (pr-files.json, one JSON object per line), which is what a consumer needing to anchor a line (finalize.mjs's line-validity pre-flight) must read, never context.files itself unless --inline-payloads was passed",
    ],

    target: { repo, owner, name, number, url: meta.url || `https://github.com/${repo}/pull/${number}` },
    meta: {
      title: meta.title,
      body: meta.body,
      state: meta.state,
      isDraft: meta.isDraft,
      author: authorLogin,
      headRefName: meta.headRefName,
      baseRefName: meta.baseRefName,
      labels: (meta.labels || []).map((l) => l.name),
      additions: meta.additions,
      deletions: meta.deletions,
      changedFiles: meta.changedFiles,
      createdAt: meta.createdAt,
    },
    // `headSha` is the SHA under review — `checkoutSha` on every run, which equals the LIVE
    // head unless `--review-sha` is set (D8/D9), in which case `historical.live_head_sha`
    // below still carries the live head for reference. Every downstream consumer (the
    // renderer's "reviewed for commit" footer, line-validity, the impact graph) reads THIS
    // field, never `headRefOid` directly, so a historical run's report never claims to have
    // reviewed a commit it did not.
    headSha: checkoutSha,
    baseSha,
    historical,
    reviewRelation,
    reviewerLogin: me || null,
    identitySource,
    // Read by finalize.mjs, which builds the Fix-with-Agent0 links (finalize/fix-links.mjs).
    agent0: agent0Config(reviewConfigText),

    // Bulk payloads live on disk; the context names them. `inline` says which
    // form this context is in, so a consumer never has to guess whether a null
    // `diff.text` means "empty diff" or "parked in a sidecar".
    inline: opts.inlinePayloads,
    paths: {
      files: prFilesPath,
      diff: diffR.ok ? diffPath : null,
      impact: impactPath,
      undiffable: undiffablePath,
      packet: packet ? packetPath : null,
      standards: standards ? standardsPath : null,
    },
    packet,
    trivialSkip: trivial,
    standards,
    diff: {
      path: diffR.ok ? diffPath : null,
      bytes: diffR.ok ? Buffer.byteLength(diffR.stdout) : 0,
      readable: diffR.ok,
      text: opts.inlinePayloads && diffR.ok ? diffR.stdout : null,
    },
    files: opts.inlinePayloads ? files : files.map(({ patch, ...rest }) => rest),
    filesPath: prFilesPath,
    // The changed files this run reviews — the delta on an incremental run, the PR's diffable files
    // on a full one, none on zero-delta. finalize.mjs counts judgments.scanned_files against it for
    // the report's `Checked` line, so a file outside the scope can never inflate "N of M read".
    scopePaths: contextMode === "zero-delta" ? [] : deltaFiles.map((f) => f.filename),
    diffablePaths: diffable,
    undiffablePaths: undiffable,
    // The delta's own count on an incremental run (what RUN.delta_lines renders as "N lines in
    // delta"); the full-PR count otherwise — deltaCountsResult is initialised to it.
    deltaLines: deltaCountsResult.deltaLines,
    // Which route produced the incremental delta: compare | local-git | blob-diff | full-pr | none.
    deltaRoute,

    checks: { raw: checksR.ok ? checksR.stdout.trim() : null, readable: checksR.ok },
    reviews: reviewsR.value || [],
    issueComments: comments,

    priorRun: {
      // Under `--isolated`, `source` reports "none" even when a sticky physically exists on
      // the PR (from an earlier, non-comparability review) — `priorSha`/`zeroDelta` above are
      // already nulled/false for the same reason. `stickyCommentId`/`stickyUrl`/`stickyKind`
      // stay populated regardless: they identify WHERE a dry-run's rehearsed write would target,
      // which is a different concern from "is this a prior run to diff against" and carries no
      // judgment-affecting state. Because that target is the LIVE report, finalize.mjs refuses an
      // --isolated context without --dry-run and marks the plan `isolated`, which
      // execute-write-plan.mjs refuses on its own (A/B round 3; rules/pipeline.md § --isolated).
      source: runMode.isolated ? "none" : state.priorSha ? "state-record" : (sticky ? "github-fallback-rung" : "none"),
      // The record's id when no marker was found: a real run then PATCHes that comment — which
      // repairs a sticky whose body lost its marker — instead of posting a second report. A comment
      // deleted since the record was written 404s that PATCH, and execute-write-plan.mjs recreates
      // the full report with a POST rather than falling back to the pointer.
      stickyCommentId: sticky ? sticky.id : (runMode.isolated ? null : state.stickyCommentId ?? null),
      stickyUrl: sticky ? sticky.html_url : null,
      stickyKind: sticky ? sticky.kind : null,
      priorSha,
      zeroDelta,
      // The report's `**Progress:**` history. Empty under --isolated: a comparability run is judged
      // as a first run, so it must not show a trend from runs it is pretending not to know about.
      rounds: runMode.isolated ? [] : (state.rounds || []),
      priorDiagnostics: null,
      note: runMode.isolated
        ? "--isolated: first-run semantics — no prior-run diagnostics, no delta triage, no fallback-rung priorSha (pipeline.md § --isolated)."
        : priorShaProvenance({ fromState: !!state.priorSha }).note,
    },

    workspace: {
      dir: workspace.dir,
      worktreeParent: workspace.worktreeParent,
      depthCapability: workspace.depthCapability,
      rung: workspace.rung,
      cleanup: workspace.cleanup,
      tier2Checker,
      tierCap: workspace.depthCapability === "diff-only" ? "standard" : null,
    },

    shape,
    // The graph itself is a sidecar; the context carries the three fields Phase C
    // actually routes on, so a depth decision costs no extra read.
    // `symbols[]` is the graph's own name for the changed declarations, and the
    // exported subset is `.filter(s => s.exported)` — there is no
    // `changed_exports` key. Reading one reported `0 changed exports` on a diff
    // whose graph held 23 symbols and scored `band: high`, which is worse than
    // no summary: it is a positive claim that the change touches no export,
    // made to a Phase C router that would otherwise have gone and looked.
    // Derive every number from a key the builder actually emits.
    impactSummary: impact
      ? {
          path: impactPath,
          changedSymbols: (impact.symbols || []).length,
          changedExports: (impact.symbols || []).filter((s) => s && s.exported).length,
          dependencies: (impact.dependencies || []).length,
          overlaps: (impact.overlaps || []).length,
          band: impact.blast_radius?.band ?? null,
          blastScore: impact.blast_radius?.score ?? null,
          // The builder's own reasons for the band. Phase C routes on the band,
          // but a `high` earned by one common identifier (`metadata`, `wait`)
          // resolving against every file that happens to use that name is a
          // different fact from one earned by a real cross-package export, and
          // only these lines carry the difference.
          blastWhy: (impact.blast_radius?.why || []).slice(0, 5),
        }
      : null,
    impact: opts.inlinePayloads ? impact : null,

    routing,
    budget,
    threads,
    gate4_precandidates: gate4Precandidates,

    anomalies,
  };

  // Run telemetry (review-telemetry.mjs): this is where a review's trace begins. The ledger sits
  // next to context.json, so every later command finds it through `dirname(context)`, and the
  // `prepare` step is backdated to this process's own start. `--no-telemetry` skips it (an intent
  // worker preparing its own context is part of the reviewer's run, not a run of its own).
  if (opts.telemetry !== false) {
    try {
      const runDir = dirname(outPath);
      const startNs = BigInt(timing.startedAt()) * 1_000_000n;
      beginRun(runDir, {
        ...hostFacts(),
        repo, number, head_sha: checkoutSha, head_ref: meta.headRefName || undefined,
        mode: context.mode, tier: routing.tier, thoroughness: budget.effectiveThoroughness, topology: budget.topology,
      }, { ns: startNs });
      /** @type {Record<string, number>} */
      const phaseAttrs = {};
      for (const [name, ms] of Object.entries(context.timing?.phases || {})) phaseAttrs[`phase.${name.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_ms`] = ms;
      appendRecord(runDir, { t: "step", phase: "start", name: "prepare", ns: startNs });
      // `sub` carries each internal phase with its own start and end, so the trace shows them as
      // child spans of `prepare` — a 14 s step is only actionable once its 6 s clone is visible.
      const sub = timing.segments().map((g) => ({ name: g.name, start_ns: String(BigInt(g.startMs) * 1_000_000n), end_ns: String(BigInt(g.endMs) * 1_000_000n) }));
      appendRecord(runDir, { t: "step", phase: "end", attrs: { ...phaseAttrs, files: files.length, delta_lines: context.deltaLines }, sub });
      // The marker list travels with the run: the model reads it here, at the point it starts
      // marking, rather than recalling a rule it read before Step 1. Every step it lists and the
      // model forgets is exported as `unmarked`, which is how lenses and verify went missing.
      context.telemetry = {
        runDir, ledger: ledgerPath(runDir),
        markers: { command: markerCommand(runDir), steps: modelSteps({ tier: routing.tier, topology: budget.topology }) },
      };
    } catch (e) {
      anomalies.push(`run telemetry not started: ${String(e && e.message || e).slice(0, 160)}`);
    }
  }

  writeFileSync(outPath, JSON.stringify(context, null, 2), "utf8");
  return { context, outPath };
}

/* ------------------------------- self-test ------------------------------- */

async function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  // A/B round 1 delta: gh-credentialed git fetch/clone. `execFile` has no
  // dependency-injection seam here, so the offline-feasible test is (1) the
  // constants' own shape and (2) a source-level check — this file's own
  // text — that every remote-touching `git` invocation actually spreads
  // GIT_CREDENTIAL_ARGS and passes the non-interactive env, the same
  // "read the real shipped source" idiom L1's cross-file guards use.
  t("GIT_CREDENTIAL_ARGS clears the ambient credential.helper before setting gh's, in that order", () => {
    return GIT_CREDENTIAL_ARGS[0] === "-c" && GIT_CREDENTIAL_ARGS[1] === "credential.helper="
      && GIT_CREDENTIAL_ARGS[2] === "-c" && GIT_CREDENTIAL_ARGS[3] === "credential.helper=!gh auth git-credential";
  });
  t("GIT_NONINTERACTIVE_ENV sets GIT_TERMINAL_PROMPT=0 without dropping the rest of process.env", () => {
    return GIT_NONINTERACTIVE_ENV.GIT_TERMINAL_PROMPT === "0"
      && Object.keys(GIT_NONINTERACTIVE_ENV).length >= Object.keys(process.env).length;
  });
  t("every remote-touching git fetch/clone in this file's own source spreads GIT_CREDENTIAL_ARGS and passes GIT_NONINTERACTIVE_ENV", () => {
    const src = readFileSync(new URL(import.meta.url), "utf8");
    // One block per git-subprocess call whose array contains "fetch" or "clone" — each such
    // call, up to its closing statement terminator, must carry both wires. worktree-add and
    // checkout are deliberately excluded: neither touches a remote once the fetch above ran.
    const remoteCalls = [...src.matchAll(/\brun\(\s*"git"[\s\S]*?\);/g)]
      .map((m) => m[0])
      .filter((block) => /"fetch"|"clone"/.test(block));
    if (remoteCalls.length < 3) return false; // guard the guard: the extractor must find all three
    return remoteCalls.every((block) => block.includes("GIT_CREDENTIAL_ARGS") && block.includes("GIT_NONINTERACTIVE_ENV"));
  });

  t("parsePrRef reads a full URL", () => {
    const r = parsePrRef("https://github.com/mthines/agent-skills/pull/198");
    return r.repo === "mthines/agent-skills" && r.number === 198;
  });
  t("parsePrRef reads a URL with a trailing path", () => {
    const r = parsePrRef("https://github.com/o/r/pull/12/files");
    return r.repo === "o/r" && r.number === 12;
  });
  t("parsePrRef reads owner/repo#n", () => {
    const r = parsePrRef("o/r#7");
    return r.repo === "o/r" && r.number === 7;
  });
  t("parsePrRef reads a bare number against the fallback repo", () => {
    const r = parsePrRef("#7", "o/r");
    return r.repo === "o/r" && r.number === 7;
  });
  t("parsePrRef returns null for template text rather than inventing a PR", () => {
    return parsePrRef("{{github.pull_request.number}}") === null && parsePrRef("") === null;
  });
  t("parsePrRef leaves repo null for a bare number with no fallback", () => {
    return parsePrRef("7").repo === null;
  });

  t("priorShaFromBody matches all three run-mode footer forms", () => {
    const forms = [
      "Reviewed for commit `abc1234`",
      "Incremental review for commit `abc1234`",
      "… gate checks only for commit `abc1234`",
    ];
    return forms.every((f) => priorShaFromBody(f) === "abc1234");
  });
  t("priorShaFromBody returns null when no footer is present", () => {
    return priorShaFromBody("nothing here") === null && priorShaFromBody("") === null;
  });

  t("findSticky matches by marker, never by login", () => {
    const s = findSticky([
      { id: 1, user: "someone", body: "hi" },
      { id: 2, user: "not-the-bot", body: `x ${REPORT_MARKER} y` },
    ]);
    return s && s.id === 2 && s.kind === "report";
  });
  t("findSticky prefers the report marker over a pointer", () => {
    const s = findSticky([
      { id: 1, body: POINTER_MARKER },
      { id: 2, body: REPORT_MARKER },
    ]);
    return s.id === 2 && s.kind === "report";
  });
  t("findSticky counts duplicates instead of hiding them", () => {
    const s = findSticky([
      { id: 1, body: REPORT_MARKER },
      { id: 2, body: REPORT_MARKER },
    ]);
    return s.id === 2 && s.duplicates === 1;
  });
  t("findSticky returns null on an empty comment list", () => findSticky([]) === null);

  t("sameCommit compares on a 7-char prefix across both SHA lengths", () => {
    const full = "abc1234def5678901234567890abcdef12345678";
    return sameCommit(full, "abc1234") === true && sameCommit(full, "abc1235") === false;
  });
  t("sameCommit is false when either side is missing", () => {
    return sameCommit(null, "abc1234") === false && sameCommit("abc1234", "") === false;
  });

  t("partitionUndiffable puts a null patch on the undiffable side", () => {
    const { diffable, undiffable } = partitionUndiffable([
      { filename: "a.ts", patch: "@@" },
      { filename: "b.png", patch: null },
      { filename: "c.woff2" },
    ]);
    return diffable.length === 1 && undiffable.length === 2 && undiffable.includes("c.woff2");
  });

  t("deltaLines sums additions and deletions", () => {
    return deltaLines([{ additions: 3, deletions: 4 }, { additions: 1, deletions: 0 }]) === 8;
  });
  t("deltaLines is 0 for an empty list", () => deltaLines([]) === 0 && deltaLines(null) === 0);

  t("extraHighStakes reads a block list and strips inline comments", () => {
    const y = ["high_stakes_paths:", "  - ^src/auth/  # money", '  - "^db/migrations/"', "other: 1"].join("\n");
    const r = extraHighStakes(y);
    return r.length === 2 && r[0] === "^src/auth/" && r[1] === "^db/migrations/";
  });
  t("agent0Config reads the three top-level keys and strips comments and quotes", () => {
    const r = agent0Config(["agent0_fix_links: false  # off", 'agent0_environment: "development"', "agent0_org: acme", "  agent0_org: nested"].join("\n"));
    return r.fixLinks === false && r.environment === "development" && r.org === "acme";
  });
  t("agent0Config leaves fixLinks null when the key is absent", () => {
    const r = agent0Config("profile: strict\n");
    return r.fixLinks === null && r.environment === null && r.org === null && agent0Config("").fixLinks === null;
  });
  t("extraHighStakes returns empty when the key is absent", () => {
    return extraHighStakes("profile: strict\n").length === 0 && extraHighStakes("").length === 0;
  });

  t("normalizeLogin folds the three spellings of one GitHub App identity", () => {
    const want = "dash0-dev";
    return ["app/dash0-dev", "dash0-dev[bot]", "Dash0-Dev", " dash0-dev "].every((v) => normalizeLogin(v) === want);
  });
  t("normalizeLogin leaves a human login alone and is empty-safe", () => {
    return normalizeLogin("mthines") === "mthines" && normalizeLogin(null) === "" && normalizeLogin("") === "";
  });
  t("normalizeLogin does not collapse two distinct logins", () => {
    return normalizeLogin("app/dash0-dev") !== normalizeLogin("mthines");
  });
  t("verifyPinnedHead is ok with no pin", () => verifyPinnedHead("", "abc123").ok === true);
  t("verifyPinnedHead is ok when the pin matches the live head (shared prefix)", () => {
    return verifyPinnedHead("906a747", "906a74781990f75607f0234de963fdbbc3953f2c").ok === true;
  });
  t("a mismatched --pin-head is NOT ok and names both SHAs — head moved: pinned <a> live <b>", () => {
    const r = verifyPinnedHead("906a74781990f75607f0234de963fdbbc3953f2c", "deadbeef00000000000000000000000000000000");
    return r.ok === false && r.message === "head moved: pinned 906a74781990f75607f0234de963fdbbc3953f2c live deadbeef00000000000000000000000000000000";
  });
  t("a pinned head against an unreadable live head is NOT ok", () => verifyPinnedHead("906a747", "").ok === false);

  t("--isolated forces mode:full regardless of --full", () => {
    const r = resolveRunMode({ isolated: true, full: false });
    return r.isolated === true && r.full === true && r.mode === "full";
  });
  t("--isolated ignores any --state path (first-run semantics on every invocation)", () => {
    const r = resolveRunMode({ isolated: true, statePath: "/tmp/state.json" });
    return r.stateIgnored === true;
  });
  t("without --isolated, a --state path is not marked ignored", () => {
    const r = resolveRunMode({ isolated: false, statePath: "/tmp/state.json" });
    return r.stateIgnored === false;
  });
  t("neither --isolated nor --full leaves mode undecided (Phase C's job, not Phase 0's)", () => {
    const r = resolveRunMode({});
    return r.mode === null && r.full === false;
  });

  // ── resolveContextMode (Phase C decides what Phase 0 left undecided) ──
  const undecided = resolveRunMode({});
  t("a re-review routed deep (refresh trigger) renders mode full, not null", () =>
    resolveContextMode({ runMode: undecided, zeroDelta: false, routing: { tier: "deep", capApplied: false } }) === "full");
  t("a re-review routed standard renders mode incremental", () =>
    resolveContextMode({ runMode: undecided, zeroDelta: false, routing: { tier: "standard" } }) === "incremental");
  t("a re-review routed quick renders mode incremental-quick", () =>
    resolveContextMode({ runMode: undecided, zeroDelta: false, routing: { tier: "quick" } }) === "incremental-quick");
  t("a zero-delta re-review renders mode zero-delta", () =>
    resolveContextMode({ runMode: undecided, zeroDelta: true, routing: { tier: "quick" } }) === "zero-delta");
  t("a deep run capped to standard under diff-only keeps mode full (render-report's carve-out pair)", () =>
    resolveContextMode({ runMode: undecided, zeroDelta: false, routing: { tier: "standard", capApplied: true } }) === "full");
  t("--full wins over the routed tier", () =>
    resolveContextMode({ runMode: resolveRunMode({ full: true }), zeroDelta: false, routing: { tier: "standard" } }) === "full");
  t("every mode resolveContextMode emits is one render-report.mjs accepts", () => {
    const valid = new Set(["full", "incremental", "incremental-quick", "zero-delta"]);
    return ["deep", "standard", "quick"].every((tier) => valid.has(resolveContextMode({ runMode: undecided, zeroDelta: false, routing: { tier } })));
  });
  t("an unknown routed tier throws instead of rendering an invalid mode", () => {
    try { resolveContextMode({ runMode: undecided, zeroDelta: false, routing: { tier: "bogus" } }); return false; } catch { return true; }
  });

  // ── runToFile (rung 2: a binary tarball must reach disk byte-for-byte) ──
  {
    const dir = mkdtempSync(join(tmpdir(), "prep-selftest-"));
    const out = join(dir, "bin.dat");
    // Every byte value, including the ones UTF-8 decoding rewrites (0x80–0xff).
    const script = "process.stdout.write(Buffer.from(Array.from({length:256},(_, i)=>i)))";
    const r = await runToFile(process.execPath, ["-e", script], out, { timeoutMs: 10000 });
    const bytes = readFileSync(out);
    t("runToFile streams binary stdout to disk unmodified (all 256 byte values)", () =>
      r.ok && r.bytes === 256 && bytes.length === 256 && bytes.every((b, i) => b === i));
    const big = await runToFile(process.execPath, ["-e", "process.stdout.write(Buffer.alloc(80*1024*1024))"], join(dir, "big.dat"), { timeoutMs: 30000 });
    t("runToFile has no maxBuffer ceiling (80 MB, above run()'s 64 MB)", () => big.ok && big.bytes === 80 * 1024 * 1024);
    const failed = await runToFile(process.execPath, ["-e", "process.stderr.write('nope'); process.exit(3)"], join(dir, "f.dat"), { timeoutMs: 10000 });
    t("runToFile reports a non-zero exit and its stderr", () => !failed.ok && failed.code === 3 && failed.stderr.includes("nope"));
  }

  // ── resolvePriorRun (pipeline.md § --isolated item 1: no fallback-rung leak) ──
  t("resolvePriorRun: isolated is null/false even when a real sticky footer is present", () => {
    const r = resolvePriorRun({ isolated: true, stickyBody: "commit `abc1234`", headSha: "abc1234def" });
    return r.priorSha === null && r.zeroDelta === false;
  });
  t("resolvePriorRun: isolated is null/false even on a same-commit sticky (would otherwise be zeroDelta)", () => {
    const r = resolvePriorRun({ isolated: true, stickyBody: "commit `abc1234`", headSha: "abc1234def56789" });
    return r.priorSha === null && r.zeroDelta === false;
  });
  t("resolvePriorRun: non-isolated recovers priorSha from the sticky footer, as before", () => {
    const r = resolvePriorRun({ isolated: false, stickyBody: "commit `abc1234`", headSha: "abc1234def56789" });
    return r.priorSha === "abc1234" && r.zeroDelta === true;
  });
  t("priorShaProvenance: a --state priorSha is named as the state record, never the fallback rung", () => {
    const p = priorShaProvenance({ fromState: true });
    return p.loreKitNotCovered.includes("from the --state record") && !/FALLBACK rung/i.test(p.loreKitNotCovered)
      && p.loreKitNotCovered.includes("carries no PRIOR_DIAGNOSTICS") && !/fallback rung/i.test(p.note);
  });
  t("priorShaProvenance: without a --state priorSha the fallback-rung wording stands", () => {
    const p = priorShaProvenance({ fromState: false });
    return p.loreKitNotCovered.includes("GitHub FALLBACK rung only") && p.note.includes("fallback rung");
  });
  t("resolvePriorRun: non-isolated with no sticky is a genuine first run", () => {
    const r = resolvePriorRun({ isolated: false, stickyBody: null, headSha: "abc1234def56789" });
    return r.priorSha === null && r.zeroDelta === false;
  });

  // ── verifyReviewSha (D8/D9, AC-15/AC-16) — exact / prefix / not-in-list / ambiguous / truncated ──
  const REVIEW_SHA_CANDIDATES = [
    "906a74781990f75607f0234de963fdbbc3953f2",
    "906a74799990f75607f0234de963fdbbc3953f2",
    "deadbeef00000000000000000000000000000000".slice(0, 40),
  ];
  t("verifyReviewSha: an exact 40-char match resolves", () => {
    const r = verifyReviewSha(REVIEW_SHA_CANDIDATES[0], REVIEW_SHA_CANDIDATES);
    return r.ok === true && r.resolved === REVIEW_SHA_CANDIDATES[0];
  });
  t("verifyReviewSha: a unique short prefix resolves to the full SHA", () => {
    const r = verifyReviewSha("deadbeef", REVIEW_SHA_CANDIDATES);
    return r.ok === true && r.resolved === REVIEW_SHA_CANDIDATES[2];
  });
  t("verifyReviewSha: a prefix matching nothing in this PR's commit list is refused — cannot prove it exists", () => {
    const r = verifyReviewSha("cafef00d", REVIEW_SHA_CANDIDATES);
    return r.ok === false && r.resolved === null && /cannot prove/i.test(r.message);
  });
  t("verifyReviewSha: a prefix matching more than one commit is ambiguous, never guessed", () => {
    const r = verifyReviewSha("906a747", REVIEW_SHA_CANDIDATES);
    return r.ok === false && r.resolved === null && /ambiguous/i.test(r.message) && r.message.includes("2 commits");
  });
  t("verifyReviewSha: shorter than the minimum length is refused as unable to disambiguate — cannot prove", () => {
    const r = verifyReviewSha("90", REVIEW_SHA_CANDIDATES);
    return r.ok === false && r.resolved === null && /cannot prove/i.test(r.message);
  });
  t("verifyReviewSha: case-insensitive and whitespace-tolerant", () => {
    const r = verifyReviewSha(`  ${REVIEW_SHA_CANDIDATES[0].toUpperCase()}  `, REVIEW_SHA_CANDIDATES);
    return r.ok === true && r.resolved === REVIEW_SHA_CANDIDATES[0];
  });

  // ── filterAsOf (D9) — the historical-run "never read the future" filter ──
  t("filterAsOf: keeps items at or before the cutoff, drops items after it", () => {
    const items = [
      { id: 1, created_at: "2026-01-01T00:00:00Z" },
      { id: 2, created_at: "2026-01-05T00:00:00Z" },
      { id: 3, created_at: "2026-01-10T00:00:00Z" },
    ];
    const out = filterAsOf(items, "2026-01-05T00:00:00Z");
    return out.length === 2 && out.every((/** @type {any} */ i) => i.id !== 3);
  });
  t("filterAsOf: an item with an unparseable own timestamp is dropped, never assumed to qualify", () => {
    const items = [{ id: 1, created_at: "not-a-date" }, { id: 2, created_at: "2026-01-01T00:00:00Z" }];
    const out = filterAsOf(items, "2026-01-05T00:00:00Z");
    return out.length === 1 && out[0].id === 2;
  });
  t("filterAsOf: no cutoff (the live-review path) filters nothing", () => {
    const items = [{ id: 1, created_at: "2026-01-01T00:00:00Z" }];
    return filterAsOf(items, null).length === 1 && filterAsOf(items, "").length === 1;
  });
  t("filterAsOf: a custom date field is honored", () => {
    const items = [{ id: 1, submitted_at: "2026-01-01T00:00:00Z" }, { id: 2, submitted_at: "2026-01-10T00:00:00Z" }];
    const out = filterAsOf(items, "2026-01-05T00:00:00Z", "submitted_at");
    return out.length === 1 && out[0].id === 1;
  });

  t("filterAsOf: an unparseable non-empty cutoff fails CLOSED (drops everything)", () => {
    const items = [{ id: 1, created_at: "2026-01-01T00:00:00Z" }];
    return filterAsOf(items, "not-a-date").length === 0;
  });

  // ── historicalThreads (D9) — --review-sha filters thread state to the reviewed commit's
  // committer date; it is what prepare() calls on the historical path ──
  const HT_SHA = "906a74781990f75607f0234de963fdbbc3953f2a";
  const HT_THREADS = [
    { thread_id: "old", created_at: "2026-01-01T00:00:00Z", replies: [
      { author: "a", created_at: "2026-01-02T00:00:00Z" }, { author: "b", created_at: "2026-01-09T00:00:00Z" }] },
    { thread_id: "future", created_at: "2026-01-08T00:00:00Z", replies: [] },
  ];
  t("historicalThreads: drops threads opened after the reviewed commit's committedDate and later replies", () => {
    const r = historicalThreads({ threads: HT_THREADS, commits: [{ oid: HT_SHA, committedDate: "2026-01-05T00:00:00Z" }], reviewSha: HT_SHA });
    return r.asOf === "2026-01-05T00:00:00Z" && r.anomaly === null
      && r.threads.length === 1 && r.threads[0].thread_id === "old" && r.threads[0].replies.length === 1;
  });
  t("historicalThreads: no committedDate for the reviewed commit fails CLOSED (zero threads + anomaly)", () => {
    const r = historicalThreads({ threads: HT_THREADS, commits: [{ oid: HT_SHA }], reviewSha: HT_SHA });
    return r.threads.length === 0 && r.asOf === null && /committedDate/.test(r.anomaly || "");
  });
  t("prepare() wires historicalThreads into the --review-sha path (not merely exported)", () => {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const body = src.slice(src.indexOf("async function prepare("), src.indexOf("function selfTest("));
    return /historicalThreads\(\{/.test(body) && /threads_created_as_of/.test(body);
  });
  // ── dash0#20655: a head that merges the base in keeps compare/PRIOR...HEAD `ahead`, and GitHub
  // cuts the compare at 300 files — so the intact list was main's files, with the authored ones
  // cut off. prepare() hands both compares to resolveIntactDelta/resolveChurnLines, which REPLACE
  // an untrusted list (local git, else blob route) instead of filtering it. ──
  t("prepare() routes the intact delta and the churn compare through the truncation-aware resolvers, and reports the delta count", () => {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const body = src.slice(src.indexOf("async function prepare("), src.indexOf("function selfTest("));
    return /const resolved = await resolveIntactDelta\(\{\s*compareFiles: cmp\.value\.files,/.test(body)
      && /deltaFiles = resolved\.files;/.test(body) && /if \(resolved\.anomaly\) anomalies\.push\(resolved\.anomaly\)/.test(body)
      && /readLocal: \(\) => localAuthoredDelta\(\{ dirs: localGitDirs, from: \/\*\* @type \{string\} \*\/ \(priorSha\), to: headSha, baseSha,/.test(body)
      && /const churn = await resolveChurnLines\(\{\s*perFile: cum\.value\.files,/.test(body)
      && /readLocal: \(\) => localAuthoredDelta\(\{ dirs: localGitDirs, from: \/\*\* @type \{string\} \*\/ \(state\.lastFullSha\), to: headSha, baseSha,/.test(body)
      && /prFilesCompleteness\(files\.length, meta\.changedFiles, filesR\.error\)/.test(body)
      && /\n    deltaLines: deltaCountsResult\.deltaLines,\n/.test(body)
      && /files: \[\(\.files \/\/ \[\]\)\[\] \| \{filename, lines/.test(CHURN_COMPARE_JQ)
      && /history: compareHistory\(cmp\.value\),/.test(body) && /history: compareHistory\(cum\.value\),/.test(body)
      && [DELTA_COMPARE_JQ, CHURN_COMPARE_JQ].every((jq) => jq.includes(COMPARE_HISTORY_JQ));
  });
  t("localAuthoredDelta: a head that merges main in yields only the authored files (real git repo)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prr-local-delta-"));
    /** @param {string[]} a */
    const g = (a) => run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
    await g(["init", "-q", "-b", "main"]);
    const lines10 = Array.from({ length: 10 }, (_, i) => `l${i}`);
    writeFileSync(join(dir, "shared.ts"), "one\n"); writeFileSync(join(dir, "main-only.ts"), "m\n");
    writeFileSync(join(dir, "both.ts"), lines10.join("\n") + "\n"); writeFileSync(join(dir, "conflict.ts"), "c\n");
    await g(["add", "-A"]); await g(["commit", "-qm", "base"]);
    await g(["checkout", "-qb", "feat"]);
    writeFileSync(join(dir, "feat.ts"), "f1\n"); writeFileSync(join(dir, "shared.ts"), "one\nfeat\n");
    writeFileSync(join(dir, "both.ts"), ["FEAT", ...lines10.slice(1)].join("\n") + "\n"); writeFileSync(join(dir, "conflict.ts"), "feat\n");
    await g(["add", "-A"]); await g(["commit", "-qm", "feat 1"]);
    const prior = (await g(["rev-parse", "HEAD"])).stdout.trim();
    await g(["checkout", "-q", "main"]);
    writeFileSync(join(dir, "main-only.ts"), "m\nm2\n"); writeFileSync(join(dir, "main-new.ts"), "n\n");
    // both.ts: main edits a far line, so the merge combines it CLEANLY — `--cc` would list it,
    // `--remerge-diff` does not. conflict.ts: same line, so the author resolves it by hand.
    writeFileSync(join(dir, "both.ts"), [...lines10.slice(0, 9), "MAIN"].join("\n") + "\n"); writeFileSync(join(dir, "conflict.ts"), "main\n");
    await g(["add", "-A"]); await g(["commit", "-qm", "main moves"]);
    await g(["checkout", "-q", "feat"]);
    writeFileSync(join(dir, "feat.ts"), "f1\nf2\nf3\n");
    await g(["add", "-A"]); await g(["commit", "-qm", "feat 2"]);
    await g(["merge", "-q", "--no-edit", "main"]);
    writeFileSync(join(dir, "conflict.ts"), "resolved\n");
    await g(["add", "-A"]); await g(["commit", "-qm", "merge main", "--no-edit"]);
    const head = (await g(["rev-parse", "HEAD"])).stdout.trim();
    const baseSha = (await g(["rev-parse", "main"])).stdout.trim();
    const prFiles = [{ filename: "shared.ts" }, { filename: "feat.ts" }, { filename: "both.ts" }, { filename: "conflict.ts" }];
    const r = await localAuthoredDelta({ dirs: [null, "/nonexistent-prr", dir], from: prior, to: head, baseSha, prFiles, prFilesComplete: true });
    const names = r.ok ? r.files.map((f) => f.filename).sort() : [];
    const feat = r.ok ? r.files.find((f) => f.filename === "feat.ts") : null;
    const missing = await localAuthoredDelta({ dirs: [dir], from: "0".repeat(40), to: head, baseSha, prFiles, prFilesComplete: true });
    const noBase = await localAuthoredDelta({ dirs: [dir], from: prior, to: head, baseSha: "1".repeat(40), prFiles, prFilesComplete: true });
    rmSync(dir, { recursive: true, force: true });
    return r.ok && JSON.stringify(names) === JSON.stringify(["conflict.ts", "feat.ts"]) && feat?.additions === 2 && feat?.deletions === 0
      && String(feat?.patch).startsWith("@@") && missing.ok === false && noBase.ok === false && /base 1111111 not in/.test(noBase.reason);
  });
  // PR #213 r4134280273: authored commits are those in prior..head NOT reachable from the base
  // tip — on EITHER parent of a merge. A first-parent walk lost a teammate's pushed commit pulled
  // in by a pull, and a sibling branch merged in, both of which arrive on a second parent.
  t("localAuthoredDelta: second-parent authored commits count, base commits do not (real git repo)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prr-second-parent-"));
    /** @param {string[]} a */
    const g = (a) => run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
    /** @param {string} f @param {string} body @param {string} msg */
    const commit = async (f, body, msg) => { writeFileSync(join(dir, f), body); await g(["add", "-A"]); await g(["commit", "-qm", msg]); };
    const sha = async (/** @type {string} */ ref) => (await g(["rev-parse", ref])).stdout.trim();
    await g(["init", "-q", "-b", "main"]);
    await commit("base.ts", "b\n", "base");
    await g(["checkout", "-qb", "feat"]);
    await commit("mine.ts", "m\n", "mine");
    const prior = await sha("HEAD");
    // A teammate pushes to the same branch; the author pulls it in with a merge (second parent).
    await g(["checkout", "-qb", "teammate", prior]);
    await commit("teammate.ts", "t\n", "teammate");
    // A sibling branch, cut from main, merged into feat (second parent).
    await g(["checkout", "-qb", "sibling", "main"]);
    await commit("sibling.ts", "s\n", "sibling");
    // Main moves on and is merged in too — its files must stay out.
    await g(["checkout", "-q", "main"]);
    await commit("main-only.ts", "x\n", "main moves");
    await g(["checkout", "-q", "feat"]);
    await commit("mine.ts", "m\nm2\n", "mine 2");
    await g(["merge", "-q", "--no-ff", "--no-edit", "teammate"]);
    await g(["merge", "-q", "--no-ff", "--no-edit", "sibling"]);
    await g(["merge", "-q", "--no-ff", "--no-edit", "main"]);
    const head = await sha("HEAD");
    const baseSha = await sha("main");
    const prFiles = ["mine.ts", "teammate.ts", "sibling.ts"].map((filename) => ({ filename }));
    const r = await localAuthoredDelta({ dirs: [dir], from: prior, to: head, baseSha, prFiles, prFilesComplete: false });
    const names = r.ok ? r.files.map((f) => f.filename).sort() : [];
    // A head made ONLY of merges of authored work: the first-parent walk saw no commit at all.
    await g(["checkout", "-qb", "merges-only", prior]);
    await g(["merge", "-q", "--no-ff", "--no-edit", "teammate"]);
    await g(["merge", "-q", "--no-ff", "--no-edit", "sibling"]);
    const onlyMerges = await localAuthoredDelta({ dirs: [dir], from: prior, to: await sha("HEAD"), baseSha, prFiles, prFilesComplete: true });
    const onlyNames = onlyMerges.ok ? onlyMerges.files.map((f) => f.filename).sort() : [];
    rmSync(dir, { recursive: true, force: true });
    return r.ok && JSON.stringify(names) === JSON.stringify(["mine.ts", "sibling.ts", "teammate.ts"])
      && JSON.stringify(onlyNames) === JSON.stringify(["sibling.ts", "teammate.ts"]);
  });
  // PR #213 (Less certain): `diff.noprefix` in the user's config dropped the `b/` the patch parser
  // keys on, and a space in a path put a TAB after the header — either way the row's patch was null.
  t("localAuthoredDelta: patches survive diff.noprefix and a path with a space (real git repo)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prr-noprefix-"));
    /** @param {string[]} a */
    const g = (a) => run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
    await g(["init", "-q", "-b", "main"]);
    writeFileSync(join(dir, "base.ts"), "b\n"); await g(["add", "-A"]); await g(["commit", "-qm", "base"]);
    await g(["config", "diff.noprefix", "true"]);
    await g(["checkout", "-qb", "feat"]);
    const prior = (await g(["rev-parse", "HEAD"])).stdout.trim();
    writeFileSync(join(dir, "my file.ts"), "x\n"); writeFileSync(join(dir, "plain.ts"), "y\n");
    await g(["add", "-A"]); await g(["commit", "-qm", "feat"]);
    const head = (await g(["rev-parse", "HEAD"])).stdout.trim();
    const prFiles = [{ filename: "my file.ts" }, { filename: "plain.ts" }];
    const r = await localAuthoredDelta({ dirs: [dir], from: prior, to: head, baseSha: prior, prFiles, prFilesComplete: true });
    rmSync(dir, { recursive: true, force: true });
    return r.ok && r.files.length === 2 && r.files.every((f) => String(f.patch).startsWith("@@ -0,0 +1 @@"));
  });
  // PR #213 r4134280286: `--remerge-diff` on an octopus merge warns on stderr, lists nothing, and
  // exits 0 — so a hand edit made inside the octopus merge vanished instead of reaching `--cc`.
  t("localAuthoredDelta: a hand edit inside an octopus merge is read via --cc (real git repo)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prr-octopus-"));
    /** @param {string[]} a */
    const g = (a) => run("git", ["-C", dir, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
    /** @param {string} f @param {string} body @param {string} msg */
    const commit = async (f, body, msg) => { writeFileSync(join(dir, f), body); await g(["add", "-A"]); await g(["commit", "-qm", msg]); };
    const sha = async (/** @type {string} */ ref) => (await g(["rev-parse", ref])).stdout.trim();
    await g(["init", "-q", "-b", "main"]);
    await commit("base.ts", "b\n", "base");
    await g(["checkout", "-qb", "feat"]);
    await commit("mine.ts", "m\n", "mine");
    const prior = await sha("HEAD");
    for (const side of ["t1", "t2"]) {
      await g(["checkout", "-qb", side, prior]);
      await commit(`${side}.ts`, `${side}\n`, side);
    }
    await g(["checkout", "-q", "feat"]);
    await g(["merge", "-q", "--no-ff", "--no-edit", "t1", "t2"]);
    writeFileSync(join(dir, "evil.ts"), "hand edit in the octopus\n");
    await g(["add", "-A"]); await g(["commit", "-q", "--amend", "--no-edit"]);
    const head = await sha("HEAD");
    const parents = (await g(["rev-list", "--parents", "-n1", head])).stdout.trim().split(/\s+/).length - 1;
    const prFiles = ["mine.ts", "t1.ts", "t2.ts", "evil.ts"].map((filename) => ({ filename }));
    const r = await localAuthoredDelta({ dirs: [dir], from: prior, to: head, baseSha: await sha("main"), prFiles, prFilesComplete: true });
    const names = r.ok ? r.files.map((f) => f.filename).sort() : [];
    rmSync(dir, { recursive: true, force: true });
    return parents === 3 && r.ok && JSON.stringify(names) === JSON.stringify(["evil.ts", "t1.ts", "t2.ts"]);
  });
  // PR #213 r4134545772: the base tip is fetched by nothing upstream, so once origin's main moves
  // past the local clone the local-git route must fetch it by SHA — or fall through, saying why.
  t("localAuthoredDelta: fetches a base SHA the clone lacks after origin's main moves (real origin + clone)", async () => {
    const root = mkdtempSync(join(tmpdir(), "prr-fetch-base-"));
    const origin = join(root, "origin"), clone = join(root, "clone"), dead = join(root, "dead");
    /** @param {string} d @param {string[]} a */
    const g = (d, a) => run("git", ["-C", d, "-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a]);
    /** @param {string} f @param {string} body @param {string} msg */
    const commit = async (f, body, msg) => { writeFileSync(join(origin, f), body); await g(origin, ["add", "-A"]); await g(origin, ["commit", "-qm", msg]); };
    const sha = async (/** @type {string} */ ref) => (await g(origin, ["rev-parse", ref])).stdout.trim();
    mkdirSync(origin);
    await g(origin, ["init", "-q", "-b", "main"]);
    await commit("base.ts", "b\n", "base");
    await g(origin, ["checkout", "-qb", "feat"]);
    await commit("mine.ts", "m\n", "mine");
    const prior = await sha("HEAD");
    await commit("mine.ts", "m\nm2\n", "mine 2");
    const head = await sha("HEAD");
    for (const d of [clone, dead]) await g(root, ["clone", "-q", "--no-local", origin, d]);
    await g(dead, ["remote", "set-url", "origin", join(root, "no-such-remote")]);
    await g(origin, ["checkout", "-q", "main"]);
    await commit("main-only.ts", "x\n", "main moves after the clone");
    const baseSha = await sha("main");
    const absentBefore = !(await g(clone, ["cat-file", "-e", `${baseSha}^{commit}`])).ok;
    const prFiles = [{ filename: "mine.ts", sha: "x" }];
    const r = await localAuthoredDelta({ dirs: [clone], from: prior, to: head, baseSha, prFiles, prFilesComplete: true });
    const names = r.ok ? r.files.map((f) => f.filename) : [];
    const deadRead = () => localAuthoredDelta({ dirs: [dead], from: prior, to: head, baseSha, prFiles, prFilesComplete: true });
    const failed = await deadRead();
    const fellThrough = await resolveIntactDelta({
      compareFiles: [{ filename: "mine.ts", patch: "@@ -1 +1 @@\n+m" }, { filename: "main-only.ts", patch: "@@ -0,0 +1 @@\n+x" }],
      prFiles, readLocal: deadRead, readPriorTree: async () => ({ ok: false, reason: "no tree" }),
    });
    rmSync(root, { recursive: true, force: true });
    return absentBefore && r.ok && JSON.stringify(names) === JSON.stringify(["mine.ts"])
      && failed.ok === false && /^base [0-9a-f]{7} not in .* fetching it from origin failed \(/.test(failed.reason)
      && fellThrough.route === "full-pr" && /fetching it from origin failed/.test(String(fellThrough.anomaly));
  });
  t("Gate 4 over the resolved delta flags nothing in a merged-in base file", async () => {
    const secret = { filename: "main/test/fixture.test.ts", patch: "@@ -1,0 +1,1 @@\n+const password = \"hunter2hunter2hunter2\";" };
    const authored = [{ filename: "src/a.ts", patch: "@@ -1,0 +1,1 @@\n+export const a = 1;" }];
    const resolved = await resolveIntactDelta({
      compareFiles: [authored[0], secret], prFiles: [{ filename: "src/a.ts", sha: "x" }],
      readLocal: async () => ({ ok: true, files: authored }), readPriorTree: async () => ({ ok: false, reason: "unused" }),
    });
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const body = src.slice(src.indexOf("async function prepare("), src.indexOf("function selfTest("));
    // prepare() must scan the resolved delta, never the raw compare list.
    return scanGate4([secret]).some((c) => c.category === "secret") && scanGate4(resolved.files).length === 0
      && /const gate4Precandidates = scanGate4\(deltaFiles\);/.test(body);
  });
  t("buildThreads: carries the root comment's createdAt as created_at (the as-of filter's key)", () => {
    const out = buildThreads([{ id: "T", comments: { nodes: [{ databaseId: 1, createdAt: "2026-01-01T00:00:00Z" }] } }]);
    return out[0].created_at === "2026-01-01T00:00:00Z";
  });

  // ── historicalBlock (D8/D9) — the context.json block finalize.mjs/execute-write-plan.mjs
  // refuse to post anything for outside --dry-run ──
  t("historicalBlock: carries review_sha plus the explicit thread_state_as_of/description_as_of=now, ci=not-read markers", () => {
    const b = historicalBlock({ reviewSha: "906a74781990f75607f0234de963fdbbc3953f2" });
    return b.review_sha === "906a74781990f75607f0234de963fdbbc3953f2"
      && b.thread_state_as_of === "now" && b.description_as_of === "now" && b.ci === "not-read";
  });

  t("scratchRoot prefers the agent workspace over os.tmpdir()", () => {
    // The whole point is that a sub-agent can read the checkout. `/tmp/workspace`
    // exists on the host this runs on; `PR_REVIEWER_SCRATCH` overrides it, and the
    // returned directory must exist by the time it is returned.
    const forced = join(tmpdir(), `prr-scratch-probe-${process.pid}`);
    mkdirSync(forced, { recursive: true });
    process.env.PR_REVIEWER_SCRATCH = forced;
    const picked = scratchRoot();
    delete process.env.PR_REVIEWER_SCRATCH;
    const def = scratchRoot();
    return picked === join(forced, ".pr-reviewer-scratch")
      && existsSync(picked)
      && (!existsSync("/tmp/workspace") || def.startsWith("/tmp/workspace/"));
  });

  // ── D10: buildThreads / hunksOf / computeThreadOverlap / readStateFile ──
  t("buildThreads: the first comment is the root, the rest are replies", () => {
    const out = buildThreads([
      {
        id: "T1",
        isResolved: false,
        isOutdated: false,
        comments: {
          nodes: [
            { databaseId: 1, path: "a.ts", line: 10, originalLine: 10, url: "u1", body: "root ask", author: { login: "cursor", __typename: "Bot" }, createdAt: "2026-01-01T00:00:00Z" },
            { databaseId: 2, path: "a.ts", line: 10, originalLine: 10, url: "u2", body: "reply", author: { login: "mads", __typename: "User" }, createdAt: "2026-01-02T00:00:00Z" },
          ],
        },
      },
    ]);
    return out.length === 1
      && out[0].thread_id === "T1" && out[0].root_comment_id === 1 && out[0].path === "a.ts"
      && out[0].is_bot === true && out[0].author === "cursor"
      && out[0].replies.length === 1 && out[0].replies[0].author === "mads";
  });
  t("buildThreads: a human author's is_bot reads false from __typename, never from a login guess", () => {
    const out = buildThreads([
      { id: "T2", isResolved: true, isOutdated: false, comments: { nodes: [{ databaseId: 3, path: "b.ts", line: 1, author: { login: "not-a-bot-login-pattern", __typename: "User" } }] } },
    ]);
    return out[0].is_bot === false && out[0].is_resolved === true;
  });
  t("buildThreads: a thread with zero comments is dropped rather than emitted empty", () => {
    return buildThreads([{ id: "T3", isResolved: false, isOutdated: false, comments: { nodes: [] } }]).length === 0;
  });

  t("hunksOf: extracts every hunk's right-side start line", () => {
    const patch = "@@ -1,2 +1,3 @@\n context\n+add\n@@ -10,1 +12,2 @@\n+add2\n";
    const hs = hunksOf(patch);
    return hs.length === 2 && hs[0].start === 1 && hs[1].start === 12;
  });
  t("hunksOf: a null/empty patch yields no hunks", () => hunksOf(null).length === 0 && hunksOf("").length === 0);

  t("computeThreadOverlap: a hunk within 5 lines of a thread's line counts as matched", () => {
    const files = [{ filename: "a.ts", patch: "@@ -1,1 +10,1 @@\n+x\n" }];
    const threads = [{ path: "a.ts", line: 13, original_line: null }];
    return computeThreadOverlap(files, threads) === 1;
  });
  t("computeThreadOverlap: reads line ?? original_line, never line alone, on an outdated (nulled-line) thread", () => {
    const files = [{ filename: "a.ts", patch: "@@ -1,1 +10,1 @@\n+x\n" }];
    const threads = [{ path: "a.ts", line: null, original_line: 11 }];
    return computeThreadOverlap(files, threads) === 1;
  });
  t("computeThreadOverlap: a file-level thread (anchor null) matches every hunk in its file", () => {
    const files = [{ filename: "a.ts", patch: "@@ -1,1 +100,1 @@\n+x\n" }];
    const threads = [{ path: "a.ts", line: null, original_line: null }];
    return computeThreadOverlap(files, threads) === 1;
  });
  t("computeThreadOverlap: a thread on a different path never matches", () => {
    const files = [{ filename: "a.ts", patch: "@@ -1,1 +10,1 @@\n+x\n" }];
    const threads = [{ path: "b.ts", line: 10, original_line: null }];
    return computeThreadOverlap(files, threads) === 0;
  });
  t("computeThreadOverlap: no hunks or no threads is 0, never NaN or a divide-by-zero throw", () => {
    return computeThreadOverlap([], [{ path: "a.ts", line: 1 }]) === 0
      && computeThreadOverlap([{ filename: "a.ts", patch: "@@ -1,1 +1,1 @@\n+x\n" }], []) === 0;
  });
  t("computeThreadOverlap: is a fraction of matched over total hunks, not a boolean", () => {
    const files = [{ filename: "a.ts", patch: "@@ -1,1 +1,1 @@\n+x\n@@ -50,1 +50,1 @@\n+y\n" }];
    const threads = [{ path: "a.ts", line: 1, original_line: null }];
    return computeThreadOverlap(files, threads) === 0.5;
  });

  t("readStateFile: absent path defaults to no prior deep pass on record (the safe direction)", () => {
    const s = readStateFile(null);
    return s.lastFullSha === null && s.incrRunsSinceFull === 0;
  });
  t("readStateFile: rounds carry each run's open/blocking worklist, skip runs without one, cap at 4", () => {
    const p = join(tmpdir(), `prr-state-rounds-${process.pid}.json`);
    const runs = [
      { sha: "1111111aaaa", mode: "full", verdict: "FAIL", at: "2026-09-01T00:00:00Z" },
      { sha: "2222222", mode: "incremental", verdict: "FAIL", at: "2026-09-02T00:00:00Z", open: 6, blocking: 2 },
      { sha: "3333333", mode: "incremental", verdict: "WARN", at: "2026-09-03T00:00:00Z", open: 5, blocking: 1 },
      { sha: "4444444", mode: "incremental", verdict: "WARN", at: "2026-09-04T00:00:00Z", open: 4, blocking: 9 },
      { sha: "5555555", mode: "full", verdict: "WARN", at: "2026-09-05T00:00:00Z", open: 3, blocking: 0 },
      { sha: "6666666", mode: "incremental", verdict: "WARN", at: "2026-09-06T00:00:00Z", open: 2, blocking: 0 },
      { sha: "7777777", mode: "incremental", verdict: "PASS", at: "2026-09-07T00:00:00Z", open: 1, blocking: 0 },
    ];
    writeFileSync(p, JSON.stringify({ v: 1, commit: "7777777", data: { runs } }), "utf8");
    const s = readStateFile(p);
    // run 1 has no counts and run 4's blocking > open — both skipped; the last four survivors kept.
    return JSON.stringify(s.rounds) === JSON.stringify([
      { sha: "3333333", open: 5, blocking: 1 }, { sha: "5555555", open: 3, blocking: 0 },
      { sha: "6666666", open: 2, blocking: 0 }, { sha: "7777777", open: 1, blocking: 0 },
    ]);
  });
  t("readStateFile: reads a real state file's lastFullSha and incrRunsSinceFull", () => {
    const p = join(tmpdir(), `prr-state-probe-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ lastFullSha: "abc1234", incrRunsSinceFull: 2 }), "utf8");
    const s = readStateFile(p);
    return s.lastFullSha === "abc1234" && s.incrRunsSinceFull === 2;
  });
  t("readStateFile: the record as Step 4c writes it binds the prior SHA, the last full SHA and the incremental count", () => {
    const p = join(tmpdir(), `prr-state-rec-${process.pid}.json`);
    const rec = { v: 1, commit: "ccc", data: { runs: [
      { sha: "aaa", mode: "incremental" }, { sha: "bbb", mode: "full" }, { sha: "ccc", mode: "incremental" }, { sha: "ddd", mode: "incremental-quick" },
    ] } };
    writeFileSync(p, JSON.stringify(rec), "utf8");
    const direct = readStateFile(p);
    writeFileSync(p, JSON.stringify({ key: "ci-state::pr-review-1", value: JSON.stringify(rec) }), "utf8");
    const envelope = readStateFile(p);
    writeFileSync(p, JSON.stringify({ v: 1, data: { runs: [{ sha: "eee", mode: "incremental" }] } }), "utf8");
    const noFull = readStateFile(p);
    return [direct, envelope].every((s) => s.priorSha === "ddd" && s.lastFullSha === "bbb" && s.incrRunsSinceFull === 2)
      && noFull.priorSha === "eee" && noFull.lastFullSha === null && noFull.incrRunsSinceFull === 1;
  });
  t("resolvePriorRun: the state record's prior SHA wins over the sticky footer, which stays the fallback", () => {
    const body = "commit `abc1234`";
    return resolvePriorRun({ isolated: false, stickyBody: body, headSha: "fff9999", statePriorSha: "def5678" }).priorSha === "def5678"
      && resolvePriorRun({ isolated: false, stickyBody: body, headSha: "fff9999" }).priorSha === "abc1234"
      && resolvePriorRun({ isolated: true, stickyBody: body, headSha: "fff9999", statePriorSha: "def5678" }).priorSha === null;
  });
  t("checksReadable: a red (1) or pending (8) table is a read; an empty, timed-out or other failure is not", () =>
    checksReadable({ ok: false, code: 1, stdout: "Generate types\tfail\t1m\n" })
      && checksReadable({ ok: false, code: 8, stdout: "build\tpending\n" })
      && checksReadable({ ok: true, code: 0, stdout: "" })
      && !checksReadable({ ok: false, code: 1, stdout: "" })
      && !checksReadable({ ok: false, code: 1, stdout: "x", timedOut: true })
      && !checksReadable({ ok: false, code: 4, stdout: "x" }));
  t("readStateFile: the record's sticky_comment_id is returned for a sticky the marker scan cannot find", () => {
    const p = join(tmpdir(), `prr-state-sticky-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ v: 1, data: { sticky_comment_id: 5876011167, runs: [{ sha: "aaa", mode: "full" }] } }), "utf8");
    return readStateFile(p).stickyCommentId === 5876011167;
  });
  t("readStateFile: the record's bot_login is returned as botLogin", () => {
    const p = join(tmpdir(), `prr-state-bot-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ v: 1, data: { bot_login: "dash0-dev[bot]", runs: [{ sha: "aaa", mode: "full" }] } }), "utf8");
    return readStateFile(p).botLogin === "dash0-dev[bot]";
  });
  t("readStateFile: an invalid bot_login is ignored (null), never returned as an identity", () => {
    const p = join(tmpdir(), `prr-state-badbot-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ v: 1, data: { bot_login: '{"message":"Bad credentials"}', runs: [{ sha: "aaa", mode: "full" }] } }), "utf8");
    return readStateFile(p).botLogin === null;
  });
  t("resolveReviewerIdentity: a supplied login wins; the state record's bot_login is the fallback; else unknown", () => {
    const a = resolveReviewerIdentity({ suppliedLogin: "mthines", fromFlag: true, stateBotLogin: "dash0-dev[bot]" });
    const b = resolveReviewerIdentity({ suppliedLogin: "", fromFlag: false, stateBotLogin: "dash0-dev[bot]" });
    const c = resolveReviewerIdentity({ suppliedLogin: "not a login", fromFlag: true, stateBotLogin: null });
    const d = resolveReviewerIdentity({ suppliedLogin: "mthines", fromFlag: false, stateBotLogin: null });
    return a.me === "mthines" && a.identitySource === "--reviewer-login"
      && b.me === "dash0-dev[bot]" && b.identitySource === "state-record"
      && c.me === "" && c.identitySource === "unknown"
      && d.identitySource === "PR_REVIEWER_LOGIN";
  });
  t("resolveReviewerIdentity: the prior sticky's author is the last rung, below the state record and any supplied login, validated", () => {
    const e = resolveReviewerIdentity({ suppliedLogin: "", fromFlag: false, stateBotLogin: null, stickyAuthorLogin: "dash0-dev[bot]" });
    const f = resolveReviewerIdentity({ suppliedLogin: "", fromFlag: false, stateBotLogin: "state-bot[bot]", stickyAuthorLogin: "dash0-dev[bot]" });
    const g = resolveReviewerIdentity({ suppliedLogin: "mthines", fromFlag: true, stateBotLogin: null, stickyAuthorLogin: "dash0-dev[bot]" });
    const h = resolveReviewerIdentity({ suppliedLogin: "", fromFlag: false, stateBotLogin: null, stickyAuthorLogin: "{\"message\":\"Bad credentials\"}" });
    return e.me === "dash0-dev[bot]" && e.identitySource === "prior-report-author"
      && f.me === "state-bot[bot]" && f.identitySource === "state-record"
      && g.me === "mthines" && g.identitySource === "--reviewer-login"
      && h.me === "" && h.identitySource === "unknown";
  });
  t("identity wiring: a sticky shaped by the real issue-comments projection yields prior-report-author", () => {
    // Mirror ISSUE_COMMENTS_JQ exactly — the fetch flattens the author to a string.
    const fields = [...ISSUE_COMMENTS_JQ.matchAll(/(\w+): \.([\w.]+)/g)].map((m) => [m[1], m[2]]);
    const flattensUser = fields.some(([k, v]) => k === "user" && v === "user.login");
    const row = (id, login, body) => {
      const src = { id, user: { login }, body, html_url: `https://github.com/o/r/pull/1#issuecomment-${id}`, created_at: "2026-09-29T00:00:00Z" };
      return Object.fromEntries(fields.map(([k, v]) => [k, v.split(".").reduce((o, key) => o?.[key], src)]));
    };
    const comments = [row(1, "someone", "hello"), row(2, "dash0-dev[bot]", `${REPORT_MARKER}\n### report`)];
    const sticky = findSticky(comments);
    // Through prepare()'s own argument builder, so a regression at the call site turns this red.
    const input = identityInputs({ opts: {}, state: { botLogin: null }, sticky, isolated: false, env: {} });
    const r = resolveReviewerIdentity(input);
    const iso = resolveReviewerIdentity(identityInputs({ opts: {}, state: { botLogin: null }, sticky, isolated: true, env: {} }));
    return flattensUser && typeof comments[1].user === "string" && sticky?.id === 2
      && r.identitySource === "prior-report-author" && r.me === "dash0-dev[bot]"
      && iso.identitySource === "unknown"
      && stickyAuthorLogin({ user: { login: "x[bot]" } }) === "x[bot]"
      && stickyAuthorLogin(null) === null && stickyAuthorLogin({ user: "" }) === null;
  });
  t("readStateFile: an unparseable file degrades to the safe default rather than throwing", () => {
    const p = join(tmpdir(), `prr-state-bad-${process.pid}.json`);
    writeFileSync(p, "{not json", "utf8");
    const s = readStateFile(p);
    return s.lastFullSha === null && s.incrRunsSinceFull === 0;
  });

  // A/B round 2 item 1(a): real timeout detection, not a source-grep — proves `run()` bites.
  // `sleep` needs no network and is present on every runner this pipeline executes on.
  t("run(): a real timeout reports timedOut:true, never a bare ok:false with no signal", async () => {
    const r = await run("sleep", ["2"], { timeoutMs: 100 });
    return r.ok === false && r.timedOut === true;
  });
  t("run(): a process that exits non-zero on its own (no kill) is NOT reported as a timeout", async () => {
    // A generous budget: this asserts a NON-kill, and a node cold start on a host whose endpoint
    // agent scans each spawn (NODE_USE_SYSTEM_CA) measured ~5 s, which a 5 s budget read as a timeout.
    const r = await run("node", ["-e", "process.exit(3)"], { timeoutMs: 30000 });
    return r.ok === false && r.timedOut === false && r.code === 3;
  });
  t("describeFailure(): a timed-out result reports 'timed out after Ns', never empty stderr", () => {
    return describeFailure({ ok: false, code: 1, stderr: "", timedOut: true }, 300000) === "timed out after 300s";
  });
  t("describeFailure(): a non-timeout failure with empty stderr names its exit code rather than blanking", () => {
    return describeFailure({ ok: false, code: 7, stderr: "", timedOut: false }, 60000) === "failed with exit code 7";
  });
  t("describeFailure(): a non-timeout failure WITH stderr still prefers the real message", () => {
    return describeFailure({ ok: false, code: 1, stderr: "  fatal: repository not found\n", timedOut: false }, 60000)
      === "fatal: repository not found";
  });
  t("materializeWorkspace's source passes --filter=blob:none and a >= 300s timeout floor on rung 1's clone", () => {
    const src = readFileSync(new URL(import.meta.url), "utf8");
    return src.includes("--filter=blob:none") && src.includes("CLONE_TIMEOUT_FLOOR_MS = 300000")
      && /clone.*"-q", "--filter=blob:none"/.test(src.replace(/\n/g, " "));
  });
  t("materializeWorkspace's source applies the same extended timeout floor to the tarball rung", () => {
    const src = readFileSync(new URL(import.meta.url), "utf8");
    const tarballBlock = src.slice(src.indexOf("// Rung 2"), src.indexOf("anomalies.push(\"workspace ladder exhausted"));
    return tarballBlock.includes("cloneTimeoutMs") && tarballBlock.includes("describeFailure(got, cloneTimeoutMs)");
  });

  // A/B round 2 item 1(b): rung-0/worktree reuse keyed to the run — pure predicate, no git calls.
  t("isReusableWorktreeDir: non-isolated reuse is unrestricted (today's behaviour)", () => {
    return isReusableWorktreeDir("/tmp/workspace/.pr-reviewer-scratch/wt-anything/w", { isolated: false, runScratchDir: null }) === true;
  });
  t("isReusableWorktreeDir: isolated + exact runScratchDir match is reusable", () => {
    return isReusableWorktreeDir("/tmp/ws/.pr-reviewer-scratch/run-123", { isolated: true, runScratchDir: "/tmp/ws/.pr-reviewer-scratch/run-123" }) === true;
  });
  t("isReusableWorktreeDir: isolated + nested under this run's own scratch dir is reusable", () => {
    return isReusableWorktreeDir(
      "/tmp/ws/.pr-reviewer-scratch/run-123/wt-abcd/w",
      { isolated: true, runScratchDir: "/tmp/ws/.pr-reviewer-scratch/run-123" },
    ) === true;
  });
  t("isReusableWorktreeDir: isolated + ANOTHER run's scratch dir (arm B's D10 leak) is refused", () => {
    return isReusableWorktreeDir(
      "/tmp/ws/.pr-reviewer-scratch/run-456-arm-b/wt-zzzz/w",
      { isolated: true, runScratchDir: "/tmp/ws/.pr-reviewer-scratch/run-123-arm-d" },
    ) === false;
  });
  t("isReusableWorktreeDir: isolated + a lookalike sibling PREFIX (run-123x) is refused, not string-matched", () => {
    return isReusableWorktreeDir(
      "/tmp/ws/.pr-reviewer-scratch/run-123x/wt-zzzz/w",
      { isolated: true, runScratchDir: "/tmp/ws/.pr-reviewer-scratch/run-123" },
    ) === false;
  });
  t("isGithubLogin accepts real logins and App identities", () =>
    ["mthines", "a", "dash0-dev", "app-x[bot]", "A1-b2"].every((l) => isGithubLogin(l)));
  t("isGithubLogin rejects a 401 error body, empties, and malformed names (A/B iteration 4)", () =>
    ['{"message":"Bad credentials","status":"401"}', "", " mthines", "-lead", "trail-", "a--b", "x".repeat(40), null]
      .every((l) => !isGithubLogin(l)));
  t("isReusableWorktreeDir: isolated with no runScratchDir bound fails closed to never-reuse", () => {
    return isReusableWorktreeDir("/anything", { isolated: true, runScratchDir: null }) === false;
  });

  // The caller that ran prepare owns the workspace (pr-review SKILL.md § Step 2): the scripted
  // cleanup removes a worktree through git, an rm-rung dir with rm -rf, leaves `none`, and refuses
  // a directory outside the scratch root.
  t("cleanupWorkspace removes a worktree through git, leaving no .git/worktrees entry, and is idempotent", () => {
    const base = mkdtempSync(join(tmpdir(), "prr-cleanup-"));
    try {
      const repo = join(base, "repo");
      mkdirSync(repo);
      const g = (/** @type {string[]} */ a, cwd = repo) => execFileSync("git", a, { cwd, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
      g(["init", "-q"]); writeFileSync(join(repo, "f"), "x");
      g(["-c", "user.email=t@t", "-c", "user.name=t", "add", "f"]);
      g(["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", "c"]);
      const parent = join(base, ".pr-reviewer-scratch", "run-1", "wt-a");
      mkdirSync(parent, { recursive: true });
      const dir = join(parent, "w");
      g(["worktree", "add", "-q", "--detach", dir]);
      const r = cleanupWorkspace({ dir, worktreeParent: parent, cleanup: "worktree" });
      const again = cleanupWorkspace({ dir, worktreeParent: parent, cleanup: "worktree" });
      return r.ok && !existsSync(dir) && !existsSync(parent) && !g(["worktree", "list"]).includes(dir) && again.ok;
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  t("cleanupWorkspace rm-rfs an rm-rung dir, leaves cleanup:none alone, and refuses a dir outside the scratch root", () => {
    const base = mkdtempSync(join(tmpdir(), "prr-cleanup-"));
    try {
      const clone = join(base, "clone-x"); mkdirSync(join(clone, "sub"), { recursive: true }); writeFileSync(join(clone, "sub", "f"), "x");
      const kept = join(base, "user-worktree"); mkdirSync(kept);
      const rm = cleanupWorkspace({ dir: clone, cleanup: "rm" });
      const none = cleanupWorkspace({ dir: kept, cleanup: "none" });
      const outside = cleanupWorkspace({ dir: "/definitely/not/scratch/w", cleanup: "rm" });
      return rm.ok && !existsSync(clone) && none.ok && existsSync(kept) && !outside.ok && /outside the scratch root/.test(outside.message);
    } finally { rmSync(base, { recursive: true, force: true }); }
  });
  t("budget reads the context's run mode: a small incremental re-review is in-context", () => {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    return /const budget = resolveBudget\(\{\n\s+runMode: contextMode,/.test(src) && /mode: contextMode,/.test(src);
  });

  // Every case's name is echoed on PASS too, not only on failure — this is the one self-test
  // in the pipeline a standing L1 guard (or a checks.yaml AC) greps for a case NAME in the
  // OUTPUT rather than only in the source, so a silent-on-success run would read as though
  // that coverage did not exist (AC-16).
  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = (await fn()) === true;
    } catch (err) {
      process.stderr.write(`self-test THREW: ${name}: ${err.message}\n`);
    }
    if (ok) {
      process.stderr.write(`  ✓ ${name}\n`);
    } else {
      failed++;
      process.stderr.write(`self-test FAIL: ${name}\n`);
    }
  }
  if (failed) {
    process.stderr.write(`self-test: ${failed}/${cases.length} FAILED\n`);
    process.exit(1);
  }
  process.stderr.write(`self-test OK: ${cases.length} cases\n`);
}

/* --------------------------------- CLI --------------------------------- */

async function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  if (argv[0] === "--cleanup") {
    // The caller that ran prepare releases the workspace once every agent it handed the context to
    // has returned (pr-review SKILL.md § Step 2). Exit 1 on a refusal or a failed removal.
    let ws;
    try { ws = JSON.parse(readFileSync(argv[1] || "", "utf8")).workspace; } catch (e) {
      process.stderr.write(`cleanup: cannot read ${JSON.stringify(argv[1] || "")}: ${String(/** @type {any} */ (e)?.message || e)}\n`);
      process.exit(2);
    }
    const r = cleanupWorkspace(ws);
    process.stderr.write(`cleanup: ${r.message}\n`);
    process.exit(r.ok ? 0 : 1);
  }

  const opts = {
    pr: "",
    repo: "",
    out: "/tmp/workspace/review-context.json",
    workdir: "",
    reviewerLogin: "",
    workspace: true,
    impact: true,
    telemetry: true,
    timeoutMs: 90000,
    quiet: false,
    inlinePayloads: false,
    pinHead: "",
    isolated: false,
    full: false,
    state: "",
    effort: "",
    thoroughness: "",
    threads: true,
    reviewSha: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pr") opts.pr = argv[++i];
    else if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--workdir") opts.workdir = argv[++i];
    else if (a === "--repo-dir") opts.repoDir = argv[++i]; // rung 0's local clone of the PR repo, when the cwd is not one
    else if (a === "--reviewer-login") opts.reviewerLogin = argv[++i];
    else if (a === "--no-workspace") opts.workspace = false;
    else if (a === "--no-impact") opts.impact = false;
    else if (a === "--no-telemetry") opts.telemetry = false;
    else if (a === "--timeout-ms") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--inline-payloads") opts.inlinePayloads = true;
    else if (a === "--pin-head") opts.pinHead = argv[++i];
    else if (a === "--isolated") opts.isolated = true;
    else if (a === "--full") opts.full = true;
    else if (a === "--state") opts.state = argv[++i]; // D10: the LoreKit state record's lastFullSha/incrRunsSinceFull
    else if (a === "--effort") opts.effort = argv[++i]; // "high" raises routing.tier to deep (D10/route-depth.mjs D3)
    else if (a === "--thoroughness") opts.thoroughness = argv[++i]; // 0..1, resolveBudget()'s explicit override
    else if (a === "--no-threads") opts.threads = false;
    else if (a === "--review-sha") opts.reviewSha = argv[++i]; // D8/D9: historical read-only review target
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }

  if (!opts.pr) {
    process.stderr.write(
      "usage: prepare-review.mjs --pr <url|owner/repo#n|n> [--repo owner/repo] [--out file] " +
        "[--workdir dir] [--repo-dir dir] [--reviewer-login login] [--no-workspace] [--no-impact] " +
        "[--no-telemetry] [--inline-payloads] [--timeout-ms N] [--quiet] [--pin-head sha] [--isolated] [--full] " +
        "[--state file] [--effort high] [--thoroughness 0..1] [--no-threads] [--review-sha sha] | --self-test\n",
    );
    process.exit(2);
  }

  // `--review-sha` write-refusal gate (D8/D9, AC-15) — checked BEFORE `prepare()` spawns any
  // `gh` process, so a caller who got the combination wrong never spends a network round trip
  // (or, on a PATH-shim test double, ever writes to the shim's argv log) finding that out.
  // Two refusals, never combined into one message, so each names the exact flag to change:
  //   1. `--review-sha` without `--isolated` — a historical review must not read live PR
  //      state (Step 0.7, the sticky footer fallback) that postdates the commit it reviews.
  //   2. `--review-sha` together with `--pin-head` — `--review-sha` already pins the review
  //      to a specific (historical) commit; `--pin-head` compares against the LIVE head,
  //      which is a different, live-head-only comparability contract this run does not need.
  //      (`--isolated` runs WITHOUT `--review-sha` still require `--pin-head`, per
  //      pipeline.md § --isolated item 3 — that requirement is unchanged and does not apply
  //      here.)
  if (opts.reviewSha) {
    if (!opts.isolated) {
      process.stderr.write(
        "prepare-review.mjs: --review-sha requires --isolated — a historical review must not read " +
          "live PR state that postdates the commit it is reviewing. Pass --isolated.\n",
      );
      process.exit(2);
    }
    if (opts.pinHead) {
      process.stderr.write(
        "prepare-review.mjs: --review-sha and --pin-head are mutually exclusive — --review-sha " +
          "already pins this review to a specific (historical) commit, and --pin-head compares " +
          "against the LIVE head, a different comparability contract this run does not need. " +
          "Drop --pin-head.\n",
      );
      process.exit(2);
    }
  }

  try {
    const { context, outPath } = await prepare(opts);
    if (!opts.quiet) {
      const w = context.workspace;
      process.stderr.write(
        [
          `context: ${outPath}  (${context.elapsedMs} ms)`,
          `  PR        ${context.target.repo}#${context.target.number} · ${context.meta.state}${context.meta.isDraft ? " (draft)" : ""} · @${context.meta.author}`,
          `  head      ${context.headSha.slice(0, 7)}  base ${context.baseSha.slice(0, 7)}`,
          `  delta     ${context.deltaLines} lines via ${context.deltaRoute} · PR ${context.files.length} files (${context.undiffablePaths.length} undiffable)`,
          `  relation  ${context.reviewRelation} (identity: ${context.identitySource})`,
          `  depth     ${w.depthCapability} via rung ${w.rung} · tier2 ${w.tier2Checker || "none"} · cleanup ${w.cleanup}`,
          `  prior     ${context.priorRun.priorSha ? `${context.priorRun.priorSha} (${context.priorRun.source})` : "none"}${context.priorRun.zeroDelta ? " · ZERO DELTA" : ""}`,
          `  shape     ${context.shape ? JSON.stringify(context.shape).slice(0, 160) : "unavailable"}`,
          `  impact    ${context.impactSummary ? `band=${context.impactSummary.band} · ${context.impactSummary.changedSymbols} symbols (${context.impactSummary.changedExports} exported) · ${context.impactSummary.dependencies} deps` : "unavailable"}`,
          `  routing   tier=${context.routing.tier}${context.routing.capApplied ? " (capped)" : ""} · triggers=[${context.routing.triggers.join(",")}] · threads=${context.threads.length} · gate4=${context.gate4_precandidates.length} pre-candidate(s)`,
          `  budget    thoroughness=${context.budget.effectiveThoroughness}${context.budget.riskFloorApplied ? ` (floored: ${context.budget.riskFloorReason})` : ""} · topology=${context.budget.topology} · votes=${context.budget.correctnessVotes} · tool calls=${context.budget.toolCalls ?? "?"}`,
          `  context   ${(Buffer.byteLength(JSON.stringify(context)) / 1024).toFixed(0)} KB index + sidecars in ${dirname(outPath)}`,
          ...(context.telemetry?.markers ? [
            `  markers   put this in front of each step's first command (fill <step>, <N> = your tool calls so far):`,
            `            ${context.telemetry.markers.command}`,
            `            steps: ${context.telemetry.markers.steps.join(" → ")}`,
          ] : []),
          `  anomalies ${context.anomalies.length}`,
          ...context.anomalies.map((a) => `    ⚠ ${a}`),
        ].join("\n") + "\n",
      );
    }
  } catch (err) {
    process.stderr.write(`PREPARE FAILED: ${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith("prepare-review.mjs")) {
  await main(process.argv.slice(2));
}
