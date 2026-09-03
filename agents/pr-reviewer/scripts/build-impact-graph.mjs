#!/usr/bin/env node
/**
 * build-impact-graph.mjs — Phase B of the reviewer pipeline.
 *
 * Answers, deterministically and before any finder runs: what did this PR change,
 * who uses it, what tests cover it, which dependency versions moved, and how wide
 * the blast radius is.
 *
 * Why it exists. The review used to be diff-scoped even in `full` mode: the only
 * context read beyond a hunk was, for `issue`-typed findings, the enclosing function
 * plus ONE representative caller — and only AFTER a line-level rubric had already
 * flagged the line. So the defect class that matters most (a change that is correct in
 * isolation and wrong for how the code is used) was reachable only by luck, and depth
 * routing priced a 6-line edit to a function with forty call sites as "quick".
 * This script produces that missing map so the finders read code the graph points at,
 * and so routing can key on fan-out instead of line count.
 *
 * The graph is a LEAD, NEVER A VERDICT. Dynamic dispatch, reflection, string-built
 * imports, and re-exports are all under-counted by a textual search. A finder must read
 * the code a consumer entry points at; it may never assert a break from the count alone.
 *
 * Usage:
 *   node build-impact-graph.mjs <pr-files.json> --workdir <dir> [options] > impact.json
 *
 *     --workdir <dir>        the HEAD checkout (Phase A). Required.
 *     --base-ref <sha>       resolve base-side files with `git -C <workdir> show <sha>:<path>`
 *     --base-dir <dir>       ...or from a second tree (used by the self-test; wins over --base-ref)
 *     --repo <owner/repo>    enables the cross-branch overlap query via `gh pr list`
 *     --pr <number>          this PR, excluded from the overlap query
 *     --overlaps <file>      pre-fetched overlap input (skips `gh`); see § Overlaps
 *     --production <file>    Dash0 exposure block (see § Telemetry); absent ⇒ no telemetry
 *     --no-vcs               never shell out to git or gh
 *     --no-rg                force the JS search fallback (exercised by the self-test)
 *     --max-consumers <n>    per-symbol consumer scan cap (default 200)
 *
 *   node build-impact-graph.mjs --self-test
 *
 * Fail-closed: bad input, a missing workdir, or an unknown flag exits non-zero with
 * EMPTY stdout, so a caller that forgets to check the status cannot route on `{}`.
 */

import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve, relative, basename, extname, posix } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { TEST_RE, parseFilesInput } from "./classify-shape.mjs";
import { buildFingerprint } from "./fingerprint.mjs";

// ── Constants ────────────────────────────────────────────────────────────────────

const IGNORE_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor", "coverage",
  ".next", ".nuxt", ".turbo", ".venv", "venv", "__pycache__", ".mypy_cache",
  ".pytest_cache", ".gradle", "Pods", ".terraform", ".svelte-kit",
]);

const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts",
  ".go", ".py", ".rs", ".java", ".kt", ".kts", ".swift", ".rb", ".php", ".cs",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".m", ".scala", ".ex", ".exs", ".dart", ".vue", ".svelte",
]);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_FILES = 20000;
const CONSUMER_LIST_CAP = 25;

