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
import { writeFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_MARKER = "<!-- PR_REVIEWER_REPORT -->";
const POINTER_MARKER = "<!-- PR_REVIEWER_POINTER -->";

/* ----------------------------- small helpers ----------------------------- */

function run(cmd, args, { timeoutMs = 60000, cwd = process.cwd(), maxBuffer = 64 * 1024 * 1024 } = {}) {
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

async function ghJson(args, opts) {
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
      const parent = mkdtempSync(join(tmpdir(), "prr-wt-"));
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
  const cloneDir = mkdtempSync(join(tmpdir(), "prr-clone-"));
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
  const tarDir = mkdtempSync(join(tmpdir(), "prr-tar-"));
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

  // Step 1.1 — the five fetches, concurrently. One await, one moment in time.
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
  const reviewRelation = me ? (me.toLowerCase() === authorLogin.toLowerCase() ? "self" : "cross") : "cross";
  if (!me) {
    anomalies.push(
      "reviewer identity unknown (no --reviewer-login / PR_REVIEWER_LOGIN; /user 401s here) — relation defaulted to cross",
    );
  }

  // Step 1.1b — the workspace ladder.
  let workspace = { dir: null, worktreeParent: null, depthCapability: "diff-only", rung: "skipped", cleanup: "none" };
  if (opts.workspace && headSha) {
    workspace = opts.workdir
      ? { dir: opts.workdir, worktreeParent: null, depthCapability: "checkout", rung: "caller-supplied", cleanup: "none" }
      : await materializeWorkspace({ repo, number, headSha, timeoutMs, anomalies });
  }
  const tier2Checker = detectTier2Checker(workspace.dir);

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
  const prFilesPath = join(sidecarDir, "pr-files.json");
  const diffPath = join(sidecarDir, "pr-diff.patch");
  const impactPath = join(sidecarDir, "impact.json");
  const undiffablePath = join(sidecarDir, "pr-undiffable-paths.json");
  writeFileSync(prFilesPath, files.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
  if (diffR.ok) writeFileSync(diffPath, diffR.stdout, "utf8");
  writeFileSync(undiffablePath, JSON.stringify(undiffable, null, 2), "utf8");

  // Shape classification — a pure local computation, no API calls.
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

  // Phase B — the impact graph. A script invocation, never a judgment call.
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

  const context = {
    v: 1,
    generatedAt: new Date().toISOString(),
    generatedBy: "prepare-review.mjs",
    elapsedMs: Date.now() - t0,

    // What the caller must still do itself. Stated in the artifact, not only in
    // the docs, so a consumer cannot read a partial context as a complete one.
    notCovered: [
      "LoreKit reads (Steps 0.7, 1.0, 1.2c, 1.2d) — priorSha below is the GitHub FALLBACK rung only, and carries no PRIOR_DIAGNOSTICS",
      "Phase C tier decision (this context supplies its inputs, not its outcome)",
      "Phases D and E, Steps 2.4*, 2.7, 2.9c",
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
    impactSummary: impact
      ? {
          path: impactPath,
          changedExports: (impact.changed_exports || []).length,
          dependencies: (impact.dependencies || []).length,
          overlaps: (impact.overlaps || []).length,
          band: impact.blast_radius?.band ?? null,
        }
      : null,
    impact: opts.inlinePayloads ? impact : null,
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
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }

  if (!opts.pr) {
    process.stderr.write(
      "usage: prepare-review.mjs --pr <url|owner/repo#n|n> [--repo owner/repo] [--out file] " +
        "[--workdir dir] [--reviewer-login login] [--no-workspace] [--no-impact] " +
        "[--inline-payloads] [--timeout-ms N] [--quiet] | --self-test\n",
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
          `  impact    ${context.impactSummary ? `band=${context.impactSummary.band} · ${context.impactSummary.changedExports} changed exports · ${context.impactSummary.dependencies} deps` : "unavailable"}`,
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
