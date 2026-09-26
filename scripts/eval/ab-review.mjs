#!/usr/bin/env node
// @ts-check
/**
 * ab-review.mjs — the A/B quality harness scorer for the pr-reviewer
 * deterministic-pipeline rewrite (AC-13, AC-20, AC-21, AC-22, D11-D13).
 *
 * Five subcommands, no GitHub mutation verb anywhere in this file (AC-23) — the two
 * new ones below (`pick-review-sha`, `plan`) are GET-only and filesystem-only
 * respectively; neither ever issues a GitHub write.
 *
 *   pick-review-sha --manifest <m> [--write]
 *     D12. Read-only against each manifest entry's `repo`/`number`: fetches the PR's
 *     author (`pulls/{n}`), its full commit list (`pulls/{n}/commits`, paginated), and
 *     its root review comments (`pulls/{n}/comments`, paginated) via the SAME `ghApi`/
 *     `ghApiAll` helpers `record-comment-relevance.mjs` and `thread-outcomes.mjs`
 *     already ship — never a re-derivation. Computes `review_sha` via the pure
 *     `pickReviewSha()` below and prints it per entry. `--write` persists the computed
 *     values into the manifest file in place (still only the allowlisted `review_sha`
 *     key — never a rationale, a thread count, or any other field). Without `--write`
 *     this is a dry run: nothing on disk changes.
 *
 *   plan --manifest <m> --worktree <abs> --arms A,B --runs 3 --out <dir>
 *     AC-21. Builds `<dir>/matrix.json` via the pure `buildMatrix()` below: one dispatch
 *     entry per (usable manifest entry) x (arm) x (run), each naming the worktree
 *     definition by ABSOLUTE path, `subagent_type: "general-purpose"` (never the
 *     installed `pr-reviewer` agent by name — D11's whole point), and the exact flags
 *     `--dry-run --isolated --review-sha <40-hex>`. A manifest entry with no valid
 *     40-hex `review_sha` is skipped by name, never silently dropped. This script never
 *     dispatches anything itself — the caller (a top-level session holding the Agent/
 *     Task tool) reads `matrix.json` and issues the dispatches.
 *
 *   record-meta --matrix <matrix.json> --index <i> --runs <dir> --tokens <n> --wall-clock-ms <n>
 *     Writes `<runs>/<dispatch.run_dir>/dispatch-meta.json` for the i-th dispatch after it
 *     finishes: `{tokens_used, wall_clock_ms, reviewed_sha}`, with `reviewed_sha` taken from the
 *     matrix entry's own `--review-sha` pin (`buildDispatchMeta`), never typed by the caller.
 *
 *   shadow-report <dir>
 *     AC-13. Reads `<dir>/judgments.json` (the model's real candidates for one
 *     PR) and `<dir>/prose-dispositions.json` (the SAME agent's own
 *     prose-computed clear/defer/drop/suppress/verdict call per candidate,
 *     recorded during a single-context dry-run review — Phase 3 step 3's
 *     "ALSO records its prose-computed disposition per fingerprint"). Runs
 *     those same judgments through the real `finalizeReview()` and diffs each
 *     candidate's disposition against the prose call. Exits 0 iff every
 *     disagreement carries a non-empty `explained` field in
 *     `<dir>/explained.json` (a hand-maintained map `{fp: "why"}` — D5-type,
 *     legitimate ambiguities between the prose and the deterministic pipeline,
 *     not silently accepted mismatches).
 *
 *   score --manifest <m> --runs <dir> --labels <dir> [--out <json>] [--lorekit-out <json>]
 *     AC-21. `--runs <dir>` holds one subdirectory per arm (`A`, `B`), each
 *     holding one subdirectory per PR number, each holding one subdirectory
 *     per run (`run-1`, `run-2`, ...). Every run directory is expected to
 *     contain `inline-comments.json` (the array a `--dry-run` review would
 *     have POSTed to `/pulls/{n}/reviews`, per pipeline.md's artifact-flow
 *     table — `[{path, line, body, ...}]`) and MUST contain
 *     `dispatch-meta.json` (`{tokens_used, wall_clock_ms, reviewed_sha}`, written
 *     by `record-meta` from the dispatcher's figures, since only the dispatcher
 *     sees the Agent-tool result — this script never estimates either figure).
 *     `--labels <dir>` holds one `<pr>.json` per PR — `thread-outcomes.mjs`'s
 *     own output shape (`{repo, pr, labels: [...]}`). A run whose
 *     `dispatch-meta.json` `reviewed_sha` does not match the manifest's
 *     `review_sha` for that PR — or that carries no `reviewed_sha` at all — is
 *     EXCLUDED from scoring entirely and counted (D13) — labels
 *     were extracted at the manifest SHA, and grading a different commit's
 *     findings against them would compare two different diffs. Emits per-arm
 *     recall, precision, run-to-run stability (Jaccard over each PR's own
 *     repeated runs), severity agreement (fraction of matched findings whose
 *     tier agrees), mean tokens/wall-clock, and the D1 gate verdict
 *     (`insufficient` below 8 PRs x 3 runs per arm with matched data, else
 *     `pass`/`fail` on B.recall >= A.recall and B.precision >= A.precision -
 *     0.05), to stdout and optionally `--out`.
 *
 *   --self-test
 *     Runs every pure function below against synthetic fixtures. No network,
 *     no filesystem outside a scratch tmpdir this process owns.
 *
 * Matching (shared by `score`): a candidate finding and a label match when
 * either (a) both carry a fingerprint AND they're equal (fingerprint.mjs's
 * `fp:v2:finder:defectClass:symbol@path`, or a shared `fp:v1` derivation), or
 * (b) they share the SAME path and their lines are within `LINE_TOLERANCE`
 * (3, matching `l2-detection.mjs`'s own constant — reused, not reinvented).
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finalizeReview } from "../../agents/pr-reviewer/scripts/finalize.mjs";
import { extractFingerprint } from "../../agents/pr-reviewer/scripts/fingerprint.mjs";
import { ghApi, ghApiAll } from "../record-comment-relevance.mjs";

const LINE_TOLERANCE = 3; // mirrors scripts/eval/l2-detection.mjs's own constant

// ── pick-review-sha (D12) ──

/**
 * Pure — the earliest root review comment from a non-author, verified against the PR's
 * own commit list. No non-author comment, or none whose `original_commit_id` survives
 * verification, falls back to `headSha` (the docs-only / dependency-bump probes, which
 * the plan documents as carrying no inline comments at all).
 * @param {{ prAuthorLogin: string, rootComments: any[], commitShas: string[], headSha: string }} args
 * @returns {{ sha: string, reason: string }}
 */
