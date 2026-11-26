#!/usr/bin/env node
// login-hook.mjs — signs the repo's test user in for a run, so the agent never handles the credentials.
//
// The agent asks for a session by writing a marker, `.agent/<branch>/verify/needs-login`:
//   {"env":"preview","url":"https://shop-git-feat-x.vercel.app"}
// This script, run by a Claude Code PostToolUse hook after every Bash or Write call, finds the marker and
// runs that environment's `auth.refresh.command` from the committed `.agents/aw/environments.yml`, with
// the variables of the gitignored `.agents/aw/.env.test-user` (TESTING_USERNAME, TESTING_PASSWORD) and
// PREVIEW_URL in the command's environment only. It writes `verify/login-result` (no secret in it), a
// redacted `verify/login-hook.log`, and removes the marker. The agent then reads the result with --wait.
//
// Hook mode (stdin is the hook's JSON; its `cwd` picks the checkout). Always exits 0: a hook that fails
// must never block the agent's tool call; the outcome is in login-result.
//   node login-hook.mjs
// Agent side, after the call that wrote the marker (bounded; polls in Node, no shell sleep):
//   node login-hook.mjs --wait .agent/<branch>/verify [--timeout <seconds>]   → last line LOGIN: ok|failed — …|no-hook
// Manual run over one checkout: node login-hook.mjs --repo <dir>      Self-test: node login-hook.mjs --self-test
//
// The URL is checked before anything runs: a preview URL must be https and its host must match the
// environment's `url.comment.host_pattern` or `url.template`; a local URL must share `url`'s origin.
// The marker is written by an agent that reads untrusted pages, so it never chooses where the
// credentials are typed: the committed config does.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./lib/yaml-lite.mjs";

export const MARKER = "needs-login";
const RUNNING = "needs-login.running";
const RESULT = "login-result";
const LOG = "login-hook.log";
export const ENV_FILE = ".agents/aw/.env.test-user";
const NO_HOOK_GRACE_MS = 5000;

// `verify/needs-login` anywhere under `.agent/` (a branch name holds slashes, so walk a few levels).
export function findMarkers(root, maxDepth = 6) {
  const base = join(root, ".agent");
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name === "verify" && existsSync(join(p, MARKER))) out.push(p);
      else if (depth < maxDepth) walk(p, depth + 1);
    }
  };
  walk(base, 0);
  return out;
}

export function parseMarker(text) {
  const s = String(text).trim();
  if (s.startsWith("{")) return JSON.parse(s);
  const o = {};
  for (const l of s.split("\n")) {
    const m = l.match(/^\s*(env|url)\s*[:=]\s*(.+?)\s*$/);
    if (m) o[m[1]] = m[2];
  }
  return o;
}

export function parseDotenv(text) {
  const o = {};
  for (const raw of String(text).split("\n")) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    o[m[1]] = v;
  }
  return o;
}

// Why a URL may not receive the credentials, or null when it may.
export function urlProblem(envName, envCfg, rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return `"${rawUrl}" is not a URL`; }
  const url = envCfg?.url;
  if (typeof url === "string") {
    let want;
    try { want = new URL(url); } catch { return `environments.${envName}.url is not a URL`; }
    return u.origin === want.origin ? null : `${u.origin} is not environments.${envName}.url (${want.origin})`;
  }
  if (u.protocol !== "https:") return `${u.origin} is not https`;
  const patterns = [];
  if (url?.comment?.host_pattern) patterns.push(new RegExp(`^(?:${url.comment.host_pattern})$`));
  if (typeof url?.template === "string") {
    try {
      const host = new URL(url.template.replace(/\{pr\}/g, "0")).host;
      patterns.push(new RegExp("^" + host.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/0/g, "\\d+") + "$"));
    } catch { /* an unparsable template checks nothing */ }
  }
  if (!patterns.length) return `environments.${envName}.url has no host_pattern or template to check ${u.host} against`;
  return patterns.some((re) => re.test(u.host)) ? null : `${u.host} matches no host_pattern or template of environments.${envName}.url`;
}

