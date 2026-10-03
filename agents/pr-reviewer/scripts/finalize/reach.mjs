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
 *   - `impact`       impact.json (build-impact-graph.mjs) — symbols, consumers, modules and their
 *                    importers, deps, overlaps.
 *   - `trace`        judgments.json `impact_trace` — per changed export, the consumer files the
 *                    consumer-impact finder read and found to hold.
 *   - `inlineClaims` the claims this run posts inline; a consumer-impact one marks its file.
 *   - `skipped`      SKIPPED_FILES — files triage kept out of the read on purpose.
 *
 * Nothing here asserts more than its inputs say: a consumer file is `verified` only when the trace
 * names it, `finding` only when a posted consumer-impact claim anchors there, and `untraced`
 * otherwise. A caller-supplied `context.render.COVERAGE` / `.IMPACT` always wins (finalize.mjs).
 */

import { assertPlain } from "../comment-spine.mjs";

/** @type {Record<string, number>} */
const CHANGE_RANK = { removed: 0, signature: 1, body: 2, added: 3 };
const RENDERABLE_DELTAS = new Set(["major", "minor", "patch"]);
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/**
 * Accepted by render-report.mjs's identifier check — the spine's own assertPlain, so the two can
 * never disagree (a path like `app/[orgId]/page.tsx` is plain; `[x](y)` is a link). An entry that
 * fails is left out of the auto-built section rather than failing the whole report.
 * @param {unknown} v @returns {v is string}
 */
function safe(v) {
  if (typeof v !== "string" || v.trim() === "") return false;
  try {
    assertPlain("path", v);
    return true;
  } catch {
    return false;
  }
}

/**
 * SKIPPED_FILES is prose (`none`, or a list); only tokens that exactly name a path count.
 * @param {unknown} raw @returns {Set<string>}
 */
function skippedSet(raw) {
  if (typeof raw !== "string" || raw.trim() === "none") return new Set();
  return new Set(raw.split(/[\s,;]+/).map((t) => t.replace(/^`|`$/g, "")).filter(Boolean));
}

/**
 * The `**Checked:**` line's file counts. PARTIAL_REVIEW wins when present, because the renderer
 * rejects a COVERAGE that disagrees with the partial-review banner, and the banner is the record of
 * a truncated walk.
 * Files triage skipped on purpose (SKIPPED_FILES) leave the denominator and are counted
 * separately, so "20 of 22 read" never reads as two files missed.
 * @param {{ scopePaths?: unknown, scanned?: unknown, partial?: any, skipped?: unknown }} args
 * @returns {{ files_read: number, files_total: number, files_skipped?: number } | null}
 */
export function buildCoverage({ scopePaths, scanned, partial, skipped }) {
  if (partial && Number.isInteger(partial.scanned) && Number.isInteger(partial.total)
    && partial.scanned >= 0 && partial.scanned <= partial.total) {
    return { files_read: partial.scanned, files_total: partial.total };
  }
  if (!Array.isArray(scopePaths) || !Array.isArray(scanned)) return null;
  const all = new Set(scopePaths.filter((p) => typeof p === "string" && p !== ""));
  const skip = skippedSet(skipped);
  const scope = new Set([...all].filter((p) => !skip.has(p)));
  const skippedCount = all.size - scope.size;
  if (scope.size === 0) return null;
  const read = new Set(scanned.filter((p) => typeof p === "string" && scope.has(p)));
  return skippedCount > 0
    ? { files_read: read.size, files_total: scope.size, files_skipped: skippedCount }
    : { files_read: read.size, files_total: scope.size };
}

/**
 * A render-report.mjs IMPACT object, or null when impact.json has nothing a reader needs.
 * @param {{ impact: any, inlineClaims?: any[], trace?: unknown, repo?: string | null }} args
 * @returns {{ symbols?: any[], modules?: any[], dependencies?: any[], dependencies_omitted?: number, overlaps?: any[] } | null}
 */
