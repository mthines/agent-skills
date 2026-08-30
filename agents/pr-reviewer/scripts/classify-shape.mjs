#!/usr/bin/env node
// classify-shape.mjs — deterministic change-shape classifier for pr-reviewer's depth routing.
//
// The reviewer's run modes key depth on diff SIZE; this script supplies the SHAPE axis:
// what kind of change this is (auth, payments, concurrency, api-contract, …), so the
// pipeline can dig deeper on a 15-line auth change and stay cheap on a 15-line docs fix.
// It also owns the high-stakes path list — previously hand-mirrored (and once corrupted)
// across three prose sites; consumers read this file's output, never a copied regex.
//
// Usage:
//   node classify-shape.mjs <files.json> [--extra-high-stakes <regex>]...
//   node classify-shape.mjs --self-test
//
// <files.json> is either a JSON array of file objects or {"files": [...]} — each entry
// {filename, patch?, status?, additions?, deletions?} (the shapes `pulls/{n}/files` and
// the compare endpoint both emit; `patch` may be absent on binary/large files).
//
// stdout (single JSON line):
//   {"shapes":["auth","concurrency"],"risky":true,"risky_shapes":["auth","concurrency"],
//    "high_stakes_files":["src/auth/login.ts"],"propagation":false}
//
// Fail-closed: unreadable input, malformed JSON, an unknown flag, or an invalid
// --extra-high-stakes regex exits non-zero and prints NOTHING on stdout, so a piping
// caller can never act on a partial classification.

import { readFileSync } from "node:fs";

// ── The high-stakes path list — THE single source of truth ─────────────────────────────
// Token-boundary matching: a listed token must be a whole path segment or a delimiter-
// bounded token inside one (`src/auth/`, `auth/`, `payment_processor.go` all match;
// `author/`, `oauthor.ts` do not). Top-level directories match — git paths carry no
// leading slash, which is why the old interior-`/token/` regex missed `auth/**` entirely.
const HIGH_STAKES_TOKENS = [
  "auth", "authz", "authorization", "authentication", "oauth", "sso", "rbac", "acl",
  "permissions?",
  "billing", "payments?", "invoic(?:e|es|ing)", "checkout", "subscription",
  "migrations?",
  "infra", "infrastructure", "terraform", "helm",
  "secrets?", "credentials?",
];
const HIGH_STAKES_RE = new RegExp(
  `(^|[/._-])(${HIGH_STAKES_TOKENS.join("|")})([/._-]|$)`, "i",
);

