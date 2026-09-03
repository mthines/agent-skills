#!/usr/bin/env node
/**
 * fingerprint.mjs — the ONE implementation of the reviewer's finding fingerprint.
 *
 * A fingerprint identifies a *finding shape*, not an occurrence. It is the key the
 * relevance rules, the symbol-knowledge records, and the outcome bus are all filed
 * under, so two runs that find the same problem in the same place must produce the
 * same string — across branches, authors, and re-phrasings of the comment.
 *
 *   fp    = <finder>:<defect-class>:<symbol>@<path>
 *   fp_v  = 2
 *
 * Why v2 exists. v1 was `<category>:<first 6 surviving words of the comment body>`,
 * derived from LLM-generated prose, so the key was a hash of a non-deterministic
 * sentence: the same defect keyed differently on every run and `seen_count` never
 * accumulated (59 of 70 rows in this repo's bucket were stale or unkeyed). v2 is
 * built from enumerable fields the pipeline already has — the finder that produced
 * the candidate, its defect class, and the changed symbol from the impact graph —
 * so it is stable by construction.
 *
 * This file is the single source of truth. It is imported by
 * `build-impact-graph.mjs` and by `scripts/record-comment-relevance.mjs`, and shelled
 * out to by the agent (which cannot import it). Nothing composes a key by hand.
 *
 * Usage:
 *   node fingerprint.mjs build --finder consumer-impact --defect-class contract-break \
 *                              --symbol retryRequest --path src/api/client.ts
 *   node fingerprint.mjs marker <fp>          # the invisible HTML comment for a comment body
 *   node fingerprint.mjs extract              # read a comment body on stdin, print its fp
 *   node fingerprint.mjs parse <fp>           # JSON parts
 *   node fingerprint.mjs match <fp> <pattern> # exit 0 on match, 1 on miss
 *   node fingerprint.mjs --self-test
 *
 * Fail-closed, like every other script here: an unknown finder, an unknown defect
 * class, or a malformed fingerprint exits non-zero with EMPTY stdout, so a caller
 * that forgets to check the status cannot splice an invalid key into a memory write.
 */

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

export const FP_VERSION = 2;

/**
 * Finders (Phase D). The `finder` segment is enumerable so a fingerprint can never
 * carry free text — that is half of what made v1 unstable.
 */
export const FINDERS = [
  "correctness",
  "consumer-impact",
  "dependency",
  "intent",
  "standards",
  "quality",
  "ux",
  "critical",
  "optimality",
];

/**
 * Defect classes, grouped by the finder that normally emits them (any finder may
 * emit any class — the grouping is documentation, the flat list is the contract).
 * These are also the class labels the `bug-detection` eval seeds by, so a recall
 * number is per-class without a second taxonomy.
 */
export const DEFECT_CLASSES = [
  // correctness
  "logic", "edge-case", "error-path", "race", "nil-deref", "resource-leak",
  "security", "data-loss", "perf",
  // consumer-impact
  "contract-break", "missing-update", "pattern-divergence",
  // dependency
  "dep-breaking-change", "dep-deprecated", "dep-unverified",
  // intent
  "intent-mismatch", "scope-creep",
  // standards
  "standards",
  // quality
  "maintainability", "test-gap", "naming",
  // telemetry leads (4.8.3) — the lead becomes an ordinary finding once verified
  "live-error-signature", "missing-signal",
  // ux
  "a11y", "ux",
  // optimality
  "optimality",
];

/**
 * The proposal names this class `contract-break` in the fingerprint grammar and
 * `consumer-break` in the eval's class list. One name wins; the other normalises to
 * it here so the two halves cannot drift into separate key spaces.
 */
export const DEFECT_CLASS_ALIASES = {
  "consumer-break": "contract-break",
  "nit": "naming",
};

const SEGMENT_RE = /^[a-z][a-z0-9-]*$/;

/** A symbol that is unknown or does not apply (a whole-file or whole-PR finding). */
export const NO_SYMBOL = "-";
/** A path that does not apply (a whole-PR finding). */
export const NO_PATH = "-";

export function normalizeDefectClass(defectClass) {
  const raw = String(defectClass ?? "").trim().toLowerCase();
  return DEFECT_CLASS_ALIASES[raw] ?? raw;
}

/**
 * Symbols come from the impact graph (a declaration name) or, for the dependency
 * finder, from a manifest (a package name, which may be scoped: `@stripe/stripe-js`).
 * Strip only what would corrupt a LoreKit key or the grammar: whitespace, `:` and the
 * `::` key separator. Case is preserved — `retryRequest` and `RetryRequest` are
 * different symbols.
 */
export function normalizeSymbol(symbol) {
  const raw = String(symbol ?? "").trim();
  if (!raw || raw === NO_SYMBOL) return NO_SYMBOL;
  const cleaned = raw.replace(/\s+/g, "").replace(/:+/g, "");
  return cleaned || NO_SYMBOL;
}

