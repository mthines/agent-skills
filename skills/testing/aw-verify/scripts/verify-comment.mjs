#!/usr/bin/env node
// verify-comment.mjs — upsert one region of the PR's single verify report.
//
// One report per PR, whoever's account writes it. On the viewer's own PR it is a region of the PR
// description, `<!-- verify:report -->` … `<!-- /verify:report -->`; on anyone else's PR it is one
// comment whose first line is `<!-- verify:report -->`.
// Each witness owns one region:
//   <!-- verify:section=<name> --> … <!-- /verify:section=<name> -->
// Sections: intent (aw-verify: the acceptance criteria every later phase reads), aggregate (aw-verify),
// ui (ui-verify), telemetry (telemetry-verify).
// `intent` is the spec, not a run: --replace-all keeps it, it never folds as an older run or enters
// the history, its content must sit in a visible closed <details> with no HTML comment, and once the
// PR is merged an existing one is frozen (a criterion chosen after the numbers is chosen to pass them).
// The script owns a last region, <!-- verify:history -->: a collapsed "Previous runs" list it
// appends to whenever a region is replaced. It also stamps `{{UPDATED}}`, folds a region on an
// older commit than the PR head, adds the blank lines GitHub needs inside <details>, and posts a
// one-line notice comment when a re-run changes a verdict (an edit alone notifies nobody).
//
// Usage:
//   node verify-comment.mjs --pr <n|url> --section <name> --file <region.md> [--repo <owner/name>] [--replace-all]
//     [--to auto|body|comment]
//   node verify-comment.mjs --section <name> --file <region.md> --existing <body.md|-> --dry-run [--replace-all] [--head <sha>]
//     [--to body [--seed <comment.md>]] [--notice-out <file> --comment-url <url>]
//   node verify-comment.mjs --pr <n|url> --section intent --marks '{"AC-1":{"status":"✅"},"AC-2":{"prod":true}}'
//     changes only the leading status / 🚀 of existing criteria lines (a JSON string or a file); never their text
//   node verify-comment.mjs --pr <n|url> --check [--ui]   the end-of-run gate: exit 1 lists what the PR report lacks (intent ticked, aggregate in the template shape, ui spec block)
//   node verify-comment.mjs --pr <n|url> --from-plan <plan.md> [--statuses <json|file>]
//     publishes an `/aw` brief's criteria as the intent region (rows ⬜, or ticked from run-checks.mjs --statuses);
//     --print renders it and exits with no GitHub call; exit 3 = the brief has no AC (nothing to publish)
//   node verify-comment.mjs --check --local <run-dir> [--ui]   the same gate before a PR exists, over <run-dir>/intent.md
//     and report.md (with --ui, ../specs.md too); exit 1 lists every unmarked or untagged AC and report problem
//   node verify-comment.mjs --local <run-dir> --marks '{"AC-1":{"status":"✅"}}'   marks intent.md's AC lines in place
//   node verify-comment.mjs --self-test
//
// --replace-all drops every other region (aw-verify's aggregate rewrite).
// --to auto (default) writes the PR body when the PR's author is the viewer or the body already holds
// the report, else the comment; body and comment force one. With --dry-run --to body, --existing is
// the PR body and stdout is the whole new body; --seed is a verify comment to carry into it.
// --dry-run prints the merged body instead of writing it (the MCP access path writes it itself).
// --notice-out writes the verdict-change notice (linking --comment-url) to <file> when there is
// one, and removes a stale <file> when there is none; the MCP access path posts it itself.
// Exit codes: 0 written or printed; 1 refused (local path, a verify marker, media a reviewer cannot see, or bad input); 2 GitHub call failed.

import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const MARKER = "<!-- verify:report -->";
export const SECTIONS = ["intent", "aggregate", "ui", "telemetry"];
const open = (s) => `<!-- verify:section=${s} -->`;
const close = (s) => `<!-- /verify:section=${s} -->`;
const HISTORY = "verify:history";
const HISTORY_CAP = 10;
const STALE = "<!-- verify:stale -->";
export const NOTICE = "<!-- verify:notice -->";
export const END = "<!-- /verify:report -->";
export const MOVED = "<!-- verify:moved -->";
// GitHub refuses an issue or PR body longer than 65536 characters.
export const BODY_LIMIT = 65536;
const OVER_LIMIT = Symbol("over the body limit");
const VERDICTS = ["✅", "⚠️", "❌", "⛔", "⏭️"];
const TRUSTED = ["OWNER", "MEMBER", "COLLABORATOR"];
// A login, normalized: lowercase, one trailing `[bot]` stripped.
export const normLogin = (l) => String(l || "").toLowerCase().replace(/\[bot\]$/, "");
const HEX = /`([0-9a-f]{7,40})`/;
// A region's commit: the hex on its `<sub>` metadata line, else a `head \`<hex>\`` line, else the
// first backticked hex (a legacy headline), so a backticked number in the summary is never read as one.
const shaOf = (region) => (region.split("\n").find((l) => l.includes("<sub>") && HEX.test(l))?.match(HEX)
  ?? region.match(/\bhead `([0-9a-f]{7,40})`/) ?? region.match(HEX))?.[1]?.slice(0, 7) ?? null;
const headlineOf = (region) => (region.split("\n").find((l) => l.trim() && !l.includes(STALE)) || "");
// The verdict glyph of a region's headline, or null when it carries none.
export const verdictOf = (region) => VERDICTS.find((v) => headlineOf(region).includes(v)) ?? null;

// GitHub renders Markdown inside <details> only with a blank line after </summary> and before
// </details>; an agent that forgets them shows the reviewer raw Markdown. Add them here.
export function normalize(content) {
  return content
    .replace(/<\/summary>[ \t]*\n?(?!\n)/g, "</summary>\n\n")
    .replace(/([^\n])\n?<\/details>/g, "$1\n\n</details>");
}

// A path a reviewer cannot open: a file:// URL, the run's scratch dirs, a file under a home dir,
// or a temp dir. An HTTP route such as `GET /home/feed` or `PUT /home/settings.json` is not one:
// a path right after a method token is a route. ROUTE sits after ${B}, because ${B} consumes the space.
const B = "(?:^|[\\s(`'\"=\\[])";
const ROUTE = "(?<!\\b(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\s+)";
const LOCAL_PATH = new RegExp([
  "file:\\/\\/",
  `${B}(?:\\.{1,2}\\/)?\\.(?:agent|aw-tester|ui-verify)\\/`,
  `${B}${ROUTE}\\/(?:Users|home)\\/[^\\s)\`'"]+\\.[A-Za-z0-9]{1,5}(?=$|[\\s)\`'",.:;])`,
  `${B}${ROUTE}\\/(?:tmp|private\\/(?:tmp|var)|var\\/folders|root)\\/`,
  `${B}~\\/`,
  "[A-Z]:\\\\",
].join("|"), "m");

// The text of a region outside every <details> block and apart from its headline, the <sub> line and
// blank lines. An aggregate with none of it opens to nothing but closed rows.
export function visibleBody(region) {
  let depth = 0;
  const open = [];
  for (const line of region.split("\n")) {
    const t = line.trim();
    const opens = (t.match(/<details\b/gi) || []).length, closes = (t.match(/<\/details>/gi) || []).length;
    if (depth === 0 && opens === 0 && t && !/^#{1,6}\s/.test(t) && !/^<sub>/.test(t) && !t.includes(STALE)) open.push(t);
    depth = Math.max(0, depth + opens - closes);
  }
  return open.join("\n").length >= 40;
}

// A markdown image, <img>/<video> src or bare recording line that is not an https URL: after the upload
// step it can only be a relative path that did not upload, which GitHub renders as a broken image.
export function relativeMediaLine(text) {
  for (const m of text.matchAll(MEDIA_REF)) { const path = m[2] ?? m[6] ?? m[8]; if (path && !/^https?:/.test(path)) return path; }
  return null;
}

export function localPathLine(text) {
  return text.split("\n").find((l) => LOCAL_PATH.test(l)) ?? null;
}

const MEDIA = /<img\b|user-attachments\/assets\/|\.mp4\b/i;

// Media a reviewer cannot see without a click: inside a <details> that is not the strip's
// "+N more" fold (a check row, Details), or placed after the first <details>, so the strip is empty.
// A <picture> block is exempt: the impact map lives in Details by design (impact-map template).
// Reads tags across lines, so a <summary> on its own line still opens a row. Returns the offending
// text, or null. rules/pr-comment.md § Media strip.
export function hiddenMediaLine(text) {
  const body = text.replace(/<picture>[\s\S]*?<\/picture>/gi, "");
  const token = /<details\b[^>]*>|<\/details>|<summary>([\s\S]*?)<\/summary>|<img\b[^>]*>|\S*user-attachments\/assets\/\S*|\S*\.mp4\b/gi;
  const stack = [];
  let seenDetails = false;
  for (const m of body.matchAll(token)) {
    const t = m[0];
    if (/^<details/i.test(t)) { stack.push({ fold: false }); seenDetails = true; }
    else if (/^<\/details>/i.test(t)) stack.pop();
    else if (/^<summary>/i.test(t)) {
      if (MEDIA.test(m[1])) return m[1].trim().slice(0, 100);
      if (stack.length) stack[stack.length - 1].fold = /^\s*\+\d+ more/.test(m[1]);
    } else if (stack.length ? !stack.some((d) => d.fold) : seenDetails) return t.trim().slice(0, 100);
  }
  return null;
}

// The criteria of an `intent` region, in one of two strict grammars a reader parses with no model.
// Table rows (what a new report writes): `| ✅&nbsp;AC‑1 | text | ui · w1 · [link] |`, a guardrail as
// `| 🛡️&nbsp;G‑1 | text | guardrail |`. The first cell is an optional status, an optional 🚀 and the ID (written with a
// non-breaking hyphen U+2011 so it never wraps; parsed back to `-`); the Proof cell starts with the kind, `ui`,
// `api`, `worker` or `telemetry`, optionally `kind:target` (`api:PUT /api/x`, the target a production watch
// reads), then `·`-separated witnesses and links; a literal `|` in a cell is written `\|`.
// Lines (still read, so an older PR keeps working): `- ⬜ AC-1 [ui:/settings] text`, `- ✅ 🚀 AC-2 [api:PUT /x] text`,
// `- G-1 [guardrail] text`. In both, the status (⬜ not run, ✅ passed, ❌ failed, ⏭️ not verified on target) and
// the 🚀 (confirmed in production) are the only parts a later run changes; the rest stays word for word.
export const STATUSES = ["⬜", "✅", "❌", "⏭️"];
const PROD = "🚀";
const CRITERION = /^- (?:(⬜|✅|❌|⏭️) )?(?:(🚀) )?((?:AC|G)-\d+) \[([a-z]+)(?::([^\]]*))?\] (.+)$/;
const SP = "(?:&nbsp;| )";
const ROW = new RegExp(`^\\|\\s*(?:(⬜|✅|❌|⏭️)${SP})?(?:(🚀)${SP})?(?:🛡️${SP})?((?:AC|G)[-\u2011]\\d+)\\s*\\|\\s*((?:\\\\\\||\\\\(?!\\|)|[^|\\\\])+?)\\s*\\|\\s*((?:\\\\\\||\\\\(?!\\|)|[^|\\\\])*?)\\s*\\|$`);
const ROW_MARKS = new RegExp(`^(\\|\\s*)(?:(?:⬜|✅|❌|⏭️)${SP})?(?:🚀${SP})?(🛡️${SP})?`);
const unescapeCell = (c) => c.replace(/\\\|/g, "|");

