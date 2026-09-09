#!/usr/bin/env node
// validate-skill.mjs — mechanical pre-pass for the create-skill review checklist
// (rules/quality-checklist.md § Mechanical pre-pass). Checks the frontmatter and
// body contracts a skill promises that are objectively checkable, so the
// judgment-only items in the checklist are the only ones left to a human/agent
// read. Zero dependencies, Node >= 20, ESM.
//
// Usage:
//   node validate-skill.mjs <skill-dir> [--portable] [--json] [--strict]
//   node validate-skill.mjs --self-test
//
// Exit codes: 0 no FAIL findings · 1 at least one FAIL · 2 usage / unreadable
// target. `--self-test` exits 0 on pass, 1 on fail (its own contract, run
// standalone — never combined with a <skill-dir> argument).
//
// Every numeric constant below is commented with WHERE the limit comes from —
// the Agent Skills spec, the Claude Code docs, or this repo's own rule files —
// so none of them is a voodoo number nobody can trace back to a source.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ── Constants (every one justified) ──────────────────────────────────────────
const NAME_MAX = 64;        // Agent Skills spec (agentskills.io): `name` <= 64 chars.
const DESC_MAX = 1024;      // Agent Skills spec / Claude Code docs: `description` <= 1024 chars.
const DESC_WHEN_MAX = 1536; // this skill's rule (rules/description-writing.md): description +
                             // when_to_use combined <= 1536 chars before the listing truncates it.
const COMPAT_MAX = 500;     // Agent Skills spec: the `compatibility` field is capped at 500 chars.
const BODY_FAIL_MAX = 500;  // this skill's rule (rules/progressive-disclosure.md): SKILL.md body
                             // hard ceiling — content past this is effectively unreachable in Tier 2.
const BODY_WARN_MAX = 250;  // this skill's rule: soft target for the body; escalates to FAIL under
                             // --strict, matching how this repo treats 250 as the "should" line and
                             // 500 as the "must" line.
const REF_TOC_MIN = 100;    // this skill's rule (rules/progressive-disclosure.md): references/*.md
                             // over 100 lines need a `## Contents` TOC (references are the deepest,
                             // most skippable tier, so the TOC is the partial-read safety net).
const RULE_TOC_MIN = 150;   // this skill's rule: rules/*.md over 150 lines need the same TOC — rules
                             // are read WHOLE rather than partially, so the threshold is looser.
const LENS_MAX = 80;        // rules/review-lens-contract.md: a lens.md file is hard-capped at 80
                             // lines (~600 tokens) so the pr-reviewer agent can afford to load three.

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const BD05_RE = new RegExp(`\\b(before|after|as of|until)\\s+(?:(?:${MONTHS})\\s+)?20\\d\\d\\b`, "i");

// ── Findings collector ───────────────────────────────────────────────────────
class Findings {
  constructor() { this.list = []; this.pass = 0; this.fail = 0; this.warn = 0; }
  /** Record one check outcome. `ok` true means no finding is emitted. */
  check(id, level, ok, file, line, message) {
    if (ok) { this.pass++; return; }
    if (level === "FAIL") this.fail++; else this.warn++;
    this.list.push({ id, level, file, line: line ?? null, message });
  }
}

// ── Frontmatter parser ───────────────────────────────────────────────────────
// Hand-rolled, deliberately narrow: top-level `key: value`, folded `>` and
// literal `|` block scalars, one level of nested map (e.g. `metadata:`), YAML
// `- item` lists (top-level or nested one level under a map key), and quoted
// scalars. This is not a general YAML parser — it recognises exactly the shapes
// this repo's SKILL.md frontmatter uses (see scripts/eval/lib.mjs's own
// `frontmatter()` helper for the same house style at a smaller scope).

/** Strip a trailing ` #comment` that isn't inside quotes. */
function stripComment(s) {
  let inSingle = false, inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && i > 0 && s[i - 1] === " ") return s.slice(0, i).trimEnd();
  }
  return s;
}

/** Parse a single scalar token (quoted or plain), returning { value, quoted }. */
function parseScalar(raw) {
  const s = stripComment(raw.trim());
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return { value: s.slice(1, -1).replace(/''/g, "'"), quoted: true };
  }
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return { value: s.slice(1, -1).replace(/\\"/g, '"'), quoted: true };
  }
  return { value: s, quoted: false };
}

/** Collect the indented lines under a `>` / `|` block scalar marker. Content
 *  lines are trimmed — neither check here needs the block's original
 *  indentation, only its text. */
