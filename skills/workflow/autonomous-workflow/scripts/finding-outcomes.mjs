#!/usr/bin/env node
// finding-outcomes.mjs — what humans did with each quality-pass finding, and per-type precision.
//
//   node finding-outcomes.mjs --findings <quality-findings.jsonl> --later <ref> [--cwd <repo>]
//   node finding-outcomes.mjs --record --repo <owner/name> --pr <n> [--model <id>]
//                             (--findings <file> --later <ref> | --events-from <classified.json>)
//   node finding-outcomes.mjs --precision <events.json | -> [--json]
//   node finding-outcomes.mjs --fp <type> <path> [<symbol>]
//   node finding-outcomes.mjs --self-test
//
// Classify: each finding is `acted` (the diff head_sha..later changes the flagged symbol or lines),
// `dismissed` (the path survives and the diff does not touch them), or `unknown` (head_sha, the
// later ref, or the path is missing, or the finding names neither a symbol nor a line).
// Deterministic: reads only git; never asks a model, never reads a confidence or severity.
// Record: one LoreKit bus memory per classified finding; no credentials or a failed write prints a
// `Degraded:` line and still exits 0. Precision: acted / (acted + dismissed) per type.
// Exit 0 on success, 2 on a usage or input error.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** A type is `eligible` only at or above this precision… (a starting point, see references/finding-outcomes.md) */
export const PRECISION_THRESHOLD = 0.6;
/** …and with at least this many decided (acted + dismissed) events. */
export const MIN_SAMPLE = 10;
/** Lines either side of a finding's `line` that still count as touching it. */
export const LINE_WINDOW = 3;
/** Bus events must outlive the time a type needs to reach MIN_SAMPLE across PRs. */
export const TTL_DAYS = 180;
export const TAG = "loop::quality-finding-outcomes";
export const KEY_PREFIX = "quality-finding-outcomes::";
/** Pinned: the CLI's command surface is this file's contract; 1.77.0 added `--attributes`. */
export const LOREKIT_CLI = "@lorekit/cli@1.78.0";
const LOREKIT_DEFAULT_ENDPOINT = "https://pqokxlhvnosogizsjztg.supabase.co/functions/v1/mcp";
const REQUIRED = ["fp", "type", "path", "head_sha", "summary"];

function git(args, cwd) {
  const r = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A finding's fingerprint: stable across runs because it hashes only what names the finding, never its line or wording. */
export function fingerprint(type, path, symbol = "") {
  return createHash("sha256").update(`${type}\n${path}\n${symbol}`).digest("hex").slice(0, 16);
}

/** Parse quality-findings.jsonl; a malformed or incomplete line is an input error, never skipped. */
export function parseFindings(text) {
  const out = [];
  text.split("\n").forEach((raw, i) => {
    if (!raw.trim()) return;
    let f;
    try { f = JSON.parse(raw); } catch { throw new Error(`line ${i + 1}: not JSON`); }
    const missing = REQUIRED.filter((k) => typeof f[k] !== "string" || !f[k]);
    if (missing.length) throw new Error(`line ${i + 1}: missing ${missing.join(", ")}`);
    out.push(f);
  });
  return out;
}

/** Hunks of `git diff -U0` as old-side ranges plus every changed line's text. */
export function parseDiff(diff) {
  const hunks = [];
  const changed = [];
  for (const line of diff.split("\n")) {
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/);
    if (m) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // A pure insertion (count 0) sits after `start`; treat it as touching that one line.
      hunks.push({ start, end: count === 0 ? start + 1 : start + count - 1 });
    } else if (/^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line)) changed.push(line.slice(1));
  }
  return { hunks, changed };
}

/**
 * Classify one finding against `later`.
 * @returns {{ outcome: "acted"|"dismissed"|"unknown", reason: string, later_path?: string }}
 */
