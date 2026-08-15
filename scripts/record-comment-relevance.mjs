#!/usr/bin/env node
/**
 * record-comment-relevance.mjs
 *
 * Records the relevance signal for a resolved PR review thread (or a batch of
 * open threads at merge time) into the LoreKit `reviewer-comment-relevance`
 * memory bucket.
 *
 * Invoked by the GitHub Actions workflow `.github/workflows/reviewer-comment-relevance.yml`.
 * Receives context via environment variables set by the workflow from the
 * GitHub webhook payload.
 *
 * Two modes:
 *   --mode=thread-resolved   Single resolved thread from pull_request_review_thread event.
 *   --mode=pr-merged         Sweep open threads at PR merge from pull_request.closed event.
 *
 * Required env vars (set by the workflow):
 *   GITHUB_TOKEN             For gh api calls (read-only).
 *   LOREKIT_API_KEY          LoreKit API key for memory writes.
 *   GH_REPO                  owner/repo (e.g. "mthines/agent-skills").
 *   PR_NUMBER                Pull request number.
 *
 * Mode-specific env vars:
 *   --mode=thread-resolved:
 *     THREAD_ID              GitHub thread node_id.
 *     FIRST_COMMENT_ID       Numeric ID of the first comment in the thread.
 *     FIRST_COMMENT_PATH     File path the comment was on.
 *     FIRST_COMMENT_LINE     Line number the comment was on.
 *     FIRST_COMMENT_BODY     Body of the first comment (for fingerprinting).
 *     FIRST_COMMENT_AUTHOR   Login of the comment author.
 *     FIRST_COMMENT_CREATED_AT  ISO 8601 timestamp of the first comment.
 *
 * Exit codes:
 *   0  Success or graceful no-op (LoreKit not configured, nothing actionable).
 *   1  Hard failure (unexpected crash — should not happen in production).
 */

import { execSync } from "node:child_process";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
 * Derive a stable fingerprint slug from a comment body.
 * Strips code fragments and normalises to a 3-6 word slug.
 * This must stay in sync with the fingerprint the agents use in
 * agents/shared/rules/comment-relevance-memory.md.
 *
 * Format: <category>:<claim-gist>
 *   category   = the Conventional Comments prefix if detectable, else "suggestion"
 *   claim-gist = 3-6 word kebab slug of the substantive claim
 */