export function pickReviewSha({ prAuthorLogin, rootComments, commitShas, headSha }) {
  const commitSet = new Set(commitShas);
  const candidates = (rootComments || [])
    .filter((c) => c?.user?.login && c.user.login !== prAuthorLogin && c.original_commit_id)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  for (const c of candidates) {
    if (commitSet.has(c.original_commit_id)) {
      return {
        sha: c.original_commit_id,
        reason: `earliest non-author root comment by ${c.user.login}, verified in the PR's commit list`,
      };
    }
  }
  return {
    sha: headSha,
    reason: candidates.length === 0
      ? "no non-author root inline comments on this PR — defaulting to head_sha"
      : "no candidate's original_commit_id was verified in the PR's commit list — defaulting to head_sha",
  };
}

async function runPickReviewSha(/** @type {Record<string,string|boolean>} */ opts) {
  const manifestPath = /** @type {string} */ (opts.manifest);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const write = Boolean(opts.write);
  let picked = 0;

  for (const entry of manifest.entries ?? []) {
    const repo = entry.repo;
    const number = entry.number;
    const prMeta = ghApi(`/repos/${repo}/pulls/${number}`);
    const commits = ghApiAll(`/repos/${repo}/pulls/${number}/commits`).map((/** @type {any} */ c) => c.sha);
    const comments = ghApiAll(`/repos/${repo}/pulls/${number}/comments`);
    const roots = comments.filter((/** @type {any} */ c) => !c.in_reply_to_id);
    const { sha, reason } = pickReviewSha({
      prAuthorLogin: prMeta?.user?.login ?? "",
      rootComments: roots,
      commitShas: commits,
      headSha: entry.head_sha,
    });
    entry.review_sha = sha;
    picked++;
    console.log(`pick-review-sha: ${repo}#${number} -> ${sha} (${reason})`);
  }

  if (write) {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`\npick-review-sha: wrote ${picked} review_sha value(s) to ${manifestPath} (read-only gh calls only — no write, comment, review, or reaction issued)`);
  } else {
    console.log(`\npick-review-sha: dry run (no --write) — ${picked} value(s) computed, manifest not modified`);
  }
  process.exit(0);
}

// ── plan (AC-21, D11) ──

/**
 * Pure — one dispatch entry per (usable manifest entry) x (arm) x (run). A manifest
 * entry with no valid 40-hex `review_sha` is skipped by name (Edge Cases table), never
 * silently dropped from the skip count. Every prompt is built to satisfy D11 literally:
 * `general-purpose` only, and the installed `pr-reviewer` agent is never named as a
 * dispatch type (the prompt text below never places the literal words "dispatch type"
 * or "subagent_type" directly adjacent to "pr-reviewer").
 * `thoroughness` is the A/B round 2/3 sweep knob (`--thoroughness <0..1>`, `agents/pr-reviewer/rules/depth-routing.md
 * § Thoroughness budget`): omitted or the literal string `"default"` reproduces round 1's flags exactly
 * (no override — each PR routes its own tier default), any other value appends `--thoroughness <n>`
 * to every dispatch in this matrix, uniformly across arms and PRs — one `plan` invocation is one
 * sweep point, run three times (t=0.3, default, 1.0) to draw the recall-vs-wall-clock curve.
 * @param {{ entries: any[], worktree: string, arms: string[], runs: number, thoroughness?: string }} args
 */
export function buildMatrix({ entries, worktree, arms, runs, thoroughness }) {
  const usable = entries.filter((e) => /^[0-9a-f]{40}$/.test(e.review_sha || ""));
  const skipped = entries.length - usable.length;
  const thoroughnessFlag = thoroughness && thoroughness !== "default" ? ` --thoroughness ${thoroughness}` : "";
  /** @type {any[]} */
  const dispatches = [];

  for (const entry of usable) {
    for (const arm of arms) {
      for (let run = 1; run <= runs; run++) {
        const flags = `--dry-run --isolated --review-sha ${entry.review_sha}${thoroughnessFlag}`;
        const prompt = arm === "A"
          ? `Act as the reviewer agent defined at ${worktree}/agents/pr-reviewer.md, read by absolute path. `
            + `Run as a general-purpose agent — never resolve to the installed reviewer agent by name. `
            + `Review ${entry.repo}#${entry.number} with flags: ${flags}.`
          : `Follow ${worktree}/skills/quality/pr-review/SKILL.md section "--fanout", read by absolute path, `
            + `as the top-level orchestrator. Every worker you dispatch — every finder, lens, verifier, and `
            + `synthesis step — runs as a general-purpose agent, never the installed reviewer agent by name. `
            + `Review ${entry.repo}#${entry.number} with flags: ${flags}.`;
        dispatches.push({
          pr: { repo: entry.repo, number: entry.number },
          arm,
          run,
          subagent_type: "general-purpose",
          worktree,
          flags,
          // The SHA this dispatch's own `--review-sha` flag pins, and the run directory its
          // artifacts land in — `record-meta` reads both to write dispatch-meta.json, so the
          // dispatcher never hand-copies a SHA.
          reviewed_sha: entry.review_sha,
          run_dir: `${arm}/${entry.number}/run-${run}`,
          prompt,
        });
      }
    }
  }
  return { dispatches, skipped };
}

/**
 * Pure — the dispatch-meta.json record for one finished dispatch. `reviewed_sha` comes from the
 * matrix entry's own pin (the SHA its `--review-sha` flag named), never from the caller, so a
 * run's meta can only ever claim the commit it was actually dispatched against.
 * @param {{ dispatch: any, tokensUsed: number, wallClockMs: number }} args
 */
