#!/usr/bin/env node
// Render ONE pr-reviewer inline review comment from a JSON payload.
//
// Why this exists: the report got a renderer because runs stopped copying its template and started
// remembering it — five observed cases across mthines/lorekit#482, #492, #495. The inline surface
// had exactly the same problem and the opposite treatment: `comment-shape.md` specifies it in prose
// and ships a `passes_shape()` function in Python that nothing ever executed. So the contract held
// only as long as the model remembered it, and on dash0hq/dash0#18362 one posted comment dropped
// three documented decorations at once — the severity label (`issue (high):`, on by default), the
// bold on `**(blocking)**`, and its position (spec: end of the opening line; posted: end of the
// second sentence) — and omitted the fix fence its own rule requires for a finding with a concrete
// patch.
//
// Layout is not a judgment call, so it does not belong to the model. The model produces DATA:
//
//   the claim      PREFIX, TIER, TITLE, BODY, BLOCKING
//   the proof      EVIDENCE[] (or UNVERIFIED, never both)
//   the patch      FENCE {lang, code}
//   the identity   FP, SHA
//   the affordance FIX_URL
//
// Everything a reader sees as structure — the label, the glyph, the decoration and its position,
// the evidence line's separators, the fingerprint marker, the button markup, the footer — is
// derived here, from `comment-spine.mjs`, which the report renderer imports too. That shared import
// is the whole mechanism: a change to the vocabulary cannot land on one surface only.
//
// Usage:  node render-comment.mjs payload.json   (or: … < payload.json)
//         node render-comment.mjs --self-test
// Output: the comment body on stdout. Any problem exits non-zero with a reason on stderr and prints
//         NOTHING to stdout — a caller that pipes stdout can never post a half-formed finding.

import { readFileSync } from "node:fs";
import { marker, isFingerprintV2 } from "./fingerprint.mjs";
import {
  TIERS, TIER_GLYPH, CONV_PREFIXES, CLAIM_PREFIXES,
  TITLE_MAX, PROSE_MAX, EVIDENCE_MAX, EVIDENCE_REFS_MAX, FENCE_MAX_LINES, SHA7,
  footerLine, fixButton, anchor, assertPlain, assertNoStructure, assertAbsent, sentenceCount,
} from "./comment-spine.mjs";

const SCALARS = ["PREFIX", "TIER", "TITLE", "BODY", "BLOCKING", "PSEUDO", "FP", "FIX_URL", "SHA",
  "UNVERIFIED"];
const STRUCTURED = ["EVIDENCE", "FENCE"];
const KNOWN = new Set([...SCALARS, ...STRUCTURED]);

const EVIDENCE_FIELDS = ["path", "line", "note"];
const FENCE_FIELDS = ["lang", "code"];

class Bad extends Error {}
const bad = (msg) => { throw new Bad(msg); };

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Build the comment body, or throw `Bad`. Exported so the self-test and L1 exercise the same
 * function a posting run does — a guard that reimplements the renderer is not a guard on it.
 *
 * Every rejection leaves through `Bad`, including the ones raised inside `comment-spine.mjs`, which
 * throws plain `Error` because it is shared with a renderer that has its own failure convention.
 * Normalising here means a caller has exactly one exception type to distinguish "this payload is
 * not renderable" from a genuine crash in the renderer.
 */
export function renderComment(data) {
  try {
    return build(data);
  } catch (e) {
    if (e instanceof Bad) throw e;
    throw new Bad(e.message);
  }
}

