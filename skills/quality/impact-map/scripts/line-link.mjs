#!/usr/bin/env node
// line-link.mjs — new-side line numbers and GitHub links for impact-map.
//
// Usage:
//   node line-link.mjs locate <diff-file> <path> <regex>
//   node line-link.mjs url --repo <owner/name> --pr <n> --sha <head-sha> --path <path> --lines <a>[-<b>] [--files <count>]
//   node line-link.mjs --self-test
//
// `locate` prints "<line>: <text>" for every added or context line of <path> in the
// unified diff whose text matches <regex>, numbered on the new (head) side.
// `url` prints {"primary", "file"}: a Files-tab diff anchor when the PR has at most
// 300 changed files, else the blob link, because GitHub cannot load a larger diff.
// Exit codes: 0 ok · 1 nothing found / self-test failure · 2 usage error.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const DIFF_FILE_LIMIT = 300; // GitHub refuses PR diffs above 300 files (HTTP 406 too_large).

export function locate(diffText, path, pattern) {
  const re = new RegExp(pattern);
  const hits = [];
  let file = null;
  let line = 0;
  let inHeader = false; // between `diff --git` and the first `@@`; only there is `+++ ` a file header
  for (const raw of diffText.split("\n")) {
    if (raw.startsWith("diff --git ")) { file = null; inHeader = true; continue; }
    if (inHeader && raw.startsWith("+++ ")) { file = raw.slice(4).replace(/^b\//, ""); continue; }
    if (inHeader && raw.startsWith("--- ")) continue;
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { line = Number(hunk[1]) - 1; inHeader = false; continue; }
    if (file !== path || raw.startsWith("-") || raw.startsWith("\\")) continue;
    line += 1;
    const text = raw.slice(1);
    if (re.test(text)) hits.push({ line, text });
  }
  return hits;
}

export function links({ repo, pr, sha, path, lines, files }) {
  const [a, b = a] = String(lines).split("-").map(Number);
  const blob = `https://github.com/${repo}/blob/${sha}/${path}#L${a}${b !== a ? `-L${b}` : ""}`;
  if (Number(files) > DIFF_FILE_LIMIT) return { primary: blob, file: null };
  const anchor = createHash("sha256").update(path).digest("hex");
  const diff = `https://github.com/${repo}/pull/${pr}/files#diff-${anchor}R${a}${b !== a ? `-R${b}` : ""}`;
  return { primary: diff, file: blob };
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, "")] = argv[i + 1];
  return out;
}

function selfTest() {
  const diff = [
    "diff --git a/src/a.go b/src/a.go",
    "--- a/src/a.go",
    "+++ b/src/a.go",
    "@@ -5,3 +5,4 @@ func x() {",
    " keep",
    "-gone",
    "+const path_env = 1",
    " tail",
    "diff --git a/src/b.go b/src/b.go",
    "--- a/src/b.go",
    "+++ b/src/b.go",
    "@@ -0,0 +1,2 @@",
    "+const path_env = 2",
    "+other",
    "diff --git a/src/c.go b/src/c.go",
    "--- a/src/c.go",
    "+++ b/src/c.go",
    "@@ -0,0 +1,2 @@",
    "+++ counter",
    "+const path_env = 3",
  ].join("\n");
  const checks = [
    ["locate counts new-side lines and skips removed ones", JSON.stringify(locate(diff, "src/a.go", "path_env")), JSON.stringify([{ line: 6, text: "const path_env = 1" }])],
    ["locate stays inside the named file", locate(diff, "src/b.go", "path_env")[0]?.line, 1],
    ["an added line starting with ++ is not a header", locate(diff, "src/c.go", "path_env")[0]?.line, 2],
    ["anchor is sha256 of the path", links({ repo: "o/r", pr: 1, sha: "abc", path: "src/a.go", lines: "6", files: 3 }).primary,
      `https://github.com/o/r/pull/1/files#diff-${createHash("sha256").update("src/a.go").digest("hex")}R6`],
    ["range uses R<a>-R<b>", links({ repo: "o/r", pr: 1, sha: "abc", path: "p", lines: "3-9", files: 3 }).primary.endsWith("R3-R9"), true],
    ["over 300 files the primary link is the blob", links({ repo: "o/r", pr: 1, sha: "abc", path: "p", lines: "3-9", files: 528 }).primary, "https://github.com/o/r/blob/abc/p#L3-L9"],
  ];
  let failed = 0;
  for (const [name, got, want] of checks) {
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got ${got}, want ${want}`}`);
  }
  return failed === 0 ? 0 : 1;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === "--self-test") return selfTest();
  if (cmd === "locate" && rest.length === 3) {
    const hits = locate(readFileSync(rest[0], "utf8"), rest[1], rest[2]);
    for (const h of hits) console.log(`${h.line}: ${h.text}`);
    return hits.length ? 0 : 1;
  }
  if (cmd === "url") {
    const f = parseFlags(rest);
    if (!f.repo || !f.pr || !f.sha || !f.path || !f.files) { console.error("url needs --repo --pr --sha --path --lines --files"); return 2; }
    if (!/^\d+(-\d+)?$/.test(f.lines ?? "")) { console.error(`--lines must be <a> or <a>-<b> with an ASCII hyphen, got ${f.lines}`); return 2; }
    console.log(JSON.stringify(links(f)));
    return 0;
  }
  console.error("usage: line-link.mjs locate <diff> <path> <regex> | url --repo … --pr … --sha … --path … --lines a[-b] [--files n] | --self-test");
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("line-link.mjs")) process.exitCode = main(process.argv.slice(2));
