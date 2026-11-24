#!/usr/bin/env node
// reuse-inventory.mjs — list what a diff newly adds, so `fit --inventory` can judge each item.
//
//   node reuse-inventory.mjs [--base <ref>] [--head <ref>] [--json]
//   node reuse-inventory.mjs --self-test
//
// Kinds: file (an added file), export (an exported symbol), component (an exported
// PascalCase symbol in a .jsx/.tsx file), route (an HTTP route or endpoint).
// Deterministic: reads only `git diff <base>...<head>`; never judges, never edits.
// Text output: one `<kind>\t<name>\t<file>:<line>` row per item, then one summary line.
// Exit 0 on success (an empty inventory included), 2 on a git or usage error.

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = /\.(m?[jt]sx?|cjs|py|go)$/;
const SKIP = /(^|\/)(node_modules|dist|build|\.agent|__tests__|__snapshots__)\/|\.(test|spec)\.[^/]+$|(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/;
const HTTP = "get|post|put|patch|delete|head|options|all";

function git(args, cwd) {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

// Names a single added line declares, as [{ kind, name }].
export function declarations(line, file) {
  const out = [];
  const isJsx = /\.[jt]sx$/.test(file);
  const exportKind = (name) => (isJsx && /^[A-Z]/.test(name) ? "component" : "export");
  let m;
  if (/\.(m?[jt]sx?|cjs)$/.test(file)) {
    if ((m = line.match(/^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/))) {
      const name = m[1];
      if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(name) && /(^|\/)app\/.*\/route\.[jt]s$/.test(file)) {
        out.push({ kind: "route", name: `${name} ${nextRoute(file)}` });
      } else out.push({ kind: exportKind(name), name });
    } else if ((m = line.match(/^\s*export\s*\{([^}]*)\}/))) {
      for (const part of m[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop().trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") out.push({ kind: exportKind(name), name });
      }
    }
    // A server registration starts the statement; a client call (`await api.get(…)`) or a string does not.
    if ((m = line.match(new RegExp(`^\\s*(?:app|router|server|fastify|routes)\\.(${HTTP})\\(\\s*["'\`]([^"'\`]+)["'\`]`, "i")))) {
      out.push({ kind: "route", name: `${m[1].toUpperCase()} ${m[2]}` });
    }
  } else if (file.endsWith(".py")) {
    if ((m = line.match(/^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/))) out.push({ kind: "export", name: m[1] });
    if ((m = line.match(new RegExp(`^\\s*@\\w+\\.(${HTTP}|route)\\(\\s*["']([^"']+)["']`, "i")))) {
      out.push({ kind: "route", name: `${m[1] === "route" ? "ROUTE" : m[1].toUpperCase()} ${m[2]}` });
    }
  } else if (file.endsWith(".go")) {
    if ((m = line.match(/^func\s+(?:\([^)]*\)\s*)?([A-Z]\w*)/)) || (m = line.match(/^type\s+([A-Z]\w*)/))) out.push({ kind: "export", name: m[1] });
    if ((m = line.match(/\.(?:HandleFunc|Handle|GET|POST|PUT|PATCH|DELETE)\(\s*"([^"]+)"/))) out.push({ kind: "route", name: m[1] });
  }
  return out;
}

// Next.js app router: app/api/users/[id]/route.ts → /api/users/:id
function nextRoute(file) {
  const dir = dirname(file).replace(/^.*?(^|\/)app(\/|$)/, "/");
  return (dir.replace(/\/\([^)]*\)/g, "").replace(/\[\.{0,3}([^\]]+)\]/g, ":$1") || "/").replace(/\/+/g, "/");
}

export function inventory({ base, head = "HEAD", cwd = process.cwd() }) {
  const range = `${base}...${head}`;
  const items = [];
  // Renames are detected, so a moved file is not reported as a new one.
  const status = git(["diff", "--name-status", "-M", range], cwd).trim().split("\n").filter(Boolean).map((r) => r.split("\t"));
  for (const [code, file] of status) {
    if (code === "A" && !SKIP.test(file)) items.push({ kind: "file", name: file, file, line: 1 });
  }
  const files = status.filter(([c]) => c !== "D").map((r) => r[r.length - 1]);
  const old = status.filter(([c]) => c === "D" || c.startsWith("R")).map((r) => r[1]);
  const removed = new Set();
  const added = [];
  for (const file of [...new Set([...files, ...old])].filter((f) => SOURCE.test(f) && !SKIP.test(f))) {
    const diff = git(["diff", "-U0", "-M", range, "--", file], cwd).split("\n");
    let n = 0;
    let inHunk = false;
    for (const l of diff) {
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (h) { n = Number(h[1]); inHunk = true; continue; }
      if (l.startsWith("diff --git")) { inHunk = false; continue; }
      if (!inHunk) continue;   // file headers (---/+++) sit before the first @@ only
      if (l.startsWith("-")) for (const d of declarations(l.slice(1), file)) removed.add(`${d.kind}\t${d.name}`);
      else if (l.startsWith("+")) { for (const d of declarations(l.slice(1), file)) added.push({ ...d, file, line: n }); n++; }
    }
  }
  // A declaration removed anywhere in the range (moved, or its body changed) is not new.
  for (const d of added) if (!removed.has(`${d.kind}\t${d.name}`)) items.push(d);
  return items;
}

