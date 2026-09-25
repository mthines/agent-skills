#!/usr/bin/env node
// escaping-links — count the relative Markdown links that leave their own skill folder.
//
// Why this exists: a skill is only portable if everything it tells an agent to read ships
// inside its own folder. Hosts that import skills one folder at a time (Dash0 Agent0 installs
// each at /tmp/.opencode/skills/custom/<name>/, flat, with no `agents/` tree) break every
// `../` link that climbs out of the folder. The author's machine hides the breakage: each
// skill is symlinked back into this repo, so `../` resolves locally and fails everywhere else.
//
// A link "escapes" when its normalized target is not under the folder of the skill that owns
// the linking file. The owner is the DEEPEST directory holding a SKILL.md above the file, so a
// nested skill (autonomous-workflow/aw/) is its own owner, not its parent's.
//
// Counting mirrors the measurement the restructure plan used: every `](./…)` / `](../…)` in
// every `skills/**/*.md`, fences included, anchors stripped.
//
//   node scripts/eval/escaping-links.mjs            per-skill counts vs the baseline
//   node scripts/eval/escaping-links.mjs --write    rewrite the baseline to today's counts
//   node scripts/eval/escaping-links.mjs --self-test
//
// L1 (G71) imports `escapingLinks` and fails when any skill's count rises above its baseline.
// Lower the baseline with --write in the same commit that removes links — it is a ratchet.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, sep } from "node:path";
import { REPO_ROOT, walk } from "./lib.mjs";

export const BASELINE_FILE = join(REPO_ROOT, "scripts/eval/escaping-links.baseline.json");
const LINK = /\]\((\.\.?\/[^)#\s]+)/g;

/** @returns {Record<string, {file: string, target: string}[]>} keyed by the owning skill's repo-relative dir. */
export function escapingLinks(root = REPO_ROOT) {
  const skillsDir = join(root, "skills");
  const skillDirs = walk(skillsDir)
    .filter((p) => p.endsWith(`${sep}SKILL.md`))
    .map((p) => dirname(p))
    .sort((a, b) => b.length - a.length);
  const owner = (p) => skillDirs.find((d) => p.startsWith(d + sep));
  const out = {};
  for (const f of walk(skillsDir)) {
    const o = owner(f);
    if (!o) continue;
    const body = readFileSync(f, "utf8");
    for (const m of body.matchAll(LINK)) {
      const target = join(dirname(f), m[1]);
      if (target.startsWith(o + sep)) continue;
      const key = relative(root, o).split(sep).join("/");
      (out[key] ??= []).push({ file: relative(root, f).split(sep).join("/"), target: m[1] });
    }
  }
  return out;
}

export function counts(found) {
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v.length]).sort(([a], [b]) => a.localeCompare(b)));
}

export function readBaseline() {
  return existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : {};
}

function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), "esc-links-"));
  let ok = true;
  const check = (label, cond) => { console.log(`${cond ? "✓" : "✗"} ${label}`); ok &&= cond; };
  try {
    const mk = (p, body) => { mkdirSync(dirname(join(tmp, p)), { recursive: true }); writeFileSync(join(tmp, p), body); };
    mk("skills/cat/a/SKILL.md", "[in](./rules/x.md) [out](../b/SKILL.md) [anchor-only](#h) [abs](https://x.y)");
    mk("skills/cat/a/rules/x.md", "[up-in](../SKILL.md) [up-out](../../../../agents/z.md#sec)");
    mk("skills/cat/a/nested/SKILL.md", "[parent](../SKILL.md)");
    mk("skills/cat/b/SKILL.md", "no links");
    const found = counts(escapingLinks(tmp));
    check("a link into the owning skill does not escape", !JSON.stringify(escapingLinks(tmp)).includes("./rules/x.md"));
    check("a sibling-skill link escapes", found["skills/cat/a"] === 2);
    check("a nested skill owns its own folder, so a link to its parent escapes", found["skills/cat/a/nested"] === 1);
    check("a skill with no escaping links is absent from the counts", !("skills/cat/b" in found));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) selfTest();
  const now = counts(escapingLinks());
  if (argv.includes("--write")) {
    writeFileSync(BASELINE_FILE, JSON.stringify(now, null, 2) + "\n");
    console.log(`wrote ${Object.values(now).reduce((a, b) => a + b, 0)} escaping links across ${Object.keys(now).length} skills`);
    process.exit(0);
  }
  const base = readBaseline();
  let total = 0, over = 0;
  for (const k of [...new Set([...Object.keys(now), ...Object.keys(base)])].sort()) {
    const n = now[k] ?? 0, b = base[k] ?? 0;
    total += n;
    if (n > b) over++;
    if (n || b) console.log(`${n > b ? "✗" : n < b ? "↓" : " "} ${String(n).padStart(4)} / ${String(b).padStart(4)}  ${k}`);
  }
  console.log(`${total} escaping links; ${over} skill(s) above baseline`);
  process.exit(over ? 1 : 0);
}
