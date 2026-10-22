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
    const a = body.indexOf(open(s));
    const b = body.indexOf(close(s));
    if (a !== -1 && b > a) regions.set(s, body.slice(a + open(s).length, b).trim());
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

// GET /user answers 403 to an Actions GITHUB_TOKEN; its comments are authored by github-actions[bot].
function viewerLogin() {
  try { return gh(["api", "user", "--jq", ".login"]); } catch (e) {
    if (process.env.GITHUB_ACTIONS === "true") return "github-actions[bot]";
    throw e;
  }
}

function upsert({ pr, repo, section, content, replaceAll }) {
  const n = String(pr).match(/(\d+)\/?$/)?.[1];
  if (!n) throw new Error(`cannot read a PR number from "${pr}"`);
  const slug = repo || String(pr).match(/github\.com\/([^/]+\/[^/]+)\/pull\//)?.[1]
    || gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  // Only the viewer's own comment is editable; another author's verify comment is left alone.
  const me = viewerLogin();
  const found = gh(["api", `repos/${slug}/issues/${n}/comments`, "--paginate", "--jq",
    `.[] | select((.body | startswith("${MARKER}")) and .user.login == "${me}") | [.id, (.body | @base64)] | @tsv`]).split("\n").filter(Boolean)[0];
  const [id, b64] = found ? found.split("\t") : [];
  const body = splice(id ? Buffer.from(b64, "base64").toString("utf8") : "", section, content, { replaceAll });
  const payload = JSON.stringify({ body });
  return id
    ? gh(["api", "-X", "PATCH", `repos/${slug}/issues/comments/${id}`, "--input", "-", "--jq", ".html_url"], payload)
    : gh(["api", "-X", "POST", `repos/${slug}/issues/${n}/comments`, "--input", "-", "--jq", ".html_url"], payload);
}

function selfTest() {
  const assert = (ok, msg) => { if (!ok) { console.error(`self-test FAIL: ${msg}`); process.exit(1); } };
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
  console.log("verify-comment self-test: 23 assertions passed");
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
      const ex = opt("--existing");
      process.stdout.write(splice(ex ? readFileSync(ex === "-" ? 0 : ex, "utf8") : "", section, content, { replaceAll }));
    } else {
      if (!opt("--pr")) throw new Error("--pr is required unless --dry-run");
      console.log(upsert({ pr: opt("--pr"), repo: opt("--repo"), section, content, replaceAll }));
    }
  } catch (e) {
    console.error(`verify-comment: ${e.message}`);
    process.exit(e.code === 2 ? 2 : 1);
  }
}
