#!/usr/bin/env node
// @ts-check
/**
 * discover-standards.mjs — Step 1.7b as a function (A/B iteration 4, speed).
 *
 * Both halves of Step 1.7b are mechanical, and both were being done by the model:
 *
 *   1. TRIVIAL_SKIP — the four conditions in holistic-review.md § Trivial-skip set (whitespace-only,
 *      dependency-bump-only, test-only, < 10 changed lines with no high-stakes path).
 *   2. STANDARDS_DOCS — standards-conformance.md § Source 1: per changed file, the nearest non-root
 *      `CLAUDE.md`, the `.claude/rules/*.md` whose `globs:` match, the root `AGENTS.md`, and the
 *      root `CLAUDE.md`; extract the normative statements ("must", "always", "never",
 *      "prefer X over Y", "do not", "forbidden") with their `doc:line`; cap nearest-first; log drops.
 *
 * Every arm on sync-tray#72 did (2) by hand — "grepped CLAUDE.md and the telemetry rule", "informal
 * discovery" — so each run extracted a different rule set and spent 2–4 model turns doing it.
 *
 * One deliberate change from the prose procedure, and why: the 30,000-character cap now applies to
 * the NORMATIVE TEXT handed to the model, not to the raw documents. The prose read whole documents
 * into context, so it bounded the root `CLAUDE.md` to an 8,000-character slice to keep one large
 * file from spending the budget. This script reads documents itself and hands over only their
 * normative lines, so the whole root file can be scanned at the same context cost — a rule on line
 * 1,011 of a 77 KB `CLAUDE.md` is no longer invisible because it sits past character 8,000.
 * Nearest-first ordering and the drop log are unchanged.
 *
 * A review-config `standards:` block (Source 2) is detected, not parsed — its presence is reported
 * so the caller merges it by hand, per review-config.md § Standards.
 *
 * Usage
 *   node discover-standards.mjs --context <context.json> [--out <file>]
 *   node discover-standards.mjs --self-test
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { classifyRole } from "./review-packet.mjs";

export const STANDARDS_CAP_CHARS = 30000;
const NORMATIVE_RE = /\b(must|always|never|do not|don't|forbidden)\b|\bprefer\b.*\bover\b/i;
const HIGH_STAKES_RE = /(^|\/)(auth|billing|payments|migrations|infra)(\/|$)/;

/**
 * A minimal glob → RegExp: `**` spans directories, `*` stays within one, `?` is one character.
 * @param {string} glob
 */