function collectBlockScalar(lines, i, keyIndent) {
  const collected = [];
  let j = i;
  while (j < lines.length) {
    const line = lines[j];
    if (line.trim() === "") { collected.push(""); j++; continue; }
    const indent = line.match(/^ */)[0].length;
    if (indent <= keyIndent) break;
    collected.push(line.trim());
    j++;
  }
  while (collected.length && collected[collected.length - 1] === "") collected.pop();
  return { collected, consumed: j - i };
}

/** Recursive-descent parse of a block of lines at exactly `indent`, starting at
 *  index `i`. Returns { node, next } where `node` is `{type:'map',entries}` or
 *  `{type:'list',items}`, or null if nothing is present at that indent. */
function parseBlockAt(lines, i, indent, lineOffset) {
  let k = i;
  while (k < lines.length && lines[k].trim() === "") k++;
  if (k >= lines.length) return { node: null, next: k };
  const firstIndent = lines[k].match(/^ */)[0].length;
  if (firstIndent < indent) return { node: null, next: i };
  const content = lines[k].slice(firstIndent);

  if (content === "-" || content.startsWith("- ")) {
    const items = [];
    let j = k;
    while (j < lines.length) {
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length) break;
      const li = lines[j].match(/^ */)[0].length;
      if (li !== firstIndent) break;
      const c = lines[j].slice(li);
      const m = /^-\s?(.*)$/.exec(c);
      if (!m) break;
      const lineNo = j + lineOffset;
      j++;
      const sc = parseScalar(m[1] ?? "");
      items.push({ ...sc, line: lineNo });
    }
    return { node: { type: "list", items }, next: j };
  }

  const entries = new Map();
  let j = k;
  while (j < lines.length) {
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length) break;
    const li = lines[j].match(/^ */)[0].length;
    if (li !== firstIndent) break;
    const m = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[j].slice(li));
    if (!m) break;
    const key = m[1];
    let rest = m[2];
    if (rest.startsWith(" ")) rest = rest.slice(1);
    const lineNo = j + lineOffset;
    j++;
    if (rest === "") {
      let p = j;
      while (p < lines.length && lines[p].trim() === "") p++;
      const childIndent = p < lines.length ? lines[p].match(/^ */)[0].length : -1;
      if (childIndent > li) {
        const { node, next } = parseBlockAt(lines, p, childIndent, lineOffset);
        entries.set(key, node ? { ...node, line: lineNo } : { type: "scalar", value: "", quoted: false, line: lineNo });
        j = next;
      } else {
        entries.set(key, { type: "scalar", value: "", quoted: false, line: lineNo });
      }
    } else if (rest === ">" || rest.startsWith(">")) {
      const { collected, consumed } = collectBlockScalar(lines, j, li);
      j += consumed;
      const value = collected.filter((l) => l !== "").join(" ");
      entries.set(key, { type: "folded", value, quoted: false, line: lineNo });
    } else if (rest === "|" || rest.startsWith("|")) {
      const { collected, consumed } = collectBlockScalar(lines, j, li);
      j += consumed;
      entries.set(key, { type: "literal", value: collected.join("\n"), quoted: false, line: lineNo });
    } else {
      const sc = parseScalar(rest);
      entries.set(key, { type: "scalar", ...sc, line: lineNo });
    }
  }
  return { node: { type: "map", entries }, next: j };
}

/** Parse a file's frontmatter block. Returns:
 *  { present, openingOk, closeLine, map, bodyStartLine, bodyLines } — `map` is
 *  a `Map<string, node>` of top-level keys (empty map if unparseable). */
function parseFrontmatter(text) {
  const lines = text.split("\n");
  const openingOk = lines[0] === "---";
  let closeIdx = -1;
  if (openingOk) {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") { closeIdx = i; break; }
    }
  }
  if (!openingOk || closeIdx < 0) {
    return { present: false, openingOk, closeLine: null, map: new Map(), bodyStartLine: 1, bodyLines: lines };
  }
  const rawLines = lines.slice(1, closeIdx); // 0-indexed; file line = idx + 2
  const { node } = parseBlockAt(rawLines, 0, 0, 2);
  const map = node && node.type === "map" ? node.entries : new Map();
  const bodyLines = lines.slice(closeIdx + 1);
  while (bodyLines.length && bodyLines[bodyLines.length - 1] === "") bodyLines.pop();
  return { present: true, openingOk, closeLine: closeIdx + 1, map, bodyStartLine: closeIdx + 2, bodyLines };
}