function build(data) {
  if (!isPlainObject(data)) bad("payload must be a JSON object");

  // Unknown keys are an error, not a no-op: a typo'd slot would otherwise render nothing and
  // silently drop the evidence line, the patch, or the button.
  const unknown = Object.keys(data).filter((k) => !KNOWN.has(k));
  if (unknown.length) {
    bad(`unknown payload key(s): ${unknown.join(", ")} — allowed: ${[...KNOWN].join(", ")}`);
  }

  // ── the claim ──────────────────────────────────────────────────────────────────────────────────
  const prefix = String(data.PREFIX ?? "");
  if (!CONV_PREFIXES.includes(prefix)) {
    bad(`PREFIX must be one of ${CONV_PREFIXES.join(" | ")} — got ${JSON.stringify(data.PREFIX)}`);
  }
  const isClaim = CLAIM_PREFIXES.includes(prefix);

  // The tier is optional only because a flat-override run assigns none
  // (`conventional-comments.md § Severity decoration`). When it is present it renders in BOTH
  // positions the two surfaces share: the label the relevance recorder reads, and the glyph.
  let tier = null;
  if (data.TIER !== undefined && data.TIER !== null && String(data.TIER).trim() !== "") {
    tier = String(data.TIER);
    if (!TIERS.includes(tier)) {
      bad(`TIER must be one of ${TIERS.join(" | ")} — got ${JSON.stringify(data.TIER)}`);
    }
  }

  if (data.BLOCKING !== undefined && data.BLOCKING !== null && typeof data.BLOCKING !== "boolean") {
    bad(`BLOCKING must be a boolean, got ${JSON.stringify(data.BLOCKING)}`);
  }
  const blocking = data.BLOCKING === true;
  // `**(blocking)**` is reserved for an issue meeting the strict criteria
  // (`conventional-comments.md § Decorations`). A blocking suggestion is a contradiction other
  // rules parse: Gate 3 reads this token to decide whether an open thread fails a PR.
  if (blocking && prefix !== "issue") {
    bad(`BLOCKING is true on a ${prefix} — only an issue: carries **(blocking)**`);
  }

  // ── the title ──────────────────────────────────────────────────────────────────────────────────
  //
  // Required on a claim, forbidden on a one-liner. GitHub surfaces an inline comment in three
  // places that show only its opening — the Files-changed rail, the conversation timeline, and the
  // notification email — and a body opening `issue: Adding github.check_run here obligates…` gives
  // none of them a handle. A `nitpick` is the opposite case: a title would cost more height than
  // the nitpick is worth, which is why the terse form survives unchanged.
  let title = null;
  if (isClaim) {
    if (!data.TITLE || String(data.TITLE).trim() === "") {
      bad(`TITLE is required on a ${prefix}: — it is what a reader sees in the Files rail and in a`
        + " notification email, where the body is not visible");
    }
    title = String(data.TITLE).trim();
    assertPlain("TITLE", title);
    assertNoStructure("TITLE", title);
    if (title.length > TITLE_MAX) {
      bad(`TITLE is ${title.length} chars, over the ${TITLE_MAX}-char cap — it is a noun phrase,`
        + " not a sentence");
    }
    if (sentenceCount(title) > 0) {
      bad("TITLE carries sentence punctuation — it is a noun phrase, not a sentence"
        + ` (got: ${title})`);
    }
  } else {
    assertAbsent("TITLE", data.TITLE, `a ${prefix}: renders as one line and takes no title`);
  }

  // ── the body ───────────────────────────────────────────────────────────────────────────────────
  if (!data.BODY || String(data.BODY).trim() === "") bad("BODY is required");
  const body = String(data.BODY).trim();
  if (body.includes("\n")) {
    bad("BODY must be a single paragraph — a multi-paragraph finding belongs in the terminal"
      + " summary (comment-shape.md § What goes elsewhere)");
  }
  assertPlain("BODY", body, { allowCode: true });
  assertNoStructure("BODY", body);
  if (body.length > PROSE_MAX) {
    bad(`BODY is ${body.length} chars, over the ${PROSE_MAX}-char cap — trim the trailing rationale`
      + " clause, or route the finding to the terminal summary");
  }
  if (sentenceCount(body) > 2) {
    bad(`BODY has ${sentenceCount(body)} sentences, over the 2-sentence cap`);
  }

  // ── the proof ──────────────────────────────────────────────────────────────────────────────────
  //
  // `EVIDENCE` and `UNVERIFIED` are mutually exclusive by construction, because they are opposite
  // claims: one cites what a receipt touched, the other says no receipt was obtainable. A comment
  // carrying both asserts a proof it also says it does not have
  // (`verification-receipt.md § unobtainable`).
  let unverified = null;
  if (data.UNVERIFIED !== undefined && data.UNVERIFIED !== null
      && String(data.UNVERIFIED).trim() !== "") {
    unverified = String(data.UNVERIFIED).trim();
    assertPlain("UNVERIFIED", unverified, { allowCode: true });
    if (prefix === "issue") {
      bad("UNVERIFIED on an issue: — nothing was verified, so nothing is asserted; re-frame it as a"
        + " suggestion: or a question: (verification-receipt.md)");
    }
  }

  const evidence = [];
  if (data.EVIDENCE !== undefined && data.EVIDENCE !== null) {
    if (!Array.isArray(data.EVIDENCE)) bad(`EVIDENCE must be an array, got ${typeof data.EVIDENCE}`);
    if (data.EVIDENCE.length && !isClaim) {
      bad(`EVIDENCE on a ${prefix}: — nothing is being proved`);
    }
    if (data.EVIDENCE.length && unverified) {
      bad("EVIDENCE and UNVERIFIED are mutually exclusive — an unobtainable receipt cites nothing");
    }
    if (data.EVIDENCE.length > EVIDENCE_REFS_MAX) {
      bad(`EVIDENCE has ${data.EVIDENCE.length} references, over the ${EVIDENCE_REFS_MAX} cap — a`
        + " fourth is a list, and a list is what the no-bullets rule exists to prevent");
    }
    data.EVIDENCE.forEach((e, i) => {
      const where = `EVIDENCE[${i}]`;
      if (!isPlainObject(e)) bad(`${where} must be an object {path, line, note}`);
      const stray = Object.keys(e).filter((k) => !EVIDENCE_FIELDS.includes(k));
      if (stray.length) bad(`${where} has unknown field(s): ${stray.join(", ")}`);
      let ref;
      try {
        ref = anchor({ path: e.path, line: e.line });
      } catch (err) { bad(`${where}: ${err.message}`); }
      if (e.note !== undefined && e.note !== null && String(e.note).trim() !== "") {
        const note = String(e.note).trim();
        assertPlain(`${where}.note`, note);
        // A parenthetical, not a second argument. Five words is the bound the rule states; a
        // longer one turns the citation list into the prose it was carved out of.
        if (note.split(/\s+/).length > 5) {
          bad(`${where}.note is ${note.split(/\s+/).length} words, over the 5-word parenthetical`
            + ` cap (got: ${note})`);
        }
        ref += ` (${note})`;
      }
      evidence.push(ref);
    });
  }

  // ── the patch ──────────────────────────────────────────────────────────────────────────────────
  let fence = null;
  if (data.FENCE !== undefined && data.FENCE !== null) {
    if (!isPlainObject(data.FENCE)) bad("FENCE must be an object {lang, code}");
    const stray = Object.keys(data.FENCE).filter((k) => !FENCE_FIELDS.includes(k));
    if (stray.length) bad(`FENCE has unknown field(s): ${stray.join(", ")}`);
    if (!isClaim) bad(`FENCE on a ${prefix}: — only an issue: or suggestion: carries a fix block`);
    const lang = String(data.FENCE.lang ?? "").trim();
    if (!/^[a-zA-Z0-9_+-]+$/.test(lang)) {
      bad(`FENCE.lang must be a language identifier — an untagged fence loses syntax highlighting`
        + ` (got ${JSON.stringify(data.FENCE.lang)})`);
    }
    const code = String(data.FENCE.code ?? "").replace(/\n+$/, "");
    if (code.trim() === "") bad("FENCE.code is required when FENCE is supplied");
    if (code.includes("```")) bad("FENCE.code contains a fence delimiter — it would break out");
    const lines = code.split("\n").length;
    if (lines > FENCE_MAX_LINES) {
      bad(`FENCE.code is ${lines} lines, over the ${FENCE_MAX_LINES}-line cap — trim to the`
        + " smallest patch that lands the change");
    }
    fence = { lang, code };
  }

  if (data.PSEUDO !== undefined && data.PSEUDO !== null && typeof data.PSEUDO !== "boolean") {
    bad(`PSEUDO must be a boolean, got ${JSON.stringify(data.PSEUDO)}`);
  }
  if (data.PSEUDO === true && !fence) bad("PSEUDO is true with no FENCE to disclaim");

  // ── the identity ───────────────────────────────────────────────────────────────────────────────
  //
  // The marker is built by `fingerprint.mjs`, never typed. Its three jobs (exact recovery,
  // self-attribution with no login configuration, and version tagging) all fail silently on a
  // hand-written key, so the only way to write one is through the builder.
  let fpMarker = null;
  if (isClaim) {
    if (!data.FP || String(data.FP).trim() === "") {
      bad(`FP is required on a ${prefix}: — the relevance recorder reads the key back rather than`
        + " re-deriving it, so the read and write paths cannot disagree");
    }
    const fp = String(data.FP).trim();
    if (!isFingerprintV2(fp)) {
      bad(`FP is not a v2 fingerprint: ${fp} — build it with fingerprint.mjs build, never by hand`);
    }
    fpMarker = marker(fp);
  } else {
    assertAbsent("FP", data.FP, `a ${prefix}: never arms a relevance rule, so a key for it would`
      + " accumulate signal for a finding class with no suppression semantics");
  }

  if (!data.SHA || !SHA7.test(String(data.SHA))) {
    bad(`SHA is required and must be exactly 7 lowercase hex chars (\`\${HEAD_SHA:0:7}\`) — got`
      + ` ${JSON.stringify(data.SHA)}`);
  }

  // ── the affordance ─────────────────────────────────────────────────────────────────────────────
  let button = null;
  if (data.FIX_URL !== undefined && data.FIX_URL !== null && String(data.FIX_URL).trim() !== "") {
    if (!isClaim) bad(`FIX_URL on a ${prefix}: — there is nothing for Agent0 to fix`);
    try {
      button = fixButton({ kind: "this", url: String(data.FIX_URL) });
    } catch (err) { bad(`FIX_URL: ${err.message}`); }
  }

  // ── assembly ───────────────────────────────────────────────────────────────────────────────────
  //
  // Line 1 stays machine-shaped: the Conventional-Comments prefix, then the tier in parentheses,
  // then the colon — so `PREFIX_RE` in `record-comment-relevance.mjs` still matches at position 0
  // and `SEVERITY_RE` still reads the tier. The glyph and the bold title sit AFTER the colon, which
  // is why the title could be added without touching either regex.
  const label = tier ? `${prefix} (${tier}):` : `${prefix}:`;
  const decoration = blocking ? "**(blocking)**"
    : prefix === "praise" ? "" : "**(non-blocking)**";
  const unverifiedTag = unverified ? `(unverified: ${unverified})` : "";

  const head = [label];
  if (isClaim) {
    if (tier) head.push(TIER_GLYPH[tier]);
    head.push(`**${title}**`);
  } else {
    head.push(body);
  }
  if (unverifiedTag) head.push(unverifiedTag);
  if (decoration) head.push(decoration);

  const blocks = [head.join(" ")];
  if (isClaim) blocks.push(body);
  if (evidence.length) {
    const line = `Evidence: ${evidence.join(" · ")}`;
    // Its own bound, and a failure drops the LINE, never the finding — the evidence line is an
    // enhancement, and losing a correct finding to an over-long citation list would be the tail
    // wagging the dog. Here that means the renderer trims rather than rejects.
    blocks.push(line.length > EVIDENCE_MAX
      ? `Evidence: ${evidence.slice(0, 2).join(" · ")}`
      : line);
  }
  if (fence) {
    blocks.push(`\`\`\`${fence.lang}\n${fence.code}\n\`\`\``);
    if (data.PSEUDO === true) blocks.push("_Pseudo-code — verify before applying._");
  }
  if (button) blocks.push(button);
  blocks.push(footerLine({ sha: String(data.SHA) }));
  if (fpMarker) blocks.push(fpMarker);

  const out = `${blocks.join("\n\n")}\n`;

  // Post-conditions. Unreachable for an accepted payload, which is the point: a future edit that
  // breaks the contract fails loudly here instead of quietly posting a malformed finding.
  if (!/^(praise|nitpick|suggestion|issue|question)( \((critical|high|medium|low)\))?:/.test(out)) {
    bad("rendered body does not open with a Conventional-Comments prefix — the relevance recorder"
      + " reads the tier off position 0");
  }
  if ((out.match(/<!--\s*fp:v\d+:/g) ?? []).length > (fpMarker ? 1 : 0)) {
    bad("rendered body carries a duplicate fingerprint marker");
  }
  const caged = out.match(/``?\s*\[[^\]]*\]\([^)]*\)\s*``?/g);
  if (caged) bad(`a markdown link is trapped inside a code span: ${caged[0].slice(0, 90)}`);
  if (!out.includes("<sup>`pr-reviewer` · commit `")) {
    bad("rendered body lost its attribution footer — it is the only record of who reviewed what,"
      + " and the only one visible in a notification email");
  }
  return out;
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const file = process.argv[2];
  let raw;
  try {
    raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
  } catch (e) {
    process.stderr.write(`render-comment: cannot read payload (${file || "stdin"}): ${e.message}\n`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    process.stderr.write(`render-comment: payload is not valid JSON: ${e.message}\n`);
    process.exit(1);
  }
  let out;
  try {
    out = renderComment(data);
  } catch (e) {
    process.stderr.write(`render-comment: ${e.message}\n`);
    process.exit(1);
  }
  process.stdout.write(out);
}