function fingerprint(commentBody) {
  const body = commentBody ?? "";

  // Detect Conventional Comments prefix
  const ccPrefixes = ["issue", "suggestion", "nitpick", "nit", "question", "praise", "chore"];
  let category = "suggestion";
  for (const prefix of ccPrefixes) {
    if (new RegExp(`^\\*?\\*?${prefix}[:(]`, "i").test(body.trim())) {
      category = prefix === "nit" ? "nitpick" : prefix;
      break;
    }
  }

  // Extract substantive claim words (strip markdown, code spans, URLs, punctuation)
  const cleaned = body
    .replace(/```[\s\S]*?```/g, "") // fenced code
    .replace(/`[^`]+`/g, "")        // inline code
    .replace(/https?:\/\/\S+/g, "") // URLs
    .replace(/[^a-z0-9 ]/gi, " ")   // non-word chars
    .toLowerCase()
    .replace(/\b(this|that|the|a|an|is|it|in|on|at|to|of|for|and|or|but|with|can|you|we|should|would|could|please|here|if|then|when|be)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  const claimGist = words.join("-") || "general-finding";

  return `${category}:${claimGist}`;
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
 * Check whether any commit after `since` (ISO string) touches (path, line ± 10).
 * Returns true if a fix commit is found.
 */
function hasFixCommit({ repo, prNumber, path, line, since }) {
  try {
    const commits = ghApi(`/repos/${repo}/pulls/${prNumber}/commits`);
    const afterComments = commits.filter(
      (c) => new Date(c.commit.author.date) > new Date(since),
    );
    for (const commit of afterComments) {
      try {
        const detail = ghApi(`/repos/${repo}/commits/${commit.sha}`);
        const touchedFile = (detail.files ?? []).find(
          (f) => f.filename === path,
        );
        if (!touchedFile) continue;
        // Parse the patch hunk headers to see if our line falls within the changed range.
        const patch = touchedFile.patch ?? "";
        const hunkHeaders = [...patch.matchAll(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/g)];
        for (const [, startStr, countStr] of hunkHeaders) {
          const start = parseInt(startStr, 10);
          const count = parseInt(countStr ?? "1", 10);
          const end = start + count;
          if (line >= start - 10 && line <= end + 10) {
            return true;
          }
        }
      } catch {
        // individual commit detail failed — continue
      }
    }
  } catch {
    // commit listing failed
  }
  return false;
}

/**
 * Write one relevance record to LoreKit via the CLI.
 * Exits 0 gracefully if LOREKIT_API_KEY is not set (not configured).
 */
function writeLorekit({ scope, key, relevance, resolutionMethod, reason, commentId, prRef }) {
  const apiKey = process.env.LOREKIT_API_KEY;
  if (!apiKey) {
    log("LOREKIT_API_KEY not set — skipping write (configure the secret to enable memory recording).");
    return;
  }

  const record = JSON.stringify({
    fingerprint: key.replace("reviewer-comment-relevance::", ""),
    relevance,
    reason,
    resolution_method: resolutionMethod,
    examples: [prRef + (commentId ? ` comment ${commentId}` : "")],
    seen_count: 1,       // LoreKit CLI handles UPDATE / increment server-side on same key
    status: "active",
    expires: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const tagsArg = `loop::reviewer-comment-relevance,source::${resolutionMethod}`;

  try {
    execSync(
      `npx --yes @lorekit/cli memory write` +
      ` --scope ${JSON.stringify(scope)}` +
      ` --key ${JSON.stringify(key)}` +
      ` --value ${JSON.stringify(record)}` +
      ` --tags ${JSON.stringify(tagsArg)}` +
      ` --source-agent "github-actions/reviewer-comment-relevance"`,
      {
        env: { ...process.env, LOREKIT_API_KEY: apiKey },
        encoding: "utf8",
        timeout: 30_000,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    log(`Wrote ${relevance}/${resolutionMethod} memory: ${key} (scope: ${scope})`);
  } catch (err) {
    log("LoreKit write failed (non-blocking):", err.message);
  }
}

// ── Mode: thread-resolved ─────────────────────────────────────────────────────

async function modeThreadResolved() {
  const repo        = process.env.GH_REPO;
  const prNumber    = process.env.PR_NUMBER;
  const commentId   = process.env.FIRST_COMMENT_ID;
  const commentPath = process.env.FIRST_COMMENT_PATH;
  const commentLine = parseInt(process.env.FIRST_COMMENT_LINE ?? "0", 10);
  const commentBody = process.env.FIRST_COMMENT_BODY ?? "";
  const commentTs   = process.env.FIRST_COMMENT_CREATED_AT ?? new Date(0).toISOString();

  if (!repo || !prNumber || !commentId) {
    log("Missing required env vars for thread-resolved mode — skipping.");
    return;
  }

  log(`Classifying resolved thread: PR #${prNumber} comment ${commentId} (${commentPath}:${commentLine})`);

  // Fetch replies in this thread (excluding the root comment) to check for won't-fix language.
  let replies = [];
  try {
    const allComments = ghApi(`/repos/${repo}/pulls/${prNumber}/comments`);
    replies = allComments.filter(
      (c) => String(c.in_reply_to_id) === String(commentId),
    );
  } catch (err) {
    log("Could not fetch thread replies:", err.message);
  }

  // Fetch PR author to detect 👎 reaction.
  let prAuthor = "";
  try {
    const pr = ghApi(`/repos/${repo}/pulls/${prNumber}`);
    prAuthor = pr.user?.login ?? "";
  } catch { /* non-blocking */ }

  // Check 👎 reaction from PR author.
  let thumbsDownFromAuthor = false;
  try {
    const reactions = ghApi(`/repos/${repo}/pulls/comments/${commentId}/reactions`);
    thumbsDownFromAuthor = reactions.some(
      (r) => r.content === "-1" && r.user?.login === prAuthor,
    );
  } catch { /* non-blocking */ }

  // Determine verdict.
  let relevance;
  let resolutionMethod;
  let reason;

  if (thumbsDownFromAuthor) {
    relevance        = "not-relevant";
    resolutionMethod = "wont-fix";
    reason           = `PR author (${prAuthor}) reacted 👎 to comment ${commentId}`;
  } else if (hasWontFixReply(replies)) {
    relevance        = "not-relevant";
    resolutionMethod = "wont-fix";
    reason           = `Thread contains a won't-fix/by-design reply`;
  } else if (
    commentPath &&
    commentLine > 0 &&
    hasFixCommit({ repo, prNumber, path: commentPath, line: commentLine, since: commentTs })
  ) {
    relevance        = "relevant";
    resolutionMethod = "fixed";
    reason           = `A commit after the comment touches ${commentPath}:${commentLine} ± 10`;
  } else {
    // Resolved without a detected fix commit or explicit decline.
    // Conservative: treat as relevant/fixed (human resolved the thread manually).
    relevance        = "relevant";
    resolutionMethod = "fixed";
    reason           = `Thread resolved by reviewer; no explicit decline detected`;
  }

  const fp    = fingerprint(commentBody);
  const scope = `repo::${repo.toLowerCase()}`;
  const key   = `reviewer-comment-relevance::${fp}`;
  const prRef = `${repo}#${prNumber}`;

  log(`Verdict: ${relevance} / ${resolutionMethod} | fingerprint: ${fp}`);
  writeLorekit({ scope, key, relevance, resolutionMethod, reason, commentId, prRef });
}

