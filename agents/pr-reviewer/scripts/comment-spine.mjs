#!/usr/bin/env node
// The shared vocabulary of the two pr-reviewer output surfaces.
//
// Why this module exists: the report and the inline findings are the same reviewer speaking, and a
// reader who learns one should already know the other. That only holds if the severity glyphs, the
// attribution footer, the caps, and the button markup have exactly ONE definition — a second copy
// drifts on the first edit that touches only one surface, which is how the two surfaces came to
// share no visual vocabulary at all (no shared footer, glyphs on the report only, a title on
// neither).
//
// Both renderers import this. Nothing here reads argv, stdin, or the filesystem; it is pure so a
// caller cannot get a different vocabulary by calling it differently.
//
// The division of labour with each renderer: this file owns what the two surfaces AGREE on, each
// renderer owns its own layout. A constant used by one surface only does not belong here.

/** Severity tiers, worst first. Order is load-bearing: `worstTier` and the tally both rely on it. */
export const TIERS = ["critical", "high", "medium", "low"];

/**
 * The tier glyph set. Already the report's vocabulary before this module existed (the accordion's
 * severity tally); the inline surface now uses the same four, which is most of what makes the two
 * read as one system.
 */
export const TIER_GLYPH = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" };

/** The verdict glyph on the report headline. Not a tier — a whole-run state. */
export const VERDICT_GLYPH = { PASS: "✅", WARN: "⚠️", FAIL: "❌" };
export const VERDICTS = Object.keys(VERDICT_GLYPH);

/** Conventional-Comments prefixes this reviewer emits (`conventional-comments.md § Category`). */
export const CONV_PREFIXES = ["praise", "nitpick", "suggestion", "issue", "question"];

/**
 * Prefixes that carry a claim — the ones that get a title, an `Evidence:` line, a fix fence, a
 * fingerprint marker, and a fix button. The rest are one-liners and stay one-liners: a title on a
 * `nitpick` costs more vertical space than the nitpick is worth, which is the whole reason the
 * inline surface was kept terse in the first place.
 */
export const CLAIM_PREFIXES = ["issue", "suggestion"];

// ── caps ─────────────────────────────────────────────────────────────────────────────────────────
//
// The title takes 60 of the old 240-char prose budget and the prose drops to 200, so the posted
// total is ~20 chars above where it was rather than 60 — the title replaces the opening clause that
// used to do its job badly, it does not add to it.
export const TITLE_MAX = 60;
export const PROSE_MAX = 200;
export const EVIDENCE_MAX = 180;
export const EVIDENCE_REFS_MAX = 3;
export const FENCE_MAX_LINES = 10;
export const GATE_DETAILS_MAX = 120;

/** A 7-char sha, everywhere. Both surfaces render the same length or neither is trustworthy. */
export const SHA7 = /^[0-9a-f]{7}$/;

/** Where the button images live (`agent0-fix-links.md § Button markup`). */
export const ASSET_BASE =
  "https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets";

/** The two Agent0 hosts (`agent0-fix-links.md § Environment`). Anything else is rejected. */
export const AGENT0_HOST_RE = /^https:\/\/app\.dash0(-dev)?\.com\//;

/** Where the footer's one link points. */
export const AGENT_URL =
  "https://github.com/mthines/agent-skills/blob/main/agents/pr-reviewer.md";

/** The reviewer's own name, as it appears to a reader. One spelling, both surfaces. */
export const AGENT_NAME = "pr-reviewer";

/**
 * The worst tier present in a findings array, or null for an empty one.
 * Drives the report headline's glyph, so it must agree with the tally beneath it.
 */
export function worstTier(findings) {
  for (const tier of TIERS) {
    if (findings.some((f) => f.tier === tier)) return tier;
  }
  return null;
}

/**
 * `🟠 high` — the glyph paired with its word, always.
 *
 * WCAG 1.4.1: a glyph alone is not a state. The report's severity line used to render
 * `🔴 3 · 🟠 1`, which a reader who does not already know the mapping cannot read at all and a
 * screen reader announces as four colour names. The word is what makes the glyph a scanning aid
 * rather than the only carrier of the meaning.
 */
