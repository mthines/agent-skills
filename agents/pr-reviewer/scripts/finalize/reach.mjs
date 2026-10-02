// @ts-check
/**
 * finalize/reach.mjs — builds the report's COVERAGE and IMPACT slots from what the run already
 * recorded, so the `**Checked:**` line and the `What this change reaches` section render on every
 * run without a hand-assembled payload. Pure. No I/O, clock, or env (D18): finalize.mjs's main()
 * loads impact.json; finalizeReview() calls these.
 *
 * Inputs and where they come from:
 *   - `scopePaths`   prepare-review.mjs — the changed files in scope (the PR on a full run, the
 *                    delta on an incremental one, none on a zero-delta run).
 *   - `scanned`      judgments.json `scanned_files` — SCANNED_FILES, the files this run read.
 *   - `impact`       impact.json (build-impact-graph.mjs) — symbols, consumers, deps, overlaps.
 *   - `trace`        judgments.json `impact_trace` — per changed export, the consumer files the
 *                    consumer-impact finder read and found to hold.
 *   - `inlineClaims` the claims this run posts inline; a consumer-impact one marks its file.
 *
 * Nothing here asserts more than its inputs say: a consumer file is `verified` only when the trace
 * names it, `finding` only when a posted consumer-impact claim anchors there, and `untraced`
 * otherwise. A caller-supplied `context.render.COVERAGE` / `.IMPACT` always wins (finalize.mjs).
 */

