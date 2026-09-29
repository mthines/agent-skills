#!/usr/bin/env node
// @ts-check
// gate4-scan.mjs — Gate 4 (self-review signals) pre-candidate scanner
// (pr-reviewer deterministic pipeline, D6). A PURE regex pass over
// `+`-prefixed diff lines producing PRE-candidates only — it never emits a
// verdict. The model still marks each pre-candidate `confirm` or `exempt`
// (the prose-vs-code carve-out — agents/pr-reviewer.md § "Gate 4 — Self-review
// signals", the "would deleting the pattern remove leftover work, or remove
// the sentence's meaning?" test) and adds any AI-stub findings, which stay
// judgment-only and are never mechanical. `validate-judgments.mjs` (Phase 2)
// owns the rule that a `secret` pre-candidate can never be exempted — that is
// a validation-time policy, not a scan-time one, so this file makes no
// distinction between categories when it emits candidates.
//
// Input shape matches the PR-files rows every other pipeline script already
// consumes (delta-triage.mjs, route-depth.mjs's upstream): `{filename, patch}`
// — gh's own per-file unified-diff fragment, starting at the first `@@`. No
// I/O — the caller (prepare-review.mjs, D10) supplies the files.

/** @typedef {{filename: string, patch?: string|null}} PatchFile */
/** @typedef {{category: string, file: string, line: number, text: string}} Gate4Precandidate */

/**
 * One category = one or more regexes; a line counts once per category even
 * when several of its regexes match (e.g. a line naming both `console.log`
 * and `debugger`) — the category is the signal Gate 4 grades on, not the
 * pattern count.
 * @type {{category: string, patterns: RegExp[]}[]}
 */