export function tierBadge(tier) {
  if (!TIERS.includes(tier)) throw new Error(`unknown tier: ${JSON.stringify(tier)}`);
  return `${TIER_GLYPH[tier]} ${tier}`;
}

/** `🔴 3 critical · 🟠 1 high` — zero tiers omitted, order fixed by TIERS. */
export function tierTally(counts) {
  return TIERS
    .filter((t) => Number.isInteger(counts?.[t]) && counts[t] > 0)
    .map((t) => `${TIER_GLYPH[t]} ${counts[t]} ${t}`)
    .join(" · ");
}

/**
 * The attribution footer. ONE string, both surfaces.
 *
 * This is the single cue that makes a report and an inline comment read as the same reviewer, and
 * before this function neither surface had it: the report's was collapsed inside `Review details`
 * (so a reader of the closed report saw no attribution and no commit) and the inline comments had
 * none at all — which matters most exactly where an inline comment is usually read, in a
 * notification email with no surrounding page to identify the author.
 *
 * `run` is the report's own addition (the run mode / delta phrase); `at` likewise. An inline
 * comment passes neither, so the two footers differ only by what only the report knows.
 *
 * The `commit \`<sha>\`` substring is load-bearing provenance, not decoration: a sticky is an issue
 * comment and has no `commit_id`, so this is the only record of what was reviewed — and it is what
 * `pr-reviewer`'s own fallback rung reads to recover a delta baseline when its state record is
 * unusable (`reviewer-report-ingest.md § Footer SHA`). Keep it matchable by that substring alone.
 */
export function footerLine({ sha, run = null, at = null }) {
  if (!SHA7.test(String(sha))) {
    throw new Error(`footer sha must be exactly 7 lowercase hex chars, got ${JSON.stringify(sha)}`);
  }
  const parts = [`\`${AGENT_NAME}\``, `commit \`${sha}\``];
  if (run) parts.push(String(run));
  parts.push(`[how these findings are produced](${AGENT_URL})`);
  if (at) parts.push(`updated ${at} UTC`);
  return `<sup>${parts.join(" · ")}</sup>`;
}

/**
 * A fix button: a theme-aware linked image.
 *
 * `<picture>` with `media="(prefers-color-scheme: dark)"` is how GitHub does theme-aware images,
 * and it is why two asset variants exist. A single dark chip reads as a near-black blob in GitHub's
 * light theme, where every other control is light — the button is the primary call to action of the
 * whole review, so it should not be the one element that ignores the reader's theme.
 *
 * **The anchor is HTML, not markdown link syntax.** `[<picture>…</picture>](url)` puts a block of
 * raw HTML inside a markdown link, and whether the parser treats that HTML as the link's inline
 * content is not something this repo can verify without posting a comment — a broken button reads
 * as a broken reviewer. `<a href>` wrapping `<picture>` needs no markdown parsing at all, and both
 * elements are on GitHub's comment HTML allowlist. It is written on ONE line because a blank line
 * inside inline HTML ends the HTML block.
 */
