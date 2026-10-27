#!/usr/bin/env node
// is-motion-diff.mjs — deterministic "does this change add or edit motion?" gate.
//
// WHY THIS EXISTS
// pr-reviewer and ui-verify load animation-specific review and profiling only
// when a diff touches motion, so the motion rules cost zero context on every
// other change. The decision has to be identical for both callers and cheap,
// so it is a content scan of the diff's ADDED lines, never an agent's guess.
//
// IT IS A CLASSIFIER, NOT A GATE ITS CALLERS CANNOT SEE:
// it prints a JSON object and a final `MOTION_DIFF: yes|no` line to stdout and
// exits 0 for both answers. Exit 2 is a real error (bad args, git failure).
//
// INPUTS (first present wins):
//   --base <ref> [--head <ref>]  compute via `git diff <base>...<head>`
//   --patches-json <file>        GitHub PR files: an array, or a jq stream of
//                                objects, each with `filename` and `patch`
//                                (pr-reviewer's context.paths.files or /tmp/pr-files.json)
//   --diff-file <file>           a unified diff
//   (stdin)                      a unified diff, when piped
//   --self-test                  run the built-in cases and exit
//
// EXIT: 0 (answer printed), 2 (error).

import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Each signal names one motion technique. Matched against added lines only:
// a removed animation needs no animation review.
const SIGNALS = [
  ["css-keyframes", /@keyframes\b/],
  ["css-animation", /(^|[\s{;"'`])animation(-name|-duration|-timeline)?\s*:/],
  ["css-transition", /(^|[\s{;"'`])transition(-property|-duration)?\s*:\s*(?!none\b)[^\s;]/],
  ["will-change", /\bwill-change\s*:/],
  ["starting-style", /@starting-style\b/],
  ["view-transition", /\bstartViewTransition\b|view-transition-name\s*:|@view-transition\b/],
  ["scroll-timeline", /\b(scroll|view)-timeline(-name)?\s*:|\banimation-timeline\b/],
  ["reduced-motion", /prefers-reduced-motion|\buseReducedMotion\b/],
  ["waapi", /\.animate\(\s*[[{]/],
  ["raf-loop", /\brequestAnimationFrame\s*\(/],
  [
    "motion-library",
    /from\s+['"](motion(\/react)?|framer-motion|gsap(\/\w+)?|animejs|@react-spring\/[\w-]+|react-spring|lottie-react|lottie-web|@lottiefiles\/[\w-]+|@rive-app\/[\w-]+|react-native-reanimated|@react-three\/fiber|react-transition-group|@formkit\/auto-animate[\w/-]*|@react-native-community\/[\w-]*|moti)['"]/,
  ],
  ["motion-component", /<(motion|m)\.[a-z]\w*\b|<AnimatePresence\b|\buseMotionValue\b|\buseAnimate\b|\buseScroll\b|\blayoutId=/],
  ["native-animated", /\bAnimated\.(timing|spring|decay|loop|View)\b|\bwith(Timing|Spring|Decay|Repeat)\(|\bLayoutAnimation\./],
  ["tailwind-motion", /\banimate-(spin|ping|pulse|bounce|\[)|\btransition-(all|transform|opacity|\[)/],
];

// Files whose text mentions motion without shipping it.
const EXCLUDED = [/\.md$/i, /\.snap$/, /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/, /(^|\/)CHANGELOG/i];

export function classify(files) {
  const hits = [];
  for (const { path, added } of files) {
    if (!path || EXCLUDED.some((re) => re.test(path))) continue;
    const signals = new Set();
    for (const line of added) for (const [name, re] of SIGNALS) if (re.test(line)) signals.add(name);
    if (signals.size) hits.push({ path, signals: [...signals].sort() });
  }
  return { motion: hits.length > 0, files: hits };
}

// Unified diff → [{ path, added: [lines] }].
export function parseUnifiedDiff(text) {
  const files = [];
  let cur = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("+++ ")) {
      const p = line.slice(4).trim();
      cur = { path: p === "/dev/null" ? null : p.replace(/^b\//, ""), added: [] };
      files.push(cur);
    } else if (cur && line.startsWith("+")) {
      cur.added.push(line.slice(1));
    }
  }
  return files;
}

// GitHub files JSON (array, `{files: [...]}`, or a jq stream of objects) → [{ path, added }].
export function parsePatches(text) {
  let rows;
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : parsed.files ?? [parsed];
  } catch {
    rows = parseJsonStream(text);
  }
  return rows.map((r) => ({
    path: r.filename,
    added: (r.patch ?? "").split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)),
  }));
}

function parseJsonStream(text) {
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") { if (depth++ === 0) start = i; }
    else if (c === "}" && --depth === 0) out.push(JSON.parse(text.slice(start, i + 1)));
  }
  return out;
}

function selfTest() {
  const cases = [
    ["css keyframes", "+++ b/a.css\n+@keyframes spin { to { transform: rotate(1turn) } }", true],
    ["css transition", "+++ b/a.css\n+  transition: transform 200ms ease-out;", true],
    ["transition none", "+++ b/a.css\n+  transition: none;", false],
    ["motion import", "+++ b/a.tsx\n+import { motion } from 'motion/react';", true],
    ["react useTransition is not motion", "+++ b/a.tsx\n+const [p, start] = useTransition();", false],
    ["removed animation only", "+++ b/a.css\n-@keyframes spin {}", false],
    ["markdown mention", "+++ b/README.md\n+Use @keyframes for this.", false],
    ["plain component", "+++ b/a.tsx\n+export const A = () => <div className=\"p-4\" />;", false],
    ["raf loop", "+++ b/a.ts\n+requestAnimationFrame(tick);", true],
    ["tailwind spin", "+++ b/a.tsx\n+<Icon className=\"animate-spin\" />", true],
  ];
  let failed = 0;
  for (const [name, diff, want] of cases) {
    const got = classify(parseUnifiedDiff(diff)).motion;
    if (got !== want) { failed++; console.error(`FAIL ${name}: want ${want}, got ${got}`); }
  }
  const stream = '{"filename":"a.css","patch":"@@ -1 +1 @@\\n+@keyframes x {}"}\n{"filename":"b.ts","patch":"+const a = 1;"}';
  if (!classify(parsePatches(stream)).motion) { failed++; console.error("FAIL jq stream patches"); }
  console.log(failed ? `SELF-TEST ${failed} FAILED` : `SELF-TEST ${cases.length + 1}/${cases.length + 1} PASS`);
  process.exit(failed ? 1 : 0);
}

function main(argv) {
  const arg = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--self-test")) return selfTest();
  let files;
  if (arg("--base")) {
    const range = `${arg("--base")}...${arg("--head") ?? "HEAD"}`;
    files = parseUnifiedDiff(execFileSync("git", ["diff", "--no-color", "--unified=0", range], { encoding: "utf8", maxBuffer: 1 << 28 }));
  } else if (arg("--patches-json")) {
    files = parsePatches(readFileSync(arg("--patches-json"), "utf8"));
  } else if (arg("--diff-file")) {
    files = parseUnifiedDiff(readFileSync(arg("--diff-file"), "utf8"));
  } else if (!process.stdin.isTTY) {
    files = parseUnifiedDiff(readFileSync(0, "utf8"));
  } else {
    throw new Error("no input: pass --base, --patches-json, --diff-file, or pipe a diff");
  }
  const result = classify(files);
  console.log(JSON.stringify(result));
  console.log(`MOTION_DIFF: ${result.motion ? "yes" : "no"}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`is-motion-diff: ${err.message}`);
    process.exit(2);
  }
}