export function buildDispatchMeta({ dispatch, tokensUsed, wallClockMs }) {
  const sha = dispatch?.reviewed_sha;
  if (!/^[0-9a-f]{40}$/.test(sha || "")) {
    throw new Error(`dispatch ${dispatch?.run_dir || "?"} carries no 40-hex reviewed_sha — re-run \`plan\``);
  }
  return { tokens_used: tokensUsed, wall_clock_ms: wallClockMs, reviewed_sha: sha };
}

async function runRecordMeta(/** @type {Record<string,string|boolean>} */ opts) {
  const matrix = JSON.parse(readFileSync(/** @type {string} */ (opts.matrix), "utf8"));
  const index = Number(opts.index);
  const dispatch = (matrix.dispatches ?? [])[index];
  if (!dispatch) {
    console.error(`record-meta: no dispatch at index ${opts.index} in ${opts.matrix}`);
    process.exit(2);
  }
  const meta = buildDispatchMeta({
    dispatch, tokensUsed: Number(opts.tokens), wallClockMs: Number(opts["wall-clock-ms"]),
  });
  const runDir = join(/** @type {string} */ (opts.runs), dispatch.run_dir);
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true });
  const metaPath = join(runDir, "dispatch-meta.json");
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`record-meta: wrote ${metaPath} (reviewed_sha ${meta.reviewed_sha})`);
  process.exit(0);
}

async function runPlan(/** @type {Record<string,string|boolean>} */ opts) {
  const manifest = JSON.parse(readFileSync(/** @type {string} */ (opts.manifest), "utf8"));
  const worktree = /** @type {string} */ (opts.worktree);
  const arms = String(opts.arms || "A,B").split(",").map((s) => s.trim()).filter(Boolean);
  const runs = Number(opts.runs || 3);
  const outDir = /** @type {string} */ (opts.out);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const thoroughness = opts.thoroughness !== undefined ? String(opts.thoroughness) : undefined;
  const { dispatches, skipped } = buildMatrix({ entries: manifest.entries ?? [], worktree, arms, runs, thoroughness });
  const matrixPath = join(outDir, "matrix.json");
  writeFileSync(matrixPath, JSON.stringify({ dispatches }, null, 2));
  console.log(
    `plan: ${dispatches.length} dispatch(es) across ${arms.length} arm(s) x ${runs} run(s)`
      + `${thoroughness && thoroughness !== "default" ? ` at thoroughness=${thoroughness}` : ""}, `
      + `${skipped} manifest entrie(s) skipped (no valid review_sha) -> ${matrixPath}`,
  );
  process.exit(0);
}

// ── shadow-report ──

/**
 * @param {any} judgments
 * @param {any} proseDispositions - { [fp]: "clear"|"defer"|"drop"|"suppressed"|"verdict:<X>" }
 * @param {any} explained - { [fp]: string } — non-empty rationale per disagreement
 * @param {any} [context] - the REAL review-context.json (real diff patches) for a live shadow
 *   run; the self-test below passes a synthetic one-line-per-candidate stand-in instead of a
 *   captured PR diff, so it does not depend on any fixture beyond judgments.json itself.
 * @returns {{ ok: boolean, mismatches: any[], total: number }}
 */
export function compareShadow(judgments, proseDispositions, explained, context) {
  const ctx = context || {
    mode: "full",
    files: (judgments?.candidates || [])
      .filter((/** @type {any} */ c) => typeof c.line === "number")
      .map((/** @type {any} */ c) => ({ filename: c.path, patch: `@@ -${c.line},1 +${c.line},1 @@\n+x` })),
    threads: [],
  };
  const { payload, inline, deferred, suppressed, anchorless, dedupeDropped, confidenceDropped, verdict } =
    finalizeReview({ context: ctx, judgments, skipGates: false });
  void payload;

  /** @type {Map<string,string>} */
  const finalizeDisposition = new Map();
  for (const c of inline) finalizeDisposition.set(fpOf(c), "clear");
  for (const c of deferred) finalizeDisposition.set(fpOf(c), "defer");
  for (const c of suppressed) finalizeDisposition.set(fpOf(c), "suppressed");
  for (const c of anchorless) finalizeDisposition.set(fpOf(c), "anchorless");
  for (const c of dedupeDropped) finalizeDisposition.set(fpOf(c), "dedupe-dropped");
  for (const c of confidenceDropped) finalizeDisposition.set(fpOf(c), "drop");
  finalizeDisposition.set("__verdict__", verdict);

  /** @type {any[]} */
  const mismatches = [];
  const allKeys = new Set([...finalizeDisposition.keys(), ...Object.keys(proseDispositions || {})]);
  for (const fp of allKeys) {
    const a = finalizeDisposition.get(fp) ?? "(absent)";
    const b = (proseDispositions || {})[fp] ?? "(absent)";
    if (a !== b) {
      const reason = (explained || {})[fp];
      mismatches.push({ fp, finalize: a, prose: b, explained: reason || null });
    }
  }

  const unexplained = mismatches.filter((m) => !m.explained || !String(m.explained).trim());
  return { ok: unexplained.length === 0, mismatches, total: allKeys.size };
}

/** @param {any} c */
function fpOf(c) {
  try {
    // eslint-disable-next-line no-unused-vars
    return `${c.finder}:${c.defect_class}:${c.symbol || "-"}@${c.path}`;
  } catch {
    return `${c.path}:${c.line}`;
  }
}

async function runShadowReport(/** @type {string} */ dir) {
  const judgments = JSON.parse(readFileSync(join(dir, "judgments.json"), "utf8"));
  const proseDispositions = existsSync(join(dir, "prose-dispositions.json"))
    ? JSON.parse(readFileSync(join(dir, "prose-dispositions.json"), "utf8"))
    : {};
  const explained = existsSync(join(dir, "explained.json"))
    ? JSON.parse(readFileSync(join(dir, "explained.json"), "utf8"))
    : {};
  // The real review-context.json (real diff patches) if this shadow dir captured one —
  // never synthesized for a live run; a candidate outside the real diff must validate (or
  // not) against the diff that was actually reviewed.
  const context = existsSync(join(dir, "context.json"))
    ? JSON.parse(readFileSync(join(dir, "context.json"), "utf8"))
    : existsSync(join(dir, "review-context.json"))
      ? JSON.parse(readFileSync(join(dir, "review-context.json"), "utf8"))
      : undefined;

  const { ok, mismatches, total } = compareShadow(judgments, proseDispositions, explained, context);
  console.log(`shadow-report: ${total} fingerprint(s) compared, ${mismatches.length} mismatch(es)`);
  for (const m of mismatches) {
    const tag = m.explained ? "explained" : "UNEXPLAINED";
    console.log(`  [${tag}] ${m.fp}: finalize=${m.finalize} prose=${m.prose}${m.explained ? ` — ${m.explained}` : ""}`);
  }
  process.exit(ok ? 0 : 1);
}