/** @type {Record<string, number>} */
const CHANGE_RANK = { removed: 0, signature: 1, body: 2, added: 3 };
const RENDERABLE_DELTAS = new Set(["major", "minor", "patch"]);
// What render-report.mjs rejects in an identifier field: markdown link syntax, a backtick, a pipe,
// or a line break. An impact.json entry carrying one is left out of the auto-built section rather
// than failing the whole report — a report with one bullet fewer still posts; a rejected one does not.
const UNSAFE = /[`\n\r|]|\]\(|\[[^\]]*\]/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** @param {unknown} v @returns {v is string} */
function safe(v) {
  return typeof v === "string" && v.trim() !== "" && !UNSAFE.test(v);
}

/**
 * The `**Checked:**` line's file counts. PARTIAL_REVIEW wins when present, because the renderer
 * rejects a COVERAGE that disagrees with the partial-review banner, and the banner is the record of
 * a truncated walk.
 * @param {{ scopePaths?: unknown, scanned?: unknown, partial?: any }} args
 * @returns {{ files_read: number, files_total: number } | null}
 */
export function buildCoverage({ scopePaths, scanned, partial }) {
  if (partial && Number.isInteger(partial.scanned) && Number.isInteger(partial.total)
    && partial.scanned >= 0 && partial.scanned <= partial.total) {
    return { files_read: partial.scanned, files_total: partial.total };
  }
  if (!Array.isArray(scopePaths) || !Array.isArray(scanned)) return null;
  const scope = new Set(scopePaths.filter((p) => typeof p === "string" && p !== ""));
  if (scope.size === 0) return null;
  const read = new Set(scanned.filter((p) => typeof p === "string" && scope.has(p)));
  return { files_read: read.size, files_total: scope.size };
}

/**
 * A render-report.mjs IMPACT object, or null when impact.json has nothing a reader needs.
 * @param {{ impact: any, inlineClaims?: any[], trace?: unknown, dependencyFinderRan?: boolean, repo?: string | null }} args
 * @returns {{ symbols?: any[], dependencies?: any[], overlaps?: any[] } | null}
 */
export function buildImpact({ impact, inlineClaims = [], trace, dependencyFinderRan = false, repo = null }) {
  if (!impact || typeof impact !== "object") return null;
  const traceList = Array.isArray(trace) ? trace : [];
  const consumerClaims = inlineClaims.filter((c) => c && c.finder === "consumer-impact" && safe(c.path));

  /** @type {any[]} */
  const rawSymbols = Array.isArray(impact.symbols) ? impact.symbols : [];
  /** @type {any[]} */
  const rawDeps = Array.isArray(impact.dependencies) ? impact.dependencies : [];
  /** @type {any[]} */
  const rawOverlaps = Array.isArray(impact.overlaps) ? impact.overlaps : [];
  const symbols = rawSymbols
    .filter((s) => s && s.exported !== false && Number.isInteger(s.consumer_files) && s.consumer_files > 0
      && safe(s.name) && safe(s.path) && CHANGE_RANK[s.change] !== undefined)
    // Breaking changes first, then the widest; names and paths break ties, so the order is stable.
    .sort((a, b) => CHANGE_RANK[a.change] - CHANGE_RANK[b.change] || b.consumer_files - a.consumer_files
      || String(a.name).localeCompare(String(b.name)) || String(a.path).localeCompare(String(b.path)))
    .map((s) => {
      const listed = [...new Set((Array.isArray(s.consumers) ? s.consumers : [])
        .map((/** @type {any} */ c) => c?.path)
        .filter((/** @type {unknown} */ p) => safe(p) && p !== s.path))]
        .slice(0, s.consumer_files);
      /** @type {Map<string, number|null>} */
      const flagged = new Map();
      for (const c of consumerClaims) {
        if (c.symbol && c.symbol !== s.name) continue;
        if (!listed.includes(c.path) || flagged.has(c.path)) continue;
        flagged.set(c.path, Number.isInteger(c.line) && c.line > 0 ? c.line : null);
      }
      const verified = new Set(traceList
        .filter((/** @type {any} */ t) => t && t.symbol === s.name && t.path === s.path && Array.isArray(t.verified))
        .flatMap((/** @type {any} */ t) => t.verified)
        .filter((/** @type {unknown} */ p) => typeof p === "string" && listed.includes(p) && !flagged.has(p)));
      const consumers = listed.map((p) => {
        if (flagged.has(p)) {
          const line = flagged.get(p);
          return line ? { path: p, line, status: "finding" } : { path: p, status: "finding" };
        }
        return { path: p, status: verified.has(p) ? "verified" : "untraced" };
      });
      return {
        name: s.name,
        path: s.path,
        change: s.change,
        consumer_files: s.consumer_files,
        verified_unaffected: verified.size,
        findings: flagged.size,
        consumers,
      };
    });

  // "N usage sites checked" is the bullet's claim, so a dependency is listed only when the
  // dependency finder — the step that reads those sites — actually ran this time.
  const dependencies = dependencyFinderRan
    ? rawDeps
      .filter((d) => d && safe(d.name) && safe(String(d.from ?? "")) && safe(String(d.to ?? ""))
        && RENDERABLE_DELTAS.has(d.semver_delta))
      .map((d) => ({
        name: d.name,
        from: String(d.from),
        to: String(d.to),
        delta: d.semver_delta,
        usage_sites: Array.isArray(d.usage_sites) ? d.usage_sites.length : 0,
      }))
    : [];

  // Same-symbol overlaps only: the bullet says "a semantic conflict is likely", which holds when
  // both PRs change one export and overstates two PRs that merely touch one file (impact-graph.md:
  // `same-file` is a note, not a consequence).
  const overlaps = rawOverlaps
    .filter((o) => o && Number.isInteger(o.pr) && o.pr > 0 && safe(o.author)
      && Array.isArray(o.files) && safe(o.files[0]) && Array.isArray(o.symbols) && safe(o.symbols[0]))
    .map((o) => {
      /** @type {{ pr: number, author: string, path: string, symbol: string, url?: string }} */
      const out = { pr: o.pr, author: o.author, path: o.files[0], symbol: o.symbols[0] };
      if (typeof repo === "string" && REPO_RE.test(repo)) out.url = `https://github.com/${repo}/pull/${o.pr}`;
      return out;
    });

  if (!symbols.length && !dependencies.length && !overlaps.length) return null;
  /** @type {{ symbols?: any[], dependencies?: any[], overlaps?: any[] }} */
  const out = {};
  if (symbols.length) out.symbols = symbols;
  if (dependencies.length) out.dependencies = dependencies;
  if (overlaps.length) out.overlaps = overlaps;
  return out;
}