export function buildImpact({ impact, inlineClaims = [], trace, repo = null }) {
  if (!impact || typeof impact !== "object") return null;
  const traceList = Array.isArray(trace) ? trace : [];
  const consumerClaims = inlineClaims.filter((c) => c && c.finder === "consumer-impact" && safe(c.path));

  /** @type {any[]} */
  const rawSymbols = Array.isArray(impact.symbols) ? impact.symbols : [];
  /** @type {any[]} */
  const rawDeps = Array.isArray(impact.dependencies) ? impact.dependencies : [];
  /** @type {any[]} */
  const rawOverlaps = Array.isArray(impact.overlaps) ? impact.overlaps : [];
  /** @type {any[]} */
  const rawModules = Array.isArray(impact.modules) ? impact.modules : [];
  const symbols = rawSymbols
    .filter((s) => s && s.exported !== false && Number.isInteger(s.consumer_files) && s.consumer_files > 0
      && safe(s.name) && safe(s.path) && CHANGE_RANK[s.change] !== undefined)
    // Breaking changes first, then the widest; names and paths break ties, so the order is stable.
    .sort((a, b) => CHANGE_RANK[a.change] - CHANGE_RANK[b.change] || b.consumer_files - a.consumer_files
      || String(a.name).localeCompare(String(b.name)) || String(a.path).localeCompare(String(b.path)))
    .map((s) => {
      const graphListed = [...new Set((Array.isArray(s.consumers) ? s.consumers : [])
        .map((/** @type {any} */ c) => c?.path)
        .filter((/** @type {unknown} */ p) => safe(p) && p !== s.path))];
      const traced = traceList
        .filter((/** @type {any} */ t) => t && t.symbol === s.name && t.path === s.path && Array.isArray(t.verified))
        .flatMap((/** @type {any} */ t) => t.verified)
        .filter((/** @type {unknown} */ p) => safe(p) && p !== s.path);
      // impact.json lists at most 25 consumer files, but consumer_files counts them all. A file the
      // trace read, or a claim naming this symbol anchored in, is a consumer even past the cap, so it
      // is listed ahead of the graph's untraced entries instead of being lost to the cut.
      const namedClaims = consumerClaims.filter((c) => c.symbol === s.name && c.path !== s.path).map((c) => c.path);
      const listed = [...new Set([...namedClaims, ...traced, ...graphListed])].slice(0, s.consumer_files);
      /** @type {Map<string, number|null>} */
      const flagged = new Map();
      for (const c of consumerClaims) {
        if (c.symbol && c.symbol !== s.name) continue;
        if (!listed.includes(c.path) || flagged.has(c.path)) continue;
        flagged.set(c.path, Number.isInteger(c.line) && c.line > 0 ? c.line : null);
      }
      const verified = new Set(traced.filter((p) => listed.includes(p) && !flagged.has(p)));
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

  // A changed file whose importers no listed export already covers: a private helper, a top-level
  // constant, or an export whose callers the symbol search could not attribute. Its importers are
  // reach the symbol rows miss. A file with a listed export is left to that export's consumers, so
  // the diagram never draws the same file twice. impact.json lists at most 25 importers but
  // `importers` counts them all, and the count is what `importer_files` carries.
  const symbolPaths = new Set(symbols.map((s) => s.path));
  const modules = rawModules
    .filter((m) => m && safe(m.path) && !symbolPaths.has(m.path) && Number.isInteger(m.importers))
    .map((m) => {
      /** @type {unknown[]} */
      const listedRaw = Array.isArray(m.importer_paths) ? m.importer_paths : [];
      const selfListed = listedRaw.includes(m.path);
      /** @type {string[]} */
      const importers = [...new Set(listedRaw.filter((p) => safe(p) && p !== m.path))].map(String);
      const importerFiles = Math.max(m.importers - (selfListed ? 1 : 0), importers.length);
      return { path: String(m.path), importer_files: importerFiles, importers };
    })
    .filter((m) => m.importer_files > 0)
    .sort((a, b) => b.importer_files - a.importer_files || a.path.localeCompare(b.path));

  // A version bump is reach whether or not anything read its call sites, so every renderable delta
  // that is direct (`direct !== false`) or has a usage site in this repo is listed; what was read is
  // a separate, evidenced number. `checked_sites` counts the usage sites in files the trace names for
  // this package (impact_trace `{symbol: <name>, path: <manifest>}`), so the bullet never says
  // "checked" on the strength of a finder merely being scheduled.
  // A transitive delta with no usage site is counted in `dependencies_omitted`, never listed and never
  // dropped: one lockfile refresh can move hundreds, and a hidden transitive major must stay visible.
  const renderableDeps = rawDeps
    .filter((d) => d && safe(d.name) && safe(String(d.from ?? "")) && safe(String(d.to ?? ""))
      && RENDERABLE_DELTAS.has(d.semver_delta));
  const listedDeps = renderableDeps
    .filter((d) => d.direct !== false || (Array.isArray(d.usage_sites) && d.usage_sites.length > 0));
  const dependenciesOmitted = renderableDeps.length - listedDeps.length;
  const dependencies = listedDeps
    .map((d) => {
      /** @type {any[]} */
      const sites = Array.isArray(d.usage_sites) ? d.usage_sites : [];
      const read = new Set(traceList
        .filter((/** @type {any} */ t) => t && t.symbol === d.name && t.path === d.manifest && Array.isArray(t.verified))
        .flatMap((/** @type {any} */ t) => t.verified));
      return {
        name: d.name,
        from: String(d.from),
        to: String(d.to),
        delta: d.semver_delta,
        usage_sites: sites.length,
        checked_sites: sites.filter((u) => u && read.has(u.path)).length,
      };
    });

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

  if (!symbols.length && !modules.length && !dependencies.length && !dependenciesOmitted && !overlaps.length) return null;
  /** @type {{ symbols?: any[], modules?: any[], dependencies?: any[], dependencies_omitted?: number, overlaps?: any[] }} */
  const out = {};
  if (symbols.length) out.symbols = symbols;
  if (modules.length) out.modules = modules;
  if (dependencies.length) out.dependencies = dependencies;
  if (dependenciesOmitted > 0) out.dependencies_omitted = dependenciesOmitted;
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
  check("files triage skipped leave the denominator and are counted on their own",
    JSON.stringify(buildCoverage({ scopePaths: ["a.ts", "b.ts", "pnpm-lock.yaml"], scanned: ["a.ts"], skipped: "`pnpm-lock.yaml`" }))
      === JSON.stringify({ files_read: 1, files_total: 2, files_skipped: 1 }));
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
      { name: "page", path: "app/[orgId]/layout.tsx", change: "body", exported: true, consumer_files: 1,
        consumers: [{ path: "app/[orgId]/page.tsx", line: 2 }] },
    ],
    dependencies: [
      { name: "stripe", manifest: "package-lock.json", from: "14.2.0", to: "16.0.1", semver_delta: "major",
        usage_sites: [{ path: "src/billing/a.ts" }, { path: "src/billing/a.ts" }, { path: "src/billing/b.ts" }] },
      { name: "odd", from: "a", to: "b", semver_delta: "other", usage_sites: [] },
    ],
    overlaps: [{ pr: 212, author: "alice", files: ["src/r.ts"], symbols: ["retry"], kind: "same-symbol" },
      { pr: 9, author: "bob", files: ["docs/x.md"], symbols: [], kind: "same-file" }],
  };
  const claims = [
    { finder: "consumer-impact", path: "src/b.ts", line: 2, symbol: "retry" },
    { finder: "consumer-impact", path: "src/x.ts", line: 3, symbol: "retry" }, // names retry, so x.ts is a retry consumer too
    { finder: "correctness", path: "src/c.ts", line: 4 },
  ];
  const trace = [{ symbol: "retry", path: "src/r.ts", verified: ["src/a.ts", "src/b.ts"] },
    { symbol: "stripe", path: "package-lock.json", verified: ["src/billing/a.ts"] }];
  const built = buildImpact({ impact, inlineClaims: claims, trace, repo: "o/r" });
  const retry = built?.symbols?.[0];
  check("breaking changes sort first; unexported, consumer-less and unsafe symbols are left out; a bracketed path stays",
    JSON.stringify(built?.symbols?.map((s) => s.name)) === JSON.stringify(["retry", "parse", "page"]));
  check("consumers are one entry per file, without the defining file",
    JSON.stringify(retry?.consumers?.map((/** @type {any} */ c) => c.path).sort()) === JSON.stringify(["src/a.ts", "src/b.ts", "src/c.ts", "src/x.ts"]));
  check("a posted consumer-impact claim marks its file a finding and wins over the trace",
    JSON.stringify(retry?.consumers?.find((/** @type {any} */ c) => c.path === "src/b.ts")) === JSON.stringify({ path: "src/b.ts", line: 2, status: "finding" }));
  check("only traced files are verified; a claim naming the symbol is a finding; another finder's claim marks nothing",
    retry?.verified_unaffected === 1 && retry?.findings === 2
      && retry?.consumers?.find((/** @type {any} */ c) => c.path === "src/c.ts")?.status === "untraced");
  check("a claim naming a different symbol does not mark this symbol's consumer",
    built?.symbols?.[1]?.findings === 0);
  check("dependencies list renderable deltas, with the usage sites in traced files counted as checked",
    JSON.stringify(built?.dependencies) === JSON.stringify([{ name: "stripe", from: "14.2.0", to: "16.0.1", delta: "major", usage_sites: 3, checked_sites: 2 }]));
  check("an untraced dependency is still listed, with 0 sites checked — never assumed read",
    buildImpact({ impact, inlineClaims: claims, trace: [], repo: "o/r" })?.dependencies?.[0]?.checked_sites === 0);
  {
    const lock = buildImpact({ impact: { dependencies: [
      { name: "direct-dep", manifest: "package.json", from: "1.0.0", to: "2.0.0", semver_delta: "major", direct: true, usage_sites: [] },
      { name: "used-transitive", manifest: "package.json", from: "3.1.0", to: "3.2.0", semver_delta: "minor", direct: false,
        usage_sites: [{ path: "src/u.ts" }] },
      { name: "quiet-a", manifest: "package.json", from: "0.1.0", to: "0.1.1", semver_delta: "patch", direct: false, usage_sites: [] },
      { name: "quiet-b", manifest: "package.json", from: "4.0.0", to: "5.0.0", semver_delta: "major", direct: false },
    ] } });
    check("a transitive bump with no usage site is counted in dependencies_omitted, never listed and never dropped",
      JSON.stringify(lock?.dependencies?.map((/** @type {any} */ d) => d.name)) === JSON.stringify(["direct-dep", "used-transitive"])
        && lock?.dependencies_omitted === 2);
    const onlyQuiet = buildImpact({ impact: { dependencies: [
      { name: "quiet-a", from: "0.1.0", to: "0.1.1", semver_delta: "patch", direct: false, usage_sites: [] }] } });
    check("transitive bumps alone still yield an IMPACT carrying their count, not null",
      JSON.stringify(onlyQuiet) === JSON.stringify({ dependencies_omitted: 1 }));
    check("dependencies_omitted is absent when nothing was left out",
      built !== null && !("dependencies_omitted" in (built ?? {})));
  }
  {
    const past = buildImpact({
      impact: { symbols: [{ name: "f", path: "src/f.ts", change: "signature", exported: true, consumer_files: 30,
        consumers: [{ path: "src/l1.ts" }, { path: "src/l2.ts" }] }] },
      inlineClaims: [{ finder: "consumer-impact", path: "src/far.ts", line: 9, symbol: "f" }],
      trace: [{ symbol: "f", path: "src/f.ts", verified: ["src/far2.ts"] }],
    })?.symbols?.[0];
    check("a flagged or traced consumer past impact.json's list cap is kept with its status, not dropped",
      past?.findings === 1 && past?.verified_unaffected === 1
        && past?.consumers?.some((/** @type {any} */ c) => c.path === "src/far.ts" && c.status === "finding")
        && past?.consumers?.some((/** @type {any} */ c) => c.path === "src/far2.ts" && c.status === "verified"));
  }
  check("same-symbol overlaps carry the PR link built from the repo slug; a same-file overlap is left out",
    JSON.stringify(built?.overlaps) === JSON.stringify([{ pr: 212, author: "alice", path: "src/r.ts", symbol: "retry", url: "https://github.com/o/r/pull/212" }]));
  {
    const mod = buildImpact({ impact: {
      symbols: [{ name: "retry", path: "src/r.ts", change: "signature", exported: true, consumer_files: 1, consumers: [{ path: "src/a.ts" }] },
        { name: "helper", path: "src/h.ts", change: "body", exported: false, consumer_files: 0, consumers: [] }],
      modules: [
        { path: "src/r.ts", importers: 3, importer_paths: ["src/a.ts", "src/b.ts", "src/c.ts"] },
        { path: "src/h.ts", importers: 30, importer_paths: ["src/x/one.ts", "src/x/one.ts", "src/h.ts", "src/x/[id]/two.ts", "bad`p.ts"] },
        { path: "src/quiet.ts", importers: 0, importer_paths: [] },
        { path: "src/selfonly.ts", importers: 1, importer_paths: ["src/selfonly.ts"] },
      ] } });
    check("a changed file with importers and no listed export becomes a module; a file with a listed export does not",
      JSON.stringify(mod?.modules?.map((/** @type {any} */ m) => m.path)) === JSON.stringify(["src/h.ts"]));
    check("module importers are one entry per file, without the file itself or an unsafe path, and the count drops the self entry",
      JSON.stringify(mod?.modules?.[0]) === JSON.stringify({ path: "src/h.ts", importer_files: 29, importers: ["src/x/one.ts", "src/x/[id]/two.ts"] }));
    const modulesOnly = buildImpact({ impact: { modules: [{ path: "src/h.ts", importers: 2, importer_paths: ["src/a.ts", "src/b.ts"] }] } });
    check("importers alone yield an IMPACT, not null",
      JSON.stringify(modulesOnly) === JSON.stringify({ modules: [{ path: "src/h.ts", importer_files: 2, importers: ["src/a.ts", "src/b.ts"] }] }));
  }
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
