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
  const level = (/^#+/.exec(section.trim()) || [""])[0].length;
  // The START bound is anchored to LINE START when `section` is a heading, because a bare
  // substring search also matches inside a DEEPER heading — `### Step 2: …` contains
  // `## Step 2: …` — and silently re-bases the section on a heading the caller did not
  // name. The end scan below is already level-aware, so the start was the last place a
  // level confusion could get in. Trailing spaces on the heading line are tolerated: they
  // are invisible and meaning-preserving, so they must not move the bound (an exact `$`
  // turned a trailing space into a hard failure). A non-heading `section` keeps the plain
  // substring search — it has no level to anchor to.
  const i = level === 0
    ? txt.indexOf(section)
    : (() => {
      const m = new RegExp(
        `^${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`, "m").exec(txt);
      return m === null ? -1 : m.index;
    })();
  if (i < 0) throw new Error(`section "${section}" not found in ${file}`);
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

// --- the shared single-choice scorer ---------------------------------------------------------
//
// Lives here, not in a runner, because TWO runners score single-choice replies now: l2.mjs
// (nine suites) and l3-memory.mjs (both arms of every paired record). A second copy of a
// function that has already been corrected twice — earliest-substring, then nested choices —
// is the drift surface this repo removes everywhere else, so it is one home held by one guard
// (L1 G21l, which extracts and EXECUTES it from this file).

/**
 * Read the model's choice, and refuse to guess when the reply names more than one.
 *
 * The prior rule was "whichever choice appears earliest wins", which silently
 * converted an ENUMERATION into a confident answer: a rubric that asks the agent to
 * emit a structured block (autonomous-workflow's `MODE SELECTION:` is the live case)
 * outranks the harness's "reply with exactly one of", and its template line lists
 * every choice — `- Tier: [Micro | Lite | Full]`. Earliest-substring scored that as
 * `Micro`, the first element, which is how all five tier-routing misses landed on one
 * label and read as a model that thinks a cross-cutting refactor is a one-file typo.
 *
 * An ambiguous reply is still a miss — it is just an HONEST one, printed with the raw
 * text so the next reader can tell a wrong answer from a wrong parse.
 */
export function parseChoice(text, choices) {
  const t = text.trim();
  const eq = choices.find((c) => c.toLowerCase() === t.toLowerCase());
  if (eq) return eq;
  // A bracketed placeholder is scaffolding, not a claim: `Tier: Full [not Micro]`
  // names one choice, and `[Micro | Lite | Full]` names none.
  const low = t.replace(/\[[^\]]*\]/g, " ").toLowerCase();
  const named = choices.filter((c) => low.includes(c.toLowerCase()));
  // Prefer the LONGEST match. Two suites have nested choices — `optimal` is a
  // substring of `suboptimal`, `promoted` of `not-promoted` — so saying the longer
  // one necessarily "names" the shorter one too, and a bare `named.length === 1`
  // test made every reply but the byte-exact one ambiguous: `suboptimal.` scored
  // `?(…)`, a miss indistinguishable from a wrong answer. Dropping a choice that
  // another matched choice contains leaves exactly the one that was said.
  //
  // Known and accepted residue: for a nested pair this weakens the enumeration
  // guard, because containment is the ONLY evidence available. `optimal |
  // suboptimal` now reads as `suboptimal` rather than ambiguous. That is the right
  // trade — the guard's live case is a rubric's own bracketed template line, which
  // the bracket strip above already removes, so the loss is hypothetical while the
  // defect it fixes was systematic. Do NOT "restore" ambiguity here without
  // re-reading G21l's nested-choice checks, which pin both halves.
  const top = named.filter((c) =>
    !named.some((o) => o !== c && o.toLowerCase().includes(c.toLowerCase())));
  if (top.length === 1) return top[0];
  return `?(${t.slice(0, 40).replace(/\s+/g, " ")})`;
}