/** Package-root markers, in the order they are checked walking up from a file. */
const PACKAGE_MARKERS = ["package.json", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json", "build.gradle", "build.gradle.kts"];

/** Lockfiles we can diff, mapped to their parser. Manifests are deliberately NOT used
 *  as the version source: a range that re-resolved, or a transitive bump, moves only
 *  the lockfile, and those are exactly the bumps nobody notices. */
const LOCKFILES = {
  "package-lock.json": parseNpmLock,
  "npm-shrinkwrap.json": parseNpmLock,
  "pnpm-lock.yaml": parsePnpmLock,
  "yarn.lock": parseYarnLock,
  "Cargo.lock": parseCargoLock,
  "poetry.lock": parsePoetryLock,
  "go.sum": parseGoSum,
  "go.mod": parseGoMod,
  "Gemfile.lock": parseGemfileLock,
  "composer.lock": parseComposerLock,
};

const CONFIG_EXT = new Set([".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".properties", ".conf"]);

// ── Small helpers ────────────────────────────────────────────────────────────────

class InputError extends Error {}

function readIfExists(path) {
  try {
    if (!existsSync(path)) return null;
    const st = statSync(path);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch { return null; }
}

function toPosix(p) { return p.split("\\").join("/"); }

function extOf(p) { return extname(p).toLowerCase(); }

function isSourcePath(p) { return SOURCE_EXT.has(extOf(p)); }

/** `src/api/client.ts` → `src/api/client`; leaves an extension-less path alone. */
function stripExt(p) {
  const e = extOf(p);
  return e && (SOURCE_EXT.has(e) || e === ".json") ? p.slice(0, -e.length) : p;
}

// ── Workspace walk + search ──────────────────────────────────────────────────────

function walkFiles(root, { onlySource = true } = {}) {
  const out = [];
  const stack = ["."];
  while (stack.length && out.length < MAX_SCAN_FILES) {
    const rel = stack.pop();
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const childRel = rel === "." ? e.name : posix.join(rel, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        stack.push(childRel);
      } else if (e.isFile()) {
        if (e.name.endsWith(".min.js") || e.name.endsWith(".map")) continue;
        if (onlySource && !isSourcePath(childRel)) continue;
        out.push(childRel);
      }
    }
  }
  return out;
}

/**
 * Search the workdir for a regex, returning `{path, line, text}` hits.
 * Prefers ripgrep; falls back to a bounded JS walk. Both paths are covered by the
 * self-test (`--no-rg`) so the fallback cannot rot — the failure mode of an
 * "optimistic tool + untested fallback" is that the fallback is wrong the one time
 * it runs.
 */
function search(root, pattern, { useRg = true, cap = 5000, onlySource = true } = {}) {
  if (useRg && hasBinary("rg")) {
    const args = ["--no-heading", "--line-number", "--no-messages", "--regexp", pattern, "."];
    for (const d of IGNORE_DIRS) args.push("--glob", `!${d}/**`);
    if (onlySource) args.push("--glob", `!*.min.js`, "--glob", "!*.map");
    const r = spawnSync("rg", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    // rg exits 1 for "no matches", 2 for a real error. Only 2 is a failure worth
    // falling back over; treating 1 as an error would rerun every empty search in JS.
    if (r.status === 0 || r.status === 1) {
      const hits = [];
      for (const line of (r.stdout || "").split("\n")) {
        if (!line || hits.length >= cap) break;
        const m = /^(.*?):(\d+):([\s\S]*)$/.exec(line);
        if (!m) continue;
        const path = toPosix(m[1].replace(/^\.\//, ""));
        if (onlySource && !isSourcePath(path)) continue;
        hits.push({ path, line: parseInt(m[2], 10), text: m[3] });
      }
      return hits;
    }
  }
  const re = new RegExp(pattern);
  const hits = [];
  for (const rel of walkFiles(root, { onlySource })) {
    if (hits.length >= cap) break;
    const body = readIfExists(join(root, rel));
    if (body === null) continue;
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ path: rel, line: i + 1, text: lines[i] });
        if (hits.length >= cap) break;
      }
    }
  }
  return hits;
}

const binaryCache = new Map();
function hasBinary(name) {
  if (!binaryCache.has(name)) {
    const r = spawnSync("command", ["-v", name], { encoding: "utf8", shell: true });
    binaryCache.set(name, r.status === 0 && !!(r.stdout || "").trim());
  }
  return binaryCache.get(name);
}

// ── Patch parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a unified diff patch into hunks with per-line old/new numbering.
 * GitHub's `files[].patch` omits the `diff --git` header, so the first line is `@@`.
 */
export function parsePatch(patch) {
  const hunks = [];
  if (!patch) return hunks;
  let current = null;
  let oldLine = 0;
  let newLine = 0;
  for (const raw of String(patch).split("\n")) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (header) {
      current = {
        oldStart: parseInt(header[1], 10),
        oldLines: parseInt(header[2] ?? "1", 10),
        newStart: parseInt(header[3], 10),
        newLines: parseInt(header[4] ?? "1", 10),
        lines: [],
      };
      oldLine = current.oldStart;
      newLine = current.newStart;
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("+")) {
      current.lines.push({ sign: "+", text: raw.slice(1), newLine: newLine++ });
    } else if (raw.startsWith("-")) {
      current.lines.push({ sign: "-", text: raw.slice(1), oldLine: oldLine++ });
    } else if (raw.startsWith("\\")) {
      // "\ No newline at end of file" — no line numbering effect.
    } else {
      current.lines.push({ sign: " ", text: raw.slice(1), oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return hunks;
}

// ── Declaration extraction ───────────────────────────────────────────────────────

/**
 * Language-aware declaration patterns. Each entry yields `{name, kind, exported}`.
 * Deliberately conservative: a missed declaration costs a symbol row (the file still
 * appears under `modules`), while a false one costs a bogus consumer search on a name
 * that is probably a keyword — noisier and harder to notice.
 */
const DECL_PATTERNS = {
  js: [
    [/^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, "function"],
    [/^\s*(export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, "class"],
    [/^\s*(export\s+)?interface\s+([A-Za-z_$][\w$]*)/, "interface"],
    [/^\s*(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, "type"],
    [/^\s*(export\s+)?enum\s+([A-Za-z_$][\w$]*)/, "enum"],
    [/^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function|\(|<)/, "function", { topLevelOnly: true }],
    [/^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/, "const", { topLevelOnly: true }],
  ],
  go: [
    [/^\s*()func\s+\(\s*\w+\s+\*?[\w.]+\s*\)\s+([A-Za-z_]\w*)/, "method"],
    [/^\s*()func\s+([A-Za-z_]\w*)/, "function"],
    [/^\s*()type\s+([A-Za-z_]\w*)/, "type"],
    [/^\s*()(?:var|const)\s+([A-Za-z_]\w*)/, "var"],
  ],
  py: [
    [/^\s*()(?:async\s+)?def\s+([A-Za-z_]\w*)/, "function"],
    [/^\s*()class\s+([A-Za-z_]\w*)/, "class"],
  ],
  rs: [
    [/^\s*(pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/, "function"],
    [/^\s*(pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, "type"],
    [/^\s*(pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, "enum"],
    [/^\s*(pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, "interface"],
  ],
  jvm: [
    [/^\s*(public\s+|internal\s+)?(?:static\s+|final\s+|abstract\s+|open\s+|suspend\s+)*(?:class|interface|object|enum)\s+([A-Za-z_]\w*)/, "class"],
    [/^\s*(public\s+|internal\s+)?(?:static\s+|final\s+|suspend\s+|override\s+)*fun\s+([A-Za-z_]\w*)/, "function"],
  ],
  rb: [
    [/^\s*()def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/, "function"],
    [/^\s*()(?:class|module)\s+([A-Za-z_]\w*)/, "class"],
  ],
  php: [
    [/^\s*(public\s+|protected\s+|private\s+)?(?:static\s+)?function\s+([A-Za-z_]\w*)/, "function"],
    [/^\s*()(?:class|interface|trait)\s+([A-Za-z_]\w*)/, "class"],
  ],
};

function languageOf(path) {
  switch (extOf(path)) {
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs":
    case ".mts": case ".cts": case ".vue": case ".svelte": return "js";
    case ".go": return "go";
    case ".py": return "py";
    case ".rs": return "rs";
    case ".java": case ".kt": case ".kts": case ".scala": case ".swift": case ".cs": return "jvm";
    case ".rb": return "rb";
    case ".php": return "php";
    default: return null;
  }
}

/** Go exports by capitalisation; Python's convention is the leading underscore. */
function exportednessFor(lang, path, name, exportKeyword) {
  if (lang === "go") return /^[A-Z]/.test(name);
  if (lang === "py") return !name.startsWith("_");
  if (lang === "rb" || lang === "php") return true;
  return !!exportKeyword;
}

/** Declarations on a single line, or [] when there is none. */
export function declarationsOnLine(line, path) {
  const lang = languageOf(path);
  if (!lang) return [];
  // Strip the diff sign but KEEP the indentation: it is the only scope signal available
  // without parsing, and `topLevelOnly` patterns depend on it.
  const body = line.replace(/^[-+]/, "");
  const indent = /^\s*/.exec(body)[0].length;
  const trimmed = body;
  // A comment line never declares anything. Same guard the shape classifier applies:
  // prose about `func Foo()` in a doc comment is not a declaration.
  if (/^\s*(\/\/|\/\*|\*|#|--)/.test(trimmed)) return [];
  const out = [];
  for (const [re, kind, patternOpts] of DECL_PATTERNS[lang]) {
    const m = re.exec(trimmed);
    if (!m) continue;
    const name = m[2];
    const exported = exportednessFor(lang, path, name, m[1]);
    // A `const`/`let`/`var` binding is a module symbol only at column 0 or when
    // exported; anywhere else it is a local, and locals are noise in a symbol graph.
    if (patternOpts?.topLevelOnly && indent > 0 && !exported) return [];
    out.push({ name, kind, exported });
    break; // first (most specific) pattern wins
  }
  return out;
}

/** Every declaration in a file body, with its 1-based line number. */
export function declarationsIn(body, path) {
  const out = [];
  const lines = String(body ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const d of declarationsOnLine(lines[i], path)) {
      out.push({ ...d, line: i + 1, decl: lines[i].trim() });
    }
  }
  return out;
}

/**
 * Normalise a declaration line for signature comparison: drop the body brace, comments
 * and trailing punctuation, and collapse whitespace. Two declarations that differ only
 * in formatting must compare equal, or every reformatted function reads as a signature
 * change and the whole PR routes deep.
 */
export function signatureOf(declLine) {
  return String(declLine ?? "")
    .replace(/\/\/.*$/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*$/, "")
    .replace(/[;,]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Changed symbols ──────────────────────────────────────────────────────────────

/**
 * Classify what happened to each symbol the diff touches.
 *
 *   added      declared only on the + side
 *   removed    declared only on the - side
 *   signature  declared on both sides with a different normalised declaration
 *   body       not re-declared, but a hunk falls inside its body
 *
 * `signature` and `removed` are the changes that break callers, so they carry a 3×
 * weight in the blast radius. `body` is the common case and carries 1×.
 */
export function changedSymbolsForFile(file, headBody) {
  const path = toPosix(file.filename ?? file.path ?? "");
  const status = file.status ?? "modified";
  const hunks = parsePatch(file.patch);
  const added = new Map();
  const removed = new Map();

  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.sign === " ") continue;
      for (const d of declarationsOnLine(l.text, path)) {
        const bucket = l.sign === "+" ? added : removed;
        if (!bucket.has(d.name)) {
          bucket.set(d.name, { ...d, decl: signatureOf(l.text), line: l.newLine ?? l.oldLine ?? 0 });
        }
      }
    }
  }

  const symbols = new Map();
  const put = (d, change, line) => {
    const prev = symbols.get(d.name);
    // Precedence: removed > signature > added > body. A symbol that is both
    // re-declared and has body edits is reported by the stronger fact.
    const rank = { removed: 4, signature: 3, added: 2, body: 1 };
    if (prev && rank[prev.change] >= rank[change]) return;
    symbols.set(d.name, {
      path, name: d.name, kind: d.kind, exported: d.exported, change,
      line: line || d.line || 0,
    });
  };

  for (const [name, d] of added) {
    const before = removed.get(name);
    if (!before) put(d, status === "added" ? "added" : "added", d.line);
    else if (before.decl !== d.decl) put(d, "signature", d.line);
    else put(d, "body", d.line);
  }
  for (const [name, d] of removed) {
    if (!added.has(name)) put(d, "removed", d.line);
  }

  // Enclosing-symbol attribution for hunks that re-declare nothing: the nearest
  // declaration at or above the hunk start in the HEAD file. This is what makes an
  // ordinary body edit visible as "you changed retryRequest" rather than as an
  // anonymous line range — the whole point of a symbol-keyed graph.
  if (headBody && status !== "removed") {
    const decls = declarationsIn(headBody, path);
    if (decls.length) {
      for (const h of hunks) {
        const touched = h.lines.filter((l) => l.sign === "+" && typeof l.newLine === "number");
        if (!touched.length) continue;
        const at = touched[0].newLine;
        let best = null;
        for (const d of decls) {
          if (d.line <= at && (!best || d.line > best.line)) best = d;
        }
        if (best && !symbols.has(best.name)) {
          put({ ...best, decl: signatureOf(best.decl) }, "body", best.line);
        }
      }
    }
  }
  return [...symbols.values()];
}

// ── Consumers, importers, tests ──────────────────────────────────────────────────

function packageRootOf(relPath, root) {
  let dir = dirname(relPath);
  for (;;) {
    for (const marker of PACKAGE_MARKERS) {
      if (existsSync(join(root, dir === "." ? marker : posix.join(dir, marker)))) return dir;
    }
    if (dir === "." || dir === "" || dir === "/") return ".";
    const next = dirname(dir);
    if (next === dir) return ".";
    dir = next;
  }
}

/** Call sites and references to `name`, excluding its own defining file. */
function consumersOf(name, definingPath, root, opts) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return { consumers: [], count: 0 };
  const hits = search(root, `\\b${name}\\b`, { useRg: opts.useRg, cap: opts.maxConsumers, onlySource: true });
  const consumers = [];
  for (const h of hits) {
    if (h.path === definingPath) continue;
    const after = h.text.slice(h.text.indexOf(name) + name.length);
    const isImport = /\b(import|require|from)\b/.test(h.text) && /['"`]/.test(h.text);
    if (isImport) continue; // an import edge, already reported under modules.importers
    consumers.push({ path: h.path, line: h.line, kind: /^\s*[(<]/.test(after) ? "call" : "ref" });
  }
  return { consumers, count: consumers.length, files: new Set(consumers.map((c) => c.path)).size };
}

/**
 * Files that import a changed module. Relative specifiers are resolved against the
 * importing file's directory and compared to the module path, so a match is a real
 * import edge rather than a basename coincidence. Alias specifiers come from
 * `tsconfig` `paths` and the `go.mod` module path.
 */
function importersOf(modulePath, root, aliases, opts) {
  const bare = basename(stripExt(modulePath));
  if (!bare) return [];
  const hits = search(root, `(from|require|import)\\s*\\(?\\s*['"\`][^'"\`]*${bare}['"\`]`, { useRg: opts.useRg, cap: 2000 });
  const target = stripExt(modulePath);
  const out = new Set();
  for (const h of hits) {
    if (h.path === modulePath) continue;
    const m = /['"`]([^'"`]+)['"`]/.exec(h.text);
    if (!m) continue;
    const spec = m[1];
    let resolved = null;
    if (spec.startsWith(".")) {
      resolved = stripExt(toPosix(posix.normalize(posix.join(dirname(h.path), spec))));
    } else {
      for (const [prefix, targets] of aliases) {
        if (spec.startsWith(prefix)) {
          for (const t of targets) {
            const cand = stripExt(toPosix(posix.normalize(spec.replace(prefix, t))));
            if (cand === target) { resolved = cand; break; }
          }
        }
        if (resolved) break;
      }
    }
    if (resolved === target || (resolved && (resolved === `${target}/index` || `${resolved}/index` === target))) {
      out.add(h.path);
    }
  }
  return [...out].sort();
}

/**
 * Alias prefixes: tsconfig `compilerOptions.paths` plus the `go.mod` module path.
 * Read with a tolerant regex rather than a JSON parse because tsconfig is habitually
 * JSONC (comments and trailing commas), and a throw here would silently disable alias
 * resolution for the whole repo.
 */
function aliasMap(root) {
  const out = [];
  for (const cfg of ["tsconfig.json", "tsconfig.base.json", "jsconfig.json"]) {
    const body = readIfExists(join(root, cfg));
    if (!body) continue;
    const pathsBlock = /"paths"\s*:\s*\{([^{}]*)\}/.exec(body);
    if (!pathsBlock) continue;
    for (const m of pathsBlock[1].matchAll(/"([^"]+)"\s*:\s*\[([^\]]*)\]/g)) {
      const prefix = m[1].replace(/\*$/, "");
      const targets = [...m[2].matchAll(/"([^"]+)"/g)].map((t) => t[1].replace(/\*$/, "").replace(/^\.\//, ""));
      if (prefix && targets.length) out.push([prefix, targets]);
    }
  }
  const goMod = readIfExists(join(root, "go.mod"));
  if (goMod) {
    const m = /^module\s+(\S+)/m.exec(goMod);
    if (m) out.push([`${m[1]}/`, [""]]);
  }
  return out;
}

/** Test files that reach a symbol: an importing/consuming test, or the sibling convention. */
function coveringTests(symbolPath, consumers, importers, root) {
  const tests = new Set();
  for (const c of consumers) if (TEST_RE.test(c.path)) tests.add(c.path);
  for (const i of importers) if (TEST_RE.test(i)) tests.add(i);
  const stem = stripExt(symbolPath);
  for (const suffix of [".test", ".spec", "_test"]) {
    for (const ext of [extOf(symbolPath), ".ts", ".tsx", ".js", ".go", ".py", ".rs"]) {
      const cand = `${stem}${suffix}${ext}`;
      if (cand !== symbolPath && existsSync(join(root, cand))) tests.add(cand);
    }
  }
  return [...tests].sort();
}

// ── Lockfile parsers ─────────────────────────────────────────────────────────────
//
// Each returns a flat `{name -> version}` map of RESOLVED versions. Regex rather than
// real parsers on purpose: no dependency may be added for a script that has to run on
// an arbitrary caller's checkout, and a lockfile we cannot parse must degrade to "no
// dependency rows", never to a throw.

export function parseNpmLock(text) {
  const out = {};
  let json;
  try { json = JSON.parse(text); } catch { return out; }
  if (json.packages && typeof json.packages === "object") {
    for (const [key, val] of Object.entries(json.packages)) {
      if (!key || !val?.version) continue;
      const idx = key.lastIndexOf("node_modules/");
      if (idx < 0) continue;
      out[key.slice(idx + "node_modules/".length)] = val.version;
    }
  }
  if (json.dependencies && typeof json.dependencies === "object") {
    const walk = (deps) => {
      for (const [name, val] of Object.entries(deps)) {
        if (val?.version && !out[name]) out[name] = val.version;
        if (val?.dependencies) walk(val.dependencies);
      }
    };
    walk(json.dependencies);
  }
  return out;
}

export function parsePnpmLock(text) {
  const out = {};
  // v6/v9 packages keys: `/name@1.2.3:` or `name@1.2.3:` or `/@scope/name@1.2.3:`
  for (const m of text.matchAll(/^\s{2}\/?((?:@[^/\s]+\/)?[^@\s/][^@\s]*)@(\d[^:(\s]*)[:(]/gm)) {
    out[m[1]] = m[2];
  }
  return out;
}

export function parseYarnLock(text) {
  const out = {};
  const blocks = text.split(/\n(?=\S|"\S)/);
  for (const block of blocks) {
    const header = /^"?((?:@[^/"@]+\/)?[^@"\s]+)@/.exec(block.trim());
    const version = /\n\s+"?version"?[:\s]+"?([^"\s]+)"?/.exec(block);
    if (header && version) out[header[1]] = version[1];
  }
  return out;
}

function parseTomlPackages(text) {
  const out = {};
  for (const block of text.split(/\[\[package\]\]/).slice(1)) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block);
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block);
    if (name && version) out[name[1]] = version[1];
  }
  return out;
}

export function parseCargoLock(text) { return parseTomlPackages(text); }
export function parsePoetryLock(text) { return parseTomlPackages(text); }

export function parseGoSum(text) {
  const out = {};
  for (const m of text.matchAll(/^(\S+)\s+v(\S+?)(?:\/go\.mod)?\s+h1:/gm)) {
    // go.sum lists every version ever seen; the highest is the resolved one closely
    // enough for a delta, and `go.mod` (parsed too) is authoritative where present.
    const [, name, version] = m;
    if (!out[name] || compareVersions(version, out[name]) > 0) out[name] = version;
  }
  return out;
}

export function parseGoMod(text) {
  const out = {};
  for (const m of text.matchAll(/^\s*(\S+)\s+v(\S+)/gm)) {
    if (m[1] === "module" || m[1] === "go" || m[1] === "require" || m[1] === "toolchain") continue;
    out[m[1]] = m[2];
  }
  return out;
}

export function parseGemfileLock(text) {
  const out = {};
  for (const m of text.matchAll(/^\s{4}([a-zA-Z0-9_.-]+)\s+\(([^)]+)\)/gm)) out[m[1]] = m[2];
  return out;
}

export function parseComposerLock(text) {
  const out = {};
  let json;
  try { json = JSON.parse(text); } catch { return out; }
  for (const group of ["packages", "packages-dev"]) {
    for (const p of json[group] ?? []) if (p?.name && p?.version) out[p.name] = p.version.replace(/^v/, "");
  }
  return out;
}

// ── Version comparison ───────────────────────────────────────────────────────────

function versionParts(v) {
  const m = /^[v=^~><\s]*(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v ?? ""));
  return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3] ?? "0", 10)] : null;
}

export function compareVersions(a, b) {
  const pa = versionParts(a);
  const pb = versionParts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

/**
 * `major` / `minor` / `patch` / `none` / `other`, plus the direction. A 0.x bump is
 * reported as `major` when the minor moves: under semver 0.x has no stability promise,
 * and treating `0.4.0 → 0.5.0` as a minor bump is how a breaking change on a
 * pre-1.0 dependency routes cheap.
 */
export function semverDelta(from, to) {
  const pa = versionParts(from);
  const pb = versionParts(to);
  if (!pa || !pb) return { semver_delta: "other", direction: "unknown" };
  const direction = compareVersions(from, to) < 0 ? "upgrade" : compareVersions(from, to) > 0 ? "downgrade" : "same";
  if (pa[0] !== pb[0]) return { semver_delta: "major", direction };
  if (pa[0] === 0 && pa[1] !== pb[1]) return { semver_delta: "major", direction, zerover: true };
  if (pa[1] !== pb[1]) return { semver_delta: "minor", direction };
  if (pa[2] !== pb[2]) return { semver_delta: "patch", direction };
  return { semver_delta: "none", direction };
}

// ── Base-side file access ────────────────────────────────────────────────────────

function makeBaseReader({ baseDir, baseRef, workdir, useVcs }) {
  if (baseDir) return (p) => readIfExists(join(baseDir, p));
  if (baseRef && useVcs) {
    return (p) => {
      const r = spawnSync("git", ["-C", workdir, "show", `${baseRef}:${p}`], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      return r.status === 0 ? r.stdout : null;
    };
  }
  return () => null;
}

// ── Dependency deltas ────────────────────────────────────────────────────────────

function dependencyDeltas(files, root, readBase, opts) {
  const out = [];
  const changedLocks = files
    .map((f) => toPosix(f.filename ?? f.path ?? ""))
    .filter((p) => LOCKFILES[basename(p)]);

  // A manifest-only change (a range widened, a dep added) still deserves a row, but the
  // lockfile is the version source wherever one exists beside it.
  const manifestOnly = files
    .map((f) => toPosix(f.filename ?? f.path ?? ""))
    .filter((p) => ["package.json", "go.mod", "Cargo.toml", "pyproject.toml", "composer.json", "Gemfile"].includes(basename(p)))
    .filter((p) => !changedLocks.some((l) => dirname(l) === dirname(p)));

  for (const lockPath of [...new Set(changedLocks)]) {
    const parser = LOCKFILES[basename(lockPath)];
    const headText = readIfExists(join(root, lockPath));
    const baseText = readBase(lockPath);
    if (!headText || !baseText) continue;
    let headMap = {};
    let baseMap = {};
    try { headMap = parser(headText); baseMap = parser(baseText); } catch { continue; }
    const manifestPath = manifestBeside(lockPath, root);
    const direct = directDependencyNames(manifestPath ? readIfExists(join(root, manifestPath)) : null, manifestPath);
    for (const name of new Set([...Object.keys(headMap), ...Object.keys(baseMap)])) {
      const from = baseMap[name];
      const to = headMap[name];
      if (from === to) continue;
      const delta = from && to ? semverDelta(from, to)
        : { semver_delta: to ? "added" : "removed", direction: to ? "upgrade" : "removal" };
      out.push({
        manifest: manifestPath ?? lockPath,
        lockfile: lockPath,
        name,
        from: from ?? null,
        to: to ?? null,
        direct: direct.has(name),
        ...delta,
        usage_sites: usageSites(name, root, opts),
      });
    }
  }

  for (const manifestPath of [...new Set(manifestOnly)]) {
    const headText = readIfExists(join(root, manifestPath));
    const baseText = readBase(manifestPath);
    if (!headText || !baseText) continue;
    const headMap = manifestRanges(headText, manifestPath);
    const baseMap = manifestRanges(baseText, manifestPath);
    for (const name of new Set([...Object.keys(headMap), ...Object.keys(baseMap)])) {
      const from = baseMap[name];
      const to = headMap[name];
      if (from === to) continue;
      const delta = from && to ? semverDelta(from, to)
        : { semver_delta: to ? "added" : "removed", direction: to ? "upgrade" : "removal" };
      out.push({
        manifest: manifestPath, lockfile: null, name,
        from: from ?? null, to: to ?? null, direct: true,
        ...delta,
        range_only: true,
        usage_sites: usageSites(name, root, opts),
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function manifestBeside(lockPath, root) {
  const dir = dirname(lockPath);
  const candidates = {
    "package-lock.json": "package.json", "npm-shrinkwrap.json": "package.json",
    "pnpm-lock.yaml": "package.json", "yarn.lock": "package.json",
    "Cargo.lock": "Cargo.toml", "poetry.lock": "pyproject.toml",
    "go.sum": "go.mod", "go.mod": "go.mod",
    "Gemfile.lock": "Gemfile", "composer.lock": "composer.json",
  };
  const name = candidates[basename(lockPath)];
  if (!name) return null;
  const p = dir === "." ? name : posix.join(dir, name);
  return existsSync(join(root, p)) ? p : null;
}

function directDependencyNames(manifestText, manifestPath) {
  const out = new Set();
  if (!manifestText) return out;
  if (basename(manifestPath ?? "") === "package.json" || basename(manifestPath ?? "") === "composer.json") {
    try {
      const json = JSON.parse(manifestText);
      for (const group of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "require", "require-dev"]) {
        for (const name of Object.keys(json[group] ?? {})) out.add(name);
      }
    } catch { /* tolerated */ }
    return out;
  }
  for (const m of manifestText.matchAll(/^\s*([A-Za-z0-9_.\/@-]+)\s*[=:]?\s*["v\d]/gm)) out.add(m[1]);
  return out;
}

function manifestRanges(text, manifestPath) {
  const out = {};
  if (basename(manifestPath) === "package.json" || basename(manifestPath) === "composer.json") {
    try {
      const json = JSON.parse(text);
      for (const group of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "require", "require-dev"]) {
        for (const [k, v] of Object.entries(json[group] ?? {})) out[k] = String(v);
      }
    } catch { /* tolerated */ }
    return out;
  }
  for (const m of text.matchAll(/^\s*(\S+)\s+v?(\d[\w.+-]*)/gm)) {
    if (["module", "go", "require", "toolchain"].includes(m[1])) continue;
    out[m[1]] = m[2];
  }
  return out;
}

/** Where the repo actually calls the package — the intersection that makes a bump real. */
function usageSites(name, root, opts) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const hits = search(root, `['"\`]${escaped}(/[^'"\`]*)?['"\`]`, { useRg: opts.useRg, cap: 200 });
  const sites = [];
  for (const h of hits) {
    if (!/\b(import|require|from|use)\b/.test(h.text) && !/^\s*(import|use)\b/.test(h.text)) continue;
    const api = /(?:import\s+(?:\*\s+as\s+)?(\{[^}]*\}|[A-Za-z_$][\w$]*))/.exec(h.text);
    sites.push({ path: h.path, line: h.line, api: api ? api[1].replace(/\s+/g, " ").trim() : null });
  }
  return sites.slice(0, 50);
}

// ── Config consumers ─────────────────────────────────────────────────────────────

function configConsumers(files, root, opts) {
  const out = [];
  for (const f of files) {
    const p = toPosix(f.filename ?? f.path ?? "");
    if (!CONFIG_EXT.has(extOf(p))) continue;
    if (LOCKFILES[basename(p)] || basename(p) === "package.json") continue;
    const bare = basename(p);
    const hits = search(root, `['"\`][^'"\`]*${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}['"\`]`, { useRg: opts.useRg, cap: 100 });
    const readers = [...new Set(hits.map((h) => h.path).filter((r) => r !== p))].sort();
    if (readers.length) out.push({ changed: p, readers: readers.slice(0, 25), reader_count: readers.length });
  }
  return out;
}

// ── Telemetry (proposal § 4.8.2) ─────────────────────────────────────────────────
//
// Exposure is an INPUT ABOUT THE CODE BEING CHANGED, never a verdict about the change:
// no telemetry exists for a diff before it merges. So it may only raise a weight.
// A symbol with no spans is `unknown`, never `safe` — it may be uninstrumented,
// sampled out, or cold-path.

const TRAFFIC_MULTIPLIER = { high: 2, medium: 1.5, low: 1, unknown: 1 };

function attachProduction(symbols, production) {
  if (!production || typeof production !== "object") return null;
  const byKey = new Map();
  for (const s of production.symbols ?? []) byKey.set(`${s.name}@${toPosix(s.path ?? "")}`, s);
  const serviceForPath = new Map();
  for (const svc of production.services ?? []) {
    for (const p of svc.paths ?? []) serviceForPath.set(toPosix(p), svc);
  }
  for (const sym of symbols) {
    const direct = byKey.get(`${sym.name}@${sym.path}`);
    if (direct) {
      sym.production = {
        service: direct.service ?? serviceForPath.get(sym.path)?.service ?? null,
        traffic_band: direct.traffic_band ?? "unknown",
        error_rate: direct.error_rate ?? null,
        exception_types_30d: direct.exception_types_30d ?? [],
        source: "symbol",
      };
      continue;
    }
    const svc = serviceForPath.get(sym.path);
    if (svc) {
      sym.production = {
        service: svc.service ?? null,
        traffic_band: svc.traffic_band ?? bandFromRate(svc.req_per_min),
        error_rate: svc.error_rate ?? null,
        exception_types_30d: [],
        source: "service",
      };
    }
  }
  return {
    sampled_at: production.sampled_at ?? null,
    services: production.services ?? [],
    routes: production.routes ?? [],
    preview: production.preview ?? null,
  };
}

function bandFromRate(reqPerMin) {
  if (typeof reqPerMin !== "number") return "unknown";
  if (reqPerMin >= 100) return "high";
  if (reqPerMin >= 1) return "medium";
  return "low";
}

// ── Blast radius ─────────────────────────────────────────────────────────────────

/**
 * score = Σ consumers × (2 if cross-package) × (3 if signature|removed) × traffic
 *       + Σ dependency usage sites × (3 major / 1 minor)
 *
 * Bands: none 0 · low < 10 · medium < 30 · high ≥ 30. The thresholds are a starting
 * calibration, tuned against the bug-detection corpus rather than argued in prose.
 */
export function blastRadius(symbols, dependencies) {
  let score = 0;
  const why = [];
  for (const s of symbols) {
    const base = s.consumer_files ?? s.consumer_count ?? 0;
    if (!base) continue;
    const structural = s.change === "signature" || s.change === "removed" ? 3 : 1;
    const pkg = s.cross_package ? 2 : 1;
    const traffic = TRAFFIC_MULTIPLIER[s.production?.traffic_band ?? "unknown"] ?? 1;
    const term = base * structural * pkg * traffic;
    score += term;
    if (term >= 6) {
      const bits = [`${base} consuming file${base === 1 ? "" : "s"}`];
      if (s.cross_package) bits.push(`${s.package_count} packages`);
      if (structural === 3) bits.push(`${s.change} change`);
      if (traffic > 1) bits.push(`${s.production.traffic_band} traffic in ${s.production.service ?? "production"}`);
      why.push(`${s.name}: ${bits.join(", ")}`);
    }
  }
  for (const d of dependencies) {
    const weight = d.semver_delta === "major" ? 3 : d.semver_delta === "minor" ? 1 : 0;
    if (!weight) continue;
    const sites = d.usage_sites?.length ?? 0;
    score += sites * weight;
    if (sites && d.semver_delta === "major") {
      why.push(`${d.name}: ${d.semver_delta} bump ${d.from ?? "?"} → ${d.to ?? "?"} with ${sites} usage site${sites === 1 ? "" : "s"}`);
    }
  }
  score = Math.round(score);
  const band = score === 0 ? "none" : score < 10 ? "low" : score < 30 ? "medium" : "high";
  return { score, band, why: why.slice(0, 10) };
}

// ── Cross-branch overlap ─────────────────────────────────────────────────────────
//
// "Finds stuff between branches and authors" at its cheapest: two open PRs touching the
// same symbol are a semantic conflict even when git merges both cleanly, and GitHub
// already knows the file lists. Needs no memory.

function fetchOverlaps({ repo, pr, useVcs }) {
  if (!repo || !useVcs || !hasBinary("gh")) return null;
  const r = spawnSync("gh", [
    "pr", "list", "--repo", repo, "--state", "open", "--limit", "30",
    "--json", "number,author,headRefName,files",
  ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout || "[]").filter((p) => String(p.number) !== String(pr)); } catch { return null; }
}

export function computeOverlaps(otherPrs, changedFiles, changedSymbolNames) {
  const out = [];
  const mine = new Set(changedFiles);
  for (const other of otherPrs ?? []) {
    const theirs = (other.files ?? []).map((f) => toPosix(f.path ?? f.filename ?? ""));
    const files = theirs.filter((f) => mine.has(f));
    if (!files.length) continue;
    // Symbol-level overlap needs the other head's patches. When the input carries them
    // (`files[].patch`), intersect symbol names; otherwise report the file overlap only
    // and say so, rather than implying a symbol match nobody checked.
    const symbols = [];
    for (const f of other.files ?? []) {
      const p = toPosix(f.path ?? f.filename ?? "");
      if (!files.includes(p) || !f.patch) continue;
      for (const s of changedSymbolsForFile({ filename: p, patch: f.patch }, null)) {
        if (changedSymbolNames.has(s.name)) symbols.push(s.name);
      }
    }
    out.push({
      pr: other.number,
      author: other.author?.login ?? other.author ?? null,
      head: other.headRefName ?? null,
      files: [...new Set(files)].sort(),
      symbols: [...new Set(symbols)].sort(),
      kind: symbols.length ? "same-symbol" : "same-file",
    });
  }
  return out.sort((a, b) => (b.symbols.length - a.symbols.length) || (a.pr - b.pr));
}

// ── Assemble ─────────────────────────────────────────────────────────────────────

export function buildGraph({ files, workdir, readBase, production, otherPrs, opts }) {
  const aliases = aliasMap(workdir);
  const symbols = [];
  const modules = [];

  for (const f of files) {
    const path = toPosix(f.filename ?? f.path ?? "");
    if (!path || !isSourcePath(path)) continue;
    if (TEST_RE.test(path)) continue; // a changed test is not a changed contract
    const headBody = readIfExists(join(workdir, path));
    const importers = importersOf(path, workdir, aliases, opts);
    modules.push({ path, importers: importers.length, importer_paths: importers.slice(0, 25) });

    for (const sym of changedSymbolsForFile(f, headBody)) {
      const { consumers, count, files: consumerFiles } = consumersOf(sym.name, path, workdir, opts);
      const roots = new Set([packageRootOf(path, workdir), ...consumers.map((c) => packageRootOf(c.path, workdir))]);
      symbols.push({
        ...sym,
        consumers: consumers.slice(0, CONSUMER_LIST_CAP),
        consumers_truncated: count > CONSUMER_LIST_CAP,
        consumer_count: count,
        consumer_files: consumerFiles,
        cross_package: roots.size > 1,
        package_count: roots.size,
        covering_tests: coveringTests(path, consumers, importers, workdir),
        fp_seed: safeFingerprint(sym),
      });
    }
  }

  const dependencies = dependencyDeltas(files, workdir, readBase, opts);
  const productionTop = attachProduction(symbols, production);
  const changedFiles = files.map((f) => toPosix(f.filename ?? f.path ?? "")).filter(Boolean);
  const overlaps = computeOverlaps(otherPrs, changedFiles, new Set(symbols.map((s) => s.name)));
  const blast = blastRadius(symbols, dependencies);

  return {
    schema: 1,
    symbols: symbols.sort((a, b) => ((b.consumer_files ?? 0) - (a.consumer_files ?? 0)) || a.name.localeCompare(b.name)),
    modules: modules.sort((a, b) => b.importers - a.importers),
    dependencies,
    config_consumers: configConsumers(files, workdir, opts),
    blast_radius: blast,
    overlaps,
    ...(productionTop ? { production: productionTop } : {}),
    routing_signals: routingSignals(symbols, dependencies, overlaps, blast),
  };
}

/**
 * A symbol carries the fingerprint SEED (finder and defect class are the finder's to
 * choose) so no caller has to compose the symbol@path half by hand. `-` is the
 * documented no-symbol form, and an unbuildable seed is omitted rather than guessed.
 */
function safeFingerprint(sym) {
  try {
    return buildFingerprint({ finder: "consumer-impact", defectClass: "contract-break", symbol: sym.name, path: sym.path })
      .split(":").slice(2).join(":");
  } catch { return null; }
}

/**
 * The facts Phase C routes on, precomputed so the routing rule reads fields instead of
 * re-deriving them from the graph (and so a golden routing case can assert them).
 */
export function routingSignals(symbols, dependencies, overlaps, blast) {
  const deltas = dependencies.map((d) => d.semver_delta);
  const rank = { none: 0, patch: 1, minor: 2, added: 2, removed: 3, other: 3, major: 4 };
  const maxDelta = deltas.length ? deltas.reduce((a, b) => (rank[b] > rank[a] ? b : a), "none") : "none";
  return {
    blast_band: blast.band,
    blast_score: blast.score,
    max_semver_delta: maxDelta,
    structural_change_count: symbols.filter((s) => s.change === "signature" || s.change === "removed").length,
    widest_consumer_count: symbols.reduce((m, s) => Math.max(m, s.consumer_files ?? s.consumer_count ?? 0), 0),
    cross_package_symbols: symbols.filter((s) => s.cross_package).map((s) => s.name),
    untested_structural_symbols: symbols
      .filter((s) => (s.change === "signature" || s.change === "removed") && !(s.covering_tests ?? []).length)
      .map((s) => s.name),
    high_traffic_structural_change: symbols.some(
      (s) => s.production?.traffic_band === "high" && (s.change === "signature" || s.change === "removed"),
    ),
    same_symbol_overlap: overlaps.some((o) => o.kind === "same-symbol"),
  };
}

// ── Self-test ────────────────────────────────────────────────────────────────────

function writeTree(root, tree) {
  for (const [p, body] of Object.entries(tree)) {
    const full = join(root, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);

  // ── pure units ────────────────────────────────────────────────────────────────
  t("parsePatch numbers both sides of a hunk", () => {
    const h = parsePatch("@@ -10,3 +10,4 @@\n ctx\n-old\n+new\n+extra\n");
    if (h.length !== 1) return false;
    const plus = h[0].lines.filter((l) => l.sign === "+");
    const minus = h[0].lines.filter((l) => l.sign === "-");
    return plus[0].newLine === 11 && plus[1].newLine === 12 && minus[0].oldLine === 11;
  });

  t("parsePatch tolerates a single-line hunk header with no counts", () => {
    const h = parsePatch("@@ -1 +1 @@\n-a\n+b");
    return h.length === 1 && h[0].oldLines === 1 && h[0].newLines === 1;
  });

  t("declarationsOnLine reads an exported TS function", () => {
    const [d] = declarationsOnLine("export async function retryRequest(job: Job) {", "src/a.ts");
    return d && d.name === "retryRequest" && d.kind === "function" && d.exported === true;
  });

  t("declarationsOnLine reads an arrow const as a function", () => {
    const [d] = declarationsOnLine("export const useThing = (id: string) => {", "src/a.ts");
    return d && d.name === "useThing" && d.kind === "function";
  });

  t("declarationsOnLine ignores a comment that mentions a declaration", () =>
    declarationsOnLine("// export function retryRequest() is the entry point", "src/a.ts").length === 0
    && declarationsOnLine(" * func Foo() does the thing", "src/a.go").length === 0);

  t("Go exportedness is capitalisation, not a keyword", () => {
    const [pub] = declarationsOnLine("func RetryRequest(ctx context.Context) error {", "a.go");
    const [priv] = declarationsOnLine("func retryRequest(ctx context.Context) error {", "a.go");
    return pub.exported === true && priv.exported === false;
  });

  t("Python exportedness is the leading underscore", () => {
    const [pub] = declarationsOnLine("def handle(request):", "a.py");
    const [priv] = declarationsOnLine("def _handle(request):", "a.py");
    return pub.exported === true && priv.exported === false;
  });

  t("Rust pub fn is exported", () => {
    const [d] = declarationsOnLine("pub async fn retry_request(job: Job) -> Result<()> {", "a.rs");
    return d.name === "retry_request" && d.exported === true;
  });

  t("signatureOf ignores reformatting but not a real parameter change", () =>
    signatureOf("function f(a: string) {") === signatureOf("function f(a: string)   {  ")
    && signatureOf("function f(a: string) {") !== signatureOf("function f(a: number) {"));

  t("a re-declared symbol with a changed signature is `signature`", () => {
    const [s] = changedSymbolsForFile({
      filename: "src/a.ts",
      patch: "@@ -1,3 +1,3 @@\n-export function f(a: string) {\n+export function f(a: string, b: number) {\n   return a\n",
    }, null);
    return s.name === "f" && s.change === "signature";
  });

  t("a re-declared symbol with an identical declaration is `body`, not `signature`", () => {
    const [s] = changedSymbolsForFile({
      filename: "src/a.ts",
      patch: "@@ -1,4 +1,4 @@\n-export function f(a: string) {\n+export function f(a: string) {\n-  return a\n+  return a.trim()\n",
    }, null);
    return s.change === "body";
  });

  t("a deleted declaration is `removed`", () => {
    const [s] = changedSymbolsForFile({
      filename: "src/a.ts", patch: "@@ -1,3 +1,1 @@\n-export function gone() {\n-  return 1\n-}\n",
    }, null);
    return s.name === "gone" && s.change === "removed";
  });

  t("a body-only hunk is attributed to its enclosing symbol from the head file", () => {
    const head = "export function outer() {\n  const a = 1\n  return a\n}\n";
    const syms = changedSymbolsForFile({
      filename: "src/a.ts", patch: "@@ -2,2 +2,2 @@\n-  const a = 1\n+  const a = 2\n",
    }, head);
    return syms.length === 1 && syms[0].name === "outer" && syms[0].change === "body";
  });

  t("semverDelta classifies the four levels and the direction", () =>
    semverDelta("14.2.0", "16.0.1").semver_delta === "major"
    && semverDelta("1.2.0", "1.3.0").semver_delta === "minor"
    && semverDelta("1.2.0", "1.2.1").semver_delta === "patch"
    && semverDelta("1.2.0", "1.2.0").semver_delta === "none"
    && semverDelta("2.0.0", "1.0.0").direction === "downgrade"
    && semverDelta("weird", "1.0.0").semver_delta === "other");

  t("a 0.x minor bump is treated as major (0.x has no stability promise)", () => {
    const d = semverDelta("0.4.0", "0.5.0");
    return d.semver_delta === "major" && d.zerover === true;
  });

  t("parseNpmLock reads a v3 packages map including a scoped name", () => {
    const m = parseNpmLock(JSON.stringify({
      lockfileVersion: 3,
      packages: { "": { name: "root" }, "node_modules/stripe": { version: "16.0.1" }, "node_modules/@scope/pkg": { version: "2.0.0" } },
    }));
    return m.stripe === "16.0.1" && m["@scope/pkg"] === "2.0.0";
  });

  t("parseNpmLock reads a v1 nested dependencies tree", () => {
    const m = parseNpmLock(JSON.stringify({ lockfileVersion: 1, dependencies: { stripe: { version: "14.2.0", dependencies: { qs: { version: "6.0.0" } } } } }));
    return m.stripe === "14.2.0" && m.qs === "6.0.0";
  });

  t("parseYarnLock reads a classic block", () =>
    parseYarnLock('"stripe@^14.0.0":\n  version "14.2.0"\n  resolved "https://x"\n').stripe === "14.2.0");

  t("parsePnpmLock reads a v9 packages key", () => {
    const m = parsePnpmLock("packages:\n\n  stripe@16.0.1:\n    resolution: {integrity: sha512-x}\n  /@scope/pkg@2.0.0:\n    resolution: {integrity: sha512-y}\n");
    return m.stripe === "16.0.1" && m["@scope/pkg"] === "2.0.0";
  });

  t("parseCargoLock reads [[package]] blocks", () => {
    const m = parseCargoLock('[[package]]\nname = "serde"\nversion = "1.0.200"\n\n[[package]]\nname = "tokio"\nversion = "1.38.0"\n');
    return m.serde === "1.0.200" && m.tokio === "1.38.0";
  });

  t("parseGoSum keeps the highest version seen", () => {
    const m = parseGoSum("github.com/x/y v1.2.0 h1:aaa=\ngithub.com/x/y v1.3.0 h1:bbb=\ngithub.com/x/y v1.3.0/go.mod h1:ccc=\n");
    return m["github.com/x/y"] === "1.3.0";
  });

  t("an unparseable lockfile yields no rows instead of throwing", () =>
    Object.keys(parseNpmLock("{not json")).length === 0 && Object.keys(parseCargoLock("")).length === 0);

  t("blastRadius bands a wide signature change high and a lone body edit none/low", () => {
    const wide = blastRadius([{ name: "f", change: "signature", consumer_count: 14, cross_package: true, package_count: 3 }], []);
    const narrow = blastRadius([{ name: "g", change: "body", consumer_count: 0 }], []);
    return wide.band === "high" && wide.why.length >= 1 && narrow.band === "none" && narrow.score === 0;
  });

  t("a major bump with usage sites raises the score; an unused one does not", () => {
    const used = blastRadius([], [{ name: "stripe", semver_delta: "major", from: "14.2.0", to: "16.0.1", usage_sites: [{}, {}, {}, {}] }]);
    const unused = blastRadius([], [{ name: "left-pad", semver_delta: "major", usage_sites: [] }]);
    return used.score === 12 && used.band === "medium" && unused.score === 0;
  });

  t("telemetry only ever raises the blast score", () => {
    const sym = { name: "f", change: "body", consumer_count: 10, cross_package: false, package_count: 1 };
    const plain = blastRadius([{ ...sym }], []).score;
    const hot = blastRadius([{ ...sym, production: { traffic_band: "high", service: "api" } }], []).score;
    const cold = blastRadius([{ ...sym, production: { traffic_band: "unknown", service: "api" } }], []).score;
    return hot === plain * 2 && cold === plain;
  });

  t("a symbol with no production row inherits its service band, never 'safe'", () => {
    const symbols = [{ name: "f", path: "services/api/h.ts", change: "body", consumer_count: 1 }];
    attachProduction(symbols, { services: [{ service: "api", paths: ["services/api/h.ts"], req_per_min: 412 }] });
    return symbols[0].production.traffic_band === "high" && symbols[0].production.source === "service";
  });

  t("routingSignals reports a high-traffic structural change", () => {
    const rs = routingSignals(
      [{ name: "f", change: "signature", consumer_count: 3, covering_tests: [], production: { traffic_band: "high" } }],
      [], [], { band: "low", score: 9 },
    );
    return rs.high_traffic_structural_change === true && rs.untested_structural_symbols[0] === "f";
  });

  t("computeOverlaps distinguishes same-symbol from same-file", () => {
    const out = computeOverlaps(
      [
        { number: 212, author: { login: "alice" }, headRefName: "feat/x", files: [{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-export function f(a: string) {\n+export function f(a: string, b: number) {" }] },
        { number: 99, author: { login: "bob" }, headRefName: "feat/y", files: [{ path: "src/a.ts" }] },
      ],
      ["src/a.ts"], new Set(["f"]),
    );
    return out.length === 2 && out[0].kind === "same-symbol" && out[0].author === "alice" && out[1].kind === "same-file";
  });

  t("computeOverlaps ignores a PR touching different files", () =>
    computeOverlaps([{ number: 1, files: [{ path: "other.ts" }] }], ["src/a.ts"], new Set()).length === 0);

  // ── end-to-end over a real tree, both search backends ─────────────────────────
  const scenario = (useRg) => {
    const base = mkdtempSync(join(tmpdir(), "impact-base-"));
    const head = mkdtempSync(join(tmpdir(), "impact-head-"));
    try {
      const common = {
        "package.json": JSON.stringify({ name: "root", dependencies: { stripe: "^16.0.0" } }),
        "tsconfig.json": '{"compilerOptions":{"paths":{"@app/*":["src/*"]}}}',
        "src/jobs/sync.ts": "import { retryRequest } from '../api/client'\nexport async function sync(job) {\n  const r = await retryRequest(job)\n  if (r === null) return\n}\n",
        "src/jobs/other.ts": "import { retryRequest } from '@app/api/client'\nexport const other = () => retryRequest(null)\n",
        "src/api/client.test.ts": "import { retryRequest } from './client'\nit('works', () => retryRequest())\n",
        "src/billing/charge.ts": "import Stripe from 'stripe'\nexport function charge() { return new Stripe('k') }\n",
      };
      writeTree(base, {
        ...common,
        "src/api/client.ts": "export function retryRequest(job) {\n  return null\n}\n",
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/stripe": { version: "14.2.0" } } }),
      });
      writeTree(head, {
        ...common,
        "src/api/client.ts": "export function retryRequest(job, attempts) {\n  throw new RetryExhausted()\n}\n",
        "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/stripe": { version: "16.0.1" } } }),
      });

      const files = [
        { filename: "src/api/client.ts", status: "modified", patch: "@@ -1,3 +1,3 @@\n-export function retryRequest(job) {\n+export function retryRequest(job, attempts) {\n-  return null\n+  throw new RetryExhausted()\n }\n" },
        { filename: "package-lock.json", status: "modified", patch: "@@ -1 +1 @@\n-  \"version\": \"14.2.0\"\n+  \"version\": \"16.0.1\"\n" },
      ];
      return buildGraph({
        files,
        workdir: head,
        readBase: (p) => readIfExists(join(base, p)),
        production: null,
        otherPrs: null,
        opts: { useRg, maxConsumers: 200 },
      });
    } finally {
      rmSync(base, { recursive: true, force: true });
      rmSync(head, { recursive: true, force: true });
    }
  };

  for (const useRg of [true, false]) {
    const label = useRg ? "rg" : "js-fallback";

    t(`[${label}] the changed export is found with its signature change`, () => {
      const g = scenario(useRg);
      const s = g.symbols.find((x) => x.name === "retryRequest");
      return s && s.change === "signature" && s.exported === true && s.path === "src/api/client.ts";
    });

    t(`[${label}] consumers are found across relative AND alias imports`, () => {
      const g = scenario(useRg);
      const s = g.symbols.find((x) => x.name === "retryRequest");
      const paths = s.consumers.map((c) => c.path);
      return paths.includes("src/jobs/sync.ts") && paths.includes("src/jobs/other.ts");
    });

    t(`[${label}] an import line is not counted as a consumer (modules owns import edges)`, () => {
      const g = scenario(useRg);
      const s = g.symbols.find((x) => x.name === "retryRequest");
      return s.consumers.every((c) => c.kind !== "import")
        && s.consumer_files === 3   // sync.ts, other.ts, client.test.ts — call sites only
        && g.modules.find((m) => m.path === "src/api/client.ts").importers === 3;
    });

    t(`[${label}] the defining file is never its own consumer`, () => {
      const g = scenario(useRg);
      const s = g.symbols.find((x) => x.name === "retryRequest");
      return !s.consumers.some((c) => c.path === "src/api/client.ts");
    });

    t(`[${label}] the covering test is found`, () => {
      const g = scenario(useRg);
      const s = g.symbols.find((x) => x.name === "retryRequest");
      return s.covering_tests.includes("src/api/client.test.ts");
    });

    t(`[${label}] importers resolve through a tsconfig alias`, () => {
      const g = scenario(useRg);
      const m = g.modules.find((x) => x.path === "src/api/client.ts");
      return m && m.importer_paths.includes("src/jobs/other.ts") && m.importer_paths.includes("src/jobs/sync.ts");
    });

    t(`[${label}] the lockfile bump is a major delta with its usage site`, () => {
      const g = scenario(useRg);
      const d = g.dependencies.find((x) => x.name === "stripe");
      return d && d.from === "14.2.0" && d.to === "16.0.1" && d.semver_delta === "major"
        && d.direct === true && d.usage_sites.some((u) => u.path === "src/billing/charge.ts");
    });

    t(`[${label}] a changed test file contributes no symbol row`, () => {
      const g = scenario(useRg);
      return !g.symbols.some((s) => TEST_RE.test(s.path));
    });

    t(`[${label}] routing signals carry the facts Phase C keys on`, () => {
      const g = scenario(useRg);
      return g.routing_signals.max_semver_delta === "major"
        && g.routing_signals.structural_change_count === 1
        && ["low", "medium", "high"].includes(g.routing_signals.blast_band);
    });
  }

  t("an empty file list produces a valid, zero graph rather than throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "impact-empty-"));
    try {
      const g = buildGraph({ files: [], workdir: dir, readBase: () => null, production: null, otherPrs: null, opts: { useRg: true, maxConsumers: 200 } });
      return g.symbols.length === 0 && g.blast_radius.band === "none" && g.routing_signals.max_semver_delta === "none";
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch (err) { process.stderr.write(`self-test THREW: ${name}: ${err.message}\n`); }
    if (!ok) { failed++; process.stderr.write(`self-test FAIL: ${name}\n`); }
  }
  if (failed > 0) process.exit(1);
  process.stderr.write(`self-test OK: ${cases.length} cases\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--self-test") return selfTest();

  let input = null;
  const flags = { maxConsumers: 200, useRg: true, useVcs: true };
  try {
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === "--workdir") flags.workdir = argv[++i];
      else if (a === "--base-ref") flags.baseRef = argv[++i];
      else if (a === "--base-dir") flags.baseDir = argv[++i];
      else if (a === "--repo") flags.repo = argv[++i];
      else if (a === "--pr") flags.pr = argv[++i];
      else if (a === "--overlaps") flags.overlaps = argv[++i];
      else if (a === "--production") flags.production = argv[++i];
      else if (a === "--max-consumers") flags.maxConsumers = parseInt(argv[++i], 10);
      else if (a === "--no-rg") flags.useRg = false;
      else if (a === "--no-vcs") flags.useVcs = false;
      else if (a.startsWith("--")) throw new InputError(`unknown flag: ${a}`);
      else if (input === null) input = a;
      else throw new InputError(`unexpected argument: ${a}`);
    }
    if (!input) throw new InputError("usage: build-impact-graph.mjs <pr-files.json> --workdir <dir> [--base-ref sha | --base-dir dir] [--repo o/r --pr n] [--production f] [--overlaps f] [--no-rg] [--no-vcs] | --self-test");
    if (!flags.workdir) throw new InputError("--workdir is required: Phase A must establish a checkout before the graph is built");
    if (!existsSync(flags.workdir)) throw new InputError(`workdir does not exist: ${flags.workdir}`);
    if (!Number.isFinite(flags.maxConsumers) || flags.maxConsumers < 1) throw new InputError("--max-consumers must be a positive integer");

    const files = parseFilesInput(readFileSync(input, "utf8"));
    const production = flags.production ? JSON.parse(readFileSync(flags.production, "utf8")) : null;
    const otherPrs = flags.overlaps
      ? JSON.parse(readFileSync(flags.overlaps, "utf8"))
      : fetchOverlaps({ repo: flags.repo, pr: flags.pr, useVcs: flags.useVcs });

    const graph = buildGraph({
      files,
      workdir: resolve(flags.workdir),
      readBase: makeBaseReader({ baseDir: flags.baseDir, baseRef: flags.baseRef, workdir: resolve(flags.workdir), useVcs: flags.useVcs }),
      production,
      otherPrs,
      opts: { useRg: flags.useRg, maxConsumers: flags.maxConsumers },
    });
    process.stdout.write(`${JSON.stringify(graph, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
