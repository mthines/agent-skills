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
 *        [--out <file>] [--workdir <dir>] [--reviewer-login <login>]
 *        [--no-workspace] [--no-impact] [--timeout-ms N] [--quiet]
 *   node prepare-review.mjs --self-test
 *
 * Exit codes: 0 ok · 1 unrecoverable (no PR reference resolved, metadata
 * unreadable) · 2 usage. A degraded rung is NEVER an exit code — it is an entry
 * in `anomalies[]`, because a review that could not materialize a checkout is a
 * narrower review, not a failed one.
 */

import { execFile } from "node:child_process";
import { writeFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Timing } from "./review-telemetry.mjs";
import { classifyDivergence, blobDelta, deltaCounts, churnState, FULL_REFRESH_DELTA } from "./delta-triage.mjs";
import { routeDepth } from "./route-depth.mjs";
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

export function run(cmd, args, { timeoutMs = 60000, cwd = process.cwd(), maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((res) => {
    execFile(cmd, args, { timeout: timeoutMs, cwd, maxBuffer, encoding: "utf8" }, (err, stdout, stderr) => {
      res({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

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

/**
 * Reads the `--state` file (D10) — the caller's already-fetched LoreKit
 * state record `data`, read by the AGENT before invoking this script
 * (Steps 0.7/1.0; this script does no LoreKit I/O itself, per its own
 * "What it deliberately does NOT do" note above). Absent or unreadable
 * degrades to "no prior deep pass on record" — the SAFE direction per
 * depth-routing.md's D6 ("no prior full review is recorded").
 * @param {string|null} path @returns {{lastFullSha: string|null, incrRunsSinceFull: number}}
 */
export function readStateFile(path) {
  if (!path) return { lastFullSha: null, incrRunsSinceFull: 0 };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      lastFullSha: raw.lastFullSha || raw.last_full_sha || null,
      incrRunsSinceFull: Number(raw.incrRunsSinceFull ?? raw.incr_runs_since_full ?? 0) || 0,
    };
  } catch {
    return { lastFullSha: null, incrRunsSinceFull: 0 };
  }
}

/* ---------------------------- workspace ladder ---------------------------- */

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
async function materializeWorkspace({ repo, number, headSha, timeoutMs, anomalies }) {
  const originRepo = await currentRepoSlug();

  // Rung 0 — worktree over the local object store.
  if (originRepo && originRepo.toLowerCase() === repo.toLowerCase()) {
    // Reuse before creating. This script is re-run — a retry, a second pass, a
    // re-review on the same head — and a fresh `worktree add` per run leaves the
    // parent repo carrying one registered worktree per invocation. Reusing one
    // already checked out at this exact head is also the only disposal-safe
    // answer: the reused one is not ours to remove, so it is `cleanup: none`.
    const existing = await findWorktreeAt(headSha);
    if (existing) {
      return {
        dir: existing,
        worktreeParent: null,
        depthCapability: "checkout",
        rung: "0 (reused an existing worktree at this head)",
        cleanup: "none",
      };
    }

    const fetched = await run("git", ["fetch", "-q", "origin", `pull/${number}/head`], { timeoutMs });
    if (fetched.ok) {
      const parent = mkdtempSync(join(scratchRoot(), "wt-"));
      const dir = join(parent, "w");
      const added = await run("git", ["worktree", "add", "--detach", dir, headSha], { timeoutMs });
      if (added.ok) {
        return {
          dir,
          worktreeParent: parent,
          depthCapability: "checkout",
          rung: "0 (worktree over local object store, full history)",
          cleanup: "worktree",
        };
      }
      anomalies.push(`workspace rung 0 failed: ${(added.stderr || "").trim().slice(0, 200)}`);
    } else {
      anomalies.push(`workspace rung 0 skipped: could not fetch pull/${number}/head`);
    }
  }

  // Rung 1 — shallow clone of the head ref.
  const cloneDir = mkdtempSync(join(scratchRoot(), "clone-"));
  const cloned = await run(
    "git",
    ["clone", "-q", "--depth", "50", `https://github.com/${repo}.git`, cloneDir],
    { timeoutMs: Math.max(timeoutMs, 120000) },
  );
  if (cloned.ok) {
    await run("git", ["fetch", "-q", "--depth", "50", "origin", `pull/${number}/head`], {
      timeoutMs,
      cwd: cloneDir,
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
    anomalies.push(`workspace rung 1 checkout failed: ${(co.stderr || "").trim().slice(0, 200)}`);
  } else {
    anomalies.push(`workspace rung 1 clone failed: ${(cloned.stderr || "").trim().slice(0, 200)}`);
  }

  // Rung 2 — tarball at the head.
  const tarDir = mkdtempSync(join(scratchRoot(), "tar-"));
  const tarball = join(tarDir, "head.tgz");
  const got = await run("gh", ["api", `repos/${repo}/tarball/${headSha}`], { timeoutMs });
  if (got.ok && got.stdout.length > 0) {
    writeFileSync(tarball, got.stdout, "binary");
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
  }
  anomalies.push("workspace ladder exhausted — DEPTH_CAPABILITY=diff-only, tier capped at standard");

  // A failed ladder is not a failed run.
  return { dir: null, worktreeParent: null, depthCapability: "diff-only", rung: "none", cleanup: "none" };
}

/**
 * Find an existing worktree already checked out at `sha`.
 *
 * Parses `git worktree list --porcelain`, whose records are blank-line
 * separated and whose `HEAD` line carries the full 40-char OID. The main
 * worktree is excluded: reviewing inside it would put the review in the tree the
 * user is sitting in, and disposal there is never ours.
 */
async function findWorktreeAt(sha) {
  if (!sha) return null;
  const r = await run("git", ["worktree", "list", "--porcelain"], { timeoutMs: 10000 });
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
  const hit = records.slice(1).find((w) => w.detached && sameCommit(w.head, sha) && existsSync(w.dir));
  return hit ? hit.dir : null;
}

async function currentRepoSlug() {
  const r = await run("git", ["remote", "get-url", "origin"], { timeoutMs: 10000 });
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

  // Step 1.1 — the five fetches, concurrently. One await, one moment in time.
  timing.start("fetch");
  const [metaR, diffR, checksR, reviewsR, commentsR, filesR] = await Promise.all([
    ghJson(
      [
        "pr",
        "view",
        String(number),
        "--repo",
        repo,
        "--json",
        "title,body,headRefName,baseRefName,headRefOid,baseRefOid,author,additions,deletions,changedFiles,state,labels,isDraft,createdAt,url",
      ],
      { timeoutMs },
    ),
    run("gh", ["pr", "diff", String(number), "--repo", repo], { timeoutMs }),
    run("gh", ["pr", "checks", String(number), "--repo", repo], { timeoutMs }),
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
        ".[] | {id: .id, user: .user.login, body: .body, html_url: .html_url, created_at: .created_at}",
      ],
      timeoutMs,
    ),
    fetchFiles(repo, number, timeoutMs),
  ]);

  timing.end(); // fetch

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

  if (!filesR.ok) anomalies.push(`patch list unreadable: ${filesR.error}`);
  if (!checksR.ok) anomalies.push("gh pr checks unreadable — CI state is informational only, so this never grades");
  if (!reviewsR.ok) anomalies.push(`prior reviews unreadable: ${reviewsR.error}`);
  if (!commentsR.ok) anomalies.push(`issue comments unreadable: ${commentsR.error} — prior-run detection degrades to first run`);

  const files = filesR.value || [];
  const { diffable, undiffable } = partitionUndiffable(files);
  const comments = commentsR.value || [];
  const sticky = findSticky(comments);
  if (sticky && sticky.duplicates > 0) {
    anomalies.push(`${sticky.duplicates + 1} sticky comments found — there must only ever be one`);
  }

  const priorSha = sticky ? priorShaFromBody(sticky.body) : null;
  const zeroDelta = sameCommit(headSha, priorSha);

  // Step 0.5 — review relation. Never from `gh api /user`: it is not repo-scoped
  // and 401s under an installation token, which is an ordinary hosted setup.
  const me = opts.reviewerLogin || process.env.PR_REVIEWER_LOGIN || "";
  const authorLogin = meta.author?.login || "";
  const reviewRelation = me ? (normalizeLogin(me) === normalizeLogin(authorLogin) ? "self" : "cross") : "cross";
  if (!me) {
    anomalies.push(
      "reviewer identity unknown (no --reviewer-login / PR_REVIEWER_LOGIN; /user 401s here) — relation defaulted to cross",
    );
  }

  // Step 1.1b — the workspace ladder.
  timing.start("workspace");
  let workspace = { dir: null, worktreeParent: null, depthCapability: "diff-only", rung: "skipped", cleanup: "none" };
  if (opts.workspace && headSha) {
    workspace = opts.workdir
      ? { dir: opts.workdir, worktreeParent: null, depthCapability: "checkout", rung: "caller-supplied", cleanup: "none" }
      : await materializeWorkspace({ repo, number, headSha, timeoutMs, anomalies });
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
  const hsArgs = extraHighStakes(readReviewConfig(workspace.dir)).flatMap((r) => ["--extra-high-stakes", r]);
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

  // Delta triage + Phase C depth routing + Gate 4 pre-candidates (D10). Depth
  // routing binds EVERY run's tier (agents/pr-reviewer.md § "Bind DEPTH_TIER
  // … all modes, including full and zero-delta"); delta TRIAGE itself (the
  // compare/blob-diff route below) applies only when there is a real prior
  // run to diff against — a genuine first run or --full has no PRIOR_SHA to
  // triage against, so "the delta" collapses to the full PR, exactly as
  // RUN_MODE=full's REVIEW_DIFF is the full PR diff.
  timing.start("triage-routing");

  const state = readStateFile(opts.state || null);
  if (!opts.state) {
    anomalies.push(
      "no --state file supplied — routing computed with lastFullSha=none, incrRunsSinceFull=0 " +
        "(forces the D6 'no prior deep pass on record' trigger every run); pass --state after " +
        "reading the LoreKit state record for an accurate routing decision",
    );
  }

  // The graphql reviewThreads read — every mode, always: THREAD_OVERLAP needs
  // it even on a full run, and the context's threads[] field is a caller
  // input regardless of tier.
  let threads = [];
  if (opts.threads !== false) {
    const tr = await fetchReviewThreads(owner, name, number, timeoutMs);
    threads = buildThreads(tr.nodes);
    if (!tr.complete) {
      anomalies.push("review threads read incomplete — THREAD_OVERLAP and open-thread data may undercount");
    }
  }

  let deltaFiles = diffable.length ? files.filter((f) => diffable.includes(f.filename)) : files;
  let deltaShape = shape;
  let deltaCountsResult = { deltaLines: deltaLines(files), newFiles: files.filter((f) => f.status === "added").length };
  let cumDeltaLines = 0;

  const hasPriorRun = !!priorSha && !zeroDelta && !opts.full;
  if (hasPriorRun) {
    const cmp = await ghJson(
      ["api", `repos/${repo}/compare/${priorSha}...${headSha}`, "--jq", "{status, ahead_by, behind_by}"],
      { timeoutMs },
    );
    if (cmp.ok) {
      const divergence = classifyDivergence(cmp.value);
      if (divergence === "intact") {
        const full = await ghJson(
          [
            "api",
            `repos/${repo}/compare/${priorSha}...${headSha}`,
            "--jq",
            "{files: [.files[] | {filename, additions, deletions, status, patch}]}",
          ],
          { timeoutMs: Math.max(timeoutMs, 120000) },
        );
        if (full.ok) {
          deltaFiles = full.value.files || [];
        } else {
          anomalies.push(`delta compare fetch failed: ${full.error} — falling back to full-PR delta`);
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
    if (state.lastFullSha) {
      const cum = await ghJson(
        ["api", `repos/${repo}/compare/${state.lastFullSha}...${headSha}`, "--jq", "{status, behind_by}"],
        { timeoutMs },
      );
      if (cum.ok) {
        let cumLines = 0;
        if (classifyDivergence(cum.value) === "intact") {
          const cumFull = await ghJson(
            ["api", `repos/${repo}/compare/${state.lastFullSha}...${headSha}`, "--jq", "[(.files // [])[] | .additions + .deletions] | add // 0"],
            { timeoutMs },
          );
          cumLines = cumFull.ok ? Number(cumFull.value) || 0 : FULL_REFRESH_DELTA + 1;
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
    firstRun: !sticky,
    full: opts.full,
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

    // What the caller must still do itself. Stated in the artifact, not only in
    // the docs, so a consumer cannot read a partial context as a complete one.
    notCovered: [
      "LoreKit reads (Steps 0.7, 1.0, 1.2c, 1.2d) — priorSha below is the GitHub FALLBACK rung only, and carries no PRIOR_DIAGNOSTICS",
      "routing{} below is only as accurate as the --state file the caller passed — no --state means lastFullSha/incrRunsSinceFull default to none/0 (see anomalies[] when this fired)",
      "Phases D and E, Steps 2.4*, 2.7, 2.9c — the Gate 4 SCAN below is mechanical pre-candidates only; confirm/exempt disposition and any AI-stub findings are judgment",
      "every write: the sticky, the review, the state record",
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
    headSha,
    baseSha,
    reviewRelation,
    reviewerLogin: me || null,
    identitySource: me ? (opts.reviewerLogin ? "--reviewer-login" : "PR_REVIEWER_LOGIN") : "unknown",

    // Bulk payloads live on disk; the context names them. `inline` says which
    // form this context is in, so a consumer never has to guess whether a null
    // `diff.text` means "empty diff" or "parked in a sidecar".
    inline: opts.inlinePayloads,
    paths: {
      files: prFilesPath,
      diff: diffR.ok ? diffPath : null,
      impact: impactPath,
      undiffable: undiffablePath,
    },
    diff: {
      path: diffR.ok ? diffPath : null,
      bytes: diffR.ok ? Buffer.byteLength(diffR.stdout) : 0,
      readable: diffR.ok,
      text: opts.inlinePayloads && diffR.ok ? diffR.stdout : null,
    },
    files: opts.inlinePayloads ? files : files.map(({ patch, ...rest }) => rest),
    filesPath: prFilesPath,
    diffablePaths: diffable,
    undiffablePaths: undiffable,
    deltaLines: deltaLines(files),

    checks: { raw: checksR.ok ? checksR.stdout.trim() : null, readable: checksR.ok },
    reviews: reviewsR.value || [],
    issueComments: comments,

    priorRun: {
      source: sticky ? "github-fallback-rung" : "none",
      stickyCommentId: sticky ? sticky.id : null,
      stickyUrl: sticky ? sticky.html_url : null,
      stickyKind: sticky ? sticky.kind : null,
      priorSha,
      zeroDelta,
      priorDiagnostics: null,
      note: "PRIOR_DIAGNOSTICS is NOT recoverable from the fallback rung. Read the LoreKit state record before taking Step 0.8's fast path.",
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
    threads,
    gate4_precandidates: gate4Precandidates,

    anomalies,
  };

  writeFileSync(outPath, JSON.stringify(context, null, 2), "utf8");
  return { context, outPath };
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

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
  t("readStateFile: reads a real state file's lastFullSha and incrRunsSinceFull", () => {
    const p = join(tmpdir(), `prr-state-probe-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ lastFullSha: "abc1234", incrRunsSinceFull: 2 }), "utf8");
    const s = readStateFile(p);
    return s.lastFullSha === "abc1234" && s.incrRunsSinceFull === 2;
  });
  t("readStateFile: an unparseable file degrades to the safe default rather than throwing", () => {
    const p = join(tmpdir(), `prr-state-bad-${process.pid}.json`);
    writeFileSync(p, "{not json", "utf8");
    const s = readStateFile(p);
    return s.lastFullSha === null && s.incrRunsSinceFull === 0;
  });

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = fn() === true;
    } catch (err) {
      process.stderr.write(`self-test THREW: ${name}: ${err.message}\n`);
    }
    if (!ok) {
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

  const opts = {
    pr: "",
    repo: "",
    out: "/tmp/workspace/review-context.json",
    workdir: "",
    reviewerLogin: "",
    workspace: true,
    impact: true,
    timeoutMs: 90000,
    quiet: false,
    inlinePayloads: false,
    pinHead: "",
    isolated: false,
    full: false,
    state: "",
    effort: "",
    threads: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pr") opts.pr = argv[++i];
    else if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--workdir") opts.workdir = argv[++i];
    else if (a === "--reviewer-login") opts.reviewerLogin = argv[++i];
    else if (a === "--no-workspace") opts.workspace = false;
    else if (a === "--no-impact") opts.impact = false;
    else if (a === "--timeout-ms") opts.timeoutMs = Number(argv[++i]);
    else if (a === "--quiet") opts.quiet = true;
    else if (a === "--inline-payloads") opts.inlinePayloads = true;
    else if (a === "--pin-head") opts.pinHead = argv[++i];
    else if (a === "--isolated") opts.isolated = true;
    else if (a === "--full") opts.full = true;
    else if (a === "--state") opts.state = argv[++i]; // D10: the LoreKit state record's lastFullSha/incrRunsSinceFull
    else if (a === "--effort") opts.effort = argv[++i]; // "high" raises routing.tier to deep (D10/route-depth.mjs D3)
    else if (a === "--no-threads") opts.threads = false;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }

  if (!opts.pr) {
    process.stderr.write(
      "usage: prepare-review.mjs --pr <url|owner/repo#n|n> [--repo owner/repo] [--out file] " +
        "[--workdir dir] [--reviewer-login login] [--no-workspace] [--no-impact] " +
        "[--inline-payloads] [--timeout-ms N] [--quiet] [--pin-head sha] [--isolated] [--full] " +
        "[--state file] [--effort high] [--no-threads] | --self-test\n",
    );
    process.exit(2);
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
          `  delta     ${context.deltaLines} lines across ${context.files.length} files (${context.undiffablePaths.length} undiffable)`,
          `  relation  ${context.reviewRelation} (identity: ${context.identitySource})`,
          `  depth     ${w.depthCapability} via rung ${w.rung} · tier2 ${w.tier2Checker || "none"} · cleanup ${w.cleanup}`,
          `  prior     ${context.priorRun.priorSha ? `${context.priorRun.priorSha} (${context.priorRun.source})` : "none"}${context.priorRun.zeroDelta ? " · ZERO DELTA" : ""}`,
          `  shape     ${context.shape ? JSON.stringify(context.shape).slice(0, 160) : "unavailable"}`,
          `  impact    ${context.impactSummary ? `band=${context.impactSummary.band} · ${context.impactSummary.changedSymbols} symbols (${context.impactSummary.changedExports} exported) · ${context.impactSummary.dependencies} deps` : "unavailable"}`,
          `  routing   tier=${context.routing.tier}${context.routing.capApplied ? " (capped)" : ""} · triggers=[${context.routing.triggers.join(",")}] · threads=${context.threads.length} · gate4=${context.gate4_precandidates.length} pre-candidate(s)`,
          `  context   ${(Buffer.byteLength(JSON.stringify(context)) / 1024).toFixed(0)} KB index + sidecars in ${dirname(outPath)}`,
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