/** Get the plain text of a top-level node (scalar/folded/literal), or undefined. */
function nodeText(node) {
  if (!node) return undefined;
  if (node.type === "scalar" || node.type === "folded" || node.type === "literal") return node.value;
  return undefined;
}

function getText(map, key) { return nodeText(map.get(key)); }
function getLine(map, key) { const n = map.get(key); return n ? n.line : undefined; }

function parseBool(raw) {
  if (raw === undefined) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(s)) return true;
  if (["false", "no", "off", "0"].includes(s)) return false;
  return undefined;
}

// ── FM: frontmatter checks ───────────────────────────────────────────────────
function checkFrontmatter(f, ctx, flags) {
  const { text, dirName, map, present, openingOk, closeLine } = ctx;

  f.check("FM01", "FAIL", present && openingOk, "SKILL.md", 1,
    "frontmatter block present with opening `---` on line 1");
  if (!present) return; // nothing else is parseable without a frontmatter block

  const name = getText(map, "name");
  const nameLine = getLine(map, "name");

  f.check("FM02", "FAIL",
    !!name && name.length <= NAME_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name),
    "SKILL.md", nameLine,
    `name must match ^[a-z0-9]+(-[a-z0-9]+)*$ and be <= ${NAME_MAX} chars, got ${JSON.stringify(name)}`);

  const nameIsClean = !!name && !/anthropic|claude/i.test(name) && dirName !== "synced";
  f.check("FM03", "FAIL", nameIsClean, "SKILL.md", nameLine,
    `name must not contain "anthropic"/"claude" and the directory must not be "synced" (name=${JSON.stringify(name)}, dir=${JSON.stringify(dirName)})`);

  f.check("FM04", "FAIL", !!name && name === dirName, "SKILL.md", nameLine,
    `name (${JSON.stringify(name)}) must equal the directory basename (${JSON.stringify(dirName)})`);

  const description = getText(map, "description");
  const descLine = getLine(map, "description");
  f.check("FM05", "FAIL", !!description && description.length > 0 && description.length <= DESC_MAX,
    "SKILL.md", descLine,
    `description must be non-empty and <= ${DESC_MAX} chars, got ${description ? description.length : 0}`);

  const whenToUse = getText(map, "when_to_use");
  const combinedLen = (description ? description.length : 0) + (whenToUse ? whenToUse.length : 0);
  f.check("FM06", "WARN", combinedLen <= DESC_WHEN_MAX, "SKILL.md", descLine,
    `description + when_to_use combined must be <= ${DESC_WHEN_MAX} chars, got ${combinedLen}`);

  // FM07: the Skills API rejects an XML tag in name/description, and the upload packager
  // (anthropics/skills quick_validate.py) rejects ANY `<` / `>` in a description — so under
  // --portable a bare angle bracket fails. Without the flag only a real tag fires: a closing
  // tag, a tag carrying an attribute, or a self-closing tag. A bare `<placeholder>` — the
  // `<…>` form rules/frontmatter.md mandates for argument-hint and CLI examples — passes.
  const realXmlTag = /<\/[a-zA-Z][\w-]*\s*>|<[a-zA-Z][\w-]*\s+[\w:-]+\s*=|<[a-zA-Z][\w-]*\s*\/>/;
  const anyAngle = /[<>]/;
  const fm07Re = flags.portable ? anyAngle : realXmlTag;
  const fm07Msg = flags.portable
    ? "name/description must not contain < or > under --portable (the Skills API and quick_validate.py reject them)"
    : "name/description must not contain an XML tag (a bare <placeholder> is fine; use --portable for the strict upload rule)";
  f.check("FM07", "FAIL",
    !(name && fm07Re.test(name)) && !(description && fm07Re.test(description)),
    "SKILL.md", descLine, fm07Msg);

  const firstWord = description ? (description.trim().split(/\s+/)[0] || "").replace(/[^A-Za-z]/g, "") : "";
  f.check("FM08", "WARN", !description || /^[A-Z][a-z]+s$/.test(firstWord), "SKILL.md", descLine,
    `description should open with a third-person verb ending in "s" (e.g. "Reviews…"), got first word ${JSON.stringify(firstWord)}`);

  const dmi = parseBool(getText(map, "disable-model-invocation"));
  const slashForm = name ? `/${name}` : null;
  f.check("FM09", "WARN", dmi !== true || (!!description && !!slashForm && description.includes(slashForm)),
    "SKILL.md", descLine,
    `disable-model-invocation: true should keep a "/${name}" slash form in description (users can't rely on auto-trigger)`);

  // FM10 mirrors L1's Check F2 exactly: scan RAW lines, not the parsed structure,
  // because a bare ": " in a plain scalar is a YAML parse hazard that would break
  // a strict parser's read of the WHOLE frontmatter block, not just this key.
  {
    const raw = text.split("---\n");
    const offenders = [];
    if (raw.length >= 3 && raw[0] === "") {
      raw[1].split("\n").forEach((line, idx) => {
        const m = /^([A-Za-z_][\w-]*): (.+)$/.exec(line);
        if (m && !/^["'|>]/.test(m[2]) && m[2].includes(": ")) offenders.push({ key: m[1], line: idx + 2 });
      });
    }
    f.check("FM10", "FAIL", offenders.length === 0, "SKILL.md", offenders[0]?.line,
      offenders.length ? `bare ": " in plain scalar(s): ${offenders.map((o) => o.key).join(", ")} — quote the value or use an em dash` : "");
  }

  const userInvocable = parseBool(getText(map, "user-invocable"));
  const argHint = map.get("argument-hint");
  f.check("FM11", "WARN", userInvocable === false || argHint !== undefined, "SKILL.md", getLine(map, "argument-hint") ?? nameLine,
    "argument-hint should be present unless user-invocable: false");

  if (flags.portable) {
    const ALLOWED = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
    const extra = [...map.keys()].filter((k) => !ALLOWED.has(k));
    f.check("FM12", "FAIL", extra.length === 0, "SKILL.md", 1,
      extra.length ? `Claude-Code-only field(s) under --portable: ${extra.join(", ")}` : "");
  }

  const compat = getText(map, "compatibility");
  f.check("FM13", "WARN", compat === undefined || compat.length <= COMPAT_MAX, "SKILL.md", getLine(map, "compatibility"),
    `compatibility should be <= ${COMPAT_MAX} chars, got ${compat ? compat.length : 0}`);

  const metadataNode = map.get("metadata");
  const version = metadataNode && metadataNode.type === "map" ? nodeText(metadataNode.entries.get("version")) : undefined;
  f.check("FM14", "FAIL", version === undefined || /^\d+\.\d+\.\d+$/.test(version), "SKILL.md",
    metadataNode?.type === "map" ? metadataNode.entries.get("version")?.line : getLine(map, "metadata"),
    `metadata.version must be semver (\\d+.\\d+.\\d+), got ${JSON.stringify(version)}`);
}

// ── BD: body checks ──────────────────────────────────────────────────────────
function checkBody(f, ctx, flags) {
  const { bodyLines, bodyStartLine } = ctx;

  const bodyLineCount = bodyLines.length;
  f.check("BD01", "FAIL", bodyLineCount <= BODY_FAIL_MAX, "SKILL.md", null,
    `body is ${bodyLineCount} lines, hard cap is ${BODY_FAIL_MAX}`);
  const bd02Level = flags.strict ? "FAIL" : "WARN";
  f.check("BD02", bd02Level, bodyLineCount <= BODY_WARN_MAX, "SKILL.md", null,
    `body is ${bodyLineCount} lines, soft target is ${BODY_WARN_MAX}${flags.strict ? " (--strict)" : ""}`);

  // BD03/BD04 share one pass over the body: track fence open/close state so BD04's
  // inline-backtick scan can skip lines that are inside a fenced code block (a code
  // sample deliberately showing a Windows path is not a doc bug).
  let inFence = false;
  let fenceLen = 0;
  bodyLines.forEach((line, idx) => {
    const lineNo = bodyStartLine + idx;
    const fenceM = /^\s*(`{3,})(.*)$/.exec(line);
    if (fenceM) {
      const backticks = fenceM[1];
      const info = fenceM[2].trim();
      if (!inFence) {
        inFence = true;
        fenceLen = backticks.length;
        // A ```! dynamic-context-injection block counts as declared — its info
        // string IS the marker, not a missing language.
        f.check("BD03", "FAIL", info !== "", "SKILL.md", lineNo,
          "fenced code block opener must declare a language (or be a ```! injection block)");
      } else if (backticks.length >= fenceLen) {
        inFence = false; // closer — never flagged, regardless of trailing content
      }
      return;
    }
    if (inFence) return;
    const inlineRe = /`([^`]+)`/g;
    let m;
    while ((m = inlineRe.exec(line))) {
      if (/\w\\\w/.test(m[1])) {
        f.check("BD04", "FAIL", false, "SKILL.md", lineNo, `backslash path inside inline code: \`${m[1]}\``);
      }
    }
    if (BD05_RE.test(line)) {
      f.check("BD05", "WARN", false, "SKILL.md", lineNo, `time-sensitive phrasing: "${line.match(BD05_RE)[0]}"`);
    }
  });
}

