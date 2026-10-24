#!/usr/bin/env node
// verify-comment.mjs — upsert one region of the PR's single verify comment.
//
// One comment per PR, whoever's account posts it. Its first line is `<!-- verify:report -->`.
// Each witness owns one region:
//   <!-- verify:section=<name> --> … <!-- /verify:section=<name> -->
// Sections: aggregate (aw-verify), ui (ui-verify), telemetry (telemetry-verify).
// The script owns a last region, <!-- verify:history -->: a collapsed "Previous runs" list it
// appends to whenever a region is replaced. It also stamps `{{UPDATED}}`, marks a region that is
// older than the one just written, adds the blank lines GitHub needs inside <details>, and posts a
// one-line notice comment when a re-run changes a verdict (an edit alone notifies nobody).
//
// Usage:
//   node verify-comment.mjs --pr <n|url> --section <name> --file <region.md> [--repo <owner/name>] [--replace-all]
//   node verify-comment.mjs --section <name> --file <region.md> --existing <body.md|-> --dry-run [--replace-all]
//   node verify-comment.mjs --self-test
//
// --replace-all drops every other region (aw-verify's aggregate rewrite).
// --dry-run prints the merged body instead of writing it (the MCP access path writes it itself).
// Exit codes: 0 written or printed; 1 refused (local path or bad input); 2 GitHub call failed.

import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const MARKER = "<!-- verify:report -->";
export const SECTIONS = ["aggregate", "ui", "telemetry"];
const open = (s) => `<!-- verify:section=${s} -->`;
const close = (s) => `<!-- /verify:section=${s} -->`;
const HISTORY = "verify:history";
const HISTORY_CAP = 10;
const STALE = "<!-- verify:stale -->";
export const NOTICE = "<!-- verify:notice -->";
const VERDICTS = ["✅", "⚠️", "❌", "⛔"];
const shaOf = (region) => region.match(/`([0-9a-f]{7,40})`/)?.[1]?.slice(0, 7) ?? null;
const headlineOf = (region) => (region.split("\n").find((l) => l.trim() && !l.includes(STALE)) || "");
// The verdict glyph of a region's headline, or null when it carries none.
export const verdictOf = (region) => VERDICTS.find((v) => headlineOf(region).includes(v)) ?? null;

// GitHub renders Markdown inside <details> only with a blank line after </summary> and before
// </details>; an agent that forgets them shows the reviewer raw Markdown. Add them here.
export function normalize(content) {
  return content
    .replace(/<\/summary>[ \t]*\n?(?!\n)/g, "</summary>\n\n")
    .replace(/([^\n])\n?<\/details>/g, "$1\n\n</details>")
    .replace(/\n{3,}/g, "\n\n");
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

export function localPathLine(text) {
  return text.split("\n").find((l) => LOCAL_PATH.test(l)) ?? null;
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

export function splice(existing, section, content, { replaceAll = false, now = new Date() } = {}) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown section "${section}" (expected ${SECTIONS.join(", ")})`);
  if (/verify:(report|section=|history|stale|notice)/.test(content)) throw new Error("refused: the region holds a verify marker of its own");
  const bad = localPathLine(content);
  if (bad) throw new Error(`refused: the region holds a local path a reviewer cannot open: ${bad.trim()}`);
  const date = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const fresh = normalize(content.replaceAll("{{UPDATED}}", date)).trim();
  const old = parseRegions(existing);
  const regions = replaceAll ? new Map() : new Map(old);
  regions.set(section, fresh);
  const replaced = [...old].filter(([s, r]) => regions.get(s) !== r).map(([s, r]) => historyEntry(s, r, date));
  const history = [...replaced, ...parseHistory(existing)].slice(0, HISTORY_CAP);
  // A region on another commit than the one just written is older: say so above its headline,
  // so a stale ✅ never reads as the current verdict.
  const newest = shaOf(fresh);
  const parts = SECTIONS.filter((s) => regions.has(s)).map((s) => {
    const r = regions.get(s);
    const stale = s !== section && newest && shaOf(r) && shaOf(r) !== newest;
    if (!stale) return `${open(s)}\n${r}\n${close(s)}`;
    // Fold it to one closed line; the wrapper lines carry STALE, so parseRegions drops them.
    const headline = headlineOf(r).replace(/^#+\s*/, "").replace(/<[^>]+>/g, "").replace(/`([^`]*)`/g, "<code>$1</code>");
    return `${open(s)}\n${STALE}<details><summary>Older run on <code>${shaOf(r)}</code>: ${headline}</summary>\n\n${r}\n\n</details>${STALE}\n${close(s)}`;
  });
  if (history.length) parts.push(`<!-- ${HISTORY} -->\n<details><summary>Previous runs (${history.length})</summary>\n\nEarlier full reports are in this comment's edit history.\n\n${history.map((h) => `- ${h}`).join("\n")}\n\n</details>\n<!-- /${HISTORY} -->`);
  return `${MARKER}\n\n${parts.join("\n\n")}\n`;
}

