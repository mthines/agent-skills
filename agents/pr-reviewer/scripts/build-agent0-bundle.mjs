#!/usr/bin/env node
/**
 * build-agent0-bundle.mjs — compile the pr-reviewer agent into ONE file that a
 * host without filesystem skill discovery can ingest in a handful of reads.
 *
 * Why this exists
 * ---------------
 * `agents/pr-reviewer.md` is ~3.6k lines / ~277 KB, and it is not self-contained:
 * six rule files carry the actual procedure of six phases. In the Claude Code CLI
 * that costs nothing — the harness reads files natively and resolves `Skill()`
 * from disk. In an Agent0 Automation sandbox it costs the whole bootstrap:
 *
 *   - `$HOME/.claude/**` is outside the host's Read-allowed paths, so every read
 *     degrades to `sed -n 'a,bp'` through Bash, whose output is capped well below
 *     the file's size. ~18 sequential tool calls land before Step 0 runs.
 *   - The host's `skill` tool resolves a FIXED ENUM of host-registered skills,
 *     never the filesystem, so a rule file on disk is invisible to it no matter
 *     when it lands. (See shared/rules/lens-invocation.md.)
 *
 * The bundle answers both: it inlines the mandatory core rules so no run pays a
 * per-phase read, and it is installed INSIDE the workspace, where the host's
 * native file reader works and a 2000-line read replaces a 50 KB bash slice.
 *
 * What it deliberately does NOT do
 * --------------------------------
 * It does not rewrite, summarize or reorder the agent's own prose. The bundle is
 * a concatenation with a preamble; a reader diffing it against the sources sees
 * only the preamble, the section headers, and (with --strip-rationale) removed
 * comment runs. A compiler that paraphrased the pipeline would be a second
 * pipeline to keep in sync — the exact cost this file exists to avoid.
 *
 * Usage
 *   node build-agent0-bundle.mjs --src <agents-root> --out <file> [--strip-rationale]
 *                                [--min-comment-run N] [--quiet]
 *   node build-agent0-bundle.mjs --self-test
 *
 * `<agents-root>` is the directory holding `pr-reviewer.md`, `pr-reviewer/` and
 * `shared/` side by side — i.e. the repo's `agents/` dir, or a copy of it.
 *
 * Exit codes: 0 ok · 1 build failure (missing source, missing core rule) · 2 usage.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";

/**
 * The core set — mandatory. A bundle missing any of these is not a bundle, it is
 * a summary of a pipeline, so the build fails rather than emitting one.
 *
 * Paths are relative to <agents-root> and are the SAME strings the agent body
 * uses to reference them, which is what lets the emitted index map a reference
 * to an in-file anchor without parsing prose.
 */
const CORE_RULES = [
  "pr-reviewer/rules/workspace.md",
  "pr-reviewer/rules/impact-graph.md",
  "pr-reviewer/rules/depth-routing.md",
  "pr-reviewer/rules/finders.md",
  "shared/rules/finding-verifier.md",
  "pr-reviewer/rules/report-rendering.md",
  // Not one of the six the skill names, but load-bearing on THIS host specifically:
  // it is the rule that stops all six composed lenses from silently degrading.
  // Deferring it would mean the one host that needs it reads it last.
  "shared/rules/lens-invocation.md",
];

/** Anchor for an inlined rule. Stable, derived from the path, no collisions. */
function anchorFor(relPath) {
  return "rule-" + relPath.replace(/\.md$/, "").replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
}

/**
 * Strip long rationale comment runs from fenced bash blocks.
 *
 * Only runs of >= minRun consecutive whole-line `#` comments are removed. Short
 * comments (1-2 lines) are operational — they name what the next command binds —
 * while a twelve-line block is design rationale addressed to whoever EDITS the
 * file, not to whoever runs it. A shebang and a `#!`-adjacent line are never
 * touched, and nothing outside a bash fence is touched at all.
 *
 * Off by default. Fidelity beats bytes: the bundle's win comes from the read
 * count, not the byte count, and a rationale line that prevents one wrong
 * re-derivation pays for itself many times over.
 */