export function globToRegExp(glob) {
  let re = "";
  const g = String(glob).trim().replace(/^\.\//, "");
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") { re += g[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += g[i + 2] === "/" ? 2 : 1; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/**
 * The `globs:` of a rules file's frontmatter: a string, a comma list, or a YAML list. `null` when
 * the file declares none (it then applies to every path).
 * @param {string} text
 * @returns {string[]|null}
 */
export function frontmatterGlobs(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const lines = m[1].split("\n");
  const i = lines.findIndex((l) => /^globs:/.test(l));
  if (i === -1) return null;
  const inline = lines[i].replace(/^globs:\s*/, "").trim();
  const unq = (/** @type {string} */ s) => s.trim().replace(/^["']|["']$/g, "");
  if (inline.startsWith("[")) return inline.slice(1, -1).split(",").map(unq).filter(Boolean);
  if (inline) return inline.split(",").map(unq).filter(Boolean);
  const out = [];
  for (let j = i + 1; j < lines.length && /^\s*-\s/.test(lines[j]); j++) out.push(unq(lines[j].replace(/^\s*-\s*/, "")));
  return out;
}

/**
 * Normative lines of a document, outside code fences, with their 1-based line numbers.
 * @param {string} text
 * @returns {Array<{ line: number, text: string }>}
 */
export function normativeLines(text) {
  const out = [];
  let fenced = false;
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const t = l.trim();
    if (!t || /^#/.test(t) || /^\|?\s*-{3,}/.test(t)) continue;
    if (NORMATIVE_RE.test(t)) out.push({ line: i + 1, text: t.length > 400 ? `${t.slice(0, 400)}…` : t });
  }
  return out;
}

/**
 * TRIVIAL_SKIP, per holistic-review.md § Trivial-skip set. Any one condition triggers it.
 * @param {{ files: Array<{ filename: string, patch?: string, additions?: number, deletions?: number }>, highStakesFiles?: string[] }} a
 * @returns {{ value: boolean, reason: string|null }}
 */
export function trivialSkip({ files, highStakesFiles = [] }) {
  if (!files.length) return { value: false, reason: null };
  const lines = files.reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0);
  const whitespaceOnly = files.every((f) => {
    if (!f.patch) return false;
    const add = [];
    const del = [];
    for (const l of f.patch.split("\n")) {
      if (l.startsWith("+")) add.push(l.slice(1).replace(/\s+/g, ""));
      else if (l.startsWith("-")) del.push(l.slice(1).replace(/\s+/g, ""));
    }
    return add.sort().join("\n") === del.sort().join("\n");
  });
  if (whitespaceOnly) return { value: true, reason: "whitespace-only" };
  const MANIFEST_RE = /(^|\/)(package\.json|Cargo\.toml|go\.mod|pyproject\.toml|Gemfile|Podfile|composer\.json)$/;
  const depBump = files.every((f) => classifyRole(f.filename) === "generated" && !/\.pbxproj$/.test(f.filename)
    || (MANIFEST_RE.test(f.filename) && (f.patch || "").split("\n").filter((l) => /^[+-][^+-]/.test(l)).every((l) => /version|"\^?~?\d|=\s*"?\d|\bv?\d+\.\d+/.test(l))));
  if (depBump && files.some((f) => MANIFEST_RE.test(f.filename) || classifyRole(f.filename) === "generated")) {
    return { value: true, reason: "dependency-bump-only" };
  }
  if (files.every((f) => classifyRole(f.filename) === "test")) return { value: true, reason: "test-only" };
  const highStakes = highStakesFiles.length > 0 || files.some((f) => HIGH_STAKES_RE.test(f.filename));
  if (lines < 10 && !highStakes) return { value: true, reason: "under 10 changed lines, no high-stakes path" };
  return { value: false, reason: null };
}

/**
 * Source 1 discovery over a checkout. Reads files under `root`; otherwise pure.
 * @param {{ root: string, changed: string[], capChars?: number }} a
 */
export function discoverStandards({ root, changed, capChars = STANDARDS_CAP_CHARS }) {
  /** @type {Map<string, { path: string, kind: string, bullets: Array<{line: number, text: string}> }>} */
  const docs = new Map();
  /** @type {Record<string, string[]>} */
  const byFile = {};
  const read = (/** @type {string} */ p) => { try { return readFileSync(join(root, p), "utf8"); } catch { return null; } };
  const load = (/** @type {string} */ p, /** @type {string} */ kind) => {
    if (!docs.has(p)) {
      const text = read(p);
      if (text === null) return false;
      docs.set(p, { path: p, kind, bullets: normativeLines(text) });
    }
    return true;
  };
  const rulesDir = ".claude/rules";
  const rules = existsSync(join(root, rulesDir))
    ? readdirSync(join(root, rulesDir)).filter((f) => f.endsWith(".md")).sort().map((f) => posix.join(rulesDir, f))
    : [];
  for (const file of changed) {
    const list = [];
    // (a) the nearest NON-root CLAUDE.md at or above the file's directory.
    for (let d = posix.dirname(file); d !== "." && d !== "/" && d !== ""; d = posix.dirname(d)) {
      const cand = posix.join(d, "CLAUDE.md");
      if (existsSync(join(root, cand))) { if (load(cand, "package-claude")) list.push(cand); break; }
    }
    // (b) rules whose globs match (no globs ⇒ applies everywhere).
    for (const r of rules) {
      const text = read(r);
      if (text === null) continue;
      const globs = frontmatterGlobs(text);
      if (globs === null || globs.some((g) => globToRegExp(g).test(file))) { if (load(r, "rule")) list.push(r); }
    }
    // (c) root AGENTS.md, (d) root CLAUDE.md — scanned whole (see the header for why).
    if (load("AGENTS.md", "agents")) list.push("AGENTS.md");
    if (load("CLAUDE.md", "root-claude")) list.push("CLAUDE.md");
    byFile[file] = list;
  }
  // Nearest-first order across the run: the order documents were first reached, which is
  // package CLAUDE.md → rules → AGENTS.md → root CLAUDE.md for the first file that reaches each.
  const ordered = [...docs.values()];
  const rank = { "package-claude": 0, rule: 1, agents: 2, "root-claude": 3 };
  ordered.sort((x, y) => rank[/** @type {keyof typeof rank} */ (x.kind)] - rank[/** @type {keyof typeof rank} */ (y.kind)]);
  let used = 0;
  const kept = [];
  const dropped = [];
  for (const d of ordered) {
    const cost = d.bullets.reduce((n, b) => n + b.text.length + 1, 0);
    if (used + cost > capChars) {
      // A document whose bullets do not all fit keeps the ones that do, in order, and says so —
      // never a silent truncation.
      const fit = [];
      for (const b of d.bullets) { if (used + b.text.length + 1 > capChars) break; fit.push(b); used += b.text.length + 1; }
      if (fit.length) kept.push({ ...d, bullets: fit, truncated: d.bullets.length - fit.length });
      dropped.push({ path: d.path, reason: `cap exceeded (budget ${capChars} chars) — ${d.bullets.length - fit.length} of ${d.bullets.length} normative lines not loaded` });
      continue;
    }
    used += cost;
    kept.push(d);
  }
  const bulletCount = kept.reduce((n, d) => n + d.bullets.length, 0);
  const reviewConfigStandards = [".github/review.yaml", ".review.yaml"].some((p) => /^standards:/m.test(read(p) || ""));
  return {
    docs: kept, byFile, dropped, bulletCount, chars: used, capChars, reviewConfigStandards,
    announce: `Standards discovery: ${kept.length} governing doc(s) loaded, ${bulletCount} normative bullet(s) extracted.`
      + (dropped.length ? ` ${dropped.length} doc(s) capped — ${dropped.map((d) => d.path).join(", ")}.` : ""),
  };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

/** @param {string[]} argv */
function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const i = argv.indexOf("--context");
  if (i === -1) { console.error("usage: discover-standards.mjs --context <context.json> [--out <file>] | --self-test"); process.exit(2); }
  const ctxPath = argv[i + 1];
  const context = JSON.parse(readFileSync(ctxPath, "utf8"));
  const root = context.workspace?.dir;
  if (!root) { console.error("discover-standards: context has no workspace.dir"); process.exit(1); }
  const changed = (context.files || []).map((/** @type {any} */ f) => f.filename);
  const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : join(dirname(ctxPath), "standards.json");
  const result = discoverStandards({ root, changed });
  writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(result.announce);
}

function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };
  check("globToRegExp: ** spans directories, * does not",
    globToRegExp("src/**/*.ts").test("src/a/b/c.ts") && globToRegExp("src/**/*.ts").test("src/c.ts")
      && !globToRegExp("src/*.ts").test("src/a/c.ts") && globToRegExp("*.md").test("README.md"));
  check("frontmatterGlobs reads inline, list, and absent forms",
    JSON.stringify(frontmatterGlobs("---\nglobs: src/**, lib/*\n---\nx")) === JSON.stringify(["src/**", "lib/*"])
      && JSON.stringify(frontmatterGlobs("---\nglobs:\n  - \"a/**\"\n  - b/*\n---\n")) === JSON.stringify(["a/**", "b/*"])
      && frontmatterGlobs("# no frontmatter") === null);
  const nl = normativeLines("# Title\nYou must validate input.\n```\nnever inside a fence\n```\nPrefer tabs over spaces.\nPlain prose.\n- Do not log secrets.");
  check("normativeLines keeps normative lines with line numbers and skips fences and headings",
    nl.length === 3 && nl[0].line === 2 && nl[1].text.startsWith("Prefer") && nl[2].line === 8, JSON.stringify(nl));

  check("trivialSkip: test-only", trivialSkip({ files: [{ filename: "src/a.test.ts", additions: 50, patch: "+x" }] }).reason === "test-only");
  check("trivialSkip: whitespace-only",
    trivialSkip({ files: [{ filename: "src/a.ts", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-  x = 1\n+x = 1" }] }).reason === "whitespace-only");
  check("trivialSkip: a small change on an auth path is not trivial",
    trivialSkip({ files: [{ filename: "src/auth/login.ts", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-a\n+b\n+c" }] }).value === false);
  check("trivialSkip: a small change elsewhere is trivial",
    trivialSkip({ files: [{ filename: "src/util.ts", additions: 2, deletions: 1, patch: "@@ -1 +1,2 @@\n-a\n+b\n+c" }] }).reason === "under 10 changed lines, no high-stakes path");
  check("trivialSkip: a real change is not trivial",
    trivialSkip({ files: [{ filename: "src/util.ts", additions: 40, deletions: 3, patch: "@@ -1 +1 @@\n-a\n+b" }] }).value === false);
  check("trivialSkip: a lockfile + manifest version bump is dependency-bump-only",
    trivialSkip({ files: [
      { filename: "package.json", additions: 1, deletions: 1, patch: "@@ -3 +3 @@\n-  \"lodash\": \"^4.17.20\",\n+  \"lodash\": \"^4.17.21\"," },
      { filename: "package-lock.json", additions: 30, deletions: 30, patch: "@@ -1 +1 @@\n-a\n+b" },
    ] }).reason === "dependency-bump-only");

  const root = mkdtempSync(join(tmpdir(), "standards-"));
  mkdirSync(join(root, "pkg/sub"), { recursive: true });
  mkdirSync(join(root, ".claude/rules"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), `# Root\n${"filler\n".repeat(2000)}Never block the main thread.\n`);
  writeFileSync(join(root, "pkg/CLAUDE.md"), "# Pkg\nAlways use the query builder.\n");
  writeFileSync(join(root, ".claude/rules/api.md"), "---\nglobs: pkg/**\n---\nDo not return raw errors.\n");
  writeFileSync(join(root, ".claude/rules/web.md"), "---\nglobs: web/**\n---\nMust use tokens.\n");
  const r = discoverStandards({ root, changed: ["pkg/sub/a.ts"] });
  check("nearest non-root CLAUDE.md, matching rule, and root CLAUDE.md are loaded; a non-matching rule is not",
    JSON.stringify(r.byFile["pkg/sub/a.ts"]) === JSON.stringify(["pkg/CLAUDE.md", ".claude/rules/api.md", "CLAUDE.md"]), JSON.stringify(r.byFile));
  const rootDoc = r.docs.find((d) => d.path === "CLAUDE.md");
  check("a normative line past character 8,000 of the root CLAUDE.md is found, with its line number",
    !!rootDoc && rootDoc.bullets.some((b) => b.text === "Never block the main thread." && b.line === 2002));
  check("docs are ordered nearest-first", r.docs.map((d) => d.path).join(",") === "pkg/CLAUDE.md,.claude/rules/api.md,CLAUDE.md");
  const capped = discoverStandards({ root, changed: ["pkg/sub/a.ts"], capChars: 40 });
  check("the cap keeps nearest documents first and logs what it dropped",
    capped.docs[0]?.path === "pkg/CLAUDE.md" && capped.dropped.length >= 1 && /cap exceeded/.test(capped.dropped[0].reason));
  writeFileSync(join(root, ".github-review-probe"), "");
  mkdirSync(join(root, ".github"), { recursive: true });
  writeFileSync(join(root, ".github/review.yaml"), "profile: balanced\nstandards:\n  - path: \"pkg/**\"\n");
  check("a review-config standards: block is detected for the caller to merge",
    discoverStandards({ root, changed: ["pkg/sub/a.ts"] }).reviewConfigStandards === true);
  rmSync(root, { recursive: true, force: true });

  if (failed) { console.error(`\ndiscover-standards self-test: ${failed} check(s) failed`); process.exit(1); }
  console.log("\n✓ discover-standards self-test: all checks passed");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main(process.argv.slice(2));