// ── PD / SC: directory checks ────────────────────────────────────────────────
function mdFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(".md") && statSync(join(dir, n)).isFile()).sort();
}

function extractLinks(text) {
  const out = [];
  let fence = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const re = /\[[^\]]*\]\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(line))) out.push({ line: i + 1, target: m[1].trim() });
  });
  return out;
}

function checkPortabilityDocs(f, ctx) {
  const { dir, text } = ctx;
  const rulesDir = join(dir, "rules");
  const refsDir = join(dir, "references");

  // PD01: a rules/ or references/ file counts as linked if SKILL.md's raw text
  // contains its skill-relative path anywhere (not necessarily inside `[...](...)`
  // markdown link syntax — a bare mention in prose still counts).
  for (const [label, files] of [["rules", mdFilesIn(rulesDir)], ["references", mdFilesIn(refsDir)]]) {
    for (const name of files) {
      const relPath = `${label}/${name}`;
      f.check("PD01", "FAIL", text.includes(relPath), "SKILL.md", null,
        `${relPath} is never mentioned in SKILL.md — orphaned file`);
    }
  }

  // PD02: no dangling relative link, checked across SKILL.md + every rules/ and
  // references/ file. Only file EXISTENCE is asserted (never anchor validity —
  // that's a stricter check this repo's own L1 Check A already runs at the
  // whole-repo level).
  const filesToScan = [
    { path: join(dir, "SKILL.md"), rel: "SKILL.md" },
    ...mdFilesIn(rulesDir).map((n) => ({ path: join(rulesDir, n), rel: `rules/${n}` })),
    ...mdFilesIn(refsDir).map((n) => ({ path: join(refsDir, n), rel: `references/${n}` })),
  ];
  let pd02Seen = false;
  for (const { path, rel } of filesToScan) {
    const t = readFileSync(path, "utf8");
    for (const { line, target } of extractLinks(t)) {
      if (/^(https?:|mailto:)/.test(target) || target.includes("<") || target.includes("{") || target === "...") continue;
      if (target.startsWith("/")) continue; // absolute path = illustrative, not repo-relative
      const [pathPart] = target.split("#");
      if (pathPart === "") continue; // pure in-file anchor
      const tf = join(path, "..", pathPart);
      pd02Seen = true;
      f.check("PD02", "FAIL", existsSync(tf), rel, line, `dangling relative link: ${target}`);
    }
  }
  if (!pd02Seen) f.check("PD02", "FAIL", true, "SKILL.md", null, "");

  // PD03: TOC presence on long references/rules files.
  const tocRe = /^##\s+(contents|table of contents)\s*$/im;
  for (const name of mdFilesIn(refsDir)) {
    const p = join(refsDir, name);
    const lc = readFileSync(p, "utf8").split("\n").length;
    if (lc > REF_TOC_MIN) f.check("PD03", "WARN", tocRe.test(readFileSync(p, "utf8")), `references/${name}`, null,
      `references/${name} is ${lc} lines (> ${REF_TOC_MIN}) with no ## Contents heading`);
  }
  for (const name of mdFilesIn(rulesDir)) {
    const p = join(rulesDir, name);
    const lc = readFileSync(p, "utf8").split("\n").length;
    if (lc > RULE_TOC_MIN) f.check("PD03", "WARN", tocRe.test(readFileSync(p, "utf8")), `rules/${name}`, null,
      `rules/${name} is ${lc} lines (> ${RULE_TOC_MIN}) with no ## Contents heading`);
  }
  if (!f.list.some((x) => x.id === "PD03")) f.check("PD03", "WARN", true, "SKILL.md", null, "");

  // PD04: lens.md, if present, is a top-level sibling of SKILL.md.
  const lensPath = join(dir, "lens.md");
  if (existsSync(lensPath)) {
    const lensText = readFileSync(lensPath, "utf8");
    const lc = lensText.split("\n").length;
    const { map: lensMap, present: lensPresent } = parseFrontmatter(lensText);
    const forVal = lensPresent ? getText(lensMap, "for") : undefined;
    const lensVersion = lensPresent ? getText(lensMap, "lens-version") : undefined;
    f.check("PD04", "WARN", lc <= LENS_MAX && forVal === "pr-reviewer" && String(lensVersion) === "1",
      "lens.md", null,
      `lens.md must be <= ${LENS_MAX} lines and declare for: pr-reviewer + lens-version: 1 (lines=${lc}, for=${JSON.stringify(forVal)}, lens-version=${JSON.stringify(lensVersion)})`);
  } else {
    f.check("PD04", "WARN", true, "SKILL.md", null, "");
  }

  // SC01: scripts/ existing implies SKILL.md invokes at least one script through
  // ${CLAUDE_SKILL_DIR} (rules/scripts-and-assets.md § Path convention). A bare
  // `scripts/` mention is NOT accepted — a cwd-relative path is exactly the form the
  // rule forbids, and accepting it let create-skill self-validate clean on a violation.
  const scriptsDir = join(dir, "scripts");
  if (existsSync(scriptsDir) && statSync(scriptsDir).isDirectory()) {
    f.check("SC01", "WARN", text.includes("${CLAUDE_SKILL_DIR}"), "SKILL.md", null,
      "scripts/ exists but SKILL.md never invokes a script through ${CLAUDE_SKILL_DIR} (a cwd-relative scripts/ path is not portable — see rules/scripts-and-assets.md § Path convention)");
  } else {
    f.check("SC01", "WARN", true, "SKILL.md", null, "");
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
/** @returns {{ skill: string, ok: boolean, findings: object[], counts: {fail:number, warn:number, pass:number} }} */
export function validateSkill(dir, flags = {}) {
  const skillMdPath = join(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) {
    const err = new Error(`no SKILL.md found at ${dir}`);
    err.usage = true;
    throw err;
  }
  const text = readFileSync(skillMdPath, "utf8");
  const { present, openingOk, map, bodyLines, bodyStartLine } = parseFrontmatter(text);
  const dirName = basename(resolve(dir));
  const ctx = { dir, text, dirName, map, present, openingOk, bodyLines, bodyStartLine };

  const f = new Findings();
  checkFrontmatter(f, ctx, flags);
  checkBody(f, ctx, flags);
  checkPortabilityDocs(f, ctx);

  const skillName = getText(map, "name") || dirName;
  return {
    skill: skillName,
    ok: f.fail === 0,
    findings: f.list,
    counts: { fail: f.fail, warn: f.warn, pass: f.pass },
  };
}

function printHuman(result) {
  for (const finding of result.findings) {
    const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    console.log(`${finding.level} ${finding.id} ${loc} — ${finding.message}`);
  }
  const total = result.counts.pass + result.counts.fail + result.counts.warn;
  if (result.ok) {
    console.log(`Self-check: PASS (${result.counts.pass}/${total})`);
  } else {
    console.log(`Self-check: FAIL — ${result.counts.fail} failing`);
  }
}

function printJson(result) {
  console.log(JSON.stringify({
    skill: result.skill,
    pass: result.ok,
    findings: result.findings,
    counts: result.counts,
  }));
}

// ── --self-test ───────────────────────────────────────────────────────────────
// Builds temp fixtures under os.tmpdir() and asserts each check id fires exactly
// where expected and nowhere else, then cleans up. Executed directly by
// scripts/eval/l1.mjs's G51a (spawnSync(process.execPath, [..., "--self-test"])).
// `build` receives the temp root and returns the SKILL DIRECTORY to validate
// (its basename must equal the fixture's `name:` for a "clean" fixture to pass
// FM04 — the directory-basename match check — so every fixture below nests its
// SKILL.md under a subdirectory named after the skill).
function withFixture(build, run) {
  const root = mkdtempSync(join(tmpdir(), "validate-skill-"));
  try {
    const skillDir = build(root);
    return run(skillDir);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeSkill(root, name, frontmatterExtra, bodyLines, dirName = name) {
  const dir = join(root, dirName);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `name: ${name}`,
    "description: >",
    "  Does the thing this fixture skill is supposed to do, for testing",
    "  purposes only. Triggers on \"do the thing\", \"/fixture\".",
    "disable-model-invocation: false",
    "argument-hint: '[none]'",
    "license: MIT",
    "metadata:",
    "  author: test",
    "  version: '1.0.0'",
    "  tags:",
    "    - fixture",
    ...(frontmatterExtra ?? []),
    "---",
    "",
  ].join("\n");
  const body = (bodyLines ?? ["# Fixture", "", "Body text."]).join("\n") + "\n";
  writeFileSync(join(dir, "SKILL.md"), fm + body);
  return dir;
}

function selfTest() {
  let fails = 0;
  const t = (label, ok, detail = "") => {
    if (ok) return;
    fails++;
    console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
  };
  const hasId = (result, id) => result.findings.some((x) => x.id === id);

  // 1. A clean skill: no FAIL findings, ok === true.
  withFixture((root) => writeSkill(root, "my-fixture"), (dir) => {
    const r = validateSkill(dir);
    t("clean skill: ok === true", r.ok === true, JSON.stringify(r.findings));
    t("clean skill: no FAIL findings", r.counts.fail === 0, JSON.stringify(r.findings));
  });

  // 2. Bad name: invalid regex (FM02) + directory mismatch (FM04) both fire —
  // the directory is deliberately named differently from the frontmatter `name`.
  withFixture((root) => writeSkill(root, "Bad_Name", [], undefined, "different-dir"), (dir) => {
    const r = validateSkill(dir);
    t("bad name: FM02 fires", hasId(r, "FM02"));
    t("bad name: FM04 fires", hasId(r, "FM04"));
    t("bad name: not ok", r.ok === false);
  });

  // 3. Over-long description -> FM05 fires, nothing else about it.
  withFixture((root) => {
    const dir = join(root, "long-desc");
    mkdirSync(dir, { recursive: true });
    const longDesc = "Reviews " + "x".repeat(DESC_MAX + 10);
    const fm = [
      "---", "name: long-desc", `description: >`,
      `  ${longDesc}`,
      "disable-model-invocation: false", "argument-hint: '[none]'", "license: MIT",
      "metadata:\n  author: test\n  version: '1.0.0'",
      "---", "", "# Body", "",
    ].join("\n");
    writeFileSync(join(dir, "SKILL.md"), fm);
    return dir;
  }, (dir) => {
    const r = validateSkill(dir);
    t("over-long description: FM05 fires", hasId(r, "FM05"), JSON.stringify(r.findings.filter((x) => x.id === "FM05")));
  });

  // 4. Dangling link -> PD02 fires.
  withFixture((root) => writeSkill(root, "dangling-link", [], ["# Body", "", "See [nope](rules/missing.md)."]), (dir) => {
    const r = validateSkill(dir);
    t("dangling link: PD02 fires", hasId(r, "PD02"), JSON.stringify(r.findings.filter((x) => x.id === "PD02")));
  });

  // 5. Undeclared fence -> BD03 fires; a declared one and a ```! block do not.
  withFixture((root) => writeSkill(root, "bad-fence", [], ["# Body", "", "```", "no lang here", "```", "", "```js", "ok(1);", "```", "", "```!", "echo hi", "```!"]), (dir) => {
    const r = validateSkill(dir);
    const bd03 = r.findings.filter((x) => x.id === "BD03");
    t("undeclared fence: BD03 fires exactly once", bd03.length === 1, JSON.stringify(bd03));
  });

  // 6. Claude-Code-only field under --portable -> FM12 fires only with the flag.
  withFixture((root) => writeSkill(root, "portable-test"), (dir) => {
    const withoutFlag = validateSkill(dir, {});
    t("Claude-Code field without --portable: FM12 does not fire", !hasId(withoutFlag, "FM12"));
    const withFlag = validateSkill(dir, { portable: true });
    t("Claude-Code field with --portable: FM12 fires", hasId(withFlag, "FM12"), JSON.stringify(withFlag.findings.filter((x) => x.id === "FM12")));
  });

  // 7. FM10: a bare ": " in a plain scalar fires, and only for the offending key.
  withFixture((root) => {
    const dir = join(root, "colon-test");
    mkdirSync(dir, { recursive: true });
    const fm = [
      "---", "name: colon-test",
      "description: A skill absorbing the reasoning: unquoted colon here",
      "disable-model-invocation: false", "argument-hint: '[none]'", "license: MIT",
      "metadata:\n  author: test\n  version: '1.0.0'",
      "---", "", "# Body", "",
    ].join("\n");
    writeFileSync(join(dir, "SKILL.md"), fm);
    return dir;
  }, (dir) => {
    const r = validateSkill(dir);
    t("bare colon in plain scalar: FM10 fires", hasId(r, "FM10"), JSON.stringify(r.findings.filter((x) => x.id === "FM10")));
  });

  // 8. FM14: non-semver metadata.version fires.
  withFixture((root) => {
    const dir = join(root, "bad-version");
    mkdirSync(dir, { recursive: true });
    const fm = [
      "---", "name: bad-version", "description: >", "  Reviews things for testing.",
      "disable-model-invocation: false", "argument-hint: '[none]'", "license: MIT",
      "metadata:", "  author: test", "  version: 'v1'",
      "---", "", "# Body", "",
    ].join("\n");
    writeFileSync(join(dir, "SKILL.md"), fm);
    return dir;
  }, (dir) => {
    const r = validateSkill(dir);
    t("non-semver metadata.version: FM14 fires", hasId(r, "FM14"), JSON.stringify(r.findings.filter((x) => x.id === "FM14")));
  });

  // 9. Body over BODY_FAIL_MAX lines -> BD01 fires.
  withFixture((root) => writeSkill(root, "long-body", [], Array.from({ length: BODY_FAIL_MAX + 5 }, (_, i) => `line ${i}`)), (dir) => {
    const r = validateSkill(dir);
    t("over-long body: BD01 fires", hasId(r, "BD01"), JSON.stringify(r.findings.filter((x) => x.id === "BD01")));
  });

  // 10. Missing SKILL.md -> usage error, not a crash.
  withFixture((root) => join(root, "no-skill-md"), (dir) => {
    let threw = false;
    try { validateSkill(dir); } catch (e) { threw = !!e.usage; }
    t("missing SKILL.md: throws a usage error", threw);
  });

  // 11. SC01: a scripts/ dir with only a cwd-relative mention fires; ${CLAUDE_SKILL_DIR} does not.
  withFixture((root) => {
    const dir = writeSkill(root, "has-scripts", [], ["# Body", "", "Run `node scripts/check.mjs`."]);
    mkdirSync(join(dir, "scripts"), { recursive: true });
    return dir;
  }, (dir) => {
    t("scripts/ with cwd-relative path only: SC01 fires", hasId(validateSkill(dir), "SC01"));
  });
  withFixture((root) => {
    const dir = writeSkill(root, "has-scripts-ok", [], ["# Body", "", "Run `node ${CLAUDE_SKILL_DIR}/scripts/check.mjs`."]);
    mkdirSync(join(dir, "scripts"), { recursive: true });
    return dir;
  }, (dir) => {
    t("scripts/ with ${CLAUDE_SKILL_DIR} path: SC01 does not fire", !hasId(validateSkill(dir), "SC01"));
  });

  // 12. FM07 profile split: a bare <placeholder> passes without --portable and fails with it;
  //     a real XML tag fails either way.
  withFixture((root) => {
    const dir = join(root, "placeholder-desc");
    mkdirSync(dir, { recursive: true });
    const fm = [
      "---", "name: placeholder-desc",
      "description: >", "  Reviews things; invoke with remember <fact> or /x <PR-URL|#n>.",
      "disable-model-invocation: false", "argument-hint: '[none]'", "license: MIT",
      "metadata:", "  author: test", "  version: '1.0.0'",
      "---", "", "# Body", "",
    ].join("\n");
    writeFileSync(join(dir, "SKILL.md"), fm);
    return dir;
  }, (dir) => {
    t("bare <placeholder> without --portable: FM07 does not fire", !hasId(validateSkill(dir, {}), "FM07"));
    t("bare <placeholder> with --portable: FM07 fires", hasId(validateSkill(dir, { portable: true }), "FM07"));
  });
  withFixture((root) => {
    const dir = join(root, "real-tag-desc");
    mkdirSync(dir, { recursive: true });
    const fm = [
      "---", "name: real-tag-desc",
      "description: >", "  Reviews <b>things</b> for testing.",
      "disable-model-invocation: false", "argument-hint: '[none]'", "license: MIT",
      "metadata:", "  author: test", "  version: '1.0.0'",
      "---", "", "# Body", "",
    ].join("\n");
    writeFileSync(join(dir, "SKILL.md"), fm);
    return dir;
  }, (dir) => {
    t("real XML tag without --portable: FM07 fires", hasId(validateSkill(dir, {}), "FM07"));
  });

  const ok = fails === 0;
  console.log(ok ? "validate-skill self-test: PASS (12 assertions)" : `validate-skill self-test: FAIL (${fails} failure(s))`);
  return ok;
}

// ── CLI ───────────────────────────────────────────────────────────────────────
function usage() {
  console.error("Usage: node validate-skill.mjs <skill-dir> [--portable] [--json] [--strict]");
  console.error("       node validate-skill.mjs --self-test");
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) {
    process.exit(selfTest() ? 0 : 1);
  }
  const flags = {
    portable: argv.includes("--portable"),
    json: argv.includes("--json"),
    strict: argv.includes("--strict"),
  };
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) { usage(); process.exit(2); }
  const dir = resolve(positional[0]);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`Not a directory: ${dir}`);
    process.exit(2);
  }
  let result;
  try {
    result = validateSkill(dir, flags);
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  if (flags.json) printJson(result); else printHuman(result);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
