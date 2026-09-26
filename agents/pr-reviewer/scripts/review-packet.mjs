#!/usr/bin/env node
// @ts-check
/**
 * review-packet.mjs — one file a finder or verifier reads instead of the raw diff plus a dozen
 * workspace reads (A/B iteration 4, speed).
 *
 * Why this exists
 * ---------------
 * On sync-tray#72 every review arm spent 45–65 tool calls, and wall time tracked the call count
 * almost linearly (~10 s per model turn). About half of those calls were context assembly: reading
 * the 5,260-line diff in chunks, then opening each changed file around each hunk to see the code
 * the three-line diff context hides, then re-reading to get a line number to cite. None of that is
 * judgment. This script does it once, deterministically, before any model turn:
 *
 *   - the PR description (the intent finder's input) at the top;
 *   - a priority-ordered file index — source first, then config, docs, tests, generated — with
 *     each file's line range IN THE PACKET, so a worker can read one file's section by offset;
 *   - every hunk rendered against the HEAD file with CONTEXT lines on each side and the head's own
 *     line numbers on every line, so a candidate cites `path:line` straight from the packet —
 *     those numbers are RIGHT-side numbers, which is what line-validity checks;
 *   - removed lines shown in place, unnumbered.
 *
 * It never decides what to review. A file that does not fit the line cap degrades — context →
 * diff only → listed only — and the index says which, so "not shown" can never read as "not
 * changed". A worker still opens the workspace for anything the packet does not show (a caller, a
 * definition, a file listed only).
 *
 * Usage
 *   node review-packet.mjs --context <context.json> [--out <file>] [--max-lines N] [--context-lines N]
 *   node review-packet.mjs --self-test
 *
 * prepare-review.mjs imports `buildReviewPacket` and writes the packet next to context.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const DEFAULT_MAX_LINES = 9000;
export const DEFAULT_CONTEXT_LINES = 10;
const DESCRIPTION_MAX_CHARS = 8000;
const REMOVED_FILE_MAX_LINES = 60;

/** Role order is the packet order: what a finder needs first comes first. */
export const ROLES = ["source", "config", "docs", "test", "generated"];

/**
 * Classify a path by role. Pure, path-only — never reads the file.
 * @param {string} p
 * @returns {"source"|"config"|"docs"|"test"|"generated"}
 */
export function classifyRole(p) {
  const path = String(p);
  const base = basename(path);
  if (/\.pbxproj$|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|Podfile\.lock|Gemfile\.lock|poetry\.lock|composer\.lock)$|\.min\.(js|css)$|\.snap$|(^|\/)(generated|__generated__)\/|\.generated\.|\.pb\.go$|_pb2\.py$/.test(path)) {
    return "generated";
  }
  if (/(^|\/)(test|tests|__tests__|spec|specs|e2e)\/|\.(test|spec)\.[^/]+$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$|(Tests?|Spec|SelfTest)\.(swift|kt|java|cs|m)$/.test(path)) {
    return "test";
  }
  if (/\.(md|mdx|rst|txt|adoc)$/i.test(base) || /(^|\/)docs?\//.test(path)) return "docs";
  if (/\.(ya?ml|json|toml|ini|cfg|conf|plist|xml|env)$/i.test(base) || /(^|\/)\.github\//.test(path) || /^(Dockerfile|Makefile)$/.test(base)) {
    return "config";
  }
  return "source";
}

/**
 * Parse a unified-diff `patch` (GitHub's files[].patch — hunks only, no file header) into hunks.
 * @param {string} patch
 * @returns {Array<{ oldStart: number, newStart: number, newCount: number, lines: Array<{ t: " "|"+"|"-", text: string, newNo: number|null }> }>}
 */
export function parsePatch(patch) {
  /** @type {any[]} */
  const hunks = [];
  /** @type {any} */
  let cur = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of String(patch || "").split("\n")) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (m) {
      cur = { oldStart: Number(m[1]), newStart: Number(m[3]), newCount: m[4] === undefined ? 1 : Number(m[4]), lines: [] };
      hunks.push(cur);
      oldNo = Number(m[1]);
      newNo = Number(m[3]);
      continue;
    }
    if (!cur || raw.startsWith("\\")) continue;
    const t = raw[0];
    const text = raw.slice(1);
    if (t === "+") { cur.lines.push({ t: "+", text, newNo }); newNo += 1; }
    else if (t === "-") { cur.lines.push({ t: "-", text, newNo: null }); oldNo += 1; }
    else if (t === " " || raw === "") { cur.lines.push({ t: " ", text, newNo }); newNo += 1; oldNo += 1; }
  }
  return hunks;
}