// ── score ──

/**
 * @param {any} finding - { path, line, body }
 * @param {any} label - { path, line, fingerprint }
 */
export function isMatch(finding, label) {
  const findingFp = extractFingerprint(finding.body ?? "");
  if (findingFp?.source === "marker" && label.fingerprint && findingFp.fp === label.fingerprint) {
    return true;
  }
  if (!finding.path || !label.path || finding.path !== label.path) return false;
  const fLine = Number(finding.line ?? 0);
  const lLine = Number(label.line ?? 0);
  return Math.abs(fLine - lLine) <= LINE_TOLERANCE;
}

/**
 * @param {any[]} findings - one arm/run's inline-comments.json array
 * @param {any[]} labels - thread-outcomes.mjs's labels[] for this PR
 * @returns {{ tp: number, fp: number, fn: number, matchedSeverityAgreements: number, matchedTotal: number }}
 */
export function scoreRun(findings, labels) {
  const fixedLabels = labels.filter((l) => l.outcome === "fixed");
  const declinedLabels = labels.filter((l) => l.outcome === "declined");

  let tp = 0, fp = 0;
  let matchedSeverityAgreements = 0, matchedTotal = 0;
  for (const finding of findings) {
    const fixedMatch = fixedLabels.find((l) => isMatch(finding, l));
    const declinedMatch = !fixedMatch && declinedLabels.find((l) => isMatch(finding, l));
    if (fixedMatch) {
      tp++;
      matchedTotal++;
      if (finding.tier && fixedMatch.severity && finding.tier === fixedMatch.severity) matchedSeverityAgreements++;
    } else if (declinedMatch) {
      fp++;
    }
    // A finding matching neither bucket is "needs manual/judge" material — per the
    // plan's own wording — and is counted in neither tp nor fp (never guessed).
  }
  const matchedFixedFps = new Set(
    findings.filter((f) => fixedLabels.some((l) => isMatch(f, l))).map((f) => `${f.path}:${f.line}`),
  );
  const fn = fixedLabels.filter((l) => !findings.some((f) => isMatch(f, l))
    || !matchedFixedFps.has(`${l.path}:${l.line}`)).length;

  return { tp, fp, fn, matchedSeverityAgreements, matchedTotal };
}

/**
 * Jaccard similarity between two runs' finding sets (by path:line-proximity/fingerprint
 * identity), for the run-to-run stability metric.
 * @param {any[]} runA @param {any[]} runB
 */
export function jaccard(runA, runB) {
  if (runA.length === 0 && runB.length === 0) return 1;
  let intersection = 0;
  const usedB = new Set();
  for (const a of runA) {
    const idx = runB.findIndex((b, i) => !usedB.has(i) && isMatch(a, b));
    if (idx >= 0) { intersection++; usedB.add(idx); }
  }
  const union = runA.length + runB.length - intersection;
  return union === 0 ? 1 : intersection / union;
}

/** @param {string} dir */
function readJsonIfExists(dir) {
  return existsSync(dir) ? JSON.parse(readFileSync(dir, "utf8")) : null;
}

/** @param {string} runsDir @param {string} arm */
function listRunDirs(runsDir, arm) {
  const armDir = join(runsDir, arm);
  /** @type {{ pr: string, runId: string, dir: string }[]} */
  const out = [];
  if (!existsSync(armDir)) return out;
  for (const pr of readdirSync(armDir)) {
    const prDir = join(armDir, pr);
    if (!statSync(prDir).isDirectory()) continue;
    for (const runId of readdirSync(prDir)) {
      const runDir = join(prDir, runId);
      if (statSync(runDir).isDirectory()) out.push({ pr, runId, dir: runDir });
    }
  }
  return out;
}

/**
 * @param {{ runsDir: string, labelsDir: string, arm: string, reviewShaByPr?: Map<string,string> }} args
 */