function criterionOf(line) {
  const l = line.trim();
  const c = CRITERION.exec(l);
  if (c) return { id: c[3], kind: c[4], target: c[5] || "", text: c[6], status: c[1] || null, prod: Boolean(c[2]) };
  const r = ROW.exec(l);
  if (!r) return null;
  const id = r[3].replace("\u2011", "-");
  const first = unescapeCell(r[5]).split(" · ")[0].trim();
  const k = /^([a-z]+)(?::(.*))?$/.exec(first);
  const kind = id.startsWith("G-") ? "guardrail" : k ? k[1] : null;
  if (!kind) return null;
  return { id, kind, target: id.startsWith("G-") || !k ? "" : (k[2] || "").trim(), text: unescapeCell(r[4]), status: r[1] || null, prod: Boolean(r[2]) };
}

export function parseIntent(region) {
  return (region || "").split("\n").map(criterionOf).filter(Boolean);
}

// The region with every status and 🚀 removed: what "the criteria text" means once the PR is merged.
const stripMarks = (region) => (region || "").split("\n").map((l) => l
  .replace(/^(- )(?:(?:⬜|✅|❌|⏭️) )?(?:🚀 )?((?:AC|G)-\d+ \[)/, "$1$2")
  .replace(ROW_MARKS, "$1$2")).join("\n");

// `📋 Acceptance criteria — 18 criteria · 15 ✅ · 3 ⏭️ · 3 guardrails`: the counts a reviewer sees while the
// table is collapsed. Rewritten from the parsed rows whenever the region is a table, so a mark never leaves it stale.
function summaryLine(criteria) {
  const acs = criteria.filter((c) => c.kind !== "guardrail");
  const gs = criteria.length - acs.length;
  const parts = [`${acs.length} ${acs.length === 1 ? "criterion" : "criteria"}`];
  for (const st of ["✅", "❌", "⏭️", "⬜"]) { const n = acs.filter((c) => c.status === st).length; if (n) parts.push(`${n} ${st}`); }
  if (gs) parts.push(`${gs} ${gs === 1 ? "guardrail" : "guardrails"}`);
  return `📋 Acceptance criteria — ${parts.join(" · ")}`;
}
const refreshSummary = (region) => {
  if (!/^\s*\|/m.test(region)) return region;
  return region.replace(/(<details><summary>)📋 Acceptance criteria[^<]*(<\/summary>)/, `$1${summaryLine(parseIntent(region))}$2`);
};

// The region with `marks` ({ "AC-1": { status: "✅", prod: true } }) applied to its criteria; an unknown ID
// or status throws. Nothing but the leading marks (and a table's summary counts) changes.
export function applyMarks(region, marks) {
  const ids = new Set(parseIntent(region).map((c) => c.id));
  for (const [id, m] of Object.entries(marks)) {
    if (!ids.has(id)) throw new Error(`refused: the intent region has no criterion ${id}`);
    if (m.status !== undefined && !STATUSES.includes(m.status)) throw new Error(`refused: unknown status "${m.status}" for ${id} (expected ${STATUSES.join(" ")})`);
  }
  const out = region.split("\n").map((l) => {
    const c = criterionOf(l);
    if (!c || !marks[c.id]) return l;
    const m = marks[c.id];
    const status = m.status !== undefined ? m.status : c.status;
    const prod = m.prod !== undefined ? m.prod : c.prod;
    if (/^\s*\|/.test(l)) {
      const lead = [status, prod ? PROD : null].filter(Boolean).map((x) => `${x}&nbsp;`).join("");
      return l.trim().replace(ROW_MARKS, (_, pipe, shield) => `${pipe}${lead}${shield || ""}`);
    }
    return l.replace(/^(\s*- )(?:(?:⬜|✅|❌|⏭️) )?(?:🚀 )?/, `$1${[status, prod ? PROD : null].filter(Boolean).join(" ")}${status || prod ? " " : ""}`);
  }).join("\n");
  return refreshSummary(out);
}

// The criteria on a PR: from its description's report, else from a verify comment's body; [] when none.
export function intentFrom(text) {
  return parseIntent(parseRegions(bodyBlock(text) || text || "").get("intent"));
}

// run-checks.mjs statuses → the marks a criterion shows. `pending` (and a judge check not yet run) is ⬜.
export const CHECK_MARKS = { pass: "✅", fail: "❌", pending: "⬜", unsatisfiable: "⏭️" };

// An `/aw` brief's criteria. ACs: the `- [ ] AC-n (covers: Rm) [kind:target] — text` lines of its
// `## Acceptance Criteria` section (the tag is optional); a `telemetry:` AC is kind `telemetry` with the span as
// its target, any other untagged AC is kind `check`. Guardrails: the `- ` lines of `## Guardrails`, numbered
// G-1… by position. Text is copied verbatim.
const PLAN_AC = /^- (?:\[[ xX]\] )?(AC-\d+)(?: \(covers: [^)]*\))?(?: \[(ui|api|worker)(?::([^\]]+))?\])?(?: —| -|:)? (.+)$/;
const sectionOf = (md, heading) => {
  const lines = md.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^##\\s+${heading}\\b`, "i").test(l));
  if (at < 0) return [];
  const end = lines.findIndex((l, i) => i > at && /^##\s/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end);
};
export function planCriteria(planMd) {
  const acs = sectionOf(planMd, "Acceptance Criteria").map((l) => PLAN_AC.exec(l.trim())).filter(Boolean).map(([, id, tag, target = "", text]) => {
    const tele = /^telemetry:\s*(\S+)/.exec(text);
    return { id, kind: tag || (tele ? "telemetry" : "check"), target: tag ? target : tele ? tele[1] : "", text };
  });
  const guardrails = sectionOf(planMd, "Guardrails").map((l) => /^- (.+)$/.exec(l.trim())).filter(Boolean).map((m) => m[1]);
  return { acs, guardrails };
}

// The `intent` region for an `/aw` brief: the same collapsed table `aw-verify` publishes, every row ⬜ unless
// `statuses` ({ "AC-1": "pass" }, from `run-checks.mjs --statuses`) says otherwise. Throws code 3 with no AC.
export function intentFromPlan(planMd, { statuses = null } = {}) {
  const { acs, guardrails } = planCriteria(planMd);
  if (!acs.length) throw Object.assign(new Error("no AC in the brief"), { code: 3 });
  const cell = (t) => String(t).replace(/\|/g, "\\|");
  const rows = [
    ...acs.map((c) => `| ${CHECK_MARKS[statuses?.[c.id]] ?? "⬜"}&nbsp;${c.id.replace("-", "\u2011")} | ${cell(c.text)} | ${c.kind}${c.target ? `:${cell(c.target)}` : ""} |`),
    ...guardrails.map((g, i) => `| 🛡️&nbsp;G\u2011${i + 1} | ${cell(g)} | guardrail |`),
  ];
  const region = `<details><summary>📋 Acceptance criteria</summary>\n\n| | Criterion | Proof |\n| :-- | :-- | :-- |\n${rows.join("\n")}\n\n</details>`;
  return refreshSummary(region);
}

// Regions in the existing body, in order. A body with the marker but no regions is a
// report written before regions existed: keep it as the aggregate region.
export function parseRegions(body) {
  const regions = new Map();
  if (!body || !body.startsWith(MARKER)) return regions;
  for (const s of SECTIONS) {
    const start = body.indexOf(open(s));
    const end = body.indexOf(close(s));
    if (start !== -1 && end > start) regions.set(s, body.slice(start + open(s).length, end).split("\n").filter((l) => !l.includes(STALE)).join("\n").trim());
  }
  if (regions.size === 0) {
    const legacy = body.slice(MARKER.length).split(`<!-- ${HISTORY} -->`)[0].trim();
    if (legacy) regions.set("aggregate", legacy);
  }
  return regions;
}

// The "Previous runs" entries in an existing body, newest first.
export function parseHistory(body) {
  const start = (body || "").indexOf(`<!-- ${HISTORY} -->`);
  const end = (body || "").indexOf(`<!-- /${HISTORY} -->`);
  if (start === -1 || end < start) return [];
  return body.slice(start, end).split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
}

// One history line for a region being replaced: its head SHA (the first backticked hex), the
// section, and its headline (the first non-empty line, Markdown heading and emphasis stripped).
export function historyEntry(section, region, date) {
  const sha = shaOf(region);
  const headline = headlineOf(region).replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/<[^>]+>/g, "")
    .replace(/`[0-9a-f]{7,40}`/g, "").replace(/(\s*·\s*)+/g, " · ").replace(/^ · | · $/g, "").trim();
  return [sha ? `\`${sha}\`` : null, section, headline, `replaced ${date}`].filter(Boolean).join(" · ");
}