export function classify(f, later, cwd) {
  if (!git(["cat-file", "-e", `${f.head_sha}^{commit}`], cwd).ok) return { outcome: "unknown", reason: "head_sha not in repo" };
  if (!git(["cat-file", "-e", `${later}^{commit}`], cwd).ok) return { outcome: "unknown", reason: "later ref not in repo" };
  if (!git(["cat-file", "-e", `${f.head_sha}:${f.path}`], cwd).ok) return { outcome: "unknown", reason: "path not at head_sha" };
  const hasLine = Number.isInteger(f.line) && f.line > 0;
  if (!f.symbol && !hasLine) return { outcome: "unknown", reason: "finding names neither symbol nor line" };

  // Follow a rename; a deleted path cannot say which way the reviewer went.
  const status = git(["diff", "--name-status", "-M", f.head_sha, later], cwd).out.split("\n").map((r) => r.split("\t"));
  let laterPath = f.path;
  for (const [code, a, b] of status) {
    if (a !== f.path) continue;
    if (code === "D") return { outcome: "unknown", reason: "path deleted" };
    if (code && code.startsWith("R")) laterPath = b;
  }
  const d = git(["diff", "-U0", "-M", f.head_sha, later, "--", f.path, laterPath], cwd);
  if (!d.ok) return { outcome: "unknown", reason: `git diff failed: ${d.err}` };
  const { hunks, changed } = parseDiff(d.out);
  const base = laterPath === f.path ? {} : { later_path: laterPath };

  if (f.symbol) {
    const word = new RegExp(`(^|[^\\w$])${escapeRe(f.symbol)}([^\\w$]|$)`);
    if (changed.some((l) => word.test(l))) return { outcome: "acted", reason: `a changed line names ${f.symbol}`, ...base };
    const atHead = git(["show", `${f.head_sha}:${f.path}`], cwd).out;
    if (!hasLine && !word.test(atHead)) return { outcome: "unknown", reason: "symbol not in path at head_sha", ...base };
  }
  if (hasLine) {
    const lo = f.line - LINE_WINDOW;
    const hi = f.line + LINE_WINDOW;
    if (hunks.some((h) => h.start <= hi && h.end >= lo)) return { outcome: "acted", reason: `a hunk touches lines ${Math.max(1, lo)}-${hi}`, ...base };
  }
  return { outcome: "dismissed", reason: "the flagged symbol and lines are unchanged", ...base };
}

export function classifyAll(findings, later, cwd) {
  return findings.map((f) => {
    const c = classify(f, later, cwd);
    return { fp: f.fp, type: f.type, path: f.path, ...(f.symbol ? { symbol: f.symbol } : {}), ...(f.line ? { line: f.line } : {}), ...(f.model ? { model: f.model } : {}), head_sha: f.head_sha, later, ...c };
  });
}

// ── Precision ─────────────────────────────────────────────────────────────────────

/** An event as read back from LoreKit (an entry whose `value` is the JSON body) or a bare event. */
function eventOf(e) {
  if (e && typeof e.value === "string") { try { return JSON.parse(e.value); } catch { return null; } }
  if (e && e.value && typeof e.value === "object") return e.value;
  return e;
}

/** Events from a JSON array, or from every `entries` array in a `lorekit list --json` / MCP `memory.list` result. */
export function collectEvents(input) {
  if (Array.isArray(input)) return input;
  const out = [];
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "entries" && Array.isArray(v)) out.push(...v); else walk(v);
    }
  };
  walk(input);
  return out;
}

export function precision(rawEvents) {
  const seen = new Map();
  for (const raw of rawEvents) {
    const e = eventOf(raw);
    if (!e || typeof e.type !== "string" || typeof e.outcome !== "string") continue;
    // One vote per finding per PR: a re-recorded finding replaces its earlier event.
    seen.set(e.repo && e.pr && e.fp ? `${e.repo}#${e.pr}:${e.fp}` : Symbol(), e);
  }
  const byType = new Map();
  for (const e of seen.values()) {
    const t = byType.get(e.type) || { type: e.type, acted: 0, dismissed: 0, unknown: 0 };
    if (e.outcome === "acted" || e.outcome === "dismissed") t[e.outcome] += 1; else t.unknown += 1;
    byType.set(e.type, t);
  }
  return [...byType.values()].map((t) => {
    const n = t.acted + t.dismissed;
    const p = n ? t.acted / n : null;
    return { ...t, n, precision: p, eligible: p !== null && p >= PRECISION_THRESHOLD && n >= MIN_SAMPLE };
  }).sort((a, b) => a.type.localeCompare(b.type));
}