const redact = (text, secrets) => secrets.filter((s) => s && s.length >= 3)
  .reduce((t, s) => t.split(s).join("***"), String(text));

const gitRoot = (cwd) => {
  try { return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return cwd; }
};
const gitIgnored = (root, rel) => spawnSync("git", ["check-ignore", "-q", rel], { cwd: root }).status === 0;
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };

// One marker → one login attempt. Returns the result it wrote.
export function handle(root, verifyDir, { envFile = process.env.AW_TEST_USER_ENV_FILE || ENV_FILE } = {}) {
  const marker = join(verifyDir, MARKER), running = join(verifyDir, RUNNING);
  try { renameSync(marker, running); } catch { return null; } // another hook took it
  const write = (status, reason, extra = {}) => {
    const r = { status, reason, at: new Date().toISOString(), ...extra };
    writeFileSync(join(verifyDir, RESULT), JSON.stringify(r) + "\n");
    rmSync(running, { force: true });
    return r;
  };
  let req;
  try { req = parseMarker(readFileSync(running, "utf8")); } catch (e) { return write("failed", `marker unreadable: ${e.message}`); }
  if (!req.env || !req.url) return write("failed", "marker needs env and url");

  const cfgPath = join(root, ".agents/aw/environments.yml");
  if (!existsSync(cfgPath)) return write("failed", "no .agents/aw/environments.yml", { env: req.env });
  let envCfg;
  try { envCfg = parseYaml(readFileSync(cfgPath, "utf8"))?.environments?.[req.env]; } catch (e) { return write("failed", `environments.yml: ${e.message}`, { env: req.env }); }
  if (!envCfg) return write("failed", `no environments.${req.env}`, { env: req.env });
  const refresh = envCfg.auth?.refresh;
  if (!refresh?.command) return write("failed", `no environments.${req.env}.auth.refresh.command`, { env: req.env });
  const bad = urlProblem(req.env, envCfg, req.url);
  if (bad) return write("failed", `url refused: ${bad}`, { env: req.env });

  const envPath = join(root, envFile);
  if (!existsSync(envPath)) return write("failed", `no ${envFile}`, { env: req.env });
  if (!gitIgnored(root, envFile)) return write("failed", `${envFile} is not gitignored; refusing to read it`, { env: req.env });
  const creds = parseDotenv(readFileSync(envPath, "utf8"));

  const state = envCfg.auth?.storage_state ? join(root, envCfg.auth.storage_state) : null;
  const before = state ? mtime(state) : 0;
  const timeout = (Number(refresh.timeout_seconds) || 300) * 1000;
  const run = spawnSync("sh", ["-c", String(refresh.command)], {
    cwd: root, timeout, encoding: "utf8",
    env: { ...process.env, ...creds, PREVIEW_URL: req.url, AUTH_STORAGE_STATE: process.env.AUTH_STORAGE_STATE ?? envCfg.auth?.storage_state ?? "" },
  });
  const secrets = Object.values(creds);
  writeFileSync(join(verifyDir, LOG), redact(`$ refresh.command (env ${req.env}, ${req.url})\n${run.stdout ?? ""}${run.stderr ?? ""}\nexit ${run.status ?? run.signal}\n`, secrets));
  if (run.error?.code === "ETIMEDOUT" || run.signal === "SIGTERM") return write("failed", `refresh.command timed out after ${timeout / 1000}s`, { env: req.env });
  if (run.status !== 0) return write("failed", `refresh.command exited ${run.status}; see ${LOG}`, { env: req.env });
  if (state && mtime(state) <= before) return write("failed", `${envCfg.auth.storage_state} was not refreshed`, { env: req.env });
  return write("ok", "signed in", { env: req.env, storage_state: envCfg.auth?.storage_state ?? null });
}

export function runHook(cwd, opts) {
  const root = gitRoot(cwd);
  return findMarkers(root).map((dir) => handle(root, dir, opts)).filter(Boolean);
}

