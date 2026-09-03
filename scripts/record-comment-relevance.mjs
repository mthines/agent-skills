#!/usr/bin/env node
/**
 * record-comment-relevance.mjs
 *
 * Records the relevance signal for PR review threads into the LoreKit
 * `reviewer-comment-relevance` bucket, and the missed/regressed signals into
 * `ci::review-knowledge`. This is the write half of the reviewer's memory that needs
 * no agent in the loop.
 *
 * Invoked by the GitHub Actions workflow `.github/workflows/reviewer-comment-relevance.yml`.
 * Context arrives through environment variables the workflow sets from the webhook.
 *
 * Modes:
 *   --mode=thread-resolved     One resolved thread          (pull_request_review_thread.resolved)
 *   --mode=pr-merged           Sweep threads open at merge  (pull_request.closed, merged)
 *   --mode=human-comment       A human reviewed a line we did not flag  (pull_request_review_comment)
 *   --mode=deploy-regression   Post-deploy telemetry regression         (deployment_status.success)
 *   --self-test                Execute the decision tables offline
 *
 * ── The three corrections this file carries ──────────────────────────────────────
 *
 * These were documented as "latent, the workflow is not committed yet" while the
 * workflow was in fact committed and running, so all three were live:
 *
 *   1. DOUBLE WRITE. The merge sweep had no resolved-state check and could not get one
 *      from `/pulls/{n}/comments` (REST does not expose thread resolution). A thread
 *      resolved with no region touch was therefore recorded twice on one fingerprint:
 *      `relevant/fixed` by the resolve trigger and `weak-not-relevant/ignored-at-merge`
 *      by the sweep — two OPPOSITE directional records. Fixed by reading thread state
 *      over GraphQL (`reviewThreads { isResolved isOutdated }`) and skipping any thread
 *      the resolve trigger owns.
 *
 *   2. FILE-LEVEL COMMENTS. A file-level comment carries a `path` but no line, so the
 *      touch guard's `line > 0` clause failed, execution fell PAST the guard, and the
 *      thread was swept as `ignored-at-merge` however the author had dealt with it — a
 *      directional record on undecidable evidence. Fixed by falling back to a
 *      FILE-level touch check: an untouched file is real evidence of no fix, a touched
 *      one is undecidable and writes nothing.
 *
 *   3. OBSOLETE → RELEVANT/FIXED. The resolve trigger cannot see WHY a thread was
 *      resolved. When the reviewer resolves a thread as `obsolete` (the code the
 *      finding was about is gone), the region-touch branch matches — a deletion always
 *      touches the line — and the terminal branch reads "resolved with none of the
 *      above ⇒ relevant/fixed". So withdrawing a question was recorded as a finding
 *      that was accepted and fixed. Fixed by consulting GitHub's own `isOutdated`: an
 *      outdated anchor makes the outcome undecidable, and undecidable writes nothing.
 *
 * The rule underneath all three: a DIRECTIONAL record requires corroborated evidence.
 * Where the evidence cannot decide, write nothing. Silence costs one signal; a wrong
 * signal trains the suppressor against a finding class that was never rejected.
 *
 * Exit codes:
 *   0  Success, or a graceful no-op (LoreKit not configured, nothing decidable).
 *   1  Never returned in production — every path degrades to a logged no-op.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extractFingerprint, isFingerprintV2, parseFingerprint } from "../agents/pr-reviewer/scripts/fingerprint.mjs";

/** Relevance-signal TTL. Mirrored in CLAUDE.md, comment-relevance-memory.md, the plugin
 *  README and implement-suggestion's SKILL.md; L1 G16 fails on a partial revert. */
const RELEVANCE_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** Knowledge and hotspot records outlive branches by design (proposal § 4.7.2). */
const KNOWLEDGE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** Reaction lookups are one API call each; bound them on a wide sweep. */
const REACTION_LOOKUP_CAP = 30;

// ── Helpers ──────────────────────────────────────────────────────────────────────

function log(...args) {
  console.log("[record-comment-relevance]", ...args);
}

function ghApi(path) {
  const raw = execSync(`gh api "${path}"`, {
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN },
    encoding: "utf8",
    timeout: 15_000,
  });
  return JSON.parse(raw);
}

/**
 * Page size for the list endpoints. GitHub's default is 30, which is the whole bug
 * this helper exists to fix: a PR with more than 30 review comments pushed this
 * agent's own flag off page 1, and every caller below reads a *negative* signal from
 * a comment's absence. So a truncated read does not degrade the signal, it INVERTS
 * it — a line the reviewer did flag is recorded as `missed`, and the strongest
 * amplify evidence the file has (`rule-amplify`, weight 3) is written as
 * `hotspot-missed` (weight 1).
 */
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // 2,000 items — beyond this, truncation is reported, never silent.

/**
 * Paginated GET for endpoints that return a JSON array.
 *
 * Pages explicitly with `per_page` + `page` rather than `gh api --paginate`: the
 * `--paginate` output for an array endpoint is concatenated JSON documents (invalid
 * JSON past page 1) and the `--slurp` flag that fixes it is not present on every `gh`
 * a caller's runner may have. Explicit paging behaves identically on every version and
 * is checkable offline.
 *
 * Throws when the item count exceeds MAX_PAGES * PAGE_SIZE, because returning a
 * silently short array here is exactly the failure mode being fixed.
 */
export function ghApiAll(path, fetch = ghApi) {
  const sep = path.includes("?") ? "&" : "?";
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const chunk = fetch(`${path}${sep}per_page=${PAGE_SIZE}&page=${page}`);
    if (!Array.isArray(chunk)) {
      throw new Error(`ghApiAll expected a JSON array from ${path}, got ${typeof chunk}`);
    }
    out.push(...chunk);
    if (chunk.length < PAGE_SIZE) return out;
  }
  throw new Error(
    `ghApiAll: ${path} exceeded ${MAX_PAGES * PAGE_SIZE} items; refusing to return a truncated list ` +
      `because every caller reads absence as a negative signal`,
  );
}