const pad = (/** @type {number|null} */ n) => String(n).padStart(5, " ");

/**
 * Render one file's hunks. With `headLines` (the head file's content) each hunk is widened by
 * `ctx` lines on both sides and overlapping windows merge; without it the patch renders as-is.
 * Every rendered head line carries its head line number; removed lines render in place, unnumbered.
 * @param {{ patch: string, headLines?: string[]|null, ctx?: number }} a
 * @returns {string[]}
 */
export function renderHunks({ patch, headLines = null, ctx = DEFAULT_CONTEXT_LINES }) {
  const hunks = parsePatch(patch);
  if (!hunks.length) return [];
  if (!headLines) {
    /** @type {string[]} */
    const out = [];
    hunks.forEach((h, i) => {
      if (i > 0) out.push("     ⋮");
      for (const l of h.lines) out.push(l.t === "-" ? `     |-${l.text}` : `${pad(l.newNo)}|${l.t === "+" ? "+" : " "}${l.text}`);
    });
    return out;
  }
  /** @type {Set<number>} */
  const added = new Set();
  /** @type {Map<number, string[]>} removed lines keyed by the head line they precede */
  const removedBefore = new Map();
  /** @type {Array<[number, number]>} */
  const windows = [];
  for (const h of hunks) {
    /** @type {string[]} */
    let pending = [];
    for (const l of h.lines) {
      if (l.t === "-") { pending.push(l.text); continue; }
      if (pending.length) { removedBefore.set(/** @type {number} */ (l.newNo), [...(removedBefore.get(/** @type {number} */ (l.newNo)) || []), ...pending]); pending = []; }
      if (l.t === "+") added.add(/** @type {number} */ (l.newNo));
    }
    const endNo = h.newStart + Math.max(h.newCount, 1) - 1;
    if (pending.length) {
      // A trailing deletion: attach it after the hunk's last head line.
      const key = endNo + 1;
      removedBefore.set(key, [...(removedBefore.get(key) || []), ...pending]);
    }
    windows.push([Math.max(1, h.newStart - ctx), Math.min(headLines.length + 1, endNo + ctx)]);
  }
  windows.sort((a, b) => a[0] - b[0]);
  /** @type {Array<[number, number]>} */
  const merged = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1] + 1) last[1] = Math.max(last[1], w[1]);
    else merged.push([w[0], w[1]]);
  }
  /** @type {string[]} */
  const out = [];
  merged.forEach(([s, e], i) => {
    if (i > 0) out.push("     ⋮");
    for (let n = s; n <= e; n++) {
      for (const r of removedBefore.get(n) || []) out.push(`     |-${r}`);
      if (n <= headLines.length) out.push(`${pad(n)}|${added.has(n) ? "+" : " "}${headLines[n - 1]}`);
    }
  });
  return out;
}

/**
 * Build the packet. Pure apart from reading head files under `workspaceDir` (when given).
 * @param {{
 *   title?: string, body?: string, repo?: string, number?: number|string, headSha?: string,
 *   files: Array<{ filename: string, status?: string, additions?: number, deletions?: number, patch?: string }>,
 *   consumers?: Record<string, number>, workspaceDir?: string|null,
 *   maxLines?: number, ctx?: number,
 * }} a
 */