export function renderPrecision(rows) {
  const lines = [`type\tacted/(acted+dismissed)\tprecision\tunknown\tstatus`];
  for (const r of rows) {
    const status = r.eligible ? "eligible" : r.n < MIN_SAMPLE ? `insufficient (n<${MIN_SAMPLE})` : `below ${PRECISION_THRESHOLD}`;
    lines.push(`${r.type}\t${r.acted}/${r.n}\t${r.precision === null ? "-" : r.precision.toFixed(2)}\t${r.unknown}\t${status}`);
  }
  lines.push(`precision: ${rows.length} types, ${rows.filter((r) => r.eligible).length} eligible (threshold ${PRECISION_THRESHOLD}, n >= ${MIN_SAMPLE})`);
  return lines.join("\n");
}

// ── LoreKit bus ───────────────────────────────────────────────────────────────────

export function lorekitEnv(env = process.env) {
  const token = env.LOREKIT_API_KEY || env.LOREKIT_TOKEN;
  if (!token) return null;
  return { ...env, LOREKIT_TOKEN: token, LOREKIT_MCP_URL: env.LOREKIT_MCP_URL || env.LOREKIT_ENDPOINT || LOREKIT_DEFAULT_ENDPOINT, LOREKIT_TELEMETRY: "0" };
}

/** The bus record for one classified finding: scope, key, value, attributes. */
export function busRecord(c, { repo, pr, model, now = new Date().toISOString() }) {
  const m = c.model || model || "unknown";
  const value = { v: 1, repo, pr, fp: c.fp, type: c.type, outcome: c.outcome, reason: c.reason, model: m, path: c.path, ...(c.symbol ? { symbol: c.symbol } : {}), head_sha: c.head_sha, later: c.later, recorded_at: now };
  return {
    scope: `repo::${repo}`,
    key: `${KEY_PREFIX}${pr}:${c.fp}`,
    value,
    attributes: { repo, pr: Number(pr), type: c.type, outcome: c.outcome, model: m },
  };
}

/** argv of one write — never a shell string, since keys and values carry file paths and PR text. */
export function lorekitWriteArgs(rec) {
  return [
    "write", "--scope", rec.scope, "--key", rec.key, "--value", JSON.stringify(rec.value),
    "--tags", TAG, "--kind", "bus", "--host", "aw", "--ttl-days", String(TTL_DAYS),
    "--attributes", JSON.stringify(rec.attributes), "--origin-pr", String(rec.attributes.pr),
    "--source-agent", "finding-outcomes", "--remote", "--json",
  ];
}

export function record(classified, opts, { env = process.env, run } = {}) {
  const lk = lorekitEnv(env);
  if (!lk) return { written: 0, degraded: "Degraded: quality finding outcomes — not recorded (LOREKIT_API_KEY not set)" };
  const exec = run || ((args) => execFileSync("npx", ["--yes", LOREKIT_CLI, ...args], { env: lk, encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] }));
  let written = 0;
  const failed = [];
  for (const c of classified) {
    try { exec(lorekitWriteArgs(busRecord(c, opts))); written += 1; }
    catch (err) { failed.push(`${c.fp}: ${String(err.stderr || err.message).trim().split("\n").pop()}`); }
  }
  return { written, ...(failed.length ? { degraded: `Degraded: quality finding outcomes — ${failed.length} of ${classified.length} not recorded (${failed[0]})` } : {}) };
}

// ── CLI ───────────────────────────────────────────────────────────────────────────