// ── Mode: pr-merged ───────────────────────────────────────────────────────────

async function modePrMerged() {
  const repo     = process.env.GH_REPO;
  const prNumber = process.env.PR_NUMBER;

  if (!repo || !prNumber) {
    log("Missing required env vars for pr-merged mode — skipping.");
    return;
  }

  log(`Sweeping open threads at merge: PR #${prNumber}`);

  // Fetch all review comments on the PR.
  let allComments = [];
  try {
    allComments = ghApi(`/repos/${repo}/pulls/${prNumber}/comments`);
  } catch (err) {
    log("Could not fetch PR comments:", err.message);
    return;
  }

  // Group into threads: root comments (no in_reply_to_id) are thread roots.
  const roots = allComments.filter((c) => !c.in_reply_to_id);
  const replies = allComments.filter((c) => !!c.in_reply_to_id);

  // Identify which threads are UNRESOLVED at merge time.
  // GitHub does not expose thread resolved state in the REST API comments list,
  // but we can infer: a thread is "handled" if it was resolved via the
  // pull_request_review_thread.resolved event (already captured by this workflow)
  // OR if a fix commit touches the commented line.
  // Here we emit weak-not-relevant for threads with no fix commit and no won't-fix reply —
  // those were silently ignored through to merge.

  const prRef = `${repo}#${prNumber}`;
  let swept = 0;

  for (const root of roots) {
    const threadReplies = replies.filter(
      (r) => String(r.in_reply_to_id) === String(root.id),
    );

    // Skip if a won't-fix reply exists — already captured correctly by thread-resolved path
    // or would be misleading to double-count as ignored.
    if (hasWontFixReply(threadReplies)) continue;

    // Skip if there's a fix commit — already captured as relevant by thread-resolved path.
    const commentPath = root.path ?? "";
    const commentLine = root.line ?? root.original_line ?? 0;
    if (
      commentPath &&
      commentLine > 0 &&
      hasFixCommit({
        repo,
        prNumber,
        path: commentPath,
        line: commentLine,
        since: root.created_at,
      })
    ) {
      continue;
    }

    // Thread had no fix commit, no won't-fix reply → ignored at merge.
    const fp    = fingerprint(root.body ?? "");
    const scope = `repo::${repo.toLowerCase()}`;
    const key   = `reviewer-comment-relevance::${fp}`;

    log(`Ignored at merge: ${commentPath}:${commentLine} | fingerprint: ${fp}`);
    writeLorekit({
      scope,
      key,
      relevance: "weak-not-relevant",
      resolutionMethod: "ignored-at-merge",
      reason: `Thread on ${commentPath}:${commentLine} was open at merge with no fix commit or explicit decline`,
      commentId: root.id,
      prRef,
    });
    swept++;
  }

  log(`Swept ${swept} open thread(s) as ignored-at-merge.`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const mode = process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1];

if (mode === "thread-resolved") {
  modeThreadResolved().catch((err) => {
    log("Unexpected error:", err.message);
    process.exit(0); // non-blocking — always exit 0
  });
} else if (mode === "pr-merged") {
  modePrMerged().catch((err) => {
    log("Unexpected error:", err.message);
    process.exit(0);
  });
} else {
  log(`Unknown mode: ${mode ?? "(none)"}. Pass --mode=thread-resolved or --mode=pr-merged.`);
  process.exit(0);
}
