// @ts-check
/**
 * finalize/dedupe.mjs — rubric-composition.md § Dedupe + § Cross-rubric agreement.
 * Pure. No I/O, clock, or env (D18).
 *
 * Walk findings in finder load order. For each new finding, if a prior KEPT
 * finding has:
 *   - same (path, line) AND same prefix -> drop the new one, record agreement.
 *   - adjacent lines (|line_a - line_b| <= 2) AND same prefix AND same first
 *     40 chars of body -> drop the new one (NOT agreement-promoted — this is
 *     the fuzzy near-duplicate case, not the exact-match case § Cross-rubric
 *     agreement defines).
 *   - same (path, line) AND different prefix -> keep both.
 */

/** @param {any} a @param {any} b */
function exactMatch(a, b) {
  return a.path === b.path && a.line === b.line && a.prefix === b.prefix;
}

/** @param {any} a @param {any} b */
function adjacentFuzzyMatch(a, b) {
  if (a.path !== b.path || a.prefix !== b.prefix) return false;
  if (typeof a.line !== "number" || typeof b.line !== "number") return false;
  if (Math.abs(a.line - b.line) > 2) return false;
  const bodyA = (a.body || "").slice(0, 40);
  const bodyB = (b.body || "").slice(0, 40);
  return bodyA === bodyB;
}

/**
 * @param {any[]} candidates - in finder load order
 * @returns {{ kept: any[], dropped: any[] }}
 */
export function dedupe(candidates) {
  /** @type {any[]} */
  const kept = [];
  /** @type {any[]} */
  const dropped = [];

  for (const c of candidates) {
    let mergedInto = null;
    let reason = "";
    for (const k of kept) {
      if (exactMatch(k, c)) { mergedInto = k; reason = "exact"; break; }
      if (adjacentFuzzyMatch(k, c)) { mergedInto = k; reason = "adjacent"; break; }
    }
    if (mergedInto) {
      if (reason === "exact") {
        if (!mergedInto._also_flagged_by) mergedInto._also_flagged_by = [];
        if (!mergedInto._also_flagged_by.includes(c.finder)) mergedInto._also_flagged_by.push(c.finder);
      }
      dropped.push({ ...c, _dedupe_dropped_for: mergedInto.finder, _dedupe_reason: reason });
    } else {
      kept.push({ ...c });
    }
  }

  return { kept, dropped };
}

/**
 * Cross-rubric agreement (exact-match dedupe only): the finding's effective
 * confidence threshold becomes min(threshold, 70) — see thresholds.mjs.
 * @param {any[]} kept
 * @returns {any[]}
 */
export function markAgreementPromoted(kept) {
  return kept.map((k) => ({
    ...k,
    agreement_promoted: Array.isArray(k._also_flagged_by) && k._also_flagged_by.length > 0,
  }));
}

// ── semantic dedupe (plan D5) ───────────────────────────────────────────────────────────────────
//
// `dedupe()` above only catches an EXACT (path, line, prefix) match or an adjacent-line match with
// the same first-40-characters of body. Neither catches the shape the live `/pr-review --fanout`
// run on dash0hq/dash0#20230 actually produced: the same defect filed FOUR times, once per finder,
// each under its own `defect_class` — `edge-case` / `contract-break` / `scope-creep` /
// `missing-update` — with each finder wording the claim differently. `dedupe()`'s `prefix` equality
// requirement (pre-verification, `prefix` stands in for `defect_class`) can never catch this: the
// defect classes are different BY CONSTRUCTION, one per finder's own taxonomy.
//
// Calibrated on that run's real `deduped.json` (numbers only — the text itself is dash0 content
// and is never committed, plan.md Background & Context): same-symbol same-line TRUE duplicates
// scored 0.23–0.46 on claim+bad_outcome token Jaccard; every DISTINCT pair on the same path scored
// <= 0.19, including a same-symbol same-line decoy at 0.08 and a no-symbol `standards` finding at
// the same line. The floor is the midpoint of that gap, (0.19 + 0.23) / 2 = 0.21: it admits the
// lowest observed duplicate (0.23) and rejects the highest observed distinct pair (0.19) with the
// same 0.02 margin on each side. Self-test (h) pins both edges.

export const SEMANTIC_JACCARD_MIN = 0.21;
export const SEMANTIC_LINE_WINDOW = 3;

/**
 * Common English words that would otherwise dominate the token overlap of any two findings about
 * the same file/function regardless of whether they describe the same defect — "without", "there",
 * "should" appear in almost every finding's prose and carry no discriminating signal.
 */
