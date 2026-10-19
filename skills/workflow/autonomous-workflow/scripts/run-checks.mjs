#!/usr/bin/env node
// run-checks.mjs — deterministic runner for `.agent/<branch>/checks.yaml`.
//
//   node run-checks.mjs [checks.yaml] [--cwd <dir>] [--timeout <s>] [--no-write]
//   node run-checks.mjs [checks.yaml] --seal      # record the immutable fields
//   node run-checks.mjs --self-test
//
// Runs each check's `setup` then `run`, compares against `expect`, rewrites the
// `status:` lines in place, and prints exactly one final sentinel line:
//   CHECKS <passed>/<total> PASS (<short-sha>)
//   CHECKS <passed>/<total> FAIL: <ids…>
// Exit 0 only when every check passes. Node >= 20, no dependencies.
//
// `expect` forms: `exit <n>` compares the exit code; `re:<pattern>` (or `re/<flags>:<pattern>`,
// flags from [dgimsuyv]) regex-tests trimmed stdout, and an invalid pattern fails the check;
// anything else, including a value starting with `/`, must equal trimmed stdout exactly.
// `kind: judge` is never executed: it passes only when its status is already `pass`.
// `status: unsatisfiable` is never overwritten and never passes.
// `--seal` writes checks.lock (sha256 of id, requirement, ears, kind, expect per check);
// a later run whose definitions differ from the lock fails every changed or removed check.
// A missing or unreadable checks.lock stops the run before any check executes (exit 2):
// aw-create-plan always seals, so an unsealed checks.yaml is never a valid run.

import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IMMUTABLE = ["id", "requirement", "ears", "kind", "expect"];
const STATUSES = new Set(["pending", "pass", "fail", "unsatisfiable"]);

// ── YAML subset parser: a top-level list of flat maps ────────────────────────
// Supports `- key: value`, `  key: value`, double/single-quoted or plain scalars,
// trailing `# comments` on plain scalars, and `|` / `>` block scalars.
function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = findClosingQuote(v, '"');
    return JSON.parse(v.slice(0, end + 1));
  }
  if (v.startsWith("'")) {
    const end = findClosingQuote(v, "'");
    return v.slice(1, end).replace(/''/g, "'");
  }
  return v.replace(/\s+#.*$/, "").trim();
}
function findClosingQuote(v, q) {
  for (let i = 1; i < v.length; i++) {
    if (q === '"' && v[i] === "\\") { i++; continue; }
    if (v[i] === q) {
      if (q === "'" && v[i + 1] === "'") { i++; continue; }
      return i;
    }
  }
  throw new Error(`unterminated ${q}-quoted scalar: ${v}`);
}

export function parseChecks(text) {
  const lines = text.split("\n");
  const checks = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = line.match(/^-\s+([A-Za-z_][\w-]*):\s?(.*)$/);
    const field = line.match(/^\s{2,}([A-Za-z_][\w-]*):\s?(.*)$/);
    const m = item || field;
    if (!m) throw new Error(`line ${i + 1}: not a "key: value" line: ${line}`);
    if (item) { cur = { _statusLine: -1 }; checks.push(cur); }
    if (!cur) throw new Error(`line ${i + 1}: field outside a list item`);
    const [, key, rest] = m;
    if (/^[|>][-+]?\s*(#.*)?$/.test(rest.trim())) {
      const fold = rest.trim().startsWith(">");
      const keyIndent = item ? 2 : line.match(/^\s*/)[0].length;
      const indentOf = (l) => l.match(/^\s*/)[0].length;
      const body = [];
      while (i + 1 < lines.length && (lines[i + 1].trim() === "" || indentOf(lines[i + 1]) > keyIndent)) body.push(lines[++i]);
      while (body.length && body[body.length - 1].trim() === "") body.pop();
      const strip = Math.min(...body.filter((l) => l.trim()).map(indentOf));
      const block = body.map((l) => l.slice(strip));
      cur[key] = fold ? block.join(" ").trim() : block.join("\n");
    } else {
      cur[key] = unquote(rest);
    }
    if (key === "status") cur._statusLine = i;
  }
  return checks;
}

