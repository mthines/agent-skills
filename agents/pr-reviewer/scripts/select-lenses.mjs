#!/usr/bin/env node
// @ts-check
/**
 * select-lenses.mjs — which review lenses apply to this diff, and why.
 *
 * A lens is a short checklist (`lens.md`, skills/authoring/create-skill/rules/review-lens-contract.md)
 * the reviewer walks against the diff. This module decides which ones load, from three sources:
 *
 *   1. Repo lenses — `.agents/review/lenses/<name>.md` in the reviewed repo. Auto-loaded when their
 *      trigger matches; no registration. A team owns its lens by owning the file.
 *   2. Named lenses — `--with a,b` and the per-file `lenses:` list of the hierarchical `.review.yaml`.
 *      Resolved first match wins: repo lens → repo `.agents/skills/<name>/lens.md` → a lens bundled
 *      with this agent or installed under `~/.claude/skills/<name>/lens.md`.
 *   3. Built-in auto lenses — a bundled or installed lens that declares `auto: true`.
 *
 * The trigger is the lens's frontmatter: `applies-to` (globs or `always`), `diff-matches` (regexes
 * over added lines), and `min-tier` (quick < standard < deep). A named lens keeps only its
 * `applies-to` filter: the caller asked for it.
 *
 * Every repo-side file is read at the BASE commit, so a PR cannot add or weaken the lens that
 * reviews it; a lens the PR adds or edits is reported, and the base version (if any) is used.
 * There is no count cap: the caller grows the tool-call budget per lens (route-depth.mjs LENS_CALLS).
 *
 * Usage
 *   node select-lenses.mjs --base <ref> --files-json <local-files.json> [--root <dir>]
 *     [--tier quick|standard|deep] [--with a,b] [--skills-dir <dir>]...   # prints JSON, announces on stderr
 *   node select-lenses.mjs --self-test
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp } from "./discover-standards.mjs";
import { readAtRefLocal } from "./review-context.mjs";

export const LENS_DIR = ".agents/review/lenses";
export const LENS_VERSION = 1;
const TIER_RANK = { quick: 0, standard: 1, deep: 2 };
/** The lens names a finding can carry (judgments.schema.json `lens`). */
const LENS_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_LENS_LINES = 1000; // review-lens-contract.md: a defensive guard against pointing at the wrong file

/* ------------------------------- parsing ------------------------------- */

/** A YAML scalar without its quotes; inside single quotes YAML writes a quote as `''`. @param {string} v */
const unquote = (v) => {
  const t = v.trim();
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  return t;
};

/**
 * A YAML value that is a list: `[a, b]`, `"a, b"`, or block `- a` lines (passed as `block`).
 * @param {string} raw @param {string[]} [block]
 * @returns {string[]}
 */
function listValue(raw, block = []) {
  const v = raw.trim();
  if (!v && block.length) return block.map(unquote).filter(Boolean);
  const inner = v.startsWith("[") && v.endsWith("]") ? v.slice(1, -1) : unquote(v);
  return inner.split(",").map(unquote).filter(Boolean);
}

/**
 * Drop a trailing ` # comment`, but never a `#` inside quotes (`'color: #fff'`).
 * @param {string} s @returns {string}
 */
function stripComment(s) {
  let quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) { if (ch === quote) quote = ""; }
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "#" && i > 0 && /\s/.test(s[i - 1])) return s.slice(0, i).trimEnd();
  }
  return s;
}

/**
 * The top-level `key: value` pairs of a frontmatter or a small YAML file, with block lists
 * collected under their key. Not a YAML parser: it reads exactly the flat shape the lens contract
 * and `.review.yaml`'s `lenses:` key use.
 * @param {string} text
 * @returns {Record<string, { raw: string, block: string[] }>}
 */
function flatYaml(text) {
  /** @type {Record<string, { raw: string, block: string[] }>} */
  const out = {};
  let key = null;
  for (const line of text.split("\n")) {
    const kv = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (kv) { key = kv[1]; out[key] = { raw: stripComment(kv[2]), block: [] }; continue; }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && key) out[key].block.push(stripComment(item[1]));
    else if (line.trim() && !/^\s/.test(line)) key = null;
  }
  return out;
}

/**
 * Parse a lens file. Never throws: a malformed lens comes back with `error` set.
 * @param {string} text
 */