// The one-line comment a run posts when it changes the verdict a reader saw last: the section's
// own previous verdict, else the comment's first region (a first `ui` run under a ✅ aggregate). Or null.
export function flipNotice(existing, section, written, url) {
  const prior = parseRegions(existing);
  const before = prior.get(section) ?? [...prior.values()][0];
  const was = before && verdictOf(before);
  const now = parseRegions(written).get(section);
  const is = now && verdictOf(now);
  if (!was || !is || was === is) return null;
  return `${NOTICE}\nVerify re-ran on \`${shaOf(now) ?? "?"}\`: ${was} → ${is}. [See the report](${url})`;
}

function gh(args, input) {
  const r = spawnSync("gh", args, { encoding: "utf8", input });
  if (r.status !== 0) throw Object.assign(new Error((r.stderr || r.stdout || "gh failed").trim()), { code: 2 });
  return r.stdout.trim();
}

// Edit the PR's newest verify comment, whoever wrote it, else post a new one: one PR, one
// comment, even when the same person runs verify from Agent0 (a bot account) and from a local
// session (their own). The replaced run stays in the comment's history region. A comment the
// token may not edit (HTTP 403 / 404) gets a new comment instead. `run` is injectable for --self-test.
export function upsert({ pr, repo, section, content, replaceAll }, run = gh) {
  const prNumber = String(pr).match(/(\d+)\/?$/)?.[1];
  if (!prNumber) throw new Error(`cannot read a PR number from "${pr}"`);
  const slug = repo || String(pr).match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1]
    || run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const found = run(["api", `repos/${slug}/issues/${prNumber}/comments`, "--paginate", "--jq",
    `.[] | select(.body | startswith("${MARKER}")) | [.id, .created_at, (.body | @base64)] | @tsv`])
    .split("\n").filter(Boolean).map((l) => l.split("\t"))
    .sort(([ia, ta], [ib, tb]) => (tb > ta ? 1 : tb < ta ? -1 : Number(ib) - Number(ia)));
  if (found.length) {
    const [id, , b64] = found[0];
    const existing = Buffer.from(b64, "base64").toString("utf8");
    const body = splice(existing, section, content, { replaceAll });
    try {
      const url = run(["api", "-X", "PATCH", `repos/${slug}/issues/comments/${id}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body }));
      const notice = flipNotice(existing, section, body, url);
      if (notice) {
        try { run(["api", "-X", "POST", `repos/${slug}/issues/${prNumber}/comments`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: notice })); }
        catch (e) { console.error(`verify-comment: verdict-change notice not posted: ${e.message}`); }
      }
      return url;
    } catch (e) {
      if (!/HTTP 40[34]/.test(e.message)) throw e;
    }
  }
  const body = splice("", section, content, { replaceAll });
  return run(["api", "-X", "POST", `repos/${slug}/issues/${prNumber}/comments`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body }));
}

function selfTest() {
  let n = 0;
  const assert = (ok, msg) => { n++; if (!ok) { console.error(`self-test FAIL: ${msg}`); process.exit(1); } };
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
  assert(withUi.includes("<details><summary>Older run on <code>aaaaaaa</code>: ✅ Verified — x</summary>") && parseRegions(withUi).get("aggregate") === "## ✅ Verified — x\n\n<sub>`aaaaaaa`</sub>", "a region on an older commit folds to one closed line, and the fold never becomes part of the region");
  const same = splice(agg1, "ui", "### ✅ y\n\n<sub>`aaaaaaa`</sub>", { now: t });
  assert(!same.includes("Older run"), "regions on the same commit are not marked");
  assert(!splice(withUi, "aggregate", "## ✅ again `bbbbbbb`", { replaceAll: true }).includes("Older run"), "an aggregate rewrite clears the mark");
  assert(flipNotice(agg1, "aggregate", splice(agg1, "aggregate", "## ❌ Not verified `ccccccc`"), "https://x/9") === `${NOTICE}\nVerify re-ran on \`ccccccc\`: ✅ → ❌. [See the report](https://x/9)`, "a verdict change yields a one-line notice");
  assert(flipNotice(agg1, "aggregate", splice(agg1, "aggregate", "## ✅ Verified `ccccccc`"), "u") === null && flipNotice("", "aggregate", agg1, "u") === null, "no notice without a change, or on a first run");
  assert(flipNotice(agg1, "ui", withUi, "u")?.includes("✅ → ❌"), "a first ui run that turns a ✅ comment red posts a notice");
  let stale = false; try { splice("", "ui", "<!-- verify:stale -->x"); } catch { stale = true; }
  assert(stale, "a region that carries a stale or notice marker is refused");
  // upsert against a fake gh: comments are [id, created_at, login, body].
  const ghErr = (msg) => Object.assign(new Error(msg), { code: 2 });
  const fakeGh = (comments, patchErr) => {
    const calls = [];
    const run = (a) => {
      calls.push(a[2] === "PATCH" ? `PATCH ${a[3].split("/").pop()}` : a[2]);
      if (a.includes("--paginate")) return comments.map(([id, at, , b]) => `${id}\t${at}\t${Buffer.from(b).toString("base64")}`).join("\n");
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
  assert(typeof gh === "function", "the real gh runner upsert defaults to exists");
  const flip = fakeGh([["7", "2026-01-07T00:00:00Z", "me", agg1]]);
  assert(upsert({ pr: 7, repo: "o/r", section: "aggregate", content: "## ❌ Not verified `ccccccc`", replaceAll: true }, flip.run) === "https://x/7" && flip.calls.join() .endsWith("PATCH 7,POST"), `a verdict change edits, then posts one notice: ${flip.calls}`);
  const down = fakeGh([["5", "2026-01-05T00:00:00Z", "me", one]], ghErr("gh: HTTP 502"));
  let rethrown = false; try { upsert(req, down.run); } catch { rethrown = true; }
  assert(rethrown && !down.calls.includes("POST"), "a GitHub outage fails the write instead of posting a duplicate");
  console.log(`verify-comment self-test: ${n} assertions passed`);
}

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i === -1 ? undefined : args[i + 1]; };
const has = (k) => args.includes(k);

const isMain = process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (isMain && args.includes("--self-test")) selfTest();
else if (isMain) {
  try {
    const section = opt("--section");
    const file = opt("--file");
    if (!section || !file) throw new Error("--section and --file are required");
    const content = readFileSync(file === "-" ? 0 : file, "utf8");
    const replaceAll = has("--replace-all");
    if (has("--dry-run")) {
      const existingPath = opt("--existing");
      process.stdout.write(splice(existingPath ? readFileSync(existingPath === "-" ? 0 : existingPath, "utf8") : "", section, content, { replaceAll }));
    } else {
      if (!opt("--pr")) throw new Error("--pr is required unless --dry-run");
      console.log(upsert({ pr: opt("--pr"), repo: opt("--repo"), section, content, replaceAll }));
    }
  } catch (e) {
    console.error(`verify-comment: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  }
}
