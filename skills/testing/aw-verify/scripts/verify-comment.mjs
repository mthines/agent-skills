#!/usr/bin/env node
// verify-comment.mjs — upsert one region of the PR's single verify comment.
//
// The comment's first line is `<!-- verify:report -->`. Each witness owns one region:
//   <!-- verify:section=<name> --> … <!-- /verify:section=<name> -->
// Sections: aggregate (aw-verify), ui (ui-verify), telemetry (telemetry-verify).
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
const HEADER = `${MARKER}\n## Verify\n\n<sub>One comment per PR: each verify skill updates its own section below.</sub>`;

// A path a reviewer cannot open: a file:// URL, the run's scratch dirs, a file under a home dir,
// or a temp dir. An HTTP route such as `GET /home/feed` or `PUT /private/settings` is not one.
const B = "(?:^|[\\s(`'\"=\\[])";
const LOCAL_PATH = new RegExp([
  "file:\\/\\/",
  `${B}(?:\\.{1,2}\\/)?\\.(?:agent|aw-tester|ui-verify)\\/`,
  `${B}\\/(?:Users|home)\\/[^\\s)\`'"]+\\.[A-Za-z0-9]{1,5}(?=$|[\\s)\`'",.:;])`,
  `${B}\\/(?:tmp|private\\/(?:tmp|var)|var\\/folders|root)\\/`,
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
    if (start !== -1 && end > start) regions.set(s, body.slice(start + open(s).length, end).trim());
  }
  if (regions.size === 0) {
    const legacy = body.slice(MARKER.length).trim();
    if (legacy) regions.set("aggregate", legacy);
  }
  return regions;
}

export function splice(existing, section, content, { replaceAll = false } = {}) {
  if (!SECTIONS.includes(section)) throw new Error(`unknown section "${section}" (expected ${SECTIONS.join(", ")})`);
  if (content.includes(MARKER) || content.includes("verify:section=")) throw new Error("refused: the region holds a verify marker of its own");
  const bad = localPathLine(content);
  if (bad) throw new Error(`refused: the region holds a local path a reviewer cannot open: ${bad.trim()}`);
  const regions = replaceAll ? new Map() : parseRegions(existing);
  regions.set(section, content.trim());
  const parts = SECTIONS.filter((s) => regions.has(s)).map((s) => `${open(s)}\n${regions.get(s)}\n${close(s)}`);
  return `${HEADER}\n\n${parts.join("\n\n")}\n`;
}

function gh(args, input) {
  const r = spawnSync("gh", args, { encoding: "utf8", input });
  if (r.status !== 0) throw Object.assign(new Error((r.stderr || r.stdout || "gh failed").trim()), { code: 2 });
  return r.stdout.trim();
}

// Try each verify comment, newest first; GitHub refuses (403/404) an edit to another author's, so
// the first PATCH it accepts is the viewer's own. No identity lookup: `/user` 401s or 403s under an
// App or Actions token, and an unknown login would post a duplicate. `run` is injectable for --self-test.
export function upsert({ pr, repo, section, content, replaceAll }, run = gh) {
  const prNumber = String(pr).match(/(\d+)\/?$/)?.[1];
  if (!prNumber) throw new Error(`cannot read a PR number from "${pr}"`);
  const slug = repo || String(pr).match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1]
    || run(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const found = run(["api", `repos/${slug}/issues/${prNumber}/comments`, "--paginate", "--jq",
    `.[] | select(.body | startswith("${MARKER}")) | [.id, .created_at, (.body | @base64)] | @tsv`])
    .split("\n").filter(Boolean).map((l) => l.split("\t"))
    .sort(([ia, ta], [ib, tb]) => (tb > ta ? 1 : tb < ta ? -1 : Number(ib) - Number(ia)));
  for (const [id, , b64] of found) {
    const body = splice(Buffer.from(b64, "base64").toString("utf8"), section, content, { replaceAll });
    try {
      return run(["api", "-X", "PATCH", `repos/${slug}/issues/comments/${id}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body }));
    } catch (e) {
      if (e.code === 2 && /HTTP 40[34]/.test(e.message)) continue;
      throw Object.assign(e, { code: 2 });
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
    "PUT /private/settings → 403", "POST /api/views 201 (84 ms)", "/Users/{id}/settings → 200"]) {
    assert(!localPathLine(ok), `a URL or HTTP route is allowed: ${ok}`);
  }
  // upsert against a fake gh: comments are [id, created_at, body]; patch(id) returns a URL or throws.
  const ghErr = (msg) => Object.assign(new Error(msg), { code: 2 });
  const fakeGh = (comments, patch) => {
    const calls = [];
    const run = (a) => {
      calls.push(a[2]);
      if (a.includes("--paginate")) return comments.map(([id, at, b]) => `${id}\t${at}\t${Buffer.from(b).toString("base64")}`).join("\n");
      if (a[2] === "PATCH") return patch(a[3].split("/").pop());
      return "https://x/new";
    };
    return { run, calls };
  };
  const req = { pr: 7, repo: "o/r", section: "ui", content: "UI" };
  const other = fakeGh([["1", "2026-01-01T00:00:00Z", one]], () => { throw ghErr("gh: Resource not accessible by integration (HTTP 403)"); });
  assert(upsert(req, other.run) === "https://x/new" && other.calls.includes("POST"), "another author's comment (403) → a new comment is posted");
  const own = fakeGh([["2", "2026-01-02T00:00:00Z", one], ["3", "2026-01-03T00:00:00Z", two]],
    (id) => { if (id === "3") throw ghErr("gh: Not Found (HTTP 404)"); return `https://x/${id}`; });
  assert(upsert(req, own.run) === "https://x/2" && !own.calls.includes("POST"), "the own comment, second newest, is PATCHed and nothing is posted");
  const down = fakeGh([["4", "2026-01-04T00:00:00Z", one]], () => { throw ghErr("gh: Server Error (HTTP 500)"); });
  let code; try { upsert(req, down.run); } catch (e) { code = e.code; }
  assert(code === 2 && !down.calls.includes("POST"), "a PATCH that fails with 500 exits 2 and posts nothing");
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