export function parseLens(text) {
  text = text.replace(/\r\n?/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  const fm = m ? flatYaml(m[1]) : {};
  const get = (/** @type {string} */ k) => (fm[k] ? unquote(fm[k].raw) : undefined);
  const appliesRaw = fm["applies-to"] ? listValue(fm["applies-to"].raw, fm["applies-to"].block) : ["always"];
  const version = get("lens-version");
  const minTier = get("min-tier");
  /** @type {string|undefined} */
  let error;
  if (text.split("\n").length > MAX_LENS_LINES) error = `over ${MAX_LENS_LINES} lines`;
  else if (version !== undefined && Number(version) !== LENS_VERSION) error = `unknown lens-version ${version}`;
  else if (minTier !== undefined && !(minTier in TIER_RANK)) error = `unknown min-tier ${minTier}`;
  else if (get("auto") !== undefined && get("auto") !== "true" && get("auto") !== "false") error = `auto must be true or false, got ${get("auto")}`;
  /** @type {RegExp[]} */
  const diffMatches = [];
  if (!error && fm["diff-matches"]) {
    for (const src of listValue(fm["diff-matches"].raw, fm["diff-matches"].block)) {
      try { diffMatches.push(new RegExp(src)); } catch { error = `invalid diff-matches regex ${src}`; }
    }
  }
  const auto = get("auto");
  return {
    appliesTo: /** @type {"always" | string[]} */ (appliesRaw.length === 1 && appliesRaw[0] === "always" ? "always" : appliesRaw),
    diffMatches,
    minTier: /** @type {keyof typeof TIER_RANK | undefined} */ (minTier),
    // Only a literal true/false sets it; anything else is `error`, so a repo lens still reaches `skipped`.
    auto: auto === "true" ? true : auto === "false" ? false : undefined,
    body: m ? text.slice(m[0].length) : text,
    error,
  };
}

/**
 * The `lenses:` entries of every `.review.yaml` that governs each changed file, unioned.
 * `.github/review.yaml` and a root `.review.yaml` govern every file.
 * @param {{ changed: string[], configs: Record<string, string> }} a
 * @returns {Record<string, string[]>} lens name → the changed files it is enabled for
 */
export function subtreeLenses({ changed, configs }) {
  /** @type {Record<string, Set<string>>} */
  const byName = {};
  for (const [path, text] of Object.entries(configs)) {
    const entry = flatYaml(text).lenses;
    if (!entry) continue;
    const dir = path === ".github/review.yaml" ? "." : posix.dirname(path);
    const files = changed.filter((f) => dir === "." || f.startsWith(`${dir}/`));
    for (const name of listValue(entry.raw, entry.block)) {
      byName[name] ??= new Set();
      for (const f of files) byName[name].add(f);
    }
  }
  return Object.fromEntries(Object.entries(byName).map(([n, s]) => [n, [...s]]));
}

/**
 * Every config path that could govern the changed files: the repo-level two plus one
 * `<dir>/.review.yaml` per ancestor directory. Pure.
 * @param {string[]} changed
 */
export function configCandidatePaths(changed) {
  const set = new Set([".github/review.yaml", ".review.yaml"]);
  for (const file of changed) {
    for (let d = posix.dirname(file); d !== "." && d !== "/" && d !== ""; d = posix.dirname(d)) set.add(posix.join(d, ".review.yaml"));
  }
  return [...set];
}

/**
 * The lines a diff adds, per file, from the API's / local-diff-files' `patch`.
 * @param {Array<{ filename: string, patch?: string }>} files
 * @returns {Array<{ path: string, added: string[] }>}
 */
export function changedWithAdded(files) {
  return files.map((f) => ({
    path: f.filename,
    added: String(f.patch || "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)),
  }));
}

/* ------------------------------- selection ------------------------------- */

/**
 * Does a parsed lens's trigger match? A named lens checks only `applies-to`.
 * @param {ReturnType<typeof parseLens>} lens
 * @param {{ changed: Array<{ path: string, added: string[] }>, tier?: string, named?: boolean, scope?: string[] }} a
 * @returns {{ match: boolean, files: string[], reason: string }}
 */
export function triggerMatches(lens, { changed, tier, named = false, scope }) {
  const inScope = scope ? changed.filter((c) => scope.includes(c.path)) : changed;
  const appliesTo = lens.appliesTo === "always" ? null : lens.appliesTo;
  const globs = appliesTo ? appliesTo.map((g) => globToRegExp(g)) : null;
  const byPath = globs ? inScope.filter((c) => globs.some((g) => g.test(c.path))) : inScope;
  if (!byPath.length) return { match: false, files: [], reason: globs ? "no changed file matches applies-to" : "no changed file in scope" };
  if (named) return { match: true, files: byPath.map((c) => c.path), reason: appliesTo ? `applies-to ${appliesTo.join(", ")}` : "applies-to always" };
  if (lens.minTier) {
    // An empty or unknown tier never satisfies min-tier: a deep-only lens must not load on a misspelled tier.
    const rank = TIER_RANK[/** @type {keyof typeof TIER_RANK} */ (String(tier || "").toLowerCase())];
    if (rank === undefined) return { match: false, files: [], reason: `tier ${JSON.stringify(tier ?? "")} is unknown; min-tier ${lens.minTier} needs one` };
    if (rank < TIER_RANK[lens.minTier]) return { match: false, files: [], reason: `tier ${tier} is below min-tier ${lens.minTier}` };
  }
  const hits = lens.diffMatches.length
    ? byPath.filter((c) => c.added.some((l) => lens.diffMatches.some((r) => r.test(l))))
    : byPath;
  if (!hits.length) return { match: false, files: [], reason: "no added line matches diff-matches" };
  const why = [appliesTo ? `applies-to ${appliesTo.join(", ")}` : null, lens.diffMatches.length ? "diff-matches" : null,
    lens.minTier ? `min-tier ${lens.minTier}` : null].filter(Boolean);
  return { match: true, files: hits.map((c) => c.path), reason: why.join(" + ") || "applies-to always" };
}

/**
 * Select the lenses for one review. Pure: every text is supplied by the caller.
 * @param {{
 *   changed: Array<{ path: string, added: string[] }>,
 *   tier?: string,
 *   withNames?: string[],
 *   configs?: Record<string, string>,            // `.review.yaml` path → text, read at the base
 *   repoLenses?: Record<string, string>,         // name → `.agents/review/lenses/<name>.md` text at the base
 *   repoSkillLenses?: Record<string, string>,    // name → `.agents/skills/<name>/lens.md` text at the base
 *   bundledLenses?: Record<string, { text: string, path: string }>,  // name → lens shipped with or installed for the agent
 *   gated?: string[],                            // lenses with their own gate (animations), never auto-loaded here
 * }} a
 */
export function selectLenses({ changed, tier, withNames = [], configs = {}, repoLenses = {}, repoSkillLenses = {}, bundledLenses = {}, gated = ["animations"] }) {
  /** @type {Array<{ name: string, source: string, reason: string, files: string[], text: string }>} */
  const loaded = [];
  /** @type {Array<{ name: string, reason: string }>} */
  const skipped = [];
  const seen = new Set();
  /** @type {Map<string, string>} named lenses whose trigger missed — reported only if nothing else loads them */
  const misses = new Map();
  const paths = changed.map((c) => c.path);

  /** @param {string} name @returns {{ text: string, source: string } | null} */
  const resolve = (name) => {
    if (repoLenses[name] !== undefined) return { text: repoLenses[name], source: `${LENS_DIR}/${name}.md` };
    if (repoSkillLenses[name] !== undefined) return { text: repoSkillLenses[name], source: `.agents/skills/${name}/lens.md` };
    if (bundledLenses[name]) return { text: bundledLenses[name].text, source: bundledLenses[name].path };
    return null;
  };
  /** @param {string} name @param {{ text: string, source: string }} hit @param {{ named: boolean, scope?: string[], why: string }} how */
  // A lens file reached by several sources (a scoped `lenses:` entry, then its own auto trigger)
  // loads once, over the union of the files each source matched. A different file of the same
  // name never merges in: the first source's text keeps its own files.
  const consider = (name, hit, how) => {
    if (seen.has(name)) return;
    // judgments.schema.json's `lens` pattern: a name a finding cannot carry must not load.
    if (!LENS_NAME.test(name)) { seen.add(name); skipped.push({ name, reason: `${hit.source}: lens name must match ${LENS_NAME}` }); return; }
    const prior = loaded.find((l) => l.name === name);
    if (prior && prior.source !== hit.source) return;
    const lens = parseLens(hit.text);
    if (lens.error) { seen.add(name); skipped.push({ name, reason: `${hit.source}: ${lens.error}` }); return; }
    const t = triggerMatches(lens, { changed, tier, named: how.named, scope: how.scope });
    if (!t.match) { if (how.named && !misses.has(name)) misses.set(name, `${how.why}, but ${t.reason}`); return; }
    if (prior) {
      prior.files = [...new Set([...prior.files, ...t.files])].sort();
      prior.reason += `; ${how.why}`;
    } else {
      loaded.push({ name, source: hit.source, reason: `${how.why}; ${t.reason}`, files: t.files, text: lens.body });
    }
    if (!how.scope) seen.add(name);
  };

  // 1. Explicit --with: asked for by name, so only applies-to filters it.
  for (const name of withNames) {
    const hit = resolve(name);
    if (!hit) { if (!seen.has(name)) { seen.add(name); skipped.push({ name, reason: "--with names a lens that was not found" }); } continue; }
    consider(name, hit, { named: true, why: "--with" });
  }
  // 2. The `.review.yaml` `lenses:` lists, each scoped to the files its config governs.
  for (const [name, files] of Object.entries(subtreeLenses({ changed: paths, configs }))) {
    const hit = resolve(name);
    if (!hit) { if (!seen.has(name)) { seen.add(name); skipped.push({ name, reason: ".review.yaml lenses: names a lens that was not found" }); } continue; }
    consider(name, hit, { named: true, scope: files, why: ".review.yaml lenses:" });
  }
  // 3. Repo lenses: auto unless they say `auto: false`.
  for (const name of Object.keys(repoLenses).sort()) {
    if (parseLens(repoLenses[name]).auto === false) continue;
    consider(name, { text: repoLenses[name], source: `${LENS_DIR}/${name}.md` }, { named: false, why: "repo lens" });
  }
  // 4. Built-in lenses that opt into auto-loading. A repo lens of the same name already won in step 3.
  for (const name of Object.keys(bundledLenses).sort()) {
    if (gated.includes(name) || repoLenses[name] !== undefined) continue;
    if (parseLens(bundledLenses[name].text).auto !== true) continue;
    consider(name, { text: bundledLenses[name].text, source: bundledLenses[name].path }, { named: false, why: "auto" });
  }

  for (const [name, reason] of misses) if (!loaded.some((l) => l.name === name)) skipped.push({ name, reason });

  // A lens file the PR itself touches: the base version (if any) is the one in force.
  const lensFile = (/** @type {string} */ p) => p.startsWith(`${LENS_DIR}/`) && p.endsWith(".md");
  const notes = paths.filter(lensFile).map((p) => {
    const name = posix.basename(p, ".md");
    return repoLenses[name] !== undefined
      ? `this PR edits ${p}; the base version is the one in force until it merges`
      : `this PR adds ${p}; it exists only at head and is not loaded until it merges`;
  });

  const announce = [
    ...loaded.map((l) => `lens ${l.name}: ${l.reason} (${l.source})`),
    ...skipped.map((s) => `lens ${s.name}: skipped — ${s.reason}`),
    ...notes.map((n) => `lens note: ${n}`),
  ];
  return { loaded, skipped, notes, announce };
}

/* ------------------------------- reading ------------------------------- */

/**
 * Lenses shipped with this agent (the repo or plugin it lives in) and installed under the given
 * skills directories. The first directory to provide a name wins.
 * @param {string[]} [dirs]
 * @returns {Record<string, { text: string, path: string }>}
 */
export function readBundledLenses(dirs = defaultSkillDirs()) {
  /** @type {Record<string, { text: string, path: string }>} */
  const out = {};
  for (const root of dirs) {
    if (!existsSync(root)) continue;
    /** @type {string[]} */
    const skillDirs = [];
    for (const entry of readdirSync(root)) {
      const p = join(root, entry);
      if (existsSync(join(p, "SKILL.md")) || existsSync(join(p, "lens.md"))) skillDirs.push(p);
      else if (existsSync(p) && safeIsDir(p)) for (const sub of readdirSync(p)) skillDirs.push(join(p, sub)); // skills/<category>/<name>
    }
    for (const d of skillDirs) {
      const name = posix.basename(d.split("\\").join("/"));
      const lens = join(d, "lens.md");
      if (out[name] || !existsSync(lens)) continue;
      out[name] = { text: readFileSync(lens, "utf8"), path: `${name}/lens.md` };
    }
  }
  return out;
}

/** @param {string} p */
function safeIsDir(p) { try { return readdirSync(p) !== null; } catch { return false; } }

/** This agent's own skills tree (checkout or plugin), then the user's installed skills. */
export function defaultSkillDirs() {
  const here = dirname(fileURLToPath(import.meta.url));
  // Checkout or plugin (`agents/pr-reviewer/scripts` → `skills/`), then the Agent0 install
  // (`$AGENT_SUPPORT/skills`, see agent0-setup.sh), then the user's installed skills.
  return [join(here, "..", "..", "..", "skills"), join(here, "..", "..", "skills"), join(homedir(), ".claude", "skills")];
}

/**
 * Every repo-side input, read at `base` with local git (branch-reviewer). The lens directory is
 * listed at the base, so a lens the branch adds is never read.
 * @param {{ root: string, base: string, changed: string[], withNames?: string[] }} a
 */
export function readRepoInputsLocal({ root, base, changed, withNames = [] }) {
  const ls = spawnSync("git", ["-C", root, "ls-tree", "-r", "-z", "--full-tree", "--name-only", base, "--", `${LENS_DIR}/`], { encoding: "utf8" });
  if (ls.status !== 0) throw new Error(`git ls-tree ${base} ${LENS_DIR} failed: ${(ls.stderr || "").trim()}`);
  const lensPaths = ls.stdout.split("\0").filter((p) => p && posix.dirname(p) === LENS_DIR && p.endsWith(".md"));
  const lensTexts = lensPaths.length ? readAtRefLocal({ root, base, paths: lensPaths }) : {};
  const repoLenses = Object.fromEntries(Object.entries(lensTexts).map(([p, t]) => [posix.basename(p, ".md"), t]));
  const configs = readAtRefLocal({ root, base, paths: configCandidatePaths(changed) });
  const named = [...new Set([...withNames, ...Object.keys(subtreeLenses({ changed, configs }))])].filter((n) => repoLenses[n] === undefined);
  const skillPaths = named.map((n) => `.agents/skills/${n}/lens.md`);
  const skillTexts = skillPaths.length ? readAtRefLocal({ root, base, paths: skillPaths }) : {};
  const repoSkillLenses = Object.fromEntries(Object.entries(skillTexts).map(([p, t]) => [posix.basename(posix.dirname(p)), t]));
  return { repoLenses, repoSkillLenses, configs };
}

/* --------------------------------- CLI --------------------------------- */

/** @param {string[]} argv */
function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const opt = (/** @type {string} */ n) => { const i = argv.indexOf(n); return i === -1 ? undefined : argv[i + 1]; };
  const base = opt("--base");
  const filesJson = opt("--files-json");
  if (!base || !filesJson) {
    console.error("usage: select-lenses.mjs --base <ref> --files-json <local-files.json> [--root <dir>] [--tier t] [--with a,b] [--skills-dir d]... | --self-test");
    process.exit(2);
  }
  const files = JSON.parse(readFileSync(filesJson, "utf8")).map((/** @type {any} */ f) => (typeof f === "string" ? { filename: f } : f));
  const withNames = (opt("--with") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const skillDirs = argv.flatMap((a, i) => (a === "--skills-dir" ? [argv[i + 1]] : []));
  const changed = changedWithAdded(files);
  const repo = readRepoInputsLocal({ root: opt("--root") || ".", base, changed: changed.map((c) => c.path), withNames });
  const sel = selectLenses({
    changed, tier: opt("--tier"), withNames, ...repo,
    bundledLenses: readBundledLenses(skillDirs.length ? skillDirs : defaultSkillDirs()),
  });
  for (const line of sel.announce) console.error(line);
  console.log(JSON.stringify(sel, null, 2));
}

/* ------------------------------- self-test ------------------------------- */

function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };
  const lens = (/** @type {string} */ fm, body = "## Checklist\n\n- [ ] item\n") => `---\n${fm}\n---\n\n${body}`;
  const ch = (/** @type {string} */ path, /** @type {string[]} */ added = []) => ({ path, added });
  const names = (/** @type {ReturnType<typeof selectLenses>} */ s) => s.loaded.map((l) => l.name);

  const billing = lens('applies-to: "services/billing/**"');
  const s1 = selectLenses({ changed: [ch("services/billing/charge.ts")], repoLenses: { "billing-audit": billing } });
  check("a repo lens auto-loads when applies-to matches, with no registration",
    JSON.stringify(names(s1)) === '["billing-audit"]' && s1.loaded[0].source === `${LENS_DIR}/billing-audit.md`
      && /repo lens; applies-to services\/billing\/\*\*/.test(s1.loaded[0].reason), JSON.stringify(s1));
  const s2 = selectLenses({ changed: [ch("services/catalog/list.ts")], repoLenses: { "billing-audit": billing } });
  check("a repo lens outside its applies-to does not load", s2.loaded.length === 0 && s2.skipped.length === 0, JSON.stringify(s2));
  check("a repo lens with no applies-to applies to the whole repo",
    names(selectLenses({ changed: [ch("a.ts")], repoLenses: { house: lens("auto: true") } }))[0] === "house");
  check("a repo lens with auto: false loads only when named",
    selectLenses({ changed: [ch("a.ts")], repoLenses: { opt: lens("auto: false") } }).loaded.length === 0
      && names(selectLenses({ changed: [ch("a.ts")], withNames: ["opt"], repoLenses: { opt: lens("auto: false") } }))[0] === "opt");

  const ai = { text: lens('applies-to: always\nauto: true\ndiff-matches: "@anthropic-ai/sdk, from \\"openai\\""'), path: "ai-engineering/lens.md" };
  const s3 = selectLenses({ changed: [ch("src/a.ts", ['import Anthropic from "@anthropic-ai/sdk";'])], bundledLenses: { "ai-engineering": ai } });
  const s4 = selectLenses({ changed: [ch("src/a.ts", ["const x = 1;"])], bundledLenses: { "ai-engineering": ai } });
  check("diff-matches: loads on a matching added line, not otherwise", names(s3)[0] === "ai-engineering" && s4.loaded.length === 0,
    JSON.stringify([s3.loaded, s4.loaded]));

  const deep = { "approach": lens("min-tier: deep") };
  check("min-tier: below the tier it does not load, at the tier it does",
    selectLenses({ changed: [ch("a.ts")], tier: "standard", repoLenses: deep }).loaded.length === 0
      && names(selectLenses({ changed: [ch("a.ts")], tier: "deep", repoLenses: deep }))[0] === "approach");
  const autoBad = selectLenses({ changed: [ch("a.ts")], repoLenses: { y: lens("auto: yes") } });
  check("auto other than true/false is skipped with a reason, never silently off",
    autoBad.loaded.length === 0 && /auto must be true or false/.test(autoBad.skipped[0]?.reason || ""), JSON.stringify(autoBad.skipped));
  const spaced = selectLenses({ changed: [ch("a.ts")], repoLenses: { "billing audit": lens(""), SOC2: lens("") } });
  check("a lens name a finding cannot carry is skipped; capitals load",
    names(spaced).join() === "SOC2" && /lens name must match/.test(spaced.skipped.find((s) => s.name === "billing audit")?.reason || ""), JSON.stringify(spaced));
  check("min-tier: an empty, missing, or unknown tier never loads a min-tier lens; case is ignored",
    [undefined, "", "Standard", "deeep"].every((t) => selectLenses({ changed: [ch("a.ts")], tier: t, repoLenses: deep }).loaded.length === 0)
      && names(selectLenses({ changed: [ch("a.ts")], tier: "DEEP", repoLenses: deep }))[0] === "approach");

  const ux = { text: lens('applies-to: "**/*.tsx"\nauto: true'), path: "ux/lens.md" };
  const charting = { text: lens('applies-to: "**/*chart*.tsx"'), path: "charting/lens.md" };
  const anim = { text: lens('applies-to: "**/*.css"\nauto: true'), path: "animations/lens.md" };
  const s5 = selectLenses({ changed: [ch("app/Chart.tsx"), ch("a.css")], bundledLenses: { ux, charting, animations: anim } });
  check("a bundled lens auto-loads only with auto: true, and a gated lens (animations) never auto-loads here",
    JSON.stringify(names(s5)) === '["ux"]', JSON.stringify(names(s5)));

  const repoUx = lens('applies-to: "**/*.tsx"', "## Checklist\n\n- [ ] the house rule\n");
  const s6 = selectLenses({ changed: [ch("a.tsx")], repoLenses: { ux: repoUx }, bundledLenses: { ux } });
  check("a repo lens overrides a built-in of the same name",
    s6.loaded.length === 1 && s6.loaded[0].source === `${LENS_DIR}/ux.md` && /house rule/.test(s6.loaded[0].text), JSON.stringify(s6.loaded));
  const s7 = selectLenses({ changed: [ch("a.ts")], withNames: ["tdd"], repoSkillLenses: { tdd: lens("for: pr-reviewer") }, bundledLenses: { tdd: { text: lens("x: 1"), path: "tdd/lens.md" } } });
  check("resolution order: repo .agents/skills lens before a bundled one", s7.loaded[0]?.source === ".agents/skills/tdd/lens.md", JSON.stringify(s7));

  const many = Object.fromEntries(["a", "b", "c", "d", "e"].map((n) => [n, { text: lens("x: 1"), path: `${n}/lens.md` }]));
  const s8 = selectLenses({ changed: [ch("f.ts")], withNames: ["a", "b", "c", "d", "e", "missing"], bundledLenses: many });
  check("--with has no cap: five named lenses load; an unknown name is skipped with a reason",
    names(s8).length === 5 && s8.skipped.length === 1 && /not found/.test(s8.skipped[0].reason), JSON.stringify(s8.skipped));
  const s9 = selectLenses({ changed: [ch("a.tsx")], withNames: ["ux"], bundledLenses: { ux } });
  check("--with adds to the auto set and dedupes by name", s9.loaded.length === 1 && /^--with/.test(s9.loaded[0].reason));
  check("a named lens still honours applies-to",
    selectLenses({ changed: [ch("a.ts")], withNames: ["ux"], bundledLenses: { ux } }).skipped[0]?.reason.includes("applies-to"));

  const configs = { ".github/review.yaml": "profile: balanced\n", "services/billing/.review.yaml": "lenses:\n  - ledger # the money rules\nfilters: []\n" };
  const ledger = { ledger: { text: lens("auto: false"), path: "ledger/lens.md" } };
  const s10 = selectLenses({ changed: [ch("services/billing/a.ts"), ch("web/b.ts")], configs, bundledLenses: ledger });
  check(".review.yaml lenses: enables a lens for its subtree's files only",
    names(s10)[0] === "ledger" && JSON.stringify(s10.loaded[0].files) === '["services/billing/a.ts"]', JSON.stringify(s10.loaded));
  check("subtreeLenses: inline lists and the repo-level config govern every file",
    JSON.stringify(subtreeLenses({ changed: ["x/a.ts", "y/b.ts"], configs: { ".github/review.yaml": "lenses: [ux, tdd]\n" } }))
      === '{"ux":["x/a.ts","y/b.ts"],"tdd":["x/a.ts","y/b.ts"]}');

  const svcUx = { "svc/.review.yaml": "lenses: [ux]\n" };
  const s11 = selectLenses({ changed: [ch("svc/a.ts"), ch("web/B.tsx")], configs: svcUx, bundledLenses: { ux } });
  check("a scoped lenses: entry that misses its subtree still lets the lens auto-load elsewhere",
    names(s11)[0] === "ux" && JSON.stringify(s11.loaded[0].files) === '["web/B.tsx"]' && s11.skipped.length === 0, JSON.stringify(s11));
  const s12 = selectLenses({ changed: [ch("svc/C.tsx"), ch("web/B.tsx")], configs: svcUx, bundledLenses: { ux } });
  check("a lens reached by a scoped entry and its own trigger loads once over the union of files",
    s12.loaded.length === 1 && JSON.stringify(s12.loaded[0].files) === '["svc/C.tsx","web/B.tsx"]', JSON.stringify(s12.loaded));
  const teamUx = lens('applies-to: "svc/**"', "## Checklist\n\n- [ ] the svc rule\n");
  const s13 = selectLenses({ changed: [ch("svc/C.tsx"), ch("web/B.tsx")], configs: svcUx, repoSkillLenses: { ux: teamUx }, bundledLenses: { ux } });
  check("a different file of the same name never merges its trigger files into the first source's text",
    s13.loaded.length === 1 && s13.loaded[0].source === ".agents/skills/ux/lens.md" && JSON.stringify(s13.loaded[0].files) === '["svc/C.tsx"]', JSON.stringify(s13.loaded));
  const crlf = parseLens('---\r\napplies-to: "services/billing/**"\r\nauto: false\r\n---\r\n\r\n## Checklist\r\n');
  check("a lens with CRLF line endings keeps its frontmatter",
    JSON.stringify(crlf.appliesTo) === '["services/billing/**"]' && crlf.auto === false, JSON.stringify(crlf));

  const bad = selectLenses({ changed: [ch("a.ts")], repoLenses: { v2: lens("lens-version: 2"), re: lens('diff-matches: "("') } });
  check("an unknown lens-version or a broken regex is skipped with a reason, never loaded",
    bad.loaded.length === 0 && bad.skipped.length === 2 && bad.skipped.every((s) => /lens-version|regex/.test(s.reason)), JSON.stringify(bad.skipped));

  const quoted = parseLens(lens("diff-matches:\n  - 'from [\"'']openai'"));
  check("a single-quoted YAML regex unescapes '' to one quote", quoted.diffMatches[0]?.source === `from ["']openai`, String(quoted.diffMatches[0]));
  const hash = parseLens(lens("diff-matches:\n  - 'color: #fff'  # a trailing comment"));
  check("a # inside quotes is part of the value; a trailing # comment is not", hash.diffMatches[0]?.source === "color: #fff", String(hash.diffMatches[0]));
  const dq = parseLens(lens('diff-matches: "a\\\\(b"'));
  check("a double-quoted YAML regex unescapes a doubled backslash", dq.diffMatches[0]?.source === "a\\(b", String(dq.diffMatches[0]));
  check("changedWithAdded keeps only added lines from a patch",
    JSON.stringify(changedWithAdded([{ filename: "a.ts", patch: "@@ -1 +1 @@\n-old\n+new\n context" }])) === '[{"path":"a.ts","added":["new"]}]');

  // The base-commit read: a lens the branch adds exists only at head and is never loaded.
  const repo = mkdtempSync(join(tmpdir(), "select-lenses-"));
  try {
    const g = (/** @type {string[]} */ a) => spawnSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    g(["init", "-q"]);
    mkdirSync(join(repo, LENS_DIR), { recursive: true });
    mkdirSync(join(repo, "svc"), { recursive: true });
    writeFileSync(join(repo, LENS_DIR, "base-lens.md"), lens('applies-to: "svc/**"', "## Checklist\n\n- [ ] base text\n"));
    writeFileSync(join(repo, "svc", ".review.yaml"), "lenses: [named]\n");
    writeFileSync(join(repo, "svc", "a.ts"), "1\n");
    g(["add", "-A"]); g(["commit", "-qm", "base"]);
    const base = g(["rev-parse", "HEAD"]).stdout.trim();
    writeFileSync(join(repo, LENS_DIR, "base-lens.md"), lens('applies-to: "nowhere/**"'));
    writeFileSync(join(repo, LENS_DIR, "head-lens.md"), lens('applies-to: "svc/**"'));
    writeFileSync(join(repo, "svc", "a.ts"), "2\n");
    g(["add", "-A"]); g(["commit", "-qm", "head"]);
    const changedPaths = [`${LENS_DIR}/base-lens.md`, `${LENS_DIR}/head-lens.md`, "svc/a.ts"];
    const inputs = readRepoInputsLocal({ root: repo, base, changed: changedPaths });
    const sel = selectLenses({ changed: changedPaths.map((p) => ch(p)), ...inputs });
    check("a lens added only at head is not loaded; an edited lens loads its base version (only at head)",
      JSON.stringify(names(sel)) === '["base-lens"]' && /base text/.test(sel.loaded[0].text)
        && sel.notes.some((n) => /adds .*head-lens\.md; it exists only at head/.test(n))
        && sel.notes.some((n) => /edits .*base-lens\.md; the base version/.test(n)), JSON.stringify(sel));
    check("readRepoInputsLocal reads subtree .review.yaml at the base", /lenses: \[named\]/.test(inputs.configs["svc/.review.yaml"] || ""));
  } finally { rmSync(repo, { recursive: true, force: true }); }

  const bundled = readBundledLenses([join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills")]);
  check("readBundledLenses finds this repo's lenses under skills/<category>/<name>/lens.md",
    ["ux", "ai-engineering", "charting", "animations"].every((n) => bundled[n]?.text.includes("lens-version")), Object.keys(bundled).join(","));

  if (failed) { console.error(`select-lenses self-test: ${failed} failed`); process.exit(1); }
  console.log("select-lenses self-test: all passed");
}

const isMain = (() => {
  try { return realpathSync(process.argv[1] || "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) main(process.argv.slice(2));