export function scoreArm({ runsDir, labelsDir, arm, reviewShaByPr }) {
  const runs = listRunDirs(runsDir, arm);
  let tp = 0, fp = 0, fn = 0, matchedSeverityAgreements = 0, matchedTotal = 0;
  let tokensSum = 0, tokensCount = 0, wallClockSum = 0, wallClockCount = 0;
  let excludedReviewedShaMismatch = 0;
  let excludedMissingReviewedSha = 0;
  /** @type {Map<string, any[][]>} */
  const byPr = new Map();

  for (const run of runs) {
    const meta = readJsonIfExists(join(run.dir, "dispatch-meta.json"));
    const expectedSha = reviewShaByPr?.get(String(run.pr));
    // A run with NO reviewed_sha (no dispatch-meta.json, or a meta written before `record-meta`
    // stamped one) cannot prove which commit it graded, so it is excluded and counted exactly
    // like a mismatch — never scored on the assumption that it happened to match.
    if (!meta?.reviewed_sha) {
      excludedMissingReviewedSha++;
      continue;
    }
    // D13: a run's findings were dispatched at meta.reviewed_sha — grading them against
    // labels extracted at the manifest's review_sha only holds when the two agree. A
    // mismatch (the manifest was re-picked, or the dispatch ran stale) is EXCLUDED from
    // scoring entirely, before its findings are ever read, never silently mixed in.
    if (expectedSha && meta.reviewed_sha !== expectedSha) {
      excludedReviewedShaMismatch++;
      continue;
    }

    const findings = readJsonIfExists(join(run.dir, "inline-comments.json")) || [];
    const labelsFile = readJsonIfExists(join(labelsDir, `${run.pr}.json`));
    const labels = labelsFile?.labels || [];
    const s = scoreRun(findings, labels);
    tp += s.tp; fp += s.fp; fn += s.fn;
    matchedSeverityAgreements += s.matchedSeverityAgreements;
    matchedTotal += s.matchedTotal;

    if (typeof meta?.tokens_used === "number") { tokensSum += meta.tokens_used; tokensCount++; }
    if (typeof meta?.wall_clock_ms === "number") { wallClockSum += meta.wall_clock_ms; wallClockCount++; }

    if (!byPr.has(run.pr)) byPr.set(run.pr, []);
    /** @type {any[][]} */ (byPr.get(run.pr)).push(findings);
  }

  /** @type {number[]} */
  const stabilities = [];
  for (const [, prRuns] of byPr) {
    if (prRuns.length < 2) continue;
    for (let i = 0; i < prRuns.length; i++) {
      for (let j = i + 1; j < prRuns.length; j++) stabilities.push(jaccard(prRuns[i], prRuns[j]));
    }
  }

  const prCount = byPr.size;
  const minRunsPerPr = prCount > 0 ? Math.min(...[...byPr.values()].map((r) => r.length)) : 0;

  return {
    arm,
    runs: runs.length,
    excluded_reviewed_sha_mismatch: excludedReviewedShaMismatch,
    excluded_missing_reviewed_sha: excludedMissingReviewedSha,
    pr_count: prCount,
    min_runs_per_pr: minRunsPerPr,
    recall: tp + fn > 0 ? tp / (tp + fn) : null,
    precision: tp + fp > 0 ? tp / (tp + fp) : null,
    stability: stabilities.length > 0 ? stabilities.reduce((a, b) => a + b, 0) / stabilities.length : null,
    severity_agreement: matchedTotal > 0 ? matchedSeverityAgreements / matchedTotal : null,
    mean_tokens: tokensCount > 0 ? Math.round(tokensSum / tokensCount) : null,
    mean_wall_clock_ms: wallClockCount > 0 ? Math.round(wallClockSum / wallClockCount) : null,
    tp, fp, fn,
  };
}

/**
 * D1 gate: pure verdict function over two `scoreArm()` results. `insufficient` below the
 * 8-PR x 3-run-per-PR floor on EITHER arm (never guessed from a partial sample); else
 * `pass` when B.recall >= A.recall AND B.precision >= A.precision - 0.05, else `fail`.
 * @param {any[]} results - the array `scoreArm()` produces per arm
 */
export function evaluateGate(results) {
  const MIN_PRS = 8, MIN_RUNS_PER_PR = 3;
  const a = results.find((r) => r.arm === "A");
  const b = results.find((r) => r.arm === "B");
  if (!a || !b) {
    return { verdict: "insufficient", reason: "insufficient data — missing arm A or arm B results" };
  }
  if (a.pr_count < MIN_PRS || b.pr_count < MIN_PRS || a.min_runs_per_pr < MIN_RUNS_PER_PR || b.min_runs_per_pr < MIN_RUNS_PER_PR) {
    return {
      verdict: "insufficient",
      reason: `insufficient data — the D1 gate needs >= ${MIN_PRS} PRs x >= ${MIN_RUNS_PER_PR} runs per arm with matched data `
        + `(A: ${a.pr_count} PRs / min ${a.min_runs_per_pr} runs, B: ${b.pr_count} PRs / min ${b.min_runs_per_pr} runs)`,
    };
  }
  if (a.recall == null || b.recall == null || a.precision == null || b.precision == null) {
    return { verdict: "insufficient", reason: "insufficient data — recall/precision not computable (no matched labels in one or both arms)" };
  }
  const precisionFloor = a.precision - 0.05;
  const pass = b.recall >= a.recall && b.precision >= precisionFloor;
  return {
    verdict: pass ? "pass" : "fail",
    reason: `gate ${pass ? "PASS" : "FAIL"}: B.recall=${b.recall} vs A.recall=${a.recall} (need >=); `
      + `B.precision=${b.precision} vs A.precision-0.05=${precisionFloor} (need >=)`,
  };
}

async function runScore(/** @type {Record<string,string|boolean>} */ opts) {
  const runsDir = /** @type {string} */ (opts.runs);
  const labelsDir = /** @type {string} */ (opts.labels);
  const manifest = existsSync(/** @type {string} */(opts.manifest)) ? JSON.parse(readFileSync(/** @type {string} */(opts.manifest), "utf8")) : { entries: [] };

  /** @type {Map<string,string>} */
  const reviewShaByPr = new Map();
  for (const entry of manifest.entries ?? []) {
    if (entry?.number != null && entry?.review_sha) reviewShaByPr.set(String(entry.number), entry.review_sha);
  }

  const arms = existsSync(runsDir) ? readdirSync(runsDir).filter((a) => statSync(join(runsDir, a)).isDirectory()) : [];
  const results = arms.map((arm) => scoreArm({ runsDir, labelsDir, arm, reviewShaByPr }));
  const gate = evaluateGate(results);

  console.log(JSON.stringify({ results, gate }, null, 2));
  if (opts.out) writeFileSync(/** @type {string} */(opts.out), JSON.stringify({ results, gate }, null, 2));

  if (opts["lorekit-out"]) {
    /** @type {any[]} */
    const records = results.map((r) => ({
      kind: "bus",
      host: "pr-reviewer",
      scope: "repo::mthines/agent-skills",
      ttl_days: 90,
      tags: ["loop::reviewer-benchmarks", `arm::${r.arm}`],
      key: `reviewer-benchmarks::ab-${r.arm}-${Date.now()}`,
      value: r,
    }));
    records.push({
      kind: "bus",
      host: "pr-reviewer",
      scope: "repo::mthines/agent-skills",
      ttl_days: 90,
      tags: ["loop::reviewer-benchmarks", "gate::d1"],
      key: `reviewer-benchmarks::ab-gate-${Date.now()}`,
      value: gate,
    });
    writeFileSync(/** @type {string} */(opts["lorekit-out"]), JSON.stringify(records, null, 2));
    console.log(`\n${records.length} LoreKit record(s) staged at ${opts["lorekit-out"]} — written over MCP by the caller (this script never calls MCP itself).`);
  }
  process.exit(0);
}

// ── CLI ──

