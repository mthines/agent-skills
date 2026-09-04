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
/**
 * The `(unverified: …)` tag on line 1. Short because line 1 is the only part of a comment that is
 * always read, and because the agent body's own 320-char line-1 ceiling budgets for
 * `title + decoration + prose` and nothing else.
 */
export const UNVERIFIED_MAX = 40;
export const EVIDENCE_MAX = 180;
export const EVIDENCE_REFS_MAX = 3;
export const FENCE_MAX_LINES = 10;
export const GATE_DETAILS_MAX = 120;

/** A 7-char sha, everywhere. Both surfaces render the same length or neither is trustworthy. */
export const SHA7 = /^[0-9a-f]{7}$/;

/** Where the button images live (`agent0-fix-links.md § Button markup`). */
export const ASSET_BASE =
  "https://raw.githubusercontent.com/mthines/agent-skills/main/agents/pr-reviewer/assets";

/**
 * The words each button asset renders. Load-bearing, not documentation: `fixButton` uses these as
 * the `alt` and rejects any other label, so the accessible name and the visible one cannot diverge.
 * Change one of these and you must change the matching SVG's `<text>` (and re-measure `textLength`
 * — `agent0-fix-links.md § Button markup`).
 */
export const ASSET_TEXT = { all: "Fix all with Agent0", this: "Fix with Agent0" };

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
 * What is shared is the **identity** half — `` `pr-reviewer` · commit `<sha>` `` — and it is
 * byte-identical on both surfaces. Everything after it is the report's, because it is either
 * something only the report knows (`run`, the run mode / delta phrase; `at`, the rewrite stamp) or
 * something that reads as noise repeated per finding (`docs`).
 *
 * **`docs` is report-only, and off by default.** The methodology link belongs once per review, on
 * the object that *is* the review — a reader asking "how were these produced" is asking about the
 * run, not about the one finding in front of them. Repeating it on every inline comment spent a
 * third of a one-line footer restating the same link 4–20 times on a busy PR, and pushed the commit
 * sha (which is load-bearing, below) further from the eye. Defaulting it OFF rather than having the
 * inline renderer opt out is deliberate: a surface has to *ask* for the link, so a new one cannot
 * inherit it by omission, and the inline footer cannot silently regain it in a refactor.
 *
 * The `commit \`<sha>\`` substring is load-bearing provenance, not decoration: a sticky is an issue
 * comment and has no `commit_id`, so this is the only record of what was reviewed — and it is what
 * `pr-reviewer`'s own fallback rung reads to recover a delta baseline when its state record is
 * unusable (`reviewer-report-ingest.md § Footer SHA`). Keep it matchable by that substring alone.
 */