export function splice(existing, section, content, { replaceAll = false, now = new Date(), head = null, where = "comment", merged = false, marks = null } = {}) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown section "${section}" (expected ${SECTIONS.join(", ")})`);
  if (marks) {
    const current = section === "intent" ? parseRegions(existing).get("intent") : null;
    if (!current) throw new Error("refused: --marks needs the intent section and an existing intent region");
    content = applyMarks(current, marks);
  }
  if (/verify:(report|section=|history|stale|notice|moved)/.test(content)) throw new Error("refused: the region holds a verify marker of its own");
  const bad = localPathLine(content);
  if (bad) throw new Error(`refused: the region holds a local path a reviewer cannot open: ${bad.trim()}`);
  const hidden = section === "aggregate" ? hiddenMediaLine(content) : null;
  if (hidden) throw new Error(`refused: a screenshot or recording sits where a reviewer must click to see it: ${hidden}. Put recordings and screenshots in the media strip under the verdict (one recording, two thumbnails, the rest in one "+N more" fold) and have Details only name them`);
  if (section === "intent") {
    if (/<!--/.test(content)) throw new Error("refused: the intent region holds an HTML comment, which a reader cannot see");
    if (!/^\s*<details>\s*<summary>/.test(content)) throw new Error("refused: the intent region must open with a visible, collapsed <details><summary>");
    if (parseIntent(content).length === 0) throw new Error("refused: the intent region holds no criterion row (`| ⬜&nbsp;AC‑n | text | kind:target · … |`) or line (`- AC-n [surface:target] text`)");
  }
  const date = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  let fresh = normalize(content.replaceAll("{{UPDATED}}", date)).trim();
  const old = parseRegions(existing);
  // A republished intent region (aw-verify's Step 6 writes the template's ⬜ lines every run) keeps the 🚀
  // deployment-verify put on a criterion: production confirmation outlives a re-publish of the text.
  if (section === "intent" && !marks && old.has("intent")) {
    const kept = Object.fromEntries(parseIntent(old.get("intent")).filter((c) => c.prod && parseIntent(fresh).some((n) => n.id === c.id && !n.prod)).map((c) => [c.id, { prod: true }]));
    if (Object.keys(kept).length) fresh = applyMarks(fresh, kept);
  }
  if (section === "intent" && merged && old.has("intent") && stripMarks(old.get("intent")) !== stripMarks(fresh)) throw new Error("refused: the PR is merged, so its criteria text is frozen (statuses and 🚀 may still change)");
  const regions = new Map(replaceAll ? [...old].filter(([s]) => s === "intent") : old);
  regions.set(section, fresh);
  const replaced = [...old].filter(([s, r]) => s !== "intent" && regions.get(s) !== r).map(([s, r]) => historyEntry(s, r, date));
  const history = [...replaced, ...parseHistory(existing)].slice(0, HISTORY_CAP);
  // A region on another commit than the PR head is older: fold it to one closed row, so a stale
  // ✅ never reads as the current verdict. Without a known head, the region just written is newest
  // (a late run on an older commit can then mislabel, which is why upsert passes the real head).
  const newest = head ? head.slice(0, 7) : section === "intent" ? null : shaOf(fresh);
  const parts = SECTIONS.filter((s) => regions.has(s)).map((s) => {
    const r = regions.get(s);
    const stale = s !== "intent" && newest && shaOf(r) && shaOf(r) !== newest && (head || s !== section);
    // The aggregate is the report a reviewer reads: it never folds, because a PR holding only closed
    // sections shows no verdict. On an older commit it keeps its text and gains one visible line.
    if (stale && s === "aggregate") return `${open(s)}\n> ⚠️ Tested on \`${shaOf(r)}\`; the PR head is now \`${newest}\`. Check the open findings against the newer commits. ${STALE}\n\n${r}\n${close(s)}`;
    if (!stale) return `${open(s)}\n${r}\n${close(s)}`;
    // The wrapper lines carry STALE, so parseRegions drops them on the next read.
    const headline = headlineOf(r).replace(/^#+\s*/, "").replace(/<[^>]+>/g, "").replace(/`([^`]*)`/g, "<code>$1</code>");
    return `${open(s)}\n${STALE}<details><summary>Older run on <code>${shaOf(r)}</code>: ${headline}</summary>\n\n${r}\n\n</details>${STALE}\n${close(s)}`;
  });
  if (history.length) parts.push(`<!-- ${HISTORY} -->\n<details><summary>Previous runs (${history.length})</summary>\n\nEarlier full reports are in this ${where === "body" ? "description" : "comment"}'s edit history.\n\n${history.map((h) => `- ${h}`).join("\n")}\n\n</details>\n<!-- /${HISTORY} -->`);
  return `${MARKER}\n\n${parts.join("\n\n")}\n`;
}

// Where the report sits in a PR body: both markers on lines of their own and outside a ``` or ~~~
// fence, so a description that quotes them holds no report. [start, end of the end marker], or null.
function locate(b) {
  let fence = null, start = -1, at = 0;
  for (const line of b.split("\n")) {
    const text = line.replace(/\r$/, "");
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !text.slice(f[0].length).trim()) fence = null; }
    else if (f) fence = f[1];
    else if (start < 0 && /^<!-- verify:report -->[ \t]*$/.test(text)) start = at;
    else if (start >= 0 && /^<!-- \/verify:report -->[ \t]*$/.test(text)) return [start, at + END.length];
    at += line.length + 1;
  }
  return null;
}

// The verify report inside a PR body, from its marker up to the end marker, or "" when it has none.
export function bodyBlock(prBody) {
  const b = prBody || "";
  const at = locate(b);
  return at ? b.slice(at[0], at[1] - END.length).trimEnd() + "\n" : "";
}

// The PR body with its report replaced by `block`, or appended after the author's text when it has
// none; every character outside the region is kept. An empty `block` removes the region.
export function withBlock(prBody, block) {
  const b = prBody || "";
  const wrapped = block ? `${block.trimEnd()}\n${END}` : "";
  const at = locate(b);
  if (at) return b.slice(0, at[0]) + wrapped + b.slice(at[1]);
  return `${b.trimEnd()}${b.trim() ? "\n\n" : ""}${wrapped}\n`;
}

// The one-line comment a run posts when it changes the verdict a reader saw last: the section's
// own previous verdict, else the comment's first region (a first `ui` run under a ✅ aggregate). Or null.
export function flipNotice(existing, section, written, url, head = null) {
  const now = parseRegions(written).get(section);
  if (head && shaOf(now ?? "") !== head.slice(0, 7)) return null;
  const prior = parseRegions(existing);
  const before = prior.get(section) ?? [...prior].find(([s]) => s !== "intent")?.[1];
  const was = before && verdictOf(before);
  const is = now && verdictOf(now);
  if (!was || !is || was === is) return null;
  return `${NOTICE}\nVerify re-ran on \`${shaOf(now) ?? "?"}\`: ${was} → ${is}. [See the report](${url})`;
}