// ── execution ────────────────────────────────────────────────────────────────
function sh(cmd, cwd, timeoutMs) {
  const r = spawnSync("bash", ["-c", cmd], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  const timedOut = r.error && r.error.code === "ETIMEDOUT";
  return { code: timedOut ? 124 : r.status ?? 1, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), timedOut };
}

export function compare(expect, res) {
  const exit = expect.match(/^exit\s+(-?\d+)$/);
  if (exit) return { ok: res.code === Number(exit[1]), got: `exit ${res.code}` };
  // An explicit `re:` prefix, so a path like `/home/us` is always a literal, never a regex.
  const re = expect.match(/^re(?:\/([dgimsuyv]*))?:(.*)$/s);
  if (re) {
    let rx;
    try { rx = new RegExp(re[2], re[1] ?? ""); }
    catch (e) { return { ok: false, got: clip(res.out), invalid: `invalid regex in expect: ${e.message}` }; }
    return { ok: rx.test(res.out), got: clip(res.out) };
  }
  return { ok: res.out === expect.trim(), got: clip(res.out) };
}
const clip = (s) => (s.length > 120 ? s.slice(0, 117) + "..." : s) || "<empty>";

const fingerprint = (c) => createHash("sha256").update(JSON.stringify(IMMUTABLE.map((k) => c[k] ?? null))).digest("hex").slice(0, 16);

function shortSha(cwd) {
  try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return "no-git"; }
}

function defaultPath(cwd) {
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return join(cwd, ".agent", branch, "checks.yaml");
  } catch { return join(cwd, "checks.yaml"); }
}