export function buildReviewPacket(a) {
  const maxLines = a.maxLines ?? DEFAULT_MAX_LINES;
  const ctx = a.ctx ?? DEFAULT_CONTEXT_LINES;
  const consumers = a.consumers || {};
  const files = (a.files || []).map((f) => ({
    ...f,
    role: classifyRole(f.filename),
    changed: (f.additions || 0) + (f.deletions || 0),
    consumers: consumers[f.filename] || 0,
  }));
  files.sort((x, y) => ROLES.indexOf(x.role) - ROLES.indexOf(y.role)
    || y.consumers - x.consumers || y.changed - x.changed || x.filename.localeCompare(y.filename));

  const readHead = (/** @type {string} */ p) => {
    if (!a.workspaceDir) return null;
    const full = join(a.workspaceDir, p);
    if (!existsSync(full)) return null;
    try { return readFileSync(full, "utf8").split("\n"); } catch { return null; }
  };

  // Render every file at its richest form first, then degrade from the lowest priority up until
  // the whole packet fits: full context → diff only → listed only.
  /** @type {any[]} */
  const sections = files.map((f) => {
    const form = { full: /** @type {string[]|null} */ (null), diff: /** @type {string[]|null} */ (null), note: "" };
    if (f.role === "generated") return { f, form, mode: "listed", note: "generated file — read from the workspace if a finding needs it" };
    if (!f.patch) {
      return { f, form, mode: "listed", note: f.status === "removed" ? "removed — no patch from GitHub" : "no patch from GitHub (binary or too large) — read from the workspace" };
    }
    if (f.status === "removed") {
      const lines = renderHunks({ patch: f.patch });
      const shown = lines.slice(0, REMOVED_FILE_MAX_LINES);
      if (lines.length > shown.length) shown.push(`     … ${lines.length - shown.length} more removed lines`);
      form.diff = shown;
      return { f, form, mode: "diff", note: "removed file" };
    }
    form.diff = renderHunks({ patch: f.patch });
    const head = f.role === "test" ? null : readHead(f.filename);
    if (head) form.full = renderHunks({ patch: f.patch, headLines: head, ctx });
    return { f, form, mode: form.full ? "full" : "diff", note: head || f.role === "test" ? "" : "head file not in workspace — diff only" };
  });

  const lengthOf = (/** @type {any} */ sec) => (sec.mode === "full" ? sec.form.full.length : sec.mode === "diff" ? sec.form.diff.length : 0) + (sec.mode === "listed" ? 0 : 4);
  const total = () => sections.reduce((n, s) => n + lengthOf(s), 0);
  for (let i = sections.length - 1; i >= 0 && total() > maxLines; i--) {
    const s = sections[i];
    if (s.mode === "full") { s.mode = "diff"; s.note = "context dropped to fit the packet cap"; }
  }
  for (let i = sections.length - 1; i >= 0 && total() > maxLines; i--) {
    const s = sections[i];
    if (s.mode === "diff") { s.mode = "listed"; s.note = "not inlined (packet cap) — read the diff or the workspace file"; }
  }

  const header = [
    `# Review packet — ${a.repo || "?"}#${a.number ?? "?"} @ ${(a.headSha || "").slice(0, 7)}`,
    "",
    "Generated by `review-packet.mjs`. Line numbers are the PR head's (RIGHT side) — cite them directly.",
    "`NNNNN|+` added · `NNNNN| ` unchanged context · `     |-` removed · `⋮` gap. Open a workspace file only for",
    "code this packet does not show: a caller, a definition, or a file marked *listed* below.",
    "",
    "## PR description",
    "",
    `**${a.title || "(no title)"}**`,
    "",
    ...String(a.body || "(no description)").slice(0, DESCRIPTION_MAX_CHARS).split("\n"),
    ...(String(a.body || "").length > DESCRIPTION_MAX_CHARS ? ["", `… description truncated at ${DESCRIPTION_MAX_CHARS} characters`] : []),
    "",
  ];

  // The index needs each section's line range, which depends on the index's own length — build the
  // index rows first with placeholders of a fixed width, then fill the ranges in.
  const rows = sections.map((s, i) => ({ s, i }));
  const indexHead = ["## Files", "", "| # | Path | Status | +/− | Role | Consumers | In packet | Packet lines |", "|---|---|---|---|---|---|---|---|"];
  const indexLen = indexHead.length + rows.length + 1;
  let cursor = header.length + indexLen + 1; // 1-based line numbers of the packet file
  /** @type {string[]} */
  const bodyOut = [];
  /** @type {string[]} */
  const ranges = [];
  for (const { s } of rows) {
    if (s.mode === "listed") { ranges.push("—"); continue; }
    const lines = s.mode === "full" ? s.form.full : s.form.diff;
    const start = cursor;
    const block = [`## ${s.f.filename}`, "", "```text", ...lines, "```"];
    bodyOut.push(...block, "");
    cursor += block.length + 1;
    ranges.push(`${start}–${cursor - 2}`);
  }
  const indexRows = rows.map(({ s, i }) => `| ${i + 1} | \`${s.f.filename}\` | ${s.f.status || "modified"} | +${s.f.additions || 0} −${s.f.deletions || 0} | ${s.f.role} | ${s.f.consumers || "—"} | ${s.mode}${s.note ? ` (${s.note})` : ""} | ${ranges[i]} |`);
  const text = [...header, ...indexHead, ...indexRows, "", ...bodyOut].join("\n");

  /** @type {Record<string, number>} */
  const stats = { full: 0, diff: 0, listed: 0 };
  for (const s of sections) stats[s.mode] += 1;
  return { text, lines: text.split("\n").length, files: stats, maxLines, contextLines: ctx };
}