// Every local image or recording a region names is uploaded to GitHub and replaced by its
// user-attachments URL, so a report never ships a path a reviewer cannot open. The endpoint is the one
// `gh pr edit --attach` calls (attach-media's rung 2). A file that is missing, over 10 MB or of an
// unknown type is left in place, and the local-path refusal then names it.
const MEDIA_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
const MEDIA_REF = /(!\[[^\]]*\]\()([^)\s]+\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm))(\))|(^|\n)(\s*)((?:\.{0,2}\/|~\/|\/)?[^\s()<>`|]+\.(?:mp4|mov|webm))(?=\s*(?:\n|$))|(<(?:img|video)\b[^>]*\bsrc=")([^"]+\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm))(")/g;
export async function uploadMedia(content, { slug, baseDirs, log = (m) => console.error(m) }) {
  const found = new Set();
  for (const m of content.matchAll(MEDIA_REF)) { const path = m[2] ?? m[6] ?? m[8]; if (path && !/^https?:/.test(path)) found.add(path); }
  if (!found.size) return content;
  const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || spawnSync("gh", ["auth", "token"], { encoding: "utf8" }).stdout || "").trim();
  if (!token) { log("verify-comment: no GitHub token, so local media was not uploaded"); return content; }
  const { readFileSync: read, existsSync, statSync } = await import("node:fs");
  const { resolve: res, basename } = await import("node:path");
  const auth = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const repoId = (await (await fetch(`https://api.github.com/repos/${slug}`, { headers: auth })).json()).id;
  let out = content;
  for (const path of found) {
    const file = [path.replace(/^~\//, `${process.env.HOME}/`), ...baseDirs.map((d) => res(d, path))].find((f) => f.startsWith("/") ? existsSync(f) : false) || (existsSync(path) ? res(path) : null);
    const type = MEDIA_TYPES[path.split(".").pop().toLowerCase()];
    if (!file || !type) { log(`verify-comment: not uploaded (missing or unknown type): ${path}`); continue; }
    if (statSync(file).size > 10 * 1024 * 1024) { log(`verify-comment: not uploaded (over 10 MB): ${path}`); continue; }
    const r = await fetch(`https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(basename(file))}&content_type=${encodeURIComponent(type)}&repository_id=${repoId}`, { method: "POST", headers: { ...auth, "Content-Type": "application/octet-stream" }, body: read(file) });
    const url = r.ok ? (await r.json()).url : null;
    if (!url) { log(`verify-comment: upload failed (${r.status}): ${path}`); continue; }
    out = out.replace(new RegExp(`(?<![\\w./-])${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), () => url);
    log(`verify-comment: uploaded ${basename(file)}`);
  }
  return out;
}

function gh(args, input) {
  const r = spawnSync("gh", args, { encoding: "utf8", input });
  if (r.status !== 0) throw Object.assign(new Error((r.stderr || r.stdout || "gh failed").trim()), { code: 2 });
  return r.stdout.trim();
}

// On the viewer's own PR (or a PR whose body already holds the report), write the report into the
// PR body. Otherwise edit the PR's newest verify comment, whoever wrote it, else post a new one: one
// PR, one report, even when the same person runs verify from Agent0 (a bot account) and from a local
// session (their own). The replaced run stays in the history region. A comment the token may not
// edit (HTTP 403 / 404) gets a new comment instead. `run` is injectable for --self-test.
export function upsert({ pr, repo, section, content, replaceAll, to = "auto", marks = null }, run = gh) {
  if (!["auto", "body", "comment"].includes(to)) throw new Error(`unknown --to "${to}" (expected auto, body, comment)`);
  const prNumber = String(pr).match(/(\d+)\/?$/)?.[1];
  if (!prNumber) throw new Error(`cannot read a PR number from "${pr}"`);
  const slug = repo || String(pr).match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1]
    || run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  let me = "";
  try { me = normLogin(run(["api", "graphql", "-f", "query={ viewer { login } }", "--jq", ".data.viewer.login"])); } catch { me = ""; }
  const found = run(["api", `repos/${slug}/issues/${prNumber}/comments`, "--paginate", "--jq",
    `.[] | select(.body | startswith("${MARKER}")) | [.id, .created_at, .author_association, .user.type, .user.login, (.body | @base64)] | @tsv`])
    .split("\n").filter(Boolean).map((l) => l.split("\t"))
    // Only a comment someone with access to the repo wrote, an app, or the viewer (a fork author
    // re-running on their own PR): a drive-by commenter's fake ✅ must never become the verify comment.
    .filter(([, , assoc, type, login]) => TRUSTED.includes(assoc) || type === "Bot" || (me && normLogin(login) === me))
    .sort(([ia, ta], [ib, tb]) => (tb > ta ? 1 : tb < ta ? -1 : Number(ib) - Number(ia)));
  let head = null, author = "", prUrl = "", prBody = null, trustedAuthor = false, merged = false;
  try {
    const [h, a, u, b64, assoc, type, mergedAt] = run(["api", `repos/${slug}/pulls/${prNumber}`, "--jq", `[.head.sha, .user.login, .html_url, (.body // "" | @base64), .author_association, .user.type, .merged_at] | @tsv`]).split("\t");
    head = h || null; author = a || ""; prUrl = u || ""; merged = Boolean(mergedAt);
    prBody = b64 === undefined ? null : Buffer.from(b64, "base64").toString("utf8");
    trustedAuthor = TRUSTED.includes(assoc) || type === "Bot";
  } catch { head = null; }
  const own = Boolean(me) && normLogin(author) === me;
  // The PR author writes the description, so a report already in it counts only under the same
  // trust rule the comment path applies: a fork author's planted ✅ is never adopted.
  const bodyReport = prBody !== null && (own || trustedAuthor) ? bodyBlock(prBody) : "";
  const toBody = to === "body" || (to === "auto" && prBody !== null && (own || bodyReport !== ""));
  let overLimit = false;
  if (toBody) {
    const url = writeBody({ slug, prNumber, prUrl, prBody, bodyReport, found, section, content, replaceAll, head, merged, marks }, run);
    if (url && url !== OVER_LIMIT) return url;
    overLimit = url === OVER_LIMIT;
  }
  // Past the limit the comment starts from the body's report; the body drops its copy only once the
  // comment holds it, so a failed comment write never leaves the PR with no report.
  const dropBodyCopy = (url) => {
    if (overLimit && bodyReport) {
      try { run(["api", "-X", "PATCH", `repos/${slug}/pulls/${prNumber}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: withBlock(prBody, "").trimEnd() + "\n" })); }
      catch (e) { console.error(`verify-comment: the old report was not removed from the PR body: ${e.message}`); }
    }
    return url;
  };
  let existing = bodyReport;
  if (found.length) {
    const [id, , , , , b64] = found[0];
    existing = bodyReport || Buffer.from(b64, "base64").toString("utf8");
    const body = splice(existing, section, content, { replaceAll, head, merged, marks });
    try {
      const url = run(["api", "-X", "PATCH", `repos/${slug}/issues/comments/${id}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body }));
      const notice = flipNotice(existing, section, body, url, head);
      if (notice) {
        try { run(["api", "-X", "POST", `repos/${slug}/issues/${prNumber}/comments`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: notice })); }
        catch (e) { console.error(`verify-comment: verdict-change notice not posted: ${e.message}`); }
      }
      return dropBodyCopy(url);
    } catch (e) {
      if (!/HTTP 40[34]/.test(e.message)) throw e;
    }
  }
  // A comment we may not edit hands its regions and history to the new one.
  const body = splice(existing, section, content, { replaceAll, head, merged, marks });
  return dropBodyCopy(run(["api", "-X", "POST", `repos/${slug}/issues/${prNumber}/comments`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body })));
}

// Write the report into the PR body; OVER_LIMIT or null when the comment must take it instead (the
// body would pass GitHub's limit, or the token may not edit it). An own PR's verify comment is migrated: its regions
// seed the body once, and the comment becomes a pointer so the PR shows one report.
function writeBody({ slug, prNumber, prUrl, prBody, bodyReport, found, section, content, replaceAll, head, merged, marks }, run) {
  if (prBody === null) throw Object.assign(new Error("cannot read the PR body for --to body"), { code: 2 });
  const seed = !bodyReport && found.length ? found[0] : null;
  const existing = bodyReport || (seed ? Buffer.from(seed[5], "base64").toString("utf8") : "");
  const block = splice(existing, section, content, { replaceAll, head, where: "body", merged, marks });
  const next = withBlock(prBody, block);
  if (next.length > BODY_LIMIT) {
    console.error(`verify-comment: the PR body would pass GitHub's ${BODY_LIMIT}-character limit; writing the comment instead`);
    return OVER_LIMIT;
  }
  let url;
  try {
    url = run(["api", "-X", "PATCH", `repos/${slug}/pulls/${prNumber}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: next })) || prUrl;
  } catch (e) {
    if (!/HTTP 40[34]/.test(e.message)) throw e;
    console.error("verify-comment: the PR body edit is refused; writing the comment instead");
    return null;
  }
  if (seed) {
    const pointer = `${MOVED}\nThe verify report moved to the [PR description](${url}).`;
    try { run(["api", "-X", "PATCH", `repos/${slug}/issues/comments/${seed[0]}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: pointer })); }
    catch (e) { console.error(`verify-comment: the old verify comment was not turned into a pointer: ${e.message}`); }
  }
  const notice = flipNotice(existing, section, block, url, head);
  if (notice) {
    try { run(["api", "-X", "POST", `repos/${slug}/issues/${prNumber}/comments`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: notice })); }
    catch (e) { console.error(`verify-comment: verdict-change notice not posted: ${e.message}`); }
  }
  return url;
}

// The completeness gate a run ends with: what is missing from the PR's report, as one line each (empty = complete).
// `prBody` is the PR description, `comments` the verify comment bodies (newest first); `ui` is true for a UI diff.
const VERDICT_HEADLINE = /^##\s+(?:✅ Verified|⚠️ Verified with open items|❌ Not verified|⛔ Blocked) — \S/;
export function checkReport(prBody, comments = [], { ui = false } = {}) {
  const source = bodyBlock(prBody) || comments.find((c) => c.startsWith(MARKER)) || "";
  const regions = parseRegions(source);
  const intent = regions.get("intent");
  const problems = checkCompleteness(intent ? parseIntent(intent) : null, regions.get("aggregate") || null, {
    noIntent: "no intent region: publish the criteria (intent.md § Step 6)",
    noReport: "no aggregate region: post the report (report.md)",
    setMarks: "set them with --marks",
  });
  if (ui && !/<!-- (?:ui-verify:v2|ui-verify:v1|preview-spec:v1) -->/.test(prBody || "")) problems.push("no ui-verify spec block in the PR description (ui-verify author, or lift specs.md)");
  return problems;
}

// The rules both gates share. `rows` are the parsed criteria (null: none published), `report` the rendered
// report (null: none). Every AC has a final status and a proof kind; a `ui:` AC is never ⏭️ under a ✅ verdict
// (a criterion with no UI path is tagged api:, worker:, or check, never ui:); the report opens with a
// verdict headline and keeps a closed Details block. `unmarked: "open"` counts an AC with no mark as not run.
function checkCompleteness(rows, report, { noIntent, noReport, setMarks, unmarked = "ignore" }) {
  const problems = [];
  const acs = (rows || []).filter((c) => c.id.startsWith("AC-"));
  if (!rows) problems.push(noIntent);
  else {
    const open = acs.filter((c) => c.status === "⬜" || (unmarked === "open" && !c.status)).map((c) => c.id);
    if (open.length) problems.push(`criteria still ⬜ after the run: ${open.join(", ")} (${setMarks})`);
    const noProof = acs.filter((c) => !c.kind).map((c) => c.id);
    if (noProof.length) problems.push(`criteria without a proof cell: ${noProof.join(", ")}`);
  }
  if (report === null) { problems.push(noReport); return problems; }
  const first = report.split("\n").find((l) => l.trim()) || "";
  if (!VERDICT_HEADLINE.test(first)) problems.push(`the report must open with "## <✅ Verified | ⚠️ Verified with open items | ❌ Not verified | ⛔ Blocked> — <headline>" (report.md.template), not "${first.slice(0, 60)}"`);
  if (!visibleBody(report)) problems.push("the report shows only its headline and collapsed blocks; put the summary, what needs a human and the findings in the open above Details");
  if (!/<details>\s*<summary>Details<\/summary>/.test(report)) problems.push('the report has no closed <details><summary>Details</summary> block (report.md.template)');
  const uiSkipped = acs.filter((c) => c.kind === "ui" && c.status === "⏭️").map((c) => c.id);
  if (/^##\s+✅/.test(first) && uiSkipped.length) problems.push(`ui: criteria not verified on their target under a ✅ verdict: ${uiSkipped.join(", ")} — a ui: criterion proved only by tests caps the run at ⚠️ (report.md § Tests-only criteria)`);
  return problems;
}

// The gate for a run with no PR yet, over its run directory (`.agent/<branch>/verify/`): `intent.md` (its
// `- <mark> AC-n [kind:target] text` lines, marked with --marks --local), `report.md`, and with `ui` the brief's
// `specs.md` one level up. An AC line with no [kind:target] tag is a problem, never skipped: an unparsed
// criterion is one the count would miss.
export function checkLocal({ intent = null, report = null, specs = false } = {}, { ui = false } = {}) {
  const rows = intent === null ? null : parseIntent(intent);
  const problems = checkCompleteness(rows, report, {
    noIntent: "no intent.md in the run directory: write it first (intent.md)",
    noReport: "no report.md in the run directory: render it (report.md)",
    setMarks: "set them with --marks --local",
    unmarked: "open",
  });
  if (rows) {
    const parsed = new Set(rows.map((c) => c.id));
    const untagged = (intent.match(/^- (?:(?:⬜|✅|❌|⏭️) )?(?:🚀 )?AC-\d+\b/gm) || []).map((l) => l.match(/AC-\d+/)[0]).filter((id) => !parsed.has(id));
    if (untagged.length) problems.push(`criteria without a [kind:target] tag in intent.md: ${untagged.join(", ")} (intent.md § Step 3)`);
    if (!rows.some((c) => c.id.startsWith("AC-")) && !untagged.length) problems.push("intent.md lists no criterion (`- AC-n [kind:target] text`)");
  }
  if (ui && !specs) problems.push("no specs.md beside the run directory for a UI diff (ui-verify author)");
  return problems;
}

function selfTest() {
  let n = 0;
  const assert = (ok, msg) => { n++; if (!ok) { console.error(`self-test FAIL: ${msg}`); process.exit(1); } };
  const url = "https://github.com/user-attachments/assets/aaaa";
  {
    const intentOk = "<details><summary>📋 Acceptance criteria — 1 criterion</summary>\n\n| | Criterion | Proof |\n| :-- | :-- | :-- |\n| ✅&nbsp;AC‑1 | does x | ui:/x · browser |\n\n</details>";
    const aggOk = "## ✅ Verified — does x\n\nThe checkout flow works end to end on the preview.\n\n<details><summary>Details</summary>\n\nmore\n\n</details>";
    const full = withBlock("text", splice(splice("", "intent", intentOk), "aggregate", aggOk));
    const spec = "<!-- ui-verify:v2 -->\n<details><summary>s</summary>\n</details>\n<!-- /ui-verify:v2 -->\n";
    assert(checkReport(full + spec, [], { ui: true }).length === 0, "a complete report passes the gate");
    assert(checkReport(full, [], { ui: true }).some((p) => p.includes("ui-verify spec")), "a UI diff with no spec block fails the gate");
    assert(checkReport(withBlock("t", splice("", "aggregate", aggOk))).some((p) => p.includes("no intent region")), "no intent region fails the gate");
    assert(checkReport(withBlock("t", splice(splice("", "intent", intentOk.replace("✅&nbsp;AC", "⬜&nbsp;AC")), "aggregate", aggOk))).some((p) => p.includes("still ⬜")), "a criterion left ⬜ fails the gate");
    assert(checkReport(withBlock("t", splice(splice("", "intent", intentOk), "aggregate", aggOk.replace("✅ Verified — does x", "Verdict: verified")))).some((p) => p.includes("must open with")), "a free-text verdict fails the gate");
    assert(checkReport(withBlock("t", splice(splice("", "intent", intentOk), "aggregate", "## ✅ Verified — x\n\nno details"))).some((p) => p.includes("Details")), "a report with no Details block fails the gate");
  }
  assert(hiddenMediaLine(`## ✅ x\n\nWhat I checked\n\n${url}.mp4\n\n<details><summary>✅ row</summary>\n\nnamed only\n\n</details>`) === null, "media in the strip before the rows is allowed");
  assert(hiddenMediaLine(`strip\n\n<details><summary>+1 more recording</summary>\n\n${url}.mp4\n\n</details>`) === null, "media in the +N more fold is allowed");
  assert(hiddenMediaLine(`<details><summary>✅ row</summary>\n\n${url}.mp4\n\n</details>`) !== null, "a recording inside a check row is refused");
  assert(hiddenMediaLine(`<details><summary>✅ row</summary>\n\n<img src="x" width="420">\n\n</details>`) !== null, "a screenshot inside a check row is refused");
  assert(hiddenMediaLine(`<details><summary>✅ row</summary>\n\nok\n\n</details>\n\n${url}.mp4`) !== null, "media after the first row means the strip is empty");
  assert(hiddenMediaLine(`<details><summary>Details</summary>\n\n<picture>\n  <source srcset="${url}">\n  <img alt="map" src="${url}">\n</picture>\n\n</details>`) === null, "an impact-map <picture> block in Details is allowed");
  assert(hiddenMediaLine(`<details>\n<summary>✅ row</summary>\n\n${url}.mp4\n\n</details>`) !== null, "a row with <summary> on its own line still refuses media");
  assert(hiddenMediaLine(`<details><summary>✅ row ${url}.mp4</summary>\n\nok\n\n</details>`) !== null, "media on the summary line is refused");
  let hiddenRefused = false; try { splice("", "aggregate", `<details><summary>✅ row</summary>\n\n${url}.mp4\n\n</details>`); } catch { hiddenRefused = true; }
  assert(hiddenRefused, "splice refuses hidden media in the aggregate region");
  const one = splice("", "ui", "UI v1");
  assert(one.startsWith(MARKER), "a new body starts with the marker");
  assert(parseRegions(one).get("ui") === "UI v1", "a new region round-trips");
  const two = splice(one, "telemetry", "TEL v1");
  assert(parseRegions(two).get("ui") === "UI v1" && parseRegions(two).get("telemetry") === "TEL v1", "a second region keeps the first");
  const three = splice(two, "ui", "UI v2");
  assert(parseRegions(three).get("ui") === "UI v2" && parseRegions(three).get("telemetry") === "TEL v1", "a re-run replaces only its own region");
  assert((three.match(/<!-- verify:section=ui -->/g) || []).length === 1, "a region appears once");
  const agg = splice(three, "aggregate", "AGG", { replaceAll: true });
  assert([...parseRegions(agg).keys()].join() === "aggregate", "the aggregate rewrite drops the other regions");
  const after = splice(agg, "ui", "UI v3");
  assert(parseRegions(after).get("aggregate") === "AGG" && after.indexOf("verify:section=aggregate") < after.indexOf("verify:section=ui"), "a standalone run after an aggregate keeps it first");
  const legacy = splice(`${MARKER}\n## Verify (local) — ✅ verified\n\nold table`, "ui", "UI");
  assert(parseRegions(legacy).get("aggregate")?.includes("old table"), "a legacy report survives as the aggregate region");
  for (const p of ["see .agent/feat-x/verify/report.md", "![S-1](/Users/me/shot.png)", "`/tmp/run/video.webm`",
    "./.agent/feat/verify/report.md", "file:///Users/me/a.png", "log at /home/ci/app.log",
    "saved to ~/Desktop/shot.png", "see /root/run/video.webm"]) {
    let threw = false; try { splice("", "ui", p); } catch { threw = true; }
    assert(threw, `a local path is refused: ${p}`);
  }
  let nested = false; try { splice("", "ui", `${open("telemetry")}\nx`); } catch { nested = true; }
  assert(nested, "a region that carries a marker is refused");
  let threw = false; try { splice("", "bogus", "x"); } catch { threw = true; }
  assert(threw, "an unknown section is refused");
  for (const ok of ["![S-1](https://github.com/user-attachments/assets/abc)", "GET /home/feed 200",
    "PUT /private/settings → 403", "POST /api/views 201 (84 ms)", "/Users/{id}/settings → 200",
    "GET /home/hero.png → 200", "PUT /home/settings.json → 200", "DELETE /tmp/cache 204"]) {
    assert(!localPathLine(ok), `a URL or HTTP route is allowed: ${ok}`);
  }
  // History: a replaced region leaves one line (sha · section · headline), newest first, capped.
  const t = new Date("2026-03-01T10:00:00Z");
  const r1 = splice("", "aggregate", "## ✅ Verified — saves work\n\n<sub>`abc1234` · preview</sub>", { now: t });
  assert(parseHistory(r1).length === 0 && !r1.includes("Previous runs"), "a first run has no history");
  const r2 = splice(r1, "aggregate", "## ❌ Not verified — save fails\n\n<sub>`def5678` · preview</sub>", { replaceAll: true, now: t });
  assert(parseHistory(r2)[0] === "`abc1234` · aggregate · ✅ Verified — saves work · replaced 2026-03-01 10:00 UTC", `a replaced run is recorded: ${parseHistory(r2)[0]}`);
  assert(parseRegions(r2).get("aggregate").includes("def5678") && !parseRegions(r2).get("aggregate").includes("abc1234"), "the history never leaks into a region");
  const r3 = splice(splice(r2, "ui", "**ui-verify** · head `1111111`", { now: t }), "aggregate", "## ✅ again `2222222`", { replaceAll: true, now: t });
  const h3 = parseHistory(r3);
  assert(h3.length === 3 && h3[0].includes("aggregate") && h3.some((h) => h.includes("ui ·")) && h3[2].includes("abc1234"), "a replace-all records every dropped region, newest first");
  const legacyHead = splice(`${MARKER}\n\n${open("aggregate")}\n### aw-verify · preview · \`076fafc348\` · ✅ verified\n${close("aggregate")}`, "aggregate", "x", { now: t });
  assert(parseHistory(legacyHead)[0] === "`076fafc` · aggregate · aw-verify · preview · ✅ verified · replaced 2026-03-01 10:00 UTC", `a SHA in the old headline is not repeated: ${parseHistory(legacyHead)[0]}`);
  assert(splice(r3, "aggregate", "## ✅ again `2222222`", { replaceAll: true }) .includes("Previous runs (3)"), "an unchanged region adds no history line");
  let body = r1;
  for (let i = 0; i < 14; i++) body = splice(body, "aggregate", `## run ${i} \`${String(i).padStart(7, "0")}\``, { now: t });
  assert(parseHistory(body).length === 10, "history is capped at 10");
  let hist = false; try { splice("", "ui", "<!-- verify:history -->"); } catch { hist = true; }
  assert(hist, "a region that carries the history marker is refused");
  assert(r2.startsWith(`${MARKER}\n\n<!-- verify:section=aggregate -->`), "the comment opens straight into the first region: no generic header");
  // Blank lines inside <details>, the {{UPDATED}} stamp, stale marks, and the verdict-change notice.
  const tight = parseRegions(splice("", "ui", "<details><summary>✅ x</summary>\nbody\n</details>\n<details><summary>y</summary>\n\nok\n\n</details>")).get("ui");
  assert(tight === "<details><summary>✅ x</summary>\n\nbody\n\n</details>\n<details><summary>y</summary>\n\nok\n\n</details>", `blank lines are added inside <details>, and only where missing: ${JSON.stringify(tight)}`);
  assert(parseRegions(splice("", "ui", "updated {{UPDATED}}", { now: t })).get("ui") === "updated 2026-03-01 10:00 UTC", "the script stamps {{UPDATED}}");
  const agg1 = splice("", "aggregate", "## ✅ Verified — x\n\n<sub>`aaaaaaa`</sub>", { now: t });
  const withUi = splice(agg1, "ui", "### ❌ Not verified — y\n\n<sub>`bbbbbbb`</sub>", { now: t });
  assert(withUi.includes("Tested on `aaaaaaa`; the PR head is now `bbbbbbb`") && !withUi.includes("<summary>Older run on <code>aaaaaaa</code>") && parseRegions(withUi).get("aggregate") === "## ✅ Verified — x\n\n<sub>`aaaaaaa`</sub>", "an aggregate on an older commit stays open with a banner, never folds, and the banner never becomes part of the region");
  const uiOld = splice(splice("", "ui", "### ❌ y\n\n<sub>`aaaaaaa`</sub>", { now: t }), "aggregate", "## ✅ Verified — x\n\n<sub>`bbbbbbb`</sub>", { now: t });
  assert(uiOld.includes("<details><summary>Older run on <code>aaaaaaa</code>: ❌ y</summary>") && parseRegions(uiOld).get("ui") === "### ❌ y\n\n<sub>`aaaaaaa`</sub>", "a ui region on an older commit still folds to one closed line");
  assert(relativeMediaLine("![a](shots/a.png)") === "shots/a.png" && relativeMediaLine("rec/x.mp4") === "rec/x.mp4" && relativeMediaLine(`![a](${url}) and ${url}`) === null, "a relative media path is found; an uploaded URL is not");
  assert(visibleBody("## ✅ x\n\n<details><summary>a</summary>\n\nlots of hidden words here, more than forty characters long\n\n</details>") === false && visibleBody("## ✅ x\n\nThe flow works on the preview and two findings need a human to look.") === true, "visibleBody ignores text inside <details>");
  assert(checkReport(withBlock("t", splice(splice("", "intent", "<details><summary>📋 Acceptance criteria — 1 criterion</summary>\n\n| | Criterion | Proof |\n| :-- | :-- | :-- |\n| ✅&nbsp;AC‑1 | x | ui:/x · browser |\n\n</details>"), "aggregate", "## ✅ Verified — x\n\n<details><summary>Details</summary>\n\nlong hidden text that goes past forty characters easily\n\n</details>"))).some((p) => p.includes("only its headline")), "the gate fails an aggregate that is only collapsed blocks");
  const same = splice(agg1, "ui", "### ✅ y\n\n<sub>`aaaaaaa`</sub>", { now: t });
  assert(!same.includes("Older run"), "regions on the same commit are not marked");
  assert(!splice(withUi, "aggregate", "## ✅ again `bbbbbbb`", { replaceAll: true }).includes("Older run"), "an aggregate rewrite clears the mark");
  assert(flipNotice(agg1, "aggregate", splice(agg1, "aggregate", "## ❌ Not verified `ccccccc`"), "https://x/9") === `${NOTICE}\nVerify re-ran on \`ccccccc\`: ✅ → ❌. [See the report](https://x/9)`, "a verdict change yields a one-line notice");
  assert(flipNotice(agg1, "aggregate", splice(agg1, "aggregate", "## ✅ Verified `ccccccc`"), "u") === null && flipNotice("", "aggregate", agg1, "u") === null, "no notice without a change, or on a first run");
  assert(flipNotice(agg1, "ui", withUi, "u")?.includes("✅ → ❌"), "a first ui run that turns a ✅ comment red posts a notice");
  const late = splice(splice("", "aggregate", "## ✅ new `bbbbbbb`", { now: t }), "ui", "### ❌ old `aaaaaaa`", { now: t, head: "bbbbbbb0000" });
  assert(late.includes("Older run on <code>aaaaaaa</code>") && !late.includes("Older run on <code>bbbbbbb</code>"), "a late run on an older commit is folded itself; the head region stays open");
  assert(flipNotice(splice("", "aggregate", "## ✅ new `bbbbbbb`"), "ui", late, "u", "bbbbbbb0000") === null, "a late run on an older commit posts no notice");
  const numBefore = splice("", "ui", "### ✅ ok\n\n<sub>`bbbbbbb`</sub>", { now: t });
  const numAfter = splice(numBefore, "ui", "### ❌ Not verified\n\nProcessed `1000000` events.\n\n<sub>`bbbbbbb`</sub>", { now: t, head: "bbbbbbb0000" });
  assert(!numAfter.includes("Older run") && flipNotice(numBefore, "ui", numAfter, "u", "bbbbbbb0000")?.includes("✅ → ❌"), "a backticked number in the summary is not read as the region's commit");
  const skipped = splice("", "ui", "### ⏭️ Skipped — no preview\n\n<sub>`bbbbbbb`</sub>", { now: t });
  assert(flipNotice(skipped, "ui", splice(skipped, "ui", "### ❌ Not verified\n\n<sub>`bbbbbbb`</sub>", { now: t, head: "bbbbbbb" }), "u", "bbbbbbb")?.includes("⏭️ → ❌"), "a skipped run that turns red posts a notice");
  let stale = false; try { splice("", "ui", "<!-- verify:stale -->x"); } catch { stale = true; }
  assert(stale, "a region that carries a stale or notice marker is refused");
  // upsert against a fake gh: comments are [id, created_at, login, body].
  const ghErr = (msg) => Object.assign(new Error(msg), { code: 2 });
  let fakeHead = "";
  const fakeGh = (comments, patchErr) => {
    const calls = [];
    const run = (a) => {
      calls.push(a[2] === "PATCH" ? `PATCH ${a[3].split("/").pop()}` : a[2]);
      if (String(a[1]).includes("/pulls/")) return fakeHead;
      if (a[1] === "graphql") return "me";
      if (a.includes("--paginate")) return comments.map(([id, at, who, b, assoc = "MEMBER"]) => `${id}\t${at}\t${assoc}\t${who.endsWith("[bot]") ? "Bot" : "User"}\t${who}\t${Buffer.from(b).toString("base64")}`).join("\n");
      if (a[2] === "PATCH") { if (patchErr) throw patchErr; return `https://x/${a[3].split("/").pop()}`; }
      return "https://x/new";
    };
    return { run, calls };
  };
  const req = { pr: 7, repo: "o/r", section: "ui", content: "UI" };
  const cross = fakeGh([["2", "2026-01-02T00:00:00Z", "dash0-app[bot]", one], ["3", "2026-01-03T00:00:00Z", "mthines", two], ["1", "2026-01-01T00:00:00Z", "me", one]]);
  assert(upsert(req, cross.run) === "https://x/3" && !cross.calls.includes("POST"), "the PR's newest verify comment is edited, whoever wrote it");
  const none = fakeGh([]);
  assert(upsert(req, none.run) === "https://x/new", "no verify comment yet posts one");
  const denied = fakeGh([["4", "2026-01-04T00:00:00Z", "someone", one]], ghErr("gh: HTTP 403"));
  assert(upsert(req, denied.run) === "https://x/new" && denied.calls.includes("POST"), "a comment the token may not edit gets a new comment");
  const drive = fakeGh([["1", "2026-01-01T00:00:00Z", "me", one], ["99", "2026-01-09T00:00:00Z", "stranger", splice("", "aggregate", "## ✅ fake"), "NONE"]]);
  assert(upsert(req, drive.run) === "https://x/1", "a newer marker comment from someone without repo access is never adopted");
  const fork = fakeGh([["11", "2026-01-11T00:00:00Z", "Me", one, "CONTRIBUTOR"]]);
  assert(upsert(req, fork.run) === "https://x/11", "a fork author's own verify comment is reused");
  const app = fakeGh([["8", "2026-01-08T00:00:00Z", "dash0-app[bot]", one, "NONE"]]);
  assert(upsert(req, app.run) === "https://x/8", "an app's comment is adopted whatever its association");
  let posted = "";
  const keep = fakeGh([["4", "2026-01-04T00:00:00Z", "someone", two]], ghErr("gh: HTTP 403"));
  const keepRun = (a, input) => { if (a[2] === "POST") posted = JSON.parse(input).body; return keep.run(a, input); };
  upsert(req, keepRun);
  assert(parseRegions(posted).has("telemetry"), "the new comment keeps the regions of the one it could not edit");
  assert(typeof gh === "function", "the real gh runner upsert defaults to exists");
  const flip = fakeGh([["7", "2026-01-07T00:00:00Z", "me", agg1]]);
  assert(upsert({ pr: 7, repo: "o/r", section: "aggregate", content: "## ❌ Not verified `ccccccc`", replaceAll: true }, flip.run) === "https://x/7" && flip.calls.join() .endsWith("PATCH 7,POST"), `a verdict change edits, then posts one notice: ${flip.calls}`);
  const down = fakeGh([["5", "2026-01-05T00:00:00Z", "me", one]], ghErr("gh: HTTP 502"));
  let rethrown = false; try { upsert(req, down.run); } catch { rethrown = true; }
  assert(rethrown && !down.calls.includes("POST"), "a GitHub outage fails the write instead of posting a duplicate");
  // The PR body: the viewer's own PR keeps its report in the description, not in a comment.
  const intro = "## Why\n\nIntro text.\n\n<!-- ui-verify:v2 -->\nspec\n<!-- /ui-verify:v2 -->";
  const placed = withBlock(intro, splice("", "aggregate", "## ✅ Verified — x"));
  assert(placed.startsWith(`${intro}\n\n${MARKER}`) && placed.trimEnd().endsWith(END) && bodyBlock(placed).startsWith(MARKER), "a first report is appended after the author's text, inside its markers");
  const tail = "\n\n<!-- attach-media:v1 -->\nmedia\n<!-- /attach-media:v1 -->\n";
  const rerun = withBlock(placed.trimEnd() + tail, splice(bodyBlock(placed + tail), "aggregate", "## ❌ Not verified — y", { replaceAll: true }));
  assert(rerun.startsWith(`${intro}\n\n${MARKER}`) && rerun.endsWith(`${END}${tail}`) && (rerun.match(/verify:report -->/g) || []).length === 2 && parseRegions(bodyBlock(rerun)).get("aggregate").includes("❌"), "a re-run replaces the region in place and keeps every character outside the region");
  assert(bodyBlock(intro) === "" && bodyBlock(`${MARKER}\nno end`) === "", "a body without both markers holds no report");
  assert(splice(splice("", "ui", "a"), "ui", "b", { where: "body" }).includes("this description's edit history"), "a body report points at the description's history");
  const prGh = (comments, { author, body = "", bodyErr, assoc = "MEMBER" } = {}) => {
    const calls = [];
    const run = (a, input) => {
      if (String(a[1]).includes("/pulls/")) { calls.push("GET pr"); return `bbbbbbb0000\t${author}\thttps://x/pr\t${Buffer.from(body).toString("base64")}\t${assoc}\tUser`; }
      if (a[2] === "PATCH" && a[3].includes("/pulls/")) { calls.push("PATCH body"); if (bodyErr) throw bodyErr; run.body = JSON.parse(input).body; return "https://x/pr"; }
      if (a[2] === "PATCH") { calls.push(`PATCH ${a[3].split("/").pop()}`); run.patched = JSON.parse(input).body; return `https://x/${a[3].split("/").pop()}`; }
      if (a[2] === "POST") { calls.push("POST"); return "https://x/new"; }
      return fakeGh(comments).run(a, input);
    };
    return { run, calls };
  };
  const mine = prGh([], { author: "Me", body: "Intro." });
  assert(upsert({ ...req, section: "aggregate", content: "## ✅ ok" }, mine.run) === "https://x/pr" && mine.calls.includes("PATCH body") && !mine.calls.includes("POST")
    && mine.run.body.startsWith("Intro.\n\n") && parseRegions(bodyBlock(mine.run.body)).get("aggregate") === "## ✅ ok", "an own PR writes the body and posts no verify comment");
  const theirs = prGh([["3", "2026-01-03T00:00:00Z", "me", two]], { author: "someone" });
  assert(upsert(req, theirs.run) === "https://x/3" && !theirs.calls.includes("PATCH body"), "someone else's PR keeps the comment");
  const kept = prGh([], { author: "someone", body: placed });
  assert(upsert(req, kept.run) === "https://x/pr" && kept.calls.includes("PATCH body"), "a body that already holds the report keeps it there, whoever runs");
  const forced = prGh([], { author: "me" });
  assert(upsert({ ...req, to: "comment" }, forced.run) === "https://x/new" && !forced.calls.includes("PATCH body"), "--to comment overrides an own PR");
  const migrate = prGh([["6", "2026-01-06T00:00:00Z", "dash0-app[bot]", two]], { author: "me", body: "Intro." });
  upsert({ ...req, section: "ui", content: "UI v9" }, migrate.run);
  assert(parseRegions(bodyBlock(migrate.run.body)).get("telemetry") === "TEL v1" && parseRegions(bodyBlock(migrate.run.body)).get("ui") === "UI v9"
    && migrate.calls.includes("PATCH 6") && migrate.run.patched.startsWith(MOVED) && !migrate.run.patched.startsWith(MARKER), "an own PR's verify comment is migrated into the body once and becomes a pointer");
  const big = prGh([], { author: "me", body: "x".repeat(BODY_LIMIT) });
  assert(upsert(req, big.run) === "https://x/new" && !big.calls.includes("PATCH body"), `a body past GitHub's ${BODY_LIMIT}-character limit (65536) writes the comment instead`);
  const refused = prGh([], { author: "me", bodyErr: ghErr("gh: HTTP 403") });
  assert(upsert(req, refused.run) === "https://x/new", "when the body edit is refused (403), the comment takes the report");
  const outage = prGh([], { author: "me", bodyErr: ghErr("gh: HTTP 502") });
  let failed = false; try { upsert(req, outage.run); } catch { failed = true; }
  assert(failed && !outage.calls.includes("POST"), "a GitHub outage on the body edit fails the write instead of posting a comment");
  const quoted = "The report goes between `<!-- verify:report -->` and `<!-- /verify:report -->` in the body.";
  assert(bodyBlock(quoted) === "" && withBlock(quoted, "x").startsWith(`${quoted}\n\nx`), "a description that quotes the markers inline holds no report, and nothing is spliced into its prose");
  const quotedPr = prGh([["3", "2026-01-03T00:00:00Z", "me", two]], { author: "someone", body: quoted });
  assert(upsert(req, quotedPr.run) === "https://x/3" && !quotedPr.calls.includes("PATCH body"), "someone else's PR keeps the comment when its description only quotes the markers");
  const planted = withBlock("Fork PR.", splice("", "telemetry", "### ✅ Telemetry verified (FAKE)"));
  const forkPr = prGh([], { author: "forker", body: planted, assoc: "CONTRIBUTOR" });
  upsert(req, (a, i) => { if (a[2] === "POST") forkPr.run.posted = JSON.parse(i).body; return forkPr.run(a, i); });
  assert(!forkPr.calls.includes("PATCH body") && forkPr.run.posted && !forkPr.run.posted.includes("FAKE"), "a report a fork author planted in the description is never adopted");
  const bigWithReport = prGh([], { author: "me", body: withBlock("x".repeat(BODY_LIMIT - 400), splice("", "telemetry", "TEL kept")) });
  let fallbackBody = ""; const bigRun = (a, i) => { if (a[2] === "POST") fallbackBody = JSON.parse(i).body; return bigWithReport.run(a, i); };
  upsert({ ...req, content: "U".repeat(800) }, bigRun);
  assert(parseRegions(fallbackBody).get("telemetry") === "TEL kept" && bodyBlock(bigWithReport.run.body) === "", "a fallback comment starts from the body's report, and the body drops its stale copy");
  const fenced = "Example:\n\n```text\n<!-- verify:report -->\nquoted\n<!-- /verify:report -->\n```\n\nAfter.";
  const fencedOut = withBlock(fenced, `${MARKER}\nREPORT`);
  assert(bodyBlock(fenced) === "" && fencedOut.startsWith(`${fenced}\n\n${MARKER}\nREPORT`) && bodyBlock(fencedOut) === `${MARKER}\nREPORT\n`, "markers quoted inside a code fence hold no report, and the fence is kept");
  assert(bodyBlock(`~~~\n${END}\n~~~\n${MARKER}\nreal\n${END}\n`).startsWith(`${MARKER}\nreal`), "a report after a fenced end marker is still found");
  const bigLost = prGh([], { author: "me", body: withBlock("x".repeat(BODY_LIMIT - 400), splice("", "telemetry", "TEL kept")) });
  let lostFailed = false;
  try { upsert({ ...req, content: "U".repeat(800) }, (a, i) => { if (a[2] === "POST") throw ghErr("gh: HTTP 502"); return bigLost.run(a, i); }); } catch { lostFailed = true; }
  assert(lostFailed && !bigLost.calls.includes("PATCH body"), "past the limit, a failed fallback comment leaves the body's report in place");
  let badTo = false; try { upsert({ ...req, to: "wiki" }, fakeGh([]).run); } catch { badTo = true; }
  assert(badTo, "an unknown --to is refused");
  // The intent region: the spec every later phase reads.
  const crit = (extra = "") => `<details><summary>📋 Acceptance criteria — 2 criteria, 1 guardrail</summary>\n\nSource: aw-brief\n\n- AC-1 [ui:/settings/notifications] Saving with an empty name shows "Name is required" (base: saves "")\n- AC-2 [api:PUT /api/notification-settings] A 400 for an empty name${extra}\n- G-1 [guardrail] Keep unchanged: the public settings API shape\n\n</details>`;
  const withIntent = splice("", "intent", crit(), { now: t });
  const got = intentFrom(withIntent);
  assert(got.length === 3 && got[0].id === "AC-1" && got[0].kind === "ui" && got[0].target === "/settings/notifications" && got[1].target === "PUT /api/notification-settings" && got[2].kind === "guardrail" && got[2].target === "", "the intent region round-trips through parseIntent");
  assert(intentFrom(withBlock("Intro.", withIntent)).length === 3, "intentFrom reads a PR description");
  const intentThenAgg = splice(withIntent, "aggregate", "## ✅ Verified — x\n\n<sub>`aaaaaaa`</sub>", { now: t, replaceAll: true });
  assert(intentFrom(intentThenAgg).length === 3 && intentThenAgg.indexOf("section=intent") < intentThenAgg.indexOf("section=aggregate"), "an aggregate rewrite keeps the intent region, first");
  const reAgg = splice(intentThenAgg, "aggregate", "## ❌ Not verified `bbbbbbb`", { now: t, replaceAll: true, head: "bbbbbbb0000" });
  assert(parseHistory(reAgg).length === 1 && !parseHistory(reAgg)[0].includes("intent") && !reAgg.includes("Older run on <code>aaaaaaa</code>: 📋"), "the intent region never enters the history or folds as an older run");
  const intentLate = splice(intentThenAgg, "intent", crit(" (edited)"), { now: t });
  assert(!intentLate.includes("Older run") && intentFrom(intentLate)[1].text.endsWith("(edited)"), "rewriting the intent region marks no other region stale and replaces it");
  assert(flipNotice(withIntent, "ui", splice(splice(withIntent, "aggregate", "## ✅ ok `aaaaaaa`", { now: t }), "ui", "### ❌ no `aaaaaaa`", { now: t }), "u") === null, "a first ui run under an intent-only report posts no notice");
  for (const [name, bad] of [["an HTML comment", crit("\n<!-- hidden -->")], ["no <details>", "- AC-1 [ui:/x] a"], ["no criteria line", "<details><summary>x</summary>\n\nnone\n\n</details>"]]) {
    let refused = false; try { splice("", "intent", bad); } catch { refused = true; }
    assert(refused, `an intent region with ${name} is refused`);
  }
  let frozen = false; try { splice(withIntent, "intent", crit(" (edited)"), { merged: true }); } catch { frozen = true; }
  assert(frozen && splice(withIntent, "intent", crit(), { merged: true, now: t }) === withIntent && intentFrom(splice(withIntent, "aggregate", "## ✅ ok `aaaaaaa`", { merged: true })).length === 3, "a merged PR's criteria are frozen, but a same-text rewrite and other regions still write");
  assert(intentFrom(splice("", "intent", crit(), { merged: true })).length === 3, "the first publication on a merged PR is allowed");
  // Table grammar: rows parse to the same criteria, marks rewrite only the first cell and the summary counts.
  const tbl = (extra = "") => `<details><summary>📋 Acceptance criteria — 2 criteria · 1 guardrail</summary>\n\n| | Criterion | Proof |\n| :-- | :-- | :-- |\n| ⬜&nbsp;AC\u20111 | Saving shows a toast${extra} | ui · w1 · [trace](https://x/y) |\n| ⬜&nbsp;AC\u20112 | PUT stores a \\| b | api:PUT /api/x · w2 |\n| 🛡️&nbsp;G\u20111 | No other file changes | guardrail |\n\n</details>`;
  const trows = parseIntent(tbl());
  assert(trows.length === 3 && trows[0].id === "AC-1" && trows[0].kind === "ui" && trows[1].kind === "api" && trows[1].target === "PUT /api/x" && trows[1].text === "PUT stores a | b" && trows[2].kind === "guardrail" && trows[2].id === "G-1", "table rows parse to the same criteria as lines, with a non-breaking hyphen ID and an escaped pipe");
  const tmarked = applyMarks(tbl(), { "AC-1": { status: "✅" }, "AC-2": { status: "⏭️", prod: true } });
  const tm = parseIntent(tmarked);
  assert(tm[0].status === "✅" && tm[1].status === "⏭️" && tm[1].prod && tm[2].status === null && tmarked.includes("| ✅&nbsp;AC\u20111 |") && tmarked.includes("| 🛡️&nbsp;G\u20111 |") && tmarked.includes("2 criteria · 1 ✅ · 1 ⏭️ · 1 guardrail</summary>"), "marks on table rows rewrite the first cell and refresh the summary counts");
  assert(applyMarks(tmarked, { "AC-1": { status: "⬜" } }).includes("| ⬜&nbsp;AC\u20111 |") && stripMarks(tmarked).includes("| AC\u20111 |"), "a status can be reset, and stripMarks leaves a bare ID cell");
  const tsp = splice("", "intent", tbl(), { now: t });
  assert(intentFrom(tsp).length === 3, "a table region is accepted by splice and read back by intentFrom");
  // Living status: marks change only the leading glyphs, and stay editable after the merge.
  const marked = splice(withIntent, "intent", "", { marks: { "AC-1": { status: "✅" }, "AC-2": { status: "❌", prod: true } }, now: t });
  const mk = intentFrom(marked);
  assert(mk[0].status === "✅" && !mk[0].prod && mk[1].status === "❌" && mk[1].prod && mk[2].status === null && mk.every((c, i) => c.text === got[i].text && c.target === got[i].target), "marks set a status and 🚀 without touching the criterion text");
  assert(marked.includes("- ✅ AC-1 [ui:") && marked.includes("- ❌ 🚀 AC-2 [api:"), "marks are written as leading glyphs");
  const cleared = intentFrom(splice(marked, "intent", "", { marks: { "AC-2": { status: "✅", prod: false } } }));
  assert(cleared[1].status === "✅" && !cleared[1].prod && cleared[0].status === "✅", "a later mark replaces the earlier one and leaves other lines alone");
  assert(intentFrom(splice(marked, "intent", "", { merged: true, marks: { "AC-1": { status: "❌" } } }))[0].status === "❌", "a merged PR still takes a status change");
  let frozenText = false; try { splice(marked, "intent", crit(" (edited)"), { merged: true }); } catch { frozenText = true; }
  assert(frozenText, "the criteria text stays frozen after the merge");
  const plain = splice("", "intent", crit(), { now: t });
  assert(intentFrom(splice(marked, "intent", crit(), { merged: true, now: t })).length === 3 && plain.length > 0, "a merged PR accepts the same text with different marks");
  for (const [name, m] of [["an unknown id", { "AC-9": { status: "✅" } }], ["an unknown status", { "AC-1": { status: "👍" } }]]) {
    let refused = false; try { splice(withIntent, "intent", "", { marks: m }); } catch { refused = true; }
    assert(refused, `marks with ${name} are refused`);
  }
  let noRegion = false; try { splice("", "intent", "", { marks: { "AC-1": { status: "✅" } } }); } catch { noRegion = true; }
  assert(noRegion, "marks with no intent region are refused");
  const withStatus = splice("", "intent", crit().replace("- AC-1", "- ⬜ AC-1"), { now: t });
  assert(intentFrom(withStatus)[0].status === "⬜" && intentFrom(withStatus)[1].status === null, "a freshly published line may start as ⬜ and parse");
  const prodKept = splice(splice(marked, "intent", crit(), { now: t, merged: true }), "aggregate", "## ✅ ok `aaaaaaa`", { now: t });
  assert(intentFrom(prodKept)[1].prod && !intentFrom(prodKept)[0].prod, "republishing the intent region keeps the 🚀 a deploy put on a criterion");
  // An /aw brief's criteria, rendered once for both writers.
  const plan = "# Plan: x\n\n## Guardrails\n\n- Do not modify: `src/a.ts` — the user\n- Never: weaken a test | skip one\n\n## Acceptance Criteria (Definition of Done)\n\n- [ ] AC-1 (covers: R1) [ui:/settings] — When a name is empty, the form shows \"Name is required\".\n- [x] AC-2 (covers: R2) [api:PUT /api/x] — A 400 for an empty name.\n- [ ] AC-3 (covers: R3) — The CLI exits 2 on a bad flag.\n- [ ] AC-4 (covers: R4) — telemetry: checkout.submit span has attribute plan.\n- [ ] AC-5 — Lite line with no covers.\n- **After editing**: `pnpm test`\n\n## Turn Cap\n\n3 turns.\n";
  const pc = planCriteria(plan);
  assert(pc.acs.map((c) => `${c.id}:${c.kind}:${c.target}`).join() === "AC-1:ui:/settings,AC-2:api:PUT /api/x,AC-3:check:,AC-4:telemetry:checkout.submit,AC-5:check:", `plan ACs are tagged, or check/telemetry: ${pc.acs.map((c) => `${c.id}:${c.kind}:${c.target}`)}`);
  assert(pc.acs[0].text.startsWith("When a name is empty") && pc.guardrails.length === 2 && pc.guardrails[1].includes("weaken a test | skip one"), "criterion and guardrail text is verbatim");
  const fp = intentFromPlan(plan, { statuses: { "AC-1": "pass", "AC-2": "fail", "AC-3": "pending", "AC-9": "pass" } });
  const fpc = parseIntent(fp);
  assert(fpc.length === 7 && fpc.map((c) => c.id).join() === "AC-1,AC-2,AC-3,AC-4,AC-5,G-1,G-2", "the rendered region parses back to every AC and guardrail");
  assert(fpc[0].status === "✅" && fpc[1].status === "❌" && fpc[2].status === "⬜" && fpc[3].status === "⬜" && fpc[5].kind === "guardrail", "run-checks statuses become marks; others start ⬜; an unknown id is ignored");
  assert(fpc[6].text.includes("weaken a test | skip one") && fpc[1].target === "PUT /api/x" && fpc[3].target === "checkout.submit", "a pipe in a cell survives, and targets reach the Proof cell");
  assert(fp.includes("5 criteria · 1 ✅ · 1 ❌ · 3 ⬜ · 2 guardrails") && intentFrom(splice("", "intent", fp)).length === 7 && intentFromPlan(plan) === intentFromPlan(plan), "the summary counts the marks, splice accepts the region, and rendering is stable");
  let noAc = null; try { intentFromPlan("## Acceptance Criteria\n\nnothing\n"); } catch (e) { noAc = e.code; }
  assert(noAc === 3, "a brief with no AC exits 3, not 1");
  const afterAw = splice(splice("", "intent", intentFromPlan(plan), { now: t }), "intent", "", { marks: { "AC-3": { status: "✅" } }, now: t });
  assert(intentFrom(afterAw).find((c) => c.id === "AC-3").status === "✅", "aw-verify's marks apply to a row /aw wrote");
  const cli = (...a) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...a], { encoding: "utf8", input: "" });
  const tmpPlan = join(mkdtempSync(join(tmpdir(), "vc-")), "plan.md"); writeFileSync(tmpPlan, plan);
  const printed = cli("--from-plan", tmpPlan, "--statuses", '{"AC-1":"pass"}', "--print");
  assert(printed.status === 0 && parseIntent(printed.stdout)[0].status === "✅", `--print renders with no PR: ${printed.stderr}`);
  assert(cli("--from-plan", tmpPlan, "--bogus", "--print").status === 1 && cli("--from-plan", tmpPlan, "--section", "ui", "--print").status === 1, "an unknown flag, or --from-plan on another section, exits 1");
  writeFileSync(tmpPlan, "## Acceptance Criteria\n\nnone\n");
  assert(cli("--from-plan", tmpPlan, "--print").status === 3, "the CLI exits 3 for a brief with no AC");
  {
    // local gate: the run directory before a PR exists
    const fx = (d, f) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "local", d, f), "utf8");
    const intent = fx("complete", "intent.md"), report = fx("complete", "report.md");
    assert(checkLocal({ intent, report }).length === 0, "local gate: a complete run directory passes");
    assert(checkLocal({ intent: fx("open", "intent.md"), report }).some((p) => p.includes("still ⬜") && p.includes("AC-2")), "local gate: an AC with no mark is open and named");
    assert(checkLocal({ intent, report: null }).some((p) => p.includes("no report.md")), "local gate: a missing report.md fails");
    assert(checkLocal({ intent: null, report }).some((p) => p.includes("no intent.md")), "local gate: a missing intent.md fails");
    assert(checkLocal({ intent: intent + "- ✅ AC-3 checked by hand, no tag\n", report }).some((p) => p.includes("AC-3") && p.includes("tag")), "local gate: an untagged AC is named, never skipped");
    assert(checkLocal({ intent, report }, { ui: true }).some((p) => p.includes("specs.md")) && checkLocal({ intent, report, specs: true }, { ui: true }).length === 0, "local gate: a UI diff needs specs.md");
    const uiSkip = intent.replace("- ✅ AC-1", "- ⏭️ AC-1");
    assert(checkLocal({ intent: uiSkip, report }).some((p) => p.includes("AC-1") && p.includes("caps the run")), "local gate: a ui: AC ⏭️ under ✅ fails");
    assert(checkLocal({ intent: uiSkip, report: report.replace("## ✅ Verified", "## ⚠️ Verified with open items") }).length === 0, "local gate: a ui: AC ⏭️ under ⚠️ passes");
    assert(!checkLocal({ intent, report }).some((p) => p.includes("AC-2")), "local gate: an api: AC ⏭️ (tests-only) under ✅ stays allowed");
    const marked = applyMarks(fx("open", "intent.md"), { "AC-2": { status: "✅" } });
    assert(marked.includes("- ✅ AC-2 [api:PUT /api/notification-settings] An empty") && marked.split("\n").length === fx("open", "intent.md").split("\n").length, "local gate: --marks --local sets only the leading mark");
    const intentUi = "<details><summary>📋 Acceptance criteria — 1 criterion</summary>\n\n| | Criterion | Proof |\n| :-- | :-- | :-- |\n| ⏭️&nbsp;AC‑1 | does x | ui:/x · tests |\n\n</details>";
    const agg = "## ✅ Verified — does x\n\nWorks.\n\n<details><summary>Details</summary>\n\nmore\n\n</details>";
    assert(checkReport(withBlock("t", splice(splice("", "intent", intentUi), "aggregate", agg))).some((p) => p.includes("caps the run")), "PR gate: a ui: AC ⏭️ under ✅ fails");
  }
  console.log(`verify-comment self-test: ${n} assertions passed`);
}