export function runChecks({ file, cwd, timeoutMs = 300_000, write = true, log = console.log }) {
  if (!existsSync(file)) return { exit: 2, sentinel: `CHECKS 0/0 FAIL: checks.yaml not found (${file})` };
  const text = readFileSync(file, "utf8");
  let checks;
  try { checks = parseChecks(text); } catch (e) { return { exit: 2, sentinel: `CHECKS 0/0 FAIL: parse error — ${e.message}` }; }
  if (checks.length === 0) return { exit: 1, sentinel: "CHECKS 0/0 FAIL: no checks" };

  const lockFile = join(dirname(file), "checks.lock");
  if (!existsSync(lockFile)) return { exit: 2, sentinel: "CHECKS 0/0 FAIL: checks.lock missing — re-derive and seal via aw-create-plan" };
  let lock;
  try { lock = JSON.parse(readFileSync(lockFile, "utf8")); }
  catch (e) { return { exit: 2, sentinel: `CHECKS 0/0 FAIL: checks.lock unreadable (${e.message})` }; }

  const lines = text.split("\n");
  const failed = [];
  let passed = 0;
  for (const c of checks) {
    const id = c.id || "<no-id>";
    let status;
    let why;
    if (!c.id || !STATUSES.has(c.status ?? "pending")) {
      status = "fail"; why = !c.id ? "missing id" : `unknown status ${c.status}`;
    } else if (lock[c.id] !== fingerprint(c)) {
      status = "fail"; why = "definition changed since --seal (id/requirement/ears/kind/expect are immutable)";
    } else if (c.status === "unsatisfiable") {
      status = "unsatisfiable"; why = "declared unsatisfiable — escalate to the user";
    } else if (c.kind === "judge") {
      status = c.status === "pass" ? "pass" : (c.status || "pending");
      why = status === "pass" ? "judge verdict recorded by the executor" : "judge check has no recorded pass";
    } else if (!c.run || c.expect === undefined) {
      status = "fail"; why = "missing run or expect";
    } else {
      const setup = (c.setup || "none").trim();
      const s = setup === "none" ? { code: 0 } : sh(setup, cwd, timeoutMs);
      if (s.code !== 0) { status = "fail"; why = `setup exited ${s.code}${s.err ? `: ${clip(s.err)}` : ""}`; }
      else {
        const r = sh(c.run, cwd, timeoutMs);
        const cmp = compare(String(c.expect), r);
        status = cmp.ok ? "pass" : "fail";
        why = cmp.invalid ?? `expect ${JSON.stringify(String(c.expect))}, got ${JSON.stringify(cmp.got)}${r.timedOut ? " (timed out)" : ""}`;
      }
    }
    log(`${id} ${status} — ${why}`);
    if (status === "pass") passed++; else failed.push(id);
    const writable = c.kind !== "judge" && c.status !== "unsatisfiable" && (status === "pass" || status === "fail");
    if (writable && c._statusLine >= 0) lines[c._statusLine] = lines[c._statusLine].replace(/(status:\s*)[^\s#]+/, `$1${status}`);
  }
  // A sealed check deleted from checks.yaml is a failure, not a silent pass.
  const present = new Set(checks.map((c) => c.id));
  const dropped = Object.keys(lock).filter((id) => !present.has(id));
  for (const id of dropped) {
    log(`${id} fail — sealed check removed from checks.yaml (only aw-create-plan may re-seal)`);
    failed.push(id);
  }
  if (write) writeFileSync(file, lines.join("\n"));
  const total = checks.length + dropped.length;
  return failed.length === 0
    ? { exit: 0, sentinel: `CHECKS ${passed}/${total} PASS (${shortSha(cwd)})` }
    : { exit: 1, sentinel: `CHECKS ${passed}/${total} FAIL: ${failed.join(" ")}` };
}

export function seal(file) {
  const checks = parseChecks(readFileSync(file, "utf8"));
  const lock = Object.fromEntries(checks.map((c) => [c.id, fingerprint(c)]));
  writeFileSync(join(dirname(file), "checks.lock"), JSON.stringify(lock, null, 2) + "\n");
  return `sealed ${checks.length} check(s) → ${join(dirname(file), "checks.lock")}`;
}

// ── self-test ────────────────────────────────────────────────────────────────
function selfTest() {
  const self = fileURLToPath(import.meta.url);
  const dir = mkdtempSync(join(tmpdir(), "run-checks-"));
  const fails = [];
  const expectEq = (name, got, want) => { if (got !== want) fails.push(`${name}: want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
  const cli = (args) => spawnSync(process.execPath, [self, ...args], { cwd: dir, encoding: "utf8" });
  const last = (out) => out.trim().split("\n").pop();
  try {
    const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], { cwd: dir, stdio: "ignore" });
    git("init", "-q"); git("commit", "-q", "--allow-empty", "-m", "init");
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();

    const mixed = [
      "# fixture — comments and blank lines are ignored",
      "- id: AC-1",
      "  requirement: R1",
      '  ears: "When asked, the system shall print 401"',
      "  kind: command",
      '  setup: "none"',
      "  run: \"echo 401\"",
      '  expect: "401"',
      "  status: pending   # pending | pass | fail | unsatisfiable",
      "- id: AC-2",
      "  requirement: R1",
      "  kind: command",
      "  setup: none",
      "  run: 'exit 3'",
      "  expect: exit 3",
      "  status: fail",
      "- id: AC-3",
      "  requirement: R2",
      "  kind: grep",
      '  setup: "printf \'hello world\\n\' > f.txt"',
      "  run: cat f.txt",
      '  expect: "re:^hello w.rld$"',
      "  status: pending",
      "- id: AC-4",
      "  requirement: R2",
      "  kind: command",
      "  setup: none",
      "  run: echo 500",
      '  expect: "401"',
      "  status: pending",
      "- id: AC-5",
      "  requirement: R3",
      "  kind: command",
      "  setup: exit 9",
      "  run: echo never",
      "  expect: never",
      "  status: pending",
      "- id: AC-6",
      "  requirement: R3",
      "  kind: judge",
      '  ears: "copy tone is friendly"',
      "  expect: friendly",
      "  status: pending",
      "- id: AC-7",
      "  requirement: R3",
      "  kind: command",
      "  run: echo ok",
      "  expect: ok",
      "  status: unsatisfiable",
      "- id: AC-8",
      "  requirement: R4",
      "  kind: command",
      "  setup: none",
      "  run: |",
      "    printf 'a\\n'",
      "    printf 'b\\n'",
      "  expect: \"re:a\\\\nb\"",
      "  status: pending",
      "",
    ].join("\n");
    writeFileSync(join(dir, "checks.yaml"), mixed);
    // A checks.yaml with no checks.lock is a runner error: no check runs, the file is untouched.
    let r = cli(["checks.yaml"]);
    expectEq("no lock: exit code", r.status, 2);
    expectEq("no lock: one sentinel line", r.stdout.split("\n").filter((l) => /^CHECKS /.test(l)).length, 1);
    expectEq("no lock: sentinel", last(r.stdout), "CHECKS 0/0 FAIL: checks.lock missing — re-derive and seal via aw-create-plan");
    expectEq("no lock: file untouched", readFileSync(join(dir, "checks.yaml"), "utf8"), mixed);

    cli(["checks.yaml", "--seal"]);
    r = cli(["checks.yaml"]);
    expectEq("mixed: exit code", r.status, 1);
    expectEq("mixed: sentinel", last(r.stdout), "CHECKS 4/8 FAIL: AC-4 AC-5 AC-6 AC-7");
    const after = readFileSync(join(dir, "checks.yaml"), "utf8");
    const statuses = parseChecks(after).map((c) => `${c.id}=${c.status}`).join(" ");
    expectEq("mixed: rewritten statuses", statuses,
      "AC-1=pass AC-2=pass AC-3=pass AC-4=fail AC-5=fail AC-6=pending AC-7=unsatisfiable AC-8=pass");
    expectEq("mixed: only status lines change",
      after.split("\n").filter((l) => !/^\s+status:/.test(l)).join("\n"),
      mixed.split("\n").filter((l) => !/^\s+status:/.test(l)).join("\n"));
    if (!/status: pass {3}# pending/.test(after)) fails.push("mixed: trailing comment on a status line was not preserved");

    const green = [
      "- id: AC-1", "  kind: command", "  setup: none", "  run: echo 401", '  expect: "401"', "  status: pending",
      "- id: AC-2", "  kind: judge", "  expect: friendly", "  status: pass", "",
    ].join("\n");
    writeFileSync(join(dir, "green.yaml"), green);
    r = cli(["green.yaml", "--seal"]);
    expectEq("seal: exit code", r.status, 0);
    r = cli(["green.yaml"]);
    expectEq("green: exit code", r.status, 0);
    expectEq("green: sentinel", last(r.stdout), `CHECKS 2/2 PASS (${sha})`);

    // An executor that edits an immutable field after --seal is caught, even when the new expect would pass.
    writeFileSync(join(dir, "green.yaml"), green.replace('expect: "401"', 'expect: "re:40"'));
    r = cli(["green.yaml"]);
    expectEq("tamper: exit code", r.status, 1);
    expectEq("tamper: sentinel", last(r.stdout), "CHECKS 1/2 FAIL: AC-1");
    rmSync(join(dir, "checks.lock"));

    // A sealed check deleted from checks.yaml fails by id instead of vanishing from the count.
    writeFileSync(join(dir, "green.yaml"), green);
    cli(["green.yaml", "--seal"]);
    writeFileSync(join(dir, "green.yaml"), green.split("- id: AC-2")[0]);
    r = cli(["green.yaml"]);
    expectEq("removed: exit code", r.status, 1);
    expectEq("removed: sentinel", last(r.stdout), "CHECKS 1/2 FAIL: AC-2");

    // An unreadable checks.lock is a runner error with a sentinel, not an uncaught throw.
    writeFileSync(join(dir, "checks.lock"), "{not json");
    r = cli(["green.yaml"]);
    expectEq("corrupt lock: exit code", r.status, 2);
    expectEq("corrupt lock: sentinel prefix", last(r.stdout).startsWith("CHECKS 0/0 FAIL: checks.lock unreadable"), true);
    rmSync(join(dir, "checks.lock"));

    writeFileSync(join(dir, "green.yaml"), green);
    cli(["green.yaml", "--seal"]);
    r = cli(["green.yaml", "--no-write"]);
    expectEq("no-write: leaves file untouched", readFileSync(join(dir, "green.yaml"), "utf8").includes("status: pending"), true);

    r = cli(["missing.yaml"]);
    expectEq("missing: exit code", r.status, 2);
    expectEq("missing: sentinel prefix", last(r.stdout).startsWith("CHECKS 0/0 FAIL: checks.yaml not found"), true);

    writeFileSync(join(dir, "bad.yaml"), "- id: AC-1\nnot yaml at all\n");
    r = cli(["bad.yaml"]);
    expectEq("parse error: exit code", r.status, 2);
    expectEq("parse error: sentinel prefix", last(r.stdout).startsWith("CHECKS 0/0 FAIL: parse error"), true);

    // A path-like expect is a literal because it has no `re:` prefix.
    writeFileSync(join(dir, "path.yaml"), ["- id: AC-1", "  kind: command", "  run: echo /usr/bin/node", "  expect: /usr/bin/node", "  status: pending", ""].join("\n"));
    cli(["path.yaml", "--seal"]);
    r = cli(["path.yaml"]);
    expectEq("path expect: exit code", r.status, 0);
    expectEq("path expect: sentinel", last(r.stdout), `CHECKS 1/1 PASS (${sha})`);

    // `re:` is the only regex form: plain, flagged, a slash-led literal, and an invalid pattern.
    const one = (name, out, expect) => ["- id: " + name, "  kind: command", `  run: echo ${out}`, `  expect: '${expect}'`, "  status: pending", ""].join("\n");
    writeFileSync(join(dir, "re.yaml"), one("AC-1", "hello", "re:^he") + one("AC-2", "hello", "re/i:^HE"));
    cli(["re.yaml", "--seal"]);
    r = cli(["re.yaml"]);
    expectEq("re expect: exit code", r.status, 0);
    expectEq("re expect: sentinel", last(r.stdout), `CHECKS 2/2 PASS (${sha})`);
    writeFileSync(join(dir, "slash.yaml"), one("AC-1", "/home/other", "/home/us"));
    cli(["slash.yaml", "--seal"]);
    r = cli(["slash.yaml"]);
    expectEq("slash literal: exit code", r.status, 1);
    expectEq("slash literal: sentinel", last(r.stdout), "CHECKS 0/1 FAIL: AC-1");
    writeFileSync(join(dir, "badre.yaml"), one("AC-1", "x", "re:("));
    cli(["badre.yaml", "--seal"]);
    r = cli(["badre.yaml"]);
    expectEq("invalid regex: exit code", r.status, 1);
    expectEq("invalid regex: one sentinel line", r.stdout.split("\n").filter((l) => /^CHECKS /.test(l)).length, 1);
    expectEq("invalid regex: sentinel", last(r.stdout), "CHECKS 0/1 FAIL: AC-1");
    expectEq("invalid regex: reason", /AC-1 fail — invalid regex in expect: /.test(r.stdout), true);

    // Exactly one sentinel line per run.
    cli(["checks.yaml", "--seal"]);
    const sentinels = cli(["checks.yaml", "--no-write"]).stdout.split("\n").filter((l) => /^CHECKS /.test(l));
    expectEq("one sentinel line", sentinels.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (fails.length) { console.error(fails.map((f) => `✗ ${f}`).join("\n")); console.log("run-checks self-test: FAIL"); return 1; }
  console.log("run-checks self-test: PASS");
  return 0;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  let file, cwd = process.cwd(), timeout = 300, write = true, doSeal = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cwd") cwd = resolve(argv[++i]);
    else if (a === "--timeout") timeout = Number(argv[++i]);
    else if (a === "--no-write") write = false;
    else if (a === "--seal") doSeal = true;
    else if (a === "-h" || a === "--help") { console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 23).join("\n")); return 0; }
    else if (a.startsWith("--")) { console.log(`CHECKS 0/0 FAIL: unknown option ${a}`); return 2; }
    else file = resolve(cwd, a);
  }
  file ??= defaultPath(cwd);
  if (doSeal) {
    if (!existsSync(file)) { console.error(`no such file: ${file}`); return 2; }
    console.log(seal(file));
    return 0;
  }
  const { exit, sentinel } = runChecks({ file, cwd, timeoutMs: timeout * 1000, write });
  console.log(sentinel);
  return exit;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
