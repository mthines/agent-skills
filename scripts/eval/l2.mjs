#!/usr/bin/env node
// L2 — Behavioral evals (data-driven). Each suite feeds a skill's LIVE rubric
// section + a labelled input to a model and exact-matches the model's choice
// against the human label. Classification tasks → exact-match, no LLM-as-judge.
//
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs            # all suites
//   ANTHROPIC_API_KEY=… node scripts/eval/l2.mjs --suite bug-class
//   EVAL_MODEL=…  EVAL_GATE=70  …                            # override actor / soft-gate
//
// Report-only unless EVAL_GATE is set (golden sets are < 50 — evals.md calls that
// statistically noisy). Skips cleanly (exit 0) without an API key.
//
// The suite table lives in ./suites.mjs — shared with select-suites.mjs (which maps
// a changed-file list to the affected subset) and l1.mjs's G21 guards, so there is
// one definition of what each suite reads. Add a suite there.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, extractSection } from "./lib.mjs";
import { SUITES } from "./suites.mjs";

const MODEL = process.env.EVAL_MODEL || "claude-sonnet-4-6";
const KEY = process.env.ANTHROPIC_API_KEY;
const GATE = process.env.EVAL_GATE ? Number(process.env.EVAL_GATE) : null;
const only = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : null;

// An unknown --suite must be LOUD. CI drives this flag from a generated matrix, and
// the run-nothing-and-exit-0 alternative reports a typo (or a renamed suite whose
// selector entry was missed) as a passing eval — the same silent-green failure mode
// the missing API key had.
if (only !== null && !SUITES.some((s) => s.name === only)) {
  console.error(`✗ L2: unknown suite "${only}". Known: ${SUITES.map((s) => s.name).join(", ")}`);
  process.exit(2);
}

if (!KEY) {
  console.log("⊘ L2: no ANTHROPIC_API_KEY — skipping (these are LLM evals; set the key to run).");
  process.exit(0);
}

// extractSection is heading-level-aware and shared from lib.mjs so l1.mjs's G21g
// "eval actually contains a rubric" guard exercises the exact extraction this runs.

async function ask(system, input) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 16, system, messages: [{ role: "user", content: input }] }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return ((await res.json()).content?.[0]?.text || "").trim();
}

// Pick the choice that appears earliest in the model's reply (case-insensitive).
function parseChoice(text, choices) {
  const low = text.toLowerCase();
  let best = null, bestIdx = Infinity;
  for (const c of choices) {
    const idx = low.indexOf(c.toLowerCase());
    if (idx >= 0 && idx < bestIdx) { best = c; bestIdx = idx; }
  }
  return best || `?(${text.slice(0, 24)})`;
}

const summary = [];
let anyBelowGate = false;

for (const suite of SUITES) {
  if (only && suite.name !== only) continue;
  const goldenPath = join(REPO_ROOT, "scripts/eval", suite.golden);
  if (!existsSync(goldenPath)) { console.log(`(skip ${suite.name}: no golden file)`); continue; }
  const rubric = extractSection(suite.rubric.file, suite.rubric.section);
  const system = `${suite.instruction}\nReply with exactly one of: ${suite.choices.join(", ")}. No explanation.\n\n${rubric}`;
  const cases = readFileSync(goldenPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

  console.log(`\n## ${suite.name} (${cases.length} cases)`);
  const results = [];
  for (const c of cases) {
    let got;
    try { got = parseChoice(await ask(system, `${suite.inputLabel}: ${c[suite.inputKey]}`), suite.choices); }
    catch (e) { got = `ERR(${e.message.slice(0, 30)})`; }
    const ok = got === c.expected;
    results.push({ id: c.id, expected: c.expected, got, ok, input: c[suite.inputKey] });
    console.log(`  ${ok ? "✓" : "✗"} ${c.id}: expected ${c.expected}, got ${got}`);
  }
  const pass = results.filter((r) => r.ok).length;
  const acc = (pass / results.length) * 100;
  console.log(`  → ${suite.name}: ${pass}/${results.length} (${acc.toFixed(1)}%)`);
  const misses = results.filter((r) => !r.ok);
  for (const m of misses) console.log(`    miss ${m.id}: ${m.expected}→${m.got}  «${m.input}»`);
  summary.push({ name: suite.name, pass, total: results.length, acc, misses });
  if (GATE !== null && acc < GATE) anyBelowGate = true;
}

console.log(`\n=== L2 summary (model=${MODEL}) ===`);
for (const s of summary) console.log(`  ${s.name}: ${s.pass}/${s.total} (${s.acc.toFixed(1)}%)`);

if (process.env.GITHUB_STEP_SUMMARY) {
  let md = `### L2 behavioral evals — model \`${MODEL}\`\n\n| suite | accuracy | misses |\n| --- | --- | --- |\n`;
  for (const s of summary) md += `| ${s.name} | ${s.pass}/${s.total} (${s.acc.toFixed(1)}%) | ${s.misses.map((m) => `${m.id}:${m.expected}→${m.got}`).join("; ") || "—"} |\n`;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}

if (GATE !== null && anyBelowGate) {
  console.error(`\n✗ a suite is below the EVAL_GATE floor of ${GATE}%`);
  process.exit(1);
}
process.exit(0);