/** Repo-relative POSIX path. `-` when the finding is whole-PR. */
export function normalizePath(path) {
  const raw = String(path ?? "").trim();
  if (!raw || raw === NO_PATH) return NO_PATH;
  return raw
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\s+/g, "");
}

export class FingerprintError extends Error {}

/**
 * Build a v2 fingerprint. Throws FingerprintError on an unknown finder or defect
 * class — the caller must not invent either.
 */
export function buildFingerprint({ finder, defectClass, symbol, path }) {
  const f = String(finder ?? "").trim().toLowerCase();
  if (!FINDERS.includes(f)) {
    throw new FingerprintError(`unknown finder "${finder}" (known: ${FINDERS.join(", ")})`);
  }
  const d = normalizeDefectClass(defectClass);
  if (!DEFECT_CLASSES.includes(d)) {
    throw new FingerprintError(`unknown defect class "${defectClass}" (known: ${DEFECT_CLASSES.join(", ")})`);
  }
  return `${f}:${d}:${normalizeSymbol(symbol)}@${normalizePath(path)}`;
}

/**
 * Parse a v2 fingerprint into its parts, or null when it is not one. Splits the
 * symbol from the path on the LAST `@` so a scoped package name survives.
 */
export function parseFingerprint(fp) {
  const raw = String(fp ?? "").trim();
  const first = raw.indexOf(":");
  if (first < 1) return null;
  const second = raw.indexOf(":", first + 1);
  if (second < 0) return null;
  const finder = raw.slice(0, first);
  const defectClass = raw.slice(first + 1, second);
  const rest = raw.slice(second + 1);
  const at = rest.lastIndexOf("@");
  if (at < 1) return null;
  const symbol = rest.slice(0, at);
  const path = rest.slice(at + 1);
  if (!SEGMENT_RE.test(finder) || !SEGMENT_RE.test(defectClass)) return null;
  if (!symbol || !path) return null;
  return { fp_v: FP_VERSION, finder, defect_class: defectClass, symbol, path };
}

/**
 * Parse a rule PATTERN. Same grammar as a fingerprint except `*` is allowed in the
 * finder and defect-class segments. Kept separate from `parseFingerprint` on purpose:
 * a concrete fingerprint with a `*` in it is malformed, and only the pattern side may
 * relax the grammar.
 */
export function parsePattern(pattern) {
  const raw = String(pattern ?? "").trim();
  const first = raw.indexOf(":");
  if (first < 1) return null;
  const second = raw.indexOf(":", first + 1);
  if (second < 0) return null;
  const finder = raw.slice(0, first);
  const defectClass = raw.slice(first + 1, second);
  const rest = raw.slice(second + 1);
  const at = rest.lastIndexOf("@");
  if (at < 1) return null;
  const symbol = rest.slice(0, at);
  const path = rest.slice(at + 1);
  const seg = (v) => v === "*" || SEGMENT_RE.test(v);
  if (!seg(finder) || !seg(defectClass)) return null;
  if (!symbol || !path) return null;
  return { finder, defect_class: defectClass, symbol, path };
}

/** True when `fp` is a well-formed v2 fingerprint over the known enums. */
export function isFingerprintV2(fp) {
  const parts = parseFingerprint(fp);
  return !!parts && FINDERS.includes(parts.finder) && DEFECT_CLASSES.includes(parts.defect_class);
}

// ── The invisible marker carried in the comment body ─────────────────────────────
//
// The recorder and the in-run signal read (memory.md § Signals) recover the
// fingerprint from the comment EXACTLY rather than re-deriving it from prose. That
// is the other half of v1's instability: a re-derivation reads whatever the model
// wrote this time.

export const MARKER_RE = /<!--\s*fp:v(\d+):([^\s>]+?)\s*-->/;

export function marker(fp) {
  if (!isFingerprintV2(fp)) throw new FingerprintError(`refusing to render a marker for a non-v2 fingerprint: ${fp}`);
  return `<!-- fp:v${FP_VERSION}:${fp} -->`;
}

/**
 * Recover a fingerprint from a comment body. Returns `{fp, fp_v}` or null.
 * A v1 body (no marker) is reported as `fp_v: 1` with the legacy derivation, so a
 * pre-existing thread still keys consistently with the rows already written for it —
 * v1 rows are READ for back-compat and never written (§4.7.1).
 */
export function extractFingerprint(body) {
  const text = String(body ?? "");
  const m = MARKER_RE.exec(text);
  if (m) {
    const version = parseInt(m[1], 10);
    const fp = m[2];
    if (version === FP_VERSION && isFingerprintV2(fp)) return { fp, fp_v: FP_VERSION, source: "marker" };
    // A marker we cannot validate is worse than none: it looks authoritative.
    return { fp, fp_v: version, source: "marker-unrecognised", valid: false };
  }
  const legacy = deriveLegacyFingerprint(text);
  return legacy ? { fp: legacy, fp_v: 1, source: "derived" } : null;
}

