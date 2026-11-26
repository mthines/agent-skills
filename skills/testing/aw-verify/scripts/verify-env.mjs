#!/usr/bin/env node
// verify-env.mjs — which environment proves this diff, and when: the `verify:` block of `.agents/aw/ui.yml`.
//
//   verify:
//     rules:                     # ordered; the first rule whose paths cover EVERY changed file wins
//       - { paths: ['apps/web/**'], env: preview, when: after-pr }
//       - { paths: ['docs/**', '**/*.md'], env: checks }
//     default: { env: checks }   # no rule matched, or no rules; `when` optional
//
// env: preview | local | checks.  when: before-pr | after-pr; default after-pr for preview (it needs the PR's
// deployment), before-pr otherwise. Globs: **, *, ? only — no braces; a directory is `dir/**`, never bare `dir`.
// No `verify:` block → `VERIFY_ENV: none`: the caller keeps its own routing (is-ui-diff, then local or checks).
// A `verify:` block whose rules match nothing and that has no `default` → `none` as well.
//
// INPUTS: --files "a,b" | --base <ref> [--head <ref>] | stdin (newline list), as is-ui-diff.mjs takes them;
//         --ui-yml <path> (default .agents/aw/ui.yml) or --verify-json '<json of the verify block>'.
// OUTPUT: a JSON object, then a last line `VERIFY_ENV: <env|none> [<when>]`. Exit 0 with an answer, 2 on an error
//         (bad args, an unknown env or when, git failure). Read the last line, never the exit code.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./lib/yaml-lite.mjs";

export const ENVS = ["preview", "local", "checks"];
export const WHENS = ["before-pr", "after-pr"];

// Minimal glob → RegExp: ** crosses segments, * and ? stay inside one.
export function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += "(?:.*/)?"; i++; if (glob[i + 1] === "/") i++; else re += ".*"; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}
const covered = (file, globs) => globs.some((g) => globToRe(g).test(file));

function validate(where, env, when) {
  if (!ENVS.includes(env)) throw new Error(`${where}: env "${env}" is not one of ${ENVS.join(", ")}`);
  if (when != null && !WHENS.includes(when)) throw new Error(`${where}: when "${when}" is not one of ${WHENS.join(", ")}`);
}

const defaultWhen = (env) => (env === "preview" ? "after-pr" : "before-pr");
const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]).map(String);

export function chooseEnv(files, verify) {
  const changed = files.map((f) => f.trim().replace(/^\.\//, "")).filter(Boolean);
  if (verify == null) return { env: "none", when: null, source: "no verify block", files: changed.length };
  const rules = verify.rules ?? [];
  if (!Array.isArray(rules)) throw new Error("verify.rules must be a list");
  rules.forEach((r, n) => {
    if (!asList(r?.paths).length) throw new Error(`verify.rules[${n}] has no paths; a fallback goes in verify.default`);
    validate(`verify.rules[${n}]`, r.env, r.when);
  });
  const def = typeof verify.default === "string" ? { env: verify.default } : verify.default;
  if (def != null) validate("verify.default", def.env, def.when);

  if (changed.length) {
    for (const [n, r] of rules.entries()) {
      if (changed.every((f) => covered(f, asList(r.paths)))) {
        return { env: r.env, when: r.when ?? defaultWhen(r.env), source: `rule ${n + 1}`, paths: asList(r.paths), files: changed.length };
      }
    }
  }
  if (def) return { env: def.env, when: def.when ?? defaultWhen(def.env), source: changed.length ? "default (no rule covers every file)" : "default (empty diff)", files: changed.length };
  return { env: "none", when: null, source: "no rule matched and no default", files: changed.length };
}

export const line = (r) => `VERIFY_ENV: ${r.env}${r.when ? ` ${r.when}` : ""}`;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[t.slice(2)] = true;
    else { a[t.slice(2)] = next; i++; }
  }
  return a;
}

