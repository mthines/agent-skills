#!/usr/bin/env node
/**
 * local-diff-files.mjs — the PR-less input adapter for the detection core.
 *
 * Emits the exact JSON shape `build-impact-graph.mjs` consumes as its
 * `<pr-files.json>` positional — `{filename, patch, status, additions,
 * deletions, sha}` per changed file — but derives every field from a LOCAL git
 * range instead of `GET /repos/{o}/{r}/pulls/{n}/files`.
 *
 * Why it exists. Phase B of the reviewer pipeline is entirely local already: it
 * reads a workdir, resolves consumers with `rg`, and reads dependency versions
 * out of a lockfile. The single thing standing between it and a branch with no
 * PR is the shape of its input file. Producing that shape here means the local
 * reviewer reuses the graph builder, the finders, and the verifier UNCHANGED —
 * one detection core, one home, and the `bug-detection` eval keeps measuring
 * the same bytes both reviewers run. A second copy of any of those would be the
 * drift surface this repo argues against everywhere else.
 *
 * Usage:
 *   node local-diff-files.mjs --base <ref> [options] > local-files.json
 *
 *     --base <ref>       base of the comparison. Required.
 *     --head <ref>       head of the comparison. Default: the WORKING TREE,
 *                        which is the point of a pre-PR review — uncommitted
 *                        work is the work being reviewed.
 *     --workdir <dir>    repository to run git in. Default: cwd.
 *     --merge-base       compare against `git merge-base <base> <head>` rather
 *                        than <base> itself (the `...` semantics GitHub uses).
 *     --staged           only staged changes. Mutually exclusive with --head.
 *     --include-untracked  add untracked, non-ignored files as `added`.
 *
 *   node local-diff-files.mjs --self-test
 *
 * Fail-closed, exactly as the graph builder is: bad input, an unknown flag, a
 * missing base ref, or a git failure exits non-zero with EMPTY stdout. A caller
 * that forgets to check the status cannot route on `[]` — an empty array means
 * "this range is genuinely clean", and it must never also mean "git broke".
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

class InputError extends Error {}

/** GitHub's `status` vocabulary, keyed by git's single-letter status. */
const STATUS = {
  A: "added",
  D: "removed",
  M: "modified",
  R: "renamed",
  C: "copied",
  T: "changed",
};

/**
 * git writes the destination blob as all zeros when there is no blob yet — a
 * working-tree diff, where the content is not written to the object store until
 * it is staged. It ABBREVIATES that value (`0000000`), so a comparison against
 * the full 40-character form silently lets a fake SHA through on exactly the
 * diff this tool exists to read.
 */
const isNullSha = (sha) => !sha || /^0+$/.test(sha);

function git(workdir, args, { allowFail = false } = {}) {
  const r = spawnSync("git", ["-C", workdir, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) throw new InputError(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new InputError(`git ${args.join(" ")} exited ${r.status}: ${(r.stderr || "").trim()}`);
  }
  return r.stdout ?? "";
}

/**
 * Split a NUL-separated git stream into records.
 * Returns [] for empty input rather than [""], which would parse as one bogus file.
 */
function nulFields(out) {
  if (!out) return [];
  const fields = out.split("\0");
  if (fields[fields.length - 1] === "") fields.pop();
  return fields;
}

/**
 * Parse `git diff --numstat -z`.
 *
 * Ordinary record:  "<adds>\t<dels>\t<path>" NUL
 * Rename/copy:      "<adds>\t<dels>\t"       NUL <oldpath> NUL <newpath> NUL
 *
 * Binary files report "-" for both counts; they become 0/0 and keep an empty
 * patch, which is what the API does too.
 */
export function parseNumstat(out) {
  const fields = nulFields(out);
  const rows = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const tab = f.indexOf("\t");
    if (tab === -1) continue;
    const [addsRaw, delsRaw, pathPart] = f.split("\t");
    const adds = addsRaw === "-" ? 0 : parseInt(addsRaw, 10);
    const dels = delsRaw === "-" ? 0 : parseInt(delsRaw, 10);
    let filename = pathPart;
    let previous = null;
    if (pathPart === "" || pathPart === undefined) {
      previous = fields[++i];
      filename = fields[++i];
    }
    if (!filename) continue;
    rows.push({
      filename,
      previous_filename: previous,
      additions: Number.isFinite(adds) ? adds : 0,
      deletions: Number.isFinite(dels) ? dels : 0,
      binary: addsRaw === "-",
    });
  }
  return rows;
}

