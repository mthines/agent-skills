// @ts-check
/**
 * finalize/line-validity.mjs — agents/pr-reviewer/rules/line-validity.md.
 * Pure. No I/O, clock, or env (D18). Zero GitHub API calls — decided entirely
 * from the patch data already cached at prepare time.
 *
 * D5(4): retarget takes the nearest valid RIGHT-side line **in the file**
 * (not restricted to the same hunk — the executable snippet's own
 * `min(valid_lines, key=...)` searches the whole file; the rule file's
 * "same hunk" docstring was the part that was wrong, and is corrected by
 * this decision, not the code). Multi-line anchors must share a hunk.
 */

const HUNK_HEADER_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

/**
 * @param {string} patch
 * @returns {number[]} every valid RIGHT-side line number, in file order
 */
export function computeValidRightLines(patch) {
  if (!patch) return [];
  /** @type {number[]} */
  const valid = [];
  let right = null;
  for (const line of patch.split("\n")) {
    const m = HUNK_HEADER_RE.exec(line);
    if (m) { right = Number(m[1]); continue; }
    if (right === null) continue;
    if (line.startsWith("+")) { valid.push(right); right++; }
    else if (line.startsWith("-")) { /* LEFT-side only — no RIGHT-side line, no increment */ }
    else if (line.startsWith(" ")) { valid.push(right); right++; }
    // "\ No newline at end of file" and blank trailer lines: ignore, no increment.
  }
  return valid;
}

/**
 * @param {string} patch
 * @returns {{start: number, end: number}[]} the RIGHT-side [start,end] range of each hunk
 */
export function hunkRightRanges(patch) {
  if (!patch) return [];
  /** @type {{start: number, end: number}[]} */
  const ranges = [];
  for (const line of patch.split("\n")) {
    const m = HUNK_HEADER_RE.exec(line);
    if (m) {
      const start = Number(m[1]);
      const len = m[2] !== undefined ? Number(m[2]) : 1;
      ranges.push({ start, end: start + Math.max(len - 1, 0) });
    }
  }
  return ranges;
}

/**
 * @param {string} file
 * @param {number} line
 * @param {Record<string, string>} patches
 * @returns {{ isValid: boolean, retarget: number|null, reason: string }}
 */
export function validateLine(file, line, patches) {
  if (!Object.prototype.hasOwnProperty.call(patches, file)) {
    return { isValid: false, retarget: null, reason: "file not in PR changeset" };
  }
  const patch = patches[file];
  const validLines = computeValidRightLines(patch);
  if (validLines.includes(line)) return { isValid: true, retarget: null, reason: "" };
  if (validLines.length === 0) return { isValid: false, retarget: null, reason: "no valid RIGHT-side lines in file" };
  let nearest = validLines[0];
  let nearestDist = Math.abs(nearest - line);
  for (const v of validLines) {
    const d = Math.abs(v - line);
    if (d < nearestDist) { nearest = v; nearestDist = d; }
  }
  if (nearestDist <= 3) {
    return { isValid: true, retarget: nearest, reason: `retargeted from ${line} to ${nearest}` };
  }
  return { isValid: false, retarget: null, reason: `closest valid line ${nearest} is too far` };
}

/**
 * Multi-line comments: both endpoints must be in the SAME hunk and both on
 * the RIGHT side. No retarget, no splitting — a drop on any violation.
 * @param {string} file
 * @param {number} startLine
 * @param {number} line
 * @param {Record<string, string>} patches
 * @returns {{ isValid: boolean, reason: string }}
 */
export function validateMultiLine(file, startLine, line, patches) {
  if (!Object.prototype.hasOwnProperty.call(patches, file)) {
    return { isValid: false, reason: "file not in PR changeset" };
  }
  const patch = patches[file];
  const validLines = computeValidRightLines(patch);
  if (!validLines.includes(startLine) || !validLines.includes(line)) {
    return { isValid: false, reason: "one or both endpoints are out of RIGHT-side bounds" };
  }
  const ranges = hunkRightRanges(patch);
  const sameHunk = ranges.some((r) => startLine >= r.start && startLine <= r.end && line >= r.start && line <= r.end);
  if (!sameHunk) return { isValid: false, reason: "endpoints are not in the same hunk" };
  return { isValid: true, reason: "" };
}

async function selfTest() {
  let failed = 0;
  const check = (/** @type {string} */ label, /** @type {boolean} */ cond, /** @type {string} */ detail = "") => {
    if (!cond) { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
    else console.log(`  ✓ ${label}`);
  };

  // The exact example from line-validity.md.
  const examplePatch = [
    "@@ -10,6 +10,8 @@",
    " unchanged line",
    " unchanged line",
    "+new line I want",
    "+another new line",
    " unchanged line",
    "-deleted line",
    " unchanged line",
  ].join("\n");

  check("the worked example's valid RIGHT-side lines are exactly 10-15",
    JSON.stringify(computeValidRightLines(examplePatch)) === JSON.stringify([10, 11, 12, 13, 14, 15]));

  const patches = { "a.ts": examplePatch };

  {
    const r = validateLine("a.ts", 12, patches);
    check("a line already valid is used as-is", r.isValid === true && r.retarget === null);
  }
  // AC-10: retarget at Δ3 and a drop at Δ4.
  {
    const r = validateLine("a.ts", 18, patches); // nearest valid is 15, delta 3
    check("Δ3 away from the nearest valid line retargets", r.isValid === true && r.retarget === 15, JSON.stringify(r));
  }
  {
    const r = validateLine("a.ts", 19, patches); // nearest valid is 15, delta 4
    check("Δ4 away from the nearest valid line drops (no retarget)", r.isValid === false && r.retarget === null, JSON.stringify(r));
  }
  // AC-10: an anchorless undiffable path.
  {
    const r = validateLine("nonexistent.ts", 5, patches);
    check("a path not in the PR changeset is anchorless — dropped, never retargeted", r.isValid === false && r.reason === "file not in PR changeset");
  }
  {
    const emptyPatches = { "empty.ts": "" };
    const r = validateLine("empty.ts", 5, emptyPatches);
    check("a file with no valid RIGHT-side lines at all is anchorless", r.isValid === false && r.reason === "no valid RIGHT-side lines in file");
  }

  // Multi-line: same-hunk requirement.
  const twoHunkPatch = [
    "@@ -1,3 +1,3 @@",
    " a",
    "+b",
    " c",
    "@@ -20,3 +20,3 @@",
    " x",
    "+y",
    " z",
  ].join("\n");
  const mlPatches = { "b.ts": twoHunkPatch };
  {
    const r = validateMultiLine("b.ts", 1, 3, mlPatches); // both in hunk 1
    check("multi-line endpoints in the same hunk are valid", r.isValid === true);
  }
  {
    const r = validateMultiLine("b.ts", 1, 20, mlPatches); // hunk 1 and hunk 2
    check("multi-line endpoints spanning two hunks are dropped, never split", r.isValid === false && r.reason === "endpoints are not in the same hunk");
  }

  if (failed > 0) {
    console.error(`\nline-validity self-test: ${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ line-validity self-test: all checks passed");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv.includes("--self-test")) {
  selfTest();
}