function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  check("coverage counts the scanned files inside the scope, once each",
    JSON.stringify(buildCoverage({ scopePaths: ["a.ts", "b.ts", "c.ts"], scanned: ["a.ts", "a.ts", "c.ts", "outside.ts"] }))
      === JSON.stringify({ files_read: 2, files_total: 3 }));
  check("coverage takes PARTIAL_REVIEW's numbers when the walk was truncated",
    JSON.stringify(buildCoverage({ scopePaths: ["a.ts"], scanned: ["a.ts"], partial: { calls: 60, scanned: 13, total: 22 } }))
      === JSON.stringify({ files_read: 13, files_total: 22 }));
  check("coverage is null with no scope or no scanned list (never a guessed 0 of N)",
    buildCoverage({ scopePaths: [], scanned: ["a.ts"] }) === null
      && buildCoverage({ scopePaths: ["a.ts"], scanned: undefined }) === null);

  const impact = {
    symbols: [
      { name: "parse", path: "src/p.ts", change: "body", exported: true, consumer_files: 2,
        consumers: [{ path: "src/x.ts", line: 3 }, { path: "src/y.ts", line: 9 }] },
      { name: "retry", path: "src/r.ts", change: "signature", exported: true, consumer_files: 5,
        consumers: [{ path: "src/a.ts", line: 1 }, { path: "src/a.ts", line: 7 }, { path: "src/b.ts", line: 2 },
          { path: "src/c.ts", line: 4 }, { path: "src/r.ts", line: 40 }] },
      { name: "internal", path: "src/i.ts", change: "signature", exported: false, consumer_files: 3, consumers: [] },
      { name: "unused", path: "src/u.ts", change: "removed", exported: true, consumer_files: 0, consumers: [] },
      { name: "bad`name", path: "src/z.ts", change: "body", exported: true, consumer_files: 1, consumers: [] },
    ],
    dependencies: [
      { name: "stripe", from: "14.2.0", to: "16.0.1", semver_delta: "major", usage_sites: [{}, {}, {}] },
      { name: "odd", from: "a", to: "b", semver_delta: "other", usage_sites: [] },
    ],
    overlaps: [{ pr: 212, author: "alice", files: ["src/r.ts"], symbols: ["retry"], kind: "same-symbol" },
      { pr: 9, author: "bob", files: ["docs/x.md"], symbols: [], kind: "same-file" }],
  };
  const claims = [
    { finder: "consumer-impact", path: "src/b.ts", line: 2, symbol: "retry" },
    { finder: "consumer-impact", path: "src/x.ts", line: 3, symbol: "retry" }, // names another symbol's consumer
    { finder: "correctness", path: "src/c.ts", line: 4 },
  ];
  const trace = [{ symbol: "retry", path: "src/r.ts", verified: ["src/a.ts", "src/b.ts", "src/nowhere.ts"] }];
  const built = buildImpact({ impact, inlineClaims: claims, trace, dependencyFinderRan: true, repo: "o/r" });
  const retry = built?.symbols?.[0];
  check("breaking changes sort first; unexported, consumer-less and unsafe symbols are left out",
    JSON.stringify(built?.symbols?.map((s) => s.name)) === JSON.stringify(["retry", "parse"]));
  check("consumers are one entry per file, without the defining file",
    JSON.stringify(retry?.consumers?.map((/** @type {any} */ c) => c.path)) === JSON.stringify(["src/a.ts", "src/b.ts", "src/c.ts"]));
  check("a posted consumer-impact claim marks its file a finding and wins over the trace",
    JSON.stringify(retry?.consumers?.find((/** @type {any} */ c) => c.path === "src/b.ts")) === JSON.stringify({ path: "src/b.ts", line: 2, status: "finding" }));
  check("only traced files inside the consumer list are verified; another finder's claim marks nothing",
    retry?.verified_unaffected === 1 && retry?.findings === 1
      && retry?.consumers?.find((/** @type {any} */ c) => c.path === "src/c.ts")?.status === "untraced");
  check("a claim naming a different symbol does not mark this symbol's consumer",
    built?.symbols?.[1]?.findings === 0);
  check("dependencies list renderable deltas only, with usage sites counted",
    JSON.stringify(built?.dependencies) === JSON.stringify([{ name: "stripe", from: "14.2.0", to: "16.0.1", delta: "major", usage_sites: 3 }]));
  check("dependencies are omitted when the dependency finder did not run",
    buildImpact({ impact, inlineClaims: claims, trace, dependencyFinderRan: false, repo: "o/r" })?.dependencies === undefined);
  check("same-symbol overlaps carry the PR link built from the repo slug; a same-file overlap is left out",
    JSON.stringify(built?.overlaps) === JSON.stringify([{ pr: 212, author: "alice", path: "src/r.ts", symbol: "retry", url: "https://github.com/o/r/pull/212" }]));
  check("nothing to show is null, not an empty section",
    buildImpact({ impact: { symbols: [], dependencies: [], overlaps: [] } }) === null && buildImpact({ impact: null }) === null);

  if (failed > 0) {
    console.error(`\nreach self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ reach self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