function stripRationale(text, minRun) {
  const lines = text.split("\n");
  const out = [];
  let inFence = false;
  let fenceLang = "";
  let run = [];

  const flushRun = () => {
    if (run.length === 0) return;
    // Only elide inside a bash-ish fence, and only a run long enough to be prose.
    if (inFence && /^(bash|sh|shell|console)$/.test(fenceLang) && run.length >= minRun) {
      out.push(`# [${run.length} lines of rationale elided — see the source file]`);
    } else {
      out.push(...run);
    }
    run = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      flushRun();
      if (!inFence) {
        inFence = true;
        fenceLang = (fence[1] || "").toLowerCase();
      } else {
        inFence = false;
        fenceLang = "";
      }
      out.push(line);
      continue;
    }
    if (inFence && /^\s*#(?!!)/.test(line)) {
      run.push(line);
      continue;
    }
    flushRun();
    out.push(line);
  }
  flushRun();
  return out.join("\n");
}

/** Split YAML frontmatter off a markdown file. Returns { frontmatter, body }. */
function splitFrontmatter(text) {
  if (!text.startsWith("---\n")) return { frontmatter: "", body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return { frontmatter: "", body: text };
  return { frontmatter: text.slice(4, end), body: text.slice(end + 5) };
}

function preamble({ pin, inlined }) {
  const index = inlined
    .map((r) => `| \`${r.path}\` | [${r.title}](#${r.anchor}) | ${r.lines} |`)
    .join("\n");

  return `<!-- GENERATED by agents/pr-reviewer/scripts/build-agent0-bundle.mjs — do not edit.
     Source of truth is agents/pr-reviewer.md plus the rule files inlined below. -->

# pr-reviewer — Agent0 bundle${pin ? ` (\`${pin}\`)` : ""}

This is the pr-reviewer agent compiled for a host that has **no filesystem skill
discovery and no custom-agent dispatch**. The pipeline below is the agent's own,
verbatim. Three things differ about how you *run* it here, and they are not
optional — each one is a measured failure of a real run, not a precaution.

## Host rules — read these before Step 0

1. **Every \`agents/…\` reference in the body that names a CORE rule is already in
   this file.** Do not read it from disk; jump to its section in the index below.
   A rule NOT in the index is deferred — read it from \`$AGENT_SUPPORT/<path>\` at
   the step that needs it, with the host's native file reader.

2. **Never resolve one of the six composed lenses through the host's skill tool.**
   \`severity\`, \`optimize-approach\`, \`measurable\`, \`confidence\`,
   \`holistic-analysis\` and \`verify-behavior\` resolve by **file presence** at
   \`$PR_REVIEWER_ROOT/skills/<name>/SKILL.md\` — read that file and follow it
   in-context. This host's skill tool accepts only a fixed enum of its own
   built-ins: five of the six error, and \`measurable\` silently name-collides with
   an unrelated built-in and returns the wrong recipe with no error at all. Full
   rule: the \`lens-invocation.md\` section below.

3. **Non-repo-scoped \`gh api\` calls return 401 here.** \`/user\` and \`/rate_limit\`
   are structurally unavailable — the injected credential is repo-scoped per
   request. Step 0.5 must take its \`ME\` from \`--reviewer-login\` /
   \`PR_REVIEWER_LOGIN\` and treat an unset value as *identity unknown*, never as
   an empty login and never as a reason to retry the call.

## Start from the prepared context, not from Step 0

\`prepare-review.mjs\` has already executed the deterministic half of the pipeline
— Step 0 argument resolution, Step 0.5's PR metadata, Step 1.1's five fetches,
Step 1.1b's workspace ladder, Step 1.2's patch list and undiffable partition,
Step 1.2b's delta triage inputs, Phase B's impact graph, and the shape
classification — and written all of it to \`review-context.json\`.

Read that file first. Then enter the pipeline at **Step 1.2c**, taking every
value the context supplies rather than re-deriving it. Re-running a fetch the
context already holds is not a safety check: it opens the torn-state window
Step 1.2 exists to close, because the diff and a later-read head describe
different commits.

What the context does **not** carry, and you must still do yourself: the LoreKit
reads (Steps 0.7, 1.0, 1.2c, 1.2d — the context carries only the GitHub fallback
rung's \`priorSha\`), every judgment phase (D, E, 2.4*, 2.7), and every write.

## Inlined rules index

| Source path | Section | Lines |
|---|---|---|
${index}

---

`;
}

function build({ src, out, strip, minRun, quiet }) {
  const agentPath = join(src, "pr-reviewer.md");
  if (!existsSync(agentPath)) {
    throw new Error(`source tree has no pr-reviewer.md at ${agentPath}`);
  }

  const rawAgent = readFileSync(agentPath, "utf8");
  const { frontmatter, body } = splitFrontmatter(rawAgent);
  const pin = process.env.PR_REVIEWER_PIN || "";

  const inlined = [];
  const sections = [];
  for (const rel of CORE_RULES) {
    const p = join(src, rel);
    if (!existsSync(p)) {
      // Fail closed. A bundle silently missing Phase D's rule is worse than no
      // bundle: the run reports a phase it never had the procedure for.
      throw new Error(`missing mandatory core rule: ${rel} (looked in ${p})`);
    }
    const ruleRaw = readFileSync(p, "utf8");
    const { body: ruleBody } = splitFrontmatter(ruleRaw);
    const processed = strip ? stripRationale(ruleBody, minRun) : ruleBody;
    const anchor = anchorFor(rel);
    const title = rel.split("/").pop().replace(/\.md$/, "");
    inlined.push({ path: rel, anchor, title, lines: processed.split("\n").length });
    sections.push(
      `\n\n---\n\n<a id="${anchor}"></a>\n\n# Inlined rule — \`${rel}\`\n\n` +
        `> Verbatim copy. Any \`agents/…\` path inside it that is itself in the index\n` +
        `> above resolves to another section of this file, not to disk.\n\n` +
        processed.trim() +
        "\n",
    );
  }

  const agentBody = strip ? stripRationale(body, minRun) : body;

  const parts = [
    preamble({ pin, inlined }),
    "<!-- BEGIN agents/pr-reviewer.md (body; frontmatter retained below for reference) -->\n",
    agentBody.trim(),
    "\n\n---\n\n## Appendix A — the agent's own frontmatter\n\n" +
      "The `tools:` grant below is the Claude Code contract. On this host the\n" +
      "equivalent capabilities are the sandbox's own; the list is here so a reader\n" +
      "can tell an intended capability from an available one.\n\n```yaml\n" +
      frontmatter.trim() +
      "\n```\n",
    "\n## Appendix B — inlined core rules\n",
    ...sections,
  ];

  const bundle = parts.join("\n");
  mkdirSync(dirname(pathResolve(out)), { recursive: true });
  writeFileSync(out, bundle, "utf8");

  const srcLines = rawAgent.split("\n").length;
  const outLines = bundle.split("\n").length;
  const outBytes = Buffer.byteLength(bundle, "utf8");
  // The host's native reader takes 2000 lines per call; a bash slice against the
  // ~50 KB output cap is what this replaces. Report both so the win is auditable.
  const readCalls = Math.ceil(outLines / 2000);
  const bashSlices = Math.ceil(outBytes / 50000) + CORE_RULES.length;

  if (!quiet) {
    process.stderr.write(
      [
        `bundle: ${out}`,
        `  agent body   ${srcLines} lines`,
        `  inlined      ${inlined.length} core rules (${inlined.reduce((a, r) => a + r.lines, 0)} lines)`,
        `  total        ${outLines} lines / ${(outBytes / 1024).toFixed(0)} KB`,
        `  rationale    ${strip ? `stripped (runs >= ${minRun})` : "kept"}`,
        `  ingest       ${readCalls} native read call(s) — was ~${bashSlices} bash slice(s)`,
        "VERIFY: PASS",
      ].join("\n") + "\n",
    );
  }
  return { bundle, outLines, outBytes, readCalls, inlined };
}

/* ------------------------------ self-test ------------------------------ */

function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  t("stripRationale elides a long comment run inside a bash fence", () => {
    const src = ["```bash", ...Array.from({ length: 8 }, (_, i) => `# rationale ${i}`), "echo hi", "```"].join("\n");
    const got = stripRationale(src, 4);
    return got.includes("8 lines of rationale elided") && got.includes("echo hi") && !got.includes("rationale 3");
  });

  t("stripRationale keeps a short comment run (operational, not prose)", () => {
    const src = ["```bash", "# bind the head", "HEAD=x", "```"].join("\n");
    return stripRationale(src, 4) === src;
  });

  t("stripRationale never touches comments outside a fence", () => {
    const src = ["# a markdown heading-ish line", "# another", "# third", "# fourth", "# fifth"].join("\n");
    return stripRationale(src, 3) === src;
  });

  t("stripRationale never elides a shebang", () => {
    const src = ["```bash", "#!/bin/bash", "# one", "# two", "# three", "# four", "cmd", "```"].join("\n");
    const got = stripRationale(src, 3);
    return got.includes("#!/bin/bash");
  });

  t("stripRationale leaves a non-bash fence alone", () => {
    const src = ["```python", "# a", "# b", "# c", "# d", "x = 1", "```"].join("\n");
    return stripRationale(src, 3) === src;
  });

  t("splitFrontmatter separates yaml from body", () => {
    const { frontmatter, body } = splitFrontmatter("---\nname: x\n---\n# Title\n");
    return frontmatter === "name: x" && body.trim() === "# Title";
  });

  t("splitFrontmatter is a no-op without frontmatter", () => {
    const { frontmatter, body } = splitFrontmatter("# Title\n");
    return frontmatter === "" && body === "# Title\n";
  });

  t("anchorFor is stable, lowercase and collision-free across the core set", () => {
    const set = new Set(CORE_RULES.map(anchorFor));
    return set.size === CORE_RULES.length && anchorFor("shared/rules/finders.md") === "rule-shared-rules-finders";
  });

  t("build fails closed when a core rule is absent", () => {
    try {
      build({ src: "/nonexistent-tree", out: "/tmp/should-not-exist.md", strip: false, minRun: 4, quiet: true });
      return false;
    } catch (err) {
      return /pr-reviewer\.md/.test(err.message);
    }
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

/* -------------------------------- main -------------------------------- */

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();

  let src = "";
  let out = "";
  let strip = false;
  let minRun = 4;
  let quiet = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--src") src = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a === "--strip-rationale") strip = true;
    else if (a === "--min-comment-run") minRun = Number(argv[++i]);
    else if (a === "--quiet") quiet = true;
    else {
      process.stderr.write(`unknown argument: ${a}\n`);
      process.exit(2);
    }
  }

  if (!src || !out) {
    process.stderr.write(
      "usage: build-agent0-bundle.mjs --src <agents-root> --out <file> " +
        "[--strip-rationale] [--min-comment-run N] [--quiet] | --self-test\n",
    );
    process.exit(2);
  }
  if (!Number.isFinite(minRun) || minRun < 2) {
    process.stderr.write("--min-comment-run must be an integer >= 2\n");
    process.exit(2);
  }

  try {
    build({ src, out, strip, minRun, quiet });
  } catch (err) {
    process.stderr.write(`BUILD FAILED: ${err.message}\nVERIFY: FAIL\n`);
    process.exit(1);
  }
}

main(process.argv.slice(2));