// ── v1 (legacy) derivation — read-only ───────────────────────────────────────────
//
// Kept verbatim in behaviour from the original `fingerprint()` in
// scripts/record-comment-relevance.mjs so v1 rows keep resolving to the same key.
// Do not "improve" it: any change re-keys history that is already written.

const CC_PREFIXES = ["issue", "suggestion", "nitpick", "nit", "question", "praise", "chore"];
const TIER_TAG_RE = /\((?:critical|high|medium|low)\)/gi;
const STOPWORDS_RE = /\b(this|that|the|a|an|is|it|in|on|at|to|of|for|and|or|but|with|can|you|we|should|would|could|please|here|if|then|when|be)\b/g;

export function deriveLegacyFingerprint(commentBody) {
  const body = String(commentBody ?? "");
  let category = "suggestion";
  for (const prefix of CC_PREFIXES) {
    if (new RegExp(`^\\*?\\*?${prefix}(?:\\s*\\((?:critical|high|medium|low)\\))?\\s*[:(]`, "i").test(body.trim())) {
      category = prefix === "nit" ? "nitpick" : prefix;
      break;
    }
  }
  const cleaned = body
    .replace(TIER_TAG_RE, " ")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9 ]/gi, " ")
    .toLowerCase()
    .replace(STOPWORDS_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, 6);
  const claimGist = words.join("-") || "general-finding";
  return `${category}:${claimGist}`;
}

// ── Rule patterns ────────────────────────────────────────────────────────────────
//
// A relevance rule (§4.7.2) may be scoped wider than one fingerprint:
//   consumer-impact:contract-break:*@src/legacy/**   — this class, any symbol, under src/legacy
//   correctness:nil-deref:*@*                        — this class anywhere
// `*` matches within one path segment; `**` crosses segments. Nothing else is glob.