const STOPWORDS = new Set([
  "this", "that", "with", "from", "into", "have", "has", "had", "been", "being", "were", "will",
  "would", "could", "should", "there", "their", "they", "when", "where", "which", "while", "about",
  "after", "before", "because", "never", "every", "only", "also", "then", "than", "over", "under",
  "both", "each", "same", "here", "what", "does", "doesn", "cannot", "without", "still", "just",
  "some", "more", "most", "less", "these", "those", "upon", "onto", "across", "between", "during",
  "through", "such", "itself", "other", "your", "yours", "really", "actually", "instead", "rather",
]);

/** @param {any} symbol */
function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toLowerCase();
}

/**
 * The token set a candidate's `claim` + `bad_outcome` reduce to for the Jaccard comparison:
 * backticked spans are split on non-word characters and kept at >= 3 chars (an identifier is
 * discriminating even when short, e.g. `db`, `id`); everything else is lowercased and kept at
 * >= 4 chars, minus the stopword list; the candidate's own `symbol` is removed either way, since
 * every finding about the same symbol mentions it and it would otherwise inflate every pair's
 * overlap regardless of whether they describe the same defect.
 * @param {any} candidate
 * @returns {Set<string>}
 */
export function claimTokens(candidate) {
  const text = `${candidate.claim || ""} ${candidate.bad_outcome || ""}`;
  /** @type {Set<string>} */
  const tokens = new Set();
  const backtickRe = /`([^`]+)`/g;
  let m;
  while ((m = backtickRe.exec(text)) !== null) {
    for (const piece of m[1].split(/[^A-Za-z0-9_]+/)) {
      const p = piece.toLowerCase();
      if (p.length >= 3) tokens.add(p);
    }
  }
  const bare = text.replace(/`[^`]*`/g, " ");
  for (const word of bare.split(/[^A-Za-z0-9_]+/)) {
    const w = word.toLowerCase();
    if (w.length >= 4 && !STOPWORDS.has(w)) tokens.add(w);
  }
  const sym = normalizeSymbol(candidate.symbol);
  if (sym) tokens.delete(sym);
  return tokens;
}