// ── self-test ──────────────────────────────────────────────────────────────────────────────────
//
// Every case below is a shape that either shipped or was one edit away from shipping. Executed by
// L1, so a regression in the caps is a CI failure rather than a posted comment.
function selfTest() {
  let pass = 0;
  const fails = [];
  const t = (name, fn) => {
    let ok = false;
    try { ok = fn() === true; } catch (e) { ok = false; fails.push(`${name} — threw: ${e.message}`); return; }
    if (ok) pass += 1; else fails.push(name);
  };
  const rejects = (name, payload, needle) => t(name, () => {
    try { renderComment(payload); } catch (e) {
      return e instanceof Bad && (!needle || e.message.includes(needle));
    }
    return false;
  });

  const ISSUE = {
    PREFIX: "issue", TIER: "high", TITLE: "Check-run variables rejected at runtime",
    BODY: "`TRIGGER_VARIABLES` and `DESCRIPTIONS` both omit the new kind, so both fail `tsc`.",
    BLOCKING: true,
    EVIDENCE: [{ path: "src/variables.ts", line: 12, note: "map" }],
    FENCE: { lang: "ts", code: `"github.check_run": ["conclusion"],` },
    FP: "consumer-impact:contract-break:triggerKinds@src/kinds.ts",
    SHA: "7389036",
  };

  t("an issue renders with a label, a glyph, a bold title, and the decoration on line 1", () => {
    const out = renderComment(ISSUE);
    return out.startsWith("issue (high): 🟠 **Check-run variables rejected at runtime**"
      + " **(blocking)**\n");
  });
  t("the tier label sits where the relevance recorder reads it", () =>
    /^\s*\*{0,2}(?:issue|suggestion|nitpick|nit|question|praise|chore)\s*\((critical|high|medium|low)\)/i
      .exec(renderComment(ISSUE))[1] === "high");
  t("the footer names the reviewer and the commit", () =>
    renderComment(ISSUE).includes("<sup>`pr-reviewer` · commit `7389036` · [how these findings"));
  t("the fingerprint marker is built, not typed", () =>
    renderComment(ISSUE).includes("<!-- fp:v2:consumer-impact:contract-break:triggerKinds@src/kinds.ts -->"));
  t("the evidence line renders as inline-code anchors", () =>
    renderComment(ISSUE).includes("Evidence: `src/variables.ts:12` (map)"));
  t("a one-liner keeps its terse single-line form", () => {
    const out = renderComment({ PREFIX: "nitpick", TIER: "low",
      BODY: "`userIds` reads clearer than `ids` in this scope.", SHA: "7389036" });
    return out.startsWith("nitpick (low): `userIds` reads clearer than `ids` in this scope."
      + " **(non-blocking)**\n") && !out.includes("**Check");
  });
  t("praise takes no decoration", () =>
    !renderComment({ PREFIX: "praise", BODY: "Nice — the union makes exhaustiveness free.",
      SHA: "7389036" }).includes("(non-blocking)"));
  t("a theme-aware button renders both variants", () => {
    const out = renderComment({ ...ISSUE, FIX_URL: "https://app.dash0.com/goto/agent0?x=1" });
    return out.includes("prefers-color-scheme: dark") && out.includes("fix-this-agent0-light.svg")
      && out.includes("fix-this-agent0-dark.svg");
  });
  t("a dev-environment button host is accepted", () =>
    renderComment({ ...ISSUE, FIX_URL: "https://app.dash0-dev.com/goto/agent0?x=1" })
      .includes("app.dash0-dev.com"));
  t("an over-long evidence line is trimmed, not rejected", () => {
    const long = "src/a/very/deeply/nested/path/that/goes/on/and/on/forever/module".repeat(1);
    const out = renderComment({ ...ISSUE, EVIDENCE: [
      { path: `${long}/one.ts`, line: 1 }, { path: `${long}/two.ts`, line: 2 },
      { path: `${long}/three.ts`, line: 3 }] });
    return out.includes("Evidence: ") && !out.includes("three.ts");
  });

  rejects("a missing title on an issue", { ...ISSUE, TITLE: undefined }, "TITLE is required");
  rejects("a title on a nitpick",
    { PREFIX: "nitpick", TITLE: "No", BODY: "x.", SHA: "7389036" }, "TITLE must be absent");
  rejects("a title long enough to be a sentence",
    { ...ISSUE, TITLE: "x".repeat(TITLE_MAX + 1) }, "over the 60-char cap");
  rejects("a title that is a sentence", { ...ISSUE, TITLE: "This map omits the kind." },
    "noun phrase, not a sentence");
  rejects("a three-sentence body",
    { ...ISSUE, BODY: "One thing. Two things. Three things." }, "3 sentences");
  rejects("an over-long body", { ...ISSUE, BODY: `${"x".repeat(PROSE_MAX + 1)}.` }, "over the 200-char cap");
  rejects("a heading in the body", { ...ISSUE, BODY: "## Why this matters." }, "opens with a heading");
  rejects("a bullet list in the body", { ...ISSUE, BODY: "- first thing." }, "opens with a heading");
  rejects("a multi-paragraph body", { ...ISSUE, BODY: "One.\n\nTwo." }, "single paragraph");
  rejects("a blocking suggestion",
    { ...ISSUE, PREFIX: "suggestion", BLOCKING: true }, "only an issue");
  rejects("an untagged fence", { ...ISSUE, FENCE: { lang: "", code: "x" } }, "language identifier");
  rejects("an 11-line fence",
    { ...ISSUE, FENCE: { lang: "ts", code: Array.from({ length: 11 }, (_, i) => `l${i}`).join("\n") } },
    "over the 10-line cap");
  rejects("a fence on a question",
    { PREFIX: "question", BODY: "Is this intentional?", SHA: "7389036", FENCE: { lang: "ts", code: "x" } },
    "only an issue: or suggestion:");
  rejects("a hand-typed fingerprint", { ...ISSUE, FP: "persona1:vibes:f@a.ts" }, "not a v2 fingerprint");
  rejects("a fingerprint on a praise",
    { PREFIX: "praise", BODY: "Nice.", SHA: "7389036", FP: "correctness:logic:f@a.ts" },
    "FP must be absent");
  rejects("evidence AND an unobtainable receipt",
    { ...ISSUE, PREFIX: "suggestion", BLOCKING: false, UNVERIFIED: "no test runner" },
    "mutually exclusive");
  rejects("an unverified issue", { ...ISSUE, EVIDENCE: [], UNVERIFIED: "no test runner" },
    "UNVERIFIED on an issue");
  rejects("four evidence references", { ...ISSUE, EVIDENCE: [
    { path: "a.ts", line: 1 }, { path: "b.ts", line: 2 },
    { path: "c.ts", line: 3 }, { path: "d.ts", line: 4 }] }, "over the 3 cap");
  rejects("a markdown link smuggled into the body",
    { ...ISSUE, BODY: "See [the docs](https://x.com) for why." }, "markdown link");
  rejects("a 40-char sha", { ...ISSUE, SHA: "7389036aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, "7 lowercase hex");
  rejects("a missing sha", { ...ISSUE, SHA: undefined }, "SHA is required");
  rejects("an unknown tier", { ...ISSUE, TIER: "urgent" }, "TIER must be one of");
  rejects("an unknown prefix", { ...ISSUE, PREFIX: "thought" }, "PREFIX must be one of");
  rejects("a typo'd slot", { ...ISSUE, TITEL: "x" }, "unknown payload key");
  rejects("a non-Agent0 button host",
    { ...ISSUE, FIX_URL: "https://evil.example.com/goto/agent0" }, "app.dash0.com");
  rejects("an unencoded button url",
    { ...ISSUE, FIX_URL: "https://app.dash0.com/goto/agent0?p=fix(this)" }, "must be bare");
  rejects("a button on a nitpick",
    { PREFIX: "nitpick", BODY: "x.", SHA: "7389036", FIX_URL: "https://app.dash0.com/g?x=1" },
    "nothing for Agent0 to fix");

  const total = pass + fails.length;
  if (fails.length) {
    process.stderr.write(`render-comment --self-test: ${fails.length}/${total} FAILED\n`);
    for (const f of fails) process.stderr.write(`  - ${f}\n`);
    process.exit(1);
  }
  process.stdout.write(`render-comment --self-test: ${pass}/${total} passed\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