function resolveFiles(a) {
  if (typeof a.files === "string") return a.files.split(/[,\n]/);
  if (typeof a.base === "string") {
    const head = typeof a.head === "string" ? a.head : "HEAD";
    return execFileSync("git", ["diff", "--name-only", `${a.base}...${head}`], { encoding: "utf8" }).split("\n");
  }
  if (!process.stdin.isTTY) { try { return readFileSync(0, "utf8").split("\n"); } catch { return []; } }
  return [];
}

function resolveVerify(a) {
  if (typeof a["verify-json"] === "string") return JSON.parse(a["verify-json"]);
  const path = typeof a["ui-yml"] === "string" ? a["ui-yml"] : ".agents/aw/ui.yml";
  if (!existsSync(path)) return null;
  return parseYaml(readFileSync(path, "utf8"))?.verify ?? null;
}

function selfTest() {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } };
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };
  const V = parseYaml([
    "verify:",
    "  rules:",
    "    - paths: ['apps/web/**']",
    "      env: preview",
    "      when: after-pr",
    "    - paths: ['docs/**', '**/*.md']",
    "      env: checks",
    "  default: { env: local }",
  ].join("\n")).verify;

  t("every file under rule 1 → preview after-pr", line(chooseEnv(["apps/web/a.tsx", "apps/web/lib/b.ts"], V)) === "VERIFY_ENV: preview after-pr");
  t("the matching rule is named", chooseEnv(["apps/web/a.tsx"], V).source === "rule 1");
  t("one file outside rule 1 falls through to rule 2 only if rule 2 covers all", line(chooseEnv(["docs/a.md", "README.md"], V)) === "VERIFY_ENV: checks before-pr");
  t("files spanning two rules → default", line(chooseEnv(["apps/web/a.tsx", "docs/a.md"], V)) === "VERIFY_ENV: local before-pr");
  t("first rule wins when two cover the diff", line(chooseEnv(["apps/web/README.md"], V)) === "VERIFY_ENV: preview after-pr");
  t("empty diff → default", chooseEnv([], V).source === "default (empty diff)");
  t("no verify block → none", line(chooseEnv(["apps/web/a.tsx"], null)) === "VERIFY_ENV: none");
  t("default only, no rules, no paths", line(chooseEnv(["x.go"], { default: { env: "preview", when: "after-pr" } })) === "VERIFY_ENV: preview after-pr");
  t("default as a bare string", line(chooseEnv(["x.go"], { default: "checks" })) === "VERIFY_ENV: checks before-pr");
  t("rules with no match and no default → none", line(chooseEnv(["x.go"], { rules: [{ paths: ["web/**"], env: "preview" }] })) === "VERIFY_ENV: none");
  t("a leading ./ is ignored", chooseEnv(["./apps/web/a.tsx"], V).source === "rule 1");
  t("preview with no when runs after the PR", line(chooseEnv(["x.go"], { default: "preview" })) === "VERIFY_ENV: preview after-pr");
  t("an unknown env is an error", throws(() => chooseEnv(["a"], { default: { env: "staging" } })));
  t("an unknown when is an error", throws(() => chooseEnv(["a"], { rules: [{ paths: ["a"], env: "local", when: "later" }] })));
  t("a rule without paths is an error", throws(() => chooseEnv(["a"], { rules: [{ env: "local" }] })));
  t("** matches zero segments", globToRe("apps/**/x.ts").test("apps/x.ts") && globToRe("**/*.md").test("README.md"));
  t("* stays in one segment", !globToRe("apps/*.ts").test("apps/a/b.ts"));
  t("a glob does not match a sibling prefix", !globToRe("apps/web/**").test("apps/website/a.ts"));

  console.log(`verify-env self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a["self-test"]) process.exit(selfTest());
  try {
    const result = chooseEnv(resolveFiles(a), resolveVerify(a));
    console.log(JSON.stringify(result, null, 2));
    console.log(line(result));
  } catch (err) {
    console.error(`verify-env error: ${err.message}`);
    process.exit(2);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (isMainModule()) main();