function readInput(p) { return p === "-" ? readFileSync(0, "utf8") : readFileSync(p, "utf8"); }

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  if (argv[0] === "--fp") {
    if (argv.length < 3) { console.error("finding-outcomes: --fp needs <type> <path> [<symbol>]"); return 2; }
    console.log(fingerprint(argv[1], argv[2], argv[3] || ""));
    return 0;
  }
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--findings") opts.findings = argv[++i];
    else if (a === "--later") opts.later = argv[++i];
    else if (a === "--cwd") opts.cwd = argv[++i];
    else if (a === "--repo") opts.repo = argv[++i];
    else if (a === "--pr") opts.pr = argv[++i];
    else if (a === "--model") opts.model = argv[++i];
    else if (a === "--events-from") opts.eventsFrom = argv[++i];
    else if (a === "--precision") opts.precision = argv[++i];
    else if (a === "--record") opts.record = true;
    else if (a === "--json") opts.json = true;
    else { console.error(`finding-outcomes: unknown argument ${a}`); return 2; }
  }
  try {
    if (opts.precision) {
      const text = readInput(opts.precision).trim();
      const rows = precision(collectEvents(text ? JSON.parse(text) : []));
      console.log(opts.json ? JSON.stringify(rows, null, 2) : renderPrecision(rows));
      return 0;
    }
    if (opts.record && (!opts.repo || !opts.pr)) throw new Error("--record needs --repo and --pr");
    if (opts.record && !lorekitEnv()) {
      console.log("Degraded: quality finding outcomes — not recorded (LOREKIT_API_KEY not set)");
      return 0;
    }
    let classified;
    if (opts.eventsFrom) {
      const text = readInput(opts.eventsFrom).trim();
      const parsed = text ? JSON.parse(text) : { outcomes: [] };
      classified = Array.isArray(parsed) ? parsed : parsed.outcomes || [];
    } else {
      if (!opts.findings || !opts.later) throw new Error("needs --findings <file> and --later <ref>");
      classified = classifyAll(parseFindings(readInput(opts.findings)), opts.later, opts.cwd || process.cwd());
    }
    if (!opts.record) {
      console.log(JSON.stringify({ later: opts.later, outcomes: classified }, null, 2));
      return 0;
    }
    const r = record(classified, opts);
    console.log(`recorded: ${r.written} of ${classified.length} finding outcomes`);
    if (r.degraded) console.log(r.degraded);
    return 0;
  } catch (e) {
    console.error(`finding-outcomes: ${e.message}`);
    return 2;
  }
}

// ── Self-test ─────────────────────────────────────────────────────────────────────