// ── Shape detectors ────────────────────────────────────────────────────────────────────
// Path detectors run on filenames; content detectors run on ADDED (`+`) patch lines only.
const PATH_SHAPES = [
  ["auth", /(^|[/._-])(auth|authz|authorization|authentication|oauth|sso|rbac|acl|permissions?)([/._-]|$)/i],
  ["payments", /(^|[/._-])(billing|payments?|invoic(?:e|es|ing)|checkout|subscription)([/._-]|$)/i],
  ["schema-migration", /(^|[/._-])migrations?([/._-]|$)|(^|\/)schema\.(sql|prisma|rb|graphql)$/i],
  ["infra", /(^|[/._-])(infra|infrastructure|terraform|helm|k8s|kubernetes)([/._-]|$)|(^|\/)Dockerfile|\.tf$/i],
  ["secrets", /(^|[/._-])(secrets?|credentials?)([/._-]|$)|(^|\/)\.env(\.|$)/i],
  ["api-contract", /\.(proto|graphql|gql)$|(^|[/._-])(openapi|swagger)([/._-]|$)/i],
];
const CONTENT_SHAPES = [
  // Threshold = minimum count of matching added lines before the shape fires.
  ["concurrency", /\b(mutex|rwmutex|sync\.(Mutex|RWMutex|WaitGroup|Once)|atomic\.|go func|make\(chan\b|semaphore|threading\.|multiprocessing|Promise\.(all|race|allSettled)|SharedArrayBuffer|Atomics\.)/i, 1],
  ["schema-migration", /\b(ALTER|CREATE|DROP)\s+TABLE\b|\b(ADD|DROP)\s+COLUMN\b/i, 1],
  ["api-contract", /\b(router|app)\.(get|post|put|patch|delete)\(|@(Get|Post|Put|Patch|Delete)\(|\bwebhook/i, 1],
  ["error-handling", /(\btry\s*{|\bcatch\b|\bexcept [A-Za-z]|\brescue\b|\brecover\(\)|errors\.(Is|As|Wrap|Join))/, 2],
];

// Shapes that force deep lenses regardless of delta size (`RISKY_SHAPES` in pr-reviewer.md).
const RISKY = new Set(["auth", "payments", "schema-migration", "concurrency", "api-contract", "infra", "secrets"]);

// Governing documents whose edit alongside other files marks a propagation (fan-out) PR:
// the delta lands on the authority while the induced defect sits in an untouched restatement.
const AUTHORITY_RE = /(^|\/)(CLAUDE\.md|AGENTS\.md)$|(^|\/)\.claude\/rules\/.+\.md$/;

const MANIFEST_RE = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|go\.(mod|sum)|Cargo\.(toml|lock)|requirements[^/]*\.txt|pyproject\.toml|poetry\.lock|pom\.xml|Gemfile(\.lock)?|composer\.(json|lock))$/;
const TEST_RE = /(\.test\.|\.spec\.|_test\.|(^|\/)(test|tests|__tests__|spec)\/)/;
const DOCS_RE = /\.(md|mdx|rst|txt)$|(^|\/)docs\//;

export function classify(files, extraHighStakes = []) {
  const shapes = new Set();
  const highStakesFiles = [];
  const extras = extraHighStakes.map((p) => new RegExp(p, "i"));
  const contentHits = new Map();

  for (const f of files) {
    const name = f.filename ?? "";
    if (HIGH_STAKES_RE.test(name) || extras.some((re) => re.test(name))) highStakesFiles.push(name);
    for (const [shape, re] of PATH_SHAPES) if (re.test(name)) shapes.add(shape);
    const added = (f.patch ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    for (const [shape, re, min] of CONTENT_SHAPES) {
      const hits = (contentHits.get(shape) ?? 0) + added.filter((l) => re.test(l)).length;
      contentHits.set(shape, hits);
      if (hits >= min) shapes.add(shape);
    }
  }

  const names = files.map((f) => f.filename ?? "");
  if (names.length > 0 && names.every((n) => MANIFEST_RE.test(n))) shapes.add("dependency-bump");
  if (names.length > 0 && names.every((n) => TEST_RE.test(n))) shapes.add("test-only");
  if (names.length > 0 && names.every((n) => DOCS_RE.test(n))) shapes.add("docs-only");
  const propagation = names.some((n) => AUTHORITY_RE.test(n)) && names.length > 1;
  if (propagation) shapes.add("propagation");
  // An extra-high-stakes config match is high-stakes by definition even with no shape name.
  if (highStakesFiles.length > 0) shapes.add("high-stakes-path");

  const all = [...shapes].sort();
  const risky = all.filter((sh) => RISKY.has(sh) || sh === "high-stakes-path");
  return {
    shapes: all,
    risky: risky.length > 0,
    risky_shapes: risky,
    high_stakes_files: [...new Set(highStakesFiles)].sort(),
    propagation,
  };
}

// ── Self-test — executed by L1 (scripts/eval/l1.mjs), so a regex regression fails CI ────
function selfTest() {
  const cases = [
    // [name, files, assertion]
    ["interior auth segment", [{ filename: "src/auth/login.ts" }],
      (r) => r.shapes.includes("auth") && r.high_stakes_files.length === 1 && r.risky],
    ["TOP-LEVEL auth dir (old regex missed this)", [{ filename: "auth/login.ts" }],
      (r) => r.shapes.includes("auth") && r.risky],
    ["'author' is not auth", [{ filename: "src/author/profile.ts" }],
      (r) => !r.shapes.includes("auth") && r.high_stakes_files.length === 0],
    ["'authored-delta.md' is not auth", [{ filename: "docs/authored-delta.md" }],
      (r) => !r.shapes.includes("auth")],
    ["payment singular via delimiter", [{ filename: "src/payment_processor.go" }],
      (r) => r.shapes.includes("payments") && r.risky],
    ["authorization dir (user-named case)", [{ filename: "services/authorization/grant.ts" }],
      (r) => r.shapes.includes("auth")],
    ["concurrency from patch content", [{ filename: "src/store.go", patch: "@@ -1 +1,3 @@\n+var mu sync.Mutex\n+mu.Lock()" }],
      (r) => r.shapes.includes("concurrency") && r.risky],
    ["proto file is api-contract", [{ filename: "proto/billing/v1/invoice.proto" }],
      (r) => r.shapes.includes("api-contract") && r.shapes.includes("payments")],
    ["docs-only stays cheap", [{ filename: "docs/guide.md" }, { filename: "README.md" }],
      (r) => r.shapes.includes("docs-only") && !r.risky],
    ["dependency-bump only manifests", [{ filename: "package.json" }, { filename: "package-lock.json" }],
      (r) => r.shapes.includes("dependency-bump") && !r.risky],
    ["propagation: CLAUDE.md + sibling", [{ filename: "CLAUDE.md" }, { filename: "skills/x/SKILL.md" }],
      (r) => r.propagation && r.shapes.includes("propagation")],
    ["CLAUDE.md alone is not propagation", [{ filename: "CLAUDE.md" }],
      (r) => !r.propagation],
    ["test-only", [{ filename: "src/foo.test.ts" }, { filename: "tests/bar.spec.ts" }],
      (r) => r.shapes.includes("test-only") && !r.risky],
    ["migration by SQL content", [{ filename: "db/0042_add_col.sql", patch: "@@\n+ALTER TABLE users ADD COLUMN plan text;" }],
      (r) => r.shapes.includes("schema-migration") && r.risky],
    ["extra high-stakes config pattern", [{ filename: "core/ledger/post.ts" }],
      (r, extras) => extras && r.high_stakes_files.includes("core/ledger/post.ts") && r.risky],
    ["single error-handling line stays quiet", [{ filename: "src/x.ts", patch: "@@\n+} catch (e) {" }],
      (r) => !r.shapes.includes("error-handling")],
    ["empty file list classifies to nothing", [],
      (r) => r.shapes.length === 0 && !r.risky && !r.propagation],
  ];
  let failed = 0;
  for (const [name, files, ok] of cases) {
    const wantsExtras = ok.length === 2;
    const result = classify(files, wantsExtras ? ["(^|/)ledger(/|$)"] : []);
    if (!ok(result, wantsExtras)) {
      failed++;
      process.stderr.write(`self-test FAIL: ${name} → ${JSON.stringify(result)}\n`);
    }
  }
  if (failed > 0) process.exit(1);
  process.stderr.write(`self-test OK: ${cases.length} cases\n`);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────
function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--self-test") return selfTest();
  const extras = [];
  let input = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--extra-high-stakes") {
      const pat = args[++i];
      if (!pat) { process.stderr.write("--extra-high-stakes needs a regex\n"); process.exit(2); }
      try { new RegExp(pat); } catch { process.stderr.write(`invalid regex: ${pat}\n`); process.exit(2); }
      extras.push(pat);
    } else if (args[i].startsWith("--")) {
      process.stderr.write(`unknown flag: ${args[i]}\n`); process.exit(2);
    } else if (input === null) {
      input = args[i];
    } else {
      process.stderr.write(`unexpected argument: ${args[i]}\n`); process.exit(2);
    }
  }
  if (!input) { process.stderr.write("usage: classify-shape.mjs <files.json> [--extra-high-stakes <regex>]... | --self-test\n"); process.exit(2); }
  let files;
  try {
    const raw = readFileSync(input, "utf8");
    try {
      const parsed = JSON.parse(raw);
      files = Array.isArray(parsed) ? parsed : parsed.files;
    } catch {
      // NDJSON — the shape `gh api --paginate --jq '.[] | {…}'` emits (one object per line,
      // possibly multi-line pretty-printed objects are NOT supported; gh emits compact lines).
      files = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    }
    if (!Array.isArray(files)) throw new Error("no files array");
  } catch (e) {
    process.stderr.write(`cannot read ${input}: ${e.message}\n`); process.exit(2);
  }
  process.stdout.write(JSON.stringify(classify(files, extras)) + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