const CATEGORIES = [
  {
    category: "debug-leftover",
    patterns: [
      /\bconsole\.(?:log|debug)\s*\(/,
      /\bdebugger\b/,
      /\bbreakpoint\s*\(\s*\)/,
      /\bbinding\.pry\b/,
      /\bfmt\.Println\s*\(/,
      /\bdbg!\s*\(/,
      /\bSystem\.out\.println\s*\(/,
      /\bpp\s+[\w"'@]/,
      /\bprint\s*\(/,
    ],
  },
  {
    // Heuristic: a whole-line comment (nothing but the comment marker and its
    // body) whose body itself looks like executable code rather than prose —
    // ends in a statement terminator, or opens with a call/keyword shape.
    // This is deliberately conservative (favors missing a candidate over
    // flagging prose) since Gate 4's own carve-out already re-adjudicates
    // every hit downstream.
    category: "commented-out-code",
    patterns: [
      /^(?:\/\/|#|--)\s*(?:const|let|var|function|return|if\s*\(|for\s*\(|while\s*\(|import\s|export\s|class\s|def\s|public\s|private\s|await\s)[^]*[;{}]\s*$/,
      /^(?:\/\/|#|--)\s*[\w.]+\([^)]*\)\s*;?\s*$/,
    ],
  },
  {
    category: "unfinished-marker",
    patterns: [/\b(?:TODO|FIXME|HACK|XXX|WIP|TEMP)\b/],
  },
  {
    category: "conflict-marker",
    patterns: [/^<{7}(?!=)/, /^={7}$/, /^>{7}(?!=)/],
  },
  {
    category: "test-focus",
    patterns: [
      /\.only\s*\(/,
      /\bfdescribe\s*\(/,
      /\bfit\s*\(/,
      /\.skip\s*\(/,
      /\bxit\s*\(/,
      /@pytest\.mark\.skip\b/,
    ],
  },
  {
    category: "unexplained-suppression",
    patterns: [
      /\beslint-disable\b/,
      /@ts-ignore\b/,
      /@ts-nocheck\b/,
      /#\s*noqa\b/,
      /#\s*type:\s*ignore\b/,
      /#nosec\b/,
      /\/\/\s*nolint\b/,
    ],
  },
  {
    category: "secret",
    patterns: [
      /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9\-_.]{12,}['"]/i,
      /\bsk-[A-Za-z0-9]{16,}\b/,
      /\bAKIA[0-9A-Z]{16}\b/,
      /\bghp_[A-Za-z0-9]{20,}\b/,
    ],
  },
  {
    category: "local-path",
    patterns: [
      /\/Users\/[^\s'"`]+/,
      /\/home\/[a-zA-Z0-9._-]+\/[^\s'"`]+/,
      /C:\\Users\\[^\s'"`]+/,
    ],
  },
];

/**
 * Parses ONE file's unified-diff `patch` fragment into its `+`-prefixed
 * addition lines, each carrying the RIGHT-side (new-file) line number a
 * finding anchors to.
 * @param {string|null|undefined} patch @returns {{lineNo: number, text: string}[]}
 */
export function additionsOf(patch) {
  if (!patch) return [];
  /** @type {{lineNo: number, text: string}[]} */
  const out = [];
  let rightLine = 0;
  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { rightLine = parseInt(hunk[1], 10); continue; }
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw.startsWith("+++") || raw.startsWith("---")) continue;
    if (raw.startsWith("+")) {
      out.push({ lineNo: rightLine, text: raw.slice(1) });
      rightLine++;
    } else if (raw.startsWith("-")) {
      // removed line — no right-side line number, no addition to scan
    } else {
      rightLine++; // context line
    }
  }
  return out;
}

/**
 * Scans one file's additions and returns Gate 4 pre-candidates, deduped so a
 * line matching several patterns in the same category yields one candidate.
 * @param {PatchFile} file @returns {Gate4Precandidate[]}
 */
export function scanGate4File(file) {
  /** @type {Gate4Precandidate[]} */
  const out = [];
  for (const { lineNo, text } of additionsOf(file.patch)) {
    const trimmed = text.trim();
    if (trimmed === "") continue;
    for (const { category, patterns } of CATEGORIES) {
      if (patterns.some((re) => re.test(trimmed))) {
        out.push({ category, file: file.filename, line: lineNo, text: trimmed.slice(0, 200) });
      }
    }
  }
  return out;
}

/**
 * Scans every file's additions. Order is stable: file order in, then line
 * order within a file.
 * @param {PatchFile[]} files @returns {Gate4Precandidate[]}
 */
export function scanGate4(files) {
  /** @type {Gate4Precandidate[]} */
  const out = [];
  for (const f of files || []) out.push(...scanGate4File(f));
  return out;
}

/* --------------------------------- self-test --------------------------------- */

function selfTest() {
  /** @type {string[]} */
  const fails = [];
  /** @param {string} label @param {boolean} cond @param {string} [detail] */
  const ok = (label, cond, detail = "") => { if (!cond) fails.push(`${label}${detail ? " — " + detail : ""}`); };

  /** @param {Gate4Precandidate[]} cands @param {string} category @returns {Gate4Precandidate[]} */
  const byCat = (cands, category) => cands.filter((c) => c.category === category);

  // One positive fixture per category, each its own file so line/filename
  // anchoring is independently checkable.
  const debug = scanGate4File({
    filename: "src/a.ts",
    patch: "@@ -1,1 +1,3 @@\n context\n+console.log('here');\n+debugger;\n",
  });
  ok("debug-leftover: console.log and debugger both flagged", byCat(debug, "debug-leftover").length === 2, JSON.stringify(debug));
  ok("debug-leftover: anchors to the right-side line number", debug[0].line === 2 && debug[0].file === "src/a.ts");

  const commented = scanGate4File({
    filename: "src/b.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+// const result = compute(x, y);\n",
  });
  ok("commented-out-code: a disabled statement is flagged", byCat(commented, "commented-out-code").length === 1, JSON.stringify(commented));

  const commentedProse = scanGate4File({
    filename: "src/b.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+// This function computes the total for the order.\n",
  });
  ok("commented-out-code: explanatory prose is not flagged (favors missing over false-flagging)", byCat(commentedProse, "commented-out-code").length === 0, JSON.stringify(commentedProse));

  const marker = scanGate4File({
    filename: "src/c.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+// TODO(alice): handle the retry case\n",
  });
  ok("unfinished-marker: TODO is flagged", byCat(marker, "unfinished-marker").length === 1);

  const conflict = scanGate4File({
    filename: "src/d.ts",
    patch: "@@ -1,1 +1,4 @@\n context\n+<<<<<<< HEAD\n+=======\n+>>>>>>> feature\n",
  });
  ok("conflict-marker: all three markers flagged", byCat(conflict, "conflict-marker").length === 3, JSON.stringify(conflict));

  const testFocus = scanGate4File({
    filename: "src/e.test.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+describe.only('x', () => {});\n",
  });
  ok("test-focus: .only is flagged", byCat(testFocus, "test-focus").length === 1);

  const suppression = scanGate4File({
    filename: "src/f.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+// @ts-ignore\n",
  });
  ok("unexplained-suppression: @ts-ignore is flagged", byCat(suppression, "unexplained-suppression").length === 1);

  const secret = scanGate4File({
    filename: "src/g.ts",
    patch: '@@ -1,1 +1,2 @@\n context\n+const apiKey = "sk-liveAbCdEfGhIjKlMnOpQrSt";\n',
  });
  ok("secret: an sk- style key is flagged", byCat(secret, "secret").length >= 1, JSON.stringify(secret));

  const localPath = scanGate4File({
    filename: "src/h.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+const cfg = '/Users/mads/scratch/config.json';\n",
  });
  ok("local-path: an absolute /Users path is flagged", byCat(localPath, "local-path").length === 1);

  // Removed lines and context lines are never scanned — only `+` additions.
  const removedOnly = scanGate4File({
    filename: "src/i.ts",
    patch: "@@ -1,2 +1,1 @@\n context\n-console.log('going away');\n",
  });
  ok("a removed console.log (- line) is never flagged", removedOnly.length === 0, JSON.stringify(removedOnly));

  // Clean code produces zero candidates.
  const clean = scanGate4File({
    filename: "src/j.ts",
    patch: "@@ -1,1 +1,3 @@\n context\n+export function add(a, b) {\n+  return a + b;\n",
  });
  ok("ordinary clean code produces no candidates", clean.length === 0, JSON.stringify(clean));

  // A line matching two patterns in the same category dedupes to one candidate.
  const dedupe = scanGate4File({
    filename: "src/k.ts",
    patch: "@@ -1,1 +1,2 @@\n context\n+console.log('x'); debugger;\n",
  });
  ok("two hits in one category on one line dedupe to one candidate", byCat(dedupe, "debug-leftover").length === 1, JSON.stringify(dedupe));

  // A one-file PR with no patch (binary/undiffable) yields no candidates, not a crash.
  ok("a null patch (binary/undiffable file) yields no candidates", scanGate4File({ filename: "img.png", patch: null }).length === 0);

  // Multi-file aggregation preserves file order and per-file line numbers.
  const multi = scanGate4([
    { filename: "a.ts", patch: "@@ -1,1 +1,2 @@\n context\n+debugger;\n" },
    { filename: "b.ts", patch: "@@ -1,1 +1,2 @@\n context\n+// FIXME later\n" },
  ]);
  ok("scanGate4 aggregates across files in order", multi.length === 2 && multi[0].file === "a.ts" && multi[1].file === "b.ts", JSON.stringify(multi));

  console.log(`${fails.length === 0 ? "✓" : "✗"} gate4-scan self-test: ${fails.length === 0 ? "all checks passed" : `${fails.length} failed`}`);
  for (const f of fails) console.log(`    ✗ ${f}`);
  if (fails.length) process.exit(1);
}

const isEntryPoint = process.argv[1] && process.argv[1].endsWith("gate4-scan.mjs");
if (isEntryPoint && process.argv.includes("--self-test")) {
  selfTest();
}