/**
 * Parse `git diff --raw -z`.
 *
 * Record: ":<srcmode> <dstmode> <srcsha> <dstsha> <STATUS>" NUL <path> [NUL <newpath>]
 *
 * The dst SHA is the blob at head. It is all-zeros for a working-tree diff
 * (the blob is not written until the file is staged), and the caller must
 * treat that as "no blob", never as a real SHA.
 */
export function parseRaw(out) {
  const fields = nulFields(out);
  const byPath = new Map();
  for (let i = 0; i < fields.length; i++) {
    const meta = fields[i];
    if (!meta.startsWith(":")) continue;
    const parts = meta.slice(1).split(" ");
    if (parts.length < 5) continue;
    const dstSha = parts[3];
    const letter = parts[4][0];
    let filename = fields[++i];
    if (letter === "R" || letter === "C") filename = fields[++i];
    if (!filename) continue;
    byPath.set(filename, {
      status: STATUS[letter] ?? "modified",
      sha: isNullSha(dstSha) ? null : dstSha,
    });
  }
  return byPath;
}

/** Build the `git diff` range arguments from the resolved options. */
function rangeArgs({ base, head, staged }) {
  if (staged) return ["--cached", base];
  if (head) return [base, head];
  return [base];
}

function resolveBase(workdir, base, useMergeBase, head) {
  git(workdir, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (!useMergeBase) return base;
  const other = head || "HEAD";
  const mb = git(workdir, ["merge-base", base, other]).trim();
  if (!mb) throw new InputError(`no merge base between ${base} and ${other}`);
  return mb;
}

function untrackedFiles(workdir) {
  const out = git(workdir, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return nulFields(out);
}

export function collect(opts) {
  const workdir = opts.workdir || process.cwd();
  // Two separate preconditions, not one. Written as a single `&&` the first conjunct was dead:
  // a missing workdir has no `.git` either, so the test reduced to "workdir does not exist" and
  // an existing non-repo directory sailed through to fail later with a raw git error.
  if (!existsSync(workdir)) {
    throw new InputError(`workdir does not exist: ${workdir}`);
  }
  if (!existsSync(join(workdir, ".git"))) {
    throw new InputError(`workdir is not a git repository: ${workdir}`);
  }
  const base = resolveBase(workdir, opts.base, opts.mergeBase, opts.head);
  const range = rangeArgs({ base, head: opts.head, staged: opts.staged });

  const numstat = parseNumstat(git(workdir, ["diff", "--numstat", "-z", ...range]));
  const raw = parseRaw(git(workdir, ["diff", "--raw", "-z", ...range]));

  const files = numstat.map((row) => {
    const meta = raw.get(row.filename) || { status: "modified", sha: null };
    // A rename needs BOTH paths in the pathspec. Limiting to the new path alone defeats git's
    // rename detection for this invocation, so the patch comes back as a whole-new-file add
    // (`@@ -0,0 +1,N @@`) while `additions`/`deletions` still carry the real rename delta from
    // `--numstat`, which DID see the pair. The record then contradicts itself, and a finder
    // reads every line of a moved file as new code.
    const pathspec = row.previous_filename ? [row.previous_filename, row.filename] : [row.filename];
    const patch = row.binary
      ? ""
      : git(workdir, ["diff", ...range, "--", ...pathspec], { allowFail: true });
    return {
      filename: row.filename,
      patch: stripDiffHeader(patch),
      status: meta.status,
      additions: row.additions,
      deletions: row.deletions,
      sha: meta.sha,
      ...(row.previous_filename ? { previous_filename: row.previous_filename } : {}),
    };
  });

  // Untracked files exist only in the working tree, so they are coherent ONLY when the working
  // tree is what is being compared. `--staged` was already excluded; an explicit `--head <ref>`
  // is the same incoherence — it would splice working-tree files into a commit-to-commit range
  // and report them as part of a diff neither endpoint contains.
  if (opts.includeUntracked && !opts.staged && !opts.head) {
    const known = new Set(files.map((f) => f.filename));
    for (const path of untrackedFiles(workdir)) {
      if (known.has(path)) continue;
      const patch = git(workdir, ["diff", "--no-index", "--", "/dev/null", path], {
        allowFail: true,
      });
      const body = stripDiffHeader(patch);
      files.push({
        filename: path,
        patch: body,
        status: "added",
        additions: body ? body.split("\n").filter((l) => l.startsWith("+")).length : 0,
        deletions: 0,
        sha: null,
      });
    }
  }

  return files;
}

/**
 * Drop git's `diff --git` preamble so `patch` carries hunks only.
 *
 * The API's `patch` field starts at the first `@@`, and `line-validity.md`'s
 * RIGHT-side hunk-bounds pre-flight parses exactly that. Leaving the preamble
 * in shifts every computed line by the header's height — a silent off-by-N on
 * every anchor in the review.
 */
export function stripDiffHeader(patch) {
  if (!patch) return "";
  const at = patch.indexOf("\n@@");
  if (at === -1) return patch.startsWith("@@") ? patch : "";
  return patch.slice(at + 1);
}

function parseArgv(argv) {
  const flags = { includeUntracked: false, mergeBase: false, staged: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base") flags.base = argv[++i];
    else if (a === "--head") flags.head = argv[++i];
    else if (a === "--workdir") flags.workdir = argv[++i];
    else if (a === "--merge-base") flags.mergeBase = true;
    else if (a === "--staged") flags.staged = true;
    else if (a === "--include-untracked") flags.includeUntracked = true;
    else throw new InputError(`unknown flag: ${a}`);
  }
  if (!flags.base) {
    throw new InputError(
      "usage: local-diff-files.mjs --base <ref> [--head <ref>] [--workdir <dir>] " +
        "[--merge-base] [--staged] [--include-untracked] | --self-test",
    );
  }
  // Untracked files live only in the working tree, so asking for them while pinning head to a
  // ref is a contradiction, not a preference. Reject it here rather than dropping the flag in
  // `collect`: a silently-ignored flag returns a smaller file list that looks like a clean
  // answer, which is how the caller never learns the review skipped its new files.
  if (flags.includeUntracked && flags.head) {
    throw new InputError("--include-untracked requires the working tree as head; remove --head");
  }
  if (flags.includeUntracked && flags.staged) {
    throw new InputError("--include-untracked and --staged are mutually exclusive");
  }
  if (flags.staged && flags.head) {
    throw new InputError("--staged and --head are mutually exclusive");
  }
  return flags;
}

// ── self-test ────────────────────────────────────────────────────────────────

function sh(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function selfTest() {
  let pass = 0;
  const fail = [];
  const ok = (name, cond, detail = "") => {
    if (cond) pass++;
    else fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
  };

  // Pure parsers first — no filesystem, no git.
  const numstat = parseNumstat("1\t2\tsrc/a.ts\0-\t-\tlogo.png\0");
  ok("numstat parses two records", numstat.length === 2, `got ${numstat.length}`);
  ok("numstat counts", numstat[0].additions === 1 && numstat[0].deletions === 2);
  ok("numstat marks binary", numstat[1].binary === true && numstat[1].additions === 0);

  const renamed = parseNumstat("3\t0\t\0old/p.ts\0new/p.ts\0");
  ok("numstat rename takes the NEW path", renamed[0]?.filename === "new/p.ts", renamed[0]?.filename);
  ok("numstat rename keeps the old path", renamed[0]?.previous_filename === "old/p.ts");

  ok("numstat of empty input is empty", parseNumstat("").length === 0);
  ok("numstat of a lone NUL is empty", parseNumstat("\0").length === 0);

  const raw = parseRaw(
    ":100644 100644 aaaa111 bbbb222 M\0src/a.ts\0" +
      ":000000 100644 0000000 cccc333 A\0src/new.ts\0" +
      ":100644 100644 dddd444 0000000 M\0src/wt.ts\0" +
      `:100644 100644 eeee555 ${"0".repeat(40)} M\0src/wt-long.ts\0`,
  );
  ok("raw maps modified", raw.get("src/a.ts")?.status === "modified");
  ok("raw maps added", raw.get("src/new.ts")?.status === "added");
  ok("raw keeps the DST blob sha", raw.get("src/a.ts")?.sha === "bbbb222", raw.get("src/a.ts")?.sha);
  // Both spellings of "no blob". git abbreviates, so the 7-char form is the one
  // that actually appears on a working-tree diff — testing only the 40-char form
  // is how a fake SHA shipped past this parser once already.
  ok("raw nulls an ABBREVIATED all-zero sha", raw.get("src/wt.ts")?.sha === null, raw.get("src/wt.ts")?.sha);
  ok("raw nulls a full-length all-zero sha", raw.get("src/wt-long.ts")?.sha === null);

  const rawRename = parseRaw(":100644 100644 aaaa111 bbbb222 R100\0old/p.ts\0new/p.ts\0");
  ok("raw rename keys on the NEW path", rawRename.has("new/p.ts") && !rawRename.has("old/p.ts"));
  ok("raw rename status", rawRename.get("new/p.ts")?.status === "renamed");

  // The header strip — the off-by-N guard.
  const withHeader =
    "diff --git a/x.ts b/x.ts\nindex 111..222 100644\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n";
  ok("strips the diff --git preamble", stripDiffHeader(withHeader).startsWith("@@ -1 +1 @@"));
  ok("keeps an already-bare hunk", stripDiffHeader("@@ -1 +1 @@\n-a\n+b").startsWith("@@"));
  ok("empty patch stays empty", stripDiffHeader("") === "");
  ok("a header with no hunk yields empty", stripDiffHeader("diff --git a/x b/x\nBinary files differ\n") === "");

  // End-to-end against a real repository.
  const dir = mkdtempSync(join(tmpdir(), "ldf-"));
  try {
    sh(dir, "git", ["init", "-q", "-b", "main"]);
    sh(dir, "git", ["config", "user.email", "t@t.t"]);
    sh(dir, "git", ["config", "user.name", "t"]);
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/keep.ts"), "export const keep = 1;\n");
    writeFileSync(join(dir, "src/gone.ts"), "export const gone = 1;\n");
    sh(dir, "git", ["add", "-A"]);
    sh(dir, "git", ["commit", "-qm", "base"]);
    const baseSha = sh(dir, "git", ["rev-parse", "HEAD"]).trim();

    writeFileSync(join(dir, "src/keep.ts"), "export const keep = 2;\n");
    writeFileSync(join(dir, "src/added.ts"), "export const added = 3;\n");
    rmSync(join(dir, "src/gone.ts"));
    sh(dir, "git", ["add", "-A"]);
    sh(dir, "git", ["commit", "-qm", "change"]);

    const files = collect({ workdir: dir, base: baseSha });
    const byName = Object.fromEntries(files.map((f) => [f.filename, f]));
    ok("collect finds three files", files.length === 3, `got ${files.length}: ${files.map((f) => f.filename)}`);
    ok("collect marks the modified file", byName["src/keep.ts"]?.status === "modified");
    ok("collect marks the added file", byName["src/added.ts"]?.status === "added");
    ok("collect marks the removed file", byName["src/gone.ts"]?.status === "removed");
    ok("collect carries a real blob sha", /^[0-9a-f]{7,40}$/.test(byName["src/keep.ts"]?.sha ?? ""));
    ok("collect's patch starts at a hunk", byName["src/keep.ts"]?.patch.startsWith("@@"));
    ok("collect counts additions", byName["src/keep.ts"]?.additions === 1);

    // Every emitted record carries the six keys the graph builder reads.
    const required = ["filename", "patch", "status", "additions", "deletions", "sha"];
    ok(
      "every record has the graph builder's six keys",
      files.every((f) => required.every((k) => k in f)),
    );

    // A working-tree diff is the DEFAULT, and it must see uncommitted edits.
    writeFileSync(join(dir, "src/keep.ts"), "export const keep = 99;\n");
    const wt = collect({ workdir: dir, base: baseSha });
    ok("working-tree diff sees the uncommitted edit", wt.find((f) => f.filename === "src/keep.ts")?.patch.includes("99"));
    ok("working-tree blob sha is null, never all-zeros", wt.find((f) => f.filename === "src/keep.ts")?.sha === null);

    // Untracked files are opt-in, and off by default.
    writeFileSync(join(dir, "src/untracked.ts"), "export const u = 1;\n");
    const without = collect({ workdir: dir, base: baseSha });
    ok("untracked excluded by default", !without.some((f) => f.filename === "src/untracked.ts"));
    const withU = collect({ workdir: dir, base: baseSha, includeUntracked: true });
    ok("untracked included under the flag", withU.some((f) => f.filename === "src/untracked.ts"));
    ok(
      "an included untracked file is `added`",
      withU.find((f) => f.filename === "src/untracked.ts")?.status === "added",
    );

    // A clean range is an empty array, and it EXITS ZERO — distinct from a failure.
    const clean = collect({ workdir: dir, base: "HEAD", head: "HEAD" });
    ok("a clean range is empty", clean.length === 0, `got ${clean.length}`);

    // Fail-closed: a bad base ref throws rather than returning [].
    let threw = false;
    try {
      collect({ workdir: dir, base: "no-such-ref-xyz" });
    } catch {
      threw = true;
    }
    ok("a bad base ref throws, never returns []", threw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Flag parsing is fail-closed too.
  let unknownThrew = false;
  try {
    parseArgv(["--base", "x", "--nope"]);
  } catch {
    unknownThrew = true;
  }
  ok("an unknown flag throws", unknownThrew);

  let noBaseThrew = false;
  try {
    parseArgv([]);
  } catch {
    noBaseThrew = true;
  }
  ok("a missing --base throws", noBaseThrew);

  let bothThrew = false;
  try {
    parseArgv(["--base", "x", "--staged", "--head", "y"]);
  } catch {
    bothThrew = true;
  }
  ok("--staged with --head throws", bothThrew);

  const throws = (argv) => {
    try { parseArgv(argv); return false; } catch { return true; }
  };
  ok("--include-untracked with --head throws",
    throws(["--base", "x", "--include-untracked", "--head", "y"]));
  ok("--include-untracked with --staged throws",
    throws(["--base", "x", "--include-untracked", "--staged"]));

  // A rename must produce a patch that agrees with its own counts. Limiting the pathspec to the
  // new path alone yields `@@ -0,0 +1,N @@` — every line of a moved file read as new code —
  // while `additions`/`deletions` still report the real delta.
  {
    const dir = mkdtempSync(join(tmpdir(), "ldf-rename-"));
    const g = (...a) => spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    g("init", "-q", "-b", "main");
    g("config", "user.email", "t@example.invalid");
    g("config", "user.name", "t");
    writeFileSync(join(dir, "old.ts"), "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n");
    g("add", "-A");
    g("commit", "-qm", "base");
    g("mv", "old.ts", "new.ts");
    writeFileSync(join(dir, "new.ts"), "export const a = 1;\nexport const b = 2;\nexport const z = 9;\n");
    const [rec] = collect({ workdir: dir, base: "HEAD" });
    ok("rename is detected as such", rec && rec.status === "renamed" && rec.previous_filename === "old.ts");
    ok("rename patch is not a whole-file add", rec && !rec.patch.startsWith("@@ -0,0"));
    ok("rename patch agrees with its own counts",
      rec && rec.additions === 1 && rec.deletions === 1,
      rec ? `+${rec.additions}/-${rec.deletions}` : "no record");
    rmSync(dir, { recursive: true, force: true });
  }

  ok("a non-repo directory is rejected distinctly from a missing one", (() => {
    const dir = mkdtempSync(join(tmpdir(), "ldf-norepo-"));
    try {
      collect({ workdir: dir, base: "HEAD" });
      return false;
    } catch (e) {
      return /not a git repository/.test(e.message);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  })());

  if (fail.length) {
    console.error(`local-diff-files self-test: FAIL (${fail.length} of ${pass + fail.length})`);
    for (const f of fail) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(`local-diff-files self-test: PASS (${pass} assertions)`);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--self-test") return selfTest();
  try {
    const files = collect(parseArgv(argv));
    process.stdout.write(JSON.stringify(files, null, 2) + "\n");
  } catch (e) {
    if (e instanceof InputError) {
      console.error(e.message);
      process.exit(2);
    }
    console.error(e?.stack || String(e));
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