// The agent's bounded wait: the result, else `no-hook` when the marker sat untouched past a short grace.
export async function waitFor(verifyDir, timeoutS = 360, graceMs = NO_HOOK_GRACE_MS) {
  const start = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (;;) {
    const resultPath = join(verifyDir, RESULT);
    if (existsSync(resultPath)) {
      const r = JSON.parse(readFileSync(resultPath, "utf8"));
      return r.status === "ok" ? "LOGIN: ok" : `LOGIN: failed — ${r.reason}`;
    }
    const elapsed = Date.now() - start;
    if (existsSync(join(verifyDir, MARKER)) && !existsSync(join(verifyDir, RUNNING)) && elapsed >= graceMs) {
      rmSync(join(verifyDir, MARKER), { force: true });
      return "LOGIN: no-hook — the marker was not picked up; use the ! command (auth.md)";
    }
    if (!existsSync(join(verifyDir, MARKER)) && !existsSync(join(verifyDir, RUNNING))) return "LOGIN: failed — no marker and no result";
    if (elapsed >= timeoutS * 1000) return `LOGIN: failed — no result after ${timeoutS}s`;
    await sleep(250);
  }
}

async function selfTest() {
  let pass = 0, fail = 0;
  const t = (name, cond) => { if (cond) pass++; else { fail++; console.error(`FAIL ${name}`); } };
  const dir = mkdtempSync(join(tmpdir(), "login-hook-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    git("init", "-q");
    mkdirSync(join(dir, ".agents/aw"), { recursive: true });
    writeFileSync(join(dir, ".gitignore"), ".agent/\n.agents/aw/.env.test-user\n.auth/\n");
    // The login stand-in writes the state only when the credentials reached it, and echoes them to test redaction.
    const login = `mkdir -p .auth && [ "$TESTING_USERNAME" = e2e@x.dev ] && [ "$TESTING_PASSWORD" = 's3cret pw' ] && echo "user $TESTING_USERNAME pw $TESTING_PASSWORD at $PREVIEW_URL" && date +%s%N > .auth/preview.json`;
    writeFileSync(join(dir, ".agents/aw/environments.yml"), [
      "version: 1", "environments:",
      "  local:", "    url: http://localhost:5173", "    auth:", "      storage_state: .auth/local.json",
      "      refresh: { command: 'mkdir -p .auth && date +%s%N > .auth/local.json' }",
      "  preview:", "    url:", "      from: pr-deployment",
      "      comment: { authors: [\"vercel[bot]\"], host_pattern: 'shop-git-[a-z0-9-]+\\.vercel\\.app' }",
      "    auth:", "      storage_state: .auth/preview.json", "      refresh:", "        when: always",
      `        command: >-\n          sh -c '${login.replace(/'/g, "'\\''")}'`, "        timeout_seconds: 30", "",
    ].join("\n"));
    writeFileSync(join(dir, ENV_FILE), "TESTING_USERNAME=e2e@x.dev\nTESTING_PASSWORD='s3cret pw'\n");
    const vd = join(dir, ".agent/feat/x/verify");
    mkdirSync(vd, { recursive: true });
    const mark = (o) => { rmSync(join(vd, RESULT), { force: true }); writeFileSync(join(vd, MARKER), JSON.stringify(o)); };
    const result = () => JSON.parse(readFileSync(join(vd, RESULT), "utf8"));

    t("no marker: the hook does nothing", runHook(dir).length === 0 && !existsSync(join(vd, RESULT)));
    t("a marker under a branch with a slash is found", (mark({ env: "preview", url: "https://shop-git-feat-x.vercel.app" }), findMarkers(dir).length === 1));
    const [r] = runHook(dir);
    t("preview sign-in succeeds with the env file's credentials", r?.status === "ok" && existsSync(join(dir, ".auth/preview.json")));
    t("the marker is removed", !existsSync(join(vd, MARKER)) && !existsSync(join(vd, RUNNING)));
    const log = readFileSync(join(vd, LOG), "utf8");
    t("the log is redacted", !log.includes("s3cret pw") && !log.includes("e2e@x.dev") && log.includes("***"));
    t("the result holds no secret", !readFileSync(join(vd, RESULT), "utf8").includes("s3cret"));
    t("--wait reads ok", (await waitFor(vd, 2)) === "LOGIN: ok");

    mark({ env: "preview", url: "https://evil.example.com/login" });
    const before = statSync(join(dir, ".auth/preview.json")).mtimeMs;
    runHook(dir);
    t("a host outside host_pattern is refused before the command runs", result().status === "failed" && /url refused/.test(result().reason) && statSync(join(dir, ".auth/preview.json")).mtimeMs === before);
    mark({ env: "preview", url: "http://shop-git-feat-x.vercel.app" });
    runHook(dir);
    t("a preview URL over http is refused", /not https/.test(result().reason));
    mark({ env: "local", url: "http://localhost:5173/sign-in" });
    runHook(dir);
    t("local: the url's origin is accepted", result().status === "ok" && existsSync(join(dir, ".auth/local.json")));
    mark({ env: "local", url: "http://localhost:9999" });
    runHook(dir);
    t("local: another origin is refused", /url refused/.test(result().reason));
    mark({ env: "staging", url: "https://x" });
    runHook(dir);
    t("an unknown environment fails", /no environments.staging/.test(result().reason));
    writeFileSync(join(vd, MARKER), "env: preview\nurl: https://shop-git-a.vercel.app\n");
    rmSync(join(vd, RESULT), { force: true });
    runHook(dir);
    t("a key: value marker is read", result().status === "ok");

    writeFileSync(join(dir, ".gitignore"), ".agent/\n.auth/\n");
    mark({ env: "preview", url: "https://shop-git-feat-x.vercel.app" });
    runHook(dir);
    t("an env file that is not gitignored is never read", /not gitignored/.test(result().reason));
    writeFileSync(join(dir, ".gitignore"), ".agent/\n.agents/aw/.env.test-user\n.auth/\n");

    mark({ env: "preview", url: "https://shop-git-feat-x.vercel.app" });
    t("--wait with no hook installed: no-hook, marker removed", (await waitFor(vd, 2, 0)).startsWith("LOGIN: no-hook") && !existsSync(join(vd, MARKER)));
    writeFileSync(join(vd, RUNNING), "{}");
    t("--wait while the hook runs: bounded by the timeout", (await waitFor(vd, 0.3)).includes("no result after"));
    rmSync(join(vd, RUNNING), { force: true });
    t("a marker already taken is skipped", handle(dir, vd) === null);

    t("dotenv: export, quotes, comments", JSON.stringify(parseDotenv("export A=1\nB=\"x y\" \nC=z # note\n# D=4\n")) === JSON.stringify({ A: "1", B: "x y", C: "z" }));
    t("template host check", urlProblem("preview", { url: { template: "https://shop-pr-{pr}.vercel.app" } }, "https://shop-pr-42.vercel.app") === null
      && urlProblem("preview", { url: { template: "https://shop-pr-{pr}.vercel.app" } }, "https://shop-pr-x.vercel.app") !== null);
    t("no pattern at all: refused", urlProblem("preview", { url: { from: "pr-deployment" } }, "https://a.vercel.app") !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`login-hook self-test: ${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--self-test")) process.exit(await selfTest());
  if (argv.includes("--wait")) {
    const line = await waitFor(opt("--wait"), Number(opt("--timeout")) || 360);
    console.log(line);
    process.exit(line === "LOGIN: ok" ? 0 : 1);
  }
  let cwd = opt("--repo") ?? process.cwd();
  if (!argv.includes("--repo") && !process.stdin.isTTY) {
    try { cwd = JSON.parse(readFileSync(0, "utf8") || "{}").cwd || cwd; } catch { /* not hook JSON: use the process cwd */ }
  }
  try {
    for (const r of runHook(cwd)) console.log(`aw-verify login-hook: ${r.env ?? "?"} ${r.status} — ${r.reason}`);
  } catch (e) {
    console.log(`aw-verify login-hook: error — ${e.message}`);
  }
  process.exit(0);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}
if (isMainModule()) main();
