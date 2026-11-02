#!/usr/bin/env node
// @ts-check
/**
 * lite-compare.mjs — compare lite's findings with the full pr-reviewer's inline comments on one PR.
 * Deterministic: match by path and line within ±3, one-to-one, no LLM judge. Read-only: the only
 * GitHub call is a `gh api` GET.
 *
 *   node lite-compare.mjs --lite <out>/findings.json (--pr <owner/repo#n|url> | --full <comments.json>) [--full-author <login>]
 *   node lite-compare.mjs --self-test
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const TOLERANCE = 3;

/**
 * Greedy one-to-one match, nearest line first, ties broken by input order.
 * @param {{path:string,line:number}[]} lite
 * @param {{path:string,line:number}[]} full
 */
export function match(lite, full, tolerance = TOLERANCE) {
  /** @type {{l:number,f:number,d:number}[]} */
  const pairs = [];
  lite.forEach((l, li) => full.forEach((f, fi) => {
    const d = Math.abs(l.line - f.line);
    if (l.path === f.path && d <= tolerance) pairs.push({ l: li, f: fi, d });
  }));
  pairs.sort((a, b) => a.d - b.d || a.l - b.l || a.f - b.f);
  const usedL = new Set(); const usedF = new Set();
  /** @type {{lite:any,full:any}[]} */ const overlap = [];
  for (const p of pairs) {
    if (usedL.has(p.l) || usedF.has(p.f)) continue;
    usedL.add(p.l); usedF.add(p.f);
    overlap.push({ lite: lite[p.l], full: full[p.f] });
  }
  return {
    overlap,
    liteOnly: lite.filter((_, i) => !usedL.has(i)),
    fullOnly: full.filter((_, i) => !usedF.has(i)),
  };
}

/** Inline review comments from `gh api` JSON → {path,line,body,author}. Thread replies and outdated comments (no current line) are skipped. */
export function normalizeFull(/** @type {any[]} */ comments, author) {
  return comments
    .filter((c) => !c.in_reply_to_id)
    .map((c) => ({ path: c.path, line: c.line ?? NaN, body: String(c.body || ""), author: c.user?.login || c.author || "" }))
    .filter((c) => c.path && Number.isInteger(c.line) && (!author || c.author === author));
}

export function usageLine(/** @type {any} */ u) {
  if (!u) return "usage: not recorded";
  const s = (/** @type {string} */ k) => u[k] ? `${k}: ${u[k].calls} calls, in ${u[k].input}, cache-read ${u[k].cache_read}, cache-write ${u[k].cache_write}, out ${u[k].output}${u[k].usd != null ? `, $${u[k].usd}` : ""}` : null;
  return [s("review"), s("reflect")].filter(Boolean).join(" · ") || "usage: not recorded";
}

export function renderTable(/** @type {ReturnType<typeof match>} */ m, /** @type {any} */ usage) {
  const l = m.liteOnly.length;
  return [
    "| Bucket | Count |", "|---|---|",
    `| overlap (same path, ±${TOLERANCE} lines) | ${m.overlap.length} |`,
    `| lite-only | ${l} |`,
    `| full-only | ${m.fullOnly.length} |`, "",
    ...m.liteOnly.map((f) => `- lite-only \`${f.path}:${f.line}\` ${f.claim || ""}`.trimEnd()),
    ...m.fullOnly.map((f) => `- full-only \`${f.path}:${f.line}\` ${String(f.body || "").split("\n")[0].slice(0, 120)}`.trimEnd()),
    "", usageLine(usage),
  ].join("\n");
}

function fetchFull(/** @type {string} */ ref) {
  const m = /(?:github\.com\/)?([^/\s#]+\/[^/\s#]+)(?:\/pull\/|#)(\d+)/.exec(ref);
  if (!m) throw new Error(`cannot parse PR reference ${ref}`);
  // `--jq` emits one JSON object per line, so pages never need to be stitched by text replacement.
  const r = spawnSync("gh", ["api", "--paginate", `repos/${m[1]}/pulls/${m[2]}/comments`, "--jq", ".[] | {path, line, in_reply_to_id, body, user: {login: .user.login}}"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh api failed: ${(r.stderr || "").slice(0, 200)}`);
  return r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

function arg(/** @type {string[]} */ a, /** @type {string} */ n) { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; }

async function main(/** @type {string[]} */ argv) {
  if (argv.includes("--self-test")) return (await import("./lite-compare.selftest.mjs")).selfTest();
  const litePath = arg(argv, "--lite");
  if (!litePath) { process.stderr.write("lite-compare: --lite <findings.json> is required\n"); return 2; }
  const lite = JSON.parse(readFileSync(litePath, "utf8")).findings || [];
  const fullPath = arg(argv, "--full");
  const pr = arg(argv, "--pr");
  if (!fullPath && !pr) { process.stderr.write("lite-compare: pass --pr <ref> or --full <comments.json>\n"); return 2; }
  const raw = fullPath ? JSON.parse(readFileSync(fullPath, "utf8")) : fetchFull(/** @type {string} */ (pr));
  const usagePath = join(dirname(litePath), "usage.json");
  const usage = existsSync(usagePath) ? JSON.parse(readFileSync(usagePath, "utf8")) : null;
  process.stdout.write(`${renderTable(match(lite, normalizeFull(raw, arg(argv, "--full-author"))), usage)}\n`);
  return 0;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { process.stderr.write(`lite-compare: ${e?.message || e}\n`); process.exit(1); });
}