// Boolean flags never consume the next argv slot — --write as the last (or only) token
// on the line otherwise reads the next flag (or undefined) as its "value" and reports a
// truthy-string check as false, exactly the class of bug this constant exists to close.
const BOOLEAN_FLAGS = new Set(["self-test", "write"]);

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") { opts["self-test"] = true; continue; }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOLEAN_FLAGS.has(key)) { opts[key] = true; continue; }
      opts[key] = argv[i + 1];
      i++;
      continue;
    }
  }
  return opts;
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // isMatch
  {
    const finding = { path: "a.ts", line: 10, body: "<!-- fp:v2:correctness:logic:foo@a.ts -->issue: x" };
    const label = { path: "a.ts", line: 999, fingerprint: "correctness:logic:foo@a.ts" };
    check("isMatch matches on fingerprint identity even with lines far apart", isMatch(finding, label));
  }
  {
    const finding = { path: "a.ts", line: 10, body: "issue: x, no marker" };
    const label = { path: "a.ts", line: 12, fingerprint: null };
    check("isMatch falls back to path + LINE_TOLERANCE proximity", isMatch(finding, label));
  }
  {
    const finding = { path: "a.ts", line: 10, body: "issue: x" };
    const label = { path: "a.ts", line: 20, fingerprint: null };
    check("isMatch rejects a path match outside LINE_TOLERANCE", !isMatch(finding, label));
  }
  {
    const finding = { path: "a.ts", line: 10, body: "issue: x" };
    const label = { path: "b.ts", line: 10, fingerprint: null };
    check("isMatch rejects a different path even at the same line", !isMatch(finding, label));
  }

  // scoreRun
  {
    const findings = [
      { path: "a.ts", line: 10, body: "issue: x", tier: "high" },
      { path: "z.ts", line: 1, body: "issue: noise", tier: "low" },
    ];
    const labels = [
      { path: "a.ts", line: 10, fingerprint: null, outcome: "fixed", severity: "high" },
      { path: "q.ts", line: 5, fingerprint: null, outcome: "fixed", severity: "medium" },
    ];
    const s = scoreRun(findings, labels);
    check("scoreRun counts a matched fixed-outcome finding as a TP", s.tp === 1);
    check("scoreRun counts an unmatched fixed-outcome label as an FN", s.fn === 1);
    check("scoreRun counts a matched severity tier as an agreement", s.matchedSeverityAgreements === 1 && s.matchedTotal === 1);
  }
  {
    const findings = [{ path: "a.ts", line: 10, body: "issue: x" }];
    const labels = [{ path: "a.ts", line: 10, fingerprint: null, outcome: "declined" }];
    const s = scoreRun(findings, labels);
    check("scoreRun counts a matched declined-outcome finding as an FP", s.fp === 1 && s.tp === 0);
  }
  {
    const findings = [{ path: "a.ts", line: 10, body: "issue: x" }];
    const labels = [{ path: "b.ts", line: 99, fingerprint: null, outcome: null }];
    const s = scoreRun(findings, labels);
    check("scoreRun leaves an unmatched finding and a null-outcome label uncounted (needs manual/judge, never guessed)", s.tp === 0 && s.fp === 0 && s.fn === 0);
  }

  // jaccard
  {
    const runA = [{ path: "a.ts", line: 10, body: "x" }];
    const runB = [{ path: "a.ts", line: 10, body: "x" }];
    check("jaccard(identical runs) is 1", jaccard(runA, runB) === 1);
  }
  {
    const runA = [{ path: "a.ts", line: 10, body: "x" }];
    const runB = [{ path: "b.ts", line: 10, body: "x" }];
    check("jaccard(disjoint runs) is 0", jaccard(runA, runB) === 0);
  }
  {
    check("jaccard(both empty) is 1 (perfectly stable — nothing found either time)", jaccard([], []) === 1);
  }

  // compareShadow
  const shadowGates = { gate1: { status: "PASS", details: "d" }, gate5: { status: "PASS", details: "d" } };
  {
    const judgments = {
      candidates: [
        { finder: "correctness", defect_class: "logic", symbol: "foo", path: "a.ts", line: 1, prefix: "issue", severity: "high", final: 95, title: "t", body: "b" },
      ],
      gates: shadowGates,
    };
    const prose = { "correctness:logic:foo@a.ts": "clear", __verdict__: "WARN" };
    const r = compareShadow(judgments, prose, {});
    check("compareShadow finds agreement (no mismatch) when finalize and prose agree", r.ok && r.mismatches.length === 0);
  }
  {
    const judgments = {
      candidates: [
        { finder: "correctness", defect_class: "logic", symbol: "foo", path: "a.ts", line: 1, prefix: "issue", severity: "high", final: 95, title: "t", body: "b" },
      ],
      gates: shadowGates,
    };
    const prose = { "correctness:logic:foo@a.ts": "defer", __verdict__: "WARN" };
    const rNoExplain = compareShadow(judgments, prose, {});
    check("compareShadow flags a real disagreement (clear vs. defer) and fails without an explanation", !rNoExplain.ok && rNoExplain.mismatches.length === 1);
    const rExplained = compareShadow(judgments, prose, { "correctness:logic:foo@a.ts": "D5: prose applies a stricter bar for this defect class" });
    check("compareShadow's ok flips to true once the SAME disagreement carries a non-empty explanation", rExplained.ok);
  }

  // parseArgs — boolean flags (--write, --self-test) never consume the next argv slot
  {
    const opts = parseArgs(["pick-review-sha", "--manifest", "m.json", "--write"]);
    check("parseArgs treats a trailing --write as boolean true, not as consuming (and losing) the next slot",
      opts.write === true && opts.manifest === "m.json");
  }

  // pickReviewSha (D12)
  {
    const rootComments = [
      { user: { login: "author" }, original_commit_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", created_at: "2026-01-01T00:00:00Z" },
      { user: { login: "reviewer1" }, original_commit_id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", created_at: "2026-01-02T00:00:00Z" },
      { user: { login: "reviewer1" }, original_commit_id: "cccccccccccccccccccccccccccccccccccccccc", created_at: "2026-01-03T00:00:00Z" },
    ];
    const r = pickReviewSha({
      prAuthorLogin: "author",
      rootComments,
      commitShas: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccccccccccccccccccc"],
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    check("pickReviewSha excludes the PR author's own comment and picks the earliest non-author one, verified in the commit list",
      r.sha === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  }
  {
    const r = pickReviewSha({ prAuthorLogin: "author", rootComments: [], commitShas: [], headSha: "dddddddddddddddddddddddddddddddddddddddd" });
    check("pickReviewSha with no non-author root comments defaults to head_sha", r.sha === "dddddddddddddddddddddddddddddddddddddddd");
  }
  {
    const rootComments = [{ user: { login: "reviewer1" }, original_commit_id: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", created_at: "2026-01-02T00:00:00Z" }];
    const r = pickReviewSha({ prAuthorLogin: "author", rootComments, commitShas: ["ffffffffffffffffffffffffffffffffffffffff"], headSha: "ffffffffffffffffffffffffffffffffffffffff" });
    check("pickReviewSha falls back to head_sha when no candidate's original_commit_id is verified in the commit list", r.sha === "ffffffffffffffffffffffffffffffffffffffff");
  }

  // buildMatrix (AC-21, D11)
  {
    const entries = [
      { repo: "o/r", number: 1, review_sha: "1111111111111111111111111111111111111111".slice(0, 40) },
      { repo: "o/r", number: 2, review_sha: "not-a-sha" },
    ];
    const { dispatches, skipped } = buildMatrix({ entries, worktree: "/abs/worktree", arms: ["A", "B"], runs: 3 });
    check("buildMatrix skips a manifest entry with no valid 40-hex review_sha, by name in the skip count", skipped === 1);
    check("buildMatrix emits arms x runs dispatches for each usable entry", dispatches.length === 6);
    check("buildMatrix names the worktree by absolute path and general-purpose in every dispatch",
      dispatches.every((d) => JSON.stringify(d).includes("/abs/worktree") && d.subagent_type === "general-purpose"));
    check("buildMatrix's flags carry --dry-run --isolated --review-sha <sha> on every dispatch",
      dispatches.every((d) => /--dry-run/.test(d.flags) && /--isolated/.test(d.flags) && /--review-sha [0-9a-f]{40}/.test(d.flags)));
    check("buildMatrix never names the installed reviewer agent as a dispatch type (subagent_type ... pr-reviewer)",
      dispatches.every((d) => !/subagent_type\W+pr-reviewer/.test(JSON.stringify(d))));
  }

  // buildMatrix thoroughness sweep (A/B round 2/3)
  {
    const entries = [{ repo: "o/r", number: 1, review_sha: "2222222222222222222222222222222222222222" }];
    const noOverride = buildMatrix({ entries, worktree: "/w", arms: ["A"], runs: 1 });
    check("buildMatrix with no thoroughness given carries no --thoroughness flag (round 1 unchanged)",
      noOverride.dispatches.every((d) => !d.flags.includes("--thoroughness")));
    const defaultLiteral = buildMatrix({ entries, worktree: "/w", arms: ["A"], runs: 1, thoroughness: "default" });
    check("buildMatrix with thoroughness:'default' carries no --thoroughness flag either",
      defaultLiteral.dispatches.every((d) => !d.flags.includes("--thoroughness")));
    const swept = buildMatrix({ entries, worktree: "/w", arms: ["A"], runs: 1, thoroughness: "0.3" });
    check("buildMatrix with an explicit thoroughness appends --thoroughness <n> to every dispatch's flags",
      swept.dispatches.every((d) => d.flags.includes("--thoroughness 0.3")));
    check("the thoroughness flag rides alongside --dry-run --isolated --review-sha, not instead of them",
      swept.dispatches.every((d) => /--dry-run/.test(d.flags) && /--isolated/.test(d.flags) && /--review-sha [0-9a-f]{40}/.test(d.flags)));
  }

  // scoreArm reviewed_sha exclusion + mean tokens/wall-clock (D13, AC-22)
  {
    const scratch = mkdtempSync(join(tmpdir(), "ab-review-selftest-"));
    const runsDir = join(scratch, "runs");
    const labelsDir = join(scratch, "labels");
    mkdirSync(join(runsDir, "A", "42", "run-1"), { recursive: true });
    mkdirSync(join(runsDir, "A", "42", "run-2"), { recursive: true });
    mkdirSync(labelsDir, { recursive: true });
    writeFileSync(join(runsDir, "A", "42", "run-1", "inline-comments.json"), JSON.stringify([{ path: "a.ts", line: 10, body: "issue: x" }]));
    writeFileSync(join(runsDir, "A", "42", "run-1", "dispatch-meta.json"), JSON.stringify({ tokens_used: 1000, wall_clock_ms: 5000, reviewed_sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }));
    // run-2 was dispatched against a stale SHA — its meta.reviewed_sha disagrees with the
    // manifest's review_sha for PR 42, so it must be excluded from tp/fp/fn AND from the
    // tokens/wall-clock means, not silently averaged in.
    writeFileSync(join(runsDir, "A", "42", "run-2", "inline-comments.json"), JSON.stringify([{ path: "z.ts", line: 1, body: "issue: noise" }]));
    writeFileSync(join(runsDir, "A", "42", "run-2", "dispatch-meta.json"), JSON.stringify({ tokens_used: 9_000_000, wall_clock_ms: 9_000_000, reviewed_sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }));
    writeFileSync(join(labelsDir, "42.json"), JSON.stringify({ repo: "o/r", pr: "42", labels: [{ path: "a.ts", line: 10, fingerprint: null, outcome: "fixed", severity: "high" }] }));

    const reviewShaByPr = new Map([["42", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]]);
    const result = scoreArm({ runsDir, labelsDir, arm: "A", reviewShaByPr });
    check("scoreArm excludes a run whose dispatch-meta.json reviewed_sha mismatches the manifest's review_sha for that PR",
      result.excluded_reviewed_sha_mismatch === 1 && result.tp === 1 && result.fp === 0);
    check("scoreArm computes mean tokens and mean wall-clock only from the kept (matching-reviewed_sha) run",
      result.mean_tokens === 1000 && result.mean_wall_clock_ms === 5000);

    // run-3 has NO reviewed_sha at all (a pre-`--review-sha` stale run, or a hand-written meta):
    // the README says reviewed_sha must equal the manifest's, so it is excluded and counted, never scored.
    mkdirSync(join(runsDir, "A", "42", "run-3"), { recursive: true });
    writeFileSync(join(runsDir, "A", "42", "run-3", "inline-comments.json"), JSON.stringify([{ path: "q.ts", line: 3, body: "issue: stale" }]));
    writeFileSync(join(runsDir, "A", "42", "run-3", "dispatch-meta.json"), JSON.stringify({ tokens_used: 7, wall_clock_ms: 7 }));
    // run-4 has no dispatch-meta.json at all — same exclusion.
    mkdirSync(join(runsDir, "A", "42", "run-4"), { recursive: true });
    writeFileSync(join(runsDir, "A", "42", "run-4", "inline-comments.json"), JSON.stringify([{ path: "r.ts", line: 4, body: "issue: stale" }]));
    const withMissing = scoreArm({ runsDir, labelsDir, arm: "A", reviewShaByPr });
    check("scoreArm excludes (and counts) runs lacking reviewed_sha, never scoring them",
      withMissing.excluded_missing_reviewed_sha === 2 && withMissing.tp === 1 && withMissing.fp === 0
      && withMissing.mean_tokens === 1000,
      JSON.stringify(withMissing));
    rmSync(scratch, { recursive: true, force: true });
  }

  // The harness itself writes reviewed_sha: every matrix entry carries the SHA its flags pin plus
  // its run directory, and buildDispatchMeta stamps that SHA into the meta record.
  {
    const sha = "1111111111111111111111111111111111111111";
    const { dispatches } = buildMatrix({ entries: [{ repo: "o/r", number: 7, review_sha: sha }], worktree: "/abs/w", arms: ["A"], runs: 2 });
    check("buildMatrix stamps reviewed_sha (== the --review-sha it pins) and run_dir on every dispatch",
      dispatches.every((d) => d.reviewed_sha === sha && d.flags.includes(`--review-sha ${sha}`))
      && dispatches.map((d) => d.run_dir).join(",") === "A/7/run-1,A/7/run-2",
      JSON.stringify(dispatches.map((d) => [d.reviewed_sha, d.run_dir])));
    const meta = buildDispatchMeta({ dispatch: dispatches[0], tokensUsed: 12, wallClockMs: 34 });
    check("buildDispatchMeta writes {tokens_used, wall_clock_ms, reviewed_sha} from the dispatch's own pin",
      meta.reviewed_sha === sha && meta.tokens_used === 12 && meta.wall_clock_ms === 34, JSON.stringify(meta));
    let threw = false;
    try { buildDispatchMeta({ dispatch: { run_dir: "A/7/run-1" }, tokensUsed: 1, wallClockMs: 1 }); } catch { threw = true; }
    check("buildDispatchMeta refuses a dispatch carrying no 40-hex reviewed_sha", threw);
  }

  // evaluateGate — the D1 flip gate verdict (AC-22)
  {
    const results = [
      { arm: "A", pr_count: 2, min_runs_per_pr: 3, recall: 0.8, precision: 0.7 },
      { arm: "B", pr_count: 2, min_runs_per_pr: 3, recall: 0.9, precision: 0.75 },
    ];
    const gate = evaluateGate(results);
    check("evaluateGate reports insufficient below the 8-PR floor, never guessing pass/fail from a partial sample", gate.verdict === "insufficient");
  }
  {
    const results = [
      { arm: "A", pr_count: 8, min_runs_per_pr: 3, recall: 0.8, precision: 0.7 },
      { arm: "B", pr_count: 8, min_runs_per_pr: 3, recall: 0.85, precision: 0.68 },
    ];
    const gate = evaluateGate(results);
    check("evaluateGate PASSes when B.recall >= A.recall and B.precision >= A.precision - 0.05", gate.verdict === "pass");
  }
  {
    const results = [
      { arm: "A", pr_count: 8, min_runs_per_pr: 3, recall: 0.8, precision: 0.7 },
      { arm: "B", pr_count: 8, min_runs_per_pr: 3, recall: 0.6, precision: 0.5 },
    ];
    const gate = evaluateGate(results);
    check("evaluateGate FAILs when B regresses recall and precision below the tolerance", gate.verdict === "fail");
  }

  // Read-only surface.
  {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const mutationRe = /-X\s+(?:POST|PATCH|PUT|DELETE)|--method[\s=]+(?:POST|PATCH|PUT|DELETE)|\bmutation\s*[({]/i;
    check("this file's own source contains no GitHub mutation verb", !mutationRe.test(src));
  }

  if (failed > 0) {
    console.error(`\nab-review self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ ab-review self-test: all checks passed");
}

function usage() {
  console.error(
    "usage: ab-review.mjs pick-review-sha --manifest <m> [--write]"
      + " | plan --manifest <m> --worktree <abs> --arms A,B --runs 3 [--thoroughness 0..1|default] --out <dir>"
      + " | record-meta --matrix <matrix.json> --index <i> --runs <dir> --tokens <n> --wall-clock-ms <n>"
      + " | shadow-report <dir>"
      + " | score --manifest <m> --runs <dir> --labels <dir> [--out <json>] [--lorekit-out <json>]"
      + " | --self-test",
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts["self-test"]) { await selfTest(); return; }

  const sub = argv[0];
  if (sub === "pick-review-sha") {
    if (!opts.manifest) { usage(); process.exit(2); }
    await runPickReviewSha(opts);
    return;
  }
  if (sub === "plan") {
    if (!opts.manifest || !opts.worktree || !opts.out) { usage(); process.exit(2); }
    await runPlan(opts);
    return;
  }
  if (sub === "record-meta") {
    if (!opts.matrix || opts.index == null || !opts.runs || opts.tokens == null || opts["wall-clock-ms"] == null) { usage(); process.exit(2); }
    await runRecordMeta(opts);
    return;
  }
  if (sub === "shadow-report") {
    const dir = argv[1];
    if (!dir) { usage(); process.exit(2); }
    await runShadowReport(dir);
    return;
  }
  if (sub === "score") {
    if (!opts.manifest || !opts.runs || !opts.labels) { usage(); process.exit(2); }
    await runScore(opts);
    return;
  }
  usage();
  process.exit(2);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
