#!/usr/bin/env node
// is-ui-diff.mjs — deterministic "does this change touch the UI?" gate.
//
// WHY THIS EXISTS
// The old create-pr Step 6.4 heuristic was prose an agent eyeballed mid-run
// ("no changed file matches *.tsx, *.jsx, …"), which under-fired two ways: the
// agent had to remember to run it at all, and the glob list was web-JS-only, so
// a UI change shipped through .ts / Lit / .html / .astro / a component dir went
// unrecorded. This script makes the decision mechanical and identical for every
// caller (create-pr, aw-planner, review-loop), and lets each repo teach it what
// "UI" means via a learned surface, falling back to broad defaults so a repo
// with no learnings yet still gets a correct answer.
//
// IT IS A CLASSIFIER, NOT A GATE ITS CALLERS CANNOT SEE:
// it prints a JSON object and a final `UI_DIFF: yes|no` line to stdout and
// exits 0 for both answers. Exit 2 is a real error (bad args, git failure).
// Read the `UI_DIFF:` line, or parse the JSON — never infer the answer from a
// non-zero exit.
//
// INPUTS (first present wins):
//   --files "a.tsx,b.ts"      explicit comma/newline list of changed paths
//   --base <ref> [--head <r>] compute via `git diff --name-only <base>...<head>`
//   (stdin, newline list)     when neither flag is given and stdin is piped
//
// SURFACE (optional, this is the "learned per repo" layer):
//   --surface-file <path>     JSON file with the repo's UI surface
//   --surface-json '<json>'   the same JSON inline (what an agent passes after
//                             reading it from LoreKit — the CLI cannot call an
//                             MCP tool, so the agent fetches and forwards it)
//   Surface shape (every field optional):
//     { "mode": "extend" | "replace",   // default "extend" (merge with defaults)
//       "extensions": [".ts", ".css"],  // count these extensions ANYWHERE
//       "dirExtensions": [".ts", ".js"],// count these ONLY under a ui dir
//       "dirs": ["src/ui", "widgets"],  // path segments that mark ui code
//       "globs": ["**/*.stories.*"],    // extra explicit globs that count
//       "exclude": ["legacy/**"] }      // globs that never count, even if ui
//
// EXIT: 0 (answer printed), 2 (error).

import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// ── Defaults: broad enough that a fresh repo is served, narrow enough that a
// backend .ts does not read as UI. Framework-view and style extensions always
// count; the ambiguous script extensions count only under a ui directory. A
// repo's learned surface refines both (e.g. a frontend-only app can promote
// .ts to `extensions`; a monorepo can pin `dirs` to its web package). ──
const DEFAULTS = {
  // Almost-always-UI: a change to one of these is a visual change wherever it lives.
  extensions: [
    ".tsx", ".jsx", ".vue", ".svelte", ".astro",
    ".css", ".scss", ".sass", ".less", ".styl",
    ".mdx", ".html", ".htm",
  ],
  // Ambiguous on their own — count only when the path is under a UI directory.
  dirExtensions: [".ts", ".js", ".mjs", ".cjs"],
  // Path segments that mark UI code. Matched segment-wise (a real path part),
  // never as a bare substring, so `apps/` never matches the `app` segment.
  dirs: [
    "components", "component", "pages", "page", "app", "routes", "route",
    "layouts", "layout", "views", "view", "screens", "screen",
    "ui", "widgets", "styles", "style", "theme", "themes", "design-system",
    "stories", "storybook",
  ],
  globs: ["**/*.stories.*"],
  // Never-UI even when the extension/dir matches: tests, type decls, snapshots.
  // Deliberately conservative — config JSON is NOT excluded, because a design-
  // token file is a real UI change. A caller that wants config excluded adds it
  // to the surface `exclude`.
  exclude: [
    "**/*.test.*", "**/*.spec.*", "**/*.d.ts",
    "**/__tests__/**", "**/__mocks__/**", "**/__snapshots__/**",
    "**/e2e/**", "**/*.stories.test.*",
  ],
};

// ── Minimal glob → RegExp (supports ** , * , ? ; segment-aware). No deps. ──
function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // ** matches across path separators (optionally the following slash)
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*"; // * stays within a segment
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}
const matchesAnyGlob = (path, globs) => globs.some((g) => globToRe(g).test(path));

function hasDirSegment(path, dirs) {
  const segs = path.split("/").slice(0, -1); // directory parts only
  const wanted = new Set(dirs.map((d) => d.toLowerCase()));
  // Support multi-segment dir entries (e.g. "src/ui"), matched at segment
  // boundaries — never as a bare substring, so "src/ui" does not match
  // "xsrc/ui/…". Anchoring both ends with "/" enforces the boundary.
  const anchored = ("/" + path + "/").toLowerCase();
  for (const d of dirs) {
    if (d.includes("/") && anchored.includes("/" + d.toLowerCase() + "/")) return true;
  }
  return segs.some((s) => wanted.has(s.toLowerCase()));
}

const extOf = (path) => {
  const base = path.split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
};

function mergeSurface(defaults, surface) {
  if (!surface) return { ...defaults, _source: "default" };
  if (surface.mode === "replace") {
    return {
      extensions: surface.extensions ?? [],
      dirExtensions: surface.dirExtensions ?? [],
      dirs: surface.dirs ?? [],
      globs: surface.globs ?? [],
      exclude: surface.exclude ?? [],
      _source: "surface (replace)",
    };
  }
  const uniq = (a, b) => Array.from(new Set([...(a ?? []), ...(b ?? [])]));
  return {
    extensions: uniq(defaults.extensions, surface.extensions),
    dirExtensions: uniq(defaults.dirExtensions, surface.dirExtensions),
    dirs: uniq(defaults.dirs, surface.dirs),
    globs: uniq(defaults.globs, surface.globs),
    exclude: uniq(defaults.exclude, surface.exclude),
    _source: "surface (extend defaults)",
  };
}