function selfTest() {
  const fails = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); };
  const dir = mkdtempSync(join(tmpdir(), "finding-outcomes-"));
  const sh = (...args) => { const r = git(args, dir); if (!r.ok) throw new Error(`git ${args.join(" ")}: ${r.err}`); return r.out.trim(); };
  try {
    sh("init", "-q", "-b", "main");
    sh("config", "user.email", "t@example.com"); sh("config", "user.name", "t"); sh("config", "commit.gpgsign", "false");
    const body = (n) => Array.from({ length: n }, (_, i) => `// filler ${i + 1}`).join("\n");
    writeFileSync(join(dir, "lib.ts"), `export function newHelper() { return 1; }\nexport function keepMe() { return 2; }\n${body(20)}\n`);
    writeFileSync(join(dir, "ui.tsx"), `${body(30)}\n`);
    writeFileSync(join(dir, "gone.ts"), `export const dropped = 1;\n`);
    writeFileSync(join(dir, "moved.ts"), `export function movedFn() { return 3; }\n${body(10)}\n`);
    sh("add", "-A"); sh("commit", "-qm", "head");
    const head = sh("rev-parse", "HEAD");
    // The human's follow-up: replace newHelper, edit ui.tsx line 5, delete gone.ts, rename moved.ts.
    writeFileSync(join(dir, "lib.ts"), `export function keepMe() { return 2; }\n${body(20)}\n`);
    writeFileSync(join(dir, "ui.tsx"), `${body(30).replace("// filler 5\n", "// filler five\n")}\n`);
    rmSync(join(dir, "gone.ts"));
    sh("mv", "moved.ts", "renamed.ts");
    sh("add", "-A"); sh("commit", "-qm", "later");
    const later = sh("rev-parse", "HEAD");

    const line = (o) => JSON.stringify({ head_sha: head, summary: "s", ...o });
    const findings = parseFindings([
      line({ fp: "a", type: "reuse", path: "lib.ts", symbol: "newHelper" }),
      line({ fp: "b", type: "extend", path: "lib.ts", symbol: "keepMe" }),
      line({ fp: "c", type: "ux:focus-visible", path: "ui.tsx", line: 6 }),
      line({ fp: "d", type: "ux:copy", path: "ui.tsx", line: 25 }),
      line({ fp: "e", type: "reuse", path: "gone.ts", symbol: "dropped" }),
      line({ fp: "f", type: "extend", path: "moved.ts", symbol: "movedFn" }),
      line({ fp: "g", type: "ux:copy", path: "ui.tsx" }),
      line({ fp: "h", type: "reuse", path: "nope.ts", symbol: "x" }),
      JSON.stringify({ fp: "i", type: "reuse", path: "lib.ts", symbol: "keepMe", head_sha: "0".repeat(40), summary: "s" }),
    ].join("\n"));
    const got = Object.fromEntries(classifyAll(findings, later, dir).map((c) => [c.fp, c.outcome]));
    eq("classify", got, { a: "acted", b: "dismissed", c: "acted", d: "dismissed", e: "unknown", f: "dismissed", g: "unknown", h: "unknown", i: "unknown" });
    eq("rename followed", classify(findings[5], later, dir).later_path, "renamed.ts");
    eq("later ref missing", classify(findings[0], "no-such-ref", dir).outcome, "unknown");
    eq("deterministic", classifyAll(findings, later, dir), classifyAll(findings, later, dir));

    eq("fp stable and line-free", fingerprint("reuse", "lib.ts", "newHelper"), fingerprint("reuse", "lib.ts", "newHelper"));
    eq("fp separates symbols", fingerprint("reuse", "lib.ts", "a") === fingerprint("reuse", "lib.ts", "b"), false);
    let threw = false;
    try { parseFindings(`{"fp":"x","type":"reuse"}`); } catch { threw = true; }
    eq("incomplete line rejected", threw, true);
  } catch (e) {
    fails.push(`git fixture: ${e.message}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // Precision: threshold, minimum sample, unknown excluded, re-record deduplicated, LoreKit entry shape.
  const ev = (type, outcome, i, extra = {}) => ({ repo: "o/r", pr: 1, fp: `${type}-${i}`, type, outcome, ...extra });
  const events = [];
  for (let i = 0; i < 10; i++) events.push(ev("reuse", i < 6 ? "acted" : "dismissed", i));
  for (let i = 0; i < 10; i++) events.push(ev("extend", i < 5 ? "acted" : "dismissed", i));
  for (let i = 0; i < 9; i++) events.push(ev("ux:copy", "acted", i));
  events.push(ev("ux:copy", "unknown", 99));
  events.push({ value: JSON.stringify(ev("reuse", "acted", 0)) }); // re-recorded as a LoreKit entry: replaces, not adds
  eq("lorekit list shape", collectEvents({ offline: { groups: [{ entries: [{ value: "{}" }] }] }, remote: { groups: [{ entries: [{ value: "{}" }] }] } }).length, 2);
  const rows = Object.fromEntries(precision(events).map((r) => [r.type, [r.acted, r.n, r.eligible, r.unknown]]));
  eq("precision", rows, { extend: [5, 10, false, 0], reuse: [6, 10, true, 0], "ux:copy": [9, 9, false, 1] });

  // Recording: no credentials degrades; a failing write degrades; the argv carries attributes and TTL.
  const c = { fp: "a", type: "reuse", outcome: "acted", reason: "r", path: "lib.ts", head_sha: "h", later: "l" };
  eq("no credentials", record([c], { repo: "o/r", pr: "7" }, { env: {} }).degraded, "Degraded: quality finding outcomes — not recorded (LOREKIT_API_KEY not set)");
  const calls = [];
  const ok = record([c], { repo: "o/r", pr: "7", model: "m1" }, { env: { LOREKIT_API_KEY: "k" }, run: (a) => calls.push(a) });
  eq("written", ok, { written: 1 });
  const a = calls[0] || [];
  eq("key", a[a.indexOf("--key") + 1], "quality-finding-outcomes::7:a");
  eq("ttl", a[a.indexOf("--ttl-days") + 1], "180");
  eq("attributes", JSON.parse(a[a.indexOf("--attributes") + 1] || "{}"), { repo: "o/r", pr: 7, type: "reuse", outcome: "acted", model: "m1" });
  const bad = record([c], { repo: "o/r", pr: "7" }, { env: { LOREKIT_API_KEY: "k" }, run: () => { throw new Error("boom"); } });
  eq("write failure degrades", bad.written === 0 && /^Degraded: /.test(bad.degraded || ""), true);

  if (fails.length) { console.error(fails.map((f) => `✗ ${f}`).join("\n")); console.log("finding-outcomes self-test: FAIL"); return 1; }
  console.log("finding-outcomes self-test: PASS");
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