/** @param {Set<string>} a @param {Set<string>} b */
function jaccard(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Two candidates are the same underlying defect iff ALL of: same `path`; both `symbol` non-null
 * and equal (case-insensitive) — a `null`-symbol finding (a `standards` finding with no specific
 * symbol, or a whole-file concern) never semantically merges, since there is nothing to anchor the
 * "same defect" claim to; both `line` numeric with `|Δline| <= SEMANTIC_LINE_WINDOW`; and the
 * claim-token Jaccard similarity is `>= SEMANTIC_JACCARD_MIN`.
 * @param {any} a @param {any} b
 */
function semanticMatch(a, b) {
  if (a.path !== b.path) return false;
  const symA = normalizeSymbol(a.symbol);
  const symB = normalizeSymbol(b.symbol);
  if (!symA || !symB || symA !== symB) return false;
  if (typeof a.line !== "number" || typeof b.line !== "number") return false;
  if (Math.abs(a.line - b.line) > SEMANTIC_LINE_WINDOW) return false;
  return jaccard(claimTokens(a), claimTokens(b)) >= SEMANTIC_JACCARD_MIN;
}

const SEVERITY_RANK = /** @type {Record<string, number>} */ ({ critical: 4, high: 3, medium: 2, low: 1 });

/**
 * Total order used to pick a semantic group's representative independently of input order:
 * highest `severity_hint` (or `severity`) first, then the earliest numeric `line`, then lexical
 * `finder`, `defect_class`, and `claim`.
 * @param {any} a @param {any} b
 */
function representativeOrder(a, b) {
  const sev = (/** @type {any} */ c) => SEVERITY_RANK[String(c.severity_hint || c.severity || "").toLowerCase()] || 0;
  if (sev(a) !== sev(b)) return sev(b) - sev(a);
  const la = typeof a.line === "number" ? a.line : Infinity;
  const lb = typeof b.line === "number" ? b.line : Infinity;
  if (la !== lb) return la < lb ? -1 : 1;
  for (const k of ["finder", "defect_class", "claim"]) {
    const x = String(a[k] ?? "");
    const y = String(b[k] ?? "");
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The semantic pass (D5), called by `dedupeCandidates()` AFTER the existing exact/adjacent pass —
 * never inside `finalizeReview()`'s post-verification path, and never agreement-promoted (a
 * semantic merge changes the `reviewer-agreement-bump` rubric's threshold semantics without a run
 * having verified that behaviour, which `rubric-composition.md ## Dedupe` documents explicitly as
 * out of scope for this pass).
 *
 * Grouping is single-linkage TRANSITIVE CLOSURE (union-find over every matching pair): two
 * candidates land in the same group iff a chain of pairwise `semanticMatch`es connects them, so a
 * candidate that bridges two otherwise-disjoint clusters merges both, and the partition is
 * independent of input order. The representative kept for each group is chosen by
 * `representativeOrder` — highest `severity_hint`, then earliest `line`, then lexical
 * `finder` / `defect_class` / `claim` — so it too is independent of input order. The other members
 * are dropped and recorded on the kept record's `_semantic_merged` array
 * (`{finder, defect_class, line, claim}` each), so every framing the finders raised is recorded.
 * `kept` is emitted in the input position of
 * each group's first-seen member, so an ungrouped candidate keeps its place.
 * @param {any[]} candidates - in finder load order
 * @returns {{ kept: any[], dropped: any[] }}
 */
export function semanticDedupe(candidates) {
  const parent = candidates.map((_, i) => i);
  /** @param {number} i @returns {number} */
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (semanticMatch(candidates[i], candidates[j])) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj);
      }
    }
  }

  /** @type {Map<number, any[]>} */
  const groups = new Map();
  candidates.forEach((c, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(c);
    else groups.set(root, [c]);
  });

  /** @type {any[]} */
  const kept = [];
  /** @type {any[]} */
  const dropped = [];
  for (const g of groups.values()) {
    const ordered = [...g].sort(representativeOrder);
    const head = { ...ordered[0] };
    const rest = ordered.slice(1);
    if (rest.length > 0) {
      head._semantic_merged = rest.map((m) => ({
        finder: m.finder, defect_class: m.defect_class, line: m.line, claim: m.claim,
      }));
    }
    kept.push(head);
    for (const m of rest) {
      dropped.push({ ...m, _dedupe_dropped_for: head.finder, _dedupe_reason: "semantic" });
    }
  }
  return { kept, dropped };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "unguarded null deref here in this function" };
    const c2 = { finder: "quality", path: "a.ts", line: 10, prefix: "issue", body: "different wording entirely for the same defect claim" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("exact (path,line,prefix) match drops the second finding", kept.length === 1 && dropped.length === 1);
    check("the kept finding records the dropped rubric in _also_flagged_by", kept[0]._also_flagged_by?.includes("quality"));
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "unguarded null deref reachable from the exported caller" };
    const c2 = { finder: "quality", path: "a.ts", line: 11, prefix: "issue", body: "unguarded null deref reachable from the exported caller too" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("adjacent line (<=2) + same prefix + same 40-char prefix drops the second", kept.length === 1 && dropped.length === 1 && dropped[0]._dedupe_reason === "adjacent");
    check("adjacent-line drop does NOT mark agreement-promoted", !kept[0]._also_flagged_by);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const c2 = { finder: "quality", path: "a.ts", line: 10, prefix: "suggestion", body: "x" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("same (path,line), different prefix keeps both", kept.length === 2 && dropped.length === 0);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const c2 = { finder: "quality", path: "b.ts", line: 10, prefix: "issue", body: "x" };
    const { kept, dropped } = dedupe([c1, c2]);
    check("different path never merges", kept.length === 2 && dropped.length === 0);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const c2 = { finder: "quality", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const { kept } = dedupe([c1, c2]);
    const promoted = markAgreementPromoted(kept);
    check("markAgreementPromoted flags the merged-into finding true", promoted[0].agreement_promoted === true);
  }

  {
    const c1 = { finder: "correctness", path: "a.ts", line: 10, prefix: "issue", body: "x" };
    const { kept } = dedupe([c1]);
    const promoted = markAgreementPromoted(kept);
    check("a single-rubric finding is NOT agreement-promoted", promoted[0].agreement_promoted === false);
  }

  // ── semantic dedupe (D5, AC-11) ──────────────────────────────────────────────────────────────
  {
    // (a) Four same-path, same-symbol, nearby-line candidates, each a different defect_class
    // (mirroring the real dash0hq/dash0#20230 run's edge-case/contract-break/scope-creep/
    // missing-update quadruplicate), with overlapping-but-differently-worded claims. All four
    // merge into one group via single-linkage; the head carries three _semantic_merged entries.
    const q1 = { finder: "correctness", defect_class: "edge-case", path: "src/pay.ts", line: 10, symbol: "processPayment",
      claim: "processPayment does not handle a zero amount refund correctly",
      bad_outcome: "a zero amount refund silently succeeds without reversing the charge" };
    const q2 = { finder: "consumer-impact", defect_class: "contract-break", path: "src/pay.ts", line: 11, symbol: "processPayment",
      claim: "processPayment silently succeeds on a zero amount refund",
      bad_outcome: "callers assume the refund reversed the charge but it does not" };
    const q3 = { finder: "quality", defect_class: "scope-creep", path: "src/pay.ts", line: 12, symbol: "processPayment",
      claim: "the zero amount refund path in processPayment succeeds without reversing charge",
      bad_outcome: "refund silently succeeds" };
    const q4 = { finder: "standards", defect_class: "missing-update", path: "src/pay.ts", line: 10, symbol: "processPayment",
      claim: "processPayment's zero amount refund case succeeds silently, charge not reversed",
      bad_outcome: "silent success without reversal" };
    const { kept: qKept, dropped: qDropped } = semanticDedupe([q1, q2, q3, q4]);
    check("(a) four same-symbol, nearby-line, differently-worded candidates merge into one group",
      qKept.length === 1 && qDropped.length === 3,
      `kept=${qKept.length} dropped=${qDropped.length}`);
    check("(a) the kept head carries a _semantic_merged entry for each of the other three",
      Array.isArray(qKept[0]._semantic_merged) && qKept[0]._semantic_merged.length === 3);
    check("(a) every dropped record is tagged semantic, not exact/adjacent",
      qDropped.every((d) => d._dedupe_reason === "semantic"));

    // (b) A same-path, same-line, same-symbol candidate whose claim is about a DIFFERENT topic
    // (disjoint token set) never merges — proximity + symbol alone is not enough.
    const decoy = { finder: "correctness", defect_class: "edge-case", path: "src/pay.ts", line: 10, symbol: "processPayment",
      claim: "the retry loop never applies exponential backoff between attempts",
      bad_outcome: "a transient network blip triggers a tight retry storm" };
    const { kept: bKept } = semanticDedupe([q1, decoy]);
    check("(b) a same-path/line/symbol candidate with a disjoint claim is kept separately (not merged)",
      bKept.length === 2, `kept=${bKept.length}`);

    // (c) A null-symbol candidate at the same line, even with an overlapping claim, is never
    // merged — there is nothing to anchor the "same defect" claim to.
    const noSymbol = { finder: "standards", defect_class: "standards", path: "src/pay.ts", line: 10, symbol: null,
      claim: "zero amount refund handling silently succeeds without reversing the charge",
      bad_outcome: "silent success" };
    const { kept: cKept } = semanticDedupe([q1, noSymbol]);
    check("(c) a null-symbol candidate at the same line is kept, never semantically merged",
      cKept.length === 2, `kept=${cKept.length}`);

    // (d) A different path never merges, even with an identical symbol and claim.
    const otherPath = { ...q1, path: "src/other.ts" };
    const { kept: dKept } = semanticDedupe([q1, otherPath]);
    check("(d) a different path never merges", dKept.length === 2, `kept=${dKept.length}`);

    // (e) Reversing the input order yields the same partition — order-determinism from
    // single-linkage grouping, not from which candidate happened to arrive first.
    const forward = semanticDedupe([q1, q2, q3, q4, decoy, noSymbol, otherPath]);
    const reversed = semanticDedupe([otherPath, noSymbol, decoy, q4, q3, q2, q1]);
    check("(e) reversing input order yields the same kept/dropped cardinality",
      forward.kept.length === reversed.kept.length && forward.dropped.length === reversed.dropped.length,
      `forward kept=${forward.kept.length} dropped=${forward.dropped.length}; reversed kept=${reversed.kept.length} dropped=${reversed.dropped.length}`);
    const groupSizeMultiset = (/** @type {{kept:any[],dropped:any[]}} */ r) => {
      const sizes = r.kept.map((k) => 1 + r.dropped.filter((d) => d._dedupe_dropped_for === k.finder
        && d.path === k.path).length);
      return sizes.sort().join(",");
    };
    check("(e) reversing input order yields the same group-size partition",
      groupSizeMultiset(forward) === groupSizeMultiset(reversed),
      `forward=${groupSizeMultiset(forward)} reversed=${groupSizeMultiset(reversed)}`);

    // (f) A semantic merge is never agreement-promoted — markAgreementPromoted is never called on
    // semanticDedupe's output, and no kept record from a semantic-only merge carries the field.
    check("(f) a semantic merge never sets agreement_promoted",
      qKept.every((k) => k.agreement_promoted === undefined));

    // (g) A BRIDGING candidate: A and B share no claim tokens, C overlaps both. Single-linkage
    // closure must put all three in ONE group for every input permutation — a first-match walk
    // over [A,B,C] opens two groups and C joins only the first. And the kept representative must
    // be the same record for every permutation.
    const bA = { finder: "correctness", defect_class: "edge-case", path: "src/br.ts", line: 20, symbol: "bridge", severity_hint: "medium",
      claim: "alpha bravo charlie delta", bad_outcome: "" };
    const bB = { finder: "quality", defect_class: "maintainability", path: "src/br.ts", line: 21, symbol: "bridge", severity_hint: "high",
      claim: "echo foxtrot golf hotel", bad_outcome: "" };
    const bC = { finder: "intent", defect_class: "scope-creep", path: "src/br.ts", line: 22, symbol: "bridge", severity_hint: "low",
      claim: "alpha bravo charlie delta echo foxtrot golf hotel", bad_outcome: "" };
    /** @param {any[]} xs @returns {any[][]} */
    const perms = (xs) => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    const results = perms([bA, bB, bC]).map((p) => semanticDedupe(p));
    check("(g) a bridging candidate merges all three into one group for every permutation",
      results.every((r) => r.kept.length === 1 && r.dropped.length === 2),
      results.map((r) => `kept=${r.kept.length}`).join(" "));
    check("(g) the representative is the same record for every permutation (highest severity_hint)",
      results.every((r) => r.kept.length === 1 && r.kept[0].finder === "quality"),
      results.map((r) => r.kept.map((k) => k.finder).join("+")).join(" "));

    // (h) Calibration edges: the lowest observed TRUE duplicate scored 0.23 and the highest
    // observed DISTINCT same-path pair 0.19, so the floor must admit the first and reject the second.
    const words = (/** @type {string} */ p, /** @type {number} */ n) => Array.from({ length: n }, (_, i) => `${p}word${String.fromCharCode(97 + i)}`);
    const shared3 = words("shared", 3);
    const dupA = { finder: "correctness", defect_class: "edge-case", path: "src/cal.ts", line: 5, symbol: "calib",
      claim: [...shared3, ...words("aaa", 5)].join(" "), bad_outcome: "" };
    const dupB = { finder: "quality", defect_class: "maintainability", path: "src/cal.ts", line: 6, symbol: "calib",
      claim: [...shared3, ...words("bbb", 5)].join(" "), bad_outcome: "" };
    const jDup = jaccard(claimTokens(dupA), claimTokens(dupB));
    check(`(h) a 0.23-Jaccard pair (the lowest calibrated duplicate, got ${jDup.toFixed(3)}) merges`,
      semanticDedupe([dupA, dupB]).kept.length === 1);
    const disA = { ...dupA, claim: [...shared3, ...words("ccc", 6)].join(" ") };
    const disB = { ...dupB, claim: [...shared3, ...words("ddd", 7)].join(" ") };
    const jDis = jaccard(claimTokens(disA), claimTokens(disB));
    check(`(h) a 0.19-Jaccard pair (the highest calibrated distinct pair, got ${jDis.toFixed(3)}) stays separate`,
      semanticDedupe([disA, disB]).kept.length === 2);

    // Explicit decoy pair at the plan's own calibration floor (0.08 observed on the real run):
    // near-zero overlap must never merge even with every other precondition satisfied.
    const lowOverlap1 = { finder: "correctness", defect_class: "edge-case", path: "src/pay.ts", line: 10, symbol: "processPayment",
      claim: "the amount field accepts a negative value with no validation",
      bad_outcome: "a negative amount overdraws the account" };
    const lowOverlap2 = { finder: "quality", defect_class: "maintainability", path: "src/pay.ts", line: 11, symbol: "processPayment",
      claim: "this function is 140 lines long and mixes three concerns",
      bad_outcome: "hard to test in isolation" };
    const { kept: lowKept } = semanticDedupe([lowOverlap1, lowOverlap2]);
    check("low-overlap same-symbol/nearby-line pair is kept separately (below the 0.21 floor)",
      lowKept.length === 2, `kept=${lowKept.length}`);
  }

  if (failed > 0) {
    console.error(`\ndedupe self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ dedupe self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