export function fixButton({ kind, url, label }) {
  if (!["this", "all"].includes(kind)) throw new Error(`fixButton kind must be this|all`);
  assertBareUrl(url);
  if (!AGENT0_HOST_RE.test(url)) {
    throw new Error("fix-button host must be app.dash0.com or app.dash0-dev.com (agent0_environment)");
  }
  const stem = kind === "all" ? "fix-all-agent0" : "fix-this-agent0";
  const alt = label ?? (kind === "all" ? "Fix all with Agent0" : "Fix with Agent0");
  // The label lands in an `alt` attribute and an `href`, so anything that could close either is
  // rejected rather than escaped: every caller passes a literal, so a reject here means a bug in
  // the caller, not a value that needs rescuing.
  if (/["'<>&]/.test(alt)) {
    throw new Error(`fix-button label must be plain text (no quotes or angle brackets): ${alt}`);
  }
  if (/["'<>]/.test(url)) throw new Error("fix-button url must not contain quotes or angle brackets");
  // `&` → `&amp;` in the attribute. Not pedantry: browsers still do legacy entity matching without
  // a trailing semicolon for a set of named references, and `&reg` is one of them — so a query
  // string carrying `&reg=` in an unescaped href can be read as `®=`. The deep link's own
  // encoding (build-agent0-link.mjs) cannot help here, because the `&` separators are supposed to
  // be literal `&` in the URL; only the HTML layer can escape them.
  const href = url.replace(/&/g, "&amp;");
  return `<a href="${href}"><picture>`
    + `<source media="(prefers-color-scheme: dark)" srcset="${ASSET_BASE}/${stem}-dark.svg">`
    + `<img alt="${alt}" src="${ASSET_BASE}/${stem}-light.svg" height="36"></picture></a>`;
}

/**
 * A URL fit to sit inside `](…)`.
 *
 * A literal `)` terminates the markdown link, which is why `build-agent0-link.mjs` owns the
 * encoding; this is the fail-closed check that the encoding actually ran.
 */
export function assertBareUrl(url) {
  const u = String(url);
  if (!/^https?:\/\//.test(u)) throw new Error(`url must be http(s), got ${JSON.stringify(u.slice(0, 60))}`);
  if (/[)\s]/.test(u)) {
    throw new Error("url must be bare (no spaces or ')') — encode per build-agent0-link.mjs");
  }
}

/**
 * `path:line` → an inline-code anchor, or a real link when a permalink is available.
 *
 * Never accept a pre-built markdown link from a caller: that is how a link once shipped caged
 * inside a code span and rendered as dead monospace text.
 */
export function anchor({ path, line, url }) {
  if (!path || String(path).trim() === "") throw new Error("anchor.path is required");
  if (String(path).includes("`")) throw new Error("anchor.path must not contain a backtick");
  if (line !== undefined && line !== null && !/^\d+(,\d+)*$/.test(String(line))) {
    throw new Error(`anchor.line must be a line number, got ${JSON.stringify(line)}`);
  }
  const label = line === undefined || line === null ? String(path) : `${path}:${line}`;
  if (url !== undefined && url !== null && String(url).trim() !== "") {
    assertBareUrl(url);
    return `[\`${label}\`](${url})`;
  }
  return `\`${label}\``;
}

/**
 * Prose that must not carry markup the renderer adds itself.
 *
 * Two bars, and the split is deliberate. Identifier fields (`path`, `key`, `title`) are wrapped or
 * emphasised by the renderer, so a backtick inside one would terminate that span. Prose fields keep
 * their inline code, because a finding body naming a symbol without backticks fails its own rule.
 */
export function assertPlain(where, v, { allowCode = false } = {}) {
  const s = String(v);
  if (/\[[^\]]*\]\([^)]*\)/.test(s)) {
    throw new Error(`${where} contains a markdown link — supply the url in its own field`
      + ` (got: ${s.slice(0, 60)})`);
  }
  if (!allowCode && s.includes("`")) {
    throw new Error(`${where} contains a backtick — supply plain text (got: ${s.slice(0, 60)})`);
  }
  if (s.includes("\n")) throw new Error(`${where} contains a newline — it must be a single line`);
}

/**
 * Sentence count over prose, matching `comment-shape.md § Mechanical pre-emit check`: `.`, `!`, `?`
 * count, and punctuation inside backticks or a fenced block does not.
 */
export function sentenceCount(prose) {
  const bare = String(prose).replace(/`[^`]*`/g, "");
  return [...bare].filter((c) => ".!?".includes(c)).length;
}

/** The structural shapes a body may never open with (`comment-shape.md § Hard caps`). */
export const FORBIDDEN_OPENERS = ["#", "## ", "### ", "- ", "* ", "1. "];

export function assertNoStructure(where, prose) {
  const s = String(prose).trimStart();
  if (FORBIDDEN_OPENERS.some((p) => s.startsWith(p))) {
    throw new Error(`${where} opens with a heading or a list marker — neither is permitted in a`
      + " comment body (comment-shape.md § Hard caps)");
  }
}

/** Reject a field the caller supplied for a surface that does not have it. */
export function assertAbsent(where, v, why) {
  if (v !== undefined && v !== null && String(v).trim() !== "") {
    throw new Error(`${where} must be absent — ${why}`);
  }
}