// Returns { counts: bool, reason: string } for one path.
function classifyFile(path, S) {
  if (matchesAnyGlob(path, S.exclude)) return { counts: false, reason: "excluded" };
  if (matchesAnyGlob(path, S.globs)) return { counts: true, reason: "glob" };
  const ext = extOf(path);
  if (S.extensions.includes(ext)) return { counts: true, reason: `ext ${ext}` };
  if (S.dirExtensions.includes(ext) && hasDirSegment(path, S.dirs))
    return { counts: true, reason: `ext ${ext} under ui dir` };
  if (hasDirSegment(path, S.dirs) && ext === "") return { counts: false, reason: "dir but no ext" };
  return { counts: false, reason: "no match" };
}

export function classify(files, surface) {
  const S = mergeSurface(DEFAULTS, surface);
  const clean = files.map((f) => f.trim()).filter(Boolean);
  const matched = [];
  for (const f of clean) {
    const r = classifyFile(f, S);
    if (r.counts) matched.push({ path: f, reason: r.reason });
  }
  return {
    isUI: matched.length > 0,
    matched,
    considered: clean.length,
    source: S._source,
  };
}

// ── CLI plumbing ──
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) a[key] = true;
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function resolveFiles(args) {
  if (args.files && args.files !== true) return String(args.files).split(/[,\n]/);
  if (args.base && args.base !== true) {
    const head = args.head && args.head !== true ? String(args.head) : "HEAD";
    const out = execFileSync("git", ["diff", "--name-only", `${args.base}...${head}`], {
      encoding: "utf8",
    });
    return out.split("\n");
  }
  const piped = readStdin();
  if (piped.trim()) return piped.split("\n");
  return [];
}

function resolveSurface(args) {
  if (args["surface-json"] && args["surface-json"] !== true)
    return JSON.parse(String(args["surface-json"]));
  if (args["surface-file"] && args["surface-file"] !== true)
    return JSON.parse(readFileSync(String(args["surface-file"]), "utf8"));
  return null;
}

// ── Self-test: the free bite-proof. Run `node is-ui-diff.mjs --self-test`. ──
function selfTest() {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.error(`FAIL ${name}`); } };

  t("a .tsx counts anywhere", classify(["src/anything/Button.tsx"]).isUI);
  t("a backend .ts does NOT count by default", !classify(["src/server/db/query.ts"]).isUI);
  t("a .ts UNDER a ui dir counts", classify(["src/components/useThing.ts"]).isUI);
  t("a .css counts anywhere", classify(["src/server/reset.css"]).isUI);
  t("a .test.tsx is excluded", !classify(["src/components/Button.test.tsx"]).isUI);
  t("a .stories.tsx counts (glob)", classify(["src/components/Button.stories.tsx"]).isUI);
  t("a .d.ts is excluded even under ui", !classify(["src/components/types.d.ts"]).isUI);
  t("a plain .md doc does NOT count", !classify(["docs/guide.md"]).isUI);
  t("an .astro counts", classify(["site/pages/index.astro"]).isUI);
  t("empty list is not UI", !classify([]).isUI);
  t("segment match, not substring: apps/ != app", !classify(["apps/api/handler.ts"]).isUI);
  t("multi-segment surface dir 'src/ui' matches",
    classify(["src/ui/thing.ts"], { dirs: ["src/ui"] }).isUI);
  t("multi-segment dir 'src/ui' does NOT match 'xsrc/ui/…' (segment boundary)",
    !classify(["xsrc/ui/thing.ts"], { mode: "replace", dirExtensions: [".ts"], dirs: ["src/ui"] }).isUI);
  t("surface can promote .ts to always-UI (extend)",
    classify(["server/x.ts"], { extensions: [".ts"] }).isUI);
  t("surface replace mode drops defaults",
    !classify(["src/components/Button.tsx"], { mode: "replace", extensions: [".foo"] }).isUI);
  t("surface exclude wins over a ui match",
    !classify(["legacy/components/Old.tsx"], { exclude: ["legacy/**"] }).isUI);
  t("source is 'default' with no surface", classify(["a.tsx"]).source === "default");
  t("source names the surface when given",
    classify(["a.tsx"], { dirs: ["x"] }).source.startsWith("surface"));
  t("matched carries a reason", classify(["a.tsx"]).matched[0].reason.startsWith("ext"));

  console.log(`is-ui-diff self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["self-test"]) process.exit(selfTest());
  try {
    const files = resolveFiles(args);
    const surface = resolveSurface(args);
    const result = classify(files, surface);
    console.log(JSON.stringify(result, null, 2));
    console.log(`UI_DIFF: ${result.isUI ? "yes" : "no"}`);
    process.exit(0);
  } catch (err) {
    console.error(`is-ui-diff error: ${err.message}`);
    process.exit(2);
  }
}

// Run main only as a CLI, not when imported for the self-test's `classify`.
// Resolve BOTH sides through realpath before comparing. This script is invoked
// through a symlink chain (~/.claude/skills/ui-verify → ~/.agents/skills → repo),
// so process.argv[1] is the SYMLINK path while Node's ESM loader has already
// realpath-resolved import.meta.url to the repo path — a direct compare never
// matches and main() silently never runs. realpathSync collapses the symlink,
// and fileURLToPath decodes percent-encoding, so a path with spaces matches too.
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isMainModule()) main();