function ghGraphql(query, vars) {
  const args = Object.entries(vars).map(([k, v]) => `-F ${k}=${JSON.stringify(String(v))}`).join(" ");
  const raw = execSync(`gh api graphql -f query=${JSON.stringify(query)} ${args}`, {
    env: { ...process.env, GH_TOKEN: process.env.GITHUB_TOKEN },
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(raw);
}

/**
 * The reviewer shows the severity tier as a Conventional-Comments label decoration:
 * `issue (high): ...`. Two regexes derive from that one visible tag:
 *   SEVERITY_RE  — anchored, extracts the tier for the relevance record.
 *   TIER_TAG_RE  — global, strips the tag before fingerprinting so "high" never
 *                  pollutes the claim-gist (fingerprints stay stable across tagged and
 *                  untagged comments). Kept in sync with
 *                  agents/shared/rules/conventional-comments.md § Severity decoration.
 */
const SEVERITY_RE = /^\s*\*{0,2}(?:issue|suggestion|nitpick|nit|question|praise|chore)\s*\((critical|high|medium|low)\)/i;
const TIER_TAG_RE = /\((?:critical|high|medium|low)\)/gi;

function severityFromBody(commentBody) {
  const m = SEVERITY_RE.exec(commentBody ?? "");
  return m ? m[1].toLowerCase() : null;
}

// TIER_TAG_RE is applied inside fingerprint.mjs's v1 derivation, which this file
// delegates to; referenced here so the two stay visibly coupled.
void TIER_TAG_RE;

/**
 * Resolve a comment's fingerprint and its provenance in one step.
 *
 * A comment this agent posted carries `<!-- fp:v2:finder:class:symbol@path -->`, so the
 * key is recovered EXACTLY rather than re-derived from prose. The marker is also the
 * attribution: only this agent writes it, so its presence identifies the author without
 * any login configuration — which matters because the merge sweep reads every root
 * comment on the PR, humans' and other bots' included, and those must never train this
 * agent's suppressor (they are still useful as hotspot signal).
 */
function resolveFingerprint(commentBody, commentAuthor, authorType) {
  const got = extractFingerprint(commentBody);
  const reviewerLogin = (process.env.REVIEWER_LOGIN ?? "").trim();
  const isOurMarker = !!got && got.fp_v === 2 && got.source === "marker" && isFingerprintV2(got.fp);
  const agent = isOurMarker || (reviewerLogin && commentAuthor === reviewerLogin) ? "pr-reviewer" : "other";
  return {
    fp: got?.fp ?? null,
    fp_v: got?.fp_v ?? null,
    // A marker we cannot validate is treated as no marker: it looks authoritative and
    // must not be written as though it were.
    usable: !!got && (isOurMarker || got.fp_v === 1),
    source: {
      login: commentAuthor ?? null,
      type: authorType === "Bot" ? "bot" : "human",
      agent,
    },
  };
}

/**
 * Detect "won't fix" language in a list of comment replies.
 *
 * EVERY alternative carries \b on both sides. Enumerating "the ones that could
 * match inside a word" is how this regex was wrong three times running - each fix
 * bounded the reported instance and left the class. Bound them all; the cost of a
 * boundary on a phrase that did not need one is zero.
 *   intentional        - else matches inside "unintentional"  ("That was unintentional - fixed")
 *   by design          - else matches "by designers"          ("Reviewed by designers, then fixed")
 *   n/a                - else matches inside a path fragment  ("Fixed, see src/bin/a.js")
 *   as designed        - else matches "was designed"          ("This was designed upstream - fixed")
 *   wont fix           - else matches "wont fixate"           ("I wont fixate on this, addressed it")
 *   nwf                - else matches inside a longer token
 * These were latent while this regex governed only the decline path. They became
 * inversions once a decline match gained precedence over an acknowledgement
 * (outcome-learning.md, "What counts as an acknowledgement"): each one turns an
 * ordinary "fixed it" reply into not-relevant/wont-fix for a fix that landed.
 */
const WONT_FIX_RE = /\bwon.?t\s+fix\b|\bwont\s+fix\b|\bby\s+design\b|\bintentional\b|\bnot\s+going\s+to\b|\bnwf\b|\bn\/a\b|\bout\s+of\s+scope\b|\bas\s+designed\b|\bworking\s+as\s+intended\b/i;

function hasWontFixReply(replies) {
  return replies.some((r) => WONT_FIX_RE.test(r.body ?? ""));
}

/**
 * Every review thread on the PR with the two fields REST cannot supply.
 *
 * `isResolved` is what closes the double-write: a thread the resolve trigger already
 * recorded must not be swept again. `isOutdated` is what closes the obsolete inversion:
 * an anchor that no longer exists makes both the touch branch and the terminal branch
 * unsound.
 *
 * Returns `{complete, byRootComment}`. `complete: false` means the walk stopped early —
 * treat the map as unusable and write nothing on the strength of it, NEVER as
 * "no more threads". Guessing "unresolved" here would convert a tooling gap into a
 * stream of false `ignored-at-merge` records, which is the failure this whole file
 * exists to avoid.
 */
function fetchReviewThreads({ repo, prNumber }) {
  const [owner, name] = String(repo).split("/");
  const query = `
    query($owner:String!,$repo:String!,$pr:Int!,$cursor:String){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$pr){
          reviewThreads(first:100, after:$cursor){
            pageInfo{ hasNextPage endCursor }
            nodes{ id isResolved isOutdated comments(first:100){ nodes{ databaseId } } }
          }
        }
      }
    }`;
  const byRootComment = new Map();
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    let data;
    try {
      data = ghGraphql(query, { owner, repo: name, pr: prNumber, cursor: cursor || "null" });
    } catch (err) {
      log("thread-state query failed:", err.message);
      return { complete: false, byRootComment };
    }
    const conn = data?.data?.repository?.pullRequest?.reviewThreads;
    if (!conn) return { complete: false, byRootComment };
    for (const node of conn.nodes ?? []) {
      const rootId = node.comments?.nodes?.[0]?.databaseId;
      if (rootId != null) {
        byRootComment.set(String(rootId), { id: node.id, isResolved: !!node.isResolved, isOutdated: !!node.isOutdated });
      }
    }
    if (!conn.pageInfo?.hasNextPage) return { complete: true, byRootComment };
    cursor = conn.pageInfo.endCursor;
  }
  return { complete: false, byRootComment };
}

/**
 * Did a commit after `since` touch the comment's region?
 *
 * With a line anchor this is `(path, line ± 10)`. WITHOUT one — a file-level comment,
 * whose `line` and `original_line` are both null — it degrades to "did any commit touch
 * this file at all", which is the honest weaker question and the one that closes
 * defect 2: an untouched file proves no fix, a touched file proves nothing.
 * Returns `{touched, granularity}`.
 */
function hasFixCommit({ repo, prNumber, path, line, since }) {
  const granularity = line > 0 ? "line" : "file";
  try {
    const commits = ghApiAll(`/repos/${repo}/pulls/${prNumber}/commits`);
    const afterComments = commits.filter((c) => new Date(c.commit.author.date) > new Date(since));
    for (const commit of afterComments) {
      try {
        const detail = ghApi(`/repos/${repo}/commits/${commit.sha}`);
        const touchedFile = (detail.files ?? []).find((f) => f.filename === path);
        if (!touchedFile) continue;
        if (granularity === "file") return { touched: true, granularity };
        const patch = touchedFile.patch ?? "";
        const hunkHeaders = [...patch.matchAll(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g)];
        for (const [, startStr, countStr] of hunkHeaders) {
          const start = parseInt(startStr, 10);
          const count = parseInt(countStr ?? "1", 10);
          const end = start + count;
          if (line >= start - 10 && line <= end + 10) return { touched: true, granularity };
        }
      } catch {
        // individual commit detail failed — continue
      }
    }
  } catch {
    // commit listing failed
  }
  return { touched: false, granularity };
}

function thumbsDownFrom(repo, commentId, logins) {
  try {
    const reactions = ghApiAll(`/repos/${repo}/pulls/comments/${commentId}/reactions`);
    const hit = reactions.find((r) => r.content === "-1" && logins.includes(r.user?.login));
    return hit ? hit.user.login : null;
  } catch {
    return null;
  }
}

// ── Decision tables (pure — exercised by --self-test) ────────────────────────────

/**
 * One resolved thread → a record, or a documented refusal to write.
 * Precedence mirrors `thread-resolution.md § Status precedence`: the author's own words
 * outrank anything inferred from the diff, and an undecidable anchor outranks both
 * inference branches.
 */
export function decideResolvedThread({ thumbsDownBy, replies, thread, regionTouched, commentPath, commentLine }) {
  if (thumbsDownBy) {
    return { relevance: "not-relevant", resolutionMethod: "wont-fix", reason: `PR author (${thumbsDownBy}) reacted 👎` };
  }
  if (hasWontFixReply(replies ?? [])) {
    return { relevance: "not-relevant", resolutionMethod: "wont-fix", reason: "Thread contains a won't-fix/by-design reply" };
  }
  // Defect 3. Without thread state we cannot tell a fix from a deletion, and the
  // terminal branch would assert acceptance on no evidence at all.
  if (!thread) {
    return { skip: "thread-state-unavailable", reason: "Thread state could not be read; both inference branches are unsound without it" };
  }
  if (thread.isOutdated) {
    return { skip: "anchor-gone", reason: "Thread is outdated — the code the finding was about is gone, so the outcome carries no signal about whether the finding was any good" };
  }
  if (commentPath && commentLine > 0 && regionTouched) {
    return { relevance: "relevant", resolutionMethod: "fixed", reason: `A commit after the comment touches ${commentPath}:${commentLine} ± 10` };
  }
  return { relevance: "relevant", resolutionMethod: "fixed", reason: "Thread resolved with a live anchor and no decline detected" };
}

/**
 * One thread at merge time → a record, or a documented refusal to write.
 * `ignored-at-merge` is only written where the evidence actually supports it: the thread
 * was open, nobody declined it, and no commit touched the region (or, for a file-level
 * comment, the file).
 */
export function decideMergeSweep({ thread, replies, thumbsDownBy, commentPath, commentLine, touch }) {
  if (!thread) {
    return { skip: "thread-state-unknown", reason: "Thread not present in the thread map; cannot establish it was open at merge" };
  }
  // Defect 1. The resolve trigger owns every resolved thread; sweeping it again writes
  // a second, often opposite, record on the same fingerprint.
  if (thread.isResolved) {
    return { skip: "already-recorded-on-resolve", reason: "Thread was resolved; the thread-resolved trigger owns its outcome" };
  }
  if (hasWontFixReply(replies ?? [])) {
    return { relevance: "not-relevant", resolutionMethod: "wont-fix", reason: "Thread was declined in a reply" };
  }
  // A 👎 with no reply is still a decline — and recording it as `ignored-at-merge`
  // would file an explicit rejection as mere neglect.
  if (thumbsDownBy) {
    return { relevance: "not-relevant", resolutionMethod: "wont-fix", reason: `Declined by 👎 from ${thumbsDownBy} with no reply` };
  }
  if (thread.isOutdated) {
    return { skip: "anchor-gone", reason: "Thread is outdated — the finding's subject is gone, so neither acceptance nor rejection happened" };
  }
  if (touch?.touched) {
    return {
      skip: "region-edited",
      reason: touch.granularity === "line"
        ? "A commit touched the commented region; the outcome is unknown, not ignored"
        : "A commit touched the commented file (no line anchor to narrow to); the outcome is unknown, not ignored",
    };
  }
  if (!commentPath) {
    return { skip: "no-anchor", reason: "Comment carries no path; nothing to corroborate against" };
  }
  return {
    relevance: "weak-not-relevant",
    resolutionMethod: "ignored-at-merge",
    reason: `Thread on ${commentPath}:${commentLine || 0} was open at merge with no fix ${touch?.granularity === "file" ? "(file untouched)" : "commit"} and no decline`,
  };
}

/**
 * A post-deploy regression → which record it justifies (proposal § 4.8.5).
 *
 * The asymmetry is deliberate. A regression on a file nobody flagged is the `missed`
 * signal the memory layer otherwise has no source for. A regression on a finding that
 * WAS raised and dismissed is the strongest possible amplify evidence. A regression on
 * a finding that was raised and fixed says nothing — the fix worked and the regression
 * is elsewhere. And "no regression" is never evidence of safety, so it writes nothing.
 */
export function decideDeployRegression({ flagged, dismissed, fixedBeforeMerge }) {
  if (!flagged) return { kind: "hotspot-missed", weight: 1 };
  if (fixedBeforeMerge) return { skip: "fix-landed", reason: "The finding was fixed before merge; this regression is not attributable to it" };
  if (dismissed) return { kind: "rule-amplify", weight: 3 };
  return { skip: "flagged-and-open", reason: "Finding was raised and neither dismissed nor fixed; no directional signal" };
}

// ── LoreKit writes ───────────────────────────────────────────────────────────────

function lorekitWrite({ scope, key, value, tags, kind, host, ttlMs }) {
  const apiKey = process.env.LOREKIT_API_KEY;
  if (!apiKey) {
    log("LOREKIT_API_KEY not set — skipping write (configure the secret to enable memory recording).");
    return false;
  }
  try {
    execSync(
      `npx --yes @lorekit/cli memory write` +
      ` --scope ${JSON.stringify(scope)}` +
      ` --key ${JSON.stringify(key)}` +
      ` --value ${JSON.stringify(JSON.stringify(value))}` +
      ` --tags ${JSON.stringify(tags.join(","))}` +
      (kind ? ` --kind ${JSON.stringify(kind)}` : "") +
      (host ? ` --host ${JSON.stringify(host)}` : "") +
      ` --source-agent "github-actions/reviewer-comment-relevance"`,
      {
        env: { ...process.env, LOREKIT_API_KEY: apiKey },
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    log(`Wrote ${key} (scope: ${scope})`);
    return true;
  } catch (err) {
    log("LoreKit write failed (non-blocking):", err.message);
    return false;
  }
}

/**
 * Write one relevance record.
 *
 * Two key spaces, on purpose. A v2 fingerprint is structural and stable, so it is filed
 * under `rule::<fp>` where the lifecycle can accumulate. A v1 fingerprint is derived
 * from prose and re-keys on every re-phrasing, so it keeps the legacy flat key and is
 * marked `promotable: false` — those rows are read for back-compat and left to lapse
 * rather than being allowed to arm a suppression rule on a wobbling key.
 *
 * `status` is written as an ADVISORY snapshot. The reader recomputes it from
 * `seen_count` (which LoreKit increments server-side on the same key) and the distinct
 * PRs in `evidence[]`, so a failed read-modify-write here can never reset a lifecycle
 * — see `agents/pr-reviewer/rules/memory.md § Lifecycle is computed at read time`.
 */
function writeRelevance({ repo, fpInfo, relevance, resolutionMethod, reason, commentId, prNumber, severity, signal }) {
  const scope = `repo::${repo.toLowerCase()}`;
  const promotable = fpInfo.fp_v === 2;
  const key = promotable
    ? `reviewer-comment-relevance::rule::${fpInfo.fp}`
    : `reviewer-comment-relevance::${fpInfo.fp}`;
  const direction = relevance === "relevant" ? "amplify" : "suppress";
  const record = {
    v: 2,
    fingerprint: fpInfo.fp,
    fp_v: fpInfo.fp_v,
    promotable,
    relevance,
    direction,
    reason,
    resolution_method: resolutionMethod,
    ...(severity ? { severity } : {}),
    source: fpInfo.source,
    status: "candidate",
    evidence: [{ pr: Number(prNumber), signal: signal ?? resolutionMethod, at: new Date().toISOString(), by: fpInfo.source.login }],
    examples: [`${repo}#${prNumber}` + (commentId ? ` comment ${commentId}` : "")],
    seen_count: 1,
    origin_pr: Number(prNumber),
    expires: new Date(Date.now() + RELEVANCE_TTL_MS).toISOString(),
  };
  return lorekitWrite({
    scope, key, value: record,
    tags: ["loop::reviewer-comment-relevance", `source::${resolutionMethod}`],
    kind: "signal", host: "reviewer", ttlMs: RELEVANCE_TTL_MS,
  });
}

/** Per-file defect counters that outlive the branch (proposal § 4.7.2). */
function writeHotspot({ repo, path, prNumber, kind, detail }) {
  const record = {
    v: 1,
    path,
    [kind]: 1,
    ...(detail ? { [`${kind}_examples`]: [detail] } : {}),
    last_touched_by: [{ pr: Number(prNumber), at: new Date().toISOString() }],
    expires: new Date(Date.now() + KNOWLEDGE_TTL_MS).toISOString(),
  };
  return lorekitWrite({
    scope: `repo::${repo.toLowerCase()}`,
    key: `hotspot::${path}`,
    value: record,
    tags: ["ci::review-knowledge", `signal::${kind}`],
    // `signal`, not `bus`: a hotspot is a durable per-repo priority input read at the
    // start of every run, not raw material awaiting distillation. `kind`/`host` are set
    // explicitly because LoreKit infers them only from a `loop::` tag.
    kind: "signal", host: "reviewer", ttlMs: KNOWLEDGE_TTL_MS,
  });
}

// ── Mode: thread-resolved ─────────────────────────────────────────────────────────

async function modeThreadResolved() {
  const repo        = process.env.GH_REPO;
  const prNumber    = process.env.PR_NUMBER;
  const commentId   = process.env.FIRST_COMMENT_ID;
  const commentPath = process.env.FIRST_COMMENT_PATH;
  const commentLine = parseInt(process.env.FIRST_COMMENT_LINE ?? "0", 10) || 0;
  const commentBody = process.env.FIRST_COMMENT_BODY ?? "";
  const commentAuthor = process.env.FIRST_COMMENT_AUTHOR ?? "";
  const commentTs   = process.env.FIRST_COMMENT_CREATED_AT ?? new Date(0).toISOString();

  if (!repo || !prNumber || !commentId) {
    log("Missing required env vars for thread-resolved mode — skipping.");
    return;
  }

  log(`Classifying resolved thread: PR #${prNumber} comment ${commentId} (${commentPath}:${commentLine})`);

  const fpInfo = resolveFingerprint(commentBody, commentAuthor, process.env.FIRST_COMMENT_AUTHOR_TYPE);
  if (!fpInfo.usable) {
    log("No usable fingerprint for this comment — skipping (an unvalidatable marker is treated as none).");
    return;
  }

  let replies = [];
  try {
    const allComments = ghApiAll(`/repos/${repo}/pulls/${prNumber}/comments`);
    replies = allComments.filter((c) => String(c.in_reply_to_id) === String(commentId));
  } catch (err) {
    log("Could not fetch thread replies:", err.message);
  }

  let prAuthor = "";
  try {
    prAuthor = ghApi(`/repos/${repo}/pulls/${prNumber}`).user?.login ?? "";
  } catch { /* non-blocking */ }

  const thumbsDownBy = prAuthor ? thumbsDownFrom(repo, commentId, [prAuthor]) : null;
  const { byRootComment } = fetchReviewThreads({ repo, prNumber });
  const thread = byRootComment.get(String(commentId)) ?? null;
  const regionTouched = commentPath && commentLine > 0
    ? hasFixCommit({ repo, prNumber, path: commentPath, line: commentLine, since: commentTs }).touched
    : false;

  const verdict = decideResolvedThread({ thumbsDownBy, replies, thread, regionTouched, commentPath, commentLine });
  if (verdict.skip) {
    log(`No write (${verdict.skip}): ${verdict.reason}`);
    return;
  }

  log(`Verdict: ${verdict.relevance} / ${verdict.resolutionMethod} | fingerprint: ${fpInfo.fp} (v${fpInfo.fp_v})`);
  writeRelevance({
    repo, fpInfo, prNumber, commentId,
    relevance: verdict.relevance,
    resolutionMethod: verdict.resolutionMethod,
    reason: verdict.reason,
    severity: severityFromBody(commentBody),
    signal: "thread-resolved",
  });
}

// ── Mode: pr-merged ───────────────────────────────────────────────────────────────

async function modePrMerged() {
  const repo     = process.env.GH_REPO;
  const prNumber = process.env.PR_NUMBER;

  if (!repo || !prNumber) {
    log("Missing required env vars for pr-merged mode — skipping.");
    return;
  }

  log(`Sweeping open threads at merge: PR #${prNumber}`);

  // Thread state FIRST: without it the sweep cannot tell an open thread from one the
  // resolve trigger already recorded, and every write would risk contradicting itself.
  const { complete, byRootComment } = fetchReviewThreads({ repo, prNumber });
  if (!complete) {
    log("Thread-state walk incomplete — aborting the sweep. A tooling gap must not become a stream of false ignored-at-merge records.");
    return;
  }

  let allComments = [];
  try {
    allComments = ghApiAll(`/repos/${repo}/pulls/${prNumber}/comments`);
  } catch (err) {
    log("Could not fetch PR comments:", err.message);
    return;
  }

  const roots = allComments.filter((c) => !c.in_reply_to_id);
  const replies = allComments.filter((c) => !!c.in_reply_to_id);
  let swept = 0;
  let skipped = 0;
  let reactionLookups = 0;

  for (const root of roots) {
    const threadReplies = replies.filter((r) => String(r.in_reply_to_id) === String(root.id));
    const thread = byRootComment.get(String(root.id)) ?? null;
    const commentPath = root.path ?? "";
    const commentLine = root.line ?? root.original_line ?? 0;

    // Cheap skips first, so the API calls below only happen for threads that could
    // actually produce a record.
    let verdict = decideMergeSweep({ thread, replies: threadReplies, thumbsDownBy: null, commentPath, commentLine, touch: null });
    if (verdict.skip && verdict.skip !== "region-edited" && verdict.skip !== "no-anchor") {
      skipped++;
      log(`Skip ${commentPath}:${commentLine} (${verdict.skip})`);
      continue;
    }

    const fpInfo = resolveFingerprint(root.body ?? "", root.user?.login, root.user?.type);
    if (!fpInfo.usable) { skipped++; continue; }
    // F13: a human's or a competitor bot's dismissed nit must never train this agent's
    // suppressor. It still counts as hotspot signal, which is written elsewhere.
    if (fpInfo.source.agent !== "pr-reviewer") {
      skipped++;
      log(`Skip ${commentPath}:${commentLine} (not this agent's comment: ${fpInfo.source.login ?? "unknown"})`);
      continue;
    }

    // At merge time there is no single privileged decliner, so any 👎 counts (§ 4.7.4).
    // Capped so a PR with hundreds of open threads cannot exhaust the API budget.
    const thumbsDownBy = reactionLookups < REACTION_LOOKUP_CAP
      ? (reactionLookups++, thumbsDownAnyone(repo, root.id))
      : null;

    const touch = commentPath
      ? hasFixCommit({ repo, prNumber, path: commentPath, line: commentLine, since: root.created_at })
      : { touched: false, granularity: "file" };

    verdict = decideMergeSweep({ thread, replies: threadReplies, thumbsDownBy, commentPath, commentLine, touch });
    if (verdict.skip) {
      skipped++;
      log(`Skip ${commentPath}:${commentLine} (${verdict.skip}): ${verdict.reason}`);
      continue;
    }

    log(`${verdict.relevance}/${verdict.resolutionMethod}: ${commentPath}:${commentLine} | fingerprint: ${fpInfo.fp}`);
    writeRelevance({
      repo, fpInfo, prNumber, commentId: root.id,
      relevance: verdict.relevance,
      resolutionMethod: verdict.resolutionMethod,
      reason: verdict.reason,
      severity: severityFromBody(root.body ?? ""),
      signal: "pr-merged-sweep",
    });
    swept++;
  }

  log(`Sweep complete: ${swept} recorded, ${skipped} skipped as undecidable or already-owned.`);
}

/** Any 👎 from anyone with write access counts as a decline signal (proposal § 4.7.4). */
function thumbsDownAnyone(repo, commentId) {
  try {
    const reactions = ghApiAll(`/repos/${repo}/pulls/comments/${commentId}/reactions`);
    const hit = reactions.find((r) => r.content === "-1");
    return hit ? hit.user?.login ?? "unknown" : null;
  } catch {
    return null;
  }
}

// ── Mode: human-comment ───────────────────────────────────────────────────────────
//
// The `missed` signal. A human reviewer commenting on a changed line this agent did NOT
// flag is the only direct evidence that detection came up short, and nothing else in the
// memory layer produces it.

async function modeHumanComment() {
  const repo = process.env.GH_REPO;
  const prNumber = process.env.PR_NUMBER;
  const commentPath = process.env.FIRST_COMMENT_PATH;
  const commentLine = parseInt(process.env.FIRST_COMMENT_LINE ?? "0", 10) || 0;
  const authorType = process.env.FIRST_COMMENT_AUTHOR_TYPE;
  const author = process.env.FIRST_COMMENT_AUTHOR ?? "";

  if (!repo || !prNumber || !commentPath) {
    log("Missing required env vars for human-comment mode — skipping.");
    return;
  }
  if (authorType === "Bot") {
    log("Comment is from a bot — not a missed-detection signal.");
    return;
  }

  let ourComments = [];
  try {
    ourComments = ghApiAll(`/repos/${repo}/pulls/${prNumber}/comments`)
      .filter((c) => resolveFingerprint(c.body ?? "", c.user?.login, c.user?.type).source.agent === "pr-reviewer");
  } catch (err) {
    log("Could not fetch PR comments:", err.message);
    return;
  }

  const nearby = ourComments.some(
    (c) => (c.path ?? "") === commentPath && Math.abs((c.line ?? c.original_line ?? 0) - commentLine) <= 5,
  );
  if (nearby) {
    log("This agent already flagged the same region — not a miss.");
    return;
  }

  log(`Missed detection: ${author} commented on ${commentPath}:${commentLine}, unflagged.`);
  writeHotspot({
    repo, path: commentPath, prNumber, kind: "missed",
    detail: { pr: Number(prNumber), line: commentLine, by: author },
  });
}

// ── Mode: deploy-regression ───────────────────────────────────────────────────────
//
// Proposal § 4.8.5. This script has no telemetry client: whatever holds the Dash0
// credentials (a caller step, or a Routine in the reviewer's environment) computes the
// comparison and hands the result in through REGRESSION_REPORT. Keeping the query out
// of here is what lets the decision table be tested offline.
//
// REGRESSION_REPORT (a path, or inline JSON):
//   { "pr": 123, "sha": "…",
//     "regressions": [ { "path": "src/api/client.ts", "symbol": "retryRequest",
//                        "exception_type": "TimeoutError", "before_rate": 0.001, "after_rate": 0.02 } ] }

async function modeDeployRegression() {
  const repo = process.env.GH_REPO;
  const raw = process.env.REGRESSION_REPORT;
  if (!repo || !raw) {
    log("Missing GH_REPO or REGRESSION_REPORT — skipping.");
    return;
  }

  let report;
  try {
    report = JSON.parse(raw.trim().startsWith("{") ? raw : readFileSync(raw, "utf8"));
  } catch (err) {
    log("Could not parse REGRESSION_REPORT:", err.message);
    return;
  }
  const prNumber = report.pr ?? process.env.PR_NUMBER;
  const regressions = report.regressions ?? [];
  if (!prNumber || !regressions.length) {
    log("No regressions in the report — writing nothing. Silence is not evidence of safety, so there is no confirmed-safe counter.");
    return;
  }

  let ourComments = [];
  try {
    ourComments = ghApiAll(`/repos/${repo}/pulls/${prNumber}/comments`);
  } catch (err) {
    log("Could not fetch PR comments:", err.message);
  }

  for (const reg of regressions) {
    const path = reg.path;
    if (!path) continue;
    // Attribution is by SYMBOL where the report supplies one, and by path otherwise.
    // Per-file attribution alone would credit a fix that landed for a regression that
    // came from somewhere else in the same file.
    const flaggedComments = ourComments.filter((c) => {
      const info = resolveFingerprint(c.body ?? "", c.user?.login, c.user?.type);
      if (info.source.agent !== "pr-reviewer" || !info.fp) return false;
      const parts = parseFingerprint(info.fp);
      if (!parts) return (c.path ?? "") === path;
      return parts.path === path && (!reg.symbol || parts.symbol === reg.symbol || parts.symbol === "-");
    });

    const dismissed = flaggedComments.some((c) => WONT_FIX_RE.test(c.body ?? "") || c.__dismissed);
    const decision = decideDeployRegression({
      flagged: flaggedComments.length > 0,
      dismissed: dismissed || (reg.dismissed ?? false),
      fixedBeforeMerge: reg.fixed_before_merge ?? false,
    });

    if (decision.skip) {
      log(`No write for ${path} (${decision.skip}): ${decision.reason}`);
      continue;
    }
    if (decision.kind === "hotspot-missed") {
      log(`Regression on unflagged ${path} → hotspot missed`);
      writeHotspot({
        repo, path, prNumber, kind: "missed",
        detail: { pr: Number(prNumber), exception_type: reg.exception_type ?? null, source: "post-deploy" },
      });
      continue;
    }
    if (decision.kind === "rule-amplify") {
      const info = resolveFingerprint(flaggedComments[0].body ?? "", flaggedComments[0].user?.login, flaggedComments[0].user?.type);
      log(`Regression on dismissed finding ${info.fp} → amplify (weight ${decision.weight})`);
      writeRelevance({
        repo, fpInfo: info, prNumber, commentId: flaggedComments[0].id,
        relevance: "relevant",
        resolutionMethod: "fixed",
        reason: `Dismissed finding regressed in production after deploy (${reg.exception_type ?? "error-rate rise"}); one production regression outweighs three 👎`,
        severity: severityFromBody(flaggedComments[0].body ?? ""),
        signal: "post-deploy-regression",
      });
    }
  }
}

// ── Self-test ────────────────────────────────────────────────────────────────────
//
// The decision tables are the whole correctness surface of this file, and all three
// corrections above live in them. L1 executes this, so a regression is caught before it
// can quietly write contradictory records into a durable signal again.

function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);
  const open = { isResolved: false, isOutdated: false };
  const resolved = { isResolved: true, isOutdated: false };
  const outdated = { isResolved: false, isOutdated: true };

  // ── pagination (DEFECT 4: absence is read as a negative signal, so a short read inverts it) ──
  const fakePages = (total) => (p) => {
    const page = Number(/[?&]page=(\d+)/.exec(p)[1]);
    const start = (page - 1) * PAGE_SIZE;
    return Array.from({ length: Math.max(0, Math.min(PAGE_SIZE, total - start)) }, (_, i) => ({ id: start + i }));
  };

  t("pagination: a single short page returns everything and stops", () =>
    ghApiAll("/x", fakePages(7)).length === 7);

  t("pagination: an exactly-full page is followed by a probe for the next", () => {
    // Asserts the CALL, not the length: a page-1-only implementation also returns
    // PAGE_SIZE items here, so length alone cannot tell the two apart.
    let calls = 0;
    const r = ghApiAll("/x", (p) => { calls++; return fakePages(PAGE_SIZE)(p); });
    return calls === 2 && r.length === PAGE_SIZE;
  });

  t("pagination: 3 pages of comments are all returned, in order", () => {
    const all = ghApiAll("/x", fakePages(PAGE_SIZE * 2 + 5));
    return all.length === PAGE_SIZE * 2 + 5 && all[0].id === 0 && all.at(-1).id === PAGE_SIZE * 2 + 4;
  });

  t("pagination: the 31st comment is reachable — the exact defect, against an API that defaults to 30", () => {
    // The fake honours per_page and falls back to GitHub's default of 30 when it is
    // absent, which is what made the 31st comment invisible. Asserting against a
    // fake that always honours per_page would pass without pagination at all,
    // because 31 fits in one 100-item page.
    const apiDefaulting = (p) => {
      const size = Number(/[?&]per_page=(\d+)/.exec(p)?.[1] ?? 30);
      const page = Number(/[?&]page=(\d+)/.exec(p)?.[1] ?? 1);
      const start = (page - 1) * size;
      return Array.from({ length: Math.max(0, Math.min(size, 31 - start)) }, (_, i) => ({ id: start + i }));
    };
    return PAGE_SIZE > 30 && ghApiAll("/x", apiDefaulting).some((c) => c.id === 30);
  });

  t("pagination: per_page is actually requested, not left to the API default", () => {
    let seen = "";
    ghApiAll("/x", (p) => { seen = p; return []; });
    return seen.includes(`per_page=${PAGE_SIZE}`) && seen.includes("page=1");
  });

  t("pagination: an existing query string is appended to with &, not ?", () => {
    let seen = "";
    ghApiAll("/x?since=2026-01-01", (p) => { seen = p; return []; });
    return seen.includes("?since=2026-01-01&per_page=");
  });

  t("pagination: overflow throws rather than silently truncating", () => {
    try { ghApiAll("/x", fakePages(PAGE_SIZE * MAX_PAGES + 1)); return false; }
    catch (e) { return /refusing to return a truncated list/.test(e.message); }
  });

  t("pagination: a non-array response throws instead of being spread", () => {
    try { ghApiAll("/x", () => ({ message: "Not Found" })); return false; }
    catch (e) { return /expected a JSON array/.test(e.message); }
  });

  // ── thread-resolved ──
  t("a 👎 from the author is a decline", () =>
    decideResolvedThread({ thumbsDownBy: "alice", replies: [], thread: open }).resolutionMethod === "wont-fix");

  t("a won't-fix reply is a decline", () =>
    decideResolvedThread({ thumbsDownBy: null, replies: [{ body: "by design" }], thread: open }).resolutionMethod === "wont-fix");

  t("a decline outranks a region touch", () =>
    decideResolvedThread({ thumbsDownBy: null, replies: [{ body: "out of scope" }], thread: open, regionTouched: true, commentPath: "a.ts", commentLine: 3 }).relevance === "not-relevant");

  t("DEFECT 3: an outdated anchor writes nothing, even with a region touch", () => {
    const v = decideResolvedThread({ thumbsDownBy: null, replies: [], thread: outdated, regionTouched: true, commentPath: "a.ts", commentLine: 3 });
    return v.skip === "anchor-gone" && !v.relevance;
  });

  t("DEFECT 3: an outdated anchor writes nothing on the terminal branch either", () =>
    decideResolvedThread({ thumbsDownBy: null, replies: [], thread: outdated }).skip === "anchor-gone");

  t("an outdated anchor does NOT suppress the author's own words", () =>
    decideResolvedThread({ thumbsDownBy: "bob", replies: [], thread: outdated }).resolutionMethod === "wont-fix");

  t("missing thread state writes nothing rather than guessing", () =>
    decideResolvedThread({ thumbsDownBy: null, replies: [], thread: null, regionTouched: true, commentPath: "a.ts", commentLine: 1 }).skip === "thread-state-unavailable");

  t("a live anchor with a region touch is relevant/fixed", () =>
    decideResolvedThread({ thumbsDownBy: null, replies: [], thread: open, regionTouched: true, commentPath: "a.ts", commentLine: 3 }).resolutionMethod === "fixed");

  t("a live anchor resolved with no decline is still relevant/fixed", () =>
    decideResolvedThread({ thumbsDownBy: null, replies: [], thread: open, regionTouched: false, commentPath: "a.ts", commentLine: 3 }).relevance === "relevant");

  // ── pr-merged sweep ──
  t("DEFECT 1: a resolved thread is never swept (no second, opposite record)", () =>
    decideMergeSweep({ thread: resolved, replies: [], commentPath: "a.ts", commentLine: 3, touch: { touched: false, granularity: "line" } }).skip === "already-recorded-on-resolve");

  t("DEFECT 1: a 👎-declined thread is recorded as a decline, not as neglect", () => {
    const v = decideMergeSweep({ thread: open, replies: [], thumbsDownBy: "alice", commentPath: "a.ts", commentLine: 3, touch: { touched: false, granularity: "line" } });
    return v.resolutionMethod === "wont-fix" && v.relevance === "not-relevant";
  });

  t("DEFECT 2: a file-level comment on an UNTOUCHED file is decidable as ignored-at-merge", () => {
    const v = decideMergeSweep({ thread: open, replies: [], commentPath: "a.ts", commentLine: 0, touch: { touched: false, granularity: "file" } });
    return v.resolutionMethod === "ignored-at-merge" && /file untouched/.test(v.reason);
  });

  t("DEFECT 2: a file-level comment on a TOUCHED file writes nothing", () => {
    const v = decideMergeSweep({ thread: open, replies: [], commentPath: "a.ts", commentLine: 0, touch: { touched: true, granularity: "file" } });
    return v.skip === "region-edited" && /no line anchor/.test(v.reason);
  });

  t("a line-anchored thread whose region was edited writes nothing", () =>
    decideMergeSweep({ thread: open, replies: [], commentPath: "a.ts", commentLine: 9, touch: { touched: true, granularity: "line" } }).skip === "region-edited");

  t("an open, untouched, undeclined thread is ignored-at-merge", () =>
    decideMergeSweep({ thread: open, replies: [], commentPath: "a.ts", commentLine: 9, touch: { touched: false, granularity: "line" } }).resolutionMethod === "ignored-at-merge");

  t("a thread absent from the thread map writes nothing", () =>
    decideMergeSweep({ thread: null, replies: [], commentPath: "a.ts", commentLine: 9, touch: { touched: false, granularity: "line" } }).skip === "thread-state-unknown");

  t("an outdated open thread writes nothing at merge", () =>
    decideMergeSweep({ thread: outdated, replies: [], commentPath: "a.ts", commentLine: 9, touch: { touched: false, granularity: "line" } }).skip === "anchor-gone");

  t("a declined thread at merge is recorded as a decline, not as ignored", () =>
    decideMergeSweep({ thread: open, replies: [{ body: "won't fix" }], commentPath: "a.ts", commentLine: 9, touch: { touched: false, granularity: "line" } }).resolutionMethod === "wont-fix");

  t("no path means nothing to corroborate against", () =>
    decideMergeSweep({ thread: open, replies: [], commentPath: "", commentLine: 0, touch: { touched: false, granularity: "file" } }).skip === "no-anchor");

  // ── the two triggers cannot both write for one thread ──
  //
  // The two events are separated by `isResolved`, not by anything the deciders inspect
  // in common: `thread_resolved` fires only on a thread GitHub has already marked
  // resolved, and the merge sweep sees each thread in whatever state it ended in. So the
  // invariant is a sequencing one, and asserting it means holding the resolve verdict
  // against the sweep verdict *for the state the sweep would actually observe*.
  t("a thread the resolve trigger wrote for is never swept again", () => {
    for (const touchedThen of [true, false]) {
      for (const touchedAtMerge of [true, false]) {
        const a = decideResolvedThread({ thumbsDownBy: null, replies: [], thread: resolved, regionTouched: touchedThen, commentPath: "a.ts", commentLine: 3 });
        if (a.skip) continue; // the resolve trigger declined to write; the sweep is free to
        // The thread is resolved from that moment on, which is the state the sweep sees.
        const b = decideMergeSweep({ thread: resolved, replies: [], commentPath: "a.ts", commentLine: 3, touch: { touched: touchedAtMerge, granularity: "line" } });
        if (b.skip !== "already-recorded-on-resolve") return false; // the double-write defect
      }
    }
    return true;
  });

  t("every thread the sweep writes for is one the resolve trigger never saw", () => {
    for (const thread of [open, resolved, outdated]) {
      for (const touched of [true, false]) {
        const b = decideMergeSweep({ thread, replies: [], commentPath: "a.ts", commentLine: 3, touch: { touched, granularity: "line" } });
        if (b.skip) continue;
        // A write here is only sound if the thread is unresolved — an unresolved thread
        // cannot have fired `pull_request_review_thread.resolved`.
        if (thread.isResolved) return false;
      }
    }
    return true;
  });

  // ── post-deploy regression ──
  t("a regression on an unflagged file is the missed signal", () =>
    decideDeployRegression({ flagged: false }).kind === "hotspot-missed");

  t("a regression on a dismissed finding amplifies it, at weight 3", () => {
    const d = decideDeployRegression({ flagged: true, dismissed: true });
    return d.kind === "rule-amplify" && d.weight === 3;
  });

  t("a regression after the finding was fixed writes nothing", () =>
    decideDeployRegression({ flagged: true, dismissed: true, fixedBeforeMerge: true }).skip === "fix-landed");

  t("a regression on a raised-but-open finding writes nothing", () =>
    decideDeployRegression({ flagged: true, dismissed: false }).skip === "flagged-and-open");

  // ── attribution ──
  t("a v2 marker identifies this agent's comment without any login config", () => {
    const info = resolveFingerprint("issue (high): x\n<!-- fp:v2:correctness:logic:f@a.ts -->", "someone[bot]", "Bot");
    return info.source.agent === "pr-reviewer" && info.fp_v === 2 && info.usable;
  });

  t("an unmarked comment is attributed to `other`, so it cannot train the suppressor", () => {
    const info = resolveFingerprint("nitpick: rename this", "human-reviewer", "User");
    return info.source.agent === "other" && info.source.type === "human" && info.fp_v === 1;
  });

  t("an unvalidatable marker is not usable", () => {
    const info = resolveFingerprint("issue: x\n<!-- fp:v9:whatever@here -->", "x", "Bot");
    return info.usable === false;
  });

  t("severity is read from the visible tier label", () =>
    severityFromBody("issue (high): x") === "high" && severityFromBody("issue: x") === null);

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch (err) { process.stderr.write(`self-test THREW: ${name}: ${err.message}\n`); }
    if (!ok) { failed++; process.stderr.write(`self-test FAIL: ${name}\n`); }
  }
  if (failed > 0) process.exit(1);
  process.stderr.write(`self-test OK: ${cases.length} cases\n`);
}

// ── Entry point ───────────────────────────────────────────────────────────────────

const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1];

if (process.argv.includes("--self-test")) {
  selfTest();
} else if (mode === "thread-resolved") {
  modeThreadResolved().catch((err) => { log("Unexpected error:", err.message); process.exit(0); });
} else if (mode === "pr-merged") {
  modePrMerged().catch((err) => { log("Unexpected error:", err.message); process.exit(0); });
} else if (mode === "human-comment") {
  modeHumanComment().catch((err) => { log("Unexpected error:", err.message); process.exit(0); });
} else if (mode === "deploy-regression") {
  modeDeployRegression().catch((err) => { log("Unexpected error:", err.message); process.exit(0); });
} else {
  log(`Unknown mode: ${mode ?? "(none)"}. Pass --mode=thread-resolved|pr-merged|human-comment|deploy-regression, or --self-test.`);
  process.exit(0);
}