export function render(items) {
  const count = (k) => items.filter((i) => i.kind === k).length;
  const rows = items.map((i) => `${i.kind}\t${i.name}\t${i.file}:${i.line}`);
  rows.push(`inventory: ${items.length} items (files ${count("file")}, exports ${count("export")}, components ${count("component")}, routes ${count("route")})`);
  return rows.join("\n");
}

function selfTest() {
  const fails = [];
  const eq = (label, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  // Unit cases on single lines.
  eq("ts function", declarations("export async function fetchUser(id) {", "src/api.ts"), [{ kind: "export", name: "fetchUser" }]);
  eq("tsx component", declarations("export const SaveButton = () => {", "src/Save.tsx"), [{ kind: "component", name: "SaveButton" }]);
  eq("tsx hook stays export", declarations("export function useSave() {", "src/Save.tsx"), [{ kind: "export", name: "useSave" }]);
  eq("export list", declarations("export { a, b as c };", "src/x.js"), [{ kind: "export", name: "a" }, { kind: "export", name: "c" }]);
  eq("express route", declarations("router.post('/users/:id', handler)", "src/r.js"), [{ kind: "route", name: "POST /users/:id" }]);
  eq("next app route", declarations("export async function GET(req) {", "app/api/users/[id]/route.ts"), [{ kind: "route", name: "GET /api/users/:id" }]);
  eq("python route", declarations("@app.get(\"/items\")", "svc/main.py"), [{ kind: "route", name: "GET /items" }]);
  eq("python private skipped", declarations("def _helper():", "svc/main.py"), []);
  eq("go exported", declarations("func (s *Srv) Serve() error {", "srv.go"), [{ kind: "export", name: "Serve" }]);
  eq("plain line", declarations("const x = 1;", "src/a.ts"), []);
  eq("client call is not a route", declarations("  const u = await api.get('/users/' + id);", "src/User.tsx"), []);
  eq("route in a string is not a route", declarations('  eq("x", declarations("router.post(\'/a\')"));', "src/t.js"), []);
  // End to end on a throwaway repo.
  const dir = mkdtempSync(join(tmpdir(), "reuse-inventory-"));
  try {
    const g = (...a) => git(["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], dir);
    const put = (f, s) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), s); };
    g("init", "-q", "-b", "main");
    put("src/lib.ts", "export function oldHelper() {\n  return 1;\n}\n");
    put("src/moved.ts", "export const kept = 1;\nexport const also = 2;\n");
    g("add", "."); g("commit", "-qm", "base");
    put("src/lib.ts", "export function oldHelper() {\n  return 2;\n}\nexport function newHelper() {}\n");
    put("src/Card.tsx", "export function Card() {\n  return null;\n}\n");
    put("src/Card.test.tsx", "export function fixture() {}\n");
    put("src/server.js", "let i = 0;\n++i;\napp.get('/health', ok);\n");   // ++i must not shift the line count
    g("mv", "src/moved.ts", "src/renamed.ts");                                   // a pure move adds nothing
    g("add", "."); g("commit", "-qm", "change");
    const items = inventory({ base: "HEAD~1", cwd: dir });
    const keys = items.map((i) => `${i.kind} ${i.name} ${i.file}:${i.line}`).sort();
    eq("e2e items", keys, [
      "component Card src/Card.tsx:1",
      "export newHelper src/lib.ts:4",
      "file src/Card.tsx src/Card.tsx:1",
      "file src/server.js src/server.js:1",
      "route GET /health src/server.js:3",
    ]);
    eq("e2e summary", render(items).split("\n").pop(), "inventory: 5 items (files 2, exports 1, components 1, routes 1)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  if (fails.length) { console.error(fails.map((f) => `✗ ${f}`).join("\n")); console.log("reuse-inventory self-test: FAIL"); return 1; }
  console.log("reuse-inventory self-test: PASS");
  return 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  try {
    const head = arg("--head") || "HEAD";
    let base = arg("--base");
    if (!base) base = git(["merge-base", head, "origin/main"]).trim();
    const items = inventory({ base, head });
    console.log(argv.includes("--json") ? JSON.stringify(items, null, 2) : render(items));
    return 0;
  } catch (e) {
    console.error(`reuse-inventory: ${e.message}`);
    return 2;
  }
}

// Run only when executed directly, so importing the exported functions has no side effects.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