function globToRe(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { out += "[\\s\\S]*"; i++; if (glob[i + 1] === "/") i++; }
      else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/**
 * Does a concrete fingerprint fall under a rule pattern?
 * Both must parse; a malformed pattern never matches (fail-closed — a broken rule
 * must not silently suppress everything).
 */
export function fingerprintMatches(fp, pattern) {
  const a = parseFingerprint(fp);
  const b = parsePattern(pattern);
  if (!a || !b) return false;
  if (b.finder !== "*" && b.finder !== a.finder) return false;
  if (b.defect_class !== "*" && b.defect_class !== a.defect_class) return false;
  if (b.symbol !== "*" && b.symbol !== a.symbol) return false;
  if (b.path !== "*" && !globToRe(b.path).test(a.path)) return false;
  return true;
}

// ── Self-test — executed by L1, so a regression here fails CI ────────────────────

function selfTest() {
  const cases = [];
  const t = (name, fn) => cases.push([name, fn]);
  const throws = (fn) => { try { fn(); return false; } catch { return true; } };

  t("builds the canonical example", () =>
    buildFingerprint({ finder: "consumer-impact", defectClass: "contract-break", symbol: "retryRequest", path: "src/api/client.ts" })
      === "consumer-impact:contract-break:retryRequest@src/api/client.ts");

  t("unknown finder is fail-closed", () =>
    throws(() => buildFingerprint({ finder: "persona1", defectClass: "logic", symbol: "x", path: "a.ts" })));

  t("unknown defect class is fail-closed", () =>
    throws(() => buildFingerprint({ finder: "correctness", defectClass: "vibes", symbol: "x", path: "a.ts" })));

  t("consumer-break normalises to contract-break (one key space)", () =>
    buildFingerprint({ finder: "consumer-impact", defectClass: "consumer-break", symbol: "f", path: "a.ts" })
      === "consumer-impact:contract-break:f@a.ts");

  t("a scoped package survives the symbol/path split", () => {
    const fp = buildFingerprint({ finder: "dependency", defectClass: "dep-breaking-change", symbol: "@stripe/stripe-js", path: "package.json" });
    const p = parseFingerprint(fp);
    return p.symbol === "@stripe/stripe-js" && p.path === "package.json";
  });

  t("a missing symbol becomes '-', not empty", () =>
    buildFingerprint({ finder: "intent", defectClass: "scope-creep", symbol: "", path: "" })
      === "intent:scope-creep:-@-");

  t("path is normalised (leading ./, backslashes, doubled slashes)", () =>
    parseFingerprint(buildFingerprint({ finder: "quality", defectClass: "test-gap", symbol: "f", path: ".\\src//a.ts" })).path === "src/a.ts");

  t("case is preserved in symbols", () =>
    parseFingerprint(buildFingerprint({ finder: "correctness", defectClass: "logic", symbol: "RetryRequest", path: "a.ts" })).symbol === "RetryRequest");

  t("parse rejects a non-fingerprint", () =>
    parseFingerprint("just some prose") === null && parseFingerprint("a:b") === null && parseFingerprint("") === null);

  t("isFingerprintV2 rejects an unknown enum member", () =>
    !isFingerprintV2("persona1:logic:f@a.ts") && !isFingerprintV2("correctness:vibes:f@a.ts")
    && isFingerprintV2("correctness:logic:f@a.ts"));

  t("marker round-trips exactly", () => {
    const fp = "correctness:nil-deref:parseConfig@src/config/load.ts";
    const body = `issue (high): something\n\n${marker(fp)}`;
    const got = extractFingerprint(body);
    return got.fp === fp && got.fp_v === 2 && got.source === "marker";
  });

  t("marker refuses a non-v2 fingerprint", () => throws(() => marker("issue:some-old-gist")));

  t("an unrecognised marker version is reported invalid, not silently derived", () => {
    const got = extractFingerprint("issue: x\n<!-- fp:v9:whatever@here -->");
    return got.fp_v === 9 && got.valid === false;
  });

  t("a body with no marker falls back to the v1 derivation, tagged fp_v 1", () => {
    const got = extractFingerprint("issue (high): the retry loop never resets the counter");
    return got.fp_v === 1 && got.source === "derived" && got.fp.startsWith("issue:");
  });

  t("the v1 derivation is unchanged: tier tag never enters the gist", () =>
    deriveLegacyFingerprint("issue (high): retry loop leaks") === deriveLegacyFingerprint("issue: retry loop leaks"));

  t("the v1 derivation keeps digits in a gist", () =>
    deriveLegacyFingerprint("issue: 500 responses not retried").includes("500"));

  t("rule pattern matches on a path glob", () =>
    fingerprintMatches("consumer-impact:contract-break:foo@src/legacy/a/b.ts", "consumer-impact:contract-break:*@src/legacy/**")
    && !fingerprintMatches("consumer-impact:contract-break:foo@src/modern/a.ts", "consumer-impact:contract-break:*@src/legacy/**"));

  t("a single * does not cross a path segment", () =>
    fingerprintMatches("correctness:logic:f@src/a.ts", "correctness:logic:*@src/*")
    && !fingerprintMatches("correctness:logic:f@src/deep/a.ts", "correctness:logic:*@src/*"));

  t("a wildcard class matches any class", () =>
    fingerprintMatches("correctness:race:f@a.ts", "correctness:*:*@*"));

  t("a malformed pattern never matches (a broken rule suppresses nothing)", () =>
    !fingerprintMatches("correctness:logic:f@a.ts", "correctness:logic")
    && !fingerprintMatches("correctness:logic:f@a.ts", ""));

  t("a fingerprint carries no '::' that would split a LoreKit key", () =>
    !buildFingerprint({ finder: "correctness", defectClass: "logic", symbol: "a::b", path: "a.ts" }).includes("::"));

  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch (err) { ok = false; process.stderr.write(`self-test THREW: ${name}: ${err.message}\n`); }
    if (!ok) { failed++; process.stderr.write(`self-test FAIL: ${name}\n`); }
  }
  if (failed > 0) process.exit(1);
  process.stderr.write(`self-test OK: ${cases.length} cases\n`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  try {
    if (cmd === "--self-test") return selfTest();
    if (cmd === "build") {
      const fp = buildFingerprint({
        finder: flag(args, "finder"),
        defectClass: flag(args, "defect-class"),
        symbol: flag(args, "symbol"),
        path: flag(args, "path"),
      });
      process.stdout.write(`${fp}\n`);
      return;
    }
    if (cmd === "marker") {
      process.stdout.write(`${marker(args[1])}\n`);
      return;
    }
    if (cmd === "extract") {
      const body = args[1] === "--file" ? readFileSync(args[2], "utf8") : readFileSync(0, "utf8");
      const got = extractFingerprint(body);
      if (!got) throw new FingerprintError("no fingerprint in body");
      process.stdout.write(`${JSON.stringify(got)}\n`);
      return;
    }
    if (cmd === "parse") {
      const parts = parseFingerprint(args[1]);
      if (!parts) throw new FingerprintError(`not a v2 fingerprint: ${args[1]}`);
      process.stdout.write(`${JSON.stringify(parts)}\n`);
      return;
    }
    if (cmd === "match") {
      process.exit(fingerprintMatches(args[1], args[2]) ? 0 : 1);
    }
    throw new FingerprintError(
      "usage: fingerprint.mjs build --finder F --defect-class C --symbol S --path P | marker <fp> | extract [--file f] | parse <fp> | match <fp> <pattern> | --self-test",
    );
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