export function footerLine({ sha, run = null, at = null, docs = false }) {
  if (!SHA7.test(String(sha))) {
    throw new Error(`footer sha must be exactly 7 lowercase hex chars, got ${JSON.stringify(sha)}`);
  }
  const parts = [`\`${AGENT_NAME}\``, `commit \`${sha}\``];
  if (run) parts.push(String(run));
  if (docs) parts.push(`[how these findings are produced](${AGENT_URL})`);
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
 *
 * **Two `<source>` elements and a plain `<img>` default — GitHub's documented form**, not one
 * `<source>` with the light asset doing double duty as the default. `<picture>` picks a `<source>`
 * by media query and, crucially, does NOT fall back to `<img>` when the chosen resource fails to
 * load, so the default is not a safety net for a bad `srcset`; it is what renderers that ignore
 * `<source>` altogether display — and that set includes GitHub's own notification emails and RSS,
 * where an inline finding is very often first read. Pointing the default at the theme-suffixed
 * light file made those readers depend on a file that only shipped with the theme split; the
 * unsuffixed `{stem}.svg` has been on the default branch since before it, so it degrades to a
 * button rather than to a broken image.
 */
export function fixButton({ kind, url, label }) {
  if (!["this", "all"].includes(kind)) throw new Error(`fixButton kind must be this|all`);
  assertBareUrl(url);
  if (!AGENT0_HOST_RE.test(url)) {
    throw new Error("fix-button host must be app.dash0.com or app.dash0-dev.com (agent0_environment)");
  }
  const stem = kind === "all" ? "fix-all-agent0" : "fix-this-agent0";
  // The accessible name must be the words the asset actually renders. `alt` is the only part of
  // this button a caller could vary, and the asset's `<text>` is a fixed string with a pinned
  // `textLength` — so a caller-supplied label was a name no sighted reader could see, and one that
  // disagreed with the visible label (WCAG 2.2 SC 2.5.3). `Fix all 5 with Agent0` and
  // `Fix the failing checks with Agent0` were both reaching only the alt attribute.
  //
  // A label argument is still accepted so the call sites read explicitly, but it may only restate
  // the asset's text. Anything a caller wants to say beyond that belongs in the prose next to the
  // button, or in a new asset — the chip's pixels are the contract.
  const alt = ASSET_TEXT[kind];
  if (label !== undefined && label !== null && label !== alt) {
    throw new Error(`fix-button label must match the asset's rendered text (${JSON.stringify(alt)})`
      + ` — got ${JSON.stringify(label)}, which no sighted reader would see`);
  }
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
    + `<source media="(prefers-color-scheme: light)" srcset="${ASSET_BASE}/${stem}-light.svg">`
    + `<img alt="${alt}" src="${ASSET_BASE}/${stem}.svg" height="36"></picture></a>`;
}

/** Every asset file `fixButton` can reference, as bare filenames under `agents/pr-reviewer/assets`. */
export const ASSET_FILES = ["fix-this-agent0", "fix-all-agent0"]
  .flatMap((stem) => [`${stem}.svg`, `${stem}-dark.svg`, `${stem}-light.svg`]);

/**
 * The distinct `ASSET_BASE` URLs a body references.
 *
 * Separate from `relayUnsafeUrls` because it answers a different question, and one no offline check
 * can: does the image this button is made of actually exist at the URL the markup names? A button
 * whose asset 404s is not a mangled comment — the markup is intact and the link works — it is a
 * broken-image icon next to link text, which reads as a broken reviewer just as badly.
 *
 * This is a live failure mode, not a hypothetical. `ASSET_BASE` is pinned to the default branch, so
 * an asset added on a feature branch does not exist at the URL the renderer builds until that
 * branch merges — every button on mthines/agent-skills#165 pointed at a 404 for exactly that
 * reason, including on the runs whose markup survived the relay intact.
 */
export function assetUrls(body) {
  const base = ASSET_BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...new Set(String(body).match(new RegExp(`${base}/[A-Za-z0-9._-]+`, "g")) ?? [])];
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
  // Whitelist RFC 3986's characters rather than blacklisting the ones seen to break: a URL that
  // needs anything else needs percent-encoding, which `build-agent0-link.mjs` already does.
  //
  // The backtick is why this is a whitelist. A backtick inside an `href` is doubly fatal on
  // GitHub — it corrupts the attribute AND opens a markdown code span, so the parser escapes the
  // rest of the inline HTML and the button renders as a wall of `&gt;&lt;picture&gt;` text with a
  // dead link. Observed on mthines/agent-skills#165. The old blacklist caught a backtick only at
  // position 0 (via the scheme test) and passed one anywhere else.
  const illegal = [...u].find((c) => !/[A-Za-z0-9\-._~:/?#[\]@!$&'*+,;=%]/.test(c));
  if (illegal !== undefined) {
    throw new Error(`url contains ${JSON.stringify(illegal)}, which is not a legal URL character`
      + " — percent-encode it (build-agent0-link.mjs)");
  }
}

/**
 * The longest URL that survives a relayed write intact.
 *
 * Some write paths carry the body as a tool-call argument rather than a file, and a relay on that
 * path rewrites long unbroken runs — it wraps the run in a `` `` `` code span, which closes the
 * `href` and escapes the markup after it, so the button renders as a wall of `&gt;&lt;picture&gt;`
 * text with a dead link. The renderer's markup is correct; the transform happens after it.
 *
 * Measured on mthines/agent-skills#165 by posting URLs through the relay and reading the stored
 * body back. Lengths are of the URL **as it sits in the body** — `&` is written `&amp;` inside an
 * `href`, so a URL with two params is 8 chars longer here than `url.length` says. Measuring the
 * unescaped form is a real bug: it under-counts exactly the shape this pipeline builds.
 *
 *   | URL                            | in body | stored  |
 *   | ------------------------------ | ------- | ------- |
 *   | Agent0 host+path, no query     |      56 | intact  |
 *   | + `auto_submit=true`           |      78 | intact  |
 *   | + short `initial_prompt`       |     109 | intact  |
 *   | prose-encoded prompt           |     140 | intact  |
 *   | prose-encoded prompt           |     167 | wrapped |
 *   | prose-encoded prompt           |     200 | wrapped |
 *   | a real `fix-this` link         |     230 | wrapped |
 *
 * Host, path, `auto_submit`, and prompt-like query content are all innocent — every short URL
 * survived, including ones carrying `initial_prompt=Fix…`. Length is the whole trigger. A run of
 * repeated identical characters trips it earlier (~75), which is why the budget is stated against
 * prose-encoded URLs, the only shape this pipeline actually builds.
 *
 * No markup change can evade it. Breaking the tag across lines leaves the URL itself as one
 * unbroken run, and a pure-markdown linked image is rewritten too.
 *
 * So the budget is a fact about the relay, not a limit worth designing the link around: a
 * full-fidelity Agent0 prompt does not fit in 140 chars, and truncating it to fit would ship a
 * button that opens a session with no idea what to fix. The rule is therefore to WITHHOLD the
 * button on a relayed write (`--no-fix-links`) and keep it on a file-based one — see
 * `agents/shared/rules/agent0-fix-links.md` § Relay length limit.
 */
export const RELAY_SAFE_URL_MAX = 140;

/**
 * The URLs in `body` that a relayed write would rewrite. Empty ⇒ the body is relay-safe.
 *
 * Advisory, unlike `assertPostable`: it predicts damage a specific write path would do, and the
 * file-based path does none of it. The caller decides — the reviewer withholds fix links; nothing
 * fails a render.
 */
export function relayUnsafeUrls(body) {
  const bare = String(body).replace(/^```[\s\S]*?^```/gm, "");
  const urls = bare.match(/https?:\/\/[^\s"'()<>]+/g) ?? [];
  return [...new Set(urls.filter((u) => u.length > RELAY_SAFE_URL_MAX))];
}

/**
 * Of the relay-unsafe URLs, the ones the documented remedy actually removes.
 *
 * This partition is the difference between a gate and a dead end. `relayUnsafeUrls` answers
 * "what would the relay rewrite", which is every long URL in the body — but the remedy is
 * `--no-fix-links`, and that removes exactly one kind: an Agent0 deep link. A long link to
 * anything else (a `raw.githubusercontent.com` asset path, a LoreKit doc URL cited as evidence,
 * a permalink from the diff) survives the remedy untouched, so a caller that treats the
 * unpartitioned list as its withhold signal re-renders, re-checks, and gets the identical
 * failure — with nothing left to try and no way to tell that it never could have passed.
 *
 * The two classes get different answers because only one of them has an honest fix:
 *
 * - **A fix-link over budget** — withhold the buttons. The affordance is lost, the report is
 *   whole, and the next run on a file-based path posts it intact.
 * - **Anything else over budget** — post as rendered and note it. A citation cannot be dropped to
 *   satisfy a relay, and the damage is not symmetric: a mangled doc link is a citation the reader
 *   has to retype, while a mangled button is a primary CTA that silently does nothing.
 */
export function relayUnsafeFixLinks(body) {
  return relayUnsafeUrls(body).filter((u) => AGENT0_HOST_RE.test(u));
}

/**
 * The last gate before a body is posted: does this text still look like renderer output?
 *
 * Every other guard in this pipeline runs **before** the renderer writes to stdout. That is enough
 * on the `gh` path, which posts the bytes from a file (`--field body=@/tmp/report-body.md`), but
 * not on the MCP path, where the body has to travel through a tool-call argument — a copy no shell
 * performs and nothing downstream re-checks. On #165 that copy arrived HTML-escaped and wrapped in
 * a code span, on both surfaces, and every upstream guard had already passed.
 *
 * So this function takes the FINAL text, not a payload, and is meant to be run on whatever is
 * actually about to be written. It is exported as a CLI (`node comment-spine.mjs --check <file>`)
 * for exactly that reason.
 *
 * Fenced regions are excluded first: a ``` fence contains a double backtick as a substring, and a
 * quoted diff can legitimately contain anything at all.
 */
export function assertPostable(where, body) {
  const s = String(body);
  const bare = s.replace(/^```[\s\S]*?^```/gm, "");

  // 1. Escaped inline HTML. The renderers emit `<a>`, `<picture>`, `<source>`, `<img>` and
  //    `<details>` raw; an escaped form means something re-encoded the markup in transit.
  for (const sig of ["&lt;picture", "&lt;source", "&lt;a href", "&gt;&lt;", "&lt;img", "&lt;/a&gt;"]) {
    if (bare.includes(sig)) {
      throw new Error(`${where} carries escaped inline HTML (${sig}) — the markup was re-encoded`
        + " after the renderer wrote it; post the renderer's bytes verbatim");
    }
  }

  // 2. A backtick inside an href. Fatal for the reason assertBareUrl now rejects it, and worth
  //    checking again here because this sees the assembled body, including any hand-added slot.
  const hrefs = bare.match(/href="[^"]*"/g) ?? [];
  for (const h of hrefs) {
    if (h.includes("`")) {
      throw new Error(`${where} has a backtick inside an href (${h.slice(0, 60)}…) — it closes the`
        + " attribute and opens a code span, which escapes the surrounding markup");
    }
  }

  // 3. A link caged in a code span, in either direction: the whole link wrapped, or a stray
  //    backtick opening right after `](`. Both render as dead monospace text.
  const caged = bare.match(/``?\s*\[[^\]]*\]\([^)]*\)\s*``?/g);
  if (caged) throw new Error(`${where} traps a markdown link inside a code span: ${caged[0].slice(0, 90)}`);
  const cagedUrl = bare.match(/\]\(\s*`/);
  if (cagedUrl) {
    throw new Error(`${where} opens a code span inside a link target — the url must sit bare`
      + " between the parentheses");
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

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
//
// `node comment-spine.mjs --check <file>` runs `assertPostable` over a final body and exits
// non-zero with the reason on stderr. This is the only executable form of the "post the renderer's
// bytes verbatim" rule, and it exists so the pre-write assertion blocks in `pr-reviewer.md` can
// call the same code the renderers do instead of re-deriving the signatures as greps that drift.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flags = { check: null, relayCheck: null, assetsCheck: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") flags.check = argv[++i];
    else if (a === "--relay-check") flags.relayCheck = argv[++i];
    else if (a === "--assets-check") flags.assetsCheck = argv[++i];
    else {
      process.stderr.write(`unknown argument: ${a}\n`
        + "usage: comment-spine.mjs --check <body-file> | --relay-check <body-file>"
        + " | --assets-check <body-file>\n");
      process.exit(2);
    }
  }
  if (flags.assetsCheck) {
    const { readFileSync } = await import("node:fs");
    let assetBody;
    try {
      assetBody = readFileSync(flags.assetsCheck, "utf8");
    } catch (e) {
      process.stderr.write(`cannot read ${flags.assetsCheck}: ${e.message}\n`);
      process.exit(2);
    }
    const urls = assetUrls(assetBody);
    if (urls.length === 0) {
      process.stdout.write("no assets referenced\n");
      process.exit(0);
    }
    const bad = [];
    for (const u of urls) {
      let why = null;
      try {
        // HEAD, so nothing is downloaded. A non-image content type is as fatal as a 404: raw.
        // githubusercontent answers a missing path with 200-shaped `text/plain` on some rungs, and
        // GitHub's image proxy enforces a content-type allowlist of its own.
        const res = await fetch(u, { method: "HEAD", redirect: "follow" });
        const ct = res.headers.get("content-type") ?? "";
        if (!res.ok) why = `HTTP ${res.status}`;
        else if (!/^image\//.test(ct)) why = `content-type ${ct || "(none)"}`;
      } catch (e) {
        // A network failure is NOT a missing asset. Say so rather than withholding a button that
        // would have rendered — the caller treats an inconclusive check differently from a 404.
        process.stderr.write(`asset check inconclusive (${e.message}) — network unreachable, not a`
          + " missing asset; post as rendered\n");
        process.exit(3);
      }
      if (why) bad.push(`${u} — ${why}`);
    }
    if (bad.length) {
      for (const b of bad) process.stderr.write(`unreachable asset: ${b}\n`);
      process.stderr.write("the button would render as a broken image — withhold the fix links"
        + " (--no-fix-links) until the assets are on the branch ASSET_BASE points at\n");
      process.exit(1);
    }
    process.stdout.write(`assets ok (${urls.length})\n`);
    process.exit(0);
  }
  if (flags.relayCheck) {
    const { readFileSync } = await import("node:fs");
    let relayBody;
    try {
      relayBody = readFileSync(flags.relayCheck, "utf8");
    } catch (e) {
      process.stderr.write(`cannot read ${flags.relayCheck}: ${e.message}\n`);
      process.exit(2);
    }
    const unsafe = relayUnsafeUrls(relayBody);
    if (unsafe.length) {
      for (const u of unsafe) {
        process.stderr.write(`relay-unsafe url (${u.length} chars, over ${RELAY_SAFE_URL_MAX}): ${u}\n`);
      }
      // Exit on what the REMEDY can reach, not on what the relay would damage. Reporting a
      // long doc link as exit 1 sent the caller to `--no-fix-links`, which cannot remove it:
      // the re-render failed the same check with nothing left to try.
      if (relayUnsafeFixLinks(relayBody).length) {
        process.stderr.write("a relayed write would wrap these in a code span and break the markup"
          + " — withhold the fix links (--no-fix-links) or write the body from a file\n");
        process.exit(1);
      }
      process.stderr.write("none of these is a fix link, so --no-fix-links removes none of them"
        + " — post as rendered and note the mangled link in the run line, or write the body"
        + " from a file\n");
      process.exit(3);
    }
    process.stdout.write("relay-safe\n");
    process.exit(0);
  }
  if (!flags.check) {
    process.stderr.write("usage: comment-spine.mjs --check <body-file> | --relay-check <body-file>"
      + " | --assets-check <body-file>\n");
    process.exit(2);
  }
  const { readFileSync } = await import("node:fs");
  let body;
  try {
    body = readFileSync(flags.check, "utf8");
  } catch (e) {
    process.stderr.write(`cannot read ${flags.check}: ${e.message}\n`);
    process.exit(2);
  }
  try {
    assertPostable(flags.check, body);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
  process.stdout.write("ok\n");
}
