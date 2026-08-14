// Shared, dependency-free helpers for the eval harness.
// Node ESM, no npm deps — runs anywhere `node` is available.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";

export const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

/** Recursively list files under `dir` matching `ext` (e.g. ".md"). */
export function walk(dir, ext = ".md", out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}

/** GitHub heading-slug algorithm: lowercase, drop punctuation (keep space/hyphen),
 *  strip a trailing `{#explicit-id}` attribute, spaces → hyphens. */
export function slug(heading) {
  return heading
    .replace(/\s*\{#[^}]+\}\s*$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 \-]/g, "")
    .replace(/ /g, "-");
}

/** All ATX heading slugs in a markdown file. */
export function headingSlugs(file) {
  const set = new Set();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^#{1,6}\s+(.*)/.exec(line);
    if (m) set.add(slug(m[1]));
  }
  return set;
}

/** Markdown inline links: returns [{ line, target }]. */
export function links(file) {
  const out = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    let m;
    while ((m = re.exec(line))) out.push({ line: i + 1, target: m[1].trim() });
  });
  return out;
}

/** Minimal frontmatter reader — only what the checks need (name, version). */
export function frontmatter(file) {
  const txt = readFileSync(file, "utf8");
  const m = /^---\n([\s\S]*?)\n---/.exec(txt);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return fm;
}

export const rel = (p) => relative(REPO_ROOT, p);

/**
 * Slice `text` between two string anchors, guarding against a missing anchor.
 * Returns the substring from the start of `startAnchor` up to (but not including)
 * `endAnchor`. Throws a clear error if either anchor is absent — a raw
 * `text.slice(indexOf(a), indexOf(b))` silently misbehaves when `indexOf` returns
 * -1 (the slice starts from the end / widens unexpectedly), which would let a
 * moved-or-deleted anchor pass a contract check by accident.
 * @param {string} text
 * @param {string} startAnchor  first anchor; the slice begins at its first occurrence
 * @param {string} endAnchor    second anchor; the slice ends just before its first occurrence
 * @returns {string}
 */
export function sliceBetween(text, startAnchor, endAnchor) {
  const start = text.indexOf(startAnchor);
  if (start < 0) throw new Error(`sliceBetween: start anchor not found: ${JSON.stringify(startAnchor)}`);
  const end = text.indexOf(endAnchor, start);
  if (end < 0) throw new Error(`sliceBetween: end anchor not found after start: ${JSON.stringify(endAnchor)}`);
  return text.slice(start, end);
}

/**
 * Extract a markdown section's full body from a repo file, HEADING-LEVEL-AWARE.
 * A section headed by N `#`s owns everything up to the next heading of level <= N
 * (same-or-higher level), so a `## ` section captures its `### ` subsections rather
 * than stopping at the first one (which would drop the rest of the body — feeding an
 * empty or truncated rubric to the L2 evals). `section == null` returns the whole file.
 * Shared by l2.mjs (feeds the live rubric to the model) and l1.mjs's G21g guard (asserts
 * every suite extracts a non-empty body) so the guard exercises the exact extraction l2 runs.
 * @param {string} file      repo-relative path
 * @param {string|null} section  the section heading literal (incl. leading `#`s), or null for whole file
 * @returns {string}
 */
export function extractSection(file, section) {
  const txt = readFileSync(join(REPO_ROOT, file), "utf8");
  if (!section) return txt.trim();
  const i = txt.indexOf(section);
  if (i < 0) throw new Error(`section "${section}" not found in ${file}`);
  const level = (/^#+/.exec(section.trim()) || [""])[0].length;
  // Scan line-by-line from the section start, skipping ``` fenced code blocks, and
  // cut at the first REAL heading of level <= this section's level. Fence-skipping
  // matters because a `# ...` comment inside a ```text block (e.g. Step 1.0's
  // "# Issue each as a real mcp__lorekit__memory_list tool call") is not a heading —
  // a raw regex would stop there and truncate the body mid-section.
  const bodyStart = i + section.length;
  const lines = txt.slice(bodyStart).split("\n");
  let fence = false;
  let cut = -1; // char offset within the sliced body where the next heading begins
  let offset = 0; // running char offset (accounts for the "\n" removed by split)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/^\s*```/.test(line)) fence = !fence;
    else if (!fence && n > 0) {
      const m = /^(#{1,6})\s/.exec(line);
      if (m && m[1].length <= level) { cut = offset; break; }
    }
    offset += line.length + 1; // +1 for the "\n" that split() consumed
  }
  const body = cut >= 0 ? lines.join("\n").slice(0, cut) : lines.join("\n");
  return (section + body).trimEnd().trim();
}

// --- tiny test-runner so checks read like assertions and roll up to one exit code ---
export class Suite {
  constructor(name) { this.name = name; this.pass = 0; this.fail = 0; this.failures = []; }
  check(label, ok, detail = "") {
    if (ok) { this.pass++; }
    else { this.fail++; this.failures.push(`${label}${detail ? " — " + detail : ""}`); }
  }
  report() {
    const total = this.pass + this.fail;
    console.log(`\n${this.fail === 0 ? "✓" : "✗"} ${this.name}: ${this.pass}/${total} checks passed`);
    for (const f of this.failures) console.log(`    ✗ ${f}`);
    return this.fail === 0;
  }
}