// Every flag the CLI reads; an unknown one exits 1, so a renamed flag fails loudly instead of being ignored.
export const FLAGS = ["--pr", "--repo", "--section", "--file", "--replace-all", "--to", "--dry-run", "--existing", "--seed",
  "--head", "--notice-out", "--comment-url", "--marks", "--from-plan", "--statuses", "--print", "--self-test", "--check", "--ui", "--no-upload", "--local"];
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i + 1]; };
const has = (k) => args.includes(k);

const isMain = process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (isMain && args.includes("--self-test")) selfTest();
else if (isMain) {
  try {
    const unknown = args.find((a) => a.startsWith("--") && !FLAGS.includes(a));
    if (unknown) throw new Error(`unknown flag ${unknown}`);
    const local = opt("--local");
    if (local) {
      const read = (f) => { try { return readFileSync(join(local, f), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
      const marksArg = opt("--marks");
      if (has("--check")) {
        const problems = checkLocal({ intent: read("intent.md"), report: read("report.md"), specs: read("../specs.md") !== null }, { ui: has("--ui") });
        if (problems.length) { console.error(`verify-comment: the local run is incomplete (${local}):\n${problems.map((p) => `  - ${p}`).join("\n")}`); process.exit(1); }
        console.log("local report complete: every criterion marked, report in the template shape" + (has("--ui") ? ", specs.md present" : ""));
        process.exit(0);
      }
      if (!marksArg) throw new Error("--local takes --check or --marks");
      const intent = read("intent.md");
      if (intent === null) throw new Error(`no intent.md in ${local}`);
      const marks = JSON.parse(marksArg.trim().startsWith("{") ? marksArg : readFileSync(marksArg, "utf8"));
      writeFileSync(join(local, "intent.md"), applyMarks(intent, marks));
      console.log(`marked ${Object.keys(marks).join(", ")} in ${join(local, "intent.md")}`);
      process.exit(0);
    }
    if (has("--check")) {
      if (!opt("--pr")) throw new Error("--check needs --pr");
      const checkPr = String(opt("--pr"));
      const num = checkPr.match(/(\d+)\/?$/)?.[1];
      if (!num) throw new Error(`cannot read a PR number from "${checkPr}"`);
      const slug = opt("--repo") || checkPr.match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1] || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
      const body = Buffer.from(gh(["api", `repos/${slug}/pulls/${num}`, "--jq", ".body // \"\" | @base64"]).trim(), "base64").toString("utf8");
      const comments = gh(["api", `repos/${slug}/issues/${num}/comments`, "--paginate", "--jq", ".[] | (.body | @base64)"]).split("\n").filter(Boolean).map((b) => Buffer.from(b, "base64").toString("utf8")).reverse();
      const problems = checkReport(body, comments, { ui: has("--ui") });
      if (problems.length) { console.error(`verify-comment: the PR's report is incomplete:\n${problems.map((p) => `  - ${p}`).join("\n")}`); process.exit(1); }
      console.log("report complete: intent region ticked, aggregate in the template shape" + (has("--ui") ? ", ui-verify spec present" : ""));
      process.exit(0);
    }
    const fromPlan = opt("--from-plan");
    const section = opt("--section") ?? (fromPlan ? "intent" : undefined);
    const file = opt("--file");
    const marksArg = opt("--marks");
    const marks = marksArg ? JSON.parse(marksArg.trim().startsWith("{") ? marksArg : readFileSync(marksArg, "utf8")) : null;
    if (!section || (!file && !marks && !fromPlan)) throw new Error("--section and --file (or --marks, or --from-plan) are required");
    const statusArg = opt("--statuses");
    const statuses = statusArg && statusArg.trim() ? JSON.parse(statusArg.trim().startsWith("{") ? statusArg : readFileSync(statusArg, "utf8")) : null;
    if (fromPlan && section !== "intent") throw new Error("--from-plan writes the intent section only");
    const planText = (p) => { try { return readFileSync(p, "utf8"); } catch (e) { if (e.code === "ENOENT") { const n = new Error(`no brief at ${p}`); n.code = 3; throw n; } throw e; } };
    let content = marks ? "" : fromPlan ? intentFromPlan(planText(fromPlan), { statuses }) : readFileSync(file === "-" ? 0 : file, "utf8");
    if (has("--print")) { process.stdout.write(content + "\n"); process.exit(0); }
    const replaceAll = has("--replace-all");
    const to = opt("--to") ?? "auto";
    if (has("--dry-run")) {
      if (!["auto", "body", "comment"].includes(to)) throw new Error(`unknown --to "${to}" (expected auto, body, comment)`);
      const existingPath = opt("--existing");
      const read = (p) => (p ? readFileSync(p === "-" ? 0 : p, "utf8") : "");
      const prBody = read(existingPath);
      const seedPath = opt("--seed");
      const existing = to === "body" ? (bodyBlock(prBody) || read(seedPath)) : prBody;
      const head = opt("--head") ?? null;
      const block = splice(existing, section, content, { replaceAll, head, where: to === "body" ? "body" : "comment", marks });
      const noticeOut = opt("--notice-out");
      if (noticeOut) {
        if (!opt("--comment-url")) throw new Error("--notice-out needs --comment-url");
        const notice = existing ? flipNotice(existing, section, block, opt("--comment-url"), head) : null;
        if (notice) writeFileSync(noticeOut, notice); else rmSync(noticeOut, { force: true });
      }
      process.stdout.write(to === "body" ? withBlock(prBody, block) : block);
    } else {
      if (!opt("--pr")) throw new Error("--pr is required unless --dry-run");
      if (section === "aggregate" && content && !marks && !visibleBody(content)) { console.error("refused: the aggregate shows only its headline and collapsed blocks. Put the verdict summary, what needs a human and the findings in the open, above Details (report.md.template); a reviewer who sees only closed sections learns nothing"); process.exit(1); }
      if (!has("--no-upload") && content) {
        const slug = opt("--repo") || opt("--pr").match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1] || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
        content = await uploadMedia(content, { slug, baseDirs: [process.cwd(), ...(file && file !== "-" ? [dirname(resolve(file))] : [])] });
      }
      const rel = content ? relativeMediaLine(content) : null;
      if (rel) { console.error(`refused: ${rel} is a local media path that was not uploaded (missing file, over 10 MB, no token, or --no-upload). Upload it or say "not attached (<reason>)"`); process.exit(1); }
      console.log(upsert({ pr: opt("--pr"), repo: opt("--repo"), section, content, replaceAll, to, marks }));
    }
  } catch (e) {
    console.error(`verify-comment: ${e.message}`);
    process.exit(e.code === 2 ? 2 : e.code === 3 ? 3 : 1);
  }
}