/**
 * The `consumers` map from an impact graph: per changed file, the largest consumer count of any
 * symbol it changes. Pure.
 * @param {any} impact
 */
export function consumersByFile(impact) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const s of impact?.symbols || []) {
    if (!s || typeof s.path !== "string") continue;
    out[s.path] = Math.max(out[s.path] || 0, Number(s.consumer_count) || 0);
  }
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

/** @param {string} p */
function readJsonl(p) {
  const raw = readFileSync(p, "utf8").trim();
  if (raw.startsWith("[")) return JSON.parse(raw);
  return raw.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

/** @param {string[]} argv */
async function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const opt = (/** @type {string} */ name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const ctxPath = opt("--context");
  if (!ctxPath) {
    console.error("usage: review-packet.mjs --context <context.json> [--out <file>] [--max-lines N] [--context-lines N] | --self-test");
    process.exit(2);
  }
  const context = JSON.parse(readFileSync(ctxPath, "utf8"));
  const files = readJsonl(context.paths?.files || context.filesPath);
  const impactPath = context.paths?.impact;
  const impact = impactPath && existsSync(impactPath) ? JSON.parse(readFileSync(impactPath, "utf8")) : null;
  const packet = buildReviewPacket({
    title: context.meta?.title, body: context.meta?.body, repo: context.target?.repo, number: context.target?.number,
    headSha: context.headSha, files, consumers: consumersByFile(impact), workspaceDir: context.workspace?.dir || null,
    maxLines: opt("--max-lines") ? Number(opt("--max-lines")) : undefined,
    ctx: opt("--context-lines") ? Number(opt("--context-lines")) : undefined,
  });
  const out = opt("--out") || join(dirname(ctxPath), "review-packet.md");
  writeFileSync(out, packet.text, "utf8");
  console.log(JSON.stringify({ path: out, lines: packet.lines, files: packet.files }));
}

// ── self-test ─────────────────────────────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  check("roles: source, test, docs, config, generated",
    classifyRole("src/api/client.ts") === "source" && classifyRole("src/api/client.test.ts") === "test"
      && classifyRole("SyncTray/Services/ConfigSelfTest.swift") === "test" && classifyRole("CLAUDE.md") === "docs"
      && classifyRole(".github/workflows/ci.yml") === "config" && classifyRole("App.xcodeproj/project.pbxproj") === "generated"
      && classifyRole("pnpm-lock.yaml") === "generated");

  // A 30-line head file; the patch replaces line 10 and adds line 20 (head numbering).
  const head = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  head[9] = "line 10 NEW";
  head[19] = "line 20 ADDED";
  const patch = [
    "@@ -8,5 +8,5 @@ fn",
    " line 8", " line 9", "-line 10 OLD", "+line 10 NEW", " line 11", " line 12",
    "@@ -18,4 +18,5 @@ fn",
    " line 18", " line 19", "+line 20 ADDED", " line 21", " line 22",
  ].join("\n");
  const hunks = parsePatch(patch);
  check("parsePatch numbers added and context lines on the head side",
    hunks.length === 2 && hunks[0].lines.find((l) => l.t === "+")?.newNo === 10 && hunks[1].lines.find((l) => l.t === "+")?.newNo === 20);

  const bare = renderHunks({ patch });
  check("without a head file the patch renders as-is, numbered, with a gap between hunks",
    bare.includes("   10|+line 10 NEW") && bare.includes("     |-line 10 OLD") && bare.includes("     ⋮"));

  const wide = renderHunks({ patch, headLines: head, ctx: 3 });
  check("with a head file each hunk widens by ctx lines on both sides",
    wide[0] === "    5| line 5" && wide.includes("   23| line 23") && !wide.includes("    4| line 4"));
  check("the removed line renders in place, just before the head line that replaced it",
    wide.indexOf("     |-line 10 OLD") === wide.indexOf("   10|+line 10 NEW") - 1);
  const apart = renderHunks({ patch, headLines: head, ctx: 2 });
  check("windows that do not touch stay separate; a gap marker separates them",
    apart.includes("     ⋮") && !apart.includes("   15| line 15"));
  const merged = renderHunks({ patch, headLines: head, ctx: 6 });
  check("overlapping windows merge into one block (no gap marker)", !merged.includes("     ⋮"));
  check("every head line number matches the head file's own content",
    wide.filter((l) => /^\s*\d+\|/.test(l)).every((l) => {
      const m = /^\s*(\d+)\|[+ ](.*)$/.exec(l);
      return m && head[Number(m[1]) - 1] === m[2];
    }));

  const dir = mkdtempSync(join(tmpdir(), "packet-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/a.ts"), head.join("\n"));
  const files = [
    { filename: "docs/guide.md", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n x\n+y" },
    { filename: "src/a.ts", status: "modified", additions: 2, deletions: 1, patch },
    { filename: "src/a.test.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n x\n+t" },
    { filename: "package-lock.json", status: "modified", additions: 400, deletions: 300, patch: "@@ -1,1 +1,1 @@\n-a\n+b" },
    { filename: "src/gone.ts", status: "removed", additions: 0, deletions: 2, patch: "@@ -1,2 +0,0 @@\n-a\n-b" },
    { filename: "src/big.bin", status: "modified", additions: 0, deletions: 0 },
  ];
  const p = buildReviewPacket({ title: "T", body: "The description.", repo: "o/r", number: 1, headSha: "abcdef1234", files, consumers: { "src/a.ts": 7 }, workspaceDir: dir, ctx: 3 });
  const idx = p.text.split("\n");
  check("the PR description is in the packet", p.text.includes("## PR description") && p.text.includes("The description."));
  const order = idx.filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split("|")[2].trim().replace(/`/g, ""));
  check("files are ordered source → config → docs → test → generated",
    order.indexOf("src/a.ts") < order.indexOf("docs/guide.md") && order.indexOf("docs/guide.md") < order.indexOf("src/a.test.ts")
      && order[order.length - 1] === "package-lock.json", order.join(", "));
  check("a generated file and a patchless file are listed, never inlined",
    !p.text.includes("## package-lock.json") && /package-lock\.json` \| modified \| \+400 −300 \| generated \| — \| listed/.test(p.text)
      && /big\.bin.*listed \(no patch from GitHub/.test(p.text));
  check("a test file is inlined diff-only (no widened context)", /src\/a\.test\.ts.*\| diff \|/.test(p.text));
  check("a removed file shows its removed lines", p.text.includes("## src/gone.ts") && p.text.includes("     |-a"));
  const row = idx.find((l) => l.includes("`src/a.ts`"));
  const range = /(\d+)–(\d+) \|$/.exec(row || "");
  check("the index's packet-line range points at the file's own section heading",
    !!range && idx[Number(range[1]) - 1] === "## src/a.ts", `${row} → ${range && idx[Number(range[1]) - 1]}`);

  const tiny = buildReviewPacket({ title: "T", body: "B", files, workspaceDir: dir, ctx: 3, maxLines: 12 });
  check("under a tight cap the lowest-priority files degrade first and the index says so",
    /not inlined \(packet cap\)/.test(tiny.text) && tiny.files.listed > p.files.listed);
  const again = buildReviewPacket({ title: "T", body: "The description.", repo: "o/r", number: 1, headSha: "abcdef1234", files, consumers: { "src/a.ts": 7 }, workspaceDir: dir, ctx: 3 });
  check("deterministic: the same input builds the same packet", again.text === p.text);
  check("consumersByFile keeps the largest consumer count per file",
    JSON.stringify(consumersByFile({ symbols: [{ path: "a", consumer_count: 3 }, { path: "a", consumer_count: 9 }, { path: "b", consumer_count: 1 }] })) === JSON.stringify({ a: 9, b: 1 }));
  rmSync(dir, { recursive: true, force: true });

  if (failed) { console.error(`\nreview-packet self-test: ${failed} check(s) failed`); process.exit(1); }
  console.log("\n✓ review-packet self-test: all checks passed");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main(process.argv.slice(2));
